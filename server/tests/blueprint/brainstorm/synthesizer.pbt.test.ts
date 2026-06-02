/**
 * Brainstorm Synthesizer Property-Based Tests
 *
 * Properties 20, 21, 23
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §5
 */

import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import type {
  BrainstormRoleId,
  CollaborationMode,
  SynthesisInput,
  SynthesisResult,
} from "../../../../shared/blueprint/brainstorm-contracts";
import {
  BrainstormSynthesizer,
  type EventEmitterFn,
  type LLMCallerFn,
} from "../../../routes/blueprint/brainstorm/synthesizer";

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

const arbMode: fc.Arbitrary<CollaborationMode> = fc.constantFrom(...ALL_MODES);

const arbCrewOutput = fc.record({
  roleId: arbRoleId,
  content: fc.string({ minLength: 1, maxLength: 200 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
});

const arbCrewOutputs = fc.array(arbCrewOutput, { minLength: 1, maxLength: 6 });

const arbSynthesisInput: fc.Arbitrary<SynthesisInput> = fc
  .record({
    mode: arbMode,
    crewOutputs: arbCrewOutputs,
    stageContext: fc.string({ minLength: 5, maxLength: 200 }),
  })
  .map((r) => ({
    sessionId: "pbt-session",
    mode: r.mode,
    crewOutputs: r.crewOutputs,
    stageContext: r.stageContext,
  }));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockEmitter(): EventEmitterFn {
  return vi.fn();
}

function makeSuccessfulLLM(input: SynthesisInput): LLMCallerFn {
  return vi.fn().mockImplementation((prompt: string) => {
    // Generate a valid synthesis response based on the input
    const result: SynthesisResult = {
      decision: "Synthesized decision from all outputs",
      confidence: 0.8,
      reasoningPoints: input.crewOutputs.map((o) => ({
        roleId: o.roleId,
        point: `Reasoning from ${o.roleId}: ${o.content.slice(0, 50)}`,
      })),
      dissentingOpinions: [],
      tokenUsage: Math.ceil(prompt.length / 4),
    };
    return Promise.resolve(JSON.stringify(result));
  });
}

// ─── Property 20: Synthesis receives all crew outputs ───────────────────────
// **Validates: Requirements 8.1**

describe("Property 20: Synthesis receives all crew outputs", () => {
  it("synthesis call receives outputs of ALL completed crew members", async () => {
    await fc.assert(
      fc.asyncProperty(arbSynthesisInput, async (input) => {
        let capturedPrompt = "";

        const mockLLM: LLMCallerFn = vi.fn().mockImplementation((prompt: string) => {
          capturedPrompt = prompt;
          const result: SynthesisResult = {
            decision: "Decision",
            confidence: 0.8,
            reasoningPoints: input.crewOutputs.map((o) => ({
              roleId: o.roleId,
              point: o.content.slice(0, 50),
            })),
            dissentingOpinions: [],
            tokenUsage: 100,
          };
          return Promise.resolve(JSON.stringify(result));
        });

        const synthesizer = new BrainstormSynthesizer(mockLLM, makeMockEmitter());
        await synthesizer.synthesize(input);

        // Verify ALL crew outputs are included in the prompt
        for (const output of input.crewOutputs) {
          expect(capturedPrompt).toContain(output.roleId);
          expect(capturedPrompt).toContain(output.content);
        }

        // Verify mode and context are included
        expect(capturedPrompt).toContain(input.mode);
        expect(capturedPrompt).toContain(input.stageContext);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 21: Synthesis output schema completeness ──────────────────────
// **Validates: Requirements 8.2**

describe("Property 21: Synthesis output schema completeness", () => {
  it("valid synthesis contains decision, confidence [0,1], reasoningPoints, dissentingOpinions", async () => {
    await fc.assert(
      fc.asyncProperty(arbSynthesisInput, async (input) => {
        const mockLLM = makeSuccessfulLLM(input);
        const synthesizer = new BrainstormSynthesizer(mockLLM, makeMockEmitter());

        const result = await synthesizer.synthesize(input);

        // Schema completeness checks
        expect(typeof result.decision).toBe("string");
        expect(result.decision.length).toBeGreaterThan(0);

        expect(typeof result.confidence).toBe("number");
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);

        expect(Array.isArray(result.reasoningPoints)).toBe(true);
        for (const rp of result.reasoningPoints) {
          expect(typeof rp.roleId).toBe("string");
          expect(typeof rp.point).toBe("string");
        }

        expect(Array.isArray(result.dissentingOpinions)).toBe(true);
        for (const d of result.dissentingOpinions) {
          expect(typeof d.roleId).toBe("string");
          expect(typeof d.opinion).toBe("string");
        }

        expect(typeof result.tokenUsage).toBe("number");
        expect(result.tokenUsage).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 23: Synthesis fallback selects highest confidence ──────────────
// **Validates: Requirements 8.5**

describe("Property 23: Synthesis fallback selects highest confidence", () => {
  it("on LLM failure, selects output with highest confidence score", async () => {
    await fc.assert(
      fc.asyncProperty(arbSynthesisInput, async (input) => {
        // Force LLM to fail
        const failingLLM: LLMCallerFn = vi
          .fn()
          .mockRejectedValue(new Error("LLM failure"));

        const synthesizer = new BrainstormSynthesizer(
          failingLLM,
          makeMockEmitter(),
        );

        const result = await synthesizer.synthesize(input);

        // Find the highest confidence output
        const sorted = [...input.crewOutputs].sort(
          (a, b) => b.confidence - a.confidence,
        );
        const best = sorted[0];

        // Fallback should select the highest-confidence output
        expect(result.decision).toBe(best.content);
        expect(result.confidence).toBe(best.confidence);
        expect(result.reasoningPoints[0]?.roleId).toBe(best.roleId);
      }),
      { numRuns: 100 },
    );
  });
});
