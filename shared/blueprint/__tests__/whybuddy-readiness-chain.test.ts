import { describe, it, expect } from "vitest";
import type { V5SessionState } from "../v5-reasoning-state.js";
import {
  needsReadinessChain,
  pickReadinessChainCapabilities,
  gapsFromGapAskContent,
  extractBlockingQuestions,
} from "../whybuddy-readiness-chain.js";
import { pickNextCapabilities } from "../whybuddy-pick-heuristic.js";

function stub(goalText: string): V5SessionState {
  return {
    goal: { text: goalText, status: "needs_refinement" },
    graph: { id: "g", jobId: "j", stage: "effect_preview", nodes: [], edges: [] },
    artifacts: [],
    conversation: [],
    openQuestions: [],
    evidence: [],
    decisions: [],
    risks: [],
    capabilityRuns: [],
    gates: [],
    dependencyGraph: [],
    staleArtifactIds: [],
    sessionId: "rc-test",
  };
}

describe("whybuddy-readiness-chain (P0 / S11)", () => {
  it("needsReadinessChain for vague goal", () => {
    expect(needsReadinessChain(stub("做一个系统"), "做一个系统")).toBe(true);
  });

  it("pickReadinessChainCapabilities orders gap.ask before question.expand", () => {
    const picks = pickReadinessChainCapabilities(stub("做一个系统"));
    expect(picks.map((p) => p.capabilityId)).toEqual(["gap.ask", "question.expand"]);
  });

  it("pickNextCapabilities routes vague cold start to readiness chain", () => {
    const picks = pickNextCapabilities(stub("做一个系统"), "做一个系统");
    expect(picks[0]?.capabilityId).toBe("gap.ask");
    expect(picks.some((p) => p.capabilityId === "question.expand")).toBe(true);
  });

  it("extractBlockingQuestions parses bullet questions", () => {
    const qs = extractBlockingQuestions(
      "【阻塞缺口】\n- 面向谁使用？\n- 成功标准是什么？"
    );
    expect(qs.length).toBeGreaterThanOrEqual(2);
  });

  it("gapsFromGapAskContent creates open_question gaps", () => {
    const gaps = gapsFromGapAskContent(
      "- 面向谁？\n- 范围边界？",
      "t1",
      "art-1"
    );
    expect(gaps.every((g) => g.kind === "open_question")).toBe(true);
    expect(gaps.every((g) => g.status === "open")).toBe(true);
  });
});