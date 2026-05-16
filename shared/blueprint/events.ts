/**
 * Blueprint 运行时事件名与家族的单一真相源。
 *
 * 关键约束：
 * - 所有蓝图栈 emit 的事件名 SHALL 来自 {@link BlueprintEventName}。
 * - 所有蓝图栈事件 SHALL 归属到 {@link BlueprintGenerationEventFamily} 中的某个家族。
 * - 新增事件只允许通过本文件扩展，不允许在其它位置散落裸字符串。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split` 需求 5.1 / 5.2 / 6.3。
 */

/**
 * 事件家族（12 个）。
 *
 * 顺序遵循 design.md §4「事件家族架构」：
 * - `job`：作业级生命周期（created / stage / completed / failed）。
 * - `clarification`：澄清会话阶段与答案。
 * - `route`：RouteSet 生成、选择与重置。
 * - `spec`：SPEC Tree 与 SPEC Document 的更新、版本、评审。
 * - `preview`：效果预演生成与刷新。
 * - `prompt`：实现提示词打包。
 * - `mission`：mission handoff 等交接动作。
 * - `evidence`：Artifact Replay 下的证据记录与关联。
 * - `role`：Agent Crew 内角色生命周期。
 * - `capability`：Runtime Capability 调用生命周期。
 * - `crew`：Agent Crew 跨角色上下文更新。
 * - `sandbox`：沙箱推导作业生命周期。
 */
export type BlueprintGenerationEventFamily =
  | "job"
  | "clarification"
  | "route"
  | "spec"
  | "preview"
  | "prompt"
  | "mission"
  | "evidence"
  | "role"
  | "capability"
  | "crew"
  | "sandbox";

/**
 * 所有 blueprint 运行时事件名的联合类型。
 *
 * 新增事件时必须：
 * 1. 在此 union 中追加对应字符串字面量；
 * 2. 在 {@link BlueprintEventName} 中追加常量键；
 * 3. 如引入新的家族，同步扩展 {@link BlueprintGenerationEventFamily}。
 */
export type BlueprintGenerationEventType =
  // Job lifecycle
  | "job.created"
  | "job.stage"
  | "job.completed"
  | "job.failed"
  // Clarification
  | "clarification.ready"
  | "clarification.answered"
  | "clarification.dismissed"
  // RouteSet
  | "route.generated"
  | "route.selected"
  | "route.reset"
  // SPEC Tree / Documents
  | "spec.tree.updated"
  | "spec.tree.versioned"
  | "spec.document.versioned"
  | "spec.document.reviewed"
  // Effect preview
  | "preview.generated"
  | "preview.refreshed"
  // Prompt package
  | "prompt.packaged"
  // Mission handoff
  | "mission.handoff"
  // Evidence / Artifact Replay
  | "evidence.recorded"
  | "evidence.linked"
  // Agent Crew roles
  | "role.activated"
  | "role.watching"
  | "role.capability_invoked"
  | "role.review_started"
  | "role.review_completed"
  | "role.sleeping"
  | "role.completed"
  // Role container loader（`autopilot-role-container-loader` spec Task 1）：
  // 角色容器 loader 的 4 条生命周期事件。仍归入 `role` 家族，不扩展 12 家族目录。
  | "role.container.provisioning"
  | "role.container.ready"
  | "role.container.teardown"
  | "role.container.failed"
  // Agent reasoning stream（`autopilot-agent-reasoning-stream` spec Task 2）：
  // Agent ReAct 循环对外暴露的 7 条事件。仍归入 `role` 家族，不扩展 12 家族目录；
  // `resolveBlueprintEventFamily` 按首段 `.` 截取，会自动把 `role.agent.thinking`
  // 这种带两个 `.` 的事件归入 `"role"`。
  | "role.agent.iteration_started"
  | "role.agent.thinking"
  | "role.agent.acting"
  | "role.agent.observing"
  | "role.agent.iteration_completed"
  | "role.agent.error"
  | "role.agent.completed"
  // Runtime capability
  | "capability.invoked"
  | "capability.completed"
  | "capability.failed"
  // Crew 跨角色上下文
  | "crew.context.updated"
  // Sandbox 推导作业
  | "sandbox.job.started"
  | "sandbox.job.completed"
  | "sandbox.job.failed";

/**
 * `BlueprintEventName` 事件常量命名空间。
 *
 * 使用方式：`ctx.eventBus.emit({ type: BlueprintEventName.RouteSelected, ... })`。
 *
 * 每个键值严格等于其对应的字符串字面量，TypeScript 会把它们收窄成
 * {@link BlueprintGenerationEventType} 的一员，便于 event bus 做类型校验。
 */
export const BlueprintEventName = {
  // Job lifecycle
  JobCreated: "job.created",
  JobStage: "job.stage",
  JobCompleted: "job.completed",
  JobFailed: "job.failed",
  // Clarification
  ClarificationReady: "clarification.ready",
  ClarificationAnswered: "clarification.answered",
  ClarificationDismissed: "clarification.dismissed",
  // RouteSet
  RouteGenerated: "route.generated",
  RouteSelected: "route.selected",
  RouteReset: "route.reset",
  // SPEC Tree / Documents
  SpecTreeUpdated: "spec.tree.updated",
  SpecTreeVersioned: "spec.tree.versioned",
  SpecDocumentVersioned: "spec.document.versioned",
  SpecDocumentReviewed: "spec.document.reviewed",
  // Effect preview
  PreviewGenerated: "preview.generated",
  PreviewRefreshed: "preview.refreshed",
  // Prompt package
  PromptPackaged: "prompt.packaged",
  // Mission handoff
  MissionHandoff: "mission.handoff",
  // Evidence / Artifact Replay
  EvidenceRecorded: "evidence.recorded",
  EvidenceLinked: "evidence.linked",
  // Agent Crew roles
  RoleActivated: "role.activated",
  RoleWatching: "role.watching",
  RoleCapabilityInvoked: "role.capability_invoked",
  RoleReviewStarted: "role.review_started",
  RoleReviewCompleted: "role.review_completed",
  RoleSleeping: "role.sleeping",
  RoleCompleted: "role.completed",
  // Role container loader（`autopilot-role-container-loader` spec Task 1）
  RoleContainerProvisioning: "role.container.provisioning",
  RoleContainerReady: "role.container.ready",
  RoleContainerTeardown: "role.container.teardown",
  RoleContainerFailed: "role.container.failed",
  // Agent reasoning stream（`autopilot-agent-reasoning-stream` spec Task 2）
  RoleAgentIterationStarted: "role.agent.iteration_started",
  RoleAgentThinking: "role.agent.thinking",
  RoleAgentActing: "role.agent.acting",
  RoleAgentObserving: "role.agent.observing",
  RoleAgentIterationCompleted: "role.agent.iteration_completed",
  RoleAgentError: "role.agent.error",
  RoleAgentCompleted: "role.agent.completed",
  // Runtime capability
  CapabilityInvoked: "capability.invoked",
  CapabilityCompleted: "capability.completed",
  CapabilityFailed: "capability.failed",
  // Crew 跨角色上下文
  CrewContextUpdated: "crew.context.updated",
  // Sandbox 推导作业
  SandboxJobStarted: "sandbox.job.started",
  SandboxJobCompleted: "sandbox.job.completed",
  SandboxJobFailed: "sandbox.job.failed",
} as const satisfies Record<string, BlueprintGenerationEventType>;

/**
 * {@link BlueprintEventName} 的键名类型，便于需要"事件名常量键"的场景使用。
 */
export type BlueprintEventNameKey = keyof typeof BlueprintEventName;

/**
 * 把事件名字符串映射到它所属的家族。
 *
 * 实现方式：截取首个 `.` 之前的段。`sandbox.job.started` 会返回 `sandbox`，
 * `spec.tree.updated` 会返回 `spec`，与现有 `mapGenerationEventFamily` 的行为一致。
 *
 * @param eventType 事件名
 * @returns 家族名
 */
export function resolveBlueprintEventFamily(
  eventType: BlueprintGenerationEventType
): BlueprintGenerationEventFamily {
  const [family] = eventType.split(".", 1);
  return family as BlueprintGenerationEventFamily;
}

/**
 * Optional payload shape carried by `BlueprintEventName.PreviewGenerated`
 * events (and, by extension, the `BlueprintEventName.JobCompleted` emit
 * that also aggregates per-preview provenance).
 *
 * Added by the `autopilot-effect-preview-llm` spec (design §4.8 / §D7,
 * requirement 6.1 / 6.2 / 6.5). All three fields are optional so event
 * consumers that pre-date this spec remain source-compatible:
 *
 *  - `previewGenerationSources` — per-preview `{ nodeId, generationSource }`
 *    summary covering the entire effect preview batch. Always filled when
 *    at least one preview was produced.
 *  - `promptId` — set when any preview in the batch attempted the LLM
 *    path (i.e. `generationSource` was `"llm"` or `"llm_fallback"`).
 *    Currently pinned to `"blueprint.effect-preview.v1"`.
 *  - `model` — LLM model identifier read from `ctx.llm.getConfig().model`
 *    at invocation time, filled under the same condition as `promptId`.
 *
 * The type is intentionally additive on top of the generic
 * `BlueprintGenerationEvent.payload?: unknown` shape — events still
 * validate via the existing event bus guard and this interface acts as
 * a documented overlay for consumers that want structured access.
 */
export interface BlueprintPreviewGeneratedEventPayload {
  previewGenerationSources?: Array<{
    nodeId: string;
    generationSource: "llm" | "llm_fallback" | "template";
  }>;
  promptId?: string;
  model?: string;
}
