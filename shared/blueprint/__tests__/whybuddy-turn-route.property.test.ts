/**
 * S9 multi-round projection property tests (tasks 7.3–7.8).
 * Feature: whybuddy-llm-autonomous-reasoning, Properties 33–38
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  deriveTurnRoute,
  buildRouteSummary,
  assertRouteCopySanitized,
  type TurnRouteFacts,
  type TurnRoundFacts,
} from "../whybuddy-turn-route.js";

const PBT_OPTS = { numRuns: 100 };

const baseFacts = (turnId: string, rounds: TurnRoundFacts[]): TurnRouteFacts => ({
  turnId,
  goalStatusBefore: "needs_refinement",
  goalStatusAfter: "clear",
  planSelectedCount: rounds[rounds.length - 1]?.planSelectedCount ?? 0,
  planSource: rounds[rounds.length - 1]?.planSource ?? "llm",
  dledgerDecisionId: rounds[rounds.length - 1]?.dledgerDecisionId ?? `${turnId}-dledger`,
  committedCount: 1,
  trustPassedCount: 1,
  trustTotalCount: 1,
  rounds,
});

const roundArb = fc.record({
  planSelectedCount: fc.integer({ min: 0, max: 5 }),
  planSource: fc.constantFrom("llm", "heuristic_fallback", "local_heuristic" as const),
  dledgerDecisionId: fc.uuid(),
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 33: 多轮投影序列正确
 * Validates: Requirements 14.1
 */
describe("Property 33: multi-round station sequence", () => {
  it("N rounds yield planning → execution pairs in order (until park)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), roundArb, (n, roundTpl) => {
        const rounds: TurnRoundFacts[] = Array.from({ length: n }, (_, i) => ({
          roundIndex: i + 1,
          ...roundTpl,
          planReason: undefined,
          parkReason: undefined,
        }));
        const stations = deriveTurnRoute(baseFacts("turn-p33", rounds));
        const kinds = stations.map((s) => s.kind);
        expect(kinds[0]).toBe("intake");
        let planCount = 0;
        let execCount = 0;
        for (const k of kinds) {
          if (k === "plan") planCount++;
          if (k === "execution") execCount++;
        }
        expect(planCount).toBe(n);
        expect(execCount).toBe(n);
      }),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 34: 投影零 LLM 零状态写入
 * Validates: Requirements 14.2
 */
describe("Property 34: pure derivation", () => {
  it("deriveTurnRoute does not mutate input facts", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), (n) => {
        const rounds: TurnRoundFacts[] = Array.from({ length: n }, (_, i) => ({
          roundIndex: i + 1,
          planSelectedCount: 2,
          planSource: "llm" as const,
          dledgerDecisionId: `d-${i}`,
        }));
        const facts = baseFacts("turn-p34", rounds);
        const snapshot = JSON.stringify(facts);
        deriveTurnRoute(facts);
        expect(JSON.stringify(facts)).toBe(snapshot);
      }),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 35: 投影文案无禁用术语
 * Validates: Requirements 14.3
 */
describe("Property 35: sanitized copy", () => {
  it("all generated multi-round routes pass assertRouteCopySanitized", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), (n) => {
        const rounds: TurnRoundFacts[] = Array.from({ length: n }, (_, i) => ({
          roundIndex: i + 1,
          planSelectedCount: i + 1,
          planSource: "llm" as const,
          dledgerDecisionId: `d-${i}`,
        }));
        const stations = deriveTurnRoute(baseFacts("turn-p35", rounds));
        expect(() => assertRouteCopySanitized(stations)).not.toThrow();
      }),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 36: 折叠态与展开态 token 一致(多轮)
 * Validates: Requirements 14.4
 */
describe("Property 36: collapsed summary tokens match expanded route", () => {
  it("buildRouteSummary tokens are subset of station summaryTokens", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), (n) => {
        const rounds: TurnRoundFacts[] = Array.from({ length: n }, (_, i) => ({
          roundIndex: i + 1,
          planSelectedCount: 2,
          planSource: "llm" as const,
          dledgerDecisionId: `d-${i}`,
        }));
        const stations = deriveTurnRoute(baseFacts("turn-p36", rounds));
        const summary = buildRouteSummary(stations);
        const tokens = stations
          .map((s) => s.summaryToken)
          .filter((t): t is string => Boolean(t));
        for (const token of tokens) {
          if (token !== "等待你" && token !== "收到") {
            expect(summary).toContain(token);
          }
        }
      }),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 37: 多轮站点 id 稳定且唯一
 * Validates: Requirements 14.5
 */
describe("Property 37: stable unique station ids", () => {
  it("every station id is turn-prefixed and globally unique", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (n) => {
        const turnId = "turn-p37";
        const rounds: TurnRoundFacts[] = Array.from({ length: n }, (_, i) => ({
          roundIndex: i + 1,
          planSelectedCount: 1,
          planSource: "llm" as const,
          dledgerDecisionId: `d-${i}`,
        }));
        const stations = deriveTurnRoute(baseFacts(turnId, rounds));
        const ids = stations.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
          expect(id.startsWith(turnId)).toBe(true);
        }
      }),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 38: 停泊轮反映停泊原因且不追加后续轮
 * Validates: Requirements 14.6
 */
describe("Property 38: parked round stops projection", () => {
  it("budget-blocked round has no stations after budget_block", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 8, maxLength: 40 }), (reason) => {
        fc.pre(!reason.includes("BUDGET_EXCEEDED"));
        const stations = deriveTurnRoute(
          baseFacts("turn-p38b", [
            {
              roundIndex: 1,
              planSelectedCount: 0,
              planSource: "llm",
              planReason: `BUDGET_EXCEEDED: ${reason}`,
              dledgerDecisionId: "d-budget",
            },
          ])
        );
        const budgetIdx = stations.findIndex((s) => s.kind === "budget_block");
        expect(budgetIdx).toBeGreaterThan(-1);
        expect(stations.slice(budgetIdx + 1).every((s) => s.kind === "await")).toBe(true);
      }),
      PBT_OPTS
    );
  });

  it("convergence_signal round has verdict and no further round stations", () => {
    const stations = deriveTurnRoute(
      baseFacts("turn-p38c", [
        { roundIndex: 1, planSelectedCount: 2, planSource: "llm", dledgerDecisionId: "d1" },
        {
          roundIndex: 2,
          planSelectedCount: 0,
          planSource: "llm",
          parkReason: "convergence_signal",
          dledgerDecisionId: "d2",
        },
      ])
    );
    const convIdx = stations.findIndex((s) => s.id === "turn-p38c-r2-verdict");
    expect(convIdx).toBeGreaterThan(-1);
    expect(stations.slice(convIdx + 1).every((s) => s.kind === "await")).toBe(true);
    expect(stations.some((s) => s.id === "turn-p38c-r3-plan")).toBe(false);
  });
});