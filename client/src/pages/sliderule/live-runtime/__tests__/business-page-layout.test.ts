import { describe, expect, it } from "vitest";
import {
  PAGE_CONTENT_REF,
  ensurePageContentItem,
  normalizeBusinessGrid,
  resolveBusinessGrid,
  regionsToGrid,
} from "../business-page-layout";

describe("business page responsive layout", () => {
  it("normalizes declared items, clamps bounds, and removes duplicate or dangling refs", () => {
    const grid = normalizeBusinessGrid(
      {
        desktop: [
          { blockRef: "metrics", x: -2, y: 1, w: 20, h: 2 },
          { blockRef: "metrics", x: 4, y: 2, w: 4, h: 1 },
          { blockRef: "feed", x: 8, y: 0, w: 4, h: 2 },
          { blockRef: "missing", x: 0, y: 4, w: 4, h: 1 },
          { blockRef: "fractional", x: 0.5, y: 4, w: 4, h: 1 },
        ],
      },
      new Set(["metrics", "feed", "fractional", PAGE_CONTENT_REF])
    );

    expect(grid?.desktop).toEqual([
      { blockRef: "feed", x: 8, y: 0, w: 4, h: 2 },
      { blockRef: "metrics", x: 0, y: 1, w: 12, h: 2 },
    ]);
  });

  it("falls back from phone to tablet to desktop and projects wider layouts into the target columns", () => {
    const grid = normalizeBusinessGrid(
      {
        desktop: [{ blockRef: "charts", x: 8, y: 0, w: 4, h: 2 }],
      },
      new Set(["charts"])
    )!;

    expect(resolveBusinessGrid(grid, "phone")).toEqual([
      { blockRef: "charts", x: 0, y: 0, w: 4, h: 2 },
    ]);
  });

  // regionsToGrid 的入参是完整的区域表；测试只关心其中几个，其余补空。
  const R = (partial: Record<string, string[]>) =>
    ({
      header: [], headerExtra: [], headerContent: [], tabs: [], filters: [],
      metrics: [], charts: [], main: [], supplement: [], aside: [],
      footerBar: [], overlay: [],
      ...partial,
    }) as Parameters<typeof regionsToGrid>[1];

  it("页头带整行依次堆叠，正文让出右栏给 aside", () => {
    // 2026-08-08 重写：上一版钉的是旧五槽的几何。新模型按**带**排：
    // top 整行堆叠 → 主视图（让出 aside 宽度）→ main 带整行 → footer。
    const grid = regionsToGrid("workbench", R({
      filters: ["filter"],
      headerExtra: ["metrics"],
      main: ["timeline"],
      aside: ["feed"],
    }));

    expect(grid.desktop).toEqual([
      // top 带：headerExtra 在 filters 前面（目录里的键序就是页面从上到下的序）
      { blockRef: "metrics", x: 0, y: 0, w: 12, h: 1 },
      { blockRef: "filter", x: 0, y: 1, w: 12, h: 1 },
      { blockRef: PAGE_CONTENT_REF, x: 0, y: 2, w: 8, h: 3 },
      { blockRef: "feed", x: 8, y: 2, w: 4, h: 3 },
      // main 带跟在主视图下面，**整行** —— 它是主体的一部分，不是右栏附属。
      // 这是相对旧版的实质变化：旧版把 content 也塞进右栏压成 4/12。
      { blockRef: "timeline", x: 0, y: 5, w: 12, h: 1 },
    ]);
  });

  it("没有 aside 时主视图占满整行", () => {
    const grid = regionsToGrid("workbench", R({ main: ["timeline"] }));
    expect(grid.desktop.find(i => i.blockRef === PAGE_CONTENT_REF)).toMatchObject({
      x: 0,
      w: 12,
    });
  });

  it("看板与日历的主视图更宽 —— 棋盘和月历比别的页型吃宽度", () => {
    for (const kind of ["kanban", "calendar"] as const) {
      const grid = regionsToGrid(kind, R({ filters: ["filter"], aside: ["feed"] }));
      expect(grid.desktop.find(i => i.blockRef === PAGE_CONTENT_REF)).toMatchObject({
        x: 0,
        w: 9,
      });
      expect(grid.desktop.find(i => i.blockRef === "feed")).toMatchObject({
        x: 9,
        w: 3,
      });
    }
  });

  it("底部操作条排在最后一行，整行", () => {
    const grid = regionsToGrid("workbench", R({
      main: ["timeline"],
      footerBar: ["batch"],
    }));
    const last = grid.desktop[grid.desktop.length - 1];
    expect(last).toMatchObject({ blockRef: "batch", x: 0, w: 12 });
    const timeline = grid.desktop.find(i => i.blockRef === "timeline")!;
    expect(last.y).toBeGreaterThan(timeline.y);
  });

  it("overlay 不进栅格 —— 它点了才出来，不占版面", () => {
    const grid = regionsToGrid("workbench", R({
      main: ["timeline"],
      overlay: ["create-dialog"],
    }));
    expect(grid.desktop.map(i => i.blockRef)).not.toContain("create-dialog");
    expect(grid.phone.map(i => i.blockRef)).not.toContain("create-dialog");
  });

  it("仪表盘手机档把辅助内容提到主体之前 —— 小屏先看「现在怎么样」", () => {
    const grid = regionsToGrid("dashboard", R({
      main: ["payment_timeline"],
      aside: ["payment_activity"],
    }));

    expect(grid.desktop).toEqual([
      { blockRef: PAGE_CONTENT_REF, x: 0, y: 0, w: 8, h: 3 },
      { blockRef: "payment_activity", x: 8, y: 0, w: 4, h: 3 },
      { blockRef: "payment_timeline", x: 0, y: 3, w: 12, h: 1 },
    ]);
    expect(grid.phone.map(item => item.blockRef)).toEqual([
      PAGE_CONTENT_REF,
      "payment_activity",
      "payment_timeline",
    ]);
  });

  it("手机档摊成一列，顺序就是带的顺序", () => {
    const grid = regionsToGrid("workbench", R({
      filters: ["filter"],
      main: ["timeline"],
      aside: ["ranking"],
    }));

    expect(grid.phone).toEqual([
      { blockRef: "filter", x: 0, y: 0, w: 4, h: 1 },
      { blockRef: "timeline", x: 0, y: 1, w: 4, h: 1 },
      { blockRef: PAGE_CONTENT_REF, x: 0, y: 2, w: 4, h: 2 },
      { blockRef: "ranking", x: 0, y: 3, w: 4, h: 1 },
    ]);
  });

  it("appends the protected page content surface when an explicit grid forgets it", () => {
    expect(
      ensurePageContentItem(
        [{ blockRef: "filter", x: 0, y: 0, w: 12, h: 1 }],
        "desktop"
      )
    ).toEqual([
      { blockRef: "filter", x: 0, y: 0, w: 12, h: 1 },
      { blockRef: PAGE_CONTENT_REF, x: 0, y: 1, w: 12, h: 3 },
    ]);
  });
});
