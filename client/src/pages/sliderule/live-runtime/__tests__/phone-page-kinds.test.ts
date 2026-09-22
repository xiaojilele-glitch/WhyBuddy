/**
 * pageKind 的派生与手机档骨架（2026-07-28）。
 *
 * 真机上撞到的事：咖啡工坊那个应用声明了 kanban / calendar 页，运行时却
 * 全部渲染成 workbench。派生层对这两种范式有硬要求——绑定解析不到就诚实
 * 降级——所以先把"什么样的声明能活下来"钉死，再谈手机档怎么渲染它。
 *
 * 这几条同时是排查工具：将来再遇到"看板页变成普通列表"，对着这里就能
 * 判断是声明的问题还是渲染的问题。
 */
import { describe, it, expect } from "vitest";

import { deriveAppRuntimeSchema } from "../app-runtime-schema";

// ?raw 源码断言用。必须在模块顶层 await：放进 describe 回调里 esbuild 直接
// 报错（回调不是 async，顶层 await 只在模块作用域合法）。
const screenSrc = await import("../AppRuntimeScreen.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);

/** 最小可用模型：一个实体 + 一个页面，页面的 kind/绑定由参数决定。 */
function modelWith(pageExtra: Record<string, unknown>) {
  return {
    datamodel: {
      entities: [
        {
          id: "roast_batch",
          name: "烘焙批次",
          fields: [
            { id: "batch_code", name: "批次号", type: "string" },
            {
              id: "status",
              name: "批次状态",
              type: "enum",
              options: [
                { id: "planned", label: "待烘焙" },
                { id: "roasting", label: "烘焙中" },
                { id: "done", label: "已完成" },
              ],
            },
            { id: "planned_date", name: "计划日期", type: "date" },
          ],
        },
      ],
    },
    rbac: { roles: [], permissions: [], menus: [] },
    workflow: { workflows: [] },
    page: {
      pages: [
        {
          id: "board",
          name: "烘焙看板",
          fieldBindings: [
            "roast_batch.batch_code",
            "roast_batch.status",
            "roast_batch.planned_date",
          ],
          ...pageExtra,
        },
      ],
    },
    aigc: { capabilities: [] },
    appbundle: { landingPageRef: "board", pageBindings: [] },
  } as unknown as Parameters<typeof deriveAppRuntimeSchema>[0];
}

const viewOf = (extra: Record<string, unknown>) =>
  deriveAppRuntimeSchema(modelWith(extra))?.pages[0]?.view;

describe("kanban 的派生条件", () => {
  it("statusField 指到本页实体的 enum 字段 → 活下来", () => {
    expect(viewOf({ kind: "kanban", statusField: "roast_batch.status" }))
      .toEqual({ kind: "kanban", statusFieldId: "status" });
  });

  it("字段名对不上 → 诚实降级 workbench，而不是渲染坏视图", () => {
    // 真机遇到的形态：迭代把字段名写成了实体里不存在的那个
    expect(
      viewOf({ kind: "kanban", statusField: "roast_batch.roast_status" })?.kind
    ).toBe("workbench");
  });

  it("类型不是 enum → 降级（日期字段当不了看板列）", () => {
    expect(
      viewOf({ kind: "kanban", statusField: "roast_batch.planned_date" })?.kind
    ).toBe("workbench");
  });

  it("statusField 整个缺失 → 降级", () => {
    expect(viewOf({ kind: "kanban" })?.kind).toBe("workbench");
  });

  it("指向别的实体 → 降级（看板列必须来自本页主实体）", () => {
    expect(
      viewOf({ kind: "kanban", statusField: "cupping_record.status" })?.kind
    ).toBe("workbench");
  });
});

describe("calendar 的派生条件", () => {
  it("dateField 指到本页实体的 date 字段 → 活下来", () => {
    expect(
      viewOf({ kind: "calendar", dateField: "roast_batch.planned_date" })
    ).toMatchObject({ kind: "calendar", dateFieldId: "planned_date" });
  });

  it("类型不是 date → 降级", () => {
    expect(
      viewOf({ kind: "calendar", dateField: "roast_batch.status" })?.kind
    ).toBe("workbench");
  });
});

describe("主实体的确定方式", () => {
  it("页面主实体取 fieldBindings 里出现最多的实体，不是单独声明的字段", () => {
    // 这一条是排查的关键：页面对象上没有 entity 字段，主实体是从
    // fieldBindings 数出来的。绑定串写歪了，view 绑定跟着一起失效。
    const view = deriveAppRuntimeSchema(
      modelWith({
        kind: "kanban",
        statusField: "roast_batch.status",
        fieldBindings: ["other_entity.a", "other_entity.b", "roast_batch.status"],
      })
    )?.pages[0]?.view;
    // 主实体被算成 other_entity → roast_batch.status 不再属于本页实体 → 降级
    expect(view?.kind).toBe("workbench");
  });
});

describe("手机档也渲染 AI 设计的总览版式（2026-07-29）", () => {
  it("phonePageContent 里挂了 monitorFreeformOverview", () => {
    // 此前只有桌面壳渲染它：同一个总览页换个档位就从"每个应用长得不一样"
    // 退回"所有应用长一样"。更别扭的是 preferredDevice=phone 的应用——
    // 那份版式**本来就是照手机单列生成的**，却只有桌面壳看得到。
    expect(screenSrc).toContain('<div className="phone-freeform-scope">');
    // 钉的是"手机路径确实渲染了设计版式"，不是某个具体写法——2026-07-29
    // 这里从直接塞 {monitorFreeformOverview} 改成了按设备档取用
    // renderFreeformOverview(true)，钉字面量会把改进也一起钉死。
    expect(screenSrc).toMatch(
      /phone-freeform-scope">[\s\S]{0,80}renderFreeformOverview\(true\)/
    );
  });

  it("声明必须在手机路径之前 —— 否则 TDZ 直接炸", () => {
    // 原来它挨着桌面的 defaultPageContent 放（2400 行开外），手机路径引用
    // 会 "used before its declaration"。这条锁住顺序，免得日后有人搬回去。
    const decl = screenSrc.indexOf("const monitorFreeformOverview =");
    const phoneUse = screenSrc.indexOf('className="phone-freeform-scope"');
    expect(decl).toBeGreaterThan(-1);
    expect(phoneUse).toBeGreaterThan(decl);
  });

  it("设计版式在场时，手机固定骨架的 KPI/图表让位", () => {
    // freeformOverview 就是拿这页 stats/charts 重新设计出来的版式——
    // 同一份声明的美化版。两个都画就是同样的数字在一屏里出现两遍。
    expect(screenSrc).toContain("const freeformTookOver");
    expect(screenSrc).toMatch(/wantsMetrics\s*=\s*\n?\s*!freeformTookOver/);
  });

  it("由页面语义决定设计版式是否接管，普通 workbench 仍保留 KPI", () => {
    // marketing-landing 可以使用 workbench 数据视图，但应由设计版式接管；
    // 普通 application workbench 的不接管契约由 marketing-landing-ownership 覆盖。
    expect(screenSrc).toContain("pageFreeformOwnsContent(page)");
  });

  it("设计版式接管营销首页时隐藏业务演示数据提示", () => {
    expect(screenSrc).toMatch(/pageSeedCount > 0 && !freeformOwnsPage/);
  });
});

describe("设计版式按设备分档取用（方案 B，2026-07-29）", () => {
  it("手机档优先取 mobile，取不到回退 root", () => {
    // 回退语义照 react-grid-layout 的 findOrGenerateResponsiveLayout：
    // 有本档用本档、没有就往更大的档回退。这里只有两档，所以 mobile 缺失
    // 就退回 root（老快照 + 手机那版生成失败的页都走这条路）。
    expect(screenSrc).toMatch(
      /forPhone && page\.freeformOverview\.mobile\) \|\| page\.freeformOverview/
    );
  });

  it("桌面档永远取 root —— 手机那份不能漏到桌面上", () => {
    expect(screenSrc).toContain("renderFreeformOverview(false)");
    expect(screenSrc).toContain("renderFreeformOverview(true)");
  });

  it("DOM 上标出用的是哪一档，真机排查不用翻模型", () => {
    expect(screenSrc).toContain("data-freeform-variant");
  });
});
