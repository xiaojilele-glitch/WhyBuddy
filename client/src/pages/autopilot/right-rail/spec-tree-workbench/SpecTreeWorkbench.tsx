/**
 * autopilot-spec-tree-workbench / Wave 0 Task 4
 *
 * 树中心工作台主组件。把 fabric 阶段的 spec_tree + spec_documents 两个
 * sub-stage 合并成单一卡片：
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │ 顶部双 CTA：                                         │
 *   │  [深色] 生成整棵树文档    [描边] 生成当前节点文档    │
 *   ├─────────────────────────────────────────────────────┤
 *   │ #1 root.title  · domain        ▶  3/3 accepted · llm│
 *   │ #2 child-1     · scenario      ▶  2/3 reviewing · llm│
 *   │ #3 child-2     · interface     ▼  生成中             │
 *   │   └ requirements [reviewing · llm] 摘要…              │
 *   │   └ design       [draft · llm]    摘要…              │
 *   │   └ tasks        [尚未生成]                           │
 *   │ #4 leaf-3      · contract      ▶  未生成              │
 *   └─────────────────────────────────────────────────────┘
 *
 * 设计目标：
 * - 顶部双 CTA：默认主操作是"生成整棵树文档"（无须用户先选节点）；
 *   选中节点后次按钮"生成当前节点文档"启用。
 * - 节点行展开式预览：accordion 风格，点击同一行第二次收起。
 * - chip 与展开态都来自 deriveSpecTreeChip，保证稳定 docs 与 ephemeral
 *   流共用同一份折算逻辑。
 * - 实时 observing 通过 useBlueprintRealtimeStore.agentReasoning.entries
 *   读取并 parse 成 byNodeTitle 快照；稳定 docs 已存在的节点忽略 ephemeral。
 *
 * 不做的事：
 * - 不发 socket / 不写 store；调用 API 仅通过 props.onGenerate*
 *   回调让父级承担副作用。
 * - 不渲染外层 timeline / sub-stage 占位（由 AutopilotRightRail 负责）。
 */

import { useCallback, useMemo, useState, type FC } from "react";

import type { AppLocale } from "@/lib/locale";
import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import {
  deriveSpecDocumentTreeStats,
  type SpecDocumentTreeStats,
} from "@/lib/blueprint-spec-document-stats";

import type {
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";

import { deriveSpecTreeChip } from "../derive-spec-tree-chip";
import { parseSpecDocsObservingEntries } from "../parse-spec-docs-observing";

import { SpecTreeChip } from "./SpecTreeChip";
import { SpecDocPreviewBlock } from "./SpecDocPreviewBlock";

const DOC_TYPE_ORDER: readonly BlueprintSpecDocumentType[] = [
  "requirements",
  "design",
  "tasks",
];

export type SpecTreeWorkbenchGenerateScope = "all" | "single";

export interface SpecTreeWorkbenchProps {
  jobId: string;
  job: BlueprintGenerationJob | null;
  specTree: BlueprintSpecTree | null;
  /**
   * 可选稳定 docs 来源。当传入时优先使用；不传时由组件内部通过
   * `deriveSpecDocumentTreeStats(job, specTree)` 从 job.artifacts 派生
   * （与既有 minimal-invasive 实现 / SpecDocumentWorkbenchPanel 共用同一份
   * 数据底座，避免维护两份 grouping 逻辑）。
   */
  specDocuments?: ReadonlyArray<BlueprintSpecDocument>;
  locale: AppLocale;
  /**
   * CTA 进行中状态。父级控制 in-flight 锁，本组件只负责展示与触发回调。
   * `null` = 无进行中请求；`"all"` = 整树批量；`"single"` = 单节点。
   */
  generating: SpecTreeWorkbenchGenerateScope | null;
  /** 主 CTA：生成整棵树。父级负责调用 generateBlueprintSpecDocuments(jobId, {})。 */
  onGenerateAll: () => void;
  /** 次 CTA：生成单节点。父级负责调用 generateBlueprintSpecDocuments(jobId, { nodeId })。 */
  onGenerateNode: (nodeId: string) => void;
}

// ─── i18n 文案 ────────────────────────────────────────────────────────────

const COPY = {
  ctaAll: { "zh-CN": "生成整棵树文档", "en-US": "Generate all docs" },
  ctaSingle: {
    "zh-CN": "生成当前节点文档",
    "en-US": "Generate current node",
  },
  emptyTree: {
    "zh-CN": "SPEC 树尚未就绪",
    "en-US": "SPEC tree not ready",
  },
  generating: {
    "zh-CN": "生成中…",
    "en-US": "Generating…",
  },
  hintSelectFirst: {
    "zh-CN": "选中一个节点以单独生成",
    "en-US": "Select a node to generate it individually",
  },
} as const;

function t(locale: AppLocale, key: keyof typeof COPY): string {
  const lang = locale === "zh-CN" ? "zh-CN" : "en-US";
  return COPY[key][lang];
}

// ─── helpers ──────────────────────────────────────────────────────────────

function groupDocumentsByNode(
  documents: ReadonlyArray<BlueprintSpecDocument>
): Map<string, BlueprintSpecDocument[]> {
  const out = new Map<string, BlueprintSpecDocument[]>();
  for (const doc of documents) {
    const list = out.get(doc.nodeId);
    if (list) list.push(doc);
    else out.set(doc.nodeId, [doc]);
  }
  return out;
}

/**
 * 把 SpecDocumentTreeStats.byNodeId 的 documents 重新组织成 nodeId →
 * documents map，让 SpecTreeWorkbench 内部可以与 specDocuments prop 走同
 * 一条派生路径。
 */
function statsToDocsMap(
  stats: SpecDocumentTreeStats
): Map<string, BlueprintSpecDocument[]> {
  const out = new Map<string, BlueprintSpecDocument[]>();
  for (const [nodeId, nodeStats] of stats.byNodeId.entries()) {
    out.set(nodeId, [...nodeStats.documents]);
  }
  return out;
}

function pickDocByType(
  docs: ReadonlyArray<BlueprintSpecDocument> | undefined,
  type: BlueprintSpecDocumentType
): BlueprintSpecDocument | undefined {
  if (!docs) return undefined;
  // 按 createdAt 升序时,后者覆盖前者；这里选最后一份（即最新）。
  let last: BlueprintSpecDocument | undefined;
  for (const doc of docs) {
    if (doc.type === type) last = doc;
  }
  return last;
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

export const SpecTreeWorkbench: FC<SpecTreeWorkbenchProps> = ({
  jobId: _jobId,
  job,
  specTree,
  specDocuments,
  locale,
  generating,
  onGenerateAll,
  onGenerateNode,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  // 实时 observing 流 → byNodeTitle map
  const reasoningEntries = useBlueprintRealtimeStore(
    s => s.agentReasoning.entries
  );
  const observingSnapshot = useMemo(
    () => parseSpecDocsObservingEntries(reasoningEntries),
    [reasoningEntries]
  );

  // 稳定 docs 按 nodeId 分组：
  // 优先使用 props.specDocuments（如果父级显式传入），否则走
  // deriveSpecDocumentTreeStats(job, specTree) 与既有 AutopilotRightRail
  // 共用同一份派生路径，避免维护两份 grouping。
  const docsByNodeId = useMemo(() => {
    if (specDocuments !== undefined) {
      return groupDocumentsByNode(specDocuments);
    }
    if (job === null || specTree === null) {
      return new Map<string, BlueprintSpecDocument[]>();
    }
    return statsToDocsMap(deriveSpecDocumentTreeStats(job, specTree));
  }, [specDocuments, job, specTree]);

  // 节点行点击 → toggle 展开 + 选中
  const onNodeRowClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setExpandedNodeIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const ctaAllLabel = t(locale, "ctaAll");
  const ctaSingleLabel = t(locale, "ctaSingle");
  const generatingLabel = t(locale, "generating");

  const generatingAll = generating === "all";
  const generatingSingle = generating === "single";
  const anyGenerating = generating !== null;

  if (!specTree || specTree.nodes.length === 0) {
    return (
      <div
        data-testid="spec-tree-workbench"
        data-state="empty"
        className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-3 text-xs font-semibold text-slate-500"
      >
        {t(locale, "emptyTree")}
      </div>
    );
  }

  return (
    <div
      data-testid="spec-tree-workbench"
      data-state="ready"
      data-generating={generating ?? "none"}
      className="space-y-3"
    >
      {/* 顶部双 CTA */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="spec-tree-workbench-cta-all"
          disabled={anyGenerating}
          onClick={onGenerateAll}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-700 disabled:bg-slate-400"
        >
          {generatingAll ? generatingLabel : ctaAllLabel}
        </button>
        <button
          type="button"
          data-testid="spec-tree-workbench-cta-single"
          disabled={anyGenerating || selectedNodeId === null}
          onClick={() => {
            if (selectedNodeId !== null) onGenerateNode(selectedNodeId);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        >
          {generatingSingle ? generatingLabel : ctaSingleLabel}
        </button>
        {selectedNodeId === null ? (
          <span className="text-[10px] text-slate-400">
            {t(locale, "hintSelectFirst")}
          </span>
        ) : null}
      </div>

      {/* 节点行列表 */}
      <ul
        data-testid="spec-tree-workbench-list"
        className="space-y-1 rounded-lg border border-slate-100 bg-white p-1.5"
      >
        {specTree.nodes.map(node => (
          <SpecTreeNodeRow
            key={node.id}
            node={node}
            isSelected={selectedNodeId === node.id}
            isExpanded={expandedNodeIds.has(node.id)}
            docs={docsByNodeId.get(node.id) ?? []}
            ephemeral={observingSnapshot.byNodeTitle.get(node.title)}
            onClick={onNodeRowClick}
          />
        ))}
      </ul>
    </div>
  );
};

// ─── 节点行子组件 ─────────────────────────────────────────────────────────

interface SpecTreeNodeRowProps {
  node: BlueprintSpecTreeNode;
  isSelected: boolean;
  isExpanded: boolean;
  docs: ReadonlyArray<BlueprintSpecDocument>;
  ephemeral: "generating" | "fallback" | undefined;
  onClick: (nodeId: string) => void;
}

const SpecTreeNodeRow: FC<SpecTreeNodeRowProps> = ({
  node,
  isSelected,
  isExpanded,
  docs,
  ephemeral,
  onClick,
}) => {
  const chipDescriptor = useMemo(
    () => deriveSpecTreeChip(docs, ephemeral),
    [docs, ephemeral]
  );

  return (
    <li
      data-testid="spec-tree-workbench-row"
      data-node-id={node.id}
      data-selected={isSelected ? "true" : "false"}
      data-expanded={isExpanded ? "true" : "false"}
      className={
        "rounded-md transition " +
        (isSelected ? "bg-slate-50" : "hover:bg-slate-50/60")
      }
    >
      <button
        type="button"
        onClick={() => onClick(node.id)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="text-[10px] font-mono text-slate-400">
          {isExpanded ? "▼" : "▶"}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800">
          {node.title}
        </span>
        <span className="shrink-0 text-[9px] font-mono text-slate-400">
          · {String(node.type).replace(/_/g, " ")}
        </span>
        <SpecTreeChip descriptor={chipDescriptor} />
      </button>

      {isExpanded ? (
        <div
          data-testid="spec-tree-workbench-row-expanded"
          className="space-y-1.5 px-2 pb-2"
        >
          {DOC_TYPE_ORDER.map(type => (
            <SpecDocPreviewBlock
              key={type}
              type={type}
              document={pickDocByType(docs, type)}
            />
          ))}
        </div>
      ) : null}
    </li>
  );
};

export default SpecTreeWorkbench;
