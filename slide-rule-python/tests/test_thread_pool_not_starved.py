# -*- coding: utf-8 -*-
"""推演占满线程池时，别人的请求不许排队（2026-08-21）。

## 事故形状

用户原话：「多个人使用，第二个人页面一直 loading」。

2026-08-02 修过一次同名事故（见 routes/sliderule_full.py 的 /drive-full 头注：
「只要有人在推演，整个服务就不响应，连 /api/health 都超时」），修法是把那条
路由从 `async def` 改成 `def`，交给 FastAPI/anyio 的线程池（**40 槽**）。
那条路至今是好的。

**但流式后来才成为前端主路径**，而它走的是另一条：

    v5_full_driver.drive_full_v5_session_stream:2141
        asyncio.gather(*[asyncio.to_thread(_timed_execute, ...) for sel in group])

`asyncio.to_thread` 用的是事件循环的**默认执行器**，容量
`min(32, os.cpu_count() + 4)`——线上 4 核就是 **8 槽**，跟 anyio 那 40 槽
是两个互不相通的池。当年注释里算的「40 槽够用」在这条路上不成立。

一组并行能力最多 5 个（v5_full_driver:330「picker caps selection at 5」），
每个跑一次 LLM、30~180 秒。于是：

    1 个人推演   占 5/8 槽   → 还有余
    2 个人推演   要 10 槽    → **池满**

池一满，任何还想 `to_thread` 的请求就排队——包括新用户开页面时
`routes/sliderule_full.py` 里那句 `await asyncio.to_thread(load_session, sid)`。
那是个**毫秒级**操作，却要等别人的 LLM 调用还槽。实测按真机时长换算，
新用户要等 28~168 秒，在页面上就是一直转圈。

⚠ 一个反直觉的对照：**同步路径反而没这个病**——`_execute_group_parallel`
  自己开 `ThreadPoolExecutor(max_workers=min(len(group), 5))`，独立线程，
  不吃共享池。写得「更规范」的流式路径才是出事的那条。

## 判据为什么这么写

盯的是**机制**不是某个数字：`max_workers >= 64` 那种判据在换实现（比如改用
信号量、或换成独立池）时会误报，而真正要保证的是「一个人的推演占不满、
第二个人不排队」。所以这里直接**跑并发场景量等待时间**。

⚠ 不测「默认执行器容量等于几」：容量只是当前实现达成目标的手段。
"""
import asyncio
import os
import time

import pytest

# 真机数据（v5_full_driver:330 与 experiments/refine-fingerprint 的日志）
PARALLEL_CAPS = 5      # 一组并行能力的上限
CAP_SECONDS = 0.6      # 单次能力执行；真机 30~180s，判据里按比例缩小
CONCURRENT_USERS = 3   # 「多个人使用」——两个人就该够，留一点余量
# 新请求的容忍上限。毫秒级操作排到 LLM 后面就是几十秒，这里给 100 倍宽容度。
MAX_WAIT = CAP_SECONDS / 2


def _cap_work(_):
    """占住一个线程跑 LLM。用 sleep 代替网络等待——对线程池而言行为等价。"""
    time.sleep(CAP_SECONDS)


def _load_session():
    """新用户开页面时那个毫秒级操作。"""
    time.sleep(0.005)
    return "session"


async def _one_user_stream_loop():
    """流式路径一个 loop 的形状：一组能力并行、每个一个 to_thread。"""
    await asyncio.gather(*[asyncio.to_thread(_cap_work, i) for i in range(PARALLEL_CAPS)])


async def _wait_for_newcomer() -> float:
    users = [asyncio.create_task(_one_user_stream_loop()) for _ in range(CONCURRENT_USERS)]
    await asyncio.sleep(CAP_SECONDS * 0.15)  # 让推演先占住线程
    t0 = time.time()
    await asyncio.to_thread(_load_session)
    waited = time.time() - t0
    await asyncio.gather(*users)
    return waited


class Test多人并发时新请求不许排队:
    def test_有人在推演时_新用户开页面不排队(self):
        """★ 这条就是用户报的那个 bug。

        走的是**应用真正配置过的**事件循环——`configure_event_loop_executor`
        由 app.lifespan 调用，判据这里也调一次，形状一致。
        """
        from app import configure_event_loop_executor

        async def scenario():
            configure_event_loop_executor()
            return await _wait_for_newcomer()

        waited = asyncio.run(scenario())
        assert waited <= MAX_WAIT, (
            f"{CONCURRENT_USERS} 个人在推演时，新用户开页面等了 {waited:.2f}s"
            f"（上限 {MAX_WAIT:.2f}s）。线程池被推演占满，毫秒级操作排在 LLM 后面"
            f"——真机换算下来是几十秒的白屏转圈。"
        )

    def test_不配置时会排队_证明这条判据咬得住(self):
        """★ 反向判据：不配置执行器，同一场景必须排队。

        没有这条的话，上面那条在「机器核数多到默认池本来就够」的环境里会
        假绿——判据在 CI 上绿、在 4 核线上照样炸。
        """
        need = PARALLEL_CAPS * CONCURRENT_USERS
        default_cap = min(32, (os.cpu_count() or 1) + 4)
        if default_cap >= need:
            pytest.skip(
                f"本机默认池 {default_cap} 槽 ≥ 需要的 {need} 槽，"
                f"复现不出饥饿（线上 4 核只有 {min(32, 4 + 4)} 槽）"
            )
        waited = asyncio.run(_wait_for_newcomer())  # 不调 configure_*
        assert waited > MAX_WAIT, (
            f"没配置执行器却也没排队（等了 {waited:.2f}s）——"
            f"说明这个场景根本没把池占满，判据是假的，得重写"
        )


class Test接线:
    """★ 变异咬出来的缺口：上面两条判据**自己调**了 configure_event_loop_executor，
    于是把 app.lifespan 里的调用整个删掉，它们照样全绿。

    CLAUDE.md 第二条逐字写着这个形状：「11 条测试全绿，但把调用点删掉照样全绿
    ——它们只直接调那个函数，从没验证它接在链路上」。修法不是再抄一遍配置，
    是**驱动真实的启动流程**，量出口那件事有没有发生。
    """

    def test_启动流程真的换了池(self):
        """跑一遍真实的 lifespan，然后量并发行为——不看它调了谁，看池换没换。"""
        import app as app_module

        async def scenario():
            async with app_module.lifespan(app_module.app):
                return await _wait_for_newcomer()

        waited = asyncio.run(scenario())
        assert waited <= MAX_WAIT, (
            f"跑完 app.lifespan 之后，{CONCURRENT_USERS} 人并发下新用户仍等了 "
            f"{waited:.2f}s——配置函数写对了，但启动流程没调它（或调得太晚，"
            f"默认池已被首次 to_thread 建出来）"
        )

    def test_启动日志说得出池有多大(self, capsys):
        """会静默失效的东西必须说得出话（同 rank-bm25 那次的教训）。

        池大小配错/没生效时，**表现跟正常一模一样**——只有并发上来才炸，
        而那时人在线上。启动日志里必须有它的位置。
        """
        import app as app_module

        async def boot():
            async with app_module.lifespan(app_module.app):
                pass

        asyncio.run(boot())
        out = capsys.readouterr().out
        assert "executor" in out, "启动日志里没有线程池的位置——配错了没人看得见"
        assert str(app_module._DEFAULT_EXECUTOR_THREADS) in out, "没说实际用了多少线程"
