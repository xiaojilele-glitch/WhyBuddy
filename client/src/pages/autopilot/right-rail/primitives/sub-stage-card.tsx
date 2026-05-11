/**
 * `<SubStageCard>` — MiroFish 风格子阶段卡片外壳（Wave 1 / Spec 2 需求 1 + 4 + 4.5）
 *
 * 视觉规则（对齐 design.md）：
 * - 直角（`rounded-none`）
 * - 1px 边框：
 *   - `completed` → `#E5E5E5`
 *   - `active`    → `#FF4500`（`border-2` 加粗）
 *   - `pending`   → `#EAEAEA` + 整卡 50% 透明度
 * - 根节点使用 `<article>` 语义标签
 * - header: 16px × 20px（`px-5 pt-4 pb-3`），body: 20px × 24px（内部由 children 自行布局）
 * - 序号 + 标题：Space Grotesk（继承），标题 17px；序号以 JetBrains Mono 11px 补零展示
 * - apiPath: JetBrains Mono 11px `#999`
 * - summary: Noto Sans SC 13px `#666`，line-height 22px
 *
 * 需求 4.5（Wave 2 契约属性挂接）：
 * - `anchorAttr`：可选 `{ name, value }`，将作为属性 spread 到根节点（例如
 *   `data-sub-stage-placeholder="agent_crew_fabric"`）。
 * - `ariaCurrentStep`：可选布尔，`true` 时将渲染 `aria-current="step"`。
 * - **属性顺序固定**：`anchorAttr` 必须先 spread，`aria-current` 随后直接作为 JSX 属性写出，
 *   以保证最终 HTML 中 `data-sub-stage-placeholder="..."` 出现在 `aria-current="step"` 之前，
 *   满足 `fabric-dispatch.property.test.tsx` 的正则断言。
 *
 * 可访问性：
 * - `<article>` / `<header>` / `<footer>` 语义标签
 * - toggle 按钮 `type="button"`
 * - 状态同时通过 `data-sub-stage-status` 暴露（颜色不是唯一信号）
 */

import type { FC, ReactNode } from "react";

import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { SubStageStatus } from "./index";
import { StatusCapsule } from "./status-capsule";

export interface SubStageCardProps {
  /** 子阶段序号（从 0 开始，渲染时补零为两位） */
  index: number;
  /** 卡片标题，例如「协作角色」 */
  title: string;
  /** 可选的 API path 说明，例如 `POST /api/blueprint/agent-crew` */
  apiPath?: string;
  /** 可选的 1-2 行摘要文字 */
  summary?: string;
  /** 子阶段状态 */
  status: SubStageStatus;
  /** 卡片主体插槽（通常包含 `<MetricsRow>` + 可选展开详情容器） */
  children: ReactNode;
  /** 卡片右上角自定义插槽（默认由 `<StatusCapsule>` 占用） */
  headerRight?: ReactNode;
  /** 展开/折叠回调；传入时卡片底部会显示 toggle 文本按钮 */
  onToggleExpanded?: () => void;
  /** 是否展开；与 `onToggleExpanded` 配合控制按钮文案 */
  expanded?: boolean;
  /** i18n，仅影响默认 `<StatusCapsule>` 与 toggle 按钮文案 */
  locale: AppLocale;
  /**
   * Wave 2 契约属性 1：将指定属性作为单一键值对 spread 到根 `<article>`。
   * 例如：`{ name: "data-sub-stage-placeholder", value: "agent_crew_fabric" }`。
   */
  anchorAttr?: { name: string; value: string };
  /**
   * Wave 2 契约属性 2：当为 true 时在根节点渲染 `aria-current="step"`。
   * 必须在 `anchorAttr` 之后作为 JSX 属性写出，以保证属性在 HTML 中的出现顺序。
   */
  ariaCurrentStep?: boolean;
}

const BORDER: Record<SubStageStatus, string> = {
  completed: "border border-[#E5E5E5]",
  active: "border-2 border-[#FF4500]",
  pending: "border border-[#EAEAEA] opacity-50",
};

function resolveToggleLabel(locale: AppLocale, expanded: boolean): string {
  if (locale === "zh-CN") {
    return expanded ? "收起 ↑" : "展开 ↓";
  }
  return expanded ? "HIDE ↑" : "SHOW ↓";
}

export const SubStageCard: FC<SubStageCardProps> = ({
  index,
  title,
  apiPath,
  summary,
  status,
  children,
  headerRight,
  onToggleExpanded,
  expanded = false,
  locale,
  anchorAttr,
  ariaCurrentStep,
}) => {
  const num = String(index + 1).padStart(2, "0");
  const toggleLabel = resolveToggleLabel(locale, expanded);
  const spreadAttr = anchorAttr ? { [anchorAttr.name]: anchorAttr.value } : {};

  return (
    <article
      data-testid="autopilot-sub-stage-card"
      data-sub-stage-status={status}
      {...spreadAttr}
      aria-current={ariaCurrentStep ? "step" : undefined}
      className={cn("group bg-white", BORDER[status])}
    >
      {/* Header: 序号 + 标题 + 右上角 StatusCapsule（或 headerRight 覆盖） */}
      <header className="flex items-start justify-between gap-3 border-b border-[#EAEAEA] px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="pt-0.5 font-mono text-[12px] font-bold tracking-wider text-[#999]">
            {num}
          </span>
          <h3 className="text-[17px] font-medium leading-6 text-black">
            {title}
          </h3>
        </div>
        {headerRight ?? <StatusCapsule status={status} locale={locale} />}
      </header>

      {/* API path + Summary（两者皆为空时整段省略） */}
      {apiPath || summary ? (
        <div className="border-b border-[#EAEAEA] px-5 py-3">
          {apiPath ? (
            <div className="font-mono text-[11px] text-[#999]">{apiPath}</div>
          ) : null}
          {summary ? (
            <p className="mt-1.5 text-[13px] leading-[22px] text-[#666]">
              {summary}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Body */}
      <div className="py-1">{children}</div>

      {/* Toggle：仅当 onToggleExpanded 传入时显示 */}
      {onToggleExpanded ? (
        <footer className="border-t border-dashed border-[#EAEAEA] px-5 py-2.5 text-right">
          <button
            type="button"
            onClick={onToggleExpanded}
            data-testid="autopilot-sub-stage-card-toggle"
            className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#999] hover:text-black"
          >
            {toggleLabel}
          </button>
        </footer>
      ) : null}
    </article>
  );
};
