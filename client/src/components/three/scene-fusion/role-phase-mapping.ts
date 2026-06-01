/**
 * whybuddy-spec-tree-progress-merge-2026-05-29 follow-up：
 * 把原 `PetWorkers.tsx` 顶部的两个非 React 工具函数迁出到独立模块，
 * 让 `PetWorkers.tsx` 重新成为「纯 React 组件文件」。
 *
 * 背景：当一个 .tsx 模块同时 export React 组件 + 普通工具函数时，Vite 的
 * React Fast Refresh boundary 会标记成 incompatible，HMR 落到 invalidate
 * 路径。客户端会被通知重新拉模块，但 R3F 在首次渲染时已经把 `useFrame`
 * 闭包绑到帧循环里——失效不会重建组件树，闭包永远是旧版本。后果是用户
 * 在浏览器里看到的 idle 动画振幅永远是首次加载时的值（旧版 0.01 ≈ 1cm，
 * 肉眼几乎看不出在动），即使源码里改成了 0.09 / 0.10 也无效。
 *
 * 抽离后 PetWorkers.tsx 只剩 React 组件 export，Fast Refresh 重新生效，
 * HMR 改动会真正替换掉 useFrame 闭包，用户的浏览器跟我打开的浏览器看到
 * 同一份动画。
 */

import type { AgentAnimationType } from "@/lib/agent-config";
import type { RolePhase } from "@/lib/blueprint-realtime-store";

/**
 * 角色当前生命周期状态对应的视觉类别（影响光效边框 / 状态标签）。
 *
 * 与 PetWorkers `getStatusCategory` 的输出域保持一致：
 * working / thinking / reviewing / idle / done / error。
 */
export type StatusCategory =
  | "working"
  | "thinking"
  | "reviewing"
  | "idle"
  | "done"
  | "error";

/**
 * 将 RolePhase 映射到 AgentAnimationType。
 *
 * 覆盖所有 RolePhase 字面量；未知 phase 落到 listening 兜底。
 */
export function mapRolePhaseToAnimation(phase: RolePhase): AgentAnimationType {
  switch (phase) {
    case "thinking":
      return "noting";
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
export function mapRolePhaseToStatusCategory(
  phase: RolePhase
): StatusCategory {
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
