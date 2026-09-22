# -*- coding: utf-8 -*-
"""增量迭代接到 spec-first（2026-08-14 晚）。

## 病灶

E29 精修上下文（上一版模型 + 本轮追加指令）只有**老生成器**的 prompt 在读
（v5_llm_generate._build_user_content 的 REFINE MODE 段），而默认路径是
spec-first——于是「建好应用后再发消息迭代」实际是拿冻结的原始 goal 从头
重抽一次：追加指令没进 prompt、上一版结构全被丢掉，且没有一处报错。

## 这组测试钉四段接线

    v5_full_driver.set_refine_context      （已有，不动）
    v5_capability_executor                 refine 上下文 → 翻成 spec_tree 的词
    spec_first_pipeline.run_spec_first     refine 透传到第 2 步
    spec_tree.build_spec_prompt            指令 + 摘要 + 连续性约束真进了 prompt

顺手钉住的第二个洞：模型直供（版本回退/fork 的 set_model_override）在场时
spec-first 必须**让路**——否则「回退到 v2」被静默变成「按原话重抽」。
"""

import pytest

from services import spec_first_pipeline as sfp
from services.spec_tree import build_spec_prompt


MODEL = {
    "datamodel": {"entities": [
        {"id": "order", "name": "订单", "fields": [
            {"id": "amount", "name": "金额"}, {"id": "status", "name": "状态"},
        ]},
    ]},
    "page": {"pages": [{"id": "p1", "name": "订单页"}, {"id": "p2", "name": "报表页"}]},
    "rbac": {"roles": ["店长", "店员"]},
    "workflow": {"nodes": [{"id": "submit", "name": "提交"}, {"id": "approve", "name": "审批"}]},
}


class Test模型摘要:
    def test_摘要含实体字段页面角色流程(self):
        d = sfp.model_refine_digest(MODEL)
        for word in ["订单", "金额", "订单页", "报表页", "店长", "审批"]:
            assert word in d, f"摘要里少了「{word}」——SPEC 步保不住这一段的连续性"

    def test_非模型输入返回空串(self):
        assert sfp.model_refine_digest(None) == ""
        assert sfp.model_refine_digest("不是字典") == ""  # type: ignore[arg-type]

    def test_摘要是摘要_不是全量JSON(self):
        """粒度对齐 SPEC：全量 JSON 里的绑定/主题细节不该出现。"""
        big = dict(MODEL)
        big["appbundle"] = {"themeToken": "深蓝夜色", "pageBindings": []}
        d = sfp.model_refine_digest(big)
        assert "深蓝夜色" not in d
        assert len(d) <= 4000


class TestSPEC提示词:
    def test_refine在场时_指令与摘要与连续性约束都进prompt(self):
        msgs = build_spec_prompt(
            "做一个订单管理系统",
            refine={"instruction": "加一个客户投诉页", "modelDigest": "实体：订单（金额）"},
        )
        user = msgs[-1]["content"]
        assert "加一个客户投诉页" in user
        assert "实体：订单（金额）" in user
        assert "连续性硬要求" in user, "没有连续性约束——重生成会把整个应用换一套设计"

    def test_refine缺席时_prompt与从前逐字一致(self):
        assert build_spec_prompt("做一个订单管理系统") == build_spec_prompt(
            "做一个订单管理系统", refine=None
        )
        # 空指令等于没有 refine——不许给 LLM 一个空的迭代段
        assert build_spec_prompt("做一个订单管理系统") == build_spec_prompt(
            "做一个订单管理系统", refine={"instruction": "", "modelDigest": "x"}
        )


class Test管道透传:
    def test_run_spec_first把refine交给第2步(self, monkeypatch):
        seen = {}

        def _capture(goal, **kw):
            seen["refine"] = kw.get("refine")
            raise sfp.SpecFirstError("捕获即止")

        monkeypatch.setattr("services.spec_tree.generate_spec_tree", _capture)
        with pytest.raises(sfp.SpecFirstError):
            sfp.run_spec_first("话题", refine={"instruction": "加页", "modelDigest": "d"})
        assert seen["refine"] == {"instruction": "加页", "modelDigest": "d"}


class Test执行器接线:
    def _run(self, monkeypatch, captured):
        """跑 _try_llm_generate_evidence 到 run_spec_first 被叫为止。

        stub 捕获实参后抛异常——这条测试只管接线，不需要往下过闸；
        老路也 stub 成返回 None，函数会如实报 LLM_GENERATE_FAILED 收场。
        """
        from services import v5_capability_executor as ex

        def fake_run(goal, **kw):
            captured["goal"] = goal
            captured["refine"] = kw.get("refine")
            raise RuntimeError("捕获即止")

        monkeypatch.setattr("services.spec_first_pipeline.run_spec_first", fake_run)
        monkeypatch.setattr(
            "services.v5_llm_generate.generate_five_system_model",
            lambda *a, **k: None,
        )
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")
        return ex._try_llm_generate_evidence("原始话题", None)

    def test_精修上下文在场时_spec_first收到指令和摘要(self, monkeypatch):
        from services.v5_llm_generate import set_refine_context

        set_refine_context(MODEL, "加一个客户投诉页")
        try:
            captured: dict = {}
            self._run(monkeypatch, captured)
            assert captured["refine"] is not None, "refine 上下文没进 spec-first——迭代又变成重抽"
            assert captured["refine"]["instruction"] == "加一个客户投诉页"
            assert "订单" in captured["refine"]["modelDigest"]
        finally:
            set_refine_context(None)

    def test_没有精修上下文时_refine为None(self, monkeypatch):
        from services.v5_llm_generate import set_refine_context

        set_refine_context(None)
        captured: dict = {}
        self._run(monkeypatch, captured)
        assert captured["refine"] is None

    def test_没有state全局时_run_spec_first仍被叫到(self, monkeypatch):
        """2026-08-31 真机（固定资产领用）：`_invoke_spec_first` 写了
        `state.goal`，而 `_try_llm_generate_evidence` 没有 `state` 形参。
        NameError 被宽 except 吃成「spec-first 失败，不回落老链路」，
        `run_spec_first` 一次都没进，五系统全空。把那行改回去，这条必须红。"""
        captured: dict = {}
        self._run(monkeypatch, captured)
        assert "goal" in captured, (
            "run_spec_first 没被叫到——又在吞 NameError"
            "（真机日志：name 'state' is not defined）"
        )

    def test_tools与原型从形参传到spec_first(self, monkeypatch):
        from services import v5_capability_executor as ex

        captured: dict = {}

        def fake_run(goal, **kw):
            captured["tools"] = kw.get("tools")
            captured["product_archetype"] = kw.get("product_archetype")
            captured["workflow"] = kw.get("workflow")
            raise RuntimeError("捕获即止")

        monkeypatch.setattr("services.spec_first_pipeline.run_spec_first", fake_run)
        monkeypatch.setattr(
            "services.v5_llm_generate.generate_five_system_model",
            lambda *a, **k: None,
        )
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")
        ex._try_llm_generate_evidence(
            "原始话题",
            None,
            tools=["spec", "pages"],
            product_archetype="business_app",
            workflow="pages-preview",
        )
        assert captured.get("tools") == ["spec", "pages"], (
            "tools 没传到 run_spec_first——计划减工具在生成侧又是空插座"
        )
        assert captured.get("product_archetype") == "business_app"
        assert captured.get("workflow") == "pages-preview", (
            "workflow 没传到 run_spec_first——按名字选日历又是空插座"
        )

    def test_模型直供在场时_spec_first让路(self, monkeypatch):
        """版本回退/fork 直供：快照是权威。spec-first 不让路的话，
        「回退到 v2」被静默变成「按原话重抽一次」。"""
        from services.v5_llm_generate import set_model_override

        set_model_override(MODEL)
        try:
            captured: dict = {}
            self._run(monkeypatch, captured)
            assert "goal" not in captured, "直供在场 spec-first 还在跑——回退被变成重抽"
        finally:
            set_model_override(None)
