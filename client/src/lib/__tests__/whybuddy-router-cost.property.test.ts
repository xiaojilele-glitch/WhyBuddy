/**
 * Feature: whybuddy-llm-autonomous-reasoning — Property 27 & 28 (tasks 2.8, 2.9)
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createInitialSessionState,
  recordCapabilityRunCost,
  driveReasoningSession,
  createDeterministicRouter,
  createDeterministicCapabilityExecutor,
  intakeMessage,
} from "../whybuddy-runtime";
import { ALL_V5_CAPABILITIES } from "@shared/blueprint/contracts";

const PBT_OPTS = { numRuns: 100 };

const execCaps = ALL_V5_CAPABILITIES.filter((c) => c !== "orchestrate.plan");

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 27: 路由成本被记入 orchestrate.plan 桶
 * Validates: Requirements 11.1
 */
describe("Property 27: orchestrate.plan cost bucket", () => {
  it("any routing usage append produces orchestrate.plan ledger entry", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.uuid(),
        (tokens, turnId) => {
          let s = createInitialSessionState("cost", `s-27-${turnId}`);
          const before = (s.costLedger || []).length;
          s = recordCapabilityRunCost(
            s,
            {
              id: `${turnId}-orch`,
              capabilityId: "orchestrate.plan" as any,
              turnId,
              inputs: [],
              outputs: [],
              gateResults: [],
            } as any,
            { source: "server", usage: { totalTokens: tokens } }
          );
          const after = s.costLedger || [];
          expect(after.length).toBe(before + 1);
          const rec = after.find((c) => c.capabilityId === "orchestrate.plan");
          expect(rec?.estimatedTokens).toBe(tokens);
        }
      ),
      PBT_OPTS
    );
  });

  it("driveReasoningSession records orchestrate.plan when router emits usage", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5000 }), async (tokens) => {
        const s = createInitialSessionState("drv-cost", "s-27-drv");
        const { preparedState } = intakeMessage(s, { turnId: "t-27", userText: "go" });

        const result = await driveReasoningSession(preparedState, {
          turnSeedId: "t-27",
          userText: "go",
          router: createDeterministicRouter([
            {
              selected: [{ capabilityId: "intent.clarify", roleId: "规划" }],
              rationale: "pick",
              source: "llm",
              usage: { totalTokens: tokens },
            },
            { selected: [], rationale: "done", source: "llm", converged: true },
          ]),
          executor: createDeterministicCapabilityExecutor(),
        });

        const orch = (result.finalState.costLedger || []).filter(
          (c) => c.capabilityId === "orchestrate.plan"
        );
        expect(orch.some((c) => c.estimatedTokens === tokens)).toBe(true);
      }),
      { ...PBT_OPTS, numRuns: 30 }
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 28: 路由与执行成本可分离归因
 * Validates: Requirements 11.2
 */
describe("Property 28: separable cost buckets", () => {
  it("orchestrate.plan bucket and execution buckets partition the ledger", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            cap: fc.constantFrom(...execCaps),
            tokens: fc.integer({ min: 0, max: 10_000 }),
          }),
          { minLength: 0, maxLength: 8 }
        ),
        fc.integer({ min: 0, max: 10_000 }),
        (execEntries, orchTokens) => {
          let s = createInitialSessionState("mixed", "s-28");
          if (orchTokens > 0) {
            s = recordCapabilityRunCost(
              s,
              {
                id: "orch",
                capabilityId: "orchestrate.plan" as any,
                turnId: "t",
                inputs: [],
                outputs: [],
                gateResults: [],
              } as any,
              { source: "server", usage: { totalTokens: orchTokens } }
            );
          }
          for (let i = 0; i < execEntries.length; i++) {
            const e = execEntries[i];
            s = recordCapabilityRunCost(
              s,
              {
                id: `exec-${i}`,
                capabilityId: e.cap as any,
                turnId: "t",
                inputs: [],
                outputs: [],
                gateResults: [],
              } as any,
              { tokens: e.tokens, source: "estimated" }
            );
          }

          const ledger = s.costLedger || [];
          const orchTotal = ledger
            .filter((c) => c.capabilityId === "orchestrate.plan")
            .reduce((sum, c) => sum + (c.estimatedTokens || 0), 0);
          const execTotal = ledger
            .filter((c) => c.capabilityId !== "orchestrate.plan")
            .reduce((sum, c) => sum + (c.estimatedTokens || 0), 0);
          const grand = ledger.reduce((sum, c) => sum + (c.estimatedTokens || 0), 0);

          expect(orchTotal + execTotal).toBe(grand);
          expect(orchTotal).toBe(orchTokens);
          const expectedExec = execEntries.reduce((s, e) => s + e.tokens, 0);
          expect(execTotal).toBe(expectedExec);
        }
      ),
      PBT_OPTS
    );
  });
});