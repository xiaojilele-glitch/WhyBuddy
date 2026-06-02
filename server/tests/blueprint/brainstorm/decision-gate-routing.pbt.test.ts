/**
 * Property-Based Test: Decision Gate Routing Correctness (Property 2)
 *
 * **Validates: Requirements 1.3, 1.4**
 *
 * Property 2: Decision Gate routing correctness
 * - For any Decision Gate output with brainstormNeeded=false, the routing logic
 *   SHALL signal single-agent execution path.
 * - For any Decision Gate output with brainstormNeeded=true, the routing logic
 *   SHALL signal session spawn with matching mode, roles, and tool categories.
 *
 * Additionally verifies the output contract:
 * - When brainstormNeeded=true, requiredRoles must be non-empty.
 * - When brainstormNeeded=false, the system should bypass brainstorm.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import type {
  DecisionGateOutput,
  CollaborationMode,
  BrainstormRoleId,
  ToolCategory,
} from "../../../../shared/blueprint/brainstorm-contracts.js";

import {
  decide,
  routeDecision,
  FALLBACK_OUTPUT,
  type LLMCallerFn,
  type EventEmitterFn,
} from "../../../routes/blueprint/brainstorm/decision-gate.js";

// ---------------------------------------------------------------------------
// Arbitraries: Smart generators for constrained input space
// ---------------------------------------------------------------------------

const MODES: CollaborationMode[] = ["discussion", "vote", "division", "audit"];
const ROLES: BrainstormRoleId[] = [
  "decider",
  "planner",
  "architect",
  "executor",
  "auditor",
  "ui_previewer",
];
const TOOL_CATS: ToolCategory[] = ["docker", "mcp", "github", "skills"];

/** Generate an arbitrary CollaborationMode. */
const arbMode = fc.constantFrom(...MODES);

/** Generate a non-empty subset of roles (required when brainstormNeeded=true). */
const arbNonEmptyRoles = fc
  .subarray(ROLES, { minLength: 1, maxLength: ROLES.length })
  .map((arr) => [...arr] as BrainstormRoleId[]);

/** Generate an arbitrary (possibly empty) subset of roles. */
const arbRoles = fc
  .subarray(ROLES, { minLength: 0, maxLength: ROLES.length })
  .map((arr) => [...arr] as BrainstormRoleId[]);

/** Generate an arbitrary subset of tool categories. */
const arbToolCategories = fc
  .subarray(TOOL_CATS, { minLength: 0, maxLength: TOOL_CATS.length })
  .map((arr) => [...arr] as ToolCategory[]);

/** Generate a reasoning string. */
const arbReasoning = fc.string({ minLength: 1, maxLength: 200 });

/**
 * Generate a valid DecisionGateOutput where brainstormNeeded=true.
 * Enforces the contract that requiredRoles is non-empty when brainstorm is needed.
 */
const arbBrainstormNeededOutput: fc.Arbitrary<DecisionGateOutput> = fc.record({
  brainstormNeeded: fc.constant(true as const),
  recommendedMode: arbMode,
  requiredRoles: arbNonEmptyRoles,
  requiredToolCategories: arbToolCategories,
  reasoning: arbReasoning,
});

/**
 * Generate a valid DecisionGateOutput where brainstormNeeded=false.
 * Uses non-empty roles to match the parseDecisionGateResponse contract
 * (the parser requires requiredRoles to have at least 1 valid element).
 */
const arbSingleAgentOutput: fc.Arbitrary<DecisionGateOutput> = fc.record({
  brainstormNeeded: fc.constant(false as const),
  recommendedMode: arbMode,
  requiredRoles: arbNonEmptyRoles,
  requiredToolCategories: arbToolCategories,
  reasoning: arbReasoning,
});

/**
 * Generate any valid DecisionGateOutput (mix of both cases).
 */
const arbDecisionGateOutput: fc.Arbitrary<DecisionGateOutput> = fc.oneof(
  arbBrainstormNeededOutput,
  arbSingleAgentOutput,
);

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("Property 2: Decision Gate routing correctness", () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * When brainstormNeeded=false, routing SHALL return single-agent path.
   */
  it("brainstormNeeded=false always routes to single-agent execution", () => {
    fc.assert(
      fc.property(arbSingleAgentOutput, (output) => {
        const result = routeDecision(output);
        expect(result.type).toBe("single-agent");
        expect(result.sessionConfig).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * When brainstormNeeded=true, routing SHALL spawn a brainstorm session
   * with matching mode, roles, and tool categories.
   */
  it("brainstormNeeded=true routes to brainstorm-session with matching config", () => {
    fc.assert(
      fc.property(arbBrainstormNeededOutput, (output) => {
        const result = routeDecision(output);

        expect(result.type).toBe("brainstorm-session");
        expect(result.sessionConfig).toBeDefined();
        expect(result.sessionConfig!.mode).toBe(output.recommendedMode);
        expect(result.sessionConfig!.roles).toEqual(output.requiredRoles);
        expect(result.sessionConfig!.toolCategories).toEqual(
          output.requiredToolCategories,
        );
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * For any brainstormNeeded=true output, requiredRoles is always non-empty.
   * This is a contract invariant enforced by the Decision Gate parser.
   */
  it("brainstormNeeded=true always has non-empty requiredRoles", () => {
    fc.assert(
      fc.property(arbBrainstormNeededOutput, (output) => {
        expect(output.brainstormNeeded).toBe(true);
        expect(output.requiredRoles.length).toBeGreaterThan(0);

        // Verify routing produces a session config with the same roles
        const result = routeDecision(output);
        expect(result.sessionConfig!.roles.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.3, 1.4**
   *
   * For any valid DecisionGateOutput, the routing decision is deterministic:
   * same input always produces same routing type.
   */
  it("routing is deterministic for any DecisionGateOutput", () => {
    fc.assert(
      fc.property(arbDecisionGateOutput, (output) => {
        const result1 = routeDecision(output);
        const result2 = routeDecision(output);

        expect(result1.type).toBe(result2.type);
        expect(result1.sessionConfig).toEqual(result2.sessionConfig);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.3, 1.4**
   *
   * Decision Gate decide() with mocked LLM: verify that parsed LLM outputs
   * correctly route based on the brainstormNeeded field.
   */
  it("decide() routes correctly based on mocked LLM response", () => {
    fc.assert(
      fc.asyncProperty(arbDecisionGateOutput, async (expectedOutput) => {
        // Mock the LLM to return a specific Decision Gate output as JSON
        const mockLlm = async () => JSON.stringify(expectedOutput);
        const events: Array<{ type: string; payload: Record<string, unknown> }> =
          [];
        const mockEmit = (type: string, payload: Record<string, unknown>) => {
          events.push({ type, payload });
        };

        const input = {
          jobId: "test-job",
          stageId: "test-stage",
          stageContext: "test context",
          degradedBridges: [] as string[],
        };

        const result = await decide(input, mockLlm, mockEmit, {
          timeoutMs: 1000,
        });
        const routing = routeDecision(result);

        if (expectedOutput.brainstormNeeded) {
          expect(routing.type).toBe("brainstorm-session");
          expect(routing.sessionConfig).toBeDefined();
          expect(routing.sessionConfig!.mode).toBe(
            expectedOutput.recommendedMode,
          );
          expect(routing.sessionConfig!.roles).toEqual(
            expectedOutput.requiredRoles,
          );
          expect(routing.sessionConfig!.toolCategories).toEqual(
            expectedOutput.requiredToolCategories,
          );
        } else {
          expect(routing.type).toBe("single-agent");
          expect(routing.sessionConfig).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * The FALLBACK_OUTPUT constant always routes to single-agent.
   */
  it("FALLBACK_OUTPUT always routes to single-agent", () => {
    const result = routeDecision(FALLBACK_OUTPUT);
    expect(result.type).toBe("single-agent");
    expect(result.sessionConfig).toBeUndefined();
    expect(FALLBACK_OUTPUT.brainstormNeeded).toBe(false);
  });
});
