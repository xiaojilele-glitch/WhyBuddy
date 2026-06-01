/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面 Step 2。
 *
 * whybuddy-3d-real-role-driven-scene-2026-05-29 修订：
 * 原本这里在顶部平铺一整排「全量能力 pills」（每个 capabilityId 一颗 badge）。
 * 该信息现在已经由 3D 场景的「角色桌前能力 chips」承载——谁调用了什么能力、
 * 状态如何，都绑定在真实角色身上。右侧再平铺一排 capability id 属于重复且吵，
 * 因此移除顶部 pills 行，只保留内部 `CapabilityBridgePanel`（完整调用明细 / 耗时 /
 * 完成状态 / 审计记录），因为这部分尚未完整迁移进 3D。
 *
 * 设计原则：
 * - 只读：不写 store，不订阅 socket
 * - 折叠态：当 `CapabilityBridgePanel` 无调用数据时，面板自身返回 null，
 *   本组件随之整体不占布局空间
 * - 可在多个位置挂载：右栏 fabric 分支与 AutopilotVisualStage 顶部 HUD 都是合法挂载点
 */

import type { FC } from "react";

import type { AppLocale } from "@/lib/locale";
import { useAppStore } from "@/lib/store";

import { CapabilityBridgePanel } from "./capability-panel/CapabilityBridgePanel";

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 能力调用明细挂载点。
 *
 * 行为契约：
 * 1. 不再渲染顶部「全量能力 status pills」（已由 3D 角色桌前 chips 承载）。
 * 2. 仅渲染 `CapabilityBridgePanel`，面板内部调用 `useCapabilityBridgeState()`，
 *    无调用数据时返回 `null`，因此本组件在无数据时也不占据布局空间。
 */
export const CapabilityRail: FC = () => {
  const locale = useAppStore((s) => s.locale) as AppLocale;

  // 详细调用明细面板（耗时 / 完成状态 / 审计记录）。3D 只做轻量 chip，
  // 这部分尚未迁移到 3D，保留为右侧审计详情。
  return <CapabilityBridgePanel locale={locale} />;
};

export default CapabilityRail;
