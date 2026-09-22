"""控制面 LlmError 必须说真因，不许一律「网关连不上」。

⚠ 2026-09-08 真机（会话「其他含义」）：用户 `.env` 网关直连 200，
  控制面每句 5–11s 后罐头「模型网关这会儿连不上」。真因是
  Cloudflare 522（手起 uvicorn 没灌 NO_PROXY，Windows 系统代理
  把请求送进 Clash 7890）。except Exception 把所有失败盖成同一句。
"""

from __future__ import annotations

import asyncio

import pytest  # noqa: F401 — pytest.raises in retry tests

from sliderule_llm.client import LlmError, _normalize_error
from sliderule_llm.control_client import ControlLlmResult
from sliderule_llm.gateway_circuit import reset_gateway_circuit
from services.rehearsal_control import (
    ControlStopReason,
    _provider_failure_text,
    stop_text,
)


def test_522_is_transient_gateway_timeout():
    err = _normalize_error(522, "")
    assert err.status == 522
    assert err.transient is True
    assert "522" in str(err)
    # 变异：改回 generic `upstream 522` 仍含数字，所以再钉 timeout 语义。
    assert "timeout" in str(err).lower()


def test_provider_text_keeps_522_and_does_not_blame_the_user():
    text = _provider_failure_text(
        LlmError("gateway timeout (522):", status=522, transient=True)
    )
    assert "522" in text
    assert "收到" in text
    assert text != stop_text(ControlStopReason.LLM_UNAVAILABLE)
    assert "说一个要做的应用" not in text


def test_empty_content_is_not_gateway_down():
    text = _provider_failure_text(
        LlmError("empty content from control LLM", transient=False)
    )
    assert "empty content" in text
    assert "连不上" not in text


def test_call_control_llm_retries_transient_522(monkeypatch):
    """一发 522 就罐头 = 工厂已经有的重试控制面没有。第三次成功才算修好。"""
    from sliderule_llm import control_client

    reset_gateway_circuit()
    monkeypatch.setattr(control_client, "ensure_llm_proxy_bypass", lambda: None)
    hits = {"n": 0}

    async def once(*_a, **_k):
        hits["n"] += 1
        if hits["n"] < 3:
            raise LlmError("gateway timeout (522):", status=522, transient=True)
        return ControlLlmResult(
            content="ok",
            tool_calls=[],
            usage=None,
            finish_reason="stop",
            model="x",
            latency_ms=1,
        )

    async def no_sleep(_s):
        return None

    monkeypatch.setattr(control_client, "_call_control_llm_once", once)
    monkeypatch.setattr(control_client.asyncio, "sleep", no_sleep)
    out = asyncio.run(
        control_client.call_control_llm([{"role": "user", "content": "hi"}])
    )
    assert out.content == "ok"
    assert hits["n"] == 3


def test_call_control_llm_resamples_empty_once_then_stops(monkeypatch):
    from sliderule_llm import control_client

    reset_gateway_circuit()
    monkeypatch.setattr(control_client, "ensure_llm_proxy_bypass", lambda: None)
    hits = {"n": 0}

    async def once(*_a, **_k):
        hits["n"] += 1
        raise LlmError(
            "empty content from control LLM",
            transient=True,
            empty_reason="no_visible_content",
            finish_reason="stop",
        )

    monkeypatch.setattr(control_client, "_call_control_llm_once", once)

    async def _run():
        with pytest.raises(LlmError, match="empty content") as caught:
            await control_client.call_control_llm(
                [{"role": "user", "content": "hi"}]
            )
        assert caught.value.transient is False
        assert caught.value.empty_reason == "no_visible_content"

    asyncio.run(_run())
    assert hits["n"] == 2, "空回复同请求只再采一发；采满三次就把 5874 token 再烧两遍"
