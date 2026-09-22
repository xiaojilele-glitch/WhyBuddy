"""权限漏堵批量修的路由级验证（2026-08-14 审计批）。

审计（见架构图 ⚑⚑ 权限审计节）点出的漏，每条一个测试钉死：

    ① 推演类三条路（orchestrate-plan / execute-capability / drive-marathon）
      只有内部密钥没有登录门——非生产环境密钥可不带，等于全开
    ② POST /llm-channel（改**服务器级** LLM 通道）任何人可打
    ③ GET /apps-export 匿名可拖走全库（含所有人私有应用的 model_json）
    ④ GET /apps/{root}/versions 不过滤——私有应用版本链可拿 root_id 枚举
    ⑤ POST /apps/{id}/preview 对看不见的私有应用可盲塞图
    ⑥ POST /components/presets 匿名可往公共模板库无限塞条目
    ⑦ 登录 Cookie 从不带 Secure——docstring 说跟随协议，实现没跟
    ⑧ devCode：生产环境没配邮件服务时验证码直接回给请求者（等于拆掉验证码）

与 test_app_routes_access 同一纪律：全走真实 HTTP，验"路由真的挂上了"，
不直接调判定函数。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("pwdlib", reason="没装 pwdlib 时身份体系不可用")
pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")


@pytest.fixture
def env(tmp_path, monkeypatch, real_auth):
    """干净本地库 + 三个用户（root 超管、alice/bob 普通）。套路同 test_app_routes_access。"""
    from config.settings import settings

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(
        settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'apps.db'}", raising=False
    )
    monkeypatch.setenv("SLIDERULE_IDENTITY_SQLITE", f"sqlite:///{tmp_path / 'id.db'}")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "r" * 48)
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)

    from services import app_store, auth_service, identity_store, session_blob_store

    identity_store.reset_identity_cache()
    app_store.reset_backend_cache()
    session_blob_store.reset_cache()

    def mk(email):
        started = auth_service.start_registration(email, "correct-horse-battery")
        return auth_service.complete_registration(email, "correct-horse-battery", started["devCode"])

    root = mk("root@example.com")
    alice = mk("alice@example.com")
    bob = mk("bob@example.com")

    from app import app as fastapi_app

    client = TestClient(fastapi_app)
    yield {
        "client": client,
        "root": root,
        "alice": alice,
        "bob": bob,
        "store": app_store,
    }
    identity_store.reset_identity_cache()
    app_store.reset_backend_cache()
    session_blob_store.reset_cache()


def _hdr(who=None):
    h = {"x-internal-key": "dev-slide-rule-internal"}
    if who:
        h["Authorization"] = f"Bearer {who['token']}"
    return h


def _seed(store, *, owner_id=None, visibility="public", name="演示应用"):
    model = {"appbundle": {"appIdentity": {"productName": name}}, "dataModel": {"entities": []}}
    return store.save_app(
        model, goal=name, session_id=None, gate_passed=True,
        owner_id=owner_id, visibility=visibility,
    )


API = "/api/sliderule"

# 最小合法 PNG 魔数 + 填充（够过 sniff + _looks_like_image）
_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


# ────────────────── ① 推演类三条路要登录 ──────────────────


def test_匿名不能orchestrate_plan(env):
    c = env["client"]
    r = c.post(f"{API}/orchestrate-plan", json={}, headers=_hdr())
    assert r.status_code == 401


def test_匿名不能execute_capability(env):
    c = env["client"]
    r = c.post(f"{API}/execute-capability", json={}, headers=_hdr())
    assert r.status_code == 401


def test_匿名不能drive_marathon(env):
    c = env["client"]
    r = c.post(f"{API}/drive-marathon", json={}, headers=_hdr())
    assert r.status_code == 401


# ────────────────── ② LLM 通道归管理员 ──────────────────


def test_普通用户不能改llm通道(env):
    c = env["client"]
    r = c.post(f"{API}/llm-channel", json={}, headers=_hdr(env["alice"]))
    assert r.status_code == 403
    r = c.post(f"{API}/llm-channel/test", headers=_hdr(env["alice"]))
    assert r.status_code == 403


def test_超管能过llm通道的门(env):
    """空 payload = 不改任何 override，只验门放行（不真调 LLM）。"""
    c = env["client"]
    r = c.post(f"{API}/llm-channel", json={}, headers=_hdr(env["root"]))
    assert r.status_code == 200


def test_llm通道状态读取仍然开放(env):
    """GET 只回掩码后的状态，读不收紧——设置面板匿名也能看到当前通道。"""
    c = env["client"]
    r = c.get(f"{API}/llm-channel", headers=_hdr())
    assert r.status_code == 200


# ────────────────── ③ 全量导出归管理员 ──────────────────


def test_apps_export_匿名401_普通403_超管200(env):
    store, c = env["store"], env["client"]
    _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private", name="私货")
    assert c.get(f"{API}/apps-export", headers=_hdr()).status_code == 401
    assert c.get(f"{API}/apps-export", headers=_hdr(env["alice"])).status_code == 403
    r = c.get(f"{API}/apps-export", headers=_hdr(env["root"]))
    assert r.status_code == 200
    assert len(r.json()["apps"]) == 1


# ────────────────── ④ 版本链要过同一份过滤 ──────────────────


def test_私有应用的版本链不给外人枚举(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private", name="私货")
    record = store.get_app(aid)
    root_id = record.get("root_id") or aid
    # 匿名与 bob 都拿不到；owner 自己看得到
    assert c.get(f"{API}/apps/{root_id}/versions", headers=_hdr()).json()["versions"] == []
    assert c.get(f"{API}/apps/{root_id}/versions", headers=_hdr(env["bob"])).json()["versions"] == []
    mine = c.get(f"{API}/apps/{root_id}/versions", headers=_hdr(env["alice"])).json()["versions"]
    assert len(mine) == 1


# ────────────────── ⑤ 截图上传：看得见才能传 ──────────────────


def test_看不见的私有应用不能被塞图(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private", name="私货")
    r = c.post(
        f"{API}/apps/{aid}/preview", content=_PNG,
        headers={**_hdr(env["bob"]), "content-type": "image/png"},
    )
    assert r.status_code == 404, "对无权者要报 404（不确认 id 存在），不是 403"


def test_公开应用的众包补图保住了(env):
    """采集的设计是"谁看见卡片谁补图"——公开应用任何登录观看者都能传。"""
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public", name="公开货")
    r = c.post(
        f"{API}/apps/{aid}/preview", content=_PNG,
        headers={**_hdr(env["bob"]), "content-type": "image/png"},
    )
    assert r.status_code == 200


def test_路过的访客不能覆盖别人已经采好的图(env):
    """replace 要写权限。众包只补空槽，不能把作者推演收口那张改掉。"""
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public", name="公开货2")
    first = c.post(
        f"{API}/apps/{aid}/preview", content=_PNG,
        headers={**_hdr(env["alice"]), "content-type": "image/png"},
    )
    assert first.status_code == 200 and first.json()["stored"] is True
    nxt = b"\x89PNG\r\n\x1a\n" + b"\x01" * 32
    r = c.post(
        f"{API}/apps/{aid}/preview?replace=true", content=nxt,
        headers={**_hdr(env["bob"]), "content-type": "image/png"},
    )
    assert r.status_code == 403
    owner = c.post(
        f"{API}/apps/{aid}/preview?replace=true", content=nxt,
        headers={**_hdr(env["alice"]), "content-type": "image/png"},
    )
    assert owner.status_code == 200 and owner.json()["stored"] is True


# ────────────────── ⑥ 模板库写入要登录 ──────────────────


def test_匿名不能往模板库塞条目(env):
    c = env["client"]
    r = c.post(
        f"{API}/components/presets",
        json={"blocks": [{"type": "x"}], "name": "垃圾"},
        headers=_hdr(),
    )
    assert r.status_code == 401


# ────────────────── ⑦ Cookie Secure 跟随协议 ──────────────────


def test_https登录种的cookie带Secure(env, tmp_path):
    from app import app as fastapi_app

    https_client = TestClient(fastapi_app, base_url="https://testserver")
    r = https_client.post(
        f"{API}/account/login",
        json={"email": "alice@example.com", "password": "correct-horse-battery"},
    )
    assert r.status_code == 200
    set_cookie = r.headers.get("set-cookie", "")
    assert "secure" in set_cookie.lower(), f"https 下没打 Secure：{set_cookie}"


def test_http登录种的cookie不带Secure(env):
    """本地 http 开发必须还能登上（Secure cookie 在 http 下会被浏览器丢掉）。"""
    c = env["client"]
    r = c.post(
        f"{API}/account/login",
        json={"email": "alice@example.com", "password": "correct-horse-battery"},
    )
    assert r.status_code == 200
    assert "secure" not in r.headers.get("set-cookie", "").lower()


# ────────────────── ⑧ devCode 生产不外泄 ──────────────────


def test_生产环境devCode不回给请求者(env, monkeypatch):
    from config.settings import settings
    from services import auth_service

    monkeypatch.setattr(settings, "NODE_ENV", "production", raising=False)
    started = auth_service.start_registration("newbie@example.com", "correct-horse-battery")
    assert started.get("ok") is True
    assert "devCode" not in started, "生产环境把验证码回给请求者 = 任何人可替任意邮箱注册"


def test_非生产devCode照旧_自部署第一步不卡死(env):
    from services import auth_service

    started = auth_service.start_registration("dev@example.com", "correct-horse-battery")
    assert started.get("devCode"), "非生产没邮件服务时 devCode 必须在，否则自部署无法注册"
