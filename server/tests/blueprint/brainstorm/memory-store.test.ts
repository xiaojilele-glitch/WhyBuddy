/**
 * Brainstorm Memory Store Unit Tests
 *
 * Tests persist and retrieve round-trip, listByJob, artifact completeness,
 * and replay timeline ordering.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §6
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { describe, expect, it, vi } from "vitest";

import type {
  BrainstormSession,
  BrainstormSessionArtifact,
  BranchNode,
  BranchEdge,
  CrewMemberInstance,
} from "../../../../shared/blueprint/brainstorm-contracts";
import {
  BrainstormMemoryStore,
  buildSessionArtifact,
  handleReplayRequest,
} from "../../../routes/blueprint/brainstorm/memory-store";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeArtifact(overrides?: Partial<BrainstormSessionArtifact>): BrainstormSessionArtifact {
  return {
    sessionId: "session-1",
    jobId: "job-1",
    stageId: "planning",
    mode: "discussion",
    roles: ["planner", "architect"],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    nodes: [
      {
        id: "node-1",
        sessionId: "session-1",
        parentNodeId: null,
        roleId: "planner",
        type: "thinking",
        status: "completed",
        title: "Plan the approach",
        content: "We should use microservices",
        confidence: 0.8,
        createdAt: "2026-01-01T00:00:10.000Z",
        updatedAt: "2026-01-01T00:00:20.000Z",
        sequenceNumber: 1,
      },
      {
        id: "node-2",
        sessionId: "session-1",
        parentNodeId: "node-1",
        roleId: "architect",
        type: "thinking",
        status: "completed",
        title: "Design architecture",
        content: "Event-driven approach recommended",
        confidence: 0.9,
        createdAt: "2026-01-01T00:00:30.000Z",
        updatedAt: "2026-01-01T00:00:40.000Z",
        sequenceNumber: 2,
      },
    ],
    edges: [{ sourceNodeId: "node-1", targetNodeId: "node-2" }],
    synthesisResult: {
      decision: "Use event-driven microservices",
      confidence: 0.85,
      reasoningPoints: [
        { roleId: "planner", point: "Scalability" },
        { roleId: "architect", point: "Loose coupling" },
      ],
      dissentingOpinions: [],
      tokenUsage: 300,
    },
    tokenUsageByRole: { planner: 150, architect: 150 },
    totalTokenUsage: 300,
    totalDurationMs: 60000,
    ...overrides,
  };
}

function makeMockSession(overrides?: Partial<BrainstormSession>): BrainstormSession {
  const crewMembers = new Map<string, CrewMemberInstance>();
  crewMembers.set("planner", {
    roleId: "planner",
    state: "completed",
    iterationCount: 2,
    maxIterations: 3,
    tokenUsage: 200,
    output: {
      content: "Planning output",
      confidence: 0.8,
      toolInvocations: [],
      tokenUsage: 200,
    },
  });
  crewMembers.set("architect", {
    roleId: "architect",
    state: "completed",
    iterationCount: 1,
    maxIterations: 3,
    tokenUsage: 150,
    output: {
      content: "Architecture output",
      confidence: 0.9,
      toolInvocations: [],
      tokenUsage: 150,
    },
  });

  return {
    id: "session-1",
    jobId: "job-1",
    stageId: "planning",
    mode: "discussion",
    crewMembers: crewMembers as any,
    branchNodes: [
      {
        id: "node-1",
        sessionId: "session-1",
        parentNodeId: null,
        roleId: "planner",
        type: "thinking",
        status: "completed",
        title: "Plan",
        createdAt: "2026-01-01T00:00:10.000Z",
        updatedAt: "2026-01-01T00:00:20.000Z",
        sequenceNumber: 1,
      },
    ],
    edges: [],
    status: "synthesizing",
    tokenBudget: 50000,
    tokenUsed: 350,
    toolCallCount: 0,
    toolCallLimit: 20,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:01:00.000Z"),
    synthesisResult: {
      decision: "Final decision",
      confidence: 0.85,
      reasoningPoints: [{ roleId: "planner", point: "Good plan" }],
      dissentingOpinions: [],
      tokenUsage: 100,
    },
    ...overrides,
  } as BrainstormSession;
}

// ─── Persist and Retrieve Round-Trip ────────────────────────────────────────

describe("BrainstormMemoryStore - Persist and Retrieve", () => {
  it("persists and retrieves an artifact by composite key", () => {
    const store = new BrainstormMemoryStore();
    const artifact = makeArtifact();

    store.persist(artifact);
    const retrieved = store.retrieve("job-1", "session-1");

    expect(retrieved).toBeDefined();
    expect(retrieved!.sessionId).toBe("session-1");
    expect(retrieved!.jobId).toBe("job-1");
    expect(retrieved!.mode).toBe("discussion");
  });

  it("returns undefined for non-existent sessions", () => {
    const store = new BrainstormMemoryStore();
    const retrieved = store.retrieve("job-1", "nonexistent");
    expect(retrieved).toBeUndefined();
  });

  it("overwrites existing artifact with same key", () => {
    const store = new BrainstormMemoryStore();
    const artifact1 = makeArtifact({ totalTokenUsage: 100 });
    const artifact2 = makeArtifact({ totalTokenUsage: 999 });

    store.persist(artifact1);
    store.persist(artifact2);

    const retrieved = store.retrieve("job-1", "session-1");
    expect(retrieved!.totalTokenUsage).toBe(999);
  });

  it("stored artifact is isolated from mutations to original", () => {
    const store = new BrainstormMemoryStore();
    const artifact = makeArtifact();

    store.persist(artifact);
    artifact.nodes[0].title = "MUTATED";

    const retrieved = store.retrieve("job-1", "session-1");
    expect(retrieved!.nodes[0].title).toBe("Plan the approach");
  });

  it("retrieved artifact is isolated from mutations", () => {
    const store = new BrainstormMemoryStore();
    store.persist(makeArtifact());

    const retrieved = store.retrieve("job-1", "session-1")!;
    retrieved.nodes[0].title = "MUTATED";

    const secondRetrieve = store.retrieve("job-1", "session-1")!;
    expect(secondRetrieve.nodes[0].title).toBe("Plan the approach");
  });
});

// ─── listByJob ──────────────────────────────────────────────────────────────

describe("BrainstormMemoryStore - listByJob", () => {
  it("lists all sessions for a given job", () => {
    const store = new BrainstormMemoryStore();
    store.persist(makeArtifact({ sessionId: "s1", jobId: "job-1", startedAt: "2026-01-01T00:01:00.000Z" }));
    store.persist(makeArtifact({ sessionId: "s2", jobId: "job-1", startedAt: "2026-01-01T00:02:00.000Z" }));
    store.persist(makeArtifact({ sessionId: "s3", jobId: "job-2", startedAt: "2026-01-01T00:03:00.000Z" }));

    const results = store.listByJob("job-1");
    expect(results).toHaveLength(2);
    expect(results[0].sessionId).toBe("s1");
    expect(results[1].sessionId).toBe("s2");
  });

  it("returns empty array for unknown job", () => {
    const store = new BrainstormMemoryStore();
    const results = store.listByJob("unknown-job");
    expect(results).toEqual([]);
  });

  it("returns results sorted by startedAt ascending", () => {
    const store = new BrainstormMemoryStore();
    store.persist(makeArtifact({ sessionId: "s2", jobId: "job-1", startedAt: "2026-01-01T00:05:00.000Z" }));
    store.persist(makeArtifact({ sessionId: "s1", jobId: "job-1", startedAt: "2026-01-01T00:01:00.000Z" }));
    store.persist(makeArtifact({ sessionId: "s3", jobId: "job-1", startedAt: "2026-01-01T00:03:00.000Z" }));

    const results = store.listByJob("job-1");
    expect(results[0].sessionId).toBe("s1");
    expect(results[1].sessionId).toBe("s3");
    expect(results[2].sessionId).toBe("s2");
  });
});

// ─── Artifact Completeness ──────────────────────────────────────────────────

describe("BrainstormMemoryStore - Artifact Completeness", () => {
  it("buildSessionArtifact includes all required fields", () => {
    const session = makeMockSession();
    const artifact = buildSessionArtifact(session);

    expect(artifact.sessionId).toBe("session-1");
    expect(artifact.jobId).toBe("job-1");
    expect(artifact.stageId).toBe("planning");
    expect(artifact.mode).toBe("discussion");
    expect(artifact.roles).toContain("planner");
    expect(artifact.roles).toContain("architect");
    expect(artifact.startedAt).toBeDefined();
    expect(artifact.completedAt).toBeDefined();
    expect(artifact.nodes).toHaveLength(1);
    expect(artifact.edges).toHaveLength(0);
    expect(artifact.synthesisResult).toBeDefined();
    expect(artifact.synthesisResult!.decision).toBe("Final decision");
    expect(artifact.tokenUsageByRole).toHaveProperty("planner");
    expect(artifact.tokenUsageByRole).toHaveProperty("architect");
    expect(artifact.totalTokenUsage).toBe(350);
    expect(artifact.totalDurationMs).toBeGreaterThan(0);
  });

  it("buildSessionArtifact handles missing completedAt", () => {
    const session = makeMockSession({ completedAt: undefined });
    const artifact = buildSessionArtifact(session);
    expect(artifact.completedAt).toBeDefined();
  });

  it("buildSessionArtifact handles null synthesis result", () => {
    const session = makeMockSession({ synthesisResult: undefined });
    const artifact = buildSessionArtifact(session);
    expect(artifact.synthesisResult).toBeNull();
  });
});

// ─── Replay Timeline Ordering ───────────────────────────────────────────────

describe("BrainstormMemoryStore - Replay Timeline Ordering", () => {
  it("replay response orders nodes by sequenceNumber", () => {
    const store = new BrainstormMemoryStore();
    const artifact = makeArtifact({
      nodes: [
        {
          id: "n3", sessionId: "session-1", parentNodeId: "n2",
          roleId: "architect", type: "thinking", status: "completed",
          title: "Third", createdAt: "2026-01-01T00:00:30.000Z",
          updatedAt: "2026-01-01T00:00:30.000Z", sequenceNumber: 3,
        },
        {
          id: "n1", sessionId: "session-1", parentNodeId: null,
          roleId: "planner", type: "thinking", status: "completed",
          title: "First", createdAt: "2026-01-01T00:00:10.000Z",
          updatedAt: "2026-01-01T00:00:10.000Z", sequenceNumber: 1,
        },
        {
          id: "n2", sessionId: "session-1", parentNodeId: "n1",
          roleId: "planner", type: "action", status: "completed",
          title: "Second", createdAt: "2026-01-01T00:00:20.000Z",
          updatedAt: "2026-01-01T00:00:20.000Z", sequenceNumber: 2,
        },
      ],
    });

    store.persist(artifact);
    const response = handleReplayRequest(store, "job-1", "session-1");

    expect(response.status).toBe(200);
    const body = response.body as any;
    expect(body.nodes[0].sequenceNumber).toBe(1);
    expect(body.nodes[1].sequenceNumber).toBe(2);
    expect(body.nodes[2].sequenceNumber).toBe(3);
  });

  it("replay response includes replay metadata", () => {
    const store = new BrainstormMemoryStore();
    store.persist(makeArtifact());

    const response = handleReplayRequest(store, "job-1", "session-1");
    const body = response.body as any;

    expect(body.replayMetadata).toBeDefined();
    expect(body.replayMetadata.totalNodes).toBe(2);
    expect(body.replayMetadata.totalEdges).toBe(1);
    expect(body.replayMetadata.firstSequence).toBe(1);
    expect(body.replayMetadata.lastSequence).toBe(2);
  });

  it("replay returns 404 for non-existent session", () => {
    const store = new BrainstormMemoryStore();
    const response = handleReplayRequest(store, "job-1", "nonexistent");
    expect(response.status).toBe(404);
  });
});
