/**
 * 迭代环一期（编辑重跑 / 重新推演）静态渲染回归。
 *
 * 锁三件事：
 *   1. 完成轮带用户文本 → 「重新推演」与「编辑重跑」都渲染；
 *   2. 恢复轮（无 turn.user）→ 两个按钮都不出现（不发空意图）；
 *   3. 运行中 → 「重新推演」禁用（重入保护；点击行为在 sendMessage
 *      textOverride 的 typeof 守卫下有独立单测价值，但静态渲染只锁 disabled）。
 *
 * 仓库约定：react-dom/server renderToStaticMarkup，不引 jsdom/RTL。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeChatSurface } from "../../SlideRule";
import type { UiTurn } from "../types";
import {
  buildRehearsalClockView,
  idleRehearsalCursor,
  startRehearsalCursor,
} from "../derive-status-bar";

const completeTurn = (over: Partial<UiTurn> = {}): UiTurn => ({
  id: "t1",
  user: "做一个宠物医院预约系统",
  status: "complete",
  steps: [],
  routeFacts: { turnId: "t1" },
  routeExpanded: false,
  routeLitCount: 0,
  assistant: "推演完成",
  assistantSource: "llm",
  main: { artifactId: "a1", kind: "report", realLlm: true },
  actions: [],
  ...over,
});

const surface = (turns: UiTurn[], isRunning = false) =>
  renderToStaticMarkup(
    <ClaudeChatSurface
      uiTurns={turns}
      isRunning={isRunning}
      liveAction={null}
      latestTurn={turns.at(-1) ?? null}
      onChallenge={() => {}}
    />
  );

describe("迭代环一期：编辑重跑 / 重新推演", () => {
  it("empty state hides the runtime-mode pill even when project mode is available", () => {
    const html = renderToStaticMarkup(<ClaudeChatSurface
      uiTurns={[]} isRunning={false} liveAction={null} latestTurn={null}
      onChallenge={() => {}}
      projectCapabilities={{ mode: "internal", configured: true, canExecute: true }}
    />);
    expect(html).not.toContain("工程模式可用 · 确认计划后创建工程");
    expect(html).not.toContain("HTML 推演兼容模式");
    expect(html).not.toContain("当前：工程工作台模式");
    expect(html).not.toContain('data-testid="sliderule-runtime-mode"');
  });
  it("工程档不挂质疑本轮 / 重新推演（结果卡已有重试）", () => {
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[completeTurn()]}
        isRunning={false}
        liveAction={null}
        latestTurn={completeTurn()}
        onChallenge={() => {}}
        runtimeKind="project"
      />
    );
    expect(html).not.toContain('data-testid="sliderule-rerun-turn"');
    expect(html).not.toContain('data-testid="sliderule-challenge-turn"');
    expect(html).not.toContain("重新推演");
    expect(html).not.toContain("质疑本轮");
  });

  it("完成轮带用户文本 → 两个按钮都渲染，且与质疑本轮同排", () => {
    const html = surface([completeTurn()]);
    expect(html).toContain('data-testid="sliderule-rerun-turn"');
    expect(html).toContain("重新推演");
    expect(html).toContain('data-testid="sliderule-edit-rerun"');
    expect(html).toContain("编辑重跑");
    expect(html).toContain("质疑本轮");
  });

  it("恢复轮（无 turn.user）→ 不渲染迭代按钮（不发空意图）", () => {
    const html = surface([completeTurn({ user: "", main: null })]);
    expect(html).not.toContain('data-testid="sliderule-rerun-turn"');
    expect(html).not.toContain('data-testid="sliderule-edit-rerun"');
  });

  it("廉价提问轮没有产物 → 不渲染重新推演（那不是推演）", () => {
    const html = surface([
      completeTurn({
        user: "你是谁",
        assistant: "想做什么应用，说一句就行。",
        main: null,
        steps: [],
      }),
    ]);
    expect(html).toContain("你是谁");
    expect(html).toContain('data-answer-present="true"');
    expect(html).not.toContain('data-testid="sliderule-rerun-turn"');
  });

  it("运行中 → 重新推演禁用（重入保护）", () => {
    const html = surface([completeTurn()], true);
    const btn = html.slice(html.indexOf('data-testid="sliderule-rerun-turn"') - 200);
    expect(btn).toContain("disabled");
  });

  it("用户块是灰底不是品牌蓝气泡（不该有：#e6f4ff 聊天气泡）", () => {
    const html = surface([completeTurn()]);
    const start = html.indexOf('data-testid="sliderule-user-bubble"');
    expect(start).toBeGreaterThan(-1);
    const bubble = html.slice(start, html.indexOf("编辑重跑"));
    expect(bubble).toContain("bg-[#f3f4f6]");
    expect(bubble).not.toContain("bg-[#e6f4ff]");
  });
});

describe("对话区 / 输入条 Cursor 尺度（装在真链路上）", () => {
  it("停靠输入条不再用渐变发送和大投影", () => {
    const userFn = readFileSync(
      new URL("../../SlideRule.tsx", import.meta.url),
      "utf8",
    );
    const slice = userFn.slice(
      userFn.indexOf("function ImUserMessage"),
      userFn.indexOf("function ImAssistantMessage"),
    );
    expect(slice).toContain("bg-[#f3f4f6]");
    expect(slice).not.toContain("bg-[#e6f4ff]");

    const dock = readFileSync(
      new URL("../ComposerDock.tsx", import.meta.url),
      "utf8",
    );
    expect(dock).not.toContain("from-[#E08663]");
    expect(dock).not.toContain("shadow-[0_10px_36px");
    expect(dock).toContain("ArrowUp");
    // 会话内跟空态同一张多行卡片。变异回单行胶囊 / 28px 必红。
    expect(dock).toContain("grid-cols-[auto_auto_1fr_auto]");
    expect(dock).toContain("min-h-[72px]");
    expect(dock).toContain("const minH = 72");
    expect(dock).not.toContain("hero ? 72 : 28");
    expect(dock).not.toContain("hero ? 88 : 32");
    expect(dock).not.toContain("min-h-7");
    expect(dock).not.toContain("rounded-[24px]");
    expect(dock).not.toContain("{hero ? null : sendButton}");
    expect(dock).not.toContain("min-w-0 flex-1 pb-0.5");
  });
});

describe("产品对话列的六步钟（不打开轨迹也能看见）", () => {
  /**
   * ⚠ 2026-09-05 重写。原判据要的是「永远画 6 步、第 1 步显示成 skipped」。
   *   2026-09-02 `7afc6a9`（钟跟本趟 goal.tools 走）把它改了，
   *   `buildRehearsalClockView` 末尾写着：
   *
   *     // 抄 grok：进度只画选中的步。skipped 留在状态机里，钟上不占格——
   *     // 永远六格就是死日历。
   *
   *   于是 skipped 的格子**根本不渲染**，`data-status="skipped"` 再也不会出现，
   *   钟从第 2 格起画。真机截图上顶栏就是「2 起草 SPEC … 6 汇合过闸」五格。
   *   代码改了、判据没改，红了三天——而长期红着的判据比没有更坏。
   *
   *   现在按那个决定重写：只画会跑的那几步，不画死日历，仍然不许有假 ETA。
   */
  it("对话列顶上不挂六步钟（2026-09-15 用户圈了要移除）", () => {
    const clock = buildRehearsalClockView(startRehearsalCursor(), {
      isRunning: true,
    });
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[]}
        isRunning
        liveAction={null}
        latestTurn={null}
        onChallenge={() => {}}
        rehearsalClock={clock}
        hud={{
          gatedEvidenceCount: 0,
          narrativeTokens: 0,
          hasServerTokenFacts: false,
        }}
      />
    );
    expect(html).not.toContain('data-testid="sliderule-rehearsal-clock"');
    expect(html).not.toContain("起草 SPEC");
    expect(html).not.toContain("汇合过闸");
  });

  it("不传钟就不渲染 HUD（删掉 ClaudeChatSurface 的 rehearsalClock 必红）", () => {
    const html = surface([], true);
    expect(html).not.toContain('data-testid="sliderule-rehearsal-clock"');
  });

  it("刷新后对话列顶上也不挂证据/token 行", () => {
    const idleClock = buildRehearsalClockView(idleRehearsalCursor(), {
      isRunning: false,
    });
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[]}
        isRunning={false}
        liveAction={null}
        latestTurn={null}
        onChallenge={() => {}}
        rehearsalClock={idleClock}
        hud={{
          gatedEvidenceCount: 0,
          narrativeTokens: 0,
          hasServerTokenFacts: false,
        }}
        publishClosure={{
          blocked: true,
          evidencePresentCount: 0,
          skillCount: 6,
          versionPinsChecked: false,
          topBlockers: [],
          // 跟同一份夹具里的 tierCounts.hard_blocker 对齐：声明了一条硬拦截，
          // blockerCount 就得是 1，不能一边说有一边说没有。
          blockerCount: 1,
          tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
        }}
      />
    );
    expect(html).not.toContain('data-testid="sliderule-context-hud"');
    expect(html).not.toContain('data-testid="sliderule-rehearsal-clock"');
  });
});

describe("工程档对话：先开口再列动作，不把六步钟叠上去", () => {
  const SPEECH = "我先把筛选改成顶部三段按钮，再核对登录态。";
  const projectTurn = (): UiTurn =>
    completeTurn({
      status: "streaming",
      assistant: "",
      main: null,
      steps: [
        { id: "s1", kind: "model_speech", text: SPEECH },
        {
          id: "a",
          kind: "chip",
          capabilityId: "project_exec",
          roleId: "system",
          label: "运行命令",
          realLlm: false,
          progressType: "acting",
        },
      ],
    } as Partial<UiTurn>);

  it("散文在清单上面（把清单挂回整列最顶上必红）", () => {
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[projectTurn()]}
        isRunning
        liveAction={null}
        latestTurn={projectTurn()}
        onChallenge={() => {}}
        runtimeKind="project"
      />
    );
    const speechAt = html.indexOf('data-testid="sliderule-model-speech"');
    // ⚠ 2026-09-20：d8e4ccd8 把清单换成了 SessionStory 的时间线，并在那个 <ol>
    //   上留了 data-checklist="project-task-checklist" 当延续标记，但没改这条判据，
    //   于是 listAt 恒为 -1、main 带着这条红进来。判据要盯**真正渲染出来的那个**（§5）。
    //   ProjectTaskChecklist 组件本身现在没有任何产线渲染点（模块仍导出别的东西给
    //   SessionStory 用），单独在 review 里记了一笔。
    const listAt = html.indexOf('data-checklist="project-task-checklist"');
    expect(speechAt).toBeGreaterThan(-1);
    expect(listAt).toBeGreaterThan(-1);
    expect(listAt).toBeGreaterThan(speechAt);
    expect(html).toContain(SPEECH);
    expect(html).toContain('data-testid="session-story"');
  });

  it("历史轮次也留章节——把 latestTurn 门加回去，上一轮开口必丢", () => {
    const older = completeTurn({
      id: "old",
      durationMs: 120_000,
      steps: [
        { id: "s-old", kind: "model_speech", text: "先把工程搭起来。" },
        {
          id: "c-old",
          kind: "chip",
          capabilityId: "project_create",
          roleId: "system",
          label: "创建工程",
          realLlm: false,
          progressType: "completed",
        },
      ],
    });
    const newer = completeTurn({
      id: "new",
      durationMs: 30_000,
      steps: [
        { id: "s-new", kind: "model_speech", text: "接着改筛选。" },
        {
          id: "c-new",
          kind: "chip",
          capabilityId: "project_patch",
          roleId: "system",
          label: "写入源码",
          realLlm: false,
          progressType: "completed",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[older, newer]}
        isRunning={false}
        liveAction={null}
        latestTurn={newer}
        onChallenge={() => {}}
        runtimeKind="project"
      />
    );
    expect(html.match(/data-testid="session-story"/g) ?? []).toHaveLength(2);
    expect(html).toContain("先把工程搭起来。");
    expect(html).toContain("接着改筛选。");
  });

  it("完成轮开口只出现一次——assistant 再抄同一句也不许叠影", () => {
    // 2026-09-16 TicketStream 真机：I'll start by planning… 印两遍。
    // SSR 下 Response 是空的，所以盯 data-answer-present：开口已经画过
    // 就必须 false。变异：ImAssistantMessage 不再过 answerAlreadySpoken
    // → 收尾仍宣称有回答。
    const live =
      "I'll start by planning this build — but first, a couple of decisions I need from you so I don't guess wrong on scope and stack.";
    const visible = (html: string) =>
      html
        .replace(/&#x27;/gi, "'")
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
    const turn = completeTurn({
      assistant: live,
      assistantSource: "llm",
      main: null,
      steps: [{ id: "s1", kind: "model_speech", text: live }],
    });
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[turn]}
        isRunning={false}
        liveAction={null}
        latestTurn={turn}
        onChallenge={() => {}}
        runtimeKind="project"
      />
    );
    expect(html).toContain('data-testid="sliderule-model-speech"');
    expect(visible(html).split(live).length - 1).toBe(1);
    expect(html).toContain('data-answer-present="false"');

    const other = completeTurn({
      assistant: "I'll write up the plan first, then build it.",
      assistantSource: "llm",
      main: null,
      steps: [{ id: "s1", kind: "model_speech", text: live }],
    });
    const otherHtml = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[other]}
        isRunning={false}
        liveAction={null}
        latestTurn={other}
        onChallenge={() => {}}
        runtimeKind="project"
      />
    );
    expect(visible(otherHtml)).toContain("start by planning this build");
    expect(otherHtml).toContain('data-answer-present="true"');

    const src = readFileSync(
      new URL("../../SlideRule.tsx", import.meta.url),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const assistant = src.slice(
      src.indexOf("function ImAssistantMessage"),
      src.indexOf("export function ClaudeChatSurface")
    );
    expect(assistant).toContain("answerAlreadySpoken");
  });

  it("工程档不挂六步钟——那是 HTML 推演的词汇", () => {
    const runningClock = buildRehearsalClockView(startRehearsalCursor(), {
      isRunning: true,
    });
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[projectTurn()]}
        isRunning
        liveAction={null}
        latestTurn={projectTurn()}
        onChallenge={() => {}}
        runtimeKind="project"
        rehearsalClock={runningClock}
        hud={{
          gatedEvidenceCount: 0,
          narrativeTokens: 0,
          hasServerTokenFacts: false,
        }}
      />
    );
    expect(html).not.toContain('data-testid="sliderule-rehearsal-clock"');
  });
});
