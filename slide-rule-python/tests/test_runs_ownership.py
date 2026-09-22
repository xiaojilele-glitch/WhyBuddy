# -*- coding: utf-8 -*-
"""`/runs/*` 必须判登录与归属，而且看不见的一律 404。

## 事故（2026-09-06 审计，三个端口上实测）

`/runs/*` 五条此前只有 `_auth(x_internal_key)`，而 `_auth` 在
`NODE_ENV != production` 下**是 no-op**（它自己的注释写着这是为了让 vite
直连 Python 的开发代理跑得起来）。实测不带任何 cookie：

    GET /api/sliderule/runs/active?sessionId=<别人的会话>
        :3000 → 200    :3001 → 200    :9700 → 200
    对照 GET /api/sliderule/sessions/<同一个 id>
                       → 404          （归属判定生效）

**会话本体拦住了，围着它的那一圈 run 接口全是敞开的。** 而敞开的不只是读：

    GET    /runs/{id}/stream   整轮推演的全文（话题、SPEC、逐页 HTML、LLM 增量）
    DELETE /runs/{id}          杀掉别人正在跑的推演（这一轮判死、白烧）
    POST   /runs/{id}/hold     把别人的推演停在下一个安全点
    POST   /runs/{id}/release  **替别人回答假设卡**

这是本仓反复数到的形状：主资源装了闸，围着它的附属接口没装。

## 顺带在隔壁发现的第六个洞

`POST /sessions/{sid}/model-versions/{version_id}/restore` 连 `viewer` 参数
都没有。它是**写**路径：把别人会话的当前模型换成某个历史版本并追加一条版本
记录。比那五条读接口更严重，一起补了。

## 抄的是本仓的哪一处

`GET /sessions/{sid}` 的 `_require_session`，以及它引的
`services/app_access.require` 头注：

    404 vs 403 的取舍：**看不见的资源报 404**，而不是 403。报 403 等于确认
    "这个 id 确实存在"，可以被用来枚举别人的私有应用。

动作沿用既有词表（`app_access.REQUIRED`）不新造：
`view` = READ（读），`drive` = WRITE（改这一轮的走向）。

## ⚠ 这个文件必须用 `real_auth`

conftest 给全套件注入了一个默认"已登录"身份（`u-test-default`）。不摘掉的话
匿名分支**永远测不到**——判据会全绿而洞还在。`real_auth` 就是为这件事准备的。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from conftest import TEST_USER_ID  # noqa: E402

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from app import app  # noqa: E402
from models.v5_state import V5SessionState  # noqa: E402
from services.slide_rule_session import load_session, save_session  # noqa: E402

client = TestClient(app)
KEY = {"x-internal-key": "dev-slide-rule-internal"}

#: 被测的五条。写成一张表：加了新的 run 接口忘记补鉴权时，下面
#: `test_五条run接口全都拿了viewer` 会红并指名道姓。
RUN_ENDPOINTS = [
    ("GET", "/api/sliderule/runs/active?sessionId={sid}", "view"),
    ("GET", "/api/sliderule/runs/{run}/stream?since=0", "view"),
    ("DELETE", "/api/sliderule/runs/{run}", "drive"),
    ("POST", "/api/sliderule/runs/{run}/hold", "drive"),
    ("POST", "/api/sliderule/runs/{run}/release", "drive"),
]


def _seed(sid: str, owner: str | None) -> None:
    save_session(
        V5SessionState(
            sessionId=sid,
            ownerId=owner,
            goal={"text": "归属判定", "status": "clear"},
            artifacts=[],
            capabilityRuns=[],
        )
    )


class _StubTask:
    """`cancel_run` 要求 `run.task is not None`（硬取消兜底要用它）。

    ⚠ 不给它就永远 `cancelled=False`，于是"自己的 run 取消得了"那条会因为
      **run 生命周期**而红，看起来像鉴权把产品拦死了 —— 两件事混在一条判据里
      最难查。这个桩把生命周期那半摘干净，只留归属那半。
    """

    def __init__(self) -> None:
        self.cancelled = False

    def done(self) -> bool:
        return False

    def cancel(self) -> None:
        self.cancelled = True


def _register_run(run_id: str, sid: str, *, live: bool = False, with_task: bool = False):
    """在注册表里挂一个 run（不起协程）。归属判据只需要 run→session 这条边。

    ⚠ `live` 默认 **False**（`finished_at` 已置）。理由是 SSE：
      `GET /runs/{id}/stream` 对一条还活着的 run 返回的是**永不结束的流**，
      `TestClient.get` 会一直阻塞。变异检查里把 stream 的守卫删掉那一刀，
      第一版就这么把整个变异脚本挂死了六分钟（看起来像"判据跑不完"，
      其实是夹具让被测流没有终点）。

      要 `live=True` 的只有 cancel / hold —— 它们的 `run_registry` 实现
      要求 `is_live(run)`。那两条不碰 SSE，不会挂。
    """
    import time

    from services import run_registry

    state = load_session(sid)
    run = run_registry.Run(run_id, sid, owner_id=state.ownerId if state else None)
    if not live:
        run.finished_at = time.monotonic()
    if with_task:
        run.task = _StubTask()  # type: ignore[assignment]
    run_registry._runs[run_id] = run
    run_registry._active_by_session[sid] = run_id
    return run


@pytest.fixture
def cleanup_runs():
    made: list[tuple[str, str]] = []
    yield made
    from services import run_registry

    for run_id, sid in made:
        run_registry._runs.pop(run_id, None)
        if run_registry._active_by_session.get(sid) == run_id:
            run_registry._active_by_session.pop(sid, None)


def _call(method: str, url: str):
    if method == "GET":
        return client.get(url, headers=KEY)
    if method == "DELETE":
        return client.delete(url, headers=KEY)
    return client.post(url, headers=KEY, json={})


def _nothing_happened(res) -> bool:
    """「什么也没发生」：404，或 200 + cancelled/held/released = false。

    这三条接口本来就用 false 表达"闸不在"（真机竞态是常态，不是错误），
    看不见沿用同一形状 —— **不泄漏存在性**。但绝不许是 true，
    那就是真动了别人的 run。
    """
    if res.status_code == 404:
        return True
    if res.status_code != 200:
        return False
    try:
        body = res.json()
    except Exception:  # noqa: BLE001
        return False
    if not isinstance(body, dict):
        return False
    for key in ("cancelled", "held", "released"):
        if key in body:
            return body[key] is False
    return False


# ── 匿名 ────────────────────────────────────────────────────────────────
@pytest.mark.usefixtures("real_auth")
class Test匿名进不来:
    @pytest.mark.parametrize(
        "method,tpl,action", RUN_ENDPOINTS, ids=[t for _, t, _ in RUN_ENDPOINTS]
    )
    def test_匿名动不了别人的run(self, method, tpl, action, cleanup_runs):
        """变异：把任一条上的 `_visible_run` / `_require_run_session` 删掉 → 本条红。"""
        sid = f"sr-own-anon-{abs(hash(tpl)) % 10**6}"
        run_id = f"run-{sid}"
        _seed(sid, TEST_USER_ID)  # 属于别人
        # 这条走全部五个 URL，含 SSE —— 必须用已收尾的 run，否则流没有终点。
        # "真的没动手"由下面 Test看不见与不存在不可区分 里的 live 版本单独钉。
        _register_run(run_id, sid, with_task=True)
        cleanup_runs.append((run_id, sid))

        res = _call(method, tpl.format(sid=sid, run=run_id))
        assert _nothing_happened(res), (
            f"{method} {tpl} 匿名拿到了 {res.status_code} / {res.text[:200]}"
        )

    def test_匿名读不到会话的活跃run(self, cleanup_runs):
        """这条单独钉：`runs/active` 拿的是**调用方给的 sessionId**，
        不判归属就等于"给我一个 id 我就告诉你它在不在跑"。"""
        sid = "sr-own-active-anon"
        _seed(sid, TEST_USER_ID)
        _register_run(f"run-{sid}", sid)
        cleanup_runs.append((f"run-{sid}", sid))

        res = client.get(f"/api/sliderule/runs/active?sessionId={sid}", headers=KEY)
        assert res.status_code == 404, f"匿名拿到了 {res.status_code}：{res.text[:200]}"

    def test_匿名读不到别人推演的全文(self, cleanup_runs):
        """泄漏面最大的那条：事件流里有话题、SPEC、逐页 HTML、LLM 增量。"""
        sid = "sr-own-stream-anon"
        run_id = f"run-{sid}"
        _seed(sid, TEST_USER_ID)
        _register_run(run_id, sid)
        cleanup_runs.append((run_id, sid))

        res = client.get(f"/api/sliderule/runs/{run_id}/stream?since=0", headers=KEY)
        assert res.status_code == 404
        assert res.json() == {"error": "run_not_found"}

    def test_匿名不许放行别人正在等的假设卡(self, cleanup_runs):
        """⚠ 这条是变异检查逼出来的。

        参数化那条用的是**已收尾**的 run（为了不让 SSE 挂住），而 `release_run`
        对没有闸的 run 本来就返回 false —— 于是"把 release 的守卫删掉"那一刀
        判据照样绿：它测的是"没有闸"，不是"不是你的"。

        这里给 run 挂一道**真的在等的闸**，匿名放行必须既回 false、
        又真的没把闸放开。`release` 是整组里最要紧的一条：它**替人拿主意**，
        `answer` 会被当成用户对假设卡的回答写进推演。
        """
        from services import run_pause

        sid = "sr-own-release-gate"
        run_id = f"run-{sid}"
        _seed(sid, TEST_USER_ID)
        run = _register_run(run_id, sid, live=True)
        cleanup_runs.append((run_id, sid))

        gate = run_pause.request_hold(run.pause_slot)
        assert gate is not None, "闸没挂上 —— 判据自己打空了"

        res = client.post(
            f"/api/sliderule/runs/{run_id}/release",
            headers=KEY,
            json={"answer": {"forged": "别人替我答的"}},
        )
        assert res.json() == {"released": False}
        assert run_pause.is_holding(run.pause_slot), (
            "匿名把别人正在等的假设卡放行了 —— 等于替别人做了决定"
        )

    def test_会话查不到就当看不见(self, cleanup_runs):
        """⚠ 也是变异检查逼出来的：`_visible_run` 里"会话查不到 → return None"
        那一支，上面所有用例都没走到（它们的会话都存在）。

        查不到会话就没法判归属，此时"放行"等于**默认公开**。
        变异：把那一支改成 `return run` → 本条红。
        """
        sid = "sr-own-session-missing"
        run_id = f"run-{sid}"
        # 故意**不** _seed：注册表里有 run，库里没有会话。
        run = _register_run(run_id, sid, live=True, with_task=True)
        cleanup_runs.append((run_id, sid))

        res = client.delete(f"/api/sliderule/runs/{run_id}", headers=KEY)
        assert res.json() == {"cancelled": False}
        assert not run.cancel_token.is_set(), (
            "会话查不到时放行了 —— fail-open 等于默认公开"
        )

    def test_匿名不许回退别人的模型版本(self):
        """隔壁那个第六洞。它是**写**路径，比五条读接口更严重。"""
        sid = "sr-own-restore-anon"
        _seed(sid, TEST_USER_ID)
        res = client.post(
            f"/api/sliderule/sessions/{sid}/model-versions/v1/restore", headers=KEY
        )
        assert res.status_code == 404, f"匿名拿到了 {res.status_code}：{res.text[:200]}"


# ── 看不见就得跟不存在长一模一样 ────────────────────────────────────────
@pytest.mark.usefixtures("real_auth")
class Test看不见与不存在不可区分:
    def test_报404而不是403(self):
        """⚠ **403 等于承认这个 id 存在。** 可以被用来枚举别人的会话 / run。

        口径与 `app_access.require` 一字不差：看不见的资源报 404。
        变异：把 `_require_run_session` 里的 404 改成 403 → 本条红。
        """
        sid = "sr-own-404-not-403"
        _seed(sid, TEST_USER_ID)
        res = client.get(f"/api/sliderule/runs/active?sessionId={sid}", headers=KEY)
        assert res.status_code == 404, "看不见的会话没报 404"

    def test_不存在的会话与看不见的会话同一形状(self):
        """两者对外必须不可区分，否则 404 也能被用来枚举。"""
        seen = client.get(
            "/api/sliderule/runs/active?sessionId=sr-own-404-not-403", headers=KEY
        )
        never = client.get(
            "/api/sliderule/runs/active?sessionId=sr-this-never-existed-xyz",
            headers=KEY,
        )
        assert seen.status_code == never.status_code == 404
        assert seen.json() == never.json(), "看不见的和不存在的返回不一样，能被枚举"

    @pytest.mark.parametrize(
        "method,path,key",
        [
            ("DELETE", "/api/sliderule/runs/{run}", "cancelled"),
            ("POST", "/api/sliderule/runs/{run}/hold", "held"),
            ("POST", "/api/sliderule/runs/{run}/release", "released"),
        ],
        ids=["cancel", "hold", "release"],
    )
    def test_看不见的run与不存在的run回同一句话(self, method, path, key, cleanup_runs):
        """⚠ 这条是第一版修法的**反面判据**。

        第一版写成"找不到返回 None、看不见抛 404"，于是：

            run 不存在        → 200 {"cancelled": false}
            run 存在但看不见  → 404

        两者可区分，它自己就变成一个枚举探针 —— 把 404-不-403 那条纪律
        （不泄漏 id 存在性）在同一个接口上又破了一次。
        """
        sid = "sr-own-indist"
        run_id = f"run-{sid}"
        _seed(sid, TEST_USER_ID)
        # live：不然 cancel/hold 本来就返回 false，"不可区分"会因为
        # run 早就收尾而成立，判据变空。
        _register_run(run_id, sid, live=True, with_task=True)
        cleanup_runs.append((run_id, sid))

        invisible = _call(method, path.format(run=run_id))
        missing = _call(method, path.format(run="run-never-existed-xyz"))
        assert invisible.status_code == missing.status_code, (
            f"看不见({invisible.status_code}) 与不存在({missing.status_code}) 状态码不同"
        )
        assert invisible.json() == missing.json() == {key: False}

    def test_看不见的run不许真被停住(self, cleanup_runs):
        """回话形状一样不够，还得**真的没动手**。"""
        sid = "sr-own-hold-other"
        run_id = f"run-{sid}"
        _seed(sid, TEST_USER_ID)
        run = _register_run(run_id, sid, live=True)
        cleanup_runs.append((run_id, sid))

        client.post(f"/api/sliderule/runs/{run_id}/hold", headers=KEY, json={})
        from services import run_pause

        assert not run_pause.is_holding(run.pause_slot), (
            "别人的 run 真的被停住了 —— 归属判定在动手之后才跑"
        )

    def test_看不见的run不许真被取消(self, cleanup_runs):
        sid = "sr-own-cancel-other"
        run_id = f"run-{sid}"
        _seed(sid, TEST_USER_ID)
        run = _register_run(run_id, sid, live=True, with_task=True)
        cleanup_runs.append((run_id, sid))

        client.delete(f"/api/sliderule/runs/{run_id}", headers=KEY)
        assert not run.cancel_token.is_set(), (
            "别人的 run 真的被喊了取消 —— 归属判定在动手之后才跑"
        )


# ── 自己的照常能用（判据不许把产品拦死）────────────────────────────────
class Test自己的照常能用:
    """⚠ 没有这一组，"全都 404" 也能让上面全绿 —— 那是把产品拦死，不是修好。

    这一组**不用** `real_auth`：走 conftest 的默认已登录身份
    （`u-test-default`），也就是 `_seed(..., TEST_USER_ID)` 的主人。
    """

    def test_自己的会话查得到活跃run(self, cleanup_runs):
        sid = "sr-own-mine-active"
        run_id = f"run-{sid}"
        _seed(sid, TEST_USER_ID)
        # live：`get_active_run` 只认还活着的（已收尾的不算"活跃"）。
        _register_run(run_id, sid, live=True)
        cleanup_runs.append((run_id, sid))

        res = client.get(f"/api/sliderule/runs/active?sessionId={sid}", headers=KEY)
        assert res.status_code == 200, res.text[:300]
        active = res.json().get("active")
        assert active and active["runId"] == run_id

    def test_自己的run停得住也放得开(self, cleanup_runs):
        sid = "sr-own-mine-hold"
        run_id = f"run-{sid}"
        _seed(sid, TEST_USER_ID)
        run = _register_run(run_id, sid, live=True)
        cleanup_runs.append((run_id, sid))

        held = client.post(f"/api/sliderule/runs/{run_id}/hold", headers=KEY, json={})
        assert held.status_code == 200, held.text[:300]
        assert held.json() == {"held": True}
        from services import run_pause

        assert run_pause.is_holding(run.pause_slot)

        rel = client.post(
            f"/api/sliderule/runs/{run_id}/release", headers=KEY, json={"skip": True}
        )
        assert rel.status_code == 200, rel.text[:300]
        assert rel.json() == {"released": True}

    def test_自己的run取消得了(self, cleanup_runs):
        sid = "sr-own-mine-cancel"
        run_id = f"run-{sid}"
        _seed(sid, TEST_USER_ID)
        run = _register_run(run_id, sid, live=True, with_task=True)
        cleanup_runs.append((run_id, sid))

        res = client.delete(f"/api/sliderule/runs/{run_id}", headers=KEY)
        assert res.status_code == 200, res.text[:300]
        assert res.json() == {"cancelled": True}
        assert run.cancel_token.is_set()


# ── 接线本身 ────────────────────────────────────────────────────────────
class Test接线:
    def test_五条run接口全都拿了viewer(self):
        """⚠ 这条才是防"加第六条 run 接口又忘记判归属"的闸。

        `viewer: CurrentUserOptional` 是判归属的**前提**——签名里没有它，
        底下就不可能判。本仓第四条：只改一部分不报错、只有一部分不生效。
        """
        import inspect

        import routes.sliderule_full as R

        missing = []
        for name in (
            "runs_active",
            "run_stream",
            "run_cancel",
            "run_hold",
            "run_release",
            "restore_model_version",
        ):
            fn = getattr(R, name, None)
            assert fn is not None, f"路由函数 {name} 不见了 —— 判据自己打空了"
            if "viewer" not in inspect.signature(fn).parameters:
                missing.append(name)
        assert not missing, f"这些 run 接口没拿 viewer，压根没法判归属：{missing}"

    def test_每条都真的调了守卫(self):
        """签名里有 viewer 不等于用了它（上一版 `restore_model_version` 就是
        连 viewer 都没有）。这条查函数体里真的调了守卫。"""
        import ast

        import routes.sliderule_full as R

        src = Path(R.__file__).read_text(encoding="utf-8")
        tree = ast.parse(src, filename=R.__file__)
        wanted = {
            "runs_active": "_require_run_session",
            "run_stream": "_visible_run",
            "run_cancel": "_visible_run",
            "run_hold": "_visible_run",
            "run_release": "_visible_run",
            "restore_model_version": "_require_run_session",
        }
        seen: dict[str, bool] = {}
        for node in ast.walk(tree):
            if (
                isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
                and node.name in wanted
            ):
                names = {
                    n.func.id
                    for n in ast.walk(node)
                    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                }
                seen[node.name] = wanted[node.name] in names
        assert set(seen) == set(wanted), (
            f"没量到全部路由：{sorted(set(wanted) - set(seen))}"
        )
        assert all(seen.values()), (
            f"这些路由没调守卫：{sorted(k for k, v in seen.items() if not v)}"
        )

    def test_每条用的动作级别对得上(self):
        """读用 `view`（READ），改这一轮走向的用 `drive`（WRITE）。

        ⚠ 这条也是变异检查逼出来的：把 cancel 的 `"drive"` 放宽成 `"view"`，
          上面那条"每条都真的调了守卫"照样绿（守卫还在，只是级别松了），
          而后果是**只有只读权限的人也能杀掉别人的推演**。
          行为上要照出来得先造一个"有 READ 没有 WRITE"的访问者（授权链），
          比直接把级别钉在调用点上贵得多，也更容易写成假判据。
        """
        import ast

        import routes.sliderule_full as R

        expected = {
            "runs_active": "view",
            "run_stream": "view",
            "run_cancel": "drive",
            "run_hold": "drive",
            "run_release": "drive",
            "restore_model_version": "drive",
        }
        src = Path(R.__file__).read_text(encoding="utf-8")
        tree = ast.parse(src, filename=R.__file__)
        seen: dict[str, set[str]] = {}
        for node in ast.walk(tree):
            if (
                not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
                or node.name not in expected
            ):
                continue
            actions = {
                arg.value
                for call in ast.walk(node)
                if isinstance(call, ast.Call)
                and isinstance(call.func, ast.Name)
                and call.func.id in ("_visible_run", "_require_run_session")
                for arg in call.args
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
            }
            seen[node.name] = actions
        assert set(seen) == set(expected), (
            f"没量到全部路由：{sorted(set(expected) - set(seen))}"
        )
        wrong = {
            name: sorted(acts)
            for name, acts in seen.items()
            if acts != {expected[name]}
        }
        assert not wrong, f"这些路由的动作级别不对（应为 {expected}）：{wrong}"

    def test_动作用的是既有词表(self):
        """`view` / `drive` 都在 `app_access.REQUIRED` 里。

        ⚠ 拼错动作名的后果是 `can()` 返回 False（未知动作一律拒绝），
          也就是**整条接口对所有人 404** —— 那是把产品拦死，属于另一种事故。
          这条把动作名钉在词表上。
        """
        from services.app_access import REQUIRED, Access

        assert REQUIRED["view"] == Access.READ
        assert REQUIRED["drive"] == Access.WRITE

    def test_守卫在动手之前跑(self):
        """顺序判据：守卫必须排在 `run_registry.<动作>` 之前。

        写在后面等于"先动手、再问该不该"——本仓第四条的另一种形状。
        """
        import ast

        import routes.sliderule_full as R

        src = Path(R.__file__).read_text(encoding="utf-8")
        tree = ast.parse(src, filename=R.__file__)
        for fname, mutator in (
            ("run_cancel", "cancel_run"),
            ("run_hold", "hold_run"),
            ("run_release", "release_run"),
        ):
            node = next(
                n
                for n in ast.walk(tree)
                if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef))
                and n.name == fname
            )
            guard = [
                n.lineno
                for n in ast.walk(node)
                if isinstance(n, ast.Call)
                and isinstance(n.func, ast.Name)
                and n.func.id == "_visible_run"
            ]
            act = [
                n.lineno
                for n in ast.walk(node)
                if isinstance(n, ast.Call)
                and isinstance(n.func, ast.Attribute)
                and n.func.attr == mutator
            ]
            assert guard, f"{fname} 没调守卫"
            assert act, f"{fname} 里找不到 {mutator} —— 判据自己打空了"
            assert min(guard) < min(act), f"{fname} 先动手再判归属"
