/**
 * 阶段仪式感标题区组件
 *
 * 固定在 StageViewport 顶部，展示当前阶段的步骤编号（英文）与中文大标题。
 * 使用 sticky 定位，不随内容滚动；浅色背景与内容区形成视觉分层。
 *
 * 2026-05-19：移除内嵌的 StageProgressIndicator (6 圆点 + 进度条)。
 * - 该指示器与 StreamingDocRenderer 头部的"生成中"指示器、以及右栏
 *   StageHeader 的 STEP 编号 + 中文大标题视觉重复。
 * - props 上 `completedStages` / `activeStage` / `stageProgress` /
 *   `isIndeterminate` 仍然保留为可选字段以维持向后兼容（既有测试与
 *   外部调用签名不变），但 header 内部不再渲染指示器。
 *
 * @example
 * ```tsx
 * <StageHeader
 *   stageIndex={0}
 *   englishLabel="INPUT"
 *   chineseTitle="需求输入"
 *   isActive={true}
 * />
 * ```
 *
 * 对应需求: 3.1, 3.2, 3.3, 3.4
 */

import type { FC } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { AppLocale } from "@/lib/locale";
import type { WorkbenchStage } from "./stage-config";

/** StageHeader 组件 Props */
export interface StageHeaderProps {
  /** 阶段索引（0-5），用于生成 "STEP 01" 格式的步骤编号 */
  stageIndex: number;
  /** 英文标识，如 "INPUT" / "CLARIFICATION" */
  englishLabel: string;
  /** 中文大标题，如 "需求输入" / "智能澄清" */
  chineseTitle: string;
  /** 当前阶段是否处于 active 状态；active 时使用高对比度文字 */
  isActive: boolean;
  /** UI locale used for the step eyebrow. */
  locale?: AppLocale;
  /**
   * @deprecated 2026-05-19：StageProgressIndicator 已从 header 移除。
   * 字段保留以避免破坏既有调用方签名，但不再被消费。
   */
  completedStages?: ReadonlySet<WorkbenchStage>;
  /** @deprecated 2026-05-19：见 `completedStages` 注释。 */
  activeStage?: WorkbenchStage;
  /** @deprecated 2026-05-19：见 `completedStages` 注释。 */
  stageProgress?: number;
  /** @deprecated 2026-05-19：见 `completedStages` 注释。 */
  isIndeterminate?: boolean;
  /** Optional callback for returning to the previous workbench step. */
  onNavigatePreviousStage?: () => void;
  /** Accessible label for the previous-step control. */
  previousStageLabel?: string;
  /** Stable test/debug marker for the target previous sub-stage. */
  previousSubStage?: string;
  /** Stable test/debug marker for the target previous workbench stage. */
  previousWorkbenchStage?: string;
  /** Stable test/debug marker for the target previous outer workflow stage. */
  previousWorkflowStage?: string;
  /** Stable test/debug marker for which navigation model the button uses. */
  previousTargetKind?: "sub-stage" | "workbench-stage" | "workflow-stage";
  /** Optional callback for advancing to the next workbench step. */
  onNavigateNextStage?: () => void;
  /** Accessible label for the next-step control. */
  nextStageLabel?: string;
  /** Stable test/debug marker for the target next sub-stage. */
  nextSubStage?: string;
  /** Stable test/debug marker for the target next workbench stage. */
  nextWorkbenchStage?: string;
  /** Stable test/debug marker for which navigation model the next button uses. */
  nextTargetKind?: "stage" | "sub-stage" | "workbench-stage";
}

/**
 * 阶段仪式感标题区。
 *
 * 渲染结构（已简化为两行）：
 * ```
 * <header sticky top-0 bg-slate-50 border-b px-3 py-2>
 *   <p>STEP 01 · INPUT</p>           // font-mono, 低对比度
 *   <h2>需求输入</h2>                 // text-sm font-semibold, 高对比度
 * </header>
 * ```
 */
const StageHeader: FC<StageHeaderProps> = ({
  stageIndex,
  englishLabel,
  chineseTitle,
  isActive,
  locale = "en-US",
  onNavigatePreviousStage,
  previousStageLabel = "Back to previous step",
  previousSubStage,
  previousWorkbenchStage,
  previousWorkflowStage,
  previousTargetKind,
  onNavigateNextStage,
  nextStageLabel = "Continue to next step",
  nextSubStage,
  nextWorkbenchStage,
  nextTargetKind,
}) => {
  // 生成两位数步骤编号：0 -> "01", 5 -> "06"
  const stepNumber = String(stageIndex + 1).padStart(2, "0");
  const canNavigatePrevious = typeof onNavigatePreviousStage === "function";
  const canNavigateNext = typeof onNavigateNextStage === "function";
  const eyebrow =
    locale === "zh-CN"
      ? `步骤 ${stepNumber} · ${chineseTitle}`
      : `STEP ${stepNumber} · ${englishLabel}`;

  return (
    <header
      className="sticky top-0 z-10 bg-white px-3 py-2"
      data-mirofish="stage-header"
    >
      <div className="flex min-w-0 items-start gap-2">
        {canNavigatePrevious ? (
          <button
            type="button"
            onClick={onNavigatePreviousStage}
            aria-label={previousStageLabel}
            title={previousStageLabel}
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-[2px] border border-[#E5E5E5] bg-white text-black/60 transition hover:border-[#FF4500] hover:text-[#FF4500] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4500]/30"
            data-testid="autopilot-stage-back-button"
            data-previous-sub-stage={previousSubStage}
            data-previous-workbench-stage={previousWorkbenchStage}
            data-previous-workflow-stage={previousWorkflowStage}
            data-previous-target-kind={previousTargetKind}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          {/* whybuddy-rebrand-and-stage3-unblock-2026-05-28 §D.3:
              eyebrow uses MiroFish mono token; title uses MiroFish display
              token. Color contrast is the only state-bearing change. */}
          <p
            className={`font-mono text-[11px] font-bold uppercase tracking-[0.18em] ${
              isActive ? "text-[#FF4500]" : "text-black/40"
            }`}
          >
            {eyebrow}
          </p>

          <h2
            className={`mt-1 truncate font-display text-base font-medium tracking-tight ${
              isActive ? "text-black" : "text-black/40"
            }`}
          >
            {chineseTitle}
          </h2>
        </div>

        {canNavigateNext ? (
          <button
            type="button"
            onClick={onNavigateNextStage}
            aria-label={nextStageLabel}
            title={nextStageLabel}
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-[2px] border border-[#E5E5E5] bg-white text-black/60 transition hover:border-[#FF4500] hover:text-[#FF4500] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4500]/30"
            data-testid="autopilot-stage-forward-button"
            data-next-sub-stage={nextSubStage}
            data-next-workbench-stage={nextWorkbenchStage}
            data-next-target-kind={nextTargetKind}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </header>
  );
};

export default StageHeader;
