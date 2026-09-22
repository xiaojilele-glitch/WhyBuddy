"""找回密码（2026-08-03）。

设计稿上一直画着「忘记密码?」，但后端此前**没有任何找回密码的接口**——那个
链接指向空气。这里补的是两个接口（发码 / 验码改密），复用注册那套邮箱验证码。

这份测试盯三件事，按重要性排：

  ① **不能变成用户枚举器**。找回密码是天然的枚举接口：输入邮箱看回什么，
     就知道谁注册过。所以"邮箱不存在"和"邮箱存在"必须给出一样的响应，
     连"太频繁"这种看似无害的差异都不行（连点两次即可探测）。
  ② **验证码按用途隔离**。码表主键是邮箱、一个邮箱只有一个码，purpose 列
     此前存了但没人校验。不校验的话，为注册收到的码可以拿去改别人的密码。
  ③ 功能本身真的通：改完能用新密码登录，旧密码失效。
"""

from __future__ import annotations

import pytest

pytest.importorskip("pwdlib", reason="没装 pwdlib 时身份体系不可用")
pytest.importorskip("jwt", reason="没装 PyJWT 时令牌不可用")

OLD = "correct-horse-battery"
NEW = "another-long-password"
EMAIL = "reset-me@example.com"


@pytest.fixture
def store(tmp_path, monkeypatch):
    """干净的本地身份库 + 一个已注册用户。

    ⚠️ `APP_STORE_DATABASE_URL` 必须清掉。不清的话 `_build_store` 会连**真正的
    Neon 库**——测试用户就直接写进生产身份表了（第一版漏了这行，实测确实写进去
    了，只好手工清）。`SLIDERULE_IDENTITY_SQLITE` 只在远端 URL 为空时才生效。
    """
    from config.settings import settings

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setenv("SLIDERULE_IDENTITY_SQLITE", f"sqlite:///{tmp_path / 'id.db'}")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "r" * 48)
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)

    from services import identity_store

    identity_store.reset_identity_cache()

    from services import auth_service

    started = auth_service.start_registration(EMAIL, OLD)
    auth_service.complete_registration(EMAIL, OLD, started["devCode"])

    yield identity_store.get_identity_store()
    identity_store.reset_identity_cache()


def _svc():
    from services import auth_service

    return auth_service


def _reset_code(email: str = EMAIL) -> str:
    """走完第一步，把验证码取出来。

    没配邮件服务时后端把码带在 devCode 里（自部署首次跑通用），测试正好借这条。
    """
    started = _svc().start_password_reset(email)
    assert started["ok"] and started["codeSent"], started
    return started["devCode"]


# ── ① 不能变成用户枚举器 ──────────────────────────────────────────


def test_unknown_email_looks_exactly_like_a_known_one(store):
    """没注册的邮箱也回"已发送"——如实回答就是一个用户枚举器。"""
    known = _svc().start_password_reset(EMAIL)
    unknown = _svc().start_password_reset("nobody@example.com")

    assert unknown["ok"] is True
    # 用户看得见的只有 message，两边必须逐字相同
    assert unknown["message"] == known["message"]
    # 没注册的邮箱当然不该真发码，也不该带 devCode 出来
    assert unknown["codeSent"] is False
    assert "devCode" not in unknown


def test_cooldown_does_not_leak_that_the_email_exists(store):
    """冷却期内**不报 too_frequent**，走同一条成功出口。

    报错的话，"连点两次得到太频繁"就是"这个邮箱注册过"的探针——不存在的邮箱
    永远进不了冷却期，因为它压根不会有码。
    """
    first = _svc().start_password_reset(EMAIL)
    second = _svc().start_password_reset(EMAIL)  # 紧接着再来一次，必在冷却内

    assert first["codeSent"] is True
    assert second["ok"] is True and second["message"] == first["message"]
    # 没发新码，所以也没有 devCode——但对外的形状跟第一次一致
    assert second["codeSent"] is False
    assert "devCode" not in second


def test_disabled_account_also_looks_normal(store):
    """停用的账号同样走成功出口，不发码——账号状态不是外人该知道的事。"""
    from services.identity_store import TABLE

    user = store.get_by_email(EMAIL)
    # IdentityStore 还没有公开的"停用账号"方法（管理台目前只读），测试直接改列
    executor = store._x  # noqa: SLF001
    executor.execute(
        f"update {TABLE} set is_active = {executor.ph(1)} where id = {executor.ph(2)}",
        [False, user.id],
    )
    got = _svc().start_password_reset(EMAIL)
    assert got["ok"] is True and got["codeSent"] is False


def test_malformed_input_may_be_reported_plainly(store):
    """输入压根不是邮箱可以如实报——它只说明格式不对，跟"谁注册过"无关。"""
    got = _svc().start_password_reset("not-an-email")
    assert got["ok"] is False and got["error"] == "invalid_email"


# ── ② 验证码按用途隔离 ────────────────────────────────────────────


def test_registration_code_cannot_be_used_to_change_a_password(store):
    """注册码 ≠ 改密码码。

    码表主键是邮箱、purpose 此前只存不校验。不隔离的话，一个为注册流程发出的
    码可以直接拿去改密码——而注册那条流程对"邮箱已存在"是**静默成功**的，
    等于给了攻击者一个不需要受害者配合的入口形状。
    """
    other = "fresh@example.com"
    started = _svc().start_registration(other, OLD)  # purpose=register
    got = _svc().complete_password_reset(other, started["devCode"], NEW)
    assert got["ok"] is False and got["error"] == "code_invalid"


def test_reset_code_cannot_be_used_to_finish_a_registration(store):
    """反方向同样挡住。"""
    code = _reset_code()
    got = _svc().complete_registration(EMAIL, NEW, code)
    assert got["ok"] is False and got["error"] == "code_invalid"


def test_wrong_purpose_does_not_burn_the_real_attempt_budget(store):
    """用途不符**不计**失败次数。

    计数的话，"往改密码接口丢一个注册码"就成了作废他人验证码的廉价手段——
    受害者手里那个刚收到的码会被外人打到次数上限。
    """
    from services import identity_store as ident

    code = _reset_code()
    for _ in range(ident.EMAIL_CODE_MAX_ATTEMPTS + 2):
        _svc().complete_registration(EMAIL, NEW, code)  # 用途不符
    # 码依然可用
    assert _svc().complete_password_reset(EMAIL, code, NEW)["ok"] is True


# ── ③ 功能真的通 ─────────────────────────────────────────────────


def test_reset_swaps_the_password_and_logs_in(store):
    code = _reset_code()
    done = _svc().complete_password_reset(EMAIL, code, NEW)

    assert done["ok"] is True
    assert done["user"]["email"] == EMAIL
    assert done["token"]  # 改完即登录态，同注册
    assert _svc().login(EMAIL, NEW)["ok"] is True
    assert _svc().login(EMAIL, OLD)["ok"] is False, "旧密码还能登，等于没改"


def test_code_is_single_use(store):
    code = _reset_code()
    assert _svc().complete_password_reset(EMAIL, code, NEW)["ok"] is True
    again = _svc().complete_password_reset(EMAIL, code, "yet-another-password")
    assert again["ok"] is False and again["error"] == "code_invalid"


def test_wrong_code_rejected_and_counted(store):
    from services import identity_store as ident

    _reset_code()
    for _ in range(ident.EMAIL_CODE_MAX_ATTEMPTS):
        got = _svc().complete_password_reset(EMAIL, "000000", NEW)
        assert got["ok"] is False
    # 次数用尽后即使拿到真码也不认——挡住在线爆破
    assert _svc().login(EMAIL, OLD)["ok"] is True, "密码不该被改掉"


def test_weak_password_does_not_consume_the_code(store):
    """密码不合格时**留着码**：让用户换个密码接着用，而不是重收一封邮件。"""
    code = _reset_code()
    weak = _svc().complete_password_reset(EMAIL, code, "short")
    assert weak["ok"] is False and weak["error"] == "weak_password"
    assert _svc().complete_password_reset(EMAIL, code, NEW)["ok"] is True


def test_the_two_endpoints_are_actually_wired(store):
    """走真实 HTTP 一遍。

    上面全是直接调 service——那验不了"路由挂上了没有"，而这次的起点恰恰是
    「设计稿有入口、后端没接口」。少挂一个 @router.post 就会重演同一件事。
    """
    from fastapi.testclient import TestClient

    from app import app as fastapi_app

    client = TestClient(fastapi_app)
    hdr = {"x-internal-key": "dev-slide-rule-internal"}

    started = client.post(
        "/api/sliderule/account/password/reset/start", json={"email": EMAIL}, headers=hdr
    )
    assert started.status_code == 200, started.text
    code = started.json()["devCode"]

    done = client.post(
        "/api/sliderule/account/password/reset",
        json={"email": EMAIL, "code": code, "password": NEW},
        headers=hdr,
    )
    assert done.status_code == 200, done.text
    # 成功即登录态：Cookie 要种上，否则用户改完密码还得再登一次
    from middlewares.current_user import AUTH_COOKIE

    assert done.cookies.get(AUTH_COOKIE)
    assert "password_hash" not in done.text and "$argon2" not in done.text

    bad = client.post(
        "/api/sliderule/account/password/reset",
        json={"email": EMAIL, "code": "000000", "password": NEW},
        headers=hdr,
    )
    assert bad.status_code == 400


def test_error_wording_never_distinguishes_the_failure_kind(store):
    """码错 / 码过期 / 用途不符对外是同一句——分开说就是在指路。"""
    from services.auth_service import CODE_INVALID

    _reset_code()
    wrong = _svc().complete_password_reset(EMAIL, "000000", NEW)
    other_purpose = _svc().complete_registration(EMAIL, NEW, "000000")
    assert wrong["message"] == other_purpose["message"] == CODE_INVALID
