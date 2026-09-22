"""rehearse/forcedTool must hit the envelope helper.

Reverse: delete `start_drive_full_factory_run` from `_handoff_factory` → red.
Bare `drive_full_v5_session_stream` in rehearsal_control does NOT count as live.
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    PY_ROOT,
    ROOT,
    ControlHarness,
    event_types,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
    strip_python,
)

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_m1_header_has_every_clause():
    header = (PY_ROOT / "services" / "rehearsal_control.py").read_text(
        encoding="utf-8"
    ).split('from __future__')[0]
    for needle in (
        "POST /api/sliderule/control-turn-stream",
        "No Node twin",
        "control_handoff_factory",
        "control_ask",
        "control_plan_approval",
        "controlTranscript",
        "Cheap turns write only controlTranscript",
        "inspect_model",
        "8 tool rounds",
        "8k cheap tokens",
        "45s",
        "停在控制面，未点火",
        "我是面团的推演引擎",
        "envelope helper",
        "session_id",
        "six fields",
        '{forcedTool, goal}',
        "forcedTool rehearse",
        "does NOT exit the tool loop",
        "ask_user_question, search_evidence, inspect_model",
        "enter_plan_mode, write_plan, exit_plan_mode",
        "No tool may write blocked=false",
    ):
        assert needle in header, f"M1 header missing clause fragment: {needle}"


def test_forced_rehearse_hits_helper_not_bare_generator(harness):
    sid = new_sid("rehearse")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
        awaitDetail="请假系统",
    )
    _, events = harness.post(
        six_fields(sid, "将做成：请假系统", forcedTool="rehearse")
    )
    assert len(harness.helper_calls) == 1, (
        "删掉 _handoff_factory 里的 helper 调用点，这条必须红。"
        "直接 async-for 裸生成器不算通电。"
    )
    call = harness.helper_calls[0]
    assert call["session_id"] == sid
    assert call["user_text"] == "将做成：请假系统"
    assert call.get("profile") == "app"
    assert "control_handoff_factory" in event_types(events)
    run_ids = [e.get("runId") for e in events if e.get("type") == "control_handoff_factory"]
    assert run_ids and run_ids[0]
    assert harness.generator_calls == []


def test_comment_stripped_dispatcher_must_not_call_generator_directly():
    stripped = strip_python(PY_ROOT / "services" / "rehearsal_control.py")
    assert "start_drive_full_factory_run" in stripped
    assert "drive_full_v5_session_stream" not in stripped
    assert "v5_capability_executor" not in stripped
    assert "driveReasoningSession" not in stripped


def test_factory_client_payload_must_not_grow_tools():
    """Q1=A：tools 只活在 control_client。"""
    factory = strip_python(PY_ROOT / "sliderule_llm" / "client.py")
    # 剥掉文档串后再看 _chat_payload 函数体。
    start = factory.find("def _chat_payload")
    end = factory.find("def _responses_payload")
    body = factory[start:end]
    assert "tools" not in body
    control = strip_python(PY_ROOT / "sliderule_llm" / "control_client.py")
    assert "tools" in control
    assert "_control_chat_payload" in control


def test_route_is_python_only_no_node_twin():
    routes = (PY_ROOT / "routes" / "sliderule_full.py").read_text(encoding="utf-8")
    assert '@router.post("/control-turn-stream")' in routes
    handler = routes.split("async def control_turn_stream")[1][:800]
    assert "_require_login(viewer)" in handler
    node_src = (ROOT / "server" / "routes" / "sliderule.ts").read_text(
        encoding="utf-8"
    )
    # catch-all 转发可以存在；禁止再写一份 Node 业务实现。
    assert "run_control_turn" not in node_src
    assert "controlTurnStream" not in node_src
    assert 'router.post("/control-turn-stream"' not in node_src
    assert "router.post('/control-turn-stream'" not in node_src
