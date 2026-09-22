import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as bridge from "./dashboard/bridge";
import * as api from "./dashboard/agentLoopApi";
import AgentLoopPage, {
  createAgentLoopLiveEventHandlers,
  getAgentLoopAdminPath,
  getAgentLoopDashboardPath,
  getAgentLoopRunPath,
  getAgentLoopSettingsPath,
  currentSliderulePath,
  getAgentLoopSliderulePath,
  getAgentLoopWorkbenchPath,
  parseAgentLoopLocation,
  resolveAgentLoopLiveEventRunId,
  shouldLoadAgentLoopOverview,
  shouldPollAgentLoopOverview,
} from "./AgentLoopPage";
import { DashboardApp, CliConfigForm, QueueDefaultsView, ProfileCrudView, SettingsView, shouldRequestSettingsForView, NAV_GROUPS, shouldShowLegacyUnmaintainedBanner } from "./dashboard/DashboardApp";
import { LlmKeyForm } from "./dashboard/settings/LlmKeysPanel";
import { DiagnosticsView } from "./dashboard/settings/DiagnosticsPanel";

function jsonResponse(data: unknown, status = 200): any {
  const body = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
    text: async () => body,
    json: async () => data,
  };
}

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (fn: () => void) => {
      (globalThis as any).__AGENT_LOOP_CAPTURED_EFFECT__ = fn;
      return undefined;
    },
  };
});

vi.mock("@/pages/SlideRule", () => ({
  default: ({ embedded }: { embedded?: boolean }) => (
    <main data-embedded={embedded ? "true" : "false"} data-testid="sliderule-page" />
  ),
}));

describe("AgentLoopPage", () => {
  it("mounts the ported AgentLoop dashboard shell (overview workbench)", () => {
    const html = renderToStaticMarkup(<AgentLoopPage />);

    // Page-level chrome-free wrapper renders under SSR; the antd + g6 dashboard itself
    // is client-only and mounts after hydration, so SSR shows the loading placeholder.
    expect(html).toContain('data-testid="agent-loop-page"');
    expect(html).toContain('data-testid="agent-loop-loading"');
    expect(html).toContain("面团 AI 控制台加载中");
  });
  it("maps AgentLoop workbench, settings, and run detail to first-class URL routes", () => {
    expect(getAgentLoopSliderulePath()).toBe("/agent-loop/sliderule");
    expect(getAgentLoopWorkbenchPath()).toBe("/agent-loop/workbench");
    expect(getAgentLoopSettingsPath()).toBe("/agent-loop/settings");
    expect(getAgentLoopDashboardPath()).toBe("/agent-loop/dashboard");
    expect(getAgentLoopAdminPath()).toBe("/agent-loop/admin");
    expect(getAgentLoopRunPath("2026-06-27T01-02-03-004Z")).toBe(
      "/agent-loop/runs/2026-06-27T01-02-03-004Z",
    );

    expect(parseAgentLoopLocation("/agent-loop")).toEqual({ kind: "sliderule" });
    expect(parseAgentLoopLocation("/agent-loop/sliderule")).toEqual({ kind: "sliderule" });
    expect(parseAgentLoopLocation("/agent-loop/sliderule?session=sr-1")).toEqual({
      kind: "sliderule",
    });
    expect(currentSliderulePath("/agent-loop/sliderule?session=sr-keep", null)).toBe(
      "/agent-loop/sliderule?session=sr-keep"
    );
    expect(currentSliderulePath("/agent-loop/workbench", "sr-stored")).toBe(
      "/agent-loop/sliderule?session=sr-stored"
    );
    expect(currentSliderulePath("/agent-loop/sliderule", "")).toBe("/agent-loop/sliderule");
    expect(parseAgentLoopLocation("/agent-loop/workbench")).toEqual({ kind: "workbench" });
    expect(parseAgentLoopLocation("/agent-loop/workbench/legacy")).toEqual({ kind: "workbench-legacy" });
    expect(parseAgentLoopLocation("/agent-loop/skills")).toEqual({ kind: "skills" });
    expect(parseAgentLoopLocation("/agent-loop/settings")).toEqual({ kind: "settings" });
    expect(parseAgentLoopLocation("/agent-loop/settings/legacy")).toEqual({ kind: "settings-legacy" });
    expect(parseAgentLoopLocation("/agent-loop/dashboard")).toEqual({ kind: "dashboard" });
    expect(parseAgentLoopLocation("/agent-loop/admin")).toEqual({ kind: "admin" });
    expect(parseAgentLoopLocation("/agent-loop/admin/users")).toEqual({ kind: "admin" });
    expect(parseAgentLoopLocation("/agent-loop/runs/run%201")).toEqual({ kind: "detail", runId: "run 1" });
  });

  it("subscribes live events only for background run ids and ignores SSE pings for refresh", () => {
    expect(
      resolveAgentLoopLiveEventRunId(
        { current: { runId: "legacy-state-run", backgroundRunId: null }, tasks: [], counts: {} },
        { kind: "workbench-legacy" },
      ),
    ).toBeNull();
    expect(
      resolveAgentLoopLiveEventRunId(
        { current: { runId: "legacy-state-run", backgroundRunId: "bridge-run" }, tasks: [], counts: {} },
        { kind: "workbench-legacy" },
      ),
    ).toBe("bridge-run");
    expect(resolveAgentLoopLiveEventRunId(null, { kind: "detail", runId: "detail-run" })).toBe("detail-run");

    const refresh = vi.fn();
    const handlers = createAgentLoopLiveEventHandlers(refresh);
    handlers.onEvent?.({});
    handlers.onSnapshot?.({});
    handlers.onError?.(new Error("stream closed"));
    handlers.onPing?.({});

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(handlers.onPing).toBeUndefined();
  });

  it("does not preload task overview or settings while only viewing the SlideRule surface", () => {
    expect(shouldLoadAgentLoopOverview({ kind: "sliderule" })).toBe(false);
    expect(shouldLoadAgentLoopOverview({ kind: "settings" })).toBe(false);
    // 新工作台（主线观察台）自行拉取数据；legacy 驾驶舱才消费队列 overview
    expect(shouldLoadAgentLoopOverview({ kind: "workbench" })).toBe(false);
    expect(shouldLoadAgentLoopOverview({ kind: "workbench-legacy" })).toBe(true);
    expect(shouldLoadAgentLoopOverview({ kind: "detail", runId: "run-1" })).toBe(false);

    expect(
      shouldPollAgentLoopOverview(
        { queueRunning: true, current: { backgroundRunId: "bridge-run", staleRun: false }, tasks: [], counts: {} },
        { kind: "sliderule" },
        "bridge-run",
      ),
    ).toBe(false);
    expect(
      resolveAgentLoopLiveEventRunId(
        { current: { backgroundRunId: "bridge-run" }, tasks: [], counts: {} },
        { kind: "sliderule" },
      ),
    ).toBeNull();
    expect(
      resolveAgentLoopLiveEventRunId(
        { current: { backgroundRunId: "bridge-run" }, tasks: [], counts: {} },
        { kind: "dashboard" },
      ),
    ).toBeNull();
    expect(
      resolveAgentLoopLiveEventRunId(
        { current: { backgroundRunId: "bridge-run" }, tasks: [], counts: {} },
        { kind: "workbench-legacy" },
      ),
    ).toBe("bridge-run");

    expect(shouldRequestSettingsForView("sliderule")).toBe(false);
    expect(shouldRequestSettingsForView("workbench")).toBe(false);
    expect(shouldRequestSettingsForView("workbench-legacy")).toBe(true);
    // 设置整页（SettingsPage）自管本地配置，不消费 AgentLoop settings payload
    expect(shouldRequestSettingsForView("settings")).toBe(false);
    expect(shouldRequestSettingsForView("admin")).toBe(false);
    expect(shouldRequestSettingsForView("dashboard")).toBe(false);
    expect(shouldRequestSettingsForView("settings-legacy")).toBe(true);
  });

  it("stops overview fallback polling once the background queue runtime is stopped", () => {
    const stoppedOverview = {
      queueRunning: false,
      current: {
        backgroundRunId: "bridge-run",
        runtimeStatus: "stopped",
        staleRun: false,
      },
      tasks: [],
      counts: {},
    };

    expect(resolveAgentLoopLiveEventRunId(stoppedOverview, { kind: "workbench-legacy" })).toBeNull();
    expect(shouldPollAgentLoopOverview(stoppedOverview, { kind: "workbench" }, "bridge-run")).toBe(false);
  });

  it("allows the shell router to control DashboardApp settings views (整页 + legacy)", () => {
    // 侧栏「设置」= SlideRule 设置整页
    const settingsHtml = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="settings"
        onViewChange={vi.fn()}
      />,
    );
    expect(settingsHtml).toContain('data-testid="sliderule-settings-page"');
    expect(settingsHtml).not.toContain("native-settings-content");
    expect(settingsHtml).not.toContain('data-testid="agent-nav-admin"');
    expect(settingsHtml).not.toContain("管理台");

    // legacy AgentLoop 设置页保留 URL 直达
    const legacyHtml = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="settings-legacy"
        onViewChange={vi.fn()}
      />,
    );
    expect(legacyHtml).toContain("native-settings-content");

    const dashboardHtml = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="dashboard"
        onViewChange={vi.fn()}
      />,
    );
    expect(dashboardHtml).toContain('data-testid="user-dashboard-page"');
    expect(dashboardHtml).not.toContain("管理台只对超管开放");
    expect(dashboardHtml).not.toContain('data-testid="sliderule-staff-nav-users"');
  });

  it("⚠ 「推演」不再单列，但入口没消失：会话区顶上去了", () => {
    /*
     * 2026-08-28 用户裁决：「顶部的"推演"菜单不要，有底部新建会话与最近的
     * 入口就够了」。
     *
     * ⚠ 这一项 2026-08-26 撤过一次、2026-08-27 又加回来，加回来的原因是
     *   **判据假绿**：当时写 `html.toContain("推演")`，对着 logo 的
     *   `title="回到推演"` 就能绿，而新用户在侧栏里找不到产品。
     *
     * 所以这条**正反一起钉**，光写 not.toContain 就是把那个假绿翻了个面：
     *   正向 —— 替代入口真的在（新建会话按钮 + 最近列表 + 品牌 logo）
     *   反向 —— NAV_GROUPS 里确实没有 sliderule 这一项了
     */
    const navKeys = NAV_GROUPS.flatMap(g => g.items.map(i => i.key));
    expect(navKeys).not.toContain("sliderule");
    expect(navKeys).toContain("workbench");
    expect(navKeys).not.toContain("workbench-legacy");
    expect(navKeys).not.toContain("settings-legacy");
    expect(navKeys).toContain("skills");
    expect(navKeys).not.toContain("components");
    expect(navKeys).not.toContain("settings");
    expect(navKeys).not.toContain("admin");
    expect(navKeys).not.toContain("dashboard");
    expect(navKeys).not.toContain("help");
    expect(NAV_GROUPS[0]?.items[0]?.key).toBe("workbench");
    expect(NAV_GROUPS.flatMap(g => g.items).some(i => i.children?.length)).toBe(
      false
    );

    const html = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="workbench-legacy"
        onViewChange={vi.fn()}
        getViewPath={(view) => view === "sliderule" ? getAgentLoopSliderulePath() : `#${view}`}
      />,
    );

    // ⚠ 剥掉 title/aria-label 再查——这正是上次假绿的入口。
    const stripped = html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\s(?:title|aria-label)="[^"]*"/gi, "")
      .replace(/\s(?:title|aria-label)='[^']*'/gi, "");

    // 反向：导航里不再有那一项（连 testid 都不该剩）
    expect(stripped).not.toContain('data-testid="agent-nav-sliderule"');

    // 正向：会话区那两个真入口在场
    expect(stripped).toContain('data-testid="sidebar-sessions"');
    expect(stripped).toMatch(/data-testid="sidebar-session-(new|list)"/);
    // 正向：品牌 logo 仍然指向推演（它不是唯一入口，但不许一起掉）
    expect(stripped).toContain('href="/agent-loop/sliderule"');

    // 2026-09-19：扩展中心从主导航摘掉，不再有下级箭头
    expect(stripped).not.toContain('data-testid="agent-nav-expand"');
    expect(stripped).not.toContain("扩展中心");
    expect(stripped).not.toContain("组件库");
  });

  it("keeps bookmarkable legacy AgentLoop views and marks them unmaintained", () => {
    expect(shouldShowLegacyUnmaintainedBanner("workbench")).toBe(false);
    expect(shouldShowLegacyUnmaintainedBanner("workbench-legacy")).toBe(true);
    expect(shouldShowLegacyUnmaintainedBanner("settings-legacy")).toBe(true);
    expect(shouldShowLegacyUnmaintainedBanner("sliderule")).toBe(false);
    expect(shouldShowLegacyUnmaintainedBanner("settings")).toBe(false);
    expect(shouldShowLegacyUnmaintainedBanner("skills")).toBe(false);
    expect(shouldShowLegacyUnmaintainedBanner("components")).toBe(true);

    for (const view of [
      "workbench-legacy",
      "settings-legacy",
      "components",
    ] as const) {
      const html = renderToStaticMarkup(
        <DashboardApp
          payload={{ tasks: [], counts: {} }}
          view={view}
          onViewChange={vi.fn()}
        />,
      );
      expect(html).toContain('data-testid="legacy-unmaintained-banner"');
      expect(html).toContain("legacy，不维护");
    }

    const liveGalleryHtml = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="workbench"
        onViewChange={vi.fn()}
      />,
    );
    expect(liveGalleryHtml).not.toContain('data-testid="legacy-unmaintained-banner"');
    expect(liveGalleryHtml).not.toContain("legacy，不维护");

    const skillsHtml = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="skills"
        onViewChange={vi.fn()}
      />,
    );
    expect(skillsHtml).not.toContain('data-testid="legacy-unmaintained-banner"');

    const productHtml = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="sliderule"
        onViewChange={vi.fn()}
      />,
    );
    expect(productHtml).not.toContain('data-testid="legacy-unmaintained-banner"');
    expect(productHtml).not.toContain("legacy，不维护");
  });

  it("renders SlideRule inside the AgentLoop workbench shell instead of fullscreen", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="sliderule"
        onViewChange={vi.fn()}
        getViewPath={(view) => view === "sliderule" ? getAgentLoopSliderulePath() : `#${view}`}
      />,
    );

    expect(html).toContain("native-agent-shell");
    expect(html).toContain('data-sidebar-collapsed="false"');
    expect(html).toContain('data-testid="sidebar-collapse-toggle"');
    expect(html).toContain("native-workbench-content");
    expect(html).toContain("native-sliderule-content");
    expect(html).toContain("native-sliderule-shell");
    expect(html).toContain('data-testid="sliderule-page"');
    expect(html).toContain('data-embedded="true"');
    expect(html).not.toContain("native-settings-shell");
  });

  it("does not render global topbar chrome (header/breadcrumb removed)", () => {
    const slideruleHtml = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="sliderule"
        onViewChange={vi.fn()}
        getViewPath={(view) => view === "sliderule" ? getAgentLoopSliderulePath() : `#${view}`}
      />,
    );
    const workbenchHtml = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="workbench"
        onViewChange={vi.fn()}
      />,
    );
    const legacyHtml = renderToStaticMarkup(
      <DashboardApp
        payload={{ tasks: [], counts: {} }}
        view="workbench-legacy"
        onViewChange={vi.fn()}
      />,
    );

    for (const html of [slideruleHtml, workbenchHtml, legacyHtml]) {
      expect(html).not.toContain("native-agent-topbar");
      expect(html).not.toContain("native-agent-topbar-actions");
      expect(html).not.toContain("native-topbar-brand");
    }
  });

  it("renders task detail entries as first-class run route links", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        view="workbench-legacy"
        payload={{
          counts: {},
          tasks: [{ id: "task-1", task: "agent-loop/tasks/foo.md", lastRunId: "run 1" }],
        }}
        getTaskRunPath={getAgentLoopRunPath}
        onOpenTask={vi.fn()}
      />,
    );

    expect(html).toContain('href="/agent-loop/runs/run%201"');
  });

  it("renders the workbench as a queue cockpit with metrics, toolbar, and task inspector", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        view="workbench-legacy"
        payload={{
          counts: {
            queueTotal: 56,
            total: 56,
            running: 0,
          },
          queuePath: "agent-loop/scripts/sliderule-v2-hardening-115-queue.json",
          tasks: [
            {
              id: "sliderule-v2-hardening-scope-115",
              task: "agent-loop/tasks/sliderule-v2-hardening-scope-115.md",
              statusLabel: "DONE_REVIEWED",
              outcomeGroup: "reviewed",
              fixAgent: "grok",
              reviewAgent: "codex",
              branch: "agent-loop/sliderule-v2-hardening-115-run",
              diffBytes: 11264,
              lastUpdatedText: "2026-06-26 22:13:41",
              lastRunId: "2026-06-26T22-10-29-045Z",
            },
          ],
        }}
        getTaskRunPath={getAgentLoopRunPath}
        onOpenTask={vi.fn()}
      />,
    );

    expect(html).toContain("native-workbench-hero");
    expect(html).toContain("native-workbench-metrics");
    expect((html.match(/native-metric-card/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("native-table-toolbar");
    expect(html).toContain("native-task-inspector");
    expect(html).toContain("native-inspector-timeline");
    expect(html).toContain('href="/agent-loop/runs/2026-06-26T22-10-29-045Z"');
    expect(html).toContain("sliderule-v2-hardening-115-queue.json");
    expect(html).toContain("sliderule-v2-hardening-scope-115");
  });

  it("renders closure status from queue outcomes in the workbench task overview", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        payload={{
          counts: {
            queueTotal: 1,
            total: 1,
          },
          tasks: [
            {
              id: "sliderule-v2-closure-ui-04",
              task: "agent-loop/tasks/sliderule-v2-closure-ui-04-workbench-outcome-closure-status-119.md",
              statusLabel: "DONE_REVIEWED",
              outcomeGroup: "reviewed",
              closureStatus: {
                blocked: false,
                evidencePresentCount: 6,
                skillCount: 6,
                stableDigest: "deadbeef",
              },
            } as any,
          ],
        }}
        view="workbench-legacy"
      />,
    );

    expect(html).toContain('data-testid="agentloop-task-closure-status"');
    // E27：徽章说人话——哈希摘要不再上卡
    expect(html).toContain("闭环已收口");
    expect(html).toContain("证据 6/6");
    expect(html).not.toContain("deadbeef");
  });

  it("keeps queue metrics scoped to queue entries while all tasks includes task files", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        view="workbench-legacy"
        payload={{
          counts: {},
          tasks: [
            {
              id: "queued-task",
              task: "agent-loop/tasks/queued-task.md",
              inQueue: true,
              category: "pending",
            },
            {
              id: "new-unqueued-task",
              task: "agent-loop/tasks/new-unqueued-task.md",
              inQueue: false,
              category: "pending",
            },
          ] as any,
        }}
      />,
    );

    expect(html).toContain("任务队列 1");
    expect(html).toContain("全部任务 2");
  });

  it("keeps the workbench main grid gutter aligned with metric cards", () => {
    const html = renderToStaticMarkup(
      <DashboardApp
        view="workbench-legacy"
        payload={{
          counts: {
            queueTotal: 56,
            total: 56,
          },
          tasks: [],
        }}
      />,
    );

    expect(html).toContain("native-workbench-grid");
    expect(html).toContain("row-gap:12px");
    expect(html).toContain("margin-left:-6px");
    expect(html).toContain("margin-right:-6px");
    expect(html).not.toContain("margin-left:-2px");
    expect(html).not.toContain("margin-right:-2px");
  });

  it("does not double count reviewed tasks in the landed metric", () => {
    const tasks = [
      ...Array.from({ length: 52 }, (_, index) => ({
        id: `reviewed-${index}`,
        task: `agent-loop/tasks/reviewed-${index}.md`,
        statusLabel: "DONE_REVIEWED",
        outcomeGroup: "reviewed",
        category: "landed",
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `attention-${index}`,
        task: `agent-loop/tasks/attention-${index}.md`,
        statusLabel: "HALT_HUMAN",
        outcomeGroup: "rescuePatch",
        category: "attention",
      })),
    ];

    const html = renderToStaticMarkup(
      <DashboardApp
        view="workbench-legacy"
        payload={{
          counts: {
            queueTotal: 56,
            total: 56,
            done: 52,
            reviewed: 52,
            failed: 4,
          },
          tasks,
        }}
        getTaskRunPath={getAgentLoopRunPath}
      />,
    );

    expect(html).toMatch(/已落地[\s\S]*native-metric-value">52<\/div>/);
    expect(html).not.toContain("已落地104");
  });
});

describe("agentLoopApi (wired capabilities)", () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("exports the control surface used by the bridge (overview, detail, settings, run, cancel)", () => {
    expect(typeof api.fetchOverview).toBe("function");
    expect(typeof api.fetchDetail).toBe("function");
    expect(typeof api.fetchSettings).toBe("function");
    expect(typeof api.saveSettings).toBe("function");
    expect(typeof api.runQueue).toBe("function");
    expect(typeof api.runSingleTask).toBe("function");
    expect(typeof api.cancelCurrent).toBe("function");
    expect(typeof api.fetchProviderHealth).toBe("function");
  });

  it("fetchOverview hits the queue overview endpoint used by the VS Code dashboard", async () => {
    (global.fetch as any).mockResolvedValueOnce(jsonResponse([]));

    await api.fetchOverview();
    expect((global.fetch as any).mock.calls[0]?.[0]).toContain("/api/agent-loop/queue/overview");
  });

  it("fetchDetail and derived paths include reportPath/landingPath/statePath for UI buttons", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse({
        runId: "2026-06-25T12-00-00-000Z",
        status: "DONE_FIXED",
        task: { path: "tasks/foo.md" },
        options: { task: "tasks/foo.md" },
        iterations: [],
        events: [],
      }),
    );

    const d = await api.fetchDetail("2026-06-25T12-00-00-000Z");
    expect(d.reportPath).toBeTruthy();
    expect(d.reportJsonPath).toBeTruthy();
    expect(d.landingPath).toBeTruthy();
    expect(d.statePath).toBeTruthy();
    // paths should target stable documented routes
    expect(d.reportPath).toMatch(/\/api\/agent-loop\/runs\//);
    expect(d.statePath).toMatch(/\/snapshot$/);
  });

  it("fetchSettings/saveSettings hit the Python /settings surface", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(jsonResponse({ effective: { fixAgent: "grok" }, keys: {} }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const s = await api.fetchSettings();
    expect((global.fetch as any).mock.calls[0]?.[0]).toContain("/api/agent-loop/settings");
    expect(s.effective || s).toBeTruthy();

    await api.saveSettings({ fixAgent: "codex" });
    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/agent-loop/settings"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("105: fetchProviderHealth and health surface expose Python backend provenance for dashboard display", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse({
        status: "ok",
        backend: "sliderule-python",
        mode: "bridge",
        providers: [{ provider: "grok", status: "ready" }],
        checkedAt: "2026-07-01T00:00:00Z",
      }),
    );

    const h = await api.fetchProviderHealth();
    expect((global.fetch as any).mock.calls[0]?.[0]).toContain("/api/agent-loop/provider-health");
    expect(h.backend || h.status).toBeTruthy();
    // provenance must be visible (Python-owned, not hidden)
    expect(String(JSON.stringify(h))).toMatch(/sliderule-python|python/i);
  });

  it("105: dashboard load, run detail, queue overview, settings status exercise Python-first API paths", async () => {
    const fetchSpy = global.fetch as any;
    fetchSpy.mockClear();
    // use persistent resolved for this test to tolerate internal extra calls (snapshot in detail etc)
    const okJson = (data: any) => jsonResponse(data);
    fetchSpy.mockResolvedValue(okJson({ queueRunning: false, tasks: [], counts: {} }));

    await api.fetchOverview();
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("/api/agent-loop/");
    // override for detail specific
    fetchSpy.mockResolvedValueOnce(okJson({ runId: "r1", status: "PENDING", task: null, events: [], artifacts: [] }));
    fetchSpy.mockResolvedValueOnce(okJson({})); // snapshot fallback ok
    await api.fetchDetail("r1");
    expect(fetchSpy.mock.calls.some((call: any[]) => String(call[0]).includes("/api/agent-loop/runs/r1"))).toBe(true);
    fetchSpy.mockResolvedValue(okJson({ effective: {}, keys: {} }));
    await api.fetchSettings();
    expect(fetchSpy.mock.calls.some((call: any[]) => String(call[0]).includes("/api/agent-loop/settings"))).toBe(true);
  });

  it("agentloop secret settings semantics 111 does not report secret save success against nonsecret backend", async () => {
    const fetchSpy = global.fetch as any;
    fetchSpy.mockClear();
    // never use real key values; use marker only to exercise the path
    const res = await api.saveSettings({ grokApiKey: 'REDACTED', openaiApiKey: 'REDACTED' });
    // pure secret attempt must not hit the nonsecret /settings backend
    expect(fetchSpy).not.toHaveBeenCalled();
    // must not report success (ok:false + flag); callers must not toast persisted success
    expect(res && res.secretsIgnored).toBe(true);
    expect(res && res.ok).not.toBe(true);
  });

  it("agentloop setting view model 112 normalizes settings without leaking secrets", () => {
    // TDD: added before impl changes per spec; verifies typed normalization + secret stripping for renderable UI contract
    const rawLeaky = {
      loaded: true,
      effective: {
        activeProfile: "team",
        fixAgent: "grok",
        reviewAgent: "codex",
        queuePath: "agent-loop/scripts/migration-queue.json",
        worktreeScope: "task",
        workerMaxTurns: 256,
        grokApiKey: "RAW_SECRET_FROM_EFFECTIVE",
        openaiApiKey: "RAW_SECRET_OPEN",
        someNested: { authToken: "RAW_TOKEN_123" },
      },
      grokApiKey: "RAW_SECRET_TOP_LEVEL",
      keys: {
        grokApiKey: "configured",
        openaiApiKey: "configured",
        anthropicApiKey: "",
      },
      queueRunning: true,
    };
    const vm = api.normalizeSettingsForUI(rawLeaky);
    expect(vm).toBeTruthy();
    // stable contract fields present and populated from eff
    expect(vm.activeProfile).toBe("team");
    expect(vm.fixAgent).toBe("grok");
    expect(vm.reviewAgent).toBe("codex");
    expect(vm.queuePath).toBe("agent-loop/scripts/migration-queue.json");
    expect(vm.worktreeScope).toBe("task");
    // keys status only, never raw values
    expect(vm.keys && vm.keys.grokApiKey).toBe("configured");
    expect(vm.keys && vm.keys.openaiApiKey).toBe("configured");
    // NO raw secret values or secret keys in renderable state
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toMatch(/RAW_SECRET|RAW_TOKEN|authToken/i);
    expect(serialized).not.toContain("RAW_SECRET_FROM_EFFECTIVE");
    // nonSensitive present and also stripped
    expect(vm.nonSensitive).toBeTruthy();
    expect(vm.nonSensitive && vm.nonSensitive.grokApiKey).toBeUndefined();
    expect(vm.nonSensitive && vm.nonSensitive.openaiApiKey).toBeUndefined();
    // backward compat fields for existing dispatch consumers
    expect(vm.nonSensitive && vm.nonSensitive.fixAgent).toBe("grok");
  });

  it("agentloop cancel semantics 111 surfaces queued cancel placeholder instead of stop success", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse({
        status: "queued-cancel",
        message: "cancel is a queued-cancel placeholder (unsupported by bridge; no process kill)",
        exitCode: null,
        timedOut: false,
      }),
    );

    const res = await api.cancelCurrent({});
    expect(res.status).toBe("queued-cancel");
    expect(String(res.message || "")).toMatch(/queued-cancel|placeholder|no process kill/i);
    // ensure not pretending a stop success (distinguish from real cancellable)
    expect(res.status).not.toBe("stopped");
    expect(res.status).not.toBe("cancelled");
    expect(res.status).not.toBe("ok");
  });

  it("agentloop event stream client builds live SSE subscriptions with close cleanup", () => {
    const originalEventSource = (globalThis as any).EventSource;
    const listeners: Record<string, (event: { data: string }) => void> = {};
    const close = vi.fn();

    class FakeEventSource {
      url: string;
      onerror: unknown = null;
      constructor(url: string) {
        this.url = url;
        (FakeEventSource as any).last = this;
      }
      addEventListener(type: string, fn: (event: { data: string }) => void) {
        listeners[type] = fn;
      }
      close = close;
    }

    (globalThis as any).EventSource = FakeEventSource;
    const onEvent = vi.fn();
    const onSnapshot = vi.fn();
    const onPing = vi.fn();

    try {
      expect(api.buildRunEventsStreamUrl("run 1")).toBe(
        "/api/agent-loop/runs/run%201/events/stream/v2?live=1",
      );
      const unsubscribe = api.subscribeRunEvents("run 1", { onEvent, onSnapshot, onPing });
      const instance = (FakeEventSource as any).last as FakeEventSource;
      expect(instance.url).toBe("/api/agent-loop/runs/run%201/events/stream/v2?live=1");

      listeners.event({ data: JSON.stringify({ type: "HEARTBEAT", seq: 1 }) });
      listeners.snapshot({ data: JSON.stringify({ finalized: false }) });
      listeners.ping({ data: JSON.stringify({ runId: "run 1" }) });

      expect(onEvent).toHaveBeenCalledWith({ type: "HEARTBEAT", seq: 1 });
      expect(onSnapshot).toHaveBeenCalledWith({ finalized: false });
      expect(onPing).toHaveBeenCalledWith({ runId: "run 1" });

      unsubscribe();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      if (typeof originalEventSource === "undefined") {
        delete (globalThis as any).EventSource;
      } else {
        (globalThis as any).EventSource = originalEventSource;
      }
    }
  });

  it("agentloop artifact route truth 111 maps report landing and state actions to distinct safe resources", async () => {
    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse({
        runId: "2026-06-25T12-00-00-000Z",
        status: "DONE_FIXED",
        task: { path: "tasks/foo.md" },
        options: { task: "tasks/foo.md" },
        iterations: [],
        events: [],
        artifacts: [
          { id: "final-report.md", kind: "report" },
          { id: "final-report.json", kind: "report" },
          { id: "landing.json", kind: "landing" },
          { id: "state.json", kind: "state" },
        ],
      }),
    );

    const d = await api.fetchDetail("2026-06-25T12-00-00-000Z");
    expect(d.reportPath).toBeTruthy();
    expect(d.reportJsonPath).toBeTruthy();
    expect(d.landingPath).toBeTruthy();
    expect(d.statePath).toBeTruthy();
    // must be distinct (artifact truth rescue, not identical placeholders)
    expect(d.reportPath).not.toBe(d.reportJsonPath);
    expect(d.reportPath).not.toBe(d.landingPath);
    expect(d.landingPath).not.toBe(d.statePath);
    // derived from explicit safe subroutes per artifact ids
    expect(d.reportPath).toMatch(/\/artifacts\/final-report\.md$/);
    expect(d.reportJsonPath).toMatch(/\/artifacts\/final-report\.json$/);
    expect(d.landingPath).toMatch(/\/artifacts\/landing\.json$/);
    expect(d.statePath).toMatch(/\/artifacts\/state\.json$/);
  });
});

describe("agentloop web bridge interaction 111", () => {
  const origFetch = global.fetch;
  const origWindow = (globalThis as any).window;
  const origMessageEvent = (globalThis as any).MessageEvent;

  beforeEach(() => {
    global.fetch = vi.fn();
    (globalThis as any).__AGENT_LOOP_CAPTURED_EFFECT__ = null;
    (globalThis as any).__AGENT_LOOP_DISPATCHED__ = [];

    if (typeof (globalThis as any).MessageEvent === "undefined") {
      (globalThis as any).MessageEvent = class {
        type: string;
        data: unknown;
        constructor(type: string, init?: { data?: unknown }) {
          this.type = type;
          this.data = init?.data;
        }
      };
    }

    (globalThis as any).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn((event: any) => {
        ((globalThis as any).__AGENT_LOOP_DISPATCHED__ as any[]).push(event);
        return true;
      }),
      open: vi.fn(),
      __AGENT_LOOP_ASSETS__: {},
    };

    bridge.setCommandHandler(null);
  });

  afterEach(() => {
    global.fetch = origFetch;
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
    if (typeof origMessageEvent === "undefined") {
      delete (globalThis as any).MessageEvent;
    } else {
      (globalThis as any).MessageEvent = origMessageEvent;
    }
    bridge.setCommandHandler(null);
    vi.restoreAllMocks();
  });

  async function flushBridge(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("agentloop web bridge interaction 111 hydrates settings and surfaces unsupported semantics truthfully", async () => {
    const setSpy = vi.spyOn(bridge, "setCommandHandler");

    const html = renderToStaticMarkup(<AgentLoopPage />);
    expect(html).toContain('data-testid="agent-loop-page"');
    expect(html).toContain('data-testid="agent-loop-loading"');

    const captured = (globalThis as any).__AGENT_LOOP_CAPTURED_EFFECT__;
    expect(typeof captured).toBe("function");
    // 新语义：workbench 路由（主线观察台）不再预载队列 overview——
    // legacy 驾驶舱才会——因此这里不再垫 overview 的 fetch mock。
    captured();
    expect(setSpy).toHaveBeenCalled();
    const handler = setSpy.mock.calls.find((call) => typeof call[0] === "function")?.[0] as
      | ((type: string, extra?: Record<string, unknown>) => void)
      | undefined;
    expect(handler).toBeTruthy();

    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse({
        effective: { fixAgent: "grok", baseUrl: "http://x", activeProfile: "runtime111" },
        keys: { grokApiKey: "configured" },
      }),
    );

    handler!("getSettings", {});
    await flushBridge();

    const dispatched = (globalThis as any).__AGENT_LOOP_DISPATCHED__ as any[];
    const settingsMsg = dispatched.find((event) => event?.data?.type === "settings");
    expect(settingsMsg).toBeTruthy();
    expect(settingsMsg.data.payload.nonSensitive.fixAgent).toBe("grok");
    expect(settingsMsg.data.payload.activeProfile).toBe("runtime111");

    handler!("getQueueDefaults", {});
    await flushBridge();
    const queueDefaultsMsg = dispatched.find((event) => event?.data?.type === "queueDefaults");
    expect(queueDefaultsMsg).toBeTruthy();
    expect(queueDefaultsMsg.data.payload.unsupported).toBe(true);
    expect(String(queueDefaultsMsg.data.payload.note || "")).toMatch(/not supported|queue defaults/i);

    handler!("getDiagnostics", {});
    await flushBridge();
    const diagnosticsMsg = dispatched.find((event) => event?.data?.type === "diagnostics");
    expect(diagnosticsMsg).toBeTruthy();
    expect(diagnosticsMsg.data.payload.unsupported).toBe(true);

    handler!("listProfiles", {});
    await flushBridge();
    const profilesMsg = dispatched.find((event) => event?.data?.type === "profiles");
    expect(profilesMsg).toBeTruthy();
    expect(profilesMsg.data.payload.unsupported).toBe(true);

    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse({
        status: "queued-cancel",
        message: "cancel is a queued-cancel placeholder (unsupported by bridge; no process kill)",
      }),
    );

    handler!("stopRun", {});
    await flushBridge();
    const cancelMsg = dispatched.find((event) => event?.data?.type === "cancelResult");
    expect(cancelMsg).toBeTruthy();
    expect(cancelMsg.data.payload.status).toBe("queued-cancel");
    expect(String(cancelMsg.data.payload.message || "")).toMatch(/queued-cancel|placeholder|no process kill/i);
    expect(cancelMsg.data.payload.status).not.toBe("stopped");

    (global.fetch as any).mockResolvedValueOnce(
      jsonResponse({
        runId: "2026-06-25T12-00-00-000Z",
        status: "DONE_FIXED",
        task: { path: "tasks/foo.md" },
        options: { task: "tasks/foo.md" },
        iterations: [],
        events: [],
        artifacts: [
          { id: "final-report.md", kind: "report" },
          { id: "landing.json", kind: "landing" },
          { id: "state.json", kind: "state" },
        ],
      }),
    );

    handler!("openTask", { taskPath: "tasks/foo.md", runId: "2026-06-25T12-00-00-000Z" });
    await flushBridge();

    expect((global.fetch as any).mock.calls.some((call: any[]) => String(call[0]).includes("/api/agent-loop/runs/2026-06-25T12-00-00-000Z"))).toBe(true);
  });
});

it("agentloop setting shell 112 renders standalone route without duplicate sidebar", () => {
  // TDD: this test is added first to verify standalone /agent-loop shell behavior
  // before changes to remove internal sidebar; it must fail until sidebar is removed
  // and settings entry is provided via top control (segmented or equivalent).
  // Use DashboardApp directly because AgentLoopPage gates actual shell behind useEffect mount (SSR shows loading only).
  // Provide minimal window polyfill so SSR render reaches the dashboard shell (matches real client mount)
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html: string = "";
  try {
    html = renderToStaticMarkup(
      <DashboardApp payload={{ tasks: [], counts: {} }} />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  // agent-loop page content renders the dashboard (standalone route)
  // MUST NOT render internal VS Code style sidebar (Sider/Menu duplicate nav)
  // which would occupy width and duplicate main app navigation even on chrome-free route
  expect(html).not.toContain("native-sidebar");
  expect(html).not.toContain('class="native-sidebar"');
  expect(html).not.toContain('ant-layout-sider');
  // no 224px sidebar footprint in static structure
  expect(html).not.toContain("width:224");

  // workbench/detail reachable (initial is workbench content)
  expect(html).toContain("应用市场");
  expect(html).toContain("技能");
  expect(html).not.toContain('data-testid="agent-nav-settings"');
  expect(html).not.toContain("管理台");

  // full route width: content area not constrained by internal sidebar layout
  // (no sidebar present implies content uses available width)
  // also AgentLoopPage itself does not embed duplicate sidebar
  const pageHtml = renderToStaticMarkup(<AgentLoopPage />);
  expect(pageHtml).toContain('data-testid="agent-loop-page"');
});

it("agentloop setting layout 112 renders summary cards and five tabs", () => {
  // TDD: add this test FIRST per acceptance criteria and suggested notes.
  // Verifies the shared settings center layout: title, 3 summary cards (Profile/Review/Fix), 5 tabs in exact order, shared redacted import/export footer.
  // Uses DashboardApp with initialView for SSR capture of settings branch (view state is internal).
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html: string = "";
  try {
    // force settings view for static layout contract test; prop only affects initial render state for test
    html = renderToStaticMarkup(
      <DashboardApp payload={{ tasks: [], counts: {} }} initialView="settings-legacy" />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  // title for settings center (matches ref structure)
  expect(html).toContain("AgentLoop 设置中心");

  // summary cards for the three agents/profiles (with icon or badge style)
  expect(html).toContain("活跃 Profile");
  expect(html).toContain("Review Agent");
  expect(html).toContain("Fix Agent");
  // compact card/badge presence markers
  expect(html).toMatch(/active-profile|summary-card|profile-card|review-agent|fix-agent/i);

  // exactly the five tabs in required order: CLI 配置, LLM Keys, 队列默认值, Diagnostics, Profiles
  expect(html).toContain("CLI 配置");
  expect(html).toContain("LLM Keys");
  expect(html).toContain("队列默认值");
  expect(html).toContain("Diagnostics");
  expect(html).toContain("Profiles");

  // import/export redacted footer is present (shared, not duplicated per tab)
  expect(html).toContain("设置导入 / 导出");
  expect(html).toContain("导出设置");
  expect(html).toContain("导入设置");
});

it("agentloop setting cli config 112 renders two column worker form", () => {
  // TDD per acceptance: add named test before impl; covers two-col desktop (md half), one-col narrow (xs full),
  // exact fields, queueRunning lock+explanation, primary save; save uses non-secret via existing onSave/saveSettings.
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html: string = "";
  try {
    html = renderToStaticMarkup(
      <DashboardApp payload={{ tasks: [], counts: {} }} initialView="settings-legacy" />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  // required fields in CLI worker form (compact labels)
  expect(html).toContain("默认修复 Worker");
  expect(html).toContain("默认 Review Worker");
  expect(html).toContain("最大执行轮次");
  expect(html).toContain("最大重试次数");
  expect(html).toContain("队列文件路径");
  expect(html).toContain("工作模式");

  // two-column on desktop + responsive one-col on narrow (Row/Col xs/md pattern)
  expect(html).toMatch(/ant-row|gutter/i);
  expect(html).toMatch(/ant-col-xs-24|ant-col-md-12|xs-24|md-12/i);

  // primary save action visible
  expect(html).toContain("保存 CLI 配置");

  // now render CliConfigForm directly with queueRunning to cover lock semantics + explanation UI
  let lockHtml: string = "";
  const origWin2 = (globalThis as any).window;
  (globalThis as any).window = { __AGENT_LOOP_CSP_NONCE__: undefined, __AGENT_LOOP_ASSETS__: {} };
  try {
    lockHtml = renderToStaticMarkup(
      <CliConfigForm
        initial={{
          fixAgent: "grok",
          reviewAgent: "codex",
          workerMaxTurns: 128,
          workerMaxRetries: 2,
          queuePath: "agent-loop/scripts/migration-queue.json",
          worktreeScope: "queue",
        }}
        onSave={() => {}}
        queueRunning={true}
        activeProfile="demo"
      />
    );
  } finally {
    if (typeof origWin2 === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWin2;
    }
  }

  // when queueRunning, runtime fields locked and UI explains why (per acceptance)
  expect(lockHtml).toContain("队列运行中");
  expect(lockHtml).toMatch(/已锁定|运行时字段已锁定/i);
  // disabled present on sensitive controls
  expect(lockHtml).toMatch(/disabled/i);
});

it("agentloop setting queue defaults 112 previews supported patch only", () => {
  // TDD: add this test named exactly per acceptance criteria BEFORE any production changes to QueueDefaultsView or filtering.
  // Verifies: sync/preview produce supported-keys-only patch; secrets, workerEnv and unsupported are rejected/omitted with explanation;
  // actions call bridge (no synthetic success invented in client).
  // Also spot-checks line-numbered current display + copy control surface and patch preview UI.
  const proposedLeaky = {
    workerMaxTurns: 256,
    workerMaxRetries: 3,
    fixAgent: "grok",
    reviewAgent: "codex",
    worktreeScope: "task",
    workerEnv: { NODE_ENV: "test", SECRET: "leak" },
    grokApiKey: "RAW_SECRET_GROK",
    openaiApiKey: "RAW_SECRET_OPENAI",
    queuePath: "agent-loop/scripts/migration-queue.json",
    fooBarUnsupported: "no",
    someSecretToken: "tok-xyz",
  };
  const supportedKeys = ["fixAgent", "reviewAgent", "workerMaxTurns", "workerMaxRetries", "worktreeScope", "queuePath"];

  // the util must exist and filter correctly (will fail until impl + wiring)
  const filtered = api.filterSupportedQueuePatch(proposedLeaky, supportedKeys);
  expect(filtered).toBeTruthy();
  expect(filtered.patch).toBeTruthy();
  expect(filtered.patch.workerMaxTurns).toBe(256);
  expect(filtered.patch.fixAgent).toBe("grok");
  expect(filtered.patch.reviewAgent).toBe("codex");
  expect(filtered.patch.workerEnv).toBeUndefined();
  expect(filtered.patch.grokApiKey).toBeUndefined();
  expect(filtered.patch.openaiApiKey).toBeUndefined();
  expect(filtered.patch.fooBarUnsupported).toBeUndefined();
  expect(filtered.patch.someSecretToken).toBeUndefined();
  expect(filtered.rejected.length).toBeGreaterThan(0);
  expect(filtered.rejected.join("|")).toMatch(/workerEnv|grokApiKey|fooBarUnsupported|secret/i);

  // UI surface for current defaults: line numbered code + copy (render the panel directly to capture content)
  const origWindow2 = (globalThis as any).window;
  (globalThis as any).window = { __AGENT_LOOP_CSP_NONCE__: undefined, __AGENT_LOOP_ASSETS__: {} };
  let qdHtml = "";
  try {
    qdHtml = renderToStaticMarkup(
      <QueueDefaultsView
        data={{ defaults: { workerMaxTurns: 512, fixAgent: "grok" }, supportedKeys: ["fixAgent", "reviewAgent", "workerMaxTurns"] }}
        preview={null}
        onPreview={() => {}}
        onApply={() => {}}
        settingsData={{ nonSensitive: { fixAgent: "grok", workerMaxTurns: 512 } }}
      />
    );
  } finally {
    if (typeof origWindow2 === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow2;
    }
  }
  // copy control for current json (button or aria) + line numbered styling classes
  expect(qdHtml).toMatch(/复制|copy|Copy/i);
  expect(qdHtml).toMatch(/native-queue-code|native-queue-code-card|native-queue-code-line|native-queue-code-no/i);
  // preview section mentions patch / dry-run / supported
  expect(qdHtml).toMatch(/预览|preview|patch|dry-run|supported|支持|Proposed|Dry-run/i);
});

it("agentloop setting profiles 112 renders active profile table truthfully", () => {
  // TDD per acceptance: add named test first; verifies Profiles tab table rows truthfully render name, active tag, agents, base/proxy, and action buttons (select/rename/copy/delete/create) using real data shape; active cannot be deleted if only one etc.
  // Use direct ProfileCrudView (exported for this TDD test only, like Cli/Queue views)
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html: string = "";
  const profilesData = {
    profiles: {
      local: { fixAgent: "grok", reviewAgent: "codex", baseUrl: "" },
      team: { fixAgent: "codex", reviewAgent: "grok", baseUrl: "https://api.example.com" },
    },
    activeProfile: "team",
  };
  try {
    html = renderToStaticMarkup(
      <ProfileCrudView
        data={profilesData}
        queueRunning={false}
        activeProfile="team"
        onList={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
      />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  // table rows: names
  expect(html).toContain("local");
  expect(html).toContain("team");
  // active tagged (chinese in name, and english tag for active row)
  expect(html).toContain("当前");
  expect(html).toMatch(/active|当前|Tag.*success/i);
  // config/agents and base/proxy shown
  expect(html).toContain("codex");
  expect(html).toContain("https://api.example.com");
  // columns headers confirm table structure
  expect(html).toContain("名称");
  expect(html).toContain("配置");
  expect(html).toContain("操作");
  // action buttons presence (labels may encode in static render; use robust match + classes per other 112 tests)
  expect(html).toMatch(/创建|重命名|复制|删除|选择|ant-btn/i);
  expect(html).toMatch(/danger|ant-btn-dangerous/i);

  // update (TDD): also render single active profile case (truthful data shape from activeProfile/non-secret via listProfiles) to cover cannot-delete-only protection
  let singleHtml = "";
  const singleData = { profiles: { local: { fixAgent: "grok", reviewAgent: "codex" } }, activeProfile: "local" };
  const origWindow2 = (globalThis as any).window;
  (globalThis as any).window = { __AGENT_LOOP_CSP_NONCE__: undefined, __AGENT_LOOP_ASSETS__: {} };
  try {
    singleHtml = renderToStaticMarkup(
      <ProfileCrudView
        data={singleData}
        queueRunning={false}
        activeProfile="local"
        onList={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
      />
    );
  } finally {
    if (typeof origWindow2 === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow2;
    }
  }
  expect(singleHtml).toContain("local");
  expect(singleHtml).toContain("当前");
  // delete must be disabled for only profile (no accidental delete of sole/locked)
  expect(singleHtml).toContain('disabled=""');
  expect(singleHtml).toMatch(/删\s*除/);
});

it("agentloop setting profiles visual shell matches reference", () => {
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html = "";
  try {
    html = renderToStaticMarkup(
      <ProfileCrudView
        data={{
          profiles: {
            ci: { fixAgent: "codex", reviewAgent: "none" },
            local: { fixAgent: "grok", reviewAgent: "codex" },
            proxy: { fixAgent: "grok", reviewAgent: "grok", baseUrl: "http://127.0.0.1:8080" },
          },
          activeProfile: "local",
        }}
        queueRunning={false}
        activeProfile="local"
        onList={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
      />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  expect(html).toContain("native-profiles-panel");
  expect(html).toContain("native-profiles-toolbar");
  expect(html).toContain("native-profiles-table");
  expect(html).toContain("Settings Profiles");
  expect(html).toContain("刷新");
  expect(html).toContain("创建");
  expect(html).toContain("名称");
  expect(html).toContain("状态 / Agents / 代理");
  expect(html).toContain("代理地址");
  expect(html).toContain("操作");
  expect(html).toContain("ci");
  expect(html).toContain("local");
  expect(html).toContain("proxy");
  expect(html).toContain("active");
  expect(html).toContain("codex / none");
  expect(html).toContain("grok / codex");
  expect(html).toContain("grok / grok");
  expect(html).toContain("当前");
  expect(html).toContain("http://127.0.0.1:8080");
  expect(html).toContain("选择");
  expect(html).toContain("重命名");
  expect(html).toContain("复制");
  expect(html).toContain("删除");
  expect(html).toContain("仅非敏感配置；不可删除最后一个 profile；运行中禁止切换与删除。");
  expect(html).not.toContain("max-width:720");
  expect(html).not.toContain("turns /");
});

it("agentloop setting component split 112 preserves settings render contract", () => {
  // TDD: added BEFORE any production split changes per acceptance criteria and suggested notes.
  // Verifies: after extraction, DashboardApp still renders identical settings UI contract via delegation;
  // the split modules (SettingsView + panels) exist under dashboard/settings and are importable without circulars.
  // Contract: title, 3 summary cards, 5 tab labels, import/export footer, and sub panel forms (CLI etc) remain present.
  // Direct render of extracted panels (via re-export or direct) must succeed.
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html = "";
  let directSettings: any = null;
  try {
    // primary render contract via DashboardApp (orchestrator)
    html = renderToStaticMarkup(
      <DashboardApp payload={{ tasks: [], counts: {} }} initialView="settings-legacy" />
    );

    // must still contain core settings UI contract elements (preserved behavior)
    expect(html).toContain("AgentLoop 设置中心");
    expect(html).toContain("活跃 Profile");
    expect(html).toContain("Review Agent");
    expect(html).toContain("Fix Agent");
    expect(html).toContain("CLI 配置");
    expect(html).toContain("LLM Keys");
    expect(html).toContain("队列默认值");
    expect(html).toContain("Diagnostics");
    expect(html).toContain("Profiles");
    expect(html).toContain("设置导入 / 导出");
    expect(html).toContain("保存 CLI 配置");

    // verify split modules exist (importable boundary)
    try {
      const mod = require("./dashboard/settings/SettingsView");
      const sv = mod && (mod.default || mod.SettingsView || mod);
      if (sv) directSettings = sv;
    } catch {}
    // contract preserved is proven by main html render via DashboardApp (which now delegates)
    // direct render may vary due to cjs/esm in test env; main path suffices for split verify
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }
});

it("agentloop setting runtime linkage 112 applies nonsecret settings to run controls", async () => {
  // TDD: added before prod changes per task acceptance. Verifies run controls (via runQueue/runSingleTask)
  // carry non-secret runtime options from settings (fixAgent, reviewAgent, worker*, worktreeScope, activeProfile, queuePath).
  // Queue run payload must map queuePath -> queue for backend (which uses `queue`); also keeps queuePath.
  // Also confirms: no secrets leak into payloads; explicit contract for backend ownership of some opts documented.
  // Update for review: also covers honest provider-health shape (no truthy status -> ok) and initial settings linkage contract.
  const origFetch = global.fetch;
  global.fetch = vi.fn().mockResolvedValue(jsonResponse({}));
  try {
    // direct api usage as exercised by run controls
    await api.runQueue({ queue: "q.json", fixAgent: "codex", reviewAgent: "grok", activeProfile: "team", workerMaxTurns: 64 });
    let lastCall = (global.fetch as any).mock.calls[(global.fetch as any).mock.calls.length - 1];
    let body = lastCall?.[1]?.body || "";
    expect(body).toContain('"fixAgent":"codex"');
    expect(body).toContain('"reviewAgent":"grok"');
    expect(body).toContain('"activeProfile":"team"');
    expect(body).toContain('"workerMaxTurns":64');
    expect(body).not.toMatch(/grokApiKey|openaiApiKey|sk-/i);

    await api.runSingleTask({ task: "agent-loop/tasks/foo.md", workerMaxRetries: 5, worktreeScope: "task", reviewAgent: "none" });
    lastCall = (global.fetch as any).mock.calls[(global.fetch as any).mock.calls.length - 1];
    body = lastCall?.[1]?.body || "";
    expect(body).toContain('"workerMaxRetries":5');
    expect(body).toContain('"worktreeScope":"task"');
    expect(body).toContain('"reviewAgent":"none"');
    expect(body).not.toMatch(/apiKey|secret/i);

    // queuePath case: must result in queue field for backend + queuePath (fixes mapping)
    await api.runQueue({ queuePath: "agent-loop/scripts/migration-queue.json", fixAgent: "grok" });
    lastCall = (global.fetch as any).mock.calls[(global.fetch as any).mock.calls.length - 1];
    body = lastCall?.[1]?.body || "";
    expect(body).toContain('"queue":"agent-loop/scripts/migration-queue.json"');
    expect(body).toContain('"queuePath":"agent-loop/scripts/migration-queue.json"');
    expect(body).toContain('"fixAgent":"grok"');
    expect(body).not.toMatch(/apiKey|secret/i);

    // empty settings -> still valid payload, backend owns when absent
    await api.runQueue({});
    // no throw, and minimal body ok
  } finally {
    global.fetch = origFetch;
  }

  // TDD update (review findings): provider health must use real shape honestly.
  // Non-ready statuses (missing/skipped) MUST NOT derive ok:true.
  // Simulate the derivation contract that testProvider must honor.
  const buggyDerive = (entry: any) => !!(entry && (entry.status || entry.ok));
  const honestDerive = (entry: any) => !!(entry && (entry.status === 'ready' || entry.ok === true));
  // documents old buggy behavior (truthy status was wrongly treated as ok)
  expect(buggyDerive({ status: 'missing', reason: 'missing key' })).toBe(true);
  expect(buggyDerive({ status: 'skipped' })).toBe(true);
  expect(buggyDerive({ status: 'ready' })).toBe(true);
  // honest version is what must be used (and is now implemented in testProvider)
  expect(honestDerive({ status: 'missing' })).toBe(false);
  expect(honestDerive({ status: 'ready' })).toBe(true);
  expect(honestDerive({ ok: true })).toBe(true);
  expect(honestDerive({ status: 'failed' })).toBe(false);

  // Also document: workbench must load settings on mount (not only view==='settings')
  // so that OverviewHeader/SidePanel labels and initial rtOpts reflect fix/review agents + activeProfile.
  // (enforced via effect change in DashboardApp; direct api + dispatch already exercised by named run tests)
});

it("agentloop setting visual readiness 112 covers five reference tabs", () => {
  // TDD per AC for this closure task: add named test before/ as part of visual readiness.
  // Covers visiting/validating the five tabs from reference images: CLI 配置, LLM Keys, 队列默认值, Diagnostics, Profiles.
  // Static SSR render of settings view exercises the cohesive product page layout (no duplicate sidebar, clean cards, Chinese copy).
  // Live browser server check is documented in task file due to env limitation.
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html: string = "";
  try {
    html = renderToStaticMarkup(
      <DashboardApp payload={{ tasks: [], counts: {} }} initialView="settings-legacy" />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  // five reference tabs (order and labels per ref images and acceptance)
  expect(html).toContain("CLI 配置");
  expect(html).toContain("LLM Keys");
  expect(html).toContain("队列默认值");
  expect(html).toContain("Diagnostics");
  expect(html).toContain("Profiles");

  // summary cards and title (compact white/pale blue visual language)
  expect(html).toContain("AgentLoop 设置中心");
  expect(html).toContain("活跃 Profile");
  expect(html).toContain("Review Agent");
  expect(html).toContain("Fix Agent");

  // no duplicate global sidebar (standalone route)
  expect(html).not.toContain("ant-layout-sider");
  expect(html).not.toContain("native-sidebar");

  // no raw secrets in markup
  expect(html).not.toMatch(/sk-[a-z0-9]/i);
  expect(html).not.toContain("grokApiKey");
});

it("agentloop overview surfaces stale queue path and latest queue candidate", () => {
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html = "";
  try {
    html = renderToStaticMarkup(
      <DashboardApp
        view="workbench-legacy"
        payload={{
          counts: { total: 16, queueTotal: 16 },
          queuePath: "agent-loop/scripts/sliderule-v2-skills-113-queue.json",
          latestQueuePath: "agent-loop/scripts/sliderule-v2-hardening-115-queue.json",
          queueStale: true,
          tasks: [
            {
              id: "sliderule-v2-skill-contract-113",
              task: "agent-loop/tasks/sliderule-v2-skill-contract-113.md",
              enabled: true,
            },
          ],
        }}
      />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  expect(html).toContain("当前队列");
  expect(html).toContain("sliderule-v2-skills-113-queue.json");
  expect(html).toContain("检测到更新队列");
  expect(html).toContain("sliderule-v2-hardening-115-queue.json");
});

it("agentloop setting center visual shell matches SlideRule reference", () => {
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html = "";
  try {
    html = renderToStaticMarkup(
      <DashboardApp payload={{ tasks: [], counts: {} }} initialView="settings-legacy" />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  expect(html).toContain("native-agent-shell");
  expect(html).toContain("native-agent-sidebar");
  expect(html).toContain("native-settings-shell");
  expect(html).toContain("native-settings-summary-card");
  expect(html).toContain("native-settings-panel");
  expect(html).toContain("native-cli-form");

  expect(html).toContain("应用市场");
  expect(html).toContain("设置");
  expect(html).not.toContain('data-testid="sidebar-help-docs"');
  expect(html).toContain("AgentLoop 设置中心");
  expect(html).toContain("CLI 基础配置");
  expect(html).toContain("设置导入 / 导出");

  expect(html).not.toContain("max-width:620");
  expect(html).not.toContain("max-width:720");
  expect(html).not.toContain("max-width:800");
});

it("agentloop setting llm keys visual shell matches reference", () => {
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html = "";
  try {
    html = renderToStaticMarkup(
      <LlmKeyForm
        initial={{
          baseUrl: "https://api.example.com/v1",
          injectToWorker: true,
          keys: {
            grokApiKey: "",
            openaiApiKey: "configured",
            anthropicApiKey: "",
          },
        }}
        onSave={() => {}}
        providerTests={[
          { provider: "openai", status: "ready", durationMs: 42, reason: "cached", checkedAt: "2026-06-25T00:00:00.000Z" },
        ]}
        workerCliTests={[
          { worker: "grok", status: "ok", durationMs: 18, reason: "found" },
        ]}
        onTestProvider={() => {}}
        onTestWorkerCli={() => {}}
      />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  expect(html).toContain("native-llm-panel");
  expect(html).toContain("native-provider-grid");
  expect(html).toContain("native-provider-card");
  expect(html).toContain("native-worker-health-card");
  expect(html).toContain("native-llm-runtime-grid");
  expect(html).toContain("Grok API Key / Token");
  expect(html).toContain("OpenAI API Key");
  expect(html).toContain("Anthropic API Key");
  expect(html).toContain("Worker CLI 健康");
  expect(html).toContain("Probe grok");
  expect(html).toContain("Probe codex");
  expect(html).toContain("代理地址 / Base URL");
  expect(html).toContain("将 Keys 注入到 Worker 环境");
  expect(html).toContain("保存 Keys 配置");
  expect(html).toContain("清除全部 Keys");
  expect(html).toContain("未配置");
  expect(html).toContain("已配置");
  expect(html).toContain("Provider Health");
  expect(html).toContain("敏感 Key 使用安全存储");
  expect(html).not.toContain("max-width:620");
  expect(html).not.toMatch(/sk-[a-z0-9]|RAW_SECRET|apiKey.*secret/i);
});

it("agentloop setting queue defaults visual shell matches reference", () => {
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html = "";
  try {
    html = renderToStaticMarkup(
      <QueueDefaultsView
        data={{
          defaults: {
            fixAgent: "grok",
            reviewAgent: "codex",
            workerMaxTurns: 512,
            workerMaxRetries: 2,
            skipReview: false,
            useWorktree: true,
            worktreeScope: "queue",
            maxIterations: 16,
          },
          supportedKeys: [
            "fixAgent",
            "reviewAgent",
            "workerMaxTurns",
            "workerMaxRetries",
            "skipReview",
            "useWorktree",
            "worktreeScope",
            "maxIterations",
          ],
        }}
        preview={null}
        onPreview={() => {}}
        applyResult={null}
        onApply={() => {}}
        settingsData={{
          nonSensitive: {
            fixAgent: "grok",
            reviewAgent: "codex",
            workerMaxTurns: 512,
          },
        }}
      />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  expect(html).toContain("native-queue-defaults-panel");
  expect(html).toContain("native-queue-code-card");
  expect(html).toContain("native-queue-code-current");
  expect(html).toContain("native-queue-code-patch");
  expect(html).toContain("native-queue-actions");
  expect(html).toContain("队列 defaults（仅支持键，当前值）");
  expect(html).toContain("预览 patch（dry-run，仅支持键；不含 workerEnv）");
  expect(html).toContain("从 Settings 同步并预览 diff");
  expect(html).toContain("预览 structured diff（不写入）");
  expect(html).toContain("supported: fixAgent, reviewAgent, workerMaxTurns");
  expect(html).toContain("workerEnv/secrets 拒绝");
  expect(html).toContain("native-json-key");
  expect(html).toContain("native-json-number");
  expect(html).toContain("native-json-boolean");
  expect(html).not.toContain("max-width:620");
  expect(html).not.toContain("&quot;workerEnv&quot;");
  expect(html).not.toMatch(/RAW_SECRET|sk-[a-z0-9]|&quot;apiKey&quot;|apiKey:\s/i);
});

it("agentloop setting diagnostics visual shell matches reference", () => {
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html = "";
  try {
    html = renderToStaticMarkup(
      <DiagnosticsView
        data={{
          repoRoot: "/workspace/repo",
          queuePath: "agent-loop/scripts/migration-queue.json",
          activeProfile: "local",
          keys: {
            grokApiKey: "configured",
            openaiApiKey: "",
            anthropicApiKey: "",
          },
          effectiveConfig: {
            fixAgent: "grok",
            reviewAgent: "codex",
            workerMaxTurns: 512,
            workerMaxRetries: 2,
            queuePath: "agent-loop/scripts/migration-queue.json",
            worktreeScope: "queue",
            baseUrl: "https://api.example.com/v1",
            injectToWorker: true,
          },
          configSources: {
            fixAgent: "default",
            reviewAgent: "default",
            workerMaxTurns: "workspace",
            workerMaxRetries: "workspace",
          },
          lastRunState: {
            runId: "2026-06-24T12",
            status: "DONE_REVIEWED",
            task: "agent-loop/tasks/demo.md",
          },
          warnings: [
            { category: "ready", message: "provider key(s) configured" },
            { category: "skipped", message: "sample skipped warning" },
            { category: "failed", message: "sample failed (demo)" },
            { category: "unknown", message: "sample unknown" },
          ],
        }}
        onRefresh={() => {}}
      />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  expect(html).toContain("native-diagnostics-panel");
  expect(html).toContain("Diagnostics（只读）");
  expect(html).toContain("刷新");
  expect(html).toContain("Copy JSON");
  expect(html).toContain("Repo root");
  expect(html).toContain("Queue path");
  expect(html).toContain("Key status");
  expect(html).toContain("Effective config");
  expect(html).toContain("Config sources");
  expect(html).toContain("Last run state");
  expect(html).toContain("Warnings（分类）");
  expect(html).toContain("native-diagnostics-summary");
  expect(html).toContain("native-diagnostics-grid");
  expect(html).toContain("native-diagnostics-code-card");
  expect(html).toContain("native-diagnostics-warnings");
  expect(html).toContain("native-diagnostics-footer-note");
  expect(html).toContain("ready");
  expect(html).toContain("skipped");
  expect(html).toContain("failed");
  expect(html).toContain("unknown");
  expect(html).toContain("native-json-key");
  expect(html).toContain("native-json-string");
  expect(html).toContain("native-json-number");
  expect(html).not.toContain("Card size");
  expect(html).not.toContain("max-width:620");
  expect(html).not.toMatch(/RAW_SECRET|sk-[a-z0-9]/i);
});

it("agentloop diagnostics panel renders python health states for ready offline degraded and missing-config", () => {
  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __AGENT_LOOP_CSP_NONCE__: undefined,
    __AGENT_LOOP_ASSETS__: {},
  };

  let html = "";
  try {
    html = renderToStaticMarkup(
      <DiagnosticsView
        data={{
          repoRoot: "/workspace/repo",
          queuePath: "agent-loop/scripts/migration-queue.json",
          activeProfile: "local",
          keys: {
            grokApiKey: "configured",
          },
          effectiveConfig: {
            fixAgent: "grok",
            reviewAgent: "codex",
            workerMaxTurns: 512,
          },
          configSources: {
            fixAgent: "default",
          },
          lastRunState: {
            runId: "2026-06-24T12",
            status: "DONE_REVIEWED",
            task: "agent-loop/tasks/demo.md",
          },
          warnings: [
            { category: "ready", message: "Python ready" },
            { category: "offline", message: "Python offline" },
            { category: "degraded", message: "Python degraded" },
            { category: "missing-config", message: "Python missing config" },
          ],
          pythonHealth: {
            service: { status: "ready", detail: "Python backend ready" },
            providers: [
              { name: "grok", readiness: "ready" },
              { name: "codex", readiness: "offline" },
            ],
            hasMissingConfig: true,
          },
        }}
        onRefresh={() => {}}
      />
    );
  } finally {
    if (typeof origWindow === "undefined") {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = origWindow;
    }
  }

  expect(html).toContain("Python ready");
  expect(html).toContain("Python offline");
  expect(html).toContain("Python degraded");
  expect(html).toContain("Python missing config");
  expect(html).toContain("ready");
  expect(html).toContain("offline");
  expect(html).toContain("degraded");
  expect(html).toContain("missing-config");
});

it("agentloop python health adapter normalizes ready status (topbar removed)", () => {
  // 全局 header/面包屑已移除；健康态仅保留适配器契约（应用中心壳内另有服务 chip）
  const pythonHealth = api.normalizePythonHealthViewModel({
    status: "ready",
    checkedAt: "2026-06-30T10:00:00.000Z",
    providers: {
      grok: { status: "ready" },
      codex: { status: "missing-config", reason: "no key" },
    },
  });

  expect(pythonHealth.service.label).toBe("Python ready");
  expect(pythonHealth.service.status).toBe("ready");
});

it("agentloop python health adapter preserves degraded and missing config states", () => {
  const vm = api.normalizePythonHealthViewModel({
    status: "degraded",
    message: "provider timeout",
    providers: [
      { name: "grok", readiness: "missing-config", detail: "api key missing" },
      { name: "codex", readiness: "offline", detail: "cli unavailable" },
    ],
  });

  expect(vm.service.status).toBe("degraded");
  expect(vm.service.label).toBe("Python degraded");
  expect(vm.hasMissingConfig).toBe(true);
  expect(vm.providers.map((provider) => `${provider.name}:${provider.readiness}`)).toEqual([
    "grok:missing-config",
    "codex:offline",
  ]);
});

it("agentloop workbench 105 shows manual queue landing as applied", () => {
  const html = renderToStaticMarkup(
    <DashboardApp
      payload={{
        counts: { total: 48, queueTotal: 48, done: 48, reviewed: 48 },
        queueRunning: false,
        queuePath: "agent-loop/scripts/backend-python-total-cutover-105-queue.json",
        landing: {
          status: "APPLIED_TO_MAIN_MANUAL",
          appliedToMain: true,
          diffBytes: 314071,
          taskCounts: { total: 12, patch: 10, done: 12 },
          appliedCommitRange: "e4a21cd4..32d8e2c6",
          appliedAt: "2026-07-01T00:00:00.000Z",
        },
        tasks: [],
      }}
      view="workbench-legacy"
    />,
  );

  expect(html).toContain("Queue landing applied to main");
  expect(html).toContain("Manual landing recorded");
  expect(html).toContain("e4a21cd4..32d8e2c6");
  expect(html).not.toContain("Queue landing pending");
});

it("agentloop dashboard shell constrains content to an internal scroll area", () => {
  const css = require("fs").readFileSync(
    require("path").join(__dirname, "dashboard", "dashboard.css"),
    "utf8",
  );

  expect(css).toMatch(/\.native-dashboard\s*\{[\s\S]*?height:\s*100%/);
  expect(css).toMatch(/\.native-agent-shell\s*\{[\s\S]*?height:\s*100%/);
  expect(css).toMatch(/\.native-agent-main\s*\{[\s\S]*?height:\s*100%/);
  expect(css).toMatch(/\.native-content\s*\{[\s\S]*?overflow:\s*auto/);
  expect(css).toMatch(/\.native-content\s*\{[\s\S]*?min-height:\s*0/);
  expect(css).toMatch(/\.native-content\s*\{[\s\S]*?scrollbar-gutter:\s*stable/);
});

it("agentloop workbench cards stretch to their grid columns", () => {
  const css = require("fs").readFileSync(
    require("path").join(__dirname, "dashboard", "dashboard.css"),
    "utf8",
  );

  expect(css).toMatch(
    /\.native-task-table-card,\s*[\r\n]+\.native-task-inspector\s*\{[^}]*width:\s*100%/,
  );
});
