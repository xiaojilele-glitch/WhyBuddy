/**
 * `autopilot-spec-documents-workbench-v2` Phase 1 / Task 3 — 左侧 Spec 树。
 *
 * 任务范围：
 * - 顶部渲染搜索框 `data-testid="autopilot-workbench-spec-tree-search"`，
 *   复用现有大小写无关 `includes` 过滤；过滤维度覆盖 `node.title` 与每个节点
 *   下文档的 `title / type`。
 * - 基于 `BlueprintSpecTree.nodes` 的 `parentId / children` 字段渲染层级
 *   结构，不在前端重新计算父子关系；本组件只把入参 `nodes` 通过纯函数
 *   折成 `Map<parentId | ROOT_KEY, BlueprintSpecTreeNode[]>` 与
 *   `Map<nodeId, BlueprintSpecTreeNode>` 供递归渲染使用。
 * - 折叠 / 展开切换控件 `data-testid="autopilot-workbench-spec-tree-toggle-{nodeId}"`，
 *   仅切换该节点 `expandedNodeIds`，不影响其他分支；搜索非空时所有命中
 *   节点视为展开（与现有 `StreamingDocRenderer` 历史 effectiveExpandedIds
 *   行为一致）；首次渲染时 expansion 为空、搜索为空且存在至少一个根节点
 *   时，默认展开第一个根，保证首屏可见性。
 * - 节点类型 chip 通过既有 `deriveSpecTreeChip(docs, ephemeral)` 派生，并
 *   使用 `<SpecTreeChip />` 渲染样式（R3.5）；不在本组件内重新硬编码
 *   节点类型映射或 chip 颜色。
 * - 节点行点击通过 `onSelectDocument(docId)` 触发 active 切换：节点存在
 *   `requirements / design / tasks` 三类文档时按 TYPE_ORDER 取第一个，
 *   否则把 `node.id` 作为占位 docId 透传给容器（容器决定未知 id 行为）。
 * - 选中态以 `data-active="true"` 高亮；并在选中节点下挂载内联生成按钮
 *   `data-testid="autopilot-workbench-spec-tree-generate-{nodeId}"`，点击调用
 *   `props.onGenerateNode(nodeId)`，`generating !== null` 时禁用。
 * - 节点展开时，按 TYPE_ORDER 渲染该节点下所有文档行
 *   `data-testid="autopilot-workbench-spec-tree-doc-{docId}"`，文档行
 *   `data-active="true"` 与 `activeDocId` 完全一致；点击调用同一
 *   `onSelectDocument(doc.id)`。
 * - `specTree === null || specTree === undefined || specTree.nodes.length === 0`
 *   时仅渲染搜索框（visually disabled，带 placeholder）+ 一段
 *   `data-testid="autopilot-workbench-spec-tree-empty"` 占位文案；不渲染任何
 *   `<ul>` / `<ol>` 列表容器或 `*-list` testid。
 *
 * 组件结构：
 * - `WorkbenchSpecTree`（默认导出）：有状态包装，持有 `query` 与
 *   `expandedNodeIds`，把派生结果与受控 props 透传给 `WorkbenchSpecTreeView`。
 * - `WorkbenchSpecTreeView`（同模块导出，便于测试直接调用）：完全 *无 hooks*
 *   的纯展示组件，可在不进入 React 渲染上下文的情况下被测试直接调用，配合
 *   `findElementByTestId` 树遍历做 `onClick` 委派断言（沿用本仓 Task 2
 *   `WorkbenchStatusBar.actions.test.tsx` 中的同款模式）。
 *
 * 兼容约束：
 * - 不修改 `useBlueprintRealtimeStore` schema、`BlueprintSpecTree /
 *   BlueprintSpecDocument` 字段，也不修改 `deriveSpecTreeChip /
 *   parseSpecDocsObservingEntries / handleGenerateNodeSpecDocs` 签名。
 * - 不引入新的 npm 运行时依赖；`<SpecTreeChip />` 即来自既有
 *   `right-rail/spec-tree-workbench/SpecTreeChip.tsx`。
 * - `data-testid` / promptId / API 字段名一律使用英文（R6.4）；模块描述与
 *   关键 props 使用中文 JSDoc（R6.3）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FC, JSX } from "react";

import type { AppLocale } from "@/lib/locale";
import { StaleBadge } from "@/pages/autopilot/stage-edit";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationArtifact,
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";

import { deriveSpecTreeChip } from "../../derive-spec-tree-chip";
import {
  parseSpecDocsObservingEntries,
  type SpecDocsObservingSnapshot,
} from "../../parse-spec-docs-observing";
import { SpecTreeChip } from "../../spec-tree-workbench/SpecTreeChip";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * 文档展示顺序：requirements → design → tasks，与既有
 * `streaming-doc/StreamingDocRenderer` 中 `groupDocumentsByNode` 排序一致。
 */
const TYPE_ORDER: Record<BlueprintSpecDocumentType, number> = {
  requirements: 0,
  design: 1,
  tasks: 2,
};

/** 根节点 parentId 在 `ChildrenByParent` 中使用的固定键。 */
const ROOT_KEY = "__root__";

export type WorkbenchSpecTreeStaleState = {
  staleSince?: string | null;
  invalidatedBy?: BlueprintGenerationArtifact["invalidatedBy"] | null;
};

/**
 * whybuddy-spec-tree-progress-merge-2026-05-29 §3/§6：
 * 每个 SPEC 树节点的生成进度快照，由 `AutopilotRightRail` 从
 * `useBlueprintRealtimeStore().specDocsProgress.nodes` 派生成 plain record
 * 后逐层透传进来。本组件只读，不订阅 store（保持 SSR 可测的无 hooks 契约）。
 */
export type WorkbenchSpecTreeNodeStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface WorkbenchSpecTreeNodeStatusEntry {
  status: WorkbenchSpecTreeNodeStatus;
  /** A2 白盒：该节点曾 failed→processing 重试过（即使最终 completed 也保留）。 */
  wasRetried?: boolean;
  /** 首次失败原因，用于重试角标的 hover tooltip。 */
  errorSummary?: string;
}

export type WorkbenchSpecTreeNodeStatusMap = Readonly<
  Record<string, WorkbenchSpecTreeNodeStatusEntry>
>;

/**
 * whybuddy-spec-tree-progress-merge-2026-05-29 §2：单节点状态图标（24×24）。
 *
 * 5 态：
 * - pending           空心圆，stroke #999
 * - processing        3/4 圆弧 + 旋转，stroke #FF8A1A
 * - completed         实心绿圆 + 白 ✓，fill #16A34A
 * - failed            实心红圆 + 白 ✗，fill #DC2626
 * - completed+retried 绿 ✓ 基础上叠加右上角 8px 橙色 ⚠ 角标（A2 白盒）
 *
 * 纯展示，零 hooks；testid `autopilot-workbench-spec-tree-status-{nodeId}`，
 * 带 `data-status` / `data-retried`，供 SSR 测试与 Playwright 断言。
 */
const SpecTreeStatusIcon: FC<{
  nodeId: string;
  entry: WorkbenchSpecTreeNodeStatusEntry | undefined;
}> = ({ nodeId, entry }) => {
  const status = entry?.status ?? "pending";
  const retried = entry?.wasRetried === true;

  let circle: JSX.Element;
  switch (status) {
    case "processing":
      circle = (
        <svg
          viewBox="0 0 24 24"
          className="size-[18px] animate-spin"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 3a9 9 0 1 0 9 9"
            stroke="#FF8A1A"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      );
      break;
    case "completed":
      circle = (
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#16A34A" />
          <path
            d="M7.5 12.4l3 3 6-6.4"
            stroke="#FFFFFF"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      );
      break;
    case "failed":
      circle = (
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#DC2626" />
          <path
            d="M8.5 8.5l7 7M15.5 8.5l-7 7"
            stroke="#FFFFFF"
            strokeWidth="2.2"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
      break;
    case "pending":
    default:
      circle = (
        <svg
          viewBox="0 0 24 24"
          className="size-[18px]"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="#999999" strokeWidth="2" />
        </svg>
      );
      break;
  }

  const showRetryBadge = status === "completed" && retried;

  return (
    <span
      data-testid={`autopilot-workbench-spec-tree-status-${nodeId}`}
      data-status={status}
      data-retried={retried ? "true" : undefined}
      title={showRetryBadge ? entry?.errorSummary || "重试后成功" : undefined}
      className="relative flex size-5 shrink-0 items-center justify-center"
    >
      {circle}
      {showRetryBadge ? (
        <span
          data-testid={`autopilot-workbench-spec-tree-retry-badge-${nodeId}`}
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex size-[9px] items-center justify-center rounded-full bg-[#FF8A1A] text-[6px] font-black leading-none text-white"
        >
          !
        </span>
      ) : null}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WorkbenchSpecTreeProps {
  /** SPEC 树；为 null / undefined / nodes.length === 0 时进入空态分支。 */
  specTree: BlueprintSpecTree | null | undefined;
  /** 当前蓝图已生成的 SpecDocument 集合，用于 chip 派生与节点行展开。 */
  specDocuments: readonly BlueprintSpecDocument[] | undefined;
  /**
   * 推理事件流；本组件用它派生 observing snapshot 与 ephemeral 状态。
   * 推理事件来自 `useBlueprintRealtimeStore.agentReasoning.entries`，由容器
   * 透传，不在本组件内部订阅 store。
   */
  reasoningEntries: readonly AgentReasoningEntry[];
  specTreeStale?: WorkbenchSpecTreeStaleState | null;
  staleDocumentsById?: ReadonlyMap<string, WorkbenchSpecTreeStaleState>;
  /** 容器层管理的 active document id，决定行 `data-active` 与文档行高亮。 */
  activeDocId: string | null;
  /** 容器层管理的 active node id；无文档的 spec_tree 阶段也能稳定选中节点。 */
  activeNodeId?: string | null;
  /** 选中文档（节点行点击或文档行点击都通过此回调）。 */
  onSelectDocument: (docId: string) => void;
  /** 单节点生成 spec 文档（沿用 `handleGenerateNodeSpecDocs`，签名不变）。 */
  onGenerateNode?: (nodeId: string) => void;
  /** 生成中状态，与 `AutopilotRightRail.specDocsGenerating` 一致。 */
  generating: "all" | "single" | null;
  /**
 * whybuddy-spec-tree-progress-merge-2026-05-29：每节点生成进度快照
   * （nodeId → { status, wasRetried, errorSummary }）。缺省 / 缺某节点时
   * 该行回退为 pending。合并了原 SpecDocsProgressPanel 浮层的职责。
   */
  nodeStatusById?: WorkbenchSpecTreeNodeStatusMap;
  locale: AppLocale;
}

// ---------------------------------------------------------------------------
// 文案
// ---------------------------------------------------------------------------

interface SpecTreeCopy {
  searchPlaceholder: string;
  searchAriaLabel: string;
  emptyHint: string;
  generateNodeLabel: string;
  generateNodeAriaLabel: string;
  collapseLabel: string;
  expandLabel: string;
}

function resolveCopy(locale: AppLocale): SpecTreeCopy {
  if (locale === "zh-CN") {
    return {
      searchPlaceholder: "搜索节点或文档…",
      searchAriaLabel: "搜索 SPEC 节点或文档",
      emptyHint: "暂无 SPEC 节点",
      generateNodeLabel: "生成",
      generateNodeAriaLabel: "生成本节点文档",
      collapseLabel: "收起",
      expandLabel: "展开",
    };
  }
  return {
    searchPlaceholder: "Search nodes or docs…",
    searchAriaLabel: "Search SPEC nodes or docs",
    emptyHint: "No SPEC nodes yet",
    generateNodeLabel: "Gen",
    generateNodeAriaLabel: "Generate node docs",
    collapseLabel: "Collapse",
    expandLabel: "Expand",
  };
}

// ---------------------------------------------------------------------------
// 派生工具（纯函数）
// ---------------------------------------------------------------------------

/** 节点 id → 节点对象的 lookup map。 */
type NodesById = ReadonlyMap<string, BlueprintSpecTreeNode>;
/** parentId（根节点为特殊键 ROOT_KEY）→ 子节点 id 列表的 lookup map。 */
type ChildrenByParent = ReadonlyMap<string, readonly string[]>;
/** node id → 该节点下文档列表（按 TYPE_ORDER 排序）。 */
type DocsByNodeId = ReadonlyMap<string, readonly BlueprintSpecDocument[]>;

/**
 * 把 `specTree.nodes` 折成两组 lookup map：
 *
 * 1. `nodesById`：`nodeId -> node`；
 * 2. `childrenByParent`：`parentId | ROOT_KEY -> nodeId[]`，保留 nodes 数组
 *    的原始相对顺序，避免再排序破坏已有渲染顺序。
 */
function buildTreeIndex(specTree: BlueprintSpecTree): {
  nodesById: NodesById;
  childrenByParent: ChildrenByParent;
  rootNodeIds: readonly string[];
} {
  const nodesById = new Map<string, BlueprintSpecTreeNode>();
  const childrenByParent = new Map<string, string[]>();

  for (const node of specTree.nodes) {
    nodesById.set(node.id, node);
    const parentKey =
      node.parentId === undefined || node.parentId === ""
        ? ROOT_KEY
        : node.parentId;
    const list = childrenByParent.get(parentKey);
    if (list) {
      list.push(node.id);
    } else {
      childrenByParent.set(parentKey, [node.id]);
    }
  }

  const rootNodeIds = childrenByParent.get(ROOT_KEY) ?? [];
  return { nodesById, childrenByParent, rootNodeIds };
}

/**
 * 把 specDocuments 按 nodeId 分组，并在组内按 TYPE_ORDER 排序。
 * 与 `streaming-doc/StreamingDocRenderer` 中既有 `groupDocumentsByNode` 排序
 * 口径一致；这里返回 `Map<nodeId, BlueprintSpecDocument[]>` 便于行级取数。
 */
function groupDocsByNodeId(
  specDocuments: readonly BlueprintSpecDocument[] | undefined
): DocsByNodeId {
  const map = new Map<string, BlueprintSpecDocument[]>();
  if (!specDocuments) return map;
  for (const doc of specDocuments) {
    const list = map.get(doc.nodeId);
    if (list) {
      list.push(doc);
    } else {
      map.set(doc.nodeId, [doc]);
    }
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) => (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99)
    );
  }
  return map;
}

/**
 * 判断单个节点（或其子树）是否命中搜索关键字。匹配维度：
 * - `node.title`（大小写无关 `includes`）
 * - 该节点下任意文档的 `title` / `type`（大小写无关 `includes`）
 *
 * 子树命中判定为递归判定：父节点本身不命中，但任意子孙命中也视为命中
 * （以便在搜索时父节点保留可见、子树自动展开）。
 */
function buildSearchMatchSet(
  query: string,
  rootNodeIds: readonly string[],
  childrenByParent: ChildrenByParent,
  nodesById: NodesById,
  docsByNodeId: DocsByNodeId
): ReadonlySet<string> {
  const matched = new Set<string>();
  if (query.length === 0) return matched;
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return matched;

  function nodeSelfMatches(node: BlueprintSpecTreeNode): boolean {
    if (
      typeof node.title === "string" &&
      node.title.toLowerCase().includes(needle)
    ) {
      return true;
    }
    const docs = docsByNodeId.get(node.id);
    if (!docs) return false;
    for (const doc of docs) {
      const title = typeof doc.title === "string" ? doc.title.toLowerCase() : "";
      if (title.includes(needle)) return true;
      if (
        typeof doc.type === "string" &&
        doc.type.toLowerCase().includes(needle)
      ) {
        return true;
      }
    }
    return false;
  }

  function visit(nodeId: string): boolean {
    const node = nodesById.get(nodeId);
    if (!node) return false;
    let anyHit = nodeSelfMatches(node);
    const childIds = childrenByParent.get(nodeId) ?? [];
    for (const childId of childIds) {
      // 即使父节点已 hit，仍需继续向下，确保命中状态在子树中传播
      const childHit = visit(childId);
      anyHit = anyHit || childHit;
    }
    if (anyHit) matched.add(nodeId);
    return anyHit;
  }

  for (const rootId of rootNodeIds) {
    visit(rootId);
  }
  return matched;
}

/**
 * 决定节点行点击时应当传给 `onSelectDocument` 的目标 docId：
 * 1. 节点存在文档时，取 TYPE_ORDER 排序后的第一个文档 id；
 * 2. 节点没有文档时，回退到 `node.id`，由容器决定如何处理（占位 / 忽略）。
 */
function resolveNodeClickDocId(
  node: BlueprintSpecTreeNode,
  docsByNodeId: DocsByNodeId
): string {
  const docs = docsByNodeId.get(node.id);
  if (docs && docs.length > 0) {
    return docs[0].id;
  }
  return node.id;
}

/**
 * 展开态应满足树形不变量：如果某个子节点被标记为展开，它的祖先链也必须
 * 处于有效展开态，否则用户第一次展开子节点时父分支会立即消失。
 */
function includeExpandedAncestors(
  expandedNodeIds: ReadonlySet<string>,
  nodesById: NodesById
): ReadonlySet<string> {
  if (expandedNodeIds.size === 0) return expandedNodeIds;
  const next = new Set(expandedNodeIds);
  for (const nodeId of expandedNodeIds) {
    let parentId = nodesById.get(nodeId)?.parentId;
    const visited = new Set<string>([nodeId]);
    while (parentId && !visited.has(parentId)) {
      next.add(parentId);
      visited.add(parentId);
      parentId = nodesById.get(parentId)?.parentId;
    }
  }
  return next;
}

/**
 * 收起父节点时同步移除所有已展开的后代，避免后代再通过
 * `includeExpandedAncestors` 把父节点“隐式撑开”。
 */
function removeExpandedDescendants(
  nodeId: string,
  expandedNodeIds: Set<string>,
  childrenByParent: ChildrenByParent
): void {
  const stack = [...(childrenByParent.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const childId = stack.pop();
    if (!childId) continue;
    expandedNodeIds.delete(childId);
    stack.push(...(childrenByParent.get(childId) ?? []));
  }
}

function resolveEffectiveExpandedIds(input: {
  isSearching: boolean;
  searchMatchSet: ReadonlySet<string>;
  expandedNodeIds: ReadonlySet<string>;
  rootNodeIds: readonly string[];
  nodesById: NodesById;
  autoExpandFirstRoot: boolean;
}): ReadonlySet<string> {
  const {
    isSearching,
    searchMatchSet,
    expandedNodeIds,
    rootNodeIds,
    nodesById,
    autoExpandFirstRoot,
  } = input;
  if (isSearching) {
    return searchMatchSet;
  }
  const baseExpandedIds =
    autoExpandFirstRoot && expandedNodeIds.size === 0 && rootNodeIds.length > 0
      ? new Set<string>([rootNodeIds[0]])
      : expandedNodeIds;
  return includeExpandedAncestors(baseExpandedIds, nodesById);
}

// ---------------------------------------------------------------------------
// View（无 hooks，便于测试直接调用 + 遍历 props 树）
// ---------------------------------------------------------------------------

interface WorkbenchSpecTreeViewProps {
  /** 搜索框当前值，由 wrapper 透传。 */
  query: string;
  /** 搜索框 onChange，由 wrapper 透传给受控 input。 */
  onQueryChange: (value: string) => void;
  /** 当前展开节点 id 集合，由 wrapper 透传。 */
  expandedNodeIds: ReadonlySet<string>;
  /** 切换某个节点展开状态，由 wrapper 透传。 */
  onToggleNode: (nodeId: string) => void;
  /** observing snapshot：派生 ephemeral chip 标签来源。 */
  observingSnapshot: SpecDocsObservingSnapshot;
  specTreeStale?: WorkbenchSpecTreeStaleState | null;
  staleDocumentsById?: ReadonlyMap<string, WorkbenchSpecTreeStaleState>;
  /** 文档分组 map：用于 chip 派生与文档行渲染。 */
  docsByNodeId: DocsByNodeId;
  /** 节点 id → 节点对象 lookup。 */
  nodesById: NodesById;
  /** parentId → 子节点 id 列表 lookup。 */
  childrenByParent: ChildrenByParent;
  /** 根节点 id 列表。 */
  rootNodeIds: readonly string[];
  /**
   * 是否启用首屏默认展开第一个根节点。wrapper 在用户首次手动 toggle 后会关闭，
   * 否则用户点击默认展开的根节点时无法真正收起。
   */
  autoExpandFirstRoot?: boolean;
  /** 容器层管理的 active document id。 */
  activeDocId: string | null;
  /** 容器层管理的 active node id。 */
  activeNodeId?: string | null;
  /** 节点行 / 文档行点击回调。 */
  onSelectDocument: (docId: string) => void;
  /** 单节点生成 spec 文档（可选）。 */
  onGenerateNode?: (nodeId: string) => void;
  /** 生成中状态。 */
  generating: "all" | "single" | null;
  /** 每节点生成进度快照（见 WorkbenchSpecTreeProps.nodeStatusById）。 */
  nodeStatusById?: WorkbenchSpecTreeNodeStatusMap;
  /** 节点总数，用于 `节点 · N` header。来自 specTree.nodes.length。 */
  nodeCount?: number;
  /**
   * 注册节点行 DOM ref（Q4 自动滚动用）。由有状态 wrapper 提供，纯 view
   * 仅在渲染时回调登记 ref，自身不持有 hooks。缺省时为 no-op。
   */
  registerNodeRowRef?: (nodeId: string, el: HTMLElement | null) => void;
  /** 国际化文案。 */
  copy: SpecTreeCopy;
  /** 国际化 locale，用于 StaleBadge 等子组件。 */
  locale: AppLocale;
}

/**
 * 无 hooks 的纯展示组件。入参全部为受控 props，便于 SSR 测试与 onClick
 * 委派测试直接调用。
 */
export const WorkbenchSpecTreeView: FC<WorkbenchSpecTreeViewProps> = (props) => {
  const {
    query,
    onQueryChange,
    expandedNodeIds,
    onToggleNode,
    observingSnapshot,
    specTreeStale,
    staleDocumentsById,
    docsByNodeId,
    nodesById,
    childrenByParent,
    rootNodeIds,
    autoExpandFirstRoot = true,
    activeDocId,
    activeNodeId,
    onSelectDocument,
    onGenerateNode,
    generating,
    nodeStatusById,
    nodeCount,
    registerNodeRowRef = () => {},
    copy,
    locale,
  } = props;

  const isSearching = query.trim().length > 0;
  const searchMatchSet = isSearching
    ? buildSearchMatchSet(
        query,
        rootNodeIds,
        childrenByParent,
        nodesById,
        docsByNodeId
      )
    : new Set<string>();

  /**
   * 计算实际生效的展开集合：
   * - 搜索非空：忽略 `expandedNodeIds`，把所有命中节点视为展开（与历史
   *   effectiveExpandedIds 行为一致）；
   * - 搜索为空：使用 `expandedNodeIds`；当 `expandedNodeIds` 为空且至少有
   *   一个根节点时，默认展开第一个根，保证首次渲染可见性。
   */
  const effectiveExpandedIds = resolveEffectiveExpandedIds({
    isSearching,
    searchMatchSet,
    expandedNodeIds,
    rootNodeIds,
    nodesById,
    autoExpandFirstRoot,
  });

  function renderNode(nodeId: string, depth: number): JSX.Element | null {
    const node = nodesById.get(nodeId);
    if (!node) return null;
    if (isSearching && !searchMatchSet.has(nodeId)) {
      return null;
    }

    const childIds = childrenByParent.get(nodeId) ?? [];
    const hasChildren = childIds.length > 0;
    const docs = docsByNodeId.get(node.id) ?? [];
    const hasExpandableContent = hasChildren || docs.length > 0;
    const expanded = effectiveExpandedIds.has(nodeId);
    const ephemeral = observingSnapshot.byNodeTitle.get(node.title);
    const chipDescriptor = deriveSpecTreeChip(docs, ephemeral);

    // 选中态判定：当前 activeDocId 落在该节点的文档列表中（doc.nodeId === node.id）
    // 或者 activeDocId 与 node.id 完全相等（无文档时的占位 docId 路径）。
    const isNodeSelected =
      activeNodeId === node.id ||
      (activeDocId !== null &&
        (activeDocId === node.id || docs.some((doc) => doc.id === activeDocId)));

    const onNodeClick = () => {
      onSelectDocument(resolveNodeClickDocId(node, docsByNodeId));
    };

    const generateDisabled = generating !== null;

    // whybuddy-spec-tree-progress-merge-2026-05-29：节点生成进度。
    const statusEntry = nodeStatusById?.[node.id];
    const nodeStatus = statusEntry?.status ?? "pending";
    const isProcessing = nodeStatus === "processing";
    // generated 文档数（用于 `n/N 修订` 副标题，仅 generated > 0 时显示）。
    const generatedDocCount = docs.length;

    // 双 background（Q6）：cool-gray selection 优先于 cream processing。
    const rowBgClass = isNodeSelected
      ? "border-[#D6DEE8] bg-[#F0F4F8] shadow-sm"
      : isProcessing
        ? "border-[#F0E4D4] bg-[#FAF7F2]"
        : "border-transparent hover:border-slate-200 hover:bg-slate-50";

    return (
      <div
        key={node.id}
        data-testid={`autopilot-workbench-spec-tree-node-${node.id}`}
        data-node-id={node.id}
        data-active={isNodeSelected ? "true" : undefined}
        data-node-status={nodeStatus}
        ref={(el) => registerNodeRowRef(node.id, el)}
        className={"min-w-0 overflow-hidden rounded-md border transition " + rowBgClass}
        style={{ paddingLeft: depth * 12 }}
      >
        <div className="flex min-w-0 items-center gap-1 px-1 py-1">
          {hasExpandableContent ? (
            <button
              type="button"
              data-testid={`autopilot-workbench-spec-tree-toggle-${node.id}`}
              aria-expanded={expanded}
              aria-label={expanded ? copy.collapseLabel : copy.expandLabel}
              onClick={() => onToggleNode(node.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-slate-500 transition hover:bg-white"
            >
              {expanded ? "▼" : "▶"}
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          {/* 状态图标（Q2 左侧）：在展开箭头之后、标题之前 */}
          <SpecTreeStatusIcon nodeId={node.id} entry={statusEntry} />
          <button
            type="button"
            data-testid={`autopilot-workbench-spec-tree-label-${node.id}`}
            data-active={isNodeSelected ? "true" : undefined}
            onClick={onNodeClick}
            className={
              "min-w-0 flex-1 rounded-md px-1 py-0.5 text-left " +
              (isNodeSelected ? "text-cyan-950" : "text-slate-800")
            }
          >
            <span className="block truncate text-[11px] font-bold">
              {node.title}
            </span>
            {generatedDocCount > 0 ? (
              <span
                data-testid={`autopilot-workbench-spec-tree-doc-count-${node.id}`}
                className="mt-0.5 block truncate text-[11px] font-medium text-[#666666]"
              >
                {generatedDocCount}/{generatedDocCount} 修订
              </span>
            ) : null}
          </button>
          <span className="min-w-0 max-w-[86px] shrink-0 overflow-hidden [&>*]:max-w-full [&_*]:truncate">
            <SpecTreeChip
              descriptor={chipDescriptor}
              testid={`autopilot-workbench-spec-tree-chip-${node.id}`}
            />
          </span>
          <StaleBadge
            staleSince={specTreeStale?.staleSince}
            invalidatedBy={specTreeStale?.invalidatedBy}
            locale={locale}
          />
          {isNodeSelected && onGenerateNode !== undefined ? (
            <button
              type="button"
              data-testid={`autopilot-workbench-spec-tree-generate-${node.id}`}
              data-compact-label={copy.generateNodeLabel}
              disabled={generateDisabled}
              aria-disabled={generateDisabled}
              aria-label={copy.generateNodeAriaLabel}
              title={copy.generateNodeAriaLabel}
              onClick={() => onGenerateNode(node.id)}
              className="max-w-[56px] shrink-0 truncate rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {copy.generateNodeLabel}
            </button>
          ) : null}
        </div>
        {expanded ? (
          <div className="grid gap-0.5 px-1 pb-1">
            {docs.map((doc) => {
              const isDocActive = activeDocId === doc.id;
              const staleDocument = staleDocumentsById?.get(doc.id);
              return (
                <button
                  key={doc.id}
                  type="button"
                  data-testid={`autopilot-workbench-spec-tree-doc-${doc.id}`}
                  data-active={isDocActive ? "true" : undefined}
                  onClick={() => onSelectDocument(doc.id)}
                  className={
                    "ml-6 flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-1 text-left text-[10px] font-semibold transition " +
                    (isDocActive
                      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                      : "border-slate-100 bg-white text-slate-600 hover:border-slate-200 hover:bg-slate-50")
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                  <StaleBadge
                    staleSince={staleDocument?.staleSince}
                    invalidatedBy={staleDocument?.invalidatedBy}
                    locale={locale}
                  />
                </button>
              );
            })}
            {childIds.map((childId) => renderNode(childId, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section
      data-testid="autopilot-workbench-spec-tree"
      role="navigation"
      aria-label="autopilot workbench spec tree"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-white"
    >
      <input
        type="search"
        data-testid="autopilot-workbench-spec-tree-search"
        aria-label={copy.searchAriaLabel}
        placeholder={copy.searchPlaceholder}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        className="m-1.5 h-7 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white"
      />
      {/* 节点 · N header（Q3：搜索框下方、tree roots 上方） */}
      {typeof nodeCount === "number" && nodeCount > 0 ? (
        <div
          data-testid="autopilot-workbench-spec-tree-node-count"
          className="px-2.5 pb-1 pt-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-[#999999]"
        >
          节点 · {nodeCount}
        </div>
      ) : null}
      <div
        data-testid="autopilot-workbench-spec-tree-roots"
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-1.5 pb-1.5"
      >
        {rootNodeIds.map((rootId) => renderNode(rootId, 0))}
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// 主组件（有状态包装）
// ---------------------------------------------------------------------------

export const WorkbenchSpecTree: FC<WorkbenchSpecTreeProps> = (props) => {
  const {
    specTree,
    specDocuments,
    reasoningEntries,
    specTreeStale,
    staleDocumentsById,
    activeDocId,
    activeNodeId,
    onSelectDocument,
    onGenerateNode,
    generating,
    nodeStatusById,
    locale,
  } = props;

  const copy = resolveCopy(locale);

  // 内部状态：搜索关键字 + 折叠节点 id 集合。
  const [query, setQuery] = useState<string>("");
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [hasManualExpansion, setHasManualExpansion] = useState(false);

  // observing snapshot：派生 ephemeral 标签来源，与
  // `SpecTreeWorkbench` 中现有派生方式一致。
  const observingSnapshot = useMemo(
    () => parseSpecDocsObservingEntries(reasoningEntries),
    [reasoningEntries]
  );

  // 文档分组：用于 chip 派生与文档行渲染。
  const docsByNodeId = useMemo(
    () => groupDocsByNodeId(specDocuments),
    [specDocuments]
  );

  // 树索引：useMemo 缓存依赖 specTree 引用稳定性。
  const treeIndex = useMemo(() => {
    if (
      specTree === null ||
      specTree === undefined ||
      specTree.nodes.length === 0
    ) {
      return null;
    }
    return buildTreeIndex(specTree);
  }, [specTree]);

  // whybuddy-spec-tree-progress-merge-2026-05-29 §Q4：节点行 DOM ref 登记表
  // + 一次性自动滚动。当某节点 status 从非 processing 跃迁到 processing 时，
  // 把该行 scrollIntoView({ block: "nearest" }) 一次；用 ref 记录上一轮每节点
  // status，只对"新晋 processing"触发，避免持续抢夺用户手动滚动位置。
  const nodeRowRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const registerNodeRowRef = useCallback(
    (nodeId: string, el: HTMLElement | null) => {
      if (el === null) {
        nodeRowRefs.current.delete(nodeId);
      } else {
        nodeRowRefs.current.set(nodeId, el);
      }
    },
    []
  );
  const prevNodeStatusRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const prev = prevNodeStatusRef.current;
    const nextSnapshot: Record<string, string> = {};
    let newlyProcessingId: string | null = null;
    for (const [id, entry] of Object.entries(nodeStatusById ?? {})) {
      const status = entry?.status ?? "pending";
      nextSnapshot[id] = status;
      if (status === "processing" && prev[id] !== "processing") {
        // 取第一个新晋 processing 节点滚动（批量并发时滚最靠前那个即可）。
        if (newlyProcessingId === null) newlyProcessingId = id;
      }
    }
    prevNodeStatusRef.current = nextSnapshot;
    if (newlyProcessingId !== null) {
      const el = nodeRowRefs.current.get(newlyProcessingId);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest" });
      }
    }
  }, [nodeStatusById]);

  const onToggleNode = useCallback(
    (nodeId: string) => {
      if (treeIndex === null) return;
      setHasManualExpansion(true);
      setExpandedNodeIds((prev) => {
        const visibleExpandedIds = resolveEffectiveExpandedIds({
          isSearching: query.trim().length > 0,
          searchMatchSet: new Set<string>(),
          expandedNodeIds: prev,
          rootNodeIds: treeIndex.rootNodeIds,
          nodesById: treeIndex.nodesById,
          autoExpandFirstRoot: !hasManualExpansion,
        });
        const next = new Set(visibleExpandedIds);
        if (visibleExpandedIds.has(nodeId)) {
          next.delete(nodeId);
          removeExpandedDescendants(
            nodeId,
            next,
            treeIndex.childrenByParent
          );
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [hasManualExpansion, query, treeIndex]
  );

  // ── 空态：specTree 为空 / null / nodes.length === 0 ──────────────────
  if (treeIndex === null) {
    return (
      <section
        data-testid="autopilot-workbench-spec-tree"
        role="navigation"
        aria-label="autopilot workbench spec tree"
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-white p-1.5"
      >
        <input
          type="search"
          data-testid="autopilot-workbench-spec-tree-search"
          aria-label={copy.searchAriaLabel}
          placeholder={copy.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled
          className="h-7 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-400"
        />
        <p
          data-testid="autopilot-workbench-spec-tree-empty"
          className="mt-2 rounded-md bg-slate-50 px-2 py-2 text-center text-[11px] font-semibold text-slate-500"
        >
          {copy.emptyHint}
        </p>
      </section>
    );
  }

  return (
    <WorkbenchSpecTreeView
      query={query}
      onQueryChange={setQuery}
      expandedNodeIds={expandedNodeIds}
      onToggleNode={onToggleNode}
      observingSnapshot={observingSnapshot}
      specTreeStale={specTreeStale}
      staleDocumentsById={staleDocumentsById}
      docsByNodeId={docsByNodeId}
      nodesById={treeIndex.nodesById}
      childrenByParent={treeIndex.childrenByParent}
      rootNodeIds={treeIndex.rootNodeIds}
      autoExpandFirstRoot={!hasManualExpansion}
      activeDocId={activeDocId}
      activeNodeId={activeNodeId}
      onSelectDocument={onSelectDocument}
      onGenerateNode={onGenerateNode}
      generating={generating}
      nodeStatusById={nodeStatusById}
      nodeCount={specTree?.nodes.length ?? 0}
      registerNodeRowRef={registerNodeRowRef}
      copy={copy}
      locale={locale}
    />
  );
};

export default WorkbenchSpecTree;

// ---------------------------------------------------------------------------
// 仅供测试导入；正常代码路径不应直接调这些纯函数 / 内部组件。
// ---------------------------------------------------------------------------

export const __testing__ = {
  buildTreeIndex,
  groupDocsByNodeId,
  buildSearchMatchSet,
  resolveNodeClickDocId,
  includeExpandedAncestors,
  removeExpandedDescendants,
  resolveEffectiveExpandedIds,
  resolveCopy,
  ROOT_KEY,
};
