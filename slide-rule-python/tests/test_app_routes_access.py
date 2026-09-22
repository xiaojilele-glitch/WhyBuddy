"""应用接口的权限（2026-08-02）。

上一份 test_app_access 验的是**判定模型**，这份验的是**路由真的挂上了**。
两者必须分开：模型对但路由忘了挂，正是我在那套 RBAC 后台里看到的形状——
`hasPermission` 写得好好的，53 个路由文件一个都没用。

所以这里全部走真实 HTTP（TestClient），不直接调函数。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("pwdlib", reason="没装 pwdlib 时身份体系不可用")
pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")


@pytest.fixture
def env(tmp_path, monkeypatch, real_auth):
    """一个干净的本地库 + 三个用户（一个超管两个普通）。

    `real_auth` 必须带上：conftest 给全套件装了"默认已登录"的依赖覆盖
    （几十条推演管线测试需要它），而这份测试恰恰要验匿名分支——不摘掉的话
    "匿名看不见私有应用"这类断言会因为访问者其实是登录用户而失去意义。
    """
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

    root = mk("root@example.com")   # 第一个 = 超管
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


# ────────────────────── 列表 ──────────────────────


def test_anonymous_list_hides_private_apps(env):
    store, c = env["store"], env["client"]
    _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public", name="公开的")
    _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private", name="私密的")

    got = c.get(f"{API}/apps", headers=_hdr()).json()["apps"]
    names = {a.get("product_name") for a in got}
    assert "公开的" in names
    assert "私密的" not in names, "匿名列表里出现了私有应用"


def test_owner_sees_own_private_app_in_the_list(env):
    store, c = env["store"], env["client"]
    _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private", name="只有我看得见")

    mine = c.get(f"{API}/apps", headers=_hdr(env["alice"])).json()["apps"]
    others = c.get(f"{API}/apps", headers=_hdr(env["bob"])).json()["apps"]
    assert "只有我看得见" in {a.get("product_name") for a in mine}
    assert "只有我看得见" not in {a.get("product_name") for a in others}


def test_unlisted_is_not_in_anyone_elses_list(env):
    store, c = env["store"], env["client"]
    app_id = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="unlisted", name="不公开列表")

    listed = c.get(f"{API}/apps", headers=_hdr(env["bob"])).json()["apps"]
    assert "不公开列表" not in {a.get("product_name") for a in listed}
    # 但有链接（知道 id）就能打开——这正是 unlisted 与 private 的区别
    assert c.get(f"{API}/apps/{app_id}", headers=_hdr(env["bob"])).status_code == 200


def test_legacy_ownerless_apps_stay_visible(env):
    """存量应用没有 owner_id —— 部署那一刻应用中心不能突然空掉。"""
    store, c = env["store"], env["client"]
    _seed(store, owner_id=None, visibility="public", name="老应用")
    got = c.get(f"{API}/apps", headers=_hdr()).json()["apps"]
    assert "老应用" in {a.get("product_name") for a in got}


# ────────────────────── 详情 ──────────────────────


def test_private_app_returns_404_not_403(env):
    """403 等于确认「这个 id 存在」，可用来枚举别人的私有应用。"""
    store, c = env["store"], env["client"]
    app_id = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private")

    assert c.get(f"{API}/apps/{app_id}", headers=_hdr()).status_code == 404
    assert c.get(f"{API}/apps/{app_id}", headers=_hdr(env["bob"])).status_code == 404
    assert c.get(f"{API}/apps/{app_id}", headers=_hdr(env["alice"])).status_code == 200
    assert c.get(f"{API}/apps/{app_id}", headers=_hdr(env["root"])).status_code == 200


# ────────────────────── 删除 ──────────────────────


def test_only_owner_or_superuser_can_delete(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public")

    assert c.delete(f"{API}/apps/{aid}", headers=_hdr(env["bob"])).status_code == 403
    assert c.delete(f"{API}/apps/{aid}", headers=_hdr()).status_code == 401
    assert c.delete(f"{API}/apps/{aid}", headers=_hdr(env["alice"])).status_code == 200


def test_superuser_can_delete_an_ownerless_legacy_app(env):
    """无主存量应用：普通用户不能删，超管可以（迁移期由它处理）。"""
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=None, visibility="public")
    assert c.delete(f"{API}/apps/{aid}", headers=_hdr(env["bob"])).status_code == 403
    assert c.delete(f"{API}/apps/{aid}", headers=_hdr(env["root"])).status_code == 200


# ────────────────────── Fork ──────────────────────


def test_fork_requires_login(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public")
    assert c.post(f"{API}/apps/{aid}/fork", headers=_hdr()).status_code == 401


def test_fork_assigns_the_new_app_to_the_forker(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public")

    resp = c.post(f"{API}/apps/{aid}/fork", json={"name": "我的副本"}, headers=_hdr(env["bob"]))
    assert resp.status_code == 200
    forked = store.get_app(resp.json()["id"])
    assert forked["owner_id"] == env["bob"]["user"]["id"], "副本没有归到 Fork 的人名下"


def test_fork_of_a_private_app_stays_private(env):
    """**最容易做反的一条。**

    Fork 产出的是新记录、新所有者，写成默认公开非常自然——那样 Fork 就成了绕过
    私有的后门。这里用超管去 Fork 一个别人的私有应用（超管读得到），断言副本仍私有。
    """
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private")

    resp = c.post(f"{API}/apps/{aid}/fork", headers=_hdr(env["root"]))
    assert resp.status_code == 200
    forked = store.get_app(resp.json()["id"])
    assert forked["visibility"] == "private", f"私有应用的副本变成了 {forked['visibility']}"

    # 而且副本对第三方仍然不可见
    assert c.get(f"{API}/apps/{forked['id']}", headers=_hdr(env["bob"])).status_code == 404


def test_cannot_fork_what_you_cannot_see(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private")
    assert c.post(f"{API}/apps/{aid}/fork", headers=_hdr(env["bob"])).status_code == 404


def _shelf_names(client, who, scope):
    r = client.get(f"{API}/apps", params={"scope": scope, "limit": 50}, headers=_hdr(who))
    assert r.status_code == 200, r.text
    return {a.get("product_name") for a in r.json()["apps"]}


# ────────────────────── 货架 scope=market|mine|official ──────────────────────


def test_unknown_shelf_is_400(env):
    c = env["client"]
    assert c.get(f"{API}/apps", params={"scope": "everything"}, headers=_hdr()).status_code == 400


def test_anonymous_mine_shelf_is_empty(env):
    store, c = env["store"], env["client"]
    _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public", name="广场上的")
    got = c.get(f"{API}/apps", params={"scope": "mine"}, headers=_hdr()).json()["apps"]
    assert got == []


def test_mine_shelf_is_owner_scoped_even_for_superuser(env):
    """超管的「我的应用」也只装他自己创建/Fork 的，不能把全站货架混进来。"""
    store, c = env["store"], env["client"]
    _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public", name="爱丽丝的公开")
    _seed(store, owner_id=env["bob"]["user"]["id"], visibility="public", name="鲍勃的公开")
    _seed(store, owner_id=env["root"]["user"]["id"], visibility="private", name="超管自己的")

    root_mine = _shelf_names(c, env["root"], "mine")
    assert "超管自己的" in root_mine
    assert "爱丽丝的公开" not in root_mine
    assert "鲍勃的公开" not in root_mine
    alice_mine = _shelf_names(c, env["alice"], "mine")
    assert alice_mine == {"爱丽丝的公开"}


def test_market_hides_private_and_official_apps(env):
    store, c = env["store"], env["client"]
    alice_id = env["alice"]["user"]["id"]
    public_id = _seed(store, owner_id=alice_id, visibility="public", name="广场货")
    _seed(store, owner_id=alice_id, visibility="private", name="私房货")
    official_id = _seed(store, owner_id=alice_id, visibility="public", name="官方货")
    store.patch_app(official_id, is_official=True)

    market = _shelf_names(c, None, "market")
    assert "广场货" in market
    assert "私房货" not in market
    assert "官方货" not in market
    official = _shelf_names(c, None, "official")
    assert official == {"官方货"}
    assert public_id not in {a["id"] for a in c.get(f"{API}/apps", params={"scope": "official"}, headers=_hdr()).json()["apps"]}


def test_owner_can_publish_and_unpublish(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private", name="先私后公")
    assert "先私后公" not in _shelf_names(c, env["alice"], "market")
    assert "先私后公" in _shelf_names(c, env["alice"], "mine")

    ok = c.patch(f"{API}/apps/{aid}", json={"visibility": "public"}, headers=_hdr(env["alice"]))
    assert ok.status_code == 200
    assert ok.json()["visibility"] == "public"
    assert "先私后公" in _shelf_names(c, None, "market")

    # 公开之后别人看得见，但改可见性仍要 OWNER；看不见的私有应用走 404，
    # 这条必须钉在「看得见但不够权」上，否则 403 断言会被 404 喂饱。
    denied = c.patch(f"{API}/apps/{aid}", json={"visibility": "private"}, headers=_hdr(env["bob"]))
    assert denied.status_code == 403

    back = c.patch(f"{API}/apps/{aid}", json={"visibility": "private"}, headers=_hdr(env["alice"]))
    assert back.status_code == 200
    assert "先私后公" not in _shelf_names(c, None, "market")
    assert "先私后公" in _shelf_names(c, env["alice"], "mine")


def test_only_superuser_can_mark_official(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public", name="候选官方")

    as_owner = c.patch(f"{API}/apps/{aid}", json={"is_official": True}, headers=_hdr(env["alice"]))
    assert as_owner.status_code == 403
    as_root = c.patch(f"{API}/apps/{aid}", json={"is_official": True}, headers=_hdr(env["root"]))
    assert as_root.status_code == 200
    assert as_root.json()["is_official"] is True
    assert as_root.json()["owner_id"] == "system:official"
    assert as_root.json()["prior_owner_id"] == env["alice"]["user"]["id"]
    assert "候选官方" in _shelf_names(c, None, "official")
    assert "候选官方" not in _shelf_names(c, None, "market")
    assert "候选官方" not in _shelf_names(c, env["alice"], "mine"), "移交后不应再出现在原作者的我的应用"

    back = c.patch(f"{API}/apps/{aid}", json={"is_official": False}, headers=_hdr(env["root"]))
    assert back.status_code == 200
    assert back.json()["owner_id"] == env["alice"]["user"]["id"]
    assert "候选官方" in _shelf_names(c, env["alice"], "mine")
    assert "候选官方" not in _shelf_names(c, None, "official")


def test_fork_lands_on_forkers_mine_shelf(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="public", name="可复刻")
    resp = c.post(f"{API}/apps/{aid}/fork", json={"name": "我的副本"}, headers=_hdr(env["bob"]))
    assert resp.status_code == 200
    assert "我的副本" in _shelf_names(c, env["bob"], "mine")
    assert "我的副本" not in _shelf_names(c, env["alice"], "mine")
    copy = store.get_app(resp.json()["id"])
    assert copy["is_official"] is False
    assert copy["visibility"] == "private"
    assert "我的副本" not in _shelf_names(c, None, "market")


def test_new_app_without_visibility_stays_off_the_market(env):
    """闭环默认 private：不显式公开就不进应用市场。"""
    store, c = env["store"], env["client"]
    model = {"appbundle": {"appIdentity": {"productName": "刚闭环"}}, "dataModel": {"entities": []}}
    store.save_app(model, goal="刚闭环", session_id=None, gate_passed=True, owner_id=env["alice"]["user"]["id"])
    rec = store.get_app(store.list_apps(shelf="mine", owner_id=env["alice"]["user"]["id"])[0]["id"])
    assert rec["visibility"] == "private"
    assert "刚闭环" in _shelf_names(c, env["alice"], "mine")
    assert "刚闭环" not in _shelf_names(c, env["alice"], "market")


# ────────────────────── 推演：匿名只能查看 ──────────────────────


def test_anonymous_cannot_drive(env):
    """用户裁决（2026-08-02）：**匿名只能查看**。

    拦在后端而不是只靠前端藏按钮——那套 RBAC 后台的字段权限就是只藏了前端、
    后端照样返回全部字段。前端藏起来的按钮不等于后端拦得住。
    """
    c = env["client"]
    for path in ("/drive-turn", "/drive-full", "/drive-full-stream"):
        r = c.post(
            f"{API}{path}",
            json={
                "state": {"sessionId": "s-1", "goal": {"text": "试试", "status": "needs_refinement"}},
                "userText": "试试",
                "turnId": "t-1",
                "max_loops": 1,
            },
            headers=_hdr(),
        )
        assert r.status_code == 401, f"{path} 放行了匿名推演（{r.status_code}）"


def test_logged_in_user_can_reach_the_drive_endpoint(env):
    """登录之后不该被身份这一关挡住。

    只断言"不是 401"——推演本身要 LLM，这里不跑真链路。
    """
    c = env["client"]
    # 合法的最小 state：缺字段会在身份关卡**之后**触发校验异常，
    # 那样这条断言就变成了"没被 401 挡住"以外的东西（实测踩过）。
    state = {"sessionId": "s-2", "goal": {"text": "试试", "status": "needs_refinement"}}
    r = c.post(f"{API}/drive-full", json={"state": state, "userText": "试试", "max_loops": 1},
               headers=_hdr(env["alice"]))
    assert r.status_code != 401, "登录用户被身份关卡挡住了"


def test_account_me_reports_anonymous_as_200_not_401(env):
    """前端启动时用它判断登录态——匿名是正常状态，不是错误。"""
    c = env["client"]
    r = c.get(f"{API}/account/me", headers=_hdr())
    assert r.status_code == 200
    assert r.json()["user"] is None

    r2 = c.get(f"{API}/account/me", headers=_hdr(env["alice"]))
    assert r2.json()["user"]["email"] == "alice@example.com"


def test_capabilities_reflect_login_state(env):
    c = env["client"]
    anon = c.get(f"{API}/account/capabilities", headers=_hdr()).json()
    assert anon["can"]["browse"] is True and anon["can"]["drive"] is False

    user = c.get(f"{API}/account/capabilities", headers=_hdr(env["alice"])).json()
    assert user["can"]["drive"] is True and user["can"]["fork"] is True


def test_login_via_http_sets_an_httponly_cookie(env):
    """浏览器靠 httpOnly Cookie 保持登录——localStorage 存 JWT 一次 XSS 就永久盗号。"""
    c = env["client"]
    r = c.post(f"{API}/account/login",
               json={"email": "alice@example.com", "password": "correct-horse-battery"},
               headers=_hdr())
    assert r.status_code == 200
    raw = r.headers.get("set-cookie") or ""
    assert "sliderule_token=" in raw
    assert "HttpOnly" in raw, "登录 Cookie 不是 httpOnly"


def test_wrong_password_is_401_with_a_generic_message(env):
    c = env["client"]
    r = c.post(f"{API}/account/login",
               json={"email": "alice@example.com", "password": "nope-nope-nope"},
               headers=_hdr())
    assert r.status_code == 401
    # 与"邮箱不存在"同一句话，不泄露账号是否存在
    r2 = c.post(f"{API}/account/login",
                json={"email": "ghost@example.com", "password": "nope-nope-nope"},
                headers=_hdr())
    assert r2.json().get("message") == r.json().get("message")


def test_anonymous_checks_must_not_reuse_a_logged_in_client(env):
    """TestClient 会保留 Cookie —— 复用会让"匿名"请求带上之前登录的凭据。

    写端到端验证脚本时踩过：注册那步把登录 Cookie 种进了同一个 client，
    之后那条"匿名推演应当 401"的检查实际是以登录身份发的，**真的把 LLM 跑起来了**，
    而我差点据此以为守卫失效。

    这条测试把行为钉住：新开的 client 必须是匿名的。
    """
    from fastapi.testclient import TestClient

    from app import app as fastapi_app

    c = env["client"]
    r = c.post(
        f"{API}/account/login",
        json={"email": "alice@example.com", "password": "correct-horse-battery"},
        headers=_hdr(),
    )
    assert r.status_code == 200
    # 同一个 client 现在带着 Cookie，是登录态
    assert c.get(f"{API}/account/me", headers=_hdr()).json()["user"] is not None
    # 新开的必须是匿名
    fresh = TestClient(fastapi_app)
    assert fresh.get(f"{API}/account/me", headers=_hdr()).json()["user"] is None


def test_cookie_alone_authenticates_without_a_bearer_header(env):
    """浏览器只有 Cookie、没有 Authorization——这条路必须走得通。

    Node 代理透传 cookie 就是为了它（server/routes/sliderule.ts）。
    """
    c = env["client"]
    c.post(
        f"{API}/account/login",
        json={"email": "alice@example.com", "password": "correct-horse-battery"},
        headers=_hdr(),
    )
    # 只带内部 key，不带 Authorization——身份完全靠 Cookie
    me = c.get(f"{API}/account/me", headers=_hdr()).json()
    assert me["user"]["email"] == "alice@example.com"
    caps = c.get(f"{API}/account/capabilities", headers=_hdr()).json()
    assert caps["can"]["drive"] is True


def _drive_probe_body():
    """故意不合法的 state：身份关过后会 400，不会真跑 LLM。

    sessionId 必须是 str。用错类型卡在校验，断言只盯"不是 401"。
    """
    return {
        "state": {"sessionId": 1},
        "userText": "试试",
        "turnId": "t-1",
        "max_loops": 1,
    }


def test_cookie_alone_reaches_drive_full_stream(env):
    """浏览器推演只有 Cookie。这条必须不是 401。

    ⚠ 2026-08-20 真机：左下角 Admin 已登录，PUT /sessions 200，紧接着
    POST /drive-full-stream 401「请先登录后再推演」。GET /account/me 的 Cookie
    通路有测试，drive 这条没有——Bearer 测过「登录可过身份关」，Cookie 没测过
    推演入口。闸全绿但东西没了。
    """
    c = env["client"]
    c.post(
        f"{API}/account/login",
        json={"email": "alice@example.com", "password": "correct-horse-battery"},
        headers=_hdr(),
    )
    r = c.post(f"{API}/drive-full-stream", json=_drive_probe_body(), headers=_hdr())
    assert r.status_code != 401, f"Cookie 登录用户被推演身份关挡住了（{r.status_code} {r.text[:200]}）"


def test_junk_bearer_does_not_mask_a_valid_cookie_on_drive(env):
    """坏 Authorization 不许把有效 Cookie 盖成匿名。

    `_extract_token` 原来 Bearer 非空就忽略 Cookie。代理/扩展塞一个解不开的
    Bearer 时，已登录用户的推演会 401，而前后的 GET/PUT 没有这个头所以仍是 200。
    """
    c = env["client"]
    c.post(
        f"{API}/account/login",
        json={"email": "alice@example.com", "password": "correct-horse-battery"},
        headers=_hdr(),
    )
    headers = {**_hdr(), "Authorization": "Bearer definitely-not-a-jwt"}
    r = c.post(f"{API}/drive-full-stream", json=_drive_probe_body(), headers=headers)
    assert r.status_code != 401, f"坏 Bearer 把 Cookie 登录态盖掉了（{r.status_code} {r.text[:200]}）"
    # 反向：没有 Cookie 的坏 Bearer 仍然是匿名
    from fastapi.testclient import TestClient
    from app import app as fastapi_app

    fresh = TestClient(fastapi_app)
    denied = fresh.post(
        f"{API}/drive-full-stream", json=_drive_probe_body(), headers=headers
    )
    assert denied.status_code == 401, "没 Cookie 的坏 Bearer 不该放行"


def test_delete_session_unbinds_app_keeps_card(env):
    """对照 GitHub 删 Codespace：卡留下，session_id 必须空。"""
    store, c = env["store"], env["client"]
    aid = store.save_app(
        {"appbundle": {"appIdentity": {"productName": "工单"}}},
        goal="工单", session_id="sr-ghost", gate_passed=True,
        owner_id=env["alice"]["user"]["id"],
    )
    r = c.delete(f"{API}/sessions/sr-ghost", headers=_hdr(env["alice"]))
    assert r.status_code == 200, r.text
    rec = store.get_app(aid)
    assert rec is not None
    assert rec["session_id"] is None


def test_delete_app_drops_bound_session(env):
    """对照 GitHub 删仓库：挂着的工作区一并没。"""
    from services.slide_rule_session import load_session, save_session
    from models.v5_state import V5SessionState
    from uuid import uuid4

    store, c = env["store"], env["client"]
    sid = f"sr-cascade-{uuid4().hex}"
    save_session(V5SessionState(
        sessionId=sid, ownerId=env["alice"]["user"]["id"], goal={"text": "工单"},
    ))
    aid = store.save_app(
        {"appbundle": {"appIdentity": {"productName": "工单"}}},
        goal="工单", session_id=sid, gate_passed=True,
        owner_id=env["alice"]["user"]["id"],
    )
    v2 = store.save_version(
        root_id=aid, parent_id=aid,
        model={"appbundle": {"appIdentity": {"productName": "工单"}}},
        goal="工单", session_id=sid, gate_passed=True,
    )
    r = c.delete(f"{API}/apps/{v2}", headers=_hdr(env["alice"]))
    assert r.status_code == 200, r.text
    assert r.json().get("sessionDeleted") is True
    assert store.get_app(v2) is None
    assert store.get_app(aid) is None, "同血缘旧版必须一起下架，否则刷新冒出 v1"
    assert load_session(sid) is None


def test_reopen_binds_same_app_not_a_fork(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private", name="快照卡")
    r = c.post(f"{API}/apps/{aid}/reopen", headers=_hdr(env["alice"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == aid, "reopen 不许新开一张卡"
    assert body["sessionId"]
    assert body.get("reused") is False
    assert store.get_app(aid)["session_id"] == body["sessionId"]
    again = c.post(f"{API}/apps/{aid}/reopen", headers=_hdr(env["alice"]))
    assert again.status_code == 200, again.text
    assert again.json()["reused"] is True
    assert again.json()["sessionId"] == body["sessionId"]
    assert again.json()["id"] == aid


def test_cannot_reopen_what_you_cannot_write(env):
    store, c = env["store"], env["client"]
    aid = _seed(store, owner_id=env["alice"]["user"]["id"], visibility="private")
    assert c.post(f"{API}/apps/{aid}/reopen", headers=_hdr(env["bob"])).status_code == 404


def test_delete_sess_and_fork_call_working_session_helpers():
    """活路上必须点名调用。写在注释里不算。"""
    import ast
    import inspect

    from routes.sliderule_full import delete_sess, fork_generated_app, reopen_generated_app

    def names(fn):
        tree = ast.parse(inspect.getsource(fn))
        out = []
        for n in ast.walk(tree):
            if not isinstance(n, ast.Call):
                continue
            if isinstance(n.func, ast.Name):
                out.append(n.func.id)
            elif isinstance(n.func, ast.Attribute):
                out.append(n.func.attr)
        return out

    assert "unbind_session" in names(delete_sess)
    assert "init_working_session_from_app" in names(fork_generated_app)
    assert "init_working_session_from_app" in names(reopen_generated_app)
    assert "bind_session" in names(reopen_generated_app)
