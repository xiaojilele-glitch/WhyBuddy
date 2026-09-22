/**
 * 跨列规则：哪些卡该占两列。
 *
 * 这里守的是**诚实性**，不是好看：跨列必须由真实信息决定，同一份数据两次调用
 * 必须给同一个集合。随机跨列能立刻做出错落感，但那是假信息——用户会以为宽卡
 * 代表什么，而且刷新一次就换一批。
 */

import { describe, it, expect } from "vitest";
import { computeSpanKeys, spanForColumnCount } from "../app-wall-span";
import type { GalleryItem } from "../AppsWorkbench";

function appItem(key: string, device: string, pageCount: number): GalleryItem {
  return {
    key,
    source: "app",
    goal: key,
    appId: key,
    summary: {
      id: key,
      root_id: key,
      parent_id: null,
      version: 1,
      session_id: null,
      goal: key,
      gate_passed: true,
      created_at: "2026-07-31T00:00:00Z",
      product_name: key,
      theme_id: "t",
      theme_label: "T",
      device,
      landing_page_ref: "p",
      entity_count: 3,
      page_count: pageCount,
    },
  } as GalleryItem;
}

function sessionItem(key: string): GalleryItem {
  return { key, source: "session", goal: key, sessionId: key } as GalleryItem;
}

describe("computeSpanKeys", () => {
  it("只有桌面档有资格跨列", () => {
    // 手机档是 405×720（9:16）的竖比例，跨两列会算出 1000px 以上的巨条。
    const items = [
      appItem("phone-1", "phone", 99),
      appItem("phone-2", "phone", 98),
      appItem("desk-1", "desktop", 5),
      appItem("desk-2", "desktop", 4),
      appItem("desk-3", "desktop", 3),
      appItem("desk-4", "desktop", 2),
    ];
    const keys = computeSpanKeys(items);
    // 手机档页面数最多也不该入选
    expect(keys.has("phone-1")).toBe(false);
    expect(keys.has("phone-2")).toBe(false);
    expect([...keys].every(k => k.startsWith("desk"))).toBe(true);
  });

  it("device 为空串按桌面处理（跟 aspectForDevice 取向一致）", () => {
    const items = Array.from({ length: 8 }, (_, i) => appItem(`a${i}`, "", 8 - i));
    const keys = computeSpanKeys(items);
    expect(keys.size).toBe(2); // floor(8 * 0.25)
    // a0 页面数最多 → 一定在合格池里；它排在展示序第一位，第一个槽位就落在它身上
    expect(keys.has("a0")).toBe(true);
  });

  it("按页面数降序取前 ratio", () => {
    const items = [
      appItem("few", "desktop", 1),
      appItem("most", "desktop", 9),
      appItem("mid", "desktop", 5),
      appItem("least", "desktop", 0),
    ];
    const keys = computeSpanKeys(items); // floor(4*0.25) = 1
    expect([...keys]).toEqual(["most"]);
  });

  it("会话卡（无摘要）**照样参与**——2026-08-03 改口径", () => {
    // 旧口径要求 source==="app" && summary，于是会话落库之后墙上那批 session 卡
    // 全被挡在候选池外：候选池一小，floor(n*0.25) 跟着变小甚至归零，整面墙退回
    // 平网格。现在跟 aspectForDevice 对齐——**只排除明确写着 phone 的**，
    // 没有 summary 的按桌面算（错判成桌面只是偏宽，错判成手机会压成窄条）。
    const items = Array.from({ length: 8 }, (_, i) => sessionItem(`s${i}`));
    expect(computeSpanKeys(items).size).toBe(2); // floor(8 * 0.25)
  });

  it("明确写着 phone 的仍然出局——这条是这套规则的地基", () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => appItem(`d${i}`, "desktop", 5)),
      ...Array.from({ length: 6 }, (_, i) => appItem(`p${i}`, "phone", 9)),
    ];
    const keys = computeSpanKeys(items);
    // phone 卡页面数更高，但一张都不该被选中：9:16 跨两列会算出 1400px+ 的巨条
    expect([...keys].every(k => k.startsWith("d"))).toBe(true);
  });

  it("同一份数据两次调用给同一个集合（不能随机）", () => {
    const items = Array.from({ length: 12 }, (_, i) => appItem(`a${i}`, "desktop", i % 4));
    const a = [...computeSpanKeys(items)].sort();
    const b = [...computeSpanKeys(items)].sort();
    expect(a).toEqual(b);
  });

  it("段内页面数并列时按 key 破平（同一份输入必须给同一个集合）", () => {
    // 不破平的话「这一段里谁最完整」在并列时就没有定义，同一份数据可能给出
    // 不同的跨列集合。
    //
    // ⚠ 作用域说明：2026-08-03 起选卡是**分段**做的（见实现），所以换了展示序，
    // 选中的那批本来就该跟着变——那是"按展示序铺开"的目的，不是缺陷。这里钉的
    // 是「同一份输入 → 同一个集合」，以及「并列时取 key 较小的那张」。
    const mk = () => [
      appItem("b", "desktop", 5),
      appItem("a", "desktop", 5),
      appItem("d", "desktop", 5),
      appItem("c", "desktop", 5),
      appItem("f", "desktop", 5),
      appItem("e", "desktop", 5),
      appItem("h", "desktop", 5),
      appItem("g", "desktop", 5),
    ];
    // take = 2 → 两段 [b,a,d,c] / [f,e,h,g]，段内全部并列 → 各取 key 最小的
    expect([...computeSpanKeys(mk())].sort()).toEqual(["a", "e"]);
    // 同一份输入再算一次，结果必须逐字一致
    expect([...computeSpanKeys(mk())].sort()).toEqual(["a", "e"]);
  });

  it("段内比的是页面数——一段里最完整的那张才拿两列", () => {
    const items = [
      appItem("s1-few", "desktop", 1),
      appItem("s1-most", "desktop", 9),
      appItem("s1-mid", "desktop", 4),
      appItem("s1-x", "desktop", 2),
      appItem("s2-x", "desktop", 3),
      appItem("s2-most", "desktop", 8),
      appItem("s2-few", "desktop", 1),
      appItem("s2-mid", "desktop", 5),
    ];
    expect([...computeSpanKeys(items)].sort()).toEqual(["s1-most", "s2-most"]);
  });

  it("宽卡在展示序上**铺开**，不能全挤在头部", () => {
    // 这条是 2026-08-03 这次修的核心：墙按最近更新排，而最近几轮生成的应用
    // 页面数都是 5~6，于是「页面最多的前 1/4」≈「最近更新的前 1/4」，宽卡全在
    // 头部，往下滚几行一张都没有。
    const items = Array.from({ length: 24 }, (_, i) =>
      // 页面数随位置递减：不铺开的话选中的必然是 a0..a5 这一坨
      appItem(`a${i}`, "desktop", 24 - i)
    );
    const keys = computeSpanKeys(items); // take = 6
    const positions = items.map((it, i) => (keys.has(it.key) ? i : -1)).filter(i => i >= 0);
    expect(positions.length).toBe(6);
    // 最后一张宽卡必须落在下半场——头部堆一坨的话这个断言直接红
    expect(positions[positions.length - 1]).toBeGreaterThan(items.length / 2);
  });

  it("卡片太少时一张都不跨（floor 到 0）", () => {
    expect(computeSpanKeys([appItem("only", "desktop", 5)]).size).toBe(0);
    expect(computeSpanKeys([]).size).toBe(0);
  });

  it("ratio 可调，且落在有资格的卡上", () => {
    const items = Array.from({ length: 20 }, (_, i) => appItem(`a${i}`, "desktop", 20 - i));
    expect(computeSpanKeys(items, 0.25).size).toBe(5);
    expect(computeSpanKeys(items, 0.5).size).toBe(10);
  });
});

describe("spanForColumnCount", () => {
  it("列数不足 3 时跨列退回 1 —— 窄屏不能让一张卡吃掉整行", () => {
    expect(spanForColumnCount(true, 1)).toBe(1);
    expect(spanForColumnCount(true, 2)).toBe(1);
    expect(spanForColumnCount(true, 3)).toBe(2);
    expect(spanForColumnCount(true, 5)).toBe(2);
  });

  it("非跨列卡任何列数下都是 1", () => {
    expect(spanForColumnCount(false, 5)).toBe(1);
    expect(spanForColumnCount(false, 1)).toBe(1);
  });
});
