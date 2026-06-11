/**
 * FLOWB property tests (tasks 6.2–6.4).
 * Feature: whybuddy-llm-autonomous-reasoning, Properties 25, 26, 39
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  sanitizeThroughFlowBoundary,
  commitArtifact,
  createInitialSessionState,
} from "../whybuddy-runtime";

const PBT_OPTS = { numRuns: 100 };

const MARKERS = [
  "critique:",
  "rebuttal:",
  "debate:",
  "challengeEdges",
  "role vote",
  "brainstorm console",
  "brainstorm:",
] as const;

const PROTOCOL_LINE = fc.constantFrom(...MARKERS).map((m) => `${m} injected noise`);

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 25: 流边界剥离零残留且幂等
 * Validates: Requirements 9.1, 9.2, 9.5
 */
describe("Property 25: flow boundary strip idempotent zero residual", () => {
  it("output has no protocol markers and second pass is unchanged", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 60 }), { minLength: 1, maxLength: 8 }),
        fc.array(PROTOCOL_LINE, { minLength: 0, maxLength: 5 }),
        fc.constantFrom("brainstorm", "discussion" as const),
        (cleanLines, protocolLines, source) => {
          const mixed = [...cleanLines, ...protocolLines].join("\n");
          const first = sanitizeThroughFlowBoundary(mixed, { turnId: "t-p25", source });
          const second = sanitizeThroughFlowBoundary(first.cleanedText, { turnId: "t-p25", source });
          expect(second.cleanedText).toBe(first.cleanedText);
          for (const m of MARKERS) {
            expect(first.cleanedText.toLowerCase()).not.toContain(m.toLowerCase());
          }
          expect(first.check.passed).toBe(true);
        }
      ),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 26: 流边界处理生成一致的台账记录
 * Validates: Requirements 9.3
 */
describe("Property 26: flow boundary ledger entry", () => {
  it("each sanitize adds exactly one ledger check with matching stripped count", () => {
    fc.assert(
      fc.property(fc.array(PROTOCOL_LINE, { minLength: 1, maxLength: 4 }), (protocolLines) => {
        let s = createInitialSessionState("flowb", "s-p26");
        const before = (s.flowBoundaryLedger || []).length;
        const input = ["clean line", ...protocolLines].join("\n");
        const { cleanedText, check } = sanitizeThroughFlowBoundary(input, {
          turnId: "t-p26",
          source: "discussion",
        });
        s = {
          ...s,
          flowBoundaryLedger: [...(s.flowBoundaryLedger || []), check],
        };
        expect((s.flowBoundaryLedger || []).length).toBe(before + 1);
        expect(check.strippedProtocolNodes.length).toBeGreaterThan(0);
        expect(check.source).toBe("discussion");
        const rescan = sanitizeThroughFlowBoundary(cleanedText, { turnId: "t-p26", source: "discussion" });
        expect(rescan.check.strippedProtocolNodes.length).toBe(0);
      }),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 39: FLOWB payload 豁免
 * Validates: Requirements 9.6
 */
describe("Property 39: payload passthrough", () => {
  it("commitArtifact preserves payload while cleaning content for synthesis", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.jsonValue()),
        (payload) => {
          let s = createInitialSessionState("payload", "s-p39");
          const raw = {
            id: "syn-p39",
            kind: "synthesis" as const,
            provenance: "ai_generated" as const,
            producedBy: { capabilityId: "synthesis.merge", roleId: "综合" },
            content: "critique: strip me\nkeep this line",
            payload,
          };
          const { updatedState, committed } = commitArtifact(
            s,
            raw as any,
            "t-p39-run",
            false,
            []
          );
          const art = (updatedState.artifacts || []).find((a) => a.id === "syn-p39");
          expect(art?.payload).toEqual(payload);
          expect(art?.content).not.toContain("critique:");
          expect(committed?.payload).toEqual(payload);
        }
      ),
      PBT_OPTS
    );
  });
});