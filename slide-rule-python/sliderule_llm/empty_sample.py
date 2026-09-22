"""Classify a completed-but-empty control sample.

抄 grok-build `xai-grok-sampling-types` 的 `ConversationResponse::empty_reason`：
思考单独一项，不算可见产出；只想不干要重采，不是判死。

⚠ 2026-09-15 TicketStream `sr-20260915165800-M6JK4H3XFB`：
  `empty content from control LLM [finish_reason=stop max_tokens=2048
  completion_tokens=5874 total_tokens=29783]`。网关 200，不是挂了。
  思考记在 usage 里，没进我们认的 `content` / `tool_calls`。控制面把空
  标成 `transient=False`，工程任务整轮停。截断会是 `length`，过滤会是
  `content_filter`——都不是这次。

`content_filter` / `length` 不许重采：前者确定性拒答，后者同发再跑还是截断。
空回复比 522 贵，同请求最多再采 1 次，计入 `retry_budget`。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional


#: 同一次 `call_control_llm` 里，空回复最多再采几次。
#: 1 = 第一发空 + 再试一发。不要抄 grok 的默认 15——那发 5874 token。
#:
#: ⚠ 2026-09-16 换网关（ahapi / gpt-5.6-luna）真机**第一次实弹命中**，
#:   整条链跟设计一致：
#:     [control] empty sample empty_reason=no_visible_content finish=unknown resample=1/1
#:     control llm loop failed after write
#:     LlmError: upstream 503 auth_unavailable ... last upstream error: server_is_overloaded
#:   网关先回一发可见内容为空 → 判成 no_visible_content、重采 1 次 →
#:   重采撞上供应商真过载 → **停下报真错，不再烧**。
#:   这里正是「1 而不是 15」的价值：上游过载时抄 grok 的默认会连采十几发。
#:   会话在这之后仍继续跑了 39 轮，没有被这一发拖死。
MAX_EMPTY_RESAMPLES = 1


class EmptyReason(str, Enum):
    #: 看见了思考，没有正文也没有工具。
    REASONING_ONLY = "reasoning_only"
    #: 可见槽和思考槽都是空的。账单上仍可能有 completion_tokens。
    NO_VISIBLE_CONTENT = "no_visible_content"


def message_reasoning(message: Any) -> str:
    """只认字符串思考字段。对象/列表不插进错误，也不当正文。"""
    if not isinstance(message, dict):
        return ""
    for key in ("reasoning_content", "reasoning"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def empty_reason(
    *,
    content: str,
    tool_calls: list[Any],
    reasoning: str,
) -> Optional[EmptyReason]:
    if (content or "").strip() or tool_calls:
        return None
    if (reasoning or "").strip():
        return EmptyReason.REASONING_ONLY
    return EmptyReason.NO_VISIBLE_CONTENT


def should_resample_empty(
    finish: str | None, reason: Optional[EmptyReason]
) -> bool:
    if reason is None:
        return False
    if finish in {"content_filter", "length"}:
        return False
    return True
