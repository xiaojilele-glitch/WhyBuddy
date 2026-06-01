import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MissionRecord } from "../../shared/mission/contracts.js";
import type { GraphInstanceSnapshot } from "../../shared/workflow-graph.js";
import type {
  MessageRecord,
  TaskRecord,
  WorkflowRecord,
} from "../../shared/workflow-runtime.js";

const {
  state,
  getWorkflow,
  getWorkflows,
  getTasksByWorkflow,
  getMessagesByWorkflow,
  resolveWorkflowMission,
  getMissionTask,
  buildWorkflowGraphInstanceSnapshot,
  submitOperatorAction,
} = vi.hoisted(() => {
  const state: {
    workflows: WorkflowRecord[];
    tasksByWorkflow: Record<string, TaskRecord[]>;
    messagesByWorkflow: Record<string, MessageRecord[]>;
    missionIdsByWorkflow: Record<string, string | undefined>;
    missionsById: Record<string, MissionRecord | undefined>;
    instancesByWorkflow: Record<string, GraphInstanceSnapshot | undefined>;
  } = {
    workflows: [],
    tasksByWorkflow: {},
    messagesByWorkflow: {},
    missionIdsByWorkflow: {},
    missionsById: {},
    instancesByWorkflow: {},
  };

  return {
    state,
    getWorkflow: vi.fn((id: string) =>
      state.workflows.find(workflow => workflow.id === id)
    ),
    getWorkflows: vi.fn(() => state.workflows),
    getTasksByWorkflow: vi.fn(
      (workflowId: string) => state.tasksByWorkflow[workflowId] || []
    ),
    getMessagesByWorkflow: vi.fn(
      (workflowId: string) => state.messagesByWorkflow[workflowId] || []
    ),
    resolveWorkflowMission: vi.fn(
      (workflowId: string) => state.missionIdsByWorkflow[workflowId]
    ),
    getMissionTask: vi.fn((missionId: string) => state.missionsById[missionId]),
    buildWorkflowGraphInstanceSnapshot: vi.fn(
      ({ workflow }: { workflow: WorkflowRecord }) => {
        const instance = state.instancesByWorkflow[workflow.id];
        if (!instance) {
          throw new Error(`missing instance for workflow ${workflow.id}`);
        }
        return instance;
      }
    ),
    submitOperatorAction: vi.fn(async () => ({
      task: state.missionsById["mission-monitor"],
      action: {
        id: "action-1",
        action: "terminate",
        createdAt: Date.now(),
        result: "completed",
      },
    })),
  };
});

vi.mock("../db/index.js", () => ({
  default: {
    getWorkflow,
    getWorkflows,
    getTasksByWorkflow,
    getMessagesByWorkflow,
  },
}));

vi.mock("../core/mission-enrichment-bridge.js", () => ({
  resolveWorkflowMission,
}));

vi.mock("../tasks/mission-runtime.js", () => ({
  missionRuntime: {
    getTask: getMissionTask,
  },
}));

vi.mock("../tasks/mission-operator-service.js", () => ({
  createMissionOperatorService: vi.fn(() => ({
    submit: submitOperatorAction,
  })),
}));

vi.mock("../core/workflow-graph-projection.js", () => ({
  buildWorkflowGraphInstanceSnapshot,
}));

function makeWorkflow(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: "wf-monitor",
    directive: "Build web-aigc monitoring compatibility",
    status: "running",
    current_stage: "execution",
    departments_involved: ["AI"],
    started_at: "2026-04-22T01:00:00.000Z",
    completed_at: null,
    created_at: "2026-04-22T01:00:00.000Z",
    results: {
      organization: {
        taskProfile: "monitoring",
      },
      input: {
        attachments: [],
      },
    },
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 1,
    workflow_id: "wf-monitor",
    worker_id: "agent-worker",
    manager_id: "agent-manager",
    department: "AI",
    description: "Build monitoring adapters",
    deliverable: "Draft monitoring adapter",
    deliverable_v2: null,
    deliverable_v3: null,
    score_accuracy: null,
    score_completeness: null,
    score_actionability: null,
    score_format: null,
    total_score: null,
    manager_feedback: null,
    meta_audit_feedback: null,
    verify_result: null,
    version: 1,
    status: "running",
    created_at: "2026-04-22T01:00:00.000Z",
    updated_at: "2026-04-22T01:05:00.000Z",
    ...overrides,
  };
}

function makeMessage(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: 11,
    workflow_id: "wf-monitor",
    from_agent: "agent-worker",
    to_agent: "agent-manager",
    stage: "execution",
    content: "Compatibility adapter drafted",
    metadata: {
      citations: ["spec-1"],
      toolCalls: [{ name: "grep", arguments: "{\"q\":\"monitor\"}" }],
    },
    created_at: "2026-04-22T01:06:00.000Z",
    ...overrides,
  };
}

function makeMission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: "mission-monitor",
    kind: "chat",
    title: "Monitoring mission",
    sourceText: "Build web-aigc monitoring compatibility",
    topicId: "session-monitor",
    status: "running",
    progress: 55,
    currentStageKey: "execute",
    stages: [],
    createdAt: Date.parse("2026-04-22T01:00:00.000Z"),
    updatedAt: Date.parse("2026-04-22T01:07:00.000Z"),
    events: [],
    executor: {
      name: "lobster-executor",
      jobId: "job-monitor",
      status: "running",
    },
    ...overrides,
  };
}

function makeInstance(
  overrides: Partial<GraphInstanceSnapshot> = {}
): GraphInstanceSnapshot {
  return {
    kind: "graph_instance_snapshot",
    version: 1,
    instanceId: "wf-monitor",
    workflowId: "wf-monitor",
    missionId: "mission-monitor",
    sessionId: "session-monitor",
    directive: "Build web-aigc monitoring compatibility",
    status: "EXECUTING",
    workflowStatus: "running",
    missionStatus: "running",
    currentStage: "execution",
    createdAt: "2026-04-22T01:00:00.000Z",
    startedAt: "2026-04-22T01:00:00.000Z",
    completedAt: null,
    links: {
      workflowId: "wf-monitor",
      missionId: "mission-monitor",
      sessionId: "session-monitor",
      replayId: "wf-monitor",
    },
    nodeRuns: [
      {
        nodeId: "node-root",
        agentId: "agent-root",
        title: "Root Orchestrator",
        role: "ceo",
        status: "EXECUTING",
      },
      {
        nodeId: "node-worker",
        agentId: "agent-worker",
        title: "Worker",
        role: "worker",
        status: "EXECUTING",
        outputPreview: "Compatibility adapter drafted",
      },
    ],
    edgeTransitions: [
      {
        edgeId: "node-root->node-worker",
        fromNodeId: "node-root",
        toNodeId: "node-worker",
        kind: "parent_child",
        status: "known",
      },
    ],
    telemetry: {
      messageCount: 1,
      taskCount: 1,
      errorCount: 0,
    },
    ...overrides,
  };
}

async function withServer(
  handler: (baseUrl: string) => Promise<void>
): Promise<void> {
  const { default: monitoringRoutes } = await import(
    "../routes/aigc-monitoring.js"
  );
  const app = express();
  app.use(express.json());
  app.use("/api/v1/:tenantId/aigc-monitoring", monitoringRoutes);
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

describe("web-aigc monitoring compatibility routes", () => {
  beforeEach(() => {
    state.workflows = [];
    state.tasksByWorkflow = {};
    state.messagesByWorkflow = {};
    state.missionIdsByWorkflow = {};
    state.missionsById = {};
    state.instancesByWorkflow = {};

    getWorkflow.mockClear();
    getWorkflows.mockClear();
    getTasksByWorkflow.mockClear();
    getMessagesByWorkflow.mockClear();
    resolveWorkflowMission.mockClear();
    getMissionTask.mockClear();
    buildWorkflowGraphInstanceSnapshot.mockClear();
    submitOperatorAction.mockClear();
  });

  it("returns a paged monitoring instance list", async () => {
    const workflow = makeWorkflow();
    state.workflows = [workflow];
    state.tasksByWorkflow[workflow.id] = [makeTask()];
    state.messagesByWorkflow[workflow.id] = [makeMessage()];
    state.missionIdsByWorkflow[workflow.id] = "mission-monitor";
    state.missionsById["mission-monitor"] = makeMission();
    state.instancesByWorkflow[workflow.id] = makeInstance();

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/v1/1/aigc-monitoring/instances?page=0&size=10`
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        totalElements: 1,
        page: 0,
        size: 10,
      });
      expect(body.data.content).toHaveLength(1);
      expect(body.data.content[0]).toMatchObject({
        instanceUuid: "wf-monitor",
        orchestrationCode: "wf-monitor",
        orchestrationName: "monitoring",
        status: "EXECUTING",
        executor: "lobster-executor",
      });
    });
  });

  it("returns monitoring instance detail projected from graph instance", async () => {
    const workflow = makeWorkflow();
    state.workflows = [workflow];
    state.tasksByWorkflow[workflow.id] = [makeTask()];
    state.messagesByWorkflow[workflow.id] = [makeMessage()];
    state.missionIdsByWorkflow[workflow.id] = "mission-monitor";
    state.missionsById["mission-monitor"] = makeMission();
    state.instancesByWorkflow[workflow.id] = makeInstance();

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/v1/1/aigc-monitoring/instances/wf-monitor`
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        instanceUuid: "wf-monitor",
        status: "EXECUTING",
        executor: "lobster-executor",
        links: {
          workflowId: "wf-monitor",
          missionId: "mission-monitor",
          sessionId: "session-monitor",
          replayId: "wf-monitor",
          auditId: null,
        },
      });
      expect(body.data.nodes).toHaveLength(2);
      expect(body.data.edges).toHaveLength(1);
      expect(body.data.nodes[1]).toMatchObject({
        nodeId: "node-worker",
        nodeLabel: "Worker",
        status: "EXECUTING",
      });
      expect(body.data.edges[0]).toMatchObject({
        id: "node-root->node-worker",
        source: "node-root",
        target: "node-worker",
        kind: "parent_child",
      });
    });
  });

  it("preserves control_flow edge kind in monitoring instance detail", async () => {
    const workflow = makeWorkflow({
      id: "wf-control-monitor",
      directive: "Project controlflow monitoring detail",
    });
    state.workflows = [workflow];
    state.tasksByWorkflow[workflow.id] = [];
    state.messagesByWorkflow[workflow.id] = [];
    state.missionIdsByWorkflow[workflow.id] = "mission-monitor";
    state.missionsById["mission-monitor"] = makeMission();
    state.instancesByWorkflow[workflow.id] = makeInstance({
      instanceId: "wf-control-monitor",
      workflowId: "wf-control-monitor",
      directive: "Project controlflow monitoring detail",
      links: {
        workflowId: "wf-control-monitor",
        missionId: "mission-monitor",
        sessionId: "session-monitor",
        replayId: "wf-control-monitor",
      },
      edgeTransitions: [
        {
          edgeId: "condition-1->end-approved",
          fromNodeId: "condition-1",
          toNodeId: "end-approved",
          kind: "control_flow",
          status: "known",
        },
      ],
    });

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/v1/1/aigc-monitoring/instances/wf-control-monitor`
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.edges).toEqual([
        {
          id: "condition-1->end-approved",
          source: "condition-1",
          target: "end-approved",
          kind: "control_flow",
        },
      ]);
    });
  });

  it("returns monitoring session detail from workflow messages", async () => {
    const workflow = makeWorkflow();
    state.workflows = [workflow];
    state.messagesByWorkflow[workflow.id] = [makeMessage()];
    state.missionIdsByWorkflow[workflow.id] = "mission-monitor";
    state.missionsById["mission-monitor"] = makeMission();

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/v1/1/aigc-monitoring/instances/wf-monitor/session`
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        sessionId: "session-monitor",
        user: "session-monitor",
        sourceApp: "whybuddy",
      });
      expect(body.data.messages).toHaveLength(1);
      expect(body.data.messages[0]).toMatchObject({
        id: "11",
        role: "assistant",
        content: "Compatibility adapter drafted",
      });
    });
  });

  it("prefers projection sessionId and sourceApp for monitoring session detail", async () => {
    const workflow = makeWorkflow({
      results: {
        input: {
          projection: {
            sessionId: "projection-session",
            sourceApp: "web-aigc",
          },
        },
      },
    });
    state.workflows = [workflow];
    state.messagesByWorkflow[workflow.id] = [makeMessage()];
    state.missionIdsByWorkflow[workflow.id] = "mission-monitor";
    state.missionsById["mission-monitor"] = makeMission({
      topicId: "mission-session",
      projection: {
        sessionId: "projection-session",
        sourceApp: "web-aigc",
      },
    });

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/v1/1/aigc-monitoring/instances/wf-monitor/session`
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        sessionId: "projection-session",
        user: "projection-session",
        sourceApp: "web-aigc",
      });
    });
  });

  it("reuses mission terminate flow for monitoring terminate endpoint", async () => {
    const workflow = makeWorkflow();
    state.workflows = [workflow];
    state.missionIdsByWorkflow[workflow.id] = "mission-monitor";
    state.missionsById["mission-monitor"] = makeMission();

    await withServer(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/v1/1/aigc-monitoring/instances/wf-monitor/terminate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reason: "Terminate from monitoring panel",
          }),
        }
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(submitOperatorAction).toHaveBeenCalledWith("mission-monitor", {
        action: "terminate",
        requestedBy: "aigc-monitoring",
        reason: "Terminate from monitoring panel",
      });
      expect(body.data).toMatchObject({
        previousStatus: "EXECUTING",
        currentStatus: "FORCE_TERMINATED",
      });
    });
  });
});
