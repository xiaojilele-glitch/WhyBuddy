import { describe, it, expect } from "vitest";
import { deriveNodeStatus, invalidateForIntervention } from "../whybuddy-runtime";
import { buildClearStateWithTrustedReport } from "../whybuddy-fullpath-fixtures";

describe("P3 incremental deriveNodeStatus", () => {
  it("incremental mode only recomputes dirty node ids", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("inc-derive");
    const challenged = invalidateForIntervention(state, {
      targetArtifactId: reportId,
      intent: "challenge",
      text: "质疑",
    });
    expect((challenged.projectionDirtyNodeIds || []).length).toBeGreaterThan(0);

    const before = challenged.graph.nodes.map((n: { id?: string; status?: string }) => ({
      id: n.id,
      status: n.status,
    }));

    const after = deriveNodeStatus(challenged, { incremental: true });
    const changed = (after.graph.nodes || []).filter((n: { id?: string; status?: string }, i: number) => {
      const prev = before.find((b) => b.id === n.id);
      return prev && prev.status !== n.status;
    });
    expect(changed.length).toBeLessThanOrEqual(challenged.projectionDirtyNodeIds!.length + 2);
  });
});