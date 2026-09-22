"""管理台的用户列表接口（2026-08-03）。

旧账号体系整套下掉后，Node 的 `/api/admin/users` 不再读 MySQL 的 `users` 表，
改成把浏览器凭据转发到这里。所以**这一层必须自己判超管**——不能假设
"能调到我的就是管理员"。Node 那边的 requireAdmin 只是第一道门，它挡不住
任何绕过 Node 直接打 Python 的请求。

走真实 HTTP 而不是直接调函数：判定漏挂在路由上是这类问题最常见的形状
（见 test_app_routes_access 开头的说明）。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("pwdlib", reason="没装 pwdlib 时身份体系不可用")
pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")

API = "/api/sliderule"


@pytest.fixture
def env(tmp_path, monkeypatch, real_auth):
    """干净的本地身份库 + 一个超管两个普通用户。

    `real_auth` 摘掉 conftest 的"默认已登录"覆盖——这份测试要验匿名分支。
    """
    from config.settings import settings

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setattr(
        settings, "APP_STORE_LOCAL_SQLITE", f"sqlite:///{tmp_path / 'apps.db'}", raising=False
    )
    monkeypatch.setenv("SLIDERULE_IDENTITY_SQLITE", f"sqlite:///{tmp_path / 'id.db'}")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "u" * 48)
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)

    from services import app_store, auth_service, identity_store, session_blob_store

    identity_store.reset_identity_cache()
    app_store.reset_backend_cache()
    session_blob_store.reset_cache()

    def mk(email):
        started = auth_service.start_registration(email, "correct-horse-battery")
        return auth_service.complete_registration(
            email, "correct-horse-battery", started["devCode"]
        )

    root = mk("root@example.com")  # 第一个注册的 = 超管
    alice = mk("alice@example.com")
    bob = mk("bob@example.com")

    from app import app as fastapi_app

    yield {
        "client": TestClient(fastapi_app),
        "root": root,
        "alice": alice,
        "bob": bob,
    }
    identity_store.reset_identity_cache()
    app_store.reset_backend_cache()
    session_blob_store.reset_cache()


def _hdr(who=None):
    h = {"x-internal-key": "dev-slide-rule-internal"}
    if who:
        h["Authorization"] = f"Bearer {who['token']}"
    return h


def test_anonymous_cannot_list_users(env):
    got = env["client"].get(f"{API}/account/admin/users", headers=_hdr())
    assert got.status_code == 401


def test_regular_user_cannot_list_users(env):
    got = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["alice"]))
    assert got.status_code == 403, "普通用户拿到了全站用户名单"


def test_superuser_sees_every_user(env):
    got = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["root"]))
    assert got.status_code == 200
    emails = {u["email"] for u in got.json()["items"]}
    assert emails == {"root@example.com", "alice@example.com", "bob@example.com"}


def test_listing_never_carries_password_hashes(env):
    got = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["root"]))
    # 整个响应体里不能出现哈希：`User.public()` 是白名单式的，
    # 这条断言防的是以后有人图省事改成直接透传整行。
    assert "password" not in got.text.lower()
    assert "$argon2" not in got.text


def test_single_user_lookup_follows_the_same_guard(env):
    client, alice_id = env["client"], env["alice"]["user"]["id"]
    path = f"{API}/account/admin/users/{alice_id}"

    assert client.get(path, headers=_hdr()).status_code == 401
    assert client.get(path, headers=_hdr(env["bob"])).status_code == 403

    ok = client.get(path, headers=_hdr(env["root"]))
    assert ok.status_code == 200
    assert ok.json()["user"]["email"] == "alice@example.com"


def test_missing_user_is_404_for_superuser(env):
    got = env["client"].get(
        f"{API}/account/admin/users/nobody-here", headers=_hdr(env["root"])
    )
    assert got.status_code == 404


def test_listing_carries_active_flag_and_usage(env):
    """名单必须带停用位。话题数按侧栏同一条摘要挂——没有会话就是 0，不是缺字段。"""
    from models.v5_state import V5SessionState
    from services.persistence import save_session_record

    alice_id = env["alice"]["user"]["id"]
    st = V5SessionState(
        sessionId="admin-usage-1",
        artifacts=[],
        goal={"text": "古籍数字化", "status": "clear"},
    )
    st.ownerId = alice_id
    save_session_record(st)

    got = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["root"]))
    assert got.status_code == 200
    by_email = {u["email"]: u for u in got.json()["items"]}
    alice = by_email["alice@example.com"]
    assert alice["isActive"] is True
    assert "lastLoginAt" in alice
    assert alice["sessions"] >= 1
    assert alice.get("lastActiveAt")
    bob = by_email["bob@example.com"]
    assert bob["sessions"] == 0
    assert "password" not in got.text.lower()


def test_user_session_count_still_works_when_load_all_is_empty(env, monkeypatch):
    """生产上 load_all 超时会空账。改回 load_all 这条必须红。"""
    from models.v5_state import V5SessionState
    from services.persistence import save_session_record

    alice_id = env["alice"]["user"]["id"]
    st = V5SessionState(
        sessionId="admin-usage-2",
        artifacts=[],
        goal={"text": "侧栏有这条", "status": "clear"},
    )
    st.ownerId = alice_id
    save_session_record(st)
    monkeypatch.setattr("services.persistence.load_all", lambda *a, **k: {})

    got = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["root"]))
    alice = next(u for u in got.json()["items"] if u["email"] == "alice@example.com")
    assert alice["sessions"] >= 1


def test_registration_stamps_last_login(env):
    """注册完即登录态，必须戳 last_login_at，否则管理台把在线超管写成从未登录。"""
    root = env["root"]["user"]
    assert root.get("lastLoginAt"), "注册响应就要带 lastLoginAt"
    got = env["client"].get(
        f"{API}/account/admin/users/{root['id']}", headers=_hdr(env["root"])
    )
    assert got.status_code == 200
    assert got.json()["user"]["lastLoginAt"]


def test_search_q_filters_email(env):
    got = env["client"].get(
        f"{API}/account/admin/users",
        headers=_hdr(env["root"]),
        params={"q": "alice"},
    )
    emails = {u["email"] for u in got.json()["items"]}
    assert emails == {"alice@example.com"}


def test_superuser_can_deactivate_regular_user(env):
    """Gitea ProhibitLogin：停用不删行，登录明说已被停用。"""
    alice_id = env["alice"]["user"]["id"]
    path = f"{API}/account/admin/users/{alice_id}"
    got = env["client"].patch(
        path, headers=_hdr(env["root"]), json={"isActive": False}
    )
    assert got.status_code == 200
    assert got.json()["user"]["isActive"] is False

    listed = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["root"]))
    alice = next(u for u in listed.json()["items"] if u["id"] == alice_id)
    assert alice["isActive"] is False

    from services import auth_service

    login = auth_service.login("alice@example.com", "correct-horse-battery")
    assert login["ok"] is False
    assert login["error"] == "inactive"

    resume = env["client"].patch(
        path, headers=_hdr(env["root"]), json={"isActive": True}
    )
    assert resume.json()["user"]["isActive"] is True


def test_cannot_deactivate_other_superuser(env):
    """To-C 只有一档员工位，互停没有产品语义。"""
    from services.identity_store import get_identity_store

    bob_id = env["bob"]["user"]["id"]
    get_identity_store().set_superuser(bob_id, True)
    got = env["client"].patch(
        f"{API}/account/admin/users/{bob_id}",
        headers=_hdr(env["root"]),
        json={"isActive": False},
    )
    assert got.status_code == 400
    assert "超管" in got.text
    assert "不存在" not in got.text
    still = env["client"].get(
        f"{API}/account/admin/users/{bob_id}", headers=_hdr(env["root"])
    )
    assert still.json()["user"]["isActive"] is True
    assert still.json()["user"]["isSuperuser"] is True


def test_cannot_deactivate_self(env):
    root_id = env["root"]["user"]["id"]
    got = env["client"].patch(
        f"{API}/account/admin/users/{root_id}",
        headers=_hdr(env["root"]),
        json={"isActive": False},
    )
    assert got.status_code == 400
    still = env["client"].get(
        f"{API}/account/admin/users/{root_id}", headers=_hdr(env["root"])
    )
    assert still.json()["user"]["isActive"] is True


def test_regular_user_cannot_deactivate(env):
    bob_id = env["bob"]["user"]["id"]
    got = env["client"].patch(
        f"{API}/account/admin/users/{bob_id}",
        headers=_hdr(env["alice"]),
        json={"isActive": False},
    )
    assert got.status_code == 403


def _tiny_app_model(name: str) -> dict:
    return {
        "datamodel": {"entities": [{"id": "e0", "name": "E0", "fields": []}]},
        "page": {"pages": [{"id": "p0", "kind": "monitor"}]},
        "appbundle": {
            "landingPageRef": "p0",
            "preferredDevice": "desktop",
            "appIdentity": {
                "productName": name,
                "theme": "forest",
                "generatedTheme": {"label": "forest"},
            },
        },
    }


def test_superuser_lists_apps_with_owner(env):
    """项目页必须打身份前缀下的应用清单。改回 /api/admin/projects 这条要红。"""
    from services import app_store

    alice_id = env["alice"]["user"]["id"]
    app_store.save_app(
        _tiny_app_model("古籍数字化"),
        goal="把县志做成检索",
        session_id="sess-staff-1",
        owner_id=alice_id,
        visibility="private",
    )

    forbidden = env["client"].get(f"{API}/account/admin/apps", headers=_hdr(env["alice"]))
    assert forbidden.status_code == 403

    got = env["client"].get(f"{API}/account/admin/apps", headers=_hdr(env["root"]))
    assert got.status_code == 200
    names = {row["productName"] for row in got.json()["items"]}
    assert "古籍数字化" in names
    row = next(r for r in got.json()["items"] if r["productName"] == "古籍数字化")
    assert row["ownerId"] == alice_id
    assert row["visibility"] == "private"
    assert "model_json" not in row


def test_superuser_lists_sessions_with_owner(env):
    """运行页要带主人。侧栏 GET /sessions 会剥 ownerId，这条不能跟它走。"""
    from models.v5_state import V5SessionState
    from services.persistence import save_session_record

    alice_id = env["alice"]["user"]["id"]
    st = V5SessionState(
        sessionId="staff-run-1",
        artifacts=[],
        goal={"text": "古籍数字化", "status": "clear"},
        runtimePhase="failed",
    )
    st.ownerId = alice_id
    save_session_record(st)

    forbidden = env["client"].get(
        f"{API}/account/admin/sessions", headers=_hdr(env["alice"])
    )
    assert forbidden.status_code == 403

    got = env["client"].get(f"{API}/account/admin/sessions", headers=_hdr(env["root"]))
    assert got.status_code == 200
    by_id = {row["id"]: row for row in got.json()["items"]}
    assert "staff-run-1" in by_id
    assert by_id["staff-run-1"]["ownerId"] == alice_id
    assert by_id["staff-run-1"]["phase"] == "failed"
    assert by_id["staff-run-1"]["goal"] == "古籍数字化"


def test_usage_by_owner_reads_sidebar_summaries_not_load_all():
    """剥注释再匹配：docstring 里会写 load_all 事故，不能让那句话把判据打空。"""
    import inspect
    import re

    from services.cost_ledger import usage_by_owner

    src = inspect.getsource(usage_by_owner)
    stripped = re.sub(r'""".*?"""', "", src, flags=re.S)
    stripped = re.sub(r"#.*", "", stripped)
    assert "list_session_summaries" in stripped
    assert "session_has_goal" in stripped
    assert "load_all" not in stripped


def test_user_session_count_matches_admin_session_list(env):
    """用户表话题数和运行页必须是同一批会话，按 ownerId 对上。"""
    from models.v5_state import V5SessionState
    from services.persistence import save_session_record

    alice_id = env["alice"]["user"]["id"]
    for i in range(2):
        st = V5SessionState(
            sessionId=f"staff-join-{i}",
            artifacts=[],
            goal={"text": f"话题{i}", "status": "clear"},
        )
        st.ownerId = alice_id
        save_session_record(st)

    users = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["root"]))
    sessions = env["client"].get(
        f"{API}/account/admin/sessions", headers=_hdr(env["root"])
    )
    alice = next(u for u in users.json()["items"] if u["id"] == alice_id)
    owned = [row for row in sessions.json()["items"] if row["ownerId"] == alice_id]
    assert alice["sessions"] == len(owned)
    assert len(owned) >= 2


def test_empty_new_session_shell_is_not_a_topic(env):
    """点「新会话」落下的空壳侧栏不展示，用户表话题不得把它算进去。

    正：两条有标题的计 2。反：空壳也 +1，人看见俩统计却是仨。
    """
    from models.v5_state import V5SessionState
    from services.persistence import save_session_record

    alice_id = env["alice"]["user"]["id"]
    for i, text in enumerate(("古籍数字化", "宠物店预约")):
        st = V5SessionState(
            sessionId=f"staff-named-{i}",
            artifacts=[],
            goal={"text": text, "status": "clear"},
        )
        st.ownerId = alice_id
        save_session_record(st)
    shell = V5SessionState(
        sessionId="staff-empty-shell",
        artifacts=[],
        goal={"text": "", "status": "needs_refinement"},
        runtimePhase="idle",
    )
    shell.ownerId = alice_id
    save_session_record(shell)

    users = env["client"].get(f"{API}/account/admin/users", headers=_hdr(env["root"]))
    sessions = env["client"].get(
        f"{API}/account/admin/sessions", headers=_hdr(env["root"])
    )
    alice = next(u for u in users.json()["items"] if u["id"] == alice_id)
    owned = [row for row in sessions.json()["items"] if row["ownerId"] == alice_id]
    ids = {row["id"] for row in owned}
    assert "staff-empty-shell" not in ids
    assert alice["sessions"] == 2
    assert len(owned) == 2


def test_me_stamps_empty_last_login(env):
    """cookie 会话从不走 login() 时 last_login_at 会空。GET /me 必须补一刀。

    正：空着再读 /me，管理台能看见时间。反：只 200 但 lastLoginAt 仍空，不算修好。
    """
    from services import identity_store

    uid = env["root"]["user"]["id"]
    store = identity_store.get_identity_store()
    p = store._x.ph
    store._x.execute(
        f"update {identity_store.TABLE} set last_login_at = {p(1)} where id = {p(2)}",
        [None, uid],
    )
    assert not store.get_by_id(uid).public().get("lastLoginAt")

    me = env["client"].get(f"{API}/account/me", headers=_hdr(env["root"]))
    assert me.status_code == 200
    assert me.json()["user"]["lastLoginAt"], "GET /me 没把空的 last_login_at 补上"

    got = env["client"].get(
        f"{API}/account/admin/users/{uid}", headers=_hdr(env["root"])
    )
    assert got.json()["user"]["lastLoginAt"]
