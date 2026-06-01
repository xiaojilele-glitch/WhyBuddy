import {
  AGENT_VISUAL_MAP,
  type AgentAnimationType,
  type AgentVisualConfig,
} from "@/lib/agent-config";
import type { RolePhase } from "@/lib/blueprint-realtime-store";
import type { AppLocale } from "@/lib/locale";
import {
  FUTURE_DEPARTMENT_COLORS,
  FUTURE_OFFICE_COLORS,
} from "@/lib/scene-theme";

import {
  readBlueprintRolePhase,
  resolveRoleIdToMissionAgent,
  type MissionAgentId,
} from "./role-id-bridge";
import { mapRolePhaseToAnimation } from "./role-phase-mapping";

export type BlueprintSceneAgentConfig = {
  id: string;
  name: string;
  shortLabel: string;
  titleLabel: string;
  department: string;
  role: "ceo" | "manager" | "worker";
  emoji: string;
  animal: AgentVisualConfig["animal"];
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  animationType: AgentAnimationType;
  idleText: string;
  color: string;
  isGuest?: boolean;
};

export type BlueprintSceneDepartmentMarker = {
  id: string;
  label: string;
  position: [number, number, number];
  color: string;
};

export type BlueprintSceneFlowRoute = {
  key: string;
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  opacity: number;
  phase: number;
  visualWeight?: "subtle" | "active";
};

export type BlueprintAgentPatrolMotion = {
  position: [number, number, number];
  rotation: [number, number, number];
};

const ACTIVE_PHASES = new Set<RolePhase>([
  "thinking",
  "acting",
  "activated",
  "reviewing",
  "observing",
]);

type BlueprintRoleSlot = {
  id: MissionAgentId;
  template: AgentVisualConfig;
  department: string;
  role: "ceo" | "manager" | "worker";
  color: string;
  zh: {
    name: string;
    shortLabel: string;
    titleLabel: string;
    idleText: string;
  };
  en: {
    name: string;
    shortLabel: string;
    titleLabel: string;
    idleText: string;
  };
};

const BLUEPRINT_ROLE_SLOTS: BlueprintRoleSlot[] = [
  {
    id: "agent-ceo",
    template: AGENT_VISUAL_MAP.ceo,
    department: "command",
    role: "ceo",
    color: FUTURE_OFFICE_COLORS.violet,
    zh: {
      name: "Clarifier Lead",
      shortLabel: "澄清",
      titleLabel: "总控澄清席",
      idleText: "等待目标输入，准备拆解任务。",
    },
    en: {
      name: "Clarifier Lead",
      shortLabel: "Clarify",
      titleLabel: "Command clarifier",
      idleText: "Waiting for the next goal and ready to split the work.",
    },
  },
  {
    id: "agent-manager-research",
    template: AGENT_VISUAL_MAP.pixel,
    department: "research",
    role: "manager",
    color: FUTURE_DEPARTMENT_COLORS[0],
    zh: {
      name: "Route Planner",
      shortLabel: "规划",
      titleLabel: "路线规划",
      idleText: "规划阶段路径与角色分工。",
    },
    en: {
      name: "Route Planner",
      shortLabel: "Plan",
      titleLabel: "Route planner",
      idleText: "Planning the stage route and role assignment.",
    },
  },
  {
    id: "agent-manager-design",
    template: AGENT_VISUAL_MAP.nexus,
    department: "analysis",
    role: "manager",
    color: FUTURE_DEPARTMENT_COLORS[1],
    zh: {
      name: "Repository Analyst",
      shortLabel: "分析",
      titleLabel: "仓库分析",
      idleText: "分析上下文、约束和依赖关系。",
    },
    en: {
      name: "Repository Analyst",
      shortLabel: "Analyze",
      titleLabel: "Repository analysis",
      idleText: "Reading context, constraints, and dependencies.",
    },
  },
  {
    id: "agent-manager-engineering",
    template: AGENT_VISUAL_MAP.warden,
    department: "engineering",
    role: "manager",
    color: FUTURE_DEPARTMENT_COLORS[3],
    zh: {
      name: "Review Captain",
      shortLabel: "评审",
      titleLabel: "工程评审",
      idleText: "评审方案是否能落地。",
    },
    en: {
      name: "Review Captain",
      shortLabel: "Review",
      titleLabel: "Engineering review",
      idleText: "Checking whether the plan can land safely.",
    },
  },
  {
    id: "agent-worker-research",
    template: AGENT_VISUAL_MAP.nova,
    department: "research",
    role: "worker",
    color: FUTURE_DEPARTMENT_COLORS[0],
    zh: {
      name: "Runtime Operator",
      shortLabel: "执行",
      titleLabel: "运行时操作",
      idleText: "准备接手工具与运行时动作。",
    },
    en: {
      name: "Runtime Operator",
      shortLabel: "Operate",
      titleLabel: "Runtime operator",
      idleText: "Ready to operate tools and runtime actions.",
    },
  },
  {
    id: "agent-worker-design",
    template: AGENT_VISUAL_MAP.blaze,
    department: "generation",
    role: "worker",
    color: FUTURE_DEPARTMENT_COLORS[2],
    zh: {
      name: "Spec Author",
      shortLabel: "生成",
      titleLabel: "规格生成",
      idleText: "生成规格、任务与交付物。",
    },
    en: {
      name: "Spec Author",
      shortLabel: "Generate",
      titleLabel: "Spec generation",
      idleText: "Generating specs, tasks, and handoff artifacts.",
    },
  },
  {
    id: "agent-worker-engineering",
    template: AGENT_VISUAL_MAP.prism,
    department: "quality",
    role: "worker",
    color: FUTURE_DEPARTMENT_COLORS[3],
    zh: {
      name: "Quality Auditor",
      shortLabel: "审计",
      titleLabel: "质量审计",
      idleText: "审计质量、风险和缺口。",
    },
    en: {
      name: "Quality Auditor",
      shortLabel: "Audit",
      titleLabel: "Quality audit",
      idleText: "Auditing quality, risk, and gaps.",
    },
  },
];

function pickLocalized(slot: BlueprintRoleSlot, locale: AppLocale) {
  return locale === "zh-CN" ? slot.zh : slot.en;
}

export function createBlueprintSceneData(
  locale: AppLocale,
  rolePhases: Record<string, RolePhase> = {}
): {
  sceneAgents: BlueprintSceneAgentConfig[];
  markers: BlueprintSceneDepartmentMarker[];
} {
  const sceneAgents = BLUEPRINT_ROLE_SLOTS.map(slot => {
    const text = pickLocalized(slot, locale);
    const rolePhase = readBlueprintRolePhase(rolePhases, slot.id);
    return {
      id: slot.id,
      name: text.name,
      shortLabel: text.shortLabel,
      titleLabel: text.titleLabel,
      department: slot.department,
      role: slot.role,
      emoji: slot.template.emoji,
      animal: slot.template.animal,
      position: slot.template.position,
      rotation: slot.template.rotation,
      scale: slot.template.scale,
      animationType: rolePhase
        ? mapRolePhaseToAnimation(rolePhase)
        : slot.template.animationType,
      idleText: text.idleText,
      color: slot.color,
    };
  });

  return {
    sceneAgents,
    markers: [
      {
        id: "blueprint-command",
        label: locale === "zh-CN" ? "自动驾驶指挥链" : "Autopilot Command",
        position: [0, 0, -2.45],
        color: FUTURE_OFFICE_COLORS.violet,
      },
      {
        id: "blueprint-research",
        label: locale === "zh-CN" ? "调研与分析" : "Research",
        position: [-3.25, 0, -1.7],
        color: FUTURE_DEPARTMENT_COLORS[0],
      },
      {
        id: "blueprint-delivery",
        label: locale === "zh-CN" ? "生成与审计" : "Delivery",
        position: [3.2, 0, -1.7],
        color: FUTURE_DEPARTMENT_COLORS[2],
      },
    ],
  };
}

export function deriveBlueprintFlowRoutes(
  rolePhases: Record<string, RolePhase>,
  configMap: Record<string, { position: [number, number, number]; color: string }>
): BlueprintSceneFlowRoute[] {
  const activeSlots = new Set<MissionAgentId>();

  for (const [storeKey, phase] of Object.entries(rolePhases)) {
    if (!ACTIVE_PHASES.has(phase as RolePhase)) continue;
    const resolved = resolveRoleIdToMissionAgent(storeKey);
    if (resolved) {
      activeSlots.add(resolved);
    } else if (storeKey.startsWith("agent-")) {
      activeSlots.add(storeKey as MissionAgentId);
    }
  }

  if (activeSlots.size === 0) {
    const slot: MissionAgentId = "agent-manager-research";
    return configMap["agent-ceo"] && configMap[slot]
      ? [
          {
            key: `blueprint-default-flow-agent-ceo-${slot}`,
            from: configMap["agent-ceo"].position,
            to: configMap[slot].position,
            color: configMap[slot].color,
            opacity: 0.24,
            phase: 0,
            visualWeight: "subtle",
          },
        ]
      : [];
  }

  const routes: BlueprintSceneFlowRoute[] = [];
  const pushRoute = (
    fromSlot: MissionAgentId,
    toSlot: MissionAgentId,
    routeIndex: number
  ) => {
    const from = configMap[fromSlot];
    const target = configMap[toSlot];
    if (!from || !target || fromSlot === toSlot) return;
    routes.push({
      key: `blueprint-flow-${fromSlot}-${toSlot}-${routeIndex}`,
      from: from.position,
      to: target.position,
      color: target.color,
      opacity: 0.34,
      phase: routeIndex * 0.17,
      visualWeight: "active",
    });
  };

  const orderedPairs: Array<[MissionAgentId, MissionAgentId]> = [
    ["agent-ceo", "agent-manager-research"],
    ["agent-manager-research", "agent-manager-design"],
    ["agent-manager-design", "agent-worker-design"],
    ["agent-worker-design", "agent-manager-engineering"],
    ["agent-manager-engineering", "agent-worker-engineering"],
    ["agent-manager-engineering", "agent-worker-research"],
  ];

  let routeIndex = 0;
  for (const [fromSlot, toSlot] of orderedPairs) {
    if (activeSlots.has(fromSlot) || activeSlots.has(toSlot)) {
      pushRoute(fromSlot, toSlot, routeIndex);
      routeIndex += 1;
    }
  }

  if (routes.length > 0) return routes;

  const activeList = Array.from(activeSlots);
  const first = activeList[0];
  const second = activeList[1] ?? "agent-ceo";
  pushRoute(second === first ? "agent-ceo" : first, second, 0);
  return routes;
}

function agentMotionSeed(agentId: string): number {
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1) {
    hash = (hash * 31 + agentId.charCodeAt(index)) % 997;
  }
  return hash / 997;
}

export function deriveBlueprintAgentPatrol({
  agentId,
  basePosition,
  baseRotation,
  time,
  rolePhase = "idle",
  motionScale = 1,
}: {
  agentId: string;
  basePosition: [number, number, number];
  baseRotation: [number, number, number];
  time: number;
  rolePhase?: RolePhase;
  motionScale?: number;
}): BlueprintAgentPatrolMotion {
  const active = ACTIVE_PHASES.has(rolePhase);
  const completed = rolePhase === "completed";
  const failed = rolePhase === "failed";
  const seed = agentMotionSeed(agentId);
  const phase = seed * Math.PI * 2;
  const speed = (active ? 0.92 : completed ? 0.5 : failed ? 0.72 : 0.62) *
    Math.max(0.2, motionScale);
  const radius = (active ? 0.58 : completed ? 0.28 : failed ? 0.38 : 0.36) *
    Math.max(0.25, motionScale);
  const t = time * speed + phase;
  const xOffset = Math.cos(t) * radius;
  const zOffset = Math.sin(t) * radius * 0.82;
  const yOffset = Math.abs(Math.sin(time * (active ? 5.2 : 2.4) + phase)) *
    (active ? 0.1 : 0.055) *
    Math.max(0.35, motionScale);
  const facingYaw = Math.atan2(xOffset, zOffset);

  return {
    position: [
      basePosition[0] + xOffset,
      basePosition[1] + yOffset,
      basePosition[2] + zOffset,
    ],
    rotation: [
      baseRotation[0],
      baseRotation[1] + facingYaw * 0.22,
      baseRotation[2] + Math.sin(t * 1.4) * (active ? 0.1 : 0.055),
    ],
  };
}
