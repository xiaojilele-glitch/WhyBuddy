/**
 * WhyBuddy V5.1 Full-Path — S18 visual generation + preview audit chain.
 * Spec: docs/V5.1-full-path-test-plan.md (§2 S18; edges 73–74, 81–83).
 */

import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  intakeMessage,
  orchestrateReasoningTurn,
  commitArtifact,
  findInputsForCapability,
  pickNextCapabilities,
  getSessionLedger,
} from "./whybuddy-runtime";
import {
  COMPLEX_GOAL_TEXT,
  createRawArtifact,
  commitTrusted,
  markTrusted,
} from "./whybuddy-fullpath-fixtures";
import {
  pickVisualCapabilities,
  renderSpecTreeToMermaid,
  auditPreviewReal,
} from "@shared/blueprint/whybuddy-visual-chain";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

const FAKE_PREVIEW =
  "placeholder copy\nplaceholder copy\nplaceholder copy\nlorem ipsum preview";

const GOOD_PREVIEW =
  "【预览·未验证】模块预览页\n- 权限列表页 · 未验证\n- 角色配置页 · 未验证\n- 审计日志页 · 未验证";

function seedDocState(sessionId: string): V5SessionState {
  let s = createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId);
  return commitTrusted(s, `${sessionId}-doc`, "document.draft", "工程", "doc", `${sessionId}-d0`);
}

function seedSpecTreeState(sessionId: string): V5SessionState {
  const s = createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId);
  const treeContent =
    "【SPEC Tree】\n[root] 权限系统: 根\n[requirement] 核心: REQ\n[design] 模块: MOD";
  const { updatedState } = commitArtifact(
    s,
    createRawArtifact(
      `${sessionId}-tree`,
      "structure.decompose",
      "架构",
      "spec_tree",
      treeContent
    ),
    `${sessionId}-t0`,
    false,
    []
  );
  markTrusted(updatedState, `${sessionId}-tree`);
  return updatedState;
}

function commitPreview(
  state: V5SessionState,
  turnId: string,
  content: string,
  cap: "ux.preview" | "outcome.visualize" = "ux.preview"
) {
  const runId = `${turnId}-run-0`;
  return commitArtifact(
    state,
    {
      ...createRawArtifact(`${turnId}-preview`, cap, cap === "ux.preview" ? "产品" : "工程", "preview", content),
      provenance: "ai_generated",
    },
    runId,
    false,
    findInputsForCapability(state, cap)
  );
}

// =====================================================================================
// S18 · 视觉生成出图审计
// =====================================================================================

describe("S18 · visual generation + preview audit", () => {
  it("C_DOC→C_VISGEN: pickVisualCapabilities selects ux.preview when trusted doc exists", () => {
    const picks = pickVisualCapabilities(seedDocState("S18-pick"), "出个视觉效果图");
    expect(picks.some((p) => p.capabilityId === "ux.preview")).toBe(true);
  });

  it("C_TREE→C_VISREND: mermaid render intent picks outcome.visualize when spec_tree exists", () => {
    const picks = pickVisualCapabilities(seedSpecTreeState("S18-visrend"), "mermaid 结构图渲染");
    expect(picks[0]?.capabilityId).toBe("outcome.visualize");
  });

  it("T_AUDIT rejects fake preview: untrusted artifact + previews_real gate failed", () => {
    const { updatedState, committed } = commitPreview(
      seedDocState("S18-fake"),
      "S18-fake",
      FAKE_PREVIEW
    );
    expect(committed).toBeNull();
    const rejected = (updatedState.artifacts || []).find((a) => a.id === "S18-fake-preview");
    expect(rejected?.trustLevel).toBe("untrusted");
    const run = (updatedState.capabilityRuns || []).find((r) => r.id === "S18-fake-run-0");
    expect(run?.gateResults?.some((g) => g.gateId === "previews_real" && g.status === "failed")).toBe(
      true
    );
    expect(run?.outputs || []).toHaveLength(0);
    expect(auditPreviewReal(FAKE_PREVIEW).passed).toBe(false);
  });

  it("T_AUDIT→T_LEDGER: failed audit recorded in session ledger + conversation", () => {
    const { updatedState } = commitPreview(seedDocState("S18-ledger"), "S18-ledger", FAKE_PREVIEW);
    const ledger = getSessionLedger(updatedState);
    const previewRun = ledger.find((e) => e.capabilityId === "ux.preview");
    expect(previewRun?.trustLevel).toBe("untrusted");
    expect(previewRun?.gateSummary).toMatch(/failed/);
    expect(
      (updatedState.conversation || []).some((c) => /\[T_AUDIT\]/.test(c.text || ""))
    ).toBe(true);
  });

  it("T_AUDIT→C_VISGEN retry: good preview passes audit and commits gated_pass", () => {
    const afterFake = commitPreview(seedDocState("S18-retry"), "S18-r1", FAKE_PREVIEW).updatedState;
    const { updatedState, committed } = commitPreview(afterFake, "S18-r2", GOOD_PREVIEW);
    expect(committed?.trustLevel).toBe("gated_pass");
    expect(committed?.content).toContain("预览·未验证");
    expect(committed?.provenance).toBe("ai_generated");
    const run = (updatedState.capabilityRuns || []).find((r) => r.id === "S18-r2-run-0");
    expect(run?.outputs?.length).toBe(1);
  });

  it("C_VISREND: renderSpecTreeToMermaid is byte-identical across two commits", () => {
    const tree = seedSpecTreeState("S18-det");
    const treeArt = (tree.artifacts || []).find((a) => a.kind === "spec_tree");
    const mermaid = renderSpecTreeToMermaid(treeArt?.content || "");
    const { committed: c1 } = commitPreview(tree, "S18-m1", `【预览·未验证】\n\`\`\`mermaid\n${mermaid}\n\`\`\``, "outcome.visualize");
    const { committed: c2 } = commitPreview(tree, "S18-m2", `【预览·未验证】\n\`\`\`mermaid\n${mermaid}\n\`\`\``, "outcome.visualize");
    const extractMermaid = (content: string) => content.match(/```mermaid\n([\s\S]*?)\n```/)?.[1] || "";
    expect(extractMermaid(c1!.content || "")).toBe(extractMermaid(c2!.content || ""));
    expect(extractMermaid(c1!.content || "")).toBe(mermaid);
  });

  it("orchestrate visual turn after doc: plan includes ux.preview for visual intent", () => {
    const docState = seedDocState("S18-orch");
    const { preparedState } = intakeMessage(docState, {
      turnId: "S18-orch",
      userText: "出个模块预览效果图",
    });
    const picks = pickNextCapabilities(preparedState, "出个模块预览效果图");
    expect(picks.some((p) => p.capabilityId === "ux.preview")).toBe(true);

    const { plan } = orchestrateReasoningTurn(preparedState, {
      turnId: "S18-orch",
      userText: "出个模块预览效果图",
    });
    expect(plan.selected.some((s) => s.capabilityId === "ux.preview")).toBe(true);
  });

  it("all gated_pass preview artifacts carry 预览·未验证 label", () => {
    const { committed } = commitPreview(seedDocState("S18-label"), "S18-label", GOOD_PREVIEW);
    expect(committed?.content).toMatch(/预览·未验证/);
  });
});