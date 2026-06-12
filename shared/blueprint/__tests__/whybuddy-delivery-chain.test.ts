import { describe, it, expect } from "vitest";
import {
  isReviewPassIntent,
  isReviewRejectIntent,
  isPreviewDissatisfiedIntent,
  evaluateReviewPassGate,
  isDeliveryIntent,
  pickDeliveryCapabilities,
  pickStructureBeforeDelivery,
  DELIVERY_PIPELINE,
  handoffPackageHasRequiredSections,
  handoffBundlesMatrixArtifact,
  handoffBundlesVisualRender,
  handoffBundlesVisualPreview,
  buildHandoffPackageContent,
} from "../whybuddy-delivery-chain.js";
import type { V5SessionState } from "../v5-reasoning-state.js";

describe("whybuddy-delivery-chain (S19/S20)", () => {
  it("S19: pickStructureBeforeDelivery re-runs when spec_tree is stale", () => {
    const state: V5SessionState = {
      goal: { text: "权限", status: "clear" },
      graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [] },
      artifacts: [
        {
          id: "tree-stale",
          kind: "spec_tree",
          provenance: "ai_generated",
          trustLevel: "gated_pass",
          passedGates: ["commit"],
          producedBy: {
            capabilityRunId: "run-tree",
            capabilityId: "structure.decompose",
            roleId: "架构",
          },
          content: "tree",
        },
      ],
      capabilityRuns: [
        {
          id: "run-tree",
          capabilityId: "structure.decompose",
          inputs: [],
          outputs: ["tree-stale"],
          gateResults: [],
          turnId: "t1",
        },
      ],
      conversation: [],
      openQuestions: [],
      evidence: [],
      decisions: [],
      risks: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: ["tree-stale"],
      sessionId: "s19-stale-tree",
    };
    const picks = pickStructureBeforeDelivery(state, "打包落地交付").map((p) => p.capabilityId);
    expect(picks).toContain("structure.decompose");
  });

  it("S19: pickDeliveryCapabilities re-runs stale trusted delivery artifacts", () => {
    const state: V5SessionState = {
      goal: { text: "权限", status: "clear" },
      graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [] },
      artifacts: [
        {
          id: "doc-stale",
          kind: "document",
          provenance: "ai_generated",
          trustLevel: "gated_pass",
          passedGates: ["commit"],
          producedBy: { capabilityRunId: "run-doc", capabilityId: "document.draft", roleId: "工程" },
          content: "draft",
        },
      ],
      capabilityRuns: [
        {
          id: "run-doc",
          capabilityId: "document.draft",
          inputs: [],
          outputs: ["doc-stale"],
          gateResults: [],
          turnId: "t1",
        },
      ],
      conversation: [],
      openQuestions: [],
      evidence: [],
      decisions: [],
      risks: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: ["doc-stale"],
      sessionId: "s19-stale",
    };
    const picks = pickDeliveryCapabilities(state).map((p) => p.capabilityId);
    expect(picks[0]).toBe("document.draft");
    expect(picks).toContain("traceability.matrix");
  });

  it("S19: pickDeliveryCapabilities returns pipeline for clear goal", () => {
    const state: V5SessionState = {
      goal: { text: "权限", status: "clear" },
      graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [] },
      artifacts: [],
      conversation: [],
      openQuestions: [],
      evidence: [],
      decisions: [],
      risks: [],
      capabilityRuns: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: [],
      sessionId: "s19",
    };
    expect(pickDeliveryCapabilities(state).map((p) => p.capabilityId)).toEqual(
      DELIVERY_PIPELINE.map((p) => p.capabilityId)
    );
    expect(isDeliveryIntent("打包落地")).toBe(true);
  });

  it("S19: buildHandoffPackageContent includes required markers", () => {
    const content = buildHandoffPackageContent({
      goal: { text: "权限系统", status: "clear" },
      graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [] },
      artifacts: [
        {
          id: "r1",
          kind: "report",
          provenance: "ai_generated",
          trustLevel: "gated_pass",
          passedGates: ["commit"],
          producedBy: { capabilityRunId: "run", capabilityId: "report.write", roleId: "综合" },
          content: "报告",
        },
      ],
      capabilityRuns: [{ id: "run", capabilityId: "report.write", inputs: [], outputs: ["r1"], gateResults: [] }],
      conversation: [],
      openQuestions: [],
      evidence: [],
      decisions: [],
      risks: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: [],
      sessionId: "s19-h",
    } as V5SessionState);
    expect(handoffPackageHasRequiredSections(content)).toBe(true);
  });

  it("S19: buildHandoffPackageContent bundles matrix + visual artifacts", () => {
    const matrixId = "mx-1";
    const previewId = "pv-1";
    const mermaidId = "mv-1";
    const content = buildHandoffPackageContent({
      goal: { text: "权限系统", status: "clear" },
      graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [] },
      artifacts: [
        {
          id: "r1",
          kind: "report",
          provenance: "ai_generated",
          trustLevel: "gated_pass",
          passedGates: ["commit"],
          producedBy: { capabilityRunId: "run", capabilityId: "report.write", roleId: "综合" },
          content: "报告",
        },
        {
          id: matrixId,
          kind: "decision",
          provenance: "ai_generated",
          trustLevel: "gated_pass",
          passedGates: ["commit"],
          producedBy: {
            capabilityRunId: "run-m",
            capabilityId: "traceability.matrix",
            roleId: "综合",
          },
          content: "| 需求 | 设计 | 任务 | 证据 | 用例 |\n|---|---|---|---|---|",
        },
        {
          id: previewId,
          kind: "preview",
          provenance: "ai_generated",
          trustLevel: "gated_pass",
          passedGates: ["commit"],
          producedBy: { capabilityRunId: "run-p", capabilityId: "ux.preview", roleId: "产品" },
          content: "【预览·未验证】模块页",
        },
        {
          id: mermaidId,
          kind: "preview",
          provenance: "rendered",
          trustLevel: "audited",
          passedGates: ["commit"],
          producedBy: {
            capabilityRunId: "run-v",
            capabilityId: "outcome.visualize",
            roleId: "工程",
          },
          content: "【预览·未验证】\n```mermaid\ngraph TD\n  root[\"SPEC\"]\n```",
        },
      ],
      capabilityRuns: [],
      conversation: [],
      openQuestions: [],
      evidence: [],
      decisions: [],
      risks: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: [],
      sessionId: "s19-bundle",
    } as V5SessionState);

    expect(handoffBundlesMatrixArtifact(content, matrixId)).toBe(true);
    expect(handoffBundlesVisualRender(content, mermaidId)).toBe(true);
    expect(
      handoffBundlesVisualPreview(content, { artifactId: previewId, sourceCap: "ux.preview" })
    ).toBe(true);
  });

  it("detects RV pass / reject / ITER intents", () => {
    expect(isReviewPassIntent("评审通过，可以交付")).toBe(true);
    expect(isReviewRejectIntent("评审打回，退回修改")).toBe(true);
    expect(isPreviewDissatisfiedIntent("效果不满意，重新预演")).toBe(true);
    expect(isReviewPassIntent("继续分析风险")).toBe(false);
  });

  it("evaluateReviewPassGate requires trusted report + clear goal", () => {
    const clearWithReport: V5SessionState = {
      goal: { text: "x", status: "clear" },
      graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [] },
      artifacts: [
        {
          id: "r1",
          kind: "report",
          provenance: "ai_generated",
          trustLevel: "gated_pass",
          passedGates: ["commit"],
          producedBy: { capabilityRunId: "run", capabilityId: "report.write", roleId: "综合" },
          content: "report",
        },
      ],
      conversation: [],
      openQuestions: [],
      evidence: [],
      decisions: [],
      risks: [],
      capabilityRuns: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: [],
    };
    expect(evaluateReviewPassGate(clearWithReport).passed).toBe(true);

    const needsRefinement = { ...clearWithReport, goal: { text: "x", status: "needs_refinement" as const } };
    expect(evaluateReviewPassGate(needsRefinement).passed).toBe(false);
  });
});