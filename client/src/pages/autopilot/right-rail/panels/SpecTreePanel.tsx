/**
 * Autopilot 驾驶舱右栏收敛 — `SpecTreePanel`
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 1（8 个 Sub_Stage_Panel 的规范落点与命名冻结）
 * - 需求 2.2（`SpecTreePanel` 接受 `{ jobId, specTree, selection, locale }` +
 *   面板私有字段 `versions` / `onSpecTreeChange` / `onSpecTreeVersionsChange`）
 * - 需求 3（Rendering_Parity，零行为变更）
 * - 需求 5（`BlueprintProgressPanel` 组合化，`/specs` 兼容）
 * - 需求 6.1（`<AutopilotRightRail>` 在 `currentStage === "fabric"` 时消费 Canonical_Panel_Directory）
 * - 需求 7（独立可合入、单面板 PR、回滚安全）
 * - 需求 8（单向依赖与循环 import 守卫）
 * - 需求 9.1（严禁修改 `SpecTreeWorkbenchPanel.tsx` 的任何代码）
 * - 需求 10（零后端契约变更 + 零 testid drift）
 *
 * 本文件是 `SpecTreeWorkbenchPanel` 的薄 wrapper：
 * - 不重写 `SpecTreeWorkbenchPanel` 内部实现（需求 9.1）
 * - 把 `AutopilotRightRailProps` 的窄化 slice 转接到既有外部面板
 * - `specTree === null` 时与 `BlueprintProgressPanel` 当前空态一致（不渲染）
 */

import type { FC } from "react";

import SpecDocumentWorkbenchPanel from "@/pages/specs/SpecDocumentWorkbenchPanel";
import SpecTreeWorkbenchPanel from "@/pages/specs/SpecTreeWorkbenchPanel";
import type { AutopilotRightRailProps } from "@/pages/autopilot/right-rail/types";
import type { BlueprintEffectPreviewsSnapshotResponse } from "@/lib/blueprint-api";
import type {
  BlueprintSpecDocument,
  BlueprintSpecTree,
  BlueprintSpecTreeVersionSnapshot,
} from "@shared/blueprint/contracts";

/**
 * Spec 1 冻结的 `AutopilotRightRailProps` 字段子集，严格对应 design.md
 * 「面板抽离总表」第 2 行，外加 canonical-panel 私有字段
 * `versions` / `onSpecTreeChange` / `onSpecTreeVersionsChange`。
 *
 * 私有字段由 `BlueprintProgressPanel` 组合时注入；`<AutopilotRightRail>` 在
 * fabric stage 调用本面板时留空，`SpecTreeWorkbenchPanel` 内部对 `undefined`
 * 有现成的降级路径（需求 2.9 / 设计文档「extra props 与 callback 的处理规则」）。
 *
 * whybuddy-stage3-unblock-2026-05-29 增补：`onEffectPreviewGenerated` 透传到
 * 内嵌的 `SpecDocumentWorkbenchPanel`，使其底部新增的"进入效果预演"按钮
 * 可以把后端响应抬到上层 latestJob，让右栏切换到 effect_preview 子阶段。
 */
export type SpecTreePanelProps = Pick<
  AutopilotRightRailProps,
  "jobId" | "specTree" | "selection" | "locale"
> & {
  versions?: BlueprintSpecTreeVersionSnapshot[] | null;
  onSpecTreeChange?: (specTree: BlueprintSpecTree) => void;
  onSpecTreeVersionsChange?: (
    versions: BlueprintSpecTreeVersionSnapshot[]
  ) => void;
  showDocuments?: boolean;
  initialDocuments?: BlueprintSpecDocument[];
  onDocumentsChange?: (documents: BlueprintSpecDocument[]) => void;
  onEffectPreviewGenerated?: (
    response: BlueprintEffectPreviewsSnapshotResponse
  ) => void;
};

/**
 * `SpecTreePanel` —— 对应 `AutopilotRailSubStage === "spec_tree"`。
 *
 * `SpecTreeWorkbenchPanel` 当前不消费 `locale`；这里保留字段仅用于满足
 * `AutopilotRightRailProps` 的 narrowing 契约，不做任何行为变更。
 *
 * 注：「一键推导规格文档」CTA 已拆分到兄弟组件 `SpecTreeAdvanceCTA`，在
 * `render-sub-stage-panel.tsx` 中与本 panel 的 `autopilot-panel-adapter`
 * 外包一起渲染，避免被 adapter CSS 剥掉 chrome（Spec 5 MiroFish 的剥 chrome
 * 规则仅应用于 workbench 本体，不应压扁 CTA 按钮的圆角与背景）。
 */
export const SpecTreePanel: FC<SpecTreePanelProps> = ({
  jobId,
  specTree,
  selection,
  // locale 当前由 SpecTreeWorkbenchPanel 内部通过 `blueprintCopy` 派生，
  // 本 wrapper 不再二次转发；保留参数名以符合 narrowing 契约。
  locale: _locale,
  versions,
  onSpecTreeChange,
  onSpecTreeVersionsChange,
  showDocuments = false,
  initialDocuments,
  onDocumentsChange,
  onEffectPreviewGenerated,
}) => {
  if (!specTree) {
    // 空态与 BlueprintProgressPanel 在 specTree === null 分支一致
    // （`showSpecTreePreview && specTree ? ... : null`，即不渲染）。
    return null;
  }

  return (
    <>
      <SpecTreeWorkbenchPanel
        specTree={specTree}
        selection={selection}
        jobId={jobId || undefined}
        versions={versions ?? undefined}
        documents={initialDocuments}
        onSpecTreeChange={onSpecTreeChange}
        onSpecTreeVersionsChange={onSpecTreeVersionsChange}
      />
      {showDocuments ? (
        <SpecDocumentWorkbenchPanel
          specTree={specTree}
          jobId={jobId || undefined}
          initialDocuments={initialDocuments}
          onDocumentsChange={onDocumentsChange}
          onEffectPreviewGenerated={onEffectPreviewGenerated}
        />
      ) : null}
    </>
  );
};

export default SpecTreePanel;
