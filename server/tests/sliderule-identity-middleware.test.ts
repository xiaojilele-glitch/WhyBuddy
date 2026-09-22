/**
 * Node 侧身份中间件（2026-08-03）。
 *
 * 旧账号体系整套下掉后，`/api/admin`、`/api/projects`、`/api/tasks` 的门卫换成了
 * 这一个。它是这次改动里**唯一有安全后果的新代码**——判错一次，管理台就对外敞开。
 *
 * 所以这份测试盯的全是"该拒绝时有没有拒绝"，尤其是三种容易写成放行的情况：
 *
 *   ① 身份服务连不上 → 必须 503，**绝不能因为"查不到就当匿名/当管理员"而放行**
 *   ② /account/me 对匿名返回 200 + user:null → 必须判成匿名，不能因为 2xx 就放行
 *   ③ 普通用户走到 requireAdmin → 403
 */

import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { createSlideRuleAuthMiddleware } from "../auth/sliderule-identity.js";

function fakeRequest(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function fakeResponse() {
  const captured: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      captured.status = code;
      return response;
    },
    json(body: unknown) {
      captured.body = body;
      return response;
    },
  };
  return { response: response as unknown as Response, captured };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response & { json(): Promise<unknown> };
}

const COOKIE = { cookie: "sliderule_token=abc123" };

describe("SlideRule 身份中间件", () => {
  it("没带凭据时直接 401，且不打身份服务", async () => {
    const fetchImpl = vi.fn();
    const mw = createSlideRuleAuthMiddleware({
      baseUrl: "http://python.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { response, captured } = fakeResponse();
    const next = vi.fn();

    await mw.requireAuth(fakeRequest(), response, next);

    expect(captured.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
    // 匿名请求是常态（爬虫、健康检查），为它们各打一次内部 HTTP 是纯浪费
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("凭据无效（后端回 user:null）时判匿名 → 401", async () => {
    // ⚠️ 这里后端返回的是 **200**。只看 response.ok 就放行的话，
    // 任何一个过期/伪造的 token 都能进管理台。
    const fetchImpl = vi.fn(async () => jsonResponse(200, { user: null }));
    const mw = createSlideRuleAuthMiddleware({
      baseUrl: "http://python.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { response, captured } = fakeResponse();
    const next = vi.fn();

    await mw.requireAuth(fakeRequest(COOKIE), response, next);

    expect(captured.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("身份服务挂了 → 503，不放行", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const mw = createSlideRuleAuthMiddleware({
      baseUrl: "http://python.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { response, captured } = fakeResponse();
    const next = vi.fn();

    await mw.requireAuth(fakeRequest(COOKIE), response, next);

    expect(captured.status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("身份服务回 5xx → 也是 503，不当成匿名也不放行", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    const mw = createSlideRuleAuthMiddleware({
      baseUrl: "http://python.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const { response, captured } = fakeResponse();
    const next = vi.fn();

    await mw.requireAuth(fakeRequest(COOKIE), response, next);

    expect(captured.status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("登录用户放行，并把凭据原样转发给身份服务", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        user: {
          id: "user-1",
          email: "user@example.com",
          displayName: "User One",
          isSuperuser: false,
          isVerified: true,
          createdAt: "2026-08-01T00:00:00Z",
        },
      })
    );
    const mw = createSlideRuleAuthMiddleware({
      baseUrl: "http://python.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const request = fakeRequest({ ...COOKIE, authorization: "Bearer abc123" });
    const { response } = fakeResponse();
    const next = vi.fn();

    await mw.requireAuth(request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect((request as Request & { user?: { id: string } }).user?.id).toBe("user-1");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://python.test/api/sliderule/account/me");
    const headers = init.headers as Record<string, string>;
    expect(headers.cookie).toBe("sliderule_token=abc123");
    expect(headers.authorization).toBe("Bearer abc123");
  });

  it("普通用户过不了 requireAdmin", async () => {
    const mw = createSlideRuleAuthMiddleware({ baseUrl: "http://python.test" });
    const request = fakeRequest();
    (request as Request & { user?: unknown }).user = { id: "u", role: "user" };
    const { response, captured } = fakeResponse();
    const next = vi.fn();

    mw.requireAdmin(request, response, next);

    expect(captured.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("超管过 requireAdmin", async () => {
    const mw = createSlideRuleAuthMiddleware({ baseUrl: "http://python.test" });
    const request = fakeRequest();
    (request as Request & { user?: unknown }).user = { id: "u", role: "super_admin" };
    const { response } = fakeResponse();
    const next = vi.fn();

    mw.requireAdmin(request, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("requireAdmin 单独用时也要求已认证——不假设上游一定跑过 requireAuth", async () => {
    const mw = createSlideRuleAuthMiddleware({ baseUrl: "http://python.test" });
    const { response, captured } = fakeResponse();
    const next = vi.fn();

    mw.requireAdmin(fakeRequest(), response, next);

    expect(captured.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("optionalAuth 从不拒绝，但也不会在服务不可用时凭空造出用户", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("down");
    });
    const mw = createSlideRuleAuthMiddleware({
      baseUrl: "http://python.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const request = fakeRequest(COOKIE);
    const { response } = fakeResponse();
    const next = vi.fn();

    await mw.optionalAuth(request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect((request as Request & { user?: unknown }).user).toBeUndefined();
  });
});
