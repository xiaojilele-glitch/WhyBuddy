import { describe, it, expect } from "vitest";
import {
  deriveTurnRoute,
  buildRouteSummary,
  assertRouteCopySanitized,
} from "@shared/blueprint/whybuddy-turn-route";

/** S9 client smoke — full matrix lives in shared/blueprint/__tests__/whybuddy-turn-route.test.ts */
describe("deriveTurnRoute client smoke (S9)", () => {
  it("S9-A1/A5: normal path summary matches expanded tokens", () => {
    const stations = deriveTurnRoute({
      turnId: "turn-smoke",
      planReason: "picked",
      planSelectedCount: 2,
      planSource: "local_heuristic",
      dledgerDecisionId: "turn-smoke-dledger",
      trustPassedCount: 2,
      trustTotalCount: 2,
      goalStatusAfter: "clear",
      runtimePhase: "awaiting",
    });
    expect(stations.map((s) => s.kind)).toEqual([
      "intake",
      "budget_pass",
      "plan",
      "trust_gate",
      "verdict",
      "await",
    ]);
    const summary = buildRouteSummary(stations);
    // Current summary uses budget-aware English tokens (S9 evolution); full matrix asserted in shared test.
    expect(summary).toContain("BUDGET");
    expect(summary).toContain("▸");
    assertRouteCopySanitized(stations);
  });
});