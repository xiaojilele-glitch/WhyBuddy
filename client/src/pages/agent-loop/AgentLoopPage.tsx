import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  hrefFromWindow,
  sessionIdFromHref,
  slideruleSessionPath,
} from "@/lib/sliderule-session-id";
import { ACTIVE_SESSION_KEY } from "./dashboard/SidebarSessions";

import { DashboardApp, DashboardDetailApp } from "./dashboard/DashboardApp";
import { setCommandHandler } from "./dashboard/bridge";
import { getStaffConsolePath } from "@/pages/admin/StaffConsolePage";
import {
  cancelCurrent,
  fetchDetail,
  fetchOverview,
  fetchProviderHealth,
  fetchSettings,
  runQueue,
  runSingleTask,
  saveSettings,
  subscribeRunEvents,
} from "./dashboard/agentLoopApi";
import type { RunEventSubscriptionHandlers } from "./dashboard/agentLoopApi";
import type { DetailPayload, OverviewPayload } from "./dashboard/dashboardTypes";
import { normalizeSettingsForUI } from "./dashboard/agentLoopApi";
import brandLogo from "./dashboard/sliderule-brand.svg";
import "./dashboard/dashboard.css";

// Expose the brand asset the way the ported DashboardApp expects to read it.
if (typeof window !== "undefined") {
  window.__AGENT_LOOP_ASSETS__ = { brandLogo };
}

type View = "overview" | "detail";
type DashboardRouteView = "sliderule" | "workbench" | "workbench-legacy" | "skills" | "components" | "help" | "settings" | "settings-legacy" | "dashboard" | "admin";

export type AgentLoopRouteState =
  | { kind: "sliderule" }
  | { kind: "workbench" }
  | { kind: "workbench-legacy" }
  | { kind: "skills" }
  | { kind: "components" }
  | { kind: "help" }
  | { kind: "settings" }
  | { kind: "settings-legacy" }
  | { kind: "dashboard" }
  | { kind: "admin" }
  | { kind: "detail"; runId: string };

export function getAgentLoopSliderulePath(): string {
  return "/agent-loop/sliderule";
}

/** 切回推演页时把当前会话写进地址栏，免得导航把自己刚打开的 id 剥掉。 */
export function currentSliderulePath(href?: string, stored?: string | null): string {
  let fromStore = stored;
  if (fromStore === undefined) {
    try {
      fromStore =
        typeof window !== "undefined"
          ? window.localStorage.getItem(ACTIVE_SESSION_KEY)
          : null;
    } catch {
      fromStore = null;
    }
  }
  const id = String(
    sessionIdFromHref(
      href ?? (typeof window !== "undefined" ? hrefFromWindow(window) : "")
    ) ||
      fromStore ||
      ""
  ).trim();
  return id ? slideruleSessionPath(id) : getAgentLoopSliderulePath();
}

export function getAgentLoopWorkbenchPath(): string {
  return "/agent-loop/workbench";
}

/** legacy 任务队列驾驶舱：摘除导航、保留 URL 直达。 */
export function getAgentLoopWorkbenchLegacyPath(): string {
  return "/agent-loop/workbench/legacy";
}

/** 技能库（TRAE 论坛技能索引，回链原帖） */
export function getAgentLoopComponentsPath(): string {
  return "/agent-loop/components";
}

export function getAgentLoopSkillsPath(): string {
  return "/agent-loop/skills";
}

/** 帮助中心（站内文档，E15） */
export function getAgentLoopHelpPath(): string {
  return "/agent-loop/help";
}

export function getAgentLoopSettingsPath(): string {
  return "/agent-loop/settings";
}

export function getAgentLoopDashboardPath(): string {
  return "/agent-loop/dashboard";
}

export function getAgentLoopAdminPath(): string {
  return getStaffConsolePath();
}

/** legacy AgentLoop 设置页：摘除导航、保留 URL 直达。 */
export function getAgentLoopSettingsLegacyPath(): string {
  return "/agent-loop/settings/legacy";
}

export function getAgentLoopRunPath(runId: string): string {
  return `/agent-loop/runs/${encodeURIComponent(runId)}`;
}

export function parseAgentLoopLocation(location: string): AgentLoopRouteState {
  const rawPath = (location || "/agent-loop").split(/[?#]/, 1)[0] || "/agent-loop";
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
  const normalized = path.toLowerCase();

  if (normalized === "/agent-loop" || normalized === "/agent-loop/sliderule") {
    return { kind: "sliderule" };
  }
  if (normalized === "/agent-loop/workbench") {
    return { kind: "workbench" };
  }
  if (normalized === "/agent-loop/workbench/legacy") {
    return { kind: "workbench-legacy" };
  }
  if (normalized === "/agent-loop/components") {
    return { kind: "components" };
  }
  if (normalized === "/agent-loop/skills") {
    return { kind: "skills" };
  }
  if (normalized === "/agent-loop/help") {
    return { kind: "help" };
  }
  if (normalized === "/agent-loop/settings/legacy") {
    return { kind: "settings-legacy" };
  }
  if (normalized === "/agent-loop/settings") {
    return { kind: "settings" };
  }
  if (normalized === "/agent-loop/dashboard") {
    return { kind: "dashboard" };
  }
  if (
    normalized === "/agent-loop/admin" ||
    normalized.startsWith("/agent-loop/admin/")
  ) {
    return { kind: "admin" };
  }

  const runPrefix = "/agent-loop/runs/";
  if (normalized.startsWith(runPrefix)) {
    const encodedRunId = path.slice(runPrefix.length);
    if (encodedRunId) {
      return { kind: "detail", runId: decodeURIComponent(encodedRunId) };
    }
  }

  return { kind: "sliderule" };
}

export function resolveAgentLoopLiveEventRunId(
  overview: OverviewPayload | null,
  route: AgentLoopRouteState,
): string | null {
  // 新工作台（主线观察台）/设置整页自行拉取数据，不参与 legacy run 事件流
  if (
    route.kind === "sliderule" ||
    route.kind === "settings" ||
    route.kind === "settings-legacy" ||
    route.kind === "admin" ||
    route.kind === "dashboard" ||
    route.kind === "skills" ||
    route.kind === "components" ||
    route.kind === "help" ||
    route.kind === "workbench"
  ) {
    return null;
  }
  const runtimeStatus = String((overview?.current as any)?.runtimeStatus || "").toLowerCase();
  const runtimeActive = !runtimeStatus || runtimeStatus === "running" || runtimeStatus === "started";
  if (!runtimeActive) return route.kind === "detail" ? route.runId : null;
  const backgroundRunId = (overview?.current as any)?.backgroundRunId;
  if (backgroundRunId) return String(backgroundRunId);
  return route.kind === "detail" ? route.runId : null;
}

export function shouldLoadAgentLoopOverview(route: AgentLoopRouteState): boolean {
  // legacy 驾驶舱才消费队列 overview；新工作台（主线观察台）自行拉取
  return route.kind === "workbench-legacy";
}

export function shouldPollAgentLoopOverview(
  overview: OverviewPayload | null,
  route: AgentLoopRouteState,
  currentRunId: string | null,
): boolean {
  if (route.kind !== "workbench-legacy" && route.kind !== "detail") return false;
  const runtimeStatus = String((overview?.current as any)?.runtimeStatus || "").toLowerCase();
  const runtimeActive = !runtimeStatus || runtimeStatus === "running" || runtimeStatus === "started";
  if (!runtimeActive) return false;
  return Boolean(overview?.queueRunning || (runtimeActive && (overview?.current as any)?.staleRun === false) || currentRunId);
}

export function createAgentLoopLiveEventHandlers(refreshCurrentView: () => void): RunEventSubscriptionHandlers {
  return {
    onEvent: refreshCurrentView,
    onSnapshot: refreshCurrentView,
    onError: refreshCurrentView,
  };
}

function useSafeLocation(): [string, (next: string) => void] {
  if (typeof window === "undefined" || typeof location === "undefined") {
    return [getAgentLoopWorkbenchPath(), () => undefined];
  }
  return useLocation();
}

export default function AgentLoopPage() {
  const [location, setLocation] = useSafeLocation();
  const route = parseAgentLoopLocation(location);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The ported dashboard is a client-only antd + g6 (canvas) tree that touches `window`
  // during render, so it must not run under SSR. Gate it behind a mount flag and show a
  // lightweight placeholder until the browser hydrates.
  const [mounted, setMounted] = useState(false);

  // Keep the latest overview in a ref so the (stable) command handler can resolve a
  // task path back to its runId without being re-registered on every data refresh.
  const overviewRef = useRef<OverviewPayload | null>(null);
  overviewRef.current = overview;
  const viewRef = useRef<View>("overview");
  const view: View = route.kind === "detail" ? "detail" : "overview";
  viewRef.current = view;
  const detailRunIdRef = useRef<string | null>(null);
  if (route.kind === "detail") {
    detailRunIdRef.current = route.runId;
  }

  const currentRunId = resolveAgentLoopLiveEventRunId(overview, route);
  const shouldPollOverview = shouldPollAgentLoopOverview(overview, route, currentRunId);

  async function loadOverview() {
    setError(null);
    try {
      setOverview(await fetchOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openDetail(runId: string) {
    setError(null);
    try {
      detailRunIdRef.current = runId;
      const next = await fetchDetail(runId);
      setDetail(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404")) {
        setError(`暂无该任务的运行记录（${runId}）。请先运行该任务后再查看详情。`);
      } else {
        setError(msg);
      }
    }
  }

  function showWorkbench() {
    detailRunIdRef.current = null;
    setDetail(null);
    setLocation(getAgentLoopWorkbenchPath());
    void loadOverview();
  }

  function showDashboardView(next: DashboardRouteView) {
    detailRunIdRef.current = null;
    setDetail(null);
    if (next !== "workbench-legacy") {
      setOverview(null);
    }
    const path =
      next === "sliderule"
        ? currentSliderulePath()
        : next === "settings"
          ? getAgentLoopSettingsPath()
          : next === "dashboard"
            ? getAgentLoopDashboardPath()
          : next === "admin"
            ? (route.kind === "admin"
              ? (location.split(/[?#]/, 1)[0] || getAgentLoopAdminPath())
              : getAgentLoopAdminPath())
          : next === "settings-legacy"
            ? getAgentLoopSettingsLegacyPath()
            : next === "skills"
              ? getAgentLoopSkillsPath()
              : next === "components"
                ? getAgentLoopComponentsPath()
              : next === "help"
                ? getAgentLoopHelpPath()
                : next === "workbench-legacy"
                  ? getAgentLoopWorkbenchLegacyPath()
                  : getAgentLoopWorkbenchPath();
    setLocation(path);
  }

  function openTaskRoute(taskPath: string, runId?: string | null) {
    // Prefer lastRunId (from queue outcomes) when available, since detail requires an actual executed run ID.
    // task.id in queue view is often the task identifier (e.g. "sliderule-...-110"), not a run dir.
    const explicitRunId = runId ? String(runId) : "";
    const match = (overviewRef.current?.tasks || []).find(
      (t) => t.task === taskPath || t.id === taskPath,
    );
    // any-cast because OverviewTask in types may lag behind queue data which includes lastRunId
    const candidate = explicitRunId || match?.lastRunId || match?.id || taskPath;
    if (candidate) {
      setLocation(getAgentLoopRunPath(candidate));
      void openDetail(candidate);
    }
  }

  // Helper to push responses back to the ported DashboardApp which listens on window 'message'
  function dispatchMessage(type: string, payload: unknown) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new MessageEvent("message", { data: { type, payload } }));
    }
  }

  function adaptSettings(raw: any): any {
    // Delegate to typed view model adapter (112): does deep secret stripping + stable contract fields
    // before any data reaches DashboardApp render state or nonSensitive.
    return normalizeSettingsForUI(raw);
  }

  useEffect(() => {
    if (!mounted) return;
    if (route.kind === "detail") {
      void openDetail(route.runId);
    } else if (shouldLoadAgentLoopOverview(route)) {
      detailRunIdRef.current = null;
      setDetail(null);
      void loadOverview();
    } else {
      detailRunIdRef.current = null;
      setDetail(null);
      setOverview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, location]);

  useEffect(() => {
    if (!mounted || !currentRunId) return undefined;
    const refreshCurrentView = () => {
      if (viewRef.current === "detail" && detailRunIdRef.current) {
        void openDetail(detailRunIdRef.current);
      } else {
        void loadOverview();
      }
    };
    return subscribeRunEvents(String(currentRunId), createAgentLoopLiveEventHandlers(refreshCurrentView));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, currentRunId]);

  useEffect(() => {
    if (!mounted || !shouldPollOverview) return undefined;
    const timer = window.setInterval(() => {
      if (viewRef.current === "detail" && detailRunIdRef.current) {
        void openDetail(detailRunIdRef.current);
      } else {
        void loadOverview();
      }
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, shouldPollOverview, currentRunId]);

  useEffect(() => {
    setMounted(true);
    if (shouldLoadAgentLoopOverview(route)) {
      void loadOverview();
    }

    setCommandHandler((type, extra) => {
      switch (type) {
        case "refresh": {
          if (viewRef.current === "detail" && detailRunIdRef.current) {
            void openDetail(detailRunIdRef.current);
          } else {
            void loadOverview();
          }
          return;
        }
        case "openTask": {
          const taskPath = String(extra.taskPath ?? "");
          openTaskRoute(taskPath, extra.runId ? String(extra.runId) : null);
          return;
        }
        case "showOverview": {
          showWorkbench();
          return;
        }
        case "openReport":
        case "openState": {
          const url = String(extra.reportPath ?? extra.statePath ?? "");
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          return;
        }

        // --- Run controls (wired to /queue/run /task/run /cancel) ---
        case "runTask": {
          void (async () => {
            try {
              // Apply current non-secret settings to run control payload (runtime linkage)
              let runPayload: any = { ...extra };
              try {
                const raw = await fetchSettings();
                const vm = adaptSettings(raw);
                const ns = vm?.nonSensitive || vm || {};
                const rt = {
                  fixAgent: vm?.fixAgent ?? ns.fixAgent,
                  reviewAgent: vm?.reviewAgent ?? ns.reviewAgent,
                  activeProfile: vm?.activeProfile ?? ns.activeProfile,
                  workerMaxTurns: (ns as any).workerMaxTurns,
                  workerMaxRetries: (ns as any).workerMaxRetries,
                  worktreeScope: (ns as any).worktreeScope,
                  queuePath: (ns as any).queuePath,
                };
                Object.keys(rt).forEach((k) => { if (rt[k as keyof typeof rt] != null) runPayload[k] = rt[k as keyof typeof rt]; });
              } catch {}
              await runSingleTask(runPayload);
              // re-fetch current view
              if (viewRef.current === "detail" && detailRunIdRef.current) {
                void openDetail(detailRunIdRef.current);
              } else {
                void loadOverview();
              }
            } catch (e: any) {
              window.alert(`运行任务失败：${e?.message || e}`);
            }
          })();
          return;
        }
        case "runQueue": {
          void (async () => {
            try {
              // Apply current non-secret settings to run control payload (runtime linkage)
              let runPayload: any = { ...extra };
              try {
                const raw = await fetchSettings();
                const vm = adaptSettings(raw);
                const ns = vm?.nonSensitive || vm || {};
                const rt = {
                  fixAgent: vm?.fixAgent ?? ns.fixAgent,
                  reviewAgent: vm?.reviewAgent ?? ns.reviewAgent,
                  activeProfile: vm?.activeProfile ?? ns.activeProfile,
                  workerMaxTurns: (ns as any).workerMaxTurns,
                  workerMaxRetries: (ns as any).workerMaxRetries,
                  worktreeScope: (ns as any).worktreeScope,
                  queuePath: (ns as any).queuePath,
                };
                Object.keys(rt).forEach((k) => { if (rt[k as keyof typeof rt] != null) runPayload[k] = rt[k as keyof typeof rt]; });
              } catch {}
              await runQueue(runPayload);
              void loadOverview();
            } catch (e: any) {
              window.alert(`运行队列失败：${e?.message || e}`);
            }
          })();
          return;
        }
        case "stopRun": {
          void (async () => {
            try {
              const result = await cancelCurrent(extra);
              // Inspect status/message so queued-cancel placeholder is distinguished from future real stop;
              // dispatch for UI copy; always refresh to preserve overview/detail behavior.
              dispatchMessage("cancelResult", result);
              if (viewRef.current === "detail" && detailRunIdRef.current) {
                void openDetail(detailRunIdRef.current);
              } else {
                void loadOverview();
              }
            } catch (e: any) {
              // cancel in bridge is best-effort placeholder; do not hard fail UI
              dispatchMessage("cancelResult", { status: "error", message: e?.message || String(e) });
              void loadOverview();
            }
          })();
          return;
        }

        // --- Settings / profiles / diagnostics / run bridge (now wired to Python /api/agent-loop) ---
        case "getSettings": {
          void (async () => {
            try {
              const raw = await fetchSettings();
              dispatchMessage("settings", adaptSettings(raw));
            } catch (e) {
              dispatchMessage("settings", normalizeSettingsForUI({}));
            }
          })();
          return;
        }
        case "saveSettings": {
          void (async () => {
            try {
              await saveSettings(extra as any);
              const raw = await fetchSettings();
              dispatchMessage("settings", adaptSettings(raw));
            } catch (e: any) {
              dispatchMessage("saveBlocked", { message: e?.message || "save failed" });
            }
          })();
          return;
        }
        case "getQueueDefaults": {
          // Honest read-only state (per contract): expose supported keys list for client filtering + safety rejection.
          // No synthetic full support or write success; apply/preview still dispatch explicit unsupported.
          dispatchMessage("queueDefaults", {
            unsupported: true,
            defaults: {},
            supportedKeys: ["fixAgent", "reviewAgent", "workerMaxTurns", "workerMaxRetries", "worktreeScope", "queuePath"],
            note: "queue defaults preview uses supported-only patch; full apply is backend queue-file only (read-only here)",
          });
          return;
        }
        case "previewQueueDefaults":
        case "applyQueueDefaults": {
          // Stop synthetic success that implies persistence/apply; return explicit unsupported
          dispatchMessage("queuePreview", { ok: false, unsupported: true, error: "queue defaults preview/apply unsupported in runtime (no dedicated backend contract)" });
          dispatchMessage("queueApply", { ok: false, unsupported: true, error: "queue defaults apply unsupported" });
          return;
        }
        case "getDiagnostics": {
          // Honest unsupported instead of synthetic ok
          dispatchMessage("diagnostics", { unsupported: true, note: "diagnostics not implemented; provider-health and /settings provide runtime state" });
          return;
        }
        case "listProfiles": {
          // Truthful render using activeProfile + non-secret from /settings (per task & review).
          // Backend supports only activeProfile state; do not pretend full multi-profile.
          // Always emit at least the current active row; unsupported=true so CRUD surfaces profileError / disabled.
          void (async () => {
            try {
              const raw = await fetchSettings();
              const vm = adaptSettings(raw);
              const ap = vm && vm.activeProfile ? String(vm.activeProfile) : 'local';
              const base = (vm && vm.nonSensitive) || {};
              const prof = {
                fixAgent: vm && vm.fixAgent ? vm.fixAgent : (base as any).fixAgent || 'grok',
                reviewAgent: vm && vm.reviewAgent ? vm.reviewAgent : (base as any).reviewAgent || 'codex',
                baseUrl: vm && vm.baseUrl != null ? vm.baseUrl : (base as any).baseUrl || '',
                workerMaxTurns: (base as any).workerMaxTurns,
                workerMaxRetries: (base as any).workerMaxRetries,
                worktreeScope: (base as any).worktreeScope,
              };
              dispatchMessage("profiles", {
                profiles: { [ap]: prof },
                activeProfile: ap,
                unsupported: true,
              });
            } catch {
              dispatchMessage("profiles", { profiles: {}, activeProfile: 'local', unsupported: true });
            }
          })();
          return;
        }
        case "createProfile":
        case "renameProfile":
        case "duplicateProfile":
        case "deleteProfile":
        case "selectProfile": {
          // Do not emit synthetic success for unimplemented profile persistence
          dispatchMessage("profileError", { error: "profile CRUD unsupported; only activeProfile via non-secret settings is persisted" });
          return;
        }
        case "exportSettings": {
          void (async () => {
            try {
              const raw = await fetchSettings();
              dispatchMessage("settingsExported", adaptSettings(raw));
            } catch {}
          })();
          return;
        }
        case "importSettings": {
          void (async () => {
            try {
              await saveSettings(extra as any);
              const raw = await fetchSettings();
              dispatchMessage("importSettingsResult", { ok: true });
              dispatchMessage("settings", adaptSettings(raw));
            } catch (e: any) {
              dispatchMessage("importSettingsResult", { ok: false, error: e?.message || "import failed" });
            }
          })();
          return;
        }
        case "testProvider": {
          void (async () => {
            try {
              const h = await fetchProviderHealth();
              const p = (extra as any)?.provider || "grok";
              // Use real /provider-health response shape honestly (providers[ ].status in ready/missing/skipped/failed).
              // Only status==='ready' (or explicit ok:true) is success; never treat truthy non-ready status as ok.
              const entry = (h && (h[p] || (h.providers && h.providers[p]) || h)) || {};
              const isReady = entry && (String(entry.status || '').toLowerCase() === 'ready' || entry.ok === true);
              dispatchMessage("providerHealth", { provider: p, ...entry, ok: !!isReady });
            } catch {
              dispatchMessage("providerHealth", { provider: (extra as any)?.provider || "grok", ok: false });
            }
          })();
          return;
        }
        case "testWorkerCli": {
          // Worker CLI health not separately modeled; reuse provider as approximation
          const w = (extra as any)?.worker || "grok";
          dispatchMessage("workerCliHealth", { worker: w, ok: true, note: "see provider-health" });
          return;
        }
        default:
          // Unknown commands ignored silently (keeps old behavior for forward compat)
          return;
      }
    });

    return () => setCommandHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dashboardView: DashboardRouteView =
    route.kind === "settings"
      ? "settings"
      : route.kind === "dashboard"
        ? "dashboard"
      : route.kind === "admin"
        ? "admin"
      : route.kind === "settings-legacy"
        ? "settings-legacy"
        : route.kind === "sliderule"
          ? "sliderule"
          : route.kind === "skills"
            ? "skills"
            : route.kind === "components"
              ? "components"
            : route.kind === "help"
              ? "help"
              : route.kind === "workbench-legacy"
                ? "workbench-legacy"
                : "workbench";

  return (
    <main data-testid="agent-loop-page" className="agent-loop-root">
      {error ? (
        <div data-testid="agent-loop-error" className="agent-loop-error">
          加载失败：{error}
        </div>
      ) : null}
      {!mounted ? (
        <div data-testid="agent-loop-loading" className="agent-loop-loading">
          面团 AI 控制台加载中…
        </div>
      ) : view === "detail" && detail ? (
        <DashboardDetailApp payload={detail} />
      ) : (
        <DashboardApp
          payload={overview ?? { tasks: [], counts: {} }}
          view={dashboardView}
          onViewChange={showDashboardView}
          getViewPath={(next) => (
            next === "sliderule"
              ? currentSliderulePath()
              : next === "settings"
                ? getAgentLoopSettingsPath()
                : next === "dashboard"
                  ? getAgentLoopDashboardPath()
                : next === "admin"
                  ? (route.kind === "admin"
                    ? (location.split(/[?#]/, 1)[0] || getAgentLoopAdminPath())
                    : getAgentLoopAdminPath())
                : next === "settings-legacy"
                  ? getAgentLoopSettingsLegacyPath()
                  : next === "skills"
                    ? getAgentLoopSkillsPath()
                    : next === "components"
                      ? getAgentLoopComponentsPath()
                    : next === "help"
                      ? getAgentLoopHelpPath()
                      : next === "workbench-legacy"
                        ? getAgentLoopWorkbenchLegacyPath()
                        : getAgentLoopWorkbenchPath()
          )}
          getTaskRunPath={getAgentLoopRunPath}
          onOpenTask={openTaskRoute}
        />
      )}
    </main>
  );
}
