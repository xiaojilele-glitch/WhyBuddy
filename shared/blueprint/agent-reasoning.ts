/**
 * `autopilot-agent-reasoning-stream` spec Task 1：Agent 推理流前端 view model 与 Layer 4 合约。
 *
 * 本文件位于「四层数据映射」中的 Layer 4，负责把 `BlueprintEventBus` 上的 `role.agent.*`
 * Socket 事件转译为时间线卡片所需的 `AgentReasoningEntry`。Layer 1（runtime）/ Layer 2
 * （`CallbackReceiver` 进度回调）/ Layer 3（`role.agent.*` socket 事件）的真相源都不在本
 * 文件管辖范围之内，仅作为输入消费。
 *
 * 关键约束：
 * - 不修改任何既有 bridge / delegator / runtime 内部实现（Req 2.4）。
 * - 不扩展 12 家族目录：`role.agent.*` 仍归属 `role` 家族（Req 3.2）。
 * - 不引入 PBT 依赖；本文件只提供纯函数与类型声明（Req 11.4）。
 * - 不扩大 TypeScript 基线 113 个错误；新代码全量类型，不使用 `any`（Req 11.5）。
 *
 * 与 Task 2 的解耦：Task 2 才会把 7 个 `role.agent.*` 字面量加进
 * `BlueprintGenerationEventType` union。本文件采用 **structural type checking** 通过
 * `event.type.startsWith("role.agent.")` 做字符串前缀判断，避免在 Task 2 落地之前形成循环
 * 依赖；Task 2 落地之后无需修改本文件。
 */

import type { BlueprintGenerationEvent } from "./contracts.js";

/**
 * Agent ReAct 循环每一类卡片对应的 phase 枚举。
 *
 * - `thinking` / `acting` / `observing`：单轮内的三段式语义。
 * - `iteration_started` / `iteration_completed`：iteration 分隔线。
 * - `error`：含 Tier 降级、用户取消、超时、Lite 回退等错误态。
 * - `completed`：终态成功。
 */
export type AgentReasoningPhase =
  | "thinking"
  | "acting"
  | "observing"
  | "iteration_started"
  | "iteration_completed"
  | "error"
  | "completed";

/**
 * 时间线一条卡片的结构化 view model。
 *
 * 必填：`id / jobId / iteration / iterationLabel / phase / timestamp`。
 * 可选语义载荷：按 phase 与脱敏规则按需出现，详见 Req 4 / design §Layer 4。
 */
export interface AgentReasoningEntry {
  /** `${jobId}:${iteration}:${phase}:${timestamp}` 拼接，保证幂等去重。 */
  id: string;
  jobId: string;
  iteration: number;
  /** 形如 `#${iteration}`，便于 UI 直接渲染分隔线。 */
  iterationLabel: string;
  phase: AgentReasoningPhase;
  /** ISO 时间字符串。 */
  timestamp: string;
  /** 脱敏后 `thought`，截断到 ≤280 UTF-8 字符。 */
  thought?: string;
  /** acting phase 时的稳定工具 id，例如 `mcp.github.clone`。 */
  actionToolId?: string;
  /** observing phase 是否成功。 */
  observationSuccess?: boolean;
  /** 观察摘要，截断到 ≤200 UTF-8 字符。 */
  observationSummary?: string;
  /** 错误码或简短消息，截断到 ≤200 UTF-8 字符，不含 stack。 */
  error?: string;
  /** 是否走 Tier 降级路径。 */
  degraded?: boolean;
  /** 中文友好的降级 / 终态原因，例如 "降级到 Lite 模式" / "用户取消" / "超时" / "一次性 LLM 回退"。 */
  reason?: string;
  tokensUsed?: number;
  budgetRemaining?: number;
  /**
   * 当前事件归属的阶段标识，例如 `"clarification"` / `"route_generation"` /
   * `"spec_tree"` / `"spec_docs"`。
   *
   * `autopilot-streaming-experience` integration-gap-2026-05-16 wave 3：
   * 用于让子时间线在多阶段共用同一份 entries 列表时，按当前 active 子阶段
   * 过滤显示。可选；缺失时调用方应视为"全局"事件。
   */
  stageId?: string;
}

/**
 * `role.agent.*` 事件名前缀，集中常量化便于 Task 2 之后做替换审计。
 */
const AGENT_EVENT_PREFIX = "role.agent.";

/**
 * 合法 phase 集合，用于校验前缀剥离后剩余字符串是否落在 7 个字面量之内。
 */
const VALID_PHASES: ReadonlySet<AgentReasoningPhase> = new Set<AgentReasoningPhase>([
  "thinking",
  "acting",
  "observing",
  "iteration_started",
  "iteration_completed",
  "error",
  "completed",
]);

/**
 * 把 `BlueprintGenerationEvent` 转换成 `AgentReasoningEntry`。
 *
 * - 非 `role.agent.*` 事件返回 `null`，调用方应 fallthrough 到其它分支（如 `logEntries`）。
 * - 字段缺失时退化到合理默认：`iteration` 缺省为 `0`，`timestamp` 优先取 `event.timestamp`，
 *   其次 `event.occurredAt`，最后 `new Date().toISOString()`。
 * - 不抛错；非法类型会被静默丢弃，保留事件骨架。
 *
 * @param event 来自 `BlueprintEventBus` 的事件
 * @returns 对应卡片实体；非 `role.agent.*` 事件返回 `null`
 */
export function buildEntryFromSocketEvent(
  event: BlueprintGenerationEvent
): AgentReasoningEntry | null {
  if (typeof event.type !== "string" || !event.type.startsWith(AGENT_EVENT_PREFIX)) {
    return null;
  }

  const candidatePhase = event.type.slice(AGENT_EVENT_PREFIX.length);
  if (!VALID_PHASES.has(candidatePhase as AgentReasoningPhase)) {
    return null;
  }
  const phase = candidatePhase as AgentReasoningPhase;

  // Task 2.5 会把 `iteration / thought / actionToolId / ...` 等字段补进
  // `BlueprintGenerationEvent` 顶层 schema。在 Task 1 范围内通过 intersection 类型读取，
  // 既支持当前 payload 携带方式，也兼容 Task 2.5 之后的顶层字段方式。
  const extended = event as ExtendedAgentEvent;

  const iteration = pickFiniteNumber(extended.iteration) ?? 0;
  const timestamp =
    pickNonEmptyString(extended.timestamp) ??
    pickNonEmptyString(event.occurredAt) ??
    new Date().toISOString();
  const jobId = pickNonEmptyString(event.jobId) ?? "";

  const entry: AgentReasoningEntry = {
    id: `${jobId}:${iteration}:${phase}:${timestamp}`,
    jobId,
    iteration,
    iterationLabel: `#${iteration}`,
    phase,
    timestamp,
  };

  const thought = pickNonEmptyString(extended.thought);
  if (thought !== undefined) {
    entry.thought = thought;
  }

  const actionToolId = pickNonEmptyString(extended.actionToolId);
  if (actionToolId !== undefined) {
    entry.actionToolId = actionToolId;
  }

  if (typeof extended.observationSuccess === "boolean") {
    entry.observationSuccess = extended.observationSuccess;
  }

  const observationSummary = pickNonEmptyString(extended.observationSummary);
  if (observationSummary !== undefined) {
    entry.observationSummary = observationSummary;
  }

  const errorMessage = pickNonEmptyString(extended.error);
  if (errorMessage !== undefined) {
    entry.error = errorMessage;
  }

  if (typeof extended.degraded === "boolean") {
    entry.degraded = extended.degraded;
  }

  const reason = pickNonEmptyString(extended.reason);
  if (reason !== undefined) {
    entry.reason = reason;
  }

  const tokensUsed = pickFiniteNumber(extended.tokensUsed);
  if (tokensUsed !== undefined) {
    entry.tokensUsed = tokensUsed;
  }

  const budgetRemaining = pickFiniteNumber(extended.budgetRemaining);
  if (budgetRemaining !== undefined) {
    entry.budgetRemaining = budgetRemaining;
  }

  // autopilot-streaming-experience integration-gap-2026-05-16 wave 3：
  // 优先取 payload 中的 stageId（stage-progress-emitter 直发的事件会塞），
  // 其次回退到 event.stage（agent-reasoning-bridge 翻译时映射）。两路都缺
  // 视为没有阶段标签，由消费方决定是否过滤。
  const stageId =
    pickNonEmptyString(extended.stageId) ??
    pickNonEmptyString((event as { stage?: unknown }).stage);
  if (stageId !== undefined) {
    entry.stageId = stageId;
  }

  return entry;
}

/**
 * 扩展态 `BlueprintGenerationEvent`：补一组 Task 2.5 之后会作为顶层可选字段出现的属性。
 *
 * 通过 intersection + `unknown` 类型读取，规避两点风险：
 * 1. Task 2.5 落地前 `BlueprintGenerationEvent` 没有这些字段，强读会触发 TS 报错。
 * 2. 上游 bridge 万一塞了非预期类型（例如 `iteration` 是字符串），不会污染下游。
 */
type ExtendedAgentEvent = BlueprintGenerationEvent & {
  iteration?: unknown;
  timestamp?: unknown;
  thought?: unknown;
  actionToolId?: unknown;
  observationSuccess?: unknown;
  observationSummary?: unknown;
  error?: unknown;
  degraded?: unknown;
  reason?: unknown;
  tokensUsed?: unknown;
  budgetRemaining?: unknown;
  stageId?: unknown;
  /**
   * stage-progress-emitter / agent-reasoning-bridge 都会把语义字段塞到
   * payload 里。Layer 4 转译同样需要从此处读取，因此声明一个开放结构。
   */
  payload?: { stageId?: unknown; [key: string]: unknown };
};

function pickNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length === 0) {
    return undefined;
  }
  return value;
}

function pickFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}
