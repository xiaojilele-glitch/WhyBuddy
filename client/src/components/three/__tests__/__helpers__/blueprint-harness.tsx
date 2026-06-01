/**
 * whybuddy-3d-real-role-driven-scene-2026-05-29 — Task 19
 *
 * Server-render component harness helpers for the blueprint runtime scene.
 *
 * Why this module exists
 * ----------------------
 * The repository has Vitest + React but NO jsdom / happy-dom / Testing Library
 * and NO Vitest DOM project (see design.md "Testing Strategy" → "Component
 * Harness" and Requirement 9.1/9.6). The established right-rail test style is
 * `react-dom/server.renderToStaticMarkup` + `vi.mock` to stub stores, asserting
 * on the SSR markup string. Task 20's P1-P10 harness MUST follow the same
 * style. This module is the reusable scaffolding those tests import so each
 * `*.harness.test.tsx` stays small and DRY. It deliberately contains NO P1-P10
 * assertions — only mocks, store-driving helpers, a render helper, and
 * convenience re-exports of the pure functions.
 *
 * Hard SSR constraint you MUST design assertions around
 * ----------------------------------------------------
 * `renderToStaticMarkup` does NOT run `useEffect` or `useFrame`. Two practical
 * consequences for `BlueprintRuntimeAgents`:
 *
 *   1. The DEV scene bridge (`window.__whybuddy3dScene`) and the
 *      `subscribeBlueprintRealtimeEvents` subscription are installed inside
 *      effects, so they never attach under SSR. Drive the event path through
 *      the PURE data path instead — call `deriveConnectionLines(...)` /
 *      `createBlueprintRuntimeSceneData(...)` directly, or exercise the real
 *      observer with {@link subscribeRealtimeEvents} + {@link dispatchRealtimeEvent}.
 *   2. The rendered agent list (`renderAgents`) is React state populated by a
 *      reconcile EFFECT, so under SSR it stays empty and NO `<RuntimeAgent>`
 *      nameplates appear in the markup — even when `rolePhases` is non-empty.
 *      Only the empty-state hint (driven by the synchronous `useMemo` factory
 *      result) renders reliably under SSR.
 *
 * Therefore the assertion surfaces are split like this:
 *
 *   - SSR markup (`renderBlueprintMarkup`): use for P1 (empty hint present)
 *     and for confirming the empty-state path. The `data-testid="blueprint-empty-hint"`
 *     decal and its `等待任务启动...` / `Waiting for task...` text appear here.
 *   - PURE snapshot (`buildSceneData` / re-exported factory): use for P2
 *     (single role label), P3 (multi-role 8-zone layout), P4 (phase tiers via
 *     `phaseTierVisuals`/`phaseTierOf`) and label parity P8 (`displayLabel`).
 *     `buildSceneData().agents[i].label` is the same string a nameplate would
 *     show, so P2/P3 assert labels against the snapshot, not the markup.
 *   - PURE priority chain (`deriveConnectionLines`): use for P6 replay timing
 *     inputs, P7 connection-line priority, and P9 undirected-line flags.
 *   - Scene3D marker (P10): the `data-testid="whybuddy-3d-shell" data-mode`
 *     marker lives in `Scene3D.tsx` ADJACENT to `<Canvas>`. Assert it either
 *     by a source-level read of `Scene3D.tsx` (matching the right-rail mount
 *     tests) or by SSR-rendering `<Scene3D>` with these mocks; P5 (shell
 *     switching) is likewise a mounted-shell / source concern.
 *
 * vi.mock usage pattern (IMPORTANT)
 * ---------------------------------
 * `vi.mock` is hoisted above imports, and its factory may not close over
 * top-level imports. So the harness exposes plain factory functions that the
 * test passes to its own (statically analyzable) `vi.mock` calls via an async
 * dynamic import — the standard Vitest pattern:
 *
 * ```ts
 * import { renderToStaticMarkup } from "react-dom/server";
 * import { afterEach, describe, expect, it, vi } from "vitest";
 *
 * vi.mock("@react-three/fiber", async () =>
 *   (await import("./__helpers__/blueprint-harness")).fiberModuleMock());
 * vi.mock("@react-three/drei", async () =>
 *   (await import("./__helpers__/blueprint-harness")).dreiModuleMock());
 * vi.mock("@/lib/blueprint-realtime-store", async () =>
 *   (await import("./__helpers__/blueprint-harness")).blueprintStoreModuleMock());
 *
 * import {
 *   renderBlueprintMarkup,
 *   buildSceneData,
 *   setMockedRolePhases,
 *   resetBlueprintHarness,
 * } from "./__helpers__/blueprint-harness";
 * ```
 *
 * `three` is intentionally NOT mocked by default: the real `three` package is
 * pure JS and imports cleanly under the Vitest node environment, and the
 * effect-gated render path never touches a WebGL/canvas context under SSR.
 * `threeModuleMock()` is provided only as an optional escape hatch.
 *
 * Spec: .kiro/specs/whybuddy-3d-real-role-driven-scene-2026-05-29
 * Acceptance: Requirements 9.1, 9.6.
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { vi } from "vitest";

import { DEFAULT_LOCALE, type AppLocale } from "@/lib/locale";
import type {
  BlueprintRelayedEvent,
  RolePhase,
  RoleRuntimeState,
} from "@/lib/blueprint-realtime-store";
import type { BlueprintRuntimeAgentsProps } from "@/components/three/BlueprintRuntimeAgents";

// ---------------------------------------------------------------------------
// Convenience re-exports (pure, Three.js-free) — the PRIMARY assertion surface
// for P2/P3/P4/P6/P7/P8/P9 given the effect-gated SSR constraint above.
// ---------------------------------------------------------------------------

export {
  createBlueprintRuntimeSceneData,
  assignRuntimeRoleSlots,
  classifyZone,
  phaseTierOf,
  phaseTierVisuals,
  pickAnimal,
  pickAccentColor,
  stableHash,
} from "@/components/three/scene-fusion/blueprint-runtime-scene";

export type {
  BlueprintConnectionLine,
  BlueprintObservedPhaseEvent,
  BlueprintRuntimeAgent,
  BlueprintRuntimeSceneData,
  FunctionalZone,
  PhaseTier,
  ZoneSlot,
} from "@/components/three/scene-fusion/blueprint-runtime-scene";

export { deriveConnectionLines } from "@/components/three/scene-fusion/connection-line-priority";

export { displayLabel } from "@/components/three/scene-fusion/role-display-label";

export type {
  BlueprintRelayedEvent,
  RolePhase,
  RoleRuntimeState,
} from "@/lib/blueprint-realtime-store";

export type { BlueprintRuntimeAgentsProps } from "@/components/three/BlueprintRuntimeAgents";

import { createBlueprintRuntimeSceneData } from "@/components/three/scene-fusion/blueprint-runtime-scene";
import type {
  BlueprintObservedPhaseEvent,
  BlueprintRuntimeSceneData,
} from "@/components/three/scene-fusion/blueprint-runtime-scene";

// ---------------------------------------------------------------------------
// Mutable mocked store state (shared by the setters and the mocked selector)
// ---------------------------------------------------------------------------

let mockedRolePhases: Record<string, RolePhase> = {};
let mockedRoleRuntimeStates: Record<string, RoleRuntimeState> = {};

/** Snapshot shape exposed to selectors by the mocked `useBlueprintRealtimeStore`. */
interface MockStoreSnapshot {
  rolePhases: Record<string, RolePhase>;
  roleRuntimeStates: Record<string, RoleRuntimeState>;
}

/**
 * Replace the mocked `rolePhases`. The next `renderBlueprintMarkup(...)` and
 * `buildSceneData(...)` call observe the new value (mirrors `RoleStatusStrip`'s
 * `setMockedRolePhases`).
 */
export function setMockedRolePhases(next: Record<string, RolePhase>): void {
  mockedRolePhases = { ...next };
}

/** Replace the mocked `roleRuntimeStates`. */
export function setMockedRoleRuntimeStates(
  next: Record<string, RoleRuntimeState>
): void {
  mockedRoleRuntimeStates = { ...next };
}

/** Reset all mocked store slices back to empty. Call in `beforeEach`/`afterEach`. */
export function resetBlueprintHarness(): void {
  mockedRolePhases = {};
  mockedRoleRuntimeStates = {};
}

// ---------------------------------------------------------------------------
// @react-three/fiber mock factory
// ---------------------------------------------------------------------------

/**
 * Mock module for `@react-three/fiber`.
 *
 * - `useFrame` → no-op (it throws outside a real `<Canvas>` reconciler, so it
 *   MUST be stubbed for SSR rendering).
 * - `Canvas` → passthrough that renders its children (so an SSR-rendered
 *   `<Scene3D>` still emits its non-canvas DOM siblings, e.g. the P10 marker).
 * - `useThree` / `extend` → inert stubs in case a transitively-imported
 *   component touches them during render.
 */
export function fiberModuleMock() {
  const Canvas = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    useFrame: () => {},
    useThree: () => ({}),
    extend: () => {},
    Canvas,
  };
}

// ---------------------------------------------------------------------------
// @react-three/drei mock factory
// ---------------------------------------------------------------------------

/**
 * A minimal GLTF-like scene returned by the mocked `useGLTF`. Shaped just
 * enough that `RuntimeAgent`'s `scene.clone(true)` → real-`three`
 * `Box3.setFromObject(...)` → `traverse(...)` path stays non-throwing IF a
 * future caller renders agents (the default SSR path does not, because the
 * agent list is effect-gated). `traverse` is a no-op, so `Box3` stays empty
 * and the component's `Number.isFinite` guard falls back to `minY = 0`.
 */
function makeFakeGltfScene(): Record<string, unknown> {
  const makeNode = (): Record<string, unknown> => ({
    isMesh: false,
    castShadow: false,
    receiveShadow: false,
    material: undefined,
    position: { x: 0, y: 0, z: 0, set: () => {} },
    traverse: (_cb?: (child: unknown) => void) => {},
    updateWorldMatrix: (_a?: boolean, _b?: boolean) => {},
    clone: (_recursive?: boolean) => makeNode(),
  });
  return makeNode();
}

/**
 * Mock module for `@react-three/drei`.
 *
 * - `Html` → renders children inside a plain `<div data-mock="drei-html">` so
 *   in-scene text (nameplates, the empty-state hint) becomes assertable SSR
 *   markup instead of requiring a portal/WebGL context.
 * - `Line` → a `<div data-mock="drei-line">` stub that captures the line props
 *   as data attributes. NOTE: connection lines are effect-derived + state-gated,
 *   so they do not appear under SSR; assert line behavior via the re-exported
 *   `deriveConnectionLines` instead. This stub only keeps the module importable.
 * - `useGLTF` (+ `.preload` / `.clear`) → returns {@link makeFakeGltfScene}; no
 *   network/loader access.
 * - `ContactShadows` → `null` (used by `Scene3D`, harmless under SSR).
 */
export function dreiModuleMock() {
  const Html = ({ children }: { children?: ReactNode }) => (
    <div data-mock="drei-html">{children}</div>
  );

  const Line = (props: Record<string, unknown>) => (
    <div
      data-mock="drei-line"
      data-directed={String(props.directed ?? "")}
      data-color={String(props.color ?? "")}
      data-line-width={String(props.lineWidth ?? "")}
    />
  );

  const useGLTF = Object.assign(
    (_url?: string) => ({ scene: makeFakeGltfScene() }),
    {
      preload: (_url?: string) => {},
      clear: (_url?: string) => {},
    }
  );

  const ContactShadows = () => null;

  return { Html, Line, useGLTF, ContactShadows };
}

// ---------------------------------------------------------------------------
// three mock factory (OPTIONAL — real `three` imports cleanly; prefer not to)
// ---------------------------------------------------------------------------

/**
 * Optional minimal `three` stub. The real `three` package is pure JS and
 * imports/works under the Vitest node environment, and the SSR render path is
 * effect-gated so it never builds real scene objects — so this is normally
 * UNNECESSARY. Provided only as an escape hatch if a future render path begins
 * constructing `three` objects synchronously during render and that proves
 * problematic. If you reach for this, remember `vi.mock("three", ...)` will
 * also affect the pure scene helpers only insofar as they import `three`
 * (they do not).
 */
export function threeModuleMock() {
  class Vector3 {
    x = 0;
    y = 0;
    z = 0;
    set() {
      return this;
    }
    clone() {
      return new Vector3();
    }
    sub() {
      return this;
    }
    add() {
      return this;
    }
    addScaledVector() {
      return this;
    }
    normalize() {
      return this;
    }
    length() {
      return 0;
    }
    copy() {
      return this;
    }
  }
  class Color {
    constructor(_value?: unknown) {}
    copy() {
      return this;
    }
  }
  class Quaternion {
    setFromUnitVectors() {
      return this;
    }
  }
  class Box3 {
    min = { x: 0, y: 0, z: 0 };
    max = { x: 0, y: 0, z: 0 };
    setFromObject() {
      return this;
    }
  }
  class Group {}
  class MeshStandardMaterial {
    clone() {
      return new MeshStandardMaterial();
    }
  }
  return { Vector3, Color, Quaternion, Box3, Group, MeshStandardMaterial };
}

// ---------------------------------------------------------------------------
// @/lib/blueprint-realtime-store mock factory
// ---------------------------------------------------------------------------

type BlueprintStoreModule = typeof import("@/lib/blueprint-realtime-store");

/**
 * Mock module for `@/lib/blueprint-realtime-store`.
 *
 * Strategy: keep EVERY real export (so `subscribeBlueprintRealtimeEvents`,
 * `mapEventTypeToPhase`, `readRoleIdFromBlueprintPayload` and the real reducer
 * stay intact for the event-path helpers) and override ONLY
 * `useBlueprintRealtimeStore` with a selector-driven mock reading the mutable
 * {@link setMockedRolePhases} / {@link setMockedRoleRuntimeStates} state. This
 * mirrors `RoleStatusStrip.test.tsx`'s selector mock while preserving the
 * narrow event observer surface this feature added to the store.
 */
export async function blueprintStoreModuleMock(): Promise<BlueprintStoreModule> {
  const actual = await vi.importActual<BlueprintStoreModule>(
    "@/lib/blueprint-realtime-store"
  );

  const mockHook = (selector?: (state: MockStoreSnapshot) => unknown) => {
    const snapshot: MockStoreSnapshot = {
      rolePhases: mockedRolePhases,
      roleRuntimeStates: mockedRoleRuntimeStates,
    };
    return selector ? selector(snapshot) : snapshot;
  };

  // Preserve zustand's static methods so non-effect callers (and the DEV bridge
  // passthrough, were it ever to run) keep working against the real store.
  const useBlueprintRealtimeStore = Object.assign(mockHook, {
    getState: actual.useBlueprintRealtimeStore.getState,
    setState: actual.useBlueprintRealtimeStore.setState,
    subscribe: actual.useBlueprintRealtimeStore.subscribe,
    getInitialState: actual.useBlueprintRealtimeStore.getInitialState,
    destroy: (
      actual.useBlueprintRealtimeStore as unknown as { destroy?: () => void }
    ).destroy,
  }) as unknown as BlueprintStoreModule["useBlueprintRealtimeStore"];

  return {
    ...actual,
    useBlueprintRealtimeStore,
  };
}

// ---------------------------------------------------------------------------
// Real event-observer path (works regardless of whether the store is mocked)
// ---------------------------------------------------------------------------

let actualStorePromise: Promise<BlueprintStoreModule> | null = null;

function getActualStore(): Promise<BlueprintStoreModule> {
  if (!actualStorePromise) {
    actualStorePromise = vi.importActual<BlueprintStoreModule>(
      "@/lib/blueprint-realtime-store"
    );
  }
  return actualStorePromise;
}

/**
 * Register a listener on the REAL module-level blueprint event observer and
 * return its unsubscribe. Lets a P4/P6 test exercise the actual
 * `subscribeBlueprintRealtimeEvents` → `dispatchEvent` path synchronously
 * (no effects/canvas needed), as the design prescribes.
 */
export async function subscribeRealtimeEvents(
  listener: (event: BlueprintRelayedEvent) => void
): Promise<() => void> {
  const store = await getActualStore();
  return store.subscribeBlueprintRealtimeEvents(listener);
}

/** Dispatch an event through the REAL store reducer (notifies real listeners). */
export async function dispatchRealtimeEvent(
  event: BlueprintRelayedEvent
): Promise<void> {
  const store = await getActualStore();
  store.useBlueprintRealtimeStore.getState().dispatchEvent(event);
}

/** Reset the REAL store back to its initial state between event-path tests. */
export async function resetRealtimeStore(): Promise<void> {
  const store = await getActualStore();
  store.useBlueprintRealtimeStore.getState().reset();
}

// ---------------------------------------------------------------------------
// Pure scene-data convenience (PRIMARY surface for P2/P3/P4/P8)
// ---------------------------------------------------------------------------

export interface BuildSceneDataOverrides {
  locale?: AppLocale;
  rolePhases?: Record<string, RolePhase>;
  roleLabels?: Record<string, string>;
  roleRuntimeStates?: Record<string, RoleRuntimeState>;
  handoffEvents?: BlueprintRelayedEvent[];
  phaseEvents?: BlueprintObservedPhaseEvent[];
  activeStage?: string;
  isReplay?: boolean;
  now?: number;
}

/**
 * Build the pure `BlueprintRuntimeSceneData` view model the same way the
 * component does. Defaults `rolePhases` / `roleRuntimeStates` to the CURRENT
 * mocked store state so a test can `setMockedRolePhases(...)` once and assert
 * both the SSR markup and the snapshot from the same source of truth. Override
 * any field explicitly for focused factory assertions.
 */
export function buildSceneData(
  overrides: BuildSceneDataOverrides = {}
): BlueprintRuntimeSceneData {
  return createBlueprintRuntimeSceneData({
    locale: overrides.locale ?? DEFAULT_LOCALE,
    rolePhases: overrides.rolePhases ?? mockedRolePhases,
    roleLabels: overrides.roleLabels,
    roleRuntimeStates: overrides.roleRuntimeStates ?? mockedRoleRuntimeStates,
    handoffEvents: overrides.handoffEvents ?? [],
    phaseEvents: overrides.phaseEvents ?? [],
    activeStage: overrides.activeStage,
    isReplay: overrides.isReplay ?? false,
    now: overrides.now ?? 0,
  });
}

// ---------------------------------------------------------------------------
// SSR markup render helper (PRIMARY surface for P1 empty-state)
// ---------------------------------------------------------------------------

/**
 * Server-render `<BlueprintRuntimeAgents {...props} />` to a static markup
 * string with the active mocks applied. `BlueprintRuntimeAgents` is imported
 * LAZILY (dynamic import) so this helper can itself be loaded from inside a
 * hoisted `vi.mock` factory without a circular import — the component (and its
 * mocked `@react-three/*` / store deps) only resolves when the test calls this
 * helper, by which point all mocks are registered.
 *
 * Remember the effect-gated constraint: this reliably exposes the empty-state
 * hint (`data-testid="blueprint-empty-hint"` + bilingual text). Agent
 * nameplates and connection lines are effect-populated and do NOT appear here;
 * assert those via {@link buildSceneData} / `deriveConnectionLines`.
 */
export async function renderBlueprintMarkup(
  props: BlueprintRuntimeAgentsProps = {}
): Promise<string> {
  const { BlueprintRuntimeAgents } = await import(
    "@/components/three/BlueprintRuntimeAgents"
  );
  return renderToStaticMarkup(<BlueprintRuntimeAgents {...props} />);
}
