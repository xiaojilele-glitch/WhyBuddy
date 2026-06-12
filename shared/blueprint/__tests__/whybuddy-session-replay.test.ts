import { describe, it, expect } from "vitest";
import {
  applyReplayOnSave,
  collectReplayDelta,
  replayEventsBelongToSession,
  replaySessionEvents,
} from "../whybuddy-session-replay";
import type { V5SessionState } from "../v5-reasoning-state";

function minimalState(sessionId: string, overrides: Partial<V5SessionState> = {}): V5SessionState {
  return {
    sessionId,
    goal: { text: "goal", status: "needs_refinement" },
    graph: { nodes: [], edges: [] },
    artifacts: [],
    conversation: [],
    openQuestions: [],
    evidence: [],
    decisions: [],
    risks: [],
    capabilityRuns: [],
    gates: [],
    dependencyGraph: [],
    staleArtifactIds: [],
    ...overrides,
  } as V5SessionState;
}

describe("whybuddy-session-replay", () => {
  it("collectReplayDelta emits capability_run, conversation, and decision events", () => {
    const prev = minimalState("s1", {
      capabilityRuns: [],
      conversation: [],
      decisionLedger: [],
    });
    const next = minimalState("s1", {
      capabilityRuns: [
        {
          id: "run-1",
          capabilityId: "risk.analyze",
          inputs: [],
          outputs: [],
          gateResults: [],
          turnId: "t1",
        },
      ],
      conversation: [{ id: "conv-1", role: "user", text: "hi" }],
      decisionLedger: [
        {
          id: "dec-1",
          turnId: "t1",
          saw: [],
          chose: ["risk.analyze"],
          skipped: [],
          addresses: [],
          rationale: "pick",
          alternativesRejected: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const delta = collectReplayDelta(prev, next);
    expect(delta.map((e) => e.kind).sort()).toEqual(["capability_run", "conversation", "decision"]);
    expect(delta.every((e) => e.sessionId === "s1")).toBe(true);
  });

  it("applyReplayOnSave appends only new events across saves", () => {
    const base = minimalState("s2");
    const first = applyReplayOnSave(undefined, {
      ...base,
      conversation: [{ id: "c1", role: "user", text: "one" }],
    });
    expect(first.sessionReplayLog?.length).toBe(1);

    const second = applyReplayOnSave(first, {
      ...first,
      conversation: [
        ...(first.conversation || []),
        { id: "c2", role: "user", text: "two" },
      ],
    });
    expect(second.sessionReplayLog?.length).toBe(2);
    expect(replaySessionEvents(second).map((e) => e.conversationId)).toEqual(["c1", "c2"]);
  });

  it("applyReplayOnSave preserves previous log when client sends empty sessionReplayLog", () => {
    const prev = minimalState("s3", {
      sessionReplayLog: [
        {
          id: "old-replay",
          sessionId: "s3",
          at: "2026-01-01T00:00:00.000Z",
          kind: "conversation",
          conversationId: "old-conv",
        },
      ],
      conversation: [{ id: "old-conv", role: "user", text: "old" }],
    });
    const next = minimalState("s3", {
      sessionReplayLog: [],
      conversation: [{ id: "old-conv", role: "user", text: "old" }],
    });
    const merged = applyReplayOnSave(prev, next);
    expect(merged.sessionReplayLog?.map((e) => e.conversationId)).toEqual(["old-conv"]);
  });

  it("replaySessionEvents is isolated by sessionId", () => {
    const polluted = minimalState("session-A", {
      sessionReplayLog: [
        {
          id: "e-a",
          sessionId: "session-A",
          at: "2026-01-01T00:00:00.000Z",
          kind: "conversation",
          conversationId: "a-conv",
        },
        {
          id: "e-b",
          sessionId: "session-B",
          at: "2026-01-01T00:00:00.000Z",
          kind: "conversation",
          conversationId: "b-conv",
        },
      ],
    });

    const replayA = replaySessionEvents(polluted);
    expect(replayA).toHaveLength(1);
    expect(replayA[0].conversationId).toBe("a-conv");
    expect(replayEventsBelongToSession(replayA, "session-A")).toBe(true);
  });
});