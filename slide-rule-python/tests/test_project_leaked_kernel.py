"""泄漏核 29 件：名字进清单，有核的接到现有闸。

⚠ 2026-09-17：用户要的是整包。沙箱 bash / PTY stdin / 预览点击接到
  E2B + Playwright。提示词原文不贴。外站、sudo、deployed=true 仍拒。

反向：清单少一件、curl 被当成非法、点击在假预览上绿灯、deploy_apply
  回 deployed=true，本文件都会红。
"""

from project_actor_support import project_actor  # noqa: F401
from services.project_tool_contracts import LEAKED_KERNEL_TOOLS
from test_project_tools import create, execute, setup  # noqa: F401


def test_leaked_kernel_is_twenty_nine_closed_names():
    from services.closed_tools import CLOSED_TOOLS
    from services.rehearsal_control import CONTROL_TOOLS

    assert len(LEAKED_KERNEL_TOOLS) == 29
    names = {item["function"]["name"] for item in CONTROL_TOOLS}
    assert LEAKED_KERNEL_TOOLS <= set(CLOSED_TOOLS)
    assert LEAKED_KERNEL_TOOLS <= names
    from services.project_tool_contracts import leaked_shell_command
    import pytest
    with pytest.raises(ValueError, match="project_shell_command_not_allowed"):
        leaked_shell_command("curl https://example.com")


def test_shell_exec_maps_managed_commands_and_runs_sandbox_bash(setup):
    create(setup)
    queued = execute(setup, "shell_exec", {
        "command": "npm run check", "id": "check-1", "is_background": True,
    })
    assert queued["ok"], queued
    assert queued["operationId"]
    assert queued["kind"] == "runtime.exec"
    assert queued["commandFinished"] is False, queued
    curl = execute(setup, "shell_exec", {
        "command": "curl https://example.com", "id": "curl-1", "is_background": True,
    })
    assert curl["ok"], curl
    assert setup.store.get_operation(curl["operationId"], owner_id="alice").input["script"] == (
        "curl https://example.com"
    )
    sudo = execute(setup, "shell_exec", {"command": "check", "sudo": True})
    assert sudo == {"ok": False, "error": "project_sudo_forbidden"}
    nested = execute(setup, "shell_exec", {"command": "true && sudo ls"})
    assert nested == {"ok": False, "error": "project_sudo_forbidden"}
    elsewhere = execute(setup, "shell_exec", {"command": "check", "exec_dir": "/etc"})
    assert elsewhere == {"ok": False, "error": "project_shell_exec_dir_not_supported"}
    newline = execute(setup, "shell_exec", {"command": "ls\nrm -rf /"})
    assert newline == {"ok": False, "error": "project_shell_command_not_allowed"}


def test_shell_wait_and_kill_use_the_operation_id(setup):
    create(setup)
    queued = execute(setup, "shell_exec", {
        "command": "build", "id": "build-1", "is_background": True,
    })
    waited = execute(setup, "shell_wait", {"id": queued["operationId"], "seconds": 0})
    assert waited["ok"], waited
    viewed = execute(setup, "shell_view", {"id": queued["operationId"]})
    assert viewed["ok"] and viewed["operationId"] == queued["operationId"]
    killed = execute(setup, "shell_kill_process", {"id": queued["operationId"]})
    assert killed["ok"] and killed.get("cancelRequested")


def test_stdin_clicks_and_private_deploy_use_real_kernels(setup):
    create(setup)
    queued = execute(setup, "shell_exec", {
        "command": "ls", "id": "ls-1", "is_background": True,
    })
    typed = execute(setup, "shell_write_to_process", {
        "id": queued["operationId"], "input": "yes",
    })
    assert typed == {"ok": True, "operationId": queued["operationId"], "stdinQueued": True}
    assert setup.supervisor.take_stdin(queued["operationId"]) == [
        {"text": "yes", "pressEnter": True},
    ]
    finished = execute(setup, "shell_exec", {
        "command": "build", "id": "done-1", "is_background": True,
    })
    done = setup.store.get_operation(finished["operationId"], owner_id="alice")
    setup.store._q(
        "update wb_project_operation set payload=$1,rev=rev+1 where id=$2",
        [done.model_copy(update={"status": "completed"}).model_dump_json(), done.operationId],
    )
    assert execute(setup, "shell_write_to_process", {
        "id": done.operationId, "input": "late",
    }) == {"ok": False, "error": "project_shell_stdin_not_available"}
    assert execute(setup, "browser_click", {"index": 0}) == {
        "ok": False, "error": "project_browser_preview_not_ready",
    }
    setup.supervisor.preview_page = lambda project: {
        "url": "https://rt-1.preview.example.com/", "revision": "rev",
    }
    setup.supervisor.browser_interactor = lambda action, page: {
        "op": action["op"], "url": page["url"], "index": action.get("index"),
    }
    clicked = execute(setup, "browser_click", {"index": 0})
    assert clicked == {
        "ok": True, "interactive": True, "op": "click",
        "url": "https://rt-1.preview.example.com/", "index": 0,
    }
    setup.supervisor.preview_page = lambda project: {"url": "https://evil.example/", "revision": "rev"}
    assert execute(setup, "browser_click", {"index": 0}) == {
        "ok": False, "error": "project_browser_external_url_forbidden",
    }
    applied = execute(setup, "deploy_apply_deployment", {"type": "static"})
    assert applied["ok"] and applied["deployed"] is False and applied["previewPrivate"] is True
    assert applied.get("public") is False
    assert execute(setup, "browser_navigate", {"url": "https://evil.example"}) == {
        "ok": False, "error": "project_browser_external_url_forbidden",
    }


def test_deploy_expose_and_browser_navigate_start_the_private_preview(setup):
    create(setup)
    exposed = execute(setup, "deploy_expose_port", {"port": 5173})
    assert exposed["ok"], exposed
    assert exposed["operationId"]
    navigated = execute(setup, "browser_navigate", {"url": "/"})
    assert navigated["ok"] and navigated["previewPrivate"] is True
    viewed = execute(setup, "browser_view")
    assert viewed["ok"] and viewed["interactive"] is False
    page = execute(setup, "make_manus_page", {"file": "src/App.tsx", "title": "Ticket"})
    assert page["ok"] and page["presented"] == "project" and page["path"] == "src/App.tsx"


def test_browser_view_keeps_a_preview_shot_not_a_verification(setup):
    """飞机大战那趟 browser_view 看了三次也不落图。字节不许回给模型。"""
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    created = create(setup)
    setup.supervisor.preview_page = lambda project: {
        "url": "https://rt-1.preview.example.com/", "revision": "rev",
    }
    setup.supervisor.browser_interactor = lambda action, page: {
        "op": action["op"], "url": page["url"], "screenshotPng": png,
    }
    viewed = execute(setup, "browser_view")
    assert viewed["ok"] is True
    assert viewed.get("previewSnapshot") is True
    assert "screenshotPng" not in viewed
    assert "screenshot" not in viewed
    project_id = created["projectId"]
    assert setup.store.read_preview_snapshot(project_id, owner_id="alice") == png
    assert viewed.get("verification") is None


def test_model_sees_the_leaked_pack_not_the_old_aliases(setup):
    from models.v5_state import V5SessionState
    from services import rehearsal_control as control

    token = control._PROJECT_TOOLS.set(setup.tools)
    try:
        create(setup)
        fresh = V5SessionState.server_load(setup.sessions.load(setup.state.sessionId).payload)
        after = {item["function"]["name"] for item in control.list_control_tools(fresh)}
    finally:
        control._PROJECT_TOOLS.reset(token)
    assert LEAKED_KERNEL_TOOLS <= after
    assert "project_write" not in after and "project_str_replace" not in after
    assert "project_status" in after and "project_exec" in after
    from services.project_tool_contracts import GITHUB_KERNEL_TOOLS
    assert GITHUB_KERNEL_TOOLS <= after


def test_idle_is_not_a_done_claim():
    from models.v5_state import V5SessionState
    from services import rehearsal_control as control
    import asyncio

    state = V5SessionState(sessionId="idle-1", goal={"text": "inventory app"})

    async def run():
        return [event async for event in control._dispatch_tool(
            "idle", {}, state, "continue", [], [], "desktop", None, "inventory app")]

    events = asyncio.run(run())
    assert events[0]["type"] == "control_tool_start"
    assert events[1] == {"type": "control_tool_result", "tool": "idle", "ok": True, "idle": True}
    assert events[2]["type"] == "complete"
    assert all(event.get("tool") != "report_done" for event in events)
