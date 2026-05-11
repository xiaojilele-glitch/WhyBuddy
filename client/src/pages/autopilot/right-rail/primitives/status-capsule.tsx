/**
 * `<StatusCapsule>` — 子阶段卡片右上角状态胶囊（Wave 1 / Spec 2 需求 2）
 *
 * 视觉规则（对齐 design.md）：
 * - `completed`：深绿背景 `#22c55e` + 白字「构建完成 / DONE」+ 无动画
 * - `active`：   橙色背景 `#FF4500` + 白字「执行中 / RUNNING」+ 圆点 pulse 动画
 * - `pending`：  灰底 `#F5F5F5` + `#999` 字「等待 / PENDING」+ 无动画
 * - 直角（`rounded-none`），padding 4px × 10px，字号 11px，font-mono，uppercase，
 *   tracking 0.05em
 *
 * 可访问性：颜色不是唯一信号，`data-status` 同时暴露机器可读状态。
 */

import type { FC } from "react";

import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { SubStageStatus } from "./index";

export interface StatusCapsuleProps {
  status: SubStageStatus;
  locale: AppLocale;
}

const LABELS: Record<SubStageStatus, Record<AppLocale, string>> = {
  completed: { "zh-CN": "构建完成", "en-US": "DONE" },
  active: { "zh-CN": "执行中", "en-US": "RUNNING" },
  pending: { "zh-CN": "等待", "en-US": "PENDING" },
};

const STYLES: Record<SubStageStatus, string> = {
  completed: "bg-[#22c55e] text-white",
  active: "bg-[#FF4500] text-white",
  pending: "bg-[#F5F5F5] text-[#999]",
};

export const StatusCapsule: FC<StatusCapsuleProps> = ({ status, locale }) => {
  return (
    <span
      data-testid="autopilot-status-capsule"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1 rounded-none px-2.5 py-1",
        "font-mono text-[11px] font-bold uppercase tracking-[0.05em]",
        STYLES[status],
      )}
    >
      {LABELS[status][locale]}
      {status === "active" ? (
        <span
          aria-hidden="true"
          className="size-1.5 animate-pulse rounded-full bg-white"
        />
      ) : null}
    </span>
  );
};
