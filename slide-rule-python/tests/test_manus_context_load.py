# -*- coding: utf-8 -*-
"""Manus Context Engineering：压缩 + 按需加载。

真机 sr-20260920120007-PPT：七次 durable 全是 control-v2 / 8000，
cheapTokens=9611 就停，bash 零次。源码里的 v3 窗口没接到活路径。

判据喂真机形状：9611/8000、缺 deliverableKind 的 GET、无窗 file_read。
不调高 MAX_CHEAP_TOKENS，不改 v1/v2 存档数字。
"""

from __future__ import annotations

import ast
import copy
import json
from pathlib import Path

from control_turn_support import (
    ControlHarness,
    KEY,
    client,
    llm_text,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
    strip_python,
)
from project_actor_support import project_actor  # noqa: F401
from models.v5_state import V5SessionState
from services import rehearsal_control as control
from services.control_budget import CONVERSATION_BUDGET, CONVERSATION_BUDGET_V2, startup_budget_line
from services.project_tools import _command_log_excerpt, _command_pointer
from services.deliverable_kind import OFFICE_FILE
from services.project_tool_contracts import explicit_read_window, FileReadArguments, ReadArguments
from test_project_tools import create, execute, setup  # noqa: F401

CONTROL_SRC = Path(control.__file__)
PPT_PLAN = "用 office-skills 做一份办公启动 PPT，产出 launch.pptx。"


def _fn_body(src: str, name: str) -> str:
    tree = ast.parse(src)
    fn = next(
        n
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name
    )
    start = fn.lineno - 1
    end = fn.end_lineno or start + 1
    return "\n".join(src.splitlines()[start:end])


def test_default_file_read_is_path_and_excerpt_not_body(setup):
    create(setup)
    pointer = execute(setup, "file_read", {"file": "src/App.tsx"})
    assert pointer["ok"]
    assert pointer["path"] == "src/App.tsx"
    assert pointer["content"] == ""
    assert "First task" in pointer["excerpt"]
    assert pointer["totalChars"] == len(setup.files["src/App.tsx"])
    assert "offset" in pointer["hint"] or "start_line" in pointer["hint"]
    window = execute(setup, "file_read", {"file": "src/App.tsx", "start_line": 0, "end_line": 1})
    assert window["content"] == "First task\n"


def test_default_project_read_is_pointer_explicit_window_keeps_body(setup):
    create(setup)
    assert explicit_read_window(ReadArguments(path="src/App.tsx")) is False
    assert explicit_read_window(FileReadArguments(file="src/App.tsx")) is False
    pointer = execute(setup, "project_read", {"path": "src/App.tsx"})
    assert pointer["content"] == ""
    assert pointer["path"] == "src/App.tsx"
    assert pointer["excerpt"]
    body = execute(setup, "project_read", {"path": "src/App.tsx", "offset": 0, "limit": 8000})
    assert body["content"] == setup.files["src/App.tsx"]


def test_startup_budget_line_is_the_live_v3_socket():
    """活进程亮牌。改回 v2 数字或删掉 context= 必须红。"""
    line = startup_budget_line()
    assert "CONVERSATION_BUDGET=control-v3/200000" in line
    assert "context=1" in line
    assert "PROJECT_BUDGET=project-v3/200000" in line
    assert "control-v2" not in line
    assert CONVERSATION_BUDGET_V2.max_tokens == 8_000


def test_budget_exhausted_resume_is_a_fresh_window_round():
    """真机 16184/8000 之后用户再说一次：不是接着花 v2。"""
    state = V5SessionState(
        sessionId="ppt-exhausted",
        ownerId="alice",
        goal={"text": "做个PPT", "status": "clear"},
    )
    resume = {
        "phase": "budget_exhausted",
        "round": 3,
        "cheapTokens": 16184,
        "budgetPolicy": CONVERSATION_BUDGET_V2.to_wire(),
    }
    assert control._is_fresh_control_round(resume) is True
    assert control._loop_budget_for(state, resume).profile == "control-v3"
    mid = {"phase": "model", "round": 1, "cheapTokens": 5000,
           "budgetPolicy": CONVERSATION_BUDGET_V2.to_wire()}
    assert control._loop_budget_for(state, mid).profile == "control-v2"


def test_fresh_round_does_not_restore_control_v2_spend_cap():
    """真机 continuation 带着 v2 / cheapTokens=0。新一轮必须换窗口档。"""
    state = V5SessionState(
        sessionId="ppt-fresh",
        ownerId="alice",
        goal={"text": "做个PPT", "status": "clear"},
    )
    resume = {
        "phase": "model",
        "round": 0,
        "cheapTokens": 0,
        "budgetPolicy": CONVERSATION_BUDGET_V2.to_wire(),
    }
    assert control._loop_budget_for(state, resume).profile == "control-v3"
    assert control._loop_budget_for(state, None).profile == "control-v3"
    mid = {**resume, "round": 1, "cheapTokens": 5000}
    assert control._loop_budget_for(state, mid).profile == "control-v2"
    assert CONVERSATION_BUDGET_V2.max_tokens == 8_000


def test_live_9611_does_not_stop_control_v3(monkeypatch):
    """真机 used=9611 limit=8000。v3 不停；不是取消一切上限。"""
    harness = ControlHarness(monkeypatch)
    sid = new_sid("v3-9611")
    seed_session(sid, goal={"text": "做个PPT", "status": "clear"})
    harness.llm_impl = lambda *_a, **_kw: llm_tool(
        "write_plan",
        {"planContent": PPT_PLAN},
        usage={"total_tokens": 9611},
    )
    _, events = harness.post(six_fields(sid, "@office-skills 做个PPT"))
    budget_stops = [
        event for event in events
        if event.get("stopReason") == "token_budget"
    ]
    assert not budget_stops, budget_stops
    assert all(event.get("limit") != 8000 for event in events if event.get("stopReason"))
    assert any(event.get("tool") == "write_plan" and event.get("ok") for event in events)


def test_v2_archive_still_stops_at_8001(monkeypatch):
    """反证：旧存档花费闸还在。不是把 8000 改成无限。"""
    monkeypatch.setattr(control, "CONVERSATION_BUDGET", CONVERSATION_BUDGET_V2)
    harness = ControlHarness(monkeypatch)
    sid = new_sid("v2-8001")
    seed_session(sid, goal={"text": "做个PPT", "status": "clear"})
    harness.llm_impl = lambda *_a, **_kw: llm_tool(
        "search_evidence",
        {"query": "x"},
        usage={"total_tokens": 8001},
    )
    _, events = harness.post(six_fields(sid, "做个PPT"))
    stops = [
        event for event in events
        if event.get("type") == "control_text" and event.get("stopReason") == "token_budget"
    ]
    assert stops and stops[0]["limit"] == 8000 and stops[0]["used"] == 8001


def test_get_stamps_missing_kind_from_mentioned_office_skill():
    """真机 GET/complete 的 plan_written 缺键。用落盘点名补，不猜话题。"""
    sid = new_sid("get-kind")
    seed_session(
        sid,
        goal={"text": "做个PPT", "status": "clear"},
        controlTranscript=[{
            "id": "ct-1",
            "kind": "plan_written",
            "planId": "p1",
            "revision": 1,
            "planContent": PPT_PLAN,
            "mentionedSkills": ["office-skills"],
        }],
    )
    got = client.get(f"/api/sliderule/sessions/{sid}", headers=KEY)
    assert got.status_code == 200, got.text[:800]
    plan = next(
        row for row in reversed(got.json()["state"]["controlTranscript"])
        if row.get("kind") == "plan_written"
    )
    assert "deliverableKind" in plan
    assert plan["deliverableKind"] == OFFICE_FILE


def test_loop_uses_fresh_round_budget_and_microcompact():
    """反向：预算选档 / 立刻 snip 必须接在 _control_llm_loop 上。"""
    body = _fn_body(strip_python(CONTROL_SRC), "_control_llm_loop")
    assert "_loop_budget_for" in body
    assert "microcompact_messages" in body
    assert "[control] budget profile=" in body
    assert "context_token_budget=" in body
    assert "restore_budget(resume.get" not in body
    serial = _fn_body(strip_python(CONTROL_SRC), "_run_control_turn_serial")
    assert "_run_control_turn_body" in serial
    assert "'model'" in serial and "'tools'" in serial
    kernel = _fn_body(strip_python(CONTROL_SRC.parent / "project_tools.py"), "_kernel_runtime")
    assert "_command_pointer" in kernel
    assert "_command_log_excerpt" in kernel


def test_command_pointer_excerpt_is_log_tail_not_error_code(setup):
    """真机失败回执：excerpt 是日志尾，project_logs 能按同一 operationId 再取。"""
    created = create(setup)
    operation = setup.store.create_operation(
        created["projectId"], owner_id="alice", kind="runtime.exec",
        idempotency_key="bash-fail", expected_revision=created["revision"],
        approval_ref=setup.approval,
    )
    lease = setup.store.acquire_lease(
        created["projectId"], owner_id="alice", lease_owner="worker-log")
    setup.store.claim_operation(
        operation.operationId, owner_id="alice",
        lease_owner=lease.leaseOwner, generation=lease.generation)
    log_text = "Traceback: No module named pptx\ncommand failed\n"
    setup.store.append_event(
        operation.operationId, owner_id="alice", event_type="runtime.log",
        event_id="bash-fail-log",
        payload={"text": log_text, "processId": "pid-1", "nextOffset": len(log_text),
                 "truncated": False},
        lease_generation=lease.generation, lease_owner=lease.leaseOwner,
    )
    excerpt = _command_log_excerpt(setup.store, operation.operationId, "alice")
    assert "No module named pptx" in excerpt
    pointer = _command_pointer(
        {"operationId": operation.operationId, "exitCode": 1,
         "errorCode": "project_command_failed", "stdout": "SHOULD_NOT_LEAK"},
        excerpt,
    )
    assert pointer["excerpt"] != pointer["errorCode"]
    assert "No module named pptx" in pointer["excerpt"]
    assert "stdout" not in pointer
    assert "logPath" not in pointer
    assert "project_logs" in pointer["hint"]
    assert "operationId" in pointer["hint"]
    logs = execute(setup, "project_logs", {"operationId": operation.operationId})
    assert logs["ok"]
    assert "No module named pptx" in "".join(item["text"] for item in logs["logs"])


def test_command_pointer_does_not_fall_back_to_error_code():
    """变异：excerpt 空时不许改回 errorCode。"""
    out = _command_pointer(
        {"operationId": "op-1", "errorCode": "project_command_failed"},
        "",
    )
    assert out["excerpt"] == ""
    assert out["errorCode"] == "project_command_failed"


def test_playbooks_are_not_skill_bodies():
    from services.control_skills import mentioned_skill_playbooks, parse_skill_md

    info = parse_skill_md(
        "---\nname: office-skills\ndescription: 做 PPT\n---\nFULL BODY MUST NOT LEAK\n",
        path=".sliderule/skills/office-skills/SKILL.md",
    )
    text = mentioned_skill_playbooks([info])
    assert "FULL BODY MUST NOT LEAK" not in text
    assert ".sliderule/skills/office-skills/SKILL.md" in text
    assert CONVERSATION_BUDGET.max_tokens == 200_000
    assert CONVERSATION_BUDGET_V2.max_tokens == 8_000
