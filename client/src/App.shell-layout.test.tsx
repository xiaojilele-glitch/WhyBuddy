import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "./lib/auth-store";

const { deployTargetState, locationState, viewportState } = vi.hoisted(() => ({
  deployTargetState: {
    isGitHubPages: false,
  },
  locationState: {
    current: "/tasks",
    setLocation: vi.fn(),
  },
  viewportState: {
    isMobile: false,
    isTablet: false,
  },
}));

import { AppShell, isProjectWorkspaceLocation } from "./App";

vi.mock("./lib/deploy-target", () => ({
  CAN_USE_ADVANCED_RUNTIME: true,
  GITHUB_REPOSITORY: "opencroc/whybuddy",
  GITHUB_REPOSITORY_URL: "https://github.com/opencroc/whybuddy",
  get IS_GITHUB_PAGES() {
    return deployTargetState.isGitHubPages;
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => [locationState.current, locationState.setLocation],
  Switch: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Route: ({
    children,
    component: Component,
    path,
  }: {
    children?:
      | React.ReactNode
      | ((params: Record<string, string>) => React.ReactNode);
    component?: React.ComponentType;
    path?: string;
  }) => {
    const current = locationState.current;
    const matches =
      path === current ||
      (path === "/projects" && current === "/") ||
      (path === "/autopilot" && current === "/autopilot") ||
      (path === "/projects/:projectId/tasks/:taskId" &&
        current.startsWith("/projects/") &&
        current.includes("/tasks/")) ||
      (path === "/projects/:projectId/tasks" &&
        current.startsWith("/projects/") &&
        current.endsWith("/tasks")) ||
      (path === "/projects/:projectId" && current.startsWith("/projects/")) ||
      (path === "/tasks/:taskId" && current.startsWith("/tasks/")) ||
      (path === "/debug/autopilot-spec-documents-workbench" &&
        current === "/debug/autopilot-spec-documents-workbench") ||
      (path === "/debug/:section" &&
        current.startsWith("/debug/") &&
        current !== "/debug/autopilot-spec-documents-workbench") ||
      (!path && current === "/404");

    if (!matches) return null;
    if (Component) return <Component />;
    if (typeof children === "function") {
      return <>{children({ taskId: "task-1", section: "status" })}</>;
    }
    return <>{children}</>;
  },
}));

vi.mock("./hooks/useViewportTier", () => ({
  useViewportTier: () => ({
    isMobile: viewportState.isMobile,
    isTablet: viewportState.isTablet,
  }),
}));

vi.mock("./hooks/useRecoveryDetection", () => ({
  useRecoveryDetection: () => ({
    candidate: null,
    isRestoring: false,
    restoreProgress: 0,
    restorePhase: "",
    handleResume: vi.fn(),
    handleDiscard: vi.fn(),
  }),
}));

vi.mock("./components/AppSidebar", () => ({
  AppSidebar: ({
    collapsed,
    embedded,
  }: {
    collapsed: boolean;
    embedded?: boolean;
  }) => (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      data-embedded={embedded ? "true" : "false"}
      data-testid="app-sidebar"
    />
  ),
}));

vi.mock("./components/ConfigPanel", () => ({
  ConfigPanel: () => <div data-testid="config-panel" />,
}));

vi.mock("./components/MobileTabBar", () => ({
  MobileTabBar: () => <nav data-testid="mobile-tab-bar" />,
}));

vi.mock("./components/RecoveryDialog", () => ({
  RecoveryDialog: () => <div data-testid="recovery-dialog" />,
}));

vi.mock("./components/replay/ReplayPage", () => ({
  ReplayPage: () => <div data-testid="replay-page" />,
}));

vi.mock("./pages/Home", () => ({
  default: () => <main data-testid="home-page" />,
}));

vi.mock("./pages/auth/AuthPage", () => ({
  default: () => <main data-testid="auth-page" />,
}));

vi.mock("./pages/admin/AdminLayout", () => ({
  AdminLayout: ({ children }: { children?: React.ReactNode }) => (
    <main data-testid="admin-layout">{children}</main>
  ),
  AdminOverviewPage: () => <section data-testid="admin-overview-page" />,
  AdminUsersPage: () => <section data-testid="admin-users-page" />,
  AdminProjectsPage: () => <section data-testid="admin-projects-page" />,
  AdminRunsPage: () => <section data-testid="admin-runs-page" />,
  AdminFailuresPage: () => <section data-testid="admin-failures-page" />,
  AdminAuditPage: () => <section data-testid="admin-audit-page" />,
}));

vi.mock("./pages/autopilot/AutopilotRoutePage", () => ({
  default: () => <main data-testid="autopilot-route-page" />,
}));

vi.mock("./pages/tasks", () => ({
  TasksPage: () => <main data-testid="tasks-page" />,
  TaskDetailPage: () => <main data-testid="task-detail-page" />,
}));

vi.mock("./pages/debug/DebugPage", () => ({
  default: () => <main data-testid="debug-page" />,
}));

vi.mock(
  "./pages/autopilot/right-rail/streaming-doc/workbench/WorkbenchFixturePage",
  () => ({
    default: () => <main data-testid="workbench-fixture-page" />,
  })
);

vi.mock("./pages/nl-command/LegacyCommandCenterPage", () => ({
  default: () => <main data-testid="legacy-command-page" />,
}));

vi.mock("./pages/lineage/LineagePage", () => ({
  default: () => <main data-testid="lineage-page" />,
}));

vi.mock("./pages/NotFound", () => ({
  default: () => <main data-testid="not-found-page" />,
}));

describe("AppShell fixed sidebar layout", () => {
  beforeEach(() => {
    deployTargetState.isGitHubPages = false;
    locationState.setLocation.mockClear();
    useAuthStore.getState().resetForTest();
  });

  function signInForShell() {
    useAuthStore.setState({
      sessionChecked: true,
      currentUser: {
        id: "user-1",
        email: "user@example.com",
        displayName: "User",
        avatarUrl: null,
        role: "user",
        status: "active",
        emailVerified: true,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    });
  }

  it("offsets non-home desktop content by the fixed sidebar width", () => {
    signInForShell();
    locationState.current = "/tasks";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = renderToStaticMarkup(<AppShell />);
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).toContain('data-testid="app-sidebar"');
    expect(markup).toContain('data-testid="tasks-page"');
    expect(shell).toContain("--sidebar-width:248px");
    expect(shell).toContain("padding-left:248px");
  });

  it("keeps the app sidebar visible for project-scoped task center routes", () => {
    signInForShell();
    locationState.current = "/projects/project-1/tasks";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = renderToStaticMarkup(<AppShell />);
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).toContain('data-testid="app-sidebar"');
    expect(markup).toContain('data-testid="tasks-page"');
    expect(shell).toContain("--sidebar-width:248px");
    expect(shell).toContain("padding-left:248px");
  });

  it("does not offset the home page because it uses embedded scene chrome", () => {
    signInForShell();
    locationState.current = "/";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = renderToStaticMarkup(<AppShell />);
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).not.toContain('data-testid="app-sidebar"');
    expect(markup).toContain('data-testid="home-page"');
    expect(shell).toContain("--sidebar-width:0px");
    expect(shell).toContain("padding-left:0");
  });

  it("does not keep the task sidebar offset when the home URL has query or hash state", () => {
    signInForShell();
    locationState.current = "/?from=tasks#autopilot";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = renderToStaticMarkup(<AppShell />);
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).not.toContain('data-testid="app-sidebar"');
    expect(shell).toContain("--sidebar-width:0px");
    expect(shell).toContain("padding-left:0");
    expect(shell).not.toContain("transition-[padding-left]");
  });

  it("keeps the login page free of app chrome", () => {
    locationState.current = "/login";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = renderToStaticMarkup(<AppShell />);
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).not.toContain('data-testid="app-sidebar"');
    expect(markup).not.toContain('data-testid="config-panel"');
    expect(markup).not.toContain('data-testid="recovery-dialog"');
    expect(markup).toContain('data-testid="auth-page"');
    expect(shell).toContain("--sidebar-width:0px");
    expect(shell).toContain("padding-left:0");
  });

  it("redirects the login page to project space on GitHub Pages", () => {
    deployTargetState.isGitHubPages = true;
    locationState.current = "/login";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = renderToStaticMarkup(<AppShell />);

    expect(markup).not.toContain('data-testid="auth-page"');
    expect(markup).not.toContain("Sign in");
  });

  it("classifies project workspace routes for unauthenticated redirect", () => {
    expect(isProjectWorkspaceLocation("/")).toBe(true);
    expect(isProjectWorkspaceLocation("/tasks")).toBe(true);
    expect(isProjectWorkspaceLocation("/tasks/task-1")).toBe(true);
    expect(isProjectWorkspaceLocation("/specs?tab=routes")).toBe(true);
    expect(isProjectWorkspaceLocation("/replay/mission-1#timeline")).toBe(true);
    expect(isProjectWorkspaceLocation("/login")).toBe(false);
    expect(isProjectWorkspaceLocation("/admin")).toBe(false);
    expect(isProjectWorkspaceLocation("/debug")).toBe(false);
  });

  it("mounts the direct spec documents workbench fixture route before debug sections", () => {
    signInForShell();
    locationState.current = "/debug/autopilot-spec-documents-workbench";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = renderToStaticMarkup(<AppShell />);

    expect(markup).toContain('data-testid="workbench-fixture-page"');
    expect(markup).not.toContain('data-testid="debug-page"');
  });

  it("keeps authenticated project workspace access in place", () => {
    signInForShell();
    locationState.current = "/";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    renderToStaticMarkup(<AppShell />);

    expect(locationState.setLocation).not.toHaveBeenCalledWith("/login");
  });
});
