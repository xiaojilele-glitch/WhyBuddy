"""rowsRef：逐行真实数据的绑定（2026-08-03）。

用户裁决「首页只由 LLM 动态设计，参照图上有什么就设计什么，不要固定组件」。
挡在这个目标前面的不是审美取舍，是**能力缺口**：dataRef 只能表达聚合值
（count/sum/avg），没有"枚举第 N 行"的办法，设计模型一画排行榜/动态流就是
表头加一片空白。此前的解法是 blockRef（从固定积木清单里挑一个嵌进设计树），
但积木长什么样由组件写死，参照图上的版式落不了地——所以那条通道整体删除，
逐行能力直接补给设计模型自己。

这里守两类事：
  · 能力真的通了：合法的 rowsRef + 模板 + fieldRef 能过校验；
  · 安全边界不能松：字段白名单、作用域、行数上限、引用真实性。
    逐行数据比聚合数字敏感得多，白名单是主要防线。
"""

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.freeform_block import (  # noqa: E402
    ROWS_REF_MAX_LIMIT,
    _rows_prompt_fragment,
    build_freeform_models,
)

DATAMODEL = {
    "entities": [
        {
            "id": "book",
            "name": "绘本",
            "fields": [
                {"id": "title", "name": "书名", "type": "string"},
                {"id": "borrow_count", "name": "借阅次数", "type": "number"},
                {"id": "isbn", "name": "ISBN", "type": "string"},
            ],
        },
        {
            "id": "reader",
            "name": "读者",
            "fields": [{"id": "name", "name": "姓名", "type": "string"}],
        },
    ]
}


def _validate(root):
    return build_freeform_models(DATAMODEL).model_validate({"root": root})


def _list_root(rows_ref, field_refs=("title", "borrow_count")):
    """列表容器 + 一行的模板。"""
    return {
        "tag": "div",
        "rowsRef": rows_ref,
        "children": [
            {
                "tag": "div",
                "children": [{"tag": "span", "fieldRef": f} for f in field_refs],
            }
        ],
    }


# ── 能力：逐行内容真的画得出来 ────────────────────────────────────


def test_minimal_rows_ref_accepted():
    tree = _validate(_list_root({"entityRef": "book", "fieldRefs": ["title", "borrow_count"]}))
    assert tree.root.rowsRef.entityRef == "book"
    # 模板只写一份，重复由渲染期负责——设计树里就是一个子节点
    assert len(tree.root.children) == 1


def test_sort_and_limit_accepted():
    tree = _validate(
        _list_root(
            {
                "entityRef": "book",
                "fieldRefs": ["title", "borrow_count"],
                "sortByRef": "borrow_count",
                "order": "desc",
                "limit": 8,
            }
        )
    )
    assert tree.root.rowsRef.sortByRef == "borrow_count"
    assert tree.root.rowsRef.limit == 8


def test_limit_defaults_when_omitted():
    tree = _validate(_list_root({"entityRef": "book", "fieldRefs": ["title"]}, ("title",)))
    assert 1 <= tree.root.rowsRef.limit <= ROWS_REF_MAX_LIMIT


# ── 安全边界：字段白名单 ──────────────────────────────────────────


def test_field_ref_outside_the_declared_allowlist_is_rejected():
    """模板里只能取 fieldRefs 声明过的字段——逐行数据的主要防线。

    不设这道闸的话，设计模型可以顺手把整张表的字段拉到首页上（身份证号、
    手机号、内部备注都在同一张表里），而声明与使用分离正是能审计的地方。
    """
    with pytest.raises(ValidationError) as e:
        _validate(_list_root({"entityRef": "book", "fieldRefs": ["title"]}, ("title", "isbn")))
    assert "isbn" in str(e.value) and "fieldRefs" in str(e.value)


def test_field_ref_outside_any_rows_ref_is_rejected():
    """作用域外的 fieldRef 没有"当前行"可言，渲染期无解，直接拦下。"""
    with pytest.raises(ValidationError) as e:
        _validate({"tag": "div", "children": [{"tag": "span", "fieldRef": "title"}]})
    assert "不在任何 rowsRef" in str(e.value)


def test_nested_rows_ref_uses_the_innermost_allowlist():
    """嵌套时以最近的 rowsRef 为准（同 CSS 作用域直觉）。"""
    root = {
        "tag": "div",
        "rowsRef": {"entityRef": "book", "fieldRefs": ["title"]},
        "children": [
            {
                "tag": "div",
                "rowsRef": {"entityRef": "reader", "fieldRefs": ["name"]},
                "children": [{"tag": "span", "fieldRef": "name"}],
            }
        ],
    }
    assert _validate(root) is not None
    # 内层作用域里取外层的字段同样不行
    root["children"][0]["children"][0]["fieldRef"] = "title"
    with pytest.raises(ValidationError):
        _validate(root)


# ── 安全边界：引用真实性与规模 ────────────────────────────────────


def test_unknown_entity_rejected():
    with pytest.raises(ValidationError) as e:
        _validate(_list_root({"entityRef": "ghost", "fieldRefs": ["title"]}, ("title",)))
    assert "ghost" in str(e.value)


def test_unknown_field_in_allowlist_rejected():
    with pytest.raises(ValidationError) as e:
        _validate(_list_root({"entityRef": "book", "fieldRefs": ["nope"]}, ("title",)))
    # 报错要带上该实体的真实字段，reask 一次就能改对
    assert "nope" in str(e.value) and "title" in str(e.value)


def test_sort_field_must_exist():
    with pytest.raises(ValidationError):
        _validate(
            _list_root(
                {"entityRef": "book", "fieldRefs": ["title"], "sortByRef": "nope"}, ("title",)
            )
        )


def test_empty_allowlist_rejected():
    with pytest.raises(ValidationError) as e:
        _validate({"tag": "div", "rowsRef": {"entityRef": "book", "fieldRefs": []}, "children": []})
    assert "不能为空" in str(e.value)


def test_limit_capped():
    """一个 rowsRef 就能把 limit 份模板摆进页面——不夹上限会吃穿渲染预算。"""
    with pytest.raises(ValidationError) as e:
        _validate(
            _list_root(
                {"entityRef": "book", "fieldRefs": ["title"], "limit": ROWS_REF_MAX_LIMIT + 1},
                ("title",),
            )
        )
    assert str(ROWS_REF_MAX_LIMIT) in str(e.value)


def test_bad_order_rejected():
    with pytest.raises(ValidationError):
        _validate(
            _list_root(
                {"entityRef": "book", "fieldRefs": ["title"], "order": "random"}, ("title",)
            )
        )


# ── prompt 得把话说全 ─────────────────────────────────────────────


def test_prompt_says_row_content_is_drawable_and_how():
    """三件事少一件都会退回老毛病，见 _rows_prompt_fragment 的说明。"""
    frag = _rows_prompt_fragment()
    assert "rowsRef" in frag and "fieldRef" in frag
    # ① 逐行内容可以画（不说的话模型沿用旧直觉改用聚合数字）
    assert "你可以自己画" in frag
    # ② 模板只写一份（不说的话模型手写 N 份、节点数爆掉）
    assert "模板只写一份" in frag
    # ③ 字段要先声明（漏了会被拒收、白烧一轮 reask）
    assert "fieldRefs 里声明过的字段" in frag
    # 参照图没有就不画——这次裁决的核心
    assert "参照图上有才画" in frag
    # 固定积木那套说法不能残留
    assert "blockRef" not in frag
