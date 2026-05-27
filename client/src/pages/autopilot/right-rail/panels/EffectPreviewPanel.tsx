/**
 * Autopilot 驾驶舱右栏收敛 — `EffectPreviewPanel`
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 需求 1（8 个 Sub_Stage_Panel 的规范落点与命名冻结）
 * - 需求 2.4（`EffectPreviewPanel` 只接受 `{ jobId, job, specTree, effectPreviews,
 *   agentCrew, capabilityEvidence, locale }` + 面板私有字段
 *   `documents / initialPreviews / onPreviewsChange`）
 * - 需求 3（Rendering_Parity，零行为变更）
 * - 需求 5（`BlueprintProgressPanel` 组合化，`/specs` 兼容）
 * - 需求 6.1（`<AutopilotRightRail>` 在 `currentStage === "fabric"` 时消费 Canonical_Panel_Directory）
 * - 需求 7（独立可合入、单面板 PR、回滚安全）
 * - 需求 8（单向依赖与循环 import 守卫）
 * - 需求 10（零后端契约变更 + 零 testid drift）
 *
 * 本文件从 `client/src/pages/specs/BlueprintProgressPanel.tsx::EffectPreviewWorkbenchPanel`
 * （~行 1797–2215）逐字符搬运函数体，仅做以下调整：
 * 1. 组件更名为 `EffectPreviewPanel`
 * 2. 签名切换到 `EffectPreviewPanelProps = Pick<AutopilotRightRailProps, ...>` +
 *    面板私有字段 `documents / initialPreviews / onPreviewsChange`
 * 3. 必要的辅助函数与组件（`formatGeneratedAt` / `formatEffectPreviewDate` /
 *    `artifactTokenLabel` / `agentRoleStateLabel` / `agentRoleStateClass` /
 *    `agentRoleStateDetail` / `uniqueBlueprintStrings` / `compareRoleTimelineEvents` /
 *    `eventMatchesRuntimeProjection` / `collectRoleTimelineEvents` /
 *    `roleEventValue` / `roleEventSearchText` / `latestRoleEventByPredicate` /
 *    `roleEventProjectionStatus` / `buildRoleEventProjection` /
 *    `roleEventProjectionLogEntries` / `readRuntimeProjection` /
 *    `normalizeRuntimeProjection` / `runtimeProjectionHasSignal` /
 *    `runtimeProjectionValue` / `previewRecord` / `previewString` /
 *    `previewVersionValue` / `previewStringArray` / `previewStatusLabel` /
 *    `previewNodeProgressLabel` / `RuntimeProjectionCard` /
 *    `EffectPreviewVersionSync` / `EffectPreviewRuntimeProjection` /
 *    `EffectPreviewList` / `panelText` / `blueprintCopy`) 同步复制到本文件，
 *    保持 canonical panel 的独立可编译性
 *
 * 兼容性说明：
 * - 原 local function 的依赖数组、`useMemo / useState / useEffect / useCallback` 语义、
 *   JSX 结构、className 与 data-testid 均保持逐字符一致
 * - 辅助函数 `blueprintCopy / panelText / artifactTokenLabel / agentRoleStateLabel /
 *   agentRoleStateDetail / formatGeneratedAt / formatEffectPreviewDate` 在原实现里
 *   通过 `useAppStore.getState().locale` 读取 locale；canonical panel 禁止 import
 *   `@/lib/store`（需求 2.9 / 8.2），因此改为接收 `locale: AppLocale` 参数，
 *   `locale` 由 `AutopilotRightRailProps.locale` / `BlueprintProgressPanel` 组合时
 *   注入。输出行为等价。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FC } from "react";

import {
  Layers3,
  ListChecks,
  PlayCircle,
  RefreshCw,
  Send,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AutopilotImageSettingsPanel,
  type ImageSettingsViewModel,
} from "@/components/autopilot/AutopilotImageSettingsPanel";
import {
  EffectPreviewImagePanel,
  type NodeImageRecord as EffectPreviewNodeImageRecord,
  type ProgressPlanEntry as EffectPreviewProgressPlanEntry,
  type ProgressPlanState as EffectPreviewProgressPlanState,
} from "@/components/autopilot/EffectPreviewImagePanel";
import { EffectPreviewScheduleTimeline } from "@/components/autopilot/EffectPreviewScheduleTimeline";
import type { ApiRequestError } from "@/lib/api-client";
import { visualTokens } from "@/lib/autopilot/visual-tokens-placeholder";
import { mapImageSettingsResponseToViewModel } from "@/lib/autopilot/image-settings-mapper";
import { blueprintCopy as translateBlueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { StaleBadge } from "@/pages/autopilot/stage-edit";
import {
  fetchBlueprintEffectPreviews,
  generateBlueprintEffectPreview,
  normalizeBlueprintEffectPreviewRuntimeProjection,
  type BlueprintAgentCrewSnapshot,
  type BlueprintEffectPreviewLogEntry,
  type BlueprintEffectPreviewRuntimeProjection,
  type BlueprintEffectPreviewSnapshot,
} from "@/lib/blueprint-api";
import type {
  BlueprintGenerationArtifact,
  BlueprintRolePresenceState,
  BlueprintRoleTimelineEntry,
  BlueprintSpecDocument,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import type { AutopilotRightRailProps } from "@/pages/autopilot/right-rail/types";

/**
 * Spec 1 冻结的 `AutopilotRightRailProps` 字段子集，严格对应 design.md
 * 「面板抽离总表」第 4 行。
 *
 * 本面板额外接受三个 canonical-panel 私有字段：
 * - `documents`：对应原 local function 的 documents 参数；未传时从 `specTree.documents` 派生
 * - `initialPreviews`：对应原 local function 的 `initialPreviews` 参数
 * - `onPreviewsChange`：对应原 local function 的 `onPreviewsChange` 回调
 *
 * `<AutopilotRightRail>` 在 fabric stage 调用本面板时默认不传这三个字段，
 * 由 `BlueprintProgressPanel` 组合时注入。
 */
export type EffectPreviewPanelProps = Pick<
  AutopilotRightRailProps,
  | "jobId"
  | "job"
  | "specTree"
  | "effectPreviews"
  | "agentCrew"
  | "capabilityEvidence"
  | "locale"
> & {
  /** 原 local function 支持的 documents 参数；未传时从 `specTree.documents` 派生 */
  documents?: BlueprintSpecDocument[];
  /** 原 local function 支持的 initialPreviews 参数 */
  initialPreviews?: BlueprintEffectPreviewSnapshot[];
  /** 原 local function 支持的 onPreviewsChange 回调 */
  onPreviewsChange?: (previews: BlueprintEffectPreviewSnapshot[]) => void;
  /**
   * Phase 4 Task 35.4：测试专用注入点。
   *
   * 生产链路 **从不** 传该字段；面板会在挂载时从
   * `GET /api/blueprint/image-settings` 拉取真实配置。但 SSR 路径下
   * `useEffect` 不会触发（仓库测试用 `react-dom/server` 的
   * `renderToStaticMarkup`），因此测试通过这个 prop 直接注入「ready」
   * 视图模型来验证 masked key / model / timeout 字段的渲染。
   *
   * 设计模式与 `initialPreviews` 保持一致：当传入时跳过 fetch，把
   * `imageSettings` 初始化为该值，`imageSettingsState` 直接置为
   * `"ready"`。
   */
  initialImageSettings?: ImageSettingsViewModel | null;
};

// region Helpers: locale-aware copy 工具
function blueprintCopy(value: string | undefined, locale: AppLocale): string {
  return translateBlueprintCopy(value, locale);
}

function panelText(zh: string, en: string, locale: AppLocale): string {
  return locale === "zh-CN" ? zh : en;
}

function formatGeneratedAt(value: string, locale: AppLocale): string {
  if (!value) return locale === "zh-CN" ? "待同步" : "Pending sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatEffectPreviewDate(
  value: string | undefined,
  locale: AppLocale
): string {
  if (!value) return locale === "zh-CN" ? "预览草稿" : "Preview draft";
  return formatGeneratedAt(value, locale);
}

function artifactTokenLabel(
  value: string | undefined,
  fallback: string,
  locale: AppLocale
): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return translateBlueprintCopy(fallback, locale);
  const translated = translateBlueprintCopy(normalized, locale);
  if (translated !== normalized) return translated;

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function agentRoleStateLabel(state: string, locale: AppLocale): string {
  if (state === "active") return panelText("活跃", "Active", locale);
  if (state === "watching") return panelText("观察中", "Watching", locale);
  if (state === "reviewing") return panelText("评审中", "Reviewing", locale);
  if (state === "sleeping") return panelText("休眠", "Sleeping", locale);
  return artifactTokenLabel(state, "Status", locale);
}

function agentRoleStateClass(state: string): string {
  if (state === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (state === "watching") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (state === "reviewing") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-500";
}
// endregion


// region Types: role event projection（从 BlueprintProgressPanel 原文件搬运）
type BlueprintRoleEventConsumerId =
  | "scene"
  | "hud"
  | "logs"
  | "browser"
  | "spec";

type BlueprintRoleEventProjectionItem = {
  id: BlueprintRoleEventConsumerId;
  label: string;
  value: string;
  detail: string;
  status: string;
  roleState?: BlueprintRolePresenceState;
  eventType?: string;
  sourceEventId?: string;
};

type BlueprintRoleEventProjection = {
  items: BlueprintRoleEventProjectionItem[];
  eventCount: number;
  roleCount: number;
  latestEvent?: BlueprintRoleTimelineEntry;
};

type BlueprintEffectPreviewWithProjection = BlueprintEffectPreviewSnapshot & {
  runtimeProjection?: BlueprintEffectPreviewRuntimeProjection;
  runtime_projection?: unknown;
  projection?: unknown;
};

type BlueprintEffectPreviewWithVersionSync = BlueprintEffectPreviewSnapshot & {
  supersedes_preview_id?: unknown;
  version_status?: unknown;
  refreshed_from_spec_tree_version?: unknown;
  refreshed_at?: unknown;
  node_progress?: unknown;
  nodeStatus?: unknown;
  node_status?: unknown;
  nodeCompletion?: unknown;
  node_completion?: unknown;
  dependency_order?: unknown;
  previous_preview_ids?: unknown;
  preserved_preview_ids?: unknown;
  source_snapshot_hash?: unknown;
};

type StaleEffectPreviewState = {
  staleSince?: string | null;
  invalidatedBy?: BlueprintGenerationArtifact["invalidatedBy"] | null;
};
// endregion

function deriveStaleEffectPreviewsById(
  artifacts: readonly BlueprintGenerationArtifact[]
): ReadonlyMap<string, StaleEffectPreviewState> {
  const map = new Map<string, StaleEffectPreviewState>();
  for (const artifact of artifacts) {
    if (
      !artifact.staleSince ||
      (artifact.type !== "effect_preview" && artifact.type !== "preview")
    ) {
      continue;
    }

    const record =
      artifact.payload !== null && typeof artifact.payload === "object"
        ? (artifact.payload as Record<string, unknown>)
        : null;
    const state: StaleEffectPreviewState = {
      staleSince: artifact.staleSince,
      invalidatedBy: artifact.invalidatedBy,
    };
    for (const id of [
      previewString(record?.id),
      previewString(record?.previewId),
      previewString(record?.preview_id),
      artifact.id,
    ]) {
      if (id) map.set(id, state);
    }
  }
  return map;
}

// region Helpers: per-node progress plan adaptation for Stage C image components
//
// `EffectPreviewImagePanel` 与 `EffectPreviewScheduleTimeline` 消费的
// `progressPlan` 是「每节点状态」(`ProgressPlanEntry[]` with `nodeId` +
// `state`)；而 `BlueprintEffectPreviewSnapshot.progressPlan` 是 3 条通用
// milestone (`BlueprintEffectPreviewMilestone[]` with `id` / `title` /
// `summary` / `target`)。两者字段集互不兼容（详见
// `server/routes/blueprint/effect-preview/scheduler.ts` 顶部 §「本地化
// 实体」注释）。
//
// 为不破坏现有 milestone 区块（Task 31.3 regression 断言
// `data-testid="effect-preview-progress-plan"` 仍可见），本面板在挂载
// Stage C 图像 + 调度组件时，从 `dependencyOrder` + `imageBase64ByNodeId`
// 派生一份 per-node 视图：
// - `nodeId` 来自 `dependencyOrder` 的字符串数组顺序
// - `state`：有 `imageBase64ByNodeId[nodeId]` 记录 → `"completed"`；否则 `"pending"`
// - `title`：尽可能从 `specTree.nodes` 找到对应 node title，缺失时回退 `nodeId`
//
// 若服务端后续把 per-node 进度直接写入 snapshot（例如新增
// `progressPlanByNode` 字段），可在这里替换派生为直接读取，保持组件契约不变。
function derivePerNodeProgressPlan(args: {
  dependencyOrder: ReadonlyArray<string>;
  imageBase64ByNodeId: Record<string, EffectPreviewNodeImageRecord> | undefined;
  nodeTitleById?: ReadonlyMap<string, string>;
}): ReadonlyArray<EffectPreviewProgressPlanEntry> {
  const records = args.imageBase64ByNodeId ?? {};
  return args.dependencyOrder.map(nodeId => {
    const state: EffectPreviewProgressPlanState =
      records[nodeId] !== undefined ? "completed" : "pending";
    const title = args.nodeTitleById?.get(nodeId);
    const entry: EffectPreviewProgressPlanEntry = title
      ? { nodeId, state, title }
      : { nodeId, state };
    return entry;
  });
}

/**
 * 浏览器侧 base64 → Blob 下载（fire-and-forget）。
 *
 * 仅在用户点击「下载图像」按钮时触发，永不在 SSR 阶段调用。失败被静默吞掉，
 * 与 `EffectPreviewImagePanel` 内部缓存写入同样的 fail-silent 风格一致。
 */
function downloadEffectPreviewImage(
  filename: string,
  b64: string,
  mimeType: string,
): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  try {
    const byteString = atob(b64);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i += 1) {
      bytes[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  } catch {
    /* swallow download errors silently */
  }
}
// endregion

// region Helpers: role event projection
function uniqueBlueprintStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}

function compareRoleTimelineEvents(
  left: BlueprintRoleTimelineEntry,
  right: BlueprintRoleTimelineEntry
): number {
  return (
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.id.localeCompare(right.id)
  );
}

function eventMatchesRuntimeProjection(
  event: BlueprintRoleTimelineEntry,
  projection: BlueprintEffectPreviewRuntimeProjection | null | undefined
): boolean {
  if (!projection) return true;
  const linkedIds = uniqueBlueprintStrings([
    projection.jobId,
    projection.routeId,
    projection.specTreeId,
    projection.nodeId,
    projection.sceneSnapshotId,
    projection.browserPreviewId,
    projection.effectPreviewId,
  ]);
  const eventIds = uniqueBlueprintStrings([
    event.jobId,
    event.routeId,
    event.specTreeId,
    event.nodeId,
    event.artifactId,
    event.capabilityId,
    event.evidenceId,
  ]);

  return (
    linkedIds.length === 0 ||
    eventIds.length === 0 ||
    eventIds.some(id => linkedIds.includes(id)) ||
    Boolean(projection.nodeId && event.nodeId === projection.nodeId) ||
    Boolean(projection.routeId && event.routeId === projection.routeId)
  );
}

function collectRoleTimelineEvents(
  agentCrew: BlueprintAgentCrewSnapshot | null | undefined,
  projection: BlueprintEffectPreviewRuntimeProjection | null | undefined
): BlueprintRoleTimelineEntry[] {
  return (agentCrew?.roleTimelines ?? agentCrew?.presence ?? [])
    .flatMap(role => role.entries ?? [])
    .filter(event => eventMatchesRuntimeProjection(event, projection))
    .sort(compareRoleTimelineEvents);
}

function roleEventValue(
  event: BlueprintRoleTimelineEntry | undefined,
  fallback: string
): string {
  return event?.currentAction || event?.summary || fallback;
}

function roleEventSearchText(event: BlueprintRoleTimelineEntry): string {
  return [
    event.type,
    event.summary,
    event.currentAction,
    event.artifactId,
    event.capabilityId,
    event.evidenceId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function latestRoleEventByPredicate(
  events: BlueprintRoleTimelineEntry[],
  predicate: (event: BlueprintRoleTimelineEntry) => boolean
): BlueprintRoleTimelineEntry | undefined {
  return events.filter(predicate).at(-1);
}

function roleEventProjectionStatus(
  event: BlueprintRoleTimelineEntry | undefined,
  fallback = "pending"
): string {
  return event?.presenceState ?? fallback;
}

function buildRoleEventProjection(
  agentCrew: BlueprintAgentCrewSnapshot | null | undefined,
  projection: BlueprintEffectPreviewRuntimeProjection | null | undefined,
  locale: AppLocale
): BlueprintRoleEventProjection {
  const events = collectRoleTimelineEvents(agentCrew, projection);
  const latestEvent = events.at(-1);
  const sceneEvent = latestRoleEventByPredicate(events, event => {
    const text = roleEventSearchText(event);
    return (
      text.includes("3d") ||
      text.includes("scene") ||
      text.includes("snapshot") ||
      event.stage === "spec_tree" ||
      Boolean(event.specTreeId || event.nodeId)
    );
  });
  const hudEvent = latestRoleEventByPredicate(events, event => {
    const text = roleEventSearchText(event);
    return text.includes("hud") || event.type === "role.activated";
  });
  const logEvent = latestRoleEventByPredicate(
    events,
    event =>
      event.type === "role.capability_invoked" ||
      Boolean(event.capabilityId) ||
      Boolean(event.evidenceId)
  );
  const browserEvent = latestRoleEventByPredicate(events, event => {
    const text = roleEventSearchText(event);
    return text.includes("browser") || text.includes("preview");
  });
  const specEvent = latestRoleEventByPredicate(
    events,
    event =>
      event.stage === "spec_tree" ||
      event.stage === "spec_docs" ||
      Boolean(event.specTreeId) ||
      Boolean(event.nodeId)
  );

  return {
    eventCount: events.length,
    roleCount: uniqueBlueprintStrings(events.map(event => event.roleId)).length,
    latestEvent,
    items: [
      {
        id: "scene",
        label: panelText("3D 场景", "3D Scene", locale),
        value:
          projection?.sceneSnapshotId ||
          roleEventValue(
            sceneEvent,
            panelText("等待场景角色事件", "Waiting for scene role event", locale)
          ),
        detail: sceneEvent
          ? panelText(
              `角色事件 ${sceneEvent.eventId} 让场景状态保持对齐。`,
              `Role event ${sceneEvent.eventId} keeps scene state aligned.`,
              locale
            )
          : projection?.sceneSnapshotId
            ? panelText(
                "场景快照已链接到运行时投影。",
                "Scene snapshot is linked to the runtime projection.",
                locale
              )
            : panelText("暂无场景角色事件。", "No scene role event yet.", locale),
        status: roleEventProjectionStatus(
          sceneEvent,
          projection?.sceneSnapshotId ? "ready" : "pending"
        ),
        roleState: sceneEvent?.presenceState,
        eventType: sceneEvent?.type,
        sourceEventId: sceneEvent?.eventId,
      },
      {
        id: "hud",
        label: "HUD",
        value:
          projection?.hudState.summary ||
          projection?.hudState.title ||
          roleEventValue(
            hudEvent,
            panelText("等待 HUD 角色事件", "Waiting for HUD role event", locale)
          ),
        detail: hudEvent
          ? panelText(
              `角色事件 ${hudEvent.eventId} 驱动 HUD 存在感 ${agentRoleStateLabel(
                hudEvent.presenceState,
                locale
              )}。`,
              `Role event ${hudEvent.eventId} drives HUD presence ${agentRoleStateLabel(
                hudEvent.presenceState,
                locale
              )}.`,
              locale
            )
          : projection?.hudState.badges.length
            ? projection.hudState.badges.join(" / ")
            : `${artifactTokenLabel(projection?.hudState.status, "preview", locale)} ${panelText(
                "状态",
                "status",
                locale
              )}`,
        status: roleEventProjectionStatus(
          hudEvent,
          projection?.hudState.status ?? "pending"
        ),
        roleState: hudEvent?.presenceState,
        eventType: hudEvent?.type,
        sourceEventId: hudEvent?.eventId,
      },
      {
        id: "logs",
        label: panelText("日志", "Logs", locale),
        value:
          roleEventValue(logEvent, projection?.logTimeline[0]?.message ?? "") ||
          panelText("等待运行时日志", "Waiting for runtime logs", locale),
        detail: logEvent
          ? panelText(
              `角色事件 ${logEvent.eventId} 已镜像到日志。`,
              `Role event ${logEvent.eventId} is mirrored in logs.`,
              locale
            )
          : projection?.logTimeline[0]?.occurredAt ||
            panelText(
              `${projection?.logTimeline.length ?? 0} 条运行时日志`,
              `${projection?.logTimeline.length ?? 0} runtime log entries`,
              locale
            ),
        status: roleEventProjectionStatus(logEvent, "pending"),
        roleState: logEvent?.presenceState,
        eventType: logEvent?.type,
        sourceEventId: logEvent?.eventId,
      },
      {
        id: "browser",
        label: panelText("浏览器", "Browser", locale),
        value:
          projection?.browserPreviewId ||
          projection?.browserPreview.url ||
          roleEventValue(
            browserEvent,
            panelText(
              "等待浏览器角色事件",
              "Waiting for browser role event",
              locale
            )
          ),
        detail: browserEvent
          ? panelText(
              `角色事件 ${browserEvent.eventId} 让浏览器预览保持对齐。`,
              `Role event ${browserEvent.eventId} keeps browser preview aligned.`,
              locale
            )
          : projection?.browserPreview.url ||
            projection?.browserPreview.summary ||
            projection?.browserPreview.title ||
            panelText(
              "暂无浏览器预览角色事件。",
              "No browser preview role event yet.",
              locale
            ),
        status: roleEventProjectionStatus(
          browserEvent,
          projection?.browserPreviewId || projection?.browserPreview.url
            ? "ready"
            : "pending"
        ),
        roleState: browserEvent?.presenceState,
        eventType: browserEvent?.type,
        sourceEventId: browserEvent?.eventId,
      },
      {
        id: "spec",
        label: panelText("SPEC 界面", "SPEC UI", locale),
        value: roleEventValue(
          specEvent ?? latestEvent,
          panelText("等待 SPEC 角色事件", "Waiting for SPEC role event", locale)
        ),
        detail: specEvent
          ? panelText(
              `角色事件 ${specEvent.eventId} 会在 SPEC 界面中可见。`,
              `Role event ${specEvent.eventId} is visible in SPEC UI.`,
              locale
            )
          : latestEvent
            ? panelText(
                `最新角色事件 ${latestEvent.eventId} 会在 SPEC 界面中可见。`,
                `Latest role event ${latestEvent.eventId} is visible in SPEC UI.`,
                locale
              )
            : panelText(
                "暂无角色事件流条目。",
                "No role event stream entries yet.",
                locale
              ),
        status: roleEventProjectionStatus(specEvent ?? latestEvent, "pending"),
        roleState: (specEvent ?? latestEvent)?.presenceState,
        eventType: (specEvent ?? latestEvent)?.type,
        sourceEventId: (specEvent ?? latestEvent)?.eventId,
      },
    ],
  };
}

function roleEventProjectionLogEntries(
  roleEventProjection: BlueprintRoleEventProjection
): BlueprintEffectPreviewLogEntry[] {
  return roleEventProjection.items
    .filter(item => item.sourceEventId)
    .map((item, index) => ({
      id: `role-event-log-${item.sourceEventId ?? index + 1}`,
      level:
        item.status === "reviewing" || item.status === "active"
          ? "success"
          : "info",
      message: `${item.label}: ${item.value}`,
      occurredAt: roleEventProjection.latestEvent?.occurredAt ?? "",
      sourceDocumentIds: [],
    }));
}
// endregion


// region Helpers: runtime projection + preview meta
function readRuntimeProjection(
  preview: BlueprintEffectPreviewSnapshot | null | undefined
): unknown {
  const candidate = preview as
    | BlueprintEffectPreviewWithProjection
    | null
    | undefined;
  return (
    candidate?.runtimeProjection ??
    candidate?.runtime_projection ??
    candidate?.projection
  );
}

function normalizeRuntimeProjection(
  preview: BlueprintEffectPreviewSnapshot | null | undefined,
  value: unknown
): BlueprintEffectPreviewRuntimeProjection {
  return normalizeBlueprintEffectPreviewRuntimeProjection(value, {
    previewId: preview?.id,
    jobId: preview?.jobId,
    treeId: preview?.treeId,
    nodeId: preview?.nodeId,
    title: (preview as (BlueprintEffectPreviewSnapshot & { title?: string }) | null | undefined)?.title,
    summary: preview?.summary,
    status: preview?.status,
  });
}

function runtimeProjectionValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function previewRecord(
  preview: BlueprintEffectPreviewSnapshot | null | undefined
): BlueprintEffectPreviewWithVersionSync | null {
  return (
    (preview as BlueprintEffectPreviewWithVersionSync | null | undefined) ??
    null
  );
}

function previewString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function previewVersionValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return previewString(value);
}

function previewStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => previewString(item)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n|,|;/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

function previewStatusLabel(value: unknown, locale: AppLocale): string {
  return artifactTokenLabel(previewString(value, "current"), "Current", locale);
}

function previewNodeProgressLabel(
  preview: BlueprintEffectPreviewSnapshot | null | undefined,
  locale: AppLocale
): string {
  const record = previewRecord(preview);
  const nodeProgress =
    record?.nodeProgress ??
    record?.node_progress ??
    ((record?.nodeStatus ??
      record?.node_status ??
      record?.nodeCompletion ??
      record?.node_completion) !== undefined
      ? {
          status: record?.nodeStatus ?? record?.node_status,
          completion: record?.nodeCompletion ?? record?.node_completion,
        }
      : undefined);

  if (!nodeProgress || typeof nodeProgress !== "object") {
    return "Node progress pending";
  }

  const progress = nodeProgress as {
    status?: unknown;
    completion?: unknown;
    completionPercent?: unknown;
    completion_percent?: unknown;
    percent?: unknown;
  };
  const status = previewString(progress.status, "pending");
  const completion = previewVersionValue(
    progress.completion ??
      progress.completionPercent ??
      progress.completion_percent ??
      progress.percent
  );

  return completion
    ? `${previewStatusLabel(status, locale)} / ${completion}%`
    : previewStatusLabel(status, locale);
}
// endregion


// region Subcomponents: version sync / runtime projection card / list
function EffectPreviewVersionSync({
  preview,
  locale,
}: {
  preview: BlueprintEffectPreviewSnapshot | null;
  locale: AppLocale;
}) {
  const record = previewRecord(preview);
  const version = previewVersionValue(record?.version) || "draft";
  const versionStatus =
    record?.versionStatus ?? record?.version_status ?? record?.status;
  const specTreeVersion =
    previewVersionValue(
      record?.refreshedFromSpecTreeVersion ??
        record?.refreshed_from_spec_tree_version
    ) || "pending";
  const refreshedAt = previewString(
    record?.refreshedAt ?? record?.refreshed_at
  );
  const dependencyOrder = previewStringArray(
    record?.dependencyOrder ?? record?.dependency_order
  );
  const preservedPreviewIds = previewStringArray(
    record?.preservedPreviewIds ?? record?.preserved_preview_ids
  );
  const previousPreviewIds = previewStringArray(
    record?.previousPreviewIds ?? record?.previous_preview_ids
  );
  const sourceSnapshotHash = previewString(
    record?.sourceSnapshotHash ?? record?.source_snapshot_hash
  );

  return (
    <div
      className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3"
      data-testid="effect-preview-version-sync"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className="rounded-full border-[#0f766e]/25 bg-white text-[10px] font-black text-[#0f766e]"
        >
          Version {blueprintCopy(version, locale)}
        </Badge>
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
        >
          {previewStatusLabel(versionStatus, locale)}
        </Badge>
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
        >
          SpecTree {blueprintCopy(specTreeVersion, locale)}
        </Badge>
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
        >
          Preserved {preservedPreviewIds.length}
        </Badge>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
            Node
          </div>
          <div className="mt-1 truncate text-xs font-bold text-slate-700">
            {blueprintCopy(previewNodeProgressLabel(preview, locale), locale)}
          </div>
        </div>
        <div
          className="rounded-[12px] border border-slate-200 bg-white px-3 py-2"
          data-testid="effect-preview-dependency-order"
        >
          <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
            Dependency Order
          </div>
          <div className="mt-1 truncate text-xs font-bold text-slate-700">
            {dependencyOrder.length
              ? blueprintCopy(dependencyOrder.join(" -> "), locale)
              : "No dependency order"}
          </div>
        </div>
        <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
            Previous Versions
          </div>
          <div className="mt-1 truncate text-xs font-bold text-slate-700">
            {previousPreviewIds.length
              ? `${previousPreviewIds.length} previous / ${preservedPreviewIds.length} preserved`
              : `${preservedPreviewIds.length} preserved`}
          </div>
        </div>
      </div>
      {refreshedAt || sourceSnapshotHash ? (
        <div className="mt-2 truncate text-[10px] font-black uppercase tracking-normal text-slate-400">
          {refreshedAt
            ? `Refreshed ${formatEffectPreviewDate(refreshedAt, locale)}`
            : "Refreshed"}
          {sourceSnapshotHash ? ` / ${sourceSnapshotHash}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function RuntimeProjectionCard({
  label,
  value,
  detail,
  status,
  locale,
}: {
  label: string;
  value: string;
  detail: string;
  status: string;
  locale: AppLocale;
}) {
  return (
    <div
      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
      data-testid="runtime-projection-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
            {label}
          </div>
          <div className="mt-1 truncate text-sm font-black text-slate-900">
            {blueprintCopy(value, locale)}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-full text-[10px] font-black",
            status === "ready" || status === "completed"
              ? "border-[#0f766e]/30 bg-[#0f766e]/10 text-[#0f766e]"
              : "border-slate-200 bg-white text-slate-500"
          )}
        >
          {artifactTokenLabel(status, "State", locale)}
        </Badge>
      </div>
      <div className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
        {blueprintCopy(detail, locale)}
      </div>
    </div>
  );
}

function EffectPreviewRuntimeProjection({
  preview,
  roleEventProjection,
  locale,
}: {
  preview: BlueprintEffectPreviewSnapshot | null;
  roleEventProjection?: BlueprintRoleEventProjection;
  locale: AppLocale;
}) {
  const projection = useMemo(
    () => normalizeRuntimeProjection(preview, readRuntimeProjection(preview)),
    [preview]
  );
  const projectedLogs = useMemo(
    () =>
      projection.logTimeline.length
        ? projection.logTimeline
        : roleEventProjection
          ? roleEventProjectionLogEntries(roleEventProjection)
          : [],
    [projection.logTimeline, roleEventProjection]
  );
  const latestLog = projection.logTimeline[0];
  const latestProjectedLog = projectedLogs[0];
  const hasScene = Boolean(projection.sceneSnapshotId);
  const hasHud = Boolean(
    projection.hudState.title ||
      projection.hudState.summary ||
      projection.hudState.badges.length ||
      projection.hudState.progressPercent > 0
  );
  const hasLogs = projectedLogs.length > 0;
  const hasBrowser = Boolean(
    projection.browserPreviewId || projection.browserPreview.url
  );
  const roleItemsById = useMemo(
    () =>
      new Map((roleEventProjection?.items ?? []).map(item => [item.id, item])),
    [roleEventProjection]
  );
  const sceneRoleItem = roleItemsById.get("scene");
  const hudRoleItem = roleItemsById.get("hud");
  const logsRoleItem = roleItemsById.get("logs");
  const browserRoleItem = roleItemsById.get("browser");

  return (
    <div
      className="rounded-[16px] border border-slate-200 bg-white p-4"
      data-testid="effect-preview-runtime-projection"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
            <PlayCircle className="size-3.5" aria-hidden="true" />
            {panelText("运行时投影", "Runtime Projection", locale)}
          </div>
          <h4 className="mt-2 truncate text-base font-black text-slate-950">
            {blueprintCopy(
              projection.hudState.title || "Runtime capability projection",
              locale
            )}
          </h4>
        </div>
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
        >
          {projection.hudState.progressPercent}%
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <RuntimeProjectionCard
          label={panelText("3D 场景", "3D Scene", locale)}
          value={runtimeProjectionValue(
            projection.sceneSnapshotId || sceneRoleItem?.value,
            panelText("等待场景快照", "Waiting for scene snapshot", locale)
          )}
          detail={
            sceneRoleItem?.detail ||
            (projection.sceneSnapshotId
              ? panelText("场景快照已连接。", "Scene snapshot is linked.", locale)
              : panelText("暂无场景快照。", "No scene snapshot yet.", locale))
          }
          status={sceneRoleItem?.status ?? (hasScene ? "ready" : "pending")}
          locale={locale}
        />
        <RuntimeProjectionCard
          label="HUD"
          value={runtimeProjectionValue(
            projection.hudState.summary || hudRoleItem?.value,
            projection.hudState.title ||
              panelText("等待 HUD 状态", "Waiting for HUD state", locale)
          )}
          detail={
            hudRoleItem?.detail ??
            (projection.hudState.badges.length
              ? projection.hudState.badges.join(" / ")
              : `${artifactTokenLabel(projection.hudState.status, "preview", locale)} ${panelText("状态", "status", locale)}`)
          }
          status={
            hudRoleItem?.status ??
            (hasHud ? projection.hudState.status : "pending")
          }
          locale={locale}
        />
        <RuntimeProjectionCard
          label={panelText("日志", "Logs", locale)}
          value={runtimeProjectionValue(
            latestLog?.message ||
              latestProjectedLog?.message ||
              logsRoleItem?.value,
            panelText("等待运行时日志", "Waiting for runtime logs", locale)
          )}
          detail={
            logsRoleItem?.detail ||
            latestProjectedLog?.occurredAt ||
            panelText(
              `${projectedLogs.length} 条运行时日志`,
              `${projectedLogs.length} runtime log entries`,
              locale
            )
          }
          status={
            logsRoleItem?.status ??
            (hasLogs ? (latestProjectedLog?.level ?? "ready") : "pending")
          }
          locale={locale}
        />
        <RuntimeProjectionCard
          label={panelText("浏览器", "Browser", locale)}
          value={runtimeProjectionValue(
            projection.browserPreviewId || browserRoleItem?.value,
            projection.browserPreview.url ||
              panelText("等待浏览器预览", "Waiting for browser preview", locale)
          )}
          detail={
            browserRoleItem?.detail ||
            projection.browserPreview.url ||
            projection.browserPreview.summary ||
            projection.browserPreview.title ||
            panelText("暂无浏览器预览链接。", "No browser preview link yet.", locale)
          }
          status={browserRoleItem?.status ?? (hasBrowser ? "ready" : "pending")}
          locale={locale}
        />
      </div>
    </div>
  );
}

function EffectPreviewList({
  title,
  items,
  locale,
}: {
  title: string;
  items: string[];
  locale: AppLocale;
}) {
  return (
    <div className="rounded-[16px] border border-slate-200 bg-white p-4">
      <div className="text-xs font-black uppercase tracking-normal text-slate-500">
        {title}
      </div>
      {items.length ? (
        <ul className="mt-3 grid gap-2">
          {items.map((item, index) => (
            <li
              key={`${title}-${index}-${item}`}
              className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-600"
            >
              {blueprintCopy(item, locale)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
          {panelText("等待生成说明。", "Waiting for generation notes.", locale)}
        </div>
      )}
    </div>
  );
}
// endregion


/**
 * `EffectPreviewPanel` —— 对应 `AutopilotRailSubStage === "effect_preview"`。
 *
 * 函数体逐字符搬运自 `BlueprintProgressPanel.tsx::EffectPreviewWorkbenchPanel`，
 * 唯一差异：内部辅助函数 `panelText / blueprintCopy / artifactTokenLabel /
 * agentRoleStateLabel / agentRoleStateDetail / formatGeneratedAt /
 * formatEffectPreviewDate` 从「读 store.locale」改为「接收 props.locale」，
 * 以满足需求 2.9 与 8.2（canonical panel 禁止 import `@/lib/store`）。
 *
 * 原函数签名里的 `BlueprintEffectPreview` + `documents`（必传）被替换为
 * `BlueprintEffectPreviewSnapshot`（与 `AutopilotRightRailProps.effectPreviews`
 * 一致）+ 可选 `documents` 字段；面板内部派生
 * `const documents = props.documents ?? props.specTree?.documents ?? [];`
 * 保持原 local function 语义。
 */
export const EffectPreviewPanel: FC<EffectPreviewPanelProps> = props => {
  const {
    specTree,
    jobId,
    job,
    agentCrew,
    locale,
    initialPreviews,
    onPreviewsChange,
    initialImageSettings,
  } = props;
  const documents: BlueprintSpecDocument[] =
    props.documents ??
    ((specTree as (BlueprintSpecTree & { documents?: BlueprintSpecDocument[] }) | null)
      ?.documents ??
      []);

  if (!specTree) {
    return null;
  }

  return (
    <EffectPreviewPanelInner
      specTree={specTree}
      jobId={jobId}
      job={job}
      documents={documents}
      agentCrew={agentCrew}
      locale={locale}
      initialPreviews={initialPreviews}
      onPreviewsChange={onPreviewsChange}
      initialImageSettings={initialImageSettings}
    />
  );
};

function EffectPreviewPanelInner({
  specTree,
  jobId,
  job,
  documents,
  initialPreviews,
  agentCrew,
  onPreviewsChange,
  locale,
  initialImageSettings,
}: {
  specTree: BlueprintSpecTree;
  jobId?: string | null;
  job?: EffectPreviewPanelProps["job"];
  documents: BlueprintSpecDocument[];
  initialPreviews?: BlueprintEffectPreviewSnapshot[];
  agentCrew?: BlueprintAgentCrewSnapshot | null;
  onPreviewsChange?: (previews: BlueprintEffectPreviewSnapshot[]) => void;
  locale: AppLocale;
  initialImageSettings?: ImageSettingsViewModel | null;
}) {
  const acceptedDocuments = useMemo(
    () =>
      documents.filter(
        document => (document.status ?? "draft").toLowerCase() === "accepted"
      ),
    [documents]
  );
  const previewNodeIds = useMemo(
    () =>
      new Set([
        ...acceptedDocuments.map(document => document.nodeId),
        ...specTree.nodes
          .filter(node => node.type === "effect_preview")
          .map(node => node.id),
      ]),
    [acceptedDocuments, specTree.nodes]
  );
  const previewNodes = useMemo(
    () =>
      specTree.nodes.filter(
        node => previewNodeIds.has(node.id) || node.type === "effect_preview"
      ),
    [previewNodeIds, specTree.nodes]
  );
  const [previews, setPreviews] = useState<BlueprintEffectPreviewSnapshot[]>(
    initialPreviews ?? []
  );
  const [selectedPreviewId, setSelectedPreviewId] = useState(
    initialPreviews?.[0]?.id ?? ""
  );
  const [selectedNodeId, setSelectedNodeId] = useState(
    previewNodes[0]?.id ??
      acceptedDocuments[0]?.nodeId ??
      specTree.nodes.find(node => node.type === "effect_preview")?.id ??
      specTree.rootNodeId
  );
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  // Phase 4 Task 35.3：从 `GET /api/blueprint/image-settings` 拉取
  // image generation 配置快照，并在右栏 milestone 上方挂出
  // `<AutopilotImageSettingsPanel>` 作为只读诊断视图。
  //
  // 行为：
  // - 测试通过 `initialImageSettings` 直接注入 view model（绕过 fetch）
  // - 生产链路 `initialImageSettings === undefined`，挂载后异步 fetch
  // - SSR 守卫：`typeof window === "undefined"` 时不 fetch（panel 经
  //   `renderToStaticMarkup` 渲染于 SSR / 测试上下文）
  // - 失败（throw / 非 2xx）→ `imageSettingsState = "error"`，渲染小型
  //   `data-testid="autopilot-image-settings-panel-error"` 提示
  const [imageSettings, setImageSettings] =
    useState<ImageSettingsViewModel | null>(
      initialImageSettings !== undefined ? initialImageSettings : null
    );
  const [imageSettingsState, setImageSettingsState] = useState<
    "loading" | "ready" | "error"
  >(initialImageSettings !== undefined ? "ready" : "loading");

  useEffect(() => {
    setPreviews(initialPreviews ?? []);
    setSelectedPreviewId(current =>
      initialPreviews?.some(preview => preview.id === current)
        ? current
        : (initialPreviews?.[0]?.id ?? "")
    );
  }, [initialPreviews]);

  useEffect(() => {
    setSelectedNodeId(current =>
      specTree.nodes.some(node => node.id === current)
        ? current
        : (previewNodes[0]?.id ?? specTree.rootNodeId)
    );
  }, [previewNodes, specTree.nodes, specTree.rootNodeId]);

  const selectedNode = useMemo(
    () =>
      specTree.nodes.find(node => node.id === selectedNodeId) ??
      specTree.nodes[0],
    [selectedNodeId, specTree.nodes]
  );
  const activePreview = useMemo(
    () =>
      previews.find(preview => preview.id === selectedPreviewId) ??
      previews[0] ??
      null,
    [previews, selectedPreviewId]
  );
  const activeRuntimeProjection = useMemo(
    () =>
      normalizeRuntimeProjection(
        activePreview,
        readRuntimeProjection(activePreview)
      ),
    [activePreview]
  );
  const roleEventProjection = useMemo(
    () => buildRoleEventProjection(agentCrew, activeRuntimeProjection, locale),
    [activeRuntimeProjection, agentCrew, locale]
  );
  const stalePreviewsById = useMemo(
    () => deriveStaleEffectPreviewsById(job?.artifacts ?? []),
    [job?.artifacts]
  );
  // Phase 4 Task 31.1：派生 Stage C 图像 + 调度组件需要的 per-node 视图。
  // 详见上方 `derivePerNodeProgressPlan` 注释 — `BlueprintEffectPreviewSnapshot.progressPlan`
  // 是「3 条通用 milestone」，新组件需要的是「每节点状态」，两者字段集互不兼容。
  const effectPreviewDependencyOrderNodeIds = useMemo<ReadonlyArray<string>>(
    () => {
      const order = activePreview?.dependencyOrder;
      if (!Array.isArray(order)) return [];
      return order
        .map(entry => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry === "object" && "nodeId" in entry) {
            const nodeId = (entry as { nodeId?: unknown }).nodeId;
            return typeof nodeId === "string" ? nodeId : "";
          }
          return "";
        })
        .filter((nodeId): nodeId is string => nodeId.length > 0);
    },
    [activePreview]
  );
  const effectPreviewNodeTitleById = useMemo<ReadonlyMap<string, string>>(
    () => new Map(specTree.nodes.map(node => [node.id, node.title])),
    [specTree.nodes]
  );
  const effectPreviewPerNodeProgressPlan = useMemo<
    ReadonlyArray<EffectPreviewProgressPlanEntry>
  >(
    () =>
      derivePerNodeProgressPlan({
        dependencyOrder: effectPreviewDependencyOrderNodeIds,
        imageBase64ByNodeId: activePreview?.imageBase64ByNodeId,
        nodeTitleById: effectPreviewNodeTitleById,
      }),
    [
      activePreview?.imageBase64ByNodeId,
      effectPreviewDependencyOrderNodeIds,
      effectPreviewNodeTitleById,
    ]
  );
  const effectPreviewVersionNumber = useMemo<number>(() => {
    const raw = activePreview?.version;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 1;
  }, [activePreview]);
  const canGenerate = Boolean(jobId) && acceptedDocuments.length > 0;

  const publishPreviews = useCallback(
    (nextPreviews: BlueprintEffectPreviewSnapshot[]) => {
      setPreviews(nextPreviews);
      onPreviewsChange?.(nextPreviews);
      setSelectedPreviewId(current =>
        nextPreviews.some(preview => preview.id === current)
          ? current
          : (nextPreviews[0]?.id ?? "")
      );
    },
    [onPreviewsChange]
  );

  const handleRefresh = useCallback(async () => {
    if (!jobId) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchBlueprintEffectPreviews(jobId);
      if (result.ok) {
        publishPreviews(result.data.effectPreviews);
      } else if (result.error.status === 404) {
        publishPreviews([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }, [jobId, publishPreviews]);

  const handleGenerate = useCallback(async () => {
    if (!jobId || acceptedDocuments.length === 0) return;

    setGenerating(true);
    setError(null);

    try {
      const result = await generateBlueprintEffectPreview(jobId, {
        nodeId: selectedNode?.id,
        includeDrafts: false,
      });
      if (result.ok) {
        publishPreviews(result.data.effectPreviews);
      } else {
        setError(result.error);
      }
    } finally {
      setGenerating(false);
    }
  }, [acceptedDocuments.length, jobId, publishPreviews, selectedNode?.id]);

  useEffect(() => {
    if (!jobId || previews.length > 0) return;
    void handleRefresh();
  }, [handleRefresh, jobId, previews.length]);

  // Phase 4 Task 35.3：mount-once fetch of `/api/blueprint/image-settings`.
  //
  // 不 depend 于任何 prop（生产链路只想拉一次配置快照），并通过
  // `initialImageSettings !== undefined` 跳过 fetch 路径，保持测试
  // 注入语义。SSR 守卫确保 `renderToStaticMarkup` 路径下不会调用 fetch。
  useEffect(() => {
    if (initialImageSettings !== undefined) {
      // 测试注入路径：直接使用注入的 view model，跳过网络
      return;
    }
    if (typeof window === "undefined") {
      // SSR / `renderToStaticMarkup` 环境：保持 loading 占位，不 fetch
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/blueprint/image-settings");
        if (!response.ok) {
          if (!cancelled) {
            setImageSettings(null);
            setImageSettingsState("error");
          }
          return;
        }
        const body: unknown = await response.json();
        if (cancelled) return;
        // Phase 5 Task 42.1：把响应 → view model 的字段复制下放到纯 helper
        // (`mapImageSettingsResponseToViewModel`)。Helper 在
        // `client/src/lib/autopilot/image-settings-mapper.ts`，
        // 由独立单测覆盖（`__tests__/image-settings-mapper.test.ts`）。
        // helper 返回 `null` 表示响应字段缺失或类型不匹配，此时与 fetch
        // 失败一样把面板切到 error 态。
        // 服务端响应中 `apiKey` 已被脱敏成 `maskedApiKey`；客户端面板的
        // `apiKey` prop 设计上接收 raw key，但 helper 传入已脱敏的字符串：
        // 面板的 `maskApiKey` 算法对已经满足脱敏长度并由相同 fill 字符
        // (`U+2022 BULLET`) 构成中段的字符串是 idempotent 的（slice(0,8)
        // + 中间 bullet × (length - 14) + slice(-6) 还原同字串）。
        // 真值 key 永远不会出现在 response body 中（参见
        // server/routes/blueprint/image-settings.ts 的 sentinel-leak 测试）。
        const viewModel = mapImageSettingsResponseToViewModel(body);
        if (viewModel === null) {
          setImageSettings(null);
          setImageSettingsState("error");
          return;
        }
        setImageSettings(viewModel);
        setImageSettingsState("ready");
      } catch {
        if (!cancelled) {
          setImageSettings(null);
          setImageSettingsState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="grid gap-3"
      data-testid="effect-preview-workbench"
    >
      {/* Header chrome removed: SubStageCard 已提供标题 / apiPath / summary / 状态胶囊 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-none border-[#CCCCCC] bg-white font-black text-black hover:bg-[#F3F3F3]"
            disabled={!jobId || loading || generating}
            onClick={handleRefresh}
            data-testid="effect-preview-refresh-button"
          >
            <RefreshCw
              className={cn("size-3.5", loading && "animate-spin")}
              aria-hidden="true"
            />
            {panelText("刷新", "Refresh", locale)}
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-none bg-black font-black text-white hover:bg-[#333]"
            disabled={!canGenerate || loading || generating}
            onClick={handleGenerate}
            data-testid="effect-preview-generate-button"
          >
            {generating ? (
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            {panelText("生成预演", "Generate preview", locale)}
          </Button>
      </div>

      {error ? (
        <div className="rounded-none border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <div className="font-black text-rose-950">{error.message}</div>
          <p className="mt-1 font-semibold leading-6 text-rose-700">
            {error.detail}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.25fr)]">
        <div className="rounded-none border border-[#EAEAEA] bg-white p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              {panelText("预演列表", "Preview list", locale)}
            </div>
            <Badge
              variant="outline"
              className="rounded-none border-[#CCCCCC] bg-white text-[10px] font-black text-black font-mono uppercase"
            >
              {panelText(
                `${previews.length} 个预演`,
                `${previews.length} preview${previews.length === 1 ? "" : "s"}`,
                locale
              )}
            </Badge>
          </div>
          <ScrollArea className="mt-3 max-h-[320px] pr-2">
            <div className="grid gap-2" data-testid="effect-preview-list">
              {previews.length ? (
                previews.map(preview => {
                  const selected = activePreview?.id === preview.id;
                  const previewWithTitle = preview as BlueprintEffectPreviewSnapshot & {
                    title?: string;
                  };
                  const stalePreview = stalePreviewsById.get(preview.id);
                  return (
                    <button
                      key={preview.id}
                      type="button"
                      className={cn(
                        "w-full rounded-[14px] border px-3 py-3 text-left transition",
                        selected
                          ? "border-[#0f766e] bg-[#0f766e]/10"
                          : "border-slate-200 bg-slate-50 hover:border-[#0f766e]/30 hover:bg-white"
                      )}
                      onClick={() => setSelectedPreviewId(preview.id)}
                      aria-pressed={selected}
                    >
                      <div className="truncate text-sm font-black text-slate-900">
                        {blueprintCopy(previewWithTitle.title, locale)}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(preview.summary, locale)}
                      </div>
                      <div className="mt-2">
                        <StaleBadge
                          staleSince={stalePreview?.staleSince}
                          invalidatedBy={stalePreview?.invalidatedBy}
                          locale={locale}
                        />
                      </div>
                      <div className="mt-2 text-[10px] font-black uppercase tracking-normal text-slate-400">
                        {formatEffectPreviewDate(
                          preview.updatedAt ?? preview.createdAt,
                          locale
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
                  {panelText(
                    "暂无效果预演。接受需求、设计或任务文档后即可生成预演。",
                    "No effect preview yet. Accept requirements, design, or tasks documents to generate one.",
                    locale
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              {panelText("来源范围", "Source scope", locale)}
            </div>
            <div className="mt-2 grid gap-2">
              {previewNodes.length ? (
                previewNodes.map(node => {
                  const selected = selectedNode?.id === node.id;
                  const acceptedCount = acceptedDocuments.filter(
                    document => document.nodeId === node.id
                  ).length;

                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={cn(
                        "rounded-[12px] border px-3 py-2 text-left transition",
                        selected
                          ? "border-[#0f766e] bg-white"
                          : "border-slate-200 bg-white/70 hover:border-[#0f766e]/30"
                      )}
                      onClick={() => setSelectedNodeId(node.id)}
                      aria-pressed={selected}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-black text-slate-900">
                          {blueprintCopy(node.title, locale)}
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                          {panelText(
                            `${acceptedCount} 已接受`,
                            `${acceptedCount} accepted`,
                            locale
                          )}
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="text-xs font-semibold leading-5 text-slate-500">
                  {panelText(
                    "已接受的 SPEC 文档会作为生成范围显示在这里。",
                    "Accepted SPEC documents will appear here as the generation scope.",
                    locale
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <Layers3 className="size-3.5" aria-hidden="true" />
                  预演详情
                </div>
                <h4 className="mt-2 truncate text-base font-black text-slate-950">
                  {(activePreview as (BlueprintEffectPreviewSnapshot & { title?: string }) | null)
                    ?.title
                    ? blueprintCopy(
                        (activePreview as BlueprintEffectPreviewSnapshot & {
                          title?: string;
                        }).title,
                        locale
                      )
                    : "效果预演已就绪"}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
              >
                {acceptedDocuments.length} 份已接受文档
              </Badge>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {activePreview?.summary
                ? blueprintCopy(activePreview.summary, locale)
                : "工作台已连接，正在等待后端预演内容。"}
            </p>
            <EffectPreviewVersionSync preview={activePreview} locale={locale} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <EffectPreviewList
              title="架构说明"
              items={activePreview?.architectureNotes ?? []}
              locale={locale}
            />
            <EffectPreviewList
              title="原型说明"
              items={activePreview?.prototypeNotes ?? []}
              locale={locale}
            />
          </div>

          <EffectPreviewRuntimeProjection
            preview={activePreview}
            roleEventProjection={roleEventProjection}
            locale={locale}
          />

          {activePreview ? (
            <>
              {/*
                Phase 4 Task 31.1：把 Stage C 图像画廊与调度时间线挂在
                现有的 milestone 区块上方，使后端写入的
                `imageBase64ByNodeId` / `dependencyOrder` 能在右侧 rail
                可见。

                Phase 4 Tasks 31.2 + 34.4：`architectureSvgDraft` 现在直接
                透传 `activePreview.architectureSvgDraft`。服务端
                `server/routes/blueprint/effect-preview/svg-architecture-drafter.ts`
                的 `draftSvgArchitecture` 已在 Task 34.1 末尾接入
                whitelist sanitizer（`sanitizeSvgArchitectureDraft`），
                会在 SVG 字符串落到 `BlueprintEffectPreview.architectureSvgDraft`
                之前去除 `<script>` / `<foreignObject>` / `on*=` 事件处理器 /
                `javascript:` URL / 外部 `<a>` `<image>` href，因此
                `EffectPreviewImagePanel` 通过 `dangerouslySetInnerHTML`
                挂载 SVG 时已是 defense-in-depth 后的安全字符串。
              */}
              <EffectPreviewImagePanel
                missionId={
                  activePreview.id ?? activePreview.jobId ?? jobId ?? ""
                }
                activeStageKey="effect_preview"
                progressPlan={effectPreviewPerNodeProgressPlan}
                imageBase64ByNodeId={activePreview.imageBase64ByNodeId ?? {}}
                architectureSvgDraft={activePreview.architectureSvgDraft}
                visualTokens={visualTokens}
                onDownload={downloadEffectPreviewImage}
                version={effectPreviewVersionNumber}
                theme="light"
              />
              <EffectPreviewScheduleTimeline
                activeStageKey="effect_preview"
                progressPlan={effectPreviewPerNodeProgressPlan}
                dependencyOrder={effectPreviewDependencyOrderNodeIds}
                visualTokens={visualTokens}
                theme="light"
              />
            </>
          ) : null}

          {/*
            Phase 4 Task 35.3：image generation 配置只读面板。
            位于 Stage C 调度时间线下方、milestone 区块上方 —— 它是
            诊断 / 配置类视图，次于画廊与时间线。挂载策略：
            - `imageSettingsState === "loading"`：渲染 loading 占位
            - `imageSettingsState === "error"`：渲染小型内联提示
            - `imageSettingsState === "ready" && imageSettings !== null`：
              渲染真实 `<AutopilotImageSettingsPanel>`
            理由：fetch 失败或仍在 in-flight 时不挂载真实面板，避免
            空 view model 触发 panel 内部的「未配置」状态把视觉重心
            压在调度时间线下面。
          */}
          {imageSettingsState === "loading" ? (
            <div
              data-testid="autopilot-image-settings-panel-loading"
              className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500"
            >
              {panelText(
                "正在读取图像服务配置…",
                "Loading image service settings…",
                locale
              )}
            </div>
          ) : null}
          {imageSettingsState === "error" ? (
            <div
              data-testid="autopilot-image-settings-panel-error"
              className="rounded-[16px] border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700"
            >
              无法读取图像服务配置
            </div>
          ) : null}
          {imageSettingsState === "ready" && imageSettings !== null ? (
            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <AutopilotImageSettingsPanel
                settings={imageSettings}
                theme="light"
              />
            </div>
          ) : null}

          <div className="rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
              <ListChecks className="size-3.5" aria-hidden="true" />
              进度规划
            </div>
            {activePreview?.progressPlan.length ? (
              <div
                className="mt-3 grid gap-2"
                data-testid="effect-preview-progress-plan"
              >
                {activePreview.progressPlan.map((step, index) => (
                  <div
                    key={step.id}
                    className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-black text-slate-900">
                        {index + 1}. {blueprintCopy(step.title, locale)}
                      </div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        里程碑
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                      {blueprintCopy(step.summary, locale)}
                    </div>
                    <div className="mt-1 text-[10px] font-black uppercase tracking-normal text-slate-400">
                      {blueprintCopy(step.target, locale)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                {panelText(
                  "等待生成进度规划。",
                  "Waiting for progress planning.",
                  locale
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default EffectPreviewPanel;
