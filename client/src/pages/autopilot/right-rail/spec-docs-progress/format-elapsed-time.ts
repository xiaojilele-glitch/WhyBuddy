/**
 * whybuddy-spec-tree-progress-merge-2026-05-29：从已删除的
 * `SpecDocsProgressPanel.tsx` 抽出的纯工具函数。原浮层组件随进度合并到
 * SPEC 树节点行而删除，但 `formatElapsedTime` 是无依赖的纯函数，被
 * `format-elapsed-time.property.test.ts`（25-case PBT）守护，迁出到此独立
 * 文件继续保留，供未来批次摘要 / 控制台耗时展示复用。
 *
 * Validates: spec-docs-generation-progress-feedback Requirements 3.5
 */

/**
 * Format elapsed milliseconds into MM:SS or HH:MM:SS string.
 *
 * - When total time is under 60 minutes: returns `M:SS` or `MM:SS`
 * - When total time is 60 minutes or more: returns `H:MM:SS` or `HH:MM:SS`
 * - Minutes and seconds are always zero-padded to 2 digits.
 */
export function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}
