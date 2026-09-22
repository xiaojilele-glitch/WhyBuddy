"""能不能"停在半路"——验证件的判据（2026-08-28，第二版）。

## 这个文件在回答什么

伴随式澄清不拦路，理由写在 spec-assumptions 模块头：「工厂中途停下来等回答
会撞上闭环的 fail-closed 语义」。2026-08-28 把这句话拆开实测：

  ① 闭环判据纯看状态、时间无关。真会话 sr-20260827191954 逐条截断实测：
     截到 8 条 blocked=False，截到 7 条及以下一律 fail-closed。判据只认最后
     那条 appbundle.runtimeClosure 有没有产出报告。
  ② 真机跑到 75 秒掐掉：publishClosure=null、modelVersions=0，白烧一轮。

所以病根是**今天唯一的停法是终止性取消**，不是"停"本身。

## 第二版改了什么

第一版在**线程里** `threading.Event.wait()` 干等，自带"占住 64 个执行槽之一"
的约束——那个约束是第一版自己造的。照 grok-build 的 AskUserQuestion
（`tokio::time::timeout(dur, result_rx).await`）改成**异步等**，一个线程都不占。

超时也照它改：**超时不是失败**，返回跟"用户跳过"一模一样的结局，推演继续
往下跑到最后一步，闭环照样绿。「没人在场」单独一档（grok 的 non_interactive）。

没人答之后怎么办，照 claw-code 的 `TrustPromptUnresolved` 配方：自动按默认
走一次，只走一次，还不行才升级喊人。

## ⚠ 判据自己踩过的两个坑

  1. 第一版用裸 `threading.Thread` 起 worker，红灯挂着却跑完 20 步——裸线程
     不继承 ContextVar。**实现是对的、判据起法不对。** 第二版整体挪进协程，
     这个坑消失了，同源的纪律留在 run_cancel 那边。
  2. 两种坏实现会让判据**挂死**而不是判红（CI 卡到被杀）。所以每条等待都
     有上界，且断言"没等满预算"。
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import run_cancel, run_pause  # noqa: E402
from services.run_pause import (  # noqa: E402
    PauseBudget,
    PauseGate,
    PauseOutcome,
    RecoveryLedger,
    recover_from,
)


@pytest.fixture(autouse=True)
def _reset():
    run_cancel.bind(None)
    yield
    run_cancel.bind(None)


def _run(coro):
    return asyncio.run(coro)


class Test异步等_不占执行槽:
    def test_等的时候线程池照样跑得动别的活(self):
        """⚠ 这条是第二版存在的理由。

        第一版在线程里干等，暂停期间占住 event-loop executor 的一个槽
        （启动日志：64 个，一组流式推演占 5 槽）。照 grok 改成 await 之后，
        等待期间**一个工作线程都不该被占用**。

        判据盯的是"等着的同时别人还能不能干活"——直接数线程数会受解释器
        实现影响，数这个才是用户真正在意的。
        """

        async def scenario():
            gate = PauseGate(PauseBudget(seconds=5))
            done = []

            async def other_work():
                for i in range(8):
                    await asyncio.to_thread(lambda: None)
                    done.append(i)
                gate.answer("放行")

            waited, _ = await asyncio.gather(gate.wait("第1步"), other_work())
            assert done == list(range(8)), "暂停期间线程池被占住了，别的活跑不动"
            assert waited.answered

        _run(scenario())

    def test_人答了就把答案带回来(self):
        async def scenario():
            gate = PauseGate(PauseBudget(seconds=5))
            asyncio.get_running_loop().call_later(0.05, gate.answer, {"选了": "工号"})
            got = await gate.wait("第2步")
            assert got.outcome is PauseOutcome.ANSWERED
            assert got.answer == {"选了": "工号"}
            assert got.where == "第2步"

        _run(scenario())


class Test超时不是失败:
    def test_超时按用户跳过处理_不抛异常(self):
        """⚠ 要害不是"把等待时间调大"，是**超时不算失败**。

        照 grok：`On expiry the tool returns the same skipped/cancel text as a
        user dismiss, not a tool failure.` 对应本仓 spec-assumptions 头注那句
        「不点 = 就按模型定的做，**这是个合法结局**」。
        """

        async def scenario():
            gate = PauseGate(PauseBudget(seconds=0.3))
            got = await gate.wait("第3步")
            assert got.outcome is PauseOutcome.SKIPPED
            assert got.proceed_with_default is True
            assert got.waited_seconds < 3, "等超了预算——上界失效，CI 会被拖死"

        _run(scenario())

    def test_人明确跳过_跟超时同一个结局(self):
        async def scenario():
            gate = PauseGate(PauseBudget(seconds=5))
            asyncio.get_running_loop().call_later(0.05, gate.skip)
            got = await gate.wait("第4步")
            assert got.outcome is PauseOutcome.SKIPPED

        _run(scenario())

    def test_没人在场时报的是没有操作员_不是用户跳过(self):
        """⚠ 别把两者揉成一个：一个是"人在、看了、没选"，一个是"根本没人"。

        对下游是不同的事实（收口句要不要提、下一轮要不要再问一遍，两种答案
        不一样）。grok 为此专门有 non_interactive 一档。
        """

        async def scenario():
            gate = PauseGate(PauseBudget(seconds=0.2, non_interactive=True))
            got = await gate.wait("第5步")
            assert got.outcome is PauseOutcome.NO_OPERATOR
            assert got.proceed_with_default is True, "没人在场也必须往下跑，不许判死这一轮"

        _run(scenario())

    def test_订阅者走光之后超时改报没有操作员(self):
        """起闸时场上有人，后来走光——要改口，不能还报"用户跳过"。"""

        async def scenario():
            gate = PauseGate(PauseBudget(seconds=0.2, non_interactive=False))
            gate.mark_no_operator()
            got = await gate.wait("第5.5步")
            assert got.outcome is PauseOutcome.NO_OPERATOR
            assert got.proceed_with_default is True

        _run(scenario())

    def test_操作员回来之后超时恢复成用户跳过(self):
        async def scenario():
            gate = PauseGate(PauseBudget(seconds=0.2, non_interactive=True))
            gate.clear_unattended()
            got = await gate.wait("第5.6步")
            assert got.outcome is PauseOutcome.SKIPPED

        _run(scenario())


class Test预算的口径:
    def test_关掉计时就永远等_不是等0秒(self):
        async def scenario():
            gate = PauseGate(PauseBudget(enabled=False))
            assert gate.budget.wait_budget() is None
            asyncio.get_running_loop().call_later(0.1, gate.answer, "来了")
            got = await gate.wait("第6步")
            assert got.answered, "关掉计时之后应当一直等到有人答"

        _run(scenario())

    def test_秒数写0不表示永远等(self):
        """⚠ 0 一律回落默认预算。把"不限时"和"限时 0 秒"塞进同一个字段，
        读的人分不出来，写的人迟早写错（grok 对 0 专门打警告并回落默认）。
        """
        assert PauseBudget(seconds=0).wait_budget() == run_pause.DEFAULT_WAIT_SECONDS
        assert PauseBudget(seconds=-5).wait_budget() == run_pause.DEFAULT_WAIT_SECONDS
        assert PauseBudget(enabled=False, seconds=0).wait_budget() is None

    def test_默认预算是等人的量级不是等机器的量级(self):
        """30 分钟：人去倒杯咖啡回来还来得及。几十秒是网络超时的量级。

        ⚠ 必须钉死 30 分钟，不能写成 ``>= 10 * 60``——那是旧看门狗的 600 秒，
        改回十分钟这条照样绿，正好把"关掉页面十分钟就变成取消"放回来。
        """
        assert run_pause.DEFAULT_WAIT_SECONDS == 30 * 60


class Test暂停中必须还能取消:
    def test_暂停中被取消_抛的是RunCancelled(self):
        """⚠ 必须跟 raise_if_cancelled 同一个异常类型。

        RunCancelled 特意不继承 CancelledError（见它的头注），就是为了能被
        沿途的 `except Exception` fail-open 兜底层接住；换成别的类型就破了
        那套行为。
        """

        async def scenario():
            token = run_cancel.new_token()
            run_cancel.bind(token)
            gate = PauseGate(PauseBudget(enabled=False))  # 永远等，只能靠取消出来
            asyncio.get_running_loop().call_later(0.1, token.set)
            with pytest.raises(run_cancel.RunCancelled) as err:
                await asyncio.wait_for(gate.wait("第7步"), timeout=5)
            assert "第7步" in str(err.value), "停在哪一步要留痕"

        _run(scenario())

    def test_取消响应快过硬取消的宽限(self):
        assert run_pause._POLL_SECONDS <= 1.0


class Test没人答之后的恢复配方:
    def test_人答了就不需要恢复(self):
        async def scenario():
            gate = PauseGate(PauseBudget(seconds=5))
            asyncio.get_running_loop().call_later(0.05, gate.answer, "选了")
            got = await gate.wait("第8步")
            assert recover_from(got, RecoveryLedger()) is None

        _run(scenario())

    def test_没人答就自动按默认走一次(self):
        async def scenario():
            gate = PauseGate(PauseBudget(seconds=0.2))
            got = await gate.wait("第9步")
            act = recover_from(got, RecoveryLedger())
            assert act is not None
            assert act.attempted is True
            assert act.escalate is False
            assert act.event["kind"] == "recovery_attempted"

        _run(scenario())

    def test_只自动一次_第二次升级喊人(self):
        """⚠ 「只自动一次」是配方的一部分，不是可调的旋钮。

        自动重试第二次意味着同一个没人理的问题把这一轮拖两遍，而人还是没来。
        第二次该做的是喊人，不是再试（claw-code 的 max_attempts=1 +
        EscalationPolicy::AlertHuman）。
        """
        ledger = RecoveryLedger()
        first = ledger.attempt()
        second = ledger.attempt()
        assert first.attempted is True and first.escalate is False
        assert second.attempted is False, "自动恢复重试了第二次"
        assert second.escalate is True
        assert second.event["kind"] == "recovery_escalated"
        assert second.event["policy"] == "alert_human"

    def test_每次尝试都留一条结构化事件(self):
        """留痕是配方的一部分：没有事件就没人知道这一轮是替谁做的决定。"""
        ledger = RecoveryLedger()
        act = ledger.attempt(detail="skipped@第9步")
        assert act.event["scenario"] == "pause_unresolved"
        assert act.event["detail"] == "skipped@第9步"
        assert act.event["attempt"] == 1
        assert act.event["steps"] == list(run_pause.UNRESOLVED_RECOVERY.steps)

    def test_没人在场收口后位子免除孤儿取消(self):
        """关页面 + 超时跳过 = 这一轮接着跑完。不立这面旗，看门狗会在
        下一拍把刚放行的推演掐死，闭环照样黄。"""
        slot = run_pause.new_slot()
        run_pause.bind(slot)
        gate = run_pause.request_hold(slot, PauseBudget(seconds=0.2, non_interactive=True))
        assert gate is not None
        run_pause.take_hold()
        gate.mark_no_operator()
        _run(gate.wait("第10步"))
        run_pause.finish_hold()
        assert slot.orphan_exempt is True
        assert run_pause.is_orphan_exempt(slot) is True

    def test_人答了再关页面不免除孤儿取消(self):
        """反向：人在场时答过，后面关页面白烧 LLM，看门狗该收。"""
        slot = run_pause.new_slot()
        run_pause.bind(slot)
        gate = run_pause.request_hold(slot, PauseBudget(seconds=5))
        assert gate is not None
        run_pause.take_hold()
        gate.answer("选了")
        _run(gate.wait("第11步"))
        run_pause.finish_hold()
        assert slot.orphan_exempt is False
