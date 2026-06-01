import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  FileSearch,
  Gauge,
  GitBranch,
  HelpCircle,
  Link2,
  Play,
  RefreshCw,
  Route,
  Send,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import autopilotHeaderLogoUrl from "../../../../docs/assets/logo.png";
import { Scene3D } from "@/components/Scene3D";
import { HoloDrawer } from "@/components/HoloDrawer";
import { MirofishThemeProvider } from "@/contexts/MirofishThemeContext";
import { useMirofishTheme } from "@/hooks/useMirofishTheme";
import { useMirofishMotionProps } from "@/hooks/useMirofishMotionProps";
import { PROJECTS_PATH, SPECS_PATH } from "@/components/navigation-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApiRequestError } from "@/lib/api-client";
import {
  createBlueprintClarificationSession,
  createBlueprintGenerationJob,
  createBlueprintIntake,
  fetchBlueprintProjectContext,
  fetchLatestBlueprintGenerationJob,
  normalizeBlueprintAgentCrew,
  normalizeBlueprintCapabilityEvidenceResponse,
  normalizeBlueprintCapabilityInvocationsResponse,
  normalizeBlueprintCapabilityRegistryResponse,
  normalizeBlueprintEffectPreviewsResponse,
  saveBlueprintClarificationAnswers,
  selectBlueprintRoute,
  type BlueprintAgentCrewSnapshot,
  type BlueprintCapabilityEvidence,
  type BlueprintCapabilityInvocation,
  type BlueprintEffectPreviewSnapshot,
  type BlueprintLatestGenerationJobSnapshot,
  type BlueprintRuntimeCapability,
} from "@/lib/blueprint-api";
import { blueprintCopy as translateBlueprintCopy } from "@/lib/blueprint-copy";
import { patchBlueprintIntake } from "@/lib/blueprint-api/intake";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import type { AppLocale } from "@/lib/locale";
import { useProjectStore } from "@/lib/project-store";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type {
  BlueprintClarificationAnswer,
  BlueprintClarificationReadiness,
  BlueprintClarificationSession,
  BlueprintGenerationArtifact,
  BlueprintGenerationArtifactType,
  BlueprintGenerationJob,
  BlueprintGenerationStage,
  BlueprintIntake,
  BlueprintProjectDomainContext,
  BlueprintRouteCandidate,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import {
  AutopilotRightRail,
  resolveRailSubStage,
  RightRailSubStageContext,
  useAutopilotRightRailData,
  useRightRailSubStageState,
  useViewportTier,
  type AutopilotRailSubStage,
  type RightRailDataView,
  type RightRailSubStageContextValue,
  type ViewportTier,
} from "./right-rail";
import { resolveRoleLabel } from "./right-rail/role-labels";
import {
  selectAutoAdvanceSubStage,
  useAutoAdvance,
} from "./right-rail/hooks/use-auto-advance";
import { useAutopilotSandboxBridge } from "./hooks/useAutopilotSandboxBridge";
import { TimelineNode } from "./right-rail/timeline";
import { StageSplitMount } from "./right-rail/StageSplitMount";
import { deriveStageSplitDescriptor } from "./right-rail/stage-split-descriptor/derive-stage-split-descriptor";
import { copyDynamic } from "./copy-dynamic";
import { AgentReasoningTimeline } from "@/components/blueprint/AgentReasoningTimeline";
import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import {
  getAutopilotPageForStage,
  useAutopilotCoordination,
  usePageTransitionChoreographer,
  useToastQueue,
  type AutopilotCoordinator,
  type AutopilotPage,
  type PageTransitionState,
} from "@/lib/autopilot-coordination";
import {
  getGithubPagesBlueprintDemoRuntime,
  type GithubPagesBlueprintDemoRuntime,
} from "./github-pages-blueprint-demo";
import { EditModeField, runInlineEditFlow } from "./stage-edit";
import {
  CompareView,
  HistoryEntryPoint,
  ReplanTimelineView,
  VersionTreeView,
  useFamilyData,
  useSwitchActiveJob,
  withActiveJobSearchParam,
  type VersionHistoryJob,
} from "./version-history";
import { resolveHistoryEntryFamilyCount } from "./right-rail/AutopilotRightRail";

const AUTOPILOT_HISTORY_OPEN_EVENT = "autopilot:history-open";

function resolveClientRouteHref(pathname: string): string {
  const base =
    import.meta.env.BASE_URL === "/"
      ? ""
      : import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function readAutopilotHistoryOpenFromLocation(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("history") === "1";
}

function readActiveHistoryJobIdFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("activeJob");
}

function updateAutopilotHistorySearch(
  updater: (url: URL) => void,
): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  updater(url);
  window.history.pushState({}, "", url);
}

function setAutopilotHistoryActiveJob(jobId: string): void {
  updateAutopilotHistorySearch(url => {
    url.search = withActiveJobSearchParam(url.search, jobId);
    url.searchParams.set("history", "1");
  });
}

function closeAutopilotHistorySearch(): void {
  updateAutopilotHistorySearch(url => {
    url.searchParams.delete("history");
    url.searchParams.delete("activeJob");
  });
}

function readLegacyClarificationSession(
  editResult: unknown,
): BlueprintClarificationSession | undefined {
  if (!editResult || typeof editResult !== "object") return undefined;
  return (editResult as { session?: BlueprintClarificationSession }).session;
}

export function resolveHistoryUrlSelectedJob(input: {
  requestedJobId: string | null;
  currentJobId: string;
  activeJob: VersionHistoryJob | undefined;
}): BlueprintGenerationJob | null {
  if (!input.requestedJobId || !input.activeJob) {
    return null;
  }
  if (input.activeJob.id !== input.requestedJobId) {
    return null;
  }
  if (input.currentJobId === input.requestedJobId) {
    return null;
  }
  return input.activeJob as BlueprintGenerationJob;
}

export function resolveHistoryActiveJobIdForCurrentJob(input: {
  requestedJobId: string | null;
  currentJobId: string;
  activeJobId: string | null;
}): string {
  if (!input.requestedJobId || input.requestedJobId === input.currentJobId) {
    return input.currentJobId;
  }
  return input.activeJobId ?? input.requestedJobId;
}

function PageTransitionWrapper({
  page,
  state,
  children,
}: {
  page: AutopilotPage;
  state: PageTransitionState;
  children: ReactNode;
}) {
  const direction = state.direction ?? "forward";
  const offset = direction === "forward" ? 24 : -24;
  const motionOverrides = useMirofishMotionProps();
  const isReduced = Object.keys(motionOverrides).length > 0;

  return (
    <div
      className="h-full min-w-0 overflow-hidden"
      data-testid="autopilot-page-transition-wrapper"
      data-page-transition-direction={state.direction ?? ""}
      data-page-transition-in-flight={state.inFlight ? "true" : "false"}
    >
      <AnimatePresence mode="sync" initial={false} custom={direction}>
        <motion.div
          key={page}
          custom={direction}
          initial={isReduced ? false : { x: offset, opacity: 0 }}
          animate={isReduced ? false : { x: 0, opacity: 1 }}
          exit={isReduced ? undefined : { x: -offset, opacity: 0 }}
          transition={isReduced ? { duration: 0 } : { duration: 0.18, ease: "easeInOut" }}
          className="h-full min-w-0"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function shouldUseNativeAnchorNavigation(
  event: MouseEvent<HTMLAnchorElement>
): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.currentTarget.target === "_blank"
  );
}

const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/i;

/**
 * Spec 5 Task 8 — Viewport_Tier 分支的 i18n 文案。
 *
 * - `drawerTrigger`：`<md` 下展开 drawer 的按钮文案
 * - `drawerTitle`：`<HoloDrawer>` 标题
 * - `expand / collapse`：`md-xl` 档右栏折叠按钮在两种状态下的文案
 */
const DRAWER_TIER_COPY: Record<
  AppLocale,
  {
    drawerTrigger: string;
    drawerTitle: string;
    expand: string;
    collapse: string;
  }
> = {
  "zh-CN": {
    drawerTrigger: "展开右栏",
    drawerTitle: "Autopilot 右栏",
    expand: "展开右栏",
    collapse: "折叠右栏",
  },
  "en-US": {
    drawerTrigger: "Expand rail",
    drawerTitle: "Autopilot rail",
    expand: "Expand rail",
    collapse: "Collapse rail",
  },
};

export type FlowStatus = "waiting" | "active" | "done" | "blocked";

type AutopilotWorkflowStage =
  | "input"
  | "clarification"
  | "routeset"
  | "selection"
  | "fabric";

interface FlowStep {
  id: string;
  index: number;
  title: string;
  detail: string;
  status: FlowStatus;
  icon: LucideIcon;
}

/**
 * Autopilot 控制台单行日志契约。
 *
 * 由 `buildConsoleLines(...)` 派生并被 `<AutopilotConsolePanel>` 渲染；同时也是
 * `right-rail/right-rail-console-routing.ts` 中 `routeConsoleLine()` 的输入类型。
 *
 * 导出动机：共享路由模块需要按 `channel` 字段决定一条控制台线属于
 * 系统流水、右栏补充流，还是双侧消费。为避免在路由模块里再造一份平行类型，
 * 这里把 `ConsoleLine` 提升为 page-level export，路由模块以 `import type`
 * 形式引用即可，不引入运行时依赖也不形成循环引用。
 */
export interface ConsoleLine {
  id: string;
  channel: string;
  message: string;
  tone?: "default" | "success" | "warning" | "danger";
  timestamp?: string;
}

function isClarificationReady(
  session: BlueprintClarificationSession | null,
  readiness: BlueprintClarificationReadiness | undefined
): boolean {
  if (!session) return false;
  return readiness?.status === "ready" || session.questions.length === 0;
}

function readAutopilotWorkflowStage({
  intake,
  clarificationSession,
  readiness,
  routeSet,
  selection,
}: {
  intake: BlueprintIntake | null;
  clarificationSession: BlueprintClarificationSession | null;
  readiness: BlueprintClarificationReadiness | undefined;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
}): AutopilotWorkflowStage {
  if (selection) return "fabric";
  if (routeSet) return "selection";
  if (isClarificationReady(clarificationSession, readiness)) return "routeset";
  if (intake) return "clarification";
  return "input";
}

function mapRailSubStageToCoordinationStage(
  subStage: AutopilotRailSubStage | undefined
): string | null {
  switch (subStage) {
    case undefined:
      return null;
    case "agent_crew_fabric":
      return "route_generation";
    case "spec_tree":
      return "spec_tree";
    case "effect_preview":
      return "effect_preview";
    case "prompt_package":
      return "prompt_packaging";
    case "runtime_capability":
      return "runtime_capability";
    case "engineering_handoff":
      return "engineering_handoff";
    case "artifact_memory":
      return "engineering_landing";
    default:
      return subStage satisfies never;
  }
}

export function resolveActiveAutopilotPage({
  workflowStageOverride,
  hasSelection,
  latestJobStage,
  effectiveSubStage,
}: {
  workflowStageOverride: AutopilotWorkflowStage | null;
  hasSelection: boolean;
  latestJobStage: string | null | undefined;
  effectiveSubStage: AutopilotRailSubStage | undefined;
}): AutopilotPage {
  if (workflowStageOverride === "input" || !hasSelection) {
    return 1;
  }

  const reviewPage = getAutopilotPageForStage(
    mapRailSubStageToCoordinationStage(effectiveSubStage)
  );
  if (reviewPage === 2) {
    return reviewPage;
  }

  const stagePage = getAutopilotPageForStage(latestJobStage);
  if (stagePage) {
    return stagePage;
  }

  return reviewPage ?? 1;
}

type AutopilotPageProjection = {
  visualJob: BlueprintGenerationJob | null;
  consoleJob: BlueprintGenerationJob | null;
  visualSpecTree: BlueprintSpecTree | null;
  visualAgentCrew: BlueprintAgentCrewSnapshot | null;
  visualCapabilities: BlueprintRuntimeCapability[];
  visualCapabilityInvocations: BlueprintCapabilityInvocation[];
  visualCapabilityEvidence: BlueprintCapabilityEvidence[];
  visualEffectPreviews: BlueprintEffectPreviewSnapshot[];
};

const PAGE_ONE_ARTIFACT_TYPES = new Set<BlueprintGenerationArtifactType>([
  "intake",
  "github_source",
  "clarification_session",
  "project_context",
  "route_set",
  "route_selection",
]);

const PAGE_TWO_ARTIFACT_TYPES = new Set<BlueprintGenerationArtifactType>([
  "spec_tree",
  "spec_tree_version",
  "requirements",
  "design",
  "tasks",
  "spec_document_version",
]);

const PAGE_ONE_EVENT_STAGES = new Set<string>([
  "input",
  "clarification",
  "route_generation",
  "route_selection",
]);

const PAGE_TWO_EVENT_STAGES = new Set<string>(["spec_tree", "spec_docs"]);

function projectJobForAutopilotPage(
  job: BlueprintGenerationJob | null,
  page: AutopilotPage
): BlueprintGenerationJob | null {
  if (!job || page === 3) {
    return job;
  }

  const stage: BlueprintGenerationStage =
    page === 1 ? "route_generation" : "spec_tree";
  const status = page === 1 ? "completed" : "reviewing";
  const allowedArtifacts =
    page === 1 ? PAGE_ONE_ARTIFACT_TYPES : PAGE_TWO_ARTIFACT_TYPES;
  const allowedEventStages =
    page === 1 ? PAGE_ONE_EVENT_STAGES : PAGE_TWO_EVENT_STAGES;

  return {
    ...job,
    status,
    stage,
    handoffState: page === 2 ? "reviewing" : undefined,
    artifacts: job.artifacts.filter((artifact: BlueprintGenerationArtifact) =>
      allowedArtifacts.has(artifact.type)
    ),
    events: job.events.filter(event => allowedEventStages.has(event.stage)),
    stageState: job.stageState
      ? {
          ...job.stageState,
          stage,
          status,
          artifactIds: job.stageState.artifactIds.filter(artifactId =>
            job.artifacts.some(
              artifact =>
                artifact.id === artifactId && allowedArtifacts.has(artifact.type)
            )
          ),
        }
      : undefined,
  };
}

export function resolveAutopilotPageProjection({
  activeAutopilotPage,
  latestJob,
  specTree,
  agentCrew,
  capabilities,
  capabilityInvocations,
  capabilityEvidence,
  effectPreviews,
}: {
  activeAutopilotPage: AutopilotPage;
  latestJob: BlueprintGenerationJob | null;
  specTree: BlueprintSpecTree | null;
  agentCrew: BlueprintAgentCrewSnapshot | null;
  capabilities: BlueprintRuntimeCapability[];
  capabilityInvocations: BlueprintCapabilityInvocation[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  effectPreviews: BlueprintEffectPreviewSnapshot[];
}): AutopilotPageProjection {
  if (activeAutopilotPage === 1) {
    const projectedJob = projectJobForAutopilotPage(latestJob, 1);
    return {
      visualJob: projectedJob,
      consoleJob: projectedJob,
      visualSpecTree: null,
      visualAgentCrew: null,
      visualCapabilities: [],
      visualCapabilityInvocations: [],
      visualCapabilityEvidence: [],
      visualEffectPreviews: [],
    };
  }

  if (activeAutopilotPage === 2) {
    const projectedJob = projectJobForAutopilotPage(latestJob, 2);
    return {
      visualJob: projectedJob,
      consoleJob: projectedJob,
      visualSpecTree: specTree,
      visualAgentCrew: agentCrew,
      visualCapabilities: [],
      visualCapabilityInvocations: [],
      visualCapabilityEvidence: [],
      visualEffectPreviews: [],
    };
  }

  return {
    visualJob: latestJob,
    consoleJob: latestJob,
    visualSpecTree: specTree,
    visualAgentCrew: agentCrew,
    visualCapabilities: capabilities,
    visualCapabilityInvocations: capabilityInvocations,
    visualCapabilityEvidence: capabilityEvidence,
    visualEffectPreviews: effectPreviews,
  };
}

function mapWorkflowStageToCoordinationStage(
  stage: AutopilotWorkflowStage | null,
  activeJobStage: string | null | undefined
): string | null {
  switch (stage) {
    case null:
      return null;
    case "input":
      return "input";
    case "clarification":
      return "clarification";
    case "routeset":
    case "selection":
      return "route_generation";
    case "fabric":
      return activeJobStage ?? "spec_tree";
    default:
      return stage satisfies never;
  }
}

function mapCoordinationStageToWorkflowStage(
  stage: string
): AutopilotWorkflowStage {
  return getAutopilotPageForStage(stage) === 1 ? "input" : "fabric";
}

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

function normalizeRoleNamePart(value: string | undefined): string {
  return value?.trim() ?? "";
}

function buildFullBlueprintRoleLabel(
  role: BlueprintAgentCrewSnapshot["roleTimelines"][number],
  locale: AppLocale
): string {
  const roleId = role.roleId.trim();
  const canonical = resolveRoleLabel(roleId, locale).trim();
  const englishCanonical = resolveRoleLabel(roleId, "en-US").trim();
  const displayName = normalizeRoleNamePart(role.displayName || role.roleName);
  const displayLabel = translateBlueprintCopy(
    role.displayLabel || role.displayName || role.roleName,
    locale
  ).trim();

  // The first nameplate row already shows the localized role type. The second
  // row should therefore show only the concrete role name/detail, not
  // "类型 / 名字" again.
  if (displayName && displayName !== roleId) return displayName;
  if (englishCanonical && englishCanonical !== roleId) return englishCanonical;
  if (displayLabel && displayLabel !== roleId && displayLabel !== canonical) {
    return displayLabel;
  }
  return canonical && canonical !== roleId ? canonical : roleId;
}

export function buildBlueprintRoleLabels(
  agentCrew: BlueprintAgentCrewSnapshot | null,
  locale: AppLocale
): Record<string, string> | undefined {
  const timelines = agentCrew?.roleTimelines ?? agentCrew?.presence ?? [];
  if (timelines.length === 0) return undefined;

  const labels: Record<string, string> = {};
  for (const role of timelines) {
    const roleId = role.roleId?.trim();
    if (!roleId) continue;

    const label = buildFullBlueprintRoleLabel(role, locale);
    if (label) labels[roleId] = label;
  }

  return Object.keys(labels).length ? labels : undefined;
}

function normalizeGithubUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function parseGithubInput(value: string): {
  urls: string[];
  duplicates: string[];
} {
  const seen = new Set<string>();
  const urls: string[] = [];
  const duplicates: string[] = [];

  value
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .forEach(item => {
      if (!GITHUB_URL_PATTERN.test(item)) return;
      const normalized = normalizeGithubUrl(item);
      if (seen.has(normalized)) {
        duplicates.push(item);
        return;
      }
      seen.add(normalized);
      urls.push(item);
    });

  return { urls, duplicates };
}

function stageLabel(value: string | undefined, locale: AppLocale): string {
  if (!value) return t(locale, "待机", "Standby");
  const labels: Record<string, { zh: string; en: string }> = {
    input: { zh: "输入", en: "Input" },
    clarification: { zh: "澄清", en: "Clarification" },
    route_generation: { zh: "路线生成", en: "Route generation" },
    spec_tree: { zh: "SPEC 树", en: "SPEC tree" },
    spec_docs: { zh: "SPEC 文档", en: "SPEC documents" },
    preview: { zh: "预演", en: "Preview" },
    effect_preview: { zh: "效果预演", en: "Effect preview" },
    prompt_packaging: { zh: "提示词打包", en: "Prompt packaging" },
    runtime_capability: { zh: "运行时能力", en: "Runtime capability" },
    engineering_handoff: { zh: "工程交接", en: "Engineering handoff" },
    engineering_landing: { zh: "工程落地", en: "Engineering landing" },
  };
  const label = labels[value];
  return label ? (locale === "zh-CN" ? label.zh : label.en) : value;
}

function statusLabel(value: string | undefined, locale: AppLocale): string {
  if (!value) return t(locale, "等待", "Waiting");
  const labels: Record<string, { zh: string; en: string }> = {
    pending: { zh: "等待", en: "Pending" },
    running: { zh: "进行中", en: "Running" },
    waiting: { zh: "等待确认", en: "Waiting" },
    reviewing: { zh: "评审交接", en: "Reviewing" },
    completed: { zh: "完成", en: "Completed" },
    failed: { zh: "失败", en: "Failed" },
    ready: { zh: "就绪", en: "Ready" },
    selected: { zh: "已选择", en: "Selected" },
    draft: { zh: "草稿", en: "Draft" },
    accepted: { zh: "已接受", en: "Accepted" },
    active: { zh: "活跃", en: "Active" },
    watching: { zh: "观察", en: "Watching" },
    sleeping: { zh: "休眠", en: "Sleeping" },
  };
  const label = labels[value];
  return label ? (locale === "zh-CN" ? label.zh : label.en) : value;
}

function levelLabel(value: string, locale: AppLocale): string {
  if (value === "low") return t(locale, "低", "Low");
  if (value === "medium") return t(locale, "中", "Medium");
  if (value === "high") return t(locale, "高", "High");
  return value;
}

export function countLabel(
  locale: AppLocale,
  count: number,
  zhUnit: string,
  enSingular: string,
  enPlural: string
): string {
  return locale === "zh-CN"
    ? `${count} ${zhUnit}`
    : `${count} ${count === 1 ? enSingular : enPlural}`;
}

function readReadinessLabel(
  readiness: BlueprintClarificationReadiness | undefined,
  locale: AppLocale
): string {
  if (!readiness) return t(locale, "等待澄清", "Waiting for clarification");
  const score = Math.round((readiness.score ?? 0) * 100);
  if (readiness.status === "ready") {
    return t(locale, `就绪 / ${score}%`, `Ready / ${score}%`);
  }
  return t(
    locale,
    `必答 ${readiness.answeredRequired}/${readiness.requiredTotal} / ${score}%`,
    `${readiness.answeredRequired}/${readiness.requiredTotal} required / ${score}%`
  );
}

function readClarificationSourceLabel(
  session: BlueprintClarificationSession | null,
  locale: AppLocale
): string {
  if (!session) return t(locale, "尚未生成", "Not generated");
  if (
    session.generationSource === "llm" ||
    session.questions.some(question => question.generationSource === "llm")
  ) {
    return t(locale, "LLM 已生成", "Generated by LLM");
  }
  if (
    session.generationSource === "llm_fallback" ||
    session.questions.some(
      question => question.generationSource === "llm_fallback"
    )
  ) {
    return t(locale, "LLM 失败后回退", "LLM fallback");
  }
  return session.questions.length > 0
    ? t(locale, "模板策略生成", "Template policy")
    : t(locale, "无需补充", "No extra input needed");
}

function readAutopilotJobStatus(
  job: BlueprintGenerationJob | null,
  locale: AppLocale
): string {
  if (!job) return t(locale, "RouteSet 尚未生成", "RouteSet not generated");
  if (job.stage === "spec_tree" && job.status === "reviewing") {
    return t(
      locale,
      "SPEC 树草稿等待评审",
      "SPEC tree draft waiting for review"
    );
  }
  return `${stageLabel(job.stage, locale)} / ${statusLabel(job.status, locale)}`;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readJobArtifactPayloads(
  job: BlueprintGenerationJob | null,
  type: BlueprintGenerationArtifactType
): unknown[] {
  if (!job) return [];
  return job.artifacts
    .filter(artifact => artifact.type === type)
    .map(artifact => artifact.payload)
    .filter(payload => payload !== undefined && payload !== null);
}

function readLatestJobArtifactPayload(
  job: BlueprintGenerationJob | null,
  type: BlueprintGenerationArtifactType
): unknown {
  return readJobArtifactPayloads(job, type).at(-1);
}

function readAutopilotAgentCrew(
  job: BlueprintGenerationJob | null
): BlueprintAgentCrewSnapshot | null {
  const crewPayload = readLatestJobArtifactPayload(job, "agent_crew");
  const crewRecord = asObjectRecord(crewPayload);
  if (!crewRecord) return normalizeBlueprintAgentCrew(crewPayload);

  const timelinePayload = readLatestJobArtifactPayload(job, "role_timeline");
  const timelineRecord = asObjectRecord(timelinePayload);
  const timelines = Array.isArray(timelineRecord?.timelines)
    ? timelineRecord.timelines
    : undefined;

  return normalizeBlueprintAgentCrew(
    timelines
      ? {
          ...crewRecord,
          roleTimelines: timelines,
          presence: timelines,
        }
      : crewRecord
  );
}

function readAutopilotCapabilities(
  job: BlueprintGenerationJob | null
): BlueprintRuntimeCapability[] {
  const registryPayload = readLatestJobArtifactPayload(
    job,
    "capability_registry"
  );
  if (!registryPayload) return [];
  return normalizeBlueprintCapabilityRegistryResponse(registryPayload)
    .capabilities;
}

function readAutopilotCapabilityInvocations(
  job: BlueprintGenerationJob | null
): BlueprintCapabilityInvocation[] {
  if (!job) return [];
  return normalizeBlueprintCapabilityInvocationsResponse(
    {
      job,
      invocations: readJobArtifactPayloads(job, "capability_invocation"),
    },
    job.id
  ).invocations;
}

function readAutopilotCapabilityEvidence(
  job: BlueprintGenerationJob | null
): BlueprintCapabilityEvidence[] {
  if (!job) return [];
  return normalizeBlueprintCapabilityEvidenceResponse(
    {
      job,
      evidence: readJobArtifactPayloads(job, "capability_evidence"),
    },
    job.id
  ).evidence;
}

function readAutopilotEffectPreviews(
  job: BlueprintGenerationJob | null
): BlueprintEffectPreviewSnapshot[] {
  if (!job) return [];
  return normalizeBlueprintEffectPreviewsResponse(
    {
      job,
      effectPreviews: readJobArtifactPayloads(job, "effect_preview"),
    },
    job.id
  ).effectPreviews;
}

export function readRoleStateCount(
  agentCrew: BlueprintAgentCrewSnapshot | null,
  state: string
): number {
  return (agentCrew?.roleTimelines ?? agentCrew?.presence ?? []).filter(
    role => role.state === state
  ).length;
}

function buildAnswersFromDrafts(
  session: BlueprintClarificationSession | null,
  answerDrafts: Record<string, string>
): BlueprintClarificationAnswer[] {
  if (!session) return [];
  return session.questions
    .map(question => ({
      questionId: question.id,
      answer: answerDrafts[question.id]?.trim() ?? "",
    }))
    .filter(item => item.answer.length > 0);
}

function buildFlowSteps({
  locale,
  intake,
  clarificationSession,
  readiness,
  routeSet,
  selection,
  specTree,
  agentCrew,
  effectPreviews,
}: {
  locale: AppLocale;
  intake: BlueprintIntake | null;
  clarificationSession: BlueprintClarificationSession | null;
  readiness: BlueprintClarificationReadiness | undefined;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  agentCrew: BlueprintAgentCrewSnapshot | null;
  effectPreviews: BlueprintEffectPreviewSnapshot[];
}): FlowStep[] {
  const workflowStage = readAutopilotWorkflowStage({
    intake,
    clarificationSession,
    readiness,
    routeSet,
    selection,
  });
  const clarificationReady = isClarificationReady(clarificationSession, readiness);

  return [
    {
      // 合并输入 + 澄清 + 路线生成 + 路线选择为一步。
      // 用户在这一步完成所有前置工作,选完路线后直接进入编组。
      id: "input",
      index: 1,
      title: t(locale, "输入", "Input"),
      detail: selection
        ? t(locale, "路线已选中", "Route selected")
        : routeSet
          ? t(locale, `${routeSet.routes.length} 条候选路线`, `${routeSet.routes.length} routes ready`)
          : clarificationReady
            ? t(locale, "澄清完成，等待路线", "Clarified; waiting for routes")
            : intake
              ? readReadinessLabel(readiness, locale) || t(locale, "澄清中", "Clarifying")
              : t(locale, "目标或 GitHub 地址", "Goal or GitHub URLs"),
      status: selection ? "done" : "active",
      icon: Link2,
    },
    {
      id: "fabric",
      index: 2,
      title: t(locale, "编组", "Fabric"),
      detail: agentCrew
        ? t(
            locale,
            `${agentCrew.roles.length} 个角色 / ${agentCrew.capabilityMatrix.length} 个能力绑定`,
            `${agentCrew.roles.length} roles / ${agentCrew.capabilityMatrix.length} bindings`
          )
        : t(locale, "等待角色与能力事件", "Waiting for role and capability events"),
      status: !selection
        ? "blocked"
        : workflowStage === "fabric"
          ? "active"
          : "done",
      icon: Bot,
    },
  ];
}

export function resolveVisibleWorkflowStepId(
  flowSteps: readonly Pick<FlowStep, "id" | "status">[],
  workflowStageOverride: AutopilotWorkflowStage | null
): string {
  if (
    workflowStageOverride !== null &&
    flowSteps.some(step => step.id === workflowStageOverride)
  ) {
    return workflowStageOverride;
  }

  return (
    flowSteps.find(step => step.status === "active")?.id ??
    flowSteps[flowSteps.length - 1]?.id ??
    "input"
  );
}

function ApiErrorNotice({
  error,
  className,
}: {
  error: ApiRequestError | null;
  className?: string;
}) {
  const isMirofish = useMirofishTheme();
  if (!error) return null;

  if (isMirofish) {
    return (
      <div
        className={cn(
          "border-l-4 border-l-black bg-white px-3 py-3 text-sm font-semibold text-black",
          className
        )}
        role="alert"
        data-testid="autopilot-api-error"
      >
        <div className="font-bold">{error.message}</div>
        <div className="mt-1 leading-5 text-black/70">{error.detail}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-800",
        className
      )}
      role="alert"
      data-testid="autopilot-api-error"
    >
      <div className="font-black">{error.message}</div>
      <div className="mt-1 leading-5 text-rose-700">{error.detail}</div>
    </div>
  );
}

export function MetricBox({
  label,
  value,
  tone = "neutral",
  dark = false,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "good" | "warn";
  dark?: boolean;
}) {
  const isMirofish = useMirofishTheme();

  if (isMirofish) {
    return (
      <div
        data-mf-card
        className="min-w-0 border border-[--mf-color-border] bg-[--mf-color-bg] px-3 py-2"
      >
        <div className="truncate font-[family-name:var(--mf-font-mono)] text-[10px] font-bold uppercase tracking-widest opacity-70">
          {label}
        </div>
        <div className="mt-1 truncate font-[family-name:var(--mf-font-mono)] text-sm font-bold">
          {value}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-w-0 rounded-[8px] border px-3 py-2",
        dark
          ? tone === "good"
            ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-50"
            : tone === "warn"
              ? "border-amber-300/20 bg-amber-400/10 text-amber-50"
              : "border-white/10 bg-white/5 text-white"
          : tone === "good"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : tone === "warn"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-slate-200 bg-white text-slate-700"
      )}
    >
      <div className="truncate text-[10px] font-black uppercase tracking-normal opacity-70">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-black">{value}</div>
    </div>
  );
}

function AutopilotLanguageSwitch({
  locale,
  onLocaleChange,
}: {
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
}) {
  // NOTE: This component is currently rendered in the topbar header which is
  // OUTSIDE the MirofishThemeProvider boundary. Therefore `isMirofish` will
  // always be `false` here. The MiroFish branch is retained as harmless dead
  // code and will activate when the topbar is brought into the provider scope
  // in a future batch.
  const isMirofish = useMirofishTheme();

  return (
    <div
      className={cn(
        "inline-flex p-1",
        isMirofish
          ? "border border-[--mf-color-border] rounded-[2px] bg-[--mf-color-bg]"
          : "rounded-[8px] border border-slate-200 bg-white"
      )}
      data-testid="autopilot-language-switch"
      aria-label={t(locale, "切换语言", "Switch language")}
    >
      {(
        [
          ["zh-CN", "中文"],
          ["en-US", "English"],
        ] as const
      ).map(([itemLocale, label]) => {
        const active = locale === itemLocale;
        return (
          <button
            key={itemLocale}
            type="button"
            className={cn(
              "min-h-8 px-3 text-xs transition",
              isMirofish
                ? cn(
                    "rounded-[0px] font-[family-name:var(--mf-font-mono)]",
                    active
                      ? "bg-black text-white"
                      : "bg-transparent text-black"
                  )
                : cn(
                    "rounded-[6px] font-black",
                    active
                      ? "bg-slate-950 text-white"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  )
            )}
            aria-pressed={active}
            onClick={() => onLocaleChange(itemLocale)}
            data-testid={`autopilot-language-${itemLocale}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * FlowStepIndicator — 流程步骤状态指示器。
 *
 * MiroFish 变体使用 ■ (U+25A0) 表示 done/active 状态，□ (U+25A1) 表示 waiting/blocked 状态。
 * 非 MiroFish 作用域下渲染原始彩色圆形图标。
 *
 * @see Requirements 8.4
 */
export function FlowStepIndicator({
  status,
  icon: Icon,
}: {
  status: FlowStatus;
  icon?: LucideIcon;
}) {
  const isMirofish = useMirofishTheme();

  if (isMirofish) {
    const isFilledState = status === "done" || status === "active";
    const symbol = isFilledState ? "\u25A0" : "\u25A1";
    const opacity = status === "active" ? "opacity-100" : "opacity-60";
    return (
      <span
        className={`font-[family-name:var(--mf-font-mono)] text-sm ${opacity}`}
        data-testid="flow-step-indicator"
        data-status={status}
        aria-label={status}
      >
        {symbol}
      </span>
    );
  }

  // Original colored circle icon rendering
  const colorClass =
    status === "done"
      ? "text-emerald-500"
      : status === "active"
        ? "text-blue-500"
        : status === "blocked"
          ? "text-rose-400"
          : "text-slate-300";

  return (
    <span
      className={`inline-flex items-center justify-center ${colorClass}`}
      data-testid="flow-step-indicator"
      data-status={status}
      aria-label={status}
    >
      {Icon ? (
        <Icon className="size-4" aria-hidden="true" />
      ) : (
        <span className="inline-block size-2.5 rounded-full bg-current" />
      )}
    </span>
  );
}

function AutopilotMissionHud({
  locale,
  job,
  routeSet,
  selection,
  specTree,
  agentCrew,
  effectPreviews,
  capabilityEvidence,
  className,
}: {
  locale: AppLocale;
  job: BlueprintGenerationJob | null;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  agentCrew: BlueprintAgentCrewSnapshot | null;
  effectPreviews: BlueprintEffectPreviewSnapshot[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  className?: string;
}) {
  const preview = effectPreviews[0] ?? null;
  const hudState = preview?.runtimeProjection?.hudState;
  const activeRoles = readRoleStateCount(agentCrew, "active");
  const reviewingRoles = readRoleStateCount(agentCrew, "reviewing");

  return (
    <aside
      className={cn(
        "rounded-[12px] border border-white/10 bg-slate-950/82 px-4 py-4 text-white shadow-[0_24px_64px_rgba(2,6,23,0.34)] backdrop-blur-xl",
        className
      )}
      data-testid="autopilot-mission-hud"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-white/70">
          <Gauge className="size-3.5" aria-hidden="true" />
          {t(locale, "运行 HUD", "Runtime HUD")}
        </div>
        <span className="rounded-[6px] border border-white/15 bg-white/10 px-2 py-1 text-[10px] font-black text-white/75">
          {job ? stageLabel(job.stage, locale) : t(locale, "待机", "Standby")}
        </span>
      </div>

      <div className="mt-3 line-clamp-2 text-base font-black leading-6">
        {copyDynamic(
          locale,
          hudState?.title ||
            selection?.routeTitle ||
            t(locale, "等待 RouteSet 驱动 HUD", "Waiting for RouteSet")
        )}
      </div>
      <p className="mt-2 line-clamp-3 text-xs font-semibold leading-5 text-white/65">
        {copyDynamic(
          locale,
          hudState?.summary ||
            (specTree
              ? t(
                  locale,
                  "SPEC 交接态已进入 HUD；后续预演会继续绑定 3D、日志和浏览器预览。",
                  "SPEC handoff is in the HUD; previews continue binding 3D, logs, and browser preview."
                )
              : t(
                  locale,
                  "输入、澄清、路线与角色事件会在这里汇总成可见状态。",
                  "Input, clarification, routes, and role events roll up here."
                ))
        )}
        {/*
          autopilot-spec-tree-workbench（2026-05-17）：当后端 stage 是
          spec_docs 时,前端把 spec_docs 投影到 spec_tree 卡片（resolveRailSubStage
          已做映射）；HUD 摘要在此阶段追加一行说明,与"spec_tree 卡片高亮但
          stage 写着 spec_docs"的视觉差消歧。
        */}
        {job?.stage === "spec_docs" ? (
          <span className="block text-[10px] font-semibold text-white/50">
            {t(
              locale,
              "正在为整棵 SPEC 树生成文档...",
              "Generating documents for the full SPEC tree..."
            )}
          </span>
        ) : null}
      </p>

      {/*
        Spec 5 布局校准:4 个指标卡(3D 场景 / AgentCrewFabric / RouteSet / 证据)从
        HUD 浮层搬到 <AutopilotRightRail> 底部,HUD 浮层仅保留主标题 + 摘要叙事,
        避免场景右上角遮挡 3D 画面。
      */}
    </aside>
  );
}

function AutopilotVisualStage({
  locale,
  currentProjectId,
  job,
  latestSceneJobId,
  routeSet,
  selection,
  specTree,
  agentCrew,
  effectPreviews,
  capabilityEvidence,
  consoleLines,
}: {
  locale: AppLocale;
  currentProjectId: string | null;
  job: BlueprintGenerationJob | null;
  latestSceneJobId?: string | null;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  agentCrew: BlueprintAgentCrewSnapshot | null;
  effectPreviews: BlueprintEffectPreviewSnapshot[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  consoleLines: ConsoleLine[];
}) {
  const blueprintRoleLabels = useMemo(
    () => buildBlueprintRoleLabels(agentCrew, locale),
    [agentCrew, locale]
  );

  return (
    // 自动驾驶 3D 场景融合 follow-up（2026-05-13 v10 去边框去边距）：
    // visual stage / console panel / 外包 div 移除 rounded / border / gap，
    // 让 3D 场景与 console 紧贴页面边缘 + 列边界，最大化可视面积。
    <div className="grid xl:flex xl:h-full xl:min-h-0 xl:flex-col">
      <section
        className="min-h-0 overflow-hidden bg-slate-950 xl:flex-1"
        data-testid="autopilot-visual-stage"
      >
        <div
          className="relative min-h-[520px] overflow-hidden bg-slate-950 xl:h-full xl:min-h-0"
          data-testid="autopilot-scene-visual"
          data-autopilot-stage={job?.stage ?? "input"}
          data-autopilot-route-state={
            selection ? "selected" : routeSet ? "generated" : "pending"
          }
          data-autopilot-crew-state={agentCrew ? "ready" : "pending"}
        >
          <div className="pointer-events-none absolute inset-0">
            <Scene3D
              performanceProfile="balanced"
              projectId={currentProjectId}
              mode="blueprint"
              blueprintJob={job}
              activeJobId={job?.id}
              latestJobId={latestSceneJobId ?? job?.id}
              activeStage={job?.stage}
              roleLabels={blueprintRoleLabels}
            />
          </div>
        </div>
      </section>

      {/* Console panel occupies the left-stage bottom area directly:
          no mini fold, no floating rounded wrapper, and no stage-switch reset. */}
      <AutopilotConsolePanel
        locale={locale}
        lines={consoleLines}
        embedded
        className="h-[320px] w-full shrink-0 !bg-slate-950 shadow-none backdrop-blur-0"
      />
    </div>
  );
}

function ProjectContextSummary({
  locale,
  context,
}: {
  locale: AppLocale;
  context: BlueprintProjectDomainContext | null;
}) {
  if (!context) {
    return (
      <div
        className="rounded-[8px] border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-500"
        data-testid="autopilot-project-context"
      >
        {t(
          locale,
          "项目上下文会在选择项目或输入记录返回后挂接。",
          "Project context attaches after project selection or intake response."
        )}
      </div>
    );
  }

  return (
    <div
      className="grid gap-2 sm:grid-cols-3"
      data-testid="autopilot-project-context"
    >
      <MetricBox
        label={t(locale, "资产", "Assets")}
        value={context.assets.length}
        tone="good"
      />
      <MetricBox label={t(locale, "证据", "Evidence")} value={context.evidence.length} />
      <MetricBox label={t(locale, "输入记录", "Intakes")} value={context.intakeIds.length} />
    </div>
  );
}

function IntakeSummary({
  locale,
  intake,
}: {
  locale: AppLocale;
  intake: BlueprintIntake | null;
}) {
  if (!intake) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-500">
        {t(
          locale,
          "先创建输入记录，系统会把目标、GitHub 源和证据归一化。",
          "Create an intake first; the system normalizes goals, GitHub sources, and evidence."
        )}
      </div>
    );
  }

  const duplicateUrls = intake.duplicateGithubUrls.map(
    source => source.url || source.normalizedUrl || source.id
  );

  return (
    <div className="grid gap-2" data-testid="autopilot-intake-summary">
      <div className="grid gap-2 sm:grid-cols-3">
        <MetricBox label={t(locale, "输入记录", "Intake")} value={intake.id} />
        <MetricBox
          label={t(locale, "来源", "Sources")}
          value={intake.sources.length}
          tone="good"
        />
        <MetricBox
          label={t(locale, "重复", "Duplicates")}
          value={duplicateUrls.length}
          tone={duplicateUrls.length > 0 ? "warn" : "neutral"}
        />
      </div>

      {intake.sources.slice(0, 3).map(source => (
        <div
          key={source.id}
          className="flex min-w-0 items-start gap-2 rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2"
          data-mf-card
        >
          <GitBranch className="mt-0.5 size-4 shrink-0 text-slate-500" />
          <div className="min-w-0">
            <div className="truncate text-xs font-black text-slate-800">
              {source.slug || `${source.owner}/${source.repo}`}
            </div>
            <div className="mt-0.5 break-all text-[10px] font-semibold text-slate-500">
              {source.normalizedUrl || source.url}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ClarificationPanel({
  locale,
  session,
  answerDrafts,
  onAnswerChange,
  onSubmit,
  inlineEdit,
  saving,
}: {
  locale: AppLocale;
  session: BlueprintClarificationSession | null;
  answerDrafts: Record<string, string>;
  onAnswerChange: (questionId: string, answer: string) => void;
  onSubmit: () => void;
  inlineEdit?: {
    enabled: boolean;
    onSubmitAnswer: (questionId: string, answer: string) => Promise<void>;
    isStaticPreview: boolean;
    isAdvancingThroughStage: boolean;
    isViewingCompletedStage: boolean;
  };
  saving: boolean;
}) {
  if (!session) {
    return (
      <div className="rounded-[8px] border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-500">
        {t(
          locale,
          "生成澄清后，问题会出现在这里，并且提交状态会写入下方控制台。",
          "Generate clarifications; questions appear here and submit state is written to the console."
        )}
      </div>
    );
  }

  if (session.questions.length === 0) {
    return (
      <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs font-black text-emerald-800">
        {t(locale, "当前没有阻塞性澄清项。", "No blocking clarification items.")}
      </div>
    );
  }

  const draftAnswerCount = session.questions.filter(
    question => (answerDrafts[question.id] ?? "").trim().length > 0
  ).length;
  const requiredTotal = session.questions.filter(
    question => question.required
  ).length;
  const requiredAnswered = session.questions.filter(
    question =>
      question.required && (answerDrafts[question.id] ?? "").trim().length > 0
  ).length;
  const submittedAnswerByQuestionId = new Map(
    session.answers.map(answer => [answer.questionId, answer.answer.trim()])
  );
  const pendingChangeCount = session.questions.filter(question => {
    const draft = (answerDrafts[question.id] ?? "").trim();
    const submitted = submittedAnswerByQuestionId.get(question.id) ?? "";
    return draft !== submitted;
  }).length;
  const missingRequiredCount = Math.max(requiredTotal - requiredAnswered, 0);
  const canSubmit = draftAnswerCount > 0 && pendingChangeCount > 0 && !saving;
  const isPartiallySubmitted =
    session.answers.length > 0 && missingRequiredCount > 0;

  return (
    <div className="grid gap-3" data-testid="autopilot-clarification-list">
      <div className="space-y-3">
        {session.questions.map(question => (
          <label
            key={question.id}
            className="grid gap-2 rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-3"
          >
            <span className="flex flex-wrap items-center gap-2 text-sm font-black text-slate-800">
              {copyDynamic(locale, question.prompt)}
              {question.required ? (
                <span className="rounded-[6px] bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
                  {t(locale, "必答", "Required")}
                </span>
              ) : null}
            </span>
            {question.context ? (
              <span className="text-xs font-semibold leading-5 text-slate-500">
                {copyDynamic(locale, question.context)}
              </span>
            ) : null}
            {question.options && question.options.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {question.options.map(option => {
                  const active = answerDrafts[question.id] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      className={cn(
                        "border px-3 py-1.5 font-mono text-[12px] font-bold uppercase tracking-[0.06em] transition-colors",
                        active
                          ? "border-[#FF4500] bg-[#FF4500] text-white"
                          : "border-[#E5E5E5] bg-white text-black hover:border-black"
                      )}
                      style={{ borderRadius: "0px" }}
                      onClick={() => onAnswerChange(question.id, option)}
                      data-testid={`autopilot-answer-option-${question.id}`}
                    >
                      {copyDynamic(locale, option)}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <textarea
              value={answerDrafts[question.id] ?? ""}
              onChange={event => onAnswerChange(question.id, event.target.value)}
              className="min-h-[74px] resize-y border border-[#E5E5E5] bg-white px-3 py-2 font-mono text-[13px] leading-6 text-black outline-none transition focus:border-black focus:ring-1 focus:ring-black"
              style={{ borderRadius: "0px" }}
              placeholder={t(
                locale,
                "填写这条路线规划问题的答案",
                "Answer this route planning question"
              )}
              data-testid={`autopilot-answer-${question.id}`}
            />
            {inlineEdit?.enabled ? (
              <EditModeField
                value={answerDrafts[question.id] ?? ""}
                onSubmit={(value) =>
                  inlineEdit.onSubmitAnswer(question.id, value)
                }
                canEdit
                impactSummary={{ downstreamCount: 1 }}
                fieldKey={`clarification-${question.id}`}
                fromStage="clarification"
                isAdvancingThroughStage={inlineEdit.isAdvancingThroughStage}
                isStaticPreview={inlineEdit.isStaticPreview}
                isViewingCompletedStage={inlineEdit.isViewingCompletedStage}
                label={t(locale, "澄清答案", "Clarification answer")}
                placeholder={t(
                  locale,
                  "填写这条路线规划问题的答案",
                  "Answer this route planning question"
                )}
              />
            ) : null}
          </label>
        ))}
      </div>

      <div
        className="rounded-[8px] border border-slate-200 bg-white px-3 py-3"
        data-testid="autopilot-clarification-submit-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black text-slate-900">
              {isPartiallySubmitted
                ? t(
                    locale,
                    `还需回答 ${missingRequiredCount} 个必答问题`,
                    `${missingRequiredCount} required answer${missingRequiredCount === 1 ? "" : "s"} still needed`
                  )
                : pendingChangeCount > 0
                ? t(locale, "等待提交澄清", "Clarification changes pending")
                : session.answers.length > 0
                  ? t(locale, "澄清已提交", "Clarifications submitted")
                  : t(locale, "选择或填写答案", "Choose or write answers")}
            </div>
            <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
              {t(
                locale,
                `已填写 ${draftAnswerCount}/${session.questions.length}，必答 ${requiredAnswered}/${requiredTotal}，未提交变更 ${pendingChangeCount}`,
                `${draftAnswerCount}/${session.questions.length} answered, ${requiredAnswered}/${requiredTotal} required, ${pendingChangeCount} pending changes`
              )}
            </div>
          </div>
          <Button
            type="button"
            className="group relative gap-2 rounded-none border border-black bg-black px-5 py-3 font-mono font-bold uppercase tracking-[1px] text-white shadow-[rgba(0,0,0,0.06)_0_0_0_4px] transition-all duration-300 hover:-translate-y-[2px] hover:border-[#FF4500] hover:bg-[#FF4500] disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-black"
            disabled={!canSubmit}
            onClick={onSubmit}
            data-testid="autopilot-submit-clarifications-button"
          >
            {saving ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : pendingChangeCount === 0 && session.answers.length > 0 ? (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {saving
              ? t(locale, "提交中", "Submitting")
              : isPartiallySubmitted
                ? t(locale, "继续补充", "Continue answering")
              : pendingChangeCount === 0 && session.answers.length > 0
                ? t(locale, "已提交", "Submitted")
                : t(locale, "提交澄清", "Submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RouteOption({
  locale,
  route,
  primary,
  selected,
  selecting,
  onSelect,
}: {
  locale: AppLocale;
  route: BlueprintRouteCandidate;
  primary: boolean;
  selected: boolean;
  selecting: boolean;
  onSelect: (routeId: string) => void;
}) {
  return (
    <article
      className={cn(
        "border bg-white px-4 py-4 transition-colors",
        selected
          ? "border-[#FF4500] bg-[#FFF7F2]"
          : "border-[#E5E5E5] hover:border-black"
      )}
      style={{ borderRadius: "0px" }}
      data-mf-card
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="line-clamp-2 font-display text-base font-medium tracking-tight text-black">
              {copyDynamic(locale, route.title)}
            </h3>
            <span
              className="border border-[#E5E5E5] bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[#666]"
              style={{ borderRadius: "0px" }}
            >
              {primary ? t(locale, "主路线", "Primary") : t(locale, "备选", "Alternative")}
            </span>
            {selected ? (
              <span
                className="bg-[#FF4500] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-white"
                style={{ borderRadius: "0px" }}
              >
                {t(locale, "已选择", "Selected")}
              </span>
            ) : null}
          </div>
          <p className="mt-2 line-clamp-3 text-[13px] font-normal leading-6 text-[#666]">
            {copyDynamic(locale, route.summary)}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="default"
          className={cn(
            "group relative shrink-0 gap-2 rounded-none border px-4 py-2 font-mono font-bold uppercase tracking-[1px] transition-all duration-300 disabled:opacity-50",
            selected
              ? "border-[#FF4500] bg-white text-[#FF4500] hover:bg-white"
              : "border-black bg-black text-white shadow-[rgba(0,0,0,0.06)_0_0_0_4px] hover:-translate-y-[2px] hover:border-[#FF4500] hover:bg-[#FF4500]"
          )}
          disabled={selected || selecting}
          onClick={() => onSelect(route.id)}
          data-testid={`autopilot-select-route-${route.id}`}
        >
          {selecting ? (
            <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
          ) : selected ? (
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
          ) : (
            <Route className="size-3.5" aria-hidden="true" />
          )}
          {selected ? t(locale, "已选", "Selected") : t(locale, "选择", "Select")}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <MetricBox label={t(locale, "风险", "Risk")} value={levelLabel(route.riskLevel, locale)} />
        <MetricBox label={t(locale, "成本", "Cost")} value={levelLabel(route.costLevel, locale)} />
        <MetricBox label={t(locale, "投入", "Effort")} value={copyDynamic(locale, route.estimatedEffort)} />
      </div>
    </article>
  );
}

function AutopilotVersionHistoryPanel({
  locale,
  job,
  disableRemoteFetch,
  onClose,
  coordinator,
  onJobSelected,
}: {
  locale: AppLocale;
  job: BlueprintGenerationJob;
  disableRemoteFetch: boolean;
  onClose: () => void;
  coordinator?: AutopilotCoordinator;
  onJobSelected: (job: BlueprintGenerationJob) => void;
}) {
  const [activeJobId, setActiveJobId] = useState<string>(
    () => readActiveHistoryJobIdFromLocation() ?? job.id
  );
  const familyState = useFamilyData({
    jobId: job.id,
    disableRemoteFetch,
  });

  useEffect(() => {
    setActiveJobId(current =>
      resolveHistoryActiveJobIdForCurrentJob({
        requestedJobId: readActiveHistoryJobIdFromLocation(),
        currentJobId: job.id,
        activeJobId: current,
      })
    );
  }, [job.id]);

  const jobs = useMemo<VersionHistoryJob[]>(() => {
    const familyJobs = familyState.data?.jobs ?? [];
    return (familyJobs.length > 0 ? familyJobs : [job]) as VersionHistoryJob[];
  }, [familyState.data?.jobs, job]);
  const familyJobIds = useMemo(() => jobs.map(item => item.id), [jobs]);
  const activeJob =
    jobs.find(candidate => candidate.id === activeJobId) ?? jobs[0] ?? job;
  const rootJob =
    jobs.find(candidate => candidate.id === familyState.data?.rootJobId) ??
    jobs[0] ??
    job;
  const replanEvents =
    familyState.data?.replanEvents ??
    jobs.flatMap(candidate => candidate.events ?? []);
  const appliedHistoryJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    const selectedJob = resolveHistoryUrlSelectedJob({
      requestedJobId: readActiveHistoryJobIdFromLocation(),
      currentJobId: job.id,
      activeJob,
    });
    if (!selectedJob) return;
    if (appliedHistoryJobIdRef.current === selectedJob.id) return;

    appliedHistoryJobIdRef.current = selectedJob.id;
    onJobSelected(selectedJob);
  }, [activeJob, job.id, onJobSelected]);

  const selectJob = useSwitchActiveJob({
    jobs,
    coordinator,
    apply: ({ jobId }) => {
      const selectedJob = jobs.find(candidate => candidate.id === jobId);
      if (!selectedJob) return;
      setActiveJobId(jobId);
      setAutopilotHistoryActiveJob(jobId);
      appliedHistoryJobIdRef.current = jobId;
      onJobSelected(selectedJob);
    },
  });

  return (
    <section
      className="min-w-0 rounded-[8px] border border-slate-200 bg-white px-3 py-3"
      data-testid="autopilot-version-history-panel"
      data-history-status={familyState.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-black text-slate-900">
            {t(locale, "版本历史", "Version history")}
          </div>
          <div className="text-xs font-semibold text-slate-500">
            {familyState.loading
              ? t(locale, "正在加载 family...", "Loading family...")
              : t(
                  locale,
                  `Family ${familyJobIds.length} 个 job`,
                  `${familyJobIds.length} family job(s)`
                )}
          </div>
        </div>
        <button
          type="button"
          className="rounded-[6px] border border-slate-200 px-2 py-1 text-xs font-black text-slate-600 hover:bg-slate-50"
          onClick={onClose}
          data-testid="autopilot-history-close"
        >
          {t(locale, "关闭", "Close")}
        </button>
      </div>

      {familyState.status === "static_unsupported" ? (
        <div
          className="mt-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
          data-testid="autopilot-history-static-preview"
        >
          {t(
            locale,
            "静态预览使用当前 job 快照展示历史入口。",
            "Static preview uses the current job snapshot for history."
          )}
        </div>
      ) : null}

      {familyState.error ? (
        <div
          className="mt-2 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800"
          role="alert"
        >
          {familyState.error.message}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3">
        <VersionTreeView
          jobs={jobs}
          activeJobId={activeJob.id}
          onSelectJob={jobId => {
            void selectJob(jobId);
          }}
        />
        <ReplanTimelineView events={replanEvents} />
        <CompareView
          leftJob={rootJob}
          rightJob={activeJob}
          familyJobIds={familyJobIds}
        />
      </div>
    </section>
  );
}

function AutopilotWorkflowRail({
  locale,
  targetText,
  setTargetText,
  githubInput,
  setGithubInput,
  parsedGithub,
  intake,
  projectContext,
  loadingContext,
  clarificationSession,
  readiness,
  answerDrafts,
  routeSet,
  selection,
  specTree,
  latestJob,
  selectingRouteId,
  creatingIntake,
  generatingClarifications,
  savingAnswers,
  generatingRouteSet,
  canCreateIntake,
  canGenerateRouteSet,
  agentCrew,
  capabilities,
  capabilityInvocations,
  capabilityEvidence,
  effectPreviews,
  flowSteps,
  onCreateIntake,
  onGenerateClarifications,
  onAnswerChange,
  onSubmitTargetEdit,
  onSubmitGithubUrlEdit,
  onSubmitClarificationEdit,
  onSubmitRouteSelectionEdit,
  onSubmitAnswers,
  onGenerateRouteSet,
  onSelectRoute,
  apiError,
  rightRailView,
  fabricSubStage,
  subStageContext,
  viewportTier,
  drawerOpen,
  onDrawerOpenChange,
  rightRailCollapsed,
  onRightRailCollapsedChange,
  pageTransitionState,
  activeAutopilotPage,
  coordinator,
  onForceAdvance,
  autoAdvancing,
  autoAdvancingTo,
  workflowStageOverride,
  onNavigateWorkflowStage,
  onJobUpdated,
  onHistoryJobSelected,
  onBranchJobActivated,
  onHistoryPanelClosed,
  onSpecDocumentsGenerated,
  generateSpecDocuments,
}: {
  locale: AppLocale;
  targetText: string;
  setTargetText: (value: string) => void;
  githubInput: string;
  setGithubInput: (value: string) => void;
  parsedGithub: { urls: string[]; duplicates: string[] };
  intake: BlueprintIntake | null;
  projectContext: BlueprintProjectDomainContext | null;
  loadingContext: boolean;
  clarificationSession: BlueprintClarificationSession | null;
  readiness: BlueprintClarificationReadiness | undefined;
  answerDrafts: Record<string, string>;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  latestJob: BlueprintGenerationJob | null;
  selectingRouteId: string | null;
  creatingIntake: boolean;
  generatingClarifications: boolean;
  savingAnswers: boolean;
  generatingRouteSet: boolean;
  canCreateIntake: boolean;
  canGenerateRouteSet: boolean;
  agentCrew: BlueprintAgentCrewSnapshot | null;
  capabilities: BlueprintRuntimeCapability[];
  capabilityInvocations: BlueprintCapabilityInvocation[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  effectPreviews: BlueprintEffectPreviewSnapshot[];
  flowSteps: FlowStep[];
  onCreateIntake: () => void;
  onGenerateClarifications: () => void;
  onAnswerChange: (questionId: string, answer: string) => void;
  onSubmitTargetEdit: (value: string) => Promise<void>;
  onSubmitGithubUrlEdit: (sourceIndex: number, value: string) => Promise<void>;
  onSubmitClarificationEdit: (
    questionId: string,
    answer: string
  ) => Promise<void>;
  onSubmitRouteSelectionEdit: (routeId: string) => Promise<void>;
  onSubmitAnswers: () => void;
  onGenerateRouteSet: () => void;
  onSelectRoute: (routeId: string) => void;
  apiError: ApiRequestError | null;
  /**
   * Spec 4 Task 9：fabric 阶段右栏数据层 hook 视图。
   *
   * `AutopilotWorkflowRail` 的 fabric 分支会消费 `rightRailView.XXX.data` 作为
   * `<AutopilotRightRail>` 9 个 props 的数据源，替代直接读 `latestJob / routeSet /
   * selection / specTree / agentCrew / capabilities / capabilityInvocations /
   * capabilityEvidence / effectPreviews`。其它阶段（input / clarification / routeset /
   * selection / projection）不消费该 prop，继续沿用现有派生值。
   *
   * 由父组件计算并传入的原因：hook 不能在条件分支里调用（违反 Rules of Hooks）。
   * 预先在 `AutopilotRoutePage` 顶层调用，再以 view 形态向下透传最符合最小改动原则。
   */
  rightRailView: RightRailDataView;
  /**
   * Spec 4 Task 9：预先由父组件通过 `resolveRailSubStage({ currentStage: "fabric",
   * ... })` 算好的 fabric 子阶段。fabric 分支直接用它作为 `<AutopilotRightRail>` 的
   * `currentSubStage` prop，避免在 render 期间重复调用 resolver。
   *
   * Spec 5 Task 7 校准：当父组件同时传入 `subStageContext` 时，`<AutopilotRightRail>`
   * 的 `currentSubStage` 取 `subStageContext.effectiveSubStage`；`fabricSubStage` 继续
   * 保留以兼容非 Spec 5 注入路径（例如未来单测通过静态 props 渲染）。
   */
  fabricSubStage: AutopilotRailSubStage | undefined;
  /**
   * Spec 5 Task 7：`useRightRailSubStageState` 的返回值。
   *
   * - `effectiveSubStage` 用作 `<AutopilotRightRail>` 的 `currentSubStage` 权威源；
   * - `setPinnedSubStage` 包装为 `onSubStageChange` 回调；
   * - 整体通过 `<RightRailSubStageContext.Provider>` 注入，`<AutopilotRightRail>` 内部
   *   通过 `useRightRailSubStageContext()` 读取 `isPinned / togglePin` 等（Task 6 的
   *   sticky toggle 与 Task 4 的键盘快捷键依赖此 Context）。
   */
  subStageContext: RightRailSubStageContextValue;
  /**
   * Spec 5 Task 8：`useViewportTier()` 计算出的当前响应式档位。
   *
   * 由父组件在顶层调用 `useViewportTier()` 后透传，保证 tier 在全组件树共享一个口径。
   * sub-component 根据此值决定渲染三档：drawer / side-collapsible / side-fixed。
   */
  viewportTier: ViewportTier;
  /**
   * Spec 5 Task 8：drawer 模式下的 open state（由父组件持有，便于 tier 切换时自动关闭）。
   */
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  /**
   * Spec 5 Task 8：side-collapsible 模式下右栏折叠 state。
   */
  rightRailCollapsed: boolean;
  onRightRailCollapsedChange: (collapsed: boolean) => void;
  pageTransitionState: PageTransitionState;
  activeAutopilotPage: AutopilotPage;
  coordinator: AutopilotCoordinator;
  onForceAdvance: () => void;
  autoAdvancing: boolean;
  autoAdvancingTo: string | null;
  workflowStageOverride: AutopilotWorkflowStage | null;
  onNavigateWorkflowStage: (nextStage: AutopilotWorkflowStage) => void;
  onJobUpdated: (job: BlueprintGenerationJob) => void;
  onHistoryJobSelected?: (job: BlueprintGenerationJob) => void;
  onBranchJobActivated?: (job: BlueprintGenerationJob) => void;
  onHistoryPanelClosed?: () => void | Promise<void>;
  /**
   * autopilot-spec-tree-workbench（2026-05-17）：
   * SpecTreeWorkbench 在 spec_tree 卡片内部成功调
   * generateBlueprintSpecDocuments 后,通过此回调把 BlueprintSpecDocumentsResponse
   * 上抬到 AutopilotRoutePage 主体让 setLatestJob 等更新本地 state。
   */
  onSpecDocumentsGenerated?: (
    response: import("@shared/blueprint/contracts").BlueprintSpecDocumentsResponse
  ) => void;
  generateSpecDocuments?: GithubPagesBlueprintDemoRuntime["generateSpecDocuments"];
}) {
  const primaryRoute =
    routeSet?.routes.find(route => route.id === routeSet.primaryRouteId) ??
    routeSet?.routes[0] ??
    null;
  const alternativeRoutes =
    routeSet?.routes.filter(route => route.id !== primaryRoute?.id) ?? [];
  const activeStepId = resolveVisibleWorkflowStepId(
    flowSteps,
    workflowStageOverride
  );
  const activeStepIndex = Math.max(
    flowSteps.findIndex(step => step.id === activeStepId),
    0
  );
  const [historyPanelOpen, setHistoryPanelOpen] = useState(() =>
    readAutopilotHistoryOpenFromLocation()
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncHistoryOpen = () => {
      setHistoryPanelOpen(readAutopilotHistoryOpenFromLocation());
    };
    window.addEventListener("popstate", syncHistoryOpen);
    window.addEventListener(AUTOPILOT_HISTORY_OPEN_EVENT, syncHistoryOpen);
    syncHistoryOpen();
    return () => {
      window.removeEventListener("popstate", syncHistoryOpen);
      window.removeEventListener(AUTOPILOT_HISTORY_OPEN_EVENT, syncHistoryOpen);
    };
  }, []);
  const handleCloseHistoryPanel = useCallback(() => {
    closeAutopilotHistorySearch();
    setHistoryPanelOpen(false);
    void onHistoryPanelClosed?.();
  }, [onHistoryPanelClosed]);
  const railStepLabel = (step: FlowStep): string => {
    switch (step.id) {
      case "input":
        return t(locale, "输入", "Input");
      case "fabric":
        return t(locale, "编组", "Fabric");
      default:
        return step.title;
    }
  };

  const renderActiveStepBody = () => {
    const clarificationReady = isClarificationReady(clarificationSession, readiness);
    switch (activeStepId) {
      case "input": {
        // 输入步骤流式时间线:4 个子阶段
        //
        // autopilot-streaming-experience integration-gap-2026-05-16：
        // 历史版本把"路线生成"和"路线选择"拆成两个独立子阶段，但用户反馈这两个
        // 阶段语义高度重合（都是围绕同一个 RouteSet：先看到路线、再选一条），
        // 拆开会让卡片冗余、视觉上干扰主线。本次合并为单一"路线"子阶段：
        //   - 未选中前（routeSet 已生成但没有 selection）：展示路线列表 + 选择按钮
        //   - 选中后（selection 存在）：自身仍处于 active 状态，承接选完路线后
        //     spec_tree 派生过程的进度事件（stageId="route"），让用户能看到
        //     "我选了路线之后系统在做什么"，避免出现"选完就什么都没了"的断层。
        type InputSub = "target_input" | "intake_created" | "clarification" | "route";
        const INPUT_SUBS: InputSub[] = ["target_input", "intake_created", "clarification", "route"];

        // 判定当前活跃子阶段
        let activeInputSub: InputSub = "target_input";
        if (routeSet || selection || generatingRouteSet || clarificationReady) activeInputSub = "route";
        else if (intake && clarificationSession) activeInputSub = "clarification";
        else if (intake) activeInputSub = "intake_created";

        const activeInputIndex = INPUT_SUBS.indexOf(activeInputSub);

        const inputSubTitles: Record<InputSub, string> = {
          target_input: t(locale, "目标输入", "Target input"),
          intake_created: t(locale, "输入记录", "Intake record"),
          clarification: t(locale, "澄清", "Clarification"),
          route: t(locale, "路线", "Route"),
        };

        return (
          <div className="space-y-0" data-testid="autopilot-preflight">
            {INPUT_SUBS.map((sub, idx) => {
              const isCompleted = idx < activeInputIndex;
              const isActive = idx === activeInputIndex;
              const isFuture = idx > activeInputIndex;
              const status = isCompleted ? "completed" : isActive ? "active" : "future";

              // 构造摘要
              const summaryObj = {
                title: inputSubTitles[sub],
                apiPath:
                  sub === "target_input"
                    ? "POST /api/blueprint/intake"
                    : sub === "clarification"
                      ? "POST /api/blueprint/clarifications"
                      : sub === "route"
                        ? "POST /api/blueprint/jobs · POST /api/blueprint/route-selection"
                        : "",
                summary: "",
                metrics: [{ label: "-", value: "-" }, { label: "-", value: "-" }, { label: "-", value: "-" }] as [{ label: string; value: string | number }, { label: string; value: string | number }, { label: string; value: string | number }],
                dataReady: isCompleted || isActive,
              };

              return (
                <TimelineNode key={sub} index={idx} status={status} summary={summaryObj}>
                  {/*
                    autopilot-streaming-experience integration-gap-2026-05-16 wave 3：
                    isCompleted 不再折叠成简略，而是把 active 时同一组组件保留下来，
                    用户切到下一个子阶段后还能在历史卡片里看到当时输入 / 回答 / 拉取
                    的完整详情。子时间线（AgentReasoningSubTimeline）按 stageId 过滤，
                    历史卡片只显示自身阶段产生的事件，不会跨阶段串。
                  */}
                  {isCompleted && sub === "target_input" && (
                    <div className="mt-2 space-y-3">
                      <EditModeField
                        value={targetText}
                        onSubmit={onSubmitTargetEdit}
                        canEdit
                        impactSummary={{ downstreamCount: 3 }}
                        fieldKey="target-text"
                        fromStage="input"
                        isAdvancingThroughStage={autoAdvancing}
                        isStaticPreview={IS_GITHUB_PAGES}
                        isViewingCompletedStage={Boolean(selection)}
                        label={t(locale, "目标输入", "Target input")}
                      />
                      {/*
                        autopilot-streaming-experience integration-gap-2026-05-16：
                        历史版本会在此分支再渲染一遍 "GitHub 来源" 列表，但下一张
                        "输入记录" 卡片里的 IntakeSummary 已经把同一组 GitHub URL
                        以归一化形式（slug + normalizedUrl）展示给用户。这里再列
                        一次只会让用户感觉"目标被显示了两遍"，因此 target_input
                        历史卡片只保留用户原始输入文本，不重复列 GitHub URL。
                      */}
                    </div>
                  )}
                  {isCompleted && sub === "intake_created" && intake && (
                    <div className="mt-2 space-y-2">
                      <IntakeSummary locale={locale} intake={intake} />
                      <ProjectContextSummary locale={locale} context={projectContext} />
                      {/*
                        autopilot-streaming-experience integration-gap-2026-05-16：
                        仓库扫描事件 stageId 已改为 "intake_created"，因此这里要
                        挂载子时间线，让用户在历史卡片里看到当时仓库扫描的
                        thinking / observing 流。
                      */}
                      <StageSplitMount
                        descriptor={deriveStageSplitDescriptor({
                          sub: "intake_created",
                          locale,
                          isActive: false,
                          isCompleted: true,
                          intake,
                          projectContext,
                          clarificationSession,
                          readiness,
                          routeSet,
                          selection,
                          specTree,
                          job: latestJob,
                        })}
                        job={latestJob}
                        locale={locale}
                        variant="completed"
                      />
                    </div>
                  )}
                  {isCompleted && sub === "clarification" && (
                    <div className="mt-2 space-y-2">
                      <div className="text-xs text-slate-500">{readReadinessLabel(readiness, locale)}</div>
                      <ClarificationPanel
                        locale={locale}
                        session={clarificationSession}
                        answerDrafts={answerDrafts}
                        onAnswerChange={onAnswerChange}
                        onSubmit={onSubmitAnswers}
                        saving={savingAnswers}
                        inlineEdit={{
                          enabled: Boolean(selection),
                          onSubmitAnswer: onSubmitClarificationEdit,
                          isStaticPreview: IS_GITHUB_PAGES,
                          isAdvancingThroughStage: autoAdvancing,
                          isViewingCompletedStage: Boolean(selection),
                        }}
                      />
                      <StageSplitMount
                        descriptor={deriveStageSplitDescriptor({
                          sub: "clarification",
                          locale,
                          isActive: false,
                          isCompleted: true,
                          intake,
                          projectContext,
                          clarificationSession,
                          readiness,
                          routeSet,
                          selection,
                          specTree,
                          job: latestJob,
                        })}
                        job={latestJob}
                        locale={locale}
                        variant="completed"
                      />
                    </div>
                  )}
                  {isCompleted && sub === "route" && routeSet && (
                    <div className="mt-2 space-y-2">
                      <div className="text-xs text-slate-500">
                        {selection
                          ? t(locale, `已选择路线：${selection.routeTitle ?? selection.routeId}`, `Selected route: ${selection.routeTitle ?? selection.routeId}`)
                          : t(locale, `${routeSet.routes.length} 条路线`, `${routeSet.routes.length} routes`)}
                      </div>
                      <div className="space-y-1">
                        {primaryRoute && <RouteOption locale={locale} route={primaryRoute} primary selected={selection?.routeId === primaryRoute.id} selecting={false} onSelect={onSubmitRouteSelectionEdit} />}
                        {alternativeRoutes.map(route => <RouteOption key={route.id} locale={locale} route={route} primary={false} selected={selection?.routeId === route.id} selecting={false} onSelect={onSubmitRouteSelectionEdit} />)}
                      </div>
                      {/*
                        autopilot-streaming-experience integration-gap-2026-05-16：
                        合并后的"路线"卡片承接三段后端 stage：
                          - route_generation：路线生成 routeEmitter
                          - route_selection：路线选择确认（暂无 emitter，但保留 stageId 兼容）
                          - spec_tree：选完路线后系统派生 SPEC 树的 thinking / observing
                        让历史卡片与 active 状态一致地展示完整执行流。
                      */}
                      <StageSplitMount
                        descriptor={deriveStageSplitDescriptor({
                          sub: "route",
                          locale,
                          isActive: false,
                          isCompleted: true,
                          intake,
                          projectContext,
                          clarificationSession,
                          readiness,
                          routeSet,
                          selection,
                          specTree,
                          job: latestJob,
                        })}
                        job={latestJob}
                        locale={locale}
                        variant="completed"
                      />
                    </div>
                  )}

                  {/* 活跃节点交互内容 */}
                  {isActive && sub === "target_input" && (
                    <div className="mt-2 space-y-3">
                      <label className="grid gap-1.5">
                        <span className="text-xs font-black text-slate-700">{t(locale, "执行目标 / GitHub 地址", "Goal / GitHub URLs")}</span>
                        <textarea value={targetText} onChange={e => setTargetText(e.target.value)} className="min-h-[100px] resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-slate-900/40 focus:ring-2 focus:ring-slate-900/10" placeholder={t(locale, "描述目标，可直接粘贴 GitHub 地址（每行一个）", "Describe your goal. Paste GitHub URLs directly (one per line).")} data-testid="autopilot-target-input" />
                      </label>
                      <Button type="button" className="w-full gap-2 rounded-lg bg-slate-900 font-bold text-white hover:bg-slate-700" disabled={!canCreateIntake || creatingIntake} onClick={onCreateIntake} data-testid="autopilot-create-intake-button">
                        {creatingIntake ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : <Link2 className="size-4" aria-hidden="true" />}
                        {intake ? t(locale, "刷新输入记录", "Refresh intake") : t(locale, "创建输入记录", "Create intake")}
                      </Button>
                      {/* Requirement 2.1: target_input active-state mount — ensures
                          the two-column split panel is visible even before intake exists */}
                      <StageSplitMount
                        descriptor={deriveStageSplitDescriptor({
                          sub: "target_input",
                          locale,
                          isActive: true,
                          isCompleted: false,
                          intake,
                          projectContext,
                          clarificationSession,
                          readiness,
                          routeSet,
                          selection,
                          specTree,
                          job: latestJob,
                        })}
                        job={latestJob}
                        locale={locale}
                        variant="active"
                      />
                    </div>
                  )}

                  {isActive && sub === "intake_created" && (
                    <div className="mt-2 space-y-2">
                      <IntakeSummary locale={locale} intake={intake} />
                      <ProjectContextSummary locale={locale} context={projectContext} />
                      {/*
                        autopilot-streaming-experience integration-gap-2026-05-16：
                        intake_created 阶段在 POST /api/blueprint/clarifications
                        被实际执行（仓库扫描发生在生成澄清问题之前），因此 active
                        时也要挂子时间线，让用户实时看到仓库扫描进度。
                      */}
                      <StageSplitMount
                        descriptor={deriveStageSplitDescriptor({
                          sub: "intake_created",
                          locale,
                          isActive: true,
                          isCompleted: false,
                          intake,
                          projectContext,
                          clarificationSession,
                          readiness,
                          routeSet,
                          selection,
                          specTree,
                          job: latestJob,
                        })}
                        job={latestJob}
                        locale={locale}
                        variant="active"
                      />
                    </div>
                  )}

                  {isActive && sub === "clarification" && (
                    <div className="mt-2 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant="outline" className="gap-2 rounded-lg border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50" disabled={!intake || generatingClarifications} onClick={onGenerateClarifications} data-testid="autopilot-generate-clarifications-button">
                          {generatingClarifications ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : <HelpCircle className="size-4" aria-hidden="true" />}
                          {clarificationSession ? t(locale, "刷新澄清", "Refresh") : t(locale, "生成澄清", "Generate")}
                        </Button>
                        <span className={cn("rounded-md px-2 py-1 text-[10px] font-bold", readiness?.status === "ready" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")} data-testid="autopilot-readiness">{readReadinessLabel(readiness, locale)}</span>
                      </div>
                      <ClarificationPanel
                        locale={locale}
                        session={clarificationSession}
                        answerDrafts={answerDrafts}
                        onAnswerChange={onAnswerChange}
                        onSubmit={onSubmitAnswers}
                        saving={savingAnswers}
                        inlineEdit={{
                          enabled: Boolean(selection),
                          onSubmitAnswer: onSubmitClarificationEdit,
                          isStaticPreview: IS_GITHUB_PAGES,
                          isAdvancingThroughStage: autoAdvancing,
                          isViewingCompletedStage: Boolean(selection),
                        }}
                      />
                      <StageSplitMount
                        descriptor={deriveStageSplitDescriptor({
                          sub: "clarification",
                          locale,
                          isActive: true,
                          isCompleted: false,
                          intake,
                          projectContext,
                          clarificationSession,
                          readiness,
                          routeSet,
                          selection,
                          specTree,
                          job: latestJob,
                        })}
                        job={latestJob}
                        locale={locale}
                        variant="active"
                      />
                    </div>
                  )}

                  {isActive && sub === "route" && (
                    <div className="mt-2 space-y-3">
                      {/*
                        路线阶段在 active 时分两种形态：
                        1) 路线尚未生成（routeSet === null）：显示"等待 / 生成中"占位 + spinner
                        2) 路线已生成但未选中：列出主路线 + 备选路线，等待用户点选
                        3) 路线已选中（selection 存在）：显示选中卡片高亮，子时间线
                           承接 spec_tree 派生过程的 thinking / observing 事件
                      */}
                      {!routeSet && (
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          {generatingRouteSet
                            ? <><RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />{t(locale, "正在生成路线...", "Generating routes...")}</>
                            : t(locale, "等待路线生成", "Waiting for routes")}
                        </div>
                      )}
                      {routeSet && (
                        <div className="space-y-2">
                          <div className="text-xs text-slate-500">
                            {selection
                              ? t(locale, "路线已选中，正在派生 SPEC 树...", "Route selected, deriving SPEC tree...")
                              : t(locale, "选中一条路线后系统将派生 SPEC 树。", "Select a route and the system will derive the SPEC tree.")}
                          </div>
                          {primaryRoute && <RouteOption locale={locale} route={primaryRoute} primary selected={selection?.routeId === primaryRoute.id} selecting={selectingRouteId === primaryRoute.id} onSelect={selection ? onSubmitRouteSelectionEdit : onSelectRoute} />}
                          {alternativeRoutes.map(route => <RouteOption key={route.id} locale={locale} route={route} primary={false} selected={selection?.routeId === route.id} selecting={selectingRouteId === route.id} onSelect={selection ? onSubmitRouteSelectionEdit : onSelectRoute} />)}
                        </div>
                      )}
                      {/*
                        子时间线 stageFilter 数组形态同时承接：
                          - route_generation：路线生成阶段（POST /api/blueprint/jobs 的 routeEmitter）
                          - route_selection：路线选择确认（保留 stageId 兼容，暂无独立 emitter）
                          - spec_tree：选完路线后 buildSpecTreeFromRouteSet 的 LLM 推导
                        因此 active 状态下用户从"看路线"到"选路线"再到"系统派生 SPEC"
                        都能在同一卡片底部看到对应的事件流，不会出现断层。
                      */}
                      <StageSplitMount
                        descriptor={deriveStageSplitDescriptor({
                          sub: "route",
                          locale,
                          isActive: true,
                          isCompleted: false,
                          intake,
                          projectContext,
                          clarificationSession,
                          readiness,
                          routeSet,
                          selection,
                          specTree,
                          job: latestJob,
                        })}
                        job={latestJob}
                        locale={locale}
                        variant="active"
                      />
                    </div>
                  )}
                </TimelineNode>
              );
            })}
          </div>
        );
      }
      case "fabric": {
        // Spec 5 Task 8 — Viewport_Tier 三档分支。
        // - drawer（<md）：右列不渲染；drawer trigger + <HoloDrawer> 包裹
        // - side-collapsible（md-xl）：顶部 collapse toggle；collapsed 时隐藏
        // - side-fixed（≥xl）：Spec 3 现状，不显示 trigger / toggle
        const tier = viewportTier;
        const drawerCopy = DRAWER_TIER_COPY[locale] ?? DRAWER_TIER_COPY["en-US"];
        const autoAdvanceSubStage = selectAutoAdvanceSubStage(
          autoAdvancingTo ?? ""
        );
        const railElement = (
          <RightRailSubStageContext.Provider value={subStageContext}>
            <AutopilotRightRail
              jobId={rightRailView.job.data?.id ?? latestJob?.id ?? ""}
              currentStage="fabric"
              currentSubStage={
                autoAdvanceSubStage ??
                subStageContext.effectiveSubStage ??
                fabricSubStage
              }
              job={rightRailView.job.data}
              routeSet={rightRailView.routeSet.data}
              selection={rightRailView.selection.data}
              specTree={rightRailView.specTree.data}
              agentCrew={rightRailView.agentCrew.data}
              capabilities={rightRailView.capabilities.data ?? []}
              capabilityInvocations={
                rightRailView.capabilityInvocations.data ?? []
              }
              capabilityEvidence={rightRailView.capabilityEvidence.data ?? []}
              effectPreviews={rightRailView.effectPreviews.data ?? []}
              locale={locale}
              coordinator={coordinator}
              onSubStageChange={subStageContext.setPinnedSubStage}
              onNavigateWorkflowStage={onNavigateWorkflowStage}
              onStageAdvanced={onForceAdvance}
              onJobUpdated={onJobUpdated}
              onBranchJobActivated={onBranchJobActivated}
              generateSpecDocuments={generateSpecDocuments}
              onSpecDocumentsGenerated={response => {
                // autopilot-spec-tree-workbench（2026-05-17）：
                // SpecTreeWorkbench 在卡片内部调
                // generateBlueprintSpecDocuments 完成后通过此回调把响应抬到
                // AutopilotRoutePage 主体（onSpecDocumentsGenerated prop），
                // 由它调用 setLatestJob(response.job) 用新返回值更新；右栏
                // 数据 hook (rightRailView.job) 在 setLatestJob 后会感知到
                // 新的 job 状态并重算 specTree / specDocuments 派生。
                onSpecDocumentsGenerated?.(response);
                // 触发右栏数据层重新拉一次 W1 snapshot，让 stage 推进
                // (例如 spec_docs → effect_preview) 通过 useAutoAdvance
                // 立即生效。
                onForceAdvance();
              }}
            />
          </RightRailSubStageContext.Provider>
        );
        return (
          <div className="grid gap-3" data-testid="autopilot-fabric-step">
            {historyPanelOpen && latestJob ? (
              <AutopilotVersionHistoryPanel
                locale={locale}
                job={latestJob}
                disableRemoteFetch={IS_GITHUB_PAGES}
                onClose={handleCloseHistoryPanel}
                coordinator={coordinator}
                onJobSelected={selectedJob => {
                  onNavigateWorkflowStage("fabric");
                  (onHistoryJobSelected ?? onJobUpdated)(selectedJob);
                }}
              />
            ) : null}
            {/* Drawer tier：触发按钮 + <HoloDrawer> */}
            {tier === "drawer" ? (
              <>
                <button
                  type="button"
                  data-testid="autopilot-right-rail-drawer-trigger"
                  onClick={() => onDrawerOpenChange(true)}
                  className="rounded border border-border px-3 py-1 text-xs"
                >
                  {drawerCopy.drawerTrigger}
                </button>
                <HoloDrawer
                  open={drawerOpen}
                  onClose={() => onDrawerOpenChange(false)}
                  title={drawerCopy.drawerTitle}
                  width={400}
                >
                  <MirofishThemeProvider enabled>
                  <div data-testid="autopilot-right-rail-drawer">
                    {railElement}
                  </div>
                  </MirofishThemeProvider>
                </HoloDrawer>
              </>
            ) : null}

            {/* Side-collapsible tier：顶部折叠按钮 */}
            {tier === "side-collapsible" ? (
              <button
                type="button"
                data-testid="autopilot-right-rail-collapse-toggle"
                aria-expanded={!rightRailCollapsed}
                onClick={() => onRightRailCollapsedChange(!rightRailCollapsed)}
                className="rounded border border-border px-3 py-1 text-xs"
              >
                {rightRailCollapsed
                  ? drawerCopy.expand
                  : drawerCopy.collapse}
              </button>
            ) : null}

            {/* Side tiers：railElement 直接在行内渲染（collapsed 时隐藏） */}
            {tier !== "drawer" ? (
              <div
                className={
                  tier === "side-collapsible" && rightRailCollapsed
                    ? "hidden"
                    : undefined
                }
              >
                {railElement}
              </div>
            ) : null}

            {/* Batch 5: fabric sub-stage unified split mounts.
                spec_tree is intentionally skipped here because the
                AutopilotRightRail workbench owns its execution/artifact strip.
                Rendering the generic StageSplitMount as well duplicates the
                same "执行流 / SPEC 产物" block below the workbench. */}

            {(subStageContext.effectiveSubStage ?? fabricSubStage) === "effect_preview" && (
              <StageSplitMount
                descriptor={deriveStageSplitDescriptor({
                  sub: "effect_preview",
                  locale,
                  isActive: true,
                  isCompleted: false,
                  intake,
                  projectContext,
                  clarificationSession,
                  readiness,
                  routeSet,
                  selection,
                  specTree,
                  job: rightRailView.job.data ?? latestJob,
                })}
                job={rightRailView.job.data ?? latestJob}
                locale={locale}
                variant="active"
              />
            )}

            {(subStageContext.effectiveSubStage ?? fabricSubStage) === "prompt_package" && (
              <StageSplitMount
                descriptor={deriveStageSplitDescriptor({
                  sub: "prompt_package",
                  locale,
                  isActive: true,
                  isCompleted: false,
                  intake,
                  projectContext,
                  clarificationSession,
                  readiness,
                  routeSet,
                  selection,
                  specTree,
                  job: rightRailView.job.data ?? latestJob,
                })}
                job={rightRailView.job.data ?? latestJob}
                locale={locale}
                variant="active"
              />
            )}

            {(subStageContext.effectiveSubStage ?? fabricSubStage) === "runtime_capability" && (
              <StageSplitMount
                descriptor={deriveStageSplitDescriptor({
                  sub: "runtime_capability",
                  locale,
                  isActive: true,
                  isCompleted: false,
                  intake,
                  projectContext,
                  clarificationSession,
                  readiness,
                  routeSet,
                  selection,
                  specTree,
                  job: rightRailView.job.data ?? latestJob,
                })}
                job={rightRailView.job.data ?? latestJob}
                locale={locale}
                variant="active"
              />
            )}

            {(subStageContext.effectiveSubStage ?? fabricSubStage) === "engineering_handoff" && (
              <StageSplitMount
                descriptor={deriveStageSplitDescriptor({
                  sub: "engineering_handoff",
                  locale,
                  isActive: true,
                  isCompleted: false,
                  intake,
                  projectContext,
                  clarificationSession,
                  readiness,
                  routeSet,
                  selection,
                  specTree,
                  job: rightRailView.job.data ?? latestJob,
                })}
                job={rightRailView.job.data ?? latestJob}
                locale={locale}
                variant="active"
              />
            )}

            {(subStageContext.effectiveSubStage ?? fabricSubStage) === "artifact_memory" && (
              <StageSplitMount
                descriptor={deriveStageSplitDescriptor({
                  sub: "artifact_memory",
                  locale,
                  isActive: true,
                  isCompleted: false,
                  intake,
                  projectContext,
                  clarificationSession,
                  readiness,
                  routeSet,
                  selection,
                  specTree,
                  job: rightRailView.job.data ?? latestJob,
                })}
                job={rightRailView.job.data ?? latestJob}
                locale={locale}
                variant="active"
              />
            )}

            {(subStageContext.effectiveSubStage ?? fabricSubStage) === "agent_crew_fabric" && (
              <StageSplitMount
                descriptor={deriveStageSplitDescriptor({
                  sub: "agent_crew_fabric",
                  locale,
                  isActive: true,
                  isCompleted: false,
                  intake,
                  projectContext,
                  clarificationSession,
                  readiness,
                  routeSet,
                  selection,
                  specTree,
                  job: rightRailView.job.data ?? latestJob,
                })}
                job={rightRailView.job.data ?? latestJob}
                locale={locale}
                variant="active"
              />
            )}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <aside
      className="grid min-w-0 content-start xl:h-full xl:max-h-full xl:overflow-y-auto xl:overflow-x-hidden"
      data-testid="autopilot-workflow-rail"
      data-mf-surface
      style={{
        // 硬约束 aside 宽度。父级 grid track 是 minmax(0, 1fr)，但 grid item
        // 的 min-width: auto 默认会让 item 的最小宽度 = min-content。当内部
        // markdown 长行 / 多 tab 等内容存在时，min-content 会把整个 aside
        // 撑大到内容总宽度（曾出现过 15364px）。
        // 仅锁定宽度方向；垂直滚动由 className 的 xl:overflow-y-auto 承担，
        // 这里不能再用 inline overflow: hidden（inline 优先级会覆盖 class，
        // 导致 aside 内部超出视口的内容无法纵向滚动）。
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      <section
        className="min-w-0 h-full bg-white"
        data-testid="autopilot-workflow-steps"
        data-mf-card
        style={{ borderRadius: "0px" }}
      >
        {/*
          2026-05-19：移除顶部 antd Steps 横向步骤条（输入 / 编组 两步）。
          阶段进度信号已经在 StageHeader 内的 StageProgressIndicator
          (6 圆点 + 进度条) 中完整呈现，再保留 antd Steps 与 STEP 05 标题
          视觉重复，且占用首屏宝贵空间。flowSteps 仍保留供 buildConsoleLines
          / consoleLines 派生使用，不删除 useMemo 计算。
        */}
        <div
          className="h-full p-2"
          data-testid={`autopilot-step-${activeStepId}`}
        >
          <PageTransitionWrapper
            page={activeAutopilotPage}
            state={pageTransitionState}
          >
            {renderActiveStepBody()}
          </PageTransitionWrapper>
        </div>
      </section>

      <ApiErrorNotice error={apiError} />
    </aside>
  );
}

function buildConsoleLines({
  locale,
  intake,
  clarificationSession,
  latestJob,
  routeSet,
  selection,
  specTree,
  capabilityInvocations,
  capabilityEvidence,
  effectPreviews,
  apiError,
}: {
  locale: AppLocale;
  intake: BlueprintIntake | null;
  clarificationSession: BlueprintClarificationSession | null;
  latestJob: BlueprintGenerationJob | null;
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  capabilityInvocations: BlueprintCapabilityInvocation[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  effectPreviews: BlueprintEffectPreviewSnapshot[];
  apiError: ApiRequestError | null;
}): ConsoleLine[] {
  const lines: ConsoleLine[] = [
    {
      id: "boot",
      channel: "autopilot.boot",
      message: t(
        locale,
        "工作台已就绪，等待输入、澄清、路线和资产事件。",
        "Workbench is ready for input, clarification, route, and asset events."
      ),
    },
  ];

  if (intake) {
    lines.push({
      id: "intake",
      channel: "intake.created",
      message: t(
        locale,
        `记录输入 ${intake.id}，来源 ${intake.sources.length} 个，证据 ${intake.evidence.length} 条。`,
        `Recorded intake ${intake.id}, ${intake.sources.length} source(s), ${intake.evidence.length} evidence item(s).`
      ),
      tone: "success",
    });
  }

  if (clarificationSession) {
    lines.push({
      id: "clarification",
      channel: "clarification.session",
      message: t(
        locale,
        `${readClarificationSourceLabel(
          clarificationSession,
          locale
        )}，问题 ${clarificationSession.questions.length} 个，答案 ${clarificationSession.answers.length} 条。`,
        `${readClarificationSourceLabel(
          clarificationSession,
          locale
        )}, ${clarificationSession.questions.length} question(s), ${clarificationSession.answers.length} answer(s).`
      ),
      tone:
        clarificationSession.answers.length > 0 || clarificationSession.questions.length === 0
          ? "success"
          : "warning",
    });
  }

  if (latestJob) {
    lines.push({
      id: "job",
      channel: "job.stage",
      message: `${readAutopilotJobStatus(latestJob, locale)} · ${latestJob.id}`,
      tone: latestJob.status === "failed" ? "danger" : "default",
    });

    latestJob.events.slice(-5).forEach(event => {
      lines.push({
        id: event.id,
        channel: event.type,
        message: copyDynamic(locale, event.message),
        timestamp: event.occurredAt,
        tone: event.status === "failed" ? "danger" : undefined,
      });
    });
  }

  if (routeSet) {
    lines.push({
      id: "routeset",
      channel: "route.set",
      message: t(
        locale,
        `RouteSet ${routeSet.id} 已生成，包含 ${routeSet.routes.length} 条候选路线。`,
        `RouteSet ${routeSet.id} generated with ${routeSet.routes.length} route candidates.`
      ),
      tone: "success",
    });
  }

  if (selection) {
    lines.push({
      id: "selection",
      channel: "route.selection",
      message: t(
        locale,
        `已选择 ${copyDynamic(locale, selection.routeTitle)}，进入 SPEC 树评审交接。`,
        `Selected ${copyDynamic(locale, selection.routeTitle)} and entered SPEC tree review handoff.`
      ),
      tone: "success",
    });
  }

  if (specTree) {
    lines.push({
      id: "spec-tree",
      channel: "spec.tree",
      message: t(
        locale,
        `SPEC 树 ${specTree.id} 已创建，节点 ${specTree.nodes.length} 个。`,
        `SPEC tree ${specTree.id} created with ${specTree.nodes.length} node(s).`
      ),
      tone: "success",
    });
  }

  capabilityInvocations.slice(-3).forEach(invocation => {
    lines.push({
      id: invocation.id,
      channel: "capability.invocation",
      message: t(
        locale,
        `${copyDynamic(locale, invocation.capabilityLabel)} · ${statusLabel(
          invocation.status,
          locale
        )}`,
        `${invocation.capabilityLabel} · ${statusLabel(invocation.status, locale)}`
      ),
      tone: invocation.status === "failed" ? "danger" : "default",
    });
  });

  if (capabilityEvidence.length > 0) {
    lines.push({
      id: "evidence",
      channel: "capability.evidence",
      message: t(
        locale,
        `${capabilityEvidence.length} 条运行时证据已记录。`,
        `${capabilityEvidence.length} runtime evidence item(s) recorded.`
      ),
      tone: "success",
    });
  }

  const preview = effectPreviews[0];
  if (preview) {
    lines.push({
      id: "preview",
      channel: "preview.projection",
      message: t(
        locale,
        `HUD 进度 ${preview.runtimeProjection.hudState.progressPercent}%；日志 ${preview.runtimeProjection.logTimeline.length} 条。`,
        `HUD progress ${preview.runtimeProjection.hudState.progressPercent}%; ${preview.runtimeProjection.logTimeline.length} log item(s).`
      ),
      tone: "success",
    });
  }

  if (apiError) {
    lines.push({
      id: "error",
      channel: "api.error",
      message: `${apiError.message}: ${apiError.detail}`,
      tone: "danger",
    });
  }

  return lines.slice(-16);
}

function AutopilotConsolePanel({
  locale,
  lines,
  embedded = false,
  className,
}: {
  locale: AppLocale;
  lines: ConsoleLine[];
  embedded?: boolean;
  className?: string;
}) {
  const visibleLines = lines.slice(embedded ? -16 : -12);

  return (
    // 2026-05-13 v11 视觉收尾：去除 console panel 自身圆角、边框；
    // 顶部 chip 同样去掉圆角与边框，与 visual stage 紧贴融合。
    <section
      className={cn(
        "text-white",
        embedded ? "flex min-h-0 flex-col" : "",
        embedded
          ? "bg-slate-950/82 shadow-[0_24px_64px_rgba(2,6,23,0.34)] backdrop-blur-xl"
          : "bg-slate-950",
        className
      )}
      data-testid="autopilot-runtime-console"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-white/65">
          <Terminal className="size-3.5" aria-hidden="true" />
          {t(locale, "自动驾驶控制台", "Autopilot console")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-emerald-400/10 px-2 py-1 text-[10px] font-black text-emerald-200">
            {t(locale, "事件流", "Event stream")}
          </span>
          <span className="bg-white/5 px-2 py-1 text-[10px] font-black text-white/55">
            {visibleLines.length}/{lines.length} {t(locale, "行", "lines")}
          </span>
        </div>
      </div>
      <div
        className={cn(
          "px-4 py-3 font-mono text-[11px] leading-6",
          // Spec 5 布局校准:embedded 浮层限高 + 内滚,不遮挡 3D 场景。
          // 自动驾驶 3D 场景融合 follow-up（2026-05-13）：
          // 去掉 max-h 强制高度让 panel 真正自适应到 visibleLines 行数。
          // 之前 max-h-32（128px）在只有 1-2 行 console line 时仍占满 128px，
          // 视觉上 panel 下方留出大段 dim 浮层空白挡住 3D scene 底部。改成只
          // 设上限不强制最低高，短消息时 panel 自然变低，不再遮挡底部地面。
          embedded ? "min-h-0 flex-1 overflow-y-auto overscroll-contain" : "overflow-hidden"
        )}
      >
        {visibleLines.map(line => (
          <div
            key={`${line.channel}-${line.id}`}
            className={cn(
              "grid gap-2 border-b border-white/[0.06] py-1.5 last:border-b-0 md:grid-cols-[128px_minmax(0,1fr)]",
              line.tone === "success"
                ? "text-emerald-100"
                : line.tone === "warning"
                  ? "text-amber-100"
                  : line.tone === "danger"
                    ? "text-rose-100"
                    : "text-slate-200"
            )}
          >
            <span className="truncate text-white/45">
              {line.timestamp
                ? new Intl.DateTimeFormat(locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }).format(new Date(line.timestamp))
                : "--:--:--"}{" "}
              {line.channel}
            </span>
            <span className="min-w-0 break-words">{line.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AutopilotSpecTreeHandoffPanel({
  locale = "zh-CN",
  job,
  selection,
  specTree,
  embedded = false,
}: {
  locale?: AppLocale;
  job: BlueprintGenerationJob | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  embedded?: boolean;
}) {
  if (!job || !selection || job.stage !== "spec_tree") {
    return null;
  }

  const isReviewing = job.handoffState === "reviewing";

  const content = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-emerald-700">
            <FileSearch className="size-3.5" aria-hidden="true" />
            {t(locale, "阶段交接", "Stage handoff")}
          </div>
          <h2 className="mt-2 text-lg font-black text-slate-950">
            {t(
              locale,
              "RouteSet 已选择，SPEC 树草稿等待评审",
              "RouteSet selected; SPEC tree draft is waiting for review"
            )}
          </h2>
          <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-slate-600">
            {t(
              locale,
              "这里不是结束，而是从路线编排切换到 SPEC 树交接。后续的 Agent Crew 横向层、运行时能力桥、效果预演和实现提示词会继续展开。",
              "This is not the end of the run. Route orchestration has handed off into the SPEC tree, and Agent Crew, Runtime Bridge, effect preview, and prompt packaging continue from here."
            )}
          </p>
          {isReviewing ? (
            <div
              className="mt-3 inline-flex items-center gap-2 rounded-[8px] border border-emerald-300 bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800"
              role="status"
              aria-live="polite"
              data-testid="autopilot-reviewing-hint"
            >
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              {t(
                locale,
                "可操作：确认并继续 · 改动节点 · 改选路线 · 重新生成",
                "Actions: confirm and continue · edit node · change route · regenerate"
              )}
            </div>
          ) : null}
        </div>
        <a
          href={SPECS_PATH}
          data-testid="autopilot-open-specs-link"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 underline decoration-slate-300 decoration-dotted underline-offset-[3px] hover:text-slate-700 hover:decoration-slate-500"
        >
          {t(locale, "在独立工作台查看", "View in standalone workbench")}
          <Link2 className="size-3" aria-hidden="true" />
        </a>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-4">
        <MetricBox
          label={t(locale, "当前状态", "Current state")}
          value={readAutopilotJobStatus(job, locale)}
          tone="good"
        />
        <MetricBox
          label={t(locale, "SPEC 节点", "SPEC nodes")}
          value={
            specTree
              ? countLabel(locale, specTree.nodes.length, "个节点", "node", "nodes")
              : t(locale, "已生成", "Generated")
          }
        />
        <MetricBox
          label={t(locale, "已选路线", "Selected route")}
          value={copyDynamic(locale, selection.routeTitle)}
        />
        <MetricBox
          label={t(locale, "下一站", "Next stop")}
          value={t(locale, "推导 / 规格文档", "Deduction / spec docs")}
          tone="warn"
        />
      </div>
    </>
  );

  return embedded ? (
    <div
      className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-4"
      data-testid="autopilot-spec-tree-handoff"
      data-mf-card
    >
      {content}
    </div>
  ) : (
    <section
      className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-4"
      data-testid="autopilot-spec-tree-handoff"
      data-mf-card
    >
      {content}
    </section>
  );
}

/**
 * autopilot-agent-reasoning-stream：/autopilot 页面内联的 Agent 推理流时间线。
 * 挂载后 1 秒注入模拟事件（开发期临时方案，等 CallbackReceiver 接通后自动跳过）。
 */
function AgentReasoningTimelineInline({ jobId }: { jobId: string }) {
  const subscribe = useBlueprintRealtimeStore(s => s.subscribe);
  const dispatchEvent = useBlueprintRealtimeStore(s => s.dispatchEvent);

  useEffect(() => {
    subscribe(jobId);
  }, [jobId, subscribe]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const state = useBlueprintRealtimeStore.getState();
      if (state.agentReasoning.entries.length > 0) return;

      const now = Date.now();
      const events = [
        { type: "role.agent.iteration_started", payload: { iteration: 1, roleId: "planner", stageId: "route_generation" } },
        { type: "role.agent.thinking", payload: { iteration: 1, roleId: "planner", stageId: "route_generation", thought: "我需要先分析仓库的目录结构和核心模块..." } },
        { type: "role.agent.acting", payload: { iteration: 1, roleId: "planner", stageId: "route_generation", actionToolId: "mcp.github.clone" } },
        { type: "role.agent.observing", payload: { iteration: 1, roleId: "planner", stageId: "route_generation", observationSuccess: true, observationSummary: "代码已克隆，发现 src/ 下有 12 个模块" } },
        { type: "role.agent.iteration_started", payload: { iteration: 2, roleId: "planner", stageId: "route_generation" } },
        { type: "role.agent.thinking", payload: { iteration: 2, roleId: "planner", stageId: "route_generation", thought: "分析模块依赖关系，识别核心状态机和事件流..." } },
        { type: "role.agent.acting", payload: { iteration: 2, roleId: "planner", stageId: "route_generation", actionToolId: "aigc.code_analysis" } },
        { type: "role.agent.observing", payload: { iteration: 2, roleId: "planner", stageId: "route_generation", observationSuccess: true, observationSummary: "主模块是 core/engine.ts，依赖 3 个子系统" } },
        { type: "role.agent.iteration_started", payload: { iteration: 3, roleId: "planner", stageId: "route_generation" } },
        { type: "role.agent.thinking", payload: { iteration: 3, roleId: "planner", stageId: "route_generation", thought: "基于分析结果生成实现路线规划..." } },
        { type: "role.agent.acting", payload: { iteration: 3, roleId: "planner", stageId: "route_generation", actionToolId: "builtin.finish" } },
        { type: "role.agent.completed", payload: { iteration: 3, roleId: "planner", stageId: "route_generation" } },
      ];
      events.forEach((event, index) => {
        setTimeout(() => {
          dispatchEvent({
            type: event.type as any,
            jobId,
            timestamp: new Date(now + index * 2000).toISOString(),
            payload: event.payload as any,
          });
        }, index * 2000);
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [jobId, dispatchEvent]);

  return <AgentReasoningTimeline jobId={jobId} className="h-full" />;
}

export default function AutopilotRoutePage() {
  const subscribedLocale = useAppStore(state => state.locale);
  const locale =
    typeof window === "undefined"
      ? useAppStore.getState().locale
      : subscribedLocale;
  const setLocale = useAppStore(state => state.setLocale);
  const currentProjectId = useProjectStore(state => state.currentProjectId);
  const projects = useProjectStore(state => state.projects);
  const currentProject =
    projects.find(project => project.id === currentProjectId) ?? null;
  const projectSpaceHref = resolveClientRouteHref(PROJECTS_PATH);
  const handleProjectSpaceBreadcrumbClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        shouldUseNativeAnchorNavigation(event) ||
        typeof window === "undefined"
      ) {
        return;
      }
      event.preventDefault();
      window.history.pushState(null, "", projectSpaceHref);
    },
    [projectSpaceHref]
  );

  const [targetText, setTargetText] = useState("");
  const [githubInput, setGithubInput] = useState("");
  const [intake, setIntake] = useState<BlueprintIntake | null>(null);
  const [projectContext, setProjectContext] =
    useState<BlueprintProjectDomainContext | null>(null);
  const [clarificationSession, setClarificationSession] =
    useState<BlueprintClarificationSession | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [latestJob, setLatestJob] = useState<BlueprintGenerationJob | null>(
    null
  );
  const latestSceneJobIdRef = useRef<string | undefined>(undefined);
  const [routeSet, setRouteSet] = useState<BlueprintRouteSet | null>(null);
  const [selection, setSelection] = useState<BlueprintRouteSelection | null>(
    null
  );
  const [specTree, setSpecTree] = useState<BlueprintSpecTree | null>(null);
  const [apiError, setApiError] = useState<ApiRequestError | null>(null);
  const [workflowStageOverride, setWorkflowStageOverride] =
    useState<AutopilotWorkflowStage | null>(null);
  const [creatingIntake, setCreatingIntake] = useState(false);
  const pagesBlueprintRuntime = useMemo(
    () => (IS_GITHUB_PAGES ? getGithubPagesBlueprintDemoRuntime() : null),
    []
  );
  const pagesGenerationActions = useMemo(
    () =>
      pagesBlueprintRuntime
        ? {
            generateSpecDocuments:
              pagesBlueprintRuntime.generateSpecDocuments,
            generateEffectPreview:
              pagesBlueprintRuntime.generateEffectPreviews,
            generatePromptPackages:
              pagesBlueprintRuntime.generatePromptPackages,
            generateEngineeringLanding:
              pagesBlueprintRuntime.generateEngineeringLanding,
          }
        : undefined,
    [pagesBlueprintRuntime]
  );

  /**
   * autopilot-streaming-experience：流式订阅生命周期。
   *
   * 修复需求 1（订阅时机覆盖 clarification / route_generation 阶段）：
   * - 派生唯一 streamKey：优先使用 latestJob.id；jobId 出现前先用 intake.id
   *   订阅 clarification / route_generation 阶段事件（这两个阶段的 emitter
   *   stream key 即 intake.id）。
   * - latestJob.id 首次出现且与 intake.id 不同时，依赖变化触发 cleanup →
   *   重新 subscribe；store.subscribe 内部已经在 jobId 切换时清空
   *   agentReasoning 切片，无需新增 store action。
   * - intake / latestJob 同时为空时不发起任何订阅，agentReasoning.status
   *   维持 idle。
   */
  const subscribeToJob = useBlueprintRealtimeStore(s => s.subscribe);
  const unsubscribeFromJob = useBlueprintRealtimeStore(s => s.unsubscribe);
  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    const streamKey = latestJob?.id ?? intake?.id ?? null;
    if (!streamKey) return;
    subscribeToJob(streamKey);
    return () => {
      unsubscribeFromJob();
    };
  }, [latestJob?.id, intake?.id, subscribeToJob, unsubscribeFromJob]);
  const [loadingContext, setLoadingContext] = useState(false);
  const [generatingClarifications, setGeneratingClarifications] =
    useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [generatingRouteSet, setGeneratingRouteSet] = useState(false);
  const [selectingRouteId, setSelectingRouteId] = useState<string | null>(null);

  const resetLatestGenerationSnapshot = useCallback(() => {
    latestSceneJobIdRef.current = undefined;
    setLatestJob(null);
    setRouteSet(null);
    setSelection(null);
    setSpecTree(null);
    setIntake(null);
    setTargetText("");
    setGithubInput("");
    setProjectContext(null);
    setClarificationSession(null);
    setAnswerDrafts({});
  }, []);

  const applyLatestGenerationSnapshot = useCallback(
    (snapshot: BlueprintLatestGenerationJobSnapshot) => {
      if (!snapshot.job) {
        resetLatestGenerationSnapshot();
        return;
      }

      latestSceneJobIdRef.current = snapshot.job.id;
      setLatestJob(snapshot.job);
      setRouteSet(snapshot.routeSet ?? null);
      setSelection(snapshot.selection ?? null);
      setSpecTree(snapshot.specTree ?? null);
      if (snapshot.intake) {
        setIntake(snapshot.intake);
        setTargetText(snapshot.intake.targetText ?? "");
        setGithubInput(snapshot.intake.githubUrls.join("\n"));
        setAnswerDrafts(
          Object.fromEntries(
            (snapshot.clarificationSession?.answers ?? []).map(answer => [
              answer.questionId,
              answer.answer,
            ])
          )
        );
      } else {
        setIntake(null);
        setTargetText("");
        setGithubInput("");
        setAnswerDrafts({});
      }
      setProjectContext(snapshot.projectContext ?? null);
      setClarificationSession(snapshot.clarificationSession ?? null);
    },
    [resetLatestGenerationSnapshot]
  );

  useEffect(() => {
    resetLatestGenerationSnapshot();
    setApiError(null);
  }, [currentProjectId, resetLatestGenerationSnapshot]);

  useEffect(() => {
    let active = true;

    if (!IS_GITHUB_PAGES && !currentProjectId) {
      resetLatestGenerationSnapshot();
      setApiError(null);
      return () => {
        active = false;
      };
    }

    const latestProjectId = currentProjectId ?? undefined;
    const latestJobRequest =
      IS_GITHUB_PAGES && pagesBlueprintRuntime
        ? pagesBlueprintRuntime.fetchLatestGenerationJob()
        : fetchLatestBlueprintGenerationJob({
            projectId: latestProjectId,
          });

    latestJobRequest.then(result => {
      if (!active) return;
      if (!result.ok) {
        setApiError(result.error);
        return;
      }

      applyLatestGenerationSnapshot(result.data);
    });

    return () => {
      active = false;
    };
  }, [
    applyLatestGenerationSnapshot,
    currentProjectId,
    pagesBlueprintRuntime,
    resetLatestGenerationSnapshot,
  ]);

  const refreshLatestGenerationSnapshot = useCallback(async () => {
    if (!IS_GITHUB_PAGES && !currentProjectId) {
      resetLatestGenerationSnapshot();
      setApiError(null);
      return false;
    }

    const latestProjectId = currentProjectId ?? undefined;
    const latestJobRequest =
      IS_GITHUB_PAGES && pagesBlueprintRuntime
        ? pagesBlueprintRuntime.fetchLatestGenerationJob()
        : fetchLatestBlueprintGenerationJob({
            projectId: latestProjectId,
          });
    const result = await latestJobRequest;
    if (!result.ok) {
      setApiError(result.error);
      return false;
    }

    applyLatestGenerationSnapshot(result.data);
    return true;
  }, [
    applyLatestGenerationSnapshot,
    currentProjectId,
    pagesBlueprintRuntime,
    resetLatestGenerationSnapshot,
  ]);

  const refreshPagesBlueprintSnapshot = useCallback(async () => {
    if (!pagesBlueprintRuntime) return false;
    return refreshLatestGenerationSnapshot();
  }, [pagesBlueprintRuntime, refreshLatestGenerationSnapshot]);

  const parsedGithub = useMemo(
    () => parseGithubInput(`${targetText}\n${githubInput}`),
    [targetText, githubInput]
  );
  const target = targetText.trim();
  const readiness =
    clarificationSession?.readiness ?? intake?.readiness ?? undefined;
  const canCreateIntake = target.length > 0 || parsedGithub.urls.length > 0;
  const clarificationReady = isClarificationReady(
    clarificationSession,
    readiness
  );
  const canGenerateRouteSet =
    Boolean(intake) && (clarificationReady || Boolean(routeSet));
  const answers = useMemo(
    () => buildAnswersFromDrafts(clarificationSession, answerDrafts),
    [answerDrafts, clarificationSession]
  );
  const autopilotAgentCrew = useMemo(
    () => readAutopilotAgentCrew(latestJob),
    [latestJob]
  );
  const autopilotCapabilities = useMemo(
    () => readAutopilotCapabilities(latestJob),
    [latestJob]
  );
  const autopilotCapabilityInvocations = useMemo(
    () => readAutopilotCapabilityInvocations(latestJob),
    [latestJob]
  );
  const autopilotCapabilityEvidence = useMemo(
    () => readAutopilotCapabilityEvidence(latestJob),
    [latestJob]
  );
  const autopilotEffectPreviews = useMemo(
    () => readAutopilotEffectPreviews(latestJob),
    [latestJob]
  );

  // autopilot-streaming-experience integration-gap-2026-05-16：
  // 把蓝图实时切片（agentReasoning.entries / effectPreviews logTimeline）镜像到
  // 3D 场景墙面终端的 useSandboxStore，让中央 <SandboxMonitor /> 跟右栏时间线
  // 联动，避免出现"蓝图驾驶舱里 3D 场景跟右栏 HUD 脱钩"的体验。
  // 详细桥接策略与边界见 hook 头部 JSDoc。
  useAutopilotSandboxBridge({
    jobId: latestJob?.id ?? null,
    intakeId: intake?.id ?? null,
    effectPreviews: autopilotEffectPreviews,
  });
  // Spec 4 Task 9：在 fabric 阶段接入右栏数据层 hook(`useAutopilotRightRailData`)。
  //
  // 用法边界：
  //  - 本调用是无条件的（遵守 Rules of Hooks）；hook 内部根据 `jobId === ""` /
  //    `currentSubStage` / `job.stage` 等条件自行决定是否发起 fetch。
  //  - `initialData` 完全从现有 `useState`（`latestJob / routeSet / selection / specTree`）
  //    与 5 条 `readAutopilot*(latestJob)` 派生值 seed，保证 SSR 快照路径下
  //    `view.XXX.data` 与 hook 接入前 DOM 严格一致（AutopilotRoutePage.test.tsx 使用
  //    `renderToStaticMarkup`，不运行 `useEffect`，因此 view 的 fetch effect 不会在快照中
  //    触发）。
  //  - `currentSubStage` 用 `resolveRailSubStage({ currentStage: "fabric", ... })` 预先
  //    算好，既用于 hook 的懒加载 gate，也用作 fabric 分支里 `<AutopilotRightRail>` 的
  //    prop（避免在 render 期间重复调用 resolver）。非 fabric 阶段传入的 resolver 依然
  //    会返回 undefined（resolver 纯函数契约），因此即便在 `input/clarification/routeset
  //    /selection` 阶段本 hook 被调用，也不会触发 Wave 2-4 的 fetch。
  //  - 本次接入只把 fabric 分支切到 hook 消费；`input/clarification/routeset/selection`
  //    4 个阶段的 `useState` / `useEffect` / 写请求（`createBlueprintIntake` /
  //    `createBlueprintClarificationSession` / `saveBlueprintClarificationAnswers` /
  //    `selectBlueprintRoute` 等）保持不变。
  //  - 5 条 `useMemo(readAutopilot*(latestJob))` 派生值保留：`flowSteps` / `consoleLines`
  //    的 useMemo 与 `projection` 阶段 UI 仍然依赖它们；hook 只替换 fabric 分支传给
  //    `<AutopilotRightRail>` 的 9 个 props 的来源（Requirement 6.6：不删除派生 helper）。
  //  - `onSubStageChange` 保持 `() => {}` no-op（Spec 5 `autopilot-step-driven-rail-
  //    navigation` 会接入 URL `?sub=xxx` 同步）。
  const derivedWorkflowStage = useMemo(
    () =>
      readAutopilotWorkflowStage({
        intake,
        clarificationSession,
        readiness,
        routeSet,
        selection,
      }),
    [clarificationSession, intake, readiness, routeSet, selection]
  );
  const activeCoordinationStage =
    latestJob?.stage ??
    mapWorkflowStageToCoordinationStage(
      derivedWorkflowStage,
      latestJob?.stage
    ) ??
    "input";
  const activeCoordinationStageRef = useRef(activeCoordinationStage);
  useEffect(() => {
    activeCoordinationStageRef.current = activeCoordinationStage;
  }, [activeCoordinationStage]);
  const handleCoordinationJobUpdated = useCallback(
    (job: BlueprintGenerationJob) => {
      activeCoordinationStageRef.current = job.stage;
      latestSceneJobIdRef.current = job.id;
      setLatestJob(job);
    },
    []
  );
  const handleHistoryJobSelected = useCallback(
    (job: BlueprintGenerationJob) => {
      activeCoordinationStageRef.current = job.stage;
      setLatestJob(job);
    },
    []
  );
  const handleReplanBranchJobActivated = useCallback(
    (job: BlueprintGenerationJob) => {
      if (readAutopilotHistoryOpenFromLocation()) {
        setAutopilotHistoryActiveJob(job.id);
      }
      handleCoordinationJobUpdated(job);
    },
    [handleCoordinationJobUpdated]
  );
  const fabricSubStage = useMemo(
    () =>
      resolveRailSubStage({
        currentStage: "fabric",
        job: latestJob,
        selection,
        specTree,
        agentCrew: autopilotAgentCrew,
      }),
    [latestJob, selection, specTree, autopilotAgentCrew]
  );
  // Spec 5 Task 7：用 `useRightRailSubStageState` 把 `fabricSubStage` 从单向派生升级为
  // 「URL `?sub` + sticky pin + 派生」三路合并的权威 state。
  //  - `effectiveSubStage` 同时下传到 `<AutopilotRightRail currentSubStage={...}>`
  //    与 Spec 4 `useAutopilotRightRailData(..., { currentSubStage })`，保证 URL / pin /
  //    scroll / 数据懒加载共用一个口径（Requirement 6.3）。
  //  - `setPinnedSubStage` 包装为 `onSubStageChange`，替代 Spec 3/4 的 no-op 占位
  //    （Requirement 6.2）。
  //  - 非 fabric 阶段 `fabricSubStage` 为 `undefined`，hook 仍可安全调用；
  //    `effectiveSubStage` 退化为 `pinnedSubStage`（用户刷新页面恢复位置的底层语义，
  //    Requirement 2.7）。
  const subStageState = useRightRailSubStageState({
    jobStage: latestJob?.stage ?? null,
    resolvedSubStage: fabricSubStage,
  });
  const effectiveSubStage = subStageState.effectiveSubStage;
  const activeAutopilotPage = useMemo<AutopilotPage>(
    () =>
      resolveActiveAutopilotPage({
        workflowStageOverride,
        hasSelection: Boolean(selection),
        latestJobStage: latestJob?.stage,
        effectiveSubStage,
      }),
    [effectiveSubStage, latestJob?.stage, selection, workflowStageOverride]
  );
  const pageTransition = usePageTransitionChoreographer();
  const toastQueue = useToastQueue();
  const autopilotCoordinator = useAutopilotCoordination({
    toastQueue,
    pageChoreographer: pageTransition,
    readThreeLayerSnapshot: () => ({
      urlPin: mapRailSubStageToCoordinationStage(
        subStageState.effectiveSubStage
      ),
      workflowStageOverride: mapWorkflowStageToCoordinationStage(
        workflowStageOverride,
        activeCoordinationStageRef.current
      ),
      activeJobStage: activeCoordinationStageRef.current,
    }),
    consistencyActions: {
      resetPin: subStageState.resetPin,
      fallbackWorkflowStageOverride: stage => {
        setWorkflowStageOverride(mapCoordinationStageToWorkflowStage(stage));
      },
    },
  });
  const previousAutopilotPageRef = useRef(activeAutopilotPage);
  useEffect(() => {
    const previousPage = previousAutopilotPageRef.current;
    if (previousPage !== activeAutopilotPage) {
      pageTransition.transition(previousPage, activeAutopilotPage);
      previousAutopilotPageRef.current = activeAutopilotPage;
    }
  }, [activeAutopilotPage, pageTransition.transition]);
  const handleNavigateWorkflowStage = useCallback(
    (nextStage: AutopilotWorkflowStage) => {
      subStageState.resetPin();
      setWorkflowStageOverride(nextStage);
    },
    [subStageState.resetPin]
  );

  // Spec 5 Task 8 — Viewport_Tier 三档断点 state。
  // - drawer（<md）：右栏降级为 <HoloDrawer>；drawerOpen 由用户交互触发
  // - side-collapsible（md-xl）：右栏可折叠；rightRailCollapsed 由用户交互触发
  // - side-fixed（≥xl）：Spec 3 现状，无 trigger / toggle
  // tier 从 drawer 切走时自动关闭 drawer，避免 side 模式下残留 drawer 状态。
  const viewportTier = useViewportTier();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  useEffect(() => {
    if (viewportTier !== "drawer" && drawerOpen) {
      setDrawerOpen(false);
    }
  }, [viewportTier, drawerOpen]);
  const rightRailView = useAutopilotRightRailData(latestJob?.id ?? "", {
    initialData: {
      job: latestJob,
      routeSet,
      selection,
      specTree,
      agentCrew: autopilotAgentCrew,
      capabilities: autopilotCapabilities,
      capabilityInvocations: autopilotCapabilityInvocations,
      capabilityEvidence: autopilotCapabilityEvidence,
      effectPreviews: autopilotEffectPreviews,
    },
    currentSubStage: effectiveSubStage,
    disableRemoteFetch: IS_GITHUB_PAGES,
  });
  const pageProjection = useMemo(
    () =>
      resolveAutopilotPageProjection({
        activeAutopilotPage,
        latestJob,
        specTree,
        agentCrew: autopilotAgentCrew,
        capabilities: autopilotCapabilities,
        capabilityInvocations: autopilotCapabilityInvocations,
        capabilityEvidence: autopilotCapabilityEvidence,
        effectPreviews: autopilotEffectPreviews,
      }),
    [
      activeAutopilotPage,
      autopilotAgentCrew,
      autopilotCapabilities,
      autopilotCapabilityEvidence,
      autopilotCapabilityInvocations,
      autopilotEffectPreviews,
      latestJob,
      specTree,
    ]
  );
  const flowSteps = useMemo(
    () =>
      buildFlowSteps({
        locale,
        intake,
        clarificationSession,
        readiness,
        routeSet,
        selection,
        specTree,
        agentCrew: autopilotAgentCrew,
        effectPreviews: autopilotEffectPreviews,
      }),
    [
      autopilotAgentCrew,
      autopilotEffectPreviews,
      clarificationSession,
      intake,
      locale,
      readiness,
      routeSet,
      selection,
      specTree,
    ]
  );
  const consoleLines = useMemo(
    () =>
      buildConsoleLines({
        locale,
        intake,
        clarificationSession,
        latestJob: pageProjection.consoleJob,
        routeSet,
        selection,
        specTree: pageProjection.visualSpecTree,
        capabilityInvocations: pageProjection.visualCapabilityInvocations,
        capabilityEvidence: pageProjection.visualCapabilityEvidence,
        effectPreviews: pageProjection.visualEffectPreviews,
        apiError,
      }),
    [
      apiError,
      clarificationSession,
      intake,
      locale,
      pageProjection.consoleJob,
      pageProjection.visualCapabilityEvidence,
      pageProjection.visualCapabilityInvocations,
      pageProjection.visualEffectPreviews,
      pageProjection.visualSpecTree,
      routeSet,
      selection,
    ]
  );

  // --- Header HistoryEntryPoint data ---
  const headerHistoryJobId = latestJob?.id ?? null;
  const headerHistoryFamilyState = useFamilyData({
    jobId: headerHistoryJobId,
    enabled: Boolean(headerHistoryJobId),
    disableRemoteFetch: IS_GITHUB_PAGES,
  });
  const headerHistoryFamilyCount = resolveHistoryEntryFamilyCount({
    familyJobCount: headerHistoryFamilyState.data?.jobs.length,
    hasParentJob: Boolean(latestJob?.parentJobId),
  });
  const handleHeaderOpenHistory = useCallback((jobId: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("history", "1");
    url.searchParams.set("activeJob", jobId);
    window.history.pushState({}, "", url);
    window.dispatchEvent(
      new CustomEvent(AUTOPILOT_HISTORY_OPEN_EVENT, { detail: { jobId } }),
    );
  }, []);

  useEffect(() => {
    let active = true;
    setProjectContext(null);
    if (!currentProjectId) return;

    setLoadingContext(true);
    const fetchProjectContext = IS_GITHUB_PAGES
      ? pagesBlueprintRuntime?.fetchProjectContext
      : fetchBlueprintProjectContext;

    fetchProjectContext?.(currentProjectId)
      .then(result => {
        if (!active) return;
        if (result.ok) {
          setProjectContext(result.data.projectContext);
        }
      })
      .finally(() => {
        if (active) setLoadingContext(false);
      });

    return () => {
      active = false;
    };
  }, [currentProjectId, pagesBlueprintRuntime]);

  const handleAnswerChange = useCallback(
    (questionId: string, answer: string) => {
      setAnswerDrafts(previous => ({ ...previous, [questionId]: answer }));
    },
    []
  );

  const handleSubmitTargetEdit = useCallback(
    async (value: string) => {
      if (!intake) return;
      await runInlineEditFlow({
        submitEdit: async () => {
          const result = await patchBlueprintIntake(intake.id, {
            targetText: value,
            reason: "inline_edit.target_text",
          });
          if (!result.ok) throw result.error;
          return result.data;
        },
        refreshJob: (editResult) => {
          setTargetText(editResult.intake.targetText ?? value);
          setIntake(editResult.intake);
          if (editResult.projectContext) {
            setProjectContext(editResult.projectContext);
          }
          rightRailView.job.retry();
        },
        coordinator: autopilotCoordinator,
      });
    },
    [autopilotCoordinator, intake, rightRailView.job.retry]
  );

  const handleSubmitGithubUrlEdit = useCallback(
    async (sourceIndex: number, value: string) => {
      if (!intake) return;
      const githubUrls = [...parsedGithub.urls];
      githubUrls[sourceIndex] = value.trim();
      await runInlineEditFlow({
        submitEdit: async () => {
          const result = await patchBlueprintIntake(intake.id, {
            githubUrls: githubUrls.filter(Boolean),
            reason: "inline_edit.github_url",
          });
          if (!result.ok) throw result.error;
          return result.data;
        },
        refreshJob: (editResult) => {
          setGithubInput(editResult.intake.githubUrls.join("\n"));
          setIntake(editResult.intake);
          if (editResult.projectContext) {
            setProjectContext(editResult.projectContext);
          }
          rightRailView.job.retry();
        },
        coordinator: autopilotCoordinator,
      });
    },
    [autopilotCoordinator, intake, parsedGithub.urls, rightRailView.job.retry]
  );

  const handleSubmitClarificationEdit = useCallback(
    async (questionId: string, answer: string) => {
      if (!clarificationSession) return;
      const mergedAnswers = new Map(
        clarificationSession.answers.map(item => [
          item.questionId,
          item.answer,
        ])
      );
      mergedAnswers.set(questionId, answer);
      await runInlineEditFlow({
        submitEdit: async () => {
          const result = await saveBlueprintClarificationAnswers(
            clarificationSession.id,
            {
              answers: Array.from(mergedAnswers.entries()).map(
                ([answerQuestionId, answerValue]) => ({
                  questionId: answerQuestionId,
                  answer: answerValue,
                })
              ),
              answeredBy: "autopilot",
            },
            "PATCH"
          );
          if (!result.ok) throw result.error;
          return result.data;
        },
        refreshJob: (editResult) => {
          const updatedSession =
            editResult.clarificationSession ??
            readLegacyClarificationSession(editResult);
          if (updatedSession) {
            setClarificationSession(updatedSession);
            setAnswerDrafts(
              Object.fromEntries(
                updatedSession.answers.map(item => [
                  item.questionId,
                  item.answer,
                ])
              )
            );
          }
          if (editResult.intake) {
            setIntake(editResult.intake);
          }
          if (editResult.projectContext) {
            setProjectContext(editResult.projectContext);
          }
          rightRailView.job.retry();
        },
        coordinator: autopilotCoordinator,
      });
    },
    [autopilotCoordinator, clarificationSession, rightRailView.job.retry]
  );

  const handleCreateIntake = useCallback(async () => {
    if (!canCreateIntake) return;
    setCreatingIntake(true);
    setApiError(null);

    try {
      const createIntake = IS_GITHUB_PAGES
        ? pagesBlueprintRuntime?.createIntake
        : createBlueprintIntake;
      const result = await createIntake?.({
        projectId: currentProjectId ?? undefined,
        targetText: target || undefined,
        githubUrls: parsedGithub.urls,
      });
      if (!result) return;

      if (result.ok) {
        setIntake(result.data.intake);
        setClarificationSession(result.data.clarificationSession ?? null);
        if (result.data.projectContext) {
          setProjectContext(result.data.projectContext);
        }
        const existingAnswers = result.data.clarificationSession?.answers ?? [];
        setAnswerDrafts(
          Object.fromEntries(
            existingAnswers.map(answer => [answer.questionId, answer.answer])
          )
        );

        // 自动触发澄清生成(合并"创建输入记录"和"生成澄清"为一步)
        if (!result.data.clarificationSession) {
          setGeneratingClarifications(true);
          try {
            const createClarificationSession = IS_GITHUB_PAGES
              ? pagesBlueprintRuntime?.createClarificationSession
              : createBlueprintClarificationSession;
            const clarResult = await createClarificationSession?.(
              result.data.intake.id,
              { projectId: currentProjectId ?? undefined, locale }
            );
            if (!clarResult) return;
            if (clarResult.ok) {
              setClarificationSession(clarResult.data.clarificationSession);
              if (clarResult.data.projectContext) {
                setProjectContext(clarResult.data.projectContext);
              }
              const clarAnswers = clarResult.data.clarificationSession.answers ?? [];
              setAnswerDrafts(
                Object.fromEntries(
                  clarAnswers.map(answer => [answer.questionId, answer.answer])
                )
              );
            } else {
              setApiError(clarResult.error);
            }
          } finally {
            setGeneratingClarifications(false);
          }
        }
      } else {
        setApiError(result.error);
      }
    } finally {
      setCreatingIntake(false);
    }
  }, [
    canCreateIntake,
    currentProjectId,
    pagesBlueprintRuntime,
    parsedGithub.urls,
    target,
  ]);

  const handleGenerateClarifications = useCallback(async () => {
    if (!intake) return;
    setGeneratingClarifications(true);
    setApiError(null);

    try {
      const createClarificationSession = IS_GITHUB_PAGES
        ? pagesBlueprintRuntime?.createClarificationSession
        : createBlueprintClarificationSession;
      const result = await createClarificationSession?.(intake.id, {
        projectId: currentProjectId ?? undefined,
        locale,
      });
      if (!result) return;

      if (result.ok) {
        setClarificationSession(result.data.clarificationSession);
        if (result.data.projectContext) {
          setProjectContext(result.data.projectContext);
        }
        const existingAnswers = result.data.clarificationSession.answers ?? [];
        setAnswerDrafts(
          Object.fromEntries(
            existingAnswers.map(answer => [answer.questionId, answer.answer])
          )
        );
      } else {
        setApiError(result.error);
      }
    } finally {
      setGeneratingClarifications(false);
    }
  }, [currentProjectId, intake, pagesBlueprintRuntime]);

  const handleSaveAnswers = useCallback(async () => {
    if (!clarificationSession || answers.length === 0) return;
    setSavingAnswers(true);
    setApiError(null);

    try {
      const saveClarificationAnswers = IS_GITHUB_PAGES
        ? pagesBlueprintRuntime?.saveClarificationAnswers
        : saveBlueprintClarificationAnswers;
      const result = await saveClarificationAnswers?.(
        clarificationSession.id,
        { answers, answeredBy: "autopilot" },
        clarificationSession.answers.length > 0 ? "PATCH" : "POST"
      );
      if (!result) return;

      if (result.ok) {
        setClarificationSession(result.data.clarificationSession);
        if (result.data.intake) {
          setIntake(result.data.intake);
        }
        if (result.data.projectContext) {
          setProjectContext(result.data.projectContext);
        }
      } else {
        setApiError(result.error);
      }
    } finally {
      setSavingAnswers(false);
    }
  }, [answers, clarificationSession, pagesBlueprintRuntime]);

  const handleGenerateRouteSet = useCallback(async () => {
    if (!canGenerateRouteSet) return;
    setGeneratingRouteSet(true);
    setApiError(null);

    try {
      const createGenerationJob = IS_GITHUB_PAGES
        ? pagesBlueprintRuntime?.createGenerationJob
        : createBlueprintGenerationJob;
      const result = await createGenerationJob?.({
        mode: "autopilot_route",
        projectId: currentProjectId ?? undefined,
        targetText: target || intake?.targetText || undefined,
        githubUrls:
          parsedGithub.urls.length > 0 ? parsedGithub.urls : intake?.githubUrls,
        intakeId: intake?.id,
        clarificationSessionId: clarificationSession?.id,
        clarifications: answers,
        domainContext: projectContext ?? undefined,
        locale,
      });
      if (!result) return;

      if (result.ok) {
        latestSceneJobIdRef.current = result.data.job.id;
        setLatestJob(result.data.job);
        setRouteSet(result.data.routeSet ?? null);
        setSelection(null);
        setSpecTree(null);
        if (result.data.intake) {
          setIntake(result.data.intake);
        }
        if (result.data.clarificationSession) {
          setClarificationSession(result.data.clarificationSession);
        }
        if (result.data.projectContext) {
          setProjectContext(result.data.projectContext);
        }
      } else {
        setApiError(result.error);
      }
    } finally {
      setGeneratingRouteSet(false);
    }
  }, [
    answers,
    canGenerateRouteSet,
    clarificationSession?.id,
    currentProjectId,
    intake,
    pagesBlueprintRuntime,
    parsedGithub.urls,
    projectContext,
    target,
  ]);

  // 澄清就绪后自动触发 RouteSet 生成,用户不需要手动点按钮。
  // 条件:澄清已就绪 + 还没有 routeSet + 没在生成中。
  const isClarifyReady = isClarificationReady(
    clarificationSession,
    clarificationSession?.readiness ?? intake?.readiness ?? undefined
  );
  const autoRouteTriggeredRef = useRef(false);
  useEffect(() => {
    if (
      isClarifyReady &&
      !routeSet &&
      !generatingRouteSet &&
      canGenerateRouteSet &&
      !autoRouteTriggeredRef.current
    ) {
      autoRouteTriggeredRef.current = true;
      handleGenerateRouteSet();
    }
    // 当 routeSet 被清空(例如用户刷新 intake)时,重置 trigger
    if (!isClarifyReady) {
      autoRouteTriggeredRef.current = false;
    }
  }, [isClarifyReady, routeSet, generatingRouteSet, canGenerateRouteSet, handleGenerateRouteSet]);

  // Phase 2:编组阶段自动推进 — spec_tree → spec_docs → effect_preview → prompt_packaging → engineering_landing
  const autoAdvance = useAutoAdvance({
    jobId: latestJob?.id ?? "",
    job: latestJob,
    specTree,
    rightRailSpecTree: rightRailView.specTree.data,
    generationActions: pagesBlueprintRuntime
      ? pagesGenerationActions
      : undefined,
    locale,
    onAdvanced: nextSubStage => {
      if (nextSubStage) {
        subStageState.setPinnedSubStage(nextSubStage);
      }
      // 触发 W1 refetch 让时间线感知到新 stage
      if (IS_GITHUB_PAGES && pagesBlueprintRuntime) {
        void refreshPagesBlueprintSnapshot();
        return;
      }
      rightRailView.job.retry();
    },
  });

  const handleSelectRoute = useCallback(
    async (routeId: string) => {
      if (!latestJob) return;
      setSelectingRouteId(routeId);
      setApiError(null);

      try {
        const selectRoute = IS_GITHUB_PAGES
          ? pagesBlueprintRuntime?.selectRoute
          : selectBlueprintRoute;
        const result = await selectRoute?.(latestJob.id, {
          routeId,
          reason: "Selected from the autopilot RouteSet workbench.",
          selectedBy: "autopilot",
        });
        if (!result) return;

        if (result.ok) {
          setWorkflowStageOverride(null);
          latestSceneJobIdRef.current = result.data.job.id;
          setLatestJob(result.data.job);
          setRouteSet(result.data.routeSet);
          setSelection(result.data.selection);
          setSpecTree(result.data.specTree);
          // 选路线后 jobId 不变、只是 stage 推进到 spec_tree。
          // `useAutopilotRightRailData` 的 W1 fetch effect 仅依赖 `[jobId, hasJob]`,
          // 且 `initialData` 身份变化被故意排除在依赖外(避免每 render 重置)。
          // 为了让右栏 `rightRailView.specTree.data` 等 W1 派生字段同步到最新
          // job snapshot,这里主动 bump W1 retry trigger,促使 hook 重新
          // GET /api/blueprint/jobs/latest 并 dispatch FETCH_FULFILLED。
          rightRailView.job.retry();
        } else {
          setApiError(result.error);
        }
      } finally {
        setSelectingRouteId(null);
      }
    },
    [latestJob, pagesBlueprintRuntime, rightRailView.job.retry]
  );

  const handleSubmitRouteSelectionEdit = useCallback(
    async (routeId: string) => {
      await handleSelectRoute(routeId);
    },
    [handleSelectRoute]
  );

  return (
    <main
      className="min-h-screen bg-[#f4f6f8] text-slate-950 xl:flex xl:h-screen xl:flex-col xl:overflow-hidden"
      data-testid="autopilot-route-page"
    >
      <header
        className="sticky top-0 z-20 border-b border-[#E5E5E5] bg-white px-3 py-3 md:px-4"
        data-testid="autopilot-topbar"
      >
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden bg-white">
              <img
                src={autopilotHeaderLogoUrl}
                alt=""
                aria-hidden="true"
                className="size-full object-contain"
                draggable={false}
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.06em] text-[#666]">
                <a
                  href={projectSpaceHref}
                  onClick={handleProjectSpaceBreadcrumbClick}
                  aria-label={t(
                    locale,
                    "返回项目空间",
                    "Back to project space"
                  )}
                  className="inline-flex items-center gap-1 rounded-none px-1 py-0.5 transition hover:text-[#FF4500] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4500]/30"
                  data-testid="autopilot-back-to-project-space"
                >
                  <ArrowLeft className="size-3" aria-hidden="true" />
                  <span>
                    {t(locale, "项目自动驾驶", "Project autopilot")}
                  </span>
                </a>
                <span className="text-[#999]">/</span>
                <span>{t(locale, "SPEC-first 蓝图", "SPEC-first blueprint")}</span>
              </div>
              <div className="truncate font-display text-base font-medium tracking-tight text-black">
                {currentProject?.name ||
                  t(locale, "未绑定项目", "No project selected")}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-none border border-[#E5E5E5] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-[#666]"
            >
              {readAutopilotJobStatus(pageProjection.visualJob, locale)}
            </Badge>
            {workflowStageOverride !== null && selection !== null ? (
              <button
                type="button"
                onClick={() => setWorkflowStageOverride(null)}
                aria-label={t(
                  locale,
                  "返回最新阶段",
                  "Return to latest stage"
                )}
                title={t(
                  locale,
                  "返回最新阶段",
                  "Return to latest stage"
                )}
                className="inline-flex items-center gap-1 border border-black bg-white px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-black transition hover:bg-black hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4500]/30"
                style={{ borderRadius: "0px" }}
                data-testid="autopilot-forward-to-latest-stage"
              >
                <span>{t(locale, "继续下一步", "Continue")}</span>
                <ArrowRight className="size-3" aria-hidden="true" />
              </button>
            ) : null}
            <HistoryEntryPoint
              jobId={headerHistoryJobId}
              locale={locale}
              familyCount={headerHistoryFamilyCount}
              staleCount={latestJob?.staleArtifactIds?.length ?? 0}
              staticPreview={IS_GITHUB_PAGES}
              disabled={IS_GITHUB_PAGES}
              onOpen={handleHeaderOpenHistory}
            />
            <AutopilotLanguageSwitch
              locale={locale}
              onLocaleChange={setLocale}
            />
          </div>
        </div>
      </header>

      <div className="grid w-full px-0 py-0 xl:flex-1 xl:min-h-0 xl:overflow-hidden">
        <div className="grid xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:overflow-hidden">
          <AutopilotVisualStage
            locale={locale}
            currentProjectId={currentProjectId}
            job={pageProjection.visualJob}
            latestSceneJobId={latestSceneJobIdRef.current}
            routeSet={routeSet}
            selection={selection}
            specTree={pageProjection.visualSpecTree}
            agentCrew={pageProjection.visualAgentCrew}
            effectPreviews={pageProjection.visualEffectPreviews}
            capabilityEvidence={pageProjection.visualCapabilityEvidence}
            consoleLines={consoleLines}
          />

          <MirofishThemeProvider enabled className="min-w-0 xl:h-full xl:min-h-0" style={{ minWidth: 0, maxWidth: "100%" }}>
          <AutopilotWorkflowRail
            locale={locale}
            targetText={targetText}
            setTargetText={setTargetText}
            githubInput={githubInput}
            setGithubInput={setGithubInput}
            parsedGithub={parsedGithub}
            intake={intake}
            projectContext={projectContext}
            loadingContext={loadingContext}
            clarificationSession={clarificationSession}
            readiness={readiness}
            answerDrafts={answerDrafts}
            routeSet={routeSet}
            selection={selection}
            specTree={specTree}
            latestJob={latestJob}
            selectingRouteId={selectingRouteId}
            creatingIntake={creatingIntake}
            generatingClarifications={generatingClarifications}
            savingAnswers={savingAnswers}
            generatingRouteSet={generatingRouteSet}
            canCreateIntake={canCreateIntake}
            canGenerateRouteSet={canGenerateRouteSet}
            agentCrew={autopilotAgentCrew}
            capabilities={autopilotCapabilities}
            capabilityInvocations={autopilotCapabilityInvocations}
            capabilityEvidence={autopilotCapabilityEvidence}
            effectPreviews={autopilotEffectPreviews}
            flowSteps={flowSteps}
            onCreateIntake={handleCreateIntake}
            onGenerateClarifications={handleGenerateClarifications}
            onAnswerChange={handleAnswerChange}
            onSubmitTargetEdit={handleSubmitTargetEdit}
            onSubmitGithubUrlEdit={handleSubmitGithubUrlEdit}
            onSubmitClarificationEdit={handleSubmitClarificationEdit}
            onSubmitRouteSelectionEdit={handleSubmitRouteSelectionEdit}
            onSubmitAnswers={handleSaveAnswers}
            onGenerateRouteSet={handleGenerateRouteSet}
            onSelectRoute={handleSelectRoute}
            apiError={apiError}
            rightRailView={rightRailView}
            fabricSubStage={fabricSubStage}
            subStageContext={subStageState}
            viewportTier={viewportTier}
            drawerOpen={drawerOpen}
            onDrawerOpenChange={setDrawerOpen}
            rightRailCollapsed={rightRailCollapsed}
            onRightRailCollapsedChange={setRightRailCollapsed}
            pageTransitionState={pageTransition.state}
            activeAutopilotPage={activeAutopilotPage}
            coordinator={autopilotCoordinator}
            onForceAdvance={autoAdvance.forceAdvance}
            autoAdvancing={autoAdvance.advancing}
            autoAdvancingTo={autoAdvance.advancingTo}
            workflowStageOverride={workflowStageOverride}
            onNavigateWorkflowStage={handleNavigateWorkflowStage}
            onJobUpdated={handleCoordinationJobUpdated}
            onHistoryJobSelected={handleHistoryJobSelected}
            onBranchJobActivated={handleReplanBranchJobActivated}
            onHistoryPanelClosed={async () => {
              await refreshLatestGenerationSnapshot();
            }}
            generateSpecDocuments={pagesBlueprintRuntime?.generateSpecDocuments}
            onSpecDocumentsGenerated={response => {
              // autopilot-spec-tree-workbench（2026-05-17）：把 SpecTreeWorkbench
              // 从右栏发出的响应回写到 latestJob，让 rightRailView 的派生层
              // 重算 specTree / specDocuments；同名 onForceAdvance 已在
              // AutopilotWorkflowRail 内部触发，这里只负责承接 setLatestJob。
              handleCoordinationJobUpdated(response.job);
              setSpecTree(response.specTree);
              if (IS_GITHUB_PAGES && pagesBlueprintRuntime) {
                void refreshPagesBlueprintSnapshot();
              }
            }}
          />
          </MirofishThemeProvider>

        </div>
      </div>
    </main>
  );
}


// ---------------------------------------------------------------------------
// wt3 任务 3 注记（autopilot-blueprint-refactor-split） + Spec 3 收口注记
//（autopilot-advanced-workbench-inline）：
//
// 本文件仍为 AutopilotRoutePage 的**物理真相源**，包含：
//   - 五个阶段面板（input / clarification / routeset / selection / fabric）
//     内联组件：AutopilotWorkflowRail、ClarificationPanel、RouteOption、
//     AutopilotSpecTreeHandoffPanel
//   - 三个辅助组件：AutopilotConsolePanel、AutopilotVisualStage、AutopilotMissionHud
//
// Spec 3 已收口：
//   - 物理删除底部 Advanced_Workbenches_Fold 折叠区与其内嵌的 blueprint 进度面板
//     实例；对应的 Layers3 / ArrowRight 图标 import、blueprint 进度面板 import、
//     folded-panel-key 变量与 AgentCrew 汇总组件定义一并移除。
//   - `AutopilotWorkflowRail` 的 `case "fabric":` 分支改为由 `<AutopilotRightRail>`
//     按 `resolveRailSubStage(...)` 派发到 Spec 2 的 8 个 canonical 面板；
//     `AutopilotSpecTreeHandoffPanel` 保留为摘要 + 次级 `/specs` 链接承载。
//   - `AutopilotSpecTreeHandoffPanel` 内 `/specs` 主 CTA 降级为次级文本链接
//     「在独立工作台查看 / View in standalone workbench」，保留 `href={SPECS_PATH}`
//     与 `data-testid="autopilot-open-specs-link"`。
//
// 方案 B 下 `./stages/` 目录已经建立：
//   ./stages/InputStage.tsx
//   ./stages/ClarificationStage.tsx
//   ./stages/RouteSetStage.tsx
//   ./stages/SelectionStage.tsx
//   ./stages/FabricStage.tsx
//   ./stages/ConsolePanel.tsx
//   ./stages/AutopilotVisualStage.tsx
//   ./stages/AutopilotWorkflowRail.tsx
//   ./stages/index.ts
//
// 其中 `SelectionStage.tsx` 已经 re-export 了现有的 AutopilotSpecTreeHandoffPanel；
// 其余文件目前是占位，等物理抽离时填入真实 export。
//
// 物理迁移路径（后续 iteration）：
// 1. 逐个把本文件内的阶段组件标记 `export`（不删除本地使用）；
// 2. 在对应 stages/*.tsx 中改为 `export { ... } from "../AutopilotRoutePage.js"`；
// 3. 把组件 **实物** 搬到 stages/*.tsx，本文件保留 barrel re-export；
// 4. 最终 AutopilotRoutePage.tsx 只保留阶段编排与 hook 接线。
//
// 当前任务 3 不做物理瘦身：目的是保证 wt3 不 break 现有 UI，同时把目录结构建好，
// 让后续拆分零破坏下游（需求 2.5、2.7、6.2）。
// ---------------------------------------------------------------------------
