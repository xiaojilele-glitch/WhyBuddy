import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  driveReasoningSession,
  createDeterministicRouter,
  createDeterministicCapabilityExecutor,
  pickNextCapabilities,
  intakeMessage,
  getDefaultBudgetPolicy,
  recordCapabilityRunCost,
  commitArtifact,
} from "../whybuddy-runtime";
import {
  COMPLEX_GOAL_TEXT,
  createRawArtifact,
  commitTrusted,
} from "../whybuddy-fullpath-fixtures";

describe("driveReasoningSession (Session_Driver, task 4.1/4.2)", () => {
  it("picker routes vague goal to gap.ask before risk (S11 scheduling)", () => {
    const s = createInitialSessionState("做一个系统", "sd-pick-s11");
    const picks = pickNextCapabilities(s, "做一个系统");
    expect(picks[0]?.capabilityId).toBe("gap.ask");
    expect(picks.some((p) => p.capabilityId === "question.expand")).toBe(true);
    expect(picks.some((p) => p.capabilityId === "report.write")).toBe(false);
  });

  it("parks await_ready after intent.clarify when goal is vague (S11 / G_READY)", async () => {
    const s = createInitialSessionState("做一个系统", "sd-gready-clarify");
    const { preparedState } = intakeMessage(s, { turnId: "grc0", userText: "做一个系统" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "grc0",
      userText: "做一个系统",
      router: createDeterministicRouter([
        {
          selected: [{ capabilityId: "intent.clarify", roleId: "产品" }],
          rationale: "clarify vague goal",
          source: "llm",
        },
      ]),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 1,
    });

    expect(result.stopReason).toBe("await_ready");
    expect(result.finalState.awaitReason).toBe("ready");
    expect(result.finalState.runtimePhase).toBe("awaiting");
    expect(result.loops[0]?.committedArtifactIds.length).toBeGreaterThanOrEqual(1);
  });

  it("parks await_ready after question.expand when goal is vague (S11 / G_READY)", async () => {
    const s = createInitialSessionState("做一个系统", "sd-gready");
    const { preparedState } = intakeMessage(s, { turnId: "gr0", userText: "做一个系统" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "gr0",
      userText: "做一个系统",
      router: createDeterministicRouter([
        {
          selected: [{ capabilityId: "question.expand", roleId: "规划" }],
          rationale: "expand vague goal",
          source: "llm",
        },
      ]),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 1,
    });

    expect(result.stopReason).toBe("await_ready");
    expect(result.finalState.awaitReason).toBe("ready");
    expect(result.finalState.runtimePhase).toBe("awaiting");
    expect(result.loops[0]?.committedArtifactIds.length).toBeGreaterThanOrEqual(1);
  });

  it("parks await_confirm after route.compare until user selects a branch", async () => {
    const s = createInitialSessionState("路线对比一下", "sd-gconfirm");
    const { preparedState } = intakeMessage(s, { turnId: "gc0", userText: "路线对比一下" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "gc0",
      userText: "路线对比一下",
      router: createDeterministicRouter([
        {
          selected: [
            { capabilityId: "route.generate", roleId: "架构" },
            { capabilityId: "route.compare", roleId: "工程" },
          ],
          rationale: "compare routes",
          source: "llm",
        },
      ]),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 1,
    });

    expect(result.stopReason).toBe("await_confirm");
    expect(result.finalState.awaitReason).toBe("confirm");
    expect(result.finalState.runtimePhase).toBe("awaiting");
  });

  it("does not bypass G_COVERAGE on raw convergence_signal from router", async () => {
    const s = createInitialSessionState("测试目标", "sd-conv");
    const { preparedState } = intakeMessage(s, { turnId: "t1", userText: "分析" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "t1",
      userText: "分析",
      router: createDeterministicRouter([
        { selected: [], rationale: "done", source: "llm", converged: true },
      ]),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 1,
    });

    expect(result.finalState.coverageContract).toBeDefined();
    expect(result.finalState.coverageGate?.passed).toBe(false);
    expect(result.stopReason).not.toBe("convergence_signal");
    expect(result.loops[0].loopTurnId).toBe("t1-loop-0");
  });

  it("stops with budget_exhausted after maxLoopsPerMessage", async () => {
    const router = createDeterministicRouter((_req, i) => ({
      selected: [{ capabilityId: "risk.analyze", roleId: "安全" }],
      rationale: `loop ${i}`,
      source: "heuristic_fallback",
    }));

    const s = createInitialSessionState("面向企业内部 RBAC 权限与数据范围", "sd-budget");
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

  it("executes multiple capabilities in the same round concurrently when parallelCapabilityExecution is on", async () => {
    const order: string[] = [];
    const executor = {
      async executeCapability(args: {
        capabilityId: string;
        roleId?: string;
      }) {
        order.push(`start:${args.capabilityId}`);
        return {
          title: args.capabilityId,
          summary: "ok",
          content: `${args.capabilityId} content`,
          provenance: "ai_generated" as const,
        };
      },
    };

    const s = createInitialSessionState("面向企业内部 RBAC 权限与数据范围并行推演", "sd-parallel");
    const { preparedState } = intakeMessage(s, { turnId: "par-0", userText: "分析并对比路线" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "par-0",
      userText: "分析并对比路线",
      router: createDeterministicRouter([
        {
          selected: [
            { capabilityId: "counter.argue", roleId: "挑刺" },
            { capabilityId: "tradeoff.evaluate", roleId: "架构" },
            { capabilityId: "assumption.validate", roleId: "规划" },
          ],
          rationale: "parallel batch",
          source: "llm",
        },
      ]),
      executor,
      maxLoopsPerMessage: 1,
      parallelCapabilityExecution: true,
    });

    expect(result.loops[0]?.committedArtifactIds.length).toBe(3);
    expect(order.filter((x) => x.startsWith("start:")).length).toBe(3);
  });

  it("re-enters ORCH after GCOV_BLOCKED when the next loop can force-schedule missing pre-reqs", async () => {
    let s = createInitialSessionState(COMPLEX_GOAL_TEXT, "sd-gcov-reentry");
    const { updatedState } = commitArtifact(
      s,
      createRawArtifact("untrusted-risk", "risk.analyze", "安全", "risk"),
      "sd-gcov-r0",
      true,
      []
    );
    s = updatedState;
    s = commitTrusted(s, "trusted-synth", "synthesis.merge", "综合", "synthesis", "sd-gcov-s0");

    const userText = "路线对比，拆解结构，预览效果";
    const { preparedState } = intakeMessage(s, { turnId: "gcov-d0", userText });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "gcov-d0",
      userText,
      router: createDeterministicRouter((_req, i) =>
        i === 0
          ? {
              selected: [
                { capabilityId: "report.write", roleId: "综合" },
                { capabilityId: "route.compare", roleId: "规划" },
                { capabilityId: "structure.decompose", roleId: "规划" },
                { capabilityId: "scenario.simulate", roleId: "规划" },
              ],
              rationale: "premature converge fills cap",
              source: "llm",
            }
          : {
              selected: [{ capabilityId: "report.write", roleId: "综合" }],
              rationale: "converge retry",
              source: "llm",
            }
      ),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 4,
    });

    expect(result.loops.length).toBeGreaterThanOrEqual(2);
    expect(result.loops[0].plan.reason).toMatch(/GCOV_BLOCKED/);
    expect(result.loops[0].committedArtifactIds).toHaveLength(0);
    const laterPlan = result.loops.slice(1).find((l) => l.plan.selected.length > 0);
    expect(laterPlan?.plan.selected.map((p) => p.capabilityId)).toContain("risk.analyze");
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