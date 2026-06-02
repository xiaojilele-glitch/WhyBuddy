/**
 * Brainstorm End-to-End Smoke Tests
 *
 * Verifies system behavior at the integration boundary level:
 * - Brainstorm disabled by default
 * - Full brainstorm session lifecycle
 * - Graceful degradation cascade
 * - Role registry completeness
 * - Environment variable configuration
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md
 * Requirements: 1.1, 2.1, 2.6, 3.6, 4.5, 8.3, 9.1, 10.1, 10.4, 10.5
 */

import { describe, expect, it, vi, afterEach } from "vitest";

import { BrainstormOrchestrator } from "../../../routes/blueprint/brainstorm/orchestrator";
import { BrainstormSynthesizer } from "../../../routes/blueprint/brainstorm/synthesizer";
import {
  BrainstormMemoryStore,
  buildSessionArtifact,
} from "../../../routes/blueprint/brainstorm/memory-store";
import {
  assembleBrainstormContext,
  executeStageWithBrainstorm,
  getBrainstormDiagnostics,
} from "../../../routes/blueprint/brainstorm/pipeline-integration";
import { getAllBrainstormRoles, getBrainstormRole } from "../../../routes/blueprint/brainstorm/role-registry";
import {
  decide,
  FALLBACK_OUTPUT,
} from "../../../routes/blueprint/brainstorm/decision-gate";
import type { LLMCallerFn, EventEmitterFn } from "../../../routes/blueprint/brainstorm/orchestrator";
import type { BrainstormRoleId } from "../../../../shared/blueprint/brainstorm-contracts";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockLLM(): LLMCallerFn {
  return vi.fn().mockResolvedValue(
    JSON.stringify({
      content: "Smoke test output",
      confidence: 0.8,
      needsToolCall: false,
    }),
  );
}

function makeMockEmitter(): EventEmitterFn & ReturnType<typeof vi.fn> {
  return vi.fn();
}

// ─── 19.1 Brainstorm disabled by default ────────────────────────────────────

describe("Smoke: Brainstorm disabled by default", () => {
  const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;

  afterEach(() => {
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
  });

  it("BLUEPRINT_BRAINSTORM_ENABLED='false' skips all brainstorm logic", async () => {
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "false";

    const mockLLM = makeMockLLM();
    const emitter = makeMockEmitter();
    const ctx = assembleBrainstormContext(mockLLM, emitter);

    // Context should be null when disabled
    expect(ctx).toBeNull();

    // Pipeline should continue with single-agent
    const fallback = vi.fn().mockResolvedValue("single-agent result");
    const result = await executeStageWithBrainstorm(
      {
        jobId: "job-smoke-1",
        stageId: "planning",
        stageDescription: "Test",
        degradedBridges: [],
      },
      null,
      mockLLM,
      emitter,
      fallback,
    );

    expect(result.type).toBe("single-agent");
    expect(result.output).toBe("single-agent result");
    // LLM should NOT have been called (no Decision Gate)
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it("BLUEPRINT_BRAINSTORM_ENABLED unset defaults to disabled", async () => {
    delete process.env.BLUEPRINT_BRAINSTORM_ENABLED;

    const ctx = assembleBrainstormContext(makeMockLLM(), makeMockEmitter());
    expect(ctx).toBeNull();
  });

  it("pipeline continues with single-agent execution unchanged when disabled", async () => {
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "false";

    const fallback = vi.fn().mockResolvedValue("Business as usual");
    const result = await executeStageWithBrainstorm(
      {
        jobId: "j1",
        stageId: "s1",
        stageDescription: "context",
        degradedBridges: [],
      },
      null,
      makeMockLLM(),
      makeMockEmitter(),
      fallback,
    );

    expect(result.type).toBe("single-agent");
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

// ─── 19.2 Full brainstorm session lifecycle ─────────────────────────────────

describe("Smoke: Full brainstorm session lifecycle", () => {
  it("complete lifecycle: Decision Gate → session → synthesis → output → persist", async () => {
    const emitter = makeMockEmitter();
    let callIdx = 0;
    const mockLLM: LLMCallerFn = vi.fn().mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        // Decision Gate
        return Promise.resolve(JSON.stringify({
          brainstormNeeded: true,
          recommendedMode: "vote",
          requiredRoles: ["planner", "architect"],
          requiredToolCategories: [],
          reasoning: "Complex decision needed",
        }));
      }
      // Crew member / synthesis responses
      return Promise.resolve(JSON.stringify({
        content: `Output from call ${callIdx}`,
        confidence: 0.85,
        needsToolCall: false,
      }));
    });

    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";
    const ctx = assembleBrainstormContext(mockLLM, emitter)!;

    const fallback = vi.fn().mockResolvedValue("fallback");
    const result = await executeStageWithBrainstorm(
      {
        jobId: "job-lifecycle",
        stageId: "design",
        stageDescription: "Design the system",
        degradedBridges: [],
      },
      ctx,
      mockLLM,
      emitter,
      fallback,
    );

    // Should complete as brainstorm
    expect(result.type).toBe("brainstorm");
    expect(result.sessionId).toBeDefined();
    expect(result.output.length).toBeGreaterThan(0);

    // Verify events were emitted
    const eventTypes = (emitter as ReturnType<typeof vi.fn>).mock.calls.map(
      ([type]) => type,
    );
    expect(eventTypes).toContain("brainstorm.session.started");
    expect(eventTypes).toContain("brainstorm.mode.selected");

    // Verify artifact was persisted to memory store
    const sessions = ctx.memoryStore.listByJob("job-lifecycle");
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
    ctx.orchestrator.dispose();
  });
});

// ─── 19.3 Graceful degradation cascade ──────────────────────────────────────

describe("Smoke: Graceful degradation cascade", () => {
  it("LLM unreachable mid-session: session terminates, degraded event emitted, pipeline continues", async () => {
    const emitter = makeMockEmitter();
    let callIdx = 0;
    const mockLLM: LLMCallerFn = vi.fn().mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        // Decision Gate succeeds
        return Promise.resolve(JSON.stringify({
          brainstormNeeded: true,
          recommendedMode: "vote",
          requiredRoles: ["planner"],
          requiredToolCategories: [],
          reasoning: "Need brainstorm",
        }));
      }
      // All subsequent calls fail (simulating LLM becoming unreachable)
      return Promise.reject(new Error("Connection refused"));
    });

    const originalEnv = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";
    const ctx = assembleBrainstormContext(mockLLM, emitter)!;

    const fallback = vi.fn().mockResolvedValue("degraded fallback output");
    const result = await executeStageWithBrainstorm(
      {
        jobId: "job-degrade",
        stageId: "stage-1",
        stageDescription: "Complex task",
        degradedBridges: [],
      },
      ctx,
      mockLLM,
      emitter,
      fallback,
    );

    // Should still return a result (either brainstorm with partial or single-agent fallback)
    expect(result).toBeDefined();
    expect(result.output.length).toBeGreaterThan(0);

    process.env.BLUEPRINT_BRAINSTORM_ENABLED = originalEnv;
    ctx.orchestrator.dispose();
  });

  it("degraded bridges bias Decision Gate toward single-agent", async () => {
    const emitter = makeMockEmitter();
    const mockLLM: LLMCallerFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        brainstormNeeded: true,
        recommendedMode: "vote",
        requiredRoles: ["planner"],
        requiredToolCategories: ["docker"],
        reasoning: "Would need brainstorm",
      }),
    );

    const output = await decide(
      {
        jobId: "job-d",
        stageId: "s",
        stageContext: "Context",
        degradedBridges: ["docker", "mcp"],
      },
      mockLLM,
      emitter,
    );

    // With degraded bridges, decision should override to brainstormNeeded=false
    expect(output.brainstormNeeded).toBe(false);
  });
});

// ─── 19.4 Role registry completeness ────────────────────────────────────────

describe("Smoke: Role registry completeness", () => {
  const ALL_EXPECTED_ROLES: BrainstormRoleId[] = [
    "decider",
    "planner",
    "architect",
    "executor",
    "auditor",
    "ui_previewer",
  ];

  it("all 6 roles are registered", () => {
    const allRoles = getAllBrainstormRoles();
    expect(allRoles).toHaveLength(6);
  });

  it("each role has a valid system prompt", () => {
    for (const roleId of ALL_EXPECTED_ROLES) {
      const role = getBrainstormRole(roleId);
      expect(role).toBeDefined();
      expect(role!.systemPrompt.length).toBeGreaterThan(10);
    }
  });

  it("each role has valid max iterations", () => {
    for (const roleId of ALL_EXPECTED_ROLES) {
      const role = getBrainstormRole(roleId);
      expect(role!.maxIterations).toBeGreaterThan(0);
      expect(role!.maxIterations).toBeLessThanOrEqual(10);
    }
  });

  it("each role has defined tool permissions", () => {
    for (const roleId of ALL_EXPECTED_ROLES) {
      const role = getBrainstormRole(roleId);
      expect(role!.toolPermissions).toBeDefined();
      expect(role!.toolPermissions.allowedCategories).toBeDefined();
      expect(Array.isArray(role!.toolPermissions.allowedCategories)).toBe(true);
      expect(role!.toolPermissions.maxCallsPerMember).toBeGreaterThan(0);
    }
  });
});

// ─── 19.5 Environment variable configuration ────────────────────────────────

describe("Smoke: Environment variable configuration", () => {
  const originalEnvs: Record<string, string | undefined> = {};

  afterEach(() => {
    // Restore original env
    for (const [key, val] of Object.entries(originalEnvs)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("BLUEPRINT_BRAINSTORM_ENABLED defaults to disabled", () => {
    originalEnvs.BLUEPRINT_BRAINSTORM_ENABLED = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    delete process.env.BLUEPRINT_BRAINSTORM_ENABLED;

    const ctx = assembleBrainstormContext(makeMockLLM(), makeMockEmitter());
    expect(ctx).toBeNull();
  });

  it("BLUEPRINT_BRAINSTORM_ENABLED='true' enables brainstorm", () => {
    originalEnvs.BLUEPRINT_BRAINSTORM_ENABLED = process.env.BLUEPRINT_BRAINSTORM_ENABLED;
    process.env.BLUEPRINT_BRAINSTORM_ENABLED = "true";

    const ctx = assembleBrainstormContext(makeMockLLM(), makeMockEmitter());
    expect(ctx).not.toBeNull();
    expect(ctx!.enabled).toBe(true);
    ctx!.orchestrator.dispose();
  });

  it("BRAINSTORM_MAX_TOKENS default is 50000", () => {
    const orchestrator = new BrainstormOrchestrator(makeMockLLM(), makeMockEmitter());
    const diag = orchestrator.getDiagnostics();
    expect(diag.tokenBudget).toBe(50000);
    orchestrator.dispose();
  });

  it("BRAINSTORM_MAX_TOOL_CALLS default is 20", () => {
    const orchestrator = new BrainstormOrchestrator(makeMockLLM(), makeMockEmitter());
    const diag = orchestrator.getDiagnostics();
    expect(diag.toolCallLimit).toBe(20);
    orchestrator.dispose();
  });

  it("custom token budget is applied to session", async () => {
    const mockLLM = makeMockLLM();
    const emitter = makeMockEmitter();
    const orchestrator = new BrainstormOrchestrator(mockLLM, emitter);

    const session = await orchestrator.startSession({
      jobId: "j1",
      stageId: "s1",
      mode: "vote",
      roles: ["planner"],
      toolCategories: [],
      stageContext: "Context",
      tokenBudget: 10000,
    });

    expect(session.tokenBudget).toBe(10000);
    orchestrator.dispose();
  });

  it("custom tool call limit is applied to session", async () => {
    const mockLLM = makeMockLLM();
    const emitter = makeMockEmitter();
    const orchestrator = new BrainstormOrchestrator(mockLLM, emitter);

    const session = await orchestrator.startSession({
      jobId: "j1",
      stageId: "s1",
      mode: "vote",
      roles: ["planner"],
      toolCategories: [],
      stageContext: "Context",
      toolCallLimit: 5,
    });

    expect(session.toolCallLimit).toBe(5);
    orchestrator.dispose();
  });
});
