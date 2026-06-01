/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面跨阶段挂载点。
 *
 * 把 RoleStatusStrip / CapabilityRail / FleetActivationLog 三个 store-observability
 * 组件打包为一个 HUD overlay，可以挂在 `AutopilotVisualStage` 顶部，让用户在
 * 任意阶段（input / clarification / routeset / selection / fabric）都能看到
 * 实时事件流，而不必等到 fabric 阶段右栏 `AutopilotRightRail` 被挂载。
 *
 * 设计原则（与底层三组件一致）：
 * - 只读：不写 store，不订阅 socket
 * - 折叠态级联：当 store 三个切片都为空时，每个子组件都会返回 null；本组件
 *   依赖三者的 null 输出来决定整体是否可见，不需要额外判断
 * - 不抢占布局：HUD 容器自身保留最小 padding，所有真正占空间的元素都来自
 *   子组件；当全部子组件返回 null 时容器仍存在但只是一个透明壳子
 *
 * 与 `AutopilotRightRail` fabric 分支挂载点的关系：
 * - 同一个用户会话中，两个挂载点会**同时**消费同一份 store；
 * - 每个底层组件用 `useBlueprintRealtimeStore` selector 订阅，store 是单例，
 *   两份挂载点显示的内容完全一致；
 * - fabric 阶段时，HUD overlay 与右栏底部条带会同时存在，这是预期的：
 *   HUD 用于场景上方一瞥可见，右栏用于阶段卡片旁纵深查看。
 */

import type { FC } from "react";

import { AgentReasoningSubTimeline } from "./AgentReasoningSubTimeline";
import { CapabilityRail } from "./CapabilityRail";
import { FleetActivationLog } from "./FleetActivationLog";

/**
 * 跨阶段 HUD overlay。建议作为 `AutopilotVisualStage` 内部 absolute-positioned
 * 容器的子节点，例如：
 *
 *   <div className="absolute left-3 right-3 top-3 z-10">
 *     <StoreObservabilityHud />
 *   </div>
 *
 * 也可以作为右栏底部的内联挂载点；本组件不强制要求父级提供 absolute 定位。
 *
 * whybuddy-3d-real-role-driven-scene-2026-05-29 修订：移除 `<RoleStatusStrip />`，
 * 角色身份 / 状态已由 3D 真实角色承载；`<CapabilityRail />` 现在只承载能力调用
 * 明细面板（顶部全量能力 pills 已移除，由 3D 角色桌前 chips 承载）。
 */
export const StoreObservabilityHud: FC = () => {
  return (
    <div
      data-testid="store-observability-hud"
      className="flex flex-col gap-1.5 rounded-[10px] bg-white/85 p-2 backdrop-blur-md shadow-sm"
    >
      <CapabilityRail />
      <AgentReasoningSubTimeline />
      <FleetActivationLog />
    </div>
  );
};

export default StoreObservabilityHud;
