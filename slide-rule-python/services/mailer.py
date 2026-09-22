"""验证码邮件投递（2026-08-03）。

## 选型：一个 SMTP 打通所有服务商

Resend / SendGrid / Mailgun / Postmark / 阿里云邮件推送 / 腾讯云 SES —— **全都提供
SMTP 接入**。所以这里不给每家写一个适配器，只做一套 SMTP，换服务商 = 换四个环境
变量。省掉的不只是代码，还有"某家的 SDK 升级了/停止维护了"这类长期负担。

环境变量名与 Node 侧那套（server/auth/email-mailer.ts）**保持一致**，部署时配一次
两边都认。

## 但 SMTP 不总是能用，所以留了 HTTP 通道

**国内云服务器默认封 25 端口**（阿里云 ECS 明确禁用，腾讯云同理）。465/587 通常
可用，但更严的网络策略里可能只放行 443 —— 这个项目已经踩过一模一样的坑：
Neon 的 TCP 5432 不通，最后靠 SQL over HTTP 才连上（见 app_store 的说明）。

所以除 SMTP 外还实现了 Resend 的 HTTP API（纯 443）。取向与存储层一致：
**优先用常规通道，受限网络有第二条路**。

## 三种模式

    console  只打印（默认）—— 自部署零配置也能跑通注册
    smtp     通用，覆盖上面所有服务商
    resend   HTTP API，只需要 443

## 一条安全纪律

**只有 console 模式才把验证码回给调用方**（用于自部署首次跑通）。配了真投递却
发送失败时**返回失败**，绝不回落成"把码放响应里"——那等于配了服务商反而把验证码
公开了，是比没配更糟的状态。
"""

from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from typing import Optional

# 单封邮件的硬超时。SMTP 握手挂住会拖住整个请求——注册接口跑在线程池里，
# 一个卡死的连接就占住一个槽。10s 足够正常投递（实测国内到阿里云 <1s）。
_SMTP_TIMEOUT_S = 10
_HTTP_TIMEOUT_S = 10

DEFAULT_FROM = "SlideRule <no-reply@sliderule.local>"


class MailerError(RuntimeError):
    """投递失败。调用方应当如实报错，**不要**回落成把验证码放进响应。"""


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _env_bool(name: str, default: bool) -> bool:
    """⚠ 这一处的三分支（认识的开 / 认识的关 / 其余回落默认）本来就是对的，
    收进 env_flags 只是为了**词表只剩一份**——2026-08-29 对账时全仓手抄了 28 份，
    其中两份的默认与词表对不上（见 env_flags 模块头）。"""
    from services.env_flags import parse

    return parse(_env(name), default=default, name=name)


def delivery_mode() -> str:
    """console / smtp / resend。默认 console —— 零配置也能跑通注册。"""
    mode = _env("EMAIL_DELIVERY_MODE", "console").lower()
    return mode if mode in ("console", "smtp", "resend") else "console"


def is_configured() -> bool:
    """有没有配真实投递。决定失败时能不能把验证码回给调用方（见模块说明）。"""
    return delivery_mode() != "console"


def _build_message(to: str, code: str, expires_minutes: int) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = _env("SMTP_FROM", DEFAULT_FROM)
    msg["To"] = to
    msg["Subject"] = "SlideRule 登录验证码"
    msg.set_content(
        f"你的 SlideRule 验证码是 {code}。\n"
        f"{expires_minutes} 分钟内有效。\n"
        f"如果不是你本人操作，忽略这封邮件即可。"
    )
    msg.add_alternative(
        "<p>你的 SlideRule 验证码是：</p>"
        f'<p style="font-size:28px;font-weight:700;letter-spacing:6px">{code}</p>'
        f"<p>{expires_minutes} 分钟内有效。</p>"
        "<p>如果不是你本人操作，忽略这封邮件即可。</p>",
        subtype="html",
    )
    return msg


def _send_smtp(to: str, code: str, expires_minutes: int) -> None:
    host = _env("SMTP_HOST")
    if not host:
        raise MailerError("EMAIL_DELIVERY_MODE=smtp 但没有配 SMTP_HOST")

    # 端口默认 465 而不是 587：**国内云服务器默认封 25**，而 465（隐式 SSL）
    # 是各家国内服务商的推荐口。Node 侧默认 587 是历史值，两边不必强行一致——
    # 那个默认值在国内环境下大概率连不上。
    port = int(_env("SMTP_PORT", "465") or 465)
    # 465 = 隐式 SSL（连上就是加密的）；587/25/80 = 明文连上再 STARTTLS 升级。
    # 搞混的表现是连接直接挂住或握手失败，很难从错误信息看出是端口选错了。
    implicit_ssl = _env_bool("SMTP_SECURE", port == 465)
    user = _env("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD") or ""

    msg = _build_message(to, code, expires_minutes)
    context = ssl.create_default_context()
    try:
        if implicit_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=_SMTP_TIMEOUT_S, context=context) as s:
                if user:
                    s.login(user, password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=_SMTP_TIMEOUT_S) as s:
                s.ehlo()
                try:
                    s.starttls(context=context)
                    s.ehlo()
                except smtplib.SMTPNotSupportedError:
                    # 服务器不支持 STARTTLS。**不静默降级成明文**——验证码是凭据，
                    # 明文过网等于白做。让它失败，由部署方改用 465。
                    raise MailerError(
                        f"{host}:{port} 不支持 STARTTLS，拒绝以明文发送验证码。"
                        f"改用 465 端口（SMTP_PORT=465 SMTP_SECURE=true）"
                    )
                if user:
                    s.login(user, password)
                s.send_message(msg)
    except MailerError:
        raise
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
        raise MailerError(f"SMTP 投递失败（{host}:{port}）: {str(exc)[:200]}") from exc


def _send_resend(to: str, code: str, expires_minutes: int) -> None:
    """Resend 的 HTTP API。只用 443 —— 给 SMTP 端口被封的网络。

    选 Resend 做这条通道是因为它的 API 足够简单（一个 POST、一个 key），
    不需要引 SDK。别家（SendGrid/Mailgun）同样有 HTTP API，需要时按同样形状加。
    """
    import httpx

    api_key = os.getenv("RESEND_API_KEY") or ""
    if not api_key:
        raise MailerError("EMAIL_DELIVERY_MODE=resend 但没有配 RESEND_API_KEY")
    sender = _env("SMTP_FROM", DEFAULT_FROM)
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            timeout=_HTTP_TIMEOUT_S,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": sender,
                "to": [to],
                "subject": "SlideRule 登录验证码",
                "html": (
                    "<p>你的 SlideRule 验证码是：</p>"
                    f'<p style="font-size:28px;font-weight:700;letter-spacing:6px">{code}</p>'
                    f"<p>{expires_minutes} 分钟内有效。</p>"
                    "<p>如果不是你本人操作，忽略这封邮件即可。</p>"
                ),
            },
        )
    except httpx.HTTPError as exc:
        raise MailerError(f"Resend 请求失败: {str(exc)[:200]}") from exc
    if resp.status_code >= 400:
        # 把服务商的错误原样带出来——最常见的是"发信域名没验证"，
        # 而那个错误只有看到原文才知道该去控制台做什么。
        raise MailerError(f"Resend 返回 {resp.status_code}: {resp.text[:300]}")


def send_login_code(to: str, code: str, *, expires_minutes: int = 10) -> bool:
    """发验证码。返回**是否真的投递出去了**。

    console 模式返回 False（调用方据此把验证码回给用户，自部署首次跑通用）。
    配了真投递则要么 True、要么抛 MailerError —— **绝不返回 False**，
    否则调用方会把验证码放进响应，那比没配服务商更糟。
    """
    mode = delivery_mode()
    if mode == "console":
        print(f"[mailer] 未配置邮件服务（EMAIL_DELIVERY_MODE=console），验证码仅打印: {to} -> {code}")
        return False
    if mode == "resend":
        _send_resend(to, code, expires_minutes)
    else:
        _send_smtp(to, code, expires_minutes)
    print(f"[mailer] 验证码已投递（{mode}）: {to}")
    return True
