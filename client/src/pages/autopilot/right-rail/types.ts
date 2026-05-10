/**
 * Autopilot 驾驶舱右栏收敛 — 类型契约与子阶段枚举
 *
 * 本文件是纯类型模块：
 * - 不 import 任何 React 组件；
 * - 不 import `@/lib/blueprint-api` 的任何运行时成员（仅 `type` 引入 Snapshot 类型，因为两个
 *   `*Snapshot` 目前只在 blueprint-api 单体中有规范定义，尚未上提至 `@shared/blueprint/contracts`）；
 * - 不包含任何运行时代码；`resolveRailSubStage` 的实现由任务 2 在 `./resolve-rail-sub-stage.ts`
 *   中落地。
 *
 * 对应 spec：`.kiro/specs/autopilot-cockpit-right-rail-convergence/`
 * - 需求 2（Resolver 纯函数语义）
 * - 需求 3（右栏组件 props 契约）
 * - 需求 6.5（组件仅通过 props 接收数据）
 * - 需求 8.4（scaffolding 通过 tsc，不扩大现有 TS 基线错误数）
 */

import type { AppLocale } from "@/lib/locale";
import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintGenerationJob,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type {
  BlueprintAgentCrewSnapshot,
  BlueprintEffectPreviewSnapshot,
} from "@/lib/blueprint-api";

/**
 * 左侧 5 阶段时间线的顶层 stage 枚举。
 *
 * 与 `AutopilotWorkflowRail` 当前使用的 `flowSteps[].id` 对齐；`projection` 视觉展示步骤
 * 不计入此枚举，因为它不参与 `AutopilotWorkflowStage` 判定。
 */
export type AutopilotTimelineStage =
  | "input"
  | "clarification"
  | "routeset"
  | "selection"
  | "fabric";

/**
 * `fabric` stage 内部的 8 个子工作台枚举。
 *
 * 仅当 `currentStage === "fabric"` 时才会出现；顺序由 `RAIL_SUB_STAGE_ORDER` 冻结，供 UI
 * 渲染与 PBT 共享。
 */
export type AutopilotRailSubStage =
  | "agent_crew_fabric"
  | "spec_tree"
  | "spec_documents"
  | "effect_preview"
  | "prompt_package"
  | "runtime_capability"
  | "engineering_handoff"
  | "artifact_memory";

/**
 * 8 个 `AutopilotRailSubStage` 的声明顺序（只读）。
 *
 * 任何「子阶段是否单调推进」「是否越过某个子阶段」的属性判定都必须以本常量的 index 为准，
 * 禁止在其他文件中复制或派生一份平行的顺序源。
 */
export const RAIL_SUB_STAGE_ORDER: readonly AutopilotRailSubStage[] = [
  "agent_crew_fabric",
  "spec_tree",
  "spec_documents",
  "effect_preview",
  "prompt_package",
  "runtime_capability",
  "engineering_handoff",
  "artifact_memory",
] as const;

/**
 * `<AutopilotRightRail>` 的外部契约。
 *
 * 硬性约束：
 * - 消费方只能通过 props 接收数据；组件内部禁止 `useAppStore` 或直接调用 `@/lib/blueprint-api`。
 * - 当 `currentStage !== "fabric"` 时，`currentSubStage` 必须为 `undefined`。
 * - `effectPreviews / capabilities / capabilityInvocations / capabilityEvidence` 的命名与
 *   `BlueprintProgressPanel` 现有 props 对齐，以降低 Spec 2 的迁移成本。
 */
export interface AutopilotRightRailProps {
  /** 当前 blueprint generation job id；没有 job 时仍需提供空字符串占位 */
  jobId: string;
  /** 左侧时间线当前激活阶段 */
  currentStage: AutopilotTimelineStage;
  /** 仅当 currentStage === "fabric" 时才应为有值，其它阶段必须为 undefined */
  currentSubStage?: AutopilotRailSubStage;
  /** 主数据对象 */
  job: BlueprintGenerationJob | null;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  agentCrew: BlueprintAgentCrewSnapshot | null;
  /** 下游数据插槽（命名与 BlueprintProgressPanel 现有 props 对齐） */
  capabilities: BlueprintRuntimeCapability[];
  capabilityInvocations: BlueprintCapabilityInvocation[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  effectPreviews: BlueprintEffectPreviewSnapshot[];
  /** i18n */
  locale: AppLocale;
  /** 用户点击子阶段导航时由父组件处理 */
  onSubStageChange: (next: AutopilotRailSubStage) => void;
}

/**
 * `resolveRailSubStage` 的输入快照。
 *
 * 纯函数依赖：仅包含推导目标 sub-stage 所需的 5 个字段，不含任何环境引用。
 */
export interface ResolveRailSubStageInput {
  currentStage: AutopilotTimelineStage;
  job: BlueprintGenerationJob | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  agentCrew: BlueprintAgentCrewSnapshot | null;
}

// Resolver 实现位于 `./resolve-rail-sub-stage.ts`（任务 2 落地）。本文件只持有类型契约，
// 不重复声明 `resolveRailSubStage` 的签名，避免与运行时实现产生合并冲突。
