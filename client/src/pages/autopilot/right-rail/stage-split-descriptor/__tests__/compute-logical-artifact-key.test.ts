/**
 * `.kiro/specs/spec-first-stage-process-artifact-split-uniform/` Batch 1 / Task 1.4
 *
 * Unit tests for `computeLogicalArtifactKey`.
 *
 * Goal:
 * - Cover all 7 explicit logicalKey rows from design.md Component 4
 *   (`clarification_session`, `route_set`, `route_selection`, `spec_tree`,
 *   `intake`, `github_source`, `project_context`) plus the `<other>` fallback
 *   row that lands on `id:${id}`.
 * - Pin down the verified clarification-session fallback chain:
 *     (a) `payload.sessionId` (server shape)
 *     (b) `payload.id` (local shape — `payload: clarificationSession`)
 *     (c) `parseSessionFromArtifactId(artifact.id)` for the
 *         `clarification-session-${id}` prefix
 *     (d) fallback to `id:${id}`
 * - Robustness contract: missing/empty `id` returns a non-empty placeholder
 *   key (so unmergeable rows still pass through `mergeLogicalArtifacts`),
 *   and the function is stable across calls (no `Date.now()` / no random).
 *
 * NOTE: Task 1.4 is plain unit tests only. Property-based testing belongs to
 * Task 1.6 and is NOT in scope here.
 */

import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationArtifactType,
} from "@shared/blueprint/contracts";

import { computeLogicalArtifactKey } from "../merge-logical-artifacts";

// ───────────────────────────────────────────────────────────────────────────
// Builders
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal `BlueprintGenerationArtifact`. Tests only care about
 * `id / type / payload` (and sometimes `createdAt`); the other fields are
 * filled with stable defaults so the contract `BlueprintGenerationArtifact`
 * is satisfied. We use a single `as` cast at the boundary to keep the
 * builder readable per the task's implementation guidance.
 */
function makeArtifact(overrides: {
  id?: string;
  type?: BlueprintGenerationArtifactType;
  payload?: unknown;
  title?: string;
  summary?: string;
  createdAt?: string;
}): BlueprintGenerationArtifact {
  return {
    id: overrides.id ?? "blueprint-artifact-x",
    type: overrides.type ?? "clarification_session",
    title: overrides.title ?? "test artifact",
    summary: overrides.summary ?? "test summary",
    createdAt: overrides.createdAt ?? "2026-05-22T10:00:00.000Z",
    payload: overrides.payload,
  } as BlueprintGenerationArtifact;
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe("computeLogicalArtifactKey — clarification_session fallback chain", () => {
  it("(a) uses payload.sessionId (server-shape) when present", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-9f2c",
      type: "clarification_session",
      payload: { sessionId: "S-1" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("clar:S-1");
  });

  it("(b) falls back to payload.id (local-shape: payload: clarificationSession)", () => {
    // Local artifact stores the clarification session itself as payload, whose
    // identifier field is named `id` (not `sessionId`). The fallback chain
    // must collide with the server-shape so the same logical session merges
    // into a single card.
    const localArtifact = makeArtifact({
      id: "clarification-session-S-1",
      type: "clarification_session",
      payload: { id: "S-1", questions: [{ id: "q1" }], answers: [] },
    });
    expect(computeLogicalArtifactKey(localArtifact)).toBe("clar:S-1");
  });

  it("(b) prefers payload.sessionId over payload.id when both are present", () => {
    // Defensive: if a payload happens to carry both fields, server-shape wins
    // because it is checked first. This pins down the fallback ordering.
    const artifact = makeArtifact({
      id: "blueprint-artifact-9f2c",
      type: "clarification_session",
      payload: { sessionId: "S-server", id: "S-local" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("clar:S-server");
  });

  it("(c) parses sessionId from artifact.id when both payload.sessionId and payload.id are missing", () => {
    const artifact = makeArtifact({
      id: "clarification-session-S-1",
      type: "clarification_session",
      payload: undefined,
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("clar:S-1");
  });

  it("(c) treats empty-string payload.sessionId / payload.id as missing and falls through to artifact.id prefix", () => {
    // Per JSDoc: empty strings are treated as missing so the fallback chain
    // can keep trying. This must still resolve to the parsed prefix.
    const artifact = makeArtifact({
      id: "clarification-session-S-2",
      type: "clarification_session",
      payload: { sessionId: "", id: "" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("clar:S-2");
  });

  it("(d) falls back to clar:${id} when sessionId/id are missing AND artifact.id has no prefix", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-no-prefix",
      type: "clarification_session",
      payload: { unrelated: "value" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe(
      "clar:blueprint-artifact-no-prefix",
    );
  });

  it("ignores non-string payload.sessionId values and falls through", () => {
    // Numbers, booleans, objects, arrays, null are not non-empty strings →
    // the fallback chain keeps walking. Here we only have artifact.id to
    // resort to.
    const artifact = makeArtifact({
      id: "blueprint-artifact-zz",
      type: "clarification_session",
      payload: { sessionId: 123, id: { nested: true } },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe(
      "clar:blueprint-artifact-zz",
    );
  });

  it("treats array / primitive payloads as missing and falls through to artifact.id", () => {
    const artifact = makeArtifact({
      id: "clarification-session-S-3",
      type: "clarification_session",
      payload: ["not", "an", "object"],
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("clar:S-3");
  });
});

describe("computeLogicalArtifactKey — non-clarification rows from design.md Component 4", () => {
  it("route_set uses payload.routeSetId when present", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-rs-1",
      type: "route_set",
      payload: { routeSetId: "RS-1" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("route_set:RS-1");
  });

  it("route_set falls back to artifact.id when payload.routeSetId is missing", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-rs-x",
      type: "route_set",
      payload: undefined,
    });
    expect(computeLogicalArtifactKey(artifact)).toBe(
      "route_set:blueprint-artifact-rs-x",
    );
  });

  it("route_selection uses payload.selectionId when present", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-sel-1",
      type: "route_selection",
      payload: { selectionId: "SEL-1" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("route_sel:SEL-1");
  });

  it("route_selection falls back to artifact.id when payload.selectionId is missing", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-sel-x",
      type: "route_selection",
      payload: {},
    });
    expect(computeLogicalArtifactKey(artifact)).toBe(
      "route_sel:blueprint-artifact-sel-x",
    );
  });

  it("spec_tree uses payload.treeId when present", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-tree-1",
      type: "spec_tree",
      payload: { treeId: "TREE-1" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("spec_tree:TREE-1");
  });

  it("spec_tree falls back to artifact.id when payload.treeId is missing", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-tree-x",
      type: "spec_tree",
      payload: { unrelated: "value" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe(
      "spec_tree:blueprint-artifact-tree-x",
    );
  });

  it("intake uses payload.intakeId when present", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-intake-1",
      type: "intake",
      payload: { intakeId: "IN-1" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("intake:IN-1");
  });

  it("intake falls back to artifact.id when payload.intakeId is missing", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-intake-x",
      type: "intake",
      payload: undefined,
    });
    expect(computeLogicalArtifactKey(artifact)).toBe(
      "intake:blueprint-artifact-intake-x",
    );
  });

  it("github_source uses payload.normalizedUrl when present", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-gh-1",
      type: "github_source",
      payload: { normalizedUrl: "https://github.com/owner/repo" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe(
      "gh:https://github.com/owner/repo",
    );
  });

  it("github_source falls back to artifact.id when payload.normalizedUrl is missing", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-gh-x",
      type: "github_source",
      payload: {},
    });
    expect(computeLogicalArtifactKey(artifact)).toBe(
      "gh:blueprint-artifact-gh-x",
    );
  });

  it("project_context uses payload.projectId when present", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-pctx-1",
      type: "project_context",
      payload: { projectId: "PRJ-1" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("pctx:PRJ-1");
  });

  it("project_context falls back to artifact.id when payload.projectId is missing", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-pctx-x",
      type: "project_context",
      payload: undefined,
    });
    expect(computeLogicalArtifactKey(artifact)).toBe(
      "pctx:blueprint-artifact-pctx-x",
    );
  });
});

describe("computeLogicalArtifactKey — <other> fallback row", () => {
  it("unknown / unmapped artifact types fall back to id:${id}", () => {
    // `requirements` is a legal `BlueprintGenerationArtifactType` but is NOT
    // one of the 7 rows in design.md Component 4 — it must drop to the
    // `<other>` fallback row.
    const artifact = makeArtifact({
      id: "doc-requirements-1",
      type: "requirements",
      payload: { something: "else" },
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("id:doc-requirements-1");
  });

  it("agent_crew falls back to id:${id} as well (sample of fabric type outside the 7 rows)", () => {
    const artifact = makeArtifact({
      id: "agent-crew-42",
      type: "agent_crew",
      payload: undefined,
    });
    expect(computeLogicalArtifactKey(artifact)).toBe("id:agent-crew-42");
  });
});

describe("computeLogicalArtifactKey — robustness contract", () => {
  it("returns a non-empty placeholder key when artifact.id is missing for an <other> type", () => {
    // Design contract: missing/empty id MUST NOT yield an empty key, so
    // unmergeable rows still pass through `mergeLogicalArtifacts` without
    // collapsing the merge loop.
    const artifact = makeArtifact({
      id: "",
      type: "requirements",
      payload: undefined,
    });
    const key = computeLogicalArtifactKey(artifact);
    expect(key).not.toBe("");
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("returns a non-empty placeholder key when artifact.id is missing for clarification_session with no payload", () => {
    const artifact = makeArtifact({
      id: "",
      type: "clarification_session",
      payload: undefined,
    });
    const key = computeLogicalArtifactKey(artifact);
    expect(key).not.toBe("");
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("is stable across repeated calls for the same input (no Date.now / random)", () => {
    const artifact = makeArtifact({
      id: "blueprint-artifact-9f2c",
      type: "clarification_session",
      payload: { sessionId: "S-1" },
    });
    const k1 = computeLogicalArtifactKey(artifact);
    const k2 = computeLogicalArtifactKey(artifact);
    const k3 = computeLogicalArtifactKey(artifact);
    expect(k1).toBe(k2);
    expect(k2).toBe(k3);
    expect(k1).toBe("clar:S-1");
  });

  it("is stable for <other> row across repeated calls", () => {
    const artifact = makeArtifact({
      id: "agent-crew-42",
      type: "agent_crew",
    });
    const k1 = computeLogicalArtifactKey(artifact);
    const k2 = computeLogicalArtifactKey(artifact);
    expect(k1).toBe(k2);
    expect(k1).toBe("id:agent-crew-42");
  });
});
