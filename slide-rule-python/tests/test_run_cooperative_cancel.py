"""取消要真的停下来，而且账面不许比事实乐观（2026-08-14）。

## 起因：孤儿看门狗形同虚设

看门狗喊的是 `run.task.cancel()`，而引擎每一步跑在 `asyncio.to_thread` 里。
**`Task.cancel()` 打不断已经在线程里跑的同步代码**——它只让协程在下一个
await 点抛错，线程照跑到底。下面第一条用例就把这件事钉死。

真机后果（2026-08-14 市政园林那轮）：我用 `timeout 45` 掐了客户端，
run 立刻显示已取消，**线程里的活又跑了 15 分钟**——单步 918 秒量级，
跑完还回落老链路继续跑第二段。两条链路前后烧了两遍，没人在看。

## 两条修法，各有各的判据

  ① 协作式取消：引擎在步与步之间查一次旗子，自己干净退出（本文件后半）
  ② 状态不撒谎：已请求 → `cancelling`（过渡态），真停了才 `cancelled`

⚠ `cancelling` 是**过渡态不是终态**：终态词汇保持 running/complete/error/
  cancelled 四个（模块头那条 LangGraph 对齐）。硬取消那份"停没停不知道"的
  不确定性由 `hard_cancelled` 单独表达——把"没确认停"和"确认停了"塞进同一个
  词，读的人一样分不出来。

## 抄的是什么

协作式取消是这类系统的标准答案（.NET CancellationToken / Go context /
Temporal heartbeat）。⚠ Temporal 自己的 Python SDK 有一模一样的限制
（sdk-python#700），所以没有更聪明的成品可抄——大家都是靠在安全点主动查。
"""

import asyncio
import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import run_cancel, run_registry  # noqa: E402


@pytest.fixture(autouse=True)
def _reset():
    run_registry._reset_for_tests()
    run_cancel.bind(None)
    yield
    run_registry._reset_for_tests()
    run_cancel.bind(None)


class Test为什么需要协作式取消:
    def test_task_cancel_打不断线程里的同步代码(self):
        """⚠ 这条不测我们的代码，测的是**这个修法赖以成立的前提**。

        它是整个设计的地基：如果哪天 Python 让 to_thread 可中断了，
        协作式那一整套就可以简化掉。所以把前提也钉住——
        地基变了要有人知道，而不是留着一套没必要的复杂度。
        """
        async def scenario():
            done = []

            def slow():
                time.sleep(0.6)
                done.append("跑完了")

            task = asyncio.create_task(asyncio.to_thread(slow))
            await asyncio.sleep(0.1)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            assert done == [], "cancel 之后线程理应还在跑"
            await asyncio.sleep(0.8)
            return done

        assert asyncio.run(scenario()) == ["跑完了"], (
            "to_thread 竟然被 cancel 打断了——前提变了，协作式取消可以简化"
        )


class Test安全点:
    def test_没立旗时安全点是透明的(self):
        run_cancel.bind(run_cancel.new_token())
        run_cancel.raise_if_cancelled("第4步")  # 不抛就算过

    def test_立了旗就在安全点停下并说出停在哪(self):
        token = run_cancel.new_token()
        run_cancel.bind(token)
        token.set()
        with pytest.raises(run_cancel.RunCancelled) as err:
            run_cancel.raise_if_cancelled("第4步 反推结构")
        assert "第4步 反推结构" in str(err.value), "停在哪是排查时最想知道的第一件事"

    def test_没绑令牌时不误伤(self):
        """脚本/评测直接调 pipeline 时没有 run，安全点必须是空操作。"""
        run_cancel.bind(None)
        run_cancel.raise_if_cancelled("第4步")

    def test_RunCancelled_不是_BaseException(self):
        """⚠ 特意不继承 asyncio.CancelledError。

        那个在 3.8+ 是 BaseException，会穿过沿途所有 `except Exception`
        的 fail-open 兜底层——而这条链上到处是"这一步失败不该打死整轮"。
        要的是干净停下并留痕，不是炸穿一切。
        """
        assert issubclass(run_cancel.RunCancelled, Exception)
        assert not issubclass(run_cancel.RunCancelled, asyncio.CancelledError)
        # 正面验它确实被 `except Exception` 接得住（这正是我们要的性质）
        try:
            raise run_cancel.RunCancelled("x")
        except Exception:  # noqa: BLE001
            pass
        else:  # pragma: no cover
            pytest.fail("RunCancelled 没被 except Exception 接住 —— 它变成 BaseException 了")


class Test状态不许比事实乐观:
    def test_请求取消后是_cancelling_不是_cancelled(self):
        """★ 这条就是"账面说停了实际没停"的判据。

        请求与真停之间可能隔着一整步（真机量到 918 秒）。这段时间里
        状态必须是 cancelling。
        """
        async def scenario():
            gate = threading.Event()

            async def factory():
                await asyncio.to_thread(gate.wait)  # 卡住，模拟一步长活
                yield {"type": "never"}

            run = await run_registry.start_run("s-cancelling", factory)
            await asyncio.sleep(0.05)
            run_registry.request_cancel(run, reason="explicit")
            status_now = run.status
            gate.set()                      # 放它走，收尾
            await asyncio.sleep(0.1)
            return status_now

        assert asyncio.run(scenario()) == "cancelling", (
            "刚请求取消就标成 cancelled = 账面比事实乐观"
        )

    def test_协作式停下来才叫_cancelled(self):
        async def scenario():
            async def factory():
                # 引擎在安全点上自己退出来——协作式的正常出口
                await asyncio.to_thread(run_cancel.raise_if_cancelled, "第4步 反推结构")
                yield {"type": "never"}

            run = await run_registry.start_run("s-coop", factory)
            run_registry.request_cancel(run, reason="explicit")
            await asyncio.wait({run.task})
            return run

        run = asyncio.run(scenario())
        assert run.status == "cancelled"
        assert run.hard_cancelled is False, "协作式出口是确认停了，不该标 hard"
        last = run.events[-1]
        assert last["type"] == "run_cancelled"
        assert "第4步 反推结构" in last.get("where", ""), "要说得出停在哪一步"

    def test_硬取消要标_hard_不许冒充干净停止(self):
        """⚠ 反向判据：硬取消也标 cancelled，但**必须留下"没确认停"的痕迹**。
        少了这个标记，两种截然不同的结局在外面长得一模一样。"""
        async def scenario():
            async def factory():
                await asyncio.sleep(3600)   # 不协作
                yield {"type": "never"}

            run = await run_registry.start_run("s-hard", factory)
            await asyncio.sleep(0.05)
            run.task.cancel()
            try:
                await run.task
            except asyncio.CancelledError:
                pass
            return run

        run = asyncio.run(scenario())
        assert run.status == "cancelled"
        assert run.hard_cancelled is True, "硬取消没留痕——外面分不出停没停"
        assert run.events[-1].get("hard") is True


class Test取消不许被当成故障回落:
    def test_RunCancelled_穿得过宽的_except_Exception(self):
        """★ 真机那轮的形状：取消被宽 except 当成"新链路挂了"，
        于是老链路接着跑了几百秒——用户已经不看了，两条链路前后烧两遍。

        判据钉在"它是不是会被 `except Exception` 吞掉"这件事本身。
        """
        caught_as_failure = False
        try:
            try:
                raise run_cancel.RunCancelled("停在第4步")
            except run_cancel.RunCancelled:
                raise
            except Exception:  # noqa: BLE001
                caught_as_failure = True
        except run_cancel.RunCancelled:
            pass
        assert not caught_as_failure, "取消被当成故障 → 会触发回落老链路"
