/**
 * whybuddy-3d-real-role-driven-scene-2026-05-29 — Task 9
 *
 * Pure, Three.js-free view-model types and layout/visual helpers for the
 * blueprint runtime scene. This module is the data layer behind
 * `BlueprintRuntimeAgents.tsx`: it derives stable zones, positions, animal
 * models, colors, and phase visuals from a `roleId` string and the live
 * `rolePhases` snapshot.
 *
 * Hard constraints (see design.md "Data Models" / "Zone Classification" /
 * "Phase Visual Mapping" / "Hash"):
 *
 * - No Three.js scene objects are constructed here. Positions are plain
 *   `[x, y, z]` number tuples so the module stays SSR / Vitest safe and can be
 *   unit tested without a WebGL or DOM context.
 * - Every exported helper is deterministic and pure: the same `roleId` (and
 *   the same set of `roleId`s) always produces the same output.
 *
 * The `createBlueprintRuntimeSceneData` factory (added in Task 10) composes
 * these helpers into a `BlueprintRuntimeSceneData` view model from a live
 * `rolePhases` snapshot. It also stays Three.js-free and deterministic.
 */

import type {
  BlueprintRelayedEvent,
  RolePhase,
  RoleRuntimeState,
} from "@/lib/blueprint-realtime-store";
import type { AppLocale } from "@/lib/locale";
import { PET_MODELS } from "@/lib/assets";
import {
  FUTURE_DEPARTMENT_COLORS,
  FUTURE_OFFICE_COLORS,
} from "@/lib/scene-theme";
import { displayLabel } from "./role-display-label";

// TODO(Wave 4): No canonical `AutopilotStage` type is exported in the codebase
// yet. `PetWorkers.tsx`, `BlueprintRuntimeAgents.tsx`, and `Scene3D.tsx` all
// keep a permissive local `type AutopilotStage = string` until a canonical
// stage union exists. We mirror the same alias here so the factory signature
// matches end-to-end and Wave 4 can refine all sites together.
type AutopilotStage = string;

function resolveAgentLabel(
  roleId: string,
  locale: AppLocale,
  roleLabels: Record<string, string> | undefined
): string {
  const fallback = displayLabel(roleId, locale);
  const englishFallback = displayLabel(roleId, "en-US");
  const runtimeLabel = roleLabels?.[roleId]?.trim();

  if (
    runtimeLabel &&
    runtimeLabel !== roleId &&
    (fallback === roleId || runtimeLabel.length > fallback.length)
  ) {
    return runtimeLabel;
  }
  if (englishFallback && englishFallback !== roleId) return englishFallback;

  return fallback;
}

// ---------------------------------------------------------------------------
// View-model types (design.md "Data Models" → "View Model")
// ---------------------------------------------------------------------------

export type FunctionalZone =
  | "intake"
  | "repository"
  | "architect"
  | "runtime"
  | "quality"
  | "memory"
  | "experience"
  | "standby";

export type PhaseTier = "main" | "secondary" | "faded" | "standby" | "failed";

export interface BlueprintObservedPhaseEvent {
  roleId: string;
  phase: RolePhase;
  timestamp: number;
}

export interface ZoneSlot {
  zone: FunctionalZone;
  position: [number, number, number];
}

export interface BlueprintRuntimeAgent {
  roleId: string;
  label: string;
  animal: string;
  /**
   * Accent color for NON-BODY scene UI only — role-zone tint for the nameplate
   * icon row, ground ring, connection lines, capability chips, and other
   * markers. It MUST NOT be written into the pet GLB body `material.color` or
   * `material.emissive`: Kenney Cube Pets ship with their own authoritative
   * material colors, and dyeing the body produced the rejected "发光蒙层"
   * look. The renderer keeps the body's natural GLB shading; this field exists
   * purely for accents and DEV-bridge/test snapshots.
   */
  accentColor: string;
  zone: FunctionalZone;
  position: [number, number, number];
  phaseTier: PhaseTier;
  emissive: number;
  opacity: number;
  amplitude: number;
  /**
   * Phase-tier accent override (currently the `failed` red). Same constraint as
   * `accentColor`: accents / markers only, never the pet body material.
   */
  colorOverride?: string;
  enterDurationMs: number;
  wasReanimatedThisRender?: boolean;
}

export interface BlueprintConnectionLine {
  from: string;
  to: string;
  directed: boolean;
  source: "event-from-to" | "heuristic" | "stage-rule";
}

export interface BlueprintRuntimeSceneData {
  agents: BlueprintRuntimeAgent[];
  connectionLines: BlueprintConnectionLine[];
  emptyHint: { visible: boolean; text: string };
}

// ---------------------------------------------------------------------------
// Hash (design.md "Hash")
// ---------------------------------------------------------------------------

/**
 * djb2 hash, folded to a 32-bit unsigned integer.
 *
 * Implemented exactly as specified in design.md so that hash-derived zone
 * slots, animals, and colors stay stable and reproducible across the right
 * rail, the 3D scene, and the pure unit tests.
 */
export function stableHash(roleId: string): number {
  let h = 5381;
  for (const c of roleId) {
    h = ((h * 33) ^ c.codePointAt(0)!) | 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Zone classification (design.md "Zone Classification")
// ---------------------------------------------------------------------------

/**
 * Top-down substring rules. The first matching rule wins; order matters.
 */
const ZONE_RULES: ReadonlyArray<readonly [FunctionalZone, readonly string[]]> = [
  ["intake", ["intake", "coordinator", "product"]],
  ["repository", ["repository", "analyst", "analyzer"]],
  ["architect", ["architect", "spec", "planner", "strategist"]],
  ["runtime", ["runtime", "executor", "dispatcher", "operator"]],
  ["quality", ["quality", "auditor", "reviewer"]],
  ["memory", ["memory", "curator", "archivist"]],
  ["experience", ["experience", "presenter", "director"]],
];

/**
 * Classify a `roleId` into one of the 8 functional zones using top-down
 * substring matching against `roleId.toLowerCase()`. Falls back to `standby`
 * when no rule matches.
 */
export function classifyZone(roleId: string): FunctionalZone {
  const lower = roleId.toLowerCase();
  for (const [zone, tokens] of ZONE_RULES) {
    if (tokens.some((token) => lower.includes(token))) {
      return zone;
    }
  }
  return "standby";
}

// ---------------------------------------------------------------------------
// Zone anchors + slot assignment (design.md "Zone Classification" → anchors)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tidy grid layout (2026-05-29 revision)
// ---------------------------------------------------------------------------
//
// Roles are laid out on an evenly-spaced, centred grid instead of being
// scattered around per-zone rings. The old ring layout read as "摆放不整齐"
// (uneven / messy) because each zone had its own anchor and roles sat at
// hash-derived angles. The grid keeps the scene orderly while still grouping
// by function: roles are ordered by (zone order, roleId) so same-zone roles
// stay adjacent, then filled left→right, front→back. The `zone` field on each
// slot is still derived from `classifyZone` (labels / stage-rule lines use it);
// only the POSITION changed from ring to grid.

/**
 * Stable zone ordering used to group same-zone roles next to each other in the
 * grid fill order. Matches the functional flow intake → … → standby.
 */
const ZONE_GRID_ORDER: readonly FunctionalZone[] = [
  "intake",
  "repository",
  "architect",
  "runtime",
  "quality",
  "memory",
  "experience",
  "standby",
];

/** Max columns per row before wrapping to the next (deeper) row. */
const GRID_COLUMNS = 4;

/**
 * World-space spacing between adjacent grid cells, in metres. Widened in the
 * 2026-05-29 layout follow-up so each role has room for its own workstation
 * (desk + computer) in front without crowding its neighbours; the depth step is
 * larger than the width step because each role's desk extends toward the camera.
 */
const GRID_SPACING_X = 2.4;
const GRID_SPACING_Z = 2.8;

/** Front row's z origin; deeper rows step further back (−z is toward the back wall). */
const GRID_ORIGIN_Z = -2.2;

/**
 * Compute the centred grid position for the `index`-th role (0-based) in the
 * ordered fill sequence, given the total role count.
 *
 * Each row is horizontally centred on its own width, so a partially-filled
 * last row still reads as centred rather than left-justified. `y` is always
 * `0` (agents stand on the floor).
 */
function gridPosition(
  index: number,
  total: number
): [number, number, number] {
  const row = Math.floor(index / GRID_COLUMNS);
  const col = index % GRID_COLUMNS;

  const totalRows = Math.ceil(total / GRID_COLUMNS);
  // Number of cells actually present in this row (last row may be short).
  const cellsInRow =
    row < totalRows - 1 ? GRID_COLUMNS : total - row * GRID_COLUMNS;

  // Centre each row on its own width.
  const rowWidth = (cellsInRow - 1) * GRID_SPACING_X;
  const x = col * GRID_SPACING_X - rowWidth / 2;
  const z = GRID_ORIGIN_Z + row * GRID_SPACING_Z;

  return [x, 0, z];
}

/**
 * Assign every `roleId` a deterministic zone + a tidy centred-grid position.
 *
 * - `zone` is derived from `classifyZone(roleId)` (Requirement 4.1) and still
 *   drives labels and stage-rule connection lines.
 * - Roles are sorted by `(ZONE_GRID_ORDER index, roleId)` so the fill order is
 *   deterministic AND same-zone roles end up adjacent in the grid.
 * - Positions come from `gridPosition`, an evenly-spaced centred grid. Distinct
 *   roles always get distinct cells (Requirement 4.7), and the same set of
 *   `roleId`s always yields the same `Map` (Requirement 4.2 / 4.3).
 */
export function assignRuntimeRoleSlots(
  roleIds: string[]
): Map<string, ZoneSlot> {
  const result = new Map<string, ZoneSlot>();

  // De-dupe, then sort by (zone order, roleId) so the grid groups same-zone
  // roles together and is independent of input ordering.
  const unique = Array.from(new Set(roleIds));
  const zoneRank = (roleId: string): number => {
    const rank = ZONE_GRID_ORDER.indexOf(classifyZone(roleId));
    return rank === -1 ? ZONE_GRID_ORDER.length : rank;
  };
  const ordered = unique.sort((a, b) => {
    const ra = zoneRank(a);
    const rb = zoneRank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });

  ordered.forEach((roleId, index) => {
    result.set(roleId, {
      zone: classifyZone(roleId),
      position: gridPosition(index, ordered.length),
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Deterministic animal + color selection (Requirement 2.14)
// ---------------------------------------------------------------------------

/**
 * Stable ordered pool of GLB pet model keys. These are the keys of
 * `PET_MODELS`, i.e. the same `animal` value that `MissionFirstAgents` /
 * `AgentWorker` pass to `useGLTF(PET_MODELS[animal])`. `pickAnimal` returns one
 * of these keys (e.g. `"cat"`), NOT a model URL.
 */
const PET_ANIMAL_POOL: readonly string[] = Object.keys(PET_MODELS);

/**
 * Stable ordered ACCENT color pool. Used ONLY for non-body scene accents
 * (nameplate icon row, ground ring, connection lines, capability chips). It is
 * NEVER applied to the pet GLB body material — Kenney Cube Pets keep their own
 * authoritative material colors. The first four entries are the existing
 * `FUTURE_DEPARTMENT_COLORS` (kept in their original order as a shared source
 * of truth); the remainder extends the palette with additional distinct
 * `FUTURE_OFFICE_COLORS` so that larger role sets get more accent variety.
 */
const ROLE_ACCENT_COLOR_POOL: readonly string[] = [
  ...FUTURE_DEPARTMENT_COLORS,
  FUTURE_OFFICE_COLORS.rose,
  FUTURE_OFFICE_COLORS.green,
  FUTURE_OFFICE_COLORS.cyanSoft,
  FUTURE_OFFICE_COLORS.slate,
];

/**
 * Deterministically pick a GLB pet animal key for a `roleId`. Returns the pool
 * KEY (e.g. `"cat"`), suitable for `PET_MODELS[pickAnimal(roleId)]`.
 */
export function pickAnimal(roleId: string): string {
  return PET_ANIMAL_POOL[stableHash(roleId) % PET_ANIMAL_POOL.length];
}

/**
 * Deterministically pick an ACCENT hex color string for a `roleId`. The result
 * is for non-body scene accents only (see `BlueprintRuntimeAgent.accentColor`);
 * it MUST NOT be written into the pet body material.
 */
export function pickAccentColor(roleId: string): string {
  return ROLE_ACCENT_COLOR_POOL[stableHash(roleId) % ROLE_ACCENT_COLOR_POOL.length];
}

// ---------------------------------------------------------------------------
// Phase → tier → visuals (design.md "Phase Visual Mapping")
// ---------------------------------------------------------------------------

/** Red emissive override used for the `failed` phase tier. */
const FAILED_COLOR_OVERRIDE = "#ef4444";

/**
 * Map a concrete `RolePhase` to its visual `PhaseTier`.
 */
export function phaseTierOf(phase: RolePhase): PhaseTier {
  switch (phase) {
    case "acting":
    case "thinking":
    case "reviewing":
    case "activated":
      return "main";
    case "observing":
      return "secondary";
    case "completed":
      return "faded";
    case "idle":
    case "sleeping":
      return "standby";
    case "failed":
      return "failed";
    default: {
      // Exhaustiveness guard: every RolePhase is handled above.
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/**
 * Resolve the shader-uniform visual values for a `PhaseTier`
 * (design.md "Phase Visual Mapping" table).
 */
export function phaseTierVisuals(tier: PhaseTier): {
  emissive: number;
  opacity: number;
  amplitude: number;
  colorOverride?: string;
} {
  switch (tier) {
    case "main":
      return { emissive: 0.42, opacity: 1.0, amplitude: 1.0 };
    case "secondary":
      return { emissive: 0.26, opacity: 1.0, amplitude: 0.7 };
    case "faded":
      return { emissive: 0.08, opacity: 1.0, amplitude: 0.4 };
    case "standby":
      return { emissive: 0.0, opacity: 1.0, amplitude: 0.2 };
    case "failed":
      return {
        emissive: 1.0,
        opacity: 1.0,
        amplitude: 1.2,
        colorOverride: FAILED_COLOR_OVERRIDE,
      };
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Stage-role seeding (design.md "Stage-role seeding (Fix 2)";
// Requirements 11.1-11.10)
// ---------------------------------------------------------------------------

/**
 * Deterministic, stage-keyed roster of canonical runtime `roleId`s that SHOULD
 * participate in each blueprint stage before any real role event arrives.
 *
 * These are real canonical runtime roles (present in `ROLE_LABELS`, resolvable
 * via `displayLabel`), NOT the rejected legacy 7 fixed slots. Each seeded role
 * is classified into a Functional_Zone by the same `classifyZone` rules as a
 * real role.
 *
 * `AutopilotStage` is the permissive local `string` alias (see TODO above);
 * the keys below are real `BlueprintGenerationStage` values, so `Partial<
 * Record<...>>` keyed on the alias still type-checks and reads cleanly.
 */
const STAGE_SEED_ROLES: Partial<Record<AutopilotStage, string[]>> = {
  input: ["intake-coordinator"],
  clarification: ["intake-coordinator", "product-strategist"],
  route_generation: ["product-strategist", "repository-analyst"],
  spec_tree: ["repository-analyst", "spec-architect", "role-quality-auditor"],
};

/**
 * Derive the seed `rolePhases` map for the current `activeStage`.
 *
 * Pure and deterministic (Requirement 11.1): the same `activeStage` always
 * yields the same seed map. Each seeded role is assigned the seed phase
 * `activated`, which maps to the `main` Phase_Tier (fully visible) before any
 * real event arrives (Requirement 11.7). Any unseeded stage or `undefined`
 * yields an empty seed (Requirement 11.6).
 */
export function deriveStageSeedRolePhases(
  activeStage?: AutopilotStage
): Record<string, RolePhase> {
  const roster = activeStage ? STAGE_SEED_ROLES[activeStage] ?? [] : [];
  const seed: Record<string, RolePhase> = {};
  for (const roleId of roster) {
    seed[roleId] = "activated";
  }
  return seed;
}

// ---------------------------------------------------------------------------
// Scene data factory (design.md "Data Models" → "Factory Signature" /
// "Empty State" / "Stage-role seeding (Fix 2)";
// Requirements 1.1-1.7, 2.1-2.14, 3.1, 11.8-11.10)
// ---------------------------------------------------------------------------

/**
 * Bilingual empty-state text rendered as a ground decal when blueprint mode
 * has no live roles yet.
 *
 * design.md "Empty State" shows two lines — the Chinese `等待任务启动...` and
 * the English `Waiting for task...`. Requirement 1.2 requires BOTH strings to
 * be present, so we always emit the two-line bilingual string regardless of
 * `locale`. The ordering (Chinese first) is fixed for a stable, deterministic
 * snapshot; the rendering layer is free to lay the two lines out vertically.
 */
const EMPTY_HINT_TEXT = "等待任务启动...\nWaiting for task...";

/** Enter-animation duration (ms) for a freshly appearing role in live mode. */
const LIVE_ENTER_DURATION_MS = 500;

/** Enter-animation duration (ms) for a freshly appearing role during replay. */
const REPLAY_ENTER_DURATION_MS = 333;

/**
 * Build the blueprint runtime scene view model from a live `rolePhases`
 * snapshot.
 *
 * Behavior (this task):
 *
 * - Stage-role seeding (Requirement 11.8): the factory first computes
 *   Effective_Role_Phases by merging the per-stage seed UNDER the real
 *   `rolePhases` (`{ ...deriveStageSeedRolePhases(activeStage), ...rolePhases }`).
 *   Because `rolePhases` is spread last, a real `rolePhases[roleId]` overrides
 *   the seeded phase for that role, while seeded-but-not-yet-real roles remain
 *   visible at their seeded phase. EVERYTHING below (empty check, agent
 *   derivation) is driven by this merged map.
 * - Empty state (Requirement 1.1-1.7): when Effective_Role_Phases has no roles
 *   — i.e. `activeStage` is undefined/non-seeded AND `rolePhases` is empty —
 *   return zero agents, zero connection lines, and a visible bilingual empty
 *   hint. No CEO placeholder and no legacy fixed-slot layout are emitted.
 * - Non-empty (Requirement 2.1-2.14): one agent per unique `roleId` in
 *   Effective_Role_Phases, each with a stable zone + hash position (via
 *   `assignRuntimeRoleSlots`), a stable animal (`pickAnimal`) and accent color
 *   (`pickAccentColor`, non-body accents only), phase-tier visuals
 *   (`phaseTierVisuals(phaseTierOf(phase))`),
 *   a unified display label (`displayLabel`, Requirement 3.1), and a
 *   replay-aware enter duration.
 * - Agent array order is deterministic: roles are emitted in canonical sorted
 *   order so the same input always yields the same output array.
 *
 * Connection lines are intentionally `[]` for this task. The priority chain
 * (`deriveConnectionLines`) is wired in during Wave 4 (task 16); the
 * `handoffEvents`, `phaseEvents`, and `activeStage` params are accepted now so
 * the factory signature stays stable. `roleRuntimeStates` is likewise reserved
 * for future runtime-kind visuals.
 */
export function createBlueprintRuntimeSceneData(input: {
  locale: AppLocale;
  rolePhases: Record<string, RolePhase>;
  roleLabels?: Record<string, string>;
  roleRuntimeStates: Record<string, RoleRuntimeState>;
  handoffEvents: BlueprintRelayedEvent[];
  phaseEvents: BlueprintObservedPhaseEvent[];
  activeStage?: AutopilotStage;
  isReplay: boolean;
  now: number;
}): BlueprintRuntimeSceneData {
  // Wave 4 will consume handoffEvents / phaseEvents to derive the connection-
  // line priority chain, and may consume roleRuntimeStates / now for
  // runtime-kind visuals. Reference them here so they stay in the stable
  // signature without tripping no-unused-parameter lint. (`activeStage` is now
  // consumed by the stage-role seeding merge below.)
  void input.handoffEvents;
  void input.phaseEvents;
  void input.roleRuntimeStates;
  void input.now;

  // Effective_Role_Phases — merge the per-stage seed UNDER real rolePhases so
  // real events always win per roleId, while seeded-but-not-yet-real roles
  // stay visible (design.md "Stage-role seeding (Fix 2)", Requirement 11.8).
  const seed = deriveStageSeedRolePhases(input.activeStage);
  const effectiveRolePhases = { ...seed, ...input.rolePhases };
  const roleIds = Object.keys(effectiveRolePhases);

  // Empty state — design.md "Empty State", Requirements 1.1-1.4, 1.7. Fires
  // only when the MERGED map is empty (no seed roles AND no real rolePhases).
  if (roleIds.length === 0) {
    return {
      agents: [],
      connectionLines: [],
      emptyHint: { visible: true, text: EMPTY_HINT_TEXT },
    };
  }

  const slots = assignRuntimeRoleSlots(roleIds);
  const enterDurationMs = input.isReplay
    ? REPLAY_ENTER_DURATION_MS
    : LIVE_ENTER_DURATION_MS;

  // Deterministic, canonical (sorted) emission order so the agents array is
  // stable across renders. Positions come from the `slots` Map keyed by
  // roleId, so this only fixes array order, not placement.
  const orderedRoleIds = [...roleIds].sort();

  const agents: BlueprintRuntimeAgent[] = orderedRoleIds.map((roleId) => {
    const phase = effectiveRolePhases[roleId];
    const tier = phaseTierOf(phase);
    const visuals = phaseTierVisuals(tier);
    // Every roleId came from Effective_Role_Phases, so `assignRuntimeRoleSlots`
    // always produced a matching slot.
    const slot = slots.get(roleId)!;

    return {
      roleId,
      label: resolveAgentLabel(roleId, input.locale, input.roleLabels),
      animal: pickAnimal(roleId),
      accentColor: pickAccentColor(roleId),
      zone: slot.zone,
      position: slot.position,
      phaseTier: tier,
      emissive: visuals.emissive,
      opacity: visuals.opacity,
      amplitude: visuals.amplitude,
      colorOverride: visuals.colorOverride,
      enterDurationMs,
      // `wasReanimatedThisRender` is owned by the rendering component, which
      // diffs against its `seenRoleIdsByJobId` ref; the pure factory leaves it
      // undefined.
    };
  });

  return {
    // connectionLines wired in Wave 4 (task 16) via deriveConnectionLines;
    // empty here so agents render before any line evidence exists.
    agents,
    connectionLines: [],
    emptyHint: { visible: false, text: "" },
  };
}
