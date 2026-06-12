import { describe, it, expect } from "vitest";
import { evaluateCommitGates, evaluateShipGates } from "../whybuddy-ship-gates.js";
import type { V5SessionState } from "../v5-reasoning-state.js";

describe("whybuddy-ship-gates (P5)", () => {
  it("commit gates exclude merge at commit time", () => {
    const gates = evaluateCommitGates("risk.analyze", {});
    expect(gates.some((g) => g.gateId === "merge")).toBe(false);
    expect(gates.some((g) => g.gateId === "commit")).toBe(true);
  });

  it("ship gates require clear goal and handoff for full pass", () => {
    const state: V5SessionState = {
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
        {
          id: "h1",
          kind: "plan",
          provenance: "ai_generated",
          trustLevel: "gated_pass",
          passedGates: ["commit"],
          producedBy: { capabilityRunId: "run2", capabilityId: "handoff.package", roleId: "工程" },
          content: "handoff",
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
      sessionId: "ship-test",
    };
    const ship = evaluateShipGates(state);
    expect(ship.passed).toBe(true);
    expect(ship.gates.map((g) => g.gateId)).toEqual(["T_CONTENT", "T_TEST", "T_MERGE"]);
  });
});