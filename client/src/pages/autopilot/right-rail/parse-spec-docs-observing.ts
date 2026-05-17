/**
 * autopilot-spec-tree-workbench / Wave 0 Task 2
 *
 * 纯函数：把 `useBlueprintRealtimeStore.agentReasoning.entries` 中
 * stageId === "spec_docs" 的 observing 条目解析成 `<nodeTitle, "generating"
 * | "fallback">` 的快照，给 SpecTreeWorkbench 在稳定 docs 还没回来的窗口
 * 内做 ephemeral 状态展示。
 *
 * 设计目标：
 * - 与 React 完全解耦，便于 vitest 单测。
 * - 容忍服务端 emitter 在 `server/routes/blueprint/spec-docs-llm-generation.ts`
 *   里发出的精确文案模板：
 *     - 成功：`✓ ${node.title} — 规格文档已生成`
 *     - 降级：`⚠ ${node.title} — 降级为模板`
 *   这两个文案使用 em dash (U+2014) 作为分隔符，不是 hyphen。
 * - title 含 em dash / emoji / 引号 / 反斜杠 / 中文标点都应该正确提取。
 * - 无法识别的文案静默跳过，不抛错；不污染 byNodeTitle。
 */

import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";

export type SpecTreeEphemeralProgressKind = "generating" | "fallback";

export interface SpecDocsObservingSnapshot {
  /**
   * 节点标题 → 最近一次 observing 状态的快照。
   * 同名节点多次 observing 时，后到的事件覆盖前到的（最新状态优先）。
   */
  byNodeTitle: Map<string, SpecTreeEphemeralProgressKind>;
}

/**
 * 服务端 emitter 在 spec-docs-llm-generation.ts 中使用的精确文案前缀。
 * 解析时严格匹配：
 *   `✓ <title> — 规格文档已生成` → generating
 *   `⚠ <title> — 降级为模板`     → fallback
 *
 * 切片规则：
 * - 起始字符（`✓` / `⚠`）+ 一个空格 + title + ` — ` + 后缀
 * - title 部分允许任何非控制字符（含 em dash / emoji / 引号），因此用
 *   "找到最后一个 ` — ` 作为分隔点" 的策略反向解析，避免 title 自身
 *   含 em dash 时被误切。
 */
const EM_DASH_DELIMITER = " — ";
const SUCCESS_PREFIX = "✓ ";
const FAILURE_PREFIX = "⚠ ";
const SUCCESS_SUFFIX = " — 规格文档已生成";
const FAILURE_SUFFIX = " — 降级为模板";

/**
 * 从单条 summary 字符串中提取 nodeTitle + kind。
 * 解析失败返回 null。
 */
function parseSummary(
  summary: string
): { title: string; kind: SpecTreeEphemeralProgressKind } | null {
  if (typeof summary !== "string" || summary.length === 0) return null;

  // 成功路径：以 "✓ " 起，以 " — 规格文档已生成" 结
  if (summary.startsWith(SUCCESS_PREFIX) && summary.endsWith(SUCCESS_SUFFIX)) {
    const title = summary
      .slice(SUCCESS_PREFIX.length, summary.length - SUCCESS_SUFFIX.length)
      .trim();
    if (title.length === 0) return null;
    return { title, kind: "generating" };
  }

  // 降级路径：以 "⚠ " 起，以 " — 降级为模板" 结
  if (summary.startsWith(FAILURE_PREFIX) && summary.endsWith(FAILURE_SUFFIX)) {
    const title = summary
      .slice(FAILURE_PREFIX.length, summary.length - FAILURE_SUFFIX.length)
      .trim();
    if (title.length === 0) return null;
    return { title, kind: "fallback" };
  }

  return null;
}

/**
 * 解析 entries → snapshot.byNodeTitle。
 *
 * 只处理：
 * - `entry.stageId === "spec_docs"`
 * - `entry.phase === "observing"`
 * - `entry.observationSummary` 非空字符串
 *
 * 其它 entries 静默跳过；解析失败的 summary 也静默跳过。
 */
export function parseSpecDocsObservingEntries(
  entries: ReadonlyArray<AgentReasoningEntry>
): SpecDocsObservingSnapshot {
  const byNodeTitle = new Map<string, SpecTreeEphemeralProgressKind>();

  if (!Array.isArray(entries)) {
    return { byNodeTitle };
  }

  for (const entry of entries) {
    if (entry.stageId !== "spec_docs") continue;
    if (entry.phase !== "observing") continue;
    const summary = entry.observationSummary;
    if (typeof summary !== "string" || summary.length === 0) continue;

    const parsed = parseSummary(summary);
    if (parsed === null) continue;

    // 后到的事件覆盖前到的（最新状态优先）
    byNodeTitle.set(parsed.title, parsed.kind);
  }

  return { byNodeTitle };
}

/**
 * 仅供测试导入；正常代码路径不应直接调 parseSummary。
 */
export const __testing__ = {
  parseSummary,
};

// 抑制 unused-import 警告：EM_DASH_DELIMITER 保留作为文档常量以便未来
// 切换到通用反向切片策略时复用。
void EM_DASH_DELIMITER;
