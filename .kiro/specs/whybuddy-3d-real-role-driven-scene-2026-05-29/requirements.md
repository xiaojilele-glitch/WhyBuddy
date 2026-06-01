# Requirements Document

## Introduction

The Autopilot 3D office scene currently projects a fixed blueprint-role layout that does not match the real `rolePhases` stream emitted by the active autopilot job. The 3D stage can show synthetic or stale agents while the right rail shows a different set of active roles. It also fails to make real role phase changes (`acting`, `thinking`, `reviewing`, `observing`, `completed`, `idle`, `sleeping`, `failed`) visible in the scene.

This feature replaces the fixed blueprint projection with a real `rolePhases`-driven scene for `mode === "blueprint"` only. Blueprint mode renders zero agents when no runtime roles exist, then renders exactly one 3D agent per unique live `roleId`. Agents are placed into 8 functional zones with stable hash-based positions, animated through 5 phase tiers using shader emissive intensity, and connected by lines from the best available handoff evidence.

The `mode === "mission-first"` path must remain behaviorally unchanged. `PetWorkers.tsx` becomes a thin mode-switching shell, `MissionFirstAgents.tsx` contains the existing 8-pet mission-first scene extracted conservatively, and `BlueprintRuntimeAgents.tsx` contains the new role-driven blueprint scene.

## Glossary

- **Blueprint_Scene**: The 3D agent rendering subsystem active when `mode === "blueprint"`.
- **Mission_First_Scene**: The existing 8-pet 3D template active when `mode === "mission-first"`.
- **Pet_Workers_Shell**: The thin `PetWorkers.tsx` orchestrator that mounts either `BlueprintRuntimeAgents` or `MissionFirstAgents` based on `mode`.
- **Blueprint_Runtime_Agents**: The new component that renders Blueprint_Scene from `useBlueprintRealtimeStore().rolePhases` and `roleRuntimeStates`.
- **Mission_First_Agents**: The extracted existing mission-first 8-pet implementation. Its behavior must remain identical to the pre-feature `PetWorkers.tsx` path.
- **Role_Phase**: A phase value from `BlueprintRealtimeStore.rolePhases`, one of `idle | activated | acting | thinking | reviewing | observing | sleeping | completed | failed`.
- **Phase_Tier**: The visual tier mapped from Role_Phase: `main`, `secondary`, `faded`, `standby`, or `failed`.
- **Functional_Zone**: One of `intake`, `repository`, `architect`, `runtime`, `quality`, `memory`, `experience`, or `standby`. Drives labels and stage-rule connection lines; no longer drives position directly.
- **Grid_Position**: A deterministic world-space position from a single tidy centred grid. Roles are sorted by `(ZONE_GRID_ORDER index, roleId)`, then filled left→right, front→back, so same-zone roles stay adjacent and the scene reads as an orderly room. Computed by `assignRuntimeRoleSlots` → `gridPosition`.
- **Role_Label_Resolver**: `resolveRoleLabel(roleId, locale)` in `client/src/pages/autopilot/right-rail/role-labels.ts`.
- **Display_Label**: A new helper `displayLabel(roleId, locale)` in `client/src/components/three/scene-fusion/role-display-label.ts`. It is the single label function used by both right-rail role chips and 3D nameplates after this feature.
- **Blueprint_Event_Observer**: A module-level observer API exported from `client/src/lib/blueprint-realtime-store.ts`. It lets components observe `BlueprintRelayedEvent`s as `dispatchEvent` handles them without adding top-level fields to `BlueprintRealtimeState`.
- **Recent_Handoff_Events_Ring**: A `useRef` ring buffer inside `BlueprintRuntimeAgents` containing up to 32 recent events with non-empty `payload.fromRoleId` and `payload.toRoleId`.
- **Recent_Phase_Events_Ring**: A `useRef` ring buffer inside `BlueprintRuntimeAgents` containing up to 64 recent role phase events with a readable `roleId` and mapped `Role_Phase`.
- **Replay_Mode**: A boolean derived from `BlueprintRuntimeAgents` props. Explicit `isReplay` wins; otherwise `latestJobId !== activeJobId` means replay when both IDs are present.
- **DEV_Scene_Bridge**: `window.__whybuddy3dScene`, a DEV-only bridge exposing `getSnapshot()` and `dispatchEvent(event)` for Vitest harness assertions.
- **Empty_State_Hint**: A ground text decal containing the Chinese string `等待任务启动...` and the English string `Waiting for task...`.
- **Stage_Seed_Roles**: A deterministic, stage-keyed roster of canonical runtime `roleId`s that SHOULD participate in the current blueprint stage. Seeded roles are real canonical runtime roles (present in `ROLE_LABELS`), NOT the legacy 7 fixed slots. Lives in `client/src/components/three/scene-fusion/blueprint-runtime-scene.ts` as `deriveStageSeedRolePhases(activeStage)`.
- **Effective_Role_Phases**: The merged map the scene actually renders: `{ ...Stage_Seed_Roles, ...rolePhases }` — real `rolePhases` override seeded phases per `roleId`, and seeded roles fill the rest of the stage roster.

## Requirements

### Requirement 1: Empty-state UX in blueprint mode

**User Story:** As an autopilot operator opening a brand-new autopilot page with no task context, I want the 3D scene to clearly show a waiting state without synthetic agents, so the scene matches the real runtime state; but once a stage is active I want the relevant roles to appear even before their first real event arrives.

The empty hint must distinguish "no task context at all" (truly empty, show the hint) from "task context present but `rolePhases` has not yet arrived" (a stage is active and seeds roles, do not show the hint). The scene renders Effective_Role_Phases — the merge of Stage_Seed_Roles and real `rolePhases` — so the empty hint shows ONLY when there is truly nothing to display.

#### Acceptance Criteria

1. WHILE `mode === "blueprint"` AND Effective_Role_Phases is empty (neither real `rolePhases` nor any Stage_Seed_Roles), THE Blueprint_Scene SHALL render zero 3D agents.
2. WHILE `mode === "blueprint"` AND Effective_Role_Phases is empty, THE Blueprint_Scene SHALL render Empty_State_Hint as a ground text decal containing both `等待任务启动...` and `Waiting for task...`.
3. WHILE `mode === "blueprint"` AND Effective_Role_Phases is empty, THE Blueprint_Scene SHALL NOT render a CEO placeholder agent.
4. WHILE `mode === "blueprint"` AND Effective_Role_Phases is empty, THE Blueprint_Scene SHALL NOT render the legacy fixed-slot blueprint layout.
5. WHEN Effective_Role_Phases transitions from empty to non-empty, THE Blueprint_Scene SHALL hide Empty_State_Hint in the same render frame that the first agent enter animation begins.
6. WHILE Empty_State_Hint is visible, THE DEV_Scene_Bridge snapshot SHALL report `emptyHintVisible: true` and `agents: []`.
7. WHERE `activeStage` is `undefined` (no task context) AND `rolePhases` is empty, THE Blueprint_Scene SHALL render Empty_State_Hint (a brand-new blank autopilot page stays empty).

### Requirement 2: Real rolePhases-driven blueprint data source

**User Story:** As an autopilot operator running a blueprint job, I want the 3D stage to render the same live role set as the right rail, with phase-driven animation, so the stage is a runtime visualization rather than a decorative template.

#### Acceptance Criteria

1. WHILE `mode === "blueprint"`, THE Blueprint_Scene SHALL source its agent set from `useBlueprintRealtimeStore().rolePhases` and `useBlueprintRealtimeStore().roleRuntimeStates`.
2. WHILE `mode === "blueprint"`, THE Blueprint_Scene SHALL render exactly one 3D agent per unique `roleId` present in Effective_Role_Phases (real `rolePhases` merged over Stage_Seed_Roles).
3. WHEN a new `roleId` appears in `rolePhases`, THE Blueprint_Scene SHALL play an enter animation from scale `0.7` to `1.0` and opacity `0` to `1` over `0.5s` in live mode.
4. WHEN a `roleId` is removed from `rolePhases` due to reset or unsubscribe, THE Blueprint_Scene SHALL play a `0.3s` exit animation and then remove the agent from the scene graph.
5. WHEN Role_Phase maps to Phase_Tier `main`, THE Blueprint_Scene SHALL render the role body with full animation amplitude.
6. WHEN Role_Phase is `observing`, THE Blueprint_Scene SHALL render the role body with reduced animation amplitude relative to Phase_Tier `main`.
7. WHEN Role_Phase is `completed`, THE Blueprint_Scene SHALL render the role body with low animation amplitude.
8. WHEN Role_Phase is `idle` or `sleeping`, THE Blueprint_Scene SHALL render the role body with minimal animation amplitude.
9. WHEN Role_Phase is `failed`, THE Blueprint_Scene SHALL render the role body with the highest (jittered) animation amplitude.
10. THE Blueprint_Scene SHALL express Phase_Tier differentiation through per-agent animation (bob) amplitude only, and SHALL NOT apply a phase-driven emissive glow or any coloured self-lit film to the role body (the body shows its natural GLB material shading).
11. THE Blueprint_Scene SHALL NOT introduce per-agent point lights for active highlighting.
12. THE Blueprint_Scene SHALL NOT introduce a bloom post-processing pipeline as part of this feature.
13. WHERE the same `roleId` is observed across reconnects within the same `subscribedJobId`, THE Blueprint_Scene SHALL preserve its animal model, accent color, Functional_Zone, and Grid_Position.
14. THE Blueprint_Scene SHALL select the animal model and an ACCENT color deterministically from a stable hash of `roleId` against the available GLB pet pool and accent color pool. The accent color (`BlueprintRuntimeAgent.accentColor`, from `pickAccentColor`) and the phase `colorOverride` are for NON-BODY scene accents only — currently consumed by the nameplate role-type icon row (tinted from `colorOverride ?? accentColor`) and reserved for the ground ring / connection lines / capability chips — and SHALL NEVER be written into the pet GLB body `material.color` or `material.emissive` (Kenney Cube Pets keep their own authoritative material colors). The body loop SHALL only adjust `roughness` (≈0.55 cap) and `metalness` (0) for Kenney-like specular relief — the scene has no environment map, so `envMapIntensity` is a no-op — and the enter/exit transparency, never color.
15. THE feature SHALL NOT add `activeJobId`, `latestJobId`, `isReplay`, `events`, or `activeStage` as top-level fields on `BlueprintRealtimeState`.

### Requirement 3: Label unification with right-rail chips

**User Story:** As an autopilot operator comparing the right rail and the 3D scene, I want the same role to display the same full label in both places, so I never see one role under two different names.

#### Acceptance Criteria

1. THE Blueprint_Scene SHALL resolve every 3D agent nameplate via `displayLabel(roleId, locale)`.
2. THE right-rail role chip rendering pipeline SHALL also use `displayLabel(roleId, locale)`.
3. THE `displayLabel` helper SHALL call `resolveRoleLabel(roleId, locale)` first.
4. WHEN `resolveRoleLabel` returns a canonical or fuzzy hit, THE right-rail chip and 3D nameplate SHALL display that exact string.
5. IF `roleId` has no canonical or fuzzy match AND starts with `role-`, THEN `displayLabel` SHALL strip `role-`, replace remaining hyphens with spaces, and Title-Case each word.
6. IF `roleId` has no canonical or fuzzy match AND does NOT start with `role-`, THEN `displayLabel` SHALL return the raw `roleId`.
7. THE existing `resolveRoleLabel` function body SHALL remain compatible with its current unknown-id passthrough contract.
8. THE existing `role-labels.property.test.ts` SHALL continue to pass, and new `displayLabel` tests SHALL cover the extra display fallback.

### Requirement 4: Eight-zone classification with tidy centred-grid positioning

**User Story:** As an autopilot operator watching a multi-role blueprint job, I want roles laid out as one tidy, orderly grid grouped by semantic zone, so the scene reads as a clean room instead of scattered clusters, and I can still associate neighbouring roles with intake, runtime, quality, memory, and related functions.

#### Acceptance Criteria

1. THE Blueprint_Scene SHALL place each `roleId` into one of 8 Functional_Zones: `intake`, `repository`, `architect`, `runtime`, `quality`, `memory`, `experience`, or `standby`.
2. THE Blueprint_Scene SHALL assign each `roleId` a deterministic Grid_Position from a single centred grid, ordering roles by `(ZONE_GRID_ORDER index, roleId)` so same-zone roles stay adjacent.
3. WHEN the same set of `roleId`s renders across re-renders within the same `subscribedJobId`, THE Blueprint_Scene SHALL keep the same Functional_Zone and Grid_Position for each `roleId`.
4. THE `assignRuntimeRoleSlots`, `classifyZone`, and `stableHash` helpers SHALL live in `client/src/components/three/scene-fusion/blueprint-runtime-scene.ts`.
5. THE `createBlueprintRuntimeSceneData` factory SHALL live in `client/src/components/three/scene-fusion/blueprint-runtime-scene.ts`.
6. THE zone classification, grid slot assignment, position determinism, and hash determinism (for animal/color picks) SHALL be covered by `client/src/components/three/scene-fusion/__tests__/blueprint-runtime-scene.test.ts`.
7. WHEN multiple `roleId`s classify into the same Functional_Zone, THE slot helper SHALL still assign each a distinct grid cell (centred per row, `GRID_COLUMNS = 4`, `GRID_SPACING_X = 2.4`, `GRID_SPACING_Z = 2.8`, `GRID_ORIGIN_Z = -2.2`), and tests SHALL verify 5 same-zone roles receive distinct positions independent of input order.
8. THE Blueprint_Scene SHALL render one workstation IN FRONT of each rendered role — a desk with a monitor, laptop, keyboard, mouse, and books — reusing the existing Kenney office furniture GLBs (already preloaded by `Scene3D`, no new asset dependency), so the scene reads as an office of working agents. All props SHALL be positioned within the desk surface footprint so none read as sliding off the desk edge, and the desk SHALL sit directly in front of the role (back edge at the role) so the two read as aligned. THE workstation SHALL be rendered larger than the pet (`WORKSTATION_SCALE = BASE_AGENT_SCALE * 2.1`, so the desk does not read as a toy) and be floor-aligned so its base sits on the floor and its surface/props sit at the desk rather than floating, and SHALL be a sibling of the role's bobbing group so it stays still while the role bobs. THE workstation materials SHALL preserve their authoritative Kenney GLB colors via `preserveKenneyFurnitureMaterial` (the furniture body-color lock) and SHALL NOT be repainted into the cold-office palette via `rethemeFurnitureMaterial`; only `roughness` / `metalness` and a narrow screen/lamp emissive may be tuned, never a body `material.color`.

### Requirement 5: Connection line priority chain

**User Story:** As an autopilot operator watching role handoffs, I want connection lines to reflect the strongest available evidence, so real handoff data wins and inferred lines remain clearly lower-confidence.

#### Acceptance Criteria

1. THE Blueprint_Event_Observer SHALL expose a subscribe/unsubscribe API for observing `BlueprintRelayedEvent`s handled by `dispatchEvent`.
2. THE Blueprint_Event_Observer SHALL NOT add top-level fields to `BlueprintRealtimeState`.
3. THE Recent_Handoff_Events_Ring SHALL retain up to 32 recent events whose `payload.fromRoleId` and `payload.toRoleId` are both non-empty strings, by FIFO insertion order and not by timestamp-window eviction.
4. THE Recent_Phase_Events_Ring SHALL retain up to 64 recent role phase events whose `roleId` can be read and whose event type maps to a Role_Phase, by FIFO insertion order and not by timestamp-window eviction.
5. WHEN Recent_Handoff_Events_Ring contains at least one event within the last `30_000ms`, THE Blueprint_Scene SHALL draw directed connection lines from `payload.fromRoleId` to `payload.toRoleId` and mark the line source as `event-from-to`.
6. IF no recent real handoff event exists AND Recent_Phase_Events_Ring contains role A entering `acting` followed by role B entering `thinking` within `2_000ms`, THEN THE Blueprint_Scene SHALL draw an undirected line from A to B and mark the line source as `heuristic`.
7. IF neither real handoff events nor the timing heuristic apply AND a stage-rule fallback applies for `activeStage`, THEN THE Blueprint_Scene SHALL draw those stage-rule lines and mark the line source as `stage-rule`.
8. IF none of the above applies, THEN THE Blueprint_Scene SHALL draw no connection lines and SHALL still render active agents.
9. WHILE the line source is anything other than `event-from-to`, THE Blueprint_Scene SHALL render lines as undirected without arrowheads.
10. THE `spec_tree` stage rule SHALL connect `analyst` to `architect` and `architect` to `auditor`, using `roleId.toLowerCase().includes(token)` against currently rendered agents.

### Requirement 6: Replay enter-animation speed for historical jobs

**User Story:** As an autopilot operator switching to a historical job, I want role enter animations to replay faster, so the historical role timeline reconstructs without full live-duration waits.

#### Acceptance Criteria

1. THE Blueprint_Scene SHALL accept `isReplay?: boolean` on `BlueprintRuntimeAgents`. When absent, it defaults to `false`.
2. THE Blueprint_Scene SHALL accept optional `latestJobId?: string` and `activeJobId?: string` props. When `isReplay` is `undefined` and both IDs are present and `latestJobId !== activeJobId`, the scene SHALL treat the session as replay.
3. WHILE in Replay_Mode, THE Blueprint_Scene SHALL play each agent enter animation in approximately `0.33s`.
4. WHILE not in Replay_Mode, THE Blueprint_Scene SHALL play each agent enter animation in `0.5s`.
5. WHEN `activeJobId` changes between historical jobs and the same `roleId` exists in both previous and next snapshots, THE Blueprint_Scene SHALL NOT replay enter animation for that shared `roleId`.
6. THE replay detection logic SHALL NOT read or write new top-level fields on `BlueprintRealtimeState`.

### Requirement 7: Mission-first scene non-regression

**User Story:** As an autopilot operator using `mode === "mission-first"`, I want this feature to leave the mission-first scene unchanged, so existing workflows stay stable.

#### Acceptance Criteria

1. WHILE `mode === "mission-first"`, THE Mission_First_Scene SHALL render the existing 8-pet template with behavior identical to the pre-feature `PetWorkers.tsx` implementation.
2. THE existing `client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts` SHALL continue to pass without modifying any test body or import.
3. THE `MissionFirstAgents` component SHALL be a conservative extraction of the existing 8-pet template, preserving its `useGLTF` calls, store subscriptions, helpers, and JSX behavior.
4. THE Blueprint_Runtime_Agents SHALL NOT modify any data, helper, layout, or animation used exclusively by Mission_First_Scene.
5. WHEN `mode === "mission-first"`, THE Blueprint_Runtime_Agents SHALL NOT mount and its `rolePhases` data path SHALL NOT execute.

### Requirement 8: File split and Scene3D DOM marker

**User Story:** As a maintainer of the 3D scene code, I want blueprint runtime work and mission-first work separated cleanly, so role-driven blueprint behavior can evolve without rewriting the mission-first scene.

#### Acceptance Criteria

1. THE codebase SHALL contain `client/src/components/three/BlueprintRuntimeAgents.tsx`.
2. THE codebase SHALL contain `client/src/components/three/MissionFirstAgents.tsx`.
3. THE existing `client/src/components/three/PetWorkers.tsx` SHALL become a thin Pet_Workers_Shell that preserves the named export `PetWorkers`.
4. WHEN `mode === "blueprint"`, THE Pet_Workers_Shell SHALL mount `BlueprintRuntimeAgents`.
5. WHEN `mode === "mission-first"`, THE Pet_Workers_Shell SHALL mount `MissionFirstAgents`.
6. THE feature SHALL NOT introduce `PetWorkersCore`; shared GLB-pool or shared-tick cleanup is deferred.
7. THE DOM marker `<div data-testid="whybuddy-3d-shell" data-mode={mode} />` SHALL be rendered by `Scene3D.tsx` adjacent to the `<Canvas>`, not by `PetWorkers.tsx`, because `PetWorkers` is a React Three Fiber child inside the canvas.

### Requirement 9: Test gate

**User Story:** As a release manager gating this feature, I want focused tests that can run in the current repository, so empty state, role rendering, layout, connection lines, labels, replay timing, and mission-first regression are checked before implementation is accepted.

#### Acceptance Criteria

1. THE feature SHALL NOT create a Playwright e2e gate in this spec. The repository already has `@playwright/test`, but a real browser gate, config, auth fixture, and `tests/e2e` layout are deferred to a separate spec.
2. THE feature SHALL ship pure Vitest tests at `client/src/components/three/scene-fusion/__tests__/blueprint-runtime-scene.test.ts`.
3. THE feature SHALL ship pure Vitest tests at `client/src/components/three/scene-fusion/__tests__/connection-line-priority.test.ts`.
4. THE feature SHALL ship pure Vitest tests at `client/src/components/three/scene-fusion/__tests__/role-display-label.test.ts`.
5. THE feature SHALL extend `client/src/pages/autopilot/right-rail/__tests__/role-labels.property.test.ts` only as needed to prove the right rail uses `displayLabel` while preserving `resolveRoleLabel` unknown-id passthrough.
6. THE feature SHALL add a lightweight component harness using `react-dom/server.renderToStaticMarkup`, DEV bridge snapshots, direct event-listener dispatch, and pure factory assertions. THE feature SHALL NOT add JSDOM, happy-dom, Testing Library, Playwright e2e, or a new Vitest DOM project.
7. THE DEV_Scene_Bridge SHALL expose `getSnapshot(): { mode, mountedShell, agents, connectionLines, emptyHintVisible }` and `dispatchEvent(event: BlueprintRelayedEvent)`.
8. THE harness SHALL cover P1 empty state, P2 single role, P3 multi-role 8-zone layout, P4 phase transitions, P5 mission-first shell regression, P6 replay timing, P7 connection-line priority, P8 label parity, P9 undirected line flags, and P10 Scene3D DOM marker.
9. THE implementation SHALL run the focused test suites for all new or modified feature boundaries before delivery.

### Requirement 10: Role agent reasoning events drive rolePhases

**User Story:** As an autopilot operator watching a role iterate through its reasoning loop, I want the 3D scene to reflect the role's `role.agent.*` reasoning phases, so the stage shows real thinking/acting/observing motion instead of staying on the coarse lifecycle phase.

The store already has a `if (type.startsWith("role."))` dispatch branch that calls `mapEventTypeToPhase(type)` and writes `rolePhases[roleId]` when the result is non-null. Because `role.agent.*` event types match that prefix, once `mapEventTypeToPhase` returns a phase for them they flow into `rolePhases` automatically with no other reducer change.

Acceptance criterion 5 deliberately maps `role.agent.iteration_completed` to `observing` rather than `completed`: a multi-iteration role would otherwise flash to the faded `completed` tier between iterations and snap back. The terminal `completed` tier is reserved for the terminal `role.agent.completed` event.

#### Acceptance Criteria

1. WHEN `mapEventTypeToPhase` receives `role.agent.iteration_started`, THEN it SHALL return `activated`.
2. WHEN `mapEventTypeToPhase` receives `role.agent.thinking`, THEN it SHALL return `thinking`.
3. WHEN `mapEventTypeToPhase` receives `role.agent.acting`, THEN it SHALL return `acting`.
4. WHEN `mapEventTypeToPhase` receives `role.agent.observing`, THEN it SHALL return `observing`.
5. WHEN `mapEventTypeToPhase` receives `role.agent.iteration_completed`, THEN it SHALL return `observing` (deliberately `observing` rather than `completed`, so a multi-iteration role does not flash to the faded `completed` tier between iterations and snap back; `completed` is reserved for the terminal `role.agent.completed`).
6. WHEN `mapEventTypeToPhase` receives `role.agent.completed`, THEN it SHALL return `completed`.
7. WHEN `mapEventTypeToPhase` receives `role.agent.error`, THEN it SHALL return `failed`.
8. WHEN a `role.agent.*` event carries `payload.roleId`, THEN the dispatch reducer's existing `role.`-prefix branch SHALL write the mapped phase into `rolePhases[roleId]` with NO other reducer change and NO new `BlueprintRealtimeState` field.
9. THE existing `role.agent.*` → `agentReasoning` slice behavior SHALL remain unchanged (both branches run in parallel).
10. THE existing 19 store tests SHALL continue to pass, and new store tests SHALL cover the 7 new mappings.

### Requirement 11: Stage-role seeding before real role events arrive

**User Story:** As an autopilot operator who has just started a stage, I want the roles expected for that stage to appear in the 3D scene immediately, so the stage is not blank while waiting for the first real role event, while still letting real events override the seeded phases as they arrive.

#### Acceptance Criteria

1. THE `deriveStageSeedRolePhases(activeStage)` helper SHALL live in `client/src/components/three/scene-fusion/blueprint-runtime-scene.ts` and SHALL be pure and deterministic.
2. WHEN `activeStage === "input"`, THE seed roster SHALL be `intake-coordinator`.
3. WHEN `activeStage === "clarification"`, THE seed roster SHALL be `intake-coordinator`, `product-strategist`.
4. WHEN `activeStage === "route_generation"`, THE seed roster SHALL be `product-strategist`, `repository-analyst`.
5. WHEN `activeStage === "spec_tree"`, THE seed roster SHALL be `repository-analyst`, `spec-architect`, `role-quality-auditor`.
6. WHEN `activeStage` is any other value OR `undefined`, THE seed roster SHALL be empty.
7. THE seeded roles SHALL each be assigned a seed Role_Phase of `activated` (main Phase_Tier, fully visible) before any real event arrives.
8. THE factory SHALL compute Effective_Role_Phases as `{ ...Stage_Seed_Roles, ...rolePhases }` so that a real `rolePhases[roleId]` overrides the seeded phase for that role, while seeded-but-not-yet-real roles remain visible at their seeded phase.
9. THE seeded roles SHALL be canonical runtime roles (resolvable to full names via `displayLabel`), NOT the legacy 7 fixed slots, and SHALL be classified into Functional_Zones by the same `classifyZone` rules as real roles.
10. WHEN real `role.*` / `role.agent.*` events later populate `rolePhases`, THE scene SHALL update those roles' phases/animation/lines from the real events (per-role override), without removing the still-seeded roles for the current stage.
11. THE seed derivation, the merge precedence (real over seed), and the empty-vs-seeded distinction SHALL be covered by tests in `client/src/components/three/scene-fusion/__tests__/blueprint-runtime-scene.test.ts`.

### Requirement 12: Capability invocations bound to 3D roles

**User Story:** As an autopilot operator watching the 3D scene, I want each role to show the capabilities IT is using, so I can see "who called what" directly on the stage instead of reading a flat capability log that only says "what ran".

The capability bridge panel answers "which capabilities ran". This requirement adds the missing half — "WHO ran them" — by binding live capability invocations (`BlueprintRealtimeStore.capabilityStatuses`, keyed by `capabilityId`) to the roles currently on stage, then rendering a lightweight capability chip strip under each role's nameplate. The right-rail capability panel remains the detailed audit surface; the scene shows only the human-readable per-role summary.

#### Acceptance Criteria

1. THE binding helper `deriveCapabilityRoleBindings` SHALL live in `client/src/components/three/scene-fusion/capability-role-binding.ts`, be pure and deterministic, and return a `Map<roleId, RoleCapabilityChip[]>`.
2. THE `BlueprintRealtimeStore` SHALL retain the latest authoritative owner snapshot for each capability id in a `capabilityOwners: Record<capabilityId, { roleId, invocationId?, updatedAt }>` slice, populated from the `roleId` (and latest `invocationId`, when present) on `capability.*` events and from the role-container loader path. This slice is a latest-by-capability snapshot, NOT a full invocation history; it SHALL reset on subscribe/unsubscribe like the other per-job slices.
3. WHEN `capabilityOwners[capabilityId]` names a role that is on stage, THE helper SHALL bind the capability to that real owner with `ownerSource = "event-role"` and `inferred = false`. This is the HIGHEST priority — a real owner always beats any guess.
4. WHEN a capability id is `role-container-loader:<roleId>` AND that `roleId` is on stage, THE helper SHALL bind it with `ownerSource = "loader-id"` and `inferred = false`. WHEN that `roleId` is OFF stage, THE helper SHALL leave the capability unowned (it already names an authoritative role) and SHALL NOT re-attribute it via heuristic or active-role fallback.
5. WHEN no real owner record exists and no loader role applies AND a capability id matches a well-known capability type (e.g. `aigc-spec-node`, `docker-analysis-sandbox`, `mcp-github-source`, `role-system-architecture`, `skill-svg-architecture`), THE helper SHALL bind it to the first on-stage role whose id matches the capability's candidate role tokens, with `ownerSource = "capability-heuristic"` and `inferred = true`.
6. WHEN a capability is still unbound AND EXACTLY one role is in an active phase (`acting | thinking | reviewing | activated`), THE helper SHALL bind it to that role with `ownerSource = "active-role"` and `inferred = true`.
7. WHEN a capability cannot be bound by any rule (including zero or more-than-one active roles for the fallback, or any off-stage loader/event owner), THE helper SHALL leave it unowned and SHALL omit it from the returned map (it remains in the right-rail audit panel only).
8. THE helper SHALL order each role's chips by binding confidence (`event-role` → `loader-id` → `capability-heuristic` → `active-role`) then by `capabilityId`, and SHALL produce identical output regardless of `capabilityStatuses` key order.
9. THE Blueprint_Scene SHALL render a capability chip strip for each role anchored at the role's desk (NOT inside the bobbing head nameplate), showing at most `MAX_ROLE_CAPABILITY_CHIPS` chips on a single line; each chip SHALL display a human-readable capability name (NOT the raw machine id) plus an icon and a status dot (running = cyan pulse, completed = green, failed = red, idle = slate), and overflow SHALL collapse into a `+N` indicator.
10. THE chip SHALL keep the raw `capabilityId` off-scene (available only via the chip `title` tooltip), SHALL avoid a heavy card background (no bordered white capsules over the pet), and inferred chips SHALL be visually distinguished (reduced opacity + `(inferred)` tooltip suffix) from authoritative `event-role` / `loader-id` chips.
11. THE binding helper SHALL tolerate undefined / non-object `capabilityStatuses`, `rolePhases`, or `capabilityOwners` (e.g. first render / SSR) by returning an empty map without throwing.
12. THE binding precedence (real owner first), the off-stage loader/event-owner handling, the EXACTLY-one-active-role guard, the unowned-omission, ordering, determinism, and display-meta SHALL be covered by tests in `client/src/components/three/scene-fusion/__tests__/capability-role-binding.test.ts`.
