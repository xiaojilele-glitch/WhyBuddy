"""会话撤销与自动续期（2026-08-04）。

## 补的是什么洞

找回密码上线之后，"密码被人拿到了赶紧改"这个**唯一的使用场景**恰恰是纯 JWT 防
不住的：改完密码，对方手里那张没过期的令牌照样能用最长七天。登出同理——原来只是
"这个浏览器把凭据忘了"，令牌本身还活着。

## 两个机制，各管一半，抄自两个成熟实现

**① `pv` 密码戳 → 改密码踢掉全部旧会话（零存储）**

抄 Django `contrib/auth/base_user.py` 的 `_get_session_auth_hash`：拿**密码哈希**
再做一次 HMAC 塞进会话，每次请求比对。密码一改哈希跟着变，所有旧会话自动对不上，
不需要遍历、不需要撤销表。

**② `jti` + 撤销表 → 登出即失效**

抄 fastapi-users `strategy/db/strategy.py` 的 `DatabaseStrategy.destroy_token`。
顺带一提，同一个库的 `JWTStrategy.destroy_token` 直接抛
`JWTStrategyDestroyNotSupportedError`——它拒绝假装 JWT 能撤销，这个诚实值得抄。

两个都要：`pv` 管不了"只登出这一台设备"（密码没变），`jti` 管不了"把这个人所有
设备都踢掉"（要遍历他签发过的所有令牌，而我们并不记录）。

## 这里守的边界

按"漏了会怎样"排序：漏 ① = 改了密码等于没改；漏 ② = 登出等于没登出；
漏「存量令牌拒收」= 这次改动对已经签出去的令牌全部无效。
"""

from __future__ import annotations

import pytest

pytest.importorskip("pwdlib", reason="没装 pwdlib 时身份体系不可用")
pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")

API = "/api/sliderule"
PASSWORD = "correct-horse-battery"
NEW_PASSWORD = "another-long-password"
EMAIL = "session@example.com"


@pytest.fixture
def env(tmp_path, monkeypatch, real_auth):
    """干净的本地身份库 + 一个已登录用户。

    `real_auth` 摘掉 conftest 的"默认已登录"覆盖——这份测试要验真实的令牌判定。
    `APP_STORE_DATABASE_URL` 必须清空，否则会连真的 Neon（写进生产身份表）。
    """
    from config.settings import settings

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setenv("SLIDERULE_IDENTITY_SQLITE", f"sqlite:///{tmp_path / 'id.db'}")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "s" * 48)
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)

    from fastapi.testclient import TestClient

    from services import auth_service, identity_store

    identity_store.reset_identity_cache()
    started = auth_service.start_registration(EMAIL, PASSWORD)
    created = auth_service.complete_registration(EMAIL, PASSWORD, started["devCode"])

    from app import app as fastapi_app

    yield {
        "client": TestClient(fastapi_app),
        "token": created["token"],
        "store": identity_store.get_identity_store(),
    }
    identity_store.reset_identity_cache()


def _me(client, token):
    """带令牌问一句"我是谁"。返回 user 或 None。"""
    got = client.get(f"{API}/account/me", headers={"Authorization": f"Bearer {token}"})
    assert got.status_code == 200, got.text  # 匿名也返回 200 + user=null，这是刻意的
    return got.json().get("user")


# ── ① 改密码踢掉全部旧会话 ────────────────────────────────────────


def test_a_fresh_token_works(env):
    """先立个基准，免得下面的"失效"断言其实是别的原因造成的。"""
    assert _me(env["client"], env["token"])["email"] == EMAIL


def test_password_reset_kills_every_old_session(env):
    """**这是这次改动的核心场景**：号被盗 → 改密码 → 对方手里的令牌当场作废。"""
    from services import auth_service

    old_token = env["token"]
    assert _me(env["client"], old_token) is not None  # 改之前是好的

    started = auth_service.start_password_reset(EMAIL)
    done = auth_service.complete_password_reset(EMAIL, started["devCode"], NEW_PASSWORD)
    assert done["ok"] is True

    assert _me(env["client"], old_token) is None, "改了密码，旧令牌还能用 = 找回密码白做"
    # 新签发的那张当然要能用，否则用户改完密码就被锁在外面
    assert _me(env["client"], done["token"])["email"] == EMAIL


def test_two_devices_are_both_kicked(env):
    """"全部"是字面意思：多处登录要一起掉线，不是只掉最后一台。"""
    from services import auth_service

    a = env["token"]
    b = auth_service.login(EMAIL, PASSWORD)["token"]
    assert a != b
    assert _me(env["client"], a) and _me(env["client"], b)

    started = auth_service.start_password_reset(EMAIL)
    auth_service.complete_password_reset(EMAIL, started["devCode"], NEW_PASSWORD)

    assert _me(env["client"], a) is None
    assert _me(env["client"], b) is None


def test_login_issues_a_token_that_matches_its_own_stamp(env):
    """登录时密码哈希可能刚被升级（旧算法 → Argon2）。

    戳要按**升级后落库的**那份算——按升级前的算，签出去的令牌下一秒就自己对不上，
    表现是"刚登录就掉线"，而且只在老账号上出现，极难查。
    """
    from services import auth_service

    fresh = auth_service.login(EMAIL, PASSWORD)["token"]
    assert _me(env["client"], fresh)["email"] == EMAIL


# ── ② 登出即失效 ─────────────────────────────────────────────────


def test_logout_actually_invalidates_the_token(env):
    client, token = env["client"], env["token"]
    hdr = {"Authorization": f"Bearer {token}"}

    assert client.post(f"{API}/account/logout", headers=hdr).status_code == 200
    assert _me(client, token) is None, "登出后令牌还能用 = 登出只是把 Cookie 删了"


def test_logout_only_kills_that_one_token(env):
    """在公用电脑上登出，不该把自己手机上的会话也断掉。

    "全端下线"是改密码的语义（见 ①），两者不能混。
    """
    from services import auth_service

    phone = auth_service.login(EMAIL, PASSWORD)["token"]
    client = env["client"]

    client.post(
        f"{API}/account/logout", headers={"Authorization": f"Bearer {env['token']}"}
    )
    assert _me(client, env["token"]) is None
    assert _me(client, phone) is not None, "登出一台把另一台也踢了"


def test_logging_out_twice_is_not_an_error(env):
    """多个标签页各点一次登出是常态，撤销要幂等。"""
    hdr = {"Authorization": f"Bearer {env['token']}"}
    assert env["client"].post(f"{API}/account/logout", headers=hdr).status_code == 200
    assert env["client"].post(f"{API}/account/logout", headers=hdr).status_code == 200


def test_logout_without_any_token_still_succeeds(env):
    """没带令牌也返回 200：本地已经是登出状态，报错只会让前端多一条无意义的分支。"""
    assert env["client"].post(f"{API}/account/logout").status_code == 200


# ── 存量令牌：这次改动必须对它们也生效 ────────────────────────────


def test_tokens_minted_before_this_change_are_rejected(env):
    """没有 `pv` 的令牌一律拒收。

    那正是 2026-08-04 之前签发的那一批——"改了密码也踢不掉"的就是它们。放行等于
    这次改动对存量全部无效。代价是上线时所有人被踢下线一次，**那正是想要的效果**。
    """
    from services.auth_tokens import create_access_token

    legacy = create_access_token("whoever")  # 不传 password_hash → 没有 pv
    assert _me(env["client"], legacy) is None


def test_a_forged_stamp_does_not_pass(env):
    """戳是 HMAC，不是明文哈希——猜不出来，也不能自己编一个。"""
    import jwt

    from services.auth_tokens import ALGORITHM, auth_secret

    payload = jwt.decode(env["token"], auth_secret(), algorithms=[ALGORITHM])
    payload["pv"] = "0" * 16
    forged = jwt.encode(payload, auth_secret(), algorithm=ALGORITHM)
    assert _me(env["client"], forged) is None


def test_stamp_is_not_the_password_hash_itself(env):
    """令牌里放的是 HMAC 指纹，不是 Argon2 哈希本身。

    哈希虽然不可逆，但发给客户端等于白送一份离线爆破的素材。
    """
    import jwt

    from services.auth_tokens import ALGORITHM, auth_secret

    payload = jwt.decode(env["token"], auth_secret(), algorithms=[ALGORITHM])
    user = env["store"].get_by_email(EMAIL)
    assert "$argon2" not in str(payload)
    assert str(user.get("password_hash")) not in str(payload)


# ── 撤销表本身 ────────────────────────────────────────────────────


def test_expired_revocations_are_purgeable(env):
    """令牌自己过期之后，撤销记录留着没有意义——要能清掉，否则表只涨不落。"""
    from datetime import datetime, timedelta, timezone

    store = env["store"]
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    store.revoke_token("stale-one", expires_at=past)
    store.revoke_token("still-live", expires_at=future)

    assert store.purge_revoked() == 1
    assert store.is_token_revoked("stale-one") is False
    assert store.is_token_revoked("still-live") is True, "把还该生效的撤销记录删了"


def test_revocation_outage_fails_open(env):
    """撤销表查不动时**放行**，与其余几道判定相反。

    理由：它是"额外收紧"的机制，挂掉时该退回到没有它的行为（即改动前的状态），
    而不是把所有已登录用户锁在门外。身份判定本身（签名/账号/密码戳）不依赖这张表。
    """
    from services import identity_store

    store = identity_store.get_identity_store()
    original = type(store).is_token_revoked

    def boom(self, jti):  # noqa: ANN001
        raise RuntimeError("撤销表挂了")

    type(store).is_token_revoked = boom
    try:
        assert _me(env["client"], env["token"]) is not None
    finally:
        type(store).is_token_revoked = original


# ── 自动续期 ─────────────────────────────────────────────────────


def test_a_young_token_is_not_renewed(env):
    """刚签的不续——否则每个请求都要重签一次，白烧 HMAC 还每次发 Set-Cookie。"""
    client = env["client"]
    client.cookies.set("sliderule_token", env["token"])
    got = client.get(f"{API}/account/me")
    assert "set-cookie" not in {k.lower() for k in got.headers.keys()}


def test_a_half_spent_token_gets_renewed(env):
    """过半程就换新：7 天从"绝对上限"变成"闲置上限"，一直在用就不会被打断。"""
    from datetime import datetime, timedelta, timezone

    import jwt

    from services.auth_tokens import ALGORITHM, DEFAULT_TTL_S, auth_secret

    payload = jwt.decode(env["token"], auth_secret(), algorithms=[ALGORITHM])
    old_iat = datetime.now(timezone.utc) - timedelta(seconds=DEFAULT_TTL_S - 3600)
    payload["iat"] = int(old_iat.timestamp())
    aged = jwt.encode(payload, auth_secret(), algorithm=ALGORITHM)

    client = env["client"]
    client.cookies.set("sliderule_token", aged)
    got = client.get(f"{API}/account/me")
    assert got.json().get("user") is not None
    assert got.headers.get("set-cookie"), "过半程的令牌没有被续期"
    # 续出来的必须是能用的，而且属性要跟签发处一致（否则浏览器当成两个 Cookie）
    assert "httponly" in got.headers["set-cookie"].lower()
    assert "path=/" in got.headers["set-cookie"].lower()


def test_bearer_callers_are_not_renewed(env):
    """脚本/CLI 拿不到 Set-Cookie，给它签新的没人收。"""
    from datetime import datetime, timedelta, timezone

    import jwt

    from services.auth_tokens import ALGORITHM, DEFAULT_TTL_S, auth_secret

    payload = jwt.decode(env["token"], auth_secret(), algorithms=[ALGORITHM])
    payload["iat"] = int(
        (datetime.now(timezone.utc) - timedelta(seconds=DEFAULT_TTL_S - 3600)).timestamp()
    )
    aged = jwt.encode(payload, auth_secret(), algorithm=ALGORITHM)

    got = env["client"].get(
        f"{API}/account/me", headers={"Authorization": f"Bearer {aged}"}
    )
    assert got.json().get("user") is not None
    assert not got.headers.get("set-cookie")
