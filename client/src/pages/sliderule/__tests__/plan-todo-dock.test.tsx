/**
 * 待办浮层：只画模型自己写的 `controlTodo`，不进聊天。
 *
 * 2026-09-15 用户对照 Manus：清单嵌在对话里不好用，该是输入条上方一张卡。
 * 同日再圈收起态：默认折叠，脸上是当前条 + 1/4，不是摊开的 Cursor To-dos。
 *
 * 夹具是真机 `sr-20260914051427-QYYWZ17DHH` 的 controlTodo，原样
 * （跟 next-step-chips.test.ts 同一份）。自己拼干净清单测不出真机形态。
 *
 * 点开展开在 `plan-todo-dock.expand.test.tsx`（jsdom）。这里必须留 Node：
 * ClaudeChatSurface 拉 assistant-stream，jsdom 没有 TransformStream。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeChatSurface } from "../../SlideRule";
import { PlanTodoDock } from "../PlanTodoDock";
import {
  planTodoCompleted,
  planTodoProgress,
  visiblePlanTodo,
} from "../plan-todo-dock";
import { isChecklistSnapshot, renderableModelSpeech } from "../model-speech";
import type { UiTurn } from "../types";

/** 真机 `sr-20260914051427-QYYWZ17DHH` 的 controlTodo，原样。 */
const REAL_TODO = [
  { id: "1", status: "completed", content: "创建 react-vite-tasks 工程并读取源码" },
  { id: "2", status: "in_progress", content: "补丁前端：中文文案、极简样式、侧栏筛选 + 宽列表" },
  { id: "3", status: "pending", content: "核对认证与用户隔离的待办 API / SQLite" },
  { id: "4", status: "pending", content: "project_exec 跑 check/build/test 并修复" },
  { id: "5", status: "pending", content: "保留运行后申请 project_verify 并读取验证结果" },
];

const LIST_IN_CHAT =
  "● 创建工程 project_create (react-vite-tasks)\n◐ 确认运行就绪 project_status\n○ 按需补丁 UI/筛选/鉴权对齐";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const completeTurn = (over: Partial<UiTurn> = {}): UiTurn => ({
  id: "t1",
  user: "做一个任务应用",
  status: "complete",
  steps: [
    { id: "s1", kind: "model_speech", text: "先查看工程当前状态。" },
    { id: "s2", kind: "model_speech", text: LIST_IN_CHAT },
  ],
  routeFacts: { turnId: "t1" },
  routeExpanded: false,
  routeLitCount: 0,
  assistant: "推演完成",
  assistantSource: "llm",
  main: { artifactId: "a1", kind: "report", realLlm: true },
  actions: [],
  ...over,
});

describe("visiblePlanTodo：脏数据丢掉，不许编一条", () => {
  it("正向：真机那份一条不少", () => {
    const items = visiblePlanTodo(REAL_TODO);
    expect(items.map(item => item.content)).toEqual(
      REAL_TODO.map(item => item.content)
    );
    expect(items[1].status).toBe("in_progress");
  });

  it("反向：不是数组 / 空 content / 非对象 → 没有", () => {
    expect(visiblePlanTodo(null)).toEqual([]);
    expect(visiblePlanTodo("不是数组")).toEqual([]);
    expect(visiblePlanTodo([null, { id: "x" }, { content: "   " }])).toEqual([]);
  });

  it("反向：夹具里没有的字不许出现", () => {
    const items = visiblePlanTodo(REAL_TODO);
    expect(items.some(item => item.content.includes("伪造"))).toBe(false);
    expect(items.some(item => /src\/|UsersPage/.test(item.content))).toBe(false);
  });

  it("认不出的状态按 pending，不是 completed（跟 Python _coerce_status 同向）", () => {
    expect(visiblePlanTodo([{ content: "甲", status: "weird" }])[0].status).toBe(
      "pending"
    );
  });

  it("飞机大战同文案两套 id 合成一条，脸上不是 3/16", () => {
    const oldRows = [
      { id: "init-project", status: "completed", content: "初始化 Vite React 工程" },
      {
        id: "canvas-engine",
        status: "in_progress",
        content: "Canvas 渲染器、精灵、输入与游戏循环",
      },
    ];
    const newRows = [
      { id: "task-1", status: "completed", content: "初始化 Vite React 工程" },
      {
        id: "task-3",
        status: "completed",
        content: "Canvas 渲染器、精灵、输入与游戏循环",
      },
    ];
    const items = visiblePlanTodo([...oldRows, ...newRows]);
    expect(items).toHaveLength(2);
    expect(items[1].status).toBe("completed");
    expect(items[1].id).toBe("task-3");
    const { current, total, currentContent } = planTodoProgress(items);
    expect(total).toBe(2);
    expect(current).toBe(2);
    expect(currentContent).toBeNull();
  });

  it("反向：文案不同的新 id 仍是两条", () => {
    expect(
      visiblePlanTodo([
        { id: "a", status: "pending", content: "画飞机" },
        { id: "b", status: "pending", content: "加音效" },
      ])
    ).toHaveLength(2);
  });
});

describe("planTodoProgress：Manus 那格 1/4", () => {
  it("正向：正在做的那条是第几条", () => {
    const { current, total, currentContent } = planTodoProgress(
      visiblePlanTodo(REAL_TODO)
    );
    expect(current).toBe(2);
    expect(total).toBe(5);
    expect(currentContent).toContain("补丁前端");
  });

  it("cancelled 不进分母", () => {
    const { current, total } = planTodoProgress(
      visiblePlanTodo([
        { id: "1", status: "cancelled", content: "作废" },
        { id: "2", status: "in_progress", content: "正在做" },
        { id: "3", status: "pending", content: "还没做" },
      ])
    );
    expect(current).toBe(1);
    expect(total).toBe(2);
  });
});

describe("planTodoCompleted：进度条只认 completed，不编百分比", () => {
  it("正向：真机那份 1 条完成 → 20%", () => {
    expect(planTodoCompleted(visiblePlanTodo(REAL_TODO))).toEqual({
      done: 1,
      total: 5,
      percent: 20,
    });
  });

  it("反向：没有 completed 就是 0，不许垫一个假的 25", () => {
    expect(
      planTodoCompleted(
        visiblePlanTodo([{ id: "1", status: "in_progress", content: "正在做" }])
      )
    ).toEqual({ done: 0, total: 1, percent: 0 });
  });
});

describe("PlanTodoDock 卡片", () => {
  it("正向：默认折叠，脸上是当前条 + Manus 做到第几条", () => {
    const html = renderToStaticMarkup(<PlanTodoDock items={REAL_TODO} />);
    expect(html).toContain('data-testid="plan-todo-dock"');
    expect(html).toContain('data-plan-todo-surface="manus"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-testid="plan-todo-current"');
    expect(html).toContain("补丁前端：中文文案、极简样式、侧栏筛选 + 宽列表");
    expect(html).toContain("2/5");
    expect(html).toContain("sr-todo-spin");
    expect(html).toContain('data-testid="plan-todo-progress"');
    expect(html).toContain('data-todo-percent="20"');
    expect(html).not.toContain("核对认证与用户隔离");
    expect(html).not.toContain("创建 react-vite-tasks 工程并读取源码");
    expect(html).not.toContain("1/5");
    expect(html).not.toContain("data-todo-pie");
  });

  it("反向：不许编一条、也不许编 25% 这种假进度", () => {
    const html = renderToStaticMarkup(<PlanTodoDock items={REAL_TODO} />);
    expect(html).not.toContain("25%");
    expect(html).not.toContain("伪造");
    expect(html).not.toContain('data-todo-mark="radio"');
  });

  it("反向：空清单 / 脏数据不画卡", () => {
    expect(renderToStaticMarkup(<PlanTodoDock items={[]} />)).toBe("");
    expect(renderToStaticMarkup(<PlanTodoDock items={null} />)).toBe("");
    expect(
      renderToStaticMarkup(<PlanTodoDock items={[null as never, { id: "x" }]} />)
    ).toBe("");
  });

  it("反向：cancelled 不画出来", () => {
    const html = renderToStaticMarkup(
      <PlanTodoDock
        items={[
          { id: "1", status: "cancelled", content: "作废这条" },
          { id: "2", status: "pending", content: "还要做" },
        ]}
      />
    );
    expect(html).toContain("还要做");
    expect(html).not.toContain("作废这条");
  });
});

describe("接在真跑的那条路上（§1 / §3）", () => {
  it("聊天正文不再印 ○◐● 清单", () => {
    const speech = renderableModelSpeech(completeTurn());
    expect(speech.filter(item => isChecklistSnapshot(item.text))).toHaveLength(0);
    expect(speech.map(item => item.text)).toEqual(["先查看工程当前状态。"]);
  });

  it("ClaudeChatSurface：清单在输入条上方，不在 model-speech 里", () => {
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[completeTurn()]}
        isRunning={false}
        liveAction={null}
        latestTurn={completeTurn()}
        onChallenge={() => {}}
        controlTodo={REAL_TODO}
        composerSlot={<div data-testid="sliderule-composer-dock" />}
      />
    );
    expect(html).toContain('data-testid="plan-todo-dock"');
    expect(html).toContain("补丁前端：中文文案、极简样式、侧栏筛选 + 宽列表");
    const dockAt = html.indexOf('data-testid="plan-todo-dock"');
    const composerAt = html.indexOf('data-testid="sliderule-composer-dock"');
    const dockHtml = html.slice(dockAt, composerAt);
    expect(dockHtml).toContain('aria-expanded="false"');
    expect(dockHtml).toContain("2/5");
    expect(dockHtml).not.toContain("核对认证与用户隔离");
    expect(dockHtml).not.toContain("创建 react-vite-tasks 工程并读取源码");
    const speechAt = html.indexOf('data-testid="sliderule-model-speech"');
    const speechHtml = html.slice(speechAt, speechAt + 400);
    expect(speechHtml).toContain("先查看工程当前状态。");
    expect(speechHtml).not.toContain("○ 按需补丁");
    expect(html).not.toContain(LIST_IN_CHAT);
    expect(dockAt).toBeGreaterThan(-1);
    expect(composerAt).toBeGreaterThan(dockAt);
  });

  it("反向：不传 controlTodo 就不画浮层——不许从聊天 ○ 行编一份", () => {
    const html = renderToStaticMarkup(
      <ClaudeChatSurface
        uiTurns={[completeTurn()]}
        isRunning={false}
        liveAction={null}
        latestTurn={completeTurn()}
        onChallenge={() => {}}
        composerSlot={<div data-testid="sliderule-composer-dock" />}
      />
    );
    expect(html).not.toContain('data-testid="plan-todo-dock"');
    expect(html).not.toContain("按需补丁 UI/筛选/鉴权对齐");
  });

  it("footer 真的挂了 PlanTodoDock，不是只有纯函数对", () => {
    const src = stripComments(
      readFileSync(resolve(__dirname, "../../SlideRule.tsx"), "utf8")
    );
    const footer = src.slice(
      src.indexOf("sliderule-composer-footer"),
      src.indexOf("sliderule-composer-footer") + 900
    );
    expect(footer).toContain("PlanTodoDock");
    expect(footer).toContain("controlTodo");
    const hook = stripComments(
      readFileSync(resolve(__dirname, "../useSlideRuleSession.ts"), "utf8")
    );
    const tail = hook.split("onControlTodo")[1].slice(0, 500);
    expect(tail).toContain("visiblePlanTodo");
    expect(tail).toContain("controlTodo");
    expect(tail).not.toContain("appendStreamStep");
    expect(tail).not.toContain("📋");
  });

  it("卡面抄 Manus：默认折叠、当前条、做到第几条，没有饼图", () => {
    const dock = stripComments(
      readFileSync(resolve(__dirname, "../PlanTodoDock.tsx"), "utf8")
    );
    expect(dock).toContain('data-plan-todo-surface="manus"');
    expect(dock).toContain("planTodoProgress");
    expect(dock).toContain("useState(false)");
    expect(dock).toContain("plan-todo-current");
    expect(dock).toContain("rounded-2xl");
    expect(dock).toContain("overflow-y-auto");
    expect(dock).toContain("overscroll-contain");
    expect(dock).toContain("break-words");
    expect(dock).toContain("sr-todo-spin");
    // 标题 / 清单 / 底栏同一条横垫，条目不再另加 px-1，不然勾和「待办」错位。
    expect(dock.match(/px-3\.5/g)?.length).toBeGreaterThanOrEqual(3);
    expect(dock).toContain("px-3.5 pb-1.5");
    expect(dock).not.toContain("overscroll-contain px-3\"");
    expect(dock).not.toContain("gap-2.5 px-1 py-[7px]");
    expect(dock).not.toContain("useState(true)");
    expect(dock).not.toContain("scrollIntoView");
    expect(dock).not.toContain("rounded-[12px]");
    expect(dock).not.toContain('data-plan-todo-surface="cursor"');
    expect(dock).not.toContain("beui");
    expect(dock).not.toContain("ProgressPie");
    expect(dock).not.toContain("data-todo-pie");
    expect(dock).not.toContain("ListTodo");
    expect(dock).not.toContain("RollingText");
    expect(dock).not.toContain("didAutoCollapse");
    const css = readFileSync(resolve(__dirname, "../../../index.css"), "utf8");
    expect(css).toContain(".sr-todo-spin");
    expect(css).toContain(".sr-reduce-motion .sr-todo-spin");
  });
});
