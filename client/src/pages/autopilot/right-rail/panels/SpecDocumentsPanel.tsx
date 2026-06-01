/**
 * Autopilot 驾驶舱右栏收敛 — `SpecDocumentsPanel`
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 1（8 个 Sub_Stage_Panel 的规范落点与命名冻结）
 * - 需求 2.3（`SpecDocumentsPanel` 接受 `{ jobId, specTree, locale }` +
 *   面板私有字段 `initialDocuments` / `onDocumentsChange`）
 * - 需求 3（Rendering_Parity，零行为变更）
 * - 需求 5（`BlueprintProgressPanel` 组合化，`/specs` 兼容）
 * - 需求 6.1（`<AutopilotRightRail>` 在 `currentStage === "fabric"` 时消费 Canonical_Panel_Directory）
 * - 需求 7（独立可合入、单面板 PR、回滚安全）
 * - 需求 8（单向依赖与循环 import 守卫）
 * - 需求 9.2（严禁修改 `SpecDocumentWorkbenchPanel.tsx` 的任何代码）
 * - 需求 10（零后端契约变更 + 零 testid drift）
 *
 * 本文件是 `SpecDocumentWorkbenchPanel` 的薄 wrapper：
 * - 不重写 `SpecDocumentWorkbenchPanel` 内部实现（需求 9.2）
 * - 把 `AutopilotRightRailProps` 的窄化 slice 转接到既有外部面板
 * - `specTree === null` 时与 `BlueprintProgressPanel` 当前空态一致（不渲染）
 */

import type { FC } from "react";

import SpecDocumentWorkbenchPanel from "@/pages/specs/SpecDocumentWorkbenchPanel";
import type { AutopilotRightRailProps } from "@/pages/autopilot/right-rail/types";
import type { BlueprintSpecDocument } from "@shared/blueprint/contracts";

/**
 * Spec 1 冻结的 `AutopilotRightRailProps` 字段子集，严格对应 design.md
 * 「面板抽离总表」第 3 行，外加 canonical-panel 私有字段
 * `initialDocuments` / `onDocumentsChange`。
 *
 * 私有字段由 `BlueprintProgressPanel` 组合时注入；`<AutopilotRightRail>` 在
 * fabric stage 调用本面板时留空，`SpecDocumentWorkbenchPanel` 内部对
 * `undefined` 有现成的降级路径（需求 2.9 / 设计文档「extra props 与 callback
 * 的处理规则」）。
 *
 * whybuddy-stage3-unblock-2026-05-29 增补：补充
 * `onEffectPreviewGenerated` 私有字段，用于把"进入效果预演"按钮的
 * 后端响应回写到上层 `latestJob` / `effectPreviews`。当父组件未提供
 * 时，`SpecDocumentWorkbenchPanel` 内部的 fallback 仍然会把预演快照
 * 显示出来（按钮翻成 ✓ 已进入效果预演），不会阻塞用户。
 */
export type SpecDocumentsPanelProps = Pick<
  AutopilotRightRailProps,
  "jobId" | "specTree" | "locale"
> & {
  initialDocuments?: BlueprintSpecDocument[];
  onDocumentsChange?: (documents: BlueprintSpecDocument[]) => void;
  onEffectPreviewGenerated?: (
    response: import("@/lib/blueprint-api").BlueprintEffectPreviewsSnapshotResponse
  ) => void;
};

/**
 * `SpecDocumentsPanel` —— 对应 `AutopilotRailSubStage === "spec_documents"`。
 *
 * `SpecDocumentWorkbenchPanel` 当前不消费 `locale`；这里保留字段仅用于满足
 * `AutopilotRightRailProps` 的 narrowing 契约，不做任何行为变更。
 */
export const SpecDocumentsPanel: FC<SpecDocumentsPanelProps> = ({
  jobId,
  specTree,
  // locale 当前由 SpecDocumentWorkbenchPanel 内部通过 `blueprintCopy` 派生，
  // 本 wrapper 不再二次转发；保留参数名以符合 narrowing 契约。
  locale: _locale,
  initialDocuments,
  onDocumentsChange,
  onEffectPreviewGenerated,
}) => {
  if (!specTree) {
    // 空态与 BlueprintProgressPanel 在 specTree === null 分支一致
    // （`showSpecDocumentWorkbench && specTree ? ... : null`，即不渲染）。
    return null;
  }

  return (
    <SpecDocumentWorkbenchPanel
      specTree={specTree}
      jobId={jobId || undefined}
      initialDocuments={initialDocuments}
      onDocumentsChange={onDocumentsChange}
      onEffectPreviewGenerated={onEffectPreviewGenerated}
    />
  );
};

export default SpecDocumentsPanel;
