/**
 * 左栏活动列表必须接在通电的那条链上。
 * 只测 parseActivityLine 会假绿：TurnPhaseTimeline 仍 dump 原文日志，
 * 真机还是无规则。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("activity list live-path wiring", () => {
  it("TurnPhaseTimeline 走 ActivityList，不走 ChainOfThought / Brain", () => {
    const src = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    expect(src).toContain("ActivityList");
    expect(src).toContain("deriveStageBands");
    expect(src).not.toContain("groupsFromPhases");
    expect(src).not.toContain("ChainOfThought");
    expect(src).not.toContain("BrainIcon");
    expect(src).not.toContain("phaseCount:");
  });

  it("LlmLiveOutput 摘要行走同一套 ActivityToggleRow，不写「· N 字符」", () => {
    const src = stripComments(
      readFileSync(new URL("../LlmLiveOutput.tsx", import.meta.url), "utf8")
    );
    expect(src).toContain("ActivityToggleRow");
    expect(src).toContain("formatCharMeta");
    expect(src).not.toContain("字符");
    expect(src).not.toContain("animate-pulse");
  });
});
