import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ALL_V5_CAPABILITIES } from "../contracts.js";
import { validateProposedPlan } from "../whybuddy-plan-validation.js";

describe("validateProposedPlan (R1-B1)", () => {
  it("accepts a well-formed proposal", () => {
    const result = validateProposedPlan({
      selected: [
        { capabilityId: "risk.analyze", roleId: "安全", why: "用户关心风险" },
        { capabilityId: "report.write", roleId: "综合" },
      ],
      rationale: "先做风险再出报告",
    });
    expect(result.valid).toBe(true);
    expect(result.selected).toHaveLength(2);
    expect(result.selected[0].capabilityId).toBe("risk.analyze");
  });

  it("accepts LLM alias fields and normalizes underscore capability ids (F0.1)", () => {
    const result = validateProposedPlan({
      selected: [
        { capability: "risk_analyze", role: "安全" },
        { cap: "evidence.search", agent: "研究" },
      ],
      rationale: "alias normalization",
    });
    expect(result.valid).toBe(true);
    expect(result.selected.map((s) => s.capabilityId)).toEqual(["risk.analyze", "evidence.search"]);
  });

  it("resolves scenario.preview alias to scenario.simulate", () => {
    const result = validateProposedPlan({
      selected: [{ capabilityId: "scenario.preview", roleId: "规划" }],
    });
    expect(result.valid).toBe(true);
    expect(result.selected[0]?.capabilityId).toBe("scenario.simulate");
  });

  it("drops invalid capabilities and defaults invalid roles", () => {
    const result = validateProposedPlan({
      selected: [
        { capabilityId: "not.real", roleId: "安全" },
        { capabilityId: "risk.analyze", roleId: "bogus-role" },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].roleId).toBe("安全");
    expect(result.dropped.some((d) => d.reason === "invalid_capability")).toBe(true);
    expect(result.dropped.some((d) => d.reason === "invalid_role_defaulted")).toBe(true);
  });

  it("returns invalid_proposal when all items are dropped", () => {
    const result = validateProposedPlan({
      selected: [{ capabilityId: "fake.cap", roleId: "安全" }],
    });
    expect(result.valid).toBe(false);
    expect(result.selected).toHaveLength(0);
  });

  it("never throws on arbitrary malformed input (property)", () => {
    const capArb = fc.oneof(
      fc.constantFrom(...ALL_V5_CAPABILITIES),
      fc.string({ maxLength: 12 }),
      fc.constant(null),
      fc.constant(undefined)
    );
    const itemArb = fc.record({
      capabilityId: capArb,
      roleId: fc.oneof(fc.string({ maxLength: 8 }), fc.constant(null)),
      why: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
    });
    const proposalArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.record({ selected: fc.array(itemArb, { maxLength: 8 }) }),
      fc.string()
    );

    fc.assert(
      fc.property(proposalArb, (proposal) => {
        let result;
        expect(() => {
          result = validateProposedPlan(proposal as any);
        }).not.toThrow();
        expect(result).toBeDefined();
        expect(Array.isArray((result as any).selected)).toBe(true);
        expect(Array.isArray((result as any).dropped)).toBe(true);
        expect(typeof (result as any).valid).toBe("boolean");
      }),
      { numRuns: 120 }
    );
  });
});