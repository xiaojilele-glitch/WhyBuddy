/**
 * 已经结束的轮次不许一片空白。
 *
 * ## 2026-09-13：`SlideRule.unified-surface` 的「reload restores」长期红着
 *
 * 现象是刷新回来只看见自己那句话，下面什么都没有。成因是
 * `assistantTextForTurn` 里一个**没有注释的提前 return ""**，把函数末尾
 * 那句诚实兜底整个挡死了。
 *
 * 而这条判据之所以长期没人管，是因为 `pnpm run check` 整体红着 → CI 第一步
 * 就挂 → 后面的步骤全被 skip。一条长期红着的判据等于没有判据。
 *
 * ## 分界在「这一轮结束没有」，不在「有没有产出」
 *
 *   · streaming 且没产出 → 留白是对的，别抢在结果前面说话
 *   · complete 且没产出 → 留白就是把东西弄丢了
 *
 * 两个方向各一条，删掉任一半都要变红。
 */
import { describe, expect, it } from "vitest";
import { assistantTextForTurn } from "../assistant-text-for-turn";
import type { UiTurn } from "../types";

function bareTurn(status: UiTurn["status"]): UiTurn {
  // 「什么都没有」的原样形状：没有 assistant、没有叙述步骤、没有工厂动作、
  // 没有 publishClosure。恢复轮从 capabilityRuns 重建出来就是这个样子。
  return {
    id: "turn-restored",
    user: "做一个采购审批应用",
    status,
    steps: [],
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "",
    assistantSource: "llm",
    main: null,
    actions: [],
  };
}

describe("空轮次说什么", () => {
  it("反向：直播中还没产出 → 留白，不许抢在结果前面说话", () => {
    expect(assistantTextForTurn(bareTurn("streaming"), null, "做一个采购审批应用")).toBe(
      ""
    );
  });

  it("正向：已经结束还空着 → 必须如实说一句，不许留白", () => {
    const text = assistantTextForTurn(
      bareTurn("complete"),
      null,
      "做一个采购审批应用"
    );
    expect(text).not.toBe("");
    // 盯语义不盯字面：它得承认「这一轮完了」并且「没有可展示的回答」，
    // 而不是编一个总结出来（本仓栽过：套用别轮的 chatSummary）。
    expect(text).toContain("已完成");
    expect(text).toContain("没有");
  });

  it("反向：问候没有 goal，照旧留白——它本来就没有交付物", () => {
    // 2026-09-08 真机栽过：「你好」被收成「本轮没有画出新的页面」。
    // 放行的口子只给「已结束的目标轮」，不许顺手把问候也带出去。
    const greeting = { ...bareTurn("complete"), user: "你好" };
    expect(assistantTextForTurn(greeting, null, "")).toBe("");
  });

  it("反向：追问轮（user !== goal）也留白，不走这条兜底", () => {
    const followUp = { ...bareTurn("complete"), user: "再加一页统计" };
    expect(
      assistantTextForTurn(followUp, null, "做一个采购审批应用")
    ).not.toContain("本轮已完成");
  });

  it("反向：真有回答时原样返回，兜底不许盖掉它", () => {
    const turn = { ...bareTurn("complete"), assistant: "我已经画好三页。" };
    expect(assistantTextForTurn(turn, null, "做一个采购审批应用")).toBe(
      "我已经画好三页。"
    );
  });
});
