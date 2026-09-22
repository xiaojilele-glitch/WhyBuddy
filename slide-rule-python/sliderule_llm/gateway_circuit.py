"""网关 525/524 熔断（2026-08-18 过夜）。

## 事故

物业 R6、活动室 R6 同一形状：

    spec-first 失败，回落老链路：… HTTP 525 …
    [record_model_snapshot] 追加版本 mv-6（… 页面：沿用state）

525 是 Cloudflare「跟源站握不上 SSL」。过夜日志里一次失败 **0.3s** 就回，
`call_llm_with_retry` 仍按 200ms 连打 3 次；逐页并发再乘一层；执行器
整条 spec-first 再试一次。网关还在抖，我们自己把它打得更密。然后宽
except 打回 GEN5——GEN5 没有 HTML，快照只好「沿用state」。版本号涨了，
右边还是旧页。闸全绿。

钥匙池 `sliderule_llm/pool.py` 已经有同一套 closed / open / half_open，
但过夜主路径走的是 `call_llm_with_retry`，**池子那根熔断从来没通电**。

## 做法不是新发明

两处成熟语义，不引库、不拉仓（状态机几十行，pool.py 已经写过一遍）：

  · 本仓 pool.py：连续 2 次失败开门、30s 冷却、半开探活。数字是同一组
    标定，勿拍脑袋改（纪律六）。
  · AWS SDK standard retry
    （https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html）：
    熔断开了只关**重试**，第一次请求仍发——半开探活用的就是这一下。
    冷却未结束则连第一下都不发（抄 pool 的 skip），否则 525 过密治不住。

只认 524/525。429、503 仍走原来的 3 次退避——那些不是「源站 TLS 塌了」。

`SLIDERULE_GATEWAY_CIRCUIT=0` 整根拔掉，退回「每次都打满重试」。
"""

from __future__ import annotations

import os
import sys
import threading
import time
from typing import Any, Optional

#: 与 pool.py 的 POOL_CIRCUIT_* 同一组标定。改数字要连同钥匙池一起重跑。
FAILURE_THRESHOLD = 2
COOLDOWN_MS = 30_000

_lock = threading.Lock()
_state: dict[str, Any] = {
    "state": "closed",
    "failure_count": 0,
    "opened_until": 0.0,
}


def gateway_circuit_enabled() -> bool:
    from config.env_flags import flag

    return flag("SLIDERULE_GATEWAY_CIRCUIT", default=True)


def reset_gateway_circuit() -> None:
    """测试夹具。生产路径不许调——熔断是进程级的，清掉等于没开。"""
    with _lock:
        _state["state"] = "closed"
        _state["failure_count"] = 0
        _state["opened_until"] = 0.0


def is_gateway_handshake(error: BaseException) -> bool:
    """524 / 525 才算源站握手塌了。别把 503、耗时 525 秒误认进来。"""
    status = getattr(error, "status", None)
    if status in (524, 525):
        return True
    text = str(error).lower()
    return (
        "upstream 525" in text
        or "upstream 524" in text
        or "http 525" in text
        or "http 524" in text
        or "gateway timeout (524)" in text
        or "gateway circuit open (525" in text
    )


def is_open() -> bool:
    """冷却还没到点。半开探活时这里是 False——探活那一下必须发得出去。"""
    if not gateway_circuit_enabled():
        return False
    with _lock:
        _advance_locked(time.time())
        return _state["state"] == "open"


def retries_allowed() -> bool:
    """开门或半开：第一次仍可发，重试关掉（AWS standard 那条）。"""
    if not gateway_circuit_enabled():
        return True
    with _lock:
        _advance_locked(time.time())
        return _state["state"] == "closed"


def reject_reason() -> Optional[str]:
    """冷却未结束 → 连第一下都不发。话术里必须带 525，GEN5 闸才咬得住。"""
    if not gateway_circuit_enabled():
        return None
    with _lock:
        _advance_locked(time.time())
        if _state["state"] != "open":
            return None
        remain_ms = max(0, int(round((_state["opened_until"] - time.time()) * 1000)))
        return (
            f"gateway circuit open (525): cooling down {remain_ms}ms "
            f"(threshold={FAILURE_THRESHOLD})"
        )


def note_success() -> None:
    if not gateway_circuit_enabled():
        return
    with _lock:
        previous = _state["state"]
        _state["state"] = "closed"
        _state["failure_count"] = 0
        _state["opened_until"] = 0.0
        if previous != "closed":
            print(
                f"[gateway-circuit] 熔断关闭（此前 {previous}）",
                file=sys.stderr,
                flush=True,
            )


def note_failure(error: BaseException) -> None:
    if not gateway_circuit_enabled() or not is_gateway_handshake(error):
        return
    with _lock:
        now = time.time()
        _advance_locked(now)
        if _state["state"] == "half_open":
            _open_locked(now)
            return
        _state["failure_count"] = int(_state.get("failure_count") or 0) + 1
        if _state["failure_count"] >= FAILURE_THRESHOLD and _state["state"] != "open":
            _open_locked(now)


def _advance_locked(now: float) -> None:
    if _state["state"] != "open":
        return
    until = float(_state.get("opened_until") or 0.0)
    if until > now:
        return
    _state["state"] = "half_open"
    _state["opened_until"] = 0.0
    print(
        f"[gateway-circuit] 半开探活（连续失败 {_state.get('failure_count') or 0}）",
        file=sys.stderr,
        flush=True,
    )


def _open_locked(now: float) -> None:
    until = now + (COOLDOWN_MS / 1000.0)
    _state["state"] = "open"
    _state["failure_count"] = FAILURE_THRESHOLD
    _state["opened_until"] = until
    print(
        f"[gateway-circuit] 熔断打开（连续 {FAILURE_THRESHOLD} 次 525/524，"
        f"冷却 {COOLDOWN_MS}ms）",
        file=sys.stderr,
        flush=True,
    )
