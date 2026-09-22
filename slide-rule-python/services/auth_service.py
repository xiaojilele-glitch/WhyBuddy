"""注册 / 登录 / 邮箱验证（2026-08-02）。

薄薄一层业务规则，存储在 identity_store、令牌在 auth_tokens。

## 三个刻意的取舍

**① 登录失败一律同一个错误信息**

邮箱不存在和密码错误返回**逐字节相同**的响应。区分开等于送一个「这个邮箱注册过
没有」的探测接口——攻击者可以据此枚举用户。同理，注册时邮箱已存在也不直接说，
走"验证码已发送"的同一条出口（见 register 的说明）。

**② 邮箱不存在时也要跑一次哈希校验**

不跑的话，"邮箱不存在"会比"密码错误"快一个数量级（Argon2 是故意慢的），
时序差本身就泄露了邮箱是否注册过。所以对着一个固定的假哈希空跑一次。
这是 Django `authenticate()` 和 fastapi-users 都有的做法。

**③ 第一个注册的用户自动成为超管**

对齐官方模板 `initial_data.py` 的取向（用 FIRST_SUPERUSER 建首个超管），但改成
"库里一个用户都没有时自动提升"——自部署场景下不用先配环境变量再启动。
之后再注册的都是普通用户。

**④ 账号库连不上 ≠ 密码不对**

防枚举（①）说的是"**同一个库里**邮箱存不存在，对外不许有区别"。库本身
连不上是另一回事，跟输入的邮箱无关，说出来泄露不了任何账号信息。

⚠ 2026-09-05 真机踩的就是这个：代理端口换了，容器里所有出站 HTTPS 变成
`Connection refused`，`identity_store` 静静降级到本地 SQLite——那个库里
一个用户都没有。真实存在的账号登录，拿到的是 **「邮箱或密码不正确」**。
排查方向被这句话整个带偏：去查密码、去查账号、去点找回密码（改到的还是
那个空库），而真正坏掉的是网络。日志里其实有一行
`[identity] HTTPS 网关不可用，继续按常规顺序降级`，但没人会因为一句
"密码不对"去翻服务端日志。

所以降级到兜底库时，登录失败改口说**服务连不上**。判据两头都钉：
库正常时密码打错必须还是那句 LOGIN_FAILED（否则防枚举白做了）。

## 验证码按用途隔离（2026-08-03 随找回密码加入）

验证码表 `sliderule_email_code` 的主键是**邮箱**，一个邮箱同一时刻只有一个码，
`purpose` 列一直存着但此前**没有人校验**。加了找回密码之后这就成了真漏洞：

  攻击者用受害者的邮箱走「注册」→ 后端因为邮箱已存在不发码（防枚举），
  但换个方向——受害者自己刚为**注册**收到的码，可以被拿去走**改密码**接口。

所以验码统一走 `_consume_code(email, code, purpose=…)`，用途对不上按"码无效"
处理。两条流程各自的码互不通用。
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

from services import identity_store as ident
from services.auth_tokens import create_access_token

# 登录失败的统一话术。**不要**按情况细分（见模块说明 ①）。
LOGIN_FAILED = "邮箱或密码不正确"

# 账号库连不上时的话术。跟 LOGIN_FAILED 分开，见模块说明 ④。
IDENTITY_UNAVAILABLE = "账号服务暂时连不上，请稍后再试——这不是你的密码有问题"

# 验码失败的统一话术。过期 / 次数用尽 / 用途不符 / 压根就填错，对外都是这一句：
# 分开说等于告诉攻击者"这个邮箱有一个正在生效的码"。
CODE_INVALID = "验证码无效或已过期"

# 验证码用途。存进 sliderule_email_code.purpose，验的时候必须对上（见模块说明）。
PURPOSE_REGISTER = "register"
PURPOSE_RESET = "reset"

# 邮箱不存在时用来空跑的假哈希，抹平时序差（见模块说明 ②）。
# 进程启动时算一次，值本身无意义。
_DUMMY_HASH: Optional[str] = None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = ident.hash_password(secrets.token_urlsafe(24))
    return _DUMMY_HASH


def _code_hash(email: str, code: str) -> str:
    """验证码按 HMAC 存，不存明文。

    库被读走时明文验证码等于现成的账号接管工具。用 HMAC 而不是裸 sha256 是为了
    绑定签名密钥——光有库拿不到可用的码。
    """
    from services.auth_tokens import auth_secret

    return hmac.new(
        auth_secret().encode(), f"{ident.normalize_email(email)}:{code}".encode(), hashlib.sha256
    ).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace(" ", "T"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


# ────────────────────────── 注册 ──────────────────────────


def start_registration(email: str, password: str) -> dict[str, Any]:
    """第一步：校验 + 发验证码。

    ⚠️ 邮箱**已注册**时也返回成功（不发码）。这是刻意的——否则这个接口就是一个
    用户枚举器：输入邮箱看返回，就知道谁注册过。代价是用户输错自己的邮箱时不会
    被提醒，但那可以在登录环节兜住。
    """
    email = ident.normalize_email(email)
    err = ident.validate_email(email)
    if err:
        return {"ok": False, "error": "invalid_email", "message": err}
    err = ident.validate_password(password)
    if err:
        return {"ok": False, "error": "weak_password", "message": err}

    store = ident.get_identity_store()
    existing = store.get_by_email(email)
    if existing is not None:
        # 不发码、不报错——与"码已发送"的响应保持一致
        return {"ok": True, "codeSent": False, "message": "验证码已发送，请查收邮件"}

    prior = store.get_code(email)
    if prior:
        sent = _parse_iso(prior.get("sent_at"))
        if sent and (_now() - sent).total_seconds() < ident.EMAIL_CODE_COOLDOWN_S:
            return {
                "ok": False,
                "error": "too_frequent",
                "message": f"请 {ident.EMAIL_CODE_COOLDOWN_S} 秒后再试",
            }

    code = ident.new_email_code()
    store.put_code(email, _code_hash(email, code), purpose=PURPOSE_REGISTER)
    try:
        delivered = _send_code_email(email, code)
    except Exception as exc:  # noqa: BLE001 — 投递失败要如实报，不能吞
        # 把刚存的码作废：留着的话用户会在"发送失败"之后仍有一个有效码在库里，
        # 而他并不知道码是多少——只会挡住重发（冷却期）而没有任何好处。
        store.drop_code(email)
        return {
            "ok": False,
            "error": "mail_failed",
            "message": f"验证码发送失败：{str(exc)[:160]}",
        }
    return {
        "ok": True,
        "codeSent": True,
        "message": "验证码已发送，请查收邮件",
        # 没配邮件服务时把码带回来，否则自部署的人第一步就卡死。
        # **配了就绝不外泄**；生产环境即使没配也不外泄（_dev_code_allowed）。
        **({"devCode": code} if (not delivered and _dev_code_allowed()) else {}),
    }


def _dev_code_allowed() -> bool:
    """没配邮件服务时能不能把验证码放进响应（devCode）。

    devCode 的本意是自部署第一步不卡死（没邮件服务照样能注册）。但这个
    便利只属于**非生产**：生产环境没配邮件属于配置错误，把码直接回给
    请求者等于任何人都能替任意邮箱注册/重置密码——验证码这道关等于拆掉。
    判据复用 settings.is_production（NODE_ENV / APP_ENV），2026-08-14 审计补。
    """
    try:
        from config.settings import settings

        return not settings.is_production
    except Exception:  # noqa: BLE001 — 判不出环境时按生产从严
        return False


def _code_invalid() -> dict[str, Any]:
    return {"ok": False, "error": "code_invalid", "message": CODE_INVALID}


def check_code(email: str, code: str, purpose: str) -> Optional[dict[str, Any]]:
    """验一个邮箱验证码。**通过返回 None**，不通过返回可直接外抛的错误字典。

    ⚠️ 通过时**不删码**。删码要等真正的副作用（建账号 / 改密码）落地之后：
    中途因为别的原因失败（比如新密码太短），码已经作废的话用户手里那封邮件
    就白收了，只能从头再走一遍。

    `purpose` 必须对上（见模块说明「验证码按用途隔离」）。用途不符时**不计
    失败次数**——那不是在猜码，而计数会让"往改密码接口丢一个注册码"成为
    作废他人验证码的廉价手段。
    """
    store = ident.get_identity_store()
    rec = store.get_code(email)
    if not rec:
        return _code_invalid()

    expires = _parse_iso(rec.get("expires_at"))
    if expires and _now() > expires:
        store.drop_code(email)
        return _code_invalid()

    if int(rec.get("attempts") or 0) >= ident.EMAIL_CODE_MAX_ATTEMPTS:
        store.drop_code(email)
        return _code_invalid()

    # 用途判定放在比对**之前**：这个码根本不是发给这条流程的，就不该顺带
    # 泄露"码本身对不对"
    if str(rec.get("purpose") or "") != purpose:
        return _code_invalid()

    # 定长比较，避免时序侧信道
    if not hmac.compare_digest(str(rec.get("code_hash") or ""), _code_hash(email, code or "")):
        store.bump_code_attempts(email)
        return _code_invalid()
    return None


def complete_registration(email: str, password: str, code: str) -> dict[str, Any]:
    """第二步：验码 + 建账号 + 直接发令牌（注册完即登录态）。"""
    email = ident.normalize_email(email)
    store = ident.get_identity_store()

    bad = check_code(email, code, PURPOSE_REGISTER)
    if bad:
        return bad

    err = ident.validate_password(password)
    if err:
        return {"ok": False, "error": "weak_password", "message": err}

    if store.get_by_email(email) is not None:
        store.drop_code(email)
        return {"ok": False, "error": "already_exists", "message": "该邮箱已注册，请直接登录"}

    # 库里一个用户都没有 → 这是自部署的第一个人，给超管（见模块说明 ③）
    first = store.count() == 0
    user = store.create(
        email,
        ident.hash_password(password),
        is_superuser=first,
        is_verified=True,  # 走完验证码即视为已验证
    )
    store.drop_code(email)
    # 注册完即登录态（发 cookie / token）。不戳 last_login_at 的话，管理台
    # 会把第一个超管显示成「从未登录」——人就在页面底下。
    store.touch_login(user.id)
    fresh = store.get_by_id(user.id) or user
    return {
        "ok": True,
        "user": fresh.public(),
        # 带上密码戳（pv）：改密码即全端失效，见 auth_tokens 模块头 ①
        "token": create_access_token(user.id, password_hash=str(user.get("password_hash") or "")),
        "isFirstSuperuser": first,
    }


# ────────────────────────── 登录 ──────────────────────────


def login(email: str, password: str) -> dict[str, Any]:
    email = ident.normalize_email(email)
    store = ident.get_identity_store()
    user = store.get_by_email(email)

    if user is None:
        # 空跑一次哈希，抹平"邮箱不存在"与"密码错误"的耗时差（见模块说明 ②）
        ident.verify_password(password or "", _dummy_hash())
        # ★ 见模块说明 ④：配了远端却落到空的兜底库，这时"查无此人"说明不了
        #   任何事——别把基础设施故障说成用户密码不对。
        degraded = ident.identity_backend_degraded()
        if degraded:
            print(f"[auth] 账号库降级中，登录按服务不可用回：{degraded[:160]}")
            return {
                "ok": False,
                "error": "identity_unavailable",
                "message": IDENTITY_UNAVAILABLE,
            }
        return {"ok": False, "error": "invalid_credentials", "message": LOGIN_FAILED}

    ok, upgraded = ident.verify_password(password or "", str(user.get("password_hash") or ""))
    if not ok:
        return {"ok": False, "error": "invalid_credentials", "message": LOGIN_FAILED}

    if not user.is_active:
        # 这个可以明说：账号确实存在且密码对，隐瞒没有意义，反而让人无从申诉
        return {"ok": False, "error": "inactive", "message": "账号已被停用"}

    if upgraded:
        # 旧算法的哈希在登录时自动升级到 Argon2，用户无感（对齐官方模板）
        store.set_password_hash(user.id, upgraded)

    store.touch_login(user.id)
    # 哈希可能刚被升级过（upgraded），戳要按**当前落库的**那份算，
    # 否则签出去的令牌下一秒就对不上自己
    current_hash = upgraded or str(user.get("password_hash") or "")
    return {
        "ok": True,
        "user": user.public(),
        "token": create_access_token(user.id, password_hash=current_hash),
    }


# ────────────────────────── 找回密码 ──────────────────────────
#
# 复用注册那套邮箱验证码（同一张表、同一个投递通道），只是 purpose 换成 reset。
# 不另起一套「重置令牌 + 带 token 的链接」是因为：那需要一个能承载链接的落地页、
# 一套独立的令牌生命周期，而验证码这条路已经跑通并且用户刚在注册时用过。
#
# ✅ 2026-08-04：**改密码现在会踢掉全部旧会话。**
#
# 这段原本写着"改密码不会踢掉已登录的会话……真要做到需要一张撤销表或者在 token
# 里带密码版本号"。后一条已经做了：令牌带 `pv` 密码戳（拿密码哈希再 HMAC 一次），
# 每次请求跟库里当前哈希重算比对，密码一改所有旧戳全部对不上。做法抄自 Django
# 的 `get_session_auth_hash`，理由与取舍见 services/auth_tokens 的模块头。

RESET_CODE_SENT = "验证码已发送，请查收邮件"


def start_password_reset(email: str) -> dict[str, Any]:
    """第一步：给这个邮箱发一个 purpose=reset 的验证码。

    ⚠️ 邮箱**没注册**时同样返回成功（不发码）——和 start_registration 那条
    "已注册也返回成功"是同一个道理的反面：如实回答就是一个用户枚举器。

    冷却期内也走**同一条成功出口**（不发新码、不报 too_frequent）。报错的话，
    "连点两次得到 too_frequent" 就成了"这个邮箱注册过"的探针——不存在的邮箱
    永远进不了冷却，因为它压根不会有码。这里的措辞不算撒谎：冷却 60 秒 < 验证码
    有效期 600 秒，用户收件箱里那个码此刻仍然有效。
    """
    email = ident.normalize_email(email)
    err = ident.validate_email(email)
    if err:
        # 这个可以如实报：它只说明输入不是个邮箱，跟"谁注册过"无关
        return {"ok": False, "error": "invalid_email", "message": err}

    store = ident.get_identity_store()
    user = store.get_by_email(email)
    if user is None or not user.is_active:
        return {"ok": True, "codeSent": False, "message": RESET_CODE_SENT}

    prior = store.get_code(email)
    if prior:
        sent = _parse_iso(prior.get("sent_at"))
        if sent and (_now() - sent).total_seconds() < ident.EMAIL_CODE_COOLDOWN_S:
            return {"ok": True, "codeSent": False, "message": RESET_CODE_SENT}

    code = ident.new_email_code()
    store.put_code(email, _code_hash(email, code), purpose=PURPOSE_RESET)
    try:
        delivered = _send_code_email(email, code)
    except Exception as exc:  # noqa: BLE001 — 投递失败要如实报，不能吞
        # 同 start_registration：作废刚存的码，否则用户手里没有码却被冷却挡住重发
        store.drop_code(email)
        return {
            "ok": False,
            "error": "mail_failed",
            "message": f"验证码发送失败：{str(exc)[:160]}",
        }
    return {
        "ok": True,
        "codeSent": True,
        "message": RESET_CODE_SENT,
        # 没配邮件服务时把码带回来（同注册）；生产环境一律不外泄
        **({"devCode": code} if (not delivered and _dev_code_allowed()) else {}),
    }


def complete_password_reset(email: str, code: str, password: str) -> dict[str, Any]:
    """第二步：验码 + 换密码 + 直接发令牌（改完即登录态，同注册）。"""
    email = ident.normalize_email(email)
    store = ident.get_identity_store()

    bad = check_code(email, code, PURPOSE_RESET)
    if bad:
        return bad

    err = ident.validate_password(password)
    if err:
        # 密码不合格**不删码**（见 check_code 的说明），用户改个密码就能继续
        return {"ok": False, "error": "weak_password", "message": err}

    user = store.get_by_email(email)
    if user is None or not user.is_active:
        # 发码之后账号被删/停用才会走到这——按码无效处理，别把账号状态说出去
        store.drop_code(email)
        return _code_invalid()

    new_hash = ident.hash_password(password)
    store.set_password_hash(user.id, new_hash)
    store.drop_code(email)
    store.touch_login(user.id)
    # 新令牌用**新哈希**算戳：旧密码派生的那些戳全部对不上，等于所有旧会话当场作废
    # ——这正是"密码被别人拿到了赶紧改"这个场景要的效果（见 auth_tokens 模块头 ①）。
    return {
        "ok": True,
        "user": user.public(),
        "token": create_access_token(user.id, password_hash=new_hash),
    }


# ────────────────────────── 邮件投递 ──────────────────────────


def _send_code_email(email: str, code: str) -> bool:
    """投递验证码。返回**是否真的发出去了**。

    见 services/mailer：console / smtp / resend 三种模式，环境变量与 Node 侧
    那套（server/auth/email-mailer.ts）同名，部署配一次两边都认。

    ⚠️ 返回 False（= 没真发）时上层会把验证码带回响应，这是给**没配邮件服务的
    自部署**用的，否则注册第一步就卡死。所以：**配了服务商却投递失败时必须抛，
    不能返回 False**——那会把验证码公开，比没配服务商更糟。mailer.send_login_code
    已经保证了这个契约，这里只负责不把异常吞掉。
    """
    from services.mailer import MailerError, send_login_code

    try:
        return send_login_code(email, code, expires_minutes=ident.EMAIL_CODE_TTL_S // 60)
    except MailerError:
        raise
