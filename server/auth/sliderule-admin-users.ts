/**
 * 管理台的用户读取器——数据源是**新身份库**（Neon 的 `sliderule_user`）。
 *
 * 旧账号体系整体下掉后（2026-08-03），`/api/admin/users` 原来读的 MySQL
 * `users` 表已经没有写入方了。继续读它只会得到一张空表或一堆再也登录不上的
 * 历史账号——比直接报错更糟，因为看上去还"能用"。
 *
 * Node 不直连身份库：连接串、建表 DDL、密码哈希格式都在 Python 那边，
 * 复制一份 SQL 过来就等于把同一张表的读写规则维护两遍。走 HTTP 问它。
 *
 * ## 凭据要一路带过去
 *
 * 这里**不用内部密钥**，而是把浏览器那份 Cookie/Bearer 原样转发。
 * 用内部密钥的话，Python 侧只能确认"是 Node 调的"，没法确认"调用者是超管"——
 * 判定权就全押在 Node 的 requireAdmin 上了。转发真实凭据，Python 的
 * `SuperUser` 依赖会独立再判一次；两层都得过。
 */

import type { ForwardedCredentials } from "./sliderule-identity.js";
import { slideRuleBaseUrl } from "./sliderule-identity.js";

const DEFAULT_TIMEOUT_MS = 8000;

/** 管理台需要的用户字段。与 Python `User.public()` 一一对应——不含密码哈希。 */
export interface AdminUserView {
  id: string;
  email: string;
  displayName: string | null;
  isSuperuser: boolean;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  sessions: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
}

export interface AdminUsersReader {
  list(auth: ForwardedCredentials, q?: string): Promise<AdminUserView[]>;
  findById(userId: string, auth: ForwardedCredentials): Promise<AdminUserView | null>;
  setActive(
    userId: string,
    isActive: boolean,
    auth: ForwardedCredentials,
  ): Promise<AdminUserView | null>;
}

export interface SlideRuleAdminUsersOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function toView(raw: unknown): AdminUserView | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  if (!id) return null;
  return {
    id,
    email: typeof record.email === "string" ? record.email : "",
    displayName: typeof record.displayName === "string" ? record.displayName : null,
    isSuperuser: record.isSuperuser === true,
    isVerified: record.isVerified === true,
    isActive: record.isActive !== false,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
    lastLoginAt: typeof record.lastLoginAt === "string" ? record.lastLoginAt : null,
    sessions: Number(record.sessions) || 0,
    estimatedTokens: Number(record.estimatedTokens) || 0,
    estimatedCostUsd: Number(record.estimatedCostUsd) || 0,
  };
}

export function createSlideRuleAdminUsersReader(
  options: SlideRuleAdminUsersOptions = {}
): AdminUsersReader {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(
    path: string,
    auth: ForwardedCredentials,
    init: { method?: string; body?: string } = {},
  ): Promise<unknown> {
    const doFetch = options.fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== "function") throw new Error("fetch unavailable");
    const base = options.baseUrl
      ? options.baseUrl.replace(/\/+$/, "")
      : slideRuleBaseUrl();

    const headers: Record<string, string> = { accept: "application/json" };
    if (auth.cookie) headers.cookie = auth.cookie;
    if (auth.authorization) headers.authorization = auth.authorization;
    if (init.body) headers["content-type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body,
        signal: controller.signal,
      });
      // 404 交给调用方判断是"没这个人"还是"路径不对"——两者响应体不同，
      // 但对管理台而言都是"查不到"，统一返回 null 更简单。
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`身份服务返回 ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async list(auth, q) {
      const query = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const body = (await call(`/api/sliderule/account/admin/users${query}`, auth)) as
        | { items?: unknown }
        | null;
      const items = body && Array.isArray(body.items) ? body.items : [];
      return items.map(toView).filter((entry): entry is AdminUserView => entry !== null);
    },

    async findById(userId, auth) {
      const body = (await call(
        `/api/sliderule/account/admin/users/${encodeURIComponent(userId)}`,
        auth
      )) as { user?: unknown } | null;
      if (!body) return null;
      return toView(body.user);
    },

    async setActive(userId, isActive, auth) {
      const body = (await call(
        `/api/sliderule/account/admin/users/${encodeURIComponent(userId)}`,
        auth,
        { method: "PATCH", body: JSON.stringify({ isActive }) },
      )) as { user?: unknown } | null;
      if (!body) return null;
      return toView(body.user);
    },
  };
}
