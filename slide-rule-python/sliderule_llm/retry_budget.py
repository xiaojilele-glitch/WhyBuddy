# -*- coding: utf-8 -*-
"""一个回合的**累计**重试预算。抄 grok 那三层里被我们漏掉的中间层。

抄的标准答案：grok-build
`crates/codegen/xai-grok-shell/src/session/acp_session_impl/turn.rs`

    MAX_TRANSIENT_TURN_RETRIES        = 3    每步，成功后清零
    MAX_TRANSIENT_RETRIES_PER_PROMPT  = 10   整个 prompt 累计，**中途永不清零**
    MAX_TRANSIENT_RETRY_WINDOW        = 10 分钟 墙钟

第二层在 grok 里存在 actor 的 `Cell` 上，**不是循环局部变量**——那不是实现
细节，那就是这一层的全部意义。

──────────────────────────────────────────────────────────────────────────
## 病：每轮成功一次，就把重试额度赚回来了

改造前我们只有第一层：`call_control_llm` 每次调用重试 3 次
（`control_client.py` 那个 `for attempt in range(1, 4)`）。而一个控制面回合
最多 8 次调用（MAX_TOOL_ROUNDS），于是**一回合最多 24 次重试**，
网关抖一阵可以安静地烧很久。

现有三道闸一道都拦不住它：

    45s 墙钟    量的是单轮，而且 WRITE 交回后会重置（工厂时间不计控制面）
    8000 token  重试**不产生 token**，烧再多也不涨
    8 轮上限    量的是轮数，不是每轮里重试了几次

三道闸量的都是「单轮」，这个洞跨轮。**每一轮单独看都正常**——这正是它
今天看不见的原因。

──────────────────────────────────────────────────────────────────────────
## 没开预算的路径按原样跑（fail-open）

没进 `retry_budget_scope` 的调用（工厂路径 `call_llm_with_retry`、夹具、
脚本）拿到的是 None，行为一字不变。这是有意的保守：这一层只先接控制面
回合这一条链，别顺手改掉一条今天在跑且没量过的路径。
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Iterator, Optional

#: 一个回合里累计允许的瞬时重试次数。**中途永不清零。**
#:
#: 10 抄 grok 的 `MAX_TRANSIENT_RETRIES_PER_PROMPT`。这个数字在我们这边同样
#: 讲得通：单次调用上限 3（control_client）、一回合最多 8 次调用，
#: 10 落在「一两次调用重试满」和「每次调用都重试满」之间——
#: 真抖起来拦得住，偶发一两下不误伤。
#:
#: ⚠ 2026-09-18 放开的是下面那道**窗口**，不是这个次数。真机
#:   `sr-20260918125826-F00TG9S16T` 墙钟 775 秒被 600 秒窗口 canned，
#:   用户看见「npm test 已等待 8 分钟」。次数闸量的是「网关坏了」，
#:   跟「这一回合还准不准继续想」不是一回事。
MAX_RETRIES_PER_TURN = 10

#: 墙钟窗口。从回合开头起算、从不重置（WRITE 交回后控制面墙钟会重置）。
#:
#: ⚠ 2026-09-18 `sr-20260918125826-F00TG9S16T`：工程档 project-v3 已经
#:   取消轮次/墙钟，这一层却还按 grok 对话标定的 600 秒先停——闸装在
#:   通电路上、条件在真机上成立。用户看见「npm test 已等待 8 分钟」。
#:   跟 `PROJECT_BUDGET.max_wall_seconds`（86400）对齐，不许比它更短。
MAX_RETRY_WINDOW_SECONDS = 86_400.0


@dataclass
class RetryBudget:
    """一个回合一份。**不许做成模块级单例**——那会让上一个用户的重试
    记录漏到下一个身上（同 `IdenticalToolCallRun` 那条）。"""

    started: float = field(default_factory=time.monotonic)
    spent: int = 0

    def elapsed(self) -> float:
        return time.monotonic() - self.started

    def charge(self) -> int:
        """记一次重试。**只增不减**——「成功清零」是第一层的事，不是这一层。"""
        self.spent += 1
        return self.spent

    def denial(self) -> Optional[str]:
        """还能不能再重试。能就是 None，不能就返回一句能据以行动的话。

        两条闸分开说：用户读到「试了 10 次」和「网关抖了 10 分钟」
        该做的事不一样（前者是网关坏了，后者可能是这一发本来就太重）。
        """
        if self.spent >= MAX_RETRIES_PER_TURN:
            return (
                f"这一回合已经重试了 {self.spent} 次（上限 {MAX_RETRIES_PER_TURN}），"
                "网关一直不稳，先停下。"
            )
        elapsed = self.elapsed()
        if elapsed >= MAX_RETRY_WINDOW_SECONDS:
            return (
                f"这一回合重试窗口已经开了 {int(elapsed)} 秒"
                f"（上限 {int(MAX_RETRY_WINDOW_SECONDS)} 秒），先停下。"
            )
        return None

    def allows(self) -> bool:
        return self.denial() is None


_BUDGET: ContextVar[Optional[RetryBudget]] = ContextVar(
    "sliderule_retry_budget", default=None
)


@contextmanager
def retry_budget_scope(budget: Optional[RetryBudget] = None) -> Iterator[RetryBudget]:
    """给这一回合开一份预算。走 ContextVar 而不是给调用链每层加参数——
    跟本仓 `_CONTROL_PAYLOAD` 同一套机制（contextvars 会被带进工作线程）。"""
    fresh = budget if budget is not None else RetryBudget()
    token = _BUDGET.set(fresh)
    try:
        yield fresh
    finally:
        _BUDGET.reset(token)


def current_budget() -> Optional[RetryBudget]:
    """本回合的预算。**没开 scope 就是 None**，调用方按原样跑（见模块头注）。"""
    return _BUDGET.get()


def charge_retry() -> Optional[str]:
    """要重试了：先记一笔，再问还许不许。没开预算恒许（fail-open）。

    ⚠ 顺序是「先记后问」。反过来写（先问后记）会让第 10 次重试发出去
      之后才发现超了——上限就变成了 11。差一个不是小事：这一层的意义
      就是那个准确的天花板。
    """
    budget = _BUDGET.get()
    if budget is None:
        return None
    budget.charge()
    return budget.denial()
