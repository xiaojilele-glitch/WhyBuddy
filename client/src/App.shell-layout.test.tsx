import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authState, deployTargetState, locationState, viewportState } =
  vi.hoisted(() => ({
    // 身份来自新账号体系（2026-08-03）；旧的 useAuthStore 已随整套删除。
    authState: {
      user: null as {
        id: string;
        email: string;
        displayName: string | null;
        isSuperuser: boolean;
        isVerified: boolean;
        createdAt: string;
      } | null,
      ready: true,
    },
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

import {
  AppShell,
  isAgentLoopLocation,
  isProjectWorkspaceLocation,
} from "./App";

vi.mock("./lib/use-auth", () => ({
  // Provider 在这份测试里退化成透传：AppShell 只读 useAuth，不需要真去 fetch。
  AuthProvider: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  useAuth: () => ({
    user: authState.user,
    ready: authState.ready,
    capabilities: {
      loggedIn: Boolean(authState.user),
      isSuperuser: Boolean(authState.user?.isSuperuser),
      can: {
        browse: true,
        viewApp: true,
        fork: Boolean(authState.user),
        drive: Boolean(authState.user),
        manageOwn: Boolean(authState.user),
      },
    },
    refresh: async () => {},
    signOut: async () => {},
  }),
  canWriteApp: () => false,
}));

vi.mock("./lib/deploy-target", () => ({
  CAN_USE_ADVANCED_RUNTIME: true,
  GITHUB_REPOSITORY: "opencroc/sliderule",
  GITHUB_REPOSITORY_URL: "https://github.com/opencroc/sliderule",
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
      React.ReactNode | ((params: Record<string, string>) => React.ReactNode);
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
      (path === "/agent-loop/sliderule" &&
        current === "/agent-loop/sliderule") ||
      (path === "/agent-loop/workbench" &&
        current === "/agent-loop/workbench") ||
      (path === "/agent-loop/settings" && current === "/agent-loop/settings") ||
      (path === "/agent-loop/runs/:runId" &&
        current.startsWith("/agent-loop/runs/")) ||
      (path === "/agent-loop" && current === "/agent-loop") ||
      (path === "/sliderule" && current === "/sliderule") ||
      (path === "/AgentLoop" && current === "/AgentLoop") ||
      (path === "/AgentLoop/" && current === "/AgentLoop/") ||
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

vi.mock("./pages/ProjectCockpitHome", () => ({
  default: () => <main data-testid="home-page" />,
}));

vi.mock("./pages/auth/MianTuanAuthPage", () => ({
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

vi.mock("./pages/agent-loop/AgentLoopPage", () => ({
  default: () => <main data-testid="agent-loop-page" />,
  getAgentLoopSliderulePath: () => "/agent-loop/sliderule",
  getAgentLoopWorkbenchPath: () => "/agent-loop/workbench",
}));

vi.mock("./pages/SlideRule", () => ({
  default: () => <main data-testid="sliderule-page" />,
}));

vi.mock("./pages/NotFound", () => ({
  default: () => <main data-testid="not-found-page" />,
}));

const SUSPENSE_FALLBACK = "加载中…";
/** 等懒加载 resolve 的重试上限。见下方注释：不是越小越快，是越小越容易假红。 */
const LAZY_RESOLVE_ATTEMPTS = 60;

/**
 * 路由组件改为 React.lazy 之后，同步的 renderToStaticMarkup 首轮只能渲染出
 * Suspense fallback（"加载中…"）。这里首轮渲染触发懒加载工厂（mock 的动态
 * import 在 microtask 内 resolve），随后重渲拿到真实路由内容。
 *
 * ⚠ 2026-08-24：上限原本是 5，全量跑（597 个文件 · --maxWorkers=2）时会间歇性
 * 断在 fallback 上——4 次全量挂 2 次，单独跑这个文件却永远绿。5 个宏任务在空载
 * 下够、在满载下不够，而且**它和被测代码完全无关**：往依赖图里加一个新模块
 * （这次是 stage-frame-style）就足以把时序推过那条线。
 *
 * 提高上限不削弱判据——真实内容必须出现，断言一条没改；只是不再在 mock 还没
 * resolve 时提前放弃。上限调回 5 这条会重新变成间歇红，别改小。
 */
async function renderShellMarkup() {
  let markup = renderToStaticMarkup(<AppShell />);
  for (
    let attempt = 0;
    attempt < LAZY_RESOLVE_ATTEMPTS && markup.includes(SUSPENSE_FALLBACK);
    attempt++
  ) {
    await new Promise(resolve => setTimeout(resolve, 0));
    markup = renderToStaticMarkup(<AppShell />);
  }
  if (markup.includes(SUSPENSE_FALLBACK)) {
    throw new Error(
      `懒加载路由在 ${LAZY_RESOLVE_ATTEMPTS} 次重渲后仍停在 Suspense fallback——` +
        `这不是抖动，去查路由 mock 的动态 import 是不是真的 resolve 了。`
    );
  }
  return markup;
}

describe("AppShell fixed sidebar layout", () => {
  beforeEach(() => {
    deployTargetState.isGitHubPages = false;
    locationState.setLocation.mockClear();
    authState.user = null;
    authState.ready = true;
  });

  function signInForShell() {
    authState.user = {
      id: "user-1",
      email: "user@example.com",
      displayName: "User",
      isSuperuser: false,
      isVerified: true,
      createdAt: "2026-04-30T00:00:00.000Z",
    };
  }

  it("offsets non-home desktop content by the fixed sidebar width", async () => {
    signInForShell();
    locationState.current = "/tasks";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = await renderShellMarkup();
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).toContain('data-testid="app-sidebar"');
    expect(markup).toContain('data-testid="tasks-page"');
    expect(shell).toContain("--sidebar-width:248px");
    expect(shell).toContain("padding-left:248px");
  });

  it("keeps the app sidebar visible for project-scoped task center routes", async () => {
    signInForShell();
    locationState.current = "/projects/project-1/tasks";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = await renderShellMarkup();
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).toContain('data-testid="app-sidebar"');
    expect(markup).toContain('data-testid="tasks-page"');
    expect(shell).toContain("--sidebar-width:248px");
    expect(shell).toContain("padding-left:248px");
  });

  it("does not offset the home page because it uses embedded scene chrome", async () => {
    signInForShell();
    locationState.current = "/";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = await renderShellMarkup();
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).not.toContain('data-testid="app-sidebar"');
    expect(markup).toContain('data-testid="home-page"');
    expect(shell).toContain("--sidebar-width:0px");
    expect(shell).toContain("padding-left:0");
  });

  it("does not keep the task sidebar offset when the home URL has query or hash state", async () => {
    signInForShell();
    locationState.current = "/?from=tasks#autopilot";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = await renderShellMarkup();
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).not.toContain('data-testid="app-sidebar"');
    expect(shell).toContain("--sidebar-width:0px");
    expect(shell).toContain("padding-left:0");
    expect(shell).not.toContain("transition-[padding-left]");
  });

  it("keeps the login page free of app chrome", async () => {
    // 登录页从 /login 搬到了 /signin（旧账号体系整套下掉，2026-08-03）
    locationState.current = "/signin";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = await renderShellMarkup();
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).not.toContain('data-testid="app-sidebar"');
    expect(markup).not.toContain('data-testid="config-panel"');
    expect(markup).not.toContain('data-testid="recovery-dialog"');
    expect(markup).toContain('data-testid="auth-page"');
    expect(shell).toContain("--sidebar-width:0px");
    expect(shell).toContain("padding-left:0");
  });

  it("旧的 /login 只剩重定向，不再渲染任何登录界面", async () => {
    // 留着这条路径是为了外部链接和书签；它现在只做一次跳转（跳转发生在
    // useEffect 里，静态渲染下不会执行，所以断言的是"什么都不渲染"）。
    locationState.current = "/login";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = await renderShellMarkup();

    expect(markup).not.toContain('data-testid="auth-page"');
    expect(markup).not.toContain('data-testid="app-sidebar"');
  });

  it("redirects the login page to project space on GitHub Pages", async () => {
    deployTargetState.isGitHubPages = true;
    locationState.current = "/signin";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = await renderShellMarkup();

    expect(markup).not.toContain('data-testid="auth-page"');
    expect(markup).not.toContain("Sign in");
  });

  it("classifies project workspace routes for unauthenticated redirect", async () => {
    expect(isProjectWorkspaceLocation("/")).toBe(true);
    expect(isProjectWorkspaceLocation("/tasks")).toBe(true);
    expect(isProjectWorkspaceLocation("/tasks/task-1")).toBe(true);
    expect(isProjectWorkspaceLocation("/specs?tab=routes")).toBe(true);
    expect(isProjectWorkspaceLocation("/replay/mission-1#timeline")).toBe(true);
    expect(isProjectWorkspaceLocation("/login")).toBe(false);
    expect(isProjectWorkspaceLocation("/signin")).toBe(false);
    expect(isProjectWorkspaceLocation("/admin")).toBe(false);
    expect(isProjectWorkspaceLocation("/debug")).toBe(false);
    expect(isProjectWorkspaceLocation("/agent-loop")).toBe(false);
    // legacy casing still treated as non-project (chrome-free)
    expect(isProjectWorkspaceLocation("/AgentLoop")).toBe(false);
  });

  it("mounts AgentLoop as a chrome-free first-class route", async () => {
    signInForShell();
    locationState.current = "/agent-loop/workbench";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = await renderShellMarkup();
    const shell = markup.match(/<div class="min-h-screen[^>]*>/)?.[0] ?? "";

    expect(markup).toContain('data-testid="agent-loop-page"');
    expect(markup).not.toContain('data-testid="app-sidebar"');
    expect(shell).toContain("--sidebar-width:0px");
    expect(shell).toContain("padding-left:0");
  });

  it("mounts the AgentLoop shell for SlideRule routes and redirects the legacy SlideRule URL", async () => {
    signInForShell();
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    locationState.current = "/agent-loop";
    let markup = await renderShellMarkup();
    expect(markup).toContain('data-testid="agent-loop-page"');
    expect(markup).not.toContain('data-testid="sliderule-page"');

    locationState.current = "/agent-loop/sliderule";
    markup = await renderShellMarkup();
    expect(markup).toContain('data-testid="agent-loop-page"');
    expect(markup).not.toContain('data-testid="sliderule-page"');
    expect(markup).not.toContain('data-testid="app-sidebar"');

    locationState.current = "/sliderule";
    markup = await renderShellMarkup();
    expect(markup).not.toContain('data-testid="sliderule-page"');
    expect(markup).not.toContain('data-testid="agent-loop-page"');
  });

  it("chrome-free logic + isAgentLoopLocation is case and slash tolerant", async () => {
    // even if user visits /AgentLoop or /agent-loop/ the main sidebar must be suppressed
    expect(isAgentLoopLocation("/agent-loop")).toBe(true);
    expect(isAgentLoopLocation("/agent-loop/sliderule")).toBe(true);
    expect(isAgentLoopLocation("/agent-loop/workbench")).toBe(true);
    expect(isAgentLoopLocation("/agent-loop/settings")).toBe(true);
    expect(
      isAgentLoopLocation("/agent-loop/runs/2026-06-27T01-02-03-004Z")
    ).toBe(true);
    expect(isAgentLoopLocation("/AgentLoop")).toBe(true);
    expect(isAgentLoopLocation("/AGENT-LOOP/")).toBe(true);
    expect(isAgentLoopLocation("/agent-loop?foo=1")).toBe(true);
    expect(isAgentLoopLocation("/something")).toBe(false);
  });

  it("mounts the direct spec documents workbench fixture route before debug sections", async () => {
    signInForShell();
    locationState.current = "/debug/autopilot-spec-documents-workbench";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    const markup = await renderShellMarkup();

    expect(markup).toContain('data-testid="workbench-fixture-page"');
    expect(markup).not.toContain('data-testid="debug-page"');
  });

  it("keeps legacy product URLs reachable and marks them unmaintained", async () => {
    signInForShell();
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    locationState.current = "/tasks";
    let markup = await renderShellMarkup();
    expect(markup).toContain('data-testid="tasks-page"');
    expect(markup).toContain('data-testid="legacy-unmaintained-banner"');
    expect(markup).toContain("legacy，不维护");
    expect(markup).toContain('data-testid="legacy-unmaintained-route"');
    expect(markup).toContain("flex h-screen min-h-0 flex-col");
    expect(markup).toContain("min-h-0 flex-1 overflow-auto");

    locationState.current = "/autopilot";
    markup = await renderShellMarkup();
    expect(markup).toContain('data-testid="autopilot-route-page"');
    expect(markup).toContain('data-testid="legacy-unmaintained-banner"');
    expect(markup).toContain('data-testid="legacy-unmaintained-route"');

    locationState.current = "/projects";
    markup = await renderShellMarkup();
    expect(markup).toContain('data-testid="home-page"');
    expect(markup).toContain('data-testid="legacy-unmaintained-banner"');
    expect(markup).toContain("legacy，不维护");

    locationState.current = "/projects/project-1/tasks";
    markup = await renderShellMarkup();
    expect(markup).toContain('data-testid="tasks-page"');
    expect(markup).toContain('data-testid="legacy-unmaintained-banner"');

    locationState.current = "/agent-loop/sliderule";
    markup = await renderShellMarkup();
    expect(markup).toContain('data-testid="agent-loop-page"');
    expect(markup).not.toContain('data-testid="legacy-unmaintained-banner"');
    expect(markup).not.toContain('data-testid="legacy-unmaintained-route"');
  });

  it("keeps authenticated project workspace access in place", async () => {
    signInForShell();
    locationState.current = "/";
    viewportState.isMobile = false;
    viewportState.isTablet = false;

    await renderShellMarkup();

    expect(locationState.setLocation).not.toHaveBeenCalledWith(
      expect.stringContaining("/signin")
    );
  });
});
