"""Declared WRITE permissions require a persisted approval of the current plan."""
from __future__ import annotations

import asyncio
from contextlib import contextmanager

import pytest

from control_turn_support import ControlHarness, event_types, new_sid, seed_session, seed_approved_session, six_fields
from models.v5_state import V5SessionState
from plan_approval_support import approved_plan_rows
from services import rehearsal_control as control

# 旧 HTML 链那批写工具。
_HTML_WRITERS = {"rehearse", "workflow", "spec", "pages", "structure", "bind", "closure", "refine", "repair", "challenge", "restore_version", "fork_variant"}
# ⚠ 2026-09-15 补：工程档的写工具进 CLOSED_TOOLS 之后，它们同样要过审批。
#   这是**更严**的一侧——`project_patch` 能改用户源码、`project_exec` 能在沙盒里
#   跑命令、`project_restore` 能回滚版本，没有已批准的计划就不许动。
#   判据原来只列 HTML 那批，工程档整批写工具在闸外面还没人发现。
#   （只读的 project_read / project_list / project_status… 不在这里，本来就不该要审批。）
_PROJECT_WRITERS = {
    "project_create", "project_start", "project_patch", "project_write",
    "project_str_replace", "file_write", "file_str_replace",
    "write_file", "search_replace",
    "shell_exec", "bash", "deploy_expose_port", "deploy_apply_deployment",
    "browser_navigate", "browser_restart",
    "project_exec", "project_verify", "project_restore",
}
WRITERS = _HTML_WRITERS | _PROJECT_WRITERS


def test_all_mutating_tools_declare_permission():
    assert {name for name in control.CLOSED_TOOLS if control.tool_requires_permission(name)} == WRITERS
    assert set(control.TOOL_PERMISSION) <= set(control.CLOSED_TOOLS)


@pytest.mark.parametrize("name", ["ask_user_question", "enter_plan_mode", "write_plan", "exit_plan_mode", "search_evidence", "inspect_model"])
def test_interview_and_plan_tools_need_no_execution_approval(name):
    state = V5SessionState(sessionId="planning", goal={"text": "inventory app"})
    assert not control.tool_requires_permission(name)
    assert control.tool_permission_granted(name, state)


@contextmanager
def project_tools_enabled(name):
    """工程工具需要**工具集先挂上**，否则 `tool_permission_granted` 第一步的
    `_project_tool_error` 就先报 `project_tools_not_enabled` 回来。

    ⚠ 不挂就判，等于判据自己喂了一个产线不会出现的载荷：计划审批那一支
      一次都没被走到，而判据看着是绿的（§一之二）。HTML 那批不受影响，
      所以只在工程工具上挂。
    """
    if name not in _PROJECT_WRITERS:
        yield
        return
    token = control._PROJECT_TOOLS.set(object())
    try:
        yield
    finally:
        control._PROJECT_TOOLS.reset(token)


@pytest.mark.parametrize("name", sorted(WRITERS))
def test_only_current_persisted_plan_grants_write(name):
    with project_tools_enabled(name):
        _only_current_persisted_plan_grants_write(name)


def _only_current_persisted_plan_grants_write(name):
    state = V5SessionState(sessionId="permission", goal={"text": "inventory app"})
    assert not control.tool_permission_granted(name, state)
    state.controlTranscript = [{"kind": "scope_confirmed"}]
    assert not control.tool_permission_granted(name, state)
    state.controlTranscript = approved_plan_rows()[:2]
    state.awaitReason = "control_plan_approval"
    assert not control.tool_permission_granted(name, state)
    state.controlTranscript = approved_plan_rows()
    state.awaitReason = None
    if name == "refine":
        state.modelVersions = [{"id": "v1", "model": {"pages": []}}]
    assert control.tool_permission_granted(name, state)
    state.controlTranscript.append({"kind": "plan_entered"})
    assert not control.tool_permission_granted(name, state)


def _dispatch(name, state):
    async def run():
        return [event async for event in control._dispatch_tool(name, {}, state, "continue", [], [], "desktop", None, "inventory app")]
    return asyncio.run(run())


@pytest.mark.parametrize("name", sorted(_HTML_WRITERS))
def test_dispatch_rejects_write_before_started(name):
    state = V5SessionState(sessionId="denied", goal={"text": "inventory app"})
    assert _dispatch(name, state) == [
        {"type": "control_tool_result", "tool": name, "ok": False, "error": "plan_approval_required"}
    ]


@pytest.mark.parametrize("name", sorted(_PROJECT_WRITERS))
def test_project_writes_need_an_approved_plan_too(name):
    """工程档的写工具同样要计划审批，只是错误码带 `project_` 前缀。

    ⚠ 判据必须把工具集**真的打开**再判。不打开的话先撞上更早那道
      `project_tools_not_enabled`（rollout 闸），判据就只证明了
      「rollout 没开时它不跑」——那是另一件事，权限这道闸一次都没被走到
      （§一之二：喂了产线不会出现的载荷，护栏的条件根本不成立）。
    """
    state = V5SessionState(sessionId="denied", goal={"text": "inventory app"})
    token = control._PROJECT_TOOLS.set(object())
    try:
        events = _dispatch(name, state)
    finally:
        control._PROJECT_TOOLS.reset(token)
    assert events == [
        {"type": "control_tool_result", "tool": name, "ok": False, "error": "project_plan_approval_required"}
    ]


@pytest.mark.parametrize("name", sorted(_PROJECT_WRITERS))
def test_project_writes_are_refused_before_rollout_too(name):
    """反向：rollout 没开时也不许放行——两道闸各拦各的，不是二选一。"""
    state = V5SessionState(sessionId="denied", goal={"text": "inventory app"})
    assert _dispatch(name, state) == [
        {"type": "control_tool_result", "tool": name, "ok": False, "error": "project_tools_not_enabled"}
    ]


@pytest.mark.parametrize("approved", [False, True])
def test_forced_button_is_not_an_approval_receipt(monkeypatch, approved):
    harness = ControlHarness(monkeypatch)
    sid = new_sid("forced-permission")
    (seed_approved_session if approved else seed_session)(sid, goal={"text": "inventory app", "status": "clear"})
    _, events = harness.post(six_fields(sid, "continue", forcedTool="rehearse"))
    assert len(harness.helper_calls) == int(approved)
    assert ("control_handoff_factory" in event_types(events)) is approved
    assert "control_scope_card" not in event_types(events)
