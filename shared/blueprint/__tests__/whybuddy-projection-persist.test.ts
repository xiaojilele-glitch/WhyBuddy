import { describe, it, expect } from "vitest";
import {
  stripProjectionForPersist,
  persistedStateHasNodeStatus,
} from "../whybuddy-projection-persist";
import type { V5SessionState } from "../v5-reasoning-state";

describe("stripProjectionForPersist", () => {
  it("removes graph.nodes[].status and projectionDirtyNodeIds", () => {
    const state = {
      sessionId: "strip-test",
      goal: { text: "goal", status: "needs_refinement" },
      graph: {
        nodes: [
          { id: "n1", type: "hypothesis", title: "a", status: "completed" },
          { id: "n2", type: "risk", title: "b", status: "active" },
        ],
        edges: [],
      },
      artifacts: [],
      staleArtifactIds: [],
      decisionLedger: [],
      capabilityRuns: [],
      projectionDirtyNodeIds: ["n1"],
    } as unknown as V5SessionState;

    const stripped = stripProjectionForPersist(state);
    expect(persistedStateHasNodeStatus(stripped)).toBe(false);
    expect(stripped.projectionDirtyNodeIds).toBeUndefined();
    expect(stripped.goal).toEqual(state.goal);
    expect((stripped.graph.nodes || []).map((n) => n.id)).toEqual(["n1", "n2"]);
  });
});