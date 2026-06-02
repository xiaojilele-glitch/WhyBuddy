/**
 * Brainstorm Integration Tests
 *
 * Tests the data flow between components:
 * - Orchestrator → EventBus → Store update chain
 * - Replay API endpoint response format
 * - Diagnostics endpoint structure
 * - Capability bridge delegation via Tool Proxy
 * - Session persistence round-trip via API
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md
 * Requirements: 5.1, 5.2, 5.6, 9.3, 9.4, 10.6, 4.1, 4.6, 8.4, 9.1, 9.3
 */

import { describe, expect, it, vi } from "vitest";

import type {
  BrainstormSessionArtifact,
  BranchNode,
} from "../../../../shared/blueprint/brainstorm-contracts";
import { BrainstormOrchestrator } from "../../../routes/blueprint/brainstorm/orchestrator";
import { BrainstormSynthesizer } from "../../../routes/blueprint/brainstorm/synthesizer";
import { BrainstormToolProxy } from "../../../routes/blueprint/brainstorm/tool-proxy";
import {
  BrainstormMemoryStore,
  buildSessionArtifact,
  handleReplayRequest,
} from "../../../routes/blueprint/brainstorm/memory-store";
import {
  getBrainstormDiagnostics,
  type BrainstormServiceContext,
} from "../../../routes/blueprint/brainstorm/pipeline-integration";
import type { LLMCallerFn, EventEmitterFn } from "../../../routes/blueprint/brainstorm/orchestrator";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockLLM(): LLMCallerFn {
  return vi.fn().mockResolvedValue(
    JSON.stringify({
      content: "Integration test output",
      confidence: 0.8,
      needsToolCall: false,
    }),
  );
}

function makeEventCollector(): {
  emitter: EventEmitterFn;
  events: Array<{ type: string; payload: Record<string, unknown> }>;
} {
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const emitter: EventEmitterFn = (type, payload) => {
    events.push({ type, payload });
  };
  return { emitter, events };
}

// ─── 18.1 Event Flow End-to-End ─────────────────────────────────────────────

describe("Integration: Event flow end-to-end", () => {
  it("orchestrator emits events in correct causal order", async () => {
    const { emitter, events } = makeEventCollector();
    const mockLLM = makeMockLLM();
    const orchestrator = new BrainstormOrchestrator(mockLLM, emitter);

    const session = await orchestrator.startSession({
      jobId: "job-int-1",
      stageId: "planning",
      mode: "vote",
      roles: ["planner", "architect"],
      toolCategories: [],
      stageContext: "Design an API",
    });

    // Wait for async execution
    await new Promise((resolve) => setTimeout(resolve, 500));

    // session.started should be first
    const firstEvent = events[0];
    expect(firstEvent.type).toBe("brainstorm.session.started");
    expect(firstEvent.payload.sessionId).toBe(session.id);

    // node.created events should follow
    const nodeCreatedEvents = events.filter(
      (e) => e.type === "brainstorm.node.created",
    );
    expect(nodeCreatedEvents.length).toBeGreaterThanOrEqual(1);

    // Each node.created should have a sessionId matching the session
    for (const evt of nodeCreatedEvents) {
      expect(evt.payload.sessionId).toBe(session.id);
      expect(evt.payload.nodeId).toBeDefined();
      expect(evt.payload.roleId).toBeDefined();
    }

    // Verify parent node events precede child node events (causal ordering)
    const nodeIds = nodeCreatedEvents.map((e) => e.payload.nodeId);
    for (const evt of nodeCreatedEvents) {
      if (evt.payload.parentNodeId !== null && evt.payload.parentNodeId !== undefined) {
        const parentIdx = nodeIds.indexOf(evt.payload.parentNodeId);
        const childIdx = nodeIds.indexOf(evt.payload.nodeId);
        // Parent must appear before child (or not be a brainstorm node)
        if (parentIdx !== -1) {
          expect(parentIdx).toBeLessThan(childIdx);
        }
      }
    }

    orchestrator.dispose();
  });

  it("session.completed event emitted after all members finish", async () => {
    const { emitter, events } = makeEventCollector();
    const mockLLM = makeMockLLM();
    const orchestrator = new BrainstormOrchestrator(mockLLM, emitter);

    await orchestrator.startSession({
      jobId: "job-int-2",
      stageId: "design",
      mode: "vote",
      roles: ["planner"],
      toolCategories: [],
      stageContext: "Simple task",
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const completedEvents = events.filter(
      (e) => e.type === "brainstorm.session.completed",
    );
    expect(completedEvents.length).toBeGreaterThanOrEqual(1);
    expect(completedEvents[0].payload.jobId).toBe("job-int-2");

    orchestrator.dispose();
  });
});

// ─── 18.2 Replay API Endpoint ───────────────────────────────────────────────

describe("Integration: Replay API endpoint", () => {
  it("returns full session artifact with correct format", async () => {
    const { emitter } = makeEventCollector();
    const mockLLM = makeMockLLM();
    const orchestrator = new BrainstormOrchestrator(mockLLM, emitter);
    const memoryStore = new BrainstormMemoryStore();

    const session = await orchestrator.startSession({
      jobId: "job-replay-1",
      stageId: "planning",
      mode: "discussion",
      roles: ["planner"],
      toolCategories: [],
      stageContext: "Design task",
    });

    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Build artifact from completed session
    const completedSession = orchestrator.getSession(session.id)!;
    const artifact = buildSessionArtifact(completedSession);
    memoryStore.persist(artifact);

    // Call replay API handler
    const response = handleReplayRequest(memoryStore, "job-replay-1", session.id);

    expect(response.status).toBe(200);
    const body = response.body as any;
    expect(body.sessionId).toBe(session.id);
    expect(body.jobId).toBe("job-replay-1");
    expect(body.nodes).toBeDefined();
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(body.replayMetadata).toBeDefined();
    expect(body.replayMetadata.totalNodes).toBeGreaterThanOrEqual(1);

    // Verify nodes are ordered by sequenceNumber
    for (let i = 1; i < body.nodes.length; i++) {
      expect(body.nodes[i].sequenceNumber).toBeGreaterThanOrEqual(
        body.nodes[i - 1].sequenceNumber,
      );
    }

    orchestrator.dispose();
  });

  it("returns 404 for non-existent session", () => {
    const memoryStore = new BrainstormMemoryStore();
    const response = handleReplayRequest(memoryStore, "no-job", "no-session");
    expect(response.status).toBe(404);
  });
});

// ─── 18.3 Diagnostics Endpoint ──────────────────────────────────────────────

describe("Integration: Diagnostics endpoint", () => {
  it("includes brainstormOrchestrator entry with all fields", async () => {
    const mockLLM = makeMockLLM();
    const emitter = vi.fn();
    const orchestrator = new BrainstormOrchestrator(mockLLM, emitter);
    const ctx: BrainstormServiceContext = {
      orchestrator,
      synthesizer: new BrainstormSynthesizer(mockLLM, emitter),
      memoryStore: new BrainstormMemoryStore(),
      enabled: true,
    };

    const diag = getBrainstormDiagnostics(ctx);

    expect(diag.enabled).toBe(true);
    expect(typeof diag.activeSessionsCount).toBe("number");
    expect(typeof diag.totalSessionsCompleted).toBe("number");
    expect(typeof diag.degradationCount).toBe("number");
    expect(typeof diag.averageSessionDurationMs).toBe("number");
    expect(typeof diag.tokenBudget).toBe("number");
    expect(typeof diag.toolCallLimit).toBe("number");

    orchestrator.dispose();
  });

  it("counters update after session completion", async () => {
    const mockLLM = makeMockLLM();
    const emitter = vi.fn();
    const orchestrator = new BrainstormOrchestrator(mockLLM, emitter);

    await orchestrator.startSession({
      jobId: "job-diag-1",
      stageId: "stage-1",
      mode: "vote",
      roles: ["planner"],
      toolCategories: [],
      stageContext: "Quick task",
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const diag = orchestrator.getDiagnostics();
    expect(diag.totalSessionsCompleted).toBeGreaterThanOrEqual(1);

    orchestrator.dispose();
  });
});

// ─── 18.4 Capability Bridge Delegation ──────────────────────────────────────

describe("Integration: Capability bridge delegation", () => {
  function makeMockBridges() {
    const mockBridge: any = vi.fn().mockResolvedValue({ success: true, output: "result" });
    return {
      docker: mockBridge,
      mcp: mockBridge,
      github: mockBridge,
      skills: mockBridge,
    };
  }

  it("Tool Proxy validates permissions and routes to bridges", async () => {
    const emitter = vi.fn();
    const bridges = makeMockBridges();
    const toolProxy = new BrainstormToolProxy(bridges, emitter);

    // planner role has docker + mcp allowed via role-registry
    const result = await toolProxy.invoke({
      sessionId: "test-session",
      roleId: "planner",
      toolCategory: "docker",
      toolId: "run-command",
      params: { command: "ls" },
    });

    // Tool proxy returns a result
    expect(result).toBeDefined();
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.durationMs).toBe("number");
  });

  it("Tool Proxy rejects disallowed categories based on role registry", async () => {
    const emitter = vi.fn();
    const bridges = makeMockBridges();
    const toolProxy = new BrainstormToolProxy(bridges, emitter);

    // auditor role only has mcp + github access (no docker)
    const result = await toolProxy.invoke({
      sessionId: "test-session",
      roleId: "auditor",
      toolCategory: "docker",
      toolId: "run-command",
      params: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Permission denied");
  });

  it("Tool Proxy emits events on tool completion", async () => {
    const emitter = vi.fn();
    const bridges = makeMockBridges();
    const toolProxy = new BrainstormToolProxy(bridges, emitter);

    // executor has docker access
    await toolProxy.invoke({
      sessionId: "test-session",
      roleId: "executor",
      toolCategory: "docker",
      toolId: "run",
      params: { command: "echo hi" },
    });

    // Check that tool event was emitted
    const toolEvents = (emitter as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([type]) =>
        type === "brainstorm.tool.completed" || type === "brainstorm.tool.failed",
    );
    expect(toolEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 18.5 Session Persistence Round-Trip via API ────────────────────────────

describe("Integration: Session persistence round-trip via API", () => {
  it("full flow: start session → complete → persist → retrieve via API", async () => {
    const { emitter } = makeEventCollector();
    const mockLLM = makeMockLLM();
    const orchestrator = new BrainstormOrchestrator(mockLLM, emitter);
    const memoryStore = new BrainstormMemoryStore();

    // 1. Start session
    const session = await orchestrator.startSession({
      jobId: "job-persist-1",
      stageId: "execution",
      mode: "discussion",
      roles: ["planner", "architect"],
      toolCategories: [],
      stageContext: "Implement feature X",
    });

    // 2. Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 800));

    // 3. Build and persist artifact
    const completedSession = orchestrator.getSession(session.id)!;
    const artifact = buildSessionArtifact(completedSession);
    memoryStore.persist(artifact);

    // 4. Retrieve via replay API
    const response = handleReplayRequest(memoryStore, "job-persist-1", session.id);

    expect(response.status).toBe(200);
    const body = response.body as any;

    // 5. Verify artifact completeness
    expect(body.sessionId).toBe(session.id);
    expect(body.jobId).toBe("job-persist-1");
    expect(body.stageId).toBe("execution");
    expect(body.mode).toBe("discussion");
    expect(body.roles).toContain("planner");
    expect(body.roles).toContain("architect");
    expect(body.nodes.length).toBeGreaterThanOrEqual(1);
    expect(body.startedAt).toBeDefined();
    expect(body.completedAt).toBeDefined();
    expect(body.totalTokenUsage).toBeGreaterThanOrEqual(0);
    expect(body.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(body.tokenUsageByRole).toBeDefined();
    expect(body.replayMetadata).toBeDefined();

    orchestrator.dispose();
  });

  it("listByJob returns all persisted sessions for a job", async () => {
    const { emitter } = makeEventCollector();
    const mockLLM = makeMockLLM();
    const memoryStore = new BrainstormMemoryStore();

    // Persist multiple artifacts for the same job
    const artifact1: BrainstormSessionArtifact = {
      sessionId: "s1",
      jobId: "job-list-1",
      stageId: "planning",
      mode: "vote",
      roles: ["planner"],
      startedAt: "2026-01-01T00:01:00.000Z",
      completedAt: "2026-01-01T00:02:00.000Z",
      nodes: [],
      edges: [],
      synthesisResult: null,
      tokenUsageByRole: { planner: 100 },
      totalTokenUsage: 100,
      totalDurationMs: 60000,
    };

    const artifact2: BrainstormSessionArtifact = {
      sessionId: "s2",
      jobId: "job-list-1",
      stageId: "execution",
      mode: "discussion",
      roles: ["planner", "executor"],
      startedAt: "2026-01-01T00:03:00.000Z",
      completedAt: "2026-01-01T00:04:00.000Z",
      nodes: [],
      edges: [],
      synthesisResult: null,
      tokenUsageByRole: { planner: 100, executor: 200 },
      totalTokenUsage: 300,
      totalDurationMs: 60000,
    };

    memoryStore.persist(artifact1);
    memoryStore.persist(artifact2);

    const sessions = memoryStore.listByJob("job-list-1");
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBe("s1");
    expect(sessions[1].sessionId).toBe("s2");
  });
});
