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

import path from "node:path";

import { getAIConfig, type AIConfig } from "../../core/ai-config.js";
import { callLLMJson } from "../../core/llm-client.js";
import {
  createFileBlueprintJobStore,
  type BlueprintJobStore,
} from "../blueprint.js";
import type {
  BlueprintClarificationSession,
  BlueprintGenerationArtifact,
  BlueprintGenerationEvent,
  BlueprintGenerationEventType,
  BlueprintGenerationJob,
  BlueprintIntake,
  BlueprintProjectDomainContext,
} from "../../../shared/blueprint/index.js";
import { createBlueprintEventBus } from "./event-bus.js";
import {
  createAigcSpecNodeCapabilityBridge,
  type AigcSpecNodeCapabilityBridge,
} from "./aigc-spec-node/bridge.js";
import {
  createDefaultAigcSpecNodeCapabilityPolicy,
  type AigcSpecNodeCapabilityPolicy,
} from "./aigc-spec-node/policy.js";

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
  sandboxDerivationRunner: BlueprintSandboxDerivationRunner;
  replayStore: BlueprintReplayStore;
  eventBus: BlueprintEventBus;
  specsRoot: string;
  logger: BlueprintLogger;
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
  sandboxDerivationRunner?: BlueprintSandboxDerivationRunner;
  replayStore?: BlueprintReplayStore;
  eventBus?: BlueprintEventBus;
  specsRoot?: string;
  jobStoreFile?: string;
  logger?: BlueprintLogger;
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
  const jobStore = deps.jobStore ?? getDefaultJobStore(deps.jobStoreFile);
  // Resolve logger / now / llm first (existing order preserved), then wire
  // the AIGC policy (pure data, dependency-free), and finally the bridge —
  // which depends on a fully-assembled ctx (policy + llm + logger + now).
  const policy =
    deps.aigcSpecNodeCapabilityPolicy ??
    createDefaultAigcSpecNodeCapabilityPolicy();

  const ctx: BlueprintServiceContext = {
    now: deps.now ?? (() => new Date()),
    blueprintStores: deps.blueprintStores ?? createDefaultBlueprintStores(),
    jobStore,
    llm: {
      callJson: deps.llm?.callJson ?? callLLMJson,
      getConfig: deps.llm?.getConfig ?? (() => getAIConfig()),
    },
    generateClarificationQuestions: deps.generateClarificationQuestions,
    sandboxDerivationRunner:
      deps.sandboxDerivationRunner ?? createDefaultSandboxDerivationRunner(),
    replayStore: deps.replayStore ?? createJobBackedReplayStore(jobStore),
    eventBus: deps.eventBus ?? createBlueprintEventBus(jobStore, deps.logger),
    specsRoot:
      deps.specsRoot ?? path.resolve(process.cwd(), ".kiro", "specs"),
    logger: deps.logger ?? createSilentBlueprintLogger(),
    aigcSpecNodeCapabilityPolicy: policy,
  };

  // The bridge factory reads `ctx.aigcSpecNodeCapabilityPolicy` /
  // `ctx.llm` / `ctx.logger` / `ctx.now`, so it must be constructed after the
  // base context object exists. We assign to the already-returned object so
  // the bridge closes over the same `ctx` instance downstream code sees.
  ctx.aigcSpecNodeCapabilityBridge =
    deps.aigcSpecNodeCapabilityBridge ??
    createAigcSpecNodeCapabilityBridge(ctx);

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
