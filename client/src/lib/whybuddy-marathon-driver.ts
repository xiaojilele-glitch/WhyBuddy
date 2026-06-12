/**
 * M2: MarathonDriver — thin orchestration layer on top of driveReasoningSession.
 * Inner spine (gates, ledger, single-writer, GCOV) zero change.
 * "自主决定 WHAT，机械裁决 WHETHER" — replay at drive layer.
 *
 * Per spec: reuses driveReasoningSession in loop; handles stopReasons for auto-seed (stub frontier for now).
 * stopSignal (M1) propagated.
 * Mode: "single" (current default, bypass) vs "marathon" (autopilot).
 */

import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { ReentryStopReason } from "./whybuddy-runtime";
import * as WhyBuddyRuntime from "./whybuddy-runtime";

export type MarathonStopReason =
  | "user_interrupted" // M1
  | "session_budget_exhausted" // M5
  | "frontier_exhausted" // M3
  | "await_human"; // M4 true gap, resumable

export interface MarathonOptions {
  stopSignal: AbortSignal;
  budget: { maxTokens?: number; declaredAt: string };
  policy: { autoConfirmRoute?: string; autoWaiveNonBlockingGaps?: boolean };
  onRoundComplete?: (digest: any, round: any) => void;
}

export interface MarathonResult {
  finalState: V5SessionState;
  rounds: Array<{
    loopTurnId: string;
    stopReason: ReentryStopReason | MarathonStopReason;
    seed?: string; // auto-seeded for next
  }>;
  stopReason: MarathonStopReason;
}

export async function driveMarathon(
  state: V5SessionState,
  seedText: string,
  opts: MarathonOptions
): Promise<MarathonResult> {
  const rounds: MarathonResult["rounds"] = [];
  let working = state;
  let currentSeed = seedText;
  let stopReason: MarathonStopReason = "await_human";

  // Thin loop: call inner drive, decide WHAT next based on stopReason.
  // No change to driveReasoningSession internals.
  while (true) {
    if (opts.stopSignal.aborted) {
      stopReason = "user_interrupted";
      break;
    }

    // Call inner (M1 signal passed through options if supported; here assume for skeleton)
    const driveRes = await WhyBuddyRuntime.driveReasoningSession(working, {
      turnSeedId: `marathon-${Date.now()}`,
      userText: currentSeed,
      // propagate abort if drive supports; for M1+ it does via abortSignal
      // @ts-ignore - additive
      abortSignal: opts.stopSignal,
    });

    const lastStop = driveRes.stopReason;
    rounds.push({
      loopTurnId: driveRes.loops[driveRes.loops.length - 1]?.loopTurnId || "",
      stopReason: lastStop,
    });

    working = driveRes.finalState;

    if (opts.onRoundComplete) {
      opts.onRoundComplete({ summary: "round digest stub" }, rounds[rounds.length - 1]);
    }

    // Per spec: on convergence/coverage -> distill (M6 stub) -> frontier.propose (M3 stub) -> new seed
    if (lastStop === "convergence_signal" || lastStop === "coverage_sufficient") {
      // M6 stub: digest would be created here (over quality gate)
      const digest = { title: "轮次纪要 stub", content: "converged summary for next seed" };

      // M3 stub: frontier.propose -> seed or exhausted
      // (real: call frontier.propose with goal + all digests + prior frontiers)
      const frontier = { exhausted: false, seedText: `auto-seed from ${digest.title}: next frontier` };

      if (frontier.exhausted) {
        stopReason = "frontier_exhausted";
        break;
      }
      currentSeed = frontier.seedText; // auto-seeded, marked in conversation per spec
      // continue loop
    } else if (lastStop === "await_ready") {
      stopReason = "await_human"; // M4: true human stop, resume later
      break;
    } else if (lastStop === "user_interrupted") {
      stopReason = "user_interrupted";
      break;
    } else if (lastStop === "budget_exhausted") {
      // inner budget != session; continue or check outer M5
      // for skeleton, treat as continue unless M5
      currentSeed = "继续基于前轮 (budget inner)";
    } else {
      // other stops (no_progress etc) -> may await or continue stub
      break;
    }

    // M5 budget check stub (real: costLedger cumulative)
    if (rounds.length > 5) { // placeholder for session budget
      stopReason = "session_budget_exhausted";
      break;
    }
  }

  return { finalState: working, rounds, stopReason };
}

// Mode type re-exported from runtime for consistency
import type { WhyBuddyDriveMode } from "./whybuddy-runtime";
export type { WhyBuddyDriveMode };
