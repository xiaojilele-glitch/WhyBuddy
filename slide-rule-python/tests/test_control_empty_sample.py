"""空控制面采样：归类在叶子里，重采走真 HTTP 入口。

⚠ 2026-09-15 TicketStream `sr-20260915165800-M6JK4H3XFB` 的原样收据：
  finish_reason=stop max_tokens=2048 completion_tokens=5874 total_tokens=29783
  没有 reasoning_tokens 字段。判据喂这一发，不许自己拼一个带 forcedTool 的。

思考只用来归类，不许当 assistant 正文——写进去 host 会当成对用户说的话。
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from sliderule_llm import control_client
from sliderule_llm.client import LlmError
from sliderule_llm.empty_sample import (
    MAX_EMPTY_RESAMPLES,
    EmptyReason,
    empty_reason,
    message_reasoning,
    should_resample_empty,
)
from test_control_provider_termination import install_response, sample


# 落盘收据。prompt = 29783 - 5874。
TICKETSTREAM_EMPTY = {
    "choices": [{"message": {"content": None}, "finish_reason": "stop"}],
    "usage": {
        "prompt_tokens": 23909,
        "completion_tokens": 5874,
        "total_tokens": 29783,
    },
}

NEXT_TOOL = {
    "model": "gateway-model",
    "choices": [{
        "message": {
            "content": None,
            "tool_calls": [{
                "id": "call-nav",
                "type": "function",
                "function": {
                    "name": "todo_write",
                    "arguments": '{"items":[{"id":"step-3","status":"in_progress"}]}',
                },
            }],
        },
        "finish_reason": "tool_calls",
    }],
    "usage": {"prompt_tokens": 100, "completion_tokens": 12, "total_tokens": 112},
}


def install_sequence(monkeypatch, bodies: list[dict]) -> list[httpx.Request]:
    requests: list[httpx.Request] = []

    def handle(request):
        requests.append(request)
        body = bodies[min(len(requests) - 1, len(bodies) - 1)]
        return httpx.Response(200, json=body)

    original = httpx.AsyncClient
    monkeypatch.setattr(
        control_client.httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs),
    )
    from types import SimpleNamespace

    monkeypatch.setattr(control_client, "get_llm_config", lambda: SimpleNamespace(
        api_key="fixture-key", base_url="https://gateway.invalid/v1",
        model="fixture-model", timeout_ms=1000))
    monkeypatch.setattr(control_client, "ensure_llm_proxy_bypass", lambda: None)
    from sliderule_llm.gateway_circuit import reset_gateway_circuit
    reset_gateway_circuit()
    return requests


def test_empty_reason_none_when_has_content_or_tools():
    assert empty_reason(content="Ready", tool_calls=[], reasoning="") is None
    assert empty_reason(
        content="",
        tool_calls=[{"name": "todo_write"}],
        reasoning="thinking",
    ) is None


def test_empty_reason_splits_thinking_from_truly_blank():
    assert empty_reason(
        content="  ",
        tool_calls=[],
        reasoning="I will patch the nav next.",
    ) is EmptyReason.REASONING_ONLY
    assert empty_reason(content="", tool_calls=[], reasoning="") is (
        EmptyReason.NO_VISIBLE_CONTENT
    )


def test_should_resample_skips_filter_and_length():
    reason = EmptyReason.REASONING_ONLY
    assert should_resample_empty("stop", reason) is True
    assert should_resample_empty(None, EmptyReason.NO_VISIBLE_CONTENT) is True
    assert should_resample_empty("content_filter", reason) is False
    assert should_resample_empty("length", reason) is False
    assert should_resample_empty("stop", None) is False


def test_message_reasoning_only_accepts_strings():
    assert message_reasoning({"reasoning_content": "  plan  "}) == "plan"
    assert message_reasoning({"reasoning": "hidden"}) == "hidden"
    assert message_reasoning({"reasoning_content": {"secret": "nope"}}) == ""
    assert message_reasoning("not-a-dict") == ""


def test_ticketstream_empty_resamples_then_takes_the_tool(monkeypatch):
    requests = install_sequence(monkeypatch, [TICKETSTREAM_EMPTY, NEXT_TOOL])
    result = sample()
    assert len(requests) == 2
    assert result.content == ""
    assert result.tool_calls[0]["name"] == "todo_write"
    assert result.finish_reason == "tool_calls"


def test_reasoning_only_is_not_returned_as_assistant_text(monkeypatch):
    thought = "I will build the TicketStream nav and routing next."
    first = {
        "choices": [{
            "message": {"content": "", "reasoning_content": thought},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 100, "completion_tokens": 80, "total_tokens": 180},
    }
    requests = install_sequence(monkeypatch, [first, NEXT_TOOL])
    result = sample()
    assert len(requests) == 2
    assert result.content == ""
    assert thought not in result.content
    assert result.tool_calls[0]["name"] == "todo_write"


def test_two_empty_stops_fail_closed_after_one_resample(monkeypatch):
    requests = install_response(monkeypatch, TICKETSTREAM_EMPTY)
    with pytest.raises(LlmError, match="empty content") as caught:
        sample()
    error = caught.value
    assert len(requests) == 1 + MAX_EMPTY_RESAMPLES
    assert error.transient is False
    assert error.empty_reason == "no_visible_content"
    assert "empty_reason=no_visible_content" in str(error)
    assert "completion_tokens=5874" in str(error)
    assert "total_tokens=29783" in str(error)
    payload = json.loads(requests[0].content)
    assert payload["max_tokens"] == 2048


def test_length_empty_does_not_resample(monkeypatch):
    requests = install_response(monkeypatch, {
        "choices": [{"message": {"content": ""}, "finish_reason": "length"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 2048, "total_tokens": 2058},
    })
    with pytest.raises(LlmError, match="output token limit reached") as caught:
        sample()
    assert len(requests) == 1
    assert caught.value.transient is False
    assert caught.value.empty_reason == "no_visible_content"
