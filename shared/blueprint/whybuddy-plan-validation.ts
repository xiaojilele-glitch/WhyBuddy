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

/** Extract capability id from common LLM field aliases (`capability`, `cap`, `id`). */
function extractCapabilityRaw(item: ProposedPlanItem): string {
  const rec = item as Record<string, unknown>;
  return (
    asString(item.capabilityId) ||
    asString(rec.capability) ||
    asString(rec.cap) ||
    asString(rec.id)
  );
}

/** Extract role from common LLM field aliases (`role`, `agent`). */
function extractRoleRaw(item: ProposedPlanItem): string {
  const rec = item as Record<string, unknown>;
  return asString(item.roleId) || asString(rec.role) || asString(rec.agent);
}

/**
 * Resolve a raw capability token to a pool id (F0.1: tolerate `_` vs `.` and casing).
 * Returns null when no pool member matches.
 */
export function resolveCapabilityId(raw: string): V5CapabilityId | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (V5_CAPABILITY_POOL.has(trimmed as V5CapabilityId)) {
    return trimmed as V5CapabilityId;
  }
  const dotted = trimmed.replace(/_/g, ".").replace(/\s+/g, ".");
  if (V5_CAPABILITY_POOL.has(dotted as V5CapabilityId)) {
    return dotted as V5CapabilityId;
  }
  const lower = dotted.toLowerCase();
  for (const id of V5_CAPABILITY_POOL.keys()) {
    if (id.toLowerCase() === lower) return id;
  }
  return null;
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
    const capRaw = extractCapabilityRaw(item);
    const capId = capRaw ? resolveCapabilityId(capRaw) : null;

    if (!capId) {
      if (capRaw) dropped.push({ capabilityId: capRaw, reason: "invalid_capability" });
      continue;
    }

    if (seenCaps.has(capId)) {
      dropped.push({ capabilityId: capId, reason: "duplicate_in_proposal" });
      continue;
    }
    seenCaps.add(capId);

    let roleId = extractRoleRaw(item);
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