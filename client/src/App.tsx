import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import { useEffect, useState } from "react";

import { REPLAY_PATH_PREFIX } from "@/components/navigation-config";
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
import { useAppStore } from "./lib/store";
import Home from "./pages/Home";
import { TaskDetailPage, TasksPage } from "./pages/tasks";

const routerBase =
  import.meta.env.BASE_URL === "/"
    ? ""
    : import.meta.env.BASE_URL.replace(/\/$/, "");

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/tasks"}>{() => <TasksPage />}</Route>
      <Route path={"/tasks/:taskId"}>
        {params => <TaskDetailRoute taskId={params.taskId} />}
      </Route>
      <Route path={`${REPLAY_PATH_PREFIX}/:missionId`}>
        {params => <ReplayPage missionId={params.missionId || ""} />}
      </Route>
      <Route path={"/debug"} component={DebugPage} />
      <Route path={"/debug/:section"} component={DebugPage} />
      <Route path={"/command-center/legacy"}>
        {() => <LegacyCommandCenterPage />}
      </Route>
      <Route path={"/command-center"}>
        {() => <RedirectRoute to="/" />}
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

function AppShell() {
  const { isMobile, isTablet } = useViewportTier();
  const [location] = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setSidebarCollapsed(isTablet);
  }, [isTablet]);

  const sidebarWidth = isMobile ? 0 : sidebarCollapsed ? 64 : 240;

  return (
    <>
      <RecoveryGuard />

      {!isMobile && location !== "/" && (
        <AppSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(current => !current)}
        />
      )}

      <div
        style={
          {
            "--sidebar-width": `${location === "/" ? 0 : sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <Router />
      </div>

      {isMobile && <MobileTabBar />}

      <ConfigPanel />
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
          <WouterRouter base={routerBase}>
            <AppShell />
          </WouterRouter>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
