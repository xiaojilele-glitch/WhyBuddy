import {
  createRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock3,
  FileText,
  Filter,
  FolderKanban,
  Grid2X2,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  UsersRound,
  Waves,
  X,
} from "lucide-react";
import { useLocation } from "wouter";

import { AppSidebar } from "@/components/AppSidebar";
import { ChatPanel } from "@/components/ChatPanel";
import { GitHubRepoBadge } from "@/components/GitHubRepoBadge";
import { UnifiedLaunchComposer } from "@/components/launch/UnifiedLaunchComposer";
import { LoadingScreen } from "@/components/LoadingScreen";
import { OfficeTaskCockpit } from "@/components/office/OfficeTaskCockpit";
import { AgentDetailDrawer } from "@/components/scene/AgentDetailDrawer";
import { OfficeNoticeBoard } from "@/components/scene/OfficeNoticeBoard";
import { Scene3D } from "@/components/Scene3D";
import { TelemetryDashboard } from "@/components/TelemetryDashboard";
import { UEOverlayChrome, type HUDDefinition } from "@/components/ue-overlay";
import { WorkflowPanel } from "@/components/WorkflowPanel";
import {
  AUTOPILOT_PATH,
  getProjectTaskPath,
  getProjectTasksPath,
} from "@/components/navigation-config";
import {
  useViewportResizeState,
  useViewportTier,
  useViewportWidth,
} from "@/hooks/useViewportTier";
import { useWorkflowRuntimeBootstrap } from "@/hooks/useWorkflowRuntimeBootstrap";
import { useI18n } from "@/i18n";
import { CAN_USE_ADVANCED_RUNTIME, IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { fetchJsonSafe } from "@/lib/api-client";
import {
  type ProjectArtifactType,
  type Project,
  useProjectStore,
} from "@/lib/project-store";
import { buildOfficeNoticeBoardSnapshot } from "@/lib/scene-agent-detail";
import { useAppStore } from "@/lib/store";
import { useTelemetryStore } from "@/lib/telemetry-store";
import { useTasksStore } from "@/lib/tasks-store";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/lib/workflow-store";

const HOME_DESKTOP_CHROME_CSS = `
.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 252, 255, 0.66) 58%, rgba(236, 249, 255, 0.36) 100%) !important;
  border-color: rgba(186, 230, 253, 0.48) !important;
  color: #334155 !important;
  box-shadow: 18px 0 58px rgba(14, 165, 233, 0.1), inset -1px 0 0 rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(30px) saturate(1.18);
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] * {
  color: inherit;
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] button {
  border-color: transparent;
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] button:hover {
  border-color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.54) !important;
  color: #0f172a !important;
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] button[aria-current="page"] {
  background: rgba(255, 255, 255, 0.86) !important;
  border-color: rgba(186, 230, 253, 0.82) !important;
  box-shadow: 0 18px 40px rgba(14, 165, 233, 0.18), 0 6px 18px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.96);
  color: #0f172a !important;
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] button[aria-current="page"] *,
.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] button[aria-current="page"] svg {
  color: inherit;
}

.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"] [data-sidebar-status-card="glass"] {
  background: rgba(255, 255, 255, 0.48) !important;
  border-color: rgba(255, 255, 255, 0.58) !important;
}

.home-first-screen-cockpit > .pointer-events-none.absolute.inset-0.z-20 > section {
  justify-content: center;
  padding-bottom: clamp(24px, 8vh, 96px);
}
`;

function formatMaterialSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function stripFileExtension(name: string) {
  return name.replace(/\.[^/.]+$/, "").trim();
}

function classifyMaterialArtifact(
  name: string,
  mimeType: string
): ProjectArtifactType {
  const normalizedName = name.toLowerCase();
  if (normalizedName.endsWith(".svg")) return "svg";
  if (mimeType.startsWith("image/")) return "screenshot";
  if (
    mimeType.includes("json") ||
    normalizedName.endsWith(".csv") ||
    normalizedName.endsWith(".json")
  ) {
    return "dataset";
  }
  if (
    normalizedName.endsWith(".ts") ||
    normalizedName.endsWith(".tsx") ||
    normalizedName.endsWith(".js") ||
    normalizedName.endsWith(".jsx") ||
    normalizedName.endsWith(".py")
  ) {
    return "code";
  }
  return "doc";
}

export interface HomeProps {
  projectId?: string;
  mode?: "project-space" | "autopilot";
}

interface ProjectEditDraft {
  id: string;
  name: string;
  summary: string;
}

interface ProjectCreateDraft {
  name: string;
  summary: string;
}

interface OptimizedProjectPrompt {
  name: string;
  summary: string;
}

interface ProjectDashboardMetric {
  label: string;
  value: number;
  helper: string;
  icon: typeof FolderKanban;
  tone: string;
}

interface ProjectDashboardStats {
  specs: number;
  routes: number;
  missions: number;
  evidence: number;
  openQuestions: number;
}

function getProjectProgress(project: Project, stats: ProjectDashboardStats) {
  if (project.status === "completed") return 100;
  if (project.status === "archived") return 0;
  const baseByStatus: Record<Project["status"], number> = {
    draft: 12,
    clarifying: 28,
    spec_ready: 48,
    planning: 62,
    executing: 76,
    paused: 58,
    completed: 100,
    archived: 0,
  };
  const evidenceBoost = Math.min(stats.evidence * 4, 12);
  const routeBoost = Math.min(stats.routes * 5, 10);
  return Math.min(
    100,
    baseByStatus[project.status] + evidenceBoost + routeBoost
  );
}

function formatAutopilotDuration(
  timestamp: number | string | null | undefined,
  isZh: boolean
) {
  const startedAt =
    typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
        ? new Date(timestamp).getTime()
        : Number.NaN;
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    return isZh ? "待启动" : "Pending";
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - startedAt) / 1000)
  );
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatAutopilotTokenCount(value: number, locale: string) {
  if (!Number.isFinite(value) || value <= 0) {
    return locale === "zh-CN" ? "待统计" : "Pending";
  }

  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function getAutopilotRiskLabel(
  riskLevel: string | null | undefined,
  isZh: boolean
) {
  if (!riskLevel || riskLevel === "unknown") return isZh ? "待评估" : "Pending";

  if (!isZh) {
    return riskLevel
      .replace(/_/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  const labels: Record<string, string> = {
    low: "低",
    medium: "中",
    high: "高",
  };
  return labels[riskLevel] ?? riskLevel;
}

function getAutopilotRiskTone(riskLevel: string | null | undefined) {
  switch (riskLevel) {
    case "high":
      return "border-rose-200/80 bg-rose-50/72 text-rose-700";
    case "medium":
      return "border-orange-200/80 bg-orange-50/74 text-orange-700";
    case "low":
      return "border-emerald-200/80 bg-emerald-50/74 text-emerald-700";
    default:
      return "border-white/42 bg-white/34 text-slate-600 backdrop-blur-xl";
  }
}

function getAutopilotMissionStatusLabel(
  status: string | null | undefined,
  isZh: boolean
) {
  if (!status) return isZh ? "待启动" : "Pending";
  if (!isZh) {
    return status
      .replace(/_/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  const labels: Record<string, string> = {
    queued: "排队中",
    running: "执行中",
    waiting: "等待决策",
    done: "已完成",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[status] ?? status;
}

function getDashboardStatusLabel(status: Project["status"], isZh: boolean) {
  if (!isZh) {
    return status
      .replace(/_/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  const labels: Record<Project["status"], string> = {
    draft: "草稿",
    clarifying: "澄清中",
    spec_ready: "规格就绪",
    planning: "规划中",
    executing: "进行中",
    paused: "待启动",
    completed: "已完成",
    archived: "已归档",
  };
  return labels[status];
}

function getDashboardStatusTone(status: Project["status"]) {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-emerald-600";
    case "executing":
    case "planning":
    case "spec_ready":
      return "bg-blue-50 text-blue-600";
    case "paused":
      return "bg-slate-100 text-slate-600";
    case "draft":
      return "bg-orange-50 text-orange-600";
    default:
      return "bg-rose-50 text-rose-600";
  }
}

function getDashboardProgressTone(status: Project["status"]) {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "paused":
    case "draft":
      return "bg-orange-500";
    case "executing":
      return "bg-indigo-500";
    case "planning":
    case "spec_ready":
      return "bg-blue-500";
    default:
      return "bg-slate-400";
  }
}

function parseOptimizedProjectPrompt(
  content: string
): OptimizedProjectPrompt | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const jsonText =
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? trimmed;
  const objectText =
    jsonText.match(/\{[\s\S]*\}/)?.[0]?.trim() ?? jsonText.trim();

  try {
    const parsed = JSON.parse(objectText) as Record<string, unknown>;
    const rawName = parsed.name ?? parsed.title ?? parsed.projectName;
    const rawSummary =
      parsed.summary ?? parsed.description ?? parsed.goal ?? parsed.prompt;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const summary = typeof rawSummary === "string" ? rawSummary.trim() : "";

    if (!name && !summary) return null;
    return { name, summary };
  } catch {
    return null;
  }
}

export default function Home({
  projectId,
  mode = "project-space",
}: HomeProps = {}) {
  const isSceneReady = useAppStore(state => state.isSceneReady);
  const hydrateAIConfig = useAppStore(state => state.hydrateAIConfig);
  const runtimeMode = useAppStore(state => state.runtimeMode);
  const setRuntimeMode = useAppStore(state => state.setRuntimeMode);
  const locale = useAppStore(state => state.locale);
  const toggleLocale = useAppStore(state => state.toggleLocale);
  const toggleConfig = useAppStore(state => state.toggleConfig);
  const selectedPet = useAppStore(state => state.selectedPet);
  const setSelectedPet = useAppStore(state => state.setSelectedPet);
  const fetchTelemetry = useTelemetryStore(state => state.fetchInitial);
  const telemetrySnapshot = useTelemetryStore(state => state.snapshot);
  const ensureProjectsReady = useProjectStore(state => state.ensureReady);
  const projects = useProjectStore(state => state.projects);
  const createProject = useProjectStore(state => state.createProject);
  const selectProject = useProjectStore(state => state.selectProject);
  const updateProject = useProjectStore(state => state.updateProject);
  const archiveProject = useProjectStore(state => state.archiveProject);
  const addProjectArtifact = useProjectStore(state => state.addProjectArtifact);
  const currentProjectId = useProjectStore(state => state.currentProjectId);
  const projectSpecs = useProjectStore(state => state.specs);
  const projectRoutes = useProjectStore(state => state.routes);
  const projectMissions = useProjectStore(state => state.missions);
  const projectEvidence = useProjectStore(state => state.evidence);
  const projectClarificationQuestions = useProjectStore(
    state => state.clarificationQuestions
  );
  const visibleProjects = useMemo(
    () => projects.filter(project => project.status !== "archived"),
    [projects]
  );
  const projectCount = visibleProjects.length;
  const routeProject = useMemo(
    () =>
      projectId
        ? (visibleProjects.find(project => project.id === projectId) ?? null)
        : null,
    [projectId, visibleProjects]
  );
  const storedProject = useMemo(
    () =>
      currentProjectId
        ? (visibleProjects.find(project => project.id === currentProjectId) ??
          null)
        : null,
    [currentProjectId, visibleProjects]
  );
  const currentProject =
    mode === "autopilot" ? (routeProject ?? storedProject) : routeProject;
  const isProjectHub = mode !== "autopilot" || !currentProject;
  const ensureTasksReady = useTasksStore(state => state.ensureReady);
  const createMission = useTasksStore(state => state.createMission);
  const missionTasks = useTasksStore(state => state.tasks);
  const missionDetailsById = useTasksStore(state => state.detailsById);
  const selectedTaskId = useTasksStore(state => state.selectedTaskId);
  const selectTask = useTasksStore(state => state.selectTask);
  const agents = useWorkflowStore(state => state.agents);
  const workflows = useWorkflowStore(state => state.workflows);
  const heartbeatStatuses = useWorkflowStore(state => state.heartbeatStatuses);
  const disconnectSocket = useWorkflowStore(state => state.disconnectSocket);
  const toggleWorkflowPanel = useWorkflowStore(
    state => state.toggleWorkflowPanel
  );
  const openWorkflowPanel = useWorkflowStore(state => state.openWorkflowPanel);
  const { isMobile } = useViewportTier();
  const viewportWidth = useViewportWidth();
  const resizeActive = useViewportResizeState();
  const { copy } = useI18n();
  const [, setLocation] = useLocation();
  const ueVideoRef = useMemo(() => createRef<HTMLVideoElement>(), []);
  const materialInputRef = useRef<HTMLInputElement>(null);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [editingProject, setEditingProject] = useState<ProjectEditDraft | null>(
    null
  );
  const [newProjectDraft, setNewProjectDraft] =
    useState<ProjectCreateDraft | null>(null);
  const [isOptimizingProjectPrompt, setIsOptimizingProjectPrompt] =
    useState(false);
  const [projectPromptOptimizeError, setProjectPromptOptimizeError] = useState<
    string | null
  >(null);
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<
    string | null
  >(null);
  const [autopilotDetailDrawerOpen, setAutopilotDetailDrawerOpen] =
    useState(false);

  useWorkflowRuntimeBootstrap({
    heartbeatReportLimit: 18,
    deferSecondary: true,
  });

  useEffect(() => {
    hydrateAIConfig().catch(error => {
      console.error("[Home] Failed to load AI config:", error);
    });
  }, [hydrateAIConfig]);

  useEffect(() => {
    if (runtimeMode === "frontend") {
      disconnectSocket();
    }
  }, [disconnectSocket, runtimeMode]);

  useEffect(() => {
    if (isSceneReady && runtimeMode === "advanced") {
      fetchTelemetry();
    }
  }, [fetchTelemetry, isSceneReady, runtimeMode]);

  useEffect(() => {
    ensureProjectsReady();
  }, [ensureProjectsReady]);

  useEffect(() => {
    if (projectId && routeProject && currentProjectId !== routeProject.id) {
      selectProject(routeProject.id);
    }
  }, [currentProjectId, projectId, routeProject, selectProject]);

  useEffect(() => {
    ensureTasksReady().catch(error => {
      console.warn("[Home] Failed to hydrate mission summaries:", error);
    });
  }, [ensureTasksReady]);

  useEffect(() => {
    setAutopilotDetailDrawerOpen(false);
  }, [currentProject?.id]);

  const activeWorkflows =
    missionTasks.length > 0
      ? missionTasks.filter(
          task => task.status === "running" || task.status === "waiting"
        ).length
      : workflows.filter(
          workflow =>
            workflow.status === "running" || workflow.status === "pending"
        ).length;

  const noticeBoardSnapshot = useMemo(() => {
    if (!isMobile) return null;

    return buildOfficeNoticeBoardSnapshot({
      locale,
      runtimeMode,
      missionTasks,
      missionDetailsById,
      workflows,
      heartbeatStatuses,
      totalTokens:
        (telemetrySnapshot?.totalTokensIn ?? 0) +
        (telemetrySnapshot?.totalTokensOut ?? 0),
      totalCost: telemetrySnapshot?.totalCost ?? 0,
    });
  }, [
    heartbeatStatuses,
    isMobile,
    locale,
    missionDetailsById,
    missionTasks,
    runtimeMode,
    telemetrySnapshot,
    workflows,
  ]);

  const openProjectTaskCenter = useCallback(() => {
    setLocation(getProjectTasksPath(currentProject?.id ?? null));
  }, [currentProject?.id, setLocation]);
  const isZh = locale === "zh-CN";
  const fullWorkbenchLabel = isZh ? "接管任务" : "Take over";
  const workflowLabel = isZh ? "查看日志" : "View logs";
  const configLabel = isZh ? "运行配置" : "Runtime config";
  const frontendModeLabel = isZh ? "前端模式" : "Frontend";
  const advancedModeLabel = isZh ? "高级模式" : "Advanced";
  const officeNavLabel = isZh ? "自动驾驶" : "Autopilot";
  const projectSpaceLabel = isZh ? "项目空间" : "Project Space";
  const autopilotLabel = isZh ? "自动驾驶" : "Autopilot";
  const openAutopilotLabel = isZh ? "进入自动驾驶" : "Open Autopilot";
  const projectHubTitle = projectSpaceLabel;
  const projectHubSubtitle = isZh
    ? "先在项目空间新建或选择项目，点击项目卡片后进入这个项目自己的自动驾驶。后续澄清、Spec、路线、执行和证据都会绑定在这个项目里。"
    : "Create or choose a project in Project Space. Open a project card to enter its Autopilot, where clarification, specs, routes, missions, and evidence stay scoped to that project.";
  const projectBundleStats = useMemo(() => {
    if (!currentProject) {
      return { specs: 0, routes: 0, missions: 0, evidence: 0 };
    }

    const projectId = currentProject.id;

    return {
      specs: projectSpecs.filter(item => item.projectId === projectId).length,
      routes: projectRoutes.filter(item => item.projectId === projectId).length,
      missions: projectMissions.filter(item => item.projectId === projectId)
        .length,
      evidence: projectEvidence.filter(item => item.projectId === projectId)
        .length,
    };
  }, [
    currentProject,
    projectEvidence,
    projectMissions,
    projectRoutes,
    projectSpecs,
  ]);
  const getProjectStats = useCallback(
    (project: Project) => ({
      specs: projectSpecs.filter(item => item.projectId === project.id).length,
      routes: projectRoutes.filter(item => item.projectId === project.id)
        .length,
      missions: projectMissions.filter(item => item.projectId === project.id)
        .length,
      evidence: projectEvidence.filter(item => item.projectId === project.id)
        .length,
      openQuestions: projectClarificationQuestions.filter(
        item =>
          item.projectId === project.id && !item.answeredAt && !item.skippedAt
      ).length,
    }),
    [
      projectClarificationQuestions,
      projectEvidence,
      projectMissions,
      projectRoutes,
      projectSpecs,
    ]
  );
  const currentProjectSpec = useMemo(() => {
    if (!currentProject) return null;
    if (currentProject.currentSpecId) {
      return (
        projectSpecs.find(spec => spec.id === currentProject.currentSpecId) ??
        null
      );
    }
    return (
      projectSpecs
        .filter(
          spec =>
            spec.projectId === currentProject.id && spec.status !== "superseded"
        )
        .slice()
        .sort((a, b) => b.version - a.version)[0] ?? null
    );
  }, [currentProject, projectSpecs]);
  const currentProjectRouteCards = useMemo(() => {
    if (!currentProject) return [];
    const routes = projectRoutes.filter(
      route => route.projectId === currentProject.id
    );
    const currentRouteId = currentProject.currentRouteId;

    return routes
      .slice()
      .sort((a, b) => {
        const aCurrent =
          (currentRouteId && a.id === currentRouteId) || Boolean(a.selectedAt);
        const bCurrent =
          (currentRouteId && b.id === currentRouteId) || Boolean(b.selectedAt);
        if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
        return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      })
      .slice(0, 3);
  }, [currentProject, projectRoutes]);
  const projectClarificationProgress = useMemo(() => {
    if (!currentProject) {
      return {
        total: 0,
        answered: 0,
        skipped: 0,
        open: 0,
        requiredOpen: 0,
        skippableOpen: 0,
        openSummary: "No active project.",
      };
    }

    const questions = projectClarificationQuestions.filter(
      question => question.projectId === currentProject.id
    );
    const openQuestions = questions.filter(
      question => !question.answeredAt && !question.skippedAt
    );

    return {
      total: questions.length,
      answered: questions.filter(question => question.answeredAt).length,
      skipped: questions.filter(question => question.skippedAt).length,
      open: openQuestions.length,
      requiredOpen: openQuestions.filter(question => question.required).length,
      skippableOpen: openQuestions.filter(
        question => !question.required || Boolean(question.defaultAssumption)
      ).length,
      openSummary:
        openQuestions[0]?.text ??
        (questions.length
          ? "All clarification questions captured."
          : "No clarification questions yet."),
    };
  }, [currentProject, projectClarificationQuestions]);
  const projectStageInsight = useMemo(() => {
    if (!currentProject) {
      return {
        title: isZh ? "先创建项目" : "Create a project first",
        description: isZh
          ? "选择模板、导入资料，或直接在输入框描述目标。"
          : "Use a template, import materials, or describe the goal in the input.",
        nextAction: isZh
          ? "创建 / 导入 / 输入目标"
          : "Create / import / describe",
        activeStep: 0,
      };
    }

    switch (currentProject.status) {
      case "draft":
      case "clarifying":
        return {
          title: isZh ? "澄清目标与边界" : "Clarify goal and boundaries",
          description: isZh
            ? "补齐用户、权限、成功标准、约束和交付物，先把项目说清楚。"
            : "Fill in users, permissions, success criteria, constraints, and deliverables before execution.",
          nextAction: isZh ? "继续问答 / 补全信息" : "Continue Q&A",
          activeStep: 1,
        };
      case "spec_ready":
        return {
          title: isZh
            ? "检查 Spec 并准备路线"
            : "Review spec and prepare routes",
          description: isZh
            ? "先确认当前 Spec 是否可执行，再锁定主路线、保守路线或深度路线。"
            : "Confirm the current spec is executable, then lock the main, conservative, or deep route.",
          nextAction: isZh ? "选择执行路线" : "Choose execution route",
          activeStep: 2,
        };
      case "planning":
        return {
          title: isZh ? "选择 FSD 执行路径" : "Select the FSD route",
          description: isZh
            ? "锁定本轮执行路径，确认风险边界、接管点和首个执行步骤。"
            : "Lock this run's route, risk boundary, takeover points, and first execution step.",
          nextAction: isZh ? "确认路线 / 准备执行" : "Confirm route",
          activeStep: 3,
        };
      case "executing":
        return {
          title: isZh
            ? "监控执行与接管点"
            : "Monitor execution and takeover points",
          description: isZh
            ? "观察当前 Agent、执行步骤、阻塞信号和需要人工接管的节点。"
            : "Watch the current agent, execution step, blockers, and takeover points.",
          nextAction: isZh ? "查看执行明细" : "Open execution details",
          activeStep: 4,
        };
      case "paused":
        return {
          title: isZh ? "等待接管决策" : "Waiting for takeover",
          description: isZh
            ? "项目暂停在人工确认点，先处理阻塞、决策或补充说明。"
            : "The project is paused at a human decision point; resolve blockers or add guidance.",
          nextAction: isZh ? "接管任务" : "Take over",
          activeStep: 4,
        };
      case "completed":
        return {
          title: isZh ? "复盘证据与产物" : "Review evidence and artifacts",
          description: isZh
            ? "检查最终产物、执行日志和证据轨迹，确认是否需要补跑或归档。"
            : "Review final artifacts, execution logs, and evidence before rerun or archive.",
          nextAction: isZh ? "查看证据回放" : "Review evidence",
          activeStep: 5,
        };
      default:
        return {
          title: isZh ? "项目已归档" : "Project archived",
          description: isZh
            ? "这个项目已归档，返回项目空间后可以查看或重新打开项目。"
            : "This project is archived; return to Project Space to review or reopen it.",
          nextAction: isZh ? "返回项目空间" : "Return to Project Space",
          activeStep: 5,
        };
    }
  }, [currentProject, isZh]);
  const projectAutopilotMissions = useMemo(() => {
    if (!currentProject) return [];
    return projectMissions.filter(item => item.projectId === currentProject.id);
  }, [currentProject, projectMissions]);
  const currentAutopilotTask = useMemo(() => {
    const linkedMissionIds = new Set(
      projectAutopilotMissions.map(mission => mission.missionId)
    );
    const projectTasks = missionTasks.filter(task =>
      linkedMissionIds.has(task.id)
    );
    if (selectedTaskId && linkedMissionIds.has(selectedTaskId)) {
      return (
        projectTasks.find(task => task.id === selectedTaskId) ??
        missionTasks.find(task => task.id === selectedTaskId) ??
        null
      );
    }

    return (
      projectTasks.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    );
  }, [missionTasks, projectAutopilotMissions, selectedTaskId]);
  const handleOpenCurrentMission = currentAutopilotTask
    ? () => {
        selectTask(currentAutopilotTask.id);
        setLocation(
          getProjectTaskPath(currentProject?.id ?? null, currentAutopilotTask.id)
        );
      }
    : undefined;
  const currentAutopilotDetail = currentAutopilotTask
    ? (missionDetailsById[currentAutopilotTask.id] ?? null)
    : null;
  const currentAutopilotSummary =
    currentAutopilotDetail?.autopilotSummary ??
    currentAutopilotTask?.autopilotSummary ??
    null;
  const currentAutopilotRiskLevel =
    currentAutopilotSummary?.driveState.riskLevel ??
    currentProjectRouteCards[0]?.riskLevel ??
    null;
  const currentAutopilotAgent =
    currentAutopilotSummary?.fleet.roles.find(role =>
      ["running", "waiting", "blocked"].includes(role.status)
    ) ??
    currentAutopilotSummary?.fleet.roles[0] ??
    null;
  const currentAutopilotWaitingForUser =
    currentAutopilotSummary?.takeover.required ||
    currentAutopilotSummary?.driveState.waitingForUser ||
    currentAutopilotTask?.status === "waiting" ||
    projectClarificationProgress.open > 0;
  const currentAutopilotDecisionText =
    currentAutopilotSummary?.takeover.prompt ||
    currentAutopilotTask?.waitingFor ||
    projectClarificationProgress.openSummary;
  const currentAutopilotUnderstandsText =
    currentAutopilotSummary?.explanation.current ||
    currentAutopilotSummary?.destination.goal ||
    currentProjectSpec?.title ||
    currentProject?.summary ||
    currentProject?.goal ||
    "";
  const currentAutopilotNextText =
    currentAutopilotSummary?.explanation.nextSteps?.[0] ||
    currentAutopilotSummary?.execution.currentStepLabel ||
    currentAutopilotSummary?.route.currentStageLabel ||
    projectStageInsight.description;
  const currentAutopilotStatusLabel =
    currentAutopilotSummary?.driveState.label ||
    (currentAutopilotTask
      ? getAutopilotMissionStatusLabel(currentAutopilotTask.status, isZh)
      : projectStageInsight.nextAction);
  const currentAutopilotStepLabel =
    currentAutopilotSummary?.execution.currentStepLabel ||
    currentAutopilotSummary?.route.currentStageLabel ||
    currentAutopilotTask?.currentStageLabel ||
    projectStageInsight.title;
  const currentAutopilotElapsedLabel = formatAutopilotDuration(
    currentAutopilotTask?.startedAt ??
      currentAutopilotTask?.createdAt ??
      currentProject?.updatedAt,
    isZh
  );
  const currentAutopilotTokenLabel = formatAutopilotTokenCount(
    (telemetrySnapshot?.totalTokensIn ?? 0) +
      (telemetrySnapshot?.totalTokensOut ?? 0),
    locale
  );
  const currentAutopilotRiskLabel = getAutopilotRiskLabel(
    currentAutopilotRiskLevel,
    isZh
  );
  const currentAutopilotRouteLabel =
    currentAutopilotSummary?.route.selected?.label ||
    currentAutopilotSummary?.route.label ||
    currentProjectRouteCards[0]?.title ||
    (isZh ? "路线待规划" : "Route pending");
  const currentAutopilotArtifactLabel = isZh
    ? `产物 ${currentAutopilotSummary?.evidence.artifactCount ?? projectBundleStats.evidence}`
    : `Artifacts ${currentAutopilotSummary?.evidence.artifactCount ?? projectBundleStats.evidence}`;
  const currentAutopilotWorkflowLabel =
    typeof copy.home.workflowChip === "function"
      ? copy.home.workflowChip(activeWorkflows)
      : `Active workflows: ${activeWorkflows}`;
  const currentAutopilotFocusCards = [
    {
      label: isZh ? "需要你确认" : "Needs Your Decision",
      value: currentAutopilotWaitingForUser
        ? currentAutopilotDecisionText
        : isZh
          ? "当前没有阻塞决策，可继续自动推进。"
          : "No blocking decision right now; autopilot can continue.",
      tone: currentAutopilotWaitingForUser
        ? "border-orange-200/80 bg-orange-50/76 text-orange-800"
        : "border-emerald-200/80 bg-emerald-50/76 text-emerald-800",
    },
    {
      label: isZh ? "AI 已理解" : "AI Understands",
      value: currentAutopilotUnderstandsText,
      tone: "border-white/70 bg-white/62 text-slate-700",
    },
    {
      label: isZh ? "下一步" : "Next Step",
      value: currentAutopilotNextText,
      tone: "border-sky-200/80 bg-sky-50/72 text-sky-800",
    },
  ];
  const projectSearchPlaceholder = isZh
    ? "搜索项目名称、目标或描述"
    : "Search projects by name, goal, or summary";
  const filteredProjects = useMemo(() => {
    const query = projectSearchQuery.trim().toLowerCase();
    if (!query) return visibleProjects;

    return visibleProjects.filter(project =>
      [project.name, project.goal, project.summary ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [projectSearchQuery, visibleProjects]);
  const projectDashboardMetrics = useMemo<ProjectDashboardMetric[]>(
    () => [
      {
        label: isZh ? "项目总数" : "Total Projects",
        value: projectCount,
        helper: isZh
          ? `活跃 ${visibleProjects.filter(project => project.status !== "completed").length}`
          : `${visibleProjects.filter(project => project.status !== "completed").length} active`,
        icon: FolderKanban,
        tone: "from-indigo-500 to-blue-500",
      },
      {
        label: isZh ? "进行中" : "In Progress",
        value: visibleProjects.filter(project =>
          ["clarifying", "spec_ready", "planning", "executing"].includes(
            project.status
          )
        ).length,
        helper: isZh ? "正在推进" : "Moving now",
        icon: Waves,
        tone: "from-blue-500 to-sky-500",
      },
      {
        label: isZh ? "已完成" : "Completed",
        value: visibleProjects.filter(project => project.status === "completed")
          .length,
        helper: isZh
          ? `证据 ${projectEvidence.length}`
          : `${projectEvidence.length} evidence`,
        icon: CheckCircle2,
        tone: "from-emerald-500 to-teal-500",
      },
      {
        label: isZh ? "风险项" : "At Risk",
        value:
          visibleProjects.filter(project =>
            ["draft", "paused"].includes(project.status)
          ).length +
          projectClarificationQuestions.filter(
            item => !item.answeredAt && !item.skippedAt && item.required
          ).length,
        helper: isZh ? "需要关注" : "Need attention",
        icon: AlertTriangle,
        tone: "from-rose-500 to-orange-500",
      },
    ],
    [
      isZh,
      projectClarificationQuestions,
      projectCount,
      projectEvidence.length,
      visibleProjects,
    ]
  );
  const projectActivityItems = useMemo(
    () =>
      visibleProjects
        .slice()
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .slice(0, 5)
        .map((project, index) => ({
          id: project.id,
          title: project.name,
          description: isZh
            ? `更新了 ${getDashboardStatusLabel(project.status, true)} 状态`
            : `Updated ${getDashboardStatusLabel(project.status, false)} status`,
          time: new Date(project.updatedAt).toLocaleDateString(),
          tone:
            index % 4 === 0
              ? "bg-blue-500"
              : index % 4 === 1
                ? "bg-emerald-500"
                : index % 4 === 2
                  ? "bg-violet-500"
                  : "bg-rose-500",
        })),
    [isZh, visibleProjects]
  );
  const teamLoadItems = useMemo(
    () => [
      {
        name: isZh ? "规划" : "Planning",
        value: Math.min(100, projectRoutes.length * 12 + 24),
        color: "bg-rose-500",
      },
      {
        name: isZh ? "执行" : "Execution",
        value: Math.min(100, projectMissions.length * 10 + 28),
        color: "bg-orange-500",
      },
      {
        name: isZh ? "规格" : "Specs",
        value: Math.min(100, projectSpecs.length * 14 + 20),
        color: "bg-blue-500",
      },
      {
        name: isZh ? "证据" : "Evidence",
        value: Math.min(100, projectEvidence.length * 12 + 18),
        color: "bg-emerald-500",
      },
    ],
    [
      isZh,
      projectEvidence.length,
      projectMissions.length,
      projectRoutes.length,
      projectSpecs.length,
    ]
  );
  const priorityItems = useMemo(
    () =>
      visibleProjects
        .filter(project => project.status !== "completed")
        .slice(0, 4)
        .map(project => ({
          id: project.id,
          name: project.name,
          priority:
            project.status === "paused" || project.status === "draft"
              ? isZh
                ? "高"
                : "High"
              : project.status === "executing"
                ? isZh
                  ? "中"
                  : "Medium"
                : isZh
                  ? "低"
                  : "Low",
        })),
    [isZh, visibleProjects]
  );
  const handleCreateProjectFromTemplate = useCallback(() => {
    setNewProjectDraft({ name: "", summary: "" });
    setProjectPromptOptimizeError(null);
    setEditingProject(null);
    setConfirmDeleteProjectId(null);
    setProjectSearchQuery("");
    setLocation("/projects");
  }, [setLocation]);
  const handleOpenAutopilotProject = useCallback(
    (project: Project) => {
      selectProject(project.id);
      setLocation(AUTOPILOT_PATH);
    },
    [selectProject, setLocation]
  );
  const handleCancelNewProject = useCallback(() => {
    setNewProjectDraft(null);
    setProjectPromptOptimizeError(null);
  }, []);
  const handleOptimizeProjectPrompt = useCallback(async () => {
    if (!newProjectDraft || isOptimizingProjectPrompt) return;

    const rawName = newProjectDraft.name.trim();
    const rawSummary = newProjectDraft.summary.trim();
    if (!rawName && !rawSummary) {
      setProjectPromptOptimizeError(
        isZh ? "先输入一点项目想法再优化。" : "Add a project idea first."
      );
      return;
    }

    setIsOptimizingProjectPrompt(true);
    setProjectPromptOptimizeError(null);

    const languageHint = isZh ? "Simplified Chinese" : "English";
    const messages = [
      {
        role: "system" as const,
        content: [
          "You are a senior product and project-planning prompt editor.",
          "Rewrite the user's rough project idea into a clearer project creation prompt.",
          "Return only valid JSON with exactly two string fields: name and summary.",
          "The name should be concise, specific, and suitable as a project card title.",
          "The summary should describe goal, scope, key constraints, and expected output in 1-2 sentences.",
          `Write the JSON values in ${languageHint}.`,
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: JSON.stringify(
          {
            currentName: rawName,
            currentSummary: rawSummary,
            target: {
              name: isZh ? "项目名称" : "project name",
              summary: isZh ? "项目目标描述" : "project goal description",
            },
          },
          null,
          2
        ),
      },
    ];

    try {
      const result = await fetchJsonSafe<{ content?: string }>("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          maxTokens: 360,
          temperature: 0.35,
        }),
      });

      if (!result.ok) {
        throw new Error(result.error.message || result.error.detail);
      }

      const optimized = parseOptimizedProjectPrompt(result.data.content ?? "");
      if (!optimized) {
        throw new Error(
          isZh
            ? "LLM 没有返回可解析的优化结果。"
            : "The LLM did not return a usable optimization."
        );
      }

      setNewProjectDraft(current =>
        current
          ? {
              name: optimized.name || current.name,
              summary: optimized.summary || current.summary,
            }
          : current
      );
    } catch (error) {
      setProjectPromptOptimizeError(
        error instanceof Error
          ? error.message
          : isZh
            ? "优化失败，请稍后重试。"
            : "Optimization failed. Please retry."
      );
    } finally {
      setIsOptimizingProjectPrompt(false);
    }
  }, [isOptimizingProjectPrompt, isZh, newProjectDraft]);
  const handleSaveNewProject = useCallback(() => {
    if (!newProjectDraft) return;
    const name = newProjectDraft.name.trim();
    const summary = newProjectDraft.summary.trim();
    if (!name) return;

    const project = createProject({
      name,
      goal: summary || name,
      summary: summary || undefined,
      status: "draft",
    });
    setNewProjectDraft(null);
    selectProject(project.id);
    setLocation(AUTOPILOT_PATH);
  }, [createProject, newProjectDraft, selectProject, setLocation]);
  const handleNewProjectKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        handleSaveNewProject();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancelNewProject();
      }
    },
    [handleCancelNewProject, handleSaveNewProject]
  );
  const handleImportMaterials = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      if (files.length === 0) return;

      const fileNames = files.map(file => file.name);
      const firstName = stripFileExtension(fileNames[0] ?? "");
      const project = createProject({
        name:
          files.length === 1
            ? firstName || (isZh ? "资料导入项目" : "Imported materials")
            : isZh
              ? `资料导入项目 (${files.length})`
              : `Imported materials (${files.length})`,
        goal: isZh
          ? "整理导入资料，澄清目标，并演化成项目 spec"
          : "Organize imported materials, clarify the goal, and evolve them into a project spec",
        summary: isZh
          ? `已导入 ${files.length} 个资料文件，下一步会先做资料归纳与补问。`
          : `${files.length} material file${files.length === 1 ? "" : "s"} imported; next step is summarization and clarification.`,
        status: "clarifying",
      });

      files.slice(0, 24).forEach(file => {
        addProjectArtifact({
          projectId: project.id,
          type: classifyMaterialArtifact(file.name, file.type),
          title: file.name,
          contentPreview: `${formatMaterialSize(file.size)} · ${
            file.type || "unknown type"
          }`,
        });
      });

      selectProject(project.id);
      setLocation(AUTOPILOT_PATH);
      event.currentTarget.value = "";
    },
    [addProjectArtifact, createProject, isZh, selectProject, setLocation]
  );
  const handleStartEditProject = useCallback((project: Project) => {
    setEditingProject({
      id: project.id,
      name: project.name,
      summary: project.summary || project.goal,
    });
    setConfirmDeleteProjectId(null);
  }, []);
  const handleCancelEditProject = useCallback(() => {
    setEditingProject(null);
  }, []);
  const handleSaveProjectEdit = useCallback(() => {
    if (!editingProject) return;
    const name = editingProject.name.trim();
    const summary = editingProject.summary.trim();
    if (!name) return;

    updateProject(editingProject.id, {
      name,
      summary: summary || undefined,
    });
    setEditingProject(null);
  }, [editingProject, updateProject]);
  const handleDeleteProject = useCallback(
    (project: Project) => {
      if (confirmDeleteProjectId !== project.id) {
        setConfirmDeleteProjectId(project.id);
        setEditingProject(current =>
          current?.id === project.id ? null : current
        );
        return;
      }

      archiveProject(project.id);
      if (currentProjectId === project.id) {
        selectProject(null);
      }
      setConfirmDeleteProjectId(null);
      setEditingProject(current =>
        current?.id === project.id ? null : current
      );
    },
    [archiveProject, confirmDeleteProjectId, currentProjectId, selectProject]
  );

  const localeLabel =
    locale === "zh-CN" ? copy.common.englishShort : copy.common.chineseShort;
  const scenePerformanceProfile =
    resizeActive && !isMobile ? "resizing" : "balanced";
  const desktopSidebarWidth = isMobile ? 0 : viewportWidth >= 1280 ? 248 : 64;
  const sceneLayer = (
    <Scene3D
      performanceProfile={scenePerformanceProfile}
      sidebarWidth={desktopSidebarWidth}
      projectId={currentProject?.id ?? null}
    />
  );
  const hudDefinitions: HUDDefinition[] = useMemo(
    () =>
      agents.slice(0, 8).flatMap(agent => [
        {
          id: `${agent.id}-name`,
          type: "nameTag",
          characterId: agent.id,
          data: { name: agent.name },
        },
        {
          id: `${agent.id}-status`,
          type: "statusIcon",
          characterId: agent.id,
          data: {
            icon: agent.status === "idle" ? "o" : "*",
            status: agent.status,
          },
        },
      ]),
    [agents]
  );
  const desktopGlassClass = resizeActive
    ? "border-slate-200/90 bg-[hsl(var(--background))]/96 shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
    : "border-white/64 bg-[rgba(248,250,252,0.78)] shadow-[0_10px_28px_rgba(15,23,42,0.08)] backdrop-blur";
  const utilityChipClass = resizeActive
    ? "border-slate-200/90 bg-[hsl(var(--background))]/96 shadow-[0_8px_20px_rgba(15,23,42,0.06)]"
    : "border-white/68 bg-[rgba(248,250,252,0.82)] shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur";
  // whybuddy-rebrand-and-stage3-unblock-2026-05-28 §D.2: project hub surfaces
  // adopt the MiroFish skin — flat white bg, 1px solid #E5E5E5 border, no
  // gradient, no shadow. Existing data-testid hooks are preserved so layout
  // and snapshot tests still match.
  const projectHubSurfaceClass =
    "border border-[#E5E5E5] bg-white rounded-[2px]";
  const projectHubControlClass =
    "border border-[#E5E5E5] bg-white rounded-[2px]";
  const projectHubInputClass =
    "border border-[#E5E5E5] bg-white rounded-[2px]";
  const desktopProjectHubDashboard =
    !isMobile && isProjectHub ? (
      <div
        className="pointer-events-auto absolute inset-0 z-[58] overflow-y-auto bg-slate-50/28 pl-[calc(var(--sidebar-width,248px)+28px)] pr-8 pt-7 text-slate-950 backdrop-blur-[3px]"
        data-testid="home-project-hub"
      >
        <div className="mx-auto grid min-h-full max-w-[1660px] auto-rows-max grid-cols-[minmax(0,1fr)_300px] content-start items-start gap-5 pb-10">
          <header className="col-span-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-950">
                {projectHubTitle}
              </h1>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                {isZh
                  ? "管理和跟踪所有项目进度，确保团队高效协作"
                  : "Manage and track every project so the team can move cleanly."}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
              <label className="relative w-[420px] max-w-[42vw]">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={projectSearchQuery}
                  onChange={event =>
                    setProjectSearchQuery(event.currentTarget.value)
                  }
                  placeholder={projectSearchPlaceholder}
                  disabled={visibleProjects.length === 0}
                  className={cn(
                    "h-11 w-full rounded-xl border pl-11 pr-10 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60",
                    projectHubInputClass
                  )}
                  data-testid="home-project-search"
                />
                {projectSearchQuery ? (
                  <button
                    type="button"
                    onClick={() => setProjectSearchQuery("")}
                    className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label={isZh ? "清空搜索" : "Clear search"}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </label>
              <button
                type="button"
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black text-slate-700 transition hover:border-indigo-200 hover:bg-white/78 hover:text-indigo-600",
                  projectHubControlClass
                )}
              >
                <Filter className="h-4 w-4" />
                {isZh ? "筛选" : "Filter"}
              </button>
              <button
                type="button"
                className={cn(
                  "relative inline-flex h-11 w-11 items-center justify-center rounded-xl border text-slate-600 transition hover:bg-white/78 hover:text-slate-900",
                  projectHubControlClass
                )}
                aria-label={isZh ? "通知" : "Notifications"}
              >
                <Bell className="h-5 w-5" />
                <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                  {Math.min(99, projectClarificationQuestions.length || 1)}
                </span>
              </button>
              <input
                ref={materialInputRef}
                type="file"
                multiple
                className="sr-only"
                aria-label={isZh ? "导入项目资料" : "Import project materials"}
                onChange={handleImportMaterials}
              />
              <button
                type="button"
                onClick={() => handleCreateProjectFromTemplate()}
                aria-label={isZh ? "新建项目" : "New Project"}
                data-testid="home-project-create-button"
                className="inline-flex h-11 items-center gap-2 rounded-[2px] bg-[#FF4500] px-5 text-sm font-bold text-white transition hover:bg-[#e63e00]"
              >
                <Plus className="h-4 w-4" />
                {isZh ? "新建项目" : "New Project"}
              </button>
            </div>
          </header>

          <main className="min-w-0">
            <section className="mt-8 grid grid-cols-4 gap-5">
              {projectDashboardMetrics.map(metric => {
                const Icon = metric.icon;
                return (
                  <div
                    key={metric.label}
                    className={cn(
                      "rounded-2xl border p-5",
                      projectHubSurfaceClass
                    )}
                    data-testid="home-project-metric-card"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          "flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-lg",
                          metric.tone
                        )}
                      >
                        <Icon className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-500">
                          {metric.label}
                        </p>
                        <p className="mt-1 text-3xl font-black leading-none text-slate-950">
                          {metric.value}
                        </p>
                        <p className="mt-2 text-xs font-bold text-slate-500">
                          {metric.helper}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="mt-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-black text-slate-950">
                  {isZh ? "全部项目" : "All Projects"}
                </h2>
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "inline-flex rounded-xl border p-1",
                      projectHubControlClass
                    )}
                  >
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"
                      aria-label={isZh ? "网格视图" : "Grid view"}
                    >
                      <Grid2X2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500"
                      aria-label={isZh ? "列表视图" : "List view"}
                    >
                      <List className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-bold text-slate-700 transition hover:bg-white/78 hover:text-slate-950",
                      projectHubControlClass
                    )}
                  >
                    {isZh ? "默认排序" : "Default Sort"}
                    <ArrowRight className="h-4 w-4 rotate-90" />
                  </button>
                </div>
              </div>

              {newProjectDraft || visibleProjects.length > 0 ? (
                newProjectDraft || filteredProjects.length > 0 ? (
                  <div className="grid grid-cols-3 gap-5">
                    {newProjectDraft ? (
                      <article
                        className={cn(
                          "flex min-h-[196px] flex-col rounded-2xl border border-dashed p-4",
                          projectHubSurfaceClass
                        )}
                        data-testid="home-project-create-card"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md">
                            <Plus className="h-[18px] w-[18px]" />
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleOptimizeProjectPrompt}
                              disabled={isOptimizingProjectPrompt}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-100 bg-white/58 px-2.5 text-xs font-black text-indigo-600 shadow-sm backdrop-blur transition hover:bg-white/82 disabled:cursor-wait disabled:opacity-60"
                              aria-label={
                                isZh
                                  ? "调用 LLM 优化提示词"
                                  : "Optimize prompt with LLM"
                              }
                              data-testid="home-project-optimize-prompt"
                            >
                              <Sparkles
                                className={cn(
                                  "h-3.5 w-3.5",
                                  isOptimizingProjectPrompt && "animate-spin"
                                )}
                              />
                              {isOptimizingProjectPrompt
                                ? isZh
                                  ? "优化中"
                                  : "Optimizing"
                                : isZh
                                  ? "优化提示词"
                                  : "Optimize"}
                            </button>
                            <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-600">
                              {isZh ? "新建中" : "New"}
                            </span>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2">
                          <input
                            value={newProjectDraft.name}
                            onChange={event => {
                              const value = event.currentTarget.value;
                              setProjectPromptOptimizeError(null);
                              setNewProjectDraft(current =>
                                current
                                  ? {
                                      ...current,
                                      name: value,
                                    }
                                  : current
                              );
                            }}
                            onKeyDown={handleNewProjectKeyDown}
                            autoFocus
                            placeholder={isZh ? "输入项目名称" : "Project name"}
                            className={cn(
                              "h-10 rounded-xl border px-3 text-sm font-black text-slate-950 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100",
                              projectHubInputClass
                            )}
                            data-testid="home-project-create-name"
                          />
                          <textarea
                            value={newProjectDraft.summary}
                            onChange={event => {
                              const value = event.currentTarget.value;
                              setProjectPromptOptimizeError(null);
                              setNewProjectDraft(current =>
                                current
                                  ? {
                                      ...current,
                                      summary: value,
                                    }
                                  : current
                              );
                            }}
                            onKeyDown={handleNewProjectKeyDown}
                            rows={3}
                            placeholder={
                              isZh
                                ? "输入项目描述或目标"
                                : "Project description or goal"
                            }
                            className={cn(
                              "min-h-20 resize-none rounded-xl border px-3 py-2 text-sm font-semibold leading-5 text-slate-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100",
                              projectHubInputClass
                            )}
                            data-testid="home-project-create-summary"
                          />
                          {projectPromptOptimizeError ? (
                            <p
                              className="text-xs font-bold leading-5 text-rose-500"
                              data-testid="home-project-optimize-error"
                            >
                              {projectPromptOptimizeError}
                            </p>
                          ) : null}
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={handleCancelNewProject}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/72 bg-white/46 text-slate-500 backdrop-blur transition hover:bg-white/70 hover:text-slate-900"
                              aria-label={
                                isZh ? "取消新建项目" : "Cancel new project"
                              }
                            >
                              <X className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveNewProject}
                              disabled={
                                newProjectDraft.name.trim().length === 0
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                              aria-label={
                                isZh ? "保存新项目" : "Save new project"
                              }
                              data-testid="home-project-create-save"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </article>
                    ) : null}
                    {filteredProjects.map((project, index) => {
                      const stats = getProjectStats(project);
                      const progress = getProjectProgress(project, stats);
                      const isEditing = editingProject?.id === project.id;
                      const isConfirmingDelete =
                        confirmDeleteProjectId === project.id;
                      const accent =
                        index % 4 === 0
                          ? "from-indigo-500 to-violet-500"
                          : index % 4 === 1
                            ? "from-blue-500 to-sky-500"
                            : index % 4 === 2
                              ? "from-emerald-500 to-teal-500"
                              : "from-orange-500 to-rose-500";

                      return (
                        <article
                          key={project.id}
                          className={cn(
                            "flex min-h-[196px] flex-col rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:bg-white/72 hover:shadow-[0_24px_54px_rgba(15,23,42,0.14)]",
                            projectHubSurfaceClass
                          )}
                          data-testid="home-project-card"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <div
                                className={cn(
                                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md",
                                  accent
                                )}
                              >
                                <FolderKanban className="h-[18px] w-[18px]" />
                              </div>
                              {isEditing && editingProject ? null : (
                                <h3
                                  className="min-w-0 flex-1 truncate text-base font-black text-slate-950"
                                  data-testid="home-project-card-title"
                                >
                                  {project.name}
                                </h3>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "rounded-lg px-2.5 py-1 text-xs font-black",
                                  getDashboardStatusTone(project.status)
                                )}
                              >
                                {getDashboardStatusLabel(project.status, isZh)}
                              </span>
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                aria-label={isZh ? "更多" : "More"}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          {isEditing && editingProject ? (
                            <div className="mt-4 grid gap-2">
                              <input
                                value={editingProject.name}
                                onChange={event => {
                                  const value = event.currentTarget.value;
                                  setEditingProject(current =>
                                    current?.id === project.id
                                      ? {
                                          ...current,
                                          name: value,
                                        }
                                      : current
                                  );
                                }}
                                className={cn(
                                  "h-10 rounded-xl border px-3 text-sm font-black text-slate-950 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100",
                                  projectHubInputClass
                                )}
                                data-testid="home-project-edit-name"
                              />
                              <textarea
                                value={editingProject.summary}
                                onChange={event => {
                                  const value = event.currentTarget.value;
                                  setEditingProject(current =>
                                    current?.id === project.id
                                      ? {
                                          ...current,
                                          summary: value,
                                        }
                                      : current
                                  );
                                }}
                                rows={3}
                                className={cn(
                                  "min-h-20 resize-none rounded-xl border px-3 py-2 text-sm font-semibold leading-5 text-slate-700 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100",
                                  projectHubInputClass
                                )}
                                data-testid="home-project-edit-summary"
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={handleCancelEditProject}
                                  className="rounded-lg border border-white/72 bg-white/46 px-3 py-1.5 text-xs font-black text-slate-600 backdrop-blur transition hover:bg-white/70"
                                >
                                  {isZh ? "取消" : "Cancel"}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleSaveProjectEdit}
                                  disabled={
                                    editingProject.name.trim().length === 0
                                  }
                                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white disabled:bg-slate-300"
                                  data-testid="home-project-save"
                                >
                                  {isZh ? "保存" : "Save"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="mt-4 line-clamp-2 h-8 max-h-8 overflow-hidden break-words text-xs font-semibold leading-4 text-slate-500">
                                {project.summary || project.goal}
                              </p>
                              <div className="mt-4">
                                <div className="mb-2 flex items-center justify-between text-xs font-black text-slate-500">
                                  <span>{isZh ? "项目进度" : "Progress"}</span>
                                  <span>{progress}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-white/56 shadow-inner">
                                  <div
                                    className={cn(
                                      "h-full rounded-full",
                                      getDashboardProgressTone(project.status)
                                    )}
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                              </div>
                              <div className="mt-3 flex items-center justify-between text-xs font-bold text-slate-500">
                                <span>
                                  {isZh ? "截止日期：" : "Updated: "}{" "}
                                  {new Date(
                                    project.updatedAt
                                  ).toLocaleDateString()}
                                </span>
                                <div className="flex -space-x-2">
                                  {[0, 1, 2].map(member => (
                                    <span
                                      key={member}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white/80 bg-white/62 text-[9px] font-black text-slate-600 backdrop-blur"
                                    >
                                      {["A", "B", "C"][member]}
                                    </span>
                                  ))}
                                  {stats.missions > 0 ? (
                                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white/80 bg-white/56 px-1 text-[9px] font-black text-slate-500 backdrop-blur">
                                      +{stats.missions}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="mt-auto flex items-center justify-between border-t border-white/56 pt-4 text-xs font-bold text-slate-500">
                                <div className="flex items-center gap-3">
                                  <span className="inline-flex items-center gap-1">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    {stats.openQuestions}
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <FileText className="h-3.5 w-3.5" />
                                    {stats.specs}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-rose-500">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    {project.status === "paused" ||
                                    project.status === "draft"
                                      ? 1
                                      : 0}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleStartEditProject(project)
                                    }
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/68 hover:text-indigo-600"
                                    data-testid="home-project-edit"
                                    aria-label={
                                      isZh ? "编辑项目" : "Edit project"
                                    }
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteProject(project)}
                                    className={cn(
                                      "inline-flex h-8 items-center justify-center rounded-full px-2 text-[11px] font-black",
                                      isConfirmingDelete
                                        ? "bg-rose-50 text-rose-600"
                                        : "text-slate-500 hover:bg-white/68 hover:text-rose-600"
                                    )}
                                    data-testid="home-project-delete"
                                  >
                                    {isConfirmingDelete ? (
                                      isZh ? (
                                        "确认"
                                      ) : (
                                        "Confirm"
                                      )
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenAutopilotProject(project)
                                    }
                                    className="rounded-full bg-slate-950 px-3 py-1.5 text-[11px] font-black text-white hover:bg-indigo-600"
                                  >
                                    {openAutopilotLabel}
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className={cn(
                      "rounded-2xl border border-dashed px-6 py-12 text-center",
                      projectHubSurfaceClass
                    )}
                    data-testid="home-project-search-empty"
                  >
                    <Search className="mx-auto h-10 w-10 text-indigo-500" />
                    <h2 className="mt-3 text-xl font-black text-slate-950">
                      {isZh ? "没有匹配项目" : "No matching projects"}
                    </h2>
                    <p className="mt-2 text-sm font-semibold text-slate-500">
                      {isZh
                        ? "换一个关键词，或清空搜索后查看全部项目。"
                        : "Try another keyword, or clear the search to show every project."}
                    </p>
                  </div>
                )
              ) : (
                <div
                  className={cn(
                    "rounded-2xl border border-dashed px-6 py-12 text-center",
                    projectHubSurfaceClass
                  )}
                >
                  <FolderKanban className="mx-auto h-10 w-10 text-indigo-500" />
                  <h2 className="mt-3 text-xl font-black text-slate-950">
                    {isZh ? "还没有项目" : "No projects yet"}
                  </h2>
                  <p className="mx-auto mt-2 max-w-lg text-sm font-semibold leading-6 text-slate-500">
                    {isZh
                      ? "创建一个项目后，后续操作都会绑定在它里面。"
                      : "Create one project first; later work will stay scoped to it."}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleCreateProjectFromTemplate()}
                    aria-label={isZh ? "新建项目" : "New Project"}
                    data-testid="home-project-empty-create-button"
                    className="mt-5 inline-flex items-center gap-2 rounded-[2px] bg-[#FF4500] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#e63e00]"
                  >
                    <Plus className="h-4 w-4" />
                    {isZh ? "新建项目" : "New Project"}
                  </button>
                </div>
              )}
            </section>
          </main>

          <aside className="grid content-start gap-5">
            <section
              className={cn("rounded-2xl border p-5", projectHubSurfaceClass)}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-black text-slate-950">
                  {isZh ? "最近动态" : "Recent Activity"}
                </h2>
                <button
                  type="button"
                  className="text-xs font-black text-indigo-500"
                >
                  {isZh ? "查看全部" : "View all"}
                </button>
              </div>
              <div className="grid gap-4">
                {projectActivityItems.length > 0 ? (
                  projectActivityItems.map(item => (
                    <div key={item.id} className="flex gap-3">
                      <span
                        className={cn(
                          "mt-1 h-5 w-5 shrink-0 rounded-full",
                          item.tone
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-800">
                          {item.title}
                        </p>
                        <p className="text-xs font-semibold leading-5 text-slate-500">
                          {item.description}
                        </p>
                        <p className="text-xs font-bold text-slate-400">
                          {item.time}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm font-semibold text-slate-500">
                    {isZh ? "暂无动态" : "No activity yet"}
                  </p>
                )}
              </div>
            </section>

            <section
              className={cn("rounded-2xl border p-5", projectHubSurfaceClass)}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-black text-slate-950">
                  {isZh ? "团队负载" : "Team Load"}
                </h2>
                <span className="rounded-lg border border-white/72 bg-white/46 px-2 py-1 text-xs font-black text-slate-500 backdrop-blur">
                  {isZh ? "本周" : "This Week"}
                </span>
              </div>
              <div className="grid gap-3">
                {teamLoadItems.map(item => (
                  <div key={item.name}>
                    <div className="mb-1 flex items-center justify-between text-xs font-black text-slate-600">
                      <span>{item.name}</span>
                      <span>{item.value}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/56 shadow-inner">
                      <div
                        className={cn("h-full rounded-full", item.color)}
                        style={{ width: `${item.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section
              className={cn("rounded-2xl border p-5", projectHubSurfaceClass)}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-black text-slate-950">
                  {isZh ? "优先事项" : "Priorities"}
                </h2>
                <UsersRound className="h-4 w-4 text-slate-400" />
              </div>
              <div className="grid gap-3">
                {priorityItems.length > 0 ? (
                  priorityItems.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-4 w-4 rounded-full border border-slate-300" />
                        <span className="truncate text-sm font-bold text-slate-600">
                          {item.name}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "text-xs font-black",
                          item.priority === "高" || item.priority === "High"
                            ? "text-rose-500"
                            : item.priority === "中" ||
                                item.priority === "Medium"
                              ? "text-orange-500"
                              : "text-blue-500"
                        )}
                      >
                        {item.priority}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm font-semibold text-slate-500">
                    {isZh ? "暂无待办优先项" : "No priority items"}
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    ) : null;

  return (
    <div className="relative h-[100svh] w-screen overflow-hidden bg-[linear-gradient(180deg,#eef6fb_0%,#f7fbfd_48%,#e5f1f4_100%)]">
      <style>{HOME_DESKTOP_CHROME_CSS}</style>
      {isMobile ? (
        sceneLayer
      ) : (
        <UEOverlayChrome
          videoElement={ueVideoRef}
          mediaLayer={sceneLayer}
          hudDefinitions={hudDefinitions}
          viewportWidth={viewportWidth}
          overlayTone="clear"
          backgroundClassName="bg-[linear-gradient(180deg,#eef6fb_0%,#f7fbfd_48%,#e5f1f4_100%)]"
          sidebar={
            <div className="home-desktop-sidebar-shell h-full">
              <AppSidebar
                collapsed={viewportWidth < 1280}
                onToggleCollapse={() => undefined}
                embedded
              />
            </div>
          }
        >
          {isSceneReady ? (
            <div className="home-desktop-workspace relative h-full min-h-0">
              {desktopProjectHubDashboard}
              <div
                className={cn(
                  "absolute inset-x-0 top-0 z-[60] px-3 py-2 xl:px-4",
                  isProjectHub && "hidden"
                )}
                data-testid="home-desktop-toolbar"
                style={{ pointerEvents: "auto" }}
              >
                <div className="relative flex items-center justify-between gap-2">
                  <div
                    className="pointer-events-none fixed left-1/2 top-3 z-[70] flex -translate-x-1/2 justify-center"
                    data-testid="home-desktop-center-controls"
                  >
                    <div className="pointer-events-auto flex items-center gap-2">
                      <div
                        className={cn(
                          "flex items-center gap-1 rounded-[16px] border p-0.5",
                          desktopGlassClass
                        )}
                      >
                        <button
                          onClick={() => void setRuntimeMode("frontend")}
                          className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                            runtimeMode === "frontend"
                              ? "bg-sky-50 text-slate-950 shadow-sm"
                              : "text-slate-500 hover:text-slate-950"
                          }`}
                        >
                          {frontendModeLabel}
                        </button>
                        {CAN_USE_ADVANCED_RUNTIME && (
                          <button
                            onClick={() => void setRuntimeMode("advanced")}
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                              runtimeMode === "advanced"
                                ? "bg-[#0f766e] text-white shadow-sm"
                                : "text-slate-500 hover:text-slate-950"
                            }`}
                          >
                            {advancedModeLabel}
                          </button>
                        )}
                      </div>

                      <div
                        className={cn(
                          "rounded-[16px] border p-0.5",
                          desktopGlassClass
                        )}
                      >
                        <span className="block rounded-full bg-[#0f766e] px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
                          {officeNavLabel}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={toggleLocale}
                        className={cn(
                          "rounded-[16px] border px-3 py-[7px] text-[11px] font-semibold text-slate-500 transition-colors hover:bg-white hover:text-slate-950",
                          desktopGlassClass
                        )}
                        title={copy.app.localeSwitch}
                      >
                        {localeLabel}
                      </button>
                    </div>
                  </div>

                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={openProjectTaskCenter}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950",
                        utilityChipClass
                      )}
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      {fullWorkbenchLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => openWorkflowPanel()}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950",
                        utilityChipClass
                      )}
                    >
                      <Waves className="h-3.5 w-3.5" />
                      {workflowLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleConfig()}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950",
                        utilityChipClass
                      )}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      {configLabel}
                    </button>
                    {IS_GITHUB_PAGES && <GitHubRepoBadge />}
                  </div>
                </div>
              </div>

              {false && isProjectHub ? (
                <div
                  className="pointer-events-none fixed inset-y-[clamp(86px,10vh,118px)] left-[max(288px,calc(var(--sidebar-width,248px)+34px))] right-8 z-[58] flex items-start justify-center"
                  data-testid="home-project-hub"
                >
                  <div className="pointer-events-auto flex max-h-full w-full max-w-[1180px] flex-col rounded-[28px] border border-white/72 bg-white/72 p-5 text-left shadow-[0_24px_70px_rgba(15,23,42,0.16)] backdrop-blur-xl">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="max-w-2xl">
                        <div className="inline-flex items-center gap-2 rounded-full border border-[#0f766e]/15 bg-[#0f766e]/8 px-3 py-1 text-[11px] font-black text-[#0f766e]">
                          <FolderKanban className="h-3.5 w-3.5" />
                          {projectSpaceLabel}
                        </div>
                        <h1 className="mt-3 text-3xl font-black leading-tight text-slate-950 2xl:text-4xl">
                          {projectHubTitle}
                        </h1>
                        <p className="mt-2 max-w-[720px] text-sm font-semibold leading-6 text-slate-600 2xl:text-base">
                          {projectHubSubtitle}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          ref={materialInputRef}
                          type="file"
                          multiple
                          className="sr-only"
                          aria-label={
                            isZh ? "导入项目资料" : "Import project materials"
                          }
                          onChange={handleImportMaterials}
                        />
                        <button
                          type="button"
                          onClick={() => materialInputRef.current?.click()}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/86 px-3.5 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:bg-white hover:text-slate-950"
                        >
                          <Upload className="h-4 w-4 text-[#0f766e]" />
                          {isZh ? "导入资料建项目" : "Import materials"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-4 gap-2 text-xs font-black text-slate-600">
                      <div className="rounded-2xl border border-white/72 bg-white/70 px-3 py-2">
                        <span className="text-slate-400">
                          {isZh ? "项目" : "Projects"}
                        </span>
                        <strong className="ml-2 text-slate-950">
                          {projectCount}
                        </strong>
                      </div>
                      <div className="rounded-2xl border border-white/72 bg-white/70 px-3 py-2">
                        <span className="text-slate-400">Specs</span>
                        <strong className="ml-2 text-slate-950">
                          {projectSpecs.length}
                        </strong>
                      </div>
                      <div className="rounded-2xl border border-white/72 bg-white/70 px-3 py-2">
                        <span className="text-slate-400">Missions</span>
                        <strong className="ml-2 text-slate-950">
                          {projectMissions.length}
                        </strong>
                      </div>
                      <div className="rounded-2xl border border-white/72 bg-white/70 px-3 py-2">
                        <span className="text-slate-400">Evidence</span>
                        <strong className="ml-2 text-slate-950">
                          {projectEvidence.length}
                        </strong>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <label className="relative min-w-[260px] flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          type="search"
                          value={projectSearchQuery}
                          onChange={event =>
                            setProjectSearchQuery(event.currentTarget.value)
                          }
                          placeholder={projectSearchPlaceholder}
                          disabled={visibleProjects.length === 0}
                          className="h-10 w-full rounded-2xl border border-white/80 bg-white/82 pl-9 pr-10 text-sm font-semibold text-slate-800 outline-none shadow-sm transition placeholder:text-slate-400 focus:border-[#0f766e]/35 focus:ring-2 focus:ring-[#0f766e]/12 disabled:cursor-not-allowed disabled:opacity-60"
                          data-testid="home-project-search"
                        />
                        {projectSearchQuery ? (
                          <button
                            type="button"
                            onClick={() => setProjectSearchQuery("")}
                            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            aria-label={isZh ? "清空搜索" : "Clear search"}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </label>
                      <div className="rounded-full border border-white/76 bg-white/72 px-3 py-2 text-[11px] font-black text-slate-500 shadow-sm">
                        {isZh ? "匹配" : "Showing"}{" "}
                        <span className="text-slate-950">
                          {filteredProjects.length}
                        </span>{" "}
                        / {projectCount}
                      </div>
                    </div>

                    <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
                      {visibleProjects.length > 0 ? (
                        filteredProjects.length > 0 ? (
                          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
                            {filteredProjects.map(project => {
                              const stats = getProjectStats(project);
                              const isActive = project.id === currentProjectId;
                              const isEditing =
                                editingProject?.id === project.id;
                              const isConfirmingDelete =
                                confirmDeleteProjectId === project.id;
                              const editLabel = isZh ? "编辑" : "Edit";
                              const deleteLabel = isConfirmingDelete
                                ? isZh
                                  ? "确认删除"
                                  : "Confirm"
                                : isZh
                                  ? "删除"
                                  : "Delete";
                              return (
                                <article
                                  key={project.id}
                                  className={cn(
                                    "group flex min-h-[238px] flex-col rounded-[22px] border bg-white/82 p-4 text-left shadow-[0_14px_34px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_22px_46px_rgba(15,23,42,0.12)]",
                                    isActive
                                      ? "border-[#0f766e]/45 ring-2 ring-[#0f766e]/12"
                                      : "border-white/76"
                                  )}
                                  data-testid="home-project-card"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0f766e]/10 text-[#0f766e]">
                                      <FolderKanban className="h-5 w-5" />
                                    </div>
                                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                                      <span
                                        className={cn(
                                          "rounded-full px-2.5 py-1 text-[10px] font-black",
                                          project.status === "clarifying"
                                            ? "bg-amber-100 text-amber-700"
                                            : project.status === "executing"
                                              ? "bg-blue-100 text-blue-700"
                                              : "bg-[#0f766e]/10 text-[#0f766e]"
                                        )}
                                      >
                                        {project.status.replace(/_/g, " ")}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleStartEditProject(project)
                                        }
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200/80 bg-white/86 text-slate-500 shadow-sm transition hover:border-[#0f766e]/25 hover:text-[#0f766e]"
                                        aria-label={`${editLabel} ${project.name}`}
                                        data-testid="home-project-edit"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleDeleteProject(project)
                                        }
                                        className={cn(
                                          "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[10px] font-black shadow-sm transition",
                                          isConfirmingDelete
                                            ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                                            : "border-slate-200/80 bg-white/86 text-slate-500 hover:border-rose-200 hover:text-rose-700"
                                        )}
                                        aria-label={`${deleteLabel} ${project.name}`}
                                        data-testid="home-project-delete"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        <span>{deleteLabel}</span>
                                      </button>
                                    </div>
                                  </div>
                                  {isEditing && editingProject ? (
                                    <div className="mt-4 flex flex-1 flex-col gap-2">
                                      <input
                                        value={editingProject.name}
                                        onChange={event => {
                                          const value =
                                            event.currentTarget.value;
                                          setEditingProject(current =>
                                            current?.id === project.id
                                              ? {
                                                  ...current,
                                                  name: value,
                                                }
                                              : current
                                          );
                                        }}
                                        className="h-10 rounded-2xl border border-slate-200/80 bg-white px-3 text-sm font-black text-slate-950 outline-none transition focus:border-[#0f766e]/35 focus:ring-2 focus:ring-[#0f766e]/12"
                                        aria-label={
                                          isZh ? "项目名称" : "Project name"
                                        }
                                        data-testid="home-project-edit-name"
                                      />
                                      <textarea
                                        value={editingProject.summary}
                                        onChange={event => {
                                          const value =
                                            event.currentTarget.value;
                                          setEditingProject(current =>
                                            current?.id === project.id
                                              ? {
                                                  ...current,
                                                  summary: value,
                                                }
                                              : current
                                          );
                                        }}
                                        rows={3}
                                        className="min-h-20 resize-none rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-sm font-semibold leading-5 text-slate-700 outline-none transition focus:border-[#0f766e]/35 focus:ring-2 focus:ring-[#0f766e]/12"
                                        aria-label={
                                          isZh ? "项目描述" : "Project summary"
                                        }
                                        data-testid="home-project-edit-summary"
                                      />
                                      <div className="mt-auto flex items-center justify-end gap-2 pt-2">
                                        <button
                                          type="button"
                                          onClick={handleCancelEditProject}
                                          className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-white hover:text-slate-950"
                                        >
                                          {isZh ? "取消" : "Cancel"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={handleSaveProjectEdit}
                                          disabled={
                                            editingProject.name.trim()
                                              .length === 0
                                          }
                                          className="inline-flex items-center gap-1 rounded-full bg-[#0f766e] px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-[#115e59] disabled:cursor-not-allowed disabled:bg-slate-300"
                                          data-testid="home-project-save"
                                        >
                                          {isZh ? "保存" : "Save"}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <h2 className="mt-4 line-clamp-1 text-xl font-black text-slate-950">
                                        {project.name}
                                      </h2>
                                      <p className="mt-2 line-clamp-2 h-10 max-h-10 overflow-hidden break-words text-sm font-semibold leading-5 text-slate-600">
                                        {project.summary || project.goal}
                                      </p>
                                      <div className="mt-4 grid grid-cols-4 gap-1.5 text-center text-[10px] font-black text-slate-500">
                                        <span className="rounded-xl bg-slate-50 px-2 py-2">
                                          <FileText className="mx-auto mb-1 h-3.5 w-3.5 text-slate-400" />
                                          {stats.specs}
                                        </span>
                                        <span className="rounded-xl bg-slate-50 px-2 py-2">
                                          <Sparkles className="mx-auto mb-1 h-3.5 w-3.5 text-slate-400" />
                                          {stats.routes}
                                        </span>
                                        <span className="rounded-xl bg-slate-50 px-2 py-2">
                                          <Clock3 className="mx-auto mb-1 h-3.5 w-3.5 text-slate-400" />
                                          {stats.openQuestions}
                                        </span>
                                        <span className="rounded-xl bg-slate-50 px-2 py-2">
                                          <CheckCircle2 className="mx-auto mb-1 h-3.5 w-3.5 text-slate-400" />
                                          {stats.evidence}
                                        </span>
                                      </div>
                                      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                                        <span className="min-w-0 truncate text-[11px] font-bold text-slate-400">
                                          {isZh ? "更新于" : "Updated"}{" "}
                                          {new Date(
                                            project.updatedAt
                                          ).toLocaleDateString()}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleOpenAutopilotProject(project)
                                          }
                                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#0f766e] px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-[#115e59]"
                                        >
                                          {openAutopilotLabel}
                                          <ArrowRight className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        ) : (
                          <div
                            className="rounded-[22px] border border-dashed border-slate-200 bg-white/68 px-5 py-8 text-center"
                            data-testid="home-project-search-empty"
                          >
                            <Search className="mx-auto h-10 w-10 text-[#0f766e]" />
                            <h2 className="mt-3 text-xl font-black text-slate-950">
                              {isZh ? "没有匹配项目" : "No matching projects"}
                            </h2>
                            <p className="mx-auto mt-2 max-w-lg text-sm font-semibold leading-6 text-slate-600">
                              {isZh
                                ? "换一个关键词，或清空搜索后查看全部项目。"
                                : "Try another keyword, or clear the search to show every project."}
                            </p>
                            <button
                              type="button"
                              onClick={() => setProjectSearchQuery("")}
                              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#0f766e] px-3.5 py-2 text-xs font-black text-white transition hover:bg-[#115e59]"
                            >
                              <X className="h-3.5 w-3.5" />
                              {isZh ? "清空搜索" : "Clear search"}
                            </button>
                          </div>
                        )
                      ) : (
                        <div className="rounded-[22px] border border-dashed border-slate-200 bg-white/68 px-5 py-8 text-center">
                          <FolderKanban className="mx-auto h-10 w-10 text-[#0f766e]" />
                          <h2 className="mt-3 text-xl font-black text-slate-950">
                            {isZh ? "还没有项目" : "No projects yet"}
                          </h2>
                          <p className="mx-auto mt-2 max-w-lg text-sm font-semibold leading-6 text-slate-600">
                            {isZh
                              ? "先创建一个项目，后续澄清、spec、路线和执行都会绑定在这个项目里。"
                              : "Create a project first; every clarification, spec, route, and mission will attach to it."}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 border-t border-white/72 pt-4">
                      <p className="mb-2 text-[11px] font-black uppercase tracking-normal text-slate-500">
                        {isZh ? "快速创建" : "Quick create"}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleCreateProjectFromTemplate()}
                        aria-label={isZh ? "新建项目" : "New Project"}
                        data-testid="home-project-quick-create-button"
                        className="inline-flex max-w-[220px] items-center gap-2 rounded-full border border-white/80 bg-white/78 px-3.5 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:bg-white hover:text-slate-950"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0 text-[#0f766e]" />
                        <span className="truncate">
                          {isZh ? "新建项目" : "New Project"}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div
                className={cn(
                  "pointer-events-none fixed left-[max(284px,calc(var(--sidebar-width,248px)+32px))] right-8 top-[clamp(66px,7vh,92px)] z-[58] text-left",
                  isProjectHub && "hidden"
                )}
                data-testid="home-autopilot-cockpit-overlay"
              >
                <div
                  className="pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/56 bg-white/32 px-3 py-1.5 text-[11px] font-black text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.06)] backdrop-blur-2xl"
                  data-testid="home-autopilot-breadcrumb"
                >
                  <button
                    type="button"
                    onClick={() => setLocation("/projects")}
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-slate-600 transition hover:bg-white/44 hover:text-slate-950"
                    data-testid="home-back-to-project-space"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 text-[#0f766e]" />
                    {projectSpaceLabel}
                  </button>
                  <span className="text-slate-300">/</span>
                  <span className="max-w-[220px] truncate">
                    {currentProject?.name ??
                      (isZh ? "未选择项目" : "No project")}
                  </span>
                  <span className="text-slate-300">/</span>
                  <span className="text-[#0f766e]">{autopilotLabel}</span>
                </div>
                <div
                  className="pointer-events-auto mt-2 rounded-[18px] border border-white/52 bg-white/28 px-3 py-2.5 shadow-[0_12px_30px_rgba(15,23,42,0.07)] backdrop-blur-[30px] supports-[backdrop-filter]:bg-white/24"
                  data-testid="home-autopilot-status-strip"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-black backdrop-blur-xl",
                            currentAutopilotWaitingForUser
                              ? "border-orange-200/60 bg-orange-50/42 text-orange-700"
                              : "border-emerald-200/60 bg-emerald-50/42 text-emerald-700"
                          )}
                        >
                          {currentAutopilotStatusLabel}
                        </span>
                        <span className="rounded-full border border-white/42 bg-white/30 px-2.5 py-1 text-[11px] font-black text-slate-600 backdrop-blur-xl">
                          {currentAutopilotRouteLabel}
                        </span>
                      </div>
                      <h1 className="mt-1 truncate text-[15px] font-black leading-tight text-slate-950">
                        {currentAutopilotStepLabel}
                      </h1>
                      <p className="mt-0.5 line-clamp-1 text-[12px] font-bold leading-5 text-slate-600">
                        {currentAutopilotNextText ||
                          (isZh ? "鏆傛棤鍐呭" : "No content yet")}
                      </p>
                    </div>
                    <div className="grid shrink-0 grid-cols-4 gap-1.5 text-center">
                      {[
                        {
                          label: isZh ? "Agent" : "Agent",
                          value:
                            currentAutopilotAgent?.title ||
                            (isZh ? "待分配" : "Unassigned"),
                          className:
                            "border-white/42 bg-white/30 text-slate-700 backdrop-blur-xl",
                        },
                        {
                          label: isZh ? "耗时" : "Elapsed",
                          value: currentAutopilotElapsedLabel,
                          className:
                            "border-white/42 bg-white/30 text-slate-700 backdrop-blur-xl",
                        },
                        {
                          label: "Token",
                          value: currentAutopilotTokenLabel,
                          className:
                            "border-white/42 bg-white/30 text-slate-700 backdrop-blur-xl",
                        },
                        {
                          label: isZh ? "风险" : "Risk",
                          value: currentAutopilotRiskLabel,
                          className: getAutopilotRiskTone(
                            currentAutopilotRiskLevel
                          ),
                        },
                      ].map(item => (
                        <span
                          key={item.label}
                          className={cn(
                            "min-w-[66px] rounded-2xl border px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.36)]",
                            item.className
                          )}
                        >
                          <span className="block text-[9px] font-black uppercase tracking-normal opacity-70">
                            {item.label}
                          </span>
                          <span className="mt-0.5 block max-w-[92px] truncate text-[11px] font-black">
                            {item.value}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div
                    className="mt-2 flex flex-wrap items-center justify-end gap-1.5"
                    data-testid="home-autopilot-control-strip"
                  >
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={openProjectTaskCenter}
                        className="inline-flex items-center gap-1 rounded-full bg-[#0f766e] px-3 py-1.5 text-[11px] font-black text-white shadow-sm transition hover:bg-[#115e59]"
                      >
                        {fullWorkbenchLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAutopilotDetailDrawerOpen(true)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/46 bg-white/34 px-3 py-1.5 text-[11px] font-black text-slate-700 backdrop-blur-xl transition hover:bg-white/58"
                      >
                        {workflowLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleConfig()}
                        className="inline-flex items-center gap-1 rounded-full border border-white/46 bg-white/34 px-3 py-1.5 text-[11px] font-black text-slate-700 backdrop-blur-xl transition hover:bg-white/58"
                      >
                        {configLabel}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  "pointer-events-none fixed right-8 top-[clamp(128px,14vh,168px)] z-[60] h-[min(70vh,690px)] w-[min(500px,calc(100vw-380px))] min-w-[420px] transition duration-200",
                  autopilotDetailDrawerOpen
                    ? "translate-x-0 opacity-100"
                    : "translate-x-8 opacity-0",
                  isProjectHub && "hidden"
                )}
                data-testid="home-autopilot-detail-drawer"
                data-drawer-state={
                  autopilotDetailDrawerOpen ? "open" : "closed"
                }
                aria-hidden={!autopilotDetailDrawerOpen}
              >
                <div className="pointer-events-auto flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/76 bg-white/62 shadow-[0_26px_70px_rgba(15,23,42,0.16)] backdrop-blur-2xl">
                  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/62 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-normal text-[#0f766e]">
                        Execution details
                      </p>
                      <p className="mt-0.5 truncate text-sm font-black text-slate-950">
                        {currentAutopilotStepLabel}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAutopilotDetailDrawerOpen(false)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/72 bg-white/72 text-slate-500 transition hover:bg-white hover:text-slate-950"
                      aria-label="Close details"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                    <div
                      className="grid gap-2"
                      data-testid="home-autopilot-focus-panel"
                    >
                      {currentAutopilotFocusCards.map(card => (
                        <div
                          key={card.label}
                          className={cn(
                            "rounded-[18px] border px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]",
                            card.tone
                          )}
                        >
                          <p className="text-[10px] font-black uppercase tracking-normal opacity-70">
                            {card.label}
                          </p>
                          <p className="mt-1 text-[12px] font-bold leading-5">
                            {card.value ||
                              (isZh ? "鏆傛棤鍐呭" : "No content yet")}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-2">
                      {[
                        {
                          label: "Current judgement",
                          value: currentAutopilotStatusLabel,
                          icon: currentAutopilotWaitingForUser
                            ? AlertTriangle
                            : CheckCircle2,
                        },
                        {
                          label: "Recent evidence",
                          value: `${currentAutopilotArtifactLabel} / ${currentAutopilotWorkflowLabel}`,
                          icon: FileText,
                        },
                        {
                          label: "Runtime",
                          value:
                            runtimeMode === "advanced"
                              ? advancedModeLabel
                              : frontendModeLabel,
                          icon: Clock3,
                        },
                      ].map(item => {
                        const Icon = item.icon;
                        return (
                          <div
                            key={item.label}
                            className="rounded-[16px] border border-white/68 bg-white/54 px-3 py-2.5 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]"
                          >
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5 shrink-0 text-[#0f766e]" />
                              <p className="text-[10px] font-black uppercase tracking-normal text-slate-400">
                                {item.label}
                              </p>
                            </div>
                            <p className="mt-1 text-[12px] font-bold leading-5 text-slate-700">
                              {item.value}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/62 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openWorkflowPanel()}
                      className="inline-flex items-center gap-1 rounded-full border border-white/72 bg-white/70 px-3 py-1.5 text-[11px] font-black text-slate-700 transition hover:bg-white"
                    >
                      <Waves className="h-3.5 w-3.5 text-[#0f766e]" />
                      {workflowLabel}
                    </button>
                    <button
                      type="button"
                      onClick={openProjectTaskCenter}
                      className="inline-flex items-center gap-1 rounded-full bg-[#0f766e] px-3 py-1.5 text-[11px] font-black text-white shadow-sm transition hover:bg-[#115e59]"
                    >
                      {fullWorkbenchLabel}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {!isProjectHub ? (
                <OfficeTaskCockpit
                  resizeActive={resizeActive}
                  className="home-first-screen-cockpit"
                />
              ) : null}

              <ChatPanel />
              <WorkflowPanel />
              <TelemetryDashboard />
            </div>
          ) : null}
        </UEOverlayChrome>
      )}

      <div className="pointer-events-none absolute inset-0 z-[5]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(228,241,252,0.72),rgba(228,241,252,0)_38%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,251,247,0.42),rgba(255,251,247,0)_30%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.07),rgba(59,130,246,0)_32%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(15,118,110,0.1),rgba(15,118,110,0)_24%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#f5f9fd]/46 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#dbeafe]/32 to-transparent" />
        <div className="absolute inset-0 shadow-[inset_0_0_160px_rgba(15,23,42,0.08)]" />
      </div>

      {isSceneReady && isMobile && isProjectHub ? (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+92px)] z-[18] flex justify-center px-3">
          <div className="pointer-events-auto max-h-[calc(100svh-150px)] w-full overflow-y-auto rounded-[28px] studio-shell px-4 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-normal text-[#0f766e]">
              <FolderKanban className="h-4 w-4" />
              {projectSpaceLabel}
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
              {projectHubTitle}
            </h1>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {projectHubSubtitle}
            </p>
            <label className="relative mt-4 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={projectSearchQuery}
                onChange={event =>
                  setProjectSearchQuery(event.currentTarget.value)
                }
                placeholder={projectSearchPlaceholder}
                disabled={visibleProjects.length === 0}
                className="h-10 w-full rounded-2xl border border-white/80 bg-white/82 pl-9 pr-10 text-sm font-semibold text-slate-800 outline-none shadow-sm transition placeholder:text-slate-400 focus:border-[#0f766e]/35 focus:ring-2 focus:ring-[#0f766e]/12 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="home-mobile-project-search"
              />
              {projectSearchQuery ? (
                <button
                  type="button"
                  onClick={() => setProjectSearchQuery("")}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label={isZh ? "清空搜索" : "Clear search"}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>
            <div className="mt-4 grid gap-3">
              {newProjectDraft ? (
                <article
                  className="rounded-[22px] border border-dashed border-[#0f766e]/28 bg-white/76 px-4 py-4 text-left shadow-[0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur-xl"
                  data-testid="home-mobile-project-create-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#0f766e] text-white shadow-md">
                      <Plus className="h-[18px] w-[18px]" />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleOptimizeProjectPrompt}
                        disabled={isOptimizingProjectPrompt}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/72 bg-white/76 px-2.5 text-[10px] font-black text-[#0f766e] shadow-sm transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
                        aria-label={
                          isZh
                            ? "调用 LLM 优化提示词"
                            : "Optimize prompt with LLM"
                        }
                        data-testid="home-mobile-project-optimize-prompt"
                      >
                        <Sparkles
                          className={cn(
                            "h-3.5 w-3.5",
                            isOptimizingProjectPrompt && "animate-spin"
                          )}
                        />
                        {isOptimizingProjectPrompt
                          ? isZh
                            ? "优化中"
                            : "Optimizing"
                          : isZh
                            ? "优化"
                            : "Optimize"}
                      </button>
                      <span className="rounded-full bg-[#0f766e]/10 px-2.5 py-1 text-[10px] font-black text-[#0f766e]">
                        {isZh ? "新建中" : "New"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2">
                    <input
                      value={newProjectDraft.name}
                      onChange={event => {
                        const value = event.currentTarget.value;
                        setProjectPromptOptimizeError(null);
                        setNewProjectDraft(current =>
                          current
                            ? {
                                ...current,
                                name: value,
                              }
                            : current
                        );
                      }}
                      onKeyDown={handleNewProjectKeyDown}
                      autoFocus
                      placeholder={isZh ? "输入项目名称" : "Project name"}
                      className="h-10 rounded-2xl border border-white/80 bg-white/82 px-3 text-sm font-black text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-[#0f766e]/35 focus:ring-2 focus:ring-[#0f766e]/12"
                      data-testid="home-mobile-project-create-name"
                    />
                    <textarea
                      value={newProjectDraft.summary}
                      onChange={event => {
                        const value = event.currentTarget.value;
                        setProjectPromptOptimizeError(null);
                        setNewProjectDraft(current =>
                          current
                            ? {
                                ...current,
                                summary: value,
                              }
                            : current
                        );
                      }}
                      onKeyDown={handleNewProjectKeyDown}
                      rows={3}
                      placeholder={
                        isZh
                          ? "输入项目描述或目标"
                          : "Project description or goal"
                      }
                      className="min-h-20 resize-none rounded-2xl border border-white/80 bg-white/82 px-3 py-2 text-sm font-semibold leading-5 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#0f766e]/35 focus:ring-2 focus:ring-[#0f766e]/12"
                      data-testid="home-mobile-project-create-summary"
                    />
                    {projectPromptOptimizeError ? (
                      <p
                        className="text-xs font-bold leading-5 text-rose-500"
                        data-testid="home-mobile-project-optimize-error"
                      >
                        {projectPromptOptimizeError}
                      </p>
                    ) : null}
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleCancelNewProject}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/72 bg-white/70 text-slate-500 transition hover:bg-white hover:text-slate-900"
                        aria-label={
                          isZh ? "取消新建项目" : "Cancel new project"
                        }
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveNewProject}
                        disabled={newProjectDraft.name.trim().length === 0}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#0f766e] text-white transition hover:bg-[#115e59] disabled:cursor-not-allowed disabled:bg-slate-300"
                        aria-label={isZh ? "保存新项目" : "Save new project"}
                        data-testid="home-mobile-project-create-save"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              ) : null}
              {filteredProjects.map(project => {
                const stats = getProjectStats(project);
                const isEditing = editingProject?.id === project.id;
                const isConfirmingDelete =
                  confirmDeleteProjectId === project.id;
                return (
                  <article
                    key={project.id}
                    className="rounded-[22px] border border-white/74 bg-white/76 px-4 py-4 text-left shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
                    data-testid="home-mobile-project-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-black text-slate-950">
                          {project.name}
                        </p>
                        <p className="mt-1 line-clamp-2 h-10 max-h-10 overflow-hidden break-words text-xs font-semibold leading-5 text-slate-600">
                          {project.summary || project.goal}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[#0f766e]/10 px-2 py-1 text-[10px] font-black text-[#0f766e]">
                        {project.status}
                      </span>
                    </div>
                    {isEditing && editingProject ? (
                      <div className="mt-3 grid gap-2">
                        <input
                          value={editingProject.name}
                          onChange={event => {
                            const value = event.currentTarget.value;
                            setEditingProject(current =>
                              current?.id === project.id
                                ? {
                                    ...current,
                                    name: value,
                                  }
                                : current
                            );
                          }}
                          className="h-10 rounded-2xl border border-slate-200/80 bg-white px-3 text-sm font-black text-slate-950 outline-none transition focus:border-[#0f766e]/35 focus:ring-2 focus:ring-[#0f766e]/12"
                          aria-label={isZh ? "项目名称" : "Project name"}
                          data-testid="home-mobile-project-edit-name"
                        />
                        <textarea
                          value={editingProject.summary}
                          onChange={event => {
                            const value = event.currentTarget.value;
                            setEditingProject(current =>
                              current?.id === project.id
                                ? {
                                    ...current,
                                    summary: value,
                                  }
                                : current
                            );
                          }}
                          rows={3}
                          className="min-h-20 resize-none rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-sm font-semibold leading-5 text-slate-700 outline-none transition focus:border-[#0f766e]/35 focus:ring-2 focus:ring-[#0f766e]/12"
                          aria-label={isZh ? "项目描述" : "Project summary"}
                          data-testid="home-mobile-project-edit-summary"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={handleCancelEditProject}
                            className="rounded-full border border-slate-200/80 bg-white/82 px-3 py-1.5 text-[11px] font-black text-slate-600"
                          >
                            {isZh ? "取消" : "Cancel"}
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveProjectEdit}
                            disabled={editingProject.name.trim().length === 0}
                            className="rounded-full bg-[#0f766e] px-3 py-1.5 text-[11px] font-black text-white disabled:bg-slate-300"
                            data-testid="home-mobile-project-save"
                          >
                            {isZh ? "保存" : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-[10px] font-black text-slate-500">
                          <span className="rounded-xl bg-white/72 px-2 py-2">
                            Spec {stats.specs}
                          </span>
                          <span className="rounded-xl bg-white/72 px-2 py-2">
                            Route {stats.routes}
                          </span>
                          <span className="rounded-xl bg-white/72 px-2 py-2">
                            Q {stats.openQuestions}
                          </span>
                          <span className="rounded-xl bg-white/72 px-2 py-2">
                            Ev {stats.evidence}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleStartEditProject(project)}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/86 px-2.5 py-1.5 text-[11px] font-black text-slate-600"
                              data-testid="home-mobile-project-edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              {isZh ? "编辑" : "Edit"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteProject(project)}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-black",
                                isConfirmingDelete
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-slate-200/80 bg-white/86 text-slate-600"
                              )}
                              data-testid="home-mobile-project-delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {isConfirmingDelete
                                ? isZh
                                  ? "确认删除"
                                  : "Confirm"
                                : isZh
                                  ? "删除"
                                  : "Delete"}
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenAutopilotProject(project)}
                            className="inline-flex items-center gap-1 rounded-full bg-[#0f766e] px-3 py-1.5 text-[11px] font-black text-white"
                          >
                            {openAutopilotLabel}
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
              {visibleProjects.length > 0 &&
              filteredProjects.length === 0 &&
              !newProjectDraft ? (
                <div
                  className="rounded-[22px] border border-dashed border-slate-200 bg-white/70 px-4 py-7 text-center"
                  data-testid="home-mobile-project-search-empty"
                >
                  <p className="text-lg font-black text-slate-950">
                    {isZh ? "没有匹配项目" : "No matching projects"}
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                    {isZh
                      ? "换一个关键词，或清空搜索后查看全部项目。"
                      : "Try another keyword, or clear the search to show every project."}
                  </p>
                </div>
              ) : null}
              {visibleProjects.length === 0 && !newProjectDraft ? (
                <div className="rounded-[22px] border border-dashed border-slate-200 bg-white/70 px-4 py-7 text-center">
                  <p className="text-lg font-black text-slate-950">
                    {isZh ? "还没有项目" : "No projects yet"}
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                    {isZh
                      ? "创建一个项目后，后续操作都会绑定在它里面。"
                      : "Create one project first; later work will stay scoped to it."}
                  </p>
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => handleCreateProjectFromTemplate()}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/72 bg-white/82 px-3 py-2 text-xs font-black text-slate-700"
              >
                <Plus className="h-3.5 w-3.5 text-[#0f766e]" />
                {isZh ? "新建项目" : "New Project"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSceneReady && isMobile && !isProjectHub ? (
        <div className="pointer-events-none absolute inset-x-0 z-[18] flex justify-center px-3 top-[calc(env(safe-area-inset-top)+108px)]">
          <div className="pointer-events-auto w-full max-w-none rounded-[28px] studio-shell px-4 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setLocation("/projects")}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/85 px-3 py-1.5 text-xs font-black text-slate-700 transition-colors hover:bg-white hover:text-slate-950"
                data-testid="home-mobile-back-to-project-space"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-[#0f766e]" />
                <span>{projectSpaceLabel}</span>
                <span className="text-slate-300">/</span>
                <span className="max-w-[132px] truncate">
                  {currentProject?.name}
                </span>
              </button>
              <span className="rounded-full bg-[#0f766e]/10 px-2.5 py-1 text-[10px] font-black text-[#0f766e]">
                {autopilotLabel}
              </span>
            </div>
            <div className="mt-3 space-y-3">
              <div
                className="rounded-[22px] border border-white/70 bg-white/64 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)]"
                data-testid="home-mobile-autopilot-status"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-black",
                          currentAutopilotWaitingForUser
                            ? "border-orange-200/80 bg-orange-50/76 text-orange-700"
                            : "border-emerald-200/80 bg-emerald-50/76 text-emerald-700"
                        )}
                      >
                        {currentAutopilotStatusLabel}
                      </span>
                      <span className="rounded-full border border-white/70 bg-white/66 px-2 py-0.5 text-[10px] font-black text-slate-600">
                        {currentAutopilotRouteLabel}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-black text-slate-950">
                      {currentAutopilotStepLabel}
                    </p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                      {currentAutopilotNextText}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-1 text-[10px] font-black",
                      getAutopilotRiskTone(currentAutopilotRiskLevel)
                    )}
                  >
                    {isZh ? "风险" : "Risk"} {currentAutopilotRiskLabel}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                  {[
                    {
                      label: isZh ? "Agent" : "Agent",
                      value:
                        currentAutopilotAgent?.title ||
                        (isZh ? "待分配" : "Unassigned"),
                    },
                    {
                      label: isZh ? "耗时" : "Elapsed",
                      value: currentAutopilotElapsedLabel,
                    },
                    {
                      label: "Token",
                      value: currentAutopilotTokenLabel,
                    },
                  ].map(item => (
                    <div
                      key={item.label}
                      className="min-w-0 rounded-2xl border border-white/70 bg-white/62 px-2 py-1.5"
                    >
                      <p className="text-[9px] font-black uppercase tracking-normal text-slate-400">
                        {item.label}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] font-black text-slate-700">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="rounded-[22px] border border-white/70 bg-white/58 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.76)]"
                data-testid="home-mobile-autopilot-focus"
              >
                <p className="text-[11px] font-black uppercase tracking-normal text-[#0f766e]">
                  {currentAutopilotWaitingForUser
                    ? isZh
                      ? "需要你确认"
                      : "Needs Your Decision"
                    : isZh
                      ? "当前任务焦点"
                      : "Current Task Focus"}
                </p>
                <p className="mt-1 line-clamp-3 text-xs font-semibold leading-5 text-slate-700">
                  {currentAutopilotWaitingForUser
                    ? currentAutopilotDecisionText
                    : currentAutopilotUnderstandsText ||
                      (isZh ? "暂无阻塞项。" : "No blocking item right now.")}
                </p>
              </div>

              <UnifiedLaunchComposer
                createMission={createMission}
                projectId={currentProject?.id ?? null}
                projectName={currentProject?.name ?? null}
                compact
                bare
                dense
                hideHeader
                hideInputLabel
                className="home-mobile-project-composer"
              />

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={openProjectTaskCenter}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#115e59]"
                >
                  {fullWorkbenchLabel}
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleWorkflowPanel()}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200/80 bg-white/85 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950"
                >
                  {workflowLabel}
                </button>
                <button
                  type="button"
                  onClick={() => toggleConfig()}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200/80 bg-white/85 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950"
                >
                  {configLabel}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600">
                {currentAutopilotArtifactLabel}
              </span>
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600">
                {currentAutopilotWorkflowLabel}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {!isSceneReady && <LoadingScreen />}

      {isSceneReady && isMobile && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+270px)] z-[18] px-3">
            <div className="pointer-events-auto">
              {noticeBoardSnapshot ? (
                <OfficeNoticeBoard
                  locale={locale}
                  snapshot={noticeBoardSnapshot}
                  onOpenTasks={openProjectTaskCenter}
                  onOpenWorkflow={() => openWorkflowPanel()}
                  onOpenCurrentTask={handleOpenCurrentMission}
                />
              ) : null}
            </div>
          </div>
          <ChatPanel />
          <WorkflowPanel />
          <TelemetryDashboard />
        </>
      )}

      <AgentDetailDrawer
        agentId={selectedPet}
        projectId={currentProject?.id ?? null}
        open={isMobile && Boolean(selectedPet)}
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            setSelectedPet(null);
          }
        }}
      />
    </div>
  );
}
