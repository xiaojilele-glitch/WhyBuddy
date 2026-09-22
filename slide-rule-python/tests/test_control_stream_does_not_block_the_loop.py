"""控制面的同步重活不许坐在事件循环上。

2026-08-27 评审：`call_control_llm` 是**同步** httpx（超时最长 45s），
`save_session` 在这台机器上是一次同步 HTTPS SQL 调用，两者都直接在 async
SSE 生成器里调。单人开发看不出来——**两个人同时推演就互相卡**：对方的流
一个字都不出，看起来像"服务挂了"。

判据是**真并发**：两条控制面流一起发，墙钟必须接近一条的时间，不是两条相加。
不数调用次数、不 grep 源码里有没有 run_in_threadpool——那两种写法把
`run_in_threadpool` 写进注释就能养绿。

⚠ 夹具里的 LLM 用 `time.sleep`（**阻塞**）而不是 `asyncio.sleep`：要复现的
  正是"同步调用"这件事。换成 asyncio.sleep 的话，不管有没有挪出事件循环
  都会并发，判据直接打空。
"""

from __future__ import annotations

import asyncio
import time

import httpx
import pytest

from control_turn_support import (
    KEY,
    CONTROL_URL,
    ControlHarness,
    llm_text,
    new_sid,
    seed_session,
    six_fields,
)
from app import app

pytest.importorskip("fastapi")

BLOCK_S = 0.6


@pytest.fixture
def harness(monkeypatch):
    h = ControlHarness(monkeypatch)

    def slow_blocking_llm(messages, **kwargs):
        time.sleep(BLOCK_S)
        return llm_text("想好了")

    h.llm_impl = slow_blocking_llm
    return h


def _post_twice() -> float:
    sid_a = new_sid("loop-a")
    sid_b = new_sid("loop-b")
    for sid in (sid_a, sid_b):
        seed_session(sid, goal={"text": "请假系统", "status": "clear"})

    async def run() -> float:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test", timeout=30.0
        ) as client:
            started = time.monotonic()
            await asyncio.gather(
                client.post(CONTROL_URL, json=six_fields(sid_a, "聊两句"), headers=KEY),
                client.post(CONTROL_URL, json=six_fields(sid_b, "聊两句"), headers=KEY),
            )
            return time.monotonic() - started

    return asyncio.run(run())


def test_two_streams_do_not_serialize_on_the_blocking_llm(harness):
    elapsed = _post_twice()
    # 串行是 2×BLOCK_S=1.2s；并发约 0.6s。留足余量，只要**明显小于串行**即可，
    # 不去钉一个精确墙钟（那种判据在忙机器上会自己红）。
    assert elapsed < BLOCK_S * 1.7, (
        f"两条控制面流像是串起来跑的：{elapsed:.2f}s ≥ {BLOCK_S * 1.7:.2f}s。"
        "同步调用还坐在事件循环上——第二个人的推演要等第一个人跑完。"
    )


def test_the_fixture_itself_really_blocks(harness):
    """反向：确认夹具真的是**阻塞**的。

    这条防的是判据自己打空：哪天有人把 time.sleep 改成 asyncio.sleep，
    上面那条会永远绿（不管有没有挪出事件循环），而它本来该测的东西没了。
    """
    started = time.monotonic()
    harness.llm_impl([], tools=None)
    assert time.monotonic() - started >= BLOCK_S * 0.8
