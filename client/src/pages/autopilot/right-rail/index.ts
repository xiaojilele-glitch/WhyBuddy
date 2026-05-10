/**
 * Autopilot 驾驶舱右栏收敛 — 对外导出 barrel
 *
 * 对应 spec：`.kiro/specs/autopilot-cockpit-right-rail-convergence/`
 * - 需求 3（对外暴露 `AutopilotRightRailProps` 契约与 `resolveRailSubStage` 纯函数）
 *
 * 本文件只做 re-export，不新增运行时行为。消费方应通过
 * `import { AutopilotRightRail, resolveRailSubStage, RAIL_SUB_STAGE_ORDER } from "@/pages/autopilot/right-rail"`
 * 的方式引用，避免直接深链 `./types` 或 `./resolve-rail-sub-stage` 产生多路径漂移。
 */

export { AutopilotRightRail } from "./AutopilotRightRail";
export { resolveRailSubStage } from "./resolve-rail-sub-stage";
export {
  RAIL_SUB_STAGE_ORDER,
  type AutopilotRailSubStage,
  type AutopilotRightRailProps,
  type AutopilotTimelineStage,
  type ResolveRailSubStageInput,
} from "./types";
