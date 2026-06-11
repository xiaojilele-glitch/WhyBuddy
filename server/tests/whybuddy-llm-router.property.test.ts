/**
 * whybuddy-llm-autonomous-reasoning — LLM_Router property tests (tasks 2.5–2.10).
 * All tests run with zero real LLM calls (mocked seams or pure functions).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import * as aiConfig from "../core/ai-config.js";
import * as llmClient from "../core/llm-client.js";
import {
  resolveRouterModel,
  isMechanicalConvergenceSignal,
  executeOrchestratePlan,
  buildOrchestrateUserPrompt,
} from "../whybuddy/orchestrate-plan.js";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import { ALL_V5_CAPABILITIES } from "../../shared/blueprint/contracts.js";
import { withStubbedLlmKey } from "../routes/__tests__/helpers/with-stubbed-llm-key.js";

const baseState = (): V5SessionState => ({
  sessionId: "pbt-s1",
  goal: { text: "权限系统", status: "needs_refinement" },
  artifacts: [],
  staleArtifactIds: [],
  decisionLedger: [],
  capabilityRuns: [],
});

const PBT_OPTS = { numRuns: 100 };

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 11: 路由模型解析与回退
 * Validates: Requirements 3.1
 */
describe("Property 11: resolveRouterModel", () => {
  it("router model equals routerModel ?? model for any config pair", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
        (model, routerModel) => {
          expect(resolveRouterModel({ model, routerModel })).toBe(routerModel ?? model);
        }
      ),
      PBT_OPTS
    );
  });

  it("executeOrchestratePlan passes resolved model to LLM client", async () => {
    const spy = vi.spyOn(llmClient, "callLLMJsonWithUsage").mockResolvedValue({
      json: {
        selected: [{ capabilityId: "risk.analyze", roleId: "安全" }],
        rationale: "analyze",
      },
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    } as any);

    vi.spyOn(aiConfig, "getAIConfig").mockReturnValue({
      apiKey: "test-key",
      baseUrl: "https://api.test/v1",
      model: "primary-model",
      routerModel: "router-fast",
      modelReasoningEffort: "low",
      maxContext: 8000,
      providerName: "test",
      wireApi: "chat_completions",
      timeoutMs: 5000,
      stream: false,
    });

    await executeOrchestratePlan({
      state: baseState(),
      turnId: "t-p11",
      userText: "分析风险",
    });

    expect(spy).toHaveBeenCalled();
    const callOpts = spy.mock.calls[0]?.[1] as { model?: string };
    expect(callOpts?.model).toBe("router-fast");
    spy.mockRestore();
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 12: 覆盖率摘要注入路由 prompt
 * Validates: Requirements 3.2
 */
describe("Property 12: Coverage_Contract in router prompt", () => {
  it("prompt contains required and conditional capability summaries", () => {
    fc.assert(
      fc.property(
        fc.subarray(ALL_V5_CAPABILITIES, { minLength: 1, maxLength: 6 }),
        fc.subarray(ALL_V5_CAPABILITIES, { minLength: 0, maxLength: 4 }),
        (required, conditional) => {
          const state: V5SessionState = {
            ...baseState(),
            coverageContract: {
              mode: "standard",
              requiredCapabilities: required,
              conditionalCapabilities: conditional,
              blockingGapIds: [],
              minEvidencePerRequirement: 1,
            } as any,
          };
          const prompt = buildOrchestrateUserPrompt({
            state,
            turnId: "t-p12",
            userText: "继续",
          });
          expect(prompt).toContain("COVERAGE_CONTRACT");
          for (const cap of required) {
            expect(prompt).toContain(cap);
          }
          for (const cap of conditional) {
            expect(prompt).toContain(cap);
          }
        }
      ),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 13: 收敛信号机械判定
 * Validates: Requirements 3.3, 3.4
 */
describe("Property 13: mechanical convergence signal", () => {
  it("isMechanicalConvergenceSignal iff empty selected AND converged === true", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant([] as unknown[]),
          fc.array(
            fc.record({
              capabilityId: fc.constantFrom(...ALL_V5_CAPABILITIES),
              roleId: fc.string({ minLength: 1, maxLength: 8 }),
            }),
            { minLength: 1, maxLength: 3 }
          )
        ),
        fc.oneof(fc.constant(undefined), fc.boolean()),
        fc.string({ minLength: 0, maxLength: 200 }),
        (selected, converged, _rationale) => {
          const signal = isMechanicalConvergenceSignal(selected, converged);
          const expected =
            Array.isArray(selected) && selected.length === 0 && converged === true;
          expect(signal).toBe(expected);
        }
      ),
      PBT_OPTS
    );
  });

  describe("executeOrchestratePlan integration (zero real LLM)", () => {
    let restoreLlmKey: (() => void) | undefined;

    beforeEach(() => {
      ({ restore: restoreLlmKey } = withStubbedLlmKey());
      vi.spyOn(aiConfig, "getAIConfig").mockReturnValue({
        apiKey: "test-key",
        baseUrl: "https://api.test/v1",
        model: "primary-model",
        modelReasoningEffort: "low",
        maxContext: 8000,
        providerName: "test",
        wireApi: "chat_completions",
        timeoutMs: 5000,
        stream: false,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      restoreLlmKey?.();
      restoreLlmKey = undefined;
    });

    it("empty + converged true → llm source with converged, not heuristic_fallback", async () => {
      fc.assert(
        fc.asyncProperty(fc.string({ minLength: 0, maxLength: 120 }), async (rationale) => {
          vi.spyOn(llmClient, "callLLMJsonWithUsage").mockResolvedValueOnce({
            json: { selected: [], converged: true, rationale },
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          } as any);

          const res = await executeOrchestratePlan({
            state: baseState(),
            turnId: "t-conv",
            userText: "够了",
          });

          expect(res.source).toBe("llm");
          expect(res.converged).toBe(true);
          expect(res.selected).toEqual([]);
          expect(res.reason).toBeUndefined();
        }),
        { ...PBT_OPTS, numRuns: 50 }
      );
    });

    it("empty without converged === true → heuristic_fallback", async () => {
      fc.assert(
        fc.asyncProperty(
          fc.oneof(fc.constant(undefined), fc.constant(false), fc.constant(true)),
          fc.string({ minLength: 1, maxLength: 80 }),
          async (converged, rationale) => {
            fc.pre(converged !== true);

            vi.spyOn(llmClient, "callLLMJsonWithUsage").mockResolvedValueOnce({
              json: { selected: [], converged, rationale },
            } as any);

            const res = await executeOrchestratePlan({
              state: baseState(),
              turnId: "t-fb",
              userText: "继续",
            });

            expect(res.source).toBe("heuristic_fallback");
            expect(res.converged).toBeUndefined();
            expect(res.selected.length).toBeGreaterThan(0);
          }
        ),
        { ...PBT_OPTS, numRuns: 50 }
      );
    });
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 29: 路由摘要不含完整 content
 * Validates: Requirements 11.3
 */
describe("Property 29: router prompt excludes full artifact content", () => {
  it("prompt never embeds arbitrary long artifact bodies", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 80, maxLength: 400 }),
        fc.uuid(),
        (secretBody, artId) => {
          const state: V5SessionState = {
            ...baseState(),
            artifacts: [
              {
                id: artId,
                kind: "decision",
                trustLevel: "gated_pass",
                content: secretBody,
                summary: "short",
                producedBy: { capabilityId: "risk.analyze", turnId: "t0" },
              } as any,
            ],
          };
          const prompt = buildOrchestrateUserPrompt({
            state,
            turnId: "t-p29",
            userText: "x",
          });
          expect(prompt).not.toContain(secretBody);
        }
      ),
      PBT_OPTS
    );
  });
});