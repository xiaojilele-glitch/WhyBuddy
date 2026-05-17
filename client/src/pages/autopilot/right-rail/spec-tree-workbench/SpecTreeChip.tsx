/**
 * autopilot-spec-tree-workbench / Wave 0 Task 3
 *
 * 行右侧 chip 组件 — 只读、SSR 友好。
 *
 * 输入：deriveSpecTreeChip 输出的 SpecTreeChipDescriptor。
 * 输出：一个 inline-flex chip，包含 label + （可选）source tag。
 *
 * 视觉约束：
 * - 颜色由 tone 决定，统一通过 CSS class 切换；不直接写颜色值。
 * - 不依赖 Framer Motion / Three.js；本组件渲染在右栏列表里，每行一个，
 *   性能敏感。
 * - 不订阅 store；所有数据通过 props 传入。
 */

import type { FC } from "react";

import type {
  ChipTone,
  SpecTreeChipDescriptor,
  SpecTreeChipSourceTag,
} from "../derive-spec-tree-chip";

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: "bg-slate-100 text-slate-500 border-slate-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  danger: "bg-red-50 text-red-700 border-red-300",
};

const SOURCE_LABEL: Record<SpecTreeChipSourceTag, string> = {
  llm: "llm",
  fallback: "fallback",
  template: "template",
};

export interface SpecTreeChipProps {
  descriptor: SpecTreeChipDescriptor;
  /** 用于父级测试断言（默认按 descriptor tone 派生）。 */
  testid?: string;
}

export const SpecTreeChip: FC<SpecTreeChipProps> = ({ descriptor, testid }) => {
  const { label, tone, sourceTag, ephemeralProgress } = descriptor;

  const cls = TONE_CLASS[tone];

  return (
    <span
      data-testid={testid ?? "spec-tree-chip"}
      data-tone={tone}
      data-ephemeral={ephemeralProgress ?? "none"}
      data-source={sourceTag ?? "none"}
      className={
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold " +
        cls
      }
    >
      <span>{label}</span>
      {sourceTag !== undefined ? (
        <span className="text-[9px] font-mono text-slate-500">
          · {SOURCE_LABEL[sourceTag]}
        </span>
      ) : null}
    </span>
  );
};

export default SpecTreeChip;
