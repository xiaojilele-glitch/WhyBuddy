import { describe, it, expect } from "vitest";
import type { V5SessionState } from "../v5-reasoning-state.js";
import { shouldEscalateOnBudgetBlock } from "../whybuddy-budget-esc.js";

function stub(partial: Partial<V5SessionState> = {}): V5SessionState {
  return {
    goal: { text: "test", status: "needs_refinement" },
    graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [] },
    artifacts: [],
    capabilityRuns: [],
    conversation: [],
    openQuestions: [],
    evidence: [],
    decisions: [],
    risks: [],
    gates: [],
    dependencyGraph: [],
    staleArtifactIds: [],
    sessionId: "esc-test",
    ...partial,
  };
}

describe("whybuddy-budget-esc (P4)", () => {
  it("escalates when budget blocked and GCOV missing caps", () => {
    const s = stub({
      coverageGate: { passed: false, missingCapabilities: ["risk.analyze"], reason: "blocked" },
    });
    expect(shouldEscalateOnBudgetBlock(s, true)).toBe(true);
  });

  it("does not escalate when budget ok", () => {
    expect(shouldEscalateOnBudgetBlock(stub(), false)).toBe(false);
  });
});