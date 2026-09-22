"""Slash commands express intent; only a reply to a saved plan grants execution."""

import pytest

from control_turn_support import (
    ControlHarness, event_types, llm_text, llm_tool, new_sid,
    seed_approved_session, seed_session, six_fields,
)
from services.rehearsal_control import _restate
from services.scope_authority import plan_execution_authorized
from services.slide_rule_session import load_session


@pytest.mark.parametrize("command", ["/plan", "/计划", "/范围"])
def test_plan_command_revokes_execution_without_reopening_scope(monkeypatch, command):
    harness = ControlHarness(monkeypatch)
    sid = new_sid("plan-command")
    seed_approved_session(sid, goal={"text": "Leave requests", "status": "clear"})
    _, events = harness.post(six_fields(sid, command, forcedTool="enter_plan_mode"))
    state = load_session(sid)
    assert not plan_execution_authorized(state)
    assert state.goal["text"] == "Leave requests"
    # ⚠ 2026-09-15：日志里现在还会跟一行 `tool_result`（上游「工具事件写入
    #   会话日志」那一笔），所以 `[-1]` 不再是 plan_entered——但那只是**位置**变了。
    #   要钉的性质是「计划生命周期上最后发生的是进入计划模式」，
    #   按 plan_* 这一族过滤再看末尾，比单纯断言「存在」更强：
    #   后面若又冒出 plan_approved 把执行权发回去，这条当场红。
    plan_rows = [r["kind"] for r in state.controlTranscript
                 if str(r.get("kind", "")).startswith("plan_")]
    assert plan_rows[-1] == "plan_entered", plan_rows
    assert not harness.helper_calls
    assert "control_scope_card" not in event_types(events)


@pytest.mark.parametrize("text,forced", [
    ("/推演 请假系统", None),
    ("做一个请假系统", "rehearse"),
    ("/推演", None),
    ("你好", None),
])
def test_commands_and_real_topics_do_not_grant_approval(monkeypatch, text, forced):
    harness = ControlHarness(monkeypatch)
    sid = new_sid("plan-required")
    seed_session(sid)
    harness.llm_impl = lambda *a, **kw: llm_text("Planning")
    _, events = harness.post(six_fields(sid, text, **({"forcedTool": forced} if forced else {})))
    assert not harness.helper_calls
    assert not plan_execution_authorized(load_session(sid))
    assert "control_scope_card" not in event_types(events)
    assert "control_handoff_factory" not in event_types(events)


def test_original_topic_is_saved_before_approved_factory_starts(monkeypatch):
    harness = ControlHarness(monkeypatch, live_factory=True)
    sid = new_sid("plan-topic")
    seed_session(sid)
    calls = iter([
        llm_tool("write_plan", {"planContent": "Build leave requests with manager approval."}),
        llm_tool("exit_plan_mode", {}),
    ])
    harness.llm_impl = lambda *a, **kw: next(calls)
    _, events = harness.post(six_fields(sid, "请假系统"))
    request = next(event for event in events if event["type"] == "control_plan_approval")
    assert not harness.helper_calls
    calls = iter([llm_tool("spec", {}), llm_text("Done")])
    harness.llm_impl = lambda *a, **kw: next(calls)
    harness.post(six_fields(sid, "Approve", toolAnswer={
        "kind": "plan_approval", "reqId": request["reqId"], "outcome": "approved",
    }))
    assert harness.goals_at_handoff == ["请假系统"]
    assert harness.driver_goals == ["请假系统"]


def test_slash_tokens_are_never_product_topics():
    assert _restate("/范围") == ""
    assert _restate("/推演") == ""
    assert _restate("/范围 考勤") == "考勤"
