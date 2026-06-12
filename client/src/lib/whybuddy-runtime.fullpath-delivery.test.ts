/**
 * WhyBuddy V5.1 Full-Path — S19 ship-time delivery chain.
 * Spec: docs/V5.1-full-path-test-plan.md (§2 S19; edges 71–72, 75–76, 84–87, 90–102).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  intakeMessage,
  orchestrateReasoningTurn,
  commitArtifact,
  findInputsForCapability,
  pickNextCapabilities,
} from "./whybuddy-runtime";
import {
  buildClearStateWithTrustedReport,
  createRawArtifact,
  commitTrusted,
  markTrusted,
} from "./whybuddy-fullpath-fixtures";
import {
  isDeliveryIntent,
  pickDeliveryCapabilities,
  pickStructureBeforeDelivery,
  DELIVERY_PIPELINE,
  handoffPackageHasRequiredSections,
  handoffBundlesMatrixArtifact,
  handoffBundlesVisualRender,
  handoffBundlesVisualPreview,
  traceabilityMatrixHasFiveColumns,
  traceabilityMatrixReferencesIds,
} from "@shared/blueprint/whybuddy-delivery-chain";
import { renderSpecTreeToMermaid } from "@shared/blueprint/whybuddy-visual-chain";
import { evaluateCommitGates, evaluateShipGates } from "@shared/blueprint/whybuddy-ship-gates";
import { CAPABILITY_OUTPUT_KIND } from "@shared/blueprint/contracts";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { V5CapabilityId } from "@shared/blueprint/contracts";

const RUNTIME_SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "whybuddy-runtime.ts"),
  "utf8"
);

const GOOD_PREVIEW =
  "【预览·未验证】模块预览页\n- 权限列表页 · 未验证\n- 角色配置页 · 未验证\n- 审计日志页 · 未验证";

function seedVisualArtifacts(sessionId: string): V5SessionState {
  const { state } = buildClearStateWithTrustedReport(sessionId);
  const treeContent =
    "【SPEC Tree】\n[root] 权限系统: 根\n[requirement] 核心: REQ\n[design] 模块: MOD";
  const { updatedState: withTree } = commitArtifact(
    state,
    createRawArtifact(`${sessionId}-tree`, "structure.decompose", "架构", "spec_tree", treeContent),
    `${sessionId}-tree-run`,
    false,
    []
  );
  markTrusted(withTree, `${sessionId}-tree`);

  const withPreview = commitTrusted(
    withTree,
    `${sessionId}-preview`,
    "ux.preview",
    "产品",
    "preview",
    `${sessionId}-pv-run`,
    []
  );

  const mermaid = renderSpecTreeToMermaid(treeContent);
  const mermaidPreview = `【预览·未验证】\n\`\`\`mermaid\n${mermaid}\n\`\`\``;
  const { updatedState: withMermaid } = commitArtifact(
    withPreview,
    createRawArtifact(
      `${sessionId}-mermaid`,
      "outcome.visualize",
      "工程",
      "preview",
      mermaidPreview
    ),
    `${sessionId}-mv-run`,
    false,
    findInputsForCapability(withPreview, "outcome.visualize")
  );
  markTrusted(withMermaid, `${sessionId}-mermaid`);
  return withMermaid;
}

function runDeliveryPipeline(state: V5SessionState, turnId: string, userText: string): V5SessionState {
  const structure = pickStructureBeforeDelivery(state, userText);
  const delivery = pickDeliveryCapabilities(state);
  const pipeline = [...structure, ...delivery];

  let working = state;
  pipeline.forEach((pick, idx) => {
    const cap = pick.capabilityId;
    const role = pick.roleId;
    const runId = `${turnId}-run-${idx}`;
    const inputs = findInputsForCapability(working, cap);
    const kind = (CAPABILITY_OUTPUT_KIND[cap] ?? "decision") as Parameters<
      typeof createRawArtifact
    >[3];
    const { updatedState } = commitArtifact(
      working,
      createRawArtifact(`${turnId}-art-${idx}`, cap, role, kind),
      runId,
      false,
      inputs
    );
    working = updatedState;
  });
  return working;
}

// =====================================================================================
// S19 · Ship-time delivery chain
// =====================================================================================

describe("S19 · ship-time delivery chain", () => {
  it("delivery intent on clear session sets deliveryPhase shipping (C_PACK entry)", () => {
    const { state } = buildClearStateWithTrustedReport("S19-intake");
    const { preparedState } = intakeMessage(state, {
      turnId: "S19-i",
      userText: "打包落地交付",
    });
    expect(isDeliveryIntent("打包落地交付")).toBe(true);
    expect(preparedState.deliveryPhase).toBe("shipping");
  });

  it("pickDeliveryCapabilities returns ordered pipeline caps not yet trusted", () => {
    const { state } = buildClearStateWithTrustedReport("S19-pick");
    const picks = pickDeliveryCapabilities(state);
    expect(picks.map((p) => p.capabilityId)).toEqual(
      DELIVERY_PIPELINE.map((p) => p.capabilityId)
    );
  });

  it("orchestrate with delivery intent includes delivery caps when goal is clear", () => {
    const { state } = buildClearStateWithTrustedReport("S19-orch");
    const { preparedState } = intakeMessage(state, {
      turnId: "S19-o",
      userText: "落地交付验收包",
    });
    const picks = pickNextCapabilities(preparedState, "落地交付验收包");
    expect(picks.some((p) => p.capabilityId === "document.draft")).toBe(true);

    const { plan } = orchestrateReasoningTurn(preparedState, {
      turnId: "S19-o",
      userText: "落地交付验收包",
    });
    expect(plan.selected.some((s) => s.capabilityId === "document.draft")).toBe(true);
  });

  it("full pipeline: C_TREE→C_DOC→C_MATRIX→C_PACK→C_HAND→T_MERGE→DONE", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("S19-full");
    const final = runDeliveryPipeline(state, "S19-full", "打包落地交付");

    expect(final.deliveryPhase).toBe("shipped");
    expect(final.runtimePhase).toBe("done");

    const handoff = (final.artifacts || []).find(
      (a) => a.producedBy?.capabilityId === "handoff.package"
    );
    expect(handoff).toBeTruthy();
    expect(handoffPackageHasRequiredSections(handoff!.content || "")).toBe(true);

    const matrix = (final.artifacts || []).find(
      (a) => a.producedBy?.capabilityId === "traceability.matrix"
    );
    expect(matrix).toBeTruthy();
    expect(traceabilityMatrixHasFiveColumns(matrix!.content || "")).toBe(true);
    expect(traceabilityMatrixReferencesIds(matrix!.content || "", [reportId])).toBe(true);

    const tree = (final.artifacts || []).find((a) => a.kind === "spec_tree");
    expect(tree).toBeTruthy();
    const doc = (final.artifacts || []).find((a) => a.kind === "doc");
    expect(doc).toBeTruthy();
  });

  it("P5: commit-time gates never include T_MERGE / T_CONTENT / T_TEST", () => {
    const commitIds = evaluateCommitGates("handoff.package", {}).map((g) => g.gateId);
    expect(commitIds).not.toContain("T_MERGE");
    expect(commitIds).not.toContain("T_CONTENT");
    expect(commitIds).not.toContain("T_TEST");
    expect(RUNTIME_SRC).not.toMatch(/evaluateShipGates\([^)]*\)[\s\S]{0,120}commitArtifact/);
  });

  it("P5: ship-time gates recorded with phase=ship only after handoff.package", () => {
    const { state } = buildClearStateWithTrustedReport("S19-p5");
    const final = runDeliveryPipeline(state, "S19-p5", "落地交付");

    const commitGates = (final.gates || []).filter((g) => g.phase === "commit");
    const shipGates = (final.gates || []).filter((g) => g.phase === "ship");

    expect(commitGates.length).toBeGreaterThan(0);
    expect(shipGates.map((g) => g.gateId).sort()).toEqual(
      ["T_CONTENT", "T_MERGE", "T_TEST"].sort()
    );
    expect(commitGates.some((g) => g.gateId === "T_MERGE")).toBe(false);
    expect(
      (final.conversation || []).some((c) => /T_LEDGER.*phase=ship/.test(c.text || ""))
    ).toBe(true);
  });

  it("evaluateShipGates passes when report + handoff exist", () => {
    const { state } = buildClearStateWithTrustedReport("S19-ship");
    const shipped = runDeliveryPipeline(state, "S19-ship", "落地");
    const ship = evaluateShipGates(shipped);
    expect(ship.passed).toBe(true);
  });

  it("REPORT→C_PACK: delivery pipeline does not run when goal is not clear", () => {
    let s = buildClearStateWithTrustedReport("S19-block").state;
    s = { ...s, goal: { ...s.goal, status: "needs_refinement" } };
    expect(pickDeliveryCapabilities(s)).toEqual([]);
  });

  it("handoff bundles ledger export referencing capability runs", () => {
    const { state } = buildClearStateWithTrustedReport("S19-ledger");
    const final = runDeliveryPipeline(state, "S19-ledger", "打包交付");
    const handoff = (final.artifacts || []).find(
      (a) => a.producedBy?.capabilityId === "handoff.package"
    );
    expect(handoff?.content).toMatch(/台账导出/);
    expect(handoff?.content).toMatch(/capabilityRuns/);
  });

  it("S18+S19: C_MATRIX/C_VISREND/C_VISGEN bundle into handoff (edges 97–99)", () => {
    const seeded = seedVisualArtifacts("S19-bundle");
    const withUx = commitArtifact(
      seeded,
      createRawArtifact(`${seeded.sessionId}-ux`, "ux.preview", "产品", "preview", GOOD_PREVIEW),
      "S19-bundle-ux-run",
      false,
      findInputsForCapability(seeded, "ux.preview")
    ).updatedState;
    markTrusted(withUx, `${withUx.sessionId}-ux`);

    const final = runDeliveryPipeline(withUx, "S19-bundle", "打包落地交付");
    const handoff = (final.artifacts || []).find(
      (a) => a.producedBy?.capabilityId === "handoff.package"
    );
    const matrix = (final.artifacts || []).find(
      (a) => a.producedBy?.capabilityId === "traceability.matrix"
    );

    expect(handoff).toBeTruthy();
    expect(matrix).toBeTruthy();
    expect(handoffBundlesMatrixArtifact(handoff!.content || "", matrix!.id)).toBe(true);
    expect(handoffBundlesVisualRender(handoff!.content || "", `${withUx.sessionId}-mermaid`)).toBe(
      true
    );
    expect(
      handoffBundlesVisualPreview(handoff!.content || "", {
        artifactId: `${withUx.sessionId}-ux`,
        sourceCap: "ux.preview",
      })
    ).toBe(true);
  });
});