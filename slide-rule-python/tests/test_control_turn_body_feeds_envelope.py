"""开始推演把六字段喂进信封。{forcedTool, goal} only 必须 400。

精修之后 session goal 不得被 userText 覆盖。
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    client,
    goal_text,
    KEY,
    CONTROL_URL,
    new_sid,
    seed_approved_session as seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def test_six_fields_forwarded_on_rehearse(harness):
    sid = new_sid("six")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        awaitReason="control_scope",
    )
    skills = [{"id": "datamodel"}, {"id": "page"}]
    _, _events = harness.post(
        six_fields(
            sid,
            "将做成：请假系统",
            forcedTool="rehearse",
            installedSkills=skills,
            activeConnectors=["weather"],
            preferredDevice="desktop",
            designSystemId="ds-brand",
        )
    )
    assert len(harness.helper_calls) == 1
    call = harness.helper_calls[0]
    assert call["session_id"] == sid
    assert call["user_text"] == "将做成：请假系统"
    assert call["installed_skills"] == skills
    assert call["active_connectors"] == ["weather"]
    assert call["preferred_device"] == "desktop"
    assert call["design_system_id"] == "ds-brand"


def test_forced_tool_and_goal_only_is_400(harness):
    sid = new_sid("thin-body")
    seed_session(sid, goal={"text": "请假系统", "status": "clear"})
    response = client.post(
        CONTROL_URL,
        json={"forcedTool": "rehearse", "goal": "请假系统"},
        headers=KEY,
    )
    assert response.status_code == 400
    assert harness.helper_calls == []


def test_missing_session_id_is_400_no_anon_fallback(harness):
    body = six_fields("", "做一个请假系统", forcedTool="rehearse")
    body["sessionId"] = ""
    response = client.post(CONTROL_URL, json=body, headers=KEY)
    assert response.status_code == 400
    assert harness.helper_calls == []


def test_unknown_session_id_is_404_before_sse(harness):
    """未知 ID 与无权访问的会话都在 SSE 前返回 404，helper=0。"""
    sid = new_sid("never-saved")
    response = client.post(
        CONTROL_URL,
        json=six_fields(sid, "做一个请假系统", forcedTool="rehearse"),
        headers=KEY,
    )
    assert response.status_code == 404
    assert harness.helper_calls == []


def test_refine_does_not_overwrite_session_goal(monkeypatch):
    """必须咬工厂 load 到的 state。假 helper 回声 seed 不算。"""
    harness = ControlHarness(monkeypatch, live_factory=True)
    sid = new_sid("refine-goal")
    seed_session(
        sid,
        goal={"text": "请假系统", "status": "clear"},
        modelVersions=[{"id": "v1", "model": {"pages": []}}],
    )
    _, _events = harness.post(
        six_fields(sid, "把提交按钮改成红色", forcedTool="refine")
    )
    assert len(harness.helper_calls) == 1
    assert harness.helper_calls[0]["user_text"] == "把提交按钮改成红色"
    assert harness.goals_at_handoff == ["请假系统"]
    assert harness.driver_goals == ["请假系统"]
    instruction = harness.generator_calls[0]["kwargs"].get("user_instruction", "")
    assert instruction.startswith("把提交按钮改成红色")
    from plan_approval_support import approved_plan_rows

    assert approved_plan_rows()[0]["planContent"] in instruction
    loaded = load_session(sid)
    assert goal_text(loaded) == "请假系统"
