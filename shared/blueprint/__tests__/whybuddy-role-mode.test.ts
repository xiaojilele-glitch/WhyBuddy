import { describe, it, expect } from "vitest";
import type { V5SessionState } from "../v5-reasoning-state.js";
import {
  resolveRoleMode,
  pickBrainstormChain,
  shouldDegradeBrainstorm,
  isDeliberationCapability,
} from "../whybuddy-role-mode.js";

function stub(goal: string): V5SessionState {
  return {
    goal: { text: goal, status: "needs_refinement" },
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
    sessionId: "rm-test",
  };
}

describe("whybuddy-role-mode (S16/S17)", () => {
  it("resolveRoleMode complex for brainstorm keywords", () => {
    expect(resolveRoleMode(stub("权限系统"), "来个多角色辩论")).toBe("complex");
  });

  it("pickBrainstormChain orders critique before counter", () => {
    const picks = pickBrainstormChain(stub("复杂平台"));
    expect(picks[0]?.capabilityId).toBe("critique.generate");
  });

  it("degraded mode when brainstormDegraded flag set", () => {
    const s = { ...stub("x"), brainstormDegraded: true };
    expect(shouldDegradeBrainstorm(s, "辩论")).toBe(true);
    expect(resolveRoleMode(s, "辩论")).toBe("degraded");
  });

  it("isDeliberationCapability recognizes brainstorm caps", () => {
    expect(isDeliberationCapability("critique.generate")).toBe(true);
    expect(isDeliberationCapability("risk.analyze")).toBe(false);
  });
});