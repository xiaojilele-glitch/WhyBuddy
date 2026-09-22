/**
 * 模型动手之前的开口要走正文段落，**而且不许同时进左栏活动列表**。
 *
 * ## 为什么有这条（2026-09-13，用户对照 Manus 截图：「页面没跟上」）
 *
 * 差的不是能力是呈现。Manus 每组动作前面是一段第一人称散文：
 *
 *     「我会采用浅蓝工作台 + 白色卡片 + 橙色优先级作为视觉方向，
 *       接着初始化项目并把核心页面做成可交互的单页客服工作台。」
 *
 * 我们这边同一时刻左栏只有「第 1 轮 · 正在执行 planning」。而那段话模型
 * **本来就在产**——`rehearsal_control` 每轮拿到的 `content` 一直有，只是
 * 原来只在「还没定产品主题 **且** 这批工具里有 ask_user_question」时才
 * `yield control_text`，工程模式两个条件都不成立，于是一个字都没到界面。
 *
 * ## 这条判据盯的是**反向**那一半（CLAUDE.md §3）
 *
 * 「能渲染成段落」是正向判据，光有它不够——本仓数到第十次以上的失败形态
 * 就是正向齐全、反向缺失。这里真正要钉死的是：
 *
 *     model_speech **不许**被 `linesFromTurnSteps` 收进活动列表。
 *
 * 因为最省事的实现是复用 `narration`，那样两处都会画，模型散文就变成跟
 * 「指令已接收 · 启动推理」同等分量的一行——正是要修的那个观感，而且
 * 「段落出现了」的正向判据照样绿。
 *
 * ⚠ 判据直接跑产线的 `linesFromTurnSteps`，不重抄一份分类逻辑：重抄的
 *   判据只能证明「我抄对了」（§1.2）。
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { linesFromTurnSteps } from "../stage-authority";
import { finalNarrationStep } from "../turn-route-steps";
import {
  answerAlreadySpoken,
  dedupeAdjacentSpeech,
  isUserFacingSpeech,
  modelSpeechFor,
  renderableModelSpeech,
} from "../model-speech";
import type { TurnStep, UiTurn } from "../types";

/** 真机那一发的形状：模型先开口，然后这一轮的工具芯片跟上。 */
const SPEECH =
  "我会采用「浅蓝工作台 + 白色卡片 + 橙色优先级」作为视觉方向，接着初始化项目并把核心页面做成可交互的单页客服工作台。";

function turnWith(steps: TurnStep[]): UiTurn {
  return {
    id: "t1",
    user: "构建一个名为 TicketStream 的服务台 SaaS 界面",
    status: "streaming",
    steps,
    routeFacts: { turnId: "t1", timestamp: "2026-09-13T00:00:00.000Z" },
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "",
    assistantSource: "llm",
    main: null,
    actions: [],
  } as unknown as UiTurn;
}

const speechStep: TurnStep = {
  id: "t1-speech-1",
  kind: "model_speech",
  text: SPEECH,
};

const chipStep: TurnStep = {
  id: "t1-stream-2",
  kind: "chip",
  capabilityId: "intent.parse" as never,
  roleId: "system",
  label: "正在创建工程",
  realLlm: false,
  progressType: "acting",
};

describe("模型开口 = 正文段落", () => {
  it("正向：model_speech 会被正文取出来渲染", () => {
    const speech = renderableModelSpeech(turnWith([speechStep, chipStep]));
    expect(speech.map(s => s.text)).toEqual([SPEECH]);
  });

  it("反向：同一条 model_speech **不许**再进左栏活动列表（否则就是双渲染）", () => {
    // 跑产线源码，不重抄分类逻辑。
    const lines = linesFromTurnSteps([speechStep, chipStep]);
    expect(lines.map(l => l.text)).toEqual(["正在创建工程"]);
    // 把变异写清楚：改成 narration 复用，这条立刻红。
    const asNarration: TurnStep = {
      id: "t1-speech-1",
      kind: "narration",
      text: SPEECH,
      source: "llm",
    };
    expect(linesFromTurnSteps([asNarration, chipStep]).map(l => l.text)).toContain(
      SPEECH
    );
  });

  it("反向：开口不参与收尾文字（finalNarrationStep 只认 isFinal 的 narration）", () => {
    expect(finalNarrationStep([speechStep, chipStep])).toBeNull();
  });
});

describe("完成轮收尾不许再印已经画过的开口", () => {
  // 2026-09-16 真机：规划那句、写计划那句各印两遍。问卷卡没叠，所以不是
  // 模型连说两次——是 control_text 进 steps 又进 assistant。
  const live =
    "I'll start by planning this build — but first, a couple of decisions I need from you so I don't guess wrong on scope and stack.";

  it("收尾跟开口逐字相同 → 已经说过", () => {
    const turn = turnWith([{ id: "s1", kind: "model_speech", text: live }]);
    expect(answerAlreadySpoken(live, turn)).toBe(true);
    expect(answerAlreadySpoken(`  ${live}  `, turn)).toBe(true);
  });

  it("反向：收尾是另一句 → 要印", () => {
    const turn = turnWith([{ id: "s1", kind: "model_speech", text: live }]);
    expect(answerAlreadySpoken("I'll write up the plan first, then build it.", turn)).toBe(
      false
    );
  });

  it("两段开口按顺序拼起来等于收尾 → 也算说过", () => {
    const turn = turnWith([
      { id: "s1", kind: "model_speech", text: "先问清范围。" },
      { id: "s2", kind: "model_speech", text: "再写计划。" },
    ]);
    expect(answerAlreadySpoken("先问清范围。\n\n再写计划。", turn)).toBe(true);
    expect(answerAlreadySpoken("再写计划。", turn)).toBe(true);
    expect(answerAlreadySpoken("先问清范围。然后开工。", turn)).toBe(false);
  });
});

describe("什么算一次对用户的开口", () => {
  it("空白、纯标点不算", () => {
    expect(isUserFacingSpeech("")).toBe(false);
    expect(isUserFacingSpeech("   ")).toBe(false);
    expect(isUserFacingSpeech("……")).toBe(false);
    expect(isUserFacingSpeech("—")).toBe(false);
  });

  it("模型复述控制面命令不算——用的是消费侧那份 OPERATOR_SPEAK，不另抄一份", () => {
    expect(isUserFacingSpeech("下一跳请调 pages")).toBe(false);
    expect(isUserFacingSpeech("告诉用户为什么先停")).toBe(false);
  });

  it("规划独白不算开口——2026-09-14 真机 RBAC 左栏整段英文 write_plan 自言自语", () => {
    // 真机 sr-20260914171745-3PCJ39MFGV 派 write_plan 之前的 content。
    // 变异：OPERATOR_SPEAK 改回只认「下一跳请调 pages」→ 本条红。
    const live =
      "I'm currently in \"planning\" mode and I need to call write_plan now " +
      "to flesh out a high-quality, structured plan for this RBAC system.";
    expect(isUserFacingSpeech(live)).toBe(false);
    expect(
      isUserFacingSpeech("Okay, I'm currently in planning mode and will outline the goals.")
    ).toBe(false);
  });

  it("正常开口算", () => {
    expect(isUserFacingSpeech(SPEECH)).toBe(true);
  });

  it("英文开口也算——2026-09-16 文种过滤弊大于利", () => {
    // 真机 sr-20260915165800-M6JK4H3XFB 派工具前的 content。次日
    // sr-20260916002025-Y3ZS3DZASB 同一形状被文种闸滤空，左栏只剩
    // 「工作了 4m 40s」。变异：把 speechMismatchesUserLanguage 加回去
    // → 本条红。
    const user =
      "构建一个名为“TicketStream”的服务台 SaaS 界面。目的：管理支持工单、实时聊天和知识库。";
    const live =
      '**Initial Assessment and Planning for "TicketStream" SaaS Interface**\n\n' +
      'Okay, so the task is clear: build a "TicketStream" service desk SaaS interface. ' +
      "My immediate focus is understanding the requirements.\n\n" +
      "Here's my take on the process, playing the role of the thinking entity:\n\n" +
      "**My Approach to Designing TicketStream**";
    expect(isUserFacingSpeech(live, user)).toBe(true);
    expect(
      modelSpeechFor(
        turnWith([{ id: "s-en", kind: "model_speech", text: live }])
      ).map(item => item.text)
    ).toEqual([live]);
    expect(isUserFacingSpeech("我先把 TicketStream 工程搭起来。", user)).toBe(
      true
    );
    const src = readFileSync(
      new URL("../model-speech.ts", import.meta.url),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).not.toContain("speechMismatchesUserLanguage");
  });

  it("过滤掉的开口不会混进正文", () => {
    const dropped: TurnStep = {
      id: "t1-speech-9",
      kind: "model_speech",
      text: "下一跳请调 pages",
    };
    expect(modelSpeechFor(turnWith([dropped]))).toEqual([]);
  });
});

describe("相邻重复合成一条，但不做通用去重", () => {
  it("逐字相同且相邻 → 合成一条", () => {
    const a: TurnStep = { id: "s1", kind: "model_speech", text: "继续修正类型错误。" };
    const b: TurnStep = { id: "s2", kind: "model_speech", text: "继续修正类型错误。" };
    expect(dedupeAdjacentSpeech(modelSpeechFor(turnWith([a, b])))).toHaveLength(1);
  });

  it("反向：隔开出现的同一句要留着——它可能真的是两次修正（对照 turn-continuation 的同源纪律）", () => {
    const a: TurnStep = { id: "s1", kind: "model_speech", text: "继续修正类型错误。" };
    const mid: TurnStep = { id: "s2", kind: "model_speech", text: "构建通过了。" };
    const b: TurnStep = { id: "s3", kind: "model_speech", text: "继续修正类型错误。" };
    expect(
      dedupeAdjacentSpeech(modelSpeechFor(turnWith([a, mid, b])))
    ).toHaveLength(3);
  });
});
