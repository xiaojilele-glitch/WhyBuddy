import type { MissionRecord } from "../../shared/mission/contracts.js";
import { resolveMissionProjectionLinks } from "../../shared/mission/projection.js";
import type {
  AigcMonitoringExecutionStatus,
  AigcMonitoringInstanceDetail,
  AigcMonitoringInstanceListItem,
  AigcMonitoringInstanceListQuery,
  AigcMonitoringInstanceListResponse,
  AigcMonitoringInstanceNodeDetail,
  AigcMonitoringNodeExecutionStatus,
  AigcMonitoringSessionDetail,
  AigcMonitoringSessionMessage,
  AigcMonitoringTerminateResult,
} from "../../shared/aigc-monitoring.js";
import type { GraphInstanceSnapshot } from "../../shared/workflow-graph.js";
import type {
  MessageRecord,
  WorkflowRecord,
} from "../../shared/workflow-runtime.js";

function toNumericInstanceId(workflowId: string): number {
  let hash = 0;
  for (let index = 0; index < workflowId.length; index += 1) {
    hash = (hash * 31 + workflowId.charCodeAt(index)) >>> 0;
  }

  return hash || 1;
}

export function toMonitoringExecutionStatus(
  value?: string | null
): AigcMonitoringExecutionStatus {
  switch (value) {
    case "EXECUTED":
    case "EXECUTING":
    case "EXCEPTION":
    case "PENDING":
    case "WAITING_INPUT":
    case "FORCE_TERMINATED":
      return value;
    case "pending":
    case "queued":
      return "PENDING";
    case "running":
      return "EXECUTING";
    case "completed":
    case "done":
      return "EXECUTED";
    case "completed_with_errors":
    case "failed":
      return "EXCEPTION";
    case "waiting":
      return "WAITING_INPUT";
    case "cancelled":
    case "force_terminated":
    case "terminated":
      return "FORCE_TERMINATED";
    default:
      return "PENDING";
  }
}

function toMonitoringNodeExecutionStatus(
  value?: string | null
): AigcMonitoringNodeExecutionStatus {
  switch (toMonitoringExecutionStatus(value)) {
    case "EXECUTED":
      return "EXECUTED";
    case "EXECUTING":
    case "WAITING_INPUT":
      return "EXECUTING";
    case "EXCEPTION":
    case "FORCE_TERMINATED":
      return "EXCEPTION";
    case "PENDING":
    default:
      return "PENDING";
  }
}

function toOrchestrationCode(workflow: WorkflowRecord): string {
  return workflow.id;
}

function toOrchestrationName(workflow: WorkflowRecord): string {
  const organizationName = workflow.results?.organization?.taskProfile;
  if (typeof organizationName === "string" && organizationName.trim()) {
    return organizationName.trim();
  }

  return workflow.directive.length > 80
    ? `${workflow.directive.slice(0, 77)}...`
    : workflow.directive;
}

function toCategory(
  workflow: WorkflowRecord,
  mission?: MissionRecord
): string | null {
  const taskProfile = workflow.results?.organization?.taskProfile;
  if (typeof taskProfile === "string" && taskProfile.trim()) {
    return taskProfile.trim();
  }

  if (typeof mission?.kind === "string" && mission.kind.trim()) {
    return mission.kind.trim();
  }

  return null;
}

function toSourceApp(
  workflow: WorkflowRecord,
  mission?: MissionRecord
): string | null {
  const projection = resolveMissionProjectionLinks({
    mission,
    workflowId: workflow.id,
    workflowInput:
      typeof workflow.results?.input === "object" && workflow.results.input !== null
        ? (workflow.results.input as Record<string, unknown>)
        : undefined,
    replayId: workflow.id,
  });
  if (projection.sourceApp) {
    return projection.sourceApp;
  }

  const fromInput = workflow.results?.input?.sourceApp;
  if (typeof fromInput === "string" && fromInput.trim()) {
    return fromInput.trim();
  }

  return mission?.topicId ? "whybuddy" : null;
}

function toStartTime(workflow: WorkflowRecord, mission?: MissionRecord): string {
  return (
    workflow.started_at ||
    (typeof mission?.createdAt === "number"
      ? new Date(mission.createdAt).toISOString()
      : workflow.created_at)
  );
}

function toEndTime(workflow: WorkflowRecord, mission?: MissionRecord): string | null {
  return (
    workflow.completed_at ||
    (typeof mission?.completedAt === "number"
      ? new Date(mission.completedAt).toISOString()
      : null)
  );
}

function toLastUpdateTime(workflow: WorkflowRecord, mission?: MissionRecord): string {
  if (typeof mission?.updatedAt === "number") {
    return new Date(mission.updatedAt).toISOString();
  }

  return toEndTime(workflow, mission) || toStartTime(workflow, mission);
}

function buildNodePosition(index: number, total: number): { x: number; y: number } {
  const safeTotal = Math.max(total, 1);
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(safeTotal))));
  const row = Math.floor(index / columns);
  const column = index % columns;
  return {
    x: 120 + column * 260,
    y: 120 + row * 180,
  };
}

export function buildMonitoringInstanceListItem(input: {
  workflow: WorkflowRecord;
  mission?: MissionRecord;
  instance?: GraphInstanceSnapshot;
}): AigcMonitoringInstanceListItem {
  const { workflow, mission, instance } = input;

  return {
    id: toNumericInstanceId(workflow.id),
    instanceUuid: workflow.id,
    orchestrationCode: toOrchestrationCode(workflow),
    orchestrationName: toOrchestrationName(workflow),
    orchestrationVersion: 1,
    category: toCategory(workflow, mission),
    sourceApp: toSourceApp(workflow, mission),
    status: toMonitoringExecutionStatus(instance?.status || workflow.status),
    executor: mission?.executor?.name || null,
    lastExecutionTime: workflow.started_at || null,
    startTime: toStartTime(workflow, mission),
    endTime: toEndTime(workflow, mission),
  };
}

function matchesListQuery(
  item: AigcMonitoringInstanceListItem,
  query: AigcMonitoringInstanceListQuery
): boolean {
  const includes = (haystack: string | null | undefined, needle?: string) =>
    !needle ||
    Boolean(haystack?.toLowerCase().includes(needle.toLowerCase()));

  const between = (
    value: string | null,
    from?: string,
    to?: string
  ) => {
    if (!value) {
      return !from && !to;
    }

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      return false;
    }

    if (from) {
      const fromValue = Date.parse(from);
      if (Number.isFinite(fromValue) && timestamp < fromValue) {
        return false;
      }
    }

    if (to) {
      const toValue = Date.parse(to);
      if (Number.isFinite(toValue) && timestamp > toValue) {
        return false;
      }
    }

    return true;
  };

  return (
    includes(item.orchestrationName, query.name) &&
    includes(item.orchestrationCode, query.code) &&
    includes(item.executor, query.executor) &&
    includes(item.instanceUuid, query.instanceUuid) &&
    includes(item.category, query.category) &&
    (query.version === undefined ||
      item.orchestrationVersion === Number(query.version)) &&
    (query.status === undefined || item.status === query.status) &&
    between(item.startTime, query.startTimeFrom, query.startTimeTo) &&
    between(item.endTime, query.endTimeFrom, query.endTimeTo)
  );
}

export function buildMonitoringInstanceListResponse(input: {
  items: Array<{
    workflow: WorkflowRecord;
    mission?: MissionRecord;
    instance?: GraphInstanceSnapshot;
  }>;
  query: AigcMonitoringInstanceListQuery;
}): AigcMonitoringInstanceListResponse {
  const page = Math.max(0, Number(input.query.page) || 0);
  const size = Math.max(1, Math.min(200, Number(input.query.size) || 20));

  const filtered = input.items
    .map(item => buildMonitoringInstanceListItem(item))
    .filter(item => matchesListQuery(item, input.query))
    .sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime));

  const totalElements = filtered.length;
  const totalPages = totalElements === 0 ? 0 : Math.ceil(totalElements / size);
  const content = filtered.slice(page * size, page * size + size);

  return {
    content,
    totalElements,
    totalPages,
    page,
    size,
  };
}

function buildInputData(
  workflow: WorkflowRecord,
  mission?: MissionRecord
): Record<string, unknown> {
  return {
    directive: workflow.directive,
    attachments: workflow.results?.input?.attachments || [],
    missionTitle: mission?.title,
    missionKind: mission?.kind,
    currentStage: workflow.current_stage,
  };
}

function buildOutputData(
  workflow: WorkflowRecord,
  mission?: MissionRecord,
  nodeRun?: GraphInstanceSnapshot["nodeRuns"][number]
): Record<string, unknown> | null {
  const preview = nodeRun?.outputPreview;
  const summary = mission?.summary || workflow.results?.ceo_feedback;

  if (!preview && !summary) {
    return null;
  }

  return {
    outputPreview: preview || null,
    workflowSummary: summary || null,
  };
}

export function buildMonitoringInstanceDetail(input: {
  workflow: WorkflowRecord;
  mission?: MissionRecord;
  instance: GraphInstanceSnapshot;
}): AigcMonitoringInstanceDetail {
  const { workflow, mission, instance } = input;

  const nodes: AigcMonitoringInstanceNodeDetail[] = instance.nodeRuns.map(
    (nodeRun, index) => ({
      id: index + 1,
      nodeId: nodeRun.nodeId,
      nodeLabel: nodeRun.title,
      nodeType: nodeRun.role || "node",
      status: toMonitoringNodeExecutionStatus(nodeRun.status),
      startTime: instance.startedAt || null,
      endTime:
        nodeRun.status === "EXECUTED" || nodeRun.status === "EXCEPTION"
          ? instance.completedAt || null
          : null,
      inputData: buildInputData(workflow, mission),
      outputData: buildOutputData(workflow, mission, nodeRun),
      errorMessage: nodeRun.error || null,
      position: buildNodePosition(index, instance.nodeRuns.length),
    })
  );

  return {
    id: toNumericInstanceId(workflow.id),
    instanceUuid: workflow.id,
    orchestrationCode: toOrchestrationCode(workflow),
    orchestrationName: toOrchestrationName(workflow),
    orchestrationVersion: 1,
    category: toCategory(workflow, mission),
    sourceApp: toSourceApp(workflow, mission),
    status: toMonitoringExecutionStatus(instance.status),
    executor: mission?.executor?.name || null,
    startTime: toStartTime(workflow, mission),
    endTime: toEndTime(workflow, mission),
    lastUpdateTime: toLastUpdateTime(workflow, mission),
    links: {
      workflowId: instance.links.workflowId,
      missionId: instance.links.missionId || null,
      sessionId: instance.links.sessionId || null,
      replayId: instance.links.replayId || null,
      auditId: instance.links.auditId || null,
    },
    inputVariables: buildInputData(workflow, mission),
    outputVariables: {
      summary: mission?.summary || workflow.results?.ceo_feedback || null,
      report: workflow.results?.final_report || null,
      telemetry: instance.telemetry,
    },
    nodes,
    edges: instance.edgeTransitions.map(edge => ({
      id: edge.edgeId,
      source: edge.fromNodeId,
      target: edge.toNodeId,
      kind: edge.kind,
    })),
  };
}

function inferMessageRole(message: MessageRecord): "system" | "user" | "assistant" {
  const fromAgent = message.from_agent.toLowerCase();
  if (fromAgent.includes("user")) {
    return "user";
  }
  if (fromAgent.includes("system")) {
    return "system";
  }
  return "assistant";
}

export function buildMonitoringSessionDetail(input: {
  workflow: WorkflowRecord;
  mission?: MissionRecord;
  messages: MessageRecord[];
}): AigcMonitoringSessionDetail {
  const { workflow, mission, messages } = input;
  const projection = resolveMissionProjectionLinks({
    mission,
    workflowId: workflow.id,
    workflowInput:
      typeof workflow.results?.input === "object" && workflow.results.input !== null
        ? (workflow.results.input as Record<string, unknown>)
        : undefined,
    replayId: workflow.id,
  });

  const sessionId = projection.sessionId || workflow.id;
  const startTime = toStartTime(workflow, mission);
  const items: AigcMonitoringSessionMessage[] = messages.map(message => {
    const citations = Array.isArray(message.metadata?.citations)
      ? message.metadata.citations.filter(
          (value: unknown): value is string => typeof value === "string"
        )
      : undefined;
    const toolCalls = Array.isArray(message.metadata?.toolCalls)
      ? message.metadata.toolCalls
          .filter(
            (item: unknown): item is {
              name?: unknown;
              arguments?: unknown;
              result?: unknown;
            } => typeof item === "object" && item !== null
          )
          .map((item: {
            name?: unknown;
            arguments?: unknown;
            result?: unknown;
          }) => ({
            name: typeof item.name === "string" ? item.name : "tool",
            arguments:
              typeof item.arguments === "string" ? item.arguments : "{}",
            result: typeof item.result === "string" ? item.result : undefined,
          }))
      : undefined;

    return {
      id: String(message.id),
      role: inferMessageRole(message),
      content: message.content,
      timestamp: message.created_at,
      thinking:
        typeof message.metadata?.thinking === "string"
          ? message.metadata.thinking
          : undefined,
      citations: citations && citations.length > 0 ? citations : undefined,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  });

  return {
    sessionId,
    user: projection.sessionId || mission?.topicId || "workflow-user",
    startTime,
    sourceApp: toSourceApp(workflow, mission),
    messages: items,
  };
}

export function buildMonitoringTerminateResult(input: {
  workflow: WorkflowRecord;
  terminatedAt: string;
}): AigcMonitoringTerminateResult {
  return {
    instanceId: toNumericInstanceId(input.workflow.id),
    previousStatus: toMonitoringExecutionStatus(input.workflow.status),
    currentStatus: "FORCE_TERMINATED",
    terminatedAt: input.terminatedAt,
  };
}
