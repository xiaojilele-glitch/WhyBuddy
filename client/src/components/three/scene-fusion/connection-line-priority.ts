/**
 * whybuddy-3d-real-role-driven-scene-2026-05-29 — Task 14
 *
 * Pure, Three.js-free derivation of blueprint connection lines via the
 * four-step priority chain (design.md "Event Observation and Line Priority" →
 * "Priority Chain"; Requirements 5.5-5.10).
 *
 * The chain returns the FIRST non-empty step's result and never consults a
 * later step once an earlier one yields lines:
 *
 *   1. Real handoff events within the last `30_000ms` → DIRECTED lines,
 *      `source: "event-from-to"`. These are the ONLY directed lines.
 *   2. Phase-transition timing heuristic: role A entering `acting` followed by
 *      a different role B entering `thinking` within `2_000ms` → UNDIRECTED
 *      lines, `source: "heuristic"`.
 *   3. `activeStage` stage-rule fallback (only `spec_tree` in this feature) →
 *      UNDIRECTED lines, `source: "stage-rule"`.
 *   4. No lines → `[]`.
 *
 * Hard constraints:
 *
 * - No Three.js import, no side effects, fully deterministic. The same input
 *   always produces the same output, so this module is SSR / Vitest safe and
 *   can be unit tested without a WebGL or DOM context.
 * - Step 1 lines are the only `directed: true` lines; steps 2 and 3 are always
 *   `directed: false` (Requirement 5.9 / design "Priority Chain").
 */

import type {
  BlueprintConnectionLine,
  BlueprintObservedPhaseEvent,
} from "./blueprint-runtime-scene";
import type {
  BlueprintRelayedEvent,
  RolePhase,
} from "@/lib/blueprint-realtime-store";

// TODO(Wave 4): No canonical `AutopilotStage` type is exported in the codebase
// yet (the nearest real unions are `AutopilotBackendStage` in
// `@/lib/autopilot-coordination/page-mapping` and `BlueprintSceneStageKey` in
// `./blueprint-stage-signal`). This local alias keeps the priority-chain
// signature permissive for now; Wave 4 will refine it to the real stage union
// the owning page passes down, in lockstep with the sibling scene files.
type AutopilotStage = string;

/** Real handoff events older than this (relative to `now`) are ignored. */
const HANDOFF_WINDOW_MS = 30_000;

/** A→acting then B→thinking adjacency window for the timing heuristic. */
const PHASE_HEURISTIC_WINDOW_MS = 2_000;

// ---------------------------------------------------------------------------
// Timestamp helper
// ---------------------------------------------------------------------------

/**
 * Normalize a `BlueprintRelayedEvent.timestamp` (epoch millis number or ISO
 * string) to a numeric epoch. Invalid date strings yield `NaN`, which the
 * window check below treats as "not recent" so malformed events are dropped.
 */
function toTimestamp(t: string | number): number {
  return typeof t === "number" ? t : new Date(t).getTime();
}

// ---------------------------------------------------------------------------
// Step 1 helpers — real handoff events (directed)
// ---------------------------------------------------------------------------

/**
 * Read a defensively-validated `{ from, to }` pair from a handoff event's
 * payload. The store / ring is expected to pre-filter for non-empty
 * `fromRoleId` / `toRoleId`, but we re-check here so the pure function is
 * correct in isolation. Returns `null` when either id is missing or empty.
 */
function readHandoffRoles(
  event: BlueprintRelayedEvent
): { from: string; to: string } | null {
  const payload = event.payload;
  if (!payload) return null;

  const from = payload.fromRoleId;
  const to = payload.toRoleId;
  if (
    typeof from === "string" &&
    from.length > 0 &&
    typeof to === "string" &&
    to.length > 0
  ) {
    return { from, to };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 2 helpers — phase-transition timing heuristic (undirected)
// ---------------------------------------------------------------------------

/**
 * Detect role handoffs purely from phase-event timing: a role A entering
 * `acting` followed by a DIFFERENT role B entering `thinking` within
 * `windowMs` (design "Priority Chain"; Requirement 5.6 / 5.8).
 *
 * Algorithm:
 *
 * - Drop events with non-finite timestamps, then sort the remainder ascending
 *   by timestamp so adjacency is evaluated in real event order regardless of
 *   the ring's FIFO insertion order.
 * - For each `acting` event (role A), scan forward for `thinking` events whose
 *   timestamp is within `[A.timestamp, A.timestamp + windowMs]`. Because the
 *   list is sorted, the scan can stop as soon as a candidate exceeds the
 *   window.
 * - Skip self-pairs (A === B) and de-duplicate identical `(from, to)` pairs so
 *   each ordered role pair contributes at most one line.
 *
 * `now` is accepted to match the design signature
 * (`inferPhaseHandoffs(phaseEvents, 2_000, now)`); the adjacency rule itself is
 * `now`-independent (Requirement 5.6 bounds by the 2_000ms gap, not by `now`),
 * so it is intentionally not used as an extra filter here.
 */
function inferPhaseHandoffs(
  phaseEvents: BlueprintObservedPhaseEvent[],
  windowMs: number,
  now: number
): Array<{ from: string; to: string }> {
  void now;

  const ordered = phaseEvents
    .filter((event) => Number.isFinite(event.timestamp))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  const lines: Array<{ from: string; to: string }> = [];
  const seenPairs = new Set<string>();

  for (let i = 0; i < ordered.length; i += 1) {
    const acting = ordered[i];
    if (acting.phase !== "acting") continue;

    for (let j = i + 1; j < ordered.length; j += 1) {
      const candidate = ordered[j];
      const delta = candidate.timestamp - acting.timestamp;
      // Sorted ascending: once we pass the window, no later event qualifies.
      if (delta > windowMs) break;
      if (delta < 0) continue;
      if (candidate.phase !== "thinking") continue;
      if (candidate.roleId === acting.roleId) continue;

      const key = `${acting.roleId}\u0000${candidate.roleId}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      lines.push({ from: acting.roleId, to: candidate.roleId });
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Step 3 — stage-rule fallback (undirected)
// ---------------------------------------------------------------------------

/**
 * Stage-specific connection rules keyed by `activeStage`. Only `spec_tree` is
 * implemented in this feature (design "spec_tree rule"; Requirement 5.10);
 * other stages fall through to "no lines".
 */
const STAGE_RULES: Partial<
  Record<
    string,
    (rolePhases: Record<string, RolePhase>) => Array<{ from: string; to: string }>
  >
> = {
  spec_tree: (rolePhases) => {
    const find = (token: string) =>
      Object.keys(rolePhases).find((id) => id.toLowerCase().includes(token));

    const analyst = find("analyst");
    const architect = find("architect");
    const auditor = find("auditor");

    const lines: Array<{ from: string; to: string }> = [];
    if (analyst && architect) lines.push({ from: analyst, to: architect });
    if (architect && auditor) lines.push({ from: architect, to: auditor });
    return lines;
  },
};

// ---------------------------------------------------------------------------
// Priority chain entry point
// ---------------------------------------------------------------------------

/**
 * Derive blueprint connection lines from the strongest available handoff
 * evidence, returning the first non-empty step's result (design "Priority
 * Chain"; Requirements 5.5-5.10).
 */
export function deriveConnectionLines(input: {
  handoffEvents: BlueprintRelayedEvent[];
  phaseEvents: BlueprintObservedPhaseEvent[];
  rolePhases: Record<string, RolePhase>;
  activeStage?: AutopilotStage;
  now: number;
}): BlueprintConnectionLine[] {
  // Step 1 — real handoff events within the last 30s win, and are the only
  // directed lines (Requirement 5.5).
  const directedLines: BlueprintConnectionLine[] = [];
  const seenDirectedPairs = new Set<string>();
  for (const event of input.handoffEvents) {
    const timestamp = toTimestamp(event.timestamp);
    // A NaN timestamp makes this comparison false, dropping malformed events.
    if (!(input.now - timestamp <= HANDOFF_WINDOW_MS)) continue;

    const roles = readHandoffRoles(event);
    if (!roles) continue;

    const key = `${roles.from}\u0000${roles.to}`;
    if (seenDirectedPairs.has(key)) continue;
    seenDirectedPairs.add(key);

    directedLines.push({
      from: roles.from,
      to: roles.to,
      directed: true,
      source: "event-from-to",
    });
  }
  if (directedLines.length > 0) {
    return directedLines;
  }

  // Step 2 — phase-transition timing heuristic, always undirected
  // (Requirements 5.6, 5.9).
  const heuristic = inferPhaseHandoffs(
    input.phaseEvents,
    PHASE_HEURISTIC_WINDOW_MS,
    input.now
  );
  if (heuristic.length > 0) {
    const heuristicLines: BlueprintConnectionLine[] = heuristic.map((line) => ({
      from: line.from,
      to: line.to,
      directed: false,
      source: "heuristic",
    }));
    return heuristicLines;
  }

  // Step 3 — stage-rule fallback, always undirected (Requirements 5.7, 5.9).
  const stageRule = input.activeStage
    ? STAGE_RULES[input.activeStage]?.(input.rolePhases) ?? []
    : [];
  if (stageRule.length > 0) {
    const stageRuleLines: BlueprintConnectionLine[] = stageRule.map((line) => ({
      from: line.from,
      to: line.to,
      directed: false,
      source: "stage-rule",
    }));
    return stageRuleLines;
  }

  // Step 4 — no evidence; agents still render, but no lines are drawn
  // (Requirement 5.8).
  return [];
}
