# -*- coding: utf-8 -*-
"""把「`async def` 里做同步 IO = 全站串行」这条机制量出来。

test_no_blocking_io_on_event_loop 钉的是"代码里不许有这种写法"，靠静态扫描。
这一份补的是**为什么**：拿两条只差一个 `async` 关键字的路由，各打 5 个并发，
看总耗时。数字自己会说话，比注释里写一句"会阻塞"结实得多。

## 事故背景（2026-08-10）

两台电脑同时开着页面，一台发起推演，另一台一直转圈。服务器上初判是
"只跑了一个 worker"——worker 确实只有一个，但那是放大器不是病根：
`GET /sessions` 标着 `async def` 却在里面同步拉 5.2 MB 会话存档（实测
2278 ms），这 2.3 秒整个进程停摆，别人的请求全在排队。

## 框架的答案

fastapi/routing.py:344 —

    if is_coroutine:
        return await dependant.call(**values)                      # async def
    else:
        return await run_in_threadpool(dependant.call, **values)   # def

`run_in_threadpool` = `anyio.to_thread.run_sync`（默认 40 令牌）。所以同步
路由**写成 `def` 才是对的**。这份测试就是这句话的证据。
"""

import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

#: 一次"同步 IO"要多久。取 120ms：足够让串行/并行拉开数量级差距，
#: 又不至于让这条测试自己变慢（串行档总计约 0.6s）。
BLOCK_MS = 120
N = 5


def _blocking_io() -> str:
    """模拟一次同步网络往返（真实场景是 httpx.Client 打 HTTPS 网关）。"""
    time.sleep(BLOCK_MS / 1000)
    return "ok"


@pytest.fixture(scope="module")
def client():
    app = FastAPI()

    @app.get("/wrong")
    async def wrong():  # noqa: RUF029 — 故意的：这就是要证伪的写法
        return {"r": _blocking_io()}

    @app.get("/right")
    def right():
        return {"r": _blocking_io()}

    with TestClient(app) as c:
        yield c


def _burst(client, path: str) -> float:
    """N 个并发打同一条路由，返回总墙钟毫秒。"""
    def one(_i):
        return client.get(path).status_code

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=N) as ex:
        codes = list(ex.map(one, range(N)))
    assert codes == [200] * N
    return (time.perf_counter() - started) * 1000


def test_async_def_里做同步IO_会把并发压成串行(client):
    total = _burst(client, "/wrong")
    # 串行意味着总耗时 ≈ N × 单次。留一半余量抗抖动。
    assert total > BLOCK_MS * N * 0.6, (
        f"总耗时 {total:.0f}ms —— 没有串行？那说明这条测试的前提变了，"
        "先确认 FastAPI 还是把 async def 直接跑在事件循环上"
    )


def test_同步def交给框架的线程池_并发是真并发(client):
    total = _burst(client, "/right")
    # 并行意味着总耗时 ≈ 单次（线程池默认 40 槽，N=5 全部同时开跑）
    assert total < BLOCK_MS * 2.5, (
        f"总耗时 {total:.0f}ms —— 同步 def 本该进线程池并发跑完，"
        "变慢了说明线程池被占满或被改小了（anyio 默认 40 令牌）"
    )


def test_两者差距要足够大_不然这条测试没有判别力(client):
    wrong = _burst(client, "/wrong")
    right = _burst(client, "/right")
    assert wrong > right * 2, (
        f"async 档 {wrong:.0f}ms vs 同步档 {right:.0f}ms —— 差距不到 2 倍，"
        "机器太慢或 BLOCK_MS 太小，这条测试已经量不出东西了"
    )
