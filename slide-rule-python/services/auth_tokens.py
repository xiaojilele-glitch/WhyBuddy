"""访问令牌签发与校验（2026-08-02）。

对齐 **fastapi/full-stack-fastapi-template**（MIT）的 `core/security.py`：
HS256、`sub` 放用户 id、`exp` 绝对过期。

## 撤销：两个机制各管一半（2026-08-04）

原来这里写着"没有服务端撤销，需要时再加"。需要的时候到了——找回密码上线之后，
"密码被人拿到了赶紧改"这个**唯一的使用场景**恰恰是纯 JWT 防不住的：改完密码，
对方手里那张没过期的令牌照样能用最长七天。

两个机制，分别抄自两个成熟实现（都拉到本地读过源码）：

**① `pv` 密码戳 —— 改密码踢掉全部旧会话。零存储。**

抄 **Django** `contrib/auth/base_user.py:142` 的 `_get_session_auth_hash`：
拿**密码哈希**做一次 HMAC，塞进会话，每次请求比对
（`contrib/auth/__init__.py:180` 的 `constant_time_compare`）。密码一改，
哈希跟着变，所有旧会话**自动**对不上——不需要任何撤销表、不需要遍历用户的
令牌，改一行密码就全灭。

我们把这个 HMAC 放进 JWT 的 `pv` 声明，验的时候跟库里当前密码哈希重算一遍比。
好处同上：**存量令牌天然带不上 `pv`**，所以下面对缺失的 `pv` 有明确处理（见
`password_stamp` 与 middlewares/current_user 的说明）。

**② `jti` + 撤销表 —— 登出即失效。**

抄 **fastapi-users** 的 `authentication/strategy/db/strategy.py`：它的
`DatabaseStrategy.destroy_token` 直接把令牌行删掉；而同一个库的
`JWTStrategy.destroy_token` **直接抛 `JWTStrategyDestroyNotSupportedError`**
（jwt.py:71）——它拒绝假装 JWT 能撤销。这个诚实值得抄。

我们不整体换成不透明令牌（那要动每一条路由和 Node 那层桥），改成给每张令牌一个
`jti`，登出时把这一个 `jti` 记进撤销表。表只存**还没过期**的那些，过期即可清理，
量级是"当前活跃会话数"，不是"历史全部令牌"。

两个机制是互补的，不能只留一个：`pv` 管不了"我只想登出这台设备"（密码没变），
`jti` 管不了"把这个人所有设备都踢掉"（要遍历他所有令牌，而我们并不记录签发过
哪些）。

## 密钥纪律

生产环境缺 `SLIDERULE_AUTH_SECRET` **直接拒绝启动**。审查那套 RBAC 系统时见到
`secret: process.env.JWT_SECRET || 'your-secret-key'` ——兜底密钥写在开源代码里，
漏配一次等于任何人都能签发任意用户的合法令牌。这里不重复那个错误。

开发环境允许自动生成一把**进程内随机**密钥：进程重启后旧令牌全失效，这是刻意的
（不给"开发时能跑、上线忘了配"留活路）。
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

ALGORITHM = "HS256"
# 7 天。2026-08-04 起有了撤销（见模块头），"签太长等于把登出做成摆设"那条顾虑
# 不成立了，但 7 天仍然是合适的量级——它现在是**闲置**上限：还在用的会话会被
# 自动续期（见 middlewares/current_user 的 RENEW_AFTER_S）。
DEFAULT_TTL_S = 7 * 24 * 3600

_SECRET_ENV = "SLIDERULE_AUTH_SECRET"
_MIN_SECRET_LEN = 32

_dev_secret: Optional[str] = None


def _is_production() -> bool:
    env = (os.getenv("NODE_ENV") or os.getenv("APP_ENV") or "").strip().lower()
    return env in ("production", "prod")


def auth_secret() -> str:
    """取签名密钥。生产缺配就抛——这类配置没有安全的兜底值。"""
    global _dev_secret
    raw = (os.getenv(_SECRET_ENV) or "").strip()
    if len(raw) >= _MIN_SECRET_LEN:
        return raw
    if raw:
        raise RuntimeError(f"{_SECRET_ENV} 太短（至少 {_MIN_SECRET_LEN} 字符）")
    if _is_production():
        raise RuntimeError(
            f"生产环境必须设置 {_SECRET_ENV}（至少 {_MIN_SECRET_LEN} 字符）。"
            f"生成：openssl rand -hex 32"
        )
    if _dev_secret is None:
        _dev_secret = secrets.token_hex(32)
        print(
            f"[auth] {_SECRET_ENV} 未设置，本次进程使用随机开发密钥"
            f"（重启后旧令牌失效；生产环境会拒绝启动）"
        )
    return _dev_secret


def password_stamp(password_hash: str) -> str:
    """密码戳：拿密码哈希再做一次 HMAC（Django `_get_session_auth_hash` 同款）。

    **不是**把密码哈希本身塞进令牌——那等于把 Argon2 哈希发给客户端，虽然不可逆，
    但白白多一份离线爆破的素材。HMAC 之后客户端拿到的只是个不可回推的指纹，而且
    绑定了签名密钥。

    截断到 16 个十六进制字符（64 bit）：这个值只用来做**相等比较**，不承担抗碰撞
    以外的职责，而令牌是要塞进 Cookie 的，每一位都占地方。Django 用全长是因为它
    存在服务端会话里，不走网络。

    key_salt 照 Django 的做法带上用途——同一把密钥在别处做 HMAC（比如验证码）
    时不会互相串用。
    """
    import hashlib
    import hmac

    digest = hmac.new(
        f"sliderule.auth.password_stamp:{auth_secret()}".encode(),
        (password_hash or "").encode(),
        hashlib.sha256,
    ).hexdigest()
    return digest[:16]


def create_access_token(
    user_id: str,
    *,
    ttl_s: int = DEFAULT_TTL_S,
    password_hash: str = "",
    **claims: Any,
) -> str:
    """签一张令牌。

    `password_hash` 给了就带上 `pv` 密码戳（改密码即全端失效，见模块头 ①）。
    不给就不带——**签名方缺省不等于验证方放行**，验证侧对"没有 pv"的处理写在
    middlewares/current_user 里，那里才是判定的地方。
    """
    import jwt

    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_s)).timestamp()),
        # 每张令牌一个身份，登出时按它撤销（见模块头 ②）。用 token_urlsafe 而不是
        # 自增/时间戳：可预测的 jti 会让攻击者能提前把别人的令牌写进撤销表。
        "jti": secrets.token_urlsafe(12),
        **claims,
    }
    if password_hash:
        payload["pv"] = password_stamp(password_hash)
    return jwt.encode(payload, auth_secret(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    """校验并解出 payload；任何问题都返回 None（不区分过期/伪造）。

    不把失败原因暴露给调用方是刻意的：区分「令牌过期」和「签名不对」会给攻击者
    额外信息。前端只需要知道"重新登录"。
    """
    import jwt

    if not token:
        return None
    try:
        return jwt.decode(token, auth_secret(), algorithms=[ALGORITHM])
    except Exception:  # noqa: BLE001 — 过期/签名错/结构错一律按无效处理
        return None


def token_subject(token: str) -> Optional[str]:
    payload = decode_access_token(token)
    if not payload:
        return None
    sub = payload.get("sub")
    return str(sub) if sub else None
