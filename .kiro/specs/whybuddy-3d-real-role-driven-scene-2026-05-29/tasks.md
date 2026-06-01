# Implementation Plan: Real role-driven 3D blueprint scene

Spec folder: `.kiro/specs/whybuddy-3d-real-role-driven-scene-2026-05-29`

## Overview

Scope:

- Blueprint mode renders real runtime roles from `rolePhases`.
- Mission-first behavior stays unchanged.
- `BlueprintRealtimeState` top-level shape stays unchanged.
- No Playwright gate is added in this feature.
- Keep the worktree uncommitted for review unless explicitly asked otherwise.

## Tasks

## Wave 0: Conservative Split and Scene Marker

- [x] 1. Extract `MissionFirstAgents.tsx` conservatively
  - New: `client/src/components/three/MissionFirstAgents.tsx`
  - Edit: `client/src/components/three/PetWorkers.tsx`
  - Move the existing mission-first 8-pet implementation, private helpers, constants, `useGLTF` calls, store selectors, JSX, and animation behavior into `MissionFirstAgents.tsx`.
  - Keep logic behavior unchanged. Only adjust imports and the exported component name.
  - Add root group `userData.shellMarker = "mission-first"` for DEV snapshot support.
  - Acceptance: Requirements 7.1, 7.3, 8.2.

- [x] 2. Create `BlueprintRuntimeAgents.tsx` placeholder
  - New: `client/src/components/three/BlueprintRuntimeAgents.tsx`
  - Add props:
    - `isReplay?: boolean`
    - `latestJobId?: string`
    - `activeJobId?: string`
    - `activeStage?: AutopilotStage`
  - Initially render `null` or an empty group with `userData.shellMarker = "blueprint"`.
  - Acceptance: Requirements 6.1, 6.2, 8.1.

- [x] 3. Turn `PetWorkers.tsx` into `Pet_Workers_Shell`
  - Edit: `client/src/components/three/PetWorkers.tsx`
  - Preserve `export function PetWorkers(...)`.
  - Render `BlueprintRuntimeAgents` only when `mode === "blueprint"`.
  - Render `MissionFirstAgents` only when `mode === "mission-first"`.
  - Do not render DOM from `PetWorkers`; it is inside React Three Fiber.
  - Acceptance: Requirements 8.3, 8.4, 8.5, 8.6.

- [x] 4. Add the non-canvas DOM marker in `Scene3D.tsx`
  - Edit: `client/src/components/Scene3D.tsx`
  - If the page does not already provide them, also edit `client/src/pages/autopilot/AutopilotRoutePage.tsx` or the current page owner to pass `isReplay`, `latestJobId`, `activeJobId`, and `activeStage` down to `Scene3D`.
  - Render `<div data-testid="whybuddy-3d-shell" data-mode={mode} />` adjacent to the `<Canvas>`, after `</Canvas>` or another non-canvas sibling position.
  - Pass `isReplay`, `latestJobId`, `activeJobId`, and `activeStage` from `Scene3D` into `PetWorkers` when those values are available.
  - Acceptance: Requirement 8.7.

## Wave 1: Store Event Observer

- [x] 5. Add module-level blueprint realtime event observer API
  - Edit: `client/src/lib/blueprint-realtime-store.ts`
  - Add:
    - `export type BlueprintRealtimeEventListener = (event: BlueprintRelayedEvent) => void`
    - `export function subscribeBlueprintRealtimeEvents(listener): () => void`
  - Store listeners in a module-level `Set`.
  - In `dispatchEvent(event)`, notify listeners without adding top-level store fields.
  - Catch listener errors so a bridge bug cannot break the reducer.
  - Do not wrap or replace `dispatchEvent` from components.
  - Acceptance: Requirements 5.1, 5.2, 2.15, 6.6.

- [x] 6. Add or export pure event-reading helpers
  - Edit: `client/src/lib/blueprint-realtime-store.ts`.
  - Export the existing `mapEventTypeToPhase`.
  - Add and export `readRoleIdFromBlueprintPayload(payload: Record<string, unknown>): string | undefined`.
  - The blueprint runtime scene derives numeric timestamps locally from `BlueprintRelayedEvent.timestamp`.
  - Acceptance: Requirements 5.4, 5.6.

## Wave 2: Pure Scene Data and Labels

- [x] 7. Add `role-display-label.ts`
  - New: `client/src/components/three/scene-fusion/role-display-label.ts`
  - Implement `displayLabel(roleId, locale)`:
    - call `resolveRoleLabel(roleId, locale)`
    - return canonical/fuzzy result when it differs from raw `roleId`
    - for unknown `role-*`, strip prefix and Title-Case words
    - for other unknown ids, return raw id
  - Acceptance: Requirements 3.1, 3.3, 3.5, 3.6, 3.7.

- [x] 8. Route right-rail role chips through `displayLabel`
  - Edit: `client/src/pages/autopilot/right-rail/RoleStatusStrip.tsx` or the current right-rail chip component.
  - Keep `resolveRoleLabel` itself compatible with existing property tests.
  - Acceptance: Requirements 3.2, 3.4, 3.8.

- [x] 9. Add `blueprint-runtime-scene.ts`
  - New: `client/src/components/three/scene-fusion/blueprint-runtime-scene.ts`
  - Define view-model types:
    - `FunctionalZone`
    - `PhaseTier`
    - `BlueprintObservedPhaseEvent`
    - `BlueprintRuntimeAgent`
    - `BlueprintConnectionLine`
    - `BlueprintRuntimeSceneData`
  - Implement:
    - `stableHash`
    - `classifyZone`
    - `assignRuntimeRoleSlots`
    - `pickAnimal`
    - `pickColor`
    - `phaseTierOf`
    - `phaseTierVisuals`
  - Do not import Three.js.
  - Acceptance: Requirements 2.5-2.14, 4.1-4.7.

- [x] 10. Implement `createBlueprintRuntimeSceneData`
  - Edit: `client/src/components/three/scene-fusion/blueprint-runtime-scene.ts`
  - Input:
    - locale
    - rolePhases
    - roleRuntimeStates
    - handoffEvents
    - phaseEvents
    - activeStage
    - isReplay
    - now
  - Output:
    - zero agents and visible empty hint for empty rolePhases
    - one agent per unique roleId otherwise
    - stable zone position, animal, color, phase visuals, label, and enter duration
  - Connection lines can initially be `[]`; Wave 4 wires priority lines in after agents exist.
  - Acceptance: Requirements 1.1-1.6, 2.1-2.14, 3.1.

## Wave 3: Blueprint Rendering and Replay

- [x] 11. Render runtime agents from factory data
  - Edit: `client/src/components/three/BlueprintRuntimeAgents.tsx`
  - Subscribe to `rolePhases` and `roleRuntimeStates`.
  - Call `createBlueprintRuntimeSceneData`.
  - Render one pet agent per factory agent.
  - Apply shader emissive, opacity, animation amplitude, and failed color override.
  - Do not add per-agent point lights or bloom.
  - Acceptance: Requirements 2.1-2.12.

- [x] 12. Add enter, exit, and replay animation timing
  - Edit: `client/src/components/three/BlueprintRuntimeAgents.tsx`
  - Implement:
    - live enter: `500ms`
    - replay enter: `333ms`
    - exit: `300ms`
    - no re-enter for shared roleId across historical job switches
  - Keep `seenRoleIdsByJobId` in a component ref only.
  - Acceptance: Requirements 2.3, 2.4, 6.1-6.6.

- [x] 13. Render Empty_State_Hint with real UTF-8 text
  - Edit: `client/src/components/three/BlueprintRuntimeAgents.tsx`
  - Add i18n key if the project i18n structure requires it.
  - Text must contain:
    - `等待任务启动...`
    - `Waiting for task...`
  - Hide in the same render frame as first agent enter.
  - Acceptance: Requirements 1.1-1.6.

## Wave 4: Event Rings and Connection Lines

- [x] 14. Add `connection-line-priority.ts`
  - New: `client/src/components/three/scene-fusion/connection-line-priority.ts`
  - Implement `deriveConnectionLines(input)` using:
    1. recent real handoff events within `30_000ms`
    2. phase-event heuristic within `2_000ms`
    3. `activeStage` stage rule fallback
    4. no lines
  - Step 1 lines are directed.
  - Steps 2 and 3 are undirected.
  - Implement only `spec_tree` stage rule in this feature.
  - Acceptance: Requirements 5.5-5.10.

- [x] 15. Wire handoff and phase event rings inside `BlueprintRuntimeAgents`
  - Edit: `client/src/components/three/BlueprintRuntimeAgents.tsx`
  - Subscribe to `subscribeBlueprintRealtimeEvents`.
  - Maintain FIFO insertion-order rings:
    - `recentHandoffEventsRef` max 32
    - `recentPhaseEventsRef` max 64
  - Do not mutate or wrap store actions.
  - Pass both arrays to `createBlueprintRuntimeSceneData`.
  - Acceptance: Requirements 5.1-5.6.

- [x] 16. Render connection lines in `BlueprintRuntimeAgents`
  - Edit: `client/src/components/three/BlueprintRuntimeAgents.tsx`
  - Use factory agent positions as line endpoints; do not render lines until the corresponding agents exist in the scene data.
  - Use drei `<Line>` or the existing local line rendering style.
  - Render arrowhead geometry only for `source === "event-from-to"`.
  - Keep heuristic and stage-rule lines visually thinner and undirected.
  - Acceptance: Requirements 5.7-5.10.

## Wave 5: DEV Snapshot Bridge and Tests

- [x] 17. Add DEV scene bridge
  - Edit: `client/src/components/three/BlueprintRuntimeAgents.tsx`
  - Edit: `client/src/components/three/MissionFirstAgents.tsx`
  - Add `window.__whybuddy3dScene` in DEV only.
  - `MissionFirstAgents` only writes `mountedShell: "mission-first"` plus empty `agents`, `connectionLines`, and `emptyHintVisible` values so P5 can confirm shell switching.
  - Expose:
    - `getSnapshot()`
    - `dispatchEvent(event)`
  - Snapshot includes:
    - mode
    - mountedShell
    - agents
    - connectionLines
    - emptyHintVisible
  - Acceptance: Requirements 9.7, 1.6.

- [x] 18. Add pure unit tests
  - New: `client/src/components/three/scene-fusion/__tests__/blueprint-runtime-scene.test.ts`
  - New: `client/src/components/three/scene-fusion/__tests__/connection-line-priority.test.ts`
  - New: `client/src/components/three/scene-fusion/__tests__/role-display-label.test.ts`
  - Cover the scenarios listed in Requirements 9.2-9.4.
  - Acceptance: Requirements 4.6, 5.5-5.10, 9.2-9.4.

- [x] 19. Add server-render component harness helpers
  - New or edit narrow test helper under `client/src/components/three/__tests__/`.
  - Use `react-dom/server.renderToStaticMarkup` plus string assertions and DEV bridge snapshot refs, matching the repository's existing SSR-style right-rail tests.
  - Do not add JSDOM, happy-dom, Testing Library, Playwright e2e, or a new Vitest DOM project in this spec.
  - Drive P4/P6/P7 with direct `subscribeBlueprintRealtimeEvents` listener dispatch and pure factory/priority functions instead of React DOM timing.
  - Acceptance: Requirements 9.1, 9.6.

- [x] 20. Add blueprint runtime harness tests
  - New: `client/src/components/three/__tests__/blueprint-runtime-agents.harness.test.tsx`
  - Mock Three.js / drei / R3F as no-op React elements where needed.
  - Cover:
    - P1 empty blueprint state
    - P2 single role
    - P3 8-zone multi-role layout
    - P4 phase transitions
    - P5 mission-first shell regression
    - P6 replay timing
    - P7 line priority
    - P8 label parity
    - P9 undirected line flags
    - P10 Scene3D DOM marker
  - Acceptance: Requirements 9.7, 9.8.

- [x] 21. Keep existing regression tests intact
  - Do not modify `client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts`.
  - Run it as part of focused verification.
  - Ensure `client/src/pages/autopilot/right-rail/__tests__/role-labels.property.test.ts` still passes after `displayLabel` is introduced.
  - Acceptance: Requirements 7.2, 9.5.

## Wave 6: Verification and Delivery

- [x] 22. Run focused verification
  - Run the new scene-fusion unit tests.
  - Run the new component harness tests.
  - Run existing `role-id-bridge.test.ts`.
  - Run existing `role-labels.property.test.ts`.
  - Run type diagnostics for touched files or the narrowest existing command that covers them.
  - Record any repo-wide baseline failures separately from feature failures.
  - Acceptance: Requirements 9.9.

- [-] 23. Manual sanity check
  - In blueprint mode, verify:
    - 0 roles -> empty hint only
    - 1 role -> one visible agent
    - multiple roles -> stable zones and thinner lines
  - In mission-first mode, verify the existing 8-pet scene still looks unchanged.
  - Do not commit, push, stash, or broad-stage changes unless explicitly requested.

## Notes

- Empty blueprint state intentionally renders no placeholder agents.
- Browser-level Playwright validation remains deferred even though `@playwright/test` exists in dev dependencies.
- Keep changes uncommitted unless explicitly requested.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2", "3", "4"] },
    { "id": 1, "tasks": ["5", "6"] },
    { "id": 2, "tasks": ["7", "8", "9", "10"] },
    { "id": 3, "tasks": ["11", "12", "13"] },
    { "id": 4, "tasks": ["14", "15", "16"] },
    { "id": 5, "tasks": ["17", "18", "19", "20", "21"] },
    { "id": 6, "tasks": ["22", "23"] }
  ]
}
```
