/**
 * Brainstorm Diagnostics Extension Unit Tests
 *
 * Tests that the diagnostics endpoint includes brainstormOrchestrator entry
 * and that counters accurately reflect session activity.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §7
 * Requirements: 10.6
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { BrainstormOrchestrator } from "../../../routes/blueprint/brainstorm/orchestrator";
import {
  assembleBrainstormContext,
  getBrainstormDiagnostics,
} from "../../../routes/blueprint/brainstorm/pipeline-integration";
import type { EventEmitterFn, LLMCallerFn } from "../../../routes/blueprint/brainstorm/orchestrator";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockLLM(): LLMCallerFn {
  return vi.fn().mockResolvedValue(
    JSON.stringify({
      content: "Analysis complete",
      confidence: 0.8,
      needsToolCall: false,
    }),
  );
}

function makeMockEmitter(): EventEmitterFn {
  return vi.fn();
}

// ─── Diagnostics Response Structure ─────────────────────────────────────────

describe("Brainstorm Diagnostics Extension", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns disabled diagnostics when brainstorm context is null", () => {
    const diag = getBrainstormDiagnostics(null);

    expect(diag.enabled).toBe(false);
    expect(diag.activeSessionsCount).toBe(0);
    expect(diag.totalSessionsCompleted).toBe(0);
    expect(diag.degradationCount).toBe(0);
    expect(diag.averageSessionDurationMs).toBe(0);
    expect(diag.tokenBudget).toBe(0);
    expect(diag.toolCallLimit).toBe(0);
    expect(diag.perStageConfig).toEqual({
      route_generation: false,
      spec_tree: false,
      spec_docs: false,
      effect_preview: false,
      prompt_packaging: false,
      engineering_handoff: false,
    });
  });

  it("returns enabled diagnostics with correct initial values", () => {
    const orchestrator = new BrainstormOrchestrator(makeMockLLM(), makeMockEmitter());
    const ctx = {
      orchestrator,
      synthesizer: {} as any,
      memoryStore: {} as any,
      enabled: true,
    };

    const diag = getBrainstormDiagnostics(ctx);

    expect(diag.enabled).toBe(true);
    expect(diag.activeSessionsCount).toBe(0);
    expect(diag.totalSessionsCompleted).toBe(0);
    expect(diag.degradationCount).toBe(0);
    expect(diag.averageSessionDurationMs).toBe(0);
    expect(diag.tokenBudget).toBe(50000);
    expect(diag.toolCallLimit).toBe(20);
    expect(diag.perStageConfig).toEqual({
      route_generation: false,
      spec_tree: false,
      spec_docs: false,
      effect_preview: false,
      prompt_packaging: false,
      engineering_handoff: false,
    });
  });

  it("diagnostics includes all required fields", () => {
    const orchestrator = new BrainstormOrchestrator(makeMockLLM(), makeMockEmitter());
    const ctx = {
      orchestrator,
      synthesizer: {} as any,
      memoryStore: {} as any,
      enabled: true,
    };

    const diag = getBrainstormDiagnostics(ctx);

    expect(diag).toHaveProperty("enabled");
    expect(diag).toHaveProperty("activeSessionsCount");
    expect(diag).toHaveProperty("totalSessionsCompleted");
    expect(diag).toHaveProperty("degradationCount");
    expect(diag).toHaveProperty("averageSessionDurationMs");
    expect(diag).toHaveProperty("tokenBudget");
    expect(diag).toHaveProperty("toolCallLimit");
    expect(diag).toHaveProperty("perStageConfig");
  });

  it("perStageConfig reflects current environment values", () => {
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";
    process.env.BRAINSTORM_STAGE_ROUTE_GENERATION_ENABLED = "true";
    process.env.BRAINSTORM_STAGE_SPEC_TREE_ENABLED = "TRUE";
    process.env.BRAINSTORM_STAGE_SPEC_DOCS_ENABLED = "1";
    process.env.BRAINSTORM_STAGE_EFFECT_PREVIEW_ENABLED = "true";

    const diag = getBrainstormDiagnostics(null);

    expect(diag.perStageConfig).toEqual({
      route_generation: true,
      spec_tree: false,
      spec_docs: false,
      effect_preview: true,
      prompt_packaging: false,
      engineering_handoff: false,
    });
  });

  it("counter accuracy after session completion", async () => {
    const mockLLM = makeMockLLM();
    const emitter = makeMockEmitter();
    const orchestrator = new BrainstormOrchestrator(mockLLM, emitter);

    // Start a session (it will complete quickly with mock LLM)
    await orchestrator.startSession({
      jobId: "job-1",
      stageId: "stage-1",
      mode: "vote",
      roles: ["planner"],
      toolCategories: [],
      stageContext: "Test context",
    });

    // Give time for async mode execution to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const diag = orchestrator.getDiagnostics();

    // Session should have completed and incremented counter
    expect(diag.totalSessionsCompleted).toBeGreaterThanOrEqual(1);
    expect(diag.averageSessionDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("active sessions count reflects running sessions", async () => {
    // Use a slow LLM that doesn't resolve immediately
    const slowLLM: LLMCallerFn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(
        JSON.stringify({ content: "result", confidence: 0.8, needsToolCall: false })
      ), 5000)),
    );
    const emitter = makeMockEmitter();
    const orchestrator = new BrainstormOrchestrator(slowLLM, emitter);

    // Start a session that won't complete immediately
    await orchestrator.startSession({
      jobId: "job-1",
      stageId: "stage-1",
      mode: "vote",
      roles: ["planner"],
      toolCategories: [],
      stageContext: "Test context",
    });

    const diag = orchestrator.getDiagnostics();
    expect(diag.activeSessionsCount).toBe(1);

    orchestrator.dispose();
  });
});

// ─── assembleBrainstormContext ───────────────────────────────────────────────

describe("assembleBrainstormContext", () => {
  it("returns null when BLUEPRINT_BRAINSTORM_ENABLED is not 'true'", () => {
    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "false";

    const ctx = assembleBrainstormContext(makeMockLLM(), makeMockEmitter());
    expect(ctx).toBeNull();

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
  });

  it("returns context when BLUEPRINT_BRAINSTORM_ENABLED is 'true'", () => {
    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";

    const ctx = assembleBrainstormContext(makeMockLLM(), makeMockEmitter());
    expect(ctx).not.toBeNull();
    expect(ctx!.enabled).toBe(true);
    expect(ctx!.orchestrator).toBeDefined();
    expect(ctx!.synthesizer).toBeDefined();
    expect(ctx!.memoryStore).toBeDefined();

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
  });
});
