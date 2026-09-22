/**
 * SSE 的 `spec_page` 事件必须落到 `onSpecPage` 上。
 *
 * ## 这条防的是"东西早就在内存里，右侧还在转圈"
 *
 * 新链路一轮 8~9 分钟，第 3 步在**第二分钟**就交出第一份能直接打开的 HTML。
 * 从后端埋点到右侧上屏中间有四段接线（页面回调 → 请求域 sink → 驱动器排水
 * → 这里的事件分发 → 舞台组件），**任何一段断了都不会有一处报错**：页面照
 * 常产出、模型照常返回、闸照常绿，只是右侧一直转。
 *
 * 后端那半在 tests/test_spec_first_page_stream.py 从流的另一端验过。
 * 这里验前端这一半：喂一段真实形状的 SSE 字节流，看回调收到了什么。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { driveFullViaPythonStream } from "../sliderule-marathon-driver";

const STATE = { sessionId: "s-1", goal: { text: "做一个工单系统" } } as never;

const HTML = '<!DOCTYPE html><html><body><main>宠物档案</main></body></html>';

/** 把若干事件拼成 SSE 字节流塞进 Response.body 的形状。 */
function sseStream(events: Array<Record<string, unknown>>) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: bytes };
        },
      }),
    },
    clone: () => ({ json: async () => ({}) }),
    json: async () => ({}),
  };
}

function drive(events: Array<Record<string, unknown>>, onSpecPage: (p: unknown) => void) {
  vi.stubGlobal("fetch", vi.fn(async () => sseStream(events)));
  return driveFullViaPythonStream(STATE, "做一个工单系统", { onSpecPage } as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("spec_page 事件落到 onSpecPage", () => {
  it("字段一个不漏地传过去", async () => {
    const got: unknown[] = [];
    await drive(
      [
        { type: "spec_page", pageId: "p1", html: HTML, current: 1, total: 3, bound: false },
        { type: "complete", state: STATE },
      ],
      (p) => got.push(p)
    );
    expect(got).toEqual([
      // device 缺席按桌面兜底（老后端没有这个字段，行为与从前一致）
      { pageId: "p1", html: HTML, current: 1, total: 3, bound: false, device: "desktop" },
    ]);
  });

  it("device=phone 原样带过去 —— 竖屏页要进竖屏画布（2026-08-14）", async () => {
    const got: Array<{ device: string }> = [];
    await drive(
      [
        { type: "spec_page", pageId: "p1", html: HTML, current: 1, total: 1, bound: false, device: "phone" },
        { type: "complete", state: STATE },
      ],
      (p) => got.push(p as { device: string })
    );
    expect(got[0].device).toBe("phone");
  });

  it("多页按到达顺序逐条回调 —— 不是攒齐一次给", async () => {
    const got: Array<{ pageId: string }> = [];
    await drive(
      [
        { type: "spec_page", pageId: "p1", html: HTML, current: 1, total: 2, bound: false },
        { type: "spec_page", pageId: "p2", html: HTML, current: 2, total: 2, bound: false },
        { type: "complete", state: STATE },
      ],
      (p) => got.push(p as { pageId: string })
    );
    expect(got.map((p) => p.pageId)).toEqual(["p1", "p2"]);
  });

  it("bound=true 原样带过去 —— 第 6.5 步打完孔的那一版", async () => {
    const got: Array<{ bound: boolean }> = [];
    await drive(
      [
        { type: "spec_page", pageId: "p1", html: HTML, current: 1, total: 1, bound: true },
        { type: "complete", state: STATE },
      ],
      (p) => got.push(p as { bound: boolean })
    );
    expect(got[0].bound).toBe(true);
  });

  it("html 缺席不回调 —— 少一页比渲染一整块白强", async () => {
    /**
     * 空文档在右侧是一整块白，看起来像"生成坏了"，而实际只是这条事件没带
     * 内容。⚠ `bound` 缺席时按 false 处理（不是 undefined）：说不清有没有
     * 接上数据时，如实说"还没接"。
     */
    const got: unknown[] = [];
    await drive(
      [
        { type: "spec_page", pageId: "p1", current: 1, total: 1 },
        { type: "spec_page", pageId: "p2", html: "", current: 1, total: 1 },
        { type: "spec_page", pageId: "p3", html: HTML, current: 1, total: 1 },
        { type: "complete", state: STATE },
      ],
      (p) => got.push(p)
    );
    expect(got).toEqual([
      { pageId: "p3", html: HTML, current: 1, total: 1, bound: false, device: "desktop" },
    ]);
  });

  it("progress_heartbeat 落到 onProgressHeartbeat，不另开进度 API", async () => {
    const stages: Array<{ stage?: string; label?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseStream([
          {
            type: "progress_heartbeat",
            stage: "specfirst.spec",
            label: "起草规格",
          },
          { type: "complete", state: STATE },
        ])
      )
    );
    await driveFullViaPythonStream(STATE, "做一个工单系统", {
      onProgressHeartbeat: (stage, label) => stages.push({ stage, label }),
    } as never);
    expect(stages).toEqual([{ stage: "specfirst.spec", label: "起草规格" }]);
  });

  it("没接这个回调的调用方照常跑完 —— 不炸", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseStream([
          { type: "spec_page", pageId: "p1", html: HTML, current: 1, total: 1 },
          { type: "complete", state: STATE },
        ])
      )
    );
    const out = await driveFullViaPythonStream(STATE, "做一个工单系统");
    expect(out?.finalState).toBeTruthy();
  });
});

/**
 * `spec_page_renamed`（2026-09-06）——服务端第 4.5 步把草稿 id 改成语义 id。
 *
 * 这条流跟上面那条共用一段接线，但**顺序**是它独有的要害：改名必须排在改名
 * 后那批 `spec_page` 之前。晚一步，消费方已经按新 id 建好了重复的卡。
 * 服务端靠"跟页面走同一条队列"保证先后（见 v5_full_driver._PageRenamed 头注），
 * 这里验前端确实按到达顺序转发、不攒不重排。
 */
describe("spec_page_renamed 事件落到 onSpecPageRenamed", () => {
  function driveRename(
    events: Array<Record<string, unknown>>,
    opts: Record<string, unknown>
  ) {
    vi.stubGlobal("fetch", vi.fn(async () => sseStream(events)));
    return driveFullViaPythonStream(STATE, "做一个工单系统", opts as never);
  }

  it("两头都传过去", async () => {
    const got: unknown[] = [];
    await driveRename(
      [
        { type: "spec_page_renamed", from: "p1", to: "seat_selection" },
        { type: "complete", state: STATE },
      ],
      { onSpecPageRenamed: (r: unknown) => got.push(r) }
    );
    expect(got).toEqual([{ from: "p1", to: "seat_selection" }]);
  });

  it("改名和页面按到达顺序转发，不攒不重排", async () => {
    // 要害。攒起来批量发、或者两条流各走一个队列，都会让"先改名后建卡"
    // 这个前提失效——而那正是真机 12 张卡的成因。
    const trail: string[] = [];
    await driveRename(
      [
        { type: "spec_page", pageId: "p1", html: HTML, current: 1, total: 1 },
        { type: "spec_page_renamed", from: "p1", to: "seat_selection" },
        {
          type: "spec_page",
          pageId: "seat_selection",
          html: HTML,
          current: 1,
          total: 1,
          bound: true,
        },
        { type: "complete", state: STATE },
      ],
      {
        onSpecPage: (p: { pageId: string }) => trail.push(`page:${p.pageId}`),
        onSpecPageRenamed: (r: { to: string }) => trail.push(`rename:${r.to}`),
      }
    );
    expect(trail).toEqual([
      "page:p1",
      "rename:seat_selection",
      "page:seat_selection",
    ]);
  });

  it.each([
    ["缺 from", { type: "spec_page_renamed", to: "seat_selection" }],
    ["缺 to", { type: "spec_page_renamed", from: "p1" }],
    ["改成自己", { type: "spec_page_renamed", from: "p1", to: "p1" }],
  ])("%s 不派发（拿空 id 去找卡 = 静默不动，比报错难查）", async (_why, ev) => {
    const got: unknown[] = [];
    await driveRename([ev, { type: "complete", state: STATE }], {
      onSpecPageRenamed: (r: unknown) => got.push(r),
    });
    expect(got).toEqual([]);
  });

  it("没接这个回调也不许炸——老前端要能收新事件", async () => {
    // 服务端先上、前端后上是常态（同一份后端还服务着已缓存的旧 bundle）。
    const pages: unknown[] = [];
    await driveRename(
      [
        { type: "spec_page_renamed", from: "p1", to: "seat_selection" },
        { type: "spec_page", pageId: "p1", html: HTML, current: 1, total: 1 },
        { type: "complete", state: STATE },
      ],
      { onSpecPage: (p: unknown) => pages.push(p) }
    );
    expect(pages).toHaveLength(1);
  });
});
