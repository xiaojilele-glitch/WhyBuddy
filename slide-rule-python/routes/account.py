"""面向浏览器的账号接口（2026-08-02）。

## 为什么挂在 /api/sliderule/account 下而不是 /api/auth

`/api/auth/*` 已经被两个东西占着：Node 侧 `server/routes/auth.ts` 的遗留账号体系
（MySQL），以及 Python 侧 `routes/auth.py` 那个给 Node 桥接用的桩（要内部密钥、
不面向浏览器）。往那里加会撞路径，也会让"哪套在生效"变得含糊。

挂在 sliderule 前缀下还有个实际好处：**复用已经验证过的那条代理**
（server/routes/sliderule.ts）。浏览器 → Node → Python 这条路已经通了，不用再铺一条。

## 令牌怎么给

登录/注册成功时**同时**给两样：
  · 响应体里的 `token` —— 给脚本/CLI 用（Authorization: Bearer）
  · httpOnly Cookie —— 给浏览器用

浏览器优先用 Cookie：httpOnly 意味着 XSS 拿不到它。`localStorage` 存 JWT 是很常见
的做法，但一次 XSS 就等于永久盗号。两者都支持是因为 CLI 用不了 Cookie。

对齐 fastapi-users 的做法：它把「认证后端」拆成 transport（cookie/bearer）与
strategy（jwt/db），同一份身份可以走多个 transport。这里不需要那层抽象，但取向一致。
"""

from __future__ import annotations

import base64
import re
from typing import Any, Optional

from fastapi import APIRouter, Body, Cookie, Header, HTTPException, Query, Request, Response

from middlewares.current_user import AUTH_COOKIE, CurrentUser, CurrentUserOptional, SuperUser
from services import auth_service
from services.auth_tokens import DEFAULT_TTL_S, decode_access_token
from services.identity_store import get_identity_store

router = APIRouter(tags=["Account"])


def _set_auth_cookie(response: Response, token: str, request: Optional[Request] = None) -> None:
    """种登录 Cookie。

    · httponly —— XSS 拿不到
    · samesite=lax —— 挡住跨站表单/图片发起的写操作，同时不影响正常的站内跳转
    · secure 跟随请求协议：本地 http 开发也要能登上，所以不硬编码 True
      （硬编码会让 http://localhost 上的 Set-Cookie 被浏览器直接丢掉，
       表现是"登录返回 200 但下一个请求还是未登录"，很难查）。
      2026-08-14 审计补：docstring 早就这么写了，实现里却一直没传 secure ——
      HTTPS 部署下 cookie 照样能走明文 http 外带。现在真的跟随协议：
      https（含反代 x-forwarded-proto）就打 Secure，本地 http 不打。
    """
    response.set_cookie(
        key=AUTH_COOKIE,
        value=token,
        max_age=DEFAULT_TTL_S,
        httponly=True,
        samesite="lax",
        secure=_client_is_https(request) if request is not None else False,
        path="/",
    )


def _client_is_https(request: Request) -> bool:
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "").lower()
    return proto == "https"


@router.post("/account/register/start")
async def register_start(payload: dict[str, Any] = Body(...)):
    """第一步：校验 + 发验证码。

    ⚠️ 邮箱已注册时也返回成功（见 auth_service.start_registration 的说明）——
    否则这个接口就是个用户枚举器。
    """
    import asyncio

    result = await asyncio.to_thread(
        auth_service.start_registration,
        str(payload.get("email") or ""),
        str(payload.get("password") or ""),
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("message") or "注册失败")
    return result


@router.post("/account/register")
async def register_complete(
    response: Response, request: Request, payload: dict[str, Any] = Body(...)
):
    """第二步：验码 + 建账号，成功即登录态。"""
    import asyncio

    result = await asyncio.to_thread(
        auth_service.complete_registration,
        str(payload.get("email") or ""),
        str(payload.get("password") or ""),
        str(payload.get("code") or ""),
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("message") or "注册失败")
    _set_auth_cookie(response, result["token"], request)
    return result


@router.post("/account/login")
async def login(response: Response, request: Request, payload: dict[str, Any] = Body(...)):
    import asyncio

    result = await asyncio.to_thread(
        auth_service.login,
        str(payload.get("email") or ""),
        str(payload.get("password") or ""),
    )
    if not result.get("ok"):
        # ⚠ 2026-09-05：账号库连不上不是 401。401 的意思是"你的凭据不对"，
        #   而这时我们**根本没查到库**——前端会照 401 去引导重输密码、去找回
        #   密码，全是白费力气。503 才是实情，也让监控能把它跟真的密码错分开。
        if result.get("error") == "identity_unavailable":
            raise HTTPException(503, result.get("message") or "账号服务暂时不可用")
        # 401 而不是 400：前端据此判断"要重新输密码"而不是"参数错了"。
        # 消息本身对"邮箱不存在"和"密码错误"是同一句（见 auth_service）。
        raise HTTPException(401, result.get("message") or "登录失败")
    _set_auth_cookie(response, result["token"], request)
    return result


@router.post("/account/password/reset/start")
async def password_reset_start(payload: dict[str, Any] = Body(...)):
    """找回密码第一步：发验证码。

    ⚠️ 邮箱**没注册**时也返回成功（不发码）——理由同注册那条：如实回答就是
    一个用户枚举器。冷却期内同样走成功出口，见 auth_service.start_password_reset。
    """
    import asyncio

    result = await asyncio.to_thread(
        auth_service.start_password_reset,
        str(payload.get("email") or ""),
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("message") or "发送失败")
    return result


@router.post("/account/password/reset")
async def password_reset_complete(
    response: Response, request: Request, payload: dict[str, Any] = Body(...)
):
    """找回密码第二步：验码 + 换密码，成功即登录态。

    ⚠️ 换密码**不会**让其他设备上已签发的 token 失效（纯 JWT 没有服务端撤销，
    同 logout 的说明）。见 auth_service 里「找回密码」那段。
    """
    import asyncio

    result = await asyncio.to_thread(
        auth_service.complete_password_reset,
        str(payload.get("email") or ""),
        str(payload.get("code") or ""),
        str(payload.get("password") or ""),
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("message") or "重置失败")
    _set_auth_cookie(response, result["token"], request)
    return result


@router.post("/account/logout")
async def logout(
    response: Response,
    authorization: Optional[str] = Header(None),
    sliderule_token: Optional[str] = Cookie(None, alias=AUTH_COOKIE),
):
    """登出：**撤销这张令牌** + 清 Cookie。

    2026-08-04 之前这里只清 Cookie，注释里如实写着"这不会让已签发的 token 失效"。
    现在真的失效了：把令牌的 `jti` 记进撤销表，之后任何人拿着它都进不来
    （做法与取舍见 services/auth_tokens 模块头 ②，抄的是 fastapi-users 的
    DatabaseStrategy.destroy_token）。

    ⚠️ 只撤销**这一张**。"把我所有设备都踢下线"是另一个动作——改密码才是
    （`pv` 密码戳，见模块头 ①）。两者不该混为一谈：在公用电脑上登出，不该
    连带把自己手机上的会话也断了。

    撤销失败**不影响返回成功**：Cookie 已经清了，本地就是登出状态；为一次
    写库失败让用户卡在"登不出去"更糟。
    """
    import asyncio

    token = _extract_bearer(authorization) or (sliderule_token or "").strip()
    payload = decode_access_token(token) if token else None
    if payload and payload.get("jti"):
        try:
            await asyncio.to_thread(
                _revoke,
                str(payload.get("jti") or ""),
                str(payload.get("sub") or ""),
                payload.get("exp"),
            )
        except Exception as exc:  # noqa: BLE001 — 见 docstring：不让写库失败卡住登出
            print(f"[account] 登出时撤销令牌失败（Cookie 已清）: {str(exc)[:160]}")
    response.delete_cookie(key=AUTH_COOKIE, path="/")
    return {"ok": True}


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization:
        return ""
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return ""


def _revoke(jti: str, user_id: str, exp: Any) -> None:
    from datetime import datetime, timezone

    expires_at = None
    if isinstance(exp, (int, float)):
        expires_at = datetime.fromtimestamp(float(exp), tz=timezone.utc).isoformat()
    get_identity_store().revoke_token(jti, user_id=user_id, expires_at=expires_at)


@router.get("/account/me")
async def me(viewer: CurrentUserOptional):
    """当前登录者。**匿名返回 200 + user=null，不是 401。**

    前端启动时要用它判断登录态，401 会在控制台刷一片红、也容易被通用的
    "401 就跳登录页"拦截器误伤。匿名是正常状态，不是错误。

    ⚠ 2026-08-21：注册完直接发 cookie，从不走 login()，last_login_at 一直空。
    管理台就把正在用的超管写成「从未登录」。cookie 会话也是在用，空着就补一刀。
    """
    import asyncio

    if viewer is not None and not viewer.public().get("lastLoginAt"):
        def _stamp():
            store = get_identity_store()
            store.touch_login(viewer.id)
            return store.get_by_id(viewer.id)

        try:
            fresh = await asyncio.to_thread(_stamp)
            if fresh is not None:
                viewer = fresh
        except Exception:  # noqa: BLE001 — 增强类，戳不上不许拖垮「我是谁」
            pass
    return {"user": viewer.public() if viewer is not None else None}


_DISPLAY_NAME_MAX = 40
_AVATAR_MAX_BYTES = 2 * 1024 * 1024
_AVATAR_DATA_URL = re.compile(
    r"^data:(image/(?:jpeg|jpg|png|gif|webp));base64,([A-Za-z0-9+/=\s]+)$",
    re.IGNORECASE,
)


def _normalize_display_name(value: Any) -> tuple[Optional[str], Optional[str]]:
    if value is None:
        return None, None
    text = str(value).strip()
    if not text:
        return None, None
    if any(ch in text for ch in "\n\r\t"):
        return None, "昵称不能包含换行"
    if len(text) > _DISPLAY_NAME_MAX:
        return None, f"昵称最多 {_DISPLAY_NAME_MAX} 个字"
    return text, None


def _normalize_avatar_url(value: Any) -> tuple[Optional[str], Optional[str]]:
    """None / 空串 = 清掉头像。只收本页上传的 data URL，不收外链。"""
    if value is None:
        return None, None
    if not isinstance(value, str):
        return None, "头像格式不支持"
    text = value.strip()
    if not text:
        return None, None
    matched = _AVATAR_DATA_URL.match(text)
    if not matched:
        return None, "请上传 JPG、PNG、GIF 或 WebP 图片"
    try:
        raw = base64.b64decode(matched.group(2), validate=False)
    except Exception:  # noqa: BLE001
        return None, "头像文件损坏"
    if len(raw) > _AVATAR_MAX_BYTES:
        return None, "头像不能超过 2 MB"
    if len(raw) < 24:
        return None, "头像文件损坏"
    return text, None


@router.patch("/account/me")
async def patch_me(viewer: CurrentUser, payload: dict[str, Any] = Body(default={})):
    """改当前登录者的昵称和头像。对照 TRAE 账号设置：本人改自己的资料。

    字段可缺：没传的保持原值。`displayName` / `avatarUrl` 传空串表示清掉。
    """
    import asyncio

    if not isinstance(payload, dict):
        raise HTTPException(400, "请求格式不对")
    kwargs: dict[str, Any] = {}
    if "displayName" in payload:
        name, err = _normalize_display_name(payload.get("displayName"))
        if err:
            raise HTTPException(400, err)
        kwargs["display_name"] = name
    if "avatarUrl" in payload:
        url, err = _normalize_avatar_url(payload.get("avatarUrl"))
        if err:
            raise HTTPException(400, err)
        kwargs["avatar_url"] = url
    if not kwargs:
        return {"user": viewer.public()}

    def _go() -> Any:
        return get_identity_store().update_profile(viewer.id, **kwargs)

    updated = await asyncio.to_thread(_go)
    if updated is None:
        raise HTTPException(404, "用户不存在")
    return {"user": updated.public()}


@router.get("/account/avatar/{user_id}")
async def get_user_avatar(user_id: str, viewer: CurrentUserOptional):
    """头像图本体。载荷里只放地址，图走这里 + 强缓存（2026-08-23）。

    形状照抄本仓已有的那条：`GET /apps/{id}/preview`（routes/sliderule_full.py）
    ——按内容报 Content-Type、`immutable` 强缓存、版本位在调用方拼的 `?v=` 上。
    这里同样不读 v，它的全部作用就是当缓存键：头像一换，identity_store 算出的
    avatar_tag 就变，URL 跟着变，immutable 才成立。

    ## 门槛：本人或超管，其余一律 404

    现在会显示别人头像的地方只有管理台用户列表（超管）和自己的账号面板，
    所以门槛就按这两个来。**不给"任何登录用户都能看"**：user_id 会随
    owner_id 出现在公开应用的摘要里，放开等于拿公开应用就能翻出主人的头像。

    报 404 不报 403，跟 app_access.require 同一条纪律：403 等于确认"这个 id
    确实存在"，可以被用来枚举。

    缓存标 `private`：这张图是按 viewer 授权的，不能进共享缓存（CDN 把超管
    取到的图缓存下来发给别人，就是越权）。
    """
    import asyncio

    if viewer is None:
        raise HTTPException(404, "头像不存在")
    if viewer.id != user_id and not viewer.is_superuser:
        raise HTTPException(404, "头像不存在")

    def _go() -> Any:
        return get_identity_store().get_by_id(user_id)

    user = await asyncio.to_thread(_go)
    if user is None:
        raise HTTPException(404, "头像不存在")

    matched = _AVATAR_DATA_URL.match(user.raw_avatar())
    if not matched:
        # 没有头像、或者库里那份不是能认的 data URL（存量脏数据）。
        # 都当"没有这份资产"，不是错误态——前端画首字母块。
        raise HTTPException(404, "头像不存在")
    try:
        raw = base64.b64decode(matched.group(2), validate=False)
    except Exception:  # noqa: BLE001 — 脏数据不该变成 500
        raise HTTPException(404, "头像不存在")
    if not raw:
        raise HTTPException(404, "头像不存在")

    return Response(
        content=raw,
        media_type=matched.group(1).lower(),
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.get("/account/capabilities")
async def capabilities(viewer: CurrentUserOptional):
    """当前身份能做什么——给前端决定显示哪些按钮。

    ⚠️ 这个接口**不是**权限判定，只是 UI 提示。真正的判定在每个写接口里
    （app_access.require）。前端藏起来的按钮不等于后端拦得住——那套 RBAC 后台
    的字段权限就是只藏了前端、后端照样返回全部字段。
    """
    logged_in = viewer is not None
    return {
        "loggedIn": logged_in,
        "isSuperuser": bool(viewer is not None and viewer.is_superuser),
        "can": {
            "browse": True,        # 匿名也能浏览应用中心
            "viewApp": True,
            "fork": logged_in,
            "drive": logged_in,    # 推演要登录（匿名只查看）
            "manageOwn": logged_in,
        },
    }


# ────────────────────────── 管理台 ──────────────────────────
#
# Node 的 /api/admin 原来读的是**遗留 MySQL 用户表**。那套账号体系已经整体下掉
# （2026-08-03），管理台的数据源随之切到这里——身份只剩一份，不会出现
# "管理台看到的用户和实际能登录的用户是两拨人"。
#
# 守卫是双层的：Node 侧 requireAdmin 先拦一道，这里的 SuperUser 再拦一道。
# 不省掉任何一层——Node 那层是为了不把请求白白打过来，这层才是真判定。


@router.get("/account/admin/users")
async def admin_list_users(
    _admin: SuperUser,
    q: str = Query(default=""),
):
    """全站用户。对照 Gitea `/admin/users`：搜索 + 停用位，不建号、不配菜单权限。

    用量按会话 ownerId 挂上。设置里的 GET /usage 只看自己的账，这里才是所有人。
    """
    import asyncio

    needle = str(q or "").strip().lower()

    def _go() -> list[dict[str, Any]]:
        from services.cost_ledger import usage_by_owner

        users = get_identity_store().list_users()
        usage = usage_by_owner()
        rows: list[dict[str, Any]] = []
        for user in users:
            if needle:
                name = str(user.public().get("displayName") or "").lower()
                if needle not in user.email.lower() and needle not in name:
                    continue
            row = user.public()
            stats = usage.get(user.id) or {}
            row["sessions"] = int(stats.get("sessions") or 0)
            row["estimatedTokens"] = int(stats.get("estimatedTokens") or 0)
            row["estimatedCostUsd"] = round(float(stats.get("estimatedCostUsd") or 0.0), 8)
            # 最后活动：身份库的 last_login_at（密码登录）和会话 lastActive
            # 取更近的。注册发 cookie 不走 login()，只看 last_login_at 会
            # 把正在用的超管显示成「从未登录」。
            row["lastActiveAt"] = stats.get("lastActiveAt") or row.get("lastLoginAt")
            rows.append(row)
        return rows

    items = await asyncio.to_thread(_go)
    return {"ok": True, "items": items}


def _staff_needle(row: dict[str, Any], needle: str) -> bool:
    if not needle:
        return True
    blob = " ".join(str(row.get(key) or "") for key in row).lower()
    return needle in blob


def _staff_app_row(row: dict[str, Any]) -> dict[str, Any]:
    """应用摘要给管理台。对照 Gitea `/admin/repos`：主人、可见性、时间。"""
    return {
        "id": str(row.get("id") or ""),
        "productName": str(row.get("product_name") or ""),
        "goal": str(row.get("goal") or ""),
        "ownerId": row.get("owner_id") or None,
        "visibility": str(row.get("visibility") or "private"),
        "isOfficial": bool(row.get("is_official")),
        "sessionId": row.get("session_id") or None,
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at") or row.get("created_at"),
        "pageCount": int(row.get("page_count") or 0),
        "entityCount": int(row.get("entity_count") or 0),
        "version": int(row.get("version") or 1),
    }


def _staff_session_row(row: dict[str, Any]) -> dict[str, Any]:
    """会话摘要给管理台。侧栏 GET /sessions 会剥掉 ownerId；超管清单要留着。"""
    return {
        "id": str(row.get("sessionId") or ""),
        "goal": str(row.get("goal") or ""),
        "ownerId": row.get("ownerId") or None,
        "phase": str(row.get("phase") or "idle"),
        "createdAt": row.get("createdAt"),
        "lastActive": row.get("lastActive"),
        "artifactCount": int(row.get("artifactCount") or 0),
    }


@router.get("/account/admin/apps")
async def admin_list_apps(
    _admin: SuperUser,
    q: str = Query(default=""),
):
    """全站应用。对照 Gitea `/admin/repos`。

    ⚠ 2026-08-21：管理台项目页原先打 Node `/api/admin/projects`。sliderule
    活路径只代理 `/api/sliderule`，那张表是空的，页面看起来像「还没有项目」。
    真数据在 app_store，跟应用中心同一份。
    """
    import asyncio

    needle = str(q or "").strip().lower()

    def _go() -> list[dict[str, Any]]:
        from services import app_store

        rows = [_staff_app_row(raw) for raw in app_store.list_apps(limit=200, offset=0)]
        return [row for row in rows if _staff_needle(row, needle)]

    items = await asyncio.to_thread(_go)
    return {"ok": True, "items": items}


@router.get("/account/admin/sessions")
async def admin_list_sessions(
    _admin: SuperUser,
    q: str = Query(default=""),
):
    """全站话题。对照 Gitea 仓库列表的「全站、带主人」。

    侧栏 GET /sessions 按 app_access 过滤且不回 ownerId。超管清单要看所有人的，
    并且要能对上用户表。失败页从 phase=failed 筛，不另起一张死表。
    """
    import asyncio

    needle = str(q or "").strip().lower()

    def _go() -> list[dict[str, Any]]:
        from services.persistence import list_session_summaries, session_has_goal

        rows = [
            _staff_session_row(raw)
            for raw in list_session_summaries()
            if session_has_goal(raw)
        ]
        return [row for row in rows if _staff_needle(row, needle)]

    items = await asyncio.to_thread(_go)
    return {"ok": True, "items": items}


@router.get("/account/admin/users/{user_id}")
async def admin_get_user(user_id: str, _admin: SuperUser):
    import asyncio

    user = await asyncio.to_thread(lambda: get_identity_store().get_by_id(user_id))
    if user is None:
        raise HTTPException(404, "用户不存在")
    return {"ok": True, "user": user.public()}


@router.patch("/account/admin/users/{user_id}")
async def admin_patch_user(
    user_id: str,
    admin: SuperUser,
    payload: dict[str, Any] = Body(default={}),
):
    """停用 / 恢复。对照 Gitea ProhibitLogin：不删账号，登录直接说已被停用。

    不能停自己（Gitea 同款，否则超管会把自己关在门外）。
    不能停其他超管——To-C 只有一档员工位，互停没有产品语义。
    """
    import asyncio

    if not isinstance(payload, dict):
        raise HTTPException(400, "请求格式不对")
    if "isActive" not in payload:
        raise HTTPException(400, "没有要改的字段")
    want_active = bool(payload.get("isActive"))
    uid = str(user_id or "").strip()
    if not uid:
        raise HTTPException(404, "用户不存在")
    if uid == admin.id and not want_active:
        raise HTTPException(400, "不能停用自己")

    def _go() -> tuple[str, Any]:
        store = get_identity_store()
        target = store.get_by_id(uid)
        if target is None:
            return "missing", None
        if target.is_superuser and uid != admin.id:
            return "other_super", None
        return "ok", store.set_active(uid, want_active)

    kind, updated = await asyncio.to_thread(_go)
    if kind == "other_super":
        raise HTTPException(400, "不能停用其他超管")
    if kind == "missing" or updated is None:
        raise HTTPException(404, "用户不存在")
    return {"ok": True, "user": updated.public()}
