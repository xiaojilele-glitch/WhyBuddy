/**
 * 等宽瀑布流卡片墙的几何不变式 + 「字在图外」这条改动的活路径判据。
 *
 * 跟 span-positioner 那份同一个取向：不测「长得好不好看」（那是截图的活），
 * 只测能用数学判定的硬约束。这类布局最容易出的不是排得难看，是**偶发重叠**——
 * 两张卡在某个高度组合下叠一起，肉眼要滚到那一屏才看得见。
 *
 * ⚠ 这份文件是 justified-wall.test.ts 改名来的（历史 git log --follow）。
 *   两端对齐行那套判据整体退场，因为墙不走 justifiedRows 了；算法本身和它的
 *   数学判据留在 lib/__tests__/justified-rows.test.ts。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { aspectForDevice, DEVICE_ASPECT } from "@/lib/justified-rows";
import { buildPureSpanLayout } from "../pure-span-layout";
import { computeColumns } from "../SpanMasonry";

/**
 * 1600px 视口、侧栏展开时的实测容器宽（2026-08-23 真机量的 role="list" 宽度）。
 *
 * ⚠ 上一版判据里这个数是 1594，是**旧的**——那大概是侧栏收起时量的。按 1594
 *   推出来是 6 列，真机实际 5 列，我照着 1594 写的量纲判据当场对不上。量纲这种
 *   判据必须落在真机量到的数上，别拿上一版的常量接着用。
 */
const W = 1274;
const GUT = 16;
const MIN_COL = 240;
const CAP = 32;

/** 线上真实分布：桌面 30、手机 38（2026-08-23 查库）。 */
const REAL_MIX: string[] = [...Array(30).fill("desktop"), ...Array(38).fill("phone")];

function layout(devices: readonly string[] = REAL_MIX, width = W) {
  const [columnWidth, columnCount] = computeColumns(width, MIN_COL, GUT);
  const positioner = buildPureSpanLayout({
    items: devices,
    columnCount,
    columnWidth,
    gutter: GUT,
    spanOf: () => 1,
    heightOf: (d, _i, cellW) => cellW / aspectForDevice(d) + CAP,
  });
  return { positioner, columnWidth, columnCount, boxes: positioner.all() };
}

describe("等宽瀑布流的几何", () => {
  it("**每一格宽度都一样** —— 这就是「等宽」的定义，也是「字能放图外」的前提", () => {
    const { boxes, columnWidth } = layout();
    const widths = new Set(boxes.map(b => b.width));
    expect(widths.size).toBe(1);
    expect([...widths][0]).toBe(columnWidth);
    // 反向：谁都不许跨列。跨列一出现，宽度又变成"由内容决定"，
    // 窄卡标题只剩「构建面…」那个毛病立刻回来。
    expect(new Set(boxes.map(b => b.span))).toEqual(new Set([1]));
  });

  it("**任意两张卡不重叠**", () => {
    const { boxes } = layout();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const hit =
          a.left < b.left + b.width &&
          b.left < a.left + a.width &&
          a.top < b.top + b.height &&
          b.top < a.top + a.height;
        expect(hit).toBe(false);
      }
    }
  });

  it("格高 = 画面高 + 信息行高，画面高 = 列宽 ÷ 宽高比", () => {
    const { boxes, columnWidth } = layout(["desktop", "phone"]);
    expect(boxes[0].height).toBe(Math.round(columnWidth / DEVICE_ASPECT.desktop + CAP));
    expect(boxes[1].height).toBe(Math.round(columnWidth / DEVICE_ASPECT.phone + CAP));
    // 手机卡必然高得多——错落全部来自这里，不再需要人工的「跨两列」规则。
    expect(boxes[1].height).toBeGreaterThan(boxes[0].height * 2);
  });

  it("信息行**真的占了格高**，画面不会被它挤掉一条", () => {
    // 反向判据：captionHeight 要是没进落位（只在卡片里加一行 DOM），
    // 相邻两张卡会压盖 CAP 个像素——不报错，滚到那一屏才看得见。
    const withCap = layout(["desktop", "desktop"]).boxes;
    const [cw] = computeColumns(W, MIN_COL, GUT);
    const naked = buildPureSpanLayout({
      items: ["desktop", "desktop"],
      columnCount: computeColumns(W, MIN_COL, GUT)[1],
      columnWidth: cw,
      gutter: GUT,
      spanOf: () => 1,
      heightOf: (d, _i, cellW) => cellW / aspectForDevice(d as string),
    }).all();
    expect(withCap[0].height - naked[0].height).toBe(CAP);
  });

  it("**同一份输入算两遍逐格相同** —— 纯函数，才敢每帧重算", () => {
    expect(layout().boxes).toEqual(layout().boxes);
  });

  it("追加下一页不动已有卡片 —— 贪心最短列是增量的", () => {
    const first = layout(REAL_MIX.slice(0, 40)).boxes;
    const after = layout(REAL_MIX.slice(0, 60)).boxes;
    expect(after.slice(0, 40)).toEqual(first);
  });

  it("容器宽为 0 / 空列表不崩", () => {
    expect(layout([], W).boxes).toEqual([]);
    // 宽度还没量到时 ColumnsWall 直接短路（positioner=null），这里只保证
    // 引擎本身喂 0 列宽不炸。
    expect(() => layout(["desktop"], 0)).not.toThrow();
  });

  it("真实容器宽下的量纲跟效果图对得上", () => {
    const { columnCount, columnWidth } = layout();
    // 1274px → 5 列 × 242px。真机 2026-08-23 实测（widths=[242], cols=5），
    // 跟效果图 03 那一档的密度一致。
    //
    // ⚠ 列数是**算出来的**，不是定出来的：下限 240 只说"最窄能到多少"，
    //   列数由 floor((W+gutter)/(min+gutter)) 得出，列宽再撑满剩余空间。
    expect(columnCount).toBe(5);
    expect(columnWidth).toBe(242);
    // 更宽的屏自动加列，不用改常量
    expect(computeColumns(2400, MIN_COL, GUT)[1]).toBeGreaterThan(columnCount);
  });
});

/** 剥注释再看源码——本仓踩过：grep 的词同时出现在文档字符串里，改回去照样绿。 */
function stripped(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("接在活路径上", () => {
  it("墙用纯函数落位，且视口裁切也是纯的", () => {
    const src = stripped("../ColumnsWall.tsx");
    expect(src).toContain("buildPureSpanLayout({");
    expect(src).toMatch(/positioner\.range\(lo, hi/);
    // ⚠ 存了"已渲染过"的状态，就把 2026-08-23 那个死锁请回来了
    //   （落位表是可变状态、丢了补不回来）。这条钉住它。
    expect(src).not.toContain("useState");
    expect(src).not.toContain("ResizeObserver");
  });

  it("**信息行高只有布局一处真值** —— 卡片不许自己再算一遍", () => {
    const wall = stripped("../ColumnsWall.tsx");
    // 正向：布局把 captionHeight 从格高里减掉之后才交给卡片
    expect(wall).toMatch(/box\.height - captionHeight/);
    const src = stripped("../AppsWorkbench.tsx");
    // 反向：卡片侧拿到的必须是画面高，不能再出现"格高减一行"这种二次计算
    expect(src).toContain("captionHeight={WALL_CAPTION_HEIGHT}");
    expect(src).not.toMatch(/mediaH\s*=\s*\w+\s*-\s*WALL_CAPTION_HEIGHT/);
  });
});

describe("字在图外（2026-08-23 的层次结构改动）", () => {
  const card = () => stripped("../AppsWorkbench.tsx");

  it("标题排在画面**外**，用深色字，不再压在截图上", () => {
    const src = card();
    // 正向：图外那行是深色字
    expect(src).toMatch(/truncate text-\[13px\] font-medium text-stone-800/);
  });

  it("**画面上没有常驻的压字层** —— 这条才是「层次结构」那个差距的根", () => {
    const src = card();
    // 反向：原来那条渐变黑带默认 opacity-30、悬停 100。它一旦回来，
    // 图就又被盖一截、字又读不清（真机效果图 01 那个样子）。
    expect(src).not.toMatch(/from-black\/85[\s\S]{0,120}opacity-30/);
    // 悬停浮层可以有，但静态必须是 opacity-0
    expect(src).toMatch(/from-black\/80[\s\S]{0,160}opacity-0/);
  });

  it("图外那行只放标题和状态 —— 指标进悬停浮层，不跟标题抢宽度", () => {
    const src = card();
    // 指标仍在（信息没丢），但落在画面里的悬停层上
    expect(src).toMatch(/opacity-0 transition-opacity group-hover:opacity-100[\s\S]{0,200}\{metrics\}/);
    // 反向：图外那行不许出现 metrics
    const captionRow = src.slice(src.indexOf("flex min-w-0 flex-1 items-center"));
    expect(captionRow.slice(0, 600)).not.toContain("{metrics}");
  });

  it("卡片不带边框阴影 —— 密排时外框会叠成一片网格线", () => {
    const src = card();
    expect(src).not.toMatch(/rounded-xl border border-stone-200 bg-white shadow-sm/);
  });
});
