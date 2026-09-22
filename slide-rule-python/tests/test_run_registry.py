"""E25 run 注册表：日志补播 / 防重复发起 / 取消 / 孤儿回收 / 完结落库钩子。

无 pytest-asyncio 依赖——每个用例用 asyncio.run 包同步壳。
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import run_pause, run_registry  # noqa: E402


def setup_function(_fn):
    run_registry._reset_for_tests()


def _collect(run, since=0, limit=None):
    async def _inner():
        out = []
        async for ev in run_registry.subscribe(run, since):
            out.append(ev)
            if limit is not None and len(out) >= limit:
                break
        return out

    return _inner


def test_journal_replay_order_and_seq():
    async def scenario():
        async def factory():
            for i in range(3):
                yield {"type": "reasoning_step", "label": f"cap-{i}"}

        run = await run_registry.start_run("s1", factory)
        await run.task
        events = []
        async for ev in run_registry.subscribe(run, 0):
            events.append(ev)
        return run, events

    run, events = asyncio.run(scenario())
    assert run.status == "complete"
    # run_started 打头，seq 单调，补播顺序与产生顺序一致
    assert events[0]["type"] == "run_started"
    assert [e["seq"] for e in events] == list(range(len(events)))
    labels = [e.get("label") for e in events if e["type"] == "reasoning_step"]
    assert labels == ["cap-0", "cap-1", "cap-2"]
    # 每个事件都带 runId（客户端凭它续播）
    assert all(e["runId"] == run.run_id for e in events)


def test_resume_from_since_gets_only_tail():
    async def scenario():
        async def factory():
            for i in range(5):
                yield {"type": "reasoning_step", "label": f"cap-{i}"}

        run = await run_registry.start_run("s1", factory)
        await run.task
        tail = []
        async for ev in run_registry.subscribe(run, 4):
            tail.append(ev)
        return tail

    tail = asyncio.run(scenario())
    assert [e["seq"] for e in tail] == [4, 5]  # 总事件 = run_started + 5


def test_active_run_dedupe_attaches_existing():
    async def scenario():
        release = asyncio.Event()

        async def factory():
            await release.wait()
            yield {"type": "reasoning_step", "label": "one"}

        first = await run_registry.start_run("s1", factory)
        second = await run_registry.start_run("s1", factory)
        assert second.run_id == first.run_id  # 防重复发起：附着而非双跑
        assert run_registry.get_active_run("s1").run_id == first.run_id
        release.set()
        await first.task
        assert run_registry.get_active_run("s1") is None  # 完结即出活跃索引
        return True

    assert asyncio.run(scenario())


def test_cancel_kills_engine_and_journals_it():
    async def scenario():
        started = asyncio.Event()

        async def factory():
            started.set()
            await asyncio.sleep(3600)
            yield {"type": "never"}

        run = await run_registry.start_run("s1", factory)
        await started.wait()
        assert run_registry.cancel_run(run.run_id) is True
        await asyncio.wait({run.task})
        events = []
        async for ev in run_registry.subscribe(run, 0):
            events.append(ev)
        return run, events

    run, events = asyncio.run(scenario())
    assert run.status == "cancelled"
    assert events[-1]["type"] == "run_cancelled"
    assert run_registry.cancel_run(run.run_id) is False  # 已完结不可再取消


def test_orphan_watchdog_cancels_unwatched_run(monkeypatch):
    monkeypatch.setenv("SLIDERULE_RUN_ORPHAN_GRACE_SECONDS", "0.1")

    async def scenario():
        async def factory():
            await asyncio.sleep(3600)
            yield {"type": "never"}

        run = await run_registry.start_run("s1", factory)
        # 无任何订阅者，宽限 0.1s → 看门狗应取消
        for _ in range(100):
            if run.status != "running":
                break
            await asyncio.sleep(0.05)
        return run

    run = asyncio.run(scenario())
    assert run.status == "cancelled"


def test_subscriber_presence_blocks_orphan_cancel(monkeypatch):
    monkeypatch.setenv("SLIDERULE_RUN_ORPHAN_GRACE_SECONDS", "0.2")

    async def scenario():
        done = asyncio.Event()

        async def factory():
            await done.wait()
            yield {"type": "reasoning_step", "label": "end"}

        run = await run_registry.start_run("s1", factory)

        async def watcher():
            async for _ev in run_registry.subscribe(run, 0):
                pass

        w = asyncio.create_task(watcher())
        await asyncio.sleep(0.6)  # 远超宽限，但有订阅者在场
        assert run.status == "running"
        done.set()
        await run.task
        await w
        return run

    run = asyncio.run(scenario())
    assert run.status == "complete"


def test_orphan_watchdog_does_not_cancel_a_held_run(monkeypatch):
    """⚠ 关页面十分钟 ≠ 取消。暂停等人时不烧 LLM，看门狗必须放手。

    把 ``is_holding`` 那两行删掉，这条立刻红——旧看门狗会把这一轮判死。
    """
    monkeypatch.setenv("SLIDERULE_RUN_ORPHAN_GRACE_SECONDS", "0.15")

    async def scenario():
        async def factory():
            while True:
                gate = run_pause.take_hold()
                if gate is not None:
                    try:
                        await gate.wait("loop-0")
                    finally:
                        run_pause.finish_hold()
                    break
                await asyncio.sleep(0.01)
            yield {"type": "reasoning_step", "label": "after-pause"}

        run = await run_registry.start_run("s-held", factory)
        assert run_registry.hold_run(run.run_id) is True
        await asyncio.sleep(0.8)  # 远超 0.15s 宽限，且零订阅者
        assert run.status == "running", f"暂停中被孤儿看门狗收成了 {run.status}"
        assert run.cancel_reason != "orphan"
        assert run_registry.release_run(run.run_id, skip=True) is True
        await run.task
        return run

    run = asyncio.run(scenario())
    assert run.status == "complete"


def test_unattended_skip_finishes_the_run_instead_of_orphan_cancel(monkeypatch):
    """超时按跳过收口之后，没观众也要把这一轮跑完——否则闭环黄。"""
    monkeypatch.setenv("SLIDERULE_RUN_ORPHAN_GRACE_SECONDS", "0.15")

    async def scenario():
        async def factory():
            while True:
                gate = run_pause.take_hold()
                if gate is not None:
                    try:
                        await gate.wait("loop-0")
                    finally:
                        run_pause.finish_hold()
                    break
                await asyncio.sleep(0.01)
            yield {"type": "reasoning_step", "label": "after-skip"}

        run = await run_registry.start_run("s-skip", factory)
        run_pause.request_hold(
            run.pause_slot, run_pause.PauseBudget(seconds=0.2, non_interactive=True)
        )
        await run.task
        return run

    run = asyncio.run(scenario())
    assert run.status == "complete"
    assert run.cancel_reason != "orphan"


def test_answered_then_unwatched_still_orphan_cancels(monkeypatch):
    """反向：人答过再关页面，后面还在烧 LLM，看门狗该收。"""
    monkeypatch.setenv("SLIDERULE_RUN_ORPHAN_GRACE_SECONDS", "0.15")

    async def scenario():
        async def factory():
            while True:
                gate = run_pause.take_hold()
                if gate is not None:
                    try:
                        await gate.wait("loop-0")
                    finally:
                        run_pause.finish_hold()
                    break
                await asyncio.sleep(0.01)
            await asyncio.sleep(3600)
            yield {"type": "never"}

        run = await run_registry.start_run("s-answered", factory)
        gate = run_pause.request_hold(run.pause_slot, run_pause.PauseBudget(seconds=5))
        assert gate is not None
        for _ in range(50):
            if run.pause_slot.active is not None:
                break
            await asyncio.sleep(0.02)
        gate.answer({"选了": "工号"})
        for _ in range(80):
            if run.status == "cancelled" or run.finished_at is not None:
                break
            await asyncio.sleep(0.05)
        return run

    run = asyncio.run(scenario())
    assert run.status == "cancelled"
    assert run.cancel_reason == "orphan"


def test_on_complete_hook_rewrites_complete_event():
    async def scenario():
        async def factory():
            yield {"type": "complete", "state": {"raw": True}}

        async def on_complete(ev):
            return {**ev, "state": {"persisted": True}}

        run = await run_registry.start_run("s1", factory, on_complete)
        await run.task
        events = []
        async for ev in run_registry.subscribe(run, 0):
            events.append(ev)
        return events

    events = asyncio.run(scenario())
    complete = [e for e in events if e["type"] == "complete"]
    assert complete and complete[0]["state"] == {"persisted": True}


def test_engine_exception_journals_error_status():
    async def scenario():
        async def factory():
            yield {"type": "reasoning_step", "label": "a"}
            raise RuntimeError("gateway exploded")

        run = await run_registry.start_run("s1", factory)
        await run.task
        events = []
        async for ev in run_registry.subscribe(run, 0):
            events.append(ev)
        return run, events

    run, events = asyncio.run(scenario())
    assert run.status == "error"
    assert events[-1]["type"] == "error"
    assert "gateway exploded" in events[-1]["message"]
