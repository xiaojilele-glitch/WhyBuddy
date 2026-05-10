/**
 * Autopilot 驾驶舱右栏收敛 — `resolveRailSubStage` 纯函数实现
 *
 * 本文件是任务 2 的落地点，对应 spec：
 * `.kiro/specs/autopilot-cockpit-right-rail-convergence/`，落实 design.md「Resolver 规则」
 * 段落中定义的 switch 映射与三条关键性质（P1 Total function、P2 Monotonicity、P3
 * Idempotence）。
 *
 * 硬性约束（必须逐条满足，后续任务 2.1/2.2/2.3 的 PBT 会验证）：
 * - 纯函数：不 import 任何 store、不 import `@/lib/blueprint-api` 运行时成员、不使用
 *   `Date.now()` / `Math.random()` / `performance.now()`、不 `console.*`、不抛异常、不修改入参。
 * - `currentStage !== "fabric"` 时严格返回 `undefined`。
 * - `currentStage === "fabric"` 时严格返回 `RAIL_SUB_STAGE_ORDER` 中的一员。
 * - 对相同入参快照多次调用返回值全等（幂等）。
 */

import type { AutopilotRailSubStage, ResolveRailSubStageInput } from "./types";

/**
 * `BlueprintGenerationJob.stage` 目前在 `shared/blueprint/contracts.ts` 中的枚举值不包含
 * design.md 例举的 `"route_selection"` 与 `"agent_crew_fabric"`（两者是 spec 层的过渡态语义，
 * 非后端契约枚举）；为了让 switch 规则与 design.md「一字不差」并对未来契约扩展保持开放，此处
 * 使用局部宽松字符串类型，再由 default 分支兜底为 `"agent_crew_fabric"`。
 */
type JobStageLike = string;

/**
 * 根据 design.md「Resolver 规则」段落，将 `BlueprintGenerationJob.stage` 映射到 fabric 内部
 * 的 8 个 Rail_Sub_Stage 之一。
 *
 * 契约：
 * - 当 `input.currentStage !== "fabric"` 时返回 `undefined`；
 * - 当 `input.currentStage === "fabric"` 且 `input.job` 为 `null` 或其 `stage` 处于上游阶段
 *   时，返回 `"agent_crew_fabric"` 作为起始子阶段；
 * - 其余情况按 design.md 给定的 switch 表返回对应子阶段；
 * - 未知 `job.stage` 值统一兜底为 `"agent_crew_fabric"`，保证 UI 永远有起点面板可展示。
 */
export function resolveRailSubStage(
  input: ResolveRailSubStageInput
): AutopilotRailSubStage | undefined {
  if (input.currentStage !== "fabric") {
    return undefined;
  }

  const jobStage: JobStageLike = input.job?.stage ?? "agent_crew_fabric";

  switch (jobStage) {
    case "input":
    case "clarification":
    case "route_generation":
    case "route_selection":
    case "agent_crew_fabric":
      return "agent_crew_fabric";
    case "spec_tree":
      return "spec_tree";
    case "spec_docs":
      return "spec_documents";
    case "preview":
    case "effect_preview":
      return "effect_preview";
    case "prompt_packaging":
      return "prompt_package";
    case "runtime_capability":
      return "runtime_capability";
    case "engineering_handoff":
      return "engineering_handoff";
    case "engineering_landing":
      return "artifact_memory";
    default:
      return "agent_crew_fabric";
  }
}
