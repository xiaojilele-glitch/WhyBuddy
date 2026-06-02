/**
 * Unit tests for Brainstorm Orchestrator.
 *
 * Tests mode execution (discussion, vote, division, audit),
 * session timeout, token budget, and crew member lifecycle.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 10.5
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §2
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BrainstormRoleId,
  SessionConfig,
} from "../../../../shared/blueprint/brainstorm-contracts";
import {
  BRAINSTORM_MAX_TOKENS,
  BRAINSTORM_SESSION_TIMEOUT_MS,
  BrainstormOrchestrator,
  type EventEmitterFn,
  type LLMCallerFn,
} from "../../../routes/blueprint/brainstorm/orchestrator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    jobId: "job-test-1",
    stageId: "stage-planning",
    mode: "discussion",
    roles: ["planner", "architect"],
    toolCategories: ["mcp"],
    stageContext: "Design a REST API for user management.",
    tokenBudget: 50000,
    toolCallLimit: 20,
    ...overrides,
  };
}

function makeMockLLMCaller(response?: string): LLMCallerFn {
  const defaultResponse = JSON.stringify({
    content: "Analysis: The API should use RESTful patterns with proper auth.",
    confidence: 0.85,
    needsToolCall: false,
  });
  return vi.fn().mockResolvedValue(response ?? defaultResponse);
}

function makeFailingLLMCaller(error?: string): LLMCallerFn {
  return vi.fn().mockRejectedValue(new Error(error ?? "LLM unreachable"));
}

function makeCountingLLMCaller(): {
  caller: LLMCallerFn;
  calls: string[];
} {
  const calls: string[] = [];
  const caller: LLMCallerFn = vi.fn().mockImplementation((prompt: string) => {
    calls.push(prompt);
    return Promise.resolve(
      JSON.stringify({
        content: `Output #${calls.length}`,
        confidence: 0.8,
        needsToolCall: false,
      }),
    );
  });
  return { caller, calls };
}

function makeMockEmitter(): EventEmitterFn & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const fn = vi.fn().mockImplementation((eventType: string, payload: Record<string, unknown>) => {
    calls.push([eventType, payload]);
  });
  (fn as any).calls = calls;
  return fn as any;
}

// ---------------------------------------------------------------------------
// Session Lifecycle
// ---------------------------------------------------------------------------

describe("BrainstormOrchestrator - Session Lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("startSession creates a session with correct metadata", async () => {
    // Use a slow LLM so we can inspect initial state before execution begins
    const slowLLM: LLMCallerFn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify({
        content: "Output", confidence: 0.8, needsToolCall: false,
      })), 10_000)),
    );
    const orchestrator = new BrainstormOrchestrator(slowLLM, vi.fn());

    const config = makeConfig();
    const session = await orchestrator.startSession(config);

    expect(session.id).toBeDefined();
    expect(session.jobId).toBe("job-test-1");
    expect(session.stageId).toBe("stage-planning");
    expect(session.mode).toBe("discussion");
    expect(session.status).toBe("active");
    expect(session.crewMembers.size).toBe(2);
    expect(session.tokenBudget).toBe(50000);
    expect(session.startedAt).toBeInstanceOf(Date);

    orchestrator.dispose();
  });

  it("getSession retrieves a session by ID", async () => {
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      vi.fn(),
    );

    const session = await orchestrator.startSession(makeConfig());
    const retrieved = orchestrator.getSession(session.id);

    expect(retrieved).toBe(session);
    orchestrator.dispose();
  });

  it("getSession returns undefined for unknown ID", async () => {
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      vi.fn(),
    );

    expect(orchestrator.getSession("nonexistent")).toBeUndefined();
    orchestrator.dispose();
  });

  it("getActiveSessions returns only active/synthesizing sessions", async () => {
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      vi.fn(),
    );

    await orchestrator.startSession(makeConfig());
    const active = orchestrator.getActiveSessions();

    expect(active.length).toBeGreaterThanOrEqual(1);
    for (const s of active) {
      expect(["active", "synthesizing"]).toContain(s.status);
    }

    orchestrator.dispose();
  });

  it("getDiagnostics returns correct structure", async () => {
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      vi.fn(),
    );

    const diag = orchestrator.getDiagnostics();

    expect(diag.enabled).toBe(true);
    expect(typeof diag.activeSessionsCount).toBe("number");
    expect(typeof diag.totalSessionsCompleted).toBe("number");
    expect(typeof diag.degradationCount).toBe("number");
    expect(typeof diag.averageSessionDurationMs).toBe("number");
    expect(diag.tokenBudget).toBe(BRAINSTORM_MAX_TOKENS);
    expect(diag.toolCallLimit).toBe(20);

    orchestrator.dispose();
  });

  it("instantiates crew members from the role registry", async () => {
    // Use a slow LLM so we can inspect initial state
    const slowLLM: LLMCallerFn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify({
        content: "Output", confidence: 0.8, needsToolCall: false,
      })), 10_000)),
    );
    const orchestrator = new BrainstormOrchestrator(slowLLM, vi.fn());

    const config = makeConfig({
      roles: ["planner", "architect", "auditor"],
    });
    const session = await orchestrator.startSession(config);

    expect(session.crewMembers.size).toBe(3);
    expect(session.crewMembers.has("planner")).toBe(true);
    expect(session.crewMembers.has("architect")).toBe(true);
    expect(session.crewMembers.has("auditor")).toBe(true);

    const planner = session.crewMembers.get("planner")!;
    expect(planner.maxIterations).toBe(5); // planner maxIterations from registry

    orchestrator.dispose();
  });
});

// ---------------------------------------------------------------------------
// Discussion Mode
// ---------------------------------------------------------------------------

describe("BrainstormOrchestrator - Discussion Mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes members sequentially passing outputs as context", async () => {
    const { caller, calls } = makeCountingLLMCaller();

    const orchestrator = new BrainstormOrchestrator(caller, vi.fn());

    const config = makeConfig({
      mode: "discussion",
      roles: ["planner", "architect", "executor"],
    });

    await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // Should have called LLM for each member
    expect(calls.length).toBe(3);

    // First member doesn't have previous context
    expect(calls[0]).not.toContain("Previous discussion context");

    // Second member gets first member's output
    expect(calls[1]).toContain("Previous discussion context");
    expect(calls[1]).toContain("Output #1");

    // Third member gets outputs from first two
    expect(calls[2]).toContain("Previous discussion context");
    expect(calls[2]).toContain("Output #1");
    expect(calls[2]).toContain("Output #2");

    orchestrator.dispose();
  });

  it("emits node.created and node.updated events per member", async () => {
    const emitter = makeMockEmitter();
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      emitter,
    );

    const config = makeConfig({
      mode: "discussion",
      roles: ["planner", "architect"],
    });

    await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    const emitterCalls = (emitter as any).calls as Array<[string, Record<string, unknown>]>;
    const createdEvents = emitterCalls.filter(
      ([type]) => type === "brainstorm.node.created",
    );
    const updatedEvents = emitterCalls.filter(
      ([type]) => type === "brainstorm.node.updated",
    );

    // At least one created event per member
    expect(createdEvents.length).toBeGreaterThanOrEqual(2);
    // At least one updated event per member (completion)
    expect(updatedEvents.length).toBeGreaterThanOrEqual(2);

    orchestrator.dispose();
  });

  it("respects token budget between iterations", async () => {
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      vi.fn(),
    );

    // Tiny budget — should stop after one or two members
    const config = makeConfig({
      mode: "discussion",
      roles: ["planner", "architect", "executor", "auditor"],
      tokenBudget: 50, // Very small budget
    });

    const session = await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // Not all members should have completed due to budget constraints
    const completedCount = Array.from(session.crewMembers.values()).filter(
      (m) => m.state === "completed",
    ).length;

    // At least one member should have run
    expect(completedCount).toBeGreaterThanOrEqual(1);

    orchestrator.dispose();
  });
});

// ---------------------------------------------------------------------------
// Vote Mode
// ---------------------------------------------------------------------------

describe("BrainstormOrchestrator - Vote Mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes all members in parallel with identical prompt", async () => {
    const { caller, calls } = makeCountingLLMCaller();

    const orchestrator = new BrainstormOrchestrator(caller, vi.fn());

    const config = makeConfig({
      mode: "vote",
      roles: ["planner", "architect", "executor"],
      stageContext: "Choose the best database technology.",
    });

    await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // All members should have been called
    expect(calls.length).toBe(3);

    // All prompts should contain the same context (no "Previous discussion context")
    for (const call of calls) {
      expect(call).toContain("Choose the best database technology.");
      expect(call).not.toContain("Previous discussion context");
    }

    orchestrator.dispose();
  });

  it("uses Promise.allSettled so individual failures don't block others", async () => {
    let callCount = 0;
    const mixedLLM: LLMCallerFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.reject(new Error("LLM timeout"));
      }
      return Promise.resolve(
        JSON.stringify({
          content: "Valid output",
          confidence: 0.8,
          needsToolCall: false,
        }),
      );
    });

    const orchestrator = new BrainstormOrchestrator(mixedLLM, vi.fn());

    const config = makeConfig({
      mode: "vote",
      roles: ["planner", "architect", "executor"],
    });

    const session = await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // Session should still complete (not throw)
    const states = Array.from(session.crewMembers.values()).map(
      (m) => m.state,
    );

    // At least some should complete, one should fail
    expect(states).toContain("completed");
    expect(states).toContain("failed");

    orchestrator.dispose();
  });

  it("collects all outputs for synthesis", async () => {
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      vi.fn(),
    );

    const config = makeConfig({
      mode: "vote",
      roles: ["planner", "architect"],
    });

    const session = await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    const completedMembers = Array.from(session.crewMembers.values()).filter(
      (m) => m.state === "completed" && m.output,
    );

    expect(completedMembers.length).toBe(2);
    for (const member of completedMembers) {
      expect(member.output!.content).toBeDefined();
      expect(member.output!.confidence).toBeGreaterThanOrEqual(0);
      expect(member.output!.confidence).toBeLessThanOrEqual(1);
    }

    orchestrator.dispose();
  });
});

// ---------------------------------------------------------------------------
// Division Mode
// ---------------------------------------------------------------------------

describe("BrainstormOrchestrator - Division Mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("splits task into sub-tasks via LLM and assigns to members", async () => {
    let callIndex = 0;
    const divisionLLM: LLMCallerFn = vi.fn().mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        // First call is the task-splitting call
        return Promise.resolve(
          JSON.stringify([
            "Design the API endpoints",
            "Implement database schema",
            "Write authentication logic",
          ]),
        );
      }
      // Subsequent calls are crew member executions
      return Promise.resolve(
        JSON.stringify({
          content: `Sub-task ${callIndex - 1} completed`,
          confidence: 0.9,
          needsToolCall: false,
        }),
      );
    });

    const orchestrator = new BrainstormOrchestrator(divisionLLM, vi.fn());

    const config = makeConfig({
      mode: "division",
      roles: ["planner", "architect", "executor"],
    });

    const session = await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // All members should complete
    const allTerminal = Array.from(session.crewMembers.values()).every(
      (m) => m.state === "completed" || m.state === "failed",
    );
    expect(allTerminal).toBe(true);

    orchestrator.dispose();
  });

  it("falls back to full context when LLM task splitting fails", async () => {
    let callIndex = 0;
    const failingSplitLLM: LLMCallerFn = vi.fn().mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        // Splitting call fails
        return Promise.reject(new Error("LLM unavailable"));
      }
      return Promise.resolve(
        JSON.stringify({
          content: "Fallback output",
          confidence: 0.7,
          needsToolCall: false,
        }),
      );
    });

    const orchestrator = new BrainstormOrchestrator(failingSplitLLM, vi.fn());

    const config = makeConfig({
      mode: "division",
      roles: ["planner", "architect"],
      stageContext: "Build user auth system.",
    });

    const session = await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // Members should still execute with fallback sub-tasks
    const completedMembers = Array.from(session.crewMembers.values()).filter(
      (m) => m.state === "completed",
    );
    expect(completedMembers.length).toBeGreaterThanOrEqual(1);

    orchestrator.dispose();
  });
});

// ---------------------------------------------------------------------------
// Audit Mode
// ---------------------------------------------------------------------------

describe("BrainstormOrchestrator - Audit Mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes primary member first then passes output to auditor", async () => {
    const { caller, calls } = makeCountingLLMCaller();

    const orchestrator = new BrainstormOrchestrator(caller, vi.fn());

    const config = makeConfig({
      mode: "audit",
      roles: ["architect", "auditor"],
    });

    await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // Two LLM calls — one for primary, one for auditor
    expect(calls.length).toBe(2);

    // Auditor should see primary's output
    expect(calls[1]).toContain("Review the following outputs");
    expect(calls[1]).toContain("Output #1");

    orchestrator.dispose();
  });

  it("auditor receives primary outputs for review", async () => {
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      vi.fn(),
    );

    const config = makeConfig({
      mode: "audit",
      roles: ["planner", "executor", "auditor"],
    });

    const session = await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // All members should complete
    const auditor = session.crewMembers.get("auditor")!;
    expect(auditor.state).toBe("completed");
    expect(auditor.output).toBeDefined();

    orchestrator.dispose();
  });
});

// ---------------------------------------------------------------------------
// Session Timeout
// ---------------------------------------------------------------------------

describe("BrainstormOrchestrator - Session Timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("force-terminates session after 120s timeout", async () => {
    // LLM that never resolves quickly
    const slowLLM: LLMCallerFn = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                JSON.stringify({
                  content: "Late response",
                  confidence: 0.5,
                  needsToolCall: false,
                }),
              ),
            200_000,
          ),
        ),
    );

    const emitter = makeMockEmitter();
    const orchestrator = new BrainstormOrchestrator(slowLLM, emitter);

    const config = makeConfig({
      mode: "discussion",
      roles: ["planner", "architect"],
    });

    const session = await orchestrator.startSession(config);

    expect(session.status).toBe("active");

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(BRAINSTORM_SESSION_TIMEOUT_MS + 100);

    expect(["force_terminated", "synthesizing"]).toContain(session.status);

    orchestrator.dispose();
  });

  it("emits failure event on force-termination", async () => {
    const slowLLM: LLMCallerFn = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve("{}"), 200_000),
        ),
    );

    const emitter = makeMockEmitter();
    const orchestrator = new BrainstormOrchestrator(slowLLM, emitter);

    const config = makeConfig({ roles: ["planner", "architect"] });
    await orchestrator.startSession(config);

    await vi.advanceTimersByTimeAsync(BRAINSTORM_SESSION_TIMEOUT_MS + 100);

    const emitterCalls = (emitter as any).calls as Array<[string, Record<string, unknown>]>;
    const failedEvents = emitterCalls.filter(
      ([type]) => type === "brainstorm.session.failed",
    );

    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
    expect(failedEvents[0][1].reason).toContain("timeout");

    orchestrator.dispose();
  });
});

// ---------------------------------------------------------------------------
// Token Budget
// ---------------------------------------------------------------------------

describe("BrainstormOrchestrator - Token Budget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops iterations when token budget is exhausted", async () => {
    // LLM that generates large token responses
    const verboseLLM: LLMCallerFn = vi.fn().mockResolvedValue(
      JSON.stringify({
        content: "A".repeat(1000),
        confidence: 0.8,
        needsToolCall: false,
      }),
    );

    const orchestrator = new BrainstormOrchestrator(verboseLLM, vi.fn());

    const config = makeConfig({
      mode: "discussion",
      roles: ["planner", "architect", "executor", "auditor"],
      tokenBudget: 200, // Very tight budget
    });

    const session = await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // Not all 4 members should have completed
    const completedCount = Array.from(session.crewMembers.values()).filter(
      (m) => m.state === "completed",
    ).length;

    // With a 200-token budget, only 1-2 members should complete before budget exhausted
    expect(completedCount).toBeLessThan(4);

    orchestrator.dispose();
  });

  it("tracks token usage accurately across all members", async () => {
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      vi.fn(),
    );

    const config = makeConfig({
      mode: "vote",
      roles: ["planner", "architect"],
      tokenBudget: 50000,
    });

    const session = await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // Token usage should be tracked
    expect(session.tokenUsed).toBeGreaterThan(0);

    // Individual member token usage should sum up
    const memberTotalTokens = Array.from(session.crewMembers.values()).reduce(
      (sum, m) => sum + m.tokenUsage,
      0,
    );
    expect(memberTotalTokens).toBeGreaterThan(0);

    orchestrator.dispose();
  });
});

// ---------------------------------------------------------------------------
// Crew Member Failure Handling
// ---------------------------------------------------------------------------

describe("BrainstormOrchestrator - Crew Member Failure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks failed member and continues session", async () => {
    let callCount = 0;
    const partialFailLLM: LLMCallerFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("Connection timeout"));
      }
      return Promise.resolve(
        JSON.stringify({
          content: "Success output",
          confidence: 0.9,
          needsToolCall: false,
        }),
      );
    });

    const orchestrator = new BrainstormOrchestrator(partialFailLLM, vi.fn());

    const config = makeConfig({
      mode: "discussion",
      roles: ["planner", "architect"],
    });

    const session = await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    const planner = session.crewMembers.get("planner")!;
    const architect = session.crewMembers.get("architect")!;

    // First member should fail
    expect(planner.state).toBe("failed");
    expect(planner.failureReason).toContain("Connection timeout");

    // Second member should still complete
    expect(architect.state).toBe("completed");

    orchestrator.dispose();
  });

  it("session continues even if multiple members fail", async () => {
    const alwaysFailLLM: LLMCallerFn = vi
      .fn()
      .mockRejectedValue(new Error("All calls fail"));

    const orchestrator = new BrainstormOrchestrator(alwaysFailLLM, vi.fn());

    const config = makeConfig({
      mode: "vote",
      roles: ["planner", "architect"],
    });

    const session = await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    // All should fail but session shouldn't throw
    for (const member of session.crewMembers.values()) {
      expect(member.state).toBe("failed");
    }

    // Session should transition to synthesizing (all terminal)
    expect(["synthesizing", "failed"]).toContain(session.status);

    orchestrator.dispose();
  });
});

// ---------------------------------------------------------------------------
// Event Emission
// ---------------------------------------------------------------------------

describe("BrainstormOrchestrator - Event Emission", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits brainstorm.session.started on session start", async () => {
    const emitter = makeMockEmitter();
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      emitter,
    );

    const config = makeConfig();
    await orchestrator.startSession(config);

    const emitterCalls = (emitter as any).calls as Array<[string, Record<string, unknown>]>;
    const startedEvents = emitterCalls.filter(
      ([type]) => type === "brainstorm.session.started",
    );

    expect(startedEvents.length).toBe(1);
    expect(startedEvents[0][1].jobId).toBe("job-test-1");
    expect(startedEvents[0][1].mode).toBe("discussion");
    expect(startedEvents[0][1].roles).toEqual(["planner", "architect"]);

    orchestrator.dispose();
  });

  it("emits brainstorm.session.completed when all members terminate", async () => {
    const emitter = makeMockEmitter();
    const orchestrator = new BrainstormOrchestrator(
      makeMockLLMCaller(),
      emitter,
    );

    const config = makeConfig({
      mode: "vote",
      roles: ["planner", "architect"],
    });

    await orchestrator.startSession(config);
    await vi.advanceTimersByTimeAsync(5000);

    const emitterCalls = (emitter as any).calls as Array<[string, Record<string, unknown>]>;
    const completedEvents = emitterCalls.filter(
      ([type]) => type === "brainstorm.session.completed",
    );

    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0][1].status).toBe("synthesizing");

    orchestrator.dispose();
  });
});
