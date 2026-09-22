"""邮件配置自检（2026-08-03）。

    cd slide-rule-python
    .venv/bin/python scripts/mail_check.py                    # 只看配置，不发信
    .venv/bin/python scripts/mail_check.py --to you@qq.com    # 真发一封

## 为什么要这个脚本

邮件配置错了的表现是**"注册接口返回成功，但没人收到"**——反馈极慢，而且错误藏在
服务端日志里。这个脚本把"配置对不对"变成一条命令、几秒钟。

它检查的是那几个最常错的地方：

  · 模式选对没有（console 模式下改半天 SMTP 是白改）
  · 网络到不到得了服务商（国内服务器封 25 端口、或只放行 443）
  · 凭据对不对（Resend 的 401 / SMTP 的 535）
  · **发信地址允不允许**——这条最容易卡住：Resend 在域名验证之前只能用
    onboarding@resend.dev 发，且**只能发给你自己的注册邮箱**。用它给别人发会被
    403 拒掉，而那正是真实注册流程要做的事。
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
from pathlib import Path

_PY_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PY_DIR))


def _load_env() -> None:
    for path in (_PY_DIR.parent / ".env", _PY_DIR / ".env"):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def _mask(value: str) -> str:
    if not value:
        return "(未设置)"
    return f"{value[:6]}…{value[-4:]}（{len(value)} 字符）" if len(value) > 12 else "(已设置)"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", help="真发一封验证码到这个邮箱（不传则只检查配置）")
    args = ap.parse_args()

    _load_env()
    from services import mailer

    mode = mailer.delivery_mode()
    print(f"投递模式: {mode}")

    if mode == "console":
        print("\n⚠️  当前是 console 模式：验证码只打印、并直接回在注册响应里。")
        print("    自部署跑通没问题，但**任何人调一次注册接口就能拿到验证码**。")
        print("    对外开放前必须配 EMAIL_DELIVERY_MODE=smtp 或 resend。")
        return 0

    sender = os.getenv("SMTP_FROM", mailer.DEFAULT_FROM)
    print(f"发信地址: {sender}")

    if mode == "resend":
        key = os.getenv("RESEND_API_KEY") or ""
        print(f"API Key:  {_mask(key)}")
        if not key:
            print("\n❌ 没配 RESEND_API_KEY")
            return 1
        print("\n检查网络到 api.resend.com …")
        try:
            import httpx

            r = httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {key}"},
                json={},
                timeout=15,
            )
            # 400 = 通了且 key 有效（只是 body 空）；401 = key 不对
            if r.status_code == 401:
                print("❌ API Key 无效（401）")
                return 1
            print(f"✅ 可达，凭据有效（HTTP {r.status_code}）")
        except Exception as exc:  # noqa: BLE001
            print(f"❌ 连不上: {str(exc)[:200]}")
            print("   国内服务器如果连 api.resend.com 不稳，考虑改用阿里云/腾讯云的 SMTP")
            return 1

        if "resend.dev" in sender:
            print("\n⚠️  你在用 Resend 的沙盒发信地址 onboarding@resend.dev。")
            print("    **它只能发给你自己的 Resend 注册邮箱**，给别人发会被 403 拒掉。")
            print("    也就是说：现在只能自己测，真实用户注册会失败。")
            print("    解法：Resend 控制台 → Domains → 加你的域名并配 DNS，")
            print("    验证通过后把 SMTP_FROM 换成 no-reply@你的域名。")
    else:
        host = os.getenv("SMTP_HOST", "")
        port = int(os.getenv("SMTP_PORT", "465") or 465)
        print(f"SMTP:     {host}:{port}  用户={os.getenv('SMTP_USER') or '(无)'}")
        if not host:
            print("\n❌ 没配 SMTP_HOST")
            return 1
        print(f"\n检查 TCP 到 {host}:{port} …")
        try:
            with socket.create_connection((host, port), timeout=10):
                print("✅ 端口可达")
        except OSError as exc:
            print(f"❌ 连不上: {exc}")
            if port == 25:
                print("   25 端口在国内云服务器上默认被封（阿里云 ECS 明确禁用）。")
                print("   改用 465（SMTP_PORT=465 SMTP_SECURE=true）。")
            return 1

    if not args.to:
        print("\n配置检查通过。要真发一封验证一下：--to 你的邮箱")
        return 0

    print(f"\n发送测试验证码到 {args.to} …")
    try:
        delivered = mailer.send_login_code(args.to, "123456", expires_minutes=10)
    except mailer.MailerError as exc:
        print(f"❌ 发送失败: {exc}")
        text = str(exc)
        if "403" in text or "testing emails" in text.lower():
            print("\n   这就是上面说的沙盒限制：未验证域名时只能发给自己的注册邮箱。")
        elif "535" in text or "auth" in text.lower():
            print("\n   认证失败：检查 SMTP_USER / SMTP_PASSWORD。")
            print("   注意有些服务商要的是**独立的 SMTP 密码**，不是登录密码。")
        return 1
    print("✅ 已投递" if delivered else "（console 模式，只打印了）")
    print("   去收件箱看看。没收到就翻垃圾箱——那说明要配 SPF/DKIM。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
