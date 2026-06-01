import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";

import { useAppStore } from "@/lib/store";
import { resolveProjectTaskScope } from "@/lib/project-task-scope";
import { useProjectStore } from "@/lib/project-store";
import { useTasksStore } from "@/lib/tasks-store";
import { useWorkflowStore } from "@/lib/workflow-store";
import { FUTURE_OFFICE_COLORS } from "@/lib/scene-theme";
import {
  getSceneStageSignal,
  SCENE_FLOW_ZONES,
} from "@/lib/scene-stage-flow";

import {
  adaptBlueprintSignalToSceneStageSignal,
  getBlueprintSceneStageSignal,
} from "./scene-fusion/blueprint-stage-signal";
import type { SceneFusionMode } from "./scene-fusion/role-id-bridge";

function StageFlowSegment({
  from,
  to,
  color,
  phase,
  opacity,
  floorHugging = false,
}: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  phase: number;
  opacity: number;
  floorHugging?: boolean;
}) {
  const particleRefs = useRef<Array<THREE.Mesh | null>>([]);

  const curve = useMemo(() => {
    const flowY = floorHugging ? 0.055 : 0.24;
    const start = new THREE.Vector3(from[0], flowY, from[2]);
    const end = new THREE.Vector3(to[0], flowY, to[2]);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const distance = start.distanceTo(end);

    mid.y += floorHugging ? 0.02 : Math.max(0.5, distance * 0.12);
    mid.x += (end.z - start.z) * 0.03;
    mid.z += (start.x - end.x) * 0.03;

    return new THREE.QuadraticBezierCurve3(start, mid, end);
  }, [floorHugging, from, to]);

  const points = useMemo(() => curve.getPoints(34), [curve]);

  useFrame(({ clock }) => {
    particleRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const t = (clock.elapsedTime * 0.12 + phase + index * 0.26) % 1;
      mesh.position.copy(curve.getPointAt(t));
      mesh.scale.setScalar(
        0.7 + Math.sin(clock.elapsedTime * 5 + index) * 0.08
      );
    });
  });

  return (
    <group>
      {/*
        whybuddy-spec-tree-progress-merge-2026-05-29 follow-up:
        发光路线在亮地板上原本太弱（lineWidth=1.2 + opacity 0.22~0.42），
        加宽到 2.6 + 抬高基线 opacity，叠加一根半透明粗光晕底层模拟 bloom，
        让 stage flow 在 1920×1080 默认相机下肉眼可见。
      */}
      <Line
        points={points}
        color={color}
        lineWidth={floorHugging ? 3.2 : 5.5}
        transparent
        opacity={floorHugging ? Math.min(0.18, opacity * 0.36) : Math.min(0.38, opacity * 0.7)}
      />
      <Line
        points={points}
        color={color}
        lineWidth={floorHugging ? 1.45 : 2.6}
        transparent
        opacity={floorHugging ? Math.min(0.46, opacity * 0.7) : Math.min(0.92, opacity + 0.32)}
      />
      {[0, 1, 2].map(index => (
        <mesh
          key={index}
          ref={mesh => {
            particleRefs.current[index] = mesh;
          }}
        >
          <sphereGeometry args={[0.085, 16, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={1.4}
            transparent
            opacity={floorHugging ? Math.min(0.6, opacity * 0.86) : Math.min(0.98, opacity + 0.28)}
          />
        </mesh>
      ))}
    </group>
  );
}

function StageZonePulse({
  position,
  color,
  emphasized,
}: {
  position: [number, number, number];
  color: string;
  emphasized: boolean;
}) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
        <ringGeometry
          args={[emphasized ? 0.42 : 0.28, emphasized ? 0.62 : 0.4, 40]}
        />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emphasized ? 0.35 : 0.18}
          transparent
          opacity={emphasized ? 0.38 : 0.22}
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight
        position={[0, 0.45, 0]}
        intensity={emphasized ? 0.34 : 0.18}
        color={color}
        distance={2.8}
        decay={2}
      />
    </group>
  );
}

export function SceneStageFlow({
  projectId = null,
  mode = "mission-first",
  blueprintJob = null,
}: {
  projectId?: string | null;
  /**
   * 自动驾驶 3D 场景融合模式。
   * - "blueprint"：用 blueprintJob 派生 9 阶段流线信号（autopilot-scene-fusion Wave C）；
   * - "mission-first"：走原有 mission / workflow 信号路径，行为完全不变。
   */
  mode?: SceneFusionMode;
  /**
   * 蓝图模式下的当前 BlueprintGenerationJob，可选。
   * 缺失时落到 SAFE_DEFAULT_SIGNAL（input / progress 0），AC7 初始空态稳定。
   */
  blueprintJob?: BlueprintGenerationJob | null;
}) {
  const locale = useAppStore(state => state.locale);
  const tasks = useTasksStore(state => state.tasks);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const projectMissions = useProjectStore(state => state.missions);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);
  const scopedTasks = useMemo(
    () =>
      resolveProjectTaskScope({
        projectId,
        projectMissions,
        tasks,
      }).tasks,
    [projectId, projectMissions, tasks]
  );
  const scopedCurrentWorkflow = useMemo(() => {
    if (!projectId) return currentWorkflow;
    if (!currentWorkflow?.missionId) return null;
    return projectMissions.some(
      mission =>
        mission.projectId === projectId &&
        mission.missionId === currentWorkflow.missionId
    )
      ? currentWorkflow
      : null;
  }, [currentWorkflow, projectId, projectMissions]);

  // Wave C：mode 分流。
  // - "blueprint" → 用 blueprintJob 派生 9 阶段信号，输出兼容 SceneStageSignal 形状；
  // - "mission-first" → 走既有 getSceneStageSignal 路径（mission + workflow），行为不变。
  const signal = useMemo(() => {
    if (mode === "blueprint") {
      const blueprintSignal = getBlueprintSceneStageSignal(blueprintJob);
      return adaptBlueprintSignalToSceneStageSignal(blueprintSignal, locale);
    }
    return getSceneStageSignal({
      locale,
      tasks: scopedTasks,
      selectedTaskId,
      currentWorkflow: scopedCurrentWorkflow,
    });
  }, [
    mode,
    blueprintJob,
    locale,
    scopedTasks,
    selectedTaskId,
    scopedCurrentWorkflow,
  ]);

  const zoneTrail = useMemo(
    () =>
      signal
        ? signal.zones.map(zoneId => ({
            zoneId,
            zone: SCENE_FLOW_ZONES[zoneId],
          }))
        : [],
    [signal]
  );

  if (!signal || zoneTrail.length < 2) return null;

  const focusZone = zoneTrail[zoneTrail.length - 1];

  return (
    <group>
      {zoneTrail.map(({ zoneId, zone }, index) => (
        <StageZonePulse
          key={zoneId}
          position={zone.floorPosition}
          color={signal.color}
          emphasized={index === zoneTrail.length - 1}
        />
      ))}

      {zoneTrail.slice(0, -1).map((item, index) => (
        <StageFlowSegment
          key={`${item.zoneId}-${zoneTrail[index + 1].zoneId}-${signal.stageKey}`}
          from={item.zone.floorPosition}
          to={zoneTrail[index + 1].zone.floorPosition}
          color={signal.color}
          // base 0.45 + 每段 0.08 提升，让首段也清晰可见，最深一段接近不透明
          opacity={0.45 + index * 0.08}
          phase={index * 0.18}
          floorHugging={mode === "blueprint"}
        />
      ))}

      <Html
        position={[focusZone.zone.position[0], 1.22, focusZone.zone.position[2]]}
        center
        distanceFactor={10}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="max-w-[180px] rounded-full bg-slate-950/45 px-2.5 py-1.5 text-left shadow-[0_8px_18px_rgba(2,6,23,0.24)] ring-1 ring-white/8 backdrop-blur-sm"
          data-testid="blueprint-stage-hud-compact"
          title={signal.summary ?? `${signal.statusLabel} · ${signal.stageLabel}`}
        >
          <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
            <span
              className="inline-block size-1.5 shrink-0 rounded-full shadow-[0_0_10px_currentColor]"
              style={{ backgroundColor: signal.color, color: signal.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate text-[11px] font-black leading-4 text-white/92">
              {signal.stageLabel}
            </span>
            <span className="shrink-0 text-[10px] font-bold leading-4 text-white/45">
              ·
            </span>
            <span
              className="min-w-0 truncate text-[10px] font-black leading-4"
              style={{ color: signal.color }}
            >
              {signal.statusLabel}
            </span>
          </div>
          {signal.progress !== null ? (
            <div
              className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/10"
              aria-hidden="true"
            >
              <div
                className="h-0.5 rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(0, Math.min(100, signal.progress))}%`,
                  backgroundColor: signal.color,
                }}
              />
            </div>
          ) : null}
          {signal.summary ? (
            <span
              className="sr-only"
              data-testid="blueprint-stage-hud-summary"
            >
              {signal.summary}
            </span>
          ) : null}
        </div>
      </Html>
    </group>
  );
}
