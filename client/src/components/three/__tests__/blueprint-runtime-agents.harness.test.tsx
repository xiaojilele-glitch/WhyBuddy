/**
 * whybuddy-3d-real-role-driven-scene-2026-05-29 — Task 20
 *
 * Blueprint runtime component harness tests (P1-P10). Built entirely on the
 * Task-19 helper at `./__helpers__/blueprint-harness`, following its documented
 * SSR-no-effects constraint and `vi.mock` wiring pattern EXACTLY.
 *
 * Assertion-surface split (see the helper's module doc):
 *   - SSR markup (`renderBlueprintMarkup`): P1 empty-state hint only — the
 *     effect-gated agent list / connection lines never appear in SSR markup.
 *   - PURE factory (`buildSceneData` / re-exports): P2 single role, P3 8-zone
 *     layout + stability, P4 phase tiers, P6 replay timing, P8 label parity.
 *   - PURE priority chain (`deriveConnectionLines`): P7 line priority,
 *     P9 undirected flags.
 *   - SOURCE read: P5 mission-first shell switching (PetWorkers.tsx) and
 *     P10 Scene3D DOM marker (Scene3D.tsx), mirroring the right-rail
 *     `RoleStatusStrip.test.tsx` source-read pattern. Both are documented
 *     inline as deliberate choices over SSR-rendering the heavy shells.
 *
 * Acceptance: Requirements 9.7, 9.8.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_LOCALE } from "@/lib/locale";
import { resolveRoleLabel } from "@/pages/autopilot/right-rail/role-labels";

// ─── vi.mock wiring (hoisted; factories live in the Task-19 helper) ─────────
// `vi.mock` is hoisted above imports and its factory may not close over
// top-level imports, so each factory is an async dynamic import of the helper's
// statically-analyzable mock factory functions (the documented Vitest pattern).
vi.mock("@react-three/fiber", async () =>
  (await import("./__helpers__/blueprint-harness")).fiberModuleMock()
);
vi.mock("@react-three/drei", async () =>
  (await import("./__helpers__/blueprint-harness")).dreiModuleMock()
);
vi.mock("@/lib/blueprint-realtime-store", async () =>
  (await import("./__helpers__/blueprint-harness")).blueprintStoreModuleMock()
);

import {
  buildSceneData,
  deriveConnectionLines,
  displayLabel,
  phaseTierOf,
  phaseTierVisuals,
  renderBlueprintMarkup,
  resetBlueprintHarness,
  setMockedRolePhases,
  type BlueprintConnectionLine,
  type BlueprintObservedPhaseEvent,
  type BlueprintRelayedEvent,
  type FunctionalZone,
  type RolePhase,
} from "./__helpers__/blueprint-harness";

// ---------------------------------------------------------------------------
// Shared builders
// ---------------------------------------------------------------------------

const NOW = 1_000_000;

function handoffEvent(
  fromRoleId: string,
  toRoleId: string,
  timestamp: number
): BlueprintRelayedEvent {
  return {
    type: "mission.handoff",
    jobId: "harness-job",
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

/** Serialize a position tuple to a stable key for distinctness checks. */
function posKey(position: readonly [number, number, number]): string {
  return position.join(",");
}

beforeEach(() => {
  resetBlueprintHarness();
  vi.clearAllMocks();
});

afterEach(() => {
  resetBlueprintHarness();
});

// ===========================================================================
// P1 — empty blueprint state (SSR markup + pure factory)
// ===========================================================================

describe("P1 empty blueprint state", () => {
  it("renders only the bilingual empty-state hint in SSR markup", async () => {
    setMockedRolePhases({});

    const markup = await renderBlueprintMarkup({});

    expect(markup).toContain('data-testid="blueprint-empty-hint"');
    expect(markup).toContain("等待任务启动");
    expect(markup).toContain("Waiting for task");
  });

  it("pure factory reports zero agents and a visible empty hint", () => {
    setMockedRolePhases({});

    const data = buildSceneData();

    expect(data.agents).toEqual([]);
    expect(data.emptyHint.visible).toBe(true);
  });

  it("source-level: connection re-derivation uses seeded effective role phases", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../BlueprintRuntimeAgents.tsx"),
      "utf8"
    );
    const rederiveStart = source.indexOf("const rederive = () => {");
    const rederiveEnd = source.indexOf(
      "// Derive immediately so newly-mounted scenes don't wait a full interval.",
      rederiveStart
    );
    const rederiveBody = source.slice(rederiveStart, rederiveEnd);

    expect(source).toMatch(/deriveStageSeedRolePhases/);
    expect(rederiveBody).toMatch(/effectiveRolePhasesForLines/);
    expect(rederiveBody).toMatch(
      /Object\.keys\(effectiveRolePhasesForLines\)\.length\s*===\s*0/
    );
    expect(rederiveBody).not.toMatch(
      /Object\.keys\(rolePhases\)\.length\s*===\s*0/
    );
    expect(rederiveBody).toMatch(/rolePhases:\s*effectiveRolePhasesForLines/);
    expect(rederiveBody).toMatch(/connectionLinesRef\.current\s*=\s*\[\]/);
    expect(rederiveBody).toMatch(/connectionLinesKeyRef\.current\s*=\s*""/);
    expect(rederiveBody).toMatch(/sceneSnapshotRef\.current\s*=\s*\{/);
    expect(rederiveBody).toMatch(/connectionLines:\s*\[\]/);
    expect(rederiveBody).toMatch(/setConnectionLines\(\[\]\)/);
    expect(rederiveBody).toMatch(/return\s*;/);
  });
});

// ===========================================================================
// P2 — single role (pure factory)
// ===========================================================================

describe("P2 single role", () => {
  it("emits exactly one agent with the expected zone, label, and live enter duration", () => {
    const data = buildSceneData({
      rolePhases: { "intake-coordinator": "acting" },
    });

    expect(data.agents).toHaveLength(1);
    const agent = data.agents[0];
    expect(agent.zone).toBe("intake");
    // The 3D nameplate shows a full bilingual label for known roles, never the
    // raw id or a short type-only chip label.
    expect(agent.label).toBe("Intake Coordinator");
    expect(agent.label).not.toBe("intake-coordinator");
    expect(agent.enterDurationMs).toBe(500);
  });
});

// ===========================================================================
// P3 — multi-role 8-zone layout (pure factory)
// ===========================================================================

describe("P3 multi-role 8-zone layout", () => {
  // One role per functional zone; `totally-unknown-xyz` falls through to standby.
  const rolePhases: Record<string, RolePhase> = {
    "intake-coordinator": "acting",
    "repository-analyst": "acting",
    "spec-architect": "acting",
    "role-runtime-executor": "acting",
    "role-quality-auditor": "acting",
    "role-memory-curator": "acting",
    "role-experience-presenter": "acting",
    "totally-unknown-xyz": "acting",
  };

  const expectedZoneByRoleId: Record<string, FunctionalZone> = {
    "intake-coordinator": "intake",
    "repository-analyst": "repository",
    "spec-architect": "architect",
    "role-runtime-executor": "runtime",
    "role-quality-auditor": "quality",
    "role-memory-curator": "memory",
    "role-experience-presenter": "experience",
    "totally-unknown-xyz": "standby",
  };

  it("places one agent per zone with the expected zone classification", () => {
    const data = buildSceneData({ rolePhases });

    expect(data.agents).toHaveLength(8);
    for (const agent of data.agents) {
      expect(agent.zone).toBe(expectedZoneByRoleId[agent.roleId]);
    }
  });

  it("assigns pairwise-distinct positions across the 8 zones", () => {
    const data = buildSceneData({ rolePhases });

    const keys = data.agents.map((agent) => posKey(agent.position));
    expect(new Set(keys).size).toBe(8);
  });

  it("produces identical positions for the same input (stability)", () => {
    const first = buildSceneData({ rolePhases });
    const second = buildSceneData({ rolePhases });

    const firstByRole = new Map(
      first.agents.map((agent) => [agent.roleId, posKey(agent.position)])
    );
    for (const agent of second.agents) {
      expect(posKey(agent.position)).toBe(firstByRole.get(agent.roleId));
    }
  });
});

// ===========================================================================
// P4 — phase transitions (pure factory vs phaseTierVisuals/phaseTierOf)
// ===========================================================================

describe("P4 phase transitions", () => {
  const phases: RolePhase[] = [
    "acting",
    "observing",
    "completed",
    "idle",
    "failed",
  ];

  it.each(phases)(
    "maps phase %s to phaseTierVisuals(phaseTierOf(phase))",
    (phase) => {
      const data = buildSceneData({ rolePhases: { "role-x": phase } });
      expect(data.agents).toHaveLength(1);

      const agent = data.agents[0];
      const visuals = phaseTierVisuals(phaseTierOf(phase));
      expect(agent.emissive).toBe(visuals.emissive);
      expect(agent.opacity).toBe(visuals.opacity);
      expect(agent.amplitude).toBe(visuals.amplitude);
    }
  );

  it("applies a truthy color override for the failed phase", () => {
    const data = buildSceneData({ rolePhases: { "role-x": "failed" } });
    expect(data.agents[0].colorOverride).toBeTruthy();
  });

  it("source-level: active opaque agents do not force transparent material rendering", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../BlueprintRuntimeAgents.tsx"),
      "utf8"
    );

    expect(source).toMatch(/const shouldRenderTransparent/);
    expect(source).toMatch(/mesh\.renderOrder\s*=\s*BLUEPRINT_AGENT_RENDER_ORDER/);
    expect(source).toMatch(/mat\.transparent\s*=\s*shouldRenderTransparent/);
    expect(source).toMatch(/mat\.depthWrite\s*=\s*!shouldRenderTransparent/);
    expect(source).toMatch(/mat\.depthTest\s*=\s*true/);
    expect(source).not.toMatch(/mat\.transparent\s*=\s*true/);
  });

  it("source-level: pet body material is never dyed (no color/emissive writes in RuntimeAgent)", async () => {
    // Kenney Cube Pets ship with their own authoritative material colors. The
    // role accentColor / phase colorOverride are for non-body accents only
    // (lines / chips / rings). This guard prevents a future regression that
    // re-dyes the GLB body (the rejected "发光蒙层"). Rather than matching only
    // the literal `agent.accentColor` write (which an alias like
    // `const tint = agent.accentColor; mat.color.set(tint)` would slip past),
    // we slice the RuntimeAgent function body and assert it contains NO body
    // material color / emissive write of ANY kind.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../BlueprintRuntimeAgents.tsx"),
      "utf8"
    );

    // Extract the FULL RuntimeAgent function body via brace matching (a regex
    // slice to "the next const/function" is too shallow — it can truncate at
    // `const { scene } = useGLTF(...)` BEFORE the material loop, making the
    // guard hollow). RuntimeAgent's params are themselves destructured objects
    // (`({ agent, ... }: { ... })`), so we first walk the parameter parens to
    // their match, THEN take the body `{` after the `)` and brace-match it.
    const startIdx = source.indexOf("function RuntimeAgent(");
    expect(startIdx).toBeGreaterThan(-1);
    const parenOpen = source.indexOf("(", startIdx);
    expect(parenOpen).toBeGreaterThan(-1);
    let parenDepth = 0;
    let parenClose = -1;
    for (let i = parenOpen; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(") parenDepth++;
      else if (ch === ")") {
        parenDepth--;
        if (parenDepth === 0) {
          parenClose = i;
          break;
        }
      }
    }
    expect(parenClose).toBeGreaterThan(parenOpen);

    const braceOpen = source.indexOf("{", parenClose);
    expect(braceOpen).toBeGreaterThan(-1);
    let depth = 0;
    let endIdx = -1;
    for (let i = braceOpen; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    expect(endIdx).toBeGreaterThan(braceOpen);
    const runtimeAgentBody = source.slice(braceOpen, endIdx + 1);

    // Sanity: the slice MUST reach the material loop, otherwise the guard is
    // hollow. Assert a known token from the end-of-function body loop is present.
    expect(runtimeAgentBody).toMatch(/mat\.transparent\s*=\s*shouldRenderTransparent/);

    // No body material color writes (assignment OR .set()/.copy()) of any kind.
    expect(runtimeAgentBody).not.toMatch(/\.color\s*=/);
    expect(runtimeAgentBody).not.toMatch(/\.color\.set\(/);
    expect(runtimeAgentBody).not.toMatch(/\.color\.copy\(/);
    // No body emissive writes (assignment OR .set()/.copy()) of any kind.
    expect(runtimeAgentBody).not.toMatch(/\.emissive\s*=/);
    expect(runtimeAgentBody).not.toMatch(/\.emissive\.set\(/);
    expect(runtimeAgentBody).not.toMatch(/\.emissive\.copy\(/);
    expect(runtimeAgentBody).not.toMatch(/\.emissiveIntensity\s*=/);
    // The body loop tunes only roughness/metalness (no-op envMap removed).
    expect(runtimeAgentBody).toMatch(/mat\.roughness\s*=/);
  });

  it("source-level: the role workstation preserves Kenney furniture colors (no retheme repaint)", async () => {
    // The desk / monitor / keyboard / mouse / lamp / books keep their
    // authoritative Kenney GLB colors. WorkstationModel must use the
    // body-color LOCK helper (preserveKenneyFurnitureMaterial), NOT the cold-
    // office repaint (rethemeFurnitureMaterial).
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../BlueprintRuntimeAgents.tsx"),
      "utf8"
    );
    expect(source).toMatch(/preserveKenneyFurnitureMaterial\(material, mesh\.name, url\)/);
    expect(source).not.toMatch(/rethemeFurnitureMaterial/);
  });

  it("source-level: desk body and desktop props use independent right offsets", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../BlueprintRuntimeAgents.tsx"),
      "utf8"
    );

    expect(source).toMatch(/const DESK_RIGHT_OFFSET_X\s*=\s*0\.7/);
    expect(source).toMatch(/const DESKTOP_PROPS_RIGHT_OFFSET_X\s*=\s*0\.2/);
    expect(source).toMatch(/url=\{FURNITURE_MODELS\.desk\}[\s\S]*position=\{\[-DESK_RIGHT_OFFSET_X, 0, 0\]\}/);
    expect(source).toMatch(/url=\{FURNITURE_MODELS\.computerScreen\}[\s\S]*- DESKTOP_PROPS_RIGHT_OFFSET_X/);
    expect(source).toMatch(/url=\{FURNITURE_MODELS\.computerKeyboard\}[\s\S]*- DESKTOP_PROPS_RIGHT_OFFSET_X/);
    expect(source).toMatch(/url=\{FURNITURE_MODELS\.computerMouse\}[\s\S]*- DESKTOP_PROPS_RIGHT_OFFSET_X/);
    expect(source).not.toMatch(/agent\.position\[0\]\s*\+\s*DESK_RIGHT_OFFSET_X/);
    expect(source).toMatch(/<RuntimeAgent[\s\S]*agent=\{agent\}[\s\S]*locale=\{locale\}/);
    expect(source).toMatch(/<RoleCapabilityChips[\s\S]*position=\{agent\.position\}/);
    expect(source).toMatch(/<RoleWorkstation key=\{`desk-\$\{agent\.roleId\}`\} position=\{agent\.position\}/);
  });

  it("source-level: the nameplate icon row consumes agent.accentColor (non-body accent is wired)", async () => {
    // accentColor must be a REAL non-body accent consumer, not just a snapshot
    // field. The role-type icon row tints from agent.accentColor (with the
    // failed colorOverride taking precedence), so the spec contract — accent
    // color drives nameplate icon / accents, never the body — is actually true.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../BlueprintRuntimeAgents.tsx"),
      "utf8"
    );
    expect(source).toMatch(/agent\.colorOverride\s*\?\?\s*agent\.accentColor/);
  });

  it("source-level: blueprint stage HUD is compact and does not use the old large card shell", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../SceneStageFlow.tsx"),
      "utf8"
    );

    expect(source).toContain('data-testid="blueprint-stage-hud-compact"');
    expect(source).toMatch(/max-w-\[180px\]/);
    expect(source).toMatch(/h-0\.5/);
    expect(source).not.toContain("min-w-[160px] max-w-[220px]");
    expect(source).not.toContain("px-4 py-3 text-center");
    expect(source).not.toContain("shadow-[0_14px_34px_rgba(2,6,23,0.4)]");
  });

  it("source-level: stage zone focus no longer renders a floating tooltip", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../SceneStageFlow.tsx"),
      "utf8"
    );

    expect(source).not.toContain("getSceneZoneLabel");
    expect(source).not.toContain("position={[0, 0.75, 0]}");
    expect(source).not.toContain("rounded-full border border-white/15 bg-slate-950/75 px-3 py-1");
  });
});

// ===========================================================================
// Kenney furniture body-color lock (scene-theme preserve helper)
// ===========================================================================

describe("preserveKenneyFurnitureMaterial", () => {
  it("never writes a body material.color, only roughness/metalness + screen/lamp emissive", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../../lib/scene-theme.ts"),
      "utf8"
    );

    // Slice the preserveKenneyFurnitureMaterial function body.
    const startIdx = source.indexOf(
      "export function preserveKenneyFurnitureMaterial("
    );
    expect(startIdx).toBeGreaterThan(-1);
    const afterStart = source.slice(startIdx);
    const nextFnIdx = afterStart.slice(1).search(/\nexport function\s/);
    const body =
      nextFnIdx === -1 ? afterStart : afterStart.slice(0, nextFnIdx + 1);

    // No body color writes of any kind (the whole point of the lock).
    expect(body).not.toMatch(/\.color\.set\(/);
    expect(body).not.toMatch(/setColor\(/);
    // Allowed: roughness / metalness tuning.
    expect(body).toMatch(/\.roughness\s*=/);
    expect(body).toMatch(/\.metalness\s*=/);
    // Allowed exception: screen / lamp emissive only.
    expect(body).toMatch(/screen/);
    expect(body).toMatch(/emissive/);
  });
});

// ===========================================================================
// P5 — mission-first shell regression (source read)
// ===========================================================================

describe("P5 mission-first shell regression", () => {
  // Choice: SOURCE-LEVEL read of PetWorkers.tsx (mirrors RoleStatusStrip.test.tsx).
  // SSR-rendering <PetWorkers mode="mission-first"> would drag in MissionFirstAgents'
  // large dependency graph (workflow-store / project-store / agent-config / role-id
  // bridge), which is far less robust than asserting the shell's mode-switching
  // contract directly from source: BlueprintRuntimeAgents mounts ONLY for
  // mode === "blueprint", MissionFirstAgents for every other mode.
  it("mounts BlueprintRuntimeAgents only for mode === \"blueprint\" and MissionFirstAgents otherwise", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const rawSource = await fs.readFile(
      path.resolve(__dirname, "../PetWorkers.tsx"),
      "utf8"
    );

    // Strip block + line comments first: PetWorkers.tsx's header comment block
    // documents the same `<BlueprintRuntimeAgents>` / `<MissionFirstAgents>`
    // contract in prose, which would otherwise pollute the JSX-level match.
    const source = rawSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    const guardIdx = source.indexOf('if (mode === "blueprint")');
    const blueprintIdx = source.indexOf("<BlueprintRuntimeAgents");
    const missionFirstIdx = source.indexOf("<MissionFirstAgents");

    // Each shell is mounted exactly once in the real JSX.
    expect((source.match(/<BlueprintRuntimeAgents\b/g) ?? []).length).toBe(1);
    expect((source.match(/<MissionFirstAgents\b/g) ?? []).length).toBe(1);

    // BlueprintRuntimeAgents is mounted only inside the `mode === "blueprint"`
    // guard, and that guard precedes its mount.
    expect(guardIdx).toBeGreaterThan(-1);
    expect(blueprintIdx).toBeGreaterThan(guardIdx);

    // MissionFirstAgents is the fallthrough (non-blueprint) return, after the
    // blueprint branch's mount.
    expect(missionFirstIdx).toBeGreaterThan(blueprintIdx);
  });
});

// ===========================================================================
// P6 — replay timing (pure factory)
// ===========================================================================

describe("P6 replay timing", () => {
  // The shared-role no-reanimation across a job switch is a component-internal
  // lifecycle concern (seenRoleIdsByJobId ref diff) and is NOT SSR-observable;
  // it is covered by the component's reconcile logic. Here we assert the timing
  // INPUT the factory bakes into each agent.
  it("bakes the 333ms replay enter duration when isReplay is true", () => {
    const data = buildSceneData({
      rolePhases: { "role-x": "acting" },
      isReplay: true,
    });
    expect(data.agents[0].enterDurationMs).toBe(333);
  });

  it("bakes the 500ms live enter duration when isReplay is false", () => {
    const data = buildSceneData({
      rolePhases: { "role-x": "acting" },
      isReplay: false,
    });
    expect(data.agents[0].enterDurationMs).toBe(500);
  });
});

// ===========================================================================
// P7 — connection-line priority (pure priority chain)
// ===========================================================================

describe("P7 connection-line priority", () => {
  it("(a) returns a single directed event-from-to line for a fresh handoff event", () => {
    const lines = deriveConnectionLines({
      handoffEvents: [handoffEvent("role-a", "role-b", NOW)],
      phaseEvents: [],
      rolePhases: {},
      now: NOW,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual<BlueprintConnectionLine>({
      from: "role-a",
      to: "role-b",
      directed: true,
      source: "event-from-to",
    });
  });

  it("(b) returns a single undirected heuristic line for acting→thinking within 2000ms", () => {
    const t = NOW - 5_000;
    const lines = deriveConnectionLines({
      handoffEvents: [],
      phaseEvents: [
        phaseEvent("role-a", "acting", t),
        phaseEvent("role-b", "thinking", t + 1_000),
      ],
      rolePhases: {},
      now: NOW,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual<BlueprintConnectionLine>({
      from: "role-a",
      to: "role-b",
      directed: false,
      source: "heuristic",
    });
  });

  it("(c) returns two undirected stage-rule lines for spec_tree", () => {
    const lines = deriveConnectionLines({
      handoffEvents: [],
      phaseEvents: [],
      rolePhases: {
        "x-analyst": "idle",
        "y-architect": "idle",
        "z-auditor": "idle",
      },
      activeStage: "spec_tree",
      now: NOW,
    });

    expect(lines).toHaveLength(2);
    expect(lines).toEqual<BlueprintConnectionLine[]>([
      { from: "x-analyst", to: "y-architect", directed: false, source: "stage-rule" },
      { from: "y-architect", to: "z-auditor", directed: false, source: "stage-rule" },
    ]);
  });

  it("(d) returns no lines when there is no evidence", () => {
    const lines = deriveConnectionLines({
      handoffEvents: [],
      phaseEvents: [],
      rolePhases: {},
      activeStage: undefined,
      now: NOW,
    });

    expect(lines).toEqual([]);
  });
});

// ===========================================================================
// P8 — label parity (pure displayLabel vs resolveRoleLabel)
// ===========================================================================

describe("P8 label parity", () => {
  it("source-level: renders nameplates as type row plus name row without type/name prefixing", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../BlueprintRuntimeAgents.tsx"),
      "utf8"
    );

    expect(source).toMatch(/const ROLE_TYPE_META/);
    expect(source).toMatch(/RoleTypeIcon/);
    expect(source).toMatch(/roleTypeLabel/);
    expect(source).toMatch(/shouldShowRoleTypeText/);
    expect(source).toMatch(/showRoleTypeText/);
    expect(source).toMatch(/flex-col/);
    expect(source).toMatch(/whitespace-nowrap/);
    expect(source).toMatch(/textOverflow: "ellipsis"/);
    expect(source).toMatch(/\{agent\.label\}/);
    expect(source).not.toMatch(/glass-3d flex min-w-\[132px\] max-w-\[220px\]/);
    expect(source).not.toMatch(/\{roleTypeLabel\}\s*\/\s*\{agent\.label\}/);
  });

  it("uses runtime role labels for the pure scene-data nameplate label", () => {
    const data = buildSceneData({
      rolePhases: { "role-quality-auditor": "acting" },
      roleLabels: { "role-quality-auditor": "安全合规审计专家" },
    });

    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].label).toBe("安全合规审计专家");
  });

  it("source-level: forwards runtime roleLabels through Scene3D and PetWorkers", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const [sceneSource, petWorkersSource] = await Promise.all([
      fs.readFile(path.resolve(__dirname, "../../Scene3D.tsx"), "utf8"),
      fs.readFile(path.resolve(__dirname, "../PetWorkers.tsx"), "utf8"),
    ]);

    expect(sceneSource).toMatch(/roleLabels\?: Record<string, string>/);
    expect(sceneSource).toMatch(/<PetWorkers[\s\S]*roleLabels=\{roleLabels\}/);
    expect(petWorkersSource).toMatch(/roleLabels\?: Record<string, string>/);
    expect(petWorkersSource).toMatch(
      /<BlueprintRuntimeAgents[\s\S]*roleLabels=\{roleLabels\}/
    );
  });

  it("matches resolveRoleLabel for a canonical id", () => {
    const canonical = "intake-analyst";
    expect(displayLabel(canonical, DEFAULT_LOCALE)).toBe(
      resolveRoleLabel(canonical, DEFAULT_LOCALE)
    );
  });

  it("strips the role- prefix and Title-Cases unknown role-* ids", () => {
    expect(displayLabel("role-foo-bar", DEFAULT_LOCALE)).toBe("Foo Bar");
  });

  it("passes through a non-role unknown id unchanged", () => {
    expect(displayLabel("totally-unknown", DEFAULT_LOCALE)).toBe(
      "totally-unknown"
    );
  });

  it("resolves a real autopilot id (no role- prefix) to its canonical full name", () => {
    // `repository-analyst` is a real autopilot job role id that does NOT carry
    // a `role-` prefix. Now that it is canonical, displayLabel must surface the
    // full human-readable name, never the raw machine id.
    const label = displayLabel("repository-analyst", DEFAULT_LOCALE);
    expect(label).not.toBe("repository-analyst");
    expect(label).toBe(resolveRoleLabel("repository-analyst", DEFAULT_LOCALE));
  });
});

// ===========================================================================
// P9 — undirected line flags (pure priority chain)
// ===========================================================================

describe("P9 undirected line flags", () => {
  it("marks every heuristic and stage-rule line undirected and non event-from-to", () => {
    const t = NOW - 5_000;
    const heuristicLines = deriveConnectionLines({
      handoffEvents: [],
      phaseEvents: [
        phaseEvent("role-a", "acting", t),
        phaseEvent("role-b", "thinking", t + 500),
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
      },
      activeStage: "spec_tree",
      now: NOW,
    });

    const allLines = [...heuristicLines, ...stageRuleLines];
    expect(allLines.length).toBeGreaterThan(0);
    for (const line of allLines) {
      expect(line.directed).toBe(false);
      expect(line.source).not.toBe("event-from-to");
    }
  });
});

// ===========================================================================
// P10 — Scene3D DOM marker (source read)
// ===========================================================================

describe("P10 Scene3D DOM marker", () => {
  // Choice: SOURCE-LEVEL read of Scene3D.tsx (mirrors the right-rail source-read
  // pattern). Scene3D pulls heavy R3F / drei / store deps; asserting the marker's
  // shape and placement from source is robust and avoids SSR-rendering the full
  // canvas tree. The marker must carry data-mode={mode} and sit adjacent to
  // (after) </Canvas>.
  it("renders the whybuddy-3d-shell marker with data-mode adjacent to </Canvas>", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../Scene3D.tsx"),
      "utf8"
    );

    // The marker exists, carries the active data-mode, and is the documented shape.
    expect(source).toMatch(
      /<div\s+data-testid="whybuddy-3d-shell"\s+data-mode=\{mode\}\s*\/>/
    );

    // It is a sibling AFTER the canvas close, never inside <Canvas>.
    const canvasCloseIdx = source.indexOf("</Canvas>");
    const markerIdx = source.indexOf('data-testid="whybuddy-3d-shell"');
    expect(canvasCloseIdx).toBeGreaterThan(-1);
    expect(markerIdx).toBeGreaterThan(canvasCloseIdx);
  });
});
