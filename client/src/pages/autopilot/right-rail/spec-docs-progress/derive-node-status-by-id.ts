/**
 * whybuddy-spec-tree-progress-merge-2026-05-29 §6 — 双源 nodeStatusById 派生。
 *
 * SPEC 树节点行的状态来自两个真相源：
 *
 * 1. **持久化**：job.artifacts 里已经落盘的 spec documents（requirements /
 *    design / tasks）。它跟着 job 走、跨刷新存在。任何节点存在至少一份持久化
 *    文档 → 基线判定为 `completed`。这是「刷新后 ✓ 不丢」的根。
 * 2. **活跃态**：浏览器内存里的 `specDocsProgress.nodes`（socket 驱动）。
 *    它表达 in-flight 进度（pending / processing / completed / failed /
 *    assembled），由 `batchStatus` 守门覆盖持久化基线。
 *
 * `assembled` 在 SPEC 树视图里等价于 `completed`（spec_docs 二阶段提交完成
 * 即文档已落盘可读）。
 *
 * ## live overlay 的 batchStatus 守门规则（防 stale processing 漏出）
 *
 * 一轮批量在事件丢失 / 刷新 / 超时后会把节点的 `processing` 状态留在内存里。
 * 单节点请求路径（`isBatchRequest === false`）不会发新进度事件清掉它，于是
 * 老的 `processing` 会不当地覆盖持久化 baseline 的 `completed`，呈现「点子
 * 节点生成、父节点在转」这种错觉。守门规则：
 *
 * | `batchStatus` | live overlay 行为 |
 * | --- | --- |
 * | `running` / `assembling` | 全部 4 态都覆盖 baseline（用户看到真实 in-flight） |
 * | `idle` / `finished` | 只让终态（`completed` / `failed` / `assembled→completed`）覆盖 baseline；非终态 `pending` / `processing` 视为残留，忽略 |
 *
 * 终态保留覆盖是因为 failed 节点没有持久化文档兜底，丢掉它就会被错认成
 * pending；completed/assembled 重叠 baseline 时两边一致，无冲突。
 *
 * 函数为纯派生，无副作用，便于单元测试与 SSR 复用。容器层（RightRail / 调试
 * fixture）只负责把对应数据源拿过来调一次即可。
 */

import type {
  SpecDocsNodeEntry,
  SpecDocsProgressState,
} from "@/lib/blueprint-realtime-store";
import type { BlueprintSpecDocument } from "@shared/blueprint/contracts";

export type SpecTreeNodeDisplayStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface SpecTreeNodeStatusEntry {
  status: SpecTreeNodeDisplayStatus;
  wasRetried?: boolean;
  errorSummary?: string;
}

/**
 * 把持久化 specDocuments + 活跃态 specDocsProgress 合并成节点行的最终状态
 * 映射 `Record<nodeId, SpecTreeNodeStatusEntry>`。优先级：live progress（受
 * `batchStatus` 守门）> persisted artifacts > pending（兜底由 view 层呈现）。
 */
export function deriveNodeStatusById(input: {
  /** 已落盘的 spec documents（job.artifacts 投影），用于计算持久化基线。 */
  persistedSpecDocuments: readonly BlueprintSpecDocument[] | undefined;
  /** 浏览器内存里 `useBlueprintRealtimeStore().specDocsProgress.nodes`。 */
  liveProgressNodes: Readonly<Record<string, SpecDocsNodeEntry>>;
  /**
   * 浏览器内存里 `useBlueprintRealtimeStore().specDocsProgress.batchStatus`。
   * 决定 live overlay 是否当前权威：`running` / `assembling` 时全状态覆盖；
   * 其它（`idle` / `finished`）只允许终态覆盖、过滤 stale `pending` /
   * `processing`，避免上一轮批量没收尾时漏出来。
   */
  liveBatchStatus: SpecDocsProgressState["batchStatus"];
}): Record<string, SpecTreeNodeStatusEntry> {
  const out: Record<string, SpecTreeNodeStatusEntry> = {};

  // 1. baseline from persisted artifacts.
  if (input.persistedSpecDocuments) {
    for (const doc of input.persistedSpecDocuments) {
      if (!out[doc.nodeId]) {
        out[doc.nodeId] = { status: "completed" };
      }
    }
  }

  // 2. overlay live progress under batchStatus gate.
  const isBatchActive =
    input.liveBatchStatus === "running" ||
    input.liveBatchStatus === "assembling";
  for (const [id, node] of Object.entries(input.liveProgressNodes)) {
    const collapsed: SpecTreeNodeDisplayStatus =
      node.status === "assembled" ? "completed" : node.status;
    const isTerminal = collapsed === "completed" || collapsed === "failed";

    // Stale guard: when a batch is not currently in flight, only let terminal
    // states overlay the baseline. Non-terminal `pending` / `processing`
    // entries are leftovers from a prior batch that never finished cleanly
    // (e.g. dropped batch_finished, page refresh mid-run, unrelated node from
    // a previous batch_init still cached). Treating them as authoritative
    // would make sibling/parent rows spin while the user is interacting with
    // a different (single-node) generation request.
    if (!isBatchActive && !isTerminal) {
      continue;
    }

    out[id] = {
      status: collapsed,
      ...(node.wasRetried ? { wasRetried: true } : {}),
      ...(node.errorSummary ? { errorSummary: node.errorSummary } : {}),
    };
  }

  return out;
}
