import type { DriveReasoningResult } from "@/lib/whybuddy-runtime";
import type { SchedulingDecision } from "@shared/blueprint/v5-reasoning-state";
import type { TurnRoundFacts } from "@shared/blueprint/whybuddy-turn-route";

function dledgerForTurn(
  ledger: SchedulingDecision[] | undefined,
  loopTurnId: string
): SchedulingDecision | null {
  const arr = ledger || [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].turnId === loopTurnId) return arr[i];
  }
  return null;
}

/**
 * Task 7.2: derive multi-round timeline facts from Session_Driver loops.
 * Returns `undefined` for single-round turns (backward-compatible projection).
 */
export function buildTurnRoundsFromDrive(
  ledger: SchedulingDecision[] | undefined,
  drive: Pick<DriveReasoningResult, "loops" | "stopReason">
): TurnRoundFacts[] | undefined {
  if (drive.loops.length < 2) return undefined;

  return drive.loops.map((loop, idx) => {
    const dledger = dledgerForTurn(ledger, loop.loopTurnId);
    const planSource = dledger?.source;
    const parkReason = loop.stopSignal ?? (idx === drive.loops.length - 1 ? drive.stopReason : undefined);
    return {
      roundIndex: idx + 1,
      planSelectedCount: loop.plan.selected.length,
      planSource,
      planReason: loop.plan.reason,
      dledgerDecisionId: dledger?.id ?? null,
      parkReason,
    };
  });
}