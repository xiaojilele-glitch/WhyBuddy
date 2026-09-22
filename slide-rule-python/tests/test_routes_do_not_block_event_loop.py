# -*- coding: utf-8 -*-
"""慢路由不许占死事件循环——判据起**真服务、从外部进程量**（2026-08-21）。

## 事故形状（真机实测）

起真服务，两个人各打一次 `/api/sliderule/intake-judge`（意图判定，用户每输入
一句话都走，单次 7.9 秒），同时第三个人打 `/api/health`：

    空载                      0.0013s
    两个人在用时              10.51s      ← 8000 倍
    那两个人结束后            0.0013s

`intake_judge_turn` 当时是 `async def` 里裸调 `judge_turn()` → LLM。那 7.9 秒里
**事件循环整个停摆**，连健康检查都答不上。跟 2026-08-02 那次事故注释里写的
一字不差（routes/sliderule_full.py 的 /drive-full 头注）。同一个病第四次。

## ⚠ 这条判据被我写坏过两次，形状都值得记住

**第一次：量错了对象。** 判据里写死出厂默认密钥，而 .env 设了真 key，于是每个
请求都 403 秒回——判据量的是 403 的耗时，0.37s 纯噪声，看起来却像个结论。
现在不带 key（非 production 下 _auth 对空 key 放行，routes/sliderule_full.py:84）。

**第二次：在同一个事件循环里量它被阻塞。** 用 httpx.ASGITransport 在判据进程内
跑应用，结果 `async` 版本下判据照样全绿。原因是**循环被占死时测量代码自己也
没在跑**，等它能跑了阻塞已经结束，永远只采到空闲那一瞬。实测数据：

    慢请求总耗时 2.01s、串行（确实占死了循环）
    judge_turn 被调用 2 次（patch 生效）
    而同进程采样只采到 1 次，量到 0.001s  ← 假绿

真机那次能测出 10.5s，正是因为 curl 在另一个进程。所以这条起真 uvicorn 子进程、
从判据进程用 HTTP 量——**量它的东西必须在被量的循环之外**。

## 为什么不扫源码

静态扫描在这件事上骗过我两次：判「会不会走到 LLM」判松了报 50 处、收紧后 7 处，
而其中 provider_health 实测 0.07s（根本不发 LLM 请求，纯误报）。
仓里那条 test_no_blocking_io_on_event_loop 也是扫源码 + 手工白名单，
52 个同步函数只认 7 个，delete_session 这种明摆着碰 IO 的都不在名单里。
"""
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
LAUNCHER = os.path.join(HERE, "_slow_judge_server.py")
SLOW_SECONDS = 1.0
#: 并发时 /api/health 的容忍上限。真机空载 0.0013s，这里给足余量——
#: 判据要咬的是「秒级阻塞」，不是抖动。
MAX_BLOCKED = 0.35


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url: str, timeout: float = 30.0) -> float:
    t0 = time.time()
    with urllib.request.urlopen(url, timeout=timeout) as r:
        r.read()
    return time.time() - t0


def _post_bg(url: str, body: bytes):
    """后台发一个慢请求：单独进程，别占住判据自己的线程。"""
    return subprocess.Popen(
        [sys.executable, "-c",
         f"import urllib.request;urllib.request.urlopen(urllib.request.Request({url!r},"
         f"data={body!r},headers={{'Content-Type':'application/json'}}),timeout=60).read()"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


@pytest.fixture(scope="module")
def server():
    port = _free_port()
    env = {**os.environ, "SLOW_JUDGE_SECONDS": str(SLOW_SECONDS), "NODE_ENV": "development"}
    proc = subprocess.Popen(
        [sys.executable, LAUNCHER, str(port)],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            _get(base + "/api/health", timeout=2)
            break
        except (urllib.error.URLError, OSError):
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.skip("测试服务起不来")
    for _ in range(3):      # 预热：/api/health 首次调用要 0.25s（探针懒加载）
        _get(base + "/api/health")
    yield base
    proc.kill()
    proc.wait(timeout=10)


class Test慢路由不许占死事件循环:
    def test_有人在用时_健康检查仍然秒回(self, server):
        """★ 用户报的那个 bug：多个人用，第二个人一直 loading。"""
        body = b'{"text":"\\u7ed9\\u70d8\\u7119\\u5e97\\u505a\\u7cfb\\u7edf","hasApp":false}'
        procs = [_post_bg(server + "/api/sliderule/intake-judge", body) for _ in range(2)]
        time.sleep(SLOW_SECONDS * 0.35)     # 让慢请求真正进到路由里
        worst = max(_get(server + "/api/health") for _ in range(3))
        for p in procs:
            p.wait(timeout=60)
        assert worst <= MAX_BLOCKED, (
            f"2 个慢请求在跑时，/api/health 等了 {worst:.2f}s（上限 {MAX_BLOCKED}s）。"
            f"事件循环被占死——真机上这是全站白屏转圈。"
            f"修法：路由体没有 await 就去掉 `async`（FastAPI 自动丢 anyio 线程池），"
            f"有 await 就把慢调用包成 await asyncio.to_thread(...)。"
        )

    def test_慢请求自己仍然答得出(self, server):
        """反向判据：别为了不阻塞把功能改坏了。

        少了这条，把路由改成直接返回空、或删掉慢调用，上面那条照样绿。
        """
        req = urllib.request.Request(
            server + "/api/sliderule/intake-judge",
            data=b'{"text":"\\u7ed9\\u836f\\u5e97\\u505a\\u8fdb\\u9500\\u5b58","hasApp":false}',
            headers={"Content-Type": "application/json"},
        )
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=60) as r:
            import json

            payload = json.loads(r.read())
        assert (payload.get("judgement") or {}).get("action"), "判定结果没返回"
        assert time.time() - t0 >= SLOW_SECONDS * 0.8, (
            "慢请求没有真的慢——桩没生效，那上面那条判据量的是别的东西"
        )
