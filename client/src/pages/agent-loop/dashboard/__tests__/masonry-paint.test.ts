/**
 * 已落位的卡滚出窗口也不许卸挂。
 *
 * 判据必须能被变异咬住：把 collectPaintIndices 的 retain 分支改成
 * 「仍按 inViewport 裁」，或把首页墙的 retainPlaced 拿掉，这两条都会红。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  collectPaintIndices,
  nextMeasureBatchSize,
  shouldMeasureUnplaced,
} from "../masonry-paint";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n");
}

describe("collectPaintIndices", () => {
  it("retain：滚出视口的下标必须还在（不该有：只剩窗口里那几张）", () => {
    const placed = collectPaintIndices({
      retainPlaced: true,
      placedCount: 12,
      // 往下滚之后窗口里只剩后半——这就是虚拟化会卸掉前半的现场。
      inViewport: [8, 9, 10, 11],
    });
    expect(placed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(placed).toContain(0);
    expect(placed).not.toEqual([8, 9, 10, 11]);
  });

  it("不 retain 才按视口裁（反向：默认墙不能把这条当唯一画法）", () => {
    expect(
      collectPaintIndices({
        retainPlaced: false,
        placedCount: 12,
        inViewport: [8, 9, 10, 11],
      }),
    ).toEqual([8, 9, 10, 11]);
  });
});

describe("下一页必须马上量，不能等再滚一次", () => {
  it("retain：列已经高过两屏，未落位的仍要一次量完（不该有：等 overscan）", () => {
    // 现场：12 张活卡列高 ~4000，overscan=2 屏 ~1600，scrollTop 还停在旧底。
    // 旧判据 shortest < rangeEnd 为假 → estimateHeight 先垫洞。
    expect(
      shouldMeasureUnplaced({
        unplaced: 12,
        measureAllUnplaced: true,
        shortestColumn: 4000,
        rangeEnd: 1600,
      }),
    ).toBe(true);
    expect(
      nextMeasureBatchSize({
        unplaced: 12,
        measureAllUnplaced: true,
        scrollTop: 0,
        overscan: 1600,
        shortestColumn: 4000,
        itemHeightEstimate: 240,
        columnCount: 4,
      }),
    ).toBe(12);
    expect(
      shouldMeasureUnplaced({
        unplaced: 0,
        measureAllUnplaced: true,
        shortestColumn: 4000,
        rangeEnd: 1600,
      }),
    ).toBe(false);
  });

  it("虚拟化才按窗口裁（反向：retain 墙不能把这条当唯一闸）", () => {
    expect(
      shouldMeasureUnplaced({
        unplaced: 12,
        measureAllUnplaced: false,
        shortestColumn: 4000,
        rangeEnd: 1600,
      }),
    ).toBe(false);
    expect(
      nextMeasureBatchSize({
        unplaced: 12,
        measureAllUnplaced: false,
        scrollTop: 0,
        overscan: 1600,
        shortestColumn: 4000,
        itemHeightEstimate: 240,
        columnCount: 4,
      }),
    ).toBe(0);
  });
});

describe("不卸挂接在真链路上", () => {
  it("定位器用 collectPaintIndices，首页墙显式 retainPlaced", () => {
    const masonry = stripComments(
      readFileSync(new URL("../SpanMasonry.tsx", import.meta.url), "utf8"),
    );
    const wall = stripComments(
      readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8"),
    );
    expect(masonry).toContain("collectPaintIndices");
    expect(masonry).toMatch(/for \(const index of paint\)/);
    // range 如果还在，只能给 inViewport 收号。回调里直接 children.push
    // 就是把视口裁切当画笔——滚出窗口的已落位卡会被卸挂。
    const rangeThenPaint = (masonry.split("positioner.range")[1] ?? "").split(
      "collectPaintIndices",
    )[0];
    expect(rangeThenPaint).not.toContain("children.push");
    // ⚠ 2026-08-23 落点改过两次：应用中心先换两端对齐行（JustifiedWall）、
    //   当天晚些又换等宽瀑布流（ColumnsWall，因为"字挪到画面外"要求宽度由列
    //   决定）。两版都**不经过 SpanMasonry**，`retainPlaced` 那条随之退场。
    //   两版的视口裁切也都是**纯的**（比大小/查区间树，不存"已渲染过"的状态），
    //   所以不需要 retain 那套——反过来说，它要是哪天存了状态，就把当初那个
    //   死锁请回来了，下面这条钉它。
    const cw = stripComments(
      readFileSync(new URL("../ColumnsWall.tsx", import.meta.url), "utf8"),
    );
    expect(cw).toMatch(/positioner\.range\(lo, hi/);
    expect(cw).not.toContain("useState");
    expect(wall).not.toContain("retainPlaced");
    expect(masonry).toContain("masonry-end");
    expect(masonry).toContain("IntersectionObserver");
    expect(masonry).toContain("shouldMeasureUnplaced");
    expect(masonry).toContain("nextMeasureBatchSize");
    expect(masonry).toContain("measureAllUnplaced: retainPlaced");
    // 旧闸：列高过两屏就不量。注释里会写这句，剥过再禁。
    expect(masonry).not.toMatch(
      /const needsFreshBatch = shortestColumnSize < rangeEnd && measuredCount < itemCount/,
    );
    expect(masonry).toMatch(/needsFreshBatch, measuredCount, itemCount/);
  });
});
