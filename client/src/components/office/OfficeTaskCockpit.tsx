import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  Bot,
  ChevronDown,
  Copy,
  Ellipsis,
  FileText,
  Monitor,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  Terminal,
} from "lucide-react";
import { Splitter } from "antd";
import { toast } from "sonner";

import { ExecutorStatusPanel } from "@/components/ExecutorStatusPanel";
import { ExecutorTerminalPanel } from "@/components/ExecutorTerminalPanel";
import { UnifiedLaunchComposer } from "@/components/launch/UnifiedLaunchComposer";
import { ClarificationPanel } from "@/components/nl-command/ClarificationPanel";
import { ArtifactListBlock } from "@/components/tasks/ArtifactListBlock";
import { ArtifactPreviewDialog } from "@/components/tasks/ArtifactPreviewDialog";
import { CreateMissionDialog } from "@/components/tasks/CreateMissionDialog";
import { TasksCockpitDetail } from "@/components/tasks/TasksCockpitDetail";
import { TasksQueueRail } from "@/components/tasks/TasksQueueRail";
import {
  compactText,
  deriveMissionStepFlow,
  deriveMissionStepFocus,
  deriveCurrentOwner,
  deriveNextStep,
  deriveTaskBlocker,
  downloadAttachmentArtifact,
  missionStatusLabel,
} from "@/components/tasks/task-helpers";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import { CAN_USE_ADVANCED_RUNTIME } from "@/lib/deploy-target";
import { useNLCommandStore } from "@/lib/nl-command-store";
import type { TaskHubCommandSubmissionResult } from "@/lib/nl-command-store";
import { useAppStore } from "@/lib/store";
import { useTelemetryStore } from "@/lib/telemetry-store";
import { useTasksStore, type TaskArtifact } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { submitUnifiedClarification } from "@/lib/unified-launch-coordinator";
import { useWorkflowStore } from "@/lib/workflow-store";
import {
  OFFICE_RUNTIME_EVIDENCE_EVENT,
  type OfficeRuntimeEvidenceTab,
} from "@/lib/navigation-events";
import { resolveTaskHubLocationUpdate } from "@/pages/tasks/task-hub-location";

import { OfficeAgentInspectorPanel } from "./OfficeAgentInspectorPanel";
import {
  OfficeMemoryReportsPanel,
  OfficeWorkflowFlowPanel,
  OfficeWorkflowHistoryPanel,
} from "./OfficeWorkflowContextPanels";
import type {
  OfficeCockpitTab,
  OfficeLaunchResolution,
} from "./office-task-cockpit-types";
import {
  buildOfficeCockpitAvailability,
  resolveOfficeCockpitTab,
  resolveWorkflowForSelectedTask,
} from "./office-task-cockpit-utils";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function CockpitContextShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[16px] border border-stone-200/75 bg-white/82 shadow-[0_10px_24px_rgba(99,73,45,0.06)]">
      <div className="shrink-0 border-b border-stone-200/70 px-2.5 py-2">
        <div className="text-[8px] font-semibold uppercase tracking-[0.1em] text-stone-500">
          {title}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-stone-500">
          {description}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-1.5 pb-1.5 pt-1">
        {children}
      </div>
    </div>
  );
}

function RuntimeSignalCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]",
        tone === "info" && "border-sky-200/80 bg-sky-50/72",
        tone === "success" && "border-emerald-200/80 bg-emerald-50/72",
        tone === "warning" && "border-amber-200/80 bg-amber-50/78",
        tone === "danger" && "border-rose-200/80 bg-rose-50/78",
        tone === "neutral" && "border-white/60 bg-white/72"
      )}
    >
      <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-stone-500">
        {label}
      </div>
      <div className="mt-1 text-[10px] leading-4 text-stone-800">{value}</div>
    </div>
  );
}

export function OfficeTaskCockpit({
  className,
  resizeActive = false,
}: {
  className?: string;
  resizeActive?: boolean;
}) {
  const { locale } = useI18n();
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const toggleConfig = useAppStore(state => state.toggleConfig);
  const selectedPet = useAppStore(state => state.selectedPet);
  const telemetryDashboardOpen = useTelemetryStore(
    state => state.dashboardOpen
  );
  const toggleTelemetryDashboard = useTelemetryStore(
    state => state.toggleDashboard
  );
  const refresh = useTasksStore(state => state.refresh);
  const selectTask = useTasksStore(state => state.selectTask);
  const createMission = useTasksStore(state => state.createMission);
  const submitOperatorAction = useTasksStore(
    state => state.submitOperatorAction
  );
  const setDecisionNote = useTasksStore(state => state.setDecisionNote);
  const launchDecision = useTasksStore(state => state.launchDecision);
  const tasks = useTasksStore(state => state.tasks);
  const detailsById = useTasksStore(state => state.detailsById);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const loading = useTasksStore(state => state.loading);
  const ready = useTasksStore(state => state.ready);
  const error = useTasksStore(state => state.error);
  const decisionNotes = useTasksStore(state => state.decisionNotes);
  const operatorActionLoadingByMissionId = useTasksStore(
    state => state.operatorActionLoadingByMissionId
  );
  const workflows = useWorkflowStore(state => state.workflows);
  const agents = useWorkflowStore(state => state.agents);
  const currentWorkflow = useWorkflowStore(state => state.currentWorkflow);
  const currentWorkflowId = useWorkflowStore(state => state.currentWorkflowId);
  const fetchWorkflowDetail = useWorkflowStore(
    state => state.fetchWorkflowDetail
  );
  const fetchWorkflows = useWorkflowStore(state => state.fetchWorkflows);
  const setCurrentWorkflow = useWorkflowStore(
    state => state.setCurrentWorkflow
  );

  const [search, setSearch] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<OfficeCockpitTab>("task");
  const [launchingPresetId, setLaunchingPresetId] = useState<string | null>(
    null
  );
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(
    null
  );
  const [pendingLaunch, setPendingLaunch] =
    useState<OfficeLaunchResolution | null>(null);
  const [clarificationExpanded, setClarificationExpanded] = useState(true);
  const [launcherContextExpanded, setLauncherContextExpanded] = useState(false);
  const [runtimeDockTab, setRuntimeDockTab] = useState<
    "support" | "logs" | "artifacts" | "runtime"
  >("support");
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
  const previousSelectedPetRef = useRef<string | null>(selectedPet);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const currentDialog = useNLCommandStore(state => state.currentDialog);
  const currentCommand = useNLCommandStore(state => state.currentCommand);
  const hasActiveClarification = currentDialog?.status === "active";

  useEffect(() => {
    setClarificationExpanded(true);
  }, [hasActiveClarification, currentCommand?.commandId]);

  useEffect(() => {
    if (!highlightedTaskId || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      setHighlightedTaskId(current =>
        current === highlightedTaskId ? null : current
      );
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [highlightedTaskId]);

  const filteredTasks = useMemo(() => {
    if (!deferredSearch) return tasks;
    return tasks.filter(task => {
      const searchable = [
        task.title,
        task.sourceText,
        task.summary,
        task.currentStageLabel,
        task.waitingFor,
        ...task.departmentLabels,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(deferredSearch);
    });
  }, [deferredSearch, tasks]);

  const activeTaskId =
    (selectedTaskId && detailsById[selectedTaskId] ? selectedTaskId : null) ||
    filteredTasks[0]?.id ||
    null;
  const selectedDetail = activeTaskId
    ? detailsById[activeTaskId] || null
    : null;
  const selectedTaskSummary =
    tasks.find(task => task.id === activeTaskId) || null;
  const decisionNote = activeTaskId ? decisionNotes[activeTaskId] || "" : "";

  useEffect(() => {
    setRuntimeDockTab("support");
    setPreviewArtifactIndex(null);
    setPreviewArtifactName("");
    setPreviewArtifactFormat(undefined);
    setArtifactError(null);
  }, [selectedDetail?.id]);

  const pendingWorkflow =
    (pendingLaunch
      ? workflows.find(workflow => workflow.id === pendingLaunch.workflowId) ||
        null
      : null) ||
    (currentWorkflow &&
    pendingLaunch &&
    currentWorkflow.id === pendingLaunch.workflowId
      ? currentWorkflow
      : null);

  const activeWorkflow = useMemo(() => {
    const selectedWorkflow = resolveWorkflowForSelectedTask({
      taskId: activeTaskId,
      workflows,
      currentWorkflow,
    });
    return (
      pendingWorkflow ||
      selectedWorkflow ||
      (activeTaskId ? null : currentWorkflow)
    );
  }, [activeTaskId, currentWorkflow, pendingWorkflow, workflows]);

  useEffect(() => {
    const workflowForTask = resolveWorkflowForSelectedTask({
      taskId: activeTaskId,
      workflows,
      currentWorkflow,
    });
    if (workflowForTask && workflowForTask.id !== currentWorkflowId) {
      setCurrentWorkflow(workflowForTask.id);
      return;
    }
    if (
      !workflowForTask &&
      !pendingLaunch &&
      activeTaskId &&
      currentWorkflowId
    ) {
      setCurrentWorkflow(null);
    }
  }, [
    activeTaskId,
    currentWorkflow,
    currentWorkflowId,
    pendingLaunch,
    setCurrentWorkflow,
    workflows,
  ]);

  useEffect(() => {
    if (pendingLaunch && pendingLaunch.workflowId !== currentWorkflowId) {
      setCurrentWorkflow(pendingLaunch.workflowId);
    }
  }, [currentWorkflowId, pendingLaunch, setCurrentWorkflow]);

  useEffect(() => {
    if (!pendingLaunch) return;
    const linkedMissionId =
      pendingWorkflow?.missionId ||
      workflows.find(workflow => workflow.id === pendingLaunch.workflowId)
        ?.missionId ||
      null;
    if (linkedMissionId) {
      setPendingLaunch(null);
      setActiveTab("task");
      startTransition(() => {
        selectTask(linkedMissionId);
      });
      toast.success(
        t(
          locale,
          "团队准备完成，已自动把焦点切回新任务。",
          "Team setup is complete and the new task is now focused."
        )
      );
      return;
    }
    if (typeof window === "undefined") return;
    const timer = window.setInterval(() => {
      void fetchWorkflows();
      void fetchWorkflowDetail(pendingLaunch.workflowId);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [
    fetchWorkflowDetail,
    fetchWorkflows,
    locale,
    pendingLaunch,
    pendingWorkflow,
    selectTask,
    workflows,
  ]);

  useEffect(() => {
    if (selectedPet && selectedPet !== previousSelectedPetRef.current) {
      setActiveTab("agent");
    }
    previousSelectedPetRef.current = selectedPet;
  }, [selectedPet]);

  const availability = useMemo(
    () =>
      buildOfficeCockpitAvailability({
        detail: selectedDetail,
        workflow: activeWorkflow,
        agents,
        workflows,
      }),
    [activeWorkflow, agents, selectedDetail, workflows]
  );

  useEffect(() => {
    setActiveTab(current => resolveOfficeCockpitTab(current, availability));
  }, [availability]);

  useEffect(() => {
    if (hasActiveClarification) {
      setActiveTab("launch");
    }
  }, [hasActiveClarification]);

  async function handleLaunchDecision(presetId: string) {
    if (!activeTaskId) return;
    setLaunchingPresetId(presetId);
    try {
      await launchDecision(activeTaskId, presetId);
    } finally {
      setLaunchingPresetId(null);
    }
  }

  async function handleCreateMission(input: {
    title?: string;
    sourceText?: string;
    kind?: string;
    topicId?: string;
    autoDispatch?: boolean;
  }) {
    try {
      const missionId = await createMission(input);
      if (missionId) {
        toast.success(
          t(
            locale,
            "任务已创建并落入队列。",
            "Mission created and added to the queue."
          )
        );
      }
      return missionId;
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
          : t(locale, "创建任务失败。", "Failed to create mission.");
      toast.error(message);
      return null;
    }
  }

  async function handleSubmitOperatorAction(payload: {
    action: "pause" | "resume" | "retry" | "mark-blocked" | "terminate";
    reason?: string;
  }) {
    if (!activeTaskId) return;
    try {
      await submitOperatorAction(activeTaskId, {
        action: payload.action,
        reason: payload.reason,
      });
      toast.success(
        t(locale, "任务操作已提交。", "Mission operator action submitted.")
      );
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : t(
              locale,
              "任务操作提交失败。",
              "Failed to submit operator action."
            );
      toast.error(message);
      throw submitError;
    }
  }

  async function handleClarificationAnswer(
    questionId: string,
    text: string,
    selectedOptions?: string[]
  ) {
    if (!currentCommand) {
      return;
    }

    try {
      const result = await submitUnifiedClarification({
        commandId: currentCommand.commandId,
        answer: {
          questionId,
          text,
          selectedOptions,
          timestamp: Date.now(),
        },
      });

      if (
        result?.route === "mission" &&
        result.status === "created" &&
        result.missionId
      ) {
        handleTaskHubResolved({
          commandId: result.commandId,
          commandText: currentCommand.commandText,
          missionId: result.missionId,
          relatedMissionIds: [result.missionId],
          autoSelectedMissionId: result.missionId,
          status: "created",
          createdAt: Date.now(),
        });
        toast.success(
          t(
            locale,
            "补充信息已完成，任务已经进入主队列。",
            "Clarification is complete and the mission has entered the queue."
          )
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(locale, "补充信息提交失败。", "Failed to submit clarification.")
      );
    }
  }

  function handleTaskHubResolved(result: TaskHubCommandSubmissionResult) {
    const locationUpdate = resolveTaskHubLocationUpdate({
      missionId: result.autoSelectedMissionId || result.missionId,
      currentSearch: search,
      filteredTaskIds: filteredTasks.map(task => task.id),
      allTaskIds: tasks.map(task => task.id),
    });
    if (locationUpdate.nextSearch !== search) {
      setSearch(locationUpdate.nextSearch);
    }
    if (locationUpdate.focusTaskId) {
      setActiveTab("task");
      startTransition(() => {
        selectTask(locationUpdate.focusTaskId);
      });
    }
    if (locationUpdate.highlightTaskId) {
      setHighlightedTaskId(locationUpdate.highlightTaskId);
    }
  }

  const refreshCurrent = () =>
    void refresh({ preferredTaskId: activeTaskId || null });
  const queuedCount = tasks.filter(task => task.status === "queued").length;
  const runningCount = tasks.filter(task => task.status === "running").length;
  const waitingCount = tasks.filter(task => task.status === "waiting").length;
  const warningCount = tasks.filter(task => task.hasWarnings).length;
  const stepFocus = deriveMissionStepFocus(
    selectedDetail ?? selectedTaskSummary,
    locale,
    {
      pendingDirective: pendingLaunch?.directive,
      pendingStageLabel: pendingWorkflow?.current_stage || null,
    }
  );
  const stepFlow = deriveMissionStepFlow(selectedDetail ?? selectedTaskSummary);
  const runtimeModeLabel =
    runtimeMode === "advanced"
      ? t(locale, "高级执行", "Advanced runtime")
      : t(locale, "前端预览", "Frontend preview");
  const runtimeModeHint =
    runtimeMode === "advanced"
      ? t(
          locale,
          "服务端与容器链路已经可用",
          "Server and container lanes are available"
        )
      : t(
          locale,
          "适合快速预览和前台验证",
          "Best for fast previews and front-end validation"
        );
  const floatingGlassClass = resizeActive
    ? "border-stone-200/85 bg-[#fff9f2]/96 shadow-[0_10px_24px_rgba(98,73,48,0.06)]"
    : "border-white/30 bg-[linear-gradient(180deg,rgba(255,252,248,0.36),rgba(246,238,229,0.28))] shadow-[0_14px_34px_rgba(98,73,48,0.1)] backdrop-blur-md transition-all hover:bg-[linear-gradient(180deg,rgba(255,252,248,0.62),rgba(246,238,229,0.52))]";
  const sideShellClass = resizeActive
    ? "border-stone-200/85 bg-[#fff9f2]/96 shadow-[0_14px_30px_rgba(99,73,45,0.08)]"
    : "border-white/35 bg-[linear-gradient(180deg,rgba(255,252,248,0.48),rgba(244,236,227,0.32))] shadow-[0_22px_48px_rgba(99,73,45,0.12)] backdrop-blur-md transition-all hover:bg-[linear-gradient(180deg,rgba(255,252,248,0.7),rgba(246,238,229,0.5))]";
  const hasPendingDecision =
    Boolean(selectedDetail) &&
    (selectedDetail?.decision != null ||
      (selectedDetail?.decisionPresets.length ?? 0) > 0 ||
      Boolean(selectedDetail?.decisionPrompt));
  const currentOwnerInsight = selectedDetail
    ? deriveCurrentOwner(selectedDetail, locale)
    : null;
  const blockerInsight = selectedDetail
    ? deriveTaskBlocker(selectedDetail, locale)
    : null;
  const nextStepInsight = selectedDetail
    ? deriveNextStep(selectedDetail, locale)
    : null;
  const showWaitingSupportCard = Boolean(
    selectedDetail?.status === "waiting" || hasPendingDecision
  );
  const showSupportBlockerCard = Boolean(
    blockerInsight &&
      (selectedDetail?.blocker != null ||
        selectedDetail?.operatorState === "blocked" ||
        selectedDetail?.operatorState === "paused" ||
        selectedDetail?.status === "failed")
  );
  const showSupportNextStepCard = Boolean(
    nextStepInsight &&
      (hasPendingDecision ||
        selectedDetail?.status === "waiting" ||
        selectedDetail?.status === "failed" ||
        selectedDetail?.status === "cancelled" ||
        selectedDetail?.operatorState === "blocked" ||
        selectedDetail?.operatorState === "paused")
  );
  const supportOwnerInsight =
    currentOwnerInsight &&
    selectedDetail &&
    (hasPendingDecision ||
      selectedDetail.operatorState === "blocked" ||
      selectedDetail.operatorState === "paused" ||
      selectedDetail.status === "failed")
      ? currentOwnerInsight
      : null;
  const showClarificationSupportCard = Boolean(
    hasActiveClarification && currentCommand
  );
  const showPendingLaunchSupportCard = Boolean(pendingLaunch);
  const supportTabHasContext =
    showWaitingSupportCard ||
    showSupportBlockerCard ||
    showSupportNextStepCard ||
    Boolean(supportOwnerInsight) ||
    showPendingLaunchSupportCard ||
    showClarificationSupportCard;
  const waitingSupportTitle = hasPendingDecision
    ? t(locale, "待处理决策", "Pending decision")
    : t(locale, "等待上下文", "Waiting context");
  const waitingSupportDetail = compactText(
    selectedDetail?.waitingFor ||
      selectedDetail?.decisionPrompt ||
      selectedDetail?.decision?.prompt ||
      t(
        locale,
        "当前等待人工确认后继续推进。",
        "The mission is waiting for manual confirmation before continuing."
      ),
    180
  );
  const waitingSupportMeta = [
    selectedDetail?.currentStageLabel || null,
    hasPendingDecision
      ? t(
          locale,
          "右侧任务工作区可继续提交决策",
          "Continue the decision in the task workspace on the right"
        )
      : showWaitingSupportCard
        ? t(
            locale,
            "墙上中心只广播等待步骤，补充说明统一留在这里",
            "The wall only broadcasts the waiting step. Supporting detail stays here."
          )
        : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const shouldAutoExpandLauncherContext =
    hasActiveClarification ||
    Boolean(pendingLaunch) ||
    hasPendingDecision ||
    selectedDetail?.status === "waiting" ||
    selectedDetail?.status === "failed" ||
    selectedDetail?.status === "cancelled" ||
    selectedDetail?.operatorState === "blocked" ||
    selectedDetail?.operatorState === "paused";
  const showLauncherContextDock = !hasActiveClarification;
  const launcherContextDockMaxHeight = "clamp(240px, 32vh, 420px)";
  useEffect(() => {
    if (hasActiveClarification) {
      setLauncherContextExpanded(false);
      return;
    }
    if (shouldAutoExpandLauncherContext) {
      setLauncherContextExpanded(true);
    }
  }, [
    hasActiveClarification,
    currentCommand?.commandId,
    pendingLaunch?.workflowId,
    selectedDetail?.id,
    selectedDetail?.operatorState,
    selectedDetail?.status,
    shouldAutoExpandLauncherContext,
  ]);

  useEffect(() => {
    if (supportTabHasContext) {
      setRuntimeDockTab("support");
    }
  }, [
    supportTabHasContext,
    selectedDetail?.id,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOpenRuntimeEvidence = (event: Event) => {
      const customEvent = event as CustomEvent<{
        tab?: OfficeRuntimeEvidenceTab;
        missionId?: string | null;
      }>;
      const requestedTab = customEvent.detail?.tab ?? "runtime";
      const missionId = customEvent.detail?.missionId ?? null;

      if (missionId) {
        selectTask(missionId);
      }
      setLauncherContextExpanded(true);
      setRuntimeDockTab(requestedTab);
    };

    window.addEventListener(
      OFFICE_RUNTIME_EVIDENCE_EVENT,
      handleOpenRuntimeEvidence as EventListener
    );

    return () =>
      window.removeEventListener(
        OFFICE_RUNTIME_EVIDENCE_EVENT,
        handleOpenRuntimeEvidence as EventListener
      );
  }, [selectTask]);

  async function handleCopyFocusSummary() {
    const summary = [
      stepFocus.title,
      `${stepFocus.stageLabel} / ${stepFocus.progress}%`,
    ]
      .filter(Boolean)
      .join("\n");
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      toast.error(
        t(locale, "当前环境无法复制。", "Clipboard is not available here.")
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(summary);
      toast.success(
        t(locale, "已复制当前焦点摘要。", "Copied the current focus summary.")
      );
    } catch (copyError) {
      toast.error(
        copyError instanceof Error
          ? copyError.message
          : t(locale, "复制当前焦点失败。", "Failed to copy the current focus.")
      );
    }
  }

  async function handleArtifactDownload(artifact: TaskArtifact) {
    if (!selectedDetail) return;
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
          message: t(locale, "产物下载失败。", "Artifact download failed."),
        });
      }
      return;
    }

    const downloadUrl = artifact.downloadUrl || artifact.href;
    if (!downloadUrl) {
      setArtifactError({
        artifact,
        message: t(locale, "产物下载失败。", "Artifact download failed."),
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
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      const message =
        downloadError instanceof Error && downloadError.message
          ? downloadError.message
          : t(locale, "产物下载失败。", "Artifact download failed.");
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

  const launcherDock = (
    <div
      className={cn(
        "pointer-events-auto mx-auto flex w-full max-w-[700px] flex-col overflow-hidden rounded-[14px] border",
        floatingGlassClass
      )}
    >
      <div className="shrink-0 border-b border-stone-200/50 px-1.5 py-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex rounded-[10px] border border-white/65 bg-white/78 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
              <span className="inline-flex items-center gap-1 rounded-[8px] bg-[#d07a4f] px-1.5 py-0.5 text-[8px] font-semibold text-white shadow-[0_10px_24px_rgba(184,111,69,0.18)]">
                {t(locale, "统一智能发起", "Unified smart launch")}
              </span>
              <button
                type="button"
                onClick={toggleTelemetryDashboard}
                className={cn(
                  "inline-flex items-center gap-1 rounded-[8px] px-1.5 py-0.5 text-[8px] font-semibold transition-colors",
                  telemetryDashboardOpen
                    ? "bg-[#d07a4f] text-white shadow-[0_10px_24px_rgba(184,111,69,0.18)]"
                    : "text-stone-600 hover:bg-white"
                )}
              >
                <Activity className="size-3.5" />
                {t(locale, "统计驾驶台", "Metrics dock")}
              </button>
            </div>

            {pendingLaunch ? (
              <span className="workspace-status workspace-tone-warning px-1 py-0.5 text-[8px] font-semibold">
                {t(
                  locale,
                  "团队准备中，完成后会自动回到任务视角。",
                  "Team preparing, then auto-return to the task view."
                )}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              className="workspace-control h-5 rounded-full px-1.5 text-[8px]"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="size-3.5" />
              {t(locale, "新建任务", "New task")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="workspace-control h-5 rounded-full px-1.5 text-[8px]"
              onClick={refreshCurrent}
              disabled={loading && ready}
            >
              <RefreshCw
                className={cn("size-3.5", loading && ready && "animate-spin")}
              />
              {t(locale, "刷新", "Refresh")}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="workspace-control h-5 rounded-full px-1.5 text-[8px]"
                >
                  {runtimeMode === "advanced" ? (
                    <Server className="size-3.5" />
                  ) : (
                    <Monitor className="size-3.5" />
                  )}
                  {runtimeModeLabel}
                  <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="z-[80] w-56"
              >
                <div className="px-2 py-1.5 text-[11px] leading-5 text-stone-500">
                  {runtimeModeHint}
                </div>
                <DropdownMenuRadioGroup
                  value={runtimeMode}
                  onValueChange={value =>
                    void setRuntimeMode(value as "frontend" | "advanced")
                  }
                >
                  <DropdownMenuRadioItem value="frontend">
                    {t(locale, "前端预览", "Frontend preview")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="advanced"
                    disabled={!CAN_USE_ADVANCED_RUNTIME}
                  >
                    {t(locale, "高级执行", "Advanced runtime")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="workspace-control h-5 rounded-full px-1.5 text-[8px]"
                >
                  <Ellipsis className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="z-[80] w-48"
              >
                <DropdownMenuItem
                  onSelect={event => {
                    event.preventDefault();
                    void handleCopyFocusSummary();
                  }}
                >
                  <Copy className="size-4" />
                  {t(locale, "复制当前焦点", "Copy focus")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={event => {
                    event.preventDefault();
                    toggleConfig();
                  }}
                >
                  <Settings2 className="size-4" />
                  {t(locale, "运行时配置", "Runtime config")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={event => {
                    event.preventDefault();
                    toggleTelemetryDashboard();
                  }}
                >
                  <Activity className="size-4" />
                  {telemetryDashboardOpen
                    ? t(locale, "收起统计驾驶台", "Hide metrics dock")
                    : t(locale, "打开统计驾驶台", "Open metrics dock")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-1 flex flex-wrap gap-0.5">
          <span
            className={cn(
              "workspace-status !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold",
              `workspace-tone-${stepFocus.tone}`
            )}
          >
            {selectedDetail
              ? missionStatusLabel(selectedDetail.status, locale)
              : pendingLaunch
                ? t(locale, "团队准备中", "Team preparing")
                : t(locale, "场景待命", "Scene ready")}
          </span>
          <span className="workspace-status workspace-tone-neutral !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold">
            {t(locale, `队列 ${queuedCount}`, `Queue ${queuedCount}`)}
          </span>
          <span className="workspace-status workspace-tone-warning !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold">
            {t(locale, `运行 ${runningCount}`, `Running ${runningCount}`)}
          </span>
          <span className="workspace-status workspace-tone-info !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold">
            {t(locale, `等待 ${waitingCount}`, `Waiting ${waitingCount}`)}
          </span>
          <span
            className={cn(
              "workspace-status !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold",
              warningCount > 0
                ? "workspace-tone-warning"
                : "workspace-tone-neutral"
            )}
          >
            {t(locale, `关注 ${warningCount}`, `Warnings ${warningCount}`)}
          </span>
        </div>

      </div>

    </div>
  );

  const launcherContextDock = (
    <div className="pointer-events-auto mx-auto w-full max-w-[700px] overflow-hidden rounded-[16px] border border-white/34 bg-[linear-gradient(180deg,rgba(255,252,248,0.62),rgba(246,238,229,0.5))] shadow-[0_16px_36px_rgba(98,73,48,0.12)] backdrop-blur-md">
      <Tabs
        value={runtimeDockTab}
        onValueChange={value =>
          setRuntimeDockTab(
            value as "support" | "logs" | "artifacts" | "runtime"
          )
        }
        className="flex h-full min-h-0 flex-col"
      >
        <div className="border-b border-stone-200/55 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[8px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {t(locale, "辅助判断 / 运行证据", "Support / Runtime Evidence")}
              </div>
              <div className="mt-0.5 text-[10px] leading-4 text-stone-600">
                {t(
                  locale,
                  "辅助 tab 只保留按需判断信息，Logs / Artifacts / Runtime 作为独立运行证据 tab 统一归口。",
                  "The Support tab keeps only decision aids, while Logs / Artifacts / Runtime stay grouped as dedicated runtime evidence tabs."
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1">
                {pendingLaunch ? (
                  <span className="workspace-status workspace-tone-warning !px-1.5 !py-0.5 !text-[8px] font-semibold">
                    {t(locale, "团队准备中", "Team preparing")}
                  </span>
                ) : null}
                {hasActiveClarification ? (
                  <span className="workspace-status workspace-tone-warning !px-1.5 !py-0.5 !text-[8px] font-semibold">
                    {t(locale, "补问进行中", "Clarification active")}
                  </span>
                ) : null}
              </div>
              <TabsList className="grid h-auto grid-cols-4 rounded-[12px] bg-white/82 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
                <TabsTrigger
                  value="support"
                  className="min-h-[28px] rounded-[10px] px-2 py-0.5 text-[10px] font-semibold"
                >
                  {t(locale, "辅助", "Support")}
                </TabsTrigger>
                <TabsTrigger
                  value="logs"
                  className="min-h-[28px] rounded-[10px] px-2 py-0.5 text-[10px] font-semibold"
                  disabled={!selectedDetail}
                >
                  <Terminal className="mr-1 size-3" />
                  Logs
                </TabsTrigger>
                <TabsTrigger
                  value="artifacts"
                  className="min-h-[28px] rounded-[10px] px-2 py-0.5 text-[10px] font-semibold"
                  disabled={!selectedDetail}
                >
                  <FileText className="mr-1 size-3" />
                  Artifacts
                </TabsTrigger>
                <TabsTrigger
                  value="runtime"
                  className="min-h-[28px] rounded-[10px] px-2 py-0.5 text-[10px] font-semibold"
                  disabled={!selectedDetail}
                >
                  <Bot className="mr-1 size-3" />
                  Runtime
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
        </div>

        <TabsContent
          value="support"
          className="mt-0 min-h-0 flex-1 overflow-hidden p-3 data-[state=active]:block"
        >
          {supportTabHasContext ? (
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {showWaitingSupportCard ? (
                <div className="rounded-[12px] border border-sky-200/70 bg-sky-50/78 px-3 py-2 text-[9px] leading-4 text-stone-700 lg:col-span-2">
                  <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                    {waitingSupportTitle}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold text-stone-900">
                    {selectedDetail?.currentStageLabel ||
                      t(locale, "等待继续推进", "Waiting to continue")}
                  </div>
                  <div className="mt-1 text-[9px] leading-4 text-stone-600">
                    {waitingSupportDetail}
                  </div>
                  {waitingSupportMeta ? (
                    <div className="mt-1 text-[8px] leading-4 text-sky-700">
                      {waitingSupportMeta}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showSupportBlockerCard ? (
                <div className="rounded-[12px] border border-white/60 bg-white/64 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
                  <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                    {blockerInsight?.label || t(locale, "阻塞", "Blocker")}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold text-stone-900">
                    {blockerInsight?.title || t(locale, "当前无阻塞", "No blocker")}
                  </div>
                  <div className="mt-1 text-[9px] leading-4 text-stone-600">
                    {compactText(
                      blockerInsight?.detail ||
                        t(
                          locale,
                          "当前没有新的等待项。",
                          "No blocking item is active right now."
                        ),
                      140
                    )}
                  </div>
                </div>
              ) : null}

              {showSupportNextStepCard ? (
                <div className="rounded-[12px] border border-white/60 bg-white/64 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
                  <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                    {nextStepInsight?.label || t(locale, "下一步", "Next step")}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold text-stone-900">
                    {nextStepInsight?.title ||
                      t(locale, "等待继续推进", "Ready to continue")}
                  </div>
                  <div className="mt-1 text-[9px] leading-4 text-stone-600">
                    {compactText(
                      nextStepInsight?.detail ||
                        t(
                          locale,
                          "继续沿着当前主线推进即可。",
                          "Continue along the active mainline."
                        ),
                      140
                    )}
                  </div>
                </div>
              ) : null}

              {supportOwnerInsight ? (
                <div className="rounded-[12px] border border-white/60 bg-white/64 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] lg:col-span-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                      {supportOwnerInsight.label}
                    </span>
                    <span
                      className={cn(
                        "workspace-status !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold",
                        `workspace-tone-${supportOwnerInsight.tone || "neutral"}`
                      )}
                    >
                      {supportOwnerInsight.title}
                    </span>
                    {supportOwnerInsight.meta ? (
                      <span className="truncate text-[8px] text-stone-500">
                        {supportOwnerInsight.meta}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[9px] leading-4 text-stone-600">
                    {compactText(supportOwnerInsight.detail, 180)}
                  </div>
                </div>
              ) : null}

              {pendingLaunch ? (
                <div className="rounded-[12px] border border-amber-200/70 bg-amber-50/78 px-3 py-2 text-[9px] leading-4 text-stone-700 lg:col-span-2">
                  <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                    {t(locale, "待启动团队", "Pending launch")}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold text-stone-900">
                    {compactText(
                      pendingLaunch.directive ||
                        t(
                          locale,
                          "团队正在准备，稍后会自动切回任务视图。",
                          "The team is preparing and will return to the task view soon."
                        ),
                      90
                    )}
                  </div>
                  <div className="mt-1 text-[9px] leading-4 text-stone-600">
                    {t(
                      locale,
                      `已挂载 ${pendingLaunch.attachmentCount} 个附件，等待 workflow 接线完成。`,
                      `${pendingLaunch.attachmentCount} attachments are already queued while the workflow connection is completing.`
                    )}
                  </div>
                </div>
              ) : null}

              {hasActiveClarification && currentCommand ? (
                <div className="rounded-[12px] border border-amber-200/70 bg-amber-50/78 px-3 py-2 text-[9px] leading-4 text-stone-700 lg:col-span-2">
                  <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                    {t(locale, "补问信息", "Clarification context")}
                  </div>
                  <div className="mt-1">
                    {compactText(
                      currentCommand.commandText ||
                        t(
                          locale,
                          "当前补问没有额外上下文。",
                          "No extra clarification context is available."
                        ),
                      180
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-[14px] border border-dashed border-stone-300/80 bg-white/70 px-3 py-4 text-[10px] leading-5 text-stone-500">
              {t(
                locale,
                "当前没有需要人工介入的辅助判断信息。任务执行证据统一留在 Logs / Artifacts / Runtime。",
                "There is no support context that needs manual attention right now. Runtime evidence stays in Logs / Artifacts / Runtime."
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="logs"
          className="mt-0 min-h-0 flex-1 overflow-hidden p-3 data-[state=active]:flex data-[state=active]:flex-col"
        >
          {selectedDetail ? (
            <ExecutorTerminalPanel
              missionId={selectedDetail.id}
              missionStatus={selectedDetail.status}
              executorStatus={selectedDetail.executor?.status}
            />
          ) : null}
        </TabsContent>

        <TabsContent
          value="artifacts"
          className="mt-0 min-h-0 flex-1 overflow-hidden p-3 data-[state=active]:block"
        >
          {selectedDetail ? (
            <div
              className="min-h-0 overflow-y-auto rounded-[16px] border border-white/50 bg-[rgba(255,255,255,0.48)] p-2"
              style={{ maxHeight: "clamp(170px, 22vh, 220px)" }}
            >
              {artifactError ? (
                <div className="mb-2 rounded-[12px] border border-rose-200/70 bg-rose-50/78 px-3 py-2 text-[10px] leading-4 text-rose-700">
                  {artifactError.message}
                </div>
              ) : null}
              <ArtifactListBlock
                missionId={selectedDetail.id}
                artifacts={selectedDetail.artifacts}
                missionStatus={selectedDetail.status}
                variant="compact"
                downloadingArtifactId={downloadingArtifactId}
                onDownload={handleArtifactDownload}
                onPreview={handleArtifactPreview}
                showEmptyState
              />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent
          value="runtime"
          className="mt-0 min-h-0 flex-1 overflow-hidden p-3 data-[state=active]:block"
        >
          {selectedDetail ? (
            <div
              className="min-h-0 overflow-y-auto rounded-[16px] border border-white/50 bg-[rgba(255,255,255,0.48)] p-2"
              style={{ maxHeight: "clamp(170px, 22vh, 220px)" }}
            >
              <div className="mb-2 rounded-[12px] border border-white/60 bg-white/72 px-3 py-2 text-[10px] leading-4 text-stone-600">
                {t(
                  locale,
                  "这里统一承接 executor、socket / callback、最近动作与失败原因；完整日志流统一进入 Logs。",
                  "This tab is the single home for executor, socket / callback, recent action, and failure. Full logs live in Logs."
                )}
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                <RuntimeSignalCard
                  label={t(locale, "Socket", "Socket")}
                  value={selectedDetail.runtimeChannels.socket.label}
                  tone={
                    selectedDetail.runtimeChannels.socket.status ===
                    "connected"
                      ? "success"
                      : "warning"
                  }
                />
                <RuntimeSignalCard
                  label={t(locale, "Callback", "Callback")}
                  value={selectedDetail.runtimeChannels.callback.label}
                  tone={
                    selectedDetail.runtimeChannels.callback.status === "error"
                      ? "danger"
                      : selectedDetail.runtimeChannels.callback.status === "waiting"
                        ? "warning"
                        : selectedDetail.runtimeChannels.callback.status === "active"
                      ? "success"
                      : "neutral"
                  }
                />
                {selectedDetail.failureReasons[0] ? (
                  <RuntimeSignalCard
                    label={t(locale, "最近失败原因", "Recent failure")}
                    value={selectedDetail.failureReasons[0]}
                    tone="danger"
                  />
                ) : null}
                {selectedDetail.lastSignal ? (
                  <RuntimeSignalCard
                    label={t(locale, "最近动作", "Recent action")}
                    value={selectedDetail.lastSignal}
                    tone="info"
                  />
                ) : null}
              </div>
              {!selectedDetail.failureReasons[0] && !selectedDetail.lastSignal ? (
                <div className="mt-2 rounded-[12px] border border-dashed border-stone-300/80 bg-white/72 px-3 py-3 text-[10px] leading-4 text-stone-500">
                  {t(
                    locale,
                    "当前没有新的失败或动作记录，完整输出仍可在 Logs 查看。",
                    "There is no recent failure or action record right now. Full output remains available in Logs."
                  )}
                </div>
              ) : null}
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                <div className="rounded-[12px] border border-white/60 bg-white/74 px-3 py-2 text-[10px] leading-4 text-stone-600">
                  {selectedDetail.runtimeChannels.socket.detail}
                </div>
                <div className="rounded-[12px] border border-white/60 bg-white/74 px-3 py-2 text-[10px] leading-4 text-stone-600">
                  {selectedDetail.runtimeChannels.callback.detail}
                  {selectedDetail.runtimeChannels.callback.eventSummary ? (
                    <div className="mt-1 text-[9px] leading-4 text-stone-500">
                      {selectedDetail.runtimeChannels.callback.eventSummary}
                    </div>
                  ) : null}
                </div>
              </div>
              {selectedDetail.executor ? (
                <div className="mt-2 rounded-[16px] border border-white/60 bg-white/78 p-3">
                  <ExecutorStatusPanel
                    executor={selectedDetail.executor}
                    instance={selectedDetail.instance}
                  />
                </div>
              ) : (
                <div className="rounded-[16px] border border-dashed border-stone-300/80 bg-white/72 px-3 py-4 text-[11px] leading-5 text-stone-500">
                  {t(
                    locale,
                    "当前任务还没有 executor 运行时上下文。",
                    "This mission does not have executor runtime context yet."
                  )}
                </div>
              )}
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );

  const launcherFloatingStack = (
    <div
      className="pointer-events-none mx-auto flex w-full max-w-[720px] flex-col justify-end overflow-visible"
    >
      <div
        className="pointer-events-none relative z-10 w-full pt-2"
      >
        {showLauncherContextDock && launcherContextExpanded ? (
          <div
            className="pointer-events-none absolute left-0 right-0 z-20"
            style={{ bottom: "calc(100% + 14px)" }}
          >
            <div
              className="pointer-events-auto overflow-y-auto"
              style={{ maxHeight: launcherContextDockMaxHeight }}
            >
              {launcherContextDock}
            </div>
          </div>
        ) : null}

        {showLauncherContextDock ? (
          <div className="pointer-events-auto absolute left-1/2 top-[-9px] z-30 -translate-x-1/2">
            <button
              type="button"
              className="inline-flex h-7 w-12 items-center justify-center rounded-full border border-stone-200/80 bg-white/94 text-[#9c6b47] shadow-[0_10px_24px_rgba(88,61,39,0.14)] backdrop-blur-md transition hover:bg-[#fff8f1] hover:text-[#5e8b72]"
              aria-label={
                launcherContextExpanded
                  ? t(locale, "收起辅助信息", "Collapse supporting context")
                  : t(locale, "展开辅助信息", "Expand supporting context")
              }
              onClick={() => setLauncherContextExpanded(current => !current)}
            >
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  launcherContextExpanded && "rotate-180"
                )}
              />
            </button>
          </div>
        ) : null}

        {launcherDock}
      </div>
    </div>
  );

  const launchStage = (
    <div className="pointer-events-none flex h-full min-h-0 w-full items-end justify-center">
      <div className="pointer-events-none flex w-full max-w-[860px] flex-col justify-end">
        {launcherFloatingStack}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 bottom-[24px] top-[76px] z-[52] min-h-0 2xl:bottom-[28px]",
        className
      )}
    >
      <Splitter className="office-cockpit-splitter pointer-events-auto relative z-10 h-full min-h-0">
        <Splitter.Panel
          defaultSize={0}
          min={320}
          max={460}
          resizable={false}
          collapsible={{ end: true, showCollapsibleIcon: true }}
          style={{ overflow: "hidden" }}
        >
          <aside className="min-h-0 h-full pr-2">
            <TasksQueueRail
              tasks={filteredTasks}
              totalCount={tasks.length}
              activeTaskId={activeTaskId}
              highlightedTaskId={highlightedTaskId}
              loading={loading}
              ready={ready}
              error={error}
              search={search}
              onSearchChange={setSearch}
              onSelectTask={taskId => {
                startTransition(() => {
                  selectTask(taskId);
                });
              }}
              onRefresh={refreshCurrent}
              density="compact"
              className="h-full"
            />
          </aside>
        </Splitter.Panel>

        <Splitter.Panel
          defaultSize="56%"
          min="28%"
          style={{ overflow: "visible" }}
        >
          <div className="h-full min-h-0" />
        </Splitter.Panel>

        <Splitter.Panel
          defaultSize={0}
          min={320}
          max={460}
          resizable={false}
          collapsible={{ start: true, showCollapsibleIcon: true }}
          style={{ overflow: "hidden" }}
        >
          <aside className="min-h-0 h-full pl-2">
            <Tabs
              value={activeTab}
              onValueChange={value => setActiveTab(value as OfficeCockpitTab)}
              className={cn(
                "flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border p-2",
                sideShellClass
              )}
            >
              <TabsList className="grid h-auto w-full grid-cols-6 gap-1 overflow-hidden rounded-[14px] bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
                <TabsTrigger
                  className="min-h-[30px] rounded-[10px] border border-transparent px-1 py-0.5 text-[10px] font-semibold whitespace-nowrap text-stone-600 transition disabled:opacity-45 data-[state=active]:border-white/80 data-[state=active]:bg-[#fff8ef] data-[state=active]:text-stone-900 data-[state=active]:shadow-[0_10px_22px_rgba(184,111,69,0.14)]"
                  value="launch"
                >
                  {t(locale, "发起", "Launch")}
                </TabsTrigger>
                <TabsTrigger
                  className="min-h-[30px] rounded-[10px] border border-transparent px-1 py-0.5 text-[10px] font-semibold whitespace-nowrap text-stone-600 transition disabled:opacity-45 data-[state=active]:border-white/80 data-[state=active]:bg-[#fff8ef] data-[state=active]:text-stone-900 data-[state=active]:shadow-[0_10px_22px_rgba(184,111,69,0.14)]"
                  value="task"
                >
                  {t(locale, "任务", "Task")}
                </TabsTrigger>
                <TabsTrigger
                  className="min-h-[30px] rounded-[10px] border border-transparent px-1 py-0.5 text-[10px] font-semibold whitespace-nowrap text-stone-600 transition disabled:opacity-45 data-[state=active]:border-white/80 data-[state=active]:bg-[#fff8ef] data-[state=active]:text-stone-900 data-[state=active]:shadow-[0_10px_22px_rgba(184,111,69,0.14)]"
                  value="flow"
                  disabled={!availability.flow}
                >
                  {t(locale, "团队流", "Flow")}
                </TabsTrigger>
                <TabsTrigger
                  className="min-h-[30px] rounded-[10px] border border-transparent px-1 py-0.5 text-[10px] font-semibold whitespace-nowrap text-stone-600 transition disabled:opacity-45 data-[state=active]:border-white/80 data-[state=active]:bg-[#fff8ef] data-[state=active]:text-stone-900 data-[state=active]:shadow-[0_10px_22px_rgba(184,111,69,0.14)]"
                  value="agent"
                  disabled={!availability.agent}
                >
                  Agent
                </TabsTrigger>
                <TabsTrigger
                  className="min-h-[30px] rounded-[10px] border border-transparent px-1 py-0.5 text-[10px] font-semibold whitespace-nowrap text-stone-600 transition disabled:opacity-45 data-[state=active]:border-white/80 data-[state=active]:bg-[#fff8ef] data-[state=active]:text-stone-900 data-[state=active]:shadow-[0_10px_22px_rgba(184,111,69,0.14)]"
                  value="memory"
                  disabled={!availability.memory}
                >
                  {t(locale, "记忆", "Memory")}
                </TabsTrigger>
                <TabsTrigger
                  className="min-h-[30px] rounded-[10px] border border-transparent px-1 py-0.5 text-[10px] font-semibold whitespace-nowrap text-stone-600 transition disabled:opacity-45 data-[state=active]:border-white/80 data-[state=active]:bg-[#fff8ef] data-[state=active]:text-stone-900 data-[state=active]:shadow-[0_10px_22px_rgba(184,111,69,0.14)]"
                  value="history"
                  disabled={!availability.history}
                >
                  {t(locale, "历史", "History")}
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="launch"
                className="mt-2 h-full min-h-0 flex-1 overflow-hidden"
              >
                <CockpitContextShell
                  title={t(locale, "统一发起", "Unified launch")}
                  description={t(
                    locale,
                    "把任务输入、附件编排与补问链路并回右侧控制区，底部只保留轻量运行控制与证据 dock。",
                    "Pull task launch, attachment orchestration, and clarification back into the right control column while the bottom rail stays focused on lightweight controls and runtime evidence."
                  )}
                >
                  <div className="h-full overflow-y-auto pr-1">
                    <div className="space-y-3">
                      {hasActiveClarification && currentDialog ? (
                        <div className="rounded-[18px] border border-amber-200/80 bg-amber-50/78 p-3 shadow-[0_10px_24px_rgba(184,111,69,0.08)]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="workspace-status workspace-tone-warning !px-2 !py-1 !text-[10px] font-semibold">
                              {t(locale, "需要补充信息", "Clarification needed")}
                            </span>
                            <span className="text-[11px] text-stone-600">
                              {t(
                                locale,
                                "先补齐上下文，系统再继续创建任务。",
                                "Fill in the missing context and the system will continue creating the task."
                              )}
                            </span>
                          </div>

                          {clarificationExpanded ? (
                            <div className="mt-3">
                              <ClarificationPanel
                                dialog={currentDialog}
                                onAnswer={handleClarificationAnswer}
                                className="border-amber-200/80 bg-amber-50/70 shadow-none"
                              />
                            </div>
                          ) : null}

                          <div className="mt-3 flex justify-center">
                            <button
                              type="button"
                              className="inline-flex h-7 w-12 items-center justify-center rounded-full border border-stone-200/80 bg-white/94 text-[#9c6b47] shadow-[0_10px_24px_rgba(88,61,39,0.14)] backdrop-blur-md transition hover:bg-[#fff8f1] hover:text-[#5e8b72]"
                              aria-label={
                                clarificationExpanded
                                  ? t(
                                      locale,
                                      "收起补充信息",
                                      "Collapse clarification"
                                    )
                                  : t(
                                      locale,
                                      "展开补充信息",
                                      "Expand clarification"
                                    )
                              }
                              onClick={() =>
                                setClarificationExpanded(current => !current)
                              }
                            >
                              <ChevronDown
                                className={cn(
                                  "size-4 transition-transform",
                                  clarificationExpanded && "rotate-180"
                                )}
                              />
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <UnifiedLaunchComposer
                        createMission={createMission}
                        activeTaskTitle={selectedTaskSummary?.title}
                        activeTaskDetail={selectedDetail}
                        operatorActionLoading={
                          activeTaskId
                            ? (operatorActionLoadingByMissionId[activeTaskId] ??
                              {})
                            : {}
                        }
                        onSubmitOperatorAction={handleSubmitOperatorAction}
                        onTaskResolved={handleTaskHubResolved}
                        onWorkflowResolved={resolution => {
                          setPendingLaunch({
                            workflowId: resolution.workflowId,
                            directive: resolution.directive,
                            attachmentCount: resolution.attachmentCount,
                            requestedAt: resolution.requestedAt,
                            missionId: resolution.missionId,
                          });
                          setActiveTab("flow");
                        }}
                        compact
                        dense
                        hideClarificationPanel
                        className="w-full"
                      />
                    </div>
                  </div>
                </CockpitContextShell>
              </TabsContent>
              <TabsContent
                value="task"
                className="mt-2 h-full min-h-0 flex-1 overflow-hidden"
              >
                <TasksCockpitDetail
                  detail={selectedDetail}
                  decisionNote={decisionNote}
                  onDecisionNoteChange={value => {
                    if (!activeTaskId) return;
                    setDecisionNote(activeTaskId, value);
                  }}
                  onLaunchDecision={handleLaunchDecision}
                  launchingPresetId={launchingPresetId}
                  onSubmitOperatorAction={handleSubmitOperatorAction}
                  operatorActionLoading={
                    activeTaskId
                      ? (operatorActionLoadingByMissionId[activeTaskId] ?? {})
                      : {}
                  }
                  onDecisionSubmitted={refreshCurrent}
                  className="h-full"
                />
              </TabsContent>

              <TabsContent
                value="flow"
                className="mt-2 h-full min-h-0 flex-1 overflow-hidden"
              >
                <CockpitContextShell
                  title={t(locale, "团队流", "Flow")}
                  description={t(
                    locale,
                    "把 workflow 阶段、组织结构和附件上下文压进统一的右栏节奏里。",
                    "Keep workflow stages, org context, and attachments inside one shared right-panel shell."
                  )}
                >
                  <OfficeWorkflowFlowPanel
                    workflow={activeWorkflow}
                    missionDetail={selectedDetail}
                    onOpenTask={taskId => {
                      setActiveTab("task");
                      startTransition(() => {
                        selectTask(taskId);
                      });
                    }}
                  />
                </CockpitContextShell>
              </TabsContent>

              <TabsContent
                value="agent"
                className="mt-2 h-full min-h-0 flex-1 overflow-hidden"
              >
                <CockpitContextShell
                  title="Agent"
                  description={t(
                    locale,
                    "场景 Agent、团队站位和 heartbeat 报告都在同一个检视视图里联动。",
                    "Scene agents, org placement, and heartbeat reports stay linked in one inspector view."
                  )}
                >
                  {agents.length > 0 ? (
                    <OfficeAgentInspectorPanel className="h-full" embedded />
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[14px] border border-dashed border-stone-300/80 bg-white/62 px-3 py-4 text-center text-[11px] leading-5 text-stone-500">
                      {t(
                        locale,
                        "场景 Agent 建立后，这里会显示办公室 Agent 详情视图。",
                        "Once scene agents are available, this tab shows the office agent detail view."
                      )}
                    </div>
                  )}
                </CockpitContextShell>
              </TabsContent>

              <TabsContent
                value="memory"
                className="mt-2 h-full min-h-0 flex-1 overflow-hidden"
              >
                <CockpitContextShell
                  title={t(locale, "记忆与报告", "Memory and reports")}
                  description={t(
                    locale,
                    "最近记忆、搜索结果和 heartbeat 报告，共享同一个上下文壳层。",
                    "Recent memory, search results, and heartbeat reports share the same context shell."
                  )}
                >
                  <OfficeMemoryReportsPanel workflow={activeWorkflow} />
                </CockpitContextShell>
              </TabsContent>

              <TabsContent
                value="history"
                className="mt-2 h-full min-h-0 flex-1 overflow-hidden"
              >
                <CockpitContextShell
                  title={t(locale, "历史与兼容", "History and compatibility")}
                  description={t(
                    locale,
                    "保留 workflow 连续性和兼容入口，但不再抢首屏主轴。",
                    "Preserve workflow continuity and compatibility access without stealing the first-screen axis."
                  )}
                >
                  <OfficeWorkflowHistoryPanel
                    activeWorkflowId={activeWorkflow?.id || null}
                    onSelectWorkflow={workflowId => {
                      setCurrentWorkflow(workflowId);
                      const matched = workflows.find(
                        workflow => workflow.id === workflowId
                      );
                      if (matched?.missionId) {
                        startTransition(() => {
                          selectTask(matched.missionId!);
                        });
                      }
                      setActiveTab("flow");
                    }}
                  />
                </CockpitContextShell>
              </TabsContent>
            </Tabs>
          </aside>
        </Splitter.Panel>
      </Splitter>

      <div className="pointer-events-none absolute inset-0 z-20">
        <section className="pointer-events-none flex h-full min-h-0 flex-col justify-end px-2">
          {launchStage}
        </section>
      </div>

      <CreateMissionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreateMission}
      />
      {selectedDetail ? (
        <ArtifactPreviewDialog
          missionId={selectedDetail.id}
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
      ) : null}
    </div>
  );
}
