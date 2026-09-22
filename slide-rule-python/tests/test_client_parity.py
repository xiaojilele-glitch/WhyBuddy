import os
import sys
from dataclasses import replace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmError, LlmResult  # noqa: E402
from sliderule_llm.config import LlmConfig  # noqa: E402


def _sample_config(*, model: str = "primary-model", api_key: str = "primary-key") -> LlmConfig:
    return LlmConfig(
        api_key=api_key,
        base_url="https://primary.example.test/v1",
        model=model,
        router_model=None,
        wire_api="chat_completions",
        reasoning_effort=None,
        timeout_ms=30_000,
        stream=False,
        unlimited_models=(),
        model_fallbacks=(),
        max_context=1_000_000,
        max_concurrent=9999,
        provider_name="primary.example.test",
        chat_thinking_type=None,
    )


def test_classify_llm_failure_kind_maps_rate_limit():
    from sliderule_llm.client import classify_llm_failure_kind

    assert classify_llm_failure_kind(LlmError("429: rate limited", status=429, transient=True)) == "rate_limit"
    assert classify_llm_failure_kind(LlmError("out of quota", status=403, transient=True)) == "rate_limit"


def test_classify_llm_failure_kind_maps_auth_timeout_and_upstream():
    from sliderule_llm.client import classify_llm_failure_kind

    assert classify_llm_failure_kind(LlmError("auth failed (401)", status=401)) == "auth"
    assert classify_llm_failure_kind(LlmError("timeout after 30s", transient=True)) == "timeout"
    assert classify_llm_failure_kind(LlmError("upstream 503", status=503, transient=True)) == "upstream"
    assert classify_llm_failure_kind(LlmError("404: check base URL", status=404)) == "not_found"


def test_call_llm_retries_transient_errors(monkeypatch):
    from sliderule_llm.client import call_llm_with_retry

    attempts = {"count": 0}

    def flaky_call(*args, **kwargs):
        attempts["count"] += 1
        if attempts["count"] < 2:
            raise LlmError("upstream 503", status=503, transient=True)
        return LlmResult(
            content="ok",
            usage={"total_tokens": 1},
            finish_reason="stop",
            model="fake",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm", flaky_call)
    result = call_llm_with_retry([{"role": "user", "content": "hi"}], max_attempts=3)
    assert result.content == "ok"
    assert attempts["count"] == 2


def test_normalize_usage_includes_standard_token_fields():
    from sliderule_llm.client import normalize_usage

    normalized = normalize_usage({"total_tokens": 9, "prompt_tokens": 4, "completion_tokens": 5})
    assert normalized["total_tokens"] == 9
    assert normalized["prompt_tokens"] == 4
    assert normalized["completion_tokens"] == 5


def test_normalize_usage_maps_responses_api_token_fields():
    from sliderule_llm.client import normalize_usage

    normalized = normalize_usage({"input_tokens": 11, "output_tokens": 7, "total_tokens": 18})
    assert normalized["prompt_tokens"] == 11
    assert normalized["completion_tokens"] == 7
    assert normalized["total_tokens"] == 18


def test_call_llm_normalizes_finish_reason_and_usage(monkeypatch):
    from sliderule_llm.client import call_llm

    def fake_once(messages, *, cfg, **kwargs):
        return LlmResult(
            content='{"ok": true}',
            usage={"input_tokens": 3, "output_tokens": 2},
            finish_reason="STOP",
            model=cfg.model,
            latency_ms=5,
        )

    monkeypatch.setattr("sliderule_llm.client.build_provider_configs", lambda explicit=None: [("primary", _sample_config())])
    monkeypatch.setattr("sliderule_llm.client._call_llm_once", fake_once)

    result = call_llm([{"role": "user", "content": "hi"}], config=_sample_config())
    assert result.finish_reason == "stop"
    assert result.usage == {
        "total_tokens": 5,
        "prompt_tokens": 3,
        "completion_tokens": 2,
    }


def test_call_llm_once_raises_on_empty_content(monkeypatch):
    from sliderule_llm.client import _call_llm_once

    class FakeResponse:
        status_code = 200
        text = "{}"

        def json(self):
            return {
                "choices": [{"message": {"content": "   "}, "finish_reason": "stop"}],
                "model": "fake",
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr("sliderule_llm.client.httpx.Client", FakeClient)

    with pytest.raises(LlmError, match="empty content"):
        _call_llm_once([{"role": "user", "content": "hi"}], cfg=_sample_config())


def test_call_llm_json_reports_length_truncation(monkeypatch):
    from sliderule_llm.client import call_llm_json

    def fake_retry(messages, **kwargs):
        return LlmResult(
            content="not-json",
            usage={"total_tokens": 1},
            finish_reason="length",
            model="fake",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm_with_retry", fake_retry)

    with pytest.raises(LlmError, match="truncated by the max token limit"):
        call_llm_json([{"role": "user", "content": "hi"}], max_tokens=128)


def test_call_llm_json_repairs_trailing_comma(monkeypatch):
    """过夜首轮：模型吐了能修的烂 JSON，不该整条打回 GEN5。

    截断不当修（上一条）；这里是收得完整、只多数了个逗号。
    """
    from sliderule_llm.client import call_llm_json

    def fake_retry(messages, **kwargs):
        return LlmResult(
            content='{"rootNodeId": "n0",}',
            usage={"total_tokens": 1},
            finish_reason="stop",
            model="fake",
            latency_ms=1,
        )

    monkeypatch.setattr("sliderule_llm.client.call_llm_with_retry", fake_retry)
    parsed, _ = call_llm_json([{"role": "user", "content": "hi"}])
    assert parsed["rootNodeId"] == "n0"


def test_build_provider_configs_includes_fallback_provider(monkeypatch):
    from sliderule_llm.client import build_provider_configs
    from sliderule_llm.config import FallbackLlmConfig

    monkeypatch.setattr(
        "sliderule_llm.client.get_llm_config",
        lambda: _sample_config(model="primary-model"),
    )
    monkeypatch.setattr(
        "sliderule_llm.client.get_fallback_llm_config",
        lambda: FallbackLlmConfig(
            enabled=True,
            api_key="fallback-key",
            base_url="https://fallback.example.test/v1",
            model="glm-test",
            wire_api="chat_completions",
            timeout_ms=60_000,
            reasoning_effort=None,
            force_model=True,
            stream=False,
            chat_thinking_type=None,
            retries=3,
            cooldown_ms=30_000,
        ),
    )

    names = [name for name, _cfg in build_provider_configs()]
    assert names == ["primary", "fallback"]


def test_call_llm_falls_back_to_next_provider(monkeypatch):
    from sliderule_llm.client import call_llm

    primary = _sample_config(model="primary-model")
    fallback = replace(
        _sample_config(model="fallback-model", api_key="fallback-key"),
        base_url="https://fallback.example.test/v1",
    )
    calls: list[str] = []

    def fake_once(messages, *, cfg, **kwargs):
        calls.append(cfg.model)
        if cfg.model == "primary-model":
            raise LlmError("upstream 503", status=503, transient=True)
        return LlmResult(
            content="fallback-ok",
            usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            finish_reason="stop",
            model=cfg.model,
            latency_ms=2,
        )

    monkeypatch.setattr(
        "sliderule_llm.client.build_provider_configs",
        lambda explicit=None: [("primary", primary), ("fallback", fallback)],
    )
    monkeypatch.setattr("sliderule_llm.client._call_llm_once", fake_once)

    result = call_llm([{"role": "user", "content": "hi"}])
    assert calls == ["primary-model", "fallback-model"]
    assert result.content == "fallback-ok"
    assert result.model == "fallback-model"