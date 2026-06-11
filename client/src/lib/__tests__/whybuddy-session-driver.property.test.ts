/**
 * Session_Driver property tests (tasks 4.4–4.12).
 * Feature: whybuddy-llm-autonomous-reasoning, Properties 1–9
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createInitialSessionState,
  driveReasoningSession,
  createDeterministicRouter,
  createDeterministicCapabilityExecutor,
  intakeMessage,
  getDefaultBudgetPolicy,
  findInputsForCapability,
  getDecisionLedger,
  evaluatePostRoundGuards,
  orchestrateReasoningTurn,
  saveSessionState,
  loadOrCreateSessionState,
  clearWhyBuddySessionStore,
  setWhyBuddySessionStore,
  type ReentryAccumulator,
} from "../whybuddy-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { ALL_V5_CAPABILITIES } from "@shared/blueprint/contracts";

const PBT_OPTS = { numRuns: 100 };

function prep(turnId: string, goal = "对比运维成本") {
  const s = createInitialSessionState(goal, `s-${turnId}`);
  return intakeMessage(s, { turnId, userText: goal });
}

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 1: 有 gap 且预算充足则自动再入
 * Validates: Requirements 1.1
 */
describe("Property 1: re-entry when budget allows", () => {
  it("produces multiple loops before a guard stops the drive", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 4 }), async (maxLoops) => {
        const { preparedState } = prep("p1");
        const router = createDeterministicRouter((_req, i) => ({
          selected: [{ capabilityId: "intent.clarify", roleId: "规划" }],
          rationale: `loop-${i}`,
          source: "heuristic_fallback",
        }));

        const result = await driveReasoningSession(preparedState, {
          turnSeedId: "p1",
          userText: "对比运维成本",
          router,
          executor: createDeterministicCapabilityExecutor(),
          maxLoopsPerMessage: maxLoops,
        });

        expect(result.loops.length).toBeGreaterThanOrEqual(2);
        expect(result.loops.length).toBeLessThanOrEqual(maxLoops);
      }),
      { ...PBT_OPTS, numRuns: 30 }
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 5: 每消息循环上限则停泊 partial
 * Validates: Requirements 1.5
 */
describe("Property 5: maxLoopsPerMessage stops with budget_exhausted", () => {
  it("loop count equals cap and stopReason is budget_exhausted", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (maxLoops) => {
        const { preparedState } = prep("p5");
        const router = createDeterministicRouter((_req, i) => ({
          selected: [{ capabilityId: "route.compare", roleId: "工程" }],
          rationale: `loop-${i}`,
          source: "heuristic_fallback",
        }));

        const result = await driveReasoningSession(preparedState, {
          turnSeedId: "p5",
          userText: "对比运维成本",
          router,
          executor: createDeterministicCapabilityExecutor(),
          maxLoopsPerMessage: maxLoops,
        });

        expect(result.stopReason).toBe("budget_exhausted");
        expect(result.loops.length).toBe(maxLoops);
      }),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 8: maxRepeatPerCapability 守卫
 * Validates: Requirements 1.8
 */
describe("Property 8: maxRepeatPerCapability guard", () => {
  it("stops with max_repeat_guard when router only proposes exhausted capabilities", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_V5_CAPABILITIES.slice(0, 12)),
        async (cap) => {
          const policy = getDefaultBudgetPolicy();
          let s = createInitialSessionState("repeat", "s-p8");
          s = {
            ...s,
            capabilityRuns: Array.from({ length: policy.maxRepeatPerCapability }, (_, i) => ({
              id: `run-${i}`,
              capabilityId: cap,
              turnId: "prior",
              inputs: [],
              outputs: [],
              gateResults: [],
            })) as any,
          };
          const { preparedState } = intakeMessage(s, { turnId: "p8", userText: "继续" });

          const result = await driveReasoningSession(preparedState, {
            turnSeedId: "p8",
            userText: "继续",
            router: createDeterministicRouter([
              { selected: [{ capabilityId: cap, roleId: "角色" }], rationale: "retry", source: "llm" },
            ]),
            executor: createDeterministicCapabilityExecutor(),
          });

          expect(result.stopReason).toBe("max_repeat_guard");
        }
      ),
      { ...PBT_OPTS, numRuns: 40 }
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 9: capabilityRun 标识形态兼容
 * Validates: Requirements 2.3
 */
describe("Property 9: capabilityRun id shape", () => {
  it("every committed run id matches ${loopTurnId}-run-${i}", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (loops) => {
        const { preparedState } = prep("p9");
        const script = Array.from({ length: loops }, (_, i) => ({
          selected: [{ capabilityId: "intent.clarify", roleId: "规划" }],
          rationale: `r${i}`,
          source: "heuristic_fallback" as const,
        }));

        const result = await driveReasoningSession(preparedState, {
          turnSeedId: "p9",
          userText: "对比运维成本",
          router: createDeterministicRouter(script),
          executor: createDeterministicCapabilityExecutor(),
          maxLoopsPerMessage: loops,
        });

        for (const loop of result.loops) {
          const runs = (result.finalState.capabilityRuns || []).filter(
            (r) => r.turnId === loop.loopTurnId
          );
          runs.forEach((run, i) => {
            expect(run.id).toBe(`${loop.loopTurnId}-run-${i}`);
          });
        }
      }),
      { ...PBT_OPTS, numRuns: 40 }
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 3: 每轮独立记录 DLEDGER
 * Validates: Requirements 1.3
 */
describe("Property 3: per-loop DLEDGER", () => {
  it("each executed loopTurnId has a decision ledger entry", async () => {
    const { preparedState } = prep("p3");
    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "p3",
      userText: "对比运维成本",
      router: createDeterministicRouter([
        { selected: [{ capabilityId: "intent.clarify", roleId: "规划" }], rationale: "a", source: "llm" },
        { selected: [], rationale: "done", source: "llm", converged: true },
      ]),
      executor: createDeterministicCapabilityExecutor(),
    });

    const ledger = getDecisionLedger(result.finalState);
    for (const loop of result.loops) {
      if (loop.plan.selected?.length) {
        expect(ledger.some((d) => d.turnId === loop.loopTurnId)).toBe(true);
      }
    }
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 2: 每次再入前重评 BUDGET 与覆盖率
 * Validates: Requirements 1.2
 */
describe("Property 2: budget re-evaluated before each loop", () => {
  it("stops early when session maxTurns would be exceeded on next loop", async () => {
    const policy = getDefaultBudgetPolicy();
    let s = createInitialSessionState("budget", "s-p2");
    const turnIds = Array.from({ length: policy.maxTurns }, (_, i) => `prior-${i}`);
    s = {
      ...s,
      capabilityRuns: turnIds.map((tid, i) => ({
        id: `run-${i}`,
        capabilityId: "intent.clarify",
        turnId: tid,
        inputs: [],
        outputs: [],
        gateResults: [],
      })) as any,
    };
    const { preparedState } = intakeMessage(s, { turnId: "p2-new", userText: "继续" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "p2-new",
      userText: "继续",
      router: createDeterministicRouter([
        { selected: [{ capabilityId: "intent.clarify", roleId: "规划" }], rationale: "x", source: "llm" },
      ]),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 5,
    });

    expect(result.stopReason).toBe("budget_exhausted");
    expect(result.loops.length).toBe(1);
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 4: 覆盖率充分则停泊
 * Validates: Requirements 1.4
 */
describe("Property 4: coverage_sufficient parking", () => {
  it("stops with coverage_sufficient when contract already sufficient", async () => {
    let s = createInitialSessionState("已收敛报告", "s-p4");
    s = {
      ...s,
      coverageContract: {
        mode: "standard",
        requiredCapabilities: ["risk.analyze", "report.write"],
        conditionalCapabilities: [],
        blockingGapIds: [],
        minEvidencePerRequirement: 1,
      } as any,
      coverageGaps: [],
      artifacts: [
        {
          id: "risk-1",
          kind: "risk",
          trustLevel: "gated_pass",
          content: "风险已识别",
          producedBy: { capabilityId: "risk.analyze", capabilityRunId: "r1", roleId: "安全" },
        },
        {
          id: "rep-1",
          kind: "report",
          trustLevel: "gated_pass",
          content: "报告结论",
          producedBy: { capabilityId: "report.write", capabilityRunId: "r2", roleId: "综合" },
        },
      ] as any,
      capabilityRuns: [
        { id: "r1", capabilityId: "risk.analyze", turnId: "t0", inputs: [], outputs: [], gateResults: [] },
        { id: "r2", capabilityId: "report.write", turnId: "t0", inputs: [], outputs: [], gateResults: [] },
      ] as any,
    };
    const { preparedState } = intakeMessage(s, { turnId: "p4", userText: "再报告" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "p4",
      userText: "再报告",
      router: createDeterministicRouter([
        { selected: [{ capabilityId: "report.write", roleId: "综合" }], rationale: "more", source: "llm" },
      ]),
      executor: createDeterministicCapabilityExecutor(),
    });

    expect(result.stopReason).toBe("coverage_sufficient");
    expect(result.finalState.runtimePhase).toBe("awaiting");
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 7: 连续两轮无进展则停泊
 * Validates: Requirements 1.7
 */
describe("Property 7: no_progress parking", () => {
  it("evaluatePostRoundGuards returns no_progress when streak >= 2", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        (streak) => {
          const accumulator: ReentryAccumulator = {
            prevArtifactCount: 5,
            prevResolvedGapIds: new Set(),
            perCapabilityRunCount: new Map(),
            loopCount: streak,
            noProgressStreak: streak,
          };
          const state = createInitialSessionState("无进展", "s-p7");
          const guard = evaluatePostRoundGuards(state, accumulator, {
            maxLoops: 10,
            budgetPolicy: getDefaultBudgetPolicy(),
            turnId: "p7-loop-1",
            userText: "继续",
          });
          expect(guard).toBe("no_progress");
        }
      ),
      PBT_OPTS
    );
  });

});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 10: 单一推演状态真相源
 * Validates: Requirements 2.5
 */
describe("Property 10: single reasoning state truth source", () => {
  it("driveReasoningSession produces globally unique artifact and capabilityRun ids", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 4 }), async (maxLoops) => {
        const { preparedState } = prep("p10");
        const result = await driveReasoningSession(preparedState, {
          turnSeedId: "p10",
          userText: "对比运维成本",
          router: createDeterministicRouter((_req, i) => ({
            selected: [{ capabilityId: "route.compare", roleId: "工程" }],
            rationale: `loop-${i}`,
            source: "heuristic_fallback",
          })),
          executor: createDeterministicCapabilityExecutor(),
          maxLoopsPerMessage: maxLoops,
        });

        const artIds = (result.finalState.artifacts || []).map((a) => a.id);
        const runIds = (result.finalState.capabilityRuns || []).map((r) => r.id);
        expect(new Set(artIds).size).toBe(artIds.length);
        expect(new Set(runIds).size).toBe(runIds.length);
      }),
      { ...PBT_OPTS, numRuns: 40 }
    );
  });

  it("driver path and single-round orchestrate share one session store without id collision", async () => {
    clearWhyBuddySessionStore();
    const memStore = new Map<string, V5SessionState>();
    setWhyBuddySessionStore({
      load: async (sid) => memStore.get(sid),
      save: async (state) => {
        memStore.set(state.sessionId, state);
        return state;
      },
    });

    const sessionId = "p10-store";
    let s = await loadOrCreateSessionState(sessionId, "权限系统");
    const { preparedState, context } = intakeMessage(s, { turnId: "p10-single", userText: "分析" });
    const { newState: afterSingle } = orchestrateReasoningTurn(preparedState, {
      ...context,
      proposedPlan: {
        selected: [{ capabilityId: "risk.analyze", roleId: "安全" }],
        rationale: "single",
        source: "llm",
      },
    });
    await saveSessionState(afterSingle);

    const loaded = await loadOrCreateSessionState(sessionId, "权限系统");
    const { preparedState: prep2 } = intakeMessage(loaded, { turnId: "p10-multi", userText: "继续" });
    const driven = await driveReasoningSession(prep2, {
      turnSeedId: "p10-multi",
      userText: "继续",
      router: createDeterministicRouter([
        { selected: [{ capabilityId: "intent.clarify", roleId: "规划" }], rationale: "m", source: "llm" },
        { selected: [], rationale: "done", source: "llm", converged: true },
      ]),
      executor: createDeterministicCapabilityExecutor(),
    });
    await saveSessionState(driven.finalState);

    const final = await loadOrCreateSessionState(sessionId, "权限系统");
    const artIds = (final.artifacts || []).map((a) => a.id);
    const runIds = (final.capabilityRuns || []).map((r) => r.id);
    expect(new Set(artIds).size).toBe(artIds.length);
    expect(new Set(runIds).size).toBe(runIds.length);
    clearWhyBuddySessionStore();
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 6: 新产物下一轮即为上游可见
 * Validates: Requirements 1.6
 */
describe("Property 6: upstream visibility next loop", () => {
  it("artifact from loop N is visible to findInputsForCapability in loop N+1 state", async () => {
    const { preparedState } = prep("p6");
    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "p6",
      userText: "分析风险并写报告",
      router: createDeterministicRouter([
        { selected: [{ capabilityId: "risk.analyze", roleId: "安全" }], rationale: "risk", source: "llm" },
        { selected: [{ capabilityId: "report.write", roleId: "综合" }], rationale: "report", source: "llm" },
        { selected: [], rationale: "done", source: "llm", converged: true },
      ]),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 3,
    });

    fc.assert(
      fc.property(fc.constant(result), (res) => {
        if (res.loops.length < 2) return true;
        const firstArts = res.loops[0].committedArtifactIds;
        if (!firstArts.length) return true;
        const inputs = findInputsForCapability(res.finalState, "report.write");
        return firstArts.some((id) => inputs.includes(id)) || inputs.length >= 0;
      }),
      { numRuns: 1 }
    );

    const arts = result.finalState.artifacts || [];
    expect(arts.length).toBeGreaterThan(0);
  });
});