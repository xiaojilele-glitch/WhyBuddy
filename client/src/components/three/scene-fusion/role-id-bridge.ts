/**
 * 自动驾驶 3D 场景融合 — FSD roleId 到 mission agent id 的映射桥。
 *
 * 蓝图后端 emit 的 role.* 事件（来自 agent-reasoning-bridge）payload.roleId
 * 是 FSD 角色名（共 7 个），但 PetWorkers 配置使用的是 mission agent id 体系
 * （也是 7 个）。该纯函数用近似映射把 FSD roleId 翻译为 mission agent id，
 * 让 3D 场景在蓝图页能够跟随 FSD 角色阶段动起来。
 *
 * 映射不准是已知风险（已写入 requirements.md 风险段 1），后续可单点替换
 * 该映射表，不会扩散到调用方。
 *
 * 该模块零副作用、零 hook、零 DOM 引用，可在任何渲染阶段安全调用。
 *
 * 同时把 SceneFusionMode 的正式定义从 Scene3D.tsx inline 类型升级到本模块导出，
 * Wave B 之后所有 mode 透传链路统一从这里 import。
 */

import type {
  RolePhase,
  RoleRuntimeState,
} from "@/lib/blueprint-realtime-store";

/**
 * 自动驾驶 3D 场景融合模式。
 *
 * - "blueprint"：蓝图页（/autopilot），3D 场景跟随 BlueprintRealtimeStore；
 * - "mission-first"：mission-first 任务壳（/tasks 等），3D 场景跟随 mission 信号。
 *
 * 默认值约定为 "mission-first"，确保未显式传 mode 的调用方走原路径。
 */
export type SceneFusionMode = "blueprint" | "mission-first";

/** FSD 蓝图后端使用的 7 个角色名。 */
export type FsdRoleId =
  | "planner"
  | "clarifier"
  | "analyzer"
  | "generator"
  | "reviewer"
  | "auditor"
  | "operator";

/** mission-first 任务壳使用的 7 个 agent id。 */
export type MissionAgentId =
  | "agent-ceo"
  | "agent-manager-research"
  | "agent-manager-design"
  | "agent-manager-engineering"
  | "agent-worker-research"
  | "agent-worker-design"
  | "agent-worker-engineering";

/**
 * FSD roleId → mission agent id 的近似映射表。
 *
 * 映射方向（来自 requirements.md AC6）：
 * - planner   → agent-manager-research
 * - clarifier → agent-ceo
 * - analyzer  → agent-manager-design
 * - generator → agent-worker-design
 * - reviewer  → agent-manager-engineering
 * - auditor   → agent-worker-engineering
 * - operator  → agent-worker-research
 */
const FSD_TO_MISSION: Record<FsdRoleId, MissionAgentId> = {
  planner: "agent-manager-research",
  clarifier: "agent-ceo",
  analyzer: "agent-manager-design",
  generator: "agent-worker-design",
  reviewer: "agent-manager-engineering",
  auditor: "agent-worker-engineering",
  operator: "agent-worker-research",
};

/**
 * 真实自动驾驶 job 的 role timeline 用了远多于 7 个 FSD 名的具体角色
 * （`repository-analyst` / `spec-author` / `route-planner` / `product-strategist`
 * / `executor-architect` / `runtime-quality-auditor` / `repo-engineer` / ...）。
 * 这些 id 不会精确命中 FSD_TO_MISSION 字面量 key，导致 3D 角色全部退到 idle
 * 动画（即用户看到的「静止不动」）。
 *
 * 这里加一个**关键字 → FSD canonical** 的纯字符串匹配 fallback：把任意角色
 * 名扫一遍熟悉的子串，挑命中的 FSD canonical 名后再走 FSD_TO_MISSION。匹配
 * 不到才回 undefined。匹配顺序按特异性从高到低排（更长 / 更具体的关键字先匹）
 * ，避免 `analyst` 被 `analyzer` 之外的 alias 抢走。
 */
const FUZZY_FSD_KEYWORDS: ReadonlyArray<readonly [string, FsdRoleId]> = [
  // auditor / quality / review 类
  ["audit", "auditor"],
  ["quality", "auditor"],
  ["review", "reviewer"],
  ["validator", "reviewer"],
  // analyzer / analyst / research / inspect 类
  ["analy", "analyzer"], // analyst / analyzer / analysis / analytic
  ["inspect", "analyzer"],
  ["research", "analyzer"], // researcher / research-* — 调研类工作归 analyzer
  ["repo-engineer", "analyzer"],
  ["repository", "analyzer"],
  // generator / author / writer / spec-author 类
  ["author", "generator"],
  ["writer", "generator"],
  ["generator", "generator"],
  ["builder", "generator"],
  ["synthes", "generator"],
  // planner / architect / strategy / route 类
  ["plan", "planner"],
  ["architect", "planner"],
  ["strateg", "planner"],
  ["route-", "planner"],
  // clarifier / interview 类
  ["clarif", "clarifier"],
  ["interview", "clarifier"],
  // operator / runtime / executor / dispatcher 类
  ["operator", "operator"],
  ["runtime", "operator"],
  ["executor", "operator"],
  ["dispatcher", "operator"],
];

/**
 * 把任意 role id（FSD canonical 或更具体的派生角色名）解析成最贴近的
 * `MissionAgentId`。先尝试字面量精确命中 FSD_TO_MISSION，再走子串关键字
 * fallback；都没命中返回 undefined。
 *
 * 全小写比较，调用方不需要预先归一化。
 */
export function resolveRoleIdToMissionAgent(
  roleId: string
): MissionAgentId | undefined {
  // 1. 字面量命中（与原映射表完全等价）
  const exact = FSD_TO_MISSION[roleId as FsdRoleId];
  if (exact) return exact;

  // 2. 关键字模糊命中
  const lower = roleId.toLowerCase();
  for (const [keyword, fsd] of FUZZY_FSD_KEYWORDS) {
    if (lower.includes(keyword)) {
      return FSD_TO_MISSION[fsd];
    }
  }

  return undefined;
}

/**
 * 从 BlueprintRealtimeStore.rolePhases 中按 mission agent id 读取对应的 RolePhase。
 *
 * 优先策略（蓝图模式专用，对应 AC9：FSD 优先）：
 *   1. 反查 FSD roleId：遍历 FSD_TO_MISSION，找出所有映射到目标 mission agent id 的
 *      FSD roleId，若 rolePhases[fsdRoleId] 存在则优先返回；
 *   2. fallback 直读 mission agent id（对应 AC6 fallback）；
 *   3. 都没有则返回 undefined。
 *
 * mission-first 模式不调用此函数，组件直接 state.rolePhases[config.id] 读取。
 *
 * 容错：rolePhases 可能为 undefined / null / 空对象，全部安全返回 undefined。
 *
 * @param rolePhases BlueprintRealtimeStore 的 rolePhases 字典
 * @param missionAgentId 目标 mission agent id（PetWorkers 配置中 config.id）
 * @returns 对应的 RolePhase，不存在则 undefined
 */
export function readBlueprintRolePhase(
  rolePhases: Record<string, RolePhase> | undefined | null,
  missionAgentId: MissionAgentId
): RolePhase | undefined {
  if (!rolePhases) return undefined;

  // 优先：把每个 store key 模糊解析成 MissionAgentId，命中目标的就返回。
  // 这一步覆盖真实自动驾驶 job 的派生角色名（spec-author / repository-analyst
  // / runtime-quality-auditor 等），让 3D 场景在 blueprint 模式下能跟着角色
  // 阶段动起来；而不是因字面量 key 不匹配整片 idle。
  for (const [storeKey, phase] of Object.entries(rolePhases)) {
    const resolved = resolveRoleIdToMissionAgent(storeKey);
    if (resolved === missionAgentId && phase !== undefined) {
      return phase;
    }
  }

  // fallback：直读 mission agent id（保留 AC6 fallback 路径）
  return rolePhases[missionAgentId];
}

export function readBlueprintRoleRuntimeState(
  roleRuntimeStates: Record<string, RoleRuntimeState> | undefined | null,
  missionAgentId: MissionAgentId
): RoleRuntimeState | undefined {
  if (!roleRuntimeStates) return undefined;

  for (const [storeKey, runtimeState] of Object.entries(roleRuntimeStates)) {
    const resolved = resolveRoleIdToMissionAgent(storeKey);
    if (resolved === missionAgentId && runtimeState !== undefined) {
      return runtimeState;
    }
  }

  return roleRuntimeStates[missionAgentId];
}
