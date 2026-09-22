"""推演跑起来时，服务其余部分必须照常响应（2026-08-02 线上事故）。

事故形状：只要有人在生成应用，整个服务就不响应，连 /api/health 都超时；而且
想停都停不干净（dev:stop 停不掉、端口一直被占）。

根因不在数据库——本地复现时走的是 Neon HTTP 通道，实测 p50 77ms。真正的原因是
`drive_full_v5_session` 是**同步**函数（一趟 6~20 分钟），却被直接写在
`async def` 路由里，于是整段跑在事件循环那条线程上。单 worker 下，事件循环被
占住 = 全站失联。

修法是 FastAPI 官方口径：路由声明成 `def`，Starlette 会自动 run_in_threadpool。
这份测试盯的就是这条纪律不被改回去。
"""

from plan_approval_support import approved_execution_payload

import inspect
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes import sliderule_full


BLOCKING_ROUTES = ["drive", "drive_full"]


@pytest.mark.parametrize("name", BLOCKING_ROUTES)
def test_blocking_routes_are_declared_sync(name):
    """**这两条路由必须是 `def`，不能是 `async def`。**

    它们内部调的是同步的重活（drive_reasoning_turn / drive_full_v5_session）。
    写成 async 就等于把 6~20 分钟的阻塞放进事件循环——这正是线上那次全站失联。

    为什么钉签名而不是钉"有没有 to_thread"：签名是声明式的，漏不掉；手动包
    to_thread 要在每个调用点各写一遍，而这两条当初正是漏掉的那两条。
    """
    fn = getattr(sliderule_full, name)
    assert not inspect.iscoroutinefunction(fn), (
        f"{name} 又变回 async def 了——同步重活会占住事件循环，见本文件头注"
    )


def test_health_still_answers_while_a_long_drive_is_running(monkeypatch):
    """**跑着推演的时候，健康检查必须照常答。**

    这条是行为级的复现：让 drive-full 卡住不返回，同时打 /api/health，断言它
    在秒级内拿到响应。改回 async def 时这条会挂——事件循环被占住，健康检查
    根本轮不到。
    """
    started = threading.Event()
    release = threading.Event()

    def blocking_drive(state, max_loops=10, user_instruction=""):
        started.set()
        release.wait(timeout=30)   # 模拟一趟长推演
        return state

    monkeypatch.setattr(sliderule_full, "drive_full_v5_session", blocking_drive, raising=False)

    app = FastAPI()
    app.include_router(sliderule_full.router, prefix="/api/sliderule")
    # 推演要求登录（2026-08-02）。这条用例自己建了 app，conftest 那个
    # 全局默认身份够不着它——不装的话 drive-full 直接 401，started 永不置位，
    # 用例会以"推演没跑起来"失败（而不是静默空过，那条断言就是为此写的）。
    from middlewares.current_user import optional_user

    class _U:
        id = "u-loop-test"
        is_active = True
        is_superuser = False

    app.dependency_overrides[optional_user] = lambda: _U()

    @app.get("/api/health")
    def health():
        return {"ok": True}

    with TestClient(app) as client:
        sid = client.post("/api/sliderule/sessions", json={"goal": {"text": "阻塞测试"}})
        assert sid.status_code == 200, sid.text
        state = sid.json()["state"]

        def fire():
            try:
                client.post("/api/sliderule/drive-full",
                            json=approved_execution_payload({"state": state, "userText": "阻塞测试", "max_loops": 1}))
            except Exception:
                pass

        worker = threading.Thread(target=fire, daemon=True)
        worker.start()
        try:
            assert started.wait(timeout=15), "推演没跑起来，这条用例是空过的"
            t0 = time.time()
            res = client.get("/api/health")
            elapsed = time.time() - t0
            assert res.status_code == 200
            assert elapsed < 5, (
                f"推演进行中健康检查花了 {elapsed:.1f}s——事件循环被占住了"
            )
        finally:
            release.set()
            worker.join(timeout=15)
