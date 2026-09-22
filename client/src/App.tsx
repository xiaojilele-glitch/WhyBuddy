import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import {
  AUTOPILOT_PATH,
  getProjectTasksPath,
  isProjectTasksPath,
  PROJECTS_PATH,
  REPLAY_PATH_PREFIX,
  SLIDERULE_PATH,
} from "@/components/navigation-config";
import { LegacyUnmaintainedBanner } from "@/components/LegacyUnmaintainedBanner";
import AgentLoopPage, {
  getAgentLoopSliderulePath,
  getAgentLoopWorkbenchPath,
} from "@/pages/agent-loop/AgentLoopPage";

import { AppSidebar } from "./components/AppSidebar";
import { ConfigPanel } from "./components/ConfigPanel";
import ErrorBoundary from "./components/ErrorBoundary";
import { MobileTabBar } from "./components/MobileTabBar";
import { RecoveryDialog } from "./components/RecoveryDialog";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useRecoveryDetection } from "./hooks/useRecoveryDetection";
import { useViewportTier } from "./hooks/useViewportTier";
import { IS_GITHUB_PAGES } from "./lib/deploy-target";
import { AuthProvider, useAuth } from "./lib/use-auth";
import { useProjectStore } from "./lib/project-store";
import { useAppStore } from "./lib/store";

// 路由级代码分割：AgentLoopPage（/agent-loop/sliderule 演示主入口）保持静态引入，
// 其余页面全部懒加载——Replay 的 three.js、Autopilot、Admin、驾驶舱等重依赖
// 不再进入首屏主包（GitHub Pages 静态演示首包从 ~8.9MB 压回按需加载）。
const ReplayPage = lazy(() =>
  import("@/components/replay/ReplayPage").then(m => ({ default: m.ReplayPage }))
);
const DebugPage = lazy(() => import("@/pages/debug/DebugPage"));
const LegacyCommandCenterPage = lazy(
  () => import("@/pages/nl-command/LegacyCommandCenterPage")
);
const LineagePage = lazy(() => import("@/pages/lineage/LineagePage"));
const ProjectCockpitHome = lazy(() => import("./pages/ProjectCockpitHome"));
const AutopilotRoutePage = lazy(
  () => import("./pages/autopilot/AutopilotRoutePage")
);
// 全站唯一的登录页（2026-08-03）：接 Neon 身份体系。
// 旧的 `/login` + AuthPage（Node/MySQL 账号体系）已整套删除，只留一条重定向。
const MianTuanAuthPage = lazy(() => import("./pages/auth/MianTuanAuthPage"));
const SpecCenterPage = lazy(() => import("./pages/specs/SpecCenterPage"));
const TaskDetailPage = lazy(() =>
  import("./pages/tasks").then(m => ({ default: m.TaskDetailPage }))
);
const TasksPage = lazy(() =>
  import("./pages/tasks").then(m => ({ default: m.TasksPage }))
);
const AutopilotSpecDocumentsWorkbenchFixturePage = lazy(
  () =>
    import("./pages/autopilot/right-rail/streaming-doc/workbench/WorkbenchFixturePage")
);
const SlideRuleDevPage = lazy(() => import("./pages/SlideRuleDev"));
const FreeformPreviewPage = lazy(
  () => import("./pages/sliderule/live-runtime/FreeformPreviewScreen")
);

/** 懒加载路由 chunk 拉取期间的轻量占位（主入口 AgentLoopPage 不经过这里）。 */
function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      加载中…
    </div>
  );
}

const routerBase =
  import.meta.env.BASE_URL === "/"
    ? ""
    : import.meta.env.BASE_URL.replace(/\/$/, "");
const AGENT_LOOP_PATH = "/agent-loop";

/** 书签仍可达的旧路由：页顶标明不再维护，不 404。
 *  ⚠ 不能用裸 fragment 包 `h-screen` 子页（Autopilot / Tasks 驾驶舱）。
 *  条在上面、子页自己 100vh，底栏会被顶到折页下面——跟当初不包
 *  AgentLoopPage 是同一类裁切，只是换了套壳。 */
function LegacyUnmaintainedRoute({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="legacy-unmaintained-route"
      className="flex h-screen min-h-0 flex-col"
    >
      <LegacyUnmaintainedBanner />
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path={"/"}>
        {() => (
          <RedirectRoute to={getAgentLoopSliderulePath()} />
        )}
      </Route>
      <Route path={PROJECTS_PATH}>
        {() => (
          <LegacyUnmaintainedRoute>
            <ProjectCockpitHome />
          </LegacyUnmaintainedRoute>
        )}
      </Route>
      <Route path={AUTOPILOT_PATH}>
        {() => (
          <LegacyUnmaintainedRoute>
            <AutopilotRoutePage />
          </LegacyUnmaintainedRoute>
        )}
      </Route>
      <Route path={`${PROJECTS_PATH}/:projectId/tasks/:taskId`}>
        {params => (
          <LegacyUnmaintainedRoute>
            <ProjectTaskRoute
              projectId={params.projectId}
              taskId={params.taskId || null}
            />
          </LegacyUnmaintainedRoute>
        )}
      </Route>
      <Route path={`${PROJECTS_PATH}/:projectId/tasks`}>
        {params => (
          <LegacyUnmaintainedRoute>
            <ProjectTasksRoute projectId={params.projectId} />
          </LegacyUnmaintainedRoute>
        )}
      </Route>
      <Route path={`${PROJECTS_PATH}/:projectId`}>
        {params => <ProjectAutopilotRedirect projectId={params.projectId} />}
      </Route>
      <Route path={"/signin"}>
        {() =>
          IS_GITHUB_PAGES ? (
            <RedirectRoute to={getAgentLoopWorkbenchPath()} />
          ) : (
            <MianTuanAuthPage />
          )
        }
      </Route>
      {/* 旧登录页的地址。留着重定向而不是直接 404——外部链接、书签、
          还有代码里历史遗留的跳转都指着它。 */}
      <Route path={"/login"}>
        {() => (
          <RedirectRoute to={IS_GITHUB_PAGES ? PROJECTS_PATH : "/signin"} />
        )}
      </Route>
      <Route path={"/admin/users"}>
        {() => <RedirectRoute to="/agent-loop/admin/users" />}
      </Route>
      <Route path={"/admin/projects"}>
        {() => <RedirectRoute to="/agent-loop/admin/projects" />}
      </Route>
      <Route path={"/admin/runs"}>
        {() => <RedirectRoute to="/agent-loop/admin/runs" />}
      </Route>
      <Route path={"/admin/failures"}>
        {() => <RedirectRoute to="/agent-loop/admin/failures" />}
      </Route>
      <Route path={"/admin/audit"}>
        {() => <RedirectRoute to="/agent-loop/admin/audit" />}
      </Route>
      <Route path={"/admin"}>
        {() => <RedirectRoute to="/agent-loop/admin" />}
      </Route>
      <Route path={"/tasks"}>
        {() => (
          <LegacyUnmaintainedRoute>
            <TasksPage />
          </LegacyUnmaintainedRoute>
        )}
      </Route>
      <Route path={"/specs"} component={SpecCenterPage} />
      <Route path={"/tasks/:taskId"}>
        {params => (
          <LegacyUnmaintainedRoute>
            <TaskDetailRoute taskId={params.taskId} />
          </LegacyUnmaintainedRoute>
        )}
      </Route>
      <Route path={`${REPLAY_PATH_PREFIX}/:missionId`}>
        {params => <ReplayPage missionId={params.missionId || ""} />}
      </Route>
      <Route
        path={"/debug/autopilot-spec-documents-workbench"}
        component={AutopilotSpecDocumentsWorkbenchFixturePage}
      />
      <Route path={"/debug"} component={DebugPage} />
      <Route path={"/debug/:section"} component={DebugPage} />
      <Route path={`${SLIDERULE_PATH}/dev`} component={SlideRuleDevPage} />
      {/* FreeformInsight 自我校验闭环专用隔离预览页（无聊天面板/应用外壳噪音，
          只渲染内容区本身）——E2B 沙盒里的 Playwright 截图目标。 */}
      <Route path={`${SLIDERULE_PATH}/freeform-preview/:pid`}>
        {params => <FreeformPreviewPage pid={params.pid} />}
      </Route>
      <Route path={SLIDERULE_PATH}>
        {() => <RedirectRoute to={getAgentLoopSliderulePath()} />}
      </Route>
      {/* Legacy support for old /AgentLoop casing (case-insensitive web habit); redirect to canonical lowercase. */}
      <Route path={"/AgentLoop"}>
        {() => <RedirectRoute to={getAgentLoopSliderulePath()} />}
      </Route>
      <Route path={"/AgentLoop/"}>
        {() => <RedirectRoute to={getAgentLoopSliderulePath()} />}
      </Route>
      <Route path={`${AGENT_LOOP_PATH}/sliderule`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/workbench`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/workbench/legacy`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/skills`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/components`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/help`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/settings`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/settings/legacy`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/dashboard`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/admin/:section`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/admin`} component={AgentLoopPage} />
      <Route path={`${AGENT_LOOP_PATH}/runs/:runId`} component={AgentLoopPage} />
      <Route path={AGENT_LOOP_PATH} component={AgentLoopPage} />
      {/* Direct /sliderule redirects above; AgentLoop hosts the embedded 推演 surface. */}
      <Route path={"/command-center/legacy"}>
        {() => <LegacyCommandCenterPage />}
      </Route>
      <Route path={"/command-center"}>
        {() => <RedirectRoute to={PROJECTS_PATH} />}
      </Route>
      <Route path={"/lineage"} component={LineagePage} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function RedirectRoute({ to }: { to: string }) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation(to);
  }, [setLocation, to]);

  return null;
}

function ProjectAutopilotRedirect({ projectId }: { projectId?: string }) {
  const [, setLocation] = useLocation();
  const ensureReady = useProjectStore(state => state.ensureReady);
  const selectProject = useProjectStore(state => state.selectProject);

  useEffect(() => {
    ensureReady();
    if (projectId) {
      selectProject(projectId);
    }
    setLocation(AUTOPILOT_PATH);
  }, [ensureReady, projectId, selectProject, setLocation]);

  return null;
}

function ProjectTasksRoute({ projectId }: { projectId?: string }) {
  const ensureReady = useProjectStore(state => state.ensureReady);
  const selectProject = useProjectStore(state => state.selectProject);

  useEffect(() => {
    ensureReady();
    if (projectId) {
      selectProject(projectId);
    }
  }, [ensureReady, projectId, selectProject]);

  return <TasksPage projectId={projectId ?? null} />;
}

function ProjectTaskRoute({
  projectId,
  taskId,
}: {
  projectId?: string;
  taskId?: string | null;
}) {
  const [, setLocation] = useLocation();
  const ensureReady = useProjectStore(state => state.ensureReady);
  const selectProject = useProjectStore(state => state.selectProject);

  useEffect(() => {
    ensureReady();
    if (projectId) {
      selectProject(projectId);
    }
  }, [ensureReady, projectId, selectProject]);

  return (
    <TaskDetailPage
      taskId={taskId || null}
      projectId={projectId ?? null}
      onBack={() => setLocation(getProjectTasksPath(projectId))}
    />
  );
}

function TaskDetailRoute({ taskId }: { taskId?: string }) {
  const [, setLocation] = useLocation();

  return (
    <TaskDetailPage
      taskId={taskId || null}
      onBack={() => setLocation("/tasks")}
    />
  );
}

function LocaleSync() {
  const locale = useAppStore(state => state.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
}

function RecoveryGuard() {
  const [, setLocation] = useLocation();
  const {
    candidate,
    isRestoring,
    restoreProgress,
    restorePhase,
    handleResume,
    handleDiscard,
  } = useRecoveryDetection(setLocation);

  if (!candidate) return null;

  return (
    <RecoveryDialog
      candidate={candidate}
      onResume={handleResume}
      onDiscard={handleDiscard}
      isRestoring={isRestoring}
      restoreProgress={restoreProgress}
      restorePhase={restorePhase}
    />
  );
}

/**
 * 把登录用户接到项目 store 上。
 *
 * 旧账号体系下掉后（2026-08-03），身份来自 `AuthProvider`（新的 Neon 体系）。
 * 原来这里还配着一个 `AuthBootstrap` 负责首屏 fetchMe——现在那件事是
 * AuthProvider 自己做的，组件删掉了。
 */
function AuthProjectOwnerBridge() {
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const setActiveOwner = useProjectStore(state => state.setActiveOwner);

  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    // Same isolation: no owner bridging for the standalone V5 sliderule workspace.
    if (isSlideRuleLocation(typeof window !== 'undefined' ? window.location.pathname : '')) return;
    if (isAgentLoopLocation(typeof window !== 'undefined' ? window.location.pathname : '')) return;
    setActiveOwner(currentUserId);
  }, [currentUserId, setActiveOwner]);

  return null;
}

function isHomeLocation(location: string) {
  const [pathname] = location.trim().split(/[?#]/, 1);
  return (
    pathname === "" ||
    pathname === "/" ||
    (pathname.startsWith(PROJECTS_PATH) && !isProjectTasksPath(pathname)) ||
    pathname === AUTOPILOT_PATH
  );
}

/**
 * 登录类页面：**整屏渲染，不套应用外壳**。
 *
 * 套上外壳的话，未登录的人在登录页左边看到的是一整列自己点不动的功能菜单——
 * 既占地方又误导。/signin 是面团的登录页（2026-08-03 新增），/login 是旧账号
 * 体系那个，两个都要排除。
 */
function isAuthLocation(location: string) {
  const [pathname] = location.trim().split(/[?#]/, 1);
  return pathname === "/login" || pathname === "/signin";
}

function isSlideRuleLocation(location: string) {
  const [pathname] = location.trim().split(/[?#]/, 1);
  return pathname === SLIDERULE_PATH || pathname.startsWith(`${SLIDERULE_PATH}/`);
}

export function isAgentLoopLocation(location: string) {
  // Robust match: case-insensitive + ignore trailing slash (common when typing URLs or bookmarks).
  // Supports both canonical "/agent-loop" and legacy "/AgentLoop" (or its lower "agentloop") forms
  // so chrome-free sidebar suppression always works regardless of how the URL was entered.
  const [raw] = location.trim().split(/[?#]/, 1);
  let pathname = (raw || "/").toLowerCase();
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  const target = AGENT_LOOP_PATH.toLowerCase();
  const legacyNoHyphen = "/agentloop";
  return (
    pathname === target ||
    pathname.startsWith(`${target}/`) ||
    pathname === legacyNoHyphen ||
    pathname.startsWith(`${legacyNoHyphen}/`)
  );
}

export function isProjectWorkspaceLocation(location: string) {
  const [pathname] = location.trim().split(/[?#]/, 1);
  if (pathname === "" || pathname === "/") return true;
  if (isSlideRuleLocation(location)) return false; // V5 SlideRule is independent chrome-free workspace
  if (isAgentLoopLocation(location)) return false; // AgentLoop is a Python-backed runtime console outside project auth chrome.
  return (
    pathname.startsWith(PROJECTS_PATH) ||
    pathname === AUTOPILOT_PATH ||
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/specs") ||
    pathname.startsWith(REPLAY_PATH_PREFIX)
  );
}

function AuthRouteGuard() {
  const [location, setLocation] = useLocation();
  const { user, ready } = useAuth();

  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    // 必须等 ready：未就绪时 user 恒为 null，不等就会把已登录的人也踢去登录页。
    if (ready && !user && isProjectWorkspaceLocation(location)) {
      setLocation(`/signin?next=${encodeURIComponent(location)}`);
    }
  }, [user, ready, location, setLocation]);

  return null;
}

export function AppShell() {
  const { isMobile, isTablet } = useViewportTier();
  const [location] = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setSidebarCollapsed(isTablet);
  }, [isTablet]);

  const sidebarWidth = isMobile ? 0 : sidebarCollapsed ? 64 : 248;
  const isHome = isHomeLocation(location);
  const isAuth = isAuthLocation(location);
  const isSlideRule = isSlideRuleLocation(location);
  const isAgentLoop = isAgentLoopLocation(location);
  const isChromeFree = isHome || isAuth || isSlideRule || isAgentLoop;

  return (
    <>
      {!isAuth && !isChromeFree && <RecoveryGuard />}
      {!isAuth && !isChromeFree && <AuthRouteGuard />}

      {!isMobile && !isChromeFree && (
        <AppSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(current => !current)}
        />
      )}

      <div
        className={
          isChromeFree
            ? "min-h-screen"
            : "min-h-screen transition-[padding-left] duration-[250ms] ease-in-out"
        }
        style={
          {
            "--sidebar-width": `${isChromeFree ? 0 : sidebarWidth}px`,
            paddingLeft: isChromeFree ? 0 : sidebarWidth,
          } as React.CSSProperties
        }
      >
        <Suspense fallback={<RouteLoadingFallback />}>
          <Router />
        </Suspense>
      </div>

      {isMobile && !isAuth && !isChromeFree && <MobileTabBar />}

      {!isAuth && !isChromeFree && <ConfigPanel />}
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <LocaleSync />
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: "hsl(var(--card))",
                backdropFilter: "blur(12px)",
                border: "1px solid hsl(var(--border))",
                color: "hsl(var(--foreground))",
                borderRadius: "16px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
              },
            }}
          />
          {/* AuthProvider 提到根：登录页、侧栏、管理台、应用中心共用同一份
              登录态。原来它只包着 DashboardApp，导致 /signin 拿到的是 Context
              的默认值（user 恒 null、refresh 是空函数），"已登录就别停在登录页"
              那条逻辑根本不会触发。 */}
          <AuthProvider>
            <WouterRouter base={routerBase}>
              <AuthProjectOwnerBridge />
              <AppShell />
            </WouterRouter>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
