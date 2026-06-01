/**
 * autopilot-mirofish-stream / Wave 0 — 主流组件
 *
 * 替代既有 AgentReasoningSubTimeline 的双轨布局,改为单纵向卡片流。
 * 阶段卡片底部挂载点保持 stageFilter prop 兼容,内部派生 6 类 entry。
 *
 * 数据来源（多路 store slice 合并 + job artifacts 派生）：
 * - useBlueprintRealtimeStore.agentReasoning.entries → reasoning entries
 * - useBlueprintRealtimeStore.capabilityStatuses + agentReasoning acting 反查
 *   timestamp → capability_invocation entries
 * - latestJob.artifacts → artifact_created entries
 * - extractRouteSelection(latestJob) → route_decision entry
 * - extractSpecTree(latestJob) + deriveSpecDocumentTreeStats → node_completed entries
 *
 * 设计原则：
 * - 只读：不写 store,不订阅 socket（订阅由 AutopilotRoutePage 完成）
 * - 折叠态：visibleEntries.length === 0 时返回 null,避免空容器抢占布局
 * - 自动 scroll：有新条目时滚到底部,与 AgentReasoningSubTimeline 行为一致
 * - 受 stageFilter 过滤,缺失 stageId 视为全局事件继续显示
 *
 * autopilot-mirofish-card-diversity / Task 3.1：
 * - 连续 ≥3 个 node_completed 折叠为 CollapsedNodeGroup 摘要行
 * - 支持展开/折叠查看详情
 */

import { useEffect, useMemo, useRef, useState, type FC } from "react";

import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import {
  deriveSpecDocumentTreeStats,
  type SpecDocumentTreeStats,
} from "@/lib/blueprint-spec-document-stats";
import type { AppLocale } from "@/lib/locale";

import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import {
  ArtifactCreatedCard,
  CapabilityInvocationCard,
  NodeCompletedCard,
  ReasoningCard,
  RouteDecisionCard,
  SystemNoteCard,
} from "./cards";
import { deriveMiroFishStreamEntries } from "./derive-mirofish-stream-entries";
import type {
  MiroFishNodeCompletedEntry,
  MiroFishStreamEntry,
} from "./mirofish-stream-types";

// ─── 连续 NodeCompleted 折叠逻辑 ─────────────────────────────────────────

/** 折叠阈值：连续 ≥ 此数量的 node_completed 将被折叠 */
const COLLAPSE_THRESHOLD = 3;

/**
 * 分组后的渲染单元：普通 entry 或折叠组。
 */
type GroupedEntry =
  | { type: "single"; entry: MiroFishStreamEntry }
  | { type: "collapsed_group"; entries: MiroFishNodeCompletedEntry[] };

/**
 * 将连续 ≥3 个 node_completed entry 折叠为 CollapsedNodeGroup。
 * 其余 entry 保持独立渲染。
 */
function groupConsecutiveNodeCompleted(
  entries: MiroFishStreamEntry[]
): GroupedEntry[] {
  const result: GroupedEntry[] = [];
  let i = 0;

  while (i < entries.length) {
    if (entries[i].kind === "node_completed") {
      // 收集连续的 node_completed
      const group: MiroFishNodeCompletedEntry[] = [];
      while (i < entries.length && entries[i].kind === "node_completed") {
        group.push(entries[i] as MiroFishNodeCompletedEntry);
        i++;
      }
      if (group.length >= COLLAPSE_THRESHOLD) {
        result.push({ type: "collapsed_group", entries: group });
      } else {
        // 不足阈值，逐个渲染
        for (const entry of group) {
          result.push({ type: "single", entry });
        }
      }
    } else {
      result.push({ type: "single", entry: entries[i] });
      i++;
    }
  }

  return result;
}

// ─── CollapsedNodeGroup 组件 ──────────────────────────────────────────────

/**
 * CollapsedNodeGroup — 连续节点完成折叠摘要行
 *
 * 当连续 ≥3 个 node_completed 出现时，折叠为单行摘要，
 * 展示 "N 个节点已完成"，支持展开查看详情。
 */
const CollapsedNodeGroup: FC<{
  entries: MiroFishNodeCompletedEntry[];
  locale: AppLocale;
}> = ({ entries, locale }) => {
  const [expanded, setExpanded] = useState(false);

  const summaryText =
    locale === "zh-CN"
      ? `${entries.length} 个节点已完成`
      : `${entries.length} nodes completed`;

  return (
    <div data-testid="mirofish-collapsed-node-group">
      {/* 摘要行 */}
      <button
        type="button"
        className="flex items-center gap-2 px-2 py-1.5 w-full text-left rounded-md hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="text-[10px] text-emerald-500 flex-shrink-0" aria-hidden="true">
          ✓
        </span>
        <span className="text-[10px] text-slate-500 flex-1">
          {summaryText}
        </span>
        <span className="text-[9px] text-slate-400 flex-shrink-0">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* 展开态：逐个渲染 NodeCompletedCard */}
      {expanded && (
        <div className="ml-2 border-l border-slate-200 pl-1">
          {entries.map(entry => (
            <NodeCompletedCard key={entry.id} entry={entry} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── helpers：从 latestJob 派生 routeSet / routeSelection / specTree ─────

function readArtifactPayload<T>(
  job: BlueprintGenerationJob | null | undefined,
  type: BlueprintGenerationArtifact["type"]
): T | null {
  const artifact = job?.artifacts?.find(a => a.type === type);
  if (!artifact || artifact.payload === undefined) return null;
  return artifact.payload as T;
}

// ─── 组件 props ──────────────────────────────────────────────────────────

export interface MiroFishCardStreamProps {
  locale?: AppLocale;
  /**
   * 阶段过滤；与既有 AgentReasoningSubTimeline 同语义。
   *
   * - string："route_generation" 等单一阶段,只显示该阶段的 entry
   * - readonly string[]：多个阶段合并显示（合并视图,如 "route" 卡片承接
   *   route_generation / route_selection / spec_tree 三段事件）
   * - undefined：显示所有 entry（含缺失 stageId 的）
   */
  stageFilter?: string | readonly string[];
  /**
   * 当前蓝图 job。组件需要从 job.artifacts 派生 routeSelection / routeSet /
   * specTree / artifacts。父级（AutopilotRightRail）从 props.job 传入。
   *
   * 缺失（null / undefined）时只渲染来自 store slice 的 reasoning + capability。
   */
  job?: BlueprintGenerationJob | null;
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

export const MiroFishCardStream: FC<MiroFishCardStreamProps> = ({
  locale = "zh-CN",
  stageFilter,
  job,
}) => {
  const agentReasoning = useBlueprintRealtimeStore(
    s => s.agentReasoning.entries
  );
  const capabilityStatuses = useBlueprintRealtimeStore(
    s => s.capabilityStatuses
  );
  const scopedAgentReasoning = useMemo(
    () =>
      job?.id
        ? agentReasoning.filter(entry => entry.jobId === job.id)
        : agentReasoning,
    [agentReasoning, job?.id]
  );

  // 从 latestJob.artifacts 派生 routeSet / routeSelection / specTree / artifacts
  const routeSelection = useMemo(
    () => readArtifactPayload<BlueprintRouteSelection>(job, "route_selection"),
    [job]
  );
  const routeSet = useMemo(
    () => readArtifactPayload<BlueprintRouteSet>(job, "route_set"),
    [job]
  );
  const specTree = useMemo(
    () => readArtifactPayload<BlueprintSpecTree>(job, "spec_tree"),
    [job]
  );
  const artifacts = useMemo(
    () => job?.artifacts ?? [],
    [job]
  );
  const specDocumentTreeStats = useMemo<SpecDocumentTreeStats | null>(
    () =>
      job && specTree
        ? deriveSpecDocumentTreeStats(job, specTree)
        : null,
    [job, specTree]
  );

  // 派生流式 entries
  const allEntries = useMemo(
    () =>
      deriveMiroFishStreamEntries({
        agentReasoning: scopedAgentReasoning,
        capabilityStatuses,
        artifacts,
        routeSelection,
        routeSet,
        specTree,
        specDocumentTreeStats,
      }),
    [
      scopedAgentReasoning,
      capabilityStatuses,
      artifacts,
      routeSelection,
      routeSet,
      specTree,
      specDocumentTreeStats,
    ]
  );

  // stageFilter 归一化为 Set
  const filterSet = useMemo(
    () =>
      stageFilter === undefined
        ? undefined
        : new Set(
            typeof stageFilter === "string" ? [stageFilter] : stageFilter
          ),
    [stageFilter]
  );

  const visibleEntries = useMemo(
    () =>
      allEntries.filter(e => {
        if (filterSet && e.stageId && !filterSet.has(e.stageId)) return false;
        return true;
      }),
    [allEntries, filterSet]
  );

  // 连续 node_completed 折叠分组
  const groupedEntries = useMemo(
    () => groupConsecutiveNodeCompleted(visibleEntries),
    [visibleEntries]
  );

  // 自动 scroll 到底部跟踪最新条目
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [visibleEntries.length]);

  if (visibleEntries.length === 0) return null;

  return (
    <div
      data-testid="mirofish-card-stream"
      className="mt-3 flex max-h-[420px] flex-col gap-2 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-100 bg-slate-50 p-3"
    >
      {groupedEntries.map((grouped, idx) => {
        if (grouped.type === "collapsed_group") {
          return (
            <CollapsedNodeGroup
              key={`collapsed-${grouped.entries[0].id}`}
              entries={grouped.entries}
              locale={locale}
            />
          );
        }
        return (
          <MiroFishCard
            key={grouped.entry.id}
            entry={grouped.entry}
            locale={locale}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};

// ─── 分发组件 ─────────────────────────────────────────────────────────────

const MiroFishCard: FC<{
  entry: MiroFishStreamEntry;
  locale: AppLocale;
}> = ({ entry, locale }) => {
  switch (entry.kind) {
    case "reasoning":
      return <ReasoningCard entry={entry} locale={locale} />;
    case "node_completed":
      return <NodeCompletedCard entry={entry} locale={locale} />;
    case "route_decision":
      return <RouteDecisionCard entry={entry} locale={locale} />;
    case "capability_invocation":
      return <CapabilityInvocationCard entry={entry} />;
    case "artifact_created":
      return <ArtifactCreatedCard entry={entry} locale={locale} />;
    case "system_note":
      return <SystemNoteCard entry={entry} locale={locale} />;
  }
};

export default MiroFishCardStream;
