/**
 * Property-based tests for the specDocsProgress slice of BlueprintRealtimeStore.
 *
 * Covers Properties 2, 3, 4, 6, 7 from the design document.
 * Uses fast-check with 100 runs per property.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Mock Socket.IO
// ---------------------------------------------------------------------------

const mockSocket = {
  connected: false,
  on: vi.fn(() => mockSocket),
  off: vi.fn(() => mockSocket),
  emit: vi.fn(),
  disconnect: vi.fn(),
} as unknown as Socket;

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

// ---------------------------------------------------------------------------
// Import store after mocks
// ---------------------------------------------------------------------------

import {
  useBlueprintRealtimeStore,
  __setSocket,
  type BlueprintRelayedEvent,
  type SpecDocsProgressState,
  INITIAL_SPEC_DOCS_PROGRESS,
} from "../blueprint-realtime-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useBlueprintRealtimeStore.getState().reset();
  vi.clearAllMocks();
}

function getProgress(): SpecDocsProgressState {
  return useBlueprintRealtimeStore.getState().specDocsProgress;
}

function createSpecDocsEvent(
  action: string,
  payload: Record<string, unknown>
): BlueprintRelayedEvent {
  return {
    type: "role.agent.observing",
    jobId: "test-job",
    timestamp: Date.now(),
    payload: {
      stageId: "spec_docs",
      roleId: "generator",
      progressAction: action,
      iteration: 1,
      ...payload,
    },
  };
}

function dispatchBatchInit(nodeIds: string[]): void {
  const event = createSpecDocsEvent("batch_init", {
    totalCount: nodeIds.length,
    nodeIds,
  });
  useBlueprintRealtimeStore.getState().dispatchEvent(event);
}

function dispatchNodeStarted(nodeId: string, position = 1): void {
  const event = createSpecDocsEvent("node_started", {
    nodeId,
    nodeTitle: `Title for ${nodeId}`,
    position,
  });
  useBlueprintRealtimeStore.getState().dispatchEvent(event);
}

function dispatchNodeCompleted(nodeId: string, completedCount: number): void {
  const event = createSpecDocsEvent("node_completed", {
    nodeId,
    completedCount,
  });
  useBlueprintRealtimeStore.getState().dispatchEvent(event);
}

function dispatchNodeFailed(nodeId: string, errorSummary: string): void {
  const event = createSpecDocsEvent("node_failed", {
    nodeId,
    errorSummary,
  });
  useBlueprintRealtimeStore.getState().dispatchEvent(event);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a unique node ID */
const arbNodeId = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0)
  .map((s) => `node-${s.replace(/[^a-zA-Z0-9_-]/g, "x")}`);

/** Generate a list of 1-200 unique node IDs */
const arbNodeIds = fc
  .integer({ min: 1, max: 200 })
  .chain((count) =>
    fc.array(fc.uuid(), { minLength: count, maxLength: count })
  );

// ---------------------------------------------------------------------------
// Property 2: Store initialization and reset from batch_init
// Validates: Requirements 2.1, 2.6
// ---------------------------------------------------------------------------

describe("Property 2: Store initialization and reset from batch_init", () => {
  beforeEach(() => {
    __setSocket(mockSocket);
    resetStore();
  });

  afterEach(() => {
    resetStore();
    __setSocket(null);
  });

  it("batch_init creates correct initial state for any list of 1-200 node IDs", () => {
    fc.assert(
      fc.property(arbNodeIds, (nodeIds) => {
        // Reset before each run
        useBlueprintRealtimeStore.getState().reset();

        dispatchBatchInit(nodeIds);

        const progress = getProgress();

        // batchStatus should be "running"
        expect(progress.batchStatus).toBe("running");

        // totalCount should equal node count (capped at 200)
        expect(progress.totalCount).toBe(Math.min(nodeIds.length, 200));

        // All listed nodes should have status "pending"
        for (const id of nodeIds) {
          expect(progress.nodes[id]).toBeDefined();
          expect(progress.nodes[id].status).toBe("pending");
        }

        // completedCount and processedCount should be 0
        expect(progress.completedCount).toBe(0);
        expect(progress.processedCount).toBe(0);

        // nodeOrder should match the input
        expect(progress.nodeOrder).toEqual(nodeIds);

        // summary should be null
        expect(progress.summary).toBeNull();

        // dismissed should be false
        expect(progress.dismissed).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("batch_init resets existing state including dismissed flag", () => {
    fc.assert(
      fc.property(arbNodeIds, arbNodeIds, (firstBatch, secondBatch) => {
        // Reset before each run
        useBlueprintRealtimeStore.getState().reset();

        // Initialize first batch
        dispatchBatchInit(firstBatch);

        // Simulate some progress on first batch
        if (firstBatch.length > 0) {
          dispatchNodeStarted(firstBatch[0], 1);
          dispatchNodeCompleted(firstBatch[0], 1);
        }

        // Dismiss the panel
        useBlueprintRealtimeStore.getState().dismissSpecDocsProgress();
        expect(getProgress().dismissed).toBe(true);

        // Now dispatch a new batch_init — should fully reset
        dispatchBatchInit(secondBatch);

        const progress = getProgress();

        // Verify full reset
        expect(progress.batchStatus).toBe("running");
        expect(progress.totalCount).toBe(Math.min(secondBatch.length, 200));
        expect(progress.completedCount).toBe(0);
        expect(progress.processedCount).toBe(0);
        expect(progress.dismissed).toBe(false);
        expect(progress.summary).toBeNull();
        expect(progress.nodeOrder).toEqual(secondBatch);

        // All nodes from second batch should be pending
        for (const id of secondBatch) {
          expect(progress.nodes[id].status).toBe("pending");
        }

        // Nodes from first batch should NOT be present (unless also in second batch)
        for (const id of firstBatch) {
          if (!secondBatch.includes(id)) {
            expect(progress.nodes[id]).toBeUndefined();
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Valid state transitions update status and counters correctly
// Validates: Requirements 2.2, 2.3, 2.4
// ---------------------------------------------------------------------------

describe("Property 3: Valid state transitions update status and counters correctly", () => {
  beforeEach(() => {
    __setSocket(mockSocket);
    resetStore();
  });

  afterEach(() => {
    resetStore();
    __setSocket(null);
  });

  it("pending → processing, processing → completed, processing → failed transitions work correctly", () => {
    fc.assert(
      fc.property(
        arbNodeIds.filter((ids) => ids.length >= 2),
        fc.float({ min: 0, max: 1 }),
        (nodeIds, failRatio) => {
          useBlueprintRealtimeStore.getState().reset();

          dispatchBatchInit(nodeIds);

          let expectedCompleted = 0;
          let expectedProcessed = 0;
          let failedNodeCount = 0;

          for (let i = 0; i < nodeIds.length; i++) {
            const nodeId = nodeIds[i];

            // Verify pending → processing
            dispatchNodeStarted(nodeId, i + 1);
            const afterStart = getProgress();
            expect(afterStart.nodes[nodeId].status).toBe("processing");

            // Decide whether to complete or fail based on position and failRatio
            const shouldFail = i / nodeIds.length < failRatio && i % 2 === 0;

            if (shouldFail) {
              // processing → failed
              dispatchNodeFailed(nodeId, `Error for node ${nodeId}`);
              expectedProcessed++;
              failedNodeCount++;

              const afterFail = getProgress();
              expect(afterFail.nodes[nodeId].status).toBe("failed");
              expect(afterFail.nodes[nodeId].errorSummary).toBeDefined();
            } else {
              // processing → completed
              expectedCompleted++;
              expectedProcessed++;
              dispatchNodeCompleted(nodeId, expectedCompleted);

              const afterComplete = getProgress();
              expect(afterComplete.nodes[nodeId].status).toBe("completed");
            }

            // Verify counters invariant at every step
            const current = getProgress();
            expect(current.processedCount).toBe(expectedProcessed);
            expect(current.completedCount).toBe(expectedCompleted);

            // Invariant: processedCount === completedCount + failedNodeCount
            expect(current.processedCount).toBe(
              expectedCompleted + failedNodeCount
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("completedCount only increments on success, processedCount increments on both", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.array(fc.boolean(), { minLength: 2, maxLength: 20 }),
        (count, outcomes) => {
          useBlueprintRealtimeStore.getState().reset();

          const nodeIds = Array.from(
            { length: count },
            (_, i) => `node-${i}-${Math.random().toString(36).slice(2, 6)}`
          );
          const effectiveOutcomes = outcomes.slice(0, count);

          dispatchBatchInit(nodeIds);

          let expectedCompleted = 0;
          let expectedFailed = 0;

          for (let i = 0; i < nodeIds.length; i++) {
            dispatchNodeStarted(nodeIds[i], i + 1);

            const shouldSucceed = effectiveOutcomes[i] ?? true;
            if (shouldSucceed) {
              expectedCompleted++;
              dispatchNodeCompleted(nodeIds[i], expectedCompleted);
            } else {
              expectedFailed++;
              dispatchNodeFailed(nodeIds[i], "some error");
            }
          }

          const progress = getProgress();
          expect(progress.completedCount).toBe(expectedCompleted);
          expect(progress.processedCount).toBe(
            expectedCompleted + expectedFailed
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Invalid transitions and unknown nodes are rejected
// Validates: Requirements 2.7, 2.8
// ---------------------------------------------------------------------------

describe("Property 4: Invalid transitions and unknown nodes are rejected", () => {
  beforeEach(() => {
    __setSocket(mockSocket);
    resetStore();
  });

  afterEach(() => {
    resetStore();
    __setSocket(null);
  });

  it("invalid transitions leave store state unchanged", () => {
    fc.assert(
      fc.property(arbNodeIds, (nodeIds) => {
        useBlueprintRealtimeStore.getState().reset();

        dispatchBatchInit(nodeIds);

        if (nodeIds.length === 0) return;

        const nodeId = nodeIds[0];

        // Note: pending → completed and pending → failed are NOW TOLERATED as
        // recovery transitions for missed node_started events (see store
        // Task 4.1 update). They are no longer rejected. Only completed/failed
        // (terminal) → anything transitions are rejected.

        // Move to processing then complete
        dispatchNodeStarted(nodeId, 1);
        expect(getProgress().nodes[nodeId].status).toBe("processing");

        dispatchNodeCompleted(nodeId, 1);
        expect(getProgress().nodes[nodeId].status).toBe("completed");

        // Try invalid: completed → processing (should be rejected)
        const beforeInvalid3 = JSON.stringify(getProgress());
        dispatchNodeStarted(nodeId, 1);
        expect(JSON.stringify(getProgress())).toBe(beforeInvalid3);

        // Try invalid: completed → failed (should be rejected)
        const beforeInvalid4 = JSON.stringify(getProgress());
        dispatchNodeFailed(nodeId, "error");
        expect(JSON.stringify(getProgress())).toBe(beforeInvalid4);

        // Try invalid: completed → completed (should be rejected)
        const beforeInvalid5 = JSON.stringify(getProgress());
        dispatchNodeCompleted(nodeId, 2);
        expect(JSON.stringify(getProgress())).toBe(beforeInvalid5);
      }),
      { numRuns: 100 }
    );
  });

  it("pending → completed and pending → failed are tolerated as recovery transitions", () => {
    fc.assert(
      fc.property(arbNodeIds.filter((ids) => ids.length >= 2), (nodeIds) => {
        useBlueprintRealtimeStore.getState().reset();
        dispatchBatchInit(nodeIds);

        // Simulate missed node_started: dispatch node_completed directly on pending node
        const nodeIdA = nodeIds[0];
        dispatchNodeCompleted(nodeIdA, 1);
        // Should be transitioned to completed and counter incremented
        expect(getProgress().nodes[nodeIdA].status).toBe("completed");
        expect(getProgress().completedCount).toBe(1);
        expect(getProgress().processedCount).toBe(1);

        // Simulate missed node_started for failure: dispatch node_failed directly on pending node
        const nodeIdB = nodeIds[1];
        dispatchNodeFailed(nodeIdB, "some error");
        expect(getProgress().nodes[nodeIdB].status).toBe("failed");
        expect(getProgress().nodes[nodeIdB].errorSummary).toBeDefined();
        expect(getProgress().processedCount).toBe(2);
      }),
      { numRuns: 100 }
    );
  });

  it("events for unknown node IDs leave store state unchanged", () => {
    fc.assert(
      fc.property(
        arbNodeIds,
        fc.uuid(),
        (nodeIds, unknownNodeId) => {
          useBlueprintRealtimeStore.getState().reset();

          // Ensure unknownNodeId is not in nodeIds
          const filteredUnknown = nodeIds.includes(unknownNodeId)
            ? `unknown-${unknownNodeId}`
            : unknownNodeId;

          dispatchBatchInit(nodeIds);

          const beforeState = JSON.stringify(getProgress());

          // Try node_started for unknown node
          dispatchNodeStarted(filteredUnknown, 1);
          expect(JSON.stringify(getProgress())).toBe(beforeState);

          // Try node_completed for unknown node
          dispatchNodeCompleted(filteredUnknown, 1);
          expect(JSON.stringify(getProgress())).toBe(beforeState);

          // Try node_failed for unknown node
          dispatchNodeFailed(filteredUnknown, "error");
          expect(JSON.stringify(getProgress())).toBe(beforeState);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("failed nodes allow retry (failed → processing) but reject direct completed/failed", () => {
    // whybuddy-spec-tree-progress-merge-2026-05-29 §3 (Q1=A2): the failed state
    // is no longer terminal — the backend may re-queue a failed node, so
    // `failed → processing` is now a VALID transition that also stamps
    // `wasRetried: true`. Direct `failed → completed` / `failed → failed`
    // (without first re-entering processing) remain invalid.
    fc.assert(
      fc.property(arbNodeIds.filter((ids) => ids.length >= 1), (nodeIds) => {
        useBlueprintRealtimeStore.getState().reset();

        dispatchBatchInit(nodeIds);

        const nodeId = nodeIds[0];

        // Move to processing then fail
        dispatchNodeStarted(nodeId, 1);
        dispatchNodeFailed(nodeId, "some error");
        expect(getProgress().nodes[nodeId].status).toBe("failed");

        // Invalid: failed → completed (must re-enter processing first)
        const beforeInvalidCompleted = JSON.stringify(getProgress());
        dispatchNodeCompleted(nodeId, 1);
        expect(JSON.stringify(getProgress())).toBe(beforeInvalidCompleted);

        // Invalid: failed → failed
        const beforeInvalidFailed = JSON.stringify(getProgress());
        dispatchNodeFailed(nodeId, "another error");
        expect(JSON.stringify(getProgress())).toBe(beforeInvalidFailed);

        // VALID (A2 retry): failed → processing, stamps wasRetried = true
        dispatchNodeStarted(nodeId, 1);
        expect(getProgress().nodes[nodeId].status).toBe("processing");
        expect(getProgress().nodes[nodeId].wasRetried).toBe(true);

        // The original errorSummary is preserved through the retry.
        expect(getProgress().nodes[nodeId].errorSummary).toBe("some error");

        // After a successful retry, wasRetried stays true permanently (white-box trail).
        dispatchNodeCompleted(nodeId, 1);
        expect(getProgress().nodes[nodeId].status).toBe("completed");
        expect(getProgress().nodes[nodeId].wasRetried).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Node display order preservation
// Validates: Requirements 3.6
// ---------------------------------------------------------------------------

describe("Property 6: Node display order preservation", () => {
  beforeEach(() => {
    __setSocket(mockSocket);
    resetStore();
  });

  afterEach(() => {
    resetStore();
    __setSocket(null);
  });

  it("nodeOrder preserves exact ordering from batch_init throughout lifecycle", () => {
    fc.assert(
      fc.property(arbNodeIds, (nodeIds) => {
        useBlueprintRealtimeStore.getState().reset();

        dispatchBatchInit(nodeIds);

        // Verify initial order
        expect(getProgress().nodeOrder).toEqual(nodeIds);

        // Process nodes in various orders (reverse, to prove order is preserved)
        const shuffledIndices = [...Array(nodeIds.length).keys()].reverse();

        for (const i of shuffledIndices) {
          dispatchNodeStarted(nodeIds[i], i + 1);
          // nodeOrder should remain unchanged
          expect(getProgress().nodeOrder).toEqual(nodeIds);
        }

        // Complete some, fail others
        for (const i of shuffledIndices) {
          if (i % 2 === 0) {
            dispatchNodeCompleted(nodeIds[i], 1);
          } else {
            dispatchNodeFailed(nodeIds[i], "error");
          }
          // nodeOrder should still remain unchanged
          expect(getProgress().nodeOrder).toEqual(nodeIds);
        }

        // After batch_finished, nodeOrder should still be preserved
        const finishEvent = createSpecDocsEvent("batch_finished", {
          completedCount: Math.ceil(nodeIds.length / 2),
          failedCount: Math.floor(nodeIds.length / 2),
          elapsedMs: 5000,
        });
        useBlueprintRealtimeStore.getState().dispatchEvent(finishEvent);

        expect(getProgress().nodeOrder).toEqual(nodeIds);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Non-interference with other stage events
// Validates: Requirements 4.3
// ---------------------------------------------------------------------------

describe("Property 7: Non-interference with other stage events", () => {
  beforeEach(() => {
    __setSocket(mockSocket);
    resetStore();
  });

  afterEach(() => {
    resetStore();
    __setSocket(null);
  });

  it("spec_docs events do not modify rolePhases, capabilityStatuses, or agentProgress slices", () => {
    fc.assert(
      fc.property(
        arbNodeIds.filter((ids) => ids.length >= 1),
        fc.integer({ min: 1, max: 5 }),
        (nodeIds, otherEventCount) => {
          useBlueprintRealtimeStore.getState().reset();

          // First, dispatch some non-spec_docs events to populate other slices
          for (let i = 0; i < otherEventCount; i++) {
            useBlueprintRealtimeStore.getState().dispatchEvent({
              type: "role.activated",
              jobId: "test-job",
              timestamp: Date.now(),
              payload: { roleId: `role-${i}` },
            });
            useBlueprintRealtimeStore.getState().dispatchEvent({
              type: "capability.completed",
              jobId: "test-job",
              timestamp: Date.now(),
              payload: { capabilityId: `cap-${i}` },
            });
          }

          // Snapshot other slices before spec_docs events
          const stateBefore = useBlueprintRealtimeStore.getState();
          const rolePhasesBefore = { ...stateBefore.rolePhases };
          const capabilityStatusesBefore = { ...stateBefore.capabilityStatuses };
          const agentProgressBefore = [...stateBefore.agentProgress];

          // Now dispatch spec_docs progress events
          dispatchBatchInit(nodeIds);

          for (let i = 0; i < nodeIds.length; i++) {
            dispatchNodeStarted(nodeIds[i], i + 1);
            if (i % 2 === 0) {
              dispatchNodeCompleted(nodeIds[i], 1);
            } else {
              dispatchNodeFailed(nodeIds[i], "error");
            }
          }

          const finishEvent = createSpecDocsEvent("batch_finished", {
            completedCount: Math.ceil(nodeIds.length / 2),
            failedCount: Math.floor(nodeIds.length / 2),
            elapsedMs: 1000,
          });
          useBlueprintRealtimeStore.getState().dispatchEvent(finishEvent);

          // Verify other slices remain unchanged
          const stateAfter = useBlueprintRealtimeStore.getState();
          expect(stateAfter.rolePhases).toEqual(rolePhasesBefore);
          expect(stateAfter.capabilityStatuses).toEqual(
            capabilityStatusesBefore
          );
          expect(stateAfter.agentProgress).toEqual(agentProgressBefore);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("other stage events do not modify specDocsProgress slice", () => {
    fc.assert(
      fc.property(
        arbNodeIds.filter((ids) => ids.length >= 1),
        fc.integer({ min: 1, max: 10 }),
        (nodeIds, otherEventCount) => {
          useBlueprintRealtimeStore.getState().reset();

          // Initialize spec_docs progress
          dispatchBatchInit(nodeIds);
          dispatchNodeStarted(nodeIds[0], 1);

          // Snapshot specDocsProgress
          const progressBefore = JSON.stringify(getProgress());

          // Dispatch various non-spec_docs events
          for (let i = 0; i < otherEventCount; i++) {
            useBlueprintRealtimeStore.getState().dispatchEvent({
              type: "role.activated",
              jobId: "test-job",
              timestamp: Date.now(),
              payload: { roleId: `other-role-${i}` },
            });
            useBlueprintRealtimeStore.getState().dispatchEvent({
              type: "capability.invoked",
              jobId: "test-job",
              timestamp: Date.now(),
              payload: { capabilityId: `other-cap-${i}` },
            });
            useBlueprintRealtimeStore.getState().dispatchEvent({
              type: "job.stage",
              jobId: "test-job",
              timestamp: Date.now(),
              payload: { roleId: `system`, message: `stage ${i}` },
            });
          }

          // specDocsProgress should remain unchanged
          expect(JSON.stringify(getProgress())).toBe(progressBefore);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("job.completed for spec docs finalizes a running panel when batch_finished was missed", () => {
    fc.assert(
      fc.property(arbNodeIds, (nodeIds) => {
        useBlueprintRealtimeStore.getState().reset();

        dispatchBatchInit(nodeIds);

        useBlueprintRealtimeStore.getState().dispatchEvent({
          type: "job.completed",
          jobId: "test-job",
          timestamp: Date.now(),
          payload: {
            specTreeId: "tree-1",
            nodeCount: nodeIds.length,
            documentCount: nodeIds.length * 3,
          },
        });

        const progress = getProgress();
        expect(progress.batchStatus).toBe("finished");
        expect(progress.completedCount).toBe(nodeIds.length);
        expect(progress.processedCount).toBe(nodeIds.length);
        expect(progress.summary).toEqual({
          completedCount: nodeIds.length,
          failedCount: 0,
          elapsedMs: 0,
        });
      }),
      { numRuns: 100 }
    );
  });
});
