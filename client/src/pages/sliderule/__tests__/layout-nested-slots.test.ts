/**
 * page.layout 被多包一层 `slots` 时的解包。
 *
 * 这不是假想的畸形输入——真跑「校园实验室的仪器预约与耗材领用管理」那一轮，
 * 6 个页面**全部**写成了 `layout: { slots: { header: [...] } }`。起因是
 * prompt 里那句 "a layout object with slots summary/primary/..."，"with slots"
 * 被读成了"有一个叫 slots 的键"（跟 `binding=none` 被当成值写进去是同一类
 * 哨兵词事故）。prompt 和 Gate 都已经改掉，但**已经落库的模型改不动**。
 *
 * 漏过来的后果是静默的：normalizeLayoutSlotMap 只认那 5 个字面键，包了一层
 * 就一个槽都读不到 → hasAny=false → deriveLayout 返回 null → 渲染层判定
 * "这页没声明 layout"，退回顺序平铺。页面照样渲染、控制台不报错，只是模型
 * 的排版意图整个消失——所以必须有测试盯着。
 */

import { describe, it, expect } from "vitest";
import { deriveAppRuntimeSchema } from "../live-runtime/app-runtime-schema";
import type { FiveSystemModel } from "../system-screens/five-system-model";

function modelWithLayout(layout: unknown): FiveSystemModel {
  return {
    datamodel: {
      entities: [
        {
          id: "instrument",
          name: "仪器",
          fields: [
            { id: "id", name: "编号", type: "string" },
            { id: "name", name: "名称", type: "string" },
          ],
        },
      ],
    },
    rbac: { roles: ["staff"], permissions: [], menus: [] },
    workflow: { nodes: [], transitions: [] },
    page: {
      pages: [
        {
          id: "lab_monitor",
          name: "实验室总览",
          fieldBindings: ["instrument.name"],
          blocks: [
            { id: "lab_kpi", type: "MetricGrid", binding: { entityRef: "instrument" } },
            { id: "lab_feed", type: "ActivityFeed", binding: { entityRef: "instrument" } },
          ],
          layout,
        },
      ],
    },
    aigc: { capabilities: [] },
  } as unknown as FiveSystemModel;
}

const FLAT = { header: ["lab_kpi"], supplement: ["lab_feed"] };

describe("page.layout 嵌套 slots 解包", () => {
  it("摊平写法照常工作（回归基线）", () => {
    const page = deriveAppRuntimeSchema(modelWithLayout(FLAT))!.pages[0];
    expect(page.layout).not.toBeNull();
    expect(page.layout!.header).toEqual(["lab_kpi"]);
    expect(page.layout!.supplement).toEqual(["lab_feed"]);
  });

  it("包了一层 slots 时解包出同样的槽位表", () => {
    const page = deriveAppRuntimeSchema(modelWithLayout({ slots: FLAT }))!.pages[0];
    expect(page.layout).not.toBeNull();
    expect(page.layout!.header).toEqual(["lab_kpi"]);
    expect(page.layout!.supplement).toEqual(["lab_feed"]);
  });

  it("外层已有真槽位时不被包装层覆盖", () => {
    // 两种写法混在一起：以模型直接写在外层的为准，不能让包装层反客为主。
    const page = deriveAppRuntimeSchema(
      modelWithLayout({ header: ["lab_feed"], slots: { header: ["lab_kpi"] } })
    )!.pages[0];
    expect(page.layout!.header).toEqual(["lab_feed"]);
  });

  it("slots 是数组而非对象时不当成包装层", () => {
    // `slots: [...]` 没有任何合法解释，照旧走"读不到槽位"的既有路径。
    const page = deriveAppRuntimeSchema(modelWithLayout({ slots: ["lab_kpi"] }))!.pages[0];
    expect(page.layout).toBeNull();
  });

  it("解包后仍然过滤悬空引用", () => {
    const page = deriveAppRuntimeSchema(
      modelWithLayout({ slots: { header: ["lab_kpi", "不存在的块"] } })
    )!.pages[0];
    expect(page.layout!.header).toEqual(["lab_kpi"]);
  });

  it("mobile 覆盖表包了一层 slots 也解包", () => {
    const page = deriveAppRuntimeSchema(
      modelWithLayout({ ...FLAT, mobile: { slots: { header: ["lab_feed"] } } })
    )!.pages[0];
    expect(page.layout!.mobile!.header).toEqual(["lab_feed"]);
  });

  it("grid-only 布局经过边界归一化后可以独立成立", () => {
    const page = deriveAppRuntimeSchema(
      modelWithLayout({
        grid: {
          desktop: [
            { blockRef: "lab_kpi", x: 0, y: 0, w: 4, h: 1 },
            { blockRef: "lab_feed", x: 4, y: 0, w: 8, h: 2 },
            { blockRef: "missing", x: 0, y: 2, w: 12, h: 1 },
          ],
          phone: [{ blockRef: "lab_feed", x: 0, y: 0, w: 4, h: 2 }],
        },
      })
    )!.pages[0];

    expect(page.layout).not.toBeNull();
    expect(page.layout!.grid?.desktop).toEqual([
      { blockRef: "lab_kpi", x: 0, y: 0, w: 4, h: 1 },
      { blockRef: "lab_feed", x: 4, y: 0, w: 8, h: 2 },
    ]);
    expect(page.layout!.grid?.phone).toEqual([
      { blockRef: "lab_feed", x: 0, y: 0, w: 4, h: 2 },
    ]);
  });
});
