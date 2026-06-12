// `autopilot-role-container-loader` spec Task 2：角色容器能力包类型从独立子模块
// 引入，避免把大块类型定义堆进 contracts.ts（保持既有契约稳定）。
import type { RoleCapabilityPackage } from "./role-container/types.js";
import type { RoleAgentConfig } from "./agent-config.js";
import type { Artifact } from "./v5-reasoning-state.js";

export type {
  RoleCapabilityPackage,
  RoleCapabilityPackageBinding,
  RoleResourceBudget,
} from "./role-container/types.js";

export type BlueprintGenerationStage =
  | "input"
  | "clarification"
  | "route_generation"
  | "spec_tree"
  | "spec_docs"
  | "preview"
  | "effect_preview"
  | "prompt_packaging"
  | "runtime_capability"
  | "engineering_handoff"
  | "engineering_landing";

export type BlueprintStaleReason =
  | "upstream_target_changed"
  | "upstream_clarification_changed"
  | "upstream_route_changed"
  | "upstream_route_selection_changed"
  | "upstream_explicit_invalidation";

export type BlueprintGenerationStatus =
  | "pending"
  | "running"
  | "waiting"
  | "reviewing"
  | "completed"
  | "failed";

export type BlueprintGenerationMode =
  | "autopilot_route"
  | "spec_tree"
  | "spec_docs"
  | "effect_preview"
  | "prompt_packaging"
  | "runtime_capability"
  | "engineering_landing";

export type BlueprintRouteRiskLevel = "low" | "medium" | "high";
export type BlueprintRouteCostLevel = "low" | "medium" | "high";
export type BlueprintRouteComplexity = "light" | "balanced" | "deep";
export type BlueprintRouteKind = "primary" | "alternative";
export type BlueprintRuntimeCapabilityKind =
  | "docker"
  | "mcp"
  | "skill"
  | "aigc_node"
  | "role";
export type BlueprintRuntimeCapabilitySecurityLevel =
  | "readonly"
  | "sandboxed"
  | "write_enabled"
  | "networked";
export type BlueprintRuntimeCapabilityStatus =
  | "available"
  | "disabled"
  | "requires_approval";
export type BlueprintAgentRoleGroup =
  | "decision"
  | "planning"
  | "execution"
  | "audit"
  | "presentation"
  | "memory";
export type BlueprintRolePresenceState =
  | "active"
  | "watching"
  | "reviewing"
  | "sleeping";
export type BlueprintRoleActivationOverrideKind =
  | "risk"
  | "cost"
  | "complexity";
export type BlueprintCapabilityInvocationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";
export type BlueprintCapabilitySafetyGateStatus = "allowed" | "blocked";
export type BlueprintCapabilityEvidenceKind =
  | "analysis"
  | "diagram"
  | "document"
  | "log"
  | "safety";
export type BlueprintCapabilityEvidenceStatus =
  | "recorded"
  | "blocked"
  | "failed";

/**
 * V5 Capability Pool taxonomy (定型版).
 * 旧的 BlueprintGenerationStage 仅保留为 UI/artifact/history/compat 标签。
 * 真实调度以 V5CapabilityId + (capability, role) 对进行。
 * 详见 docs/WhyBuddyV5CapabilityPool.md 和 WhyBuddyV5闭环总图_完整版.md
 */
export type V5CapabilityId =
  | "intent.parse"
  | "intent.clarify"
  | "context.collect"
  | "source.classify"
  | "gap.ask"
  | "question.expand"
  | "assumption.validate"
  | "route.generate"
  | "route.compare"
  | "tradeoff.evaluate"
  | "structure.decompose"
  | "document.draft"
  | "requirement.write"
  | "design.write"
  | "task.write"
  | "scenario.simulate"
  | "ux.preview"
  | "outcome.visualize"
  | "instruction.package"
  | "execution.prepare"
  | "evidence.search"
  | "repo.inspect"
  | "mcp.call"
  | "skill.invoke"
  | "risk.analyze"
  | "counter.argue"
  | "argument.expand"
  | "critique.generate"
  | "rebuttal.resolve"
  | "synthesis.merge"
  | "report.write"
  | "memory.recall"
  | "traceability.matrix"
  | "handoff.package";

/**
 * 旧 stage → V5 能力包映射（兼容层 + 重新解释）。
 * 调度器使用此映射将 legacy stage 翻译为能力包，但 orchestrator 可自由跨 stage 选择能力。
 */
export const STAGE_TO_V5_CAPABILITIES: Record<BlueprintGenerationStage, V5CapabilityId[]> = {
  input: ["intent.parse", "context.collect", "source.classify"],
  clarification: ["intent.clarify", "gap.ask", "assumption.validate", "question.expand"],
  route_generation: ["route.generate", "route.compare", "tradeoff.evaluate"],
  spec_tree: ["structure.decompose"],
  spec_docs: ["document.draft", "requirement.write", "design.write", "task.write"],
  preview: ["scenario.simulate", "ux.preview", "outcome.visualize"],
  effect_preview: ["scenario.simulate", "ux.preview", "outcome.visualize"],
  prompt_packaging: ["instruction.package", "execution.prepare"],
  runtime_capability: ["mcp.call", "skill.invoke"],
  engineering_handoff: ["structure.decompose", "document.draft", "handoff.package"],
  engineering_landing: ["execution.prepare", "report.write", "traceability.matrix"],
};

export const V5_CAPABILITY_TO_STAGES: Partial<Record<V5CapabilityId, BlueprintGenerationStage[]>> = {
  "intent.parse": ["input"],
  "intent.clarify": ["clarification"],
  "route.generate": ["route_generation"],
  "structure.decompose": ["spec_tree", "engineering_handoff"],
  "document.draft": ["spec_docs", "engineering_handoff"],
  "scenario.simulate": ["effect_preview", "preview"],
  "report.write": ["engineering_landing"],
};

/**
 * V5 完整能力池（不是从旧 stage 映射推导）。
 * 这是 orchestrator / picker 的权威可用能力全集。
 * STAGE_TO_V5_CAPABILITIES 仅为 legacy 兼容投影，不应限制 V5 调度。
 */
export const ALL_V5_CAPABILITIES: V5CapabilityId[] = [
  "intent.parse",
  "intent.clarify",
  "context.collect",
  "source.classify",
  "gap.ask",
  "question.expand",
  "assumption.validate",
  "route.generate",
  "route.compare",
  "tradeoff.evaluate",
  "structure.decompose",
  "document.draft",
  "requirement.write",
  "design.write",
  "task.write",
  "scenario.simulate",
  "ux.preview",
  "outcome.visualize",
  "instruction.package",
  "execution.prepare",
  "evidence.search",
  "repo.inspect",
  "mcp.call",
  "skill.invoke",
  "risk.analyze",
  "counter.argue",
  "argument.expand",
  "critique.generate",
  "rebuttal.resolve",
  "synthesis.merge",
  "report.write",
  "memory.recall",
  "traceability.matrix",
  "handoff.package",
];

export const V5_CAPABILITY_POOL = new Set(ALL_V5_CAPABILITIES);

/**
 * 每个 V5 能力产出的标准 Artifact kind。
 * 用于页面构造 raw artifact 和 runtime 输入需求匹配。
 */
export const CAPABILITY_OUTPUT_KIND: Partial<Record<V5CapabilityId, Artifact["kind"]>> = {
  "intent.parse": "clarification",
  "intent.clarify": "clarification",
  "context.collect": "clarification",
  "evidence.search": "evidence",
  "repo.inspect": "evidence",
  "risk.analyze": "risk",
  "counter.argue": "risk",
  "synthesis.merge": "synthesis",
  "report.write": "report",
  "route.generate": "route_options",
  "route.compare": "route_options",
  "structure.decompose": "spec_tree",
  "document.draft": "doc",
  "task.write": "doc",
  "traceability.matrix": "plan",
  "handoff.package": "plan",
  "scenario.simulate": "preview",
  "ux.preview": "preview",
  "outcome.visualize": "preview",
  // 其他可按需扩展，默认 fallback 到 "decision" 或 "plan"
};

import type {
  BlueprintGenerationEventFamily as _BlueprintGenerationEventFamily,
  BlueprintGenerationEventType as _BlueprintGenerationEventType,
} from "./events.js";
import type { RoleArchitectureResponse } from "./role-architecture.js";

export type BlueprintGenerationEventFamily = _BlueprintGenerationEventFamily;
export type BlueprintGenerationEventType = _BlueprintGenerationEventType;
export type { BlueprintEventNameKey } from "./events.js";
export { BlueprintEventName, resolveBlueprintEventFamily } from "./events.js";
export type BlueprintGenerationNextActionType =
  | "answer_clarification"
  | "select_route"
  | "review_spec_tree"
  | "review_spec_documents"
  | "review_preview"
  | "review_prompt_package"
  | "review_runtime_capability"
  | "review_engineering_handoff"
  | "none";
export type BlueprintGenerationNextActionId =
  | "confirm_spec_tree"
  | "fine_tune_spec_tree"
  | "reselect_route"
  | "merge_route"
  | "enter_downstream_menus";
export type BlueprintGenerationStagePayloadKind =
  | "input"
  | "clarification"
  | "route_set"
  | "spec_tree"
  | "spec_documents"
  | "preview"
  | "prompt_package"
  | "runtime_capability"
  | "engineering_handoff"
  | "engineering_landing";
export type BlueprintSandboxDerivationExecutionMode =
  | "sequential"
  | "parallel";
export type BlueprintSandboxDerivationJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";
export type BlueprintSpecTreeStatus = "draft" | "reviewing" | "accepted";
export type BlueprintSpecTreeNodeStatus =
  | "seed"
  | "draft"
  | "ready"
  | "accepted";
export type BlueprintSpecTreeNodeType =
  | "root"
  | "route_step"
  | "alternative_route"
  | "spec_document"
  | "effect_preview"
  | "prompt_package"
  | "engineering_plan";
export type BlueprintSpecDocumentType = "requirements" | "design" | "tasks";
export type BlueprintSpecDocumentStatus =
  | "draft"
  | "reviewing"
  | "accepted"
  | "rejected";
export type BlueprintEffectPreviewStatus = "preview" | "completed";
export type BlueprintEffectPreviewSourceStatus =
  | "accepted"
  | "draft"
  | "reviewing"
  | "mixed";
export type BlueprintImplementationPromptTargetPlatform =
  | "cursor"
  | "kiro"
  | "trae"
  | "windsurf"
  | "codex"
  | "claude";
export type BlueprintImplementationPromptSourceStatus =
  | "accepted"
  | "draft"
  | "reviewing"
  | "mixed"
  | "missing";
export type BlueprintImplementationPromptSectionKind =
  | "context"
  | "implementation"
  | "constraints"
  | "verification"
  | "handoff";
export type BlueprintImplementationPromptItemKind =
  | "instruction"
  | "constraint"
  | "verification"
  | "source"
  | "note";
export type BlueprintEngineeringLandingStepMode =
  | "automatic"
  | "manual"
  | "handoff";
export type BlueprintEngineeringLandingRiskLevel = "low" | "medium" | "high";
export type BlueprintEngineeringLandingPlanStatus =
  | "draft"
  | "ready"
  | "running"
  | "completed"
  | "failed";
export type BlueprintEngineeringRunStatus =
  | "planned"
  | "running"
  | "passed"
  | "failed"
  | "blocked";
export type BlueprintEngineeringVerificationStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "blocked";

export interface BlueprintClarificationAnswer {
  questionId: string;
  answer: string;
  answeredAt?: string;
  answeredBy?: string;
  source?: BlueprintClarificationAnswerSource;
  provenance?: BlueprintClarificationAnswerProvenance;
}

export type BlueprintClarificationStrategyId =
  | "target_first"
  | "repository_first"
  | "risk_first"
  | "document_first"
  | "preview_first"
  | "fast_execution";
export type BlueprintClarificationRouteDimension =
  | "goal"
  | "audience"
  | "risk"
  | "repository"
  | "domain"
  | "document"
  | "preview"
  | "output"
  | "execution"
  | "handoff";
export type BlueprintClarificationReadinessSignalId =
  | "goal_defined"
  | "audience_defined"
  | "constraints_defined"
  | "repository_context"
  | "domain_assets"
  | "document_intent"
  | "preview_intent"
  | "output_preference"
  | "risk_review"
  | "fast_path";
export type BlueprintClarificationAnswerSource =
  | "user"
  | "strategy_default"
  | "intake"
  | "system";
export interface BlueprintClarificationAnswerProvenance {
  strategyId?: BlueprintClarificationStrategyId;
  templateId?: string;
  routeDimension?: BlueprintClarificationRouteDimension;
  readinessSignal?: BlueprintClarificationReadinessSignalId;
}
export type BlueprintGithubSourceKind = "repository";
export type BlueprintClarificationQuestionKind =
  | "goal"
  | "audience"
  | "constraint"
  | "github"
  | "domain"
  | "document"
  | "preview"
  | "execution";
export type BlueprintClarificationReadinessStatus =
  | "needs_answers"
  | "ready";
export type BlueprintClarificationGenerationSource =
  | "template"
  | "llm"
  | "llm_fallback";
export type BlueprintDomainAssetKind =
  | "product_goal"
  | "github_repository"
  | "clarification"
  | "domain_note";
export type BlueprintDomainEvidenceKind =
  | "intake_text"
  | "github_url"
  | "clarification_answer";

export interface BlueprintGithubSource {
  id: string;
  kind: BlueprintGithubSourceKind;
  url: string;
  normalizedUrl: string;
  owner: string;
  repo: string;
  slug: string;
  branch?: string;
  path?: string;
  evidenceIds: string[];
  duplicateOf?: string;
}

export interface BlueprintDomainEvidence {
  id: string;
  kind: BlueprintDomainEvidenceKind;
  label: string;
  summary: string;
  value: string;
  sourceId?: string;
  createdAt: string;
}

export interface BlueprintDomainAsset {
  id: string;
  kind: BlueprintDomainAssetKind;
  title: string;
  summary: string;
  sourceIds: string[];
  evidenceIds: string[];
  tags: string[];
  createdAt: string;
}

export interface BlueprintProjectDomainContext {
  projectId: string;
  updatedAt: string;
  intakeIds: string[];
  sourceIds: string[];
  assets: BlueprintDomainAsset[];
  evidence: BlueprintDomainEvidence[];
}

export interface BlueprintIntakeRequest {
  projectId?: string;
  sourceId?: string;
  targetText?: string;
  githubUrls?: string[];
  domainNotes?: string[];
}

export interface BlueprintIntake {
  id: string;
  projectId?: string;
  sourceId?: string;
  targetText?: string;
  githubUrls: string[];
  sources: BlueprintGithubSource[];
  duplicateGithubUrls: BlueprintGithubSource[];
  domainNotes: string[];
  assets: BlueprintDomainAsset[];
  evidence: BlueprintDomainEvidence[];
  readiness: BlueprintClarificationReadiness;
  createdAt: string;
  updatedAt: string;
}

export interface BlueprintClarificationQuestion {
  id: string;
  kind: BlueprintClarificationQuestionKind;
  prompt: string;
  required: boolean;
  sourceIds: string[];
  evidenceIds: string[];
  type?: "free_text" | "single_choice" | "multi_choice";
  options?: string[];
  context?: string;
  routeDimension?: BlueprintClarificationRouteDimension;
  readinessSignal?: BlueprintClarificationReadinessSignalId;
  templateId?: string;
  strategyId?: BlueprintClarificationStrategyId;
  settledByStrategy?: boolean;
  settledReason?: string;
  defaultAnswer?: string;
  generationSource?: BlueprintClarificationGenerationSource;
  llmModel?: string;
  llmPromptId?: string;
}

export interface BlueprintClarificationReadiness {
  status: BlueprintClarificationReadinessStatus;
  score: number;
  answeredRequired: number;
  requiredTotal: number;
  missingQuestionIds: string[];
  readinessSignals?: BlueprintClarificationReadinessSignalId[];
  settledQuestionIds?: string[];
  routeDimensions?: BlueprintClarificationRouteDimension[];
}

export interface BlueprintClarificationSession {
  id: string;
  intakeId: string;
  projectId?: string;
  strategyId?: BlueprintClarificationStrategyId;
  strategyLabel?: string;
  templateId?: string;
  routeReadySummary?: string;
  readinessSignals?: BlueprintClarificationReadinessSignalId[];
  generationSource?: BlueprintClarificationGenerationSource;
  llmModel?: string;
  llmPromptId?: string;
  llmError?: string;
  questions: BlueprintClarificationQuestion[];
  answers: BlueprintClarificationAnswer[];
  readiness: BlueprintClarificationReadiness;
  createdAt: string;
  updatedAt: string;
}

export interface BlueprintGenerationRequest {
  projectId?: string;
  sourceId?: string;
  version?: string;
  mode?: BlueprintGenerationMode;
  intakeId?: string;
  clarificationSessionId?: string;
  targetText?: string;
  githubUrls?: string[];
  clarifications?: BlueprintClarificationAnswer[];
  domainContext?: BlueprintProjectDomainContext;
  /** User's preferred locale for LLM-generated content. Defaults to "en-US" on the backend. */
  locale?: "zh-CN" | "en-US";
}

export interface BlueprintRouteStep {
  id: string;
  title: string;
  description: string;
  role: string;
  status: "pending" | "ready" | "blocked";
}

export interface BlueprintCapabilityUsage {
  id: string;
  label: string;
  kind: BlueprintRuntimeCapabilityKind;
  purpose: string;
}

export interface BlueprintRuntimeCapability {
  id: string;
  label: string;
  kind: BlueprintRuntimeCapabilityKind;
  purpose: string;
  description: string;
  tags: string[];
  securityLevel: BlueprintRuntimeCapabilitySecurityLevel;
  status: BlueprintRuntimeCapabilityStatus;
  adapter: string;
  inputSchema: string;
  outputTypes: string[];
  supportedStages: BlueprintGenerationStage[];
  requiresApproval: boolean;
  projectScoped: boolean;
}

export interface BlueprintAgentRole {
  id: string;
  name: string;
  group: BlueprintAgentRoleGroup;
  responsibility: string;
  defaultStages: BlueprintGenerationStage[];
  permissions: string[];
  displayName: string;
  displayLabelZh: string;
  /**
   * 可选：角色容器能力包。
   *
   * 由 `autopilot-role-container-loader` spec Task 2 引入（需求 1.1 / 1.2 /
   * 1.5 / 1.6 / 1.7）。未设置时 loader 会优先从静态目录按 `id` 解析，
   * 仍为空则返回空包（不阻塞 role.* 事件 emit）。
   *
   * 字段 shape 定义在 `shared/blueprint/role-container/types.ts`，保持
   * `BlueprintAgentRole` 既有 8 个字段严格不变，仅追加这一条可选字段
   * 以维持既有 contract 回归兼容（需求 10.1 / 10.2）。
   */
  capabilityPackage?: RoleCapabilityPackage;
  /**
   * `autopilot-role-autonomous-agent` spec Task 1.6：角色 Agent 配置。
   * 定义该角色作为自主 Agent 运行时的系统提示词、预算、工具类别等参数。
   * 未设置时角色不以 Agent 模式运行（走现有 callLLMJson 路径）。
   */
  agentConfig?: RoleAgentConfig;
}

export interface BlueprintRoleCapability {
  id: string;
  roleId: string;
  capabilityId: string;
  nodeId?: string;
  applicableStages: BlueprintGenerationStage[];
  inputSchema: string;
  outputSchema: string;
  tools: string[];
  requiresSandbox: boolean;
  producesArtifacts: boolean;
  auditRules: string[];
}

export interface BlueprintCapabilityBinding extends BlueprintRoleCapability {
  capabilityLabel: string;
  capabilityKind: BlueprintRuntimeCapabilityKind;
  roleDisplayName: string;
}

export interface BlueprintRoleActivationOverride {
  kind: BlueprintRoleActivationOverrideKind;
  level:
    | BlueprintRouteRiskLevel
    | BlueprintRouteCostLevel
    | BlueprintRouteComplexity;
  roleId: string;
  state: BlueprintRolePresenceState;
  reason: string;
}

export interface BlueprintStageActivationPolicy {
  stage: BlueprintGenerationStage;
  activeRoleIds: string[];
  watchingRoleIds: string[];
  reviewingRoleIds: string[];
  sleepingRoleIds: string[];
  overrides: BlueprintRoleActivationOverride[];
}

export interface BlueprintRolePresence {
  roleId: string;
  stage: BlueprintGenerationStage;
  state: BlueprintRolePresenceState;
  currentAction: string;
  capabilityIds: string[];
  artifactIds: string[];
  evidenceIds: string[];
}

export interface BlueprintAgentCrew {
  id: string;
  jobId: string;
  createdAt: string;
  updatedAt: string;
  stage: BlueprintGenerationStage;
  roles: BlueprintAgentRole[];
  capabilityMatrix: BlueprintCapabilityBinding[];
  activationPolicies: BlueprintStageActivationPolicy[];
  presence: BlueprintRolePresence[];
  sourceIds: Partial<BlueprintArtifactSourceIds>;
}

export interface BlueprintRoleTimelineEntry {
  id: string;
  eventId: string;
  jobId: string;
  projectId?: string;
  crewId?: string;
  stage: BlueprintGenerationStage;
  roleId: string;
  presenceState: BlueprintRolePresenceState;
  type: BlueprintGenerationEventType;
  occurredAt: string;
  summary: string;
  currentAction?: string;
  capabilityId?: string;
  invocationId?: string;
  evidenceId?: string;
  artifactId?: string;
  routeId?: string;
  selectionId?: string;
  specTreeId?: string;
  nodeId?: string;
  sourceIds: Partial<BlueprintArtifactSourceIds>;
}

export interface BlueprintRoleTimeline {
  id: string;
  jobId: string;
  projectId?: string;
  crewId?: string;
  roleId: string;
  roleDisplayName?: string;
  roleDisplayLabelZh?: string;
  latestStage: BlueprintGenerationStage;
  latestPresenceState: BlueprintRolePresenceState;
  latestAction?: string;
  latestCapabilityId?: string;
  latestArtifactId?: string;
  latestEvidenceId?: string;
  startedAt: string;
  updatedAt: string;
  entryCount: number;
  entries: BlueprintRoleTimelineEntry[];
}

export interface BlueprintRoleTimelineCollection {
  id: string;
  jobId: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
  latestStage: BlueprintGenerationStage;
  timelines: BlueprintRoleTimeline[];
  sourceIds: Partial<BlueprintArtifactSourceIds>;
}

export interface BlueprintCapabilitySafetyGate {
  status: BlueprintCapabilitySafetyGateStatus;
  reason: string;
  requiresApproval: boolean;
  approved: boolean;
  securityLevel: BlueprintRuntimeCapabilitySecurityLevel;
}

export interface BlueprintCapabilityInvocationRequest {
  capabilityId: string;
  roleId?: string;
  routeId?: string;
  nodeId?: string;
  input?: string;
  approved?: boolean;
  requestedBy?: string;
  evidenceTags?: string[];
}

export interface BlueprintSandboxDerivationCapabilityRequest
  extends BlueprintCapabilityInvocationRequest {
  crewId?: string;
}

export interface BlueprintCapabilityInvocation {
  id: string;
  jobId: string;
  capabilityId: string;
  roleId?: string;
  capabilityLabel: string;
  kind: BlueprintRuntimeCapabilityKind;
  status: BlueprintCapabilityInvocationStatus;
  securityLevel: BlueprintRuntimeCapabilitySecurityLevel;
  safetyGate: BlueprintCapabilitySafetyGate;
  requestedAt: string;
  completedAt?: string;
  requestedBy?: string;
  routeId?: string;
  nodeId?: string;
  input?: string;
  outputSummary: string;
  logs: string[];
  evidenceIds: string[];
  durationMs: number;
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    routeSetId?: string;
    routeId?: string;
    specTreeId?: string;
    nodeId?: string;
    roleId?: string;
    targetText?: string;
    githubUrls: string[];
    // —— Docker 桥 spec 预留字段 ——
    executionMode?: "real" | "simulated_fallback";
    containerId?: string;
    artifactUrl?: string;
    logDigest?: string;
    /**
     * Bridge-path discriminator (MCP GitHub spec).
     * - "mcp": real invocation via `ctx.mcpToolAdapter.execute()`
     * - "http": real invocation via `ctx.httpFetcher.fetch()`
     * Absent when the bridge took the fallback path.
     */
    executionPath?: "mcp" | "http";
    /** Canonical GitHub repository URL resolved by the mcp-github bridge (real paths only). */
    repoUrl?: string;
    /** Latest commit SHA, from MCP tool result or HTTP `ETag` header. */
    commitSha?: string;
    /** ISO8601 timestamp when the real invocation completed. */
    fetchedAt?: string;
    /** Default branch extracted from the GitHub repository metadata. */
    defaultBranch?: string;
    /** SHA-256 digest (hex) of the raw HTTP response body (HTTP real path). */
    apiResponseDigest?: string;
    /** MCP tool name used for the real invocation (MCP real path). */
    mcpToolName?: string;
    /** Scrubbed summary of the reason the bridge fell back, if any. */
    error?: string;
    // —— AIGC Spec Node 桥 spec 新增字段 ——
    promptId?: string;
    model?: string;
    responseDigest?: string;
    tokenCount?: number;
    structuredPayloadDigest?: string;
    promptFingerprint?: string;
    // —— Role System Architecture 桥 spec 新增字段 ——
    /** 当前选中的 primary route id；下游 Wave 2 stage-activation 的主检索键之一 */
    primaryRouteId?: string;
    /** Real 路径下产出的 roles 数组长度；fallback 下 undefined */
    roleCount?: number;
  };
}

export interface BlueprintCapabilityEvidence {
  id: string;
  jobId: string;
  invocationId: string;
  capabilityId: string;
  capabilityLabel: string;
  kind: BlueprintCapabilityEvidenceKind;
  status: BlueprintCapabilityEvidenceStatus;
  title: string;
  summary: string;
  createdAt: string;
  routeSetId?: string;
  routeId?: string;
  specTreeId?: string;
  nodeId?: string;
  artifacts: string[];
  logs: string[];
  tags: string[];
  payloadSummary: BlueprintArtifactPayloadSummary;
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    routeSetId?: string;
    routeId?: string;
    specTreeId?: string;
    nodeId?: string;
    targetText?: string;
    githubUrls: string[];
    // —— Docker 桥 spec 预留字段 ——
    executionMode?: "real" | "simulated_fallback";
    containerId?: string;
    artifactUrl?: string;
    logDigest?: string;
    /** Mirror of {@link BlueprintCapabilityInvocation.provenance.executionPath}. */
    executionPath?: "mcp" | "http";
    /** Mirror of {@link BlueprintCapabilityInvocation.provenance.repoUrl}. */
    repoUrl?: string;
    /** Mirror of {@link BlueprintCapabilityInvocation.provenance.commitSha}. */
    commitSha?: string;
    /** Mirror of {@link BlueprintCapabilityInvocation.provenance.fetchedAt}. */
    fetchedAt?: string;
    /** Mirror of {@link BlueprintCapabilityInvocation.provenance.defaultBranch}. */
    defaultBranch?: string;
    /** Mirror of {@link BlueprintCapabilityInvocation.provenance.apiResponseDigest}. */
    apiResponseDigest?: string;
    /** Mirror of {@link BlueprintCapabilityInvocation.provenance.mcpToolName}. */
    mcpToolName?: string;
    /** Mirror of {@link BlueprintCapabilityInvocation.provenance.error}. */
    error?: string;
    // —— AIGC Spec Node 桥 spec 新增字段 ——
    promptId?: string;
    model?: string;
    responseDigest?: string;
    tokenCount?: number;
    structuredPayloadDigest?: string;
    promptFingerprint?: string;
    structuredPayload?: {
      digest: string;
      byteSize: number;
      summary: string;
    };
    // —— Role System Architecture 桥 spec 新增字段 ——
    /** 当前选中的 primary route id；下游 Wave 2 stage-activation 的主检索键之一 */
    primaryRouteId?: string;
    /** Real 路径下产出的 roles 数组长度；fallback 下 undefined */
    roleCount?: number;
    /**
     * Real 路径下承载完整结构化角色 JSON 的对象；fallback 下 undefined。
     * 与 aigc-node 桥的 `structuredPayload` 三字段形态不同（本字段含完整 payload），
     * 故使用独立字段名避免语义冲突。
     */
    structuredRoles?: {
      digest: string;
      byteSize: number;
      summary: string;
      payload: RoleArchitectureResponse;
    };
  };
}

export interface BlueprintSandboxRoutePath {
  id: string;
  title: string;
  summary: string;
  routeId?: string;
  nodeId?: string;
  capabilityIds: string[];
  invocationIds: string[];
  evidenceIds: string[];
}

export interface BlueprintSandboxEvaluationMetric {
  id: string;
  label: string;
  score: number;
  summary: string;
}

export interface BlueprintSandboxDerivationAggregate {
  routeOutline: string;
  mainPath: BlueprintSandboxRoutePath;
  alternatePaths: BlueprintSandboxRoutePath[];
  evaluation: BlueprintSandboxEvaluationMetric[];
  outputSummary: string;
}

export interface BlueprintSandboxDerivationJobRequest {
  roleId?: string;
  crewId?: string;
  stage?: BlueprintGenerationStage;
  projectId?: string;
  routeId?: string;
  nodeId?: string;
  executionMode?: BlueprintSandboxDerivationExecutionMode;
  capabilities: BlueprintSandboxDerivationCapabilityRequest[];
}

export interface BlueprintSandboxDerivationJob {
  id: string;
  jobId: string;
  roleId?: string;
  crewId?: string;
  stage: BlueprintGenerationStage;
  projectId?: string;
  routeId?: string;
  nodeId?: string;
  executionMode: BlueprintSandboxDerivationExecutionMode;
  status: BlueprintSandboxDerivationJobStatus;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  capabilityIds: string[];
  invocationIds: string[];
  evidenceIds: string[];
  aggregate: BlueprintSandboxDerivationAggregate;
  logs: string[];
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    routeSetId?: string;
    routeId?: string;
    specTreeId?: string;
    nodeId?: string;
    roleId?: string;
    crewId?: string;
    targetText?: string;
    githubUrls: string[];
  };
}

export interface BlueprintRouteCandidate {
  id: string;
  kind: BlueprintRouteKind;
  title: string;
  summary: string;
  rationale: string;
  riskLevel: BlueprintRouteRiskLevel;
  costLevel: BlueprintRouteCostLevel;
  complexity: BlueprintRouteComplexity;
  estimatedEffort: string;
  capabilities: BlueprintCapabilityUsage[];
  steps: BlueprintRouteStep[];
  outputs: string[];
}

export interface BlueprintRouteSet {
  id: string;
  requestId: string;
  createdAt: string;
  primaryRouteId: string;
  routes: BlueprintRouteCandidate[];
  nextAsset: {
    type: "spec_tree";
    menu: "deduction";
    description: string;
  };
  provenance: {
    projectId?: string;
    sourceId?: string;
    targetText?: string;
    githubUrls: string[];
    clarificationSessionId?: string;
    clarificationStrategyId?: BlueprintClarificationStrategyId;
    clarificationTemplateId?: string;
    clarificationReadinessSignals?: BlueprintClarificationReadinessSignalId[];
    clarificationRouteDimensions?: BlueprintClarificationRouteDimension[];
    clarificationAnsweredQuestionIds?: string[];
    clarificationEvidenceIds?: string[];
    clarificationSourceIds?: string[];
    clarificationRouteReadySummary?: string;
    /**
     * RouteSet generation source tag. See
     * `.kiro/specs/autopilot-routeset-llm-generation/design.md` 4.9.
     * - `"llm"`: routes came entirely from the LLM generator.
     * - `"llm_fallback"`: LLM was attempted but the result was unusable and
     *   the generator returned templated routes.
     * - `"template"`: reserved for future use (e.g. feature flag disabled).
     */
    generationSource?: "llm" | "llm_fallback" | "template";
    /** Stable RouteSet prompt identifier (for example `blueprint.routeset.v1`). */
    promptId?: string;
    /** Actual LLM model used when `generationSource !== "template"`. */
    model?: string;
    /** Truncated fallback reason (LLM error or schema validation summary). */
    error?: string;
  };
}

export interface BlueprintRouteSelectionRequest {
  routeId: string;
  reason?: string;
  selectedBy?: string;
  mergedAlternativeRouteIds?: string[];
}

export interface BlueprintRouteSelection {
  id: string;
  routeSetId: string;
  routeId: string;
  selectedPathId?: string;
  routeTitle: string;
  selectedAt: string;
  selectedBy?: string;
  reason?: string;
  mergedAlternativeRouteIds: string[];
  status: "selected";
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
  };
}

export interface BlueprintSpecTreeNode {
  id: string;
  parentId?: string;
  title: string;
  summary: string;
  type: BlueprintSpecTreeNodeType;
  status: BlueprintSpecTreeNodeStatus;
  priority: number;
  routeId?: string;
  routeStepId?: string;
  dependencies: string[];
  outputs: string[];
  children: string[];
  metadata?: Record<string, string | number | boolean | string[]>;
}

export interface BlueprintSpecTree {
  id: string;
  routeSetId: string;
  selectionId: string;
  selectedPathId?: string;
  selectedRouteId: string;
  rootNodeId: string;
  version: number;
  status: BlueprintSpecTreeStatus;
  createdAt: string;
  updatedAt: string;
  alternativeRouteIds: string[];
  nodes: BlueprintSpecTreeNode[];
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    routeSetId?: string;
    routeId?: string;
    selectionId?: string;
    selectedPathId?: string;
    specTreeId?: string;
    targetText?: string;
    githubUrls: string[];
    artifactLinks?: BlueprintGenerationArtifactLink[];
    reusedRoleFindingIds?: string[];
    reusedRoleIds?: string[];
    reusedEvidenceIds?: string[];
    /** "llm" | "llm_fallback" | "template" — distinguishes LLM-driven vs template-driven SPEC Tree */
    generationSource?: "llm" | "llm_fallback" | "template";
    /** Stable prompt version identifier, e.g. "blueprint.spec-tree.v1" */
    promptId?: string;
    /** LLM model used for generation */
    model?: string;
    /** SHA-256 digest of the raw LLM response JSON */
    responseDigest?: string;
    /** SHA-256 digest of the validated+parsed payload JSON */
    structuredPayloadDigest?: string;
    /** SHA-256 fingerprint of the prompt (system + user messages) */
    promptFingerprint?: string;
    /** Redacted error message; only filled when generationSource === "llm_fallback" */
    error?: string;
  };
}

export interface BlueprintUpdateSpecTreeNodeRequest {
  title?: string;
  summary?: string;
  status?: BlueprintSpecTreeNodeStatus;
  priority?: number;
  outputs?: string[];
}

export type BlueprintSpecTreeActionType =
  | "add_node"
  | "delete_node"
  | "move_node"
  | "merge_nodes"
  | "split_node"
  | "set_current_version";

export type BlueprintSpecTreeActionRequest =
  | {
      action: "add_node";
      parentId: string;
      title: string;
      summary?: string;
      type?: BlueprintSpecTreeNodeType;
      status?: BlueprintSpecTreeNodeStatus;
      priority?: number;
      outputs?: string[];
    }
  | {
      action: "delete_node";
      nodeId: string;
    }
  | {
      action: "move_node";
      nodeId: string;
      parentId: string;
      priority?: number;
    }
  | {
      action: "merge_nodes";
      sourceNodeId: string;
      targetNodeId: string;
    }
  | {
      action: "split_node";
      sourceNodeId: string;
      title: string;
      summary?: string;
      outputs?: string[];
      placement?: "sibling" | "child";
    }
  | {
      action: "set_current_version";
      versionId: string;
    };

export interface BlueprintSpecTreeVersionSnapshot {
  id: string;
  treeId: string;
  version: number;
  title?: string;
  summary?: string;
  savedAt: string;
  savedBy?: string;
  snapshot: BlueprintSpecTree;
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
  };
}

export interface BlueprintSpecDocument {
  id: string;
  jobId: string;
  treeId: string;
  nodeId: string;
  type: BlueprintSpecDocumentType;
  status?: BlueprintSpecDocumentStatus;
  version?: number;
  sourceDocumentId?: string;
  title: string;
  summary: string;
  content: string;
  format: "markdown";
  createdAt: string;
  updatedAt?: string;
  reviewedAt?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    targetText?: string;
    githubUrls: string[];
    treeVersion: number;
    nodeType: BlueprintSpecTreeNodeType;
    nodeTitle: string;
    nodeSummary: string;
    dependencies: string[];
    outputs: string[];
    reusedRoleFindingIds?: string[];
    reusedRoleIds?: string[];
    reusedEvidenceIds?: string[];
    /**
     * SPEC Document generation source tag. See
     * `.kiro/specs/autopilot-spec-documents-llm/design.md` §4.9.
     * - `"llm"`: title/summary/content came entirely from the LLM generator.
     * - `"llm_fallback"`: LLM was attempted but the result was unusable and
     *   the generator returned templated output.
     * - `"template"`: LLM was never attempted (feature flag disabled, apiKey
     *   missing, or service not wired).
     */
    generationSource?: "llm" | "llm_fallback" | "template";
    /** Stable SPEC Documents prompt identifier (fixed to `blueprint.spec-documents.v1`). */
    promptId?: string;
    /** Actual LLM model used when `generationSource !== "template"`. */
    model?: string;
    /** SHA-256 digest of the raw LLM response (`sha256:<hex>`). Populated on real path. */
    responseDigest?: string;
    /** SHA-256 digest of the normalized/structured payload (`sha256:<hex>`). Populated on real path. */
    structuredPayloadDigest?: string;
    /** SHA-256 digest of (systemMessage + "\n\n" + userMessage) (`sha256:<hex>`). */
    promptFingerprint?: string;
    /** Truncated + redacted fallback reason (only set when `generationSource === "llm_fallback"`). */
    error?: string;
  };
}

export interface BlueprintSpecDocumentVersionSnapshot {
  id: string;
  documentId: string;
  sourceDocumentId: string;
  jobId: string;
  treeId: string;
  nodeId: string;
  type: BlueprintSpecDocumentType;
  version: number;
  status: BlueprintSpecDocumentStatus;
  title: string;
  summary: string;
  content: string;
  format: "markdown";
  savedAt: string;
  savedBy?: string;
  acceptedAt?: string;
  reviewedAt?: string;
  rejectedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    treeVersion: number;
    nodeType: BlueprintSpecTreeNodeType;
    nodeTitle: string;
    nodeSummary: string;
    dependencies: string[];
    outputs: string[];
  };
}

export interface BlueprintEffectPreviewStep {
  id: string;
  title: string;
  summary: string;
  sourceDocumentIds: string[];
}

export interface BlueprintEffectPreviewMilestone {
  id: string;
  title: string;
  summary: string;
  target: string;
  sourceDocumentIds: string[];
  /**
   * `autopilot-image-rendering-and-visual-system` spec Task 1.1：
   * Stage C 出图调度的 6 级降级层级。仅在节点失败时写入；成功或仍 pending
   * 的节点保持 undefined，保证既有消费方对 progressPlan 的解读不被破坏
   * （需求 4.3 / 6.4）。
   */
  fallbackTier?: FallbackTier;
  /**
   * `autopilot-image-rendering-and-visual-system` spec Task 1.1：
   * 节点进入 raster 调用的起始时间（ISO8601）。仅在 ImageService 串行处理
   * 该节点时写入；既有 progressPlan 消费方未读该字段，保持 optional 可向
   * 后兼容（需求 4.3）。
   */
  startedAt?: string;
  /**
   * `autopilot-image-rendering-and-visual-system` spec Task 1.1：
   * 节点处理完成或失败时间（ISO8601）。与 `startedAt` 配对使用。
   */
  endedAt?: string;
  /**
   * `autopilot-image-rendering-and-visual-system` spec Task 1.1：
   * 节点失败时的可读摘要，配合 `fallbackTier` 写入；不含密钥或原始 prompt。
   */
  errorSummary?: string;
}

export interface BlueprintEffectPreviewPrototypeCue {
  id: string;
  title: string;
  surface: "ui" | "api" | "workflow" | "architecture" | "operations";
  cue: string;
  sourceDocumentIds: string[];
}

export interface BlueprintEffectPreviewNode {
  id: string;
  nodeId: string;
  nodeTitle: string;
  nodeType: BlueprintSpecTreeNodeType;
  summary: string;
  sourceDocumentIds: string[];
  steps: BlueprintEffectPreviewStep[];
  milestones: BlueprintEffectPreviewMilestone[];
  prototypeCues: BlueprintEffectPreviewPrototypeCue[];
}

export interface BlueprintEffectPreviewHudState {
  id: string;
  status: BlueprintEffectPreviewStatus;
  stage: BlueprintGenerationStage;
  title: string;
  summary: string;
  progressPercent: number;
  activeNodeId: string;
  badges: string[];
}

export interface BlueprintEffectPreviewLogEntry {
  id: string;
  level: "info" | "warning" | "success";
  message: string;
  occurredAt: string;
  sourceDocumentIds: string[];
}

export interface BlueprintEffectPreviewBrowserPreview {
  id: string;
  title: string;
  summary: string;
  routeId?: string;
  nodeId: string;
  url: string;
}

export interface BlueprintEffectPreviewRuntimeProjection {
  id: string;
  jobId: string;
  projectId?: string;
  routeSetId: string;
  routeId?: string;
  specTreeId: string;
  nodeId: string;
  effectPreviewId: string;
  sceneSnapshotId: string;
  hudState: BlueprintEffectPreviewHudState;
  logTimeline: BlueprintEffectPreviewLogEntry[];
  browserPreviewId: string;
  browserPreview: BlueprintEffectPreviewBrowserPreview;
  sourceIds: Partial<BlueprintArtifactSourceIds>;
}

export type BlueprintEffectPreviewVersionStatus =
  | "current"
  | "archived"
  | "accepted"
  | "rejected";

export interface BlueprintEffectPreviewNodeProgress {
  nodeId: string;
  status: BlueprintSpecTreeNodeStatus;
  completionPercent: number;
  dependencyIds: string[];
  outputIds: string[];
  updatedFromTreeVersion: number;
}

export interface BlueprintEffectPreviewDependencyOrderEntry {
  nodeId: string;
  title: string;
  status: BlueprintSpecTreeNodeStatus;
  order: number;
  dependencyIds: string[];
}

export interface BlueprintEffectPreviewVersionSync {
  version?: number;
  versionStatus?: BlueprintEffectPreviewVersionStatus;
  supersedesPreviewId?: string;
  previousPreviewIds?: string[];
  preservedPreviewIds?: string[];
  refreshedFromSpecTreeVersion?: number;
  refreshedAt?: string;
  sourceSnapshotHash?: string;
  nodeProgress: BlueprintEffectPreviewNodeProgress;
  dependencyOrder: BlueprintEffectPreviewDependencyOrderEntry[];
}

/**
 * `autopilot-image-rendering-and-visual-system` spec Task 1.1：
 * Stage C effect preview 出图链路的 6 级降级层级，按优先级顺序排列。
 * 任意层级一旦命中后续层级不再判定，且高优先级 tier 永远不会被低优先级
 * tier 覆盖（设计文档 §Tier 优先级 / 需求 6.1）。
 */
export type FallbackTier =
  | "env-disabled"
  | "key-missing"
  | "timeout"
  | "quota"
  | "moderation"
  | "upstream-failure";

/**
 * `autopilot-image-rendering-and-visual-system` spec Task 1.1：
 * 单节点最近一次成功生成的 base64 图像记录。base64 数据持久化到
 * `BlueprintEffectPreview.imageBase64ByNodeId` 字段，而非浏览器
 * `localStorage`（需求 8.1）。
 */
export interface NodeImageRecord {
  /** Image bytes encoded as base64 (no `data:` prefix). */
  b64: string;
  /** MIME type returned by the upstream image API, e.g. `"image/png"`. */
  mimeType: string;
  /** The exact prompt string that was sent to the image API for this node. */
  promptUsed: string;
  /** ISO8601 timestamp when the image was generated. */
  generatedAt: string;
  /**
   * 图片来源元数据（`blueprint-v4-full-alignment` Module F / R19.5）。
   * 供出图审计（Module E）消费。可选以保持向后兼容。
   */
  provenance?: import("./preview-audit/types.js").BlueprintPreviewProvenance;
}

export interface BlueprintEffectPreview {
  id: string;
  jobId: string;
  treeId: string;
  nodeId: string;
  version: number;
  versionStatus: BlueprintEffectPreviewVersionStatus;
  supersedesPreviewId?: string;
  previousPreviewIds: string[];
  preservedPreviewIds: string[];
  refreshedFromSpecTreeVersion: number;
  refreshedAt: string;
  sourceSnapshotHash: string;
  sourceDocumentIds: string[];
  status: BlueprintEffectPreviewStatus;
  createdAt: string;
  updatedAt?: string;
  summary: string;
  architectureNotes: string[];
  prototypeNotes: string[];
  progressPlan: BlueprintEffectPreviewMilestone[];
  nodes: BlueprintEffectPreviewNode[];
  runtimeProjection: BlueprintEffectPreviewRuntimeProjection;
  nodeProgress?: BlueprintEffectPreviewNodeProgress;
  dependencyOrder?: BlueprintEffectPreviewDependencyOrderEntry[];
  versionSync?: BlueprintEffectPreviewVersionSync;
  /**
   * `autopilot-image-rendering-and-visual-system` spec Task 1.1：
   * Stage C 第 2 步生成的 SVG 架构草图字符串，独立于 raster 图像存储。
   * 字段缺失表示 SVG 阶段未产出有效草图（被跳过或失败降级）。
   * 设计要求该字段与 `imageBase64ByNodeId` 在同一 preview 上严格分离
   * （需求 3.3）。
   */
  architectureSvgDraft?: string;
  /**
   * `autopilot-image-rendering-and-visual-system` spec Task 1.1：
   * 节点 ID → 该节点最近一次成功生成的 base64 图像记录映射。
   * 字段缺失或键不存在表示该节点尚未成功出图（pending、失败或
   * `textOnlyEffectPreview` 兜底）。
   * 仅服务端 `ImageService` 写入，浏览器侧不直接修改（需求 1.3 / 8.1）。
   */
  imageBase64ByNodeId?: Record<string, NodeImageRecord>;
  previewImageMetas?: import("./preview-audit/types.js").PreviewImageMeta[];
  /**
   * `autopilot-image-rendering-and-visual-system` spec Task 1.1：
   * 任意 fallback 触发或 `specDocuments` 为空时写入；与
   * `progressPlan[].fallbackTier` 配合，构成 effect preview 的最终
   * textOnly 兜底视图（需求 1.2 / 6.4）。
   */
  textOnlyEffectPreview?: {
    /** 是否已退化为纯文本预览。任意 fallback 触发后置为 `true`。 */
    active: boolean;
    /**
     * 触发文本兜底的原因。`"empty-spec"` 表示 spec_documents 缺失或为空，
     * 直接跳过 Stage C；其余值映射到 6 级降级 `FallbackTier`。
     */
    reason: FallbackTier | "empty-spec";
    /** 可读错误摘要；不含密钥、原始 prompt 或浏览器侧 PII。 */
    errorSummary?: string;
  };
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    targetText?: string;
    githubUrls: string[];
    treeVersion: number;
    nodeType: BlueprintSpecTreeNodeType;
    nodeTitle: string;
    nodeSummary: string;
    sourceStatus: BlueprintEffectPreviewSourceStatus;
    includeDrafts: boolean;
    sourceDocumentStatuses: Record<string, BlueprintSpecDocumentStatus>;
    /**
     * Which generation path produced this preview.
     *
     * Added by `autopilot-effect-preview-llm` spec (design §4.9 / §2.D6).
     * When `"llm"`, the `summary` / `architectureNotes` / `prototypeNotes` /
     * `progressPlan` / `runtimeProjection.hudState` / `consoleLines` /
     * `logTimeline` / `browserPreview?` content fields were derived from
     * an LLM invocation and the `promptId` / `model` / `*Digest` / `error`
     * fields below describe that invocation. When `"llm_fallback"`, the
     * LLM was attempted but failed (schema / timeout / throw / api-key
     * missing mid-invocation) and the content fields fall back to the
     * templated path with `error` redacted and capped. When `"template"`,
     * the LLM was never attempted (feature-flag off or apiKey missing
     * up-front); `error` / `promptId` / `model` stay undefined.
     *
     * Always optional — preserves backward compatibility with any existing
     * consumer that pre-dates this spec (requirement 4.2 / 8.2).
     */
    generationSource?: "llm" | "llm_fallback" | "template";
    /**
     * Stable prompt-version identifier (currently pinned to
     * `"blueprint.effect-preview.v1"`). Filled whenever `generationSource`
     * is `"llm"` or `"llm_fallback"` (the prompt was successfully
     * constructed before the invocation).
     */
    promptId?: string;
    /**
     * LLM model identifier read from `ctx.llm.getConfig().model` at
     * invocation time. Filled whenever the LLM call was attempted (`"llm"`
     * or `"llm_fallback"`).
     */
    model?: string;
    /**
     * `"sha256:<hex>"` digest of the raw LLM JSON response. Filled only on
     * the real path (`generationSource === "llm"`) for response-level
     * auditing.
     */
    responseDigest?: string;
    /**
     * `"sha256:<hex>"` digest of the zod-validated + normalised payload
     * (`parsed.data`). Filled only on the real path; stable across equal
     * structured payloads even when the raw response changed whitespace.
     */
    structuredPayloadDigest?: string;
    /**
     * `"sha256:<hex>"` digest of the prompt (system + user messages).
     * Filled whenever the prompt was constructed (`"llm"` or
     * `"llm_fallback"`).
     */
    promptFingerprint?: string;
    /**
     * Redacted + length-capped error description. Filled only on the
     * fallback path (`generationSource === "llm_fallback"`); secrets
     * (API keys, GitHub PATs, emails) are scrubbed via
     * `applyEffectPreviewRedaction` before persisting.
     */
    error?: string;
  };
}

export interface BlueprintImplementationPromptTarget {
  platform: BlueprintImplementationPromptTargetPlatform;
  label: string;
  executionMode: "agent" | "chat" | "workspace";
  guidance: string;
}

export interface BlueprintImplementationPromptItem {
  id: string;
  kind: BlueprintImplementationPromptItemKind;
  title: string;
  content: string;
  nodeIds: string[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
}

export interface BlueprintImplementationPromptSection {
  id: string;
  kind: BlueprintImplementationPromptSectionKind;
  title: string;
  content: string;
  items: BlueprintImplementationPromptItem[];
  nodeIds: string[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
}

export interface BlueprintImplementationPromptPackage {
  id: string;
  jobId: string;
  treeId: string;
  nodeIds: string[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
  targetPlatform: BlueprintImplementationPromptTargetPlatform;
  target: BlueprintImplementationPromptTarget;
  title: string;
  summary: string;
  content: string;
  sections: BlueprintImplementationPromptSection[];
  createdAt: string;
  updatedAt?: string;
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    targetText?: string;
    githubUrls: string[];
    treeVersion: number;
    nodeIds: string[];
    sourceDocumentIds: string[];
    sourcePreviewIds: string[];
    targetPlatform: BlueprintImplementationPromptTargetPlatform;
    sourceDocumentStatus: BlueprintImplementationPromptSourceStatus;
    sourcePreviewStatus: BlueprintImplementationPromptSourceStatus;
    includeDrafts: boolean;
    includePreviewDrafts: boolean;
    sourceDocumentStatuses: Record<string, BlueprintSpecDocumentStatus>;
    sourcePreviewStatuses: Record<string, BlueprintEffectPreviewStatus>;
    /**
     * LLM-driven Prompt Package generation source.
     *
     * - `"llm"`: LLM returned a structured payload that passed strict zod +
     *   `.superRefine()` invariants; `title` / `summary` / `content` /
     *   `sections[*].title` / `sections[*].content` are LLM-derived.
     * - `"llm_fallback"`: LLM was invoked but the call threw / returned
     *   non-JSON / failed schema or invariant validation / timed out; the
     *   templated output from `buildImplementationPromptPackage()` was used
     *   byte-for-byte. `error` is populated with a redacted reason.
     * - `"template"`: LLM was never attempted (service not enabled, apiKey
     *   missing, or service not wired); the templated output was used.
     *
     * Added by `.kiro/specs/autopilot-prompt-package-llm` (see §D6).
     */
    generationSource?: "llm" | "llm_fallback" | "template";
    /**
     * Meta-prompt version identifier used by the Prompt Package LLM
     * generator. Locked to `"blueprint.prompt-package.v1"`; bumps to `v2`
     * signal a breaking schema change. Populated when `generationSource` ∈
     * `{"llm", "llm_fallback"}` — i.e., whenever the LLM path was attempted.
     *
     * Distinct from the LLM-emitted `prompts[*].id` (asset-layer identifiers
     * rendered into `content` / `sections[*].items`); they are never mixed.
     */
    promptId?: string;
    /** Model name from `ctx.llm.getConfig().model`. Populated when LLM was invoked. */
    model?: string;
    /** `sha256:…` digest of the raw LLM response JSON. Populated on real path only. */
    responseDigest?: string;
    /** `sha256:…` digest of the normalized canonical payload. Populated on real path only. */
    structuredPayloadDigest?: string;
    /** `sha256:…` digest of the (system + user) prompt messages. Populated when LLM was invoked. */
    promptFingerprint?: string;
    /** Redacted, truncated error message. Populated when `generationSource === "llm_fallback"`. */
    error?: string;
  };
}

export interface BlueprintEngineeringLandingStep {
  id: string;
  title: string;
  summary: string;
  mode: BlueprintEngineeringLandingStepMode;
  sourceNodeIds: string[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
  promptPackageIds: string[];
  fileScopes: string[];
  verificationCommands: string[];
  riskLevel: BlueprintEngineeringLandingRiskLevel;
}

export interface BlueprintPlatformHandoff {
  id: string;
  platform: BlueprintImplementationPromptTargetPlatform;
  title: string;
  summary: string;
  content: string;
  promptPackageId: string;
  sourceNodeIds: string[];
  verificationCommands: string[];
}

export interface BlueprintEngineeringLandingPlan {
  id: string;
  jobId: string;
  treeId: string;
  status: BlueprintEngineeringLandingPlanStatus;
  title: string;
  summary: string;
  promptPackageIds: string[];
  steps: BlueprintEngineeringLandingStep[];
  handoffs: BlueprintPlatformHandoff[];
  createdAt: string;
  updatedAt: string;
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    targetText?: string;
    githubUrls: string[];
    treeVersion: number;
    promptPackageIds: string[];
    sourceNodeIds: string[];
    sourceDocumentIds: string[];
    sourcePreviewIds: string[];
    sourceDocumentStatus: BlueprintImplementationPromptSourceStatus;
    sourcePreviewStatus: BlueprintImplementationPromptSourceStatus;
    sourceDocumentStatuses: Record<string, BlueprintSpecDocumentStatus>;
    sourcePreviewStatuses: Record<string, BlueprintEffectPreviewStatus>;
    promptPackagePlatforms: Record<
      string,
      BlueprintImplementationPromptTargetPlatform
    >;
    /**
     * Engineering Handoff LLM provenance. See
     * `.kiro/specs/autopilot-engineering-handoff-llm/design.md` §4.9.
     * All seven fields are optional and only populated when the Engineering
     * Handoff LLM service was exercised (see §4.6 for tier mapping):
     * - `"llm"`: LLM-driven path succeeded.
     * - `"llm_fallback"`: LLM was attempted but the result was unusable; the
     *   generator returned templated output.
     * - `"template"`: LLM was not attempted (feature flag disabled or
     *   apiKey missing).
     */
    generationSource?: "llm" | "llm_fallback" | "template";
    /** Prompt version identifier, populated when LLM was attempted. */
    promptId?: string;
    /** Model identifier reported by ctx.llm.getConfig() when LLM was attempted. */
    model?: string;
    /** sha256 digest of the raw LLM JSON response (real path only). */
    responseDigest?: string;
    /** sha256 digest of the zod-validated / normalized payload (real path only). */
    structuredPayloadDigest?: string;
    /** sha256 fingerprint of (systemMessage + "\n\n" + userMessage). */
    promptFingerprint?: string;
    /** Redacted error message, populated only when generationSource === "llm_fallback". */
    error?: string;
  };
}

export interface BlueprintEngineeringVerificationResult {
  command: string;
  status: BlueprintEngineeringVerificationStatus;
  output?: string;
  durationMs?: number;
}

export interface BlueprintEngineeringRun {
  id: string;
  jobId: string;
  landingPlanId: string;
  status: BlueprintEngineeringRunStatus;
  startedAt?: string;
  completedAt?: string;
  summary: string;
  logs: string[];
  verificationResults: BlueprintEngineeringVerificationResult[];
  changedFiles: string[];
  promptPackageIds: string[];
  capabilityInvocationIds: string[];
  capabilityEvidenceIds: string[];
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    targetText?: string;
    githubUrls: string[];
    landingPlanId: string;
    treeId: string;
    treeVersion: number;
    promptPackageIds: string[];
    capabilityInvocationIds: string[];
    capabilityEvidenceIds: string[];
  };
}

export interface BlueprintReviewSpecDocumentRequest {
  status: "accepted" | "rejected" | "reviewing";
  reviewedBy?: string;
  reviewNote?: string;
}

export interface BlueprintReviewSpecDocumentResponse {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  document: BlueprintSpecDocument;
}

export interface BlueprintSaveSpecDocumentVersionResponse {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  document: BlueprintSpecDocument;
  version: BlueprintSpecDocumentVersionSnapshot;
}

export type BlueprintGenerationArtifactType =
  | "intake"
  | "github_source"
  | "clarification_session"
  | "project_context"
  | "route_set"
  | "route_selection"
  | "spec_tree"
  | "spec_tree_version"
  | "requirements"
  | "design"
  | "tasks"
  | "spec_document_version"
  | "brainstorm_reasoning_graph"
  | "preview"
  | "effect_preview"
  | "prompt_pack"
  | "capability_registry"
  | "agent_crew"
  | "role_timeline"
  | "capability_invocation"
  | "capability_evidence"
  | "sandbox_derivation_job"
  | "engineering_plan"
  | "engineering_run"
  | "replay"
  | "feedback";

export interface BlueprintGenerationArtifact {
  id: string;
  type: BlueprintGenerationArtifactType;
  title: string;
  summary: string;
  createdAt: string;
  payload?: unknown;
  staleSince?: string;
  invalidatedBy?: BlueprintStaleSource;
}

export interface BlueprintStaleSource {
  stage: BlueprintGenerationStage;
  artifactId: string;
  artifactType: BlueprintGenerationArtifactType;
  reason: BlueprintStaleReason;
  triggeredAt: string;
}

export interface BlueprintIntakePatchRequest {
  targetText?: string;
  githubUrls?: string[];
  reason?: string;
}

export interface BlueprintStaleEditResultSummary {
  fromStage: BlueprintGenerationStage;
  newlyStaleArtifactIds: string[];
  newlyStaleArtifactCount: number;
  staleArtifactIdsSnapshot: string[];
}

export interface BlueprintGenerationArtifactLink {
  artifactId: string;
  artifactType: BlueprintGenerationArtifactType;
  relation:
    | "source"
    | "selection"
    | "handoff"
    | "evidence"
    | "derived";
  title?: string;
}

export interface BlueprintGenerationNextActionOption {
  id: BlueprintGenerationNextActionId;
  type: BlueprintGenerationNextActionType;
  label: string;
  stage: BlueprintGenerationStage;
  required: boolean;
  artifactId?: string;
  routeId?: string;
  selectionId?: string;
  selectedPathId?: string;
  specTreeId?: string;
  nodeId?: string;
}

export interface BlueprintReviewHandoffState {
  id: string;
  stage: BlueprintGenerationStage;
  status: BlueprintGenerationStatus;
  confirmable: boolean;
  editable: boolean;
  resumable: boolean;
  routeId: string;
  selectionId: string;
  selectedPathId: string;
  specTreeId: string;
  nodeId?: string;
  artifactId?: string;
  artifactLinks: BlueprintGenerationArtifactLink[];
  downstreamMenus: BlueprintGenerationStage[];
  provenance: {
    jobId: string;
    projectId?: string;
    sourceId?: string;
    routeSetId: string;
    routeId: string;
    selectionId: string;
    selectedPathId: string;
    specTreeId: string;
  };
}

export interface BlueprintGenerationNextAction {
  type: BlueprintGenerationNextActionType;
  label: string;
  stage: BlueprintGenerationStage;
  artifactId?: string;
  routeId?: string;
  selectionId?: string;
  specTreeId?: string;
  nodeId?: string;
  required: boolean;
  actions?: BlueprintGenerationNextActionOption[];
  handoff?: BlueprintReviewHandoffState;
}

/**
 * 蓝图栈作业级的显式交接态标识。
 *
 * - `idle`：未进入任何交接等待；常态下的 autopilot / planning / execution。
 * - `reviewing`：已生成可评审的资产（RouteSet、SPEC Tree、SPEC Document 等）并等待用户确认或编辑；
 *   在本 spec 中作为"已完成但未拍板"的显式状态，与隐式的"一段时间无下一步事件"区分开。
 * - `confirmed`：用户确认了 reviewing 交接（例如 SPEC Document 全部 `accepted`），推进到下一阶段。
 * - `reset`：用户撤回交接（例如 `DELETE /route-selection`），回到上一阶段重新生成。
 * - `failed`：交接期间发生失败，需要人工或运行时介入后才能继续。
 *
 * 该字段属于"新增可选字段"范畴：既有响应结构不变，默认值 `undefined`。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split` 需求 4.1 / 4.3 / 6.2。
 */
export type BlueprintHandoffState =
  | "idle"
  | "reviewing"
  | "confirmed"
  | "reset"
  | "failed";

/**
 * 当 `BlueprintGenerationStageState.status === "reviewing"` 时的显式描述。
 *
 * 设计要点：
 * 1. `state` 固定为 `"reviewing"`，避免与 `BlueprintHandoffState` 的其它值混用。
 * 2. `stage` 明确指向发起 reviewing 的阶段；主生产者是 `route_generation` 与 `spec_tree`。
 * 3. `selectedPathId` / `routeId` / `selectionId` / `specTreeId` / `nodeId` 对应现有 provenance 字段，便于下游 Artifact Replay 直接反查。
 * 4. `enteredAt` 必须来自 `ctx.now().toISOString()`，不使用前端时钟。
 * 5. `confirmable` 镜像现有 `BlueprintReviewHandoffState.confirmable`，前端面板据此决定是否渲染"确认并继续"按钮。
 *
 * 与 `BlueprintReviewHandoffState` 的分工：
 * - `BlueprintReviewHandoffState` 描述"下一步可用的处理动作"，长期保留；
 * - `BlueprintReviewingHandoff` 描述"当前处于 reviewing 状态"的稳定显式标识。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split` 需求 4.1 / 4.3 / 4.4。
 */
export interface BlueprintReviewingHandoff {
  state: "reviewing";
  stage: BlueprintGenerationStage;
  selectedPathId: string;
  routeId: string;
  selectionId?: string;
  specTreeId?: string;
  nodeId?: string;
  enteredAt: string;
  confirmable: boolean;
}

export interface BlueprintGenerationStageState {
  stage: BlueprintGenerationStage;
  status: BlueprintGenerationStatus;
  payloadKind: BlueprintGenerationStagePayloadKind;
  artifactIds: string[];
  nextAction?: BlueprintGenerationNextAction;
  /**
   * 显式 `reviewing` 交接态描述。仅在 `status === "reviewing"` 时出现；其它状态下为 `undefined`。
   * 新增可选字段，保持对既有 51 条 `blueprint-routes.test.ts` 用例的向后兼容。
   */
  reviewingHandoff?: BlueprintReviewingHandoff;
}

// `BlueprintGenerationEventType` 的真相源见 `./events.ts`；此处仅保留顶部 re-export
// 供历史 import 路径使用：`import { BlueprintGenerationEventType } from "@shared/blueprint/contracts"`。

export interface BlueprintGenerationEvent {
  id: string;
  jobId: string;
  projectId?: string;
  type: BlueprintGenerationEventType;
  family: BlueprintGenerationEventFamily;
  stage: BlueprintGenerationStage;
  status: BlueprintGenerationStatus;
  message: string;
  occurredAt: string;
  routeId?: string;
  selectionId?: string;
  specTreeId?: string;
  nodeId?: string;
  artifactId?: string;
  roleId?: string;
  presenceState?: BlueprintRolePresenceState;
  capabilityId?: string;
  evidenceId?: string;
  /**
   * `autopilot-agent-reasoning-stream` spec Task 2.5 新增的 12 个可选顶层字段。
   *
   * 设计要点：
   * - 这些字段只在 `role.agent.*` 事件上由 Agent_Reasoning_Bridge 显式填充，
   *   其它 11 个家族的现有事件继续保持 shape 不变（不传即等价于 `undefined`）。
   * - 全部声明为 `optional`，避免破坏既有 51 条 blueprint-routes 测试断言与
   *   5140+ 个 server 测试中对该结构的字面量构造（不需要在历史测试里补 `undefined`）。
   * - 不引入 `discriminated union`：现有大量消费方按 `event.type` 字符串分支，
   *   union narrowing 改造会扩大 TS 基线 113 个错误的影响面；改为开放可选字段
   *   是 Layer 4 view model（`buildEntryFromSocketEvent`）已经预期的形态。
   * - 字段语义详见 `shared/blueprint/agent-reasoning.ts`，与 `AgentReasoningEntry`
   *   保持 1:1 对齐，仅新增 `roleId`/`stageId`（已存在 `roleId`，故只补 `stageId`）。
   */
  iteration?: number;
  stageId?: string;
  thought?: string;
  actionToolId?: string;
  observationSuccess?: boolean;
  observationSummary?: string;
  error?: string;
  degraded?: boolean;
  reason?: string;
  tokensUsed?: number;
  budgetRemaining?: number;
  payload?: unknown;
}

export interface BlueprintGenerationJob {
  id: string;
  request: BlueprintGenerationRequest;
  status: BlueprintGenerationStatus;
  stage: BlueprintGenerationStage;
  projectId?: string;
  sourceId?: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  artifacts: BlueprintGenerationArtifact[];
  events: BlueprintGenerationEvent[];
  stageState?: BlueprintGenerationStageState;
  nextAction?: BlueprintGenerationNextAction;
  parentJobId?: string;
  branchedAt?: string;
  branchedFromStage?: BlueprintGenerationStage;
  /**
   * 显式作业级交接态。默认值 `undefined`（即 `idle`），在 reviewing / confirmed / reset / failed
   * 路径上由服务端显式写入，避免前端需要根据"一段时间无下一步事件"去推断。
   * 新增可选字段，保持向后兼容。
   */
  handoffState?: BlueprintHandoffState;
  error?: {
    code: string;
    message: string;
    stage: BlueprintGenerationStage;
  };
  staleArtifactIds?: string[];
  /** 校验台账条目（可选，append-only）。由 `blueprint-checks-ledger` spec 引入。 */
  checksLedger?: import("./checks-ledger/types.js").BlueprintChecksLedgerEntry[];
  /**
   * 伴随层发现（可选）。由 `blueprint-v4-full-alignment` Module A 引入。
   * 仅 warn/error 级 finding 进入此数组，供交付/评审视图露出（R2.8/R3.8）。
   */
  companionFindings?: import("./companion/types.js").CompanionFinding[];
}

export interface BlueprintFamilyResponse {
  rootJobId: string;
  jobs: BlueprintGenerationJob[];
  replanEvents: BlueprintGenerationEvent[];
}

export type BlueprintArtifactMemoryType =
  | BlueprintGenerationArtifactType
  | "event";

export interface BlueprintArtifactSourceIds {
  projectId?: string;
  routeSetId?: string;
  specTreeId?: string;
  nodeIds: string[];
  specDocumentIds: string[];
  effectPreviewIds: string[];
  promptPackageIds: string[];
  capabilityInvocationIds: string[];
  capabilityEvidenceIds: string[];
  landingPlanIds: string[];
  engineeringRunIds: string[];
  capabilityIds: string[];
  roleIds: string[];
  crewIds: string[];
}

export type BlueprintArtifactPayloadSummary = Record<
  string,
  string | number | boolean | string[] | number[] | null
>;

export interface BlueprintArtifactMemoryEntry {
  id: string;
  jobId: string;
  artifactId: string;
  artifactType: BlueprintArtifactMemoryType;
  stage: BlueprintGenerationStage;
  title: string;
  summary: string;
  createdAt: string;
  sourceIds: BlueprintArtifactSourceIds;
  version: number;
  tags: string[];
  payloadSummary: BlueprintArtifactPayloadSummary;
}

export interface BlueprintArtifactReplayTimelineEntry {
  id: string;
  entryId: string;
  artifactId: string;
  artifactType: BlueprintArtifactMemoryType;
  stage: BlueprintGenerationStage;
  title: string;
  summary: string;
  occurredAt: string;
  tags: string[];
}

export interface BlueprintArtifactLineageEdge {
  id: string;
  fromEntryId: string;
  toEntryId: string;
  sourceId: string;
  sourceType:
    | "route_set"
    | "project"
    | "spec_tree"
    | "spec_node"
    | "spec_document"
    | "effect_preview"
    | "prompt_package"
    | "capability_registry"
    | "agent_crew"
    | "role"
    | "crew"
    | "role_timeline"
    | "capability_invocation"
    | "capability_evidence"
    | "sandbox_derivation_job"
    | "landing_plan"
    | "engineering_run";
  relation: "derived_from" | "records" | "references";
}

export interface BlueprintArtifactEvolutionRouteSet {
  routeSetId: string;
  routeCount: number;
  primaryRouteId?: string;
  selectedRouteId?: string;
  selectedPathId?: string;
  selectionId?: string;
  selectedBy?: string;
  reason?: string;
  mergedAlternativeRouteIds: string[];
  createdAt?: string;
  selectedAt?: string;
}

export interface BlueprintArtifactEvolutionSpecTree {
  specTreeId: string;
  selectionId?: string;
  selectedPathId?: string;
  routeId?: string;
  version: number;
  status: BlueprintSpecTreeStatus;
  rootNodeId: string;
  nodeCount: number;
  updatedAt: string;
  versionId?: string;
}

export interface BlueprintArtifactEvolutionSpecDocument {
  documentId: string;
  sourceDocumentId?: string;
  nodeId: string;
  type: BlueprintSpecDocumentType;
  version: number;
  status: BlueprintSpecDocumentStatus;
  updatedAt: string;
  reviewedBy?: string;
  reviewNote?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  versionId?: string;
}

export interface BlueprintArtifactEvolutionEffectPreview {
  previewId: string;
  nodeId: string;
  version: number;
  versionStatus: BlueprintEffectPreviewVersionStatus;
  status: BlueprintEffectPreviewStatus;
  sourceDocumentIds: string[];
  sourceSnapshotHash: string;
  refreshedFromSpecTreeVersion: number;
  updatedAt: string;
  previousPreviewIds: string[];
  preservedPreviewIds: string[];
}

export interface BlueprintArtifactEvolutionPromptPackage {
  promptPackageId: string;
  targetPlatform: BlueprintImplementationPromptTargetPlatform;
  nodeIds: string[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
  sectionKinds: BlueprintImplementationPromptSectionKind[];
  createdAt: string;
}

export interface BlueprintArtifactEvolutionReplay {
  routeSets: BlueprintArtifactEvolutionRouteSet[];
  specTrees: BlueprintArtifactEvolutionSpecTree[];
  specDocuments: BlueprintArtifactEvolutionSpecDocument[];
  effectPreviews: BlueprintArtifactEvolutionEffectPreview[];
  promptPackages: BlueprintArtifactEvolutionPromptPackage[];
}

export interface BlueprintArtifactReplayConfirmationDecision {
  id: string;
  kind: "route_selection" | "spec_tree_version" | "spec_document_review" | "spec_document_version";
  artifactId?: string;
  routeId?: string;
  selectedPathId?: string;
  selectionId?: string;
  specTreeId?: string;
  documentId?: string;
  status?: string;
  decidedBy?: string;
  note?: string;
  occurredAt: string;
}

export interface BlueprintArtifactReplayHandoffDecision {
  id: string;
  kind: "prompt_package" | "engineering_plan" | "mission_handoff" | "engineering_run";
  artifactId?: string;
  eventId?: string;
  promptPackageIds: string[];
  landingPlanIds: string[];
  platform?: BlueprintImplementationPromptTargetPlatform;
  status?: string;
  occurredAt: string;
  summary: string;
}

export interface BlueprintArtifactDecisionReplay {
  confirmations: BlueprintArtifactReplayConfirmationDecision[];
  handoffs: BlueprintArtifactReplayHandoffDecision[];
}

export interface BlueprintArtifactReplaySnapshot {
  id: string;
  jobId: string;
  createdAt: string;
  timelineEntries: BlueprintArtifactReplayTimelineEntry[];
  stageCounts: Record<BlueprintGenerationStage, number>;
  lineageEdges: BlueprintArtifactLineageEdge[];
  artifactEvolution?: BlueprintArtifactEvolutionReplay;
  decisions?: BlueprintArtifactDecisionReplay;
}

export interface BlueprintArtifactDiff {
  id: string;
  leftEntryId: string;
  rightEntryId: string;
  changedFields: string[];
  summary: string;
}

export type BlueprintArtifactFeedbackKind = "feedback" | "backfill";

export interface BlueprintArtifactFeedback {
  id: string;
  jobId: string;
  entryId: string;
  artifactId: string;
  artifactType: BlueprintArtifactMemoryType;
  kind: BlueprintArtifactFeedbackKind;
  message: string;
  summary: string;
  createdAt: string;
  createdBy?: string;
  tags: string[];
  sourceIds: BlueprintArtifactSourceIds;
  payloadSummary: BlueprintArtifactPayloadSummary;
}

export interface BlueprintArtifactLedgerResponse {
  job: BlueprintGenerationJob;
  entries: BlueprintArtifactMemoryEntry[];
}

export interface BlueprintCapabilityRegistryResponse {
  capabilities: BlueprintRuntimeCapability[];
  agentCrew: BlueprintAgentCrew;
}

export interface BlueprintCapabilityInvocationsResponse {
  job: BlueprintGenerationJob;
  routeSet?: BlueprintRouteSet;
  specTree?: BlueprintSpecTree;
  capabilities: BlueprintRuntimeCapability[];
  agentCrew?: BlueprintAgentCrew;
  invocations: BlueprintCapabilityInvocation[];
}

export interface BlueprintCapabilityEvidenceResponse {
  job: BlueprintGenerationJob;
  routeSet?: BlueprintRouteSet;
  specTree?: BlueprintSpecTree;
  evidence: BlueprintCapabilityEvidence[];
}

export interface BlueprintInvokeCapabilityResponse {
  job: BlueprintGenerationJob;
  routeSet?: BlueprintRouteSet;
  specTree?: BlueprintSpecTree;
  capability: BlueprintRuntimeCapability;
  agentCrew?: BlueprintAgentCrew;
  invocation: BlueprintCapabilityInvocation;
  evidence: BlueprintCapabilityEvidence;
}

export interface BlueprintSandboxDerivationJobResponse {
  job: BlueprintGenerationJob;
  routeSet?: BlueprintRouteSet;
  specTree?: BlueprintSpecTree;
  agentCrew?: BlueprintAgentCrew;
  sandboxDerivationJob: BlueprintSandboxDerivationJob;
  invocations: BlueprintCapabilityInvocation[];
  evidence: BlueprintCapabilityEvidence[];
}

export interface BlueprintSandboxDerivationJobsResponse {
  job: BlueprintGenerationJob;
  routeSet?: BlueprintRouteSet;
  specTree?: BlueprintSpecTree;
  sandboxDerivationJobs: BlueprintSandboxDerivationJob[];
}

export interface BlueprintAgentCrewResponse {
  job: BlueprintGenerationJob;
  routeSet?: BlueprintRouteSet;
  specTree?: BlueprintSpecTree;
  agentCrew: BlueprintAgentCrew;
  roleTimelines?: BlueprintRoleTimeline[];
}

export interface BlueprintRoleTimelineFilters {
  jobId?: string;
  roleId?: string;
  stage?: BlueprintGenerationStage;
  routeId?: string;
  nodeId?: string;
  artifactId?: string;
  capabilityId?: string;
  from?: string;
  to?: string;
}

export interface BlueprintRoleTimelinesResponse {
  job: BlueprintGenerationJob;
  routeSet?: BlueprintRouteSet;
  specTree?: BlueprintSpecTree;
  agentCrew?: BlueprintAgentCrew;
  roleTimelines: BlueprintRoleTimeline[];
  filters?: BlueprintRoleTimelineFilters;
}

export interface BlueprintFetchCapabilityInvocationsRequest {
  capabilityId?: string;
  nodeId?: string;
  routeId?: string;
}

export interface BlueprintFetchCapabilityEvidenceRequest {
  capabilityId?: string;
  nodeId?: string;
  routeId?: string;
}

export interface BlueprintCreateArtifactReplayRequest {
  title?: string;
  summary?: string;
  tags?: string[];
}

export interface BlueprintArtifactReplayResponse {
  job: BlueprintGenerationJob;
  replay: BlueprintArtifactReplaySnapshot;
}

export interface BlueprintArtifactReplaysResponse {
  job: BlueprintGenerationJob;
  replays: BlueprintArtifactReplaySnapshot[];
}

export interface BlueprintArtifactDiffRequest {
  leftEntryId: string;
  rightEntryId: string;
}

export interface BlueprintArtifactDiffResponse {
  job: BlueprintGenerationJob;
  diff: BlueprintArtifactDiff;
}

export interface BlueprintArtifactFeedbackRequest {
  entryId?: string;
  artifactId?: string;
  kind?: BlueprintArtifactFeedbackKind;
  message?: string;
  summary?: string;
  createdBy?: string;
  tags?: string[];
  sourceIds?: Partial<BlueprintArtifactSourceIds>;
  payloadSummary?: BlueprintArtifactPayloadSummary;
}

export interface BlueprintArtifactFeedbackResponse {
  job: BlueprintGenerationJob;
  feedback: BlueprintArtifactFeedback;
}

export interface BlueprintCreateGenerationJobResponse {
  job: BlueprintGenerationJob;
  routeSet?: BlueprintRouteSet;
  intake?: BlueprintIntake;
  clarificationSession?: BlueprintClarificationSession;
  projectContext?: BlueprintProjectDomainContext;
}

export interface BlueprintGenerationEventsResponse {
  job: BlueprintGenerationJob;
  events: BlueprintGenerationEvent[];
  filters?: BlueprintGenerationEventFilters;
}

export interface BlueprintGenerationEventFilters {
  jobId?: string;
  stage?: BlueprintGenerationStage;
  family?: BlueprintGenerationEventFamily;
  routeId?: string;
  nodeId?: string;
  artifactId?: string;
  roleId?: string;
  capabilityId?: string;
  evidenceId?: string;
}

export interface BlueprintSelectRouteResponse {
  job: BlueprintGenerationJob;
  routeSet: BlueprintRouteSet;
  selection: BlueprintRouteSelection;
  specTree: BlueprintSpecTree;
}

export interface BlueprintResetRouteSelectionResponse {
  job: BlueprintGenerationJob;
  routeSet: BlueprintRouteSet;
}

export interface BlueprintUpdateSpecTreeNodeResponse {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  node: BlueprintSpecTreeNode;
}

export interface BlueprintSpecTreeActionResponse {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  node?: BlueprintSpecTreeNode;
  version?: BlueprintSpecTreeVersionSnapshot;
}

export interface BlueprintSaveSpecTreeVersionResponse {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  version: BlueprintSpecTreeVersionSnapshot;
}

export interface BlueprintSpecDocumentsResponse {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  documents: BlueprintSpecDocument[];
}

export interface BlueprintEffectPreviewsResponse {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  effectPreviews: BlueprintEffectPreview[];
}

export interface BlueprintImplementationPromptPackagesResponse {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  promptPackages: BlueprintImplementationPromptPackage[];
}

export interface BlueprintEngineeringLandingPlansResponse {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  landingPlans: BlueprintEngineeringLandingPlan[];
  engineeringLandingPlans: BlueprintEngineeringLandingPlan[];
}

export interface BlueprintEngineeringRunsResponse {
  job: BlueprintGenerationJob;
  engineeringLandingPlans: BlueprintEngineeringLandingPlan[];
  engineeringRuns: BlueprintEngineeringRun[];
}

export interface BlueprintRecordEngineeringRunResponse {
  job: BlueprintGenerationJob;
  engineeringLandingPlan: BlueprintEngineeringLandingPlan;
  engineeringRun: BlueprintEngineeringRun;
}

export interface BlueprintGenerateSpecDocumentsRequest {
  nodeId?: string;
  types?: BlueprintSpecDocumentType[];
  /** User's preferred locale for LLM-generated content. Defaults to "en-US" on the backend. */
  locale?: "zh-CN" | "en-US";
}

export interface BlueprintGenerateEffectPreviewsRequest {
  nodeId?: string;
  includeDrafts?: boolean;
}

export interface BlueprintGenerateImplementationPromptPackagesRequest {
  nodeId?: string;
  targetPlatforms?: BlueprintImplementationPromptTargetPlatform[];
  includeDrafts?: boolean;
  includePreviewDrafts?: boolean;
}

export interface BlueprintGenerateEngineeringLandingPlansRequest {
  promptPackageId?: string;
  targetPlatform?: BlueprintImplementationPromptTargetPlatform;
  targetPlatforms?: BlueprintImplementationPromptTargetPlatform[];
}

export interface BlueprintRecordEngineeringRunRequest {
  landingPlanId: string;
  status?: BlueprintEngineeringRunStatus;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  logs?: string[];
  verificationResults?: BlueprintEngineeringVerificationResult[];
  changedFiles?: string[];
  promptPackageIds?: string[];
  capabilityInvocationIds?: string[];
  capabilityEvidenceIds?: string[];
}

export interface BlueprintLatestGenerationJobResponse {
  job: BlueprintGenerationJob | null;
  routeSet?: BlueprintRouteSet;
  selection?: BlueprintRouteSelection;
  specTree?: BlueprintSpecTree;
  intake?: BlueprintIntake;
  clarificationSession?: BlueprintClarificationSession;
  projectContext?: BlueprintProjectDomainContext;
  specTreeVersions?: BlueprintSpecTreeVersionSnapshot[];
  specDocuments?: BlueprintSpecDocument[];
  specDocumentVersions?: BlueprintSpecDocumentVersionSnapshot[];
  effectPreviews?: BlueprintEffectPreview[];
  promptPackages?: BlueprintImplementationPromptPackage[];
  capabilities?: BlueprintRuntimeCapability[];
  agentCrew?: BlueprintAgentCrew;
  roleTimelines?: BlueprintRoleTimeline[];
  capabilityInvocations?: BlueprintCapabilityInvocation[];
  capabilityEvidence?: BlueprintCapabilityEvidence[];
  sandboxDerivationJobs?: BlueprintSandboxDerivationJob[];
  landingPlans?: BlueprintEngineeringLandingPlan[];
  engineeringLandingPlans?: BlueprintEngineeringLandingPlan[];
  engineeringRuns?: BlueprintEngineeringRun[];
  artifactLedgerEntries?: BlueprintArtifactMemoryEntry[];
  artifactReplays?: BlueprintArtifactReplaySnapshot[];
  artifactFeedback?: BlueprintArtifactFeedback[];
}
