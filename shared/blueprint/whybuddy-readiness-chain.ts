/**
 * P0 · C_GAP → C_QEXP → G_READY readiness chain (V5.1).
 * Scheduling + gap lifecycle — zero LLM.
 */

import type { V5CapabilityId } from "./contracts.js";
import type { CoverageGap, V5SessionState } from "./v5-reasoning-state.js";
import { isVagueGoal, userClearsReadiness } from "./whybuddy-interactive-gates.js";

export function openReadinessBlockingGaps(state: V5SessionState): CoverageGap[] {
  const contract = state.coverageContract;
  const blocking = new Set(contract?.blockingGapIds || []);
  return (state.coverageGaps || []).filter(
    (g) =>
      g.status === "open" &&
      (g.kind === "open_question" || g.kind === "missing_capability") &&
      (blocking.size === 0 || blocking.has(g.id))
  );
}

export function hasTrustedGapAskArtifact(state: V5SessionState): boolean {
  const stales = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).some(
    (a) =>
      a.producedBy?.capabilityId === "gap.ask" &&
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") &&
      !stales.has(a.id)
  );
}

/** True when ORCH should run gap.ask → question.expand before risk/report. */
export function needsReadinessChain(state: V5SessionState, userText: string): boolean {
  if (userClearsReadiness(userText, state)) return false;
  // Converge / delivery / report intents must not be preempted by S11 prepending.
  if (/报告|可行性|总结|收敛|report|落地|交付|路线|对比|预览|风险|安全/.test(userText)) return false;
  if (state.goal?.status === "clear" || state.deliveryPhase === "shipping") return false;

  const openQ = openReadinessBlockingGaps(state).filter((g) => g.kind === "open_question");
  if (openQ.length > 0) return true;

  const goalText = state.goal?.text || "";
  // S11 applies only to genuinely vague goals before gap.ask has run once.
  if (isVagueGoal(goalText) && !hasTrustedGapAskArtifact(state)) return true;

  return false;
}

/** Picker prepend for S11: gap.ask then question.expand. */
export function pickReadinessChainCapabilities(
  state: V5SessionState
): Array<{ capabilityId: V5CapabilityId; roleId: string }> {
  const recent = new Set(
    (state.capabilityRuns || []).slice(-8).map((r) => r.capabilityId as V5CapabilityId)
  );
  const picks: Array<{ capabilityId: V5CapabilityId; roleId: string }> = [];
  if (!recent.has("gap.ask")) {
    picks.push({ capabilityId: "gap.ask", roleId: "规划" });
  }
  if (!recent.has("question.expand")) {
    picks.push({ capabilityId: "question.expand", roleId: "规划" });
  }
  return picks;
}

/** Extract blocking questions from gap.ask artifact body. */
export function extractBlockingQuestions(content: string): string[] {
  const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    if (/^[-*•]\s+/.test(line) && (line.includes("?") || line.includes("？"))) {
      out.push(line.replace(/^[-*•]\s+/, "").slice(0, 200));
    } else if (/^\d+[.)]\s+/.test(line) && (line.includes("?") || line.includes("？"))) {
      out.push(line.replace(/^\d+[.)]\s+/, "").slice(0, 200));
    } else if (/^【.+问题/.test(line) || /^问题\s*\d/.test(line)) {
      out.push(line.slice(0, 200));
    }
  }
  if (out.length === 0 && content.trim()) {
    out.push(content.trim().slice(0, 200));
  }
  return out.slice(0, 5);
}

/** After gap.ask commit: materialize open_question gaps + blockingGapIds. */
export function gapsFromGapAskContent(
  content: string,
  turnId: string,
  artifactId: string
): CoverageGap[] {
  const now = new Date().toISOString();
  const questions = extractBlockingQuestions(content);
  return questions.map((label, i) => ({
    id: `gap-q-${turnId}-${i}`,
    kind: "open_question" as const,
    label,
    status: "open" as const,
    reason: `gap.ask artifact ${artifactId}`,
    createdAt: now,
  }));
}

export function mergeGapAskIntoState(
  state: V5SessionState,
  gaps: CoverageGap[]
): V5SessionState {
  if (gaps.length === 0) return state;
  const existing = state.coverageGaps || [];
  const contract = state.coverageContract;
  const newIds = gaps.map((g) => g.id);
  const mergedGaps = [...existing];
  for (const g of gaps) {
    if (!mergedGaps.some((x) => x.id === g.id)) mergedGaps.push(g);
  }
  const blocking = new Set(contract?.blockingGapIds || []);
  for (const id of newIds) blocking.add(id);
  return {
    ...state,
    coverageGaps: mergedGaps,
    coverageContract: contract
      ? { ...contract, blockingGapIds: [...blocking] }
      : contract,
  };
}

/** INTAKE: user supplement resolves open_question blocking gaps. */
export function resolveReadinessGapsFromUserText(
  state: V5SessionState,
  userText: string
): V5SessionState {
  if (!userClearsReadiness(userText, state)) return state;
  const now = new Date().toISOString();
  let changed = false;
  const gaps = (state.coverageGaps || []).map((g) => {
    if (g.status !== "open" || g.kind !== "open_question") return g;
    changed = true;
    return { ...g, status: "resolved" as const, updatedAt: now };
  });
  return changed ? { ...state, coverageGaps: gaps } : state;
}