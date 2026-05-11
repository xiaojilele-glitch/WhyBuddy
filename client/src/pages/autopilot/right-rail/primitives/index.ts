/**
 * Autopilot sub-stage card primitives — Wave 1 / Spec 2
 *
 * 对应 spec：`.kiro/specs/autopilot-sub-stage-card-primitive/`
 *
 * 本模块统一 re-export 三个纯展示 primitive 供 Wave 2 的
 * `autopilot-right-rail-streaming-layout` 组装使用：
 *
 * - `<StatusCapsule>`  — 右上角状态胶囊（构建完成 / 执行中 / 等待）
 * - `<MetricsRow>`     — 大号 mono 数字指标行（2/3/4 列 grid）
 * - `<SubStageCard>`   — MiroFish 风格卡片外壳（直角 / 1px 边框 / 四段式）
 *
 * 共享的 `SubStageStatus` 状态枚举在此文件顶部定义，三个 primitive 共用。
 *
 * 硬性约束：
 * - 本目录下所有文件均为纯展示组件，禁止 import `@/lib/store` / `useAppStore`
 *   或业务类型（如 `AutopilotRightRailProps` / `BlueprintGenerationJob`）。
 * - 不读 `window` / `document`，仅通过 props 接收数据。
 * - locale 仅影响 `<StatusCapsule>` 内部静态文案，其他 primitive 透传字符串。
 */

export type SubStageStatus = "completed" | "active" | "pending";

export { StatusCapsule } from "./status-capsule";
export type { StatusCapsuleProps } from "./status-capsule";

export { MetricsRow } from "./metrics-row";
export type { Metric, MetricsRowProps } from "./metrics-row";

export { SubStageCard } from "./sub-stage-card";
export type { SubStageCardProps } from "./sub-stage-card";
