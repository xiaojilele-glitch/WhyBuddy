/**
 * 刀 4 **真的接在通电的那条链路上**吗（2026-08-27）。
 *
 * `block-impact.test.ts` 20 条全绿，但把舞台里造边那段删掉照样全绿——纯函数
 * 算得再对，边没进 React Flow 就是零。
 *
 * ⚠ 判据先剥注释（本仓踩过：grep 的标识符同时出现在文档字符串里）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
const STAGE = stripComments(
  readFileSync(resolve(__dirname, "../SpecPageCanvasStage.tsx"), "utf8")
);
const IMPACT = stripComments(
  readFileSync(resolve(__dirname, "../block-impact.ts"), "utf8")
);
const PANEL = stripComments(
  readFileSync(resolve(__dirname, "../CanvasBlockPanel.tsx"), "utf8")
);

describe("影响线真的挂上了画布", () => {
  it("扫了源 HTML 并造了边", () => {
    expect(STAGE).toContain("scanBlockBindings(");
    expect(STAGE).toContain("buildImpactEdges(");
  });

  it("造出来的边真的并进了 edges（不是算完就扔）", () => {
    expect(STAGE).toMatch(/return\s*\[\s*\.\.\.ownership,\s*\.\.\.linkEdges,\s*\.\.\.impact/);
  });

  it("影响面的依赖链只到 pages —— **不跟几何世代号走**", () => {
    // 刀 1 分两条世代号的全部理由：绑定关系跟视口/缩放/画板位置无关。
    // 跟着几何走的话每次平移都要重扫五页 HTML。
    // 链路是 pages → blockBindings → impactEdges，两段都不许混进几何量。
    const scan = STAGE.match(
      /const blockBindings = React\.useMemo\([\s\S]{0,300}?\[([^\]]*)\]\s*\)/
    );
    expect(scan).not.toBeNull();
    expect(scan![1].trim()).toBe("pages");

    const edges = STAGE.match(
      /const impactEdges = React\.useMemo\([\s\S]{0,300}?\[([^\]]*)\]\s*\)/
    );
    expect(edges).not.toBeNull();
    expect(edges![1].trim()).toBe("blockBindings");

    // 反向：两段都不许出现几何量（vp / blockFit / placedBoxes）
    for (const m of [scan![0], edges![0]]) {
      expect(m).not.toContain("vp");
      expect(m).not.toContain("placedBoxes");
    }
  });
});

describe("⚠ 两类线必须分色分虚实", () => {
  it("四种关系各有各的样式，且同源字段是**虚线**", () => {
    // 风险台账 #03：画成一样的线，用户会以为改一处自动同步了。
    expect(STAGE).toContain("IMPACT_STYLE");
    for (const k of ["nav", "action", "asset", "field"]) {
      expect(STAGE).toMatch(new RegExp(`${k}:\\s*\\{\\s*stroke:`));
    }
    expect(STAGE).toMatch(/field:\s*\{[^}]*strokeDasharray/);
  });

  it("真联动的三类**不是**虚线（跟同源字段区分得开）", () => {
    for (const k of ["nav", "action", "asset"]) {
      const m = STAGE.match(new RegExp(`${k}:\\s*\\{([^}]*)\\}`));
      expect(m).not.toBeNull();
      expect(m![1]).not.toContain("strokeDasharray");
    }
  });

  it("真联动的口径只有一份（isRealLinkage），舞台不自己再判一遍", () => {
    // CLAUDE.md 第四条：同一件事两处实现必然分叉。
    expect(STAGE).toContain("isRealLinkage(");
    expect(STAGE).not.toMatch(/kind\s*!==\s*"field"/);
  });
});

describe("反向判据", () => {
  it("两端都没有节点的边不画（否则白算一场，React Flow 静默丢掉）", () => {
    expect(STAGE).toContain("blockNodeIds.has(");
  });

  it("nav 类的终点是**画板**，其余是块节点", () => {
    // nav 是页面级跳转，落在那一页的画板上；写成块节点会永远匹配不上。
    expect(STAGE).toMatch(/e\.kind === "nav"\s*\?\s*e\.to\s*:\s*`block:\$\{e\.to\}`/);
  });

  it("块条带关着时不画影响线", () => {
    expect(STAGE).toMatch(/const impact: Edge\[\] = blocksShown/);
  });

  it("孤岛块回空集不是 null（「无影响」不是「未计算」）", () => {
    // 风险台账 #05。真机基线 15 块里有 7 块挂不上绑定。
    expect(IMPACT).toContain("const real = new Set<string>();");
    expect(IMPACT).not.toMatch(/return\s*\{\s*real:\s*null/);
  });

  it("跳到自己这一页的不画（否则几十条自环）", () => {
    expect(IMPACT).toContain("if (target === b.pageId) continue;");
  });
});

describe("刀 4 开整：选中点亮接在通电的链路上", () => {
  it("舞台真的调了 impactFocus，并把结果交给造边", () => {
    expect(STAGE).toContain("impactFocus(");
    expect(STAGE).toContain("impactEdgeDimmed(");
    expect(STAGE).toContain("impactNodeDimmed(");
    expect(STAGE).toContain("islandBlockKeys(");
  });

  it("压暗走 IMPACT_DIM_EDGE / IMPACT_DIM_NODE，不许写 0（那是藏起来）", () => {
    expect(STAGE).toContain("IMPACT_DIM_EDGE");
    expect(STAGE).toContain("IMPACT_DIM_NODE");
    expect(IMPACT).toMatch(/export const IMPACT_DIM_EDGE = 0\.[1-9]/);
    expect(IMPACT).not.toMatch(/export const IMPACT_DIM_EDGE = 0\s*;/);
  });

  it("点空白恢复概览（cytoscape tap background）", () => {
    expect(STAGE).toMatch(/onPaneClick=\{\(\) => \{[\s\S]*?setPickedBlock\(null\)/);
  });

  it("块节点有孤岛标记「无影响」，不是空着或写未计算", () => {
    expect(STAGE).toContain('data-testid="sliderule-canvas-block-island"');
    expect(STAGE).toContain("无影响");
    expect(STAGE).toContain("data-block-island");
    expect(STAGE).toContain("data-block-dimmed");
    expect(STAGE).not.toContain("未计算");
  });

  it("面板反查走 impactedBy，不另写一套", () => {
    // CLAUDE.md 第四条：同一件事两处实现必然分叉。
    expect(PANEL).toContain("impactedBy(");
    expect(PANEL).not.toMatch(/e\.from === key \? e\.to/);
  });

  it("影响面的点亮依赖不许混进几何量", () => {
    const m = STAGE.match(
      /const blockImpactFocus = React\.useMemo\([\s\S]{0,250}?\[([^\]]*)\]\s*\)/
    );
    expect(m).not.toBeNull();
    expect(m![1]).toContain("impactEdges");
    expect(m![1]).toContain("pickedBlockKey");
    expect(m![1]).not.toContain("vp");
    expect(m![1]).not.toContain("placedBoxes");
  });
});
