"""页面 brief 照那份**真出过好效果**的模板补齐（2026-08-15 晚）。

## 参照哪一份

`experiments/visual-first/img_hop2.py` 的 `image_prompt_from_spec`，它逐字对着
`materials/previews/provenance-crm-4pages.json`——仓里注释称其为"唯一真出过
好效果的样本"。那份模板六段：

    ① 产品一句话
    ② 页面名
    ③ acceptance 原文
    ④ 设计要点（notes）
    ⑤ 固定的版式要求句
    ⑥ 「每个页面布局要各不相同」

本仓的 build_page_brief 原来缺 ① 和 ④。

⚠ img_hop2 的注释直接点了名：「① 产品一句话（**旧那份的 page_brief 没有**
  ——模型不知道这是个什么产品）」。而 build_page_brief 就是那个"旧那份"。

⚠ ④ 更糟：原来写的是 `acceptance or notes`——**有验收条件就把设计要点丢掉**。
  notes 恰好是 spec 里唯一一处**逐页不同的版式提示**（"列表页提供关键词搜索
  与效期区间筛选"这类），丢掉它等于把仅有的排布信息扔了。

## ⑥ 那句**故意不抄**，有实测支持

`freeform_block.py` 记着 2026-07-31 的测量：两个完全不同业务（律所案件台 /
农业大棚监控）的出图提示词**逐字相同 87%**，而"连着三轮实验——删掉版式处方、
**加一句「每个页面布局要各不相同」**、换掉 brief 口吻——出图骨架都纹丝不动"。

也就是说这句话**试过，没用**。不抄它不是抄漏。

## 改前改后

    改前  两业务提示词逐字相同 95.7%，1642 字里随业务变的只有 69 字
    改后                     93.2%，1714 字里随业务变 115 字
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.spec_page_html import (  # noqa: E402
    assumption_prompt_block,
    build_page_brief,
)

SPEC = {
    "appName": "邻里药安",
    "nodes": [
        {"id": "n1", "title": "批次效期管理",
         "acceptance": "当药师查询库存时，系统应按批次展示效期与预警。",
         "notes": "列表页提供关键词搜索与效期区间筛选，支持清空条件"},
        {"id": "n2", "title": "损耗登记", "acceptance": "当药品过期时，系统应支持登记损耗。"},
    ],
}
PAGE = {"name": "库存台账管理页", "audience": "药师", "purpose": "按批次管理效期",
        "coversNodes": ["n1", "n2"]}
PRODUCT = "给社区药店做一套进销存与处方登记系统，管住效期和处方合规。"


class Test产品一句话:
    def test_产品定位进了brief(self):
        """★ img_hop2 点名的那条：模型得知道这是个什么产品，
        不然它只知道"这一页叫库存台账管理页"。"""
        assert PRODUCT in build_page_brief(PAGE, SPEC, product=PRODUCT)

    def test_产品名也进(self):
        assert "邻里药安" in build_page_brief(PAGE, SPEC, product=PRODUCT)

    @pytest.mark.parametrize("empty", ["", "   ", None])
    def test_没给产品就不写那一行(self, empty):
        """⚠ 不写空行：`产品：` 后面跟一片空白，比没有更像出错。"""
        out = build_page_brief(PAGE, SPEC, product=empty)
        assert "产品：" not in out
        assert "页面：库存台账管理页" in out

    def test_没有appName也不炸(self):
        out = build_page_brief(PAGE, {"nodes": SPEC["nodes"]}, product=PRODUCT)
        assert "产品名：" not in out and PRODUCT in out


class Test设计要点不许再被丢掉:
    """★ 原来是 `acceptance or notes`——有验收条件就把 notes 扔了。"""

    def test_两样都在(self):
        out = build_page_brief(PAGE, SPEC, product=PRODUCT)
        assert "当药师查询库存时" in out, "验收条件没了"
        assert "列表页提供关键词搜索" in out, "设计要点被丢掉了（老毛病复发）"

    def test_设计要点单独成段(self):
        """⚠ 不塞回需求那一行：它说的是**怎么排**，跟"要满足什么"不是一类信息，
        混在一起模型会当成验收条件的补充说明读过去。"""
        out = build_page_brief(PAGE, SPEC, product=PRODUCT)
        assert "设计要点：" in out
        # 设计要点那行不该同时含着验收条件的原文
        line = next(l for l in out.splitlines() if l.startswith("设计要点："))
        assert "当药师查询库存时" not in line

    def test_多个节点的要点合并(self):
        spec = {**SPEC, "nodes": [
            {**SPEC["nodes"][0]},
            {"id": "n2", "title": "损耗登记", "acceptance": "x", "notes": "损耗要留影像凭证"},
        ]}
        out = build_page_brief(PAGE, spec, product=PRODUCT)
        assert "列表页提供关键词搜索" in out and "损耗要留影像凭证" in out

    def test_都没有notes就不写那一段(self):
        spec = {"appName": "甲", "nodes": [{"id": "n1", "title": "t", "acceptance": "a"}]}
        out = build_page_brief({"name": "p", "coversNodes": ["n1"]}, spec)
        assert "设计要点：" not in out


class Test假设决定必须进brief:
    """2026-09-03 萌芽成长树：家长模式进了 spec.assumptions，HTML 里 0 次。"""

    def test_家长模式和提醒时间都在(self):
        spec = {
            **SPEC,
            "assumptions": [
                {"id": "a1", "topic": "使用模式", "decision": "家长模式"},
                {"id": "a2", "topic": "提醒时间", "decision": "20:00"},
            ],
        }
        out = build_page_brief(PAGE, spec, product=PRODUCT)
        assert "家长模式" in out
        assert "20:00" in out
        assert "已确认的产品决定" in out
        assert "看得见的界面" in out
        assert "禁止只写在 HTML 注释" in out

    def test_没有assumptions就不写那一段(self):
        out = build_page_brief(PAGE, SPEC, product=PRODUCT)
        assert "已确认的产品决定" not in out
        assert assumption_prompt_block(SPEC) == ""

    def test_脏行不许把整段带崩(self):
        spec = {
            **SPEC,
            "assumptions": [None, "x", {"topic": "", "decision": ""}],
        }
        assert assumption_prompt_block(spec) == ""

    def test_风格段和画页用同一句已确认决定(self):
        """两处各写一段（风格模块不拉 HTML 栈）。漏一侧 = 半边不生效。"""
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        token = "已确认的产品决定（必须做成看得见的界面："
        dl = open(os.path.join(root, "services", "design_language.py"), encoding="utf-8").read()
        sph = open(os.path.join(root, "services", "spec_page_html.py"), encoding="utf-8").read()
        assert token in dl and token in sph


class Test那句各不相同不抄:
    """⚠ **本文件最要紧的一条**——它挡的是"照着参照模板抄全"这个直觉。

    参照模板末尾有「每个页面布局要各不相同。」。看着很对，而且 img_hop2 的
    作者当时也判断它是"按住通用后台网格的关键"。

    但 freeform_block.py 记着一次**实测**：两个完全不同业务的出图提示词逐字
    相同 87%，而"连着三轮实验——删掉版式处方、**加一句「每个页面布局要各不
    相同」**、换掉 brief 口吻——出图骨架都纹丝不动"。

    试过，没用。所以这条用例钉的是**不许把它加回来**：加了不会有任何判据变红，
    只会让人以为治过了。
    """

    def test_没有这句空话(self):
        out = build_page_brief(PAGE, SPEC, product=PRODUCT)
        assert "各不相同" not in out


class Test业务间差异要真的变大:
    """判据得能量出来，不能只说"感觉更具体了"。"""

    def _brief(self, which: str) -> str:
        if which == "药店":
            return build_page_brief(PAGE, SPEC, product=PRODUCT)
        spec = {"appName": "律捷云", "nodes": [
            {"id": "n1", "title": "工时归集",
             "acceptance": "当律师提交工时时，系统应关联案件并计入账单。",
             "notes": "工作台分为计时器、今日工时、待提交三区；支持一键补录"}]}
        return build_page_brief(
            {"name": "工时填报工作台", "audience": "律师", "purpose": "记录并归集工时",
             "coversNodes": ["n1"]},
            spec, product="给律师事务所做一套案件管理与工时计费系统。")

    def test_两个业务的brief差异够大(self):
        import difflib

        a, b = self._brief("药店"), self._brief("律所")
        ratio = difflib.SequenceMatcher(None, a, b).ratio()
        assert ratio < 0.45, f"两个完全不同业务的 brief 还有 {ratio:.0%} 一样"

    def test_brief里随业务变的字数比原来多(self):
        """⚠ 钉个下限，防止哪天有人把产品一句话或设计要点又摘掉——
        摘掉之后不会有别的判据红。"""
        a = self._brief("药店")
        assert len(a) > 90, "brief 太短了，多半是又丢了哪一段"
