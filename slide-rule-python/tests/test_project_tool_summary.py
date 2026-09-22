"""工具摘要：该说的说得出，不该说的一个字都不许漏。

## 这条判据的重点在**反向**那一半

摘要是为了让界面在动作进行中说得出「在对什么动手」。正向（有摘要）好写，
真正要钉死的是反向：

    approvalRef        授权令牌，闸的钥匙
    project_patch 的文件内容   一次 patch 可以是几十 KB 源码

这两样在**任何工具、任何参数组合**下都不许出现在摘要里。白名单写错一个字
就会静默泄露——不报错、不告警，只是事件流里多了点东西。

⚠ 判据直接跑产线的 `project_tool_summary`，并且**遍历真实的工具名清单**
  （`PROJECT_TOOL_NAMES`），而不是挑几个写。加了新工具却忘了想「它的参数
  能不能公开」时，这条会咬住。
"""

from services.project_tool_contracts import PROJECT_TOOL_NAMES
from services.project_tool_summary import MAX_PATHS, MAX_TEXT, project_tool_summary


SECRET = "plan-7:3:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
SOURCE = "export default function Home() { return <div>机密源码</div> }"


def test_说得出改了哪几个文件():
    summary = project_tool_summary(
        "project_patch",
        {
            "approvalRef": SECRET,
            "expectedRevision": "rev-1",
            "changes": [
                {"path": "src/Home.tsx", "content": SOURCE, "expectedSha256": "a" * 64},
                {"path": "src/api/tasks.ts", "content": SOURCE, "expectedSha256": None},
            ],
        },
    )
    assert summary == "src/Home.tsx、src/api/tasks.ts"


def test_文件多了折成等N个():
    changes = [{"path": f"src/f{i}.ts", "content": SOURCE} for i in range(9)]
    summary = project_tool_summary("project_patch", {"changes": changes})
    assert summary.endswith("等 9 个文件")
    assert summary.count("、") == MAX_PATHS - 1


def test_说得出真实命令和路径():
    assert project_tool_summary("project_exec", {"command": "build"}) == "build"
    assert (
        project_tool_summary("project_read", {"path": "src/main.tsx"}) == "src/main.tsx"
    )
    assert project_tool_summary("file_write", {"file": "src/App.tsx", "content": SOURCE}) == (
        "src/App.tsx"
    )
    assert project_tool_summary("file_read", {"file": "src/App.tsx"}) == "src/App.tsx"
    assert project_tool_summary("write_file", {"path": "src/App.tsx", "content": SOURCE}) == (
        "src/App.tsx"
    )
    assert project_tool_summary("grep", {"pattern": "task", "path": "src"}) == "task src"


def test_反向_approvalRef_在任何工具下都不许出现():
    """白名单写错一个字就静默泄露，所以遍历全部工具名，不挑着测。"""
    for name in sorted(PROJECT_TOOL_NAMES):
        summary = project_tool_summary(
            name,
            {
                "approvalRef": SECRET,
                "expectedRevision": "rev-1",
                "idempotencyKey": "key-1",
                "path": "src/main.tsx",
                "command": "check",
                "templateId": "react-vite-tasks",
                "targetRevision": "rev-0",
                "revision": "rev-1",
                "operationId": "op-1",
                "changes": [{"path": "src/a.ts", "content": SOURCE}],
            },
        )
        text = summary or ""
        assert SECRET not in text, f"{name} 的摘要漏了 approvalRef：{text!r}"
        assert "plan-7" not in text, f"{name} 的摘要漏了批准引用片段：{text!r}"


def test_反向_文件内容在任何工具下都不许出现():
    for name in sorted(PROJECT_TOOL_NAMES):
        summary = project_tool_summary(
            name,
            {"changes": [{"path": "src/a.ts", "content": SOURCE}], "content": SOURCE},
        )
        assert SOURCE not in (summary or ""), f"{name} 的摘要漏了文件内容"
        assert "机密源码" not in (summary or ""), f"{name} 的摘要漏了文件内容"


def test_反向_没列进白名单的工具不说话():
    # project_verify / project_start / project_delivery 都没进白名单：
    # 它们的参数除了 approvalRef / expectedRevision 没有可公开的信息量。
    assert project_tool_summary("project_verify", {"approvalRef": SECRET}) is None
    assert project_tool_summary("project_start", {"approvalRef": SECRET, "port": 5173}) is None


def test_skill_只说名字不说正文():
    """开场摘要白人话技能名。SKILL.md 正文不许进会话。"""
    body = "# SKILL.md\n跑 scripts/hello.py\n"
    assert project_tool_summary("skill", {"name": "frontend-design"}) == "frontend-design"
    assert project_tool_summary("skill", {"skill": "canvas-design"}) == "canvas-design"
    summary = project_tool_summary(
        "skill",
        {"name": "frontend-design", "body": body, "skill_message": body},
    )
    assert summary == "frontend-design"
    assert project_tool_summary("skill", {"name": "a", "skill": "b"}) == "a"
    assert project_tool_summary("skill", {"body": body}) is None
    assert "scripts/hello.py" not in (summary or "")
    assert "SKILL.md" not in (summary or "")


def test_反向_非工程工具和坏输入一律不说话():
    assert project_tool_summary("ask_user_question", {"path": "x"}) is None
    assert project_tool_summary("project_read", None) is None
    assert project_tool_summary("", {}) is None
    assert project_tool_summary("project_read", {"path": "   "}) is None


def test_长字符串被截断():
    long_path = "src/" + ("d/" * 400) + "x.ts"
    summary = project_tool_summary("project_read", {"path": long_path})
    assert len(summary) <= MAX_TEXT
