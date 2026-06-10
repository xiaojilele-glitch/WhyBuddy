import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { useEffect, useState } from "react";

import {
  AUTOPILOT_PATH,
  getProjectTasksPath,
  isProjectTasksPath,
  PROJECTS_PATH,
  REPLAY_PATH_PREFIX,
  WHYBUDDY_PATH,
} from "@/components/navigation-config";
import { ReplayPage } from "@/components/replay/ReplayPage";
import DebugPage from "@/pages/debug/DebugPage";
import LegacyCommandCenterPage from "@/pages/nl-command/LegacyCommandCenterPage";
import LineagePage from "@/pages/lineage/LineagePage";

import { AppSidebar } from "./components/AppSidebar";
import { ConfigPanel } from "./components/ConfigPanel";
import ErrorBoundary from "./components/ErrorBoundary";
import { MobileTabBar } from "./components/MobileTabBar";
import { RecoveryDialog } from "./components/RecoveryDialog";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useRecoveryDetection } from "./hooks/useRecoveryDetection";
import { useViewportTier } from "./hooks/useViewportTier";
import { useAuthStore } from "./lib/auth-store";
import { IS_GITHUB_PAGES } from "./lib/deploy-target";
import { useProjectStore } from "./lib/project-store";
import { useAppStore } from "./lib/store";
import ProjectCockpitHome from "./pages/ProjectCockpitHome";
import {
  AdminAuditPage,
  AdminFailuresPage,
  AdminLayout,
  AdminOverviewPage,
  AdminProjectsPage,
  AdminRunsPage,
  AdminUsersPage,
} from "./pages/admin/AdminLayout";
import AutopilotRoutePage from "./pages/autopilot/AutopilotRoutePage";
import AuthPage from "./pages/auth/AuthPage";
import SpecCenterPage from "./pages/specs/SpecCenterPage";
import { TaskDetailPage, TasksPage } from "./pages/tasks";
import AutopilotSpecDocumentsWorkbenchFixturePage from "./pages/autopilot/right-rail/streaming-doc/workbench/WorkbenchFixturePage";
import WhyBuddyPage from "./pages/WhyBuddy";

const routerBase =
  import.meta.env.BASE_URL === "/"
    ? ""
    : import.meta.env.BASE_URL.replace(/\/$/, "");

function Router() {
  return (
    <Switch>
      <Route path={"/"}>{() => <RedirectRoute to={PROJECTS_PATH} />}</Route>
      <Route path={PROJECTS_PATH}>{() => <ProjectCockpitHome />}</Route>
      <Route path={AUTOPILOT_PATH} component={AutopilotRoutePage} />
      <Route path={`${PROJECTS_PATH}/:projectId/tasks/:taskId`}>
        {params => (
          <ProjectTaskRoute
            projectId={params.projectId}
            taskId={params.taskId || null}
          />
        )}
      </Route>
      <Route path={`${PROJECTS_PATH}/:projectId/tasks`}>
        {params => <ProjectTasksRoute projectId={params.projectId} />}
      </Route>
      <Route path={`${PROJECTS_PATH}/:projectId`}>
        {params => <ProjectAutopilotRedirect projectId={params.projectId} />}
      </Route>
      <Route path={"/login"}>
        {() =>
          IS_GITHUB_PAGES ? <RedirectRoute to={PROJECTS_PATH} /> : <AuthPage />
        }
      </Route>
      <Route path={"/admin"}>
        {() => (
          <AdminLayout>
            <AdminOverviewPage />
          </AdminLayout>
        )}
      </Route>
      <Route path={"/admin/users"}>
        {() => (
          <AdminLayout>
            <AdminUsersPage />
          </AdminLayout>
        )}
      </Route>
      <Route path={"/admin/projects"}>
        {() => (
          <AdminLayout>
            <AdminProjectsPage />
          </AdminLayout>
        )}
      </Route>
      <Route path={"/admin/runs"}>
        {() => (
          <AdminLayout>
            <AdminRunsPage />
          </AdminLayout>
        )}
      </Route>
      <Route path={"/admin/failures"}>
        {() => (
          <AdminLayout>
            <AdminFailuresPage />
          </AdminLayout>
        )}
      </Route>
      <Route path={"/admin/audit"}>
        {() => (
          <AdminLayout>
            <AdminAuditPage />
          </AdminLayout>
        )}
      </Route>
      <Route path={"/tasks"}>{() => <TasksPage />}</Route>
      <Route path={"/specs"} component={SpecCenterPage} />
      <Route path={"/tasks/:taskId"}>
        {params => <TaskDetailRoute taskId={params.taskId} />}
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
      <Route path={WHYBUDDY_PATH} component={WhyBuddyPage} />
      {/* V5 chrome-free workspace: WhyBuddy is deliberately isolated from the old stage sequencer / AppShell chrome.
          All guards, sidebar, mobile tab, config panel, and project-workspace auth checks are skipped for this route
          (see isChromeFree / isWhyBuddyLocation / isProjectWorkspaceLocation above). This keeps the V5 demo clean.
          V5 session state is managed via the runtime's per-sessionId store (loadOrCreate / save by sessionId)
          — completely independent of project/auth/recovery stores. */}
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

function AuthBootstrap() {
  const fetchMe = useAuthStore(state => state.fetchMe);

  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    // V5 /whybuddy is chrome-free and deliberately isolated from auth/project stores.
    // Skip fetchMe here to eliminate the unconditional 401 console noise on the demo route
    // (the route already skips RecoveryGuard, AuthRouteGuard, sidebar, etc. via isChromeFree).
    if (isWhyBuddyLocation(typeof window !== 'undefined' ? window.location.pathname : '')) return;
    void fetchMe();
  }, [fetchMe]);

  return null;
}

function AuthProjectOwnerBridge() {
  const currentUserId = useAuthStore(state => state.currentUser?.id ?? null);
  const setActiveOwner = useProjectStore(state => state.setActiveOwner);

  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    // Same isolation: no owner bridging for the standalone V5 whybuddy workspace.
    if (isWhyBuddyLocation(typeof window !== 'undefined' ? window.location.pathname : '')) return;
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

function isAuthLocation(location: string) {
  const [pathname] = location.trim().split(/[?#]/, 1);
  return pathname === "/login";
}

function isWhyBuddyLocation(location: string) {
  const [pathname] = location.trim().split(/[?#]/, 1);
  return pathname === WHYBUDDY_PATH || pathname.startsWith(`${WHYBUDDY_PATH}/`);
}

export function isProjectWorkspaceLocation(location: string) {
  const [pathname] = location.trim().split(/[?#]/, 1);
  if (pathname === "" || pathname === "/") return true;
  if (isWhyBuddyLocation(location)) return false; // V5 WhyBuddy is independent chrome-free workspace
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
  const currentUser = useAuthStore(state => state.currentUser);
  const loading = useAuthStore(state => state.loading);
  const sessionChecked = useAuthStore(state => state.sessionChecked);

  useEffect(() => {
    if (IS_GITHUB_PAGES) return;
    if (
      sessionChecked &&
      !loading &&
      !currentUser &&
      isProjectWorkspaceLocation(location)
    ) {
      setLocation("/login");
    }
  }, [currentUser, loading, location, sessionChecked, setLocation]);

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
  const isWhyBuddy = isWhyBuddyLocation(location);
  const isChromeFree = isHome || isAuth || isWhyBuddy;

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
        <Router />
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
          <AuthBootstrap />
          <AuthProjectOwnerBridge />
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
          <WouterRouter base={routerBase}>
            <AppShell />
          </WouterRouter>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
