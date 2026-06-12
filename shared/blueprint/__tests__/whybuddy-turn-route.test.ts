import { describe, it, expect } from "vitest";
import {
  deriveTurnRoute,
  buildRouteSummary,
  assertRouteCopySanitized,
  staleAddedCount,
  goalStatusUserLabel,
  type TurnRouteFacts,
} from "../whybuddy-turn-route.js";

const defaultPicks = [
  { capabilityId: "evidence.search", roleId: "接地" },
  { capabilityId: "risk.analyze", roleId: "安全" },
  { capabilityId: "synthesis.merge", roleId: "综合" },
] as const;

const base = (overrides: Partial<TurnRouteFacts> = {}): TurnRouteFacts => ({
  turnId: "turn-1",
  timestamp: "2026-06-11T10:42:03.000Z",
  goalStatusBefore: "needs_refinement",
  goalStatusAfter: "clear",
  planReason: "picked",
  planSelectedCount: 3,
  planSource: "local_heuristic",
  dledgerDecisionId: "turn-1-dledger",
  committedCount: 3,
  trustPassedCount: 3,
  trustTotalCount: 3,
  runtimePhase: "awaiting",
  selectedCapabilities: [...defaultPicks],
  ...overrides,
});

describe("deriveTurnRoute (S9)", () => {
  it("S9-A1: normal path — V5.1 nodes INTAKE → BUDGET → ORCH → C_* → T_GATE → GCOV → AWAIT", () => {
    const stations = deriveTurnRoute(base());
    expect(stations.map((s) => s.kind)).toEqual([
      "intake",
      "budget_pass",
      "plan",
      "capability",
      "capability",
      "capability",
      "trust_gate",
      "verdict",
      "await",
    ]);
    expect(stations.find((s) => s.kind === "intake")?.v51NodeId).toBe("INTAKE");
    expect(stations.find((s) => s.kind === "plan")?.v51NodeId).toBe("ORCH");
    expect(stations.filter((s) => s.kind === "capability").map((s) => s.v51NodeId)).toEqual([
      "C_EVID",
      "C_RISK",
      "C_SYN",
    ]);
    assertRouteCopySanitized(stations);
  });

  it("S9-A1: challenge path — INTERV + INVAL after intake", () => {
    const stations = deriveTurnRoute(
      base({
        interventionIntent: "challenge",
        challengeTargetLabel: "可行性报告 · 第 1 版",
        goalStatusBefore: "clear",
        goalStatusAfterInvalidate: "needs_refinement",
        goalStatusAfter: "clear",
        staleArtifactIdsBefore: ["risk-1"],
        staleArtifactIdsAfter: ["risk-1", "report-1", "synth-1"],
      })
    );
    expect(stations.map((s) => s.kind)).toEqual([
      "intake",
      "stale_cascade",
      "budget_pass",
      "plan",
      "capability",
      "capability",
      "capability",
      "trust_gate",
      "verdict",
      "await",
    ]);
    expect(stations.find((s) => s.kind === "intake")?.v51NodeId).toBe("INTERV");
    expect(stations.find((s) => s.kind === "stale_cascade")?.v51NodeId).toBe("INVAL");
    expect(stations.find((s) => s.kind === "stale_cascade")?.detail).toContain("DEP → INVAL");
    assertRouteCopySanitized(stations);
  });

  it("S9-A1: budget path short-circuits capability/trust/gcov", () => {
    const stations = deriveTurnRoute(
      base({
        planReason: "BUDGET_EXCEEDED: turn cap",
        planSelectedCount: 0,
        dledgerDecisionId: "turn-1-dledger-budget",
        trustPassedCount: 0,
        trustTotalCount: 0,
        selectedCapabilities: [],
      })
    );
    expect(stations.map((s) => s.kind)).toEqual(["intake", "plan", "budget_block", "await"]);
    expect(stations.find((s) => s.kind === "budget_block")?.v51NodeId).toBe("BUDGET");
    assertRouteCopySanitized(stations);
  });

  it("S9-A2: GCOV station shows GOAL transition", () => {
    const stations = deriveTurnRoute(
      base({
        interventionIntent: "challenge",
        goalStatusBefore: "needs_refinement",
        goalStatusAfterInvalidate: "needs_refinement",
        goalStatusAfter: "clear",
        staleArtifactIdsBefore: [],
        staleArtifactIdsAfter: ["report-1", "synth-1"],
        challengeTargetLabel: "可行性报告 · 第 1 版",
      })
    );
    const gcov = stations.find((s) => s.kind === "verdict");
    expect(gcov?.v51NodeId).toBe("GCOV");
    expect(gcov?.detail).toContain("GOAL");
    expect(gcov?.tone).toBe("pass");
  });

  it("S9-A3: T_GATE shows partial pass count", () => {
    const stations = deriveTurnRoute(
      base({
        trustPassedCount: 2,
        trustTotalCount: 3,
      })
    );
    const trust = stations.find((s) => s.kind === "trust_gate");
    expect(trust?.v51NodeId).toBe("T_GATE");
    expect(trust?.detail).toContain("2/3");
    expect(trust?.tone).toBe("partial");
    expect(trust?.summaryToken).toBe("T_GATE");
  });

  it("S9-A4: hides ORCH station when DLEDGER data missing", () => {
    const stations = deriveTurnRoute(
      base({
        dledgerDecisionId: null,
        planSource: undefined,
      })
    );
    expect(stations.some((s) => s.kind === "plan")).toBe(false);
  });

  it("S9-A5: collapsed summary uses V5.1 node tokens", () => {
    const stations = deriveTurnRoute(
      base({
        interventionIntent: "challenge",
        staleArtifactIdsBefore: [],
        staleArtifactIdsAfter: ["a", "b"],
        goalStatusBefore: "clear",
        goalStatusAfter: "needs_refinement",
      })
    );
    const summary = buildRouteSummary(stations);
    expect(summary).toContain("INTERV");
    expect(summary).toContain("INVAL");
    expect(summary).toContain("ORCH");
    expect(summary).toContain("C_EVID");
    expect(summary).toContain("T_GATE");
    expect(summary).toContain("GCOV");
  });

  it("S9 multi-round: two rounds — BUDGET → ORCH → C_* per loop (task 7.1)", () => {
    const stations = deriveTurnRoute(
      base({
        selectedCapabilities: undefined,
        rounds: [
          {
            roundIndex: 1,
            planSelectedCount: 2,
            planSource: "llm",
            dledgerDecisionId: "turn-1-r1-dledger",
            selectedCapabilities: [
              { capabilityId: "evidence.search", roleId: "接地" },
              { capabilityId: "risk.analyze", roleId: "安全" },
            ],
          },
          {
            roundIndex: 2,
            planSelectedCount: 1,
            planSource: "heuristic_fallback",
            dledgerDecisionId: "turn-1-r2-dledger",
            selectedCapabilities: [{ capabilityId: "synthesis.merge", roleId: "综合" }],
          },
        ],
      })
    );
    expect(stations.map((s) => s.id)).toEqual([
      "turn-1-intake",
      "turn-1-r1-budget-pass",
      "turn-1-r1-plan",
      "turn-1-r1-cap-0",
      "turn-1-r1-cap-1",
      "turn-1-r2-reentry",
      "turn-1-r2-budget-pass",
      "turn-1-r2-plan",
      "turn-1-r2-cap-0",
      "turn-1-trust",
      "turn-1-verdict",
      "turn-1-done",
    ]);
    const r2Budget = stations.find((s) => s.id === "turn-1-r2-budget-pass");
    expect(r2Budget?.linkKind).toBe("reentry");
    expect(r2Budget?.reentryTargetV51).toBe("BUDGET");
    expect(r2Budget?.depth).toBe(stations.find((s) => s.id === "turn-1-r1-budget-pass")?.depth);
    expect(stations.find((s) => s.id === "turn-1-r2-reentry")?.linkKind).toBe("reentry");
    expect(stations.find((s) => s.v51NodeId === "DONE")?.tone).toBe("pass");
    assertRouteCopySanitized(stations);
  });

  it("S9 tree: BUS capabilities parallel-fork under ORCH (fixed architecture plane)", () => {
    const stations = deriveTurnRoute(base());
    const orch = stations.find((s) => s.kind === "plan");
    const caps = stations.filter((s) => s.kind === "capability");
    expect(orch?.depth).toBe(2);
    expect(caps.every((c) => c.linkKind === "parallel")).toBe(true);
    expect(caps.every((c) => c.depth === 3)).toBe(true);
    expect(caps.every((c) => c.parentId === orch?.id)).toBe(true);
    expect(caps[0]?.branchIndex).toBe(0);
    expect(caps[1]?.branchIndex).toBe(1);
    expect(caps[caps.length - 1]?.isLastSibling).toBe(true);
  });

  it("S9 tree: challenge INVAL branches then re-enters BUDGET spine", () => {
    const stations = deriveTurnRoute(
      base({
        interventionIntent: "challenge",
        staleArtifactIdsBefore: [],
        staleArtifactIdsAfter: ["a", "b"],
        goalStatusBefore: "clear",
        goalStatusAfter: "needs_refinement",
      })
    );
    const intake = stations.find((s) => s.kind === "intake");
    const inval = stations.find((s) => s.kind === "stale_cascade");
    const budget = stations.find((s) => s.kind === "budget_pass");
    expect(inval?.parentId).toBe(intake?.id);
    expect(budget?.parentId).toBe(inval?.id);
    expect(budget?.depth).toBe(1);
  });

  it("S11: await_ready inserts G_READY before AWAIT (no T_GATE/GCOV)", () => {
    const stations = deriveTurnRoute(
      base({
        goalStatusAfter: "needs_refinement",
        closureReason: "await_ready",
        selectedCapabilities: [{ capabilityId: "question.expand", roleId: "规划" }],
        committedCount: 1,
        trustPassedCount: 1,
        trustTotalCount: 1,
      })
    );
    expect(stations.map((s) => s.v51NodeId)).toEqual([
      "INTAKE",
      "BUDGET",
      "ORCH",
      "C_QEXP",
      "G_READY",
      "AWAIT",
    ]);
    expect(stations.some((s) => s.v51NodeId === "T_GATE")).toBe(false);
    assertRouteCopySanitized(stations);
  });

  it("S12: await_confirm inserts G_CONFIRM before AWAIT", () => {
    const stations = deriveTurnRoute(
      base({
        goalStatusAfter: "needs_refinement",
        closureReason: "await_confirm",
        selectedCapabilities: [
          { capabilityId: "route.generate", roleId: "架构" },
          { capabilityId: "route.compare", roleId: "工程" },
        ],
        committedCount: 2,
        trustPassedCount: 2,
        trustTotalCount: 2,
      })
    );
    expect(stations.map((s) => s.v51NodeId)).toContain("G_CONFIRM");
    expect(stations[stations.length - 2]?.v51NodeId).toBe("G_CONFIRM");
    expect(stations[stations.length - 1]?.v51NodeId).toBe("AWAIT");
    assertRouteCopySanitized(stations);
  });

  it("S9 closure: coverage_sufficient yields DONE not AWAIT", () => {
    const stations = deriveTurnRoute(
      base({
        goalStatusAfter: "needs_refinement",
        closureReason: "coverage_sufficient",
      })
    );
    expect(stations[stations.length - 1]?.v51NodeId).toBe("DONE");
    expect(stations.some((s) => s.v51NodeId === "AWAIT")).toBe(false);
  });

  it("S9 multi-round: budget-blocked round stops without further round stations (task 7.1 / 14.6)", () => {
    const stations = deriveTurnRoute(
      base({
        rounds: [
          {
            roundIndex: 1,
            planSelectedCount: 0,
            planSource: "llm",
            planReason: "BUDGET_EXCEEDED: maxTurns",
            dledgerDecisionId: "turn-1-r1-dledger",
            selectedCapabilities: [],
          },
        ],
        trustPassedCount: 0,
        trustTotalCount: 0,
        selectedCapabilities: [],
      })
    );
    expect(stations.map((s) => s.kind)).toEqual(["intake", "plan", "budget_block", "await"]);
    expect(stations.find((s) => s.kind === "budget_block")?.tone).toBe("fail");
  });

  it("S9 multi-round: convergence_signal round ends with GCOV, no second BUS batch", () => {
    const stations = deriveTurnRoute(
      base({
        rounds: [
          {
            roundIndex: 1,
            planSelectedCount: 2,
            planSource: "llm",
            dledgerDecisionId: "turn-1-r1-dledger",
            selectedCapabilities: [
              { capabilityId: "evidence.search", roleId: "接地" },
              { capabilityId: "risk.analyze", roleId: "安全" },
            ],
          },
          {
            roundIndex: 2,
            planSelectedCount: 0,
            planSource: "llm",
            parkReason: "convergence_signal",
            dledgerDecisionId: "turn-1-r2-dledger",
            selectedCapabilities: [],
          },
        ],
        trustPassedCount: 0,
        trustTotalCount: 0,
        selectedCapabilities: [],
      })
    );
    expect(stations.map((s) => s.kind)).toEqual([
      "intake",
      "budget_pass",
      "plan",
      "capability",
      "capability",
      "budget_pass",
      "plan",
      "verdict",
      "await",
    ]);
    expect(stations.find((s) => s.id === "turn-1-r2-verdict")?.v51NodeId).toBe("GCOV");
  });

  it("S9 multi-round: collapsed summary covers ORCH and pool nodes", () => {
    const stations = deriveTurnRoute(
      base({
        selectedCapabilities: undefined,
        rounds: [
          {
            roundIndex: 1,
            planSelectedCount: 2,
            planSource: "llm",
            dledgerDecisionId: "turn-1-r1-dledger",
            selectedCapabilities: [
              { capabilityId: "evidence.search", roleId: "接地" },
              { capabilityId: "risk.analyze", roleId: "安全" },
            ],
          },
          {
            roundIndex: 2,
            planSelectedCount: 1,
            planSource: "llm",
            dledgerDecisionId: "turn-1-r2-dledger",
            selectedCapabilities: [{ capabilityId: "synthesis.merge", roleId: "综合" }],
          },
        ],
      })
    );
    const summary = buildRouteSummary(stations);
    expect(summary).toContain("ORCH");
    expect(summary).toContain("C_EVID");
    expect(summary).toContain("C_RISK");
    expect(summary).toContain("C_SYN");
  });

  it("S9-A6: route copy has no forbidden engineering terms", () => {
    const stations = deriveTurnRoute(
      base({
        interventionIntent: "challenge",
        staleArtifactIdsBefore: ["x"],
        staleArtifactIdsAfter: ["x", "y"],
      })
    );
    expect(() => assertRouteCopySanitized(stations)).not.toThrow();
    const blob = stations.map((s) => `${s.title} ${s.detail || ""}`).join(" ");
    expect(blob).not.toMatch(/\bstale\b/i);
    expect(blob).not.toMatch(/\bartifact\b/i);
    expect(blob).toMatch(/C_RISK · 反驳与风险/);
  });
});

describe("staleAddedCount", () => {
  it("counts set difference, not raw length delta", () => {
    expect(
      staleAddedCount({
        turnId: "t",
        staleArtifactIdsBefore: ["a", "b"],
        staleArtifactIdsAfter: ["a", "b", "c"],
      })
    ).toBe(1);
  });
});

describe("goalStatusUserLabel", () => {
  it("maps mechanical statuses to user copy", () => {
    expect(goalStatusUserLabel("clear")).toBe("已收敛");
    expect(goalStatusUserLabel("not_recommended")).toBe("不建议");
    expect(goalStatusUserLabel("needs_refinement")).toBe("待细化");
  });
});