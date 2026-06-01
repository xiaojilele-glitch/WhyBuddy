/**
 * whybuddy-spec-tree-progress-merge-2026-05-29 §6 — `deriveNodeStatusById` 单元
 * 测试。守护双源合并的优先级与边界：
 *
 * - persisted artifacts 给所有出现节点 baseline `completed`；
 * - live progress 在 batchStatus 守门下覆盖 baseline；
 * - `assembled` 在 view 层等价 `completed`；
 * - stale guard：batch 不在 running/assembling 时，过滤 stale pending/processing；
 * - 空 / 缺失输入安全（pending 由 view 层兜底，本函数不强制写 pending）。
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  SpecDocsNodeEntry,
  SpecDocsProgressState,
} from "@/lib/blueprint-realtime-store";
import type { BlueprintSpecDocument } from "@shared/blueprint/contracts";

import { deriveNodeStatusById } from "../derive-node-status-by-id";

function makeDoc(nodeId: string, type: "requirements" | "design" | "tasks" = "requirements"): BlueprintSpecDocument {
  return {
    id: `doc-${nodeId}-${type}`,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId,
    type,
    status: "accepted",
    title: `${type} for ${nodeId}`,
    summary: "",
    content: "",
    format: "markdown",
    createdAt: "2026-05-29T07:00:00.000Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "route_step",
      nodeTitle: nodeId,
      nodeSummary: "",
      dependencies: [],
      outputs: [],
      generationSource: "llm",
    },
  } as unknown as BlueprintSpecDocument;
}

function makeLiveNode(
  id: string,
  status: SpecDocsNodeEntry["status"],
  extra: Partial<SpecDocsNodeEntry> = {}
): SpecDocsNodeEntry {
  return {
    nodeId: id,
    title: id,
    position: 0,
    status,
    ...extra,
  };
}

const RUNNING: SpecDocsProgressState["batchStatus"] = "running";
const FINISHED: SpecDocsProgressState["batchStatus"] = "finished";
const IDLE: SpecDocsProgressState["batchStatus"] = "idle";

describe("deriveNodeStatusById", () => {
  it("returns empty when both inputs are empty", () => {
    expect(
      deriveNodeStatusById({
        persistedSpecDocuments: undefined,
        liveProgressNodes: {},
        liveBatchStatus: IDLE,
      })
    ).toEqual({});
  });

  it("baselines every node that has at least one persisted doc to completed", () => {
    const out = deriveNodeStatusById({
      persistedSpecDocuments: [
        makeDoc("n-a", "requirements"),
        makeDoc("n-a", "design"),
        makeDoc("n-b", "tasks"),
      ],
      liveProgressNodes: {},
      liveBatchStatus: IDLE,
    });
    expect(out["n-a"]).toEqual({ status: "completed" });
    expect(out["n-b"]).toEqual({ status: "completed" });
  });

  it("collapses live `assembled` into `completed` (terminal, always overlays)", () => {
    const out = deriveNodeStatusById({
      persistedSpecDocuments: undefined,
      liveProgressNodes: {
        "n-a": makeLiveNode("n-a", "assembled"),
      },
      liveBatchStatus: FINISHED,
    });
    expect(out["n-a"]).toEqual({ status: "completed" });
  });

  it("during a running batch, live `processing` overrides persisted baseline (regenerate flow)", () => {
    const out = deriveNodeStatusById({
      persistedSpecDocuments: [makeDoc("n-a", "requirements")],
      liveProgressNodes: {
        "n-a": makeLiveNode("n-a", "processing"),
      },
      liveBatchStatus: RUNNING,
    });
    // Without override the baseline would be "completed" — but a live retry
    // is in flight so the row must show "processing".
    expect(out["n-a"].status).toBe("processing");
  });

  it("when batch is idle, stale `processing` from a prior run is IGNORED (parent does not spin while user clicks a sibling)", () => {
    // Reproduces the screenshot bug: prior 全部生成 left a parent node stuck at
    // processing because batch_finished was never received. User then clicks
    // a single child node (single-node path emits NO progress events). The
    // baseline (persisted completed) must win — the parent should not spin.
    const out = deriveNodeStatusById({
      persistedSpecDocuments: [makeDoc("n-parent", "requirements")],
      liveProgressNodes: {
        "n-parent": makeLiveNode("n-parent", "processing"),
      },
      liveBatchStatus: IDLE,
    });
    expect(out["n-parent"]).toEqual({ status: "completed" });
  });

  it("when batch is finished, stale `processing` from a prior run is IGNORED", () => {
    const out = deriveNodeStatusById({
      persistedSpecDocuments: [makeDoc("n-parent")],
      liveProgressNodes: {
        "n-parent": makeLiveNode("n-parent", "processing"),
      },
      liveBatchStatus: FINISHED,
    });
    expect(out["n-parent"]).toEqual({ status: "completed" });
  });

  it("stale `pending` from a prior batch_init never overrides persisted baseline", () => {
    const out = deriveNodeStatusById({
      persistedSpecDocuments: [makeDoc("n-a")],
      liveProgressNodes: {
        "n-a": makeLiveNode("n-a", "pending"),
      },
      liveBatchStatus: IDLE,
    });
    expect(out["n-a"].status).toBe("completed");
  });

  it("terminal `failed` is preserved across batchStatus values (no persisted doc tombstones)", () => {
    // Failed nodes have no persisted artifact to fall back on; if we drop
    // their live failed state we'd render them as the absent default and
    // lose the operator's only signal that this node failed.
    for (const status of [IDLE, RUNNING, FINISHED] as const) {
      const out = deriveNodeStatusById({
        persistedSpecDocuments: [],
        liveProgressNodes: {
          "n-fail": makeLiveNode("n-fail", "failed", {
            errorSummary: "agent timeout",
          }),
        },
        liveBatchStatus: status,
      });
      expect(out["n-fail"]).toEqual({
        status: "failed",
        errorSummary: "agent timeout",
      });
    }
  });

  it("preserves wasRetried + errorSummary when live state carries them", () => {
    const out = deriveNodeStatusById({
      persistedSpecDocuments: [makeDoc("n-a", "design")],
      liveProgressNodes: {
        "n-a": makeLiveNode("n-a", "completed", {
          wasRetried: true,
          errorSummary: "agent timeout",
        }),
      },
      liveBatchStatus: FINISHED,
    });
    expect(out["n-a"]).toEqual({
      status: "completed",
      wasRetried: true,
      errorSummary: "agent timeout",
    });
  });

  it("does not synthesise wasRetried / errorSummary when they are absent", () => {
    const out = deriveNodeStatusById({
      persistedSpecDocuments: [makeDoc("n-a")],
      liveProgressNodes: {
        "n-a": makeLiveNode("n-a", "completed"),
      },
      liveBatchStatus: FINISHED,
    });
    expect(out["n-a"]).toEqual({ status: "completed" });
    expect(out["n-a"].wasRetried).toBeUndefined();
    expect(out["n-a"].errorSummary).toBeUndefined();
  });

  it("nodes with no persisted doc and no live entry are absent (view falls back to pending)", () => {
    const out = deriveNodeStatusById({
      persistedSpecDocuments: [makeDoc("n-a")],
      liveProgressNodes: {
        "n-b": makeLiveNode("n-b", "processing"),
      },
      liveBatchStatus: RUNNING,
    });
    expect(out["n-a"].status).toBe("completed");
    expect(out["n-b"].status).toBe("processing");
    expect(out["n-c"]).toBeUndefined();
  });

  it("PBT: under running/assembling, live status (assembled→completed collapse) always wins", () => {
    const arbStatus = fc.constantFrom(
      "pending",
      "processing",
      "completed",
      "failed",
      "assembled"
    ) as fc.Arbitrary<SpecDocsNodeEntry["status"]>;
    const arbActiveBatch = fc.constantFrom(
      "running",
      "assembling"
    ) as fc.Arbitrary<SpecDocsProgressState["batchStatus"]>;

    fc.assert(
      fc.property(
        arbStatus,
        fc.boolean(),
        arbActiveBatch,
        (live, hasPersisted, batch) => {
          const out = deriveNodeStatusById({
            persistedSpecDocuments: hasPersisted ? [makeDoc("n-a")] : undefined,
            liveProgressNodes: { "n-a": makeLiveNode("n-a", live) },
            liveBatchStatus: batch,
          });
          const expected = live === "assembled" ? "completed" : live;
          expect(out["n-a"].status).toBe(expected);
        }
      ),
      { numRuns: 60 }
    );
  });

  it("PBT: under idle/finished, non-terminal live state never overrides persisted completed", () => {
    const arbStaleNonTerminal = fc.constantFrom(
      "pending",
      "processing"
    ) as fc.Arbitrary<SpecDocsNodeEntry["status"]>;
    const arbInactiveBatch = fc.constantFrom(
      "idle",
      "finished"
    ) as fc.Arbitrary<SpecDocsProgressState["batchStatus"]>;

    fc.assert(
      fc.property(
        arbStaleNonTerminal,
        arbInactiveBatch,
        (stale, batch) => {
          const out = deriveNodeStatusById({
            persistedSpecDocuments: [makeDoc("n-a")],
            liveProgressNodes: { "n-a": makeLiveNode("n-a", stale) },
            liveBatchStatus: batch,
          });
          // Persisted baseline must hold; stale non-terminal live state is dropped.
          expect(out["n-a"].status).toBe("completed");
        }
      ),
      { numRuns: 50 }
    );
  });
});
