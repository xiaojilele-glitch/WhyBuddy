/**
 * G-GROUND: mechanical grounding checks for WhyBuddy trust layer.
 * External evidence = F1 GitHub fetch or other sanctioned external provenance — not in-session synthesis.
 */

import type { V5SessionState } from "./v5-reasoning-state.js";

export const EVIDENCE_SOURCE_F1_GITHUB = "F1_Github_Source 取数" as const;
export const EVIDENCE_SOURCE_WEB_SEARCH = "F2_Web_Search 取数" as const;
export const EVIDENCE_SOURCE_IN_SESSION = "会话内综合" as const;

export type GroundingCheckArtifact = {
  id?: string;
  kind?: string;
  provenance?: string;
  summary?: string;
  content?: string;
  trustLevel?: string;
  payload?: unknown;
  producedBy?: { capabilityId?: string };
};

/** Provenance values that count as externally grounded (sanctioned seams only). */
export function isExternalGroundingProvenance(provenance?: string): boolean {
  return (
    provenance === "mcp:github" ||
    provenance === "web:search" ||
    provenance === "repo:static" ||
    provenance === "rendered_chart_mcp" ||
    provenance === "rendered_screenshot"
  );
}

export function isGroundedEvidenceArtifact(art: GroundingCheckArtifact): boolean {
  const cap = art.producedBy?.capabilityId;
  const isEvidence =
    cap === "evidence.search" || art.kind === "evidence";
  if (!isEvidence) return false;

  if (isExternalGroundingProvenance(art.provenance)) return true;

  const payload = art.payload as { evidenceSource?: string } | undefined;
  if (payload?.evidenceSource === EVIDENCE_SOURCE_F1_GITHUB) return true;
  if (payload?.evidenceSource === EVIDENCE_SOURCE_WEB_SEARCH) return true;

  const text = `${art.summary || ""} ${art.content || ""}`;
  if (text.includes(EVIDENCE_SOURCE_F1_GITHUB)) return true;
  if (text.includes(EVIDENCE_SOURCE_WEB_SEARCH)) return true;

  return false;
}

export function hasGroundedExternalEvidence(state: V5SessionState): boolean {
  const stales = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).some((a) => {
    if (stales.has(a.id)) return false;
    if (a.trustLevel !== "gated_pass" && a.trustLevel !== "audited") return false;
    return isGroundedEvidenceArtifact(a);
  });
}

/** Per-commit G-GROUND predicate (binary). */
export function evaluateGroundingForCommit(args: {
  capabilityId: string;
  artifact: GroundingCheckArtifact;
  state: V5SessionState;
}): boolean {
  const { capabilityId, artifact, state } = args;
  if (capabilityId === "evidence.search") {
    return isGroundedEvidenceArtifact({
      ...artifact,
      producedBy: { capabilityId },
    });
  }
  if (capabilityId === "report.write") {
    return hasGroundedExternalEvidence(state);
  }
  return true;
}

export function countGroundedTrustedArtifacts(state: V5SessionState): number {
  const stales = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).filter(
    (a) =>
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") &&
      !stales.has(a.id) &&
      isGroundedEvidenceArtifact(a)
  ).length;
}

/** Recent evidence.search runs that committed without external grounding. */
export function recentUngroundedEvidenceAttempts(state: V5SessionState, lookback = 4): number {
  const runs = (state.capabilityRuns || []).slice(-lookback);
  let count = 0;
  for (const run of runs) {
    if (run.capabilityId !== "evidence.search") continue;
    const art = (state.artifacts || []).find(
      (a) => a.producedBy?.capabilityRunId === run.id
    );
    if (!art) continue;
    if (!isGroundedEvidenceArtifact(art)) count++;
  }
  return count;
}