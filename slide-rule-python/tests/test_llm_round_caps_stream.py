"""每一步 LLM 实时想法流（轮内能力真 LLM 化 + 带标签 llm_delta）。

覆盖：
  (a) 未配置 LLM 通道（无 key、无强制开关）→ 轮内能力走确定性 RAG 路径不变；
  (b) 开启后原生能力走 sliderule_llm 真 LLM；LlmError 回落确定性路径，
      一步失败不沉整场推演；
  (c) 流式驱动：轮内能力执行期间发出的增量以带 label 的 llm_delta 事件
      实时冲到 SSE 流里（不是等闭环阶段才有输出）；流结束后 sink 已注销。
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services.slide_rule_coverage import author_coverage_contract  # noqa: E402

GOAL = "做一个宠物医院预约管理系统，包含预约排班、宠物档案和医生工作台"


def _seeded_state(session_id: str) -> V5SessionState:
    state = V5SessionState(sessionId=session_id, goal={"text": GOAL}, artifacts=[])
    authored = author_coverage_contract(GOAL, "turn-1")
    state.coverageContract = authored["contract"]
    state.coverageGaps = authored["gaps"]
    return state


@pytest.fixture()
def driver(monkeypatch, tmp_path):
    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("SLIDERULE_LLM_ROUND_CAPS", raising=False)
    import services.v5_full_driver as driver_mod

    # ⚠ 2026-08-27：PR-8(M14) 起 persist_state 必须返回 {"ok": True} 的 dict，
    #   否则能力结束落 pendingRuns 判为写失败并 fail-closed 中止本轮。
    #   `lambda s: s` 会让驱动器跑完第一个能力就退出。
    monkeypatch.setattr(driver_mod, "persist_state", lambda s: {"ok": True})
    return driver_mod


def test_no_llm_channel_round_caps_stay_deterministic(driver, monkeypatch):
    """无 key 且无强制开关：_execute_round_capability 必须走确定性执行器。"""
    assert driver._llm_round_caps_enabled() is False

    sentinel = {"title": "rag", "summary": "s", "content": "c", "provenance": "python-rag"}
    calls = []

    def fake_rag(cap, state, input_ids, role, turn_id):
        calls.append(cap)
        return sentinel

    monkeypatch.setattr(driver, "execute_v5_capability", fake_rag)
    result = driver._execute_round_capability("risk.analyze", _seeded_state("rc-off"), "agent", "loop-0")
    assert result is sentinel and calls == ["risk.analyze"]


def test_forced_flag_uses_native_llm_and_falls_back_on_error(driver, monkeypatch):
    """SLIDERULE_LLM_ROUND_CAPS=1：原生能力走真 LLM；LlmError 回落 RAG。"""
    monkeypatch.setenv("SLIDERULE_LLM_ROUND_CAPS", "1")
    assert driver._llm_round_caps_enabled() is True

    from sliderule_llm import capabilities as caps
    from sliderule_llm.client import LlmError

    native = {"title": "llm", "summary": "s", "content": "real thoughts", "provenance": "python-llm"}
    monkeypatch.setattr(caps, "execute_capability", lambda body, **kw: native)
    result = driver._execute_round_capability("risk.analyze", _seeded_state("rc-on"), "agent", "loop-0")
    assert result is native

    # LlmError → 回落确定性路径，异常不外泄
    def boom(body, **kw):
        raise LlmError("rate limited", transient=True)

    rag = {"title": "rag", "summary": "s", "content": "c", "provenance": "python-rag"}
    monkeypatch.setattr(caps, "execute_capability", boom)
    monkeypatch.setattr(driver, "execute_v5_capability", lambda *a: rag)
    result = driver._execute_round_capability("risk.analyze", _seeded_state("rc-err"), "agent", "loop-0")
    assert result is rag

    # 非原生能力（如 appbundle.runtimeClosure）直接走确定性路径
    monkeypatch.setattr(caps, "execute_capability", lambda body, **kw: (_ for _ in ()).throw(AssertionError("must not be called")))
    result = driver._execute_round_capability("appbundle.runtimeClosure", _seeded_state("rc-nonnative"), "agent", "loop-0")
    assert result is rag


@pytest.mark.parametrize("parallel", [True, False])
def test_stream_emits_labeled_llm_delta_during_rounds(driver, monkeypatch, parallel):
    """轮内执行期间，能力的 LLM 增量以带 label 的 llm_delta 冲到 SSE 流。"""
    monkeypatch.setenv("SLIDERULE_LLM_ROUND_CAPS", "1")
    monkeypatch.setenv("SLIDERULE_PARALLEL_CAPS", "true" if parallel else "false")

    from sliderule_llm import capabilities as caps

    def fake_native(body, **kw):
        cap = body["capabilityId"]
        emitter = caps._delta_emitter(cap)
        assert emitter is not None, "driver must register the capability delta sink for the whole stream"
        emitter(f"thinking about {cap} ")
        emitter("...")
        return {"title": cap, "summary": f"{cap} done", "content": f"thoughts for {cap}", "provenance": "python-llm"}

    monkeypatch.setattr(caps, "execute_capability", fake_native)

    async def _collect():
        events = []
        async for ev in driver.drive_full_v5_session_stream(
            _seeded_state(f"rc-stream-{parallel}"), max_loops=1, user_instruction=GOAL
        ):
            events.append(ev)
        return events

    events = asyncio.run(_collect())

    step_labels = {e["label"] for e in events if e["type"] == "reasoning_step"}
    delta_labels = [e.get("label") for e in events if e["type"] == "llm_delta"]
    native_delta_labels = {l for l in delta_labels if l and l != "five-system-model"}
    assert native_delta_labels, "round-cap LLM deltas must reach the stream"
    assert native_delta_labels <= step_labels
    # 每个 llm_delta 都带 label（前端靠它分缓冲、起标题）
    assert all(l for l in delta_labels)
    # 增量在该能力的结果事件之前到达（真·实时，不是事后补发）
    #
    # 2026-08-04：排掉 planning 那一对（新加的选材可见性事件）。它在能力开跑
    # **之前**就结束了，本来就该排在所有增量前面。这条要钉的是"某个能力的增量
    # 早于**那个能力**的结果"，不是"早于流里任何一个结果"。
    first_delta = next(i for i, e in enumerate(events) if e["type"] == "llm_delta")
    first_result = next(
        i for i, e in enumerate(events)
        if e["type"] == "reasoning_step_result" and e.get("label") != "planning"
    )
    assert first_delta < first_result
    # 流结束后模块级 sink 已注销
    assert caps._delta_sink_var.get() is None
