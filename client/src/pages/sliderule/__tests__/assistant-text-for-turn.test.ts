/**
 * 对话气泡：精修轮不许套首轮「含 2 角色、3 页面」。
 *
 * 2026-08-18 篮球馆：四轮 iterate 都是空 steps + 空 assistant，
 * assistantTextForTurn 却把 publishClosure.chatSummary 复读一遍。
 * 判据看页，不看产物个数。删掉 follow-up 那道闸，下面必红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assistantTextForTurn,
  HOP_NO_PRODUCE_NOTE,
  REFINE_TURN_NO_PAGE_NOTE,
} from "../assistant-text-for-turn";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import type { UiTurn } from "../types";

const GOAL = "社区篮球馆半场预约与会员积分";
const FIRST_SUMMARY = "预留半场、记录到场。含 2 角色、3 页面。";

const closure = (
  over: Partial<PublishClosureSummary> = {}
): PublishClosureSummary => ({
  blocked: false,
  blockerCount: 0,
  evidencePresentCount: 6,
  skillCount: 6,
  versionPinsChecked: true,
  chatSummary: FIRST_SUMMARY,
  tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
  topBlockers: [],
  ...over,
});

const turn = (over: Partial<UiTurn> = {}): UiTurn => ({
  id: "t2",
  user: "预约台超时未到的场次给红标",
  status: "complete",
  steps: [],
  routeFacts: { turnId: "t2" },
  routeExpanded: false,
  routeLitCount: 0,
  assistant: "",
  assistantSource: "fallback",
  main: null,
  actions: [],
  ...over,
});

describe("assistantTextForTurn", () => {
  it("首轮可以用 chatSummary（含 2 角色、3 页面）", () => {
    const text = assistantTextForTurn(
      turn({ user: GOAL }),
      closure(),
      GOAL
    );
    expect(text).toBe(FIRST_SUMMARY);
  });

  it("精修空轮不许套首轮 chatSummary", () => {
    const text = assistantTextForTurn(
      turn({
        steps: [
          {
            id: "c1",
            kind: "chip",
            capabilityId: "intent.parse" as any,
            roleId: "system",
            label: "逐页画界面（并发）",
            realLlm: false,
          },
        ],
      }),
      closure(),
      GOAL
    );
    expect(text).not.toContain("含 2 角色");
    expect(text).not.toContain("3 页面");
    expect(text).not.toBe(FIRST_SUMMARY);
    expect(text).toBe(REFINE_TURN_NO_PAGE_NOTE);
  });

  it("问候空轮不许套「没画出新的页面」——goal 后来被芯片改了也不许", () => {
    const text = assistantTextForTurn(
      turn({ user: "你好", assistant: "", steps: [] }),
      closure(),
      "开始设计新应用"
    );
    expect(text).not.toBe(REFINE_TURN_NO_PAGE_NOTE);
    expect(text).not.toContain("含 2 角色");
    expect(text).toBe("");
  });

  it("问候收尾不许写「本轮已完成，但还没有生成可展示的回答」", () => {
    const text = assistantTextForTurn(
      turn({ user: "你好", assistant: "", steps: [] }),
      null,
      ""
    );
    expect(text).toBe("");
    expect(text).not.toContain("本轮已完成");
  });

  it("英文开口也当收尾——2026-09-16 文种过滤弊大于利", () => {
    const live =
      '**Initial Assessment and Planning for "TicketStream" SaaS Interface**\n\n' +
      "Okay, so the task is clear: build a TicketStream service desk SaaS interface.";
    const text = assistantTextForTurn(
      turn({
        user: "构建一个名为 TicketStream 的服务台 SaaS 界面",
        assistant: live,
      }),
      null,
      "构建一个名为 TicketStream 的服务台 SaaS 界面",
      { runtimeKind: "project" }
    );
    expect(text).toBe(live);
    expect(text).toContain("Initial Assessment");
  });

  it("模型命令不许当对用户的收尾", () => {
    const text = assistantTextForTurn(
      turn({
        user: "开始设计新应用",
        assistant: "SPEC 已经起草。下一跳请调 pages，或告诉用户为什么先停。",
      }),
      closure(),
      "开始设计新应用"
    );
    expect(text).not.toContain("请调 pages");
    expect(text).not.toContain("告诉用户为什么先停");
  });

  it("Structure / bind 跳不许把「没画出页面」改写成已完成", () => {
    const structure = assistantTextForTurn(
      turn({ user: "进入数据模型反推（Structure）" }),
      closure(),
      GOAL
    );
    expect(structure).toBe(HOP_NO_PRODUCE_NOTE);
    expect(structure).not.toContain("已完成");
    const stamped = assistantTextForTurn(
      turn({
        user: "进入数据模型反推（structure）",
        steps: [
          {
            id: "n1",
            kind: "narration",
            text: REFINE_TURN_NO_PAGE_NOTE,
            source: "fallback",
            isFinal: true,
          },
        ],
      }),
      closure(),
      GOAL
    );
    expect(stamped).toBe(REFINE_TURN_NO_PAGE_NOTE);
    expect(stamped).not.toContain("已完成");
    const produced = assistantTextForTurn(
      turn({
        user: "进入数据模型反推（Structure）",
        assistant: "本轮已完成数据模型反推。",
      }),
      closure(),
      GOAL
    );
    expect(produced).toBe("本轮已完成数据模型反推。");
  });

  it("零产出的 hop 原文提到名字也不许叙述成已完成", () => {
    const text = assistantTextForTurn(
      turn({ user: "进入权限绑定（bind）" }),
      closure(),
      GOAL
    );
    expect(text).not.toContain("已完成");
    expect(text).toBe(HOP_NO_PRODUCE_NOTE);
  });

  it("精修失败优先用 refinePaintNote", () => {
    const text = assistantTextForTurn(
      turn(),
      closure({ refinePaintNote: "这一处没画上：结构闸说臆造字段" }),
      GOAL
    );
    expect(text).toBe("这一处没画上：结构闸说臆造字段");
    expect(text).not.toContain("含 2 角色");
  });

  it("反向：skillCount 缺省不许冒充 6", () => {
    const src = readFileSync(
      new URL("../assistant-text-for-turn.ts", import.meta.url),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).toContain("skillCount ?? 0");
    expect(src).not.toContain("skillCount ?? 6");
    // 2026-09-16：文种闸已拿掉。加回去左栏又会空。
    expect(src).not.toContain("speechMismatchesUserLanguage");
    expect(src).not.toContain("speechIsLatin");
  });

  it("本轮有叙述就用叙述，不套总结", () => {
    const text = assistantTextForTurn(
      turn({
        steps: [
          {
            id: "n1",
            kind: "narration",
            text: "预约台已经加上超时红标。",
            source: "llm",
            isFinal: true,
          },
        ],
      }),
      closure(),
      GOAL
    );
    expect(text).toBe("预约台已经加上超时红标。");
  });

  it("工程档空轮不许说没画出页面", () => {
    const text = assistantTextForTurn(
      turn({ user: GOAL, assistant: "", steps: [] }),
      closure(),
      GOAL,
      { runtimeKind: "project" }
    );
    expect(text).not.toBe(REFINE_TURN_NO_PAGE_NOTE);
    expect(text).not.toContain("页面");
    expect(text).toBe("");
  });

  it("工程档有开口仍用开口", () => {
    const text = assistantTextForTurn(
      turn({ assistant: "工程目录已经建好。" }),
      closure(),
      GOAL,
      { runtimeKind: "project" }
    );
    expect(text).toBe("工程目录已经建好。");
  });

  it("本轮有 assistant 就用 assistant", () => {
    const text = assistantTextForTurn(
      turn({ assistant: "红标已经画上。" }),
      closure(),
      GOAL
    );
    expect(text).toBe("红标已经画上。");
  });

  it("SlideRule 用抽出来的那份，页内不再写一份", () => {
    const src = readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8");
    expect(src).toContain('from "./sliderule/assistant-text-for-turn"');
    expect(src).not.toMatch(/function assistantTextForTurn/);
  });
});
