/**
 * 区块墙的展示序（2026-08-08）。
 *
 * ## 这组防的是「防护自己失效了没人知道」
 *
 * `interleaveWide` 是为了防「宽卡连着来、两侧列空到底」写的（同一个坑
 * app-wall-span.ts「原因 A」记过）。但它上一版的形状**假设宽卡是少数**——
 * 写的时候确实是（4 张宽）。目录长到 v9 之后反过来了：范式=工作台那档
 * 13 个区块里宽 8 / 窄 5，于是它把多出来的宽卡全倒在队尾：
 *
 *     窄宽窄宽窄宽窄宽窄宽宽宽宽   ← 末尾 4 张连着
 *
 * 它开始产出它当初要防的东西，而**一条测试都没有**，所以谁都没发现。
 *
 * 所以这组里最要紧的不是"某个固定输入出某个固定输出"，而是**不变量**：
 * 无论宽窄比例是多少，最长连续同类段都得压得住。比例会随目录继续变，
 * 钉死某一版的排列结果等于把今天的目录焊进测试里。
 */

import { describe, expect, it } from "vitest";
import { interleaveWide, isWideBlock } from "../block-wall-order";

type B = { type: string; allowedRegions?: string[] };

const wide = (n: number): B[] =>
  Array.from({ length: n }, (_, i) => ({ type: `w${i}`, allowedRegions: ["main"] }));
const narrow = (n: number): B[] =>
  Array.from({ length: n }, (_, i) => ({ type: `n${i}`, allowedRegions: ["aside"] }));

/** 最长连续同类段。 */
function longestRun(blocks: B[], want: boolean): number {
  let best = 0;
  let cur = 0;
  for (const b of blocks) {
    cur = isWideBlock(b) === want ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

describe("isWideBlock", () => {
  it("能进内容区就是宽卡", () => {
    expect(isWideBlock({ allowedRegions: ["aside", "main"] })).toBe(true);
    expect(isWideBlock({ allowedRegions: ["aside", "overlay"] })).toBe(false);
    expect(isWideBlock({})).toBe(false);
  });
});

describe("interleaveWide", () => {
  it("宽卡是多数时也摊得匀 —— 这正是上一版失效的那一档", () => {
    const out = interleaveWide([...wide(8), ...narrow(5)]);
    expect(longestRun(out, true)).toBeLessThanOrEqual(2);
    // 上一版在这里是 4；末尾成堆是它当初要防的东西
    expect(out.slice(-4).filter(isWideBlock)).not.toHaveLength(4);
  });

  it("宽卡是少数时（上一版的原始场景）同样摊得匀", () => {
    const out = interleaveWide([...wide(4), ...narrow(12)]);
    expect(longestRun(out, true)).toBeLessThanOrEqual(1);
    expect(longestRun(out, false)).toBeLessThanOrEqual(4);
  });

  it.each([
    [1, 1], [1, 12], [12, 1], [7, 7], [8, 5], [10, 6], [3, 20], [20, 3],
  ])("宽 %i / 窄 %i：多数那一边的连续段不超过比值 + 1", (w, n) => {
    const out = interleaveWide([...wide(w), ...narrow(n)]);
    const cap = Math.ceil(Math.max(w, n) / Math.min(w, n)) + 1;
    expect(longestRun(out, true)).toBeLessThanOrEqual(cap);
    expect(longestRun(out, false)).toBeLessThanOrEqual(cap);
  });

  it("不增不减：只动次序，元素逐个相同", () => {
    const input = [...wide(8), ...narrow(5)];
    const out = interleaveWide(input);
    expect(out).toHaveLength(input.length);
    expect([...out].sort((a, b) => a.type.localeCompare(b.type)))
      .toEqual([...input].sort((a, b) => a.type.localeCompare(b.type)));
  });

  it("只有一边时原样返回 —— 没有交错可言，重排只会打乱目录次序", () => {
    const onlyWide = wide(5);
    const onlyNarrow = narrow(5);
    expect(interleaveWide(onlyWide)).toBe(onlyWide);
    expect(interleaveWide(onlyNarrow)).toBe(onlyNarrow);
    expect(interleaveWide([])).toEqual([]);
  });

  it("拿真实目录跑：默认视图不该出现末尾成堆", async () => {
    const catalog = (await import("@experience-blocks")) as unknown as {
      default?: { blocks?: B[] };
      blocks?: B[];
    };
    const blocks = (catalog.default?.blocks ?? catalog.blocks ?? []) as B[];
    expect(blocks.length).toBeGreaterThan(0);
    const out = interleaveWide(blocks);
    // 上限**按当下比例算**，不写死。上一版这里钉的是 `<= 2`，那正是这个文件
    // 自己的注释警告过的事——「比例会随目录继续变，钉死今天的结果等于把目录
    // 焊进测试」。2026-08-08 换到区域词汇后比例就从 宽8/窄5 变成了 宽12/窄4，
    // 这条当场红，而算法没有任何问题。
    const w = blocks.filter(isWideBlock).length;
    const n = blocks.length - w;
    const cap = Math.ceil(Math.max(w, n) / Math.min(w, n)) + 1;
    expect(longestRun(out, true)).toBeLessThanOrEqual(cap);
    expect(longestRun(out, false)).toBeLessThanOrEqual(cap);
  });
});
