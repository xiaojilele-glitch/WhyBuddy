import type { V5CapabilityId } from "./contracts.js";
import { V5_CAPABILITY_POOL } from "./contracts.js";
import type { V5SessionState } from "./v5-reasoning-state.js";
import { CAPABILITY_DEFAULT_ROLES } from "./whybuddy-capability-catalog.js";
import { V5_ROLE_IDS } from "./whybuddy-role-map.js";

export type DropReason =
  | "invalid_capability"
  | "duplicate_in_proposal"
  | "clamped_over_max"
  | "invalid_role_defaulted";

export type ProposedPlanItem = {
  capabilityId?: unknown;
  roleId?: unknown;
  why?: unknown;
};

export type ProposedPlanInput = {
  selected?: unknown;
  rationale?: unknown;
};

export type ValidatedPlanItem = {
  capabilityId: V5CapabilityId;
  roleId: string;
  why?: string;
};

export type ValidateProposedPlanResult = {
  valid: boolean;
  selected: ValidatedPlanItem[];
  dropped: Array<{ capabilityId: string; reason: DropReason }>;
};

const MIN_ITEMS = 1;
const MAX_ITEMS = 4;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeItems(raw: unknown): ProposedPlanItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x != null && typeof x === "object") as ProposedPlanItem[];
}

/**
 * Mechanical validator for LLM orchestration proposals. Never throws.
 */
export function validateProposedPlan(
  proposal: ProposedPlanInput | null | undefined,
  _state?: V5SessionState
): ValidateProposedPlanResult {
  const dropped: Array<{ capabilityId: string; reason: DropReason }> = [];
  const items = normalizeItems(proposal?.selected);
  const accepted: ValidatedPlanItem[] = [];
  const seenCaps = new Set<string>();

  for (const item of items) {
    const capRaw = asString(item.capabilityId);
    const capId = capRaw as V5CapabilityId;

    if (!capRaw || !V5_CAPABILITY_POOL.has(capId)) {
      if (capRaw) dropped.push({ capabilityId: capRaw, reason: "invalid_capability" });
      continue;
    }

    if (seenCaps.has(capId)) {
      dropped.push({ capabilityId: capId, reason: "duplicate_in_proposal" });
      continue;
    }
    seenCaps.add(capId);

    let roleId = asString(item.roleId);
    if (!roleId || !(V5_ROLE_IDS as readonly string[]).includes(roleId)) {
      roleId = CAPABILITY_DEFAULT_ROLES[capId];
      dropped.push({ capabilityId: capId, reason: "invalid_role_defaulted" });
    }

    const why = asString(item.why) || undefined;
    accepted.push({ capabilityId: capId, roleId, ...(why ? { why } : {}) });
  }

  let selected = accepted;
  if (selected.length > MAX_ITEMS) {
    const overflow = selected.slice(MAX_ITEMS);
    for (const o of overflow) {
      dropped.push({ capabilityId: o.capabilityId, reason: "clamped_over_max" });
    }
    selected = selected.slice(0, MAX_ITEMS);
  }

  const valid = selected.length >= MIN_ITEMS;
  if (!valid) {
    return { valid: false, selected: [], dropped };
  }

  return { valid: true, selected, dropped };
}