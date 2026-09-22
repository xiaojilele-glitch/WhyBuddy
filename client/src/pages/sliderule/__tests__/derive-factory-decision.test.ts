import { describe, expect, it } from "vitest";
import { createInitialSessionState } from "@/lib/sliderule-runtime";
import {
  deriveFactoryDecisionView,
  labelDecisionItems,
  labelFactoryTools,
} from "../derive-factory-decision";
import { deriveStatusBarFacts } from "../derive-status-bar";

describe("deriveFactoryDecisionView", () => {
  it("没有账本就不发明一条", () => {
    const state = createInitialSessionState("x", "sr-empty-ledger");
    expect(deriveFactoryDecisionView(state)).toBeNull();
    const facts = deriveStatusBarFacts(state, { turnCount: 0, isRunning: false });
    expect(facts.factoryDecision).toBeNull();
  });

  it("读到模型理由原文，规则给的和这一跳分开", () => {
    const state = createInitialSessionState("x", "sr-llm-pick");
    state.decisionLedger = [
      {
        id: "dec-0-agentic-pick",
        turnId: "loop-0",
        saw: ["factory.pages", "factory.structure", "factory.bind"],
        chose: ["pages"],
        skipped: [],
        addresses: [],
        rationale: "用户指令明确为继续生成页面，跳过数据结构与权限绑定",
        alternativesRejected: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        source: "llm",
      },
    ];
    const view = deriveFactoryDecisionView(state);
    expect(view).not.toBeNull();
    expect(view!.degraded).toBe(false);
    expect(view!.source).toBe("llm");
    expect(view!.rationale).toContain("继续生成页面");
    expect(view!.saw).toEqual(["页面生成", "数据结构", "权限工作流"]);
    expect(view!.chose).toEqual(["页面生成"]);
    expect(view!.loopIndex).toBe(1);
  });

  it("回落规则版必须标成降级，不许装成模型挑的", () => {
    const state = createInitialSessionState("x", "sr-fallback");
    state.decisionLedger = [
      {
        id: "dec-0-agentic-pick-fallback",
        turnId: "loop-0",
        saw: ["pages", "structure", "bind"],
        chose: ["pages", "structure", "bind"],
        skipped: [],
        addresses: [],
        rationale: "第 0 轮 LLM 选材未成，回落规则版选能力",
        alternativesRejected: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        source: "heuristic_fallback",
      },
    ];
    const view = deriveFactoryDecisionView(state);
    expect(view!.degraded).toBe(true);
    expect(view!.source).toBe("heuristic_fallback");
    expect(view!.rationale).toContain("回落规则版");
  });

  it("runConditions 有 AgenticPickFallback 也要标降级", () => {
    const state = createInitialSessionState("x", "sr-cond");
    state.decisionLedger = [
      {
        id: "dec-0-agentic-pick",
        turnId: "loop-0",
        saw: ["pages"],
        chose: ["pages"],
        skipped: [],
        addresses: [],
        rationale: "先出页面",
        alternativesRejected: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        source: "llm",
      },
    ];
    state.runConditions = [
      { type: "Degraded", status: "True", reason: "AgenticPickFallback" },
    ];
    const view = deriveFactoryDecisionView(state);
    expect(view!.degraded).toBe(true);
  });

  it("max_repeat_guard 那种空 chose 空理由不算工厂选材", () => {
    const state = createInitialSessionState("x", "sr-guard");
    state.decisionLedger = [
      {
        id: "dec-0-max_repeat_guard",
        turnId: "loop-0",
        saw: ["factory.pages"],
        chose: [],
        skipped: [{ capabilityId: "factory.pages", reason: "max_repeat_guard" }],
        addresses: [],
        rationale: "",
        alternativesRejected: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        source: "local_heuristic",
      },
    ];
    expect(deriveFactoryDecisionView(state)).toBeNull();
  });
});

describe("labelFactoryTools", () => {
  it("公开工具名和 factory. 前缀都能认", () => {
    expect(labelFactoryTools(["factory.bind", "pages"])).toEqual([
      "权限工作流",
      "页面生成",
    ]);
  });
});

describe("「规则给的」不许因为不是工厂工具就整行消失（2026-09-04 真机）", () => {
  // 真机 saw 原样：点火那一跳规则给的是作文能力，不是工厂工具。
  const REAL_SAW = [
    "evidence.search",
    "risk.analyze",
    "critique.generate",
    "report.write",
    "appbundle.runtimeClosure",
  ];

  it("作文能力 id 原样透出，不被滤空", () => {
    const out = labelDecisionItems(REAL_SAW);
    expect(out.length).toBe(REAL_SAW.length);
    expect(out).toContain("evidence.search");
    expect(out).toContain("risk.analyze");
  });

  it("工厂工具仍然翻成人话", () => {
    const out = labelDecisionItems(["factory.pages", "structure"]);
    expect(out).toContain("页面生成");
    expect(out).toContain("数据结构");
    expect(out).not.toContain("factory.pages");
  });

  it("混着来时两种都在，且去重", () => {
    const out = labelDecisionItems([
      "evidence.search",
      "factory.pages",
      "pages",
      "evidence.search",
    ]);
    expect(out).toEqual(["evidence.search", "页面生成"]);
  });

  it("空串丢掉，不许渲染出空条目", () => {
    expect(labelDecisionItems(["", "  ", "pages"])).toEqual(["页面生成"]);
  });

  it("⚠ 反向：labelFactoryTools 仍然只认工厂工具（chose 那一侧没被顺手改掉）", () => {
    expect(labelFactoryTools(REAL_SAW)).toEqual([]);
  });

  it("整条决策视图里 saw 不再是空数组", () => {
    const view = deriveFactoryDecisionView({
      decisionLedger: [
        {
          id: "dec-0-agentic-pick",
          turnId: "loop-0",
          saw: REAL_SAW,
          chose: ["spec", "pages", "structure", "bind"],
          rationale: "按序执行规格起草、页面生成、数据建模与权限流转打孔",
          source: "llm",
        },
      ],
    } as never);
    expect(view).not.toBeNull();
    expect(view!.saw.length).toBeGreaterThan(0);
    expect(view!.chose).toContain("起草 SPEC");
  });
});
