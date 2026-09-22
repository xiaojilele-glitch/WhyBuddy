"""Provider termination is a charged, terminal response on the actual HTTP path.

The 2026-09-12 project smoke received content_filter with 5759 billed tokens.
Calling a helper alone would miss the original bug: call_control_llm discarded
both the finish reason and usage when the body was empty. Filtered partial text
and tools must also stay outside the assistant transcript and diagnostics.
"""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from sliderule_llm import control_client
from sliderule_llm.client import LlmError
from sliderule_llm.gateway_circuit import reset_gateway_circuit


def install_response(monkeypatch, response: dict) -> list[httpx.Request]:
    """Keep call_control_llm real and replace only its HTTP provider transport."""
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json=response)

    original = httpx.AsyncClient
    monkeypatch.setattr(control_client.httpx, "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    monkeypatch.setattr(control_client, "get_llm_config", lambda: SimpleNamespace(
        api_key="fixture-key", base_url="https://gateway.invalid/v1",
        model="fixture-model", timeout_ms=1000))
    monkeypatch.setattr(control_client, "ensure_llm_proxy_bypass", lambda: None)
    reset_gateway_circuit()
    return requests


def sample():
    return asyncio.run(control_client.call_control_llm(
        [{"role": "user", "content": "Inspect the approved project"}], max_tokens=2048))


@pytest.mark.parametrize("message", [
    {"content": None},
    {"content": "FILTERED-PARTIAL-BODY"},
    {"content": None, "tool_calls": [{"id": "call-filtered", "type": "function", "function": {
        "name": "project_patch", "arguments": '{"content":"FILTERED-TOOL-ARGUMENT"}'}}]},
    {"content": "FILTERED-PARTIAL-BODY", "function_call": {
        "name": "project_patch", "arguments": '{"content":"FILTERED-TOOL-ARGUMENT"}'}},
])
def test_filtered_response_never_returns_content_or_tools(monkeypatch, capsys, message):
    usage = {"prompt_tokens": 5500, "completion_tokens": 259, "total_tokens": 5759}
    requests = install_response(monkeypatch, {
        "choices": [{"message": message, "finish_reason": "content_filter"}], "usage": usage,
        "response": {"doom_loop_check": {"triggers": ["FILTERED-DIAGNOSTIC"]}},
    })
    with pytest.raises(LlmError, match="content_filter") as caught:
        sample()
    error = caught.value
    assert error.transient is False
    assert error.finish_reason == "content_filter"
    assert error.usage == usage
    assert error.status is None
    assert len(requests) == 1, "A filtered response is not a retryable provider failure"
    assert "finish_reason=content_filter" in str(error)
    assert "total_tokens=5759" in str(error)
    assert "empty content" not in str(error), "Content filtering has its own cause"
    output = capsys.readouterr()
    assert "FILTERED-" not in str(error) + repr(error) + repr(vars(error)) + output.out + output.err
    assert "project_patch" not in str(error) + repr(vars(error))


def test_filter_termination_precedes_parsing_partial_tool_payload(monkeypatch):
    requests = install_response(monkeypatch, {"choices": [{
        "message": {"tool_calls": 123, "content": "FILTERED-MALFORMED"},
        "finish_reason": " CONTENT_FILTER ",
    }], "usage": {"total_tokens": 5759}})
    with pytest.raises(LlmError) as caught:
        sample()
    assert caught.value.finish_reason == "content_filter"
    assert caught.value.usage == {"total_tokens": 5759}
    assert len(requests) == 1


@pytest.mark.parametrize("finish", ["stop", "length", None])
def test_empty_body_retains_finish_usage_and_actual_request_cap(monkeypatch, finish):
    usage = {"prompt_tokens": 5500, "completion_tokens": 259, "total_tokens": 5759,
        "completion_tokens_details": {"reasoning_tokens": 259}}
    requests = install_response(monkeypatch, {
        "choices": [{"message": {"content": "  "}, "finish_reason": finish}], "usage": usage})
    with pytest.raises(LlmError, match="empty content") as caught:
        sample()
    error = caught.value
    # length 不重采；stop / 未知 finish 同请求再采一发仍空才停。
    assert len(requests) == (1 if finish == "length" else 2)
    assert error.transient is False
    assert error.finish_reason == finish
    assert error.usage == {"prompt_tokens": 5500, "completion_tokens": 259,
        "total_tokens": 5759, "reasoning_tokens": 259}
    assert f"finish_reason={finish or 'unknown'}" in str(error)
    assert "reasoning_tokens=259" in str(error)
    assert "total_tokens=5759" in str(error)
    assert "empty_reason=no_visible_content" in str(error)
    payload = json.loads(requests[0].content)
    assert f"max_tokens={payload['max_tokens']}" in str(error)
    assert ("output token limit reached" in str(error)) == (finish == "length")
    assert "LLM_MAX_TOKENS" not in str(error), "Control request cap differs from factory policy"


@pytest.mark.parametrize("bad_finish", ["DIAGNOSTIC-SECRET" * 500, {"secret": "DIAGNOSTIC-SECRET"}, 22])
def test_empty_diagnostic_drops_untrusted_metadata(monkeypatch, capsys, bad_finish):
    requests = install_response(monkeypatch, {"choices": [{"message": {}, "finish_reason": bad_finish}],
        "usage": {"prompt_tokens": 5, "completion_tokens": "DIAGNOSTIC-SECRET" * 500,
            "total_tokens": {"secret": "DIAGNOSTIC-SECRET"}, "reasoning_tokens": True,
            "provider_details": "DIAGNOSTIC-SECRET"}})
    with pytest.raises(LlmError) as caught:
        sample()
    error = caught.value
    assert len(requests) == 2
    assert error.usage == {"prompt_tokens": 5}
    assert error.finish_reason in (None, "unknown")
    assert "finish_reason=unknown" in str(error)
    assert len(str(error)) < 300
    output = capsys.readouterr()
    assert "DIAGNOSTIC-SECRET" not in str(error) + repr(vars(error)) + output.out + output.err


@pytest.mark.parametrize("usage", [None, [], "UNTRUSTED-USAGE", {
    "total_tokens": 2**80, "prompt_tokens": -1, "completion_tokens": 1.5,
    "reasoning_tokens": False}])
def test_filtered_missing_or_malformed_usage_stays_unavailable(monkeypatch, usage):
    requests = install_response(monkeypatch, {"choices": [{
        "message": {}, "finish_reason": "content_filter"}], "usage": usage})
    with pytest.raises(LlmError) as caught:
        sample()
    assert len(requests) == 1
    assert caught.value.usage is None
    assert caught.value.finish_reason == "content_filter"
    assert "UNTRUSTED-USAGE" not in str(caught.value)


@pytest.mark.parametrize("message,finish", [
    ({"content": "Ready"}, "stop"),
    ({"content": "Partial normal text"}, "length"),
    ({"content": None, "tool_calls": [{"id": "call-normal", "function": {
        "name": "project_status", "arguments": '{}'}}]}, "tool_calls"),
    ({"content": None, "function_call": {"name": "project_status", "arguments": '{}'}}, "function_call"),
])
def test_valid_text_and_tool_only_responses_still_reach_caller(monkeypatch, message, finish):
    usage = {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110}
    requests = install_response(monkeypatch, {
        "choices": [{"message": message, "finish_reason": finish}], "usage": usage})
    result = sample()
    assert len(requests) == 1
    assert result.finish_reason == finish
    assert result.usage == usage
    if message.get("content"):
        assert result.content == message["content"]
        assert result.tool_calls == []
    else:
        assert result.content == ""
        assert result.tool_calls[0]["name"] == "project_status"
        assert result.tool_calls[0]["arguments"] == {}


def test_existing_llm_error_constructor_still_has_compatible_defaults():
    error = LlmError("upstream timeout", status=522, transient=True)
    assert str(error) == "upstream timeout"
    assert error.status == 522
    assert error.transient is True
    assert error.usage is None
    assert error.finish_reason is None
    assert error.empty_reason is None
