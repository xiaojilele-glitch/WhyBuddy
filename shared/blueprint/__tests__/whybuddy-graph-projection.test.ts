import { describe, it, expect } from "vitest";
import {
  projectSessionGraphForDisplay,
  capabilityIdToReasoningNodeType,
  extractNodeTitleFromArtifact,
  ensureRouteBranchScaffold,
} from "../whybuddy-graph-projection";
import {
  createInitialSessionState,
  intakeMessage,
  enrichGraphNodesAfterCommit,
  orchestrateReasoningTurn,
  commitArtifact,
  getPropositionRootNode,
} from "@/lib/whybuddy-runtime";
import { createRawArtifact } from "@/lib/whybuddy-fullpath-fixtures";

describe("whybuddy-graph-projection", () => {
  it("intake keeps only proposition root — no pre-scaffolded pipeline nodes", () => {
    const s = createInitialSessionState("", "proj-scaffold");
    const { preparedState } = intakeMessage(s, {
      turnId: "t1",
      userText: "分析权限方案风险，并生成可行性报告",
    });
    const nonRoot = (preparedState.graph.nodes || []).filter(
      (n) => !String(n.id).endsWith("-proposition")
    );
    expect(nonRoot.length).toBe(0);
    const root = getPropositionRootNode(preparedState)!;
    const fanout = (preparedState.graph.edges || []).filter((e) => e.source === root.id);
    expect(fanout.length).toBe(0);
  });

  it("orchestrate grows graph nodes only from DLEDGER-selected capabilities", () => {
    const s = createInitialSessionState("", "proj-orch-grow");
    const { preparedState, context } = intakeMessage(s, {
      turnId: "td",
      userText: "分析权限方案风险，并生成可行性报告",
    });
    const beforeCount = (preparedState.graph.nodes || []).length;
    const { newState, newGraphNodes, plan } = orchestrateReasoningTurn(preparedState, context);
    expect(plan.selected.length).toBeGreaterThan(0);
    expect(newGraphNodes.length).toBe(plan.selected.length);
    expect((newState.graph.nodes || []).length).toBeGreaterThan(beforeCount);
    expect(
      (newState.graph.nodes || []).some((n) => String(n.id).endsWith("-scaffold-evidence"))
    ).toBe(false);
  });

  it("ensureRouteBranchScaffold creates hypo slots only when route caps are scheduled", () => {
    const s = createInitialSessionState("路线对比", "proj-route");
    const root = getPropositionRootNode(s)!;
    const withHypo = ensureRouteBranchScaffold(s, "t-route", root.id, "route.generate");
    expect(
      (withHypo.graph.nodes || []).some((n) => String(n.id).endsWith("-scaffold-hypo"))
    ).toBe(true);
    const withAlt = ensureRouteBranchScaffold(withHypo, "t-route", root.id, "route.compare");
    expect(
      (withAlt.graph.nodes || []).some((n) => String(n.id).endsWith("-scaffold-hypo-alt"))
    ).toBe(true);
    const noop = ensureRouteBranchScaffold(withAlt, "t-route", root.id, "risk.analyze");
    expect((noop.graph.nodes || []).length).toBe((withAlt.graph.nodes || []).length);
  });

  it("maps capabilities to semantic node types and artifact titles", () => {
    expect(capabilityIdToReasoningNodeType("risk.analyze")).toBe("risk");
    expect(capabilityIdToReasoningNodeType("evidence.search")).toBe("evidence");
    expect(capabilityIdToReasoningNodeType("synthesis.merge")).toBe("synthesis");

    const title = extractNodeTitleFromArtifact(
      {
        id: "a1",
        kind: "risk",
        provenance: "ai_generated",
        producedBy: { capabilityRunId: "r1", capabilityId: "risk.analyze", roleId: "安全" },
        content: "风险：数据范围越权在仅 RBAC 时无法表达跨租户边界。",
        trustLevel: "gated_pass",
        passedGates: [],
      },
      "risk.analyze"
    );
    expect(title).toContain("数据范围越权");
  });

  it("projects semantic edge labels instead of generic 推演", () => {
    const s = createInitialSessionState("测试命题", "proj-edges");
    const intake = intakeMessage(s, { turnId: "te", userText: "测试命题" });
    const { newState } = orchestrateReasoningTurn(intake.preparedState, intake.context);
    const { edges } = projectSessionGraphForDisplay(newState);
    expect(edges.some((e) => e.label && e.label !== "推演")).toBe(true);
  });

  it("enrichGraphNodesAfterCommit copies artifact content onto nodes", () => {
    const s = createInitialSessionState("门禁", "proj-enrich");
    const intake = intakeMessage(s, { turnId: "en", userText: "开始" });
    const orch = orchestrateReasoningTurn(intake.preparedState, intake.context);
    const node = orch.newGraphNodes[0];
    const runId = node.capabilityRunId as string;
    const { updatedState } = commitArtifact(
      orch.newState,
      createRawArtifact("art-e", node.capabilityId as any, node.roleId || "安全", "risk"),
      runId,
      false,
      []
    );
    const w = enrichGraphNodesAfterCommit(updatedState, "en");
    const enriched = (w.graph.nodes || []).find((n) => n.id === node.id);
    expect(enriched?.title).not.toMatch(/ · /);
    expect(enriched?.type).toBe("risk");
  });
});