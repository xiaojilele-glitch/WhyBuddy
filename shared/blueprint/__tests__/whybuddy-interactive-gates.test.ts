import { describe, it, expect } from "vitest";
import {
  isVagueGoal,
  userClearsReadiness,
  userExpressesRouteSelection,
  userPicksRoute,
  userRejectsRouteSelection,
  evaluateReadinessGateAfterCommit,
  evaluateConfirmGateAfterCommit,
} from "../whybuddy-interactive-gates";
import type { V5SessionState } from "../v5-reasoning-state";

function stubState(goalText: string, sessionId: string): V5SessionState {
  return {
    goal: { text: goalText, status: "needs_refinement" },
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
    sessionId,
  };
}

describe("whybuddy-interactive-gates (P0)", () => {
  it("flags vague goals for G_READY", () => {
    expect(isVagueGoal("做一个系统")).toBe(true);
    expect(isVagueGoal("面向企业内部 RBAC 权限与数据范围")).toBe(false);
  });

  it("G_READY parks after question.expand when goal still vague", () => {
    const state = stubState("做一个系统", "ig-ready");
    const verdict = evaluateReadinessGateAfterCommit(state, {
      capabilityId: "question.expand",
      turnUserText: "做一个系统",
    });
    expect(verdict.park).toBe(true);
    expect(verdict.gate).toBe("ready");
  });

  it("G_READY clears when user supplements readiness on same turn", () => {
    const state = stubState("做一个系统", "ig-clear");
    const verdict = evaluateReadinessGateAfterCommit(state, {
      capabilityId: "question.expand",
      turnUserText: "面向企业内部，需要 RBAC 与数据范围隔离",
    });
    expect(verdict.park).toBe(false);
    expect(userClearsReadiness("面向企业内部，需要 RBAC 与数据范围隔离", state)).toBe(true);
  });

  it("G_CONFIRM parks after route.compare without user selection", () => {
    let state = stubState("路线对比一下", "ig-confirm");
    state = {
      ...state,
      artifacts: [
        {
          id: "r1",
          kind: "route_options",
          provenance: "ai_generated",
          producedBy: { capabilityRunId: "run-0", capabilityId: "route.generate", roleId: "架构" },
          content: "路线 A",
          trustLevel: "gated_pass",
          passedGates: [],
        } as any,
        {
          id: "r2",
          kind: "route_options",
          provenance: "ai_generated",
          producedBy: { capabilityRunId: "run-1", capabilityId: "route.compare", roleId: "工程" },
          content: "路线 B",
          trustLevel: "gated_pass",
          passedGates: [],
        } as any,
      ],
    };
    const verdict = evaluateConfirmGateAfterCommit(state, {
      capabilityId: "route.compare",
      turnUserText: "路线对比一下",
    });
    expect(verdict.park).toBe(true);
    expect(verdict.gate).toBe("confirm");
  });

  it("splits route pick vs reject intents", () => {
    expect(userPicksRoute("选方案 B")).toBe(true);
    expect(userRejectsRouteSelection("都不行，重新对比")).toBe(true);
    expect(userExpressesRouteSelection("选方案 B")).toBe(true);
    expect(userExpressesRouteSelection("都不行，重新出")).toBe(true);
  });

  it("G_CONFIRM clears when user picks a route", () => {
    expect(userPicksRoute("选方案 B")).toBe(true);
    const state = stubState("测试", "ig-pick");
    const verdict = evaluateConfirmGateAfterCommit(
      {
        ...state,
        artifacts: [
          {
            id: "r1",
            kind: "route_options",
            provenance: "ai_generated",
            producedBy: { capabilityRunId: "run-0", capabilityId: "route.compare", roleId: "工程" },
            content: "对比",
            trustLevel: "gated_pass",
            passedGates: [],
          } as any,
        ],
      },
      { capabilityId: "route.compare", turnUserText: "选方案 B，先做渐进交付" }
    );
    expect(verdict.park).toBe(false);
  });
});