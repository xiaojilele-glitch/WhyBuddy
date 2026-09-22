/**
 * Node 侧的身份中间件——接**新的账号体系**（2026-08-03）。
 *
 * 取代已删除的 `server/auth/middleware.ts`：那一个读 MySQL 的会话表，属于旧
 * 账号体系的一部分，已随整套下掉。
 *
 * ## 为什么是「问 Python」而不是「Node 自己验 JWT」
 *
 * 令牌是 Python 用 `SLIDERULE_AUTH_SECRET` 签的 HS256（`sub` = 用户 id），
 * Node 完全有能力本地验签。没这么做，是因为本地验签只能拿到 `sub`——
 * **是不是超管、账号有没有被停用，都不在令牌里**。
 *
 * 把这两个状态塞进令牌当然更快，代价是：撤掉某人的超管权限后，他手上那张
 * 令牌还能当超管用到过期（7 天）。管理台是这套系统里权限最高的入口，不接受
 * 这个时间窗。所以每次都问一遍 `/account/me`——身份只有一份真相。
 *
 * 性能上不心疼：走到这里的只有 `/api/admin`、`/api/projects`、`/api/tasks`，
 * 都是低频接口；产品主路径（应用中心、推演）根本不经过 Node 的这层，
 * 它们在 Python 侧用 `middlewares/current_user.py` 自己判。
 *
 * ## 三种结果，不是两种
 *
 *     anonymous    没带凭据，或凭据无效        → 401
 *     ok           拿到用户                    → 放行
 *     unavailable  Python 没应答/回了 5xx      → **503，不是放行**
 *
 * 第三种单独列出来是关键。旧中间件在读会话失败时 `return null`（按未认证处理），
 * 那在它的场景下是对的——失败即拒绝。这里如果把 unavailable 混进 anonymous，
 * 语义上仍然是拒绝，但会让运维看到一片 401 而不是 503，误判成"用户登录有问题"。
 * 无论如何**不会因为下游挂了就放行**。
 */

import type { NextFunction, Request, Response } from "express";

import { isAdminRole } from "../../shared/auth.js";
import type { CurrentUser } from "../../shared/auth.js";
import type { AuthenticatedRequest, RequestWithOptionalUser } from "./types.js";

/** 与 Python `middlewares/current_user.py` 的 AUTH_COOKIE 保持一致。 */
const AUTH_COOKIE = "sliderule_token";
const DEFAULT_BASE_URL = "http://127.0.0.1:9700";
const ME_PATH = "/api/sliderule/account/me";
const DEFAULT_TIMEOUT_MS = 5000;

export interface SlideRuleAccountPayload {
  id?: unknown;
  email?: unknown;
  displayName?: unknown;
  isSuperuser?: unknown;
  isVerified?: unknown;
  createdAt?: unknown;
}

/** 转发给 Python 的凭据。原样透传，Node 不解析令牌内容。 */
export interface ForwardedCredentials {
  cookie?: string;
  authorization?: string;
}

type Resolution =
  | { state: "anonymous" }
  | { state: "unavailable" }
  | { state: "ok"; user: CurrentUser };

export interface SlideRuleAuthOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * 请求里有没有带凭据。
 *
 * 没带就直接判匿名，**不发那次网络请求**——匿名请求是常态（爬虫、健康检查、
 * 没登录的人误点管理台），为它们各打一次内部 HTTP 是纯浪费。
 */
export function hasCredentials(request: Request): boolean {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && /^bearer\s+\S/i.test(authorization.trim())) {
    return true;
  }
  const cookie = request.headers.cookie;
  return typeof cookie === "string" && new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=`).test(cookie);
}

export function forwardedCredentials(request: Request): ForwardedCredentials {
  const forwarded: ForwardedCredentials = {};
  const cookie = request.headers.cookie;
  if (typeof cookie === "string" && cookie) forwarded.cookie = cookie;
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization) {
    forwarded.authorization = authorization;
  }
  return forwarded;
}

export function slideRuleBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.PYTHON_SLIDE_RULE_BASE_URL || DEFAULT_BASE_URL).trim();
  return raw.replace(/\/+$/, "");
}

/**
 * Python 的用户对象 → Node 这边一直在用的 `CurrentUser`。
 *
 * `role` 是映射出来的，不是存的：新身份库只有一个布尔 `is_superuser`，
 * 而 Node 侧路由（以及 `shared/auth.ts` 的 `isAdminRole`）按三档角色写的。
 * 映射成 `super_admin` / `user` 两档，中间那档 `admin` 现在没有来源——
 * 需要再分级时在身份库加字段，而不是在这里编。
 */
export function toCurrentUser(payload: SlideRuleAccountPayload): CurrentUser | null {
  const id = typeof payload.id === "string" ? payload.id : "";
  if (!id) return null;
  return {
    id,
    email: typeof payload.email === "string" ? payload.email : "",
    displayName: typeof payload.displayName === "string" ? payload.displayName : null,
    avatarUrl: null,
    role: payload.isSuperuser === true ? "super_admin" : "user",
    // Python 的 optional_user 已经把停用账号当未登录处理了，能返回用户就是 active。
    status: "active",
    emailVerified: payload.isVerified === true,
    createdAt:
      typeof payload.createdAt === "string" ? payload.createdAt : new Date(0).toISOString(),
  };
}

export function createSlideRuleAuthMiddleware(options: SlideRuleAuthOptions = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function resolve(request: Request): Promise<Resolution> {
    if (!hasCredentials(request)) return { state: "anonymous" };

    const doFetch = options.fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== "function") return { state: "unavailable" };

    const base = options.baseUrl ? options.baseUrl.replace(/\/+$/, "") : slideRuleBaseUrl();
    const forwarded = forwardedCredentials(request);
    const headers: Record<string, string> = { accept: "application/json" };
    if (forwarded.cookie) headers.cookie = forwarded.cookie;
    if (forwarded.authorization) headers.authorization = forwarded.authorization;

    // 超时必须有：没有的话 Python 卡住会把 Node 的连接一起拖住，
    // 表现是管理台"一直转圈"而不是报错——比直接 503 难查得多。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${base}${ME_PATH}`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      if (!response.ok) return { state: "unavailable" };
      const body = (await response.json()) as { user?: SlideRuleAccountPayload | null };
      // /account/me 对匿名返回 200 + user:null（刻意的，见 Python 侧说明）
      if (!body || !body.user) return { state: "anonymous" };
      const user = toCurrentUser(body.user);
      return user ? { state: "ok", user } : { state: "anonymous" };
    } catch (error) {
      console.error("[auth] 身份服务不可用，按 503 处理（不放行）", error);
      return { state: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }

  function attach(request: Request, user: CurrentUser) {
    const target = request as RequestWithOptionalUser;
    target.user = user;
    // 旧体系里 sessionId 是 MySQL 会话表的主键。纯 JWT 没有服务端会话，
    // 这里放用户 id 只为兼容读它的少数几处（审计日志的 correlation）。
    target.sessionId = user.id;
  }

  return {
    async requireAuth(request: Request, response: Response, next: NextFunction) {
      const result = await resolve(request);
      if (result.state === "unavailable") {
        response.status(503).json({ success: false, error: "Identity service unavailable" });
        return;
      }
      if (result.state === "anonymous") {
        response.status(401).json({ success: false, error: "Authentication required" });
        return;
      }
      attach(request, result.user);
      next();
    },

    async optionalAuth(request: Request, _response: Response, next: NextFunction) {
      const result = await resolve(request);
      if (result.state === "ok") attach(request, result.user);
      next();
    },

    requireAdmin(request: Request, response: Response, next: NextFunction) {
      const user = (request as AuthenticatedRequest).user;
      if (!user) {
        response.status(401).json({ success: false, error: "Authentication required" });
        return;
      }
      if (!isAdminRole(user.role)) {
        response.status(403).json({ success: false, error: "Admin privileges required" });
        return;
      }
      next();
    },
  };
}

export type SlideRuleAuthMiddleware = ReturnType<typeof createSlideRuleAuthMiddleware>;
