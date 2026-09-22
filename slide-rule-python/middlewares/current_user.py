"""当前用户的三个依赖：匿名可读 / 必须登录 / 必须超管（2026-08-02）。

## 三档对应的产品语义

    optional_user   → User | None   没登录也能用（浏览应用中心、看应用）
    require_user    → User          必须登录（Fork、推演、改自己的东西）
    require_superuser → User        必须超管（跨用户的管理操作）

## 形状取自哪里

**fastapi-users**（MIT）把这三档做成同一个 `current_user(optional=, superuser=)`
工厂，判定走同一条路径，只在最后一步分叉
（fastapi_users/authentication/authenticator.py:189）：

    if not user and not optional:
        raise HTTPException(status_code=status_code)

这个结构值得照抄：**匿名和拒绝共用一条判定链**，不存在"匿名分支忘了做某项检查"
的可能。本文件用三个具名依赖而不是一个带参工厂，是因为 FastAPI 的 `Depends`
在具名函数下 OpenAPI 文档更清楚，而我们只需要三档、不需要 fastapi-users 那样
的动态组合。

**fastapi/full-stack-fastapi-template**（MIT）的 `api/deps.py` 贡献了两点：
  · 用 `Annotated[User, Depends(...)]` 定义可复用的类型别名，路由签名干净；
  · 超管依赖建在**已激活用户**之上，而不是直接建在 get_current_user 上
    （模板自己的 issue #537 就是踩了这个：超管没检查 is_active）。
    本文件的 require_superuser 依赖 require_user，后者已经查过 is_active。

## 令牌从哪读

Authorization: Bearer 优先，其次 Cookie。两个都支持是因为前端目前是同源部署
（Cookie 更省事、且 httpOnly 能挡 XSS 取 token），而脚本/CLI 调用惯用 Bearer。

⚠ 2026-08-20：Bearer **非空就丢掉 Cookie** 是错的。真机左下角显示已登录 Admin，
`PUT /sessions` 200，紧接着 `POST /drive-full-stream` 401「请先登录后再推演」。
任何一层塞了一个解不开的 Authorization（扩展、代理、空 Bearer 残值），有效
登录 Cookie 就会被判成匿名。解不开的 Bearer 必须回落到 Cookie。

Cookie 也不只信 FastAPI 的 `Cookie()` 注入：带 JSON body 的 POST 上它偶发是
空的，而 `Request.cookies` / 原始 Cookie 头仍在。注入没有就从请求头再读一次。

## 自动续期（2026-08-04）

令牌过半程之后，下一次请求顺手换一张新的（滑动窗口）。7 天于是从"绝对上限"
变成"**闲置**上限"——一直在用就不会被打断，真闲置 7 天才要重新登录。

只对 **Cookie** 来路续期：Bearer 的调用方（脚本/CLI）拿不到 Set-Cookie，
给它签一张新的也没人收，白烧一次 HMAC。
"""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
import hmac
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import Cookie, Depends, Header, HTTPException, Request, Response, status

from services.auth_tokens import (
    DEFAULT_TTL_S,
    create_access_token,
    decode_access_token,
    password_stamp,
)
from services.identity_store import User, get_identity_store

# Cookie 名。与前端登录后写入的名字保持一致。
AUTH_COOKIE = "sliderule_token"


def _extract_bearer_token(authorization: Optional[str]) -> str:
    """只取 Authorization 里的 Bearer。续期要靠它区分来路（Cookie 才续）。"""
    if not authorization:
        return ""
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return ""


def _cookie_token(request: Request, injected: Optional[str]) -> Optional[str]:
    """登录 Cookie。注入优先，没有就从请求头再拆一次。

    FastAPI `Cookie()` 在部分带 JSON body 的 POST 上会是 None，而浏览器其实
    带了 `sliderule_token`——只信注入就会把已登录用户判成匿名。
    """
    if injected and injected.strip():
        return injected.strip()
    got = (request.cookies.get(AUTH_COOKIE) or "").strip()
    if got:
        return got
    header = request.headers.get("cookie") or ""
    for part in header.split(";"):
        name, _, value = part.partition("=")
        if name.strip() == AUTH_COOKIE:
            return value.strip() or None
    return None


def _extract_token(
    authorization: Optional[str], cookie_token: Optional[str]
) -> Optional[str]:
    """兼容旧调用。新路径用 `_pick_access_token`，会在 Bearer 解不开时回落 Cookie。"""
    token, _, _ = _pick_access_token(authorization, cookie_token)
    return token


def _pick_access_token(
    authorization: Optional[str], cookie_token: Optional[str]
) -> tuple[Optional[str], Optional[dict], bool]:
    """选出一张能解开的令牌。

    返回 `(token, payload, from_cookie)`。Bearer 优先；**解不开再试 Cookie**。
    原来 Bearer 非空就忽略 Cookie，坏 Authorization 会把有效登录态盖掉。
    """
    cookie = (cookie_token or "").strip()
    candidates: list[str] = []
    bearer = _extract_bearer_token(authorization)
    if bearer:
        candidates.append(bearer)
    if cookie and cookie not in candidates:
        candidates.append(cookie)
    for token in candidates:
        payload = decode_access_token(token)
        if payload:
            return token, payload, token == cookie
    return None, None, False


#: 令牌走过这么久之后就换一张新的（滑动续期，见模块头）。
#: 取 TTL 的一半：太短会让几乎每个请求都重签一次（白烧 HMAC + 每次都发
#: Set-Cookie），太长又让"快过期了"的窗口太窄，用户可能在窗口外被踢。
RENEW_AFTER_S = DEFAULT_TTL_S // 2


#: 鉴权里那条并发查询用的线程池。
#
# 每个登录请求只借一个线程（撤销名单那条），身份查询仍在请求自己的线程上跑，
# 所以并发度 = 同时在鉴权的请求数。给 32：与 app.py 的事件循环执行器
# （默认放大到 64）同量级，池满了就退化成排队——也就是改动前的串行行为，
# 不会更糟。
#
# ⚠ 模块级复用，不要改成每次请求 new 一个：这是**每个登录请求**都走的热路，
#   建池/销毁池的开销要摊在每一发上。
_AUTH_POOL = ThreadPoolExecutor(max_workers=32, thread_name_prefix="auth")


def _drain(future: Optional[Future]) -> None:
    """把一个已经发出去、但这条路上用不到了的查询收掉。

    并发化之后新增的失败形状：判定提前 return，撤销查询的异常没人 result()，
    只在日志里留一行 "exception was never retrieved"——既不影响功能也没人看得
    见。收一下就好，结果和异常都丢弃（这条路已经判定为匿名了）。
    """
    if future is None:
        return
    try:
        future.result()
    except Exception:  # noqa: BLE001 — 这条路已经不看它的结论了
        pass


def _maybe_renew(
    response: Optional[Response],
    payload: dict,
    user: User,
    *,
    from_cookie: bool,
    secure: bool = False,
) -> None:
    """过半程就换新令牌（只对 Cookie 来路，见模块头）。

    任何异常都吞掉：续期是**锦上添花**，失败的后果只是用户早一点需要重新登录，
    不该让一个正常的请求 500。
    """
    if response is None or not from_cookie:
        return
    try:
        issued = int(payload.get("iat") or 0)
        if not issued:
            return
        age = int(datetime.now(timezone.utc).timestamp()) - issued
        if age < RENEW_AFTER_S:
            return
        fresh = create_access_token(
            user.id, password_hash=str(user.get("password_hash") or "")
        )
        # Cookie 属性必须跟签发处（routes/account._set_auth_cookie）一致，
        # 否则续期会写出一个属性不同的 Cookie，浏览器当成另一个，出现两份并存。
        # secure 同样跟随请求协议（2026-08-14 审计补，与签发处同一口径）。
        response.set_cookie(
            key=AUTH_COOKIE,
            value=fresh,
            max_age=DEFAULT_TTL_S,
            httponly=True,
            samesite="lax",
            secure=secure,
            path="/",
        )
    except Exception:  # noqa: BLE001 — 见 docstring
        return


def optional_user(
    request: Request,
    response: Response,
    authorization: Annotated[Optional[str], Header()] = None,
    sliderule_token: Annotated[Optional[str], Cookie(alias=AUTH_COOKIE)] = None,
) -> Optional[User]:
    """有登录就给 User，没有就 None。**从不抛异常。**

    用在"匿名也能看"的接口上：应用中心列表、应用详情、缩略图。
    路由内部据此决定给不给写操作的入口，而不是靠前端藏按钮。

    ## 判定顺序（2026-08-04 起有四道，不是一道）

        ① 签名与过期    decode_access_token
        ② 账号还在、还活着
        ③ pv 密码戳对得上   —— 改了密码，旧令牌全灭
        ④ jti 没被撤销      —— 登出的那一张失效

    ③④ 的来源与理由见 services/auth_tokens 的模块头。**四道都在这一个函数里**
    是刻意的：require_user / require_superuser 都建在它上面，新增一道检查不会
    出现"某个入口漏做了"的情况（这正是抄 fastapi-users 那条"匿名和拒绝共用
    同一条判定链"的原因）。
    """
    cookie = _cookie_token(request, sliderule_token)
    token, payload, from_cookie = _pick_access_token(authorization, cookie)
    if not token or not payload:
        return None
    user_id = str(payload.get("sub") or "")
    if not user_id:
        return None
    # ⚠ 两次查库**并发**发（2026-08-24）。
    #
    #   真机实测（HTTPS SQL 网关）：get_by_id 180ms + is_token_revoked 133ms，
    #   串行 313ms，而这是**每一个登录请求**都要付的——不鉴权的 /health 只要
    #   4ms，带鉴权的 /account/me（业务上什么都不干）340ms，工作台首屏那十几个
    #   请求条条在付。并发之后只剩一次往返。
    #
    #   ## 为什么在这儿才发，不更早
    #
    #   上面 ① 签名与过期是**纯内存**的，伪造/过期的令牌在这一行之前就 return
    #   了，一次库都不查。这条性质必须保住：原来把撤销查询放在最后，头注写着
    #   "没必要为一张签名就不对的令牌白查一次"——那个理由针对的正是这类令牌，
    #   而它们根本走不到这里。走到这里的令牌都是我们自己签发过的真令牌，两条
    #   查询本来就都要跑。
    #
    #   ## 判定顺序没变
    #
    #   并发的是**发出查询**，不是判定。下面仍然按 ②③④ 的次序看结果：账号
    #   还在 → 密码戳 → 撤销名单。任何一道不过就 return None，跟改动前逐字
    #   一致。撤销查询的结果在 ④ 才取。
    revoked_future = None
    try:
        store = get_identity_store()
        revoked_future = _AUTH_POOL.submit(
            # ⚠ _for_auth 那条（带 5 秒 TTL）。同进程登出仍然当场生效——
            #   revoke_token 是一次写，会把两个鉴权缓存一起清掉。
            store.is_token_revoked_for_auth,
            str(payload.get("jti") or ""),
        )
        # ⚠ 用 _for_auth 那条（带 5 秒 TTL），不是裸的 get_by_id。
        #   取舍写在 identity_store.AUTH_CACHE_TTL_S 的注释里：缓存的是"账号还
        #   在、还活着"和密码戳要用的 password_hash，代价是改密码/停用最长 5 秒
        #   才生效。④ 的撤销名单同样带 5 秒 TTL（用户 2026-08-24 一并定的），
        #   同进程登出仍然当场生效——那是一次写，会把两个缓存一起清掉。
        user = store.get_by_id_for_auth(user_id)
    except Exception as exc:  # noqa: BLE001 — 身份库抖动时按匿名处理，不拖垮只读接口
        # 只读接口 fail-open 成匿名是对的；写接口（推演）随后会 401「请先登录」，
        # 而侧栏还显示着启动时缓存的账号——2026-08-20 真机就是这个形状。
        # 这里至少把原因打出来，避免再当成"用户没登录"。
        print(f"[auth] identity lookup failed path={request.url.path}: {type(exc).__name__}: {exc}")
        # 已经发出去的撤销查询要收掉，否则它的异常没人 result()，
        # 只在日志里留一行 "exception was never retrieved"——不影响功能、
        # 也没人看得见，正是最难查的那一类。
        _drain(revoked_future)
        return None
    # 停用的账号等同未登录：令牌还没过期但人已经被停了，不能继续按登录态放行。
    if user is None or not user.is_active:
        _drain(revoked_future)
        return None

    # ③ 密码戳。**缺 pv 的令牌一律拒绝**——这是 2026-08-04 之前签发的存量令牌，
    #    它们正是"改了密码也踢不掉"的那一批，放行等于这次改动对存量无效。
    #    代价是这次上线会把所有已登录用户踢下线一次，那是可接受的一次性成本，
    #    而且**这正是我们想要的效果**（存量令牌本来就该作废）。
    stamp = str(payload.get("pv") or "")
    expected = password_stamp(str(user.get("password_hash") or ""))
    if not stamp or not hmac.compare_digest(stamp, expected):
        _drain(revoked_future)
        return None

    # ④ 撤销名单。放在最后：前面几道都是纯内存计算，这一道要查库，
    #    没必要为一张签名就不对的令牌白查一次。
    try:
        if revoked_future is not None and revoked_future.result():
            return None
    except Exception:  # noqa: BLE001 — 撤销表查不动时**放行**
        # 这一处是 fail-open，与上面几道相反，理由：撤销表是"额外收紧"的机制，
        # 它挂掉时退回到"没有撤销表"的行为（即改动前的状态），而不是把所有
        # 已登录用户全部锁在门外。身份判定本身（①②③）不依赖这张表。
        pass

    # 过半程换新（见模块头「自动续期」）。放在全部判定通过之后——
    # 一张验不过的令牌当然不该被续。
    # from_cookie 必须看**实际用上的那张令牌**：junk Bearer 回落到 Cookie 时，
    # 仍该按 Cookie 来路续期（旧写法看 Authorization 非空就跳过续期）。
    _maybe_renew(
        response,
        payload,
        user,
        from_cookie=from_cookie,
        # 与 routes/account._client_is_https 同一判据（x-forwarded-proto 优先）
        secure=(
            (request.headers.get("x-forwarded-proto") or request.url.scheme or "")
            .lower() == "https"
        ),
    )
    return user


def require_user(user: Annotated[Optional[User], Depends(optional_user)]) -> User:
    """必须登录。用在 Fork、推演、改自己东西这类操作上。"""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_superuser(user: Annotated[User, Depends(require_user)]) -> User:
    """必须超管。

    建在 require_user 之上（而不是 optional_user）——这样 is_active 已经被查过。
    官方模板的 issue #537 正是漏了这一层：超管依赖直接建在 get_current_user 上，
    导致被停用的超管仍能通过检查。
    """
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限"
        )
    return user


CurrentUserOptional = Annotated[Optional[User], Depends(optional_user)]
CurrentUser = Annotated[User, Depends(require_user)]
SuperUser = Annotated[User, Depends(require_superuser)]


def can_write(resource_owner_id: Optional[str], user: Optional[User]) -> bool:
    """能不能改这个资源：本人或超管。

    **无主资源（owner_id 为空）不允许任何人改**——这条是刻意的。历史数据没有
    归属字段，如果判成"谁都能改"，等于新权限一上线就把所有存量应用敞开；判成
    "谁都不能改"最多是需要一次数据迁移来认领。宁可少给，不可多给。
    超管不受此限（下面单独放行），迁移期由超管代为处理。
    """
    if user is None:
        return False
    if user.is_superuser:
        return True
    if not resource_owner_id:
        return False
    return resource_owner_id == user.id
