import { Html, Line, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import * as THREE from "three";

import {
  AGENT_VISUAL_MAP,
  AGENT_VISUAL_CONFIGS,
  GUEST_POD_POSITIONS,
  resolveGuestAnimal,
  type AgentAnimationType,
  type AgentVisualConfig,
} from "@/lib/agent-config";
import {
  useBlueprintRealtimeStore,
  type RolePhase,
} from "@/lib/blueprint-realtime-store";
import { PET_MODELS } from "@/lib/assets";
import {
  readBlueprintRolePhase,
  readBlueprintRoleRuntimeState,
  type SceneFusionMode,
  type MissionAgentId,
} from "./scene-fusion/role-id-bridge";
import {
  createBlueprintSceneData,
  deriveBlueprintAgentPatrol,
  deriveBlueprintFlowRoutes,
  type BlueprintSceneFlowRoute,
  type BlueprintSceneAgentConfig,
  type BlueprintSceneDepartmentMarker,
} from "./scene-fusion/blueprint-scene-agents";
import { getRoleRuntimeVisual } from "./scene-fusion/role-runtime-visual";
import type { AppLocale } from "@/lib/locale";
import {
  resolveProjectMissionIds,
  resolveScopedWorkflow,
} from "@/lib/project-task-scope";
import { useProjectStore } from "@/lib/project-store";
import { getSceneStageColor } from "@/lib/scene-stage-flow";
import {
  FUTURE_DEPARTMENT_COLORS,
  FUTURE_OFFICE_COLORS,
} from "@/lib/scene-theme";
import { useAppStore } from "@/lib/store";
import {
  useWorkflowStore,
  type WorkflowOrganizationSnapshot,
} from "@/lib/workflow-store";
import { selectWorkflowOrganization } from "@/lib/workflow-selectors";

// ---------------------------------------------------------------------------
// Task 3: Blueprint 实时动画绑定
// ---------------------------------------------------------------------------

/**
 * 将 RolePhase 映射到 AgentAnimationType。
 * 覆盖所有 RolePhase 值。
 */
function mapRolePhaseToAnimation(phase: RolePhase): AgentAnimationType {
  switch (phase) {
    case "thinking":
      return "reading";
    case "acting":
      return "typing";
    case "observing":
      return "examining";
    case "reviewing":
      return "discussing";
    case "activated":
      return "noting";
    case "sleeping":
      return "listening";
    case "completed":
      return "organizing";
    case "failed":
      return "examining";
    case "idle":
    default:
      return "listening";
  }
}

/**
 * 将 RolePhase 映射到 StatusCategory（影响光效和边框样式）。
 */
function mapRolePhaseToStatusCategory(phase: RolePhase): StatusCategory {
  switch (phase) {
    case "thinking":
    case "activated":
      return "thinking";
    case "acting":
      return "working";
    case "reviewing":
    case "observing":
      return "reviewing";
    case "completed":
      return "done";
    case "failed":
      return "error";
    case "sleeping":
    case "idle":
    default:
      return "idle";
  }
}

/**
 * 检测用户是否偏好减少动画。
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return reduced;
}

type SceneAgentConfig = BlueprintSceneAgentConfig;
type SceneDepartmentMarker = BlueprintSceneDepartmentMarker;

const SCENE_SLOT_TEMPLATES = [
  {
    color: FUTURE_DEPARTMENT_COLORS[0],
    markerPosition: [-3.25, 0, -1.7] as [number, number, number],
    manager: AGENT_VISUAL_MAP.pixel,
    workers: [
      AGENT_VISUAL_MAP.nova,
      AGENT_VISUAL_MAP.blaze,
      AGENT_VISUAL_MAP.lyra,
      AGENT_VISUAL_MAP.volt,
    ],
  },
  {
    color: FUTURE_DEPARTMENT_COLORS[1],
    markerPosition: [3.2, 0, -1.7] as [number, number, number],
    manager: AGENT_VISUAL_MAP.nexus,
    workers: [
      AGENT_VISUAL_MAP.flux,
      AGENT_VISUAL_MAP.tensor,
      AGENT_VISUAL_MAP.quark,
      AGENT_VISUAL_MAP.iris,
    ],
  },
  {
    color: FUTURE_DEPARTMENT_COLORS[2],
    markerPosition: [-2.8, 0, 2.2] as [number, number, number],
    manager: AGENT_VISUAL_MAP.echo,
    workers: [
      AGENT_VISUAL_MAP.zen,
      AGENT_VISUAL_MAP.coco,
      AGENT_VISUAL_MAP.nova,
      AGENT_VISUAL_MAP.lyra,
    ],
  },
  {
    color: FUTURE_DEPARTMENT_COLORS[3],
    markerPosition: [2.9, 0, 2.2] as [number, number, number],
    manager: AGENT_VISUAL_MAP.warden,
    workers: [
      AGENT_VISUAL_MAP.forge,
      AGENT_VISUAL_MAP.prism,
      AGENT_VISUAL_MAP.scout,
      AGENT_VISUAL_MAP.blaze,
    ],
  },
];

function getPodLabel(index: number, locale: AppLocale) {
  const suffix = String.fromCharCode(65 + index);
  return locale === "zh-CN" ? `临时战区 ${suffix}` : `Pod ${suffix}`;
}

function getLeadMarkerLabel(locale: AppLocale) {
  return locale === "zh-CN" ? "总控席" : "Lead";
}

function clampLabel(value: string, fallback: string) {
  const text = (value || fallback).trim();
  return text.length > 18 ? `${text.slice(0, 18)}…` : text;
}

function createFallbackSceneConfig(
  config: AgentVisualConfig,
  locale: AppLocale
): SceneAgentConfig {
  return {
    id: config.id,
    name: config.name,
    shortLabel: config.shortLabel,
    titleLabel: config.title[locale] || config.title["zh-CN"],
    department: config.department,
    role: config.role,
    emoji: config.emoji,
    animal: config.animal,
    position: config.position,
    rotation: config.rotation,
    scale: config.scale,
    animationType: config.animationType,
    idleText: config.idleText[locale] || config.idleText["zh-CN"],
    color:
      SCENE_SLOT_TEMPLATES.find(
        slot => slot.manager.department === config.department
      )?.color || FUTURE_OFFICE_COLORS.violet,
  };
}

function createDynamicSceneData(
  organization: WorkflowOrganizationSnapshot,
  locale: AppLocale
) {
  const rootTemplate = AGENT_VISUAL_MAP.ceo;
  const rootNode =
    organization.nodes.find(node => node.id === organization.rootNodeId) ||
    null;
  const sceneAgents: SceneAgentConfig[] = [];
  const markers: SceneDepartmentMarker[] = [];

  if (rootNode) {
    sceneAgents.push({
      id: rootNode.agentId,
      name: rootNode.name,
      shortLabel: clampLabel(rootNode.name, rootTemplate.shortLabel),
      titleLabel: rootNode.title,
      department: rootNode.departmentId,
      role: rootNode.role,
      emoji: rootTemplate.emoji,
      animal: rootTemplate.animal,
      position: rootTemplate.position,
      rotation: rootTemplate.rotation,
      scale: rootTemplate.scale,
      animationType: rootTemplate.animationType,
      idleText: rootNode.responsibility,
      color: FUTURE_OFFICE_COLORS.violet,
    });

    markers.push({
      id: rootNode.id,
      label: getLeadMarkerLabel(locale),
      position: [0, 0, -2.45],
      color: FUTURE_OFFICE_COLORS.violet,
    });
  }

  organization.departments
    .slice(0, SCENE_SLOT_TEMPLATES.length)
    .forEach((department, departmentIndex) => {
      const slot = SCENE_SLOT_TEMPLATES[departmentIndex];
      const managerNode =
        organization.nodes.find(node => node.id === department.managerNodeId) ||
        null;
      const workers = organization.nodes.filter(
        node => node.parentId === department.managerNodeId
      );

      markers.push({
        id: department.id,
        label: getPodLabel(departmentIndex, locale),
        position: slot.markerPosition,
        color: slot.color,
      });

      if (managerNode) {
        sceneAgents.push({
          id: managerNode.agentId,
          name: managerNode.name,
          shortLabel: clampLabel(managerNode.name, slot.manager.shortLabel),
          titleLabel: managerNode.title,
          department: department.id,
          role: managerNode.role,
          emoji: slot.manager.emoji,
          animal: slot.manager.animal,
          position: slot.manager.position,
          rotation: slot.manager.rotation,
          scale: slot.manager.scale,
          animationType: slot.manager.animationType,
          idleText: managerNode.responsibility,
          color: slot.color,
        });
      }

      workers.forEach((workerNode, workerIndex) => {
        const template = slot.workers[workerIndex % slot.workers.length];
        const overflowRow = Math.floor(workerIndex / slot.workers.length);
        const overflowOffset = overflowRow * 0.42;

        sceneAgents.push({
          id: workerNode.agentId,
          name: workerNode.name,
          shortLabel: clampLabel(workerNode.name, template.shortLabel),
          titleLabel: workerNode.title,
          department: department.id,
          role: workerNode.role,
          emoji: template.emoji,
          animal: template.animal,
          position: [
            template.position[0],
            template.position[1],
            template.position[2] + overflowOffset,
          ],
          rotation: template.rotation,
          scale: template.scale,
          animationType: template.animationType,
          idleText: workerNode.responsibility,
          color: slot.color,
        });
      });
    });

  // ─── Guest Agent Nodes ─────────────────────────────────────────────
  const GUEST_COLOR = FUTURE_OFFICE_COLORS.cyanSoft;
  const guestNodes = organization.nodes.filter(
    node => "guestConfig" in node || node.agentId.startsWith("guest_")
  );

  if (guestNodes.length > 0) {
    markers.push({
      id: "guest-pod",
      label: locale === "zh-CN" ? "访客区" : "Guest Pod",
      position: [0, 0, 4.5],
      color: GUEST_COLOR,
    });
  }

  guestNodes.forEach((guestNode, guestIndex) => {
    const guestConfig = (guestNode as any).guestConfig;
    const avatarHint = guestConfig?.avatarHint || "cat";
    const animal = resolveGuestAnimal(avatarHint);
    const podPosition =
      GUEST_POD_POSITIONS[guestIndex % GUEST_POD_POSITIONS.length];

    const GUEST_EMOJI: Record<string, string> = {
      cat: "🐱",
      dog: "🐶",
      bunny: "🐰",
      tiger: "🐯",
      lion: "🦁",
      elephant: "🐘",
      monkey: "🐵",
      parrot: "🦜",
      pig: "🐷",
      fish: "🐟",
      giraffe: "🦒",
      chick: "🐥",
      cow: "🐮",
      hog: "🐗",
      caterpillar: "🐛",
    };

    sceneAgents.push({
      id: guestNode.agentId,
      name: guestNode.name,
      shortLabel: clampLabel(guestNode.name, "Guest"),
      titleLabel: guestNode.title,
      department: guestNode.departmentId,
      role: guestNode.role,
      emoji: GUEST_EMOJI[animal] || "🐱",
      animal,
      position: podPosition,
      rotation: [0, Math.PI, 0],
      scale: 0.28,
      animationType: "typing",
      idleText: guestNode.responsibility,
      color: GUEST_COLOR,
      isGuest: true,
    });
  });

  return { sceneAgents, markers };
}

function SpeechBubble(_: { text: string; visible: boolean; accent: string }) {
  return null;
}

function animateWorker(
  group: THREE.Group,
  animationType: AgentAnimationType,
  basePosition: [number, number, number],
  baseRotation: [number, number, number],
  time: number,
  speedBoost: number
) {
  const motion = speedBoost > 1 ? speedBoost : 1;

  switch (animationType) {
    case "typing":
      // 打字动作：手部上下 + 轻微肩部前倾。把 y 振幅从 0.015 放到 0.035，
      // 让活跃中的角色明显「动起来」，与 idle pose 形成可视差。
      // 二次回归（用户反馈仍看不到运动）：amplitude 0.035 → 0.10（10cm），
      // 加 yaw 摇摆 0.12 让躯干侧倾。1.5Hz × 10cm 在默认相机下肉眼明显。
      group.position.y = basePosition[1] + Math.sin(time * 4 * motion) * 0.1;
      group.rotation.z = Math.sin(time * 2 * motion) * 0.12;
      group.rotation.y =
        baseRotation[1] + Math.sin(time * 1.5 * motion) * 0.08;
      break;
    case "reading":
      // 阅读：呼吸 + 低头。amplitude 0.03 → 0.08（8cm），加 yaw 摇摆。
      group.position.y =
        basePosition[1] + Math.sin(time * 1.5 * motion) * 0.08;
      group.rotation.z = Math.sin(time * 0.8 * motion) * 0.1;
      group.rotation.y =
        baseRotation[1] + Math.sin(time * 1.2 * motion) * 0.1;
      break;
    case "organizing": {
      const walkCycle = Math.sin(time * 0.8 * motion);
      group.position.x = basePosition[0] + walkCycle * 0.3;
      group.position.y =
        basePosition[1] + Math.abs(Math.sin(time * 1.6 * motion)) * 0.07;
      group.rotation.y =
        walkCycle > 0 ? baseRotation[1] + 0.3 : baseRotation[1] - 0.3;
      group.rotation.z = Math.sin(time * 1.6 * motion) * 0.06;
      break;
    }
    case "discussing":
      // 讨论：身体大幅左右转 + 上下点头。y 0.04 → 0.09。
      group.rotation.y = baseRotation[1] + Math.sin(time * 1.2 * motion) * 0.4;
      group.position.y =
        basePosition[1] + Math.abs(Math.sin(time * 3 * motion)) * 0.09;
      break;
    case "noting":
      // 记笔记：快速点头 + 上下浮动。y 0.025 → 0.07。
      group.position.y = basePosition[1] + Math.sin(time * 5 * motion) * 0.07;
      group.rotation.x = baseRotation[0] + Math.sin(time * 2.5 * motion) * 0.18;
      group.rotation.y =
        baseRotation[1] + Math.sin(time * 1.0 * motion) * 0.08;
      break;
    case "examining":
      // 仔细查看：前倾 + 左右扫视。y 0.025 → 0.06。转头幅度也加大。
      group.rotation.x = baseRotation[0] + Math.sin(time * 1.2) * 0.2;
      group.rotation.y = baseRotation[1] + Math.sin(time * 0.6) * 0.3;
      group.position.y = basePosition[1] + Math.sin(time * 2) * 0.06;
      break;
    case "listening":
      // 倾听：头部微倾 + 上下浮动 + 横向摇摆。
      // 三次回归（用户反馈：「3D 角色都没动，看着像静止」）：把 listening
      // 这个 idle 默认动画改成对所有 idle 角色都明显可见的呼吸：y 0.04 →
      // 0.09（9cm），加快 1.5Hz → 2.0Hz，同时叠 0.18 yaw 横摆，让没收到
      // 实时 phase 的角色（fuzzy 匹配前的旧 fallback 路径）也保持「活着」。
      group.rotation.z = baseRotation[2] + Math.sin(time * 0.8) * 0.15;
      group.rotation.y = baseRotation[1] + Math.sin(time * 0.5) * 0.18;
      group.position.y = basePosition[1] + Math.sin(time * 2.0) * 0.09;
      break;
    case "speaking":
      // "说话"动画：点头 + 摇摆。y 0.035 → 0.08。
      group.rotation.x = baseRotation[0] + Math.sin(time * 3) * 0.15;
      group.rotation.y = baseRotation[1] + Math.sin(time * 1.5) * 0.18;
      group.position.y = basePosition[1] + Math.abs(Math.sin(time * 4)) * 0.08;
      break;
  }
}

/* Removed verbose speech-bubble copy to keep the 3D scene visually cleaner.
const STATUS_BUBBLES: Record<AppLocale, Record<string, string>> = {
  "zh-CN": {
    listening: "正在听...\n请说出你的指令。",
    speaking: "正在说话...\n请稍等，我来念给你听。",
    analyzing_image: "正在看图...\n让我仔细看看这张图。",
    analyzing: "正在分析指令...\n先把重点梳清。",
    planning: "正在规划任务...\n把人放到对的位置。",
    executing: "执行中...\n先把结果做出来。",
    reviewing: "评审中...\n我在逐条看。",
    auditing: "审计中...\n把问题找出来。",
    revising: "修订中...\n这一版会更稳。",
    verifying: "验证中...\n确认是不是真的解决了。",
    summarizing: "汇总中...\n准备交付结论。",
    evaluating: "评估中...\n先看整体表现。",
    thinking: "思考中...\n让我组织一下。",
  },
  "en-US": {
    listening: "Listening...\nGo ahead, I am all ears.",
    speaking: "Speaking...\nHold on, let me read it out.",
    analyzing_image: "Analyzing image...\nLet me take a closer look.",
    analyzing:
      "Analyzing the directive...\nLet me untangle the key points first.",
    planning:
      "Planning the task...\nPutting the right people in the right spots.",
    executing: "Executing...\nI am turning it into something tangible first.",
    reviewing: "Reviewing...\nGoing through it point by point.",
    auditing: "Auditing...\nLooking for the hidden gaps.",
    revising: "Revising...\nThis pass should feel sturdier.",
    verifying: "Verifying...\nChecking whether the issue is truly resolved.",
    summarizing: "Summarizing...\nPreparing the handoff.",
    evaluating: "Evaluating...\nLooking at the whole outcome.",
    thinking: "Thinking...\nLet me structure it for a second.",
  },
};

function getStatusBubble(status: string, locale: AppLocale, fallback: string) {
  return STATUS_BUBBLES[locale][status] || fallback;
}
*/

function getStatusBubble(
  _status: string,
  _locale: AppLocale,
  fallback: string
) {
  return fallback;
}

/* ── Agent status → visual category mapping ── */
type StatusCategory =
  | "working"
  | "thinking"
  | "reviewing"
  | "idle"
  | "done"
  | "error";

function getStatusCategory(status: string): StatusCategory {
  switch (status) {
    case "working":
    case "executing":
    case "revising":
    case "analyzing":
    case "analyzing_image":
    case "verifying":
    case "summarizing":
    case "listening":
    case "speaking":
      return "working";
    case "thinking":
    case "planning":
    case "evaluating":
      return "thinking";
    case "reviewing":
    case "auditing":
      return "reviewing";
    case "idle":
      return "idle";
    case "done":
      return "done";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

/* Removed secondary title-pill coloring to reduce label clutter.
const STATUS_TEXT_COLORS: Record<StatusCategory, string> = {
  working: "#06b6d4",
  thinking: "#f59e0b",
  reviewing: "#a855f7",
  idle: "rgba(255, 255, 255, 0.6)",
  done: "#22c55e",
  error: "#ef4444",
};

function getStatusTextColor(status: string): string {
  return STATUS_TEXT_COLORS[getStatusCategory(status)];
}
*/

function getStatusBorderStyle(status: string): CSSProperties {
  const category = getStatusCategory(status);
  switch (category) {
    case "working":
      return {
        borderColor: "rgba(56, 189, 248, 0.55)",
        boxShadow: "0 0 10px rgba(56, 189, 248, 0.45)",
        animation: "breathe-glow 2s ease-in-out infinite",
      } as CSSProperties;
    case "thinking":
      return {
        borderColor: "rgba(125, 211, 252, 0.55)",
        boxShadow: "0 0 10px rgba(125, 211, 252, 0.4)",
        animation: "breathe-glow 1.5s ease-in-out infinite",
      };
    case "reviewing":
      return {
        borderColor: "rgba(167, 139, 250, 0.5)",
        boxShadow: "0 0 10px rgba(167, 139, 250, 0.4)",
        animation: "breathe-glow-purple 2s ease-in-out infinite",
      };
    case "done":
      return {
        borderColor: "rgba(34, 197, 94, 0.3)",
      };
    case "error":
      return {
        borderColor: "rgba(239, 68, 68, 0.5)",
        boxShadow: "0 0 8px rgba(239, 68, 68, 0.3)",
      };
    default:
      // idle: static semi-transparent white border
      return {
        borderColor: "rgba(226, 232, 240, 0.34)",
      };
  }
}

function getFlowAnchor(position: [number, number, number]) {
  return new THREE.Vector3(position[0], 0.74, position[2]);
}

function MessageFlowPath({
  from,
  to,
  color,
  opacity,
  phase,
  visualWeight = "active",
}: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  opacity: number;
  phase: number;
  visualWeight?: "subtle" | "active";
}) {
  const particleRefs = useRef<Array<THREE.Mesh | null>>([]);
  const subtle = visualWeight === "subtle";
  const glowLineWidth = subtle ? 0.9 : 1.45;
  const mainLineWidth = subtle ? 0.5 : 0.82;
  const glowOpacity = subtle
    ? Math.min(0.08, opacity * 0.34)
    : Math.min(0.13, opacity * 0.38);
  const mainOpacity = subtle
    ? Math.min(0.26, opacity + 0.02)
    : Math.min(0.48, opacity + 0.1);
  const particleRadius = subtle ? 0.034 : 0.048;
  const particleOpacity = subtle
    ? Math.min(0.34, opacity + 0.08)
    : Math.min(0.58, opacity + 0.14);
  const particleEmissiveIntensity = subtle ? 0.56 : 0.85;

  const curve = useMemo(() => {
    const start = getFlowAnchor(from);
    const end = getFlowAnchor(to);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const distance = start.distanceTo(end);

    mid.y += Math.max(0.72, distance * 0.18);
    mid.x += (end.z - start.z) * 0.04;
    mid.z += (start.x - end.x) * 0.04;

    return new THREE.QuadraticBezierCurve3(start, mid, end);
  }, [from, to]);

  const points = useMemo(() => curve.getPoints(28), [curve]);

  useFrame(({ clock }) => {
    particleRefs.current.forEach((mesh, index) => {
      if (!mesh) return;

      const t = (clock.elapsedTime * 0.32 + phase + index * 0.19) % 1;
      mesh.position.copy(curve.getPointAt(t));
      mesh.scale.setScalar(
        1.1 * (0.85 + Math.sin(clock.elapsedTime * 7 + index) * 0.18)
      );
    });
  });

  return (
    <group>
      <Line
        points={points}
        color={color}
        lineWidth={glowLineWidth}
        transparent
        opacity={glowOpacity}
      />
      <Line
        points={points}
        color={color}
        lineWidth={mainLineWidth}
        transparent
        opacity={mainOpacity}
      />

      {[0, 1, 2].map(index => (
        <mesh
          key={index}
          ref={mesh => {
            particleRefs.current[index] = mesh;
          }}
        >
          <sphereGeometry args={[particleRadius, 14, 14]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={particleEmissiveIntensity}
            transparent
            opacity={particleOpacity}
          />
        </mesh>
      ))}
    </group>
  );
}

function AgentMotionCue({
  color,
  active,
}: {
  color: string;
  active: boolean;
}) {
  const dotRefs = useRef<Array<THREE.Mesh | null>>([]);

  useFrame(({ clock }) => {
    dotRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const phase = clock.elapsedTime * (active ? 3.2 : 1.8) + index * 2.1;
      const radius = active ? 0.92 : 0.76;
      mesh.position.set(
        Math.cos(phase) * radius,
        0.42 + Math.sin(phase * 1.7) * 0.16,
        Math.sin(phase) * radius
      );
      mesh.scale.setScalar(active ? 1.2 : 0.95);
    });
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <ringGeometry args={[0.72, 0.735, 42]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={active ? 0.42 : 0.22}
          transparent
          opacity={active ? 0.12 : 0.055}
          side={THREE.DoubleSide}
        />
      </mesh>
      {[0, 1, 2].map(index => (
        <mesh
          key={index}
          ref={mesh => {
            dotRefs.current[index] = mesh;
          }}
        >
          <sphereGeometry args={[active ? 0.065 : 0.048, 12, 12]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={active ? 1.05 : 0.62}
            transparent
            opacity={active ? 0.58 : 0.34}
          />
        </mesh>
      ))}
    </group>
  );
}

function AgentWorker({
  config,
  leaving,
  reducedOverlays = false,
  mode = "mission-first",
}: {
  config: SceneAgentConfig;
  leaving?: boolean;
  reducedOverlays?: boolean;
  mode?: SceneFusionMode;
}) {
  const { scene } = useGLTF(PET_MODELS[config.animal]);
  const cloned = useMemo(() => {
    const next = scene.clone(true);
    const bounds = new THREE.Box3().setFromObject(next);
    const minY = Number.isFinite(bounds.min.y) ? bounds.min.y : 0;
    next.position.y -= minY;

    next.traverse(child => {
      if (!("isMesh" in child) || !child.isMesh) return;

      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (!material || !("envMapIntensity" in material)) continue;
        material.envMapIntensity = 0.05;
      }
    });

    return next;
  }, [scene]);

  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // Guest agent entry/exit animation state
  const guestAnimRef = useRef({
    progress: config.isGuest ? 0 : 1,
    leaving: false,
  });

  // Sync leaving prop into the animation ref
  useEffect(() => {
    if (config.isGuest && leaving) {
      guestAnimRef.current.leaving = true;
    }
  }, [config.isGuest, leaving]);

  const selectedPet = useAppStore(state => state.selectedPet);
  const setSelectedPet = useAppStore(state => state.setSelectedPet);
  const agentStatuses = useWorkflowStore(state => state.agentStatuses);
  const prefersReducedMotion = usePrefersReducedMotion();

  // Task 3.1: 从 BlueprintRealtimeStore 读取角色实时 phase
  // Wave B：蓝图模式下走 readBlueprintRolePhase 桥接，把 FSD roleId 映射到
  // mission agent id；mission-first 模式保持原有 selector 不变。
  const rolePhase = useBlueprintRealtimeStore(state =>
    mode === "blueprint"
      ? readBlueprintRolePhase(
          state.rolePhases,
          config.id as MissionAgentId
        )
      : (state.rolePhases[config.id] as RolePhase | undefined)
  );
  const roleRuntimeState = useBlueprintRealtimeStore(state =>
    mode === "blueprint"
      ? readBlueprintRoleRuntimeState(
          state.roleRuntimeStates,
          config.id as MissionAgentId
        )
      : state.roleRuntimeStates?.[config.id]
  );

  const agentStatus = agentStatuses[config.id] || "idle";
  const accent = config.color;

  // Task 3.2/3.3: 当有实时 rolePhase 时，使用映射后的动画和状态类别
  const realtimeAnimation = rolePhase
    ? mapRolePhaseToAnimation(rolePhase)
    : null;
  const realtimeStatusCategory = rolePhase
    ? mapRolePhaseToStatusCategory(rolePhase)
    : null;
  const runtimeVisual = getRoleRuntimeVisual(roleRuntimeState);
  const visualStatus =
    runtimeVisual?.statusCategory ?? realtimeStatusCategory ?? agentStatus;
  const currentRoleName = null;
  const roleColor = null;
  const activeSignalLightColor =
    runtimeVisual?.accentColor ??
    roleColor ??
    (agentStatus === "executing"
      ? FUTURE_OFFICE_COLORS.blue
      : agentStatus === "reviewing"
        ? FUTURE_OFFICE_COLORS.violet
        : agentStatus === "auditing"
          ? FUTURE_OFFICE_COLORS.cyan
          : accent);
  const hasSlowAlert = false;
  const reputationProfile = {} as { grade?: "S" | "A" | "D" } | undefined;
  const isActive = hovered || selectedPet === config.id;
  const showPrimaryLabel =
    !reducedOverlays ||
    isActive ||
    agentStatus !== "idle" ||
    config.role !== "worker";
  const showSpeechBubble = false;

  const handleClick = useCallback(() => {
    setSelectedPet(config.id);
  }, [config.id, setSelectedPet]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    // Guest entry/exit spring animation
    const guestAnim = guestAnimRef.current;
    if (config.isGuest) {
      const target = guestAnim.leaving ? 0 : 1;
      const springStiffness = 0.06;
      guestAnim.progress += (target - guestAnim.progress) * springStiffness;
      // Clamp to avoid floating point drift
      if (Math.abs(guestAnim.progress - target) < 0.001)
        guestAnim.progress = target;

      // Apply opacity to all mesh materials
      groupRef.current.traverse(child => {
        if ("isMesh" in child && child.isMesh) {
          const mesh = child as THREE.Mesh;
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          for (const mat of materials) {
            if (mat && "opacity" in mat) {
              (mat as THREE.MeshStandardMaterial).transparent = true;
              (mat as THREE.MeshStandardMaterial).opacity = guestAnim.progress;
            }
          }
        }
      });
    }

    groupRef.current.position.set(...config.position);
    groupRef.current.rotation.set(...config.rotation);

    const speedBoost =
      agentStatus === "executing" || agentStatus === "revising"
        ? 1.7
        : agentStatus === "thinking" || agentStatus === "planning"
          ? 1.25
          : 1;

    // Task 3.4/3.5: 使用实时动画（带 spring 插值），尊重 prefers-reduced-motion
    const effectiveAnimation = realtimeAnimation ?? config.animationType;
    if (!prefersReducedMotion) {
      animateWorker(
        groupRef.current,
        effectiveAnimation,
        config.position,
        config.rotation,
        clock.elapsedTime,
        speedBoost
      );
    } else {
      // Reduced-motion 降级：以前是「位置硬复位回 baseline」（看起来像石像）。
      // 用户反馈「3D 角色都没动，以前是能动的」——根因就是 OS 端开了
      // prefers-reduced-motion: reduce 后整张办公室一片静止。改为「极低
      // 振幅呼吸」：1.5cm 上下浮动 + 极小转动，传达「场景活着」的信号但
      // 不构成可感知的动画运动（满足 WCAG reduced-motion 的精神，避免
      // 体感「死掉」）。振幅是普通 listening 动画的 ~1/3。
      groupRef.current.position.set(...config.position);
      groupRef.current.rotation.set(...config.rotation);
      groupRef.current.position.y =
        config.position[1] + Math.sin(clock.elapsedTime * 0.6) * 0.015;
    }

    // Scale: blend base scale with guest animation progress (0.5→1 range)
    if (mode === "blueprint") {
      const patrol = deriveBlueprintAgentPatrol({
        agentId: config.id,
        basePosition: config.position,
        baseRotation: config.rotation,
        time: clock.elapsedTime,
        rolePhase: rolePhase ?? "idle",
        motionScale: prefersReducedMotion ? 0.65 : 1,
      });
      groupRef.current.position.set(...patrol.position);
      groupRef.current.rotation.set(...patrol.rotation);
    }

    const guestScaleFactor = config.isGuest
      ? 0.5 + guestAnim.progress * 0.5
      : 1;
    const baseScale = config.scale * guestScaleFactor;

    // Task 3.5: spring 插值实现平滑过渡（scale + 状态光效）
    const hasRealtimePhase = Boolean(realtimeAnimation || runtimeVisual);
    const targetScale = isActive
      ? baseScale * 1.14
      : hasRealtimePhase
        ? baseScale * 1.06
        : agentStatus !== "idle"
          ? baseScale * 1.04
          : baseScale;

    // Spring interpolation factor (0.12 = smooth transition)
    const nextScale =
      groupRef.current.scale.x +
      (targetScale - groupRef.current.scale.x) * 0.12;
    groupRef.current.scale.setScalar(nextScale);
  });

  return (
    <group
      ref={groupRef}
      position={config.position}
      rotation={config.rotation}
      scale={config.scale}
      onClick={handleClick}
      onPointerOver={event => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "auto";
      }}
    >
      <primitive object={cloned} />
      {mode === "blueprint" ? (
        <AgentMotionCue
          color={activeSignalLightColor}
          active={Boolean(rolePhase && rolePhase !== "idle")}
        />
      ) : null}

      {showPrimaryLabel ? (
        <Html
          position={[0, 1.8, 0]}
          center
          distanceFactor={7}
          style={{ pointerEvents: "none" }}
        >
          <div
            className={`glass-3d flex whitespace-nowrap items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-all duration-200 ${
              isActive ? "scale-110" : ""
            }`}
            style={{
              background: isActive ? accent : "rgba(248, 251, 255, 0.82)",
              color: isActive ? "#ffffff" : FUTURE_OFFICE_COLORS.text,
              ...getStatusBorderStyle(visualStatus),
            }}
          >
            <span className={isActive ? "text-white" : "text-slate-700"}>
              {config.emoji} {config.shortLabel}
            </span>
            {runtimeVisual && !reducedOverlays ? (
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase leading-none tracking-normal ${runtimeVisual.className}`}
                data-role-runtime-kind={runtimeVisual.label}
              >
                {runtimeVisual.label}
              </span>
            ) : null}
            {config.isGuest && !reducedOverlays ? (
              <span className="rounded-full bg-sky-400/85 px-1.5 py-0.5 text-[8px] font-bold text-white tracking-wider">
                Guest
              </span>
            ) : null}
          </div>
        </Html>
      ) : null}

      {currentRoleName && !reducedOverlays && (
        <Html
          position={[0, 2.2, 0]}
          center
          distanceFactor={7}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-bold text-white shadow-sm transition-all duration-500"
            style={{ backgroundColor: roleColor || FUTURE_OFFICE_COLORS.blue }}
          >
            🎭 {currentRoleName}
          </div>
        </Html>
      )}

      {hasSlowAlert && !reducedOverlays && (
        <Html
          position={[0, currentRoleName ? 2.6 : 2.4, 0]}
          center
          distanceFactor={7}
          style={{ pointerEvents: "none" }}
        >
          <div className="animate-pulse rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-md">
            ⚠ SLOW
          </div>
        </Html>
      )}

      <SpeechBubble
        text={getStatusBubble(
          agentStatus,
          useAppStore.getState().locale,
          config.idleText
        )}
        visible={showSpeechBubble}
        accent={accent}
      />

      {/* Reputation halo: gold for S, silver for A */}
      {reputationProfile?.grade === "S" && (
        <pointLight
          position={[0, 1.8, 0]}
          intensity={0.6}
          color={FUTURE_OFFICE_COLORS.warning}
          distance={3}
          decay={2}
        />
      )}
      {reputationProfile?.grade === "A" && (
        <pointLight
          position={[0, 1.8, 0]}
          intensity={0.4}
          color="#C0C0C0"
          distance={2.5}
          decay={2}
        />
      )}
      {/* Reputation warning: red pulse for D grade */}
      {reputationProfile?.grade === "D" && !reducedOverlays && (
        <Html
          position={[0, currentRoleName ? 3.0 : 2.8, 0]}
          center
          distanceFactor={7}
          style={{ pointerEvents: "none" }}
        >
          <div className="animate-pulse rounded-full bg-red-700 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-md">
            ⚠ D
          </div>
        </Html>
      )}

      {(agentStatus !== "idle" || runtimeVisual) && (
        <pointLight
          position={[0, 1.3, 0]}
          intensity={0.42}
          color={activeSignalLightColor}
          distance={2.6}
          decay={2}
        />
      )}

      {(hovered || selectedPet === config.id) && (
        <pointLight
          position={[0, 0.6, 0]}
          intensity={0.32}
          color={accent}
          distance={2}
          decay={2}
        />
      )}
    </group>
  );
}

function DepartmentMarker({
  label,
  position,
  color,
}: {
  label: string;
  position: [number, number, number];
  color: string;
}) {
  return (
    <group position={position}>
      <Html
        center
        position={[0, 0.18, 0]}
        distanceFactor={10}
        style={{ pointerEvents: "none" }}
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-100/80 bg-white/90 px-3 py-1 text-[10px] font-semibold text-slate-700 shadow-md backdrop-blur-sm">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span>{label}</span>
        </div>
      </Html>
    </group>
  );
}

export function MissionFirstAgents({
  projectId = null,
  reducedOverlays = false,
  mode = "mission-first",
}: {
  projectId?: string | null;
  reducedOverlays?: boolean;
  mode?: SceneFusionMode;
}) {
  const locale = useAppStore(state => state.locale);
  const agents = useWorkflowStore(state => state.agents);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);
  const messages = useWorkflowStore(state => state.messages);
  const socket = useWorkflowStore(state => state.socket);
  const projectMissions = useProjectStore(state => state.missions);
  const projectMissionIds = useMemo(
    () => resolveProjectMissionIds(projectId, projectMissions),
    [projectId, projectMissions]
  );
  const scopedCurrentWorkflow = useMemo(
    () => resolveScopedWorkflow(currentWorkflow, projectMissionIds),
    [currentWorkflow, projectMissionIds]
  );
  const organization = useMemo(
    () => selectWorkflowOrganization(scopedCurrentWorkflow),
    [scopedCurrentWorkflow]
  );
  const blueprintSceneRolePhases = useBlueprintRealtimeStore(
    state => state.rolePhases
  );

  // Track guest agents that are in the process of leaving (exit animation)
  const [guestLeavingIds, setGuestLeavingIds] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    if (!socket) return;

    const handleGuestLeave = (data: { guestId: string }) => {
      if (data?.guestId) {
        setGuestLeavingIds(prev => new Set(prev).add(data.guestId));
      }
    };

    socket.on("guest_leave", handleGuestLeave);
    return () => {
      socket.off("guest_leave", handleGuestLeave);
    };
  }, [socket]);

  // ── Task 17: DEV scene bridge (mission-first shell identity) ─────────────
  // When the mission-first shell is mounted, the DEV-only `window.__whybuddy3dScene`
  // must report `mountedShell: "mission-first"` so the harness P5 stage can
  // confirm the shell switch. MissionFirstAgents does NOT track blueprint
  // runtime agents, so it writes a minimal snapshot: shell identity plus empty
  // `agents` / `connectionLines` and `emptyHintVisible: false`. Only ONE shell
  // is mounted at a time (PetWorkers switches on mode), so last-writer-wins is
  // correct — the active shell installs its bridge and the inactive shell's
  // cleanup has already removed its own. Never attached in a production build.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__whybuddy3dScene = {
      getSnapshot: () => ({
        mode: "mission-first",
        mountedShell: "mission-first",
        agents: [],
        connectionLines: [],
        emptyHintVisible: false,
      }),
      dispatchEvent: (event: unknown) =>
        useBlueprintRealtimeStore.getState().dispatchEvent(event as never),
    };
    return () => {
      delete w.__whybuddy3dScene;
    };
  }, []);

  const { configs, departmentMarkers } = useMemo(() => {
    if (mode === "blueprint") {
      const sceneData = createBlueprintSceneData(locale, blueprintSceneRolePhases);
      return {
        configs: sceneData.sceneAgents,
        departmentMarkers: sceneData.markers,
      };
    }

    if (organization) {
      const sceneData = createDynamicSceneData(organization, locale);
      return {
        configs: sceneData.sceneAgents,
        departmentMarkers: sceneData.markers,
      };
    }

    const fallbackConfigs = (
      agents.length === 0
        ? AGENT_VISUAL_CONFIGS
        : AGENT_VISUAL_CONFIGS.map(config => {
            const liveAgent = agents.find(agent => agent.id === config.id);
            return liveAgent
              ? {
                  ...config,
                  name: liveAgent.name || config.name,
                  shortLabel: liveAgent.name || config.shortLabel,
                }
              : config;
          })
    ).map(config => createFallbackSceneConfig(config, locale));

    return {
      configs: fallbackConfigs,
      departmentMarkers: [
        {
          id: "ceo",
          label: getLeadMarkerLabel(locale),
          position: [0, 0, -2.45] as [number, number, number],
          color: FUTURE_OFFICE_COLORS.violet,
        },
        {
          id: "game",
          label: getPodLabel(0, locale),
          position: [-3.25, 0, -1.7] as [number, number, number],
          color: FUTURE_DEPARTMENT_COLORS[0],
        },
        {
          id: "ai",
          label: getPodLabel(1, locale),
          position: [3.2, 0, -1.7] as [number, number, number],
          color: FUTURE_DEPARTMENT_COLORS[1],
        },
        {
          id: "life",
          label: getPodLabel(2, locale),
          position: [-2.8, 0, 2.2] as [number, number, number],
          color: FUTURE_DEPARTMENT_COLORS[2],
        },
        {
          id: "meta",
          label: getPodLabel(3, locale),
          position: [2.9, 0, 2.2] as [number, number, number],
          color: FUTURE_DEPARTMENT_COLORS[3],
        },
      ],
    };
  }, [agents, blueprintSceneRolePhases, locale, mode, organization]);

  const configMap = useMemo(
    () =>
      Object.fromEntries(configs.map(config => [config.id, config])) as Record<
        string,
        SceneAgentConfig
      >,
    [configs]
  );

  // whybuddy-spec-tree-progress-merge-2026-05-29 follow-up：在 blueprint 模式下，
  // workflow-store 的 messages 永远是空（autopilot 走 BlueprintRealtimeStore 而
  // 不是 mission-first 的 socket message bus），导致 3D 场景的连线 / 粒子流
  // 永远画不出来，办公室看着像静态海报。这里订阅 rolePhases，每一对当前正在
  // 「活跃」的角色（通过 fuzzy 解析映射回 mission agent slot）→ 合成一条
  // MessageFlowPath route，让用户能看到「正在工作的那几个角色之间正有任务
  // 在路由」。mission-first 模式不订阅，行为不变。
  const blueprintRolePhases = useBlueprintRealtimeStore(
    state => state.rolePhases
  );
  const blueprintFlowRoutes = useMemo(() => {
    if (mode !== "blueprint") return [];
    return deriveBlueprintFlowRoutes(blueprintRolePhases, configMap);
  }, [mode, blueprintRolePhases, configMap]);

  const flowRoutes = useMemo<BlueprintSceneFlowRoute[]>(() => {
    // blueprint 模式优先用合成的角色活跃路由（来自 BlueprintRealtimeStore），
    // 没有活跃角色时再走下面 mission-first 的派生逻辑（兼容空态 / 测试态）。
    if (mode === "blueprint" && blueprintFlowRoutes.length > 0) {
      return blueprintFlowRoutes;
    }

    const recentMessages = messages
      .filter(
        message => configMap[message.from_agent] && configMap[message.to_agent]
      )
      .slice(-8);

    if (recentMessages.length > 0) {
      return recentMessages.map((message, index) => ({
        key: `${message.id}-${message.from_agent}-${message.to_agent}`,
        from: configMap[message.from_agent].position,
        to: configMap[message.to_agent].position,
        color:
          getSceneStageColor(message.stage) ||
          configMap[message.to_agent].color,
        opacity: 0.16 + ((index + 1) / recentMessages.length) * 0.36,
        phase: index * 0.11,
      }));
    }

    if (!scopedCurrentWorkflow?.current_stage) return [];

    const involvedDepartments =
      scopedCurrentWorkflow.departments_involved?.length > 0
        ? scopedCurrentWorkflow.departments_involved
        : departmentMarkers.map(marker => marker.id).filter(id => id !== "ceo");

    const managers = configs.filter(
      config =>
        config.role === "manager" &&
        involvedDepartments.includes(config.department)
    );
    const workers = configs.filter(
      config =>
        config.role === "worker" &&
        involvedDepartments.includes(config.department)
    );

    const makeRoute = (fromId: string, toId: string, index: number) => ({
      key: `${scopedCurrentWorkflow.current_stage}-${fromId}-${toId}-${index}`,
      from: configMap[fromId]?.position,
      to: configMap[toId]?.position,
      color:
        getSceneStageColor(scopedCurrentWorkflow.current_stage || "") ||
        configMap[toId]?.color ||
        FUTURE_OFFICE_COLORS.violet,
      opacity: 0.26,
      phase: index * 0.13,
    });

    const routes =
      scopedCurrentWorkflow.current_stage === "direction" ||
      scopedCurrentWorkflow.current_stage === "feedback"
        ? managers.map((manager, index) => makeRoute("ceo", manager.id, index))
        : scopedCurrentWorkflow.current_stage === "summary"
          ? managers.map((manager, index) =>
              makeRoute(manager.id, "ceo", index)
            )
          : scopedCurrentWorkflow.current_stage === "meta_audit"
            ? managers.flatMap((manager, index) => [
                makeRoute("warden", manager.id, index * 2),
                makeRoute("prism", manager.id, index * 2 + 1),
              ])
            : managers.flatMap((manager, index) =>
                workers
                  .filter(worker => worker.department === manager.department)
                  .map((worker, workerIndex) =>
                    makeRoute(manager.id, worker.id, index * 8 + workerIndex)
                  )
              );

    return routes.filter(
      (
        route
      ): route is BlueprintSceneFlowRoute => Boolean(route.from && route.to)
    );
  }, [
    mode,
    blueprintFlowRoutes,
    configMap,
    configs,
    messages,
    scopedCurrentWorkflow,
  ]);

  return (
    <group userData={{ shellMarker: "mission-first" }}>
      {false
        ? departmentMarkers.map(marker => (
            <DepartmentMarker
              key={marker.id}
              label={marker.label}
              position={marker.position}
              color={marker.color}
            />
          ))
        : null}

      {flowRoutes.map(route => (
        <MessageFlowPath
          key={route.key}
          from={route.from}
          to={route.to}
          color={route.color}
          opacity={route.opacity}
          phase={route.phase}
          visualWeight={route.visualWeight}
        />
      ))}

      {configs.map(config => (
        <AgentWorker
          key={config.id}
          config={config}
          leaving={guestLeavingIds.has(config.id)}
          reducedOverlays={reducedOverlays}
          mode={mode}
        />
      ))}
    </group>
  );
}
