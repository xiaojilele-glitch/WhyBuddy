# -*- coding: utf-8 -*-
"""服务端 doom-loop 信号的接收侧。**今天不通电，这是明说的。**

抄的标准答案：grok-build `xai-grok-sampling-types/src/doom_loop.rs`

    //! Presence is itself the detection signal.
    //! Everything here is best-effort by design: malformed payloads yield
    //! `Unknown` kinds or empty trigger sets, never an error.
    //! **The feature can never fail a stream.**

## 为什么判据要喂 grok 自己导出的字节

我们的网关（OpenAI 兼容）**不发**这个信号——`peek()` 在真机上恒 NONE。
所以这批判据不能自己编一个载荷来量（§一之二：判据自己构造护栏想要的输入，
真机不喂）。喂的是 grok 从真线上抓的、导出成常量的**逐字节样例**：

    SAMPLE_CHECK_EVENT_DATA / SAMPLE_CHECK_EVENT_DATA_CUMULATIVE

那是真数据，只是不来自我们的网关。

## 「不通电」本身也要有判据

`test_当前网关下这条路是关的` 钉住这个事实。哪天网关换了、开始发这个头，
那条判据会提醒回来改——而不是让人以为它一直在跑。
"""

from __future__ import annotations

import pytest

from sliderule_llm.doom_loop import (
    CHECK_EVENT_TYPE,
    DOOM_LOOP_CHECK_HEADER,
    MAX_COLLECTED_SIGNALS,
    MAX_SIGNAL_BYTES,
    THINKING_CHANNEL,
    Collector,
    Peek,
    Policy,
    is_check_event,
    parse_trigger,
    peek,
    report,
    resolve_policy,
    should_resample,
)

#: grok 从真线上抓的逐字节样例（`doom_loop.rs` 里导出的常量，原样抄来）。
SAMPLE = (
    '{"sequence_number":4176,"type":"response.doom_loop_check",'
    '"doom_loop_check":{"triggers":["tail_repetition:4@response"]}}'
)
SAMPLE_CUMULATIVE = (
    '{"sequence_number":4178,"type":"response.doom_loop_check",'
    '"doom_loop_check":{"triggers":["tail_repetition:4@response",'
    '"tail_repetition:2@response"]}}'
)


# ── 一、线上契约认得出来 ─────────────────────────────────────────────────


def test_中途那条事件认得出来():
    kind, signals = peek(SAMPLE)
    assert kind is Peek.CHECK_EVENT
    assert [s.raw for s in signals] == ["tail_repetition:4@response"]
    assert signals[0].kind == "tail_repetition"
    assert signals[0].threshold == 4
    assert signals[0].channel == "response"


def test_累计集合_后一帧带着前一帧的():
    """grok：中途事件带的是**累计**触发集，不是增量。"""
    _, signals = peek(SAMPLE_CUMULATIVE)
    assert len(signals) == 2


def test_终局对象上那份冗余拷贝也认():
    kind, signals = peek(
        '{"type":"response.completed","response":{"doom_loop_check":'
        '{"triggers":["low_logprob@thinking"]}}}'
    )
    assert kind is Peek.RESPONSE_FIELD
    assert signals[0].kind == "low_logprob"


def test_三种语法都认得出():
    assert parse_trigger("tail_repetition:4@thinking").kind == "tail_repetition"
    assert parse_trigger("exact_repetition:64x3@response").kind == "exact_repetition"
    assert parse_trigger("low_logprob@thinking").kind == "low_logprob"


def test_认不出的留着原文_不当成没有():
    """⚠ 认不出就当没有，会让新加的检测器家族**静静消失**。"""
    s = parse_trigger("以后新加的检测器:9@thinking")
    assert s.kind == "unknown"
    assert s.raw == "以后新加的检测器:9@thinking"
    assert s.channel == "thinking"


# ── 二、best-effort：怎么喂都不许炸 ──────────────────────────────────────


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "不是 JSON",
        # ⚠ 下面两条是**变异测试补上的**：上一版那批「畸形载荷」里没有一条
        #   同时满足「含关键词」和「JSON 不合法」，全在前置的子串判断就返回了，
        #   于是 `json.loads` 那段 except 一次都没被执行到——把它改成 `raise`
        #   照样全绿。判据在量一条自己走不到的路（§一之二 的另一面）。
        '{"doom_loop_check": 这不是合法 JSON',
        "doom_loop_check {{{ 断掉的括号",
        '{"doom_loop_check": "不是对象"}',
        '{"type":"response.doom_loop_check","doom_loop_check":{"triggers":"不是数组"}}',
        '{"type":"response.doom_loop_check"}',
        '{"response":{"doom_loop_check":null}}',
        "[1,2,3]",
        '{"doom_loop_check":{"triggers":[null,123,{}]}}',
    ],
)
def test_畸形载荷一律降级_绝不抛(bad):
    """grok：`never an error`。**The feature can never fail a stream.**"""
    kind, signals = peek(bad)
    assert kind in (Peek.NONE, Peek.CHECK_EVENT, Peek.RESPONSE_FIELD)
    assert isinstance(signals, list)


def test_没提到这个词就连JSON都不解析():
    """便宜的前置判断（grok 也这么写）。正常流量每秒几十条事件，
    为一个今天不发的信号给每条都做一次 JSON 解析是净亏。"""
    assert peek('{"type":"response.output_text.delta","delta":"你好"}') == (
        Peek.NONE,
        [],
    )


def test_单条信号有字节上限():
    s = parse_trigger("x" * (MAX_SIGNAL_BYTES + 100))
    assert len(s.raw) == MAX_SIGNAL_BYTES


def test_一次采样收的条数有上限():
    many = (
        '{"type":"response.doom_loop_check","doom_loop_check":{"triggers":['
        + ",".join(f'"tail_repetition:{i}@thinking"' for i in range(MAX_COLLECTED_SIGNALS + 20))
        + "]}}"
    )
    _, signals = peek(many)
    assert len(signals) <= MAX_COLLECTED_SIGNALS


# ── 三、认帧：光看正文里出现过这个词不算 ────────────────────────────────


def test_按事件名认():
    assert is_check_event(CHECK_EVENT_TYPE, "{}")


def test_服务端没给名字时看type():
    assert is_check_event("", SAMPLE)


def test_正文里引用了这个字符串的合法事件不许被误吞():
    """⚠ grok 专门写了这条：`The type confirmation prevents swallowing a
    legitimate event whose content text merely quotes the event-type string.`"""
    quoted = (
        '{"type":"response.output_text.delta",'
        '"delta":"我刚看到一条 response.doom_loop_check 事件"}'
    )
    assert is_check_event("", quoted) is False


def test_没名字又解析不了的帧不算():
    assert is_check_event("", "response.doom_loop_check 但不是 JSON") is False


# ── 四、收集器：上一发的信号不许漏到下一发 ──────────────────────────────


def test_一次采样一份_不许跨重试复用():
    """⚠ 漏了会让「上一次确实在打转、这一次好好的」被判成还在打转，
    于是无限重采样——而每一次单独看都像有理有据。"""
    first = Collector()
    first.observe(peek(SAMPLE)[1])
    assert first.triggered()
    second = Collector()
    assert not second.triggered(), "新的收集器带着上一发的信号"


def test_同一条不重复收():
    c = Collector()
    c.observe(peek(SAMPLE)[1])
    c.observe(peek(SAMPLE_CUMULATIVE)[1])
    assert len(c.signals) == 2, [s.raw for s in c.signals]


def test_有就是有():
    """grok：`Presence is itself the detection signal.`"""
    c = Collector()
    assert not c.triggered()
    c.observe([parse_trigger("low_logprob@thinking")])
    assert c.triggered()


# ── 五、处置：只认 thinking 通道的 tail_repetition ───────────────────────


def test_只对思考通道的紧循环动手():
    """grok：可见输出里的循环由用户自己判断，不该由机器替他判。"""
    c = Collector()
    c.observe([parse_trigger(f"tail_repetition:4@{THINKING_CHANNEL}")])
    go, why = should_resample(c, Policy(), attempts_used=0)
    assert go is True and "循环" in why


def test_可见输出通道不动手():
    c = Collector()
    c.observe([parse_trigger("tail_repetition:4@response")])
    assert should_resample(c, Policy(), attempts_used=0)[0] is False


def test_看不懂的信号照样收着_但不据以重采样():
    """处置一件看不懂的信号比不处置更糟。"""
    c = Collector()
    c.observe([parse_trigger("以后新加的:1@thinking")])
    assert c.triggered()
    assert should_resample(c, Policy(), attempts_used=0)[0] is False
    assert "以后新加的" in report(c)


def test_阈值高于上限的不算紧循环():
    c = Collector()
    c.observe([parse_trigger(f"tail_repetition:900@{THINKING_CHANNEL}")])
    assert should_resample(c, Policy(max_threshold=8), attempts_used=0)[0] is False


def test_重采样次数有上限():
    c = Collector()
    c.observe([parse_trigger(f"tail_repetition:4@{THINKING_CHANNEL}")])
    p = Policy(max_retries=2)
    assert should_resample(c, p, attempts_used=0)[0] is True
    go, why = should_resample(c, p, attempts_used=2)
    assert go is False and "不再试" in why


def test_配置写飞了夹到区间_不炸():
    p = Policy(max_threshold=99999, max_retries=99)
    assert p.max_threshold == 64 and p.max_retries == 5
    p2 = Policy(max_threshold=0, max_retries=-3)
    assert p2.max_threshold == 2 and p2.max_retries == 0


# ── 六、「不通电」这件事本身也要有判据 ──────────────────────────────────


def test_没有策略就是关着_没有单独的开关字段():
    """grok：`absence IS the off state, so there is no separate enabled flag
    to keep in sync.` 多一个 enabled 字段就多一处会跟它漂开的真相。"""
    assert resolve_policy(None) is None
    assert resolve_policy({}) is None
    assert not hasattr(Policy(), "enabled")

    c = Collector()
    c.observe([parse_trigger(f"tail_repetition:2@{THINKING_CHANNEL}")])
    assert should_resample(c, None, attempts_used=0) == (False, "")


def test_当前网关下这条路是关的():
    """⚠ **这条判据是给未来看的。**

    我们现在走通用 OpenAI 兼容接口，服务端不发 doom-loop 信号，
    也没有任何调用方会把 opt-in 头挂上去。所以这条路今天恒关。

    `peek()` 本身**已经接在控制面客户端的响应解析处**（架构闸不许留没人
    import 的模块，它那句「要么接上，要么说清为什么」是对的）。收到信号会
    留痕。缺的是**处置**：`should_resample` 还没人调，因为 Policy 缺席就是关着。

    哪天网关换了、开始挂这个 opt-in 头，这条判据会红——那时候要做的是把
    `should_resample` 也接上，而不是把这条删掉。别把「收得到」读成「会处置」。
    """
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "sliderule_llm"
    # ⚠ 排掉**定义**这个常量的那个模块本身。第一版没排，模块从 services 搬到
    #   sliderule_llm 之后判据当场红——它查的是「有没有人把这个头挂到请求上」,
    #   不是「这个常量存不存在」。
    hits = [
        p.name
        for p in root.glob("*.py")
        if p.name != "doom_loop.py" and DOOM_LOOP_CHECK_HEADER in p.read_text("utf-8")
    ]
    assert not hits, (
        f"有人开始往请求里挂 {DOOM_LOOP_CHECK_HEADER} 了（{hits}）——"
        "接线的时候把 should_resample 也接上，别只挂头收信号"
    )
