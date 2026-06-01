/**
 * whybuddy-3d-real-role-driven-scene-2026-05-29 — capability→role binding
 *
 * Pure, Three.js-free helpers that bind live capability invocations
 * (`BlueprintRealtimeStore.capabilityStatuses`, keyed by `capabilityId`) to the
 * 3D roles currently on stage. The capability bridge panel answers "which
 * capabilities ran"; this module answers "WHO ran them" so the scene can show a
 * lightweight capability chip strip under each role.
 *
 * Binding precedence (Requirement 12):
 *   1. Real event owner — the authoritative `roleId` the backend attached to the
 *      `capability.*` event, captured in `capabilityOwners[capabilityId]`. When
 *      that role is on stage, bind directly (`event-role`, NOT inferred).
 *   2. `role-container-loader:<roleId>` — parse the owner role from the id
 *      suffix (`loader-id`). If that role is NOT on stage, the capability stays
 *      unowned (it already names an authoritative role; we never re-attribute
 *      it to someone else).
 *   3. Capability-type heuristic — map a well-known capability id to the most
 *      likely owner role by matching candidate role-id tokens against the roles
 *      actually on stage (`capability-heuristic`, inferred).
 *   4. Single active role fallback — if exactly one role is in an active phase,
 *      attach still-unowned capabilities to it, flagged `inferred`
 *      (`active-role`).
 *   5. Otherwise the capability is `unowned`: it is NOT attached to any role and
 *      stays in the right-rail audit panel only.
 *
 * Everything here is deterministic and pure: the same inputs always produce the
 * same `Map`, so the binding can be unit-tested without a WebGL / DOM context.
 */

import type { AppLocale } from "@/lib/locale";
import type {
  CapabilityOwner,
  CapabilityStatus,
  RolePhase,
} from "@/lib/blueprint-realtime-store";

type AutopilotStage = string;

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

/** How a capability was bound to its owner role (descending confidence). */
export type CapabilityOwnerSource =
  | "event-role"
  | "loader-id"
  | "capability-heuristic"
  | "active-role"
  | "unowned";

/** Chip-level status, collapsed from the store's `CapabilityStatus`. */
export type CapabilityChipStatus = "running" | "completed" | "failed" | "idle";

/**
 * One capability chip attached to a role. `iconKey` is a STRING (not a React
 * component) so this module stays render-framework-free; the renderer maps it
 * to a lucide icon.
 */
export interface RoleCapabilityChip {
  capabilityId: string;
  ownerRoleId: string;
  ownerSource: CapabilityOwnerSource;
  displayName: string;
  iconKey: CapabilityIconKey;
  status: CapabilityChipStatus;
  /** True when the owner was inferred (heuristic / active-role), not authoritative. */
  inferred: boolean;
}

export type CapabilityIconKey =
  | "container"
  | "spec-node"
  | "sandbox"
  | "github"
  | "role-system"
  | "svg"
  | "mcp"
  | "skill"
  | "capability";

// ---------------------------------------------------------------------------
// Capability display metadata
// ---------------------------------------------------------------------------

interface CapabilityMeta {
  iconKey: CapabilityIconKey;
  label: Record<AppLocale, string>;
  /**
   * Ordered candidate role-id tokens for the heuristic binding. The first role
   * on stage whose lowercased id `includes` one of these tokens wins. Empty for
   * `role-container-loader:*` (handled by id parsing instead).
   */
  heuristicTokens: string[];
}

/**
 * Registry of well-known capability ids → display metadata. Lookup normalizes
 * the id to lowercase and strips any `role-container-loader:` prefix first, so a
 * single entry covers both `aigc-spec-node` and any future suffix variants.
 */
const CAPABILITY_META: Array<{ match: (id: string) => boolean; meta: CapabilityMeta }> = [
  {
    match: (id) => id.startsWith("role-container-loader:"),
    meta: {
      iconKey: "container",
      label: { "zh-CN": "角色容器", "en-US": "Role Container" },
      heuristicTokens: [],
    },
  },
  {
    match: (id) => id.includes("aigc-spec-node") || id.includes("spec-node"),
    meta: {
      iconKey: "spec-node",
      label: { "zh-CN": "规格节点", "en-US": "Spec Node" },
      heuristicTokens: ["spec-architect", "architect", "spec"],
    },
  },
  {
    match: (id) => id.includes("docker") || id.includes("sandbox"),
    meta: {
      iconKey: "sandbox",
      label: { "zh-CN": "沙箱分析", "en-US": "Sandbox" },
      heuristicTokens: ["repository-analyst", "analyst", "repository", "analyz"],
    },
  },
  {
    match: (id) => id.includes("github") || id.includes("mcp-github"),
    meta: {
      iconKey: "github",
      label: { "zh-CN": "GitHub 源", "en-US": "GitHub Source" },
      heuristicTokens: ["repository-analyst", "analyst", "repository"],
    },
  },
  {
    match: (id) => id.includes("role-system-architecture") || id.includes("system-architecture"),
    meta: {
      iconKey: "role-system",
      label: { "zh-CN": "角色体系", "en-US": "Role System" },
      heuristicTokens: ["architecture-planner", "role-architect", "architect", "spec-architect"],
    },
  },
  {
    match: (id) => id.includes("svg"),
    meta: {
      iconKey: "svg",
      label: { "zh-CN": "SVG 架构", "en-US": "SVG Architecture" },
      heuristicTokens: ["experience-presenter", "presenter", "experience"],
    },
  },
  {
    match: (id) => id.includes("mcp"),
    meta: {
      iconKey: "mcp",
      label: { "zh-CN": "MCP 工具", "en-US": "MCP Tool" },
      heuristicTokens: [],
    },
  },
  {
    match: (id) => id.includes("skill"),
    meta: {
      iconKey: "skill",
      label: { "zh-CN": "技能", "en-US": "Skill" },
      heuristicTokens: [],
    },
  },
];

/**
 * Title-case a hyphenated/underscored capability id segment for a fallback
 * display name when no registry entry matches.
 */
function humanizeCapabilityId(capabilityId: string): string {
  const base = capabilityId.split(":").pop() ?? capabilityId;
  return base
    .split(/[-_]/g)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function resolveCapabilityMeta(capabilityId: string): CapabilityMeta | null {
  const lower = capabilityId.toLowerCase();
  for (const entry of CAPABILITY_META) {
    if (entry.match(lower)) return entry.meta;
  }
  return null;
}

/**
 * Resolve a capability's display name + icon for the given locale. Falls back to
 * a humanized id and the generic `capability` icon for unknown ids.
 */
export function capabilityDisplayMeta(
  capabilityId: string,
  locale: AppLocale
): { displayName: string; iconKey: CapabilityIconKey } {
  const meta = resolveCapabilityMeta(capabilityId);
  if (meta) {
    return {
      displayName: meta.label[locale] ?? meta.label["en-US"],
      iconKey: meta.iconKey,
    };
  }
  return { displayName: humanizeCapabilityId(capabilityId), iconKey: "capability" };
}

// ---------------------------------------------------------------------------
// Status + owner helpers
// ---------------------------------------------------------------------------

/** Collapse the store `CapabilityStatus` into a chip status. */
export function toChipStatus(status: CapabilityStatus): CapabilityChipStatus {
  switch (status) {
    case "invoking":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "idle":
    default:
      return "idle";
  }
}

const ACTIVE_PHASES: ReadonlySet<RolePhase> = new Set<RolePhase>([
  "acting",
  "thinking",
  "reviewing",
  "activated",
]);

/**
 * Parse the owner roleId from a `role-container-loader:<roleId>` capability id.
 * Returns `null` for any other id shape.
 */
export function parseRoleContainerLoaderRoleId(capabilityId: string): string | null {
  const prefix = "role-container-loader:";
  if (!capabilityId.toLowerCase().startsWith(prefix)) return null;
  const roleId = capabilityId.slice(prefix.length).trim();
  return roleId.length > 0 ? roleId : null;
}

/**
 * Find the on-stage role that best owns a capability by the type heuristic.
 * Returns the first `roleId` (in the provided order) whose lowercased id
 * includes one of the capability's candidate tokens, or `null` if none match.
 */
function inferHeuristicOwner(
  capabilityId: string,
  roleIds: string[]
): string | null {
  const meta = resolveCapabilityMeta(capabilityId.toLowerCase());
  if (!meta || meta.heuristicTokens.length === 0) return null;
  for (const token of meta.heuristicTokens) {
    const match = roleIds.find((roleId) => roleId.toLowerCase().includes(token));
    if (match) return match;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Binding factory
// ---------------------------------------------------------------------------

/** Max chips shown per role before collapsing into a `+N` overflow indicator. */
export const MAX_ROLE_CAPABILITY_CHIPS = 3;

/**
 * Bind every capability invocation to an on-stage role and return a Map keyed by
 * `roleId`. Capabilities that cannot be bound (`unowned`) are omitted from the
 * map entirely — they stay in the right-rail audit panel.
 *
 * Binding precedence:
 *   1. `event-role`          — authoritative `roleId` from the capability event
 *      (`capabilityOwners`); the only non-inferred owner besides loader-id.
 *   2. `loader-id`           — `role-container-loader:<roleId>` parsed directly.
 *      If that role is off-stage the capability stays unowned (never re-bound).
 *   3. `capability-heuristic` — well-known capability id → likely owner token.
 *   4. `active-role`          — if EXACTLY one role is in an active phase, attach
 *      still-unowned capabilities to it (flagged `inferred`).
 *
 * Within each role the chips are ordered by binding confidence
 * (`event-role` → `loader-id` → `capability-heuristic` → `active-role`) then by
 * capabilityId, so the most authoritative chips render first and the order is
 * deterministic.
 */
export function deriveCapabilityRoleBindings(input: {
  capabilityStatuses: Record<string, CapabilityStatus>;
  rolePhases: Record<string, RolePhase>;
  /** Authoritative capability→owner map from the store (Requirement 12). */
  capabilityOwners?: Record<string, CapabilityOwner>;
  activeStage?: AutopilotStage;
  locale: AppLocale;
}): Map<string, RoleCapabilityChip[]> {
  const { capabilityStatuses, rolePhases, locale } = input;
  void input.activeStage; // reserved: stage-scoped binding refinements (future)

  const result = new Map<string, RoleCapabilityChip[]>();

  // Defensive: the scene may call before the store slices are populated (e.g.
  // SSR / first render), where these can be undefined.
  if (
    !capabilityStatuses ||
    typeof capabilityStatuses !== "object" ||
    !rolePhases ||
    typeof rolePhases !== "object"
  ) {
    return result;
  }

  const capabilityOwners =
    input.capabilityOwners && typeof input.capabilityOwners === "object"
      ? input.capabilityOwners
      : {};

  const roleIds = Object.keys(rolePhases);
  const onStage = new Set(roleIds);

  const capabilityIds = Object.keys(capabilityStatuses).sort();
  const unowned: string[] = [];

  // Pass 1: authoritative event-role owner, then loader-id, then heuristic.
  for (const capabilityId of capabilityIds) {
    const status = toChipStatus(capabilityStatuses[capabilityId]);
    const { displayName, iconKey } = capabilityDisplayMeta(capabilityId, locale);

    // 1) Real event owner (authoritative). Highest priority — never guessed.
    const eventOwnerRoleId = capabilityOwners[capabilityId]?.roleId;
    if (eventOwnerRoleId) {
      if (onStage.has(eventOwnerRoleId)) {
        pushChip(result, eventOwnerRoleId, {
          capabilityId,
          ownerRoleId: eventOwnerRoleId,
          ownerSource: "event-role",
          displayName,
          iconKey,
          status,
          inferred: false,
        });
      }
      continue;
    }

    // 2) role-container-loader:<roleId>. This id already names an authoritative
    //    role; if that role is off-stage we leave it UNOWNED rather than
    //    re-attributing it via heuristic / active-role.
    const loaderRoleId = parseRoleContainerLoaderRoleId(capabilityId);
    if (loaderRoleId) {
      if (onStage.has(loaderRoleId)) {
        pushChip(result, loaderRoleId, {
          capabilityId,
          ownerRoleId: loaderRoleId,
          ownerSource: "loader-id",
          displayName,
          iconKey,
          status,
          inferred: false,
        });
      }
      // off-stage loader role → unowned (audit-only); do NOT fall through.
      continue;
    }

    // 3) capability-type heuristic
    const heuristicRoleId = inferHeuristicOwner(capabilityId, roleIds);
    if (heuristicRoleId) {
      pushChip(result, heuristicRoleId, {
        capabilityId,
        ownerRoleId: heuristicRoleId,
        ownerSource: "capability-heuristic",
        displayName,
        iconKey,
        status,
        inferred: true,
      });
      continue;
    }

    unowned.push(capabilityId);
  }

  // Pass 2: single active role fallback for still-unowned capabilities. Only
  // fires when EXACTLY one role is active, to avoid misattributing a capability.
  const activeRoleIds = roleIds.filter((roleId) =>
    ACTIVE_PHASES.has(rolePhases[roleId])
  );
  if (unowned.length > 0 && activeRoleIds.length === 1) {
    const target = activeRoleIds[0];
    for (const capabilityId of unowned) {
      const status = toChipStatus(capabilityStatuses[capabilityId]);
      const { displayName, iconKey } = capabilityDisplayMeta(capabilityId, locale);
      pushChip(result, target, {
        capabilityId,
        ownerRoleId: target,
        ownerSource: "active-role",
        displayName,
        iconKey,
        status,
        inferred: true,
      });
    }
  }

  return sortChipsInPlace(result);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SOURCE_RANK: Record<CapabilityOwnerSource, number> = {
  "event-role": 0,
  "loader-id": 1,
  "capability-heuristic": 2,
  "active-role": 3,
  unowned: 4,
};

function pushChip(
  result: Map<string, RoleCapabilityChip[]>,
  roleId: string,
  chip: RoleCapabilityChip
): void {
  const list = result.get(roleId);
  if (list) {
    list.push(chip);
  } else {
    result.set(roleId, [chip]);
  }
}

function sortChipsInPlace(
  result: Map<string, RoleCapabilityChip[]>
): Map<string, RoleCapabilityChip[]> {
  for (const chips of result.values()) {
    chips.sort((a, b) => {
      const rankDelta = SOURCE_RANK[a.ownerSource] - SOURCE_RANK[b.ownerSource];
      if (rankDelta !== 0) return rankDelta;
      return a.capabilityId.localeCompare(b.capabilityId);
    });
  }
  return result;
}
