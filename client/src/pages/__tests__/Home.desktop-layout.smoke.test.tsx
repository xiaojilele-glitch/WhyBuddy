import { createRef, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lucide-react", () => {
  const Icon = ({ className }: { className?: string }) => (
    <span aria-hidden="true" className={className} />
  );

  return {
    AlertTriangle: Icon,
    ArrowLeft: Icon,
    ArrowRight: Icon,
    BarChart3: Icon,
    Bell: Icon,
    BookOpen: Icon,
    BriefcaseBusiness: Icon,
    CheckCircle2: Icon,
    Clock3: Icon,
    Database: Icon,
    FileSearch: Icon,
    FileText: Icon,
    Filter: Icon,
    FolderKanban: Icon,
    Grid2X2: Icon,
    HelpCircle: Icon,
    LayoutGrid: Icon,
    List: Icon,
    ListTodo: Icon,
    MoreHorizontal: Icon,
    Navigation: Icon,
    Pencil: Icon,
    Plus: Icon,
    Search: Icon,
    Settings: Icon,
    Settings2: Icon,
    Shield: Icon,
    Sparkles: Icon,
    Store: Icon,
    Trash2: Icon,
    Upload: Icon,
    UsersRound: Icon,
    Waves: Icon,
    X: Icon,
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

const appState = {
  isSceneReady: true,
  runtimeMode: "frontend",
  locale: "en-US",
  selectedPet: null,
  hydrateAIConfig: vi.fn(async () => {}),
  setRuntimeMode: vi.fn(async () => {}),
  toggleLocale: vi.fn(),
  toggleConfig: vi.fn(),
  setSelectedPet: vi.fn(),
};

const taskState = {
  tasks: [],
  detailsById: {},
  selectedTaskId: null,
  ensureReady: vi.fn(async () => {}),
  createMission: vi.fn(async () => null),
  selectTask: vi.fn(),
};

const workflowState = {
  agents: [],
  workflows: [],
  heartbeatStatuses: {},
  disconnectSocket: vi.fn(),
  toggleWorkflowPanel: vi.fn(),
  openWorkflowPanel: vi.fn(),
};

const telemetryState = {
  snapshot: null,
  fetchInitial: vi.fn(async () => {}),
};

function selectFrom<T extends Record<string, unknown>, R>(
  state: T,
  selector: (state: T) => R
) {
  return selector(state);
}

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) =>
    selectFrom(appState, selector),
}));

vi.mock("@/lib/tasks-store", () => ({
  useTasksStore: (selector: (state: typeof taskState) => unknown) =>
    selectFrom(taskState, selector),
}));

vi.mock("@/lib/workflow-store", () => ({
  useWorkflowStore: (selector: (state: typeof workflowState) => unknown) =>
    selectFrom(workflowState, selector),
}));

vi.mock("@/lib/telemetry-store", () => ({
  useTelemetryStore: (selector: (state: typeof telemetryState) => unknown) =>
    selectFrom(telemetryState, selector),
}));

const projectState = {
  ready: true,
  ensureReady: vi.fn(),
  currentProjectId: null as string | null,
  projects: [] as any[],
  messages: [] as any[],
  clarificationQuestions: [] as any[],
  specs: [] as any[],
  routes: [] as any[],
  missions: [] as any[],
  artifacts: [] as any[],
  evidence: [] as any[],
  createProject: vi.fn(),
  selectProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  addProjectArtifact: vi.fn(),
};

vi.mock("@/lib/project-store", () => ({
  selectCurrentProject: (state: typeof projectState) =>
    state.projects.find(project => project.id === state.currentProjectId) ??
    null,
  selectProjectBundle: (
    state: typeof projectState,
    projectId: string | null
  ) =>
    projectId
      ? {
          project: state.projects.find(project => project.id === projectId),
          messages: state.messages.filter(item => item.projectId === projectId),
          clarificationQuestions: state.clarificationQuestions.filter(
            item => item.projectId === projectId
          ),
          specs: state.specs.filter(item => item.projectId === projectId),
          routes: state.routes.filter(item => item.projectId === projectId),
          missions: state.missions.filter(item => item.projectId === projectId),
          artifacts: state.artifacts.filter(
            item => item.projectId === projectId
          ),
          evidence: state.evidence.filter(item => item.projectId === projectId),
        }
      : null,
  useProjectStore: (selector: (state: typeof projectState) => unknown) =>
    selectFrom(projectState, selector),
}));

vi.mock("@/hooks/useDemoMode", () => ({
  useDemoMode: () => ({ startDemo: vi.fn(async () => {}) }),
}));

vi.mock("@/hooks/useWorkflowRuntimeBootstrap", () => ({
  useWorkflowRuntimeBootstrap: vi.fn(),
}));

vi.mock("@/hooks/useViewportTier", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/useViewportTier")
  >("@/hooks/useViewportTier");

  return {
    ...actual,
    useViewportTier: () => ({
      width: currentViewportWidth,
      tier: actual.getViewportTier(currentViewportWidth),
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isCompact: false,
    }),
    useViewportWidth: () => currentViewportWidth,
    useViewportResizeState: () => false,
  };
});

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    copy: {
      app: { localeSwitch: "Switch language" },
      common: {
        chineseShort: "ZH",
        englishShort: "EN",
      },
      home: {
        desktopOfficeLabel: "WhyBuddy / Office",
        officeTitle: "Office is now the default desktop execution shell.",
        enterTasks: "Execution details",
        openWorkflow: "Open Workflow",
        liveDemo: "Load Demo",
        openConfig: "Runtime Config",
        runtimeChip: (label: string) => `Current mode: ${label}`,
      },
      toolbar: {
        primaryNav: {
          office: { label: "Office" },
          more: { label: "More" },
        },
        runtimeLabels: {
          frontend: "Frontend Mode",
          advanced: "Advanced Mode",
        },
      },
    },
  }),
}));

vi.mock("@/lib/deploy-target", () => ({
  CAN_USE_ADVANCED_RUNTIME: true,
  IS_GITHUB_PAGES: false,
}));

vi.mock("@/components/AppSidebar", () => ({
  AppSidebar: ({
    collapsed,
    embedded,
  }: {
    collapsed: boolean;
    embedded?: boolean;
  }) => (
    <aside
      data-testid="app-sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      data-embedded={embedded ? "true" : "false"}
    />
  ),
}));

vi.mock("@/components/Scene3D", () => ({
  Scene3D: ({
    performanceProfile,
    sidebarWidth,
  }: {
    performanceProfile: string;
    sidebarWidth: number;
  }) => (
    <div
      data-testid="scene-3d"
      data-performance-profile={performanceProfile}
      data-sidebar-width={sidebarWidth}
    />
  ),
}));

vi.mock("@/components/launch/UnifiedLaunchComposer", () => ({
  UnifiedLaunchComposer: () => <div data-testid="unified-launch-composer" />,
}));

vi.mock("@/components/office/OfficeTaskCockpit", () => ({
  OfficeTaskCockpit: ({ resizeActive }: { resizeActive?: boolean }) => (
    <section
      data-testid="office-task-cockpit"
      data-resize-active={resizeActive ? "true" : "false"}
    />
  ),
}));

vi.mock("@/components/ue-overlay", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/ue-overlay")
  >("@/components/ue-overlay");

  return {
    ...actual,
    UEOverlayChrome: ({
      mediaLayer,
      sidebar,
      children,
      viewportWidth,
    }: {
      videoElement: ReturnType<typeof createRef<HTMLVideoElement>>;
      mediaLayer?: ReactNode;
      sidebar?: ReactNode;
      children: ReactNode;
      viewportWidth?: number;
    }) => (
      <div data-testid="ue-overlay-chrome" data-viewport-width={viewportWidth}>
        <div data-testid="ue-overlay-sidebar-slot">{sidebar}</div>
        <div data-testid="ue-overlay-media-layer">{mediaLayer}</div>
        <div data-testid="ue-overlay-panel-slot">{children}</div>
      </div>
    ),
  };
});

vi.mock("@/components/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/WorkflowPanel", () => ({ WorkflowPanel: () => null }));
vi.mock("@/components/TelemetryDashboard", () => ({
  TelemetryDashboard: () => null,
}));
vi.mock("@/components/GitHubRepoBadge", () => ({
  GitHubRepoBadge: () => null,
}));
vi.mock("@/components/LoadingScreen", () => ({ LoadingScreen: () => null }));
vi.mock("@/components/scene/AgentDetailDrawer", () => ({
  AgentDetailDrawer: () => null,
}));
vi.mock("@/components/scene/OfficeNoticeBoard", () => ({
  OfficeNoticeBoard: () => null,
}));
vi.mock("@/lib/scene-agent-detail", () => ({
  buildOfficeNoticeBoardSnapshot: vi.fn(() => null),
}));
vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

let currentViewportWidth = 1440;

async function renderDesktopHome(width: number, projectId?: string) {
  currentViewportWidth = width;
  const { default: Home } = await import("../Home");

  return renderToStaticMarkup(
    <Home mode={projectId ? "autopilot" : "project-space"} />
  );
}

describe("Home desktop first-screen layout smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentViewportWidth = 1440;
    projectState.currentProjectId = "project-1";
    projectState.projects = [
      {
        id: "project-1",
        name: "Spec Center",
        goal: "Keep spec state visible on the cockpit.",
        status: "spec_ready",
        currentSpecId: "spec-1",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    ];
    projectState.specs = [
      {
        id: "spec-1",
        projectId: "project-1",
        version: 1,
        title: "Cockpit Spec",
        content: "Show the current spec summary and completeness.",
        status: "accepted",
        sourceMessageIds: ["message-1"],
        sourceEvidenceIds: [],
        sourceArtifactIds: [],
        completeness: 0.7,
      },
    ];
    projectState.routes = [
      {
        id: "route-1",
        projectId: "project-1",
        specId: "spec-1",
        kind: "recommended",
        title: "Recommended FSD Route",
        summary: "Move the accepted spec into coordinated execution.",
        riskLevel: "medium",
        steps: [
          {
            id: "route-step-1",
            title: "Align on spec intent",
            role: "Planner",
            status: "pending",
          },
        ],
        selectedAt: "2026-04-30T00:20:00.000Z",
        createdAt: "2026-04-30T00:20:00.000Z",
      },
    ];
    projectState.missions = [];
    projectState.artifacts = [];
    projectState.evidence = [];
    projectState.clarificationQuestions = [
      {
        id: "clarification-open",
        projectId: "project-1",
        text: "Which evidence should appear first?",
        required: false,
        defaultAssumption: "Show spec evidence first.",
      },
    ];
  });

  it.each([1280, 1440, 1728])(
    "keeps project space, Scene3D, project cards, and toolbar visible at %ipx",
    async width => {
      const markup = await renderDesktopHome(width);

      expect(markup).toContain('data-testid="ue-overlay-chrome"');
      expect(markup).toContain(`data-viewport-width="${width}"`);
      expect(markup).toContain('data-testid="app-sidebar"');
      expect(markup).toContain('data-embedded="true"');
      expect(markup).toContain('data-testid="scene-3d"');
      expect(markup).toContain('data-testid="home-project-hub"');
      expect(markup).toContain('data-testid="home-project-search"');
      expect(markup).toContain('data-testid="home-project-card"');
      expect(markup).toContain('data-testid="home-project-edit"');
      expect(markup).toContain('data-testid="home-project-delete"');
      expect(markup).toContain("Project Space");
      expect(markup).toContain("Open Autopilot");
      expect(markup).not.toContain('data-testid="office-task-cockpit"');
    }
  );

  it.each([1280, 1440, 1728])(
    "keeps the selected project autopilot visible at %ipx",
    async width => {
      const markup = await renderDesktopHome(width, "project-1");

      expect(markup).toContain('data-testid="ue-overlay-chrome"');
      expect(markup).toContain(`data-viewport-width="${width}"`);
      expect(markup).toContain('data-testid="app-sidebar"');
      expect(markup).toContain('data-embedded="true"');
      expect(markup).toContain('data-testid="scene-3d"');
      expect(markup).toContain('data-testid="office-task-cockpit"');
      expect(markup).toContain('data-testid="home-back-to-project-space"');
      expect(markup).toContain("Autopilot");
      expect(markup).toContain('data-testid="home-autopilot-breadcrumb"');
      expect(markup).toContain('data-testid="home-autopilot-status-strip"');
      expect(markup).toContain('data-testid="home-autopilot-detail-drawer"');
      expect(markup).toContain('data-drawer-state="closed"');
      expect(markup).toContain('data-testid="home-autopilot-focus-panel"');
      expect(markup).toContain('data-testid="home-autopilot-control-strip"');
      expect(markup).toContain("Take over");
      expect(markup).toContain("View logs");
      expect(markup).toContain("Runtime config");
      expect(markup).toContain("Recommended FSD Route");
      expect(markup).toContain("Medium");
      expect(markup).not.toContain('data-testid="home-current-spec-summary"');
      expect(markup).not.toContain('data-testid="home-clarification-progress"');
      expect(markup).not.toContain('data-testid="home-route-cards"');
      expect(markup).not.toContain("task-detail-full-screen");
    }
  );

  it("only collapses the embedded sidebar below the desktop breakpoint", async () => {
    const markup = await renderDesktopHome(1280);

    expect(markup).toContain('data-collapsed="false"');
  });
});
