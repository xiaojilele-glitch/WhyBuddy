/**
 * Brainstorm Pipeline Integration Unit Tests
 *
 * Tests Decision Gate invocation at stage start, routing to orchestrator
 * vs single-agent, graceful degradation when brainstorm disabled, and
 * synthesis result feeding back as stage output.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §1, §2
 * Requirements: 1.1, 1.3, 1.4, 8.3, 10.1
 */

import { describe, expect, it, vi } from "vitest";

import {
  executeStageWithBrainstorm,
  assembleBrainstormContext,
  getBrainstormDiagnostics,
  type BrainstormServiceContext,
  type StageContext,
} from "../../../routes/blueprint/brainstorm/pipeline-integration";
import type { LLMCallerFn, EventEmitterFn } from "../../../routes/blueprint/brainstorm/orchestrator";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStageContext(overrides?: Partial<StageContext>): StageContext {
  return {
    jobId: "job-1",
    stageId: "planning",
    stageDescription: "Design the authentication system",
    degradedBridges: [],
    previousStageOutputs: [],
    ...overrides,
  };
}

function makeMockLLM(responses?: Record<number, string>): LLMCallerFn {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    callCount++;
    if (responses && responses[callCount]) {
      return Promise.resolve(responses[callCount]);
    }
    return Promise.resolve(
      JSON.stringify({
        content: "Analysis result",
        confidence: 0.8,
        needsToolCall: false,
      }),
    );
  });
}

function makeMockEmitter(): EventEmitterFn & ReturnType<typeof vi.fn> {
  return vi.fn();
}

function makeSingleAgentFallback(): (ctx: StageContext) => Promise<string> {
  return vi.fn().mockResolvedValue("Single agent output");
}

// ─── Decision Gate Invocation at Stage Start ────────────────────────────────

describe("Pipeline Integration - Decision Gate Invocation", () => {
  it("invokes Decision Gate at each stage start when brainstorm is enabled", async () => {
    // Create a mock LLM that returns brainstormNeeded=false for Decision Gate
    const decisionGateResponse = JSON.stringify({
      brainstormNeeded: false,
      recommendedMode: "discussion",
      requiredRoles: ["planner"],
      requiredToolCategories: [],
      reasoning: "Simple task, no brainstorm needed",
    });

    const mockLLM: LLMCallerFn = vi.fn().mockResolvedValue(decisionGateResponse);
    const emitter = makeMockEmitter();
    const fallback = makeSingleAgentFallback();

    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";

    const ctx = assembleBrainstormContext(mockLLM, emitter)!;
    const stageContext = makeStageContext();

    await executeStageWithBrainstorm(stageContext, ctx, mockLLM, emitter, fallback);

    // LLM should have been called for Decision Gate
    expect(mockLLM).toHaveBeenCalled();
    // Fallback should be called since brainstormNeeded=false
    expect(fallback).toHaveBeenCalled();

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
    ctx.orchestrator.dispose();
  });

  it("skips Decision Gate entirely when brainstorm is disabled", async () => {
    const mockLLM: LLMCallerFn = vi.fn();
    const emitter = makeMockEmitter();
    const fallback = makeSingleAgentFallback();

    const result = await executeStageWithBrainstorm(
      makeStageContext(),
      null, // no brainstorm context
      mockLLM,
      emitter,
      fallback,
    );

    expect(result.type).toBe("single-agent");
    expect(result.output).toBe("Single agent output");
    // LLM should NOT have been called for Decision Gate
    expect(mockLLM).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalled();
  });
});

// ─── Routing to Orchestrator vs Single-Agent ────────────────────────────────

describe("Pipeline Integration - Routing", () => {
  it("routes to single-agent when brainstormNeeded=false", async () => {
    const decisionGateResponse = JSON.stringify({
      brainstormNeeded: false,
      recommendedMode: "discussion",
      requiredRoles: ["planner"],
      requiredToolCategories: [],
      reasoning: "No brainstorm needed",
    });

    const mockLLM: LLMCallerFn = vi.fn().mockResolvedValue(decisionGateResponse);
    const emitter = makeMockEmitter();
    const fallback = makeSingleAgentFallback();

    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";
    const ctx = assembleBrainstormContext(mockLLM, emitter)!;

    const result = await executeStageWithBrainstorm(
      makeStageContext(),
      ctx,
      mockLLM,
      emitter,
      fallback,
    );

    expect(result.type).toBe("single-agent");
    expect(result.output).toBe("Single agent output");

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
    ctx.orchestrator.dispose();
  });

  it("routes to orchestrator when brainstormNeeded=true", async () => {
    // First call is Decision Gate (returns brainstormNeeded=true)
    // Subsequent calls are crew member LLM calls
    let callIdx = 0;
    const mockLLM: LLMCallerFn = vi.fn().mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        // Decision Gate response
        return Promise.resolve(JSON.stringify({
          brainstormNeeded: true,
          recommendedMode: "vote",
          requiredRoles: ["planner"],
          requiredToolCategories: [],
          reasoning: "Complex task needs brainstorm",
        }));
      }
      // Crew member response
      return Promise.resolve(JSON.stringify({
        content: "Crew member output",
        confidence: 0.85,
        needsToolCall: false,
      }));
    });

    const emitter = makeMockEmitter();
    const fallback = makeSingleAgentFallback();

    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";
    const ctx = assembleBrainstormContext(mockLLM, emitter)!;

    const result = await executeStageWithBrainstorm(
      makeStageContext(),
      ctx,
      mockLLM,
      emitter,
      fallback,
    );

    // Should have used brainstorm path
    expect(result.type).toBe("brainstorm");
    expect(result.sessionId).toBeDefined();
    // Fallback should NOT be called
    expect(fallback).not.toHaveBeenCalled();

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
    ctx.orchestrator.dispose();
  });
});

// ─── Graceful Degradation ───────────────────────────────────────────────────

describe("Pipeline Integration - Graceful Degradation", () => {
  it("falls back to single-agent when brainstorm disabled via env", async () => {
    const mockLLM: LLMCallerFn = vi.fn();
    const emitter = makeMockEmitter();
    const fallback = makeSingleAgentFallback();

    const result = await executeStageWithBrainstorm(
      makeStageContext(),
      null,
      mockLLM,
      emitter,
      fallback,
    );

    expect(result.type).toBe("single-agent");
    expect(result.output).toBe("Single agent output");
  });

  it("falls back to single-agent on Decision Gate LLM failure", async () => {
    const failingLLM: LLMCallerFn = vi.fn().mockRejectedValue(new Error("LLM down"));
    const emitter = makeMockEmitter();
    const fallback = makeSingleAgentFallback();

    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";
    const ctx = assembleBrainstormContext(failingLLM, emitter)!;

    const result = await executeStageWithBrainstorm(
      makeStageContext(),
      ctx,
      failingLLM,
      emitter,
      fallback,
    );

    // Decision Gate handles error internally and returns fallback (brainstormNeeded=false)
    expect(result.type).toBe("single-agent");
    expect(fallback).toHaveBeenCalled();

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
    ctx.orchestrator.dispose();
  });

  it("emits brainstorm.mode.selected event when mode is chosen", async () => {
    let callIdx = 0;
    const mockLLM: LLMCallerFn = vi.fn().mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        return Promise.resolve(JSON.stringify({
          brainstormNeeded: true,
          recommendedMode: "discussion",
          requiredRoles: ["planner"],
          requiredToolCategories: [],
          reasoning: "Need brainstorm",
        }));
      }
      return Promise.resolve(JSON.stringify({
        content: "Output",
        confidence: 0.8,
        needsToolCall: false,
      }));
    });

    const emitter = makeMockEmitter();
    const fallback = makeSingleAgentFallback();

    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";
    const ctx = assembleBrainstormContext(mockLLM, emitter)!;

    await executeStageWithBrainstorm(
      makeStageContext(),
      ctx,
      mockLLM,
      emitter,
      fallback,
    );

    // Check that brainstorm.mode.selected was emitted
    const modeSelectedCalls = (emitter as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([eventType]) => eventType === "brainstorm.mode.selected",
    );
    expect(modeSelectedCalls.length).toBeGreaterThanOrEqual(1);

    const payload = modeSelectedCalls[0][1];
    expect(payload.mode).toBe("discussion");
    expect(payload.roles).toContain("planner");

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
    ctx.orchestrator.dispose();
  });

  it("pipeline never blocks due to brainstorm infrastructure failures", async () => {
    // LLM fails on first call (Decision Gate) — should not block
    const failingLLM: LLMCallerFn = vi.fn().mockRejectedValue(new Error("Network error"));
    const emitter = makeMockEmitter();
    const fallback = makeSingleAgentFallback();

    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";
    const ctx = assembleBrainstormContext(failingLLM, emitter)!;

    const startTime = Date.now();
    const result = await executeStageWithBrainstorm(
      makeStageContext(),
      ctx,
      failingLLM,
      emitter,
      fallback,
    );
    const elapsed = Date.now() - startTime;

    // Should complete quickly (not block for 120s timeout)
    expect(elapsed).toBeLessThan(10000);
    expect(result.type).toBe("single-agent");

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
    ctx.orchestrator.dispose();
  });
});

// ─── Synthesis Result Feeding Back ──────────────────────────────────────────

describe("Pipeline Integration - Synthesis Result", () => {
  it("feeds synthesis result back as stage output", async () => {
    let callIdx = 0;
    const mockLLM: LLMCallerFn = vi.fn().mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        return Promise.resolve(JSON.stringify({
          brainstormNeeded: true,
          recommendedMode: "vote",
          requiredRoles: ["planner"],
          requiredToolCategories: [],
          reasoning: "Complex task",
        }));
      }
      return Promise.resolve(JSON.stringify({
        content: "Synthesized decision output",
        confidence: 0.9,
        needsToolCall: false,
      }));
    });

    const emitter = makeMockEmitter();
    const fallback = makeSingleAgentFallback();

    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";
    const ctx = assembleBrainstormContext(mockLLM, emitter)!;

    const result = await executeStageWithBrainstorm(
      makeStageContext(),
      ctx,
      mockLLM,
      emitter,
      fallback,
    );

    expect(result.type).toBe("brainstorm");
    // Output should contain some content from synthesis/crew member
    expect(result.output.length).toBeGreaterThan(0);

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
    ctx.orchestrator.dispose();
  });
});
