/**
 * Unified single-surface contract for /sliderule (2026-07 merge).
 *
 * The former chat / reasoning / studio surfaces were merged into ONE page:
 *   - studio skeleton (left conversation + right skill rail) is the only surface;
 *   - the 聊天/推演 toggle pills and the surface-mode localStorage key are gone;
 *   - one header row (brand/topic + STATUS + 交付物/重置会话/Dev);
 *   - one empty state (short greeting + composer + 3 suggestion chips);
 *   - the execution timeline + SKILL LINKAGE fold into the right rail as 推演过程;
 *   - the pan/zoom reasoning canvas is no longer rendered here (?im=dev keeps
 *     the split engineering cockpit).
 *
 * Convention: react-dom/server renderToStaticMarkup + vi.mock (no jsdom).
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/deploy-target", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/deploy-target")>();
  return { ...actual, IS_GITHUB_PAGES: false };
});

vi.mock("../TurnRouteTimeline", () => ({
  TurnRouteTimeline: () => <div data-testid="mock-turn-route-timeline" />,
}));

vi.mock("@/components/autopilot/ReasoningFlowSurface", () => ({
  ReasoningFlowSurface: () => <div data-testid="mock-reasoning-canvas" />,
}));

const hookState: { value: Record<string, unknown> } = { value: {} };

function baseHookReturn() {
  return {
    goal: "",
    sessionState: {
      sessionId: "sliderule-unified-test",
      goal: { text: "" },
      artifacts: [],
      capabilityRuns: [],
      coverageGaps: [],
      decisionLedger: [],
    },
    uiTurns: [] as unknown[],
    input: "",
    setInput: () => {},
    isRunning: false,
    liveAction: null,
    sendMessage: async () => {},
    pendingPlanApproval: null,
    submitPlanApproval: () => {},
    pendingAsk: null,
    confirmControlScope: async () => {},
    dismissScopeCard: () => {},
    dismissAsk: () => {},
    challengeTurn: async () => {},
    resetSession: () => {},
    retryCapability: async () => {},
    toggleRouteExpanded: () => {},
    driveMode: "single" as const,
    setDriveMode: () => {},
    stop: () => {},
    executorMode: "server-llm" as const,
    driveFullStatus: "idle" as const,
    activeSkillId: null,
    skillContents: {},
    latestMermaid: null,
    pendingClarifications: [] as unknown[],
    answerClarifications: () => {},
    generateDeliverables: () => {},
  };
}

vi.mock("../useSlideRuleSession", () => ({
  useSlideRuleSession: () => ({ ...baseHookReturn(), ...hookState.value }),
}));

import SlideRule from "@/pages/SlideRule";

function renderPage(overrides: Record<string, unknown> = {}) {
  hookState.value = overrides;
  try {
    return renderToStaticMarkup(React.createElement(SlideRule));
  } finally {
    hookState.value = {};
  }
}

const streamingTurn = {
  id: "turn-run-1",
  user: "做一个采购审批应用",
  assistant: "",
  assistantSource: "llm",
  status: "streaming" as const,
  steps: [
    { id: "s1", kind: "narration", text: "正在解析意图并规划六系统推演" },
  ],
  actions: [],
  routeFacts: { rounds: [], planSelectedCount: 2 },
  routeExpanded: true,
  routeLitCount: 2,
  main: null,
};

describe("unified /sliderule surface (single mental model)", () => {
  it("控制面中断只写在会话里，顶栏不再钉一条同义横幅", () => {
    const html = renderPage({
      driveFullStatus: "control_failed",
      goal: "任务应用",
      uiTurns: [
        {
          ...streamingTurn,
          status: "complete" as const,
          assistant: "推演中断：控制面未返回结果（可重试或换指令）",
          assistantSource: "fallback",
        },
      ],
    });
    expect(html).toContain("推演中断：控制面未返回结果（可重试或换指令）");
    expect(html).toContain("border-amber-400");
    expect(html).not.toContain("本轮执行已中断");
    expect(html).not.toContain('data-testid="sliderule-drive-full-status"');
    expect(html).not.toContain('data-status="control_failed"');
    expect(html).not.toContain("/drive-full");
  });
  it("persisted project references reach the real Studio before any HTML or conversation is restored", () => {
    const html = renderPage({ sessionState: {
      ...baseHookReturn().sessionState,
      runtimeKind: "project", projectId: "persisted-project", projectRevision: "revision-one",
      specFirstPages: { pages: { home: "<h1>HISTORICAL HTML</h1>" } },
    } });
    expect(html).toContain('data-testid="sandbox-preview-surface"');
    expect(html).toContain('data-project-id="persisted-project"');
    expect(html).not.toContain("HISTORICAL HTML");
    expect(html).not.toContain("srcdoc=");
    expect(html).not.toContain('data-testid="sliderule-stage-view-canvas"');
    // A project restored without chat history still mounts the chat empty state.
    // That child used to add a second, hard-coded HTML mode badge.
    // 工程档不再挂「当前：工程工作台模式」——右侧已经是「它的电脑」。
    expect(html).not.toContain("当前：工程工作台模式");
    expect(html).not.toContain("HTML 推演兼容模式");
    expect(html.match(/data-testid="sliderule-runtime-mode"/g) ?? []).toHaveLength(0);
    expect(html).toContain("继续开发这个工程");
  });
  it("renders ONE surface: no 聊天/推演 pills, no surface-mode toggle, no reasoning canvas", () => {
    const html = renderPage();

    expect(html).toContain('data-testid="sliderule-root"');
    expect(html).not.toContain("sliderule-surfacemode-toggle");
    expect(html).not.toContain("sliderule-viewmode-toggle");
    // v4 pan/zoom canvas never renders on the default page
    expect(html).not.toContain("mock-reasoning-canvas");
    // 空会话不挂图标簇（交付物/重置也会占一条底边）
    expect(html).not.toContain('data-testid="sliderule-status-bar"');
  });

  it("empty session hides the chrome cluster（交付物/重置也占一条底边，空态不挂）", () => {
    const html = renderPage();
    expect(html).not.toContain('data-testid="sliderule-status-bar"');
    expect(html).not.toContain('data-testid="sliderule-deliverables-open"');
    expect(html).not.toContain('data-testid="sliderule-reset-session"');
    expect(html).not.toContain('data-testid="sliderule-layout-controls"');
    expect(html).not.toContain('data-testid="project-preview-fullscreen"');
    expect(html).not.toContain('data-testid="project-preview-hide-stage"');
  });

  it("有轮次才挂交付物/重置，且只出现一次（不占整页顶栏）", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: false,
    });

    // Work 模式迁私有主仓：公开仓不再有模式切换
    expect(html).not.toContain('data-testid="sliderule-surface-mode"');
    expect(html).not.toContain('data-testid="sliderule-mode-work"');
    expect(html).not.toContain('data-testid="sliderule-conclusion-badge"');
    expect(html).not.toContain('data-testid="sliderule-goal-display"');
    // ⚠ 2026-09-20：右上两颗（全屏/隐藏）挂回 chromeSlot。分段和交付物仍不挂。
    expect(html).toContain('data-testid="project-preview-fullscreen"');
    expect(html).toContain('data-testid="project-preview-hide-stage"');
    expect(html).not.toContain('data-testid="sliderule-status-bar"');
    expect(html).not.toContain('data-testid="sliderule-deliverables-open"');
    expect(html).not.toContain('data-testid="sliderule-workbench-mode"');
    expect(html).toContain('data-testid="sliderule-reset-session"');
    expect(html).not.toContain('data-testid="sliderule-layout-controls"');
    expect(html).not.toContain("当前：HTML 推演兼容模式");
    expect(html).not.toContain('data-testid="sliderule-runtime-mode"');
    expect(html).not.toContain(">交付物<");
    expect(html).not.toContain(">重置会话<");
    // E28：Dev 入口移除（用户裁决）——工程驾驶舱直接访问 /sliderule/dev
    expect(html).not.toContain('href="/sliderule/dev"');
  });

  it("empty session shows THE single empty state: greeting + Cursor composer card + chips + inspiration", () => {
    const html = renderPage();

    expect(html.match(/data-testid="sliderule-empty-state"/g)?.length).toBe(1);
    expect(html).toContain("今天做点什么？");
    expect(html).not.toContain("想做什么？");
    expect(html).not.toContain("我能为你做什么？");
    expect(html).not.toContain("想推演成什么应用？");
    // ⚠ 2026-09-14：空态不挂运行时徽章。变异：把「工程模式可用」或
    // 「当前：HTML 推演兼容模式」加回问候上方必红。
    expect(html).not.toContain("当前：HTML 推演兼容模式");
    expect(html).not.toContain("工程模式可用 · 确认计划后创建工程");
    expect(html).not.toContain('data-testid="sliderule-runtime-mode"');
    // 不该有：落地页主张句 / logo / 回车提示。变异：把旧文案加回必红。
    expect(html).not.toContain("把一句模糊想法");
    expect(html).not.toContain("能跑起来");
    expect(html).not.toContain("miantuan-mark.png");
    // 2026-08-20：空态芯片下要有键盘提示（设置页同一事实）。旧空格写法是落地页残留。
    expect(html).toContain('data-testid="sliderule-empty-enter-hint"');
    expect(html).toContain("Enter 发送 · Shift+Enter 始终换行");
    expect(html).not.toContain("Shift + Enter 换行");
    // 输入框 → 芯片 → 键盘提示共用外层 gap-7。变异：再套一层更小的 gap-2.5 必红。
    const stack = html.slice(
      html.indexOf('data-testid="sliderule-hero-composer"'),
      html.indexOf('data-testid="sliderule-empty-enter-hint"')
    );
    expect(stack).not.toContain("gap-2.5");
    // E39：模式模板卡整块移除（用户裁决：右侧密度做减法）
    expect(html).not.toContain('data-testid="sliderule-home-mode-');
    // 三个快速开始 chips（完整场景名，无小标题）
    expect(html).toContain('data-testid="sliderule-quick-start-采购审批应用"');
    expect(html).toContain('data-testid="sliderule-quick-start-员工入职流程"');
    expect(html).toContain('data-testid="sliderule-quick-start-客户管理系统"');
    expect(html).not.toContain("从需求文档开始");
    expect(html).not.toContain(">快速开始<");
    // Cursor 卡片输入：没有粉紫光晕。变异：把 glow 加回必红。
    expect(html).not.toContain('data-testid="sliderule-hero-glow"');
    expect(html).not.toContain("rgba(167,139,250");
    expect(html).toContain("rounded-[12px]");
    expect(html).toContain("需要灵感？");
    expect(html).toContain("Fork一下，快人一步");
    expect(html).toContain('data-testid="sliderule-inspiration"');
    expect(html).toContain('data-testid="sliderule-inspiration-all"');
    expect(html).not.toContain(
      'data-testid="sliderule-inspiration-采购审批应用"'
    );
    expect(html).not.toContain('data-testid="sliderule-inspiration-wall"');
    expect(html).not.toContain("应用中心还没有可展示的项目");
    // hero composer 仍在首页流里，且全页仍只有一个 ComposerDock
    expect(html).toContain('data-testid="sliderule-hero-composer"');
    expect(html).not.toContain("sliderule-composer-device");
    expect(html).not.toContain("sliderule-composer-archetype");
    expect(html).not.toContain("sliderule-composer-design-system");
    expect(html).toContain("描述你想做的应用");
    expect(html).not.toContain("挂技能或连接器");
    expect(html).not.toContain("即可选择技能、连接器或伙伴");
    expect(html).not.toContain('data-testid="sliderule-composer-slash-hint"');
    expect(html).not.toContain('data-testid="skill-select-bar"');
    expect(html).toContain('data-testid="sliderule-slash-hint"');
    const dockHtml = html.slice(
      html.indexOf('data-testid="sliderule-composer-dock"'),
      html.indexOf('data-testid="sliderule-inspiration"')
    );
    expect(dockHtml).toContain('data-testid="sliderule-slash-hint"');
    expect(dockHtml).not.toContain("sliderule-composer-slash-hint");
    // 静态营销网点仍禁；鼠标点阵空态和工作台都有。
    expect(html).not.toContain('data-testid="sliderule-empty-dot-field"');
    expect(html).toContain('data-testid="sliderule-home-hover-dots"');
    expect(html.match(/data-testid="sliderule-composer-dock"/g)?.length).toBe(
      1
    );
    expect(html).not.toContain('data-testid="sliderule-composer-footer"');
    expect(html).not.toContain('data-testid="sliderule-composer-actions"');
    expect(html).not.toContain('data-testid="sliderule-composer-context"');
    // the old duplicate empty-state copy is gone
    expect(html).not.toContain("把应用意图发给 SlideRule");
    expect(html).not.toContain("Welcome to SlideRule V5.");
  });

  it("开聊后输入条贴在会话流底部，不再整页浮层截断分隔线", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: false,
    });
    expect(html).toContain('data-testid="sliderule-composer-footer"');
    expect(html.match(/data-testid="sliderule-composer-dock"/g)?.length).toBe(
      1
    );
    expect(html).not.toContain('data-testid="sliderule-hero-composer"');
    expect(html).not.toContain('data-testid="sliderule-empty-enter-hint"');
    expect(html).not.toContain('data-testid="sliderule-composer-device"');
    expect(html).not.toContain('data-testid="sliderule-composer-archetype"');
    expect(html).not.toContain('data-testid="skill-select-bar"');
    expect(html).not.toContain('data-testid="sliderule-empty-dot-field"');
    expect(html).toContain('data-testid="sliderule-home-hover-dots"');
    expect(html).not.toContain("pb-[104px]");
    const footer = html.slice(
      html.indexOf('data-testid="sliderule-composer-footer"'),
      html.indexOf('data-testid="sliderule-composer-dock"')
    );
    expect(footer).toContain("max-w-[720px]");
    expect(footer).not.toContain("border-t");
    // ⚠ 2026-09-14：已收口 / 再核对一下卸了。没提问时不画芯片行。
    expect(html).not.toContain('data-testid="sliderule-composer-actions"');
    expect(html).not.toContain('data-testid="sliderule-composer-hint-chip"');
    expect(html).not.toContain('data-testid="sliderule-composer-status-pill"');
    expect(html).not.toContain('data-testid="sliderule-composer-context"');
    expect(html).not.toContain('data-testid="sliderule-composer-context-spin"');
    // 活路径：会话内渲染出来的就是那张多行卡片，不是 24px 单行胶囊。
    // className 写在 data-testid 前面，所以窗口要往前探一段。
    const dockAt = html.indexOf('data-testid="sliderule-composer-dock"');
    const dockHtml = html.slice(
      Math.max(0, dockAt - 280),
      html.indexOf('data-testid="sliderule-composer-input"') + 280
    );
    expect(dockHtml).toContain("rounded-[12px]");
    expect(dockHtml).toContain("min-h-[72px]");
    expect(dockHtml).toContain("grid-cols-[auto_auto_1fr_auto]");
    expect(dockHtml).not.toContain("rounded-[24px]");
    expect(dockHtml).not.toContain("min-h-7");
    const sendAt = html.indexOf('data-testid="sliderule-composer-send"');
    expect(sendAt).toBeGreaterThan(
      html.indexOf('data-testid="sliderule-composer-input"')
    );
  });

  it("empty session hides the right stage entirely（欢迎页独占全宽，不摆空壳看板）", () => {
    const html = renderPage();

    for (const label of [
      "DataModel",
      "Workflow",
      "RBAC",
      "Page",
      "AIGC",
      "AppBundle",
    ]) {
      expect(html).not.toContain(`>${label}<`);
    }
    expect(html).not.toContain("发布证据看板");
  });

  it("推演中应用未成形 → 右栏 live 占位（不许闪回六系统老看板）", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: true,
    });

    // 用户反馈：发了消息右侧还是老面板——推演中必须是 live 占位
    expect(html).toContain('data-testid="sliderule-live-stage"');
    expect(html).toContain("推演中");
    // ⚠ 2026-09-20：两颗图标在，分段/交付物仍不挂。推演中置灰并写清原因。
    expect(html).toContain('data-testid="project-preview-fullscreen"');
    expect(html).toContain('data-testid="project-preview-hide-stage"');
    expect(html).not.toContain('data-testid="sliderule-workbench-mode"');
    expect(html).toContain("推演进行中，布局锁定为分栏（对话+页面）");
    // ⚠ 2026-09-01：三颗独立开关收成互斥分段，推演中锁定分栏。
    // 缝上折钮仍叫「隐藏页面」，不许拿整页 HTML 去禁这个词。
    expect(html).not.toContain('data-testid="sliderule-layout-stage"');
    expect(html).not.toContain('data-testid="sliderule-layout-maximize"');
    // ⚠ 2026-08-24：「重置布局」按钮撤了（用户："按钮一多看不懂啥意思"），
    // 双击分栏缝仍走同一条 resetLayout。加回按钮这条必红。
    expect(html).not.toContain('data-testid="sliderule-layout-reset"');
    // 反向：撤了布局钮，**重置会话**那颗蓝钮必须还在这一屏够得着——
    // 推演中这支没有标题行可挂，它与图标簇同排渲染。
    expect(html).toContain('data-testid="sliderule-reset-session"');
    expect(html).toContain('aria-label="重置会话"');
    expect(html).not.toContain('data-testid="sliderule-layout-sidebar"');
    expect(html).not.toContain('data-testid="sliderule-layout-chat"');
    expect(html).not.toContain("折叠舞台");
    expect(html).not.toContain("发布证据看板");
    // 「推演过程」右栏标签页已删（与左栏步骤流+LLM 实时草稿完全重复）
    expect(html).not.toContain('data-testid="sliderule-rail-tab-screens"');
    expect(html).not.toContain('data-testid="sliderule-rail-tab-process"');
    expect(html).not.toContain('data-testid="sliderule-rail-process"');
  });

  it("+ 菜单是实用动作（文件/示例），模式选择器已删（用户裁决 2026-07-10）", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: false,
    });
    expect(html).toContain('data-testid="sliderule-actions-menu"');
    expect(html).toContain("添加文件或图片");
    expect(html).toContain("填入示例意图");
    // 2026-09-19：技能勾选撤掉——装了也不进控制面
    expect(html).not.toContain("选择注入的技能");
    expect(html).not.toContain("去扩展中心");
    // 深思一轮/持续推演不再出现在产品面（引擎的马拉松能力保留在 Dev 面）
    expect(html).not.toContain("sliderule-mode-menu");
    expect(html).not.toContain("深思一轮");
    expect(html).not.toContain("持续推演");
  });

  it("思考流留档：完成轮保留 llm_output 记录（默认折叠、无光标）", () => {
    const doneTurn = {
      ...streamingTurn,
      id: "turn-done-1",
      status: "complete" as const,
      assistant: "推演完成，应用已闭环。",
      steps: [
        ...streamingTurn.steps,
        {
          id: "s-arch-1",
          kind: "llm_output" as const,
          title: "分析风险",
          text: "主要风险是版本合并冲突的可视化成本较高，建议先做只读预览。",
          formatJson: false,
        },
        {
          id: "s-arch-2",
          kind: "llm_output" as const,
          title: "起草五系统模型",
          text: '{"datamodel":{"entities":[]}}',
          formatJson: true,
        },
      ],
    };
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [doneTurn],
      isRunning: false,
    });
    expect(html).toContain('data-testid="sliderule-llm-archives"');
    expect(html).toContain("分析风险");
    expect(html).toContain("起草五系统模型");
    expect(html).toContain("字");
    expect(html).not.toContain("字符");
    expect(html).not.toContain("推演过程");
    // 归档默认折叠：正文不直接出现在 DOM（点开才渲染）
    expect(html).not.toContain("版本合并冲突的可视化成本");
    // 归档态无流式光标
    expect(html).not.toContain("▊");
  });

  it("计划已批准、工程还没落库 → 右侧是电脑，不是接线沙盘", () => {
    const html = renderPage({
      goal: "构建一个名为“TicketStream”的服务台",
      uiTurns: [streamingTurn],
      canCreateProject: true,
      sessionState: {
        ...baseHookReturn().sessionState,
        runtimeKind: "html-prototype",
        projectId: null,
      },
    });
    expect(html).toContain('data-testid="sandbox-preview-surface"');
    expect(html).toContain('data-testid="project-computer-chrome"');
    expect(html).toContain('data-testid="project-preview-paused"');
    expect(html).not.toContain('data-testid="sliderule-architecture-stage"');
    // ⚠ 2026-09-15：这里原来是 `not.toContain("接线沙盘")`——拿**用户可见文案**
    //   当「沙盘在不在」的探针。那句文案今天改掉了（「五系统」已退役），
    //   这条断言就会变成永远成立的空判据，而上面一行才是它真正想说的话。
    //   改成钉空态那个 testid：文案怎么改都咬得住。
    expect(html).not.toContain('data-testid="architecture-empty"');
  });

  it("会话在场但未运行（无模型）→ board：接线沙盘 + Checks，不是六圆钮", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: false,
    });

    expect(html).toContain('data-testid="sliderule-architecture-stage"');
    expect(html).toContain('data-testid="architecture-checks"');
    expect(html).toContain("Checks");
    // 不该有：顶栏彩色圆钮。变异：把 SkillThumbnailBar 加回必红。
    expect(html).not.toContain("bg-blue-400");
    expect(html).not.toContain("bg-emerald-400");
    expect(html).not.toContain("发布证据看板");
  });

  it("while running the left column carries the live process; the rail stays on 系统画面", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: true,
      liveAction: { label: "C_EVID · 证据收集中", external: false },
    });

    // conversation shows the live turn + 活动行（动词去掉「正在」）
    expect(html).toContain("做一个采购审批应用");
    expect(html).toContain("解析意图并规划六系统推演");
    expect(html).toContain('data-testid="sliderule-activity-row"');
    expect(html).not.toContain("正在解析意图并规划六系统推演");
    expect(html).toContain('data-authority="agent"');
    // rail is the system screens, never a duplicate process feed
    expect(html).not.toContain('data-testid="sliderule-rail-process"');
    // no empty state while a run is on screen
    expect(html).not.toContain('data-testid="sliderule-empty-state"');
  });

  /**
   * ⚠ 2026-09-05 重写。原判据要的是 2026-09-02 `7afc6a9` **有意删掉**的
   *   pending 骨架（`RECIPE_CORE` 翻译表）。代码改了、判据没改，红了三天。
   *   一条长期红着的判据比没有更坏——它训练所有人把红当背景色。
   *   现在按那次决定重写：左栏仍然按权属分带，但一格都不发明。
   */
  it("左栏按权属分带，没到过的步骤一格都不发明", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      isRunning: true,
      uiTurns: [
        {
          ...streamingTurn,
          routeFacts: {
            rounds: [],
            planSelectedCount: 2,
            planSource: "llm",
          },
          steps: [
            {
              id: "s0",
              kind: "narration",
              text: "指令已接收 · 启动推理",
              source: "fallback",
            },
            {
              id: "s1",
              kind: "chip",
              capabilityId: "intent.parse",
              roleId: "system",
              label: "第 1 轮 · 正在澄清需求",
              realLlm: false,
            },
            {
              id: "s2",
              kind: "chip",
              capabilityId: "intent.parse",
              roleId: "system",
              label:
                "第 2 轮 · 正在执行 起草规格：成功判据、需求节点与页面清单",
              realLlm: true,
            },
          ],
        },
      ],
    });
    expect(html).toContain("Agent 选");
    expect(html).toContain("起草规格");
    expect(html).toContain('data-authority="agent"');
    // ★ 没走到的步骤，**活动行里**一格都不发明。
    //
    // ⚠ 判据只能盯活动行：整页里 `data-status="pending"` 还有第二个来源——
    //   顶上那个六步钟（SlideRuleStatusBar），它本来就该把没走到的步骤显成
    //   pending。第一版写成整页 not.toContain，红在了一个跟本判据无关的组件上。
    const activityRows = [
      ...html.matchAll(/data-testid="sliderule-activity-row"[^>]*/g),
    ].map(m => m[0]);
    expect(activityRows.length).toBeGreaterThan(0);
    expect(activityRows.some(r => r.includes('data-status="pending"'))).toBe(false);
    expect(html).not.toContain("接上数据");
    expect(html).not.toContain("ChainOfThought");
  });

  it("SSE skill activation keeps the minimal live stage (no mid-run system screens)", () => {
    // 用户裁决 2026-07-14：执行期不看中间过程——即使 SSE 激活了某个系统，
    // 右栏也只显示"推演中 + 当前动作"极简态；系统画面等闭环后随效果页呈现。
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      isRunning: true,
      activeSkillId: "dataModel",
      liveAction: { label: "DataModel 建模中", external: false },
    });

    expect(html).not.toContain('data-testid="sliderule-rail-process"');
    expect(html).toContain('data-testid="sliderule-live-stage"');
    expect(html).toContain("DataModel 建模中");
    expect(html).not.toContain("实体关系");
  });

  it("reload restores: persisted state rebuilds the latest turn instead of the empty state", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [],
      sessionState: {
        sessionId: "sliderule-unified-test",
        goal: { text: "做一个采购审批应用", status: "clear" },
        artifacts: [],
        coverageGaps: [],
        runtimePhase: "concluded",
        lastTurnId: "turn-restored",
        capabilityRuns: [
          {
            capabilityId: "evidence.collect",
            roleId: "agent",
            turnId: "turn-restored",
            gateResults: [],
          },
        ],
        decisionLedger: [
          {
            id: "dl-1",
            turnId: "turn-restored",
            source: "llm",
            chose: ["evidence.collect"],
          },
        ],
      },
    });

    // 持久化状态重建成功的判据：不落回空态、恢复轮以对话形态回归且回答就位
    // （STATUS 头部摘要已随状态盒退役；E16 起正文由 streamdown Response 在
    // 客户端填充，SSR 静态渲染为空——以容器属性断言回答存在，不再钉文案）
    expect(html).not.toContain('data-testid="sliderule-empty-state"');
    expect(html).toContain('data-testid="sliderule-turn-answer"');
    expect(html).toContain('data-answer-present="true"');
  });

  it("reload restores every iterated user message, not just the first or last turn", () => {
    // 2026-08-18 真机：刷新后只剩首轮，后面发出的精修指令从左栏消失。
    // 反向：若 conversationTurns 仍是 [latestTurn]，这里只会看到最后一句。
    const html = renderPage({
      goal: "给连锁烘焙店做一套门店订货与损耗管控系统",
      uiTurns: [],
      sessionState: {
        sessionId: "sliderule-unified-test",
        goal: { text: "给连锁烘焙店做一套门店订货与损耗管控系统", status: "clear" },
        artifacts: [],
        coverageGaps: [],
        runtimePhase: "concluded",
        lastTurnId: "turn-3-drive-full",
        capabilityRuns: [
          {
            capabilityId: "synthesis.merge",
            roleId: "agent",
            turnId: "turn-3-drive-full",
            gateResults: [],
          },
        ],
        decisionLedger: [
          {
            id: "dl-3",
            turnId: "turn-3-drive-full",
            source: "llm",
            chose: ["synthesis.merge"],
          },
        ],
        modelVersions: [
          {
            id: "mv-1",
            turnId: "turn-1-drive-full",
            instruction: "给连锁烘焙店做一套门店订货与损耗管控系统",
          },
          {
            id: "mv-2",
            turnId: "turn-2-drive-full",
            instruction: "损耗登记页加临期预警",
          },
          {
            id: "mv-3",
            turnId: "turn-3-drive-full",
            instruction: "收货对账页给到货差异加一键发起补货申请",
          },
        ],
      },
    });

    expect(html).not.toContain('data-testid="sliderule-empty-state"');
    expect(html).toContain("损耗登记页加临期预警");
    expect(html).toContain("收货对账页给到货差异加一键发起补货申请");
    expect(html).toContain("给连锁烘焙店做一套门店订货与损耗管控系统");
  });

  it("Work 模式已迁私有主仓：旧偏好残留也不再切走界面", () => {
    const prev = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (k === "sliderule:surface-mode" ? "work" : null),
      setItem: () => {},
      removeItem: () => {},
    };
    try {
      const html = renderPage();
      expect(html).not.toContain('data-testid="sliderule-work-mode"');
      // 推演主界面照常（含输入条）
      expect(html.match(/data-testid="sliderule-composer-dock"/g)?.length).toBe(
        1
      );
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = prev;
    }
  });

  it("pending clarifications still surface above the composer", () => {
    const html = renderPage({
      pendingClarifications: [
        { id: "gap-1", prompt: "这个审批流需要几级审批？", type: "free_text" },
      ],
      answerClarifications: () => {},
    });

    expect(html).toContain("这个审批流需要几级审批？");
    // 叠在输入框上方，不进 flex 流顶走输入。变异：改回 mb-2 占位必红。
    const card = html.slice(
      html.indexOf("sliderule-clarification-card") - 420,
      html.indexOf("sliderule-clarification-card") + 40
    );
    expect(card).toContain("absolute");
    expect(card).toContain("bottom-full");
    expect(card).toContain("sr-composer-pop");
    const hero = html.slice(
      html.indexOf("sliderule-hero-composer"),
      html.indexOf("sliderule-composer-dock")
    );
    expect(hero).toContain("sliderule-clarification-card");
  });

  /*
   * KD19：作曲家只留**一张**「要不要烧」的决策面。
   *
   * ⚠ 2026-08-27 真机截图：范围卡直接压在 ClarificationCard 上——背后还能
   *   看到那张卡的 × 和输入行。两张决策面同屏，用户不知道该答哪张；更糟的是
   *   背后那张问的还是上一轮的 goal。
   *
   * 成因：`showClarify` 只看 clarifications/clarifyHidden/answerClarifications，
   *   完全没看 pendingScope / pendingAsk。
   *
   * 判据落在渲染出来的 HTML 上（两个 testid 不许同时出现），不是落在
   * showClarify 的源码写法上。
   */
  it("KD19：计划审批时不许同时画澄清卡", () => {
    const html = renderPage({
      pendingClarifications: [
        { id: "gap-1", prompt: "这个诊所系统首期主要服务哪几类核心角色？", type: "free_text" },
      ],
      answerClarifications: () => {},
      pendingPlanApproval: { reqId: "plan-render", planContent: "# Clinic plan" },
      submitPlanApproval: () => {},
    });

    expect(html).toContain("sliderule-plan-approval");
    expect(
      html.includes("sliderule-clarification-card"),
      "范围卡和澄清卡同屏：两张决策面叠在一起（KD19）"
    ).toBe(false);
  });

  it("KD19：ask 停泊时同样不许画澄清卡", () => {
    const html = renderPage({
      pendingClarifications: [
        { id: "gap-1", prompt: "上一轮的问题", type: "free_text" },
      ],
      answerClarifications: () => {},
      pendingAsk: { question: "这是新应用，还是这一版的变体？", options: ["新应用", "变体"] },
    });

    expect(
      html.includes("sliderule-clarification-card"),
      "ask 停泊时还画着澄清卡"
    ).toBe(false);
  });

  it("反向：没有任何停泊时，澄清卡照旧出现（别把它整个关掉）", () => {
    const html = renderPage({
      pendingClarifications: [
        { id: "gap-1", prompt: "这个审批流需要几级审批？", type: "free_text" },
      ],
      answerClarifications: () => {},
    });
    expect(html).toContain("sliderule-clarification-card");
  });

  /*
   * 2026-09-03 用户两张截图：弹出层（sliderule-control-ask 白卡）盖住输入，
   * 要求跟「路线对比一下」同一排芯片。判据落在渲染 HTML 上，不是源码写法。
   */
  it("控制面提问是输入框上方的芯片行，不是弹出层", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      pendingAsk: {
        question: "下一跳点哪张卡片",
        options: ["bind", "closure", "refine"],
      },
      dismissAsk: () => {},
    });

    expect(html).toContain('data-testid="sliderule-control-ask"');
    expect(html).toContain("下一跳点哪张卡片");
    expect(html).toContain("接上数据");
    expect(html).toContain("完整性检查");
    expect(html).toContain("精修页面");
    expect(html).toContain("稍后再说");

    const actions = html.slice(
      html.indexOf('data-testid="sliderule-composer-actions"'),
      html.indexOf('data-testid="sliderule-composer-dock"')
    );
    expect(actions).toContain("sliderule-control-ask");
    expect(actions).toContain("sliderule-control-ask-chip");
    expect(actions).toContain("rounded-full");
    // 提问在场时 hint 芯片让位，别两排抢
    expect(html).not.toContain('data-testid="sliderule-composer-hint-chip"');
    // 反向：弹出层形态（absolute 盖在输入框上）
    const askAt = html.indexOf('data-testid="sliderule-control-ask"');
    const askHtml = html.slice(Math.max(0, askAt - 80), askAt + 220);
    expect(askHtml).not.toContain("absolute");
    expect(askHtml).not.toContain("bottom-full");
    expect(askHtml).not.toContain("sr-composer-pop");
    expect(html).not.toContain('data-testid="sliderule-composer-overlay"');
  });

  it("开放式提问也走芯片行，并明说在输入框里答", () => {
    const html = renderPage({
      goal: "做一个采购审批应用",
      uiTurns: [streamingTurn],
      pendingAsk: { question: "还想补哪条约束？", options: [] },
    });
    const actions = html.slice(
      html.indexOf('data-testid="sliderule-composer-actions"'),
      html.indexOf('data-testid="sliderule-composer-dock"')
    );
    expect(actions).toContain("sliderule-control-ask-typehint");
    expect(actions).toContain("直接在下面的输入框里回答");
    expect(html).not.toContain('data-testid="sliderule-control-ask-chip"');
  });
});

describe("buildImItems（消息 id 对账——重复 id 会让 assistant-ui 整页崩）", () => {
  // 2026-08-18 步伴真机：两个同 id 轮次进了外部存储，MessageRepository
  // 对重复消息 id 直接抛错，整页只剩 "An unexpected error occurred"。
  // 适配层是最后一道闸：撞 id 只许丢一条 + console.warn，不许崩页面。
  const turn = (id: string, user: string) =>
    ({
      id,
      user,
      status: "complete",
      steps: [],
      routeFacts: { turnId: id },
      routeExpanded: false,
      routeLitCount: 0,
      assistant: "",
      assistantSource: "llm",
      main: null,
      actions: [],
    }) as never;

  it("正常轮次：用户+助手成对展开，顺序不变", async () => {
    const { buildImItems } = await import("@/pages/SlideRule");
    const items = buildImItems([turn("t1", "第一句"), turn("t2", "第二句")]);
    expect(items.map(i => i.id)).toEqual([
      "t1-user", "t1-assistant", "t2-user", "t2-assistant",
    ]);
  });

  it("撞 id 时丢先出现的、留后出现的，绝不外泄重复 id", async () => {
    const { buildImItems } = await import("@/pages/SlideRule");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const items = buildImItems([turn("t1", "旧的一份"), turn("t1", "新的一份")]);
      const ids = items.map(i => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      // 留下的是后出现（更新）的那轮
      expect(items.find(i => i.id === "t1-user")?.turn.user).toBe("新的一份");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
