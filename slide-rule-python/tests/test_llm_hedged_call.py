"""慢请求对冲（2026-08-04）——治的是"没失败但很慢"，重试治不了它。

## 为什么加

真机日志（社区消防巡检那次，6 轮 6.4 分钟）：同一个能力自己跟自己差 3~6 倍——

    critique.generate   74.8s（loop-1）  vs  22.6s（loop-4）
    synthesis.merge     69.0s（loop-2）  vs  11.3s（loop-1）

这类请求**从不报错**，所以 max_attempts 那套重试一次都不会触发；它只是排在
网关队列后面。而这两条离群值吃掉 143.8s，占全部能力时间的 41%。

## 语义照抄 gRPC hedgingPolicy

只对冲一次、谁先回用谁、副本失败不算数。三条各一个用例；另外钉住"没超时的
正常请求走的还是老路径"——对冲不该给正常请求加任何开销。
"""

import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sliderule_llm import client as C  # noqa: E402


@pytest.fixture(autouse=True)
def _fast_hedge(monkeypatch):
    """把阈值压到 50ms，用例才跑得动（默认 30s 是给真实网关的）。"""
    monkeypatch.setenv("LLM_HEDGE_DELAY_MS", "50")


def test_fast_call_never_spawns_a_hedge():
    """正常请求（没到阈值）只发一次——对冲不能给主路径加开销。"""
    calls = []

    def fake(_messages, **_kw):
        calls.append(1)
        return "fast"

    assert C._call_llm_hedged.__module__  # 存在性，防重命名后用例静默失效
    orig = C.call_llm
    try:
        C.call_llm = fake
        assert C._call_llm_hedged([], 50) == "fast"
    finally:
        C.call_llm = orig
    assert len(calls) == 1


def test_slow_call_gets_hedged_and_the_faster_copy_wins():
    """慢到超过阈值 → 补发一份；先回的那份赢，慢的那份丢掉。"""
    order = []

    def fake(_messages, **_kw):
        n = len(order)
        order.append(n)
        if n == 0:
            time.sleep(0.6)      # 原始那份：慢
            return "slow"
        return "hedge"           # 副本：立刻回

    orig = C.call_llm
    try:
        C.call_llm = fake
        t0 = time.time()
        got = C._call_llm_hedged([], 50)
        elapsed = time.time() - t0
    finally:
        C.call_llm = orig
    assert got == "hedge"
    assert len(order) == 2, "应当正好补发一份，不是每次都发或发很多份"
    # 关键：不等慢的那份跑完就返回了（0.6s 是慢的那份的时长）
    assert elapsed < 0.5, f"取到快的那份就该立刻返回，实际等了 {elapsed:.2f}s"


def test_hedge_failure_does_not_poison_a_call_that_would_have_succeeded():
    """副本失败不算数——否则"为了更快"把本来会成功的调用变成失败。"""
    order = []

    def fake(_messages, **_kw):
        n = len(order)
        order.append(n)
        if n == 0:
            time.sleep(0.3)
            return "primary-ok"
        raise C.LlmError("hedge blew up", transient=True)

    orig = C.call_llm
    try:
        C.call_llm = fake
        assert C._call_llm_hedged([], 50) == "primary-ok"
    finally:
        C.call_llm = orig


def test_hedging_can_be_switched_off_entirely(monkeypatch):
    """阈值 <= 0 → 完全走老路径，连线程池都不建。"""
    monkeypatch.setenv("LLM_HEDGE_DELAY_MS", "0")
    assert C._hedge_delay_ms() == 0

    threads_before = threading.active_count()
    calls = []

    def fake(_messages, **_kw):
        calls.append(1)
        time.sleep(0.2)          # 远超"阈值"，但阈值关了就不该有副本
        return "only-one"

    orig = C.call_llm
    try:
        C.call_llm = fake
        assert C._call_llm_hedged([], C._hedge_delay_ms()) == "only-one"
    finally:
        C.call_llm = orig
    assert len(calls) == 1
    assert threading.active_count() <= threads_before + 1


def test_default_threshold_sits_between_the_observed_fast_and_slow_runs():
    """默认阈值必须落在实测的"正常"和"离群"之间，否则形同虚设。

    实测：正常 11.3~22.6s，离群 69.0~74.8s。阈值太小 → 每个请求都裂变成两个，
    白烧配额；太大 → 慢的那份都快回来了才补发，等于没开。
    """
    monkeypatch_free = C._HEDGE_DELAY_MS_DEFAULT / 1000.0
    assert 22.6 < monkeypatch_free < 69.0


# ── 两条边界（2026-08-04 补，真机 A/B 量出来的）────────────────────
#
# 上面那几条把 gRPC hedgingPolicy 的语义抄全了，但漏了它的第四条：
# **hedgingPolicy 与 retryPolicy 在 gRPC 的 method config 里是互斥的**。
# 漏掉的代价是同一道题跑三轮量出来的：
#
#     对冲开   五系统模型流出 ——        · 18.2 分钟闭环
#     对冲关   五系统模型流出  53,172 字 · 28.1 分钟闭环
#     对冲开   五系统模型流出 316,932 字 · 30.8 分钟**未闭环**
#
# 其余 7 个能力在两组之间是 1.0~1.2 倍（几乎一致），只有 five-system-model
# 一条炸到 6.0 倍——排除了"多跑了几轮"这个解释。
#
# ⚠️ 一条**当时读错、事后订正**的观测：起初还记了"流式主路失败 1/0/2 次，对冲关
# 那组是 0"，据此以为对冲也是那个报错的原因。复查发现对冲关那组**同样出现了
# 1 次**——第一次统计时那一轮还没跑完，读的是中间态。所以 `legacy stream failed`
# 与对冲无关，**不要**拿它当这两条边界的依据；依据只有上面那组逐标签字数，
# 以及下面两个用例里可复现的交错。


def test_streaming_calls_are_never_hedged():
    """传了 on_delta 就不对冲——两份副本会同时往同一个回调里推。

    返回值仍然只取一份（那是对的），但**用户眼前的流式文字是两份内容逐块交错**。
    流式的意义就是"边生成边看"，第二份从第一个 token 起就是脏的。
    """
    gen = {"n": 0}
    seen = []

    def fake(_messages, **kw):
        gen["n"] += 1
        which = gen["n"]
        cb = kw.get("on_delta")
        for i in range(3):
            time.sleep(0.06)  # 每次都超过 50ms 阈值
            if cb:
                cb(f"[{which}-{i}]")
        return C.LlmResult(
            content=f"内容{which}", usage=None, finish_reason="stop", model="m", latency_ms=1
        )

    orig = C.call_llm
    try:
        C.call_llm = fake
        C.call_llm_with_retry([], on_delta=lambda c: seen.append(c))
    finally:
        C.call_llm = orig

    assert gen["n"] == 1, f"流式调用被对冲了，发起了 {gen['n']} 次生成"
    # 流里只能出现一份内容的编号
    assert {s.split("-")[0] for s in seen} == {"[1"}, f"流里混了多份内容：{''.join(seen)}"


def test_retry_attempts_do_not_hedge_again():
    """重试的第 2 次起不对冲——不然会**相乘**。

    `max_attempts` × `max_shape_retries` × 对冲，每次重试都重新对冲一遍；
    而对冲弄脏内容 → 校验失败 → 触发重试 → 又对冲，自己喂自己。31.7 万字
    （6 倍）就是这么滚出来的。

    重试本身已经是对"这次失败了"的响应，给一个已知失败的请求再配影子只会放大问题。
    """
    calls = {"n": 0}

    def fake(_messages, **_kw):
        calls["n"] += 1
        if calls["n"] <= 2:      # 前两次都慢+失败，逼出重试
            time.sleep(0.08)
            raise C.LlmError("gateway hiccup", transient=True)
        return C.LlmResult(
            content="ok", usage=None, finish_reason="stop", model="m", latency_ms=1
        )

    orig = C.call_llm
    try:
        C.call_llm = fake
        got = C.call_llm_with_retry([], max_attempts=3, backoff_ms=1)
    finally:
        C.call_llm = orig

    assert got.content == "ok"
    # 第 1 次尝试：原始 + 对冲 = 2 次；第 2、3 次尝试各 1 次（不再对冲）
    # 所以上限是 4。没有这条边界的话会是 2+2+2=6。
    assert calls["n"] <= 4, f"重试仍在对冲，总共发起了 {calls['n']} 次生成"


def test_non_streaming_calls_still_get_hedged():
    """两条边界都不能把对冲整个废掉——它要治的长尾还在。

    能力执行那些 74.8s/69.0s 的调用**不传 on_delta**，仍然该享受对冲。
    """
    gen = {"n": 0}

    def fake(_messages, **_kw):
        gen["n"] += 1
        if gen["n"] == 1:
            time.sleep(0.5)      # 原始那份很慢
        return C.LlmResult(
            content=f"内容{gen['n']}", usage=None, finish_reason="stop", model="m", latency_ms=1
        )

    orig = C.call_llm
    try:
        C.call_llm = fake
        got = C.call_llm_with_retry([])   # 不传 on_delta
    finally:
        C.call_llm = orig

    assert gen["n"] == 2, "非流式的慢调用没有被对冲，长尾治不了了"
    assert got.content == "内容2", "对冲发出去了，但没取先回的那份"
