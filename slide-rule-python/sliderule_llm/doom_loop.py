# -*- coding: utf-8 -*-
"""服务端报的「你在死循环」信号：**接收侧**。

抄的标准答案：grok-build `xai-grok-sampling-types/src/doom_loop.rs`

    //! Server-side doom-loop check: wire contract types and tolerant parsers.
    //! Presence is itself the detection signal; the set is non-empty when present.
    //! Everything here is best-effort by design: malformed payloads yield
    //! `Unknown` kinds or empty trigger sets, never an error.
    //! **The feature can never fail a stream.**

⚠ 它住在 `sliderule_llm/` 而不是 `services/`，跟 `gateway_circuit` /
  `retry_budget` 同一家——**这是网关的线上契约**，不是业务逻辑。
  第一版放在 services 里，结果接不上：`sliderule_llm`（rank 1）够不着
  `services`（rank 2），而唯一能看见这份载荷的地方就是控制面客户端。
  架构闸当场报了「没有任何人 import 它」，那句提示是对的。

跟我们已经有的 `action_stationarity` 是**同一件事的两半**：

    action_stationarity   我们自己数：连着调了同一件工具吗（客户端视角）
    这一份                服务端告诉我们：这次生成在原地绕圈（它看得见模型内部）

后者更早、更准；但它要网关配合发。

──────────────────────────────────────────────────────────────────────────
## ⚠ 这一版在当前网关下**不通电**，这是明说的，不是遗漏

信号从两个地方来（grok 的头注写得很清楚）：

  · 流中途一条非标准 SSE 事件 `response.doom_loop_check`，带**累计**触发集
  · 终局响应对象上的 `doom_loop_check` 字段（冗余的那一份）

而这些要服务端在 `x-grok-doom-loop-check` 这个 opt-in 头下才发。
我们现在走的是通用 OpenAI 兼容接口（`api.rcouyi.com`），**它不发**。
所以 `peek()` 在真机上恒返回 NONE，`decide()` 恒不重采样。

那为什么还要写？因为这是一份**线上契约的解析器**，不是一道护栏。
它跟 `closure_block_reason` 里那个 UNKNOWN 档同一性质：形状可能到来，
到来时必须认得出、认不出也不许把流搞崩。判据喂的是 grok 自己导出的
**逐字节样例**（`SAMPLE_CHECK_EVENT_DATA`），是真线上数据，不是我编的。

⚠ 别把「不通电」读成「装好了」。判据 `test_当前网关下这条路是关的`
  把这个事实钉住——哪天网关换了、开始发这个头，那条判据会提醒改。

──────────────────────────────────────────────────────────────────────────
## 没抄的：exact_repetition / low_logprob 的**处置**

grok 的策略只对 `tail_repetition:{t}@thinking` 动手（「可见输出里的循环
由用户自己判断」）。我们照抄这条：解析全认，**处置只认 thinking 通道的
tail_repetition**。别的照样记下来，但不据以重采样——处置一件看不懂的信号
比不处置更糟。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

#: opt-in 请求头。抄 grok `DOOM_LOOP_CHECK_HEADER`。
DOOM_LOOP_CHECK_HEADER = "x-grok-doom-loop-check"
#: 流中途那条非标准事件的 type。抄 grok `DOOM_LOOP_CHECK_EVENT_TYPE`。
CHECK_EVENT_TYPE = "response.doom_loop_check"
#: 只对这个通道的循环动手。抄 grok `THINKING_CHANNEL` 那句注释的理由：
#: 可见输出里的重复由用户自己判断，不该由机器替他判。
THINKING_CHANNEL = "thinking"

#: 一次采样最多收几条信号。抄 grok `MAX_COLLECTED_DOOM_LOOP_SIGNALS`。
MAX_COLLECTED_SIGNALS = 64
#: 单条信号最多几个字节。服务端塞一堆垃圾进来，撑爆的是我们的提示词。
MAX_SIGNAL_BYTES = 256


class Peek(str, Enum):
    """这份载荷里有没有 doom-loop 内容。抄 grok `DoomLoopPeek`。"""

    #: 流中途那条 check 事件——**不要往下游转发**，它不是标准事件。
    CHECK_EVENT = "check_event"
    #: 普通事件上挂着的那份冗余拷贝——记下来，照常转发。
    RESPONSE_FIELD = "response_field"
    #: 跟 doom-loop 无关。原样放行。
    NONE = "none"


@dataclass(frozen=True)
class Signal:
    """一条触发标签。**标签是不透明的**——认不出的照样留着原文。"""

    raw: str
    kind: str = "unknown"
    threshold: Optional[int] = None
    channel: str = ""


def parse_trigger(raw: Any) -> Signal:
    """解析一条标签。语法：

        tail_repetition:{threshold}@{channel}
        exact_repetition:{tokens}x{copies}@{channel}
        low_logprob@{channel}

    ⚠ 认不出一律 `kind="unknown"` 且**留着原文**，绝不抛。
      抄 grok 那句「malformed payloads yield Unknown kinds …, never an error」。
      认不出就当没有，会让新加的检测器家族静静消失。
    """
    text = str(raw or "").strip()[:MAX_SIGNAL_BYTES]
    if not text:
        return Signal(raw="", kind="unknown")
    channel = ""
    head = text
    if "@" in text:
        head, _, channel = text.partition("@")
    if head.startswith("tail_repetition:"):
        num = head.split(":", 1)[1]
        try:
            return Signal(text, "tail_repetition", int(num), channel)
        except ValueError:
            return Signal(text, "tail_repetition", None, channel)
    if head.startswith("exact_repetition:"):
        return Signal(text, "exact_repetition", None, channel)
    if head == "low_logprob":
        return Signal(text, "low_logprob", None, channel)
    return Signal(text, "unknown", None, channel)


def _triggers(node: Any) -> List[Signal]:
    if not isinstance(node, list):
        return []
    return [parse_trigger(t) for t in node[:MAX_COLLECTED_SIGNALS]]


def peek(data: str) -> Tuple[Peek, List[Signal]]:
    """从一条 SSE `data:` 里看有没有 doom-loop 内容。

    抄 grok `peek_doom_loop`，包括那条便宜的前置判断：**没提到这个词就
    连 JSON 都不解析**。正常流量每秒几十条事件，为一个今天不发的信号
    给每条都做一次 JSON 解析是净亏。
    """
    text = str(data or "")
    if "doom_loop_check" not in text:
        return Peek.NONE, []
    try:
        value = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return Peek.NONE, []
    if not isinstance(value, dict):
        return Peek.NONE, []
    if value.get("type") == CHECK_EVENT_TYPE:
        node = value.get("doom_loop_check")
        return Peek.CHECK_EVENT, _triggers(
            (node or {}).get("triggers") if isinstance(node, dict) else None
        )
    resp = value.get("response")
    if isinstance(resp, dict):
        node = resp.get("doom_loop_check")
        if isinstance(node, dict):
            return Peek.RESPONSE_FIELD, _triggers(node.get("triggers"))
    return Peek.NONE, []


def is_check_event(event_name: str, data: str) -> bool:
    """这一帧是不是那条中途事件（要拦下来别转发）。

    抄 grok `is_check_event`：先按 SSE `event:` 名认，服务端没给名字时才
    去看载荷的 `type`。**光看载荷里出现过这个词不算**——正文里引用了这个
    字符串的合法事件会被误吞。
    """
    if str(event_name or "") == CHECK_EVENT_TYPE:
        return True
    text = str(data or "")
    if CHECK_EVENT_TYPE not in text:
        return False
    try:
        value = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return False
    return isinstance(value, dict) and value.get("type") == CHECK_EVENT_TYPE


@dataclass
class Policy:
    """处置策略。抄 grok `DoomLoopRecoveryPolicy`。

    ⚠ **没有单独的开关字段**——grok 那句「absence IS the off state, so there
      is no separate enabled flag to keep in sync」。策略对象本身是 None
      就是关掉；多一个 enabled 字段就多一处会跟它漂开的真相。
    """

    #: 只对阈值不高于这个数的 tail_repetition 动手。越小说明循环越紧、越确定。
    max_threshold: int = 64
    #: 一个回合最多因为它重采样几次。
    max_retries: int = 2

    def __post_init__(self) -> None:
        # 抄 grok 的 clamp：配置写飞了不许炸，夹到合法区间。
        self.max_threshold = max(2, min(int(self.max_threshold), 64))
        self.max_retries = max(0, min(int(self.max_retries), 5))


@dataclass
class Collector:
    """一次采样一份。**不许跨重试复用**。

    ⚠ 抄 grok 那条：每次重试新建收集器，**上一发失败留下的信号不许漏到
      下一发**。漏了会让「上一次确实在打转、这一次好好的」被判成还在打转，
      于是无限重采样——而每一次单独看都像有理有据。
    """

    signals: List[Signal] = field(default_factory=list)

    def observe(self, more: List[Signal]) -> None:
        """中途事件带的是**累计**集合，所以按原文去重后整体替换语义等价，
        这里用去重追加，超上限就丢新的（旧的更可能是首次触发那一条）。"""
        seen = {s.raw for s in self.signals}
        for s in more:
            if s.raw in seen:
                continue
            if len(self.signals) >= MAX_COLLECTED_SIGNALS:
                return
            self.signals.append(s)
            seen.add(s.raw)

    def triggered(self) -> bool:
        """**有就是有**。抄 grok「Presence is itself the detection signal」。"""
        return bool(self.signals)


def should_resample(
    collector: Collector, policy: Optional[Policy], *, attempts_used: int
) -> Tuple[bool, str]:
    """要不要为这次信号重采样。返回 (要不要, 一句能据以行动的话)。

    ⚠ 策略是 None = 这个功能关着（见 Policy 头注）。今天真机就是这个状态。
    ⚠ 只认 thinking 通道的 tail_repetition（grok 的处置范围）。别的信号照样
      收着、照样能报出来，但不据以重采样——处置一件看不懂的信号比不处置更糟。
    """
    if policy is None:
        return False, ""
    if attempts_used >= policy.max_retries:
        return False, f"已经因为打转重采样 {attempts_used} 次，不再试。"
    for s in collector.signals:
        if s.kind != "tail_repetition" or s.channel != THINKING_CHANNEL:
            continue
        if s.threshold is not None and s.threshold <= policy.max_threshold:
            return True, f"服务端报了紧的思考循环（{s.raw}），重采一次。"
    return False, ""


def report(collector: Collector) -> str:
    """给日志/停因看的一句话。没有信号就是空串。"""
    if not collector.signals:
        return ""
    return "服务端报的循环信号：" + "、".join(s.raw for s in collector.signals[:6])


def resolve_policy(config: Optional[Dict[str, Any]] = None) -> Optional[Policy]:
    """从配置解析策略。**缺席就是关着**（grok：absence IS the off state）。

    ⚠ 今天没有任何调用方会传出非 None——我们的网关不发这个信号，
      开着也收不到东西。这个函数存在是为了让"哪天要开"只需要改一处。
    """
    if not isinstance(config, dict) or not config:
        return None
    return Policy(
        max_threshold=int(config.get("maxThreshold", 64) or 64),
        max_retries=int(config.get("maxRetries", 2) or 2),
    )
