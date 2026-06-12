/**
 * R1: Deterministic capability picker (heuristic fallback).
 * Moved from client runtime — single implementation for server degradation + local fallback.
 */
import type { V5CapabilityId } from "./contracts.js";
import { V5_CAPABILITY_POOL } from "./contracts.js";
import type { V5SessionState } from "./v5-reasoning-state.js";
import { findGithubUrlInTexts } from "./whybuddy-github-context.js";
import {
  hasGroundedExternalEvidence,
  recentUngroundedEvidenceAttempts,
} from "./whybuddy-grounding.js";
import {
  needsReadinessChain,
  pickReadinessChainCapabilities,
} from "./whybuddy-readiness-chain.js";
import {
  isDeliveryIntent,
  pickDeliveryCapabilities,
  pickStructureBeforeDelivery,
} from "./whybuddy-delivery-chain.js";
import {
  resolveRoleMode,
  shouldDegradeBrainstorm,
  pickBrainstormChain,
} from "./whybuddy-role-mode.js";
import { isVisualIntent, pickVisualCapabilities } from "./whybuddy-visual-chain.js";

function isHealthyArtifact(
  artifact: { id: string; trustLevel?: string },
  staleSet: Set<string>
): boolean {
  return (
    (artifact.trustLevel === "gated_pass" || artifact.trustLevel === "audited") &&
    !staleSet.has(artifact.id)
  );
}

export function pickNextCapabilities(
  state: V5SessionState,
  userText: string
): Array<{ capabilityId: V5CapabilityId; roleId: string }> {
  const lower = userText.toLowerCase();
  const picks: Array<{ capabilityId: V5CapabilityId; roleId: string }> = [];

  const available = V5_CAPABILITY_POOL;

  // P0 S11: vague goal / open_question → gap.ask → question.expand before anything else.
  if (needsReadinessChain(state, userText)) {
    return pickReadinessChainCapabilities(state).filter((p) => available.has(p.capabilityId));
  }

  // S19: after clear, delivery intent runs ship pipeline.
  if (isDeliveryIntent(userText) && state.goal?.status === "clear") {
    const delivery = pickDeliveryCapabilities(state);
    const structure = pickStructureBeforeDelivery(state, userText);
    return [...structure, ...delivery].slice(0, 5);
  }

  // S18: visual / mermaid intents after doc or tree exists.
  if (isVisualIntent(userText) || /mermaid|结构图渲染/.test(userText)) {
    const vis = pickVisualCapabilities(state, userText);
    if (vis.length > 0) return vis.slice(0, 5);
  }

  // P6: complex role mode primes deliberation before standard picks.
  const roleMode = resolveRoleMode(state, userText);

  const stales = new Set(state.staleArtifactIds || []);
  const existingKinds = new Set(
    (state.artifacts || [])
      .filter((a) => isHealthyArtifact(a, stales))
      .map((a) => a.kind)
  );
  const hasRisk = existingKinds.has("risk");
  const hasSynthesis = existingKinds.has("synthesis");
  const hasReport = existingKinds.has("report");
  const staleCount = (state.staleArtifactIds || []).length;
  const recentRuns = (state.capabilityRuns || []).slice(-6).map((r) => r.capabilityId);
  const openQCount = (state.openQuestions || []).length;
  const recentLedgerCaps = (state.capabilityRuns || []).slice(-4).map((r) => r.capabilityId);
  const ungroundedEvidenceAttempts = recentUngroundedEvidenceAttempts(state, 3);
  const sessionGrounded = hasGroundedExternalEvidence(state);
  const shouldSkipEvidenceSearch =
    !sessionGrounded && ungroundedEvidenceAttempts >= 2;

  const artifactCount = (state.artifacts || []).filter((a) =>
    isHealthyArtifact(a, stales)
  ).length;
  const isColdStart = artifactCount === 0 && (state.capabilityRuns || []).length === 0;

  const ghUrl = findGithubUrlInTexts(lower, state.goal?.text || "");
  if (ghUrl) {
    if (available.has("repo.inspect") && !picks.some((p) => p.capabilityId === "repo.inspect")) {
      picks.push({ capabilityId: "repo.inspect", roleId: "工程" });
    }
    if (
      !shouldSkipEvidenceSearch &&
      available.has("evidence.search") &&
      !picks.some((p) => p.capabilityId === "evidence.search")
    ) {
      picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    }
  }

  if (lower.includes("路线") || lower.includes("route") || lower.includes("对比")) {
    if (available.has("route.generate")) picks.push({ capabilityId: "route.generate", roleId: "架构" });
    if (available.has("route.compare")) picks.push({ capabilityId: "route.compare", roleId: "工程" });
  }
  if (lower.includes("澄清") || lower.includes("clarif") || lower.includes("模糊")) {
    if (available.has("intent.clarify")) picks.push({ capabilityId: "intent.clarify", roleId: "产品" });
  }
  if (lower.includes("风险") || lower.includes("安全") || lower.includes("反驳")) {
    if (available.has("risk.analyze")) picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
    if (available.has("counter.argue")) picks.push({ capabilityId: "counter.argue", roleId: "挑刺" });
  }
  if (lower.includes("树") || lower.includes("拆解") || lower.includes("spec tree")) {
    if (available.has("structure.decompose")) picks.push({ capabilityId: "structure.decompose", roleId: "架构" });
  }
  if (lower.includes("报告") || lower.includes("report") || lower.includes("可行性") || lower.includes("总结")) {
    if (!hasRisk && available.has("risk.analyze")) picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
    if (!hasRisk && available.has("counter.argue")) picks.push({ capabilityId: "counter.argue", roleId: "挑刺" });
    if (!hasSynthesis && available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
    if (!hasReport && available.has("report.write")) picks.push({ capabilityId: "report.write", roleId: "综合" });
  }
  if (lower.includes("预览") || lower.includes("效果") || lower.includes("preview")) {
    if (available.has("scenario.simulate")) picks.push({ capabilityId: "scenario.simulate", roleId: "工程" });
  }

  if (staleCount > 0) {
    if (!picks.some((p) => p.capabilityId.includes("risk") || p.capabilityId.includes("argue"))) {
      if (available.has("risk.analyze")) picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
      if (available.has("counter.argue")) picks.push({ capabilityId: "counter.argue", roleId: "挑刺" });
    }
  }

  if (hasRisk && !hasSynthesis && !hasReport) {
    if (available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
  }

  if (hasSynthesis && !hasReport) {
    if (available.has("report.write")) picks.push({ capabilityId: "report.write", roleId: "综合" });
  }

  if (openQCount > 0) {
    if (available.has("intent.clarify")) picks.push({ capabilityId: "intent.clarify", roleId: "产品" });
    if (available.has("structure.decompose")) picks.push({ capabilityId: "structure.decompose", roleId: "架构" });
  }

  if (staleCount === 0 && !shouldSkipEvidenceSearch) {
    const avoidLedger = new Set(recentLedgerCaps);
    if (picks.length < 3 && !avoidLedger.has("evidence.search") && available.has("evidence.search")) {
      picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    }
  }

  if (isColdStart && picks.length < 3) {
    if (available.has("intent.clarify") && !picks.some((p) => p.capabilityId === "intent.clarify")) {
      picks.push({ capabilityId: "intent.clarify", roleId: "产品" });
    }
    if (available.has("route.generate") && !picks.some((p) => p.capabilityId === "route.generate")) {
      picks.push({ capabilityId: "route.generate", roleId: "架构" });
    }
    if (available.has("risk.analyze") && !picks.some((p) => p.capabilityId === "risk.analyze")) {
      picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
    }
    if (
      !shouldSkipEvidenceSearch &&
      available.has("evidence.search") &&
      !picks.some((p) => p.capabilityId === "evidence.search")
    ) {
      picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    }
  }

  if (picks.length === 0) {
    const avoidRecent = new Set([...recentRuns, ...recentLedgerCaps]);
    if (!avoidRecent.has("intent.parse") && available.has("intent.parse")) {
      picks.push({ capabilityId: "intent.parse", roleId: "产品" });
    }
    if (
      !shouldSkipEvidenceSearch &&
      !avoidRecent.has("evidence.search") &&
      available.has("evidence.search")
    ) {
      picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    }
    if (available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
  }

  if (picks.length === 0) {
    if (available.has("intent.parse")) picks.push({ capabilityId: "intent.parse", roleId: "产品" });
    if (!shouldSkipEvidenceSearch && available.has("evidence.search")) {
      picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    }
    if (available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
  }

  if (roleMode === "complex" && !shouldDegradeBrainstorm(state, userText) && picks.length < 4) {
    for (const primer of pickBrainstormChain(state)) {
      if (available.has(primer.capabilityId) && !picks.some((p) => p.capabilityId === primer.capabilityId)) {
        picks.unshift(primer);
      }
    }
  }

  const seen = new Set<string>();
  return picks
    .filter((p) => {
      const key = `${p.capabilityId}:${p.roleId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}