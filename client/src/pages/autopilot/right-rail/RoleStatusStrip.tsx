/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面 Step 1。
 *
 * 横向角色态条带：从 useBlueprintRealtimeStore.rolePhases 读取所有已知角色的
 * RolePhase，按 8 类相位着色。此组件是 store.rolePhases 在 2D 右栏的第一位
 * 消费者；3D 场景的 PetWorkers 已经在 3D 侧消费同一份数据。
 *
 * 增强（Task 4.1）：在现有内容上方插入 RoleCrewDots 角色状态圆点序列，
 * 并添加当前阶段标签。保持总高度 ≤ 48px。
 *
 * 设计原则：
 * - 只读：不写 store，不订阅 socket（订阅由 AutopilotRoutePage 的两段式 useEffect 完成）
 * - 折叠态：当 rolePhases 为空（尚未到达任何 role.* 事件）时返回 null，避免空容器抢占布局
 * - 可在多个位置挂载：右栏 fabric 分支与 AutopilotVisualStage 顶部 HUD 都是合法挂载点；
 *   组件本身不判断 currentStage，是否可见完全由 store 切片是否有数据决定。
 */

import type { FC } from "react";

import {
  useBlueprintRealtimeStore,
  type RolePhase,
} from "@/lib/blueprint-realtime-store";
import { useAppStore } from "@/lib/store";
import type { AppLocale } from "@/lib/locale";
import { displayLabel } from "@/components/three/scene-fusion/role-display-label";

import { RoleCrewDots } from "./crew-activation/RoleCrewDots";
import { useRoleCrewState } from "./crew-activation/useRoleCrewState";
import { resolveStageLabel } from "./role-labels";

/**
 * 8 类相位 + idle 默认色到 Tailwind class 的稳定映射。
 *
 * 颜色语义遵循 spec：
 * - activated / thinking → 蓝色家族（已激活 / 思考中）
 * - acting               → 琥珀色（执行中）
 * - observing / completed → 绿色家族（观察中 / 已完成）
 * - reviewing            → 紫色（评审中）
 * - sleeping             → 静默灰
 * - failed               → 玫红（失败）
 * - idle                 → 中性灰（默认占位）
 */
const PHASE_BADGE_CLASS: Record<RolePhase, string> = {
  activated: "bg-blue-100 text-blue-700",
  thinking: "bg-blue-50 text-blue-800 animate-pulse",
  acting: "bg-amber-100 text-amber-700",
  observing: "bg-emerald-100 text-emerald-700",
  reviewing: "bg-violet-100 text-violet-700",
  sleeping: "bg-slate-100 text-slate-500",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
  idle: "bg-slate-100 text-slate-600",
};

/**
 * 解析单个 roleId 对应的 badge class。未知 phase（理论上不会出现，但留作
 * defensive 兜底）回退到 idle 配色，避免渲染无样式的空白徽章。
 */
function resolvePhaseClass(phase: RolePhase | undefined): string {
  if (!phase) return PHASE_BADGE_CLASS.idle;
  return PHASE_BADGE_CLASS[phase] ?? PHASE_BADGE_CLASS.idle;
}

/** 阶段索引到简短标签的映射 — 已迁移到 role-labels.ts，此处保留注释供追溯 */
// See: ./role-labels.ts — resolveStageLabel(index, locale)

/**
 * 横向角色态条带。无 props：roleId 是稳定标识符（如 `planner` / `analyzer`），
 * 不需要 i18n；颜色与相位一一对应，不依赖父级布局。
 *
 * 增强（Task 4.1）：在现有 badge 列表上方插入 RoleCrewDots 角色状态圆点序列
 * 与当前阶段标签，保持总高度 ≤ 48px。
 */
export const RoleStatusStrip: FC = () => {
  const rolePhases = useBlueprintRealtimeStore((s) => s.rolePhases);
  const { roles, currentStageIndex } = useRoleCrewState();
  // Explicit exception to right-rail props-only convention: RoleStatusStrip
  // already consumes useBlueprintRealtimeStore directly as a store-consumer
  // observation strip, so reading locale from useAppStore is consistent.
  const locale = useAppStore((s) => s.locale) as AppLocale;

  // 防御性兜底：rolePhases 在 store 的初始 state 中即为 `{}`，正常路径下不会
  // 是 undefined / null。但为了让本组件不依赖具体测试 mock 的字段完整度，
  // 这里把空 / 缺省 / null / undefined 一律视为折叠态。
  const entries =
    rolePhases && typeof rolePhases === "object"
      ? Object.entries(rolePhases)
      : [];
  if (entries.length === 0) {
    return null;
  }

  // 按 roleId 字母序排序，避免 store 内部插入顺序变化导致的视觉跳动。
  // 注意：此处不按 phase 排序，否则角色相位变化时会引起整条条带重排。
  const sortedEntries = [...entries].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div
      className="flex flex-col gap-1"
      data-testid="role-status-strip"
    >
      {/* 角色状态圆点序列 + 阶段标签 */}
      {roles.length > 0 && (
        <div className="flex items-center gap-2">
          <RoleCrewDots roles={roles} size="sm" />
          <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
            {resolveStageLabel(currentStageIndex, locale)}
          </span>
        </div>
      )}

      {/* 原有 badge 列表 — 现在使用 displayLabel 显示本地化标签 */}
      <div className="flex flex-wrap gap-1.5">
        {sortedEntries.map(([roleId, phase]) => (
          <span
            key={roleId}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap ${resolvePhaseClass(phase)}`}
            title={`${roleId} · ${phase}`}
          >
            {displayLabel(roleId, locale)}
          </span>
        ))}
      </div>
    </div>
  );
};

export default RoleStatusStrip;
