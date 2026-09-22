"""验证码邮件投递（2026-08-03）。

这份测试盯的核心只有一条：**配了邮件服务商之后，验证码绝不能出现在响应里**。

没配时把码回给调用方（devCode）是刻意的——自部署零配置也能跑通注册。但一旦配了
服务商，这个后门必须彻底关死：配了服务商却仍然回落成"码在响应里"，比压根没配更糟
（部署方以为验证码这道关生效了，实际是公开的）。

顺带盯几个容易写错的地方：SSL 端口语义、超时、不静默降级成明文。
"""

from __future__ import annotations

import pytest

from services import auth_service, identity_store as ident, mailer


@pytest.fixture(autouse=True)
def _clean(tmp_path, monkeypatch):
    from config.settings import settings

    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setenv("SLIDERULE_IDENTITY_SQLITE", f"sqlite:///{tmp_path / 'id.db'}")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "m" * 48)
    for k in ("EMAIL_DELIVERY_MODE", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
              "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "RESEND_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    ident.reset_identity_cache()
    yield
    ident.reset_identity_cache()


# ────────────────────── ① 模式选择 ──────────────────────


def test_console_is_the_default(monkeypatch):
    """零配置 = console。自部署首次跑通不需要先去申请邮件服务。"""
    assert mailer.delivery_mode() == "console"
    assert mailer.is_configured() is False


def test_unknown_mode_falls_back_to_console(monkeypatch):
    """配错值不该让注册整个挂掉——回落到打印，日志里看得见。"""
    monkeypatch.setenv("EMAIL_DELIVERY_MODE", "sendgridd")
    assert mailer.delivery_mode() == "console"


def test_console_mode_reports_not_delivered(capsys):
    assert mailer.send_login_code("a@example.com", "123456") is False
    assert "123456" in capsys.readouterr().out


# ────────────────────── ② 最要紧的一条 ──────────────────────


def test_configured_provider_never_leaks_the_code_on_failure(monkeypatch):
    """**配了服务商却发送失败 → 报错，绝不把验证码放进响应。**

    这是这个文件存在的理由。回落成 devCode 等于：部署方以为验证码这道关生效了，
    实际任何人调一次注册接口就能拿到码。比没配服务商更糟。
    """
    monkeypatch.setenv("EMAIL_DELIVERY_MODE", "smtp")
    monkeypatch.setenv("SMTP_HOST", "smtp.invalid.example")
    monkeypatch.setenv("SMTP_PORT", "465")

    out = auth_service.start_registration("x@example.com", "correct-horse-battery")
    assert out["ok"] is False
    assert out["error"] == "mail_failed"
    assert "devCode" not in out, "配了服务商却把验证码回给了调用方"
    # 响应里任何地方都不该出现 6 位码
    import re

    assert not re.search(r"\b\d{6}\b", str(out)), f"响应里疑似带了验证码: {out}"


def test_failed_delivery_drops_the_stored_code(monkeypatch):
    """发送失败要把刚存的码作废。

    留着的话：用户拿不到码（没发出去），却因为冷却期而**重发不了**——
    只有坏处没有好处。
    """
    monkeypatch.setenv("EMAIL_DELIVERY_MODE", "smtp")
    monkeypatch.setenv("SMTP_HOST", "smtp.invalid.example")

    auth_service.start_registration("y@example.com", "correct-horse-battery")
    assert ident.get_identity_store().get_code("y@example.com") is None


def test_console_mode_still_returns_the_code(monkeypatch):
    """没配服务商时的后门必须还在，否则自部署第一步就卡死。"""
    out = auth_service.start_registration("z@example.com", "correct-horse-battery")
    assert out["ok"] is True
    assert len(out.get("devCode", "")) == 6


def test_missing_host_is_an_error_not_a_silent_console_fallback(monkeypatch):
    """EMAIL_DELIVERY_MODE=smtp 但没配 host —— 报错，不静默退回打印。

    静默退回的表现是"线上一直没人收到邮件，日志里却看着像发了"。
    """
    monkeypatch.setenv("EMAIL_DELIVERY_MODE", "smtp")
    with pytest.raises(mailer.MailerError, match="SMTP_HOST"):
        mailer.send_login_code("a@example.com", "123456")


def test_resend_without_key_is_an_error(monkeypatch):
    monkeypatch.setenv("EMAIL_DELIVERY_MODE", "resend")
    with pytest.raises(mailer.MailerError, match="RESEND_API_KEY"):
        mailer.send_login_code("a@example.com", "123456")


# ────────────────────── ③ 端口与加密语义 ──────────────────────


def test_465_uses_implicit_ssl_and_587_uses_starttls(monkeypatch):
    """465 = 连上就是加密的；587/25 = 明文连上再 STARTTLS 升级。

    搞混的表现是连接挂住或握手失败，而错误信息完全看不出是端口选错了——
    这是配置 SMTP 最常见的坑，所以钉住它。
    """
    calls: list[str] = []

    class _FakeSMTP:
        def __init__(self, host, port, timeout=None, context=None):
            calls.append(f"{type(self).__name__}:{port}")

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def ehlo(self):
            pass

        def starttls(self, context=None):
            calls.append("starttls")

        def login(self, u, p):
            calls.append("login")

        def send_message(self, msg):
            calls.append("sent")

    class _FakeSSL(_FakeSMTP):
        pass

    monkeypatch.setattr(mailer.smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", _FakeSSL)
    monkeypatch.setenv("EMAIL_DELIVERY_MODE", "smtp")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_USER", "u")
    monkeypatch.setenv("SMTP_PASSWORD", "p")

    monkeypatch.setenv("SMTP_PORT", "465")
    assert mailer.send_login_code("a@example.com", "123456") is True
    assert "_FakeSSL:465" in calls and "starttls" not in calls

    calls.clear()
    monkeypatch.setenv("SMTP_PORT", "587")
    assert mailer.send_login_code("a@example.com", "123456") is True
    assert "_FakeSMTP:587" in calls and "starttls" in calls


def test_default_port_is_465_because_domestic_clouds_block_25(monkeypatch):
    """默认 465 而不是 587/25。

    国内云服务器默认封 25 端口（阿里云 ECS 明确禁用，腾讯云同理）。
    默认值选错的表现是"部署上去发不出邮件"，而多数人不会想到是端口。
    """
    calls: list[int] = []

    class _FakeSSL:
        def __init__(self, host, port, timeout=None, context=None):
            calls.append(port)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def login(self, u, p):
            pass

        def send_message(self, m):
            pass

    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", _FakeSSL)
    monkeypatch.setenv("EMAIL_DELIVERY_MODE", "smtp")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    mailer.send_login_code("a@example.com", "123456")
    assert calls == [465]


def test_no_silent_plaintext_when_starttls_is_unsupported(monkeypatch):
    """服务器不支持 STARTTLS 时**拒绝发送**，不降级成明文。

    验证码是凭据，明文过网等于这道关白做。让它失败，由部署方改用 465。
    """
    import smtplib as _s

    class _FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def ehlo(self):
            pass

        def starttls(self, context=None):
            raise _s.SMTPNotSupportedError("no starttls")

        def send_message(self, m):
            raise AssertionError("不该走到发送——明文发验证码等于白做")

    monkeypatch.setattr(mailer.smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setenv("EMAIL_DELIVERY_MODE", "smtp")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_PORT", "587")
    with pytest.raises(mailer.MailerError, match="STARTTLS"):
        mailer.send_login_code("a@example.com", "123456")


# ────────────────────── ④ 邮件内容 ──────────────────────


def test_message_carries_the_code_and_expiry():
    msg = mailer._build_message("a@example.com", "246810", 10)
    body = msg.get_body(preferencelist=("plain",)).get_content()
    assert "246810" in body
    assert "10" in body
    assert msg["To"] == "a@example.com"
    assert msg["Subject"]


def test_from_defaults_are_overridable(monkeypatch):
    monkeypatch.setenv("SMTP_FROM", "SlideRule <hi@miantuan.ai>")
    assert mailer._build_message("a@example.com", "1", 10)["From"] == "SlideRule <hi@miantuan.ai>"
