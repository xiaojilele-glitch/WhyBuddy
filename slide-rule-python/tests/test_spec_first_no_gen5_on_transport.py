# -*- coding: utf-8 -*-
"""525 / JSON parse / 结构闸臆造不许把整条 spec-first 打回 GEN5。

我们只补过「当前页空时去版本史找旧页」。咖啡馆首轮 spec 步撞 parse/525，
宽 except 整条回落 GEN5，mv-1「页面：无」，版本史也空，第一轮精修只能全量。

2026-08-18 咖啡馆 10 轮 R5/R10：结构闸说「所需积分」是臆造的，病根换了，
症状没换——GEN5 记新版本，页还是上一轮。传输词拦不住它。

要堵的是外圈回落，不是再削版本史。删掉 `_block_gen5` 那一针，下面必红。
再试成功却把模型扔掉（`model = None` 写在 except 外）也必须红。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from services.v5_capability_executor import (  # noqa: E402
    spec_first_failure_blocks_gen5,
)
from sliderule_llm.gateway_circuit import reset_gateway_circuit  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_gateway_circuit():
    reset_gateway_circuit()
    yield
    reset_gateway_circuit()


class Test哪些错不许回落:
    def test_parse和525要拦住(self):
        assert spec_first_failure_blocks_gen5(
            RuntimeError("LLM JSON parse failed: not-json")
        )
        assert spec_first_failure_blocks_gen5(
            RuntimeError("spec 生成失败：upstream 525: ssl handshake")
        )
        assert spec_first_failure_blocks_gen5(
            RuntimeError("ConnectTimeout: connection timed out")
        )

    def test_结构闸臆造也要拦住(self):
        assert spec_first_failure_blocks_gen5(
            RuntimeError(
                "结构反推失败（重问 2 次后）："
                "entities[drink].fields[points_required]："
                "evidence「所需积分」在任何一份 HTML 里都找不到——这是臆造的"
            )
        )

    def test_第3步交白卷仍回落(self):
        """别的故障还走老路，enrich 那组反向保险不能被误伤。"""
        assert not spec_first_failure_blocks_gen5(
            RuntimeError("第 3 步一页都没出来：p1 画挂了")
        )

    def test_开关关掉退回一律回落(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_SPEC_FIRST_NO_GEN5_ON_TRANSPORT", "0")
        assert not spec_first_failure_blocks_gen5(
            RuntimeError("LLM JSON parse failed: x")
        )
        assert not spec_first_failure_blocks_gen5(
            RuntimeError("结构反推失败（重问 2 次后）：这是臆造的")
        )


class Test接线_执行器:
    """纪律一：必须跑 _try_llm_generate_evidence，只测分类函数会假绿。"""

    def _drive(self, monkeypatch, *, spec_fn, gen5_fn=None, gate_fn=None):
        from services import v5_capability_executor as ex
        from services.v5_llm_generate import set_refine_context

        seen = {"gen5": 0, "model": None}

        def fake_gen5(*a, **k):
            seen["gen5"] += 1
            return (gen5_fn() if gen5_fn else {"page": {"pages": []}})

        def fake_link(m, g):
            seen["model"] = m
            return []

        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")
        monkeypatch.setattr("services.spec_first_pipeline.run_spec_first", spec_fn)
        monkeypatch.setattr(
            "services.v5_llm_generate.generate_five_system_model", fake_gen5
        )
        monkeypatch.setattr(
            "services.v5_model_repair.repair_five_system_model",
            lambda m: {"model": m},
        )
        monkeypatch.setattr(
            "services.v5_model_gate.validate_five_system_model",
            gate_fn or (lambda *a, **k: {"passed": True}),
        )
        monkeypatch.setattr(
            "services.device_policy.normalize_model_preferred_device",
            lambda g, m: m,
        )
        monkeypatch.setattr(
            "services.v5_llm_generate.model_to_linkage_artifacts",
            fake_link,
        )
        set_refine_context(None)
        try:
            ex._try_llm_generate_evidence("做个工单系统", None)
        finally:
            set_refine_context(None)
        return seen

    def test_525再试成功不走GEN5(self, monkeypatch):
        hits = {"n": 0}

        def flaky(*a, **k):
            hits["n"] += 1
            if hits["n"] == 1:
                raise RuntimeError("upstream 525: ssl handshake failed")
            return {"model": {"page": {"pages": [{"id": "p1", "name": "工单页"}]}}}

        seen = self._drive(monkeypatch, spec_fn=flaky)
        assert hits["n"] == 2, "525 之后没整条再试"
        assert seen["gen5"] == 0, "再试成功了还是打回 GEN5——首轮又会无页"
        assert (seen["model"] or {}).get("page", {}).get("pages"), (
            "再试成功了却把模型扔掉——外面看起来像失败，"
            "gen5==0 照样绿（纪律三）"
        )

    def test_parse两次都失败不走GEN5(self, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("LLM JSON parse failed: trailing junk")

        seen = self._drive(monkeypatch, spec_fn=boom)
        assert seen["gen5"] == 0, (
            "parse 仍打回 GEN5——咖啡馆首轮「页面：无」会再来"
        )

    def test_第3步交白卷也不走GEN5(self, monkeypatch):
        """篮球馆 / 咖啡馆：结构闸以外的失败打回 GEN5 = 版本涨了页还是空的。"""
        def boom(*a, **k):
            raise RuntimeError("第 3 步一页都没出来：p1 画挂了")

        seen = self._drive(monkeypatch, spec_fn=boom)
        assert seen["gen5"] == 0, (
            "第 3 步交白卷仍打回 GEN5——首轮会交一份没页的 6/6"
        )

    def test_熔断开了不再整条再试(self, monkeypatch):
        """过夜物业 R6：525 过密时整条再试 = 自己喂自己。"""
        from sliderule_llm.client import LlmError
        from sliderule_llm.gateway_circuit import note_failure

        note_failure(LlmError("upstream 525:", status=525, transient=True))
        note_failure(LlmError("upstream 525:", status=525, transient=True))
        hits = {"n": 0}

        def boom(*a, **k):
            hits["n"] += 1
            raise RuntimeError("spec 生成失败（重问 2 次后）：LLM 调用失败（HTTP 525 · 可重试）：upstream 525:")

        seen = self._drive(monkeypatch, spec_fn=boom)
        assert hits["n"] == 1, (
            f"熔断已开还整条再试了 {hits['n']} 次——525 过密的入口"
        )
        assert seen["gen5"] == 0, "熔断后再试被跳过，却仍打回 GEN5"

    def test_spec_first交卷但v5闸拦了也不GEN5(self, monkeypatch):
        """第二条插座：模型出来了、过不了 v5 结构闸，也不许整包打回 GEN5。"""
        hits = {"n": 0}

        def fake_spec(*a, **k):
            hits["n"] += 1
            return {"model": {"page": {"pages": [{"id": "p1"}]}}}

        def fake_gate(*a, **k):
            return {
                "passed": False,
                "findings": [{"path": "page", "message": "缺落地页", "affectedSkill": "page"}],
            }

        monkeypatch.setattr(
            "services.v5_parallel_generate.regenerate_failed_sections",
            lambda *a, **k: None,
        )
        seen = self._drive(monkeypatch, spec_fn=fake_spec, gate_fn=fake_gate)
        assert hits["n"] == 1
        assert seen["gen5"] == 0, "spec-first 未过闸仍整包 GEN5"

    def test_结构闸失败不再试也不走GEN5(self, monkeypatch):
        """咖啡馆 R5：结构闸已经重问尽，整条再试只会再撞同一道闸。"""
        hits = {"n": 0}

        def boom(*a, **k):
            hits["n"] += 1
            raise RuntimeError(
                "结构反推失败（重问 2 次后）："
                "entities[drink].fields[points_required]："
                "evidence「所需积分」在任何一份 HTML 里都找不到——这是臆造的"
            )

        seen = self._drive(monkeypatch, spec_fn=boom)
        assert hits["n"] == 1, f"结构闸失败还整条再试了 {hits['n']} 次"
        assert seen["gen5"] == 0, "结构闸失败仍打回 GEN5——版本涨了页还是旧的"


class Test精修失败版本不涨页不旧:
    """过夜物业 R6 + 咖啡馆 10 轮 R5 的用户可见形状。

    只测 _try_llm_generate_evidence 会假绿：GEN5 没走，但
    _build_per_skill_evidence 仍可能记一份「沿用state」快照。
    删掉 `_block_gen5` 那一针，下面必红。
    """

    SECTIONS = ("datamodel", "rbac", "workflow", "page", "aigc", "appbundle")

    def _prev(self):
        return {s: {"id": s, "tag": "mv-5"} for s in self.SECTIONS}

    def _pages(self):
        return {
            "version": "spec-first-pipeline-v1",
            "pages": {"p1": "<html>报修台-旧</html>", "p2": "<html>工单页-旧</html>"},
        }

    def _drive(self, monkeypatch, boom_msg: str):
        from models.v5_state import V5SessionState
        from services.v5_capability_executor import _build_per_skill_evidence
        from services.v5_llm_generate import set_refine_context

        seen = {"gen5": 0}
        prev = self._prev()
        pages = self._pages()

        def boom(*a, **k):
            raise RuntimeError(boom_msg)

        def fake_gen5(*a, **k):
            seen["gen5"] += 1
            return {s: {"id": s, "tag": "gen5-stale"} for s in self.SECTIONS}

        monkeypatch.setenv("SLIDERULE_SPEC_FIRST", "1")
        monkeypatch.setattr("services.spec_first_pipeline.run_spec_first", boom)
        monkeypatch.setattr(
            "services.v5_llm_generate.generate_five_system_model", fake_gen5
        )
        monkeypatch.setattr(
            "services.v5_model_repair.repair_five_system_model",
            lambda m: {"model": m},
        )
        monkeypatch.setattr(
            "services.v5_model_gate.validate_five_system_model",
            lambda *a, **k: {"passed": True},
        )
        monkeypatch.setattr(
            "services.device_policy.normalize_model_preferred_device",
            lambda g, m: m,
        )
        monkeypatch.setattr(
            "services.v5_llm_generate.model_to_linkage_artifacts",
            lambda m, g: [
                {
                    "id": f"llm-linkage-{s}",
                    "_model_section": (m.get(s) if isinstance(m, dict) else None)
                    or {"id": s},
                }
                for s in self.SECTIONS
            ],
        )
        monkeypatch.setattr(
            "services.freeform_block.enrich_freeform_blocks", lambda m: m
        )
        monkeypatch.setattr(
            "services.freeform_block.enrich_monitor_page_overviews",
            lambda m, preview_sink=None: m,
        )

        st = V5SessionState(
            sessionId="sr-物业R6",
            goal={"text": "物业报修工单", "status": "clear"},
            ownerId="u-1",
        )
        st.lastTurnId = "turn-11"
        st.specFirstPages = pages
        st.modelVersions = [
            {
                "id": "mv-5",
                "turnId": "turn-9",
                "instruction": "上一轮",
                "model": prev,
                "specFirstPages": pages,
            }
        ]
        st.currentModelVersionId = "mv-5"

        set_refine_context(prev, "报修台给超时工单加红标")
        try:
            _build_per_skill_evidence(st, blocked_signal=False, goal=st.goal["text"])
        finally:
            set_refine_context(None)
        return seen, st, pages

    def test_精修撞525_不GEN5_不追加版本(self, monkeypatch):
        seen, st, pages = self._drive(
            monkeypatch,
            "spec 生成失败（重问 2 次后）："
            "LLM 调用失败（HTTP 525 · 可重试）：upstream 525:",
        )
        assert seen["gen5"] == 0, (
            "精修 525 仍走 GEN5——过夜就是回落老链路然后页面：沿用state"
        )
        assert [v["id"] for v in st.modelVersions] == ["mv-5"], (
            f"版本涨了：{[v['id'] for v in st.modelVersions]}。"
            "GEN5 配旧页就是「版本涨了页还是旧的」"
        )
        assert st.currentModelVersionId == "mv-5"
        assert st.specFirstPages == pages, "预览页被换成别的或清空了"

    def test_精修撞结构闸_不GEN5_不追加版本(self, monkeypatch):
        """咖啡馆 10 轮 R5：病根是结构闸，症状跟 525 回落一模一样。"""
        seen, st, pages = self._drive(
            monkeypatch,
            "结构反推失败（重问 2 次后）："
            "entities[drink].fields[points_required]："
            "evidence「所需积分」在任何一份 HTML 里都找不到——这是臆造的",
        )
        assert seen["gen5"] == 0, (
            "精修结构闸仍走 GEN5——版本涨了页还是旧的"
        )
        assert [v["id"] for v in st.modelVersions] == ["mv-5"], (
            f"版本涨了：{[v['id'] for v in st.modelVersions]}"
        )
        assert st.currentModelVersionId == "mv-5"
        assert st.specFirstPages == pages

    def test_精修第3步交白卷_不GEN5_对话写没画上(self, monkeypatch):
        from services.v5_capability_executor import (
            _diagnostic,
            refine_paint_note_from_diagnostic,
        )

        seen, st, pages = self._drive(
            monkeypatch, "第 3 步一页都没出来：p1 画挂了"
        )
        assert seen["gen5"] == 0
        assert [v["id"] for v in st.modelVersions] == ["mv-5"]
        assert st.specFirstPages == pages
        assert _diagnostic().get("code") == "REFINE_PAINT_FAILED"
        note = refine_paint_note_from_diagnostic()
        assert note.startswith("这一处没画上："), note
        assert "第 3 步" in note or "画挂" in note
