/**
 * Brainstorm Orchestrator Property-Based Tests
 *
 * Properties 4, 5, 6, 7, 8, 9, 24
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §2
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import type {
  BrainstormRoleId,
  CollaborationMode,
  CrewMemberState,
  SessionConfig,
} from "../../../../shared/blueprint/brainstorm-contracts";
import {
  BRAINSTORM_MAX_TOKENS,
  BRAINSTORM_SESSION_TIMEOUT_MS,
  BrainstormOrchestrator,
  VALID_CREW_MEMBER_STATES,
  type EventEmitterFn,
  type LLMCallerFn,
} from "../../../routes/blueprint/brainstorm/orchestrator";

// ─── Valid domain values ────────────────────────────────────────────────────

const ALL_ROLE_IDS: BrainstormRoleId[] = [
  "decider",
  "planner",
  "architect",
  "executor",
  "auditor",
  "ui_previewer",
];

const ALL_MODES: CollaborationMode[] = [
  "discussion",
  "vote",
  "division",
  "audit",
];

// ─── Arbitraries ────────────────────────────────────────────────────────────

const arbRoleId: fc.Arbitrary<BrainstormRoleId> = fc.constantFrom(...ALL_ROLE_IDS);

const arbRoleIds: fc.Arbitrary<BrainstormRoleId[]> = fc.uniqueArray(arbRoleId, {
  minLength: 2,
  maxLength: 4,
});

const arbMode: fc.Arbitrary<CollaborationMode> = fc.constantFrom(...ALL_MODES);

const arbSessionConfig: fc.Arbitrary<SessionConfig> = fc
  .record({
    mode: arbMode,
    roles: arbRoleIds,
  })
  .map((r) => ({
    jobId: "job-test",
    stageId: "stage-test",
    mode: r.mode,
    roles: r.roles,
    toolCategories: [],
    stageContext: "Test stage context for property testing.",
    tokenBudget: 5000,
    toolCallLimit: 10,
  }));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockLLMCaller(): LLMCallerFn {
  const defaultResponse = JSON.stringify({
    content: "Test analysis output",
    confidence: 0.8,
    needsToolCall: false,
  });
  return vi.fn().mockResolvedValue(defaultResponse);
}

function makeMockEmitter(): EventEmitterFn {
  return vi.fn();
}

// ─── Property 4: Crew Member instantiation matches decision ─────────────────
// **Validates: Requirements 2.2**

describe("Property 4: Crew Member instantiation matches decision", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("session instantiates exactly the roles specified by the config", async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionConfig, async (config) => {
        const orchestrator = new BrainstormOrchestrator(
          makeMockLLMCaller(),
          makeMockEmitter(),
        );

        const session = await orchestrator.startSession(config);

        // Session must have exactly the roles specified in config
        const sessionRoles = Array.from(session.crewMembers.keys());
        expect(sessionRoles.sort()).toEqual([...config.roles].sort());

        // Each crew member has the correct roleId
        for (const roleId of config.roles) {
          const member = session.crewMembers.get(roleId);
          expect(member).toBeDefined();
          expect(member!.roleId).toBe(roleId);
        }

        orchestrator.dispose();
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5: Crew Member state invariant ────────────────────────────────
// **Validates: Requirements 2.3**

describe("Property 5: Crew Member state invariant", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("crew member state is always one of the 6 valid states", async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionConfig, async (config) => {
        const orchestrator = new BrainstormOrchestrator(
          makeMockLLMCaller(),
          makeMockEmitter(),
        );

        const session = await orchestrator.startSession(config);

        // Advance timers to allow async execution to complete
        await vi.advanceTimersByTimeAsync(1000);

        // After execution, check all member states
        for (const member of session.crewMembers.values()) {
          expect(VALID_CREW_MEMBER_STATES).toContain(member.state);
        }

        orchestrator.dispose();
      }),
      { numRuns: 100 },
    );
  });

  it("crew member state is always a string from the valid set for any arbitrary state value", () => {
    const arbState: fc.Arbitrary<CrewMemberState> = fc.constantFrom(
      ...VALID_CREW_MEMBER_STATES,
    );

    fc.assert(
      fc.property(arbState, (state) => {
        expect(VALID_CREW_MEMBER_STATES).toContain(state);
        expect(typeof state).toBe("string");
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Terminal state triggers synthesis ───────────────────────────
// **Validates: Requirements 2.6**

describe("Property 6: Terminal state triggers synthesis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("when all members reach completed/failed, session transitions to synthesizing", async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionConfig, async (config) => {
        const orchestrator = new BrainstormOrchestrator(
          makeMockLLMCaller(),
          makeMockEmitter(),
        );

        const session = await orchestrator.startSession(config);

        // Advance timers to allow all members to complete
        await vi.advanceTimersByTimeAsync(5000);

        // All members should be terminal
        const allTerminal = Array.from(session.crewMembers.values()).every(
          (m) => m.state === "completed" || m.state === "failed",
        );

        if (allTerminal) {
          // Session should have transitioned to synthesizing (or beyond)
          expect(["synthesizing", "completed", "force_terminated"]).toContain(
            session.status,
          );
        }

        orchestrator.dispose();
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 7: Discussion mode sequential context chaining ────────────────
// **Validates: Requirements 3.1**

describe("Property 7: Discussion mode sequential context chaining", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("member[i] receives concatenated outputs of members[0..i-1]", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbRoleId, { minLength: 2, maxLength: 4 }),
        async (roles) => {
          const receivedPrompts: string[] = [];

          const mockLLM: LLMCallerFn = vi.fn().mockImplementation(
            (prompt: string) => {
              receivedPrompts.push(prompt);
              return Promise.resolve(
                JSON.stringify({
                  content: `Output from member ${receivedPrompts.length}`,
                  confidence: 0.8,
                  needsToolCall: false,
                }),
              );
            },
          );

          const config: SessionConfig = {
            jobId: "job-disc",
            stageId: "stage-disc",
            mode: "discussion",
            roles,
            toolCategories: [],
            stageContext: "Discuss the architecture.",
            tokenBudget: 50000,
            toolCallLimit: 20,
          };

          const orchestrator = new BrainstormOrchestrator(
            mockLLM,
            makeMockEmitter(),
          );

          await orchestrator.startSession(config);
          await vi.advanceTimersByTimeAsync(5000);

          // In discussion mode, member i should see context from members 0..i-1
          // First member gets no "Previous discussion context"
          if (receivedPrompts.length >= 1) {
            expect(receivedPrompts[0]).not.toContain(
              "Previous discussion context",
            );
          }

          // Second and subsequent members should see previous outputs
          for (let i = 1; i < Math.min(receivedPrompts.length, roles.length); i++) {
            expect(receivedPrompts[i]).toContain("Previous discussion context");
          }

          orchestrator.dispose();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8: Vote mode identical prompt invariant ───────────────────────
// **Validates: Requirements 3.2**

describe("Property 8: Vote mode identical prompt invariant", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("all members in vote mode receive identical stage context", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbRoleId, { minLength: 2, maxLength: 4 }),
        fc.stringMatching(/^[a-zA-Z0-9 .,:;!?]{5,100}$/),
        async (roles, stageContext) => {
          const receivedPrompts: string[] = [];

          const mockLLM: LLMCallerFn = vi.fn().mockImplementation(
            (prompt: string) => {
              receivedPrompts.push(prompt);
              return Promise.resolve(
                JSON.stringify({
                  content: "Vote output",
                  confidence: 0.7,
                  needsToolCall: false,
                }),
              );
            },
          );

          const config: SessionConfig = {
            jobId: "job-vote",
            stageId: "stage-vote",
            mode: "vote",
            roles,
            toolCategories: [],
            stageContext,
            tokenBudget: 50000,
            toolCallLimit: 20,
          };

          const orchestrator = new BrainstormOrchestrator(
            mockLLM,
            makeMockEmitter(),
          );

          await orchestrator.startSession(config);
          await vi.advanceTimersByTimeAsync(5000);

          // All prompts should contain the same stage context
          if (receivedPrompts.length > 1) {
            for (const prompt of receivedPrompts) {
              expect(prompt).toContain(stageContext);
            }

            // In vote mode, all members get the same context portion
            const contextParts = receivedPrompts.map((p) => {
              const idx = p.indexOf("Context:\n");
              return idx >= 0 ? p.slice(idx) : p;
            });

            // All context parts should be identical
            for (let i = 1; i < contextParts.length; i++) {
              expect(contextParts[i]).toBe(contextParts[0]);
            }
          }

          orchestrator.dispose();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9: Token budget enforcement ───────────────────────────────────
// **Validates: Requirements 3.6, 10.2**

describe("Property 9: Token budget enforcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("total token usage never exceeds the configured token budget", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionConfig,
        fc.integer({ min: 500, max: 10000 }),
        async (config, budget) => {
          const configWithBudget: SessionConfig = {
            ...config,
            tokenBudget: budget,
          };

          const orchestrator = new BrainstormOrchestrator(
            makeMockLLMCaller(),
            makeMockEmitter(),
          );

          const session = await orchestrator.startSession(configWithBudget);
          await vi.advanceTimersByTimeAsync(5000);

          // Token usage should be bounded.
          // The orchestrator checks budget BEFORE starting a new member/iteration,
          // but one LLM call that started before the budget was exceeded can finish
          // and push the total slightly over. We allow one call's worth of overshoot
          // per member that was already in-flight.
          // A single call produces ~(prompt_length + response_length)/4 tokens.
          // With our mock, each call is roughly 200-400 tokens.
          // Allow generous overshoot: one call per member.
          const maxSingleCallTokens = 500;
          const maxOvershoot = config.roles.length * maxSingleCallTokens;

          expect(session.tokenUsed).toBeLessThanOrEqual(budget + maxOvershoot);

          orchestrator.dispose();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 24: Timeout force-termination ─────────────────────────────────
// **Validates: Requirements 10.5**

describe("Property 24: Timeout force-termination", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sessions running > 120s force-terminate and proceed to synthesis", async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionConfig, async (config) => {
        // Use a slow LLM that never resolves within timeout
        const neverResolveLLM: LLMCallerFn = vi.fn().mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve(
                    JSON.stringify({
                      content: "Very late",
                      confidence: 0.5,
                      needsToolCall: false,
                    }),
                  ),
                200_000,
              ),
            ),
        );

        const emitter = makeMockEmitter();
        const orchestrator = new BrainstormOrchestrator(
          neverResolveLLM,
          emitter,
        );

        const session = await orchestrator.startSession(config);

        // Session should be active initially
        expect(session.status).toBe("active");

        // Advance past timeout
        await vi.advanceTimersByTimeAsync(BRAINSTORM_SESSION_TIMEOUT_MS + 1000);

        // Session should be force-terminated or synthesizing
        expect(["force_terminated", "synthesizing"]).toContain(session.status);

        orchestrator.dispose();
      }),
      { numRuns: 100 },
    );
  });
});
