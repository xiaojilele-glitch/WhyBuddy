"""取消控制面轮次时，在飞的 LLM 请求必须**真的**停，不是账面上停。

2026-08-27 真机实测（社区养老 / 连锁餐饮两趟，探针打在 call_control_llm 进出）：

    272.290  发起
    273.131  LLM 调用开始
    275.319  ← 客户端断开
    278.427  LLM 调用才返回        ← 客户端走后又跑了 3.1 秒

当时 Starlette **确实**把生成器协程取消了（不进第 2 轮、不 yield、不落盘），
但同步 httpx 塞在 run_in_threadpool 里，`Task.cancel()` 打不断线程里阻塞的
socket 读。钱照烧、线程池的槽照占，而所有外部可见的信号都说"停了"。
这就是本仓数过很多次的「状态绿了但东西没停」，这次落在控制面上。

判据必须打在**服务端有没有收到完整请求**上，不能打在客户端拿没拿到结果、
也不能打在协程抛没抛 CancelledError——那两样在坏版本上同样成立
（坏版本正是"客户端早就走了、协程也抛了，线程还在跑"）。

⚠ 别把这里的 fake LLM 换成 asyncio.sleep 就算数：要复现的是**真的发一个
  HTTP 请求出去**，所以起了一个真的慢 HTTP 服务端，看它有没有被 socket
  层面掐断。
"""

from __future__ import annotations

import asyncio
import http.server
import socketserver
import threading
import time

import httpx
import pytest

pytest.importorskip("fastapi")


BLOCK_S = 6.0


class _SlowLLM(http.server.BaseHTTPRequestHandler):
    """慢到足以在中途被打断的假 LLM。完整跑完才记一笔 finished。"""

    def do_POST(self):  # noqa: N802
        time.sleep(BLOCK_S)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"choices":[{"message":{"content":"hi"}}]}')
            self.server.finished.append(time.time())  # type: ignore[attr-defined]
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # 客户端 socket 已经被关掉 —— 正是"真的停了"的证据。
            # Windows 上是 ConnectionAbortedError（WinError 10053），不是 BrokenPipe。
            self.server.aborted.append(time.time())  # type: ignore[attr-defined]

    def log_message(self, *a):  # noqa: A003
        pass


@pytest.fixture
def slow_llm():
    srv = socketserver.TCPServer(("127.0.0.1", 0), _SlowLLM)
    srv.finished = []  # type: ignore[attr-defined]
    srv.aborted = []  # type: ignore[attr-defined]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv
    srv.shutdown()


def _cancel_midflight(call, cancel_after: float) -> str:
    """跑 call()，cancel_after 秒后取消它。返回 'cancelled' / 'finished'。"""

    async def run() -> str:
        task = asyncio.ensure_future(call())
        await asyncio.sleep(cancel_after)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            return "cancelled"
        except Exception:
            return "finished"
        return "finished"

    return asyncio.run(run())


def test_cancelling_the_turn_aborts_the_inflight_request(slow_llm, monkeypatch):
    """正向 + 反向：协程取消了（正向），**且服务端那半个请求被掐断**（反向）。

    坏版本（同步 httpx + run_in_threadpool）上：协程照样报 cancelled，但慢
    服务端会**跑完**并成功写回 —— finished 里多一笔、aborted 里一笔都没有。
    """
    from sliderule_llm import control_client

    port = slow_llm.server_address[1]

    class _Cfg:
        api_key = "k"
        base_url = f"http://127.0.0.1:{port}/v1"
        model = "m"
        timeout_ms = 60000

    monkeypatch.setattr(control_client, "get_llm_config", lambda: _Cfg())

    outcome = _cancel_midflight(
        lambda: control_client.call_control_llm([{"role": "user", "content": "hi"}]),
        cancel_after=1.0,
    )
    assert outcome == "cancelled", "协程本身没被取消，判据的前提就不成立"

    # 给服务端留足时间：如果请求**没**被真掐断，它会在 BLOCK_S 后跑完并记 finished。
    time.sleep(BLOCK_S + 1.5)

    assert not slow_llm.finished, (
        f"取消之后服务端仍然把这次请求**跑完了**（finished={len(slow_llm.finished)}）。"
        "这就是「账面停了、活还在烧」：客户端早走了、协程也抛了 CancelledError，"
        "但请求没有被 socket 层面中止。检查 call_control_llm 是不是被改回同步 "
        "httpx / 被塞进 run_in_threadpool 了。"
    )
    assert slow_llm.aborted, "服务端既没跑完也没被掐断——判据自己打空了，先修夹具"


def test_call_control_llm_is_a_coroutine_function():
    """取消能穿透的前提。改回 def 会让上面那条在某些机器上变flaky，这条直接钉死。"""
    import inspect

    from sliderule_llm.control_client import call_control_llm

    assert inspect.iscoroutinefunction(call_control_llm), (
        "call_control_llm 必须是 async：只有请求跑在事件循环上，asyncio 的取消"
        "才传导得到 socket。同步版塞进线程池后 Task.cancel() 打不断它。"
    )


def test_seam_awaits_coroutine_impls_directly(monkeypatch):
    """反向判据：接缝不许把真协程实现塞进线程池。

    塞进去不会报错、也不会让功能看起来坏掉——只会让取消**静静地**失效。
    所以这条盯的是"有没有绕过事件循环"，不是"结果对不对"。
    """
    from services import rehearsal_control as rc

    loop_thread = threading.current_thread().name
    seen: dict = {}

    async def fake_async_llm(messages, **kwargs):
        seen["thread"] = threading.current_thread().name
        return "ok"

    monkeypatch.setattr(rc, "call_control_llm", fake_async_llm)
    out = asyncio.run(rc._invoke_control_llm([{"role": "user", "content": "x"}], tools=[]))

    assert out == "ok"
    assert seen["thread"] == loop_thread, (
        f"协程实现跑在了 {seen['thread']}（应为 {loop_thread}）——被塞进线程池了，"
        "取消将无法传导到 socket。"
    )


def test_seam_still_offloads_sync_impls(monkeypatch):
    """另一半：同步实现（42 个文件共用的测试替身）必须照旧下线程池。

    直接 await 一个阻塞的同步函数会把事件循环焊死，
    test_control_stream_does_not_block_the_loop 那条并发判据立刻红。
    """
    from services import rehearsal_control as rc

    loop_thread = threading.current_thread().name
    seen: dict = {}

    def fake_sync_llm(messages, **kwargs):
        seen["thread"] = threading.current_thread().name
        return "ok"

    monkeypatch.setattr(rc, "call_control_llm", fake_sync_llm)
    out = asyncio.run(rc._invoke_control_llm([{"role": "user", "content": "x"}], tools=[]))

    assert out == "ok"
    assert seen["thread"] != loop_thread, (
        "同步实现被直接 await 在事件循环上了——阻塞的替身会冻住所有并发的流。"
    )


def test_seam_forwards_the_trimmed_manifest_to_the_impl(monkeypatch):
    """接缝不许把工具清单吃掉。

    ⚠ 2026-08-27 加这条的原因：接缝一插进来，
      test_tool_should_list::test_llm_call_site_uses_the_filtered_manifest
      那条源码形状的判据就只能证明「裁剪过的清单**进了接缝**」，证明不了
      「接缝把它**转出去了**」。接缝里少写一个 tools= 不会报错，只会让整张
      裁剪静默失效——正是本仓 §3 说的「正向判据齐全、反向判据缺失」。
      两条分派路径都要钉：漏一条就是半个闸（§4）。
    """
    from services import rehearsal_control as rc

    trimmed = [{"type": "function", "function": {"name": "ask_user"}}]

    for label, make in (("async", "coro"), ("sync", "plain")):
        seen: dict = {}

        if make == "coro":

            async def impl(messages, **kwargs):
                seen.update(kwargs)
                return "ok"

        else:

            def impl(messages, **kwargs):
                seen.update(kwargs)
                return "ok"

        monkeypatch.setattr(rc, "call_control_llm", impl)
        asyncio.run(rc._invoke_control_llm([{"role": "user", "content": "x"}], tools=trimmed))

        assert seen.get("tools") == trimmed, (
            f"{label} 分派路径没把裁剪后的清单转给模型（拿到 {seen.get('tools')!r}）——"
            "裁剪会静默失效，模型又能看见本该藏起来的工具。"
        )
