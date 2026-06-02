/**
 * Brainstorm Memory Store Property-Based Test
 *
 * Property 22: Session persistence round-trip
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §6
 * **Validates: Requirements 8.4, 9.1, 9.2**
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  BrainstormRoleId,
  BrainstormSessionArtifact,
  BranchNode,
  BranchEdge,
  CollaborationMode,
  SynthesisResult,
} from "../../../../shared/blueprint/brainstorm-contracts";
import { BrainstormMemoryStore } from "../../../routes/blueprint/brainstorm/memory-store";

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

const arbBranchNode: fc.Arbitrary<BranchNode> = fc.record({
  id: fc.uuid(),
  sessionId: fc.uuid(),
  parentNodeId: fc.option(fc.uuid(), { nil: null }),
  roleId: arbRoleId,
  type: fc.constantFrom("decision", "thinking", "action", "observation", "synthesis", "error"),
  status: fc.constantFrom("pending", "active", "completed", "failed"),
  title: fc.string({ minLength: 1, maxLength: 80 }),
  content: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
  confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  tokenUsage: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
  createdAt: fc.date().map((d) => d.toISOString()),
  updatedAt: fc.date().map((d) => d.toISOString()),
  sequenceNumber: fc.nat({ max: 500 }),
});

const arbBranchEdge: fc.Arbitrary<BranchEdge> = fc.record({
  sourceNodeId: fc.uuid(),
  targetNodeId: fc.uuid(),
});

const arbSynthesisResult: fc.Arbitrary<SynthesisResult> = fc.record({
  decision: fc.string({ minLength: 1, maxLength: 200 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  reasoningPoints: fc.array(
    fc.record({
      roleId: arbRoleId,
      point: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    { minLength: 1, maxLength: 6 },
  ),
  dissentingOpinions: fc.array(
    fc.record({
      roleId: arbRoleId,
      opinion: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    { minLength: 0, maxLength: 3 },
  ),
  tokenUsage: fc.nat({ max: 5000 }),
});

const arbSessionArtifact: fc.Arbitrary<BrainstormSessionArtifact> = fc
  .record({
    sessionId: fc.uuid(),
    jobId: fc.uuid(),
    stageId: fc.string({ minLength: 1, maxLength: 30 }),
    mode: arbMode,
    roles: fc.uniqueArray(arbRoleId, { minLength: 1, maxLength: 6 }),
    startedAt: fc.date().map((d) => d.toISOString()),
    completedAt: fc.date().map((d) => d.toISOString()),
    nodes: fc.array(arbBranchNode, { minLength: 0, maxLength: 10 }),
    edges: fc.array(arbBranchEdge, { minLength: 0, maxLength: 10 }),
    synthesisResult: fc.option(arbSynthesisResult, { nil: null }),
    tokenUsageByRole: fc.dictionary(
      fc.constantFrom(...ALL_ROLE_IDS),
      fc.nat({ max: 10000 }),
    ),
    totalTokenUsage: fc.nat({ max: 50000 }),
    totalDurationMs: fc.nat({ max: 120000 }),
  });

// ─── Property 22: Session persistence round-trip ────────────────────────────
// **Validates: Requirements 8.4, 9.1, 9.2**

describe("Property 22: Session persistence round-trip", () => {
  it("persist then retrieve yields equivalent artifact (nodes, edges, synthesis, metadata)", () => {
    fc.assert(
      fc.property(arbSessionArtifact, (artifact) => {
        const store = new BrainstormMemoryStore();

        // Persist the artifact
        store.persist(artifact);

        // Retrieve by composite key
        const retrieved = store.retrieve(artifact.jobId, artifact.sessionId);

        // Must exist
        expect(retrieved).toBeDefined();

        // All metadata fields must match
        expect(retrieved!.sessionId).toBe(artifact.sessionId);
        expect(retrieved!.jobId).toBe(artifact.jobId);
        expect(retrieved!.stageId).toBe(artifact.stageId);
        expect(retrieved!.mode).toBe(artifact.mode);
        expect(retrieved!.roles).toEqual(artifact.roles);
        expect(retrieved!.startedAt).toBe(artifact.startedAt);
        expect(retrieved!.completedAt).toBe(artifact.completedAt);
        expect(retrieved!.totalTokenUsage).toBe(artifact.totalTokenUsage);
        expect(retrieved!.totalDurationMs).toBe(artifact.totalDurationMs);

        // Nodes and edges must be deeply equal
        expect(retrieved!.nodes).toEqual(artifact.nodes);
        expect(retrieved!.edges).toEqual(artifact.edges);

        // Synthesis result must match
        expect(retrieved!.synthesisResult).toEqual(artifact.synthesisResult);

        // Token usage by role must match
        expect(retrieved!.tokenUsageByRole).toEqual(artifact.tokenUsageByRole);

        // Mutating retrieved artifact must not affect stored data (isolation)
        if (retrieved!.nodes.length > 0) {
          retrieved!.nodes[0].title = "MUTATED";
          const secondRetrieve = store.retrieve(artifact.jobId, artifact.sessionId);
          expect(secondRetrieve!.nodes[0]?.title).toBe(artifact.nodes[0]?.title);
        }
      }),
      { numRuns: 100 },
    );
  });
});
