/**
 * Blueprint_Runtime_Agents — real `rolePhases`-driven 3D blueprint scene.
 *
 * Wave 3 (tasks 11, 12, 13) — this component is the rendering layer behind the
 * pure `createBlueprintRuntimeSceneData` factory:
 *
 *   - Task 11: render one GLB pet per `sceneData.agents[]`, applying the
 *     phase-tier shader emissive intensity + opacity + bob amplitude and the
 *     `failed` red emissive override. NO per-agent point lights, NO bloom
 *     (Requirements 2.11, 2.12) — emissive uniforms only.
 *   - Task 12: enter / exit / replay timing. `useIsReplay` derives Replay_Mode
 *     from props; a per-agent lifecycle (kept in refs) tweens scale 0.7→1.0 and
 *     opacity 0→1 over `agent.enterDurationMs` (500 live / 333 replay), exits
 *     over 300ms then unmounts, and skips the enter animation for a `roleId`
 *     shared across a historical→historical job switch (Requirement 6.5).
 *   - Task 13: the ground Empty_State_Hint, rendered from
 *     `sceneData.emptyHint` when no live roles exist.
 *
 * The `BlueprintRuntimeAgentsProps` interface is the stable Wave-0 contract and
 * must not change. The root `<group userData={{ shellMarker: "blueprint" }}>`
 * is likewise preserved so the DEV scene bridge (task 17) and the harness can
 * detect which shell mounted.
 *
 * Wave 4 (tasks 15, 16) — event rings + connection lines:
 *
 *   - Task 15: subscribe to the module-level `subscribeBlueprintRealtimeEvents`
 *     observer and maintain two FIFO `useRef` rings updated OUTSIDE React
 *     render — `recentHandoffEventsRef` (cap 32) and `recentPhaseEventsRef`
 *     (cap 64). Because the rings mutate outside render, a throttled
 *     (~250ms / ≤4x per second) re-derivation cadence in a `setInterval`
 *     effect re-runs `deriveConnectionLines` against the rings and only calls
 *     `setState` when the derived line set actually changes (compared by a
 *     cheap content key) to avoid render thrash (Requirements 5.1-5.6).
 *   - Task 16: render the derived `BlueprintConnectionLine[]` as drei `<Line>`
 *     siblings of the agents. Directed `event-from-to` lines get a small cone
 *     arrowhead near the `to` endpoint and a thicker stroke; heuristic /
 *     stage-rule lines are thinner, lower-opacity, and undirected. Lines whose
 *     endpoints are not currently rendered agents are skipped
 *     (Requirements 5.7-5.10).
 *
 * The pure `createBlueprintRuntimeSceneData` factory still returns
 * `connectionLines: []` (it ignores `handoffEvents` / `phaseEvents` this wave);
 * the authoritative line source for RENDERING is the SEPARATE
 * `deriveConnectionLines` call against the rings. The DEV-bridge snapshot ref
 * now carries the currently derived lines so task 17's bridge and the P7 / P9
 * harness can read them.
 *
 * The DEV `window.__whybuddy3dScene` bridge itself is installed in Wave 5
 * (task 17); this component only keeps the snapshot data available in a ref so
 * that task can expose it without re-deriving anything.
 *
 * Spec: .kiro/specs/whybuddy-3d-real-role-driven-scene-2026-05-29
 * Acceptance: Requirements 1.1-1.6, 2.1-2.12, 5.1-5.10, 6.1-6.6.
 */

import { Html, Line, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  Archive,
  Boxes,
  CircleDot,
  ClipboardList,
  Cpu,
  DraftingCompass,
  Github,
  Network,
  PenTool,
  Presentation,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { PET_MODELS, FURNITURE_MODELS } from "@/lib/assets";
import {
  mapEventTypeToPhase,
  readRoleIdFromBlueprintPayload,
  subscribeBlueprintRealtimeEvents,
  useBlueprintRealtimeStore,
  type BlueprintRelayedEvent,
} from "@/lib/blueprint-realtime-store";
import type { AppLocale } from "@/lib/locale";
import { FUTURE_OFFICE_COLORS, preserveKenneyFurnitureMaterial } from "@/lib/scene-theme";
import { useAppStore } from "@/lib/store";

import { deriveConnectionLines } from "./scene-fusion/connection-line-priority";
import {
  createBlueprintRuntimeSceneData,
  deriveStageSeedRolePhases,
  stableHash,
  type BlueprintConnectionLine,
  type BlueprintObservedPhaseEvent,
  type BlueprintRuntimeAgent,
  type BlueprintRuntimeSceneData,
  type FunctionalZone,
} from "./scene-fusion/blueprint-runtime-scene";
import {
  deriveCapabilityRoleBindings,
  MAX_ROLE_CAPABILITY_CHIPS,
  type CapabilityChipStatus,
  type CapabilityIconKey,
  type RoleCapabilityChip,
} from "./scene-fusion/capability-role-binding";

// TODO(Wave 4): No canonical `AutopilotStage` type is exported in the codebase
// yet (the nearest real unions are `AutopilotBackendStage` in
// `@/lib/autopilot-coordination/page-mapping` and `BlueprintSceneStageKey` in
// `./scene-fusion/blueprint-stage-signal`). This local alias keeps the props
// signature permissive for now; Wave 4 will refine it to the real stage union
// the owning page passes down.
type AutopilotStage = string;

export interface BlueprintRuntimeAgentsProps {
  isReplay?: boolean;
  latestJobId?: string;
  activeJobId?: string;
  activeStage?: AutopilotStage;
  roleLabels?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Timing + visual constants (design.md "Replay Timing" / "Phase Visual Mapping")
// ---------------------------------------------------------------------------

/** Exit animation duration (ms) before an agent is removed from the graph. */
const EXIT_DURATION_MS = 300;

/**
 * Base group scale for a blueprint runtime pet. The factory's enter tween
 * multiplies this base by `0.7 → 1.0`; the phase amplitude only drives the
 * vertical bob, not the resting scale.
 */
const BASE_AGENT_SCALE = 0.5;

/** Idle/bob frequency multiplier (radians/sec) for the vertical sine bob. */
const BOB_SPEED = 1.6;

/** Keep runtime pets visually above translucent office floor/glass accents. */
const BLUEPRINT_AGENT_RENDER_ORDER = 20;

/**
 * Peak vertical bob, in metres, at `amplitude === 1.0`. Mirrors the modest
 * amplitudes used by MissionFirstAgents (~8cm) so the two scenes read alike.
 */
const BOB_AMPLITUDE_METRES = 0.08;

// ---------------------------------------------------------------------------
// Connection-line constants (Task 16; Requirements 5.7-5.10)
// ---------------------------------------------------------------------------

/**
 * Cadence (ms) at which connection lines are re-derived from the mutable event
 * rings. The rings update OUTSIDE React render, so a throttled poll
 * (≤4x/second) re-runs `deriveConnectionLines` and only commits state when the
 * derived line set actually changed — never a per-frame setState.
 */
const LINE_REDERIVE_INTERVAL_MS = 250;

/**
 * Line anchor height (metres). Lifts the line off the floor for visibility,
 * consistent with MissionFirstAgents' `getFlowAnchor` (y 0.74).
 */
const LINE_ANCHOR_Y = 0.74;

/** Directed (`event-from-to`) lines read as higher-confidence: thicker + opaque. */
const DIRECTED_LINE_WIDTH = 1.6;
const DIRECTED_LINE_OPACITY = 0.5;

/** Undirected (heuristic / stage-rule) lines read as lower-confidence. */
const UNDIRECTED_LINE_WIDTH = 0.7;
const UNDIRECTED_LINE_OPACITY = 0.22;

/** Arrowhead cone dimensions for directed lines, in metres. */
const ARROW_CONE_RADIUS = 0.06;
const ARROW_CONE_HEIGHT = 0.2;

// ---------------------------------------------------------------------------
// Replay detection (design.md "Replay Timing"; Requirements 6.1, 6.2)
// ---------------------------------------------------------------------------

/**
 * Resolve Replay_Mode from props (design.md "Replay Timing"):
 *
 * 1. If `isReplay` is an explicit boolean, use it.
 * 2. Else, if both `latestJobId` and `activeJobId` are present, replay is
 *    `latestJobId !== activeJobId` (a historical job is selected).
 * 3. Else replay is `false`.
 *
 * This is a pure derivation (no React state) and reads no `BlueprintRealtimeState`
 * fields, satisfying Requirement 6.6 (store-shape invariance).
 */
function useIsReplay(props: BlueprintRuntimeAgentsProps): boolean {
  if (typeof props.isReplay === "boolean") {
    return props.isReplay;
  }
  if (props.latestJobId !== undefined && props.activeJobId !== undefined) {
    return props.latestJobId !== props.activeJobId;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-agent enter / exit lifecycle (Requirements 2.3, 2.4, 6.5)
// ---------------------------------------------------------------------------

type AgentLifecyclePhase = "entering" | "active" | "exiting";

interface AgentLifecycle {
  phase: AgentLifecyclePhase;
  /** `Date.now()` when the current phase began. */
  startedAt: number;
  /** Enter duration baked by the factory (500 live / 333 replay). */
  enterDurationMs: number;
  /**
   * Whether this mount actually played an enter animation. `false` for roles
   * mounted at scale 1 / opacity 1 without an enter (Requirement 6.5).
   */
  playedEnter: boolean;
}

/**
 * Snapshot shape kept available for the DEV scene bridge (wired in task 17).
 * Mirrors the `getSnapshot()` contract from Requirement 9.7 so task 17 can
 * expose it without re-deriving anything here.
 */
interface BlueprintSceneSnapshot {
  mode: "blueprint";
  mountedShell: "blueprint";
  agents: BlueprintRuntimeAgent[];
  connectionLines: BlueprintRuntimeSceneData["connectionLines"];
  emptyHintVisible: boolean;
}

// ---------------------------------------------------------------------------
// Event-ring helper (Task 15; Requirements 5.3, 5.4)
// ---------------------------------------------------------------------------

/**
 * Push `item` onto a FIFO ring buffer `arr`, mutating it in place, and evict
 * from the FRONT until the ring is within `max`. This is insertion-order
 * eviction (oldest first), NOT timestamp-window eviction — matching
 * Requirements 5.3 / 5.4. The arrays live in `useRef`s and are updated outside
 * React render, so a plain in-place mutation is intentional and cheap.
 */
function pushRing<T>(arr: T[], item: T, max: number): void {
  arr.push(item);
  while (arr.length > max) {
    arr.shift();
  }
}

/**
 * Cheap content key for a derived connection-line set, used to skip `setState`
 * when a re-derivation produced an identical line set (avoids render thrash on
 * the ~250ms cadence). Order matters: `deriveConnectionLines` returns a single
 * priority step's lines in a stable order, so a positional join is sufficient.
 */
function connectionLinesKey(lines: BlueprintConnectionLine[]): string {
  return lines
    .map((line) => `${line.source}:${line.directed ? "d" : "u"}:${line.from}->${line.to}`)
    .join("|");
}

// ---------------------------------------------------------------------------
// Single runtime agent renderer
// ---------------------------------------------------------------------------

const ROLE_TYPE_META: Record<
  FunctionalZone,
  { icon: LucideIcon; label: Record<AppLocale, string> }
> = {
  intake: {
    icon: ClipboardList,
    label: { "zh-CN": "需求输入", "en-US": "Intake" },
  },
  repository: {
    icon: Search,
    label: { "zh-CN": "仓库分析", "en-US": "Repository" },
  },
  architect: {
    icon: DraftingCompass,
    label: { "zh-CN": "规格架构", "en-US": "Architecture" },
  },
  runtime: {
    icon: Wrench,
    label: { "zh-CN": "运行执行", "en-US": "Runtime" },
  },
  quality: {
    icon: ShieldCheck,
    label: { "zh-CN": "质量审计", "en-US": "Quality" },
  },
  memory: {
    icon: Archive,
    label: { "zh-CN": "记忆归档", "en-US": "Memory" },
  },
  experience: {
    icon: Presentation,
    label: { "zh-CN": "体验呈现", "en-US": "Experience" },
  },
  standby: {
    icon: CircleDot,
    label: { "zh-CN": "待命协作", "en-US": "Standby" },
  },
};

function shouldShowRoleTypeText(roleTypeLabel: string, agentLabel: string): boolean {
  const normalizedType = roleTypeLabel.trim().toLocaleLowerCase();
  const primaryName = agentLabel.split("/")[0]?.trim().toLocaleLowerCase() ?? "";
  return normalizedType.length > 0 && normalizedType !== primaryName;
}

// ---------------------------------------------------------------------------
// Capability chip visuals (capability→role binding)
// ---------------------------------------------------------------------------

/** Stable empty chip list so roles with no bound capabilities skip re-renders. */
const EMPTY_CHIPS: RoleCapabilityChip[] = [];

/** Map a binding `iconKey` to a lucide icon for the role capability chips. */
const CAPABILITY_ICON: Record<CapabilityIconKey, LucideIcon> = {  container: Boxes,
  "spec-node": Sparkles,
  sandbox: Cpu,
  github: Github,
  "role-system": Network,
  svg: PenTool,
  mcp: Wrench,
  skill: Zap,
  capability: CircleDot,
};

/** Status dot color for a capability chip. */
function capabilityStatusColor(status: CapabilityChipStatus): string {
  switch (status) {
    case "running":
      return FUTURE_OFFICE_COLORS.cyan;
    case "completed":
      return FUTURE_OFFICE_COLORS.green;
    case "failed":
      return "#ef4444";
    case "idle":
    default:
      return FUTURE_OFFICE_COLORS.slate;
  }
}

/**
 * Lightweight capability chip strip for a role, anchored at the role's desk
 * (NOT over the head and NOT inside the bobbing nameplate). It renders as its
 * own floor-level `<Html>` sibling so it stays still while the role bobs and
 * does not reintroduce a heavy "floating card" over the pet.
 *
 * Each chip is a compact icon + status dot with the human-readable capability
 * name; the machine `capabilityId` stays in the `title` tooltip only. Shows up
 * to `MAX_ROLE_CAPABILITY_CHIPS` chips on a single line (no wrap), with overflow
 * collapsing into `+N`. Renders nothing when the role has no bound capability.
 */
function RoleCapabilityChips({
  chips,
  position,
}: {
  chips: RoleCapabilityChip[];
  position: [number, number, number];
}) {
  if (chips.length === 0) return null;
  const visible = chips.slice(0, MAX_ROLE_CAPABILITY_CHIPS);
  const overflow = chips.length - visible.length;

  return (
    <Html
      // Anchor at the desk in front of the role, just above the floor — clear of
      // the head nameplate and the bobbing body.
      position={[position[0], 0.05, position[2] + DESK_FRONT_OFFSET_Z * 0.5]}
      center
      distanceFactor={8}
      style={{ pointerEvents: "none" }}
    >
      <div className="flex max-w-[200px] flex-nowrap items-center justify-center gap-1">
        {visible.map((chip) => {
          const Icon = CAPABILITY_ICON[chip.iconKey];
          const dot = capabilityStatusColor(chip.status);
          const pulse = chip.status === "running";
          return (
            <span
              key={chip.capabilityId}
              className="flex items-center gap-1 whitespace-nowrap text-[9px] font-bold leading-none text-slate-700"
              style={{
                textShadow: "0 1px 0 rgba(255,255,255,0.92)",
                opacity: chip.inferred ? 0.75 : 1,
              }}
              title={
                chip.inferred
                  ? `${chip.capabilityId} (inferred)`
                  : chip.capabilityId
              }
            >
              <Icon className="size-2.5 shrink-0" aria-hidden="true" />
              <span>{chip.displayName}</span>
              <span
                className={pulse ? "animate-pulse" : undefined}
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 9999,
                  background: dot,
                  display: "inline-block",
                }}
                aria-hidden="true"
              />
            </span>
          );
        })}
        {overflow > 0 ? (
          <span
            className="whitespace-nowrap text-[9px] font-bold leading-none text-slate-500"
            style={{ textShadow: "0 1px 0 rgba(255,255,255,0.92)" }}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Per-role workstation (desk + computer) — 2026-05-29 layout follow-up
// ---------------------------------------------------------------------------

/**
 * The normalized Kenney `desk.glb` top sits at roughly y=0.392 in MODEL space
 * once its base is floor-aligned, matching `OfficeRoom`'s `DesktopDesk`. The
 * monitor / keyboard / lamp / books sit on that surface. These are MODEL-space
 * offsets — the whole workstation is then scaled by `WORKSTATION_SCALE`.
 */
const DESK_SURFACE_Y = 0.392;

/**
 * Scale applied to the whole workstation. It was previously locked to the pet's
 * resting scale (`BASE_AGENT_SCALE = 0.5`), which read too SMALL — a real desk
 * is wider than the pet, so a 1:1 scale made the workstation look like a toy in
 * front of the role. We render it noticeably larger than the pet (but still
 * floor-aligned, so the base stays on the floor and the surface sits at a
 * believable desk height for a seated/standing pet).
 */
const WORKSTATION_SCALE = BASE_AGENT_SCALE * 2.1;

/**
 * Distance (metres, WORLD space) the desk CENTRE sits IN FRONT of the role
 * (toward the camera, +z). The desk's half-depth at `WORKSTATION_SCALE` is
 * roughly 0.5m, so this offset places the desk's BACK edge right at the role —
 * the pet reads as standing at its own desk rather than a gap behind it. Applied
 * on the unscaled anchor group so it is independent of `WORKSTATION_SCALE`.
 */
const DESK_FRONT_OFFSET_Z = 0.75;

/** Move only the desk body to the right; props, roles, and chips stay put. */
const DESK_RIGHT_OFFSET_X = 0.7;

/** Move only desktop props to the right; independent from the desk body offset. */
const DESKTOP_PROPS_RIGHT_OFFSET_X = 0.2;

/**
 * Horizontal (X-only) stretch applied to the desk top so it reads as a WIDE
 * workstation. Only the desk GLB gets this non-uniform scale; the props keep
 * their natural size and are spread across the wider surface. Depth and height
 * stay at the desk's natural proportion.
 */
const DESK_WIDTH_SCALE = 2;

/**
 * Render one furniture GLB for a role's workstation: clone the graph +
 * materials, floor-align the base, optionally centre on XZ. Materials go
 * through `preserveKenneyFurnitureMaterial` — the Kenney body-color LOCK — so
 * the desk / monitor / keyboard / mouse / lamp / books keep their authoritative
 * Kenney GLB colors (warm wood, etc.) instead of being repainted into the cold
 * office palette. Only roughness/metalness and a narrow screen/lamp emissive
 * are tuned; no body `material.color` is ever written. Kept local so the
 * blueprint scene has no dependency on `OfficeRoom`'s non-exported helper.
 */
function WorkstationModel({
  url,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale,
  centerXZ = false,
}: {
  url: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  centerXZ?: boolean;
}) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    const next = scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(next);
    const minY = Number.isFinite(bounds.min.y) ? bounds.min.y : 0;
    const center = bounds.getCenter(new THREE.Vector3());

    next.position.y -= minY;
    if (centerXZ) {
      next.position.x -= center.x;
      next.position.z -= center.z;
    }

    next.traverse((child: THREE.Object3D) => {
      if (!("isMesh" in child) || !child.isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!mesh.material) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.clone())
        : mesh.material.clone();
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        preserveKenneyFurnitureMaterial(material, mesh.name, url);
      }
    });
    return next;
  }, [centerXZ, scene, url]);

  return (
    <primitive
      object={cloned}
      position={position}
      rotation={rotation}
      scale={scale ?? 1}
    />
  );
}

/**
 * A loaded "hybrid" workstation — desk + monitor + keyboard + mouse + desk lamp
 * + books — placed IN FRONT of a role, facing back toward the role (monitor
 * faces the pet, the pet faces the camera). Reuses Kenney furniture GLBs that
 * `Scene3D` preloads, so it adds no new asset cost.
 *
 * Layout structure (fixes the earlier floating / misalignment):
 *   - outer group: WORLD anchor at the role's grid slot, pushed `DESK_FRONT_
 *     OFFSET_Z` toward the camera. NOT scaled, so the offset stays in metres.
 *   - middle group: scaled by `WORKSTATION_SCALE` to match the pet, so the desk
 *     is proportional and its surface sits below the pet rather than near its
 *     head. Scaling a floor-aligned group at y=0 keeps the base on the floor.
 *   - inner group: rotated 180° so the monitor faces back toward the role.
 *
 * It is a SIBLING of the bobbing pet group, so it stays still while the role
 * bobs.
 */
function RoleWorkstation({
  position,
}: {
  position: [number, number, number];
}) {
  return (
    <group position={position}>
      <group
        position={[0, 0, DESK_FRONT_OFFSET_Z]}
        scale={WORKSTATION_SCALE}
      >
        <group rotation={[0, Math.PI, 0]}>
          {/* Desk top stretched 2x on X only (`DESK_WIDTH_SCALE`) so it reads
              as a wide workstation; depth/height stay at the desk's natural
              proportion. Props keep their own size and are spread across the
              now-wider surface (their X offsets are scaled to match). */}
          <WorkstationModel
            url={FURNITURE_MODELS.desk}
            position={[-DESK_RIGHT_OFFSET_X, 0, 0]}
            scale={[DESK_WIDTH_SCALE, 1, 1]}
            centerXZ
          />
          {/* All props sit WITHIN the widened Kenney desk surface footprint
              (~±0.5*DESK_WIDTH_SCALE x, ~±0.25 z after centerXZ), so nothing
              reads as sliding off the desk edge: monitor + laptop across the
              back, keyboard/mouse front-centre, books in a back corner. */}
          <WorkstationModel
            url={FURNITURE_MODELS.computerScreen}
            position={[-0.32 - DESKTOP_PROPS_RIGHT_OFFSET_X, DESK_SURFACE_Y, -0.08]}
            centerXZ
          />
          <WorkstationModel
            url={FURNITURE_MODELS.laptop}
            position={[0.52 - DESKTOP_PROPS_RIGHT_OFFSET_X, DESK_SURFACE_Y, 0.0]}
            rotation={[0, -Math.PI / 7, 0]}
            centerXZ
          />
          <WorkstationModel
            url={FURNITURE_MODELS.computerKeyboard}
            position={[-0.32 - DESKTOP_PROPS_RIGHT_OFFSET_X, DESK_SURFACE_Y, 0.12]}
            centerXZ
          />
          <WorkstationModel
            url={FURNITURE_MODELS.computerMouse}
            position={[-0.05 - DESKTOP_PROPS_RIGHT_OFFSET_X, DESK_SURFACE_Y, 0.14]}
            centerXZ
          />
          <WorkstationModel
            url={FURNITURE_MODELS.books}
            position={[0.72 - DESKTOP_PROPS_RIGHT_OFFSET_X, DESK_SURFACE_Y, -0.12]}
            rotation={[0, Math.PI / 5, 0]}
            centerXZ
          />
        </group>
      </group>
    </group>
  );
}

/**
 * Render one blueprint runtime pet.
 *
 * The pet GLB is cloned (with per-instance material clones so two roles that
 * hash to the same animal never share a mutated material) and driven entirely
 * by shader emissive uniforms + material opacity — no point lights, no bloom.
 *
 * The enter / exit tween reads the shared `lifecycleRef` so the parent owns
 * lifecycle transitions while each agent applies its own scale / opacity / bob
 * in `useFrame`.
 */
function RuntimeAgent({
  agent,
  lifecycleRef,
  locale,
}: {
  agent: BlueprintRuntimeAgent;
  lifecycleRef: React.MutableRefObject<Map<string, AgentLifecycle>>;
  locale: AppLocale;
}) {
  const { scene } = useGLTF(PET_MODELS[agent.animal as keyof typeof PET_MODELS]);
  const roleTypeMeta = ROLE_TYPE_META[agent.zone];
  const RoleTypeIcon = roleTypeMeta.icon;
  const roleTypeLabel =
    roleTypeMeta.label[locale] ?? roleTypeMeta.label["en-US"];
  const showRoleTypeText = shouldShowRoleTypeText(roleTypeLabel, agent.label);

  // Clone the model graph AND its materials so per-agent emissive / opacity
  // mutations stay isolated even when several roles share the same GLB.
  const cloned = useMemo(() => {
    const next = scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(next);
    const minY = Number.isFinite(bounds.min.y) ? bounds.min.y : 0;
    const center = bounds.getCenter(new THREE.Vector3());
    // Floor-align Y AND centre on XZ. The desk (`WorkstationModel`) is
    // `centerXZ`-aligned to its own bounding box, so the pet must use the same
    // centred origin — otherwise an off-centre GLB pivot makes the pet sit
    // beside its desk instead of behind it (the "未对齐" look).
    next.position.y -= minY;
    next.position.x -= center.x;
    next.position.z -= center.z;

    next.traverse((child: THREE.Object3D) => {
      if (!("isMesh" in child) || !child.isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Per-instance material clones — required so emissive/opacity writes for
      // this agent never bleed into another agent rendering the same animal.
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => material.clone());
      } else if (mesh.material) {
        mesh.material = mesh.material.clone();
      }

      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        const mat = material as THREE.MeshStandardMaterial | undefined;
        if (!mat) continue;
        // Kenney Cube Pets read best with a bit of specular relief. The scene
        // has NO environment map, so `envMapIntensity` is a no-op here — the
        // lever that actually interacts with the existing directional / spot /
        // point lights is `roughness` (and keeping `metalness` low for a
        // toy-plastic look). Lowering roughness restores the highlight/relief
        // the matte 0.05 env path was missing, WITHOUT touching `material.color`
        // / `material.emissive` (those stay the authoritative Kenney values).
        if ("roughness" in mat) {
          mat.roughness = Math.min(
            typeof mat.roughness === "number" ? mat.roughness : 1,
            0.55
          );
        }
        if ("metalness" in mat) {
          mat.metalness = 0;
        }
      }
    });

    return next;
  }, [scene]);

  const groupRef = useRef<THREE.Group>(null);

  // Stable per-role bob phase offset so agents do not bob in lockstep.
  const bobPhaseOffset = useMemo(
    () => (stableHash(agent.roleId) % 1000) / 1000 * Math.PI * 2,
    [agent.roleId]
  );

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;

    const now = Date.now();
    const lifecycle = lifecycleRef.current.get(agent.roleId);

    // Enter / exit tween → animation scale + opacity multipliers.
    let animScale = 1;
    let animOpacity = 1;
    if (lifecycle) {
      const elapsed = now - lifecycle.startedAt;
      if (lifecycle.phase === "entering") {
        const p =
          lifecycle.enterDurationMs > 0
            ? Math.min(1, elapsed / lifecycle.enterDurationMs)
            : 1;
        animScale = 0.7 + 0.3 * p; // 0.7 → 1.0
        animOpacity = p; // 0 → 1
        if (p >= 1) {
          lifecycle.phase = "active";
        }
      } else if (lifecycle.phase === "exiting") {
        const p = Math.min(1, elapsed / EXIT_DURATION_MS);
        animScale = 1 - 0.3 * p; // 1.0 → 0.7
        animOpacity = 1 - p; // 1 → 0
      }
      // "active" (incl. shared-role no-enter mounts) → scale 1 / opacity 1.
    }

    // Position: anchor at the factory zone slot, bob the Y by phase amplitude.
    const bob =
      Math.sin(clock.elapsedTime * BOB_SPEED + bobPhaseOffset) *
      agent.amplitude *
      BOB_AMPLITUDE_METRES;
    group.position.set(
      agent.position[0],
      agent.position[1] + bob,
      agent.position[2]
    );
    group.scale.setScalar(BASE_AGENT_SCALE * animScale);

    // Keep role bodies as their plain GLB material in steady state. Per the
    // 2026-05-29 visual revision the body no longer carries any phase-driven
    // emissive glow — copying `agent.accentColor` / `colorOverride` into the
    // material `emissive` made every role look wrapped in a coloured self-lit
    // film ("发光蒙层"). Kenney Cube Pets keep their own authoritative material
    // colors; accents live on lines / chips / ground rings, NOT the body.
    // Phase differentiation is now expressed by bob amplitude ONLY (active
    // roles bob noticeably, idle roles barely move). Opacity stays reserved
    // exclusively for the enter/exit tween (`animOpacity`).
    const targetOpacity = animOpacity;
    const shouldRenderTransparent = targetOpacity < 0.995;
    cloned.traverse((child: THREE.Object3D) => {
      if (!("isMesh" in child) || !child.isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.renderOrder = BLUEPRINT_AGENT_RENDER_ORDER;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        const mat = material as THREE.MeshStandardMaterial;
        mat.transparent = shouldRenderTransparent;
        mat.opacity = targetOpacity;
        mat.depthWrite = !shouldRenderTransparent;
        mat.depthTest = true;
        mat.needsUpdate = true;
        // No phase emissive: leave the GLB material's own emissive untouched so
        // the body shows its natural model shading, not a coloured glow overlay.
      }
    });
  });

  return (
    <group
      ref={groupRef}
      position={agent.position}
      scale={BASE_AGENT_SCALE}
      userData={{ roleId: agent.roleId, testid: `role-agent-${agent.roleId}` }}
    >
      <primitive object={cloned} />
      <Html
        position={[0, 1.8, 0]}
        center
        distanceFactor={7}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="flex min-w-[132px] max-w-[240px] flex-col items-center gap-0.5 px-1 text-center"
          style={{
            color: "#0f172a",
            textShadow:
              "0 1px 0 rgba(255,255,255,0.92), 0 8px 18px rgba(15,23,42,0.22)",
          }}
          title={roleTypeLabel}
        >
          <span
            className="flex max-w-full items-center gap-1 whitespace-nowrap text-[10px] font-black uppercase leading-none tracking-[0.06em]"
            style={{ color: agent.colorOverride ?? agent.accentColor }}
          >
            <RoleTypeIcon className="size-3 shrink-0" aria-hidden="true" />
            {showRoleTypeText ? <span>{roleTypeLabel}</span> : null}
          </span>
          <span
            className="max-w-full whitespace-nowrap text-[11px] font-black leading-tight text-slate-950"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {agent.label}
          </span>
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Ground empty-state hint (Task 13; Requirements 1.1-1.6)
// ---------------------------------------------------------------------------

/**
 * Render the floor-centred Empty_State_Hint. The factory already produces the
 * bilingual two-line string `等待任务启动...\nWaiting for task...`; we split on
 * `\n` and render both lines (Requirement 1.2). drei `<Html>` keeps this
 * consistent with the repo's other in-scene text decals (SandboxMonitor /
 * nameplates) rather than introducing drei `<Text>`.
 */
function EmptyStateHint({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <Html
      position={[0, 0.05, 0]}
      center
      distanceFactor={9}
      style={{ pointerEvents: "none" }}
    >
      <div
        className="glass-3d flex flex-col items-center gap-0.5 whitespace-nowrap rounded-2xl border px-4 py-2 text-center font-semibold shadow-sm"
        style={{
          background: "rgba(248, 251, 255, 0.85)",
          color: FUTURE_OFFICE_COLORS.mutedText,
        }}
        data-testid="blueprint-empty-hint"
      >
        {lines.map((line, index) => (
          <span
            key={index}
            className={index === 0 ? "text-[13px] text-slate-700" : "text-[11px]"}
          >
            {line}
          </span>
        ))}
      </div>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Connection-line renderer (Task 16; Requirements 5.7-5.10)
// ---------------------------------------------------------------------------

/**
 * Render a single derived connection line between two agent floor positions.
 *
 * - Directed lines (`source === "event-from-to"`) render WITH a small cone
 *   arrowhead oriented along the line near the `to` endpoint, and a slightly
 *   thicker / more opaque stroke to read as higher-confidence (Req 5.7, 5.9).
 * - Undirected lines (heuristic / stage-rule) render with NO arrowhead, thinner
 *   and lower opacity to read as lower-confidence (Req 5.9).
 *
 * Endpoints are lifted to `LINE_ANCHOR_Y` off the floor for visibility,
 * consistent with MissionFirstAgents' message-flow anchors.
 */
function ConnectionLine({
  line,
  fromPosition,
  toPosition,
}: {
  line: BlueprintConnectionLine;
  fromPosition: [number, number, number];
  toPosition: [number, number, number];
}) {
  const start = useMemo(
    () => new THREE.Vector3(fromPosition[0], LINE_ANCHOR_Y, fromPosition[2]),
    [fromPosition]
  );
  const end = useMemo(
    () => new THREE.Vector3(toPosition[0], LINE_ANCHOR_Y, toPosition[2]),
    [toPosition]
  );

  const points = useMemo(() => [start, end], [start, end]);

  // Arrowhead transform: position near the `to` endpoint, oriented so the cone
  // tip points from `start` toward `end`. A cone's local +Y axis is its tip, so
  // we rotate +Y onto the normalized direction vector.
  const arrow = useMemo(() => {
    if (!line.directed) return null;
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 1e-4) return null;
    direction.normalize();

    // Pull the cone base slightly back from the endpoint so the tip lands on it.
    const position = end
      .clone()
      .addScaledVector(direction, -ARROW_CONE_HEIGHT * 0.5);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction
    );
    return { position, quaternion };
  }, [line.directed, start, end]);

  const color = line.directed
    ? FUTURE_OFFICE_COLORS.cyan
    : FUTURE_OFFICE_COLORS.slate;
  const lineWidth = line.directed ? DIRECTED_LINE_WIDTH : UNDIRECTED_LINE_WIDTH;
  const opacity = line.directed
    ? DIRECTED_LINE_OPACITY
    : UNDIRECTED_LINE_OPACITY;

  return (
    <group userData={{ connectionSource: line.source, directed: line.directed }}>
      <Line
        points={points}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={opacity}
      />
      {arrow ? (
        <mesh
          position={arrow.position}
          quaternion={arrow.quaternion}
          userData={{ arrowhead: true }}
        >
          <coneGeometry args={[ARROW_CONE_RADIUS, ARROW_CONE_HEIGHT, 12]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.6}
            transparent
            opacity={Math.min(1, opacity + 0.35)}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Render the full set of derived connection lines. Lines whose `from` or `to`
 * endpoint is not a currently rendered agent are SKIPPED (Requirement 5.7 /
 * 5.10: lines anchor only to agents that exist in the scene). The endpoint
 * positions come from the currently-rendered agents passed in by the shell.
 */
function ConnectionLines({
  lines,
  positionByRoleId,
}: {
  lines: BlueprintConnectionLine[];
  positionByRoleId: Map<string, [number, number, number]>;
}) {
  return (
    <>
      {lines.map((line) => {
        const fromPosition = positionByRoleId.get(line.from);
        const toPosition = positionByRoleId.get(line.to);
        // Skip lines whose endpoints are not currently rendered agents.
        if (!fromPosition || !toPosition) return null;
        return (
          <ConnectionLine
            key={`${line.source}:${line.from}->${line.to}`}
            line={line}
            fromPosition={fromPosition}
            toPosition={toPosition}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Blueprint runtime scene shell
// ---------------------------------------------------------------------------

export function BlueprintRuntimeAgents(props: BlueprintRuntimeAgentsProps) {
  const locale: AppLocale = useAppStore((state) => state.locale);
  const rolePhases = useBlueprintRealtimeStore((state) => state.rolePhases);
  const roleRuntimeStates = useBlueprintRealtimeStore(
    (state) => state.roleRuntimeStates
  );
  const capabilityStatuses = useBlueprintRealtimeStore(
    (state) => state.capabilityStatuses
  );
  const capabilityOwners = useBlueprintRealtimeStore(
    (state) => state.capabilityOwners
  );

  const isReplay = useIsReplay(props);

  // Pure factory call. `handoffEvents` / `phaseEvents` stay empty this wave;
  // the connection-line rings are wired in Wave 4 (task 15). `now` is captured
  // inside the memo (only consumed by line derivation, which is empty here).
  const sceneData = useMemo<BlueprintRuntimeSceneData>(
    () =>
      createBlueprintRuntimeSceneData({
        locale,
        rolePhases,
        roleLabels: props.roleLabels,
        roleRuntimeStates,
        handoffEvents: [],
        phaseEvents: [],
        activeStage: props.activeStage,
        isReplay,
        now: Date.now(),
      }),
    [
      locale,
      rolePhases,
      props.roleLabels,
      roleRuntimeStates,
      props.activeStage,
      isReplay,
    ]
  );

  const effectiveRolePhasesForLines = useMemo(
    () => ({
      ...deriveStageSeedRolePhases(props.activeStage),
      ...rolePhases,
    }),
    [props.activeStage, rolePhases]
  );

  // ── Capability→role bindings (capability chip strips) ────────────────────
  // Bind live capability invocations to the roles on stage, so each role shows
  // a lightweight chip strip of "what it's currently using". Keyed by roleId;
  // unbindable capabilities are omitted (they stay in the right-rail audit
  // panel). Recomputed when capability statuses or the effective role set move.
  const capabilityChipsByRole = useMemo(
    () =>
      deriveCapabilityRoleBindings({
        capabilityStatuses,
        capabilityOwners,
        rolePhases: effectiveRolePhasesForLines,
        activeStage: props.activeStage,
        locale,
      }),
    [
      capabilityStatuses,
      capabilityOwners,
      effectiveRolePhasesForLines,
      props.activeStage,
      locale,
    ]
  );

  // ── Lifecycle + render-list state ────────────────────────────────────────
  // `lifecycleRef` owns per-agent enter/exit phase; `snapshotRef` keeps the
  // last-known factory data per roleId so exiting agents can keep rendering
  // after the factory has dropped them. `renderAgents` is the union of live +
  // exiting agents that the scene graph actually mounts.
  const lifecycleRef = useRef<Map<string, AgentLifecycle>>(new Map());
  const snapshotRef = useRef<Map<string, BlueprintRuntimeAgent>>(new Map());
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // `seenRoleIdsByJobId` lives ONLY in this ref — never in the store, never
  // persisted (Requirement 6.6 + store-shape invariance).
  const seenRoleIdsByJobIdRef = useRef<Map<string, Set<string>>>(new Map());
  const lastJobIdRef = useRef<string | undefined>(props.activeJobId);

  // Snapshot kept available for the DEV scene bridge (installed in task 17).
  const sceneSnapshotRef = useRef<BlueprintSceneSnapshot>({
    mode: "blueprint",
    mountedShell: "blueprint",
    agents: [],
    connectionLines: [],
    emptyHintVisible: true,
  });

  // ── Event rings (Task 15; Requirements 5.1-5.6) ─────────────────────────
  // FIFO insertion-order rings updated OUTSIDE React render by the store event
  // observer. They are refs only — never store fields (Requirement 5.2) and
  // never wrap/replace the `dispatchEvent` action.
  const recentHandoffEventsRef = useRef<BlueprintRelayedEvent[]>([]);
  const recentPhaseEventsRef = useRef<BlueprintObservedPhaseEvent[]>([]);

  // Derived connection lines (Task 16). The pure factory keeps `connectionLines`
  // empty this wave; this is the authoritative RENDER source, re-derived from
  // the rings on a throttled cadence and committed only when it changes.
  const [connectionLines, setConnectionLines] = useState<
    BlueprintConnectionLine[]
  >([]);
  const connectionLinesKeyRef = useRef<string>("");
  // Mirrors the latest derived lines so the DEV-bridge snapshot (written in the
  // reconcile effect on a different cadence) can carry the CURRENT lines rather
  // than the factory's always-empty `connectionLines`.
  const connectionLinesRef = useRef<BlueprintConnectionLine[]>([]);

  const [renderAgents, setRenderAgents] = useState<BlueprintRuntimeAgent[]>([]);

  // Rebuild the render-list (live + exiting) from refs in canonical order.
  const rebuildRenderAgents = useCallback(() => {
    const list: BlueprintRuntimeAgent[] = [];
    for (const roleId of lifecycleRef.current.keys()) {
      const snap = snapshotRef.current.get(roleId);
      if (snap) list.push(snap);
    }
    list.sort((a, b) => a.roleId.localeCompare(b.roleId));
    setRenderAgents(list);
  }, []);

  // Reconcile factory agents → lifecycle transitions whenever the scene data or
  // the active job changes.
  useEffect(() => {
    // ── Whole-clear immediate wipe (Requirements 1.1, 1.3, 1.4) ────────────
    // When `rolePhases` goes empty (whole job cleared / reset / unsubscribe),
    // the factory returns `agents: []` + `emptyHint.visible: true`. Playing the
    // per-role 300ms exit here would leave old agents (and their stale
    // connection lines) lingering on screen WHILE the Empty_State_Hint renders,
    // which contradicts the locked "empty state = 0 agents, nothing else" rule.
    // So for the all-empty transition only, wipe the live render state
    // immediately — NO 300ms exit. The SINGLE-role-removed path below is left
    // untouched and keeps its per-role exit animation.
    if (sceneData.agents.length === 0) {
      // Cancel + clear every pending per-role exit timer so no scheduled
      // unmount fires against the freshly-cleared maps.
      for (const timer of exitTimersRef.current.values()) clearTimeout(timer);
      exitTimersRef.current.clear();

      // Drop all lifecycle + last-known snapshot state so no exiting agent can
      // keep rendering behind the hint.
      lifecycleRef.current.clear();
      snapshotRef.current.clear();

      // Publish an empty DEV-bridge snapshot (Requirement 1.6: agents: [] while
      // the hint is visible).
      sceneSnapshotRef.current = {
        mode: "blueprint",
        mountedShell: "blueprint",
        agents: [],
        connectionLines: [],
        emptyHintVisible: sceneData.emptyHint.visible,
      };

      // Clear derived connection-line state so no stale line lingers behind the
      // hint (the re-derive cadence will re-establish lines once roles return).
      connectionLinesRef.current = [];
      connectionLinesKeyRef.current = "";
      setConnectionLines([]);

      // Empty the render list directly — the maps are already cleared, so this
      // is equivalent to `rebuildRenderAgents()` but skips the rebuild walk.
      setRenderAgents([]);

      // Intentionally do NOT touch `lastJobIdRef` — an all-clear is not a job
      // switch. If the same job later re-emits roles, they enter fresh.
      return;
    }

    const now = Date.now();
    const agents = sceneData.agents;
    const currentIds = new Set(agents.map((a) => a.roleId));
    const lifecycles = lifecycleRef.current;
    const snapshots = snapshotRef.current;

    // Historical → historical job switch handling (Requirement 6.5):
    // capture the previous job's rendered roleIds, then mark any roleId present
    // in BOTH the previous and the new snapshot as "shared" so it mounts
    // without replaying the enter animation.
    const prevJobId = lastJobIdRef.current;
    const jobChanged = props.activeJobId !== prevJobId;
    const sharedAcrossJobs = new Set<string>();
    if (jobChanged) {
      if (prevJobId !== undefined) {
        const prevSet = new Set(snapshots.keys());
        seenRoleIdsByJobIdRef.current.set(prevJobId, prevSet);
        for (const id of currentIds) {
          if (prevSet.has(id)) sharedAcrossJobs.add(id);
        }
      }
      lastJobIdRef.current = props.activeJobId;
    }

    const reanimatedThisRender = new Set<string>();

    // Live agents: refresh snapshot data + open/refresh their lifecycle.
    for (const agent of agents) {
      snapshots.set(agent.roleId, agent);
      const existing = lifecycles.get(agent.roleId);

      // A role that re-appears mid-exit: cancel the pending removal.
      const pendingTimer = exitTimersRef.current.get(agent.roleId);
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        exitTimersRef.current.delete(agent.roleId);
      }

      if (!existing) {
        if (jobChanged && sharedAcrossJobs.has(agent.roleId)) {
          // Shared across the historical job switch → no enter animation.
          lifecycles.set(agent.roleId, {
            phase: "active",
            startedAt: now,
            enterDurationMs: agent.enterDurationMs,
            playedEnter: false,
          });
        } else {
          lifecycles.set(agent.roleId, {
            phase: "entering",
            startedAt: now,
            enterDurationMs: agent.enterDurationMs,
            playedEnter: true,
          });
          reanimatedThisRender.add(agent.roleId);
        }
      } else if (existing.phase === "exiting") {
        // Re-entered before exit completed → replay enter.
        existing.phase = "entering";
        existing.startedAt = now;
        existing.enterDurationMs = agent.enterDurationMs;
        existing.playedEnter = true;
        reanimatedThisRender.add(agent.roleId);
      }
    }

    // Removed roles: begin exit, then schedule unmount after EXIT_DURATION_MS.
    for (const [roleId, lifecycle] of lifecycles) {
      if (currentIds.has(roleId)) continue;
      if (lifecycle.phase === "exiting") continue;
      lifecycle.phase = "exiting";
      lifecycle.startedAt = now;
      const timer = setTimeout(() => {
        lifecycles.delete(roleId);
        snapshots.delete(roleId);
        exitTimersRef.current.delete(roleId);
        rebuildRenderAgents();
      }, EXIT_DURATION_MS);
      exitTimersRef.current.set(roleId, timer);
    }

    // Publish the DEV-bridge snapshot (read by task 17). `wasReanimatedThisRender`
    // flags which agents played an enter animation in this transition.
    // `connectionLines` reflects the CURRENTLY DERIVED lines (from the separate
    // `deriveConnectionLines` cadence), NOT the factory's always-empty array,
    // so task 17's bridge and the P7 / P9 harness read real lines.
    sceneSnapshotRef.current = {
      mode: "blueprint",
      mountedShell: "blueprint",
      agents: agents.map((agent) => ({
        ...agent,
        wasReanimatedThisRender: reanimatedThisRender.has(agent.roleId),
      })),
      connectionLines: connectionLinesRef.current,
      emptyHintVisible: sceneData.emptyHint.visible,
    };

    rebuildRenderAgents();
  }, [sceneData, props.activeJobId, rebuildRenderAgents]);

  // Clear any pending exit timers on unmount.
  useEffect(() => {
    const timers = exitTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // ── Task 15: subscribe to the module-level realtime event observer ───────
  // Updates the two FIFO rings OUTSIDE React render. Returning the unsubscribe
  // cleans up on unmount. We do NOT wrap/replace the store `dispatchEvent`
  // action and add no store fields (Requirements 5.1-5.4, 5.2).
  useEffect(() => {
    return subscribeBlueprintRealtimeEvents((event) => {
      const payload = event.payload ?? {};
      const timestamp =
        typeof event.timestamp === "number"
          ? event.timestamp
          : new Date(event.timestamp).getTime();

      // Handoff ring: only events carrying a non-empty from→to pair (Req 5.3).
      const fromRoleId = payload.fromRoleId;
      const toRoleId = payload.toRoleId;
      if (
        typeof fromRoleId === "string" &&
        fromRoleId.length > 0 &&
        typeof toRoleId === "string" &&
        toRoleId.length > 0
      ) {
        pushRing(recentHandoffEventsRef.current, event, 32);
      }

      // Phase ring: events with a readable roleId + a mappable Role_Phase and a
      // finite timestamp (Req 5.4).
      const roleId = readRoleIdFromBlueprintPayload(payload);
      const phase = mapEventTypeToPhase(event.type);
      if (roleId && phase && Number.isFinite(timestamp)) {
        pushRing(
          recentPhaseEventsRef.current,
          { roleId, phase, timestamp },
          64
        );
      }
    });
  }, []);

  // ── Task 16: throttled connection-line re-derivation (approach b) ────────
  // The rings mutate outside React render, so a ~250ms (≤4x/sec) poll re-runs
  // the SEPARATE `deriveConnectionLines` priority chain against the rings and
  // commits state ONLY when the derived line set actually changes (compared by
  // a cheap content key) — never a per-frame setState. The factory's
  // `connectionLines` stays `[]`; this is the authoritative render source.
  useEffect(() => {
    const rederive = () => {
      if (Object.keys(effectiveRolePhasesForLines).length === 0) {
        connectionLinesRef.current = [];
        connectionLinesKeyRef.current = "";
        sceneSnapshotRef.current = {
          ...sceneSnapshotRef.current,
          connectionLines: [],
        };
        setConnectionLines([]);
        return;
      }

      const next = deriveConnectionLines({
        handoffEvents: recentHandoffEventsRef.current,
        phaseEvents: recentPhaseEventsRef.current,
        rolePhases: effectiveRolePhasesForLines,
        activeStage: props.activeStage,
        now: Date.now(),
      });
      const nextKey = connectionLinesKey(next);
      if (nextKey === connectionLinesKeyRef.current) return;
      connectionLinesKeyRef.current = nextKey;
      connectionLinesRef.current = next;
      // Keep the DEV-bridge snapshot's lines current between reconcile passes.
      sceneSnapshotRef.current = {
        ...sceneSnapshotRef.current,
        connectionLines: next,
      };
      setConnectionLines(next);
    };

    // Derive immediately so newly-mounted scenes don't wait a full interval.
    rederive();
    const handle = setInterval(rederive, LINE_REDERIVE_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [effectiveRolePhasesForLines, props.activeStage]);

  // Endpoint lookup for the line renderer: only currently-rendered agents.
  const positionByRoleId = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const agent of renderAgents) {
      map.set(agent.roleId, agent.position);
    }
    return map;
  }, [renderAgents]);

  // ── Task 17: DEV scene bridge ────────────────────────────────────────────
  // DEV-only `window.__whybuddy3dScene`. `getSnapshot()` returns a FRESH copy
  // of the current blueprint snapshot ref each call ({ mode, mountedShell,
  // agents, connectionLines, emptyHintVisible } — Requirement 9.7) so harness
  // assertions never observe a later-mutated live ref. `dispatchEvent` is a
  // thin passthrough to the store action so harness P-stages can drive events
  // through the bridge. The bridge is removed on unmount (Requirement 1.6 keeps
  // the empty-state path observable, the cleanup keeps it from leaking into
  // production or a swapped shell). Never attached in a production build.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__whybuddy3dScene = {
      getSnapshot: () => ({ ...sceneSnapshotRef.current }),
      dispatchEvent: (event: BlueprintRelayedEvent) =>
        useBlueprintRealtimeStore.getState().dispatchEvent(event),
    };
    return () => {
      delete w.__whybuddy3dScene;
    };
  }, []);

  return (
    <group userData={{ shellMarker: "blueprint" }}>
      {sceneData.emptyHint.visible ? (
        <EmptyStateHint text={sceneData.emptyHint.text} />
      ) : null}
      {renderAgents.map((agent) => (
        <RuntimeAgent
          key={agent.roleId}
          agent={agent}
          lifecycleRef={lifecycleRef}
          locale={locale}
        />
      ))}
      {renderAgents.map((agent) => (
        <RoleWorkstation key={`desk-${agent.roleId}`} position={agent.position} />
      ))}
      {renderAgents.map((agent) => (
        <RoleCapabilityChips
          key={`caps-${agent.roleId}`}
          chips={capabilityChipsByRole.get(agent.roleId) ?? EMPTY_CHIPS}
          position={agent.position}
        />
      ))}
      {connectionLines.length > 0 ? (
        <ConnectionLines
          lines={connectionLines}
          positionByRoleId={positionByRoleId}
        />
      ) : null}
    </group>
  );
}
