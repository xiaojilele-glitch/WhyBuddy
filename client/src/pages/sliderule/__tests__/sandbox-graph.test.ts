/**
 * 沙盘派生层（2026-08-14 晚）：把网画出来要的账本必须机械可判。
 *
 * 三件事各有判据：
 *   · 页→实体画**全部**真实引用——联动图只画主导实体，沙盘一根都不能少
 *   · 角色→页面边与 rbac-preview 的可见性同一口径（声明权限 ∩ 角色持有非空）；
 *     公共页不画（人人可进 = 角色×页面全连接，零信息纯糊图）
 *   · 断线体检只报机械可判的孤岛，且每处点名都带人话原因——
 *     结构闸查"引用悬空"，体检查反面"东西不在网里"，空数组骗得过闸骗不过它
 */

import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveSandboxGraph } from "../system-screens/sandbox-graph";
import { SystemLinkageGraph } from "../system-screens/SystemLinkageGraph";
import { buildSandboxView } from "../system-screens/sandbox-view";
import { bundleLinkageEdges } from "../system-screens/five-system-model";

const MODEL = {
  datamodel: {
    entities: [
      { id: "order", name: "订单", fields: [{ id: "amount", name: "金额", type: "number" }] },
      { id: "customer", name: "客户", fields: [{ id: "cname", name: "姓名", type: "string" }] },
      { id: "island", name: "孤岛表", fields: [{ id: "x", name: "X", type: "string" }] },
    ],
  },
  page: {
    pages: [
      {
        id: "order_page",
        name: "订单页",
        fieldBindings: ["order.amount", "customer.cname"],
        actionPermissions: ["order:view"],
      },
      { id: "empty_page", name: "空页", fieldBindings: [], actionPermissions: [] },
      { id: "public_page", name: "公共页", fieldBindings: ["order.amount"] },
    ],
  },
  workflow: {
    nodes: [
      { id: "submit", name: "提交", assigneeRole: "clerk" },
      { id: "approve", name: "审批", assigneeRole: "manager" },
    ],
    transitions: [{ from: "submit", to: "approve" }],
  },
  rbac: {
    roles: ["clerk", "manager", "ghost"],
    permissions: ["order:view"],
    menus: [{ id: "m1", label: "订单菜单", roleRefs: ["clerk"], permissionRefs: ["order:view"] }],
  },
  aigc: {
    capabilities: [
      { id: "cap_ok", name: "摘要", inputFields: ["order.amount"], outputField: "order.amount", roleRefs: ["clerk"] },
      { id: "cap_dangling", name: "悬空能力", outputField: "nowhere.x" },
    ],
  },
  appbundle: { pageBindings: [{ pageRef: "order_page", workflowRef: "wf1" }] },
};

describe("deriveSandboxGraph · 边", () => {
  it("页→实体画全部真实引用，不只主导实体", () => {
    const g = deriveSandboxGraph(MODEL)!;
    expect(g.edges).toContainEqual({ from: "page:order_page", to: "datamodel:order", kind: "page-entity" });
    // 联动图只会画 order（主导）；customer 这根是沙盘补上的
    expect(g.edges).toContainEqual({ from: "page:order_page", to: "datamodel:customer", kind: "page-entity" });
  });

  it("角色→页面：声明权限 ∩ 角色持有非空才画；公共页不画", () => {
    const g = deriveSandboxGraph(MODEL)!;
    expect(g.edges).toContainEqual({ from: "rbac:clerk", to: "page:order_page", kind: "role-page" });
    // manager 没有任何菜单授权 → 不可进声明了权限的页
    expect(g.edges.some((e) => e.kind === "role-page" && e.from === "rbac:manager")).toBe(false);
    // 公共页（未声明 actionPermissions）：人人可进 = 零信息，不画
    expect(g.edges.some((e) => e.kind === "role-page" && e.to === "page:public_page")).toBe(false);
  });

  it("联动图原有的边仍在（页→流程起点、节点→角色、AIGC→实体/角色）", () => {
    const g = deriveSandboxGraph(MODEL)!;
    expect(g.edges).toContainEqual({ from: "page:order_page", to: "workflow:submit", kind: "page-workflow" });
    expect(g.edges).toContainEqual({ from: "workflow:submit", to: "rbac:clerk", kind: "node-role" });
    expect(g.edges).toContainEqual({ from: "aigc:cap_ok", to: "datamodel:order", kind: "aigc-entity" });
    expect(g.edges).toContainEqual({ from: "aigc:cap_ok", to: "rbac:clerk", kind: "aigc-role" });
  });

  it("空模型返回 null（与联动图同一空判）", () => {
    expect(deriveSandboxGraph({})).toBeNull();
    expect(deriveSandboxGraph(null)).toBeNull();
  });
});

describe("deriveSandboxGraph · 断线体检", () => {
  it("孤岛逐个点名：没人读的实体 / 零数据孔的页 / 没有手的角色 / 输出悬空的 AIGC", () => {
    const g = deriveSandboxGraph(MODEL)!;
    const keys = g.problems.map((p) => p.key).sort();
    expect(keys).toEqual(
      ["aigc:cap_dangling", "datamodel:island", "page:empty_page", "rbac:ghost"].sort()
    );
    // 每处点名都要带人话原因（体检条 tooltip 直接用它）
    for (const p of g.problems) expect(p.reason.length).toBeGreaterThan(4);
  });

  it("有边就不冤枉：manager 虽无菜单授权，但有审批点连着，不算孤岛", () => {
    const g = deriveSandboxGraph(MODEL)!;
    expect(g.problems.some((p) => p.key === "rbac:manager")).toBe(false);
  });

  it("接线全通的模型体检为空", () => {
    const g = deriveSandboxGraph({
      datamodel: { entities: [{ id: "e", name: "表", fields: [{ id: "f", name: "F", type: "string" }] }] },
      page: { pages: [{ id: "p", name: "页", fieldBindings: ["e.f"], actionPermissions: ["e:view"] }] },
      rbac: {
        roles: ["r"],
        permissions: ["e:view"],
        menus: [{ id: "m", label: "菜单", roleRefs: ["r"], permissionRefs: ["e:view"] }],
      },
    })!;
    expect(g.problems).toEqual([]);
  });

  it("工作流节点不进体检——transitions 不在本图上，连通性归流程屏判", () => {
    const g = deriveSandboxGraph(MODEL)!;
    expect(g.problems.some((p) => p.system === "workflow")).toBe(false);
  });
});

describe("C4 L2 投影（默认不铺成员边）", () => {
  it("未选中：只有组间捆扎边，成员边为空", () => {
    const g = deriveSandboxGraph(MODEL)!;
    const view = buildSandboxView(g, { selectedKey: null });
    expect(view.memberEdges).toEqual([]);
    expect(view.l2Edges.length).toBeGreaterThan(0);
    expect(view.l2Edges.length).toBeLessThan(g.edges.length);
    expect(view.l2Edges.some(e => e.kind === "role-page" && e.count >= 1)).toBe(true);
    const pageEntity = view.l2Edges.find(e => e.kind === "page-entity");
    expect(pageEntity?.fromSystem).toBe("page");
    expect(pageEntity?.toSystem).toBe("datamodel");
    expect(pageEntity?.count).toBe(
      g.edges.filter(e => e.kind === "page-entity").length
    );
  });

  it("选中成员：只露出挨着它的边，不是全网", () => {
    const g = deriveSandboxGraph(MODEL)!;
    const view = buildSandboxView(g, { selectedKey: "page:order_page" });
    expect(view.memberEdges.length).toBeGreaterThan(0);
    expect(view.memberEdges.every(e => e.from === "page:order_page" || e.to === "page:order_page")).toBe(true);
    expect(view.memberEdges.length).toBeLessThan(g.edges.length);
    // 变异：默认把 data.edges 全画出来，selectedKey=null 时 memberEdges 非空必红。
    expect(buildSandboxView(g, { selectedKey: null }).memberEdges).toHaveLength(0);
  });

  it("捆扎函数与成员边条数对得上（沙盘/架构图共用）", () => {
    const g = deriveSandboxGraph(MODEL)!;
    const bundled = bundleLinkageEdges(g.edges);
    expect(bundled.reduce((n, e) => n + e.count, 0)).toBe(g.edges.length);
  });
});

describe("SystemLinkageGraph（沙盘面）· L2 chrome 与体检", () => {
  // 尺寸门控（useContainerSized）在 SSR 下不触发，ReactFlow 画布不渲染——
  // 体检名单在门控外，静态渲染就能验。
  it("断线是 Problems 行，不是图例彩带", () => {
    const html = renderToStaticMarkup(React.createElement(SystemLinkageGraph, { model: MODEL }));
    expect(html).toContain("断线 4");
    expect(html).toContain('data-testid="sandbox-problem-row"');
    for (const name of ["孤岛表", "空页", "ghost", "悬空能力"]) {
      expect(html).toContain(name);
    }
    expect(html).toContain("这张表是孤岛");
    // 不该有：五色图例条。变异：把图例条加回必红。
    expect(html).not.toContain("图例");
    expect(html).not.toContain("页面 → 实体（字段绑定）");
  });

  it("接线全通时不列名单，也不用绿灯假装庆祝", () => {
    const html = renderToStaticMarkup(
      React.createElement(SystemLinkageGraph, {
        model: {
          datamodel: { entities: [{ id: "e", name: "表", fields: [{ id: "f", name: "F", type: "string" }] }] },
          page: { pages: [{ id: "p", name: "页", fieldBindings: ["e.f"], actionPermissions: ["e:view"] }] },
          rbac: {
            roles: ["r"],
            permissions: ["e:view"],
            menus: [{ id: "m", label: "菜单", roleRefs: ["r"], permissionRefs: ["e:view"] }],
          },
        },
      })
    );
    expect(html).toContain('data-clear="true"');
    expect(html).toContain("没有孤岛成员");
    expect(html).not.toContain('data-testid="sandbox-problem-row"');
    expect(html).not.toContain("接线全通");
    expect(html).not.toContain("图例");
  });
});
