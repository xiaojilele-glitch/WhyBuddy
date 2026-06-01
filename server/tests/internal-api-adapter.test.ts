import { describe, expect, it } from "vitest";

import type {
  GetMissionSessionResponse,
  MissionProjectionView,
} from "../../shared/mission/api.js";
import type { MissionRecord } from "../../shared/mission/contracts.js";
import type {
  MessageRecord,
  TaskRecord,
  WorkflowRecord,
} from "../../shared/workflow-runtime.js";
import { InternalApiExecutor } from "../tool/api/internal-api-adapter.js";

function makeWorkflow(id: string): WorkflowRecord {
  return {
    id,
    directive: "为宠物办公室生成一套并行执行方案",
    status: "running",
    current_stage: "execution",
    departments_involved: ["engineering"],
    started_at: "2026-04-22T08:00:00.000Z",
    completed_at: null,
    results: {
      organization: {
        taskProfile: "web-aigc-migration",
        departments: [
          {
            id: "engineering",
            label: "工程",
            managerNodeId: "manager-node-1",
          },
        ],
        nodes: [
          {
            id: "manager-node-1",
            agentId: "manager-1",
            parentId: null,
            name: "工程经理",
            title: "工程经理",
            role: "manager",
            departmentId: "engineering",
            departmentLabel: "工程",
          },
          {
            id: "worker-node-1",
            agentId: "worker-1",
            parentId: "manager-node-1",
            name: "执行工程师",
            title: "执行工程师",
            role: "worker",
            departmentId: "engineering",
            departmentLabel: "工程",
          },
        ],
      },
      input: {
        sourceApp: "whybuddy",
      },
    },
    created_at: "2026-04-22T07:50:00.000Z",
  };
}

function makeTask(workflowId: string): TaskRecord {
  return {
    id: 1,
    workflow_id: workflowId,
    worker_id: "worker-1",
    manager_id: "manager-1",
    department: "engineering",
    description: "将 Web-AIGC 编排接口迁移到 Cube",
    deliverable: "已建立 internal_api 薄切片",
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
    created_at: "2026-04-22T08:01:00.000Z",
    updated_at: "2026-04-22T08:02:00.000Z",
  };
}

function makeMessage(workflowId: string): MessageRecord {
  return {
    id: 1,
    workflow_id: workflowId,
    from_agent: "manager-1",
    to_agent: "worker-1",
    stage: "execution",
    content: "先把最薄的 internal_api 接起来。",
    metadata: {
      thinking: "优先做零外部依赖的薄代理。",
      toolCalls: [{ name: "buildWorkflowGraphInstanceSnapshot", arguments: "{}" }],
    },
    created_at: "2026-04-22T08:03:00.000Z",
  };
}

function makeMission(): MissionRecord {
  return {
    id: "mission-1",
    kind: "chat",
    title: "推进 web-aigc 迁移",
    status: "running",
    progress: 55,
    createdAt: Date.parse("2026-04-22T07:49:00.000Z"),
    updatedAt: Date.parse("2026-04-22T08:05:00.000Z"),
    startedAt: Date.parse("2026-04-22T08:00:00.000Z"),
    completedAt: undefined,
    sourceText: "迁移 web-aigc 编排接口",
    stageLabels: [],
    eventLog: [],
    artifacts: [],
    decisionHistory: [],
    topicId: "topic-1",
    projection: {
      workflowId: "wf-detail-1",
      instanceId: "wf-detail-1",
      sessionId: "topic-1",
      sourceApp: "whybuddy",
    },
    executor: {
      name: "parallel-engine",
    },
  } as MissionRecord;
}

describe("InternalApiExecutor", () => {
  it("projects a mission projection view for internal_api execution", async () => {
    const mission = makeMission();
    const projection: MissionProjectionView = {
      missionId: mission.id,
      links: {
        workflowId: "wf-detail-1",
        sessionId: "topic-1",
      },
      workflow: {
        id: "wf-detail-1",
        directive: "为宠物办公室生成一套并行执行方案",
        status: "running",
        currentStage: "execution",
        createdAt: "2026-04-22T07:50:00.000Z",
        startedAt: "2026-04-22T08:00:00.000Z",
        completedAt: null,
        attachmentCount: 0,
        sourceApp: "whybuddy",
        sessionId: "topic-1",
      },
      session: {
        sessionId: "topic-1",
        messageCount: 1,
        memoryEntryCount: 0,
        latestActivityAt: "2026-04-22T08:03:00.000Z",
      },
    };

    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => mission.id,
      getMission: () => mission,
      missionRuntime: {
        getTask: (id: string) => (id === mission.id ? mission : undefined),
      },
      buildMissionProjection: () => projection,
      buildMissionSession: () => null,
    });

    const result = await executor.execute({
      targetId: "mission.projection.get",
      input: "读取任务聚合视图",
      context: [],
      metadata: {
        missionId: mission.id,
      },
    });

    expect(result.targetLabel).toBe("Mission 聚合投影视图");
    expect(result.operation).toBe("mission.projection.get");
    expect(result.output).toContain('"missionId": "mission-1"');
    expect(result.output).toContain('"sessionId": "topic-1"');
  });

  it("projects a mission session view for internal_api execution", async () => {
    const mission = makeMission();
    const session: GetMissionSessionResponse = {
      ok: true,
      missionId: mission.id,
      links: {
        workflowId: "wf-detail-1",
        sessionId: "topic-1",
      },
      session: {
        sessionId: "topic-1",
        user: "topic-1",
        startTime: "2026-04-22T07:49:00.000Z",
        sourceApp: "whybuddy",
        messages: [
          {
            id: "1",
            role: "assistant",
            content: "先把最薄的 internal_api 接起来。",
            timestamp: "2026-04-22T08:03:00.000Z",
          },
        ],
      },
      memoryEntries: [],
    };

    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => mission.id,
      getMission: () => mission,
      missionRuntime: {
        getTask: (id: string) => (id === mission.id ? mission : undefined),
      },
      buildMissionProjection: () => null,
      buildMissionSession: () => session,
    });

    const result = await executor.execute({
      targetId: "mission.session.get",
      input: "读取任务会话视图",
      context: [],
      metadata: {
        missionId: mission.id,
      },
    });

    expect(result.targetLabel).toBe("Mission 会话与记忆视图");
    expect(result.operation).toBe("mission.session.get");
    expect(result.output).toContain('"ok": true');
    expect(result.output).toContain('"sessionId": "topic-1"');
  });

  it("projects a workflow graph snapshot for internal_api execution", async () => {
    const workflow = makeWorkflow("wf-graph-1");
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: (id: string) => (id === workflow.id ? workflow : undefined),
        getWorkflows: () => [workflow],
        getTasksByWorkflow: () => [makeTask(workflow.id)],
        getMessagesByWorkflow: () => [makeMessage(workflow.id)],
      },
      resolveMissionId: (workflowId: string) =>
        workflowId === workflow.id ? "mission-1" : undefined,
      getMission: () => makeMission(),
      missionRuntime: {
        getTask: () => makeMission(),
      },
      buildMissionProjection: () => null,
      buildMissionSession: () => null,
    });

    const result = await executor.execute({
      targetId: "workflow.graph_instance_snapshot",
      input: "读取工作流图",
      context: [],
      workflowId: workflow.id,
    });

    expect(result.targetLabel).toBe("工作流图实例快照");
    expect(result.operation).toBe("workflow.graph_instance_snapshot");
    expect(result.output).toContain('"kind": "graph_instance_snapshot"');
  });

  it("projects monitoring instance detail for internal_api execution", async () => {
    const workflow = makeWorkflow("wf-detail-1");
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: (id: string) => (id === workflow.id ? workflow : undefined),
        getWorkflows: () => [workflow],
        getTasksByWorkflow: () => [makeTask(workflow.id)],
        getMessagesByWorkflow: () => [makeMessage(workflow.id)],
      },
      resolveMissionId: (workflowId: string) =>
        workflowId === workflow.id ? "mission-1" : undefined,
      getMission: () => makeMission(),
      missionRuntime: {
        getTask: () => makeMission(),
      },
      buildMissionProjection: () => null,
      buildMissionSession: () => null,
    });

    const result = await executor.execute({
      targetId: "aigc_monitoring.instance_detail",
      input: "读取监控详情",
      context: [],
      metadata: {
        workflowId: workflow.id,
      },
    });

    expect(result.targetLabel).toBe("AIGC 监控实例详情");
    expect(result.output).toContain('"instanceUuid": "wf-detail-1"');
    expect(result.output).toContain('"orchestrationName"');
  });

  it("returns the web-aigc risk action catalog", async () => {
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => undefined,
      getMission: () => undefined,
      missionRuntime: {
        getTask: () => undefined,
      },
      buildMissionProjection: () => null,
      buildMissionSession: () => null,
    });

    const result = await executor.execute({
      targetId: "web_aigc.risk_action_catalog",
      input: "列出风险动作",
      context: [],
    });

    expect(result.targetLabel).toBe("Web-AIGC 风险动作目录");
    expect(result.output).toContain("/api/rag/risk-actions/vector-insert");
  });

  it("falls back to an empty result when a recoverable mission lookup error occurs", async () => {
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => undefined,
      getMission: () => undefined,
      missionRuntime: {
        getTask: () => undefined,
      },
      buildMissionProjection: () => null,
      buildMissionSession: () => null,
    });

    const result = await executor.execute({
      targetId: "mission.projection.get",
      input: "读取任务聚合视图",
      context: [],
      metadata: {
        missionId: "mission-missing",
        fallback: {
          mode: "empty_result",
          targetLabel: "Mission 聚合投影视图回退",
          operation: "mission.projection.get.fallback",
          recoverableErrors: ["Mission not found"],
        },
      },
    });

    expect(result.targetLabel).toBe("Mission 聚合投影视图回退");
    expect(result.operation).toBe("mission.projection.get.fallback");
    expect(result.output).toContain('"fallbackUsed": true');
    expect(result.output).toContain('"fallbackStrategy": "empty_result"');
    expect(result.output).toContain('"data": []');
  });

  it("falls back to a static response when workflow lookup fails", async () => {
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => undefined,
      getMission: () => undefined,
      missionRuntime: {
        getTask: () => undefined,
      },
      buildMissionProjection: () => null,
      buildMissionSession: () => null,
    });

    const result = await executor.execute({
      targetId: "workflow.graph_instance_snapshot",
      input: "读取工作流图",
      context: [],
      workflowId: "wf-missing",
      metadata: {
        workflowId: "wf-missing",
        fallback: {
          mode: "static_response",
          targetLabel: "工作流图静态回退",
          operation: "workflow.graph_instance_snapshot.fallback",
          recoverableErrors: ["Workflow not found"],
          response: {
            kind: "graph_instance_snapshot_fallback",
            nodes: [],
            edges: [],
          },
        },
      },
    });

    expect(result.targetLabel).toBe("工作流图静态回退");
    expect(result.operation).toBe("workflow.graph_instance_snapshot.fallback");
    expect(result.output).toContain('"kind": "graph_instance_snapshot_fallback"');
    expect(result.output).toContain('"fallbackUsed": true');
    expect(result.output).toContain('"nodes": []');
  });

  it("does not apply fallback when the error is not listed as recoverable", async () => {
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => undefined,
      getMission: () => undefined,
      missionRuntime: {
        getTask: () => undefined,
      },
      buildMissionProjection: () => null,
      buildMissionSession: () => null,
    });

    await expect(
      executor.execute({
        targetId: "mission.projection.get",
        input: "读取任务聚合视图",
        context: [],
        metadata: {
          missionId: "mission-missing",
          fallback: {
            mode: "empty_result",
            recoverableErrors: ["Workflow not found"],
          },
        },
      }),
    ).rejects.toThrow("Mission not found: mission-missing");
  });
});

function makePermissionEngine(
  overrides?: Partial<{
    allowed: boolean;
    reason: string;
  }>,
) {
  return {
    checkPermission: () => ({
      allowed: overrides?.allowed ?? true,
      reason: overrides?.reason,
    }),
  };
}

function makeAuditLogger() {
  return {
    entries: [] as Array<Record<string, unknown>>,
    log(entry: Record<string, unknown>) {
      this.entries.push(entry);
    },
  };
}

describe("InternalApiExecutor governance hooks", () => {
  it("requires agentId when permission engine is enabled", async () => {
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => undefined,
      getMission: () => undefined,
      missionRuntime: {
        getTask: () => undefined,
      },
      permissionEngine: makePermissionEngine(),
    });

    await expect(
      executor.execute({
        targetId: "web_aigc.risk_action_catalog",
        input: "list risk actions",
        context: [],
      }),
    ).rejects.toThrow("Missing required field: agentId");
  });

  it("requires token when permission engine is enabled", async () => {
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => undefined,
      getMission: () => undefined,
      missionRuntime: {
        getTask: () => undefined,
      },
      permissionEngine: makePermissionEngine(),
    });

    await expect(
      executor.execute({
        targetId: "web_aigc.risk_action_catalog",
        input: "list risk actions",
        context: [],
        metadata: {
          agentId: "agent-internal-api",
        },
      }),
    ).rejects.toThrow("Missing required field: token");
  });

  it("blocks execution when permission check denies the internal_api call", async () => {
    const auditLogger = makeAuditLogger();
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => undefined,
      getMission: () => undefined,
      missionRuntime: {
        getTask: () => undefined,
      },
      permissionEngine: makePermissionEngine({
        allowed: false,
        reason: "No allow rule found for api:call",
      }),
      auditLogger,
    });

    await expect(
      executor.execute({
        targetId: "web_aigc.risk_action_catalog",
        input: "list risk actions",
        context: ["deny internal api call"],
        stage: "internal_api_guard",
        metadata: {
          agentId: "agent-internal-api",
          token: "token-1",
          workflowId: "wf-internal-denied",
          missionId: "mission-internal-denied",
          sessionId: "session-internal-denied",
          replayId: "replay-internal-denied",
          lineageId: "lineage-internal-denied",
          decisionId: "decision-internal-denied",
          sourceApp: "whybuddy",
        },
      }),
    ).rejects.toThrow("No allow rule found for api:call");

    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      agentId: "agent-internal-api",
      operation: "internal_api",
      resourceType: "api",
      action: "call",
      resource: "internal_api:web_aigc.risk_action_catalog",
      result: "denied",
      reason: "No allow rule found for api:call",
      metadata: expect.objectContaining({
        workflowId: "wf-internal-denied",
        missionId: "mission-internal-denied",
        sessionId: "session-internal-denied",
        replayId: "replay-internal-denied",
        lineageId: "lineage-internal-denied",
        decisionId: "decision-internal-denied",
        sourceApp: "whybuddy",
        stage: "internal_api_guard",
        contextCount: 1,
        metadataKeys: [
          "agentId",
          "decisionId",
          "lineageId",
          "missionId",
          "replayId",
          "sessionId",
          "sourceApp",
          "token",
          "workflowId",
        ],
        fallbackConfigured: false,
        fallbackUsed: false,
        governanceHook: "permission-engine",
      }),
    });
  });

  it("records an allowed audit entry when internal_api execution succeeds with governance hooks enabled", async () => {
    const auditLogger = makeAuditLogger();
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => undefined,
      getMission: () => undefined,
      missionRuntime: {
        getTask: () => undefined,
      },
      permissionEngine: makePermissionEngine(),
      auditLogger,
    });

    const result = await executor.execute({
      targetId: "web_aigc.risk_action_catalog",
      input: "list risk actions",
      context: ["allowed path"],
      stage: "internal_api_allowed",
      metadata: {
        agentId: "agent-internal-api",
        token: "token-1",
        workflowId: "wf-internal-api",
        missionId: "mission-internal-api",
        sessionId: "session-internal-api",
        replayId: "replay-internal-api",
        lineageId: "lineage-internal-api",
        decisionId: "decision-internal-api",
        sourceApp: "whybuddy",
      },
    });

    expect(result.operation).toBe("web_aigc.risk_action_catalog");
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      agentId: "agent-internal-api",
      operation: "internal_api",
      resourceType: "api",
      action: "call",
      resource: "internal_api:web_aigc.risk_action_catalog",
      result: "allowed",
    });
    expect(auditLogger.entries[0].metadata).toEqual(
      expect.objectContaining({
        workflowId: "wf-internal-api",
        missionId: "mission-internal-api",
        sessionId: "session-internal-api",
        replayId: "replay-internal-api",
        lineageId: "lineage-internal-api",
        decisionId: "decision-internal-api",
        sourceApp: "whybuddy",
        stage: "internal_api_allowed",
        contextCount: 1,
        metadataKeys: [
          "agentId",
          "decisionId",
          "lineageId",
          "missionId",
          "replayId",
          "sessionId",
          "sourceApp",
          "token",
          "workflowId",
        ],
        fallbackConfigured: false,
        fallbackUsed: false,
        targetId: "web_aigc.risk_action_catalog",
        targetLabel: "Web-AIGC 风险动作目录",
        operation: "web_aigc.risk_action_catalog",
      }),
    );
  });

  it("does not bypass permission denial with fallback metadata", async () => {
    const auditLogger = makeAuditLogger();
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => undefined,
      getMission: () => undefined,
      missionRuntime: {
        getTask: () => undefined,
      },
      permissionEngine: makePermissionEngine({
        allowed: false,
        reason: "No allow rule found for api:call",
      }),
      auditLogger,
    });

    await expect(
      executor.execute({
        targetId: "web_aigc.risk_action_catalog",
        input: "list risk actions",
        context: [],
        metadata: {
          agentId: "agent-internal-api",
          token: "token-1",
          fallback: {
            mode: "static_response",
            response: {
              ok: true,
            },
          },
        },
      }),
    ).rejects.toThrow("No allow rule found for api:call");

    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      result: "denied",
    });
  });

  it("records fallback metadata when a recoverable execution error is downgraded", async () => {
    const auditLogger = makeAuditLogger();
    const executor = new InternalApiExecutor({
      workflowRepo: {
        getWorkflow: () => undefined,
        getWorkflows: () => [],
        getTasksByWorkflow: () => [],
        getMessagesByWorkflow: () => [],
      },
      resolveMissionId: () => undefined,
      getMission: () => undefined,
      missionRuntime: {
        getTask: () => undefined,
      },
      permissionEngine: makePermissionEngine(),
      auditLogger,
    });

    const result = await executor.execute({
      targetId: "mission.projection.get",
      input: "list risk actions",
      context: ["fallback path"],
      stage: "internal_api_fallback",
      metadata: {
        agentId: "agent-internal-api",
        token: "token-1",
        missionId: "mission-missing",
        sessionId: "session-internal-fallback",
        replayId: "replay-internal-fallback",
        lineageId: "lineage-internal-fallback",
        decisionId: "decision-internal-fallback",
        sourceApp: "whybuddy",
        fallback: {
          mode: "empty_result",
          targetLabel: "Mission Projection Empty Fallback",
          operation: "mission.projection.get.fallback",
          recoverableErrors: ["Mission not found"],
        },
      },
    });

    expect(result.output).toContain('"fallbackUsed": true');
    expect(auditLogger.entries).toHaveLength(1);
    expect(auditLogger.entries[0]).toMatchObject({
      agentId: "agent-internal-api",
      operation: "internal_api",
      result: "allowed",
      metadata: expect.objectContaining({
        missionId: "mission-missing",
        sessionId: "session-internal-fallback",
        replayId: "replay-internal-fallback",
        lineageId: "lineage-internal-fallback",
        decisionId: "decision-internal-fallback",
        sourceApp: "whybuddy",
        stage: "internal_api_fallback",
        contextCount: 1,
        metadataKeys: [
          "agentId",
          "decisionId",
          "fallback",
          "lineageId",
          "missionId",
          "replayId",
          "sessionId",
          "sourceApp",
          "token",
        ],
        fallbackConfigured: true,
        fallbackMode: "empty_result",
        fallbackTargetLabel: "Mission Projection Empty Fallback",
        fallbackOperation: "mission.projection.get.fallback",
        fallbackRecoverableErrors: ["Mission not found"],
        fallbackUsed: true,
        fallbackStrategy: "empty_result",
        fallbackReason: "Mission not found: mission-missing",
      }),
    });
  });
});
