"""会话日志工具行：白名单收、大字段不许进。

抄 OpenHands / AI SDK：UI 看见的工具事件必须能收成一行。
反向：project_patch 全文不许出现在这一行里。
"""

from services.control_transcript_log import tool_start_event, tool_transcript_entry


def test_start_and_result_become_transcript_rows():
    start = tool_transcript_entry({
        "type": "control_tool_start",
        "tool": "project_patch",
        "summary": "src/App.tsx",
        "content": "<html>整页</html>",
        "arguments": {"files": [{"path": "src/App.tsx", "content": "SECRET"}]},
    })
    assert start == {
        "role": "assistant",
        "kind": "tool_start",
        "tool": "project_patch",
        "summary": "src/App.tsx",
    }
    result = tool_transcript_entry({
        "type": "control_tool_result",
        "tool": "inspect_model",
        "ok": True,
        "digest": "x" * 4000,
        "content": "五系统原文",
        "human": "已看过当前模型",
        "operationId": "op-1",
    })
    assert result == {
        "role": "assistant",
        "kind": "tool_result",
        "tool": "inspect_model",
        "ok": True,
        "detail": "已看过当前模型",
        "operationId": "op-1",
    }
    dumped = str(start) + str(result)
    assert "SECRET" not in dumped
    assert "五系统原文" not in dumped
    assert "content" not in start
    assert "digest" not in result


def test_start_carries_operation_id_and_result_keeps_status():
    start = tool_start_event("project_exec", summary="npm test", operation_id="op-test")
    assert start == {
        "type": "control_tool_start",
        "tool": "project_exec",
        "summary": "npm test",
        "operationId": "op-test",
    }
    logged = tool_transcript_entry(start)
    assert logged["kind"] == "tool_start"
    assert logged["operationId"] == "op-test"
    result = tool_transcript_entry({
        "type": "control_tool_result",
        "tool": "project_exec",
        "ok": True,
        "command": "npm test",
        "operationId": "op-test",
        "status": "running",
    })
    assert result["status"] == "running"
    assert result["operationId"] == "op-test"
    assert result["detail"] == "npm test"


def test_execute_之后立刻把_operationId_补进开场():  # noqa: RUF001
    """execute 返回和 15 秒等待之间必须再 yield 一发带 id 的 start。

    只改开场那一发 = 还没 enqueue，id 是空的。只改结果 = 等满 15 秒
    才订得上 PTY，打字已经打完了。
    """
    import re
    from pathlib import Path

    raw = Path(__file__).resolve().parents[1].joinpath(
        "services", "rehearsal_control.py"
    ).read_text(encoding="utf-8")
    src = re.sub(r'""".*?"""', "", raw, flags=re.S)
    src = re.sub(r"#.*", "", src)
    execute_at = src.find("adapter.execute")
    wait_at = src.find("time.monotonic() + 15.0")
    assert execute_at != -1 and wait_at != -1 and execute_at < wait_at
    chunk = src[execute_at:wait_at]
    assert "tool_start_event" in chunk
    assert "operation_id" in chunk


def test_non_tool_events_are_ignored():
    assert tool_transcript_entry({"type": "control_text", "text": "你好"}) is None
    assert tool_transcript_entry({"type": "control_tool_start", "tool": ""}) is None
    assert tool_transcript_entry({"type": "complete"}) is None


def test_skill_start_transcript_keeps_name_not_body():
    start = tool_transcript_entry({
        "type": "control_tool_start",
        "tool": "skill",
        "summary": "frontend-design",
        "skill_message": "# SKILL.md\n跑 scripts/hello.py",
    })
    assert start == {
        "role": "assistant",
        "kind": "tool_start",
        "tool": "skill",
        "summary": "frontend-design",
    }
    assert "scripts/hello.py" not in str(start)
    assert "skill_message" not in start


def test_skill_开场带名字不带正文():  # noqa: RUF001
    """skill 的 control_tool_start 必须走 tool_start_event + 白名单摘要。

    ⚠ 第一版只 yield tool=skill，没有 summary。调了也像没调——
    会话时间线读不到技能名。变异：把 summary / tool_start_event 从
    `if name == "skill"` 那一支拿掉，本条红。
    """
    import re
    from pathlib import Path

    raw = Path(__file__).resolve().parents[1].joinpath(
        "services", "rehearsal_control.py"
    ).read_text(encoding="utf-8")
    src = re.sub(r'""".*?"""', "", raw, flags=re.S)
    src = re.sub(r"#.*", "", src)
    start = src.find('if name == "skill":')
    end = src.find('if name == "todo_write":', start)
    assert start != -1 and end != -1 and start < end
    chunk = src[start:end]
    assert "tool_start_event" in chunk
    assert "project_tool_summary" in chunk
    start_line = [line for line in chunk.splitlines() if "tool_start_event" in line]
    assert start_line, "skill 开场必须 yield tool_start_event"
    assert "summary" in start_line[0]


def test_派发出口都套了会话日志():  # noqa: RUF001
    """`_dispatch_tool(` 与 `_logged_tool_events(` 必须同数。

    定义各一，出口各四。多一个没套的 dispatch，就是 forced / 超限
    那条漏写（§4）。先剥注释，免得标识符只活在 docstring 里。
    """
    import re
    from pathlib import Path

    raw = Path(__file__).resolve().parents[1].joinpath(
        "services", "rehearsal_control.py"
    ).read_text(encoding="utf-8")
    src = re.sub(r'""".*?"""', "", raw, flags=re.S)
    src = re.sub(r"#.*", "", src)
    assert src.count("_dispatch_tool(") == src.count("_logged_tool_events(")
