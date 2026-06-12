/**
 * V5.1 GCOV — coverage contract authoring + mechanical gate evaluation.
 * Shared so runtime ORCH and server PUT N1 guard use the same rules.
 */

import {
  countGroundedTrustedArtifacts,
  hasGroundedExternalEvidence,
} from "./whybuddy-grounding.js";
import type {
  CoverageContract,
  CoverageGap,
  CoverageGateResult,
  V5SessionState,
} from "./v5-reasoning-state.js";

function isHealthyArtifact(
  artifact: { id: string; trustLevel?: string },
  staleSet: Set<string>
): boolean {
  return (
    (artifact.trustLevel === "gated_pass" || artifact.trustLevel === "audited") &&
    !staleSet.has(artifact.id)
  );
}

export function hasTrustedCommittedForCap(state: V5SessionState, capId: string): boolean {
  const runs = state.capabilityRuns || [];
  const arts = state.artifacts || [];
  const stales = new Set(state.staleArtifactIds || []);
  for (const run of runs) {
    if (run.capabilityId !== capId) continue;
    const art = arts.find((a) => a.producedBy?.capabilityRunId === run.id);
    if (art && isHealthyArtifact(art, stales)) {
      return true;
    }
  }
  return false;
}

export function authorCoverageContract(
  goalText: string,
  turnId?: string
): { contract: CoverageContract; gaps: CoverageGap[] } {
  const t = (goalText || "").toLowerCase();
  const isComplex = /风险|risk|安全|审计|反驳|复杂|complex|rebuttal/.test(t);
  const mode: "simple" | "complex" = isComplex ? "complex" : "simple";
  const requiredCapabilities = isComplex
    ? ["risk.analyze", "evidence.search", "report.write"]
    : ["evidence.search", "report.write"];
  const conditionalCapabilities = isComplex ? ["synthesis.merge"] : [];

  const now = new Date().toISOString();
  const contract: CoverageContract = {
    id: `cov-${turnId || Date.now()}`,
    version: 1,
    mode,
    authoredBy: "system",
    authoredAt: now,
    frozenAtTurnId: turnId,
    requiredCapabilities,
    conditionalCapabilities,
    minEvidencePerRequirement: 1,
    blockingGapIds: [],
  };

  const gaps: CoverageGap[] = [];
  for (const cap of requiredCapabilities) {
    if (cap === "report.write") continue;
    const gap: CoverageGap = {
      id: `gap-${cap}-${turnId || Date.now()}`,
      kind: "missing_capability",
      label: `Missing required capability: ${cap}`,
      requiredCapabilityId: cap,
      status: "open",
      createdAt: now,
    };
    gaps.push(gap);
    contract.blockingGapIds.push(gap.id);
  }

  const evGap: CoverageGap = {
    id: `gap-evidence-${turnId || Date.now()}`,
    kind: "missing_evidence",
    label: "Missing grounded external evidence (G-GROUND)",
    status: "open",
    createdAt: now,
  };
  gaps.push(evGap);
  contract.blockingGapIds.push(evGap.id);

  return { contract, gaps };
}

export function evaluateCoverageGate(
  state: V5SessionState,
  selected: Array<{ capabilityId: string; roleId?: string }> = [],
  existingContract?: CoverageContract
): CoverageGateResult {
  const contract =
    existingContract ||
    authorCoverageContract(state.goal?.text || "", state.lastTurnId).contract;
  const gaps = (state.coverageGaps || []) as CoverageGap[];

  const blockingGaps = gaps.filter((g) => contract.blockingGapIds.includes(g.id));
  const openBlocking = blockingGaps.filter((g) => g.status === "open");
  const unresolvedGaps = openBlocking.map((g) => g.id);
  const waivedGaps = blockingGaps.filter((g) => g.status === "waived").map((g) => g.id);

  const missing: string[] = [];
  const preReqs = contract.requiredCapabilities.filter((c) => c !== "report.write");
  for (const req of preReqs) {
    if (!hasTrustedCommittedForCap(state, req)) {
      missing.push(req);
    }
  }

  const hasReportIntent = selected.some((s) => s.capabilityId === "report.write");
  const groundedCount = countGroundedTrustedArtifacts(state);
  const minGrounded = contract.minEvidencePerRequirement || 1;
  let upstreamOk = true;
  if (hasReportIntent && groundedCount < minGrounded) {
    upstreamOk = false;
  }

  const groundingOk = hasGroundedExternalEvidence(state);
  const allBlockingHandled = openBlocking.length === 0;
  const passed = allBlockingHandled && missing.length === 0 && upstreamOk && groundingOk;

  const reason = passed
    ? `Coverage sufficient (mode=${contract.mode}, grounded_evidence=${groundedCount}, G-GROUND ok)`
    : `Blocking gaps open: ${unresolvedGaps.length}; missing caps: ${missing.join(", ") || "none"}; upstreams ok: ${upstreamOk}; G-GROUND: ${groundingOk} (grounded=${groundedCount}/${minGrounded})`;

  return {
    passed,
    missingCapabilities: missing,
    unresolvedGaps,
    waivedGaps,
    reason,
  };
}

/** Empty ledger for PUT GCOV — never trust client-submitted runs/artifacts on cold save. */
function emptyGcovLedgerShell(incoming: V5SessionState): V5SessionState {
  return {
    sessionId: incoming.sessionId,
    goal: { text: incoming.goal?.text || "", status: "needs_refinement" },
    graph: incoming.graph ?? { nodes: [], edges: [] },
    artifacts: [],
    capabilityRuns: [],
    coverageGaps: [],
    coverageContract: undefined,
    coverageGate: undefined,
    conversation: [],
    openQuestions: [],
    evidence: [],
    decisions: [],
    risks: [],
    gates: [],
    dependencyGraph: [],
    staleArtifactIds: [],
  } as V5SessionState;
}

/**
 * N1 PUT boundary: GCOV must read the server-persisted ledger only.
 * Client PUT bodies may forge trustLevel / capabilityRuns / grounded evidence.
 */
export function buildGcovAuthoritativeStateForPut(
  incoming: V5SessionState,
  previous: V5SessionState | undefined
): V5SessionState {
  if (!previous) return emptyGcovLedgerShell(incoming);
  return previous;
}

/** Recompute GCOV from persisted ledger; reject unauthorized goal.status=clear. */
export function sanitizeGoalStatusOnPut(
  incoming: V5SessionState,
  previous: V5SessionState | undefined
): V5SessionState {
  const gcovBase = buildGcovAuthoritativeStateForPut(incoming, previous);
  const recomputed = evaluateCoverageGate(
    gcovBase,
    [],
    gcovBase.coverageContract ?? previous?.coverageContract
  );
  let state: V5SessionState = { ...incoming, coverageGate: recomputed };

  const nextStatus = state.goal?.status;
  if (nextStatus !== "clear") return state;
  if (recomputed.passed === true) return state;

  const reverted = previous?.goal?.status ?? "needs_refinement";
  return {
    ...state,
    goal: { ...state.goal!, status: reverted },
    conversation: [
      ...(state.conversation || []),
      {
        id: `n1-gcov-guard-${Date.now()}`,
        role: "system",
        text: `[N1] rejected goal.status=clear — server GCOV.passed=false (PUT trusts persisted ledger only) — reverted to ${reverted}`,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}