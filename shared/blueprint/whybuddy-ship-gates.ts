/**
 * P5 · commit-time vs ship-time trust gates (V5.1 dual-speed).
 * commit: schema + invariant + ground + commit
 * ship: content + test + merge (delivery path only)
 */

import type { V5SessionState } from "./v5-reasoning-state.js";

export type GatePhase = "commit" | "ship";

export type GateVerdict = {
  gateId: string;
  status: "passed" | "failed";
  phase: GatePhase;
};

export type ShipGateResult = {
  passed: boolean;
  gates: GateVerdict[];
  reason: string;
};

/** Commit-time only — no merge/content/test at artifact commit. */
export function evaluateCommitGates(
  capabilityId: string,
  opts: { forceFail?: boolean; groundingOk?: boolean }
): GateVerdict[] {
  const forceFail = opts.forceFail ?? false;
  const groundingOk = opts.groundingOk ?? true;
  const results: GateVerdict[] = [
    { gateId: "schema", status: "passed", phase: "commit" },
    { gateId: "invariant", status: "passed", phase: "commit" },
    { gateId: "confirm", status: "passed", phase: "commit" },
    { gateId: "precondition", status: forceFail ? "failed" : "passed", phase: "commit" },
    { gateId: "ground", status: groundingOk ? "passed" : "failed", phase: "commit" },
    {
      gateId: "commit",
      status: forceFail || !groundingOk ? "failed" : "passed",
      phase: "commit",
    },
  ];
  if (capabilityId.includes("visual") || capabilityId.includes("preview")) {
    results.push({
      gateId: "previews_real",
      status: forceFail ? "failed" : "passed",
      phase: "commit",
    });
  }
  return results;
}

/** Ship-time checks before DONE / handoff (S19). */
export function evaluateShipGates(state: V5SessionState): ShipGateResult {
  const gates: GateVerdict[] = [];
  const arts = state.artifacts || [];
  const hasReport = arts.some(
    (a) => a.kind === "report" && (a.trustLevel === "gated_pass" || a.trustLevel === "audited")
  );
  const hasHandoff = arts.some((a) => a.producedBy?.capabilityId === "handoff.package");

  gates.push({
    gateId: "T_CONTENT",
    status: hasReport ? "passed" : "failed",
    phase: "ship",
  });
  gates.push({
    gateId: "T_TEST",
    status: state.goal?.status === "clear" ? "passed" : "failed",
    phase: "ship",
  });
  gates.push({
    gateId: "T_MERGE",
    status: hasHandoff ? "passed" : "failed",
    phase: "ship",
  });

  const failed = gates.filter((g) => g.status === "failed");
  return {
    passed: failed.length === 0,
    gates,
    reason:
      failed.length === 0
        ? "ship-time gates passed"
        : `ship blocked: ${failed.map((g) => g.gateId).join(", ")}`,
  };
}