"""shell_exec 前台堵住，排队不是做完。

## 来历（2026-09-18）

用户问「用户名密码是啥」。模型 `shell_exec npm run build` 立刻拿到
`ok: true` + `status: queued`，把接单当成跑完，开口了；左栏还亮着进行中。

grok-build bash：前台 `backend.run()` 等进程退出才交 Terminal；
`is_background: true` 才立刻给 task_id，而且 status 是 running 不是成功。

## 这份判据钉三件

1. 后台立刻回，`commandFinished` 为假。
2. 前台等到终态才回，带着 exitCode。
3. 前台超时仍不许把 queued 说成做完。

变异：把 `_poll_operation` 从 shell_exec 拿掉 → 2 红。
把 `commandFinished` 恒 true → 1、3 红。
"""

from __future__ import annotations

import asyncio
import threading
import time
from types import SimpleNamespace

from project_actor_support import project_actor  # noqa: F401
from test_project_tools import create, execute, setup  # noqa: F401

from control_turn_support import new_sid, seed_approved_session as seed_session
from services import project_tools
from services import rehearsal_control as rc
from services.project_tool_contracts import SHELL_EXEC_FOREGROUND_BLOCK_SECONDS


def _complete_latest(setup, *, exit_code=0):
    deadline = time.time() + 3
    while time.time() < deadline:
        project = setup.store.get_project_for_session("session-1", owner_id="alice")
        if project is not None:
            ops = setup.store.list_project_operations(
                project.projectId, owner_id="alice", limit=20)
            if ops:
                operation = ops[-1]
                if operation.status in {"queued", "running"}:
                    setup.store._q(
                        "update wb_project_operation set payload=$1,rev=rev+1 where id=$2",
                        [operation.model_copy(update={
                            "status": "completed",
                            "result": {"exitCode": exit_code, "command": "build"},
                        }).model_dump_json(), operation.operationId],
                    )
                    return
        time.sleep(0.04)
    raise AssertionError("queued operation never appeared for the waiter")


def test_background_shell_exec_is_not_command_finished(setup):
    create(setup)
    started = time.monotonic()
    queued = execute(setup, "shell_exec", {
        "command": "npm run build", "id": "bg-1", "is_background": True,
    })
    assert time.monotonic() - started < 1.0, "后台路径不该堵住"
    assert queued["ok"] is True
    assert queued["status"] == "queued"
    assert queued["commandFinished"] is False, queued
    assert "exitCode" not in queued


def test_foreground_shell_exec_waits_until_exit(setup, monkeypatch):
    monkeypatch.setattr(project_tools, "SHELL_EXEC_FOREGROUND_BLOCK_SECONDS", 8)
    create(setup)
    worker = threading.Thread(target=_complete_latest, args=(setup,), daemon=True)
    worker.start()
    started = time.monotonic()
    result = execute(setup, "shell_exec", {"command": "build", "id": "fg-1"})
    worker.join(timeout=3)
    assert time.monotonic() - started < 6, "前台应当在命令进终态时提前返回，不是死等满"
    assert result["ok"] is True
    assert result["commandFinished"] is True, result
    assert result["status"] == "completed"
    assert result["exitCode"] == 0


def test_foreground_timeout_still_not_finished(setup, monkeypatch):
    """反向：超时交回 queued 时，不许 commandFinished=true。"""
    monkeypatch.setattr(project_tools, "SHELL_EXEC_FOREGROUND_BLOCK_SECONDS", 0.35)
    create(setup)
    started = time.monotonic()
    result = execute(setup, "shell_exec", {"command": "build", "id": "fg-timeout"})
    assert time.monotonic() - started >= 0.3
    assert result["ok"] is True
    assert result["status"] == "queued"
    assert result["commandFinished"] is False, result


def test_default_foreground_block_matches_grok():
    assert SHELL_EXEC_FOREGROUND_BLOCK_SECONDS >= 120, (
        "前台默认不够 grok 的 120 秒，19 秒的 build 还要再烧一轮模型去 poll"
    )


def test_dispatch_pushes_operation_id_before_the_command_finishes():
    """界面订 PTY 靠 operationId。等 exit 再补 id = 进行中白纸。

    模型仍要等到终态（上面三条钉着 execute 默认 wait=True）。
    分发处对前台 shell 必须 wait=False，enqueue 立刻推 id。
    """
    import asyncio
    from types import SimpleNamespace

    from control_turn_support import new_sid, seed_approved_session as seed_session
    from services import rehearsal_control as rc

    sid = new_sid("shell-live-id")
    state = seed_session(sid, goal={"text": "跑测试", "status": "clear"})
    seen_wait = []

    class FakeTools:
        owner_id = "test-user"

        def execute(self, name, args, session, *, wait=True):
            seen_wait.append(wait)
            return {
                "ok": True,
                "operationId": "op-live",
                "status": "running",
                "commandFinished": False,
            }

        class store:
            @staticmethod
            def get_operation(oid, owner_id=None):
                return SimpleNamespace(status="running")

    token = rc._PROJECT_TOOLS.set(FakeTools())
    started = time.monotonic()
    try:
        events = asyncio.run(_collect_until_operation_id(rc, state))
    finally:
        rc._PROJECT_TOOLS.reset(token)
    assert time.monotonic() - started < 1.0, "补 id 不许等命令结束"
    assert seen_wait == [False], seen_wait
    starts = [e for e in events if e.get("type") == "control_tool_start"]
    assert any(e.get("operationId") == "op-live" for e in starts), starts


async def _collect_until_operation_id(rc, state):
    events = []
    agen = rc._dispatch_tool(
        "shell_exec",
        {"command": "npm test"},
        state,
        "跑测试",
        [],
        [],
        "desktop",
        None,
        "跑测试",
    )
    try:
        async for event in agen:
            events.append(event)
            if event.get("type") == "control_tool_start" and event.get("operationId"):
                break
    finally:
        await agen.aclose()
    return events


def test_dispatch_terminal_receipt_keeps_command_excerpt():
    """⚠ 13ME64TF8Z：wait 循环用裸 snapshot 盖掉 excerpt。

    真机：python3 scripts/generate_kickoff_pptx.py → project_command_failed，
    回执没有 Traceback，project_logs 再空。判据必须看见 PTY 字节。
    变异：把 command_receipt_from 改回 adapter._snapshot → excerpt 没了。
    """
    sid = new_sid("shell-excerpt")
    state = seed_session(sid, goal={"text": "跑测试", "status": "clear"})

    class Event:
        type = "runtime.console"
        payload = {"data": "ModuleNotFoundError: No module named 'pptx'\n"}
        seq = 1

    class Tools:
        owner_id = "test-user"

        def execute(self, name, args, session, *, wait=True):
            return {
                "ok": True,
                "operationId": "op-pptx",
                "status": "running",
                "commandFinished": False,
            }

        def _snapshot(self, oid):
            return {
                "ok": True,
                "operationId": oid,
                "status": "failed",
                "errorCode": "project_command_failed",
                "exitCode": 1,
                "commandFinished": True,
            }

        class store:
            @staticmethod
            def get_operation(oid, owner_id=None):
                return SimpleNamespace(status="failed")

            @staticmethod
            def list_events(oid, owner_id=None, after_seq=0, limit=100):
                return [Event()]

    token = rc._PROJECT_TOOLS.set(Tools())
    try:
        events = asyncio.run(_collect_tool_result(rc, state))
    finally:
        rc._PROJECT_TOOLS.reset(token)
    results = [e for e in events if e.get("type") == "control_tool_result"]
    assert results, events
    body = results[-1]
    assert "ModuleNotFoundError" in str(body.get("excerpt") or ""), body
    assert body.get("errorCode") == "project_command_failed"


async def _collect_tool_result(rc, state):
    events = []
    agen = rc._dispatch_tool(
        "shell_exec",
        {"command": "python3 scripts/generate_kickoff_pptx.py"},
        state,
        "跑测试",
        [],
        [],
        "desktop",
        None,
        "跑测试",
    )
    try:
        async for event in agen:
            events.append(event)
    finally:
        await agen.aclose()
    return events


def test_dispatch_source_really_skips_the_foreground_block():
    from pathlib import Path

    from control_turn_support import strip_python

    src = strip_python(
        Path(__file__).resolve().parents[1] / "services" / "rehearsal_control.py"
    )
    project = src[src.find("if name in PROJECT_TOOL_NAMES") :]
    execute = src[
        src.find("def _execute_project_tool") : src.find(
            "def _project_tool_wait_seconds"
        )
    ]
    assert "_execute_project_tool" in project, "分发处必须走先 enqueue 再堵"
    assert "wait" in execute and "False" in execute, execute
    wait = project[project.find("wait_seconds = _project_tool_wait_seconds"):]
    wait = wait[: wait.find('yield {"type": "control_tool_result"')]
    assert "command_receipt_from" in wait, wait[:600]
    assert "adapter._snapshot" not in wait, wait[:600]
