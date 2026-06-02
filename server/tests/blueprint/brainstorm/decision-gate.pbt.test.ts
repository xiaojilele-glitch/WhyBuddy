/**
 * Decision Gate Property-Based Test — Property 1: Schema Completeness
 *
 * **Validates: Requirements 1.2**
 *
 * For any valid LLM response that successfully parses as a Decision Gate output,
 * the result SHALL contain all required fields:
 * - `brainstormNeeded` (boolean)
 * - `recommendedMode` (valid CollaborationMode)
 * - `requiredRoles` (non-empty array of valid BrainstormRoleId)
 * - `requiredToolCategories` (array of valid ToolCategory)
 * - `reasoning` (non-empty string)
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type {
  DecisionGateOutput,
  CollaborationMode,
  BrainstormRoleId,
  ToolCategory,
} from "../../../../shared/blueprint/brainstorm-contracts.js";
import { parseDecisionGateResponse } from "../../../routes/blueprint/brainstorm/decision-gate.js";

// ─── Valid domain values ────────────────────────────────────────────────────

const VALID_COLLABORATION_MODES: CollaborationMode[] = [
  "discussion",
  "vote",
  "division",
  "audit",
];

const VALID_BRAINSTORM_ROLE_IDS: BrainstormRoleId[] = [
  "decider",
  "planner",
  "architect",
  "executor",
  "auditor",
  "ui_previewer",
];

const VALID_TOOL_CATEGORIES: ToolCategory[] = [
  "docker",
  "mcp",
  "github",
  "skills",
];

// ─── Arbitraries ────────────────────────────────────────────────────────────

const arbCollaborationMode: fc.Arbitrary<CollaborationMode> = fc.constantFrom(
  ...VALID_COLLABORATION_MODES,
);

const arbBrainstormRoleId: fc.Arbitrary<BrainstormRoleId> = fc.constantFrom(
  ...VALID_BRAINSTORM_ROLE_IDS,
);

const arbToolCategory: fc.Arbitrary<ToolCategory> = fc.constantFrom(
  ...VALID_TOOL_CATEGORIES,
);

const arbDecisionGateOutput: fc.Arbitrary<DecisionGateOutput> = fc.record({
  brainstormNeeded: fc.boolean(),
  recommendedMode: arbCollaborationMode,
  requiredRoles: fc.uniqueArray(arbBrainstormRoleId, { minLength: 1, maxLength: 6 }),
  requiredToolCategories: fc.uniqueArray(arbToolCategory, { minLength: 0, maxLength: 4 }),
  reasoning: fc.string({ minLength: 1, maxLength: 500 }),
});

// ─── Property 1: Decision Gate schema completeness ──────────────────────────
// **Validates: Requirements 1.2**

describe("Property 1: Decision Gate schema completeness", () => {
  it("for any valid LLM response, parseDecisionGateResponse returns output with all required fields", () => {
    fc.assert(
      fc.property(arbDecisionGateOutput, (output: DecisionGateOutput) => {
        // Simulate LLM returning valid JSON
        const raw = JSON.stringify(output);
        const parsed = parseDecisionGateResponse(raw);

        // Must successfully parse
        expect(parsed).not.toBeNull();

        // 1. brainstormNeeded is a boolean
        expect(typeof parsed!.brainstormNeeded).toBe("boolean");

        // 2. recommendedMode is one of the valid CollaborationMode values
        expect(VALID_COLLABORATION_MODES).toContain(parsed!.recommendedMode);

        // 3. requiredRoles is a non-empty array of valid BrainstormRoleId values
        expect(Array.isArray(parsed!.requiredRoles)).toBe(true);
        expect(parsed!.requiredRoles.length).toBeGreaterThan(0);
        for (const role of parsed!.requiredRoles) {
          expect(VALID_BRAINSTORM_ROLE_IDS).toContain(role);
        }

        // 4. requiredToolCategories is an array of valid ToolCategory values
        expect(Array.isArray(parsed!.requiredToolCategories)).toBe(true);
        for (const cat of parsed!.requiredToolCategories) {
          expect(VALID_TOOL_CATEGORIES).toContain(cat);
        }

        // 5. reasoning is a string
        expect(typeof parsed!.reasoning).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  it("parseDecisionGateResponse rejects invalid objects missing required fields", () => {
    // Generate arbitrary JSON objects that may be missing required fields
    const arbPartialObject = fc.record(
      {
        brainstormNeeded: fc.option(fc.anything(), { nil: undefined }),
        recommendedMode: fc.option(fc.anything(), { nil: undefined }),
        requiredRoles: fc.option(fc.anything(), { nil: undefined }),
        requiredToolCategories: fc.option(fc.anything(), { nil: undefined }),
        reasoning: fc.option(fc.anything(), { nil: undefined }),
      },
      { requiredKeys: [] },
    );

    fc.assert(
      fc.property(arbPartialObject, (obj) => {
        const raw = JSON.stringify(obj);
        const parsed = parseDecisionGateResponse(raw);

        // If the parser says it's valid, verify it actually has all required fields
        if (parsed !== null) {
          expect(typeof parsed.brainstormNeeded).toBe("boolean");
          expect(VALID_COLLABORATION_MODES).toContain(parsed.recommendedMode);
          expect(Array.isArray(parsed.requiredRoles)).toBe(true);
          expect(parsed.requiredRoles.length).toBeGreaterThan(0);
          for (const role of parsed.requiredRoles) {
            expect(VALID_BRAINSTORM_ROLE_IDS).toContain(role);
          }
          expect(Array.isArray(parsed.requiredToolCategories)).toBe(true);
          for (const cat of parsed.requiredToolCategories) {
            expect(VALID_TOOL_CATEGORIES).toContain(cat);
          }
          expect(typeof parsed.reasoning).toBe("string");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("valid DecisionGateOutput JSON round-trips through parseDecisionGateResponse", () => {
    fc.assert(
      fc.property(arbDecisionGateOutput, (output: DecisionGateOutput) => {
        // Serialize to JSON and parse through the real parser
        const serialized = JSON.stringify(output);
        const parsed = parseDecisionGateResponse(serialized);

        // Must successfully parse
        expect(parsed).not.toBeNull();

        // Deserialized object should be equivalent
        expect(parsed!.brainstormNeeded).toBe(output.brainstormNeeded);
        expect(parsed!.recommendedMode).toBe(output.recommendedMode);
        expect(parsed!.requiredRoles).toEqual(output.requiredRoles);
        expect(parsed!.requiredToolCategories).toEqual(output.requiredToolCategories);
        expect(parsed!.reasoning).toBe(output.reasoning);
      }),
      { numRuns: 100 },
    );
  });
});
