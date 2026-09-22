"""GitHub 薄核：grok/Claude 那套公开名字，接到同一份工程源码。

⚠ 2026-09-17：泄漏 29 件已经在清单里。余力把 GitHub 共识核也挂上：
  read_file / write_file / search_replace / bash / grep / list_dir / glob。
  参数用他们的 path / old_string / pattern，不是再发明一套。
  bash 是 grok 那一行沙箱命令；sudo / 换行仍拒。grep 是跨文件正则。

反向：清单缺一件、grep 只扫一个文件、bash curl 放行，本文件都会红。
"""

from project_actor_support import project_actor  # noqa: F401
from services.project_manifest import content_hash
from services.project_tool_contracts import GITHUB_KERNEL_TOOLS
from test_project_tools import create, execute, read_body, setup  # noqa: F401


def test_github_kernel_is_seven_closed_names():
    from services.closed_tools import CLOSED_TOOLS
    from services.rehearsal_control import CONTROL_TOOLS

    assert GITHUB_KERNEL_TOOLS == {
        "read_file", "write_file", "search_replace", "bash", "grep", "list_dir", "glob",
    }
    names = {item["function"]["name"] for item in CONTROL_TOOLS}
    assert GITHUB_KERNEL_TOOLS <= set(CLOSED_TOOLS)
    assert GITHUB_KERNEL_TOOLS <= names


def test_write_file_and_search_replace_use_github_fields(setup):
    create(setup)
    written = execute(setup, "write_file", {"path": "src/App.tsx", "content": "Hello queue\n"})
    assert written["ok"], written
    assert read_body(setup, "src/App.tsx", tool="read_file")["content"] == "Hello queue\n"
    replaced = execute(setup, "search_replace", {
        "path": "src/App.tsx", "old_string": "Hello queue", "new_string": "Ticket queue",
    })
    assert replaced["ok"], replaced
    assert read_body(setup, "src/App.tsx", tool="read_file")["content"] == "Ticket queue\n"
    assert read_body(setup, "src/App.tsx", tool="read_file")["sha256"] == content_hash("Ticket queue\n")


def test_read_file_offset_limit_are_line_windows(setup):
    create(setup)
    window = execute(setup, "read_file", {"path": "src/App.tsx", "offset": 0, "limit": 1})
    assert window["ok"], window
    assert window["content"] == "First task\n"


def test_grep_searches_the_tree_not_one_file(setup):
    create(setup)
    execute(setup, "write_file", {"path": "src/extra.ts", "content": "export const task = 1\n"})
    found = execute(setup, "grep", {"pattern": "task"})
    assert found["ok"], found
    paths = {row["path"] for row in found["matches"]}
    assert paths == {"src/App.tsx", "src/extra.ts"}
    assert execute(setup, "grep", {"pattern": "("}) == {"ok": False, "error": "project_regex_invalid"}


def test_glob_and_list_dir(setup):
    create(setup)
    names = execute(setup, "glob", {"pattern": "*.tsx"})
    assert names["ok"] and names["files"] == ["src/App.tsx"]
    listed = execute(setup, "list_dir", {"path": "src"})
    assert listed["ok"] and "src/App.tsx" in listed["files"]
    assert "package.json" not in listed["files"]


def test_bash_is_the_managed_shell(setup):
    create(setup)
    queued = execute(setup, "bash", {"command": "pnpm run check", "is_background": True})
    assert queued["ok"], queued
    assert queued["operationId"]
    assert queued["commandFinished"] is False, queued
    curl = execute(setup, "bash", {"command": "curl https://example.com", "is_background": True})
    assert curl["ok"], curl
    assert setup.store.get_operation(curl["operationId"], owner_id="alice").input["script"] == (
        "curl https://example.com"
    )
    assert execute(setup, "bash", {"command": "check", "sudo": True}) == {
        "ok": False, "error": "project_sudo_forbidden",
    }


def test_model_sees_github_names_after_the_project_exists(setup):
    from models.v5_state import V5SessionState
    from services import rehearsal_control as control

    token = control._PROJECT_TOOLS.set(setup.tools)
    try:
        before = {item["function"]["name"] for item in control.list_control_tools(setup.state)}
        assert "write_file" not in before
        create(setup)
        fresh = V5SessionState.server_load(setup.sessions.load(setup.state.sessionId).payload)
        after = {item["function"]["name"] for item in control.list_control_tools(fresh)}
    finally:
        control._PROJECT_TOOLS.reset(token)
    assert GITHUB_KERNEL_TOOLS <= after
    write = next(tool["function"] for tool in control.CONTROL_TOOLS if tool["function"]["name"] == "write_file")
    replace = next(tool["function"] for tool in control.CONTROL_TOOLS if tool["function"]["name"] == "search_replace")
    assert set(write["parameters"]["required"]) == {"path", "content"}
    assert set(replace["parameters"]["required"]) == {"path", "old_string", "new_string"}
