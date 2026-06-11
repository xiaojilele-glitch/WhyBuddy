/**
 * Epic 9 baseline preservation — server-side property tests (tasks 9.2, 9.3).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import {
  isDeliberationCapability,
  executeDeliberationCapabilityMapped,
} from "../whybuddy/deliberation-exec-map.js";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";

vi.mock("../routes/blueprint/brainstorm/pool-llm-caller.js", () => ({
  createPoolBackedBrainstormCaller: vi.fn(() => null),
}));

const PBT_OPTS = { numRuns: 100 };

const DELIBERATION_CAPS = [
  "counter.argue",
  "critique.generate",
  "rebuttal.resolve",
  "synthesis.merge",
] as const;

const baseState = (goal = "权限系统"): V5SessionState => ({
  sessionId: "base-s",
  goal: { text: goal, status: "needs_refinement" },
  artifacts: [],
  staleArtifactIds: [],
  decisionLedger: [],
  capabilityRuns: [],
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 18: 协商能力经 R2 引擎执行
 * Validates: Requirements 6.1, 8.1
 */
describe("Property 18: deliberation caps use R2 seam", () => {
  it("isDeliberationCapability is true exactly for the four deliberation caps", () => {
    fc.assert(
      fc.property(fc.constantFrom(...DELIBERATION_CAPS), (cap) => {
        expect(isDeliberationCapability(cap)).toBe(true);
      }),
      PBT_OPTS
    );
  });

  it("risk.analyze is never classified as deliberation", () => {
    expect(isDeliberationCapability("risk.analyze")).toBe(false);
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 19: 协商失败永不抛错并降级
 * Validates: Requirements 8.5
 */
describe("Property 19: deliberation never throws; degrades gracefully", () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rebuttal.resolve without upstream critique never throws and returns degraded", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uuid(), { minLength: 0, maxLength: 3 }),
        async (inputIds) => {
          const res = await executeDeliberationCapabilityMapped({
            capabilityId: "rebuttal.resolve",
            state: baseState(),
            inputArtifactIds: inputIds,
            turnId: "t-p19",
          });
          expect(res.degraded).toBe(true);
          expect(res.degradedReason).toBeTruthy();
        }
      ),
      PBT_OPTS
    );
  });

});