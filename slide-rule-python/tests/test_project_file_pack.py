"""泄漏包的文件核：名字和参数按包，提示词不贴。

⚠ 2026-09-17：上一刀把能力做成了 `project_write` / `oldStr`。真机要抄的是
  泄漏清单那一面：`file` / `old_str` / `new_str` / `start_line` / `regex` /
  `glob`。`sudo=true` 收进 schema 但为真就拒。`project_write` 仍能执行，
  只是不再列给模型。`project_patch` 仍要哈希。

反向：把名字改回 project_write 清单、或把 sudo 当 extra 拒掉、或让
  `/home/ubuntu/src/App.tsx` 对不上文件，本文件都会红。
"""

from project_actor_support import project_actor  # noqa: F401
from services.project_manifest import content_hash
from test_project_tools import change, create, execute, read_body, setup  # noqa: F401


def test_file_write_uses_leaked_file_and_content(setup):
    project = create(setup)
    written = execute(setup, "file_write", {"file": "src/App.tsx", "content": "Kernel write\n"})
    assert written["ok"], written
    assert written["revision"] != project["revision"]
    assert written["changedFiles"] == ["src/App.tsx"]
    read = read_body(setup, "src/App.tsx", tool="file_read")
    assert read["content"] == "Kernel write\n"
    assert read["sha256"] == content_hash("Kernel write\n")
    assert read["path"] == "src/App.tsx"


def test_file_write_strips_sandbox_absolute_prefixes(setup):
    create(setup)
    written = execute(setup, "file_write", {
        "file": "/home/ubuntu/src/App.tsx",
        "content": "From sandbox path\n",
    })
    assert written["ok"], written
    assert read_body(setup, "/home/ubuntu/workspace/src/App.tsx", tool="file_read")["content"] == (
        "From sandbox path\n"
    )


def test_file_write_newlines_and_append(setup):
    create(setup)
    created = execute(setup, "file_write", {"file": "src/new.ts", "content": "export const n=1"})
    assert created["ok"], created
    trailed = execute(setup, "file_write", {
        "file": "src/new.ts", "content": "export const n=1", "trailing_newline": True,
    })
    assert trailed["ok"], trailed
    appended = execute(setup, "file_write", {
        "file": "src/new.ts",
        "content": "export const m=2",
        "append": True,
        "leading_newline": True,
        "trailing_newline": True,
    })
    assert appended["ok"], appended
    assert read_body(setup, "src/new.ts", tool="file_read")["content"] == (
        "export const n=1\n\nexport const m=2\n"
    )


def test_file_str_replace_uses_old_str_and_is_fail_closed(setup):
    create(setup)
    result = execute(setup, "file_str_replace", {
        "file": "src/App.tsx", "old_str": "First task", "new_str": "Ticket queue",
    })
    assert result["ok"], result
    assert read_body(setup, "src/App.tsx", tool="file_read")["content"] == (
        "Ticket queue\nSecond task\n"
    )
    missing = execute(setup, "file_str_replace", {
        "file": "src/App.tsx", "old_str": "no-such-line", "new_str": "x",
    })
    assert missing == {"ok": False, "error": "project_str_replace_not_found"}
    execute(setup, "file_write", {"file": "src/App.tsx", "content": "task\ntask\n"})
    ambiguous = execute(setup, "file_str_replace", {
        "file": "src/App.tsx", "old_str": "task", "new_str": "item",
    })
    assert ambiguous == {"ok": False, "error": "project_str_replace_ambiguous"}


def test_sudo_true_is_rejected_after_the_schema_accepts_it(setup):
    create(setup)
    for name, args in (
        ("file_write", {"file": "src/App.tsx", "content": "x\n", "sudo": True}),
        ("file_str_replace", {"file": "src/App.tsx", "old_str": "First", "new_str": "x", "sudo": True}),
        ("file_read", {"file": "src/App.tsx", "sudo": True}),
        ("file_find_in_content", {"file": "src/App.tsx", "regex": "task", "sudo": True}),
        ("file_find_by_name", {"path": ".", "glob": "*.tsx", "sudo": True}),
    ):
        result = execute(setup, name, args)
        assert result == {"ok": False, "error": "project_sudo_forbidden"}, name
    assert read_body(setup, "src/App.tsx", tool="file_read")["content"] == setup.files["src/App.tsx"]


def test_file_read_window_is_zero_based_and_exclusive_at_the_end(setup):
    create(setup)
    window = execute(setup, "file_read", {"file": "src/App.tsx", "start_line": 0, "end_line": 1})
    assert window["ok"], window
    assert window["content"] == "First task\n"
    assert window["start_line"] == 0


def test_file_find_in_content_and_by_name(setup):
    create(setup)
    found = execute(setup, "file_find_in_content", {"file": "src/App.tsx", "regex": "task"})
    assert found["ok"], found
    assert [row["line"] for row in found["matches"]] == [1, 2]
    names = execute(setup, "file_find_by_name", {"path": ".", "glob": "*.tsx"})
    assert names["ok"], names
    assert names["files"] == ["src/App.tsx"]
    bad = execute(setup, "file_find_in_content", {"file": "src/App.tsx", "regex": "("})
    assert bad == {"ok": False, "error": "project_regex_invalid"}


def test_file_write_rejects_the_old_patch_envelope(setup):
    create(setup)
    for extra in (
        {"approvalRef": setup.approval},
        {"expectedRevision": "prv-x"},
        {"expectedSha256": "0" * 64},
        {"ownerId": "alice"},
        {"path": "src/App.tsx"},
    ):
        result = execute(setup, "file_write", {"file": "src/App.tsx", "content": "x\n", **extra})
        assert result == {"ok": False, "error": "project_tool_arguments_invalid"}, extra


def test_reverse_project_patch_still_requires_the_hash(setup):
    project = create(setup)
    lost = change(setup, project, changes=[{
        "path": "src/App.tsx", "content": "Lost update\n", "expectedSha256": None,
    }])
    assert lost["error"] == "project_file_hash_conflict"
    assert read_body(setup, "src/App.tsx", tool="file_read")["content"] == setup.files["src/App.tsx"]


def test_revoked_plan_blocks_file_write_but_keeps_reads(setup):
    from test_project_tools import rewrite_session
    from plan_approval_support import approved_plan_rows

    create(setup)
    rewrite_session(setup, controlTranscript=approved_plan_rows()[:-1])
    blocked = execute(setup, "file_write", {"file": "src/App.tsx", "content": "Nope\n"})
    assert blocked["error"] == "project_plan_approval_required"
    kept = read_body(setup, "src/App.tsx", tool="file_read")
    assert kept["ok"] and kept["content"] == setup.files["src/App.tsx"]


def test_model_sees_file_pack_not_project_write_aliases(setup):
    from models.v5_state import V5SessionState
    from services import rehearsal_control as control
    from services.project_tool_contracts import PROJECT_TOOLS

    write = next(tool["function"] for tool in PROJECT_TOOLS if tool["function"]["name"] == "file_write")
    replace = next(tool["function"] for tool in PROJECT_TOOLS if tool["function"]["name"] == "file_str_replace")
    read = next(tool["function"] for tool in PROJECT_TOOLS if tool["function"]["name"] == "file_read")
    assert set(write["parameters"]["required"]) == {"file", "content"}
    assert set(replace["parameters"]["required"]) == {"file", "old_str", "new_str"}
    assert set(read["parameters"]["required"]) == {"file"}
    assert "sudo" in write["parameters"]["properties"]
    token = control._PROJECT_TOOLS.set(setup.tools)
    try:
        before = {item["function"]["name"] for item in control.list_control_tools(setup.state)}
        assert "file_write" not in before and "project_create" in before
        assert "project_write" not in before
        create(setup)
        fresh = V5SessionState.server_load(setup.sessions.load(setup.state.sessionId).payload)
        after = {item["function"]["name"] for item in control.list_control_tools(fresh)}
    finally:
        control._PROJECT_TOOLS.reset(token)
    assert "project_write" not in after and "project_str_replace" not in after
    assert {"file_read", "file_write", "file_str_replace",
            "file_find_in_content", "file_find_by_name", "shell_exec",
            "browser_view", "deploy_expose_port", "make_manus_page",
            "project_patch", "project_exec"} <= after
    assert "project_write" not in after and "project_str_replace" not in after
