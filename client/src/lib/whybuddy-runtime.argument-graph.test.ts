import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  intakeMessage,
  orchestrateReasoningTurn,
  getPropositionRootNode,
  propositionRootId,
  ensurePropositionRoot,
  resolveStructuralParentId,
  formatProvenanceForLabel,
  evaluateGraphRootGates,
  commitArtifact,
  enrichGraphNodesAfterCommit,
} from "./whybuddy-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

function countStructuralParents(state: V5SessionState, nodeId: string): number {
  return (state.graph.edges || []).filter(
    (e) => e.type === "depends_on" && e.target === nodeId
  ).length;
}

describe("argument graph P0: proposition root + structural depends_on", () => {
  it("createInitialSessionState inserts a single proposition root (G-ROOT-1)", () => {
    const s = createInitialSessionState("做一个权限管理系统", "sess-root-1");
    const root = getPropositionRootNode(s);
    expect(root).toBeDefined();
    expect(root!.id).toBe(propositionRootId("sess-root-1"));
    expect(root!.type).toBe("question");
    expect(root!.title).toBe("做一个权限管理系统");
    expect(s.graph.centralQuestion?.id).toBe(root!.id);

    const questionNodes = (s.graph.nodes || []).filter((n) => n.type === "question");
    expect(questionNodes).toHaveLength(1);
  });

  it("intakeMessage keeps the root idempotent on refine turns", () => {
    let s = createInitialSessionState("初始命题", "sess-intake");
    const { preparedState } = intakeMessage(s, { turnId: "t1", userText: "补充细节" });
    expect(getPropositionRootNode(preparedState)?.title).toBe("初始命题");
    expect((preparedState.graph.nodes || []).filter((n) => n.type === "question")).toHaveLength(1);
  });

  it("orchestrate adds new nodes from plan without intake pre-scaffold", () => {
    let s = createInitialSessionState("", "sess-dedup");
    const turnId = "turn-dedup";
    const { preparedState, context } = intakeMessage(s, {
      turnId,
      userText: "分析权限方案风险，并生成可行性报告",
    });
    const beforeCount = (preparedState.graph.nodes || []).length;
    expect(beforeCount).toBe(1);
    const { newState, newGraphNodes, plan } = orchestrateReasoningTurn(preparedState, context);
    expect(newGraphNodes.length).toBe(plan.selected.length);
    expect((newState.graph.nodes || []).length).toBe(beforeCount + newGraphNodes.length);
  });

  it("orchestrateReasoningTurn attaches depends_on to scaffold slots or root (G-ROOT-2)", () => {
    let s = createInitialSessionState("分析权限系统风险", "sess-orch");
    const turnId = "turn-arg-1";
    const { preparedState, context } = intakeMessage(s, { turnId, userText: "开始分析" });
    const { newState, newGraphNodes } = orchestrateReasoningTurn(preparedState, context);

    expect(newGraphNodes.length).toBeGreaterThan(0);
    const root = getPropositionRootNode(newState)!;
    const validParents = new Set([
      root.id,
      ...(newState.graph.nodes || [])
        .filter((n) => String(n.id).includes("-scaffold-"))
        .map((n) => n.id),
    ]);
    for (const node of newGraphNodes) {
      expect(countStructuralParents(newState, node.id)).toBe(1);
      const edge = (newState.graph.edges || []).find(
        (e) => e.type === "depends_on" && e.target === node.id
      );
      expect(validParents.has(edge?.source || "")).toBe(true);
      expect((node as { derivedFrom?: string[] }).derivedFrom?.[0]).toBe(edge?.source);
    }
  });

  it("provenance label resolves parent node title (root or scaffold slot)", () => {
    const longGoal = "分析权限管理系统在 RBAC + 数据范围场景下的越权风险与审计缺口，并给出可落地的 MVP 建议与后续演进路径";
    let s = createInitialSessionState(longGoal, "sess-prov");
    const turnId = "turn-prov";
    const { preparedState, context } = intakeMessage(s, { turnId, userText: "开始" });
    const { newState, newGraphNodes } = orchestrateReasoningTurn(preparedState, context);
    const node = newGraphNodes[0];
    const parentId = (node as { derivedFrom?: string[] }).derivedFrom?.[0];
    const parent = (newState.graph.nodes || []).find((n) => n.id === parentId);
    const label = formatProvenanceForLabel(node as any, newState.graph);
    expect(parent).toBeDefined();
    expect(label).toContain(parent!.title || parent!.body || longGoal);
    expect(label).not.toMatch(/\.\.\.$/);
  });

  it("challenge re-entry hangs new nodes under the challenged artifact node", () => {
    let s = createInitialSessionState("权限系统推演", "sess-chal");
    const turnId = "turn-base";
    const { preparedState, context } = intakeMessage(s, { turnId, userText: "分析" });
    let { newState } = orchestrateReasoningTurn(preparedState, context);

    const capNode = (newState.graph.nodes || []).find((n: any) => n.capabilityRunId === `${turnId}-run-0`);
    expect(capNode).toBeDefined();

    const artId = `${turnId}-artifact-0`;
    const committed = commitArtifact(
      newState,
      {
        id: artId,
        kind: "evidence",
        provenance: "template",
        producedBy: {
          capabilityRunId: `${turnId}-run-0`,
          capabilityId: (capNode as any).capabilityId,
          roleId: (capNode as any).roleId,
        },
        content: "挑战目标证据",
      } as any,
      `${turnId}-run-0`
    );
    newState = committed.updatedState;
    newState = enrichGraphNodesAfterCommit(newState, turnId);

    const challengeTurnId = "turn-challenge";
    const { preparedState: challengedPrep, context: chCtx } = intakeMessage(newState, {
      turnId: challengeTurnId,
      userText: "这个结论有问题",
      intervention: { intent: "challenge", targetArtifactId: artId, text: "质疑" },
    });
    const parent = resolveStructuralParentId(challengedPrep, chCtx);
    expect(parent).toBe(capNode!.id);

    const { newState: afterChallenge, newGraphNodes } = orchestrateReasoningTurn(
      challengedPrep,
      chCtx
    );
    expect(newGraphNodes.length).toBeGreaterThan(0);
    const edge = (afterChallenge.graph.edges || []).find(
      (e) => e.type === "depends_on" && e.target === newGraphNodes[0].id
    );
    expect(edge?.source).toBe(capNode!.id);
  });

  it("evaluateGraphRootGates passes on a connected orchestrated graph", () => {
    let s = createInitialSessionState("门禁检查", "sess-gate");
    const turnId = "turn-gate";
    const { preparedState, context } = intakeMessage(s, { turnId, userText: "开始" });
    const { newState } = orchestrateReasoningTurn(preparedState, context);
    const gates = evaluateGraphRootGates(newState);
    expect(gates.ok).toBe(true);
    expect(gates.violations).toEqual([]);
  });

  it("ensurePropositionRoot backfills legacy sessions without a root", () => {
    const legacy: V5SessionState = {
      ...createInitialSessionState("ignored", "legacy-sess"),
      graph: {
        id: "legacy",
        jobId: "legacy",
        stage: "effect_preview",
        nodes: [],
        edges: [],
        source: "runtime",
      },
    };
    const fixed = ensurePropositionRoot(legacy, "回填命题");
    expect(getPropositionRootNode(fixed)?.title).toBe("回填命题");
  });
});