/**
 * P4 · Budget → ESC when convergence is impossible under remaining budget.
 */

import type { CoverageGateResult, V5SessionState } from "./v5-reasoning-state.js";

export function isCoverageUnsatisfiable(
  state: V5SessionState,
  gate?: CoverageGateResult
): boolean {
  const gaps = state.coverageGaps || [];
  const openBlocking = gaps.filter((g) => g.status === "open").length;
  const missing = gate?.missingCapabilities?.length ?? state.coverageGate?.missingCapabilities?.length ?? 0;
  if (openBlocking > 0 || missing > 0) return true;
  if (state.coverageGate?.passed === false) return true;
  return false;
}

/** True when budget blocks ORCH and GCOV cannot be satisfied → escalate to human. */
export function shouldEscalateOnBudgetBlock(
  state: V5SessionState,
  budgetBlocked: boolean,
  gate?: CoverageGateResult
): boolean {
  if (!budgetBlocked) return false;
  return isCoverageUnsatisfiable(state, gate);
}