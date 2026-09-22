/**
 * 续跑要**认标记，不认话**。
 *
 * ## 这条判据防的是什么（2026-09-13）
 *
 * `isContinuationTurn` 认的是机器排的那几句（「假设已确认」「续播上一轮
 * 推演」…）。自动续跑**没有用户文本**——scanner 把 run 从 waiting_continue
 * 翻回 queued，没人打过字。`isContinuationTurn("")` 第一行就 return false。
 *
 * 结果是折叠**静默失效**：不报错、不告警，左栏退回 turn-continuation 头注
 * 里记的那个「看起来像智障重来」——旧问答再演一遍。而自动续跑次数比当初
 * 那次多得多，症状只会更重。
 *
 * 所以服务端发 `control_continuation`，前端落成 `continuation_mark` step，
 * 认它。这份判据两头都钉：标记要认（正向）、老的认话路径不许坏（反向）、
 * 没标记也没话的普通轮不许被误判成续跑（反向）。
 */
import { describe, expect, it } from "vitest";
import {
  foldContinuationTurns,
  isContinuationTurn,
  turnHasContinuationMark,
  turnIsContinuation,
} from "../turn-continuation";
import { linesFromTurnSteps } from "../stage-authority";
import type { TurnStep, UiTurn } from "../types";

const MARK: TurnStep = {
  id: "c1",
  kind: "continuation_mark",
  attempt: 2,
  blockedReasons: ["project_verification_required"],
};

const CHIP: TurnStep = {
  id: "s1",
  kind: "chip",
  capabilityId: "project_patch" as never,
  roleId: "system",
  label: "正在写入工程源码",
  realLlm: false,
  progressType: "acting",
};

function turn(user: string, steps: TurnStep[] = []): UiTurn {
  return {
    id: `t-${user || "auto"}-${steps.length}`,
    user,
    status: "complete",
    steps,
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "",
    assistantSource: "llm",
    main: null,
    actions: [],
  };
}

describe("自动续跑没有用户文本，只能认标记", () => {
  it("正向：带标记的轮次算续跑，哪怕用户文本是空的", () => {
    const auto = turn("", [MARK, CHIP]);
    expect(turnHasContinuationMark(auto)).toBe(true);
    expect(turnIsContinuation(auto)).toBe(true);
  });

  it("反向：认话那条路在空文本上必然失败——这正是要加标记的原因", () => {
    // 这条不是在测 bug，是把「为什么必须有标记」钉在判据里：
    // 谁要是哪天想把标记去掉、退回认话，这条会提醒他空文本认不出来。
    expect(isContinuationTurn("")).toBe(false);
  });

  it("反向：既没标记也没续跑话术的普通轮，不许被当成续跑", () => {
    expect(turnIsContinuation(turn("再加一页统计", [CHIP]))).toBe(false);
    expect(turnHasContinuationMark(turn("再加一页统计", [CHIP]))).toBe(false);
  });

  it("反向：老的认话路径不许坏（伴随式澄清等仍要兜住）", () => {
    expect(turnIsContinuation(turn("假设已确认。继续画页面。"))).toBe(true);
    expect(turnIsContinuation(turn("（续播上一轮推演）"))).toBe(true);
  });

  it("反向：坏输入不许崩", () => {
    expect(turnHasContinuationMark(null)).toBe(false);
    expect(turnHasContinuationMark({ steps: "不是数组" })).toBe(false);
    expect(turnIsContinuation(undefined)).toBe(false);
  });
});

describe("折叠：自动续跑接在上一轮后面，不另起一块", () => {
  it("正向：带标记的续跑轮被折进前一轮，步骤接上", () => {
    const folded = foldContinuationTurns([
      turn("做一个工单系统", [CHIP]),
      turn("", [MARK, { ...CHIP, id: "s2", label: "正在执行工程命令" }]),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0].user).toBe("做一个工单系统");
    // 续跑那一轮的动作要接上来，不能丢
    expect(folded[0].steps.some(s => (s as { label?: string }).label === "正在执行工程命令"))
      .toBe(true);
  });

  it("反向：变异——不认标记时会裂成两轮（这正是「智障重来」的样子）", () => {
    // 把标记摘掉模拟「认话」的旧行为：两轮各自成块。
    const folded = foldContinuationTurns([
      turn("做一个工单系统", [CHIP]),
      turn("", [{ ...CHIP, id: "s2" }]),
    ]);
    expect(folded).toHaveLength(2);
  });
});

describe("标记不是一步动作", () => {
  it("反向：continuation_mark 不许进左栏活动列表", () => {
    // 它是这一轮的一个属性。进了列表就会多出一行没有意义的「步骤」。
    const lines = linesFromTurnSteps([MARK, CHIP]);
    expect(lines.map(l => l.text)).toEqual(["正在写入工程源码"]);
  });
});
