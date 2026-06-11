import { describe, it, expect } from "vitest";
import {
  deriveTurnRoute,
  buildRouteSummary,
  assertRouteCopySanitized,
  staleAddedCount,
  goalStatusUserLabel,
  type TurnRouteFacts,
} from "../whybuddy-turn-route.js";

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
  ...overrides,
});

describe("deriveTurnRoute (S9)", () => {
  it("S9-A1: normal path — intake → plan → execution → trust → verdict → await", () => {
    const stations = deriveTurnRoute(base());
    expect(stations.map((s) => s.kind)).toEqual([
      "intake",
      "plan",
      "execution",
      "trust_gate",
      "verdict",
      "await",
    ]);
    assertRouteCopySanitized(stations);
  });

  it("S9-A1: challenge path — adds stale cascade after intake", () => {
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
      "plan",
      "execution",
      "trust_gate",
      "verdict",
      "await",
    ]);
    expect(stations.find((s) => s.kind === "intake")?.title).toBe("收到质疑");
    expect(stations.find((s) => s.kind === "stale_cascade")?.detail).toBe(
      "2 个产物已过期 · 结论从「已收敛」降级为「待细化」"
    );
    assertRouteCopySanitized(stations);
  });

  it("S9-A1: budget path short-circuits execution/trust/verdict", () => {
    const stations = deriveTurnRoute(
      base({
        planReason: "BUDGET_EXCEEDED: turn cap",
        planSelectedCount: 0,
        dledgerDecisionId: "turn-1-dledger-budget",
        trustPassedCount: 0,
        trustTotalCount: 0,
      })
    );
    expect(stations.map((s) => s.kind)).toEqual(["intake", "plan", "budget_block", "await"]);
    expect(stations.find((s) => s.kind === "budget_block")?.tone).toBe("fail");
    assertRouteCopySanitized(stations);
  });

  it("S9-A2: reconverge verdict shows 待细化 → 已收敛 transition", () => {
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
    const verdict = stations.find((s) => s.kind === "verdict");
    expect(verdict?.detail).toBe("待细化 → 已收敛(机械裁决)");
    expect(verdict?.tone).toBe("pass");
  });

  it("S9-A3: trust gate shows 2/3 partial — not all green", () => {
    const stations = deriveTurnRoute(
      base({
        trustPassedCount: 2,
        trustTotalCount: 3,
      })
    );
    const trust = stations.find((s) => s.kind === "trust_gate");
    expect(trust?.detail).toBe("2/3 通过信任门");
    expect(trust?.tone).toBe("partial");
    expect(trust?.summaryToken).toBe("校验 2/3");
  });

  it("S9-A4: hides plan station when DLEDGER data missing", () => {
    const stations = deriveTurnRoute(
      base({
        dledgerDecisionId: null,
        planSource: undefined,
      })
    );
    expect(stations.some((s) => s.kind === "plan")).toBe(false);
  });

  it("S9-A5: collapsed summary derives from same station tokens", () => {
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
    expect(summary).toBe("收到质疑 → 撤回 2 → 规划 → 推演 3 → 校验 3/3 → 待细化 ▸");
    for (const token of ["收到质疑", "撤回 2", "推演 3", "校验 3/3", "待细化"]) {
      expect(summary).toContain(token);
    }
  });

  it("S9 multi-round: two rounds — planning₁ → exec₁ → planning₂ → exec₂ → verdict → await (task 7.1)", () => {
    const stations = deriveTurnRoute(
      base({
        rounds: [
          {
            roundIndex: 1,
            planSelectedCount: 2,
            planSource: "llm",
            dledgerDecisionId: "turn-1-r1-dledger",
          },
          {
            roundIndex: 2,
            planSelectedCount: 1,
            planSource: "heuristic_fallback",
            dledgerDecisionId: "turn-1-r2-dledger",
          },
        ],
      })
    );
    expect(stations.map((s) => s.id)).toEqual([
      "turn-1-intake",
      "turn-1-r1-plan",
      "turn-1-r1-exec",
      "turn-1-r2-plan",
      "turn-1-r2-exec",
      "turn-1-trust",
      "turn-1-verdict",
      "turn-1-await",
    ]);
    assertRouteCopySanitized(stations);
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
          },
        ],
        trustPassedCount: 0,
        trustTotalCount: 0,
      })
    );
    expect(stations.map((s) => s.kind)).toEqual(["intake", "plan", "budget_block", "await"]);
    expect(stations.find((s) => s.kind === "budget_block")?.tone).toBe("fail");
  });

  it("S9 multi-round: convergence_signal round ends with verdict, no exec₂ (task 7.1 / 14.6)", () => {
    const stations = deriveTurnRoute(
      base({
        rounds: [
          {
            roundIndex: 1,
            planSelectedCount: 2,
            planSource: "llm",
            dledgerDecisionId: "turn-1-r1-dledger",
          },
          {
            roundIndex: 2,
            planSelectedCount: 0,
            planSource: "llm",
            parkReason: "convergence_signal",
            dledgerDecisionId: "turn-1-r2-dledger",
          },
        ],
        trustPassedCount: 0,
        trustTotalCount: 0,
      })
    );
    expect(stations.map((s) => s.kind)).toEqual([
      "intake",
      "plan",
      "execution",
      "plan",
      "verdict",
      "await",
    ]);
    expect(stations.find((s) => s.id === "turn-1-r2-verdict")?.detail).toBe(
      "已收敛 · 无需更多推演"
    );
  });

  it("S9 multi-round: collapsed summary covers all round tokens (task 7.1)", () => {
    const stations = deriveTurnRoute(
      base({
        rounds: [
          {
            roundIndex: 1,
            planSelectedCount: 2,
            planSource: "llm",
            dledgerDecisionId: "turn-1-r1-dledger",
          },
          {
            roundIndex: 2,
            planSelectedCount: 1,
            planSource: "llm",
            dledgerDecisionId: "turn-1-r2-dledger",
          },
        ],
      })
    );
    const summary = buildRouteSummary(stations);
    expect(summary).toContain("规划");
    expect(summary).toContain("推演 2");
    expect(summary).toContain("推演 1");
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
    expect(blob).not.toMatch(/risk\.analyze|report\.write/);
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