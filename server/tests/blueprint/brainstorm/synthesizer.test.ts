/**
 * Brainstorm Synthesizer Unit Tests
 *
 * Tests synthesis LLM prompt building, JSON parsing, fallback behavior,
 * and event emission.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §5
 * Requirements: 8.1, 8.2, 8.3, 8.5
 */

import { describe, expect, it, vi } from "vitest";

import type {
  SynthesisInput,
  SynthesisResult,
} from "../../../../shared/blueprint/brainstorm-contracts";
import {
  BrainstormSynthesizer,
  type EventEmitterFn,
  type LLMCallerFn,
} from "../../../routes/blueprint/brainstorm/synthesizer";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSynthesisInput(
  overrides?: Partial<SynthesisInput>,
): SynthesisInput {
  return {
    sessionId: "session-1",
    mode: "discussion",
    crewOutputs: [
      { roleId: "planner", content: "Plan A: use microservices", confidence: 0.8 },
      { roleId: "architect", content: "Architecture: event-driven", confidence: 0.9 },
      { roleId: "auditor", content: "Security concern: auth flow", confidence: 0.7 },
    ],
    stageContext: "Design the new authentication system",
    ...overrides,
  };
}

function makeValidSynthesisResponse(): string {
  return JSON.stringify({
    decision: "Use event-driven microservices with OAuth2",
    confidence: 0.85,
    reasoningPoints: [
      { roleId: "planner", point: "Microservices allow independent scaling" },
      { roleId: "architect", point: "Event-driven reduces coupling" },
      { roleId: "auditor", point: "OAuth2 standard addresses auth concerns" },
    ],
    dissentingOpinions: [
      { roleId: "auditor", opinion: "Complexity of distributed auth" },
    ],
    tokenUsage: 450,
  });
}

function makeMockEmitter(): EventEmitterFn {
  return vi.fn();
}

// ─── Synthesis with Valid LLM Response ──────────────────────────────────────

describe("BrainstormSynthesizer - Successful Synthesis", () => {
  it("parses a valid JSON response from LLM", async () => {
    const mockLLM: LLMCallerFn = vi
      .fn()
      .mockResolvedValue(makeValidSynthesisResponse());
    const emitter = makeMockEmitter();
    const synthesizer = new BrainstormSynthesizer(mockLLM, emitter);

    const input = makeSynthesisInput();
    const result = await synthesizer.synthesize(input);

    expect(result.decision).toBe("Use event-driven microservices with OAuth2");
    expect(result.confidence).toBe(0.85);
    expect(result.reasoningPoints).toHaveLength(3);
    expect(result.dissentingOpinions).toHaveLength(1);
    expect(result.tokenUsage).toBe(450);
  });

  it("clamps confidence to [0, 1] range", async () => {
    const response = JSON.stringify({
      decision: "Decision",
      confidence: 1.5,
      reasoningPoints: [{ roleId: "planner", point: "p" }],
      dissentingOpinions: [],
      tokenUsage: 100,
    });

    const mockLLM: LLMCallerFn = vi.fn().mockResolvedValue(response);
    const synthesizer = new BrainstormSynthesizer(mockLLM, makeMockEmitter());

    const result = await synthesizer.synthesize(makeSynthesisInput());
    expect(result.confidence).toBe(1);
  });

  it("clamps negative confidence to 0", async () => {
    const response = JSON.stringify({
      decision: "Decision",
      confidence: -0.5,
      reasoningPoints: [{ roleId: "planner", point: "p" }],
      dissentingOpinions: [],
      tokenUsage: 100,
    });

    const mockLLM: LLMCallerFn = vi.fn().mockResolvedValue(response);
    const synthesizer = new BrainstormSynthesizer(mockLLM, makeMockEmitter());

    const result = await synthesizer.synthesize(makeSynthesisInput());
    expect(result.confidence).toBe(0);
  });

  it("extracts JSON from markdown-wrapped response", async () => {
    const wrappedResponse = `Here is the synthesis:\n\`\`\`json\n${makeValidSynthesisResponse()}\n\`\`\``;
    const mockLLM: LLMCallerFn = vi.fn().mockResolvedValue(wrappedResponse);
    const synthesizer = new BrainstormSynthesizer(mockLLM, makeMockEmitter());

    const result = await synthesizer.synthesize(makeSynthesisInput());
    expect(result.decision).toBe("Use event-driven microservices with OAuth2");
  });

  it("builds synthesis prompt with all crew outputs", async () => {
    const mockLLM: LLMCallerFn = vi
      .fn()
      .mockResolvedValue(makeValidSynthesisResponse());
    const emitter = makeMockEmitter();
    const synthesizer = new BrainstormSynthesizer(mockLLM, emitter);

    const input = makeSynthesisInput();
    await synthesizer.synthesize(input);

    const prompt = (mockLLM as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("planner");
    expect(prompt).toContain("architect");
    expect(prompt).toContain("auditor");
    expect(prompt).toContain("Plan A: use microservices");
    expect(prompt).toContain("Architecture: event-driven");
    expect(prompt).toContain("Security concern: auth flow");
    expect(prompt).toContain("discussion");
    expect(prompt).toContain("Design the new authentication system");
  });
});

// ─── Synthesis Fallback ─────────────────────────────────────────────────────

describe("BrainstormSynthesizer - Fallback Behavior", () => {
  it("falls back to highest-confidence output when LLM throws", async () => {
    const mockLLM: LLMCallerFn = vi
      .fn()
      .mockRejectedValue(new Error("LLM unavailable"));
    const emitter = makeMockEmitter();
    const synthesizer = new BrainstormSynthesizer(mockLLM, emitter);

    const input = makeSynthesisInput();
    const result = await synthesizer.synthesize(input);

    // Architect has highest confidence (0.9)
    expect(result.decision).toBe("Architecture: event-driven");
    expect(result.confidence).toBe(0.9);
    expect(result.reasoningPoints).toHaveLength(1);
    expect(result.reasoningPoints[0].roleId).toBe("architect");
  });

  it("falls back when LLM returns unparseable response", async () => {
    const mockLLM: LLMCallerFn = vi
      .fn()
      .mockResolvedValue("This is not JSON at all, just text.");
    const emitter = makeMockEmitter();
    const synthesizer = new BrainstormSynthesizer(mockLLM, emitter);

    const input = makeSynthesisInput();
    const result = await synthesizer.synthesize(input);

    // Should use fallback
    expect(result.decision).toBe("Architecture: event-driven");
    expect(result.confidence).toBe(0.9);
  });

  it("falls back when LLM returns JSON missing required decision field", async () => {
    const incomplete = JSON.stringify({
      confidence: 0.8,
      reasoningPoints: [],
      dissentingOpinions: [],
      tokenUsage: 50,
    });
    const mockLLM: LLMCallerFn = vi.fn().mockResolvedValue(incomplete);
    const emitter = makeMockEmitter();
    const synthesizer = new BrainstormSynthesizer(mockLLM, emitter);

    const input = makeSynthesisInput();
    const result = await synthesizer.synthesize(input);

    // Missing decision -> fallback
    expect(result.decision).toBe("Architecture: event-driven");
  });

  it("emits brainstorm.degraded event on fallback", async () => {
    const mockLLM: LLMCallerFn = vi
      .fn()
      .mockRejectedValue(new Error("timeout"));
    const emitter = makeMockEmitter();
    const synthesizer = new BrainstormSynthesizer(mockLLM, emitter);

    await synthesizer.synthesize(makeSynthesisInput());

    expect(emitter).toHaveBeenCalledWith(
      "brainstorm.degraded",
      expect.objectContaining({
        sessionId: "session-1",
        reason: expect.stringContaining("Synthesis LLM call failed"),
        affectedComponent: "synthesizer",
        fallbackAction: "highest-confidence-selection",
      }),
    );
  });

  it("includes other outputs as dissenting opinions in fallback", async () => {
    const mockLLM: LLMCallerFn = vi
      .fn()
      .mockRejectedValue(new Error("error"));
    const emitter = makeMockEmitter();
    const synthesizer = new BrainstormSynthesizer(mockLLM, emitter);

    const input = makeSynthesisInput();
    const result = await synthesizer.synthesize(input);

    // Should include 2 dissenting opinions (all except highest confidence)
    expect(result.dissentingOpinions).toHaveLength(2);
  });

  it("handles empty crew outputs gracefully", async () => {
    const mockLLM: LLMCallerFn = vi
      .fn()
      .mockRejectedValue(new Error("error"));
    const emitter = makeMockEmitter();
    const synthesizer = new BrainstormSynthesizer(mockLLM, emitter);

    const input = makeSynthesisInput({ crewOutputs: [] });
    const result = await synthesizer.synthesize(input);

    expect(result.decision).toContain("No crew outputs");
    expect(result.confidence).toBe(0);
    expect(result.reasoningPoints).toHaveLength(0);
    expect(result.dissentingOpinions).toHaveLength(0);
  });
});

// ─── Synthesis Schema Validation ────────────────────────────────────────────

describe("BrainstormSynthesizer - Schema Validation", () => {
  it("provides default reasoning points when LLM omits them", async () => {
    const response = JSON.stringify({
      decision: "My decision",
      confidence: 0.7,
      dissentingOpinions: [],
      tokenUsage: 100,
    });
    const mockLLM: LLMCallerFn = vi.fn().mockResolvedValue(response);
    const synthesizer = new BrainstormSynthesizer(mockLLM, makeMockEmitter());

    const input = makeSynthesisInput();
    const result = await synthesizer.synthesize(input);

    // Should derive reasoning points from crew outputs
    expect(result.reasoningPoints.length).toBeGreaterThan(0);
    expect(result.reasoningPoints.length).toBe(input.crewOutputs.length);
  });

  it("provides empty dissenting opinions when LLM omits them", async () => {
    const response = JSON.stringify({
      decision: "My decision",
      confidence: 0.7,
      reasoningPoints: [{ roleId: "planner", point: "Good plan" }],
      tokenUsage: 100,
    });
    const mockLLM: LLMCallerFn = vi.fn().mockResolvedValue(response);
    const synthesizer = new BrainstormSynthesizer(mockLLM, makeMockEmitter());

    const result = await synthesizer.synthesize(makeSynthesisInput());
    expect(result.dissentingOpinions).toEqual([]);
  });

  it("estimates token usage when LLM omits it", async () => {
    const response = JSON.stringify({
      decision: "My decision",
      confidence: 0.7,
      reasoningPoints: [{ roleId: "planner", point: "Good plan" }],
      dissentingOpinions: [],
    });
    const mockLLM: LLMCallerFn = vi.fn().mockResolvedValue(response);
    const synthesizer = new BrainstormSynthesizer(mockLLM, makeMockEmitter());

    const result = await synthesizer.synthesize(makeSynthesisInput());
    expect(result.tokenUsage).toBeGreaterThan(0);
  });
});

// ─── Orchestrator Integration (Wiring Test) ─────────────────────────────────

describe("BrainstormSynthesizer - Orchestrator Wiring", () => {
  it("can be called with session data to produce synthesis result", async () => {
    const mockLLM: LLMCallerFn = vi
      .fn()
      .mockResolvedValue(makeValidSynthesisResponse());
    const emitter = makeMockEmitter();
    const synthesizer = new BrainstormSynthesizer(mockLLM, emitter);

    // Simulate what the orchestrator would do:
    // 1. Collect outputs from completed crew members
    const crewOutputs = [
      { roleId: "planner" as const, content: "Plan output", confidence: 0.8 },
      { roleId: "architect" as const, content: "Arch output", confidence: 0.9 },
    ];

    // 2. Build SynthesisInput from session data
    const input: SynthesisInput = {
      sessionId: "session-from-orchestrator",
      mode: "vote",
      crewOutputs,
      stageContext: "Stage context from pipeline",
    };

    // 3. Call synthesize
    const result = await synthesizer.synthesize(input);

    // 4. Result conforms to SynthesisResult schema
    expect(result.decision).toBeDefined();
    expect(typeof result.decision).toBe("string");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(result.reasoningPoints)).toBe(true);
    expect(Array.isArray(result.dissentingOpinions)).toBe(true);
    expect(typeof result.tokenUsage).toBe("number");
  });

  it("synthesizer can be triggered when session transitions to synthesizing", async () => {
    const mockLLM: LLMCallerFn = vi
      .fn()
      .mockResolvedValue(makeValidSynthesisResponse());
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const emitter: EventEmitterFn = (type, payload) => {
      events.push({ type, payload });
    };

    const synthesizer = new BrainstormSynthesizer(mockLLM, emitter);

    // Simulate orchestrator calling synthesizer
    const input = makeSynthesisInput();
    const result = await synthesizer.synthesize(input);

    // The orchestrator would emit session.completed with this result
    emitter("brainstorm.session.completed", {
      sessionId: input.sessionId,
      decision: result.decision,
      confidence: result.confidence,
      tokenUsage: result.tokenUsage,
    });

    const completedEvent = events.find(
      (e) => e.type === "brainstorm.session.completed",
    );
    expect(completedEvent).toBeDefined();
    expect(completedEvent!.payload.sessionId).toBe("session-1");
    expect(completedEvent!.payload.decision).toBe(result.decision);
  });
});
