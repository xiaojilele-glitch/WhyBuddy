# Design Document

## Overview

This feature changes the Autopilot 3D office scene in blueprint mode from a fixed role projection into a real runtime-role visualization. The source of truth for rendered agents is `useBlueprintRealtimeStore().rolePhases`: zero roles means zero agents, and every unique live `roleId` becomes exactly one 3D agent.

The design keeps mission-first behavior conservative. `PetWorkers.tsx` becomes a mode-switching shell, `MissionFirstAgents.tsx` receives the existing mission-first implementation, and `BlueprintRuntimeAgents.tsx` owns the new blueprint runtime scene. No `PetWorkersCore` shared abstraction is introduced in this feature.

`BlueprintRealtimeState` top-level shape stays stable. This feature may add a module-level event observer API exported from `client/src/lib/blueprint-realtime-store.ts`, but it does not add state fields such as `activeJobId`, `latestJobId`, `events`, `activeStage`, or `isReplay`. Replay and stage context are passed as props from the page that owns job selection.

## Architecture

### Data Flow

```text
AutopilotRoutePage / Scene3D
  mode, activeJobId, latestJobId, isReplay, activeStage
        |
        v
Scene3D
  - renders <Canvas>
  - renders DOM marker next to Canvas:
    <div data-testid="whybuddy-3d-shell" data-mode={mode} />
        |
        v
PetWorkers (inside Canvas)
  mode === "blueprint"      -> BlueprintRuntimeAgents
  mode === "mission-first"  -> MissionFirstAgents

BlueprintRuntimeAgents
  reads existing store state:
    subscribedJobId
    rolePhases
    roleRuntimeStates
  subscribes to module-level Blueprint_Event_Observer:
    handoff events -> Recent_Handoff_Events_Ring
    role phase events -> Recent_Phase_Events_Ring
  calls createBlueprintRuntimeSceneData(...)
  renders agents, labels, lines, empty hint
  exposes DEV-only window.__whybuddy3dScene snapshot
```

### Why the Store Shape Stays Stable

The current `BlueprintRealtimeState` already exposes `subscribedJobId`, `rolePhases`, and `roleRuntimeStates`, which are enough to derive the agent set. The previous draft assumed extra state fields that do not exist. Adding those fields would expand the store contract for every autopilot panel.

Instead, this spec adds a narrow observer surface:

```ts
type BlueprintRealtimeEventListener = (event: BlueprintRelayedEvent) => void

export function subscribeBlueprintRealtimeEvents(
  listener: BlueprintRealtimeEventListener
): () => void
```

Implementation:

- A module-level `Set<BlueprintRealtimeEventListener>` lives in `blueprint-realtime-store.ts`.
- `dispatchEvent(event)` calls listeners synchronously before or after reducer updates.
- The observer does not write state, does not appear in `BlueprintRealtimeState`, and does not require components to wrap or replace the `dispatchEvent` action.
- `BlueprintRuntimeAgents` subscribes on mount and unsubscribes on unmount.

This avoids the fragile pattern of mutating the Zustand action with `setState({ dispatchEvent: wrapped })`.

## Components and Interfaces

### Component Map

- `client/src/components/Scene3D.tsx`
  - Continues to own `<Canvas>`.
  - Passes `mode`, `activeJobId`, `latestJobId`, `isReplay`, and `activeStage` down to `PetWorkers`.
  - Renders the DOM marker adjacent to `<Canvas>`:
    `<div data-testid="whybuddy-3d-shell" data-mode={mode} />`.

- `client/src/components/three/PetWorkers.tsx`
  - Becomes the Pet_Workers_Shell.
  - Preserves `export function PetWorkers(...)`.
  - Mounts `BlueprintRuntimeAgents` only for `mode === "blueprint"`.
  - Mounts `MissionFirstAgents` only for `mode === "mission-first"`.
  - Does not render React DOM because it is mounted inside React Three Fiber.

- `client/src/components/three/MissionFirstAgents.tsx`
  - Contains the existing mission-first 8-pet implementation moved out of `PetWorkers.tsx`.
  - Keeps existing `useGLTF`, `useFrame`, store selectors, helpers, JSX behavior, positions, and animations.
  - May add a root `group.userData.shellMarker = "mission-first"` for the DEV snapshot.
  - Does not depend on `BlueprintRuntimeAgents`.

- `client/src/components/three/BlueprintRuntimeAgents.tsx`
  - Reads `rolePhases` and `roleRuntimeStates` via fine-grained selectors.
  - Subscribes to `subscribeBlueprintRealtimeEvents`.
  - Maintains `recentHandoffEventsRef` and `recentPhaseEventsRef`.
  - Passes a snapshot into `createBlueprintRuntimeSceneData`.
  - Renders one runtime agent per unique role.
  - Renders connection lines from the priority chain.
  - Renders Empty_State_Hint when no roles exist.
  - Exposes `window.__whybuddy3dScene` in DEV.

- `client/src/components/three/scene-fusion/blueprint-runtime-scene.ts`
  - Pure data factory and layout helpers.
  - No Three.js imports.

- `client/src/components/three/scene-fusion/connection-line-priority.ts`
  - Pure connection-line derivation.
  - No Three.js imports.

- `client/src/components/three/scene-fusion/role-display-label.ts`
  - `displayLabel(roleId, locale)`.
  - Shared by right-rail chips and 3D nameplates.

## Data Models

### Blueprint Runtime Scene Data

### Factory Signature

```ts
function createBlueprintRuntimeSceneData(input: {
  locale: AppLocale
  rolePhases: Record<string, RolePhase>
  roleRuntimeStates: Record<string, RoleRuntimeState>
  handoffEvents: BlueprintRelayedEvent[]
  phaseEvents: BlueprintObservedPhaseEvent[]
  activeStage?: AutopilotStage
  isReplay: boolean
  now: number
}): BlueprintRuntimeSceneData
```

### View Model

```ts
type FunctionalZone =
  | "intake"
  | "repository"
  | "architect"
  | "runtime"
  | "quality"
  | "memory"
  | "experience"
  | "standby"

type PhaseTier = "main" | "secondary" | "faded" | "standby" | "failed"

interface BlueprintObservedPhaseEvent {
  roleId: string
  phase: RolePhase
  timestamp: number
}

interface ZoneSlot {
  zone: FunctionalZone
  position: [number, number, number]
}

interface BlueprintRuntimeAgent {
  roleId: string
  label: string
  animal: string
  // Accent color for NON-BODY scene UI only. Currently consumed by the
  // nameplate role-type icon row (tinted from colorOverride ?? accentColor);
  // reserved for ground ring / connection lines / capability chips. NEVER
  // written to the pet GLB body material — Kenney Cube Pets keep their own
  // authoritative colors.
  accentColor: string
  zone: FunctionalZone
  position: [number, number, number]
  phaseTier: PhaseTier
  emissive: number
  opacity: number
  amplitude: number
  colorOverride?: string
  enterDurationMs: number
  wasReanimatedThisRender?: boolean
}

interface BlueprintConnectionLine {
  from: string
  to: string
  directed: boolean
  source: "event-from-to" | "heuristic" | "stage-rule"
}

interface BlueprintRuntimeSceneData {
  agents: BlueprintRuntimeAgent[]
  connectionLines: BlueprintConnectionLine[]
  emptyHint: { visible: boolean; text: string }
}
```

## Labels

The right rail and 3D scene must not diverge. Both use:

```ts
displayLabel(roleId, locale)
```

Rules:

1. Call `resolveRoleLabel(roleId, locale)`.
2. If the result differs from `roleId`, return it.
3. If the result equals `roleId` and `roleId.startsWith("role-")`, strip `role-`, replace `-` with spaces, and Title-Case the result.
4. Otherwise return the raw `roleId`.

`resolveRoleLabel` remains compatible with its current passthrough property tests. `displayLabel` is the UI display layer used by both right rail and 3D.

## Zone Classification

Rules are evaluated top-down against `roleId.toLowerCase()`:

```text
intake     -> intake | coordinator | product
repository -> repository | analyst | analyzer
architect  -> architect | spec | planner | strategist
runtime    -> runtime | executor | dispatcher | operator
quality    -> quality | auditor | reviewer
memory     -> memory | curator | archivist
experience -> experience | presenter | director
standby    -> no match
```

### Layout: Centred Grid

`zone` still drives labels and stage-rule connection lines, but POSITION is no
longer a per-zone ring. Roles are laid out in a single tidy, centred grid so
the scene reads as an orderly room rather than scattered clusters. The
2026-05-29 layout revision replaced the per-zone ring anchors with this grid.

Grid fill order (groups same-zone roles next to each other):

```text
ZONE_GRID_ORDER = intake -> repository -> architect -> runtime
                  -> quality -> memory -> experience -> standby
```

Grid constants (`blueprint-runtime-scene.ts`):

```text
GRID_COLUMNS    = 4       max cells per row before wrapping deeper
GRID_SPACING_X  = 2.4 m   horizontal spacing between adjacent cells
GRID_SPACING_Z  = 2.8 m   depth spacing between rows
GRID_ORIGIN_Z   = -2.2 m  front row z; deeper rows step toward the back wall
```

The spacing was widened (from the initial 1.5 / 1.6 / -1.2) so each role has
room for its own workstation (desk + computer) in front without crowding the
row ahead. The depth step is larger than the width step because each role's
desk extends toward the camera.

Positioning (`assignRuntimeRoleSlots` → `gridPosition`):

- De-dupe `roleId`s, then sort by `(ZONE_GRID_ORDER index of classifyZone(roleId), roleId)`.
  This makes the fill order deterministic AND keeps same-zone roles adjacent,
  independent of the input array order.
- Fill the grid left→right, front→back: `row = floor(index / 4)`, `col = index % 4`.
- Each row is horizontally centred on its own width, so a short final row still
  reads as centred rather than left-justified:
  `rowWidth = (cellsInRow - 1) * GRID_SPACING_X`, `x = col * GRID_SPACING_X - rowWidth / 2`.
- `z = GRID_ORIGIN_Z + row * GRID_SPACING_Z`; `y = 0` (agents stand on the floor).
- Distinct roles always get distinct cells (Requirement 4.7), and the same set
  of `roleId`s always yields the same `Map` (Requirement 4.2 / 4.3).
- Tests must verify 5 same-zone roles receive distinct positions and that the
  mapping is order-independent and stable.

`stableHash` is still used for the deterministic animal model and color picks
(below), but no longer participates in positioning.

Hash:

```ts
function stableHash(roleId: string): number {
  let h = 5381
  for (const c of roleId) {
    h = ((h * 33) ^ c.codePointAt(0)!) | 0
  }
  return h >>> 0
}
```

### Per-role Workstation (desk + computer)

Each rendered role gets its own "hybrid" workstation — a desk with a monitor,
laptop, keyboard, mouse, and books — placed IN FRONT of the role
so the scene reads as an actual office of working agents rather than pets
standing on bare floor.

- The workstation reuses Kenney furniture GLBs (`FURNITURE_MODELS.desk`,
  `.computerScreen`, `.laptop`, `.computerKeyboard`, `.computerMouse`,
  `.books`), all preloaded by `Scene3D`, so no new asset
  cost is added. All props are positioned WITHIN the desk surface footprint
  (≈±0.5 x, ±0.25 z after `centerXZ`) so nothing reads as sliding off the desk
  edge.
- `BlueprintRuntimeAgents` clones the GLBs with a local `WorkstationModel`
  helper. Materials go through `preserveKenneyFurnitureMaterial` (the Kenney
  furniture body-color LOCK in `scene-theme.ts`), NOT the cold-office
  `rethemeFurnitureMaterial` repaint: the desk / monitor / keyboard / mouse /
  lamp / books keep their authoritative Kenney GLB colors (warm wood, etc.).
  The helper only tunes `roughness` / `metalness` and adds a narrow,
  name-matched screen/lamp emissive; it NEVER writes a body `material.color`.
  A source-level guard test asserts `WorkstationModel` uses the preserve helper
  and never references `rethemeFurnitureMaterial`.
- Scale + placement (this fixes the earlier "models floating in the air" /
  role-vs-desk misalignment). The workstation is composed as three nested
  groups:
  - **outer group** — WORLD anchor at the role's Grid_Position.
  - **middle group** — pushed `DESK_FRONT_OFFSET_Z = 0.55 m` toward the camera
    (+z) and scaled by `WORKSTATION_SCALE = BASE_AGENT_SCALE * 2.1`. The desk is
    rendered noticeably LARGER than the pet (a real desk is wider than the pet,
    so a 1:1 pet scale read as a toy); it stays floor-aligned at y=0, so scaling
    keeps the desk base on the floor and the surface at a believable height. The
    offset is tuned so the desk's BACK edge sits at the role (the desk half-depth
    at this scale is ≈0.5m), making the pet read as standing at its own desk
    rather than with a gap behind it.
  - **inner group** — rotated 180° so the monitor faces back toward the role;
    the props sit on the desk surface at model-space `DESK_SURFACE_Y = 0.392`.
    The desk GLB additionally gets an X-only stretch (`DESK_WIDTH_SCALE = 2`) so
    it reads as a WIDE workstation; only the desk is stretched (props keep their
    natural size and are spread across the wider top).
- The workstation is rendered as a SIBLING of the bobbing pet group (not a
  child), so it keeps its scale and stays still while the role bobs. There is
  one workstation per currently-rendered agent.
- The pet body clone is floor-aligned AND centred on XZ to the same origin the
  desk uses (`centerXZ`), so the role sits directly behind its own desk. Without
  the XZ centre, an off-centre Kenney GLB pivot makes the pet appear beside its
  desk rather than aligned with it (the "未对齐" look).

## Capability→role Binding (capability chips)

The capability bridge panel answers "which capabilities ran" but not "who ran
them". This feature binds live capability invocations to the roles on stage so
each role shows a lightweight capability chip strip, and the right-rail panel
stays as the detailed audit surface.

### Data source

`capability.*` events from the backend carry the authoritative `roleId`,
`invocationId`, and `capabilityId` (see `server/routes/blueprint.ts`
`CapabilityInvoked`). The store now keeps two slices:

- `capabilityStatuses: Record<capabilityId, CapabilityStatus>` —
  `idle | invoking | completed | failed` (existing).
- `capabilityOwners: Record<capabilityId, { roleId, invocationId?, updatedAt }>`
  — the authoritative owner captured from the event `roleId` (and from the
  role-container loader path, whose id already encodes its owner). NEW; reset on
  subscribe/unsubscribe like the other per-job slices.

The binding is computed against the same Effective_Role_Phases the scene
renders, so chips only ever attach to a role that is actually on stage.
`capabilityOwners` is intentionally a latest-by-capability snapshot, not a full
invocation history; full history remains in the right-rail audit surfaces.

### Pure binding module

`client/src/components/three/scene-fusion/capability-role-binding.ts` exports
`deriveCapabilityRoleBindings(input)` → `Map<roleId, RoleCapabilityChip[]>`.
It is pure, Three.js-free, and deterministic. Precedence per capability id:

1. **`event-role`** — the authoritative `capabilityOwners[capabilityId].roleId`
   when that role is on stage. HIGHEST priority: a real owner always beats any
   guess (`inferred = false`).
2. **`loader-id`** — `role-container-loader:<roleId>` parsed directly; bound to
   that role if on stage (`inferred = false`). If the role is OFF stage the
   capability stays unowned — it already names an authoritative role, so it is
   never re-attributed to anyone else.
3. **`capability-heuristic`** — a registry maps well-known capability ids
   (`aigc-spec-node`, `docker-analysis-sandbox`, `mcp-github-source`,
   `role-system-architecture`, `skill-svg-architecture`, …) to ordered
   candidate role tokens; the first on-stage role whose id `includes` a token
   wins (`inferred = true`). Only reached when no real owner / loader applies.
4. **`active-role`** — if EXACTLY one role is in an active phase
   (`acting | thinking | reviewing | activated`), still-unowned capabilities
   attach to it (`inferred = true`). The exactly-one guard avoids misattributing
   a capability when several roles are active.
5. **`unowned`** — anything else is omitted from the map and stays in the
   right-rail audit panel only.

Each `RoleCapabilityChip` carries `{ capabilityId, ownerRoleId, ownerSource,
displayName, iconKey, status, inferred }`. `iconKey` is a STRING (not a React
component) so the module stays render-framework-free; the renderer maps it to a
lucide icon. `displayName` is a human-readable name (or a humanized id for
unknown capabilities) — the raw machine id never renders on-scene. Chips within
a role are ordered by confidence then `capabilityId`, and the helper tolerates
undefined / non-object inputs (first render / SSR) by returning an empty map.

### Rendering

`BlueprintRuntimeAgents` reads `capabilityStatuses` + `capabilityOwners`,
derives the binding map (memoized on those + Effective_Role_Phases + stage +
locale), and renders a `RoleCapabilityChips` strip per role. The strip is its
OWN floor-level `<Html>` anchored at the role's desk (NOT inside the bobbing
head nameplate, NOT a heavy white card), so it stays still while the role bobs
and does not reintroduce the "floating card" look the nameplate revision
removed. It shows up to `MAX_ROLE_CAPABILITY_CHIPS` chips on a single line
(icon + name + status dot), overflow collapsing into `+N`. Status dot colors:
running = cyan (pulsing), completed = green, failed = red, idle = slate.
Inferred chips render at reduced opacity with an `(inferred)` tooltip suffix;
the full `capabilityId` is available only in the chip `title`.

## Phase Visual Mapping

```text
Phase_Tier   phases                                      emissive  opacity  amplitude
main         acting | thinking | reviewing | activated   1.00      1.00     1.0
secondary    observing                                   0.60      0.85     0.7
faded        completed                                   0.25      0.60     0.4
standby      idle | sleeping                             0.00      0.50     0.2
failed       failed                                      1.00      1.00     1.2 + red override
```

The `emissive` and `opacity` columns remain part of the `phaseTierVisuals` view-model (consumed by tests, the DEV bridge snapshot, and reserved for future use), but the rendering layer (`BlueprintRuntimeAgents`) consumes ONLY the `amplitude` column for steady-state visuals. The role body shows its natural GLB material shading: there is no phase-driven emissive glow, no coloured self-lit film, no per-agent point light, and no bloom. `opacity` is reserved exclusively for the enter/exit lifecycle tween. This 2026-05-29 visual revision removed the body emissive overlay that read as a "发光蒙层" on every role.

### Kenney body-color lock

Kenney Cube Pets GLBs ship with their own authoritative per-animal material
colors (red fox, yellow chick/giraffe, pink pig, white panda, etc.). The role
ACCENT color (`accentColor`, from `pickAccentColor`) and the phase
`colorOverride` are for non-body scene accents ONLY — currently the nameplate
role-type icon row (tinted from `agent.colorOverride ?? agent.accentColor`),
and reserved for the ground ring / connection lines / capability chips. They
MUST NEVER be written into the pet body `material.color` or `material.emissive`;
doing so produced the rejected "发光蒙层" and washed the pets away from their
real colors. The renderer's per-mesh body loop only:

- clones the material per instance (so two roles sharing an animal don't bleed),
- lowers `roughness` (capped at ≈0.55) and zeroes `metalness` for toy-plastic
  specular relief. The scene has NO environment map, so `envMapIntensity` is a
  no-op — `roughness` is the lever that actually interacts with the existing
  directional / spot / point lights, restoring the highlight/relief the matte
  default washed out, WITHOUT touching `material.color` / `material.emissive`,
- sets transparency / depth flags for the enter/exit tween.

A source-level guard test (`blueprint-runtime-agents.harness.test.tsx`) slices
the `RuntimeAgent` function body and asserts it contains NO body material color
or emissive write of any kind (`.color =`, `.color.set(`, `.emissive =`,
`.emissive.set(`, `.emissiveIntensity =`, …) — not just literal `agent.accentColor`
writes — so an aliased re-dye can't slip past. Global tone mapping (ACES) and
the office lighting are intentionally left unchanged to avoid disturbing the
rest of the scene; only the pet material `roughness` / `metalness` are tuned.

## Event Observation and Line Priority

### Event Observer

`blueprint-realtime-store.ts` exports:

```ts
export type BlueprintRealtimeEventListener = (
  event: BlueprintRelayedEvent
) => void

export function subscribeBlueprintRealtimeEvents(
  listener: BlueprintRealtimeEventListener
): () => void
```

The implementation stores listeners in a module-level `Set`. Inside `dispatchEvent(event)`, after validating the event shape, call all listeners. Listener failures are caught and do not break the store reducer.

### Buffers in BlueprintRuntimeAgents

```ts
const recentHandoffEventsRef = useRef<BlueprintRelayedEvent[]>([])
const recentPhaseEventsRef = useRef<BlueprintObservedPhaseEvent[]>([])

useEffect(() => {
  return subscribeBlueprintRealtimeEvents((event) => {
    const payload = event.payload ?? {}
    const timestamp =
      typeof event.timestamp === "number"
        ? event.timestamp
        : new Date(event.timestamp).getTime()

    if (
      typeof payload.fromRoleId === "string" &&
      payload.fromRoleId.length > 0 &&
      typeof payload.toRoleId === "string" &&
      payload.toRoleId.length > 0
    ) {
      pushRing(recentHandoffEventsRef.current, event, 32)
    }

    const roleId = readRoleIdFromBlueprintPayload(payload)
    const phase = mapEventTypeToPhase(event.type)
    if (roleId && phase && Number.isFinite(timestamp)) {
      pushRing(recentPhaseEventsRef.current, { roleId, phase, timestamp }, 64)
    }
  })
}, [])
```

This feature exports existing `mapEventTypeToPhase` from `blueprint-realtime-store.ts`. It also adds and exports `readRoleIdFromBlueprintPayload(payload: Record<string, unknown>): string | undefined` as a pure helper in the same file.

### Priority Chain

```ts
function deriveConnectionLines(input: {
  handoffEvents: BlueprintRelayedEvent[]
  phaseEvents: BlueprintObservedPhaseEvent[]
  rolePhases: Record<string, RolePhase>
  activeStage?: AutopilotStage
  now: number
}): BlueprintConnectionLine[] {
  const recentHandoffs = input.handoffEvents.filter(
    (event) => input.now - toTimestamp(event.timestamp) <= 30_000
  )
  if (recentHandoffs.length > 0) {
    return recentHandoffs.map(toDirectedHandoffLine)
  }

  const heuristic = inferPhaseHandoffs(input.phaseEvents, 2_000, input.now)
  if (heuristic.length > 0) {
    return heuristic.map((line) => ({
      ...line,
      directed: false,
      source: "heuristic",
    }))
  }

  const stageRule =
    input.activeStage ? STAGE_RULES[input.activeStage]?.(input.rolePhases) ?? [] : []
  if (stageRule.length > 0) {
    return stageRule.map((line) => ({
      ...line,
      directed: false,
      source: "stage-rule",
    }))
  }

  return []
}
```

`spec_tree` rule:

```ts
STAGE_RULES.spec_tree = (rolePhases) => {
  const find = (token: string) =>
    Object.keys(rolePhases).find((id) => id.toLowerCase().includes(token))

  const analyst = find("analyst")
  const architect = find("architect")
  const auditor = find("auditor")
  const lines: Array<{ from: string; to: string }> = []
  if (analyst && architect) lines.push({ from: analyst, to: architect })
  if (architect && auditor) lines.push({ from: architect, to: auditor })
  return lines
}
```

## Empty State

The scene renders Effective_Role_Phases, the merge of Stage_Seed_Roles and real `rolePhases` (see "Stage-role seeding (Fix 2)"). The empty hint is gated on Effective_Role_Phases being empty, not on raw `rolePhases` being empty. This distinguishes two cases:

- **Truly empty (no task context):** `activeStage` is `undefined` and `rolePhases` is empty, so `deriveStageSeedRolePhases(undefined)` returns `{}` and Effective_Role_Phases is empty. A brand-new blank autopilot page stays empty and shows the hint.
- **Stage active but no real events yet:** `activeStage` is one of the seeded stages, so Stage_Seed_Roles is non-empty and Effective_Role_Phases is non-empty even before `rolePhases` arrives. The hint is hidden and seeded agents render at their seeded phase.

When Effective_Role_Phases is empty:

- `agents = []`.
- `connectionLines = []`.
- `emptyHint.visible = true`.
- The rendered text is:

```text
等待任务启动...
Waiting for task...
```

The text sits at floor center, slightly above the floor to avoid z-fighting, rotated flat against the ground.

## Stage-role seeding (Fix 2)

Early stages should not show a blank stage while waiting for the first real role event. `blueprint-runtime-scene.ts` seeds a deterministic roster of canonical runtime roles per stage, then the factory merges real `rolePhases` over the seed so real events always win per `roleId`.

These seeded roles are **canonical runtime roles**, not the rejected legacy 7 fixed slots. Each seeded `roleId` is present in `ROLE_LABELS`, resolves to a full name via `displayLabel`, and is classified into a Functional_Zone by the same `classifyZone` rules as real roles.

```ts
const STAGE_SEED_ROLES: Partial<Record<AutopilotStage, string[]>> = {
  input: ["intake-coordinator"],
  clarification: ["intake-coordinator", "product-strategist"],
  route_generation: ["product-strategist", "repository-analyst"],
  spec_tree: ["repository-analyst", "spec-architect", "role-quality-auditor"],
}

function deriveStageSeedRolePhases(
  activeStage?: AutopilotStage
): Record<string, RolePhase> {
  const roster = activeStage ? STAGE_SEED_ROLES[activeStage] ?? [] : []
  const seed: Record<string, RolePhase> = {}
  for (const roleId of roster) {
    seed[roleId] = "activated"
  }
  return seed
}
```

Each seeded role is assigned the seed phase `activated`, which maps to the `main` Phase_Tier (fully visible) before any real event arrives. Any other `activeStage` value, or `undefined`, produces an empty seed.

The factory computes Effective_Role_Phases by merging the seed under real `rolePhases`:

```ts
const effective = { ...deriveStageSeedRolePhases(input.activeStage), ...input.rolePhases }
```

Because `rolePhases` is spread last, a real `rolePhases[roleId]` overrides the seeded phase for that role, while seeded-but-not-yet-real roles remain visible at their seeded phase. When real `role.*` / `role.agent.*` events later populate `rolePhases`, the affected roles update their phase, animation, and lines from the real events without removing the still-seeded roles for the current stage. The factory derives agents and zones from Effective_Role_Phases; the render-layer connection-line re-derivation uses the same Effective_Role_Phases map so stage-rule fallback can attach to seeded agents before real events arrive.

## Role agent reasoning → rolePhases (Fix 1)

`mapEventTypeToPhase(type)` in `client/src/lib/blueprint-realtime-store.ts` previously mapped only the coarse `role.*` lifecycle events and returned `null` for the 7 `role.agent.*` reasoning events, so reasoning iterations never reached `rolePhases`. This feature adds the 7 `role.agent.*` cases:

```text
role.agent.iteration_started    -> activated
role.agent.thinking             -> thinking
role.agent.acting               -> acting
role.agent.observing            -> observing
role.agent.iteration_completed  -> observing   (NOT completed — see rationale)
role.agent.completed            -> completed
role.agent.error                -> failed
```

`role.agent.iteration_completed` deliberately maps to `observing` rather than `completed`. A multi-iteration role would otherwise flash to the faded `completed` tier between iterations and snap back to an active tier on the next iteration. The faded `completed` tier is reserved for the terminal `role.agent.completed` event.

No reducer change is required beyond the mapping. The dispatch reducer already has a `if (type.startsWith("role."))` branch that calls `mapEventTypeToPhase(type)` and writes `rolePhases[roleId]` when the result is non-null. `role.agent.*` types match that prefix, the server emitter puts `roleId` in both the event top-level and `payload.roleId` (extracted by the existing `readRoleIdFromPayload`), so once the mapping returns a phase the value flows into `rolePhases` automatically. No new `BlueprintRealtimeState` field is added. The existing `role.agent.*` → `agentReasoning` slice behavior is untouched; both branches run in parallel.

## Replay Timing

`BlueprintRuntimeAgents` receives:

```ts
interface BlueprintRuntimeAgentsProps {
  isReplay?: boolean
  latestJobId?: string
  activeJobId?: string
  activeStage?: AutopilotStage
}
```

Replay detection:

1. If `isReplay` is boolean, use it.
2. Else, if `latestJobId` and `activeJobId` exist, replay is `latestJobId !== activeJobId`.
3. Else replay is `false`.

Enter duration:

- replay: `333ms`
- live: `500ms`

`seenRoleIdsByJobId` lives in a component ref. It is not stored globally and is not persisted.

## DEV Scene Bridge

In DEV only:

```ts
window.__whybuddy3dScene = {
  getSnapshot: () => ({
    mode,
    mountedShell,
    agents,
    connectionLines,
    emptyHintVisible,
  }),
  dispatchEvent: (event) =>
    useBlueprintRealtimeStore.getState().dispatchEvent(event),
}
```

Snapshot data is derived from refs updated by rendered view-model data. Tests assert snapshot values, not canvas DOM internals.

## Error Handling

- `subscribeBlueprintRealtimeEvents` listener failures are caught and isolated so a scene bridge or rendering observer cannot break `dispatchEvent` reducer behavior.
- Invalid, missing, or non-string `payload.fromRoleId` / `payload.toRoleId` values are ignored for handoff lines rather than coerced into bogus endpoints.
- Invalid, missing, or non-finite timestamps are ignored for phase-event heuristics; the scene then falls back to stage rules or no lines.
- Unknown role IDs remain renderable. `displayLabel` preserves canonical/fuzzy label behavior, Title-Cases unknown `role-*` IDs, and passes other unknown IDs through unchanged.
- Empty Effective_Role_Phases is handled as a valid waiting state, not an error: zero agents, no lines, and Empty_State_Hint visible. Empty raw `rolePhases` alone is not a waiting state when `activeStage` supplies Stage_Seed_Roles.

## Testing Strategy

### Pure Vitest Tests

- `blueprint-runtime-scene.test.ts`
  - zone classification
  - stable hash determinism
  - animal/color stability
  - overflow distinctness
  - empty-state factory output
  - stage seed derivation per stage (`deriveStageSeedRolePhases`)
  - merge precedence: real `rolePhases` override seeded phases per `roleId`
  - empty-vs-seeded distinction (truly empty `undefined` stage vs seeded active stage)

- `connection-line-priority.test.ts`
  - real handoff events win
  - heuristic uses phase events, not handoff-only events
  - stage rule fallback works for `spec_tree`
  - no-lines case still returns agents from the scene factory
  - non-real lines are undirected

- `capability-role-binding.test.ts`
  - loader-id binding (`role-container-loader:<roleId>`)
  - capability-type heuristic binding
  - single-active-role fallback + EXACTLY-one guard
  - unowned capabilities omitted (audit-only)
  - per-role chip ordering by confidence then id + determinism
  - display meta (human names, not machine ids) + status collapse

- `role-display-label.test.ts`
  - canonical labels match `resolveRoleLabel`
  - unknown `role-foo-bar` becomes `Foo Bar`
  - unknown non-`role-` values pass through
  - both right-rail and 3D callers can use the same helper

### Component Harness

The current repository has Vitest and React dependencies, but does not have a JSDOM, happy-dom, or Testing Library project configured. The component harness follows the existing right-rail test style: use `react-dom/server.renderToStaticMarkup`, DEV bridge snapshot refs, direct `subscribeBlueprintRealtimeEvents` listener dispatch, and pure factory calls. This spec does not add JSDOM, happy-dom, Testing Library, or a new Vitest DOM project.

Harness coverage:

- P1: empty blueprint state
- P2: single role appears
- P3: 8-zone multi-role layout
- P4: phase tier transitions
- P5: mission-first shell mounts and blueprint shell does not
- P6: replay enter duration
- P7: connection-line priority chain
- P8: right-rail/3D label parity
- P9: undirected flags for heuristic and stage-rule lines
- P10: `Scene3D` DOM marker has the active `data-mode`

### Existing Regression Tests

- `client/src/components/three/scene-fusion/__tests__/role-id-bridge.test.ts` remains unchanged and continues to pass.
- `client/src/pages/autopilot/right-rail/__tests__/role-labels.property.test.ts` continues to pass for `resolveRoleLabel`; any additional display behavior is covered by `role-display-label.test.ts`.

### Out of Scope

Playwright browser e2e is not part of this spec. The repository already has `@playwright/test`, but this feature does not create a Playwright gate, auth fixture, or `tests/e2e` structure. That belongs in a separate browser-validation spec.

## Risks and Mitigations

- **Risk:** Mission-first behavior changes during extraction.
  **Mitigation:** Keep extraction conservative, run existing `role-id-bridge.test.ts`, add shell-level harness coverage, and inspect the diff for unintended logic edits.

- **Risk:** Event observation becomes global hidden state.
  **Mitigation:** Use a narrow module-level listener set with explicit unsubscribe. Do not mutate the Zustand action and do not add state fields.

- **Risk:** Heuristic lines become misleading.
  **Mitigation:** Real handoff events always win. Heuristic and stage-rule lines are undirected and source-tagged.

- **Risk:** The harness diverges from real WebGL rendering.
  **Mitigation:** Harness asserts view-model and bridge data. Browser canvas validation is deferred to a Playwright spec.

## Correctness Properties

### Property 1: One Agent Per Role

For any blueprint Effective_Role_Phases snapshot, rendered agent count equals the unique roleId count.

**Validates: Requirements 1.1, 2.1, 2.2**

### Property 2: Stable Placement

For any roleId, zone, position, animal, and accent color are stable across re-renders in the same subscribed job.

**Validates: Requirements 2.13, 2.14, 4.2, 4.3**

### Property 3: Phase Visual Mapping

Phase differentiation is expressed through per-agent bob (animation) amplitude only; the role body carries no phase-driven emissive glow and is never dyed with the role accent / override color (Kenney body-color lock). The amplitude for a role equals the `amplitude` value of `phaseTierVisuals(phaseTierOf(phase))`.

**Validates: Requirements 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**

### Property 4: Label Parity

Right-rail chips and 3D nameplates both use `displayLabel`.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 5: Connection Priority

`event-from-to` beats `heuristic`, `heuristic` beats `stage-rule`, and absent all three there are no lines.

**Validates: Requirements 5.5, 5.6, 5.7, 5.8, 5.9**

### Property 6: Mission-First Non-Interference

In mission-first mode, BlueprintRuntimeAgents is not mounted and its role data path does not execute.

**Validates: Requirements 7.1, 7.4, 7.5**

### Property 7: Store Shape Invariance

`BlueprintRealtimeState` top-level fields remain unchanged by this feature.

**Validates: Requirements 2.15, 5.2, 6.6**

### Property 8: Stage Seed Merge Precedence

For any `activeStage` and `rolePhases`, Effective_Role_Phases equals `{ ...deriveStageSeedRolePhases(activeStage), ...rolePhases }`; real phases override seeded phases per `roleId`.

**Validates: Requirements 11.8, 11.10**

### Property 9: role.agent.* Phase Mapping

`mapEventTypeToPhase` returns the documented phase for each of the 7 `role.agent.*` events and writes `rolePhases` via the existing `role.`-prefix branch.

**Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9**

### Property 10: Capability→role Binding Precedence

For any `capabilityStatuses`, `capabilityOwners`, and Effective_Role_Phases, `deriveCapabilityRoleBindings` binds each capability by the precedence `event-role` → `loader-id` → `capability-heuristic` → `active-role` (the real event owner always beats a guess; an off-stage loader/event owner stays unowned rather than re-attributed; the active-role fallback fires only when exactly one role is active), omits unbindable capabilities, and is order-independent + deterministic.

**Validates: Requirements 12.1, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.11**
