import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  driveReasoningSession,
  createDeterministicRouter,
  createDeterministicCapabilityExecutor,
  intakeMessage,
  getDefaultBudgetPolicy,
  recordCapabilityRunCost,
} from "../whybuddy-runtime";

describe("driveReasoningSession (Session_Driver, task 4.1/4.2)", () => {
  it("stops on convergence_signal when router returns empty + converged", async () => {
    const s = createInitialSessionState("测试目标", "sd-conv");
    const { preparedState } = intakeMessage(s, { turnId: "t1", userText: "分析" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "t1",
      userText: "分析",
      router: createDeterministicRouter([
        { selected: [], rationale: "done", source: "llm", converged: true },
      ]),
      executor: createDeterministicCapabilityExecutor(),
    });

    expect(result.stopReason).toBe("convergence_signal");
    expect(result.loops).toHaveLength(1);
    expect(result.loops[0].stopSignal).toBe("convergence_signal");
    expect(result.loops[0].loopTurnId).toBe("t1-loop-0");
  });

  it("stops with budget_exhausted after maxLoopsPerMessage", async () => {
    const router = createDeterministicRouter((_req, i) => ({
      selected: [{ capabilityId: "intent.clarify", roleId: "规划" }],
      rationale: `loop ${i}`,
      source: "heuristic_fallback",
    }));

    const s = createInitialSessionState("测试", "sd-budget");
    const { preparedState } = intakeMessage(s, { turnId: "t2", userText: "继续" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "t2",
      userText: "继续",
      router,
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 2,
    });

    expect(result.stopReason).toBe("budget_exhausted");
    expect(result.loops.length).toBe(2);
    expect(result.loops[1].stopSignal).toBe("budget_exhausted");
  });

  it("stops with max_repeat_guard when all selected capabilities hit repeat limit", async () => {
    const policy = getDefaultBudgetPolicy();
    const cap = "intent.clarify";
    let s = createInitialSessionState("重复守卫", "sd-repeat");
    const runs = Array.from({ length: policy.maxRepeatPerCapability }, (_, i) => ({
      id: `prior-run-${i}`,
      capabilityId: cap,
      turnId: "prior",
      inputs: [],
      outputs: [],
      gateResults: [],
    }));
    s = { ...s, capabilityRuns: runs as any };

    const { preparedState } = intakeMessage(s, { turnId: "t3", userText: "再来" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "t3",
      userText: "再来",
      router: createDeterministicRouter([
        { selected: [{ capabilityId: cap, roleId: "规划" }], rationale: "retry", source: "llm" },
      ]),
      executor: createDeterministicCapabilityExecutor(),
    });

    expect(result.stopReason).toBe("max_repeat_guard");
    expect(result.loops[0].stopSignal).toBe("max_repeat_guard");
    expect(result.loops[0].committedArtifactIds).toHaveLength(0);
  });

  it("records orchestrate.plan cost per loop when router returns usage (task 2.4 / Property 27)", async () => {
    const s = createInitialSessionState("成本归因", "sd-cost");
    const { preparedState } = intakeMessage(s, { turnId: "t4", userText: "规划" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "t4",
      userText: "规划",
      router: createDeterministicRouter([
        {
          selected: [{ capabilityId: "intent.clarify", roleId: "规划" }],
          rationale: "pick",
          source: "llm",
          usage: { totalTokens: 42, inputTokens: 30, outputTokens: 12, model: "test-router" },
        },
        { selected: [], rationale: "done", source: "llm", converged: true },
      ]),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 3,
    });

    const orchCosts = (result.finalState.costLedger || []).filter(
      (c) => c.capabilityId === "orchestrate.plan"
    );
    expect(orchCosts.length).toBeGreaterThanOrEqual(1);
    expect(orchCosts[0]?.estimatedTokens).toBe(42);
    expect(orchCosts[0]?.source).toBe("server");
  });
});

describe("orchestrate.plan cost attribution regression (task 2.4)", () => {
  it("Property 27: routing usage lands in orchestrate.plan bucket", () => {
    let s = createInitialSessionState("R1 cost", "r1-cost-27");
    const costed = recordCapabilityRunCost(
      s,
      {
        id: "r1-orch-plan",
        capabilityId: "orchestrate.plan" as any,
        turnId: "r1t3",
        inputs: [],
        outputs: [],
        gateResults: [],
      } as any,
      {
        source: "server",
        usage: { totalTokens: 88, inputTokens: 50, outputTokens: 38, model: "gpt-test" },
      }
    );
    const rec = (costed.costLedger || []).find((c) => c.capabilityId === "orchestrate.plan");
    expect(rec?.source).toBe("server");
    expect(rec?.estimatedTokens).toBe(88);
  });

  it("Property 28: routing and execution costs are separable by capabilityId bucket", () => {
    let s = createInitialSessionState("混合成本", "r1-cost-28");
    s = recordCapabilityRunCost(
      s,
      {
        id: "orch-1",
        capabilityId: "orchestrate.plan" as any,
        turnId: "t",
        inputs: [],
        outputs: [],
        gateResults: [],
      } as any,
      { source: "server", usage: { totalTokens: 100 } }
    );
    s = recordCapabilityRunCost(
      s,
      {
        id: "exec-1",
        capabilityId: "risk.analyze" as any,
        turnId: "t",
        inputs: [],
        outputs: [],
        gateResults: [],
      } as any,
      { tokens: 250, source: "estimated" }
    );

    const ledger = s.costLedger || [];
    const orchTotal = ledger
      .filter((c) => c.capabilityId === "orchestrate.plan")
      .reduce((sum, c) => sum + (c.estimatedTokens || 0), 0);
    const execTotal = ledger
      .filter((c) => c.capabilityId !== "orchestrate.plan")
      .reduce((sum, c) => sum + (c.estimatedTokens || 0), 0);
    const grandTotal = ledger.reduce((sum, c) => sum + (c.estimatedTokens || 0), 0);

    expect(orchTotal).toBe(100);
    expect(execTotal).toBe(250);
    expect(orchTotal + execTotal).toBe(grandTotal);
    expect(ledger.some((c) => c.capabilityId === "orchestrate.plan")).toBe(true);
    expect(ledger.some((c) => c.capabilityId === "risk.analyze")).toBe(true);
  });
});