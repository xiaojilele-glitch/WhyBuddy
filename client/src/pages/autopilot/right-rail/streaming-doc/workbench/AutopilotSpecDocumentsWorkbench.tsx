/**
 * `autopilot-spec-documents-workbench-v2` — 四区驾驶舱容器组件。
 *
 * 本容器承接 `client/src/pages/autopilot/right-rail/streaming-doc/StreamingDocRenderer.tsx`
 * 的渲染职责，把 SPEC 文档展示从“左 200px 侧栏 + 右文档主区”的 2 栏布局升级为
 * “顶部状态栏 + 左侧 Spec 树 + 中间文档主区 + 底部执行步骤”的 4 区驾驶舱布局，
 * 与已经与用户对齐的 SPEC-FIRST 蓝图设计图保持一致。
 *
 * Phase 1 / Task 1（骨架）：装配四区 CSS Grid 容器与稳定 `data-testid`。
 * Phase 1 / Task 2（动作按钮）：把顶部状态栏的 `onExport` 桥接到
 * `exportSpecDocumentsToDownload({ jobId, granularity: "tree" })`，把
 * `onRefresh` 桥接到 `props.onGenerateAll`（即 `handleGenerateAllSpecDocs`）；
 * `onReview` 暂保留为 no-op 占位并附 TODO 注释（R2.2 / R7.3 / R7.4）。
 * Phase 1 / Task 3（本任务，左侧 Spec 树）：管理 `activeDocId` 状态，把
 * `specTree / specDocuments / reasoningEntries / activeDocId / onSelectDocument /
 * onGenerateNode / generating / locale` 透传给 `<WorkbenchSpecTree>`。
 *
 * 兼容约束（与 requirements.md Non-Goals 对齐）：
 * - 不修改 `useBlueprintRealtimeStore` schema、`BlueprintGenerationJob /
 *   BlueprintSpecTree / BlueprintSpecDocument` 字段、`MiroFishCardStream`
 *   派生算法，以及 `handleGenerateAllSpecDocs / handleGenerateNodeSpecDocs /
 *   exportSpecDocumentsToDownload` 的签名（Non-Goals 1-4 / 6 / 8）。
 * - 不引入新的 npm 运行时依赖（R6.2），且不要求 `swiper`（R5.8）。
 * - 模块描述、props、关键函数说明使用中文 JSDoc（R6.3）；`data-testid` /
 *   promptId / API 字段名一律使用英文标识（R6.4）。
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FC } from "react";

import { exportSpecDocumentsToDownload } from "@/lib/blueprint-api/exportSpecDocuments";
import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import type { AppLocale } from "@/lib/locale";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import {
  streamingDocsReducer,
  INITIAL_REDUCER_STATE,
  isSpecDocumentContentEntry,
  pickDocumentId,
  pickChunk,
  deriveDocumentTitle,
  groupDocumentsByNode,
} from "../streaming-state";

import { WorkbenchDocMain } from "./WorkbenchDocMain";
import type {
  ActiveDocMeta,
  WorkbenchStaleArtifactState,
} from "./WorkbenchDocMain";
import { WorkbenchExecutionPanel } from "./WorkbenchExecutionPanel";
import {
  WorkbenchSpecTree,
  type WorkbenchSpecTreeNodeStatusMap,
} from "./WorkbenchSpecTree";
import { WorkbenchStatusBar } from "./WorkbenchStatusBar";
import { deriveDocStats } from "./derive-doc-stats";
import { deriveChapterChecklist } from "./derive-chapter-checklist";
import { deriveRelatedRefs } from "./derive-related-refs";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * 四区驾驶舱容器对外 props。
 *
 * 形状与 `StreamingDocRendererProps` 等价：保留全部字段以便 `StreamingDocRenderer`
 * 在内部把渲染原样委托给本容器，无需调整 `AutopilotRightRail` 的挂载分支或
 * 现有测试导入路径（R1.5、R7）。
 */
export interface AutopilotSpecDocumentsWorkbenchProps {
  /** 当前 job 的 spec documents entries（已包含全部阶段，由下游组件再做过滤）。 */
  entries: AgentReasoningEntry[];
  /** 已完成的 SpecDocument 对象（用于静态展示已完成文档）。 */
  specDocuments?: BlueprintSpecDocument[];
  /** SPEC 树，用于将 `nodeId` 解析为节点中文标题。 */
  specTree?: BlueprintSpecTree | null;
  locale: AppLocale;
  /** 生成整棵树文档回调（沿用 `handleGenerateAllSpecDocs`）。 */
  onGenerateAll?: () => void;
  /** 生成单个节点文档回调（沿用 `handleGenerateNodeSpecDocs`）。 */
  onGenerateNode?: (nodeId: string) => void;
  /** 当前生成状态："all" | "single" | null。 */
  generating?: "all" | "single" | null;
  /** 蓝图 job UUID，用于 `exportSpecDocumentsToDownload` 等导出动作。 */
  jobId?: string;
  /** 当前蓝图 job 对象，用于底部执行步骤区域复用 `MiroFishCardStream` 派生。 */
  job?: BlueprintGenerationJob | null;
  /**
   * whybuddy-stage3-unblock-2026-05-29 — 进入效果预演（stage 3）回调。
   * 透传给 `WorkbenchStatusBar`。
   */
  onEnterEffectPreview?: () => void;
  /** 进入效果预演按钮的运行态。透传给 `WorkbenchStatusBar`。 */
  effectPreviewState?: "idle" | "loading" | "success" | "error";
  /** 进入效果预演按钮的禁用条件。透传给 `WorkbenchStatusBar`。 */
  effectPreviewDisabled?: boolean;
  /**
   * whybuddy-spec-tree-progress-merge-2026-05-29：每节点生成进度快照，
   * 透传给 `WorkbenchSpecTree` 渲染节点行状态图标。由 `AutopilotRightRail`
   * 从 `specDocsProgress.nodes` 派生。
   */
  nodeStatusById?: WorkbenchSpecTreeNodeStatusMap;
}

export interface WorkbenchGridLayout {
  gridTemplateColumns: string;
  gridTemplateRows: string;
  gridTemplateAreas: string;
}

export const WORKBENCH_EXECUTION_PANEL_HEIGHT = "188px";
const TREE_MAIN_ROW_TRACK = "minmax(0, 1fr)";

export function resolveWorkbenchGridLayout(
  _docExpanded: boolean
): WorkbenchGridLayout {
  return {
    gridTemplateColumns: "238px minmax(0, 1fr)",
    gridTemplateRows: `auto ${TREE_MAIN_ROW_TRACK} ${WORKBENCH_EXECUTION_PANEL_HEIGHT}`,
    gridTemplateAreas: `
            "status status"
            "tree   main"
            "exec   exec"
          `,
  };
}

// ---------------------------------------------------------------------------
// 容器
// ---------------------------------------------------------------------------

/**
 * 四区 CSS Grid 布局：
 *
 *   ┌──────────────────────────────────────────┐
 *   │ status status                            │
 *   │ tree   main                              │
 *   │ exec   exec                              │
 *   └──────────────────────────────────────────┘
 *
 * - 顶部状态栏与底部执行步骤跨两列；
 * - 左侧 Spec 树固定宽度 240px；
 * - 中间文档主区通过 `minmax(0, 1fr)` 占据剩余空间，避免 `min-content` 撑破 grid。
 *
 * Phase 1 / Task 3：把左侧 Spec 树接入真实数据；中间文档主区与底部执行
 * 步骤仍为占位，分别由 Task 4 / Task 5+ 填充。
 */
export const AutopilotSpecDocumentsWorkbench: FC<
  AutopilotSpecDocumentsWorkbenchProps
> = (props) => {
  const {
    entries,
    specDocuments,
    specTree,
    locale,
    jobId,
    onGenerateAll,
    onGenerateNode,
  } = props;
  // R2.4 / R7.3：`generating` 缺省时归一为 `null`，与现有 specDocsGenerating 一致。
  const generating = props.generating ?? null;
  const realtimeSpecDocsProgress = useBlueprintRealtimeStore(
    (s) => s.specDocsProgress
  );
  const realtimeSubscribedJobId = useBlueprintRealtimeStore(
    (s) => s.subscribedJobId
  );

  // -------------------------------------------------------------------------
  // 流式 reducer：entries → streaming chunks
  // -------------------------------------------------------------------------

  const [streamState, dispatch] = useReducer(
    streamingDocsReducer,
    INITIAL_REDUCER_STATE
  );

  // 当 entries 变化时，把新增的 spec_documents 内容 entry 追加到 reducer。
  // 按 entry.id 去重，而不是按数组长度游标推进；这样在 socket 重连、
  // job 切换、entries 被替换/过滤时，不会跳过新内容或保留旧游标。
  const processedEntryIdsRef = useRef<Set<string>>(new Set());
  const processedJobIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (processedJobIdRef.current !== jobId) {
      processedEntryIdsRef.current.clear();
      processedJobIdRef.current = jobId;
      dispatch({ type: "reset" });
    }
    if (!entries || entries.length === 0) {
      if (processedEntryIdsRef.current.size > 0) {
        dispatch({ type: "reset" });
        processedEntryIdsRef.current.clear();
      }
      return;
    }
    const processed = processedEntryIdsRef.current;
    for (const entry of entries) {
      if (processed.has(entry.id)) continue;
      processed.add(entry.id);
      if (isSpecDocumentContentEntry(entry)) {
        const documentId = pickDocumentId(entry);
        const chunk = pickChunk(entry);
        if (chunk) {
          dispatch({ type: "append-chunk", documentId, chunk });
        }
      }
    }
  }, [entries, jobId]);

  // -------------------------------------------------------------------------
  // 节点标题映射 / 文档分组 / 文档索引
  // -------------------------------------------------------------------------

  /** nodeId → nodeTitle 映射。 */
  const nodeTitleByNodeId = useMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    if (specTree?.nodes) {
      for (const node of specTree.nodes) {
        map.set(node.id, node.title ?? node.id);
      }
    }
    return map;
  }, [specTree]);

  /** 按节点分组的文档列表。 */
  const groupedDocs = useMemo(
    () => groupDocumentsByNode(specDocuments ?? [], nodeTitleByNodeId),
    [specDocuments, nodeTitleByNodeId]
  );

  /** docId → BlueprintSpecDocument 索引。 */
  const docById = useMemo<ReadonlyMap<string, BlueprintSpecDocument>>(() => {
    const map = new Map<string, BlueprintSpecDocument>();
    if (specDocuments) {
      for (const doc of specDocuments) {
        map.set(doc.id, doc);
      }
    }
    return map;
  }, [specDocuments]);

  const specTreeStale = useMemo(
    () => deriveSpecTreeStale(props.job?.artifacts ?? []),
    [props.job?.artifacts]
  );

  const staleDocumentsById = useMemo(
    () => deriveStaleDocumentsById(props.job?.artifacts ?? []),
    [props.job?.artifacts]
  );

  /** 仅存在于流式 reducer 中、尚未出现在 specDocuments 的 id 集合。 */
  const streamingOnlyIds = useMemo(() => {
    const docIdSet = new Set(specDocuments?.map((d) => d.id) ?? []);
    return streamState.documentIds.filter((id) => !docIdSet.has(id));
  }, [specDocuments, streamState.documentIds]);

  /** 所有可选文档 id（specDocuments + streamingOnly）。 */
  const allDocIds = useMemo(() => {
    const ids = (specDocuments ?? []).map((d) => d.id);
    for (const sid of streamingOnlyIds) {
      if (!ids.includes(sid)) ids.push(sid);
    }
    return ids;
  }, [specDocuments, streamingOnlyIds]);

  // -------------------------------------------------------------------------
  // activeDocId 管理
  // -------------------------------------------------------------------------

  const firstNodeId = specTree?.rootNodeId ?? specTree?.nodes[0]?.id ?? null;
  const initialActiveDocId = allDocIds[0] ?? null;
  const [activeDocId, setActiveDocId] = useState<string | null>(
    () => initialActiveDocId
  );
  const [activeNodeId, setActiveNodeId] = useState<string | null>(() => {
    if (initialActiveDocId) {
      return docById.get(initialActiveDocId)?.nodeId ?? firstNodeId;
    }
    return firstNodeId;
  });
  const [docExpanded, setDocExpanded] = useState(false);

  // 自动选择：当 activeDocId 为 null 时默认选第一个；当当前 id 消失时重置。
  useEffect(() => {
    if (allDocIds.length === 0) {
      if (activeDocId !== null) setActiveDocId(null);
      if (activeNodeId === null && firstNodeId !== null) {
        setActiveNodeId(firstNodeId);
      }
      return;
    }
    if (activeDocId === null || !allDocIds.includes(activeDocId)) {
      const nextDocId = allDocIds[0];
      setActiveDocId(nextDocId);
      const nextDoc = docById.get(nextDocId);
      if (nextDoc) setActiveNodeId(nextDoc.nodeId);
    }
  }, [allDocIds, activeDocId, activeNodeId, firstNodeId, docById]);

  // -------------------------------------------------------------------------
  // 滚动位置缓存
  // -------------------------------------------------------------------------

  const scrollPositionsRef = useRef<Map<string, number>>(new Map());

  const handleScroll = useCallback(
    (scrollTop: number) => {
      if (activeDocId) {
        scrollPositionsRef.current.set(activeDocId, scrollTop);
      }
    },
    [activeDocId]
  );

  // 切换文档时先快照当前滚动位置
  const handleSelectDocument = useCallback(
    (docId: string) => {
      const doc = docById.get(docId);
      if (doc) {
        setActiveDocId(doc.id);
        setActiveNodeId(doc.nodeId);
        return;
      }
      if (specTree?.nodes.some((node) => node.id === docId)) {
        setActiveDocId(null);
        setActiveNodeId(docId);
      }
    },
    [docById, specTree]
  );

  // 当前文档的缓存滚动位置
  const currentScrollTop = activeDocId
    ? scrollPositionsRef.current.get(activeDocId) ?? 0
    : 0;

  // R2.3 / R7.4：导出按钮桥接到 `exportSpecDocumentsToDownload`，granularity 沿用
  // `SpecTreeWorkbench` 中既有的 "tree" 整树导出值（参见
  // `client/src/pages/autopilot/right-rail/spec-tree-workbench/SpecTreeWorkbench.tsx`
  // 中 `BulkExportButton granularity="tree"` 的现网调用）。
  // 当 `jobId` 缺失时，handler 短路并不调用 API；同时通过 `exportDisabled`
  // 让按钮在视觉上呈现禁用态。
  const handleExport = useCallback(() => {
    if (!jobId) return;
    void exportSpecDocumentsToDownload({ jobId, granularity: "tree" });
  }, [jobId]);

  // R2.4 / R7.3：refresh 桥接到 `handleGenerateAllSpecDocs`（即 `onGenerateAll`）。
  // 容器不在内部维护并行批量生成路径，避免与 `AutopilotRightRail` 的
  // `specDocsGenerating` 状态机产生分叉。
  const handleRefresh = useCallback(() => {
    onGenerateAll?.();
  }, [onGenerateAll]);

  // TODO: 当 AutopilotRightRail 暴露 review 处理函数后，把本占位替换为真实回调；
  // 当前 review 按钮按 design.md 的 Decision 3 仅渲染骨架与 `data-testid`。
  const handleReview = useCallback(() => {
    /* no-op placeholder until AutopilotRightRail wires a review handler */
  }, []);

  // R2.3 + Decision 3：jobId 缺失或正在生成时，导出按钮也应禁用。
  const exportDisabled = jobId === undefined || generating !== null;

  // -------------------------------------------------------------------------
  // Phase 2 / Task 7：DocStats 派生（R2.5-R2.10）
  // -------------------------------------------------------------------------

  /** 由 `deriveDocStats` 派生的统计聚合，透传给 `WorkbenchStatusBar`。 */
  const docStats = useMemo(
    () =>
      deriveDocStats({
        specDocuments,
        specTree,
        specDocsProgress:
          generating === "all" &&
          jobId !== undefined &&
          realtimeSubscribedJobId === jobId
            ? realtimeSpecDocsProgress
            : null,
      }),
    [
      generating,
      jobId,
      realtimeSpecDocsProgress,
      realtimeSubscribedJobId,
      specDocuments,
      specTree,
    ]
  );

  // -------------------------------------------------------------------------
  // activeDocMeta + renderedMarkdown 派生
  // -------------------------------------------------------------------------  /** 当前活跃文档的元数据。 */
  const activeDocMeta = useMemo<ActiveDocMeta | null>(() => {
    if (!activeDocId) return null;
    const doc = docById.get(activeDocId);
    const streamDoc = streamState.documents[activeDocId];
    const isStreamingDoc = streamDoc?.isStreaming ?? false;
    if (doc) {
      return {
        id: doc.id,
        title: doc.title ?? deriveDocumentTitle(doc.id, specDocuments, locale),
        type: doc.type,
        nodeTitle: nodeTitleByNodeId.get(doc.nodeId),
        isStreaming: isStreamingDoc,
      };
    }
    // 流式 only 文档（尚未出现在 specDocuments 中）
    if (streamDoc) {
      return {
        id: activeDocId,
        title: deriveDocumentTitle(activeDocId, specDocuments, locale),
        type: undefined,
        nodeTitle: undefined,
        isStreaming: isStreamingDoc,
      };
    }
    return null;
  }, [activeDocId, docById, streamState.documents, specDocuments, locale, nodeTitleByNodeId]);

  /** 渲染用 Markdown：流式 chunks 优先，否则回退到 SpecDocument.content。 */
  const renderedMarkdown = useMemo<string>(() => {
    if (!activeDocId) return "";
    const streamDoc = streamState.documents[activeDocId];
    if (streamDoc && streamDoc.rawMarkdown.length > 0) {
      return streamDoc.rawMarkdown;
    }
    const doc = docById.get(activeDocId);
    if (doc && typeof (doc as { content?: string }).content === "string") {
      return (doc as { content?: string }).content ?? "";
    }
    return "";
  }, [activeDocId, streamState.documents, docById]);

  /** 当前文档是否正在流式生成。 */
  const isStreamingActive = activeDocMeta?.isStreaming ?? false;

  // -------------------------------------------------------------------------
  // Phase 3 / Task 11：ChapterChecklist / RelatedRef / AISummary 派生
  // -------------------------------------------------------------------------

  /** 章节清单，基于当前渲染的 Markdown 二级标题派生。 */
  const chapterChecklist = useMemo(
    () => deriveChapterChecklist(renderedMarkdown),
    [renderedMarkdown]
  );

  /** 关联文档引用，基于当前 active 文档、specDocuments 与 specTree 派生。 */
  const relatedRefs = useMemo(
    () =>
      deriveRelatedRefs({
        activeDoc: activeDocId ? docById.get(activeDocId) ?? null : null,
        specDocuments,
        specTree,
      }),
    [activeDocId, docById, specDocuments, specTree]
  );

  /** AI 摘要：优先取 `BlueprintSpecDocument.summary`，缺失时为 null。 */
  const aiSummary = useMemo<string | null>(() => {
    if (!activeDocId) return null;
    const doc = docById.get(activeDocId);
    if (doc && typeof (doc as { summary?: string }).summary === "string" && ((doc as { summary?: string }).summary ?? "").length > 0) {
      return (doc as { summary?: string }).summary!;
    }
    return null;
  }, [activeDocId, docById]);

  const gridLayout = useMemo(
    () => resolveWorkbenchGridLayout(docExpanded),
    [docExpanded]
  );

  return (
    <div
      data-testid="autopilot-spec-documents-workbench"
      data-expanded={docExpanded ? "true" : undefined}
      role="region"
      aria-label="autopilot spec documents workbench"
      // whybuddy-stage3-unblock-2026-05-29 — 用户反馈 spec 文档驾驶舱外
      // 包浅灰 (#f6f8fb) + p-1.5 + rounded + border + shadow 与右栏整体
      // 视觉割裂，且与内部各个子面板自带的边框 / 背景重复。这里改成完全
      // 透明无内边距的 grid 容器，让内部 4 个子区域（status / tree /
      // main / exec）各自的 chrome 直接接管视觉。
      className="h-full min-h-0 w-full overflow-hidden bg-transparent"
      style={{
        display: "grid",
        gridTemplateColumns: gridLayout.gridTemplateColumns,
        gridTemplateRows: gridLayout.gridTemplateRows,
        gridTemplateAreas: gridLayout.gridTemplateAreas,
        gap: "6px",
        height: "100%",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        minHeight: 0,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          gridArea: "status",
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          boxSizing: "border-box",
        }}
      >
        <WorkbenchStatusBar
          title={resolveWorkbenchTitle(props.job, specTree, locale)}
          subtitle={resolveWorkbenchSubtitle(props.job, locale)}
          locale={locale}
          generating={generating}
          onExport={handleExport}
          onReview={handleReview}
          onRefresh={handleRefresh}
          onGenerateAll={props.onGenerateAll}
          onEnterEffectPreview={props.onEnterEffectPreview}
          effectPreviewState={props.effectPreviewState}
          effectPreviewDisabled={props.effectPreviewDisabled}
          exportDisabled={exportDisabled}
          docStats={docStats}
        />
      </div>
      <div
        style={{
          gridArea: "tree",
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        <WorkbenchSpecTree
          specTree={specTree}
          specDocuments={specDocuments}
          reasoningEntries={entries}
          specTreeStale={specTreeStale}
          staleDocumentsById={staleDocumentsById}
          activeDocId={activeDocId}
          activeNodeId={activeNodeId}
          onSelectDocument={handleSelectDocument}
          onGenerateNode={onGenerateNode}
          generating={generating}
          nodeStatusById={props.nodeStatusById}
          locale={locale}
        />
      </div>
      <div
        className="min-h-0"
        style={{
          gridArea: "main",
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        <WorkbenchDocMain
          activeDoc={activeDocMeta}
          renderedMarkdown={renderedMarkdown}
          isStreaming={isStreamingActive}
          scrollTop={currentScrollTop}
          onScroll={handleScroll}
          chapterChecklist={chapterChecklist}
          relatedRefs={relatedRefs}
          aiSummary={aiSummary}
          staleArtifact={
            activeDocId ? staleDocumentsById.get(activeDocId) ?? null : null
          }
          onSelectDocument={handleSelectDocument}
          expanded={docExpanded}
          onExpandedChange={setDocExpanded}
          locale={locale}
        />
      </div>
      <div
        style={{
          gridArea: "exec",
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          minHeight: 0,
          height: "100%",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        <WorkbenchExecutionPanel job={props.job} locale={locale} reasoningEntries={entries} />
      </div>
    </div>
  );
};

export default AutopilotSpecDocumentsWorkbench;

const SPEC_TREE_STALE_ARTIFACT_TYPES = new Set([
  "spec_tree",
  "spec_tree_version",
]);

const SPEC_DOCUMENT_STALE_ARTIFACT_TYPES = new Set([
  "requirements",
  "design",
  "tasks",
  "spec_document_version",
]);

function deriveSpecTreeStale(
  artifacts: readonly BlueprintGenerationArtifact[]
): WorkbenchStaleArtifactState | null {
  const artifact = artifacts.find(
    (item) =>
      item.staleSince && SPEC_TREE_STALE_ARTIFACT_TYPES.has(item.type)
  );
  return artifact ? toStaleState(artifact) : null;
}

function deriveStaleDocumentsById(
  artifacts: readonly BlueprintGenerationArtifact[]
): ReadonlyMap<string, WorkbenchStaleArtifactState> {
  const map = new Map<string, WorkbenchStaleArtifactState>();
  for (const artifact of artifacts) {
    if (
      !artifact.staleSince ||
      !SPEC_DOCUMENT_STALE_ARTIFACT_TYPES.has(artifact.type)
    ) {
      continue;
    }
    const state = toStaleState(artifact);
    for (const id of [
      readStringField(artifact.payload, "id"),
      readStringField(artifact.payload, "documentId"),
      readStringField(artifact.payload, "sourceDocumentId"),
      artifact.id,
    ]) {
      if (id) map.set(id, state);
    }
  }
  return map;
}

function toStaleState(
  artifact: BlueprintGenerationArtifact
): WorkbenchStaleArtifactState {
  return {
    staleSince: artifact.staleSince,
    invalidatedBy: artifact.invalidatedBy,
  };
}

function readStringField(source: unknown, key: string): string | undefined {
  if (source === null || typeof source !== "object") return undefined;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveWorkbenchTitle(
  job: BlueprintGenerationJob | null | undefined,
  specTree: BlueprintSpecTree | null | undefined,
  locale: AppLocale
): string | undefined {
  const direct =
    readStringField(job, "title") ??
    readStringField(job?.request, "targetText") ??
    readStringField(job?.request?.domainContext, "projectName");
  if (direct) return direct;

  const rootNode =
    specTree?.nodes.find((node) => node.id === specTree.rootNodeId) ??
    specTree?.nodes[0];
  if (rootNode?.title) return rootNode.title;

  return locale === "zh-CN" ? "SPEC-FIRST 蓝图" : "SPEC-FIRST Blueprint";
}

function resolveWorkbenchSubtitle(
  job: BlueprintGenerationJob | null | undefined,
  locale: AppLocale
): string | undefined {
  return (
    readStringField(job, "summary") ??
    readStringField(job?.request, "mode") ??
    (locale === "zh-CN" ? "Spec 文档与评审驾驶舱" : "Spec documents review cockpit")
  );
}
