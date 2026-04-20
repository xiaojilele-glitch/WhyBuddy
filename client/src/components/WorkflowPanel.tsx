import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  BookOpenText,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Download,
  FileText,
  Hand,
  History,
  Loader2,
  Monitor,
  Network,
  Paperclip,
  PanelRight,
  Play,
  Search,
  Send,
  Server,
  Shield,
  Square,
  Star,
  X,
  Zap,
} from "lucide-react";

import { ExportDialog } from "@/components/ExportDialog";
import { GlowButton } from "@/components/ui/GlowButton";
import { SkillCard, type SkillCardData } from "@/components/SkillCard";
import { ReputationBadge } from "@/components/reputation/ReputationBadge";
import { ReputationRadar } from "@/components/reputation/ReputationRadar";
import { ReputationHistory } from "@/components/reputation/ReputationHistory";
import { useReputationStore } from "@/lib/reputation-store";
import { useViewportTier } from "@/hooks/useViewportTier";
import { useI18n } from "@/i18n";
import { fetchJsonSafe, type ApiRequestError } from "@/lib/api-client";
import { prepareWorkflowAttachments } from "@/lib/workflow-attachments";
import { CAN_USE_ADVANCED_RUNTIME } from "@/lib/deploy-target";
import { useAppStore } from "@/lib/store";
import {
  createTTSEngine,
  type ClientVoiceConfig,
  type TTSEngine,
} from "@/lib/tts-engine";
import {
  useWorkflowStore,
  type AgentInfo,
  type AgentMemoryEntry,
  type HeartbeatReportInfo,
  type MessageInfo,
  type PanelView,
  type StageInfo,
  type TaskInfo,
  type WorkflowInputAttachment,
  type WorkflowInfo,
  type WorkflowOrganizationNode,
  type WorkflowOrganizationSnapshot,
} from "@/lib/workflow-store";
import { useRoleStore } from "@/lib/role-store";
import { getRoleColor } from "@/components/AgentRolePanel";
import {
  MAX_WORKFLOW_ATTACHMENTS,
  normalizeWorkflowAttachments,
} from "@shared/workflow-input";
import { useDemoStore } from "@/lib/demo-store";
import { useDemoMode } from "@/hooks/useDemoMode";
import { MemoryTimeline } from "@/components/demo/MemoryTimeline";
import { EvolutionScoreCard } from "@/components/demo/EvolutionScoreCard";
import { SessionHistoryTab } from "@/components/SessionHistoryTab";
import { WorkflowPanelCompatibility } from "@/components/WorkflowPanelCompatibility";
import { useAutonomyStore } from "@/lib/autonomy-store";
import {
  dispatchOfficeRuntimeEvidenceEvent,
  type OfficeRuntimeEvidenceTab,
} from "@/lib/navigation-events";
import { useTasksStore } from "@/lib/tasks-store";
import type { AssessmentResult, JudgingScore } from "@shared/autonomy-types";

const wfBadge: Record<string, string> = {
  pending: "bg-white/10 text-white/60",
  running: "bg-blue-500/15 text-blue-400",
  completed: "bg-emerald-500/15 text-emerald-400",
  completed_with_errors: "bg-amber-500/15 text-amber-400",
  failed: "bg-red-500/15 text-red-400",
};

const taskBadge: Record<string, string> = {
  assigned: "bg-white/10 text-slate-300",
  executing: "bg-blue-500/15 text-blue-400",
  submitted: "bg-violet-500/15 text-violet-400",
  reviewed: "bg-emerald-500/15 text-emerald-400",
  audited: "bg-amber-500/15 text-amber-400",
  revising: "bg-orange-500/15 text-orange-400",
  verified: "bg-teal-500/15 text-teal-400",
  passed: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-red-500/15 text-red-400",
};

const hbBadge: Record<string, string> = {
  idle: "bg-white/10 text-white/60",
  scheduled: "bg-blue-500/15 text-blue-400",
  running: "bg-cyan-500/15 text-cyan-400",
  error: "bg-red-500/15 text-red-400",
};

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
}

function getAttachmentStatusLabel(
  locale: string,
  attachment: WorkflowInputAttachment
) {
  if (attachment.excerptStatus === "metadata_only") {
    return t(locale, "仅导入元数据", "Metadata only");
  }

  if (attachment.excerptStatus === "truncated") {
    return t(
      locale,
      "全文已导入，预览已截断",
      "Full content imported, preview truncated"
    );
  }

  return t(locale, "全文已导入", "Full content imported");
}

function useFmt() {
  const locale = useAppStore(state => state.locale);
  const { copy } = useI18n();
  return (value: string | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value))
      : copy.common.unavailable;
}

function getDynamicStageLabel(
  locale: string,
  stageId: string,
  fallback: string
) {
  const labels: Record<string, { zh: string; en: string }> = {
    direction: { zh: "任务解构", en: "Task Framing" },
    planning: { zh: "团队就位", en: "Team Setup" },
    execution: { zh: "并行交付", en: "Parallel Delivery" },
    review: { zh: "主管复核", en: "Manager Review" },
    meta_audit: { zh: "质量审视", en: "Quality Audit" },
    revision: { zh: "修订回合", en: "Revision Loop" },
    verify: { zh: "结果确认", en: "Verification" },
    summary: { zh: "交付汇总", en: "Delivery Handoff" },
    feedback: { zh: "交付复盘", en: "Delivery Review" },
    evolution: { zh: "经验沉淀", en: "Knowledge Update" },
  };

  const next = labels[stageId];
  if (!next) return fallback;
  return locale === "zh-CN" ? next.zh : next.en;
}

function getDirectiveNarrative(locale: string) {
  return {
    sectionDescription:
      locale === "zh-CN"
        ? "输入一个执行目标后，系统会先判断任务需要哪些角色与能力，再组织执行团队、装配工具并推进交付。"
        : "After you enter an execution goal, the system decides which roles and capabilities are needed, organizes the execution team, and moves delivery forward.",
    modeNote:
      locale === "zh-CN"
        ? "右侧面板展示的是执行协调逻辑：系统会判断需要哪些协作角色，再为每个节点分配合适的能力和工具。"
        : "This panel reflects execution coordination logic: it decides which collaboration roles are needed and then assigns the right capabilities and tools to each node.",
    stepsTitle:
      locale === "zh-CN" ? "执行协同流程" : "Execution Coordination Flow",
    steps:
      locale === "zh-CN"
        ? [
            ["1. 解析问题", "先识别任务类型、复杂度、风险和需要覆盖的专业面。"],
            [
              "2. 团队就位",
              "为这次任务组织最合适的 CEO / manager / worker 结构，而不是套固定编制。",
            ],
            [
              "3. 装配能力",
              "给每个节点挂上合适的 skills、MCP、模型和并发策略。",
            ],
            ["4. 发布简报", "总负责人把目标拆成明确的分工、边界和交付要求。"],
            ["5. 并行交付", "可并行的角色同时推进，只在关键依赖处串联。"],
            ["6. 主管复核", "manager 汇总 worker 结果，检查完整性和可执行性。"],
            ["7. 质量审视", "对边界越界、证据不足、格式偏差做统一审视。"],
            ["8. 修订确认", "需要返工的节点进入修订回合，直到达到可交付标准。"],
            ["9. 交付汇总", "各角色先汇总，再由总负责人形成统一交付。"],
            ["10. 沉淀复用", "把这次组织和经验写入记忆，方便后续任务复用。"],
          ]
        : [
            [
              "1. Parse the ask",
              "Identify task type, complexity, risk, and the expertise that is actually needed.",
            ],
            [
              "2. Set up the team",
              "Create the best-fit CEO / manager / worker structure for this task instead of reusing fixed staffing.",
            ],
            [
              "3. Attach capabilities",
              "Bind the right skills, MCP tools, model choices, and concurrency settings to each node.",
            ],
            [
              "4. Publish the brief",
              "The lead turns the ask into explicit ownership, boundaries, and delivery expectations.",
            ],
            [
              "5. Drive parallel delivery",
              "Independent roles work simultaneously and only serialize on real dependencies.",
            ],
            [
              "6. Manager review",
              "Managers consolidate worker output and check completeness and actionability.",
            ],
            [
              "7. Audit quality",
              "Review boundary drift, weak evidence, and output quality across the org.",
            ],
            [
              "8. Revise and confirm",
              "Nodes that need rework go through another pass until they are deliverable.",
            ],
            [
              "9. Hand off delivery",
              "Roles summarize first, then the lead produces the final delivery.",
            ],
            [
              "10. Reuse the learning",
              "Store the organization pattern and lessons so later workflows can build on them.",
            ],
          ],
  };
}

function getFrontendWorkflowBanner(locale: string, canUseAdvanced: boolean) {
  if (locale === "zh-CN") {
    return canUseAdvanced
      ? "当前是浏览器预演视图：你可以先看系统如何准备执行团队、组织分工和展示链路，切到高级模式后才会真正执行。"
      : "当前部署是静态预览版：保留了执行协同的界面表达和流程视图，但不会连接服务端执行真实工作流。";
  }

  return canUseAdvanced
    ? "You are in the browser preview layer: it shows how the system prepares the execution team and coordination flow, but the real run only starts in Advanced Mode."
    : "This deployment is a static preview: it keeps the execution-coordination UI and flow visuals, but does not connect to the server to run a real workflow.";
}

function Section({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="border-b border-white/10 px-4 py-3">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      {description ? (
        <p className="mt-0.5 text-[10px] leading-5 text-white/50">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Network className="mb-3 h-10 w-10 text-white/30" />
      <p className="text-sm font-medium text-white/80">{title}</p>
      <p className="mt-1 text-[10px] text-white/50">{description}</p>
    </div>
  );
}

export function WorkflowErrorNotice({
  error,
  onRetry,
  className,
}: {
  error: ApiRequestError;
  onRetry?: () => void;
  className?: string;
}) {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);

  const title =
    error.kind === "demo"
      ? t(locale, "当前显示的是回退内容", "Showing fallback preview data")
      : error.kind === "offline"
        ? t(locale, "后端暂时不可用", "The backend is temporarily unavailable")
        : t(locale, "这部分内容暂时无法更新", "This panel could not refresh");

  return (
    <div
      className={`rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-amber-100 ${
        className || ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-300" />
            <span>{title}</span>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-amber-100">
            {error.message}
          </p>
          <p className="mt-1 text-[10px] leading-5 text-amber-200/80">
            {error.detail}
          </p>
        </div>
        {onRetry && error.retryable ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-amber-300/30 bg-white/10 px-3 py-2 text-[10px] font-semibold text-amber-100 transition-colors hover:bg-white/20"
          >
            <Loader2 className="h-3.5 w-3.5" />
            <span>{copy.tasks.statuses.action.retry}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[8px] font-medium text-white/60">
      {children}
    </span>
  );
}

function StageBar({
  stages,
  current,
}: {
  stages: StageInfo[];
  current: string | null;
}) {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const idx = stages.findIndex(stage => stage.id === current);
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {stages.map((stage, i) => {
        const active = stage.id === current;
        const done = idx >= 0 && i < idx;
        const fallbackLabel =
          copy.workflow.stages[stage.id as keyof typeof copy.workflow.stages] ||
          stage.label;
        const label = getDynamicStageLabel(locale, stage.id, fallbackLabel);
        return (
          <div
            key={stage.id}
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${
              done
                ? "bg-emerald-500/15 text-emerald-400"
                : active
                  ? "bg-blue-500/15 text-blue-400"
                  : "bg-white/5 text-white/50"
            }`}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}

function getOrganization(
  workflow: WorkflowInfo | null | undefined
): WorkflowOrganizationSnapshot | null {
  const organization = workflow?.results?.organization;
  if (!organization || typeof organization !== "object") return null;
  return Array.isArray((organization as WorkflowOrganizationSnapshot).nodes)
    ? (organization as WorkflowOrganizationSnapshot)
    : null;
}

function getNodeMap(organization: WorkflowOrganizationSnapshot | null) {
  return new Map(organization?.nodes.map(node => [node.agentId, node]) || []);
}

function getNodeName(
  agentId: string,
  nodeMap: Map<string, WorkflowOrganizationNode>,
  fallback?: string
) {
  return nodeMap.get(agentId)?.name || fallback || agentId;
}

function agentStatusLabel(
  copy: ReturnType<typeof useI18n>["copy"],
  status: string | null | undefined
) {
  if (!status) return copy.workflow.statuses.agent.idle;
  return (
    copy.workflow.statuses.agent[
      status as keyof typeof copy.workflow.statuses.agent
    ] || status
  );
}

function taskStatusIcon(status: string) {
  switch (status) {
    case "assigned":
      return <Clock className="h-3.5 w-3.5 text-slate-400" />;
    case "executing":
    case "revising":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />;
    case "submitted":
    case "passed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "reviewed":
      return <Star className="h-3.5 w-3.5 text-amber-500" />;
    case "audited":
      return <Shield className="h-3.5 w-3.5 text-orange-500" />;
    case "failed":
      return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-slate-400" />;
  }
}

type RoleProgressStatus = "blocked" | "active" | "review" | "done" | "idle";

function summarizeText(
  value: string | null | undefined,
  fallback: string,
  maxLength = 72
) {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function getTaskPrimaryText(task: TaskInfo) {
  return task.deliverable_v3 || task.deliverable_v2 || task.deliverable || "";
}

function dispatchOfficeRuntimeEvidence(
  tab: OfficeRuntimeEvidenceTab,
  missionId?: string | null
) {
  dispatchOfficeRuntimeEvidenceEvent(tab, missionId);
}

function renderDeliverableDockHint(
  locale: string,
  deliverableText: string,
  options?: {
    className?: string;
    fallback?: { zh: string; en: string };
    missionId?: string | null;
    onOpenRuntimeEvidence?: (
      tab: OfficeRuntimeEvidenceTab,
      missionId?: string | null
    ) => void;
  }
) {
  if (!deliverableText.trim()) return null;
  return (
    <button
      type="button"
      onClick={() =>
        options?.onOpenRuntimeEvidence?.("artifacts", options?.missionId ?? null)
      }
      className={
        options?.className ||
        "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-[10px] leading-5 text-white/55 transition-colors hover:bg-white/10"
      }
    >
      {t(
        locale,
        "交付内容已归口到首页共享运行证据容器。",
        "Deliverables now live in the shared Office home runtime evidence container."
      )}
      <span className="ml-1 text-white/40">
        {t(
          locale,
          options?.fallback?.zh ||
            "完整内容统一在首页共享运行证据容器的 Artifacts 查看。",
          options?.fallback?.en ||
            "Open the shared Office home runtime evidence Artifacts tab for the full handoff."
        )}
      </span>
    </button>
  );
}

function getTaskDetailBlocks(task: TaskInfo) {
  const blocks: Array<{ key: string; label: string; content: string | null }> =
    [
      {
        key: "manager_feedback",
        label: "Manager feedback",
        content: task.manager_feedback,
      },
      {
        key: "meta_audit_feedback",
        label: "Audit feedback",
        content: task.meta_audit_feedback,
      },
    ];

  return blocks.filter(
    block => block.content && block.content.trim().length > 0
  );
}

function getTaskRank(status: string) {
  const rank: Record<string, number> = {
    executing: 0,
    revising: 0,
    submitted: 1,
    reviewed: 2,
    audited: 2,
    assigned: 3,
    verified: 4,
    passed: 4,
    failed: 5,
  };

  return rank[status] ?? 6;
}

function getRoleSummaryStatus(tasks: TaskInfo[]): RoleProgressStatus {
  const statuses = tasks.map(task => task.status);

  if (statuses.some(status => status === "failed" || status === "revising")) {
    return "blocked";
  }
  if (statuses.some(status => status === "executing")) {
    return "active";
  }
  if (
    statuses.some(
      status =>
        status === "submitted" || status === "reviewed" || status === "audited"
    )
  ) {
    return "review";
  }
  if (statuses.every(status => status === "verified" || status === "passed")) {
    return "done";
  }

  return "idle";
}

function getRoleStatusLabel(locale: string, status: RoleProgressStatus) {
  switch (status) {
    case "blocked":
      return t(locale, "返工 / 阻塞", "Blocked / revising");
    case "active":
      return t(locale, "执行中", "In progress");
    case "review":
      return t(locale, "等待评审", "Awaiting review");
    case "done":
      return t(locale, "已完成", "Completed");
    default:
      return t(locale, "待命", "Idle");
  }
}

function getRoleStatusClass(status: RoleProgressStatus) {
  switch (status) {
    case "blocked":
      return "bg-amber-500/15 text-amber-300";
    case "active":
      return "bg-blue-500/15 text-blue-400";
    case "review":
      return "bg-violet-500/15 text-violet-400";
    case "done":
      return "bg-emerald-500/15 text-emerald-400";
    default:
      return "bg-white/10 text-slate-300";
  }
}

function getTaskCompletedCount(tasks: TaskInfo[]) {
  return tasks.filter(
    task => task.status === "verified" || task.status === "passed"
  ).length;
}

function getLatestRoleTimestamp(messages: MessageInfo[], roleId: string) {
  const related = messages
    .filter(
      message => message.from_agent === roleId || message.to_agent === roleId
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  return related[0]?.created_at || null;
}

function getLatestRoleMessages(
  messages: MessageInfo[],
  roleId: string,
  limit = 3
) {
  return messages
    .filter(
      message => message.from_agent === roleId || message.to_agent === roleId
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, limit);
}

function getMemoryTypeLabel(
  copy: ReturnType<typeof useI18n>["copy"],
  type: AgentMemoryEntry["type"]
) {
  return (
    copy.workflow.statuses.memoryType[
      type as keyof typeof copy.workflow.statuses.memoryType
    ] || type
  );
}

// ---------------------------------------------------------------------------
// WorkflowPanel TTS context — shared across all sub-views (Req 3.4)
// ---------------------------------------------------------------------------

import { createContext, useContext } from "react";

interface WorkflowTtsCtx {
  ttsEnabled: boolean;
  playingId: string | null;
  handleTtsPlay: (id: string, content: string) => void;
}

const WorkflowTtsContext = createContext<WorkflowTtsCtx>({
  ttsEnabled: false,
  playingId: null,
  handleTtsPlay: () => {},
});

/** Small play/stop button reused wherever agent reply content appears. */
function TtsPlayButton({ id, content }: { id: string; content: string }) {
  const { ttsEnabled, playingId, handleTtsPlay } =
    useContext(WorkflowTtsContext);
  if (!ttsEnabled) return null;
  const isPlaying = playingId === id;
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        handleTtsPlay(id, content);
      }}
      className={`relative ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all ${
        isPlaying
          ? "bg-[#D4845A] text-white"
          : "bg-white/10 text-white/50 hover:bg-white/20"
      }`}
      title={isPlaying ? "Stop" : "Play"}
    >
      {isPlaying ? (
        <Square className="h-2.5 w-2.5" />
      ) : (
        <Play className="h-2.5 w-2.5" />
      )}
      {isPlaying && (
        <span className="absolute inset-0 animate-ping rounded-full bg-[#D4845A] opacity-25" />
      )}
    </button>
  );
}

function DirectiveView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const { submitDirective, isSubmitting, submitError } = useWorkflowStore();
  const [directive, setDirective] = useState("");
  const [attachments, setAttachments] = useState<WorkflowInputAttachment[]>([]);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isFrontend = runtimeMode === "frontend";
  const canUpgrade = isFrontend && CAN_USE_ADVANCED_RUNTIME;
  const narrative = useMemo(() => getDirectiveNarrative(locale), [locale]);

  const handleSubmit = async () => {
    if (!directive.trim() || isSubmitting || isPreparingFiles) return;
    if (canUpgrade) {
      await setRuntimeMode("advanced");
      return;
    }
    const launchResult = await submitDirective({
      directive: directive.trim(),
      attachments,
    });
    if (launchResult?.workflowId) {
      setDirective("");
      setAttachments([]);
      setAttachmentError(null);
    }
  };

  const handlePickFiles = () => {
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(event.target.files || []);
    event.target.value = "";
    if (fileList.length === 0) return;

    setAttachmentError(null);
    setIsPreparingFiles(true);

    try {
      const prepared = await prepareWorkflowAttachments(fileList);
      let overflowed = false;
      setAttachments(prev => {
        const seen = new Set(
          prev.map(item => `${item.name}:${item.size}:${item.mimeType}`)
        );
        const next = [...prev];
        for (const item of prepared) {
          const key = `${item.name}:${item.size}:${item.mimeType}`;
          if (seen.has(key)) continue;
          if (next.length >= MAX_WORKFLOW_ATTACHMENTS) {
            overflowed = true;
            break;
          }
          next.push(item);
          seen.add(key);
        }
        return next;
      });

      if (overflowed) {
        setAttachmentError(
          t(
            locale,
            `最多附加 ${MAX_WORKFLOW_ATTACHMENTS} 个文件，其余文件已忽略。`,
            `You can attach up to ${MAX_WORKFLOW_ATTACHMENTS} files. Extra files were ignored.`
          )
        );
      }
    } catch (error) {
      console.error("[WorkflowPanel] Failed to prepare attachments:", error);
      setAttachmentError(
        t(
          locale,
          "文件读取失败，请重试或换用 txt / md / json / csv 等文本格式。",
          "Failed to read the selected files. Try again or use a text-based format such as txt, md, json, or csv."
        )
      );
    } finally {
      setIsPreparingFiles(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div className="flex h-full flex-col">
      <Section
        title={copy.workflow.directive.title}
        description={narrative.sectionDescription}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {submitError ? (
          <WorkflowErrorNotice
            error={submitError}
            onRetry={() => {
              void handleSubmit();
            }}
            className="mb-4"
          />
        ) : null}

        {isFrontend ? (
          <div className="mb-4 rounded-2xl glass-panel p-3 text-[11px] leading-5 text-white/60">
            <p className="font-bold text-white">
              {CAN_USE_ADVANCED_RUNTIME
                ? copy.workflow.directive.frontendTitle
                : copy.workflow.directive.pagesTitle}
            </p>
            <p className="mt-1">
              {CAN_USE_ADVANCED_RUNTIME
                ? copy.workflow.directive.frontendDescription
                : copy.workflow.directive.pagesDescription}
            </p>
            <p className="mt-2 rounded-xl bg-white/8 px-3 py-2 text-[10px] leading-5 text-white/60">
              {narrative.modeNote}
            </p>
          </div>
        ) : null}

        <p className="mb-2 text-[11px] font-semibold text-white/50">
          {copy.workflow.directive.examplesTitle}
        </p>
        <div className="space-y-2">
          {copy.workflow.directive.examples.map(example => (
            <button
              key={example}
              onClick={() => setDirective(example)}
              className="w-full rounded-xl bg-white/5 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/10"
            >
              {example}
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-2xl glass-panel p-3">
          <p className="mb-2 text-[11px] font-bold text-white">
            {narrative.stepsTitle}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {narrative.steps.map(([step, desc]) => (
              <div
                key={step}
                className="rounded-xl bg-white/8 px-3 py-2 text-[11px] text-white/80"
              >
                <p className="font-semibold text-[#D4845A]">{step}</p>
                <p className="mt-1">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 p-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={event => {
            void handleFilesSelected(event);
          }}
        />

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold text-white/50">
              {t(locale, "补充参考文件", "Add reference files")}
            </p>
            <p className="text-[10px] leading-5 text-white/40">
              {t(
                locale,
                "支持文字指令 + 附件一起提交。txt / md / json / PDF / Word / Excel / 图片都会尽量提取摘要，图片会尝试 OCR。",
                "You can submit text instructions together with attachments. txt / md / json / PDF / Word / Excel / images are parsed when possible, and images attempt OCR."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handlePickFiles}
            disabled={
              isPreparingFiles || attachments.length >= MAX_WORKFLOW_ATTACHMENTS
            }
            className="inline-flex items-center gap-2 rounded-xl glass-panel px-3 py-2 text-xs font-semibold text-white/60 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            {isPreparingFiles ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Paperclip className="h-3.5 w-3.5" />
            )}
            <span>{t(locale, "添加文件", "Add files")}</span>
          </button>
        </div>

        {attachments.length > 0 ? (
          <div className="mb-3 space-y-2 rounded-2xl glass-panel p-3">
            {attachments.map(attachment => (
              <div
                key={attachment.id}
                className="rounded-xl bg-white/8 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-white">
                      {attachment.name}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-white/50">
                      <span>{formatAttachmentSize(attachment.size)}</span>
                      <span>
                        {attachment.mimeType || "application/octet-stream"}
                      </span>
                      <span>
                        {attachment.excerptStatus === "metadata_only"
                          ? t(locale, "仅元数据", "Metadata only")
                          : attachment.excerptStatus === "truncated"
                            ? t(locale, "已截断摘要", "Excerpt truncated")
                            : t(locale, "已提取摘要", "Excerpt parsed")}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/60"
                    title={t(locale, "移除附件", "Remove attachment")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[10px] leading-5 text-white/60">
                  {attachment.excerpt}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {attachmentError ? (
          <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[10px] leading-5 text-amber-400">
            {attachmentError}
          </div>
        ) : null}

        <textarea
          value={directive}
          onChange={e => setDirective(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder={copy.workflow.directive.placeholder}
          rows={3}
          className="w-full resize-none rounded-xl glass-panel px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-cyan-400/50 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
        />
        <GlowButton
          onClick={() => void handleSubmit()}
          disabled={!directive.trim() || isSubmitting || isPreparingFiles}
          className="mt-2 w-full"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : canUpgrade ? (
            <Server className="h-4 w-4" />
          ) : isFrontend ? (
            <Monitor className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          <span>
            {isSubmitting
              ? copy.workflow.directive.submitting
              : canUpgrade
                ? copy.workflow.directive.switchCta
                : isFrontend
                  ? copy.workflow.directive.previewCta
                  : copy.workflow.directive.submit}
          </span>
        </GlowButton>
      </div>
    </div>
  );
}

function OrgView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const {
    agents,
    agentsError,
    agentStatuses,
    currentWorkflow,
    fetchAgents,
    setActiveView,
    setSelectedMemoryAgent,
  } = useWorkflowStore();
  const fmt = useFmt();
  const organization = getOrganization(currentWorkflow);
  const openMemory = (id: string) => {
    setSelectedMemoryAgent(id);
    setActiveView("memory");
  };

  if (organization) {
    const rootNode =
      organization.nodes.find(node => node.id === organization.rootNodeId) ||
      null;

    return (
      <div className="flex h-full flex-col">
        <Section
          title={copy.workflow.org.title}
          description={copy.workflow.org.description}
        />
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {agentsError ? (
            <WorkflowErrorNotice
              error={agentsError}
              onRetry={() => {
                void fetchAgents();
              }}
              className="mb-4"
            />
          ) : null}

          <div className="mb-4 rounded-2xl glass-panel border-indigo-400/20 bg-indigo-500/10 p-4">
            <div className="flex flex-wrap gap-2">
              <Pill>{organization.source}</Pill>
              <Pill>{organization.taskProfile}</Pill>
              <Pill>{fmt(organization.generatedAt)}</Pill>
              <Pill>
                {organization.nodes.length} {t(locale, "节点", "nodes")}
              </Pill>
              <Pill>
                {organization.departments.length}{" "}
                {t(locale, "部门", "departments")}
              </Pill>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-indigo-300">
              {organization.reasoning}
            </p>
            {currentWorkflow?.results?.organization_debug?.logPath ? (
              <p className="mt-2 text-[10px] text-indigo-400">
                {t(
                  locale,
                  "回放日志与执行证据已统一归口到首页共享运行证据容器，不再在这里直接暴露日志路径。",
                  "Replay logs and execution evidence now live in the shared Office home runtime evidence container, so the raw log path is no longer exposed here."
                )}
              </p>
            ) : null}
          </div>

          {rootNode ? (
            <button
              onClick={() => openMemory(rootNode.agentId)}
              className="mb-4 w-full rounded-2xl glass-panel border-amber-400/20 bg-amber-500/10 p-4 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-amber-300">
                  {rootNode.name}
                </span>
                <Pill>{rootNode.title}</Pill>
                <Pill>
                  {agentStatusLabel(
                    copy,
                    agentStatuses[rootNode.agentId] || "idle"
                  )}
                </Pill>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-amber-300">
                {rootNode.responsibility}
              </p>
            </button>
          ) : null}

          <div className="space-y-3">
            {organization.departments.map(department => {
              const manager =
                organization.nodes.find(
                  node => node.id === department.managerNodeId
                ) || null;
              const workers = organization.nodes.filter(
                node => node.parentId === department.managerNodeId
              );

              return (
                <div
                  key={department.id}
                  className="rounded-2xl glass-panel p-3"
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-white">
                      {department.label}
                    </span>
                    <Pill>{department.strategy}</Pill>
                    <Pill>
                      {t(locale, "并发", "concurrency")}{" "}
                      {department.maxConcurrency}
                    </Pill>
                  </div>

                  {manager ? (
                    <button
                      onClick={() => openMemory(manager.agentId)}
                      className="w-full rounded-xl bg-white/5 p-3 text-left hover:bg-white/10"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          {manager.name}
                        </span>
                        <Pill>{manager.title}</Pill>
                        <Pill>{manager.execution.strategy}</Pill>
                      </div>
                      <p className="mt-2 text-[10px] leading-5 text-white/60">
                        {manager.responsibility}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {manager.skills.map(skill => (
                          <Pill key={skill.id}>
                            {t(locale, "技能", "Skill")}: {skill.name}
                          </Pill>
                        ))}
                        {manager.mcp.map(binding => (
                          <Pill key={binding.id}>MCP: {binding.name}</Pill>
                        ))}
                      </div>
                    </button>
                  ) : null}

                  <div className="mt-3 space-y-2">
                    {workers.map(worker => (
                      <button
                        key={worker.id}
                        onClick={() => openMemory(worker.agentId)}
                        className="w-full rounded-xl glass-panel p-3 text-left hover:bg-white/5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12px] font-semibold text-white">
                            {worker.name}
                          </span>
                          <Pill>{worker.title}</Pill>
                          <Pill>{worker.execution.mode}</Pill>
                        </div>
                        <p className="mt-1 text-[10px] leading-5 text-white/60">
                          {worker.responsibility}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {worker.skills.map(skill => (
                            <Pill key={skill.id}>
                              {t(locale, "技能", "Skill")}: {skill.name}
                            </Pill>
                          ))}
                          {worker.mcp.map(binding => (
                            <Pill key={binding.id}>MCP: {binding.name}</Pill>
                          ))}
                        </div>
                        {worker.skills.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {worker.skills.map(skill => (
                              <SkillCard
                                key={skill.id}
                                skill={
                                  {
                                    id: skill.id,
                                    name: skill.name,
                                    summary: skill.summary || "",
                                    prompt: skill.prompt,
                                  } as SkillCardData
                                }
                              />
                            ))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const ceo = agents.find(a => a.role === "ceo");
  const managers = agents.filter(a => a.role === "manager");

  return (
    <div className="flex h-full flex-col">
      <Section
        title={copy.workflow.org.title}
        description={copy.workflow.org.description}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {agentsError ? (
          <WorkflowErrorNotice
            error={agentsError}
            onRetry={() => {
              void fetchAgents();
            }}
            className="mb-4"
          />
        ) : null}

        {ceo ? (
          <button
            onClick={() => openMemory(ceo.id)}
            className="mb-4 flex w-full items-center gap-3 rounded-2xl glass-panel border-amber-400/20 bg-amber-500/10 px-3 py-3 text-left"
          >
            <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-amber-300">
                {ceo.name}
              </p>
              <p className="text-[10px] text-amber-400">
                {agentStatusLabel(copy, agentStatuses[ceo.id] || "idle")}
              </p>
            </div>
          </button>
        ) : null}

        <div className="space-y-3">
          {managers.map(manager => {
            const dept =
              copy.workflow.departments[
                manager.department as keyof typeof copy.workflow.departments
              ] || manager.department;
            const workers = agents.filter(
              agent => agent.managerId === manager.id && agent.role === "worker"
            );
            return (
              <div key={manager.id} className="rounded-2xl glass-panel p-3">
                <button
                  onClick={() => openMemory(manager.id)}
                  className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-[11px] font-bold text-white/50">
                    {dept.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-white">
                      {dept}
                    </p>
                    <p className="truncate text-[10px] text-white/50">
                      {manager.name}
                    </p>
                  </div>
                  <span className="text-[10px] text-white/50">
                    {copy.workflow.org.viewMemory}
                  </span>
                </button>
                <div className="mt-2 space-y-2">
                  {workers.map(worker => (
                    <button
                      key={worker.id}
                      onClick={() => openMemory(worker.id)}
                      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-white/5"
                    >
                      <div className="h-2 w-2 rounded-full bg-[#D4845A]" />
                      <span className="flex-1 truncate text-[11px] text-white/80">
                        {worker.name}
                      </span>
                      <span className="text-[10px] text-white/40">
                        {agentStatusLabel(
                          copy,
                          agentStatuses[worker.id] || "idle"
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProgressViewLegacy() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const fmt = useFmt();
  const {
    currentWorkflow,
    tasks,
    messages,
    stages,
    downloadWorkflowReport,
    downloadDepartmentReport,
  } = useWorkflowStore();
  const organization = getOrganization(currentWorkflow);
  const attachments = useMemo(
    () =>
      normalizeWorkflowAttachments(
        currentWorkflow?.results?.input?.attachments
      ),
    [currentWorkflow]
  );
  const nodeMap = useMemo(() => getNodeMap(organization), [organization]);
  const grouped = Object.entries(
    tasks.reduce<Record<string, TaskInfo[]>>((acc, task) => {
      (acc[task.department] ||= []).push(task);
      return acc;
    }, {})
  );
  const [exportOpen, setExportOpen] = useState(false);
  const canExport =
    currentWorkflow?.status === "completed" ||
    currentWorkflow?.status === "completed_with_errors";

  if (!currentWorkflow) {
    return (
      <EmptyState
        title={copy.workflow.progress.emptyTitle}
        description={copy.workflow.progress.emptyDescription}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Section title={copy.workflow.progress.overview} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="rounded-2xl glass-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">
                {currentWorkflow.directive}
              </p>
              <p className="mt-2 text-[11px] text-white/50">
                {copy.workflow.progress.startedAt}:{" "}
                {fmt(currentWorkflow.started_at || currentWorkflow.created_at)}
              </p>
              <p className="mt-1 text-[11px] text-white/50">
                {copy.workflow.progress.currentStage}:{" "}
                {getDynamicStageLabel(
                  locale,
                  currentWorkflow.current_stage || "direction",
                  copy.workflow.stages[
                    (currentWorkflow.current_stage ||
                      "direction") as keyof typeof copy.workflow.stages
                  ] ||
                    currentWorkflow.current_stage ||
                    copy.common.unavailable
                )}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[10px] font-semibold ${wfBadge[currentWorkflow.status] || wfBadge.pending}`}
            >
              {copy.workflow.statuses.workflow[
                currentWorkflow.status as keyof typeof copy.workflow.statuses.workflow
              ] || currentWorkflow.status}
            </span>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold text-white/50">
              {copy.workflow.progress.stageProgress}
            </p>
            <StageBar stages={stages} current={currentWorkflow.current_stage} />
          </div>
          {attachments.length > 0 ? (
            <div className="mt-4 rounded-2xl glass-panel p-3">
              <p className="text-[11px] font-semibold text-white/50">
                {t(locale, "参考文件", "Reference files")} ·{" "}
                {attachments.length}
              </p>
              <div className="mt-2 space-y-2">
                {attachments.map(attachment => (
                  <div
                    key={attachment.id}
                    className="rounded-xl bg-white/5 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-white">
                        {attachment.name}
                      </p>
                      <div className="flex flex-wrap gap-2 text-[9px] text-white/50">
                        <Pill>{formatAttachmentSize(attachment.size)}</Pill>
                        <Pill>
                          {getAttachmentStatusLabel(locale, attachment)}
                        </Pill>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[10px] leading-5 text-white/60">
                      {attachment.excerpt}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {organization ? (
            <div className="mt-4 rounded-2xl border border-indigo-400/20 bg-indigo-500/10 p-3">
              <div className="flex flex-wrap gap-2">
                <Pill>{organization.source}</Pill>
                <Pill>{organization.taskProfile}</Pill>
                <Pill>
                  {organization.nodes.length} {t(locale, "节点", "nodes")}
                </Pill>
                <Pill>
                  {organization.departments.length}{" "}
                  {t(locale, "部门", "departments")}
                </Pill>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-indigo-300">
                {organization.reasoning}
              </p>
            </div>
          ) : null}
          {currentWorkflow.status === "failed" ? (
            <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-[11px] text-red-400">
              {currentWorkflow.results?.last_error || copy.common.unavailable}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() =>
                void downloadWorkflowReport(currentWorkflow.id, "json")
              }
              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/60"
            >
              <Download className="h-3.5 w-3.5" />
              {copy.workflow.progress.workflowReport} · {copy.common.json}
            </button>
            <button
              onClick={() =>
                void downloadWorkflowReport(currentWorkflow.id, "md")
              }
              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/60"
            >
              <Download className="h-3.5 w-3.5" />
              {copy.workflow.progress.workflowReport} · {copy.common.markdown}
            </button>
            {canExport ? (
              <button
                onClick={() => setExportOpen(true)}
                className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/60"
              >
                <Download className="h-3.5 w-3.5" />
                {t(locale, "导出到其他框架", "Export to Other Frameworks")}
              </button>
            ) : null}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold text-white/50">
            {copy.workflow.progress.tasks}
          </p>
          {grouped.length === 0 ? (
            <div className="rounded-2xl bg-white/5 px-4 py-6 text-center text-[11px] text-white/50">
              {copy.workflow.progress.noTasks}
            </div>
          ) : (
            <div className="space-y-3">
              {grouped.map(([department, items]) => (
                <div key={department} className="rounded-2xl glass-panel p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-white">
                      {copy.workflow.departments[
                        department as keyof typeof copy.workflow.departments
                      ] || department}
                    </h4>
                    {items[0]?.manager_id ? (
                      <button
                        onClick={() =>
                          void downloadDepartmentReport(
                            currentWorkflow.id,
                            items[0].manager_id,
                            "md"
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/60"
                      >
                        <Download className="h-3 w-3" />
                        {copy.workflow.progress.departmentReport}
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {items.map(task => (
                      <div key={task.id} className="rounded-xl bg-white/5 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {taskStatusIcon(task.status)}
                              <p className="flex-1 text-[12px] font-medium text-white">
                                {task.description}
                              </p>
                            </div>
                            <p className="mt-1 text-[10px] text-white/50">
                              {t(locale, "执行者", "Worker")}:{" "}
                              {getNodeName(task.worker_id, nodeMap)}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${taskBadge[task.status] || taskBadge.assigned}`}
                          >
                            {copy.workflow.statuses.task[
                              task.status as keyof typeof copy.workflow.statuses.task
                            ] || task.status}
                          </span>
                        </div>
                        {renderDeliverableDockHint(
                          locale,
                          getTaskPrimaryText(task),
                          {
                            missionId: currentWorkflow?.missionId ?? null,
                            onOpenRuntimeEvidence:
                              dispatchOfficeRuntimeEvidence,
                          }
                        )}
                        {task.total_score !== null ? (
                          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-white/50">
                            <Pill>
                              {copy.workflow.progress.score}: {task.total_score}
                              /20
                            </Pill>
                            <Pill>
                              {t(locale, "版本", "Version")} {task.version}
                            </Pill>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold text-white/50">
            {copy.workflow.progress.messageFlow}
          </p>
          {messages.length === 0 ? (
            <div className="rounded-2xl bg-white/5 px-4 py-6 text-center text-[11px] text-white/50">
              {copy.workflow.progress.noMessages}
            </div>
          ) : (
            <div className="space-y-2">
              {messages.slice(-10).map(message => (
                <div key={message.id} className="rounded-xl glass-panel p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/50">
                    <span>
                      {getNodeName(message.from_agent, nodeMap)} →{" "}
                      {getNodeName(message.to_agent, nodeMap)}
                    </span>
                    <span>{fmt(message.created_at)}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-white/40">
                    {getDynamicStageLabel(
                      locale,
                      message.stage,
                      copy.workflow.stages[
                        message.stage as keyof typeof copy.workflow.stages
                      ] || message.stage
                    )}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-white/80">
                    {message.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {canExport ? (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          workflowId={currentWorkflow.id}
        />
      ) : null}
    </div>
  );
}

function RoleSwitchTimeline() {
  const locale = useAppStore(state => state.locale);
  const agentRoles = useRoleStore(state => state.agentRoles);
  const fmt = useFmt();

  const allSwitches = Array.from(agentRoles.entries())
    .flatMap(([agentId, info]) =>
      info.roleHistory.map(entry => ({ agentId, ...entry }))
    )
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    .slice(0, 20);

  if (allSwitches.length === 0) return null;

  return (
    <div className="rounded-2xl glass-panel p-3">
      <div className="mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-white/40" />
        <div>
          <p className="text-sm font-semibold text-white">
            {t(locale, "角色切换时间线", "Role Switch Timeline")}
          </p>
          <p className="text-[10px] leading-5 text-white/50">
            {t(
              locale,
              "每个 Agent 的角色切换事件，不同角色用不同颜色标注。",
              "Role switch events per agent, color-coded by role."
            )}
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        {allSwitches.map((entry, i) => (
          <div
            key={`${entry.agentId}-${entry.timestamp}-${i}`}
            className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: getRoleColor(entry.toRole) }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                <span className="font-semibold text-white">
                  {entry.agentId}
                </span>
                <span className="text-white/50">:</span>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                  style={{ backgroundColor: getRoleColor(entry.fromRole) }}
                >
                  {entry.fromRole || t(locale, "无", "—")}
                </span>
                <span className="text-white/40">→</span>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                  style={{ backgroundColor: getRoleColor(entry.toRole) }}
                >
                  {entry.toRole || t(locale, "无", "—")}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-2 text-[9px] text-white/50">
                {entry.missionName ? <span>{entry.missionName}</span> : null}
                <span>{fmt(entry.timestamp)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Autonomy decision badge colors
// ---------------------------------------------------------------------------

const decisionBadge: Record<string, string> = {
  ACCEPT: "bg-emerald-500/15 text-emerald-400",
  ACCEPT_WITH_CAVEAT: "bg-amber-500/15 text-amber-400",
  REQUEST_ASSIST: "bg-blue-500/15 text-blue-400",
  REJECT_AND_REFER: "bg-red-500/15 text-red-400",
};

const competitionStatusBadge: Record<string, string> = {
  preparing: "bg-white/10 text-white/60",
  running: "bg-blue-500/15 text-blue-400",
  judging: "bg-violet-500/15 text-violet-400",
  completed: "bg-emerald-500/15 text-emerald-400",
  degraded: "bg-amber-500/15 text-amber-400",
};

const taskforceStatusBadge: Record<string, string> = {
  recruiting: "bg-blue-500/15 text-blue-400",
  active: "bg-emerald-500/15 text-emerald-400",
  merging: "bg-violet-500/15 text-violet-400",
  dissolved: "bg-white/10 text-white/60",
};

// ---------------------------------------------------------------------------
// Autonomy Panels
// ---------------------------------------------------------------------------

function ScoreBar({ value, color }: { value: number; color: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-white/10">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-[9px] tabular-nums text-white/60 font-data">
        {pct}%
      </span>
    </div>
  );
}

function CollapsiblePanel({
  title,
  count,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl glass-panel p-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-[10px] text-white/50">{count} items</p>
          </div>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-white/40" />
        ) : (
          <ChevronRight className="h-4 w-4 text-white/40" />
        )}
      </button>
      {open ? <div className="mt-3 space-y-2">{children}</div> : null}
    </div>
  );
}

function AgentAssessmentPanel() {
  const locale = useAppStore(state => state.locale);
  const assessments = useAutonomyStore(state => state.assessments);
  const [open, setOpen] = useState(false);

  if (assessments.length === 0) return null;

  // Group by taskId to show allocation process per task
  const grouped = assessments.reduce<Record<string, AssessmentResult[]>>(
    (acc, a) => {
      (acc[a.taskId] ||= []).push(a);
      return acc;
    },
    {}
  );

  return (
    <CollapsiblePanel
      title={t(locale, "Agent 评估分配", "Agent Assessment")}
      count={assessments.length}
      icon={<Brain className="h-4 w-4 text-white/40" />}
      open={open}
      onToggle={() => setOpen(prev => !prev)}
    >
      {Object.entries(grouped).map(([taskId, results]) => {
        const sorted = [...results].sort(
          (a, b) => b.fitnessScore - a.fitnessScore
        );
        const best = sorted[0];
        return (
          <div key={taskId} className="rounded-xl glass-panel p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-white">
                {t(locale, "任务", "Task")}: {taskId.slice(0, 12)}
              </p>
              <div className="flex items-center gap-1.5">
                {best ? (
                  <Pill>
                    {t(locale, "分配给", "Assigned to")}{" "}
                    {best.agentId.slice(0, 10)}
                  </Pill>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("autonomy:intervene", {
                        detail: { type: "assessment", taskId },
                      })
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[9px] font-medium text-white/60 transition-colors hover:border-[#D4845A] hover:text-[#D4845A]"
                >
                  <Hand className="h-3 w-3" />
                  {t(locale, "介入", "Intervene")}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              {sorted.map(result => (
                <div
                  key={result.agentId}
                  className="rounded-lg bg-white/5 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-white">
                      {result.agentId.slice(0, 14)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${decisionBadge[result.decision] || "bg-white/10 text-white/60"}`}
                    >
                      {result.decision.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <ScoreBar
                      value={result.fitnessScore}
                      color="bg-[#D4845A]"
                    />
                  </div>
                  {result.reason ? (
                    <p className="mt-1 text-[9px] leading-4 text-white/50">
                      {result.reason}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </CollapsiblePanel>
  );
}

function CompetitionResultsPanel() {
  const locale = useAppStore(state => state.locale);
  const competitions = useAutonomyStore(state => state.competitions);
  const [open, setOpen] = useState(false);

  if (competitions.length === 0) return null;

  return (
    <CollapsiblePanel
      title={t(locale, "竞争执行结果", "Competition Results")}
      count={competitions.length}
      icon={<Star className="h-4 w-4 text-white/40" />}
      open={open}
      onToggle={() => setOpen(prev => !prev)}
    >
      {competitions.map(session => (
        <div key={session.id} className="rounded-xl glass-panel p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-white">
              {t(locale, "任务", "Task")}: {session.taskId.slice(0, 12)}
            </p>
            <div className="flex items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${competitionStatusBadge[session.status] || "bg-white/10 text-white/60"}`}
              >
                {session.status}
              </span>
              {session.status === "completed" ? (
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("autonomy:intervene", {
                        detail: { type: "competition", sessionId: session.id },
                      })
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[9px] font-medium text-white/60 transition-colors hover:border-[#D4845A] hover:text-[#D4845A]"
                >
                  <Hand className="h-3 w-3" />
                  {t(locale, "介入", "Intervene")}
                </button>
              ) : null}
            </div>
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {session.contestants.map(c => (
              <Pill key={c.agentId}>
                {c.agentId.slice(0, 10)}
                {c.isExternal ? " (ext)" : ""}
                {c.timedOut ? " ⏱" : ""}
              </Pill>
            ))}
          </div>

          {session.judgingResult ? (
            <>
              <div className="overflow-x-auto rounded-lg glass-panel">
                <table className="w-full text-[9px]">
                  <thead>
                    <tr className="bg-white/5 text-white/50">
                      <th className="px-2 py-1.5 text-left font-semibold">
                        Agent
                      </th>
                      <th className="px-2 py-1.5 text-right font-semibold">
                        Corr
                      </th>
                      <th className="px-2 py-1.5 text-right font-semibold">
                        Qual
                      </th>
                      <th className="px-2 py-1.5 text-right font-semibold">
                        Eff
                      </th>
                      <th className="px-2 py-1.5 text-right font-semibold">
                        Nov
                      </th>
                      <th className="px-2 py-1.5 text-right font-semibold">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.judgingResult.scores
                      .slice()
                      .sort(
                        (a: JudgingScore, b: JudgingScore) =>
                          b.totalWeighted - a.totalWeighted
                      )
                      .map((score: JudgingScore) => {
                        const isWinner =
                          score.agentId === session.judgingResult!.winnerId;
                        return (
                          <tr
                            key={score.agentId}
                            className={isWinner ? "bg-emerald-500/10" : ""}
                          >
                            <td className="px-2 py-1.5 text-left font-medium text-white">
                              {isWinner ? "🏆 " : ""}
                              {score.agentId.slice(0, 10)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-white/80 font-data">
                              {(score.correctness * 100).toFixed(0)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-white/80 font-data">
                              {(score.quality * 100).toFixed(0)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-white/80 font-data">
                              {(score.efficiency * 100).toFixed(0)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-white/80 font-data">
                              {(score.novelty * 100).toFixed(0)}
                            </td>
                            <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-white font-data">
                              {(score.totalWeighted * 100).toFixed(0)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              {session.judgingResult.mergeRequired ? (
                <div className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[9px] font-medium text-amber-400">
                  {t(
                    locale,
                    "⚠ 分差 < 5%，需要合并方案",
                    "⚠ Score gap < 5%, merge required"
                  )}
                </div>
              ) : null}
              {session.judgingResult.rationaleText ? (
                <p className="mt-2 text-[9px] leading-4 text-white/50">
                  {session.judgingResult.rationaleText}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
    </CollapsiblePanel>
  );
}

function TaskforcePanel() {
  const locale = useAppStore(state => state.locale);
  const taskforces = useAutonomyStore(state => state.taskforces);
  const [open, setOpen] = useState(false);

  if (taskforces.length === 0) return null;

  const roleLabel = (role: string) => {
    switch (role) {
      case "lead":
        return t(locale, "领导", "Lead");
      case "worker":
        return t(locale, "执行", "Worker");
      case "reviewer":
        return t(locale, "审查", "Reviewer");
      default:
        return role;
    }
  };

  return (
    <CollapsiblePanel
      title={t(locale, "临时工作组", "Taskforce")}
      count={taskforces.length}
      icon={<Network className="h-4 w-4 text-white/40" />}
      open={open}
      onToggle={() => setOpen(prev => !prev)}
    >
      {taskforces.map(tf => (
        <div key={tf.taskforceId} className="rounded-xl glass-panel p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-white">
              {tf.taskforceId.slice(0, 14)}
            </p>
            <div className="flex items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${taskforceStatusBadge[tf.status] || "bg-white/10 text-white/60"}`}
              >
                {tf.status}
              </span>
              {tf.status !== "dissolved" ? (
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("autonomy:intervene", {
                        detail: {
                          type: "taskforce",
                          taskforceId: tf.taskforceId,
                        },
                      })
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[9px] font-medium text-white/60 transition-colors hover:border-[#D4845A] hover:text-[#D4845A]"
                >
                  <Hand className="h-3 w-3" />
                  {t(locale, "介入", "Intervene")}
                </button>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            {tf.members.map(member => {
              const isLead = member.agentId === tf.leadAgentId;
              return (
                <div
                  key={member.agentId}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 ${isLead ? "glass-panel border-amber-400/20 bg-amber-500/10" : "glass-panel"}`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${member.online ? "bg-emerald-500" : "bg-white/20"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-white">
                        {isLead ? "★" : ""}
                        {member.agentId.slice(0, 14)}
                      </span>
                      <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[8px] font-medium text-white/60">
                        {roleLabel(member.role)}
                      </span>
                    </div>
                  </div>
                  <span className="text-[8px] text-white/40">
                    {member.online
                      ? t(locale, "在线", "Online")
                      : t(locale, "离线", "Offline")}
                  </span>
                </div>
              );
            })}
          </div>

          {tf.subTasks.length > 0 ? (
            <div className="mt-2 rounded-lg bg-white/5 px-2.5 py-2">
              <p className="text-[9px] font-semibold text-white/50">
                {t(locale, "子任务", "Sub-tasks")} ·{" "}
                {tf.subTasks.filter(s => s.status === "done").length}/
                {tf.subTasks.length}
              </p>
            </div>
          ) : null}
        </div>
      ))}
    </CollapsiblePanel>
  );
}

function ProgressView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const fmt = useFmt();
  const {
    currentWorkflow,
    currentWorkflowId,
    tasks,
    messages,
    stages,
    workflowDetailError,
    downloadWorkflowReport,
    downloadDepartmentReport,
    fetchWorkflowDetail,
    fetchWorkflows,
  } = useWorkflowStore();
  const workflowMissionDetail = useTasksStore(state => {
    const missionId = currentWorkflow?.missionId;
    return missionId ? (state.detailsById[missionId] ?? null) : null;
  });
  const [expandedRoleKeys, setExpandedRoleKeys] = useState<string[]>([]);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const organization = getOrganization(currentWorkflow);
  const canExport =
    currentWorkflow?.status === "completed" ||
    currentWorkflow?.status === "completed_with_errors";
  const attachments = useMemo(
    () =>
      normalizeWorkflowAttachments(
        currentWorkflow?.results?.input?.attachments
      ),
    [currentWorkflow]
  );
  const nodeMap = useMemo(() => getNodeMap(organization), [organization]);

  useEffect(() => {
    setExpandedRoleKeys([]);
    setShowAllEvents(false);
    setIsContextOpen(false);
  }, [currentWorkflow?.id]);

  useEffect(() => {
    const missionId = currentWorkflow?.missionId;
    if (!missionId || workflowMissionDetail) {
      return;
    }

    void useTasksStore.getState().refresh({
      preferredTaskId: missionId,
    });
  }, [currentWorkflow?.missionId, workflowMissionDetail]);

  const progressState = useMemo(() => {
    const groupedByDepartment = Object.entries(
      tasks.reduce<Record<string, TaskInfo[]>>((acc, task) => {
        (acc[task.department] ||= []).push(task);
        return acc;
      }, {})
    );

    const departmentSummaries = groupedByDepartment
      .map(([department, items]) => {
        const managerId = items[0]?.manager_id || "";

        const buildRoleSummary = (
          roleId: string,
          roleKind: "manager" | "worker",
          roleTasks: TaskInfo[]
        ) => {
          const sortedTasks = [...roleTasks].sort(
            (a, b) =>
              getTaskRank(a.status) - getTaskRank(b.status) || a.id - b.id
          );
          const focusTask = sortedTasks[0];
          const summarySource =
            focusTask.manager_feedback || focusTask.meta_audit_feedback;
          const summaryFallback = getTaskPrimaryText(focusTask)
            ? t(
                locale,
                "交付内容已归口到首页共享运行证据容器。",
                "Deliverables now live in the shared Office home runtime evidence container."
              )
            : t(locale, "暂无结果摘要", "No summary yet");

          return {
            key: `${roleKind}:${roleId}`,
            id: roleId,
            roleKind,
            name: getNodeName(roleId, nodeMap, roleId),
            status: getRoleSummaryStatus(sortedTasks),
            currentTask: summarizeText(
              focusTask?.description,
              t(locale, "等待分配任务", "Waiting for assignment"),
              52
            ),
            summary: summarizeText(
              summarySource,
              summaryFallback,
              78
            ),
            updatedAt:
              getLatestRoleTimestamp(messages, roleId) ||
              currentWorkflow?.started_at ||
              currentWorkflow?.created_at ||
              null,
            tasks: sortedTasks,
            messages: getLatestRoleMessages(messages, roleId, 3),
          };
        };

        const workerSummaries = Object.entries(
          items.reduce<Record<string, TaskInfo[]>>((acc, task) => {
            (acc[task.worker_id] ||= []).push(task);
            return acc;
          }, {})
        )
          .map(([workerId, workerTasks]) =>
            buildRoleSummary(workerId, "worker", workerTasks)
          )
          .sort(
            (a, b) =>
              getTaskRank(a.tasks[0]?.status || "") -
              getTaskRank(b.tasks[0]?.status || "")
          );

        const managerSummary = managerId
          ? buildRoleSummary(managerId, "manager", items)
          : null;

        return {
          department,
          managerId,
          completedTasks: getTaskCompletedCount(items),
          totalTasks: items.length,
          roles: managerSummary
            ? [managerSummary, ...workerSummaries]
            : workerSummaries,
        };
      })
      .sort((a, b) => {
        const aPriority = a.roles.some(role => role.status === "blocked")
          ? 0
          : a.roles.some(role => role.status === "active")
            ? 1
            : 2;
        const bPriority = b.roles.some(role => role.status === "blocked")
          ? 0
          : b.roles.some(role => role.status === "active")
            ? 1
            : 2;

        return (
          aPriority - bPriority ||
          a.department.localeCompare(b.department, locale)
        );
      });

    const roleSummaries = departmentSummaries.flatMap(item => item.roles);

    return {
      departmentSummaries,
      roleSummaries,
      completedTasks: getTaskCompletedCount(tasks),
      blockedRoles: roleSummaries.filter(role => role.status === "blocked"),
      activeRoles: roleSummaries.filter(role => role.status === "active"),
      reviewRoles: roleSummaries.filter(role => role.status === "review"),
      queuedTasks: tasks.filter(task => task.status === "assigned").length,
      keyEvents: [...messages].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    };
  }, [
    currentWorkflow?.created_at,
    currentWorkflow?.started_at,
    locale,
    messages,
    nodeMap,
    tasks,
  ]);

  if (!currentWorkflow) {
    return (
      <div className="flex h-full flex-col">
        <Section
          title={copy.workflow.progress.overview}
          description={t(
            locale,
            "先看整体进度，再展开角色摘要与关键事件。",
            "Start with the overall progress, then expand role summaries and key events."
          )}
        />
        <div className="flex flex-1 flex-col px-4 py-3">
          {workflowDetailError ? (
            <WorkflowErrorNotice
              error={workflowDetailError}
              onRetry={() => {
                if (currentWorkflowId) {
                  void fetchWorkflowDetail(currentWorkflowId);
                  return;
                }
                void fetchWorkflows();
              }}
              className="mb-3"
            />
          ) : null}
          <EmptyState
            title={copy.workflow.progress.emptyTitle}
            description={copy.workflow.progress.emptyDescription}
          />
        </div>
      </div>
    );
  }

  const currentStageLabel = getDynamicStageLabel(
    locale,
    currentWorkflow.current_stage || "direction",
    copy.workflow.stages[
      (currentWorkflow.current_stage ||
        "direction") as keyof typeof copy.workflow.stages
    ] ||
      currentWorkflow.current_stage ||
      copy.common.unavailable
  );
  const activeRoleNames =
    progressState.activeRoles.length > 0
      ? progressState.activeRoles
          .slice(0, 2)
          .map(role => role.name)
          .join(" / ")
      : t(locale, "当前无活跃角色", "No active roles right now");
  const blockerSummary =
    progressState.blockedRoles.length > 0
      ? t(
          locale,
          `${progressState.blockedRoles.length} 个角色返工或阻塞`,
          `${progressState.blockedRoles.length} roles are blocked or revising`
        )
      : progressState.reviewRoles.length > 0
        ? t(
            locale,
            `${progressState.reviewRoles.length} 个角色等待评审`,
            `${progressState.reviewRoles.length} roles are awaiting review`
          )
        : progressState.queuedTasks > 0
          ? t(
              locale,
              `${progressState.queuedTasks} 个任务排队中`,
              `${progressState.queuedTasks} tasks are queued`
            )
          : t(locale, "当前无明显阻塞", "No obvious blockers");
  const visibleEvents = showAllEvents
    ? progressState.keyEvents.slice(0, 10)
    : progressState.keyEvents.slice(0, 3);

  const toggleRole = (key: string) => {
    setExpandedRoleKeys(prev =>
      prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]
    );
  };

  return (
    <div className="flex h-full flex-col">
      <Section
        title={copy.workflow.progress.overview}
        description={t(
          locale,
          "默认先看总进度，再看角色摘要；完整交付、反馈和消息都收进展开层。",
          "Start with the overall progress, then scan role summaries. Full details only open on demand."
        )}
      />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {workflowDetailError ? (
          <WorkflowErrorNotice
            error={workflowDetailError}
            onRetry={() => {
              void fetchWorkflowDetail(currentWorkflow.id);
            }}
          />
        ) : null}

        <div className="rounded-2xl glass-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                {t(locale, "当前执行", "Current run")}
              </p>
              <p className="mt-1 text-sm font-semibold leading-6 text-white">
                {summarizeText(
                  currentWorkflow.directive,
                  copy.common.unavailable,
                  120
                )}
              </p>
              <p className="mt-2 text-[11px] text-white/50">
                {copy.workflow.progress.startedAt}:{" "}
                {fmt(currentWorkflow.started_at || currentWorkflow.created_at)}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[10px] font-semibold ${wfBadge[currentWorkflow.status] || wfBadge.pending}`}
            >
              {copy.workflow.statuses.workflow[
                currentWorkflow.status as keyof typeof copy.workflow.statuses.workflow
              ] || currentWorkflow.status}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl glass-panel p-3">
              <div className="flex items-center gap-2 text-white/50">
                <BarChart3 className="h-3.5 w-3.5" />
                <p className="text-[10px] font-semibold">
                  {t(locale, "当前阶段", "Current stage")}
                </p>
              </div>
              <p className="mt-2 text-[13px] font-semibold text-white">
                {currentStageLabel}
              </p>
            </div>
            <div className="rounded-2xl glass-panel p-3">
              <div className="flex items-center gap-2 text-white/50">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <p className="text-[10px] font-semibold">
                  {t(locale, "总体进度", "Overall progress")}
                </p>
              </div>
              <p className="mt-2 text-[13px] font-semibold text-white">
                {progressState.completedTasks} / {tasks.length || 0}{" "}
                {t(locale, "任务完成", "tasks completed")}
              </p>
            </div>
            <div className="rounded-2xl glass-panel p-3">
              <div className="flex items-center gap-2 text-white/50">
                <Zap className="h-3.5 w-3.5" />
                <p className="text-[10px] font-semibold">
                  {t(locale, "当前活跃角色", "Active roles")}
                </p>
              </div>
              <p className="mt-2 text-[13px] font-semibold text-white">
                {progressState.activeRoles.length}
              </p>
              <p className="mt-1 text-[10px] leading-5 text-white/50">
                {activeRoleNames}
              </p>
            </div>
            <div className="rounded-2xl glass-panel p-3">
              <div className="flex items-center gap-2 text-white/50">
                <AlertTriangle className="h-3.5 w-3.5" />
                <p className="text-[10px] font-semibold">
                  {t(locale, "阻塞与等待", "Blockers")}
                </p>
              </div>
              <p className="mt-2 text-[13px] font-semibold text-white">
                {progressState.blockedRoles.length}
              </p>
              <p className="mt-1 text-[10px] leading-5 text-white/50">
                {blockerSummary}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-white/50">
                {copy.workflow.progress.stageProgress}
              </p>
              <span className="text-[10px] text-white/40">
                {progressState.roleSummaries.length}{" "}
                {t(locale, "个角色摘要", "role summaries")}
              </span>
            </div>
            <StageBar stages={stages} current={currentWorkflow.current_stage} />
          </div>

          {currentWorkflow.status === "failed" ? (
            <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-[11px] text-red-400">
              {currentWorkflow.results?.last_error || copy.common.unavailable}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() =>
                void downloadWorkflowReport(currentWorkflow.id, "json")
              }
              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/60"
            >
              <Download className="h-3.5 w-3.5" />
              {copy.workflow.progress.workflowReport} · {copy.common.json}
            </button>
            <button
              onClick={() =>
                void downloadWorkflowReport(currentWorkflow.id, "md")
              }
              className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/60"
            >
              <Download className="h-3.5 w-3.5" />
              {copy.workflow.progress.workflowReport} · {copy.common.markdown}
            </button>
            {canExport ? (
              <button
                onClick={() => setExportOpen(true)}
                className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/60"
              >
                <Download className="h-3.5 w-3.5" />
                {t(locale, "导出到其他框架", "Export to Other Frameworks")}
              </button>
            ) : null}
          </div>
          {workflowMissionDetail?.artifacts?.length ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[11px] leading-5 text-white/55">
              {t(
                locale,
                `当前任务已有 ${workflowMissionDetail.artifacts.length} 个交付物，首页主入口已统一收敛到共享运行证据容器的 Artifacts。`,
                `${workflowMissionDetail.artifacts.length} deliverables are already attached to this mission. Their primary home on Office home is now the shared runtime evidence Artifacts tab.`
              )}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl glass-panel p-3">
          <div className="mb-3">
            <p className="text-sm font-semibold text-white">
              {t(locale, "角色执行摘要", "Role execution summary")}
            </p>
            <p className="text-[10px] leading-5 text-white/50">
              {t(
                locale,
                "每个角色默认只显示一行摘要；展开后继续查看反馈和相关事件，完整交付统一回到首页共享运行证据容器。",
                "Each role stays compact by default. Expand one for feedback and related events while full deliverables stay in the shared Office home runtime evidence container."
              )}
            </p>
          </div>

          {progressState.departmentSummaries.length === 0 ? (
            <div className="rounded-2xl bg-white/5 px-4 py-6 text-center text-[11px] text-white/50">
              {copy.workflow.progress.noTasks}
            </div>
          ) : (
            <div className="space-y-3">
              {progressState.departmentSummaries.map(group => (
                <div
                  key={group.department}
                  className="rounded-2xl glass-panel p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {copy.workflow.departments[
                          group.department as keyof typeof copy.workflow.departments
                        ] || group.department}
                      </p>
                      <p className="text-[10px] text-white/50">
                        {group.completedTasks} / {group.totalTasks}{" "}
                        {t(locale, "任务完成", "tasks completed")}
                      </p>
                    </div>
                    {group.managerId ? (
                      <button
                        onClick={() =>
                          void downloadDepartmentReport(
                            currentWorkflow.id,
                            group.managerId,
                            "md"
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/60"
                      >
                        <Download className="h-3 w-3" />
                        {copy.workflow.progress.departmentReport}
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-2">
                    {group.roles.map(role => {
                      const isExpanded = expandedRoleKeys.includes(role.key);
                      return (
                        <div key={role.key} className="rounded-xl glass-panel">
                          <button
                            type="button"
                            onClick={() => toggleRole(role.key)}
                            className="flex w-full items-start gap-3 px-3 py-3 text-left"
                          >
                            <div className="mt-0.5">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-white/40" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-white/40" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[12px] font-semibold text-white">
                                  {role.name}
                                </p>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${getRoleStatusClass(role.status)}`}
                                >
                                  {getRoleStatusLabel(locale, role.status)}
                                </span>
                                <Pill>
                                  {role.roleKind === "manager"
                                    ? t(locale, "经理", "Manager")
                                    : t(locale, "执行者", "Worker")}
                                </Pill>
                              </div>
                              <p className="mt-1 text-[11px] font-medium text-white/80">
                                {role.currentTask}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-white/50">
                                <span>
                                  {t(locale, "最近更新", "Latest update")}:{" "}
                                  {fmt(role.updatedAt)}
                                </span>
                                <span>
                                  {role.tasks.length}{" "}
                                  {t(locale, "项任务", "tasks")}
                                </span>
                              </div>
                              <p className="mt-1 text-[10px] leading-5 text-white/50">
                                {role.summary}
                              </p>
                            </div>
                          </button>

                          {isExpanded ? (
                            <div className="border-t border-white/10 bg-white/5 px-3 py-3">
                              <div className="space-y-3">
                                {role.tasks.map(task => {
                                  const blocks = getTaskDetailBlocks(task);
                                  const deliverableText = getTaskPrimaryText(task);
                                  const hasDeliverableHandoff =
                                    deliverableText.trim().length > 0;
                                  return (
                                    <div
                                      key={task.id}
                                      className="rounded-xl glass-panel px-3 py-3"
                                    >
                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-2">
                                            {taskStatusIcon(task.status)}
                                            <p className="text-[12px] font-semibold text-white">
                                              {task.description}
                                            </p>
                                          </div>
                                          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-white/50">
                                            <span>
                                              {t(locale, "执行者", "Worker")}:{" "}
                                              {getNodeName(
                                                task.worker_id,
                                                nodeMap
                                              )}
                                            </span>
                                            <span>
                                              {t(locale, "版本", "Version")}{" "}
                                              {task.version}
                                            </span>
                                            {task.total_score !== null ? (
                                              <span>
                                                {copy.workflow.progress.score}:{" "}
                                                {task.total_score}/20
                                              </span>
                                            ) : null}
                                          </div>
                                        </div>
                                        <span
                                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${taskBadge[task.status] || taskBadge.assigned}`}
                                        >
                                          {copy.workflow.statuses.task[
                                            task.status as keyof typeof copy.workflow.statuses.task
                                          ] || task.status}
                                        </span>
                                      </div>

                                      {hasDeliverableHandoff ? (
                                        renderDeliverableDockHint(
                                          locale,
                                          deliverableText,
                                          {
                                            className:
                                              "mt-3 rounded-lg bg-white/5 px-3 py-2 text-[10px] leading-5 text-white/55",
                                            missionId:
                                              currentWorkflow?.missionId ?? null,
                                            onOpenRuntimeEvidence:
                                              dispatchOfficeRuntimeEvidence,
                                          }
                                        )
                                      ) : null}

                                      {blocks.length > 0 ? (
                                        <div
                                          className={`space-y-2 ${
                                            hasDeliverableHandoff
                                              ? "mt-2"
                                              : "mt-3"
                                          }`}
                                        >
                                          {blocks.map(block => (
                                            <div
                                              key={block.key}
                                              className="rounded-lg bg-white/5 px-3 py-2"
                                            >
                                              <p className="flex items-center text-[9px] font-semibold uppercase tracking-[0.16em] text-white/40">
                                                {block.key === "manager_feedback"
                                                  ? t(
                                                      locale,
                                                      "经理反馈",
                                                      "Manager feedback"
                                                    )
                                                  : t(
                                                      locale,
                                                      "审计反馈",
                                                      "Audit feedback"
                                                    )}
                                                <TtsPlayButton
                                                  id={`task-${task.id}-${block.key}`}
                                                  content={block.content || ""}
                                                />
                                              </p>
                                              <p className="mt-1 whitespace-pre-wrap text-[10px] leading-5 text-white/80">
                                                {block.content}
                                              </p>
                                            </div>
                                          ))}
                                        </div>
                                      ) : !hasDeliverableHandoff ? (
                                        <p className="mt-3 text-[10px] text-white/50">
                                          {t(
                                            locale,
                                            "当前还没有可展开的详细内容。",
                                            "There is no detailed content to expand yet."
                                          )}
                                        </p>
                                      ) : null}
                                    </div>
                                  );
                                })}

                                {role.messages.length > 0 ? (
                                  <div className="rounded-xl glass-panel px-3 py-3">
                                    <p className="text-[11px] font-semibold text-white">
                                      {t(locale, "相关事件", "Related events")}
                                    </p>
                                    <div className="mt-2 space-y-2">
                                      {role.messages.map(message => (
                                        <div
                                          key={message.id}
                                          className="rounded-lg bg-white/5 px-3 py-2"
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/50">
                                            <span>
                                              {getNodeName(
                                                message.from_agent,
                                                nodeMap
                                              )}{" "}
                                              →{" "}
                                              {getNodeName(
                                                message.to_agent,
                                                nodeMap
                                              )}
                                            </span>
                                            <span>
                                              {fmt(message.created_at)}
                                            </span>
                                          </div>
                                          <div className="mt-1 flex items-start gap-1">
                                            <p className="flex-1 text-[10px] leading-5 text-white/80">
                                              {summarizeText(
                                                message.content,
                                                copy.common.unavailable,
                                                180
                                              )}
                                            </p>
                                            {message.content ? (
                                              <TtsPlayButton
                                                id={`msg-${message.id}`}
                                                content={message.content}
                                              />
                                            ) : null}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl glass-panel p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-white/40" />
              <div>
                <p className="text-sm font-semibold text-white">
                  {t(locale, "关键事件", "Key events")}
                </p>
                <p className="text-[10px] leading-5 text-white/50">
                  {t(
                    locale,
                    "默认只显示最近 3 条，避免消息流把进度信息淹没。",
                    "Only the most recent events are shown by default so progress stays readable."
                  )}
                </p>
              </div>
            </div>
            {progressState.keyEvents.length > 3 ? (
              <button
                type="button"
                onClick={() => setShowAllEvents(prev => !prev)}
                className="rounded-lg bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/60"
              >
                {showAllEvents
                  ? t(locale, "收起", "Show less")
                  : t(locale, "查看全部事件", "View all events")}
              </button>
            ) : null}
          </div>

          {visibleEvents.length === 0 ? (
            <div className="rounded-2xl bg-white/5 px-4 py-6 text-center text-[11px] text-white/50">
              {copy.workflow.progress.noMessages}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleEvents.map(message => (
                <div
                  key={message.id}
                  className="rounded-xl glass-panel px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/50">
                    <span>
                      {getNodeName(message.from_agent, nodeMap)} →{" "}
                      {getNodeName(message.to_agent, nodeMap)}
                    </span>
                    <span>{fmt(message.created_at)}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-white/40">
                    {getDynamicStageLabel(
                      locale,
                      message.stage,
                      copy.workflow.stages[
                        message.stage as keyof typeof copy.workflow.stages
                      ] || message.stage
                    )}
                  </p>
                  <div className="mt-2 flex items-start gap-1">
                    <p className="flex-1 text-[11px] leading-5 text-white/80">
                      {summarizeText(
                        message.content,
                        copy.common.unavailable,
                        180
                      )}
                    </p>
                    {message.content ? (
                      <TtsPlayButton
                        id={`evt-${message.id}`}
                        content={message.content}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <RoleSwitchTimeline />

        <AgentAssessmentPanel />
        <CompetitionResultsPanel />
        <TaskforcePanel />

        <div className="rounded-2xl glass-panel p-3">
          <button
            type="button"
            onClick={() => setIsContextOpen(prev => !prev)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2">
              <PanelRight className="h-4 w-4 text-white/40" />
              <div>
                <p className="text-sm font-semibold text-white">
                  {t(locale, "输入与上下文", "Input and context")}
                </p>
                <p className="text-[10px] leading-5 text-white/50">
                  {t(
                    locale,
                    "附件和组织推理保留，但默认折叠，避免跟执行进度抢层级。",
                    "Attachments and organization context stay available, but collapsed by default."
                  )}
                </p>
              </div>
            </div>
            {isContextOpen ? (
              <ChevronDown className="h-4 w-4 text-white/40" />
            ) : (
              <ChevronRight className="h-4 w-4 text-white/40" />
            )}
          </button>

          {isContextOpen ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-xl glass-panel p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-white">
                    {t(locale, "输入附件", "Input attachments")}
                  </p>
                  <Pill>{attachments.length}</Pill>
                </div>
                {attachments.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {attachments.map(attachment => (
                      <div
                        key={attachment.id}
                        className="rounded-lg bg-white/5 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] font-medium text-white">
                            {attachment.name}
                          </p>
                          <div className="flex flex-wrap gap-2 text-[9px] text-white/50">
                            <Pill>{formatAttachmentSize(attachment.size)}</Pill>
                            <Pill>
                              {getAttachmentStatusLabel(locale, attachment)}
                            </Pill>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] text-white/50">
                    {t(
                      locale,
                      "当前没有输入附件。",
                      "There are no input attachments for this workflow."
                    )}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-indigo-300">
                    {t(locale, "组织摘要", "Organization summary")}
                  </p>
                  {organization ? (
                    <Pill>
                      {organization.departments.length}{" "}
                      {t(locale, "部门", "departments")}
                    </Pill>
                  ) : null}
                </div>
                {organization ? (
                  <>
                    <p className="mt-2 text-[11px] leading-5 text-indigo-300">
                      {t(locale, "当前组织", "Current org")}:{" "}
                      {organization.departments.length}{" "}
                      {t(locale, "部门", "departments")} /{" "}
                      {organization.nodes.length} {t(locale, "节点", "nodes")} /{" "}
                      {organization.taskProfile}
                    </p>
                    <p className="mt-2 text-[10px] leading-5 text-indigo-300">
                      {summarizeText(
                        organization.reasoning,
                        copy.common.unavailable,
                        180
                      )}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-[10px] text-indigo-300">
                    {t(
                      locale,
                      "当前还没有团队就位结果。",
                      "No execution team summary is available yet."
                    )}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {canExport ? (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          workflowId={currentWorkflow.id}
        />
      ) : null}
    </div>
  );
}

function ReviewView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const { currentWorkflow, tasks } = useWorkflowStore();
  return (
    <div className="flex h-full flex-col">
      <Section
        title={copy.workflow.review.title}
        description={copy.workflow.review.description}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tasks.length === 0 ? (
          <div className="rounded-2xl bg-white/5 px-4 py-8 text-center text-[11px] text-white/50">
            {copy.workflow.review.empty}
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map(task => (
              <div key={task.id} className="rounded-2xl glass-panel p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">
                    {task.description}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${taskBadge[task.status] || taskBadge.assigned}`}
                  >
                    {copy.workflow.statuses.task[
                      task.status as keyof typeof copy.workflow.statuses.task
                    ] || task.status}
                  </span>
                </div>
                {renderDeliverableDockHint(locale, getTaskPrimaryText(task), {
                  className:
                    "mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[10px] leading-5 text-white/55",
                  fallback: {
                    zh: "评审卡片不再直接铺开交付正文，完整内容统一查看首页共享运行证据容器的 Artifacts。",
                    en: "Review cards no longer inline the full deliverable. Open the shared Office home runtime evidence Artifacts tab for the full handoff.",
                  },
                  missionId: currentWorkflow?.missionId ?? null,
                  onOpenRuntimeEvidence: dispatchOfficeRuntimeEvidence,
                })}
                {task.manager_feedback ? (
                  <div className="mt-3 rounded-xl bg-emerald-500/10 p-3">
                    <p className="mb-1 flex items-center text-[10px] font-semibold text-emerald-400">
                      {copy.workflow.review.feedback}
                      <TtsPlayButton
                        id={`rv-mf-${task.id}`}
                        content={task.manager_feedback}
                      />
                    </p>
                    <p className="whitespace-pre-wrap text-[11px] leading-5 text-white/80">
                      {task.manager_feedback}
                    </p>
                  </div>
                ) : null}
                {task.meta_audit_feedback ? (
                  <div className="mt-3 rounded-xl bg-amber-500/10 p-3">
                    <p className="mb-1 flex items-center text-[10px] font-semibold text-amber-400">
                      {copy.workflow.review.audit}
                      <TtsPlayButton
                        id={`rv-af-${task.id}`}
                        content={task.meta_audit_feedback}
                      />
                    </p>
                    <p className="whitespace-pre-wrap text-[11px] leading-5 text-white/80">
                      {task.meta_audit_feedback}
                    </p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryView() {
  const { copy } = useI18n();
  const locale = useAppStore(state => state.locale);
  const fmt = useFmt();
  const isDemoActive = useDemoStore(s => s.isActive);
  const {
    agents,
    currentWorkflow,
    currentWorkflowId,
    selectedMemoryAgentId,
    setSelectedMemoryAgent,
    agentMemoryRecent,
    agentMemorySearchResults,
    memoryQuery,
    isMemoryLoading,
    memoryError,
    setMemoryQuery,
    fetchAgentRecentMemory,
    searchAgentMemory,
  } = useWorkflowStore();
  const [draft, setDraft] = useState(memoryQuery);
  const organization = getOrganization(currentWorkflow);
  const nodeMap = useMemo(() => getNodeMap(organization), [organization]);
  const organizationIds = useMemo(
    () => new Set(organization?.nodes.map(node => node.agentId) || []),
    [organization]
  );
  const availableAgents = useMemo(() => {
    const list = organization
      ? agents.filter(agent => organizationIds.has(agent.id))
      : agents;
    const rank: Record<AgentInfo["role"], number> = {
      ceo: 0,
      manager: 1,
      worker: 2,
    };
    return [...list].sort(
      (a, b) =>
        rank[a.role] - rank[b.role] || a.name.localeCompare(b.name, locale)
    );
  }, [agents, locale, organization, organizationIds]);
  const selectedAgent =
    availableAgents.find(agent => agent.id === selectedMemoryAgentId) ||
    (organization?.rootAgentId
      ? availableAgents.find(agent => agent.id === organization.rootAgentId)
      : null) ||
    availableAgents[0] ||
    null;

  useEffect(() => setDraft(memoryQuery), [memoryQuery]);
  useEffect(() => {
    if (!selectedMemoryAgentId && selectedAgent) {
      setSelectedMemoryAgent(selectedAgent.id);
    }
  }, [selectedAgent, selectedMemoryAgentId, setSelectedMemoryAgent]);
  useEffect(() => {
    if (selectedAgent)
      void fetchAgentRecentMemory(selectedAgent.id, currentWorkflowId, 10);
  }, [currentWorkflowId, fetchAgentRecentMemory, selectedAgent]);

  const doSearch = async () => {
    if (!selectedAgent || !draft.trim()) return;
    const query = draft.trim();
    setMemoryQuery(query);
    await searchAgentMemory(selectedAgent.id, query, 6);
  };

  return (
    <div className="flex h-full flex-col">
      <Section
        title={copy.workflow.memory.title}
        description={copy.workflow.memory.description}
      />
      {isDemoActive && <MemoryTimeline />}
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {availableAgents.map(agent => (
            <button
              key={agent.id}
              onClick={() => setSelectedMemoryAgent(agent.id)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                selectedAgent?.id === agent.id
                  ? "bg-[#D4845A] text-white"
                  : "bg-white/5 text-white/60"
              }`}
            >
              {agent.name}
            </button>
          ))}
        </div>
        {selectedAgent ? (
          <div className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-[10px] text-white/60">
            {selectedAgent.name} /{" "}
            {nodeMap.get(selectedAgent.id)?.title || selectedAgent.role} /{" "}
            {nodeMap.get(selectedAgent.id)?.departmentLabel ||
              selectedAgent.department}
            {(() => {
              const profile =
                useReputationStore.getState().profiles[selectedAgent.id];
              return profile ? (
                <span className="ml-2">
                  <ReputationBadge
                    grade={profile.grade}
                    trustTier={profile.trustTier}
                    size="sm"
                  />
                </span>
              ) : null;
            })()}
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {memoryError && selectedAgent ? (
          <WorkflowErrorNotice
            error={memoryError}
            onRetry={() => {
              if (memoryQuery.trim()) {
                void searchAgentMemory(selectedAgent.id, memoryQuery, 6);
                return;
              }
              void fetchAgentRecentMemory(
                selectedAgent.id,
                currentWorkflowId,
                10
              );
            }}
            className="mb-4"
          />
        ) : null}

        {selectedAgent ? (
          <div className="mb-4 space-y-3">
            {(() => {
              const profile =
                useReputationStore.getState().profiles[selectedAgent.id];
              if (!profile) return null;
              return (
                <>
                  <div className="flex justify-center">
                    <ReputationRadar
                      dimensions={profile.dimensions}
                      size={160}
                    />
                  </div>
                  <ReputationHistory agentId={selectedAgent.id} />
                </>
              );
            })()}
          </div>
        ) : null}
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="text-[11px] font-bold text-white/50">
              {copy.workflow.memory.recent}
            </h4>
            {isMemoryLoading ? (
              <span className="flex items-center gap-1 text-[10px] text-white/40">
                <Loader2 className="h-3 w-3 animate-spin" />
                {copy.common.loading}
              </span>
            ) : null}
          </div>
          {!selectedAgent ? (
            <div className="rounded-2xl bg-white/5 px-3 py-4 text-center text-[11px] text-white/50">
              {copy.workflow.memory.emptySelected}
            </div>
          ) : agentMemoryRecent.length === 0 ? (
            <div className="rounded-2xl bg-white/5 px-3 py-4 text-center text-[11px] text-white/50">
              {copy.workflow.memory.emptyRecent}
            </div>
          ) : (
            <div className="space-y-2">
              {agentMemoryRecent
                .slice()
                .reverse()
                .map((entry, index) => (
                  <div
                    key={`${entry.timestamp}-${index}`}
                    className="rounded-xl glass-panel p-3"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[8px] text-white/60">
                          {getMemoryTypeLabel(copy, entry.type)}
                        </span>
                        {entry.direction ? (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[8px] text-blue-400">
                            {copy.workflow.directions[
                              entry.direction as keyof typeof copy.workflow.directions
                            ] || entry.direction}
                          </span>
                        ) : null}
                        {entry.stage ? <Pill>{entry.stage}</Pill> : null}
                      </div>
                      <span className="text-[8px] text-white/40">
                        {fmt(entry.timestamp)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-[10px] leading-5 text-white/80">
                      {entry.preview || entry.content}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="mb-1.5 text-[11px] font-bold text-white/50">
            {copy.workflow.memory.search}
          </h4>
          <div className="mb-3 flex items-center gap-2">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void doSearch();
                }
              }}
              placeholder={copy.workflow.memory.searchPlaceholder}
              className="flex-1 rounded-xl glass-panel px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-cyan-400/40 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
            />
            <button
              onClick={() => void doSearch()}
              disabled={!selectedAgent || !draft.trim()}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#2D5F4A] px-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {copy.common.search}
            </button>
          </div>
          {agentMemorySearchResults.length === 0 ? (
            <div className="rounded-2xl bg-white/5 px-3 py-4 text-center text-[11px] text-white/50">
              {copy.workflow.memory.emptySearch}
            </div>
          ) : (
            <div className="space-y-2">
              {agentMemorySearchResults.map(item => (
                <div
                  key={`${item.workflowId}-${item.createdAt}`}
                  className="rounded-xl glass-panel p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-white">
                      {item.directive}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${wfBadge[item.status] || wfBadge.pending}`}
                    >
                      {copy.workflow.statuses.workflow[
                        item.status as keyof typeof copy.workflow.statuses.workflow
                      ] || item.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[9px] text-white/50">
                    {fmt(item.createdAt)}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-white/80">
                    {item.summary}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportCard({ item }: { item: HeartbeatReportInfo }) {
  const { copy } = useI18n();
  const fmt = useFmt();
  const downloadHeartbeatReport = useWorkflowStore(
    state => state.downloadHeartbeatReport
  );
  return (
    <div className="rounded-xl glass-panel p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-white">{item.title}</p>
          <p className="mt-0.5 text-[9px] text-white/50">
            {item.agentName} · {item.department} · {fmt(item.generatedAt)}
          </p>
        </div>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[8px] font-medium text-white/60">
          {copy.workflow.reports.triggers[
            item.trigger as keyof typeof copy.workflow.reports.triggers
          ] || item.trigger}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[10px] leading-5 text-white/80">
        {item.summaryPreview}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={() =>
            void downloadHeartbeatReport(item.agentId, item.reportId, "json")
          }
          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[9px] font-medium text-white/60"
        >
          <Download className="h-3 w-3" />
          {copy.common.json}
        </button>
        <button
          onClick={() =>
            void downloadHeartbeatReport(item.agentId, item.reportId, "md")
          }
          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[9px] font-medium text-white/60"
        >
          <Download className="h-3 w-3" />
          {copy.common.markdown}
        </button>
      </div>
    </div>
  );
}

function ReportsView() {
  const { copy } = useI18n();
  const fmt = useFmt();
  const {
    heartbeatStatuses,
    heartbeatReports,
    heartbeatError,
    fetchHeartbeatStatuses,
    fetchHeartbeatReports,
    runHeartbeat,
    runningHeartbeatAgentId,
    isHeartbeatLoading,
  } = useWorkflowStore();
  useEffect(() => {
    void fetchHeartbeatStatuses();
    void fetchHeartbeatReports(undefined, 12);
  }, [fetchHeartbeatReports, fetchHeartbeatStatuses]);
  const enabled = heartbeatStatuses.filter(item => item.enabled).length;
  const running = heartbeatStatuses.filter(
    item => item.state === "running"
  ).length;
  return (
    <div className="flex h-full flex-col">
      <Section
        title={copy.workflow.reports.title}
        description={copy.workflow.reports.description}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {heartbeatError ? (
          <WorkflowErrorNotice
            error={heartbeatError}
            onRetry={() => {
              void fetchHeartbeatStatuses();
              void fetchHeartbeatReports(undefined, 12);
            }}
            className="mb-3"
          />
        ) : null}

        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl glass-panel px-3 py-2">
            <p className="text-[9px] text-white/50">
              {copy.workflow.reports.enabled}
            </p>
            <p className="mt-1 text-sm font-bold text-white font-data">
              {enabled}
            </p>
          </div>
          <div className="rounded-xl glass-panel px-3 py-2">
            <p className="text-[9px] text-white/50">
              {copy.workflow.reports.running}
            </p>
            <p className="mt-1 text-sm font-bold text-white font-data">
              {running}
            </p>
          </div>
          <div className="rounded-xl glass-panel px-3 py-2">
            <p className="text-[9px] text-white/50">
              {copy.workflow.reports.latest}
            </p>
            <p className="mt-1 text-[10px] font-semibold text-white">
              {fmt(heartbeatReports[0]?.generatedAt || null)}
            </p>
          </div>
        </div>
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="text-[11px] font-bold text-white/50">
              {copy.workflow.reports.statusList}
            </h4>
            {isHeartbeatLoading ? (
              <span className="flex items-center gap-1 text-[10px] text-white/40">
                <Loader2 className="h-3 w-3 animate-spin" />
                {copy.common.loading}
              </span>
            ) : null}
          </div>
          {heartbeatStatuses.length === 0 ? (
            <div className="rounded-2xl bg-white/5 px-3 py-4 text-center text-[11px] text-white/50">
              {copy.workflow.reports.emptyStatuses}
            </div>
          ) : (
            <div className="space-y-2">
              {heartbeatStatuses.map(item => (
                <div key={item.agentId} className="rounded-xl glass-panel p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-semibold text-white">
                          {item.agentName}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[8px] font-medium ${hbBadge[item.state] || hbBadge.idle}`}
                        >
                          {copy.workflow.statuses.heartbeat[
                            item.state as keyof typeof copy.workflow.statuses.heartbeat
                          ] || item.state}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[9px] text-white/50">
                        {item.department} · {item.intervalMinutes} min ·{" "}
                        {item.reportCount}
                      </p>
                    </div>
                    <button
                      onClick={() => void runHeartbeat(item.agentId)}
                      disabled={
                        !item.enabled ||
                        runningHeartbeatAgentId === item.agentId
                      }
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-cyan-500/15 px-2.5 py-1.5 text-[9px] font-medium text-cyan-400 disabled:opacity-50"
                    >
                      {runningHeartbeatAgentId === item.agentId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Zap className="h-3 w-3" />
                      )}
                      {runningHeartbeatAgentId === item.agentId
                        ? copy.workflow.reports.runningNow
                        : copy.workflow.reports.triggerNow}
                    </button>
                  </div>
                  <div className="mt-2 rounded-lg bg-white/5 px-2.5 py-2 text-[9px] text-white/60">
                    <p>
                      {copy.workflow.reports.focus}: {item.focus}
                    </p>
                    <p className="mt-1">
                      {copy.workflow.reports.keywords}:{" "}
                      {item.keywords.length > 0
                        ? item.keywords.join(" / ")
                        : copy.common.unavailable}
                    </p>
                    <p className="mt-1">
                      {copy.workflow.reports.lastSuccess}:{" "}
                      {fmt(item.lastSuccessAt)}
                    </p>
                    <p className="mt-1">
                      {copy.workflow.reports.nextRun}: {fmt(item.nextRunAt)}
                    </p>
                    {item.lastReportTitle ? (
                      <p className="mt-1">
                        {copy.workflow.reports.lastReport}:{" "}
                        {item.lastReportTitle}
                      </p>
                    ) : null}
                    {item.lastError ? (
                      <p className="mt-1 text-red-400">
                        {copy.workflow.reports.error}: {item.lastError}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4 className="mb-1.5 text-[11px] font-bold text-white/50">
            {copy.workflow.reports.reportsList}
          </h4>
          {heartbeatReports.length === 0 ? (
            <div className="rounded-2xl bg-white/5 px-3 py-4 text-center text-[11px] text-white/50">
              {copy.workflow.reports.emptyReports}
            </div>
          ) : (
            <div className="space-y-2">
              {heartbeatReports.map(item => (
                <ReportCard
                  key={`${item.agentId}-${item.reportId}`}
                  item={item}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryView() {
  const { copy } = useI18n();
  const fmt = useFmt();
  const {
    workflows,
    workflowsError,
    setCurrentWorkflow,
    setActiveView,
    fetchWorkflows,
  } = useWorkflowStore();
  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);
  return (
    <div className="flex h-full flex-col">
      <Section title={copy.workflow.history.title} />
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {workflowsError ? (
          <WorkflowErrorNotice
            error={workflowsError}
            onRetry={() => {
              void fetchWorkflows();
            }}
          />
        ) : null}

        {workflows.length === 0 ? (
          <div className="py-8 text-center text-xs text-white/50">
            {copy.workflow.history.empty}
          </div>
        ) : (
          workflows.map(workflow => (
            <button
              key={workflow.id}
              onClick={() => {
                setCurrentWorkflow(workflow.id);
                setActiveView("workflow");
              }}
              className="w-full rounded-xl glass-panel p-3 text-left hover:bg-white/10"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${wfBadge[workflow.status] || wfBadge.pending}`}
                >
                  {copy.workflow.statuses.workflow[
                    workflow.status as keyof typeof copy.workflow.statuses.workflow
                  ] || workflow.status}
                </span>
                <span className="text-[9px] text-white/40">
                  {fmt(workflow.created_at)}
                </span>
              </div>
              <p className="line-clamp-2 text-xs text-white">
                {workflow.directive}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function DemoEvolutionOverlay() {
  const isDemoActive = useDemoStore(s => s.isActive);
  const currentStage = useDemoStore(s => s.currentStage);
  if (!isDemoActive || currentStage !== "evolution") return null;
  return <EvolutionScoreCard />;
}

function DemoControls() {
  const isDemoActive = useDemoStore(s => s.isActive);
  const playbackState = useDemoStore(s => s.playbackState);
  const { pauseDemo, resumeDemo, stopDemo } = useDemoMode();

  if (!isDemoActive) return null;

  return (
    <div className="flex items-center gap-2 border-b border-[#7CB9E8]/30 bg-blue-500/10 px-4 py-2">
      <span className="text-[10px] font-semibold text-blue-400">🎬 Demo</span>
      <span className="rounded-full bg-blue-400/20 px-2 py-0.5 text-[9px] font-medium text-blue-400">
        {playbackState}
      </span>
      <div className="flex-1" />
      {playbackState === "playing" ? (
        <button
          onClick={pauseDemo}
          className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-medium text-blue-400 hover:bg-white"
        >
          ⏸ Pause
        </button>
      ) : playbackState === "paused" ? (
        <button
          onClick={resumeDemo}
          className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-medium text-blue-400 hover:bg-white"
        >
          ▶ Resume
        </button>
      ) : null}
      <button
        onClick={stopDemo}
        className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-medium text-red-400 hover:bg-white"
      >
        ⏹ Stop
      </button>
    </div>
  );
}

export function WorkflowPanel({ embedded = false }: { embedded?: boolean }) {
  return <WorkflowPanelCompatibility embedded={embedded} />;
}
