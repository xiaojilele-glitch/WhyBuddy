/**
 * whybuddy-3d-real-role-driven-scene-2026-05-29 — Task 18
 *
 * Pure Vitest tests for `connection-line-priority.ts`. No Three.js, no React,
 * no DOM: the four-step priority chain (`deriveConnectionLines`) is exercised
 * directly with minimal event / phase / stage inputs.
 *
 * Coverage (design.md "Testing Strategy" → "Pure Vitest Tests";
 * Requirements 5.5-5.10, 9.3):
 * - step 1 real handoff events win and are directed
 * - step 1 stale (>30s) events are dropped
 * - step 2 phase-timing heuristic, undirected, bounded by 2_000ms
 * - step 3 spec_tree stage rule, undirected
 * - step 4 no evidence → no lines
 * - monotonicity: a later step is only consulted when earlier steps are empty
 * - invariant: every non-`event-from-to` line is undirected
 */

import { describe, expect, it } from "vitest";

import type {
  BlueprintRelayedEvent,
  RolePhase,
} from "@/lib/blueprint-realtime-store";
import type { BlueprintObservedPhaseEvent } from "../blueprint-runtime-scene";

import { deriveConnectionLines } from "../connection-line-priority";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function handoffEvent(
  fromRoleId: string,
  toRoleId: string,
  timestamp: number
): BlueprintRelayedEvent {
  return {
    type: "mission.handoff",
    jobId: "j",
    timestamp,
    payload: { fromRoleId, toRoleId },
  };
}

function phaseEvent(
  roleId: string,
  phase: RolePhase,
  timestamp: number
): BlueprintObservedPhaseEvent {
  return { roleId, phase, timestamp };
}

const NOW = 1_000_000;

// ---------------------------------------------------------------------------
// Step 1 — real handoff events (directed) win (Requirement 5.5)
// ---------------------------------------------------------------------------

describe("deriveConnectionLines step 1 (real handoff events)", () => {
  it("returns one directed event-from-to line and wins over phase events", () => {
    const lines = deriveConnectionLines({
      handoffEvents: [handoffEvent("a", "b", NOW)],
      // These phase events would otherwise trigger step 2, but step 1 wins.
      phaseEvents: [
        phaseEvent("c", "acting", NOW - 500),
        phaseEvent("d", "thinking", NOW),
      ],
      rolePhases: {},
      now: NOW,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      from: "a",
      to: "b",
      directed: true,
      source: "event-from-to",
    });
  });

  it("drops handoff events older than 30s and falls through", () => {
    const lines = deriveConnectionLines({
      handoffEvents: [handoffEvent("a", "b", NOW - 31_000)],
      phaseEvents: [],
      rolePhases: {},
      now: NOW,
    });

    // Stale event ignored, no other evidence → no lines.
    expect(lines).toEqual([]);
  });

  it("deduplicates repeated recent handoff pairs so lines do not stack", () => {
    const lines = deriveConnectionLines({
      handoffEvents: [
        handoffEvent("repository-analyst", "spec-architect", NOW - 200),
        handoffEvent("repository-analyst", "spec-architect", NOW - 100),
      ],
      phaseEvents: [],
      rolePhases: {},
      now: NOW,
    });

    expect(lines).toEqual([
      {
        from: "repository-analyst",
        to: "spec-architect",
        directed: true,
        source: "event-from-to",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Step 2 — phase-event timing heuristic (undirected) (Requirement 5.6)
// ---------------------------------------------------------------------------

describe("deriveConnectionLines step 2 (heuristic)", () => {
  it("derives an undirected heuristic line for acting→thinking within 2000ms", () => {
    const t = NOW - 5_000;
    const lines = deriveConnectionLines({
      handoffEvents: [],
      phaseEvents: [
        phaseEvent("a", "acting", t),
        phaseEvent("b", "thinking", t + 1_000),
      ],
      rolePhases: {},
      now: NOW,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      from: "a",
      to: "b",
      directed: false,
      source: "heuristic",
    });
  });

  it("does NOT produce a line when thinking is more than 2000ms after acting", () => {
    const t = NOW - 5_000;
    const lines = deriveConnectionLines({
      handoffEvents: [],
      phaseEvents: [
        phaseEvent("a", "acting", t),
        phaseEvent("b", "thinking", t + 2_001),
      ],
      rolePhases: {},
      now: NOW,
    });

    expect(lines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step 3 — spec_tree stage rule (undirected) (Requirements 5.7, 5.10)
// ---------------------------------------------------------------------------

describe("deriveConnectionLines step 3 (stage rule)", () => {
  it("connects analyst→architect and architect→auditor for spec_tree", () => {
    const lines = deriveConnectionLines({
      handoffEvents: [],
      phaseEvents: [],
      rolePhases: {
        "x-analyst": "idle",
        "y-architect": "idle",
        "z-auditor": "idle",
      } as Record<string, RolePhase>,
      activeStage: "spec_tree",
      now: NOW,
    });

    expect(lines).toHaveLength(2);
    expect(lines).toEqual([
      { from: "x-analyst", to: "y-architect", directed: false, source: "stage-rule" },
      { from: "y-architect", to: "z-auditor", directed: false, source: "stage-rule" },
    ]);
    for (const line of lines) {
      expect(line.directed).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Step 4 — no evidence (Requirement 5.8)
// ---------------------------------------------------------------------------

describe("deriveConnectionLines step 4 (no lines)", () => {
  it("returns [] when all sources are empty and stage is undefined", () => {
    expect(
      deriveConnectionLines({
        handoffEvents: [],
        phaseEvents: [],
        rolePhases: {},
        activeStage: undefined,
        now: NOW,
      })
    ).toEqual([]);
  });

  it("returns [] for an unknown / unimplemented stage", () => {
    expect(
      deriveConnectionLines({
        handoffEvents: [],
        phaseEvents: [],
        rolePhases: { "x-analyst": "idle" } as Record<string, RolePhase>,
        activeStage: "unknown_stage",
        now: NOW,
      })
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Monotonicity — later steps only consulted when earlier ones are empty
// (Requirement 5.5 priority)
// ---------------------------------------------------------------------------

describe("deriveConnectionLines monotonicity", () => {
  it("returns only the handoff line when handoff AND stage rule both apply", () => {
    const lines = deriveConnectionLines({
      handoffEvents: [handoffEvent("a", "b", NOW)],
      phaseEvents: [],
      rolePhases: {
        "x-analyst": "idle",
        "y-architect": "idle",
        "z-auditor": "idle",
      } as Record<string, RolePhase>,
      activeStage: "spec_tree",
      now: NOW,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].source).toBe("event-from-to");
  });
});

// ---------------------------------------------------------------------------
// Invariant — every non-step-1 line is undirected (Requirement 5.9)
// ---------------------------------------------------------------------------

describe("deriveConnectionLines undirected invariant", () => {
  it("marks heuristic and stage-rule lines as undirected", () => {
    const t = NOW - 5_000;

    const heuristicLines = deriveConnectionLines({
      handoffEvents: [],
      phaseEvents: [
        phaseEvent("a", "acting", t),
        phaseEvent("b", "thinking", t + 500),
      ],
      rolePhases: {},
      now: NOW,
    });

    const stageRuleLines = deriveConnectionLines({
      handoffEvents: [],
      phaseEvents: [],
      rolePhases: {
        "x-analyst": "idle",
        "y-architect": "idle",
        "z-auditor": "idle",
      } as Record<string, RolePhase>,
      activeStage: "spec_tree",
      now: NOW,
    });

    for (const line of [...heuristicLines, ...stageRuleLines]) {
      expect(line.source).not.toBe("event-from-to");
      expect(line.directed).toBe(false);
    }
  });
});
