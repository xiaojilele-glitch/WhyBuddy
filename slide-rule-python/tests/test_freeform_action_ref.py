# -*- coding: utf-8 -*-
"""自由树的 actionRef：按钮从"会发光的 div"变成能点的（2026-08-13）。

## 补这一维之前是什么样

节点契约只有 tag/style/text/iconRef/imageRef/dataRef/chart/rowsRef/fieldRef/
children——**一个"点了干什么"都没有**。设计模型画得出「编辑」按钮，却没地方
写它该触发什么。线上的表现就是：首页那些按钮点了没反应。

而管道一直是通的：`ExperienceBlockRendererProps` 有 `onAction`，所有渲染器
都收得到，组件区块靠它干活（DataTable 行内那两个链接）。自由树那边调用次数
是 0——不是线断了，是节点上没有可以接线的地方。

## 为什么只有三种 kind（2026-08-14 晚起：词表扩到六种，来源收拢）

`navigate`（跳到某一页）这一版**故意没有**：目标是 page id，而
`build_freeform_models` 只拿得到 datamodel、结构闸也没走进自由树——
**验不了的引用不该让模型写**，否则就是又开一个可以瞎填的字段。

这三种全部落在 datamodel 上，验得死。

2026-08-14 晚词表加了转移三种（submitWorkflow/approveWorkflow/rejectWorkflow），
且 ActionRef 不再手抄 Literal，改为直接查 html_bindings.ACTION_KINDS——
词表 Python 侧只有那一份。本文件的作用域/串台判据不变。

## 判据守什么

三条，都是"单看一个节点看不出来、只有树级才判得了"的：

  · openRecord/editRecord 必须在 rowsRef 子树里 —— 作用域外没有"当前行"
  · 实体必须跟所在列表一致 —— 防串台：在客户列表里放 editRecord(follow_up)，
    运行时会拿客户的行 id 去开跟进记录的表单
  · createRecord 不受作用域限制 —— 新建不需要当前行，页头的「+ 新建」就该在外面
"""

import pytest

from services.freeform_block import build_freeform_models

DATAMODEL = {
    "entities": [
        {"id": "customer", "name": "客户", "fields": [{"id": "name", "name": "姓名", "type": "string"}]},
        {"id": "follow_up", "name": "跟进", "fields": [{"id": "note", "name": "备注", "type": "string"}]},
    ]
}


@pytest.fixture(scope="module")
def M():
    return build_freeform_models(DATAMODEL)


#: 各实体的真实字段——rowsRef.fieldRefs 必须是该实体真有的字段，
#: 混用会被另一条既有校验拦下（第一版用例就栽在这里）。
_FIELDS = {"customer": ["name"], "follow_up": ["note"]}


def _rows(children, entity="customer"):
    return {
        "tag": "ul",
        "rowsRef": {"entityRef": entity, "fieldRefs": _FIELDS[entity]},
        "children": children,
    }


class Test合法用法:
    def test_列表里的编辑按钮(self, M):
        M.model_validate({"root": _rows([
            {"tag": "li", "children": [
                {"tag": "span", "fieldRef": "name"},
                {"tag": "span", "text": "编辑",
                 "actionRef": {"kind": "editRecord", "entityRef": "customer"}},
            ]}
        ])})

    def test_列表外的新建按钮(self, M):
        """createRecord 不需要当前行——页头那个「+ 新建」就该在列表外面。"""
        M.model_validate({"root": {"tag": "div", "children": [
            {"tag": "div", "text": "+ 新建客户",
             "actionRef": {"kind": "createRecord", "entityRef": "customer"}},
        ]}})

    def test_不带_actionRef_的节点照旧(self, M):
        """存量模型一个字都不用改——这是能安全上线的前提。"""
        M.model_validate({"root": {"tag": "div", "text": "纯展示", "style": {"padding": "8px"}}})


class Test树级校验:
    def test_列表外的_editRecord_要拦(self, M):
        with pytest.raises(Exception) as e:
            M.model_validate({"root": {"tag": "div",
                "actionRef": {"kind": "editRecord", "entityRef": "customer"}}})
        assert "rowsRef" in str(e.value), "错误信息得说清楚缺的是什么"

    def test_实体串台要拦(self, M):
        """在客户列表里放一个 editRecord(follow_up)：运行时会拿着客户的行 id
        去开跟进记录的表单，打开的是一条不存在的记录。单看节点看不出来。"""
        with pytest.raises(Exception) as e:
            M.model_validate({"root": _rows([
                {"tag": "li", "actionRef": {"kind": "editRecord", "entityRef": "follow_up"}}
            ])})
        assert "follow_up" in str(e.value) and "customer" in str(e.value)

    def test_嵌套列表以最近的为准(self, M):
        """跟 fieldRef 的作用域规则一致（同 CSS 直觉）：内层 rowsRef 说了算。"""
        M.model_validate({"root": _rows([
            {"tag": "li", "children": [_rows([
                {"tag": "li", "actionRef": {"kind": "editRecord", "entityRef": "follow_up"}}
            ], entity="follow_up")]}
        ])})


class Test节点级校验:
    def test_不存在的实体要拦(self, M):
        with pytest.raises(Exception):
            M.model_validate({"root": {"tag": "div",
                "actionRef": {"kind": "createRecord", "entityRef": "ghost"}}})

    @pytest.mark.parametrize("kind", ["delete", "submit", "navigate", "save"])
    def test_词表外的词要拦(self, M, kind):
        """navigate 也在拦截之列——**故意的**。它的目标是 page id，这里验不了；
        验不了的引用不该让模型写。等 page id 能传进来再开。
        错误信息要把整张词表报出来——模型看得见词表才知道能写什么。"""
        with pytest.raises(Exception) as e:
            M.model_validate({"root": {"tag": "div",
                "actionRef": {"kind": kind, "entityRef": "customer"}}})
        assert "动作词表" in str(e.value)


class Test标签白名单没被放宽:
    def test_button_仍然不许用(self, M):
        """加 `button` 进白名单的话，模型能画出不带 actionRef 的死按钮——
        回到"会发光的 div"那个原点。所以走"带 actionRef 的节点自动可交互"，
        白名单一个字不动（它同时还是 XSS 防线）。"""
        with pytest.raises(Exception) as e:
            M.model_validate({"root": {"tag": "button", "text": "点我"}})
        assert "not allowed" in str(e.value)
