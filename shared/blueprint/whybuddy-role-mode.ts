/**
 * P6 · ROLES layer routing (D_GATE simple vs complex vs degraded).
 */

import type { V5CapabilityId } from "./contracts.js";
import type { V5SessionState } from "./v5-reasoning-state.js";

export type RoleMode = "simple" | "complex" | "degraded";

/** Capabilities routed through deliberation / brainstorm mini-sessions (S16). */
export const DELIBERATION_CAPABILITY_IDS = [
  "counter.argue",
  "critique.generate",
  "rebuttal.resolve",
  "synthesis.merge",
] as const satisfies readonly V5CapabilityId[];

export function isDeliberationCapability(capabilityId: string): boolean {
  return (DELIBERATION_CAPABILITY_IDS as readonly string[]).includes(capabilityId);
}

export function resolveRoleMode(state: V5SessionState, userText: string): RoleMode {
  if (state.roleMode === "degraded" || state.brainstormDegraded) return "degraded";
  if (
    typeof process !== "undefined" &&
    (process as { env?: Record<string, string> }).env?.WHYBUDDY_BRAINSTORM_DEGRADE === "1"
  ) {
    return "degraded";
  }

  const t = `${state.goal?.text || ""} ${userText}`.toLowerCase();
  if (
    /辩论|brainstorm|多角色|复杂|合规|审计|跨部门|平台化|多模块/.test(t) ||
    (state.coverageContract?.mode === "complex" && (state.artifacts || []).length >= 4)
  ) {
    return "complex";
  }
  return "simple";
}

export function shouldDegradeBrainstorm(state: V5SessionState, userText: string): boolean {
  return resolveRoleMode(state, userText) === "degraded";
}

/** S16 · D_BO primer chain before standard BUS picks. */
export function pickBrainstormChain(
  state: V5SessionState
): Array<{ capabilityId: V5CapabilityId; roleId: string }> {
  const recent = new Set(
    (state.capabilityRuns || []).slice(-12).map((r) => r.capabilityId as V5CapabilityId)
  );
  const picks: Array<{ capabilityId: V5CapabilityId; roleId: string }> = [];

  if (!recent.has("critique.generate")) {
    picks.push({ capabilityId: "critique.generate", roleId: "挑刺" });
  }
  if (!recent.has("counter.argue") && recent.has("critique.generate")) {
    picks.push({ capabilityId: "counter.argue", roleId: "挑刺" });
  }
  if (
    !recent.has("synthesis.merge") &&
    (recent.has("counter.argue") || recent.has("critique.generate"))
  ) {
    picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
  }
  return picks;
}

/** @deprecated use pickBrainstormChain */
export function pickBrainstormPrimers(): Array<{
  capabilityId: "critique.generate";
  roleId: string;
}> {
  return [{ capabilityId: "critique.generate", roleId: "挑刺" }];
}

export function applyRoleModeToState(
  state: V5SessionState,
  userText: string
): V5SessionState {
  const mode = resolveRoleMode(state, userText);
  return { ...state, roleMode: mode };
}

export function markBrainstormDegraded(state: V5SessionState, reason: string): V5SessionState {
  return {
    ...state,
    roleMode: "degraded",
    brainstormDegraded: true,
    conversation: [
      ...(state.conversation || []),
      {
        id: `d-deg-${Date.now()}`,
        role: "system",
        text: `[D_DEG] brainstorm degraded → single agent: ${reason}`,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}