import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Coins,
  FileText,
  FolderKanban,
  History,
  LoaderCircle,
  Shield,
  Sparkles,
  TimerReset,
  Workflow,
} from "lucide-react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { useViewportTier } from "@/hooks/useViewportTier";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  workspaceCalloutClass,
  workspaceStatusClass,
  workspaceToneClass,
  type WorkspaceTone,
} from "@/components/workspace/workspace-tone";
import type {
  MissionOperatorActionLoadingMap,
  MissionTaskDetail,
  TaskArtifact,
} from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { ExecutorStatusPanel } from "@/components/ExecutorStatusPanel";
import { ExecutorTerminalPanel } from "@/components/ExecutorTerminalPanel";

import { useCostStore } from "@/lib/cost-store";
import { useRAGStore } from "@/lib/rag-store";
import { localizeTaskHubBriefText } from "@/lib/task-hub-copy";
import { RAGInfoPanel } from "@/components/rag/RAGInfoPanel";
import { RAGDebugPanel } from "@/components/rag/RAGDebugPanel";

import { ArtifactListBlock } from "./ArtifactListBlock";
import { EmptyHintBlock } from "./EmptyHintBlock";
import { ArtifactPreviewDialog } from "./ArtifactPreviewDialog";
import { DecisionHistory } from "./DecisionHistory";
import { DecisionPanel } from "./DecisionPanel";
import { RetryInlineNotice } from "./RetryInlineNotice";
import { TaskOperationsHero } from "./TaskOperationsHero";
import { TaskPlanetInterior } from "./TaskPlanetInterior";
import {
  compactText,
  downloadAttachmentArtifact,
  formatTaskDate,
  isMissionTerminal,
  timelineTone,
} from "./task-helpers";

const WORK_PACKAGE_PROGRESS: Record<string, number> = {
  assigned: 8,
  executing: 34,
  submitted: 58,
  reviewed: 72,
  audited: 80,
  revising: 66,
  verified: 100,
  passed: 100,
  failed: 36,
};

const DETAIL_CARD_CLASS = "workspace-panel rounded-[16px]";
const DETAIL_CARD_STRONG_CLASS =
  "workspace-panel workspace-panel-strong rounded-[16px]";
const DETAIL_INSET_CLASS =
  "workspace-panel-inset rounded-[12px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.66)]";
const DETAIL_INSET_SOFT_CLASS =
  "workspace-panel-inset rounded-[10px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.62)]";
const DETAIL_TEXTAREA_CLASS =
  "border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.68)] text-[11px] text-stone-700 min-h-[60px]";

function workPackageProgress(status: string): number {
  return WORK_PACKAGE_PROGRESS[status] || 12;
}

function workPackageTone(status: string): WorkspaceTone {
  if (status === "verified" || status === "passed") return "success";
  if (status === "failed") return "danger";
  if (status === "executing" || status === "revising") return "warning";
  if (status === "submitted" || status === "reviewed" || status === "audited") {
    return "info";
  }
  return "neutral";
}

function toneFromDecisionTone(
  tone: "primary" | "secondary" | "warning"
): string {
  if (tone === "warning") {
    return workspaceCalloutClass("warning", "hover:bg-[rgba(201,130,87,0.22)]");
  }
  if (tone === "secondary") {
    return workspaceCalloutClass("info", "hover:bg-[rgba(91,137,165,0.22)]");
  }
  return workspaceCalloutClass("success", "hover:bg-[rgba(94,139,114,0.22)]");
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div
      className={cn(
        DETAIL_INSET_CLASS,
        "px-2.5 py-2 shadow-sm backdrop-blur"
      )}
    >
      <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-stone-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-stone-900 md:text-xl">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] leading-4 text-stone-500">{hint}</div>
    </div>
  );
}

function DetailTextDialog({
  title,
  description,
  text,
  buttonLabel,
}: {
  title: string;
  description?: string;
  text: string;
  buttonLabel?: string;
}) {
  const { locale } = useI18n();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="workspace-control rounded-full border-[var(--workspace-panel-border)] bg-white/80 text-[10px] h-6 px-2"
        >
          {buttonLabel || t(locale, "查看更多", "More")}
        </Button>
      </DialogTrigger>
      <DialogContent className="workspace-panel workspace-panel-strong max-w-3xl rounded-[20px] border-[var(--workspace-panel-border)] bg-white/95 p-0 shadow-[0_24px_70px_rgba(112,84,51,0.16)]">
        <DialogHeader className="border-b border-stone-200/80 px-4 py-3">
          <DialogTitle className="text-stone-900 text-sm">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-xs leading-5 text-stone-500">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] w-full">
          <div className="whitespace-pre-wrap px-4 py-4 text-xs leading-6 text-stone-700">
            {text}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ExcerptBlock({
  title,
  description,
  text,
  maxLength,
  emptyText,
  className,
}: {
  title: string;
  description?: string;
  text: string;
  maxLength: number;
  emptyText?: string;
  className?: string;
}) {
  const { locale } = useI18n();
  const normalized = text.trim();
  const fallback =
    emptyText ||
    t(locale, "当前还没有记录详细内容。", "No detail captured yet.");
  const resolved = normalized || fallback;
  const preview = compactText(resolved, maxLength);
  const isTruncated = normalized.length > maxLength;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
        {title}
      </div>
      <div className="text-sm leading-6 text-stone-700">{preview}</div>
      {isTruncated ? (
        <DetailTextDialog
          title={title}
          description={description}
          text={resolved}
        />
      ) : null}
    </div>
  );
}

function SnapshotTile({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn(DETAIL_INSET_SOFT_CLASS, "px-3 py-3")}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium leading-6 text-stone-800">
        {value}
      </div>
    </div>
  );
}

function DetailTabViewport({
  isDesktop,
  autoHeight = false,
  children,
}: {
  isDesktop: boolean;
  autoHeight?: boolean;
  children: ReactNode;
}) {
  if (!isDesktop || autoHeight) {
    return <div className="space-y-4">{children}</div>;
  }

  return (
    <div
      className={cn(
        DETAIL_CARD_CLASS,
        "h-full min-h-0 overflow-hidden p-2 shadow-[0_24px_60px_rgba(112,84,51,0.06)]"
      )}
    >
      <ScrollArea className="h-full w-full">
        <div className="space-y-4 p-1 pr-3">{children}</div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost tab — Mission cost details, token timeline, cost curve
// @see Requirements 10.1, 10.2, 10.3
// ---------------------------------------------------------------------------

const TOKEN_AREA_COLORS = { in: "#6366f1", out: "#10b981" } as const;
const COST_LINE_COLOR = "#d07a4f";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function localizedTaskStatus(
  copy: ReturnType<typeof useI18n>["copy"],
  status: string
) {
  return (
    copy.workflow.statuses.task[
      status as keyof typeof copy.workflow.statuses.task
    ] ?? status
  );
}

function localizedExecutorStatus(
  copy: ReturnType<typeof useI18n>["copy"],
  status: string
) {
  switch (status) {
    case "queued":
      return copy.tasks.executor.statusQueued;
    case "running":
      return copy.tasks.executor.statusRunning;
    case "completed":
      return copy.tasks.executor.statusCompleted;
    case "failed":
      return copy.tasks.executor.statusFailed;
    case "warning":
      return copy.tasks.executor.statusWarning;
    default:
      return status;
  }
}

function localizedTimelineLevel(locale: string, level: string) {
  switch (level) {
    case "info":
      return t(locale, "信息", "Info");
    case "warning":
      return t(locale, "警告", "Warning");
    case "error":
      return t(locale, "异常", "Error");
    case "success":
      return t(locale, "成功", "Success");
    default:
      return level;
  }
}

function localizedSecurityLevel(locale: string, level: string) {
  switch (level) {
    case "strict":
      return t(locale, "严格", "Strict");
    case "balanced":
      return t(locale, "平衡", "Balanced");
    case "relaxed":
      return t(locale, "宽松", "Relaxed");
    default:
      return level;
  }
}

function formatCostValue(v: number): string {
  return `$${v.toFixed(4)}`;
}

function formatTokenCount(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function MissionCostTab() {
  const { locale } = useI18n();
  const snapshot = useCostStore(s => s.snapshot);
  const history = useCostStore(s => s.history);

  // Derive per-agent token breakdown for AreaChart
  const agentTokenData = useMemo(() => {
    if (!snapshot?.agentCosts.length) return [];
    return snapshot.agentCosts.map(a => ({
      name: a.agentName || a.agentId,
      tokensIn: a.tokensIn,
      tokensOut: a.tokensOut,
      cost: a.totalCost,
    }));
  }, [snapshot?.agentCosts]);

  // Derive history cost curve for LineChart
  const historyCurveData = useMemo(() => {
    if (!history.length) return [];
    return history.map(m => ({
      name: m.title.length > 12 ? `${m.title.slice(0, 12)}…` : m.title,
      cost: m.totalCost,
      tokens: m.totalTokensIn + m.totalTokensOut,
    }));
  }, [history]);

  if (!snapshot) {
    return (
      <Card className={DETAIL_CARD_CLASS}>
        <CardContent className="py-10 text-center text-sm text-stone-500">
          {t(
            locale,
            "暂无成本数据。记录到模型调用之后，这里会显示成本指标。",
            "No cost data available. Cost metrics will appear once LLM calls are recorded."
          )}
        </CardContent>
      </Card>
    );
  }

  const budgetPct = Math.min(Math.round(snapshot.budgetUsedPercent * 100), 100);
  const tokenPct = Math.min(Math.round(snapshot.tokenUsedPercent * 100), 100);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t(locale, "总成本", "Total Cost")}
          value={formatCostValue(snapshot.totalCost)}
          hint={t(
            locale,
            `预算已使用 ${budgetPct}%`,
            `Budget ${budgetPct}% used`
          )}
        />
        <MetricCard
          label={t(locale, "输入 Token", "Tokens In")}
          value={formatTokenCount(snapshot.totalTokensIn)}
          hint={t(
            locale,
            `Token 预算已使用 ${tokenPct}%`,
            `Token budget ${tokenPct}% used`
          )}
        />
        <MetricCard
          label={t(locale, "输出 Token", "Tokens Out")}
          value={formatTokenCount(snapshot.totalTokensOut)}
          hint={t(
            locale,
            `${snapshot.totalCalls} 次模型调用`,
            `${snapshot.totalCalls} LLM calls`
          )}
        />
        <MetricCard
          label={t(locale, "剩余预算", "Budget Remaining")}
          value={`${Math.max(100 - budgetPct, 0)}%`}
          hint={t(
            locale,
            `剩余 $${(snapshot.budget.maxCost - snapshot.totalCost).toFixed(4)}`,
            `$${(snapshot.budget.maxCost - snapshot.totalCost).toFixed(4)} left`
          )}
        />
      </div>

      {/* Budget progress */}
      <Card className={DETAIL_CARD_CLASS}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-stone-900">
            <Coins className="size-4 text-amber-600" />
            {t(locale, "预算使用情况", "Budget Usage")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>{t(locale, "成本", "Cost")}</span>
              <span>{budgetPct}%</span>
            </div>
            <Progress className="mt-1 h-2 bg-stone-200" value={budgetPct} />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>{t(locale, "Token", "Tokens")}</span>
              <span>{tokenPct}%</span>
            </div>
            <Progress className="mt-1 h-2 bg-stone-200" value={tokenPct} />
          </div>
        </CardContent>
      </Card>

      {/* Token consumption timeline — AreaChart by agent */}
      {agentTokenData.length > 0 && (
        <Card className={DETAIL_CARD_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-stone-900">
              <Coins className="size-4 text-indigo-600" />
              {t(
                locale,
                "按 Agent 查看 Token 消耗",
                "Token Consumption by Agent"
              )}
            </CardTitle>
            <CardDescription>
              {t(
                locale,
                "按 Agent 展示输入与输出 Token 拆分。",
                "Input and output token breakdown per agent."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={agentTokenData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  stroke="#a8a29e"
                />
                <YAxis tick={{ fontSize: 11 }} stroke="#a8a29e" />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e7e5e4",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="tokensIn"
                  name={t(locale, "输入 Token", "Tokens In")}
                  stackId="1"
                  stroke={TOKEN_AREA_COLORS.in}
                  fill={TOKEN_AREA_COLORS.in}
                  fillOpacity={0.35}
                />
                <Area
                  type="monotone"
                  dataKey="tokensOut"
                  name={t(locale, "输出 Token", "Tokens Out")}
                  stackId="1"
                  stroke={TOKEN_AREA_COLORS.out}
                  fill={TOKEN_AREA_COLORS.out}
                  fillOpacity={0.35}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Cost accumulation curve — LineChart from history */}
      {historyCurveData.length > 0 && (
        <Card className={DETAIL_CARD_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-stone-900">
              <Coins className="size-4 text-orange-600" />
              {t(locale, "成本累计曲线", "Cost Accumulation Curve")}
            </CardTitle>
            <CardDescription>
              {t(
                locale,
                `最近 ${historyCurveData.length} 个任务的历史成本趋势。`,
                `Historical mission cost trend (last ${historyCurveData.length} missions).`
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={historyCurveData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  stroke="#a8a29e"
                />
                <YAxis tick={{ fontSize: 11 }} stroke="#a8a29e" />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #e7e5e4",
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [
                    formatCostValue(value),
                    t(locale, "成本", "Cost"),
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="cost"
                  name={t(locale, "成本（$）", "Cost ($)")}
                  stroke={COST_LINE_COLOR}
                  strokeWidth={2}
                  dot={{ r: 3, fill: COST_LINE_COLOR }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Downgrade status */}
      {snapshot.downgradeLevel !== "none" && (
        <Card
          className={cn(
            DETAIL_CARD_STRONG_CLASS,
            "border-[rgba(201,130,87,0.24)] bg-[linear-gradient(180deg,rgba(255,250,246,0.96),rgba(249,238,228,0.92))]"
          )}
        >
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="size-5 text-amber-600" />
            <span className="text-sm font-medium text-[var(--workspace-text-strong)]">
              {t(locale, "已启用降级策略：", "Degradation active:")}{" "}
              <span className="font-semibold uppercase">
                {localizedSecurityLevel(locale, snapshot.downgradeLevel)}
              </span>
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type TaskDetailViewVariant = "default" | "cockpit";
type TaskDetailTabKey =
  | "overview"
  | "execution"
  | "decisions"
  | "artifacts"
  | "cost";

export function TaskDetailView({
  detail,
  decisionNote,
  onDecisionNoteChange,
  onLaunchDecision,
  launchingPresetId,
  onSubmitOperatorAction,
  operatorActionLoading,
  onDecisionSubmitted,
  variant = "default",
  autoHeight = false,
  deferRuntimeEvidence = false,
  className,
}: {
  detail: MissionTaskDetail | null;
  decisionNote: string;
  onDecisionNoteChange: (next: string) => void;
  onLaunchDecision: (presetId: string) => void | Promise<void>;
  launchingPresetId?: string | null;
  onSubmitOperatorAction?: (payload: {
    action: "pause" | "resume" | "retry" | "mark-blocked" | "terminate";
    reason?: string;
  }) => void | Promise<void>;
  operatorActionLoading?: MissionOperatorActionLoadingMap;
  onDecisionSubmitted?: () => void;
  variant?: TaskDetailViewVariant;
  autoHeight?: boolean;
  deferRuntimeEvidence?: boolean;
  className?: string;
}) {
  const { locale, copy } = useI18n();
  const { isDesktop } = useViewportTier();
  const isCockpit = variant === "cockpit";
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<
    string | null
  >(null);
  const [previewArtifactIndex, setPreviewArtifactIndex] = useState<
    number | null
  >(null);
  const [previewArtifactName, setPreviewArtifactName] = useState("");
  const [previewArtifactFormat, setPreviewArtifactFormat] = useState<
    string | undefined
  >(undefined);
  const [artifactError, setArtifactError] = useState<{
    artifact: TaskArtifact;
    message: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<TaskDetailTabKey>("overview");

  useEffect(() => {
    setPreviewArtifactIndex(null);
    setPreviewArtifactName("");
    setPreviewArtifactFormat(undefined);
    setArtifactError(null);
  }, [detail?.id]);

  if (!detail) {
    return (
      <Empty
        className={cn(
          "workspace-panel flex h-full items-center justify-center rounded-[16px] bg-[rgba(255,255,255,0.62)]",
          className
        )}
      >
        <EmptyHintBlock
          icon={<FolderKanban className="size-5" />}
          title={copy.tasks.emptyState.selectTitle}
          description={copy.tasks.emptyState.selectDescription}
          tone="info"
          className="max-w-lg"
        />
      </Empty>
    );
  }

  async function handleArtifactDownload(artifact: TaskArtifact) {
    setArtifactError(null);

    if (artifact.downloadKind === "external") {
      if (artifact.href && typeof window !== "undefined") {
        window.open(artifact.href, "_blank", "noopener,noreferrer");
      }
      return;
    }

    if (artifact.downloadKind === "attachment") {
      if (!downloadAttachmentArtifact(artifact)) {
        setArtifactError({
          artifact,
          message: copy.tasks.artifacts.downloadFailedDescription,
        });
      }
      return;
    }

    const downloadUrl = artifact.downloadUrl || artifact.href;
    if (!downloadUrl) {
      setArtifactError({
        artifact,
        message: copy.tasks.artifacts.downloadFailedDescription,
      });
      return;
    }

    setDownloadingArtifactId(artifact.id);
    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition");
      const filenameMatch = disposition?.match(/filename="?([^"]+)"?/i);
      const filename =
        filenameMatch?.[1] ||
        artifact.filename ||
        (artifact.format
          ? `${artifact.title}.${artifact.format}`
          : artifact.title);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : copy.tasks.artifacts.downloadFailedDescription;
      setArtifactError({
        artifact,
        message,
      });
    } finally {
      setDownloadingArtifactId(null);
    }
  }

  function handleArtifactPreview(artifact: TaskArtifact, index: number) {
    setPreviewArtifactIndex(index);
    setPreviewArtifactName(artifact.title);
    setPreviewArtifactFormat(artifact.format);
  }

  const terminalMission = isMissionTerminal(detail.status);
  const decisionEnabled =
    detail.status === "waiting" && detail.decisionPresets.length > 0;
  const decisionTextareaPlaceholder =
    detail.decisionPlaceholder ||
    (detail.decisionAllowsFreeText
      ? copy.tasks.detailView.decisionNotePlaceholder
      : copy.tasks.detailView.decisionStructuredOnly);

  const showStructuredDecisionPanel =
    detail.status === "waiting" && !!detail.decision;
  const showDecisionFocusSection =
    detail.status === "waiting" &&
    (showStructuredDecisionPanel || detail.decisionPresets.length > 0);
  const defaultTab: TaskDetailTabKey =
    isCockpit && showDecisionFocusSection ? "decisions" : "overview";
  const decisionHistoryEntries = detail.decisionHistory ?? [];

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab, detail.id]);

  const sourceDirectiveText = localizeTaskHubBriefText(
    detail.sourceText.trim(),
    locale
  );
  const runtimePreviewRows = [
    ...detail.instanceInfo.slice(0, 4),
    ...detail.logSummary.slice(0, 4),
  ];
  const runtimeDetailText = [
    t(locale, "实例信息", "Instance Info"),
    ...detail.instanceInfo.map(row => `${row.label}: ${row.value}`),
    "",
    t(locale, "日志摘要", "Log Summary"),
    ...detail.logSummary.map(row => `${row.label}: ${row.value}`),
  ].join("\n");

  const sourceDirectivePanel = (
    <Card className={DETAIL_CARD_CLASS}>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <FileText className="size-4 text-stone-600" />
          {copy.tasks.detailView.sourceTitle}
        </CardTitle>
        <CardDescription>
          {copy.tasks.detailView.sourceDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className={cn(DETAIL_INSET_CLASS, "px-3.5 py-3")}>
          <ExcerptBlock
            title={copy.tasks.detailView.sourcePreviewTitle}
            description={copy.tasks.detailView.sourcePreviewDescription}
            text={sourceDirectiveText}
            maxLength={132}
            emptyText={copy.tasks.detailView.noDetail}
          />
        </div>
      </CardContent>
    </Card>
  );

  const workPackagesPanel = (
    <Card className={DETAIL_CARD_CLASS}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <Workflow className="size-4 text-amber-600" />
          {copy.tasks.detailView.workPackagesTitle}
        </CardTitle>
        <CardDescription>
          {copy.tasks.detailView.workPackagesDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {detail.tasks.length > 0 ? (
          detail.tasks.map(task => {
            const progressValue = workPackageProgress(task.status);
            const scoreValue =
              task.total_score !== null && task.total_score !== undefined
                ? String(task.total_score)
                : copy.common.unavailable;
            const reviewState = task.meta_audit_feedback
              ? copy.tasks.detailView.reviewAudit
              : task.manager_feedback
                ? copy.tasks.detailView.reviewManager
                : copy.tasks.detailView.reviewPending;
            const deliverableText =
              task.deliverable_v3 ||
              task.deliverable_v2 ||
              task.deliverable ||
              copy.tasks.detailView.noDeliverable;
            const managerText =
              task.manager_feedback || copy.tasks.detailView.noManagerFeedback;
            const auditText =
              task.meta_audit_feedback || copy.tasks.detailView.noAuditSignal;

            return (
              <div key={task.id} className={cn(DETAIL_INSET_CLASS, "p-3.5")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-2">
                      <span className="workspace-status workspace-tone-neutral bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
                        #{task.id}
                      </span>
                      <span className="workspace-status workspace-tone-neutral bg-white/80 px-2.5 py-1 text-[11px] text-stone-600">
                        {task.department}
                      </span>
                      <span className="workspace-status workspace-tone-neutral bg-white/80 px-2.5 py-1 text-[11px] text-stone-600">
                        v{task.version}
                      </span>
                      <span
                        className={workspaceStatusClass(
                          workPackageTone(task.status),
                          "px-2.5 py-1 text-[11px] font-medium"
                        )}
                      >
                        {localizedTaskStatus(copy, task.status)}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-medium leading-6 text-stone-900">
                      {compactText(
                        task.description || copy.tasks.detailView.noWorkBrief,
                        118
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span
                        className={workspaceStatusClass(
                          "info",
                          "px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                        )}
                      >
                        {copy.tasks.detailView.progressLabel(progressValue)}
                      </span>
                      <span className="workspace-status workspace-tone-neutral bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">
                        {copy.tasks.detailView.scoreLabel} {scoreValue}
                      </span>
                      <span className="workspace-status workspace-tone-neutral bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">
                        {reviewState}
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      DETAIL_INSET_SOFT_CLASS,
                      "min-w-[184px] max-w-[220px] flex-1 px-3 py-2.5"
                    )}
                  >
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                      <span>{copy.tasks.detailView.executionLane}</span>
                      <span>{progressValue}%</span>
                    </div>
                    <Progress
                      className="mt-2 h-1.5 bg-stone-200"
                      value={progressValue}
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <SnapshotTile
                        label={copy.tasks.detailView.scoreLabel}
                        value={scoreValue}
                      />
                      <SnapshotTile
                        label={copy.tasks.detailView.reviewLabel}
                        value={reviewState}
                      />
                    </div>
                  </div>
                </div>

                <div
                  className={cn(
                    "mt-3 grid gap-2.5",
                    !isCockpit &&
                      "xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.05fr)_minmax(0,0.95fr)]"
                  )}
                >
                  <div className={cn(DETAIL_INSET_SOFT_CLASS, "p-3")}>
                    <ExcerptBlock
                      title={copy.tasks.detailView.workBriefTitle}
                      description={t(
                        locale,
                        `任务 #${task.id} 的完整工作简报。`,
                        `Full work brief for task #${task.id}.`
                      )}
                      text={
                        task.description || copy.tasks.detailView.noWorkBrief
                      }
                      maxLength={104}
                      emptyText={copy.tasks.detailView.noWorkBrief}
                    />
                  </div>
                  <div className={cn(DETAIL_INSET_SOFT_CLASS, "p-3")}>
                    <ExcerptBlock
                      title={copy.tasks.detailView.deliverablePreviewTitle}
                      description={t(
                        locale,
                        `任务 #${task.id} 的完整交付内容。`,
                        `Full deliverable payload for task #${task.id}.`
                      )}
                      text={deliverableText}
                      maxLength={150}
                      emptyText={copy.tasks.detailView.noDeliverable}
                    />
                  </div>
                  <div className="grid gap-2.5">
                    <div className={cn(DETAIL_INSET_SOFT_CLASS, "p-3")}>
                      <ExcerptBlock
                        title={copy.tasks.detailView.managerSignalTitle}
                        description={t(
                          locale,
                          `任务 #${task.id} 的负责人反馈。`,
                          `Manager review notes for task #${task.id}.`
                        )}
                        text={managerText}
                        maxLength={86}
                        emptyText={copy.tasks.detailView.noManagerFeedback}
                      />
                    </div>
                    <div className={cn(DETAIL_INSET_SOFT_CLASS, "p-3")}>
                      <ExcerptBlock
                        title={copy.tasks.detailView.auditSignalTitle}
                        description={t(
                          locale,
                          `任务 #${task.id} 的审计反馈。`,
                          `Audit notes for task #${task.id}.`
                        )}
                        text={auditText}
                        maxLength={86}
                        emptyText={copy.tasks.detailView.noAuditSignal}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <EmptyHintBlock
            icon={<Workflow className="size-4" />}
            title={copy.tasks.emptyHints.workPackagesTitle}
            description={copy.tasks.emptyHints.workPackagesDescription}
          />
        )}
      </CardContent>
    </Card>
  );

  const timelinePanel = (
    <Card className={DETAIL_CARD_CLASS}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <TimerReset className="size-4 text-sky-600" />
          {copy.tasks.detailView.timelineTitle}
        </CardTitle>
        <CardDescription>
          {copy.tasks.detailView.timelineDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {detail.timeline.length > 0 ? (
          detail.timeline.map(event => (
            <div key={event.id} className="relative pl-6">
              <div className="absolute left-[6px] top-0 h-full w-px bg-[rgba(174,146,120,0.28)]" />
              <div
                className={cn(
                  "absolute left-0 top-1.5 size-[13px] rounded-full border shadow-sm",
                  timelineTone(event.level)
                )}
              />
              <div className={cn(DETAIL_INSET_CLASS, "px-3.5 py-2.5")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-stone-900">
                        {event.title}
                      </div>
                      <span
                        className={cn(
                          "workspace-status px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                          timelineTone(event.level)
                        )}
                      >
                        {localizedTimelineLevel(locale, event.level)}
                      </span>
                    </div>
                    <div className="mt-1.5 text-sm leading-6 text-stone-600">
                      {compactText(event.description, 96)}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="workspace-status workspace-tone-neutral bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                        {formatTaskDate(event.time, locale)}
                      </span>
                      {event.actor ? (
                        <span className="workspace-status workspace-tone-neutral bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                          {event.actor}
                        </span>
                      ) : null}
                      {event.description.trim().length > 96 ? (
                        <DetailTextDialog
                          title={event.title}
                          description={
                            copy.tasks.detailView.timelineEventDescription
                          }
                          text={event.description}
                          buttonLabel={
                            copy.tasks.detailView.timelineDetailButton
                          }
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <EmptyHintBlock
            icon={<TimerReset className="size-4" />}
            title={copy.tasks.emptyHints.timelineTitle}
            description={copy.tasks.emptyHints.timelineDescription}
          />
        )}
      </CardContent>
    </Card>
  );

  const decisionPanel = (
    <Card className={DETAIL_CARD_CLASS}>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <Sparkles className="size-4 text-teal-600" />
          {copy.tasks.detailView.decisionEntryTitle}
        </CardTitle>
        <CardDescription>
          {detail.decisionPrompt || copy.tasks.detailView.decisionEntryFallback}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <Textarea
          value={decisionNote}
          onChange={event => onDecisionNoteChange(event.target.value)}
          className={cn(
            DETAIL_TEXTAREA_CLASS,
            "min-h-20 rounded-[18px] leading-6"
          )}
          placeholder={decisionTextareaPlaceholder}
          disabled={!detail.decisionAllowsFreeText}
        />
        {decisionEnabled ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {detail.decisionPresets.map(preset => (
              <button
                key={preset.id}
                type="button"
                className={cn(
                  "w-full rounded-[18px] border px-3.5 py-3 text-left transition-colors",
                  toneFromDecisionTone(preset.tone)
                )}
                onClick={() => void onLaunchDecision(preset.id)}
                disabled={launchingPresetId === preset.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{preset.label}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 opacity-80">
                      {preset.description}
                    </div>
                  </div>
                  {launchingPresetId === preset.id ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ArrowUpRight className="size-4" />
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-[20px] border border-dashed border-[rgba(174,146,120,0.34)] bg-[rgba(255,255,255,0.56)] px-4 py-4 text-sm leading-6 text-stone-500">
            {terminalMission
              ? copy.tasks.detailView.decisionTerminal
              : copy.tasks.detailView.decisionIdle}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const runtimeSnapshotPanel = (
    <Card className={DETAIL_CARD_CLASS}>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <Bot className="size-4 text-sky-600" />
          {copy.tasks.detailView.runtimeSnapshotTitle}
        </CardTitle>
        <CardDescription>
          {copy.tasks.detailView.runtimeSnapshotDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {runtimePreviewRows.length > 0 ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {runtimePreviewRows.map(row => (
                <SnapshotTile
                  key={row.label}
                  label={row.label}
                  value={row.value}
                />
              ))}
            </div>
            <div className="flex justify-end">
              <DetailTextDialog
                title={copy.tasks.detailView.runtimeSnapshotDetailsTitle}
                description={
                  copy.tasks.detailView.runtimeSnapshotDetailsDescription
                }
                text={runtimeDetailText}
                buttonLabel={copy.tasks.detailView.runtimeSnapshotDetailsButton}
              />
            </div>
          </>
        ) : (
          <EmptyHintBlock
            icon={<Bot className="size-4" />}
            title={copy.tasks.detailView.runtimeSnapshotEmptyTitle}
            description={copy.tasks.detailView.runtimeSnapshotEmptyDescription}
          />
        )}
      </CardContent>
    </Card>
  );

  const artifactsPanel = (
    <Card className={DETAIL_CARD_CLASS}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <FileText className="size-4 text-teal-600" />
          {copy.tasks.detailView.artifactsTitle}
        </CardTitle>
        <CardDescription>
          {copy.tasks.detailView.artifactsDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {artifactError ? (
          <RetryInlineNotice
            title={copy.tasks.artifacts.downloadFailedTitle}
            description={
              artifactError.message ===
              copy.tasks.artifacts.downloadFailedDescription
                ? artifactError.message
                : `${artifactError.message}. ${copy.tasks.artifacts.downloadFailedDescription}`
            }
            actionLabel={copy.tasks.artifacts.retryDownload}
            onRetry={() => void handleArtifactDownload(artifactError.artifact)}
          />
        ) : null}
        <ArtifactListBlock
          missionId={detail.id}
          artifacts={detail.artifacts}
          missionStatus={detail.status}
          variant="full"
          downloadingArtifactId={downloadingArtifactId}
          onDownload={handleArtifactDownload}
          onPreview={handleArtifactPreview}
        />
      </CardContent>
    </Card>
  );

  const failurePanel =
    detail.failureReasons.length > 0 ? (
      <Card
        className={cn(
          DETAIL_CARD_STRONG_CLASS,
          "border-[rgba(180,93,77,0.24)] bg-[linear-gradient(180deg,rgba(255,250,249,0.96),rgba(249,233,230,0.92))]"
        )}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[var(--workspace-text-strong)]">
            <AlertTriangle className="size-4 text-[var(--workspace-danger)]" />
            {copy.tasks.detailView.failureTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {detail.failureReasons.map(reason => (
            <div
              key={reason}
              className="workspace-callout workspace-tone-danger rounded-2xl bg-white/70 px-3 py-3"
            >
              <ExcerptBlock
                title={copy.tasks.detailView.failureSignalTitle}
                description={copy.tasks.detailView.failureSignalDescription}
                text={reason}
                maxLength={160}
                className="text-[var(--workspace-text-strong)]"
              />
            </div>
          ))}
        </CardContent>
      </Card>
    ) : null;

  const securitySummaryPanel = detail.securitySummary ? (
    <Card className={DETAIL_CARD_CLASS}>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <Shield className="size-4 text-stone-600" />
          {t(locale, "瀹夊叏绛栫暐", "Security Policy")}
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          {t(locale, "瀹瑰櫒娌欑閰嶇疆", "Container sandbox configuration")}
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
              detail.securitySummary.level === "strict"
                ? workspaceToneClass("danger")
                : detail.securitySummary.level === "balanced"
                  ? workspaceToneClass("warning")
                  : workspaceToneClass("success")
            )}
          >
            {localizedSecurityLevel(locale, detail.securitySummary.level)}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div
          className={cn(
            "grid gap-2 sm:grid-cols-2",
            !isCockpit && "lg:grid-cols-3"
          )}
        >
          <SnapshotTile
            label={t(locale, "用户", "User")}
            value={detail.securitySummary.user}
          />
          <SnapshotTile
            label={t(locale, "网络", "Network")}
            value={detail.securitySummary.networkMode}
          />
          <SnapshotTile
            label={t(locale, "只读文件系统", "Readonly FS")}
            value={
              detail.securitySummary.readonlyRootfs
                ? t(locale, "是", "Yes")
                : t(locale, "否", "No")
            }
          />
          <SnapshotTile
            label={t(locale, "内存", "Memory")}
            value={detail.securitySummary.memoryLimit}
          />
          <SnapshotTile
            label={t(locale, "CPU", "CPU")}
            value={detail.securitySummary.cpuLimit}
          />
          <SnapshotTile
            label={t(locale, "PIDs 限制", "PIDs Limit")}
            value={String(detail.securitySummary.pidsLimit)}
          />
        </div>
      </CardContent>
    </Card>
  ) : null;

  const executorStatusPanel = detail.executor ? (
    <Card className={DETAIL_CARD_CLASS}>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          <Bot className="size-4 text-sky-600" />
          {copy.tasks.executor.title}
        </CardTitle>
        <CardDescription>{copy.tasks.executor.description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <ExecutorStatusPanel
          executor={detail.executor}
          instance={detail.instance}
          artifacts={detail.missionArtifacts}
          missionStatus={detail.status}
        />
      </CardContent>
    </Card>
  ) : null;

  const executorTerminalPanel = detail.executor ? (
    <ExecutorTerminalPanel
      missionId={detail.id}
      missionStatus={detail.status}
      executorStatus={detail.executor.status}
    />
  ) : null;

  const decisionFocusSection =
    !isCockpit && showDecisionFocusSection ? (
      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {showStructuredDecisionPanel && detail.decision ? (
          <DecisionPanel
            missionId={detail.id}
            decision={detail.decision}
            onDecisionSubmitted={onDecisionSubmitted}
          />
        ) : null}
        {detail.decisionPresets.length > 0 ? decisionPanel : null}
      </section>
    ) : null;

  const decisionsWorkspace = (
    <div className="space-y-4">
      {isCockpit && showStructuredDecisionPanel && detail.decision ? (
        <DecisionPanel
          missionId={detail.id}
          decision={detail.decision}
          onDecisionSubmitted={onDecisionSubmitted}
        />
      ) : null}
      {isCockpit && detail.decisionPresets.length > 0 ? decisionPanel : null}
      <Card className={DETAIL_CARD_CLASS}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-stone-900">
            <History className="size-4 text-violet-600" />
            {copy.tasks.detailView.decisionHistoryTitle}
          </CardTitle>
          <CardDescription>
            {copy.tasks.detailView.decisionHistoryDescription}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DecisionHistory history={decisionHistoryEntries} />
        </CardContent>
      </Card>
    </div>
  );

  const showCockpitDecisionSection =
    showDecisionFocusSection || decisionHistoryEntries.length > 0;

  if (isCockpit) {
    return (
      <div
        className={cn(
          "flex min-h-0 flex-col gap-4",
          isDesktop && !autoHeight && "h-full",
          className
        )}
      >
        <DetailTabViewport isDesktop={isDesktop} autoHeight={autoHeight}>
          {showCockpitDecisionSection ? decisionsWorkspace : null}
          <TaskPlanetInterior detail={detail} compact />
          {sourceDirectivePanel}
          {!deferRuntimeEvidence && runtimePreviewRows.length > 0
            ? runtimeSnapshotPanel
            : null}
          {securitySummaryPanel}
          {!deferRuntimeEvidence ? executorStatusPanel : null}
          {!deferRuntimeEvidence && detail.status === "failed"
            ? executorTerminalPanel
            : null}
          {detail.tasks.length > 0 ? workPackagesPanel : null}
          {!deferRuntimeEvidence && detail.timeline.length > 0
            ? timelinePanel
            : null}
          {!deferRuntimeEvidence && (detail.artifacts.length > 0 || artifactError)
            ? artifactsPanel
            : null}
          {!deferRuntimeEvidence ? failurePanel : null}
        </DetailTabViewport>
        <ArtifactPreviewDialog
          missionId={detail.id}
          artifactIndex={previewArtifactIndex}
          artifactName={previewArtifactName}
          format={previewArtifactFormat}
          open={previewArtifactIndex !== null}
          onOpenChange={open => {
            if (!open) {
              setPreviewArtifactIndex(null);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-4",
        isDesktop && !autoHeight && "h-full",
        className
      )}
    >
      {!isCockpit ? (
        <TaskOperationsHero
          detail={detail}
          loadingByAction={operatorActionLoading}
          onSubmitOperatorAction={onSubmitOperatorAction}
        />
      ) : null}

      {decisionFocusSection}

      <Tabs
        value={activeTab}
        onValueChange={value => setActiveTab(value as TaskDetailTabKey)}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <div
          className={cn(
            DETAIL_CARD_CLASS,
            "shrink-0 shadow-[0_18px_50px_rgba(112,84,51,0.06)]",
            isCockpit ? "p-1.5" : "p-2"
          )}
        >
          <TabsList
            className={cn(
              "grid h-auto w-full grid-cols-5 bg-[rgba(255,255,255,0.58)] p-1",
              isCockpit ? "rounded-[16px]" : "rounded-[18px]"
            )}
          >
            <TabsTrigger className="rounded-[14px]" value="overview">
              {copy.tasks.detailView.overviewTab}
            </TabsTrigger>
            <TabsTrigger className="rounded-[14px]" value="execution">
              {copy.tasks.detailView.executionTab}
            </TabsTrigger>
            <TabsTrigger className="rounded-[14px]" value="decisions">
              <History className="mr-1.5 size-3.5" />
              {copy.tasks.detailView.decisionsTab}
            </TabsTrigger>
            <TabsTrigger className="rounded-[14px]" value="artifacts">
              {copy.tasks.detailView.artifactsTab}
            </TabsTrigger>
            <TabsTrigger className="rounded-[14px]" value="cost">
              <Coins className="mr-1.5 size-3.5" />
              {copy.tasks.detailView.costTab}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="overview"
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <DetailTabViewport isDesktop={isDesktop} autoHeight={autoHeight}>
            <div
              className={cn(
                "grid gap-4 xl:items-start",
                isCockpit
                  ? "xl:grid-cols-[minmax(0,1.02fr)_360px]"
                  : "xl:grid-cols-[minmax(0,1.12fr)_380px]"
              )}
            >
              <TaskPlanetInterior detail={detail} compact={isCockpit} />
              <div className="self-start space-y-3">
                {sourceDirectivePanel}
                {runtimeSnapshotPanel}
                {/* RAG Augmentation Info */}
                <Card className={DETAIL_CARD_CLASS}>
                  <CardHeader className="space-y-1 pb-3">
                    <CardTitle className="flex items-center gap-2 text-stone-900">
                      <Sparkles className="size-4 text-stone-600" />
                      {t(locale, "RAG 上下文", "RAG Context")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <RAGInfoPanel
                      logs={
                        useRAGStore.getState().taskData[detail.id]?.logs ?? []
                      }
                    />
                    <RAGDebugPanel
                      logs={
                        useRAGStore.getState().taskData[detail.id]?.logs ?? []
                      }
                    />
                  </CardContent>
                </Card>
              </div>
            </div>
          </DetailTabViewport>
        </TabsContent>

        <TabsContent
          value="execution"
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <DetailTabViewport isDesktop={isDesktop} autoHeight={autoHeight}>
            {detail.securitySummary && (
              <Card className={cn(DETAIL_CARD_CLASS, "mb-4")}>
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-stone-900">
                    <Shield className="size-4 text-stone-600" />
                    {t(locale, "安全策略", "Security Policy")}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    {t(
                      locale,
                      "容器沙箱配置",
                      "Container sandbox configuration"
                    )}
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                        detail.securitySummary.level === "strict"
                          ? workspaceToneClass("danger")
                          : detail.securitySummary.level === "balanced"
                            ? workspaceToneClass("warning")
                            : workspaceToneClass("success")
                      )}
                    >
                      {localizedSecurityLevel(
                        locale,
                        detail.securitySummary.level
                      )}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <SnapshotTile
                      label={t(locale, "用户", "User")}
                      value={detail.securitySummary.user}
                    />
                    <SnapshotTile
                      label={t(locale, "网络", "Network")}
                      value={detail.securitySummary.networkMode}
                    />
                    <SnapshotTile
                      label={t(locale, "只读文件系统", "Readonly FS")}
                      value={
                        detail.securitySummary.readonlyRootfs
                          ? t(locale, "是", "Yes")
                          : t(locale, "否", "No")
                      }
                    />
                    <SnapshotTile
                      label={t(locale, "内存", "Memory")}
                      value={detail.securitySummary.memoryLimit}
                    />
                    <SnapshotTile
                      label={t(locale, "CPU", "CPU")}
                      value={detail.securitySummary.cpuLimit}
                    />
                    <SnapshotTile
                      label={t(locale, "PIDs 限制", "PIDs Limit")}
                      value={String(detail.securitySummary.pidsLimit)}
                    />
                  </div>
                </CardContent>
              </Card>
            )}
            {detail.executor && (
              <Card className={cn(DETAIL_CARD_CLASS, "mb-4")}>
                <CardHeader className="space-y-1 pb-3">
                  <CardTitle className="flex items-center gap-2 text-stone-900">
                    <Bot className="size-4 text-sky-600" />
                    {copy.tasks.executor.title}
                  </CardTitle>
                  <CardDescription>
                    {copy.tasks.executor.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <ExecutorStatusPanel
                    executor={detail.executor}
                    instance={detail.instance}
                    artifacts={detail.missionArtifacts}
                    missionStatus={detail.status}
                  />
                </CardContent>
              </Card>
            )}
            {detail.executor && (
              <div className="mb-4">
                <ExecutorTerminalPanel
                  missionId={detail.id}
                  missionStatus={detail.status}
                  executorStatus={detail.executor.status}
                />
              </div>
            )}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)]">
              {workPackagesPanel}
              {timelinePanel}
            </div>
          </DetailTabViewport>
        </TabsContent>

        <TabsContent
          value="decisions"
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <DetailTabViewport isDesktop={isDesktop} autoHeight={autoHeight}>
            {decisionsWorkspace}
          </DetailTabViewport>
        </TabsContent>

        <TabsContent
          value="artifacts"
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <DetailTabViewport isDesktop={isDesktop} autoHeight={autoHeight}>
            <div className="space-y-4">
              {artifactsPanel}
              {failurePanel}
            </div>
          </DetailTabViewport>
        </TabsContent>

        <TabsContent
          value="cost"
          className="min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <DetailTabViewport isDesktop={isDesktop} autoHeight={autoHeight}>
            <MissionCostTab />
          </DetailTabViewport>
        </TabsContent>
      </Tabs>
      <ArtifactPreviewDialog
        missionId={detail.id}
        artifactIndex={previewArtifactIndex}
        artifactName={previewArtifactName}
        format={previewArtifactFormat}
        open={previewArtifactIndex !== null}
        onOpenChange={open => {
          if (!open) {
            setPreviewArtifactIndex(null);
          }
        }}
      />
    </div>
  );
}
