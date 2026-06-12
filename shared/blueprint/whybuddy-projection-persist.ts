/**
 * WhyBuddy V5.1 — durable STATE vs DERIVE projection boundary.
 * Node `status` and `projectionDirtyNodeIds` are recomputable from authoritative fields;
 * they must not be written to durable store.
 */

import type { V5SessionState } from "./v5-reasoning-state.js";

/** Remove DERIVE-only projection fields before persisting STATE. */
export function stripProjectionForPersist(state: V5SessionState): V5SessionState {
  const nodes = (state.graph?.nodes || []).map((node) => {
    if (!node) return node;
    if (!Object.prototype.hasOwnProperty.call(node, "status")) return node;
    const { status: _removed, ...rest } = node as typeof node & { status?: unknown };
    return rest as typeof node;
  });

  const { projectionDirtyNodeIds: _dirty, ...restState } = state;
  return {
    ...restState,
    graph: state.graph
      ? { ...state.graph, nodes: nodes as typeof state.graph.nodes }
      : state.graph,
  };
}

/** Test/helper: true when any graph node still carries a persisted `status`. */
export function persistedStateHasNodeStatus(state: V5SessionState): boolean {
  return (state.graph?.nodes || []).some(
    (n) => n != null && Object.prototype.hasOwnProperty.call(n, "status")
  );
}