/**
 * @description Brainstorm Memory Store — persists and retrieves brainstorm
 * session artifacts for replay and provenance. Uses an in-memory Map for
 * storage following the project's local JSON pattern.
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §6
 * Requirements: 8.4, 9.1, 9.2, 9.3, 9.4, 9.5
 */

import type {
  BrainstormSession,
  BrainstormSessionArtifact,
  BranchNode,
  BranchEdge,
  SynthesisResult,
  BrainstormRoleId,
} from "../../../../shared/blueprint/brainstorm-contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event emitter function signature — injectable for testing. */
export type EventEmitterFn = (
  eventType: string,
  payload: Record<string, unknown>,
) => void;

// ---------------------------------------------------------------------------
// Memory Store
// ---------------------------------------------------------------------------

export class BrainstormMemoryStore {
  /** Composite key: `${jobId}::${sessionId}` → artifact */
  private store: Map<string, BrainstormSessionArtifact> = new Map();

  constructor(private readonly emitEvent?: EventEmitterFn) {}

  // ─── Persistence ──────────────────────────────────────────────────────────

  /**
   * Persist a brainstorm session artifact to the store.
   * Keyed by composite `jobId::sessionId`.
   */
  persist(artifact: BrainstormSessionArtifact): void {
    const key = this.compositeKey(artifact.jobId, artifact.sessionId);
    this.store.set(key, structuredClone(artifact));
  }

  // ─── Retrieval ────────────────────────────────────────────────────────────

  /**
   * Retrieve a session artifact by job ID and session ID.
   * Returns undefined if not found.
   */
  retrieve(
    jobId: string,
    sessionId: string,
  ): BrainstormSessionArtifact | undefined {
    const key = this.compositeKey(jobId, sessionId);
    const artifact = this.store.get(key);
    return artifact ? structuredClone(artifact) : undefined;
  }

  /**
   * List all session artifacts for a given job ID.
   * Returns artifacts sorted by startedAt ascending.
   */
  listByJob(jobId: string): BrainstormSessionArtifact[] {
    const results: BrainstormSessionArtifact[] = [];
    for (const [key, artifact] of this.store) {
      if (key.startsWith(`${jobId}::`)) {
        results.push(structuredClone(artifact));
      }
    }
    return results.sort(
      (a, b) =>
        new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private compositeKey(jobId: string, sessionId: string): string {
    return `${jobId}::${sessionId}`;
  }

  /**
   * Get total number of stored artifacts (for diagnostics).
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Clear all stored artifacts (for testing).
   */
  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Session → Artifact Builder
// ---------------------------------------------------------------------------

/**
 * Build a BrainstormSessionArtifact from a completed BrainstormSession.
 * Called by the orchestrator when a session reaches synthesis completion.
 */
export function buildSessionArtifact(
  session: BrainstormSession,
): BrainstormSessionArtifact {
  const completedAt = session.completedAt ?? new Date();
  const startedAt = session.startedAt;
  const totalDurationMs = completedAt.getTime() - startedAt.getTime();

  // Build token usage breakdown by role
  const tokenUsageByRole: Record<string, number> = {};
  for (const [roleId, member] of session.crewMembers) {
    tokenUsageByRole[roleId] = member.tokenUsage;
  }

  return {
    sessionId: session.id,
    jobId: session.jobId,
    stageId: session.stageId,
    mode: session.mode,
    roles: Array.from(session.crewMembers.keys()),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    nodes: session.branchNodes.map((n) => ({ ...n })),
    edges: session.edges.map((e) => ({ ...e })),
    synthesisResult: session.synthesisResult ?? null,
    tokenUsageByRole,
    totalTokenUsage: session.tokenUsed,
    totalDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Replay API Handler
// ---------------------------------------------------------------------------

/**
 * Replay API route handler.
 * Returns the full session artifact with nodes ordered by sequenceNumber
 * for frontend replay animation.
 *
 * Usage: GET /api/blueprint/jobs/:id/brainstorm/:sessionId
 */
export function handleReplayRequest(
  memoryStore: BrainstormMemoryStore,
  jobId: string,
  sessionId: string,
): { status: number; body: unknown } {
  const artifact = memoryStore.retrieve(jobId, sessionId);

  if (!artifact) {
    return {
      status: 404,
      body: { error: "Brainstorm session not found", jobId, sessionId },
    };
  }

  // Ensure nodes are chronologically ordered by sequenceNumber for replay
  const replayTimeline = [...artifact.nodes].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber,
  );

  return {
    status: 200,
    body: {
      ...artifact,
      nodes: replayTimeline,
      replayMetadata: {
        totalNodes: replayTimeline.length,
        totalEdges: artifact.edges.length,
        firstSequence: replayTimeline[0]?.sequenceNumber ?? 0,
        lastSequence:
          replayTimeline[replayTimeline.length - 1]?.sequenceNumber ?? 0,
      },
    },
  };
}
