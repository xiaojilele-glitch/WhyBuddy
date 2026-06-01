import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  appState,
  projectState,
  tasksState,
  telemetryState,
  workflowState,
  locationState,
} = vi.hoisted(() => {
  const appState = {
    isSceneReady: true,
    hydrateAIConfig: async () => {},
    runtimeMode: "frontend" as "frontend" | "advanced",
    setRuntimeMode: async () => {},
    locale: "en-US",
    toggleLocale: () => {},
    toggleConfig: () => {},
    selectedPet: null as string | null,
    setSelectedPet: () => {},
  };
  const tasksState = {
    ensureReady: async () => {},
    createMission: async () => null,
    tasks: [],
    detailsById: {},
    selectedTaskId: null as string | null,
    selectTask: () => {},
  };
  const projectState = {
    ready: true,
    ensureReady: () => {},
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
  const telemetryState = {
    fetchInitial: async () => {},
    snapshot: null,
  };
  const workflowState = {
    agents: [],
    workflows: [],
    heartbeatStatuses: {},
    disconnectSocket: () => {},
    toggleWorkflowPanel: () => {},
    openWorkflowPanel: () => {},
  };
  const locationState = {
    current: "/",
    setLocation: vi.fn(),
  };

  return {
    appState,
    projectState,
    tasksState,
    telemetryState,
    workflowState,
    locationState,
  };
});

import Home from "./Home";

vi.mock("wouter", () => ({
  useLocation: () => [locationState.current, locationState.setLocation],
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

vi.mock("@/components/ChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock("@/components/GitHubRepoBadge", () => ({
  GitHubRepoBadge: () => <div data-testid="github-repo-badge" />,
}));

vi.mock("@/components/launch/UnifiedLaunchComposer", () => ({
  UnifiedLaunchComposer: ({
    projectId,
    projectName,
    compact,
    bare,
    dense,
  }: {
    projectId?: string | null;
    projectName?: string | null;
    compact?: boolean;
    bare?: boolean;
    dense?: boolean;
  }) => (
    <div
      data-testid="unified-launch-composer"
      data-project-id={projectId || ""}
      data-project-name={projectName || ""}
      data-compact={compact ? "true" : "false"}
      data-bare={bare ? "true" : "false"}
      data-dense={dense ? "true" : "false"}
    />
  ),
}));

vi.mock("@/components/LoadingScreen", () => ({
  LoadingScreen: () => <div data-testid="loading-screen" />,
}));

vi.mock("@/components/office/OfficeTaskCockpit", () => ({
  OfficeTaskCockpit: ({
    className,
    resizeActive,
  }: {
    className?: string;
    resizeActive?: boolean;
  }) => (
    <div
      data-testid="office-task-cockpit"
      data-class-name={className || ""}
      data-resize-active={resizeActive ? "true" : "false"}
    />
  ),
}));

vi.mock("@/components/scene/AgentDetailDrawer", () => ({
  AgentDetailDrawer: () => <div data-testid="agent-detail-drawer" />,
}));

vi.mock("@/components/scene/OfficeNoticeBoard", () => ({
  OfficeNoticeBoard: () => <div data-testid="office-notice-board" />,
}));

vi.mock("@/components/Scene3D", () => ({
  Scene3D: ({
    sidebarWidth,
    performanceProfile,
  }: {
    sidebarWidth?: number;
    performanceProfile?: string;
  }) => (
    <div
      data-testid="scene-3d"
      data-sidebar-width={String(sidebarWidth ?? 0)}
      data-performance-profile={performanceProfile || ""}
    />
  ),
}));

vi.mock("@/components/TelemetryDashboard", () => ({
  TelemetryDashboard: () => <div data-testid="telemetry-dashboard" />,
}));

vi.mock("@/components/ue-overlay", () => ({
  UEOverlayChrome: ({
    mediaLayer,
    sidebar,
    children,
    viewportWidth,
  }: {
    mediaLayer?: React.ReactNode;
    sidebar?: React.ReactNode;
    children?: React.ReactNode;
    viewportWidth?: number;
  }) => (
    <div data-testid="ue-overlay-chrome" data-viewport-width={viewportWidth}>
      <div data-testid="ue-media-layer">{mediaLayer}</div>
      <div data-testid="ue-sidebar-slot">{sidebar}</div>
      <div data-testid="ue-panel-slot">{children}</div>
    </div>
  ),
}));

vi.mock("@/components/WorkflowPanel", () => ({
  WorkflowPanel: () => <div data-testid="workflow-panel" />,
}));

vi.mock("@/hooks/useViewportTier", () => ({
  useViewportResizeState: () => false,
  useViewportTier: () => ({
    isMobile: false,
    isTablet: false,
    tier: "desktop",
  }),
  useViewportWidth: () => 1440,
}));

vi.mock("@/hooks/useDemoMode", () => ({
  useDemoMode: () => ({
    startDemo: async () => {},
  }),
}));

vi.mock("@/hooks/useWorkflowRuntimeBootstrap", () => ({
  useWorkflowRuntimeBootstrap: () => {},
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    copy: {
      app: {
        localeSwitch: "Switch language",
      },
      common: {
        chineseShort: "ZH",
        englishShort: "EN",
      },
      home: {
        agentChip: (count: number) => `${count} agents`,
        desktopOfficeLabel: "Desktop office",
        enterTasks: "Tasks",
        liveDemo: "Demo",
        mobileHint: "Mobile hint",
        officeEyebrow: "Office",
        officeTitle: "WhyBuddy",
        openConfig: "Config",
        openWorkflow: "Workflow",
        runtimeChip: (label: string) => `Runtime: ${label}`,
        workflowChip: (count: number) => `${count} workflows`,
      },
      toolbar: {
        primaryNav: {
          more: { label: "More" },
          office: { label: "Office" },
        },
        runtimeLabels: {
          advanced: "Advanced",
          frontend: "Frontend",
        },
      },
    },
  }),
}));

vi.mock("@/lib/deploy-target", () => ({
  CAN_USE_ADVANCED_RUNTIME: true,
  IS_GITHUB_PAGES: false,
}));

vi.mock("@/lib/scene-agent-detail", () => ({
  buildOfficeNoticeBoardSnapshot: () => null,
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) =>
    selector(appState),
}));

vi.mock("@/lib/tasks-store", () => ({
  useTasksStore: (selector: (state: typeof tasksState) => unknown) =>
    selector(tasksState),
}));

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
    selector(projectState),
}));

vi.mock("@/lib/telemetry-store", () => ({
  useTelemetryStore: (selector: (state: typeof telemetryState) => unknown) =>
    selector(telemetryState),
}));

vi.mock("@/lib/workflow-store", () => ({
  useWorkflowStore: (selector: (state: typeof workflowState) => unknown) =>
    selector(workflowState),
}));

describe("Home desktop shell", () => {
  beforeEach(() => {
    locationState.current = "/";
    locationState.setLocation.mockClear();
    projectState.currentProjectId = null;
    projectState.projects = [];
    projectState.messages = [];
    projectState.clarificationQuestions = [];
    projectState.specs = [];
    projectState.routes = [];
    projectState.missions = [];
    projectState.artifacts = [];
    projectState.evidence = [];
    projectState.createProject.mockClear();
    projectState.selectProject.mockClear();
    projectState.updateProject.mockClear();
    projectState.archiveProject.mockClear();
    projectState.addProjectArtifact.mockClear();
  });

  it("keeps the scene and toolbar aligned to the desktop sidebar shell", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('data-testid="scene-3d"');
    expect(markup).toContain('data-sidebar-width="248"');
    expect(markup).toContain("home-desktop-sidebar-shell");

    const toolbarTag =
      markup.match(/<div[^>]*data-testid="home-desktop-toolbar"[^>]*>/)?.[0] ||
      "";

    expect(toolbarTag).toContain("absolute");
    expect(toolbarTag).not.toContain("left-0");
    expect(toolbarTag).not.toContain("right-0");
  });

  it("pins the desktop center controls to the viewport centerline", () => {
    const markup = renderToStaticMarkup(<Home />);

    const centerControlsTag =
      markup.match(
        /<div[^>]*data-testid="home-desktop-center-controls"[^>]*>/
      )?.[0] || "";

    expect(centerControlsTag).toContain("fixed");
    expect(centerControlsTag).toContain("left-1/2");
    expect(centerControlsTag).toContain("-translate-x-1/2");
    expect(centerControlsTag).not.toContain("inset-x-0");
    expect(centerControlsTag).not.toContain("justify-between");
  });

  it("styles the desktop sidebar shell as transparent glass instead of a solid rail", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain(
      '.home-desktop-sidebar-shell aside[data-sidebar-tone="glass"]'
    );
    expect(markup).toContain("rgba(255, 255, 255, 0.9)");
    expect(markup).toContain("rgba(236, 249, 255, 0.36)");
    expect(markup).toContain("backdrop-filter: blur(30px)");
    expect(markup).not.toContain(
      ".home-desktop-sidebar-shell aside {\n  background: rgba(248, 250, 252, 0.96)"
    );
    expect(markup).not.toContain(
      '.home-desktop-sidebar-shell aside [style*="background"]'
    );
  });

  it("keeps the right drawer reachable while retaining the autopilot cockpit", () => {
    projectState.currentProjectId = "project-1";
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
        goal: "Build a permission management system",
        status: "clarifying",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    ];

    const markup = renderToStaticMarkup(<Home mode="autopilot" />);

    expect(markup).toContain('data-testid="office-task-cockpit"');
    expect(markup).toContain("home-first-screen-cockpit");
    expect(markup).not.toContain("[&amp;_.office-cockpit-splitter]:opacity-0");
    expect(markup).not.toContain(
      "[&amp;_.office-cockpit-splitter]:pointer-events-none"
    );
    expect(markup).not.toContain(
      ".home-first-screen-cockpit .office-cockpit-splitter {\n  opacity: 0"
    );
  });

  it("surfaces the project space empty state before opening a project", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('data-testid="home-project-hub"');
    expect(markup).toContain("Project Space");
    expect(markup).toContain("No projects yet");
    expect(markup).toContain("New Project");
    expect(markup).toContain('data-testid="home-project-create-button"');
    expect(markup).not.toContain('data-testid="home-project-create-card"');
    expect(markup).toContain('aria-label="Import project materials"');
    expect(markup).toContain('data-testid="home-project-search"');
    expect(markup).not.toContain('data-testid="office-task-cockpit"');
  });

  it("shows project search, edit, and delete controls on project cards", () => {
    projectState.currentProjectId = "project-1";
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
        goal: "Build a permission management system",
        summary: "Manage roles, resources, and audit evidence.",
        status: "clarifying",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    ];

    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('data-testid="home-project-search"');
    expect(markup).toContain('data-testid="home-project-card"');
    expect(markup).toContain('data-testid="home-project-edit"');
    expect(markup).toContain('data-testid="home-project-delete"');
    expect(markup).toContain("Permission System");
    expect(markup).toContain("Open Autopilot");
  });

  it("shows the selected project as an execution-focused autopilot cockpit", () => {
    projectState.currentProjectId = "project-1";
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
        goal: "Build a permission management system",
        status: "clarifying",
        currentSpecId: "spec-1",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    ];
    projectState.specs = [
      {
        id: "spec-1",
        projectId: "project-1",
        version: 2,
        title: "Permission Spec",
        content:
          "Define roles, resources, permission checks, audit evidence, and rollback expectations.",
        status: "accepted",
        sourceMessageIds: ["message-1"],
        sourceEvidenceIds: ["evidence-source-1", "evidence-source-2"],
        sourceArtifactIds: ["artifact-1"],
        completenessDetail: { score: 0.84 },
      },
    ];
    projectState.routes = [
      {
        id: "route-1",
        projectId: "project-1",
        specId: "spec-1",
        kind: "conservative",
        title: "Conservative Control Route",
        summary: "Confirm approvals before execution.",
        riskLevel: "low",
        steps: [
          {
            id: "route-step-1",
            title: "Confirm assumptions",
            role: "Reviewer",
            status: "pending",
          },
          {
            id: "route-step-2",
            title: "Prepare rollback-safe work",
            role: "Planner",
            status: "pending",
          },
        ],
        selectedAt: "2026-04-30T00:20:00.000Z",
        createdAt: "2026-04-30T00:20:00.000Z",
      },
    ];
    projectState.missions = [{ id: "mission-1", projectId: "project-1" }];
    projectState.evidence = [{ id: "evidence-1", projectId: "project-1" }];
    projectState.clarificationQuestions = [
      {
        id: "clarification-answered",
        projectId: "project-1",
        text: "Who approves permission changes?",
        required: true,
        answeredAt: "2026-04-30T00:10:00.000Z",
      },
      {
        id: "clarification-skipped",
        projectId: "project-1",
        text: "Which frontend framework should be used?",
        required: false,
        defaultAssumption: "Use React.",
        skippedAt: "2026-04-30T00:11:00.000Z",
      },
      {
        id: "clarification-open",
        projectId: "project-1",
        text: "What is the audit retention window?",
        required: true,
      },
      {
        id: "clarification-other-project",
        projectId: "project-2",
        text: "Should not be counted here.",
        required: true,
      },
    ];

    const markup = renderToStaticMarkup(<Home mode="autopilot" />);

    expect(markup).toContain("Permission System");
    expect(markup).toContain("Autopilot");
    expect(markup).toContain('data-testid="home-back-to-project-space"');
    expect(markup).toContain('data-testid="home-autopilot-breadcrumb"');
    expect(markup).toContain('data-testid="home-autopilot-status-strip"');
    expect(markup).toContain('data-testid="home-autopilot-detail-drawer"');
    expect(markup).toContain('data-drawer-state="closed"');
    expect(markup).toContain('data-testid="home-autopilot-focus-panel"');
    expect(markup).toContain('data-testid="home-autopilot-control-strip"');
    expect(markup).toContain("Conservative Control Route");
    expect(markup).toContain("Agent");
    expect(markup).toContain("Elapsed");
    expect(markup).toContain("Token");
    expect(markup).toContain("Risk");
    expect(markup).toContain("Needs Your Decision");
    expect(markup).toContain("What is the audit retention window?");
    expect(markup).toContain("AI Understands");
    expect(markup).toContain("Next Step");
    expect(markup).toContain("Take over");
    expect(markup).toContain("View logs");
    expect(markup).toContain("Runtime config");
    expect(markup).not.toContain("Specs 1");
    expect(markup).not.toContain("Routes 1");
    expect(markup).not.toContain("Missions 1");
    expect(markup).not.toContain("Evidence 1");
    expect(markup).not.toContain('data-testid="home-current-spec-summary"');
    expect(markup).not.toContain('data-testid="home-clarification-progress"');
    expect(markup).not.toContain('data-testid="home-route-cards"');
  });

  it("keeps project switching out of the selected project autopilot page", () => {
    projectState.currentProjectId = "project-2";
    projectState.projects = [
      {
        id: "project-1",
        name: "Permission System",
        goal: "Build a permission management system",
        status: "clarifying",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      {
        id: "project-2",
        name: "Spec Evolution",
        goal: "Evolve a product spec",
        status: "planning",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    ];

    const markup = renderToStaticMarkup(<Home mode="autopilot" />);

    expect(markup).toContain('data-testid="home-autopilot-breadcrumb"');
    expect(markup).toContain('data-testid="home-autopilot-status-strip"');
    expect(markup).toContain("Spec Evolution");
    expect(markup).toContain("Select the FSD route");
    expect(markup).not.toContain('data-testid="home-project-switcher"');
    expect(markup).not.toContain("Switch project");
    expect(markup).not.toContain("Permission System");
  });
});
