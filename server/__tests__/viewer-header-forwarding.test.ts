/**
 * Node → Python 的转发必须带上"这个请求是谁发的"。
 *
 * ## 这组测试为什么存在
 *
 * 2026-08-06 用户实测：登录之后新建会话、跑完一整趟推演，左侧「最近」里
 * **一条都没有**，显示"暂无历史会话"。会话其实建出来了、归属也对，问题在
 * 读取侧。
 *
 * 根因是一个很别扭的不对称：
 *
 *   POST /api/sliderule/sessions   Node 里**没有**显式路由 → 落到文件末尾的
 *                                  兜底流式代理 → 它转发 cookie → Python 认得出
 *                                  用户 → 会话建出来有主 ✅
 *   GET  /api/sliderule/sessions   Node 里**有**显式路由 → 走
 *                                  callPythonSlideRuleGet → 那里只发
 *                                  X-Internal-Key → Python 看到的是匿名 →
 *                                  filter_sessions(…, None) → 空列表 ❌
 *
 * 实测复现（改之前，直接用旧 Node 的等价请求打 Python）：
 *
 *     curl -H "X-Internal-Key: …" /api/sliderule/sessions        → sessions: 0
 *     curl -H "X-Internal-Key: …" /api/sliderule/sessions/{id}   → HTTP 404
 *
 * 同一个根因还造成"应用中心点开应用是一片空白"——GET /sessions/{id} 匿名
 * 拿到 404，页面没有会话可水合。
 *
 * ## 为什么容易再犯
 *
 * 2026-08-02 修过一次同样的毛病，但只修了兜底代理那一处，判定逻辑就地写在
 * 路由里；显式路由用的是另一个文件里的 helper，没跟着改。**两处各写一份
 * 转发规则 = 必然漂移**。现在只有 viewerHeadersFrom 一个实现，两边都用它，
 * 这组测试钉住的就是"helper 真的会把身份带上"。
 *
 * ## 白名单，不是整包透传
 *
 * 只带 cookie 和 authorization。host / content-length 得由 fetch 按新请求算，
 * 原样带过去会让上游拿到错的值。
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  callPythonSlideRule,
  delegateToPythonSlideRule,
  viewerHeadersFrom,
} from "../sliderule/python-delegation.js";

const KEY = "test-internal-key";
const BASE = "http://python.invalid";

function stubFetch() {
  const spy = vi.fn(async () => new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function headersOf(spy: ReturnType<typeof stubFetch>): Record<string, string> {
  const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("viewerHeadersFrom", () => {
  it("摘出 cookie 与 authorization", () => {
    expect(
      viewerHeadersFrom({ headers: { cookie: "sr_token=abc", authorization: "Bearer xyz" } }),
    ).toEqual({ cookie: "sr_token=abc", authorization: "Bearer xyz" });
  });

  it("没有身份头时返回空对象——不能凭空造一个", () => {
    expect(viewerHeadersFrom({ headers: {} })).toEqual({});
  });

  it("空串按没有处理", () => {
    // 空 cookie 头带过去会让上游把它当成"有 cookie 但内容为空"，
    // 与"根本没登录"是两回事，判定路径可能不同。统一归一成"没有"。
    expect(viewerHeadersFrom({ headers: { cookie: "", authorization: "" } })).toEqual({});
  });

  it("非字符串（数组头）不带过去", () => {
    expect(viewerHeadersFrom({ headers: { cookie: ["a", "b"] } })).toEqual({});
  });

  it("不捎带别的头——host/content-length 必须由 fetch 自己算", () => {
    const out = viewerHeadersFrom({
      headers: {
        cookie: "sr_token=abc",
        host: "example.com",
        "content-length": "123",
        "x-forwarded-for": "1.2.3.4",
      },
    });
    expect(Object.keys(out).sort()).toEqual(["cookie"]);
  });
});

describe("delegateToPythonSlideRule 转发身份", () => {
  it("GET 带上 cookie —— 会话列表就是栽在这条上", async () => {
    const spy = stubFetch();
    await delegateToPythonSlideRule(BASE, "/api/sliderule/sessions", "GET", null, KEY, {
      viewer: { cookie: "sr_token=abc" },
    });
    const h = headersOf(spy);
    expect(h["cookie"]).toBe("sr_token=abc");
    // 内部密钥仍然要在：它回答的是另一个问题（Node 有没有权调 Python）
    expect(h["X-Internal-Key"]).toBe(KEY);
  });

  it("DELETE 也带 —— 删别人的会话必须被判出来", async () => {
    const spy = stubFetch();
    await delegateToPythonSlideRule(BASE, "/api/sliderule/sessions/x", "DELETE", null, KEY, {
      viewer: { cookie: "sr_token=abc" },
    });
    expect(headersOf(spy)["cookie"]).toBe("sr_token=abc");
  });

  it("PUT 也带 —— 保存要判归属，不带就成了谁都能覆盖", async () => {
    const spy = stubFetch();
    await delegateToPythonSlideRule(BASE, "/api/sliderule/sessions/x", "PUT", { a: 1 }, KEY, {
      viewer: { authorization: "Bearer xyz" },
    });
    expect(headersOf(spy)["authorization"]).toBe("Bearer xyz");
  });

  it("不传 viewer 时保持匿名，不能瞎编一个身份", async () => {
    const spy = stubFetch();
    await delegateToPythonSlideRule(BASE, "/api/sliderule/sessions", "GET", null, KEY);
    const h = headersOf(spy);
    expect(h["cookie"]).toBeUndefined();
    expect(h["authorization"]).toBeUndefined();
    expect(h["X-Internal-Key"]).toBe(KEY);
  });
});

describe("callPythonSlideRule 转发身份", () => {
  it("POST 推演类调用同样要带 —— 推演要求登录", async () => {
    const spy = stubFetch();
    await callPythonSlideRule(BASE, "/api/sliderule/drive-full", { goal: "x" }, KEY, {
      viewer: { cookie: "sr_token=abc" },
    });
    expect(headersOf(spy)["cookie"]).toBe("sr_token=abc");
  });
});
