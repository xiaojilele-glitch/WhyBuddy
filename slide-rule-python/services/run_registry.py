"""E25 推演断线重生：run 与连接解耦 + 可续播事件日志。

用户实测缺陷（2026-07-16）：drive-full-stream 的引擎推演内联在 SSE 请求
生成器里——浏览器刷新/跳页即断连，FastAPI 取消协程，推演在服务端中途
死亡，且无任何重新接上的入口。推演的生命周期被绑在一根网线上。

设计（用户确认「开抄」）：
- 契约抄 Vercel resumable-stream：POST 发起 → run 后台跑 → 按会话可续接；
- 生命周期对齐 LangGraph：running/complete/error/cancelled，
  断连语义 = continue（on_disconnect 的行业默认）；
- 序号语义遵循 SSE Last-Event-ID：事件带单调 seq，续播从 since 补起。

治理三件套（防孤儿 run 白烧 LLM）：
- 无人观看宽限：run 无订阅者超过 SLIDERULE_RUN_ORPHAN_GRACE_SECONDS
  （默认 600s）自动中止；半成品照常留在轮边界已落库的进度上；
- 防重复发起：同会话已有活跃 run 时 start_run 返回既有 run（附着，
  不并行双跑双烧钱）；
- 显式取消：cancel_run（停止按钮）。

⚑ 2026-08-30 —— 暂停等人时**不要**走上面那条孤儿取消。关页面 ≠ 用户拒绝
  （grok 的 non_interactive / claw-code 的 TrustPromptUnresolved）：闸还在
  等，标成没人在场，超时按跳过收口，这一轮接着跑完。看门狗见
  ``is_holding`` 或 ``orphan_exempt`` 就放手。没按过暂停的无人观看 run
  照旧取消——那才是真的在白烧 LLM。

⚑ 2026-08-14 —— 上面那三件套里，前两件此前**形同虚设**：它们喊的是
  `task.cancel()`，而引擎每步跑在 `asyncio.to_thread` 里，**那一下打不断
  线程**（只让协程在下一个 await 点抛错，线程照跑到底）。真机后果：客户端
  掐掉后 run 立刻显示 cancelled，线程里的活又烧了 15 分钟——单步 918s 量级，
  跑完还回落老链路再烧一段。

  现在改成**先协作、后硬来**：立 services/run_cancel 的取消旗，引擎在步与步
  之间查一次自己干净退出；硬取消降为兜底（宽限见
  SLIDERULE_RUN_CANCEL_HARD_GRACE_SECONDS，默认 5s）。

  状态相应分级：已请求 = `cancelling`（**过渡态**），真停了才 `cancelled`；
  硬取消那份「停没停不知道」由 `hard_cancelled` 单独表达——终态词汇仍是
  running/complete/error/cancelled 四个，上面那条 LangGraph 对齐不破。
  ⚠ 「还会不会再吐事件」的判据是 `finished_at` 不是 `status`：硬取消之后
    这两件事分叉了（协程死了 ≠ 引擎停了），拿 status 当流的判据会让订阅者
    永远等一个不会再来的事件。

单进程内存实现（uvicorn 单实例部署形态）；完结 run 的日志保留
SLIDERULE_RUN_FINISHED_TTL_SECONDS（默认 1800s）供迟到的续播读尾。
"""

from __future__ import annotations

import asyncio
import os
import time

# gate_health 是 util 叶子（谁都不依赖），顶层 import——别塞函数体，架构闸盯着逃生口
from .gate_health import summary_line
import uuid
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional

from . import run_cancel, run_pause


def _orphan_grace_seconds() -> float:
    return float(os.getenv("SLIDERULE_RUN_ORPHAN_GRACE_SECONDS", "600"))


def _cancel_hard_grace_seconds() -> float:
    """协作式取消的宽限：这么久还没停就硬来。默认 5s——够引擎跨过一个安全点，
    又不至于让点了停止的人干等。"""
    return float(os.getenv("SLIDERULE_RUN_CANCEL_HARD_GRACE_SECONDS", "5"))


def _finished_ttl_seconds() -> float:
    return float(os.getenv("SLIDERULE_RUN_FINISHED_TTL_SECONDS", "1800"))


class Run:
    def __init__(self, run_id: str, session_id: str, *, owner_id: Optional[str] = None):
        self.run_id = run_id
        self.session_id = session_id
        self.owner_id = owner_id
        # 终态：running | complete | error | cancelled（模块头那条 LangGraph 对齐）
        # 过渡态：cancelling —— **已请求停止、但还没停**
        #
        # ⚑ 2026-08-14 补 `cancelling`：此前喊完 cancel 就立刻标 `cancelled`，
        #   而线程里的活还在烧 LLM——**账面说停了，实际没停**。真机后果是
        #   run 显示已取消，引擎又烧了十几分钟（单步 918s 量级）。
        #   ⚠ 它是**过渡态不是终态**：终态词汇不扩，硬取消那份不确定性由
        #     hard_cancelled 单独表达（见下）。
        self.status = "running"
        #: 协作式取消令牌（见 services/run_cancel 头注）。Task.cancel() 打不断
        #: 线程里的同步代码，所以真正让引擎停下来的是这个。
        self.cancel_token = run_cancel.new_token()
        #: 协作式暂停位（见 services/run_pause 头注）。用户按「先别往下跑」时
        #: 路由把闸放进来，驱动器在步与步之间取走并等在那儿。
        #: ⚠ 绑的是**位子**不是闸：闸是按下那一刻才造的，而绑定必须发生在
        #:   起跑之前（Context 是那一刻复制的），所以绑一个可变的位子。
        self.pause_slot = run_pause.new_slot()
        self.events: List[Dict[str, Any]] = []
        self.cond = asyncio.Condition()
        self.task: Optional[asyncio.Task] = None
        self.subscribers = 0
        self.last_subscriber_seen = time.monotonic()
        self.finished_at: Optional[float] = None
        #: 为什么停的（orphan / explicit）——排查时最想知道的第二件事
        self.cancel_reason: Optional[str] = None
        #: True = 走的是硬取消那条路，**引擎有没有真停下来我们不知道**
        #: （Task.cancel 打不断 to_thread 里的同步代码）。协作式那条干净出口
        #: 保持 False——那时线程里确实没有活在跑。
        self.hard_cancelled: bool = False

    def snapshot(self) -> Dict[str, Any]:
        # ⚠ 「正在等人」必须是快照里**独立的一格**（2026-09-06 真机）。
        #
        #   停泊 30 分钟期间这个快照报的是 `status:"running"`，而停泊期间
        #   零事件——刷新回来的浏览器拿到"在跑"却再也收不到任何东西，
        #   分不出"在等你答假设卡"和"服务端死了"。
        #
        #   `status` 描述的是**引擎**（`is_live` 的头注早就写清楚了这个区分），
        #   等人是会话的另一个**相**。照 grok `xai-grok-session-events` 的
        #   `Phase::PermissionPrompt`：等人不是"跑着"的一个子情况。
        #
        #   ⚠ 读取不许抛：快照是诊断面，炸了会让 `runs/active` 整个 500，
        #     那比少一格严重得多（本仓第七条：增强类 fail-open）。
        try:
            hold = run_pause.hold_state(self.pause_slot)
        except Exception:  # noqa: BLE001
            hold = None
        return {
            "runId": self.run_id,
            "sessionId": self.session_id,
            "status": self.status,
            # 布尔给判断，详情给展示。只给 hold 的话调用方得先判 None 再取值；
            # 只给布尔的话又回到"不知道在等什么"。
            "held": hold is not None,
            "hold": hold,
            # ⚠ 前端/排查要能分出「已请求停止」与「真停了」，所以这两个都给
            "cancelRequested": self.cancel_token.is_set(),
            "cancelReason": self.cancel_reason,
            "hardCancelled": self.hard_cancelled,
            "seq": len(self.events),
        }


_runs: Dict[str, Run] = {}
_active_by_session: Dict[str, str] = {}


#: 「这个 run 还会不会再吐事件」——**判据是 finished_at，不是 status**。
#:
#: ⚑ 2026-08-14：加 `cancelling` 时差点在这里栽跟头。硬取消之后这两件事分叉了：
#:     驱动协程已经死了（不会再有事件） ≠ 线程里的引擎已经停了（可能还在烧 LLM）
#:   status 描述的是**引擎**，finished_at 描述的是**事件流**。拿 status 当流的
#:   活跃判据，订阅者会在 cancelling 上永远等一个不会再来的事件。
def is_live(run: "Run") -> bool:
    return run.finished_at is None


def get_run(run_id: str) -> Optional[Run]:
    return _runs.get(run_id)


def get_active_run(session_id: str) -> Optional[Run]:
    run_id = _active_by_session.get(session_id)
    if not run_id:
        return None
    run = _runs.get(run_id)
    if run is None or not is_live(run):
        _active_by_session.pop(session_id, None)
        return None
    return run


def _sweep_finished() -> None:
    now = time.monotonic()
    ttl = _finished_ttl_seconds()
    stale = [
        rid
        for rid, r in _runs.items()
        if r.finished_at is not None and now - r.finished_at > ttl
    ]
    for rid in stale:
        _runs.pop(rid, None)


async def _append(run: Run, event: Dict[str, Any]) -> None:
    async with run.cond:
        stamped = {**event, "seq": len(run.events), "runId": run.run_id}
        run.events.append(stamped)
        run.cond.notify_all()


async def _finish(run: Run, status: str) -> None:
    run.status = status
    run.finished_at = time.monotonic()
    # 跑批收尾打一行各道闸的开火情况。
    #
    # ⚠ 放在 `_finish` 而不是驱动器里：四种终态（complete/error/cancelled/
    #   partial）全都从这一个口出去，接在这儿才不会漏掉"跑挂了那一轮"——
    #   而恰恰是挂掉的那些轮次最需要知道闸当时在说什么。
    #
    # 统计是**跨会话累计**的（台账是进程级）：一道闸对 15 个不同会话说同一句话，
    # 正是今天要抓的形状，按单会话统计反而看不见。
    try:
        line = summary_line()
        if line:
            print(line, flush=True)
    except Exception as exc:  # noqa: BLE001 — 收尾统计不许挡住 run 收尾
        print(f"[gate-health] 收尾统计跳过：{str(exc)[:120]}")
    if _active_by_session.get(run.session_id) == run.run_id:
        _active_by_session.pop(run.session_id, None)
    async with run.cond:
        run.cond.notify_all()


async def start_run(
    session_id: str,
    stream_factory: Callable[[], AsyncIterator[Dict[str, Any]]],
    on_complete: Optional[
        Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]
    ] = None,
    *,
    user_text: str = "",
    owner_id: Optional[str] = None,
) -> Run:
    """启动（或附着）一个后台推演 run。

    同会话已有活跃 run → 返回既有 run（防重复发起）。
    on_complete 在后台任务内对 complete 事件做持久化改写——落库必须
    发生在 run 任务里而不是响应生成器里，否则无人观看时跑完也白跑。
    """
    _sweep_finished()
    existing = get_active_run(session_id)
    if existing is not None:
        if existing.owner_id != owner_id:
            raise PermissionError("run owner mismatch")
        return existing

    run = Run(uuid.uuid4().hex[:16], session_id, owner_id=owner_id)
    _runs[run.run_id] = run
    _active_by_session[session_id] = run.run_id

    async def _drive() -> None:
        # ⚠ 必须在起跑前绑：asyncio.to_thread 复制的是**这一刻**的 Context，
        #   绑晚了线程里读到的就是 None（等于整条协作式取消线路静默失效）。
        run_cancel.bind(run.cancel_token)
        run_pause.bind(run.pause_slot)
        await _append(
            run,
            {"type": "run_started", "sessionId": session_id, "userText": user_text},
        )
        try:
            async for event in stream_factory():
                if (
                    on_complete is not None
                    and isinstance(event, dict)
                    and event.get("type") == "complete"
                ):
                    event = await on_complete(event)
                await _append(run, event)
            await _finish(run, "complete")
        except run_cancel.RunCancelled as stop:
            # ★ 协作式取消的正常出口：引擎在安全点上**自己退出来了**，
            #   此刻线程里确实没有活在跑——这时候标 cancelled 才是真话。
            await _append(run, {"type": "run_cancelled", "where": str(stop)[:120]})
            await _finish(run, "cancelled")
        except asyncio.CancelledError:
            # 硬取消（兜底那一路）。终态仍是 cancelled——**终态词汇保持
            # running/complete/error/cancelled 四个**（模块头那条 LangGraph 对齐），
            # `cancelling` 是过渡态不是终态。
            #
            # ⚠ 但硬取消**不代表引擎真停了**：Task.cancel() 打不断 to_thread 里的
            #   同步代码，线程可能还在烧 LLM。这份不确定性用 hard 标记单独表达，
            #   不靠混淆终态来表达——把"没确认停"和"确认停了"塞进同一个词，
            #   下一个读的人一样分不出来。
            run.hard_cancelled = True
            await _append(run, {"type": "run_cancelled", "hard": True})
            await _finish(run, "cancelled")
            raise
        except Exception as exc:  # noqa: BLE001 —— 错误如实进日志，不静默
            await _append(run, {"type": "error", "message": str(exc)[:300]})
            await _finish(run, "error")

    async def _orphan_watchdog() -> None:
        """无人观看超过宽限 → 请求停止。**先协作、后硬来。**

        ⚑ 2026-08-14 改：此前这里直接 `run.task.cancel()`，而引擎跑在
        `asyncio.to_thread` 里——**那一下打不断线程**，只让协程抛错。真机后果是
        run 立刻显示 cancelled，线程里的活又烧了十几分钟（单步 918s 量级）。

        现在先立协作式取消旗：引擎在步与步之间查一次就干净退出。硬取消留作
        兜底——引擎可能整步卡在一次 LLM 调用里，那时旗子要等这步跑完才被看见。
        """
        requested = False
        while is_live(run):
            await asyncio.sleep(min(15.0, _orphan_grace_seconds() / 2 or 1.0))
            if not is_live(run):
                return
            idle = time.monotonic() - run.last_subscriber_seen
            if run.subscribers == 0 and idle > _orphan_grace_seconds():
                # 暂停等人：不烧 LLM，关页面不是取消。标成没人在场，
                # 让闸按跳过 / no_operator 收口，这一轮接着跑完。
                if run_pause.is_holding(run.pause_slot):
                    run_pause.mark_unattended(run.pause_slot)
                    continue
                if run_pause.is_orphan_exempt(run.pause_slot):
                    continue
                if not requested:
                    request_cancel(run, reason="orphan")
                    requested = True
                    continue  # 给引擎一轮时间走到安全点，别立刻硬来
                if run.task is not None:
                    run.task.cancel()
                return

    run.task = asyncio.create_task(_drive())
    asyncio.create_task(_orphan_watchdog())
    return run


async def subscribe(run: Run, since: int = 0) -> AsyncIterator[Dict[str, Any]]:
    """从 since 序号起补播日志，追平后跟实时流；run 完结且读尽即止。"""
    run.subscribers += 1
    run.last_subscriber_seen = time.monotonic()
    if run.subscribers > 0:
        run_pause.clear_unattended(run.pause_slot)
    try:
        i = max(0, int(since))
        while True:
            async with run.cond:
                while i >= len(run.events) and is_live(run):
                    await run.cond.wait()
                batch = list(run.events[i:])
            for event in batch:
                yield event
            i += len(batch)
            if not is_live(run) and i >= len(run.events):
                return
    finally:
        run.subscribers -= 1
        run.last_subscriber_seen = time.monotonic()
        if run.subscribers <= 0:
            run_pause.mark_unattended(run.pause_slot)


def request_cancel(run: Run, *, reason: str = "explicit") -> None:
    """立协作式取消旗：引擎在下一个安全点自己退出来。

    ⚠ 这是**请求**不是事实。status 进 `cancelling`，等引擎真退到安全点、
      _drive 捕到 RunCancelled 之后才进 `cancelled`。两者之间可能隔着一整步
      （真机量到过 918 秒）——把这段时间说成"已取消"就是账面比事实乐观，
      而那正是本仓反复吃亏的形状。
    """
    if not is_live(run):
        return
    run.cancel_token.set()
    if run.status == "running":
        run.status = "cancelling"
    run.cancel_reason = reason


def cancel_run(run_id: str) -> bool:
    """停止按钮：**先请求协作式取消**，不再一上来就硬杀。

    硬杀（task.cancel）打不断线程里的引擎，只会让 run 立刻显示"已取消"
    而活还在跑。所以这里只立旗——引擎在下一个安全点自己退出来，那时
    状态才变 cancelled。
    """
    run = _runs.get(run_id)
    if run is None or not is_live(run) or run.task is None:
        return False
    request_cancel(run, reason="explicit")

    # 兜底：宽限之后仍没停就硬取消。
    #
    # ⚠ 只立旗是不够的——**引擎不一定走得到安全点**：它可能整步卡在一次 LLM
    #   调用里，也可能压根不是协作式的（纯异步等待）。停止按钮是用户按的，
    #   不能"等它自己想通"。第一版我漏了这条，用例当场死等 11 分钟才被抓出来。
    #
    # ⚠ 宽限期不是白等：协作式那条路能干净退出并如实标 cancelled，
    #   硬取消只能标 cancelling（停没停不知道）。所以先给它机会。
    async def _hard_fallback() -> None:
        await asyncio.sleep(_cancel_hard_grace_seconds())
        if is_live(run) and run.task is not None and not run.task.done():
            run.task.cancel()

    try:
        asyncio.get_running_loop().create_task(_hard_fallback())
    except RuntimeError:
        # 没有事件循环（同步上下文调用）：立旗已经生效，硬兜底交给
        # 孤儿看门狗那条路。不为这个抛错——停止请求本身是成功的。
        pass
    return True


def _reset_for_tests() -> None:
    _runs.clear()
    _active_by_session.clear()


def hold_run(run_id: str, *, non_interactive: bool = False) -> bool:
    """用户按「先别往下跑」：在下一个安全点停住这一轮。

    ⚠ 跟 cancel_run 的关系：取消是**终止**（这一轮判死、白烧，见
      run_pause 头注里的实测），暂停是**停住等人**，答完/超时都会接着跑到
      最后一步，闭环照样绿。两者不是同一件事的两个力度，别合并。

    重复按返回 True 但不开第二道闸（request_hold 幂等）。
    """
    run = _runs.get(run_id)
    if run is None or not is_live(run):
        return False
    return run_pause.request_hold(
        run.pause_slot,
        run_pause.PauseBudget(non_interactive=non_interactive),
    ) is not None


def release_run(run_id: str, *, answer: Any = None, skip: bool = False) -> bool:
    """人答了（或明确说"就这样"）：放行，接着往下跑。

    ⚠ 找不到闸时返回 False 而不是抛：真机上「答案到得比暂停生效还早」是
      正常竞态（用户手快 / 上一步还没跑完），那不是错误。
    """
    run = _runs.get(run_id)
    if run is None:
        return False
    # 两格都认：安全点还没到时闸在 pending，正在等时在 active。
    # 用户手快、或上一步还没跑完 → 答案先到，那是正常竞态不是错误。
    gate = run.pause_slot.active or run.pause_slot.pending
    if gate is None:
        return False
    if skip or answer is None:
        gate.skip()
    else:
        gate.answer(answer)
    return True
