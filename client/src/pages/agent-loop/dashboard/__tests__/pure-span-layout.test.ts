/**
 * 纯函数落位。
 *
 * 这份测试盯的不是"排得好不好看"（那是截图的活），是几条能用数学判定的性质，
 * 外加**一条反向判据**：应用中心那面墙必须真的走这条路。
 *
 * 为什么反向那条最重要：不传 `heightOf` 时组件**静默退回测量路**，页面看起来
 * 完全正常，只是那个「切 tab 后只显示第一行 4 张、等多久都不好」的死锁会悄悄
 * 回来（2026-08-23 真机 8 次中 4 次）。正向判据全绿也照不出来。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildPureSpanLayout,
  cellWidthForSpan,
  clampSpan,
} from "../pure-span-layout";

const COLS = 4;
const W = 100;
const G = 10;

/** device 三档的高度算式，跟 wallCardHeight 同款。 */
const H = (aspect: number) => (cellW: number) => Math.round(cellW / aspect);

function layout(heights: number[], spans: number[] = []) {
  return buildPureSpanLayout({
    items: heights.map((h, i) => ({ h, span: spans[i] ?? 1 })),
    columnCount: COLS,
    columnWidth: W,
    gutter: G,
    spanOf: it => it.span,
    heightOf: it => it.h,
  });
}

describe("纯函数落位", () => {
  it("全部落位——没有「待量」的洞", () => {
    const p = layout([100, 200, 150, 120, 180, 90]);
    expect(p.firstUnplaced()).toBe(6);
    for (let i = 0; i < 6; i++) expect(p.get(i)).toBeDefined();
  });

  it("**追加下一页不动已有卡片**——所以重算不会让墙重新拍一次", () => {
    // 贪心最短列是增量的：先摆前 8 个再摆后 4 个，与一次摆完 12 个结果相同。
    // 这条成立，纯函数路才敢每帧重算；不成立就得把落位存成状态，也就绕回
    // 原来那个「状态丢了补不回来」的死锁。
    const hs = [120, 200, 90, 160, 140, 110, 175, 130, 95, 210, 105, 150];
    const all = layout(hs);
    const prefix = layout(hs.slice(0, 8));
    for (let i = 0; i < 8; i++) {
      expect(all.get(i)).toEqual(prefix.get(i));
    }
  });

  it("同一份输入算两遍，结果逐格相同（确定性）", () => {
    const hs = [120, 200, 90, 160, 140, 110];
    const a = layout(hs);
    const b = layout(hs);
    for (let i = 0; i < hs.length; i++) expect(a.get(i)).toEqual(b.get(i));
  });

  it("跨列格宽 = 列宽×span + 间距×(span-1)", () => {
    expect(cellWidthForSpan(W, G, 1)).toBe(100);
    expect(cellWidthForSpan(W, G, 2)).toBe(210);
    const p = layout([100, 100], [2, 1]);
    expect(p.get(0)?.width).toBe(210);
    expect(p.get(1)?.width).toBe(100);
  });

  it("span 被钳进 [1, 列数]，坏值退回 1", () => {
    expect(clampSpan(0, COLS)).toBe(1);
    expect(clampSpan(-3, COLS)).toBe(1);
    expect(clampSpan(99, COLS)).toBe(COLS);
    expect(clampSpan(Number.NaN, COLS)).toBe(1);
  });

  it("**高度 0 / NaN 被钳到 ≥1** —— 否则整列塌成同一个 top", () => {
    // 这正是要根治的那个现象（所有卡叠在一起），不能让一个坏高度从另一头带回来。
    const p = buildPureSpanLayout({
      items: [0, Number.NaN, -5, 100],
      columnCount: 1,
      columnWidth: W,
      gutter: G,
      spanOf: () => 1,
      heightOf: h => h,
    });
    const tops = [0, 1, 2, 3].map(i => p.get(i)!.top);
    expect(new Set(tops).size).toBe(4);
    for (let i = 0; i < 4; i++) expect(p.get(i)!.height).toBeGreaterThanOrEqual(1);
  });

  it("桌面/手机两档高度按宽高比算，互不影响", () => {
    expect(H(1280 / 720)(306)).toBe(172);
    expect(H(720 / 1280)(306)).toBe(544);
  });
});

/** 剥注释再看源码——本仓踩过：grep 的词同时出现在文档字符串里，改回去照样绿。 */
function stripped(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("调用方就在 ColumnsWall——纪律与链路都要钉住", () => {
  it("SpanMasonry 的 heightOf 路仍完整（组件库那两面墙将来可以用）", () => {
    // 这条跟应用中心无关：组件库那两面墙的区块高度是真渲染才知道的，用不了
    // 纯函数路，所以 SpanMasonry 的测量路必须继续完整。
    const src = stripped("../SpanMasonry.tsx");
    expect(src).toContain("if (!pure && needsFreshBatch)");
    expect(src).toContain("const cellRef = pure ? undefined : setRef");
    expect(src).toContain("buildPureSpanLayout");
  });

  it("**这个引擎真的被用上了** —— 不是写对了就算数，要接在通电的插座上", () => {
    // ⚠ 本仓最贵的一条纪律（CLAUDE.md 第一条）的具象化。
    //
    //   8-23 上午 这个引擎为 A 方案写成，当天下午整体换成两端对齐行
    //             （JustifiedWall），它**没有调用方**了——这条判据当时写的是
    //             「目前没有调用方」，如实记着。
    //   8-23 晚   卡片改成"字在图外"，等高变宽下窄卡标题只剩「构建面…」，
    //             于是换回等宽（ColumnsWall），这个引擎接了回来。
    //
    // 正向：ColumnsWall 必须真的调它——只 import 不调用，墙照样能编译过。
    const wall = stripped("../ColumnsWall.tsx");
    expect(wall).toContain("buildPureSpanLayout({");
    // 等宽是这面墙的立身之本：谁都不许跨列，否则宽度又不由列决定，
    // "字在图外"的前提就没了。
    expect(wall).toContain("spanOf: () => 1");
  });

  it("**应用中心已经不走测量路了** —— 那条死锁在结构上不成立", () => {
    // 反向：这面墙要是哪天又接回 SpanMasonry 而不传 heightOf，隐藏批次那套
    //   （以及 2026-08-23 那个「只显示第一行、等多久都不好」）就回来了。
    const wall = stripped("../AppsWorkbench.tsx");
    expect(wall).toContain("ColumnsWall");
    expect(wall).not.toContain("SpanMasonry");
  });
});
