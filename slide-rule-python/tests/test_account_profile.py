"""本人改昵称 / 头像（2026-08-20）。

对照 TRAE 账号设置：登录者改自己的资料。匿名 401；超管也只能改自己这条，
没有在这里开「替别人改」的口子。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("pwdlib", reason="没装 pwdlib 时身份体系不可用")
pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")

API = "/api/sliderule"

# 1×1 PNG。判据要咬「写进去了再读得回来」，不是「接口 200」。
_TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture
def env(tmp_path, monkeypatch, real_auth):
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

    started = auth_service.start_registration("alice@example.com", "correct-horse-battery")
    alice = auth_service.complete_registration(
        "alice@example.com", "correct-horse-battery", started["devCode"]
    )

    from app import app as fastapi_app

    yield {
        "client": TestClient(fastapi_app),
        "alice": alice,
    }
    identity_store.reset_identity_cache()
    app_store.reset_backend_cache()
    session_blob_store.reset_cache()


def _hdr(who=None):
    h = {"x-internal-key": "dev-slide-rule-internal"}
    if who:
        h["Authorization"] = f"Bearer {who['token']}"
    return h


def test_anonymous_cannot_patch_profile(env):
    got = env["client"].patch(f"{API}/account/me", json={"displayName": "谁"}, headers=_hdr())
    assert got.status_code == 401


def test_patch_display_name_roundtrips_on_me(env):
    """正：写进库。反：只 200 但 GET /me 仍是空昵称，不算改成功。"""
    c, alice = env["client"], env["alice"]
    before = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]
    assert not before.get("displayName")

    patched = c.patch(
        f"{API}/account/me",
        json={"displayName": "  面团同学  "},
        headers=_hdr(alice),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["user"]["displayName"] == "面团同学"

    me = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]
    assert me["displayName"] == "面团同学"
    assert me["email"] == "alice@example.com"


def test_patch_rejects_too_long_name(env):
    got = env["client"].patch(
        f"{API}/account/me",
        json={"displayName": "字" * 41},
        headers=_hdr(env["alice"]),
    )
    assert got.status_code == 400
    after = env["client"].get(f"{API}/account/me", headers=_hdr(env["alice"])).json()["user"]
    assert not after.get("displayName")


def test_patch_avatar_roundtrips_and_rejects_huge(env):
    """写进去要读得回来——但读回来的是**地址**，不是图本体（2026-08-23 起）。

    "写了再读得回来"这条判据没变，只是落点从"载荷里那串 base64"挪到了
    "按地址取到的字节"。见 test_avatar_never_rides_along_in_me。
    """
    c, alice = env["client"], env["alice"]
    ok = c.patch(f"{API}/account/me", json={"avatarUrl": _TINY_PNG}, headers=_hdr(alice))
    assert ok.status_code == 200, ok.text
    me = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]
    alice_id = alice["user"]["id"]
    assert me["avatarUrl"].startswith(f"{API}/account/avatar/{alice_id}?v=")
    got = c.get(me["avatarUrl"], headers=_hdr(alice))
    assert got.status_code == 200
    import base64 as _b64

    assert got.content == _b64.b64decode(_TINY_PNG.split(",", 1)[1])

    huge = "data:image/png;base64," + ("A" * (3 * 1024 * 1024))
    bad = c.patch(f"{API}/account/me", json={"avatarUrl": huge}, headers=_hdr(alice))
    assert bad.status_code == 400
    still = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]
    assert still["avatarUrl"] == me["avatarUrl"], "被拒的那次不该动已有头像"

    cleared = c.patch(f"{API}/account/me", json={"avatarUrl": ""}, headers=_hdr(alice))
    assert cleared.status_code == 200
    after = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]
    assert after["avatarUrl"] is None, "没头像要给 None，不能给一个会 404 的地址"
    assert c.get(f"{API}/account/avatar/{alice_id}", headers=_hdr(alice)).status_code == 404


def test_avatar_never_rides_along_in_me(env):
    """**图不进 /account/me 的载荷。**

    这是本次改动的全部理由，不是风格问题：改之前实测 `GET /account/me` 一次
    169 KB，其中 168,972 字节是内联的 avatarUrl，其余字段加起来约 130 字节；
    而 /me 每次进页面都打、还不可强缓存。管理台用户列表更糟，一次列 N 个用户
    就是 N 张整图。

    形状与判据都对齐应用商店那条已经写死的纪律：
    tests/test_app_preview.py::test_preview_never_rides_along_in_listings。
    """
    c, alice = env["client"], env["alice"]
    c.patch(f"{API}/account/me", json={"avatarUrl": _TINY_PNG}, headers=_hdr(alice))
    body = c.get(f"{API}/account/me", headers=_hdr(alice)).text
    assert "base64," not in body, "图不该以任何形式出现在 /me 载荷里"
    assert _TINY_PNG.split(",", 1)[1] not in body
    # 正向：地址在，取得到；反向：载荷本身要小
    assert len(body) < 2000, f"/me 载荷 {len(body)} 字节，图大概率又漏进去了"


def test_avatar_url_changes_when_the_image_changes(env):
    """换了图，版本位必须跟着变——immutable 的正确性全靠这个。

    URL 不变的话浏览器一年内都停在旧头像上，而这**不是缓存优化问题，是用户
    看到的图是错的**（同一条理由见 sheet-thumb 那条 appPreviewUrl 判据）。
    """
    c, alice = env["client"], env["alice"]
    c.patch(f"{API}/account/me", json={"avatarUrl": _TINY_PNG}, headers=_hdr(alice))
    first = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]["avatarUrl"]

    other = (
        "data:image/gif;base64,"
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
    )
    c.patch(f"{API}/account/me", json={"avatarUrl": other}, headers=_hdr(alice))
    second = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]["avatarUrl"]
    assert second != first, "换了头像 URL 必须变，否则强缓存把旧图钉死"

    got = c.get(second, headers=_hdr(alice))
    assert got.status_code == 200
    # 按内容报类型，不写死 png——报错类型浏览器可能拒绝渲染
    assert got.headers["content-type"].startswith("image/gif")


def test_avatar_is_cached_hard_but_not_shared(env):
    """强缓存 + **private**。

    private 不是可有可无：这张图按 viewer 授权（本人或超管），进了共享缓存
    就等于"超管取到的图被 CDN 发给别人"。
    """
    c, alice = env["client"], env["alice"]
    c.patch(f"{API}/account/me", json={"avatarUrl": _TINY_PNG}, headers=_hdr(alice))
    url = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]["avatarUrl"]
    cc = c.get(url, headers=_hdr(alice)).headers["cache-control"]
    assert "immutable" in cc and "max-age=31536000" in cc
    assert "private" in cc and "public" not in cc


def _register(email: str) -> dict:
    from services import auth_service

    started = auth_service.start_registration(email, "correct-horse-battery")
    return auth_service.complete_registration(email, "correct-horse-battery", started["devCode"])


def test_avatar_is_not_readable_by_other_users(env):
    """别人的头像取不到，**报 404 不报 403**。

    403 等于确认"这个 id 确实存在"，可以拿来枚举——跟 app_access.require 同一
    条纪律。而 user_id 会随 owner_id 出现在公开应用的摘要里，所以"任何登录用户
    都能看"是不行的：拿一个公开应用就能翻出它主人的头像。
    """
    c, alice = env["client"], env["alice"]
    c.patch(f"{API}/account/me", json={"avatarUrl": _TINY_PNG}, headers=_hdr(alice))
    url = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]["avatarUrl"]

    bob = _register("bob@example.com")
    assert c.get(url, headers=_hdr(bob)).status_code == 404
    assert c.get(url, headers=_hdr()).status_code == 404, "匿名同样 404"
    assert c.get(url, headers=_hdr(alice)).status_code == 200, "本人仍然取得到"


def test_superuser_can_read_avatars_for_the_admin_list(env):
    """超管取得到——管理台用户列表要显示它。

    这条是正向配对：光有上面那条"别人取不到"，把门槛收成"只有本人"也全绿，
    而那样管理台的用户列表就全变成空头像了。
    """
    from services.identity_store import get_identity_store

    c, alice = env["client"], env["alice"]
    c.patch(f"{API}/account/me", json={"avatarUrl": _TINY_PNG}, headers=_hdr(alice))
    url = c.get(f"{API}/account/me", headers=_hdr(alice)).json()["user"]["avatarUrl"]

    root = _register("root@example.com")
    get_identity_store().set_superuser(root["user"]["id"], True)
    assert c.get(url, headers=_hdr(root)).status_code == 200
