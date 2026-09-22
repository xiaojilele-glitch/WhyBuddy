/**
 * 会话列表共享取数。
 *
 * 起因：真机实测 /agent-loop/workbench 首屏，`GET /api/sliderule/sessions` 被打
 * 了 2 次（CDP 调用栈同时指到 SidebarSessions 和 AppsWorkbench），纯白干。
 *
 * 这份测试盯两头：
 *   ① 并发真的合流了（否则这个模块白加）；
 *   ② **合流不许制造陈旧窗口**——只有 ① 的话，把它写成带 TTL 的缓存也全绿，
 *      而那样删完会话它还在列表里，用户会报"删不掉"。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSessionsListForTests,
  fetchSessionsList,
  invalidateSessionsList,
} from "../sessions-list-client";

const realFetch = globalThis.fetch;

function stubFetch(bodies: unknown[]) {
  let n = 0;
  const calls: number[] = [];
  const fn = vi.fn(async () => {
    const i = n++;
    calls.push(i);
    // 用一个微任务模拟在飞状态，让"并发"真的重叠
    await Promise.resolve();
    return {
      ok: true,
      json: async () => bodies[Math.min(i, bodies.length - 1)],
    } as unknown as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

beforeEach(() => __resetSessionsListForTests());
afterEach(() => {
  globalThis.fetch = realFetch;
  __resetSessionsListForTests();
});

describe("会话列表共享取数", () => {
  it("并发调用只发一次请求，两边拿到同一份", async () => {
    const { fn } = stubFetch([{ sessions: [{ sessionId: "s1" }] }]);
    const [a, b] = await Promise.all([fetchSessionsList(), fetchSessionsList()]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect((a.sessions as unknown[])?.length).toBe(1);
  });

  it("**不是缓存**：上一次结束之后再问，必须重新发", async () => {
    // 这条钉的是"没有陈旧窗口"。写成 TTL 缓存的话它会红。
    const { fn } = stubFetch([{ sessions: [{ sessionId: "s1" }] }, { sessions: [] }]);
    const first = await fetchSessionsList();
    const second = await fetchSessionsList();
    expect(fn).toHaveBeenCalledTimes(2);
    expect((first.sessions as unknown[]).length).toBe(1);
    expect((second.sessions as unknown[]).length).toBe(0);
  });

  it("invalidate 之后在飞的那次不再被共享——删完不会拿到旧列表", async () => {
    const { fn } = stubFetch([{ sessions: [{ sessionId: "s1" }] }, { sessions: [] }]);
    const inflight = fetchSessionsList(); // 删之前发出的那次
    invalidateSessionsList(); // 删掉了
    const after = fetchSessionsList(); // 删之后问
    expect(fn).toHaveBeenCalledTimes(2);
    expect((await after).sessions).toEqual([]);
    await inflight; // 旧的那次照常结束，不泄漏未处理拒绝
  });

  it("失败不会把飞行槽钉死：下一次照常重发", async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => {
      if (n++ === 0) return { ok: false, status: 500 } as unknown as Response;
      return { ok: true, json: async () => ({ sessions: [] }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(fetchSessionsList()).rejects.toThrow("HTTP 500");
    await expect(fetchSessionsList()).resolves.toEqual({ sessions: [] });
  });
});
