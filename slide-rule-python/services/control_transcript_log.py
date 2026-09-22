"""会话日志里的工具行：SSE 事件 → 可落盘的一行。

抄 OpenHands EventStream.add_event / Vercel AI SDK saveChat(UIMessage[])：
host 是唯一写入方，刷新只回放这一份。UI 看见的 control_tool_start /
control_tool_result，必须能在 controlTranscript 里找到对应行。

⚠ 2026-09-15 真机 TicketStream（sr-20260915165800-M6JK4H3XFB）：
  SSE 把步骤推到左栏，会话日志却只记开口 / 问卷 / 计划。轮末
  turnNarrations 又只留下 model_speech。一刷页面，执行步骤整列蒸发。

摘要走白名单。参数里有 approvalRef 和 project_patch 全文，
不许把 content / files / html / arguments 写进会话。
"""

from __future__ import annotations

from typing import Any, Mapping

_DETAIL_KEYS = ("error", "errorCode", "command", "path", "human", "summary")
_MAX = 240
_TOOL_EVENTS = frozenset({"control_tool_start", "control_tool_result"})


def _clip(value: Any) -> str:
    return str(value).strip()[:_MAX]


def tool_start_event(tool: str, *, summary: str = "", operation_id: str = "") -> dict[str, Any]:
    """控制面工具开场。``operation_id`` 只在 execute 已经返回之后才有。"""
    event: dict[str, Any] = {"type": "control_tool_start", "tool": str(tool or "").strip()}
    clipped = _clip(summary) if summary else ""
    if clipped:
        event["summary"] = clipped
    op = _clip(operation_id) if operation_id else ""
    if op:
        event["operationId"] = op
    return event


def tool_result_detail(body: Any) -> str:
    if not isinstance(body, Mapping):
        return ""
    for key in _DETAIL_KEYS:
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return _clip(value)
    return ""


def tool_transcript_entry(event: Any) -> dict[str, Any] | None:
    """把一条 SSE 工具事件收成会话日志行。不是工具事件 → None。"""
    if not isinstance(event, Mapping):
        return None
    kind = str(event.get("type") or "")
    if kind not in _TOOL_EVENTS:
        return None
    tool = str(event.get("tool") or "").strip()
    if not tool:
        return None
    if kind == "control_tool_start":
        row: dict[str, Any] = {
            "role": "assistant",
            "kind": "tool_start",
            "tool": tool,
        }
        summary = _clip(event.get("summary") or "")
        if summary:
            row["summary"] = summary
        operation_id = event.get("operationId")
        if operation_id:
            row["operationId"] = _clip(operation_id)
        return row
    row = {
        "role": "assistant",
        "kind": "tool_result",
        "tool": tool,
        "ok": event.get("ok") is not False,
    }
    detail = tool_result_detail(event)
    if detail:
        row["detail"] = detail
    operation_id = event.get("operationId")
    if operation_id:
        row["operationId"] = _clip(operation_id)
    status = event.get("status")
    if isinstance(status, str) and status.strip():
        row["status"] = _clip(status)
    return row
