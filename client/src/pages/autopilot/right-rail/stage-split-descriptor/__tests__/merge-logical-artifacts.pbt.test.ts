/**
 * `.kiro/specs/spec-first-stage-process-artifact-split-uniform/` Batch 1 / Task 1.6
 *
 * Property-based tests for `mergeLogicalArtifacts`.
 *
 * **Validates: Requirements 2.3, 4.1, 4.2**
 * **Property: P3, P4**
 *
 * Properties covered (named/numbered per design.md "Correctness Properties"):
 *
 * - **P3 (Idempotence)**: ∀ xs: BlueprintGenerationArtifact[],
 *     `mergeLogicalArtifacts(mergeLogicalArtifacts(xs))` deep-equals
 *     `mergeLogicalArtifacts(xs)`.
 *     Re-merging an already-merged list MUST NOT shuffle, drop, or further
 *     collapse entries — required so React re-renders don't cause UI jitter.
 *
 * - **P4 (Same-key collapse)**: when every input artifact is forced to
 *     `type === "clarification_session"` with a single fixed
 *     `payload.sessionId`, the merged output has exactly length 1.
 *     This is the universal-quantifier version of the user-visible
 *     duplicate-clarification-card bug fix. We deliberately do NOT assert
 *     a literal representative `id` here: fast-check shrinkers can produce
 *     inputs in any order, so the representative is not deterministic
 *     without input-order control. The unit test in
 *     `merge-logical-artifacts.unit.test.ts` Case A pins down the
 *     representative-id contract under a fixed input order.
 *
 * NOTE: This file deliberately limits itself to the named P3 / P4 properties
 * specified by Task 1.6. Adding new properties (e.g. distinct-key
 * preservation) requires updating design.md "Correctness Properties" first.
 */

import * as fc from "fast-check";
import { describe, expect, test } from "vitest";

import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationArtifactType,
} from "@shared/blueprint/contracts";

import { mergeLogicalArtifacts } from "../merge-logical-artifacts";

// ───────────────────────────────────────────────────────────────────────────
// Arbitraries
// ───────────────────────────────────────────────────────────────────────────

/**
 * Constrain `type` to the 7 keyed rows from design.md Component 4 plus a
 * couple of `<other>` types (`requirements`, `agent_crew`). Mixing keyed and
 * fallback rows lets fast-check probe both branches of
 * `computeLogicalArtifactKey` in the same generated array.
 */
const artifactTypeArb = fc.constantFrom<BlueprintGenerationArtifactType>(
  "clarification_session",
  "route_set",
  "route_selection",
  "spec_tree",
  "intake",
  "github_source",
  "project_context",
  "requirements",
  "agent_crew",
);

/**
 * Generate an ISO-8601-shaped `createdAt` by adding minutes to a fixed base
 * date. This matches the project's existing PBT style (constant timestamp
 * with bounded jitter) and keeps shrinkers small.
 */
const createdAtArb = fc.integer({ min: 0, max: 60 * 24 }).map((minutes) => {
  const base = Date.UTC(2026, 4, 22, 10, 0, 0); // 2026-05-22T10:00:00Z
  return new Date(base + minutes * 60_000).toISOString();
});

/**
 * Generate a non-empty payload record carrying the union of all logicalKey
 * fallback fields (`sessionId / routeSetId / selectionId / treeId / intakeId
 * / normalizedUrl / projectId / id`). For each generated artifact we keep
 * only some of these keys via `fc.option`, which gives fast-check leverage
 * to produce both "key present" and "key missing → fallback to artifact.id"
 * inputs without ballooning the search space.
 */
const payloadArb: fc.Arbitrary<Record<string, unknown>> = fc.record(
  {
    sessionId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
      nil: undefined,
    }),
    id: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
      nil: undefined,
    }),
    routeSetId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
      nil: undefined,
    }),
    selectionId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
      nil: undefined,
    }),
    treeId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
      nil: undefined,
    }),
    intakeId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
      nil: undefined,
    }),
    normalizedUrl: fc.option(fc.string({ minLength: 1, maxLength: 16 }), {
      nil: undefined,
    }),
    projectId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
      nil: undefined,
    }),
  },
  { requiredKeys: [] },
);

/**
 * Generate a single, contract-valid `BlueprintGenerationArtifact`. `id` is
 * non-empty per the `BlueprintGenerationArtifact` contract; the upstream
 * `MISSING_ID_PLACEHOLDER_KEY` fallback is exercised by the unit tests, not
 * by this PBT.
 */
const arbArtifact: fc.Arbitrary<BlueprintGenerationArtifact> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 16 }),
    type: artifactTypeArb,
    title: fc.string({ maxLength: 24 }),
    summary: fc.string({ maxLength: 48 }),
    createdAt: createdAtArb,
    payload: payloadArb,
  })
  .map(
    (record): BlueprintGenerationArtifact => ({
      id: record.id,
      type: record.type,
      title: record.title,
      summary: record.summary,
      createdAt: record.createdAt,
      payload: record.payload,
    }),
  );

// ───────────────────────────────────────────────────────────────────────────
// P3 — Idempotence
// ───────────────────────────────────────────────────────────────────────────

describe("mergeLogicalArtifacts — Property 3 (idempotence)", () => {
  test("merging an already-merged list yields a deep-equal result", () => {
    fc.assert(
      fc.property(fc.array(arbArtifact, { maxLength: 30 }), (xs) => {
        const once = mergeLogicalArtifacts(xs);
        const twice = mergeLogicalArtifacts(once);
        expect(twice).toEqual(once);
      }),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// P4 — Same-key collapse
// ───────────────────────────────────────────────────────────────────────────

describe("mergeLogicalArtifacts — Property 4 (same-key collapse)", () => {
  test("forcing every input to clarification_session with the same payload.sessionId collapses to a single entry", () => {
    fc.assert(
      fc.property(
        fc.array(arbArtifact, { minLength: 1, maxLength: 10 }),
        (xs) => {
          // Force ALL artifacts to share the same clarification_session
          // logicalKey. We rewrite `id` with a unique suffix so literal
          // id-dedup (any future caller-side `seenIds` filter or a future
          // refactor that lifts id-dedup into mergeLogicalArtifacts itself)
          // cannot pre-collapse the input before the logicalKey path
          // fires — this isolates the test to the same-logicalKey path.
          const forced: BlueprintGenerationArtifact[] = xs.map((a, i) => ({
            ...a,
            id: `forced-${i}-${a.id}`,
            type: "clarification_session" as const,
            payload: { sessionId: "S-fixed" },
          }));

          // Only assert length === 1. Do NOT assert a representative `id`:
          // shrinkers may produce inputs in any order, so the representative
          // is not deterministic at this layer. Representative-id contract
          // under a fixed input order is covered by the unit test
          // `merge-logical-artifacts.unit.test.ts` Case A.
          expect(mergeLogicalArtifacts(forced)).toHaveLength(1);
        },
      ),
    );
  });
});
