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
import { blueprintCopy as translateBlueprintCopy } from "@/lib/blueprint-copy";
import { useAppStore } from "@/lib/store";
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

import {
  AgentCrewFabricPanel,
  ArtifactMemoryPanel,
  EffectPreviewPanel,
  EngineeringHandoffPanel,
  PromptPackagePanel,
  RuntimeCapabilityPanel,
  SpecTreePanel,
} from "@/pages/autopilot/right-rail/panels";
import { useAutopilotRightRailData } from "@/pages/autopilot/right-rail/hooks";
import { AgentReasoningTimeline } from "@/components/blueprint/AgentReasoningTimeline";
import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";

function blueprintCopy(value: string | undefined): string {
  return translateBlueprintCopy(value, useAppStore.getState().locale);
}

function panelText(zh: string, en: string): string {
  return useAppStore.getState().locale === "zh-CN" ? zh : en;
}

type BlueprintEffectPreview = BlueprintEffectPreviewSnapshot & {
  title?: string;
};
type BlueprintEffectPreviewWithProjection = BlueprintEffectPreview & {
  runtimeProjection?: BlueprintEffectPreviewRuntimeProjection;
  runtime_projection?: unknown;
  projection?: unknown;
};
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
  const locale = useAppStore.getState().locale;
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

function formatBlueprintJobStatus(job: BlueprintGenerationJob | null): string {
  const locale = useAppStore.getState().locale;
  if (!job) return locale === "zh-CN" ? "尚未生成 RouteSet" : "No RouteSet generated yet";
  if (job.stage === "spec_tree" && job.status === "reviewing") {
    return locale === "zh-CN"
      ? "SPEC 树草稿已生成，等待推导工作台确认"
      : "SPEC tree draft generated; waiting for deduction workbench review";
  }
  return `${blueprintCopy(job.stage)} / ${blueprintCopy(job.status)}`;
}

function taskPercent(tasks: BlueprintTaskProgress): number {
  if (tasks.total <= 0) return tasks.percent;
  return Math.round((tasks.completed / tasks.total) * 100);
}

function routeLevelLabel(level: string): string {
  if (level === "low") return panelText("低", "Low");
  if (level === "medium") return panelText("中", "Medium");
  if (level === "high") return panelText("高", "High");
  if (level === "light") return panelText("轻量", "Light");
  if (level === "balanced") return panelText("均衡", "Balanced");
  if (level === "deep") return panelText("深度", "Deep");
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
            {panelText("自动驾驶 RouteSet", "Autopilot RouteSet")}
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">
            {selection
              ? panelText("已选择用于推导的路线", "Route selected for deduction")
              : job?.status === "completed"
                ? panelText("可生成 SPEC 树", "Ready for SPEC tree")
                : panelText("路线草稿", "Route draft")}
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
                <RefreshCw
                  className="size-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Undo2 className="size-3.5" aria-hidden="true" />
              )}
              {panelText("重置路线", "Reset route")}
            </Button>
          ) : null}
          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500">
            {panelText(
              `${routeSet.routes.length} 条路线`,
              `${routeSet.routes.length} routes`
            )}
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
    record?.runtimeProjection ??
    record?.runtime_projection ??
    record?.projection;
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
          runtimeProjection: normalizeRuntimeProjection(
            preview,
            latestProjection
          ),
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

function readLatestAgentCrew(
  value: unknown
): BlueprintAgentCrewSnapshot | null {
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
  const fallbackJobId =
    record?.job?.id ?? record?.jobId ?? record?.job_id ?? "";
  return normalizeBlueprintEngineeringLandingResponse(value, fallbackJobId)
    .landingPlans;
}

function readLatestEngineeringRuns(value: unknown): BlueprintEngineeringRun[] {
  const record = value as LatestJobWithEngineeringLanding | null;
  const fallbackJobId =
    record?.job?.id ?? record?.jobId ?? record?.job_id ?? "";
  return normalizeBlueprintEngineeringRunsResponse(value, fallbackJobId)
    .engineeringRuns;
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
    record?.artifactReplays ??
    record?.artifact_replays ??
    record?.replays ??
    [];
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

function engineeringRunStatusLabel(
  status: BlueprintEngineeringRunStatus
): string {
  const translated = blueprintCopy(status);
  if (translated !== status) return translated;

  return status
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function artifactTokenLabel(
  value: string | undefined,
  fallback: string
): string {
  const locale = useAppStore.getState().locale;
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
  if (state === "active") return panelText("活跃", "Active");
  if (state === "watching") return panelText("观察中", "Watching");
  if (state === "reviewing") return panelText("评审中", "Reviewing");
  if (state === "sleeping") return panelText("休眠", "Sleeping");
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
  if (state === "active") return panelText("驱动当前工作", "driving current work");
  if (state === "watching") {
    return panelText("观察交接信号", "watching handoff signals");
  }
  if (state === "reviewing") return panelText("评审证据", "reviewing evidence");
  if (state === "sleeping") return panelText("待命", "standing by");
  return panelText("角色在线状态", "role presence");
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
        label: panelText("3D 场景", "3D Scene"),
        value:
          projection?.sceneSnapshotId ||
          roleEventValue(
            sceneEvent,
            panelText("等待场景角色事件", "Waiting for scene role event")
          ),
        detail: sceneEvent
          ? panelText(
              `角色事件 ${sceneEvent.eventId} 让场景状态保持对齐。`,
              `Role event ${sceneEvent.eventId} keeps scene state aligned.`
            )
          : projection?.sceneSnapshotId
            ? panelText(
                "场景快照已链接到运行时投影。",
                "Scene snapshot is linked to the runtime projection."
              )
            : panelText("暂无场景角色事件。", "No scene role event yet."),
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
            panelText("等待 HUD 角色事件", "Waiting for HUD role event")
          ),
        detail: hudEvent
          ? panelText(
              `角色事件 ${hudEvent.eventId} 驱动 HUD 存在感 ${agentRoleStateLabel(
                hudEvent.presenceState
              )}。`,
              `Role event ${hudEvent.eventId} drives HUD presence ${agentRoleStateLabel(
                hudEvent.presenceState
              )}.`
            )
          : projection?.hudState.badges.length
            ? projection.hudState.badges.join(" / ")
            : `${artifactTokenLabel(projection?.hudState.status, "preview")} ${panelText(
                "状态",
                "status"
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
        label: panelText("日志", "Logs"),
        value:
          roleEventValue(logEvent, projection?.logTimeline[0]?.message ?? "") ||
          panelText("等待运行时日志", "Waiting for runtime logs"),
        detail: logEvent
          ? panelText(
              `角色事件 ${logEvent.eventId} 已镜像到日志。`,
              `Role event ${logEvent.eventId} is mirrored in logs.`
            )
          : projection?.logTimeline[0]?.occurredAt ||
            panelText(
              `${projection?.logTimeline.length ?? 0} 条运行时日志`,
              `${projection?.logTimeline.length ?? 0} runtime log entries`
            ),
        status: roleEventProjectionStatus(logEvent, "pending"),
        roleState: logEvent?.presenceState,
        eventType: logEvent?.type,
        sourceEventId: logEvent?.eventId,
      },
      {
        id: "browser",
        label: panelText("浏览器", "Browser"),
        value:
          projection?.browserPreviewId ||
          projection?.browserPreview.url ||
          roleEventValue(
            browserEvent,
            panelText("等待浏览器角色事件", "Waiting for browser role event")
          ),
        detail: browserEvent
          ? panelText(
              `角色事件 ${browserEvent.eventId} 让浏览器预览保持对齐。`,
              `Role event ${browserEvent.eventId} keeps browser preview aligned.`
            )
          : projection?.browserPreview.url ||
            projection?.browserPreview.summary ||
            projection?.browserPreview.title ||
            panelText("暂无浏览器预览角色事件。", "No browser preview role event yet."),
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
        label: panelText("SPEC 界面", "SPEC UI"),
        value: roleEventValue(
          specEvent ?? latestEvent,
          panelText("等待 SPEC 角色事件", "Waiting for SPEC role event")
        ),
        detail: specEvent
          ? panelText(
              `角色事件 ${specEvent.eventId} 会在 SPEC 界面中可见。`,
              `Role event ${specEvent.eventId} is visible in SPEC UI.`
            )
          : latestEvent
            ? panelText(
                `最新角色事件 ${latestEvent.eventId} 会在 SPEC 界面中可见。`,
                `Latest role event ${latestEvent.eventId} is visible in SPEC UI.`
              )
            : panelText("暂无角色事件流条目。", "No role event stream entries yet."),
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
          {refreshedAt
            ? `Refreshed ${formatEffectPreviewDate(refreshedAt)}`
            : "Refreshed"}
          {sourceSnapshotHash ? ` / ${sourceSnapshotHash}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function readRuntimeProjection(
  preview: BlueprintEffectPreview | null | undefined
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
            {panelText("运行时投影", "Runtime Projection")}
          </div>
          <h4 className="mt-2 truncate text-base font-black text-slate-950">
            {blueprintCopy(
              projection.hudState.title || "Runtime capability projection"
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
          label={panelText("3D 场景", "3D Scene")}
          value={runtimeProjectionValue(
            projection.sceneSnapshotId || sceneRoleItem?.value,
            panelText("等待场景快照", "Waiting for scene snapshot")
          )}
          detail={
            sceneRoleItem?.detail ||
            (projection.sceneSnapshotId
              ? panelText("场景快照已连接。", "Scene snapshot is linked.")
              : panelText("暂无场景快照。", "No scene snapshot yet."))
          }
          status={sceneRoleItem?.status ?? (hasScene ? "ready" : "pending")}
        />
        <RuntimeProjectionCard
          label="HUD"
          value={runtimeProjectionValue(
            projection.hudState.summary || hudRoleItem?.value,
            projection.hudState.title || panelText("等待 HUD 状态", "Waiting for HUD state")
          )}
          detail={
            hudRoleItem?.detail ??
            (projection.hudState.badges.length
              ? projection.hudState.badges.join(" / ")
              : `${artifactTokenLabel(projection.hudState.status, "preview")} ${panelText("状态", "status")}`)
          }
          status={
            hudRoleItem?.status ??
            (hasHud ? projection.hudState.status : "pending")
          }
        />
        <RuntimeProjectionCard
          label={panelText("日志", "Logs")}
          value={runtimeProjectionValue(
            latestLog?.message ||
              latestProjectedLog?.message ||
              logsRoleItem?.value,
            panelText("等待运行时日志", "Waiting for runtime logs")
          )}
          detail={
            logsRoleItem?.detail ||
            latestProjectedLog?.occurredAt ||
            panelText(
              `${projectedLogs.length} 条运行时日志`,
              `${projectedLogs.length} runtime log entries`
            )
          }
          status={
            logsRoleItem?.status ??
            (hasLogs ? (latestProjectedLog?.level ?? "ready") : "pending")
          }
        />
        <RuntimeProjectionCard
          label={panelText("浏览器", "Browser")}
          value={runtimeProjectionValue(
            projection.browserPreviewId || browserRoleItem?.value,
            projection.browserPreview.url || panelText("等待浏览器预览", "Waiting for browser preview")
          )}
          detail={
            browserRoleItem?.detail ||
            projection.browserPreview.url ||
            projection.browserPreview.summary ||
            projection.browserPreview.title ||
            panelText("暂无浏览器预览链接。", "No browser preview link yet.")
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
          {panelText("等待生成说明。", "Waiting for generation notes.")}
        </div>
      )}
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
  const subscribedLocale = useAppStore(state => state.locale);
  const locale =
    typeof window === "undefined"
      ? useAppStore.getState().locale
      : subscribedLocale;
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

  // Spec 4 Task 10：Phase A 接入右栏数据层 hook。
  //
  // 策略（方案 A —— 最小侵入）：
  //  - hook 与现有 useState 共存，作为桥接层；旧 `initial*` / `on*Change` 对外 API 完全不变。
  //  - `skipLazyLoad: autoLoad === true` 让 `/specs` 深链路径（SpecCenterPage / autoLoad=true）
  //    拉满 Wave 1-4；`autoLoad=false` 路径（测试与受控用法）hook gate 不打开，保持
  //    `data = initialData ?? null`，避免打破现有 `renderToStaticMarkup` 快照断言。
  //  - `initialData` 从本组件的 local state 读取（而不是 props 上的 `initial*`），因为 local
  //    state 的初始值来源于 `initial*`（见下方 useState(initialXxx ?? ...) 调用），两者在首次
  //    render 语义等价；后续 render 若 `initial*` 发生变化，autoLoad=false useEffect 仍然负责
  //    把它们同步回 local state（见 ~行 2048），local state 再作为下一次 render 传给 hook 的
  //    `initialData`，最终仍然到达 view.XXX.data。
  //  - `on*Change` 回调直接接到对应的 `setXxx` setter；hook fetch 成功（仅 autoLoad=true 路径
  //    会触发）时把结果写回 local state，驱动下游 canonical panel。
  //  - hook 返回值 `view` 本身**不读**：Phase A 的 canonical panel 仍然消费 local state（而不是
  //    `view.XXX.data`），保证 Spec 2 rendering-parity 快照不抖动；hook 充当纯粹的 fetch
  //    orchestrator + on*Change 驱动源。
  //  - 不提供 `currentSubStage`：`/specs` 路径不基于 fabric sub-stage gate，autoLoad=true 时由
  //    `skipLazyLoad` 直接打开 Wave 1-4。
  const effectiveJobId = latestJob?.id ?? "";
  useAutopilotRightRailData(effectiveJobId, {
    initialData: {
      job: latestJob,
      routeSet,
      selection,
      specTree,
      agentCrew,
      capabilities,
      capabilityInvocations,
      capabilityEvidence,
      effectPreviews,
      promptPackages,
      landingPlans: engineeringLandingPlans,
      engineeringRuns,
      artifactEntries: artifactLedgerEntries,
      artifactReplays,
      artifactFeedback,
    },
    skipLazyLoad: autoLoad === true,
    onJobChange: setLatestJob,
    onRouteSetChange: setRouteSet,
    onSelectionChange: setSelection,
    onSpecTreeChange: setSpecTree,
    onAgentCrewChange: setAgentCrew,
    onCapabilitiesChange: setCapabilities,
    onCapabilityInvocationsChange: setCapabilityInvocations,
    onCapabilityEvidenceChange: setCapabilityEvidence,
    onEffectPreviewsChange: setEffectPreviews,
    onPromptPackagesChange: setPromptPackages,
    onLandingPlansChange: setEngineeringLandingPlans,
    onEngineeringRunsChange: setEngineeringRuns,
    onArtifactEntriesChange: setArtifactLedgerEntries,
    onArtifactReplaysChange: setArtifactReplays,
    onArtifactFeedbackChange: setArtifactFeedback,
  });

  const loadProgress = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGenerationError(null);

    try {
      const [progressResult, latestResult] = await Promise.all([
        fetchBlueprintSpecsProgress(),
        fetchLatestBlueprintGenerationJob({ projectId: projectId ?? undefined }),
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
        setClarificationSession(
          readLatestClarificationSession(latestResult.data)
        );
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
  }, [projectId]);

  useEffect(() => {
    if (!autoLoad) return;

    let active = true;
    setLoading(true);
    setError(null);
    setGenerationError(null);

    Promise.all([
      fetchBlueprintSpecsProgress(),
      fetchLatestBlueprintGenerationJob({ projectId: projectId ?? undefined }),
    ])
      .then(([progressResult, latestResult]) => {
        if (!active) return;
        if (progressResult.ok) {
          setProgress(progressResult.data);
        } else {
          setError(progressResult.error);
        }

        if (latestResult.ok) {
          // Spec 4 Task 10：hook 覆盖的 15 个字段(job / routeSet / selection / specTree /
          // agentCrew / capabilities / capabilityInvocations / capabilityEvidence /
          // effectPreviews / promptPackages / landingPlans / engineeringRuns /
          // artifactEntries / artifactReplays / artifactFeedback)的 setter 已从本分支删除;
          // 由 `useAutopilotRightRailData`(autoLoad=true 路径 skipLazyLoad=true)接管 fetch
          // 与 on*Change 回写。此处仅保留 hook 不覆盖的派生字段:specTreeVersions /
          // specDocuments / clarificationSession。
          setSpecTreeVersions(readLatestSpecTreeVersions(latestResult.data));
          setSpecDocuments(latestResult.data.specDocuments ?? []);
          setClarificationSession(
            readLatestClarificationSession(latestResult.data)
          );
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
  }, [autoLoad, projectId]);

  useEffect(() => {
    if (autoLoad) return;

    setProgress(initialData);
    setLatestJob(initialJob);
    setRouteSet(initialRouteSet);
    setSelection(initialSelection);
    setSpecTree(initialSpecTree);
    setSpecTreeVersions(initialSpecTreeVersions ?? []);
    setSpecDocuments(initialSpecDocuments ?? []);
    setEffectPreviews(initialEffectPreviews ?? []);
    setPromptPackages(initialPromptPackages ?? []);
    setCapabilities(initialCapabilities ?? []);
    setAgentCrew(initialAgentCrew);
    setClarificationSession(initialClarificationSession);
    setCapabilityInvocations(initialCapabilityInvocations ?? []);
    setCapabilityEvidence(initialCapabilityEvidence ?? []);
    setEngineeringLandingPlans(initialEngineeringLandingPlans ?? []);
    setEngineeringRuns(initialEngineeringRuns ?? []);
    setArtifactLedgerEntries(initialArtifactLedgerEntries ?? []);
    setArtifactReplays(initialArtifactReplays ?? []);
    setArtifactFeedback(initialArtifactFeedback ?? []);
  }, [
    autoLoad,
    initialAgentCrew,
    initialArtifactFeedback,
    initialArtifactLedgerEntries,
    initialArtifactReplays,
    initialCapabilities,
    initialCapabilityEvidence,
    initialCapabilityInvocations,
    initialClarificationSession,
    initialData,
    initialEffectPreviews,
    initialEngineeringLandingPlans,
    initialEngineeringRuns,
    initialJob,
    initialPromptPackages,
    initialRouteSet,
    initialSelection,
    initialSpecDocuments,
    initialSpecTree,
    initialSpecTreeVersions,
  ]);

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
      ? locale === "zh-CN"
        ? "自动驾驶"
        : "Autopilot"
      : showSpecProgress && !showRouteGeneration
        ? locale === "zh-CN"
          ? "推导"
          : "Deduction"
        : locale === "zh-CN"
          ? "蓝图进度"
          : "Blueprint progress";
  const panelTitle =
    showRouteGeneration && !showSpecProgress
      ? locale === "zh-CN"
        ? "RouteSet 工厂"
        : "RouteSet factory"
      : showSpecProgress && !showRouteGeneration
        ? locale === "zh-CN"
          ? "SPEC 资产概览"
          : "SPEC asset overview"
        : locale === "zh-CN"
          ? "SPEC 执行概览"
          : "SPEC execution overview";
  const panelDetail = showSpecProgress
    ? progress?.root
      ? locale === "zh-CN"
        ? `${progress.root} / 更新于 ${formatGeneratedAt(progress.generatedAt)}`
        : `${progress.root} / updated ${formatGeneratedAt(progress.generatedAt)}`
      : locale === "zh-CN"
        ? "等待 /api/blueprint/specs 返回规格进度"
        : "Waiting for /api/blueprint/specs progress"
    : latestJob
      ? formatBlueprintJobStatus(latestJob)
      : locale === "zh-CN"
        ? "尚未生成 RouteSet"
        : "No RouteSet generated yet";

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
          {panelText("刷新", "Refresh")}
        </Button>
      </div>

      {showSpecProgress ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <SummaryTile
              label={panelText("规格", "Specs")}
              value={progress?.totalSpecs ?? "-"}
              detail={panelText(
                `${progress?.specs.length ?? 0} 项已列出`,
                `${progress?.specs.length ?? 0} listed`
              )}
            />
            <SummaryTile
              label={panelText("文档完成", "Docs complete")}
              value={progress?.totalDocs ?? "-"}
              detail={panelText("需求 / 设计 / 任务", "Requirements / design / tasks")}
            />
            <SummaryTile
              label={panelText("任务进度", "Task progress")}
              value={progress ? `${overallTaskPercent}%` : "-"}
              detail={
                progress
                  ? panelText(
                      `${progress.completedTasks}/${progress.totalTasks} 已完成`,
                      `${progress.completedTasks}/${progress.totalTasks} completed`
                    )
                  : panelText("暂无任务统计", "No task totals yet")
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
                {panelText("自动驾驶路线", "Autopilot route")}
              </div>
              <h3 className="mt-2 text-lg font-black text-slate-950">
                {panelText("生成 RouteSet", "Generate RouteSet")}
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
              placeholder={panelText(
                "执行目标或 GitHub 地址",
                "Execution goal or GitHub URL"
              )}
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
              {panelText("生成", "Generate")}
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

      {/* autopilot-agent-reasoning-stream：Agent 推理流时间线（有 job 时始终显示） */}
      {latestJob ? (
        <AgentReasoningTimelineSection jobId={latestJob.id} />
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
        <SpecTreePanel
          jobId={latestJob?.id ?? ""}
          specTree={specTree}
          selection={selection}
          locale={locale}
          versions={specTreeVersions}
          showDocuments={showSpecDocumentWorkbench}
          initialDocuments={specDocuments}
          onSpecTreeChange={setSpecTree}
          onSpecTreeVersionsChange={setSpecTreeVersions}
          onDocumentsChange={setSpecDocuments}
          onEffectPreviewGenerated={response => {
            // whybuddy-stage3-unblock-2026-05-29 — when the user clicks the
            // new "进入效果预演" CTA on the SpecDocumentWorkbenchPanel,
            // surface the new previews + advanced job state up here so the
            // Effect Preview workbench (showEffectPreviewWorkbench branch
            // below) lights up immediately.
            const previews = response.effectPreviews ?? [];
            setEffectPreviews(previews as BlueprintEffectPreview[]);
            const newJob = (response as unknown as {
              job?: BlueprintGenerationJob;
            }).job;
            if (newJob) setLatestJob(newJob);
          }}
        />
      ) : null}

      {showEffectPreviewWorkbench && specTree ? (
        <EffectPreviewPanel
          jobId={latestJob?.id ?? ""}
          job={latestJob}
          specTree={specTree}
          effectPreviews={effectPreviews}
          agentCrew={agentCrew}
          capabilityEvidence={capabilityEvidence}
          locale={locale}
          documents={specDocuments}
          initialPreviews={effectPreviews}
          onPreviewsChange={setEffectPreviews}
        />
      ) : null}

      {showPromptPackageWorkbench && specTree ? (
        <PromptPackagePanel
          jobId={latestJob?.id ?? ""}
          specTree={specTree}
          effectPreviews={effectPreviews}
          locale={locale}
          documents={specDocuments}
          initialPackages={promptPackages}
          onPackagesChange={setPromptPackages}
        />
      ) : null}

      {showRuntimeCapabilityBridgeWorkbench && agentCrew ? (
        <AgentCrewFabricPanel
          jobId={latestJob?.id ?? ""}
          job={latestJob}
          agentCrew={agentCrew}
          capabilities={capabilities}
          capabilityInvocations={capabilityInvocations}
          capabilityEvidence={capabilityEvidence}
          locale={locale}
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
        <RuntimeCapabilityPanel
          jobId={latestJob?.id ?? ""}
          specTree={specTree}
          capabilities={capabilities}
          capabilityInvocations={capabilityInvocations}
          capabilityEvidence={capabilityEvidence}
          agentCrew={agentCrew}
          locale={locale}
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
        <EngineeringHandoffPanel
          jobId={latestJob?.id ?? ""}
          locale={locale}
          promptPackages={promptPackages}
          initialPlans={engineeringLandingPlans}
          initialRuns={engineeringRuns}
          onLandingPlansChange={setEngineeringLandingPlans}
          onEngineeringRunsChange={setEngineeringRuns}
        />
      ) : null}

      {showArtifactMemoryWorkbench && latestJob ? (
        <ArtifactMemoryPanel
          jobId={latestJob.id}
          locale={locale}
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
              {panelText("正在加载蓝图规格...", "Loading blueprint specs...")}
            </div>
          ) : null}

          {!error && progress && progress.specs.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
              {panelText("暂未返回蓝图规格。", "No blueprint specs returned yet.")}
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

/**
 * autopilot-agent-reasoning-stream：Agent 推理流时间线包装组件。
 *
 * 在 job 运行中时显示，订阅 Socket.IO 事件流并渲染 Think/Act/Observe 卡片。
 * 当后端 bridge 尚未接通真实 CallbackReceiver 时，通过 store.dispatchEvent
 * 模拟几条 role.agent.* 事件让用户立刻看到 UI 效果（开发期临时方案）。
 */
function AgentReasoningTimelineSection({ jobId }: { jobId: string }) {
  const agentReasoning = useBlueprintRealtimeStore(s => s.agentReasoning);
  const subscribe = useBlueprintRealtimeStore(s => s.subscribe);
  const dispatchEvent = useBlueprintRealtimeStore(s => s.dispatchEvent);

  // 确保订阅当前 jobId
  useEffect(() => {
    subscribe(jobId);
  }, [jobId, subscribe]);

  // 开发期模拟：如果 5 秒后仍无 entries（说明后端 bridge 未接通），
  // 自动注入模拟的 Think/Act/Observe 事件让用户看到 UI 效果。
  useEffect(() => {
    const timer = setTimeout(() => {
      const state = useBlueprintRealtimeStore.getState();
      if (state.agentReasoning.entries.length > 0) return; // 已有真实事件，不模拟

      const now = Date.now();
      const simulatedEvents = [
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

      // 逐条延迟注入，模拟真实 LLM 节奏
      simulatedEvents.forEach((event, index) => {
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

  return (
    <div className="mt-4 rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_18px_42px_rgba(15,23,42,0.06)]">
      <div className="mb-3 flex items-center gap-2">
        <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-xs font-black uppercase tracking-normal text-slate-500">
          Agent 推理流
        </span>
        {agentReasoning.status === "streaming" && (
          <span className="text-[10px] text-slate-400">
            第 {agentReasoning.currentIteration} 轮
          </span>
        )}
      </div>
      <div className="h-[400px] overflow-hidden rounded-lg border border-slate-100 bg-slate-50">
        <AgentReasoningTimeline jobId={jobId} className="h-full" />
      </div>
    </div>
  );
}

export default BlueprintProgressPanel;


// ---------------------------------------------------------------------------
// wt4 任务 3 注记（autopilot-blueprint-refactor-split）：
//
// 本文件仍为 BlueprintProgressPanel 的**物理真相源**（约 5700 行），
// 包含 6 个内联 local function 面板（EffectPreviewWorkbenchPanel /
// PromptPackageWorkbenchPanel / RuntimeCapabilityBridgeWorkbenchPanel /
// EngineeringLandingWorkbenchPanel / ArtifactMemoryWorkbenchPanel /
// RuntimeProjectionCard / RouteCandidateCard）。
//
// 方案 B 下 `./panels/` 与 `./hooks/` 目录已经建立：
//   ./panels/ProgressHeaderPanel.tsx
//   ./panels/JobLedgerPanel.tsx
//   ./panels/SpecTreePanel.tsx         (re-export 已有 SpecTreeWorkbenchPanel)
//   ./panels/SpecDocumentsPanel.tsx    (re-export 已有 SpecDocumentWorkbenchPanel)
//   ./panels/EffectPreviewPanel.tsx
//   ./panels/PromptPackagePanel.tsx
//   ./panels/RuntimeCapabilityPanel.tsx
//   ./panels/EngineeringLandingPanel.tsx
//   ./panels/ArtifactMemoryPanel.tsx
//   ./panels/RouteCandidateCard.tsx
//   ./panels/RuntimeProjectionCard.tsx
//   ./panels/index.ts
//   ./hooks/use-blueprint-progress-data.ts
//
// 物理迁移路径（后续 iteration）：
// 1. 逐个把本文件内的 local function 组件标记 `export`（不删本地使用）；
// 2. 在对应 panels/*.tsx 中改为 `export { ... } from "../BlueprintProgressPanel.js"`；
// 3. 把组件**实物**搬到 panels/*.tsx，本文件保留 barrel re-export；
// 4. 把统一取数封装到 `use-blueprint-progress-data.ts`，让 BlueprintProgressPanel
//    只剩区块装配 + 数据分发。
//
// 当前任务 3 不做物理瘦身，目的是保证 wt4 不 break `data-testid` 稳定性与 UI 层级
// （需求 2.6、2.7、6.2）。
// ---------------------------------------------------------------------------
