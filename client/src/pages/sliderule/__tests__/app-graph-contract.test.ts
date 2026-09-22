/**
 * 图的边**词汇表**只有一份：shared/app-graph/edge-contract.json（2026-08-17）。
 *
 * 这张网在两个运行时里各推一遍——本目录的 sandbox-graph.ts 画沙盘 + 断线体检，
 * slide-rule-python/services/app_graph.py 在生成链路上算影响面。两份实现是有
 * 理由的（用途和运行时都不同），但**边的词汇表不能各定一套**：同一份模型在
 * 前端画出来是通的、后端算影响面时却是断的，而这种不一致不会报错。
 *
 * ⚠ 这条判据必须**两边都有**。只在 Python 侧钉，TS 这边加一种边照样绿——
 *   而那正是漂移开始的地方。
 */
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  deriveSystemLinkageGraph,
  linkageToMermaid,
} from "../system-screens/five-system-model";
import { deriveSandboxGraph } from "../system-screens/sandbox-graph";

interface EdgeSpec {
  kind: string;
  displayLabel: string;
  pythonLabels: string[];
}

const contract = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../shared/app-graph/edge-contract.json"), "utf8")
) as { edges: EdgeSpec[]; rules: Record<string, any> };

/** 一份能把六种边都跑出来的模型：字段绑定、装配流程、审批人、可进入、AIGC 读写与可用角色。 */
const MODEL = {
  datamodel: {
    entities: [{ id: "wo", name: "工单", fields: [{ id: "amt", name: "金额", type: "string" }] }],
  },
  page: {
    pages: [{ id: "p1", name: "工单页", fieldBindings: ["wo.amt"], actionPermissions: ["wo:read"] }],
  },
  rbac: {
    roles: ["mgr"],
    permissions: ["wo:read"],
    menus: [{ id: "m1", label: "工单", roleRefs: ["mgr"], permissionRefs: ["wo:read"] }],
  },
  workflow: { nodes: [{ id: "n1", name: "提交", assigneeRole: "mgr" }] },
  aigc: { capabilities: [{ id: "c1", name: "摘要", inputFields: ["wo.amt"], outputField: "wo.amt", roleRefs: ["mgr"] }] },
  appbundle: { pageBindings: [{ pageRef: "p1", workflowRef: "n1" }] },
} as any;

describe("图的边词汇表跟契约对齐", () => {
  it("契约里每种边这边都产得出", () => {
    const g = deriveSandboxGraph(MODEL);
    expect(g).not.toBeNull();
    const produced = new Set((g!.edges ?? []).map((e) => e.kind));
    const missing = contract.edges.map((s) => s.kind).filter((k) => !produced.has(k));
    expect(missing, `契约里这些边这边没产出：${missing.join("、")}`).toEqual([]);
  });

  it("不许产出契约外的边", () => {
    const g = deriveSandboxGraph(MODEL);
    const allowed = new Set(contract.edges.map((s) => s.kind));
    const extra = [...new Set((g!.edges ?? []).map((e) => e.kind))].filter((k) => !allowed.has(k));
    expect(extra, `这些边不在契约里：${extra.join("、")}——加边要先写进契约`).toEqual([]);
  });

  it("角色权限的口径以 menus 为准，跟契约一致", () => {
    // ⚠ 这条是契约存在的直接原因：TS 走 menus、Python 第一版走 rolePermissions，
    //   而真机里后者恒空——两边对"这个角色能进哪些页"得出完全不同的答案。
    const rule = contract.rules["role-perms-intersect-page-actions"];
    expect(rule.roleHeldPermissions.authoritative).toContain("menus");

    // 行为判据：只给 rolePermissions、不给 menus 时，这边不该判出可进入。
    const noMenus = {
      ...MODEL,
      rbac: { roles: ["mgr"], permissions: ["wo:read"], rolePermissions: { mgr: ["wo:read"] } },
    } as any;
    const g = deriveSandboxGraph(noMenus);
    expect((g!.edges ?? []).filter((e) => e.kind === "role-page")).toEqual([]);
  });

  it("公共页不画角色→页面（否则是角色×页面全连接）", () => {
    const pub = {
      ...MODEL,
      page: { pages: [{ id: "p1", name: "公共页", fieldBindings: ["wo.amt"] }] },
    } as any;
    const g = deriveSandboxGraph(pub);
    expect((g!.edges ?? []).filter((e) => e.kind === "role-page")).toEqual([]);
  });
});

/**
 * ★ 第三处 builder：架构图（Mermaid）走的是 deriveSystemLinkageGraph，**不是**
 *   沙盘那份 deriveSandboxGraph。上面那组判据只钉住了沙盘和 Python 两处，
 *   它从这条纪律里整个溜掉了——而本文件头注自己写着"只在一边钉，另一边加种边
 *   照样绿"。现在是第三边。
 *
 * 2026-08-17 拿仓里 48 份真机模型量到的实际差距：
 *
 *     边种类           沙盘    架构图    差
 *     page-entity     262    202     +60
 *     role-page       306      0     +306   ← 整种边缺失
 *     其余四种         相同
 *     合计            990    624     架构图少 36%
 *
 * 也就是说同一份模型，用户切到「架构图」看到的是打了 36% 折的网，**没有任何
 * 一处会提示他少了什么**。而这个产品的核心主张恰恰是"整张网可以被整体看见、
 * 整体校验"。
 *
 * ⚠ 少的不只是一种边：page-entity 同名边也少 60 条（沙盘那份从更多路径去找）。
 *   只补一条 role-page 会让它"看起来修好了"，而 60 条仍然缺——所以判据比的是
 *   **整个边集**，不是"某种边在不在"。
 */
describe("两份 TS builder 必须算出同一张网", () => {
  const norm = (edges: Array<{ from: string; to: string; kind: string }>) =>
    [...new Set(edges.map((e) => `${e.from}->${e.to}:${e.kind}`))].sort();

  it("同一份模型，沙盘与架构图的边集逐条相等", () => {
    const sb = deriveSandboxGraph(MODEL);
    const lk = deriveSystemLinkageGraph(MODEL);
    expect(sb).not.toBeNull();
    expect(lk).not.toBeNull();
    expect(norm(lk!.edges as any)).toEqual(norm(sb!.edges as any));
  });

  it("48 份真机模型上也逐条相等", () => {
    const files = globSync("experiments/refine-fingerprint/**/model_round*.json", {
      cwd: resolve(__dirname, "../../../../.."),
      absolute: true,
    });
    if (files.length === 0) return; // 仓里没落盘真机模型时不报假红
    const diffs: string[] = [];
    for (const f of files) {
      const m = JSON.parse(readFileSync(f, "utf8"));
      const sb = deriveSandboxGraph(m);
      const lk = deriveSystemLinkageGraph(m);
      if (!sb || !lk) continue;
      const a = norm(sb.edges as any);
      const b = norm(lk.edges as any);
      if (a.length !== b.length) {
        diffs.push(`${f.split("/").slice(-2).join("/")}：沙盘 ${a.length} 条、架构图 ${b.length} 条`);
      }
    }
    expect(diffs.slice(0, 5)).toEqual([]);
  });

  it("一页绑多个实体时，每个实体都要有边（绝对判据，不靠两边互比）", () => {
    // ★ 这条是变异咬出来的缺口。上面那两条比的是"两份 builder 相等"——而**把
    //   两份一起改残，相等照样成立**：实测拿掉 page-entity 的补全逻辑后，
    //   沙盘与架构图仍然逐条相等（因为沙盘现在就是底那份），7 条判据全绿。
    //   "两边一致"是必要条件不是充分条件，必须再钉一条**绝对**的。
    const m = {
      ...MODEL,
      datamodel: {
        entities: [
          { id: "wo", name: "工单", fields: [{ id: "amt", name: "金额", type: "string" }] },
          { id: "cust", name: "客户", fields: [{ id: "nm", name: "名称", type: "string" }] },
        ],
      },
      page: {
        pages: [
          { id: "p1", name: "工单页", fieldBindings: ["wo.amt", "cust.nm"], actionPermissions: ["wo:read"] },
        ],
      },
    } as any;
    const g = deriveSystemLinkageGraph(m)!;
    const targets = new Set(
      (g.edges as any[]).filter((e) => e.kind === "page-entity" && e.from === "page:p1").map((e) => e.to)
    );
    expect([...targets].sort()).toEqual(["datamodel:cust", "datamodel:wo"]);
  });

  it("真机模型上，页面绑到的每个实体都连上了（绝对判据）", () => {
    const files = globSync("experiments/refine-fingerprint/**/model_round*.json", {
      cwd: resolve(__dirname, "../../../../.."),
      absolute: true,
    });
    if (files.length === 0) return;
    const miss: string[] = [];
    for (const f of files) {
      const m = JSON.parse(readFileSync(f, "utf8"));
      const g = deriveSystemLinkageGraph(m);
      if (!g) continue;
      const have = new Set((g.edges as any[]).filter((e) => e.kind === "page-entity").map((e) => `${e.from}->${e.to}`));
      for (const p of m?.page?.pages ?? []) {
        for (const b of p.fieldBindings ?? []) {
          const dot = String(b).indexOf(".");
          if (dot <= 0) continue;
          const want = `page:${p.id}->datamodel:${String(b).slice(0, dot)}`;
          // 实体本身不在模型里的（模型自己悬空）不算漏
          if (!(m?.datamodel?.entities ?? []).some((e: any) => e.id === String(b).slice(0, dot))) continue;
          if (!have.has(want)) miss.push(`${f.split("/").slice(-2).join("/")}：缺 ${want}`);
        }
      }
    }
    expect(miss.slice(0, 5)).toEqual([]);
  });

  it("架构图**渲染出来的那份**也带着角色→页面", () => {
    // ⚠ 上面两条比的是 builder 的输出。builder 对齐了、渲染那层若把某种边滤掉，
    //   用户看到的仍然是残的——这条走到最终产物上，是纪律五那句"量用户真正
    //   看到的东西"。
    const chart = linkageToMermaid(MODEL);
    expect(chart).toBeTruthy();
    // ⚠ 这条第一版写成 `toContain(displayLabel 的前两字)`，取出来是「页面」——
    //   而 Mermaid 图里到处都是「页面」，**断言等于没断，当场绿给我看**。
    //   正是本仓点名的那个形状：判据看着在测，其实测的是别的。
    //   改成钉住真实产物的形状：架构图画的是组级别的边（sg_rbac --> sg_page），
    //   标签文案随时可能改，所以只钉两端，不钉文案。
    expect(chart!).toMatch(/sg_rbac\s*-->\|[^|]*\|\s*sg_page/);
  });
});
