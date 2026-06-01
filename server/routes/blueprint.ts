import { Router, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getAIConfig } from "../core/ai-config.js";
import { callLLMJson } from "../core/llm-client.js";
import { defaultPreviewClarificationQuestions } from "./nl-command.js";
import { projectHandoffOntoJob } from "./blueprint/routeset/handoff-projection.js";
import {
  buildClarificationRouteContext,
  type BlueprintClarificationRouteContext,
} from "./blueprint/routeset/route-candidate.js";
export {
  buildClarificationRouteContext,
  buildRouteCandidate,
  type BlueprintClarificationRouteContext,
} from "./blueprint/routeset/route-candidate.js";
import {
  createRouteSetLlmGenerator,
  type RouteSetLlmGenerator,
} from "./blueprint/routeset/route-llm-generator.js";
import {
  buildBlueprintServiceContext,
  rebindBlueprintServiceContextRuntimeAdapters,
  type BlueprintServiceContext,
} from "./blueprint/context.js";
import { createAgentCrewStageActivationDriver } from "./blueprint/agent-crew-stage-activation/driver.js";
// `autopilot-llm-spec-generation` Task 6.2：以 `import type` 引入
// `SpecDocsLlmNodeOutput`，仅作为 `buildSpecDocument` 的可选参数注入 LLM
// 批量生成结果，不会触发 spec-docs-llm-generation.ts 内部 runtime 副作用。
import type { SpecDocsLlmNodeOutput } from "./blueprint/spec-docs-llm-generation.js";
import { fetchRepoContext } from "./blueprint/repo-context-fetcher.js";

// `autopilot-spec-document-export` Task 3.1：SPEC 文档导出归档服务层。
// 通过工厂注入既有 `extractSpecDocuments` + `jobStore.get` 拼装出
// `getJob` / `listSpecDocuments` deps，永不引入 store 副作用。
import { buildSpecExportArchive } from "./blueprint/spec-documents/export/spec-documents-export-archive.js";
import {
  createStageProgressEmitter,
  type StageProgressEmitter,
} from "./blueprint/stage-progress-emitter.js";
import { createSpecDocsProgressEmitter } from "./blueprint/spec-docs-progress-emitter.js";
import { assembleSpecDocumentsFromLlmCache } from "./blueprint/assemble-spec-documents-from-llm-cache.js";
import {
  createFileBlueprintJobStore,
  type BlueprintJobStore,
} from "./blueprint/job-store.js";
import { createFamilyHandler } from "./blueprint/family/family-route.js";
import { createReplanHandler } from "./blueprint/replan/replan-route.js";
import { createStaleArtifactsHandler } from "./blueprint/staleness/stale-artifacts-route.js";
import { runAutoInvalidationHook } from "./blueprint/stage-edit/auto-invalidation-hook.js";
import { isClarificationAnswersNoop } from "./blueprint/stage-edit/clarification-noop-detector.js";
import { detectRunningDownstreamForEdit } from "./blueprint/stage-edit/conflict-detection.js";
import { createIntakePatchHandler } from "./blueprint/stage-edit/intake-patch-route.js";
import {
  findJobsByClarificationSessionId,
  findJobsByIntakeId,
} from "./blueprint/stage-edit/job-locator.js";
import { logStageEditBlocked } from "./blueprint/stage-edit/stage-edit-logger.js";
import {
  buildCapabilityOutputSummary as fallbackBuildCapabilityOutputSummary,
  buildCapabilityInvocationLogs as fallbackBuildCapabilityInvocationLogs,
  deterministicCapabilityDuration as fallbackDeterministicCapabilityDuration,
} from "./blueprint/invocation-fallback-helpers.js";
import { BlueprintEventName } from "../../shared/blueprint/events.js";
import type {
  BlueprintArtifactDiff,
  BlueprintArtifactDiffRequest,
  BlueprintArtifactDiffResponse,
  BlueprintArtifactFeedback,
  BlueprintArtifactFeedbackRequest,
  BlueprintArtifactFeedbackResponse,
  BlueprintArtifactLedgerResponse,
  BlueprintArtifactLineageEdge,
  BlueprintArtifactMemoryEntry,
  BlueprintArtifactPayloadSummary,
  BlueprintArtifactDecisionReplay,
  BlueprintArtifactEvolutionReplay,
  BlueprintArtifactReplayResponse,
  BlueprintArtifactReplaySnapshot,
  BlueprintArtifactReplayTimelineEntry,
  BlueprintArtifactReplaysResponse,
  BlueprintArtifactSourceIds,
  BlueprintCapabilityUsage,
  BlueprintAgentCrew,
  BlueprintAgentCrewResponse,
  BlueprintAgentRole,
  BlueprintCapabilityBinding,
  BlueprintCapabilityEvidence,
  BlueprintCapabilityEvidenceResponse,
  BlueprintCapabilityInvocation,
  BlueprintCapabilityInvocationRequest,
  BlueprintCapabilityInvocationsResponse,
  BlueprintCapabilityRegistryResponse,
  BlueprintClarificationAnswer,
  BlueprintClarificationQuestion,
  BlueprintClarificationGenerationSource,
  BlueprintClarificationReadiness,
  BlueprintClarificationReadinessSignalId,
  BlueprintClarificationRouteDimension,
  BlueprintClarificationSession,
  BlueprintClarificationStrategyId,
  BlueprintFetchCapabilityEvidenceRequest,
  BlueprintFetchCapabilityInvocationsRequest,
  BlueprintGithubSource,
  BlueprintInvokeCapabilityResponse,
  BlueprintRuntimeCapability,
  BlueprintSandboxDerivationJob,
  BlueprintSandboxDerivationJobRequest,
  BlueprintSandboxDerivationJobResponse,
  BlueprintSandboxDerivationJobsResponse,
  BlueprintSandboxDerivationExecutionMode,
  BlueprintSandboxRoutePath,
  BlueprintCreateGenerationJobResponse,
  BlueprintCreateArtifactReplayRequest,
  BlueprintDomainAsset,
  BlueprintDomainEvidence,
  BlueprintIntake,
  BlueprintIntakeRequest,
  BlueprintProjectDomainContext,
  BlueprintEffectPreview,
  BlueprintEffectPreviewDependencyOrderEntry,
  BlueprintEffectPreviewRuntimeProjection,
  BlueprintEffectPreviewMilestone,
  BlueprintEffectPreviewNodeProgress,
  BlueprintEffectPreviewNode,
  BlueprintEffectPreviewPrototypeCue,
  BlueprintEffectPreviewSourceStatus,
  BlueprintEffectPreviewStatus,
  BlueprintEffectPreviewVersionStatus,
  BlueprintEffectPreviewVersionSync,
  BlueprintEffectPreviewsResponse,
  BlueprintEngineeringLandingPlan,
  BlueprintEngineeringLandingPlanStatus,
  BlueprintEngineeringLandingPlansResponse,
  BlueprintEngineeringLandingRiskLevel,
  BlueprintEngineeringLandingStep,
  BlueprintEngineeringLandingStepMode,
  BlueprintEngineeringRun,
  BlueprintEngineeringRunStatus,
  BlueprintEngineeringRunsResponse,
  BlueprintEngineeringVerificationResult,
  BlueprintGenerateEngineeringLandingPlansRequest,
  BlueprintGenerateImplementationPromptPackagesRequest,
  BlueprintGenerateEffectPreviewsRequest,
  BlueprintGenerationArtifact,
  BlueprintGenerationEvent,
  BlueprintGenerationEventFamily,
  BlueprintGenerationEventFilters,
  BlueprintGenerationEventsResponse,
  BlueprintGenerationJob,
  BlueprintGenerationArtifactLink,
  BlueprintGenerationNextAction,
  BlueprintGenerationNextActionOption,
  BlueprintGenerationRequest,
  BlueprintGenerationStage,
  BlueprintGenerationStatus,
  BlueprintReviewHandoffState,
  BlueprintLatestGenerationJobResponse,
  BlueprintRoleTimeline,
  BlueprintRoleTimelineCollection,
  BlueprintRoleTimelineEntry,
  BlueprintRoleTimelineFilters,
  BlueprintRoleTimelinesResponse,
  BlueprintRolePresence,
  BlueprintRolePresenceState,
  BlueprintStageActivationPolicy,
  BlueprintGenerationStagePayloadKind,
  BlueprintImplementationPromptItem,
  BlueprintImplementationPromptPackagesResponse,
  BlueprintImplementationPromptPackage,
  BlueprintImplementationPromptSection,
  BlueprintImplementationPromptSourceStatus,
  BlueprintImplementationPromptTarget,
  BlueprintImplementationPromptTargetPlatform,
  BlueprintPlatformHandoff,
  BlueprintReviewSpecDocumentRequest,
  BlueprintReviewSpecDocumentResponse,
  BlueprintRouteCandidate,
  BlueprintRouteComplexity,
  BlueprintRouteCostLevel,
  BlueprintRouteRiskLevel,
  BlueprintRouteSelection,
  BlueprintRouteSelectionRequest,
  BlueprintRouteSet,
  BlueprintRouteStep,
  BlueprintResetRouteSelectionResponse,
  BlueprintGenerateSpecDocumentsRequest,
  BlueprintSelectRouteResponse,
  BlueprintSaveSpecDocumentVersionResponse,
  BlueprintSpecDocument,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentsResponse,
  BlueprintSpecDocumentType,
  BlueprintSpecDocumentVersionSnapshot,
  BlueprintSpecTree,
  BlueprintSpecTreeActionRequest,
  BlueprintSpecTreeActionResponse,
  BlueprintSpecTreeNode,
  BlueprintSpecTreeNodeStatus,
  BlueprintSpecTreeNodeType,
  BlueprintSpecTreeVersionSnapshot,
  BlueprintSaveSpecTreeVersionResponse,
  BlueprintRecordEngineeringRunRequest,
  BlueprintRecordEngineeringRunResponse,
  BlueprintUpdateSpecTreeNodeRequest,
  BlueprintUpdateSpecTreeNodeResponse,
  NodeImageRecord,
} from "../../shared/blueprint/contracts.js";

export type BlueprintSpecStatus = "ready" | "partial" | "empty";

export interface BlueprintSpecDocs {
  requirements: boolean;
  design: boolean;
  tasks: boolean;
  config: boolean;
}

export interface BlueprintTaskStats {
  completed: number;
  total: number;
}

export interface BlueprintSpecSummary {
  id: string;
  title: string;
  phase: string;
  order: number;
  summary: string;
  path: string;
  docs: BlueprintSpecDocs;
  taskStats: BlueprintTaskStats;
  status: BlueprintSpecStatus;
}

export interface BlueprintSpecsResponse {
  generatedAt: string;
  root: string;
  totalSpecs: number;
  totalDocs: number;
  completedTasks: number;
  totalTasks: number;
  specs: BlueprintSpecSummary[];
}

export interface BlueprintRouterDeps {
  specsRoot?: string;
  now?: () => Date;
  jobStore?: BlueprintJobStore;
  generateClarificationQuestions?: BlueprintClarificationQuestionGenerator;
  /**
   * RouteSet LLM driven generator. When omitted, `createBlueprintRouter` uses
   * `buildBlueprintServiceContext` (see design sections 4.3 and 4.6) to wire
   * a default instance that shares `jobStore` / `now` / `specsRoot` with the
   * router. Tests can inject a mock here to fully short-circuit LLM calls.
   */
  routeSetLlmGenerator?: RouteSetLlmGenerator;
  /**
   * 可选：注入一个预构建的 `BlueprintServiceContext`。
   *
   * 未提供时 `createBlueprintRouter(deps)` 仍按今天的本地 state 构造路径装配，
   * 不会主动构造 context（保持既有 43 条 E2E 用例默认装配等价）。
   *
   * 提供时：
   * - `server/index.ts` 主服务入口在装配 blueprint router 时，会通过
   *   `buildBlueprintServiceContext({})` 预先构造 ctx 并把同一实例传入；
   * - 同一 ctx 实例也会被 `/api/executor/events` 后续中间件用于访问
   *   `ctx.executorCallbackDispatcher.handleEvent(event)`（design §4.5 接线策略），
   *   从而保证 router 内 Task 15 起的 docker capability bridge 消费到的 dispatcher
   *   与回调中间件使用的是同一实例；
   * - Task 15 起的子模块（例如 `createRouteGenerationSandboxDerivation`）可以通过
   *   ctx 读取 `executorCallbackDispatcher` / `dockerCapabilityBridge` /
   *   `dockerCapabilityPolicy` / `executorClient` 与主服务共享运行期依赖。
   *
   * 引用类型 `BlueprintServiceContext` 来自 `./blueprint/context.js`；这里只以
   * `import type` 形式引用，不引入运行期循环依赖（context.ts 已经 import 回
   * blueprint.ts 的 `createFileBlueprintJobStore` / `BlueprintJobStore`）。
   */
  blueprintServiceContext?: BlueprintServiceContext;
  /**
   * MCP GitHub capability bridge inputs (autopilot-capability-bridge-mcp).
   * All four fields are optional; when omitted the bridge falls back to the
   * deterministic templated invocation path (design §2.D10).
   */
  mcpToolAdapter?: BlueprintMcpToolAdapterDependency;
  httpFetcher?: BlueprintHttpFetcherDependency;
  mcpGithubCapabilityPolicy?: BlueprintMcpGithubCapabilityPolicyDependency;
  mcpGithubCapabilityBridge?: BlueprintMcpGithubCapabilityBridgeDependency;
}

// Structural re-exports so callers (e.g. server/index.ts) don't need a deep
// `import` of `server/routes/blueprint/context.ts` to feed the router.
export type BlueprintMcpToolAdapterDependency =
  import("./blueprint/context.js").McpToolAdapterDependency;
export type BlueprintHttpFetcherDependency =
  import("./blueprint/mcp-github-source/http-fetcher.js").BlueprintHttpFetcher;
export type BlueprintMcpGithubCapabilityPolicyDependency =
  import("./blueprint/mcp-github-source/policy.js").McpGithubCapabilityPolicy;
export type BlueprintMcpGithubCapabilityBridgeDependency =
  import("./blueprint/mcp-github-source/bridge.js").McpGithubCapabilityBridge;

export type BlueprintClarificationQuestionGenerator = (
  input: BlueprintClarificationQuestionGeneratorInput
) => Promise<BlueprintClarificationQuestionGenerationResult>;

interface BlueprintClarificationQuestionGeneratorInput {
  intake: BlueprintIntake;
  strategy: BlueprintClarificationStrategyTemplate;
  templateQuestions: BlueprintClarificationQuestion[];
  now: string;
  /** User's preferred locale for generated questions. Defaults to "en-US". */
  locale?: "zh-CN" | "en-US";
}

interface BlueprintClarificationQuestionGenerationResult {
  questions: BlueprintClarificationQuestion[];
  source: BlueprintClarificationGenerationSource;
  model?: string;
  promptId?: string;
  error?: string;
}

interface BlueprintIntakeStores {
  intakes: Map<string, BlueprintIntake>;
  clarificationSessions: Map<string, BlueprintClarificationSession>;
  projectContexts: Map<string, BlueprintProjectDomainContext>;
}

interface BlueprintConfigMetadata {
  title?: string;
  name?: string;
  phase?: string;
  order?: number | string;
  summary?: string;
}

interface BlueprintPhaseMetadata {
  phase: string;
  order: number;
}

const CONFIG_FILE = ".config.kiro";
const KNOWN_WORD_LABELS: Record<string, string> = {
  api: "API",
  aigc: "AIGC",
  github: "GitHub",
  mcp: "MCP",
  spec: "SPEC",
  specs: "SPECS",
  ui: "UI",
};

const BLUEPRINT_METADATA: Record<string, BlueprintPhaseMetadata> = {
  "blueprint-input-github-ingestion": { phase: "intake", order: 1 },
  "blueprint-clarification-workflow": { phase: "intake", order: 2 },
  "blueprint-autopilot-route-orchestrator": { phase: "planning", order: 3 },
  "blueprint-domain-and-asset-store": { phase: "planning", order: 4 },
  "blueprint-spec-tree-workbench": { phase: "planning", order: 5 },
  "blueprint-spec-document-generator": { phase: "planning", order: 6 },
  "blueprint-effect-preview-generator": { phase: "generation", order: 7 },
  "blueprint-implementation-prompt-packager": {
    phase: "generation",
    order: 8,
  },
  "blueprint-generation-api-and-job-contract": {
    phase: "generation",
    order: 9,
  },
  "blueprint-runtime-capability-bridge": { phase: "execution", order: 10 },
  "blueprint-engineering-landing-bridge": { phase: "execution", order: 11 },
  "blueprint-artifact-memory-and-replay": { phase: "execution", order: 12 },
};

const DOC_NAMES: Array<keyof BlueprintSpecDocs> = [
  "requirements",
  "design",
  "tasks",
  "config",
];

const SPEC_DOCUMENT_TYPES: BlueprintSpecDocumentType[] = [
  "requirements",
  "design",
  "tasks",
];

const PROMPT_TARGET_PLATFORMS: BlueprintImplementationPromptTargetPlatform[] = [
  "codex",
  "claude",
  "cursor",
  "kiro",
  "trae",
  "windsurf",
];

const defaultJobStore = createFileBlueprintJobStore();

// Re-export the job-store factories so existing callers can keep importing
// from this router file. Physical impl lives in `./blueprint/job-store.ts`
// to avoid a circular module-value import between `blueprint.ts` and
// `./blueprint/context.ts`.
export {
  createFileBlueprintJobStore,
  createMemoryBlueprintJobStore,
  type BlueprintJobStore,
} from "./blueprint/job-store.js";

import { createImageSettingsHandler } from "./blueprint/image-settings.js";

export function createBlueprintRouter(deps: BlueprintRouterDeps = {}): Router {
  const router = Router();
  const jobStore = deps.jobStore ?? defaultJobStore;
  const blueprintStores: BlueprintIntakeStores = {
    intakes: new Map<string, BlueprintIntake>(),
    clarificationSessions: new Map<string, BlueprintClarificationSession>(),
    projectContexts: new Map<string, BlueprintProjectDomainContext>(),
  };
  const hydrateBlueprintStoresForJob = (job: BlueprintGenerationJob): void => {
    hydrateBlueprintStoresFromJob(job, blueprintStores);
  };
  const resolveStoredOrPersistedIntake = (
    intakeId: string
  ): BlueprintIntake | undefined => {
    const stored = blueprintStores.intakes.get(intakeId);
    if (stored) return stored;

    const job = findJobsByIntakeId(jobStore, intakeId)[0];
    if (job) {
      hydrateBlueprintStoresForJob(job);
    }

    return blueprintStores.intakes.get(intakeId);
  };
  const resolveStoredOrPersistedClarificationSession = (
    sessionId: string
  ): BlueprintClarificationSession | undefined => {
    const stored = blueprintStores.clarificationSessions.get(sessionId);
    if (stored) return stored;

    const job = findJobsByClarificationSessionId(jobStore, sessionId)[0];
    if (job) {
      hydrateBlueprintStoresForJob(job);
    }

    return blueprintStores.clarificationSessions.get(sessionId);
  };
  // Resolution order for `routeSetLlmGenerator` (design sections 4.3 + 4.6):
  // 1. Prefer `deps.routeSetLlmGenerator` so tests can inject a mock that
  //    completely short-circuits LLM calls.
  // 2. Otherwise construct a minimal `BlueprintServiceContext` sharing
  //    `jobStore` / `now` / `specsRoot` with the router. The context factory
  //    auto-wires a default `createRouteSetLlmGenerator(ctx)` instance which
  //    is read here. The context only powers the generator (touches
  //    `ctx.llm` / `ctx.logger` only), so it will not conflict with the
  //    router-owned `blueprintStores` above.
  //
  // Resolution is lazy (wrapped in a getter) because `blueprint.ts` ends with
  // `const router = createBlueprintRouter();` at module scope; evaluating
  // `buildBlueprintServiceContext` eagerly during that module-level call would
  // trip the `context.ts` -> `blueprint.ts` circular import (context.ts imports
  // `createFileBlueprintJobStore` / `BlueprintJobStore` from `../blueprint.js`).
  // Deferring to first use keeps the behavior identical for any real request
  // path while letting barrel consumers (`server/routes/blueprint/index.ts`)
  // import `./context.js` first without hitting an uninitialized binding.
  let cachedRouteSetLlmGenerator: RouteSetLlmGenerator | null =
    deps.routeSetLlmGenerator ?? null;
  const resolveRouteSetLlmGenerator = (): RouteSetLlmGenerator => {
    if (cachedRouteSetLlmGenerator) {
      return cachedRouteSetLlmGenerator;
    }
    cachedRouteSetLlmGenerator = buildBlueprintServiceContext({
      jobStore,
      now: deps.now,
      specsRoot: deps.specsRoot,
    }).routeSetLlmGenerator as RouteSetLlmGenerator;
    return cachedRouteSetLlmGenerator;
  };

  // Task 14.2 / 15（design §4.5 接线策略）：
  // 可选预构建的 `BlueprintServiceContext`。当 `server/index.ts` 通过
  // `buildBlueprintServiceContext({})` 构造并注入时，同一实例也被
  // `/api/executor/events` 回调中间件持有，保证 Docker capability bridge
  // 消费到的 `executorCallbackDispatcher` 与主服务回调分发器为同一对象。
  //
  // Task 15 起：该 ctx 经 `createGenerationJob(options)` 透传到
  // `createRouteGenerationSandboxDerivation`，由后者在 `capability.id ===
  // "docker-analysis-sandbox"` 分支委派给 `ctx.dockerCapabilityBridge`；
  // 其它 capability 分支继续走模板化 simulated 路径（design §D10）。
  //
  // autopilot-capability-bridge-mcp task 19：若调用方未注入预构建 ctx，则本地构造
  // 一个最小 ctx，把 mcpToolAdapter / httpFetcher / mcpGithubCapabilityPolicy /
  // mcpGithubCapabilityBridge 等 MCP 桥依赖转发给
  // `createRouteGenerationSandboxDerivation`，从而 `mcp-github-source` 能力可从
  // 模板 fallback 升级为真实 MCP / HTTP 调用。
  const blueprintServiceContext =
    deps.blueprintServiceContext ??
    buildBlueprintServiceContext({
      now: deps.now,
      blueprintStores,
      jobStore,
      mcpToolAdapter: deps.mcpToolAdapter,
      httpFetcher: deps.httpFetcher,
      mcpGithubCapabilityPolicy: deps.mcpGithubCapabilityPolicy,
      mcpGithubCapabilityBridge: deps.mcpGithubCapabilityBridge,
    });
  if (deps.blueprintServiceContext) {
    rebindBlueprintServiceContextRuntimeAdapters(blueprintServiceContext, {
      mcpToolAdapter: deps.mcpToolAdapter,
      httpFetcher: deps.httpFetcher,
    });
  }

  router.get("/specs", async (_req, res) => {
    try {
      const payload = await collectBlueprintSpecs(deps);
      res.json(payload);
    } catch (error) {
      res.status(500).json({
        error: "Failed to read blueprint specs.",
        message: errorMessage(error),
      });
    }
  });

  router.get("/capabilities", (_req, res) => {
    const capabilities = getDefaultRuntimeCapabilities();
    res.json({
      capabilities,
      agentCrew: buildAgentCrew({
        jobId: "blueprint-capability-catalog",
        stage: "runtime_capability",
        createdAt: (deps.now?.() ?? new Date()).toISOString(),
        capabilities,
      }),
    } satisfies BlueprintCapabilityRegistryResponse);
  });

  // Task 11（design §4.7 / requirement 5.1 / 5.4 / 5.9）：暴露运行时诊断 snapshot。
  //
  // 该端点返回 `ctx.runtimeDiagnostics.snapshot(ctx.now)` 的深拷贝结果，用于让运维
  // 或排障人员快速判断 5 条 `/autopilot` capability bridge（docker / mcpGithub /
  // role / aigcNode / agentCrewStageActivation）当前处于 real、fallback、enabled
  // 还是 disabled 状态。
  //
  // 约束：
  // - 只读：SHALL NOT 触发 bridge 调用、SHALL NOT 改动运行时状态。
  // - 不鉴权：本 spec 不引入新的鉴权中间件（requirement 5.9），与 /capabilities
  //   / /specs 等只读端点保持一致。
  // - 故障隔离：snapshot 内部抛错时返回 HTTP 500 + 固定错误结构，不交由
  //   Express 默认错误处理（requirement 5.9）。
  router.get("/diagnostics", (_req, res) => {
    try {
      const snapshot = blueprintServiceContext.runtimeDiagnostics.snapshot(
        blueprintServiceContext.now,
      );
      res.status(200).json(snapshot);
    } catch {
      res.status(500).json({ error: "diagnostics unavailable" });
    }
  });

  // Phase 4 / Task 35.1（spec: autopilot-image-rendering-and-visual-system）：
  //
  // 暴露 `IMAGE_GEN_*` 环境变量的当前生效快照（脱敏后），用于让
  // autopilot 右栏 `AutopilotImageSettingsPanel` 在不直连 `process.env`
  // 的前提下展示 image generation 配置。
  //
  // 安全约束：原始 `IMAGE_GEN_API_KEY` MUST NEVER 出现在响应体里；
  // handler 内部把 `getResolvedConfig().apiKey` 就地用 `maskApiKey()`
  // 转成 `maskedApiKey: string | null`，参见
  // `./blueprint/image-settings.ts` 的实现说明。
  router.get("/image-settings", createImageSettingsHandler());

  router.post("/intake", (req, res) => {
    const parsed = parseIntakeRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint intake request.",
        message: parsed.message,
      });
      return;
    }

    const intake = createBlueprintIntake(parsed.request, {
      now: deps.now,
      stores: blueprintStores,
    });
    const projectContext = intake.projectId
      ? blueprintStores.projectContexts.get(intake.projectId)
      : undefined;

    res.status(201).json({ intake, projectContext });
  });

  router.get("/intake/:intakeId", (req, res) => {
    const intake = resolveStoredOrPersistedIntake(req.params.intakeId);
    if (!intake) {
      res.status(404).json({
        error: "Blueprint intake not found.",
        message: `No blueprint intake exists for ${req.params.intakeId}.`,
      });
      return;
    }
    const projectContext = intake.projectId
      ? blueprintStores.projectContexts.get(intake.projectId)
      : undefined;

    res.json({ intake, projectContext });
  });

  const intakePatchHandler = createIntakePatchHandler({
    blueprintStores,
    jobStore,
    ctx: blueprintServiceContext,
  });
  router.patch(
    "/intake/:intakeId",
    (req, res, next) => {
      resolveStoredOrPersistedIntake(req.params.intakeId);
      return intakePatchHandler(req, res, next);
    },
  );

  router.post("/intake/:intakeId/clarifications", async (req, res) => {
    const intake = resolveStoredOrPersistedIntake(req.params.intakeId);
    if (!intake) {
      res.status(404).json({
        error: "Blueprint intake not found.",
        message: `No blueprint intake exists for ${req.params.intakeId}.`,
      });
      return;
    }

    const parsed = parseClarificationSessionRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint clarification session request.",
        message: parsed.message,
      });
      return;
    }

    // `autopilot-llm-spec-generation`：在生成澄清问题前，先通过 MCP 扫描仓库，
    // 把仓库上下文注入到 intake 的 domainNotes 中，让 LLM 基于真实代码结构
    // 提出更有针对性的澄清问题。失败时不阻塞，继续走无仓库上下文路径。
    //
    // 修正记录：参见 `.kiro/specs/autopilot-streaming-experience/integration-gap-2026-05-16.md`
    // 中的 P0 #2 —— 历史上这里曾以 `firstGithubUrl && deps.mcpToolAdapter` 为门槛,
    // 但 `deps.mcpToolAdapter` 在 per-handler `deps` 作用域下始终为 undefined（仅
    // router 顶层 `blueprintServiceContext` 才能拿到适配器），导致仓库扫描整段被
    // 跳过、`intake.domainNotes` 退化为空、`assets[1].summary` 仅剩 placeholder。
    // 由于 `fetchRepoContext`（见 `server/routes/blueprint/repo-context-fetcher.ts`）
    // 已直接走 GitHub REST API、其首参 `_mcpToolAdapter` 仅保留签名兼容性、并未真正
    // 使用 MCP 适配器，因此此处只需要 `firstGithubUrl` 即可放行仓库上下文抓取。
    //
    // autopilot-streaming-experience integration-gap-2026-05-16：仓库扫描的事件
    // 此前 stageId 写为 "clarification"，导致这些"为澄清做准备"的扫描进度
    // 在前端落到澄清卡片底部，让用户误判为"输入时的执行过程"。从用户视角看，
    // 仓库扫描属于 intake 输入归一化的一部分（用户提交 URL 后系统在做的事），
    // 因此把 stageId 调整为 "intake_created"，让事件挂在"输入记录"卡片下。
    const firstGithubUrl = intake.githubUrls?.[0];
    if (firstGithubUrl) {
      // 创建进度发射器，让前端实时看到仓库扫描过程
      const emitter = blueprintServiceContext?.eventBus
        ? createStageProgressEmitter(blueprintServiceContext.eventBus, intake.id, "intake_created", "analyzer")
        : undefined;

      emitter?.thinking("正在扫描 GitHub 仓库，获取项目结构和技术栈信息...");
      try {
        const repoCtx = await fetchRepoContext(
          deps.mcpToolAdapter,
          firstGithubUrl,
          blueprintServiceContext?.logger ?? { debug() {}, info() {}, warn() {}, error() {} },
          15000,
        );
        if (repoCtx?.promptSummary) {
          intake.domainNotes = [
            ...(intake.domainNotes ?? []),
            `[仓库分析] ${repoCtx.promptSummary.slice(0, 4000)}`,
          ];
          emitter?.observing(true, `仓库扫描完成：${repoCtx.treeDigest.slice(0, 200)}`);
        } else {
          emitter?.observing(false, "仓库扫描未返回有效数据，将基于 URL 信息生成澄清问题");
        }
      } catch {
        emitter?.observing(false, "仓库扫描失败，将基于 URL 信息生成澄清问题");
      }
      emitter?.thinking("基于仓库分析结果，正在生成针对性的澄清问题...");
    }

    try {
      const session = await createClarificationSession(intake, {
        now: deps.now,
        stores: blueprintStores,
        request: parsed.request,
        locale: parsed.request.locale,
        generateQuestions:
          deps.generateClarificationQuestions ??
          generateClarificationQuestionsWithLlm,
      });

      res.status(201).json({ session });
    } catch (error) {
      res.status(500).json({
        error: "Failed to create blueprint clarification session.",
        message: errorMessage(error),
      });
    }
  });

  router.get("/clarifications/:sessionId", (req, res) => {
    const session = resolveStoredOrPersistedClarificationSession(
      req.params.sessionId
    );
    if (!session) {
      res.status(404).json({
        error: "Blueprint clarification session not found.",
        message: `No blueprint clarification session exists for ${req.params.sessionId}.`,
      });
      return;
    }

    res.json({ session });
  });

  const handleClarificationAnswers = (req: Request, res: Response) => {
    const session = resolveStoredOrPersistedClarificationSession(
      req.params.sessionId
    );
    if (!session) {
      res.status(404).json({
        error: "Blueprint clarification session not found.",
        message: `No blueprint clarification session exists for ${req.params.sessionId}.`,
      });
      return;
    }

    const parsed = parseClarificationAnswersRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint clarification answers request.",
        message: parsed.message,
      });
      return;
    }

    const matchingJobs = findJobsByClarificationSessionId(
      jobStore,
      req.params.sessionId,
    );
    for (const job of matchingJobs) {
      const runningStage = detectRunningDownstreamForEdit(job, "clarification");
      if (runningStage) {
        logStageEditBlocked(blueprintServiceContext, {
          jobId: job.id,
          fromStage: "clarification",
          triggeringEndpoint: "clarification_answers",
          runningStage,
        });
        res.status(409).json({
          error: "downstream_running",
          runningStage,
        });
        return;
      }
    }

    const previousAnswers = session.answers;
    const updated = updateClarificationSession(session, parsed.request.answers, {
      now: deps.now,
      stores: blueprintStores,
    });

    const staleArtifactIds = new Set<string>();
    const staleArtifactIdsSnapshot = new Set<string>();
    const isNoop = isClarificationAnswersNoop(
      previousAnswers,
      parsed.request.answers,
    );

    if (!isNoop) {
      for (const job of matchingJobs) {
        const jobWithUpdatedSession = replaceClarificationSessionArtifact(
          job,
          updated
        );
        const triggeringArtifact = jobWithUpdatedSession.artifacts.find(
          artifact => artifact.type === "clarification_session"
        );
        const result = runAutoInvalidationHook({
          job: jobWithUpdatedSession,
          fromStage: "clarification",
          reason: "upstream_clarification_changed",
          triggeringEndpoint: "clarification_answers",
          triggeringArtifactId: triggeringArtifact?.id ?? req.params.sessionId,
          triggeringArtifactType: "clarification_session",
          jobStore,
          ctx: blueprintServiceContext,
        });
        if (jobWithUpdatedSession !== job && result.job === jobWithUpdatedSession) {
          jobStore.save(jobWithUpdatedSession);
        }

        for (const artifactId of result.newlyStaleArtifactIds) {
          staleArtifactIds.add(artifactId);
        }
        for (const artifactId of result.job.staleArtifactIds ?? []) {
          staleArtifactIdsSnapshot.add(artifactId);
        }
      }
    }

    if (staleArtifactIds.size > 0) {
      res.json({
        session: updated,
        staleEdit: {
          fromStage: "clarification",
          newlyStaleArtifactIds: [...staleArtifactIds],
          newlyStaleArtifactCount: staleArtifactIds.size,
          staleArtifactIdsSnapshot: [...staleArtifactIdsSnapshot],
        },
      });
      return;
    }

    res.json({ session: updated });
  };

  router.post("/clarifications/:sessionId/answers", handleClarificationAnswers);
  router.patch("/clarifications/:sessionId/answers", handleClarificationAnswers);

  router.get("/projects/:projectId/context", (req, res) => {
    const context =
      blueprintStores.projectContexts.get(req.params.projectId) ??
      createEmptyProjectContext(req.params.projectId, deps.now?.() ?? new Date());

    res.json({ context });
  });

  const handleCreateGenerationJob = async (req: Request, res: Response) => {
    const parsed = parseGenerationRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint generation request.",
        message: parsed.message,
      });
      return;
    }

    const resolved = resolveGenerationRequest(parsed.request, blueprintStores);
    if (!resolved.ok) {
      res.status(resolved.status).json({
        error: resolved.error,
        message: resolved.message,
      });
      return;
    }

    try {
      // `autopilot-llm-spec-generation`：在生成路线前注入仓库上下文到 intake.domainNotes，
      // 让路线规划基于真实代码结构。复用澄清阶段相同的 MCP 抓取逻辑。
      //
      // 修正记录：参见 `.kiro/specs/autopilot-streaming-experience/integration-gap-2026-05-16.md`
      // 中的 P0 #2 —— 与澄清阶段同源问题：`deps.mcpToolAdapter` 在 per-handler `deps`
      // 作用域下为 undefined，导致路线生成阶段也跳过仓库扫描、`intake.domainNotes`
      // 与流式 emitter 事件全部丢失。`fetchRepoContext` 直接通过 GitHub REST API
      // 抓取，并未真正消费 MCP 适配器，因此移除 `&& deps.mcpToolAdapter` 守卫不会
      // 引入额外依赖。
      const firstUrl = resolved.intake?.githubUrls?.[0];
      // 创建进度发射器，让前端实时看到路线规划过程
      const routeProgressScopeId =
        resolved.request.intakeId ??
        resolved.intake?.id ??
        resolved.request.clarificationSessionId ??
        "route-generation";
      const routeEmitter = blueprintServiceContext?.eventBus
        ? createStageProgressEmitter(blueprintServiceContext.eventBus, routeProgressScopeId, "route_generation", "planner")
        : undefined;

      if (firstUrl && resolved.intake) {
        routeEmitter?.thinking("正在获取仓库上下文，为路线规划提供代码结构依据...");
        try {
          const repoCtx = await fetchRepoContext(
            deps.mcpToolAdapter,
            firstUrl,
            blueprintServiceContext?.logger ?? { debug() {}, info() {}, warn() {}, error() {} },
            15000,
          );
          if (repoCtx?.promptSummary) {
            resolved.intake.domainNotes = [
              ...(resolved.intake.domainNotes ?? []),
              `[仓库分析] ${repoCtx.promptSummary.slice(0, 4000)}`,
            ];
            routeEmitter?.observing(true, `仓库上下文已获取，包含 ${repoCtx.keyFiles.length} 个关键文件`);
          }
        } catch {
          routeEmitter?.observing(false, "仓库上下文获取失败，将基于澄清答案规划路线");
        }
      }

      // 第一轮：发起规划。承接 thinking → acting → observing(LLM 返回) → completed。
      routeEmitter?.thinking("正在基于仓库分析和澄清答案，规划候选路线...");
      routeEmitter?.acting("llm.route_generation");

      const requestLocale = resolveRequestLocale(req.body);

      const result = await createGenerationJob(resolved.request, {
        now: deps.now,
        store: jobStore,
        context: resolved.context,
        intake: resolved.intake,
        clarificationSession: resolved.clarificationSession,
        routeSetLlmGenerator: resolveRouteSetLlmGenerator(),
        ctx: blueprintServiceContext,
        locale: requestLocale,
      });

      const generatedRoutes = result.routeSet?.routes ?? [];
      // 真实路线名（不造数）：把候选路线标题折成可读列表，让观察行携带
      // "生成了 N 条候选路线：主路线 / 保守路线 / ..." 而不是只报一个总数。
      const routeTitles = generatedRoutes
        .map(route => route.title)
        .filter((title): title is string => typeof title === "string" && title.length > 0);
      const routeTitleSummary =
        routeTitles.length > 0 ? `：${routeTitles.join(" / ")}` : "";
      routeEmitter?.observing(
        true,
        `路线规划完成：生成了 ${generatedRoutes.length} 条候选路线${routeTitleSummary}`,
      );

      // 第二轮：分析候选路线形态。reasoning-detail 2026-05-31 增量 —— 让用户在
      // "规划完成"之后看到一段真实的"对路线集做评估"步骤，而不是直接 completed。
      // 这一轮的事实来自 generatedRoutes 自身（kind / complexity / costLevel），
      // 完全不造步骤、不造数据；如果路线集为空则跳过该轮，避免出现"空规划评估"。
      const routeShapeSummary = summarizeRouteSetShape(generatedRoutes);
      if (routeShapeSummary !== null) {
        routeEmitter?.nextIteration();
        routeEmitter?.thinking(
          "正在评估候选路线的复杂度与成本分布，标记主路线和备选路线...",
        );
        routeEmitter?.acting("blueprint.route_set.analyze");
        routeEmitter?.observing(true, routeShapeSummary);
      }

      routeEmitter?.completed(
        `路线规划完成，共 ${generatedRoutes.length} 条候选路线`,
      );

      res.status(201).json(result);
    } catch (error) {
      // The generator internally swallows LLM errors / schema failures and
      // falls back to templated routes, so this 500 branch is reserved for
      // unexpected exceptions outside the generator boundary (design 5.4).
      res.status(500).json({
        error: "Failed to create blueprint generation job.",
        message: errorMessage(error),
      });
    }
  };

  const handleJobDetails = (req: Request, res: Response) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    res.json(createJobDetailsPayload(job, blueprintStores));
  };

  const handleJobEvents = (req: Request, res: Response) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const parsed = parseGenerationEventFilters(req.query);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint generation event filters.",
        message: parsed.message,
      });
      return;
    }

    res.json({
      job,
      events: filterGenerationEvents(job.events, parsed.filters),
      filters: parsed.filters,
    } satisfies BlueprintGenerationEventsResponse);
  };

  const handleAgentCrew = (req: Request, res: Response) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const registry = getOrCreateCapabilityRegistry(job, {
      now: deps.now,
      store: jobStore,
    });
    const latestJob = registry.job;
    const agentCrew = extractAgentCrew(latestJob) ?? registry.agentCrew;

    res.json({
      job: latestJob,
      routeSet: extractRouteSet(latestJob),
      specTree: extractSpecTree(latestJob),
      agentCrew,
      roleTimelines: extractRoleTimelines(latestJob),
    } satisfies BlueprintAgentCrewResponse);
  };

  const handleRoleTimelines = (req: Request, res: Response) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const parsed = parseRoleTimelineFilters(req.query);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint role timeline filters.",
        message: parsed.message,
      });
      return;
    }

    const roleTimelines = filterRoleTimelines(
      extractRoleTimelines(job),
      parsed.filters
    );

    res.json({
      job,
      routeSet: extractRouteSet(job),
      specTree: extractSpecTree(job),
      agentCrew: extractAgentCrew(job),
      roleTimelines,
      filters: parsed.filters,
    } satisfies BlueprintRoleTimelinesResponse);
  };

  const handleJobEventStream = (req: Request, res: Response) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const parsed = parseGenerationEventFilters(req.query);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint generation event filters.",
        message: parsed.message,
      });
      return;
    }

    const events = filterGenerationEvents(job.events, parsed.filters);

    for (const event of events) {
      res.write(formatServerSentEvent(event.type, event, event.id));
    }

    res.write(
      formatServerSentEvent("done", {
        jobId: job.id,
        status: job.status,
        filters: parsed.filters,
        eventCount: events.length,
      })
    );
    res.end();
  };

  router.post("/jobs", handleCreateGenerationJob);
  router.post("/generations", handleCreateGenerationJob);

  router.get("/jobs", (_req, res) => {
    res.json({ jobs: jobStore.list() });
  });

  router.get("/jobs/latest", (req, res) => {
    const projectId = readOptionalQueryString(req.query.projectId);
    const job = jobStore.latest({ projectId });
    res.json(createJobDetailsPayload(job, blueprintStores));
  });

  router.get("/jobs/:jobId/events", handleJobEvents);
  router.get("/jobs/:jobId/events/stream", handleJobEventStream);
  router.get("/generations/:jobId/events", handleJobEvents);
  router.get("/generations/:jobId/events/stream", handleJobEventStream);
  router.get("/generations/:jobId", handleJobDetails);
  router.get("/jobs/:jobId/agent-crew", handleAgentCrew);
  router.get("/jobs/:jobId/role-timelines", handleRoleTimelines);

  router.get("/jobs/:jobId/capabilities", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const result = getOrCreateCapabilityRegistry(job, {
      now: deps.now,
      store: jobStore,
    });

    res.json({
      job: result.job,
      routeSet: extractRouteSet(result.job),
      specTree: extractSpecTree(result.job),
      capabilities: result.capabilities,
      agentCrew: extractAgentCrew(result.job) ?? result.agentCrew,
      invocations: extractCapabilityInvocations(result.job),
    } satisfies BlueprintCapabilityInvocationsResponse);
  });

  router.get("/jobs/:jobId/capability-invocations", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const parsed = parseCapabilityInvocationFilters(req.query);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint capability invocation filters.",
        message: parsed.message,
      });
      return;
    }

    const registry = getOrCreateCapabilityRegistry(job, {
      now: deps.now,
      store: jobStore,
    });

    res.json({
      job: registry.job,
      routeSet: extractRouteSet(registry.job),
      specTree: extractSpecTree(registry.job),
      capabilities: registry.capabilities,
      agentCrew: extractAgentCrew(registry.job) ?? registry.agentCrew,
      invocations: filterCapabilityInvocations(
        extractCapabilityInvocations(registry.job),
        parsed.filters
      ),
    } satisfies BlueprintCapabilityInvocationsResponse);
  });

  router.post("/jobs/:jobId/capability-invocations", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const parsed = parseCapabilityInvocationRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint capability invocation request.",
        message: parsed.message,
      });
      return;
    }

    const result = invokeCapability(job, parsed.request, {
      now: deps.now,
      store: jobStore,
    });

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        message: result.message,
      });
      return;
    }

    res.status(201).json(result.response);
  });

  router.get("/jobs/:jobId/sandbox-derivation-jobs", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    res.json({
      job,
      routeSet: extractRouteSet(job),
      specTree: extractSpecTree(job),
      sandboxDerivationJobs: extractSandboxDerivationJobs(job),
    } satisfies BlueprintSandboxDerivationJobsResponse);
  });

  router.post("/jobs/:jobId/sandbox-derivation-jobs", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const parsed = parseSandboxDerivationJobRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint sandbox derivation job request.",
        message: parsed.message,
      });
      return;
    }

    const result = createSandboxDerivationJob(job, parsed.request, {
      now: deps.now,
      store: jobStore,
    });

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        message: result.message,
      });
      return;
    }

    res.status(201).json(result.response);
  });

  router.get("/jobs/:jobId/capability-evidence", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const parsed = parseCapabilityEvidenceFilters(req.query);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint capability evidence filters.",
        message: parsed.message,
      });
      return;
    }

    const registry = getOrCreateCapabilityRegistry(job, {
      now: deps.now,
      store: jobStore,
    });

    res.json({
      job: registry.job,
      routeSet: extractRouteSet(registry.job),
      specTree: extractSpecTree(registry.job),
      evidence: filterCapabilityEvidence(
        extractCapabilityEvidence(registry.job),
        parsed.filters
      ),
    } satisfies BlueprintCapabilityEvidenceResponse);
  });

  router.post("/jobs/:jobId/route-selection", async (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const routeSet = extractRouteSet(job);
    if (!routeSet) {
      res.status(409).json({
        error: "Blueprint RouteSet not ready.",
        message: `Blueprint generation job ${req.params.jobId} does not have a RouteSet artifact yet.`,
      });
      return;
    }

    const parsed = parseRouteSelectionRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint route selection request.",
        message: parsed.message,
      });
      return;
    }

    const existingSelection = extractRouteSelection(job);
    const isReselection = Boolean(existingSelection);
    if (isReselection) {
      const runningStage = detectRunningDownstreamForEdit(
        job,
        "route_generation",
      );
      if (runningStage) {
        logStageEditBlocked(blueprintServiceContext, {
          jobId: job.id,
          fromStage: "route_generation",
          triggeringEndpoint: "route_reselection",
          runningStage,
        });
        res.status(409).json({
          error: "downstream_running",
          runningStage,
        });
        return;
      }
    }

    const route = routeSet.routes.find(
      item => item.id === parsed.request.routeId
    );
    if (!route) {
      res.status(404).json({
        error: "Blueprint route not found.",
        message: `No route ${parsed.request.routeId} exists in RouteSet ${routeSet.id}.`,
      });
      return;
    }

    const response = await selectRouteForSpecTree(job, routeSet, parsed.request, {
      now: deps.now,
      store: jobStore,
      ctx: blueprintServiceContext,
    });

    // autopilot-mirofish-stream（2026-05-17）：
    // 路线选择确认后 emit route.selected 事件,让前端 MiroFishCardStream
    // 派生 route_decision 卡片立刻出现在右栏阶段流里。
    // BlueprintEventName.RouteSelected 自 events.ts 一直存在,本处补的是
    // 实际 emit 调用——之前路径只更新 job.artifacts,没有走 eventBus。
    if (blueprintServiceContext.eventBus) {
      try {
        const selection = response.selection;
        blueprintServiceContext.eventBus.emit({
          id: `${BlueprintEventName.RouteSelected}-${selection.id}`,
          jobId: response.job.id,
          type: BlueprintEventName.RouteSelected,
          family: "route",
          stage: "route_generation",
          status: "completed",
          message: `Route ${selection.routeId} selected for SPEC tree derivation.`,
          occurredAt: selection.selectedAt,
          payload: {
            selectionId: selection.id,
            routeId: selection.routeId,
            routeSetId: selection.routeSetId,
            routeTitle: selection.routeTitle,
            stageId: "route_selection",
          },
        });

        // 同时为本次新增的 3 类关键 artifact 各发一条 evidence.artifact_created
        // 事件,让 MiroFishCardStream 能在阶段卡底部显示 "📦 spec_tree" /
        // "📦 route_selection" / "📦 agent_crew" 卡片。
        // 这里仅遍历 response.job.artifacts 中类型为 route_selection /
        // spec_tree / agent_crew 的最新条目（select 后的 job.artifacts 已经
        // 把旧的同类 artifact 替换成新版本）,不去重历史。
        const ARTIFACT_TYPES_TO_EMIT = new Set([
          "route_selection",
          "spec_tree",
          "agent_crew",
        ]);
        for (const artifact of response.job.artifacts) {
          if (!ARTIFACT_TYPES_TO_EMIT.has(artifact.type)) continue;
          blueprintServiceContext.eventBus.emit({
            id: `${BlueprintEventName.EvidenceArtifactCreated}-${artifact.id}`,
            jobId: response.job.id,
            type: BlueprintEventName.EvidenceArtifactCreated,
            family: "evidence",
            stage: "spec_tree",
            status: "completed",
            message: `Artifact ${artifact.type} created.`,
            occurredAt: artifact.createdAt,
            payload: {
              artifactId: artifact.id,
              artifactType: artifact.type,
              title: artifact.title,
              summary: artifact.summary,
            },
          });
        }
      } catch {
        // emit 不应阻塞主链路
      }
    }

    // Task 14.4: Hook point — stage transition to spec_tree after route selection.
    let responseJob = response.job;
    let routeReselectionStaleEdit:
      | {
          fromStage: "route_generation";
          newlyStaleArtifactIds: string[];
          newlyStaleArtifactCount: number;
          staleArtifactIdsSnapshot: string[];
        }
      | undefined;
    if (isReselection) {
      const latestJob = jobStore.get(response.job.id) ?? response.job;
      const invalidation = runAutoInvalidationHook({
        job: latestJob,
        fromStage: "route_generation",
        reason: "upstream_route_selection_changed",
        triggeringEndpoint: "route_reselection",
        triggeringArtifactId: response.selection.id,
        triggeringArtifactType: "route_selection",
        jobStore,
        ctx: blueprintServiceContext,
      });

      responseJob = invalidation.job;
      if (invalidation.newlyStaleArtifactCount > 0) {
        routeReselectionStaleEdit = {
          fromStage: "route_generation",
          newlyStaleArtifactIds: invalidation.newlyStaleArtifactIds,
          newlyStaleArtifactCount: invalidation.newlyStaleArtifactCount,
          staleArtifactIdsSnapshot: invalidation.job.staleArtifactIds ?? [],
        };
      }
    }

    blueprintServiceContext.agentCrewStageActivationDriver?.onStageTransition({
      jobId: response.job.id,
      stageId: "spec_tree",
      transition: "stage_started",
      job: responseJob,
    });

    res.status(201).json({
      ...response,
      job: responseJob,
      ...(routeReselectionStaleEdit
        ? { staleEdit: routeReselectionStaleEdit }
        : {}),
    });
  });

  router.get("/jobs/:jobId/spec-tree", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    res.json({
      job,
      routeSet: extractRouteSet(job),
      selection: extractRouteSelection(job),
      specTree,
    });
  });

  router.post("/jobs/:jobId/spec-documents", async (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    const parsed = parseGenerateSpecDocumentsRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint SPEC document generation request.",
        message: parsed.message,
      });
      return;
    }

    if (
      parsed.request.nodeId &&
      !specTree.nodes.some(node => node.id === parsed.request.nodeId)
    ) {
      res.status(404).json({
        error: "Blueprint SPEC tree node not found.",
        message: `Blueprint SPEC tree node ${parsed.request.nodeId} does not exist in job ${req.params.jobId}.`,
      });
      return;
    }

    const response = await generateSpecDocuments(
      blueprintServiceContext,
      job,
      specTree,
      parsed.request,
      {
        now: deps.now,
        store: jobStore,
        locale: parsed.request.locale ?? resolveRequestLocale(req.body),
      }
    );

    res.status(201).json(response);
  });

  router.get("/jobs/:jobId/spec-documents", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    const parsed = parseSpecDocumentFilters(req.query);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint SPEC document filters.",
        message: parsed.message,
      });
      return;
    }

    res.json({
      job,
      specTree,
      documents: filterSpecDocuments(extractSpecDocuments(job), parsed.filters),
    });
  });

  // `autopilot-spec-document-export` Task 3.1：SPEC 文档导出端点。
  // GET /jobs/:jobId/spec-documents/export?granularity=&nodeId=&type=
  // - granularity=single → text/markdown
  // - granularity=node | tree → application/zip
  router.get("/jobs/:jobId/spec-documents/export", async (req, res) => {
    const result = await buildSpecExportArchive(
      {
        jobId: req.params.jobId,
        granularity:
          typeof req.query.granularity === "string"
            ? req.query.granularity
            : undefined,
        nodeId:
          typeof req.query.nodeId === "string" ? req.query.nodeId : undefined,
        type:
          typeof req.query.type === "string" ? req.query.type : undefined,
      },
      {
        getJob: (jobId) => jobStore.get(jobId),
        listSpecDocuments: (jobId) => {
          const job = jobStore.get(jobId);
          return job ? extractSpecDocuments(job) : [];
        },
        now: () => new Date(),
      },
    );

    if (result.kind === "invalid_request") {
      res.status(400).json({ error: result.message });
      return;
    }
    if (result.kind === "not_found") {
      res
        .status(404)
        .json({ error: result.message, ...(result.details ?? {}) });
      return;
    }

    res.setHeader("Content-Type", result.archive.contentType);
    res.setHeader(
      "Content-Disposition",
      formatContentDisposition(result.archive.filename),
    );
    if (typeof result.archive.body === "string") {
      res.send(result.archive.body);
    } else {
      res.send(Buffer.from(result.archive.body));
    }
  });

  router.post("/jobs/:jobId/effect-previews", async (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    const parsed = parseGenerateEffectPreviewsRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint effect preview generation request.",
        message: parsed.message,
      });
      return;
    }

    if (
      parsed.request.nodeId &&
      !specTree.nodes.some(node => node.id === parsed.request.nodeId)
    ) {
      res.status(404).json({
        error: "Blueprint SPEC tree node not found.",
        message: `Blueprint SPEC tree node ${parsed.request.nodeId} does not exist in job ${req.params.jobId}.`,
      });
      return;
    }

    // Resolve optional LLM context inputs from stores so the Effect Preview
    // LLM service can construct its deterministic prompt. All three are
    // optional — the service tolerates absent clarification / domain /
    // primary route inputs (design §4.5).
    const clarificationSessionId = job.request.clarificationSessionId;
    const clarificationSession = clarificationSessionId
      ? blueprintStores.clarificationSessions.get(clarificationSessionId)
      : undefined;
    const domainContext = job.projectId
      ? blueprintStores.projectContexts.get(job.projectId)
      : undefined;
    const routeSet = extractRouteSet(job);
    const primaryRoute = routeSet
      ? routeSet.routes.find(
          route => route.id === (specTree.selectedRouteId ?? routeSet.primaryRouteId)
        )
      : undefined;

    const result = await generateEffectPreviews(
      blueprintServiceContext,
      job,
      specTree,
      parsed.request,
      {
        now: deps.now,
        store: jobStore,
        clarificationSession,
        domainContext,
        primaryRoute,
      }
    );

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        message: result.message,
      });
      return;
    }

    res.status(201).json(result.response);
  });

  router.get("/jobs/:jobId/effect-previews", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    const parsed = parseEffectPreviewFilters(req.query);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint effect preview filters.",
        message: parsed.message,
      });
      return;
    }

    res.json({
      job,
      specTree,
      effectPreviews: filterEffectPreviews(
        extractEffectPreviews(job),
        parsed.filters
      ),
    });
  });

  router.post("/jobs/:jobId/prompt-packages", async (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    const parsed = parseGenerateImplementationPromptPackagesRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint implementation prompt package request.",
        message: parsed.message,
      });
      return;
    }

    if (
      parsed.request.nodeId &&
      !specTree.nodes.some(node => node.id === parsed.request.nodeId)
    ) {
      res.status(404).json({
        error: "Blueprint SPEC tree node not found.",
        message: `Blueprint SPEC tree node ${parsed.request.nodeId} does not exist in job ${req.params.jobId}.`,
      });
      return;
    }

    const result = await generateImplementationPromptPackages(
      blueprintServiceContext,
      job,
      specTree,
      parsed.request,
      {
        now: deps.now,
        store: jobStore,
      }
    );

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        message: result.message,
      });
      return;
    }

    res.status(201).json(result.response);
  });

  router.get("/jobs/:jobId/prompt-packages", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    const parsed = parseImplementationPromptPackageFilters(req.query);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint implementation prompt package filters.",
        message: parsed.message,
      });
      return;
    }

    res.json({
      job,
      specTree,
      promptPackages: filterImplementationPromptPackages(
        extractImplementationPromptPackages(job),
        parsed.filters
      ),
    });
  });

  router.post("/jobs/:jobId/engineering-landing", async (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    const parsed = parseGenerateEngineeringLandingPlansRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint engineering landing request.",
        message: parsed.message,
      });
      return;
    }

    const result = await generateEngineeringLandingPlans(
      blueprintServiceContext,
      job,
      specTree,
      parsed.request,
      {
        now: deps.now,
        store: jobStore,
      }
    );

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        message: result.message,
      });
      return;
    }

    res.status(201).json(result.response);
  });

  router.get("/jobs/:jobId/engineering-landing", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    res.json({
      ...buildEngineeringLandingPlansResponse(job, specTree),
    });
  });

  router.post("/jobs/:jobId/engineering-runs", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const parsed = parseRecordEngineeringRunRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint engineering run request.",
        message: parsed.message,
      });
      return;
    }

    const result = recordEngineeringRun(job, parsed.request, {
      now: deps.now,
      store: jobStore,
    });

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        message: result.message,
      });
      return;
    }

    res.status(201).json(result.response);
  });

  router.get("/jobs/:jobId/engineering-runs", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    res.json({
      job,
      engineeringLandingPlans: extractEngineeringLandingPlans(job),
      engineeringRuns: extractEngineeringRuns(job),
    } satisfies BlueprintEngineeringRunsResponse);
  });

  router.get("/jobs/:jobId/artifact-ledger", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    res.json({
      job,
      entries: buildArtifactLedger(job),
    } satisfies BlueprintArtifactLedgerResponse);
  });

  router.get(
    "/jobs/:jobId/stale-artifacts",
    createStaleArtifactsHandler({ jobStore, ctx: blueprintServiceContext }),
  );

  router.post(
    "/jobs/:jobId/replan",
    createReplanHandler({ jobStore, ctx: blueprintServiceContext }),
  );

  router.get(
    "/jobs/:jobId/family",
    createFamilyHandler({ jobStore, ctx: blueprintServiceContext }),
  );

  router.post("/jobs/:jobId/artifact-replay", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const parsed = parseCreateArtifactReplayRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint artifact replay request.",
        message: parsed.message,
      });
      return;
    }

    const response = createArtifactReplaySnapshot(job, parsed.request, {
      now: deps.now,
      store: jobStore,
    });

    res.status(201).json(response);
  });

  const handleResetRouteSelection = (req: Request, res: Response) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const routeSet = extractRouteSet(job);
    if (!routeSet) {
      res.status(404).json({
        error: "Blueprint RouteSet not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a RouteSet artifact yet.`,
      });
      return;
    }

    const result = resetRouteSelection(job, routeSet, {
      now: deps.now,
      store: jobStore,
    });

    // Task 14.4: Hook point — stage transition back to route_generation after reset.
    blueprintServiceContext.agentCrewStageActivationDriver?.onStageTransition({
      jobId: result.job.id,
      stageId: "route_generation",
      transition: "stage_started",
      job: result.job,
    });

    res.json(result);
  };

  router.delete("/jobs/:jobId/route-selection", handleResetRouteSelection);
  router.delete("/generations/:jobId/route-selection", handleResetRouteSelection);

  router.get("/jobs/:jobId/artifact-replays", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    res.json({
      job,
      replays: extractArtifactReplays(job),
    } satisfies BlueprintArtifactReplaysResponse);
  });

  router.post("/jobs/:jobId/artifact-diff", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const parsed = parseArtifactDiffRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint artifact diff request.",
        message: parsed.message,
      });
      return;
    }

    const result = compareArtifactLedgerEntries(job, parsed.request);
    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        message: result.message,
      });
      return;
    }

    res.json(result.response);
  });

  router.post("/jobs/:jobId/artifact-feedback", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const parsed = parseArtifactFeedbackRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint artifact feedback request.",
        message: parsed.message,
      });
      return;
    }

    const result = recordArtifactFeedback(job, parsed.request, {
      now: deps.now,
      store: jobStore,
    });

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        message: result.message,
      });
      return;
    }

    res.status(201).json(result.response);
  });

  router.post(
    "/jobs/:jobId/spec-documents/:documentId/versions",
    (req, res) => {
      const job = jobStore.get(req.params.jobId);
      if (!job) {
        res.status(404).json({
          error: "Blueprint generation job not found.",
          message: `No blueprint generation job exists for ${req.params.jobId}.`,
        });
        return;
      }

      const specTree = extractSpecTree(job);
      if (!specTree) {
        res.status(404).json({
          error: "Blueprint SPEC tree not found.",
          message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
        });
        return;
      }

      const parsed = parseSaveSpecDocumentVersionRequest(req.body);
      if (!parsed.ok) {
        res.status(400).json({
          error: "Invalid blueprint SPEC document version request.",
          message: parsed.message,
        });
        return;
      }

      const result = saveSpecDocumentVersion(
        job,
        specTree,
        req.params.documentId,
        parsed.request,
        {
          now: deps.now,
          store: jobStore,
        }
      );

      if (!result.ok) {
        res.status(result.status).json({
          error: result.error,
          message: result.message,
        });
        return;
      }

      // Task 14.4: Hook point — spec_docs stage after document version saved.
      blueprintServiceContext.agentCrewStageActivationDriver?.onStageTransition({
        jobId: job.id,
        stageId: "spec_docs",
        transition: "stage_started",
        job: result.response.job,
      });

      res.status(201).json(result.response);
    }
  );

  router.patch(
    "/jobs/:jobId/spec-documents/:documentId/review",
    (req, res) => {
      const job = jobStore.get(req.params.jobId);
      if (!job) {
        res.status(404).json({
          error: "Blueprint generation job not found.",
          message: `No blueprint generation job exists for ${req.params.jobId}.`,
        });
        return;
      }

      const specTree = extractSpecTree(job);
      if (!specTree) {
        res.status(404).json({
          error: "Blueprint SPEC tree not found.",
          message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
        });
        return;
      }

      const parsed = parseReviewSpecDocumentRequest(req.body);
      if (!parsed.ok) {
        res.status(400).json({
          error: "Invalid blueprint SPEC document review request.",
          message: parsed.message,
        });
        return;
      }

      const result = reviewSpecDocument(
        job,
        specTree,
        req.params.documentId,
        parsed.request,
        {
          now: deps.now,
          store: jobStore,
        }
      );

      if (!result.ok) {
        res.status(result.status).json({
          error: result.error,
          message: result.message,
        });
        return;
      }

      // Task 14.4: Hook point — spec_docs stage after document review.
      blueprintServiceContext.agentCrewStageActivationDriver?.onStageTransition({
        jobId: job.id,
        stageId: "spec_docs",
        transition: "stage_started",
        job: result.response.job,
      });

      res.json(result.response);
    }
  );

  router.patch("/jobs/:jobId/spec-tree/nodes/:nodeId", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    const parsed = parseUpdateSpecTreeNodeRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint SPEC tree node update.",
        message: parsed.message,
      });
      return;
    }

    const updateResult = updateSpecTreeNode(
      job,
      specTree,
      req.params.nodeId,
      parsed.request,
      {
        now: deps.now,
        store: jobStore,
      }
    );

    if (!updateResult.ok) {
      res.status(updateResult.status).json({
        error: updateResult.error,
        message: updateResult.message,
      });
      return;
    }

    // Task 14.4: Hook point — spec_tree stage update after node modification.
    blueprintServiceContext.agentCrewStageActivationDriver?.onStageTransition({
      jobId: job.id,
      stageId: "spec_tree",
      transition: "stage_started",
      job: updateResult.response.job,
    });

    res.json(updateResult.response);
  });

  router.post("/jobs/:jobId/spec-tree/actions", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    const parsed = parseSpecTreeActionRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint SPEC tree action.",
        message: parsed.message,
      });
      return;
    }

    const actionResult = runSpecTreeAction(job, specTree, parsed.request, {
      now: deps.now,
      store: jobStore,
    });

    if (!actionResult.ok) {
      res.status(actionResult.status).json({
        error: actionResult.error,
        message: actionResult.message,
      });
      return;
    }

    // Task 14.4: Hook point — spec_tree stage after tree action.
    blueprintServiceContext.agentCrewStageActivationDriver?.onStageTransition({
      jobId: job.id,
      stageId: "spec_tree",
      transition: "stage_started",
      job: actionResult.response.job,
    });

    res.json(actionResult.response);
  });

  router.post("/jobs/:jobId/spec-tree/versions", (req, res) => {
    const job = jobStore.get(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: "Blueprint generation job not found.",
        message: `No blueprint generation job exists for ${req.params.jobId}.`,
      });
      return;
    }

    const specTree = extractSpecTree(job);
    if (!specTree) {
      res.status(404).json({
        error: "Blueprint SPEC tree not found.",
        message: `Blueprint generation job ${req.params.jobId} does not have a SPEC tree artifact yet.`,
      });
      return;
    }

    const parsed = parseSaveSpecTreeVersionRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: "Invalid blueprint SPEC tree version request.",
        message: parsed.message,
      });
      return;
    }

    const response = saveSpecTreeVersion(job, specTree, parsed.request, {
      now: deps.now,
      store: jobStore,
    });

    res.status(201).json(response);
  });

  router.get("/jobs/:jobId", handleJobDetails);

  return router;
}

export async function collectBlueprintSpecs(
  deps: BlueprintRouterDeps = {}
): Promise<BlueprintSpecsResponse> {
  const specsRoot = path.resolve(deps.specsRoot ?? ".kiro/specs");
  const names = await listBlueprintSpecNames(specsRoot);
  const specs = await Promise.all(
    names.map((name, index) => readBlueprintSpec(specsRoot, name, index))
  );

  specs.sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );

  return {
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    root: displayPath(specsRoot),
    totalSpecs: specs.length,
    totalDocs: specs.reduce((sum, spec) => sum + countDocs(spec.docs), 0),
    completedTasks: specs.reduce(
      (sum, spec) => sum + spec.taskStats.completed,
      0
    ),
    totalTasks: specs.reduce((sum, spec) => sum + spec.taskStats.total, 0),
    specs,
  };
}

type ParseGenerationRequestResult =
  | { ok: true; request: BlueprintGenerationRequest }
  | { ok: false; message: string };

interface CreateGenerationJobOptions {
  now?: () => Date;
  store: BlueprintJobStore;
  context?: BlueprintProjectDomainContext;
  intake?: BlueprintIntake;
  clarificationSession?: BlueprintClarificationSession;
  /**
   * RouteSet LLM driven generator. Required because only `createGenerationJob`
   * consumes it. The router resolves the default instance from `deps`
   * (see design 4.7); tests that call `createGenerationJob` directly must
   * pass a generator explicitly.
   */
  routeSetLlmGenerator: RouteSetLlmGenerator;
  /**
   * 可选：`BlueprintServiceContext`。
   *
   * Task 15 引入：`createGenerationJob` 把 ctx 透传到
   * `createRouteGenerationSandboxDerivation`，进而把 docker capability
   * 分支路由到 `ctx.dockerCapabilityBridge`；autopilot-capability-bridge-mcp
   * task 19 起，同一 ctx 也承载 MCP GitHub 桥的 `mcpToolAdapter` /
   * `httpFetcher` / `mcpGithubCapabilityPolicy` / `mcpGithubCapabilityBridge`，
   * 从而 `mcp-github-source` 能力可以从模板 fallback 升级为真实
   * MCP / HTTP 调用。autopilot-capability-bridge-aigc-node 再通过同一 ctx 暴露
   * `aigcSpecNodeCapabilityBridge`，使 `aigc-spec-node` 能力可以升级为真实 LLM 调用。
   * ctx 未提供时所有 capability 分支继续走模板化 simulated 路径（design §D10 兼容基线）。
   */
  ctx?: BlueprintServiceContext;
  /** User's preferred locale for LLM-generated content. Defaults to "en-US". */
  locale?: "zh-CN" | "en-US";
}

/**
 * Narrower option shape for subdomain helpers that only need `now` / `store`
 * (for example `selectRouteForSpecTree`, `generateSpecDocuments`,
 * `getOrCreateCapabilityRegistry`). Keeping this type separate avoids
 * forcing every helper call site to pass `routeSetLlmGenerator` when only
 * `createGenerationJob` actually reads it (design 4.7 trailing note).
 */
interface CreateGenerationJobHelperOptions {
  now?: () => Date;
  store: BlueprintJobStore;
  /** User's preferred locale for LLM-generated content. Defaults to "en-US". */
  locale?: "zh-CN" | "en-US";
}

type ParseIntakeRequestResult =
  | { ok: true; request: BlueprintIntakeRequest }
  | { ok: false; message: string };

type ParseClarificationAnswersRequestResult =
  | { ok: true; request: { answers: BlueprintClarificationAnswer[] } }
  | { ok: false; message: string };

type ParseClarificationSessionRequestResult =
  | { ok: true; request: BlueprintClarificationSessionRequest }
  | { ok: false; message: string };

interface BlueprintClarificationSessionRequest {
  strategyId?: BlueprintClarificationStrategyId;
  templateId?: string;
  forceNew?: boolean;
  /** User's preferred locale for LLM-generated clarification questions. Defaults to "en-US". */
  locale?: "zh-CN" | "en-US";
}

type ResolveGenerationRequestResult =
  | {
      ok: true;
      request: BlueprintGenerationRequest;
      intake?: BlueprintIntake;
      clarificationSession?: BlueprintClarificationSession;
      context?: BlueprintProjectDomainContext;
    }
  | { ok: false; status: number; error: string; message: string };

function parseIntakeRequest(body: unknown): ParseIntakeRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const targetText = readString(body.targetText ?? body.goal ?? body.input);
  const githubUrls = readGithubUrlInputs(body.githubUrls, body.githubUrl);
  const domainNotes = normalizeStringList(body.domainNotes);

  if (!targetText && githubUrls.length === 0 && domainNotes.length === 0) {
    return {
      ok: false,
      message: "Provide targetText, at least one GitHub URL, or domainNotes.",
    };
  }

  return {
    ok: true,
    request: {
      projectId: readString(body.projectId),
      sourceId: readString(body.sourceId),
      targetText,
      githubUrls,
      domainNotes,
    },
  };
}

function createBlueprintIntake(
  request: BlueprintIntakeRequest,
  options: { now?: () => Date; stores: BlueprintIntakeStores }
): BlueprintIntake {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const intakeId = createId("blueprint-intake");
  const parsedSources = parseGithubSources(request.githubUrls ?? []);
  const evidence = buildIntakeEvidence(request, parsedSources.sources, createdAt);
  const assets = buildIntakeAssets(request, parsedSources.sources, evidence, createdAt);
  const intake: BlueprintIntake = {
    id: intakeId,
    projectId: request.projectId,
    sourceId: request.sourceId,
    targetText: request.targetText,
    githubUrls: parsedSources.sources.map(source => source.normalizedUrl),
    sources: parsedSources.sources,
    duplicateGithubUrls: parsedSources.duplicates,
    domainNotes: request.domainNotes ?? [],
    assets,
    evidence,
    readiness: calculateIntakeReadiness(request, parsedSources.sources),
    createdAt,
    updatedAt: createdAt,
  };

  options.stores.intakes.set(intake.id, intake);
  if (intake.projectId) {
    upsertProjectContext(intake.projectId, intake, options.stores, createdAt);
  }

  return intake;
}

async function createClarificationSession(
  intake: BlueprintIntake,
  options: {
    now?: () => Date;
    stores: BlueprintIntakeStores;
    request?: BlueprintClarificationSessionRequest;
    locale?: "zh-CN" | "en-US";
    generateQuestions?: BlueprintClarificationQuestionGenerator;
  }
): Promise<BlueprintClarificationSession> {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const strategy = selectClarificationStrategy(intake, options.request);
  const reusable = options.request?.forceNew
    ? undefined
    : findReusableClarificationSession(intake, strategy, options.stores);
  if (reusable) {
    return reusable;
  }

  const templateQuestions = buildClarificationQuestions(intake, strategy);
  const generation = options.generateQuestions
    ? await options.generateQuestions({
        intake,
        strategy,
        templateQuestions,
        now: createdAt,
        locale: options.locale ?? options.request?.locale ?? "en-US",
      })
    : {
        questions: templateQuestions,
        source: "template" as const,
      };
  const questions = normalizeGeneratedClarificationQuestions(
    generation.questions,
    templateQuestions,
    strategy,
    generation
  );
  const readiness = calculateClarificationReadiness(questions, []);
  const session: BlueprintClarificationSession = {
    id: createId("blueprint-clarification"),
    intakeId: intake.id,
    projectId: intake.projectId,
    strategyId: strategy.id,
    strategyLabel: strategy.label,
    templateId: strategy.templateId,
    generationSource: generation.source,
    llmModel: generation.model,
    llmPromptId: generation.promptId,
    llmError: generation.error,
    routeReadySummary: buildClarificationRouteReadySummary(strategy, readiness, questions),
    readinessSignals: uniqueClarificationReadinessSignals(questions),
    questions,
    answers: [],
    readiness,
    createdAt,
    updatedAt: createdAt,
  };

  options.stores.clarificationSessions.set(session.id, session);
  return session;
}

function findReusableClarificationSession(
  intake: BlueprintIntake,
  strategy: BlueprintClarificationStrategyTemplate,
  stores: BlueprintIntakeStores
): BlueprintClarificationSession | undefined {
  const sessions = [...stores.clarificationSessions.values()]
    .filter(
      session =>
        session.intakeId === intake.id &&
        session.strategyId === strategy.id &&
        session.templateId === strategy.templateId
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return sessions[0];
}

// ---------------------------------------------------------------------------
// Locale resolution — autopilot-i18n-consistency Task 5.1
// ---------------------------------------------------------------------------

/**
 * Resolve the user's preferred locale from a request body.
 * Returns "zh-CN" only when explicitly set; defaults to "en-US" for backward
 * compatibility.
 */
function resolveRequestLocale(body: unknown): "zh-CN" | "en-US" {
  if (body && typeof body === "object" && "locale" in body) {
    const locale = (body as { locale?: unknown }).locale;
    if (locale === "zh-CN") return "zh-CN";
  }
  return "en-US";
}

function parseClarificationSessionRequest(
  body: unknown
): ParseClarificationSessionRequestResult {
  if (typeof body === "undefined" || body === null) {
    return { ok: true, request: {} };
  }

  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object when provided.",
    };
  }

  const rawStrategy = readString(
    body.strategyId ?? body.strategy_id ?? body.strategy ?? body.mode
  );
  const strategyId = rawStrategy
    ? normalizeClarificationStrategyId(rawStrategy)
    : undefined;
  if (rawStrategy && !strategyId) {
    return {
      ok: false,
      message:
        "strategyId must be one of target_first, repository_first, risk_first, document_first, preview_first, or fast_execution.",
    };
  }

  return {
    ok: true,
    request: {
      strategyId,
      templateId: readString(body.templateId ?? body.template_id),
      forceNew: readBoolean(body.forceNew ?? body.force_new),
      locale: resolveRequestLocale(body),
    },
  };
}

function parseClarificationAnswersRequest(
  body: unknown
): ParseClarificationAnswersRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const answers = normalizeClarifications(
    Array.isArray(body.answers) ? body.answers : [body]
  ) ?? [];
  if (answers.length === 0) {
    return {
      ok: false,
      message: "Provide at least one clarification answer.",
    };
  }

  return {
    ok: true,
    request: { answers },
  };
}

function updateClarificationSession(
  session: BlueprintClarificationSession,
  answers: BlueprintClarificationAnswer[],
  options: { now?: () => Date; stores: BlueprintIntakeStores }
): BlueprintClarificationSession {
  const updatedAt = (options.now?.() ?? new Date()).toISOString();
  const questionById = new Map(
    session.questions.map(question => [question.id, question])
  );
  const answerByQuestionId = new Map(
    session.answers.map(answer => [answer.questionId, answer])
  );

  for (const answer of answers) {
    const question = questionById.get(answer.questionId);
    if (!question) continue;
    answerByQuestionId.set(
      answer.questionId,
      normalizeClarificationAnswerForQuestion(answer, question, updatedAt)
    );
  }

  const nextAnswers = [...answerByQuestionId.values()];
  const readiness = calculateClarificationReadiness(session.questions, nextAnswers);
  const updated: BlueprintClarificationSession = {
    ...session,
    answers: nextAnswers,
    readiness,
    routeReadySummary: buildClarificationRouteReadySummary(
      session,
      readiness,
      session.questions
    ),
    readinessSignals: uniqueClarificationReadinessSignals(session.questions),
    updatedAt,
  };

  options.stores.clarificationSessions.set(updated.id, updated);
  if (updated.projectId) {
    const intake = options.stores.intakes.get(updated.intakeId);
    if (intake) {
      const answerEvidence = buildClarificationEvidence(updated, updatedAt);
      const answerAssets = buildClarificationAssets(
        updated,
        answerEvidence,
        updatedAt
      );
      const context = upsertProjectContext(
        updated.projectId,
        {
          ...intake,
          assets: intake.assets.concat(answerAssets),
          evidence: intake.evidence.concat(answerEvidence),
          updatedAt,
        },
        options.stores,
        updatedAt
      );
      options.stores.projectContexts.set(updated.projectId, context);
    }
  }

  return updated;
}

function resolveGenerationRequest(
  request: BlueprintGenerationRequest,
  stores: BlueprintIntakeStores
): ResolveGenerationRequestResult {
  const intake = request.intakeId ? stores.intakes.get(request.intakeId) : undefined;
  if (request.intakeId && !intake) {
    return {
      ok: false,
      status: 404,
      error: "Blueprint intake not found.",
      message: `No blueprint intake exists for ${request.intakeId}.`,
    };
  }

  const clarificationSession = request.clarificationSessionId
    ? stores.clarificationSessions.get(request.clarificationSessionId)
    : undefined;
  if (request.clarificationSessionId && !clarificationSession) {
    return {
      ok: false,
      status: 404,
      error: "Blueprint clarification session not found.",
      message: `No blueprint clarification session exists for ${request.clarificationSessionId}.`,
    };
  }

  if (
    intake &&
    clarificationSession &&
    clarificationSession.intakeId !== intake.id
  ) {
    return {
      ok: false,
      status: 409,
      error: "Blueprint intake/session mismatch.",
      message: `Clarification session ${clarificationSession.id} does not belong to intake ${intake.id}.`,
    };
  }

  const context = intake?.projectId
    ? stores.projectContexts.get(intake.projectId)
    : undefined;
  const requestClarifications = mergeClarificationAnswers(
    request.clarifications ?? [],
    clarificationSession?.answers ?? []
  );
  const resolved: BlueprintGenerationRequest = {
    ...request,
    projectId: request.projectId ?? intake?.projectId,
    sourceId: request.sourceId ?? intake?.sourceId,
    targetText: request.targetText ?? intake?.targetText,
    githubUrls: uniqueStrings([
      ...(intake?.githubUrls ?? []),
      ...(request.githubUrls ?? []),
    ]),
    clarifications: requestClarifications,
    domainContext: context,
  };

  if (!resolved.targetText && (resolved.githubUrls?.length ?? 0) === 0) {
    return {
      ok: false,
      status: 400,
      error: "Invalid blueprint generation request.",
      message: "Resolved intake does not include targetText or GitHub URLs.",
    };
  }

  return {
    ok: true,
    request: resolved,
    intake,
    clarificationSession,
    context,
  };
}

function parseGenerationRequest(body: unknown): ParseGenerationRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const githubUrls = normalizeGithubUrls(body.githubUrls, body.githubUrl);
  const targetText = readString(body.targetText ?? body.goal ?? body.input);
  const intakeId = readString(body.intakeId);
  const clarificationSessionId = readString(body.clarificationSessionId);
  if (!targetText && githubUrls.length === 0 && !intakeId) {
    return {
      ok: false,
      message: "Provide targetText or at least one GitHub URL.",
    };
  }

  return {
    ok: true,
    request: {
      projectId: readString(body.projectId),
      sourceId: readString(body.sourceId),
      version: readString(body.version) ?? "blueprint-generation/v1",
      mode: "autopilot_route",
      intakeId,
      clarificationSessionId,
      targetText,
      githubUrls,
      clarifications: normalizeClarifications(body.clarifications),
      locale: resolveRequestLocale(body),
    },
  };
}

/**
 * Lazy default {@link BlueprintServiceContext} resolver for `createGenerationJob`.
 *
 * The import is dynamic to avoid a circular import between
 * `server/routes/blueprint.ts` and `server/routes/blueprint/context.ts`
 * (context.ts already imports `createFileBlueprintJobStore` from blueprint.ts).
 */
async function resolveDefaultBlueprintServiceContext(deps: {
  now?: () => Date;
  jobStore: BlueprintJobStore;
}): Promise<BlueprintServiceContext> {
  const contextModule = await import("./blueprint/context.js");
  return contextModule.buildBlueprintServiceContext({
    now: deps.now,
    jobStore: deps.jobStore,
  });
}

export async function createGenerationJob(
  request: BlueprintGenerationRequest,
  options: CreateGenerationJobOptions
): Promise<BlueprintCreateGenerationJobResponse> {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const jobId = createId("blueprint-job");
  // Resolve ctx lazily: if the caller (router handler) passed one, reuse it;
  // otherwise build a default context so downstream bridges (e.g. aigc-spec-node)
  // still have `ctx.llm.callJson` / `ctx.aigcSpecNodeCapabilityBridge` available.
  // The default bridge auto-early-exits into fallback when the env flag is off,
  // so this does not introduce LLM traffic for existing callers.
  const ctx: BlueprintServiceContext =
    options.ctx ??
    (await resolveDefaultBlueprintServiceContext({
      now: options.now,
      jobStore: options.store,
    }));
  // Task 14.1: Lazy construct stage activation driver at job start (per-job lifecycle).
  if (!ctx.agentCrewStageActivationDriver) {
    ctx.agentCrewStageActivationDriver = createAgentCrewStageActivationDriver(ctx);
  }
  const events: BlueprintGenerationEvent[] = [
    createGenerationEvent({
      jobId,
      stage: "input",
      status: "pending",
      type: BlueprintEventName.JobCreated,
      message: "Blueprint generation job accepted.",
      occurredAt: createdAt,
    }),
    createGenerationEvent({
      jobId,
      stage: "route_generation",
      status: "running",
      type: BlueprintEventName.JobStage,
      message: "Generating primary and alternative autopilot routes.",
      occurredAt: createdAt,
    }),
  ];

  // ── Agent-driven pipeline（autopilot-agent-driven-pipeline Task 5）──
  // 当 ctx.roleAgentDelegator 已装配且 env flag 为 "true" 时，优先走 Agent 驱动链路。
  let routeSet: BlueprintRouteSet;
  if (
    ctx.roleAgentDelegator != null &&
    process.env.BLUEPRINT_AGENT_DRIVEN_PIPELINE_ENABLED === "true"
  ) {
    const { createAgentDrivenRouteSetGenerator } = await import(
      "./blueprint/routeset/agent-driven-generator.js"
    );
    const agentGenerator = createAgentDrivenRouteSetGenerator(
      ctx.roleAgentDelegator,
      options.routeSetLlmGenerator,
      ctx.logger,
    );
    const agentResult = await agentGenerator({
      request,
      jobId,
      createdAt,
      intake: options.intake,
      clarificationSession: options.clarificationSession,
      projectContext: options.context,
    });
    routeSet = agentResult.routeSet;
  } else {
    // Legacy path (unchanged)
    routeSet = await buildRouteSet(
      request,
      jobId,
      createdAt,
      options.clarificationSession,
      options.routeSetLlmGenerator,
      options.intake,
      options.context,
      options.locale
    );
  }
  const routeArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "route_set",
    title: "Autopilot RouteSet",
    summary:
      "Primary and alternative routes prepared for SPEC tree derivation.",
    createdAt,
    payload: routeSet,
  };
  // Emit `route.generated` event (design 4.8, task 11.3). Ordered before
  // `createRouteGenerationSandboxDerivation()` so Artifact Replay / Agent
  // Crew panels observe the RouteSet completion prior to sandbox, role and
  // capability events. The LLM provenance extras (generationSource,
  // promptId, model, error) are appended to the existing payload shape
  // rather than introducing a new event name.
  events.push(
    createGenerationEvent({
      jobId,
      projectId: request.projectId,
      stage: "route_generation",
      status: "completed",
      type: BlueprintEventName.RouteGenerated,
      message: "RouteSet routes generated.",
      occurredAt: createdAt,
      artifactId: routeArtifact.id,
      payload: {
        routeSetId: routeSet.id,
        primaryRouteId: routeSet.primaryRouteId,
        routeCount: routeSet.routes.length,
        generationSource: routeSet.provenance.generationSource,
        promptId: routeSet.provenance.promptId,
        model: routeSet.provenance.model,
        error: routeSet.provenance.error,
      },
    })
  );
  const agentCrew = buildAgentCrew({
    jobId,
    stage: "route_generation",
    createdAt,
    capabilities: getDefaultRuntimeCapabilities(),
    artifactIds: [routeArtifact.id, routeSet.id],
  });
  const agentCrewArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "agent_crew",
    title: "Agent Crew fabric",
    summary: `Agent Crew initialized with ${agentCrew.roles.length} roles and ${agentCrew.capabilityMatrix.length} role capability bindings.`,
    createdAt,
    payload: agentCrew,
  };
  const routeSandboxDerivation = await createRouteGenerationSandboxDerivation(
    ctx,
    {
      jobId,
      request,
      routeSet,
      agentCrew,
      capabilities: getDefaultRuntimeCapabilities(),
      createdAt,
      clarificationSession: options.clarificationSession,
    }
  );

  // 中文注释：autopilot-streaming-experience integration-gap-2026-05-16 P0#3 / P0#4
  //
  // `role-system-architecture`(P0#3) 与 `aigc-spec-node`(P0#4) 的 capability
  // bridge 已注册并已在 `createRouteGenerationSandboxDerivation` 内构造出
  // `capability.invoked` / `capability.completed` 事件。但既有实现把这些事件
  // 直接 push 进本地 `events` 数组、再随 `options.store.save(job)` 一次性落盘，
  // 没有走 `ctx.eventBus.emit(...)`，因此 `runtime-enablement/subscriber.ts` 永远
  // 看不到它们，对应的 `recordBridgeInvocation("role", ...)` /
  // `recordBridgeInvocation("aigcNode", ...)` 也永远不会触发，
  // `/api/blueprint/diagnostics` 中两条桥的 `totalInvocations` 长期停留在 0。
  //
  // 修复策略：把这两个 capability 的事件从“本地直写 job.events”路径中剥离，
  // 在 `options.store.save(job)` 完成后再通过事件总线广播一次；总线的
  // `persistToJobStore` 会负责把它们追加到 store 中的 `job.events` 末尾，避免
  // 重复落盘。事件名复用 `BlueprintEventName.CapabilityInvoked` /
  // `BlueprintEventName.CapabilityCompleted`，不引入新的 `BlueprintEventName`。
  const bridgeDiagnosticsCapabilityIds = new Set<string>([
    "docker-analysis-sandbox",
    "mcp-github-source",
    "role-system-architecture",
    "aigc-spec-node",
  ]);
  const isBridgeDiagnosticsCapabilityEvent = (
    event: BlueprintGenerationEvent
  ): boolean =>
    (event.type === BlueprintEventName.CapabilityInvoked ||
      event.type === BlueprintEventName.CapabilityCompleted) &&
    typeof event.capabilityId === "string" &&
    bridgeDiagnosticsCapabilityIds.has(event.capabilityId);
  const pendingBridgeDiagnosticsEvents =
    routeSandboxDerivation.events.filter(isBridgeDiagnosticsCapabilityEvent);
  const inlineSandboxDerivationEvents =
    routeSandboxDerivation.events.filter(
      event => !isBridgeDiagnosticsCapabilityEvent(event)
    );
  const contextArtifacts = buildGenerationContextArtifacts({
    createdAt,
    intake: options.intake,
    clarificationSession: options.clarificationSession,
    context: options.context,
  });
  const nextAction = createGenerationNextAction({
    type: "select_route",
    label: "Select a route for SPEC tree derivation.",
    stage: "route_generation",
    artifactId: routeSandboxDerivation.artifact.id,
    required: true,
  });

  events.push(
    createGenerationEvent({
      jobId,
      projectId: request.projectId,
      stage: "route_generation",
      status: "completed",
      type: BlueprintEventName.JobCompleted,
      message:
        "RouteSet generated from sandbox derivation evidence and ready for SPEC tree derivation.",
      occurredAt: createdAt,
      artifactId: routeArtifact.id,
      payload: {
        routeSetId: routeSet.id,
        sandboxDerivationJobId: routeSandboxDerivation.sandboxDerivationJob.id,
        invocationIds: routeSandboxDerivation.invocations.map(
          invocation => invocation.id
        ),
        evidenceIds: routeSandboxDerivation.evidenceItems.map(
          evidence => evidence.id
        ),
      },
    }),
    ...inlineSandboxDerivationEvents,
    createGenerationEvent({
      jobId,
      projectId: request.projectId,
      stage: "route_generation",
      status: "completed",
      type: BlueprintEventName.CrewContextUpdated,
      message: "Agent Crew context initialized for route generation.",
      occurredAt: createdAt,
      artifactId: agentCrewArtifact.id,
      payload: {
        crewId: agentCrew.id,
        roleIds: agentCrew.roles.map(role => role.id),
        capabilityIds: uniqueStrings(
          agentCrew.capabilityMatrix.map(binding => binding.capabilityId)
        ),
        sourceIds: {
          projectId: request.projectId,
          crewIds: [agentCrew.id],
          roleIds: agentCrew.roles.map(role => role.id),
          capabilityIds: uniqueStrings(
            agentCrew.capabilityMatrix.map(binding => binding.capabilityId)
          ),
        },
      },
    }),
    ...createRolePresenceEvents({
      jobId,
      projectId: request.projectId,
      crewId: agentCrew.id,
      stage: "route_generation",
      status: "completed",
      occurredAt: createdAt,
      presence: agentCrew.presence,
      artifactId: routeArtifact.id,
    })
  );

  const job: BlueprintGenerationJob = {
    id: jobId,
    request,
    status: "completed",
    stage: "route_generation",
    projectId: request.projectId,
    sourceId: request.sourceId,
    version: request.version ?? "blueprint-generation/v1",
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    artifacts: [
      ...contextArtifacts,
      routeArtifact,
      ...routeSandboxDerivation.artifacts,
      agentCrewArtifact,
      routeSandboxDerivation.roleTimelineArtifact,
    ],
    events,
    stageState: createGenerationStageState({
      stage: "route_generation",
      status: "completed",
      payloadKind: "route_set",
      artifactIds: [
        routeArtifact.id,
        routeSandboxDerivation.artifact.id,
        agentCrewArtifact.id,
        routeSandboxDerivation.roleTimelineArtifact.id,
      ],
      nextAction,
    }),
    nextAction,
  };

  options.store.save(job);

  // 中文注释：autopilot-streaming-experience integration-gap-2026-05-16 P0#3 / P0#4
  //
  // 在 `options.store.save(job)` 之后，把上面剥离出来的 `role-system-architecture`
  // 与 `aigc-spec-node` 的 `capability.invoked` / `capability.completed` 事件
  // 通过 `ctx.eventBus.emit(...)` 广播出去。这一步驱动两件事：
  // 1. `server/routes/blueprint/runtime-enablement/subscriber.ts` 的
  //    `attachDiagnosticsSubscriber` 监听 `capability.completed` /
  //    `capability.failed` 事件，按 `capabilityId` 把它们映射到 `role` /
  //    `aigcNode` 桥并调用 `store.recordBridgeInvocation(...)`，从而让
  //    `/api/blueprint/diagnostics` 中两条桥的 `totalInvocations` 不再停在 0。
  // 2. `BlueprintEventBus.emit` 的 `persistToJobStore` 会把这些事件追加到
  //    `jobStore` 中已保存的 `job.events` 末尾，最终 GET `/api/blueprint/jobs/:id`
  //    返回的事件序列与本地 `job` 引用保持一致（见下方的 `refreshedJob` 回读）。
  //
  // 事件名仅复用既有 `BlueprintEventName.CapabilityInvoked` /
  // `BlueprintEventName.CapabilityCompleted`，不引入新的 `BlueprintEventName`。
  for (const bridgeEvent of pendingBridgeDiagnosticsEvents) {
    ctx.eventBus.emit(bridgeEvent);
  }

  // 中文注释：在 `eventBus.emit` 把 `pendingBridgeDiagnosticsEvents` 追加到
  // store 中的 `job.events` 之后，从 store 重新读出最新的 job 快照，避免 POST
  // 响应里的 `job.events` 与后续 GET `/api/blueprint/jobs/:id/events` 不一致
  // （否则 `eventsBody.events.length === created.job.events.length` 这类断言会失败）。
  const refreshedJob = options.store.get(jobId) ?? job;
  const stageActivationJob: BlueprintGenerationJob = {
    ...refreshedJob,
    status: "running",
    completedAt: undefined,
  };

  // 伴随式介入修复：在 route_generation 之前先触发 input 和 clarification
  // 两个阶段的 stage_started，让角色状态机能正确派生这两个阶段的角色状态
  // （例如"决策者"在 input 阶段应为 active）。之前这两个阶段没有 job 对象
  // 所以无法触发；现在 job 创建后补发，让前端 3D 场景里的角色态势回溯正确。
  ctx.agentCrewStageActivationDriver?.onStageTransition({
    jobId: stageActivationJob.id,
    stageId: "input",
    transition: "stage_started",
    job: stageActivationJob,
  });
  ctx.agentCrewStageActivationDriver?.onStageTransition({
    jobId: stageActivationJob.id,
    stageId: "clarification",
    transition: "stage_started",
    job: stageActivationJob,
  });

  // Task 14.2: Hook point — route_generation stage started after job creation.
  ctx.agentCrewStageActivationDriver?.onStageTransition({
    jobId: stageActivationJob.id,
    stageId: "route_generation",
    transition: "stage_started",
    job: stageActivationJob,
  });

  return {
    job: options.store.get(jobId) ?? refreshedJob,
    routeSet,
    intake: options.intake,
    clarificationSession: options.clarificationSession,
    projectContext: options.context,
  };
}

async function buildRouteSet(
  request: BlueprintGenerationRequest,
  requestId: string,
  createdAt: string,
  clarificationSession: BlueprintClarificationSession | undefined,
  generator: RouteSetLlmGenerator,
  intake?: BlueprintIntake,
  projectContext?: BlueprintProjectDomainContext,
  locale?: "zh-CN" | "en-US"
): Promise<BlueprintRouteSet> {
  const routeSetId = createId("blueprint-routeset");
  const primaryRouteId = `${routeSetId}:primary`;
  const clarificationContext = buildClarificationRouteContext(
    request,
    clarificationSession
  );

  // The generator internally swallows LLM errors / schema failures / missing
  // API key and falls back to templated routes with an annotated
  // `provenanceExtras.error`, so no additional try/catch is needed here.
  const { routes, provenanceExtras } = await generator({
    request,
    intake,
    clarificationSession,
    projectContext,
    routeSetId,
    primaryRouteId,
    createdAt,
    locale,
  });

  return {
    id: routeSetId,
    requestId,
    createdAt,
    primaryRouteId,
    routes,
    nextAsset: {
      type: "spec_tree",
      menu: "deduction",
      description:
        "Use the selected RouteSet path as the source asset for the Deduction menu and SPEC tree workbench.",
    },
    provenance: {
      // Existing fields (unchanged, not renamed, not removed).
      projectId: request.projectId,
      sourceId: request.sourceId,
      targetText: request.targetText,
      githubUrls: request.githubUrls ?? [],
      clarificationSessionId: request.clarificationSessionId,
      clarificationStrategyId: clarificationContext.strategyId,
      clarificationTemplateId: clarificationContext.templateId,
      clarificationReadinessSignals: clarificationContext.readinessSignals,
      clarificationRouteDimensions: clarificationContext.routeDimensions,
      clarificationAnsweredQuestionIds:
        clarificationContext.answeredQuestionIds,
      clarificationEvidenceIds: clarificationContext.evidenceIds,
      clarificationSourceIds: clarificationContext.sourceIds,
      clarificationRouteReadySummary: clarificationContext.routeReadySummary,
      // New optional fields (append-only, design 4.9).
      generationSource: provenanceExtras.generationSource,
      promptId: provenanceExtras.promptId,
      model: provenanceExtras.model,
      error: provenanceExtras.error,
    },
  };
}

function buildGenerationContextArtifacts(input: {
  createdAt: string;
  intake?: BlueprintIntake;
  clarificationSession?: BlueprintClarificationSession;
  context?: BlueprintProjectDomainContext;
}): BlueprintGenerationArtifact[] {
  const artifacts: BlueprintGenerationArtifact[] = [];

  if (input.intake) {
    artifacts.push({
      id: createId("blueprint-artifact"),
      type: "intake",
      title: "Blueprint Intake",
      summary: "Normalized target input and GitHub sources captured before route generation.",
      createdAt: input.createdAt,
      payload: input.intake,
    });

    for (const source of input.intake.sources) {
      artifacts.push({
        id: createId("blueprint-artifact"),
        type: "github_source",
        title: `GitHub Source: ${source.owner}/${source.repo}`,
        summary: `Repository source normalized from ${source.normalizedUrl}.`,
        createdAt: input.createdAt,
        payload: source,
      });
    }
  }

  if (input.clarificationSession) {
    artifacts.push({
      id: createId("blueprint-artifact"),
      type: "clarification_session",
      title: "Clarification Session",
      summary:
        input.clarificationSession.routeReadySummary ??
        `${input.clarificationSession.readiness.answeredRequired}/${input.clarificationSession.readiness.requiredTotal} required clarification answers recorded.`,
      createdAt: input.createdAt,
      payload: input.clarificationSession,
    });
  }

  if (input.context) {
    artifacts.push({
      id: createId("blueprint-artifact"),
      type: "project_context",
      title: "Project Domain Context",
      summary: `${input.context.assets.length} domain assets and ${input.context.evidence.length} evidence items available for routing.`,
      createdAt: input.createdAt,
      payload: input.context,
    });
  }

  return artifacts;
}

interface RouteGenerationSandboxDerivationResult {
  sandboxDerivationJob: BlueprintSandboxDerivationJob;
  artifact: BlueprintGenerationArtifact;
  invocationArtifacts: BlueprintGenerationArtifact[];
  evidenceArtifacts: BlueprintGenerationArtifact[];
  roleTimelineArtifact: BlueprintGenerationArtifact;
  invocations: BlueprintCapabilityInvocation[];
  evidenceItems: BlueprintCapabilityEvidence[];
  events: BlueprintGenerationEvent[];
  artifacts: BlueprintGenerationArtifact[];
}

/**
 * Sandbox derivation that runs the sequence of capability invocations used to
 * build the route-generation artifact.
 *
 * `ctx` carries:
 * - `dockerCapabilityBridge`: delegates `capability.id === "docker-analysis-sandbox"`
 *   to the Docker bridge (autopilot-capability-bridge-docker)；
 * - `mcpGithubCapabilityBridge`: delegates `capability.id === "mcp-github-source"`
 *   to the MCP GitHub bridge (autopilot-capability-bridge-mcp)；
 * - `aigcSpecNodeCapabilityBridge`: delegates `capability.id === "aigc-spec-node"`
 *   to the AIGC Spec Node bridge (autopilot-capability-bridge-aigc-node)；
 * - 其它 capability 分支继续走模板化 simulated 路径（design §D10 兼容基线）。
 *
 * 详见 design §4.6 / Task 15.1 / Task 15.5。
 */
async function createRouteGenerationSandboxDerivation(
  ctx: BlueprintServiceContext,
  input: {
    jobId: string;
    request: BlueprintGenerationRequest;
    routeSet: BlueprintRouteSet;
    agentCrew: BlueprintAgentCrew;
    capabilities: BlueprintRuntimeCapability[];
    createdAt: string;
    clarificationSession?: BlueprintClarificationSession;
    primaryRouteId?: string;
  }
): Promise<RouteGenerationSandboxDerivationResult> {
  // Task 14.1: Lazy construct stage activation driver (reuses same instance if already on ctx).
  if (!ctx.agentCrewStageActivationDriver) {
    ctx.agentCrewStageActivationDriver = createAgentCrewStageActivationDriver(ctx);
  }
  const capabilityIds = uniqueStrings(
    input.routeSet.routes.flatMap(route =>
      route.capabilities.map(capability => capability.id)
    )
  );
  // 当 LLM 生成的 routes 未填充 capabilities 字段时（常见于 RouteSet LLM 输出
  // capabilities 为空字符串的情况），注入默认 capability set 以确保 sandbox
  // derivation 的 Docker / MCP / AIGC / Role bridges 能被正常触发。
  const defaultCapabilitySet = [
    ...(input.request.githubUrls?.length ? ["mcp-github-source"] : []),
    "docker-analysis-sandbox",
    "aigc-spec-node",
    "role-system-architecture",
    "skill-svg-architecture",
  ];
  const requestedDefaultCapabilityIds =
    capabilityIds.length > 0
      ? defaultCapabilitySet.filter(id => capabilityIds.includes(id))
      : [];
  const selectedCapabilityIds = uniqueStrings(
    requestedDefaultCapabilityIds.length > 0
      ? requestedDefaultCapabilityIds
      : defaultCapabilitySet
  );
  const routeGenerationCapabilities = selectedCapabilityIds
    .map(capabilityId =>
      input.capabilities.find(capability => capability.id === capabilityId)
    )
    .filter((capability): capability is BlueprintRuntimeCapability =>
      Boolean(capability)
    );
  const primaryRoute =
    input.routeSet.routes.find(route => route.id === input.routeSet.primaryRouteId) ??
    input.routeSet.routes[0];
  // Task 18.2: resolve primaryRouteId with fallback to primaryRoute.id
  const primaryRouteId = input.primaryRouteId ?? primaryRoute.id;
  const roleId = "role-runtime-executor";
  const crewId = input.agentCrew.id;
  const baseJob: BlueprintGenerationJob = {
    id: input.jobId,
    request: input.request,
    status: "running",
    stage: "route_generation",
    projectId: input.request.projectId,
    sourceId: input.request.sourceId,
    version: input.request.version ?? "blueprint-generation/v1",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    artifacts: [],
    events: [],
  };
  const invocations = await Promise.all(
    routeGenerationCapabilities.map(async (capability, index) => {
      const route = input.routeSet.routes[index] ?? primaryRoute;
      const invocationRoleId = resolveRouteSandboxCapabilityRoleId(capability);
      const invocationInput = `Derive route candidate ${route.title} with ${capability.label}.`;
      // Task 15.3：pre-generate invocation id，保证 real / fallback 路径使用同一 id，
      // 从而外层 evidence aggregation / sandbox job `invocationIds` / capability
      // events 的 `invocationId` 引用稳定（design §4.2）。
      const invocationId = createId("blueprint-capability-invocation");

      // Task 15.3 / 15.5：docker capability 分支。
      // 仅当 capability 为 `docker-analysis-sandbox` 且 ctx 注入了 bridge 时，
      // 委派给 bridge；否则（含 ctx 为 undefined 或 bridge 未注入）继续走下方
      // 模板化 simulated 路径，保持 design §D10 兼容基线。
      if (
        capability.id === "docker-analysis-sandbox" &&
        ctx.dockerCapabilityBridge
      ) {
        const bridgeResult = await ctx.dockerCapabilityBridge({
          capability,
          route,
          jobId: input.jobId,
          request: input.request,
          routeSet: input.routeSet,
          createdAt: input.createdAt,
          invocationId,
          roleId: invocationRoleId,
        });
        return bridgeResult.invocation;
      }

      // autopilot-capability-bridge-mcp task 19 / 20：mcp-github-source 分支。
      // 仅当 capability 为 `mcp-github-source` 且 ctx 注入了 bridge 时，委派给
      // bridge（走真实 MCP → HTTP → templated fallback 三级路径）；否则继续走
      // 下方模板化 simulated 路径，保持 design §D10 兼容基线。
      if (
        capability.id === "mcp-github-source" &&
        ctx.mcpGithubCapabilityBridge
      ) {
        const bridgeResult = await ctx.mcpGithubCapabilityBridge({
          capability,
          route,
          jobId: input.jobId,
          request: input.request,
          routeSet: input.routeSet,
          createdAt: input.createdAt,
          invocationId,
          roleId: invocationRoleId,
        });
        return bridgeResult.invocation;
      }

      // autopilot-capability-bridge-aigc-node task 17：aigc-spec-node 分支。
      // The bridge returns both the invocation (real or simulated_fallback)
      // and a free-standing `executionMode` marker the outer code uses to
      // resolve event-payload `adapter` strings.
      if (
        capability.id === "aigc-spec-node" &&
        ctx.aigcSpecNodeCapabilityBridge
      ) {
        const bridgeResult = await ctx.aigcSpecNodeCapabilityBridge({
          capability,
          route,
          jobId: input.jobId,
          request: input.request,
          routeSet: input.routeSet,
          clarificationSession: input.clarificationSession,
          createdAt: input.createdAt,
          invocationId,
          roleId: invocationRoleId,
        });
        return bridgeResult.invocation;
      }

      // autopilot-capability-bridge-role task 19：role-system-architecture 分支.
      // The bridge returns the invocation plus structured roles metadata that
      // the outer aggregation layer uses to fill evidence.provenance.structuredRoles.
      if (
        capability.id === "role-system-architecture" &&
        ctx.roleSystemArchitectureCapabilityBridge
      ) {
        const bridgeResult = await ctx.roleSystemArchitectureCapabilityBridge({
          capability,
          route,
          jobId: input.jobId,
          request: input.request,
          routeSet: input.routeSet,
          primaryRouteId,
          clarificationSession: input.clarificationSession,
          createdAt: input.createdAt,
          invocationId,
          roleId: invocationRoleId,
        });
        const inv = bridgeResult.invocation as BlueprintCapabilityInvocation & {
          __roleBridgeExecutionMode?: string;
          __roleBridgeStructuredRoles?: unknown;
          __roleBridgeStructuredRolesMeta?: unknown;
        };
        inv.__roleBridgeExecutionMode = bridgeResult.executionMode;
        inv.__roleBridgeStructuredRoles = bridgeResult.structuredRoles;
        inv.__roleBridgeStructuredRolesMeta = bridgeResult.structuredRolesMeta;
        return inv;
      }

      // Task 15.4：其它 capability（role-system-architecture /
      // skill-svg-architecture）以及 docker / mcp-github-source / aigc-spec-node
      // 分支在对应 bridge 未注入时，继续走原模板化 simulated 路径。相比原实现，
      // 这里只把 `id: createId(...)` 改为 `id: invocationId`，其余字段一行不改。
      const invocation: BlueprintCapabilityInvocation = {
        id: invocationId,
        jobId: input.jobId,
        capabilityId: capability.id,
        roleId: invocationRoleId,
        capabilityLabel: capability.label,
        kind: capability.kind,
        status: "completed",
        securityLevel: capability.securityLevel,
        safetyGate: {
          status: "allowed",
          reason: capability.requiresApproval
            ? `${capability.label} approved for deterministic route generation sandbox derivation.`
            : `${capability.label} allowed for deterministic route generation sandbox derivation.`,
          requiresApproval: capability.requiresApproval,
          approved: capability.requiresApproval,
          securityLevel: capability.securityLevel,
        },
        requestedAt: input.createdAt,
        completedAt: input.createdAt,
        requestedBy: "route-generation-sandbox-derivation",
        routeId: route.id,
        input: invocationInput,
        outputSummary: buildCapabilityOutputSummary({
          capability,
          routeTitle: route.title,
          input: invocationInput,
        }),
        logs: [],
        evidenceIds: [],
        durationMs: deterministicCapabilityDuration(capability, {
          capabilityId: capability.id,
          roleId: invocationRoleId,
          routeId: route.id,
          input: invocationInput,
        }),
        provenance: {
          jobId: input.jobId,
          projectId: input.request.projectId,
          sourceId: input.request.sourceId,
          routeSetId: input.routeSet.id,
          routeId: route.id,
          roleId: invocationRoleId,
          targetText: input.request.targetText,
          githubUrls: input.request.githubUrls ?? [],
        },
      };
      return {
        ...invocation,
        logs: buildCapabilityInvocationLogs(capability, invocation.outputSummary),
      };
    })
  );
  // autopilot-capability-bridge-role: extract role execution mode BEFORE the
  // evidence loop deletes the side-fields.
  const roleInvocationForAdapter = invocations.find(
    invocation => invocation.capabilityId === "role-system-architecture"
  );
  const roleExecutionModeForAdapter = (roleInvocationForAdapter as unknown as Record<string, unknown>)?.__roleBridgeExecutionMode as string | undefined;

  const evidenceItems = invocations.map(invocation => {
    const capability = routeGenerationCapabilities.find(
      item => item.id === invocation.capabilityId
    );
    if (!capability) {
      throw new Error(`Route sandbox capability ${invocation.capabilityId} missing.`);
    }
    // autopilot-capability-bridge-role task 22: extract role bridge output
    // from the side-fields attached by the role-system-architecture branch.
    const invocationAny = invocation as unknown as Record<string, unknown>;
    const roleBridgeOutput =
      invocationAny.__roleBridgeStructuredRoles && invocationAny.__roleBridgeStructuredRolesMeta
        ? {
            structuredRoles: invocationAny.__roleBridgeStructuredRoles as Record<string, unknown>,
            structuredRolesMeta: invocationAny.__roleBridgeStructuredRolesMeta as {
              digest: string;
              byteSize: number;
              summary: string;
            },
          }
        : undefined;
    // Clean up side-fields so they don't leak into artifact payloads
    if (invocationAny.__roleBridgeExecutionMode !== undefined) {
      delete invocationAny.__roleBridgeExecutionMode;
    }
    if (invocationAny.__roleBridgeStructuredRoles !== undefined) {
      delete invocationAny.__roleBridgeStructuredRoles;
    }
    if (invocationAny.__roleBridgeStructuredRolesMeta !== undefined) {
      delete invocationAny.__roleBridgeStructuredRolesMeta;
    }
    return buildCapabilityEvidence({
      job: baseJob,
      capability,
      invocation,
      routeSet: input.routeSet,
      createdAt: input.createdAt,
      tags: ["route_generation", "sandbox_derivation"],
      roleBridgeOutput,
    });
  });
  const invocationsWithEvidence = invocations.map(invocation => {
    const evidence = evidenceItems.find(
      item => item.invocationId === invocation.id
    );
    return {
      ...invocation,
      evidenceIds: evidence ? [evidence.id] : [],
    };
  });
  // Task 16.1 / 16.2：针对 docker capability 在 real 路径下使用
  // "blueprint.runtime.docker.lobster-executor" adapter 字符串；
  // fallback 路径回退到 capability.adapter（`getDefaultRuntimeCapabilities()`
  // 返回的 "blueprint.runtime.docker.simulated"）。该值仅在 sandbox.job.*
  // 事件 payload 中被消费，`getDefaultRuntimeCapabilities()` 本身不改
  // （design §4.9 / §D10 / 需求 3.4）。
  const dockerCapability = routeGenerationCapabilities.find(
    capability => capability.id === "docker-analysis-sandbox"
  );
  const dockerInvocation = invocationsWithEvidence.find(
    invocation => invocation.capabilityId === "docker-analysis-sandbox"
  );
  const dockerAdapter =
    dockerInvocation?.provenance?.executionMode === "real"
      ? "blueprint.runtime.docker.lobster-executor"
      : (dockerCapability?.adapter ?? "blueprint.runtime.docker.simulated");
  // autopilot-capability-bridge-aigc-node task 18.1：aigc-spec-node adapter
  // resolution — real LLM path vs simulated fallback.
  const aigcInvocation = invocations.find(
    invocation => invocation.capabilityId === "aigc-spec-node"
  );
  const aigcExecutionMode = aigcInvocation?.provenance.executionMode;
  const aigcAdapter: string =
    aigcExecutionMode === "real"
      ? "blueprint.runtime.aigc.spec-node.llm"
      : routeGenerationCapabilities.find(
          capability => capability.id === "aigc-spec-node"
        )?.adapter ?? "blueprint.runtime.aigc.spec-node.simulated";
  // autopilot-capability-bridge-role task 20.1: role-system-architecture adapter
  // resolution — real LLM path vs simulated fallback.
  const roleAdapter: string =
    roleExecutionModeForAdapter === "real"
      ? "blueprint.runtime.role.llm"
      : routeGenerationCapabilities.find(
          capability => capability.id === "role-system-architecture"
        )?.adapter ?? "blueprint.runtime.role.system-architecture.simulated";
  const adapterForCapability = (capabilityId: string): string => {
    if (capabilityId === "docker-analysis-sandbox") {
      return dockerAdapter;
    }
    if (capabilityId === "aigc-spec-node") {
      return aigcAdapter;
    }
    if (capabilityId === "role-system-architecture") {
      return roleAdapter;
    }
    return (
      routeGenerationCapabilities.find(
        capability => capability.id === capabilityId
      )?.adapter ?? ""
    );
  };
  const totalDurationMs = invocationsWithEvidence.reduce(
    (total, invocation) => total + invocation.durationMs,
    0
  );
  const roleIds = uniqueStrings(
    invocationsWithEvidence
      .map(invocation => invocation.roleId)
      .filter(isString)
      .concat(["role-quality-auditor"])
  );
  const sandboxDerivationJob: BlueprintSandboxDerivationJob = {
    id: createId("blueprint-sandbox-derivation"),
    jobId: input.jobId,
    roleId,
    crewId,
    stage: "route_generation",
    projectId: input.request.projectId,
    routeId: primaryRoute?.id,
    executionMode: "parallel",
    status: "completed",
    createdAt: input.createdAt,
    startedAt: input.createdAt,
    completedAt: input.createdAt,
    durationMs: totalDurationMs,
    capabilityIds: routeGenerationCapabilities.map(capability => capability.id),
    invocationIds: invocationsWithEvidence.map(invocation => invocation.id),
    evidenceIds: evidenceItems.map(evidence => evidence.id),
    aggregate: {
      routeOutline: buildSandboxRouteOutline(input.routeSet, evidenceItems),
      mainPath: buildSandboxRoutePath(
        input.jobId,
        "main",
        primaryRoute,
        invocationsWithEvidence,
        evidenceItems
      ),
      alternatePaths: input.routeSet.routes
        .filter(route => route.id !== primaryRoute?.id)
        .slice(0, 2)
        .map((route, index) =>
          buildSandboxRoutePath(
            input.jobId,
            `alternate-${index + 1}`,
            route,
            invocationsWithEvidence,
            evidenceItems
          )
        ),
      evaluation: [
        {
          id: `${input.jobId}:route-sandbox-eval-risk`,
          label: "Route risk evidence",
          score: Math.min(100, 64 + evidenceItems.length * 8),
          summary: `${evidenceItems.length} route-generation evidence item(s) cover risk, cost, and architecture tradeoffs.`,
        },
        {
          id: `${input.jobId}:route-sandbox-eval-cost`,
          label: "Route cost signal",
          score: Math.min(
            100,
            58 + input.routeSet.routes.filter(route => route.costLevel !== "high").length * 7
          ),
          summary: "Sandbox aggregation compares primary and alternative route cost signals before review.",
        },
        {
          id: `${input.jobId}:route-sandbox-eval-complexity`,
          label: "Route complexity signal",
          score: Math.max(40, 95 - routeGenerationCapabilities.length * 6),
          summary: `${routeGenerationCapabilities.length} runtime capability adapters contributed to route complexity assessment.`,
        },
      ],
      outputSummary: `${invocationsWithEvidence.length} route-generation capability invocation(s) aggregated into RouteSet outline, primary route, alternatives, and evaluation data.`,
    },
    logs: [
      `sandbox.job.started stage=route_generation id=${input.jobId}`,
      "executionMode=parallel",
      `capabilities=${routeGenerationCapabilities.map(capability => capability.id).join(",")}`,
      `durationMs=${totalDurationMs}`,
      `sandbox.job.completed invocationCount=${invocationsWithEvidence.length}`,
    ],
    provenance: {
      jobId: input.jobId,
      projectId: input.request.projectId,
      sourceId: input.request.sourceId,
      routeSetId: input.routeSet.id,
      routeId: primaryRoute?.id,
      roleId,
      crewId,
      targetText: input.request.targetText,
      githubUrls: input.request.githubUrls ?? [],
    },
  };
  const invocationArtifacts = invocationsWithEvidence.map(invocation => ({
    id: createId("blueprint-artifact"),
    type: "capability_invocation" as const,
    title: `Route capability invocation: ${invocation.capabilityLabel}`,
    summary: invocation.outputSummary,
    createdAt: input.createdAt,
    payload: invocation,
  }));
  const evidenceArtifacts = evidenceItems.map(evidence => ({
    id: createId("blueprint-artifact"),
    type: "capability_evidence" as const,
    title: evidence.title,
    summary: evidence.summary,
    createdAt: input.createdAt,
    payload: evidence,
  }));
  const artifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "sandbox_derivation_job",
    title: "Route generation sandbox derivation",
    summary: sandboxDerivationJob.aggregate.outputSummary,
    createdAt: input.createdAt,
    payload: sandboxDerivationJob,
  };
  const capabilityEvents = invocationsWithEvidence.flatMap(invocation => {
    const evidence = evidenceItems.find(item => item.invocationId === invocation.id);
    const capabilityAdapter = adapterForCapability(invocation.capabilityId);
    return [
      createGenerationEvent({
        jobId: input.jobId,
        projectId: input.request.projectId,
        type: BlueprintEventName.CapabilityInvoked,
        family: "capability",
        stage: "route_generation",
        status: "running",
        message: `Route generation capability ${invocation.capabilityLabel} invoked.`,
        occurredAt: input.createdAt,
        routeId: invocation.routeId,
        roleId,
        capabilityId: invocation.capabilityId,
        evidenceId: evidence?.id,
        payload: buildRouteSandboxCapabilityEventPayload({
          input,
          invocation,
          evidence,
          roleId,
          crewId,
          adapter: capabilityAdapter,
        }),
      }),
      createGenerationEvent({
        jobId: input.jobId,
        projectId: input.request.projectId,
        type: BlueprintEventName.CapabilityCompleted,
        family: "capability",
        stage: "route_generation",
        status: "completed",
        message: `Route generation capability ${invocation.capabilityLabel} completed.`,
        occurredAt: input.createdAt,
        routeId: invocation.routeId,
        roleId,
        capabilityId: invocation.capabilityId,
        evidenceId: evidence?.id,
        payload: buildRouteSandboxCapabilityEventPayload({
          input,
          invocation,
          evidence,
          roleId,
          crewId,
          adapter: capabilityAdapter,
        }),
      }),
    ];
  });
  const roleEvents = [
    createRoleEvent({
      jobId: input.jobId,
      projectId: input.request.projectId,
      crewId,
      type: BlueprintEventName.RoleCapabilityInvoked,
      stage: "route_generation",
      status: "running",
      roleId,
      presenceState: "active",
      message:
        "Runtime executor dispatched Docker, AIGC, and role analyzers for RouteSet derivation.",
      occurredAt: input.createdAt,
      currentAction: sandboxDerivationJob.aggregate.outputSummary,
      capabilityId: sandboxDerivationJob.capabilityIds[0],
      invocationId: sandboxDerivationJob.invocationIds[0],
      evidenceId: sandboxDerivationJob.evidenceIds[0],
      artifactId: artifact.id,
      routeId: primaryRoute?.id,
    }),
    createRoleEvent({
      jobId: input.jobId,
      projectId: input.request.projectId,
      crewId,
      type: BlueprintEventName.RoleReviewCompleted,
      stage: "route_generation",
      status: "completed",
      roleId: "role-quality-auditor",
      presenceState: "reviewing",
      message:
        "Quality auditor reviewed route sandbox evidence before RouteSet handoff.",
      occurredAt: input.createdAt,
      currentAction:
        "Quality auditor is checking route risk, cost, complexity, and evidence completeness.",
      capabilityId: "role-system-architecture",
      invocationId: sandboxDerivationJob.invocationIds.at(-1),
      evidenceId: sandboxDerivationJob.evidenceIds.at(-1),
      artifactId: artifact.id,
      routeId: primaryRoute?.id,
    }),
  ];
  const events = [
    createGenerationEvent({
      jobId: input.jobId,
      projectId: input.request.projectId,
      type: BlueprintEventName.SandboxJobStarted,
      family: "sandbox",
      stage: "route_generation",
      status: "running",
      message: "Route generation sandbox derivation job started.",
      occurredAt: input.createdAt,
      routeId: primaryRoute?.id,
      artifactId: artifact.id,
      roleId,
      payload: {
        sandboxDerivationJobId: sandboxDerivationJob.id,
        executionMode: sandboxDerivationJob.executionMode,
        capabilityIds: sandboxDerivationJob.capabilityIds,
        capabilityAdapters: buildCapabilityAdapterMap(
          invocationsWithEvidence,
          routeGenerationCapabilities,
        ),
        routeSetId: input.routeSet.id,
        // Task 16.2：docker capability adapter 在 real 路径下切换为
        // "blueprint.runtime.docker.lobster-executor"；fallback 路径回退到
        // getDefaultRuntimeCapabilities() 的 ".simulated" 基线。
        dockerAdapter,
        // Task 18.2: surface the resolved aigc adapter so downstream
        // consumers can distinguish real LLM execution vs simulated fallback
        // without inspecting every invocation.
        aigcAdapter,
        // autopilot-capability-bridge-role task 20.2: surface the resolved
        // role adapter for downstream consumers.
        roleAdapter,
        sourceIds: {
          projectId: input.request.projectId,
          routeSetId: input.routeSet.id,
          roleIds,
          crewIds: [crewId],
          capabilityIds: sandboxDerivationJob.capabilityIds,
        },
      },
    }),
    ...capabilityEvents,
    createGenerationEvent({
      jobId: input.jobId,
      projectId: input.request.projectId,
      type: BlueprintEventName.SandboxJobCompleted,
      family: "sandbox",
      stage: "route_generation",
      status: "completed",
      message: "Route generation sandbox derivation job completed.",
      occurredAt: input.createdAt,
      routeId: primaryRoute?.id,
      artifactId: artifact.id,
      roleId,
      payload: {
        sandboxDerivationJobId: sandboxDerivationJob.id,
        invocationIds: sandboxDerivationJob.invocationIds,
        evidenceIds: sandboxDerivationJob.evidenceIds,
        durationMs: sandboxDerivationJob.durationMs,
        capabilityAdapters: buildCapabilityAdapterMap(
          invocationsWithEvidence,
          routeGenerationCapabilities,
        ),
        routeSetId: input.routeSet.id,
        // Task 16.2：同 sandbox.job.started，docker capability adapter 在
        // real 路径下切换为 lobster-executor。
        dockerAdapter,
        // Task 18.2: mirror aigc adapter on completion so real-vs-fallback
        // readers do not need to correlate with the `started` event.
        aigcAdapter,
        // autopilot-capability-bridge-role task 20.2: mirror role adapter.
        roleAdapter,
        sourceIds: {
          projectId: input.request.projectId,
          routeSetId: input.routeSet.id,
          roleIds,
          crewIds: [crewId],
          capabilityIds: sandboxDerivationJob.capabilityIds,
          capabilityInvocationIds: sandboxDerivationJob.invocationIds,
          capabilityEvidenceIds: sandboxDerivationJob.evidenceIds,
        },
      },
    }),
    ...roleEvents,
  ];
  const roleTimelineCollection = buildRoleTimelineCollection(
    {
      ...baseJob,
      artifacts: [artifact],
      events,
    },
    input.createdAt,
    input.agentCrew
  );
  const roleTimelineArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "role_timeline",
    title: "Route generation role timeline",
    summary: `Role timeline captured for route sandbox derivation.`,
    createdAt: input.createdAt,
    payload: roleTimelineCollection,
  };
  const artifacts = [artifact].concat(invocationArtifacts, evidenceArtifacts);

  return {
    sandboxDerivationJob,
    artifact,
    invocationArtifacts,
    evidenceArtifacts,
    roleTimelineArtifact,
    invocations: invocationsWithEvidence,
    evidenceItems,
    events,
    artifacts,
  };
}

function buildSandboxRouteOutline(
  routeSet: BlueprintRouteSet,
  evidenceItems: BlueprintCapabilityEvidence[]
): string {
  return [
    `${routeSet.routes.length} RouteSet candidate(s) derived from sandbox capability outputs.`,
    `Primary route: ${routeSet.primaryRouteId}.`,
    `${evidenceItems.length} evidence item(s) attached for review.`,
  ].join(" ");
}

function buildSandboxRoutePath(
  jobId: string,
  suffix: string,
  route: BlueprintRouteCandidate | undefined,
  invocations: BlueprintCapabilityInvocation[],
  evidenceItems: BlueprintCapabilityEvidence[]
): BlueprintSandboxRoutePath {
  const routeInvocationIds = invocations
    .filter(invocation => !route || invocation.routeId === route.id)
    .map(invocation => invocation.id);
  const routeEvidenceIds = evidenceItems
    .filter(evidence => !route || evidence.routeId === route.id)
    .map(evidence => evidence.id);

  return {
    id: `${jobId}:route-sandbox-path:${suffix}`,
    title: route?.title ?? "Route sandbox path",
    summary:
      route?.summary ??
      "Route sandbox path aggregated from capability invocation evidence.",
    routeId: route?.id,
    capabilityIds: route?.capabilities.map(capability => capability.id) ?? [],
    invocationIds: routeInvocationIds.length
      ? routeInvocationIds
      : invocations.map(invocation => invocation.id),
    evidenceIds: routeEvidenceIds.length
      ? routeEvidenceIds
      : evidenceItems.map(evidence => evidence.id),
  };
}

/**
 * autopilot-capability-bridge-mcp task 20 — derive the user-visible adapter
 * string per capability in the route-generation sandbox.
 *
 * For `mcp-github-source` the adapter is upgraded to the real MCP / HTTP
 * label when the bridge ran a real path; otherwise it stays at the default
 * simulated label. Other capabilities keep their baseline adapter string.
 *
 * The returned map is attached to `sandbox.job.started` /
 * `sandbox.job.completed` event payloads so downstream consumers can
 * tell real-vs-simulated without parsing every invocation.
 */
function buildCapabilityAdapterMap(
  invocations: BlueprintCapabilityInvocation[],
  capabilities: BlueprintRuntimeCapability[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const capability of capabilities) {
    map[capability.id] = capability.adapter;
  }
  for (const invocation of invocations) {
    if (invocation.capabilityId !== "mcp-github-source") {
      continue;
    }
    const path = invocation.provenance.executionPath;
    if (path === "mcp") {
      map[invocation.capabilityId] = "blueprint.runtime.mcp.github.real";
    } else if (path === "http") {
      map[invocation.capabilityId] = "blueprint.runtime.mcp.github.http";
    }
    // fallback path: keep the baseline `blueprint.runtime.mcp.github.simulated`.
  }
  return map;
}

function buildRouteSandboxCapabilityEventPayload(input: {
  input: {
    request: BlueprintGenerationRequest;
    routeSet: BlueprintRouteSet;
  };
  invocation: BlueprintCapabilityInvocation;
  evidence?: BlueprintCapabilityEvidence;
  roleId: string;
  crewId: string;
  /**
   * Optional per-capability adapter string. When the aigc-spec-node bridge
   * reports a real LLM path, the outer caller passes the `.llm` adapter here
   * so downstream consumers can distinguish real vs simulated execution.
   * Non-aigc capabilities pass the statically declared adapter; field is
   * additive so existing subscribers do not break.
   */
  adapter?: string;
}): Record<string, unknown> {
  // Task 16.3：capability.invoked / capability.completed 事件 payload 追加
  // 可选字段 executionMode / containerId / artifactUrl / logDigest，从
  // invocation.provenance 透传（design §5.7 / 需求 3.7 / 4.2）。非 docker
  // capability 的 provenance 不会带 executionMode，此处通过条件 spread 仅在
  // 字段存在时注入，保持既有事件 payload 结构对其它消费者不变。
  const provenance = input.invocation.provenance;
  // autopilot-capability-bridge-mcp task 20.1/20.2: derive the real adapter
  // string for mcp-github-source based on the bridge's `executionPath`.
  // For other capabilities this stays undefined so the baseline shape is
  // unchanged.
  const mcpGithubAdapter =
    input.invocation.capabilityId === "mcp-github-source"
      ? provenance.executionPath === "mcp"
        ? "blueprint.runtime.mcp.github.real"
        : provenance.executionPath === "http"
          ? "blueprint.runtime.mcp.github.http"
          : undefined
      : undefined;
  // autopilot-capability-bridge-mcp task 20.3: pass through optional
  // provenance fields when present. All fields stay optional to satisfy
  // requirement 5.7 (no new mandatory assertions for existing subscribers).
  const bridgeProvenance: Record<string, unknown> = {};
  if (provenance.executionPath !== undefined) {
    bridgeProvenance.executionPath = provenance.executionPath;
  }
  if (provenance.repoUrl !== undefined) {
    bridgeProvenance.repoUrl = provenance.repoUrl;
  }
  if (provenance.mcpToolName !== undefined) {
    bridgeProvenance.mcpToolName = provenance.mcpToolName;
  }
  const payload: Record<string, unknown> = {
    capabilityId: input.invocation.capabilityId,
    roleId: input.invocation.roleId ?? input.roleId,
    crewId: input.crewId,
    invocationId: input.invocation.id,
    evidenceId: input.evidence?.id,
    routeId: input.invocation.routeId,
    routeSetId: input.input.routeSet.id,
    durationMs: input.invocation.durationMs,
    ...(mcpGithubAdapter !== undefined ? { adapter: mcpGithubAdapter } : {}),
    ...bridgeProvenance,
    sourceIds: {
      projectId: input.input.request.projectId,
      routeSetId: input.input.routeSet.id,
      roleIds: [input.invocation.roleId ?? input.roleId],
      crewIds: [input.crewId],
      capabilityIds: [input.invocation.capabilityId],
      capabilityInvocationIds: [input.invocation.id],
      capabilityEvidenceIds: input.evidence ? [input.evidence.id] : [],
    },
    ...(provenance.executionMode !== undefined
      ? { executionMode: provenance.executionMode }
      : {}),
    ...(provenance.containerId !== undefined
      ? { containerId: provenance.containerId }
      : {}),
    ...(provenance.artifactUrl !== undefined
      ? { artifactUrl: provenance.artifactUrl }
      : {}),
    ...(provenance.logDigest !== undefined
      ? { logDigest: provenance.logDigest }
      : {}),
  };
  // Task 18.3: additive optional fields surfaced from invocation.provenance.
  // When the bridge executes in real mode these fields carry the prompt /
  // model / digest breadcrumbs; in fallback mode the `error` field surfaces
  // the redacted reason string. Consumers that do not know these keys are
  // unaffected thanks to JSON's additive shape.
  if (input.adapter !== undefined && input.adapter !== "") {
    payload.adapter = input.adapter;
  }
  if (provenance.executionMode !== undefined) {
    payload.executionMode = provenance.executionMode;
  }
  if (typeof provenance.promptId === "string") {
    payload.promptId = provenance.promptId;
  }
  if (typeof provenance.model === "string") {
    payload.model = provenance.model;
  }
  if (typeof provenance.error === "string") {
    payload.error = provenance.error;
  }
  if (typeof provenance.structuredPayloadDigest === "string") {
    payload.structuredPayloadDigest = provenance.structuredPayloadDigest;
  }
  return payload;
}

function resolveRouteSandboxCapabilityRoleId(
  capability: BlueprintRuntimeCapability
): string {
  if (capability.id === "skill-svg-architecture") {
    return "role-experience-presenter";
  }
  if (capability.id === "role-system-architecture") {
    return "role-architecture-planner";
  }
  return "role-runtime-executor";
}

function getDefaultRuntimeCapabilities(): BlueprintRuntimeCapability[] {
  return [
    {
      id: "docker-analysis-sandbox",
      label: "Docker analysis sandbox",
      kind: "docker",
      purpose: "Run isolated repository analysis and deterministic command previews.",
      description:
        "Sandboxed container adapter for blueprint runtime inspection without host writes.",
      tags: ["runtime", "sandbox", "analysis"],
      securityLevel: "sandboxed",
      status: "available",
      adapter: "blueprint.runtime.docker.simulated",
      inputSchema: "text/plain",
      outputTypes: ["log", "document"],
      supportedStages: ["route_generation", "spec_tree", "runtime_capability"],
      requiresApproval: false,
      projectScoped: true,
    },
    {
      id: "mcp-github-source",
      label: "GitHub source reader",
      kind: "mcp",
      purpose: "Read network-backed repository context through an MCP adapter.",
      description:
        "Networked MCP source adapter used when blueprint execution needs external repository context.",
      tags: ["runtime", "mcp", "github"],
      securityLevel: "networked",
      status: "requires_approval",
      adapter: "blueprint.runtime.mcp.github.simulated",
      inputSchema: "application/json",
      outputTypes: ["document", "log"],
      supportedStages: ["route_generation", "runtime_capability"],
      requiresApproval: true,
      projectScoped: true,
    },
    {
      id: "skill-svg-architecture",
      label: "SVG architecture skill",
      kind: "skill",
      purpose: "Produce architecture diagram evidence from SPEC and preview inputs.",
      description:
        "Readonly skill adapter that summarizes architecture relationships as deterministic diagram evidence.",
      tags: ["runtime", "skill", "diagram"],
      securityLevel: "readonly",
      status: "available",
      adapter: "blueprint.runtime.skill.svg-architecture.simulated",
      inputSchema: "text/markdown",
      outputTypes: ["diagram", "document"],
      supportedStages: ["effect_preview", "runtime_capability"],
      requiresApproval: false,
      projectScoped: false,
    },
    {
      id: "aigc-spec-node",
      label: "AIGC SPEC derivation node",
      kind: "aigc_node",
      purpose: "Derive SPEC node alternatives and evidence summaries.",
      description:
        "Sandboxed AIGC node adapter for deterministic SPEC derivation simulations.",
      tags: ["runtime", "aigc", "spec"],
      securityLevel: "sandboxed",
      status: "available",
      adapter: "blueprint.runtime.aigc.spec-node.simulated",
      inputSchema: "text/plain",
      outputTypes: ["analysis", "document"],
      supportedStages: ["route_generation", "spec_tree", "runtime_capability"],
      requiresApproval: false,
      projectScoped: true,
    },
    {
      id: "role-system-architecture",
      label: "System architecture role",
      kind: "role",
      purpose: "Evaluate architecture risks, handoff readiness, and role coverage.",
      description:
        "Readonly specialist role adapter for runtime capability review and execution planning.",
      tags: ["runtime", "role", "architecture"],
      securityLevel: "readonly",
      status: "available",
      adapter: "blueprint.runtime.role.system-architecture.simulated",
      inputSchema: "text/plain",
      outputTypes: ["analysis", "safety"],
      supportedStages: [
        "route_generation",
        "prompt_packaging",
        "runtime_capability",
        "engineering_landing",
      ],
      requiresApproval: false,
      projectScoped: false,
    },
  ];
}

function getDefaultAgentRoles(): BlueprintAgentRole[] {
  return [
    {
      id: "role-product-decision",
      name: "Product Decision Lead",
      group: "decision",
      responsibility: "Clarify product intent, tradeoffs, acceptance signals, and route selection criteria.",
      defaultStages: ["input", "clarification", "route_generation", "spec_tree", "prompt_packaging"],
      permissions: ["read_domain_context", "select_route", "prioritize_scope"],
      displayName: "Product Decision Lead",
      displayLabelZh: "产品决策者",
    },
    {
      id: "role-architecture-planner",
      name: "Architecture Planner",
      group: "planning",
      responsibility: "Plan RouteSet structure, SPEC tree shape, module boundaries, and delivery sequence.",
      defaultStages: ["route_generation", "spec_tree", "spec_docs", "engineering_landing"],
      permissions: ["plan_routes", "shape_spec_tree", "map_dependencies"],
      displayName: "Architecture Planner",
      displayLabelZh: "架构规划师",
    },
    {
      id: "role-runtime-executor",
      name: "Runtime Executor",
      group: "execution",
      responsibility: "Invoke Docker, MCP, AIGC node, browser, GitHub, SVG, docs, and retrieval capabilities through approved bindings.",
      defaultStages: ["route_generation", "spec_tree", "spec_docs", "effect_preview", "runtime_capability", "engineering_landing"],
      permissions: ["invoke_bound_capabilities", "produce_artifacts", "record_logs"],
      displayName: "Runtime Executor",
      displayLabelZh: "执行工程师",
    },
    {
      id: "role-quality-auditor",
      name: "Quality Auditor",
      group: "audit",
      responsibility: "Review risk, consistency, safety, cost, acceptance readiness, and evidence completeness.",
      defaultStages: ["clarification", "route_generation", "spec_tree", "spec_docs", "effect_preview", "prompt_packaging", "engineering_landing"],
      permissions: ["review_artifacts", "block_unsafe_invocations", "request_evidence"],
      displayName: "Quality Auditor",
      displayLabelZh: "审计者",
    },
    {
      id: "role-experience-presenter",
      name: "Experience Presenter",
      group: "presentation",
      responsibility: "Translate crew progress into HUD, 3D scene, logs, previews, diagrams, and user-facing summaries.",
      defaultStages: ["clarification", "route_generation", "effect_preview", "prompt_packaging", "engineering_landing"],
      permissions: ["summarize_progress", "render_preview_state", "publish_hud_labels"],
      displayName: "Experience Presenter",
      displayLabelZh: "表现导演",
    },
    {
      id: "role-memory-curator",
      name: "Memory Curator",
      group: "memory",
      responsibility: "Persist domain assets, artifact lineage, role findings, evidence, replay, and handoff context.",
      defaultStages: ["input", "clarification", "route_generation", "spec_tree", "spec_docs", "effect_preview", "prompt_packaging", "runtime_capability", "engineering_landing"],
      permissions: ["write_artifact_memory", "link_lineage", "prepare_replay"],
      displayName: "Memory Curator",
      displayLabelZh: "记忆管理员",
    },
  ];
}

function buildDefaultCapabilityMatrix(
  capabilities: BlueprintRuntimeCapability[]
): BlueprintCapabilityBinding[] {
  const capabilityById = new Map(capabilities.map(item => [item.id, item]));
  const roleById = new Map(getDefaultAgentRoles().map(item => [item.id, item]));
  const bindings: Array<Omit<BlueprintCapabilityBinding, "capabilityLabel" | "capabilityKind" | "roleDisplayName">> = [
    {
      id: "binding-product-role-strategy",
      roleId: "role-product-decision",
      capabilityId: "role-product-strategy",
      nodeId: "role.product.strategy",
      applicableStages: ["input", "clarification", "route_generation"],
      inputSchema: "application/json",
      outputSchema: "application/json",
      tools: ["docs", "retrieval"],
      requiresSandbox: false,
      producesArtifacts: true,
      auditRules: ["retain decision rationale", "link clarification evidence"],
    },
    {
      id: "binding-architecture-role",
      roleId: "role-architecture-planner",
      capabilityId: "role-system-architecture",
      nodeId: "role.system.architecture",
      applicableStages: ["route_generation", "spec_tree", "prompt_packaging", "engineering_landing"],
      inputSchema: "text/plain",
      outputSchema: "application/json",
      tools: ["docs", "retrieval"],
      requiresSandbox: false,
      producesArtifacts: true,
      auditRules: ["record architecture tradeoffs", "link route and SPEC tree ids"],
    },
    {
      id: "binding-github-mcp",
      roleId: "role-runtime-executor",
      capabilityId: "mcp-github-source",
      nodeId: "mcp.github.source",
      applicableStages: ["route_generation", "runtime_capability"],
      inputSchema: "application/json",
      outputSchema: "application/json",
      tools: ["mcp", "github", "retrieval"],
      requiresSandbox: true,
      producesArtifacts: true,
      auditRules: ["requires approval for networked access", "summarize repository scope"],
    },
    {
      id: "binding-docker-analysis",
      roleId: "role-runtime-executor",
      capabilityId: "docker-analysis-sandbox",
      nodeId: "docker.analysis.sandbox",
      applicableStages: ["route_generation", "spec_tree", "runtime_capability"],
      inputSchema: "text/plain",
      outputSchema: "text/plain",
      tools: ["docker", "browser"],
      requiresSandbox: true,
      producesArtifacts: true,
      auditRules: ["no host writes", "record command summary"],
    },
    {
      id: "binding-aigc-spec",
      roleId: "role-runtime-executor",
      capabilityId: "aigc-spec-node",
      nodeId: "aigc.spec.derivation",
      applicableStages: [
        "route_generation",
        "spec_tree",
        "spec_docs",
        "runtime_capability",
      ],
      inputSchema: "text/plain",
      outputSchema: "text/markdown",
      tools: ["aigc_node", "docs"],
      requiresSandbox: true,
      producesArtifacts: true,
      auditRules: ["keep generated SPEC content reviewable", "attach source route ids"],
    },
    {
      id: "binding-svg-preview",
      roleId: "role-experience-presenter",
      capabilityId: "skill-svg-architecture",
      nodeId: "skill.svg.architecture",
      applicableStages: ["effect_preview", "runtime_capability"],
      inputSchema: "text/markdown",
      outputSchema: "image/svg+xml",
      tools: ["skill", "svg", "browser"],
      requiresSandbox: false,
      producesArtifacts: true,
      auditRules: ["render preview evidence", "summarize visible changes"],
    },
    {
      id: "binding-audit-architecture",
      roleId: "role-quality-auditor",
      capabilityId: "role-system-architecture",
      nodeId: "role.audit.architecture",
      applicableStages: ["route_generation", "prompt_packaging", "engineering_landing"],
      inputSchema: "text/plain",
      outputSchema: "application/json",
      tools: ["docs", "retrieval"],
      requiresSandbox: false,
      producesArtifacts: true,
      auditRules: ["review risk/cost/consistency", "flag missing evidence"],
    },
    {
      id: "binding-memory-retrieval",
      roleId: "role-memory-curator",
      capabilityId: "aigc-spec-node",
      nodeId: "memory.artifact.retrieval",
      applicableStages: ["spec_tree", "spec_docs", "effect_preview", "prompt_packaging", "engineering_landing"],
      inputSchema: "application/json",
      outputSchema: "application/json",
      tools: ["retrieval", "docs"],
      requiresSandbox: false,
      producesArtifacts: true,
      auditRules: ["preserve lineage", "dedupe artifact references"],
    },
  ];

  return bindings
    .map(binding => {
      const capability = capabilityById.get(binding.capabilityId);
      const role = roleById.get(binding.roleId);
      if (!capability || !role) return undefined;
      return {
        ...binding,
        capabilityLabel: capability.label,
        capabilityKind: capability.kind,
        roleDisplayName: role.displayName,
      };
    })
    .filter((item): item is BlueprintCapabilityBinding => item !== undefined);
}

function getDefaultStageActivationPolicies(): BlueprintStageActivationPolicy[] {
  const allRoleIds = getDefaultAgentRoles().map(role => role.id);
  const policyInputs: Array<{
    stage: BlueprintGenerationStage;
    active: string[];
    watching: string[];
    reviewing: string[];
  }> = [
    {
      stage: "input",
      active: ["role-product-decision"],
      watching: ["role-memory-curator"],
      reviewing: ["role-quality-auditor"],
    },
    {
      stage: "clarification",
      active: ["role-product-decision"],
      watching: ["role-architecture-planner", "role-experience-presenter", "role-memory-curator"],
      reviewing: ["role-quality-auditor"],
    },
    {
      stage: "route_generation",
      active: ["role-product-decision", "role-architecture-planner", "role-runtime-executor"],
      watching: ["role-experience-presenter", "role-memory-curator"],
      reviewing: ["role-quality-auditor"],
    },
    {
      stage: "spec_tree",
      active: ["role-architecture-planner", "role-runtime-executor"],
      watching: ["role-product-decision", "role-experience-presenter", "role-memory-curator"],
      reviewing: ["role-quality-auditor"],
    },
    {
      stage: "spec_docs",
      active: ["role-runtime-executor", "role-memory-curator"],
      watching: ["role-product-decision", "role-architecture-planner"],
      reviewing: ["role-quality-auditor"],
    },
    {
      stage: "effect_preview",
      active: ["role-experience-presenter", "role-runtime-executor"],
      watching: ["role-product-decision", "role-architecture-planner", "role-memory-curator"],
      reviewing: ["role-quality-auditor"],
    },
    {
      stage: "prompt_packaging",
      active: ["role-product-decision", "role-experience-presenter", "role-memory-curator"],
      watching: ["role-architecture-planner"],
      reviewing: ["role-quality-auditor"],
    },
    {
      stage: "runtime_capability",
      active: ["role-runtime-executor"],
      watching: ["role-architecture-planner", "role-experience-presenter", "role-memory-curator"],
      reviewing: ["role-quality-auditor"],
    },
    {
      stage: "engineering_landing",
      active: ["role-architecture-planner", "role-runtime-executor", "role-memory-curator"],
      watching: ["role-product-decision", "role-experience-presenter"],
      reviewing: ["role-quality-auditor"],
    },
  ];

  return policyInputs.map(policy => {
    const assigned = new Set(policy.active.concat(policy.watching, policy.reviewing));
    const sleepingRoleIds = allRoleIds.filter(roleId => !assigned.has(roleId));
    return {
      stage: policy.stage,
      activeRoleIds: policy.active,
      watchingRoleIds: policy.watching,
      reviewingRoleIds: policy.reviewing,
      sleepingRoleIds,
      overrides: [
        {
          kind: "risk",
          level: "high",
          roleId: "role-quality-auditor",
          state: "reviewing",
          reason: "High risk routes keep audit in reviewing state.",
        },
        {
          kind: "cost",
          level: "high",
          roleId: "role-product-decision",
          state: "active",
          reason: "High cost routes require product decision ownership.",
        },
        {
          kind: "complexity",
          level: "deep",
          roleId: "role-architecture-planner",
          state: "active",
          reason: "Deep routes keep architecture planning active.",
        },
      ],
    };
  });
}

function buildAgentCrew(input: {
  jobId: string;
  stage: BlueprintGenerationStage;
  createdAt: string;
  capabilities?: BlueprintRuntimeCapability[];
  artifactIds?: string[];
  evidenceIds?: string[];
}): BlueprintAgentCrew {
  const capabilities = input.capabilities ?? getDefaultRuntimeCapabilities();
  const roles = getDefaultAgentRoles();
  const capabilityMatrix = buildDefaultCapabilityMatrix(capabilities);
  const activationPolicies = getDefaultStageActivationPolicies();
  const presence = buildRolePresence({
    stage: input.stage,
    capabilityMatrix,
    activationPolicies,
    artifactIds: input.artifactIds ?? [],
    evidenceIds: input.evidenceIds ?? [],
  });

  return {
    id: stableId("blueprint-agent-crew", input.jobId),
    jobId: input.jobId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    stage: input.stage,
    roles,
    capabilityMatrix,
    activationPolicies,
    presence,
    sourceIds: {
      capabilityIds: capabilities.map(capability => capability.id),
    },
  };
}

function buildRolePresence(input: {
  stage: BlueprintGenerationStage;
  capabilityMatrix: BlueprintCapabilityBinding[];
  activationPolicies: BlueprintStageActivationPolicy[];
  artifactIds: string[];
  evidenceIds: string[];
}): BlueprintRolePresence[] {
  const policy =
    input.activationPolicies.find(item => item.stage === input.stage) ??
    input.activationPolicies[0];
  const roles = getDefaultAgentRoles();

  return roles.map(role => {
    const state = resolveRolePresenceState(policy, role.id);
    return {
      roleId: role.id,
      stage: input.stage,
      state,
      currentAction: buildRoleCurrentAction(role, input.stage, state),
      capabilityIds: uniqueStrings(
        input.capabilityMatrix
          .filter(binding => binding.roleId === role.id)
          .filter(binding => binding.applicableStages.includes(input.stage))
          .map(binding => binding.capabilityId)
      ),
      artifactIds: state === "active" || state === "reviewing" ? input.artifactIds : [],
      evidenceIds: state === "active" || state === "reviewing" ? input.evidenceIds : [],
    };
  });
}

function resolveRolePresenceState(
  policy: BlueprintStageActivationPolicy,
  roleId: string
): BlueprintRolePresenceState {
  if (policy.activeRoleIds.includes(roleId)) return "active";
  if (policy.reviewingRoleIds.includes(roleId)) return "reviewing";
  if (policy.watchingRoleIds.includes(roleId)) return "watching";
  return "sleeping";
}

function buildRoleCurrentAction(
  role: BlueprintAgentRole,
  stage: BlueprintGenerationStage,
  state: BlueprintRolePresenceState
): string {
  if (state === "sleeping") {
    return `${role.displayLabelZh} is on standby for ${stage}.`;
  }
  if (state === "reviewing") {
    return `${role.displayLabelZh} is reviewing ${stage} risk, consistency, and evidence.`;
  }
  if (state === "watching") {
    return `${role.displayLabelZh} is watching ${stage} context for handoff signals.`;
  }

  return `${role.displayLabelZh} is driving ${stage} work.`;
}

function mapRolePresenceEventType(
  state: BlueprintRolePresenceState
): BlueprintGenerationEvent["type"] {
  if (state === "active") return "role.activated";
  if (state === "watching") return "role.watching";
  if (state === "reviewing") return "role.review_started";
  return "role.completed";
}

function createRolePresenceEvents(input: {
  jobId: string;
  projectId?: string;
  crewId: string;
  stage: BlueprintGenerationStage;
  status: BlueprintGenerationStatus;
  occurredAt: string;
  presence: BlueprintRolePresence[];
  artifactId?: string;
  routeId?: string;
  selectionId?: string;
  specTreeId?: string;
  nodeId?: string;
  capabilityId?: string;
  invocationId?: string;
  evidenceId?: string;
}): BlueprintGenerationEvent[] {
  return input.presence.map(presence =>
    createRoleEvent({
      jobId: input.jobId,
      projectId: input.projectId,
      crewId: input.crewId,
      stage: input.stage,
      status: input.status,
      occurredAt: input.occurredAt,
      type: mapRolePresenceEventType(presence.state),
      roleId: presence.roleId,
      presenceState: presence.state,
      message: `${presence.roleId} is ${presence.state} for ${input.stage}.`,
      currentAction: presence.currentAction,
      artifactId:
        input.artifactId ??
        (presence.state === "active" || presence.state === "reviewing"
          ? presence.artifactIds[0]
          : undefined),
      routeId: input.routeId,
      selectionId: input.selectionId,
      specTreeId: input.specTreeId,
      nodeId: input.nodeId,
      capabilityId:
        input.capabilityId ??
        (presence.state === "active" || presence.state === "reviewing"
          ? presence.capabilityIds[0]
          : undefined),
      invocationId: input.invocationId,
      evidenceId:
        input.evidenceId ??
        (presence.state === "active" || presence.state === "reviewing"
          ? presence.evidenceIds[0]
          : undefined),
    })
  );
}

function createRoleEvent(input: {
  jobId: string;
  projectId?: string;
  crewId?: string;
  type: BlueprintGenerationEvent["type"];
  stage: BlueprintGenerationStage;
  status: BlueprintGenerationStatus;
  roleId: string;
  presenceState: BlueprintRolePresenceState;
  message: string;
  occurredAt: string;
  currentAction?: string;
  capabilityId?: string;
  invocationId?: string;
  evidenceId?: string;
  artifactId?: string;
  routeId?: string;
  selectionId?: string;
  specTreeId?: string;
  nodeId?: string;
}): BlueprintGenerationEvent {
  return createGenerationEvent({
    jobId: input.jobId,
    projectId: input.projectId,
    family: "role",
    type: input.type,
    stage: input.stage,
    status: input.status,
    roleId: input.roleId,
    presenceState: input.presenceState,
    capabilityId: input.capabilityId,
    evidenceId: input.evidenceId,
    artifactId: input.artifactId,
    routeId: input.routeId,
    selectionId: input.selectionId,
    specTreeId: input.specTreeId,
    nodeId: input.nodeId,
    message: input.message,
    occurredAt: input.occurredAt,
    payload: {
      jobId: input.jobId,
      projectId: input.projectId,
      crewId: input.crewId,
      stage: input.stage,
      roleId: input.roleId,
      presenceState: input.presenceState,
      currentAction: input.currentAction,
      capabilityId: input.capabilityId,
      invocationId: input.invocationId,
      evidenceId: input.evidenceId,
      artifactId: input.artifactId,
      routeId: input.routeId,
      selectionId: input.selectionId,
      specTreeId: input.specTreeId,
      nodeId: input.nodeId,
      sourceIds: {
        roleIds: [input.roleId],
        crewIds: input.crewId ? [input.crewId] : [],
        capabilityIds: input.capabilityId ? [input.capabilityId] : [],
        capabilityInvocationIds: input.invocationId
          ? [input.invocationId]
          : [],
        capabilityEvidenceIds: input.evidenceId ? [input.evidenceId] : [],
        nodeIds: input.nodeId ? [input.nodeId] : [],
      },
    },
  });
}

function createGenerationEvent(input: {
  jobId: string;
  projectId?: string;
  type: BlueprintGenerationEvent["type"];
  stage: BlueprintGenerationStage;
  status: BlueprintGenerationStatus;
  message: string;
  occurredAt: string;
  family?: BlueprintGenerationEventFamily;
  routeId?: string;
  selectionId?: string;
  specTreeId?: string;
  nodeId?: string;
  artifactId?: string;
  roleId?: string;
  presenceState?: BlueprintRolePresenceState;
  capabilityId?: string;
  evidenceId?: string;
  payload?: unknown;
}): BlueprintGenerationEvent {
  return {
    id: createId("blueprint-event"),
    jobId: input.jobId,
    projectId: input.projectId,
    type: input.type,
    family: input.family ?? mapGenerationEventFamily(input.type),
    stage: input.stage,
    status: input.status,
    message: input.message,
    occurredAt: input.occurredAt,
    routeId: input.routeId,
    selectionId: input.selectionId,
    specTreeId: input.specTreeId,
    nodeId: input.nodeId,
    artifactId: input.artifactId,
    roleId: input.roleId,
    presenceState: input.presenceState,
    capabilityId: input.capabilityId,
    evidenceId: input.evidenceId,
    payload: input.payload,
  };
}

function mapGenerationEventFamily(
  type: BlueprintGenerationEvent["type"]
): BlueprintGenerationEventFamily {
  const prefix = type.split(".")[0];
  if (
    prefix === "crew" ||
    prefix === "role" ||
    prefix === "capability" ||
    prefix === "preview" ||
    prefix === "prompt" ||
    prefix === "mission" ||
    prefix === "sandbox" ||
    prefix === "route" ||
    prefix === "clarification" ||
    prefix === "spec" ||
    prefix === "evidence"
  ) {
    return prefix;
  }

  return "job";
}

function createGenerationNextAction(input: BlueprintGenerationNextAction): BlueprintGenerationNextAction {
  return input;
}

function createGenerationStageState(input: {
  stage: BlueprintGenerationStage;
  status: BlueprintGenerationStatus;
  payloadKind: BlueprintGenerationStagePayloadKind;
  artifactIds: string[];
  nextAction?: BlueprintGenerationNextAction;
}): BlueprintGenerationJob["stageState"] {
  return {
    stage: input.stage,
    status: input.status,
    payloadKind: input.payloadKind,
    artifactIds: input.artifactIds,
    nextAction: input.nextAction,
  };
}

function extractRouteSet(
  job: BlueprintGenerationJob
): BlueprintRouteSet | undefined {
  const artifact = job.artifacts.find(item => item.type === "route_set");
  return artifact?.payload as BlueprintRouteSet | undefined;
}

function extractRouteSelection(
  job: BlueprintGenerationJob
): BlueprintRouteSelection | undefined {
  const artifact = job.artifacts.find(item => item.type === "route_selection");
  return artifact?.payload as BlueprintRouteSelection | undefined;
}

function isIntakePayload(
  payload: unknown,
  expectedIntakeId?: string
): payload is BlueprintIntake {
  if (!isPlainRecord(payload) || typeof payload.id !== "string") {
    return false;
  }
  if (expectedIntakeId && payload.id !== expectedIntakeId) {
    return false;
  }
  return typeof payload.targetText === "string";
}

function extractIntake(
  job: BlueprintGenerationJob,
  stores?: BlueprintIntakeStores
): BlueprintIntake | undefined {
  const intakeId = job.request.intakeId;
  const storedIntake = intakeId ? stores?.intakes.get(intakeId) : undefined;
  if (storedIntake) {
    return storedIntake;
  }

  const embeddedIntake = (job as { intake?: BlueprintIntake }).intake;
  if (isIntakePayload(embeddedIntake, intakeId)) {
    return embeddedIntake;
  }

  const artifact = job.artifacts.find(
    item => item.type === "intake" && isIntakePayload(item.payload, intakeId)
  );
  return artifact?.payload as BlueprintIntake | undefined;
}

function isClarificationSessionPayload(
  payload: unknown,
  expectedSessionId?: string
): payload is BlueprintClarificationSession {
  if (!isPlainRecord(payload) || typeof payload.id !== "string") {
    return false;
  }
  if (expectedSessionId && payload.id !== expectedSessionId) {
    return false;
  }
  return Array.isArray(payload.questions) && Array.isArray(payload.answers);
}

function extractClarificationSession(
  job: BlueprintGenerationJob,
  stores?: BlueprintIntakeStores
): BlueprintClarificationSession | undefined {
  const sessionId = job.request.clarificationSessionId;
  const storedSession = sessionId
    ? stores?.clarificationSessions.get(sessionId)
    : undefined;
  if (storedSession) {
    return storedSession;
  }

  const embeddedSession = (job as {
    clarificationSession?: BlueprintClarificationSession;
  }).clarificationSession;
  if (isClarificationSessionPayload(embeddedSession, sessionId)) {
    return embeddedSession;
  }

  const artifact = job.artifacts.find(
    item =>
      item.type === "clarification_session" &&
      isClarificationSessionPayload(item.payload, sessionId)
  );
  return artifact?.payload as BlueprintClarificationSession | undefined;
}

function isProjectContextPayload(
  payload: unknown,
  expectedProjectId?: string
): payload is BlueprintProjectDomainContext {
  if (!isPlainRecord(payload) || typeof payload.projectId !== "string") {
    return false;
  }
  return !expectedProjectId || payload.projectId === expectedProjectId;
}

function extractProjectContext(
  job: BlueprintGenerationJob,
  intake?: BlueprintIntake,
  stores?: BlueprintIntakeStores
): BlueprintProjectDomainContext | undefined {
  const projectId = intake?.projectId ?? job.projectId ?? job.request.projectId;
  const storedContext = projectId
    ? stores?.projectContexts.get(projectId)
    : undefined;
  if (storedContext) {
    return storedContext;
  }

  const embeddedContext = (job as {
    projectContext?: BlueprintProjectDomainContext;
  }).projectContext;
  if (isProjectContextPayload(embeddedContext, projectId)) {
    return embeddedContext;
  }

  const artifact = job.artifacts.find(
    item =>
      item.type === "project_context" &&
      isProjectContextPayload(item.payload, projectId)
  );
  return artifact?.payload as BlueprintProjectDomainContext | undefined;
}

function hydrateBlueprintStoresFromJob(
  job: BlueprintGenerationJob,
  stores: BlueprintIntakeStores
): void {
  const intake = extractIntake(job);
  if (intake && !stores.intakes.has(intake.id)) {
    stores.intakes.set(intake.id, intake);
  }

  const clarificationSession = extractClarificationSession(job);
  if (
    clarificationSession &&
    !stores.clarificationSessions.has(clarificationSession.id)
  ) {
    stores.clarificationSessions.set(
      clarificationSession.id,
      clarificationSession
    );
  }

  const projectContext = extractProjectContext(job, intake);
  if (projectContext && !stores.projectContexts.has(projectContext.projectId)) {
    stores.projectContexts.set(projectContext.projectId, projectContext);
  }
}

function extractSpecTree(
  job: BlueprintGenerationJob
): BlueprintSpecTree | undefined {
  const artifact = job.artifacts.find(item => item.type === "spec_tree");
  return artifact?.payload as BlueprintSpecTree | undefined;
}

function extractSpecTreeVersions(
  job: BlueprintGenerationJob
): BlueprintSpecTreeVersionSnapshot[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "spec_tree_version";
        payload: BlueprintSpecTreeVersionSnapshot;
      } => artifact.type === "spec_tree_version"
    )
    .map(artifact => artifact.payload as BlueprintSpecTreeVersionSnapshot)
    .filter((version): version is BlueprintSpecTreeVersionSnapshot =>
      isPlainRecord(version)
    )
    .sort((left, right) => left.version - right.version);
}

/**
 * `autopilot-spec-document-export` Task 3.1 修复 1：构造合法的
 * `Content-Disposition` 响应头。
 *
 * Node `res.setHeader` 不允许 header value 含非 ASCII 字符（中文、emoji
 * 等），直接塞会抛 `ERR_INVALID_CHAR`。这里实现 RFC 5987 编码 +
 * ASCII fallback：
 *
 * - 同时给出 `filename="<ascii>"`（老浏览器兜底）
 * - 与 `filename*=UTF-8''<percent-encoded>`（现代浏览器优先消费）
 *
 * 例：filename = "项目主航道.zip" → 响应头：
 * `attachment; filename="spec.zip"; filename*=UTF-8''%E9%A1%B9%E7%9B%AE...`
 *
 * 现代浏览器（Chrome / Firefox / Safari / Edge）会正确解析 `filename*`
 * 字段并显示中文文件名；前端 `parseFilenameFromContentDisposition`
 * 暂时只读 `filename="..."`，因此 ASCII fallback 必须给出有意义的
 * 名字而非 "untitled"，否则下载到 ASCII fallback 时是个 ascii 占位名。
 */
function formatContentDisposition(filename: string): string {
  // ASCII fallback：把所有非 ASCII 字符替换为 `_`，至少保留扩展名
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_") || "spec.zip";

  // RFC 5987：UTF-8 percent-encoding，并去掉 RFC 5987 规定不允许的字符
  // encodeURIComponent 已编码绝大部分字符；剩下 `'` 与 `*` / `(` / `)` 等
  // 在 RFC 5987 token 里也需 percent-encode，但 encodeURIComponent 不处理
  // `'`，这里手动补 `'` -> `%27`。
  const utf8Encoded = encodeURIComponent(filename).replace(/'/g, "%27");

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

function extractSpecDocuments(
  job: BlueprintGenerationJob
): BlueprintSpecDocument[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: BlueprintSpecDocumentType;
        payload: BlueprintSpecDocument;
      } =>
        SPEC_DOCUMENT_TYPES.includes(artifact.type as BlueprintSpecDocumentType)
    )
    .map(artifact => artifact.payload as BlueprintSpecDocument)
    .filter((document): document is BlueprintSpecDocument =>
      isPlainRecord(document)
    )
    .sort(
      (left, right) =>
        left.nodeId.localeCompare(right.nodeId) ||
        left.type.localeCompare(right.type)
    );
}

function extractSpecDocumentVersions(
  job: BlueprintGenerationJob
): BlueprintSpecDocumentVersionSnapshot[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "spec_document_version";
        payload: BlueprintSpecDocumentVersionSnapshot;
      } => artifact.type === "spec_document_version"
    )
    .map(artifact => artifact.payload as BlueprintSpecDocumentVersionSnapshot)
    .filter((version): version is BlueprintSpecDocumentVersionSnapshot =>
      isPlainRecord(version)
    )
    .sort(
      (left, right) =>
        left.sourceDocumentId.localeCompare(right.sourceDocumentId) ||
        left.version - right.version
    );
}

function extractEffectPreviews(job: BlueprintGenerationJob): BlueprintEffectPreview[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "effect_preview";
        payload: BlueprintEffectPreview;
      } => artifact.type === "effect_preview"
    )
    .map(artifact => artifact.payload as BlueprintEffectPreview)
    .filter((effectPreview): effectPreview is BlueprintEffectPreview =>
      isPlainRecord(effectPreview)
    )
    .sort(
      (left, right) =>
        left.nodeId.localeCompare(right.nodeId) ||
        left.createdAt.localeCompare(right.createdAt)
    );
}

function extractImplementationPromptPackages(
  job: BlueprintGenerationJob
): BlueprintImplementationPromptPackage[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "prompt_pack";
        payload: BlueprintImplementationPromptPackage;
      } => artifact.type === "prompt_pack"
    )
    .map(artifact => artifact.payload as BlueprintImplementationPromptPackage)
    .filter(
      (
        promptPackage
      ): promptPackage is BlueprintImplementationPromptPackage =>
        isPlainRecord(promptPackage) &&
        typeof promptPackage.id === "string" &&
        typeof promptPackage.createdAt === "string" &&
        Array.isArray(promptPackage.nodeIds) &&
        Array.isArray(promptPackage.sourceDocumentIds) &&
        Array.isArray(promptPackage.sourcePreviewIds) &&
        isImplementationPromptTargetPlatform(promptPackage.targetPlatform)
    )
    .sort(
      (left, right) =>
        left.targetPlatform.localeCompare(right.targetPlatform) ||
        left.createdAt.localeCompare(right.createdAt)
    );
}

function extractEngineeringLandingPlans(
  job: BlueprintGenerationJob
): BlueprintEngineeringLandingPlan[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "engineering_plan";
        payload: BlueprintEngineeringLandingPlan;
      } => artifact.type === "engineering_plan"
    )
    .map(artifact => artifact.payload as BlueprintEngineeringLandingPlan)
    .filter(isEngineeringLandingPlanPayload)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.promptPackageIds.join("|").localeCompare(
          right.promptPackageIds.join("|")
        )
    );
}

function buildEngineeringLandingPlansResponse(
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree
): BlueprintEngineeringLandingPlansResponse {
  const landingPlans = extractEngineeringLandingPlans(job);
  return {
    job,
    specTree,
    landingPlans,
    engineeringLandingPlans: landingPlans,
  };
}

function extractEngineeringRuns(
  job: BlueprintGenerationJob
): BlueprintEngineeringRun[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "engineering_run";
        payload: BlueprintEngineeringRun;
      } => artifact.type === "engineering_run"
    )
    .map(artifact => artifact.payload as BlueprintEngineeringRun)
    .filter(isEngineeringRunPayload)
    .sort(
      (left, right) =>
        (left.startedAt ?? left.completedAt ?? "").localeCompare(
          right.startedAt ?? right.completedAt ?? ""
        ) || left.id.localeCompare(right.id)
    );
}

function extractRuntimeCapabilities(
  job: BlueprintGenerationJob
): BlueprintRuntimeCapability[] {
  const registry = job.artifacts
    .filter(artifact => artifact.type === "capability_registry")
    .map(artifact => artifact.payload)
    .find(isCapabilityRegistryPayload);

  return registry?.capabilities ?? getDefaultRuntimeCapabilities();
}

function extractAgentCrew(
  job: BlueprintGenerationJob
): BlueprintAgentCrew | undefined {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "agent_crew";
        payload: BlueprintAgentCrew;
      } => artifact.type === "agent_crew"
    )
    .map(artifact => artifact.payload as BlueprintAgentCrew)
    .find(isAgentCrewPayload);
}

function extractCapabilityInvocations(
  job: BlueprintGenerationJob
): BlueprintCapabilityInvocation[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "capability_invocation";
        payload: BlueprintCapabilityInvocation;
      } => artifact.type === "capability_invocation"
    )
    .map(artifact => artifact.payload as BlueprintCapabilityInvocation)
    .filter(isCapabilityInvocationPayload)
    .sort(
      (left, right) =>
        left.requestedAt.localeCompare(right.requestedAt) ||
        left.id.localeCompare(right.id)
    );
}

function extractCapabilityEvidence(
  job: BlueprintGenerationJob
): BlueprintCapabilityEvidence[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "capability_evidence";
        payload: BlueprintCapabilityEvidence;
      } => artifact.type === "capability_evidence"
    )
    .map(artifact => artifact.payload as BlueprintCapabilityEvidence)
    .filter(isCapabilityEvidencePayload)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    );
}

function extractSandboxDerivationJobs(
  job: BlueprintGenerationJob
): BlueprintSandboxDerivationJob[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "sandbox_derivation_job";
        payload: BlueprintSandboxDerivationJob;
      } => artifact.type === "sandbox_derivation_job"
    )
    .map(artifact => artifact.payload as BlueprintSandboxDerivationJob)
    .filter(isSandboxDerivationJobPayload)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    );
}

function extractRoleTimelines(job: BlueprintGenerationJob): BlueprintRoleTimeline[] {
  const collection = job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "role_timeline";
        payload: BlueprintRoleTimelineCollection;
      } => artifact.type === "role_timeline"
    )
    .map(artifact => artifact.payload as BlueprintRoleTimelineCollection)
    .filter(isRoleTimelineCollectionPayload)
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id)
    )[0];

  return (
    collection?.timelines ??
    buildRoleTimelineCollection(
      job,
      job.updatedAt,
      extractAgentCrew(job)
    ).timelines
  );
}

function collectReusableRoleFindings(
  job: BlueprintGenerationJob,
  filters: {
    stages?: BlueprintGenerationStage[];
    routeId?: string;
    nodeId?: string;
    limit?: number;
  } = {}
): BlueprintRoleTimelineEntry[] {
  const entries = extractRoleTimelines(job)
    .flatMap(timeline => timeline.entries)
    .filter(entry => {
      if (filters.stages && !filters.stages.includes(entry.stage)) {
        return false;
      }
      if (filters.routeId && entry.routeId && entry.routeId !== filters.routeId) {
        return false;
      }
      if (filters.nodeId && entry.nodeId && entry.nodeId !== filters.nodeId) {
        return false;
      }
      return Boolean(
        entry.currentAction ||
          entry.evidenceId ||
          entry.artifactId ||
          entry.sourceIds.capabilityEvidenceIds?.length
      );
    })
    .sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.id.localeCompare(left.id)
    );
  const strictEntries = entries.filter(entry => {
    if (filters.routeId && entry.routeId !== filters.routeId) {
      return false;
    }
    if (filters.nodeId && entry.nodeId !== filters.nodeId) {
      return false;
    }
    return true;
  });
  return dedupeById(strictEntries.concat(entries))
    .sort(compareReusableRoleFindings)
    .slice(0, filters.limit ?? 8);
}

function compareReusableRoleFindings(
  left: BlueprintRoleTimelineEntry,
  right: BlueprintRoleTimelineEntry
): number {
  const leftHasEvidence =
    Boolean(left.evidenceId) ||
    (left.sourceIds.capabilityEvidenceIds?.length ?? 0) > 0;
  const rightHasEvidence =
    Boolean(right.evidenceId) ||
    (right.sourceIds.capabilityEvidenceIds?.length ?? 0) > 0;
  if (leftHasEvidence !== rightHasEvidence) {
    return leftHasEvidence ? -1 : 1;
  }

  return (
    right.occurredAt.localeCompare(left.occurredAt) ||
    right.id.localeCompare(left.id)
  );
}

function collectRoleFindingIds(
  findings: BlueprintRoleTimelineEntry[]
): string[] {
  return uniqueStrings(findings.map(finding => finding.id));
}

function collectRoleFindingRoleIds(
  findings: BlueprintRoleTimelineEntry[]
): string[] {
  return uniqueStrings(findings.map(finding => finding.roleId));
}

function collectRoleFindingEvidenceIds(
  findings: BlueprintRoleTimelineEntry[]
): string[] {
  return uniqueStrings(
    findings.flatMap(finding =>
      [
        finding.evidenceId,
        ...(finding.sourceIds.capabilityEvidenceIds ?? []),
      ].filter(isString)
    )
  );
}

function formatReusableRoleFinding(
  finding: BlueprintRoleTimelineEntry
): string {
  const summary = finding.currentAction ?? finding.summary;
  const refs = [
    finding.capabilityId ? `capability=${finding.capabilityId}` : undefined,
    finding.evidenceId ? `evidence=${finding.evidenceId}` : undefined,
  ]
    .filter(isString)
    .join(", ");
  return refs.length > 0
    ? `${finding.roleId}: ${summary} (${refs})`
    : `${finding.roleId}: ${summary}`;
}

function extractArtifactReplays(
  job: BlueprintGenerationJob
): BlueprintArtifactReplaySnapshot[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "replay";
        payload: BlueprintArtifactReplaySnapshot;
      } => artifact.type === "replay"
    )
    .map(artifact => artifact.payload as BlueprintArtifactReplaySnapshot)
    .filter(isArtifactReplaySnapshotPayload)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    );
}

function extractArtifactFeedback(
  job: BlueprintGenerationJob
): BlueprintArtifactFeedback[] {
  return job.artifacts
    .filter(
      (artifact): artifact is BlueprintGenerationArtifact & {
        type: "feedback";
        payload: BlueprintArtifactFeedback;
      } => artifact.type === "feedback"
    )
    .map(artifact => artifact.payload as BlueprintArtifactFeedback)
    .filter(isArtifactFeedbackPayload)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    );
}

const BLUEPRINT_GENERATION_STAGES: BlueprintGenerationStage[] = [
  "input",
  "clarification",
  "route_generation",
  "spec_tree",
  "spec_docs",
  "preview",
  "effect_preview",
  "prompt_packaging",
  "runtime_capability",
  "engineering_handoff",
  "engineering_landing",
];

function buildArtifactLedger(
  job: BlueprintGenerationJob
): BlueprintArtifactMemoryEntry[] {
  const artifactEntries = job.artifacts.map((artifact, index) =>
    buildArtifactMemoryEntryFromArtifact(job, artifact, index)
  );
  const eventEntries = job.events.map((event, index) =>
    buildArtifactMemoryEntryFromEvent(job, event, index)
  );

  return artifactEntries
    .concat(eventEntries)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.artifactId.localeCompare(right.artifactId)
    );
}

function buildArtifactMemoryEntryFromArtifact(
  job: BlueprintGenerationJob,
  artifact: BlueprintGenerationArtifact,
  index: number
): BlueprintArtifactMemoryEntry {
  const payload = isPlainRecord(artifact.payload) ? artifact.payload : {};
  const stage = inferArtifactStage(artifact.type, payload);

  return {
    id: `blueprint-ledger-${artifact.id}`,
    jobId: job.id,
    artifactId: artifact.id,
    artifactType: artifact.type,
    stage,
    title: artifact.title,
    summary: artifact.summary,
    createdAt: artifact.createdAt,
    sourceIds: collectArtifactSourceIds(artifact.type, payload),
    version: readArtifactVersion(payload, index),
    tags: buildArtifactLedgerTags(artifact.type, stage, payload),
    payloadSummary: summarizeArtifactPayload(payload),
  };
}

function buildArtifactMemoryEntryFromEvent(
  job: BlueprintGenerationJob,
  event: BlueprintGenerationEvent,
  index: number
): BlueprintArtifactMemoryEntry {
  const basePayload = isPlainRecord(event.payload) ? event.payload : {};
  const family = event.family ?? mapGenerationEventFamily(event.type);
  const payload = {
    ...basePayload,
    jobId: event.jobId,
    projectId: event.projectId,
    stage: event.stage,
    family,
    type: event.type,
    routeId: event.routeId,
    selectionId: event.selectionId,
    specTreeId: event.specTreeId,
    nodeId: event.nodeId,
    artifactId: event.artifactId,
    roleId: event.roleId,
    presenceState: event.presenceState,
    capabilityId: event.capabilityId,
    evidenceId: event.evidenceId,
  };

  return {
    id: `blueprint-ledger-${event.id}`,
    jobId: job.id,
    artifactId: event.id,
    artifactType: "event",
    stage: event.stage,
    title: event.message,
    summary: `${family} / ${event.type} / ${event.status}`,
    createdAt: event.occurredAt,
    sourceIds: collectArtifactSourceIds("event", payload),
    version: index + 1,
    tags: uniqueStrings([
      "event",
      family,
      event.type,
      event.stage,
      event.status,
    ]),
    payloadSummary: summarizeArtifactPayload(payload),
  };
}

function createArtifactReplaySnapshot(
  job: BlueprintGenerationJob,
  request: BlueprintCreateArtifactReplayRequest,
  options: CreateGenerationJobHelperOptions
): BlueprintArtifactReplayResponse {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const ledger = buildArtifactLedger(job);
  const timelineEntries = ledger.map(
    (entry, index): BlueprintArtifactReplayTimelineEntry => ({
      id: `blueprint-replay-timeline-${index + 1}`,
      entryId: entry.id,
      artifactId: entry.artifactId,
      artifactType: entry.artifactType,
      stage: entry.stage,
      title: entry.title,
      summary: entry.summary,
      occurredAt: entry.createdAt,
      tags: entry.tags,
    })
  );
  const replay: BlueprintArtifactReplaySnapshot = {
    id: createId("blueprint-artifact-replay"),
    jobId: job.id,
    createdAt,
    timelineEntries,
    stageCounts: buildArtifactReplayStageCounts(ledger),
    lineageEdges: buildArtifactLineageEdges(ledger),
    artifactEvolution: buildArtifactEvolutionReplay(job),
    decisions: buildArtifactDecisionReplay(job),
  };
  const replayArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "replay",
    title: request.title ?? "Artifact replay snapshot",
    summary:
      request.summary ??
      `Replay snapshot containing ${timelineEntries.length} ledger entries.`,
    createdAt,
    payload: replay,
  };
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "engineering_landing",
    updatedAt: createdAt,
    artifacts: job.artifacts.concat(replayArtifact),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        type: BlueprintEventName.JobStage,
        stage: "engineering_landing",
        status: "reviewing",
        message: "Artifact replay snapshot created.",
        occurredAt: createdAt,
        payload: {
          replayId: replay.id,
          timelineEntryCount: timelineEntries.length,
          lineageEdgeCount: replay.lineageEdges.length,
          tags: request.tags ?? [],
        },
      })
    ),
  };

  options.store.save(updatedJob);
  return { job: updatedJob, replay };
}

function buildArtifactEvolutionReplay(
  job: BlueprintGenerationJob
): BlueprintArtifactEvolutionReplay {
  const routeSet = extractRouteSet(job);
  const selection = extractRouteSelection(job);
  const specTree = extractSpecTree(job);
  const specTreeVersions = extractSpecTreeVersions(job);
  const specDocuments = extractSpecDocuments(job);
  const specDocumentVersions = extractSpecDocumentVersions(job);
  const effectPreviews = extractEffectPreviews(job);
  const promptPackages = extractImplementationPromptPackages(job);

  return {
    routeSets: routeSet
      ? [
          {
            routeSetId: routeSet.id,
            routeCount: routeSet.routes.length,
            primaryRouteId: routeSet.primaryRouteId,
            selectedRouteId: selection?.routeId,
            selectedPathId: selection?.selectedPathId ?? selection?.routeId,
            selectionId: selection?.id,
            selectedBy: selection?.selectedBy,
            reason: selection?.reason,
            mergedAlternativeRouteIds: selection?.mergedAlternativeRouteIds ?? [],
            createdAt: job.artifacts.find(
              artifact => artifact.type === "route_set"
            )?.createdAt,
            selectedAt: selection?.selectedAt,
          },
        ]
      : [],
    specTrees: uniqueSpecTreeEvolution(specTree, specTreeVersions),
    specDocuments: uniqueSpecDocumentEvolution(
      specDocuments,
      specDocumentVersions
    ),
    effectPreviews: effectPreviews.map(preview => ({
      previewId: preview.id,
      nodeId: preview.nodeId,
      version: preview.version ?? preview.versionSync?.version ?? 1,
      versionStatus:
        preview.versionStatus ??
        preview.versionSync?.versionStatus ??
        "current",
      status: preview.status,
      sourceDocumentIds: [...preview.sourceDocumentIds],
      sourceSnapshotHash:
        preview.sourceSnapshotHash ??
        preview.versionSync?.sourceSnapshotHash ??
        "",
      refreshedFromSpecTreeVersion:
        preview.refreshedFromSpecTreeVersion ??
        preview.versionSync?.refreshedFromSpecTreeVersion ??
        preview.provenance.treeVersion,
      updatedAt: preview.updatedAt ?? preview.createdAt,
      previousPreviewIds: preview.previousPreviewIds ?? [],
      preservedPreviewIds: preview.preservedPreviewIds ?? [],
    })),
    promptPackages: promptPackages.map(promptPackage => ({
      promptPackageId: promptPackage.id,
      targetPlatform: promptPackage.targetPlatform,
      nodeIds: [...promptPackage.nodeIds],
      sourceDocumentIds: [...promptPackage.sourceDocumentIds],
      sourcePreviewIds: [...promptPackage.sourcePreviewIds],
      sectionKinds: uniqueStrings(
        promptPackage.sections.map(section => section.kind)
      ) as BlueprintArtifactEvolutionReplay["promptPackages"][number]["sectionKinds"],
      createdAt: promptPackage.createdAt,
    })),
  };
}

function uniqueSpecTreeEvolution(
  current: BlueprintSpecTree | undefined,
  versions: BlueprintSpecTreeVersionSnapshot[]
): BlueprintArtifactEvolutionReplay["specTrees"] {
  const snapshots: Array<
    BlueprintArtifactEvolutionReplay["specTrees"][number] & { id: string }
  > = versions.map(version => ({
    id: `${version.treeId}:${version.version}:${version.id}`,
    specTreeId: version.treeId,
    selectionId: version.snapshot.selectionId,
    selectedPathId:
      version.snapshot.selectedPathId ?? version.snapshot.selectedRouteId,
    routeId: version.snapshot.selectedRouteId,
    version: version.version,
    status: version.snapshot.status,
    rootNodeId: version.snapshot.rootNodeId,
    nodeCount: version.snapshot.nodes.length,
    updatedAt: version.savedAt,
    versionId: version.id,
  }));
  const currentEntry: Array<
    BlueprintArtifactEvolutionReplay["specTrees"][number] & { id: string }
  > = current
    ? [
        {
          id: `${current.id}:${current.version}:current`,
          specTreeId: current.id,
          selectionId: current.selectionId,
          selectedPathId: current.selectedPathId ?? current.selectedRouteId,
          routeId: current.selectedRouteId,
          version: current.version,
          status: current.status,
          rootNodeId: current.rootNodeId,
          nodeCount: current.nodes.length,
          updatedAt: current.updatedAt,
        },
      ]
    : [];

  return dedupeById(snapshots.concat(currentEntry))
    .sort(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) ||
        left.version - right.version
    )
    .map(({ id: _id, ...entry }) => entry);
}

function uniqueSpecDocumentEvolution(
  documents: BlueprintSpecDocument[],
  versions: BlueprintSpecDocumentVersionSnapshot[]
): BlueprintArtifactEvolutionReplay["specDocuments"] {
  const versionEntries: Array<
    BlueprintArtifactEvolutionReplay["specDocuments"][number] & { id: string }
  > = versions.map(version => ({
    id: `${version.sourceDocumentId}:${version.version}:${version.id}`,
    documentId: version.documentId,
    sourceDocumentId: version.sourceDocumentId,
    nodeId: version.nodeId,
    type: version.type,
    version: version.version,
    status: version.status,
    updatedAt: version.savedAt,
    reviewedBy: version.reviewedBy,
    reviewNote: version.reviewNote,
    acceptedAt: version.acceptedAt,
    rejectedAt: version.rejectedAt,
    versionId: version.id,
  }));
  const currentEntries: Array<
    BlueprintArtifactEvolutionReplay["specDocuments"][number] & { id: string }
  > = documents.map(document => ({
    id: `${document.sourceDocumentId ?? document.id}:${document.version ?? 1}:current`,
    documentId: document.id,
    sourceDocumentId: document.sourceDocumentId,
    nodeId: document.nodeId,
    type: document.type,
    version: document.version ?? 1,
    status: normalizeSpecDocumentStatus(document.status),
    updatedAt: document.updatedAt ?? document.createdAt,
    reviewedBy: document.reviewedBy,
    reviewNote: document.reviewNote,
    acceptedAt: document.acceptedAt,
    rejectedAt: document.rejectedAt,
  }));

  return dedupeById(versionEntries.concat(currentEntries))
    .sort(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) ||
        left.type.localeCompare(right.type) ||
        left.version - right.version
    )
    .map(({ id: _id, ...entry }) => entry);
}

function buildArtifactDecisionReplay(
  job: BlueprintGenerationJob
): BlueprintArtifactDecisionReplay {
  const confirmations: BlueprintArtifactDecisionReplay["confirmations"] = [];
  const handoffs: BlueprintArtifactDecisionReplay["handoffs"] = [];

  for (const artifact of job.artifacts) {
    const payload = isPlainRecord(artifact.payload) ? artifact.payload : null;
    if (!payload) continue;

    if (artifact.type === "route_selection") {
      confirmations.push({
        id: stableId("blueprint-confirmation", artifact.id),
        kind: "route_selection",
        artifactId: artifact.id,
        routeId: readString(payload.routeId),
        selectedPathId: readString(payload.selectedPathId) ?? readString(payload.routeId),
        selectionId: readString(payload.id),
        decidedBy: readString(payload.selectedBy),
        note: readString(payload.reason),
        occurredAt: readString(payload.selectedAt) ?? artifact.createdAt,
      });
    }

    if (artifact.type === "spec_tree_version") {
      confirmations.push({
        id: stableId("blueprint-confirmation", artifact.id),
        kind: "spec_tree_version",
        artifactId: artifact.id,
        specTreeId: readString(payload.treeId),
        decidedBy: readString(payload.savedBy),
        note: readString(payload.summary),
        occurredAt: readString(payload.savedAt) ?? artifact.createdAt,
      });
    }

    if (
      artifact.type === "requirements" ||
      artifact.type === "design" ||
      artifact.type === "tasks"
    ) {
      const status = readString(payload.status);
      if (status === "accepted" || status === "rejected" || status === "reviewing") {
        confirmations.push({
          id: stableId("blueprint-confirmation", artifact.id),
          kind: "spec_document_review",
          artifactId: artifact.id,
          documentId: readString(payload.id),
          status,
          decidedBy: readString(payload.reviewedBy),
          note: readString(payload.reviewNote),
          occurredAt:
            readString(payload.reviewedAt) ??
            readString(payload.updatedAt) ??
            artifact.createdAt,
        });
      }
    }

    if (artifact.type === "spec_document_version") {
      confirmations.push({
        id: stableId("blueprint-confirmation", artifact.id),
        kind: "spec_document_version",
        artifactId: artifact.id,
        documentId: readString(payload.documentId),
        specTreeId: readString(payload.treeId),
        status: readString(payload.status),
        decidedBy: readString(payload.savedBy),
        note: readString(payload.reviewNote),
        occurredAt: readString(payload.savedAt) ?? artifact.createdAt,
      });
    }

    if (artifact.type === "prompt_pack") {
      const packageId = readString(payload.id);
      const sectionKinds = Array.isArray(payload.sections)
        ? payload.sections
            .filter(isPlainRecord)
            .map(section => readString(section.kind))
        : [];
      if (packageId && sectionKinds.includes("handoff")) {
        handoffs.push({
          id: stableId("blueprint-handoff-decision", artifact.id),
          kind: "prompt_package",
          artifactId: artifact.id,
          promptPackageIds: [packageId],
          landingPlanIds: [],
          platform: readString(payload.targetPlatform) as
            | BlueprintArtifactDecisionReplay["handoffs"][number]["platform"]
            | undefined,
          occurredAt: artifact.createdAt,
          summary: artifact.summary,
        });
      }
    }

    if (artifact.type === "engineering_plan") {
      const planId = readString(payload.id);
      const handoffItems = Array.isArray(payload.handoffs)
        ? payload.handoffs.filter(isPlainRecord)
        : [];
      for (const handoff of handoffItems) {
        handoffs.push({
          id: stableId(
            "blueprint-handoff-decision",
            `${artifact.id}:${readString(handoff.id) ?? planId ?? "handoff"}`
          ),
          kind: "engineering_plan",
          artifactId: artifact.id,
          promptPackageIds: normalizeStringList(payload.promptPackageIds),
          landingPlanIds: planId ? [planId] : [],
          platform: readString(handoff.platform) as
            | BlueprintArtifactDecisionReplay["handoffs"][number]["platform"]
            | undefined,
          status: readString(payload.status),
          occurredAt: readString(payload.createdAt) ?? artifact.createdAt,
          summary: readString(handoff.summary) ?? artifact.summary,
        });
      }
    }

    if (artifact.type === "engineering_run") {
      const planId = readString(payload.landingPlanId);
      handoffs.push({
        id: stableId("blueprint-handoff-decision", artifact.id),
        kind: "engineering_run",
        artifactId: artifact.id,
        promptPackageIds: normalizeStringList(payload.promptPackageIds),
        landingPlanIds: planId ? [planId] : [],
        status: readString(payload.status),
        occurredAt:
          readString(payload.completedAt) ??
          readString(payload.startedAt) ??
          artifact.createdAt,
        summary: readString(payload.summary) ?? artifact.summary,
      });
    }
  }

  for (const event of job.events) {
    if (event.type !== "mission.handoff") continue;
    const payload = isPlainRecord(event.payload) ? event.payload : {};
    handoffs.push({
      id: stableId("blueprint-handoff-decision", event.id),
      kind: "mission_handoff",
      eventId: event.id,
      promptPackageIds: normalizeStringList(payload.promptPackageIds),
      landingPlanIds: normalizeStringList(payload.landingPlanIds),
      status: event.status,
      occurredAt: event.occurredAt,
      summary: event.message,
    });
  }

  return {
    confirmations: confirmations.sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt)
    ),
    handoffs: handoffs.sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt)
    ),
  };
}

function compareArtifactLedgerEntries(
  job: BlueprintGenerationJob,
  request: BlueprintArtifactDiffRequest
):
  | { ok: true; response: BlueprintArtifactDiffResponse }
  | { ok: false; status: number; error: string; message: string } {
  const entries = buildArtifactLedger(job);
  const left = entries.find(entry => entry.id === request.leftEntryId);
  const right = entries.find(entry => entry.id === request.rightEntryId);

  if (!left || !right) {
    return {
      ok: false,
      status: 404,
      error: "Blueprint artifact ledger entry not found.",
      message: "Both leftEntryId and rightEntryId must match ledger entries.",
    };
  }

  const changedFields = comparePayloadSummaryFields(
    left.payloadSummary,
    right.payloadSummary
  );
  const diff: BlueprintArtifactDiff = {
    id: createId("blueprint-artifact-diff"),
    leftEntryId: left.id,
    rightEntryId: right.id,
    changedFields,
    summary: changedFields.length
      ? `${left.title} differs from ${right.title} across ${changedFields.length} payload field(s).`
      : `${left.title} and ${right.title} have matching payload summaries.`,
  };

  return {
    ok: true,
    response: {
      job,
      diff,
    },
  };
}

function recordArtifactFeedback(
  job: BlueprintGenerationJob,
  request: BlueprintArtifactFeedbackRequest,
  options: CreateGenerationJobHelperOptions
):
  | { ok: true; response: BlueprintArtifactFeedbackResponse }
  | { ok: false; status: number; error: string; message: string } {
  const ledger = buildArtifactLedger(job);
  const entry = request.entryId
    ? ledger.find(item => item.id === request.entryId)
    : ledger.find(item => item.artifactId === request.artifactId);

  if (!entry) {
    return {
      ok: false,
      status: 404,
      error: "Blueprint artifact ledger entry not found.",
      message: "No ledger entry matches the supplied entryId or artifactId.",
    };
  }

  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const sourceIds = mergeArtifactSourceIds(
    entry.sourceIds,
    request.sourceIds
  );
  const feedback: BlueprintArtifactFeedback = {
    id: createId("blueprint-artifact-feedback"),
    jobId: job.id,
    entryId: entry.id,
    artifactId: entry.artifactId,
    artifactType: entry.artifactType,
    kind: request.kind ?? "feedback",
    message: request.message ?? request.summary ?? "Artifact feedback recorded.",
    summary:
      request.summary ??
      `${request.kind ?? "feedback"} recorded for ${entry.title}.`,
    createdAt,
    createdBy: request.createdBy,
    tags: uniqueStrings([...(entry.tags ?? []), ...(request.tags ?? [])]),
    sourceIds,
    payloadSummary: {
      ...entry.payloadSummary,
      ...(request.payloadSummary ?? {}),
    },
  };
  const feedbackArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "feedback",
    title: `Artifact ${feedback.kind}: ${entry.title}`,
    summary: feedback.summary,
    createdAt,
    payload: feedback,
  };
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "engineering_landing",
    updatedAt: createdAt,
    artifacts: job.artifacts.concat(feedbackArtifact),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        type: BlueprintEventName.JobStage,
        stage: "engineering_landing",
        status: "reviewing",
        message: `Artifact ${feedback.kind} recorded.`,
        occurredAt: createdAt,
        payload: {
          feedbackId: feedback.id,
          entryId: entry.id,
          artifactId: entry.artifactId,
          kind: feedback.kind,
        },
      })
    ),
  };

  options.store.save(updatedJob);
  return {
    ok: true,
    response: {
      job: updatedJob,
      feedback,
    },
  };
}

function inferArtifactStage(
  artifactType: BlueprintArtifactMemoryEntry["artifactType"],
  payload: Record<string, unknown>
): BlueprintGenerationStage {
  const payloadStage = readString(payload.stage);
  if (isBlueprintGenerationStage(payloadStage)) {
    return payloadStage;
  }

  if (artifactType === "clarification_session") {
    return "clarification";
  }
  if (
    artifactType === "intake" ||
    artifactType === "github_source" ||
    artifactType === "project_context"
  ) {
    return "input";
  }
  if (artifactType === "route_set" || artifactType === "route_selection") {
    return "route_generation";
  }
  if (artifactType === "spec_tree" || artifactType === "spec_tree_version") {
    return "spec_tree";
  }
  if (
    artifactType === "requirements" ||
    artifactType === "design" ||
    artifactType === "tasks" ||
    artifactType === "spec_document_version"
  ) {
    return "spec_docs";
  }
  if (artifactType === "preview" || artifactType === "effect_preview") {
    return "effect_preview";
  }
  if (artifactType === "prompt_pack") {
    return "prompt_packaging";
  }
  if (artifactType === "role_timeline") {
    return "runtime_capability";
  }
  if (
    artifactType === "agent_crew" ||
    artifactType === "capability_registry" ||
    artifactType === "capability_invocation" ||
    artifactType === "capability_evidence"
  ) {
    return "runtime_capability";
  }
  if (
    artifactType === "engineering_plan" ||
    artifactType === "engineering_run" ||
    artifactType === "replay" ||
    artifactType === "feedback"
  ) {
    return "engineering_landing";
  }

  return "input";
}

function emptyArtifactSourceIds(): BlueprintArtifactSourceIds {
  return {
    nodeIds: [],
    specDocumentIds: [],
    effectPreviewIds: [],
    promptPackageIds: [],
    capabilityInvocationIds: [],
    capabilityEvidenceIds: [],
    landingPlanIds: [],
    engineeringRunIds: [],
    capabilityIds: [],
    roleIds: [],
    crewIds: [],
  };
}

function collectArtifactSourceIds(
  artifactType: BlueprintArtifactMemoryEntry["artifactType"],
  payload: Record<string, unknown>
): BlueprintArtifactSourceIds {
  const explicit = isPlainRecord(payload.sourceIds)
    ? normalizeArtifactSourceIds(payload.sourceIds)
    : emptyArtifactSourceIds();
  const runtimeProjection = isPlainRecord(payload.runtimeProjection)
    ? payload.runtimeProjection
    : {};
  const runtimeProjectionSourceIds = isPlainRecord(runtimeProjection.sourceIds)
    ? normalizeArtifactSourceIds(runtimeProjection.sourceIds)
    : emptyArtifactSourceIds();
  const provenance = isPlainRecord(payload.provenance) ? payload.provenance : {};

  const projectId =
    readString(explicit.projectId) ??
    readString(runtimeProjectionSourceIds.projectId) ??
    readString(payload.projectId) ??
    readString(provenance.projectId);
  const routeSetId =
    readString(explicit.routeSetId) ??
    readString(runtimeProjectionSourceIds.routeSetId) ??
    readString(payload.routeSetId) ??
    readString(provenance.routeSetId) ??
    (artifactType === "route_set" ? readString(payload.id) : undefined);
  const specTreeId =
    readString(explicit.specTreeId) ??
    readString(runtimeProjectionSourceIds.specTreeId) ??
    readString(payload.specTreeId) ??
    readString(payload.treeId) ??
    readString(provenance.specTreeId) ??
    (artifactType === "spec_tree" ? readString(payload.id) : undefined);
  const nodeIds = uniqueStrings(
    explicit.nodeIds.concat(
      runtimeProjectionSourceIds.nodeIds,
      normalizeStringList(payload.nodeIds),
      normalizeStringList(payload.sourceNodeIds),
      normalizeStringList(provenance.nodeIds),
      normalizeStringList(provenance.sourceNodeIds),
      [readString(payload.nodeId)].filter(isString)
    )
  );
  const specDocumentIds = uniqueStrings(
    explicit.specDocumentIds.concat(
      runtimeProjectionSourceIds.specDocumentIds,
      normalizeStringList(payload.specDocumentIds),
      normalizeStringList(payload.sourceDocumentIds),
      normalizeStringList(provenance.sourceDocumentIds),
      artifactType === "requirements" ||
        artifactType === "design" ||
        artifactType === "tasks" ||
        artifactType === "spec_document_version"
        ? [readString(payload.id), readString(payload.documentId)].filter(
            isString
          )
        : []
    )
  );
  const effectPreviewIds = uniqueStrings(
    explicit.effectPreviewIds.concat(
      runtimeProjectionSourceIds.effectPreviewIds,
      normalizeStringList(payload.effectPreviewIds),
      normalizeStringList(payload.sourcePreviewIds),
      normalizeStringList(provenance.sourcePreviewIds),
      artifactType === "effect_preview" || artifactType === "preview"
        ? [readString(payload.id)].filter(isString)
        : []
    )
  );
  const promptPackageIds = uniqueStrings(
    explicit.promptPackageIds.concat(
      runtimeProjectionSourceIds.promptPackageIds,
      normalizeStringList(payload.promptPackageIds),
      normalizeStringList(provenance.promptPackageIds),
      artifactType === "prompt_pack" ? [readString(payload.id)].filter(isString) : []
    )
  );
  const capabilityInvocationIds = uniqueStrings(
    explicit.capabilityInvocationIds.concat(
      runtimeProjectionSourceIds.capabilityInvocationIds,
      normalizeStringList(payload.capabilityInvocationIds),
      normalizeStringList(provenance.capabilityInvocationIds),
      artifactType === "capability_invocation"
        ? [readString(payload.id)].filter(isString)
        : [readString(payload.invocationId)].filter(isString)
    )
  );
  const capabilityEvidenceIds = uniqueStrings(
    explicit.capabilityEvidenceIds.concat(
      runtimeProjectionSourceIds.capabilityEvidenceIds,
      normalizeStringList(payload.capabilityEvidenceIds),
      normalizeStringList(provenance.capabilityEvidenceIds),
      artifactType === "capability_evidence"
        ? [readString(payload.id)].filter(isString)
        : []
    )
  );
  const agentCrewCapabilityIds =
    artifactType === "agent_crew" && Array.isArray(payload.capabilityMatrix)
      ? payload.capabilityMatrix
          .filter(isPlainRecord)
          .map(binding => readString(binding.capabilityId))
          .filter(isString)
      : [];
  const capabilityIds = uniqueStrings(
    explicit.capabilityIds.concat(
      runtimeProjectionSourceIds.capabilityIds,
      normalizeStringList(payload.capabilityIds),
      normalizeStringList(provenance.capabilityIds),
      artifactType === "capability_registry" || artifactType === "agent_crew"
        ? normalizeStringList(payload.capabilities)
        : [],
      agentCrewCapabilityIds,
      [readString(payload.capabilityId)].filter(isString)
    )
  );
  const agentCrewRoleIds =
    artifactType === "agent_crew" && Array.isArray(payload.roles)
      ? payload.roles
          .filter(isPlainRecord)
          .map(role => readString(role.id))
          .filter(isString)
      : [];
  const roleTimelineRoleIds =
    artifactType === "role_timeline" && Array.isArray(payload.timelines)
      ? payload.timelines
          .filter(isPlainRecord)
          .map(timeline => readString(timeline.roleId))
          .filter(isString)
      : [];
  const roleIds = uniqueStrings(
    explicit.roleIds.concat(
      runtimeProjectionSourceIds.roleIds,
      normalizeStringList(payload.roleIds),
      normalizeStringList(provenance.roleIds),
      [readString(payload.roleId)].filter(isString),
      agentCrewRoleIds,
      roleTimelineRoleIds
    )
  );
  const crewIds = uniqueStrings(
    explicit.crewIds.concat(
      runtimeProjectionSourceIds.crewIds,
      normalizeStringList(payload.crewIds),
      normalizeStringList(provenance.crewIds),
      [readString(payload.crewId)].filter(isString),
      artifactType === "agent_crew" ? [readString(payload.id)].filter(isString) : []
    )
  );
  const landingPlanIds = uniqueStrings(
    explicit.landingPlanIds.concat(
      runtimeProjectionSourceIds.landingPlanIds,
      normalizeStringList(payload.landingPlanIds),
      normalizeStringList(provenance.landingPlanIds),
      artifactType === "engineering_plan"
        ? [readString(payload.id)].filter(isString)
        : [readString(payload.landingPlanId)].filter(isString)
    )
  );
  const engineeringRunIds = uniqueStrings(
    explicit.engineeringRunIds.concat(
      runtimeProjectionSourceIds.engineeringRunIds,
      normalizeStringList(payload.engineeringRunIds),
      normalizeStringList(provenance.engineeringRunIds),
      artifactType === "engineering_run"
        ? [readString(payload.id)].filter(isString)
        : []
    )
  );

  return {
    projectId,
    routeSetId,
    specTreeId,
    nodeIds,
    specDocumentIds,
    effectPreviewIds,
    promptPackageIds,
    capabilityInvocationIds,
    capabilityEvidenceIds,
    landingPlanIds,
    engineeringRunIds,
    capabilityIds,
    roleIds,
    crewIds,
  };
}

function normalizeArtifactSourceIds(
  value: Record<string, unknown>
): BlueprintArtifactSourceIds {
  return {
    projectId: readString(value.projectId),
    routeSetId: readString(value.routeSetId),
    specTreeId: readString(value.specTreeId),
    nodeIds: normalizeStringList(value.nodeIds),
    specDocumentIds: normalizeStringList(value.specDocumentIds),
    effectPreviewIds: normalizeStringList(value.effectPreviewIds),
    promptPackageIds: normalizeStringList(value.promptPackageIds),
    capabilityInvocationIds: normalizeStringList(value.capabilityInvocationIds),
    capabilityEvidenceIds: normalizeStringList(value.capabilityEvidenceIds),
    landingPlanIds: normalizeStringList(value.landingPlanIds),
    engineeringRunIds: normalizeStringList(value.engineeringRunIds),
    capabilityIds: normalizeStringList(value.capabilityIds),
    roleIds: normalizeStringList(value.roleIds),
    crewIds: normalizeStringList(value.crewIds),
  };
}

function mergeArtifactSourceIds(
  base: BlueprintArtifactSourceIds,
  override?: Partial<BlueprintArtifactSourceIds>
): BlueprintArtifactSourceIds {
  return {
    routeSetId: override?.routeSetId ?? base.routeSetId,
    projectId: override?.projectId ?? base.projectId,
    specTreeId: override?.specTreeId ?? base.specTreeId,
    nodeIds: uniqueStrings(base.nodeIds.concat(override?.nodeIds ?? [])),
    specDocumentIds: uniqueStrings(
      base.specDocumentIds.concat(override?.specDocumentIds ?? [])
    ),
    effectPreviewIds: uniqueStrings(
      base.effectPreviewIds.concat(override?.effectPreviewIds ?? [])
    ),
    promptPackageIds: uniqueStrings(
      base.promptPackageIds.concat(override?.promptPackageIds ?? [])
    ),
    capabilityInvocationIds: uniqueStrings(
      base.capabilityInvocationIds.concat(
        override?.capabilityInvocationIds ?? []
      )
    ),
    capabilityEvidenceIds: uniqueStrings(
      base.capabilityEvidenceIds.concat(override?.capabilityEvidenceIds ?? [])
    ),
    landingPlanIds: uniqueStrings(
      base.landingPlanIds.concat(override?.landingPlanIds ?? [])
    ),
    engineeringRunIds: uniqueStrings(
      base.engineeringRunIds.concat(override?.engineeringRunIds ?? [])
    ),
    capabilityIds: uniqueStrings(
      base.capabilityIds.concat(override?.capabilityIds ?? [])
    ),
    roleIds: uniqueStrings(base.roleIds.concat(override?.roleIds ?? [])),
    crewIds: uniqueStrings(base.crewIds.concat(override?.crewIds ?? [])),
  };
}

function readArtifactVersion(
  payload: Record<string, unknown>,
  index: number
): number {
  const version = payload.version;
  return typeof version === "number" && Number.isFinite(version)
    ? Math.max(1, Math.trunc(version))
    : index + 1;
}

function buildArtifactLedgerTags(
  artifactType: BlueprintArtifactMemoryEntry["artifactType"],
  stage: BlueprintGenerationStage,
  payload: Record<string, unknown>
): string[] {
  return uniqueStrings(
    [
      artifactType,
      stage,
      readString(payload.status),
      readString(payload.type),
      readString(payload.targetPlatform),
    ].filter(isString)
  );
}

function summarizeArtifactPayload(
  payload: Record<string, unknown>
): BlueprintArtifactPayloadSummary {
  const summary: BlueprintArtifactPayloadSummary = {};
  for (const key of [
    "id",
    "projectId",
    "status",
    "family",
    "type",
    "version",
    "versionStatus",
    "refreshedFromSpecTreeVersion",
    "sourceSnapshotHash",
    "nodeId",
    "treeId",
    "routeSetId",
    "targetPlatform",
    "landingPlanId",
    "capabilityId",
    "roleId",
    "presenceState",
    "crewId",
    "invocationId",
    "evidenceId",
    "securityLevel",
  ]) {
    const value = payload[key];
    if (isArtifactPayloadSummaryValue(value)) {
      summary[key] = value;
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      summary[`${key}Count`] = value.length;
    }
  }

  return summary;
}

function buildArtifactReplayStageCounts(
  ledger: BlueprintArtifactMemoryEntry[]
): Record<BlueprintGenerationStage, number> {
  const counts = Object.fromEntries(
    BLUEPRINT_GENERATION_STAGES.map(stage => [stage, 0])
  ) as Record<BlueprintGenerationStage, number>;

  for (const entry of ledger) {
    counts[entry.stage] += 1;
  }

  return counts;
}

function buildRoleTimelineCollection(
  job: BlueprintGenerationJob,
  updatedAt: string,
  agentCrew?: BlueprintAgentCrew
): BlueprintRoleTimelineCollection {
  const roleById = new Map(
    (agentCrew?.roles ?? getDefaultAgentRoles()).map(role => [role.id, role])
  );
  const roleEvents = job.events
    .filter(event => event.family === "role")
    .filter(event => typeof event.roleId === "string")
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.id.localeCompare(right.id)
    );
  const entriesByRoleId = new Map<string, BlueprintRoleTimelineEntry[]>();

  for (const event of roleEvents) {
    const roleId = event.roleId;
    if (!roleId) continue;
    const payload = isPlainRecord(event.payload) ? event.payload : {};
    const sourceIds = isPlainRecord(payload.sourceIds)
      ? normalizeArtifactSourceIds(payload.sourceIds)
      : collectArtifactSourceIds("event", payload);
    const presenceState = isRolePresenceState(event.presenceState)
      ? event.presenceState
      : "watching";
    const entry: BlueprintRoleTimelineEntry = {
      id: `blueprint-role-timeline-entry-${event.id}`,
      eventId: event.id,
      jobId: job.id,
      projectId: event.projectId ?? job.projectId,
      crewId: readString(payload.crewId),
      stage: event.stage,
      roleId,
      presenceState,
      type: event.type,
      occurredAt: event.occurredAt,
      summary: event.message,
      currentAction: readString(payload.currentAction),
      capabilityId: event.capabilityId ?? readString(payload.capabilityId),
      invocationId: readString(payload.invocationId),
      evidenceId: event.evidenceId ?? readString(payload.evidenceId),
      artifactId: event.artifactId ?? readString(payload.artifactId),
      routeId: event.routeId ?? readString(payload.routeId),
      selectionId: event.selectionId ?? readString(payload.selectionId),
      specTreeId: event.specTreeId ?? readString(payload.specTreeId),
      nodeId: event.nodeId ?? readString(payload.nodeId),
      sourceIds,
    };
    entriesByRoleId.set(
      roleId,
      (entriesByRoleId.get(roleId) ?? []).concat(entry)
    );
  }

  const timelines = Array.from(entriesByRoleId.entries())
    .map(([roleId, entries]) => {
      const latest = entries[entries.length - 1];
      const role = roleById.get(roleId);
      return {
        id: stableId("blueprint-role-timeline", `${job.id}:${roleId}`),
        jobId: job.id,
        projectId: job.projectId,
        crewId: latest.crewId ?? agentCrew?.id,
        roleId,
        roleDisplayName: role?.displayName,
        roleDisplayLabelZh: role?.displayLabelZh,
        latestStage: latest.stage,
        latestPresenceState: latest.presenceState,
        latestAction: latest.currentAction ?? latest.summary,
        latestCapabilityId: latest.capabilityId,
        latestArtifactId: latest.artifactId,
        latestEvidenceId: latest.evidenceId,
        startedAt: entries[0].occurredAt,
        updatedAt: latest.occurredAt,
        entryCount: entries.length,
        entries,
      } satisfies BlueprintRoleTimeline;
    })
    .sort((left, right) => left.roleId.localeCompare(right.roleId));
  const sourceIds: Partial<BlueprintArtifactSourceIds> = {
    projectId: job.projectId,
    roleIds: uniqueStrings(timelines.map(timeline => timeline.roleId)),
    crewIds: uniqueStrings(
      timelines.map(timeline => timeline.crewId).filter(isString)
    ),
    capabilityIds: uniqueStrings(
      timelines.flatMap(timeline =>
        timeline.entries.map(entry => entry.capabilityId).filter(isString)
      )
    ),
    capabilityInvocationIds: uniqueStrings(
      timelines.flatMap(timeline =>
        timeline.entries.map(entry => entry.invocationId).filter(isString)
      )
    ),
    capabilityEvidenceIds: uniqueStrings(
      timelines.flatMap(timeline =>
        timeline.entries.map(entry => entry.evidenceId).filter(isString)
      )
    ),
    nodeIds: uniqueStrings(
      timelines.flatMap(timeline =>
        timeline.entries.map(entry => entry.nodeId).filter(isString)
      )
    ),
  };

  return {
    id: stableId("blueprint-role-timeline-collection", job.id),
    jobId: job.id,
    projectId: job.projectId,
    createdAt: timelines[0]?.startedAt ?? job.createdAt,
    updatedAt,
    latestStage: job.stage,
    timelines,
    sourceIds,
  };
}

function filterRoleTimelines(
  timelines: BlueprintRoleTimeline[],
  filters: BlueprintRoleTimelineFilters
): BlueprintRoleTimeline[] {
  const filteredTimelines: BlueprintRoleTimeline[] = [];

  for (const timeline of timelines) {
    if (filters.jobId && timeline.jobId !== filters.jobId) {
      continue;
    }
    if (filters.roleId && timeline.roleId !== filters.roleId) {
      continue;
    }

    const entries = timeline.entries.filter(entry => {
      if (filters.stage && entry.stage !== filters.stage) return false;
      if (filters.routeId && entry.routeId !== filters.routeId) return false;
      if (filters.nodeId && entry.nodeId !== filters.nodeId) return false;
      if (filters.artifactId && entry.artifactId !== filters.artifactId) {
        return false;
      }
      if (filters.capabilityId && entry.capabilityId !== filters.capabilityId) {
        return false;
      }
      if (filters.from && entry.occurredAt < filters.from) return false;
      if (filters.to && entry.occurredAt > filters.to) return false;
      return true;
    });

    if (entries.length === 0) continue;
    const latest = entries[entries.length - 1];
    filteredTimelines.push({
      ...timeline,
      latestStage: latest.stage,
      latestPresenceState: latest.presenceState,
      latestAction: latest.currentAction ?? latest.summary,
      latestCapabilityId: latest.capabilityId,
      latestArtifactId: latest.artifactId,
      latestEvidenceId: latest.evidenceId,
      startedAt: entries[0].occurredAt,
      updatedAt: latest.occurredAt,
      entryCount: entries.length,
      entries,
    });
  }

  return filteredTimelines;
}

function buildArtifactLineageEdges(
  ledger: BlueprintArtifactMemoryEntry[]
): BlueprintArtifactLineageEdge[] {
  const entryByArtifactId = new Map<string, BlueprintArtifactMemoryEntry>();
  for (const entry of ledger) {
    entryByArtifactId.set(entry.artifactId, entry);
    const payloadId = entry.payloadSummary.id;
    if (typeof payloadId === "string") {
      entryByArtifactId.set(payloadId, entry);
    }
  }
  const edges: BlueprintArtifactLineageEdge[] = [];

  for (const entry of ledger) {
    const sources: Array<{
      ids: string[];
      sourceType: BlueprintArtifactLineageEdge["sourceType"];
    }> = [
      {
        ids: entry.sourceIds.projectId ? [entry.sourceIds.projectId] : [],
        sourceType: "project",
      },
      {
        ids: entry.sourceIds.routeSetId ? [entry.sourceIds.routeSetId] : [],
        sourceType: "route_set",
      },
      {
        ids: entry.sourceIds.specTreeId ? [entry.sourceIds.specTreeId] : [],
        sourceType: "spec_tree",
      },
      { ids: entry.sourceIds.specDocumentIds, sourceType: "spec_document" },
      { ids: entry.sourceIds.nodeIds, sourceType: "spec_node" },
      { ids: entry.sourceIds.effectPreviewIds, sourceType: "effect_preview" },
      { ids: entry.sourceIds.promptPackageIds, sourceType: "prompt_package" },
      { ids: entry.sourceIds.capabilityIds, sourceType: "capability_registry" },
      { ids: entry.sourceIds.roleIds, sourceType: "role" },
      { ids: entry.sourceIds.crewIds, sourceType: "crew" },
      {
        ids: entry.sourceIds.capabilityInvocationIds,
        sourceType: "capability_invocation",
      },
      {
        ids: entry.sourceIds.capabilityEvidenceIds,
        sourceType: "capability_evidence",
      },
      { ids: entry.sourceIds.landingPlanIds, sourceType: "landing_plan" },
      { ids: entry.sourceIds.engineeringRunIds, sourceType: "engineering_run" },
    ];

    for (const source of sources) {
      for (const sourceId of source.ids) {
        const fromEntry = entryByArtifactId.get(sourceId);
        if (!fromEntry || fromEntry.id === entry.id) continue;
        edges.push({
          id: `blueprint-lineage-${fromEntry.id}-${entry.id}-${sourceId}`,
          fromEntryId: fromEntry.id,
          toEntryId: entry.id,
          sourceId,
          sourceType: source.sourceType,
          relation: "derived_from",
        });
      }
    }
  }

  return edges;
}

function comparePayloadSummaryFields(
  left: BlueprintArtifactPayloadSummary,
  right: BlueprintArtifactPayloadSummary
): string[] {
  const fields = uniqueStrings(Object.keys(left).concat(Object.keys(right)));
  return fields.filter(
    field => JSON.stringify(left[field]) !== JSON.stringify(right[field])
  );
}

function createJobDetailsPayload(
  job: BlueprintGenerationJob | null,
  stores?: BlueprintIntakeStores
): BlueprintLatestGenerationJobResponse {
  if (!job) {
    return { job: null };
  }

  if (stores) {
    hydrateBlueprintStoresFromJob(job, stores);
  }

  const intake = extractIntake(job, stores);
  const clarificationSession = extractClarificationSession(job, stores);
  const projectContext = extractProjectContext(job, intake, stores);

  const engineeringLandingPlans = extractEngineeringLandingPlans(job);

  return {
    job: projectHandoffOntoJob(job),
    routeSet: extractRouteSet(job),
    selection: extractRouteSelection(job),
    specTree: extractSpecTree(job),
    intake,
    clarificationSession,
    projectContext,
    specDocuments: extractSpecDocuments(job),
    specDocumentVersions: extractSpecDocumentVersions(job),
    effectPreviews: extractEffectPreviews(job),
    promptPackages: extractImplementationPromptPackages(job),
    capabilities: extractRuntimeCapabilities(job),
    agentCrew: extractAgentCrew(job),
    roleTimelines: extractRoleTimelines(job),
    capabilityInvocations: extractCapabilityInvocations(job),
    capabilityEvidence: extractCapabilityEvidence(job),
    sandboxDerivationJobs: extractSandboxDerivationJobs(job),
    specTreeVersions: extractSpecTreeVersions(job),
    landingPlans: engineeringLandingPlans,
    engineeringLandingPlans,
    engineeringRuns: extractEngineeringRuns(job),
    artifactLedgerEntries: buildArtifactLedger(job),
    artifactReplays: extractArtifactReplays(job),
    artifactFeedback: extractArtifactFeedback(job),
  };
}

function readOptionalQueryString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    return readOptionalQueryString(value[0]);
  }
  return undefined;
}

function formatServerSentEvent(
  eventName: string,
  data: unknown,
  id?: string
): string {
  const lines: string[] = [];
  if (id) {
    lines.push(`id: ${id}`);
  }
  lines.push(`event: ${eventName}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

type ParseRouteSelectionRequestResult =
  | { ok: true; request: BlueprintRouteSelectionRequest }
  | { ok: false; message: string };

function parseRouteSelectionRequest(
  body: unknown
): ParseRouteSelectionRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const routeId = readString(body.routeId);
  if (!routeId) {
    return {
      ok: false,
      message: "Provide routeId to select an autopilot route.",
    };
  }

  return {
    ok: true,
    request: {
      routeId,
      reason: readString(body.reason),
      selectedBy: readString(body.selectedBy),
      mergedAlternativeRouteIds: normalizeStringList(
        body.mergedAlternativeRouteIds
      ),
    },
  };
}

type ParseUpdateSpecTreeNodeRequestResult =
  | { ok: true; request: BlueprintUpdateSpecTreeNodeRequest }
  | { ok: false; message: string };

function parseUpdateSpecTreeNodeRequest(
  body: unknown
): ParseUpdateSpecTreeNodeRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const request: BlueprintUpdateSpecTreeNodeRequest = {};
  let hasUpdate = false;

  if (hasOwn(body, "title")) {
    const title = readString(body.title);
    if (!title) {
      return {
        ok: false,
        message: "title must be a non-empty string when provided.",
      };
    }
    request.title = title;
    hasUpdate = true;
  }

  if (hasOwn(body, "summary")) {
    const summary = readString(body.summary);
    if (!summary) {
      return {
        ok: false,
        message: "summary must be a non-empty string when provided.",
      };
    }
    request.summary = summary;
    hasUpdate = true;
  }

  if (hasOwn(body, "status")) {
    if (!isSpecTreeNodeStatus(body.status)) {
      return {
        ok: false,
        message:
          "status must be one of seed, draft, ready, or accepted when provided.",
      };
    }
    request.status = body.status;
    hasUpdate = true;
  }

  if (hasOwn(body, "priority")) {
    if (
      typeof body.priority !== "number" ||
      !Number.isFinite(body.priority) ||
      body.priority < 0
    ) {
      return {
        ok: false,
        message: "priority must be a non-negative number when provided.",
      };
    }
    request.priority = Math.trunc(body.priority);
    hasUpdate = true;
  }

  if (hasOwn(body, "outputs")) {
    if (!Array.isArray(body.outputs)) {
      return {
        ok: false,
        message: "outputs must be an array of strings when provided.",
      };
    }
    request.outputs = normalizeStringList(body.outputs);
    hasUpdate = true;
  }

  if (!hasUpdate) {
    return {
      ok: false,
      message:
        "Provide at least one editable field: title, summary, status, priority, or outputs.",
    };
  }

  return { ok: true, request };
}

type ParseSpecTreeActionRequestResult =
  | { ok: true; request: BlueprintSpecTreeActionRequest }
  | { ok: false; message: string };

function parseSpecTreeActionRequest(
  body: unknown
): ParseSpecTreeActionRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  switch (body.action) {
    case "add_node": {
      const parentId = readString(body.parentId);
      const title = readString(body.title);
      if (!parentId || !title) {
        return {
          ok: false,
          message: "add_node requires parentId and title.",
        };
      }
      if (hasOwn(body, "type") && !isSpecTreeNodeType(body.type)) {
        return {
          ok: false,
          message: "type must be a valid SPEC tree node type when provided.",
        };
      }
      if (hasOwn(body, "status") && !isSpecTreeNodeStatus(body.status)) {
        return {
          ok: false,
          message:
            "status must be one of seed, draft, ready, or accepted when provided.",
        };
      }
      if (hasOwn(body, "priority") && !isNonNegativeNumber(body.priority)) {
        return {
          ok: false,
          message: "priority must be a non-negative number when provided.",
        };
      }
      if (hasOwn(body, "outputs") && !Array.isArray(body.outputs)) {
        return {
          ok: false,
          message: "outputs must be an array of strings when provided.",
        };
      }

      return {
        ok: true,
        request: {
          action: "add_node",
          parentId,
          title,
          summary: readString(body.summary),
          type: isSpecTreeNodeType(body.type) ? body.type : undefined,
          status: isSpecTreeNodeStatus(body.status) ? body.status : undefined,
          priority: isNonNegativeNumber(body.priority)
            ? Math.trunc(body.priority)
            : undefined,
          outputs: normalizeStringList(body.outputs),
        },
      };
    }
    case "delete_node": {
      const nodeId = readString(body.nodeId);
      if (!nodeId) {
        return { ok: false, message: "delete_node requires nodeId." };
      }
      return { ok: true, request: { action: "delete_node", nodeId } };
    }
    case "move_node": {
      const nodeId = readString(body.nodeId);
      const parentId = readString(body.parentId);
      if (!nodeId || !parentId) {
        return {
          ok: false,
          message: "move_node requires nodeId and parentId.",
        };
      }
      if (hasOwn(body, "priority") && !isNonNegativeNumber(body.priority)) {
        return {
          ok: false,
          message: "priority must be a non-negative number when provided.",
        };
      }
      return {
        ok: true,
        request: {
          action: "move_node",
          nodeId,
          parentId,
          priority: isNonNegativeNumber(body.priority)
            ? Math.trunc(body.priority)
            : undefined,
        },
      };
    }
    case "merge_nodes": {
      const sourceNodeId = readString(body.sourceNodeId);
      const targetNodeId = readString(body.targetNodeId);
      if (!sourceNodeId || !targetNodeId) {
        return {
          ok: false,
          message: "merge_nodes requires sourceNodeId and targetNodeId.",
        };
      }
      return {
        ok: true,
        request: { action: "merge_nodes", sourceNodeId, targetNodeId },
      };
    }
    case "split_node": {
      const sourceNodeId = readString(body.sourceNodeId);
      const title = readString(body.title);
      if (!sourceNodeId || !title) {
        return {
          ok: false,
          message: "split_node requires sourceNodeId and title.",
        };
      }
      if (
        hasOwn(body, "placement") &&
        body.placement !== "sibling" &&
        body.placement !== "child"
      ) {
        return {
          ok: false,
          message: "placement must be sibling or child when provided.",
        };
      }
      if (hasOwn(body, "outputs") && !Array.isArray(body.outputs)) {
        return {
          ok: false,
          message: "outputs must be an array of strings when provided.",
        };
      }
      return {
        ok: true,
        request: {
          action: "split_node",
          sourceNodeId,
          title,
          summary: readString(body.summary),
          outputs: normalizeStringList(body.outputs),
          placement:
            body.placement === "child" || body.placement === "sibling"
              ? body.placement
              : undefined,
        },
      };
    }
    case "set_current_version": {
      const versionId = readString(body.versionId);
      if (!versionId) {
        return {
          ok: false,
          message: "set_current_version requires versionId.",
        };
      }
      return {
        ok: true,
        request: { action: "set_current_version", versionId },
      };
    }
    default:
      return {
        ok: false,
        message:
          "action must be one of add_node, delete_node, move_node, merge_nodes, split_node, or set_current_version.",
      };
  }
}

type ParseSaveSpecTreeVersionRequestResult =
  | {
      ok: true;
      request: { title?: string; summary?: string; savedBy?: string };
    }
  | { ok: false; message: string };

function parseSaveSpecTreeVersionRequest(
  body: unknown
): ParseSaveSpecTreeVersionRequestResult {
  if (body === undefined || body === null) {
    return { ok: true, request: {} };
  }

  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  return {
    ok: true,
    request: {
      title: readString(body.title),
      summary: readString(body.summary),
      savedBy: readString(body.savedBy),
    },
  };
}

type ParseSaveSpecDocumentVersionRequestResult =
  | {
      ok: true;
      request: { savedBy?: string; reviewNote?: string };
    }
  | { ok: false; message: string };

function parseSaveSpecDocumentVersionRequest(
  body: unknown
): ParseSaveSpecDocumentVersionRequestResult {
  if (body === undefined || body === null) {
    return { ok: true, request: {} };
  }

  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  return {
    ok: true,
    request: {
      savedBy: readString(body.savedBy),
      reviewNote: readString(body.reviewNote),
    },
  };
}

type ParseReviewSpecDocumentRequestResult =
  | { ok: true; request: BlueprintReviewSpecDocumentRequest }
  | { ok: false; message: string };

function parseReviewSpecDocumentRequest(
  body: unknown
): ParseReviewSpecDocumentRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const rawStatus = readString(body.status) ?? readString(body.action);
  const status =
    rawStatus === "accept"
      ? "accepted"
      : rawStatus === "reject"
        ? "rejected"
        : rawStatus;

  if (!isSpecDocumentReviewStatus(status)) {
    return {
      ok: false,
      message: "status must be accepted, rejected, or reviewing.",
    };
  }

  return {
    ok: true,
    request: {
      status,
      reviewedBy: readString(body.reviewedBy),
      reviewNote: readString(body.reviewNote ?? body.note),
    },
  };
}

type ParseSpecDocumentFiltersResult =
  | {
      ok: true;
      filters: { nodeId?: string; type?: BlueprintSpecDocumentType };
    }
  | { ok: false; message: string };

type ParseEffectPreviewFiltersResult =
  | {
      ok: true;
      filters: { nodeId?: string };
    }
  | { ok: false; message: string };

type ParseImplementationPromptPackageFiltersResult =
  | {
      ok: true;
      filters: {
        nodeId?: string;
        targetPlatforms?: BlueprintImplementationPromptTargetPlatform[];
      };
    }
  | { ok: false; message: string };

type ParseGenerateSpecDocumentsRequestResult =
  | { ok: true; request: BlueprintGenerateSpecDocumentsRequest }
  | { ok: false; message: string };

type ParseGenerateEffectPreviewsRequestResult =
  | { ok: true; request: BlueprintGenerateEffectPreviewsRequest }
  | { ok: false; message: string };

type ParseGenerateImplementationPromptPackagesRequestResult =
  | { ok: true; request: BlueprintGenerateImplementationPromptPackagesRequest }
  | { ok: false; message: string };

type ParseGenerateEngineeringLandingPlansRequestResult =
  | { ok: true; request: BlueprintGenerateEngineeringLandingPlansRequest }
  | { ok: false; message: string };

type ParseRecordEngineeringRunRequestResult =
  | { ok: true; request: BlueprintRecordEngineeringRunRequest }
  | { ok: false; message: string };

type ParseCapabilityInvocationRequestResult =
  | { ok: true; request: BlueprintCapabilityInvocationRequest }
  | { ok: false; message: string };

type ParseCapabilityInvocationFiltersResult =
  | { ok: true; filters: BlueprintFetchCapabilityInvocationsRequest }
  | { ok: false; message: string };

type ParseCapabilityEvidenceFiltersResult =
  | { ok: true; filters: BlueprintFetchCapabilityEvidenceRequest }
  | { ok: false; message: string };

type ParseGenerationEventFiltersResult =
  | { ok: true; filters: BlueprintGenerationEventFilters }
  | { ok: false; message: string };

type ParseRoleTimelineFiltersResult =
  | { ok: true; filters: BlueprintRoleTimelineFilters }
  | { ok: false; message: string };

type ParseSandboxDerivationJobRequestResult =
  | { ok: true; request: BlueprintSandboxDerivationJobRequest }
  | { ok: false; message: string };

type ParseCreateArtifactReplayRequestResult =
  | { ok: true; request: BlueprintCreateArtifactReplayRequest }
  | { ok: false; message: string };

type ParseArtifactDiffRequestResult =
  | { ok: true; request: BlueprintArtifactDiffRequest }
  | { ok: false; message: string };

type ParseArtifactFeedbackRequestResult =
  | { ok: true; request: BlueprintArtifactFeedbackRequest }
  | { ok: false; message: string };

function parseGenerateSpecDocumentsRequest(
  body: unknown
): ParseGenerateSpecDocumentsRequestResult {
  if (body === undefined || body === null) {
    return { ok: true, request: {} };
  }

  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const request: BlueprintGenerateSpecDocumentsRequest = {};

  if (hasOwn(body, "nodeId")) {
    const nodeId = readString(body.nodeId);
    if (!nodeId) {
      return {
        ok: false,
        message: "nodeId must be a non-empty string when provided.",
      };
    }
    request.nodeId = nodeId;
  }

  if (hasOwn(body, "types")) {
    if (!Array.isArray(body.types)) {
      return {
        ok: false,
        message: "types must be an array when provided.",
      };
    }

    const types: BlueprintSpecDocumentType[] = [];
    for (const value of body.types) {
      const type = readString(value);
      if (!isSpecDocumentType(type)) {
        return {
          ok: false,
          message: "types must only contain requirements, design, or tasks.",
        };
      }
      if (!types.includes(type)) {
        types.push(type);
      }
    }

    if (types.length === 0) {
      return {
        ok: false,
        message: "types must include at least one document type when provided.",
      };
    }

    request.types = types;
  }

  // Preserve locale for downstream LLM generation
  request.locale = resolveRequestLocale(body);

  return { ok: true, request };
}

function parseGenerateEffectPreviewsRequest(
  body: unknown
): ParseGenerateEffectPreviewsRequestResult {
  if (body === undefined || body === null) {
    return { ok: true, request: {} };
  }

  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const request: BlueprintGenerateEffectPreviewsRequest = {};

  if (hasOwn(body, "nodeId")) {
    const nodeId = readString(body.nodeId);
    if (!nodeId) {
      return {
        ok: false,
        message: "nodeId must be a non-empty string when provided.",
      };
    }
    request.nodeId = nodeId;
  }

  if (hasOwn(body, "includeDrafts")) {
    if (typeof body.includeDrafts !== "boolean") {
      return {
        ok: false,
        message: "includeDrafts must be a boolean when provided.",
      };
    }
    request.includeDrafts = body.includeDrafts;
  }

  return { ok: true, request };
}

function parseGenerateImplementationPromptPackagesRequest(
  body: unknown
): ParseGenerateImplementationPromptPackagesRequestResult {
  if (body === undefined || body === null) {
    return { ok: true, request: {} };
  }

  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const request: BlueprintGenerateImplementationPromptPackagesRequest = {};

  if (hasOwn(body, "nodeId")) {
    const nodeId = readString(body.nodeId);
    if (!nodeId) {
      return {
        ok: false,
        message: "nodeId must be a non-empty string when provided.",
      };
    }
    request.nodeId = nodeId;
  }

  const rawTargetPlatforms = hasOwn(body, "targetPlatforms")
    ? body.targetPlatforms
    : hasOwn(body, "platforms")
      ? body.platforms
      : undefined;

  if (rawTargetPlatforms !== undefined) {
    if (!Array.isArray(rawTargetPlatforms)) {
      return {
        ok: false,
        message: "targetPlatforms must be an array when provided.",
      };
    }

    const targetPlatforms = parsePromptTargetPlatforms(rawTargetPlatforms);
    if (!targetPlatforms.ok) {
      return targetPlatforms;
    }
    request.targetPlatforms = targetPlatforms.platforms;
  }

  if (hasOwn(body, "includeDrafts")) {
    if (typeof body.includeDrafts !== "boolean") {
      return {
        ok: false,
        message: "includeDrafts must be a boolean when provided.",
      };
    }
    request.includeDrafts = body.includeDrafts;
  }

  if (hasOwn(body, "includePreviewDrafts")) {
    if (typeof body.includePreviewDrafts !== "boolean") {
      return {
        ok: false,
        message: "includePreviewDrafts must be a boolean when provided.",
      };
    }
    request.includePreviewDrafts = body.includePreviewDrafts;
  }

  return { ok: true, request };
}

function parseGenerateEngineeringLandingPlansRequest(
  body: unknown
): ParseGenerateEngineeringLandingPlansRequestResult {
  if (body === undefined || body === null) {
    return { ok: true, request: {} };
  }

  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const request: BlueprintGenerateEngineeringLandingPlansRequest = {};

  if (hasOwn(body, "promptPackageId")) {
    const promptPackageId = readString(body.promptPackageId);
    if (!promptPackageId) {
      return {
        ok: false,
        message: "promptPackageId must be a non-empty string when provided.",
      };
    }
    request.promptPackageId = promptPackageId;
  }

  const rawPlatforms: unknown[] = [];
  const rawPlatformList = hasOwn(body, "targetPlatforms")
    ? body.targetPlatforms
    : hasOwn(body, "platforms")
      ? body.platforms
      : undefined;

  if (rawPlatformList !== undefined) {
    if (!Array.isArray(rawPlatformList)) {
      return {
        ok: false,
        message: "targetPlatforms must be an array when provided.",
      };
    }
    rawPlatforms.push(...rawPlatformList);
  }

  if (hasOwn(body, "targetPlatform") || hasOwn(body, "platform")) {
    const platform = readString(body.targetPlatform ?? body.platform);
    if (!platform) {
      return {
        ok: false,
        message: "targetPlatform must be a non-empty string when provided.",
      };
    }
    rawPlatforms.push(platform);
  }

  if (rawPlatforms.length > 0) {
    const targetPlatforms = parsePromptTargetPlatforms(rawPlatforms);
    if (!targetPlatforms.ok) {
      return targetPlatforms;
    }

    request.targetPlatforms = targetPlatforms.platforms;
    if (targetPlatforms.platforms.length === 1) {
      request.targetPlatform = targetPlatforms.platforms[0];
    }
  }

  return { ok: true, request };
}

function parseRecordEngineeringRunRequest(
  body: unknown
): ParseRecordEngineeringRunRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const landingPlanId = readString(body.landingPlanId);
  if (!landingPlanId) {
    return {
      ok: false,
      message: "Provide landingPlanId to record an engineering run.",
    };
  }

  const status = readString(body.status) ?? "running";
  if (!isEngineeringRunStatus(status)) {
    return {
      ok: false,
      message: "status must be planned, running, passed, failed, or blocked.",
    };
  }

  const startedAt = readOptionalStringField(body, "startedAt");
  if (!startedAt.ok) return startedAt;

  const completedAt = readOptionalStringField(body, "completedAt");
  if (!completedAt.ok) return completedAt;

  const logs = readOptionalStringListField(body, "logs");
  if (!logs.ok) return logs;

  const changedFiles = readOptionalStringListField(body, "changedFiles");
  if (!changedFiles.ok) return changedFiles;

  const promptPackageIds = readOptionalStringListField(
    body,
    "promptPackageIds"
  );
  if (!promptPackageIds.ok) return promptPackageIds;

  const capabilityInvocationIds = readOptionalStringListField(
    body,
    "capabilityInvocationIds"
  );
  if (!capabilityInvocationIds.ok) return capabilityInvocationIds;

  const capabilityEvidenceIds = readOptionalStringListField(
    body,
    "capabilityEvidenceIds"
  );
  if (!capabilityEvidenceIds.ok) return capabilityEvidenceIds;

  const verificationResults = parseEngineeringVerificationResults(
    body.verificationResults
  );
  if (!verificationResults.ok) return verificationResults;

  return {
    ok: true,
    request: {
      landingPlanId,
      status,
      startedAt: startedAt.value,
      completedAt: completedAt.value,
      summary: readString(body.summary),
      logs: logs.values,
      verificationResults: verificationResults.results,
      changedFiles: changedFiles.values,
      promptPackageIds: promptPackageIds.values,
      capabilityInvocationIds: capabilityInvocationIds.values,
      capabilityEvidenceIds: capabilityEvidenceIds.values,
    },
  };
}

function parseCapabilityInvocationRequest(
  body: unknown
): ParseCapabilityInvocationRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const capabilityId = readString(body.capabilityId);
  if (!capabilityId) {
    return {
      ok: false,
      message: "Provide capabilityId to invoke a runtime capability.",
    };
  }

  const roleId = readString(body.roleId);
  if (!roleId) {
    return {
      ok: false,
      message: "Provide roleId to invoke a blueprint runtime capability.",
    };
  }

  const evidenceTags = hasOwn(body, "evidenceTags")
    ? normalizeStringList(body.evidenceTags)
    : [];

  return {
    ok: true,
    request: {
      capabilityId,
      roleId,
      routeId: readString(body.routeId),
      nodeId: readString(body.nodeId),
      input: readString(body.input),
      approved: typeof body.approved === "boolean" ? body.approved : undefined,
      requestedBy: readString(body.requestedBy),
      evidenceTags,
    },
  };
}

function parseCapabilityInvocationFilters(
  query: Record<string, unknown>
): ParseCapabilityInvocationFiltersResult {
  const capabilityId = readString(query.capabilityId);
  const nodeId = readString(query.nodeId);
  const routeId = readString(query.routeId);

  return {
    ok: true,
    filters: {
      capabilityId,
      nodeId,
      routeId,
    },
  };
}

function parseCapabilityEvidenceFilters(
  query: Record<string, unknown>
): ParseCapabilityEvidenceFiltersResult {
  const capabilityId = readString(query.capabilityId);
  const nodeId = readString(query.nodeId);
  const routeId = readString(query.routeId);

  return {
    ok: true,
    filters: {
      capabilityId,
      nodeId,
      routeId,
    },
  };
}

function parseGenerationEventFilters(
  query: Record<string, unknown>
): ParseGenerationEventFiltersResult {
  const stage = readString(query.stage);
  if (stage && !isBlueprintGenerationStage(stage)) {
    return {
      ok: false,
      message:
        "stage must be one of input, clarification, route_generation, spec_tree, spec_docs, preview, effect_preview, prompt_packaging, runtime_capability, engineering_handoff, or engineering_landing.",
    };
  }

  const family = readString(query.family);
  if (family && !isGenerationEventFamily(family)) {
    return {
      ok: false,
      message:
        "family must be one of job, crew, role, capability, preview, prompt, mission, or sandbox.",
    };
  }

  return {
    ok: true,
    filters: {
      jobId: readString(query.jobId),
      stage: stage as BlueprintGenerationStage | undefined,
      family: family as BlueprintGenerationEventFamily | undefined,
      routeId: readString(query.routeId),
      nodeId: readString(query.nodeId),
      artifactId: readString(query.artifactId),
      roleId: readString(query.roleId),
      capabilityId: readString(query.capabilityId),
      evidenceId: readString(query.evidenceId),
    },
  };
}

function parseRoleTimelineFilters(
  query: Record<string, unknown>
): ParseRoleTimelineFiltersResult {
  const stage = readString(query.stage);
  if (stage && !isBlueprintGenerationStage(stage)) {
    return {
      ok: false,
      message:
        "stage must be one of input, clarification, route_generation, spec_tree, spec_docs, preview, effect_preview, prompt_packaging, runtime_capability, engineering_handoff, or engineering_landing.",
    };
  }

  return {
    ok: true,
    filters: {
      jobId: readString(query.jobId),
      roleId: readString(query.roleId),
      stage: stage as BlueprintGenerationStage | undefined,
      routeId: readString(query.routeId),
      nodeId: readString(query.nodeId),
      artifactId: readString(query.artifactId),
      capabilityId: readString(query.capabilityId),
      from: readString(query.from),
      to: readString(query.to),
    },
  };
}

function filterGenerationEvents(
  events: BlueprintGenerationEvent[],
  filters: BlueprintGenerationEventFilters
): BlueprintGenerationEvent[] {
  return events.filter(event => {
    if (filters.jobId && event.jobId !== filters.jobId) return false;
    if (filters.stage && event.stage !== filters.stage) return false;
    const family = event.family ?? mapGenerationEventFamily(event.type);
    if (filters.family && family !== filters.family) return false;
    if (filters.routeId && event.routeId !== filters.routeId) return false;
    if (filters.nodeId && event.nodeId !== filters.nodeId) return false;
    if (filters.artifactId && event.artifactId !== filters.artifactId) return false;
    if (filters.roleId && event.roleId !== filters.roleId) return false;
    if (filters.capabilityId && event.capabilityId !== filters.capabilityId) {
      return false;
    }
    if (filters.evidenceId && event.evidenceId !== filters.evidenceId) {
      return false;
    }
    return true;
  });
}

function parseSandboxDerivationJobRequest(
  body: unknown
): ParseSandboxDerivationJobRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const rawCapabilities = Array.isArray(body.capabilities)
    ? body.capabilities
    : [];
  if (rawCapabilities.length === 0) {
    return {
      ok: false,
      message: "Provide at least one capability request.",
    };
  }

  const stage = readString(body.stage);
  if (stage && !isBlueprintGenerationStage(stage)) {
    return {
      ok: false,
      message: "stage must be a valid blueprint generation stage.",
    };
  }

  const executionMode = readString(body.executionMode);
  if (executionMode && !isSandboxDerivationExecutionMode(executionMode)) {
    return {
      ok: false,
      message: "executionMode must be sequential or parallel.",
    };
  }

  const capabilities: BlueprintSandboxDerivationJobRequest["capabilities"] = [];
  for (const rawCapability of rawCapabilities) {
    const parsed = parseCapabilityInvocationRequest(rawCapability);
    if (!parsed.ok) {
      return parsed;
    }

    capabilities.push({
      ...parsed.request,
      roleId:
        parsed.request.roleId ??
        readString(body.roleId) ??
        "role-runtime-executor",
      crewId: readString(rawCapability.crewId) ?? readString(body.crewId),
      routeId: parsed.request.routeId ?? readString(body.routeId),
      nodeId: parsed.request.nodeId ?? readString(body.nodeId),
    });
  }

  return {
    ok: true,
    request: {
      roleId: readString(body.roleId),
      crewId: readString(body.crewId),
      stage: stage as BlueprintGenerationStage | undefined,
      projectId: readString(body.projectId),
      routeId: readString(body.routeId),
      nodeId: readString(body.nodeId),
      executionMode: executionMode as
        | BlueprintSandboxDerivationExecutionMode
        | undefined,
      capabilities,
    },
  };
}

function parseCreateArtifactReplayRequest(
  body: unknown
): ParseCreateArtifactReplayRequestResult {
  if (body === undefined || body === null) {
    return { ok: true, request: {} };
  }

  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const title = readOptionalStringField(body, "title");
  if (!title.ok) return title;

  const summary = readOptionalStringField(body, "summary");
  if (!summary.ok) return summary;

  const tags = readOptionalStringListField(body, "tags");
  if (!tags.ok) return tags;

  return {
    ok: true,
    request: {
      title: title.value,
      summary: summary.value,
      tags: tags.values,
    },
  };
}

function parseArtifactDiffRequest(
  body: unknown
): ParseArtifactDiffRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const leftEntryId = readString(body.leftEntryId);
  const rightEntryId = readString(body.rightEntryId);
  if (!leftEntryId || !rightEntryId) {
    return {
      ok: false,
      message: "Provide leftEntryId and rightEntryId to compare ledger entries.",
    };
  }

  return {
    ok: true,
    request: {
      leftEntryId,
      rightEntryId,
    },
  };
}

function parseArtifactFeedbackRequest(
  body: unknown
): ParseArtifactFeedbackRequestResult {
  if (!isPlainRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
    };
  }

  const entryId = readString(body.entryId);
  const artifactId = readString(body.artifactId);
  if (!entryId && !artifactId) {
    return {
      ok: false,
      message: "Provide entryId or artifactId to record artifact feedback.",
    };
  }

  const rawKind =
    readString(body.kind ?? body.type) ??
    (body.backfill === true ? "backfill" : "feedback");
  if (!isArtifactFeedbackKind(rawKind)) {
    return {
      ok: false,
      message: "kind must be feedback or backfill when provided.",
    };
  }

  const message = readString(
    body.message ?? body.feedback ?? body.note ?? body.summary
  );
  if (!message) {
    return {
      ok: false,
      message: "Provide message, feedback, note, or summary text.",
    };
  }

  const summary = readOptionalStringField(body, "summary");
  if (!summary.ok) return summary;

  const createdBy = readOptionalStringField(body, "createdBy");
  if (!createdBy.ok) return createdBy;

  const tags = readOptionalStringListField(body, "tags");
  if (!tags.ok) return tags;

  const sourceIds = parsePartialArtifactSourceIds(body.sourceIds);
  if (!sourceIds.ok) return sourceIds;

  const payloadSummary = parseArtifactPayloadSummary(body.payloadSummary);
  if (!payloadSummary.ok) return payloadSummary;

  return {
    ok: true,
    request: {
      entryId,
      artifactId,
      kind: rawKind,
      message,
      summary: summary.value,
      createdBy: createdBy.value,
      tags: tags.values,
      sourceIds: sourceIds.sourceIds,
      payloadSummary: payloadSummary.payloadSummary,
    },
  };
}

function parsePartialArtifactSourceIds(
  value: unknown
):
  | { ok: true; sourceIds?: Partial<BlueprintArtifactSourceIds> }
  | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true };
  }

  if (!isPlainRecord(value)) {
    return {
      ok: false,
      message: "sourceIds must be a JSON object when provided.",
    };
  }

  const sourceIds: Partial<BlueprintArtifactSourceIds> = {};
  const routeSetId = readString(value.routeSetId);
  const specTreeId = readString(value.specTreeId);
  if (routeSetId) sourceIds.routeSetId = routeSetId;
  if (specTreeId) sourceIds.specTreeId = specTreeId;

  for (const key of [
    "nodeIds",
    "specDocumentIds",
    "effectPreviewIds",
    "promptPackageIds",
    "capabilityInvocationIds",
    "capabilityEvidenceIds",
    "landingPlanIds",
    "engineeringRunIds",
    "capabilityIds",
    "roleIds",
    "crewIds",
  ] as const) {
    if (!hasOwn(value, key)) continue;
    if (!Array.isArray(value[key])) {
      return {
        ok: false,
        message: `sourceIds.${key} must be an array of strings when provided.`,
      };
    }
    sourceIds[key] = normalizeStringList(value[key]);
  }

  return { ok: true, sourceIds };
}

function parseArtifactPayloadSummary(
  value: unknown
):
  | { ok: true; payloadSummary?: BlueprintArtifactPayloadSummary }
  | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true };
  }

  if (!isPlainRecord(value)) {
    return {
      ok: false,
      message: "payloadSummary must be a JSON object when provided.",
    };
  }

  const payloadSummary: BlueprintArtifactPayloadSummary = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isArtifactPayloadSummaryValue(item)) {
      return {
        ok: false,
        message:
          "payloadSummary values must be strings, numbers, booleans, string arrays, number arrays, or null.",
      };
    }
    payloadSummary[key] = item;
  }

  return { ok: true, payloadSummary };
}

function parseSpecDocumentFilters(
  query: Record<string, unknown>
): ParseSpecDocumentFiltersResult {
  const nodeId = readString(query.nodeId);
  const type = readString(query.type);
  const parsedType = type && isSpecDocumentType(type) ? type : undefined;

  if (type && !parsedType) {
    return {
      ok: false,
      message: "type must be one of requirements, design, or tasks.",
    };
  }

  return {
    ok: true,
    filters: {
      nodeId,
      type: parsedType,
    },
  };
}

function parseImplementationPromptPackageFilters(
  query: Record<string, unknown>
): ParseImplementationPromptPackageFiltersResult {
  const nodeId = readString(query.nodeId);
  const rawPlatforms = normalizeQueryStringList(
    query.targetPlatforms ??
      query.targetPlatform ??
      query.platforms ??
      query.platform
  );
  const platforms = rawPlatforms.length
    ? parsePromptTargetPlatforms(rawPlatforms)
    : { ok: true as const, platforms: undefined };

  if (!platforms.ok) {
    return platforms;
  }

  return {
    ok: true,
    filters: {
      nodeId,
      targetPlatforms: platforms.platforms,
    },
  };
}

function parsePromptTargetPlatforms(
  values: unknown[]
):
  | {
      ok: true;
      platforms: BlueprintImplementationPromptTargetPlatform[];
    }
  | { ok: false; message: string } {
  const platforms: BlueprintImplementationPromptTargetPlatform[] = [];

  for (const value of values) {
    const platform = readString(value);
    if (!isImplementationPromptTargetPlatform(platform)) {
      return {
        ok: false,
        message:
          "targetPlatforms must only contain cursor, kiro, trae, windsurf, codex, or claude.",
      };
    }
    if (!platforms.includes(platform)) {
      platforms.push(platform);
    }
  }

  if (platforms.length === 0) {
    return {
      ok: false,
      message: "targetPlatforms must include at least one platform.",
    };
  }

  return { ok: true, platforms };
}

function readOptionalStringField(
  record: Record<string, unknown>,
  key: string
): { ok: true; value?: string } | { ok: false; message: string } {
  if (!hasOwn(record, key)) {
    return { ok: true };
  }

  const value = readString(record[key]);
  if (!value) {
    return {
      ok: false,
      message: `${key} must be a non-empty string when provided.`,
    };
  }

  return { ok: true, value };
}

function readOptionalStringListField(
  record: Record<string, unknown>,
  key: string
): { ok: true; values?: string[] } | { ok: false; message: string } {
  if (!hasOwn(record, key)) {
    return { ok: true };
  }

  if (!Array.isArray(record[key])) {
    return {
      ok: false,
      message: `${key} must be an array of strings when provided.`,
    };
  }

  const values: string[] = [];
  for (const item of record[key]) {
    const value = readString(item);
    if (!value) {
      return {
        ok: false,
        message: `${key} must only contain non-empty strings.`,
      };
    }

    if (!values.includes(value)) {
      values.push(value);
    }
  }

  return { ok: true, values };
}

function parseEngineeringVerificationResults(
  value: unknown
):
  | { ok: true; results?: BlueprintEngineeringVerificationResult[] }
  | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true };
  }

  if (!Array.isArray(value)) {
    return {
      ok: false,
      message: "verificationResults must be an array when provided.",
    };
  }

  const results: BlueprintEngineeringVerificationResult[] = [];
  for (const item of value) {
    if (!isPlainRecord(item)) {
      return {
        ok: false,
        message: "verificationResults must contain JSON objects.",
      };
    }

    const command = readString(item.command);
    if (!command) {
      return {
        ok: false,
        message: "verificationResults items must include command.",
      };
    }

    const status = readString(item.status);
    if (!isEngineeringVerificationStatus(status)) {
      return {
        ok: false,
        message:
          "verificationResults status must be passed, failed, skipped, or blocked.",
      };
    }

    const durationMs =
      hasOwn(item, "durationMs") && typeof item.durationMs === "number"
        ? item.durationMs
        : undefined;

    if (
      hasOwn(item, "durationMs") &&
      (typeof item.durationMs !== "number" ||
        !Number.isFinite(item.durationMs) ||
        item.durationMs < 0)
    ) {
      return {
        ok: false,
        message: "verificationResults durationMs must be a non-negative number.",
      };
    }

    results.push({
      command,
      status,
      output: readString(item.output),
      durationMs,
    });
  }

  return { ok: true, results };
}

function filterSpecDocuments(
  documents: BlueprintSpecDocument[],
  filters: { nodeId?: string; type?: BlueprintSpecDocumentType }
): BlueprintSpecDocument[] {
  return documents.filter(document => {
    if (filters.nodeId && document.nodeId !== filters.nodeId) {
      return false;
    }

    if (filters.type && document.type !== filters.type) {
      return false;
    }

    return true;
  });
}

function filterEffectPreviews(
  effectPreviews: BlueprintEffectPreview[],
  filters: { nodeId?: string }
): BlueprintEffectPreview[] {
  return effectPreviews.filter(effectPreview => {
    if (filters.nodeId && effectPreview.nodeId !== filters.nodeId) {
      return false;
    }

    return true;
  });
}

function filterImplementationPromptPackages(
  promptPackages: BlueprintImplementationPromptPackage[],
  filters: {
    nodeId?: string;
    targetPlatforms?: BlueprintImplementationPromptTargetPlatform[];
  }
): BlueprintImplementationPromptPackage[] {
  return promptPackages.filter(promptPackage => {
    if (
      filters.nodeId &&
      !promptPackage.nodeIds.includes(filters.nodeId)
    ) {
      return false;
    }

    if (
      filters.targetPlatforms &&
      !filters.targetPlatforms.includes(promptPackage.targetPlatform)
    ) {
      return false;
    }

    return true;
  });
}

async function selectRouteForSpecTree(
  job: BlueprintGenerationJob,
  routeSet: BlueprintRouteSet,
  request: BlueprintRouteSelectionRequest,
  options: CreateGenerationJobHelperOptions & { ctx?: BlueprintServiceContext }
): Promise<BlueprintSelectRouteResponse> {
  const selectedAt = (options.now?.() ?? new Date()).toISOString();
  const selectedRoute = routeSet.routes.find(
    route => route.id === request.routeId
  );
  if (!selectedRoute) {
    throw new Error(`Route ${request.routeId} does not exist.`);
  }

  const validMergedAlternativeRouteIds = new Set(
    routeSet.routes
      .filter(route => route.kind === "alternative")
      .map(route => route.id)
  );
  const mergedAlternativeRouteIds = (
    request.mergedAlternativeRouteIds ?? []
  ).filter(routeId => validMergedAlternativeRouteIds.has(routeId));
  const selection: BlueprintRouteSelection = {
    id: createId("blueprint-route-selection"),
    routeSetId: routeSet.id,
    routeId: selectedRoute.id,
    selectedPathId: selectedRoute.id,
    routeTitle: selectedRoute.title,
    selectedAt,
    selectedBy: request.selectedBy,
    reason: request.reason,
    mergedAlternativeRouteIds,
    status: "selected",
    provenance: {
      jobId: job.id,
      projectId: job.projectId,
      sourceId: job.sourceId,
    },
  };
  const routeSelectionArtifactId = createId("blueprint-artifact");
  const specTreeArtifactId = createId("blueprint-artifact");
  const routeSelectionArtifact: BlueprintGenerationArtifact = {
    id: routeSelectionArtifactId,
    type: "route_selection",
    title: `Selected route: ${selectedRoute.title}`,
    summary:
      "User-selected autopilot route that acts as the source of SPEC tree derivation.",
    createdAt: selectedAt,
    payload: selection,
  };
  const artifactLinks = createSpecTreeArtifactLinks({
    routeSet,
    routeSetArtifact: job.artifacts.find(artifact => artifact.type === "route_set"),
    routeSelectionArtifact,
    specTreeArtifactId,
  });
  const previousRoleFindings = collectReusableRoleFindings(job, {
    stages: ["route_generation"],
    routeId: selectedRoute.id,
    limit: 6,
  });
  const resolvedCtx = options.ctx ?? await resolveDefaultBlueprintServiceContext({
    now: options.now,
    jobStore: options.store,
  });
  const specTree = await buildSpecTreeFromRouteSet(
    resolvedCtx,
    {
    job,
    routeSet,
    selection,
    selectedRoute,
    createdAt: selectedAt,
    artifactLinks,
    previousRoleFindings,
  });
  const specTreeArtifact: BlueprintGenerationArtifact = {
    id: specTreeArtifactId,
    type: "spec_tree",
    title: "Derived SPEC tree",
    summary:
      "Initial durable SPEC tree generated from the selected primary or alternative route.",
    createdAt: selectedAt,
    payload: specTree,
  };
  const capabilities = extractRuntimeCapabilities(job);
  const existingCrew = extractAgentCrew(job);
  const agentCrew = buildAgentCrew({
    jobId: job.id,
    stage: "spec_tree",
    createdAt: selectedAt,
    capabilities,
    artifactIds: [routeSelectionArtifact.id, specTreeArtifact.id],
  });
  const updatedAgentCrew: BlueprintAgentCrew = existingCrew
    ? {
        ...agentCrew,
        id: existingCrew.id,
        createdAt: existingCrew.createdAt,
        activationPolicies: existingCrew.activationPolicies,
      }
    : agentCrew;
  const agentCrewArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "agent_crew",
    title: "Agent Crew fabric",
    summary: `Agent Crew aligned to SPEC tree stage with ${updatedAgentCrew.presence.length} role presences.`,
    createdAt: selectedAt,
    payload: updatedAgentCrew,
  };
  const nextAction = createGenerationNextAction({
    type: "review_spec_tree",
    label: "Review the generated SPEC tree before document generation.",
    stage: "spec_tree",
    artifactId: specTreeArtifact.id,
    routeId: selectedRoute.id,
    selectionId: selection.id,
    specTreeId: specTree.id,
    nodeId: specTree.rootNodeId,
    required: true,
    actions: createSpecTreeReviewActionOptions({
      routeId: selectedRoute.id,
      selectionId: selection.id,
      selectedPathId: selection.selectedPathId ?? selectedRoute.id,
      specTreeId: specTree.id,
      artifactId: specTreeArtifact.id,
      nodeId: specTree.rootNodeId,
    }),
    handoff: createSpecTreeReviewHandoffState({
      job,
      routeSet,
      selection,
      routeId: selectedRoute.id,
      selectedPathId: selection.selectedPathId ?? selectedRoute.id,
      specTree,
      specTreeArtifact,
      artifactLinks,
    }),
  });
  const preservedArtifacts = job.artifacts.filter(
    artifact =>
      artifact.type !== "route_selection" &&
      artifact.type !== "spec_tree" &&
      artifact.type !== "agent_crew" &&
      artifact.type !== "role_timeline"
  );
  const rolePresenceEvents = createRolePresenceEvents({
    jobId: job.id,
    projectId: job.projectId,
    crewId: updatedAgentCrew.id,
    stage: "spec_tree",
    status: "reviewing",
    occurredAt: selectedAt,
    presence: updatedAgentCrew.presence,
    artifactId: specTreeArtifact.id,
    routeId: selectedRoute.id,
    selectionId: selection.id,
    specTreeId: specTree.id,
    nodeId: specTree.rootNodeId,
  });
  const roleTimelineCollection = buildRoleTimelineCollection(
    {
      ...job,
      events: job.events.concat(rolePresenceEvents),
      artifacts: job.artifacts.concat(agentCrewArtifact),
    },
    selectedAt,
    updatedAgentCrew
  );
  const roleTimelineArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "role_timeline",
    title: "Agent role timeline",
    summary: `Role timelines captured for ${roleTimelineCollection.timelines.length} crew roles.`,
    createdAt: selectedAt,
    payload: roleTimelineCollection,
  };
  // 2026-05-24 修复：spec_tree 派生过程中通过 stage-progress-emitter 发射的
  // role.agent.* 事件会被 BlueprintEventBus.persistToJobStore 写入到 jobStore，
  // 但本函数收到的 `job` 参数是 derive 开始前的 snapshot，直接 `job.events.concat`
  // 会把这些异步落盘的事件丢掉，导致刷新页面后 GET /jobs/:id/events 看不到推理流。
  // 此处从 jobStore 读取最新 events 作为基准，避免覆盖。
  const latestPersistedEvents =
    options.store.get(job.id)?.events ?? job.events;
  const events = latestPersistedEvents.concat([
    createGenerationEvent({
      jobId: job.id,
      stage: "spec_tree",
      status: "running",
      type: BlueprintEventName.JobStage,
      message: `Selected route ${selectedRoute.title} and started SPEC tree derivation.`,
      occurredAt: selectedAt,
      routeId: selectedRoute.id,
      selectionId: selection.id,
      payload: {
        routeSetId: routeSet.id,
        routeId: selectedRoute.id,
        selectionId: selection.id,
        selectedPathId: selection.selectedPathId ?? selectedRoute.id,
        handoffActionIds: nextAction.actions?.map(action => action.id) ?? [],
        reusedRoleFindingIds: collectRoleFindingIds(previousRoleFindings),
        reusedEvidenceIds: collectRoleFindingEvidenceIds(previousRoleFindings),
      },
    }),
    createGenerationEvent({
      jobId: job.id,
      stage: "spec_tree",
      status: "reviewing",
      type: BlueprintEventName.JobCompleted,
      message:
        "SPEC tree draft generated and ready for the Deduction workbench.",
      occurredAt: selectedAt,
      routeId: selectedRoute.id,
      selectionId: selection.id,
      specTreeId: specTree.id,
      nodeId: specTree.rootNodeId,
      artifactId: specTreeArtifact.id,
      payload: {
        specTreeId: specTree.id,
        rootNodeId: specTree.rootNodeId,
        nodeCount: specTree.nodes.length,
        routeSetId: routeSet.id,
        routeId: selectedRoute.id,
        selectionId: selection.id,
        selectedPathId: selection.selectedPathId ?? selectedRoute.id,
        handoffStateId: nextAction.handoff?.id,
        artifactLinks,
        reusedRoleFindingIds: collectRoleFindingIds(previousRoleFindings),
        reusedRoleIds: collectRoleFindingRoleIds(previousRoleFindings),
        reusedEvidenceIds: collectRoleFindingEvidenceIds(previousRoleFindings),
      },
    }),
    ...rolePresenceEvents,
  ]);
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "spec_tree",
    updatedAt: selectedAt,
    completedAt: selectedAt,
    artifacts: preservedArtifacts.concat(
      routeSelectionArtifact,
      specTreeArtifact,
      agentCrewArtifact,
      roleTimelineArtifact
    ),
    events,
    stageState: createGenerationStageState({
      stage: "spec_tree",
      status: "reviewing",
      payloadKind: "spec_tree",
      artifactIds: [
        routeSelectionArtifact.id,
        specTreeArtifact.id,
        agentCrewArtifact.id,
        roleTimelineArtifact.id,
      ],
      nextAction,
    }),
    nextAction,
  };

  options.store.save(updatedJob);

  return {
    job: updatedJob,
    routeSet,
    selection,
    specTree,
  };
}

function resetRouteSelection(
  job: BlueprintGenerationJob,
  routeSet: BlueprintRouteSet,
  options: CreateGenerationJobHelperOptions
): BlueprintResetRouteSelectionResponse {
  const updatedAt = (options.now?.() ?? new Date()).toISOString();
  const nextAction = createGenerationNextAction({
    type: "select_route",
    label: "Select a route for SPEC tree derivation.",
    stage: "route_generation",
    artifactId: routeSet.id,
    required: true,
  });
  const preservedArtifacts = job.artifacts.filter(artifact =>
    [
      "route_set",
      "intake",
      "github_source",
      "clarification_session",
      "project_context",
      "sandbox_derivation_job",
      "capability_invocation",
      "capability_evidence",
    ].includes(artifact.type)
  );
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "completed",
    stage: "route_generation",
    updatedAt,
    completedAt: updatedAt,
    artifacts: preservedArtifacts,
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "route_generation",
        status: "completed",
        type: BlueprintEventName.JobStage,
        message: "Route selection reset and RouteSet returned to draft.",
        occurredAt: updatedAt,
        payload: {
          routeSetId: routeSet.id,
        },
      })
    ),
    stageState: createGenerationStageState({
      stage: "route_generation",
      status: "completed",
      payloadKind: "route_set",
      artifactIds: preservedArtifacts.map(artifact => artifact.id),
      nextAction,
    }),
    nextAction,
  };

  options.store.save(updatedJob);

  return {
    job: updatedJob,
    routeSet,
  };
}

function createSpecTreeArtifactLinks(input: {
  routeSet: BlueprintRouteSet;
  routeSetArtifact?: BlueprintGenerationArtifact;
  routeSelectionArtifact: BlueprintGenerationArtifact;
  specTreeArtifactId: string;
}): BlueprintGenerationArtifactLink[] {
  return [
    {
      artifactId: input.routeSetArtifact?.id ?? input.routeSet.id,
      artifactType: "route_set",
      relation: "source",
      title: input.routeSetArtifact?.title ?? "RouteSet source",
    },
    {
      artifactId: input.routeSelectionArtifact.id,
      artifactType: "route_selection",
      relation: "selection",
      title: input.routeSelectionArtifact.title,
    },
    {
      artifactId: input.specTreeArtifactId,
      artifactType: "spec_tree",
      relation: "derived",
      title: "Derived SPEC tree",
    },
  ];
}

function createSpecTreeReviewActionOptions(input: {
  routeId: string;
  selectionId: string;
  selectedPathId: string;
  specTreeId: string;
  artifactId: string;
  nodeId: string;
}): BlueprintGenerationNextActionOption[] {
  const common = {
    routeId: input.routeId,
    selectionId: input.selectionId,
    selectedPathId: input.selectedPathId,
    specTreeId: input.specTreeId,
    artifactId: input.artifactId,
    nodeId: input.nodeId,
  };

  return [
    {
      id: "confirm_spec_tree",
      type: "review_spec_documents",
      label: "Confirm SPEC tree and generate SPEC documents.",
      stage: "spec_docs",
      required: true,
      ...common,
    },
    {
      id: "fine_tune_spec_tree",
      type: "review_spec_tree",
      label: "Fine-tune SPEC tree nodes before continuing.",
      stage: "spec_tree",
      required: false,
      ...common,
    },
    {
      id: "reselect_route",
      type: "select_route",
      label: "Reselect a different route and derive a new SPEC tree.",
      stage: "route_generation",
      required: false,
      ...common,
    },
    {
      id: "merge_route",
      type: "select_route",
      label: "Merge alternative routes into this SPEC tree source.",
      stage: "route_generation",
      required: false,
      ...common,
    },
    {
      id: "enter_downstream_menus",
      type: "review_prompt_package",
      label: "Enter downstream document, preview, prompt, and landing menus.",
      stage: "prompt_packaging",
      required: false,
      ...common,
    },
  ];
}

function createSpecTreeReviewHandoffState(input: {
  job: BlueprintGenerationJob;
  routeSet: BlueprintRouteSet;
  selection: BlueprintRouteSelection;
  routeId: string;
  selectedPathId: string;
  specTree: BlueprintSpecTree;
  specTreeArtifact: BlueprintGenerationArtifact;
  artifactLinks: BlueprintGenerationArtifactLink[];
}): BlueprintReviewHandoffState {
  return {
    id: stableId(
      "blueprint-review-handoff",
      `${input.job.id}:${input.selection.id}:${input.specTree.id}`
    ),
    stage: "spec_tree",
    status: "reviewing",
    confirmable: true,
    editable: true,
    resumable: true,
    routeId: input.routeId,
    selectionId: input.selection.id,
    selectedPathId: input.selectedPathId,
    specTreeId: input.specTree.id,
    nodeId: input.specTree.rootNodeId,
    artifactId: input.specTreeArtifact.id,
    artifactLinks: input.artifactLinks,
    downstreamMenus: [
      "spec_docs",
      "effect_preview",
      "prompt_packaging",
      "engineering_landing",
    ],
    provenance: {
      jobId: input.job.id,
      projectId: input.job.projectId,
      sourceId: input.job.sourceId,
      routeSetId: input.routeSet.id,
      routeId: input.routeId,
      selectionId: input.selection.id,
      selectedPathId: input.selectedPathId,
      specTreeId: input.specTree.id,
    },
  };
}

type UpdateSpecTreeNodeResult =
  | { ok: true; response: BlueprintUpdateSpecTreeNodeResponse }
  | { ok: false; status: number; error: string; message: string };

function updateSpecTreeNode(
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  nodeId: string,
  request: BlueprintUpdateSpecTreeNodeRequest,
  options: CreateGenerationJobHelperOptions
): UpdateSpecTreeNodeResult {
  const updatedAt = (options.now?.() ?? new Date()).toISOString();
  const nodeIndex = specTree.nodes.findIndex(node => node.id === nodeId);

  if (nodeIndex < 0) {
    return {
      ok: false,
      status: 404,
      error: "Blueprint SPEC tree node not found.",
      message: `No node ${nodeId} exists in SPEC tree ${specTree.id}.`,
    };
  }

  const updatedNode: BlueprintSpecTreeNode = {
    ...specTree.nodes[nodeIndex],
    title: request.title ?? specTree.nodes[nodeIndex].title,
    summary: request.summary ?? specTree.nodes[nodeIndex].summary,
    status: request.status ?? specTree.nodes[nodeIndex].status,
    priority: request.priority ?? specTree.nodes[nodeIndex].priority,
    outputs: request.outputs ?? specTree.nodes[nodeIndex].outputs,
  };
  const updatedSpecTree: BlueprintSpecTree = {
    ...specTree,
    version: specTree.version + 1,
    updatedAt,
    nodes: specTree.nodes.map((node, index) =>
      index === nodeIndex ? updatedNode : node
    ),
  };
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "spec_tree",
    updatedAt,
    completedAt: updatedAt,
    artifacts: replaceSpecTreeArtifact(job.artifacts, updatedSpecTree),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "spec_tree",
        status: "reviewing",
        type: BlueprintEventName.JobStage,
        message: `Updated SPEC tree node ${updatedNode.title}.`,
        occurredAt: updatedAt,
        payload: {
          specTreeId: updatedSpecTree.id,
          nodeId: updatedNode.id,
          version: updatedSpecTree.version,
        },
      })
    ),
  };

  options.store.save(updatedJob);

  return {
    ok: true,
    response: {
      job: updatedJob,
      specTree: updatedSpecTree,
      node: updatedNode,
    },
  };
}

type SpecTreeActionResult =
  | { ok: true; response: BlueprintSpecTreeActionResponse }
  | { ok: false; status: number; error: string; message: string };

function runSpecTreeAction(
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  request: BlueprintSpecTreeActionRequest,
  options: CreateGenerationJobHelperOptions
): SpecTreeActionResult {
  const updatedAt = (options.now?.() ?? new Date()).toISOString();
  const actionResult = applySpecTreeAction(job, specTree, request, updatedAt);

  if (!actionResult.ok) {
    return actionResult;
  }

  const updatedSpecTree: BlueprintSpecTree = {
    ...actionResult.specTree,
    version: specTree.version + 1,
    updatedAt,
  };
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "spec_tree",
    updatedAt,
    completedAt: updatedAt,
    artifacts: replaceSpecTreeArtifact(job.artifacts, updatedSpecTree),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "spec_tree",
        status: "reviewing",
        type: BlueprintEventName.JobStage,
        message: describeSpecTreeAction(request, actionResult.node),
        occurredAt: updatedAt,
        payload: {
          action: request.action,
          specTreeId: updatedSpecTree.id,
          nodeId: actionResult.node?.id,
          versionId: actionResult.version?.id,
          version: updatedSpecTree.version,
        },
      })
    ),
  };

  options.store.save(updatedJob);

  return {
    ok: true,
    response: {
      job: updatedJob,
      specTree: updatedSpecTree,
      node: actionResult.node,
      version: actionResult.version,
    },
  };
}

type ApplySpecTreeActionResult =
  | {
      ok: true;
      specTree: BlueprintSpecTree;
      node?: BlueprintSpecTreeNode;
      version?: BlueprintSpecTreeVersionSnapshot;
    }
  | { ok: false; status: number; error: string; message: string };

function applySpecTreeAction(
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  request: BlueprintSpecTreeActionRequest,
  updatedAt: string
): ApplySpecTreeActionResult {
  switch (request.action) {
    case "add_node":
      return addSpecTreeNode(specTree, request);
    case "delete_node":
      return deleteSpecTreeNode(specTree, request.nodeId);
    case "move_node":
      return moveSpecTreeNode(specTree, request);
    case "merge_nodes":
      return mergeSpecTreeNodes(specTree, request);
    case "split_node":
      return splitSpecTreeNode(specTree, request);
    case "set_current_version":
      return setCurrentSpecTreeVersion(job, specTree, request.versionId, updatedAt);
  }
}

function addSpecTreeNode(
  specTree: BlueprintSpecTree,
  request: Extract<BlueprintSpecTreeActionRequest, { action: "add_node" }>
): ApplySpecTreeActionResult {
  const parent = findSpecTreeNode(specTree, request.parentId);
  if (!parent) {
    return specTreeNodeNotFound(request.parentId, specTree.id);
  }

  const node = createSpecTreeNode({
    parentId: parent.id,
    title: request.title,
    summary: request.summary ?? "Draft SPEC tree node added from the workbench.",
    type: request.type ?? "route_step",
    status: request.status ?? "draft",
    priority: request.priority ?? parent.children.length + 1,
    routeId: parent.routeId ?? specTree.selectedRouteId,
    outputs: request.outputs ?? [],
    metadata: {
      createdByAction: "add_node",
    },
  });
  const nodes = specTree.nodes
    .map(item =>
      item.id === parent.id
        ? { ...item, children: uniqueStrings(item.children.concat(node.id)) }
        : item
    )
    .concat(node);

  return {
    ok: true,
    specTree: { ...specTree, nodes },
    node,
  };
}

function deleteSpecTreeNode(
  specTree: BlueprintSpecTree,
  nodeId: string
): ApplySpecTreeActionResult {
  const node = findSpecTreeNode(specTree, nodeId);
  if (!node) {
    return specTreeNodeNotFound(nodeId, specTree.id);
  }
  if (node.id === specTree.rootNodeId) {
    return {
      ok: false,
      status: 409,
      error: "Blueprint SPEC tree root cannot be deleted.",
      message: "delete_node cannot delete the SPEC tree root node.",
    };
  }

  const deletedIds = collectSpecTreeSubtreeIds(specTree, node.id);
  const nodes = specTree.nodes
    .filter(item => !deletedIds.has(item.id))
    .map(item => ({
      ...item,
      children: item.children.filter(childId => !deletedIds.has(childId)),
    }));

  return {
    ok: true,
    specTree: { ...specTree, nodes },
    node,
  };
}

function moveSpecTreeNode(
  specTree: BlueprintSpecTree,
  request: Extract<BlueprintSpecTreeActionRequest, { action: "move_node" }>
): ApplySpecTreeActionResult {
  const node = findSpecTreeNode(specTree, request.nodeId);
  const parent = findSpecTreeNode(specTree, request.parentId);
  if (!node) {
    return specTreeNodeNotFound(request.nodeId, specTree.id);
  }
  if (!parent) {
    return specTreeNodeNotFound(request.parentId, specTree.id);
  }
  if (node.id === parent.id) {
    return {
      ok: false,
      status: 409,
      error: "Invalid SPEC tree move.",
      message: "move_node cannot move a node under itself.",
    };
  }
  if (collectSpecTreeSubtreeIds(specTree, node.id).has(parent.id)) {
    return {
      ok: false,
      status: 409,
      error: "Invalid SPEC tree move.",
      message: "move_node cannot move a node under one of its descendants.",
    };
  }

  const priority = request.priority ?? parent.children.length + 1;
  const movedNode: BlueprintSpecTreeNode = {
    ...node,
    parentId: parent.id,
    priority,
  };
  const nodes = specTree.nodes.map(item => {
    if (item.id === node.id) return movedNode;
    if (item.id === node.parentId) {
      return {
        ...item,
        children: item.children.filter(childId => childId !== node.id),
      };
    }
    if (item.id === parent.id) {
      return {
        ...item,
        children: uniqueStrings(item.children.concat(node.id)),
      };
    }
    return item;
  });

  return {
    ok: true,
    specTree: { ...specTree, nodes },
    node: movedNode,
  };
}

function mergeSpecTreeNodes(
  specTree: BlueprintSpecTree,
  request: Extract<BlueprintSpecTreeActionRequest, { action: "merge_nodes" }>
): ApplySpecTreeActionResult {
  const source = findSpecTreeNode(specTree, request.sourceNodeId);
  const target = findSpecTreeNode(specTree, request.targetNodeId);
  if (!source) {
    return specTreeNodeNotFound(request.sourceNodeId, specTree.id);
  }
  if (!target) {
    return specTreeNodeNotFound(request.targetNodeId, specTree.id);
  }
  if (source.id === target.id) {
    return {
      ok: false,
      status: 409,
      error: "Invalid SPEC tree merge.",
      message: "merge_nodes requires different source and target nodes.",
    };
  }
  if (source.id === specTree.rootNodeId) {
    return {
      ok: false,
      status: 409,
      error: "Blueprint SPEC tree root cannot be merged away.",
      message: "merge_nodes cannot delete the SPEC tree root node.",
    };
  }
  if (collectSpecTreeSubtreeIds(specTree, source.id).has(target.id)) {
    return {
      ok: false,
      status: 409,
      error: "Invalid SPEC tree merge.",
      message: "merge_nodes cannot merge a node into its descendant.",
    };
  }

  const mergedTarget: BlueprintSpecTreeNode = {
    ...target,
    summary: [target.summary, `Merged from ${source.title}: ${source.summary}`]
      .filter(Boolean)
      .join("\n\n"),
    outputs: uniqueStrings(target.outputs.concat(source.outputs)),
    children: uniqueStrings(
      target.children
        .filter(childId => childId !== source.id)
        .concat(source.children.filter(childId => childId !== target.id))
    ),
  };
  const nodes = specTree.nodes
    .filter(item => item.id !== source.id)
    .map(item => {
      if (item.id === target.id) return mergedTarget;
      if (source.children.includes(item.id)) {
        return { ...item, parentId: target.id };
      }
      return {
        ...item,
        children: item.children.filter(childId => childId !== source.id),
      };
    });

  return {
    ok: true,
    specTree: { ...specTree, nodes },
    node: mergedTarget,
  };
}

function splitSpecTreeNode(
  specTree: BlueprintSpecTree,
  request: Extract<BlueprintSpecTreeActionRequest, { action: "split_node" }>
): ApplySpecTreeActionResult {
  const source = findSpecTreeNode(specTree, request.sourceNodeId);
  if (!source) {
    return specTreeNodeNotFound(request.sourceNodeId, specTree.id);
  }

  const placement = request.placement ?? (source.parentId ? "sibling" : "child");
  const parentId = placement === "sibling" && source.parentId
    ? source.parentId
    : source.id;
  const parent = findSpecTreeNode(specTree, parentId);
  if (!parent) {
    return specTreeNodeNotFound(parentId, specTree.id);
  }

  const node = createSpecTreeNode({
    parentId: parent.id,
    title: request.title,
    summary: request.summary ?? `Split from ${source.title}.`,
    type: source.type === "root" ? "route_step" : source.type,
    status: "draft",
    priority:
      placement === "sibling" ? source.priority + 1 : parent.children.length + 1,
    routeId: source.routeId ?? parent.routeId ?? specTree.selectedRouteId,
    routeStepId: source.routeStepId,
    outputs: request.outputs?.length ? request.outputs : source.outputs,
    metadata: {
      createdByAction: "split_node",
      splitFromNodeId: source.id,
    },
  });
  const nodes = specTree.nodes
    .map(item =>
      item.id === parent.id
        ? { ...item, children: uniqueStrings(item.children.concat(node.id)) }
        : item
    )
    .concat(node);

  return {
    ok: true,
    specTree: { ...specTree, nodes },
    node,
  };
}

function setCurrentSpecTreeVersion(
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  versionId: string,
  updatedAt: string
): ApplySpecTreeActionResult {
  const version = findSpecTreeVersion(job, versionId);
  if (!version) {
    return {
      ok: false,
      status: 404,
      error: "Blueprint SPEC tree version not found.",
      message: `No SPEC tree version ${versionId} exists in job ${job.id}.`,
    };
  }
  if (version.treeId !== specTree.id) {
    return {
      ok: false,
      status: 409,
      error: "Blueprint SPEC tree version mismatch.",
      message: `SPEC tree version ${versionId} does not belong to tree ${specTree.id}.`,
    };
  }

  return {
    ok: true,
    specTree: {
      ...cloneSpecTree(version.snapshot),
      updatedAt,
    },
    version,
  };
}

function findSpecTreeNode(
  specTree: BlueprintSpecTree,
  nodeId: string
): BlueprintSpecTreeNode | undefined {
  return specTree.nodes.find(node => node.id === nodeId);
}

function findSpecTreeVersion(
  job: BlueprintGenerationJob,
  versionId: string
): BlueprintSpecTreeVersionSnapshot | undefined {
  const artifact = job.artifacts.find(
    item =>
      item.type === "spec_tree_version" &&
      (item.id === versionId ||
        (isPlainRecord(item.payload) && item.payload.id === versionId))
  );

  return artifact?.payload as BlueprintSpecTreeVersionSnapshot | undefined;
}

function collectSpecTreeSubtreeIds(
  specTree: BlueprintSpecTree,
  nodeId: string
): Set<string> {
  const byId = new Map(specTree.nodes.map(node => [node.id, node]));
  const ids = new Set<string>();
  const visit = (id: string): void => {
    if (ids.has(id)) return;
    ids.add(id);
    for (const childId of byId.get(id)?.children ?? []) {
      visit(childId);
    }
  };
  visit(nodeId);
  return ids;
}

function specTreeNodeNotFound(
  nodeId: string,
  treeId: string
): { ok: false; status: 404; error: string; message: string } {
  return {
    ok: false,
    status: 404,
    error: "Blueprint SPEC tree node not found.",
    message: `No node ${nodeId} exists in SPEC tree ${treeId}.`,
  };
}

function describeSpecTreeAction(
  request: BlueprintSpecTreeActionRequest,
  node?: BlueprintSpecTreeNode
): string {
  switch (request.action) {
    case "add_node":
      return `Added SPEC tree node ${node?.title ?? request.title}.`;
    case "delete_node":
      return `Deleted SPEC tree node ${node?.title ?? request.nodeId}.`;
    case "move_node":
      return `Moved SPEC tree node ${node?.title ?? request.nodeId}.`;
    case "merge_nodes":
      return `Merged SPEC tree node ${request.sourceNodeId} into ${node?.title ?? request.targetNodeId}.`;
    case "split_node":
      return `Split SPEC tree node ${request.sourceNodeId} into ${node?.title ?? request.title}.`;
    case "set_current_version":
      return `Restored SPEC tree version ${request.versionId}.`;
  }
}

function saveSpecTreeVersion(
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  request: { title?: string; summary?: string; savedBy?: string },
  options: CreateGenerationJobHelperOptions
): BlueprintSaveSpecTreeVersionResponse {
  const savedAt = (options.now?.() ?? new Date()).toISOString();
  const snapshot: BlueprintSpecTreeVersionSnapshot = {
    id: createId("blueprint-spec-tree-version"),
    treeId: specTree.id,
    version: specTree.version,
    title: request.title,
    summary: request.summary,
    savedAt,
    savedBy: request.savedBy,
    snapshot: cloneSpecTree(specTree),
    provenance: {
      jobId: job.id,
      projectId: job.projectId,
      sourceId: job.sourceId,
    },
  };
  const versionArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "spec_tree_version",
    title: request.title ?? `SPEC tree v${specTree.version}`,
    summary: request.summary ?? "Saved SPEC tree version snapshot for replay.",
    createdAt: savedAt,
    payload: snapshot,
  };
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    updatedAt: savedAt,
    artifacts: job.artifacts.concat(versionArtifact),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "spec_tree",
        status: "reviewing",
        type: BlueprintEventName.JobCompleted,
        message: `Saved SPEC tree version ${specTree.version}.`,
        occurredAt: savedAt,
        payload: {
          specTreeId: specTree.id,
          versionId: snapshot.id,
          version: snapshot.version,
        },
      })
    ),
  };

  options.store.save(updatedJob);

  return {
    job: updatedJob,
    specTree,
    version: snapshot,
  };
}

function parseEffectPreviewFilters(
  query: Record<string, unknown>
): ParseEffectPreviewFiltersResult {
  return {
    ok: true,
    filters: {
      nodeId: readString(query.nodeId),
    },
  };
}

type SaveSpecDocumentVersionResult =
  | {
      ok: true;
      response: BlueprintSaveSpecDocumentVersionResponse;
    }
  | { ok: false; status: number; error: string; message: string };

function saveSpecDocumentVersion(
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  documentId: string,
  request: { savedBy?: string; reviewNote?: string },
  options: CreateGenerationJobHelperOptions
): SaveSpecDocumentVersionResult {
  const savedAt = (options.now?.() ?? new Date()).toISOString();
  const document = findSpecDocument(job, documentId);

  if (!document) {
    return specDocumentNotFound(documentId, job.id);
  }

  const sourceDocumentId = document.sourceDocumentId ?? document.id;
  const versionNumber = (document.version ?? 1) + 1;
  const status = document.status ?? "draft";
  const snapshot: BlueprintSpecDocumentVersionSnapshot = {
    id: createId("blueprint-spec-document-version"),
    documentId: document.id,
    sourceDocumentId,
    jobId: document.jobId,
    treeId: document.treeId,
    nodeId: document.nodeId,
    type: document.type,
    version: versionNumber,
    status,
    title: document.title,
    summary: document.summary,
    content: document.content,
    format: document.format,
    savedAt,
    savedBy: request.savedBy,
    acceptedAt: document.acceptedAt,
    reviewedAt: document.reviewedAt,
    rejectedAt: document.rejectedAt,
    reviewedBy: document.reviewedBy,
    reviewNote: request.reviewNote ?? document.reviewNote,
    provenance: { ...document.provenance },
  };
  const updatedDocument: BlueprintSpecDocument = {
    ...document,
    version: versionNumber,
    sourceDocumentId,
    status: "draft",
    updatedAt: savedAt,
    reviewedAt: undefined,
    acceptedAt: undefined,
    rejectedAt: undefined,
    reviewedBy: undefined,
    reviewNote: request.reviewNote ?? document.reviewNote,
  };
  const versionArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "spec_document_version",
    title: `${document.title} v${versionNumber}`,
    summary: "Saved SPEC document version snapshot for review traceability.",
    createdAt: savedAt,
    payload: snapshot,
  };
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "spec_docs",
    updatedAt: savedAt,
    artifacts: replaceSpecDocumentArtifact(
      job.artifacts,
      updatedDocument
    ).concat(versionArtifact),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "spec_docs",
        status: "reviewing",
        type: BlueprintEventName.JobStage,
        message: `Saved SPEC document ${document.title} version ${versionNumber}.`,
        occurredAt: savedAt,
        payload: {
          documentId: document.id,
          sourceDocumentId,
          versionId: snapshot.id,
          version: snapshot.version,
        },
      })
    ),
  };

  options.store.save(updatedJob);

  return {
    ok: true,
    response: {
      job: updatedJob,
      specTree,
      document: updatedDocument,
      version: snapshot,
    },
  };
}

type ReviewSpecDocumentResult =
  | { ok: true; response: BlueprintReviewSpecDocumentResponse }
  | { ok: false; status: number; error: string; message: string };

function reviewSpecDocument(
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  documentId: string,
  request: BlueprintReviewSpecDocumentRequest,
  options: CreateGenerationJobHelperOptions
): ReviewSpecDocumentResult {
  const reviewedAt = (options.now?.() ?? new Date()).toISOString();
  const document = findSpecDocument(job, documentId);

  if (!document) {
    return specDocumentNotFound(documentId, job.id);
  }

  const sourceDocumentId = document.sourceDocumentId ?? document.id;
  const updatedDocument: BlueprintSpecDocument = {
    ...document,
    sourceDocumentId,
    status: request.status,
    updatedAt: reviewedAt,
    reviewedAt,
    acceptedAt: request.status === "accepted" ? reviewedAt : undefined,
    rejectedAt: request.status === "rejected" ? reviewedAt : undefined,
    reviewedBy: request.reviewedBy,
    reviewNote: request.reviewNote,
  };
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "spec_docs",
    updatedAt: reviewedAt,
    artifacts: replaceSpecDocumentArtifact(job.artifacts, updatedDocument),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "spec_docs",
        status: "reviewing",
        type: BlueprintEventName.JobStage,
        message: `Marked SPEC document ${document.title} as ${request.status}.`,
        occurredAt: reviewedAt,
        payload: {
          documentId: document.id,
          sourceDocumentId,
          version: document.version ?? 1,
          status: request.status,
        },
      })
    ),
  };

  options.store.save(updatedJob);

  return {
    ok: true,
    response: {
      job: updatedJob,
      specTree,
      document: updatedDocument,
    },
  };
}

async function generateSpecDocuments(
  ctx: BlueprintServiceContext | undefined,
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  request: BlueprintGenerateSpecDocumentsRequest,
  options: CreateGenerationJobHelperOptions
): Promise<BlueprintSpecDocumentsResponse> {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const targetNodeIds = request.nodeId
    ? new Set([request.nodeId])
    : new Set(specTree.nodes.map(node => node.id));
  const targetTypes =
    request.types && request.types.length > 0
      ? request.types
      : SPEC_DOCUMENT_TYPES;

  // Build routeById lookup for primaryRoute enrichment.
  const routeSet = extractRouteSet(job);
  const routeById = new Map<string, BlueprintRouteCandidate>(
    (routeSet?.routes ?? []).map(route => [route.id, route])
  );
  // Read optional context from job (undefined when not present — do not throw).
  const clarificationSession =
    (job as unknown as { clarificationSession?: BlueprintClarificationSession })
      .clarificationSession;
  const domainContext =
    (job as unknown as { projectContext?: BlueprintProjectDomainContext })
      .projectContext;

  // ─────────────────────────────────────────────────────────────────────
  // `autopilot-llm-spec-generation` Task 6.2：spec_docs handler 注入
  // env-gated LLM 批量生成分支。当 `BLUEPRINT_SPEC_DOCS_LLM_ENABLED ===
  // "true"`、非 `BUILD_TARGET=test` 且 `ctx.specDocsLlmGeneration` 已装配
  // 时，按 root-first DFS 顺序传入待生成节点，预先调用工厂的
  // `generate(...)` 拿到每节点的 `requirements / design / tasks` markdown
  // 与 provenance；后续 `buildSpecDocument` 按 `perNode[i].generationSource`
  // 决定使用 LLM 输出还是回落到既有 `specDocumentsLlmService` + 模板路径。
  // 多节点混合时各自独立 artifact 写入；`overallSource` 反映批次整体来源。
  //
  // 关键约束：
  // - `generate()` 永不抛错；任何节点级失败已在工厂内部转 fallback；
  // - 测试态 `BUILD_TARGET=test` 默认视旗标为 `false`；
  // - 未启用 / 失败时不构建 batch result，等价于既有路径不变。
  //
  // _Implements Req 2.1 / 2.2 / 2.5 / 2.6 / 4.2 / 4.4_
  // ─────────────────────────────────────────────────────────────────────
  const specDocsLlmEnabled =
    process.env.BLUEPRINT_SPEC_DOCS_LLM_ENABLED === "true";
  const isTestBuildTargetSpecDocs = process.env.BUILD_TARGET === "test";
  const specDocsLlmGeneration = ctx?.specDocsLlmGeneration;
  const targetNodes = specTree.nodes.filter(node => targetNodeIds.has(node.id));

  // ─── Spec Docs Progress Feedback ────────────────────────────────────
  // Determine if this is a batch request (全部生成) vs single-node request.
  // Only batch requests emit progress events; single-node requests preserve
  // existing behavior with no progress overhead (Req 5.1).
  const isBatchRequest = request.nodeId == null;
  const progressEmitter = isBatchRequest && ctx?.eventBus
    ? createSpecDocsProgressEmitter(ctx.eventBus, job.id)
    : undefined;

  // Zero-node early exit (Req 1.6): emit batch_finished with zeros and return empty.
  if (isBatchRequest && targetNodes.length === 0) {
    progressEmitter?.emitBatchFinished(0, 0, 0);
    const latestJobForEvents = options.store.get(job.id) ?? job;
    const updatedJob: BlueprintGenerationJob = {
      ...job,
      status: "reviewing",
      stage: "spec_docs",
      updatedAt: createdAt,
      artifacts: job.artifacts,
      events: latestJobForEvents.events.concat(
        createGenerationEvent({
          jobId: job.id,
          stage: "spec_docs",
          status: "completed",
          type: BlueprintEventName.JobCompleted,
          message: "SPEC documents generated from the selected SPEC tree.",
          occurredAt: createdAt,
          payload: {
            specTreeId: specTree.id,
            nodeCount: 0,
            documentCount: 0,
          },
        })
      ),
    };
    options.store.save(updatedJob);
    return {
      job: updatedJob,
      specTree,
      documents: extractSpecDocuments(updatedJob),
    };
  }

  // ─── Emit batch_init BEFORE any generation (including LLM factory) ──
  // This ensures the frontend sees "batch started" immediately when the user
  // clicks "全部生成", not after the LLM pre-generation completes.
  // The batchStartTime also covers the LLM factory duration in elapsedMs.
  if (progressEmitter) {
    progressEmitter.emitBatchInit(targetNodes.length, targetNodes.map(n => n.id));
  }
  const batchStartTime = progressEmitter ? Date.now() : 0;

  let llmNodeOutputById: Map<string, SpecDocsLlmNodeOutput> | undefined;
  if (
    specDocsLlmEnabled &&
    !isTestBuildTargetSpecDocs &&
    specDocsLlmGeneration !== undefined &&
    targetNodes.length > 0
  ) {
    // 选择主路线：优先用 specTree.selectedRouteId，缺失时回退到 routeSet
    // 的 primaryRouteId 或第一个候选 route。无 routeSet 则跳过 LLM 路径。
    const primaryRouteForBatch =
      (specTree.selectedRouteId
        ? routeById.get(specTree.selectedRouteId)
        : undefined) ??
      (routeSet?.primaryRouteId
        ? routeById.get(routeSet.primaryRouteId)
        : undefined) ??
      routeSet?.routes[0];
    if (primaryRouteForBatch !== undefined) {
      // 关键：把进度发射器作为回调传入 LLM 模块。LLM 模块在每个节点的
      // 真实 LLM 调用前后触发 started / completed / failed，让前端进度面板
      // 反映**真实**的 per-node 执行时序（LLM 数秒级），而不是事后拼装时间。
      const llmProgressBridge = progressEmitter
        ? {
            started: (nodeId: string, title: string, position: number) =>
              progressEmitter.emitNodeStarted(nodeId, title, position),
            completed: (nodeId: string, completedCount: number) =>
              progressEmitter.emitNodeCompleted(nodeId, completedCount),
            failed: (nodeId: string, errorSummary: string, processedCount: number) =>
              progressEmitter.emitNodeFailed(nodeId, errorSummary, processedCount),
          }
        : undefined;
      const batchResult = await specDocsLlmGeneration.generate({
        jobId: job.id,
        nodes: targetNodes,
        primaryRoute: primaryRouteForBatch,
        onNodeProgress: llmProgressBridge,
      });
      llmNodeOutputById = new Map<string, SpecDocsLlmNodeOutput>();
      for (const perNode of batchResult.perNode) {
        llmNodeOutputById.set(perNode.nodeId, perNode);
      }
      ctx?.logger?.debug(
        "[blueprint.spec_docs] LLM batch generation completed",
        {
          jobId: job.id,
          nodeCount: targetNodes.length,
          overallSource: batchResult.overallSource,
        },
      );
    } else {
      ctx?.logger?.debug(
        "[blueprint.spec_docs] LLM batch generation skipped: no primary route available",
        { jobId: job.id },
      );
    }
  }

  // ─── Cancellable timeout helper for per-node 120s timeout (Req 6.5) ──
  // Returns a promise + cancel function. The timer is cleaned up on success
  // to avoid leaving dangling timers in the event loop.
  const TIMEOUT_SENTINEL: unique symbol = Symbol("timeout") as any;
  function createCancellableTimeout(ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<typeof TIMEOUT_SENTINEL>(resolve => {
      timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), ms);
    });
    const cancel = () => { if (timer !== undefined) clearTimeout(timer); };
    return { promise, cancel };
  }

  // ─── Batch path vs single-node path ─────────────────────────────────
  // When progressEmitter is defined (batch request with eventBus), use
  // sequential per-node loop with progress events and 120s timeout.
  // Otherwise, preserve existing Promise.all behavior (Req 5.1, 5.3).
  const documents: BlueprintSpecDocument[] = [];

  if (progressEmitter) {
    let completedCount = 0;
    let failedCount = 0;
    // Phase 2 assembly counter — distinct from Phase 1's completedCount.
    // A node increments assembledCount when it successfully produces documents
    // (including template-fallback nodes that produce template docs).
    let assembledCount = 0;

    // `batchCoveredNodes`: this node appeared in the Phase 1 batch result (including
    // template-fallback nodes). It does NOT imply LLM markdown generation succeeded.
    // The fast-path predicate `isFastPath` is the correct signal for "LLM cache hit".
    const batchCoveredNodes = new Set<string>(
      llmNodeOutputById ? Array.from(llmNodeOutputById.keys()) : [],
    );

    for (let i = 0; i < targetNodes.length; i++) {
      const node = targetNodes[i];
      // `batchCovered`: this node appeared in the Phase 1 batch result (including
      // template-fallback nodes). It does NOT imply LLM markdown generation succeeded.
      // The fast-path predicate `isFastPath` is the correct signal for "LLM cache hit".
      const batchCovered = batchCoveredNodes.has(node.id);
      // 仅对 LLM 模块未触达的节点补发 started——这里耗时是真实的模板组装时间，
      // 但因为 LLM 已经把大部分节点处理完毕、batchStartTime 起算点更靠前，
      // 用户感知到的进度节奏由 LLM 调用的真实秒级耗时驱动。
      if (!batchCovered) {
        progressEmitter.emitNodeStarted(node.id, node.title ?? node.id, i + 1);
      }

      const previousRoleFindings = collectReusableRoleFindings(job, {
        stages: ["route_generation", "spec_tree", "runtime_capability"],
        routeId: node.routeId ?? specTree.selectedRouteId,
        nodeId: node.id,
        limit: 8,
      });
      const primaryRoute = node.routeId
        ? routeById.get(node.routeId)
        : specTree.selectedRouteId
          ? routeById.get(specTree.selectedRouteId)
          : undefined;
      const llmNodeOutput = llmNodeOutputById?.get(node.id);

      // ── Fast path classification (Decision 2) ──
      // A node qualifies for the fast path when its batch result has
      // generationSource === "llm" AND all target doc types have non-empty markdown.
      const isFastPath =
        llmNodeOutput?.generationSource === "llm" &&
        targetTypes.every(type => {
          const md = pickSpecDocsLlmMarkdownForType(llmNodeOutput, type);
          return typeof md === "string" && md.length > 0;
        });

      try {
        let nodeDocs: BlueprintSpecDocument[];

        if (isFastPath) {
          // FAST PATH: synchronous assembly from LLM cache — no Promise.race overhead
          nodeDocs = assembleSpecDocumentsFromLlmCache({
            job,
            specTree,
            node,
            llmOutput: llmNodeOutput!,
            primaryRoute,
            createdAt,
            previousRoleFindings,
            clarificationSession,
            domainContext,
            targetTypes,
          });
        } else {
          // SLOW PATH: retain existing Promise.race + 120s timeout
          const timeout = createCancellableTimeout(120_000);
          try {
            const nodeDocsResult = await Promise.race([
              Promise.all(
                targetTypes.map(type =>
                  buildSpecDocument(ctx, {
                    job,
                    specTree,
                    node,
                    type,
                    createdAt,
                    previousRoleFindings,
                    clarificationSession,
                    domainContext,
                    primaryRoute,
                    llmNodeOutput,
                  })
                )
              ),
              timeout.promise,
            ]);

            if (nodeDocsResult === TIMEOUT_SENTINEL) {
              throw new Error("节点生成超时 (120s)");
            }

            nodeDocs = nodeDocsResult as BlueprintSpecDocument[];
          } finally {
            timeout.cancel();
          }
        }

        documents.push(...nodeDocs);
        completedCount++;
        assembledCount++;

        // Phase 1 progress guard (preserved from original) — only emit for
        // nodes NOT already covered by the LLM batch module's own events.
        if (!batchCovered) {
          progressEmitter.emitNodeCompleted(node.id, completedCount);
        }

        // Phase 2 assembly event — ALWAYS emit (no batchCovered guard).
        // This is the commit-stage signal the frontend reducer needs to
        // transition from "assembling" to "assembled" per node.
        progressEmitter.emitNodeAssembled({
          nodeId: node.id,
          position: i + 1,
          assembledCount,
          totalCount: targetNodes.length,
          documentIds: nodeDocs.map(d => d.id),
        });
      } catch (err) {
        failedCount++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        // Phase 2 failure: emit unconditionally. Unlike Phase 1 events (node_started/
        // node_completed) which use the batchCovered guard to avoid double-counting,
        // Phase 2 node_failed is a DIFFERENT event boundary — it signals assembly
        // failure, not LLM generation failure. Every node MUST get either
        // node_assembled or node_failed to satisfy the invariant.
        progressEmitter.emitNodeFailed(node.id, errorMsg, assembledCount + failedCount);
        // DO NOT emit node_assembled for failed nodes

        // Generate fallback error documents for the failed node to maintain
        // the result matrix (Req 8.1: documents array preserves node × type
        // cartesian product). Without this, the HTTP response would silently
        // omit failed nodes, breaking the expected result shape.
        for (const type of targetTypes) {
          documents.push({
            id: createId("blueprint-spec-document"),
            jobId: job.id,
            treeId: specTree.id,
            nodeId: node.id,
            type,
            title: `${type} (generation failed)`,
            summary: `Generation failed: ${errorMsg.slice(0, 200)}`,
            content: `<!-- Generation failed: ${errorMsg.slice(0, 400)} -->\n\n_This document could not be generated. Error: ${errorMsg.slice(0, 200)}_`,
            createdAt,
          } as BlueprintSpecDocument);
        }
        // Continue to next node (Req 6.1)
      }
    }

    // Invariant: every node must have emitted either node_assembled or node_failed
    if (assembledCount + failedCount !== targetNodes.length) {
      throw new Error(
        `[spec_docs] Phase 2 invariant violation: assembledCount(${assembledCount}) + failedCount(${failedCount}) !== totalCount(${targetNodes.length}). ` +
        `Missing nodes: ${targetNodes.filter((_, idx) => idx >= assembledCount + failedCount).map(n => n.id).join(", ")}`
      );
    }

    // Emit batch_finished (Req 1.5) — elapsedMs covers LLM factory + per-node assembly
    const elapsedMs = Date.now() - batchStartTime;
    progressEmitter.emitBatchFinished(assembledCount, failedCount, elapsedMs);
  } else {
    // Single-node path OR no eventBus: existing Promise.all behavior unchanged (Req 5.1)
    const allDocs = await Promise.all(
      targetNodes.flatMap(node => {
        const previousRoleFindings = collectReusableRoleFindings(job, {
          stages: ["route_generation", "spec_tree", "runtime_capability"],
          routeId: node.routeId ?? specTree.selectedRouteId,
          nodeId: node.id,
          limit: 8,
        });
        const primaryRoute = node.routeId
          ? routeById.get(node.routeId)
          : specTree.selectedRouteId
            ? routeById.get(specTree.selectedRouteId)
            : undefined;
        const llmNodeOutput = llmNodeOutputById?.get(node.id);
        return targetTypes.map(type =>
          buildSpecDocument(ctx, {
            job,
            specTree,
            node,
            type,
            createdAt,
            previousRoleFindings,
            clarificationSession,
            domainContext,
            primaryRoute,
            llmNodeOutput,
          })
        );
      })
    );
    documents.push(...allDocs);
  }
  const generatedDocumentKeys = new Set(
    documents.map(document => `${document.nodeId}:${document.type}`)
  );
  const documentArtifacts = documents.map(document => ({
    id: createId("blueprint-artifact"),
    type: document.type,
    title: document.title,
    summary: document.summary,
    createdAt,
    payload: document,
  })) satisfies BlueprintGenerationArtifact[];
  const preservedArtifacts = job.artifacts.filter(
    artifact => {
      if (
        artifact.type !== "requirements" &&
        artifact.type !== "design" &&
        artifact.type !== "tasks"
      ) {
        return true;
      }

      const payload = isPlainRecord(artifact.payload) ? artifact.payload : null;
      const documentNodeId = readString(payload?.nodeId);
      const documentType = isSpecDocumentType(readString(payload?.type))
        ? (readString(payload?.type) as BlueprintSpecDocumentType)
        : (artifact.type as BlueprintSpecDocumentType);

      if (!documentNodeId) {
        return false;
      }

      return !generatedDocumentKeys.has(`${documentNodeId}:${documentType}`);
    }
  );
  const latestJobForEvents = options.store.get(job.id) ?? job;
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "spec_docs",
    updatedAt: createdAt,
    artifacts: preservedArtifacts.concat(documentArtifacts),
    events: latestJobForEvents.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "spec_docs",
        status: "completed",
        type: BlueprintEventName.JobCompleted,
        message: "SPEC documents generated from the selected SPEC tree.",
        occurredAt: createdAt,
        payload: {
          specTreeId: specTree.id,
          nodeCount: specTree.nodes.length,
          documentCount: documents.length,
        },
      })
    ),
  };

  options.store.save(updatedJob);

  return {
    job: updatedJob,
    specTree,
    documents: extractSpecDocuments(updatedJob),
  };
}

type GenerateEffectPreviewsResult =
  | {
      ok: true;
      response: BlueprintEffectPreviewsResponse;
    }
  | { ok: false; status: number; error: string; message: string };

async function generateEffectPreviews(
  ctx: BlueprintServiceContext,
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  request: BlueprintGenerateEffectPreviewsRequest,
  options: CreateGenerationJobHelperOptions & {
    clarificationSession?: BlueprintClarificationSession;
    domainContext?: BlueprintProjectDomainContext;
    primaryRoute?: BlueprintRouteCandidate;
  }
): Promise<GenerateEffectPreviewsResult> {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const includeDrafts = request.includeDrafts ?? false;
  const targetNodeIds = request.nodeId
    ? new Set([request.nodeId])
    : new Set(specTree.nodes.map(node => node.id));
  const targetNodes = specTree.nodes.filter(node => targetNodeIds.has(node.id));
  const existingPreviews = extractEffectPreviews(job);
  const sourceDocuments = extractSpecDocuments(job).filter(document => {
    if (!targetNodeIds.has(document.nodeId)) {
      return false;
    }

    const status = normalizeSpecDocumentStatus(document.status);
    return includeDrafts ? status !== "rejected" : status === "accepted";
  });

  if (sourceDocuments.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Blueprint SPEC documents not ready.",
      message: includeDrafts
        ? "No draft, reviewing, or accepted SPEC documents are available for effect preview generation."
        : "No accepted SPEC documents are available for effect preview generation. Pass includeDrafts=true to generate a draft-source preview.",
    };
  }

  // Upstream evidence — extracted once per request and shared across all
  // per-preview `buildEffectPreview(ctx, ...)` invocations so the prompt
  // wrapper sees a stable ordering. See design §4.7.
  const capabilityInvocations = extractCapabilityInvocations(job);
  const capabilityEvidence = extractCapabilityEvidence(job);

  // Task 14.7: concurrent preview assembly via `Promise.all`. Since each
  // per-preview service call is independent (per requirement 4.7) but the
  // outer array order must stay stable (requirement 5.6 / design §2.D3),
  // we rely on `Promise.all` preserving index order.
  const previewCandidates = await Promise.all(
    targetNodes.map(node => {
      const documents = sourceDocuments.filter(
        document => document.nodeId === node.id
      );
      if (documents.length === 0) {
        return Promise.resolve(null);
      }

      return buildEffectPreview(ctx, {
        job,
        specTree,
        node,
        documents,
        existingPreviews: existingPreviews.filter(
          preview => preview.nodeId === node.id
        ),
        includeDrafts,
        createdAt,
        clarificationSession: options.clarificationSession,
        domainContext: options.domainContext,
        primaryRoute: options.primaryRoute,
        capabilityInvocations,
        capabilityEvidence,
      });
    })
  );
  const previews = previewCandidates.filter(
    (preview): preview is BlueprintEffectPreview => Boolean(preview)
  );

  if (previews.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Blueprint SPEC documents not ready.",
      message: `No usable SPEC documents are attached to the requested SPEC tree node set.`,
    };
  }

  const replacedNodeIds = new Set(previews.map(preview => preview.nodeId));
  const previewArtifacts = previews.map(preview => ({
    id: createId("blueprint-artifact"),
    type: "effect_preview",
    title: `Effect preview: ${preview.provenance.nodeTitle}`,
    summary: preview.summary,
    createdAt,
    payload: preview,
  })) satisfies BlueprintGenerationArtifact[];
  const preservedArtifacts = job.artifacts.map(artifact => {
    if (artifact.type !== "effect_preview" || !isPlainRecord(artifact.payload)) {
      return artifact;
    }

    const payload = artifact.payload as unknown as BlueprintEffectPreview;
    if (!replacedNodeIds.has(payload.nodeId)) {
      return artifact;
    }

    return {
      ...artifact,
      payload: archiveEffectPreviewVersion(payload, createdAt),
    };
  });

  // Task 14.9: aggregate provenance per preview for the emit payload.
  // Always filled (requirement 6.5). `promptId` / `model` are only filled
  // when at least one preview attempted the LLM path.
  const previewGenerationSources = previews.map(preview => ({
    nodeId: preview.nodeId,
    generationSource:
      preview.provenance.generationSource ?? ("template" as const),
  }));
  const touchedLlm = previews.some(
    preview => preview.provenance.generationSource !== "template"
  );
  const aggregatedPromptId = touchedLlm
    ? "blueprint.effect-preview.v1"
    : undefined;
  const aggregatedModel = previews
    .map(preview => preview.provenance.model)
    .find((model): model is string => typeof model === "string");

  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "effect_preview",
    updatedAt: createdAt,
    artifacts: preservedArtifacts.concat(previewArtifacts),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "effect_preview",
        status: "completed",
        type: BlueprintEventName.JobCompleted,
        message: includeDrafts
          ? "Effect previews generated from draft-capable SPEC documents."
          : "Effect previews generated from accepted SPEC documents.",
        occurredAt: createdAt,
        payload: {
          specTreeId: specTree.id,
          previewCount: previews.length,
          sourceDocumentCount: sourceDocuments.length,
          previewIds: previews.map(preview => preview.id),
          previousPreviewIds: uniqueStrings(
            previews.flatMap(preview => preview.previousPreviewIds)
          ),
          includeDrafts,
          // —— autopilot-effect-preview-llm spec 新增（全部可选） ——
          previewGenerationSources,
          ...(aggregatedPromptId !== undefined
            ? { promptId: aggregatedPromptId }
            : {}),
          ...(aggregatedModel !== undefined
            ? { model: aggregatedModel }
            : {}),
        },
      }),
      createGenerationEvent({
        jobId: job.id,
        projectId: job.projectId,
        stage: "effect_preview",
        status: "completed",
        type: BlueprintEventName.PreviewGenerated,
        message: "Effect preview assets generated for replay visibility.",
        occurredAt: createdAt,
        specTreeId: specTree.id,
        nodeId: previews[0]?.nodeId,
        artifactId: previewArtifacts[0]?.id,
        payload: {
          specTreeId: specTree.id,
          nodeIds: previews.map(preview => preview.nodeId),
          previewIds: previews.map(preview => preview.id),
          sourceDocumentIds: uniqueStrings(
            previews.flatMap(preview => preview.sourceDocumentIds)
          ),
          includeDrafts,
          sourceIds: {
            projectId: job.projectId,
            specTreeId: specTree.id,
            nodeIds: previews.map(preview => preview.nodeId),
            effectPreviewIds: previews.map(preview => preview.id),
            specDocumentIds: uniqueStrings(
              previews.flatMap(preview => preview.sourceDocumentIds)
            ),
          },
          // —— autopilot-effect-preview-llm spec 新增（全部可选） ——
          previewGenerationSources,
          ...(aggregatedPromptId !== undefined
            ? { promptId: aggregatedPromptId }
            : {}),
          ...(aggregatedModel !== undefined
            ? { model: aggregatedModel }
            : {}),
        },
      })
    ),
  };

  options.store.save(updatedJob);

  return {
    ok: true,
    response: {
      job: updatedJob,
      specTree,
      effectPreviews: extractEffectPreviews(updatedJob),
    },
  };
}

type GenerateImplementationPromptPackagesResult =
  | {
      ok: true;
      response: BlueprintImplementationPromptPackagesResponse;
    }
  | { ok: false; status: number; error: string; message: string };

async function generateImplementationPromptPackages(
  ctx: BlueprintServiceContext,
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  request: BlueprintGenerateImplementationPromptPackagesRequest,
  options: CreateGenerationJobHelperOptions
): Promise<GenerateImplementationPromptPackagesResult> {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const includeDrafts = request.includeDrafts ?? false;
  const includePreviewDrafts = request.includePreviewDrafts ?? false;
  const targetPlatforms =
    request.targetPlatforms && request.targetPlatforms.length > 0
      ? request.targetPlatforms
      : PROMPT_TARGET_PLATFORMS.slice(0, 3);
  const targetNodeIds = request.nodeId
    ? new Set([request.nodeId])
    : new Set(specTree.nodes.map(node => node.id));
  const candidateDocuments = extractSpecDocuments(job).filter(document =>
    targetNodeIds.has(document.nodeId)
  );
  const acceptedDocuments = candidateDocuments.filter(
    document => normalizeSpecDocumentStatus(document.status) === "accepted"
  );
  const sourceDocuments =
    acceptedDocuments.length > 0
      ? acceptedDocuments
      : includeDrafts
        ? candidateDocuments.filter(
            document => normalizeSpecDocumentStatus(document.status) !== "rejected"
          )
        : [];

  if (sourceDocuments.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Blueprint SPEC documents not ready.",
      message: includeDrafts
        ? "No draft, reviewing, or accepted SPEC documents are available for implementation prompt packaging."
        : "No accepted SPEC documents are available for implementation prompt packaging. Pass includeDrafts=true to package draft-source documents.",
    };
  }

  const candidatePreviews = extractEffectPreviews(job).filter(preview =>
    targetNodeIds.has(preview.nodeId) && isConsumableEffectPreviewVersion(preview)
  );
  const acceptedPreviews = candidatePreviews.filter(
    preview => preview.provenance.sourceStatus === "accepted"
  );
  const sourcePreviews = includePreviewDrafts
    ? candidatePreviews
    : acceptedPreviews;

  if (sourcePreviews.length === 0 && !includeDrafts && !includePreviewDrafts) {
    return {
      ok: false,
      status: 409,
      error: "Blueprint effect previews not ready.",
      message:
        "No accepted effect previews are available for implementation prompt packaging. Pass includePreviewDrafts=true or includeDrafts=true to generate a document-only base package.",
    };
  }

  const nodeIds = uniqueStrings(
    sourceDocuments
      .map(document => document.nodeId)
      .concat(sourcePreviews.map(preview => preview.nodeId))
  );
  const sourceDocumentIds = sourceDocuments.map(document => document.id);
  const sourcePreviewIds = sourcePreviews.map(preview => preview.id);
  const nodes = specTree.nodes.filter(node => nodeIds.includes(node.id));

  // Defensive derivation of optional upstream inputs for the LLM service.
  // Any missing field becomes `undefined` without throwing — the service
  // treats every upstream field as optional (design §5.6 / spec task 16.11).
  const clarificationSession = (
    job as { clarificationSession?: BlueprintClarificationSession }
  ).clarificationSession;
  const domainContext = (
    job as { projectContext?: BlueprintProjectDomainContext }
  ).projectContext;
  let primaryRoute: BlueprintRouteCandidate | undefined;
  const routeSet = extractRouteSet(job);
  if (routeSet && specTree.selectedRouteId) {
    primaryRoute = routeSet.routes.find(
      route => route.id === specTree.selectedRouteId
    );
  }

  const packages = await Promise.all(
    targetPlatforms.map(targetPlatform =>
      buildImplementationPromptPackage(ctx, {
        job,
        specTree,
        targetPlatform,
        nodes,
        documents: sourceDocuments,
        previews: sourcePreviews,
        includeDrafts,
        includePreviewDrafts,
        createdAt,
        clarificationSession,
        domainContext,
        primaryRoute,
      })
    )
  );
  const generatedKeys = new Set(
    packages.map(promptPackage => promptPackageReplacementKey(promptPackage))
  );
  const packageArtifacts = packages.map(promptPackage => ({
    id: createId("blueprint-artifact"),
    type: "prompt_pack",
    title: promptPackage.title,
    summary: promptPackage.summary,
    createdAt,
    payload: promptPackage,
  })) satisfies BlueprintGenerationArtifact[];
  const preservedArtifacts = job.artifacts.filter(artifact => {
    if (artifact.type !== "prompt_pack") {
      return true;
    }

    const payload = isPlainRecord(artifact.payload)
      ? (artifact.payload as Partial<BlueprintImplementationPromptPackage>)
      : null;
    if (!payload?.targetPlatform || !Array.isArray(payload.nodeIds)) {
      return false;
    }

    return !generatedKeys.has(
      `${payload.targetPlatform}:${payload.nodeIds.join("|")}`
    );
  });
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "prompt_packaging",
    updatedAt: createdAt,
    completedAt: createdAt,
    artifacts: preservedArtifacts.concat(packageArtifacts),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "prompt_packaging",
        status: "completed",
        type: BlueprintEventName.JobCompleted,
        message:
          sourcePreviews.length > 0
            ? "Implementation prompt packages generated from SPEC documents and effect previews."
            : "Implementation prompt packages generated from SPEC documents without effect previews.",
        occurredAt: createdAt,
        payload: {
          specTreeId: specTree.id,
          nodeIds,
          sourceDocumentIds,
          sourcePreviewIds,
          targetPlatforms,
          includeDrafts,
          includePreviewDrafts,
        },
      }),
      createGenerationEvent({
        jobId: job.id,
        projectId: job.projectId,
        stage: "prompt_packaging",
        status: "completed",
        type: BlueprintEventName.PromptPackaged,
        message: "Implementation prompt packages packaged for handoff.",
        occurredAt: createdAt,
        specTreeId: specTree.id,
        nodeId: nodeIds[0],
        artifactId: packageArtifacts[0]?.id,
        payload: {
          specTreeId: specTree.id,
          nodeIds,
          promptPackageIds: packages.map(promptPackage => promptPackage.id),
          sourceDocumentIds,
          sourcePreviewIds,
          targetPlatforms,
          includeDrafts,
          includePreviewDrafts,
          sourceIds: {
            projectId: job.projectId,
            specTreeId: specTree.id,
            nodeIds,
            promptPackageIds: packages.map(promptPackage => promptPackage.id),
            specDocumentIds: sourceDocumentIds,
            effectPreviewIds: sourcePreviewIds,
          },
          // autopilot-prompt-package-llm (design §D7 / spec task 16.12):
          // per-package generationSource summary + optional meta-prompt id +
          // optional model name. All three fields are additive and optional —
          // existing subscribers remain unaffected.
          promptPackageGenerationSources: packages.map(promptPackage => ({
            promptPackageId: promptPackage.id,
            targetPlatform: promptPackage.targetPlatform,
            generationSource:
              promptPackage.provenance.generationSource ?? "template",
          })),
          ...(packages.some(
            promptPackage =>
              promptPackage.provenance.generationSource === "llm" ||
              promptPackage.provenance.generationSource === "llm_fallback"
          ) && { promptId: "blueprint.prompt-package.v1" }),
          ...(() => {
            const packageWithModel = packages.find(
              promptPackage => promptPackage.provenance.model !== undefined
            );
            return packageWithModel?.provenance.model !== undefined
              ? { model: packageWithModel.provenance.model }
              : {};
          })(),
        },
      })
    ),
  };

  options.store.save(updatedJob);

  return {
    ok: true,
    response: {
      job: updatedJob,
      specTree,
      promptPackages: extractImplementationPromptPackages(updatedJob),
    },
  };
}

type GenerateEngineeringLandingPlansResult =
  | {
      ok: true;
      response: BlueprintEngineeringLandingPlansResponse;
    }
  | { ok: false; status: number; error: string; message: string };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _GenerateEngineeringLandingPlansResultShape = Promise<GenerateEngineeringLandingPlansResult>;

function generateEngineeringLandingPlans(
  ctx: BlueprintServiceContext,
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  request: BlueprintGenerateEngineeringLandingPlansRequest,
  options: CreateGenerationJobHelperOptions
): Promise<GenerateEngineeringLandingPlansResult> {
  return generateEngineeringLandingPlansAsync(
    ctx,
    job,
    specTree,
    request,
    options,
  );
}

async function generateEngineeringLandingPlansAsync(
  ctx: BlueprintServiceContext,
  job: BlueprintGenerationJob,
  specTree: BlueprintSpecTree,
  request: BlueprintGenerateEngineeringLandingPlansRequest,
  options: CreateGenerationJobHelperOptions
): Promise<GenerateEngineeringLandingPlansResult> {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const selectedPromptPackages = selectEngineeringLandingPromptPackages(
    job,
    request
  );

  if (!selectedPromptPackages.ok) {
    return selectedPromptPackages;
  }

  const sourceDocuments = extractSpecDocuments(job);
  const sourcePreviews = extractEffectPreviews(job);
  const clarificationSession =
    job.request.clarificationSessionId !== undefined
      ? ctx.blueprintStores.clarificationSessions.get(
          job.request.clarificationSessionId,
        )
      : undefined;
  const domainContext =
    job.projectId !== undefined
      ? ctx.blueprintStores.projectContexts.get(job.projectId)
      : undefined;
  const routeSet = extractRouteSet(job);
  const selectedRoute = routeSet
    ? routeSet.routes.find(route => route.id === routeSet.primaryRouteId)
    : undefined;
  const capabilityInvocations = extractCapabilityInvocations(job);
  const capabilityEvidence = extractCapabilityEvidence(job);
  const plans = await Promise.all(
    selectedPromptPackages.promptPackages.map(promptPackage =>
      buildEngineeringLandingPlan(ctx, {
        job,
        specTree,
        promptPackage,
        sourceDocuments,
        sourcePreviews,
        createdAt,
        clarificationSession,
        domainContext,
        selectedRoute,
        capabilityInvocations,
        capabilityEvidence,
      })
    ),
  );
  const generatedKeys = new Set(
    plans.map(plan => engineeringLandingPlanReplacementKey(plan))
  );
  const planArtifacts = plans.map(plan => ({
    id: createId("blueprint-artifact"),
    type: "engineering_plan",
    title: plan.title,
    summary: plan.summary,
    createdAt,
    payload: plan,
  })) satisfies BlueprintGenerationArtifact[];
  const preservedArtifacts = job.artifacts.filter(artifact => {
    if (artifact.type !== "engineering_plan") {
      return true;
    }

    const payload = isPlainRecord(artifact.payload)
      ? (artifact.payload as Partial<BlueprintEngineeringLandingPlan>)
      : null;
    if (!Array.isArray(payload?.promptPackageIds)) {
      return false;
    }

    return !generatedKeys.has(payload.promptPackageIds.join("|"));
  });
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "engineering_landing",
    updatedAt: createdAt,
    completedAt: createdAt,
    artifacts: preservedArtifacts.concat(planArtifacts),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "engineering_landing",
        status: "completed",
        type: BlueprintEventName.JobCompleted,
        message:
          "Engineering landing plans generated from implementation prompt packages.",
        occurredAt: createdAt,
        payload: {
          specTreeId: specTree.id,
          planCount: plans.length,
          promptPackageIds: plans.flatMap(plan => plan.promptPackageIds),
          targetPlatforms: plans.flatMap(plan =>
            Object.values(plan.provenance.promptPackagePlatforms)
          ),
        },
      }),
      createGenerationEvent({
        jobId: job.id,
        projectId: job.projectId,
        stage: "engineering_landing",
        status: "completed",
        type: BlueprintEventName.MissionHandoff,
        message:
          "Engineering landing handoff prepared from implementation prompt packages.",
        occurredAt: createdAt,
        specTreeId: specTree.id,
        nodeId: plans[0]?.steps[0]?.sourceNodeIds[0],
        artifactId: planArtifacts[0]?.id,
        payload: {
          specTreeId: specTree.id,
          landingPlanIds: plans.map(plan => plan.id),
          promptPackageIds: plans.flatMap(plan => plan.promptPackageIds),
          targetPlatforms: plans.flatMap(plan =>
            Object.values(plan.provenance.promptPackagePlatforms)
          ),
          sourceNodeIds: uniqueStrings(
            plans.flatMap(plan =>
              plan.steps.flatMap(step => step.sourceNodeIds)
            )
          ),
          sourceDocumentIds: uniqueStrings(
            plans.flatMap(plan =>
              plan.steps.flatMap(step => step.sourceDocumentIds)
            )
          ),
          sourcePreviewIds: uniqueStrings(
            plans.flatMap(plan =>
              plan.steps.flatMap(step => step.sourcePreviewIds)
            )
          ),
          sourceIds: {
            projectId: job.projectId,
            specTreeId: specTree.id,
            nodeIds: uniqueStrings(
              plans.flatMap(plan =>
                plan.steps.flatMap(step => step.sourceNodeIds)
              )
            ),
            specDocumentIds: uniqueStrings(
              plans.flatMap(plan =>
                plan.steps.flatMap(step => step.sourceDocumentIds)
              )
            ),
            effectPreviewIds: uniqueStrings(
              plans.flatMap(plan =>
                plan.steps.flatMap(step => step.sourcePreviewIds)
              )
            ),
            promptPackageIds: plans.flatMap(plan => plan.promptPackageIds),
            landingPlanIds: plans.map(plan => plan.id),
          },
          landingPlanGenerationSources: plans.map(plan => ({
            landingPlanId: plan.id,
            promptPackageId: plan.promptPackageIds[0],
            generationSource:
              (plan.provenance as Record<string, unknown>).generationSource ??
              "template",
          })),
          promptId: plans.find(
            plan =>
              typeof (plan.provenance as Record<string, unknown>).promptId ===
              "string",
          )
            ? (plans.find(
                plan =>
                  typeof (plan.provenance as Record<string, unknown>)
                    .promptId === "string",
              )!.provenance as Record<string, unknown>).promptId
            : undefined,
          model: plans.find(
            plan =>
              typeof (plan.provenance as Record<string, unknown>).model ===
              "string",
          )
            ? (plans.find(
                plan =>
                  typeof (plan.provenance as Record<string, unknown>).model ===
                  "string",
              )!.provenance as Record<string, unknown>).model
            : undefined,
        },
      })
    ),
  };

  options.store.save(updatedJob);

  return {
    ok: true,
    response: buildEngineeringLandingPlansResponse(updatedJob, specTree),
  };
}

function selectEngineeringLandingPromptPackages(
  job: BlueprintGenerationJob,
  request: BlueprintGenerateEngineeringLandingPlansRequest
):
  | {
      ok: true;
      promptPackages: BlueprintImplementationPromptPackage[];
    }
  | { ok: false; status: number; error: string; message: string } {
  const promptPackages = extractImplementationPromptPackages(job);

  if (promptPackages.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Blueprint implementation prompt packages not ready.",
      message:
        "No implementation prompt packages are available for engineering landing. Generate prompt packages before creating landing plans.",
    };
  }

  let selectedPromptPackages = promptPackages;
  if (request.promptPackageId) {
    const promptPackage = promptPackages.find(
      item => item.id === request.promptPackageId
    );

    if (!promptPackage) {
      return {
        ok: false,
        status: 404,
        error: "Blueprint implementation prompt package not found.",
        message: `No implementation prompt package ${request.promptPackageId} exists in job ${job.id}.`,
      };
    }

    selectedPromptPackages = [promptPackage];
  }

  const targetPlatforms =
    request.targetPlatforms ??
    (request.targetPlatform ? [request.targetPlatform] : undefined);

  if (targetPlatforms) {
    selectedPromptPackages = selectedPromptPackages.filter(promptPackage =>
      targetPlatforms.includes(promptPackage.targetPlatform)
    );
  }

  if (selectedPromptPackages.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Blueprint implementation prompt packages not ready.",
      message:
        "No implementation prompt packages match the requested engineering landing filter.",
    };
  }

  return { ok: true, promptPackages: selectedPromptPackages };
}

type CreateSandboxDerivationJobResult =
  | { ok: true; response: BlueprintSandboxDerivationJobResponse }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      job?: BlueprintGenerationJob;
    };

type GetOrCreateCapabilityRegistryResult = {
  job: BlueprintGenerationJob;
  capabilities: BlueprintRuntimeCapability[];
  agentCrew: BlueprintAgentCrew;
};

function createSandboxDerivationJob(
  job: BlueprintGenerationJob,
  request: BlueprintSandboxDerivationJobRequest,
  options: CreateGenerationJobHelperOptions
): CreateSandboxDerivationJobResult {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const registry = getOrCreateCapabilityRegistry(job, options);
  const routeSet = extractRouteSet(registry.job);
  const specTree = extractSpecTree(registry.job);
  const stage = request.stage ?? registry.job.stage ?? "runtime_capability";
  const executionMode = request.executionMode ?? "sequential";
  const routeId = request.routeId ?? request.capabilities[0]?.routeId;
  const nodeId = request.nodeId ?? request.capabilities[0]?.nodeId;
  const roleId = request.roleId ?? request.capabilities[0]?.roleId;
  const crewId = request.crewId ?? request.capabilities[0]?.crewId;
  const invocations: BlueprintCapabilityInvocation[] = [];
  const evidenceItems: BlueprintCapabilityEvidence[] = [];
  let currentJob = registry.job;
  const recordSandboxFailure = (
    failedJob: BlueprintGenerationJob,
    failure: Extract<InvokeCapabilityResult, { ok: false }>
  ): Extract<CreateSandboxDerivationJobResult, { ok: false }> => {
    const failedAt = (options.now?.() ?? new Date()).toISOString();
    const specTree = extractSpecTree(failedJob);
    const updatedJob: BlueprintGenerationJob = {
      ...failedJob,
      status: "reviewing",
      stage,
      updatedAt: failedAt,
      events: failedJob.events.concat(
        createGenerationEvent({
          jobId: job.id,
          projectId: failedJob.projectId,
          type: BlueprintEventName.SandboxJobFailed,
          family: "sandbox",
          stage,
          status: "failed",
          message: failure.message,
          occurredAt: failedAt,
          routeId,
          specTreeId: specTree?.id,
          nodeId,
          payload: {
            error: failure.error,
            status: failure.status,
            executionMode,
            capabilityIds: request.capabilities.map(item => item.capabilityId),
            routeId,
            nodeId,
            roleId,
            crewId,
            sourceIds: {
              projectId: failedJob.projectId,
              roleIds: roleId ? [roleId] : [],
              crewIds: crewId ? [crewId] : [],
              capabilityIds: request.capabilities.map(
                item => item.capabilityId
              ),
              nodeIds: nodeId ? [nodeId] : [],
            },
          },
        })
      ),
    };

    options.store.save(updatedJob);
    return { ...failure, job: updatedJob };
  };

  for (const capabilityRequest of request.capabilities) {
    const invocationResult = invokeCapability(
      currentJob,
      {
        ...capabilityRequest,
        routeId: capabilityRequest.routeId ?? routeId,
        nodeId: capabilityRequest.nodeId ?? nodeId,
        requestedBy:
          capabilityRequest.requestedBy ?? "sandbox-derivation-job",
      },
      options
    );

    if (!invocationResult.ok) {
      const failedJob =
        invocationResult.job ?? options.store.get(job.id) ?? currentJob;
      return recordSandboxFailure(failedJob, invocationResult);
    }

    invocations.push(invocationResult.response.invocation);
    evidenceItems.push(invocationResult.response.evidence);
    currentJob = invocationResult.response.job;
  }

  const latestJob = options.store.get(job.id) ?? currentJob;
  const previousRoleFindings = collectReusableRoleFindings(latestJob, {
    stages: ["route_generation", "spec_tree", "runtime_capability"],
    routeId,
    nodeId,
    limit: 6,
  });
  const capabilityIds = uniqueStrings(
    request.capabilities.map(item => item.capabilityId)
  );
  const invocationIds = invocations.map(invocation => invocation.id);
  const evidenceIds = evidenceItems.map(evidence => evidence.id);
  const mainRoute = routeSet?.routes.find(route => route.id === routeId);
  const alternateRoutes = routeSet?.routes.filter(route => route.id !== routeId) ?? [];
  const previousFindingCount = previousRoleFindings.length;
  const previousFindingSummary =
    previousFindingCount > 0
      ? ` Reused ${previousFindingCount} previous role finding(s).`
      : "";
  const sandboxDerivationJob: BlueprintSandboxDerivationJob = {
    id: createId("blueprint-sandbox-derivation"),
    jobId: job.id,
    roleId,
    crewId,
    stage,
    projectId: request.projectId ?? latestJob.projectId,
    routeId,
    nodeId,
    executionMode,
    status: "completed",
    createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
    durationMs: invocations.reduce(
      (total, invocation) => total + invocation.durationMs,
      0
    ),
    capabilityIds,
    invocationIds,
    evidenceIds,
    aggregate: {
      routeOutline:
        mainRoute?.summary ??
        `Sandbox derivation completed ${invocations.length} capability invocation(s).`,
      mainPath: {
        id: `${job.id}:sandbox-main-path`,
        title: mainRoute?.title ?? "Sandbox derived main path",
        summary:
          mainRoute?.summary ??
          evidenceItems.map(item => item.summary).join(" "),
        routeId,
        nodeId,
        capabilityIds,
        invocationIds,
        evidenceIds,
      },
      alternatePaths: alternateRoutes.slice(0, 2).map(route => ({
        id: `${job.id}:sandbox-alt:${route.id}`,
        title: route.title,
        summary: route.summary,
        routeId: route.id,
        nodeId,
        capabilityIds: route.capabilities.map(capability => capability.id),
        invocationIds: [],
        evidenceIds: [],
      })),
      evaluation: [
        {
          id: `${job.id}:sandbox-eval-risk`,
          label: "Risk coverage",
          score: Math.min(100, 60 + evidenceIds.length * 10),
          summary: `${evidenceIds.length} evidence item(s) linked to sandbox derivation.`,
        },
        {
          id: `${job.id}:sandbox-eval-cost`,
          label: "Cost signal",
          score: executionMode === "parallel" ? 72 : 84,
          summary: `${executionMode} execution used for deterministic capability aggregation.`,
        },
        {
          id: `${job.id}:sandbox-eval-complexity`,
          label: "Complexity signal",
          score: Math.max(40, 90 - capabilityIds.length * 8),
          summary: `${capabilityIds.length} capability binding(s) contributed to route complexity assessment.`,
        },
      ],
      outputSummary: `${invocations.length} capability invocation(s) aggregated into ${executionMode} sandbox derivation output.${previousFindingSummary}`,
    },
    logs: [
      `sandbox.job.started id=${job.id}`,
      `executionMode=${executionMode}`,
      `capabilities=${capabilityIds.join(",")}`,
      `reusedRoleFindingIds=${collectRoleFindingIds(previousRoleFindings).join(",")}`,
      `reusedEvidenceIds=${collectRoleFindingEvidenceIds(previousRoleFindings).join(",")}`,
      `sandbox.job.completed invocationCount=${invocationIds.length}`,
    ],
    provenance: {
      jobId: job.id,
      projectId: request.projectId ?? latestJob.projectId,
      sourceId: latestJob.sourceId,
      routeSetId: routeSet?.id,
      routeId,
      specTreeId: specTree?.id,
      nodeId,
      roleId,
      crewId,
      targetText: latestJob.request.targetText,
      githubUrls: latestJob.request.githubUrls ?? [],
    },
  };
  const artifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "sandbox_derivation_job",
    title: "Sandbox derivation job",
    summary: sandboxDerivationJob.aggregate.outputSummary,
    createdAt,
    payload: sandboxDerivationJob,
  };
  const sandboxRoleEvents = [
    createRoleEvent({
      jobId: job.id,
      projectId: latestJob.projectId,
      crewId,
      type: BlueprintEventName.RoleCapabilityInvoked,
      stage,
      status: "running",
      roleId: roleId ?? "role-runtime-executor",
      presenceState: "active",
      message: "Runtime executor coordinated sandbox derivation capability fan-out.",
      occurredAt: createdAt,
      currentAction: sandboxDerivationJob.aggregate.outputSummary,
      capabilityId: capabilityIds[0],
      invocationId: invocationIds[0],
      evidenceId: evidenceIds[0],
      artifactId: artifact.id,
      routeId,
      specTreeId: specTree?.id,
      nodeId,
    }),
    createRoleEvent({
      jobId: job.id,
      projectId: latestJob.projectId,
      crewId,
      type: BlueprintEventName.RoleCompleted,
      stage,
      status: "completed",
      roleId: roleId ?? "role-runtime-executor",
      presenceState: "active",
      message: "Runtime executor completed sandbox derivation aggregation.",
      occurredAt: createdAt,
      currentAction: sandboxDerivationJob.aggregate.outputSummary,
      capabilityId: capabilityIds[0],
      invocationId: invocationIds[0],
      evidenceId: evidenceIds[0],
      artifactId: artifact.id,
      routeId,
      specTreeId: specTree?.id,
      nodeId,
    }),
  ];
  const agentCrew = registry.agentCrew;
  const roleTimelineCollection = buildRoleTimelineCollection(
    {
      ...latestJob,
      artifacts: latestJob.artifacts
        .filter(artifactItem => artifactItem.type !== "role_timeline")
        .concat(artifact),
      events: latestJob.events.concat(sandboxRoleEvents),
    },
    createdAt,
    agentCrew
  );
  const roleTimelineArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "role_timeline",
    title: "Agent role timeline",
    summary: `Role timeline updated for sandbox derivation job.`,
    createdAt,
    payload: roleTimelineCollection,
  };
  const updatedJob: BlueprintGenerationJob = {
    ...latestJob,
    status: "reviewing",
    stage,
    updatedAt: createdAt,
    artifacts: latestJob.artifacts
      .filter(artifactItem => artifactItem.type !== "role_timeline")
      .concat(artifact, roleTimelineArtifact),
    events: latestJob.events.concat(
      sandboxRoleEvents[0],
      createGenerationEvent({
        jobId: job.id,
        projectId: latestJob.projectId,
        type: BlueprintEventName.SandboxJobStarted,
        family: "sandbox",
        stage,
        status: "running",
        message: "Sandbox derivation job started.",
        occurredAt: createdAt,
        routeId,
        nodeId,
        artifactId: artifact.id,
        payload: {
          sandboxDerivationJobId: sandboxDerivationJob.id,
          executionMode,
          capabilityIds,
        },
      }),
      createGenerationEvent({
        jobId: job.id,
        projectId: latestJob.projectId,
        type: BlueprintEventName.SandboxJobCompleted,
        family: "sandbox",
        stage,
        status: "completed",
        message: "Sandbox derivation job completed.",
        occurredAt: createdAt,
        routeId,
        nodeId,
        artifactId: artifact.id,
        payload: {
          sandboxDerivationJobId: sandboxDerivationJob.id,
          invocationIds,
          evidenceIds,
          routeId,
          nodeId,
        },
      }),
      sandboxRoleEvents[1]
    ),
  };

  options.store.save(updatedJob);

  return {
    ok: true,
    response: {
      job: updatedJob,
      routeSet,
      specTree,
      agentCrew,
      sandboxDerivationJob,
      invocations,
      evidence: evidenceItems,
    },
  };
}

function getOrCreateCapabilityRegistry(
  job: BlueprintGenerationJob,
  options: CreateGenerationJobHelperOptions
): GetOrCreateCapabilityRegistryResult {
  const existing = extractRuntimeCapabilities(job);
  const hasRegistry = job.artifacts.some(
    artifact => artifact.type === "capability_registry"
  );

  if (hasRegistry) {
    const agentCrew =
      extractAgentCrew(job) ??
      buildAgentCrew({
        jobId: job.id,
        stage: job.stage,
        createdAt: job.updatedAt,
        capabilities: existing,
      });
    return { job, capabilities: existing, agentCrew };
  }

  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const capabilities = getDefaultRuntimeCapabilities();
  const existingCrew = extractAgentCrew(job);
  const agentCrew = existingCrew
    ? {
        ...existingCrew,
        updatedAt: createdAt,
        stage: "runtime_capability" as BlueprintGenerationStage,
        capabilityMatrix: buildDefaultCapabilityMatrix(capabilities),
        presence: buildRolePresence({
          stage: "runtime_capability",
          capabilityMatrix: buildDefaultCapabilityMatrix(capabilities),
          activationPolicies: existingCrew.activationPolicies,
          artifactIds: [],
          evidenceIds: [],
        }),
      }
    : buildAgentCrew({
        jobId: job.id,
        stage: "runtime_capability",
        createdAt,
        capabilities,
      });
  const registryArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "capability_registry",
    title: "Runtime capability registry",
    summary: `Registered ${capabilities.length} default runtime capability adapters.`,
    createdAt,
    payload: {
      id: createId("blueprint-capability-registry"),
      jobId: job.id,
      createdAt,
      updatedAt: createdAt,
      capabilities,
      sourceIds: {
        capabilityIds: capabilities.map(capability => capability.id),
      },
    },
  };
  const agentCrewArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "agent_crew",
    title: "Agent Crew fabric",
    summary: `Agent Crew updated for runtime capability stage with ${agentCrew.capabilityMatrix.length} role capability bindings.`,
    createdAt,
    payload: agentCrew,
  };
  const rolePresenceEvents = createRolePresenceEvents({
    jobId: job.id,
    projectId: job.projectId,
    crewId: agentCrew.id,
    stage: "runtime_capability",
    status: "reviewing",
    occurredAt: createdAt,
    presence: agentCrew.presence,
    artifactId: agentCrewArtifact.id,
  });
  const crewContextEvent = createGenerationEvent({
    jobId: job.id,
    projectId: job.projectId,
    type: BlueprintEventName.CrewContextUpdated,
    stage: "runtime_capability",
    status: "reviewing",
    message: "Agent Crew context updated for runtime capability registry.",
    occurredAt: createdAt,
    artifactId: agentCrewArtifact.id,
    payload: {
      crewId: agentCrew.id,
      capabilityIds: capabilities.map(capability => capability.id),
      roleIds: agentCrew.roles.map(role => role.id),
      sourceIds: {
        projectId: job.projectId,
        crewIds: [agentCrew.id],
        roleIds: agentCrew.roles.map(role => role.id),
        capabilityIds: capabilities.map(capability => capability.id),
      },
    },
  });
  const roleTimelineCollection = buildRoleTimelineCollection(
    {
      ...job,
      artifacts: job.artifacts
        .filter(artifact => artifact.type !== "agent_crew")
        .concat(registryArtifact, agentCrewArtifact),
      events: job.events.concat(crewContextEvent, rolePresenceEvents),
    },
    createdAt,
    agentCrew
  );
  const roleTimelineArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "role_timeline",
    title: "Agent role timeline",
    summary: `Role timelines captured for runtime capability stage.`,
    createdAt,
    payload: roleTimelineCollection,
  };
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: "reviewing",
    stage: "runtime_capability",
    updatedAt: createdAt,
    artifacts: job.artifacts
      .filter(
        artifact =>
          artifact.type !== "agent_crew" && artifact.type !== "role_timeline"
      )
      .concat(registryArtifact, agentCrewArtifact, roleTimelineArtifact),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        projectId: job.projectId,
        type: BlueprintEventName.JobStage,
        stage: "runtime_capability",
        status: "reviewing",
        message: "Runtime capability registry registered.",
        occurredAt: createdAt,
        payload: {
          capabilityIds: capabilities.map(capability => capability.id),
          capabilityCount: capabilities.length,
        },
      }),
      crewContextEvent,
      ...rolePresenceEvents
    ),
  };

  options.store.save(updatedJob);
  return { job: updatedJob, capabilities, agentCrew };
}

type InvokeCapabilityResult =
  | { ok: true; response: BlueprintInvokeCapabilityResponse }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      job?: BlueprintGenerationJob;
    };

function invokeCapability(
  job: BlueprintGenerationJob,
  request: BlueprintCapabilityInvocationRequest,
  options: CreateGenerationJobHelperOptions
): InvokeCapabilityResult {
  const roleId = request.roleId;
  if (!roleId) {
    return {
      ok: false,
      status: 400,
      error: "Blueprint role id required.",
      message: "Provide roleId to invoke a blueprint runtime capability.",
    };
  }

  const registry = getOrCreateCapabilityRegistry(job, options);
  const failCapabilityInvocation = (input: {
    status: number;
    error: string;
    message: string;
    capabilityId?: string;
    roleId?: string;
  }): Extract<InvokeCapabilityResult, { ok: false }> => {
    const failedAt = (options.now?.() ?? new Date()).toISOString();
    const specTree = extractSpecTree(registry.job);
    const failedJob: BlueprintGenerationJob = {
      ...registry.job,
      status: "reviewing",
      stage: "runtime_capability",
      updatedAt: failedAt,
      events: registry.job.events.concat(
        createGenerationEvent({
          jobId: registry.job.id,
          projectId: registry.job.projectId,
          type: BlueprintEventName.CapabilityFailed,
          family: "capability",
          stage: "runtime_capability",
          status: "failed",
          message: input.message,
          occurredAt: failedAt,
          routeId: request.routeId,
          specTreeId: specTree?.id,
          nodeId: request.nodeId,
          roleId: input.roleId,
          capabilityId: input.capabilityId,
          payload: {
            error: input.error,
            status: input.status,
            capabilityId: input.capabilityId,
            roleId: input.roleId,
            routeId: request.routeId,
            nodeId: request.nodeId,
            sourceIds: {
              projectId: registry.job.projectId,
              roleIds: input.roleId ? [input.roleId] : [],
              capabilityIds: input.capabilityId ? [input.capabilityId] : [],
              nodeIds: request.nodeId ? [request.nodeId] : [],
            },
          },
        })
      ),
    };

    options.store.save(failedJob);
    return {
      ok: false,
      status: input.status,
      error: input.error,
      message: input.message,
      job: failedJob,
    };
  };
  const capability = registry.capabilities.find(
    item => item.id === request.capabilityId
  );

  if (!capability) {
    return failCapabilityInvocation({
      status: 404,
      error: "Blueprint runtime capability not found.",
      message: `No runtime capability ${request.capabilityId} exists in job ${job.id}.`,
      capabilityId: request.capabilityId,
      roleId,
    });
  }

  const binding = registry.agentCrew.capabilityMatrix.find(
    item =>
      item.roleId === roleId &&
      item.capabilityId === request.capabilityId &&
      item.applicableStages.includes(registry.job.stage)
  );
  if (!binding) {
    return failCapabilityInvocation({
      status: 403,
      error: "Blueprint role capability binding not allowed.",
      message: `Role ${roleId} is not bound to capability ${request.capabilityId} for stage ${registry.job.stage}.`,
      capabilityId: capability.id,
      roleId,
    });
  }

  const safetyGate = evaluateCapabilitySafetyGate(capability, request);
  if (safetyGate.status === "blocked") {
    return failCapabilityInvocation({
      status: 403,
      error: "Blueprint runtime capability approval required.",
      message: safetyGate.reason,
      capabilityId: capability.id,
      roleId,
    });
  }

  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const routeSet = extractRouteSet(registry.job);
  const specTree = extractSpecTree(registry.job);
  const route = routeSet?.routes.find(item => item.id === request.routeId);
  const node = specTree?.nodes.find(item => item.id === request.nodeId);
  const outputSummary = buildCapabilityOutputSummary({
    capability,
    routeTitle: route?.title,
    nodeTitle: node?.title,
    input: request.input,
  });
  const invocation: BlueprintCapabilityInvocation = {
    id: createId("blueprint-capability-invocation"),
    jobId: registry.job.id,
    capabilityId: capability.id,
    roleId,
    capabilityLabel: capability.label,
    kind: capability.kind,
    status: "completed",
    securityLevel: capability.securityLevel,
    safetyGate,
    requestedAt: createdAt,
    completedAt: createdAt,
    requestedBy: request.requestedBy,
    routeId: request.routeId,
    nodeId: request.nodeId,
    input: request.input,
    outputSummary,
    logs: buildCapabilityInvocationLogs(capability, outputSummary),
    evidenceIds: [],
    durationMs: deterministicCapabilityDuration(capability, request),
    provenance: {
      jobId: registry.job.id,
      projectId: registry.job.projectId,
      sourceId: registry.job.sourceId,
      routeSetId: routeSet?.id,
      routeId: request.routeId,
      specTreeId: specTree?.id,
      nodeId: request.nodeId,
      roleId,
      targetText: registry.job.request.targetText,
      githubUrls: registry.job.request.githubUrls ?? [],
    },
  };
  const evidence = buildCapabilityEvidence({
    job: registry.job,
    capability,
    invocation,
    routeSet,
    specTree,
    createdAt,
    tags: request.evidenceTags ?? [],
  });
  const invocationWithEvidence: BlueprintCapabilityInvocation = {
    ...invocation,
    evidenceIds: [evidence.id],
  };
  const invocationArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "capability_invocation",
    title: `Capability invocation: ${capability.label}`,
    summary: outputSummary,
    createdAt,
    payload: invocationWithEvidence,
  };
  const evidenceArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "capability_evidence",
    title: evidence.title,
    summary: evidence.summary,
    createdAt,
    payload: evidence,
  };
  const updatedPresence = buildRolePresence({
    stage: "runtime_capability",
    capabilityMatrix: registry.agentCrew.capabilityMatrix,
    activationPolicies: registry.agentCrew.activationPolicies,
    artifactIds: [invocationArtifact.id, evidenceArtifact.id],
    evidenceIds: [evidence.id],
  });
  const updatedAgentCrew: BlueprintAgentCrew = {
    ...registry.agentCrew,
    updatedAt: createdAt,
    stage: "runtime_capability",
    presence: updatedPresence,
    sourceIds: {
      ...registry.agentCrew.sourceIds,
      capabilityIds: uniqueStrings(
        (registry.agentCrew.sourceIds.capabilityIds ?? []).concat(
          capability.id
        )
      ),
      capabilityInvocationIds: [invocationWithEvidence.id],
      capabilityEvidenceIds: [evidence.id],
    },
  };
  const agentCrewArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "agent_crew",
    title: "Agent Crew fabric",
    summary: `Agent Crew updated after ${capability.label} invocation.`,
    createdAt,
    payload: updatedAgentCrew,
  };
  const roleCapabilityEvent = createRoleEvent({
    jobId: registry.job.id,
    projectId: registry.job.projectId,
    crewId: updatedAgentCrew.id,
    type: BlueprintEventName.RoleCapabilityInvoked,
    stage: "runtime_capability",
    status: "reviewing",
    roleId,
    presenceState: "active",
    message: `${roleId} invoked runtime capability ${capability.label}.`,
    occurredAt: createdAt,
    currentAction: outputSummary,
    capabilityId: capability.id,
    invocationId: invocationWithEvidence.id,
    evidenceId: evidence.id,
    artifactId: invocationArtifact.id,
    routeId: request.routeId,
    specTreeId: specTree?.id,
    nodeId: request.nodeId,
  });
  const roleReviewEvent = createRoleEvent({
    jobId: registry.job.id,
    projectId: registry.job.projectId,
    crewId: updatedAgentCrew.id,
    type: BlueprintEventName.RoleReviewCompleted,
    stage: "runtime_capability",
    status: "reviewing",
    roleId: "role-quality-auditor",
    presenceState: "reviewing",
    message: `Quality auditor reviewed runtime evidence from ${capability.label}.`,
    occurredAt: createdAt,
    currentAction:
      "Quality auditor is checking runtime capability evidence for replay.",
    capabilityId: capability.id,
    invocationId: invocationWithEvidence.id,
    evidenceId: evidence.id,
    artifactId: evidenceArtifact.id,
    routeId: request.routeId,
    specTreeId: specTree?.id,
    nodeId: request.nodeId,
  });
  const crewContextEvent = createGenerationEvent({
    jobId: registry.job.id,
    projectId: registry.job.projectId,
    type: BlueprintEventName.CrewContextUpdated,
    stage: "runtime_capability",
    status: "reviewing",
    message: `Agent Crew context updated after ${capability.label} invocation.`,
    occurredAt: createdAt,
    artifactId: agentCrewArtifact.id,
    capabilityId: capability.id,
    evidenceId: evidence.id,
    routeId: request.routeId,
    specTreeId: specTree?.id,
    nodeId: request.nodeId,
    payload: {
      crewId: updatedAgentCrew.id,
      roleId,
      capabilityId: capability.id,
      invocationId: invocationWithEvidence.id,
      evidenceId: evidence.id,
      sourceIds: {
        projectId: registry.job.projectId,
        crewIds: [updatedAgentCrew.id],
        roleIds: [roleId],
        capabilityIds: [capability.id],
        capabilityInvocationIds: [invocationWithEvidence.id],
        capabilityEvidenceIds: [evidence.id],
        nodeIds: request.nodeId ? [request.nodeId] : [],
      },
    },
  });
  const roleTimelineCollection = buildRoleTimelineCollection(
    {
      ...registry.job,
      artifacts: registry.job.artifacts
        .filter(artifact => artifact.type !== "agent_crew")
        .concat(invocationArtifact, evidenceArtifact, agentCrewArtifact),
      events: registry.job.events.concat(
        roleCapabilityEvent,
        crewContextEvent,
        roleReviewEvent
      ),
    },
    createdAt,
    updatedAgentCrew
  );
  const roleTimelineArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "role_timeline",
    title: "Agent role timeline",
    summary: `Role timeline updated for capability ${capability.label}.`,
    createdAt,
    payload: roleTimelineCollection,
  };
  const updatedJob: BlueprintGenerationJob = {
    ...registry.job,
    status: "reviewing",
    stage: "runtime_capability",
    updatedAt: createdAt,
    artifacts: registry.job.artifacts
      .filter(
        artifact =>
          artifact.type !== "agent_crew" && artifact.type !== "role_timeline"
      )
      .concat(
        invocationArtifact,
        evidenceArtifact,
        agentCrewArtifact,
        roleTimelineArtifact
      ),
    events: registry.job.events.concat(
      roleCapabilityEvent,
      createGenerationEvent({
        jobId: registry.job.id,
        projectId: registry.job.projectId,
        type: BlueprintEventName.CapabilityInvoked,
        family: "capability",
        stage: "runtime_capability",
        status: "running",
        message: `Runtime capability ${capability.label} invoked.`,
        occurredAt: createdAt,
        routeId: request.routeId,
        specTreeId: specTree?.id,
        nodeId: request.nodeId,
        artifactId: invocationArtifact.id,
        roleId,
        capabilityId: capability.id,
        evidenceId: evidence.id,
        payload: {
          capabilityId: capability.id,
          roleId,
          invocationId: invocationWithEvidence.id,
          evidenceId: evidence.id,
          routeId: request.routeId,
          nodeId: request.nodeId,
          sourceIds: {
            projectId: registry.job.projectId,
            roleIds: [roleId],
            capabilityIds: [capability.id],
            capabilityInvocationIds: [invocationWithEvidence.id],
            capabilityEvidenceIds: [evidence.id],
            nodeIds: request.nodeId ? [request.nodeId] : [],
          },
        },
      }),
      createGenerationEvent({
        jobId: registry.job.id,
        projectId: registry.job.projectId,
        type: BlueprintEventName.CapabilityCompleted,
        family: "capability",
        stage: "runtime_capability",
        status: "reviewing",
        message: `Runtime capability ${capability.label} completed.`,
        occurredAt: createdAt,
        routeId: request.routeId,
        specTreeId: specTree?.id,
        nodeId: request.nodeId,
        artifactId: evidenceArtifact.id,
        roleId,
        capabilityId: capability.id,
        evidenceId: evidence.id,
        payload: {
          capabilityId: capability.id,
          roleId,
          invocationId: invocationWithEvidence.id,
          evidenceId: evidence.id,
          routeId: request.routeId,
          nodeId: request.nodeId,
          sourceIds: {
            projectId: registry.job.projectId,
            roleIds: [roleId],
            capabilityIds: [capability.id],
            capabilityInvocationIds: [invocationWithEvidence.id],
            capabilityEvidenceIds: [evidence.id],
            nodeIds: request.nodeId ? [request.nodeId] : [],
          },
        },
      }),
      crewContextEvent,
      roleReviewEvent
    ),
  };

  options.store.save(updatedJob);

  return {
    ok: true,
    response: {
      job: updatedJob,
      routeSet,
      specTree,
      capability,
      agentCrew: updatedAgentCrew,
      invocation: invocationWithEvidence,
      evidence,
    },
  };
}

function evaluateCapabilitySafetyGate(
  capability: BlueprintRuntimeCapability,
  request: BlueprintCapabilityInvocationRequest
): BlueprintCapabilityInvocation["safetyGate"] {
  const requiresApproval =
    capability.requiresApproval ||
    capability.status === "requires_approval" ||
    capability.securityLevel === "networked" ||
    capability.securityLevel === "write_enabled";
  const approved = request.approved === true;

  if (requiresApproval && !approved) {
    return {
      status: "blocked",
      reason: `${capability.label} requires approved=true for ${capability.securityLevel} runtime access.`,
      requiresApproval,
      approved,
      securityLevel: capability.securityLevel,
    };
  }

  return {
    status: "allowed",
    reason: requiresApproval
      ? `${capability.label} approved for deterministic runtime simulation.`
      : `${capability.label} allowed by default ${capability.securityLevel} safety policy.`,
    requiresApproval,
    approved,
    securityLevel: capability.securityLevel,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// reasoning-detail Wave 2（whybuddy-3d-real-role-driven-scene-2026-05-29 /
// 2026-05-31）：route_generation 与 spec_tree 第二轮 ReAct 的"形态摘要"
// 纯函数。提取出来便于单测直接锁住空数据保护与真实事实聚合，不依赖整个
// route handler / LLM mock / 全局环境旗标，避免事件级回归被 BUILD_TARGET=test
// 等全局短路屏蔽。
// ─────────────────────────────────────────────────────────────────────────

/**
 * 把一个候选路线集（已过滤）折成"路线集形态"摘要。
 *
 * - 输入为空数组时返回 `null`，调用方据此**不发**第二轮 analyze 事件，
 *   避免出现"空规划评估"假事件；
 * - 非空时返回类似 `路线集形态：主路线「X」（balanced · cost=medium）；2 条备选；
 *   复杂度分布 balanced×2 · light×1` 的字符串，事实直接来自
 *   `routes[].kind / complexity / costLevel`，不造数。
 */
export function summarizeRouteSetShape(
  routes: ReadonlyArray<BlueprintRouteCandidate>,
): string | null {
  if (!Array.isArray(routes) || routes.length === 0) return null;

  const primaryRoute = routes.find(r => r.kind === "primary");
  const alternativeCount = routes.filter(r => r.kind === "alternative").length;
  const complexityCounts = new Map<string, number>();
  for (const route of routes) {
    const key =
      typeof route.complexity === "string" ? route.complexity : "unknown";
    complexityCounts.set(key, (complexityCounts.get(key) ?? 0) + 1);
  }
  const complexityBreakdown = Array.from(complexityCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([level, count]) => `${level}×${count}`)
    .join(" · ");
  const primarySummary = primaryRoute
    ? `主路线「${primaryRoute.title}」（${primaryRoute.complexity ?? "unknown"} · cost=${primaryRoute.costLevel ?? "unknown"}）`
    : "未识别到主路线";
  return `路线集形态：${primarySummary}；${alternativeCount} 条备选；复杂度分布 ${complexityBreakdown || "n/a"}`;
}

/**
 * 把一棵已派生的 SPEC 树折成"形态摘要"。
 *
 * - 通过 `parentId === rootNodeId` 找出根节点直接分支；空时返回 `null`，
 *   调用方据此**不发**第二轮 analyze 事件；
 * - 非空时返回类似 `SPEC 树形态：根节点下 3 条主分支：A / B / C；最大深度 1 层`，
 *   事实直接来自 `nodes[].parentId / title`，深度通过 BFS-like 单遍传播算出，
 *   不造数。
 */
export function summarizeSpecTreeShape(
  rootNodeId: string,
  nodes: ReadonlyArray<BlueprintSpecTreeNode>,
): string | null {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const rootChildren = nodes.filter(node => node.parentId === rootNodeId);
  if (rootChildren.length === 0) return null;

  // 计算最大树深（root=0，逐层递增）。N 通常 ≤ 几十；spec_tree 派生是低频事件。
  const depthByNode = new Map<string, number>();
  depthByNode.set(rootNodeId, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (depthByNode.has(node.id)) continue;
      if (!node.parentId) continue;
      const parentDepth = depthByNode.get(node.parentId);
      if (parentDepth !== undefined) {
        depthByNode.set(node.id, parentDepth + 1);
        changed = true;
      }
    }
  }
  const maxDepth = Array.from(depthByNode.values()).reduce(
    (max, depth) => (depth > max ? depth : max),
    0,
  );

  const branchSummary = rootChildren
    .slice(0, 6)
    .map(child => child.title)
    .filter(
      (title): title is string => typeof title === "string" && title.length > 0,
    )
    .join(" / ");
  const overflow =
    rootChildren.length > 6 ? `（共 ${rootChildren.length} 条分支）` : "";
  return `SPEC 树形态：根节点下 ${rootChildren.length} 条主分支${overflow}：${branchSummary || "n/a"}；最大深度 ${maxDepth} 层`;
}

type ShapeAnalysisEmitter = Pick<
  StageProgressEmitter,
  "nextIteration" | "thinking" | "acting" | "observing"
>;

export function emitSpecTreeShapeAnalysis(
  emitter: ShapeAnalysisEmitter | undefined,
  rootNodeId: string,
  nodes: ReadonlyArray<BlueprintSpecTreeNode>,
): boolean {
  const summary = summarizeSpecTreeShape(rootNodeId, nodes);
  if (summary === null || !emitter) return false;

  emitter.nextIteration();
  emitter.thinking(
    `正在分析派生出的 SPEC 树结构（共 ${nodes.length} 个节点），统计根节点分支与最大深度...`,
  );
  emitter.acting("blueprint.spec_tree.analyze");
  emitter.observing(true, summary);
  return true;
}

export function buildCapabilityOutputSummary(input: {
  capability: BlueprintRuntimeCapability;
  routeTitle?: string;
  nodeTitle?: string;
  input?: string;
}): string {
  return fallbackBuildCapabilityOutputSummary(input);
}

export function buildCapabilityInvocationLogs(
  capability: BlueprintRuntimeCapability,
  outputSummary: string
): string[] {
  return fallbackBuildCapabilityInvocationLogs(capability, outputSummary);
}

export function deterministicCapabilityDuration(
  capability: BlueprintRuntimeCapability,
  request: BlueprintCapabilityInvocationRequest
): number {
  return fallbackDeterministicCapabilityDuration(capability, request);
}

function buildCapabilityEvidence(input: {
  job: BlueprintGenerationJob;
  capability: BlueprintRuntimeCapability;
  invocation: BlueprintCapabilityInvocation;
  routeSet?: BlueprintRouteSet;
  specTree?: BlueprintSpecTree;
  createdAt: string;
  tags: string[];
  roleBridgeOutput?: {
    structuredRoles: Record<string, unknown>;
    structuredRolesMeta: { digest: string; byteSize: number; summary: string };
  };
}): BlueprintCapabilityEvidence {
  const kind = mapCapabilityEvidenceKind(input.capability);
  const title = `Capability evidence: ${input.capability.label}`;
  const summary = `${input.capability.label} recorded ${kind} evidence for invocation ${input.invocation.id}.`;

  // Task 18.4 / 18.5: inherit the AIGC-spec-node / Docker / MCP bridge
  // provenance fields that land on the invocation side, and for the aigc
  // real path materialise the `structuredPayload` summary object using the
  // internal `__aigcStructuredPayloadRef` breadcrumb the bridge attached.
  //
  // The side-field is read once here and then stripped so it does not leak
  // via downstream `JSON.stringify(invocation)` into artifact payloads or
  // event bus subscribers. Stripping keeps the public invocation shape
  // free of `__`-prefixed keys.
  const invocationProvenance = input.invocation.provenance;
  type StructuredPayloadRef = {
    digest: string;
    byteSize: number;
    summary: string;
  };
  const invocationWithSideField = input.invocation as unknown as {
    __aigcStructuredPayloadRef?: StructuredPayloadRef;
  };
  const structuredPayloadRef = invocationWithSideField.__aigcStructuredPayloadRef;
  if (structuredPayloadRef) {
    delete invocationWithSideField.__aigcStructuredPayloadRef;
  }

  return {
    id: createId("blueprint-capability-evidence"),
    jobId: input.job.id,
    invocationId: input.invocation.id,
    capabilityId: input.capability.id,
    capabilityLabel: input.capability.label,
    kind,
    status: "recorded",
    title,
    summary,
    createdAt: input.createdAt,
    routeSetId: input.routeSet?.id,
    routeId: input.invocation.routeId,
    specTreeId: input.specTree?.id,
    nodeId: input.invocation.nodeId,
    artifacts: [`${input.capability.adapter}:${input.invocation.id}`],
    logs: input.invocation.logs,
    tags: uniqueStrings([
      input.capability.kind,
      input.capability.securityLevel,
      ...input.capability.tags,
      ...input.tags,
    ]),
    payloadSummary: {
      id: input.invocation.id,
      capabilityId: input.capability.id,
      status: input.invocation.status,
      durationMs: input.invocation.durationMs,
      securityLevel: input.capability.securityLevel,
      evidenceKind: kind,
    },
    provenance: {
      jobId: input.job.id,
      projectId: input.job.projectId,
      sourceId: input.job.sourceId,
      routeSetId: input.routeSet?.id,
      routeId: input.invocation.routeId,
      specTreeId: input.specTree?.id,
      nodeId: input.invocation.nodeId,
      targetText: input.job.request.targetText,
      githubUrls: input.job.request.githubUrls ?? [],
      // Task 17.1 / 17.2：从 invocation.provenance 继承 docker bridge 的 5 个可选字段，
      // 既有字段一行不改。仅在字段存在时 spread，避免为非 docker capability 注入无意
      // 义的 undefined 字段；evidence 的 JSON 序列化形态对既有消费方保持等价
      // （design §4.10 / 需求 3.7 / 4.2 / 4.4）。
      ...(invocationProvenance.executionMode !== undefined
        ? { executionMode: invocationProvenance.executionMode }
        : {}),
      ...(invocationProvenance.containerId !== undefined
        ? { containerId: invocationProvenance.containerId }
        : {}),
      ...(invocationProvenance.artifactUrl !== undefined
        ? { artifactUrl: invocationProvenance.artifactUrl }
        : {}),
      ...(invocationProvenance.logDigest !== undefined
        ? { logDigest: invocationProvenance.logDigest }
        : {}),
      // —— autopilot-capability-bridge-mcp task 21 ——
      // Inherit the MCP bridge-specific provenance fields from the originating
      // invocation so evidence consumers (Artifact Replay, Agent Crew) can
      // display the real-vs-simulated badge / audit link without reaching
      // back to the invocation.
      ...(invocationProvenance.executionPath !== undefined
        ? { executionPath: invocationProvenance.executionPath }
        : {}),
      ...(invocationProvenance.repoUrl !== undefined
        ? { repoUrl: invocationProvenance.repoUrl }
        : {}),
      ...(invocationProvenance.commitSha !== undefined
        ? { commitSha: invocationProvenance.commitSha }
        : {}),
      ...(invocationProvenance.fetchedAt !== undefined
        ? { fetchedAt: invocationProvenance.fetchedAt }
        : {}),
      ...(invocationProvenance.defaultBranch !== undefined
        ? { defaultBranch: invocationProvenance.defaultBranch }
        : {}),
      ...(invocationProvenance.apiResponseDigest !== undefined
        ? { apiResponseDigest: invocationProvenance.apiResponseDigest }
        : {}),
      ...(invocationProvenance.mcpToolName !== undefined
        ? { mcpToolName: invocationProvenance.mcpToolName }
        : {}),
      // —— autopilot-capability-bridge-aigc-node task 18.4 / 18.5 ——
      // Inherit optional bridge-provided aigc-spec-node provenance fields.
      ...(invocationProvenance.promptId !== undefined
        ? { promptId: invocationProvenance.promptId }
        : {}),
      ...(invocationProvenance.model !== undefined
        ? { model: invocationProvenance.model }
        : {}),
      ...(invocationProvenance.responseDigest !== undefined
        ? { responseDigest: invocationProvenance.responseDigest }
        : {}),
      ...(invocationProvenance.tokenCount !== undefined
        ? { tokenCount: invocationProvenance.tokenCount }
        : {}),
      ...(invocationProvenance.structuredPayloadDigest !== undefined
        ? { structuredPayloadDigest: invocationProvenance.structuredPayloadDigest }
        : {}),
      ...(invocationProvenance.promptFingerprint !== undefined
        ? { promptFingerprint: invocationProvenance.promptFingerprint }
        : {}),
      // Task 18.5: materialise structuredPayload for aigc-spec-node real
      // path. Only when the bridge attached a ref AND the invocation is in
      // real execution mode — fallback path stays undefined.
      ...(structuredPayloadRef &&
      input.capability.id === "aigc-spec-node" &&
      invocationProvenance.executionMode === "real"
        ? { structuredPayload: structuredPayloadRef }
        : {}),
      ...(invocationProvenance.error !== undefined
        ? { error: invocationProvenance.error }
        : {}),
      // —— autopilot-capability-bridge-role task 21.2 / 21.3 / 21.4 ——
      // Inherit primaryRouteId and roleCount from invocation provenance.
      ...(invocationProvenance.primaryRouteId !== undefined
        ? { primaryRouteId: invocationProvenance.primaryRouteId }
        : {}),
      ...(invocationProvenance.roleCount !== undefined
        ? { roleCount: invocationProvenance.roleCount }
        : {}),
      // Task 21.3: materialise structuredRoles for role-system-architecture
      // real path. Only when roleBridgeOutput is provided AND the invocation
      // is in real execution mode.
      ...(input.roleBridgeOutput &&
      input.capability.id === "role-system-architecture" &&
      invocationProvenance.executionMode === "real"
        ? {
            structuredRoles: {
              digest: input.roleBridgeOutput.structuredRolesMeta.digest,
              byteSize: input.roleBridgeOutput.structuredRolesMeta.byteSize,
              summary: input.roleBridgeOutput.structuredRolesMeta.summary,
              payload: input.roleBridgeOutput.structuredRoles as any,
            },
          }
        : {}),
    },
  };
}

function mapCapabilityEvidenceKind(
  capability: BlueprintRuntimeCapability
): BlueprintCapabilityEvidence["kind"] {
  if (capability.kind === "docker") return "log";
  if (capability.kind === "skill") return "diagram";
  if (capability.kind === "mcp") return "document";
  if (capability.kind === "role") return "safety";
  return "analysis";
}

function filterCapabilityInvocations(
  invocations: BlueprintCapabilityInvocation[],
  filters: BlueprintFetchCapabilityInvocationsRequest
): BlueprintCapabilityInvocation[] {
  return invocations.filter(invocation => {
    if (filters.capabilityId && invocation.capabilityId !== filters.capabilityId) {
      return false;
    }
    if (filters.nodeId && invocation.nodeId !== filters.nodeId) {
      return false;
    }
    if (filters.routeId && invocation.routeId !== filters.routeId) {
      return false;
    }
    return true;
  });
}

function filterCapabilityEvidence(
  evidence: BlueprintCapabilityEvidence[],
  filters: BlueprintFetchCapabilityEvidenceRequest
): BlueprintCapabilityEvidence[] {
  return evidence.filter(item => {
    if (filters.capabilityId && item.capabilityId !== filters.capabilityId) {
      return false;
    }
    if (filters.nodeId && item.nodeId !== filters.nodeId) {
      return false;
    }
    if (filters.routeId && item.routeId !== filters.routeId) {
      return false;
    }
    return true;
  });
}

type RecordEngineeringRunResult =
  | {
      ok: true;
      response: BlueprintRecordEngineeringRunResponse;
    }
  | { ok: false; status: number; error: string; message: string };

function recordEngineeringRun(
  job: BlueprintGenerationJob,
  request: BlueprintRecordEngineeringRunRequest,
  options: CreateGenerationJobHelperOptions
): RecordEngineeringRunResult {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const landingPlan = extractEngineeringLandingPlans(job).find(
    plan => plan.id === request.landingPlanId
  );

  if (!landingPlan) {
    return {
      ok: false,
      status: 404,
      error: "Blueprint engineering landing plan not found.",
      message: `No engineering landing plan ${request.landingPlanId} exists in job ${job.id}.`,
    };
  }

  const requestedPromptPackageIds = request.promptPackageIds ?? [];
  const promptPackageIds =
    requestedPromptPackageIds.length > 0
      ? requestedPromptPackageIds.filter(promptPackageId =>
          landingPlan.promptPackageIds.includes(promptPackageId)
        )
      : landingPlan.promptPackageIds;

  if (
    requestedPromptPackageIds.length > 0 &&
    promptPackageIds.length !== requestedPromptPackageIds.length
  ) {
    return {
      ok: false,
      status: 400,
      error: "Invalid blueprint engineering run request.",
      message:
        "promptPackageIds must refer to implementation prompt packages used by the landing plan.",
    };
  }

  const capabilityInvocationIds = uniqueStrings(
    request.capabilityInvocationIds ?? []
  );
  const capabilityEvidenceIds = uniqueStrings(request.capabilityEvidenceIds ?? []);
  const knownInvocationIds = new Set(
    extractCapabilityInvocations(job).map(invocation => invocation.id)
  );
  const knownEvidenceIds = new Set(
    extractCapabilityEvidence(job).map(evidence => evidence.id)
  );

  if (capabilityInvocationIds.some(id => !knownInvocationIds.has(id))) {
    return {
      ok: false,
      status: 400,
      error: "Invalid blueprint engineering run request.",
      message:
        "capabilityInvocationIds must refer to capability invocations recorded in the job.",
    };
  }

  if (capabilityEvidenceIds.some(id => !knownEvidenceIds.has(id))) {
    return {
      ok: false,
      status: 400,
      error: "Invalid blueprint engineering run request.",
      message:
        "capabilityEvidenceIds must refer to capability evidence recorded in the job.",
    };
  }

  const status = request.status ?? "running";
  const startedAt =
    request.startedAt ??
    (status === "planned" ? undefined : request.completedAt ?? createdAt);
  const completedAt =
    request.completedAt ??
    (status === "passed" || status === "failed" || status === "blocked"
      ? createdAt
      : undefined);
  const summary =
    request.summary ??
    `Engineering run ${status} for ${landingPlan.title}.`;
  const engineeringRun: BlueprintEngineeringRun = {
    id: createId("blueprint-engineering-run"),
    jobId: job.id,
    landingPlanId: landingPlan.id,
    status,
    startedAt,
    completedAt,
    summary,
    logs: request.logs ?? [],
    verificationResults: request.verificationResults ?? [],
    changedFiles: request.changedFiles ?? [],
    promptPackageIds,
    capabilityInvocationIds,
    capabilityEvidenceIds,
    provenance: {
      jobId: job.id,
      projectId: job.projectId,
      sourceId: job.sourceId,
      targetText: job.request.targetText,
      githubUrls: job.request.githubUrls ?? [],
      landingPlanId: landingPlan.id,
      treeId: landingPlan.treeId,
      treeVersion: landingPlan.provenance.treeVersion,
      promptPackageIds,
      capabilityInvocationIds,
      capabilityEvidenceIds,
    },
  };
  const runArtifact: BlueprintGenerationArtifact = {
    id: createId("blueprint-artifact"),
    type: "engineering_run",
    title: `Engineering run: ${landingPlan.title}`,
    summary,
    createdAt,
    payload: engineeringRun,
  };
  const jobStatus = mapEngineeringRunStatusToJobStatus(status);
  const updatedJob: BlueprintGenerationJob = {
    ...job,
    status: jobStatus,
    stage: "engineering_landing",
    updatedAt: createdAt,
    completedAt:
      jobStatus === "completed" || jobStatus === "failed"
        ? completedAt ?? createdAt
        : job.completedAt,
    artifacts: job.artifacts.concat(runArtifact),
    events: job.events.concat(
      createGenerationEvent({
        jobId: job.id,
        stage: "engineering_landing",
        status: jobStatus,
        type: mapEngineeringRunStatusToEventType(status),
        message: `Recorded engineering run ${engineeringRun.status} for ${landingPlan.title}.`,
        occurredAt: createdAt,
        payload: {
          runId: engineeringRun.id,
          landingPlanId: landingPlan.id,
          status: engineeringRun.status,
          promptPackageIds,
          capabilityInvocationIds,
          capabilityEvidenceIds,
          changedFiles: engineeringRun.changedFiles,
          verificationResultCount: engineeringRun.verificationResults.length,
        },
      })
    ),
  };

  options.store.save(updatedJob);

  return {
    ok: true,
    response: {
      job: updatedJob,
      engineeringLandingPlan: landingPlan,
      engineeringRun,
    },
  };
}

/**
 * Merge LLM-rendered `(heading, body)` sections with the templated scaffold
 * sections produced by {@link buildImplementationPromptSections}.
 *
 * Merge semantics (design §4.7 + §5.2; spec task 16.7):
 * 1. Positional overlay — for the aligned prefix `min(rendered, scaffold)`
 *    copy the scaffold section structure and replace `title` / `content`
 *    with the LLM's `heading` / `body`. Scaffold-derived `id` / `kind` /
 *    `items` / `nodeIds` / `sourceDocumentIds` / `sourcePreviewIds` are
 *    preserved so downstream consumers of
 *    {@link BlueprintImplementationPromptSection} keep working.
 * 2. Extra LLM sections — when `renderedSections.length > scaffoldSections.length`
 *    emit a fresh `"implementation"`-kind section for each extra entry,
 *    carrying the full node / document / preview ids so the section can
 *    still anchor to the source bundle.
 * 3. Extra scaffold sections — when `scaffoldSections.length > renderedSections.length`
 *    preserve the remaining scaffold sections verbatim; this keeps the
 *    templated `constraints` / `verification` / `handoff` kinds intact
 *    even when the LLM only covered the leading narrative sections.
 * 4. Reusable Prompts aggregate — when `renderedPrompts` is non-empty
 *    append a final `"implementation"`-kind `"Reusable Prompts"` section
 *    whose `items[]` persist the prompt asset list one-to-one. The
 *    aggregate section body is a short Markdown bullet list pointing at
 *    each prompt id.
 */
function mergeLlmSectionsWithScaffolds(input: {
  renderedSections: Array<{ heading: string; body: string }>;
  renderedPrompts: ReadonlyArray<{
    id: string;
    title: string;
    systemPrompt: string;
    userPrompt: string;
    variables: ReadonlyArray<{
      name: string;
      description: string;
      required: boolean;
    }>;
    examples: ReadonlyArray<{
      title?: string;
      input?: string;
      output?: string;
    }>;
  }>;
  scaffoldSections: BlueprintImplementationPromptSection[];
  nodeIds: string[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
}): BlueprintImplementationPromptSection[] {
  const {
    renderedSections,
    renderedPrompts,
    scaffoldSections,
    nodeIds,
    sourceDocumentIds,
    sourcePreviewIds,
  } = input;

  const alignedLength = Math.min(
    renderedSections.length,
    scaffoldSections.length
  );
  const merged: BlueprintImplementationPromptSection[] = [];

  // (1) Positional overlay — LLM heading/body replace scaffold title/content.
  for (let index = 0; index < alignedLength; index += 1) {
    const scaffold = scaffoldSections[index];
    const llmSection = renderedSections[index];
    merged.push({
      ...scaffold,
      title: llmSection.heading,
      content: llmSection.body,
    });
  }

  // (3) Preserve any scaffold sections beyond what the LLM produced so the
  // fallback-only kinds (constraints / verification / handoff) do not vanish.
  for (
    let index = alignedLength;
    index < scaffoldSections.length;
    index += 1
  ) {
    merged.push(scaffoldSections[index]);
  }

  // (2) Append fresh implementation-kind sections for any LLM sections that
  // exceed the scaffold count.
  for (let index = alignedLength; index < renderedSections.length; index += 1) {
    const llmSection = renderedSections[index];
    merged.push({
      id: createId("blueprint-prompt-section"),
      kind: "implementation",
      title: llmSection.heading,
      content: llmSection.body,
      items: [],
      nodeIds,
      sourceDocumentIds,
      sourcePreviewIds,
    });
  }

  // (4) Reusable Prompts aggregate section — only when the LLM actually
  // returned prompt assets.
  if (renderedPrompts.length > 0) {
    const items: BlueprintImplementationPromptItem[] = renderedPrompts.map(
      prompt => ({
        id: createId("blueprint-prompt-item"),
        kind: "instruction",
        title: prompt.title,
        content: `${prompt.systemPrompt}\n\n${prompt.userPrompt}`,
        nodeIds,
        sourceDocumentIds,
        sourcePreviewIds,
      })
    );
    const bullets = renderedPrompts
      .map(prompt => `- **${prompt.title}** (id: \`${prompt.id}\`)`)
      .join("\n");
    merged.push({
      id: createId("blueprint-prompt-section"),
      kind: "implementation",
      title: "Reusable Prompts",
      content: bullets,
      items,
      nodeIds,
      sourceDocumentIds,
      sourcePreviewIds,
    });
  }

  return merged;
}

async function buildImplementationPromptPackage(
  ctx: BlueprintServiceContext,
  input: {
    job: BlueprintGenerationJob;
    specTree: BlueprintSpecTree;
    targetPlatform: BlueprintImplementationPromptTargetPlatform;
    nodes: BlueprintSpecTreeNode[];
    documents: BlueprintSpecDocument[];
    previews: BlueprintEffectPreview[];
    includeDrafts: boolean;
    includePreviewDrafts: boolean;
    createdAt: string;
    clarificationSession?: BlueprintClarificationSession;
    domainContext?: BlueprintProjectDomainContext;
    primaryRoute?: BlueprintRouteCandidate;
    capabilityInvocations?: BlueprintCapabilityInvocation[];
    capabilityEvidence?: BlueprintCapabilityEvidence[];
  }
): Promise<BlueprintImplementationPromptPackage> {
  const nodeIds = uniqueStrings(input.nodes.map(node => node.id));
  const sourceDocumentIds = input.documents.map(document => document.id);
  const sourcePreviewIds = input.previews.map(preview => preview.id);
  const target = buildImplementationPromptTarget(input.targetPlatform);

  // Templated title / summary / sections remain byte-identical to today so the
  // fallback and template paths stay backwards compatible (design §D3 / §8.3).
  const templatedTitle = `Implementation prompt package: ${target.label}`;
  const templatedSummary =
    input.previews.length > 0
      ? `Implementation prompt package for ${target.label} using SPEC documents and effect previews.`
      : `Document-only implementation prompt package for ${target.label}.`;
  const templatedSections = buildImplementationPromptSections({
    job: input.job,
    specTree: input.specTree,
    target,
    nodes: input.nodes,
    documents: input.documents,
    previews: input.previews,
    nodeIds,
    sourceDocumentIds,
    sourcePreviewIds,
  });

  const llmOutput = await ctx.promptPackageLlmService?.({
    jobId: input.job.id,
    job: input.job,
    specTree: input.specTree,
    targetPlatform: input.targetPlatform,
    nodes: input.nodes,
    sourceDocuments: input.documents,
    sourcePreviews: input.previews,
    primaryRoute: input.primaryRoute,
    clarificationSession: input.clarificationSession,
    domainContext: input.domainContext,
    capabilityInvocations: input.capabilityInvocations,
    capabilityEvidence: input.capabilityEvidence,
    includeDrafts: input.includeDrafts,
    includePreviewDrafts: input.includePreviewDrafts,
    createdAt: input.createdAt,
  });

  let title: string;
  let summary: string;
  let content: string;
  let sections: BlueprintImplementationPromptSection[];
  let provenanceExtras: {
    generationSource?: "llm" | "llm_fallback" | "template";
    promptId?: string;
    model?: string;
    responseDigest?: string;
    structuredPayloadDigest?: string;
    promptFingerprint?: string;
    error?: string;
  };

  if (
    llmOutput?.generationSource === "llm" &&
    llmOutput.renderedTitle !== undefined &&
    llmOutput.renderedSummary !== undefined &&
    llmOutput.renderedContent !== undefined &&
    llmOutput.renderedSections !== undefined
  ) {
    title = llmOutput.renderedTitle;
    summary = llmOutput.renderedSummary;
    content = llmOutput.renderedContent;
    sections = mergeLlmSectionsWithScaffolds({
      renderedSections: llmOutput.renderedSections,
      renderedPrompts: llmOutput.renderedPrompts ?? [],
      scaffoldSections: templatedSections,
      nodeIds,
      sourceDocumentIds,
      sourcePreviewIds,
    });
    provenanceExtras = {
      generationSource: "llm",
      ...(llmOutput.promptId !== undefined && { promptId: llmOutput.promptId }),
      ...(llmOutput.model !== undefined && { model: llmOutput.model }),
      ...(llmOutput.responseDigest !== undefined && {
        responseDigest: llmOutput.responseDigest,
      }),
      ...(llmOutput.structuredPayloadDigest !== undefined && {
        structuredPayloadDigest: llmOutput.structuredPayloadDigest,
      }),
      ...(llmOutput.promptFingerprint !== undefined && {
        promptFingerprint: llmOutput.promptFingerprint,
      }),
    };
  } else {
    title = templatedTitle;
    summary = templatedSummary;
    sections = templatedSections;
    content = renderImplementationPromptContent({
      title,
      target,
      sections,
      sourceDocumentIds,
      sourcePreviewIds,
    });
    provenanceExtras = {
      generationSource: llmOutput?.generationSource ?? "template",
      ...(llmOutput?.promptId !== undefined && {
        promptId: llmOutput.promptId,
      }),
      ...(llmOutput?.model !== undefined && { model: llmOutput.model }),
      ...(llmOutput?.promptFingerprint !== undefined && {
        promptFingerprint: llmOutput.promptFingerprint,
      }),
      ...(llmOutput?.error !== undefined && { error: llmOutput.error }),
    };
  }

  return {
    id: createId("blueprint-prompt-package"),
    jobId: input.job.id,
    treeId: input.specTree.id,
    nodeIds,
    sourceDocumentIds,
    sourcePreviewIds,
    targetPlatform: input.targetPlatform,
    target,
    title,
    summary,
    content,
    sections,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    provenance: {
      jobId: input.job.id,
      projectId: input.job.projectId,
      sourceId: input.job.sourceId,
      targetText: input.job.request.targetText,
      githubUrls: input.job.request.githubUrls ?? [],
      treeVersion: input.specTree.version,
      nodeIds,
      sourceDocumentIds,
      sourcePreviewIds,
      targetPlatform: input.targetPlatform,
      sourceDocumentStatus: resolvePromptDocumentSourceStatus(input.documents),
      sourcePreviewStatus: resolvePromptPreviewSourceStatus(input.previews),
      includeDrafts: input.includeDrafts,
      includePreviewDrafts: input.includePreviewDrafts,
      sourceDocumentStatuses: Object.fromEntries(
        input.documents.map(document => [
          document.id,
          normalizeSpecDocumentStatus(document.status),
        ])
      ),
      sourcePreviewStatuses: Object.fromEntries(
        input.previews.map(preview => [preview.id, preview.status])
      ),
      ...provenanceExtras,
    },
  };
}

async function buildEngineeringLandingPlan(
  ctx: BlueprintServiceContext,
  input: {
    job: BlueprintGenerationJob;
    specTree: BlueprintSpecTree;
    promptPackage: BlueprintImplementationPromptPackage;
    sourceDocuments: BlueprintSpecDocument[];
    sourcePreviews: BlueprintEffectPreview[];
    createdAt: string;
    clarificationSession?: BlueprintClarificationSession;
    domainContext?: BlueprintProjectDomainContext;
    selectedRoute?: BlueprintRouteCandidate;
    capabilityInvocations?: BlueprintCapabilityInvocation[];
    capabilityEvidence?: BlueprintCapabilityEvidence[];
  }
): Promise<BlueprintEngineeringLandingPlan> {
  const sourceNodeIds = uniqueStrings(input.promptPackage.nodeIds);
  const sourceDocumentIds = uniqueStrings(input.promptPackage.sourceDocumentIds);
  const sourcePreviewIds = uniqueStrings(input.promptPackage.sourcePreviewIds);
  const promptPackageIds = [input.promptPackage.id];
  const sourceNodes = input.specTree.nodes.filter(node =>
    sourceNodeIds.includes(node.id)
  );
  const sourceDocuments = input.sourceDocuments.filter(document =>
    sourceDocumentIds.includes(document.id)
  );
  const sourcePreviews = input.sourcePreviews.filter(preview =>
    sourcePreviewIds.includes(preview.id)
  );
  const verificationCommands = buildEngineeringLandingVerificationCommands();
  const status = resolveEngineeringLandingPlanStatus(input.promptPackage);

  // Attempt LLM service per-plan. The service's tier-1/tier-2 early exits
  // ensure default deployments return { generationSource: "template" } without
  // any LLM traffic (design §4.6 + §2.D10).
  const serviceResult = await ctx.engineeringHandoffLlmService?.({
    jobId: input.job.id,
    job: input.job,
    specTree: input.specTree,
    promptPackage: input.promptPackage,
    sourceNodes,
    sourceDocuments,
    sourcePreviews,
    selectedRoute: input.selectedRoute,
    clarificationSession: input.clarificationSession,
    domainContext: input.domainContext,
    capabilityInvocations: input.capabilityInvocations,
    capabilityEvidence: input.capabilityEvidence,
    status,
    createdAt: input.createdAt,
  });

  const templateSteps = buildEngineeringLandingSteps({
    promptPackage: input.promptPackage,
    status,
    sourceNodeIds,
    sourceDocumentIds,
    sourcePreviewIds,
    promptPackageIds,
    verificationCommands,
  });
  const templateHandoff = buildEngineeringPlatformHandoff({
    promptPackage: input.promptPackage,
    sourceNodes,
    sourceDocumentIds,
    sourcePreviewIds,
    steps: templateSteps,
    verificationCommands,
  });
  const targetLabel = input.promptPackage.target.label;
  const sourceNodeTitle =
    sourceNodes.length === 1
      ? sourceNodes[0].title
      : `${sourceNodes.length} source node(s)`;
  const templateTitle = `Engineering landing plan: ${targetLabel}`;
  const templateSummary = `Land ${input.promptPackage.title} for ${targetLabel} using ${sourceNodeTitle}, ${sourceDocumentIds.length} SPEC document(s), and ${sourcePreviewIds.length} effect preview(s).`;

  let title = templateTitle;
  let summary = templateSummary;
  let steps = templateSteps;
  let handoffs = [templateHandoff];
  let provenanceExtras: Record<string, unknown> = {
    generationSource: "template" as const,
  };

  if (serviceResult?.generationSource === "llm") {
    title = serviceResult.renderedTitle ?? title;
    summary = serviceResult.renderedSummaryWithMissionPrefix ?? summary;
    if (serviceResult.renderedSteps) {
      steps = serviceResult.renderedSteps.map(renderedStep => ({
        id: renderedStep.id.length > 0
          ? renderedStep.id
          : createId("blueprint-engineering-step"),
        title: renderedStep.title,
        summary: renderedStep.summary,
        mode: renderedStep.mode,
        sourceNodeIds:
          renderedStep.sourceNodeIds.length > 0
            ? [...renderedStep.sourceNodeIds]
            : sourceNodeIds,
        sourceDocumentIds:
          renderedStep.sourceDocumentIds.length > 0
            ? [...renderedStep.sourceDocumentIds]
            : sourceDocumentIds,
        sourcePreviewIds:
          renderedStep.sourcePreviewIds.length > 0
            ? [...renderedStep.sourcePreviewIds]
            : sourcePreviewIds,
        promptPackageIds:
          renderedStep.promptPackageIds.length > 0
            ? [...renderedStep.promptPackageIds]
            : promptPackageIds,
        fileScopes:
          renderedStep.fileScopes.length > 0
            ? [...renderedStep.fileScopes]
            : buildEngineeringLandingFileScopes(renderedStep.mode),
        verificationCommands:
          renderedStep.verificationCommands.length > 0
            ? [...renderedStep.verificationCommands]
            : verificationCommands,
        riskLevel: renderedStep.riskLevel,
      }));
    }
    if (serviceResult.renderedHandoffs && serviceResult.renderedHandoffs.length > 0) {
      const renderedHandoff = serviceResult.renderedHandoffs[0];
      const baseContent = templateHandoff.content;
      const { renderEngineeringHandoffContent } = await import(
        "./blueprint/engineering-handoff/render.js"
      );
      const policy =
        ctx.engineeringHandoffLlmPolicy ??
        (await import("./blueprint/engineering-handoff/policy.js")).createDefaultEngineeringHandoffLlmPolicy();
      handoffs = [
        {
          ...templateHandoff,
          summary: renderedHandoff.summary ?? templateHandoff.summary,
          content: renderEngineeringHandoffContent({
            basePlatformContent: baseContent,
            acceptanceCriteria: [...(serviceResult.acceptanceCriteria ?? [])],
            riskNotes: [...(serviceResult.riskNotes ?? [])],
            policy,
          }),
        },
      ];
    }
    provenanceExtras = {
      generationSource: "llm" as const,
      promptId: serviceResult.promptId,
      model: serviceResult.model,
      responseDigest: serviceResult.responseDigest,
      structuredPayloadDigest: serviceResult.structuredPayloadDigest,
      promptFingerprint: serviceResult.promptFingerprint,
    };
  } else if (serviceResult?.generationSource === "llm_fallback") {
    provenanceExtras = {
      generationSource: "llm_fallback" as const,
      promptId: serviceResult.promptId,
      model: serviceResult.model,
      promptFingerprint: serviceResult.promptFingerprint,
      error: serviceResult.error,
    };
  }

  return {
    id: createId("blueprint-engineering-plan"),
    jobId: input.job.id,
    treeId: input.specTree.id,
    status,
    title,
    summary,
    promptPackageIds,
    steps,
    handoffs,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    provenance: {
      jobId: input.job.id,
      projectId: input.job.projectId,
      sourceId: input.job.sourceId,
      targetText: input.job.request.targetText,
      githubUrls: input.job.request.githubUrls ?? [],
      treeVersion: input.specTree.version,
      promptPackageIds,
      sourceNodeIds,
      sourceDocumentIds,
      sourcePreviewIds,
      sourceDocumentStatus: input.promptPackage.provenance.sourceDocumentStatus,
      sourcePreviewStatus: input.promptPackage.provenance.sourcePreviewStatus,
      sourceDocumentStatuses: buildEngineeringSourceDocumentStatuses(
        input.promptPackage,
        sourceDocuments,
        sourceDocumentIds
      ),
      sourcePreviewStatuses: buildEngineeringSourcePreviewStatuses(
        input.promptPackage,
        sourcePreviews,
        sourcePreviewIds
      ),
      promptPackagePlatforms: {
        [input.promptPackage.id]: input.promptPackage.targetPlatform,
      },
      ...provenanceExtras,
    },
  };
}

function buildEngineeringLandingSteps(input: {
  promptPackage: BlueprintImplementationPromptPackage;
  status: BlueprintEngineeringLandingPlanStatus;
  sourceNodeIds: string[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
  promptPackageIds: string[];
  verificationCommands: string[];
}): BlueprintEngineeringLandingStep[] {
  const steps: Array<{
    mode: BlueprintEngineeringLandingStepMode;
    title: string;
    summary: string;
  }> = [
    {
      mode: "automatic",
      title: "Bind landing sources",
      summary: `Attach ${input.promptPackage.title} to its source nodes, SPEC documents, effect previews, and platform prompt package.`,
    },
    {
      mode: "manual",
      title: "Apply repository bridge",
      summary:
        "Update the shared contracts and blueprint router so engineering plans and runs are durable job artifacts.",
    },
    {
      mode: "handoff",
      title: "Capture run evidence",
      summary:
        "Record verification results, changed files, logs, and platform handoff evidence against the landing plan.",
    },
  ];

  return steps.map(step => ({
    id: createId("blueprint-engineering-step"),
    title: step.title,
    summary: step.summary,
    mode: step.mode,
    sourceNodeIds: input.sourceNodeIds,
    sourceDocumentIds: input.sourceDocumentIds,
    sourcePreviewIds: input.sourcePreviewIds,
    promptPackageIds: input.promptPackageIds,
    fileScopes: buildEngineeringLandingFileScopes(step.mode),
    verificationCommands: input.verificationCommands,
    riskLevel: resolveEngineeringStepRiskLevel(input.status, step.mode),
  }));
}

function buildEngineeringPlatformHandoff(input: {
  promptPackage: BlueprintImplementationPromptPackage;
  sourceNodes: BlueprintSpecTreeNode[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
  steps: BlueprintEngineeringLandingStep[];
  verificationCommands: string[];
}): BlueprintPlatformHandoff {
  const title = `Platform handoff: ${input.promptPackage.target.label}`;
  const summary = `Use ${input.promptPackage.title} to execute the engineering landing plan and return run evidence.`;

  return {
    id: createId("blueprint-platform-handoff"),
    platform: input.promptPackage.targetPlatform,
    title,
    summary,
    content: renderEngineeringPlatformHandoff({
      title,
      summary,
      promptPackage: input.promptPackage,
      sourceNodes: input.sourceNodes,
      sourceDocumentIds: input.sourceDocumentIds,
      sourcePreviewIds: input.sourcePreviewIds,
      steps: input.steps,
      verificationCommands: input.verificationCommands,
    }),
    promptPackageId: input.promptPackage.id,
    sourceNodeIds: uniqueStrings(input.promptPackage.nodeIds),
    verificationCommands: input.verificationCommands,
  };
}

function buildImplementationPromptTarget(
  platform: BlueprintImplementationPromptTargetPlatform
): BlueprintImplementationPromptTarget {
  if (platform === "codex") {
    return {
      platform,
      label: "Codex",
      executionMode: "agent",
      guidance:
        "Use this as an implementation task. Inspect the repository first, make focused edits, run verification, and summarize changed files.",
    };
  }

  if (platform === "claude") {
    return {
      platform,
      label: "Claude",
      executionMode: "chat",
      guidance:
        "Use the full context to reason through implementation order, risks, and handoff notes before applying changes in the target workspace.",
    };
  }

  if (platform === "cursor") {
    return {
      platform,
      label: "Cursor",
      executionMode: "workspace",
      guidance:
        "Use the source bindings to scope file search, make incremental code edits, and keep the implementation aligned with accepted SPEC assets.",
    };
  }

  if (platform === "kiro") {
    return {
      platform,
      label: "Kiro",
      executionMode: "workspace",
      guidance:
        "Use this prompt with SPEC-first workflow context and preserve traceability back to requirements, design, tasks, and preview artifacts.",
    };
  }

  if (platform === "trae") {
    return {
      platform,
      label: "Trae",
      executionMode: "workspace",
      guidance:
        "Use this as a workspace coding brief with explicit source assets, implementation steps, and verification expectations.",
    };
  }

  return {
    platform,
    label: "Windsurf",
    executionMode: "workspace",
    guidance:
      "Use this as an agentic coding flow. Keep changes scoped to the source nodes and report verification evidence.",
  };
}

function buildImplementationPromptSections(input: {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  target: BlueprintImplementationPromptTarget;
  nodes: BlueprintSpecTreeNode[];
  documents: BlueprintSpecDocument[];
  previews: BlueprintEffectPreview[];
  nodeIds: string[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
}): BlueprintImplementationPromptSection[] {
  const contextItems: BlueprintImplementationPromptItem[] = input.nodes.map(
    node => ({
      id: createId("blueprint-prompt-item"),
      kind: "source",
      title: node.title,
      content: `${node.summary} Outputs: ${
        node.outputs.length > 0 ? node.outputs.join(", ") : "none"
      }.`,
      nodeIds: [node.id],
      sourceDocumentIds: input.documents
        .filter(document => document.nodeId === node.id)
        .map(document => document.id),
      sourcePreviewIds: input.previews
        .filter(preview => preview.nodeId === node.id)
        .map(preview => preview.id),
    })
  );
  const implementationItems: BlueprintImplementationPromptItem[] =
    input.documents.map(document => ({
      id: createId("blueprint-prompt-item"),
      kind: "instruction",
      title: document.title,
      content: document.content,
      nodeIds: [document.nodeId],
      sourceDocumentIds: [document.id],
      sourcePreviewIds: [],
    }));
  const previewItems: BlueprintImplementationPromptItem[] =
    input.previews.flatMap(preview =>
      [
        {
          title: `Effect preview: ${preview.provenance.nodeTitle}`,
          content: preview.summary,
        },
        ...preview.architectureNotes.map((note, index) => ({
          title: `Architecture note ${index + 1}`,
          content: note,
        })),
        ...preview.progressPlan.map(milestone => ({
          title: `Milestone: ${milestone.title}`,
          content: `${milestone.summary} Target: ${milestone.target}.`,
        })),
      ].map(item => ({
        id: createId("blueprint-prompt-item"),
        kind: "note" as const,
        title: item.title,
        content: item.content,
        nodeIds: [preview.nodeId],
        sourceDocumentIds: [...preview.sourceDocumentIds],
        sourcePreviewIds: [preview.id],
      }))
    );
  const verificationItems = buildImplementationVerificationItems(input);

  return [
    {
      id: createId("blueprint-prompt-section"),
      kind: "context",
      title: "Project Context",
      content: [
        `Target: ${summarizeRequestTarget(input.job.request)}`,
        `Tree: ${input.specTree.id} v${input.specTree.version}`,
        `Platform guidance: ${input.target.guidance}`,
      ].join("\n"),
      items: contextItems,
      nodeIds: input.nodeIds,
      sourceDocumentIds: input.sourceDocumentIds,
      sourcePreviewIds: input.sourcePreviewIds,
    },
    {
      id: createId("blueprint-prompt-section"),
      kind: "implementation",
      title: "Implementation Brief",
      content:
        "Implement the accepted SPEC scope. Preserve source intent, keep changes focused, and use the linked documents as the canonical requirements, design, and task list.",
      items: implementationItems.concat(previewItems),
      nodeIds: input.nodeIds,
      sourceDocumentIds: input.sourceDocumentIds,
      sourcePreviewIds: input.sourcePreviewIds,
    },
    {
      id: createId("blueprint-prompt-section"),
      kind: "constraints",
      title: "Constraints",
      content:
        "Do not expand scope beyond the selected SPEC nodes. Keep provenance visible in summaries and call out missing previews when implementation risk changes.",
      items: input.nodes.map(node => ({
        id: createId("blueprint-prompt-item"),
        kind: "constraint",
        title: `Scope: ${node.title}`,
        content:
          node.dependencies.length > 0
            ? `Respect dependencies: ${node.dependencies.join(", ")}.`
            : "No explicit upstream dependencies are recorded.",
        nodeIds: [node.id],
        sourceDocumentIds: input.documents
          .filter(document => document.nodeId === node.id)
          .map(document => document.id),
        sourcePreviewIds: input.previews
          .filter(preview => preview.nodeId === node.id)
          .map(preview => preview.id),
      })),
      nodeIds: input.nodeIds,
      sourceDocumentIds: input.sourceDocumentIds,
      sourcePreviewIds: input.sourcePreviewIds,
    },
    {
      id: createId("blueprint-prompt-section"),
      kind: "verification",
      title: "Verification Plan",
      content:
        "Run the narrowest meaningful checks for the touched code, then report commands, outcomes, residual risk, and any source asset drift.",
      items: verificationItems,
      nodeIds: input.nodeIds,
      sourceDocumentIds: input.sourceDocumentIds,
      sourcePreviewIds: input.sourcePreviewIds,
    },
    {
      id: createId("blueprint-prompt-section"),
      kind: "handoff",
      title: "Handoff",
      content:
        "Return changed files, verification evidence, and notes that can be written back to the source SPEC nodes and preview artifacts.",
      items: [
        {
          id: createId("blueprint-prompt-item"),
          kind: "note",
          title: "Source bindings",
          content: `Documents: ${input.sourceDocumentIds.join(", ")}. Previews: ${
            input.sourcePreviewIds.length > 0
              ? input.sourcePreviewIds.join(", ")
              : "none"
          }.`,
          nodeIds: input.nodeIds,
          sourceDocumentIds: input.sourceDocumentIds,
          sourcePreviewIds: input.sourcePreviewIds,
        },
      ],
      nodeIds: input.nodeIds,
      sourceDocumentIds: input.sourceDocumentIds,
      sourcePreviewIds: input.sourcePreviewIds,
    },
  ];
}

function buildImplementationVerificationItems(input: {
  documents: BlueprintSpecDocument[];
  previews: BlueprintEffectPreview[];
}): BlueprintImplementationPromptItem[] {
  const taskItems: BlueprintImplementationPromptItem[] = input.documents
    .filter(document => document.type === "tasks")
    .map(document => ({
      id: createId("blueprint-prompt-item"),
      kind: "verification" as const,
      title: `Verify task document: ${document.title}`,
      content:
        "Confirm each task-level implementation step is either completed, deferred with reason, or converted into a follow-up.",
      nodeIds: [document.nodeId],
      sourceDocumentIds: [document.id],
      sourcePreviewIds: [],
    }));
  const previewItems: BlueprintImplementationPromptItem[] = input.previews.flatMap(
    preview =>
    preview.progressPlan.map(milestone => ({
      id: createId("blueprint-prompt-item"),
      kind: "verification" as const,
      title: `Validate milestone: ${milestone.title}`,
      content: `${milestone.summary} Target: ${milestone.target}.`,
      nodeIds: [preview.nodeId],
      sourceDocumentIds: [...milestone.sourceDocumentIds],
      sourcePreviewIds: [preview.id],
    }))
  );

  if (taskItems.length > 0 || previewItems.length > 0) {
    return taskItems.concat(previewItems);
  }

  return [
    {
      id: createId("blueprint-prompt-item"),
      kind: "verification",
      title: "Run focused checks",
      content:
        "Run relevant unit tests, type checks, lint, or build commands for the implementation surface.",
      nodeIds: [],
      sourceDocumentIds: [],
      sourcePreviewIds: [],
    },
  ];
}

function renderImplementationPromptContent(input: {
  title: string;
  target: BlueprintImplementationPromptTarget;
  sections: BlueprintImplementationPromptSection[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
}): string {
  const lines = [
    `# ${input.title}`,
    "",
    `Target platform: ${input.target.label}`,
    `Execution mode: ${input.target.executionMode}`,
    `Source documents: ${input.sourceDocumentIds.join(", ")}`,
    `Source previews: ${
      input.sourcePreviewIds.length > 0
        ? input.sourcePreviewIds.join(", ")
        : "none"
    }`,
    "",
  ];

  for (const section of input.sections) {
    lines.push(`## ${section.title}`, "", section.content, "");
    for (const item of section.items) {
      lines.push(`### ${item.title}`, "", item.content, "");
    }
  }

  return lines.join("\n").trim();
}

function renderEngineeringPlatformHandoff(input: {
  title: string;
  summary: string;
  promptPackage: BlueprintImplementationPromptPackage;
  sourceNodes: BlueprintSpecTreeNode[];
  sourceDocumentIds: string[];
  sourcePreviewIds: string[];
  steps: BlueprintEngineeringLandingStep[];
  verificationCommands: string[];
}): string {
  const sourceNodeLines =
    input.sourceNodes.length > 0
      ? input.sourceNodes.map(node => `- ${node.title} (${node.id})`)
      : ["- none"];
  const stepLines = input.steps.map(
    step =>
      `- ${step.title} [${step.mode}, ${step.riskLevel} risk]: ${step.summary}`
  );
  const fileScopeLines = uniqueStrings(
    input.steps.flatMap(step => step.fileScopes)
  ).map(scope => `- ${scope}`);
  const verificationLines = input.verificationCommands.map(
    command => `- ${command}`
  );

  return [
    `# ${input.title}`,
    "",
    input.summary,
    "",
    `Prompt package: ${input.promptPackage.id}`,
    `Target platform: ${input.promptPackage.target.label}`,
    `Execution mode: ${input.promptPackage.target.executionMode}`,
    "",
    "## Source Nodes",
    "",
    ...sourceNodeLines,
    "",
    "## Source Assets",
    "",
    `- SPEC documents: ${
      input.sourceDocumentIds.length > 0
        ? input.sourceDocumentIds.join(", ")
        : "none"
    }`,
    `- Effect previews: ${
      input.sourcePreviewIds.length > 0
        ? input.sourcePreviewIds.join(", ")
        : "none"
    }`,
    "",
    "## Landing Steps",
    "",
    ...stepLines,
    "",
    "## File Scopes",
    "",
    ...fileScopeLines,
    "",
    "## Verification",
    "",
    ...verificationLines,
  ].join("\n");
}

function buildEngineeringLandingVerificationCommands(): string[] {
  return [
    "node node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts",
  ];
}

function buildEngineeringLandingFileScopes(
  mode: BlueprintEngineeringLandingStepMode
): string[] {
  if (mode === "automatic") {
    return ["shared/blueprint/contracts.ts"];
  }

  if (mode === "manual") {
    return ["server/routes/blueprint.ts"];
  }

  return ["server/tests/blueprint-routes.test.ts"];
}

function resolveEngineeringLandingPlanStatus(
  promptPackage: BlueprintImplementationPromptPackage
): BlueprintEngineeringLandingPlanStatus {
  const documentStatus = promptPackage.provenance.sourceDocumentStatus;
  const previewStatus = promptPackage.provenance.sourcePreviewStatus;

  return documentStatus === "accepted" &&
    (previewStatus === "accepted" || previewStatus === "missing")
    ? "ready"
    : "draft";
}

function resolveEngineeringStepRiskLevel(
  planStatus: BlueprintEngineeringLandingPlanStatus,
  mode: BlueprintEngineeringLandingStepMode
): BlueprintEngineeringLandingRiskLevel {
  if (planStatus === "draft") {
    return mode === "automatic" ? "medium" : "high";
  }

  return mode === "automatic" ? "low" : "medium";
}

function buildEngineeringSourceDocumentStatuses(
  promptPackage: BlueprintImplementationPromptPackage,
  documents: BlueprintSpecDocument[],
  sourceDocumentIds: string[]
): Record<string, BlueprintSpecDocumentStatus> {
  const documentById = new Map(documents.map(document => [document.id, document]));

  return Object.fromEntries(
    sourceDocumentIds.map(documentId => {
      const document = documentById.get(documentId);
      const status = document
        ? normalizeSpecDocumentStatus(document.status)
        : promptPackage.provenance.sourceDocumentStatuses[documentId] ?? "draft";

      return [documentId, status];
    })
  );
}

function buildEngineeringSourcePreviewStatuses(
  promptPackage: BlueprintImplementationPromptPackage,
  previews: BlueprintEffectPreview[],
  sourcePreviewIds: string[]
): Record<string, BlueprintEffectPreviewStatus> {
  const previewById = new Map(previews.map(preview => [preview.id, preview]));

  return Object.fromEntries(
    sourcePreviewIds.map(previewId => {
      const preview = previewById.get(previewId);
      const status =
        preview?.status ??
        promptPackage.provenance.sourcePreviewStatuses[previewId] ??
        "preview";

      return [previewId, status];
    })
  );
}

function engineeringLandingPlanReplacementKey(
  plan: Pick<BlueprintEngineeringLandingPlan, "promptPackageIds">
): string {
  return plan.promptPackageIds.join("|");
}

function mapEngineeringRunStatusToJobStatus(
  status: BlueprintEngineeringRunStatus
): BlueprintGenerationStatus {
  if (status === "passed") {
    return "completed";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "running") {
    return "running";
  }

  return "reviewing";
}

function mapEngineeringRunStatusToEventType(
  status: BlueprintEngineeringRunStatus
): BlueprintGenerationEvent["type"] {
  if (status === "passed") {
    return "job.completed";
  }

  if (status === "failed") {
    return "job.failed";
  }

  return "job.stage";
}

function resolvePromptDocumentSourceStatus(
  documents: BlueprintSpecDocument[]
): BlueprintImplementationPromptSourceStatus {
  if (documents.length === 0) {
    return "missing";
  }

  const statuses = documents
    .map(document => normalizeSpecDocumentStatus(document.status))
    .filter(
      (
        status
      ): status is "accepted" | "draft" | "reviewing" =>
        status !== "rejected"
    );

  return statuses.length > 0 ? resolvePromptSourceStatus(statuses) : "missing";
}

function resolvePromptPreviewSourceStatus(
  previews: BlueprintEffectPreview[]
): BlueprintImplementationPromptSourceStatus {
  if (previews.length === 0) {
    return "missing";
  }

  return resolvePromptSourceStatus(
    previews.map(preview => preview.provenance.sourceStatus)
  );
}

function resolvePromptSourceStatus(
  statuses: Array<"accepted" | "draft" | "reviewing" | "mixed">
): BlueprintImplementationPromptSourceStatus {
  const uniqueStatuses = new Set(statuses);
  if (uniqueStatuses.size === 1) {
    return statuses[0];
  }

  return "mixed";
}

function isConsumableEffectPreviewVersion(
  preview: BlueprintEffectPreview
): boolean {
  const versionStatus =
    preview.versionStatus ?? preview.versionSync?.versionStatus ?? "current";
  return versionStatus === "current" || versionStatus === "accepted";
}

function promptPackageReplacementKey(
  promptPackage: Pick<
    BlueprintImplementationPromptPackage,
    "targetPlatform" | "nodeIds"
  >
): string {
  return `${promptPackage.targetPlatform}:${promptPackage.nodeIds.join("|")}`;
}

async function buildEffectPreview(
  ctx: BlueprintServiceContext,
  input: {
    job: BlueprintGenerationJob;
    specTree: BlueprintSpecTree;
    node: BlueprintSpecTreeNode;
    documents: BlueprintSpecDocument[];
    existingPreviews: BlueprintEffectPreview[];
    includeDrafts: boolean;
    createdAt: string;
    clarificationSession?: BlueprintClarificationSession;
    domainContext?: BlueprintProjectDomainContext;
    primaryRoute?: BlueprintRouteCandidate;
    capabilityInvocations?: BlueprintCapabilityInvocation[];
    capabilityEvidence?: BlueprintCapabilityEvidence[];
  }
): Promise<BlueprintEffectPreview> {
  // ---- Invariant scaffold (task 14.2) ----------------------------------
  // Structural / identity fields derived only from job + specTree + node +
  // documents + existingPreviews. Stay byte-identical on all three paths
  // (real LLM / llm_fallback / template) to preserve outer-layer behavior
  // required by design §2.D3 / requirements 2.4 / 2.7.
  const sourceDocumentIds = input.documents.map(document => document.id);
  const sourceStatus = resolveEffectPreviewSourceStatus(input.documents);
  const status: BlueprintEffectPreviewStatus =
    input.includeDrafts && sourceStatus !== "accepted" ? "preview" : "completed";
  const previewId = createId("blueprint-effect-preview");
  const previousPreviews = input.existingPreviews
    .slice()
    .sort(
      (left, right) =>
        (left.version ?? 1) - (right.version ?? 1) ||
        left.createdAt.localeCompare(right.createdAt)
    );
  const latestPreviousPreview = previousPreviews[previousPreviews.length - 1];
  const previousPreviewIds = previousPreviews.map(preview => preview.id);
  const preservedPreviewIds = [...previousPreviewIds];
  const version = previousPreviews.length > 0
    ? Math.max(...previousPreviews.map(preview => preview.version ?? 1)) + 1
    : 1;
  const sourceSnapshotHash = buildEffectPreviewSourceSnapshotHash({
    specTree: input.specTree,
    node: input.node,
    documents: input.documents,
  });
  const nodeProgress = buildEffectPreviewNodeProgress(
    input.specTree,
    input.node
  );
  const dependencyOrder = buildEffectPreviewDependencyOrder(
    input.specTree,
    input.node
  );
  const versionSync: BlueprintEffectPreviewVersionSync = {
    version,
    versionStatus: "current",
    supersedesPreviewId: latestPreviousPreview?.id,
    previousPreviewIds,
    preservedPreviewIds,
    refreshedFromSpecTreeVersion: input.specTree.version,
    refreshedAt: input.createdAt,
    sourceSnapshotHash,
    nodeProgress,
    dependencyOrder,
  };

  // ---- Invoke Effect Preview LLM service (task 14.3) -------------------
  // When `ctx.effectPreviewLlmService` is missing, or returns
  // `generationSource !== "llm"`, the rest of the function falls through
  // to the templated path below (design §2.D3 / §5.2).
  let serviceResult:
    | Awaited<ReturnType<NonNullable<typeof ctx.effectPreviewLlmService>>>
    | undefined;
  try {
    serviceResult = await ctx.effectPreviewLlmService?.({
      jobId: input.job.id,
      job: input.job,
      specTreeNode: input.node,
      sourceDocuments: input.documents,
      primaryRoute: input.primaryRoute,
      clarificationSession: input.clarificationSession,
      domainContext: input.domainContext,
      capabilityInvocations: input.capabilityInvocations,
      capabilityEvidence: input.capabilityEvidence,
      includeDrafts: input.includeDrafts,
      createdAt: input.createdAt,
    });
  } catch {
    // Defence in depth: the service owns its own tier-3/6 error shielding
    // and never rejects on the real path, but if a future custom ctx injects
    // a service that throws we still fall back to the templated path rather
    // than bubbling the error up and breaking `Promise.all` in the outer
    // `generateEffectPreviews` (requirement 5.6 / design §5.3).
    serviceResult = undefined;
  }

  const documentTitles = input.documents.map(document => document.title);
  const templatedArchitectureNotes = [
    `Anchor implementation around ${input.node.title}.`,
    input.node.dependencies.length > 0
      ? `Respect upstream dependencies: ${input.node.dependencies.join(", ")}.`
      : "No explicit upstream dependencies are recorded for this node.",
    input.node.outputs.length > 0
      ? `Expected asset outputs: ${input.node.outputs.join(", ")}.`
      : "No explicit downstream outputs are recorded for this node.",
  ];
  const templatedPrototypeCues = buildEffectPreviewPrototypeCues(
    input.node,
    sourceDocumentIds
  );
  const templatedProgressPlan = buildEffectPreviewMilestones(
    input.node,
    input.documents
  );
  const templatedSummary = `Preview the expected effect of ${input.node.title} using ${documentTitles.join(", ")}.`;

  // Content fields resolve from the service output when the real path
  // succeeded; otherwise the templated path output flows through unchanged
  // (byte-identical to today's behaviour — design §2.D3 / §5.2).
  const isLlm = serviceResult?.generationSource === "llm";
  const summary = isLlm && serviceResult?.summary
    ? serviceResult.summary
    : templatedSummary;
  const architectureNotes =
    isLlm && serviceResult?.architectureNotes && serviceResult.architectureNotes.length > 0
      ? serviceResult.architectureNotes
      : templatedArchitectureNotes;
  const prototypeCues = isLlm ? templatedPrototypeCues : templatedPrototypeCues;
  const prototypeNotes =
    isLlm && serviceResult?.prototypeNotes && serviceResult.prototypeNotes.length > 0
      ? serviceResult.prototypeNotes
      : templatedPrototypeCues.map(cue => cue.cue);
  const progressPlan =
    isLlm && serviceResult?.progressPlan && serviceResult.progressPlan.length > 0
      ? serviceResult.progressPlan.map(milestone => ({
          ...milestone,
          sourceDocumentIds:
            milestone.sourceDocumentIds && milestone.sourceDocumentIds.length > 0
              ? milestone.sourceDocumentIds
              : sourceDocumentIds,
        }))
      : templatedProgressPlan;

  // Preview node: when running on the real path, substitute LLM-authored
  // `summary` / `steps` / `milestones` / `prototypeCues`; structural
  // fields (`id` / `nodeId` / `nodeTitle` / `nodeType` / `sourceDocumentIds`)
  // stay derived from the outer node (requirement 2.4 / 2.7).
  const previewNode: BlueprintEffectPreviewNode = {
    id: createId("blueprint-effect-preview-node"),
    nodeId: input.node.id,
    nodeTitle: input.node.title,
    nodeType: input.node.type,
    summary: isLlm && serviceResult?.summary ? serviceResult.summary : input.node.summary,
    sourceDocumentIds,
    steps: input.documents.map((document, index) => ({
      id: createId("blueprint-effect-preview-step"),
      title: `Apply ${document.type} document`,
      summary: summarizeEffectPreviewDocument(document, index),
      sourceDocumentIds: [document.id],
    })),
    milestones: progressPlan,
    prototypeCues,
  };

  // Runtime projection: build the templated runtime projection first so
  // structural fields (`id` / `jobId` / `projectId?` / `routeSetId` /
  // `routeId?` / `specTreeId` / `nodeId` / `effectPreviewId` /
  // `sceneSnapshotId` / `browserPreviewId` / `sourceIds`) stay outer-layer
  // derived in both paths. On the real path, merge in LLM-authored content
  // fields (`hudState` / `consoleLines` / `logTimeline` / `browserPreview`)
  // per design §4.7. When LLM did not provide `browserPreview`, preserve
  // the templated default (design §4.7).
  const templatedRuntimeProjection = buildEffectPreviewRuntimeProjection({
    id: previewId,
    job: input.job,
    specTree: input.specTree,
    node: input.node,
    status,
    sourceDocumentIds,
    createdAt: input.createdAt,
    progressPlan,
    prototypeCues,
  });

  let runtimeProjection: BlueprintEffectPreviewRuntimeProjection;
  if (isLlm && serviceResult) {
    const hud = serviceResult.renderedHudState;
    runtimeProjection = {
      ...templatedRuntimeProjection,
      // Content fields overridden; structural fields (id, jobId, projectId,
      // routeSetId, routeId, specTreeId, nodeId, effectPreviewId,
      // sceneSnapshotId, browserPreviewId, sourceIds) stay from template.
      hudState: hud
        ? {
            id: templatedRuntimeProjection.hudState.id,
            title: hud.title,
            summary: hud.summary,
            // Outer-layer `activeNodeId` / `stage` / `status` fallbacks —
            // task 14.4 rule: merge LLM renderedHudState with outer defaults.
            status: hud.status ?? templatedRuntimeProjection.hudState.status,
            stage: hud.stage ?? templatedRuntimeProjection.hudState.stage,
            progressPercent: hud.progressPercent,
            activeNodeId:
              hud.activeNodeId ?? templatedRuntimeProjection.hudState.activeNodeId,
            badges: hud.badges ?? templatedRuntimeProjection.hudState.badges,
          }
        : templatedRuntimeProjection.hudState,
      // Note: `renderedConsoleLines` is part of `serviceResult` but is not
      // surfaced on the shared `BlueprintEffectPreviewRuntimeProjection`
      // contract today. The content still flows to provenance / replay via
      // the service digest / promptFingerprint — a future contract
      // extension can thread it onto the projection shape (design §4.7
      // mentions it; task 15 scoped the current extension to the 7
      // provenance fields only).
      logTimeline:
        serviceResult.renderedLogTimeline && serviceResult.renderedLogTimeline.length > 0
          ? serviceResult.renderedLogTimeline.map(entry => ({
              id: entry.id,
              level: entry.level,
              message: entry.message,
              // Outer-layer `createdAt` fallback when service omitted.
              occurredAt: entry.occurredAt ?? input.createdAt,
              sourceDocumentIds,
            }))
          : templatedRuntimeProjection.logTimeline,
      browserPreview: serviceResult.renderedBrowserPreview
        ? {
            id: templatedRuntimeProjection.browserPreviewId,
            title: serviceResult.renderedBrowserPreview.title,
            summary: serviceResult.renderedBrowserPreview.summary,
            routeId: templatedRuntimeProjection.browserPreview?.routeId,
            nodeId: input.node.id,
            url:
              serviceResult.renderedBrowserPreview.url ??
              templatedRuntimeProjection.browserPreview?.url,
          }
        : templatedRuntimeProjection.browserPreview,
    };
  } else {
    runtimeProjection = templatedRuntimeProjection;
  }

  // ---- Provenance extras (task 14.4 / 14.5 / 14.6) --------------------
  // On the real path fill the 7 new optional fields; on fallback fill
  // `generationSource` / `promptId?` / `model?` / `promptFingerprint?` /
  // `error?`; on template fill only `generationSource: "template"`.
  const provenanceExtras: {
    generationSource?: "llm" | "llm_fallback" | "template";
    promptId?: string;
    model?: string;
    responseDigest?: string;
    structuredPayloadDigest?: string;
    promptFingerprint?: string;
    error?: string;
  } = {};
  if (serviceResult) {
    provenanceExtras.generationSource = serviceResult.generationSource;
    if (serviceResult.promptId !== undefined) {
      provenanceExtras.promptId = serviceResult.promptId;
    }
    if (serviceResult.model !== undefined) {
      provenanceExtras.model = serviceResult.model;
    }
    if (serviceResult.promptFingerprint !== undefined) {
      provenanceExtras.promptFingerprint = serviceResult.promptFingerprint;
    }
    if (serviceResult.responseDigest !== undefined) {
      provenanceExtras.responseDigest = serviceResult.responseDigest;
    }
    if (serviceResult.structuredPayloadDigest !== undefined) {
      provenanceExtras.structuredPayloadDigest = serviceResult.structuredPayloadDigest;
    }
    if (serviceResult.error !== undefined) {
      provenanceExtras.error = serviceResult.error;
    }
  } else {
    // Service not wired (default-construct ctx path from the test harness
    // that injects a ctx without the field). Treat as template path for
    // backward compatibility with consumers that read
    // `provenance.generationSource`.
    provenanceExtras.generationSource = "template";
  }

  // ---- Invoke Effect Preview Stage C ImageService (task 7.1) ---------
  // `autopilot-image-rendering-and-visual-system` spec Task 7.1：
  //
  // Stage C 出图链路与上文的 LLM 内容字段服务并列存在，互不干扰：
  //
  // - 上文 `serviceResult` 决定 `summary` / `architectureNotes` /
  //   `prototypeNotes` / `progressPlan` 等内容字段；
  // - 下面 `imageStageCResult` 决定 `architectureSvgDraft` / `imageBase64ByNodeId`
  //   / `textOnlyEffectPreview`，并按节点把 `fallbackTier` / `startedAt` /
  //   `endedAt` / `errorSummary` 合并到与当前节点对齐的 milestones 上。
  //
  // 调用永不抛错（image-service.ts 在 try/catch 里把异常翻成
  // `textOnlyEffectPreview = { active: true, reason: "upstream-failure" }`），
  // 这里再加一层防御 try/catch 与 `serviceResult` 一致：任何意外异常都被
  // 吞掉，落回模板路径，不影响现有 60+ effect-preview 测试。
  let imageStageCResult:
    | Awaited<
        ReturnType<NonNullable<typeof ctx.effectPreviewImageService>["runStageC"]>
      >
    | undefined;
  try {
    imageStageCResult = await ctx.effectPreviewImageService?.runStageC({
      missionId: input.job.id,
      specDocuments: input.documents,
      // task 32.x: raster targets vs timeline contract split.
      // -----------------------------------------------------------------
      // - `rasterTargets` is the EXPLICIT generate-call list. We only ever
      //   want to raster the current preview node (singleton). The whole
      //   `generateEffectPreviews` outer loop already invokes this
      //   `buildEffectPreview` once per target node, so the per-target cost
      //   is O(1) generate call rather than O(M) where M is the dependency
      //   chain length. Without this split, batch generation of N target
      //   nodes amplifies to O(N × M) imageApiClient.generate calls — a
      //   measurable regression for any non-trivial spec tree.
      // - `dependencyOrder` is timeline-only metadata. Scheduler.plan still
      //   consumes it to produce a progressPlan that the right-rail
      //   schedule timeline / progress panel can render, but it does NOT
      //   trigger raster calls anymore.
      // -----------------------------------------------------------------
      rasterTargets: [input.node.id],
      // dependencyOrder 在 buildEffectPreview 内部已是 BlueprintEffectPreviewDependencyOrderEntry[]，
      // ImageService.runStageC 仅消费拓扑顺序的 nodeId 数组，所以这里映射出 nodeId。
      dependencyOrder: dependencyOrder.map(entry => entry.nodeId),
      architectureNotes,
    });
  } catch {
    imageStageCResult = undefined;
  }

  // 把 Stage C 结果合并回 BlueprintEffectPreview 字段。Stage C 的
  // `progressPlan` 是按节点 keyed 的（与 dependencyOrder 同序），而当前
  // preview 的 `progressPlan` 是 3 条通用 milestone。本节点（input.node.id）
  // 在 Stage C progressPlan 中对应的 entry 决定了 fallbackTier / startedAt /
  // endedAt / errorSummary —— 把这 4 个字段叠加到当前 preview 的所有 milestones
  // 上（同节点 preview，3 条 milestone 共享降级状态）。
  let mergedProgressPlan = progressPlan;
  let mergedImageBase64ByNodeId: Record<string, NodeImageRecord> | undefined;
  let mergedArchitectureSvgDraft: string | undefined;
  let mergedTextOnlyEffectPreview:
    | BlueprintEffectPreview["textOnlyEffectPreview"]
    | undefined;
  if (imageStageCResult) {
    if (typeof imageStageCResult.architectureSvgDraft === "string") {
      mergedArchitectureSvgDraft = imageStageCResult.architectureSvgDraft;
    }
    if (imageStageCResult.imageBase64ByNodeId) {
      mergedImageBase64ByNodeId = imageStageCResult.imageBase64ByNodeId;
    }
    if (imageStageCResult.textOnlyEffectPreview) {
      mergedTextOnlyEffectPreview = imageStageCResult.textOnlyEffectPreview;
    }
    const stageCEntry = imageStageCResult.progressPlan.find(
      entry => entry.nodeId === input.node.id,
    );
    if (stageCEntry) {
      const mergePatch: {
        fallbackTier?: typeof stageCEntry.fallbackTier;
        startedAt?: string;
        endedAt?: string;
        errorSummary?: string;
      } = {};
      if (stageCEntry.fallbackTier !== undefined) {
        mergePatch.fallbackTier = stageCEntry.fallbackTier;
      }
      if (stageCEntry.startedAt !== undefined) {
        mergePatch.startedAt = stageCEntry.startedAt;
      }
      if (stageCEntry.endedAt !== undefined) {
        mergePatch.endedAt = stageCEntry.endedAt;
      }
      if (stageCEntry.errorSummary !== undefined) {
        mergePatch.errorSummary = stageCEntry.errorSummary;
      }
      if (Object.keys(mergePatch).length > 0) {
        mergedProgressPlan = progressPlan.map(milestone => ({
          ...milestone,
          ...mergePatch,
        }));
      }
    }
  }

  return {
    id: previewId,
    jobId: input.job.id,
    treeId: input.specTree.id,
    nodeId: input.node.id,
    version,
    versionStatus: "current",
    supersedesPreviewId: versionSync.supersedesPreviewId,
    previousPreviewIds,
    preservedPreviewIds,
    refreshedFromSpecTreeVersion: input.specTree.version,
    refreshedAt: input.createdAt,
    sourceSnapshotHash,
    sourceDocumentIds,
    status,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    summary,
    architectureNotes,
    prototypeNotes,
    progressPlan: mergedProgressPlan,
    nodes: [previewNode],
    runtimeProjection,
    nodeProgress,
    dependencyOrder,
    versionSync,
    // `autopilot-image-rendering-and-visual-system` spec Task 7.1：
    // Stage C 制品分离不变量 — `architectureSvgDraft` / `imageBase64ByNodeId`
    // / `textOnlyEffectPreview` 三类制品在 BlueprintEffectPreview 上各占独立
    // 字段，禁止混入同一字段（design §"Data Models" / Property 5 第四条）。
    ...(mergedArchitectureSvgDraft !== undefined
      ? { architectureSvgDraft: mergedArchitectureSvgDraft }
      : {}),
    ...(mergedImageBase64ByNodeId !== undefined
      ? { imageBase64ByNodeId: mergedImageBase64ByNodeId }
      : {}),
    ...(mergedTextOnlyEffectPreview !== undefined
      ? { textOnlyEffectPreview: mergedTextOnlyEffectPreview }
      : {}),
    provenance: {
      jobId: input.job.id,
      projectId: input.job.projectId,
      sourceId: input.job.sourceId,
      targetText: input.job.request.targetText,
      githubUrls: input.job.request.githubUrls ?? [],
      treeVersion: input.specTree.version,
      nodeType: input.node.type,
      nodeTitle: input.node.title,
      nodeSummary: input.node.summary,
      sourceStatus,
      includeDrafts: input.includeDrafts,
      sourceDocumentStatuses: Object.fromEntries(
        input.documents.map(document => [
          document.id,
          normalizeSpecDocumentStatus(document.status),
        ])
      ),
      ...provenanceExtras,
    },
  };
}

function buildEffectPreviewRuntimeProjection(input: {
  id: string;
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  node: BlueprintSpecTreeNode;
  status: BlueprintEffectPreviewStatus;
  sourceDocumentIds: string[];
  createdAt: string;
  progressPlan: BlueprintEffectPreviewMilestone[];
  prototypeCues: BlueprintEffectPreviewPrototypeCue[];
}): BlueprintEffectPreviewRuntimeProjection {
  const routeId = input.node.routeId ?? input.specTree.selectedRouteId;
  const projectionSeed = `${input.job.id}:${input.specTree.id}:${input.node.id}:${input.id}`;
  const sceneSnapshotId = stableId(
    "blueprint-scene-snapshot",
    projectionSeed
  );
  const browserPreviewId = stableId(
    "blueprint-browser-preview",
    projectionSeed
  );
  const progressPercent =
    input.status === "completed"
      ? 100
      : Math.max(35, Math.min(95, input.progressPlan.length * 25));
  const cueBadges = input.prototypeCues
    .map(cue => cue.surface)
    .filter((surface, index, surfaces) => surfaces.indexOf(surface) === index);

  return {
    id: stableId("blueprint-runtime-projection", projectionSeed),
    jobId: input.job.id,
    projectId: input.job.projectId,
    routeSetId: input.specTree.routeSetId,
    routeId,
    specTreeId: input.specTree.id,
    nodeId: input.node.id,
    effectPreviewId: input.id,
    sceneSnapshotId,
    hudState: {
      id: stableId("blueprint-hud-state", projectionSeed),
      status: input.status,
      stage: "effect_preview",
      title: `${input.node.title} runtime projection`,
      summary: `Bind ${input.node.title} preview state to 3D, HUD, logs, and browser surfaces.`,
      progressPercent,
      activeNodeId: input.node.id,
      badges: [
        "3D scene",
        "HUD",
        "log timeline",
        "browser preview",
        ...cueBadges.map(surface => `cue:${surface}`),
      ],
    },
    logTimeline: [
      {
        id: stableId("blueprint-preview-log", `${projectionSeed}:scene`),
        level: "info",
        message: `Scene snapshot ${sceneSnapshotId} prepared for ${input.node.title}.`,
        occurredAt: input.createdAt,
        sourceDocumentIds: input.sourceDocumentIds,
      },
      {
        id: stableId("blueprint-preview-log", `${projectionSeed}:hud`),
        level: input.status === "completed" ? "success" : "info",
        message: `HUD state bound to ${input.node.title} with ${progressPercent}% preview progress.`,
        occurredAt: input.createdAt,
        sourceDocumentIds: input.sourceDocumentIds,
      },
      {
        id: stableId("blueprint-preview-log", `${projectionSeed}:browser`),
        level: "success",
        message: `Browser preview ${browserPreviewId} linked to route ${routeId}.`,
        occurredAt: input.createdAt,
        sourceDocumentIds: input.sourceDocumentIds,
      },
    ],
    browserPreviewId,
    browserPreview: {
      id: browserPreviewId,
      title: `${input.node.title} browser preview`,
      summary: `Interactive browser surface for ${input.node.summary}`,
      routeId,
      nodeId: input.node.id,
      url: `/autopilot/preview/${input.job.id}/${input.node.id}`,
    },
    sourceIds: {
      projectId: input.job.projectId,
      routeSetId: input.specTree.routeSetId,
      specTreeId: input.specTree.id,
      nodeIds: [input.node.id],
      specDocumentIds: input.sourceDocumentIds,
      effectPreviewIds: [input.id],
    },
  };
}

function archiveEffectPreviewVersion(
  preview: BlueprintEffectPreview,
  archivedAt: string
): BlueprintEffectPreview {
  const version = preview.version ?? preview.versionSync?.version ?? 1;
  const versionSync: BlueprintEffectPreviewVersionSync = {
    version,
    versionStatus: "archived",
    supersedesPreviewId: preview.supersedesPreviewId,
    previousPreviewIds: preview.previousPreviewIds ?? [],
    preservedPreviewIds: uniqueStrings(
      (preview.preservedPreviewIds ?? []).concat(preview.id)
    ),
    refreshedFromSpecTreeVersion:
      preview.refreshedFromSpecTreeVersion ??
      preview.versionSync?.refreshedFromSpecTreeVersion ??
      preview.provenance.treeVersion,
    refreshedAt:
      preview.refreshedAt ?? preview.versionSync?.refreshedAt ?? archivedAt,
    sourceSnapshotHash:
      preview.sourceSnapshotHash ??
      preview.versionSync?.sourceSnapshotHash ??
      stableId("blueprint-preview-snapshot", preview.id),
    nodeProgress:
      preview.nodeProgress ??
      preview.versionSync?.nodeProgress ??
      buildFallbackEffectPreviewNodeProgress(preview),
    dependencyOrder:
      preview.dependencyOrder ??
      preview.versionSync?.dependencyOrder ??
      [],
  };

  return {
    ...preview,
    version,
    versionStatus: "archived",
    preservedPreviewIds: versionSync.preservedPreviewIds ?? [],
    updatedAt: archivedAt,
    versionSync,
  };
}

function buildEffectPreviewNodeProgress(
  specTree: BlueprintSpecTree,
  node: BlueprintSpecTreeNode
): BlueprintEffectPreviewNodeProgress {
  return {
    nodeId: node.id,
    status: node.status,
    completionPercent: mapSpecTreeNodeStatusToCompletion(node.status),
    dependencyIds: resolveEffectPreviewDependencyIds(specTree, node),
    outputIds: [...node.outputs],
    updatedFromTreeVersion: specTree.version,
  };
}

function buildFallbackEffectPreviewNodeProgress(
  preview: BlueprintEffectPreview
): BlueprintEffectPreviewNodeProgress {
  return {
    nodeId: preview.nodeId,
    status: "draft",
    completionPercent: 50,
    dependencyIds: [],
    outputIds: [],
    updatedFromTreeVersion: preview.provenance.treeVersion,
  };
}

function buildEffectPreviewDependencyOrder(
  specTree: BlueprintSpecTree,
  node: BlueprintSpecTreeNode
): BlueprintEffectPreviewDependencyOrderEntry[] {
  const dependencyNodes = resolveEffectPreviewDependencyNodes(specTree, node);
  return dependencyNodes.concat(node).map((item, index) => ({
    nodeId: item.id,
    title: item.title,
    status: item.status,
    order: index + 1,
    dependencyIds: resolveEffectPreviewDependencyIds(specTree, item),
  }));
}

function resolveEffectPreviewDependencyNodes(
  specTree: BlueprintSpecTree,
  node: BlueprintSpecTreeNode
): BlueprintSpecTreeNode[] {
  const nodesById = new Map(specTree.nodes.map(item => [item.id, item]));
  const nodesByType = new Map<string, BlueprintSpecTreeNode>(
    specTree.nodes.map(item => [item.type, item])
  );
  const dependencies = node.dependencies
    .map(dependency => nodesById.get(dependency) ?? nodesByType.get(dependency))
    .filter((item): item is BlueprintSpecTreeNode => Boolean(item));

  return dependencies.sort(
    (left, right) => left.priority - right.priority || left.title.localeCompare(right.title)
  );
}

function resolveEffectPreviewDependencyIds(
  specTree: BlueprintSpecTree,
  node: BlueprintSpecTreeNode
): string[] {
  return resolveEffectPreviewDependencyNodes(specTree, node).map(item => item.id);
}

function mapSpecTreeNodeStatusToCompletion(
  status: BlueprintSpecTreeNodeStatus
): number {
  if (status === "accepted") return 100;
  if (status === "ready") return 80;
  if (status === "draft") return 50;
  return 20;
}

function buildEffectPreviewSourceSnapshotHash(input: {
  specTree: BlueprintSpecTree;
  node: BlueprintSpecTreeNode;
  documents: BlueprintSpecDocument[];
}): string {
  const source = JSON.stringify({
    treeId: input.specTree.id,
    treeVersion: input.specTree.version,
    node: {
      id: input.node.id,
      title: input.node.title,
      summary: input.node.summary,
      status: input.node.status,
      dependencies: input.node.dependencies,
      outputs: input.node.outputs,
    },
    documents: input.documents.map(document => ({
      id: document.id,
      type: document.type,
      status: normalizeSpecDocumentStatus(document.status),
      version: document.version ?? 1,
      updatedAt: document.updatedAt ?? document.createdAt,
    })),
  });
  return `sha256:${createHash("sha256").update(source).digest("hex").slice(0, 16)}`;
}

/**
 * `autopilot-llm-spec-generation` Task 6.2：从 LLM 批量生成结果中按文档类型
 * 取出对应 markdown。仅在 `output.generationSource === "llm"` 且对应字段
 * 非空时返回字符串；其余情况返回 `undefined`，由调用方走既有
 * `specDocumentsLlmService` + 模板兜底路径。
 */
function pickSpecDocsLlmMarkdownForType(
  output: SpecDocsLlmNodeOutput | undefined,
  type: BlueprintSpecDocumentType,
): string | undefined {
  if (output === undefined) return undefined;
  if (output.generationSource !== "llm") return undefined;
  switch (type) {
    case "requirements":
      return output.requirements;
    case "design":
      return output.design;
    case "tasks":
      return output.tasks;
    default:
      return undefined;
  }
}

async function buildSpecDocument(
  ctx: BlueprintServiceContext | undefined,
  input: {
    job: BlueprintGenerationJob;
    specTree: BlueprintSpecTree;
    node: BlueprintSpecTreeNode;
    type: BlueprintSpecDocumentType;
    createdAt: string;
    previousRoleFindings?: BlueprintRoleTimelineEntry[];
    clarificationSession?: BlueprintClarificationSession;
    domainContext?: BlueprintProjectDomainContext;
    primaryRoute?: BlueprintRouteCandidate;
    /**
     * `autopilot-llm-spec-generation` Task 6.2：可选的 LLM 批量生成结果。
     * 当 `generationSource === "llm"` 时，本节点对应的 `requirements` /
     * `design` / `tasks` markdown 直接来自 Lite Agent 驱动版本的
     * {@link SpecDocsLlmGeneration.generate}；否则保持 undefined，由下方
     * 既有 `specDocumentsLlmService` + 模板路径兜底。
     */
    llmNodeOutput?: SpecDocsLlmNodeOutput;
  }
): Promise<BlueprintSpecDocument> {
  const id = createId("blueprint-spec-document");

  // ---- Task 6.2：优先使用 spec_docs LLM 批量生成结果（env-gated 分支） ----
  // 当 `llmNodeOutput?.generationSource === "llm"` 且本节点的对应 type
  // markdown 存在时，直接走 LLM 路径并跳过既有 specDocumentsLlmService /
  // 模板调用，避免重复 LLM 流量。否则 fall through 到既有路径。
  const llmMarkdown = pickSpecDocsLlmMarkdownForType(
    input.llmNodeOutput,
    input.type,
  );
  if (
    input.llmNodeOutput?.generationSource === "llm" &&
    typeof llmMarkdown === "string" &&
    llmMarkdown.length > 0
  ) {
    const llmTitle = buildSpecDocumentHeading(input.type, input.node.title);
    return {
      id,
      jobId: input.job.id,
      treeId: input.specTree.id,
      nodeId: input.node.id,
      type: input.type,
      status: "draft",
      version: 1,
      sourceDocumentId: id,
      title: llmTitle,
      summary: input.node.summary,
      content: llmMarkdown,
      format: "markdown",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      provenance: {
        jobId: input.job.id,
        projectId: input.job.projectId,
        sourceId: input.job.sourceId,
        targetText: input.job.request.targetText,
        githubUrls: input.job.request.githubUrls ?? [],
        treeVersion: input.specTree.version,
        nodeType: input.node.type,
        nodeTitle: input.node.title,
        nodeSummary: input.node.summary,
        dependencies: [...input.node.dependencies],
        outputs: [...input.node.outputs],
        reusedRoleFindingIds: collectRoleFindingIds(
          input.previousRoleFindings ?? []
        ),
        reusedRoleIds: collectRoleFindingRoleIds(input.previousRoleFindings ?? []),
        reusedEvidenceIds: collectRoleFindingEvidenceIds(
          input.previousRoleFindings ?? []
        ),
        generationSource: "llm",
        promptId: input.llmNodeOutput.promptId,
        model: input.llmNodeOutput.model,
        promptFingerprint: input.llmNodeOutput.promptFingerprint,
        responseDigest: input.llmNodeOutput.responseDigest,
      },
    };
  }

  // ---- Call SPEC Documents LLM service (per-document) ----
  // Derive upstreamEvidence from previousRoleFindings (undefined when empty).
  const reusableRoleFindings = (input.previousRoleFindings ?? []).flatMap(
    entry => {
      const findings = Array.isArray(
        (entry as unknown as { findings?: unknown[] }).findings
      )
        ? ((entry as unknown as { findings: Array<Record<string, unknown>> })
            .findings)
        : [];
      return findings.map(finding => ({
        id: String((finding as Record<string, unknown>).id ?? ""),
        label: String((finding as Record<string, unknown>).label ?? ""),
        summary: String((finding as Record<string, unknown>).summary ?? ""),
      }));
    }
  );
  const upstreamEvidence =
    reusableRoleFindings.length > 0
      ? { reusableRoleFindings }
      : undefined;

  // ── Decision 3: batch-template-fallback short-circuit ────────────────
  // If the batch already produced a template-source result for this node,
  // do NOT re-attempt the legacy per-document LLM service. Skip directly
  // to the template path. This closes the theoretical second-LLM-dispatch
  // path under the legacy BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED env flag.
  // Rationale: the new pipeline already has a 5-key pool with retries in
  // Phase 1 (spec-docs-llm-generation.ts:741-745); a 6th legacy retry is
  // unlikely to succeed and only adds latency + cost. The resulting document
  // carries generationSource: "template", honoring the batch generator's verdict.
  const batchTemplateOnly =
    input.llmNodeOutput !== undefined &&
    input.llmNodeOutput.generationSource !== "llm";

  const serviceResult = ctx?.specDocumentsLlmService && !batchTemplateOnly
    ? await ctx.specDocumentsLlmService({
        jobId: input.job.id,
        job: input.job,
        request: input.job.request,
        specTreeNode: input.node,
        targetDocumentType: input.type,
        primaryRoute: input.primaryRoute,
        clarificationSession: input.clarificationSession,
        domainContext: input.domainContext,
        upstreamEvidence,
        createdAt: input.createdAt,
      })
    : undefined;

  // ---- Branch: LLM success vs template/fallback ----
  let title: string;
  let summary: string;
  let content: string;
  let provenanceExtras: {
    generationSource?: "llm" | "llm_fallback" | "template";
    promptId?: string;
    model?: string;
    responseDigest?: string;
    structuredPayloadDigest?: string;
    promptFingerprint?: string;
    error?: string;
  } = {};

  if (
    serviceResult?.generationSource === "llm" &&
    serviceResult.title &&
    serviceResult.summary &&
    serviceResult.content
  ) {
    // Real LLM path: use LLM output.
    title = serviceResult.title;
    summary = serviceResult.summary;
    content = serviceResult.content;
    provenanceExtras = {
      generationSource: "llm",
      promptId: serviceResult.promptId,
      model: serviceResult.model,
      responseDigest: serviceResult.responseDigest,
      structuredPayloadDigest: serviceResult.structuredPayloadDigest,
      promptFingerprint: serviceResult.promptFingerprint,
    };
  } else {
    // Template / llm_fallback path: execute today's templated helpers unchanged.
    title = buildSpecDocumentHeading(input.type, input.node.title);
    summary = input.node.summary;
    content = buildSpecDocumentBody(input);
    provenanceExtras = {
      generationSource: serviceResult?.generationSource ?? "template",
      promptId: serviceResult?.promptId,
      model: serviceResult?.model,
      promptFingerprint: serviceResult?.promptFingerprint,
      error: serviceResult?.error,
    };
  }

  return {
    id,
    jobId: input.job.id,
    treeId: input.specTree.id,
    nodeId: input.node.id,
    type: input.type,
    status: "draft",
    version: 1,
    sourceDocumentId: id,
    title,
    summary,
    content,
    format: "markdown",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    provenance: {
      jobId: input.job.id,
      projectId: input.job.projectId,
      sourceId: input.job.sourceId,
      targetText: input.job.request.targetText,
      githubUrls: input.job.request.githubUrls ?? [],
      treeVersion: input.specTree.version,
      nodeType: input.node.type,
      nodeTitle: input.node.title,
      nodeSummary: input.node.summary,
      dependencies: [...input.node.dependencies],
      outputs: [...input.node.outputs],
      reusedRoleFindingIds: collectRoleFindingIds(
        input.previousRoleFindings ?? []
      ),
      reusedRoleIds: collectRoleFindingRoleIds(input.previousRoleFindings ?? []),
      reusedEvidenceIds: collectRoleFindingEvidenceIds(
        input.previousRoleFindings ?? []
      ),
      ...provenanceExtras,
    },
  };
}

function buildSpecDocumentHeading(
  type: BlueprintSpecDocumentType,
  nodeTitle: string
): string {
  const label =
    type === "requirements"
      ? "Requirements"
      : type === "design"
        ? "Design"
        : "Tasks";
  return `${label}: ${nodeTitle}`;
}

function buildSpecDocumentBody(input: {
  node: BlueprintSpecTreeNode;
  type: BlueprintSpecDocumentType;
  previousRoleFindings?: BlueprintRoleTimelineEntry[];
}): string {
  // Task 12.4 / 12.5 (Quality Uplift Wave)：模板兜底路径升级为多章节骨架，
  // 与 ai-enabled-sandbox 的人工 spec 形态对齐。requirements 走
  // `## 简介 / ## 术语表 / ## 需求 (含 ≥3 个 ### 需求 N 块)`；design 走
  // `## 概述 / ## 架构 (mermaid) / ## 组件与接口 (TS interface) /
  // ## 数据模型 / ## 正确性属性 (≥3 Validates) / ## 错误处理 / ## 测试策略`；
  // tasks 走 `# Implementation Plan / ## Overview / ## Tasks (≥3 项 + 1 Checkpoint)`。
  const body = buildStructuredFallbackBody(input.node, input.type);
  const findings = buildReusableRoleFindingLines(input.previousRoleFindings ?? []);
  return findings.length > 0 ? `${body}\n${findings.join("\n")}` : body;
}

/**
 * Task 12.5 (Quality Uplift Wave)：抽取的多章节模板兜底 helper。
 *
 * 当 LLM 关闭或失败时，按 `BlueprintSpecTreeNode` 的元数据合成符合
 * `parseSpecDocsLlmResponse` 结构最小集校验的 markdown，让前端右栏卡片
 * 与既有手工 spec 在结构上保持一致。所有 H2 / H3 标题硬编码为中文
 * (zh-CN)，与 `SPEC_DOCS_SYSTEM_MESSAGE` Authoring structure 段落、
 * `userPayload.exampleOutline` 三处保持完全一致。tasks 段保留
 * `# Implementation Plan` / `## Overview` / `## Tasks` 英文标题以
 * 与下游扫描工具兼容（与 Req 7.9 一致）。
 *
 * 函数签名独立导出，方便后续若需要从其它路径（如 LLM 失败后的最终兜底）
 * 复用同一份骨架。
 */
function buildStructuredFallbackBody(
  node: BlueprintSpecTreeNode,
  type: BlueprintSpecDocumentType,
): string {
  const title = node.title.trim() || node.id;
  const summary = node.summary.trim() || "（待补充节点摘要）";
  const dependencyList = node.dependencies.length > 0
    ? node.dependencies.join("、")
    : "无";
  const outputList = node.outputs.length > 0
    ? node.outputs.join("、")
    : "无";

  if (type === "requirements") {
    return [
      `# 需求文档：${title}`,
      "",
      "## 简介",
      "",
      summary,
      "",
      "## 术语表",
      "",
      `- **${title}**：${summary}`,
      `- **依赖项**：${dependencyList}`,
      `- **产物**：${outputList}`,
      "",
      "## 需求",
      "",
      `### 需求 1：交付 ${title} 的核心能力`,
      "",
      `**用户故事：** As a developer, I want ${title} to be deliverable end-to-end, so that downstream consumers can rely on its outputs.`,
      "",
      "#### 验收标准",
      "",
      `1.1 THE ${title} module SHALL produce ${outputList} on successful execution.`,
      `1.2 WHEN dependencies (${dependencyList}) are unavailable, THE ${title} module SHALL fail with a descriptive error and SHALL NOT silently degrade.`,
      `1.3 IF execution priority is below ${node.priority}, THEN THE ${title} module SHALL defer to higher-priority work without losing pending state.`,
      "",
      `### 需求 2：保持可观测性与审计`,
      "",
      `**用户故事：** As an operator, I want every ${title} run to emit observable events, so that issues can be diagnosed without reading source code.`,
      "",
      "#### 验收标准",
      "",
      `2.1 THE ${title} module SHALL log start / progress / completion events with stable identifiers.`,
      `2.2 WHILE execution is in flight, THE ${title} module SHALL emit at least one progress signal per logical phase.`,
      "",
      `### 需求 3：失败可恢复`,
      "",
      `**用户故事：** As a developer, I want ${title} failures to be recoverable, so that retry attempts do not require manual cleanup.`,
      "",
      "#### 验收标准",
      "",
      `3.1 WHEN ${title} fails mid-run, THE module SHALL persist a recovery checkpoint enabling clean retry.`,
      `3.2 WHEN a retry is initiated, THE module SHALL resume from the last checkpoint rather than restarting from scratch.`,
      "",
      "_(Pending LLM enrichment.)_",
    ].join("\n");
  }

  if (type === "design") {
    const mermaidNodes = node.dependencies.length > 0
      ? node.dependencies.map((dep, idx) => `  D${idx}[${dep}] --> Self[${title}]`).join("\n")
      : `  Upstream[Upstream context] --> Self[${title}]`;
    const mermaidOutputs = node.outputs.length > 0
      ? node.outputs.map((out, idx) => `  Self[${title}] --> O${idx}[${out}]`).join("\n")
      : `  Self[${title}] --> Out[${outputList}]`;
    const interfaceName = `${title.replace(/[^a-zA-Z0-9]+/g, "")}Contract` || "NodeContract";
    return [
      `# 设计文档：${title}`,
      "",
      "## 概述",
      "",
      `${summary}`,
      "",
      `本节点优先级 ${node.priority}，类型 ${node.type}。依赖：${dependencyList}；产物：${outputList}。`,
      "",
      "## 架构",
      "",
      "```mermaid",
      "graph TB",
      mermaidNodes,
      mermaidOutputs,
      "```",
      "",
      "## 组件与接口",
      "",
      "```typescript",
      `export interface ${interfaceName} {`,
      `  /** 节点稳定标识。 */`,
      `  id: string;`,
      `  /** 节点优先级，0..100。 */`,
      `  priority: number;`,
      `  /** 上游依赖标识列表。 */`,
      `  dependencies: ReadonlyArray<string>;`,
      `  /** 产物标识列表。 */`,
      `  outputs: ReadonlyArray<string>;`,
      `}`,
      "```",
      "",
      "## 数据模型",
      "",
      `${title} 的运行态字段在事件总线 / artifact / replay 三处保持一致 schema，避免出现派生字段漂移。`,
      "",
      "## 正确性属性",
      "",
      `### Property 1: ${title} 输出完整性`,
      "",
      `*For any* 成功完成的 ${title} 执行，所产物 ${outputList} 必须全部出现在 artifact 列表中，且与 \`${interfaceName}.outputs\` 字段一一对应。`,
      "",
      "**Validates: Requirements 1.1**",
      "",
      `### Property 2: ${title} 失败可观测`,
      "",
      `*For any* 失败的 ${title} 执行，事件流中必须存在至少一条带 \`status: failed\` 的事件，且 \`error.message\` 经脱敏后非空。`,
      "",
      "**Validates: Requirements 2.1**",
      "",
      `### Property 3: ${title} 重试恢复语义`,
      "",
      `*For any* 重试发起，\`${interfaceName}.checkpointId\` 必须能定位到上一次成功完成的最后一个步骤，重试不重复已完成的副作用。`,
      "",
      "**Validates: Requirements 3.1, 3.2**",
      "",
      "## 错误处理",
      "",
      `${title} 在依赖缺失、产物校验失败、超时三类错误下均统一发出 \`status: failed\` 事件，并把脱敏后的错误信息写入审计链。`,
      "",
      "## 测试策略",
      "",
      `用 example-based 单元测试覆盖 \`${interfaceName}\` 的输入校验、产物投影、失败路径。回归命令：\`node ./node_modules/vitest/vitest.mjs run\`，TS 基线保持 116 不变。`,
      "",
      "_(Pending LLM enrichment.)_",
    ].join("\n");
  }

  // tasks
  return [
    `# Implementation Plan: ${title}`,
    "",
    "## Overview",
    "",
    `按 ${title} 的优先级 ${node.priority} 与依赖（${dependencyList}）排序，先收口 ${outputList}，再补观测与恢复路径。`,
    "",
    "## Tasks",
    "",
    `- [ ] 1. 落地 ${title} 主路径`,
    `  - 完成 \`${interfaceNameFromTitle(title)}\` 接口定义与首个产物 ${outputList}`,
    `  - _Requirements: 1.1, 1.2_`,
    `- [ ] 2. 补齐 ${title} 观测与审计`,
    `  - 写入 start / progress / completion 事件，落入审计链`,
    `  - _Requirements: 2.1, 2.2_`,
    `- [ ] 3. 实现 ${title} 失败恢复`,
    `  - 持久化 checkpoint，使重试不重复副作用`,
    `  - _Requirements: 3.1, 3.2_`,
    `- [ ] 4. Checkpoint — ensure all tests pass, ask the user if questions arise`,
    `  - _Requirements: 1.1, 2.1, 3.1_`,
    "",
    "_(Pending LLM enrichment.)_",
  ].join("\n");
}

function interfaceNameFromTitle(title: string): string {
  const cleaned = title.replace(/[^a-zA-Z0-9]+/g, "");
  return cleaned.length > 0 ? `${cleaned}Contract` : "NodeContract";
}

function buildReusableRoleFindingLines(
  findings: BlueprintRoleTimelineEntry[]
): string[] {
  if (findings.length === 0) {
    return [];
  }

  return [
    "",
    "## Reused Role Findings",
    "",
    ...findings.map(finding => `- ${formatReusableRoleFinding(finding)}`),
  ];
}

function buildEffectPreviewPrototypeCues(
  node: BlueprintSpecTreeNode,
  sourceDocumentIds: string[]
): BlueprintEffectPreviewPrototypeCue[] {
  const baseCues: Array<{
    title: string;
    surface: BlueprintEffectPreviewPrototypeCue["surface"];
    cue: string;
  }> = [
    {
      title: "Primary user-facing change",
      surface:
        node.type === "effect_preview" || node.type === "spec_document"
          ? "workflow"
          : "ui",
      cue: `Show the visible effect of ${node.title} with clear state transitions and review signals.`,
    },
    {
      title: "Architecture visibility",
      surface: "architecture",
      cue: `Represent ${node.title} as a traceable architecture node connected to its SPEC document sources.`,
    },
    {
      title: "Operational checkpoint",
      surface: "operations",
      cue: `Expose progress for ${node.title} through planned milestones and artifact readiness.`,
    },
  ];

  return baseCues.map(cue => ({
    id: createId("blueprint-effect-preview-cue"),
    ...cue,
    sourceDocumentIds,
  }));
}

function buildEffectPreviewMilestones(
  node: BlueprintSpecTreeNode,
  documents: BlueprintSpecDocument[]
): BlueprintEffectPreviewMilestone[] {
  return [
    {
      id: createId("blueprint-effect-preview-milestone"),
      title: "Confirm source SPEC coverage",
      summary: `Review ${documents.length} source document(s) for ${node.title}.`,
      target: "SPEC source set approved for preview consumption.",
      sourceDocumentIds: documents.map(document => document.id),
    },
    {
      id: createId("blueprint-effect-preview-milestone"),
      title: "Draft architecture effect",
      summary: `Map dependencies and outputs for ${node.title}.`,
      target: "Architecture notes are ready for diagram generation.",
      sourceDocumentIds: documents.map(document => document.id),
    },
    {
      id: createId("blueprint-effect-preview-milestone"),
      title: "Plan prototype and landing progress",
      summary: `Convert ${node.title} into prototype cues and implementation checkpoints.`,
      target: "Prototype direction and progress plan are ready for downstream menus.",
      sourceDocumentIds: documents.map(document => document.id),
    },
  ];
}

function summarizeEffectPreviewDocument(
  document: BlueprintSpecDocument,
  index: number
): string {
  const status = normalizeSpecDocumentStatus(document.status);
  return `Source ${index + 1} is ${document.type} in ${status} state: ${document.summary}`;
}

function resolveEffectPreviewSourceStatus(
  documents: BlueprintSpecDocument[]
): BlueprintEffectPreviewSourceStatus {
  const statuses = [
    ...new Set(documents.map(document => normalizeSpecDocumentStatus(document.status))),
  ];

  if (statuses.length === 1) {
    const [status] = statuses;
    return status === "accepted" || status === "draft" || status === "reviewing"
      ? status
      : "mixed";
  }

  return "mixed";
}

function normalizeSpecDocumentStatus(
  status: BlueprintSpecDocument["status"]
): BlueprintSpecDocumentStatus {
  return status ?? "draft";
}

function replaceClarificationSessionArtifact(
  job: BlueprintGenerationJob,
  session: BlueprintClarificationSession
): BlueprintGenerationJob {
  let replaced = false;
  const artifacts = job.artifacts.map(artifact => {
    if (
      artifact.type === "clarification_session" &&
      isClarificationSessionPayload(artifact.payload, session.id)
    ) {
      replaced = true;
      return {
        ...artifact,
        summary:
          session.routeReadySummary ??
          `${session.readiness.answeredRequired}/${session.readiness.requiredTotal} required clarification answers recorded.`,
        payload: session,
      };
    }

    return artifact;
  });

  if (!replaced) {
    return job;
  }

  return {
    ...job,
    updatedAt: session.updatedAt,
    artifacts,
  };
}

function replaceSpecTreeArtifact(
  artifacts: BlueprintGenerationArtifact[],
  specTree: BlueprintSpecTree
): BlueprintGenerationArtifact[] {
  return artifacts.map(artifact =>
    artifact.type === "spec_tree"
      ? { ...artifact, payload: specTree }
      : artifact
  );
}

function replaceSpecDocumentArtifact(
  artifacts: BlueprintGenerationArtifact[],
  document: BlueprintSpecDocument
): BlueprintGenerationArtifact[] {
  return artifacts.map(artifact => {
    if (
      artifact.type === document.type &&
      isPlainRecord(artifact.payload) &&
      readString(artifact.payload.nodeId) === document.nodeId &&
      readString(artifact.payload.sourceDocumentId) === document.sourceDocumentId
    ) {
      return { ...artifact, payload: document };
    }

    return artifact;
  });
}

function findSpecDocument(
  job: BlueprintGenerationJob,
  documentId: string
): BlueprintSpecDocument | undefined {
  return extractSpecDocuments(job).find(document => document.id === documentId);
}

function specDocumentNotFound(
  documentId: string,
  jobId: string
): { ok: false; status: 404; error: string; message: string } {
  return {
    ok: false,
    status: 404,
    error: "Blueprint SPEC document not found.",
    message: `No SPEC document ${documentId} exists in job ${jobId}.`,
  };
}

function cloneSpecTree(specTree: BlueprintSpecTree): BlueprintSpecTree {
  return JSON.parse(JSON.stringify(specTree)) as BlueprintSpecTree;
}

function buildTemplateSpecTreeNodes(input: {
  rootNodeId: string;
  selectedRoute: BlueprintRouteCandidate;
  routeSet: BlueprintRouteSet;
  selection: BlueprintRouteSelection;
  previousRoleFindings: BlueprintRoleTimelineEntry[];
  targetTitle: string;
}): BlueprintSpecTreeNode[] {
  const mainStepNodes = input.selectedRoute.steps.map((step, index) =>
    createSpecTreeNode({
      parentId: input.rootNodeId,
      title: step.title,
      summary: step.description,
      type: "route_step",
      status: step.status === "ready" ? "ready" : "seed",
      priority: index + 1,
      routeId: input.selectedRoute.id,
      routeStepId: step.id,
      outputs:
        index === 0
          ? ["clarification decisions", "success criteria"]
          : step.id === "derive-spec-tree-seed"
            ? ["SPEC tree seed", "node map"]
            : ["route evidence"],
      metadata: {
        role: step.role,
        routeKind: input.selectedRoute.kind,
      },
    })
  );
  const alternativeNodes = input.routeSet.routes
    .filter(route => route.id !== input.selectedRoute.id)
    .map((route, index) =>
      createSpecTreeNode({
        parentId: input.rootNodeId,
        title: route.title,
        summary: route.summary,
        type: "alternative_route",
        status: input.selection.mergedAlternativeRouteIds.includes(route.id)
          ? "ready"
          : "seed",
        priority: mainStepNodes.length + index + 1,
        routeId: route.id,
        outputs: route.outputs,
        metadata: {
          riskLevel: route.riskLevel,
          costLevel: route.costLevel,
          complexity: route.complexity,
          mergedIntoSelection:
            input.selection.mergedAlternativeRouteIds.includes(route.id),
        },
      })
    );
  const downstreamNodes = createDownstreamSpecTreeNodes({
    parentId: input.rootNodeId,
    routeId: input.selectedRoute.id,
    startPriority: mainStepNodes.length + alternativeNodes.length + 1,
  });
  const rootNode: BlueprintSpecTreeNode = {
    id: input.rootNodeId,
    title: `SPEC asset tree: ${input.targetTitle}`,
    summary:
      "Durable tree asset derived from the selected autopilot route. Downstream menus bind to this tree instead of recomputing the route.",
    type: "root",
    status: "draft",
    priority: 0,
    routeId: input.selectedRoute.id,
    dependencies: [],
    outputs: ["SPEC tree", "requirements seed", "design seed", "tasks seed"],
    children: mainStepNodes.concat(alternativeNodes, downstreamNodes).map(node => node.id),
    metadata: {
      selectedRouteTitle: input.selectedRoute.title,
      routeSetId: input.routeSet.id,
      routeId: input.selectedRoute.id,
      selectionId: input.selection.id,
      selectedPathId: input.selection.selectedPathId ?? input.selectedRoute.id,
      handoffState: "reviewing",
      confirmable: true,
      editable: true,
      resumable: true,
      previousRoleFindingCount: input.previousRoleFindings.length,
      reusedRoleFindingIds: collectRoleFindingIds(input.previousRoleFindings),
      reusedRoleIds: collectRoleFindingRoleIds(input.previousRoleFindings),
      reusedEvidenceIds: collectRoleFindingEvidenceIds(input.previousRoleFindings),
      downstreamMenus: [
        "spec_docs",
        "effect_preview",
        "prompt_packaging",
        "engineering_landing",
      ],
    },
  };

  return [rootNode].concat(mainStepNodes, alternativeNodes, downstreamNodes);
}

async function buildSpecTreeFromRouteSet(
  ctx: BlueprintServiceContext,
  input: {
  job: BlueprintGenerationJob;
  routeSet: BlueprintRouteSet;
  selection: BlueprintRouteSelection;
  selectedRoute: BlueprintRouteCandidate;
  createdAt: string;
  artifactLinks?: BlueprintGenerationArtifactLink[];
  previousRoleFindings?: BlueprintRoleTimelineEntry[];
  clarificationSession?: BlueprintClarificationSession;
  domainContext?: {
    projectId?: string;
    sourceId?: string;
    domain?: string;
    notes?: string;
  };
  aigcSpecNodeEvidence?: {
    subsystemsSummary: string;
    riskNoteCount: number;
  };
}): Promise<BlueprintSpecTree> {
  const specTreeId = createId("blueprint-spec-tree");
  const rootNodeId = createId("blueprint-spec-node");
  const targetTitle = summarizeRequestTarget(input.job.request);
  const previousRoleFindings = input.previousRoleFindings ?? [];
  const alternativeRouteIds = input.routeSet.routes
    .filter(route => route.id !== input.selectedRoute.id)
    .map(route => route.id)
    .filter(isString);

  // ─────────────────────────────────────────────────────────────────────
  // `autopilot-llm-spec-generation` Task 6.1：spec_tree handler 注入
  // env-gated LLM 分支。当 `BLUEPRINT_SPEC_TREE_LLM_ENABLED === "true"`、
  // 非 `BUILD_TARGET=test` 且 `ctx.specTreeLlmDerivation` 已装配时，优先
  // 调 Lite Agent 驱动版本的 `derive(...)` 走真实 LLM 推导；成功即用其
  // `nodes` / `rootNodeId` 与 provenance（promptId / model / fingerprint /
  // responseDigest）填入既有 wrapper，使 selectionId / artifactLinks 等
  // 上下文与 fallback 路径完全一致；失败 / 未启用时静默回落到既有
  // `specTreeLlmService` + 模板分支，保留 5140+ 既有测试默认兼容性。
  //
  // 关键约束：
  // - `derive()` 永不抛错；任何异常已在工厂内部转 fallback；
  // - 测试态 `BUILD_TARGET=test` 默认视旗标为 `false`（仍可由测试
  //   `vi.stubEnv` 显式 opt-in）；
  // - 未启用 / 失败时不调用 `derive()`，避免任何运行期副作用。
  //
  // _Implements Req 1.1 / 1.5 / 4.2 / 4.4_
  // ─────────────────────────────────────────────────────────────────────
  const specTreeLlmEnabled =
    process.env.BLUEPRINT_SPEC_TREE_LLM_ENABLED === "true";
  const isTestBuildTarget = process.env.BUILD_TARGET === "test";
  const specTreeLlmDerivation = ctx.specTreeLlmDerivation;
  if (
    specTreeLlmEnabled &&
    !isTestBuildTarget &&
    specTreeLlmDerivation !== undefined
  ) {
    // autopilot-streaming-experience integration-gap-2026-05-16：
    // 选完路线后用户最关心"系统在做什么"——即 SPEC 树派生的 LLM 推导过程。
    // 这里在调用 specTreeLlmDerivation.derive 前后包一层 stage-progress-emitter，
    // 让前端"路线"卡片的 stageFilter=["route_generation","route_selection","spec_tree"]
    // 子时间线能看到 thinking / acting / observing 流，避免出现"选完就什么
    // 都没了"的断层。
    const specTreeEmitter = ctx.eventBus
      ? createStageProgressEmitter(ctx.eventBus, input.job.id, "spec_tree", "planner")
      : undefined;

    specTreeEmitter?.thinking(
      `路线「${input.selectedRoute.title}」已选中，正在分析路线节点结构以派生 SPEC 树...`,
    );
    specTreeEmitter?.acting("llm.spec_tree_derivation");

    const derivationResult = await specTreeLlmDerivation.derive({
      jobId: input.job.id,
      routeSet: input.routeSet,
      selectedRouteId: input.selectedRoute.id,
      githubUrls: input.job.request.githubUrls ?? [],
      targetText: input.job.request.targetText ?? "",
    });
    if (
      derivationResult.generationSource === "llm" &&
      derivationResult.tree !== undefined
    ) {
      const derivedNodes = derivationResult.tree.nodes;
      // 真实节点类型分布（不造数）：把 type → 数量折成 "route_step×4 · spec_document×26"
      // 这种可读摘要，让观察行携带 SPEC 树的真实构成而不是只报一个总数。
      const typeCounts = new Map<string, number>();
      for (const node of derivedNodes) {
        typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
      }
      const typeBreakdown = Array.from(typeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type}×${count}`)
        .join(" · ");
      specTreeEmitter?.observing(
        true,
        `SPEC 树派生完成：${derivedNodes.length} 个节点（${typeBreakdown}；model=${derivationResult.model ?? "n/a"}）`,
      );

      // 第二轮：分析派生出来的 SPEC 树形态。reasoning-detail 2026-05-31 增量 ——
      // 让用户在"派生完成"之后看到一段真实的"对树做结构分析"步骤。事实来自
      // derivedTree 自身（rootNodeId 的直接子节点 + 树深度），不造步骤、不造数据。
      emitSpecTreeShapeAnalysis(
        specTreeEmitter,
        derivationResult.tree.rootNodeId,
        derivedNodes,
      );

      specTreeEmitter?.completed(
        `SPEC 树派生完成，共 ${derivedNodes.length} 个节点`,
      );

      // 成功路径：使用 LLM 推导的 nodes / rootNodeId 与 provenance 摘要，
      // 但保留外层 wrapper 的 selectionId / specTreeId / artifactLinks /
      // reused* 字段，确保后续投影路径不变。
      const derivedTree = derivationResult.tree;
      ctx.logger?.debug(
        "[blueprint.spec_tree] LLM derivation succeeded; using LLM tree",
        {
          jobId: input.job.id,
          contextTier: derivationResult.contextTier,
          model: derivationResult.model,
        },
      );
      return {
        id: specTreeId,
        routeSetId: input.routeSet.id,
        selectionId: input.selection.id,
        selectedPathId: input.selection.selectedPathId ?? input.selectedRoute.id,
        selectedRouteId: input.selectedRoute.id,
        rootNodeId: derivedTree.rootNodeId,
        version: 1,
        status: "reviewing",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        alternativeRouteIds,
        nodes: derivedTree.nodes,
        provenance: {
          jobId: input.job.id,
          projectId: input.job.projectId,
          sourceId: input.job.sourceId,
          routeSetId: input.routeSet.id,
          routeId: input.selectedRoute.id,
          selectionId: input.selection.id,
          selectedPathId:
            input.selection.selectedPathId ?? input.selectedRoute.id,
          specTreeId,
          targetText: input.job.request.targetText,
          githubUrls: input.job.request.githubUrls ?? [],
          artifactLinks: input.artifactLinks,
          reusedRoleFindingIds: collectRoleFindingIds(previousRoleFindings),
          reusedRoleIds: collectRoleFindingRoleIds(previousRoleFindings),
          reusedEvidenceIds: collectRoleFindingEvidenceIds(previousRoleFindings),
          generationSource: "llm",
          promptId: derivationResult.promptId,
          model: derivationResult.model,
          promptFingerprint: derivationResult.promptFingerprint,
          responseDigest: derivationResult.responseDigest,
        },
      };
    }
    // 失败 / fallback：fall through 到既有 specTreeLlmService + 模板分支，
    // 保持既有 fallback 语义不变。
    specTreeEmitter?.observing(
      false,
      `SPEC 树 LLM 派生回退：${derivationResult.fallbackReason ?? "未知原因"}，将走模板分支`,
    );
    ctx.logger?.debug(
      "[blueprint.spec_tree] LLM derivation fell back to template",
      {
        jobId: input.job.id,
        contextTier: derivationResult.contextTier,
        fallbackReason: derivationResult.fallbackReason,
      },
    );
  }

  // Attempt LLM-driven SPEC Tree generation via ctx.specTreeLlmService
  const serviceResult = await ctx.specTreeLlmService?.({
    jobId: input.job.id,
    job: input.job,
    request: input.job.request,
    routeSet: input.routeSet,
    primaryRoute: input.selectedRoute,
    alternativeRoutes: input.routeSet.routes.filter(r => r.id !== input.selectedRoute.id),
    clarificationSession: input.clarificationSession,
    domainContext: input.domainContext,
    aigcSpecNodeEvidence: input.aigcSpecNodeEvidence,
    createdAt: input.createdAt,
    rootNodeId,
  });

  let nodes: BlueprintSpecTreeNode[];
  let provenanceExtras: {
    generationSource?: "llm" | "llm_fallback" | "template";
    promptId?: string;
    model?: string;
    responseDigest?: string;
    structuredPayloadDigest?: string;
    promptFingerprint?: string;
    error?: string;
  };

  if (serviceResult?.generationSource === "llm" && serviceResult.nodes) {
    // LLM real path: use LLM-generated nodes
    nodes = serviceResult.nodes;
    provenanceExtras = {
      generationSource: "llm",
      promptId: serviceResult.promptId,
      model: serviceResult.model,
      responseDigest: serviceResult.responseDigest,
      structuredPayloadDigest: serviceResult.structuredPayloadDigest,
      promptFingerprint: serviceResult.promptFingerprint,
    };
  } else {
    // Template / llm_fallback path: use template scaffold
    nodes = buildTemplateSpecTreeNodes({
      rootNodeId,
      selectedRoute: input.selectedRoute,
      routeSet: input.routeSet,
      selection: input.selection,
      previousRoleFindings,
      targetTitle,
    });
    provenanceExtras = {
      generationSource: serviceResult?.generationSource ?? "template",
      promptId: serviceResult?.promptId,
      model: serviceResult?.model,
      promptFingerprint: serviceResult?.promptFingerprint,
      error: serviceResult?.error,
    };
  }

  return {
    id: specTreeId,
    routeSetId: input.routeSet.id,
    selectionId: input.selection.id,
    selectedPathId: input.selection.selectedPathId ?? input.selectedRoute.id,
    selectedRouteId: input.selectedRoute.id,
    rootNodeId: serviceResult?.generationSource === "llm" && serviceResult.rootNodeId
      ? serviceResult.rootNodeId
      : rootNodeId,
    version: 1,
    status: "reviewing",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    alternativeRouteIds,
    nodes,
    provenance: {
      jobId: input.job.id,
      projectId: input.job.projectId,
      sourceId: input.job.sourceId,
      routeSetId: input.routeSet.id,
      routeId: input.selectedRoute.id,
      selectionId: input.selection.id,
      selectedPathId: input.selection.selectedPathId ?? input.selectedRoute.id,
      specTreeId,
      targetText: input.job.request.targetText,
      githubUrls: input.job.request.githubUrls ?? [],
      artifactLinks: input.artifactLinks,
      reusedRoleFindingIds: collectRoleFindingIds(previousRoleFindings),
      reusedRoleIds: collectRoleFindingRoleIds(previousRoleFindings),
      reusedEvidenceIds: collectRoleFindingEvidenceIds(previousRoleFindings),
      ...provenanceExtras,
    },
  };
}

function createDownstreamSpecTreeNodes(input: {
  parentId: string;
  routeId: string;
  startPriority: number;
}): BlueprintSpecTreeNode[] {
  const downstream: Array<{
    title: string;
    summary: string;
    type: BlueprintSpecTreeNodeType;
    outputs: string[];
  }> = [
    {
      title: "Specification document generation",
      summary:
        "Expand the selected SPEC tree into requirements, design, and tasks for each important node.",
      type: "spec_document",
      outputs: ["requirements.md", "design.md", "tasks.md"],
    },
    {
      title: "Effect preview",
      summary:
        "Preview architecture, progress plan, expected UI/prototype direction, and step-by-step implementation effect before coding.",
      type: "effect_preview",
      outputs: ["architecture diagram", "prototype notes", "progress plan"],
    },
    {
      title: "Implementation prompt package",
      summary:
        "Package the selected future implementation into prompts that can be used by Cursor, Kiro, Trae, Windsurf, Codex, Claude, and similar tools.",
      type: "prompt_package",
      outputs: ["platform prompts", "acceptance checklist"],
    },
    {
      title: "Engineering landing",
      summary:
        "Reserve the later execution bridge that turns accepted SPEC assets into repository changes and run evidence.",
      type: "engineering_plan",
      outputs: ["landing plan", "run evidence"],
    },
  ];

  return downstream.map((item, index) =>
    createSpecTreeNode({
      parentId: input.parentId,
      title: item.title,
      summary: item.summary,
      type: item.type,
      status: "seed",
      priority: input.startPriority + index,
      routeId: input.routeId,
      outputs: item.outputs,
      dependencies: index === 0 ? [] : [downstream[index - 1].type],
    })
  );
}

function createSpecTreeNode(input: {
  parentId: string;
  title: string;
  summary: string;
  type: BlueprintSpecTreeNodeType;
  status: BlueprintSpecTreeNodeStatus;
  priority: number;
  routeId?: string;
  routeStepId?: string;
  dependencies?: string[];
  outputs?: string[];
  metadata?: Record<string, string | number | boolean | string[]>;
}): BlueprintSpecTreeNode {
  return {
    id: createId("blueprint-spec-node"),
    parentId: input.parentId,
    title: input.title,
    summary: input.summary,
    type: input.type,
    status: input.status,
    priority: input.priority,
    routeId: input.routeId,
    routeStepId: input.routeStepId,
    dependencies: input.dependencies ?? [],
    outputs: input.outputs ?? [],
    children: [],
    metadata: input.metadata,
  };
}

async function listBlueprintSpecNames(specsRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(specsRoot, { withFileTypes: true });
    return entries
      .filter(
        entry => entry.isDirectory() && entry.name.startsWith("blueprint-")
      )
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readBlueprintSpec(
  specsRoot: string,
  id: string,
  fallbackIndex: number
): Promise<BlueprintSpecSummary> {
  const specPath = path.join(specsRoot, id);
  const requirementsPath = path.join(specPath, "requirements.md");
  const designPath = path.join(specPath, "design.md");
  const tasksPath = path.join(specPath, "tasks.md");
  const configPath = path.join(specPath, CONFIG_FILE);

  const docs: BlueprintSpecDocs = {
    requirements: await isFile(requirementsPath),
    design: await isFile(designPath),
    tasks: await isFile(tasksPath),
    config: await isFile(configPath),
  };

  const [requirementsText, designText, tasksText, configText] =
    await Promise.all([
      docs.requirements ? readUtf8(requirementsPath) : Promise.resolve(""),
      docs.design ? readUtf8(designPath) : Promise.resolve(""),
      docs.tasks ? readUtf8(tasksPath) : Promise.resolve(""),
      docs.config ? readUtf8(configPath) : Promise.resolve(""),
    ]);

  const config = parseConfigMetadata(configText);
  const known = BLUEPRINT_METADATA[id];
  const title =
    readString(config.title) ??
    readString(config.name) ??
    extractTitle(tasksText, designText, requirementsText) ??
    humanizeBlueprintId(id);
  const summary =
    readString(config.summary) ??
    extractSummary(requirementsText) ??
    extractSummary(designText) ??
    "";
  const order =
    readOrder(config.order) ?? known?.order ?? 1000 + fallbackIndex + 1;
  const phase = readString(config.phase) ?? known?.phase ?? "other";
  const taskStats = docs.tasks
    ? countTopLevelTasks(tasksText)
    : { completed: 0, total: 0 };

  return {
    id,
    title,
    phase,
    order,
    summary,
    path: displayPath(specPath),
    docs,
    taskStats,
    status: getStatus(docs),
  };
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readUtf8(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

function parseConfigMetadata(content: string): BlueprintConfigMetadata {
  if (!content.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return isPlainRecord(parsed) ? (parsed as BlueprintConfigMetadata) : {};
  } catch {
    return {};
  }
}

function extractTitle(...documents: string[]): string | undefined {
  for (const document of documents) {
    const heading = firstMarkdownHeading(document);
    if (!heading) continue;

    const title = normalizeTitle(heading);
    if (title) return title;
  }

  return undefined;
}

function firstMarkdownHeading(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function normalizeTitle(heading: string): string | undefined {
  const title = heading
    .replace(/^design document\s*[:：]?\s*/i, "")
    .replace(/^requirements document\s*[:：]?\s*/i, "")
    .replace(/^tasks?\s*[:：]?\s*/i, "")
    .replace(/^design\s*[:：]?\s*/i, "")
    .replace(/^requirements\s*[:：]?\s*/i, "")
    .replace(/^task list\s*[:：]?\s*/i, "")
    .replace(/^设计文档\s*[:：]?\s*/, "")
    .replace(/^需求文档\s*[:：]?\s*/, "")
    .replace(/^任务(?:清单|列表)?\s*[:：]?\s*/, "")
    .replace(/\s*(task list|tasks?)\s*$/i, "")
    .replace(/\s*(任务(?:清单|列表)?)\s*$/, "")
    .trim();

  if (!title) {
    return undefined;
  }

  if (
    /^(requirements document|design document|task list|tasks?)$/i.test(title)
  ) {
    return undefined;
  }

  if (/^(需求文档|设计文档|任务(?:清单|列表)?)$/.test(title)) {
    return undefined;
  }

  return title;
}

function extractSummary(markdown: string): string | undefined {
  const overviewLines = extractSectionLines(markdown, [
    /^introduction$/i,
    /^overview$/i,
    /^summary$/i,
    /^description$/i,
    /^scope$/i,
    /^简介$/,
    /^概述$/,
    /^介绍$/,
    /^背景$/,
  ]);

  const overview = firstParagraph(overviewLines);
  if (overview) return overview;

  return firstParagraph(markdown.split(/\r?\n/).slice(1));
}

function extractSectionLines(
  markdown: string,
  headingPatterns: RegExp[]
): string[] {
  const lines = markdown.split(/\r?\n/);
  const section: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading?.[1]) {
      if (inSection) {
        break;
      }

      const normalizedHeading = heading[1].trim();
      inSection = headingPatterns.some(pattern =>
        pattern.test(normalizedHeading)
      );
      continue;
    }

    if (inSection) {
      section.push(line);
    }
  }

  return section;
}

function firstParagraph(lines: string[]): string | undefined {
  const paragraph: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence || isStructuralMarkdown(trimmed)) {
      continue;
    }

    if (!trimmed) {
      if (paragraph.length > 0) {
        return cleanMarkdown(paragraph.join(" "));
      }
      continue;
    }

    paragraph.push(trimmed);
  }

  return paragraph.length > 0 ? cleanMarkdown(paragraph.join(" ")) : undefined;
}

function isStructuralMarkdown(line: string): boolean {
  return (
    !line ||
    line.startsWith("#") ||
    line.startsWith("- ") ||
    line.startsWith("* ") ||
    line.startsWith("|") ||
    /^\d+[.)]\s+/.test(line)
  );
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlueprintGenerationJob(
  value: unknown
): value is BlueprintGenerationJob {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    isPlainRecord(value.request) &&
    typeof value.status === "string" &&
    typeof value.stage === "string" &&
    typeof value.version === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.artifacts) &&
    Array.isArray(value.events)
  );
}

function countTopLevelTasks(markdown: string): BlueprintTaskStats {
  const stats: BlueprintTaskStats = { completed: 0, total: 0 };
  const topLevelTaskPattern = /^-\s+\[([ xX])\]\s+\d+[.)](?:\s|$)/;

  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(topLevelTaskPattern);
    if (!match) continue;

    stats.total += 1;
    if (match[1]?.toLowerCase() === "x") {
      stats.completed += 1;
    }
  }

  return stats;
}

function getStatus(docs: BlueprintSpecDocs): BlueprintSpecStatus {
  const docCount = countDocs(docs);
  if (docCount === 0) {
    return "empty";
  }

  return docCount === DOC_NAMES.length ? "ready" : "partial";
}

function countDocs(docs: BlueprintSpecDocs): number {
  return Object.values(docs).filter(Boolean).length;
}

function humanizeBlueprintId(id: string): string {
  return id
    .replace(/^blueprint-/, "")
    .split("-")
    .filter(Boolean)
    .map(
      word =>
        KNOWN_WORD_LABELS[word] ?? word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

function readGithubUrlInputs(...values: unknown[]): string[] {
  return values
    .flatMap(value => {
      if (Array.isArray(value)) {
        return value;
      }
      if (typeof value === "string") {
        return value.split(/[\n,]+/);
      }
      return [];
    })
    .map(item => readString(item))
    .filter(isString);
}

function parseGithubSources(urls: string[]): {
  sources: BlueprintGithubSource[];
  duplicates: BlueprintGithubSource[];
} {
  const sources: BlueprintGithubSource[] = [];
  const duplicates: BlueprintGithubSource[] = [];
  const sourceByNormalizedUrl = new Map<string, BlueprintGithubSource>();

  urls.forEach((url, index) => {
    const parsed = parseGithubSource(url);
    if (!parsed) return;

    const duplicateOf = sourceByNormalizedUrl.get(parsed.normalizedUrl);
    if (duplicateOf) {
      duplicates.push({
        ...parsed,
        id: `${duplicateOf.id}:duplicate-${index + 1}`,
        duplicateOf: duplicateOf.id,
      });
      return;
    }

    sourceByNormalizedUrl.set(parsed.normalizedUrl, parsed);
    sources.push(parsed);
  });

  return { sources, duplicates };
}

function parseGithubSource(url: string): BlueprintGithubSource | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname.toLowerCase() !== "github.com") {
    return null;
  }

  const segments = parsedUrl.pathname
    .split("/")
    .map(segment => segment.trim())
    .filter(Boolean);
  const owner = segments[0]?.toLowerCase();
  const repo = segments[1]?.replace(/\.git$/i, "").toLowerCase();
  if (!owner || !repo) {
    return null;
  }

  const sourceSlug = `${owner}/${repo}`;
  const normalizedUrl = `https://github.com/${sourceSlug}`;
  const branch =
    (segments[2] === "tree" || segments[2] === "blob") && segments[3]
      ? segments[3]
      : undefined;
  const sourcePath =
    branch && segments.length > 4 ? segments.slice(4).join("/") : undefined;

  return {
    id: stableId("blueprint-source", sourceSlug),
    kind: "repository",
    url,
    normalizedUrl,
    owner,
    repo,
    slug: sourceSlug,
    branch,
    path: sourcePath,
    evidenceIds: [stableId("blueprint-evidence-github-url", normalizedUrl)],
  };
}

function buildIntakeEvidence(
  request: BlueprintIntakeRequest,
  sources: BlueprintGithubSource[],
  createdAt: string
): BlueprintDomainEvidence[] {
  const evidence: BlueprintDomainEvidence[] = [];

  if (request.targetText) {
    evidence.push({
      id: stableId("blueprint-evidence-intake-text", request.targetText),
      kind: "intake_text",
      label: "Target input",
      summary: summarizeText(request.targetText, 120),
      value: request.targetText,
      createdAt,
    });
  }

  for (const source of sources) {
    evidence.push({
      id: stableId("blueprint-evidence-github-url", source.normalizedUrl),
      kind: "github_url",
      label: `${source.owner}/${source.repo}`,
      summary: `GitHub repository URL parsed as ${source.owner}/${source.repo}.`,
      value: source.normalizedUrl,
      sourceId: source.id,
      createdAt,
    });
  }

  for (const note of request.domainNotes ?? []) {
    evidence.push({
      id: stableId("blueprint-evidence-domain-note", note),
      kind: "intake_text",
      label: "Domain note",
      summary: summarizeText(note, 120),
      value: note,
      createdAt,
    });
  }

  return dedupeById(evidence);
}

function buildIntakeAssets(
  request: BlueprintIntakeRequest,
  sources: BlueprintGithubSource[],
  evidence: BlueprintDomainEvidence[],
  createdAt: string
): BlueprintDomainAsset[] {
  const assets: BlueprintDomainAsset[] = [];
  const evidenceByValue = new Map(evidence.map(item => [item.value, item]));

  if (request.targetText) {
    const targetEvidence = evidenceByValue.get(request.targetText);
    assets.push({
      id: stableId("blueprint-asset-goal", request.targetText),
      kind: "product_goal",
      title: "Product Goal",
      summary: summarizeText(request.targetText, 160),
      sourceIds: [],
      evidenceIds: targetEvidence ? [targetEvidence.id] : [],
      tags: ["intake", "goal"],
      createdAt,
    });
  }

  for (const source of sources) {
    assets.push({
      id: stableId("blueprint-asset-github", source.normalizedUrl),
      kind: "github_repository",
      title: `${source.owner}/${source.repo}`,
      summary: `Repository context placeholder for ${source.normalizedUrl}.`,
      sourceIds: [source.id],
      evidenceIds: source.evidenceIds,
      tags: ["github", "source"],
      createdAt,
    });
  }

  for (const note of request.domainNotes ?? []) {
    const noteEvidence = evidenceByValue.get(note);
    assets.push({
      id: stableId("blueprint-asset-domain-note", note),
      kind: "domain_note",
      title: "Domain Note",
      summary: summarizeText(note, 160),
      sourceIds: [],
      evidenceIds: noteEvidence ? [noteEvidence.id] : [],
      tags: ["domain", "intake"],
      createdAt,
    });
  }

  return dedupeById(assets);
}

interface BlueprintClarificationStrategyTemplate {
  id: BlueprintClarificationStrategyId;
  label: string;
  templateId: string;
  summary: string;
  questionIds: string[];
  settledQuestionIds?: string[];
}

interface BlueprintClarificationQuestionBlueprint {
  id: string;
  kind: BlueprintClarificationQuestion["kind"];
  prompt: string;
  required: boolean;
  routeDimension: BlueprintClarificationRouteDimension;
  readinessSignal: BlueprintClarificationReadinessSignalId;
  sourceScope?: "none" | "all" | "github";
  defaultAnswer?: (intake: BlueprintIntake) => string | undefined;
}

const CLARIFICATION_STRATEGY_TEMPLATES: BlueprintClarificationStrategyTemplate[] = [
  {
    id: "target_first",
    label: "Target-first clarification",
    templateId: "clarification-template-target-first",
    summary: "Start from the desired outcome, then bind audience, risk, and durable assets.",
    questionIds: [
      "blueprint-question-goal",
      "blueprint-question-audience",
      "blueprint-question-constraints",
      "blueprint-question-domain-assets",
    ],
  },
  {
    id: "repository_first",
    label: "Repository-first clarification",
    templateId: "clarification-template-repository-first",
    summary: "Use repository context as the first route anchor before target and risk refinement.",
    questionIds: [
      "blueprint-question-goal",
      "blueprint-question-audience",
      "blueprint-question-constraints",
      "blueprint-question-github-role",
      "blueprint-question-domain-assets",
    ],
  },
  {
    id: "risk_first",
    label: "Risk-first clarification",
    templateId: "clarification-template-risk-first",
    summary: "Surface constraints and high-risk assumptions before routing execution.",
    questionIds: [
      "blueprint-question-constraints",
      "blueprint-question-risk-review",
      "blueprint-question-goal",
      "blueprint-question-audience",
      "blueprint-question-domain-assets",
    ],
  },
  {
    id: "document_first",
    label: "Document-first clarification",
    templateId: "clarification-template-document-first",
    summary: "Stabilize requirements, design, and task document intent before preview work.",
    questionIds: [
      "blueprint-question-goal",
      "blueprint-question-document-shape",
      "blueprint-question-constraints",
      "blueprint-question-audience",
      "blueprint-question-domain-assets",
    ],
  },
  {
    id: "preview_first",
    label: "Preview-first clarification",
    templateId: "clarification-template-preview-first",
    summary: "Prioritize visible effect preview expectations before route and document handoff.",
    questionIds: [
      "blueprint-question-goal",
      "blueprint-question-preview-target",
      "blueprint-question-audience",
      "blueprint-question-constraints",
      "blueprint-question-domain-assets",
    ],
    settledQuestionIds: ["blueprint-question-domain-assets"],
  },
  {
    id: "fast_execution",
    label: "Fast-execution clarification",
    templateId: "clarification-template-fast-execution",
    summary: "Ask only the blocking execution questions and settle optional routing preferences by strategy.",
    questionIds: [
      "blueprint-question-goal",
      "blueprint-question-constraints",
      "blueprint-question-execution-slice",
      "blueprint-question-audience",
      "blueprint-question-domain-assets",
    ],
    settledQuestionIds: [
      "blueprint-question-audience",
      "blueprint-question-domain-assets",
    ],
  },
];

const CLARIFICATION_QUESTION_BLUEPRINTS: BlueprintClarificationQuestionBlueprint[] = [
  {
    id: "blueprint-question-goal",
    kind: "goal",
    prompt: "What outcome should the blueprint optimize for first?",
    required: true,
    routeDimension: "goal",
    readinessSignal: "goal_defined",
    sourceScope: "none",
  },
  {
    id: "blueprint-question-audience",
    kind: "audience",
    prompt: "Who is the primary user or operator for this project?",
    required: true,
    routeDimension: "audience",
    readinessSignal: "audience_defined",
    sourceScope: "none",
    defaultAnswer: intake =>
      intake.targetText
        ? "Use the audience implied by the target request until the user narrows it."
        : undefined,
  },
  {
    id: "blueprint-question-constraints",
    kind: "constraint",
    prompt: "What constraints, integrations, or risks must the route preserve?",
    required: true,
    routeDimension: "risk",
    readinessSignal: "constraints_defined",
    sourceScope: "all",
  },
  {
    id: "blueprint-question-github-role",
    kind: "github",
    prompt: "How should the GitHub repository influence the first RouteSet?",
    required: true,
    routeDimension: "repository",
    readinessSignal: "repository_context",
    sourceScope: "github",
    defaultAnswer: intake =>
      intake.sources.length > 0
        ? `Treat ${intake.sources[0].slug} as the first repository context source.`
        : undefined,
  },
  {
    id: "blueprint-question-domain-assets",
    kind: "domain",
    prompt: "Which durable domain assets should be carried into later stages?",
    required: false,
    routeDimension: "domain",
    readinessSignal: "domain_assets",
    sourceScope: "all",
    defaultAnswer: intake =>
      intake.assets.length > 0
        ? "Carry forward normalized intake assets and repository evidence."
        : undefined,
  },
  {
    id: "blueprint-question-risk-review",
    kind: "constraint",
    prompt: "Which risk should block autopilot execution until explicitly reviewed?",
    required: true,
    routeDimension: "risk",
    readinessSignal: "risk_review",
    sourceScope: "all",
  },
  {
    id: "blueprint-question-document-shape",
    kind: "document",
    prompt: "Which requirements, design, or task documents should be generated first?",
    required: true,
    routeDimension: "document",
    readinessSignal: "document_intent",
    sourceScope: "all",
  },
  {
    id: "blueprint-question-preview-target",
    kind: "preview",
    prompt: "What preview behavior should prove the route is heading in the right direction?",
    required: true,
    routeDimension: "preview",
    readinessSignal: "preview_intent",
    sourceScope: "all",
  },
  {
    id: "blueprint-question-execution-slice",
    kind: "execution",
    prompt: "What is the smallest execution slice that should run first?",
    required: true,
    routeDimension: "execution",
    readinessSignal: "fast_path",
    sourceScope: "all",
  },
];

function selectClarificationStrategy(
  intake: BlueprintIntake,
  request?: BlueprintClarificationSessionRequest
): BlueprintClarificationStrategyTemplate {
  const requestedStrategy = request?.strategyId
    ? getClarificationStrategyTemplate(request.strategyId)
    : undefined;
  if (requestedStrategy) {
    return overrideClarificationTemplateId(requestedStrategy, request?.templateId);
  }

  const searchableText = [intake.targetText, ...intake.domainNotes]
    .filter(isString)
    .join(" ")
    .toLowerCase();
  const inferredStrategyId: BlueprintClarificationStrategyId =
    intake.sources.length > 0
      ? "repository_first"
      : /\b(preview|prototype|ui|screen|visual)\b/.test(searchableText)
        ? "preview_first"
        : /\b(doc|docs|document|requirement|design|task|spec)\b/.test(searchableText)
          ? "document_first"
          : /\b(risk|security|compliance|audit|privacy|permission)\b/.test(searchableText)
            ? "risk_first"
            : /\b(fast|quick|mvp|asap|execute|execution)\b/.test(searchableText)
              ? "fast_execution"
              : "target_first";

  return overrideClarificationTemplateId(
    getClarificationStrategyTemplate(inferredStrategyId),
    request?.templateId
  );
}

function overrideClarificationTemplateId(
  strategy: BlueprintClarificationStrategyTemplate,
  templateId?: string
): BlueprintClarificationStrategyTemplate {
  return templateId ? { ...strategy, templateId } : strategy;
}

function getClarificationStrategyTemplate(
  strategyId: BlueprintClarificationStrategyId
): BlueprintClarificationStrategyTemplate {
  return (
    CLARIFICATION_STRATEGY_TEMPLATES.find(strategy => strategy.id === strategyId) ??
    CLARIFICATION_STRATEGY_TEMPLATES[0]
  );
}

function normalizeClarificationStrategyId(
  value: string
): BlueprintClarificationStrategyId | undefined {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
  return CLARIFICATION_STRATEGY_TEMPLATES.some(
    strategy => strategy.id === normalized
  )
    ? (normalized as BlueprintClarificationStrategyId)
    : undefined;
}

function buildClarificationQuestions(
  intake: BlueprintIntake,
  strategy: BlueprintClarificationStrategyTemplate
): BlueprintClarificationQuestion[] {
  const settledQuestionIds = new Set(strategy.settledQuestionIds ?? []);
  const blueprintsById = new Map(
    CLARIFICATION_QUESTION_BLUEPRINTS.map(question => [question.id, question])
  );
  const selectedIds = strategy.questionIds.filter(questionId => {
    if (questionId === "blueprint-question-github-role") {
      return intake.sources.length > 0;
    }
    return true;
  });

  return selectedIds.flatMap(questionId => {
    const blueprint = blueprintsById.get(questionId);
    if (!blueprint) return [];

    const settledByStrategy = settledQuestionIds.has(questionId);
    const sourceIds =
      blueprint.sourceScope === "github"
        ? intake.sources.map(source => source.id)
        : blueprint.sourceScope === "all"
          ? intake.sources.map(source => source.id)
          : [];
    const evidenceIds =
      blueprint.sourceScope === "github"
        ? intake.sources.flatMap(source => source.evidenceIds)
        : blueprint.sourceScope === "all"
          ? intake.evidence.map(item => item.id)
          : intake.evidence.map(item => item.id);

    return [
      {
        id: blueprint.id,
        kind: blueprint.kind,
        prompt: blueprint.prompt,
        required: settledByStrategy ? false : blueprint.required,
        sourceIds,
        evidenceIds,
        routeDimension: blueprint.routeDimension,
        readinessSignal: blueprint.readinessSignal,
        templateId: strategy.templateId,
        strategyId: strategy.id,
        generationSource: "template",
        settledByStrategy,
        settledReason: settledByStrategy
          ? `${strategy.label} uses a strategy default for this route dimension.`
          : undefined,
        defaultAnswer: blueprint.defaultAnswer?.(intake),
      },
    ];
  });
}

interface LlmClarificationQuestionDraft {
  id?: unknown;
  prompt?: unknown;
  question?: unknown;
  text?: unknown;
  type?: unknown;
  options?: unknown;
  context?: unknown;
  required?: unknown;
  routeDimension?: unknown;
  route_dimension?: unknown;
  readinessSignal?: unknown;
  readiness_signal?: unknown;
  kind?: unknown;
  defaultAnswer?: unknown;
  default_answer?: unknown;
}

interface LlmClarificationQuestionsPayload {
  questions?: LlmClarificationQuestionDraft[];
  summary?: unknown;
}

async function generateClarificationQuestionsWithLlm(
  input: BlueprintClarificationQuestionGeneratorInput
): Promise<BlueprintClarificationQuestionGenerationResult> {
  const aiConfig = getAIConfig();
  const promptId = stableId(
    "blueprint-clarification-llm-prompt",
    `${input.intake.id}-${input.strategy.id}-${input.strategy.templateId}`
  );
  if (!aiConfig.apiKey) {
    return {
      questions: input.templateQuestions,
      source: "llm_fallback",
      model: aiConfig.model,
      promptId,
      error: "LLM provider is not configured; using strategy template questions.",
    };
  }

  try {
    const preview = await defaultPreviewClarificationQuestions({
      commandText: buildBlueprintClarificationPreviewCommand(input),
      userId: "blueprint-autopilot",
      priority: input.strategy.id === "fast_execution" ? "high" : "medium",
      locale: input.locale ?? "en-US",
    });
    const previewQuestions = mapPreviewClarificationQuestionsToBlueprint(
      preview,
      input.templateQuestions,
      input.strategy,
      {
        source: "llm",
        model: aiConfig.model,
        promptId,
      }
    );
    if (previewQuestions.length) {
      return {
        questions: previewQuestions,
        source: "llm",
        model: aiConfig.model,
        promptId,
      };
    }

    const clarificationLocale = input.locale ?? "en-US";
    const systemContent = clarificationLocale === "zh-CN"
      ? "你是 /autopilot 澄清规划器。遵循现有的启动澄清行为：仅以 JSON 格式返回 1 到 3 个简洁、高信号的问题。优先使用 single_choice 或 multi_choice 并提供 2 到 4 个简短选项。每个问题必须关联提供的模板 id、路线维度和就绪信号。不要重复提问。用中文撰写问题文本。"
      : "You are the /autopilot clarification planner. Follow the existing launch clarification behavior: return 1 to 3 concise, clickable, high-signal questions as JSON only. Prefer single_choice or multi_choice with 2 to 4 short options. Keep every question tied to the provided template ids, route dimensions, and readiness signals. Do not ask duplicate questions.";

    const payload = await callLLMJson<LlmClarificationQuestionsPayload>(
      [
        {
          role: "system",
          content: systemContent,
        },
        {
          role: "user",
          content: JSON.stringify({
            promptId,
            targetText: input.intake.targetText ?? "",
            githubUrls: input.intake.githubUrls,
            sources: input.intake.sources.map(source => ({
              id: source.id,
              slug: source.slug,
              url: source.normalizedUrl,
            })),
            domainNotes: input.intake.domainNotes,
            assets: input.intake.assets.map(asset => ({
              id: asset.id,
              title: asset.title,
              summary: asset.summary,
              tags: asset.tags,
            })),
            strategy: {
              id: input.strategy.id,
              label: input.strategy.label,
              templateId: input.strategy.templateId,
              summary: input.strategy.summary,
            },
            templateQuestions: input.templateQuestions.map(question => ({
              id: question.id,
              kind: question.kind,
              prompt: question.prompt,
              required: question.required,
              routeDimension: question.routeDimension,
              readinessSignal: question.readinessSignal,
              settledByStrategy: question.settledByStrategy,
              defaultAnswer: question.defaultAnswer,
            })),
            outputSchema: {
              questions: [
                {
                  id: "reuse the provided question id when adapting a template question",
                  prompt: "question text",
                  type: "single_choice|multi_choice|free_text",
                  options: ["2 to 4 concise options when type is choice-based"],
                  context: "short reason why this answer affects the route",
                  required: true,
                  kind: "goal|audience|constraint|github|domain|document|preview|execution",
                  routeDimension:
                    "goal|audience|risk|repository|domain|document|preview|output|execution|handoff",
                  readinessSignal:
                    "goal_defined|audience_defined|constraints_defined|repository_context|domain_assets|document_intent|preview_intent|output_preference|risk_review|fast_path",
                  defaultAnswer: "optional assumption",
                },
              ],
              summary: "one-sentence route readiness focus",
            },
          }),
        },
      ],
      {
        model: aiConfig.model,
        temperature: 0.2,
        maxTokens: 1200,
        retryAttempts: 1,
        timeoutMs: Number(process.env.BLUEPRINT_CLARIFICATION_LLM_TIMEOUT_MS || 20000),
        sessionId: input.intake.id,
      }
    );

    const generatedQuestions = normalizeLlmClarificationQuestions(
      payload,
      input.templateQuestions,
      input.strategy,
      {
        source: "llm",
        model: aiConfig.model,
        promptId,
      }
    );

    return {
      questions: generatedQuestions.length
        ? generatedQuestions
        : input.templateQuestions,
      source: generatedQuestions.length ? "llm" : "llm_fallback",
      model: aiConfig.model,
      promptId,
      error: generatedQuestions.length
        ? undefined
        : "LLM returned no usable clarification questions; using strategy template questions.",
    };
  } catch (error) {
    return {
      questions: input.templateQuestions,
      source: "llm_fallback",
      model: aiConfig.model,
      promptId,
      error: errorMessage(error),
    };
  }
}

function normalizeLlmClarificationQuestions(
  payload: LlmClarificationQuestionsPayload,
  templateQuestions: BlueprintClarificationQuestion[],
  strategy: BlueprintClarificationStrategyTemplate,
  metadata: {
    source: BlueprintClarificationGenerationSource;
    model?: string;
    promptId?: string;
  }
): BlueprintClarificationQuestion[] {
  const templateById = new Map(
    templateQuestions.map(question => [question.id, question])
  );
  const drafts = Array.isArray(payload?.questions) ? payload.questions : [];
  const normalized = drafts
    .map((draft, index) => {
      const requestedId = readString(draft.id);
      const template =
        (requestedId ? templateById.get(requestedId) : undefined) ??
        templateQuestions[index];
      if (!template) return undefined;

      return normalizeGeneratedClarificationQuestion(
        {
          ...template,
          prompt:
            readString(draft.prompt ?? draft.question ?? draft.text) ??
            template.prompt,
          type:
            normalizeClarificationQuestionType(draft.type) ?? template.type,
          options:
            normalizeClarificationQuestionOptions(draft.options) ??
            template.options,
          context: readString(draft.context) ?? template.context,
          required:
            readBoolean(draft.required) ??
            template.required,
          kind:
            normalizeClarificationQuestionKind(draft.kind) ?? template.kind,
          routeDimension:
            normalizeClarificationRouteDimension(
              draft.routeDimension ?? draft.route_dimension
            ) ?? template.routeDimension,
          readinessSignal:
            normalizeClarificationReadinessSignal(
              draft.readinessSignal ?? draft.readiness_signal
            ) ?? template.readinessSignal,
          defaultAnswer:
            readString(draft.defaultAnswer ?? draft.default_answer) ??
            template.defaultAnswer,
        },
        strategy,
        metadata
      );
    })
    .filter((question): question is BlueprintClarificationQuestion =>
      Boolean(question)
    );

  return normalized.length >= Math.min(2, templateQuestions.length)
    ? dedupeClarificationQuestions(normalized)
    : [];
}

function buildBlueprintClarificationPreviewCommand(
  input: BlueprintClarificationQuestionGeneratorInput
): string {
  return [
    input.intake.targetText,
    input.intake.githubUrls.length
      ? `GitHub: ${input.intake.githubUrls.join(", ")}`
      : undefined,
    input.intake.domainNotes.length
      ? `Domain notes: ${input.intake.domainNotes.join("; ")}`
      : undefined,
    input.intake.assets.length
      ? `Known assets: ${input.intake.assets
          .map(asset => `${asset.title}: ${asset.summary}`)
          .join("; ")}`
      : undefined,
    `Clarification strategy: ${input.strategy.label}. ${input.strategy.summary}`,
    `Template focus: ${input.templateQuestions
      .map(question => `${question.routeDimension ?? question.kind}:${question.prompt}`)
      .join(" | ")}`,
  ]
    .filter(isString)
    .join("\n");
}

function mapPreviewClarificationQuestionsToBlueprint(
  preview: { needsClarification?: boolean; questions?: unknown[] },
  templateQuestions: BlueprintClarificationQuestion[],
  strategy: BlueprintClarificationStrategyTemplate,
  metadata: {
    source: BlueprintClarificationGenerationSource;
    model?: string;
    promptId?: string;
  }
): BlueprintClarificationQuestion[] {
  if (preview.needsClarification === false) return [];
  const drafts = Array.isArray(preview.questions) ? preview.questions : [];
  if (drafts.length === 0) return [];

  return dedupeClarificationQuestions(
    drafts
      .slice(0, 3)
      .map((draft, index) => {
        const record = isPlainRecord(draft) ? draft : null;
        const template = templateQuestions[index] ?? templateQuestions[0];
        if (!record || !template) return undefined;
        return normalizeGeneratedClarificationQuestion(
          {
            ...template,
            prompt: readString(record.text ?? record.prompt) ?? template.prompt,
            type:
              normalizeClarificationQuestionType(record.type) ??
              template.type ??
              "single_choice",
            options:
              normalizeClarificationQuestionOptions(record.options) ??
              template.options,
            context: readString(record.context) ?? template.context,
            id: template.id,
          },
          strategy,
          metadata
        );
      })
      .filter((question): question is BlueprintClarificationQuestion =>
        Boolean(question)
      )
  );
}

function normalizeGeneratedClarificationQuestions(
  questions: BlueprintClarificationQuestion[],
  templateQuestions: BlueprintClarificationQuestion[],
  strategy: BlueprintClarificationStrategyTemplate,
  generation: BlueprintClarificationQuestionGenerationResult
): BlueprintClarificationQuestion[] {
  const sourceQuestions = questions.length ? questions : templateQuestions;
  const normalized = sourceQuestions.map((question, index) =>
    normalizeGeneratedClarificationQuestion(
      {
        ...templateQuestions[index],
        ...question,
      },
      strategy,
      {
        source: generation.source,
        model: generation.model,
        promptId: generation.promptId,
      }
    )
  );

  return dedupeClarificationQuestions(normalized);
}

function normalizeGeneratedClarificationQuestion(
  question: BlueprintClarificationQuestion,
  strategy: BlueprintClarificationStrategyTemplate,
  metadata: {
    source: BlueprintClarificationGenerationSource;
    model?: string;
    promptId?: string;
  }
): BlueprintClarificationQuestion {
  return {
    ...question,
    id: question.id || stableId("blueprint-question", question.prompt),
    prompt: question.prompt,
    type:
      question.type ??
      (question.options && question.options.length >= 2
        ? "single_choice"
        : "free_text"),
    options:
      question.options && question.options.length >= 2
        ? question.options.slice(0, 4)
        : undefined,
    context: question.context,
    sourceIds: question.sourceIds ?? [],
    evidenceIds: question.evidenceIds ?? [],
    strategyId: question.strategyId ?? strategy.id,
    templateId: question.templateId ?? strategy.templateId,
    generationSource: metadata.source,
    llmModel: metadata.source === "llm" ? metadata.model : question.llmModel,
    llmPromptId:
      metadata.source === "llm" ? metadata.promptId : question.llmPromptId,
  };
}

function dedupeClarificationQuestions(
  questions: BlueprintClarificationQuestion[]
): BlueprintClarificationQuestion[] {
  const seen = new Set<string>();
  return questions.filter(question => {
    const key = `${question.id}:${question.routeDimension ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeClarificationQuestionKind(
  value: unknown
): BlueprintClarificationQuestion["kind"] | undefined {
  const normalized = readString(value)?.toLowerCase().replace(/[-\s]+/g, "_");
  return normalized === "goal" ||
    normalized === "audience" ||
    normalized === "constraint" ||
    normalized === "github" ||
    normalized === "domain" ||
    normalized === "document" ||
    normalized === "preview" ||
    normalized === "execution"
    ? normalized
    : undefined;
}

function normalizeClarificationQuestionType(
  value: unknown
): BlueprintClarificationQuestion["type"] | undefined {
  const normalized = readString(value)?.toLowerCase().replace(/[-\s]+/g, "_");
  return normalized === "free_text" ||
    normalized === "single_choice" ||
    normalized === "multi_choice"
    ? normalized
    : undefined;
}

function normalizeClarificationQuestionOptions(
  value: unknown
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = Array.from(
    new Set(
      value
        .map(item => readString(item))
        .filter((item): item is string => Boolean(item))
    )
  ).slice(0, 4);
  return options.length >= 2 ? options : undefined;
}

function normalizeClarificationRouteDimension(
  value: unknown
): BlueprintClarificationRouteDimension | undefined {
  const normalized = readString(value)?.toLowerCase().replace(/[-\s]+/g, "_");
  return normalized === "goal" ||
    normalized === "audience" ||
    normalized === "risk" ||
    normalized === "repository" ||
    normalized === "domain" ||
    normalized === "document" ||
    normalized === "preview" ||
    normalized === "output" ||
    normalized === "execution" ||
    normalized === "handoff"
    ? normalized
    : undefined;
}

function normalizeClarificationReadinessSignal(
  value: unknown
): BlueprintClarificationReadinessSignalId | undefined {
  const normalized = readString(value)?.toLowerCase().replace(/[-\s]+/g, "_");
  return normalized === "goal_defined" ||
    normalized === "audience_defined" ||
    normalized === "constraints_defined" ||
    normalized === "repository_context" ||
    normalized === "domain_assets" ||
    normalized === "document_intent" ||
    normalized === "preview_intent" ||
    normalized === "output_preference" ||
    normalized === "risk_review" ||
    normalized === "fast_path"
    ? normalized
    : undefined;
}

function buildClarificationEvidence(
  session: BlueprintClarificationSession,
  createdAt: string
): BlueprintDomainEvidence[] {
  const questionById = new Map(
    session.questions.map(question => [question.id, question])
  );

  return session.answers.map(answer => {
    const question = questionById.get(answer.questionId);
    return {
      id: stableId(
        "blueprint-evidence-clarification",
        `${answer.questionId}-${hashText(`${session.intakeId}-${answer.answer}`)}`
      ),
      kind: "clarification_answer",
      label: question?.prompt ?? answer.questionId,
      summary: summarizeText(answer.answer, 120),
      value: answer.answer,
      sourceId: question?.strategyId,
      createdAt,
    };
  });
}

function buildClarificationAssets(
  session: BlueprintClarificationSession,
  evidence: BlueprintDomainEvidence[],
  createdAt: string
): BlueprintDomainAsset[] {
  const questionById = new Map(
    session.questions.map(question => [question.id, question])
  );
  const evidenceByQuestionId = new Map(
    session.answers
      .map(answer => {
        const matchingEvidence = evidence.find(
          item =>
            item.id ===
            stableId(
              "blueprint-evidence-clarification",
              `${answer.questionId}-${hashText(`${session.intakeId}-${answer.answer}`)}`
            )
        );
        return matchingEvidence
          ? ([matchingEvidence.id, answer.questionId] as const)
          : undefined;
      })
      .filter((item): item is readonly [string, string] => Boolean(item))
  );

  return evidence.map(item => {
    const question = questionById.get(evidenceByQuestionId.get(item.id) ?? "");
    return {
      id: stableId(
        "blueprint-asset-clarification",
        `${question?.id ?? "question"}-${hashText(`${session.intakeId}-${item.id}`)}`
      ),
      kind: "clarification",
      title: "Clarification Answer",
      summary: item.summary,
      sourceIds: [],
      evidenceIds: [item.id],
      tags: uniqueStrings(
        [
          "clarification",
          session.strategyId,
          session.templateId,
          question?.routeDimension,
          question?.readinessSignal,
        ].filter(isString)
      ),
      createdAt,
    };
  });
}

function calculateIntakeReadiness(
  request: BlueprintIntakeRequest,
  sources: BlueprintGithubSource[]
): BlueprintClarificationReadiness {
  const missingQuestionIds = request.targetText || sources.length > 0 ? [] : ["blueprint-question-goal"];

  return {
    status: missingQuestionIds.length === 0 ? "ready" : "needs_answers",
    score: missingQuestionIds.length === 0 ? 1 : 0,
    answeredRequired: missingQuestionIds.length === 0 ? 1 : 0,
    requiredTotal: 1,
    missingQuestionIds,
  };
}

function calculateClarificationReadiness(
  questions: BlueprintClarificationQuestion[],
  answers: BlueprintClarificationAnswer[]
): BlueprintClarificationReadiness {
  const answeredQuestionIds = new Set(
    answers.filter(answer => answer.answer.trim()).map(answer => answer.questionId)
  );
  const settledQuestionIds = questions
    .filter(question => question.settledByStrategy)
    .map(question => question.id);
  const requiredQuestionIds = questions
    .filter(question => question.required && !question.settledByStrategy)
    .map(question => question.id);
  const missingQuestionIds = requiredQuestionIds.filter(
    questionId => !answeredQuestionIds.has(questionId)
  );
  const answeredRequired = requiredQuestionIds.length - missingQuestionIds.length;
  const score =
    requiredQuestionIds.length === 0
      ? 1
      : Number((answeredRequired / requiredQuestionIds.length).toFixed(2));

  return {
    status: missingQuestionIds.length === 0 ? "ready" : "needs_answers",
    score,
    answeredRequired,
    requiredTotal: requiredQuestionIds.length,
    missingQuestionIds,
    readinessSignals: uniqueClarificationReadinessSignals(questions),
    settledQuestionIds,
    routeDimensions: uniqueClarificationRouteDimensions(questions),
  };
}

function normalizeClarificationAnswerForQuestion(
  answer: BlueprintClarificationAnswer,
  question: BlueprintClarificationQuestion,
  answeredAt: string
): BlueprintClarificationAnswer {
  return {
    ...answer,
    answeredAt: answer.answeredAt ?? answeredAt,
    source: answer.source ?? "user",
    provenance: {
      ...answer.provenance,
      strategyId: answer.provenance?.strategyId ?? question.strategyId,
      templateId: answer.provenance?.templateId ?? question.templateId,
      routeDimension:
        answer.provenance?.routeDimension ?? question.routeDimension,
      readinessSignal:
        answer.provenance?.readinessSignal ?? question.readinessSignal,
    },
  };
}

function buildClarificationRouteReadySummary(
  strategy:
    | BlueprintClarificationStrategyTemplate
    | BlueprintClarificationSession,
  readiness: BlueprintClarificationReadiness,
  questions: BlueprintClarificationQuestion[]
): string {
  const label =
    "label" in strategy
      ? strategy.label
      : strategy.strategyLabel ?? "Clarification strategy";
  const dimensions = uniqueClarificationRouteDimensions(questions);
  const missing = readiness.missingQuestionIds.length;
  const readyText =
    missing === 0
      ? "ready for Route Orchestrator"
      : `${missing} required route signal${missing === 1 ? "" : "s"} still open`;
  return `${label} is ${readiness.answeredRequired}/${readiness.requiredTotal} required answers ${readyText}. Route dimensions: ${dimensions.join(", ") || "none"}.`;
}

function uniqueClarificationReadinessSignals(
  questions: BlueprintClarificationQuestion[]
): BlueprintClarificationReadinessSignalId[] {
  return uniqueStrings(
    questions.filter(hasClarificationReadinessSignal).map(question => question.readinessSignal)
  ) as BlueprintClarificationReadinessSignalId[];
}

function uniqueClarificationRouteDimensions(
  questions: BlueprintClarificationQuestion[]
): BlueprintClarificationRouteDimension[] {
  return uniqueStrings(
    questions.filter(hasClarificationRouteDimension).map(question => question.routeDimension)
  ) as BlueprintClarificationRouteDimension[];
}

function hasClarificationReadinessSignal(
  question: BlueprintClarificationQuestion
): question is BlueprintClarificationQuestion & {
  readinessSignal: BlueprintClarificationReadinessSignalId;
} {
  return Boolean(question.readinessSignal);
}

function hasClarificationRouteDimension(
  question: BlueprintClarificationQuestion
): question is BlueprintClarificationQuestion & {
  routeDimension: BlueprintClarificationRouteDimension;
} {
  return Boolean(question.routeDimension);
}

function createEmptyProjectContext(
  projectId: string,
  now: Date
): BlueprintProjectDomainContext {
  return {
    projectId,
    updatedAt: now.toISOString(),
    intakeIds: [],
    sourceIds: [],
    assets: [],
    evidence: [],
  };
}

function upsertProjectContext(
  projectId: string,
  intake: BlueprintIntake,
  stores: BlueprintIntakeStores,
  updatedAt: string
): BlueprintProjectDomainContext {
  const existing =
    stores.projectContexts.get(projectId) ??
    createEmptyProjectContext(projectId, new Date(updatedAt));
  const context: BlueprintProjectDomainContext = {
    projectId,
    updatedAt,
    intakeIds: uniqueStrings(existing.intakeIds.concat(intake.id)),
    sourceIds: uniqueStrings(
      existing.sourceIds.concat(intake.sources.map(source => source.id))
    ),
    assets: dedupeById(existing.assets.concat(intake.assets)),
    evidence: dedupeById(existing.evidence.concat(intake.evidence)),
  };

  stores.projectContexts.set(projectId, context);
  return context;
}

function mergeClarificationAnswers(
  left: BlueprintClarificationAnswer[],
  right: BlueprintClarificationAnswer[]
): BlueprintClarificationAnswer[] {
  const merged = new Map<string, BlueprintClarificationAnswer>();
  for (const answer of left.concat(right)) {
    if (!answer.questionId || !answer.answer) continue;
    merged.set(answer.questionId, answer);
  }

  return [...merged.values()];
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map(item => [item.id, item])).values()];
}

function summarizeText(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit
    ? `${normalized.slice(0, limit - 3).trim()}...`
    : normalized;
}

function stableId(prefix: string, value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `${prefix}-${slug || "unknown"}`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function normalizeGithubUrls(...values: unknown[]): string[] {
  const parsed = parseGithubSources(readGithubUrlInputs(...values));
  return parsed.sources.map(source => source.normalizedUrl);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(item => readString(item)).filter(isString))];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(isString))];
}

function normalizeQueryStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeStringList(value);
  }

  const text = readString(value);
  if (!text) {
    return [];
  }

  return normalizeStringList(text.split(","));
}

function normalizeClarifications(
  value: unknown
): BlueprintGenerationRequest["clarifications"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isPlainRecord)
    .map(item => ({
      questionId: readString(item.questionId) ?? "",
      answer: readString(item.answer) ?? "",
    }))
    .filter(item => item.questionId && item.answer);
}

function summarizeRequestTarget(request: BlueprintGenerationRequest): string {
  if (request.targetText) {
    const normalized = request.targetText.replace(/\s+/g, " ").trim();
    return normalized.length > 80
      ? `${normalized.slice(0, 77).trim()}...`
      : normalized;
  }

  const firstGithubUrl = request.githubUrls?.[0];
  if (firstGithubUrl) {
    return firstGithubUrl.replace(/^https:\/\/github\.com\//i, "GitHub ");
  }

  return "the requested product direction";
}

function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function displayPath(targetPath: string): string {
  const relative = path.relative(process.cwd(), targetPath);
  const display =
    relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative
      : targetPath;
  return display.split(path.sep).join("/");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "force"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readOrder(value: unknown): number | undefined {
  const order = typeof value === "string" ? Number(value) : value;
  return typeof order === "number" && Number.isFinite(order)
    ? Math.trunc(order)
    : undefined;
}

function isSpecTreeNodeStatus(
  value: unknown
): value is BlueprintSpecTreeNodeStatus {
  return (
    value === "seed" ||
    value === "draft" ||
    value === "ready" ||
    value === "accepted"
  );
}

function isSpecTreeNodeType(value: unknown): value is BlueprintSpecTreeNodeType {
  return (
    value === "root" ||
    value === "route_step" ||
    value === "alternative_route" ||
    value === "spec_document" ||
    value === "effect_preview" ||
    value === "prompt_package" ||
    value === "engineering_plan"
  );
}

function isSpecDocumentType(value: unknown): value is BlueprintSpecDocumentType {
  return (
    value === "requirements" || value === "design" || value === "tasks"
  );
}

function isImplementationPromptTargetPlatform(
  value: unknown
): value is BlueprintImplementationPromptTargetPlatform {
  return (
    value === "cursor" ||
    value === "kiro" ||
    value === "trae" ||
    value === "windsurf" ||
    value === "codex" ||
    value === "claude"
  );
}

function isEngineeringLandingPlanStatus(
  value: unknown
): value is BlueprintEngineeringLandingPlanStatus {
  return (
    value === "draft" ||
    value === "ready" ||
    value === "running" ||
    value === "completed" ||
    value === "failed"
  );
}

function isEngineeringRunStatus(
  value: unknown
): value is BlueprintEngineeringRunStatus {
  return (
    value === "planned" ||
    value === "running" ||
    value === "passed" ||
    value === "failed" ||
    value === "blocked"
  );
}

function isEngineeringVerificationStatus(
  value: unknown
): value is BlueprintEngineeringVerificationResult["status"] {
  return (
    value === "passed" ||
    value === "failed" ||
    value === "skipped" ||
    value === "blocked"
  );
}

function isBlueprintGenerationStage(
  value: unknown
): value is BlueprintGenerationStage {
  return (
    value === "input" ||
    value === "clarification" ||
    value === "route_generation" ||
    value === "spec_tree" ||
    value === "spec_docs" ||
    value === "preview" ||
    value === "effect_preview" ||
    value === "prompt_packaging" ||
    value === "runtime_capability" ||
    value === "engineering_handoff" ||
    value === "engineering_landing"
  );
}

function isGenerationEventFamily(
  value: unknown
): value is BlueprintGenerationEventFamily {
  return (
    value === "job" ||
    value === "crew" ||
    value === "role" ||
    value === "capability" ||
    value === "preview" ||
    value === "prompt" ||
    value === "mission" ||
    value === "sandbox"
  );
}

function isSandboxDerivationExecutionMode(
  value: unknown
): value is BlueprintSandboxDerivationExecutionMode {
  return value === "sequential" || value === "parallel";
}

function isArtifactFeedbackKind(
  value: unknown
): value is BlueprintArtifactFeedback["kind"] {
  return value === "feedback" || value === "backfill";
}

function isArtifactPayloadSummaryValue(
  value: unknown
): value is BlueprintArtifactPayloadSummary[string] {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) &&
      value.every(item => typeof item === "string" || typeof item === "number"))
  );
}

function isEngineeringLandingPlanPayload(
  value: unknown
): value is BlueprintEngineeringLandingPlan {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.treeId === "string" &&
    isEngineeringLandingPlanStatus(value.status) &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    Array.isArray(value.promptPackageIds) &&
    Array.isArray(value.steps) &&
    Array.isArray(value.handoffs) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isPlainRecord(value.provenance)
  );
}

function isArtifactReplaySnapshotPayload(
  value: unknown
): value is BlueprintArtifactReplaySnapshot {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.timelineEntries) &&
    isPlainRecord(value.stageCounts) &&
    Array.isArray(value.lineageEdges)
  );
}

function isArtifactFeedbackPayload(
  value: unknown
): value is BlueprintArtifactFeedback {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.entryId === "string" &&
    typeof value.artifactId === "string" &&
    isArtifactFeedbackKind(value.kind) &&
    typeof value.message === "string" &&
    typeof value.summary === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.tags) &&
    isPlainRecord(value.sourceIds) &&
    isPlainRecord(value.payloadSummary)
  );
}

function isEngineeringRunPayload(
  value: unknown
): value is BlueprintEngineeringRun {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.landingPlanId === "string" &&
    isEngineeringRunStatus(value.status) &&
    typeof value.summary === "string" &&
    Array.isArray(value.logs) &&
    Array.isArray(value.verificationResults) &&
    Array.isArray(value.changedFiles) &&
    Array.isArray(value.promptPackageIds) &&
    isPlainRecord(value.provenance)
  );
}

function isCapabilityRegistryPayload(
  value: unknown
): value is {
  id: string;
  jobId: string;
  createdAt: string;
  updatedAt: string;
  capabilities: BlueprintRuntimeCapability[];
  sourceIds?: Partial<BlueprintArtifactSourceIds>;
  provenance?: Record<string, unknown>;
} {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.capabilities) &&
    value.capabilities.every(isRuntimeCapabilityPayload)
  );
}

function isRuntimeCapabilityPayload(
  value: unknown
): value is BlueprintRuntimeCapability {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.kind === "string" &&
    typeof value.purpose === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.tags) &&
    typeof value.securityLevel === "string" &&
    typeof value.status === "string" &&
    typeof value.adapter === "string" &&
    typeof value.inputSchema === "string" &&
    Array.isArray(value.outputTypes) &&
    Array.isArray(value.supportedStages) &&
    typeof value.requiresApproval === "boolean" &&
    typeof value.projectScoped === "boolean"
  );
}

function isRolePresenceState(
  value: unknown
): value is BlueprintRolePresenceState {
  return (
    value === "active" ||
    value === "watching" ||
    value === "reviewing" ||
    value === "sleeping"
  );
}

function isAgentCrewPayload(value: unknown): value is BlueprintAgentCrew {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isBlueprintGenerationStage(value.stage) &&
    Array.isArray(value.roles) &&
    Array.isArray(value.capabilityMatrix) &&
    Array.isArray(value.activationPolicies) &&
    Array.isArray(value.presence)
  );
}

function isRoleTimelineCollectionPayload(
  value: unknown
): value is BlueprintRoleTimelineCollection {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.timelines)
  );
}

function isSandboxDerivationJobPayload(
  value: unknown
): value is BlueprintSandboxDerivationJob {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    isBlueprintGenerationStage(value.stage) &&
    isSandboxDerivationExecutionMode(value.executionMode) &&
    typeof value.status === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.completedAt === "string" &&
    Array.isArray(value.capabilityIds) &&
    Array.isArray(value.invocationIds) &&
    Array.isArray(value.evidenceIds) &&
    isPlainRecord(value.aggregate) &&
    Array.isArray(value.logs) &&
    isPlainRecord(value.provenance)
  );
}

function isCapabilityInvocationPayload(
  value: unknown
): value is BlueprintCapabilityInvocation {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.capabilityId === "string" &&
    typeof value.roleId === "string" &&
    typeof value.capabilityLabel === "string" &&
    typeof value.kind === "string" &&
    typeof value.status === "string" &&
    typeof value.securityLevel === "string" &&
    isPlainRecord(value.safetyGate) &&
    typeof value.requestedAt === "string" &&
    typeof value.outputSummary === "string" &&
    Array.isArray(value.logs) &&
    Array.isArray(value.evidenceIds) &&
    typeof value.durationMs === "number" &&
    isPlainRecord(value.provenance)
  );
}

function isCapabilityEvidencePayload(
  value: unknown
): value is BlueprintCapabilityEvidence {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.invocationId === "string" &&
    typeof value.capabilityId === "string" &&
    typeof value.capabilityLabel === "string" &&
    typeof value.kind === "string" &&
    typeof value.status === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.artifacts) &&
    Array.isArray(value.logs) &&
    Array.isArray(value.tags) &&
    isPlainRecord(value.payloadSummary) &&
    isPlainRecord(value.provenance)
  );
}

function isSpecDocumentReviewStatus(
  value: unknown
): value is BlueprintReviewSpecDocumentRequest["status"] {
  return value === "accepted" || value === "rejected" || value === "reviewing";
}

function isSpecDocumentStatus(
  value: unknown
): value is BlueprintSpecDocumentStatus {
  return (
    value === "draft" ||
    value === "reviewing" ||
    value === "accepted" ||
    value === "rejected"
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const router = createBlueprintRouter();

export default router;
