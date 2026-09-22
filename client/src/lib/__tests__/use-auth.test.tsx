/**
 * 登录态：降级取向与写权限判定（2026-08-02）。
 *
 * 盯两件事：
 *   ① 拿不到登录态时**按匿名降级**，而不是假设"可能登录着"；
 *   ② 无主的存量应用默认不可写（与后端 app_access 同一套规则）。
 *
 * ⚠️ 这一层只决定"按钮显不显示"。真正的授权在后端，这份测试**不能**用来证明
 * "别人改不了我的应用"——那条断言在 slide-rule-python/tests/test_app_routes_access.py。
 *
 * 仓库里 React 测试统一用 renderToStaticMarkup（没有 jsdom），所以 AuthProvider
 * 的 useEffect 流程测不了。这里覆盖的是它依赖的两块**纯逻辑**：客户端的降级
 * 行为、以及写权限判定。Provider 本身只是把这两块串起来。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANONYMOUS_CAPABILITIES,
  describeDriveAuthFailure,
  fetchCapabilities,
  fetchMe,
  type AuthUser,
} from "../auth-client";
import { canWriteApp } from "../use-auth";

const ALICE: AuthUser = {
  id: "u-alice",
  email: "alice@example.com",
  isSuperuser: false,
  isVerified: true,
};
const ROOT: AuthUser = { ...ALICE, id: "u-root", isSuperuser: true };

afterEach(() => vi.unstubAllGlobals());

describe("取登录态", () => {
  it("匿名时返回 null 而不是抛异常", async () => {
    // 后端对匿名返回 200 + user:null（不是 401）——匿名是正常状态。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ user: null }), { status: 200 }))
    );
    await expect(fetchMe()).resolves.toBeNull();
  });

  it("登录时返回用户", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ user: ALICE }), { status: 200 }))
    );
    await expect(fetchMe()).resolves.toMatchObject({ email: "alice@example.com" });
  });

  it("网络挂了按匿名降级，不抛", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    await expect(fetchMe()).resolves.toBeNull();
  });
});

describe("推演 401 文案", () => {
  it("侧栏还显示账号时，不要叫人去登录", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ user: ALICE }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const got = await describeDriveAuthFailure("请先登录后再推演");
    expect(got.stillLoggedIn).toBe(true);
    expect(got.banner).toContain("没带到");
    expect(got.step).not.toMatch(/登录 \/ 注册/);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/account/me"),
      expect.objectContaining({ cache: "no-store", credentials: "include" })
    );
  });

  it("真的没登录时，才指向左下角登录", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ user: null }), { status: 200 }))
    );
    const got = await describeDriveAuthFailure("请先登录后再推演");
    expect(got.stillLoggedIn).toBe(false);
    expect(got.banner).toContain("请先登录后再推演");
    expect(got.step).toContain("登录 / 注册");
  });
});

describe("取能力清单", () => {
  it("网络失败时退回最小权限，但浏览仍然开着", async () => {
    // 反过来（失败时假设可能登录着）会让按钮亮着、点了必然 401——比不显示更糟。
    // 而浏览必须保持可用：匿名本来就能看应用中心，不能因为这个接口挂了就空白。
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const caps = await fetchCapabilities();
    expect(caps).toEqual(ANONYMOUS_CAPABILITIES);
    expect(caps.can.browse).toBe(true);
    expect(caps.can.fork).toBe(false);
    expect(caps.can.drive).toBe(false);
  });

  it("非 2xx 同样降级", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(fetchCapabilities()).resolves.toEqual(ANONYMOUS_CAPABILITIES);
  });

  it("登录用户拿到写能力", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              loggedIn: true,
              isSuperuser: false,
              can: { browse: true, viewApp: true, fork: true, drive: true, manageOwn: true },
            }),
            { status: 200 }
          )
      )
    );
    const caps = await fetchCapabilities();
    expect(caps.can.fork).toBe(true);
    expect(caps.can.drive).toBe(true);
  });
});

describe("canWriteApp", () => {
  it("本人可写、别人不可写", () => {
    expect(canWriteApp("u-alice", ALICE)).toBe(true);
    expect(canWriteApp("u-bob", ALICE)).toBe(false);
  });

  it("匿名一律不可写", () => {
    expect(canWriteApp("u-alice", null)).toBe(false);
    expect(canWriteApp(null, null)).toBe(false);
  });

  it("无主的存量应用默认不可写，超管除外", () => {
    // 判成"谁都能改"等于权限一上线就把历史数据敞开；宁可少给不可多给。
    expect(canWriteApp(null, ALICE)).toBe(false);
    expect(canWriteApp(undefined, ALICE)).toBe(false);
    expect(canWriteApp("", ALICE)).toBe(false);
    expect(canWriteApp(null, ROOT)).toBe(true);
  });

  it("超管能改别人的", () => {
    expect(canWriteApp("u-alice", ROOT)).toBe(true);
  });

  it("与后端 app_access.can_write 保持同一套规则", () => {
    // 后端那份是 middlewares/current_user.py 的 can_write。两边漂移的表现是
    // "按钮亮着但点了 403"（或更糟：按钮灰着其实能做）。这里把规则抄在断言里，
    // 改动任何一边都应当同时改这条。
    const rules: Array<[string | null, AuthUser | null, boolean]> = [
      ["u-alice", ALICE, true],
      ["u-bob", ALICE, false],
      [null, ALICE, false],
      [null, ROOT, true],
      ["u-alice", null, false],
    ];
    for (const [owner, user, expected] of rules) {
      expect(canWriteApp(owner, user)).toBe(expected);
    }
  });
});
