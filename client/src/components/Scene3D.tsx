import { ContactShadows, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import { ACESFilmicToneMapping } from "three";

import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";

import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useIdleActivation } from "@/hooks/useIdleActivation";
import { useViewportTier } from "@/hooks/useViewportTier";
import { FURNITURE_MODELS, PET_MODELS } from "@/lib/assets";
import {
  resolveProjectTaskScope,
  resolveScopedSelectedTaskId,
} from "@/lib/project-task-scope";
import { useProjectStore } from "@/lib/project-store";
import { FUTURE_OFFICE_COLORS } from "@/lib/scene-theme";
import { useTasksStore } from "@/lib/tasks-store";

import { CameraController } from "./three/CameraController";
import { CrossFrameworkParticles } from "./three/CrossFrameworkParticles";
import { CrossPodParticles } from "./three/CrossPodParticles";
import { MissionIsland } from "./three/MissionIsland";
import { OfficeRoom } from "./three/OfficeRoom";
import { PetWorkers } from "./three/PetWorkers";
import { SandboxMonitor } from "./three/SandboxMonitor";
import type { SceneFusionMode } from "./three/scene-fusion/role-id-bridge";
import { SceneStageFlow } from "./three/SceneStageFlow";
import { WaitingDecisionBubble } from "./three/WaitingDecisionBubble";

const CRITICAL_FURNITURE_MODELS = [
  FURNITURE_MODELS.floorFull,
  FURNITURE_MODELS.floorHalf,
  FURNITURE_MODELS.floorCornerRound,
  FURNITURE_MODELS.wallCorner,
  FURNITURE_MODELS.wallCornerRond,
  FURNITURE_MODELS.desk,
  FURNITURE_MODELS.chairDesk,
  FURNITURE_MODELS.computerScreen,
  FURNITURE_MODELS.computerKeyboard,
  FURNITURE_MODELS.computerMouse,
  FURNITURE_MODELS.rugRounded,
  FURNITURE_MODELS.rugRectangle,
  FURNITURE_MODELS.laptop,
  FURNITURE_MODELS.tableRound,
];

const SECONDARY_SCENE_MODELS = [
  ...Object.values(FURNITURE_MODELS).filter(
    url => !CRITICAL_FURNITURE_MODELS.includes(url)
  ),
  ...Object.values(PET_MODELS),
];

export type ScenePerformanceProfile = "balanced" | "resizing";

// TODO(Wave 4): No canonical `AutopilotStage` type is exported in the codebase
// yet. PetWorkers.tsx and BlueprintRuntimeAgents.tsx both keep a permissive
// local `type AutopilotStage = string` until a canonical stage union exists.
// We mirror the same alias here so the blueprint-branch passthrough signature
// matches end-to-end (Scene3D -> PetWorkers -> BlueprintRuntimeAgents).
type AutopilotStage = string;

/**
 * 自动驾驶 3D 场景融合模式判别。
 * - "blueprint"：蓝图页（/autopilot），3D 场景跟随 BlueprintRealtimeStore。
 * - "mission-first"：mission-first 任务壳（/tasks 等），3D 场景跟随 mission 信号。
 *
 * Wave B：正式定义已升级到 scene-fusion/role-id-bridge.ts，本文件统一从
 * 该模块 re-export，确保所有 mode 透传链路（Scene3D → PetWorkers /
 * MissionIsland / SceneStageFlow）共享同一份类型来源。
 */
export type { SceneFusionMode };

export interface Scene3DProps {
  performanceProfile?: ScenePerformanceProfile;
  /** Current sidebar width in pixels, used for camera compensation. Default 0. */
  sidebarWidth?: number;
  /** Hide the scene via CSS visibility (preserves WebGL context). Default false. */
  hidden?: boolean;
  /** Optional project scope for task overlays rendered inside the scene. */
  projectId?: string | null;
  /**
   * 场景融合模式，默认 "mission-first"。
   * 蓝图页（/autopilot）应显式传入 "blueprint"，让 MissionIsland 在蓝图页隐藏，
   * PetWorkers 走 FSD roleId 映射桥，SceneStageFlow 用 blueprintJob 派生 9 阶段流线。
   */
  mode?: SceneFusionMode;
  /**
   * 蓝图模式下的当前 BlueprintGenerationJob，可选。
   * 由 page-level 调用方（AutopilotRoutePage）传入，SceneStageFlow 据此
   * 派生场景流线信号。mission-first 模式下应保持 null（默认）。
   */
  blueprintJob?: BlueprintGenerationJob | null;
  /**
   * Blueprint-branch passthroughs forwarded into `<PetWorkers mode="blueprint">`
   * (which mounts BlueprintRuntimeAgents). All optional; only consumed by the
   * blueprint branch. Mission-first callers can omit them entirely.
   *
   * - `isReplay`: explicit replay flag. When absent, BlueprintRuntimeAgents
   *   derives replay from `latestJobId !== activeJobId` when both are present.
   * - `latestJobId` / `activeJobId`: live vs. selected-historical job ids.
   * - `activeStage`: the current blueprint stage, used by Wave 4 stage-rule
   *   connection lines.
   */
  isReplay?: boolean;
  latestJobId?: string;
  activeJobId?: string;
  activeStage?: AutopilotStage;
  roleLabels?: Record<string, string>;
}

export function Scene3D({
  performanceProfile = "balanced",
  sidebarWidth = 0,
  hidden = false,
  projectId = null,
  mode = "mission-first",
  blueprintJob = null,
  isReplay,
  latestJobId,
  activeJobId,
  activeStage,
  roleLabels,
}: Scene3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isMobile, isTablet, tier } = useViewportTier();
  const effectiveWidth = useContainerWidth(containerRef);
  const deferredDetailsReady = useIdleActivation(
    performanceProfile === "balanced",
    600
  );
  const reducedSceneEffects = performanceProfile === "resizing";
  const projectMissions = useProjectStore(state => state.missions);

  // Sandbox shield: show when the selected mission runs at strict security level.
  const isStrictSandbox = useTasksStore(state => {
    const scope = resolveProjectTaskScope({
      projectId,
      projectMissions,
      tasks: state.tasks,
    });
    const scopedSelectedTaskId = resolveScopedSelectedTaskId({
      selectedTaskId: state.selectedTaskId,
      scope,
      hasDetail: taskId => Boolean(state.detailsById[taskId]),
    });
    const detail = scopedSelectedTaskId
      ? state.detailsById[scopedSelectedTaskId]
      : null;
    return (
      detail?.securitySummary?.level === "strict" &&
      detail?.status === "running"
    );
  });

  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    (
      globalThis as { __sceneSetRecovering?: (value: boolean) => void }
    ).__sceneSetRecovering = (value: boolean) => {
      setIsRecovering(value);
    };

    return () => {
      delete (globalThis as { __sceneSetRecovering?: (value: boolean) => void })
        .__sceneSetRecovering;
    };
  }, []);

  useEffect(() => {
    CRITICAL_FURNITURE_MODELS.forEach(url => {
      useGLTF.preload(url);
    });
  }, []);

  useEffect(() => {
    if (!deferredDetailsReady || typeof window === "undefined") return;

    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const preloadSecondary = () => {
      SECONDARY_SCENE_MODELS.forEach(url => {
        useGLTF.preload(url);
      });
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(
        () => {
          preloadSecondary();
        },
        { timeout: 1200 }
      );
    } else {
      timeoutId = window.setTimeout(preloadSecondary, 900);
    }

    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [deferredDetailsReady]);

  const camera = isMobile
    ? {
        // Keep the stage readable in the 50/50 autopilot split without leaving
        // too much empty floor in the lower viewport.
        position: [0, 7.7, 14.3] as [number, number, number],
        fov: 50,
        near: 0.1,
        far: 100,
      }
    : isTablet
      ? {
          position: [0, 7.2, 13.2] as [number, number, number],
          fov: 50,
          near: 0.1,
          far: 100,
        }
      : {
          position: [0, 5, 10.5] as [number, number, number],
          fov: 50,
          near: 0.1,
          far: 100,
        };
  const dpr: [number, number] = reducedSceneEffects
    ? [1, 1]
    : isMobile
      ? [1, 1.35]
      : [1, 1.5];
  const primaryShadowSize = reducedSceneEffects ? 768 : 1024;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 h-full w-full touch-pan-y bg-[linear-gradient(180deg,#eef6fb_0%,#f7fbfd_48%,#e5f1f4_100%)]"
      style={{ visibility: hidden ? "hidden" : "visible" }}
    >
      <Canvas
        shadows
        camera={camera}
        dpr={dpr}
        frameloop={hidden ? "demand" : "always"}
        gl={{ antialias: !reducedSceneEffects, alpha: false }}
        resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
        onCreated={({ gl, camera: sceneCamera }) => {
          gl.setClearColor(FUTURE_OFFICE_COLORS.sceneBackground);
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = isMobile ? 1.04 : 1;
          // 自动驾驶 3D 场景融合 follow-up（2026-05-13 v7 aspect 锁定）：
          // canvas aspect-[16/10] 后场景几何与视野匹配，lookAt 回到 1.0 中庸
          // （地板线落在 canvas ~75%，墙面 SandboxMonitor 占上 25%）。
          sceneCamera.lookAt(0, isMobile ? 1.2 : 1.0, 0);
        }}
      >
        <CameraController effectiveWidth={effectiveWidth} tier={tier} />
        <Suspense fallback={null}>
          <ambientLight intensity={0.48} color={FUTURE_OFFICE_COLORS.ambient} />
          <hemisphereLight
            color={FUTURE_OFFICE_COLORS.hemisphereSky}
            groundColor={FUTURE_OFFICE_COLORS.hemisphereGround}
            intensity={0.42}
          />

          <directionalLight
            position={[-5.2, 7.2, 4.4]}
            intensity={1.08}
            color={FUTURE_OFFICE_COLORS.keyLight}
            castShadow
            shadow-mapSize-height={primaryShadowSize}
            shadow-mapSize-width={primaryShadowSize}
            shadow-camera-bottom={-11}
            shadow-camera-far={22}
            shadow-camera-left={-11}
            shadow-camera-right={11}
            shadow-camera-top={11}
            shadow-bias={-0.00025}
          />

          <directionalLight
            position={[6.4, 4.5, 5.5]}
            intensity={0.32}
            color={FUTURE_OFFICE_COLORS.fillLight}
          />

          <spotLight
            position={[-7.2, 2.9, 0.3]}
            angle={0.92}
            penumbra={1}
            intensity={0.3}
            color={FUTURE_OFFICE_COLORS.practicalLight}
            distance={18}
            decay={2}
          />

          <pointLight
            position={[0.3, 2.35, -1.1]}
            intensity={0.22}
            color={FUTURE_OFFICE_COLORS.cyanSoft}
            distance={6.6}
            decay={2}
          />

          <OfficeRoom
            showSecondaryDecor={deferredDetailsReady && !reducedSceneEffects}
            reducedEffects={reducedSceneEffects}
            mode={mode}
          />
          <SceneStageFlow
            projectId={projectId}
            mode={mode}
            blueprintJob={blueprintJob}
          />
          <PetWorkers
            projectId={projectId}
            reducedOverlays={!deferredDetailsReady || reducedSceneEffects}
            mode={mode}
            isReplay={isReplay}
            latestJobId={latestJobId}
            activeJobId={activeJobId}
            activeStage={activeStage}
            roleLabels={roleLabels}
          />
          <MissionIsland projectId={projectId} mode={mode} />
          <SandboxMonitor projectId={projectId} />
          <WaitingDecisionBubble projectId={projectId} />
          {!reducedSceneEffects && deferredDetailsReady ? (
            <>
              <CrossPodParticles active />
              <CrossFrameworkParticles active showLabels={false} />
            </>
          ) : null}

          {!reducedSceneEffects ? (
            <ContactShadows
              position={[0, 0.01, 0]}
              opacity={0.24}
              scale={15}
              blur={2.6}
              far={5.5}
              color={FUTURE_OFFICE_COLORS.contactShadow}
            />
          ) : null}
        </Suspense>
      </Canvas>

      {/*
        whybuddy-3d-real-role-driven-scene-2026-05-29 / Wave 0 Task 4
        Non-canvas DOM marker. Rendered by Scene3D (which owns the DOM) as a
        sibling ADJACENT to <Canvas>, never inside it — React Three Fiber canvas
        children cannot be DOM nodes. `data-mode` reflects the active scene
        fusion mode so the harness P10 assertion can read the mounted shell.
        Acceptance: Requirement 8.7.
      */}
      <div data-testid="whybuddy-3d-shell" data-mode={mode} />

      {isRecovering && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="mb-4 size-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
          <p className="text-base font-medium text-white drop-shadow-md">
            Recovering previous task...
          </p>
        </div>
      )}

      {isStrictSandbox && (
        <div
          className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-2xl border border-rose-200/60 bg-white/80 px-3.5 py-2 shadow-lg backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <span className="text-lg" aria-hidden="true">
            {"\uD83D\uDEE1\uFE0F"}
          </span>
          <span className="text-xs font-semibold text-rose-700">
            Sandbox Protected
          </span>
        </div>
      )}
    </div>
  );
}
