// @vitest-environment jsdom
/**
 * 刀 1（块矩形）的判据（2026-08-27）。
 *
 * 这一刀最容易出的两种错都**不报错**，所以判据必须能咬住它们：
 *
 *   1. 量早了——绑定之前表格块只有模板行，高度是真实的几分之一
 *   2. 世代号合成一条——布局变了矩形已经飘了，却被认成新鲜的
 *
 * 每条正向判据都配了反向的那一半（CLAUDE.md 第三条）。写完按第二条把修复
 * 改回去验过：见每条判据上的「变异」注。
 */
import { describe, expect, it } from "vitest";

import {
  BLOCK_KIND_ATTR,
  BLOCK_MARK_ATTR,
  listBlocks,
} from "../page-blocks";
import type { BlockRectSnapshot } from "../block-rects";
import {
  EMPTY_BLOCK_RECTS,
  blockKey,
  blockRectAt,
  deriveGenerations,
  isBlockRectsStale,
  measureBlockRects,
  shouldAdoptSnapshot,
} from "../block-rects";

/** jsdom 不做布局，`getBoundingClientRect` 恒回 0。按元素挂一份假矩形。 */
function stubRect(
  el: Element,
  r: { left: number; top: number; width: number; height: number }
): void {
  el.getBoundingClientRect = () =>
    ({
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      right: r.left + r.width,
      bottom: r.top + r.height,
      x: r.left,
      y: r.top,
      toJSON: () => r,
    }) as DOMRect;
}

function body(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

const DOC = { width: 1920, height: 1080 };
/** 节点尺寸 == 文档尺寸：比例 1，矩形直接可读（缩放另有判据）。 */
const NODE_1TO1 = { width: 1920, height: 1080 };

const TWO_BLOCKS =
  `<div ${BLOCK_MARK_ATTR}="概览" ${BLOCK_KIND_ATTR}="metric">A</div>` +
  `<div ${BLOCK_MARK_ATTR}="待指派工单" ${BLOCK_KIND_ATTR}="table">` +
  "<table><tbody><tr><td>1</td></tr></tbody></table></div>";

describe("量出每一块的方框", () => {
  it("每块一份矩形，文档顺序，带身份", () => {
    const root = body(TWO_BLOCKS);
    const [a, b] = Array.from(root.querySelectorAll(`[${BLOCK_MARK_ATTR}]`));
    stubRect(a, { left: 0, top: 0, width: 400, height: 120 });
    stubRect(b, { left: 0, top: 140, width: 400, height: 300 });

    const snap = measureBlockRects(root, DOC, NODE_1TO1, 7);

    expect(snap.geometryGeneration).toBe(7);
    expect(snap.rects.map(r => r.name)).toEqual(["概览", "待指派工单"]);
    expect(snap.rects[0].kindLabel).toBe("指标");
    expect(snap.rects[1].rect).toEqual({
      left: 0,
      top: 140,
      width: 400,
      height: 300,
    });
  });

  it("反向：矩形条数必须和检视器的块清单一样多", () => {
    // 变异：给 measureBlockRects 自己写一套 querySelectorAll 筛选（不走
    // listBlockElements），嵌套/重名的处理一分叉这条就红。
    const root = body(
      TWO_BLOCKS +
        `<div ${BLOCK_MARK_ATTR}="概览" ${BLOCK_KIND_ATTR}="card">重名的</div>` +
        `<div ${BLOCK_MARK_ATTR}="外层" ${BLOCK_KIND_ATTR}="card">` +
        `<div ${BLOCK_MARK_ATTR}="嵌在里面的" ${BLOCK_KIND_ATTR}="list">x</div></div>`
    );
    for (const el of Array.from(
      root.querySelectorAll(`[${BLOCK_MARK_ATTR}]`)
    )) {
      stubRect(el, { left: 0, top: 0, width: 100, height: 50 });
    }

    const snap = measureBlockRects(root, DOC, NODE_1TO1, 1);
    expect(snap.rects.map(r => r.name)).toEqual(
      listBlocks(root).map(b => b.name)
    );
    // 嵌套的那块不许自己冒出来
    expect(snap.rects.map(r => r.name)).not.toContain("嵌在里面的");
  });

  it("塌成 0 的块丢掉，不收一个看不见的空框", () => {
    const root = body(TWO_BLOCKS);
    const [a, b] = Array.from(root.querySelectorAll(`[${BLOCK_MARK_ATTR}]`));
    stubRect(a, { left: 0, top: 0, width: 400, height: 120 });
    stubRect(b, { left: 0, top: 0, width: 0, height: 0 }); // 折叠面板里

    const snap = measureBlockRects(root, DOC, NODE_1TO1, 1);
    expect(snap.rects.map(r => r.name)).toEqual(["概览"]);
  });

  it("节点比文档小时按比例缩，且只缩一次", () => {
    // 变异：把 frameRectToNodeRect 换成"再乘一次 zoom"，这条立刻红。
    // canvas-element-edit 头注记着真机上那笔平方误差的账（14×5 画成 4×1）。
    const root = body(TWO_BLOCKS);
    const [a, b] = Array.from(root.querySelectorAll(`[${BLOCK_MARK_ATTR}]`));
    stubRect(a, { left: 100, top: 200, width: 400, height: 120 });
    stubRect(b, { left: 0, top: 0, width: 10, height: 10 });

    const snap = measureBlockRects(root, DOC, { width: 960, height: 540 }, 1);
    expect(snap.rects[0].rect).toEqual({
      left: 50,
      top: 100,
      width: 200,
      height: 60,
    });
  });

  it("页面滚过之后补上 scroll 偏移（量的是文档坐标，不是视口坐标）", () => {
    const root = body(TWO_BLOCKS);
    const [a, b] = Array.from(root.querySelectorAll(`[${BLOCK_MARK_ATTR}]`));
    // 视口坐标：滚了 300 之后，文档 y=340 的块看着在 y=40
    stubRect(a, { left: 0, top: 40, width: 400, height: 120 });
    stubRect(b, { left: 0, top: 0, width: 10, height: 10 });
    const win = root.ownerDocument.defaultView as Window & {
      scrollY: number;
      scrollX: number;
    };
    Object.defineProperty(win, "scrollY", { value: 300, configurable: true });
    Object.defineProperty(win, "scrollX", { value: 0, configurable: true });

    const snap = measureBlockRects(root, DOC, NODE_1TO1, 1);
    expect(snap.rects[0].rect.top).toBe(340);

    Object.defineProperty(win, "scrollY", { value: 0, configurable: true });
  });
});

describe("⚠ 必须在 applyBindings 之后量", () => {
  it("绑定前后量到的表格块高度不同——判据咬得住量早了这件事", () => {
    // 这条是这一刀的核心。绑定前 tbody 只有模板行，绑定时 cloneNode 出真数据行。
    // 变异：把量测挪到 applyBindings 之前，画布上表格块的框只有实际的几分之一，
    // 不报错、不告警——正是本仓最贵的那种坏法。这条把它变成红。
    const root = body(TWO_BLOCKS);
    const table = root.querySelector(
      `[${BLOCK_MARK_ATTR}="待指派工单"]`
    ) as HTMLElement;
    const metric = root.querySelector(
      `[${BLOCK_MARK_ATTR}="概览"]`
    ) as HTMLElement;
    stubRect(metric, { left: 0, top: 0, width: 400, height: 120 });

    // 绑定**前**：一个模板行
    stubRect(table, { left: 0, top: 140, width: 400, height: 48 });
    const before = measureBlockRects(root, DOC, NODE_1TO1, 1);

    // applyBindings：克隆出 9 行真数据
    const tbody = table.querySelector("tbody") as HTMLElement;
    const tpl = tbody.querySelector("tr") as HTMLElement;
    for (let i = 0; i < 9; i += 1) tbody.appendChild(tpl.cloneNode(true));
    stubRect(table, { left: 0, top: 140, width: 400, height: 480 });
    const after = measureBlockRects(root, DOC, NODE_1TO1, 2);

    const h = (s: typeof before) =>
      s.rects.find(r => r.name === "待指派工单")!.rect.height;
    expect(h(before)).toBe(48);
    expect(h(after)).toBe(480);
    expect(h(after)).toBeGreaterThan(h(before) * 2);
  });
});

describe("世代号：陈旧判定", () => {
  it("空快照的世代号不等于任何合法世代号（第一次一定会量）", () => {
    // 变异：把 EMPTY_BLOCK_RECTS 的世代号改成 0，而 deriveGenerations 恰好
    // 也能算出 0 —— 于是第一份快照被认成"不陈旧"，永远不量第一次，
    // 画布上一个框都没有而判据全绿。
    expect(EMPTY_BLOCK_RECTS.geometryGeneration).toBe(-1);
    expect(isBlockRectsStale(EMPTY_BLOCK_RECTS, 0)).toBe(true);
  });

  it("世代号相同不陈旧，不同就陈旧", () => {
    const snap = measureBlockRects(body(TWO_BLOCKS), DOC, NODE_1TO1, 42);
    expect(isBlockRectsStale(snap, 42)).toBe(false);
    expect(isBlockRectsStale(snap, 43)).toBe(true);
  });
});

describe("⚠ 世代号是两条，不是一条", () => {
  const HTML_A = "<div data-block='x'>A</div>";
  const HTML_B = "<div data-block='x'>B</div>";

  it("只是布局变了：几何要重量，内容缓存不许失效", () => {
    // 这条是两条世代号存在的**全部理由**。
    // 变异：把 contentGeneration 也混进 layoutEpoch（合成一条），这条立刻红
    // ——表现是刀 4 的绑定索引在每次缩放/平移时整个重算，纯白烧。
    const g0 = deriveGenerations({ html: HTML_A, layoutEpoch: 0 });
    const g1 = deriveGenerations({ html: HTML_A, layoutEpoch: 1 });

    expect(g1.geometryGeneration).not.toBe(g0.geometryGeneration);
    expect(g1.contentGeneration).toBe(g0.contentGeneration);
  });

  it("内容变了：两条都要推进", () => {
    // 反向的那一半：几何世代号**必须**也含内容项。
    // 变异：让 geometryGeneration 只跟 layoutEpoch 走 —— 改一块之后 HTML 变了
    // 但 layoutEpoch 没动，旧矩形被当成新鲜的，框留在改动前的位置。
    const a = deriveGenerations({ html: HTML_A, layoutEpoch: 3 });
    const b = deriveGenerations({ html: HTML_B, layoutEpoch: 3 });

    expect(b.contentGeneration).not.toBe(a.contentGeneration);
    expect(b.geometryGeneration).not.toBe(a.geometryGeneration);
  });

  it("同一份 HTML 重渲（换主题、父组件重挂）内容世代号不变", () => {
    // grok 那边 content_generation 要 "survive view changes" 的意思。
    const a = deriveGenerations({ html: HTML_A, layoutEpoch: 0 });
    const b = deriveGenerations({ html: HTML_A, layoutEpoch: 0 });
    expect(b.contentGeneration).toBe(a.contentGeneration);
    expect(b.geometryGeneration).toBe(a.geometryGeneration);
  });
});

describe("命中与跨页键", () => {
  it("点在块里回那一块，点在块外回 null", () => {
    const root = body(TWO_BLOCKS);
    const [a, b] = Array.from(root.querySelectorAll(`[${BLOCK_MARK_ATTR}]`));
    stubRect(a, { left: 0, top: 0, width: 400, height: 120 });
    stubRect(b, { left: 0, top: 140, width: 400, height: 300 });
    const snap = measureBlockRects(root, DOC, NODE_1TO1, 1);

    expect(blockRectAt(snap, 10, 10)?.name).toBe("概览");
    expect(blockRectAt(snap, 10, 200)?.name).toBe("待指派工单");
    // 反向：两块之间的缝里不许"就近找一个"
    expect(blockRectAt(snap, 10, 130)).toBeNull();
    expect(blockRectAt(snap, 900, 10)).toBeNull();
  });

  it("跨页键必须含页 id——两页同名块不能撞成一个", () => {
    // 变异：把 blockKey 改成只回 name，这条红。
    // 抄自 link_map.rs 的合并规则："Same id alone is not enough"。
    expect(blockKey("p1", "统计概览")).not.toBe(blockKey("p2", "统计概览"));
  });
});

describe("⚠ 采纳判据：同一世代号下的第二次量测不许被丢掉", () => {
  /*
   * 这一组是 2026-08-27 真机抓出来的缺口补的。当时 13 条判据全绿，而画布上
   * 一个块框都没有——因为 hook 拿"世代号一样"当了不采纳的理由，把 iframe
   * 内容落定后量到的那份正确结果丢了。
   *
   * 单测测不到"iframe 内容什么时候落定"，但**采纳规则本身**是纯的，能测。
   */
  const snap = (gen: number, names: string[], h = 100): BlockRectSnapshot => ({
    geometryGeneration: gen,
    rects: names.map((name, i) => ({
      name,
      kind: "card" as const,
      label: name,
      kindLabel: "卡片",
      rect: { left: 0, top: i * h, width: 200, height: h },
    })),
  });

  it("同一世代号，从 0 块变成 6 块 → **必须**采纳", () => {
    // 变异：把 shouldAdoptSnapshot 换回 isBlockRectsStale，这条立刻红。
    // 真机表现是 data-block-rects 恒为 0、画布上一个框都没有。
    const prev = snap(777, []);
    const next = snap(777, ["a", "b", "c", "d", "e", "f"]);
    expect(shouldAdoptSnapshot(prev, next)).toBe(true);
  });

  it("同一世代号，块数一样但位置动了 → 采纳（响应式回流）", () => {
    const prev = snap(777, ["a", "b"], 100);
    const next = snap(777, ["a", "b"], 140);
    expect(shouldAdoptSnapshot(prev, next)).toBe(true);
  });

  it("同一世代号，块换了人（改了一块之后名字变了）→ 采纳", () => {
    expect(shouldAdoptSnapshot(snap(777, ["a"]), snap(777, ["b"]))).toBe(true);
  });

  it("世代号变了 → 一律采纳", () => {
    expect(shouldAdoptSnapshot(snap(1, ["a"]), snap(2, ["a"]))).toBe(true);
  });

  it("反向：逐字节一样 → 不采纳（省掉无谓重渲染）", () => {
    // 少了这条，每次 onReport 都换一个新对象，画布上挂着十几个 iframe 时
    // 会一路重渲。它是这个函数存在的另一半理由。
    expect(shouldAdoptSnapshot(snap(9, ["a", "b"]), snap(9, ["a", "b"]))).toBe(
      false
    );
  });

  it("反向：空 → 空 也不采纳", () => {
    expect(shouldAdoptSnapshot(snap(9, []), snap(9, []))).toBe(false);
  });

  it("从空快照起步一定采纳（第一次必量）", () => {
    expect(shouldAdoptSnapshot(EMPTY_BLOCK_RECTS, snap(0, []))).toBe(true);
  });
});
