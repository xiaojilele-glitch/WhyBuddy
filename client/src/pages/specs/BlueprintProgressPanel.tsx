import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  FileCheck2,
  GitBranch,
  Layers3,
  ListChecks,
  PackageCheck,
  PlayCircle,
  RefreshCw,
  Route,
  Send,
  Sparkles,
  Terminal,
  Undo2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  createBlueprintEngineeringRun,
  createBlueprintGenerationJob,
  diffBlueprintArtifacts,
  fetchBlueprintCapabilities,
  fetchBlueprintCapabilityEvidence,
  fetchBlueprintCapabilityInvocations,
  fetchBlueprintJobCapabilities,
  fetchBlueprintArtifactLedger,
  fetchBlueprintArtifactReplays,
  fetchBlueprintEffectPreviews,
  fetchBlueprintEngineeringLanding,
  fetchBlueprintEngineeringRuns,
  fetchLatestBlueprintGenerationJob,
  fetchBlueprintPromptPackages,
  fetchBlueprintSpecsProgress,
  generateBlueprintEngineeringLanding,
  generateBlueprintEffectPreview,
  generateBlueprintPromptPackages,
  invokeBlueprintCapability,
  recordBlueprintArtifactFeedback,
  replayBlueprintArtifact,
  resetBlueprintRouteSelection,
  selectBlueprintRoute,
  type BlueprintArtifactDiff,
  type BlueprintArtifactFeedback,
  type BlueprintArtifactLedgerEntry,
  type BlueprintArtifactReplay,
  type BlueprintDocumentProgress,
  type BlueprintAgentCrewSnapshot,
  type BlueprintClarificationStrategyQuestion,
  type BlueprintClarificationStrategySession,
  type BlueprintCapabilityEvidence,
  type BlueprintCapabilityInvocation,
  type BlueprintEngineeringLandingPlan,
  type BlueprintEngineeringRun,
  type BlueprintEngineeringRunStatus,
  type BlueprintEffectPreviewRuntimeProjection,
  type BlueprintEffectPreviewSnapshot,
  type BlueprintPromptPackage,
  type BlueprintPromptTargetPlatform,
  type BlueprintRuntimeCapability,
  type BlueprintEffectPreviewLogEntry,
  normalizeBlueprintEffectPreviewRuntimeProjection,
  normalizeBlueprintEngineeringLandingResponse,
  normalizeBlueprintEngineeringRunsResponse,
  type BlueprintSpecsProgress,
  type BlueprintTaskProgress,
} from "@/lib/blueprint-api";
import type { ApiRequestError } from "@/lib/api-client";
import { blueprintCopy } from "@/lib/blueprint-copy";
import { cn } from "@/lib/utils";
import type {
  BlueprintGenerationJob,
  BlueprintRouteCandidate,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintRolePresenceState,
  BlueprintRoleTimelineEntry,
  BlueprintSpecDocument,
  BlueprintSpecTree,
  BlueprintSpecTreeVersionSnapshot,
} from "@shared/blueprint/contracts";

import SpecTreeWorkbenchPanel from "./SpecTreeWorkbenchPanel";
import SpecDocumentWorkbenchPanel from "./SpecDocumentWorkbenchPanel";

type BlueprintEffectPreview = BlueprintEffectPreviewSnapshot & { title?: string };
type BlueprintEffectPreviewWithProjection = BlueprintEffectPreview & {
  runtimeProjection?: BlueprintEffectPreviewRuntimeProjection;
  runtime_projection?: unknown;
  projection?: unknown;
};
type BlueprintRoleEventConsumerId = "scene" | "hud" | "logs" | "browser" | "spec";
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
type BlueprintEffectPreviewWithVersionSync = BlueprintEffectPreview & {
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

interface BlueprintProgressPanelProps {
  className?: string;
  initialData?: BlueprintSpecsProgress | null;
  initialJob?: BlueprintGenerationJob | null;
  initialRouteSet?: BlueprintRouteSet | null;
  initialSelection?: BlueprintRouteSelection | null;
  initialSpecTree?: BlueprintSpecTree | null;
  initialSpecTreeVersions?: BlueprintSpecTreeVersionSnapshot[] | null;
  initialSpecDocuments?: BlueprintSpecDocument[] | null;
  initialEffectPreviews?: BlueprintEffectPreview[] | null;
  initialPromptPackages?: BlueprintPromptPackage[] | null;
  initialCapabilities?: BlueprintRuntimeCapability[] | null;
  initialAgentCrew?: BlueprintAgentCrewSnapshot | null;
  initialClarificationSession?: BlueprintClarificationStrategySession | null;
  initialCapabilityInvocations?: BlueprintCapabilityInvocation[] | null;
  initialCapabilityEvidence?: BlueprintCapabilityEvidence[] | null;
  initialEngineeringLandingPlans?: BlueprintEngineeringLandingPlan[] | null;
  initialEngineeringRuns?: BlueprintEngineeringRun[] | null;
  initialArtifactLedgerEntries?: BlueprintArtifactLedgerEntry[] | null;
  initialArtifactReplays?: BlueprintArtifactReplay[] | null;
  initialArtifactFeedback?: BlueprintArtifactFeedback[] | null;
  autoLoad?: boolean;
  projectId?: string | null;
  showRouteGeneration?: boolean;
  showSpecProgress?: boolean;
  showSpecTreePreview?: boolean;
  showSpecDocumentWorkbench?: boolean;
  showEffectPreviewWorkbench?: boolean;
  showPromptPackageWorkbench?: boolean;
  showRuntimeCapabilityBridgeWorkbench?: boolean;
  showEngineeringLandingWorkbench?: boolean;
  showArtifactMemoryWorkbench?: boolean;
}

const DOC_LABELS: Array<{
  key: keyof Pick<
    BlueprintDocumentProgress,
    "requirements" | "design" | "tasks"
  >;
  label: string;
}> = [
  { key: "requirements", label: "需求" },
  { key: "design", label: "设计" },
  { key: "tasks", label: "任务" },
];

function formatGeneratedAt(value: string): string {
  if (!value) return "待同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBlueprintJobStatus(job: BlueprintGenerationJob | null): string {
  if (!job) return "尚未生成 RouteSet";
  if (job.stage === "spec_tree" && job.status === "reviewing") {
    return "SPEC 树草稿已生成，等待推导工作台确认";
  }
  return `${blueprintCopy(job.stage)} / ${blueprintCopy(job.status)}`;
}

function taskPercent(tasks: BlueprintTaskProgress): number {
  if (tasks.total <= 0) return tasks.percent;
  return Math.round((tasks.completed / tasks.total) * 100);
}

function routeLevelLabel(level: string): string {
  if (level === "low") return "低";
  if (level === "medium") return "中";
  if (level === "high") return "高";
  if (level === "light") return "轻量";
  if (level === "balanced") return "均衡";
  if (level === "deep") return "深度";
  return level;
}

function SummaryTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-xl font-black text-slate-950">{value}</div>
      <div className="mt-1 text-[10px] font-black uppercase tracking-normal text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-semibold text-slate-500">
        {detail}
      </div>
    </div>
  );
}

function DocsChecklist({ docs }: { docs: BlueprintDocumentProgress }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-500">
        <span>文档</span>
        <span>
          {docs.completed}/{docs.total}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DOC_LABELS.map(item => {
          const complete = docs[item.key];
          return (
            <Badge
              key={item.key}
              variant="outline"
              className={cn(
                "rounded-full border-slate-200 bg-white text-[10px] font-black",
                complete
                  ? "border-[#0f766e]/30 bg-[#0f766e]/10 text-[#0f766e]"
                  : "border-slate-200 bg-slate-100 text-slate-400"
              )}
            >
              {item.label}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

function TasksProgress({ tasks }: { tasks: BlueprintTaskProgress }) {
  const percent = taskPercent(tasks);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-500">
        <span>任务</span>
        <span>
          {tasks.completed}/{tasks.total} / {percent}%
        </span>
      </div>
      <Progress
        value={percent}
        className="mt-2 h-1.5 bg-slate-200 [&_[data-slot=progress-indicator]]:bg-[#0f766e]"
        aria-label={`蓝图任务完成度 ${percent}%`}
      />
    </div>
  );
}

function parseGenerationInput(value: string): {
  targetText?: string;
  githubUrls: string[];
} {
  const lines = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const githubUrls = Array.from(
    new Set(
      lines.filter(line =>
        /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/i.test(line)
      )
    )
  );
  const targetText = lines
    .filter(line => !githubUrls.includes(line))
    .join("\n")
    .trim();

  return {
    targetText: targetText || undefined,
    githubUrls,
  };
}

function RouteMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-xs font-black text-slate-700">{value}</div>
    </div>
  );
}

function RouteCandidateCard({
  route,
  primary,
  selected,
  selecting,
  onSelect,
}: {
  route: BlueprintRouteCandidate;
  primary: boolean;
  selected: boolean;
  selecting: boolean;
  onSelect?: (routeId: string) => void;
}) {
  return (
    <article
      className={cn(
        "rounded-[18px] border px-4 py-4",
        selected
          ? "border-[#0f766e] bg-[#0f766e]/12"
          : primary
            ? "border-[#0f766e]/30 bg-[#0f766e]/10"
            : "border-slate-200 bg-slate-50"
      )}
      data-testid="blueprint-route-candidate"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                "rounded-full",
                selected
                  ? "bg-[#0f766e] text-white hover:bg-[#0f766e]"
                  : primary
                    ? "bg-[#0f766e] text-white hover:bg-[#0f766e]"
                    : "bg-white text-slate-500 hover:bg-white"
              )}
            >
              {selected ? "已选" : primary ? "主路" : "备选"}
            </Badge>
            <span className="text-xs font-black text-slate-400">
              {blueprintCopy(route.estimatedEffort)}
            </span>
          </div>
          <h3 className="mt-2 text-base font-black leading-6 text-slate-950">
            {blueprintCopy(route.title)}
          </h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
            {blueprintCopy(route.summary)}
          </p>
        </div>
        <Button
          type="button"
          variant={selected ? "default" : "outline"}
          size="sm"
          className={cn(
            "gap-2 rounded-full font-black",
            selected
              ? "bg-[#0f766e] text-white hover:bg-[#115e59]"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
          )}
          disabled={selected || selecting || !onSelect}
          onClick={() => onSelect?.(route.id)}
          data-testid="blueprint-select-route-button"
        >
          {selected ? (
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
          ) : selecting ? (
            <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <GitBranch className="size-3.5" aria-hidden="true" />
          )}
          {selected ? "已选择" : "选择"}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <RouteMetric label="风险" value={routeLevelLabel(route.riskLevel)} />
        <RouteMetric label="成本" value={routeLevelLabel(route.costLevel)} />
        <RouteMetric label="深度" value={routeLevelLabel(route.complexity)} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {route.capabilities.slice(0, 5).map(capability => (
          <Badge
            key={capability.id}
            variant="outline"
            className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
          >
            {blueprintCopy(capability.label)}
          </Badge>
        ))}
      </div>

      <div className="mt-3 grid gap-2">
        {route.steps.slice(0, 4).map(step => (
          <div
            key={step.id}
            className="grid gap-1 rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2 font-black text-slate-700">
              <span>{blueprintCopy(step.title)}</span>
              <span className="text-slate-400">{blueprintCopy(step.role)}</span>
            </div>
            <div className="font-semibold leading-5 text-slate-500">
              {blueprintCopy(step.description)}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function RouteSetPreview({
  routeSet,
  job,
  selection,
  selectingRouteId,
  onSelectRoute,
  resettingSelection,
  onResetSelection,
}: {
  routeSet: BlueprintRouteSet;
  job: BlueprintGenerationJob | null;
  selection: BlueprintRouteSelection | null;
  selectingRouteId: string | null;
  onSelectRoute?: (routeId: string) => void;
  resettingSelection?: boolean;
  onResetSelection?: () => void;
}) {
  const primaryRoute =
    routeSet.routes.find(route => route.id === routeSet.primaryRouteId) ??
    routeSet.routes[0];
  const alternativeRoutes = routeSet.routes.filter(
    route => route.id !== primaryRoute?.id
  );

  return (
    <div
      className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4"
      data-testid="blueprint-routeset-preview"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
            <Route className="size-3.5" aria-hidden="true" />
            自动驾驶 RouteSet
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">
            {selection
              ? "已选择用于推导的路线"
              : job?.status === "completed"
                ? "可生成 SPEC 树"
                : "路线草稿"}
          </h3>
          <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
            {blueprintCopy(routeSet.nextAsset.description)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selection ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 rounded-full border-slate-200 bg-white font-black text-slate-600 hover:bg-slate-100"
              disabled={resettingSelection || !onResetSelection}
              onClick={onResetSelection}
              data-testid="blueprint-reset-route-selection-button"
            >
              {resettingSelection ? (
                <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Undo2 className="size-3.5" aria-hidden="true" />
              )}
              重置路线
            </Button>
          ) : null}
          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500">
            {routeSet.routes.length} 条路线
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {primaryRoute ? (
          <RouteCandidateCard
            route={primaryRoute}
            primary
            selected={selection?.routeId === primaryRoute.id}
            selecting={selectingRouteId === primaryRoute.id}
            onSelect={onSelectRoute}
          />
        ) : null}
        {alternativeRoutes.map(route => (
          <RouteCandidateCard
            key={route.id}
            route={route}
            primary={false}
            selected={selection?.routeId === route.id}
            selecting={selectingRouteId === route.id}
            onSelect={onSelectRoute}
          />
        ))}
      </div>
    </div>
  );
}

type LatestJobWithEffectPreviews = {
  effectPreviews?: BlueprintEffectPreview[];
  effect_previews?: BlueprintEffectPreview[];
  runtimeProjection?: BlueprintEffectPreviewRuntimeProjection;
  runtime_projection?: unknown;
  projection?: unknown;
};

type LatestJobWithPromptPackages = {
  promptPackages?: BlueprintPromptPackage[];
  prompt_packages?: BlueprintPromptPackage[];
};

type LatestJobWithRuntimeCapabilities = {
  capabilities?: BlueprintRuntimeCapability[];
  runtimeCapabilities?: BlueprintRuntimeCapability[];
  runtime_capabilities?: BlueprintRuntimeCapability[];
  agentCrew?: BlueprintAgentCrewSnapshot;
  agent_crew?: BlueprintAgentCrewSnapshot;
  capabilityInvocations?: BlueprintCapabilityInvocation[];
  capability_invocations?: BlueprintCapabilityInvocation[];
  invocations?: BlueprintCapabilityInvocation[];
  capabilityEvidence?: BlueprintCapabilityEvidence[];
  capability_evidence?: BlueprintCapabilityEvidence[];
  evidence?: BlueprintCapabilityEvidence[];
};

type LatestJobWithClarificationSession = {
  clarificationSession?: BlueprintClarificationStrategySession;
  clarification_session?: BlueprintClarificationStrategySession;
  session?: BlueprintClarificationStrategySession;
  intake?: {
    clarificationSession?: BlueprintClarificationStrategySession;
    clarification_session?: BlueprintClarificationStrategySession;
  };
};

type LatestJobWithEngineeringLanding = {
  job?: { id?: string };
  jobId?: string;
  job_id?: string;
  landingPlans?: BlueprintEngineeringLandingPlan[];
  landing_plans?: BlueprintEngineeringLandingPlan[];
  engineeringLandingPlans?: BlueprintEngineeringLandingPlan[];
  engineering_landing_plans?: BlueprintEngineeringLandingPlan[];
  engineeringRuns?: BlueprintEngineeringRun[];
  engineering_runs?: BlueprintEngineeringRun[];
  runs?: BlueprintEngineeringRun[];
};

type LatestJobWithArtifactMemory = {
  artifactLedgerEntries?: BlueprintArtifactLedgerEntry[];
  artifact_ledger_entries?: BlueprintArtifactLedgerEntry[];
  ledgerEntries?: BlueprintArtifactLedgerEntry[];
  ledger_entries?: BlueprintArtifactLedgerEntry[];
  artifactReplays?: BlueprintArtifactReplay[];
  artifact_replays?: BlueprintArtifactReplay[];
  replays?: BlueprintArtifactReplay[];
  artifactFeedback?: BlueprintArtifactFeedback[];
  artifact_feedback?: BlueprintArtifactFeedback[];
  feedbackEntries?: BlueprintArtifactFeedback[];
  feedback_entries?: BlueprintArtifactFeedback[];
};

type LatestJobWithSpecTreeVersions = {
  specTreeVersions?: BlueprintSpecTreeVersionSnapshot[];
  spec_tree_versions?: BlueprintSpecTreeVersionSnapshot[];
  treeVersions?: BlueprintSpecTreeVersionSnapshot[];
  tree_versions?: BlueprintSpecTreeVersionSnapshot[];
};

function readLatestSpecTreeVersions(
  value: unknown
): BlueprintSpecTreeVersionSnapshot[] {
  const record = value as LatestJobWithSpecTreeVersions | null;
  const versions =
    record?.specTreeVersions ??
    record?.spec_tree_versions ??
    record?.treeVersions ??
    record?.tree_versions ??
    [];
  return Array.isArray(versions) ? versions : [];
}

function readLatestEffectPreviews(value: unknown): BlueprintEffectPreview[] {
  const record = value as LatestJobWithEffectPreviews | null;
  const previews = record?.effectPreviews ?? record?.effect_previews ?? [];
  if (!Array.isArray(previews)) return [];

  const latestProjection =
    record?.runtimeProjection ?? record?.runtime_projection ?? record?.projection;
  if (!latestProjection) {
    return previews;
  }

  return previews.map((preview, index) =>
    index === 0 &&
    !runtimeProjectionHasSignal(
      normalizeRuntimeProjection(preview, readRuntimeProjection(preview))
    )
      ? ({
          ...preview,
          runtimeProjection: normalizeRuntimeProjection(preview, latestProjection),
        } satisfies BlueprintEffectPreviewWithProjection)
      : preview
  );
}

function readLatestPromptPackages(value: unknown): BlueprintPromptPackage[] {
  const record = value as LatestJobWithPromptPackages | null;
  const packages = record?.promptPackages ?? record?.prompt_packages ?? [];
  return Array.isArray(packages) ? packages : [];
}

function readLatestCapabilities(value: unknown): BlueprintRuntimeCapability[] {
  const record = value as LatestJobWithRuntimeCapabilities | null;
  const capabilities =
    record?.capabilities ??
    record?.runtimeCapabilities ??
    record?.runtime_capabilities ??
    [];
  return Array.isArray(capabilities) ? capabilities : [];
}

function readLatestAgentCrew(value: unknown): BlueprintAgentCrewSnapshot | null {
  const record = value as LatestJobWithRuntimeCapabilities | null;
  return record?.agentCrew ?? record?.agent_crew ?? null;
}

function readLatestClarificationSession(
  value: unknown
): BlueprintClarificationStrategySession | null {
  const record = value as LatestJobWithClarificationSession | null;
  return (
    record?.clarificationSession ??
    record?.clarification_session ??
    record?.session ??
    record?.intake?.clarificationSession ??
    record?.intake?.clarification_session ??
    null
  );
}

function readLatestCapabilityInvocations(
  value: unknown
): BlueprintCapabilityInvocation[] {
  const record = value as LatestJobWithRuntimeCapabilities | null;
  const invocations =
    record?.capabilityInvocations ??
    record?.capability_invocations ??
    record?.invocations ??
    [];
  return Array.isArray(invocations) ? invocations : [];
}

function readLatestCapabilityEvidence(
  value: unknown
): BlueprintCapabilityEvidence[] {
  const record = value as LatestJobWithRuntimeCapabilities | null;
  const evidence =
    record?.capabilityEvidence ??
    record?.capability_evidence ??
    record?.evidence ??
    [];
  return Array.isArray(evidence) ? evidence : [];
}

function readLatestEngineeringLandingPlans(
  value: unknown
): BlueprintEngineeringLandingPlan[] {
  const record = value as LatestJobWithEngineeringLanding | null;
  const fallbackJobId = record?.job?.id ?? record?.jobId ?? record?.job_id ?? "";
  return normalizeBlueprintEngineeringLandingResponse(
    value,
    fallbackJobId
  ).landingPlans;
}

function readLatestEngineeringRuns(value: unknown): BlueprintEngineeringRun[] {
  const record = value as LatestJobWithEngineeringLanding | null;
  const fallbackJobId = record?.job?.id ?? record?.jobId ?? record?.job_id ?? "";
  return normalizeBlueprintEngineeringRunsResponse(
    value,
    fallbackJobId
  ).engineeringRuns;
}

function readLatestArtifactLedgerEntries(
  value: unknown
): BlueprintArtifactLedgerEntry[] {
  const record = value as LatestJobWithArtifactMemory | null;
  const entries =
    record?.artifactLedgerEntries ??
    record?.artifact_ledger_entries ??
    record?.ledgerEntries ??
    record?.ledger_entries ??
    [];
  return Array.isArray(entries) ? entries : [];
}

function readLatestArtifactReplays(value: unknown): BlueprintArtifactReplay[] {
  const record = value as LatestJobWithArtifactMemory | null;
  const replays =
    record?.artifactReplays ?? record?.artifact_replays ?? record?.replays ?? [];
  return Array.isArray(replays) ? replays : [];
}

function readLatestArtifactFeedback(
  value: unknown
): BlueprintArtifactFeedback[] {
  const record = value as LatestJobWithArtifactMemory | null;
  const feedback =
    record?.artifactFeedback ??
    record?.artifact_feedback ??
    record?.feedbackEntries ??
    record?.feedback_entries ??
    [];
  return Array.isArray(feedback) ? feedback : [];
}

function formatEffectPreviewDate(value: string | undefined): string {
  if (!value) return "预览草稿";
  return formatGeneratedAt(value);
}

const PROMPT_PLATFORM_OPTIONS: Array<{
  id: "all" | BlueprintPromptTargetPlatform;
  label: string;
}> = [
  { id: "all", label: "全部" },
  { id: "cursor", label: "Cursor" },
  { id: "kiro", label: "Kiro" },
  { id: "trae", label: "Trae" },
  { id: "windsurf", label: "Windsurf" },
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
];

function promptPlatformLabel(platform: BlueprintPromptTargetPlatform): string {
  return (
    PROMPT_PLATFORM_OPTIONS.find(option => option.id === platform)?.label ??
    platform
  );
}

function summarizePromptContent(promptPackage: BlueprintPromptPackage): string {
  if (promptPackage.content) return promptPackage.content;
  return promptPackage.sections
    .map(section => section.content)
    .filter(Boolean)
    .join("\n\n");
}

function parseWorkbenchLines(value: string): string[] {
  return value
    .split(/\r?\n|;/)
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function engineeringRunStatusLabel(status: BlueprintEngineeringRunStatus): string {
  const translated = blueprintCopy(status);
  if (translated !== status) return translated;

  return status
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function artifactTokenLabel(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "").trim();
  if (!normalized) return blueprintCopy(fallback);
  const translated = blueprintCopy(normalized);
  if (translated !== normalized) return translated;

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clarificationValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clarificationBooleanLabel(value: boolean | undefined): string | null {
  if (value === undefined) return null;
  return value ? "settled" : "open";
}

function clarificationQuestionDimension(
  question: BlueprintClarificationStrategyQuestion
): string {
  return (
    clarificationValue(question.routeDimension) ||
    clarificationValue(question.kind) ||
    "question"
  );
}

function hasClarificationStrategySignal(
  session: BlueprintClarificationStrategySession | null
): boolean {
  if (!session) return false;
  return Boolean(
    session.strategyId ||
      session.strategyLabel ||
      session.templateId ||
      session.routeDimension ||
      session.readinessSignal ||
      session.routeReadySummary ||
      session.readiness.readinessSignal ||
      session.readiness.routeReadySummary ||
      session.questions.some(
        question =>
          question.strategyId ||
          question.strategyLabel ||
          question.templateId ||
          question.routeDimension ||
          question.readinessSignal ||
          question.routeReadySummary
      )
  );
}

function BlueprintClarificationStrategySummary({
  session,
}: {
  session: BlueprintClarificationStrategySession | null;
}) {
  if (!hasClarificationStrategySignal(session)) return null;

  const strategyLabel =
    clarificationValue(session?.strategyLabel) ||
    clarificationValue(session?.strategyId, "Strategy pending");
  const templateLabel =
    clarificationValue(session?.templateId) ||
    clarificationValue(session?.questions[0]?.templateId, "Template pending");
  const readinessSignal =
    clarificationValue(session?.readinessSignal) ||
    clarificationValue(session?.readiness.readinessSignal) ||
    artifactTokenLabel(session?.readiness.status, "Readiness pending");
  const routeReadySummary =
    clarificationValue(session?.routeReadySummary) ||
    clarificationValue(session?.readiness.routeReadySummary);
  const settledLabel = clarificationBooleanLabel(session?.settledByStrategy);
  const visibleQuestions = session?.questions.slice(0, 4) ?? [];

  return (
    <div
      className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4"
      data-testid="blueprint-clarification-strategy-summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-normal text-slate-500">
            Clarification Strategy
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">
            {blueprintCopy(strategyLabel)}
          </h3>
          <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
            {blueprintCopy(
              routeReadySummary ||
                "Strategy metadata is linked to the clarification session."
            )}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge
            variant="outline"
            className="rounded-full border-[#0f766e]/25 bg-white text-[10px] font-black text-[#0f766e]"
          >
            {blueprintCopy(templateLabel)}
          </Badge>
          <Badge
            variant="outline"
            className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
          >
            {blueprintCopy(readinessSignal)}
          </Badge>
          {settledLabel ? (
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
            >
              {settledLabel}
            </Badge>
          ) : null}
        </div>
      </div>

      {visibleQuestions.length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {visibleQuestions.map(question => (
            <div
              key={question.id}
              className="rounded-[12px] border border-slate-200 bg-white px-3 py-2"
              data-testid="blueprint-clarification-strategy-question"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
                >
                  {blueprintCopy(clarificationQuestionDimension(question))}
                </Badge>
                {question.readinessSignal ? (
                  <span className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                    {blueprintCopy(question.readinessSignal)}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 line-clamp-2 text-xs font-bold leading-5 text-slate-700">
                {blueprintCopy(question.prompt)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function agentRoleStateLabel(state: string): string {
  if (state === "active") return "Active";
  if (state === "watching") return "Watching";
  if (state === "reviewing") return "Reviewing";
  if (state === "sleeping") return "Sleeping";
  return artifactTokenLabel(state, "Status");
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

function agentRoleStateDetail(state: string): string {
  if (state === "active") return "driving current work";
  if (state === "watching") return "watching handoff signals";
  if (state === "reviewing") return "reviewing evidence";
  if (state === "sleeping") return "standing by";
  return "role presence";
}

function latestAgentRoleItem(
  values: string[],
  explicit: string | undefined,
  fallback: string
): string {
  return explicit || values[0] || fallback;
}

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
  projection: BlueprintEffectPreviewRuntimeProjection | null | undefined
): BlueprintRoleEventProjection {
  const events = collectRoleTimelineEvents(agentCrew, projection);
  const latestEvent = events.at(-1);
  const sceneEvent = latestRoleEventByPredicate(
    events,
    event => {
      const text = roleEventSearchText(event);
      return (
        text.includes("3d") ||
        text.includes("scene") ||
        text.includes("snapshot") ||
        event.stage === "spec_tree" ||
        Boolean(event.specTreeId || event.nodeId)
      );
    }
  );
  const hudEvent = latestRoleEventByPredicate(
    events,
    event => {
      const text = roleEventSearchText(event);
      return text.includes("hud") || event.type === "role.activated";
    }
  );
  const logEvent = latestRoleEventByPredicate(
    events,
    event =>
      event.type === "role.capability_invoked" ||
      Boolean(event.capabilityId) ||
      Boolean(event.evidenceId)
  );
  const browserEvent = latestRoleEventByPredicate(
    events,
    event => {
      const text = roleEventSearchText(event);
      return text.includes("browser") || text.includes("preview");
    }
  );
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
        label: "3D Scene",
        value:
          projection?.sceneSnapshotId ||
          roleEventValue(sceneEvent, "Waiting for scene role event"),
        detail: sceneEvent
          ? `Role event ${sceneEvent.eventId} keeps scene state aligned.`
          : projection?.sceneSnapshotId
            ? "Scene snapshot is linked to the runtime projection."
            : "No scene role event yet.",
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
          roleEventValue(hudEvent, "Waiting for HUD role event"),
        detail: hudEvent
          ? `Role event ${hudEvent.eventId} drives HUD presence ${agentRoleStateLabel(
              hudEvent.presenceState
            )}.`
          : projection?.hudState.badges.length
            ? projection.hudState.badges.join(" / ")
            : `${artifactTokenLabel(projection?.hudState.status, "preview")} status`,
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
        label: "Logs",
        value:
          roleEventValue(logEvent, projection?.logTimeline[0]?.message ?? "") ||
          "Waiting for runtime logs",
        detail: logEvent
          ? `Role event ${logEvent.eventId} is mirrored in logs.`
          : projection?.logTimeline[0]?.occurredAt ||
            `${projection?.logTimeline.length ?? 0} runtime log entries`,
        status: roleEventProjectionStatus(logEvent, "pending"),
        roleState: logEvent?.presenceState,
        eventType: logEvent?.type,
        sourceEventId: logEvent?.eventId,
      },
      {
        id: "browser",
        label: "Browser",
        value:
          projection?.browserPreviewId ||
          projection?.browserPreview.url ||
          roleEventValue(browserEvent, "Waiting for browser role event"),
        detail: browserEvent
          ? `Role event ${browserEvent.eventId} keeps browser preview aligned.`
          : projection?.browserPreview.url ||
            projection?.browserPreview.summary ||
            projection?.browserPreview.title ||
            "No browser preview role event yet.",
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
        label: "SPEC UI",
        value: roleEventValue(specEvent ?? latestEvent, "Waiting for SPEC role event"),
        detail: specEvent
          ? `Role event ${specEvent.eventId} is visible in SPEC UI.`
          : latestEvent
            ? `Latest role event ${latestEvent.eventId} is visible in SPEC UI.`
            : "No role event stream entries yet.",
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

function previewRecord(
  preview: BlueprintEffectPreview | null | undefined
): BlueprintEffectPreviewWithVersionSync | null {
  return (preview as BlueprintEffectPreviewWithVersionSync | null | undefined) ?? null;
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

function previewStatusLabel(value: unknown): string {
  return artifactTokenLabel(previewString(value, "current"), "Current");
}

function previewNodeProgressLabel(
  preview: BlueprintEffectPreview | null | undefined
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
    ? `${previewStatusLabel(status)} / ${completion}%`
    : previewStatusLabel(status);
}

function EffectPreviewVersionSync({
  preview,
}: {
  preview: BlueprintEffectPreview | null;
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
  const refreshedAt = previewString(record?.refreshedAt ?? record?.refreshed_at);
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
          Version {blueprintCopy(version)}
        </Badge>
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
        >
          {previewStatusLabel(versionStatus)}
        </Badge>
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
        >
          SpecTree {blueprintCopy(specTreeVersion)}
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
            {blueprintCopy(previewNodeProgressLabel(preview))}
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
              ? blueprintCopy(dependencyOrder.join(" -> "))
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
          {refreshedAt ? `Refreshed ${formatEffectPreviewDate(refreshedAt)}` : "Refreshed"}
          {sourceSnapshotHash ? ` / ${sourceSnapshotHash}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function readRuntimeProjection(
  preview: BlueprintEffectPreview | null | undefined
): unknown {
  const candidate = preview as BlueprintEffectPreviewWithProjection | null | undefined;
  return (
    candidate?.runtimeProjection ??
    candidate?.runtime_projection ??
    candidate?.projection
  );
}

function normalizeRuntimeProjection(
  preview: BlueprintEffectPreview | null | undefined,
  value: unknown
): BlueprintEffectPreviewRuntimeProjection {
  return normalizeBlueprintEffectPreviewRuntimeProjection(value, {
    previewId: preview?.id,
    jobId: preview?.jobId,
    treeId: preview?.treeId,
    nodeId: preview?.nodeId,
    title: preview?.title,
    summary: preview?.summary,
    status: preview?.status,
  });
}

function runtimeProjectionHasSignal(
  projection: BlueprintEffectPreviewRuntimeProjection
): boolean {
  return Boolean(
    projection.sceneSnapshotId ||
      projection.browserPreviewId ||
      projection.browserPreview.url ||
      projection.logTimeline.length > 0 ||
      projection.hudState.progressPercent > 0 ||
      projection.hudState.badges.length > 0
  );
}

function runtimeProjectionValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function RuntimeProjectionCard({
  label,
  value,
  detail,
  status,
}: {
  label: string;
  value: string;
  detail: string;
  status: string;
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
            {blueprintCopy(value)}
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
          {artifactTokenLabel(status, "State")}
        </Badge>
      </div>
      <div className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
        {blueprintCopy(detail)}
      </div>
    </div>
  );
}

function EffectPreviewRuntimeProjection({
  preview,
  roleEventProjection,
}: {
  preview: BlueprintEffectPreview | null;
  roleEventProjection?: BlueprintRoleEventProjection;
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
      new Map(
        (roleEventProjection?.items ?? []).map(item => [item.id, item])
      ),
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
            Runtime Projection
          </div>
          <h4 className="mt-2 truncate text-base font-black text-slate-950">
            {blueprintCopy(projection.hudState.title || "Runtime capability projection")}
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
          label="3D Scene"
          value={runtimeProjectionValue(
            projection.sceneSnapshotId || sceneRoleItem?.value,
            "Waiting for scene snapshot"
          )}
          detail={
            sceneRoleItem?.detail ||
            (projection.sceneSnapshotId
              ? "Scene snapshot is linked."
              : "No scene snapshot yet.")
          }
          status={sceneRoleItem?.status ?? (hasScene ? "ready" : "pending")}
        />
        <RuntimeProjectionCard
          label="HUD"
          value={runtimeProjectionValue(
            projection.hudState.summary || hudRoleItem?.value,
            projection.hudState.title || "Waiting for HUD state"
          )}
          detail={
            hudRoleItem?.detail ??
            (projection.hudState.badges.length
              ? projection.hudState.badges.join(" / ")
              : `${artifactTokenLabel(projection.hudState.status, "preview")} status`)
          }
          status={hudRoleItem?.status ?? (hasHud ? projection.hudState.status : "pending")}
        />
        <RuntimeProjectionCard
          label="Logs"
          value={runtimeProjectionValue(
            latestLog?.message || latestProjectedLog?.message || logsRoleItem?.value,
            "Waiting for runtime logs"
          )}
          detail={
            logsRoleItem?.detail ||
            latestProjectedLog?.occurredAt ||
            `${projectedLogs.length} runtime log entries`
          }
          status={logsRoleItem?.status ?? (hasLogs ? latestProjectedLog?.level ?? "ready" : "pending")}
        />
        <RuntimeProjectionCard
          label="Browser"
          value={runtimeProjectionValue(
            projection.browserPreviewId || browserRoleItem?.value,
            projection.browserPreview.url || "Waiting for browser preview"
          )}
          detail={
            browserRoleItem?.detail ||
            projection.browserPreview.url ||
            projection.browserPreview.summary ||
            projection.browserPreview.title ||
            "No browser preview link yet."
          }
          status={browserRoleItem?.status ?? (hasBrowser ? "ready" : "pending")}
        />
      </div>
    </div>
  );
}

const ENGINEERING_RUN_STATUS_OPTIONS: Array<{
  id: BlueprintEngineeringRunStatus;
  label: string;
}> = [
  { id: "passed", label: "通过" },
  { id: "running", label: "进行中" },
  { id: "failed", label: "失败" },
  { id: "blocked", label: "阻塞" },
  { id: "completed", label: "已完成" },
  { id: "planned", label: "计划中" },
];

function EffectPreviewList({
  title,
  items,
}: {
  title: string;
  items: string[];
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
              {blueprintCopy(item)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
          等待生成说明。
        </div>
      )}
    </div>
  );
}

function BlueprintAgentCrewSurface({
  agentCrew,
  capabilities,
  invocations,
  evidence,
  roleEventProjection,
}: {
  agentCrew: BlueprintAgentCrewSnapshot | null;
  capabilities: BlueprintRuntimeCapability[];
  invocations: BlueprintCapabilityInvocation[];
  evidence: BlueprintCapabilityEvidence[];
  roleEventProjection?: BlueprintRoleEventProjection;
}) {
  const roleTimelines = agentCrew?.roleTimelines ?? agentCrew?.presence ?? [];
  const capabilityById = useMemo(
    () => new Map(capabilities.map(capability => [capability.id, capability])),
    [capabilities]
  );
  const invocationById = useMemo(
    () => new Map(invocations.map(invocation => [invocation.id, invocation])),
    [invocations]
  );
  const evidenceById = useMemo(
    () => new Map(evidence.map(item => [item.id, item])),
    [evidence]
  );
  const stateCounts = useMemo(
    () =>
      roleTimelines.reduce(
        (counts, role) => {
          counts[role.state] += 1;
          return counts;
        },
        { active: 0, watching: 0, reviewing: 0, sleeping: 0 }
      ),
    [roleTimelines]
  );
  const streamEventCount =
    roleEventProjection?.eventCount ??
    roleTimelines.reduce((count, role) => count + (role.entries?.length ?? 0), 0);

  if (!agentCrew && roleTimelines.length === 0) return null;

  return (
    <div
      className="mt-4 rounded-[20px] border border-slate-200 bg-white px-4 py-4"
      data-testid="blueprint-agent-crew-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
            <Layers3 className="size-3.5" aria-hidden="true" />
            Agent Crew
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">
            Companion role surface
          </h3>
          <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            {agentCrew?.stage
              ? `${artifactTokenLabel(agentCrew.stage, "runtime_capability")} companion roles are aligned with runtime capabilities, logs, browser preview artifacts, and evidence.`
              : "Companion roles are aligned with runtime capabilities, logs, browser preview artifacts, and evidence."}
          </p>
        </div>
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
        >
          {roleTimelines.length} roles / {streamEventCount} events
        </Badge>
      </div>

      {roleEventProjection ? (
        <div
          className="mt-4 grid gap-2 md:grid-cols-5"
          data-testid="agent-crew-event-stream-consumers"
        >
          {roleEventProjection.items.map(item => (
            <div
              key={item.id}
              className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2"
              data-testid="agent-crew-event-stream-consumer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-[10px] font-black uppercase tracking-normal text-slate-400">
                  {item.label}
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 rounded-full text-[10px] font-black",
                    agentRoleStateClass(item.roleState ?? item.status)
                  )}
                >
                  {agentRoleStateLabel(item.roleState ?? item.status)}
                </Badge>
              </div>
              <div className="mt-1 truncate text-xs font-bold text-slate-700">
                {blueprintCopy(item.value)}
              </div>
              <div className="mt-1 truncate text-[10px] font-bold uppercase tracking-normal text-slate-400">
                {item.sourceEventId
                  ? blueprintCopy(`${item.sourceEventId} / ${item.eventType ?? "role.event"}`)
                  : "Waiting for role event"}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {(["active", "watching", "reviewing", "sleeping"] as const).map(
          state => (
            <SummaryTile
              key={state}
              label={agentRoleStateLabel(state)}
              value={stateCounts[state]}
              detail={agentRoleStateDetail(state)}
            />
          )
        )}
      </div>

      <div className="mt-4 grid gap-3">
        {roleTimelines.length ? (
          roleTimelines.map(role => {
            const latestCapability =
              role.latestCapability ||
              role.capabilityIds
                .map(
                  capabilityId =>
                    capabilityById.get(capabilityId)?.label ?? capabilityId
                )
                .find(Boolean) ||
              role.capabilityLabels[0] ||
              "No capability bound";
            const latestArtifact = latestAgentRoleItem(
              role.artifactIds,
              role.latestArtifact,
              "No artifact yet"
            );
            const latestEvidenceId = latestAgentRoleItem(
              role.evidenceIds,
              role.latestEvidence,
              "No evidence yet"
            );
            const latestEvidence =
              evidenceById.get(latestEvidenceId)?.title ?? latestEvidenceId;
            const relatedInvocation = invocations.find(
              invocation =>
                invocation.roleId === role.roleId ||
                role.capabilityIds.includes(invocation.capabilityId)
            );
            const latestLog =
              relatedInvocation?.logs[0] ??
              (relatedInvocation
                ? invocationById.get(relatedInvocation.id)?.outputSummary
                : "");
            const latestEvent = role.entries?.at(-1);

            return (
              <div
                key={role.id}
                className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3"
                data-testid="blueprint-agent-role-row"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-black text-slate-950">
                        {blueprintCopy(role.displayLabel || role.displayName)}
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full text-[10px] font-black",
                          agentRoleStateClass(role.state)
                        )}
                      >
                        {agentRoleStateLabel(role.state)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
                      >
                        {artifactTokenLabel(role.group, "Role")}
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                      {blueprintCopy(role.currentAction)}
                    </div>
                  </div>
                  <div className="text-right text-[10px] font-black uppercase tracking-normal text-slate-400">
                    {artifactTokenLabel(role.stage, "runtime_capability")}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                      Capability
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-700">
                      {blueprintCopy(latestCapability)}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                      Artifact
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-700">
                      {blueprintCopy(latestArtifact)}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                      Evidence
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-700">
                      {blueprintCopy(latestEvidence)}
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                      Log / Preview
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-700">
                      {blueprintCopy(
                        latestLog ||
                          latestEvent?.summary ||
                          "Awaiting runtime log"
                      )}
                    </div>
                  </div>
                </div>

                {latestEvent ? (
                  <div
                    className="mt-2 rounded-[12px] border border-slate-200 bg-white px-3 py-2"
                    data-testid="agent-crew-role-event-source"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                        Role Event Source
                      </div>
                      <Badge
                        variant="outline"
                        className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
                      >
                        {blueprintCopy(latestEvent.type)}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-700">
                      {blueprintCopy(
                        `${latestEvent.eventId} / ${agentRoleStateLabel(
                          latestEvent.presenceState
                        )}`
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="rounded-[14px] border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
            Agent Crew companion roles will appear after the runtime capability
            bridge returns crew presence.
          </div>
        )}
      </div>
    </div>
  );
}

function EffectPreviewWorkbenchPanel({
  specTree,
  jobId,
  documents,
  initialPreviews,
  agentCrew,
}: {
  specTree: BlueprintSpecTree;
  jobId?: string | null;
  documents: BlueprintSpecDocument[];
  initialPreviews?: BlueprintEffectPreview[];
  agentCrew?: BlueprintAgentCrewSnapshot | null;
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
  const [previews, setPreviews] = useState<BlueprintEffectPreview[]>(
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

  useEffect(() => {
    setPreviews(initialPreviews ?? []);
    setSelectedPreviewId(current =>
      initialPreviews?.some(preview => preview.id === current)
        ? current
        : initialPreviews?.[0]?.id ?? ""
    );
  }, [initialPreviews]);

  useEffect(() => {
    setSelectedNodeId(current =>
      specTree.nodes.some(node => node.id === current)
        ? current
        : previewNodes[0]?.id ?? specTree.rootNodeId
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
    () => normalizeRuntimeProjection(activePreview, readRuntimeProjection(activePreview)),
    [activePreview]
  );
  const roleEventProjection = useMemo(
    () => buildRoleEventProjection(agentCrew, activeRuntimeProjection),
    [activeRuntimeProjection, agentCrew]
  );
  const canGenerate = Boolean(jobId) && acceptedDocuments.length > 0;

  const publishPreviews = useCallback((nextPreviews: BlueprintEffectPreview[]) => {
    setPreviews(nextPreviews);
    setSelectedPreviewId(current =>
      nextPreviews.some(preview => preview.id === current)
        ? current
        : nextPreviews[0]?.id ?? ""
    );
  }, []);

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
  }, [
    acceptedDocuments.length,
    jobId,
    publishPreviews,
    selectedNode?.id,
  ]);

  useEffect(() => {
    if (!jobId || previews.length > 0) return;
    void handleRefresh();
  }, [handleRefresh, jobId, previews.length]);

  return (
    <div
      className="mt-4 rounded-[20px] border border-[#0f766e]/20 bg-[#f0fdfa] px-4 py-4"
      data-testid="effect-preview-workbench"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-[#0f766e]">
            <Sparkles className="size-3.5" aria-hidden="true" />
            效果预演
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">
            已接受 SPEC 的效果预演
          </h3>
          <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            从已接受的 SPEC 文档生成架构说明、原型提示和进度规划。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-full border-[#0f766e]/25 bg-white font-black text-[#0f766e] hover:bg-[#ecfdf5] hover:text-[#115e59]"
            disabled={!jobId || loading || generating}
            onClick={handleRefresh}
            data-testid="effect-preview-refresh-button"
          >
            <RefreshCw
              className={cn("size-3.5", loading && "animate-spin")}
              aria-hidden="true"
            />
            刷新
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-full bg-[#0f766e] font-black text-white hover:bg-[#115e59]"
            disabled={!canGenerate || loading || generating}
            onClick={handleGenerate}
            data-testid="effect-preview-generate-button"
          >
            {generating ? (
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            生成预演
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <div className="font-black text-rose-950">{error.message}</div>
          <p className="mt-1 font-semibold leading-6 text-rose-700">
            {error.detail}
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.25fr)]">
        <div className="rounded-[18px] border border-[#0f766e]/20 bg-white p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              预演列表
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-[#0f766e]/25 bg-[#0f766e]/10 text-[10px] font-black text-[#0f766e]"
            >
              {previews.length} 个预演
            </Badge>
          </div>
          <ScrollArea className="mt-3 max-h-[320px] pr-2">
            <div className="grid gap-2" data-testid="effect-preview-list">
              {previews.length ? (
                previews.map(preview => {
                  const selected = activePreview?.id === preview.id;
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
                        {blueprintCopy(preview.title)}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(preview.summary)}
                      </div>
                      <div className="mt-2 text-[10px] font-black uppercase tracking-normal text-slate-400">
                        {formatEffectPreviewDate(preview.updatedAt ?? preview.createdAt)}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
                  暂无效果预演。接受需求、设计或任务文档后即可生成预演。
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              来源范围
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
                          {blueprintCopy(node.title)}
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                          {acceptedCount} 已接受
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="text-xs font-semibold leading-5 text-slate-500">
                  已接受的 SPEC 文档会作为生成范围显示在这里。
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
                  {activePreview?.title
                    ? blueprintCopy(activePreview.title)
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
                ? blueprintCopy(activePreview.summary)
                : "工作台已连接，正在等待后端预演内容。"}
            </p>
            <EffectPreviewVersionSync preview={activePreview} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <EffectPreviewList
              title="架构说明"
              items={activePreview?.architectureNotes ?? []}
            />
            <EffectPreviewList
              title="原型说明"
              items={activePreview?.prototypeNotes ?? []}
            />
          </div>

          <EffectPreviewRuntimeProjection
            preview={activePreview}
            roleEventProjection={roleEventProjection}
          />

          <div className="rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
              <ListChecks className="size-3.5" aria-hidden="true" />
              进度规划
            </div>
            {activePreview?.progressPlan.length ? (
              <div className="mt-3 grid gap-2" data-testid="effect-preview-progress-plan">
                {activePreview.progressPlan.map((step, index) => (
                  <div
                    key={step.id}
                    className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-black text-slate-900">
                        {index + 1}. {blueprintCopy(step.title)}
                      </div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        里程碑
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                      {blueprintCopy(step.summary)}
                    </div>
                    <div className="mt-1 text-[10px] font-black uppercase tracking-normal text-slate-400">
                      {blueprintCopy(step.target)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                等待生成进度规划。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PromptPackageWorkbenchPanel({
  specTree,
  jobId,
  documents,
  effectPreviews,
  initialPackages,
  onPackagesChange,
}: {
  specTree: BlueprintSpecTree;
  jobId?: string | null;
  documents: BlueprintSpecDocument[];
  effectPreviews: BlueprintEffectPreview[];
  initialPackages?: BlueprintPromptPackage[];
  onPackagesChange?: (packages: BlueprintPromptPackage[]) => void;
}) {
  const packageNodes = useMemo(
    () =>
      specTree.nodes.filter(
        node =>
          node.type === "prompt_package" ||
          node.type === "effect_preview" ||
          node.type === "spec_document"
      ),
    [specTree.nodes]
  );
  const [packages, setPackages] = useState<BlueprintPromptPackage[]>(
    initialPackages ?? []
  );
  const [selectedPlatform, setSelectedPlatform] = useState<
    "all" | BlueprintPromptTargetPlatform
  >("all");
  const [selectedPackageId, setSelectedPackageId] = useState(
    initialPackages?.[0]?.id ?? ""
  );
  const [selectedNodeId, setSelectedNodeId] = useState(
    specTree.nodes.find(node => node.type === "prompt_package")?.id ??
      packageNodes[0]?.id ??
      specTree.rootNodeId
  );
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    setPackages(initialPackages ?? []);
    setSelectedPackageId(current =>
      initialPackages?.some(promptPackage => promptPackage.id === current)
        ? current
        : initialPackages?.[0]?.id ?? ""
    );
  }, [initialPackages]);

  useEffect(() => {
    setSelectedNodeId(current =>
      specTree.nodes.some(node => node.id === current)
        ? current
        : specTree.nodes.find(node => node.type === "prompt_package")?.id ??
          packageNodes[0]?.id ??
          specTree.rootNodeId
    );
  }, [packageNodes, specTree.nodes, specTree.rootNodeId]);

  const filteredPackages = useMemo(
    () =>
      selectedPlatform === "all"
        ? packages
        : packages.filter(
            promptPackage => promptPackage.targetPlatform === selectedPlatform
          ),
    [packages, selectedPlatform]
  );
  const activePackage = useMemo(
    () =>
      filteredPackages.find(
        promptPackage => promptPackage.id === selectedPackageId
      ) ??
      filteredPackages[0] ??
      null,
    [filteredPackages, selectedPackageId]
  );
  const selectedNode = useMemo(
    () =>
      specTree.nodes.find(node => node.id === selectedNodeId) ??
      specTree.nodes.find(node => node.type === "prompt_package") ??
      specTree.nodes[0],
    [selectedNodeId, specTree.nodes]
  );
  const acceptedDocuments = useMemo(
    () =>
      documents.filter(
        document => (document.status ?? "draft").toLowerCase() === "accepted"
      ),
    [documents]
  );
  const boundDocuments = useMemo(() => {
    if (!activePackage?.sourceDocumentIds.length) return acceptedDocuments;
    const ids = new Set(activePackage.sourceDocumentIds);
    return documents.filter(document => ids.has(document.id));
  }, [acceptedDocuments, activePackage, documents]);
  const boundPreviews = useMemo(() => {
    if (!activePackage?.sourcePreviewIds.length) return effectPreviews;
    const ids = new Set(activePackage.sourcePreviewIds);
    return effectPreviews.filter(preview => ids.has(preview.id));
  }, [activePackage, effectPreviews]);
  const canGenerate =
    Boolean(jobId) &&
    (acceptedDocuments.length > 0 || effectPreviews.length > 0);

  const publishPackages = useCallback(
    (nextPackages: BlueprintPromptPackage[]) => {
      setPackages(nextPackages);
      setSelectedPackageId(current =>
        nextPackages.some(promptPackage => promptPackage.id === current)
          ? current
          : nextPackages[0]?.id ?? ""
      );
      onPackagesChange?.(nextPackages);
    },
    [onPackagesChange]
  );

  const handleRefresh = useCallback(async () => {
    if (!jobId) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchBlueprintPromptPackages(jobId);
      if (result.ok) {
        publishPackages(result.data.promptPackages);
      } else if (result.error.status === 404) {
        publishPackages([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }, [jobId, publishPackages]);

  const handleGenerate = useCallback(async () => {
    if (!jobId) return;

    setGenerating(true);
    setError(null);

    try {
      const result = await generateBlueprintPromptPackages(jobId, {
        nodeId: selectedNode?.id,
        targetPlatforms:
          selectedPlatform === "all"
            ? PROMPT_PLATFORM_OPTIONS.filter(
                option => option.id !== "all"
              ).map(option => option.id as BlueprintPromptTargetPlatform)
            : [selectedPlatform],
        includeDrafts: false,
        includePreviewDrafts: false,
      });
      if (result.ok) {
        publishPackages(result.data.promptPackages);
      } else if (result.error.status === 404) {
        publishPackages([]);
      } else {
        setError(result.error);
      }
    } finally {
      setGenerating(false);
    }
  }, [
    effectPreviews,
    jobId,
    publishPackages,
    selectedNode?.id,
    selectedPlatform,
  ]);

  useEffect(() => {
    if (!jobId || packages.length > 0) return;
    void handleRefresh();
  }, [handleRefresh, jobId, packages.length]);

  return (
    <div
      className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4"
      data-testid="prompt-package-workbench"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
            <PackageCheck className="size-3.5" aria-hidden="true" />
            提示词包
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">
            实现提示词包
          </h3>
          <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            将已接受的 SPEC 资产和效果预演打包成可交给下游编码工具使用的实现提示词。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-full border-slate-200 bg-white font-black text-slate-600 hover:bg-slate-100"
            disabled={!jobId || loading || generating}
            onClick={handleRefresh}
            data-testid="prompt-package-refresh-button"
          >
            <RefreshCw
              className={cn("size-3.5", loading && "animate-spin")}
              aria-hidden="true"
            />
            刷新
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-full bg-slate-950 font-black text-white hover:bg-slate-800"
            disabled={!canGenerate || loading || generating}
            onClick={handleGenerate}
            data-testid="prompt-package-generate-button"
          >
            {generating ? (
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            生成提示词包
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <div className="font-black text-rose-950">{error.message}</div>
          <p className="mt-1 font-semibold leading-6 text-rose-700">
            {error.detail}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2" data-testid="prompt-package-platform-filter">
        {PROMPT_PLATFORM_OPTIONS.map(option => {
          const selected = selectedPlatform === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-black transition",
                selected
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              )}
              onClick={() => {
                setSelectedPlatform(option.id);
                setSelectedPackageId("");
              }}
              aria-pressed={selected}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.25fr)]">
        <div className="rounded-[18px] border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              提示词包列表
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
            >
              {filteredPackages.length} 个包
            </Badge>
          </div>
          <ScrollArea className="mt-3 max-h-[320px] pr-2">
            <div className="grid gap-2" data-testid="prompt-package-list">
              {filteredPackages.length ? (
                filteredPackages.map(promptPackage => {
                  const selected = activePackage?.id === promptPackage.id;
                  return (
                    <button
                      key={promptPackage.id}
                      type="button"
                      className={cn(
                        "w-full rounded-[14px] border px-3 py-3 text-left transition",
                        selected
                          ? "border-slate-950 bg-slate-100"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                      )}
                      onClick={() => setSelectedPackageId(promptPackage.id)}
                      aria-pressed={selected}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-black text-slate-900">
                          {blueprintCopy(promptPackage.title)}
                        </span>
                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                          {promptPlatformLabel(promptPackage.targetPlatform)}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(promptPackage.summary)}
                      </div>
                      <div className="mt-2 text-[10px] font-black uppercase tracking-normal text-slate-400">
                        {formatEffectPreviewDate(
                          promptPackage.updatedAt ?? promptPackage.createdAt
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
                  暂无提示词包。效果预演就绪后即可生成提示词包。
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-3 rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              来源文档 / 预演
            </div>
            <div className="mt-2 grid gap-2">
              <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                  文档
                </div>
                <div className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                  {boundDocuments.length
                    ? boundDocuments
                        .slice(0, 3)
                        .map(document => blueprintCopy(document.title))
                        .join(" / ")
                    : "已接受文档会绑定到这里。"}
                </div>
              </div>
              <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                  预演
                </div>
                <div className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                  {boundPreviews.length
                    ? boundPreviews
                        .slice(0, 3)
                        .map(preview => blueprintCopy(preview.summary))
                        .join(" / ")
                    : "效果预演会绑定到这里。"}
                </div>
              </div>
              <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                  目标节点
                </div>
                <div className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                  {selectedNode?.title
                    ? blueprintCopy(selectedNode.title)
                    : "实现提示词包"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <Clipboard className="size-3.5" aria-hidden="true" />
                  提示词内容
                </div>
                <h4 className="mt-2 truncate text-base font-black text-slate-950">
                  {activePackage?.title
                    ? blueprintCopy(activePackage.title)
                    : "提示词包已就绪"}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
              >
                {activePackage
                  ? promptPlatformLabel(activePackage.targetPlatform)
                  : "未选择平台"}
              </Badge>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {activePackage?.summary
                ? blueprintCopy(activePackage.summary)
                : "工作台已连接，正在等待后端提示词包内容。"}
            </p>
          </div>

          <div className="rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              分段预览
            </div>
            {activePackage?.sections.length ? (
              <div className="mt-3 grid gap-2" data-testid="prompt-package-sections-preview">
                {activePackage.sections.map(section => (
                  <div
                    key={section.id}
                    className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="text-sm font-black text-slate-900">
                      {blueprintCopy(section.title)}
                    </div>
                    <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs font-semibold leading-5 text-slate-500">
                      {blueprintCopy(section.content || section.summary)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                生成后会在这里显示提示词分段。
              </div>
            )}
          </div>

          <pre
            className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[16px] border border-slate-200 bg-slate-950 p-4 text-xs font-semibold leading-6 text-slate-100"
            data-testid="prompt-package-content-preview"
          >
            {activePackage
              ? blueprintCopy(summarizePromptContent(activePackage))
              : "生成提示词包后可预览可直接复制的实现提示词。"}
          </pre>
        </div>
      </div>
    </div>
  );
}

function RuntimeCapabilityBridgeWorkbenchPanel({
  specTree,
  jobId,
  initialCapabilities,
  initialAgentCrew,
  initialInvocations,
  initialEvidence,
  onCapabilitiesChange,
  onAgentCrewChange,
  onInvocationsChange,
  onEvidenceChange,
}: {
  specTree: BlueprintSpecTree;
  jobId?: string | null;
  initialCapabilities?: BlueprintRuntimeCapability[];
  initialAgentCrew?: BlueprintAgentCrewSnapshot | null;
  initialInvocations?: BlueprintCapabilityInvocation[];
  initialEvidence?: BlueprintCapabilityEvidence[];
  onCapabilitiesChange?: (capabilities: BlueprintRuntimeCapability[]) => void;
  onAgentCrewChange?: (agentCrew: BlueprintAgentCrewSnapshot | null) => void;
  onInvocationsChange?: (invocations: BlueprintCapabilityInvocation[]) => void;
  onEvidenceChange?: (evidence: BlueprintCapabilityEvidence[]) => void;
}) {
  const [registryCapabilities, setRegistryCapabilities] = useState<
    BlueprintRuntimeCapability[]
  >(initialCapabilities ?? []);
  const [jobCapabilities, setJobCapabilities] = useState<
    BlueprintRuntimeCapability[]
  >(initialCapabilities ?? []);
  const [agentCrew, setAgentCrew] = useState<BlueprintAgentCrewSnapshot | null>(
    initialAgentCrew ?? null
  );
  const [invocations, setInvocations] = useState<BlueprintCapabilityInvocation[]>(
    initialInvocations ?? []
  );
  const [evidence, setEvidence] = useState<BlueprintCapabilityEvidence[]>(
    initialEvidence ?? []
  );
  const [selectedCapabilityId, setSelectedCapabilityId] = useState(
    initialCapabilities?.[0]?.id ?? ""
  );
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(
    specTree.rootNodeId ?? specTree.nodes[0]?.id ?? ""
  );
  const [requestedBy, setRequestedBy] = useState("");
  const [invocationInput, setInvocationInput] = useState("");
  const [evidenceTags, setEvidenceTags] = useState("");
  const [approved, setApproved] = useState(true);
  const [loading, setLoading] = useState(false);
  const [invoking, setInvoking] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    setRegistryCapabilities(initialCapabilities ?? []);
    setJobCapabilities(initialCapabilities ?? []);
    setSelectedCapabilityId(current =>
      initialCapabilities?.some(capability => capability.id === current)
        ? current
        : initialCapabilities?.[0]?.id ?? ""
    );
  }, [initialCapabilities]);

  useEffect(() => {
    setAgentCrew(initialAgentCrew ?? null);
  }, [initialAgentCrew]);

  useEffect(() => {
    setInvocations(initialInvocations ?? []);
  }, [initialInvocations]);

  useEffect(() => {
    setEvidence(initialEvidence ?? []);
  }, [initialEvidence]);

  useEffect(() => {
    setSelectedNodeId(current =>
      specTree.nodes.some(node => node.id === current)
        ? current
        : specTree.rootNodeId ?? specTree.nodes[0]?.id ?? ""
    );
  }, [specTree.nodes, specTree.rootNodeId]);

  const registry = useMemo(
    () => (jobCapabilities.length ? jobCapabilities : registryCapabilities),
    [jobCapabilities, registryCapabilities]
  );
  const activeCapability = useMemo(
    () =>
      registry.find(capability => capability.id === selectedCapabilityId) ??
      registry[0] ??
      null,
    [registry, selectedCapabilityId]
  );
  const selectedNode = useMemo(
    () => specTree.nodes.find(node => node.id === selectedNodeId) ?? specTree.nodes[0] ?? null,
    [selectedNodeId, specTree.nodes]
  );
  const activeInvocations = useMemo(() => {
    if (!activeCapability) return invocations;
    return invocations.filter(
      invocation => invocation.capabilityId === activeCapability.id
    );
  }, [activeCapability, invocations]);
  const activeEvidence = useMemo(() => {
    if (!activeCapability) return evidence;
    return evidence.filter(item => item.capabilityId === activeCapability.id);
  }, [activeCapability, evidence]);
  const canInvoke = Boolean(jobId && activeCapability);
  const capabilityTags = activeCapability?.tags ?? [];

  const publishCapabilities = useCallback(
    (nextCapabilities: BlueprintRuntimeCapability[]) => {
      setRegistryCapabilities(nextCapabilities);
      setJobCapabilities(nextCapabilities);
      onCapabilitiesChange?.(nextCapabilities);
      setSelectedCapabilityId(current =>
        nextCapabilities.some(capability => capability.id === current)
          ? current
          : nextCapabilities[0]?.id ?? ""
      );
    },
    [onCapabilitiesChange]
  );

  const publishInvocations = useCallback(
    (nextInvocations: BlueprintCapabilityInvocation[]) => {
      setInvocations(nextInvocations);
      onInvocationsChange?.(nextInvocations);
    },
    [onInvocationsChange]
  );

  const publishEvidence = useCallback(
    (nextEvidence: BlueprintCapabilityEvidence[]) => {
      setEvidence(nextEvidence);
      onEvidenceChange?.(nextEvidence);
    },
    [onEvidenceChange]
  );

  const handleRefresh = useCallback(async () => {
    if (!jobId) return;

    setLoading(true);
    setError(null);

    try {
      const [registryResult, jobResult, invocationsResult, evidenceResult] =
        await Promise.all([
          fetchBlueprintCapabilities(),
          fetchBlueprintJobCapabilities(jobId),
          fetchBlueprintCapabilityInvocations(jobId),
          fetchBlueprintCapabilityEvidence(jobId),
        ]);

      if (registryResult.ok) {
        setRegistryCapabilities(registryResult.data.capabilities);
        if (registryResult.data.agentCrew) {
          setAgentCrew(registryResult.data.agentCrew);
          onAgentCrewChange?.(registryResult.data.agentCrew);
        }
      } else if (registryResult.error.status !== 404) {
        setError(registryResult.error);
      }

      if (jobResult.ok) {
        setJobCapabilities(jobResult.data.capabilities);
        setAgentCrew(jobResult.data.agentCrew ?? null);
        onAgentCrewChange?.(jobResult.data.agentCrew ?? null);
      } else if (jobResult.error.status !== 404) {
        setError(jobResult.error);
      }

      if (invocationsResult.ok) {
        if (invocationsResult.data.agentCrew) {
          setAgentCrew(invocationsResult.data.agentCrew);
          onAgentCrewChange?.(invocationsResult.data.agentCrew);
        }
        publishInvocations(invocationsResult.data.invocations);
      } else if (invocationsResult.error.status !== 404) {
        setError(invocationsResult.error);
      }

      if (evidenceResult.ok) {
        publishEvidence(evidenceResult.data.evidence);
      } else if (evidenceResult.error.status !== 404) {
        setError(evidenceResult.error);
      }
    } finally {
      setLoading(false);
    }
  }, [jobId, onAgentCrewChange, publishEvidence, publishInvocations]);

  const handleInvoke = useCallback(async () => {
    if (!jobId || !activeCapability) return;

    setInvoking(true);
    setError(null);

    try {
      const result = await invokeBlueprintCapability(jobId, {
        capabilityId: activeCapability.id,
        routeId: selectedRouteId.trim() || undefined,
        nodeId: selectedNodeId.trim() || undefined,
        input: invocationInput.trim() || undefined,
        approved,
        requestedBy: requestedBy.trim() || undefined,
        evidenceTags: parseWorkbenchLines(evidenceTags),
      });

      if (result.ok) {
        setAgentCrew(result.data.agentCrew ?? agentCrew);
        onAgentCrewChange?.(result.data.agentCrew ?? agentCrew);
        setRegistryCapabilities(current => [
          result.data.capability,
          ...current.filter(
            capability => capability.id !== result.data.capability.id
          ),
        ]);
        setJobCapabilities(current => [
          result.data.capability,
          ...current.filter(
            capability => capability.id !== result.data.capability.id
          ),
        ]);
        publishInvocations([
          result.data.invocation,
          ...invocations.filter(item => item.id !== result.data.invocation.id),
        ]);
        publishEvidence([
          result.data.evidence,
          ...evidence.filter(item => item.id !== result.data.evidence.id),
        ]);
        setInvocationInput("");
        setEvidenceTags("");
      } else if (result.error.status !== 404) {
        setError(result.error);
      }
    } finally {
      setInvoking(false);
    }
  }, [
    activeCapability,
    agentCrew,
    approved,
    evidence,
    evidenceTags,
    invocations,
    jobId,
    onAgentCrewChange,
    publishEvidence,
    publishInvocations,
    requestedBy,
    selectedNodeId,
    selectedRouteId,
    invocationInput,
  ]);

  useEffect(() => {
    if (!jobId || registryCapabilities.length > 0) return;
    void handleRefresh();
  }, [handleRefresh, jobId, registryCapabilities.length]);

  const statusSummary = useMemo(() => {
    const allowed = invocations.filter(
      invocation => invocation.safetyGate.status === "allowed"
    ).length;
    return { allowed, blocked: invocations.length - allowed };
  }, [invocations]);

  return (
    <div
      className="mt-4 rounded-[20px] border border-slate-200 bg-white px-4 py-4"
      data-testid="runtime-capability-bridge-workbench"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
            <Terminal className="size-3.5" aria-hidden="true" />
            运行时能力桥
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">
            运行时能力桥工作台
          </h3>
          <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            查看运行时能力注册表，为当前任务发起能力调用，并跟踪调用后生成的证据。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-full border-slate-200 bg-slate-50 font-black text-slate-600 hover:bg-slate-100"
            disabled={!jobId || loading || invoking}
            onClick={handleRefresh}
            data-testid="capability-bridge-refresh-button"
          >
            <RefreshCw
              className={cn("size-3.5", loading && "animate-spin")}
              aria-hidden="true"
            />
            刷新
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-full bg-slate-950 font-black text-white hover:bg-slate-800"
            disabled={!canInvoke || loading || invoking}
            onClick={handleInvoke}
            data-testid="capability-invoke-button"
          >
            {invoking ? (
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            调用能力
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <div className="font-black text-rose-950">{error.message}</div>
          <p className="mt-1 font-semibold leading-6 text-rose-700">
            {error.detail}
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <SummaryTile
          label="能力注册表"
          value={registry.length}
          detail="运行时能力"
        />
        <SummaryTile
          label="调用记录"
          value={invocations.length}
          detail={`${statusSummary.allowed} 次允许`}
        />
        <SummaryTile
          label="证据"
          value={evidence.length}
          detail="调用记录"
        />
        <SummaryTile
          label="阻塞"
          value={statusSummary.blocked}
          detail="安全门结果"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(250px,0.78fr)_minmax(0,1.22fr)]">
        <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              能力注册表
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
            >
              {registry.length} 项能力
            </Badge>
          </div>
          <ScrollArea className="mt-3 max-h-[360px] pr-2">
            <div className="grid gap-2" data-testid="capability-registry-list">
              {registry.length ? (
                registry.map(capability => {
                  const selected = activeCapability?.id === capability.id;
                  return (
                    <button
                      key={capability.id}
                      type="button"
                      className={cn(
                        "w-full rounded-[14px] border px-3 py-3 text-left transition",
                        selected
                          ? "border-slate-950 bg-white"
                          : "border-slate-200 bg-white/80 hover:border-slate-300"
                      )}
                      onClick={() => setSelectedCapabilityId(capability.id)}
                      aria-pressed={selected}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-black text-slate-900">
                          {blueprintCopy(capability.label)}
                        </span>
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
                        >
                          {artifactTokenLabel(capability.kind, "Capability")}
                        </Badge>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(capability.purpose)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
                        >
                          {artifactTokenLabel(
                            capability.securityLevel,
                            "Security"
                          )}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
                        >
                          {artifactTokenLabel(capability.status, "Status")}
                        </Badge>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
                  能力桥与后端同步后，能力注册项会显示在这里。
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-3 rounded-[14px] border border-slate-200 bg-white px-3 py-3">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              能力详情
            </div>
            <div className="mt-2 text-xs font-semibold leading-5 text-slate-600">
              {activeCapability
                ? blueprintCopy(activeCapability.description)
                : "选择一项能力后可查看适配器与 schema 详情。"}
            </div>
            {capabilityTags.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {capabilityTags.slice(0, 6).map(tag => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <Clipboard className="size-3.5" aria-hidden="true" />
                  调用发射器
                </div>
                <h4 className="mt-2 text-base font-black text-slate-950">
                  {activeCapability?.label
                    ? blueprintCopy(activeCapability.label)
                    : "能力调用已就绪"}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
              >
                {activeCapability
                  ? artifactTokenLabel(activeCapability.status, "Status")
                  : "未选择能力"}
              </Badge>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                能力
                <select
                  value={selectedCapabilityId}
                  onChange={event => setSelectedCapabilityId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                  data-testid="capability-launcher-select"
                >
                  <option value="">选择能力</option>
                  {registry.map(capability => (
                    <option key={capability.id} value={capability.id}>
                      {blueprintCopy(capability.label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                目标节点
                <select
                  value={selectedNodeId}
                  onChange={event => setSelectedNodeId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                  data-testid="capability-launcher-node-select"
                >
                  {specTree.nodes.map(node => (
                    <option key={node.id} value={node.id}>
                      {blueprintCopy(node.title)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500 md:col-span-2">
                路线 ID
                <input
                  value={selectedRouteId}
                  onChange={event => setSelectedRouteId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-400"
                  placeholder="可选路线 ID"
                  data-testid="capability-launcher-route-input"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500 md:col-span-2">
                请求人
                <input
                  value={requestedBy}
                  onChange={event => setRequestedBy(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-400"
                  placeholder="可选执行者"
                  data-testid="capability-launcher-requested-by-input"
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3">
              <textarea
                value={invocationInput}
                onChange={event => setInvocationInput(event.target.value)}
                className="min-h-[88px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-slate-400"
                placeholder="能力输入"
                data-testid="capability-launcher-input"
              />
              <textarea
                value={evidenceTags}
                onChange={event => setEvidenceTags(event.target.value)}
                className="min-h-[72px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-slate-400"
                placeholder="证据标签"
                data-testid="capability-launcher-evidence-tags"
              />
              <label className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={event => setApproved(event.target.checked)}
                  className="size-4 rounded border-slate-300 text-slate-950 focus:ring-slate-400"
                  data-testid="capability-launcher-approved-toggle"
                />
                已批准
              </label>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <ListChecks className="size-3.5" aria-hidden="true" />
                调用列表
              </div>
              <div className="mt-3 grid gap-2" data-testid="capability-invocation-list">
                {activeInvocations.length ? (
                  activeInvocations.slice(0, 6).map(invocation => (
                    <div
                      key={invocation.id}
                      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-black text-slate-900">
                          {blueprintCopy(invocation.capabilityLabel)}
                        </div>
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
                        >
                          {artifactTokenLabel(invocation.status, "Status")}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(invocation.outputSummary)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-normal text-slate-400">
                        <span>{artifactTokenLabel(invocation.kind, "Kind")}</span>
                        <span>{artifactTokenLabel(invocation.securityLevel, "Security")}</span>
                        <span>{artifactTokenLabel(invocation.safetyGate.status, "Gate")}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                    发起调用后，能力调用记录会显示在这里。
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <Sparkles className="size-3.5" aria-hidden="true" />
                证据列表
              </div>
              <div className="mt-3 grid gap-2" data-testid="capability-evidence-list">
                {activeEvidence.length ? (
                  activeEvidence.slice(0, 6).map(item => (
                    <div
                      key={item.id}
                      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-black text-slate-900">
                          {blueprintCopy(item.title)}
                        </div>
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
                        >
                          {artifactTokenLabel(item.status, "Status")}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(item.summary)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-normal text-slate-400">
                        <span>{artifactTokenLabel(item.kind, "Kind")}</span>
                        <span>{item.artifacts.length} 个资产</span>
                        <span>{item.logs.length} 条日志</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                    能力调用被记录后，相关证据会显示在这里。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EngineeringLandingWorkbenchPanel({
  jobId,
  promptPackages,
  initialPlans,
  initialRuns,
  onLandingPlansChange,
  onEngineeringRunsChange,
}: {
  jobId?: string | null;
  promptPackages: BlueprintPromptPackage[];
  initialPlans?: BlueprintEngineeringLandingPlan[];
  initialRuns?: BlueprintEngineeringRun[];
  onLandingPlansChange?: (plans: BlueprintEngineeringLandingPlan[]) => void;
  onEngineeringRunsChange?: (runs: BlueprintEngineeringRun[]) => void;
}) {
  const [plans, setPlans] = useState<BlueprintEngineeringLandingPlan[]>(
    initialPlans ?? []
  );
  const [runs, setRuns] = useState<BlueprintEngineeringRun[]>(
    initialRuns ?? []
  );
  const [selectedPlanId, setSelectedPlanId] = useState(
    initialPlans?.[0]?.id ?? ""
  );
  const [selectedPromptPackageId, setSelectedPromptPackageId] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<
    "all" | BlueprintPromptTargetPlatform
  >("all");
  const [runStatus, setRunStatus] =
    useState<BlueprintEngineeringRunStatus>("passed");
  const [runSummary, setRunSummary] = useState("");
  const [runLogs, setRunLogs] = useState("");
  const [runVerification, setRunVerification] = useState("");
  const [runChangedFiles, setRunChangedFiles] = useState("");
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    setPlans(initialPlans ?? []);
    setSelectedPlanId(current =>
      initialPlans?.some(plan => plan.id === current)
        ? current
        : initialPlans?.[0]?.id ?? ""
    );
  }, [initialPlans]);

  useEffect(() => {
    setRuns(initialRuns ?? []);
  }, [initialRuns]);

  const activePlan = useMemo(
    () => plans.find(plan => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );
  const selectedPromptPackage = useMemo(
    () =>
      promptPackages.find(
        promptPackage => promptPackage.id === selectedPromptPackageId
      ) ?? null,
    [promptPackages, selectedPromptPackageId]
  );
  const activePlanPackageIds = useMemo(() => {
    if (!activePlan) return [];
    return Array.from(
      new Set(
        [activePlan.promptPackageId, ...activePlan.sourcePromptPackageIds]
          .map(value => value ?? "")
          .filter(Boolean)
      )
    );
  }, [activePlan]);
  const boundPromptPackages = useMemo(() => {
    if (!activePlanPackageIds.length) return [];
    const ids = new Set(activePlanPackageIds);
    return promptPackages.filter(promptPackage => ids.has(promptPackage.id));
  }, [activePlanPackageIds, promptPackages]);
  const planRuns = useMemo(() => {
    if (!activePlan) return runs;
    return runs.filter(
      run => !run.landingPlanId || run.landingPlanId === activePlan.id
    );
  }, [activePlan, runs]);
  const canGenerateLanding = Boolean(jobId);
  const canRecordRun = Boolean(jobId && activePlan && runSummary.trim());

  const publishPlans = useCallback(
    (nextPlans: BlueprintEngineeringLandingPlan[]) => {
      setPlans(nextPlans);
      setSelectedPlanId(current =>
        nextPlans.some(plan => plan.id === current)
          ? current
          : nextPlans[0]?.id ?? ""
      );
      onLandingPlansChange?.(nextPlans);
    },
    [onLandingPlansChange]
  );

  const publishRuns = useCallback(
    (nextRuns: BlueprintEngineeringRun[]) => {
      setRuns(nextRuns);
      onEngineeringRunsChange?.(nextRuns);
    },
    [onEngineeringRunsChange]
  );

  const handleRefreshLanding = useCallback(async () => {
    if (!jobId) return;

    setLoadingPlans(true);
    setError(null);

    try {
      const result = await fetchBlueprintEngineeringLanding(jobId);
      if (result.ok) {
        publishPlans(result.data.landingPlans);
      } else if (result.error.status === 404) {
        publishPlans([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoadingPlans(false);
    }
  }, [jobId, publishPlans]);

  const handleRefreshRuns = useCallback(async () => {
    if (!jobId) return;

    setLoadingRuns(true);
    setError(null);

    try {
      const result = await fetchBlueprintEngineeringRuns(jobId);
      if (result.ok) {
        publishRuns(result.data.engineeringRuns);
      } else if (result.error.status === 404) {
        publishRuns([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoadingRuns(false);
    }
  }, [jobId, publishRuns]);

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([handleRefreshLanding(), handleRefreshRuns()]);
  }, [handleRefreshLanding, handleRefreshRuns]);

  const handleGenerateLanding = useCallback(async () => {
    if (!jobId) return;

    setGenerating(true);
    setError(null);

    try {
      const result = await generateBlueprintEngineeringLanding(jobId, {
        promptPackageId: selectedPromptPackageId || undefined,
        platform: selectedPlatform === "all" ? undefined : selectedPlatform,
      });
      if (result.ok) {
        publishPlans(result.data.landingPlans);
      } else if (result.error.status === 404) {
        publishPlans([]);
      } else {
        setError(result.error);
      }
    } finally {
      setGenerating(false);
    }
  }, [
    jobId,
    publishPlans,
    selectedPlatform,
    selectedPromptPackageId,
  ]);

  const handleRecordRun = useCallback(async () => {
    if (!jobId || !activePlan || !runSummary.trim()) return;

    setRecording(true);
    setError(null);

    const verificationResults = parseWorkbenchLines(runVerification).map(
      (item, index) => ({
        title: item,
        command: activePlan.verificationCommands[index]?.command ?? "",
        status: runStatus,
        summary: item,
      })
    );

    try {
      const result = await createBlueprintEngineeringRun(jobId, {
        landingPlanId: activePlan.id,
        status: runStatus,
        summary: runSummary.trim(),
        logs: parseWorkbenchLines(runLogs),
        verificationResults,
        changedFiles: parseWorkbenchLines(runChangedFiles),
      });
      if (result.ok) {
        const nextRuns = [
          result.data.engineeringRun,
          ...runs.filter(run => run.id !== result.data.engineeringRun.id),
        ];
        publishRuns(nextRuns);

        if (result.data.landingPlan) {
          publishPlans([
            result.data.landingPlan,
            ...plans.filter(plan => plan.id !== result.data.landingPlan?.id),
          ]);
        }

        setRunSummary("");
        setRunLogs("");
        setRunVerification("");
        setRunChangedFiles("");
      } else {
        setError(result.error);
      }
    } finally {
      setRecording(false);
    }
  }, [
    activePlan,
    jobId,
    plans,
    publishPlans,
    publishRuns,
    runChangedFiles,
    runLogs,
    runStatus,
    runSummary,
    runVerification,
    runs,
  ]);

  useEffect(() => {
    if (!jobId || plans.length > 0) return;
    void handleRefreshLanding();
  }, [handleRefreshLanding, jobId, plans.length]);

  useEffect(() => {
    if (!jobId || runs.length > 0) return;
    void handleRefreshRuns();
  }, [handleRefreshRuns, jobId, runs.length]);

  return (
    <div
      className="mt-4 rounded-[20px] border border-slate-200 bg-white px-4 py-4"
      data-testid="engineering-landing-workbench"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
            <FileCheck2 className="size-3.5" aria-hidden="true" />
            工程落地
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">
            工程落地工作台
          </h3>
          <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            将实现提示词包转换为平台交接、执行步骤、验证命令和工程执行记录。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-full border-slate-200 bg-slate-50 font-black text-slate-600 hover:bg-slate-100"
            disabled={!jobId || loadingPlans || loadingRuns || generating}
            onClick={handleRefreshAll}
            data-testid="engineering-landing-refresh-button"
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                (loadingPlans || loadingRuns) && "animate-spin"
              )}
              aria-hidden="true"
            />
            刷新
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-full bg-slate-950 font-black text-white hover:bg-slate-800"
            disabled={!canGenerateLanding || loadingPlans || generating}
            onClick={handleGenerateLanding}
            data-testid="engineering-landing-generate-button"
          >
            {generating ? (
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            生成落地计划
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <div className="font-black text-rose-950">{error.message}</div>
          <p className="mt-1 font-semibold leading-6 text-rose-700">
            {error.detail}
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
          提示词来源
          <select
            value={selectedPromptPackageId}
            onChange={event => setSelectedPromptPackageId(event.target.value)}
            className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
            data-testid="engineering-landing-package-select"
          >
            <option value="">全部提示词包</option>
            {promptPackages.map(promptPackage => (
              <option key={promptPackage.id} value={promptPackage.id}>
                {promptPlatformLabel(promptPackage.targetPlatform)} /{" "}
                {blueprintCopy(promptPackage.title)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap content-end gap-2">
          {PROMPT_PLATFORM_OPTIONS.map(option => {
            const selected = selectedPlatform === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-black transition",
                  selected
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
                )}
                onClick={() => setSelectedPlatform(option.id)}
                aria-pressed={selected}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(240px,0.78fr)_minmax(0,1.22fr)]">
        <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              落地计划
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
            >
              {plans.length} 个计划
            </Badge>
          </div>
          <ScrollArea className="mt-3 max-h-[340px] pr-2">
            <div className="grid gap-2" data-testid="engineering-landing-plan-list">
              {plans.length ? (
                plans.map(plan => {
                  const selected = activePlan?.id === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      className={cn(
                        "w-full rounded-[14px] border px-3 py-3 text-left transition",
                        selected
                          ? "border-slate-950 bg-white"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                      onClick={() => setSelectedPlanId(plan.id)}
                      aria-pressed={selected}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-black text-slate-900">
                          {blueprintCopy(plan.title)}
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                          {promptPlatformLabel(plan.platform)}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(plan.summary)}
                      </div>
                      <div className="mt-2 text-[10px] font-black uppercase tracking-normal text-slate-400">
                        {formatEffectPreviewDate(plan.updatedAt ?? plan.createdAt)}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
                  暂无工程落地计划。提示词包就绪后即可生成落地计划。
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-3 rounded-[14px] border border-slate-200 bg-white px-3 py-3">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              提示词包绑定
            </div>
            <div className="mt-2 text-xs font-semibold leading-5 text-slate-600">
              {boundPromptPackages.length
                ? boundPromptPackages
                    .slice(0, 3)
                    .map(promptPackage => blueprintCopy(promptPackage.title))
                    .join(" / ")
                : selectedPromptPackage
                  ? blueprintCopy(selectedPromptPackage.title)
                  : "提示词包交接会绑定到这里。"}
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <Clipboard className="size-3.5" aria-hidden="true" />
                  落地详情
                </div>
                <h4 className="mt-2 text-base font-black text-slate-950">
                  {activePlan?.title
                    ? blueprintCopy(activePlan.title)
                    : "工程落地已就绪"}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-white text-[10px] font-black text-slate-500"
              >
                {activePlan ? promptPlatformLabel(activePlan.platform) : "未选择计划"}
              </Badge>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {activePlan?.summary
                ? blueprintCopy(activePlan.summary)
                : "工作台已连接，正在等待工程落地内容。"}
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <PackageCheck className="size-3.5" aria-hidden="true" />
                平台交接
              </div>
              {activePlan?.handoffs.length ? (
                <div className="mt-3 grid gap-2" data-testid="engineering-platform-handoffs">
                  {activePlan.handoffs.map(handoff => (
                    <div
                      key={handoff.id}
                      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-black text-slate-900">
                          {blueprintCopy(handoff.label)}
                        </div>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                          {promptPlatformLabel(handoff.platform)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(handoff.summary)}
                      </div>
                      {handoff.instructions.length ? (
                        <ul className="mt-2 grid gap-1">
                          {handoff.instructions.slice(0, 4).map(instruction => (
                            <li
                              key={`${handoff.id}-${instruction}`}
                              className="text-xs font-semibold leading-5 text-slate-600"
                            >
                              {blueprintCopy(instruction)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                  生成落地计划后，平台交接会显示在这里。
                </div>
              )}
            </div>

            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <ListChecks className="size-3.5" aria-hidden="true" />
                步骤
              </div>
              {activePlan?.steps.length ? (
                <div className="mt-3 grid gap-2" data-testid="engineering-landing-steps">
                  {activePlan.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-black text-slate-900">
                          {index + 1}. {blueprintCopy(step.title)}
                        </div>
                        {step.status ? (
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                            {blueprintCopy(step.status)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(step.summary)}
                      </div>
                      {step.commands.length ? (
                        <div className="mt-2 grid gap-1">
                          {step.commands.slice(0, 3).map(command => (
                            <code
                              key={`${step.id}-${command}`}
                              className="rounded-[10px] bg-slate-950 px-2 py-1 text-[11px] font-semibold text-slate-100"
                            >
                              {command}
                            </code>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                  生成落地计划后，工程步骤会显示在这里。
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
              <Terminal className="size-3.5" aria-hidden="true" />
              验证命令
            </div>
            {activePlan?.verificationCommands.length ? (
              <div className="mt-3 grid gap-2" data-testid="engineering-verification-commands">
                {activePlan.verificationCommands.map(command => (
                  <div
                    key={command.id}
                    className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="text-sm font-black text-slate-900">
                      {blueprintCopy(command.title)}
                    </div>
                    <code className="mt-2 block overflow-auto rounded-[10px] bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-100">
                      {command.command}
                    </code>
                    {command.expected ? (
                      <div className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(command.expected)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                生成落地计划后，验证命令会显示在这里。
                </div>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)]">
            <div
              className="rounded-[16px] border border-slate-200 bg-white p-4"
              data-testid="engineering-run-recorder"
            >
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                <PlayCircle className="size-3.5" aria-hidden="true" />
                执行记录器
              </div>
              <div className="mt-3 grid gap-3">
                <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                  状态
                  <select
                    value={runStatus}
                    onChange={event =>
                      setRunStatus(event.target.value as BlueprintEngineeringRunStatus)
                    }
                    className="h-10 rounded-[12px] border border-slate-200 bg-white px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                  >
                    {ENGINEERING_RUN_STATUS_OPTIONS.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <textarea
                  value={runSummary}
                  onChange={event => setRunSummary(event.target.value)}
                  className="min-h-[76px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-slate-400"
                  placeholder="执行摘要"
                />
                <div className="grid gap-3 md:grid-cols-3">
                  <textarea
                    value={runLogs}
                    onChange={event => setRunLogs(event.target.value)}
                    className="min-h-[76px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-slate-400"
                    placeholder="日志"
                  />
                  <textarea
                    value={runVerification}
                    onChange={event => setRunVerification(event.target.value)}
                    className="min-h-[76px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-slate-400"
                    placeholder="验证结果"
                  />
                  <textarea
                    value={runChangedFiles}
                    onChange={event => setRunChangedFiles(event.target.value)}
                    className="min-h-[76px] resize-y rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-slate-400"
                    placeholder="变更文件"
                  />
                </div>
                <Button
                  type="button"
                  className="w-fit gap-2 rounded-full bg-slate-950 font-black text-white hover:bg-slate-800"
                  disabled={!canRecordRun || recording}
                  onClick={handleRecordRun}
                  data-testid="engineering-run-record-button"
                >
                  {recording ? (
                    <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  )}
                  记录执行
                </Button>
              </div>
            </div>

            <div className="rounded-[16px] border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-black uppercase tracking-normal text-slate-500">
                  工程执行记录
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
                >
                  {planRuns.length} 条记录
                </Badge>
              </div>
              <div className="mt-3 grid gap-2" data-testid="engineering-run-list">
                {planRuns.length ? (
                  planRuns.map(run => (
                    <div
                      key={run.id}
                      className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-black text-slate-900">
                          {engineeringRunStatusLabel(run.status)}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                          {formatEffectPreviewDate(
                            run.recordedAt ?? run.updatedAt ?? run.createdAt
                          )}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(run.summary)}
                      </div>
                      {run.changedFiles.length ? (
                        <div className="mt-2 text-[11px] font-semibold leading-5 text-slate-600">
                          {run.changedFiles.slice(0, 3).join(" / ")}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                    暂无工程执行记录。
                </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ARTIFACT_FEEDBACK_SENTIMENT_OPTIONS = [
  { id: "positive", label: "正向" },
  { id: "neutral", label: "中性" },
  { id: "negative", label: "负向" },
  { id: "mixed", label: "混合" },
];

const ARTIFACT_FEEDBACK_STATUS_OPTIONS = [
  { id: "verified", label: "已验证" },
  { id: "needs_backfill", label: "待回填" },
  { id: "blocked", label: "阻塞" },
  { id: "recorded", label: "已记录" },
];

function ArtifactMemoryWorkbenchPanel({
  jobId,
  initialEntries,
  initialReplays,
  initialFeedback,
}: {
  jobId?: string | null;
  initialEntries?: BlueprintArtifactLedgerEntry[];
  initialReplays?: BlueprintArtifactReplay[];
  initialFeedback?: BlueprintArtifactFeedback[];
}) {
  const [entries, setEntries] = useState<BlueprintArtifactLedgerEntry[]>(
    initialEntries ?? []
  );
  const [replays, setReplays] = useState<BlueprintArtifactReplay[]>(
    initialReplays ?? []
  );
  const [feedback, setFeedback] = useState<BlueprintArtifactFeedback[]>(
    initialFeedback ?? []
  );
  const [selectedEntryId, setSelectedEntryId] = useState(
    initialEntries?.[0]?.id ?? ""
  );
  const [activeReplayId, setActiveReplayId] = useState(
    initialReplays?.[0]?.id ?? ""
  );
  const [leftEntryId, setLeftEntryId] = useState(initialEntries?.[0]?.id ?? "");
  const [rightEntryId, setRightEntryId] = useState(
    initialEntries?.[1]?.id ?? initialEntries?.[0]?.id ?? ""
  );
  const [diff, setDiff] = useState<BlueprintArtifactDiff | null>(null);
  const [feedbackEntryId, setFeedbackEntryId] = useState(
    initialEntries?.[0]?.id ?? ""
  );
  const [feedbackSentiment, setFeedbackSentiment] = useState("positive");
  const [feedbackStatus, setFeedbackStatus] = useState("verified");
  const [feedbackSummary, setFeedbackSummary] = useState("");
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [loadingReplays, setLoadingReplays] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [diffing, setDiffing] = useState(false);
  const [recordingFeedback, setRecordingFeedback] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const publishEntries = useCallback((nextEntries: BlueprintArtifactLedgerEntry[]) => {
    const firstEntryId = nextEntries[0]?.id ?? "";
    const secondEntryId = nextEntries[1]?.id ?? firstEntryId;

    setEntries(nextEntries);
    setSelectedEntryId(current =>
      nextEntries.some(entry => entry.id === current) ? current : firstEntryId
    );
    setFeedbackEntryId(current =>
      nextEntries.some(entry => entry.id === current) ? current : firstEntryId
    );
    setLeftEntryId(current =>
      nextEntries.some(entry => entry.id === current) ? current : firstEntryId
    );
    setRightEntryId(current =>
      nextEntries.some(entry => entry.id === current) ? current : secondEntryId
    );
  }, []);

  const publishReplays = useCallback((nextReplays: BlueprintArtifactReplay[]) => {
    setReplays(nextReplays);
    setActiveReplayId(current =>
      nextReplays.some(replay => replay.id === current)
        ? current
        : nextReplays[0]?.id ?? ""
    );
  }, []);

  const publishFeedback = useCallback(
    (nextFeedback: BlueprintArtifactFeedback[]) => {
      setFeedback(nextFeedback);
    },
    []
  );

  useEffect(() => {
    publishEntries(initialEntries ?? []);
  }, [initialEntries, publishEntries]);

  useEffect(() => {
    publishReplays(initialReplays ?? []);
  }, [initialReplays, publishReplays]);

  useEffect(() => {
    publishFeedback(initialFeedback ?? []);
  }, [initialFeedback, publishFeedback]);

  const selectedEntry = useMemo(
    () =>
      entries.find(entry => entry.id === selectedEntryId) ?? entries[0] ?? null,
    [entries, selectedEntryId]
  );
  const activeReplay = useMemo(
    () =>
      replays.find(replay => replay.id === activeReplayId) ?? replays[0] ?? null,
    [activeReplayId, replays]
  );
  const stageGroups = useMemo(() => {
    const groups = new Map<string, BlueprintArtifactLedgerEntry[]>();
    entries.forEach(entry => {
      const stage = entry.stage || "artifact_memory";
      groups.set(stage, [...(groups.get(stage) ?? []), entry]);
    });

    return Array.from(groups.entries())
      .map(([stage, stageEntries]) => ({
        stage,
        entries: stageEntries.sort((left, right) =>
          (right.createdAt || "").localeCompare(left.createdAt || "")
        ),
      }))
      .sort((left, right) => left.stage.localeCompare(right.stage));
  }, [entries]);
  const lineageEdgeCount = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.lineageEdgeCount, 0),
    [entries]
  );
  const canReplay = Boolean(jobId && selectedEntry);
  const canDiff = Boolean(
    jobId && leftEntryId && rightEntryId && leftEntryId !== rightEntryId
  );
  const canRecordFeedback = Boolean(
    jobId && feedbackEntryId && feedbackSummary.trim()
  );

  const handleRefreshLedger = useCallback(async () => {
    if (!jobId) return;

    setLoadingLedger(true);
    setError(null);

    try {
      const result = await fetchBlueprintArtifactLedger(jobId);
      if (result.ok) {
        publishEntries(result.data.entries);
      } else if (result.error.status === 404) {
        publishEntries([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoadingLedger(false);
    }
  }, [jobId, publishEntries]);

  const handleRefreshReplays = useCallback(async () => {
    if (!jobId) return;

    setLoadingReplays(true);
    setError(null);

    try {
      const result = await fetchBlueprintArtifactReplays(jobId);
      if (result.ok) {
        publishReplays(result.data.replays);
      } else if (result.error.status === 404) {
        publishReplays([]);
      } else {
        setError(result.error);
      }
    } finally {
      setLoadingReplays(false);
    }
  }, [jobId, publishReplays]);

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([handleRefreshLedger(), handleRefreshReplays()]);
  }, [handleRefreshLedger, handleRefreshReplays]);

  const handleReplayEntry = useCallback(async () => {
    if (!jobId || !selectedEntry) return;

    setReplaying(true);
    setError(null);

    try {
      const result = await replayBlueprintArtifact(jobId, {
        entryId: selectedEntry.id,
        stage: selectedEntry.stage,
      });
      if (result.ok) {
        const nextReplays = [
          result.data.replay,
          ...replays.filter(replay => replay.id !== result.data.replay.id),
        ];
        publishReplays(nextReplays);
        setActiveReplayId(result.data.replay.id);
      } else if (result.error.status === 404) {
        publishReplays([]);
      } else {
        setError(result.error);
      }
    } finally {
      setReplaying(false);
    }
  }, [jobId, publishReplays, replays, selectedEntry]);

  const handleDiffEntries = useCallback(async () => {
    if (!jobId || !canDiff) return;

    setDiffing(true);
    setError(null);

    try {
      const result = await diffBlueprintArtifacts(jobId, {
        leftEntryId,
        rightEntryId,
      });
      if (result.ok) {
        setDiff(result.data.diff);
      } else if (result.error.status === 404) {
        setDiff(null);
      } else {
        setError(result.error);
      }
    } finally {
      setDiffing(false);
    }
  }, [canDiff, jobId, leftEntryId, rightEntryId]);

  const handleRecordFeedback = useCallback(async () => {
    if (!jobId || !feedbackEntryId || !feedbackSummary.trim()) return;

    setRecordingFeedback(true);
    setError(null);

    try {
      const result = await recordBlueprintArtifactFeedback(jobId, {
        entryId: feedbackEntryId,
        sentiment: feedbackSentiment,
        status: feedbackStatus,
        summary: feedbackSummary.trim(),
        notes: feedbackNotes.trim() || undefined,
      });
      if (result.ok) {
        publishFeedback([
          result.data.feedback,
          ...feedback.filter(item => item.id !== result.data.feedback.id),
        ]);
        setFeedbackSummary("");
        setFeedbackNotes("");
      } else if (result.error.status !== 404) {
        setError(result.error);
      }
    } finally {
      setRecordingFeedback(false);
    }
  }, [
    feedback,
    feedbackEntryId,
    feedbackNotes,
    feedbackSentiment,
    feedbackStatus,
    feedbackSummary,
    jobId,
    publishFeedback,
  ]);

  useEffect(() => {
    if (!jobId || entries.length > 0) return;
    void handleRefreshLedger();
  }, [entries.length, handleRefreshLedger, jobId]);

  useEffect(() => {
    if (!jobId || replays.length > 0) return;
    void handleRefreshReplays();
  }, [handleRefreshReplays, jobId, replays.length]);

  return (
    <div
      className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4"
      data-testid="artifact-memory-workbench"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
            <Layers3 className="size-3.5" aria-hidden="true" />
            资产记忆
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">
            资产记忆与回放工作台
          </h3>
          <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            查看项目资产台账、回放快照、对比两条台账记录，并把执行反馈回填到资产链路中。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2 rounded-full border-slate-200 bg-white font-black text-slate-600 hover:bg-slate-100"
            disabled={!jobId || loadingLedger || loadingReplays || replaying}
            onClick={handleRefreshAll}
            data-testid="artifact-memory-refresh-button"
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                (loadingLedger || loadingReplays) && "animate-spin"
              )}
              aria-hidden="true"
            />
            刷新
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-full bg-slate-950 font-black text-white hover:bg-slate-800"
            disabled={!canReplay || loadingLedger || replaying}
            onClick={handleReplayEntry}
            data-testid="artifact-replay-button"
          >
            {replaying ? (
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <PlayCircle className="size-3.5" aria-hidden="true" />
            )}
            回放快照
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[16px] border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <div className="font-black text-rose-950">{error.message}</div>
          <p className="mt-1 font-semibold leading-6 text-rose-700">
            {error.detail}
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <SummaryTile
          label="台账记录"
          value={entries.length}
          detail={`${stageGroups.length} 个阶段`}
        />
        <SummaryTile
          label="回放"
          value={replays.length}
          detail="快照历史"
        />
        <SummaryTile
          label="血缘边"
          value={lineageEdgeCount}
          detail="来源链接"
        />
        <SummaryTile
          label="反馈"
          value={feedback.length}
          detail="回填记录"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(250px,0.85fr)_minmax(0,1.15fr)]">
        <div className="rounded-[18px] border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-normal text-slate-500">
              时间线 / 台账
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
            >
              {entries.length} 条记录
            </Badge>
          </div>
          <ScrollArea className="mt-3 max-h-[500px] pr-2">
            <div className="grid gap-3" data-testid="artifact-ledger-timeline">
              {stageGroups.length ? (
                stageGroups.map(group => (
                  <div
                    key={group.stage}
                    className="rounded-[14px] border border-slate-200 bg-slate-50 p-2"
                    data-testid="artifact-ledger-stage-group"
                  >
                    <div className="flex items-center justify-between gap-2 px-1 py-1">
                      <span className="text-xs font-black uppercase tracking-normal text-slate-500">
                        {artifactTokenLabel(group.stage, "Artifact memory")}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        {group.entries.length} 条记录
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2">
                      {group.entries.map(entry => {
                        const selected = selectedEntry?.id === entry.id;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            className={cn(
                              "w-full rounded-[12px] border px-3 py-3 text-left transition",
                              selected
                                ? "border-slate-950 bg-white"
                                : "border-slate-200 bg-white/80 hover:border-slate-300"
                            )}
                            onClick={() => {
                              setSelectedEntryId(entry.id);
                              setFeedbackEntryId(entry.id);
                            }}
                            data-testid="artifact-ledger-entry"
                            aria-pressed={selected}
                          >
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <span className="truncate text-sm font-black text-slate-900">
                                {blueprintCopy(entry.title)}
                              </span>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                                {artifactTokenLabel(entry.artifactType, "Artifact")}
                              </span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                              {blueprintCopy(entry.summary)}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-normal text-slate-400">
                              <span>{formatEffectPreviewDate(entry.recordedAt ?? entry.createdAt)}</span>
                              <span>{blueprintCopy(entry.status)}</span>
                              <span>{entry.lineageEdgeCount} 条边</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[14px] border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm font-semibold leading-6 text-slate-500">
                  后端记忆层记录任务时间线后，资产台账会显示在这里。
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[18px] border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <GitBranch className="size-3.5" aria-hidden="true" />
                  已选资产
                </div>
                <h4 className="mt-2 text-base font-black text-slate-950">
                  {selectedEntry?.title
                    ? blueprintCopy(selectedEntry.title)
                    : "资产台账已就绪"}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
              >
                {selectedEntry
                  ? artifactTokenLabel(selectedEntry.stage, "Artifact memory")
                  : "暂无记录"}
              </Badge>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {selectedEntry?.summary
                ? blueprintCopy(selectedEntry.summary)
                : "工作台已连接，正在等待资产台账内容。"}
            </p>
            {selectedEntry ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <RouteMetric
                  label="资产"
                  value={artifactTokenLabel(selectedEntry.artifactType, "Artifact")}
                />
                <RouteMetric label="状态" value={blueprintCopy(selectedEntry.status)} />
                <RouteMetric
                  label="血缘"
                  value={`${selectedEntry.lineageEdgeCount} 条边`}
                />
              </div>
            ) : null}
          </div>

          <div
            className="rounded-[16px] border border-slate-200 bg-white p-4"
            data-testid="artifact-replay-summary"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <PlayCircle className="size-3.5" aria-hidden="true" />
                  回放快照摘要
                </div>
                <h4 className="mt-2 text-base font-black text-slate-950">
                  {activeReplay?.title
                    ? blueprintCopy(activeReplay.title)
                    : "回放快照已就绪"}
                </h4>
              </div>
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500"
              >
                {activeReplay?.status ? blueprintCopy(activeReplay.status) : "暂无回放"}
              </Badge>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {activeReplay?.summary
                ? blueprintCopy(activeReplay.summary)
                : "回放摘要会显示某条台账记录的恢复时间线。"}
            </p>

            {replays.length ? (
              <div className="mt-3 flex flex-wrap gap-2" data-testid="artifact-replay-list">
                {replays.map(replay => {
                  const selected = activeReplay?.id === replay.id;
                  return (
                    <button
                      key={replay.id}
                      type="button"
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-black transition",
                        selected
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
                      )}
                      onClick={() => setActiveReplayId(replay.id)}
                      aria-pressed={selected}
                    >
                      {blueprintCopy(replay.title)}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <RouteMetric
                label="快照"
                value={activeReplay?.snapshots.length ?? 0}
              />
              <RouteMetric
                label="血缘"
                value={`${activeReplay?.lineageEdgeCount ?? 0} 条边`}
              />
            </div>

            {activeReplay?.snapshots.length ? (
              <div className="mt-3 grid gap-2">
                {activeReplay.snapshots.slice(0, 4).map(snapshot => (
                  <div
                    key={snapshot.id}
                    className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-black text-slate-900">
                        {blueprintCopy(snapshot.title)}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        {artifactTokenLabel(snapshot.stage, "Artifact memory")}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                      {blueprintCopy(snapshot.summary)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div
            className="rounded-[16px] border border-slate-200 bg-white p-4"
            data-testid="artifact-diff-controls"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
                  <Clipboard className="size-3.5" aria-hidden="true" />
                资产差异
              </div>
              <Button
                type="button"
                size="sm"
                className="gap-2 rounded-full bg-slate-950 font-black text-white hover:bg-slate-800"
                disabled={!canDiff || diffing}
                onClick={handleDiffEntries}
                data-testid="artifact-diff-compare-button"
              >
                {diffing ? (
                  <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <GitBranch className="size-3.5" aria-hidden="true" />
                )}
                对比记录
              </Button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                左侧记录
                <select
                  value={leftEntryId}
                  onChange={event => setLeftEntryId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                >
                  <option value="">选择左侧记录</option>
                  {entries.map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {blueprintCopy(entry.title)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                右侧记录
                <select
                  value={rightEntryId}
                  onChange={event => setRightEntryId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                >
                  <option value="">选择右侧记录</option>
                  {entries.map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {blueprintCopy(entry.title)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {diff ? (
              <div className="mt-3 rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-sm font-black text-slate-900">
                  {blueprintCopy(diff.title)}
                </div>
                <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                  {blueprintCopy(diff.summary)}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-normal text-slate-500">
                  <span>{diff.added} 新增</span>
                  <span>{diff.removed} 删除</span>
                  <span>{diff.changed} 变更</span>
                  <span>{diff.unchanged} 未变更</span>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                选择两条台账记录来比较资产版本。
              </div>
            )}
          </div>

          <div
            className="rounded-[16px] border border-slate-200 bg-white p-4"
            data-testid="artifact-feedback-recorder"
          >
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              反馈回填记录器
            </div>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                台账记录
                <select
                  value={feedbackEntryId}
                  onChange={event => setFeedbackEntryId(event.target.value)}
                  className="h-10 rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                >
                  <option value="">选择记录</option>
                  {entries.map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {blueprintCopy(entry.title)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                  情绪
                  <select
                    value={feedbackSentiment}
                    onChange={event => setFeedbackSentiment(event.target.value)}
                    className="h-10 rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                  >
                    {ARTIFACT_FEEDBACK_SENTIMENT_OPTIONS.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-xs font-black uppercase tracking-normal text-slate-500">
                  状态
                  <select
                    value={feedbackStatus}
                    onChange={event => setFeedbackStatus(event.target.value)}
                    className="h-10 rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm font-semibold normal-case text-slate-700 outline-none transition focus:border-slate-400"
                  >
                    {ARTIFACT_FEEDBACK_STATUS_OPTIONS.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea
                value={feedbackSummary}
                onChange={event => setFeedbackSummary(event.target.value)}
                className="min-h-[72px] resize-y rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-slate-400"
                placeholder="反馈摘要"
              />
              <textarea
                value={feedbackNotes}
                onChange={event => setFeedbackNotes(event.target.value)}
                className="min-h-[72px] resize-y rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-slate-400"
                placeholder="回填备注"
              />
              <Button
                type="button"
                className="w-fit gap-2 rounded-full bg-slate-950 font-black text-white hover:bg-slate-800"
                disabled={!canRecordFeedback || recordingFeedback}
                onClick={handleRecordFeedback}
                data-testid="artifact-feedback-record-button"
              >
                {recordingFeedback ? (
                  <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="size-3.5" aria-hidden="true" />
                )}
                记录反馈
              </Button>
            </div>

            <div className="mt-4 grid gap-2" data-testid="artifact-feedback-list">
              {feedback.length ? (
                feedback.slice(0, 4).map(item => (
                  <div
                    key={item.id}
                    className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-black text-slate-900">
                        {blueprintCopy(item.summary)}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        {artifactTokenLabel(item.status, "Recorded")}
                      </span>
                    </div>
                    {item.notes ? (
                      <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                        {blueprintCopy(item.notes)}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                  执行评审后，反馈回填记录会显示在这里。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BlueprintErrorNotice({
  error,
  onRetry,
}: {
  error: ApiRequestError;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-[18px] border border-dashed border-rose-200 bg-rose-50 px-4 py-4 text-sm">
      <div className="font-black text-rose-950">{error.message}</div>
      <p className="mt-1 font-semibold leading-6 text-rose-700">
        {error.detail}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 gap-2 rounded-full border-rose-200 bg-white text-rose-700 hover:bg-rose-100 hover:text-rose-800"
        onClick={onRetry}
      >
        <RefreshCw className="size-3.5" aria-hidden="true" />
        重试
      </Button>
    </div>
  );
}

export function BlueprintProgressPanel({
  className,
  initialData = null,
  initialJob = null,
  initialRouteSet = null,
  initialSelection = null,
  initialSpecTree = null,
  initialSpecTreeVersions = null,
  initialSpecDocuments = null,
  initialEffectPreviews = null,
  initialPromptPackages = null,
  initialCapabilities = null,
  initialAgentCrew = null,
  initialClarificationSession = null,
  initialCapabilityInvocations = null,
  initialCapabilityEvidence = null,
  initialEngineeringLandingPlans = null,
  initialEngineeringRuns = null,
  initialArtifactLedgerEntries = null,
  initialArtifactReplays = null,
  initialArtifactFeedback = null,
  autoLoad = true,
  projectId = null,
  showRouteGeneration = true,
  showSpecProgress = true,
  showSpecTreePreview = true,
  showSpecDocumentWorkbench = true,
  showEffectPreviewWorkbench = true,
  showPromptPackageWorkbench = true,
  showRuntimeCapabilityBridgeWorkbench = true,
  showEngineeringLandingWorkbench = true,
  showArtifactMemoryWorkbench = true,
}: BlueprintProgressPanelProps) {
  const [progress, setProgress] = useState<BlueprintSpecsProgress | null>(
    initialData
  );
  const [latestJob, setLatestJob] = useState<BlueprintGenerationJob | null>(
    initialJob
  );
  const [routeSet, setRouteSet] = useState<BlueprintRouteSet | null>(
    initialRouteSet
  );
  const [selection, setSelection] = useState<BlueprintRouteSelection | null>(
    initialSelection
  );
  const [specTree, setSpecTree] = useState<BlueprintSpecTree | null>(
    initialSpecTree
  );
  const [specTreeVersions, setSpecTreeVersions] = useState<
    BlueprintSpecTreeVersionSnapshot[]
  >(initialSpecTreeVersions ?? []);
  const [specDocuments, setSpecDocuments] = useState<BlueprintSpecDocument[]>(
    initialSpecDocuments ?? []
  );
  const [effectPreviews, setEffectPreviews] = useState<
    BlueprintEffectPreview[]
  >(initialEffectPreviews ?? []);
  const [promptPackages, setPromptPackages] = useState<
    BlueprintPromptPackage[]
  >(initialPromptPackages ?? []);
  const [capabilities, setCapabilities] = useState<
    BlueprintRuntimeCapability[]
  >(initialCapabilities ?? []);
  const [agentCrew, setAgentCrew] = useState<BlueprintAgentCrewSnapshot | null>(
    initialAgentCrew
  );
  const [clarificationSession, setClarificationSession] =
    useState<BlueprintClarificationStrategySession | null>(
      initialClarificationSession
    );
  const [capabilityInvocations, setCapabilityInvocations] = useState<
    BlueprintCapabilityInvocation[]
  >(initialCapabilityInvocations ?? []);
  const [capabilityEvidence, setCapabilityEvidence] = useState<
    BlueprintCapabilityEvidence[]
  >(initialCapabilityEvidence ?? []);
  const [engineeringLandingPlans, setEngineeringLandingPlans] = useState<
    BlueprintEngineeringLandingPlan[]
  >(initialEngineeringLandingPlans ?? []);
  const [engineeringRuns, setEngineeringRuns] = useState<
    BlueprintEngineeringRun[]
  >(initialEngineeringRuns ?? []);
  const [artifactLedgerEntries, setArtifactLedgerEntries] = useState<
    BlueprintArtifactLedgerEntry[]
  >(initialArtifactLedgerEntries ?? []);
  const [artifactReplays, setArtifactReplays] = useState<
    BlueprintArtifactReplay[]
  >(initialArtifactReplays ?? []);
  const [artifactFeedback, setArtifactFeedback] = useState<
    BlueprintArtifactFeedback[]
  >(initialArtifactFeedback ?? []);
  const [generationInput, setGenerationInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectingRouteId, setSelectingRouteId] = useState<string | null>(null);
  const [resettingRouteSelection, setResettingRouteSelection] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [generationError, setGenerationError] =
    useState<ApiRequestError | null>(null);

  const loadProgress = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGenerationError(null);

    try {
      const [progressResult, latestResult] = await Promise.all([
        fetchBlueprintSpecsProgress(),
        fetchLatestBlueprintGenerationJob(),
      ]);

      if (progressResult.ok) {
        setProgress(progressResult.data);
      } else {
        setError(progressResult.error);
      }

      if (latestResult.ok) {
        setLatestJob(latestResult.data.job);
        setRouteSet(latestResult.data.routeSet ?? null);
        setSelection(latestResult.data.selection ?? null);
        setSpecTree(latestResult.data.specTree ?? null);
        setSpecTreeVersions(readLatestSpecTreeVersions(latestResult.data));
        setSpecDocuments(latestResult.data.specDocuments ?? []);
        setEffectPreviews(readLatestEffectPreviews(latestResult.data));
        setPromptPackages(readLatestPromptPackages(latestResult.data));
        setCapabilities(readLatestCapabilities(latestResult.data));
        setAgentCrew(readLatestAgentCrew(latestResult.data));
        setClarificationSession(readLatestClarificationSession(latestResult.data));
        setCapabilityInvocations(
          readLatestCapabilityInvocations(latestResult.data)
        );
        setCapabilityEvidence(readLatestCapabilityEvidence(latestResult.data));
        setEngineeringLandingPlans(
          readLatestEngineeringLandingPlans(latestResult.data)
        );
        setEngineeringRuns(readLatestEngineeringRuns(latestResult.data));
        setArtifactLedgerEntries(
          readLatestArtifactLedgerEntries(latestResult.data)
        );
        setArtifactReplays(readLatestArtifactReplays(latestResult.data));
        setArtifactFeedback(readLatestArtifactFeedback(latestResult.data));
      } else {
        setGenerationError(latestResult.error);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoLoad) return;

    let active = true;
    setLoading(true);
    setError(null);
    setGenerationError(null);

    Promise.all([
      fetchBlueprintSpecsProgress(),
      fetchLatestBlueprintGenerationJob(),
    ])
      .then(([progressResult, latestResult]) => {
        if (!active) return;
        if (progressResult.ok) {
          setProgress(progressResult.data);
        } else {
          setError(progressResult.error);
        }

        if (latestResult.ok) {
          setLatestJob(latestResult.data.job);
          setRouteSet(latestResult.data.routeSet ?? null);
          setSelection(latestResult.data.selection ?? null);
          setSpecTree(latestResult.data.specTree ?? null);
          setSpecTreeVersions(readLatestSpecTreeVersions(latestResult.data));
          setSpecDocuments(latestResult.data.specDocuments ?? []);
          setEffectPreviews(readLatestEffectPreviews(latestResult.data));
          setPromptPackages(readLatestPromptPackages(latestResult.data));
          setCapabilities(readLatestCapabilities(latestResult.data));
          setAgentCrew(readLatestAgentCrew(latestResult.data));
          setClarificationSession(readLatestClarificationSession(latestResult.data));
          setCapabilityInvocations(
            readLatestCapabilityInvocations(latestResult.data)
          );
          setCapabilityEvidence(readLatestCapabilityEvidence(latestResult.data));
          setEngineeringLandingPlans(
            readLatestEngineeringLandingPlans(latestResult.data)
          );
          setEngineeringRuns(readLatestEngineeringRuns(latestResult.data));
          setArtifactLedgerEntries(
            readLatestArtifactLedgerEntries(latestResult.data)
          );
          setArtifactReplays(readLatestArtifactReplays(latestResult.data));
          setArtifactFeedback(readLatestArtifactFeedback(latestResult.data));
        } else {
          setGenerationError(latestResult.error);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [autoLoad]);

  const generationRequest = useMemo(
    () => parseGenerationInput(generationInput),
    [generationInput]
  );
  const canGenerate =
    Boolean(generationRequest.targetText) ||
    generationRequest.githubUrls.length > 0;

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;

    setGenerating(true);
    setGenerationError(null);

    try {
      const result = await createBlueprintGenerationJob({
        projectId: projectId ?? undefined,
        targetText: generationRequest.targetText,
        githubUrls: generationRequest.githubUrls,
      });

      if (result.ok) {
        setLatestJob(result.data.job);
        setRouteSet(result.data.routeSet ?? null);
        setSelection(null);
        setSpecTree(null);
        setSpecTreeVersions([]);
        setSpecDocuments([]);
        setEffectPreviews([]);
        setPromptPackages([]);
        setCapabilities([]);
        setAgentCrew(null);
        setClarificationSession(result.data.clarificationSession ?? null);
        setCapabilityInvocations([]);
        setCapabilityEvidence([]);
        setEngineeringLandingPlans([]);
        setEngineeringRuns([]);
        setArtifactLedgerEntries([]);
        setArtifactReplays([]);
        setArtifactFeedback([]);
      } else {
        setGenerationError(result.error);
      }
    } finally {
      setGenerating(false);
    }
  }, [
    canGenerate,
    generationRequest.githubUrls,
    generationRequest.targetText,
    projectId,
  ]);

  const handleSelectRoute = useCallback(
    async (routeId: string) => {
      if (!latestJob) return;

      setSelectingRouteId(routeId);
      setGenerationError(null);

      try {
        const result = await selectBlueprintRoute(latestJob.id, {
          routeId,
          reason: "Selected from the blueprint autopilot RouteSet preview.",
        });

        if (result.ok) {
          setLatestJob(result.data.job);
          setRouteSet(result.data.routeSet);
          setSelection(result.data.selection);
          setSpecTree(result.data.specTree);
          setSpecTreeVersions([]);
        } else {
          setGenerationError(result.error);
        }
      } finally {
        setSelectingRouteId(null);
      }
    },
    [latestJob]
  );

  const handleResetRouteSelection = useCallback(async () => {
    if (!latestJob) return;

    setResettingRouteSelection(true);
    setGenerationError(null);

    try {
      const result = await resetBlueprintRouteSelection(latestJob.id);

      if (result.ok) {
        setLatestJob(result.data.job);
        setRouteSet(result.data.routeSet);
        setSelection(null);
        setSpecTree(null);
        setSpecTreeVersions([]);
        setSpecDocuments([]);
        setEffectPreviews([]);
        setPromptPackages([]);
        setCapabilities([]);
        setAgentCrew(null);
        setClarificationSession(null);
        setCapabilityInvocations([]);
        setCapabilityEvidence([]);
        setEngineeringLandingPlans([]);
        setEngineeringRuns([]);
        setArtifactLedgerEntries([]);
        setArtifactReplays([]);
        setArtifactFeedback([]);
      } else {
        setGenerationError(result.error);
      }
    } finally {
      setResettingRouteSelection(false);
    }
  }, [latestJob]);

  const overallTaskPercent = useMemo(() => {
    if (!progress) return 0;
    if (progress.totalTasks <= 0) return 0;
    return Math.round((progress.completedTasks / progress.totalTasks) * 100);
  }, [progress]);
  const panelEyebrow =
    showRouteGeneration && !showSpecProgress
      ? "自动驾驶"
      : showSpecProgress && !showRouteGeneration
        ? "推导"
        : "蓝图进度";
  const panelTitle =
    showRouteGeneration && !showSpecProgress
      ? "RouteSet 工厂"
      : showSpecProgress && !showRouteGeneration
        ? "SPEC 资产概览"
        : "SPEC 执行概览";
  const panelDetail = showSpecProgress
    ? progress?.root
      ? `${progress.root} / 更新于 ${formatGeneratedAt(progress.generatedAt)}`
      : "等待 /api/blueprint/specs 返回规格进度"
    : latestJob
      ? formatBlueprintJobStatus(latestJob)
      : "尚未生成 RouteSet";

  return (
    <section
      className={cn(
        "rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)]",
        className
      )}
      data-testid="blueprint-progress-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-normal text-slate-500">
            {panelEyebrow}
          </div>
          <h2 className="mt-2 text-xl font-black text-slate-950">
            {panelTitle}
          </h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
            {panelDetail}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 rounded-full border-slate-200 bg-slate-50 font-black text-slate-600 hover:bg-slate-100"
          disabled={loading}
          onClick={loadProgress}
        >
          <RefreshCw
            className={cn("size-3.5", loading && "animate-spin")}
            aria-hidden="true"
          />
          刷新
        </Button>
      </div>

      {showSpecProgress ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <SummaryTile
              label="规格"
              value={progress?.totalSpecs ?? "-"}
              detail={`${progress?.specs.length ?? 0} 项已列出`}
            />
            <SummaryTile
              label="文档完成"
              value={progress?.totalDocs ?? "-"}
              detail="需求 / 设计 / 任务"
            />
            <SummaryTile
              label="任务进度"
              value={progress ? `${overallTaskPercent}%` : "-"}
              detail={
                progress
                  ? `${progress.completedTasks}/${progress.totalTasks} 已完成`
                  : "暂无任务统计"
              }
            />
          </div>

          <Progress
            value={overallTaskPercent}
            className="mt-4 h-2 bg-slate-200 [&_[data-slot=progress-indicator]]:bg-[#0f766e]"
            aria-label={`蓝图总体任务完成度 ${overallTaskPercent}%`}
          />
        </>
      ) : null}

      {showRouteGeneration ? (
        <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-black uppercase tracking-normal text-slate-500">
                自动驾驶路线
              </div>
              <h3 className="mt-2 text-lg font-black text-slate-950">
                生成 RouteSet
              </h3>
            </div>
            {latestJob ? (
              <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500">
                {formatBlueprintJobStatus(latestJob)}
              </span>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <textarea
              value={generationInput}
              onChange={event => setGenerationInput(event.target.value)}
              className="min-h-[92px] resize-y rounded-[16px] border border-slate-200 bg-white px-3 py-3 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-[#0f766e]/50 focus:ring-2 focus:ring-[#0f766e]/15"
              placeholder="执行目标或 GitHub 地址"
              data-testid="blueprint-generation-input"
            />
            <Button
              type="button"
              className="h-11 gap-2 rounded-full bg-[#0f766e] px-5 font-black text-white hover:bg-[#115e59] md:self-end"
              disabled={!canGenerate || generating}
              onClick={handleGenerate}
              data-testid="blueprint-generate-button"
            >
              {generating ? (
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              生成
            </Button>
          </div>
          {generationError ? (
            <div className="mt-3">
              <BlueprintErrorNotice
                error={generationError}
                onRetry={loadProgress}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <BlueprintClarificationStrategySummary session={clarificationSession} />

      {showRouteGeneration && routeSet ? (
        <RouteSetPreview
          routeSet={routeSet}
          job={latestJob}
          selection={selection}
          selectingRouteId={selectingRouteId}
          onSelectRoute={handleSelectRoute}
          resettingSelection={resettingRouteSelection}
          onResetSelection={handleResetRouteSelection}
        />
      ) : null}

      {showSpecTreePreview && specTree ? (
        <SpecTreeWorkbenchPanel
          specTree={specTree}
          selection={selection}
          jobId={latestJob?.id}
          versions={specTreeVersions}
          onSpecTreeChange={setSpecTree}
          onSpecTreeVersionsChange={setSpecTreeVersions}
        />
      ) : null}

      {showSpecDocumentWorkbench && specTree ? (
        <SpecDocumentWorkbenchPanel
          specTree={specTree}
          jobId={latestJob?.id}
          initialDocuments={specDocuments}
          onDocumentsChange={setSpecDocuments}
        />
      ) : null}

      {showEffectPreviewWorkbench && specTree ? (
        <EffectPreviewWorkbenchPanel
          specTree={specTree}
          jobId={latestJob?.id}
          documents={specDocuments}
          initialPreviews={effectPreviews}
          agentCrew={agentCrew}
        />
      ) : null}

      {showPromptPackageWorkbench && specTree ? (
        <PromptPackageWorkbenchPanel
          specTree={specTree}
          jobId={latestJob?.id}
          documents={specDocuments}
          effectPreviews={effectPreviews}
          initialPackages={promptPackages}
          onPackagesChange={setPromptPackages}
        />
      ) : null}

      {showRuntimeCapabilityBridgeWorkbench && agentCrew ? (
        <BlueprintAgentCrewSurface
          agentCrew={agentCrew}
          capabilities={capabilities}
          invocations={capabilityInvocations}
          evidence={capabilityEvidence}
          roleEventProjection={buildRoleEventProjection(
            agentCrew,
            effectPreviews[0]
              ? normalizeRuntimeProjection(
                  effectPreviews[0],
                  readRuntimeProjection(effectPreviews[0])
                )
              : null
          )}
        />
      ) : null}

      {showRuntimeCapabilityBridgeWorkbench && specTree ? (
        <RuntimeCapabilityBridgeWorkbenchPanel
          specTree={specTree}
          jobId={latestJob?.id}
          initialCapabilities={capabilities}
          initialAgentCrew={agentCrew}
          initialInvocations={capabilityInvocations}
          initialEvidence={capabilityEvidence}
          onCapabilitiesChange={setCapabilities}
          onAgentCrewChange={setAgentCrew}
          onInvocationsChange={setCapabilityInvocations}
          onEvidenceChange={setCapabilityEvidence}
        />
      ) : null}

      {showEngineeringLandingWorkbench && specTree ? (
        <EngineeringLandingWorkbenchPanel
          jobId={latestJob?.id}
          promptPackages={promptPackages}
          initialPlans={engineeringLandingPlans}
          initialRuns={engineeringRuns}
          onLandingPlansChange={setEngineeringLandingPlans}
          onEngineeringRunsChange={setEngineeringRuns}
        />
      ) : null}

      {showArtifactMemoryWorkbench && latestJob ? (
        <ArtifactMemoryWorkbenchPanel
          jobId={latestJob.id}
          initialEntries={artifactLedgerEntries}
          initialReplays={artifactReplays}
          initialFeedback={artifactFeedback}
        />
      ) : null}

      {showSpecProgress ? (
        <div className="mt-4">
          {error ? (
            <BlueprintErrorNotice error={error} onRetry={loadProgress} />
          ) : null}

          {!error && !progress && loading ? (
            <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
              正在加载蓝图规格...
            </div>
          ) : null}

          {!error && progress && progress.specs.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
              暂未返回蓝图规格。
            </div>
          ) : null}

          {progress && progress.specs.length > 0 ? (
            <ScrollArea className="max-h-[520px] pr-3">
              <div className="grid gap-3">
                {progress.specs.map(spec => (
                  <article
                    key={spec.id}
                    className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4"
                    data-testid="blueprint-spec-progress-card"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="rounded-full bg-[#0f766e]/12 text-[#0f766e] hover:bg-[#0f766e]/12">
                            {blueprintCopy(spec.phase)}
                          </Badge>
                          <span className="text-xs font-black text-slate-400">
                            #{spec.order}
                          </span>
                        </div>
                        <h3 className="mt-2 text-base font-black leading-6 text-slate-950">
                          {blueprintCopy(spec.title)}
                        </h3>
                        <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
                          {blueprintCopy(spec.summary)}
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500">
                        {taskPercent(spec.tasks)}%
                      </span>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                      <DocsChecklist docs={spec.docs} />
                      <TasksProgress tasks={spec.tasks} />
                    </div>
                  </article>
                ))}
              </div>
            </ScrollArea>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default BlueprintProgressPanel;
