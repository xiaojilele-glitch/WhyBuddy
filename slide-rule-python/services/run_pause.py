"""协作式暂停：在安全点上停下来等人（2026-08-28 验证件，第二版）。

⚠ 机制 + 流式接线已经在 2026-08-28 接上（`v5_full_driver` 循环、
  `/runs/{id}/hold|release`、前端「先别往下跑」）。产品还没决定**哪些澄清
  值得主动拦**——那是另一件事，见文末。

## 为什么需要它

伴随式澄清目前不拦路，理由写在 spec-assumptions 模块头：「工厂中途停下来
等回答会撞上闭环的 fail-closed 语义」。2026-08-28 把这句话拆开实测：

  ① 闭环判据（v5_publish_closure_response）**纯看状态、时间无关**。拿真会话
     sr-20260827191954 把 capabilityRuns 逐条截断实测：截到 8 条
     blocked=False，截到 7 条及以下一律 fail-closed。判据只认最后那条
     ``appbundle.runtimeClosure`` 有没有产出报告，前七条零贡献。

  ② 真机把一轮跑到 75 秒掐掉：runtimePhase=awaiting / awaitReason=no_progress，
     前 7 条有产出，第 8 条 execution 闸 failed、result 为空，
     publishClosure=null，modelVersions=0。

所以"中途停 = 白烧一轮"是真的，但病根是**今天唯一的停法是终止性取消**，
不是"停"本身。只要这一轮最后还走得到 runtimeClosure，闸就认。

## 第二版改了什么（照 grok-build 的 AskUserQuestion 重写）

第一版是**线程里 `threading.Event.wait()` 干等**，于是自带一个约束：
暂停期间占住 event-loop executor 的一个槽（启动日志：64 个，一组流式推演
占 5 槽）。那个约束是**第一版自己造出来的**，不是问题固有的。

grok 的做法（`xai-grok-tools/.../ask_user_question/mod.rs:458`）：

    let outcome = match wait {
        Some(dur) => tokio::time::timeout(dur, result_rx).await,
        None      => Ok(result_rx.await),
    };

**异步 await 一个通道，一个工作线程都不占。**

对应到这里：安全点提到**异步那一层**——引擎每一步是
``await asyncio.to_thread(...)``，暂停放在**两次 to_thread 之间**的协程里等。
这跟 run_cancel 头注那句「安全点放在步与步之间，别放进循环内层」本来就是
同一句话，只是那时没意识到它同时解决了占槽。

⚠ 代价与取消一样：一步有多大，暂停就最多迟到多久（真机单步量到过 918 秒）。
  这是协作式模型的固有取舍，run_cancel 头注已经论证过，不在这里重复权衡。

## 超时**不是失败**——这条是要害

grok 的模块头：

    Default max time to wait for the user to answer: 30 minutes.
    On expiry the tool returns the same skipped/cancel text as a user
    dismiss, **not a tool failure**.

所以"关掉页面 600 秒后被看门狗收掉"那个约束，正解不是"把 600 秒调大"，
而是**超时按「用户跳过」处理**：推演继续往下跑，走到最后一步，闭环照样绿。

这跟本仓现成的语义严丝合缝——spec-assumptions 头注写着「不点 = 就按模型
定的做，**这是个合法结局**」。等的就是同一件事，超时就按那个合法结局走。

三个细节一并照抄：
  · ``enabled=False`` = 永远等；**``seconds=0`` 明确不表示"永远等"**，
    那是另一个开关的活（grok 对 0 专门打警告并回落默认预算）。
  · 一次问一批共用**一个**计时器，不是每题一个。
  · ``non_interactive``：**没人在场**（页面关了 / 无头跑）时报的是
    "没有操作员"，不是"用户拒绝"。两者对下游是不同的事实，别揉成一个。

## 没人答怎么办：照 claw-code 的恢复配方

claw-code 把「问了人没人答」列成**六个已知故障场景之一**
（`runtime/src/recovery_recipes.rs` 的 ``TrustPromptUnresolved``）：

    RecoveryRecipe {
        steps: vec![RecoveryStep::AcceptTrustPrompt],   // 先自动按默认走一次
        max_attempts: 1,                                 // 只自动一次
        escalation_policy: EscalationPolicy::AlertHuman, // 再不行才喊人
    }

要害是**「没人答」是要预先设计的正常场景，不是异常**：自动按默认继续一次，
只走一次，还不行才升级喊人，每次尝试都留一条结构化事件。见
`unresolved_recovery` 与 `RecoveryLedger`。

## 产品判断（2026-09-02 已拍板）

  - **伴随式假设值得主动拦。** 入选门槛本来就是「改了产品会长得不一样」，
    能上卡的全是结构性的。真机上「只摊开不拦」用户对着一排改成 X 不知道
    怎么继续——做成跟点火前澄清卡同一套权力：一题一题选，点「确认继续」
    才放行。`spec_first_pipeline._emit_assumptions` 出卡时调 `hold_current()`。
  - **关页面 ≠ 取消**：孤儿看门狗（默认 600s 无人观看就 `request_cancel`）
    跟暂停闸是两件事。暂停等人时不烧 LLM，关页面不该把这一轮判死——
    标成没人在场，超时按跳过收口，这一轮接着跑完。看门狗自己守着
    `is_holding` / `orphan_exempt`，见 `run_registry._orphan_watchdog`。
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from contextvars import ContextVar
from typing import Any, Dict, Optional, Tuple

from .run_cancel import RunCancelled, is_cancelled

#: 醒来查一次取消的间隔。异步等待没有线程成本，所以这个值只影响取消的
#: 响应快慢：必须**明显小于** run_registry 的 5 秒硬取消宽限，否则硬取消
#: 会先于协作式退出发生，退回"停没停不知道"。
_POLL_SECONDS = 0.25

#: 默认等多久。照 grok 的 30 分钟——它是"人去倒杯咖啡回来还来得及"的量级，
#: 而不是"网络超时"的量级。等人跟等机器不是一回事。
DEFAULT_WAIT_SECONDS = 30 * 60.0


class PauseOutcome(str, Enum):
    """一次「停下来问人」的结局。**四种都是如实的事实，没有一种是异常。**

    ⚠ 别把 SKIPPED 和 NO_OPERATOR 揉成一个。前者是"人在，看了，没选"，
      后者是"根本没人在场"——对下游是不同的事实（要不要在收口句里提这件事、
      要不要下一轮再问一遍，两种答案不一样）。grok 为此专门有
      `non_interactive` 一档，报的是 NO_OPERATOR_TEXT 而不是用户拒绝。
    """

    #: 人答了
    ANSWERED = "answered"
    #: 超时，或人明确跳过 —— 按模型定的做，**合法结局**，不是失败
    SKIPPED = "skipped"
    #: 没人在场（页面关了 / 无头跑）
    NO_OPERATOR = "no_operator"
    #: 整轮被取消（取消赢过暂停）
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class PauseBudget:
    """等多久、以及场上有没有人。

    ⚠ ``seconds=0`` **不表示"永远等"**——那是 ``enabled=False`` 的活。
      0 一律回落默认预算并留一行告警（照 grok：「0 must never mean
      'wait forever' — that is timeout_enabled's job」）。把"不限时"和
      "限时 0 秒"塞进同一个字段，读的人分不出来，写的人迟早写错。
    """

    enabled: bool = True
    seconds: float = DEFAULT_WAIT_SECONDS
    #: 没有操作员在场（页面关了 / 无头跑）。结局报 NO_OPERATOR。
    non_interactive: bool = False

    def wait_budget(self) -> Optional[float]:
        """None = 永远等；否则是秒数。"""
        if not self.enabled:
            return None
        if self.seconds and self.seconds > 0:
            return float(self.seconds)
        return DEFAULT_WAIT_SECONDS


@dataclass(frozen=True)
class PauseResult:
    outcome: PauseOutcome
    where: str
    waited_seconds: float
    #: 人答了什么。只有 ANSWERED 时有值。
    answer: Optional[Any] = None

    @property
    def answered(self) -> bool:
        return self.outcome is PauseOutcome.ANSWERED

    @property
    def proceed_with_default(self) -> bool:
        """该按模型自己定的往下走吗。

        SKIPPED / NO_OPERATOR 都是——**这两种都不许把这一轮判死**。
        """
        return self.outcome in (PauseOutcome.SKIPPED, PauseOutcome.NO_OPERATOR)


class PauseGate:
    """一次「停下来问人」。**异步等，不占执行槽。**

    用法（在驱动器的协程里，两次 to_thread 之间）::

        gate = PauseGate(PauseBudget(non_interactive=no_subscribers))
        ...把问题推给前端，前端答完调 gate.answer(...)...
        result = await gate.wait("第4.5步 改键前")
        if result.answered:
            ...按人选的走...
        # 其余一律往下跑：超时/没人在场都是合法结局，不许拦死这一轮
    """

    def __init__(self, budget: Optional[PauseBudget] = None) -> None:
        self._budget = budget or PauseBudget()
        self._event = asyncio.Event()
        self._answer: Optional[Any] = None
        self._skipped = False
        #: 场上还有没有人。预算里的 non_interactive 是起闸时的初值；
        #: 订阅者走光 / 回来会改这一格，预算本身保持冻结。
        self._unattended = bool(self._budget.non_interactive)
        #: 停在哪儿、从什么时候开始等。**只为了让外面看得见**（run_registry
        #: 的快照要能回答"这个 run 是在等人还是挂了"）。
        #:
        #: ⚠ 2026-09-06 加的。之前 `where` 只作为 `wait()` 的入参存在，等待
        #:   状态在进程里**没有任何可观测的落点**：`runs/active` 只报
        #:   `status:"running"`，刷新回来的浏览器分不出"在等你"和"服务端死了"。
        #:   照 grok `xai-grok-session-events` 的 `Phase::PermissionPrompt`——
        #:   等人是会话的一个**相**，不是"跑着"的一个子情况。
        self._where: str = ""
        self._started_at: Optional[float] = None

    def mark_no_operator(self) -> None:
        """页面关了 / 订阅者走光。超时报 NO_OPERATOR，不是用户跳过。"""
        self._unattended = True

    def clear_unattended(self) -> None:
        """操作员回来了。下一回超时恢复成"用户跳过"。"""
        self._unattended = False

    # —— 外部（前端回调 / 控制面）调的三个 ——
    def answer(self, payload: Any) -> None:
        """人答了。"""
        self._answer = payload
        self._event.set()

    def skip(self) -> None:
        """人明确说"就这样"。跟超时同一个结局。"""
        self._skipped = True
        self._event.set()

    @property
    def budget(self) -> PauseBudget:
        return self._budget

    def arm(self, where: str) -> float:
        """把这道闸置成「真的在等」：记下**等什么**和**从什么时候开始等**，
        返回起算时刻。

        ## 为什么要单独有它（2026-09-06 第二轮真机）

        停泊那一刻立刻问 `GET /runs/active`，拿到的是：

            {"phase": "waiting", "where": "", "waitedSeconds": null,
             "budgetSeconds": 1800}

        自相矛盾——说"正在等"，却说不出等什么、等了多久。因为当时这两格是
        `wait()` 进去之后才写的，而 `phase` 是从 `slot.active` 推的，而
        `take_hold()` 把闸转成 active 发生在 `await wait()` **之前**。
        两步之间那道缝就是这个窗口。上一轮我等了 1.2 秒才问，正好躲过去了。

        ## 抄的是 grok 的哪一处

        `xai-grok-session-events/src/tracker.rs`：

            /// Emits `PhaseChanged(PermissionPrompt)` and then `PermissionRequested`.
            /// Returns the `Instant` that `permission_resolved()` uses to compute `wait_ms`.
            pub fn permission_requested(&self, tool_name: &str) -> Instant {
                self.emit(Event::PhaseChanged { phase: Phase::PermissionPrompt });
                self.emit(Event::PermissionRequested { tool_name: tool_name.to_string() });
                Instant::now()
            }

        三件事**一次全部建立**：相位、等什么、起算时刻。而且起算时刻被
        **交回调用方**——`permission_resolved(…, start)` 必须拿着它，配对成了
        结构上的必然。它那个写法在结构上不可能出现"相位说在等、却不知道等什么"。

        ⚠ 幂等：重复 arm 不改起算时刻。否则刷新一次快照就把"等了多久"清零，
          那比不报更骗人（用户会以为闸刚挂上）。
        """
        if self._started_at is None:
            self._where = str(where or "")
            self._started_at = time.monotonic()
        elif where and not self._where:
            # arm 过但当时没给 where（不该发生），后来知道了就补上，不动时刻。
            self._where = str(where)
        return self._started_at

    @property
    def armed(self) -> bool:
        """已经开始等了吗。**这才是"正在等"的事实**，`slot.active` 只说明
        闸被取走了。`hold_state()` 的 phase 按这一格判。"""
        return self._started_at is not None

    async def wait(self, where: str) -> PauseResult:
        """停在这儿等。**不抛异常**——四种结局都由返回值如实说出来。

        ⚠ 只有一种情况抛：整轮被取消。那时候语义上取消赢，且必须跟
          `raise_if_cancelled` 同一个异常类型，否则沿途 `except Exception`
          的 fail-open 兜底层会把它当成"这一步失败了"接住（见 RunCancelled
          的头注：特意不继承 CancelledError 就是为了能被接住，这里要的是
          同一套行为）。
        """
        # 落点在 `arm()` 里落。调用方（驱动器）应当在**发出「我在等你」之前**
        # 就 arm 过；没 arm 过的（脚本 / 判据直调）这里补上，语义不变。
        started = self.arm(where) if self._started_at is None else self._started_at
        budget = self._budget.wait_budget()
        deadline = None if budget is None else started + budget

        while True:
            if is_cancelled():
                raise RunCancelled(f"已请求取消，停在 {where} 的暂停闸上")
            if self._event.is_set():
                break
            now = time.monotonic()
            if deadline is not None and now >= deadline:
                return self._settle(PauseOutcome.SKIPPED, where, started)
            slice_s = _POLL_SECONDS
            if deadline is not None:
                slice_s = min(slice_s, max(deadline - now, 0.0))
            try:
                await asyncio.wait_for(self._event.wait(), timeout=slice_s or _POLL_SECONDS)
            except asyncio.TimeoutError:
                continue  # 醒来查一次取消/截止，再接着等

        if self._skipped or self._answer is None:
            return self._settle(PauseOutcome.SKIPPED, where, started)
        return self._settle(PauseOutcome.ANSWERED, where, started, self._answer)

    def _settle(
        self,
        outcome: PauseOutcome,
        where: str,
        started: float,
        answer: Any = None,
    ) -> PauseResult:
        # 没人在场时，"没答"报的是 NO_OPERATOR 而不是"用户跳过"——
        # 那不是用户的选择，是压根没有用户（照 grok 的 non_interactive）。
        if outcome is PauseOutcome.SKIPPED and self._unattended:
            outcome = PauseOutcome.NO_OPERATOR
        return PauseResult(
            outcome=outcome,
            where=where,
            waited_seconds=round(time.monotonic() - started, 3),
            answer=answer,
        )


# ── 没人答怎么办：照 claw-code 的恢复配方 ────────────────────────────


@dataclass(frozen=True)
class RecoveryRecipe:
    """一个已知故障场景的自动恢复配方。

    照 claw-code `runtime/src/recovery_recipes.rs`：**「问了人没人答」是六个
    已知故障场景之一，不是异常**。自动按默认走一次，只走一次，还不行才升级
    喊人，每次尝试留一条结构化事件。
    """

    scenario: str
    steps: Tuple[str, ...]
    max_attempts: int
    escalation: str


#: 「停下来问了，但没人答」的配方。
#: steps 只有一步："按模型自己定的往下走"——那正是 spec-assumptions 头注
#: 认定的合法结局，所以自动执行它不需要额外授权。
UNRESOLVED_RECOVERY = RecoveryRecipe(
    scenario="pause_unresolved",
    steps=("按模型自己定的往下走",),
    max_attempts=1,
    escalation="alert_human",
)


@dataclass
class RecoveryAttempt:
    scenario: str
    attempted: bool
    attempts_remaining: int
    escalate: bool
    reason: str
    #: 结构化事件：留痕用，一次尝试一条（claw-code 的 recovery event）
    event: Dict[str, Any] = field(default_factory=dict)


class RecoveryLedger:
    """记每个场景自动恢复过几次。超了配方的次数就升级，不再默默重试。

    ⚠ 「只自动一次」是配方的一部分，不是可调的旋钮：自动重试第二次意味着
      同一个没人理的问题会把这一轮拖两遍，而人还是没来。第二次该做的是
      喊人，不是再试。
    """

    def __init__(self) -> None:
        self._used: Dict[str, int] = {}

    def attempt(
        self, recipe: RecoveryRecipe = UNRESOLVED_RECOVERY, *, detail: str = ""
    ) -> RecoveryAttempt:
        used = self._used.get(recipe.scenario, 0)
        remaining = max(recipe.max_attempts - used, 0)
        if remaining <= 0:
            return RecoveryAttempt(
                scenario=recipe.scenario,
                attempted=False,
                attempts_remaining=0,
                escalate=True,
                reason=f"自动恢复已用满 {recipe.max_attempts} 次，升级：{recipe.escalation}",
                event={
                    "kind": "recovery_escalated",
                    "scenario": recipe.scenario,
                    "policy": recipe.escalation,
                    "detail": detail,
                },
            )
        self._used[recipe.scenario] = used + 1
        return RecoveryAttempt(
            scenario=recipe.scenario,
            attempted=True,
            attempts_remaining=remaining - 1,
            escalate=False,
            reason=f"自动恢复：{'、'.join(recipe.steps)}",
            event={
                "kind": "recovery_attempted",
                "scenario": recipe.scenario,
                "steps": list(recipe.steps),
                "attempt": used + 1,
                "detail": detail,
            },
        )


def recover_from(
    result: PauseResult, ledger: RecoveryLedger
) -> Optional[RecoveryAttempt]:
    """人答了就不需要恢复；没答就按配方走一次。

    ⚠ 返回 None 只表示"这次不需要恢复"，**不表示出错**。调用方拿到
      `attempted=True` 就照默认往下跑，拿到 `escalate=True` 才喊人。
    """
    if result.answered:
        return None
    return ledger.attempt(detail=f"{result.outcome.value}@{result.where}")


# ── 接线：一个 run 的暂停位 ──────────────────────────────────────────
#
# 形状照 run_cancel：run_registry 起跑前把位子绑进 ContextVar，驱动器在安全点
# 读它，路由通过 run_id 找到同一个位子往里放 gate。
#
# ⚠ 为什么绑「位子」而不是绑 gate：gate 是**用户按下暂停那一刻**才造出来的，
#   而绑定必须发生在**起跑之前**（asyncio.to_thread 复制的是那一刻的 Context，
#   绑晚了读到的就是 None——run_cancel 头注为此专门写过一段）。所以绑一个
#   可变的位子，事后往里放东西。


@dataclass
class PauseSlot:
    """一个 run 的暂停位。

    ⚠ 两格，不是一格（2026-08-28 真机咬出来的）。第一版只有一格、
      `take_hold` 把闸**取走**——于是驱动器一开始等，路由按 run_id 就再也
      找不到那个闸，`release` 恒返回 released=false，这一轮永远停在那儿。
      真机实测：按暂停 → 停住 ✅ → 放行 → `{"released":false}`、15 秒零新
      事件。而单测全绿，因为它直接拿着 gate 对象调 answer，**绕过了位子
      查找**——正向判据齐全、反向判据缺失（CLAUDE.md §3）。

    pending 是"按了还没到安全点"，active 是"正在等"。放行两格都认：用户
    可能在安全点到达之前就答了，那时闸还在 pending 里（路由头注说的那个
    正常竞态）。
    """

    pending: Optional["PauseGate"] = None
    active: Optional["PauseGate"] = None
    #: 没人在场时按跳过收口过 → 这一轮接着跑完，孤儿看门狗不许再判死。
    #: 只在「无人 + 跳过/没操作员」时立；人答了再关页面，看门狗照常收。
    orphan_exempt: bool = False


_SLOT: ContextVar[Optional[PauseSlot]] = ContextVar(
    "sliderule_run_pause_slot", default=None
)


def _slot_var() -> ContextVar:
    return _SLOT


def new_slot() -> PauseSlot:
    return PauseSlot()


def bind(slot: Optional[PauseSlot]) -> None:
    """绑到当前上下文。**必须在起跑前调用**（理由同 run_cancel.bind）。"""
    _slot_var().set(slot)


def current_slot() -> Optional[PauseSlot]:
    """流水线问：这一轮有没有位子。没绑就 None，不许抛。"""
    try:
        return _slot_var().get()
    except Exception:  # noqa: BLE001
        return None


def pause_enabled() -> bool:
    """`SLIDERULE_RUN_PAUSE_ENABLED=0` 关掉整条暂停线路。默认开。

    ⚠ 默认开是安全的：**不按暂停就一个字都不变**——安全点只多一次字典读取，
      没有任何人放 gate 进来时立刻返回。关掉的开关留着，是因为它能停住一条
      跑了两分钟的推演，出事时要有一根总闸。
    """
    import os

    from .env_flags import flag

    return flag("SLIDERULE_RUN_PAUSE_ENABLED", default=True)


def request_hold(slot: Optional[PauseSlot], budget: Optional[PauseBudget] = None) -> Optional[PauseGate]:
    """用户按了「先别往下跑」。下一个安全点会停住。

    已经有一个在等就返回原来那个——重复按不该开出第二道闸。
    """
    if slot is None or not pause_enabled():
        return None
    existing = slot.active or slot.pending
    if existing is not None:
        return existing
    slot.pending = PauseGate(budget)
    return slot.pending


def hold_current() -> None:
    """假设出口：有结构性决定时主动拦到下一安全点。失败不许拖垮推演。"""
    try:
        request_hold(_SLOT.get())
    except Exception:  # noqa: BLE001
        return


def take_hold() -> Optional[PauseGate]:
    """驱动器在安全点调：有人按过暂停就把闸转成"正在等"，没有就 None（零成本）。

    ⚠ **转成 active，不是取走**。取走的话路由就找不到它了——见 PauseSlot
      头注里那次真机。
    """
    slot = _slot_var().get()
    if slot is None or slot.pending is None:
        return None
    gate = slot.pending
    slot.pending = None
    slot.active = gate
    return gate


def finish_hold() -> None:
    """等完了：把"正在等"清掉。不清的话下一轮的 release 会打到一个已经
    结束的闸上，返回 released=true 却什么也没发生。

    没人在场时按跳过收口的，给位子打上 ``orphan_exempt``：后面接着烧的
    那几步没有观众，但这一轮已经决定跑完（超时 = 合法结局），孤儿看门狗
    不许再把闭环掐死。
    """
    slot = _slot_var().get()
    if slot is None:
        return
    gate = slot.active
    if gate is not None and getattr(gate, "_unattended", False):
        slot.orphan_exempt = True
    slot.active = None


def is_holding(slot: Optional[PauseSlot]) -> bool:
    """位子上有闸（按了还没到 / 正在等）。孤儿看门狗靠这个决定别取消。"""
    return slot is not None and (slot.active is not None or slot.pending is not None)


def hold_state(slot: Optional[PauseSlot]) -> Optional[Dict[str, Any]]:
    """这个 run 现在是不是在等人；是的话，等什么、等了多久、还能等多久。

    ## 为什么要有它（2026-09-06 真机）

    `Run.snapshot()` 只报 `status` / `cancelRequested` / `hardCancelled` / `seq`，
    **没有"正在等人"这一格**。于是停泊 30 分钟期间：

        GET /api/sliderule/runs/active  →  {"status":"running", …}

    刷新回来的浏览器拿到一个"在跑"的 run，却一个事件都不会再来（停泊期间
    零事件），分不出"在等你答假设卡"和"服务端死了"。而 `run_pause` 里
    `status` 描述的是**引擎**——这个区分 `is_live` 的头注早就写清楚了，
    只是快照没跟上。

    照 grok `xai-grok-session-events/src/types.rs` 的 `Phase`：

        pub enum Phase { WaitingForModel, StreamingText, StreamingReasoning,
                         ToolExecution, PermissionPrompt }

    `PermissionPrompt` 就是"正在等人"那一格——等人是会话的一个**相**，
    不是"跑着"的一个子情况。

    ## 两格分开报，因为它们不是同一件事

        pending  按了暂停 / 出了假设卡，但还没走到安全点  → 马上就要停
        waiting  已经停住，正在等答案                      → 现在就在等你

    合成一个布尔的话，前端没法区分"再等一下就停"和"已经停了快答"。
    """
    if slot is None:
        return None
    gate = slot.active or slot.pending
    if gate is None:
        return None
    # ⚠ phase 按**真的开始等了没有**判（`gate.armed`），不按「闸被取走了」
    #   （`slot.active`）判。第二轮真机在那两步之间的缝里问到过
    #   `{"phase":"waiting","where":"","waitedSeconds":null}` —— 说在等却说不出
    #   等什么、等了多久。一个说不出内容的状态字，比没有这个字更糟：
    #   前端会照着它把「快答」的按钮点亮，而此时闸还没进 wait()。
    #
    #   `active` 但还没 arm 的那几毫秒如实报 `pending`（"马上就要停"），
    #   这跟用户此刻能做的事一致 —— `release_run` 两格都认，答案照样收得下。
    started = getattr(gate, "_started_at", None)
    phase = "waiting" if started is not None else "pending"
    waited = None if started is None else round(time.monotonic() - started, 3)
    budget = None
    try:
        budget = gate.budget.wait_budget()
    except Exception:  # noqa: BLE001 — 读不到预算不该让快照整体失败
        pass
    return {
        "phase": phase,
        "where": str(getattr(gate, "_where", "") or ""),
        "waitedSeconds": waited,
        # None = 不限时（`timeout_enabled=false`）。⚠ 不许拿 0 表示不限时——
        # 那是 `enabled=False` 的活，见 PauseBudget 头注引的 grok 原话。
        "budgetSeconds": budget,
        # 场上还有没有人。超时的结局会因此不同（跳过 vs 没有操作员）。
        "unattended": bool(getattr(gate, "_unattended", False)),
    }


def is_orphan_exempt(slot: Optional[PauseSlot]) -> bool:
    return bool(slot is not None and slot.orphan_exempt)


def mark_unattended(slot: Optional[PauseSlot]) -> None:
    """最后一个订阅者走了：场上没人。闸还在就标成没人在场。"""
    if slot is None:
        return
    for gate in (slot.active, slot.pending):
        if gate is not None:
            gate.mark_no_operator()


def clear_unattended(slot: Optional[PauseSlot]) -> None:
    """订阅者回来了：场上又有人。"""
    if slot is None:
        return
    for gate in (slot.active, slot.pending):
        if gate is not None:
            gate.clear_unattended()


async def pause_here(where: str) -> Optional[PauseResult]:
    """安全点。没人按暂停就立刻返回 None——**正常路径上就是一次字典读取**。

    ⚠ 放在**步与步之间**（驱动器循环的开头），不要放进循环内层：这一层的
      意义是"别再开始下一件大活儿"，跟 run_cancel.raise_if_cancelled 同一条
      纪律、同一批位置。
    """
    gate = take_hold()
    if gate is None:
        return None
    return await gate.wait(where)
