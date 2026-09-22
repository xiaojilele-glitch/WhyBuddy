"""用户身份存储（2026-08-02）。

## 设计取向

参照 **fastapi/full-stack-fastapi-template**（MIT，官方模板）和
**fastapi-users**（MIT）——这两个是 FastAPI 生态里最成熟的两套，本模块逐条对齐
它们的关键决定，而不是自己发明：

  · 密码哈希用 **pwdlib 的 Argon2**，并保留 Bcrypt 校验能力。
    模板的写法是 `PasswordHash((Argon2Hasher(), BcryptHasher()))`
    （backend/app/core/security.py:11），第一个是**写**用的算法，其余仅用于
    **验**旧哈希。fastapi-users 2026 年也把默认从 bcrypt 换成了 Argon2。
    Argon2 是内存硬的，抗 GPU 爆破，是当前的推荐算法。

  · 登录时 `verify_and_update` 返回 `(是否通过, 新哈希或None)`，旧算法的哈希
    在用户下次登录时**自动升级**（模板 security.py:29）。加密算法换代不用
    强制所有人改密码——这个细节自己写很容易漏。

  · 用户表带 `is_active` / `is_superuser` / `is_verified` 三个布尔位。
    这是两个项目共同的最小集，够表达你要的三档（匿名 / 登录用户 / 超管）。

## 为什么不直接用 fastapi-users

它把「用户模型 + 数据库适配器 + 认证后端 + 路由」整套绑在一起，要求用
SQLAlchemy 的 declarative 模型和它的 UserManager 生命周期。而这边的存储有一条
特殊要求：**必须能走 Neon SQL over HTTP**（受限网络只放行 443，见
services/session_blob_store 的说明），那条通道不是 SQLAlchemy 能覆盖的。

所以这里只借它的**判定逻辑与算法选择**，存储沿用本项目已经验证过的那套降级链。
接口保持得足够薄，将来真要换成 fastapi-users 也只需换掉这一层。

## 存哪

与应用记录、会话同一个库（`APP_STORE_DATABASE_URL`）。归属校验要和数据在同一个
库里才有意义——跨库校验既慢又会在库不一致时给出错误答案。

没配连接串时落本地 SQLite，行为一致，只是不跨机器共享。
"""

from __future__ import annotations

import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

TABLE = "sliderule_user"

# 邮箱验证码有效期。取 10 分钟：够慢的人打开邮箱，又不给撞库留太长窗口。
EMAIL_CODE_TTL_S = 600
# 同一邮箱两次发码的最小间隔，挡住"点一次发一封"的骚扰与短信/邮件账单。
EMAIL_CODE_COOLDOWN_S = 60
# 一个验证码最多试几次，超了作废——防止 6 位数字被在线爆破。
EMAIL_CODE_MAX_ATTEMPTS = 5

_MIN_PASSWORD_LEN = 8

#: update_profile 用：没出现在调用里的字段不要动。
_UNSET = object()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


# ────────────────────────── 密码哈希 ──────────────────────────

_hasher_lock = threading.Lock()
_hasher: Any = None


def _password_hasher():
    """Argon2 优先、Bcrypt 仅用于验旧哈希（对齐官方模板 security.py:11）。

    pwdlib 装不上时**直接抛**，不做降级——密码哈希没有"弱一点也能用"的选项。
    这跟本项目其他地方的 fail-open 取向不同，是刻意的：缩略图压不动只是浪费带宽，
    密码哈希降级是把所有人的密码置于风险中。
    """
    global _hasher
    with _hasher_lock:
        if _hasher is not None:
            return _hasher
        from pwdlib import PasswordHash
        from pwdlib.hashers.argon2 import Argon2Hasher

        hashers = [Argon2Hasher()]
        try:
            from pwdlib.hashers.bcrypt import BcryptHasher

            hashers.append(BcryptHasher())  # 只用于校验历史哈希，不用于新写入
        except Exception:  # noqa: BLE001 — 没有 bcrypt 也能跑，只是验不了旧哈希
            pass
        _hasher = PasswordHash(tuple(hashers))
        return _hasher


def hash_password(password: str) -> str:
    return _password_hasher().hash(password)


# Node 侧遗留账号体系的哈希格式（server/auth/password.ts:10）：
#     scrypt:{saltHex}:{derivedHex}
# 注意两个容易写错的地方：
#   ① Node 的 `scrypt(password, salt, 64)` 把 salt 当**字符串**用，所以盐是那串
#      十六进制的 ASCII 字节，不是解码后的 16 字节；
#   ② Node 的默认参数是 N=16384, r=8, p=1，dklen 由第三参给定（这里 64）。
# 任何一处不一致都会全部验不过，而表现是"所有老用户密码都错"——很难往这想。
_NODE_SCRYPT_N = 16384
_NODE_SCRYPT_R = 8
_NODE_SCRYPT_P = 1


def _verify_node_scrypt(password: str, stored: str) -> bool:
    """验 Node 遗留的 scrypt 哈希。用于把老账号迁过来而不强制改密码。"""
    import hashlib as _h
    import hmac as _hm

    parts = stored.split(":")
    if len(parts) != 3 or parts[0] != "scrypt" or not parts[1] or not parts[2]:
        return False
    _, salt_hex, hash_hex = parts
    try:
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    try:
        actual = _h.scrypt(
            (password or "").encode(),
            salt=salt_hex.encode(),  # ① 十六进制串本身当盐
            n=_NODE_SCRYPT_N,
            r=_NODE_SCRYPT_R,
            p=_NODE_SCRYPT_P,
            dklen=len(expected),
            maxmem=64 * 1024 * 1024,  # Node 默认 32MB 上限，给足余量
        )
    except (ValueError, MemoryError):
        return False
    return _hm.compare_digest(actual, expected)  # 定长比较，不给时序侧信道


def verify_password(password: str, stored: str) -> tuple[bool, Optional[str]]:
    """返回 (是否通过, 需要写回的新哈希或 None)。

    第二个返回值是**算法升级**用的：旧哈希验过之后给出一个 Argon2 的新哈希，
    调用方写回去即可。用户无感，不用强制改密码——这正是官方模板
    `verify_and_update` 的用途（security.py:29）。

    除 pwdlib 支持的算法外，额外认 Node 侧遗留的 scrypt 格式，让现有账号体系
    （server/auth/password.ts）里的用户可以直接迁过来。
    """
    stored = stored or ""
    if stored.startswith("scrypt:"):
        if _verify_node_scrypt(password, stored):
            return (True, hash_password(password))  # 就地升级成 Argon2
        return (False, None)
    try:
        return _password_hasher().verify_and_update(password, stored)
    except Exception:  # noqa: BLE001 — 哈希串损坏/算法未知一律判失败
        return (False, None)


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(email: str) -> str:
    """统一小写去空白。

    不做 gmail 的 dot/plus 归一化——那是各家邮箱自己的规则，替用户"聪明"地
    合并地址会让两个本来不同的账号撞在一起。
    """
    return (email or "").strip().lower()


def validate_email(email: str) -> Optional[str]:
    if not email:
        return "邮箱不能为空"
    if len(email) > 254:  # RFC 5321
        return "邮箱过长"
    if not _EMAIL_RE.match(email):
        return "邮箱格式不正确"
    return None


def validate_password(password: str) -> Optional[str]:
    """只卡长度，不卡"必须含大写/数字/符号"。

    NIST SP 800-63B 明确建议**不要**强制复合字符规则——它促使用户造出
    `Passw0rd!` 这类可预测的密码，实测效果不如单纯要求长度。
    """
    if not isinstance(password, str) or len(password) < _MIN_PASSWORD_LEN:
        return f"密码至少 {_MIN_PASSWORD_LEN} 位"
    if len(password) > 128:
        return "密码过长（最多 128 位）"  # 防 Argon2 被超长输入拖慢
    return None


def new_email_code() -> str:
    """6 位数字验证码，用 secrets 而不是 random——后者可预测。"""
    return f"{secrets.randbelow(1_000_000):06d}"


def _public_time(value: Any) -> Optional[str]:
    """身份库三种后端吐出来的时间可能是 datetime / 字符串 / None。对外一律 ISO。"""
    if value is None:
        return None
    if hasattr(value, "isoformat") and not isinstance(value, (str, bytes)):
        try:
            return value.isoformat()
        except Exception:  # noqa: BLE001
            return None
    text = str(value).strip()
    return text or None


# ────────────────────────── 存储 ──────────────────────────

_DDL_PG = f"""
create table if not exists {TABLE} (
    id varchar(64) primary key,
    email varchar(254) not null unique,
    password_hash text not null,
    is_active boolean not null default true,
    is_superuser boolean not null default false,
    is_verified boolean not null default false,
    display_name varchar(120),
    avatar_url text,
    created_at timestamptz,
    last_login_at timestamptz
)
"""

_DDL_SQLITE = f"""
create table if not exists {TABLE} (
    id varchar(64) primary key,
    email varchar(254) not null unique,
    password_hash text not null,
    is_active integer not null default 1,
    is_superuser integer not null default 0,
    is_verified integer not null default 0,
    display_name varchar(120),
    avatar_url text,
    created_at text,
    last_login_at text
)
"""

_CODE_TABLE = "sliderule_email_code"

_CODE_DDL_PG = f"""
create table if not exists {_CODE_TABLE} (
    email varchar(254) primary key,
    code_hash text not null,
    purpose varchar(32) not null,
    attempts integer not null default 0,
    sent_at timestamptz,
    expires_at timestamptz
)
"""

_CODE_DDL_SQLITE = f"""
create table if not exists {_CODE_TABLE} (
    email varchar(254) primary key,
    code_hash text not null,
    purpose varchar(32) not null,
    attempts integer not null default 0,
    sent_at text,
    expires_at text
)
"""

# ── 令牌撤销表（2026-08-04）───────────────────────────────────────
#
# 抄 fastapi-users `authentication/strategy/db/strategy.py` 的取向：**能撤销的
# 前提是服务端记账**。但我们不像它那样把整张令牌存下来（那等于换成不透明令牌，
# 要动每条路由和 Node 那层桥），只记**被撤销的 jti**——黑名单而不是白名单。
#
# 代价与收益：
#   · 白名单（存全部有效令牌）：登出即删行，表大小 = 活跃会话数；但每次签发都要写库。
#   · 黑名单（只存撤销的）：签发零写库，只有登出才写；表大小 = 未过期的已登出令牌数。
#
# 我们选黑名单，因为签发远多于登出。`expires_at` 存的是**原令牌自己的过期时间**：
# 过了那个点令牌本来就无效了，撤销记录再留着没有意义，可以直接删（见 purge_revoked）。
_REVOKE_TABLE = "sliderule_revoked_token"

_REVOKE_DDL_PG = f"""
create table if not exists {_REVOKE_TABLE} (
    jti varchar(64) primary key,
    user_id varchar(64),
    expires_at timestamptz,
    revoked_at timestamptz
)
"""

_REVOKE_DDL_SQLITE = f"""
create table if not exists {_REVOKE_TABLE} (
    jti varchar(64) primary key,
    user_id varchar(64),
    expires_at text,
    revoked_at text
)
"""


class User(dict):
    """用户记录。用 dict 子类而不是 pydantic 模型——这一层要能被三种后端
    （SQLAlchemy / Neon HTTP / SQLite）用同一份代码产出，dict 最省事。"""

    @property
    def id(self) -> str:
        return str(self.get("id") or "")

    @property
    def email(self) -> str:
        return str(self.get("email") or "")

    @property
    def is_active(self) -> bool:
        return bool(self.get("is_active"))

    @property
    def is_superuser(self) -> bool:
        return bool(self.get("is_superuser"))

    @property
    def is_verified(self) -> bool:
        return bool(self.get("is_verified"))

    def raw_avatar(self) -> str:
        """库里存的那一份（data URL 原文）。**只给取图路由用**，不进任何载荷。"""
        avatar = self.get("avatar_url")
        if avatar is None:
            avatar = self.get("avatarUrl")
        return str(avatar).strip() if avatar else ""

    def avatar_tag(self) -> str:
        """头像的缓存版本位。内容一变它就变，immutable 才敢用。

        取内容哈希而不是时间戳：三个后端存的时刻字段形态不一，而哈希只依赖
        这一列本身。截断到 12 位十六进制——它只当缓存键，不做完整性校验。
        """
        raw = self.raw_avatar()
        if not raw:
            return ""
        import hashlib

        return hashlib.sha256(raw.encode("utf-8", "ignore")).hexdigest()[:12]

    def public(self) -> dict[str, Any]:
        """对外可见的字段。**password_hash 永远不出现在这里**。

        ⚠ 2026-08-23：`avatarUrl` 从"库里那份 data URL 原文"改成**取图地址**。
        原来是把整张图内联在这里，实测 `GET /account/me` 一次 169 KB，其中
        168,972 字节是 avatarUrl，其余所有字段加起来约 130 字节；而 /me 每次
        进页面都打、还不可强缓存。管理台用户列表更糟——一次列 N 个用户就是
        N 张整图。

        这跟本仓已经写死的另一条纪律是同一件事，只是当时没管到身份这边：
        应用摘要**不许带图**（services/app_store 的 _summary，判据见
        tests/test_app_preview.py::test_preview_never_rides_along_in_listings，
        理由原文"一张图约 1MB，列 200 个应用就是 200MB 过网"）。
        现在两边形状对齐：载荷里只给地址 + 版本位，图本体走独立路由 + immutable
        强缓存（见 routes/account.py 的 get_user_avatar）。

        没有头像仍然是 None——前端据此画首字母块，别给一个会 404 的地址。
        """
        tag = self.avatar_tag()
        return {
            "id": self.id,
            "email": self.email,
            "displayName": self.get("display_name") or self.get("displayName"),
            "avatarUrl": (
                f"/api/sliderule/account/avatar/{self.id}?v={tag}" if tag else None
            ),
            "isSuperuser": self.is_superuser,
            "isVerified": self.is_verified,
            "isActive": self.is_active,
            "createdAt": _public_time(self.get("created_at") or self.get("createdAt")),
            "lastLoginAt": _public_time(self.get("last_login_at") or self.get("lastLoginAt")),
        }


#: 鉴权路径上 get_by_id 的缓存存活时间（秒）。**用户 2026-08-24 定的 5 秒。**
#
# ## 为什么要缓存
#
# 真机（HTTPS SQL 网关）：不鉴权的 /health 4ms，只鉴权什么都不干的
# /account/me 340ms。拆开是两次串行查库，并发之后仍有 get_by_id 的 180ms，
# 而**每一个登录请求**都要付它。工作台首屏那十几个请求条条在付。
#
# ## 为什么 5 秒不是随便挑的，改它要连同这段一起想
#
# 缓存的是 ② 账号还在、还活着 和 ③ 密码戳要用的 password_hash。也就是说：
#
#     改密码 / 停用账号 → 最长 5 秒后生效（而不是立刻）
#
# 2026-08-04 加 ③ 的全部理由就是"改了密码，旧令牌全灭"，所以这个窗口是
# **实实在在的让步**，不是免费的。5 秒是用户拍的：人改完密码再点两下也不止
# 5 秒，视觉上无损；60 秒就不该接受了（登出后一分钟旧标签页还能用）。
#
# ⚠ 三条配套设计，缺一条这个让步就不成立：
#   ① **撤销名单不缓存**。登出走的是 jti 撤销，每次请求实查，所以登出**立刻**
#      生效——最要紧的那把刀没有钝。
#   ② **任何一次写都全表失效**（见 _InvalidatingExecutor）。同进程里改密码/
#      停用是立刻生效的，5 秒只是多进程/多实例下的上界。
#   ③ 只在**鉴权路径**用（get_by_id_for_auth）。管理台、账号接口照旧走
#      get_by_id 实查，看到的永远是真值。
AUTH_CACHE_TTL_S = 5.0

_AUTH_CACHE: dict[str, tuple[float, Any]] = {}
#: 撤销名单的缓存（2026-08-24 第二步，用户定的同样 5 秒）。
#
# is_token_revoked 的头注早就写着"真成为瓶颈时该加的是缓存（撤销是低频写、
# 判定是高频读，很适合缓存），而不是把这道检查去掉"——这就是那一步。
#
# ⚠ 加它之前，身份缓存那套让步之所以成立，靠的正是"登出走 jti 撤销、每次实查、
#   **立刻**生效"。现在这条也缓存了，那个理由换成了下面这条：
#
#     同进程登出仍然**当场**生效（revoke_token 走 executor.execute → 全清），
#     5 秒只是多进程/多实例下的上界。
#
#   两个缓存共用一次失效，所以这个性质对两者同时成立。要是哪天把失效从
#   executor 挪回写方法，塌的是**两条**，不是一条。
_REVOKE_CACHE: dict[str, tuple[float, bool]] = {}
_AUTH_CACHE_LOCK = threading.Lock()
#: 缓存条数上限。超了就整个清空——这是个 5 秒窗口的加速器，不是要维护 LRU。
_AUTH_CACHE_MAX = 4096


def invalidate_auth_cache(user_id: Optional[str] = None) -> None:
    """清掉鉴权缓存（身份 + 撤销名单）。不传 user_id 就全清。

    ⚠ 传了 user_id 也**照样全清撤销名单**：撤销记录是按 jti 存的，从 user_id
      推不出他有哪些 jti。宁可多清——over-invalidate 只是下次多查一次库，
      under-invalidate 是登出的人还能用 5 秒。
    """
    with _AUTH_CACHE_LOCK:
        if user_id is None:
            _AUTH_CACHE.clear()
        else:
            _AUTH_CACHE.pop(str(user_id), None)
        _REVOKE_CACHE.clear()


def _auth_cache_size() -> int:
    """测试用。"""
    with _AUTH_CACHE_LOCK:
        return len(_AUTH_CACHE) + len(_REVOKE_CACHE)


class _InvalidatingExecutor:
    """包一层执行器：**任何一次 execute 都把鉴权缓存全清**。

    ## 为什么挂在这儿，而不是在四个写方法里各清一次

    set_password_hash / set_active / set_superuser / update_profile 现在是四个，
    以后还会有第五个。挂在写方法上就得指望每个新写方法的作者记得加一行——
    本仓第四条（同一件事两处实现，改一处就静默失效）说的正是这种。所有写都
    必然经过 executor.execute，挂在这里**漏不掉**。

    多清几次没有代价：over-invalidate 的后果只是下一个请求多查一次库，
    而 under-invalidate 的后果是停用的账号还能用 5 秒。宁可多清。

    query 不拦——读不改变任何东西。其余属性（ph 等）透传。

    ⚠ 组件预设库复用同一个执行器（component_preset_store 拿的就是 ident._x），
      所以写预设也会清一次鉴权缓存。预设写得极少，代价是下一个请求多查一次库，
      不值得为它另开一条通道。

    ⚠ 有判据靠 `isinstance(store._x, _HttpApiExecutor)` 认通道
      （test_all_stores_via_http_gateway）。包这一层之后要先剥壳再判，那边已经
      改成 `getattr(store._x, "_inner", store._x)`。
    """

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def execute(self, sql: str, params: Optional[list[Any]] = None) -> None:
        try:
            return self._inner.execute(sql, params)
        finally:
            invalidate_auth_cache()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


class IdentityStore:
    """身份存储。三种后端共用这一个类，差异只在 `_q` 怎么执行 SQL。"""

    def __init__(
        self,
        executor: Any,
        *,
        is_sqlite: bool,
        degraded_from: str = "",
    ) -> None:
        # 包一层：任何一次写都清鉴权缓存（见 _InvalidatingExecutor 的说明）。
        self._x = _InvalidatingExecutor(executor)
        self._is_sqlite = is_sqlite
        #: 非空 = **配了远端但没连上，这是个兜底的空库**。值是那句降级原因。
        #:
        #: ⚠ 2026-09-05 真机：代理端口换了，容器里所有出站 HTTPS 变成
        #:   `Connection refused`，身份存储静静降级到本地 SQLite——那个库里
        #:   一个用户都没有。于是真实存在的账号登录时被告知
        #:   **「邮箱或密码不正确」**。用户会去改密码，改到的是那个空库；
        #:   网关一恢复，一切照旧，什么线索都不留。
        #:
        #:   这跟同一天修的「网关连不上时别把锅甩给用户」是**同一个形状的另一扇门**：
        #:   基础设施出不去，话术却在说人做错了事。
        self.degraded_from = degraded_from
        self._x.execute(_DDL_SQLITE if is_sqlite else _DDL_PG)
        self._x.execute(_CODE_DDL_SQLITE if is_sqlite else _CODE_DDL_PG)
        self._x.execute(_REVOKE_DDL_SQLITE if is_sqlite else _REVOKE_DDL_PG)
        self._ensure_profile_columns()

    def _ensure_profile_columns(self) -> None:
        """老表就地补头像列和 last_login_at。create table if not exists 对已有表一列都不加。

        增强类：补列失败不许拖垮登录。列已存在时 SQLite 会抛，Postgres
        走 if not exists。
        """
        extra = (
            [
                f"alter table {TABLE} add column avatar_url text",
                f"alter table {TABLE} add column last_login_at text",
            ]
            if self._is_sqlite
            else [
                f"alter table {TABLE} add column if not exists avatar_url text",
                f"alter table {TABLE} add column if not exists last_login_at timestamptz",
            ]
        )
        for sql in extra:
            try:
                self._x.execute(sql)
            except Exception:  # noqa: BLE001 — 列已存在 / 网关不认 IF NOT EXISTS
                pass

    # ── 用户 ──────────────────────────────────────────
    def get_by_email(self, email: str) -> Optional[User]:
        rows = self._x.query(
            f"select * from {TABLE} where email = {self._x.ph(1)}", [normalize_email(email)]
        )
        return User(rows[0]) if rows else None

    def get_by_id(self, user_id: str) -> Optional[User]:
        rows = self._x.query(f"select * from {TABLE} where id = {self._x.ph(1)}", [user_id])
        return User(rows[0]) if rows else None

    def get_by_id_for_auth(self, user_id: str) -> Optional[User]:
        """鉴权路径专用：带 AUTH_CACHE_TTL_S 秒 TTL 的 get_by_id。

        取舍、为什么是 5 秒、以及那三条配套设计，全写在 AUTH_CACHE_TTL_S 的
        注释里，改之前先读完。

        ⚠ **只给 optional_user 用**。管理台、账号接口照旧调 get_by_id ——
          那些地方读到 5 秒前的值就是 bug（改完昵称刷新还是旧的）。

        ⚠ 查库失败**不缓存**：异常照常抛给调用方（那边 fail-closed 成匿名）。
          把失败缓存 5 秒等于一次网络抖动让人掉线 5 秒。

        ⚠ **空结果同样不缓存**（2026-09-16 补）。原来这条只覆盖「抛异常」，
          而远程 SQL 网关抖一下回的是「0 行」，不是异常——缓存下来 5 秒内
          这个 id 一律查不到，下游把它判成账号被吊销。详见下面实现处的注释。
        """
        key = str(user_id or "")
        if not key:
            return None
        now = time.monotonic()
        with _AUTH_CACHE_LOCK:
            hit = _AUTH_CACHE.get(key)
            if hit is not None and now - hit[0] < AUTH_CACHE_TTL_S:
                cached = hit[1]
                # 回一份拷贝：缓存里那个对象会被很多请求同时拿到，谁顺手改一下
                # 就串到别人身上了。User 是个小 dict，拷贝可以忽略不计。
                return User(cached) if cached is not None else None
        user = self.get_by_id(key)
        if user is None:
            # ⚠ 2026-09-16：空结果**不进缓存**。上面那条「查库失败不缓存」只挡住了
            #   抛异常那条路，而身份存储是远程 HTTPS SQL 网关——它抖一下回「0 行」
            #   不是异常。缓存下来就是：这 5 秒里这个 id 一律「查不到」，
            #   而 project_actor_access.authorize_project_actor 把「查不到」判成
            #   **账号被吊销**，正在跑的工程被当场掐掉（真机 sr-20260916212612
            #   就是这么死的，账号一秒都没被停用过）。
            #
            #   代价只有「不存在的 id 每次都实查一次」——那本来就不该走缓存加速，
            #   而且鉴权路径上的 id 来自已签发的凭据，正常情况下都存在。
            return None
        with _AUTH_CACHE_LOCK:
            # 满了整个清空——这是 5 秒窗口的加速器，不值得维护 LRU。
            if len(_AUTH_CACHE) >= _AUTH_CACHE_MAX:
                _AUTH_CACHE.clear()
            _AUTH_CACHE[key] = (now, User(user))
        return user

    def list_users(self, limit: int = 500) -> list[User]:
        """全量用户，新的在前。给管理台用。

        limit 直接内联进 SQL 而不走占位符——三种后端对 LIMIT 参数化的支持不一致
        （Neon HTTP 端点尤其挑），而 `int()` 已经杜绝了注入。
        """
        rows = self._x.query(
            f"select * from {TABLE} order by created_at desc limit {int(limit)}", []
        )
        return [User(row) for row in rows]

    def count(self) -> int:
        rows = self._x.query(f"select count(*) as n from {TABLE}", [])
        # ⚠️ Neon HTTP 端点对 count(*)（int8）返回的是**字符串**，必须显式转
        # （见 app_store._neon_normalize_row 里对真库逐类型的实测说明）。
        return int(rows[0]["n"]) if rows else 0

    def create(
        self,
        email: str,
        password_hash: str,
        *,
        is_superuser: bool = False,
        is_verified: bool = False,
        display_name: Optional[str] = None,
    ) -> User:
        uid = secrets.token_urlsafe(16)
        p = self._x.ph
        self._x.execute(
            f"insert into {TABLE} (id, email, password_hash, is_active, is_superuser,"
            f" is_verified, display_name, created_at)"
            f" values ({p(1)},{p(2)},{p(3)},{p(4)},{p(5)},{p(6)},{p(7)},{p(8)})",
            [
                uid,
                normalize_email(email),
                password_hash,
                True,
                is_superuser,
                is_verified,
                display_name,
                _now_iso(),
            ],
        )
        created = self.get_by_id(uid)
        assert created is not None
        return created

    def set_password_hash(self, user_id: str, password_hash: str) -> None:
        p = self._x.ph
        self._x.execute(
            f"update {TABLE} set password_hash = {p(1)} where id = {p(2)}",
            [password_hash, user_id],
        )

    def mark_verified(self, user_id: str) -> None:
        p = self._x.ph
        self._x.execute(
            f"update {TABLE} set is_verified = {p(1)} where id = {p(2)}", [True, user_id]
        )

    def touch_login(self, user_id: str) -> None:
        p = self._x.ph
        self._x.execute(
            f"update {TABLE} set last_login_at = {p(1)} where id = {p(2)}",
            [_now_iso(), user_id],
        )

    def set_superuser(self, user_id: str, value: bool) -> None:
        p = self._x.ph
        self._x.execute(
            f"update {TABLE} set is_superuser = {p(1)} where id = {p(2)}", [value, user_id]
        )

    def set_active(self, user_id: str, value: bool) -> Optional[User]:
        """停用 / 恢复登录。对照 Gitea `ProhibitLogin` / `Activate`：不删行。

        登录链路已经拒 `is_active=false`（auth_service.login）。这里只翻位。
        """
        uid = str(user_id or "").strip()
        if not uid:
            return None
        p = self._x.ph
        self._x.execute(
            f"update {TABLE} set is_active = {p(1)} where id = {p(2)}",
            [bool(value), uid],
        )
        return self.get_by_id(uid)

    def update_profile(
        self,
        user_id: str,
        *,
        display_name: Any = _UNSET,
        avatar_url: Any = _UNSET,
    ) -> Optional[User]:
        """改昵称 / 头像。没传的字段保持原值。

        头像存 data URL（JPG/PNG/GIF/WebP，上限见路由校验）。空串/None 表示清掉。
        """
        uid = str(user_id or "").strip()
        if not uid:
            return None
        assignments: list[str] = []
        params: list[Any] = []
        p = self._x.ph
        if display_name is not _UNSET:
            assignments.append(f"display_name = {p(len(params) + 1)}")
            params.append(display_name)
        if avatar_url is not _UNSET:
            assignments.append(f"avatar_url = {p(len(params) + 1)}")
            params.append(avatar_url)
        if assignments:
            params.append(uid)
            self._x.execute(
                f"update {TABLE} set {', '.join(assignments)} where id = {p(len(params))}",
                params,
            )
        return self.get_by_id(uid)

    # ── 邮箱验证码 ────────────────────────────────────
    def put_code(self, email: str, code_hash: str, purpose: str) -> None:
        """一个邮箱同一时刻只保留一个有效码（主键是 email，直接覆盖）。

        这样"重发"天然作废旧码，不会出现多个码同时有效——那是常见的实现漏洞。
        """
        p = self._x.ph
        email = normalize_email(email)
        now = _now()
        expires = datetime.fromtimestamp(now.timestamp() + EMAIL_CODE_TTL_S, tz=timezone.utc)
        self._x.execute(f"delete from {_CODE_TABLE} where email = {p(1)}", [email])
        self._x.execute(
            f"insert into {_CODE_TABLE} (email, code_hash, purpose, attempts, sent_at, expires_at)"
            f" values ({p(1)},{p(2)},{p(3)},0,{p(4)},{p(5)})",
            [email, code_hash, purpose, now.isoformat(), expires.isoformat()],
        )

    def get_code(self, email: str) -> Optional[dict[str, Any]]:
        rows = self._x.query(
            f"select * from {_CODE_TABLE} where email = {self._x.ph(1)}",
            [normalize_email(email)],
        )
        return rows[0] if rows else None

    def bump_code_attempts(self, email: str) -> int:
        p = self._x.ph
        self._x.execute(
            f"update {_CODE_TABLE} set attempts = attempts + 1 where email = {p(1)}",
            [normalize_email(email)],
        )
        rec = self.get_code(email)
        return int(rec["attempts"]) if rec else 0

    def drop_code(self, email: str) -> None:
        self._x.execute(
            f"delete from {_CODE_TABLE} where email = {self._x.ph(1)}", [normalize_email(email)]
        )

    # ── 令牌撤销 ──────────────────────────────────────
    def revoke_token(self, jti: str, *, user_id: str = "", expires_at: Any = None) -> None:
        """把一个 jti 记进黑名单（登出）。

        重复登出同一张令牌是正常的（多标签页各点一次），所以**先删后插**而不是
        直接插——主键冲突会抛，而"已经撤销过了"根本不是错误。
        """
        jti = (jti or "").strip()
        if not jti:
            return
        p = self._x.ph
        exp = expires_at if isinstance(expires_at, str) else (
            expires_at.isoformat() if isinstance(expires_at, datetime) else None
        )
        self._x.execute(f"delete from {_REVOKE_TABLE} where jti = {p(1)}", [jti])
        self._x.execute(
            f"insert into {_REVOKE_TABLE} (jti, user_id, expires_at, revoked_at)"
            f" values ({p(1)},{p(2)},{p(3)},{p(4)})",
            [jti, user_id or None, exp, _now_iso()],
        )

    def is_token_revoked(self, jti: str) -> bool:
        """这张令牌被撤销了吗。

        ⚠️ 这是**每个已登录请求都会走**的一次查询。真成为瓶颈时该加的是缓存
        （撤销是低频写、判定是高频读，很适合缓存），而不是把这道检查去掉。
        """
        jti = (jti or "").strip()
        if not jti:
            return False
        rows = self._x.query(
            f"select jti from {_REVOKE_TABLE} where jti = {self._x.ph(1)}", [jti]
        )
        return bool(rows)

    def is_token_revoked_for_auth(self, jti: str) -> bool:
        """鉴权路径专用：带 AUTH_CACHE_TTL_S 秒 TTL 的 is_token_revoked。

        与 get_by_id_for_auth 同一套设计、同一个 TTL、同一次失效，取舍写在
        AUTH_CACHE_TTL_S 和 _REVOKE_CACHE 的注释里，改之前先读完。

        ⚠ **只给 optional_user 用**。裸的 is_token_revoked 保持每次实查——
          判据、管理台、清理任务读到 5 秒前的值就是 bug。

        ⚠ 查库失败**不缓存**：异常照常抛给调用方（那边 fail-open 成放行）。
          把失败缓存 5 秒，等于一次抖动让撤销检查停摆 5 秒。
        """
        key = (jti or "").strip()
        if not key:
            return False
        now = time.monotonic()
        with _AUTH_CACHE_LOCK:
            hit = _REVOKE_CACHE.get(key)
            if hit is not None and now - hit[0] < AUTH_CACHE_TTL_S:
                return hit[1]
        revoked = self.is_token_revoked(key)
        with _AUTH_CACHE_LOCK:
            if len(_REVOKE_CACHE) >= _AUTH_CACHE_MAX:
                _REVOKE_CACHE.clear()
            _REVOKE_CACHE[key] = (now, revoked)
        return revoked

    def purge_revoked(self) -> int:
        """清掉已经自然过期的撤销记录。

        令牌自己过期之后，它在不在黑名单里都一样无效——记录留着只占地方。
        `expires_at` 为空的（理论上不该有）一律保留：宁可多留几行，
        也不要因为一个空值把还该生效的撤销记录删掉。
        """
        rows = self._x.query(
            f"select jti, expires_at from {_REVOKE_TABLE}", []
        )
        now = _now()
        stale = []
        for r in rows:
            exp = r.get("expires_at")
            if not exp:
                continue
            try:
                dt = exp if isinstance(exp, datetime) else datetime.fromisoformat(
                    str(exp).replace(" ", "T")
                )
            except ValueError:
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt < now:
                stale.append(str(r.get("jti")))
        for jti in stale:
            self._x.execute(f"delete from {_REVOKE_TABLE} where jti = {self._x.ph(1)}", [jti])
        return len(stale)


# ────────────────────────── 执行器：三种后端 ──────────────────────────


class _SqlExecutor:
    """SQLAlchemy 执行器（Postgres / SQLite）。"""

    def __init__(self, url: str) -> None:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool

        from .sql_gateway import _sql_engine_config, configure_sqlite_journal

        self._text = text
        # 跟 app_store 保持一致：生产配置常写 postgresql://...，但本镜像依赖的是
        # psycopg v3，不是 psycopg2。SQLAlchemy 裸 postgresql:// 会去找 psycopg2，
        # 然后身份库悄悄降级到本地 SQLite。
        url = re.sub(r"^postgresql://", "postgresql+psycopg://", url)
        connect_args, kwargs = _sql_engine_config(url, NullPool)
        self._engine = create_engine(url, connect_args=connect_args, **kwargs)
        configure_sqlite_journal(self._engine)
        self.is_sqlite = url.startswith("sqlite")

    def ph(self, n: int) -> str:
        return f":p{n}"

    def _bind(self, params: list[Any]) -> dict[str, Any]:
        return {f"p{i + 1}": v for i, v in enumerate(params)}

    def query(self, sql: str, params: list[Any]) -> list[dict[str, Any]]:
        with self._engine.connect() as conn:
            rows = conn.execute(self._text(sql), self._bind(params)).mappings().all()
        return [dict(r) for r in rows]

    def execute(self, sql: str, params: Optional[list[Any]] = None) -> None:
        with self._engine.begin() as conn:
            conn.execute(self._text(sql), self._bind(params or []))


class _NeonHttpExecutor:
    """Neon SQL-over-HTTP 执行器。受限网络只放行 443 时的通道。"""

    def __init__(self, database_url: str, endpoint: str) -> None:
        import httpx

        self.is_sqlite = False
        self._endpoint = endpoint
        self._client = httpx.Client(
            timeout=15,
            headers={
                "Neon-Connection-String": database_url,  # 凭据只在头里，不进日志
                "Content-Type": "application/json",
            },
        )

    def ph(self, n: int) -> str:
        return f"${n}"

    def query(self, sql: str, params: list[Any]) -> list[dict[str, Any]]:
        from .sql_gateway import _neon_http_error

        resp = self._client.post(self._endpoint, json={"query": sql, "params": params})
        if resp.status_code >= 400:
            raise _neon_http_error(resp)
        return resp.json().get("rows") or []

    def execute(self, sql: str, params: Optional[list[Any]] = None) -> None:
        self.query(sql, params or [])


class _HttpApiExecutor:
    """自定义 HTTPS SQL 网关执行器（本仓库的 /db-api）。

    `ph` 仍然吐 `$n` 而不是直接吐 `%s`：网关那边会做方言转换，而 `$n` 是**具名**
    的、`%s` 是位置的——保留 `$n` 才能让重复引用同一个参数继续成立。这一层
    只负责"送出去"，方言的事交给 HttpSqlGateway 一处管。
    """

    def __init__(self, api_base_url: str, api_key: str) -> None:
        from .sql_gateway import HttpSqlGateway

        self.is_sqlite = False
        self._gateway = HttpSqlGateway(api_base_url, api_key)

    def ph(self, n: int) -> str:
        return f"${n}"

    def query(self, sql: str, params: list[Any]) -> list[dict[str, Any]]:
        return self._gateway.query(sql, params)

    def execute(self, sql: str, params: Optional[list[Any]] = None) -> None:
        self._gateway.query(sql, params or [])


# ────────────────────────── 单例 ──────────────────────────

_store_lock = threading.Lock()
_store: Optional[IdentityStore] = None
_store_sig: Optional[str] = None

# 没配远端库时，身份落这个本地 SQLite。与 App Store 的本地档同一取向。
_LOCAL_SQLITE = "sqlite:///data/sliderule-identity.db"


def _signature() -> str:
    from config.settings import settings

    from .sql_gateway import _http_api_target_key, http_api_credentials, prefer_neon_http

    url, key = http_api_credentials()
    return (
        f"{(getattr(settings, 'APP_STORE_DATABASE_URL', '') or '').strip()}"
        f"|httpapi:{_http_api_target_key(url, key)}"
        f"|{int(prefer_neon_http())}"
    )


def get_identity_store() -> IdentityStore:
    """身份存储单例。

    ⚠️ 与本项目其他存储不同，**这一层不 fail-open 到"没有存储"**：身份查不到
    就该拒绝登录，而不是放行。降级只发生在"用哪个库"这一层（远端 → 本地
    SQLite），不会降级成"跳过校验"。
    """
    global _store, _store_sig
    with _store_lock:
        sig = _signature()
        if _store is not None and _store_sig == sig:
            return _store
        _store = _build_store()
        _store_sig = sig
        return _store


def _build_store() -> IdentityStore:
    from pathlib import Path

    from config.settings import settings

    from .sql_gateway import http_api_credentials, neon_http_endpoint, prefer_neon_http

    # 自定义 HTTPS 网关排在最前：配了它就说明这个环境出不去 5432，下面那段
    # TCP 探测纯属白等（每个地址 connect_timeout 4s，最坏一次登录卡二十几秒）。
    degraded = ""   # 非空 = 配了远端却落到本地兜底，登录话术要据此改口
    api_url, api_key = http_api_credentials()
    if api_url:
        if not api_key:
            print("[identity] 设了 APP_STORE_HTTP_API_URL 但没配密钥，忽略这个通道")
        else:
            try:
                x = _HttpApiExecutor(api_url, api_key)
                store = IdentityStore(x, is_sqlite=False)
                print("[identity] 身份存储：自定义 HTTPS SQL 网关")
                return store
            except Exception as exc:  # noqa: BLE001 — 指定了也可能连不上
                degraded = f"HTTPS SQL 网关不可用：{str(exc)[:160]}"
                print(f"[identity] HTTPS 网关不可用，继续按常规顺序降级: {str(exc)[:200]}")

    url = (getattr(settings, "APP_STORE_DATABASE_URL", "") or "").strip()
    if url:
        endpoint = neon_http_endpoint(url)
        if prefer_neon_http() and endpoint:
            try:
                x = _NeonHttpExecutor(url, endpoint)
                print("[identity] 身份存储：Neon SQL over HTTP")
                return IdentityStore(x, is_sqlite=False)
            except Exception as exc:  # noqa: BLE001
                print(f"[identity] HTTP 通道不可用，继续降级: {str(exc)[:200]}")
        try:
            x = _SqlExecutor(url)
            print("[identity] 身份存储：远端数据库（TCP）")
            return IdentityStore(x, is_sqlite=x.is_sqlite)
        except Exception as exc:  # noqa: BLE001
            tcp_err = str(exc)[:200]
            if endpoint:
                try:
                    x2 = _NeonHttpExecutor(url, endpoint)
                    print(f"[identity] TCP 不可用（{tcp_err}），改走 Neon SQL over HTTP")
                    return IdentityStore(x2, is_sqlite=False)
                except Exception as http_exc:  # noqa: BLE001
                    print(f"[identity] 远端两条通道均不可用: HTTP={str(http_exc)[:200]}")
            degraded = f"远端身份库不可用：{tcp_err}"
            print(f"[identity] 远端不可用，身份改存本地 SQLite（不跨机器共享）: {tcp_err}")

    local = (os.getenv("SLIDERULE_IDENTITY_SQLITE") or _LOCAL_SQLITE).strip()
    if local.startswith("sqlite:///"):
        Path(local[len("sqlite:///") :]).parent.mkdir(parents=True, exist_ok=True)
    x = _SqlExecutor(local)
    # ⚠ 只在**配了远端却没连上**时才算降级。压根没配远端（纯本地开发）
    #   落到 SQLite 是正常形态，不该让登录改口——那会把本地开发的
    #   「密码打错了」也说成「服务暂时不可用」。
    return IdentityStore(x, is_sqlite=True, degraded_from=degraded)


def identity_backend_degraded() -> str:
    """配了远端身份库却落到本地兜底时，返回那句原因；正常时返回空串。

    调用方（auth_service.login）据此改口：**账号库连不上，不是密码不对**。
    """
    try:
        return str(getattr(get_identity_store(), "degraded_from", "") or "")
    except Exception:  # noqa: BLE001 — 问一句体检情况不许把登录问崩
        return ""


def reset_identity_cache() -> None:
    """测试用。"""
    global _store, _store_sig
    with _store_lock:
        _store = None
        _store_sig = None
