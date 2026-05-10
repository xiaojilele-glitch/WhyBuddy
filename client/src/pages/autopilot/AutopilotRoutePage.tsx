import { useCallback, useEffect, useMemo, useState } from "react";
import { Steps } from "antd";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  FileSearch,
  Gauge,
  GitBranch,
  HelpCircle,
  Layers3,
  Link2,
  Play,
  RefreshCw,
  Route,
  Send,
  Terminal,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Scene3D } from "@/components/Scene3D";
import { SPECS_PATH } from "@/components/navigation-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApiRequestError } from "@/lib/api-client";
import {
  createBlueprintClarificationSession,
  createBlueprintGenerationJob,
  createBlueprintIntake,
  fetchBlueprintProjectContext,
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
  type BlueprintRuntimeCapability,
} from "@/lib/blueprint-api";
import type { AppLocale } from "@/lib/locale";
import { useProjectStore } from "@/lib/project-store";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type {
  BlueprintClarificationAnswer,
  BlueprintClarificationReadiness,
  BlueprintClarificationSession,
  BlueprintGenerationArtifactType,
  BlueprintGenerationJob,
  BlueprintIntake,
  BlueprintProjectDomainContext,
  BlueprintRouteCandidate,
  BlueprintRouteSelection,
  BlueprintRouteSet,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";

import BlueprintProgressPanel from "../specs/BlueprintProgressPanel";
// Spec 1 scaffolding reference（`autopilot-cockpit-right-rail-convergence`）：
// 只做 type 级引用以验证 `AutopilotRightRailProps` 契约可被主页面消费；本 spec 不接管渲染，
// 真实搬运由 Spec 2 / 3 / 4 / 5 承接。前缀 `_` 避免 lint 警告 unused。
import type { AutopilotRightRailProps as _AutopilotRightRailProps } from "./right-rail";

const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/i;

type FlowStatus = "waiting" | "active" | "done" | "blocked";

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

interface ConsoleLine {
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

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
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

const DYNAMIC_ZH_COPY: Record<string, string> = {
  "Primary SPEC asset route": "主路线：SPEC 资产路线",
  "Documentation-first conservative route": "备选路线：文档优先稳态路线",
  "Preview-first exploratory route": "备选路线：效果预演探索路线",
  "Primary and alternative routes prepared for SPEC tree derivation.":
    "已为 SPEC 树推导准备主路线与备选路线。",
  "Clarify execution intent": "澄清执行意图",
  "Scan GitHub source": "扫描 GitHub 源码",
  "Map capability pool": "映射能力池",
  "Derive SPEC tree seed": "推导 SPEC 树种子",
  "Plan previews and prompts": "规划效果预演与提示词",
  "Collect target users and boundaries.": "收集目标用户与边界条件。",
  "Inspect repositories and extract technology stack, module boundaries, and reusable assets.":
    "检查仓库并提取技术栈、模块边界与可复用资产。",
  "Choose Docker, MCP, skills, AIGC nodes, and specialist roles for analysis coverage.":
    "选择 Docker、MCP、Skills、AIGC 节点与专业角色来覆盖分析任务。",
  "Transform primary and alternative route nodes into an editable SPEC tree asset.":
    "将主路线与备选路线节点转成可编辑的 SPEC 树资产。",
  "Prepare the downstream effect preview, architecture diagram, and implementation prompt package.":
    "准备下游效果预演、架构图与实现提示词包。",
  "Clarify the requested product direction, derive the durable SPEC tree, then expand documents, preview, and implementation prompts.":
    "澄清产品方向，推导可沉淀的 SPEC 树，再扩展规格文档、效果预演和实现提示词。",
  "Create a narrower SPEC tree first, freeze requirements/design/tasks, then preview and package prompts after review.":
    "先创建更收敛的 SPEC 树，评审后冻结 requirements / design / tasks，再生成预演和提示词。",
  "Push route analysis toward effect preview early, then backfill SPEC documents from the selected prototype direction.":
    "更早进入效果预演，再从选定的原型方向回填 SPEC 文档。",
  "Analyze source safely in an isolated runtime.":
    "在隔离运行时中安全分析源码。",
  "Build RBAC with audit evidence.": "构建带审计证据的 RBAC。",
};

function copyDynamic(locale: AppLocale, value: string | undefined): string {
  if (!value) return "";
  if (locale === "en-US") return value;

  const direct = DYNAMIC_ZH_COPY[value] ?? DYNAMIC_ZH_COPY[value.trim()];
  if (direct) return direct;

  const selectedRoute = value.match(/^Selected route:\s*(.+)$/);
  if (selectedRoute) {
    return `已选择路线：${copyDynamic(locale, selectedRoute[1])}`;
  }

  const specAssetTree = value.match(/^SPEC asset tree:\s*(.+)$/);
  if (specAssetTree) {
    return `SPEC 资产树：${copyDynamic(locale, specAssetTree[1])}`;
  }

  const effectPreview = value.match(/^Effect preview:\s*(.+)$/);
  if (effectPreview) {
    return `效果预演：${copyDynamic(locale, effectPreview[1])}`;
  }

  return value;
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

function countLabel(
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

function readRoleStateCount(
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
  const projectionReady = effectPreviews.length > 0;
  const clarificationReady = isClarificationReady(clarificationSession, readiness);

  return [
    {
      id: "input",
      index: 1,
      title: t(locale, "输入与上下文", "Input and context"),
      detail: intake
        ? t(locale, "输入记录已创建", "Intake recorded")
        : t(locale, "目标或 GitHub 地址", "Goal or GitHub URLs"),
      status: intake ? "done" : "active",
      icon: Link2,
    },
    {
      id: "clarification",
      index: 2,
      title: t(locale, "LLM 澄清", "LLM clarification"),
      detail: readReadinessLabel(readiness, locale),
      status: !intake
        ? "blocked"
        : workflowStage === "clarification"
          ? "active"
          : "done",
      icon: HelpCircle,
    },
    {
      id: "routeset",
      index: 3,
      title: t(locale, "路线编排", "Route orchestration"),
      detail: routeSet
        ? countLabel(locale, routeSet.routes.length, "条候选路线", "route", "routes")
        : t(locale, "等待 RouteSet", "Waiting for RouteSet"),
      status: !clarificationReady
        ? "blocked"
        : workflowStage === "routeset"
          ? "active"
          : "done",
      icon: Route,
    },
    {
      id: "selection",
      index: 4,
      title: t(locale, "路线选择", "Route selection"),
      detail: specTree
        ? t(
            locale,
            "路线已选中，SPEC 交接正在展开",
            "Route selected; SPEC handoff is underway"
          )
        : selection
          ? t(
              locale,
              "路线已选中，正在沉淀 SPEC 树",
              "Route selected; the SPEC tree is being derived"
            )
        : routeSet
          ? t(locale, "选中一条路线继续", "Choose a route to continue")
          : t(locale, "等待 RouteSet", "Waiting for RouteSet"),
      status: !routeSet
        ? "blocked"
        : workflowStage === "selection"
          ? "active"
          : "done",
      icon: FileSearch,
    },
    {
      id: "fabric",
      index: 5,
      title: "AgentCrewFabric",
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
          ? projectionReady
            ? "done"
            : "active"
          : "done",
      icon: Bot,
    },
    {
      id: "projection",
      index: 6,
      title: t(locale, "3D / HUD 联动", "3D / HUD projection"),
      detail: effectPreviews.length
        ? t(
            locale,
            `${effectPreviews.length} 个投影结果已同步`,
            `${effectPreviews.length} projected result${
              effectPreviews.length === 1 ? "" : "s"
            }`
          )
        : t(
            locale,
            "运行结果会投影到 3D 场景与 HUD",
            "Runtime results project into the 3D scene and HUD"
          ),
      status: !selection ? "blocked" : projectionReady ? "active" : "blocked",
      icon: Gauge,
    },
  ];
}

function ApiErrorNotice({
  error,
  className,
}: {
  error: ApiRequestError | null;
  className?: string;
}) {
  if (!error) return null;
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

function MetricBox({
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
  return (
    <div
      className="inline-flex rounded-[8px] border border-slate-200 bg-white p-1"
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
              "min-h-8 rounded-[6px] px-3 text-xs font-black transition",
              active
                ? "bg-slate-950 text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
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
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <MetricBox
          label={t(locale, "3D 场景", "3D scene")}
          value={
            preview?.runtimeProjection?.sceneSnapshotId ||
            (specTree
              ? countLabel(locale, specTree.nodes.length, "个节点", "node", "nodes")
              : t(locale, "待同步", "Pending"))
          }
          tone={specTree ? "good" : "neutral"}
          dark
        />
        <MetricBox
          label="AgentCrewFabric"
          value={
            agentCrew
              ? t(
                  locale,
                  `${activeRoles} 活跃 / ${reviewingRoles} 评审`,
                  `${activeRoles} active / ${reviewingRoles} reviewing`
                )
              : t(locale, "待初始化", "Pending")
          }
          tone={agentCrew ? "good" : "neutral"}
          dark
        />
        <MetricBox
          label="RouteSet"
          value={
            selection
              ? t(locale, "已选择", "Selected")
              : routeSet
                ? countLabel(locale, routeSet.routes.length, "条路线", "route", "routes")
                : t(locale, "待生成", "Pending")
          }
          tone={routeSet ? "good" : "neutral"}
          dark
        />
        <MetricBox
          label={t(locale, "证据", "Evidence")}
          value={
            capabilityEvidence.length > 0
              ? countLabel(
                  locale,
                  capabilityEvidence.length,
                  "条证据",
                  "evidence item",
                  "evidence items"
                )
              : countLabel(locale, effectPreviews.length, "个预演", "preview", "previews")
          }
          tone={capabilityEvidence.length || effectPreviews.length ? "good" : "neutral"}
          dark
        />
      </div>
    </aside>
  );
}

function AutopilotVisualStage({
  locale,
  currentProjectId,
  job,
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
  routeSet: BlueprintRouteSet | null;
  selection: BlueprintRouteSelection | null;
  specTree: BlueprintSpecTree | null;
  agentCrew: BlueprintAgentCrewSnapshot | null;
  effectPreviews: BlueprintEffectPreviewSnapshot[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  consoleLines: ConsoleLine[];
}) {
  return (
    <section
      className="overflow-hidden rounded-[14px] border border-slate-200 bg-slate-950"
      data-testid="autopilot-visual-stage"
    >
      <div
        className="relative min-h-[760px] overflow-hidden bg-slate-950 xl:min-h-[calc(100vh-104px)]"
        data-testid="autopilot-scene-visual"
        data-autopilot-stage={job?.stage ?? "input"}
        data-autopilot-route-state={
          selection ? "selected" : routeSet ? "generated" : "pending"
        }
        data-autopilot-crew-state={agentCrew ? "ready" : "pending"}
      >
        <div className="pointer-events-none absolute inset-0">
          <Scene3D performanceProfile="balanced" projectId={currentProjectId} />
        </div>

        <AutopilotMissionHud
          locale={locale}
          job={job}
          routeSet={routeSet}
          selection={selection}
          specTree={specTree}
          agentCrew={agentCrew}
          effectPreviews={effectPreviews}
          capabilityEvidence={capabilityEvidence}
          className="absolute left-4 top-4 z-10 w-[calc(100%-2rem)] max-w-[360px] xl:left-auto xl:right-5 xl:top-5"
        />

        <AutopilotConsolePanel
          locale={locale}
          lines={consoleLines}
          embedded
          className="absolute bottom-4 left-4 right-4 z-10 xl:bottom-5 xl:left-5 xl:right-[400px]"
        />
      </div>
    </section>
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

function ClarificationPanel({
  locale,
  session,
  answerDrafts,
  onAnswerChange,
  onSubmit,
  saving,
}: {
  locale: AppLocale;
  session: BlueprintClarificationSession | null;
  answerDrafts: Record<string, string>;
  onAnswerChange: (questionId: string, answer: string) => void;
  onSubmit: () => void;
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
  const canSubmit = draftAnswerCount > 0 && pendingChangeCount > 0 && !saving;

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
                        "rounded-[6px] border px-2.5 py-1.5 text-xs font-black transition",
                        active
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                      )}
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
              className="min-h-[74px] resize-y rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-slate-900/40 focus:ring-2 focus:ring-slate-900/10"
              placeholder={t(
                locale,
                "填写这条路线规划问题的答案",
                "Answer this route planning question"
              )}
              data-testid={`autopilot-answer-${question.id}`}
            />
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
              {pendingChangeCount > 0
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
            className="gap-2 rounded-[8px] bg-slate-950 px-4 font-black text-white hover:bg-slate-800"
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
        "rounded-[8px] border bg-slate-50 px-3 py-3",
        selected ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="line-clamp-2 text-sm font-black text-slate-950">
              {copyDynamic(locale, route.title)}
            </h3>
            <span className="rounded-[6px] bg-white px-2 py-0.5 text-[10px] font-black text-slate-600">
              {primary ? t(locale, "主路线", "Primary") : t(locale, "备选", "Alternative")}
            </span>
            {selected ? (
              <span className="rounded-[6px] bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                {t(locale, "已选择", "Selected")}
              </span>
            ) : null}
          </div>
          <p className="mt-2 line-clamp-3 text-xs font-semibold leading-5 text-slate-600">
            {copyDynamic(locale, route.summary)}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={selected ? "outline" : "default"}
          className={cn(
            "shrink-0 gap-2 rounded-[8px] font-black",
            selected
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
              : "bg-slate-950 text-white hover:bg-slate-800"
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

function AgentCrewSummary({
  locale,
  agentCrew,
  capabilities,
  capabilityInvocations,
  capabilityEvidence,
  effectPreviews,
}: {
  locale: AppLocale;
  agentCrew: BlueprintAgentCrewSnapshot | null;
  capabilities: BlueprintRuntimeCapability[];
  capabilityInvocations: BlueprintCapabilityInvocation[];
  capabilityEvidence: BlueprintCapabilityEvidence[];
  effectPreviews: BlueprintEffectPreviewSnapshot[];
}) {
  const roles = agentCrew?.roleTimelines ?? [];
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <MetricBox
          label={t(locale, "角色", "Roles")}
          value={agentCrew?.roles.length ?? 0}
          tone={agentCrew ? "good" : "neutral"}
        />
        <MetricBox
          label={t(locale, "能力绑定", "Bindings")}
          value={agentCrew?.capabilityMatrix.length ?? capabilities.length}
          tone={agentCrew || capabilities.length ? "good" : "neutral"}
        />
        <MetricBox
          label={t(locale, "能力调用", "Invocations")}
          value={capabilityInvocations.length}
          tone={capabilityInvocations.length ? "good" : "neutral"}
        />
        <MetricBox
          label={t(locale, "预演投影", "Preview projections")}
          value={effectPreviews.length}
          tone={effectPreviews.length ? "good" : "neutral"}
        />
      </div>

      {roles.length > 0 ? (
        <div className="space-y-2">
          {roles.slice(0, 4).map(role => (
            <div
              key={role.id}
              className="rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-black text-slate-900">
                    {locale === "zh-CN" ? role.displayLabel : role.displayName}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">
                    {copyDynamic(locale, role.currentAction)}
                  </div>
                </div>
                <span className="shrink-0 rounded-[6px] border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-600">
                  {statusLabel(role.state, locale)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[8px] border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-500">
          {t(
            locale,
            "RouteSet 或 SPEC 交接后，AgentCrewFabric 的角色、能力矩阵和 RoleTimeline 会在这里出现。",
            "After RouteSet or SPEC handoff, AgentCrewFabric roles, capability matrix, and RoleTimeline appear here."
          )}
        </div>
      )}

      {capabilityEvidence.length > 0 ? (
        <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs font-semibold leading-5 text-emerald-800">
          {t(
            locale,
            `已有 ${capabilityEvidence.length} 条能力证据写入事件流。`,
            `${capabilityEvidence.length} capability evidence items are recorded in the event stream.`
          )}
        </div>
      ) : null}
    </div>
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
  onSubmitAnswers,
  onGenerateRouteSet,
  onSelectRoute,
  apiError,
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
  onSubmitAnswers: () => void;
  onGenerateRouteSet: () => void;
  onSelectRoute: (routeId: string) => void;
  apiError: ApiRequestError | null;
}) {
  const primaryRoute =
    routeSet?.routes.find(route => route.id === routeSet.primaryRouteId) ??
    routeSet?.routes[0] ??
    null;
  const alternativeRoutes =
    routeSet?.routes.filter(route => route.id !== primaryRoute?.id) ?? [];
  const activeStepId =
    flowSteps.find(step => step.status === "active")?.id ??
    flowSteps[flowSteps.length - 1]?.id ??
    "input";
  const activeStepIndex = Math.max(
    flowSteps.findIndex(step => step.id === activeStepId),
    0
  );
  const railStepLabel = (step: FlowStep): string => {
    switch (step.id) {
      case "input":
        return t(locale, "输入", "Input");
      case "clarification":
        return t(locale, "澄清", "Clarify");
      case "routeset":
        return t(locale, "编排", "RouteSet");
      case "selection":
        return t(locale, "选择", "Select");
      case "fabric":
        return t(locale, "编组", "Fabric");
      case "projection":
        return t(locale, "3D/HUD", "3D/HUD");
      default:
        return step.title;
    }
  };

  const renderActiveStepBody = () => {
    switch (activeStepId) {
      case "input":
        return (
          <div className="grid gap-3" data-testid="autopilot-preflight">
            <label className="grid gap-1.5">
              <span className="text-xs font-black text-slate-700">
                {t(locale, "执行目标", "Execution goal")}
              </span>
              <textarea
                value={targetText}
                onChange={event => setTargetText(event.target.value)}
                className="min-h-[94px] resize-y rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-slate-900/40 focus:ring-2 focus:ring-slate-900/10"
                placeholder={t(
                  locale,
                  "描述你希望系统推演出的最终结果。",
                  "Describe the final outcome the system should reason toward."
                )}
                data-testid="autopilot-target-input"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-black text-slate-700">
                {t(locale, "GitHub 地址", "GitHub URLs")}
              </span>
              <textarea
                value={githubInput}
                onChange={event => setGithubInput(event.target.value)}
                className="min-h-[70px] resize-y rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-slate-900/40 focus:ring-2 focus:ring-slate-900/10"
                placeholder="https://github.com/org/repo"
                data-testid="autopilot-github-input"
              />
            </label>

            <div className="grid gap-2 sm:grid-cols-3">
              <MetricBox
                label={t(locale, "解析链接", "Parsed links")}
                value={parsedGithub.urls.length}
              />
              <MetricBox
                label={t(locale, "本地重复", "Duplicates")}
                value={parsedGithub.duplicates.length}
                tone={parsedGithub.duplicates.length ? "warn" : "neutral"}
              />
              <MetricBox
                label={t(locale, "项目上下文", "Context")}
                value={
                  loadingContext
                    ? t(locale, "加载中", "Loading")
                    : projectContext
                      ? t(locale, "已挂接", "Attached")
                      : t(locale, "等待", "Pending")
                }
                tone={projectContext ? "good" : "neutral"}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="gap-2 rounded-[8px] bg-slate-950 font-black text-white hover:bg-slate-800"
                disabled={!canCreateIntake || creatingIntake}
                onClick={onCreateIntake}
                data-testid="autopilot-create-intake-button"
              >
                {creatingIntake ? (
                  <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Link2 className="size-4" aria-hidden="true" />
                )}
                {intake
                  ? t(locale, "刷新输入记录", "Refresh intake")
                  : t(locale, "创建输入记录", "Create intake")}
              </Button>
            </div>

            <IntakeSummary locale={locale} intake={intake} />
            <ProjectContextSummary locale={locale} context={projectContext} />
          </div>
        );
      case "clarification":
        return (
          <div className="grid gap-3" data-testid="autopilot-clarification-step">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-2 rounded-[8px] border-slate-200 bg-white font-black text-slate-700 hover:bg-slate-50"
                disabled={!intake || generatingClarifications}
                onClick={onGenerateClarifications}
                data-testid="autopilot-generate-clarifications-button"
              >
                {generatingClarifications ? (
                  <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <HelpCircle className="size-4" aria-hidden="true" />
                )}
                {clarificationSession
                  ? t(locale, "刷新澄清", "Refresh clarification")
                  : t(locale, "生成澄清", "Generate clarification")}
              </Button>
              <span
                className={cn(
                  "rounded-[6px] px-2 py-1 text-[10px] font-black",
                  readiness?.status === "ready"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-600"
                )}
                data-testid="autopilot-readiness"
              >
                {readReadinessLabel(readiness, locale)}
              </span>
              {clarificationSession ? (
                <span className="rounded-[6px] bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">
                  {clarificationSession.id}
                </span>
              ) : null}
            </div>
            <ClarificationPanel
              locale={locale}
              session={clarificationSession}
              answerDrafts={answerDrafts}
              onAnswerChange={onAnswerChange}
              onSubmit={onSubmitAnswers}
              saving={savingAnswers}
            />
          </div>
        );
      case "routeset":
        return (
          <div
            className="grid gap-3"
            data-testid={
              routeSet ? "autopilot-routeset-panel" : "autopilot-routeset-empty"
            }
          >
            <div className="grid gap-2 sm:grid-cols-3">
              <MetricBox
                label="RouteSet"
                value={
                  routeSet
                    ? countLabel(locale, routeSet.routes.length, "条路线", "route", "routes")
                    : t(locale, "未生成", "Not generated")
                }
                tone={routeSet ? "good" : "neutral"}
              />
              <MetricBox
                label={t(locale, "阶段", "Stage")}
                value={
                  latestJob ? stageLabel(latestJob.stage, locale) : t(locale, "等待", "Pending")
                }
              />
              <MetricBox
                label={t(locale, "状态", "Status")}
                value={
                  latestJob ? statusLabel(latestJob.status, locale) : t(locale, "等待", "Pending")
                }
              />
            </div>
            {routeSet ? (
              <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-600">
                {copyDynamic(locale, routeSet.nextAsset.description)}
              </div>
            ) : null}
            <Button
              type="button"
              className="w-full gap-2 rounded-[8px] bg-slate-950 font-black text-white hover:bg-slate-800"
              disabled={!canGenerateRouteSet || generatingRouteSet}
              onClick={onGenerateRouteSet}
              data-testid="autopilot-generate-routeset-button"
            >
              {generatingRouteSet ? (
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              {t(locale, "生成 RouteSet", "Generate RouteSet")}
            </Button>
          </div>
        );
      case "selection":
        return (
          <div className="grid gap-3" data-testid="autopilot-selection-step">
            <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-600">
              {t(
                locale,
                "选中路线后会继续进入 SPEC 交接。",
                "Select a route to hand off into SPEC."
              )}
            </div>
            {primaryRoute ? (
              <RouteOption
                locale={locale}
                route={primaryRoute}
                primary
                selected={selection?.routeId === primaryRoute.id}
                selecting={selectingRouteId === primaryRoute.id}
                onSelect={onSelectRoute}
              />
            ) : (
              <div className="rounded-[8px] border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-500">
                {t(
                  locale,
                  "RouteSet 生成后，主路线和备选路线会在这里展开。",
                  "After RouteSet generation, the primary and alternative routes appear here."
                )}
              </div>
            )}
            {alternativeRoutes.map(route => (
              <RouteOption
                key={route.id}
                locale={locale}
                route={route}
                primary={false}
                selected={selection?.routeId === route.id}
                selecting={selectingRouteId === route.id}
                onSelect={onSelectRoute}
              />
            ))}
          </div>
        );
      case "fabric":
        return (
          <div className="grid gap-3" data-testid="autopilot-fabric-step">
            {selection ? (
              <AutopilotSpecTreeHandoffPanel
                locale={locale}
                job={latestJob}
                selection={selection}
                specTree={specTree}
                embedded
              />
            ) : (
              <div className="rounded-[8px] border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-semibold leading-5 text-slate-500">
                {t(
                  locale,
                  "先完成路线选择，AgentCrewFabric 才会展开。",
                  "Complete route selection before AgentCrewFabric expands."
                )}
              </div>
            )}
            <AgentCrewSummary
              locale={locale}
              agentCrew={agentCrew}
              capabilities={capabilities}
              capabilityInvocations={capabilityInvocations}
              capabilityEvidence={capabilityEvidence}
              effectPreviews={effectPreviews}
            />
          </div>
        );
      case "projection":
        return (
          <div className="grid gap-3" data-testid="autopilot-projection-step">
            <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs font-semibold leading-5 text-emerald-800">
              {t(
                locale,
                "3D 场景和 HUD 已联动，运行结果会直接投影到场景屏幕上。",
                "The 3D scene and HUD are linked, and runtime output projects directly into the scene."
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <MetricBox
                label={t(locale, "3D 场景", "3D scene")}
                value={
                  effectPreviews[0]?.runtimeProjection?.sceneSnapshotId ||
                  (selection
                    ? countLabel(locale, effectPreviews.length, "个投影", "projection", "projections")
                    : t(locale, "等待投影", "Pending"))
                }
                tone={selection ? "good" : "neutral"}
              />
              <MetricBox
                label="AgentCrewFabric"
                value={
                  agentCrew
                    ? t(
                        locale,
                        `${agentCrew.roles.length} 个角色 / ${agentCrew.capabilityMatrix.length} 个绑定`,
                        `${agentCrew.roles.length} roles / ${agentCrew.capabilityMatrix.length} bindings`
                      )
                    : t(locale, "等待角色编排", "Waiting for role orchestration")
                }
                tone={agentCrew ? "good" : "neutral"}
              />
              <MetricBox
                label={t(locale, "证据", "Evidence")}
                value={
                  capabilityEvidence.length > 0
                    ? countLabel(
                        locale,
                        capabilityEvidence.length,
                        "条证据",
                        "evidence item",
                        "evidence items"
                      )
                    : countLabel(locale, effectPreviews.length, "个预演", "preview", "previews")
                }
                tone={capabilityEvidence.length || effectPreviews.length ? "good" : "neutral"}
              />
              <MetricBox
                label={t(locale, "当前状态", "Current state")}
                value={latestJob ? readAutopilotJobStatus(latestJob, locale) : t(locale, "待机", "Standby")}
                tone="good"
              />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <aside
      className="grid min-w-0 content-start gap-3"
      data-testid="autopilot-workflow-rail"
    >
      <section
        className="min-w-0 overflow-hidden rounded-[14px] border border-slate-200 bg-white"
        data-testid="autopilot-workflow-steps"
      >
        <div className="border-b border-slate-200 px-3 py-3">
          <Steps
            className="w-full min-w-0 [&_.ant-steps-item]:min-w-0 [&_.ant-steps-item-container]:min-w-0 [&_.ant-steps-item-content]:min-w-0 [&_.ant-steps-item-title]:max-w-full [&_.ant-steps-item-title]:break-words [&_.ant-steps-item-title]:text-[10px] [&_.ant-steps-item-title]:leading-3"
            current={activeStepIndex}
            direction="horizontal"
            labelPlacement="vertical"
            size="small"
            responsive={false}
            items={flowSteps.map(step => ({
              title: (
                <span className="mx-auto block max-w-[64px] break-words text-center text-[10px] font-black leading-3 text-slate-950">
                  {railStepLabel(step)}
                </span>
              ),
              status:
                step.status === "done"
                  ? "finish"
                  : step.status === "active"
                    ? "process"
                    : "wait",
              disabled: step.status === "blocked",
              icon: (
                <span className="flex size-5 items-center justify-center rounded-full bg-slate-950 text-white">
                  <step.icon className="size-3" aria-hidden="true" />
                </span>
              ),
            }))}
          />
        </div>

        <div
          className="space-y-4 px-4 py-4"
          data-testid={`autopilot-step-${activeStepId}`}
        >
          {renderActiveStepBody()}
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
  const visibleLines = lines.slice(embedded ? -8 : -12);

  return (
    <section
      className={cn(
        "rounded-[12px] border text-white",
        embedded
          ? "border-white/10 bg-slate-950/82 shadow-[0_24px_64px_rgba(2,6,23,0.34)] backdrop-blur-xl"
          : "border-slate-900 bg-slate-950",
        className
      )}
      data-testid="autopilot-runtime-console"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-white/65">
          <Terminal className="size-3.5" aria-hidden="true" />
          {t(locale, "自动驾驶控制台", "Autopilot console")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[6px] border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-black text-emerald-200">
            {t(locale, "事件流", "Event stream")}
          </span>
          <span className="rounded-[6px] border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black text-white/55">
            {visibleLines.length}/{lines.length} {t(locale, "行", "lines")}
          </span>
        </div>
      </div>
      <div className="overflow-hidden px-4 py-3 font-mono text-[11px] leading-6">
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
        <Button
          asChild
          className="gap-2 rounded-[8px] bg-slate-950 px-4 font-black text-white hover:bg-slate-800"
        >
          <a href={SPECS_PATH} data-testid="autopilot-open-specs-link">
            {t(locale, "进入推导工作台", "Open deduction workbench")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </Button>
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
    >
      {content}
    </div>
  ) : (
    <section
      className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-4"
      data-testid="autopilot-spec-tree-handoff"
    >
      {content}
    </section>
  );
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
  const [routeSet, setRouteSet] = useState<BlueprintRouteSet | null>(null);
  const [selection, setSelection] = useState<BlueprintRouteSelection | null>(
    null
  );
  const [specTree, setSpecTree] = useState<BlueprintSpecTree | null>(null);
  const [apiError, setApiError] = useState<ApiRequestError | null>(null);
  const [creatingIntake, setCreatingIntake] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [generatingClarifications, setGeneratingClarifications] =
    useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [generatingRouteSet, setGeneratingRouteSet] = useState(false);
  const [selectingRouteId, setSelectingRouteId] = useState<string | null>(null);

  const parsedGithub = useMemo(
    () => parseGithubInput(githubInput),
    [githubInput]
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
        latestJob,
        routeSet,
        selection,
        specTree,
        capabilityInvocations: autopilotCapabilityInvocations,
        capabilityEvidence: autopilotCapabilityEvidence,
        effectPreviews: autopilotEffectPreviews,
        apiError,
      }),
    [
      apiError,
      autopilotCapabilityEvidence,
      autopilotCapabilityInvocations,
      autopilotEffectPreviews,
      clarificationSession,
      intake,
      latestJob,
      locale,
      routeSet,
      selection,
      specTree,
    ]
  );
  const blueprintPanelKey = `${latestJob?.id ?? "autopilot-blueprint-progress"}:${
    selection?.id ?? "route-unselected"
  }:${specTree?.id ?? "spec-tree-pending"}`;

  useEffect(() => {
    let active = true;
    setProjectContext(null);
    if (!currentProjectId) return;

    setLoadingContext(true);
    fetchBlueprintProjectContext(currentProjectId)
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
  }, [currentProjectId]);

  const handleAnswerChange = useCallback(
    (questionId: string, answer: string) => {
      setAnswerDrafts(previous => ({ ...previous, [questionId]: answer }));
    },
    []
  );

  const handleCreateIntake = useCallback(async () => {
    if (!canCreateIntake) return;
    setCreatingIntake(true);
    setApiError(null);

    try {
      const result = await createBlueprintIntake({
        projectId: currentProjectId ?? undefined,
        targetText: target || undefined,
        githubUrls: parsedGithub.urls,
      });

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
      } else {
        setApiError(result.error);
      }
    } finally {
      setCreatingIntake(false);
    }
  }, [canCreateIntake, currentProjectId, parsedGithub.urls, target]);

  const handleGenerateClarifications = useCallback(async () => {
    if (!intake) return;
    setGeneratingClarifications(true);
    setApiError(null);

    try {
      const result = await createBlueprintClarificationSession(intake.id, {
        projectId: currentProjectId ?? undefined,
      });

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
  }, [currentProjectId, intake]);

  const handleSaveAnswers = useCallback(async () => {
    if (!clarificationSession || answers.length === 0) return;
    setSavingAnswers(true);
    setApiError(null);

    try {
      const result = await saveBlueprintClarificationAnswers(
        clarificationSession.id,
        { answers, answeredBy: "autopilot" },
        clarificationSession.answers.length > 0 ? "PATCH" : "POST"
      );

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
  }, [answers, clarificationSession]);

  const handleGenerateRouteSet = useCallback(async () => {
    if (!canGenerateRouteSet) return;
    setGeneratingRouteSet(true);
    setApiError(null);

    try {
      const result = await createBlueprintGenerationJob({
        mode: "autopilot_route",
        projectId: currentProjectId ?? undefined,
        targetText: target || intake?.targetText || undefined,
        githubUrls:
          parsedGithub.urls.length > 0 ? parsedGithub.urls : intake?.githubUrls,
        intakeId: intake?.id,
        clarificationSessionId: clarificationSession?.id,
        clarifications: answers,
        domainContext: projectContext ?? undefined,
      });

      if (result.ok) {
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
    parsedGithub.urls,
    projectContext,
    target,
  ]);

  const handleSelectRoute = useCallback(
    async (routeId: string) => {
      if (!latestJob) return;
      setSelectingRouteId(routeId);
      setApiError(null);

      try {
        const result = await selectBlueprintRoute(latestJob.id, {
          routeId,
          reason: "Selected from the autopilot RouteSet workbench.",
          selectedBy: "autopilot",
        });

        if (result.ok) {
          setLatestJob(result.data.job);
          setRouteSet(result.data.routeSet);
          setSelection(result.data.selection);
          setSpecTree(result.data.specTree);
        } else {
          setApiError(result.error);
        }
      } finally {
        setSelectingRouteId(null);
      }
    },
    [latestJob]
  );

  return (
    <main
      className="min-h-screen bg-[#f4f6f8] text-slate-950"
      data-testid="autopilot-route-page"
    >
      <header
        className="sticky top-0 z-20 border-b border-slate-200 bg-white/92 px-3 py-3 backdrop-blur md:px-4"
        data-testid="autopilot-topbar"
      >
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-[9px] bg-slate-950 text-white">
              <Workflow className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-normal text-slate-500">
                <span>{t(locale, "项目自动驾驶", "Project autopilot")}</span>
                <span className="text-slate-300">/</span>
                <span>{t(locale, "SPEC-first 蓝图", "SPEC-first blueprint")}</span>
              </div>
              <div className="truncate text-base font-black text-slate-950">
                {currentProject?.name ||
                  t(locale, "未绑定项目", "No project selected")}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-[6px] border-slate-200 bg-slate-50 text-xs font-black text-slate-600"
            >
              {readAutopilotJobStatus(latestJob, locale)}
            </Badge>
            <AutopilotLanguageSwitch
              locale={locale}
              onLocaleChange={setLocale}
            />
          </div>
        </div>
      </header>

      <div className="grid w-full gap-4 px-0 py-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <AutopilotVisualStage
            locale={locale}
            currentProjectId={currentProjectId}
            job={latestJob}
            routeSet={routeSet}
            selection={selection}
            specTree={specTree}
            agentCrew={autopilotAgentCrew}
            effectPreviews={autopilotEffectPreviews}
            capabilityEvidence={autopilotCapabilityEvidence}
            consoleLines={consoleLines}
          />

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
            onSubmitAnswers={handleSaveAnswers}
            onGenerateRouteSet={handleGenerateRouteSet}
            onSelectRoute={handleSelectRoute}
            apiError={apiError}
          />
        </div>

        <details
          className="rounded-[14px] border border-slate-200 bg-white"
          data-testid="autopilot-advanced-workbenches"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-black text-slate-900">
            <span className="flex items-center gap-2">
              <Layers3 className="size-4 text-slate-500" aria-hidden="true" />
              {t(locale, "高级资产工作台", "Advanced asset workbenches")}
            </span>
            <span className="text-xs font-semibold text-slate-500">
              {t(
                locale,
                "展开查看 SPEC、预演、提示词、能力桥和回放",
                "Expand for SPEC, previews, prompts, capability bridge, and replay"
              )}
            </span>
          </summary>
          <div className="border-t border-slate-200 p-4">
            <BlueprintProgressPanel
              key={blueprintPanelKey}
              className="relative z-10"
              projectId={currentProjectId}
              initialJob={latestJob}
              initialRouteSet={routeSet}
              initialSelection={selection}
              initialSpecTree={specTree}
              initialEffectPreviews={autopilotEffectPreviews}
              initialCapabilities={autopilotCapabilities}
              initialAgentCrew={autopilotAgentCrew}
              initialClarificationSession={clarificationSession}
              initialCapabilityInvocations={autopilotCapabilityInvocations}
              initialCapabilityEvidence={autopilotCapabilityEvidence}
              autoLoad={false}
              showRouteGeneration={false}
              showSpecProgress={false}
              showSpecTreePreview
              showSpecDocumentWorkbench
              showEffectPreviewWorkbench
              showPromptPackageWorkbench
              showRuntimeCapabilityBridgeWorkbench
              showEngineeringLandingWorkbench={false}
              showArtifactMemoryWorkbench
            />
          </div>
        </details>
      </div>
    </main>
  );
}


// ---------------------------------------------------------------------------
// wt3 任务 3 注记（autopilot-blueprint-refactor-split）：
//
// 本文件仍为 AutopilotRoutePage 的**物理真相源**（约 2469 行），包含：
//   - 五个阶段面板（input / clarification / routeset / selection / fabric）
//     内联组件：AutopilotWorkflowRail、ClarificationPanel、RouteOption、
//     AgentCrewSummary、AutopilotSpecTreeHandoffPanel
//   - 三个辅助组件：AutopilotConsolePanel、AutopilotVisualStage、AutopilotMissionHud
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
