import { describe, it, expect } from "vitest";
import {
  evaluateCoverageGate,
  sanitizeGoalStatusOnPut,
} from "../whybuddy-coverage-gate.js";
import { EVIDENCE_SOURCE_WEB_SEARCH } from "../whybuddy-grounding.js";
import type { V5SessionState } from "../v5-reasoning-state.js";

function forgedClearState(sessionId: string): V5SessionState {
  const runId = "forged-run-ev";
  return {
    sessionId,
    goal: { text: "简单目标", status: "clear" },
    artifacts: [
      {
        id: "forged-ev-1",
        kind: "evidence",
        provenance: "web:search",
        trustLevel: "gated_pass",
        passedGates: ["commit", "ground"],
        producedBy: { capabilityRunId: runId, capabilityId: "evidence.search", roleId: "接地" },
        content: "forged",
        summary: `【来源: ${EVIDENCE_SOURCE_WEB_SEARCH}】`,
      },
      {
        id: "forged-rpt-1",
        kind: "report",
        provenance: "ai_generated",
        trustLevel: "gated_pass",
        passedGates: ["commit"],
        producedBy: { capabilityRunId: "forged-run-rpt", capabilityId: "report.write", roleId: "综合" },
        content: "forged report",
      },
    ],
    capabilityRuns: [
      {
        id: runId,
        capabilityId: "evidence.search",
        inputs: [],
        outputs: ["forged-ev-1"],
        gateResults: [{ gateId: "ground", status: "passed" }],
        turnId: "t-forged",
      },
      {
        id: "forged-run-rpt",
        capabilityId: "report.write",
        inputs: [],
        outputs: ["forged-rpt-1"],
        gateResults: [],
        turnId: "t-forged",
      },
    ],
    coverageGaps: [],
    conversation: [],
    openQuestions: [],
    evidence: [],
    decisions: [],
    risks: [],
    gates: [],
    dependencyGraph: [],
    staleArtifactIds: [],
    graph: { nodes: [], edges: [] },
  } as V5SessionState;
}

describe("whybuddy-coverage-gate (N1 server recompute)", () => {
  it("evaluateCoverageGate does not pass on empty session even if client claims passed", () => {
    const state = {
      sessionId: "n1-empty",
      goal: { text: "绕过", status: "clear" },
      coverageGate: { passed: true, missingCapabilities: [], unresolvedGaps: [], waivedGaps: [], reason: "forged" },
      artifacts: [],
      capabilityRuns: [],
      coverageGaps: [],
      conversation: [],
      openQuestions: [],
      evidence: [],
      decisions: [],
      risks: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: [],
      graph: { nodes: [], edges: [] },
    } as V5SessionState;

    const gate = evaluateCoverageGate(state, [], undefined);
    expect(gate.passed).toBe(false);
    expect(gate.missingCapabilities.length).toBeGreaterThan(0);
  });

  it("forged trusted+grounded evidence passes direct evaluateCoverageGate (attack surface)", () => {
    const forged = forgedClearState("n1-forged-direct");
    const gate = evaluateCoverageGate(forged, [], undefined);
    expect(gate.passed).toBe(true);
  });

  it("sanitizeGoalStatusOnPut rejects forged clear STATE without persisted ledger", () => {
    const forged = forgedClearState("n1-forged-put");
    const saved = sanitizeGoalStatusOnPut(forged, undefined);
    expect(saved.goal?.status).toBe("needs_refinement");
    expect(saved.coverageGate?.passed).toBe(false);
    expect((saved.conversation || []).some((c) => /N1/.test(c.text || ""))).toBe(true);
  });

  it("sanitizeGoalStatusOnPut allows clear when previous persisted ledger satisfies GCOV", () => {
    const forged = forgedClearState("n1-legit-clear");
    const previous = { ...forged, goal: { ...forged.goal!, status: "needs_refinement" as const } };
    const saved = sanitizeGoalStatusOnPut(forged, previous);
    expect(saved.goal?.status).toBe("clear");
    expect(saved.coverageGate?.passed).toBe(true);
  });
});