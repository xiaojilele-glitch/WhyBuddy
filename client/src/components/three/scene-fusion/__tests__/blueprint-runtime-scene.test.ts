/**
 * whybuddy-3d-real-role-driven-scene-2026-05-29 — Task 18
 *
 * Pure Vitest tests for `blueprint-runtime-scene.ts`. No Three.js, no React,
 * no DOM: every assertion targets the deterministic, side-effect-free
 * view-model helpers and the scene-data factory.
 *
 * Coverage (design.md "Testing Strategy" → "Pure Vitest Tests";
 * Requirements 4.1-4.7, 9.2):
 * - zone classification for representative role ids
 * - stable hash determinism + uint32 range (property)
 * - animal/color stability across calls and factory runs
 * - grid position distinctness for same-zone roles (Requirement 4.7)
 * - empty-state factory output (Requirement 1.x)
 * - one agent per roleId + phase visuals + replay enter duration (Requirement 2.x)
 */

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import type {
  RolePhase,
  RoleRuntimeState,
  BlueprintRelayedEvent,
} from "@/lib/blueprint-realtime-store";

import {
  assignRuntimeRoleSlots,
  classifyZone,
  createBlueprintRuntimeSceneData,
  deriveStageSeedRolePhases,
  phaseTierOf,
  phaseTierVisuals,
  pickAnimal,
  pickAccentColor,
  stableHash,
  type BlueprintObservedPhaseEvent,
  type FunctionalZone,
} from "../blueprint-runtime-scene";

// ---------------------------------------------------------------------------
// Factory input builder
// ---------------------------------------------------------------------------

function makeFactoryInput(overrides: {
  rolePhases: Record<string, RolePhase>;
  roleLabels?: Record<string, string>;
  isReplay?: boolean;
  activeStage?: string;
}) {
  return {
    locale: "zh-CN" as const,
    rolePhases: overrides.rolePhases,
    roleLabels: overrides.roleLabels,
    roleRuntimeStates: {} as Record<string, RoleRuntimeState>,
    handoffEvents: [] as BlueprintRelayedEvent[],
    phaseEvents: [] as BlueprintObservedPhaseEvent[],
    activeStage: overrides.activeStage,
    isReplay: overrides.isReplay ?? false,
    now: 0,
  };
}

// ---------------------------------------------------------------------------
// Zone classification (Requirement 4.1)
// ---------------------------------------------------------------------------

describe("classifyZone", () => {
  const cases: Array<[string, FunctionalZone]> = [
    ["intake-coordinator", "intake"],
    ["repository-analyst", "repository"],
    ["spec-architect", "architect"],
    ["role-runtime-executor", "runtime"],
    ["role-quality-auditor", "quality"],
    ["role-memory-curator", "memory"],
    ["role-experience-presenter", "experience"],
    ["totally-unknown-xyz", "standby"],
  ];

  it.each(cases)("classifies %s into the %s zone", (roleId, zone) => {
    expect(classifyZone(roleId)).toBe(zone);
  });
});

// ---------------------------------------------------------------------------
// stableHash determinism + range (Requirement 4.2, property)
// ---------------------------------------------------------------------------

describe("stableHash", () => {
  it("is deterministic and returns a uint32 for any string (property)", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const a = stableHash(s);
        const b = stableHash(s);
        // Determinism: the same input always hashes to the same value.
        expect(a).toBe(b);
        // uint32 range: integer in [0, 0xFFFFFFFF].
        expect(Number.isInteger(a)).toBe(true);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(0xffffffff);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Animal / accent color stability (Requirement 2.13, 2.14)
// ---------------------------------------------------------------------------

describe("pickAnimal / pickAccentColor stability", () => {
  it("returns the same animal and accent color across repeated calls", () => {
    const roleId = "role-runtime-executor";
    expect(pickAnimal(roleId)).toBe(pickAnimal(roleId));
    expect(pickAccentColor(roleId)).toBe(pickAccentColor(roleId));
  });

  it("produces identical animal/accentColor/position per roleId across factory runs", () => {
    const rolePhases: Record<string, RolePhase> = {
      "intake-coordinator": "acting",
      "repository-analyst": "thinking",
      "role-quality-auditor": "reviewing",
    };

    const first = createBlueprintRuntimeSceneData(makeFactoryInput({ rolePhases }));
    const second = createBlueprintRuntimeSceneData(makeFactoryInput({ rolePhases }));

    const byRole = (data: typeof first) =>
      Object.fromEntries(data.agents.map((a) => [a.roleId, a]));

    const firstByRole = byRole(first);
    const secondByRole = byRole(second);

    for (const roleId of Object.keys(rolePhases)) {
      expect(secondByRole[roleId].animal).toBe(firstByRole[roleId].animal);
      expect(secondByRole[roleId].accentColor).toBe(firstByRole[roleId].accentColor);
      expect(secondByRole[roleId].position).toEqual(firstByRole[roleId].position);
    }
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Grid position distinctness (Requirement 4.7)
// ---------------------------------------------------------------------------

describe("assignRuntimeRoleSlots grid distinctness", () => {
  it("places 5 same-zone roles at pairwise-distinct positions", () => {
    const roleIds = ["analyst-1", "analyst-2", "analyst-3", "analyst-4", "analyst-5"];

    // Sanity: all 5 ids classify into the same (repository) zone. The tidy
    // centred-grid layout still gives each role its own cell (no two roles
    // share a grid position), even when they belong to the same zone.
    for (const id of roleIds) {
      expect(classifyZone(id)).toBe("repository");
    }

    const slots = assignRuntimeRoleSlots(roleIds);
    expect(slots.size).toBe(roleIds.length);

    const positionKeys = new Set(
      [...slots.values()].map((slot) => JSON.stringify(slot.position))
    );
    expect(positionKeys.size).toBe(roleIds.length);
  });
});

// ---------------------------------------------------------------------------
// Empty-state factory output (Requirement 1.1-1.6)
// ---------------------------------------------------------------------------

describe("createBlueprintRuntimeSceneData empty state", () => {
  it("returns no agents, no lines, and a visible bilingual empty hint", () => {
    const data = createBlueprintRuntimeSceneData(makeFactoryInput({ rolePhases: {} }));

    expect(data.agents).toEqual([]);
    expect(data.connectionLines).toEqual([]);
    expect(data.emptyHint.visible).toBe(true);
    expect(data.emptyHint.text).toContain("等待任务启动");
    expect(data.emptyHint.text).toContain("Waiting for task");
  });
});

// ---------------------------------------------------------------------------
// One agent per roleId + phase visuals + replay timing (Requirement 2.x, 6.x)
// ---------------------------------------------------------------------------

describe("createBlueprintRuntimeSceneData agents", () => {
  it("emits one agent per roleId with phase-tier visuals", () => {
    const rolePhases: Record<string, RolePhase> = {
      "role-x-acting": "acting",
      "role-y-completed": "completed",
    };

    const data = createBlueprintRuntimeSceneData(makeFactoryInput({ rolePhases }));

    expect(data.agents).toHaveLength(2);
    expect(data.emptyHint.visible).toBe(false);

    for (const agent of data.agents) {
      const phase = rolePhases[agent.roleId];
      const expected = phaseTierVisuals(phaseTierOf(phase));
      expect(agent.emissive).toBe(expected.emissive);
      expect(agent.opacity).toBe(expected.opacity);
      expect(agent.amplitude).toBe(expected.amplitude);
    }
  });

  it("applies a colorOverride for a failed phase", () => {
    const rolePhases: Record<string, RolePhase> = {
      "role-x-failed": "failed",
    };

    const data = createBlueprintRuntimeSceneData(makeFactoryInput({ rolePhases }));
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].colorOverride).toBe(
      phaseTierVisuals(phaseTierOf("failed")).colorOverride
    );
    expect(data.agents[0].colorOverride).toBeTruthy();
  });

  it("uses 333ms enter duration in replay and 500ms otherwise", () => {
    const rolePhases: Record<string, RolePhase> = { "role-x-acting": "acting" };

    const replay = createBlueprintRuntimeSceneData(
      makeFactoryInput({ rolePhases, isReplay: true })
    );
    const live = createBlueprintRuntimeSceneData(
      makeFactoryInput({ rolePhases, isReplay: false })
    );

    expect(replay.agents[0].enterDurationMs).toBe(333);
    expect(live.agents[0].enterDurationMs).toBe(500);
  });

  it("prefers runtime role display labels over static role type labels", () => {
    const data = createBlueprintRuntimeSceneData(
      makeFactoryInput({
        rolePhases: { "role-quality-auditor": "acting" },
        roleLabels: { "role-quality-auditor": "安全合规审计专家" },
      })
    );

    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].label).toBe("安全合规审计专家");
  });

  it("keeps the canonical full label when runtime label is a raw id or shorter type", () => {
    const data = createBlueprintRuntimeSceneData(
      makeFactoryInput({
        rolePhases: {
          "role-quality-auditor": "acting",
          "spec-architect": "acting",
        },
        roleLabels: {
          "role-quality-auditor": "审计者",
          "spec-architect": "spec-architect",
        },
      })
    );

    expect(data.agents.find(agent => agent.roleId === "role-quality-auditor")?.label).toBe(
      "Quality Auditor"
    );
    expect(data.agents.find(agent => agent.roleId === "spec-architect")?.label).toBe(
      "Spec Architect"
    );
  });

  it("uses the English canonical name for seeded roles without runtime labels", () => {
    const data = createBlueprintRuntimeSceneData(
      makeFactoryInput({
        rolePhases: { "repository-analyst": "acting" },
      })
    );

    expect(data.agents[0].label).toBe("Repository Analyst");
  });
});

// ---------------------------------------------------------------------------
// Stage-role seeding + merge precedence + empty-vs-seeded distinction
// (Requirements 1.1-1.7, 11.1-11.11; design.md "Stage-role seeding (Fix 2)")
// ---------------------------------------------------------------------------

describe("deriveStageSeedRolePhases", () => {
  it("seeds intake-coordinator (activated) for the input stage", () => {
    expect(deriveStageSeedRolePhases("input")).toEqual({
      "intake-coordinator": "activated",
    });
  });

  it("seeds intake-coordinator + product-strategist for clarification", () => {
    expect(deriveStageSeedRolePhases("clarification")).toEqual({
      "intake-coordinator": "activated",
      "product-strategist": "activated",
    });
  });

  it("seeds product-strategist + repository-analyst for route_generation", () => {
    expect(deriveStageSeedRolePhases("route_generation")).toEqual({
      "product-strategist": "activated",
      "repository-analyst": "activated",
    });
  });

  it("seeds repository-analyst + spec-architect + role-quality-auditor for spec_tree", () => {
    expect(deriveStageSeedRolePhases("spec_tree")).toEqual({
      "repository-analyst": "activated",
      "spec-architect": "activated",
      "role-quality-auditor": "activated",
    });
  });

  it("returns an empty seed for undefined or non-seeded stages", () => {
    expect(deriveStageSeedRolePhases(undefined)).toEqual({});
    // `preview` is a real but non-seeded stage value.
    expect(deriveStageSeedRolePhases("preview")).toEqual({});
  });
});

describe("createBlueprintRuntimeSceneData stage-seed merge precedence", () => {
  it("lets real rolePhases override seeded phases per roleId while seeded roles remain", () => {
    // spec_tree seeds repository-analyst + spec-architect + role-quality-auditor
    // (all "activated"). A real failed phase for repository-analyst must win.
    const data = createBlueprintRuntimeSceneData(
      makeFactoryInput({
        activeStage: "spec_tree",
        rolePhases: { "repository-analyst": "failed" },
      })
    );

    // Three agents: one real-overridden + two still-seeded.
    expect(data.agents).toHaveLength(3);
    expect(data.emptyHint.visible).toBe(false);

    const byRole = Object.fromEntries(
      data.agents.map((a) => [a.roleId, a])
    );

    // Real "failed" overrides the seeded "activated".
    const analyst = byRole["repository-analyst"];
    expect(analyst).toBeDefined();
    expect(analyst.phaseTier).toBe("failed");
    expect(analyst.colorOverride).toBe(
      phaseTierVisuals(phaseTierOf("failed")).colorOverride
    );
    expect(analyst.colorOverride).toBeTruthy();

    // Seeded-but-not-yet-real roles stay at the main (activated) tier.
    expect(byRole["spec-architect"].phaseTier).toBe("main");
    expect(byRole["role-quality-auditor"].phaseTier).toBe("main");
  });
});

describe("createBlueprintRuntimeSceneData empty-vs-seeded distinction", () => {
  it("renders the empty hint when activeStage is undefined and rolePhases empty", () => {
    const data = createBlueprintRuntimeSceneData(
      makeFactoryInput({ activeStage: undefined, rolePhases: {} })
    );

    expect(data.agents).toEqual([]);
    expect(data.connectionLines).toEqual([]);
    expect(data.emptyHint.visible).toBe(true);
  });

  it("renders exactly one seeded agent (no hint) when a stage is active but rolePhases empty", () => {
    const data = createBlueprintRuntimeSceneData(
      makeFactoryInput({ activeStage: "input", rolePhases: {} })
    );

    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].roleId).toBe("intake-coordinator");
    expect(data.emptyHint.visible).toBe(false);
  });
});

describe("createBlueprintRuntimeSceneData seeded role zone classification", () => {
  it("classifies the spec_tree seeded roles into repository/architect/quality zones", () => {
    const data = createBlueprintRuntimeSceneData(
      makeFactoryInput({ activeStage: "spec_tree", rolePhases: {} })
    );

    expect(data.agents).toHaveLength(3);

    const zoneByRole = Object.fromEntries(
      data.agents.map((a) => [a.roleId, a.zone])
    );

    expect(zoneByRole["repository-analyst"]).toBe("repository");
    expect(zoneByRole["spec-architect"]).toBe("architect");
    expect(zoneByRole["role-quality-auditor"]).toBe("quality");
  });
});
