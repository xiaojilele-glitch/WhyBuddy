/**
 * Blueprint 实时状态 Store。
 *
 * 接收 Socket.IO 推送的 blueprint 事件，维护实时状态供 UI 组件消费。
 * 对应 `.kiro/specs/autopilot-realtime-observation-bridge` Task 2。
 *
 * 核心职责：
 * - 管理 Socket.IO 连接的 subscribe/unsubscribe 生命周期
 * - 将收到的事件分发到对应状态切片（rolePhases / capabilityStatuses / logEntries）
 * - 维护有界队列（agentProgress ≤ 50，logEntries ≤ 200）
 * - 提供细粒度 selector 供 UI 组件订阅
 */

import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type { BlueprintGenerationEventType } from "@shared/blueprint/events";
// `autopilot-agent-reasoning-stream` spec Task 8.1：
// 引入 Layer 4 view model 与转译函数。`buildEntryFromSocketEvent` 接受
// `BlueprintGenerationEvent`，store 内调用时把 relay 转发的精简事件 cast 到该类型即可，
// 函数内部通过 `unknown` 索引读取字段，对缺省字段会自动 fallback。
import {
  buildEntryFromSocketEvent,
  type AgentReasoningEntry,
  type AgentReasoningPhase,
} from "@shared/blueprint/agent-reasoning";
import type { BlueprintGenerationEvent } from "@shared/blueprint/contracts";

// 重新导出 view model 类型，便于下游组件 / 测试在不直接依赖 `@shared` 路径的
// 场景下消费同一份 contract（Task 8.1 要求保留该 import）。
export type { AgentReasoningEntry, AgentReasoningPhase };

// `autopilot-history-replay` integration（2026-05-24）：
// 页面刷新或阶段切换后，前端 store 默认空。Socket 房间不会重放历史事件，
// 因此需要从 REST `/api/blueprint/jobs/:id/events` 拉取已落盘的 `role.agent.*`
// 事件并 seed 到 agentReasoning slice。fetch 函数延迟 import，避免循环依赖
// 与 SSR 路径在没有 fetch polyfill 时报错。
type HydrateHistoricalEventsFn = (jobId: string) => Promise<
  BlueprintGenerationEvent[] | null
>;
let hydrateHistoricalEvents: HydrateHistoricalEventsFn = async (jobId) => {
  if (typeof window === "undefined" || typeof fetch === "undefined") {
    return null;
  }
  try {
    const mod = await import("./blueprint-api");
    const result = await mod.fetchBlueprintJobEvents(jobId);
    if (!result.ok) return null;
    return result.data.events;
  } catch {
    return null;
  }
};

/**
 * 仅供测试注入的 hydration 入口；测试可替换为返回 mock 历史事件的 fn，避免
 * 在 vitest 环境中触发真实 fetch。
 */
export function __setHydrateHistoricalEventsForTest(
  fn: HydrateHistoricalEventsFn | null
): void {
  hydrateHistoricalEvents = fn ?? (async () => null);
}

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/**
 * 角色阶段枚举。
 */
export type RolePhase =
  | "idle"
  | "activated"
  | "thinking"
  | "acting"
  | "observing"
  | "reviewing"
  | "sleeping"
  | "completed"
  | "failed";

export type RoleRuntimeLifecycleStatus =
  | "provisioning"
  | "ready"
  | "teardown"
  | "failed";

export type RoleRuntimeKind = "real" | "fallback" | "stub" | "missing";

export type RoleRuntimeExecutionMode = "real" | "simulated_fallback";

export type RoleRuntimeContainerMode = "real" | "lite";

export interface RoleRuntimeBindingSummary {
  mcpCount: number;
  skillCount: number;
  aigcNodeCount: number;
  skippedMcps: number;
  skippedSkills: number;
}

export interface RoleRuntimeState {
  roleId: string;
  jobId?: string;
  stageId?: string;
  status: RoleRuntimeLifecycleStatus;
  runtimeKind: RoleRuntimeKind;
  containerMode?: RoleRuntimeContainerMode;
  executionMode?: RoleRuntimeExecutionMode;
  fallbackReason?: string;
  error?: string;
  bindingSummary?: RoleRuntimeBindingSummary;
  cached?: boolean;
  lastUpdated: number;
}

/**
 * Agent 进度条目。
 */
export interface AgentProgressEntry {
  id: string;
  roleId: string;
  type: "thinking" | "acting" | "observing" | "completed" | "failed";
  message?: string;
  timestamp: number;
}

/**
 * 能力调用状态。
 */
export type CapabilityStatus = "idle" | "invoking" | "completed" | "failed";

/**
 * 能力调用的真实 owner 记录（whybuddy-3d-real-role-driven-scene-2026-05-29
 * Requirement 12 修订）。
 *
 * 后端 `capability.*` 事件 payload 自带权威 `roleId`（见
 * `server/routes/blueprint.ts` CapabilityInvoked 事件）。store 把它单独存进
 * `capabilityOwners[capabilityId]`，让 3D 场景的 capability→role 绑定第一优先级
 * 使用真实 owner，而不是靠 capability id 猜测（heuristic 仅作兜底）。
 */
// Latest-by-capability owner snapshot. This is intentionally not a full
// invocation history; the right-rail audit surfaces retain detailed records.
export interface CapabilityOwner {
  /** 调用该能力的真实角色 id（来自事件 payload）。 */
  roleId: string;
  /** 调用记录 id（如有），用于右侧审计对账。 */
  invocationId?: string;
  /** 最近一次更新时间戳（ms）。 */
  updatedAt: number;
}

/**
 * 流式日志条目。
 */
export interface BlueprintLogEntry {
  id: string;
  timestamp: number;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fleet 角色卡片实时状态。
 */
export interface FleetRoleRealtimeCard {
  roleId: string;
  roleName: string;
  phase: RolePhase;
  currentAction?: string;
  capabilities: string[];
  lastUpdated: number;
}

/**
 * Socket.IO 中继推送的事件 payload 结构。
 */
export interface BlueprintRelayedEvent {
  type: BlueprintGenerationEventType;
  jobId: string;
  timestamp: string | number;
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Spec Docs Progress Types (spec-docs-generation-progress-feedback Task 4.1)
// ---------------------------------------------------------------------------

/**
 * Per-node generation status within a batch spec document generation.
 * "assembled" indicates Phase 2 commit (documents pushed to array) — distinct from
 * Phase 1 "completed" (LLM generation done).
 */
export type SpecDocsNodeStatus = "pending" | "processing" | "completed" | "failed" | "assembled";

/**
 * Individual node entry in the spec docs progress slice.
 */
export interface SpecDocsNodeEntry {
  nodeId: string;
  title: string;
  position: number;
  status: SpecDocsNodeStatus;
  errorSummary?: string;
  /**
   * whybuddy-spec-tree-progress-merge-2026-05-29 §3（决策 Q1=A2 白盒）：
   * 节点曾经历过 `failed → processing` 重试。一旦置 true 永久保留，
   * 即使后续 `node_completed` 也不清除——让 SPEC 树节点行能渲染
   * "绿 ✓ + 橙 ⚠ 角标"，向用户透明展示"这个节点重试过"。
   */
  wasRetried?: boolean;
}

/**
 * Summary of a completed batch generation.
 */
export interface SpecDocsBatchSummary {
  completedCount: number;
  failedCount: number;
  elapsedMs: number;
}

/**
 * State shape for the spec docs progress slice.
 */
export interface SpecDocsProgressState {
  batchStatus: "idle" | "running" | "assembling" | "finished";
  totalCount: number;
  completedCount: number;
  assembledCount: number;
  processedCount: number;
  nodeOrder: string[];
  nodes: Record<string, SpecDocsNodeEntry>;
  summary: SpecDocsBatchSummary | null;
  dismissed: boolean;
}

/**
 * Initial state for the spec docs progress slice.
 */
export const INITIAL_SPEC_DOCS_PROGRESS: SpecDocsProgressState = {
  batchStatus: "idle",
  totalCount: 0,
  completedCount: 0,
  assembledCount: 0,
  processedCount: 0,
  nodeOrder: [],
  nodes: {},
  summary: null,
  dismissed: false,
};

// ---------------------------------------------------------------------------
// Spec Docs Progress State Machine
// ---------------------------------------------------------------------------

/**
 * Valid state transitions for node status.
 * Terminal states (assembled, failed) accept no further transitions.
 * "completed" can transition to "assembled" (Phase 2 commit).
 */
const VALID_TRANSITIONS: Record<SpecDocsNodeStatus, SpecDocsNodeStatus[]> = {
  pending: ["processing"],
  processing: ["completed", "failed"],
  completed: ["assembled"],
  assembled: [],
  // whybuddy-spec-tree-progress-merge-2026-05-29 §3（Q1=A2）：放宽 failed 终态，
  // 允许后端把失败节点重排重试（failed → processing）。原为 `[]`（终态）。
  failed: ["processing"],
};

/**
 * Check if a transition from one status to another is valid.
 */
function isValidTransition(from: SpecDocsNodeStatus, to: SpecDocsNodeStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// 有界队列常量
// ---------------------------------------------------------------------------

/** logEntries 最大条目数 */
const MAX_LOG_ENTRIES = 200;

/** agentProgress 最大条目数 */
const MAX_AGENT_PROGRESS = 50;

/**
 * `autopilot-agent-reasoning-stream` spec Task 8.3：
 * agentReasoning.entries 的 FIFO 截断阈值。超过该阈值时按到达顺序丢弃最旧条目，
 * 与既有 `logEntries` 的 200-cap、`agentProgress` 的 50-cap 完全独立。
 */
const MAX_AGENT_REASONING_ENTRIES = 500;

// ---------------------------------------------------------------------------
// agentReasoning slice 类型
// ---------------------------------------------------------------------------

/**
 * `autopilot-agent-reasoning-stream` spec Task 8.2：agentReasoning slice 形状。
 *
 * 派生规则（详见 `design.md` §「BlueprintRealtimeStore 新 slice」）：
 * - `iteration_started` → `status="streaming"` 且 `currentIteration=event.iteration`
 * - `completed` → `status="completed"`
 * - `error + reason==="用户取消"` → `status="aborted"`
 * - `error` 其他 reason → `status="failed"`
 */
export interface AgentReasoningSliceState {
  jobId: string | null;
  entries: AgentReasoningEntry[];
  currentIteration: number;
  status: "idle" | "streaming" | "completed" | "failed" | "aborted";
}

/**
 * agentReasoning slice 的初始空态。`subscribe(newJobId)` 时会重置回该状态
 * （spec Task 8.6），保证 Mystery Policy 在每次新 job 开始时成立。
 */
const INITIAL_AGENT_REASONING: AgentReasoningSliceState = {
  jobId: null,
  entries: [],
  currentIteration: 0,
  status: "idle",
};

// ---------------------------------------------------------------------------
// Store 状态与动作接口
// ---------------------------------------------------------------------------

/**
 * BlueprintRealtimeStore 状态。
 */
export interface BlueprintRealtimeState {
  /** 当前订阅的 jobId */
  subscribedJobId: string | null;

  /** 角色阶段映射：roleId → phase */
  rolePhases: Record<string, RolePhase>;

  /** Role container runtime evidence keyed by roleId. */
  roleRuntimeStates: Record<string, RoleRuntimeState>;

  /** Agent 进度事件队列（最近 50 条） */
  agentProgress: AgentProgressEntry[];

  /** 能力调用状态：capabilityId → status */
  capabilityStatuses: Record<string, CapabilityStatus>;

  /**
   * 能力调用真实 owner：capabilityId → { roleId, invocationId, updatedAt }。
   * 仅由携带 `roleId` 的 `capability.*` 事件与 role-container loader 路径写入，
   * 供 3D 场景 capability→role 绑定使用真实 owner（Requirement 12）。
   */
  capabilityOwners: Record<string, CapabilityOwner>;

  /** 流式日志条目（最近 200 条） */
  logEntries: BlueprintLogEntry[];

  /** Fleet 角色卡片实时状态 */
  fleetRoleCards: FleetRoleRealtimeCard[];

  /** 连接状态 */
  connectionState: "disconnected" | "connecting" | "connected";

  /**
   * `autopilot-agent-reasoning-stream` spec Task 8.2：Agent 推理流切片。
   *
   * 与既有 `logEntries` / `agentProgress` / `rolePhases` / `capabilityStatuses`
   * 完全独立的新 slice，仅由 `role.agent.*` 事件驱动。`role.agent.*` 同时也会
   * fallthrough 到既有 `logEntries` 200-cap 队列，保证 `BlueprintLogStream`
   * 继续工作（spec Task 8.3 / 8.7）。
   *
   * 字段约定：
   * - `jobId`：当前订阅 job 的副本，便于 selector 直接判断当前 job 是否已订阅。
   * - `entries`：FIFO 队列，cap 为 500（spec Task 8.3）。
   * - `currentIteration`：仅由 `role.agent.iteration_started` 推进（spec Task 8.4）。
   * - `status`：仅由 `iteration_started` / `completed` / `error + reason` 派生
   *   （spec Task 8.5）。
   */
  agentReasoning: AgentReasoningSliceState;

  /**
   * `spec-docs-generation-progress-feedback` spec Task 4.1：
   * Spec docs batch generation progress slice.
   *
   * Tracks per-node progress during batch "全部生成" operations.
   * Driven by `spec_docs` stage events with `progressAction` field.
   * Independent of other slices (rolePhases, agentReasoning, etc.).
   */
  specDocsProgress: SpecDocsProgressState;
}

/**
 * BlueprintRealtimeStore 动作。
 */
export interface BlueprintRealtimeActions {
  /** 订阅指定 jobId 的事件流 */
  subscribe(jobId: string): void;
  /** 退订当前 jobId */
  unsubscribe(): void;
  /** 处理收到的事件（内部） */
  dispatchEvent(event: BlueprintRelayedEvent): void;
  /** 重置状态 */
  reset(): void;
  /** Dismiss the spec docs progress panel (Req 3.7) */
  dismissSpecDocsProgress(): void;
  /**
   * Force-complete the spec docs progress panel as a fallback when
   * Socket.IO events were dropped or coalesced. Called from the HTTP
   * response handler after spec docs generation succeeds.
   */
  completeSpecDocsProgress(elapsedMs: number): void;
}

// ---------------------------------------------------------------------------
// 事件映射辅助函数
// ---------------------------------------------------------------------------

/**
 * 将事件类型映射到 RolePhase。
 */
export function mapEventTypeToPhase(type: string): RolePhase | null {
  switch (type) {
    case "role.activated":
      return "activated";
    case "role.watching":
      return "thinking";
    case "role.capability_invoked":
      return "acting";
    case "role.review_started":
      return "reviewing";
    case "role.review_completed":
      return "observing";
    case "role.sleeping":
      return "sleeping";
    case "role.completed":
      return "completed";
    case "role.container.provisioning":
      return "activated";
    case "role.container.ready":
      return "activated";
    case "role.container.teardown":
      return "sleeping";
    case "role.container.failed":
      return "failed";
    // whybuddy-3d-real-role-driven-scene-2026-05-29 Requirement 10 (Fix 1)：
    // 把 7 个 `role.agent.*` 推理事件映射到 RolePhase，使角色推理循环
    // （iteration → thinking → acting → observing）能流入 `rolePhases`，
    // 由既有 `if (type.startsWith("role."))` 分支写入 `rolePhases[roleId]`。
    // 注意：`iteration_completed` 故意映射到 `observing` 而非 `completed`——
    // 多迭代角色否则会在两次迭代之间闪烁到 faded 的 `completed` tier 再弹回；
    // `completed` tier 保留给终态 `role.agent.completed`。
    case "role.agent.iteration_started":
      return "activated";
    case "role.agent.thinking":
      return "thinking";
    case "role.agent.acting":
      return "acting";
    case "role.agent.observing":
      return "observing";
    case "role.agent.iteration_completed":
      return "observing";
    case "role.agent.completed":
      return "completed";
    case "role.agent.error":
      return "failed";
    default:
      return null;
  }
}

/**
 * 将 capability 事件类型映射到 CapabilityStatus。
 */
function mapCapabilityEventToStatus(type: string): CapabilityStatus {
  switch (type) {
    case "capability.invoked":
      return "invoking";
    case "capability.completed":
      return "completed";
    case "capability.failed":
      return "failed";
    default:
      return "idle";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readPayloadRecord(
  payload: BlueprintRelayedEvent["payload"]
): Record<string, unknown> {
  return isRecord(payload) ? payload : {};
}

function readNestedRecord(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readRoleIdFromPayload(
  payload: BlueprintRelayedEvent["payload"]
): string | undefined {
  const record = readPayloadRecord(payload);
  const direct = readString(record.roleId);
  if (direct) return direct;

  const role = readNestedRecord(record, "role");
  const roleId = role ? readString(role.id) : undefined;
  if (roleId) return roleId;

  const key = readNestedRecord(record, "key");
  return key ? readString(key.roleId) : undefined;
}

/**
 * 公开、可复用的 payload roleId 读取器（spec task 6）。
 *
 * 这是 {@link readRoleIdFromPayload} 的薄包装，供 blueprint runtime 场景
 * 事件观察器（BlueprintRuntimeAgents）在不触碰 store 内部状态的前提下，
 * 从 BlueprintRelayedEvent 的 payload 中读取 roleId。纯函数、无副作用、不访问 store。
 */
export function readRoleIdFromBlueprintPayload(
  payload: Record<string, unknown>
): string | undefined {
  return readRoleIdFromPayload(payload);
}

function readRoleContainerKey(
  payload: BlueprintRelayedEvent["payload"]
): { roleId?: string; jobId?: string; stageId?: string } {
  const record = readPayloadRecord(payload);
  const key = readNestedRecord(record, "key");
  return {
    roleId: readRoleIdFromPayload(payload),
    jobId: key ? readString(key.jobId) : undefined,
    stageId: key ? readString(key.stageId) : undefined,
  };
}

function readBindingSummary(
  payload: BlueprintRelayedEvent["payload"]
): RoleRuntimeBindingSummary | undefined {
  const record = readPayloadRecord(payload);
  const summary = readNestedRecord(record, "bindingSummary");
  if (!summary) return undefined;
  return {
    mcpCount: readNumber(summary.mcpCount) ?? 0,
    skillCount: readNumber(summary.skillCount) ?? 0,
    aigcNodeCount: readNumber(summary.aigcNodeCount) ?? 0,
    skippedMcps: readNumber(summary.skippedMcps) ?? 0,
    skippedSkills: readNumber(summary.skippedSkills) ?? 0,
  };
}

function mapRoleContainerEventToCapabilityStatus(
  type: string
): CapabilityStatus | null {
  switch (type) {
    case "role.container.provisioning":
      return "invoking";
    case "role.container.ready":
    case "role.container.teardown":
      return "completed";
    case "role.container.failed":
      return "failed";
    default:
      return null;
  }
}

function mapRoleContainerEventToRuntimeStatus(
  type: string
): RoleRuntimeLifecycleStatus | null {
  switch (type) {
    case "role.container.provisioning":
      return "provisioning";
    case "role.container.ready":
      return "ready";
    case "role.container.teardown":
      return "teardown";
    case "role.container.failed":
      return "failed";
    default:
      return null;
  }
}

function normalizeExecutionMode(
  value: unknown
): RoleRuntimeExecutionMode | undefined {
  return value === "real" || value === "simulated_fallback"
    ? value
    : undefined;
}

function normalizeContainerMode(
  value: unknown
): RoleRuntimeContainerMode | undefined {
  return value === "real" || value === "lite" ? value : undefined;
}

function resolveRuntimeKind(
  type: string,
  executionMode: RoleRuntimeExecutionMode | undefined
): RoleRuntimeKind {
  if (type === "role.container.failed") return "stub";
  if (executionMode === "real") return "real";
  if (executionMode === "simulated_fallback") return "fallback";
  return "missing";
}

function buildRoleRuntimeState(
  event: BlueprintRelayedEvent,
  roleId: string,
  lastUpdated: number
): RoleRuntimeState | null {
  const status = mapRoleContainerEventToRuntimeStatus(event.type);
  if (!status) return null;

  const payload = readPayloadRecord(event.payload);
  const key = readRoleContainerKey(event.payload);
  const executionMode = normalizeExecutionMode(payload.executionMode);
  const containerMode = normalizeContainerMode(payload.containerMode);
  const fallbackReason = readString(payload.fallbackReason);
  const error = readString(payload.error);
  const bindingSummary = readBindingSummary(event.payload);
  const cached = readBoolean(payload.cached);

  return {
    roleId,
    ...(key.jobId ? { jobId: key.jobId } : {}),
    ...(key.stageId ? { stageId: key.stageId } : {}),
    status,
    runtimeKind: resolveRuntimeKind(event.type, executionMode),
    ...(containerMode ? { containerMode } : {}),
    ...(executionMode ? { executionMode } : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(error ? { error } : {}),
    ...(bindingSummary ? { bindingSummary } : {}),
    ...(cached !== undefined ? { cached } : {}),
    lastUpdated,
  };
}

/**
 * 从事件构建日志条目。
 */
function buildLogEntry(event: BlueprintRelayedEvent): BlueprintLogEntry {
  const ts =
    typeof event.timestamp === "number"
      ? event.timestamp
      : new Date(event.timestamp).getTime();

  let level: BlueprintLogEntry["level"] = "info";
  if (event.type.endsWith(".failed")) level = "error";
  else if (event.type.includes("review")) level = "debug";

  const [source] = event.type.split(".", 1);

  return {
    id: `${event.jobId}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: ts,
    level,
    source,
    message: event.type,
    metadata: event.payload as Record<string, unknown> | undefined,
  };
}

function buildRelayedEventFromHistoricalEvent(
  event: BlueprintGenerationEvent
): BlueprintRelayedEvent {
  return {
    type: event.type as BlueprintGenerationEventType,
    jobId: event.jobId,
    timestamp: event.occurredAt,
    payload: (event.payload ?? {}) as Record<string, unknown>,
  };
}

/**
 * `autopilot-agent-reasoning-stream` spec Task 8.3 辅助函数。
 *
 * 把 socket-relay 转发的精简事件 `BlueprintRelayedEvent` 适配成
 * `buildEntryFromSocketEvent` 可以消费的 `BlueprintGenerationEvent` 形态。
 *
 * 关键事实：
 * - `socket-relay.ts` 当前只把 `event.type / jobId / occurredAt / payload`
 *   四个字段透传到前端，agent 推理流的扩展字段（iteration / thought / actionToolId
 *   / observationSuccess / observationSummary / error / degraded / reason /
 *   tokensUsed / budgetRemaining）目前由后端 `agent-reasoning-bridge` 写在
 *   `BlueprintGenerationEvent` 顶层而不是 `payload` 里；relay 后续若把这些字段
 *   一并下发，本函数会优先读取顶层、再回退到 `payload` 子字段，向前兼容。
 * - `buildEntryFromSocketEvent` 内部已通过 `unknown` 索引读取扩展字段并对缺省值
 *   做 fallback，因此即使本适配返回的 event 不含部分字段也不会抛错。
 *
 * 该适配只服务于 agentReasoning slice 写入，不影响既有 logEntries / agentProgress
 * 等其它 slice 的字段 shape。
 */
/**
 * Flatten a persisted `BlueprintGenerationEvent`'s payload fields onto the
 * top-level event shape so that `buildEntryFromSocketEvent` (which reads
 * top-level only via the `ExtendedAgentEvent` intersection) can hydrate the
 * AgentReasoningEntry correctly. Used during REST history replay where events
 * come back in their persisted shape (iteration / thought / stageId in payload,
 * per `server/routes/blueprint/stage-progress-emitter.ts`).
 */
function flattenHistoricalAgentEvent(
  event: BlueprintGenerationEvent
): BlueprintGenerationEvent {
  const payloadRecord = (event.payload ?? {}) as Record<string, unknown>;
  return {
    ...event,
    iteration: pickFiniteNumber(payloadRecord.iteration) ?? event.iteration,
    stageId: pickStringField(payloadRecord.stageId) ?? event.stageId,
    roleId: pickStringField(payloadRecord.roleId) ?? event.roleId,
    thought: pickStringField(payloadRecord.thought) ?? event.thought,
    actionToolId:
      pickStringField(payloadRecord.actionToolId) ?? event.actionToolId,
    observationSuccess:
      typeof payloadRecord.observationSuccess === "boolean"
        ? payloadRecord.observationSuccess
        : event.observationSuccess,
    observationSummary:
      pickStringField(payloadRecord.observationSummary) ??
      event.observationSummary,
    error: pickStringField(payloadRecord.error) ?? event.error,
    degraded:
      typeof payloadRecord.degraded === "boolean"
        ? payloadRecord.degraded
        : event.degraded,
    reason: pickStringField(payloadRecord.reason) ?? event.reason,
    tokensUsed:
      pickFiniteNumber(payloadRecord.tokensUsed) ?? event.tokensUsed,
    budgetRemaining:
      pickFiniteNumber(payloadRecord.budgetRemaining) ?? event.budgetRemaining,
  };
}

function buildAgentReasoningEvent(
  event: BlueprintRelayedEvent
): BlueprintGenerationEvent {
  const occurredAt =
    typeof event.timestamp === "number"
      ? new Date(event.timestamp).toISOString()
      : event.timestamp;
  const payloadRecord = (event.payload ?? {}) as Record<string, unknown>;

  // 优先级：relay 顶层字段（未来）→ payload 子字段。空缺字段保持 undefined，
  // 由 buildEntryFromSocketEvent 的 fallback 决定最终落值。
  return {
    // BlueprintGenerationEvent 必填字段，使用稳定占位值满足类型契约；
    // 这些字段不会被 buildEntryFromSocketEvent 消费，只用于通过 TS 类型校验。
    id: "",
    family: "role",
    stage: "route_generation",
    status: "running",
    message: event.type,
    type: event.type as BlueprintGenerationEvent["type"],
    jobId: event.jobId,
    occurredAt,
    iteration: pickFiniteNumber(payloadRecord.iteration),
    stageId: pickStringField(payloadRecord.stageId),
    roleId: pickStringField(payloadRecord.roleId),
    thought: pickStringField(payloadRecord.thought),
    actionToolId: pickStringField(payloadRecord.actionToolId),
    observationSuccess:
      typeof payloadRecord.observationSuccess === "boolean"
        ? payloadRecord.observationSuccess
        : undefined,
    observationSummary: pickStringField(payloadRecord.observationSummary),
    error: pickStringField(payloadRecord.error),
    degraded:
      typeof payloadRecord.degraded === "boolean"
        ? payloadRecord.degraded
        : undefined,
    reason: pickStringField(payloadRecord.reason),
    tokensUsed: pickFiniteNumber(payloadRecord.tokensUsed),
    budgetRemaining: pickFiniteNumber(payloadRecord.budgetRemaining),
    payload: payloadRecord,
  };
}

/**
 * `autopilot-agent-reasoning-stream` spec Task 8.5 辅助函数。
 *
 * 从 relay 转发的事件 payload 中安全读取字符串字段（顶层 relay 字段未来落地后
 * 也会优先采用相同语义）。`role.agent.error` 的 status 派生需要读取 `reason`，
 * 当 reason==="用户取消" 时落到 "aborted"，否则落到 "failed"。
 */
function readEventField(
  payload: BlueprintRelayedEvent["payload"],
  field: "reason"
): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 从 unknown 中读取非空字符串，否则返回 undefined。 */
function pickStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 从 unknown 中读取有限 number，否则返回 undefined。 */
function pickFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Socket 实例管理
// ---------------------------------------------------------------------------

let socket: Socket | null = null;

/**
 * 获取或创建 Socket.IO 连接实例（可注入，便于测试）。
 */
export function getOrCreateSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
    });

    // autopilot-streaming-experience 调试日志（2026-05-16）：在浏览器 console
    // 暴露 socket 生命周期与 blueprint:event 推送的最少证据，便于验证流式时
    // 间线为何在 UI 上看不到。该日志只在浏览器环境执行，不影响 SSR 测试，
    // 也不引入新依赖；正式环境如需关闭，可在浏览器 console 执行
    // `localStorage.setItem("autopilot-debug-socket", "off")`。
    if (typeof window !== "undefined") {
      const debugEnabled =
        window.localStorage?.getItem("autopilot-debug-socket") !== "off";
      if (debugEnabled) {
        socket.on("connect", () => {
          // eslint-disable-next-line no-console
          console.log(
            "[autopilot-debug] socket connected sid=" + (socket?.id ?? "?")
          );
        });
        socket.on("disconnect", (reason) => {
          // eslint-disable-next-line no-console
          console.log("[autopilot-debug] socket disconnected:", reason);
        });
        socket.on("blueprint:event", (data) => {
          // eslint-disable-next-line no-console
          console.log("[autopilot-debug] blueprint:event ←", data);
        });
        socket.on("blueprint:batch", (batch) => {
          // eslint-disable-next-line no-console
          console.log(
            "[autopilot-debug] blueprint:batch ← (" +
              (Array.isArray(batch) ? batch.length : "?") +
              " events)"
          );
        });
      }
    }
  }
  return socket;
}

/**
 * 注入自定义 socket 实例（用于测试）。
 */
export function __setSocket(s: Socket | null): void {
  socket = s;
}

// ---------------------------------------------------------------------------
// Spec Docs Progress Event Handler (Task 4.1)
// ---------------------------------------------------------------------------

/**
 * Handles spec_docs progress events dispatched through the realtime store.
 * Detects events by checking `payload.stageId === "spec_docs"` and
 * `payload.progressAction` being present.
 *
 * Returns partial state updates or null if the event is not a spec_docs progress event.
 */
function handleSpecDocsProgressEvent(
  event: BlueprintRelayedEvent,
  state: BlueprintRealtimeState
): Partial<BlueprintRealtimeState> | null {
  const payload = event.payload as Record<string, unknown> | undefined;
  if (
    event.type === "job.completed" &&
    (typeof payload?.documentCount === "number" || typeof payload?.specTreeId === "string") &&
    (state.specDocsProgress.batchStatus === "running" || state.specDocsProgress.batchStatus === "assembling")
  ) {
    const currentState = state.specDocsProgress;
    const nodeCount = Number(payload.nodeCount) || currentState.totalCount;
    const completedCount = currentState.totalCount || nodeCount;
    return {
      specDocsProgress: {
        ...currentState,
        batchStatus: "finished",
        completedCount,
        assembledCount: completedCount,
        processedCount: completedCount,
        summary: {
          completedCount,
          failedCount: 0,
          elapsedMs: 0,
        },
      },
    };
  }

  if (!payload || payload.stageId !== "spec_docs" || !payload.progressAction) {
    return null;
  }

  const action = payload.progressAction as string;

  switch (action) {
    case "batch_init": {
      const totalCount = Math.min(Number(payload.totalCount) || 0, 200);
      const rawNodeIds = Array.isArray(payload.nodeIds)
        ? (payload.nodeIds as string[])
        : [];
      // Cap tracked nodes to 200 to match totalCount cap (design: "only track first 200 node IDs")
      const nodeIds = rawNodeIds.slice(0, 200);
      const nodes: Record<string, SpecDocsNodeEntry> = {};
      for (const id of nodeIds) {
        nodes[id] = { nodeId: id, title: "", position: 0, status: "pending" };
      }
      return {
        specDocsProgress: {
          batchStatus: "running",
          totalCount,
          completedCount: 0,
          assembledCount: 0,
          processedCount: 0,
          nodeOrder: nodeIds,
          nodes,
          summary: null,
          dismissed: false,
        },
      };
    }

    case "node_started": {
      const nodeId = payload.nodeId as string | undefined;
      if (!nodeId) return null;
      const currentState = state.specDocsProgress;
      const node = currentState.nodes[nodeId];
      if (!node) return null; // Unknown node (Req 2.8)
      if (!isValidTransition(node.status, "processing")) return null; // (Req 2.7)
      // whybuddy-spec-tree-progress-merge-2026-05-29 §3（Q1=A2 白盒）：
      // 若本次 node_started 是从 failed 态重新进入 processing（后端重排重试），
      // 永久标记 wasRetried，使最终态可渲染 "✓ + ⚠" 角标。
      const wasRetried = node.status === "failed" ? true : node.wasRetried;
      return {
        specDocsProgress: {
          ...currentState,
          nodes: {
            ...currentState.nodes,
            [nodeId]: {
              ...node,
              status: "processing",
              title: String(payload.nodeTitle ?? "").slice(0, 200),
              position: Number(payload.position) || 0,
              ...(wasRetried ? { wasRetried: true } : {}),
            },
          },
        },
      };
    }

    case "node_completed": {
      const nodeId = payload.nodeId as string | undefined;
      if (!nodeId) return null;
      const currentState = state.specDocsProgress;
      const node = currentState.nodes[nodeId];
      if (!node) return null; // Unknown node (Req 2.8)
      // Tolerate missed node_started: if the node is still pending, treat
      // node_completed as the combined transition pending→processing→completed.
      // This prevents the panel from getting stuck when intermediate Socket.IO
      // events are coalesced or dropped due to TCP buffering near HTTP response.
      if (node.status !== "pending" && !isValidTransition(node.status, "completed")) {
        return null; // Invalid transition (e.g., from completed/failed)
      }
      return {
        specDocsProgress: {
          ...currentState,
          completedCount: Number(payload.completedCount) || currentState.completedCount + 1,
          processedCount: currentState.processedCount + 1,
          nodes: {
            ...currentState.nodes,
            [nodeId]: { ...node, status: "completed" },
          },
        },
      };
    }

    case "node_failed": {
      const nodeId = payload.nodeId as string | undefined;
      if (!nodeId) return null;
      const currentState = state.specDocsProgress;
      const node = currentState.nodes[nodeId];
      if (!node) return null; // Unknown node (Req 2.8)
      // Tolerate missed node_started: same rationale as node_completed above.
      if (node.status !== "pending" && !isValidTransition(node.status, "failed")) {
        return null; // Invalid transition (e.g., from completed/failed)
      }
      return {
        specDocsProgress: {
          ...currentState,
          processedCount: currentState.processedCount + 1,
          nodes: {
            ...currentState.nodes,
            [nodeId]: {
              ...node,
              status: "failed",
              errorSummary: String(payload.errorSummary ?? "").slice(0, 500),
            },
          },
        },
      };
    }

    case "node_assembled": {
      const nodeId = payload.nodeId as string | undefined;
      if (!nodeId) return null;
      const currentState = state.specDocsProgress;
      const node = currentState.nodes[nodeId];
      if (!node) return null; // Unknown node
      // node_assembled arrives after node_completed; tolerate missed intermediate events
      // by accepting from "completed" (normal) or "processing"/"pending" (missed events).
      if (node.status === "assembled" || node.status === "failed") return null;
      const newAssembledCount = Number(payload.assembledCount) || currentState.assembledCount + 1;
      // Transition batchStatus to "assembling" on first node_assembled event
      const newBatchStatus: SpecDocsProgressState["batchStatus"] =
        currentState.batchStatus === "running" || currentState.batchStatus === "assembling"
          ? "assembling"
          : currentState.batchStatus;
      return {
        specDocsProgress: {
          ...currentState,
          batchStatus: newBatchStatus,
          assembledCount: newAssembledCount,
          nodes: {
            ...currentState.nodes,
            [nodeId]: { ...node, status: "assembled" },
          },
        },
      };
    }

    case "batch_finished": {
      const currentState = state.specDocsProgress;
      const finalCompletedCount = Number(payload.completedCount) || 0;
      const finalFailedCount = Number(payload.failedCount) || 0;
      const finalProcessedCount = finalCompletedCount + finalFailedCount;

      // Force-update counters from the authoritative batch_finished summary.
      // This ensures the panel shows correct final state even if some
      // intermediate node_started/node_completed events were missed or
      // arrived out of order due to Socket.IO delivery timing.
      //
      // Resolve unresolved nodes based on failedCount:
      // - If failedCount === 0: all nodes succeeded — safe to mark unresolved as assembled
      //   (missed socket event).
      // - If failedCount > 0: some nodes failed — don't blindly mark as assembled.
      //   The server should have sent explicit node_failed events (Task 11 fix).
      //   If we still have unresolved nodes, mark them as failed with a defensive summary.
      const resolvedNodes: Record<string, SpecDocsNodeEntry> = {};
      for (const [id, node] of Object.entries(currentState.nodes)) {
        if (node.status === "pending" || node.status === "processing" || node.status === "completed") {
          if (finalFailedCount === 0) {
            // All nodes succeeded — safe to mark unresolved as assembled (missed socket event)
            resolvedNodes[id] = { ...node, status: "assembled" };
          } else {
            // Some nodes failed — don't blindly mark as assembled.
            // Leave as-is; the server should have sent explicit node_failed events.
            // If we still have unresolved nodes, mark them with a defensive status.
            resolvedNodes[id] = { ...node, status: "failed", errorSummary: "terminal event missed" };
          }
        } else {
          resolvedNodes[id] = node;
        }
      }

      return {
        specDocsProgress: {
          ...currentState,
          batchStatus: "finished",
          completedCount: finalCompletedCount,
          assembledCount: finalCompletedCount,
          processedCount: finalProcessedCount,
          nodes: resolvedNodes,
          summary: {
            completedCount: finalCompletedCount,
            failedCount: finalFailedCount,
            elapsedMs: Number(payload.elapsedMs) || 0,
          },
        },
      };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Blueprint 实时事件观察者（module-level，非 store state）
// ---------------------------------------------------------------------------

/**
 * `whybuddy-3d-real-role-driven-scene-2026-05-29` spec Task 5：
 * Blueprint 实时事件监听器签名。监听器在 `dispatchEvent(event)` 的 reducer
 * 完成后被同步通知一次，接收到的就是这次被分发的 `BlueprintRelayedEvent`。
 */
export type BlueprintRealtimeEventListener = (
  event: BlueprintRelayedEvent
) => void;

/**
 * 模块级监听器集合。刻意保持在 module scope 而非 `BlueprintRealtimeState`，
 * 以满足 Requirements 2.15 / 5.2 / 6.6：本特性不向 store 顶层 state 增加字段。
 */
const blueprintRealtimeEventListeners = new Set<BlueprintRealtimeEventListener>();

/**
 * 订阅 blueprint 实时事件。每次 `dispatchEvent` 在 reducer 状态更新之后会把
 * 该事件同步派发给所有当前注册的监听器（详见 design.md
 * §「Event Observation and Line Priority」→「Event Observer」）。
 *
 * @returns 取消订阅函数；调用后该监听器不再收到后续事件。
 */
export function subscribeBlueprintRealtimeEvents(
  listener: BlueprintRealtimeEventListener
): () => void {
  blueprintRealtimeEventListeners.add(listener);
  return () => {
    blueprintRealtimeEventListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Store 创建
// ---------------------------------------------------------------------------

const initialState: BlueprintRealtimeState = {
  subscribedJobId: null,
  rolePhases: {},
  roleRuntimeStates: {},
  agentProgress: [],
  capabilityStatuses: {},
  capabilityOwners: {},
  logEntries: [],
  fleetRoleCards: [],
  connectionState: "disconnected",
  agentReasoning: INITIAL_AGENT_REASONING,
  specDocsProgress: INITIAL_SPEC_DOCS_PROGRESS,
};

/**
 * Blueprint 实时状态 Zustand Store。
 */
export const useBlueprintRealtimeStore = create<
  BlueprintRealtimeState & BlueprintRealtimeActions
>((set, get) => ({
  ...initialState,

  subscribe(jobId: string) {
    const state = get();

    // 如果已经订阅同一个 jobId，跳过
    if (state.subscribedJobId === jobId) return;

    // 如果已有订阅，先退订
    if (state.subscribedJobId) {
      get().unsubscribe();
    }

    const s = getOrCreateSocket();

    // A subscription is a hard job boundary. These slices are active-job data,
    // so switching from one job/project to another must wipe them instead of
    // preserving historical entries. Connection-level state stays outside this
    // reset because it describes the socket, not the current job.
    set({
      subscribedJobId: jobId,
      connectionState: "connecting",
      rolePhases: {},
      roleRuntimeStates: {},
      agentProgress: [],
      capabilityStatuses: {},
      capabilityOwners: {},
      fleetRoleCards: [],
      logEntries: [],
      agentReasoning: {
        jobId,
        entries: [],
        currentIteration: 0,
        status: "idle",
      },
    });

    // 绑定连接事件
    s.on("connect", handleConnect);
    s.on("disconnect", handleDisconnect);
    s.on("blueprint:event", handleBlueprintEvent);
    s.on("blueprint:batch", handleBlueprintBatch);

    // 如果已经连接，直接发送订阅
    if (s.connected) {
      s.emit("blueprint:subscribe", { jobId });
      set({ connectionState: "connected" });
    }

    // `autopilot-history-replay` integration（2026-05-24）：
    // 页面刷新 / 阶段切换后从 REST 拉取已落盘的 role.agent.* 事件,seed 到
    // agentReasoning.entries,避免"暂无推理记录"占位永远停留。fire-and-forget;
    // 失败时静默回退到只显示实时事件。重入安全：通过 subscribedJobId 比对
    // 防止竞态时旧 hydration 覆盖新 jobId 的状态。
    void hydrateHistoricalEvents(jobId).then((historicalEvents) => {
      if (!historicalEvents || historicalEvents.length === 0) return;
      const currentState = get();
      if (currentState.subscribedJobId !== jobId) return;

      for (const event of historicalEvents) {
        if (get().subscribedJobId !== jobId) return;
        get().dispatchEvent(buildRelayedEventFromHistoricalEvent(event));
      }
    });

    function handleConnect() {
      set({ connectionState: "connected" });
      // 重连后自动恢复订阅
      const currentJobId = get().subscribedJobId;
      if (currentJobId) {
        s.emit("blueprint:subscribe", { jobId: currentJobId });
      }
    }

    function handleDisconnect() {
      set({ connectionState: "disconnected" });
    }

    // ─── Spec Docs Event Pacing Queue ──────────────────────────────────
    // Problem: when spec docs are generated quickly (template path or fast
    // LLM), all per-node progress events can arrive in one Socket.IO batch
    // within a few milliseconds. React then merges them into a single
    // re-render and the user sees the panel jump from 0/N straight to N/N
    // without per-node animation.
    //
    // Solution: intercept node_started / node_completed / node_failed
    // events client-side, queue them, and dispatch one every PACE_MS
    // milliseconds. batch_init and batch_finished are dispatched immediately
    // — they're not the events that need pacing.
    //
    // This is purely a frontend ergonomic layer; the underlying state machine
    // and persistence are unaffected.
    const PACE_MS = 150;
    const pacingQueue: BlueprintRelayedEvent[] = [];
    let pacingTimer: ReturnType<typeof setTimeout> | null = null;

    function isPacedSpecDocsEvent(_event: BlueprintRelayedEvent): boolean {
      // 不再做客户端节奏控制——进度节奏来自真实后端执行（LLM / 沙盒每节点
      // 秒级耗时）。客户端立即 dispatch 所有事件，保留事件原本的时序语义。
      return false;
    }

    function startPacingTimer() {
      if (pacingTimer !== null) return;
      pacingTimer = setTimeout(function flushOne() {
        const next = pacingQueue.shift();
        if (next) {
          get().dispatchEvent(next);
        }
        pacingTimer = pacingQueue.length > 0
          ? setTimeout(flushOne, PACE_MS)
          : null;
      }, PACE_MS);
    }

    function dispatchWithPacing(event: BlueprintRelayedEvent) {
      if (isPacedSpecDocsEvent(event)) {
        pacingQueue.push(event);
        startPacingTimer();
      } else {
        // Non-paced events (batch_init, batch_finished, all other event
        // families) dispatch immediately to preserve their semantics.
        get().dispatchEvent(event);
      }
    }

    function handleBlueprintEvent(event: BlueprintRelayedEvent) {
      // 只处理当前订阅 jobId 的事件
      const currentJobId = get().subscribedJobId;
      if (event.jobId === currentJobId) {
        if (typeof window !== "undefined") {
          const debugEnabled =
            window.localStorage?.getItem("autopilot-debug-socket") !== "off";
          if (debugEnabled && event.type.startsWith("role.agent.")) {
            // eslint-disable-next-line no-console
            console.log(
              "[autopilot-debug] dispatching " + event.type + " (jobId match)"
            );
          }
        }
        dispatchWithPacing(event);
      } else if (typeof window !== "undefined") {
        const debugEnabled =
          window.localStorage?.getItem("autopilot-debug-socket") !== "off";
        if (debugEnabled) {
          // eslint-disable-next-line no-console
          console.warn(
            "[autopilot-debug] DROPPED " +
              event.type +
              ": event.jobId=" +
              event.jobId +
              " ≠ subscribedJobId=" +
              String(currentJobId)
          );
        }
      }
    }

    /** 处理批量推送事件（Task 6.2） */
    function handleBlueprintBatch(events: BlueprintRelayedEvent[]) {
      if (!Array.isArray(events)) return;
      const currentJobId = get().subscribedJobId;
      for (const event of events) {
        if (event.jobId === currentJobId) {
          dispatchWithPacing(event);
        }
      }
    }
  },

  unsubscribe() {
    const state = get();
    const s = getOrCreateSocket();

    if (state.subscribedJobId) {
      s.emit("blueprint:unsubscribe", { jobId: state.subscribedJobId });
    }

    // 移除事件监听
    s.off("connect");
    s.off("disconnect");
    s.off("blueprint:event");
    s.off("blueprint:batch");

    // 重置订阅状态但保留 logEntries 历史
    set({
      subscribedJobId: null,
      rolePhases: {},
      roleRuntimeStates: {},
      agentProgress: [],
      capabilityStatuses: {},
      capabilityOwners: {},
      fleetRoleCards: [],
      logEntries: [],
      connectionState: s.connected ? "connected" : "disconnected",
      // `autopilot-agent-reasoning-stream` spec Task 8.6 / 8.7：
      // agentReasoning 与 rolePhases / agentProgress / capabilityStatuses 同属
      // 「当前 job 活跃态」slice，退订时一并回到初始态，保持与既有 reset 语义一致。
      // logEntries 200-cap 队列继续作为历史记录保留，不受影响。
      agentReasoning: INITIAL_AGENT_REASONING,
    });
  },

  dispatchEvent(event: BlueprintRelayedEvent) {
    const activeJobId = get().subscribedJobId;
    if (activeJobId && event.jobId !== activeJobId) {
      return;
    }

    const { type, payload } = event;

    set((state) => {
      const updates: Partial<BlueprintRealtimeState> = {};
      const eventTime =
        typeof event.timestamp === "number"
          ? event.timestamp
          : new Date(event.timestamp).getTime();
      const lastUpdated = Number.isFinite(eventTime) ? eventTime : Date.now();
      const roleId = readRoleIdFromPayload(payload);

      // `spec-docs-generation-progress-feedback` spec Task 4.1：
      // Handle spec_docs progress events. This runs before other handlers
      // and does NOT short-circuit — the event still falls through to
      // logEntries 200-cap queue below.
      const specDocsUpdate = handleSpecDocsProgressEvent(event, state);
      if (specDocsUpdate) {
        Object.assign(updates, specDocsUpdate);
      }

      // `autopilot-agent-reasoning-stream` spec Task 8.3 / 8.4 / 8.5：
      // role.agent.* 分支与既有 logEntries / rolePhases 等分支并行写入，
      // 不 return / continue 中断后续 200-cap logEntries 处理。
      // - Task 8.3：用 buildEntryFromSocketEvent 构造 entry 并 FIFO 截断到 ≤500
      // - Task 8.4：iteration_started → 更新 currentIteration（其他事件不动）
      // - Task 8.5：iteration_started/completed/error 派生 status
      if (type.startsWith("role.agent.")) {
        const reasoningEntry = buildEntryFromSocketEvent(
          buildAgentReasoningEvent(event)
        );
        if (reasoningEntry !== null) {
          let nextEntries = [
            ...state.agentReasoning.entries,
            reasoningEntry,
          ];
          if (nextEntries.length > MAX_AGENT_REASONING_ENTRIES) {
            nextEntries = nextEntries.slice(-MAX_AGENT_REASONING_ENTRIES);
          }

          // 派生 currentIteration：仅 iteration_started 推进；其他事件保持。
          let nextIteration = state.agentReasoning.currentIteration;
          if (
            type === "role.agent.iteration_started" &&
            typeof reasoningEntry.iteration === "number" &&
            Number.isFinite(reasoningEntry.iteration)
          ) {
            nextIteration = reasoningEntry.iteration;
          }

          // 派生 status：
          // - iteration_started → "streaming"
          // - completed         → "completed"
          // - error 且 reason==="用户取消" → "aborted"
          // - error 其他 reason → "failed"
          // - 其他 role.agent.* 不改 status（保持上一个终态或 streaming）
          let nextStatus = state.agentReasoning.status;
          if (type === "role.agent.iteration_started") {
            nextStatus = "streaming";
          } else if (type === "role.agent.completed") {
            nextStatus = "completed";
          } else if (type === "role.agent.error") {
            // 取脱敏后的 reason 字段；与 bridge withAbortReason / withFailureDegraded
            // 行为对齐：用户取消时 reason="用户取消"，其他情况无 reason 或 reason!=="用户取消"。
            const reason = readEventField(payload, "reason");
            if (reason === "用户取消") {
              nextStatus = "aborted";
            } else {
              nextStatus = "failed";
            }
          }

          updates.agentReasoning = {
            jobId: state.agentReasoning.jobId,
            entries: nextEntries,
            currentIteration: nextIteration,
            status: nextStatus,
          };
        }
        // fallthrough：role.agent.* 仍会继续走下方 logEntries 200-cap 写入，
        // 保证 BlueprintLogStream 仍能展示原始事件类型。
      }

      // Role phase 更新
      if (type.startsWith("role.")) {
        if (roleId) {
          const phase = mapEventTypeToPhase(type);
          if (phase) {
            updates.rolePhases = { ...state.rolePhases, [roleId]: phase };
          }
        }
      }

      // Capability 状态更新
      if (type.startsWith("capability.")) {
        const capId =
          (payload?.capabilityId as string) ?? (payload?.id as string);
        if (capId) {
          const status = mapCapabilityEventToStatus(type);
          updates.capabilityStatuses = {
            ...state.capabilityStatuses,
            [capId]: status,
          };

          // Requirement 12 修订：保留事件里的真实 owner roleId，供 3D 绑定第一
          // 优先级使用（不再靠 capability id 猜测）。仅当 payload 带 roleId 时写入。
          const ownerRoleId = readRoleIdFromPayload(payload);
          if (ownerRoleId) {
            const invocationId =
              (payload?.invocationId as string) ?? undefined;
            updates.capabilityOwners = {
              ...(updates.capabilityOwners ?? state.capabilityOwners),
              [capId]: {
                roleId: ownerRoleId,
                invocationId,
                updatedAt: lastUpdated,
              },
            };
          }
        }
      }

      // Agent progress 更新（job.stage 事件）
      // Role container lifecycle events double as runtime bridge evidence.
      const roleContainerCapabilityStatus =
        mapRoleContainerEventToCapabilityStatus(type);
      if (roleContainerCapabilityStatus && roleId) {
        const capabilityId = `role-container-loader:${roleId}`;
        updates.capabilityStatuses = {
          ...(updates.capabilityStatuses ?? state.capabilityStatuses),
          [capabilityId]: roleContainerCapabilityStatus,
        };
        // The loader capability id already encodes its owner role; record it as
        // an authoritative owner so the 3D binding never has to guess for it.
        updates.capabilityOwners = {
          ...(updates.capabilityOwners ?? state.capabilityOwners),
          [capabilityId]: { roleId, updatedAt: lastUpdated },
        };
        const runtimeState = buildRoleRuntimeState(event, roleId, lastUpdated);
        if (runtimeState) {
          updates.roleRuntimeStates = {
            ...state.roleRuntimeStates,
            [roleId]: runtimeState,
          };
        }
      }

      // Agent progress 鏇存柊锛坖ob.stage 浜嬩欢锛?
      if (type === "job.stage" && payload) {
        const entry: AgentProgressEntry = {
          id: `progress-${lastUpdated}-${Math.random().toString(36).slice(2, 8)}`,
          roleId: (payload.roleId as string) ?? "system",
          type: "acting",
          message: (payload.message as string) ?? type,
          timestamp: lastUpdated,
        };
        let nextProgress = [...state.agentProgress, entry];
        if (nextProgress.length > MAX_AGENT_PROGRESS) {
          nextProgress = nextProgress.slice(-MAX_AGENT_PROGRESS);
        }
        updates.agentProgress = nextProgress;
      }

      // 日志追加（所有事件都产生日志条目）
      const logEntry = buildLogEntry(event);
      let nextLogs = [...state.logEntries, logEntry];
      if (nextLogs.length > MAX_LOG_ENTRIES) {
        nextLogs = nextLogs.slice(-MAX_LOG_ENTRIES);
      }
      updates.logEntries = nextLogs;

      return updates;
    });

    // `whybuddy-3d-real-role-driven-scene-2026-05-29` spec Task 5：
    // reducer 状态更新完成后，同步通知所有模块级监听器一次。每个监听器调用都
    // 包在 try/catch 中——一个 scene-bridge / observer 的 bug 绝不能破坏 reducer
    // 或阻断其它监听器（Requirement 5.1 / 5.2）。
    for (const listener of blueprintRealtimeEventListeners) {
      try {
        listener(event);
      } catch (err) {
        if (import.meta.env?.DEV) {
          // eslint-disable-next-line no-console
          console.error(
            "[blueprint-realtime] event listener threw",
            err
          );
        }
      }
    }
  },

  dismissSpecDocsProgress() {
    set((state) => ({
      specDocsProgress: { ...state.specDocsProgress, dismissed: true },
    }));
  },

  /**
   * Force-complete the spec docs progress panel.
   *
   * Called by the HTTP response handler after `generateBlueprintSpecDocuments`
   * succeeds, as a fallback for cases where Socket.IO delivery dropped or
   * coalesced intermediate `node_started`/`node_completed`/`batch_finished`
   * events. Idempotent: if the panel is already finished or idle, this is a
   * no-op.
   *
   * Forces all pending/processing nodes to "completed" status and sets
   * batchStatus to "finished" with a synthesized summary.
   */
  completeSpecDocsProgress(elapsedMs: number) {
    set((state) => {
      const current = state.specDocsProgress;
      // Only act when there's an active running or assembling batch
      if (current.batchStatus !== "running" && current.batchStatus !== "assembling") return state;

      const resolvedNodes: Record<string, SpecDocsNodeEntry> = {};
      let resolvedCompleted = current.completedCount;
      let resolvedProcessed = current.processedCount;
      for (const [id, node] of Object.entries(current.nodes)) {
        if (node.status === "assembled") {
          // Already received node_assembled via event stream — do NOT re-transition
          resolvedNodes[id] = node;
        } else if (node.status === "pending" || node.status === "processing" || node.status === "completed") {
          resolvedNodes[id] = { ...node, status: "assembled" };
          if (node.status === "pending" || node.status === "processing") {
            resolvedCompleted += 1;
            resolvedProcessed += 1;
          }
        } else {
          resolvedNodes[id] = node;
        }
      }

      // Count assembled nodes for the final assembledCount
      const finalAssembledCount = Object.values(resolvedNodes).filter(
        (n) => n.status === "assembled"
      ).length;

      return {
        ...state,
        specDocsProgress: {
          ...current,
          batchStatus: "finished",
          nodes: resolvedNodes,
          completedCount: resolvedCompleted,
          assembledCount: finalAssembledCount,
          processedCount: resolvedProcessed,
          summary: current.summary ?? {
            completedCount: resolvedCompleted,
            failedCount: current.totalCount - resolvedCompleted,
            elapsedMs,
          },
        },
      };
    });
  },

  reset() {
    const s = socket;
    if (s) {
      const state = get();
      if (state.subscribedJobId) {
        s.emit("blueprint:unsubscribe", { jobId: state.subscribedJobId });
      }
      s.off("connect");
      s.off("disconnect");
      s.off("blueprint:event");
      s.off("blueprint:batch");
    }
    set(initialState);
  },
}));

/**
 * whybuddy-spec-tree-progress-merge-2026-05-29 §8.5：DEV-only e2e 注入口。
 *
 * 本 dev 环境 `AUTOPILOT_REAL_RUNTIME=true` 会把 job 一路自动驾驶冲过
 * spec_docs，且真 LLM 批量生成耗时数分钟、无法稳定复现 `node_failed → 重试
 * → node_completed`（A2 白盒）这条路径。Playwright 验收脚本因此需要一个
 * 浏览器侧的 socket 事件本地回放入口，按 batch_init → node_started →
 * node_failed → node_started → node_completed → batch_finished 顺序直接
 * dispatch，确保 5 态 + retried 渲染都被真浏览器验证到，不依赖真 LLM 时序。
 *
 * 该 accessor 仅在 `import.meta.env.DEV` 下挂到 `window`，生产构建（Vite
 * 静态消除 `if (false)` 分支）不包含此代码，因此不构成生产暴露面。与既有
 * `globalThis.__snapshot*`（browser-runtime.ts / snapshot-lifecycle-bridge.ts）
 * 的 dev accessor 模式一致。
 */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__blueprintRealtimeStore = {
    dispatchEvent: (event: BlueprintRelayedEvent) =>
      useBlueprintRealtimeStore.getState().dispatchEvent(event),
    getSpecDocsProgress: () =>
      useBlueprintRealtimeStore.getState().specDocsProgress,
    getState: () => useBlueprintRealtimeStore.getState(),
    /**
     * DEV-only setter that lets the e2e harness pivot `batchStatus` without
     * going through the reducer (used to reproduce the "leftover processing
     * entry from a prior batch that never fired batch_finished" race that the
     * stale-guard in `deriveNodeStatusById` is supposed to neutralize).
     */
    setBatchStatus: (
      next: "idle" | "running" | "assembling" | "finished"
    ): void => {
      useBlueprintRealtimeStore.setState((state) => ({
        specDocsProgress: { ...state.specDocsProgress, batchStatus: next },
      }));
    },
  };
}
