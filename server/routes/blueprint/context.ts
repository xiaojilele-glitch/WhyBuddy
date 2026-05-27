/**
 * `BlueprintServiceContext`：蓝图栈统一的运行期依赖容器。
 *
 * 本文件是 wt1 引入的共享上下文，8 个子域服务将在后续任务（任务 6-13）
 * 逐步迁出 `server/routes/blueprint.ts`，并改为通过本 context 获取依赖，
 * 不再直接 `import` 模块级单例（`defaultJobStore`、`blueprintStores`）。
 *
 * 本轮任务 4 只定义类型与工厂，不立即切走现有 `createBlueprintRouter` 的装配路径；
 * 任务 14 合并阶段再把 `createBlueprintRouter(deps)` 内部切到 `buildBlueprintServiceContext(deps)`。
 *
 * 对应 `.kiro/specs/autopilot-blueprint-refactor-split`：
 * - 需求 3.1（Context 包含全部子域所需的运行期依赖，每一项可替换）
 * - 需求 3.3（`createBlueprintRouter(deps)` 未显式提供 Context 时能自行构建默认值）
 * - 需求 3.4（`BlueprintJobStore` 工厂收敛为默认实现来源，不并存多套竞争实现）
 * - 需求 3.5（`blueprintStores` 与 `BlueprintJobStore` 的抽象边界）
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { getAIConfig, type AIConfig } from "../../core/ai-config.js";
import { callLLMJson } from "../../core/llm-client.js";
import type { ExecutorClient } from "../../core/executor-client.js";
import { buildCallbackUrl } from "../../core/execution-bridge.js";
import {
  createFileBlueprintJobStore,
  type BlueprintJobStore,
} from "./job-store.js";
import {
  createBlueprintRuntimeDiagnosticsStore,
  type BlueprintRuntimeDiagnosticsStore,
} from "./runtime-enablement/diagnostics-store.js";
import { resolveDefaultExecutorClient } from "./runtime-enablement/executor-factory.js";
import { attachDiagnosticsSubscriber } from "./runtime-enablement/subscriber.js";
import {
  createInMemoryRoleRuntimeContextStore,
  createRoleContainerLoader,
  type RoleContainerLoader,
  type RoleRuntimeContextStore,
} from "./role-container-loader/loader.js";
import { createLiteAgentAigcNodeInvoker } from "./role-container-loader/aigc-node-invoker-adapter.js";
import type { SkillRegistryDependency } from "./role-container-loader/skills-binder.js";
import type { RoleAgentDelegator } from "./role-agent-runtime/delegator.js";
import { createRoleAgentDelegator } from "./role-agent-runtime/delegator.js";
import type { CallbackReceiver } from "./role-agent-runtime/callback-receiver.js";
import { createExecutorRoleAgentDispatcher } from "./role-agent-runtime/executor-real-mode-dispatcher.js";
import { createLlmCall } from "./role-agent-runtime/llm-call.js";
import { createLiteAgentRuntime } from "./role-agent-runtime/lite-agent-runtime.js";
import type { RoleCapabilityPackage } from "../../../shared/blueprint/index.js";
import type {
  BlueprintClarificationSession,
  BlueprintGenerationArtifact,
  BlueprintGenerationEvent,
  BlueprintGenerationEventType,
  BlueprintGenerationJob,
  BlueprintIntake,
  BlueprintProjectDomainContext,
} from "../../../shared/blueprint/index.js";
import type {
  McpToolExecutionRequest,
  McpToolExecutionResult,
} from "../../tool/api/mcp-tool-adapter.js";
import { createBlueprintEventBus } from "./event-bus.js";
import {
  createRouteSetLlmGenerator,
  type RouteSetLlmGenerator,
} from "./routeset/route-llm-generator.js";
import type {
  BlueprintExecutorCallbackDispatcher,
  DockerCapabilityBridge,
  DockerCapabilityPolicy,
} from "./docker-analysis-sandbox/types.js";
import { createBlueprintExecutorCallbackDispatcher } from "./docker-analysis-sandbox/callback-waiter.js";
import { createDefaultDockerCapabilityPolicy } from "./docker-analysis-sandbox/policy.js";
import { createDockerCapabilityBridge } from "./docker-analysis-sandbox/bridge.js";
import {
  createMcpGithubCapabilityBridge,
  type McpGithubCapabilityBridge,
  type McpGithubCapabilityBridgeInput,
  type McpGithubCapabilityBridgeOutput,
} from "./mcp-github-source/bridge.js";
import type {
  BlueprintHttpFetcher,
  BlueprintHttpResponse,
} from "./mcp-github-source/http-fetcher.js";
import {
  createDefaultMcpGithubCapabilityPolicy,
  type McpGithubCapabilityPolicy,
} from "./mcp-github-source/policy.js";
import {
  createAigcSpecNodeCapabilityBridge,
  type AigcSpecNodeCapabilityBridge,
} from "./aigc-spec-node/bridge.js";
import {
  createDefaultAigcSpecNodeCapabilityPolicy,
  type AigcSpecNodeCapabilityPolicy,
} from "./aigc-spec-node/policy.js";
import { createRoleSystemArchitectureCapabilityBridge } from "./role-system-architecture/bridge.js";
import { createDefaultRoleSystemArchitectureCapabilityPolicy } from "./role-system-architecture/policy.js";
import {
  createDefaultEffectPreviewLlmPolicy,
  type EffectPreviewLlmPolicy,
} from "./effect-preview/policy.js";
import type { EffectPreviewLlmService } from "./effect-preview/service.js";
import { createEffectPreviewLlmService } from "./effect-preview/service.js";
// `autopilot-image-rendering-and-visual-system` spec Task 7.1：
// Stage C 出图链路装配。`ImageService` 是 sibling 服务，与上文的
// `EffectPreviewLlmService` 并列暴露在 ctx 上；前者负责 raster 出图 + SVG 草图，
// 后者负责 LLM 内容字段。两者解耦，互不污染既有 60+ effect-preview 测试。
import {
  createImageApiClient,
} from "./effect-preview/image-api-client.js";
import { createPromptTemplateLibrary } from "./effect-preview/prompt-template-library.js";
import { createSvgArchitectureDrafter } from "./effect-preview/svg-architecture-drafter.js";
import { createEffectPreviewScheduler } from "./effect-preview/scheduler.js";
import {
  createImageService,
  type ImageService as EffectPreviewImageService,
} from "./effect-preview/image-service.js";
import { createCostTrackerAdapter } from "./effect-preview/cost-tracker-adapter.js";
import type { CostTracker } from "../../core/cost-tracker.js";
import type { AgentCrewStageActivationPolicy } from "./agent-crew-stage-activation/policy.js";
import { createDefaultAgentCrewStageActivationPolicy } from "./agent-crew-stage-activation/policy.js";
import type { AgentCrewStageActivationDriver } from "./agent-crew-stage-activation/driver.js";
import type { SpecTreeLlmPolicy } from "./spec-tree/policy.js";
import type { SpecTreeLlmService } from "./spec-tree/service.js";
import { createDefaultSpecTreeLlmPolicy } from "./spec-tree/policy.js";
import { createSpecTreeLlmService } from "./spec-tree/service.js";
import type { SpecDocumentsLlmPolicy } from "./spec-documents/policy.js";
import { createDefaultSpecDocumentsLlmPolicy } from "./spec-documents/policy.js";
import type { SpecDocumentsLlmService } from "./spec-documents/service.js";
import { createSpecDocumentsLlmService } from "./spec-documents/service.js";
// `autopilot-llm-spec-generation` Task 5.1：以 `import type` 引入新工厂的对外
// 接口；Task 5.2 进一步引入运行期工厂函数 `createSpecTreeLlmDerivation` /
// `createSpecDocsLlmGeneration`，在 `buildBlueprintServiceContext` 内部完成
// 默认实例的装配。两个工厂模块自身仅依赖 `import type` 引入既有 runtime，
// 不会触发 `agent-reasoning-bridge.ts` / `lite-agent-runtime.ts` 等模块的
// 运行期副作用（design §硬约束）。
import type { SpecTreeLlmDerivation } from "./spec-tree-llm-derivation.js";
import { createSpecTreeLlmDerivation } from "./spec-tree-llm-derivation.js";
import type { SpecDocsLlmGeneration } from "./spec-docs-llm-generation.js";
import { createSpecDocsLlmGeneration } from "./spec-docs-llm-generation.js";
import type { PromptPackageLlmPolicy } from "./prompt-package/policy.js";
import { createDefaultPromptPackageLlmPolicy } from "./prompt-package/policy.js";
import type { PromptPackageLlmService } from "./prompt-package/service.js";
import { createPromptPackageLlmService } from "./prompt-package/service.js";
import type { EngineeringHandoffLlmPolicy } from "./engineering-handoff/policy.js";
import { createDefaultEngineeringHandoffLlmPolicy } from "./engineering-handoff/policy.js";
import type { EngineeringHandoffLlmService } from "./engineering-handoff/service.js";
import { createEngineeringHandoffLlmService } from "./engineering-handoff/service.js";

/**
 * Role System Architecture capability policy interface.
 *
 * Contains security, quota, and configuration constraints for the role
 * architecture bridge. The full implementation will be provided by task 7
 * (`server/routes/blueprint/role-system-architecture/policy.ts`); this
 * declaration enables the `BlueprintServiceContext` type extension without
 * importing the factory implementation (avoiding circular dependencies).
 *
 * @see design §2.D2 / §4.3
 */
export interface RoleSystemArchitectureCapabilityPolicy {
  maxInvocationTimeoutMs: number;
  temperature: number;
  maxLogLines: number;
  maxLogBytes: number;
  maxStructuredPayloadSummaryBytes: number;
  redactionKeywords: readonly string[];
  redactedEmailPattern: RegExp;
  redactedApiKeyPattern: RegExp;
  redactedGithubPatPattern: RegExp;
  callJsonRetryAttempts: number;
}

/**
 * Role System Architecture capability bridge function type.
 *
 * A pure async function: accepts bridge input (capability / route / request /
 * primaryRouteId etc.), returns an output containing either a real invocation
 * (with structured roles) or a fallback invocation. The full implementation
 * will be provided by task 14
 * (`server/routes/blueprint/role-system-architecture/bridge.ts`); this type
 * alias enables the `BlueprintServiceContext` field declaration without
 * importing the factory (avoiding circular dependencies).
 *
 * @see design §2.D1 / §4.2
 */
export type RoleSystemArchitectureCapabilityBridge = (
  input: any
) => Promise<RoleSystemArchitectureCapabilityBridgeOutput>;

/**
 * Minimal input shape for the Role System Architecture capability bridge.
 * Full definition will be provided by task 14.
 */
export interface RoleSystemArchitectureCapabilityBridgeInput {
  capability: unknown;
  route: unknown;
  jobId: string;
  request: unknown;
  routeSet: unknown;
  primaryRouteId: string;
  clarificationSession?: unknown;
  createdAt: unknown;
  invocationId: string;
  roleId: string;
  [key: string]: unknown;
}

/**
 * Minimal output shape for the Role System Architecture capability bridge.
 * Full definition will be provided by task 14.
 */
export interface RoleSystemArchitectureCapabilityBridgeOutput {
  invocation: unknown;
  executionMode: "real" | "simulated_fallback";
  additionalEvents?: unknown[];
  structuredRoles?: unknown;
  structuredRolesMeta?: { digest: string; byteSize: number; summary: string };
}

export type {
  BlueprintHttpFetcher,
  BlueprintHttpResponse,
  McpGithubCapabilityBridge,
  McpGithubCapabilityBridgeInput,
  McpGithubCapabilityBridgeOutput,
  McpGithubCapabilityPolicy,
  AigcSpecNodeCapabilityBridge,
  AigcSpecNodeCapabilityPolicy,
};

/**
 * 纯内存 Map 三件套：存放尚未进入 jobStore 的 intake / clarification / project context。
 *
 * 和 {@link BlueprintJobStore} 的边界：
 * - 这里的是**会话期纯内存状态**，重启即丢失；
 * - {@link BlueprintJobStore} 是**作业级持久化状态**，由 `createFileBlueprintJobStore` 默认落盘。
 *
 * 两者通过 `BlueprintServiceContext` 一并提供给子域，不允许子域自行实例化。
 *
 * 对应需求 3.5。
 */
export interface BlueprintIntakeStores {
  intakes: Map<string, BlueprintIntake>;
  clarificationSessions: Map<string, BlueprintClarificationSession>;
  projectContexts: Map<string, BlueprintProjectDomainContext>;
}

/**
 * 创建默认的纯内存 `BlueprintIntakeStores`。
 *
 * 用于 `buildBlueprintServiceContext()` 未显式注入时的兜底。
 */
export function createDefaultBlueprintStores(): BlueprintIntakeStores {
  return {
    intakes: new Map<string, BlueprintIntake>(),
    clarificationSessions: new Map<string, BlueprintClarificationSession>(),
    projectContexts: new Map<string, BlueprintProjectDomainContext>(),
  };
}

/**
 * LLM 依赖子集：蓝图栈只关心 JSON 模式调用与配置读取。
 *
 * 之所以拆出独立 interface，是为了在测试里按需替换其中之一。
 */
export interface BlueprintLlmDependencies {
  callJson: typeof callLLMJson;
  getConfig: () => AIConfig;
}

/**
 * 事件总线最小接口。
 *
 * 实现在任务 5（`createBlueprintEventBus`）里给出，
 * 本文件只定义它与 Context 的协作形状。
 *
 * 约束：
 * - `emit` 接受的事件 `type` 必须是 `BlueprintGenerationEventType` 的成员。
 * - `emit` 需要在事件写入 `jobStore.events` 后才返回，保证 Artifact Replay 可见性。
 *
 * 对应需求 5.1 / 5.2 / 5.3。
 */
export interface BlueprintEventBus {
  emit(event: BlueprintGenerationEvent): void;
  /** 订阅所有事件；用于 Artifact Replay 与监控面。 */
  subscribe(listener: (event: BlueprintGenerationEvent) => void): () => void;
}

/**
 * 沙箱推导作业的最小执行接口（任务 9 会落地实现，本轮只定义形状）。
 *
 * 它对应 `agent-crew/sandbox-derivation.ts` 的主执行器职责：接收一个作业请求，
 * 产出一组 artifacts / events。本轮为了让 Context 字段完整，暂时以 `unknown` 宽松签名
 * 占位；任务 9 会把它收窄为精确签名。
 */
export type BlueprintSandboxDerivationRunner = (
  job: BlueprintGenerationJob
) => Promise<{
  artifacts: BlueprintGenerationArtifact[];
  events: BlueprintGenerationEvent[];
}>;

/**
 * Artifact Replay 存储适配器。
 *
 * 为了满足需求 5.3（Artifact Replay 只消费统一事件流，不维护旁路源），
 * 默认实现 `createJobBackedReplayStore(jobStore)` 会从 `job.events + job.artifacts`
 * 现场拼装快照，不持有独立事件存储。任务 13 会给出具体实现。
 */
export interface BlueprintReplayStore {
  listEvents(jobId: string): BlueprintGenerationEvent[];
  listArtifacts(jobId: string): BlueprintGenerationArtifact[];
}

/**
 * 默认 replay store：纯投影，事件与 artifacts 都回 `jobStore.get(jobId)`。
 */
export function createJobBackedReplayStore(
  jobStore: BlueprintJobStore
): BlueprintReplayStore {
  return {
    listEvents(jobId) {
      return jobStore.get(jobId)?.events ?? [];
    },
    listArtifacts(jobId) {
      return jobStore.get(jobId)?.artifacts ?? [];
    },
  };
}

/**
 * 最小 Logger 接口：仅用于可观测性，不影响行为。
 */
export interface BlueprintLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * 默认静默 logger：所有方法 no-op。
 */
export function createSilentBlueprintLogger(): BlueprintLogger {
  return {
    debug: () => void 0,
    info: () => void 0,
    warn: () => void 0,
    error: () => void 0,
  };
}

/**
 * MCP 工具执行入口（只暴露 `execute(request)` 这一个能力）。
 *
 * 设计目标：让 `server/routes/blueprint/mcp-github-source/` 子域只通过
 * 这一最小接口消费主线 `McpToolAdapter.execute()`，避免直接 `import` 类本身
 * 或任何单例（需求 2.3 / 6.2 的硬约束）。主线装配时 `server/index.ts`
 * 会把已有 `McpToolAdapter` 实例以结构化类型（duck-typing）传入。
 *
 * 注意：此处仅 `import type` 依赖，**绝不** import 实现；所有运行时耦合通过
 * 注入到 {@link BlueprintServiceContext.mcpToolAdapter} 实现。
 */
export interface McpToolAdapterDependency {
  execute(request: McpToolExecutionRequest): Promise<McpToolExecutionResult>;
}

// `createFallbackEventBus` 保留用于文档说明；当前默认总线由 `createBlueprintEventBus`
// 在 `buildBlueprintServiceContext` 中直接装配。

/**
 * 默认 sandbox runner 占位：直接返回空 artifacts / 空 events。
 * 真实实现在任务 9 里从 `server/routes/blueprint.ts` 迁出。
 */
function createDefaultSandboxDerivationRunner(): BlueprintSandboxDerivationRunner {
  return async () => ({ artifacts: [], events: [] });
}

/**
 * 蓝图栈的统一运行期上下文。
 *
 * 8 个子域服务（intake / clarification / jobs / agent-crew / routeset /
 * spec-documents / downstream / artifact-memory）都通过此 context 获取依赖：
 * 子域不允许再 `import defaultJobStore` 或 `import { blueprintStores }`（需求 3.2、3.6）。
 *
 * 字段分层说明：
 * - 基础设施（必填、可替换）：`now`、`blueprintStores`、`jobStore`、`llm`、`eventBus`、
 *   `generateClarificationQuestions`、`sandboxDerivationRunner`、`replayStore`。
 * - 可选覆盖：`specsRoot`（`/specs` 扫描根）、`logger`（可观测性）。
 */
export interface BlueprintServiceContext {
  now: () => Date;
  blueprintStores: BlueprintIntakeStores;
  jobStore: BlueprintJobStore;
  llm: BlueprintLlmDependencies;
  generateClarificationQuestions?: BlueprintClarificationQuestionGenerator;
  /**
   * Optional RouteSet LLM driven generator (see
   * `.kiro/specs/autopilot-routeset-llm-generation/design.md` 2.D3 / 4.3).
   * When `buildBlueprintServiceContext` is invoked without
   * `deps.routeSetLlmGenerator`, a default instance is constructed via
   * `createRouteSetLlmGenerator(ctx)` and attached here. Tests can inject a
   * mock through `BlueprintServiceContextDeps.routeSetLlmGenerator` to
   * completely short-circuit LLM calls, matching the semantics of
   * `generateClarificationQuestions`.
   */
  routeSetLlmGenerator?: RouteSetLlmGenerator;
  sandboxDerivationRunner: BlueprintSandboxDerivationRunner;
  replayStore: BlueprintReplayStore;
  eventBus: BlueprintEventBus;
  specsRoot: string;
  logger: BlueprintLogger;
  /**
   * 可选：真实 Docker 执行器客户端。
   *
   * 由 `.kiro/specs/autopilot-capability-bridge-docker` 引入：当 Docker capability
   * bridge 命中 `docker-analysis-sandbox` 时，通过这个客户端向 `services/lobster-executor`
   * 派发真实作业。未注入时 bridge 走 simulated fallback（design §2 D2 / §4.6 step 1）。
   *
   * 本字段当前为类型可选；默认装配在 Task 13 处理，Task 2 只保证 "类型可选且不传也不崩"。
   */
  executorClient?: ExecutorClient;
  /**
   * 可选：HMAC 执行器回调分发器。
   *
   * 由 `server/index.ts` 的 `/api/executor/events` 中间件在 Task 14 接线，将收到的
   * 回调事件通过 `handleEvent(event)` 分发给 bridge 的 `awaitTerminal(jobId, ...)`
   * 等待者（design §4.5）。
   *
   * 接口形状定义在 `./docker-analysis-sandbox/types.ts`，具体实现将于 Task 7 落地。
   */
  executorCallbackDispatcher?: BlueprintExecutorCallbackDispatcher;
  /**
   * 可选：Docker capability 的安全与资源策略。
   *
   * 包含镜像 allow-list、内存 / CPU / pids 上限、网络策略、安全级别、
   * 回调 / 派发超时、日志行数 / 字节上限等。`createDefaultDockerCapabilityPolicy()`
   * 将于 Task 3 提供默认值（design §4.3）。
   */
  dockerCapabilityPolicy?: DockerCapabilityPolicy;
  /**
   * 可选：Docker capability bridge 实例本身。
   *
   * 一个纯异步函数：接收 bridge 输入（capability / route / request 等），返回
   * 包含真实 invocation 或 fallback invocation 的输出（design §4.2 / §4.6）。
   *
   * 测试装配中可直接替换整个 bridge；默认装配由 `createDockerCapabilityBridge(ctx)`
   * 在 Task 10 / Task 13 提供。
   */
  dockerCapabilityBridge?: DockerCapabilityBridge;
  /**
   * MCP 工具执行入口。未注入时 {@link McpGithubCapabilityBridge} 直接走 fallback。
   * 装配规则见 `server/index.ts`（仅在 `BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED === "true"`
   * 时传入主线已装配的 `McpToolAdapter` 实例，以 {@link McpToolAdapterDependency} 形状注入）。
   */
  mcpToolAdapter?: McpToolAdapterDependency;
  /**
   * HTTPS GET 专用 fetcher。未注入时桥直接走 fallback；只接受 https / allow-list 内 URL。
   * 实现见 `server/routes/blueprint/mcp-github-source/http-fetcher.ts`，主线装配位于
   * `server/index.ts` 的 composition root（可选）。
   */
  httpFetcher?: BlueprintHttpFetcher;
  /**
   * MCP GitHub 能力桥安全策略。未注入时默认使用 `createDefaultMcpGithubCapabilityPolicy()`。
   */
  mcpGithubCapabilityPolicy?: McpGithubCapabilityPolicy;
  /**
   * MCP GitHub 能力桥本体。默认装配 `createMcpGithubCapabilityBridge(ctx)`；
   * 测试可以通过 `buildBlueprintServiceContext({ mcpGithubCapabilityBridge: fake })` 注入。
   */
  mcpGithubCapabilityBridge?: McpGithubCapabilityBridge;
  /**
   * AIGC Spec Node capability policy. Defaults are wired by
   * {@link buildBlueprintServiceContext}; callers may override for tests.
   *
   * Task 15 now default-wires this via
   * `createDefaultAigcSpecNodeCapabilityPolicy()`. The field stays optional so
   * custom {@link BlueprintServiceContext} shapes assembled directly (without
   * {@link buildBlueprintServiceContext}) remain backwards compatible.
   */
  aigcSpecNodeCapabilityPolicy?: AigcSpecNodeCapabilityPolicy;
  /**
   * AIGC Spec Node capability bridge. Defaults to
   * `createAigcSpecNodeCapabilityBridge(ctx)` when not provided.
   *
   * The bridge performs its own tier-1 early-exit when
   * `BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED !== "true"` or when the
   * resolved apiKey is empty, so always wiring a bridge instance does not
   * incur LLM traffic in default deployments.
   */
  aigcSpecNodeCapabilityBridge?: AigcSpecNodeCapabilityBridge;
  /**
   * Optional: Role System Architecture capability policy.
   *
   * Contains security/quota/configuration constraints for the role architecture
   * bridge. When not injected, `buildBlueprintServiceContext` will wire a
   * default via `createDefaultRoleSystemArchitectureCapabilityPolicy()` (task
   * 17). The field stays optional so custom contexts assembled directly remain
   * backwards compatible.
   *
   * @see design §2.D2 / §4.3
   */
  roleSystemArchitectureCapabilityPolicy?: RoleSystemArchitectureCapabilityPolicy;
  /**
   * Optional: Role System Architecture capability bridge instance.
   *
   * A pure async function that performs real LLM-driven role architecture
   * reasoning or falls back to simulated output. When not injected,
   * `buildBlueprintServiceContext` will wire a default via
   * `createRoleSystemArchitectureCapabilityBridge(ctx)` (task 17). The bridge
   * performs its own tier-1 early-exit when
   * `BLUEPRINT_ROLE_CAPABILITY_BRIDGE_ENABLED !== "true"` or when the resolved
   * apiKey is empty, so always wiring a bridge instance does not incur LLM
   * traffic in default deployments.
   *
   * @see design §2.D1 / §4.2
   */
  roleSystemArchitectureCapabilityBridge?: RoleSystemArchitectureCapabilityBridge;
  /**
   * Optional: Effect Preview LLM capability policy.
   *
   * Contains security / schema upper bounds / redaction patterns for the
   * Effect Preview LLM service (see
   * `server/routes/blueprint/effect-preview/policy.ts` +
   * `.kiro/specs/autopilot-effect-preview-llm/design.md` §4.3). When not
   * injected, `buildBlueprintServiceContext` wires a default via
   * `createDefaultEffectPreviewLlmPolicy()`. The field stays optional so
   * custom {@link BlueprintServiceContext} shapes assembled directly
   * remain backwards compatible.
   *
   * @see design §2.D2 / §4.3
   */
  effectPreviewLlmPolicy?: EffectPreviewLlmPolicy;
  /**
   * Optional: Effect Preview LLM service instance.
   *
   * A pure async function that performs per-preview LLM-driven Effect
   * Preview generation or falls back to the templated path. When not
   * injected, `buildBlueprintServiceContext` wires a default via
   * `createEffectPreviewLlmService(ctx)`. The service performs its own
   * tier-1 early-exit when `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED !== "true"`
   * or when the resolved apiKey is empty, so always wiring a service
   * instance does not incur LLM traffic in default deployments.
   *
   * @see design §2.D1 / §2.D2 / §4.2 / §4.6
   */
  effectPreviewLlmService?: EffectPreviewLlmService;
  /**
   * `autopilot-image-rendering-and-visual-system` spec Task 7.1：
   * Stage C 出图链路服务。与 {@link effectPreviewLlmService} 并列存在，
   * 不替换、也不修改既有 LLM 内容字段服务。`runStageC` 输入 SPEC 文档 +
   * 依赖顺序 + 架构 notes，按 4 步串行流水线（prompt template → SVG draft
   * → schedule → 串行 raster）输出 SVG 草图、按节点 base64 raster 与文本
   * 兜底。永不抛错；任何 fallback 都会通过 progressPlan / textOnlyEffectPreview
   * 字段对外暴露（design §"ImageService" / 需求 1.x / 4.x / 6.x）。
   *
   * 默认装配在 {@link buildBlueprintServiceContext} 中完成；测试可通过
   * {@link BlueprintServiceContextDeps.effectPreviewImageService} 注入 fake。
   * 字段保持可选语义以兼容直接装配 ctx 的旧调用路径（与
   * `effectPreviewLlmService` 一致）。
   *
   * 装配出来的实例在 env-disabled / key-missing 等档位下走 6 级降级，零
   * outgoing 请求；既有 60+ effect-preview 测试不感知该字段。
   */
  effectPreviewImageService?: EffectPreviewImageService;
  /**
   * Agent Crew Stage Activation policy (pure data, stateless).
   * Controls event suppression, idempotence, redaction rules and schema
   * version allow-list. Defaults to `createDefaultAgentCrewStageActivationPolicy()`
   * when not provided via deps.
   */
  agentCrewStageActivationPolicy?: AgentCrewStageActivationPolicy;
  /**
   * Agent Crew Stage Activation driver instance.
   * **Not default-assembled** — the driver is per-job lifecycle (internal
   * tracker state), so the outer layer lazy-constructs it at each job start
   * via `createAgentCrewStageActivationDriver(ctx)` and writes it back here.
   * See design §2.D2.
   */
  agentCrewStageActivationDriver?: AgentCrewStageActivationDriver;
  /**
   * Optional: SPEC Tree LLM generation policy (pure data, stateless).
   * Controls timeout, temperature, retry attempts, schema bounds, and
   * redaction rules. When not injected, `buildBlueprintServiceContext` wires
   * a default via `createDefaultSpecTreeLlmPolicy()`.
   *
   * @see design §2.D2 / §4.3
   */
  specTreeLlmPolicy?: SpecTreeLlmPolicy;
  /**
   * Optional: SPEC Tree LLM service instance.
   * A pure async function that performs LLM-driven SPEC Tree generation or
   * falls back to template output. When not injected,
   * `buildBlueprintServiceContext` wires a default via
   * `createSpecTreeLlmService(ctx)`. The service performs its own tier-1
   * early-exit when `BLUEPRINT_SPEC_TREE_LLM_ENABLED !== "true"` or when the
   * resolved apiKey is empty, so always wiring a service instance does not
   * incur LLM traffic in default deployments.
   *
   * @see design §2.D1 / §4.2
   */
  specTreeLlmService?: SpecTreeLlmService;
  /**
   * Optional: SPEC Documents LLM service policy.
   *
   * Controls schema upper bounds (sections / body / title length), redaction
   * patterns, retry attempts and timeout ceiling for the SPEC Documents LLM
   * driven generation path. When omitted, {@link buildBlueprintServiceContext}
   * wires {@link createDefaultSpecDocumentsLlmPolicy}.
   *
   * @see `.kiro/specs/autopilot-spec-documents-llm/design.md` §4.3
   */
  specDocumentsLlmPolicy?: SpecDocumentsLlmPolicy;
  /**
   * Optional: SPEC Documents LLM service instance (per-document LLM driver).
   *
   * @see `.kiro/specs/autopilot-spec-documents-llm/design.md` §2.D2 / §4.2 / §4.6
   */
  specDocumentsLlmService?: SpecDocumentsLlmService;
  /**
   * `autopilot-llm-spec-generation` spec Task 5.1：可选的 SPEC 树 LLM 推导工厂。
   *
   * 由 spec_tree handler（Task 6.1）在 env flag
   * `BLUEPRINT_SPEC_TREE_LLM_ENABLED === "true"` 且非 `BUILD_TARGET=test` 时
   * 优先调用 {@link SpecTreeLlmDerivation.derive} 走真实 LLM 推导；未注入或
   * 装配阶段 `enabledByConfig` / `dependencyReady` 不就绪时回落到既有模板路径。
   *
   * 默认装配在 Task 5.2 `buildBlueprintServiceContext` 中完成；测试可通过
   * {@link BlueprintServiceContextDeps.specTreeLlmDerivation} 注入 fake 工厂。
   * 字段保持可选语义以兼容直接装配 ctx 的旧调用路径。
   *
   * @see `.kiro/specs/autopilot-llm-spec-generation/design.md` §2.D1 / §4.2
   */
  specTreeLlmDerivation?: SpecTreeLlmDerivation;
  /**
   * `autopilot-llm-spec-generation` spec Task 5.1：可选的 SPEC 文档 LLM 生成工厂。
   *
   * 由 spec_docs handler（Task 6.2）按节点逐项调用
   * {@link SpecDocsLlmGeneration.generate}：当 env flag
   * `BLUEPRINT_SPEC_DOCS_LLM_ENABLED === "true"` 且非 `BUILD_TARGET=test`、
   * 同时工厂注入到位时走真实 LLM 路径；任一节点降级时按
   * `perNode[i].generationSource` 单独决策模板回退，不影响其它节点。
   *
   * 默认装配在 Task 5.2 `buildBlueprintServiceContext` 中完成；测试可通过
   * {@link BlueprintServiceContextDeps.specDocsLlmGeneration} 注入 fake 工厂。
   * 字段保持可选语义以兼容直接装配 ctx 的旧调用路径。
   *
   * @see `.kiro/specs/autopilot-llm-spec-generation/design.md` §2.D1 / §4.2 / §4.6
   */
  specDocsLlmGeneration?: SpecDocsLlmGeneration;
  /**
   * Optional: Prompt Package LLM service policy (pure data, stateless).
   * When omitted, `buildBlueprintServiceContext` wires a default via
   * `createDefaultPromptPackageLlmPolicy()`.
   */
  promptPackageLlmPolicy?: PromptPackageLlmPolicy;
  /**
   * Optional: Prompt Package LLM service. When omitted,
   * `buildBlueprintServiceContext` wires `createPromptPackageLlmService(ctx)`.
   */
  promptPackageLlmService?: PromptPackageLlmService;
  /**
   * Optional: Engineering Handoff LLM policy (pure data, stateless).
   * When omitted, `buildBlueprintServiceContext` wires
   * `createDefaultEngineeringHandoffLlmPolicy()`.
   */
  engineeringHandoffLlmPolicy?: EngineeringHandoffLlmPolicy;
  /**
   * Optional: Engineering Handoff LLM service. When omitted,
   * `buildBlueprintServiceContext` wires
   * `createEngineeringHandoffLlmService(ctx)`.
   */
  engineeringHandoffLlmService?: EngineeringHandoffLlmService;
  /**
   * 运行时诊断 store。默认装配 in-memory
   * `createBlueprintRuntimeDiagnosticsStore()`；测试可以通过
   * `buildBlueprintServiceContext({ runtimeDiagnostics })` 注入替代实例以观察
   * 事件订阅行为或在并发用例之间保持状态隔离。
   *
   * 由 `server/routes/blueprint.ts` 的 `GET /diagnostics` 路由在
   * `.kiro/specs/autopilot-capability-runtime-enablement` Task 11 接线后
   * 消费；在此之前已经通过 `attachDiagnosticsSubscriber(eventBus, store)`
   * 持续聚合 capability / role 事件。
   *
   * 参考：
   * - `.kiro/specs/autopilot-capability-runtime-enablement/design.md` §4.4 / §4.5 / §4.6
   * - 需求 5.1 / 5.2 / 5.3 / 5.6 / 5.8
   *
   * 该字段为必填：`buildBlueprintServiceContext` 始终保证在返回 ctx 时此字段
   * 非空（默认使用 in-memory store），以便子域 / 路由层无需 `??` 兜底。
   */
  runtimeDiagnostics: BlueprintRuntimeDiagnosticsStore;
  /**
   * `autopilot-role-container-loader` spec Task 12：角色容器 loader。
   * 默认在 `buildBlueprintServiceContext` 内按 Tier 1 gate 装配；
   * 详见 `role-container-loader/loader.ts` 与 design §4.5。
   */
  roleContainerLoader?: RoleContainerLoader;

  /**
   * 角色运行时 ctx 的进程内 store；默认装配 in-memory Map 实现。
   * 由 loader 的 provision / teardown / handoff 消费（design §D4）。
   */
  roleRuntimeContextStore?: RoleRuntimeContextStore;

  /**
   * L12 `plugin-skill-system` 的 Skill 注册表依赖。未注入时 skills-binder 走
   * "全部跳过" 路径（需求 5.3）。本字段只承载类型，默认装配由 `server/index.ts`
   * composition root 负责。
   */
  skillRegistry?: SkillRegistryDependency;

  /**
   * Agent 驱动管线委派器。env flag 开启时装配。
   *
   * 当 `BLUEPRINT_AGENT_DRIVEN_PIPELINE_ENABLED === "true"` 时，
   * `createGenerationJob` 优先通过此委派器走 Agent 驱动链路生成 RouteSet。
   * 未注入或 env flag 关闭时走现有 `buildRouteSet` 链路。
   */
  roleAgentDelegator?: RoleAgentDelegator;
  /**
   * `autopilot-agent-reasoning-stream` spec Task 6.1：宿主侧 HMAC 回调接收器。
   *
   * 由 `autopilot-role-autonomous-agent` Task 7 引入的 {@link CallbackReceiver}
   * 实例，用于接收容器内 Agent Loop 的 HMAC 回调载荷
   * （{@link AgentProgressEvent}）。当前主线 `server/index.ts` 默认不显式装配
   * 实例，因此本字段保持 optional，未注入时下游 `agent-reasoning-bridge`
   * 自动走 env-off 路径（design §「Env flag off 路径」）。
   *
   * 仅类型透传，不在 `buildBlueprintServiceContext` 内构造默认实例：
   * - `CreateCallbackReceiverOptions` 必填 `hmacSecret`，需要由 composition
   *   root 决策（与容器 progress-emitter 共享同一密钥）；
   * - 既有 5140+ 测试与 `BUILD_TARGET=test` 路径不应感知该字段，否则会扩大
   *   测试基线影响面。
   */
  callbackReceiver?: CallbackReceiver;
}

/**
 * {@link BlueprintServiceContext} 的构造参数。全部可选，未提供的字段使用默认实现。
 *
 * 这是需求 3.3 的实现：`createBlueprintRouter(deps)` 在未显式提供 Context 时，
 * 通过把 `deps` 转成 `BlueprintServiceContextDeps` 一并交给 `buildBlueprintServiceContext`
 * 即可得到完整 Context。
 */
export interface BlueprintServiceContextDeps {
  now?: () => Date;
  blueprintStores?: BlueprintIntakeStores;
  jobStore?: BlueprintJobStore;
  llm?: Partial<BlueprintLlmDependencies>;
  generateClarificationQuestions?: BlueprintClarificationQuestionGenerator;
  /**
   * Optional RouteSet LLM generator override. When omitted,
   * `buildBlueprintServiceContext` wires a default via
   * `createRouteSetLlmGenerator(ctx)`.
   */
  routeSetLlmGenerator?: RouteSetLlmGenerator;
  sandboxDerivationRunner?: BlueprintSandboxDerivationRunner;
  replayStore?: BlueprintReplayStore;
  eventBus?: BlueprintEventBus;
  specsRoot?: string;
  jobStoreFile?: string;
  logger?: BlueprintLogger;
  /**
   * 可选：注入自定义 `ExecutorClient`（测试场景常用）。
   * 未提供时 ctx 上 `executorClient` 字段保持 `undefined`，bridge 将据此走 fallback
   * （Task 13 默认装配策略：不自动构造默认 `ExecutorClient` 以避免 dev 默认装配下的
   * 额外网络往返）。
   */
  executorClient?: ExecutorClient;
  /**
   * 可选：注入自定义 `BlueprintExecutorCallbackDispatcher`。
   * 未提供时由 `buildBlueprintServiceContext` 在 Task 13 装配默认实例。
   */
  executorCallbackDispatcher?: BlueprintExecutorCallbackDispatcher;
  /**
   * 可选：注入自定义 Docker capability 策略。
   * 未提供时默认装配使用 `createDefaultDockerCapabilityPolicy()`（Task 3 / Task 13）。
   */
  dockerCapabilityPolicy?: DockerCapabilityPolicy;
  /**
   * 可选：直接注入 Docker capability bridge 实例。
   * 未提供时由 Task 13 通过 `createDockerCapabilityBridge(ctx)` 装配默认实例。
   */
  dockerCapabilityBridge?: DockerCapabilityBridge;
  /** See {@link BlueprintServiceContext.mcpToolAdapter}. */
  mcpToolAdapter?: McpToolAdapterDependency;
  /** See {@link BlueprintServiceContext.httpFetcher}. */
  httpFetcher?: BlueprintHttpFetcher;
  /** See {@link BlueprintServiceContext.mcpGithubCapabilityPolicy}. */
  mcpGithubCapabilityPolicy?: McpGithubCapabilityPolicy;
  /** See {@link BlueprintServiceContext.mcpGithubCapabilityBridge}. */
  mcpGithubCapabilityBridge?: McpGithubCapabilityBridge;
  /**
   * Optional override for the AIGC Spec Node policy. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createDefaultAigcSpecNodeCapabilityPolicy}.
   */
  aigcSpecNodeCapabilityPolicy?: AigcSpecNodeCapabilityPolicy;
  /**
   * Optional override for the AIGC Spec Node bridge. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createAigcSpecNodeCapabilityBridge} using the fully-constructed
   * context (so the bridge sees the same `llm` / `logger` / `now` /
   * `aigcSpecNodeCapabilityPolicy` that the rest of the app uses).
   */
  aigcSpecNodeCapabilityBridge?: AigcSpecNodeCapabilityBridge;
  /**
   * Optional override for the Role System Architecture capability policy.
   * When omitted, {@link buildBlueprintServiceContext} will wire a default via
   * `createDefaultRoleSystemArchitectureCapabilityPolicy()` (task 17).
   *
   * @see design §2.D2 / §4.3
   */
  roleSystemArchitectureCapabilityPolicy?: RoleSystemArchitectureCapabilityPolicy;
  /**
   * Optional override for the Role System Architecture capability bridge.
   * When omitted, {@link buildBlueprintServiceContext} will wire a default via
   * `createRoleSystemArchitectureCapabilityBridge(ctx)` (task 17).
   *
   * @see design §2.D1 / §4.2
   */
  roleSystemArchitectureCapabilityBridge?: RoleSystemArchitectureCapabilityBridge;
  /**
   * Optional override for the Effect Preview LLM policy. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createDefaultEffectPreviewLlmPolicy}.
   *
   * @see design §2.D2 / §4.3
   */
  effectPreviewLlmPolicy?: EffectPreviewLlmPolicy;
  /**
   * Optional override for the Effect Preview LLM service. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createEffectPreviewLlmService} using the fully-constructed
   * context (so the service sees the same `llm` / `logger` / `now` /
   * `effectPreviewLlmPolicy` that the rest of the app uses).
   *
   * @see design §2.D1 / §2.D2 / §4.2 / §4.6
   */
  effectPreviewLlmService?: EffectPreviewLlmService;
  /**
   * Optional override for the Effect Preview Stage C ImageService.
   * When omitted, {@link buildBlueprintServiceContext} wires
   * {@link createImageService} with the default 4-dependency factory chain
   * (`createImageApiClient` / `createPromptTemplateLibrary` /
   * `createSvgArchitectureDrafter` / `createEffectPreviewScheduler`).
   *
   * @see `.kiro/specs/autopilot-image-rendering-and-visual-system/design.md` §"ImageService"
   */
  effectPreviewImageService?: EffectPreviewImageService;
  /**
   * Phase 4 Task 33.4 test-injection point: pass a fresh
   * `new CostTracker(tmpHistoryPath)` to swap the production singleton out
   * of the default `createCostTrackerAdapter(...)` call. Has no effect when
   * `effectPreviewImageService` is also provided (caller built the service
   * themselves and is responsible for its `costTracker`).
   *
   * Production callers should leave this `undefined`; the adapter then
   * defaults to `server/core/cost-tracker.ts`'s exported singleton. This
   * field exists exclusively so context-level integration tests can prove
   * the real `createCostTrackerAdapter(...)` is wired into the default
   * assembly without depending on the singleton's in-memory state.
   *
   * @see `server/routes/blueprint/__tests__/context.image-cost-tracking.test.ts`
   */
  effectPreviewImageCostTracker?: CostTracker;
  /**
   * Optional override for the Agent Crew Stage Activation policy.
   * When omitted, {@link buildBlueprintServiceContext} wires
   * {@link createDefaultAgentCrewStageActivationPolicy}.
   */
  agentCrewStageActivationPolicy?: AgentCrewStageActivationPolicy;
  /**
   * Optional: inject a pre-constructed Agent Crew Stage Activation driver.
   * When omitted, `buildBlueprintServiceContext` does NOT default-assemble a
   * driver (per-job lifecycle; design §2.D2). The outer layer lazy-constructs
   * it at each job start.
   */
  agentCrewStageActivationDriver?: AgentCrewStageActivationDriver;
  /**
   * Optional override for the SPEC Tree LLM policy. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createDefaultSpecTreeLlmPolicy}.
   *
   * @see design §2.D2 / §4.3
   */
  specTreeLlmPolicy?: SpecTreeLlmPolicy;
  /**
   * Optional override for the SPEC Tree LLM service. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createSpecTreeLlmService} using the fully-constructed context
   * (so the service sees the same `llm` / `logger` / `now` /
   * `specTreeLlmPolicy` that the rest of the app uses).
   *
   * @see design §2.D1 / §4.2
   */
  specTreeLlmService?: SpecTreeLlmService;
  /**
   * Optional override for the SPEC Documents LLM policy. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createDefaultSpecDocumentsLlmPolicy}.
   *
   * @see `.kiro/specs/autopilot-spec-documents-llm/design.md` §4.3
   */
  specDocumentsLlmPolicy?: SpecDocumentsLlmPolicy;
  /**
   * Optional override for the SPEC Documents LLM service. When omitted,
   * {@link buildBlueprintServiceContext} wires
   * {@link createSpecDocumentsLlmService} using the fully-constructed context
   * so the service sees the same `llm` / `logger` / `now` /
   * `specDocumentsLlmPolicy` that the rest of the app uses.
   *
   * @see `.kiro/specs/autopilot-spec-documents-llm/design.md` §2.D2 / §4.2 / §4.6
   */
  specDocumentsLlmService?: SpecDocumentsLlmService;
  /**
   * `autopilot-llm-spec-generation` spec Task 5.1：可选的 SPEC 树 LLM 推导工厂。
   *
   * 由 spec_tree handler（Task 6.1）在 env flag
   * `BLUEPRINT_SPEC_TREE_LLM_ENABLED === "true"` 且非 `BUILD_TARGET=test` 时
   * 优先调用 {@link SpecTreeLlmDerivation.derive} 走真实 LLM 推导；未注入或
   * 装配阶段 `enabledByConfig` / `dependencyReady` 不就绪时回落到既有模板路径。
   *
   * 默认装配在 Task 5.2 `buildBlueprintServiceContext` 中完成；测试可通过
   * {@link BlueprintServiceContextDeps.specTreeLlmDerivation} 注入 fake 工厂。
   * 字段保持可选语义以兼容直接装配 ctx 的旧调用路径。
   *
   * @see `.kiro/specs/autopilot-llm-spec-generation/design.md` §2.D1 / §4.2
   */
  specTreeLlmDerivation?: SpecTreeLlmDerivation;
  /**
   * `autopilot-llm-spec-generation` spec Task 5.1：可选的 SPEC 文档 LLM 生成工厂。
   *
   * 由 spec_docs handler（Task 6.2）按节点逐项调用
   * {@link SpecDocsLlmGeneration.generate}：当 env flag
   * `BLUEPRINT_SPEC_DOCS_LLM_ENABLED === "true"` 且非 `BUILD_TARGET=test`、
   * 同时工厂注入到位时走真实 LLM 路径；任一节点降级时按
   * `perNode[i].generationSource` 单独决策模板回退，不影响其它节点。
   *
   * 默认装配在 Task 5.2 `buildBlueprintServiceContext` 中完成；测试可通过
   * {@link BlueprintServiceContextDeps.specDocsLlmGeneration} 注入 fake 工厂。
   * 字段保持可选语义以兼容直接装配 ctx 的旧调用路径。
   *
   * @see `.kiro/specs/autopilot-llm-spec-generation/design.md` §2.D1 / §4.2 / §4.6
   */
  specDocsLlmGeneration?: SpecDocsLlmGeneration;
  /** See {@link BlueprintServiceContext.promptPackageLlmPolicy}. */
  promptPackageLlmPolicy?: PromptPackageLlmPolicy;
  /** See {@link BlueprintServiceContext.promptPackageLlmService}. */
  promptPackageLlmService?: PromptPackageLlmService;
  /** See {@link BlueprintServiceContext.engineeringHandoffLlmPolicy}. */
  engineeringHandoffLlmPolicy?: EngineeringHandoffLlmPolicy;
  /** See {@link BlueprintServiceContext.engineeringHandoffLlmService}. */
  engineeringHandoffLlmService?: EngineeringHandoffLlmService;
  /**
   * 可选：运行时诊断 store 覆盖。未提供时
   * `buildBlueprintServiceContext` 默认装配
   * `createBlueprintRuntimeDiagnosticsStore()`；测试可注入预置状态或 spy 后
   * 的 store 观察 capability / role 事件。
   *
   * @see design §4.4 / §4.5
   */
  runtimeDiagnostics?: BlueprintRuntimeDiagnosticsStore;
  /**
   * `autopilot-role-container-loader` spec Task 12：角色容器 loader 覆盖。
   * 未提供时 `buildBlueprintServiceContext` 仅在 Tier 1 gate 打开时（即
   * `BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED === "true"`）默认装配一个 loader
   * 实例；测试可以直接注入 fake loader 跳过装配路径。
   */
  roleContainerLoader?: RoleContainerLoader;
  /**
   * 可选：角色运行时 ctx 的进程内 store 覆盖。未提供时默认装配 in-memory
   * Map store；测试可注入 spy 或预置状态。
   */
  roleRuntimeContextStore?: RoleRuntimeContextStore;
  /**
   * 可选：L12 plugin-skill-system Skill 注册表依赖。未提供时 ctx 上保持
   * `undefined`，skills-binder 自动走 "全部跳过" 路径。默认装配由
   * `server/index.ts` composition root 负责。
   */
  skillRegistry?: SkillRegistryDependency;
  /**
   * 可选：Agent 驱动管线委派器。未提供时 `buildBlueprintServiceContext` 仅在
   * `BLUEPRINT_AGENT_DRIVEN_PIPELINE_ENABLED === "true"` 且
   * `BUILD_TARGET !== "test"` 时默认装配。
   */
  roleAgentDelegator?: RoleAgentDelegator;
  /**
   * `autopilot-agent-reasoning-stream` spec Task 6.1：可选注入 HMAC
   * 回调接收器。未提供时 `buildBlueprintServiceContext` 不构造默认实例
   * （需要 `hmacSecret` 等密钥参数，由 composition root 决策），ctx 上
   * `callbackReceiver` 保持 `undefined`，下游 agent-reasoning bridge 自动
   * 走 env-off 路径。
   */
  callbackReceiver?: CallbackReceiver;
  /**
   * 可选：是否在 `deps.executorClient === undefined` 时自动解析默认
   * `ExecutorClient`（默认 `true`，见 Task 10.3）。测试若明确要求 "ctx 上
   * 不放 executorClient"（例如只做投影层断言），可显式传 `false`。
   *
   * 即便 `autoResolveExecutorClient === true`，
   * `resolveDefaultExecutorClient` 仍会在
   * `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED !== "true"` 时返回
   * `undefined`，因此 BUILD_TARGET=test 默认仍走 fallback 路径
   * （design §D7 / 需求 10.6）。
   */
  autoResolveExecutorClient?: boolean;
}

/**
 * 澄清问题生成器签名：与 `server/routes/blueprint.ts` 中现有同名类型保持兼容。
 *
 * 本文件不回拉 `blueprint.ts` 中的 `BlueprintClarificationQuestionGenerator`，
 * 是为了避免循环 import；签名在两处保持一致，由任务 7 的 clarification 子域迁出时统一。
 */
export type BlueprintClarificationQuestionGenerator = (
  input: unknown
) => Promise<unknown>;

let cachedDefaultJobStore: BlueprintJobStore | null = null;

/**
 * `autopilot-role-container-loader` spec Task 12：默认角色能力包目录（缓存）。
 *
 * 通过 `readFileSync` + `JSON.parse` 同步读取，避免 `with { type: "json" }`
 * 语法在当前 tsx / TS 配置下的兼容性风险；首次调用时加载，后续命中内存缓存。
 * 若 JSON 读取失败（例如文件被删除），返回空目录并一次性 warn，不让 loader
 * 装配失败。
 */
let cachedDefaultRoleCapabilityPackages:
  | Record<string, RoleCapabilityPackage>
  | null = null;

function loadDefaultRoleCapabilityPackages(
  logger: BlueprintLogger,
): Record<string, RoleCapabilityPackage> {
  if (cachedDefaultRoleCapabilityPackages) {
    return cachedDefaultRoleCapabilityPackages;
  }
  try {
    const jsonUrl = new URL(
      "./role-container-loader/default-role-capability-packages.json",
      import.meta.url,
    );
    const raw = readFileSync(jsonUrl, "utf-8");
    const parsed = JSON.parse(raw) as {
      packages?: Record<string, RoleCapabilityPackage>;
    };
    cachedDefaultRoleCapabilityPackages = parsed.packages ?? {};
  } catch (err) {
    logger.warn(
      "role container loader: failed to load default-role-capability-packages.json",
      { error: err instanceof Error ? err.message : String(err) },
    );
    cachedDefaultRoleCapabilityPackages = {};
  }
  return cachedDefaultRoleCapabilityPackages;
}

export interface BlueprintRuntimeAdapterRebindDeps {
  mcpToolAdapter?: McpToolAdapterDependency;
  httpFetcher?: BlueprintHttpFetcher;
  skillRegistry?: SkillRegistryDependency;
}

function createSharedLiteAgentRuntime(
  ctx: BlueprintServiceContext,
  llmCall: ReturnType<typeof createLlmCall>,
) {
  return createLiteAgentRuntime({
    llmCall,
    mcpToolAdapter: ctx.mcpToolAdapter,
    skillRegistry: ctx.skillRegistry,
    aigcNodeInvoker: createLiteAgentAigcNodeInvoker(ctx),
    logger: ctx.logger,
    now: ctx.now,
  });
}

function refreshSpecLlmFactories(ctx: BlueprintServiceContext): void {
  const sharedLlmCall = createLlmCall({
    llm: ctx.llm,
    logger: ctx.logger,
  });
  const sharedLiteAgentRuntime = createSharedLiteAgentRuntime(ctx, sharedLlmCall);

  ctx.specTreeLlmDerivation = createSpecTreeLlmDerivation({
    llmCall: sharedLlmCall,
    mcpToolAdapter: ctx.mcpToolAdapter,
    httpFetcher: ctx.httpFetcher,
    liteAgentRuntime: sharedLiteAgentRuntime,
    diagnostics: ctx.runtimeDiagnostics,
    logger: ctx.logger,
    now: ctx.now,
  });
  ctx.specDocsLlmGeneration = createSpecDocsLlmGeneration({
    llmCall: sharedLlmCall,
    mcpToolAdapter: ctx.mcpToolAdapter,
    liteAgentRuntime: sharedLiteAgentRuntime,
    diagnostics: ctx.runtimeDiagnostics,
    logger: ctx.logger,
    now: ctx.now,
  });
}

function refreshRoleAgentDelegator(ctx: BlueprintServiceContext): void {
  if (
    process.env.BLUEPRINT_AGENT_DRIVEN_PIPELINE_ENABLED !== "true" ||
    process.env.BUILD_TARGET === "test"
  ) {
    return;
  }
  const llmCall = createLlmCall({ llm: ctx.llm, logger: ctx.logger });
  const routeSetGen = ctx.routeSetLlmGenerator;
  if (!routeSetGen) {
    return;
  }
  ctx.roleAgentDelegator = createRoleAgentDelegator({
    roleRuntimeContextStore: ctx.roleRuntimeContextStore,
    executorClient: ctx.executorClient,
    realModeDispatcher: ctx.executorClient
      ? createExecutorRoleAgentDispatcher({
          executorClient: ctx.executorClient,
          logger: ctx.logger,
          now: ctx.now,
        })
      : undefined,
    liteAgentRuntime: createSharedLiteAgentRuntime(ctx, llmCall),
    resolveCallback: () => ({
      callbackUrl: ctx.callbackReceiver?.callbackUrl,
      callbackSecret:
        process.env.EXECUTOR_CALLBACK_SECRET ?? "dev-callback-secret-2026",
    }),
    fallbackLlmCall: async (delegateInput) => {
      const result = await routeSetGen({
        request: delegateInput.context.request as any,
        intake: delegateInput.context.intake as any,
        clarificationSession:
          delegateInput.context.clarificationSession as any,
        projectContext: delegateInput.context.projectContext as any,
        routeSetId: (delegateInput.context.routeSetId as string) ?? "fallback-routeset",
        primaryRouteId: (delegateInput.context.primaryRouteId as string) ?? "fallback-primary",
        createdAt: ctx.now().toISOString(),
      });
      return result.routes;
    },
    onDelegationRecorded: record => {
      ctx.runtimeDiagnostics.recordDelegation("roleAutonomousAgent", record);
    },
    logger: ctx.logger,
    now: ctx.now,
  });
}

export function rebindBlueprintServiceContextRuntimeAdapters(
  ctx: BlueprintServiceContext,
  deps: BlueprintRuntimeAdapterRebindDeps,
): BlueprintServiceContext {
  let changed = false;
  if (deps.mcpToolAdapter && ctx.mcpToolAdapter !== deps.mcpToolAdapter) {
    ctx.mcpToolAdapter = deps.mcpToolAdapter;
    changed = true;
  }
  if (deps.httpFetcher && ctx.httpFetcher !== deps.httpFetcher) {
    ctx.httpFetcher = deps.httpFetcher;
    changed = true;
  }
  if (deps.skillRegistry && ctx.skillRegistry !== deps.skillRegistry) {
    ctx.skillRegistry = deps.skillRegistry;
    changed = true;
  }
  if (!changed) {
    return ctx;
  }

  refreshSpecLlmFactories(ctx);
  if (process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED === "true") {
    ctx.roleContainerLoader = createRoleContainerLoader(
      ctx,
      loadDefaultRoleCapabilityPackages(ctx.logger),
    );
  }
  refreshRoleAgentDelegator(ctx);
  return ctx;
}

/**
 * 懒加载默认 {@link BlueprintJobStore}。
 *
 * 需求 3.4 要求把 `createFileBlueprintJobStore` 收敛为默认实现来源；此处只在第一次
 * 被 `buildBlueprintServiceContext` 需要且未注入 `jobStore` 时才实例化，避免模块加载
 * 时的磁盘副作用（原来的 `const defaultJobStore = createFileBlueprintJobStore()` 在
 * `.kiro/blueprint-assets/` 目录不存在时会产生读写噪音）。
 */
function getDefaultJobStore(storageFile?: string): BlueprintJobStore {
  if (storageFile) {
    return createFileBlueprintJobStore(storageFile);
  }
  if (!cachedDefaultJobStore) {
    cachedDefaultJobStore = createFileBlueprintJobStore();
  }
  return cachedDefaultJobStore;
}

/**
 * Task 10.5: derive the executor callback URL the default `ExecutorClient`
 * should POST events to. Reuses `buildCallbackUrl` from
 * `server/core/execution-bridge.ts` so the URL format matches the rest of
 * the mission runtime and the `/api/executor/events` endpoint.
 *
 * `SERVER_BASE_URL` falls back to `http://localhost:3001` when unset — that
 * matches the server's default listen port when `PORT` is not configured.
 * Production deployments are expected to set `SERVER_BASE_URL` explicitly so
 * the executor can reach the callback endpoint across hosts.
 *
 * This helper is private to the context module; it is only invoked during
 * the default `resolveDefaultExecutorClient({...})` path. Tests that inject
 * `deps.executorClient` never exercise this code path.
 */
function deriveServerCallbackUrl(): string {
  const baseUrl = process.env.SERVER_BASE_URL ?? "http://localhost:3001";
  return buildCallbackUrl(baseUrl);
}

/**
 * 构造 {@link BlueprintServiceContext}。
 *
 * - 所有字段都可以通过 `deps` 显式覆盖。
 * - 未提供的字段使用默认实现（全部为 lazy / 幂等）。
 * - 本函数不持有全局状态；多次调用会返回多个独立的 Context 实例，
 *   因此测试可以按需 `buildBlueprintServiceContext({ jobStore: createMemoryBlueprintJobStore() })`
 *   得到一个完全隔离的装配。
 */
export function buildBlueprintServiceContext(
  deps: BlueprintServiceContextDeps = {}
): BlueprintServiceContext {
  // 装配顺序（Task 13.3）：
  // 1. 先解析 `now` / `logger`（基础依赖）；
  // 2. 再装配 `executorCallbackDispatcher`（依赖 `now` / `logger`）；
  // 3. 再装配 `dockerCapabilityPolicy`（纯数据，无上游依赖）；
  // 4. 最后装配 `dockerCapabilityBridge`（依赖 ctx 本体 —— 见下文说明）。
  //
  // bridge 的工厂签名是 `createDockerCapabilityBridge(ctx)`，它在闭包内持有
  // 对 ctx 的引用，每次调用时从 ctx 读取 `executorClient` /
  // `executorCallbackDispatcher` / `dockerCapabilityPolicy` / `logger` / `now`。
  // 因此构造分两步：
  //   a. 先组装除 `dockerCapabilityBridge` 外的所有字段（含 dispatcher / policy /
  //      可选 executorClient 透传）；
  //   b. 以 baseCtx 调用 `createDockerCapabilityBridge(baseCtx)` 得到 bridge；
  //   c. 返回带 bridge 字段的最终 ctx（baseCtx 与最终 ctx 字段完全等价，仅
  //      bridge 从 `undefined` 变为真实实例）。
  //
  // 此处不把 bridge 闭包绑定到 "未带 bridge 的 baseCtx"，因为 bridge 自身不会
  // 通过 `ctx.dockerCapabilityBridge` 调自己；其它字段 dispatcher / policy /
  // executorClient 在 baseCtx 上已经就位，bridge 每次调用时的字段查找都命中真值。
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? createSilentBlueprintLogger();
  const jobStore = deps.jobStore ?? getDefaultJobStore(deps.jobStoreFile);

  // Task 10.2: runtime diagnostics store default assembly. This must happen
  // BEFORE the executor-client resolution path below because the
  // `onProbeResult` callback passed to `resolveDefaultExecutorClient`
  // writes the docker bridge's `dependencyReady` flag into the store once
  // the fire-and-forget reachability probe settles.
  //
  // Tests can override via `deps.runtimeDiagnostics` to observe recorded
  // invocations or share state across multiple ctx instances; production
  // deployments get a per-ctx in-memory store that resets on process
  // restart (requirement 5.8 / design §4.4).
  const runtimeDiagnostics =
    deps.runtimeDiagnostics ?? createBlueprintRuntimeDiagnosticsStore({ now });

  // Task 10.3 / 10.5: default executor-client resolution. When
  // `deps.executorClient` is undefined AND `deps.autoResolveExecutorClient`
  // is not `false`, attempt to construct a default `ExecutorClient` via the
  // env-gated factory. The factory performs its own tier-1 check on
  // `dockerEnabled === "true"` and silently returns `undefined` otherwise,
  // so in test environments (where the runtime-enablement resolver clamps
  // the flag to `"false"`) no real client is constructed and `ctx.executorClient`
  // remains `undefined` — matching today's default behaviour and preserving
  // compatibility with the 5140+ existing tests (requirement 10.6).
  //
  // Tests that explicitly inject `executorClient: fake` continue to take
  // precedence because the factory is only invoked when `deps.executorClient`
  // is undefined. The Docker E2E suite in `blueprint-routes.test.ts` relies
  // on this precedence order.
  const autoResolveExecutorClient = deps.autoResolveExecutorClient !== false;
  const resolvedDefaultExecutorClient =
    deps.executorClient === undefined && autoResolveExecutorClient
      ? resolveDefaultExecutorClient({
          dockerEnabled: process.env
            .BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED as
            | "true"
            | "false"
            | undefined,
          baseUrl: process.env.LOBSTER_EXECUTOR_BASE_URL,
          callbackUrl: deriveServerCallbackUrl(),
          logger,
          onProbeResult: (result) => {
            runtimeDiagnostics.recordBridgeConfiguration("docker", {
              enabledByConfig: true,
              dependencyReady: result.reachable,
            });
          },
        })
      : undefined;
  const effectiveExecutorClient =
    deps.executorClient ?? resolvedDefaultExecutorClient;
  // Task 10.1 / 13.1：executorCallbackDispatcher / dockerCapabilityPolicy 默认装配。
  // Task 13.2 / 10.3：executorClient 现在支持默认解析（见上），但仍保持
  // `bridge` 在 ctx 上 `executorClient` 为 `undefined` 时走 simulated fallback
  // 早退路径（design §4.6 step 1），保证 dev 默认装配下不会因默认 HTTP
  // executor 连接尝试而拖慢响应，也保证测试默认装配行为等价于今天（design §2 D10）。
  const executorCallbackDispatcher =
    deps.executorCallbackDispatcher ??
    createBlueprintExecutorCallbackDispatcher({ now, logger });
  const dockerCapabilityPolicy =
    deps.dockerCapabilityPolicy ?? createDefaultDockerCapabilityPolicy();

  // AIGC Spec Node policy default (pure data, dependency-free).
  const aigcSpecNodePolicy =
    deps.aigcSpecNodeCapabilityPolicy ??
    createDefaultAigcSpecNodeCapabilityPolicy();

  // Agent Crew Stage Activation policy default (pure data, stateless).
  // Driver is NOT default-assembled here — it is per-job lifecycle (design §2.D2).
  const agentCrewStageActivationPolicy =
    deps.agentCrewStageActivationPolicy ??
    createDefaultAgentCrewStageActivationPolicy();

  // SPEC Documents LLM policy default (pure data, dependency-free).
  const specDocumentsLlmPolicy =
    deps.specDocumentsLlmPolicy ?? createDefaultSpecDocumentsLlmPolicy();

  const baseCtx: BlueprintServiceContext = {
    now,
    blueprintStores: deps.blueprintStores ?? createDefaultBlueprintStores(),
    jobStore,
    llm: {
      callJson: deps.llm?.callJson ?? callLLMJson,
      getConfig: deps.llm?.getConfig ?? (() => getAIConfig()),
    },
    generateClarificationQuestions: deps.generateClarificationQuestions,
    // `routeSetLlmGenerator` is assigned below after `ctx` is fully built so
    // the default generator can bind to the finalized `llm` / `logger`.
    routeSetLlmGenerator: undefined,
    sandboxDerivationRunner:
      deps.sandboxDerivationRunner ?? createDefaultSandboxDerivationRunner(),
    replayStore: deps.replayStore ?? createJobBackedReplayStore(jobStore),
    eventBus: deps.eventBus ?? createBlueprintEventBus(jobStore, deps.logger),
    specsRoot:
      deps.specsRoot ?? path.resolve(process.cwd(), ".kiro", "specs"),
    logger,
    // Docker capability bridge 相关依赖：
    // - executorClient 采用 default-on 解析（Task 10.3）：`deps.executorClient`
    //   优先；否则当 `autoResolveExecutorClient !== false` 时由
    //   `resolveDefaultExecutorClient` 根据 env 状态决定；测试环境下 resolver
    //   返回 `undefined`，行为与今天等价（需求 10.6）。
    // - executorCallbackDispatcher / dockerCapabilityPolicy 默认装配（Task 13.1）；
    // - dockerCapabilityBridge 先占位为 undefined，下一步用 baseCtx 构造默认实例。
    executorClient: effectiveExecutorClient,
    executorCallbackDispatcher,
    dockerCapabilityPolicy,
    dockerCapabilityBridge: undefined,
    // —— MCP GitHub capability bridge 相关字段（本 spec 任务 17 默认装配）——
    // `mcpToolAdapter` / `httpFetcher` 未注入时保持 undefined；桥检测到两条真
    // 实路径都不可用时自动走 fallback（design §2.D2）。
    mcpToolAdapter: deps.mcpToolAdapter,
    httpFetcher: deps.httpFetcher,
    // Policy 是纯数据，默认值来自 `createDefaultMcpGithubCapabilityPolicy()`；
    // 支持通过 `BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED` + env overrides 调参。
    mcpGithubCapabilityPolicy:
      deps.mcpGithubCapabilityPolicy ??
      createDefaultMcpGithubCapabilityPolicy(),
    // Bridge 本体 — 懒绑定，下方填充。需要先构造 ctx 才能把 ctx 作为闭包入参
    // 传给 `createMcpGithubCapabilityBridge`。
    mcpGithubCapabilityBridge: deps.mcpGithubCapabilityBridge,
    // AIGC Spec Node capability: policy eagerly resolved, bridge late-bound.
    aigcSpecNodeCapabilityPolicy: aigcSpecNodePolicy,
    aigcSpecNodeCapabilityBridge: deps.aigcSpecNodeCapabilityBridge,
    // Role System Architecture capability: policy eagerly resolved, bridge late-bound.
    roleSystemArchitectureCapabilityPolicy:
      deps.roleSystemArchitectureCapabilityPolicy ??
      createDefaultRoleSystemArchitectureCapabilityPolicy(),
    roleSystemArchitectureCapabilityBridge:
      deps.roleSystemArchitectureCapabilityBridge,
    // Effect Preview LLM: policy eagerly resolved, service late-bound.
    effectPreviewLlmPolicy:
      deps.effectPreviewLlmPolicy ?? createDefaultEffectPreviewLlmPolicy(),
    effectPreviewLlmService: deps.effectPreviewLlmService,
    // Effect Preview Stage C ImageService: late-bound below after ctx
    // body is finalized (see `autopilot-image-rendering-and-visual-system`
    // spec Task 7.1).
    effectPreviewImageService: deps.effectPreviewImageService,
    // Agent Crew Stage Activation: policy eagerly resolved, driver NOT
    // default-assembled (per-job lifecycle; design §2.D2).
    agentCrewStageActivationPolicy,
    agentCrewStageActivationDriver: deps.agentCrewStageActivationDriver,
    // SPEC Tree LLM: policy eagerly resolved, service late-bound.
    specTreeLlmPolicy: deps.specTreeLlmPolicy ?? createDefaultSpecTreeLlmPolicy(),
    specTreeLlmService: deps.specTreeLlmService,
    // SPEC Documents LLM: policy eagerly resolved, service late-bound below
    // (needs finalized `ctx` for `llm` / `logger` / `now` closure).
    specDocumentsLlmPolicy,
    specDocumentsLlmService: deps.specDocumentsLlmService,
    // Prompt Package LLM: policy eagerly resolved, service late-bound below.
    promptPackageLlmPolicy:
      deps.promptPackageLlmPolicy ?? createDefaultPromptPackageLlmPolicy(),
    promptPackageLlmService: deps.promptPackageLlmService,
    // Engineering Handoff LLM: policy eagerly resolved, service late-bound below.
    engineeringHandoffLlmPolicy:
      deps.engineeringHandoffLlmPolicy ??
      createDefaultEngineeringHandoffLlmPolicy(),
    engineeringHandoffLlmService: deps.engineeringHandoffLlmService,
    // Task 10.2：运行时诊断 store。默认装配 in-memory 实例；
    // `attachDiagnosticsSubscriber` 在 ctx 完全装配后订阅 `ctx.eventBus`
    // 收集 capability / role 事件，供 Task 11 的 `GET /diagnostics` 路由消费。
    runtimeDiagnostics,
    // `autopilot-role-container-loader` spec Task 12.3：
    // - `roleRuntimeContextStore`：未注入时默认装配 in-memory Map store，供
    //   loader 的 provision / teardown / handoff 使用；测试可直接注入 spy。
    // - `skillRegistry`：只做类型透传，ctx 未装配时 skills-binder 走"全部跳过"
    //   路径（需求 5.3），默认装配由 `server/index.ts` composition root 负责。
    // - `roleContainerLoader`：先占位为 undefined，下方按 Tier 1 gate 懒装配。
    roleRuntimeContextStore:
      deps.roleRuntimeContextStore ?? createInMemoryRoleRuntimeContextStore(),
    skillRegistry: deps.skillRegistry,
    roleContainerLoader: deps.roleContainerLoader,
    roleAgentDelegator: deps.roleAgentDelegator,
    // `autopilot-agent-reasoning-stream` spec Task 6.1：CallbackReceiver
    // 仅作类型透传；未注入时 ctx 上保持 `undefined`，下游
    // `createAgentReasoningBridge` 自动走 env-off / no-op 路径。
    callbackReceiver: deps.callbackReceiver,
  };

  // Task 13.1 / 13.3 最后一步：用 baseCtx 构造默认 docker bridge（或透传注入的 bridge）。
  const dockerCapabilityBridge =
    deps.dockerCapabilityBridge ?? createDockerCapabilityBridge(baseCtx);

  const ctx: BlueprintServiceContext = {
    ...baseCtx,
    dockerCapabilityBridge,
  };

  // MCP GitHub capability bridge late-bind：必须在 ctx 组装完毕后构造，因为
  // `createMcpGithubCapabilityBridge(ctx)` 会闭包持有 ctx 引用，运行期从 ctx
  // 读取 `mcpToolAdapter` / `httpFetcher` / `mcpGithubCapabilityPolicy`。
  if (!ctx.mcpGithubCapabilityBridge) {
    ctx.mcpGithubCapabilityBridge = createMcpGithubCapabilityBridge(ctx);
  }

  // AIGC Spec Node bridge late-bind：bridge 闭包需要 ctx.aigcSpecNodeCapabilityPolicy /
  // ctx.llm / ctx.logger / ctx.now 都已就位。
  if (!ctx.aigcSpecNodeCapabilityBridge) {
    ctx.aigcSpecNodeCapabilityBridge = createAigcSpecNodeCapabilityBridge(ctx);
  }

  // Role System Architecture bridge late-bind: bridge closure needs
  // ctx.roleSystemArchitectureCapabilityPolicy / ctx.llm / ctx.logger / ctx.now.
  if (!ctx.roleSystemArchitectureCapabilityBridge) {
    ctx.roleSystemArchitectureCapabilityBridge =
      createRoleSystemArchitectureCapabilityBridge(ctx);
  }

  // Effect Preview LLM service late-bind: service closure reads
  // `ctx.effectPreviewLlmPolicy` / `ctx.llm` / `ctx.logger` from ctx on
  // each invocation. See `.kiro/specs/autopilot-effect-preview-llm/design.md`
  // §4.2 / §4.6 for the factory contract. The default service performs its
  // own tier-1 env-gate + tier-2 apiKey check, so wiring the instance here
  // does not incur LLM traffic in default deployments.
  if (!ctx.effectPreviewLlmService) {
    ctx.effectPreviewLlmService = createEffectPreviewLlmService(ctx);
  }

  // `autopilot-image-rendering-and-visual-system` spec Task 7.1 + Phase 4
  // Task 33.3：Effect Preview Stage C ImageService 默认装配。组装 4 条
  // stateless 依赖并注入 `createImageService(...)`，挂到 ctx 的 sibling
  // 字段上。与 `effectPreviewLlmService` 解耦，不修改 LLM 内容字段服务的形状。
  //
  // - `imageApiClient` 在工厂内部一次性读取 `IMAGE_GEN_*` env，所有调用
  //   共享冻结快照；env-disabled / key-missing 等档位短路在客户端内部处理，
  //   零 outgoing 请求（image-api-client.ts 已实现 6 级 fallback）。
  // - 其余 3 个工厂为纯函数 / stateless：模板库、SVG 草图器、调度器。
  // - `costTracker` 由 Phase 4 Task 33.3 接入：`createCostTrackerAdapter()`
  //   包装 `server/core/cost-tracker.ts` 的生产单例，把 Stage C 的
  //   `BlueprintCostTrackerLike.record(...)` 调用翻译为完整的 `CostRecord`
  //   并写入成本追踪链路。Phase 5 task 43 之后：image actualCost 来自
  //   `runRasterPipeline` 上游计算的 `lookupImagePricing(model)`（基于
  //   `shared/cost.ts` 的 IMAGE_PRICING_TABLE per-call 静态估算）；
  //   PRICING_TABLE / DEFAULT_PRICING 只用于填 `CostRecord` 的 token
  //   `unitPriceIn` / `unitPriceOut` schema 列（image 域 tokensIn/Out 固
  //   定为 0）；`tier` 命中时写入 `error` 字段，degraded calls 保留可审计
  //   fallback 原因。
  if (!ctx.effectPreviewImageService) {
    ctx.effectPreviewImageService = createImageService({
      imageApiClient: createImageApiClient(),
      promptTemplateLibrary: createPromptTemplateLibrary(),
      svgArchitectureDrafter: createSvgArchitectureDrafter(),
      scheduler: createEffectPreviewScheduler(),
      costTracker: createCostTrackerAdapter(
        deps.effectPreviewImageCostTracker !== undefined
          ? { tracker: deps.effectPreviewImageCostTracker }
          : undefined,
      ),
    });
  }

  // RouteSet LLM generator late-bind: the default generator needs the fully
  // assembled `ctx` (including llm / logger / dockerCapabilityBridge) so we
  // bind it here after `ctx` is finalized. See design 4.7 for the late-bind
  // rationale.
  ctx.routeSetLlmGenerator =
    deps.routeSetLlmGenerator ?? createRouteSetLlmGenerator(ctx);

  // SPEC Tree LLM: policy eagerly resolved (pure data), service late-bound.
  // The service closure needs ctx.llm / ctx.logger / ctx.now / ctx.specTreeLlmPolicy.
  if (!ctx.specTreeLlmService) {
    ctx.specTreeLlmService = createSpecTreeLlmService(ctx);
  }

  // SPEC Documents LLM service late-bind: service closure needs
  // ctx.specDocumentsLlmPolicy / ctx.llm / ctx.logger / ctx.now to be fully
  // resolved. The service performs its own tier-1 (env var not enabled) and
  // tier-2 (apiKey missing) early-exit to the template path, so always wiring
  // a default instance does not incur LLM traffic in default deployments.
  // See `.kiro/specs/autopilot-spec-documents-llm/design.md` §4.6.
  if (!ctx.specDocumentsLlmService) {
    ctx.specDocumentsLlmService = createSpecDocumentsLlmService(ctx);
  }

  // Prompt Package LLM service late-bind.
  if (!ctx.promptPackageLlmService) {
    ctx.promptPackageLlmService = createPromptPackageLlmService(ctx);
  }

  // Engineering Handoff LLM service late-bind.
  if (!ctx.engineeringHandoffLlmService) {
    ctx.engineeringHandoffLlmService = createEngineeringHandoffLlmService(ctx);
  }

  // ── `autopilot-llm-spec-generation` Task 5.2 / 5.3：装配 spec_tree /
  //    spec_docs LLM 工厂，并在装配阶段写入诊断 store 的 bridge configuration
  //    入口（让 `GET /api/blueprint/diagnostics` 首屏即可看到正确的
  //    `enabled` / `disabled` mode）。
  //
  //    设计要点：
  //    - `llmCall` 与 `liteAgentRuntime` 同源（design §2.D1）：构造一份
  //      `LlmCallFn`，再以同一实例 + ctx.mcpToolAdapter / ctx.skillRegistry
  //      装配 `LiteAgentRuntime`，最后把这份 `llmCall` 同时传给两个工厂；
  //    - `liteAgentRuntime` 是工厂的可选依赖（design `SpecTreeLlmDerivationDeps`
  //      / `SpecDocsLlmGenerationDeps` 中均为 `?`）。这里始终装配，方便 handler
  //      在 env-on 时直接走 ReAct 循环；env-off 路径上工厂自身会早退，不会
  //      触发任何 LLM / MCP / executor 副作用（needs Task 2.2 / 3.2）；
  //    - `recordBridgeConfiguration` 的 `enabledByConfig` 严格按 env flag
  //      与 `BUILD_TARGET` 计算；`dependencyReady` 仅做 "ctx 装配齐全" 的
  //      静态判定（runtimeDiagnostics / llm 依赖恒在），apiKey 在工厂内部
  //      Tier 1 早退处理（design §4.6）。
  if (!ctx.specTreeLlmDerivation || !ctx.specDocsLlmGeneration) {
    const sharedLlmCall = createLlmCall({
      llm: ctx.llm,
      logger: ctx.logger,
    });
    const sharedLiteAgentRuntime = createSharedLiteAgentRuntime(ctx, sharedLlmCall);

    if (!ctx.specTreeLlmDerivation) {
      ctx.specTreeLlmDerivation = createSpecTreeLlmDerivation({
        llmCall: sharedLlmCall,
        mcpToolAdapter: ctx.mcpToolAdapter,
        httpFetcher: ctx.httpFetcher,
        liteAgentRuntime: sharedLiteAgentRuntime,
        diagnostics: ctx.runtimeDiagnostics,
        logger: ctx.logger,
        now: ctx.now,
      });
    }

    if (!ctx.specDocsLlmGeneration) {
      ctx.specDocsLlmGeneration = createSpecDocsLlmGeneration({
        llmCall: sharedLlmCall,
        mcpToolAdapter: ctx.mcpToolAdapter,
        liteAgentRuntime: sharedLiteAgentRuntime,
        diagnostics: ctx.runtimeDiagnostics,
        logger: ctx.logger,
        now: ctx.now,
        eventBus: ctx.eventBus,
      });
    }
  }

  // Task 5.3：在 ctx 装配阶段写入 specTreeLlm / specDocsLlm 的 bridge
  // configuration，使 `GET /api/blueprint/diagnostics` 首屏即可显示正确
  // mode（`enabled` / `disabled`）。`enabledByConfig` 严格按需求 4.4 / 4.5
  // 计算：仅当 env flag 为 "true" 且 `BUILD_TARGET !== "test"` 时为 true。
  // `dependencyReady` 表示 ctx 装配阶段的依赖是否齐全；apiKey 缺失这种
  // 运行期态由工厂自身的 Tier 2 早退处理（design §4.6），此处不做。
  const isTestBuildTarget = process.env.BUILD_TARGET === "test";
  const specTreeLlmEnabledByConfig =
    process.env.BLUEPRINT_SPEC_TREE_LLM_ENABLED === "true" &&
    !isTestBuildTarget;
  const specDocsLlmEnabledByConfig =
    process.env.BLUEPRINT_SPEC_DOCS_LLM_ENABLED === "true" &&
    !isTestBuildTarget;
  // ctx.specTreeLlmDerivation / ctx.specDocsLlmGeneration 在上一步保证非空；
  // 同时 ctx.llm 与 ctx.runtimeDiagnostics 也必然就位，因此 dependencyReady
  // 可以在装配阶段静态判定为 true。
  ctx.runtimeDiagnostics.recordBridgeConfiguration("specTreeLlm", {
    enabledByConfig: specTreeLlmEnabledByConfig,
    dependencyReady: Boolean(ctx.specTreeLlmDerivation),
  });
  ctx.runtimeDiagnostics.recordBridgeConfiguration("specDocsLlm", {
    enabledByConfig: specDocsLlmEnabledByConfig,
    dependencyReady: Boolean(ctx.specDocsLlmGeneration),
  });

  // `autopilot-role-container-loader` spec Task 12.3 / 12.5：
  // 角色容器 loader 的 Tier 1 门禁懒装配。仅当下面两个条件同时满足时才
  // 构造默认 loader：
  //   1. 调用方没有显式注入 `deps.roleContainerLoader`（尊重测试 spy）；
  //   2. 环境变量 `BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED === "true"`
  //      （由 Task 16 的 server/index composition root 经 resolver 写回）。
  //
  // 测试默认（`BUILD_TARGET=test`）下 resolver 会把该 flag 强制锁为
  // `"false"`，因此 `buildBlueprintServiceContext({})` 返回的 ctx
  // `roleContainerLoader === undefined`，不会触发 dispatchPlan / probe 等
  // 任何副作用（需求 11.1）。
  if (
    !ctx.roleContainerLoader &&
    process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED === "true"
  ) {
    const defaultsCatalog = loadDefaultRoleCapabilityPackages(logger);
    ctx.roleContainerLoader = createRoleContainerLoader(ctx, defaultsCatalog);
  }

  // Task 10.4: attach the diagnostics subscriber now that every bridge /
  // service is late-bound and `ctx.eventBus` is stable. The subscriber
  // translates capability / role events emitted by the 5 `/autopilot`
  // bridges into `ctx.runtimeDiagnostics.recordBridgeInvocation(...)`
  // updates, without requiring any modification to the bridge
  // implementations themselves (design §4.6 / requirement 5.6).
  //
  // The unsubscribe handle is intentionally dropped: the diagnostics store
  // shares lifetime with the Node process per requirement 5.8, and
  // `BlueprintEventBus` has no documented teardown for the ctx lifecycle.
  // Should ctx teardown ever be introduced, the handle can be reinstated
  // on a private field without touching this module's public surface.
  attachDiagnosticsSubscriber(ctx.eventBus, ctx.runtimeDiagnostics, {
    logger,
  });

  // Agent-driven pipeline delegator（autopilot-agent-driven-pipeline Task 1.2）
  // 仅当 env flag 为 "true" 且非测试环境时装配，避免无谓开销。
  if (
    !ctx.roleAgentDelegator &&
    process.env.BLUEPRINT_AGENT_DRIVEN_PIPELINE_ENABLED === "true" &&
    process.env.BUILD_TARGET !== "test"
  ) {
    try {
      const llmCall = createLlmCall({ llm: ctx.llm, logger: ctx.logger });

      const routeSetGen = ctx.routeSetLlmGenerator!;
      ctx.roleAgentDelegator = createRoleAgentDelegator({
        roleRuntimeContextStore: ctx.roleRuntimeContextStore,
        executorClient: ctx.executorClient,
        realModeDispatcher: ctx.executorClient
          ? createExecutorRoleAgentDispatcher({
              executorClient: ctx.executorClient,
              logger: ctx.logger,
              now: ctx.now,
            })
          : undefined,
        liteAgentRuntime: createSharedLiteAgentRuntime(ctx, llmCall),
        resolveCallback: () => ({
          callbackUrl: ctx.callbackReceiver?.callbackUrl,
          callbackSecret:
            process.env.EXECUTOR_CALLBACK_SECRET ?? "dev-callback-secret-2026",
        }),
        fallbackLlmCall: async (delegateInput) => {
          const result = await routeSetGen({
            request: delegateInput.context.request as any,
            intake: delegateInput.context.intake as any,
            clarificationSession: delegateInput.context.clarificationSession as any,
            projectContext: delegateInput.context.projectContext as any,
            routeSetId: (delegateInput.context.routeSetId as string) ?? "fallback-routeset",
            primaryRouteId: (delegateInput.context.primaryRouteId as string) ?? "fallback-primary",
            createdAt: new Date().toISOString(),
          });
          return result.routes;
        },
        onDelegationRecorded: record => {
          ctx.runtimeDiagnostics.recordDelegation("roleAutonomousAgent", record);
        },
        logger: ctx.logger,
        now: ctx.now,
      });
    } catch (err) {
      logger.warn("[context] Failed to assemble roleAgentDelegator", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return ctx;
}

/**
 * 仅给测试使用：重置缓存的默认 jobStore，让下一次 `buildBlueprintServiceContext()`
 * 重新实例化 `createFileBlueprintJobStore()`。
 *
 * 不导出到生产代码。
 *
 * @internal
 */
export function __resetCachedDefaultBlueprintJobStore(): void {
  cachedDefaultJobStore = null;
}

/**
 * 占位：当实现中发现事件 `type` 不属于已定义的家族时触发。
 *
 * 任务 5 的 `createBlueprintEventBus` 会把这里换成真正的守卫。
 */
export function assertBlueprintEventType(
  type: BlueprintGenerationEventType
): BlueprintGenerationEventType {
  return type;
}
