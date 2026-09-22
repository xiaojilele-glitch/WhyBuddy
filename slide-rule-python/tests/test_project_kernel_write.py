"""整文件写 / 唯一串替换：模型只给路径和正文，服务端填闸和哈希。

⚠ 2026-09-16 TicketStream：`project_patch` 要 approvalRef + expectedRevision
  + expectedSha256，真机十几次 `project_tool_arguments_invalid` /
  `project_file_hash_conflict`，墙钟把回合切片。泄漏的 Manus 核和
  grok/Claude 的 Write/Edit 都是 path+content。本文件直接打
  `ProjectTools.execute`——只加 schema 不接 `_kernel_edit` 会红。

反向：旧 `project_patch` 仍要哈希；计划撤销仍挡核写；oldStr 0 次或多于
  1 次 fail-closed。壳和通用浏览器不在这一刀。
"""

from project_actor_support import project_actor  # noqa: F401
from services.project_manifest import content_hash
from test_project_tools import change, create, execute, read_body, setup  # noqa: F401


def test_write_does_not_ask_the_model_for_hashes_or_approval_ref(setup):
    project = create(setup)
    written = execute(setup, "project_write", {"path": "src/App.tsx", "content": "Kernel write\n"})
    assert written["ok"], written
    assert written["revision"] != project["revision"]
    assert written["changedFiles"] == ["src/App.tsx"]
    read = read_body(setup, "src/App.tsx")
    assert read["content"] == "Kernel write\n"
    assert read["sha256"] == content_hash("Kernel write\n")


def test_write_can_create_and_append(setup):
    create(setup)
    created = execute(setup, "project_write", {"path": "src/new.ts", "content": "export const n=1\n"})
    assert created["ok"], created
    appended = execute(setup, "project_write", {
        "path": "src/new.ts", "content": "export const m=2\n", "append": True,
    })
    assert appended["ok"], appended
    assert read_body(setup, "src/new.ts")["content"] == (
        "export const n=1\nexport const m=2\n"
    )


def test_str_replace_changes_the_only_match(setup):
    create(setup)
    result = execute(setup, "project_str_replace", {
        "path": "src/App.tsx", "oldStr": "First task", "newStr": "Ticket queue",
    })
    assert result["ok"], result
    assert "Ticket queue\nSecond task\n" == read_body(setup, "src/App.tsx")["content"]


def test_str_replace_is_fail_closed_when_the_needle_is_missing_or_ambiguous(setup):
    create(setup)
    missing = execute(setup, "project_str_replace", {
        "path": "src/App.tsx", "oldStr": "no-such-line", "newStr": "x",
    })
    assert missing == {"ok": False, "error": "project_str_replace_not_found"}
    execute(setup, "project_write", {"path": "src/App.tsx", "content": "task\ntask\n"})
    ambiguous = execute(setup, "project_str_replace", {
        "path": "src/App.tsx", "oldStr": "task", "newStr": "item",
    })
    assert ambiguous == {"ok": False, "error": "project_str_replace_ambiguous"}
    assert read_body(setup, "src/App.tsx")["content"] == "task\ntask\n"


def test_kernel_rejects_the_old_patch_envelope_and_identity_fields(setup):
    create(setup)
    for extra in (
        {"approvalRef": setup.approval},
        {"expectedRevision": "prv-x"},
        {"expectedSha256": "0" * 64},
        {"sudo": True},
        {"ownerId": "alice"},
    ):
        result = execute(setup, "project_write", {"path": "src/App.tsx", "content": "x\n", **extra})
        assert result == {"ok": False, "error": "project_tool_arguments_invalid"}, extra


def test_reverse_project_patch_still_requires_the_hash(setup):
    project = create(setup)
    lost = change(setup, project, changes=[{
        "path": "src/App.tsx", "content": "Lost update\n", "expectedSha256": None,
    }])
    assert lost["error"] == "project_file_hash_conflict"
    assert read_body(setup, "src/App.tsx")["content"] == setup.files["src/App.tsx"]


def test_revoked_plan_blocks_kernel_write(setup):
    from test_project_tools import rewrite_session
    from plan_approval_support import approved_plan_rows

    create(setup)
    rewrite_session(setup, controlTranscript=approved_plan_rows()[:-1])
    blocked = execute(setup, "project_write", {"path": "src/App.tsx", "content": "Nope\n"})
    assert blocked["error"] == "project_plan_approval_required"
    assert read_body(setup, "src/App.tsx")["content"] == setup.files["src/App.tsx"]


def test_kernel_schema_is_flat_and_listed_only_after_the_project_exists(setup):
    from models.v5_state import V5SessionState
    from services import rehearsal_control as control
    from services.project_tool_contracts import PROJECT_TOOLS

    write = next(tool["function"] for tool in PROJECT_TOOLS if tool["function"]["name"] == "project_write")
    replace = next(tool["function"] for tool in PROJECT_TOOLS if tool["function"]["name"] == "project_str_replace")
    assert "$defs" not in write["parameters"] and "$ref" not in str(write["parameters"])
    assert set(write["parameters"]["required"]) == {"path", "content"}
    assert set(replace["parameters"]["required"]) == {"path", "oldStr", "newStr"}
    token = control._PROJECT_TOOLS.set(setup.tools)
    try:
        before = {item["function"]["name"] for item in control.list_control_tools(setup.state)}
        assert "project_write" not in before and "project_create" in before
        create(setup)
        fresh = V5SessionState.server_load(setup.sessions.load(setup.state.sessionId).payload)
        after = {item["function"]["name"] for item in control.list_control_tools(fresh)}
    finally:
        control._PROJECT_TOOLS.reset(token)
    assert "project_write" not in after and "project_str_replace" not in after
    assert {"file_read", "file_write", "file_str_replace",
            "file_find_in_content", "file_find_by_name", "shell_exec",
            "project_patch"} <= after
    assert "project_write" not in after
