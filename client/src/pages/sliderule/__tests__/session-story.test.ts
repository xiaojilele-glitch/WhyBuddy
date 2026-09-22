/**
 * 会话章节：按发生顺序切，不许再分桶倒。
 *
 * 2026-09-15 对照 Manus TicketStream 完成态。三桶并排（所有开口 →
 * 所有勾 → 结果卡）会把「接着改筛选」挪到第一组工具前面。
 * 按工具名 Map 归并会让三次 patch 中间那次失败消失。
 *
 * 判据盯语义和顺序，不 grep 组件名。把修复改回去下面必红。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chapterTitleForRows,
  deriveSessionStory,
  disclosureOpen,
  latestToolRowTitle,
  liveStageTitle,
  sessionStoryDuration,
  sessionStoryHasProcess,
  isExpandableCommandRow,
  timelineRowTitle,
  toolFamily,
  toolGroupFace,
  toolGroupSummary,
} from "../session-story";
import type { TurnStep, UiTurn } from "../types";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function chip(
  id: string,
  tool: string,
  progress: "acting" | "completed" | "failed",
  detail?: string
): TurnStep {
  return {
    id,
    kind: "chip",
    capabilityId: tool as never,
    roleId: "system",
    label: tool,
    realLlm: false,
    progressType: progress,
    ...(detail ? { projectDetail: detail } : {}),
  };
}

function speech(id: string, text: string): TurnStep {
  return { id, kind: "model_speech", text };
}

function turnOf(steps: TurnStep[], over: Partial<UiTurn> = {}): UiTurn {
  return {
    id: "t1",
    user: "构建 TicketStream",
    status: "complete",
    steps,
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "TicketStream 已完成。",
    assistantSource: "llm",
    main: null,
    actions: [],
    ...over,
  };
}

const LIST = "● 创建工程 project_create\n◐ 写入源码 project_patch";

describe("开口切开工具组，不许先倒完全部散文", () => {
  it("真机那一发的形状：开口 → 创建 → 开口 → 三次 patch；结果卡不插过程中间", () => {
    const blocks = deriveSessionStory(
      turnOf([
        speech("s1", "我先把工程搭起来，再改筛选。"),
        chip("c1", "project_create", "completed"),
        chip("l1", "project_list", "completed"),
        speech("s2", "接着改筛选。"),
        chip("p1a", "project_patch", "acting", "src/Home.tsx"),
        chip("p1b", "project_patch", "completed", "src/Home.tsx"),
        chip("p2a", "project_patch", "acting"),
        chip("p2b", "project_patch", "failed", "type error"),
        chip("p3a", "project_patch", "acting"),
        chip("p3b", "project_patch", "completed"),
      ])
    );
    expect(blocks.map(block => block.kind)).toEqual([
      "speech",
      "tools",
      "speech",
      "tools",
    ]);
    expect(blocks.some(block => block.kind === "product")).toBe(false);
    expect(
      blocks.filter(block => block.kind === "speech").map(block => block.text)
    ).toEqual(["我先把工程搭起来，再改筛选。", "接着改筛选。"]);
    const files = blocks.find(
      (block): block is Extract<typeof block, { kind: "tools" }> =>
        block.kind === "tools" && block.summary.includes("文件")
    );
    expect(files?.rows).toHaveLength(3);
    expect(files?.rows.map(row => row.status)).toEqual([
      "done",
      "failed",
      "done",
    ]);
    expect(files?.summary).toBe("编辑了 3 个文件");
    // 变异：按工具名 Map 归并 → 只剩 1 行，上面两条红。
  });

  it("英文开口也进章节——2026-09-16 文种过滤弊大于利", () => {
    const live =
      '**Initial Assessment and Planning for "TicketStream" SaaS Interface**\n\n' +
      "Okay, so the task is clear: build a TicketStream service desk SaaS interface. " +
      "My immediate focus is understanding the requirements before writing code.";
    const blocks = deriveSessionStory(
      turnOf(
        [
          speech("s-en", live),
          chip("c1", "project_create", "completed"),
          speech("s-zh", "我先把 TicketStream 工程搭起来。"),
        ],
        { user: "构建一个名为 TicketStream 的服务台 SaaS 界面" }
      )
    );
    expect(
      blocks.filter(block => block.kind === "speech").map(block => block.text)
    ).toEqual([live, "我先把 TicketStream 工程搭起来。"]);
    expect(JSON.stringify(blocks)).toContain("Initial Assessment");
    // 变异：把 speechMismatchesUserLanguage 加回 isStorySpeech → 本条红。
  });

  it("反向：清单快照不进章节，开口留下", () => {
    const blocks = deriveSessionStory(
      turnOf([
        speech("s1", "先看一眼工程。"),
        speech("todo", LIST),
        chip("c1", "project_status", "completed"),
      ])
    );
    expect(blocks.map(block => block.kind)).toEqual(["speech", "tools"]);
    expect(blocks[0]).toMatchObject({ text: "先看一眼工程。" });
    expect(JSON.stringify(blocks)).not.toContain("● 创建工程");
  });

  it("反向：没有开口也没有工程动作 → 空故事，不编一章", () => {
    expect(deriveSessionStory(turnOf([]))).toEqual([]);
    expect(deriveSessionStory(null)).toEqual([]);
    expect(sessionStoryHasProcess([])).toBe(false);
  });

  it("只看这一轮：上一轮的 create 不许摊进这一轮", () => {
    const previous = turnOf([chip("old", "project_create", "completed")]);
    const current = turnOf([
      speech("s2", "接着改筛选。"),
      chip("p1", "project_patch", "completed", "src/Home.tsx"),
    ]);
    const blocks = deriveSessionStory(current);
    expect(blocks.some(block => block.kind === "product")).toBe(false);
    const tools = blocks.filter(block => block.kind === "tools");
    expect(tools).toHaveLength(1);
    if (tools[0]?.kind === "tools") {
      expect(tools[0].rows.map(row => row.tool)).toEqual(["project_patch"]);
    }
    expect(deriveSessionStory(previous)[0]).toMatchObject({ kind: "tools" });
  });
});

describe("组标题和摘要认工具名", () => {
  it("创建 + 列表是构建网页；预览单独是预览网页", () => {
    expect(
      chapterTitleForRows([
        { id: "a", tool: "project_create", label: "创建工程", status: "done" },
        { id: "b", tool: "project_list", label: "读取工程列表", status: "done" },
      ])
    ).toBe("构建网页");
    expect(
      chapterTitleForRows([
        { id: "a", tool: "project_start", label: "启动预览", status: "done" },
        { id: "b", tool: "project_verify", label: "浏览器检查", status: "done" },
      ])
    ).toBe("预览网页");
    expect(
      chapterTitleForRows([
        {
          id: "a",
          tool: "project_restore",
          label: "恢复到历史版本",
          status: "done",
        },
      ])
    ).toBe("回滚");
  });

  it("同一章只亮一次标题——中间夹开口再构建，第二组不再写「构建网页」", () => {
    const blocks = deriveSessionStory(
      turnOf([
        chip("c1", "project_create", "completed"),
        speech("s2", "开始写页面。"),
        chip("p1", "project_patch", "completed"),
      ])
    );
    const tools = blocks.filter(block => block.kind === "tools");
    expect(tools).toHaveLength(2);
    if (tools[0]?.kind === "tools" && tools[1]?.kind === "tools") {
      expect(tools[0].showChapter).toBe(true);
      expect(tools[0].chapter).toBe("构建网页");
      expect(tools[1].showChapter).toBe(false);
    }
  });

  it("模板之外的工具也要出现在摘要里", () => {
    expect(
      toolGroupSummary([
        { id: "a", tool: "project_brand_new", label: "brand_new", status: "done" },
      ])
    ).toBe("brand_new");
  });

  it("编辑和命令折在同一张脸上", () => {
    expect(
      toolGroupSummary([
        { id: "a", tool: "project_patch", label: "写入源码", status: "done" },
        { id: "b", tool: "project_patch", label: "写入源码", status: "failed" },
        { id: "c", tool: "project_exec", label: "运行命令", status: "done" },
      ])
    ).toBe("编辑了 2 个文件 · 已运行 1 个命令");
  });

  it("技能行进组，脸上能读到技能名；旧的创建工程摘要还在", () => {
    const blocks = deriveSessionStory(
      turnOf([
        speech("s1", "先加载设计技能。"),
        chip("sk", "skill", "completed", "frontend-design"),
        chip("c1", "project_create", "completed"),
      ])
    );
    const tools = blocks.find(
      (block): block is Extract<typeof block, { kind: "tools" }> =>
        block.kind === "tools"
    );
    expect(tools?.rows.map(row => row.tool)).toEqual(["skill", "project_create"]);
    expect(tools?.rows[0]).toMatchObject({
      tool: "skill",
      label: "加载技能",
      detail: "frontend-design",
    });
    expect(tools?.summary).toContain("加载技能");
    expect(tools?.summary).toContain("创建工程");
    expect(timelineRowTitle(tools!.rows[0])).toBe("加载技能 frontend-design");
  });
});

describe("用时：完成轮才写，拿不到不编", () => {
  it("正向：完成轮有 durationMs → 工作了 2m 45s", () => {
    expect(sessionStoryDuration(turnOf([], { durationMs: 165_000 }))).toBe(
      "工作了 2m 45s"
    );
  });

  it("反向：还在跑的轮次即使带了用时也不出这行——人要看见过程", () => {
    expect(
      sessionStoryDuration(
        turnOf([], { status: "streaming", durationMs: 165_000 })
      )
    ).toBeNull();
  });

  it("反向：拿不到用时就是没有", () => {
    expect(sessionStoryDuration(turnOf([]))).toBeNull();
  });
});

describe("折叠策略：assistant-ui Reasoning / OpenHands EventGroup", () => {
  it("流式撑开，结束收起，人手点过就不再抢", () => {
    expect(disclosureOpen({ streaming: true, userOpen: null })).toBe(true);
    expect(disclosureOpen({ streaming: false, userOpen: null })).toBe(false);
    expect(disclosureOpen({ streaming: false, userOpen: true })).toBe(true);
    expect(disclosureOpen({ streaming: true, userOpen: false })).toBe(false);
    // 变异：写成 useState(!streaming) → 流停了 state 不重置，人手没点也会撑开。
    expect(
      disclosureOpen({ streaming: false, defaultOpen: true, userOpen: false })
    ).toBe(false);
  });

  it("进行中的组看当前动作 + 进度，收尾才写摘要", () => {
    const rows = [
      { id: "a", tool: "project_patch", label: "写入源码", status: "done" as const, detail: "src/Home.tsx" },
      { id: "b", tool: "project_patch", label: "写入源码", status: "running" as const, detail: "src/App.tsx" },
      { id: "c", tool: "project_exec", label: "运行命令", status: "done" as const },
    ];
    const live = toolGroupFace(rows, { finalized: false });
    expect(live.running).toBe(true);
    expect(live.title).toBe("写入源码 src/App.tsx");
    expect(live.meta).toBe("2/3");
    expect(live.title).not.toContain("编辑了");

    const done = toolGroupFace(
      rows.map(row => (row.status === "running" ? { ...row, status: "done" as const } : row)),
      { finalized: true }
    );
    expect(done.running).toBe(false);
    expect(done.title).toBe("编辑了 2 个文件 · 已运行 1 个命令");
    expect(latestToolRowTitle(rows)).toBe("写入源码 src/App.tsx");
  });

  it("进行中技能/命令/预览脸上是阶段，不是收尾摘要", () => {
    expect(
      liveStageTitle({
        id: "s",
        tool: "skill",
        label: "加载技能",
        status: "running",
        detail: "frontend-design",
      })
    ).toBe("正在加载技能 frontend-design");
    expect(
      liveStageTitle({
        id: "c",
        tool: "shell_exec",
        label: "运行命令",
        status: "running",
        detail: "pnpm run build",
      })
    ).toBe("正在运行命令");
    expect(
      liveStageTitle({
        id: "p",
        tool: "browser_navigate",
        label: "打开预览",
        status: "running",
      })
    ).toBe("正在打开预览");
    expect(toolFamily("skill")).toBe("skill");
    expect(toolFamily("make_manus_page")).toBe("preview");
    expect(toolFamily("write_file")).toBe("file");
    expect(timelineRowTitle({
      id: "p",
      tool: "make_manus_page",
      label: "展示页面",
      status: "done",
    })).toBe("预览页面");
    expect(isExpandableCommandRow({
      id: "c",
      tool: "shell_exec",
      label: "运行命令",
      status: "done",
      detail: "pnpm run build",
    })).toBe(true);
    expect(isExpandableCommandRow({
      id: "s",
      tool: "skill",
      label: "加载技能",
      status: "done",
      detail: "frontend-design",
    })).toBe(false);
    expect(
      toolGroupFace(
        [
          {
            id: "s",
            tool: "skill",
            label: "加载技能",
            status: "running",
            detail: "frontend-design",
          },
        ],
        { finalized: false }
      ).title
    ).toBe("正在加载技能 frontend-design");
  });
});

describe("开口长 token 必须折（2026-09-19 坦克横向滚动条）", () => {
  it("工程档章节面和六步档开口都写 overflow-wrap:anywhere，不能只留 pre-wrap", () => {
    const story = stripComments(
      readFileSync(resolve(__dirname, "../SessionStory.tsx"), "utf8")
    );
    expect(story).toMatch(/data-testid="session-story-timeline"/);
    expect(story).toMatch(/session-story-timeline-dot/);
    expect(story).toMatch(/variant="timeline"/);
    const slide = stripComments(
      readFileSync(resolve(__dirname, "../../SlideRule.tsx"), "utf8")
    );
    const speech = story.slice(
      story.indexOf('data-testid="sliderule-model-speech"'),
      story.indexOf('data-testid="session-story-product"')
    );
    expect(speech).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(speech).toMatch(/whitespace-pre-wrap/);
    // 反向：只留 pre-wrap，真机 pop-/todo_write{…} 无空格 token 照样顶栏。
    expect(speech).not.toMatch(/<p className="whitespace-pre-wrap">/);

    const blocks = slide.slice(
      slide.indexOf("function ModelSpeechBlocks"),
      slide.indexOf("function TurnPhaseTimeline")
    );
    expect(blocks).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(blocks).toMatch(/whitespace-pre-wrap/);
    expect(blocks).not.toMatch(/<p className="whitespace-pre-wrap">/);

    const surface = slide.slice(slide.indexOf("export function ClaudeChatSurface"));
    expect(surface).toMatch(/ThreadPrimitive\.Viewport/);
    expect(surface).toMatch(/overflow-x-hidden/);
  });
});

describe("通电：章节面挂在工程档两支上，而且不门 latestTurn（§1 / §3）", () => {
  it("SlideRule 工程档流式和完成都渲染 SessionStory，历史轮次不再被掐掉", () => {
    const src = stripComments(
      readFileSync(resolve(__dirname, "../../SlideRule.tsx"), "utf8")
    );
    const assistant = src.slice(
      src.indexOf("function ImAssistantMessage"),
      src.indexOf("export function ClaudeChatSurface")
    );
    expect(assistant.match(/<SessionStory[\s/>]/g) ?? []).toHaveLength(2);
    expect(assistant).not.toMatch(/showProjectChecklist/);
    expect(assistant).not.toMatch(/<ProjectTaskChecklist[\s/>]/);
    const streaming = assistant.slice(
      assistant.indexOf('turn.status === "streaming" ? ('),
      assistant.indexOf("data-testid=\"sliderule-assistant-text\"")
    );
    const complete = assistant.slice(
      assistant.indexOf("data-testid=\"sliderule-assistant-text\"")
    );
    expect(streaming).toMatch(/<SessionStory[\s/>]/);
    expect(complete).toMatch(/<SessionStory[\s/>]/);
    // 变异：把 latestTurn 门加回去，历史轮次过程又没了。
    const storyCalls = assistant.match(/<SessionStory[\s\S]*?\/>/g) ?? [];
    for (const call of storyCalls) {
      expect(call).not.toMatch(/latestTurnId/);
      expect(call).toMatch(/deliverableKind=\{deliverableKind\}/);
    }
  });
});
