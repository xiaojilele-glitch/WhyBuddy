# -*- coding: utf-8 -*-
"""网关 525/524 熔断（2026-08-18 过夜）。

钥匙池 pool.py 有同一套状态机，过夜主路径走 call_llm_with_retry，
那根熔断没通电。525 一次 0.3s，连打 3 次 × 逐页并发 × 整条再试，
把抖着的网关打得更密，然后 GEN5 配旧页。

删掉 call_llm_with_retry 里 reject_reason / note_failure 那几针，
下面「第二次 0 次 HTTP」必红。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm.client import LlmError, LlmResult  # noqa: E402
from sliderule_llm.gateway_circuit import (  # noqa: E402
    COOLDOWN_MS,
    is_gateway_handshake,
    is_open,
    note_failure,
    note_success,
    reject_reason,
    reset_gateway_circuit,
    retries_allowed,
)


def _e525(msg: str = "upstream 525: ssl handshake") -> LlmError:
    return LlmError(msg, status=525, transient=True)


def _ok() -> LlmResult:
    return LlmResult(
        content="ok",
        usage={"total_tokens": 1},
        finish_reason="stop",
        model="fake",
        latency_ms=1,
    )


@pytest.fixture(autouse=True)
def _reset():
    reset_gateway_circuit()
    yield
    reset_gateway_circuit()


class Test认错:
    def test_525和524算握手塌了(self):
        assert is_gateway_handshake(_e525())
        assert is_gateway_handshake(LlmError("gateway timeout (524): x", status=524, transient=True))

    def test_503和耗时525秒不算(self):
        """反向：乱认会把正常退避熔断掉。"""
        assert not is_gateway_handshake(LlmError("upstream 503", status=503, transient=True))
        assert not is_gateway_handshake(LlmError("timeout after 525s", transient=True))

    def test_522_源站超时不是握手塌了(self):
        """522 该重试，不该开门熔断。认进去会把瞬时 522 打成 30s 冷却。"""
        assert not is_gateway_handshake(
            LlmError("gateway timeout (522):", status=522, transient=True)
        )


class Test状态机:
    def test_连续两次525开门(self):
        note_failure(_e525())
        assert not is_open()
        note_failure(_e525())
        assert is_open()
        assert reject_reason() and "525" in reject_reason()
        assert not retries_allowed()

    def test_一次525不门(self):
        note_failure(_e525())
        assert not is_open()
        assert retries_allowed()

    def test_成功清零(self):
        note_failure(_e525())
        note_success()
        note_failure(_e525())
        assert not is_open(), "中间成功过还开门——孤立抖动被当成过密"

    def test_503不计数(self):
        note_failure(LlmError("upstream 503", status=503, transient=True))
        note_failure(LlmError("upstream 503", status=503, transient=True))
        assert not is_open()

    def test_冷却后半开探活成功关门(self, monkeypatch):
        import sliderule_llm.gateway_circuit as gc

        now = {"v": 1000.0}
        monkeypatch.setattr(gc.time, "time", lambda: now["v"])
        note_failure(_e525())
        note_failure(_e525())
        assert is_open()
        now["v"] += COOLDOWN_MS / 1000.0 + 0.001
        assert not is_open(), "冷却到点还拦着——探活发不出去"
        assert not retries_allowed(), "半开还对冲/重试 = 过密"
        note_success()
        assert retries_allowed()
        assert reject_reason() is None

    def test_半开失败再开(self, monkeypatch):
        import sliderule_llm.gateway_circuit as gc

        now = {"v": 1000.0}
        monkeypatch.setattr(gc.time, "time", lambda: now["v"])
        note_failure(_e525())
        note_failure(_e525())
        now["v"] += COOLDOWN_MS / 1000.0 + 0.001
        assert not is_open()
        note_failure(_e525())
        assert is_open()

    def test_开关关掉当没这回事(self, monkeypatch):
        monkeypatch.setenv("SLIDERULE_GATEWAY_CIRCUIT", "0")
        note_failure(_e525())
        note_failure(_e525())
        assert not is_open()
        assert reject_reason() is None
        assert retries_allowed()


LIVE_524_EXHAUSTED = (
    'gateway timeout (524): {"error":{"message":"All available accounts exhausted"'
    ',"type":"server_error"}}'
)


class Test账号池空:
    def test_524_accounts_exhausted_opens_circuit(self):
        err = LlmError(LIVE_524_EXHAUSTED, status=524, transient=True)
        assert is_gateway_handshake(err)
        note_failure(err)
        note_failure(err)
        assert is_open()
        assert reject_reason()


class Test接线_重试:
    """纪律一：必须走 call_llm_with_retry，只测状态机假绿。"""

    def test_两次525后第三次不发_第二次调用零HTTP(self, monkeypatch):
        from sliderule_llm.client import call_llm_with_retry

        hits = {"n": 0}

        def boom(*a, **k):
            hits["n"] += 1
            raise _e525()

        monkeypatch.setattr("sliderule_llm.client.call_llm", boom)
        with pytest.raises(LlmError) as first:
            call_llm_with_retry([{"role": "user", "content": "x"}], max_attempts=3, backoff_ms=0)
        assert first.value.status == 525
        first_hits = hits["n"]
        assert first_hits == 2, (
            f"熔断阈值是 2，同一调用还打了 {first_hits} 次——过密治不住"
        )

        hits["n"] = 0
        with pytest.raises(LlmError) as second:
            call_llm_with_retry([{"role": "user", "content": "x"}], max_attempts=3, backoff_ms=0)
        assert hits["n"] == 0, "熔断开着还打 HTTP——物业 R6 那种连打"
        assert "525" in str(second.value), "话术丢了 525，上层会当成别的错打回 GEN5"

    def test_524_accounts_exhausted_must_not_retry_like_429(self, monkeypatch):
        """反：把 524 账号池空当 429 连打 3 次必须红。"""
        import asyncio
        from sliderule_llm.control_client import call_control_llm

        hits = {"n": 0}

        async def boom(*a, **k):
            hits["n"] += 1
            raise LlmError(LIVE_524_EXHAUSTED, status=524, transient=True)

        monkeypatch.setattr("sliderule_llm.control_client._call_control_llm_once", boom)
        with pytest.raises(LlmError):
            asyncio.run(call_control_llm([{"role": "user", "content": "x"}]))
        assert hits["n"] <= 2, f"把 524 当 429 连打了 {hits['n']} 次"

    def test_503仍打满重试(self, monkeypatch):
        """反向：熔断不能误伤原来的 503 退避。"""
        from sliderule_llm.client import call_llm_with_retry

        hits = {"n": 0}

        def boom(*a, **k):
            hits["n"] += 1
            raise LlmError("upstream 503", status=503, transient=True)

        monkeypatch.setattr("sliderule_llm.client.call_llm", boom)
        with pytest.raises(LlmError):
            call_llm_with_retry([{"role": "user", "content": "x"}], max_attempts=3, backoff_ms=0)
        assert hits["n"] == 3, f"503 被熔断截短了：只打了 {hits['n']} 次"
