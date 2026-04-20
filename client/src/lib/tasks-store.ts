import { create } from "zustand";

import {
  MISSION_CORE_STAGE_BLUEPRINT,
  type DecisionHistoryEntry,
  type MissionArtifact,
  type MissionBlocker,
  type MissionDecision,
  type MissionEvent,
  type MissionExecutorContext,
  type MissionInstanceContext,
  type MissionOperatorActionRecord,
  type MissionOperatorActionType,
  type MissionOperatorState,
  type MissionPlanetInteriorData,
  type MissionPlanetOverviewItem,
  type MissionRecord,
  type MissionStage,
} from "@shared/mission/contracts";
import { MISSION_SOCKET_EVENT, MISSION_SOCKET_TYPES, type MissionSocketPayload } from "@shared/mission/socket";
import { io, type Socket } from "socket.io-client";
import type { ExecutorEvent } from "@shared/executor/contracts";

import {
  cancelMission as cancelMissionRequest,
  createMission as createMissionRequest,
  getMission,
  getPlanet,
  getPlanetInterior,
  listMissionEvents,
  listMissions,
  listPlanets,
  submitMissionOperatorAction as submitMissionOperatorActionRequest,
  submitMissionDecision as submitMissionDecisionRequest,
} from "./mission-client";
import { useSandboxStore } from "./sandbox-store";
import { useAppStore } from "./store";

/** Locally-defined status union derived from MissionTaskStatus. */
type SyntheticWfStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed";

/** Locally-defined shape for the synthetic workflow object built from MissionRecord. */
interface SyntheticWfSnapshot {
  id: string;
  directive: string;
  status: SyntheticWfStatus;
  current_stage: string | null;
  departments_involved: string[];
  started_at: string | null;
  completed_at: string | null;
  results: unknown;
  created_at: string;
}

export type MissionTaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

export type TimelineLevel = "info" | "success" | "warn" | "error";
export type InteriorStageStatus = "pending" | "running" | "done" | "failed";
export type InteriorAgentStatus =
  | "idle"
  | "working"
  | "thinking"
  | "done"
  | "error";

export interface MissionTaskSummary {
  id: string;
  title: string;
  kind: string;
  sourceText: string;
  status: MissionTaskStatus;
  operatorState: MissionOperatorState;
  workflowStatus: SyntheticWfStatus;
  progress: number;
  currentStageKey: string | null;
  currentStageLabel: string | null;
  summary: string;
  waitingFor: string | null;
  blocker: MissionBlocker | null;
  attempt: number;
  latestOperatorAction: MissionOperatorActionRecord | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  departmentLabels: string[];
  taskCount: number;
  completedTaskCount: number;
  messageCount: number;
  activeAgentCount: number;
  attachmentCount: number;
  issueCount: number;
  hasWarnings: boolean;
  lastSignal: string | null;
}

export interface TaskTimelineEvent {
  id: string;
  type: string;
  time: number;
  level: TimelineLevel;
  title: string;
  description: string;
  actor?: string;
}

export interface TaskStageRing {
  key: string;
  label: string;
  status: InteriorStageStatus;
  progress: number;
  detail?: string;
  arcStart: number;
  arcEnd: number;
  midAngle: number;
}

export interface TaskInteriorAgent {
  id: string;
  name: string;
  role: string;
  department: string;
  title: string;
  status: InteriorAgentStatus;
  stageKey: string;
  stageLabel: string;
  progress: number | null;
  currentAction?: string;
  angle: number;
}

export interface TaskArtifact {
  id: string;
  title: string;
  description: string;
  kind: "report" | "department_report" | "attachment" | "file" | "url" | "log";
  managerId?: string;
  format?: string;
  filename?: string;
  workflowId?: string;
  downloadKind?: "workflow" | "department" | "attachment" | "external" | "server";
  href?: string;
  content?: string;
  mimeType?: string;
  downloadUrl?: string;
  previewUrl?: string;
}

export interface TaskDecisionPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
  tone: "primary" | "secondary" | "warning";
  action: "workflow" | "mission";
  optionId?: string;
}

/** Work-package item shape consumed by TaskDetailView work-packages panel. */
export interface WorkPackageDisplayItem {
  id: number;
  status: string;
  department: string;
  description: string;
  version: number;
  deliverable: string | null;
  deliverable_v2: string | null;
  deliverable_v3: string | null;
  total_score: number | null;
  manager_feedback: string | null;
  meta_audit_feedback: string | null;
}

export interface MissionTaskDetail extends MissionTaskSummary {
  workflow: SyntheticWfSnapshot;
  tasks: WorkPackageDisplayItem[];
  messages: unknown[];
  report: unknown | null;
  organization: unknown | null;
  stages: TaskStageRing[];
  agents: TaskInteriorAgent[];
  timeline: TaskTimelineEvent[];
  artifacts: TaskArtifact[];
  failureReasons: string[];
  decisionPresets: TaskDecisionPreset[];
  decisionPrompt: string | null;
  decisionPlaceholder: string | null;
  decisionAllowsFreeText: boolean;
  decision: MissionDecision | null;
  instanceInfo: Array<{ label: string; value: string }>;
  logSummary: Array<{ label: string; value: string }>;
  runtimeChannels: {
    socket: {
      status: "connected" | "disconnected";
      label: string;
      detail: string;
    };
    callback: {
      status: "active" | "idle" | "waiting" | "error";
      label: string;
      detail: string;
      eventType?: string;
      eventSummary?: string;
    };
  };
  decisionHistory: DecisionHistoryEntry[];
  operatorActions: MissionOperatorActionRecord[];
  securitySummary?: {
    level: string;
    user: string;
    networkMode: string;
    readonlyRootfs: boolean;
    memoryLimit: string;
    cpuLimit: string;
    pidsLimit: number;
  };
  executor?: MissionExecutorContext;
  instance?: MissionInstanceContext;
  missionArtifacts?: MissionArtifact[];
}

export type MissionOperatorActionLoadingMap = Partial<
  Record<MissionOperatorActionType, boolean>
>;

interface TasksStoreState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  missionSocketConnected: boolean;
  selectedTaskId: string | null;
  tasks: MissionTaskSummary[];
  detailsById: Record<string, MissionTaskDetail>;
  decisionNotes: Record<string, string>;
  cancellingMissionIds: Record<string, boolean>;
  operatorActionLoadingByMissionId: Record<
    string,
    MissionOperatorActionLoadingMap
  >;
  lastDecisionLaunch: {
    sourceTaskId: string;
    sourceTaskTitle: string;
    spawnedWorkflowId: string | null;
    at: number;
  } | null;
  ensureReady: () => Promise<void>;
  refresh: (options?: { preferredTaskId?: string | null }) => Promise<void>;
  selectTask: (taskId: string | null) => void;
  createMission: (input: {
    title?: string;
    sourceText?: string;
    kind?: string;
    topicId?: string;
    autoDispatch?: boolean;
  }) => Promise<string | null>;
  cancelMission: (taskId: string, payload: {
    reason?: string;
    requestedBy?: string;
    source?: "user" | "brain" | "feishu" | "mission-core" | "executor";
  }) => Promise<string | null>;
  submitOperatorAction: (taskId: string, payload: {
    action: MissionOperatorActionType;
    reason?: string;
    requestedBy?: string;
  }) => Promise<string | null>;
  setDecisionNote: (taskId: string, note: string) => void;
  launchDecision: (taskId: string, presetId: string) => Promise<string | null>;
  clearDecisionLaunch: () => void;
}

function trimText(value: string | null | undefined, maxLength = 160): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}...`
    : normalized;
}

function pickFallbackTaskId(tasks: MissionTaskSummary[]): string | null {
  return (
    tasks.find(task => task.status === "running")?.id ||
    tasks.find(task => task.status === "waiting")?.id ||
    tasks[0]?.id ||
    null
  );
}

function capitalize(value: string): string {
  if (!value) return value;
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function formatShortDate(value: number | null): string {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatDurationMs(value: number | null): string {
  if (value === null || value < 0) return "n/a";
  const totalMinutes = Math.max(1, Math.round(value / 60000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

const TASKS_SELECTED_TASK_STORAGE_KEY = "cube-office:selected-task-id";

function readPersistedSelectedTaskId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage?.getItem(TASKS_SELECTED_TASK_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function persistSelectedTaskId(taskId: string | null) {
  if (typeof window === "undefined") return;
  try {
    const storage = window.sessionStorage;
    if (!storage) return;
    if (taskId) {
      storage.setItem(TASKS_SELECTED_TASK_STORAGE_KEY, taskId);
      return;
    }
    storage.removeItem(TASKS_SELECTED_TASK_STORAGE_KEY);
  } catch {
    // Ignore sessionStorage failures and keep the in-memory focus intact.
  }
}

function buildSocketRuntimeChannel(missionSocketConnected: boolean) {
  return missionSocketConnected
    ? {
        status: "connected" as const,
        label: "Socket connected",
        detail: "Mission socket is connected and can receive live runtime updates.",
      }
    : {
        status: "disconnected" as const,
        label: "Socket disconnected",
        detail: "Mission socket is offline, so runtime updates may be delayed until refresh.",
      };
}

function formatExecutorEventLabel(eventType: string | null | undefined): string {
  if (!eventType) {
    return "Callback idle";
  }

  switch (eventType) {
    case "job.accepted":
      return "Relay accepted";
    case "job.started":
      return "Relay started";
    case "job.progress":
      return "Relay progress update";
    case "job.waiting":
      return "Callback waiting";
    case "job.completed":
      return "Callback completed";
    case "job.failed":
      return "Callback failed";
    case "job.cancelled":
      return "Callback cancelled";
    case "job.log":
      return "Relay log update";
    case "job.heartbeat":
      return "Relay heartbeat";
    case "job.log_stream":
      return "Relay log stream";
    case "job.screenshot":
      return "Relay screenshot update";
    default:
      return `${eventType.startsWith("job.") ? "Relay" : "Callback"} ${eventType}`;
  }
}

function buildExecutorEventDetail(
  eventType: string | null | undefined,
  occurredAt: string,
  jobId?: string,
  requestId?: string,
  summary?: string | null
): string {
  const parts = [
    `${formatExecutorEventLabel(eventType)} recorded at ${occurredAt}.`,
  ];

  if (jobId) {
    parts.push(`Job ${jobId}.`);
  }

  if (requestId) {
    parts.push(`Request ${requestId}.`);
  }

  if (summary) {
    parts.push(summary);
  }

  return parts.join(" ");
}

function resolveCallbackStatus(
  eventType: string | null | undefined,
  jobStatus: string | null | undefined,
  missionStatus?: MissionTaskStatus
): MissionTaskDetail["runtimeChannels"]["callback"]["status"] {
  if (
    eventType === "job.failed" ||
    eventType === "job.cancelled" ||
    jobStatus === "failed" ||
    jobStatus === "cancelled" ||
    missionStatus === "failed" ||
    missionStatus === "cancelled"
  ) {
    return "error";
  }

  if (
    eventType === "job.waiting" ||
    jobStatus === "waiting" ||
    missionStatus === "waiting"
  ) {
    return "waiting";
  }

  if (
    eventType === "job.completed" ||
    eventType === "job.started" ||
    eventType === "job.progress" ||
    eventType === "job.accepted" ||
    eventType === "job.log" ||
    eventType === "job.log_stream" ||
    eventType === "job.heartbeat" ||
    eventType === "job.screenshot" ||
    jobStatus === "running" ||
    jobStatus === "completed"
  ) {
    return "active";
  }

  return "idle";
}

function buildCallbackRuntimeChannel(
  mission: Pick<MissionRecord, "status" | "executor" | "events">
): MissionTaskDetail["runtimeChannels"]["callback"] {
  const lastExecutorEventType = mission.executor?.lastEventType || null;
  const lastExecutorEventMessage =
    trimText(
      [...mission.events]
        .reverse()
        .find(event => event.type === "log" || event.source === "executor")
        ?.message,
      140
    ) || null;

  if (mission.executor?.lastEventAt) {
    return {
      status: resolveCallbackStatus(
        lastExecutorEventType,
        mission.executor?.status,
        mission.status
      ),
      label: formatExecutorEventLabel(lastExecutorEventType),
      detail: buildExecutorEventDetail(
        lastExecutorEventType,
        formatShortDate(mission.executor.lastEventAt),
        mission.executor?.jobId,
        mission.executor?.requestId,
        lastExecutorEventMessage
      ),
      eventType: lastExecutorEventType || undefined,
      eventSummary: lastExecutorEventMessage || undefined,
    };
  }

  if (mission.executor?.jobId) {
    return {
      status: "waiting",
      label: "Callback pending",
      detail: buildExecutorEventDetail(
        "job.waiting",
        "dispatch",
        mission.executor.jobId,
        mission.executor.requestId,
        "Waiting for the first executor callback after dispatch."
      ),
      eventType: lastExecutorEventType || undefined,
      eventSummary: lastExecutorEventMessage || undefined,
    };
  }

  return {
    status: "idle",
    label: "Callback idle",
    detail: "No executor callback has been recorded for this mission yet.",
    eventType: lastExecutorEventType || undefined,
    eventSummary: lastExecutorEventMessage || undefined,
  };
}

function applySocketConnectionToRuntimeChannels(
  runtimeChannels: MissionTaskDetail["runtimeChannels"],
  missionSocketConnected: boolean
): MissionTaskDetail["runtimeChannels"] {
  return {
    ...runtimeChannels,
    socket: buildSocketRuntimeChannel(missionSocketConnected),
  };
}

function buildRuntimeChannels(
  mission: MissionRecord,
  missionSocketConnected: boolean
): MissionTaskDetail["runtimeChannels"] {
  return {
    socket: buildSocketRuntimeChannel(missionSocketConnected),
    callback: buildCallbackRuntimeChannel(mission),
  };
}

function applyExecutorEventToRuntimeChannels(
  runtimeChannels: MissionTaskDetail["runtimeChannels"],
  event: ExecutorEvent
): MissionTaskDetail["runtimeChannels"] {
  const occurredAt = formatShortDate(Date.parse(event.occurredAt));
  const eventSummary = trimText(
    event.detail || event.summary || event.message || event.waitingFor,
    140
  );

  return {
    ...runtimeChannels,
    callback: {
      status: resolveCallbackStatus(event.type, event.status),
      label: formatExecutorEventLabel(event.type),
      detail: buildExecutorEventDetail(
        event.type,
        occurredAt,
        event.jobId,
        undefined,
        eventSummary
      ),
      eventType: event.type,
      eventSummary: eventSummary || undefined,
    },
  };
}

function applyMissionSocketState(
  runtimeChannels: MissionTaskDetail["runtimeChannels"],
  missionSocketConnected: boolean
): MissionTaskDetail["runtimeChannels"] {
  return {
    ...runtimeChannels,
    socket: buildSocketRuntimeChannel(missionSocketConnected),
  };
}

function updateDetailsSocketConnection(
  detailsById: Record<string, MissionTaskDetail>,
  missionSocketConnected: boolean
): Record<string, MissionTaskDetail> {
  return Object.fromEntries(
    Object.entries(detailsById).map(([taskId, detail]) => [
      taskId,
      {
        ...detail,
        runtimeChannels: applyMissionSocketState(
          detail.runtimeChannels,
          missionSocketConnected
        ),
      },
    ])
  ) as Record<string, MissionTaskDetail>;
}

function clampPercentage(value: number | null | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

let taskStoreWatchersStarted = false;
let scheduledRefreshTimer: number | null = null;
let queuedRefreshOptions: { preferredTaskId?: string | null } | null = null;
let inFlightRefresh: Promise<void> | null = null;
let missionSocket: Socket | null = null;

function workflowStatusFromMission(
  status: MissionTaskStatus
): SyntheticWfStatus {
  if (status === "queued") return "pending";
  if (status === "done") return "completed";
  if (status === "cancelled") return "completed_with_errors";
  if (status === "failed") return "failed";
  return "running";
}

function stageKeyFromMission(mission: MissionRecord): string | null {
  return (
    mission.currentStageKey ||
    mission.stages.find(stage => stage.status === "running")?.key ||
    mission.stages.find(stage => stage.status === "failed")?.key ||
    mission.stages.find(stage => stage.status === "done")?.key ||
    MISSION_CORE_STAGE_BLUEPRINT[0]?.key ||
    null
  );
}

function stageLabelFromMission(
  mission: MissionRecord,
  stageKey?: string | null
): string | null {
  if (!stageKey) return null;
  return (
    mission.stages.find(stage => stage.key === stageKey)?.label ||
    MISSION_CORE_STAGE_BLUEPRINT.find(stage => stage.key === stageKey)?.label ||
    stageKey
  );
}

function missionStartedAt(mission: MissionRecord): number | null {
  const stageStartedAt = mission.stages
    .flatMap(stage => [stage.startedAt, stage.completedAt])
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right)[0];

  if (typeof stageStartedAt === "number") {
    return stageStartedAt;
  }

  return mission.status === "queued" ? null : mission.createdAt;
}

function syntheticWorkflowFromMission(mission: MissionRecord): SyntheticWfSnapshot {
  return {
    id: mission.id,
    directive: mission.sourceText || mission.title,
    status: workflowStatusFromMission(mission.status),
    current_stage: stageKeyFromMission(mission),
    departments_involved: mission.kind ? [mission.kind] : [],
    started_at: missionStartedAt(mission)
      ? new Date(missionStartedAt(mission) || mission.createdAt).toISOString()
      : null,
    completed_at: mission.completedAt
      ? new Date(mission.completedAt).toISOString()
      : null,
    results: {
      missionId: mission.id,
      summary: mission.summary,
      waitingFor: mission.waitingFor,
      executor: mission.executor,
      instance: mission.instance,
      artifacts: mission.artifacts,
    },
    created_at: new Date(mission.createdAt).toISOString(),
  };
}

function missionOperatorStateFromMission(
  mission: MissionRecord
): MissionOperatorState {
  return mission.operatorState ?? "active";
}

function missionLatestOperatorAction(
  mission: MissionRecord
): MissionOperatorActionRecord | null {
  return mission.operatorActions?.at(-1) ?? null;
}

function missionFailureReasons(
  mission: MissionRecord,
  events: MissionEvent[]
): string[] {
  if (mission.status === "cancelled") {
    return [];
  }

  const reasons = new Set<string>();

  if (mission.status === "failed" && mission.summary) {
    reasons.add(mission.summary);
  }

  for (const stage of mission.stages) {
    if (stage.status === "failed" && stage.detail) {
      reasons.add(stage.detail);
    }
  }

  for (const event of events) {
    if (event.level === "error" || event.type === "failed") {
      reasons.add(event.message);
    }
  }

  return Array.from(reasons).filter(Boolean);
}

function missionSummaryText(
  mission: MissionRecord,
  events: MissionEvent[],
  waitingFor: string | null
): string {
  const operatorState = missionOperatorStateFromMission(mission);
  const latestOperatorAction = missionLatestOperatorAction(mission);

  if (operatorState === "blocked" && mission.blocker?.reason) {
    return `Blocked: ${trimText(mission.blocker.reason, 160)}`;
  }

  if (operatorState === "paused") {
    return (
      trimText(latestOperatorAction?.reason, 180) ||
      trimText(latestOperatorAction?.detail, 180) ||
      "Mission paused by operator."
    );
  }

  if (operatorState === "terminating") {
    return (
      trimText(latestOperatorAction?.reason, 180) ||
      "Mission termination requested."
    );
  }

  if (trimText(mission.summary, 180)) {
    return trimText(mission.summary, 180);
  }

  const latestEventMessage = trimText(events[events.length - 1]?.message, 180);
  if (latestEventMessage) {
    return latestEventMessage;
  }

  if (waitingFor) {
    return waitingFor;
  }

  if (mission.status === "queued") {
    return "Mission created and waiting for execution signals.";
  }

  if (mission.status === "done") {
    return "Mission completed and is ready for review.";
  }

  if (mission.status === "failed") {
    return "Mission stopped before the execution chain could complete.";
  }

  if (mission.status === "cancelled") {
    return trimText(mission.cancelReason, 180) || "Mission was cancelled before the execution chain completed.";
  }

  return "Mission is progressing through the execution pipeline.";
}

function timelineLevelForMissionEvent(event: MissionEvent): TimelineLevel {
  if (event.type === "done") return "success";
  if (event.type === "failed" || event.level === "error") return "error";
  if (event.type === "cancelled") return "warn";
  if (event.type === "waiting" || event.level === "warn") return "warn";
  return "info";
}

function titleForMissionEvent(
  mission: MissionRecord,
  event: MissionEvent
): string {
  const stageLabel = stageLabelFromMission(mission, event.stageKey);

  switch (event.type) {
    case "created":
      return "Mission created";
    case "progress":
      return stageLabel ? `Stage active: ${stageLabel}` : "Mission progressed";
    case "waiting":
      return stageLabel ? `Waiting in ${stageLabel}` : "Awaiting decision";
    case "done":
      return "Mission completed";
    case "failed":
      return "Mission failed";
    case "cancelled":
      return "Mission cancelled";
    case "log":
    default:
      return stageLabel ? `${stageLabel} signal` : "Mission log";
  }
}

function buildMissionTimeline(
  mission: MissionRecord,
  events: MissionEvent[]
): TaskTimelineEvent[] {
  const items: TaskTimelineEvent[] = events.map((event, index) => ({
    id: `${mission.id}:${event.time}:${event.type}:${index}`,
    type: event.type,
    time: event.time,
    level: timelineLevelForMissionEvent(event),
    title: titleForMissionEvent(mission, event),
    description: event.message,
    actor: event.source ? capitalize(event.source.replace(/-/g, " ")) : undefined,
  }));

  if (!items.some(item => item.type === "created")) {
    items.unshift({
      id: `${mission.id}:created`,
      type: "created",
      time: mission.createdAt,
      level: "info",
      title: "Mission created",
      description: trimText(mission.sourceText || mission.title, 180) || "Mission created.",
    });
  }

  return items.sort((left, right) => left.time - right.time).slice(-40);
}

function buildMissionInteriorStages(mission: MissionRecord): TaskStageRing[] {
  const orderedStages: MissionStage[] =
    mission.stages.length > 0
      ? mission.stages
      : MISSION_CORE_STAGE_BLUEPRINT.map(stage => ({
          key: stage.key,
          label: stage.label,
          status:
            mission.currentStageKey === stage.key && mission.status !== "queued"
              ? ("running" as const)
              : ("pending" as const),
          detail: undefined,
        }));

  return orderedStages.map((stage, index) => {
    const arcStart = (index / orderedStages.length) * 360;
    const arcEnd = ((index + 1) / orderedStages.length) * 360;
    const midAngle = (arcStart + arcEnd) / 2;
    const segmentStart = (index / orderedStages.length) * 100;
    const segmentEnd = ((index + 1) / orderedStages.length) * 100;
    const segmentProgress =
      segmentEnd <= segmentStart
        ? 0
        : ((clampPercentage(mission.progress) - segmentStart) /
            (segmentEnd - segmentStart)) *
          100;

    let progress = 0;
    if (stage.status === "done") {
      progress = 100;
    } else if (stage.status === "running") {
      progress = Math.max(18, Math.min(96, Math.round(segmentProgress)));
    } else if (stage.status === "failed") {
      progress = Math.max(24, Math.min(92, Math.round(segmentProgress || 42)));
    }

    return {
      key: stage.key,
      label: stage.label,
      status: stage.status,
      progress,
      detail:
        stage.detail ||
        (stage.status === "done"
          ? "Completed"
          : stage.status === "running"
            ? "Live stage"
            : stage.status === "failed"
              ? "Blocked"
              : "Queued"),
      arcStart,
      arcEnd,
      midAngle,
    };
  });
}

function inferMissionCoreAgentStatus(
  status: MissionTaskStatus,
  operatorState: MissionOperatorState = "active"
): InteriorAgentStatus {
  if (operatorState === "paused" || operatorState === "blocked") return "idle";
  if (status === "running") return "working";
  if (status === "waiting") return "thinking";
  if (status === "done") return "done";
  if (status === "failed") return "error";
  if (status === "cancelled") return "idle";
  return "idle";
}

function withAgentAngles(
  agents: Omit<TaskInteriorAgent, "angle">[]
): TaskInteriorAgent[] {
  return agents.map((agent, index) => ({
    ...agent,
    angle: agents.length <= 1 ? 0 : Math.round((360 / agents.length) * index),
  }));
}

function extensionFromValue(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.split(/[?#]/)[0];
  const index = normalized.lastIndexOf(".");
  if (index === -1 || index === normalized.length - 1) {
    return null;
  }
  return normalized.slice(index + 1).toLowerCase();
}

export function buildMissionArtifacts(mission: MissionRecord): TaskArtifact[] {
  return (mission.artifacts || []).map((artifact: MissionArtifact, index) => {
    const downloadUrl = `/api/tasks/${mission.id}/artifacts/${index}/download`;
    const previewUrl = `/api/tasks/${mission.id}/artifacts/${index}/preview`;
    const format =
      extensionFromValue(artifact.name) ||
      extensionFromValue(artifact.path) ||
      extensionFromValue(artifact.url) ||
      undefined;

    const isExternal = artifact.kind === "url";
    const downloadKind: TaskArtifact["downloadKind"] = isExternal
      ? "external"
      : artifact.path
        ? "server"
        : undefined;
    const href = isExternal
      ? artifact.url
      : artifact.path
        ? downloadUrl
        : undefined;

    return {
      id: `${mission.id}:mission-artifact:${index}`,
      title: artifact.name,
      description:
        artifact.description ||
        artifact.path ||
        artifact.url ||
        `${capitalize(artifact.kind)} artifact`,
      kind: artifact.kind,
      format,
      filename: artifact.name,
      downloadKind,
      href,
      downloadUrl,
      previewUrl,
    };
  });
}

function dedupeArtifacts(artifacts: TaskArtifact[]): TaskArtifact[] {
  const seen = new Set<string>();
  return artifacts.filter(artifact => {
    const key = [
      artifact.kind,
      artifact.title,
      artifact.format || "",
      artifact.href || "",
      artifact.filename || "",
    ].join("::");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildMissionDecisionPresets(
  decision: MissionDecision | undefined
): TaskDecisionPreset[] {
  if (!decision) {
    return [];
  }

  const options = Array.isArray(decision.options) ? decision.options : [];
  if (options.length === 0 && decision.allowFreeText) {
    return [
      {
        id: "mission-free-text",
        label: "Submit note",
        description: "Resume the mission with a decision note.",
        prompt: decision.prompt,
        tone: "primary",
        action: "mission",
      },
    ];
  }

  return options.map((option, index) => ({
    id: `mission:${option.id}`,
    label: option.label,
    description:
      option.description ||
      (decision.allowFreeText
        ? "Submit this option with an optional note."
        : "Submit this option and resume the mission."),
    prompt: decision.prompt,
    tone:
      index === 0
        ? "primary"
        : /abort|stop|reject|fail|report/i.test(option.label)
          ? "warning"
          : "secondary",
    action: "mission",
    optionId: option.id,
  }));
}

function buildMissionInstanceInfo(
  summary: MissionTaskSummary,
  mission: MissionRecord
): Array<{ label: string; value: string }> {
  return [
    { label: "Mission ID", value: mission.id },
    { label: "Runtime", value: "Advanced server runtime" },
    { label: "Current stage", value: summary.currentStageLabel || "Not started" },
    { label: "Executor", value: mission.executor?.name || "n/a" },
    { label: "Executor job", value: mission.executor?.jobId || "n/a" },
    { label: "Executor request", value: mission.executor?.requestId || "n/a" },
    { label: "Attempt", value: String(summary.attempt) },
    { label: "Instance", value: mission.instance?.id || "n/a" },
    { label: "Workspace", value: mission.instance?.workspaceRoot || "n/a" },
    { label: "Created", value: formatShortDate(summary.createdAt) },
    { label: "Completed", value: formatShortDate(summary.completedAt) },
  ];
}

function buildMissionLogSummary(
  mission: MissionRecord,
  events: MissionEvent[]
): Array<{ label: string; value: string }> {
  const lastEvent = events[events.length - 1];

  return [
    { label: "Event entries", value: formatCount(events.length) },
    {
      label: "Progress signals",
      value: formatCount(events.filter(event => event.type === "progress").length),
    },
    {
      label: "Waiting signals",
      value: formatCount(events.filter(event => event.type === "waiting").length),
    },
    {
      label: "Log entries",
      value: formatCount(events.filter(event => event.type === "log").length),
    },
    {
      label: "Executor status",
      value: mission.executor?.status || "n/a",
    },
    {
      label: "Last signal",
      value: lastEvent
        ? `${lastEvent.type} @ ${formatShortDate(lastEvent.time)}`
        : "No live mission event yet",
    },
  ];
}

/**
 * Planet-native summary 构建：从 MissionPlanetOverviewItem 派生。
 * 可选传入 MissionRecord 以获取 workPackages/messageLog 等丰富化字段。
 */
export function buildPlanetSummaryRecord(
  planet: MissionPlanetOverviewItem,
  mission?: MissionRecord
): MissionTaskSummary {
  const workPackages = mission?.workPackages ?? [];
  const messageLog = mission?.messageLog ?? [];
  const events = mission?.events ?? [];
  const artifacts = mission?.artifacts ?? [];

  const taskCount = workPackages.length;
  const completedTaskCount = workPackages.filter(
    wp => wp.status === "passed" || wp.status === "verified"
  ).length;
  const messageCount = messageLog.length;
  const activeAgentCount = mission?.agentCrew
    ? mission.agentCrew.filter(a => a.status === "working" || a.status === "thinking").length
    : 0;

  const failureReasons: string[] = [];
  if (mission) {
    failureReasons.push(...missionFailureReasons(mission, events));
  }

  const waitingFor = planet.waitingFor ?? null;
  const currentStageKey = planet.currentStageKey ?? null;
  const currentStageLabel = planet.currentStageLabel ?? null;

  const summaryText = mission
    ? missionSummaryText(mission, events, waitingFor)
    : trimText(planet.summary, 180) || "Mission is progressing through the execution pipeline.";

  const startedAt = mission ? missionStartedAt(mission) : null;

  const lastEvent = events[events.length - 1];
  const lastMessage = messageLog[messageLog.length - 1];

  return {
    id: planet.id,
    title: trimText(planet.title, 76) || "Untitled mission",
    kind: planet.kind || "general",
    sourceText: planet.sourceText || planet.title,
    status: planet.status === "archived" ? "done" : planet.status,
    operatorState: mission ? missionOperatorStateFromMission(mission) : "active",
    workflowStatus: workflowStatusFromMission(
      planet.status === "archived" ? "done" : planet.status
    ),
    progress: clampPercentage(planet.progress),
    currentStageKey,
    currentStageLabel,
    summary: summaryText,
    waitingFor,
    blocker: mission?.blocker ?? null,
    attempt: Math.max(1, mission?.attempt ?? 1),
    latestOperatorAction: mission ? missionLatestOperatorAction(mission) : null,
    createdAt: planet.createdAt,
    updatedAt: planet.updatedAt,
    startedAt,
    completedAt: planet.completedAt ?? null,
    departmentLabels:
      planet.tags.length > 0
        ? planet.tags
        : planet.kind
          ? [capitalize(planet.kind.replace(/[_-]/g, " "))]
          : [],
    taskCount,
    completedTaskCount,
    messageCount,
    activeAgentCount,
    attachmentCount: artifacts.length,
    issueCount: failureReasons.length,
    hasWarnings:
      failureReasons.length > 0 ||
      events.some((event: MissionEvent) => event.level === "warn"),
    lastSignal:
      trimText(lastEvent?.message, 96) ||
      trimText(lastMessage?.content, 96) ||
      currentStageLabel ||
      null,
  };
}

/**
 * summary 构建：完全从 MissionRecord 派生。
 */
function buildSummaryRecord(mission: MissionRecord): MissionTaskSummary {
  const currentStageKey = stageKeyFromMission(mission);
  const currentStageLabel = stageLabelFromMission(mission, currentStageKey);
  const operatorState = missionOperatorStateFromMission(mission);
  const latestOperatorAction = missionLatestOperatorAction(mission);
  const waitingFor =
    mission.waitingFor ||
    (mission.status === "waiting"
      ? mission.decision?.prompt || "Awaiting decision"
      : null);
  const failureReasons = missionFailureReasons(mission, mission.events);
  const lastEvent = mission.events[mission.events.length - 1];

  return {
    id: mission.id,
    title: trimText(mission.title, 76) || "Untitled mission",
    kind: mission.kind || "general",
    sourceText: mission.sourceText || mission.title,
    status: mission.status,
    operatorState,
    workflowStatus: workflowStatusFromMission(mission.status),
    progress: clampPercentage(mission.progress),
    currentStageKey,
    currentStageLabel,
    summary: missionSummaryText(mission, mission.events, waitingFor),
    waitingFor,
    blocker: mission.blocker ?? null,
    attempt: Math.max(1, mission.attempt ?? 1),
    latestOperatorAction,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    startedAt: missionStartedAt(mission),
    completedAt: mission.completedAt || null,
    departmentLabels:
      mission.organization?.departments.map(d => d.label) ?? [],
    taskCount: mission.workPackages?.length ?? 0,
    completedTaskCount:
      mission.workPackages?.filter(
        wp => wp.status === "passed" || wp.status === "verified"
      ).length ?? 0,
    messageCount: mission.messageLog?.length ?? 0,
    activeAgentCount:
      mission.agentCrew?.filter(
        a => a.status === "working" || a.status === "thinking"
      ).length ?? 0,
    attachmentCount: mission.artifacts?.length ?? 0,
    issueCount: failureReasons.length,
    hasWarnings:
      failureReasons.length > 0 ||
      operatorState === "blocked" ||
      mission.events.some(e => e.level === "warn"),
    lastSignal:
      trimText(latestOperatorAction?.detail, 96) ||
      trimText(latestOperatorAction?.reason, 96) ||
      trimText(lastEvent?.message, 96) ||
      trimText(
        mission.messageLog?.[mission.messageLog.length - 1]?.content,
        96
      ) ||
      currentStageLabel ||
      null,
  };
}

/**
 * 原生 agent 构建：从 MissionRecord.agentCrew 派生（mission-native 数据源）。
 * 始终包含 mission-core agent。
 */
function buildNativeInteriorAgents(
  mission: MissionRecord
): TaskInteriorAgent[] {
  const currentStageKey = stageKeyFromMission(mission) || "receive";
  const currentStageLabel =
    stageLabelFromMission(mission, currentStageKey) || currentStageKey;

  const agents: Array<Omit<TaskInteriorAgent, "angle">> = [];

  if (mission.agentCrew) {
    for (const member of mission.agentCrew) {
      agents.push({
        id: member.id,
        name: member.name,
        role: member.role,
        department: member.department ?? "",
        title: member.role,
        status: member.status,
        stageKey: currentStageKey,
        stageLabel: currentStageLabel,
        progress: null,
        currentAction: undefined,
      });
    }
  }

  // 始终包含 mission-core agent
  agents.push({
    id: "mission-core",
    name: "Mission Core",
    role: "orchestrator",
    department: "Mission",
    title: "Mission controller",
    status: inferMissionCoreAgentStatus(
      mission.status,
      missionOperatorStateFromMission(mission),
    ),
    stageKey: currentStageKey,
    stageLabel: currentStageLabel,
    progress: clampPercentage(mission.progress),
    currentAction: undefined,
  });

  return withAgentAngles(agents);
}

/**
 * 原生 log summary 构建：从 MissionRecord.messageLog 最近 10 条派生。
 */
function buildNativeLogSummary(
  mission: MissionRecord
): Array<{ label: string; value: string }> {
  if (!mission.messageLog?.length) {
    return [{ label: "Messages", value: "No messages yet" }];
  }

  const recent = mission.messageLog.slice(-10);
  return recent.map(entry => ({
    label: entry.sender,
    value: entry.content,
  }));
}

/**
 * detail 构建：完全从 MissionRecord 派生。
 */
function buildDetailRecord(
  mission: MissionRecord,
  missionSocketConnected = false
): MissionTaskDetail {
  const summary = buildSummaryRecord(mission);
  const failureReasons = missionFailureReasons(mission, mission.events);

  return {
    ...summary,
    workflow: syntheticWorkflowFromMission(mission),
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: buildMissionInteriorStages(mission),
    agents: buildNativeInteriorAgents(mission),
    timeline: buildMissionTimeline(mission, mission.events),
    artifacts: dedupeArtifacts(buildMissionArtifacts(mission)),
    failureReasons,
    decisionPresets: buildMissionDecisionPresets(mission.decision),
    decisionPrompt: mission.decision?.prompt || null,
    decisionPlaceholder: mission.decision?.placeholder || null,
    decisionAllowsFreeText: mission.decision?.allowFreeText === true,
    decision: mission.decision ?? null,
    instanceInfo: buildMissionInstanceInfo(summary, mission),
    logSummary: buildMissionLogSummary(mission, mission.events),
    runtimeChannels: buildRuntimeChannels(mission, missionSocketConnected),
    decisionHistory: mission.decisionHistory ?? [],
    operatorActions: mission.operatorActions ?? [],
    securitySummary: mission.securitySummary,
    executor: mission.executor,
    instance: mission.instance,
    missionArtifacts: mission.artifacts,
  };
}/**
 * Build a MissionTaskDetail from the /api/planets/:id/interior response.
 * This is the planet-native counterpart of buildMissionDetailRecord —
 * it derives every field from MissionPlanetInteriorData + MissionRecord,
 * without touching WorkflowRecord at all.
 */
export function buildPlanetDetailRecord(
  planet: MissionPlanetOverviewItem,
  interior: MissionPlanetInteriorData,
  mission: MissionRecord,
  missionSocketConnected = false
): MissionTaskDetail {
  const summary = buildSummaryRecord(mission);
  const events = interior.events ?? [];

  // ── stages: MissionPlanetInteriorStage[] → TaskStageRing[] ──
  const stages: TaskStageRing[] = interior.stages.map(s => ({
    key: s.key,
    label: s.label,
    status: s.status,
    progress: s.progress,
    detail: s.detail || (
      s.status === 'done' ? 'Completed'
        : s.status === 'running' ? 'Live stage'
        : s.status === 'failed' ? 'Blocked'
        : 'Queued'
    ),
    arcStart: s.arcStart,
    arcEnd: s.arcEnd,
    midAngle: s.midAngle,
  }));

  // ── agents: MissionPlanetInteriorAgent[] → TaskInteriorAgent[] ──
  const agents: TaskInteriorAgent[] = interior.agents.map(a => ({
    id: a.id,
    name: a.name,
    role: a.role,
    department: a.role === 'orchestrator' ? 'Mission' : capitalize(a.stageLabel || a.stageKey),
    title: a.currentAction || a.role,
    status: a.status as InteriorAgentStatus,
    stageKey: a.stageKey,
    stageLabel: a.stageLabel,
    progress: a.progress ?? null,
    currentAction: a.currentAction,
    angle: a.angle,
  }));

  // ── timeline from interior events ──
  const timeline = buildMissionTimeline(mission, events);

  // ── artifacts from mission ──
  const artifacts = dedupeArtifacts(buildMissionArtifacts(mission));

  // ── failure reasons ──
  const failureReasons = Array.from(
    new Set(missionFailureReasons(mission, events))
  );

  return {
    ...summary,
    workflow: syntheticWorkflowFromMission(mission),
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages,
    agents,
    timeline,
    artifacts,
    failureReasons,
    decisionPresets: buildMissionDecisionPresets(mission.decision),
    decisionPrompt: mission.decision?.prompt || null,
    decisionPlaceholder: mission.decision?.placeholder || null,
    decisionAllowsFreeText: mission.decision?.allowFreeText === true,
    decision: mission.decision ?? null,
    instanceInfo: buildMissionInstanceInfo(summary, mission),
    logSummary: buildMissionLogSummary(mission, events),
    runtimeChannels: buildRuntimeChannels(mission, missionSocketConnected),
    decisionHistory: mission.decisionHistory ?? [],
    operatorActions: mission.operatorActions ?? [],
    securitySummary: mission.securitySummary,
    executor: mission.executor,
    instance: mission.instance,
    missionArtifacts: mission.artifacts,
  };
}

/* buildMissionDetailRecord — kept for backward compat, delegates to buildDetailRecord */
function buildMissionDetailRecord(
  mission: MissionRecord,
  missionSocketConnected = false
): MissionTaskDetail {
  const summary = buildSummaryRecord(mission);
  const failureReasons = missionFailureReasons(mission, mission.events);

  return {
    ...summary,
    workflow: syntheticWorkflowFromMission(mission),
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: buildMissionInteriorStages(mission),
    agents: buildNativeInteriorAgents(mission),
    timeline: buildMissionTimeline(mission, mission.events),
    artifacts: dedupeArtifacts(buildMissionArtifacts(mission)),
    failureReasons,
    decisionPresets: buildMissionDecisionPresets(mission.decision),
    decisionPrompt: mission.decision?.prompt || null,
    decisionPlaceholder: mission.decision?.placeholder || null,
    decisionAllowsFreeText: mission.decision?.allowFreeText === true,
    decision: mission.decision ?? null,
    instanceInfo: buildMissionInstanceInfo(summary, mission),
    logSummary: buildNativeLogSummary(mission),
    runtimeChannels: buildRuntimeChannels(mission, missionSocketConnected),
    decisionHistory: mission.decisionHistory ?? [],
    operatorActions: mission.operatorActions ?? [],
    securitySummary: mission.securitySummary,
    executor: mission.executor,
    instance: mission.instance,
    missionArtifacts: mission.artifacts,
  };
}

function queueTasksRefresh(options?: { preferredTaskId?: string | null }) {
  queuedRefreshOptions = {
    preferredTaskId:
      options?.preferredTaskId ?? queuedRefreshOptions?.preferredTaskId ?? null,
  };
  if (typeof window === "undefined") return;
  if (scheduledRefreshTimer !== null) {
    window.clearTimeout(scheduledRefreshTimer);
  }
  scheduledRefreshTimer = window.setTimeout(() => {
    scheduledRefreshTimer = null;
    const nextOptions = queuedRefreshOptions;
    queuedRefreshOptions = null;
    void useTasksStore.getState().refresh(nextOptions || undefined);
  }, 140);
}

function stopMissionSocket() {
  if (!missionSocket) return;
  missionSocket.off(MISSION_SOCKET_EVENT);
  missionSocket.disconnect();
  missionSocket = null;
}

function resolveSelectedTaskId(
  summaries: MissionTaskSummary[],
  currentSelectedTaskId: string | null,
  preferredTaskId?: string | null
): string | null {
  const candidateTaskIds = [
    preferredTaskId,
    currentSelectedTaskId,
    readPersistedSelectedTaskId(),
  ].filter(
    (taskId, index, allTaskIds): taskId is string =>
      Boolean(taskId) && allTaskIds.indexOf(taskId) === index
  );

  for (const taskId of candidateTaskIds) {
    if (summaries.some(summary => summary.id === taskId)) {
      return taskId;
    }
  }

  return pickFallbackTaskId(summaries);
}

export async function patchMissionRecordInStore(
  missionId: string,
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState
): Promise<void> {
  if (useAppStore.getState().runtimeMode !== "advanced") {
    return;
  }

  const missionResponse = await getMission(missionId);
  const summary = buildSummaryRecord(missionResponse.task);
  const detail = buildDetailRecord(
    missionResponse.task,
    get().missionSocketConnected
  );

  set(state => {
    const nextTasks = [...state.tasks.filter(task => task.id !== missionId), summary]
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const nextSelectedTaskId = resolveSelectedTaskId(
      nextTasks,
      state.selectedTaskId,
      state.selectedTaskId === missionId ? missionId : undefined
    );
    persistSelectedTaskId(nextSelectedTaskId);

    return {
      ready: true,
      loading: false,
      error: null,
      tasks: nextTasks,
      detailsById: {
        ...state.detailsById,
        [missionId]: detail,
      },
      selectedTaskId: nextSelectedTaskId,
    };
  });
}

function ensureMissionSocket(
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState
) {
  if (typeof window === "undefined") {
    return;
  }

  if (useAppStore.getState().runtimeMode !== "advanced") {
    stopMissionSocket();
    return;
  }

  if (missionSocket) {
    return;
  }

  missionSocket = io(window.location.origin, {
    transports: ["websocket", "polling"],
  });

  // Initialize sandbox store for live log/screenshot streaming
  useSandboxStore.getState().initSocket(missionSocket);

  missionSocket.on("connect", () => {
    set(state => ({
      missionSocketConnected: true,
      detailsById: updateDetailsSocketConnection(state.detailsById, true),
    }));
    queueTasksRefresh({
      preferredTaskId: get().selectedTaskId,
    });
  });

  missionSocket.on(MISSION_SOCKET_EVENT, (payload: MissionSocketPayload) => {
    if (!payload || typeof payload !== "object" || !("type" in payload)) {
      return;
    }

    if (payload.type === "mission.snapshot") {
      queueTasksRefresh({
        preferredTaskId: get().selectedTaskId,
      });
      return;
    }

    if (!("missionId" in payload) || !payload.missionId) {
      return;
    }

    // Handle decision submitted: immediately update decisionHistory from the payload
    if (
      payload.type === MISSION_SOCKET_TYPES.decisionSubmitted &&
      "task" in payload &&
      payload.task
    ) {
      const mission = payload.task;
      const summary = buildSummaryRecord(mission);
      const detail = buildDetailRecord(mission, get().missionSocketConnected);

      set(state => {
        const nextTasks = [
          ...state.tasks.filter(t => t.id !== mission.id),
          summary,
        ].sort((a, b) => b.updatedAt - a.updatedAt);

        return {
          tasks: nextTasks,
          detailsById: {
            ...state.detailsById,
            [mission.id]: detail,
          },
        };
      });
      return;
    }

    if (payload.type === MISSION_SOCKET_TYPES.executorEvent) {
      const executorEvent = payload.event;
      set(state => {
        const detail = state.detailsById[payload.missionId];
        if (!detail) {
          return {};
        }

        return {
          detailsById: {
            ...state.detailsById,
            [payload.missionId]: {
              ...detail,
              lastSignal: trimText(
                executorEvent.summary ||
                  executorEvent.detail ||
                  executorEvent.message,
                180
              ) || detail.lastSignal,
              waitingFor:
                executorEvent.waitingFor ||
                detail.waitingFor,
              runtimeChannels: applyExecutorEventToRuntimeChannels(
                detail.runtimeChannels,
                executorEvent
              ),
            },
          },
        };
      });
    }

    void patchMissionRecordInStore(payload.missionId, set, get).catch(error => {
      console.warn(
        `[Tasks] Failed to patch mission ${payload.missionId} from socket event:`,
        error
      );
      queueTasksRefresh({
        preferredTaskId: payload.missionId,
      });
    });
  });

  missionSocket.on("disconnect", () => {
    set(state => ({
      missionSocketConnected: false,
      detailsById: updateDetailsSocketConnection(state.detailsById, false),
    }));
    if (useAppStore.getState().runtimeMode !== "advanced") {
      stopMissionSocket();
    }
  });
}

function startTaskStoreWatchers() {
  if (taskStoreWatchersStarted) return;
  taskStoreWatchersStarted = true;

  useAppStore.subscribe((state, previousState) => {
    if (state.runtimeMode !== previousState.runtimeMode) {
      if (state.runtimeMode !== "advanced") {
        stopMissionSocket();
      }
      queueTasksRefresh();
    }
  });
}

/**
 * 任务数据加载入口。
 * Advanced Mode: 优先走 planet-native，失败时降级到 mission-native。
 * Frontend Mode: 走 mission-native。
 */
async function hydrateTaskData(
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState,
  options?: { preferredTaskId?: string | null }
): Promise<void> {
  startTaskStoreWatchers();

  if (useAppStore.getState().runtimeMode === "advanced") {
    try {
      await hydratePlanetTaskData(set, get, options);
      return;
    } catch (error) {
      console.warn("[Tasks] Planet hydration failed, falling back to mission hydration:", error);
    }
  }

  // mission-native fallback  ensureMissionSocket(set, get);

  const missionsResponse = await listMissions(200);
  const missions = [...missionsResponse.tasks].sort(
    (left, right) => right.updatedAt - left.updatedAt
  );

  // 加载每个 mission 的事件，用于 timeline 和 failure reasons
  const eventsEntries = await Promise.all(
    missions.map(async mission => {
      try {
        const response = await listMissionEvents(mission.id, 60);
        return [mission.id, response.events] as const;
      } catch (error) {
        console.warn(
          `[Tasks] Failed to load mission events for ${mission.id}:`,
          error
        );
        return [mission.id, mission.events || []] as const;
      }
    })
  );
  const missionEvents = Object.fromEntries(eventsEntries) as Record<
    string,
    MissionEvent[]
  >;

  // 将事件注入 mission record 以便 buildSummaryRecord/buildDetailRecord 使用
  const enrichedMissions = missions.map(mission => ({
    ...mission,
    events: missionEvents[mission.id] || mission.events || [],
  }));

  const summaries = enrichedMissions
    .map(mission => buildSummaryRecord(mission))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const selectedTaskId = resolveSelectedTaskId(
    summaries,
    get().selectedTaskId,
    options?.preferredTaskId
  );
  persistSelectedTaskId(selectedTaskId);

  const detailsById = Object.fromEntries(
    enrichedMissions.map(mission => [
      mission.id,
      buildDetailRecord(mission, get().missionSocketConnected),
    ])
  ) as Record<string, MissionTaskDetail>;

  set({
    ready: true,
    loading: false,
    error: null,
    tasks: summaries,
    detailsById,
    selectedTaskId,
  });
}

/**
 * Planet-native hydration: uses /api/planets endpoints.
 */
async function hydratePlanetTaskData(
  set: (
    partial:
      | Partial<TasksStoreState>
      | ((state: TasksStoreState) => Partial<TasksStoreState>)
  ) => void,
  get: () => TasksStoreState,
  options?: { preferredTaskId?: string | null }
): Promise<void> {
  ensureMissionSocket(set, get);

  const [planetsResponse, missionsResponse] = await Promise.all([
    listPlanets(200),
    listMissions(200),
  ]);

  const planets = planetsResponse.planets;
  const missionById = new Map<string, MissionRecord>(
    missionsResponse.tasks.map((m: MissionRecord) => [m.id, m])
  );

  const summaries = planets
    .map((planet: MissionPlanetOverviewItem) => buildPlanetSummaryRecord(planet, missionById.get(planet.id)))
    .sort((left: MissionTaskSummary, right: MissionTaskSummary) => right.updatedAt - left.updatedAt);

  const selectedTaskId = resolveSelectedTaskId(
    summaries,
    get().selectedTaskId,
    options?.preferredTaskId
  );
  persistSelectedTaskId(selectedTaskId);

  const detailsById: Record<string, MissionTaskDetail> = {};
  for (const planet of planets) {
    const mission = missionById.get(planet.id);
    if (!mission) continue;

    if (planet.id === selectedTaskId) {
      try {
        const interiorResponse = await getPlanetInterior(planet.id);
        detailsById[planet.id] = buildPlanetDetailRecord(
          planet,
          interiorResponse.interior,
          mission,
          get().missionSocketConnected
        );
      } catch {
        detailsById[planet.id] = buildMissionDetailRecord(
          mission,
          get().missionSocketConnected
        );
      }
    } else {
      detailsById[planet.id] = buildMissionDetailRecord(
        mission,
        get().missionSocketConnected
      );
    }
  }

  set({
    ready: true,
    loading: false,
    error: null,
    tasks: summaries,
    detailsById,
    selectedTaskId,
  });
}

export const useTasksStore = create<TasksStoreState>((set, get) => ({
  ready: false,
  loading: false,
  error: null,
  missionSocketConnected: false,
  selectedTaskId: null,
  tasks: [],
  detailsById: {},
  decisionNotes: {},
  cancellingMissionIds: {},
  operatorActionLoadingByMissionId: {},
  lastDecisionLaunch: null,

  ensureReady: async () => {
    if (get().ready || inFlightRefresh) {
      if (inFlightRefresh) {
        await inFlightRefresh;
      }
      return;
    }

    set({ loading: true, error: null });
    inFlightRefresh = hydrateTaskData(set, get);
    try {
      await inFlightRefresh;
    } catch (error) {
      console.error("[Tasks] Failed to initialize tasks store:", error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load tasks.",
      });
    } finally {
      inFlightRefresh = null;
      if (queuedRefreshOptions) {
        const nextOptions = queuedRefreshOptions;
        queuedRefreshOptions = null;
        void get().refresh(nextOptions);
      }
    }
  },

  refresh: async options => {
    if (inFlightRefresh) {
      queuedRefreshOptions = {
        preferredTaskId:
          options?.preferredTaskId ??
          queuedRefreshOptions?.preferredTaskId ??
          null,
      };
      await inFlightRefresh;
      return;
    }

    set(state => ({
      loading: !state.ready && state.tasks.length === 0,
      error: null,
    }));

    inFlightRefresh = hydrateTaskData(set, get, options);
    try {
      await inFlightRefresh;
    } catch (error) {
      console.error("[Tasks] Failed to refresh tasks store:", error);
      set({
        loading: false,
        error:
          error instanceof Error ? error.message : "Failed to refresh tasks.",
      });
    } finally {
      inFlightRefresh = null;
      if (queuedRefreshOptions) {
        const nextOptions = queuedRefreshOptions;
        queuedRefreshOptions = null;
        void get().refresh(nextOptions);
      }
    }
  },

  selectTask: taskId => {
    persistSelectedTaskId(taskId);
    set({ selectedTaskId: taskId });
  },

  createMission: async input => {
    if (useAppStore.getState().runtimeMode !== "advanced") {
      set({
        error: "Mission creation is only available in advanced runtime mode.",
      });
      return null;
    }

    const response = await createMissionRequest(input);
    await get().refresh({
      preferredTaskId: response.task.id,
    });
    return response.task.id;
  },

  cancelMission: async (taskId, payload) => {
    await get().ensureReady();

    set(state => ({
      error: null,
      cancellingMissionIds: {
        ...state.cancellingMissionIds,
        [taskId]: true,
      },
    }));

    try {
      const response = await cancelMissionRequest(taskId, {
        reason: payload.reason?.trim() || undefined,
        requestedBy: payload.requestedBy?.trim() || undefined,
        source: payload.source ?? "user",
      });

      const summary = buildSummaryRecord(response.task);
      const detail = buildDetailRecord(
        response.task,
        get().missionSocketConnected
      );

      set(state => {
        const nextTasks = [
          ...state.tasks.filter(task => task.id !== taskId),
          summary,
        ].sort((left, right) => right.updatedAt - left.updatedAt);
        const nextSelectedTaskId = resolveSelectedTaskId(
          nextTasks,
          state.selectedTaskId,
          taskId,
        );
        persistSelectedTaskId(nextSelectedTaskId);

        return {
          tasks: nextTasks,
          detailsById: {
            ...state.detailsById,
            [taskId]: detail,
          },
          selectedTaskId: nextSelectedTaskId,
        };
      });

      return response.task.id;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to cancel mission.",
      });
      throw error;
    } finally {
      set(state => ({
        cancellingMissionIds: {
          ...state.cancellingMissionIds,
          [taskId]: false,
        },
      }));
    }
  },

  submitOperatorAction: async (taskId, payload) => {
    await get().ensureReady();

    set(state => ({
      error: null,
      operatorActionLoadingByMissionId: {
        ...state.operatorActionLoadingByMissionId,
        [taskId]: {
          ...(state.operatorActionLoadingByMissionId[taskId] ?? {}),
          [payload.action]: true,
        },
      },
    }));

    try {
      const response = await submitMissionOperatorActionRequest(taskId, {
        action: payload.action,
        reason: payload.reason?.trim() || undefined,
        requestedBy: payload.requestedBy?.trim() || undefined,
      });

      const summary = buildSummaryRecord(response.task);
      const detail = buildDetailRecord(
        response.task,
        get().missionSocketConnected
      );

      set(state => {
        const nextTasks = [
          ...state.tasks.filter(task => task.id !== taskId),
          summary,
        ].sort((left, right) => right.updatedAt - left.updatedAt);
        const nextSelectedTaskId = resolveSelectedTaskId(
          nextTasks,
          state.selectedTaskId,
          taskId,
        );
        persistSelectedTaskId(nextSelectedTaskId);

        return {
          tasks: nextTasks,
          detailsById: {
            ...state.detailsById,
            [taskId]: detail,
          },
          selectedTaskId: nextSelectedTaskId,
        };
      });

      return response.task.id;
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : "Failed to submit mission operator action.",
      });
      throw error;
    } finally {
      set(state => ({
        operatorActionLoadingByMissionId: {
          ...state.operatorActionLoadingByMissionId,
          [taskId]: {
            ...(state.operatorActionLoadingByMissionId[taskId] ?? {}),
            [payload.action]: false,
          },
        },
      }));
    }
  },

  setDecisionNote: (taskId, note) => {
    set(state => ({
      decisionNotes: {
        ...state.decisionNotes,
        [taskId]: note,
      },
    }));
  },

  launchDecision: async (taskId, presetId) => {
    await get().ensureReady();
    const detail = get().detailsById[taskId];
    const preset = detail?.decisionPresets.find(item => item.id === presetId);
    if (!detail || !preset) return null;

    const note = get().decisionNotes[taskId]?.trim();

    if (!preset.optionId && detail.decisionAllowsFreeText !== true) {
      set({
        error: "This mission decision requires a configured option.",
      });
      return null;
    }

    if (!preset.optionId && detail.decisionAllowsFreeText && !note) {
      set({
        error: "Add a note before submitting this mission decision.",
      });
      return null;
    }

    const response = await submitMissionDecisionRequest(taskId, {
      optionId: preset.optionId,
      freeText: detail.decisionAllowsFreeText ? note || undefined : undefined,
      detail:
        detail.decisionAllowsFreeText !== true && note ? note : undefined,
    });

    set(state => ({
      error: null,
      decisionNotes: {
        ...state.decisionNotes,
        [taskId]: "",
      },
      lastDecisionLaunch: {
        sourceTaskId: taskId,
        sourceTaskTitle: detail.title,
        spawnedWorkflowId: null,
        at: Date.now(),
      },
    }));

    try {
      await patchMissionRecordInStore(taskId, set, get);
    } catch (error) {
      console.warn(
        `[Tasks] Failed to patch mission ${taskId} after decision submit:`,
        error
      );
      await get().refresh({
        preferredTaskId: response.task.id || taskId,
      });
    }

    return response.task.id;
  },

  clearDecisionLaunch: () => {
    set({ lastDecisionLaunch: null });
  },
}));
