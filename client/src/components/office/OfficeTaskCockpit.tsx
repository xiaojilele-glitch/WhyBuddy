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
  ChevronDown,
  Copy,
  Ellipsis,
  Monitor,
  Plus,
  RefreshCw,
  Server,
  Settings2,
} from "lucide-react";
import { Splitter } from "antd";
import { toast } from "sonner";

import { UnifiedLaunchComposer } from "@/components/launch/UnifiedLaunchComposer";
import { ClarificationPanel } from "@/components/nl-command/ClarificationPanel";
import { CreateMissionDialog } from "@/components/tasks/CreateMissionDialog";
import { TasksCockpitDetail } from "@/components/tasks/TasksCockpitDetail";
import { TasksQueueRail } from "@/components/tasks/TasksQueueRail";
import {
  compactText,
  missionOperatorStateLabel,
  missionOperatorStateTone,
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
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { submitUnifiedClarification } from "@/lib/unified-launch-coordinator";
import { useWorkflowStore } from "@/lib/workflow-store";
import { resolveTaskHubLocationUpdate } from "@/pages/tasks/task-hub-location";

import { MissionFlowPane } from "./MissionFlowPane";
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
  const focusSignal =
    selectedDetail?.lastSignal ||
    selectedDetail?.waitingFor ||
    selectedDetail?.summary ||
    pendingLaunch?.directive ||
    t(
      locale,
      "点击左侧任务或场景 Agent，把当前执行焦点钉在办公室里。",
      "Pick a task or scene agent to focus the current scene."
    );
  const focusStage =
    selectedDetail?.currentStageLabel ||
    pendingWorkflow?.current_stage ||
    t(locale, "等待焦点", "Awaiting focus");
  const focusTone = pendingLaunch
    ? "warning"
    : selectedDetail?.status === "failed"
      ? "danger"
      : selectedDetail?.status === "done"
        ? "success"
        : selectedDetail
          ? "info"
          : "neutral";
  const focusStatusLabel = selectedDetail
    ? missionStatusLabel(selectedDetail.status, locale)
    : pendingLaunch
      ? t(locale, "团队准备中", "Team preparing")
      : t(locale, "场景待命", "Scene ready");
  const focusOperatorLabel = selectedDetail
    ? missionOperatorStateLabel(selectedDetail.operatorState, locale)
    : selectedPet
      ? t(locale, "Agent 已联动", "Agent linked")
      : t(locale, "等待联动", "Waiting for link");
  const focusProgress =
    selectedDetail?.progress ?? selectedTaskSummary?.progress ?? 0;
  const focusTitle =
    selectedDetail?.title ||
    pendingLaunch?.directive ||
    t(
      locale,
      "等待把执行焦点钉在场景里",
      "Waiting to pin an execution focus into the scene"
    );
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

  async function handleCopyFocusSummary() {
    const summary = [
      focusTitle,
      focusSignal,
      `${focusStage} / ${focusProgress}%`,
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

  const launcherDock = (
    <div
      className={cn(
        "pointer-events-auto mx-auto flex w-full max-w-[700px] min-h-0 flex-col overflow-hidden rounded-[14px] border",
        hasActiveClarification ? "shrink-0" : "max-h-[32%]",
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
              <DropdownMenuContent align="end" className="w-56">
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
              <DropdownMenuContent align="end" className="w-48">
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

        <div className="mt-1 flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-full border border-stone-200/80 bg-white/72 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              {t(locale, "焦点", "Focus")}
            </span>
            <div className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-tight text-stone-900">
              {focusTitle}
            </div>
            <div className="hidden max-w-[220px] shrink text-right text-[9px] leading-4 text-stone-600 xl:block">
              {compactText(focusSignal, 56)}
            </div>
          </div>

          <div className="flex flex-wrap gap-0.5">
            <span
              className={cn(
                "workspace-status !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold",
                `workspace-tone-${focusTone}`
              )}
            >
              {focusStatusLabel}
            </span>
            <span
              className={cn(
                "workspace-status !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold",
                selectedDetail
                  ? missionOperatorStateTone(selectedDetail.operatorState)
                  : "workspace-tone-neutral"
              )}
            >
              {focusOperatorLabel}
            </span>
            <span className="workspace-status workspace-tone-info !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold">
              {focusStage}
            </span>
            <span className="workspace-status workspace-tone-neutral !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold">
              {t(
                locale,
                `进度 ${focusProgress}%`,
                `Progress ${focusProgress}%`
              )}
            </span>
            <span
              className={cn(
                "workspace-status !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold",
                runningCount > 0
                  ? "workspace-tone-warning"
                  : "workspace-tone-neutral"
              )}
            >
              {t(
                locale,
                `队列 ${queuedCount} / 运行 ${runningCount}`,
                `Queue ${queuedCount} / running ${runningCount}`
              )}
            </span>
            <span
              className={cn(
                "workspace-status !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold",
                warningCount > 0
                  ? "workspace-tone-warning"
                  : "workspace-tone-info"
              )}
            >
              {t(
                locale,
                `等待 ${waitingCount} / 关注 ${warningCount}`,
                `Waiting ${waitingCount} / warnings ${warningCount}`
              )}
            </span>
            <span
              className={cn(
                "workspace-status !gap-0.5 !px-1 !py-0.5 !text-[8px] font-semibold",
                agents.length > 0
                  ? "workspace-tone-success"
                  : "workspace-tone-neutral"
              )}
            >
              {t(locale, `Agent ${agents.length}`, `Agents ${agents.length}`)}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <UnifiedLaunchComposer
          createMission={createMission}
          activeTaskTitle={selectedTaskSummary?.title}
          activeTaskDetail={selectedDetail}
          operatorActionLoading={
            activeTaskId
              ? (operatorActionLoadingByMissionId[activeTaskId] ?? {})
              : {}
          }
          onSubmitOperatorAction={handleSubmitOperatorAction}
          onTaskResolved={handleTaskHubResolved}
          compact
          bare
          dense
          hideHeader
          hideInputLabel
          hideClarificationPanel
          className="h-full"
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
        />
      </div>
    </div>
  );

  const launchStage =
    hasActiveClarification && currentDialog ? (
      <div className="pointer-events-none flex w-full items-end justify-center">
        <div className="pointer-events-none flex h-[clamp(380px,60vh,780px)] w-full max-w-[860px] min-h-0 flex-col items-center justify-end">
          <div
            className={cn(
              "pointer-events-none relative w-full min-h-0",
              clarificationExpanded ? "flex-1 pb-10" : "h-10 shrink-0"
            )}
          >
            {clarificationExpanded ? (
              <div className="pointer-events-auto flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/36 bg-[linear-gradient(180deg,rgba(255,252,248,0.72),rgba(246,238,229,0.62))] shadow-[0_18px_40px_rgba(98,73,48,0.14)] backdrop-blur-md">
                <div className="shrink-0 border-b border-stone-200/55 px-3 py-2">
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
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
                  <ClarificationPanel
                    dialog={currentDialog}
                    onAnswer={handleClarificationAnswer}
                    className="h-full border-amber-200/80 bg-amber-50/70 shadow-none"
                  />
                </div>
              </div>
            ) : null}

            <div className="pointer-events-auto absolute bottom-0 left-1/2 z-10 -translate-x-1/2">
              <button
                type="button"
                className="inline-flex h-7 w-12 items-center justify-center rounded-full border border-stone-200/80 bg-white/94 text-[#9c6b47] shadow-[0_10px_24px_rgba(88,61,39,0.14)] backdrop-blur-md transition hover:bg-[#fff8f1] hover:text-[#5e8b72]"
                aria-label={
                  clarificationExpanded
                    ? t(locale, "收起补充信息", "Collapse clarification")
                    : t(locale, "展开补充信息", "Expand clarification")
                }
                onClick={() => setClarificationExpanded(current => !current)}
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

          <div className="pointer-events-none flex w-full shrink-0 justify-center pt-2">
            {launcherDock}
          </div>
        </div>
      </div>
    ) : (
      launcherDock
    );

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 bottom-[24px] top-[76px] z-[52] flex min-h-0 flex-col gap-2.5 2xl:bottom-[28px]",
        className
      )}
    >
      <Splitter className="office-cockpit-splitter pointer-events-auto min-h-0 flex-1">
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
          <section className="pointer-events-none flex h-full min-h-0 flex-col gap-2 px-2">
            <MissionFlowPane
              locale={locale}
              detail={selectedDetail}
              summary={selectedTaskSummary}
              pendingDirective={pendingLaunch?.directive}
              pendingAttachmentCount={pendingLaunch?.attachmentCount ?? 0}
              className="min-h-0 flex-1"
            />

            <div className="shrink-0">{launchStage}</div>
          </section>
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
              <TabsList className="grid h-auto w-full grid-cols-5 gap-1 overflow-hidden rounded-[14px] bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
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

      <CreateMissionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={handleCreateMission}
      />
    </div>
  );
}
