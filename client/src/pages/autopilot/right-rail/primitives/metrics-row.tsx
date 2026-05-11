/**
 * `<MetricsRow>` — 大号 mono 数字指标行（Wave 1 / Spec 2 需求 3）
 *
 * 视觉规则（对齐 design.md）：
 * - grid 布局，列数由 `columns` 控制（默认 3；支持 2 / 4）
 * - 每个 metric：
 *   - 大号数字：JetBrains Mono / 32px / font-weight 500 / `#000`
 *   - 小号 label：JetBrains Mono 10px uppercase tracking 0.08em `#999`
 *   - 可选 hint：Noto Sans SC 11px `#666`
 * - metric 之间用垂直分隔线 1px `#EAEAEA`（`divide-x`）
 * - padding: 16px × 20px（`px-5 py-4`）
 * - 根节点使用 `<dl>` 语义标签，每个 metric 用 `<dd>`（value）+ `<dt>`（label）
 *   （按 design.md 指定：value 在前，label 在后，符合 MiroFish 大号数字先行的视觉）
 */

import type { FC, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface Metric {
  label: string;
  value: string | number;
  hint?: ReactNode;
}

export interface MetricsRowProps {
  metrics: Metric[];
  columns?: 2 | 3 | 4;
}

const COLS: Record<2 | 3 | 4, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export const MetricsRow: FC<MetricsRowProps> = ({ metrics, columns = 3 }) => {
  return (
    <dl
      data-testid="autopilot-metrics-row"
      data-columns={columns}
      className={cn("grid divide-x divide-[#EAEAEA]", COLS[columns])}
    >
      {metrics.map((metric, idx) => (
        <div key={idx} className="px-5 py-4">
          <dd className="font-mono text-[32px] font-medium leading-none text-black tabular-nums">
            {metric.value}
          </dd>
          <dt className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[#999]">
            {metric.label}
          </dt>
          {metric.hint !== undefined && metric.hint !== null ? (
            <div
              data-testid="autopilot-metrics-row-hint"
              className="mt-1 text-[11px] leading-[16px] text-[#666]"
            >
              {metric.hint}
            </div>
          ) : null}
        </div>
      ))}
    </dl>
  );
};
