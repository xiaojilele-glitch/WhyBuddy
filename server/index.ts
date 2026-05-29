/**
 * Cube Pets Office - Server Entry Point
 * Express + Socket.IO + REST API + Multi-Agent Orchestration
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  MISSION_CORE_STAGE_BLUEPRINT,
  type MissionArtifact,
  type MissionDecision,
  type MissionInstanceContext,
  type MissionRecord,
} from "../shared/mission/contracts.js";
import type { ExecutorEvent } from "../shared/executor/contracts.js";
import type {
  ExecutorPreviewSession,
  ExecutorPreviewSessionStatus,
  ExecutorPreviewSessionType,
} from "../shared/executor/contracts.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STARTUP_TRACE_ENABLED = process.env.STARTUP_TRACE === "1";

function traceStartup(step: string): void {
  if (!STARTUP_TRACE_ENABLED) {
    return;
  }

  const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[startup-trace] ${step} rss=${memoryMb}MB`);
}

const DEFAULT_EXECUTOR_BASE_URL = "http://127.0.0.1:3031";
const EXECUTOR_STAGE_LABELS: Record<string, string> = {
  receive: "Receive task",
  understand: "Understand request",
  plan: "Build execution plan",
  provision: "Provision execution runtime",
  scan: "Scan workspace",
  analyze: "Analyze request",
  "build-plan": "Build execution plan",
  dispatch: "Provision execution runtime",
  codegen: "Generate artifacts",
  execute: "Run execution",
  report: "Publish report",
  custom: "Custom action",
  finalize: "Finalize mission",
};
const SMOKE_STAGE_LABELS = [...MISSION_CORE_STAGE_BLUEPRINT];

interface RequestWithRawBody extends Request {
  rawBody?: string;
}

interface ExecutorCallbackRequestBody {
  event?: {
    version?: string;
    eventId?: string;
    missionId?: string;
    jobId?: string;
    executor?: string;
    type?: string;
    status?: string;
    occurredAt?: string;
    stageKey?: string;
    progress?: number;
    message?: string;
    detail?: string;
    waitingFor?: string;
    decision?: {
      prompt?: string;
      options?: Array<{
        id?: string;
        label?: string;
        description?: string;
      }>;
      allowFreeText?: boolean;
      placeholder?: string;
    };
    summary?: string;
    errorCode?: string;
    log?: {
      level?: "info" | "warn" | "error";
      message?: string;
    };
    artifacts?: ExecutorEvent["artifacts"];
    payload?: {
      instance?: {
        id?: string;
        image?: string;
        command?: string[];
        workspaceRoot?: string;
        startedAt?: number;
        completedAt?: number;
        exitCode?: number;
        host?: string;
      };
      securitySummary?: {
        level?: string;
        user?: string;
        networkMode?: string;
        readonlyRootfs?: boolean;
        memoryLimit?: string;
        cpuLimit?: string;
        pidsLimit?: number;
      };
      previewSession?: Partial<ExecutorPreviewSession>;
    };
    /** 日志/截图关联的步骤索引 */
    stepIndex?: number;
    /** 日志流类型 */
    stream?: "stdout" | "stderr";
    /** 日志数据（最大 4KB） */
    data?: string;
    /** base64 编码 PNG 截图（最大 200KB） */
    imageData?: string;
    /** 截图宽度 */
    imageWidth?: number;
    /** 截图高度 */
    imageHeight?: number;
  };
}

interface DispatchSmokeRequestBody {
  title?: string;
  sourceText?: string;
  outcome?: "success" | "failed";
  executorBaseUrl?: string;
}

interface SeedRunningSmokeRequestBody {
  title?: string;
  sourceText?: string;
  stageKey?: string;
  detail?: string;
  progress?: number;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value || !value.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number
): number {
  if (!value || !value.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function executorStageLabel(stageKey: string | undefined): string {
  if (!stageKey) return EXECUTOR_STAGE_LABELS.finalize;
  return EXECUTOR_STAGE_LABELS[stageKey] || stageKey;
}

function buildServerBaseUrl(request: Request): string {
  const forwardedProto = request
    .header("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = request
    .header("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProto || request.protocol;
  const host = forwardedHost || request.get("host") || "127.0.0.1";
  return `${protocol}://${host}`;
}

function parseHexSignature(rawValue: string | undefined): Buffer | null {
  if (!rawValue) return null;
  const normalized = rawValue.startsWith("sha256=")
    ? rawValue.slice("sha256=".length)
    : rawValue;
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return null;
  return Buffer.from(normalized.toLowerCase(), "hex");
}

function createExecutorCallbackSignature(
  secret: string,
  timestamp: string,
  rawBody: string
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

function verifyExecutorCallbackSignature(
  request: RequestWithRawBody,
  response: Response
): boolean {
  const secret = process.env.EXECUTOR_CALLBACK_SECRET?.trim();
  if (!secret) return true;

  const timestamp = request.header("x-cube-executor-timestamp")?.trim();
  const signature = request.header("x-cube-executor-signature")?.trim();
  const rawBody = request.rawBody || "";
  const maxSkewMs =
    parsePositiveInteger(process.env.EXECUTOR_CALLBACK_MAX_SKEW_SECONDS, 300) *
    1_000;

  if (!timestamp || !signature) {
    response
      .status(401)
      .json({ ok: false, error: "Missing executor callback auth headers" });
    return false;
  }

  const timestampMs = /^\d+$/.test(timestamp)
    ? timestamp.length <= 10
      ? Number.parseInt(timestamp, 10) * 1_000
      : Number.parseInt(timestamp, 10)
    : Number.NaN;

  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > maxSkewMs
  ) {
    response
      .status(401)
      .json({
        ok: false,
        error: "Executor callback timestamp is invalid or expired",
      });
    return false;
  }

  const expected = Buffer.from(
    createExecutorCallbackSignature(secret, timestamp, rawBody),
    "hex"
  );
  const actual = parseHexSignature(signature);
  if (
    !actual ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    response
      .status(401)
      .json({ ok: false, error: "Executor callback signature mismatch" });
    return false;
  }

  return true;
}

function resolveExecutorStageKey(
  event: NonNullable<ExecutorCallbackRequestBody["event"]>,
  fallback: string | undefined
): string {
  const rawStageKey = event.stageKey?.trim();
  if (rawStageKey) {
    if (
      [
        "receive",
        "understand",
        "plan",
        "provision",
        "execute",
        "finalize",
      ].includes(rawStageKey)
    ) {
      return rawStageKey;
    }
    if (rawStageKey === "scan" || rawStageKey === "analyze")
      return "understand";
    if (rawStageKey === "build-plan") return "plan";
    if (rawStageKey === "dispatch") return "provision";
    if (
      rawStageKey === "codegen" ||
      rawStageKey === "execute" ||
      rawStageKey === "custom"
    ) {
      return "execute";
    }
    if (rawStageKey === "report") return "finalize";
  }

  if (event.type === "job.accepted") return "provision";
  if (event.type === "job.waiting" || event.status === "waiting") {
    return fallback || "execute";
  }
  if (
    event.type === "job.completed" ||
    event.type === "job.failed" ||
    event.type === "job.cancelled" ||
    event.status === "completed" ||
    event.status === "failed" ||
    event.status === "cancelled"
  ) {
    return "finalize";
  }

  return fallback || "execute";
}

function normalizeExecutorArtifacts(
  artifacts: NonNullable<ExecutorCallbackRequestBody["event"]>["artifacts"]
): MissionArtifact[] | undefined {
  if (!Array.isArray(artifacts)) return undefined;

  const normalized = artifacts.flatMap(artifact => {
    if (
      !artifact ||
      (artifact.kind !== "file" &&
        artifact.kind !== "report" &&
        artifact.kind !== "url" &&
        artifact.kind !== "log") ||
      !artifact.name?.trim()
    ) {
      return [];
    }

    return [
      {
        kind: artifact.kind,
        id: artifact.id?.trim() || undefined,
        name: artifact.name.trim(),
        path: artifact.path?.trim() || undefined,
        url: artifact.url?.trim() || undefined,
        mimeType: artifact.mimeType?.trim() || undefined,
        previewType: artifact.previewType,
        size:
          typeof artifact.size === "number" &&
          Number.isFinite(artifact.size) &&
          artifact.size >= 0
            ? artifact.size
            : undefined,
        description: artifact.description?.trim() || undefined,
      },
    ];
  });

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeExecutorInstance(
  value: NonNullable<ExecutorCallbackRequestBody["event"]>["payload"]
): MissionInstanceContext | undefined {
  const instance = value?.instance;
  if (!instance || typeof instance !== "object") return undefined;

  return {
    id: instance.id?.trim() || undefined,
    image: instance.image?.trim() || undefined,
    command: Array.isArray(instance.command)
      ? instance.command.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : undefined,
    workspaceRoot: instance.workspaceRoot?.trim() || undefined,
    startedAt:
      typeof instance.startedAt === "number" ? instance.startedAt : undefined,
    completedAt:
      typeof instance.completedAt === "number"
        ? instance.completedAt
        : undefined,
    exitCode:
      typeof instance.exitCode === "number" ? instance.exitCode : undefined,
    host: instance.host?.trim() || undefined,
  };
}

function normalizeSmokeOutcome(value: unknown): "success" | "failed" {
  return value === "failed" ? "failed" : "success";
}

function normalizeSecuritySummary(
  value: NonNullable<ExecutorCallbackRequestBody["event"]>["payload"]
): MissionRecord["securitySummary"] | undefined {
  const ss = value?.securitySummary;
  if (!ss || typeof ss !== "object") return undefined;
  if (!ss.level?.trim()) return undefined;
  return {
    level: ss.level.trim(),
    user: ss.user?.trim() || "65534",
    networkMode: ss.networkMode?.trim() || "none",
    readonlyRootfs: ss.readonlyRootfs === true,
    memoryLimit: ss.memoryLimit?.trim() || "512MB",
    cpuLimit: ss.cpuLimit?.trim() || "1.0",
    pidsLimit: typeof ss.pidsLimit === "number" ? ss.pidsLimit : 256,
  };
}

function normalizePreviewSessionType(
  value: unknown
): ExecutorPreviewSessionType | undefined {
  return value === "browser-screenshot-stream" ||
    value === "terminal-stream" ||
    value === "browser-vnc"
    ? value
    : undefined;
}

function normalizePreviewSessionStatus(
  value: unknown
): ExecutorPreviewSessionStatus | undefined {
  return value === "starting" ||
    value === "running" ||
    value === "stopped" ||
    value === "failed"
    ? value
    : undefined;
}

function normalizePreviewSession(
  value: NonNullable<ExecutorCallbackRequestBody["event"]>["payload"]
): ExecutorPreviewSession | undefined {
  const session = value?.previewSession;
  if (!session || typeof session !== "object") return undefined;

  const id = session.id?.trim();
  const missionId = session.missionId?.trim();
  const jobId = session.jobId?.trim();
  const type = normalizePreviewSessionType(session.type);
  const status = normalizePreviewSessionStatus(session.status);
  const startedAt = session.startedAt?.trim();
  if (!id || !missionId || !jobId || !type || !status || !startedAt) {
    return undefined;
  }

  return {
    id,
    projectId: session.projectId?.trim() || undefined,
    missionId,
    jobId,
    type,
    status,
    startedAt,
    stoppedAt: session.stoppedAt?.trim() || undefined,
    frameCount:
      typeof session.frameCount === "number" &&
      Number.isFinite(session.frameCount)
        ? Math.max(0, Math.trunc(session.frameCount))
        : undefined,
    logLineCount:
      typeof session.logLineCount === "number" &&
      Number.isFinite(session.logLineCount)
        ? Math.max(0, Math.trunc(session.logLineCount))
        : undefined,
    latestFramePath: session.latestFramePath?.trim() || undefined,
    artifactNames: Array.isArray(session.artifactNames)
      ? session.artifactNames.filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.trim().length > 0
        )
      : undefined,
  };
}

function normalizeExecutorDecision(
  value: NonNullable<ExecutorCallbackRequestBody["event"]>["decision"]
): MissionDecision | undefined {
  if (!value?.prompt?.trim()) return undefined;

  const options = Array.isArray(value.options)
    ? value.options.flatMap(
        (option: NonNullable<typeof value.options>[number]) => {
          if (!option?.id?.trim() || !option?.label?.trim()) {
            return [];
          }

          return [
            {
              id: option.id.trim(),
              label: option.label.trim(),
              description: option.description?.trim() || undefined,
            },
          ];
        }
      )
    : [];

  if (options.length === 0) return undefined;

  return {
    prompt: value.prompt.trim(),
    options,
    allowFreeText: value.allowFreeText === true,
    placeholder: value.placeholder?.trim() || undefined,
  };
}

function isSmokeEnabled(): boolean {
  return parseBoolean(process.env.MISSION_SMOKE_ENABLED, false);
}

function sendSmokeDisabled(response: Response): Response {
  return response.status(404).json({
    ok: false,
    error:
      "Mission smoke routes are disabled. Set MISSION_SMOKE_ENABLED=true to enable them.",
  });
}

async function initializeAgentRuntime() {
  const db = (await import("./db/index.js")).default;
  const { ensureAgentWorkspaces } = await import("./memory/workspace.js");

  const agentIds = db.getAgents().map(agent => agent.id);
  const workspaces = ensureAgentWorkspaces(agentIds);

  console.log(
    `[Workspace] Ready. ${workspaces.length} agent workspaces materialized.`
  );
  return { agentIds, workspaceCount: workspaces.length };
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(
    express.json({
      limit: "10mb",
      verify: (request, _response, buffer) => {
        (request as RequestWithRawBody).rawBody = buffer.toString("utf8");
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  const { initSocketIO } = await import("./core/socket.js");
  initSocketIO(server);

  await initializeAgentRuntime();

  const db = (await import("./db/index.js")).default;
  const { soulStore } = await import("./memory/soul-store.js");
  soulStore.ensureAllSoulFiles();

  const { registry } = await import("./core/registry.js");
  registry.init();
  traceStartup("registry initialized");
  traceStartup("heartbeat import begin");
  const { heartbeatScheduler } = await import("./core/heartbeat.js");
  traceStartup("heartbeat import end");
  traceStartup("session/mission imports begin");
  const { sessionStore } = await import("./memory/session-store.js");
  const { missionRuntime } = await import("./tasks/mission-runtime.js");
  const { recoverWorkflowsOnStartup } = await import(
    "./startup/workflow-recovery.js"
  );
  traceStartup("session/mission imports end");
  traceStartup("task/planet/feishu imports begin");
  const { createTaskRouter, createDecisionTemplatesRouter } = await import(
    "./routes/tasks.js"
  );
  const { createPlanetRouter } = await import("./routes/planets.js");
  const { createFeishuRouter } = await import("./routes/feishu.js");
  traceStartup("task/planet/feishu imports end");
  traceStartup("execution plan imports begin");
  const { buildExecutionPlan } = await import(
    "./core/execution-plan-builder.js"
  );
  const { ExecutorClient } = await import("./core/executor-client.js");
  const { EXECUTOR_API_ROUTES } = await import("../shared/executor/api.js");
  traceStartup("execution plan imports end");

  // Wire up workflow → mission enrichment bridge (workflow-decoupling Task 4.2)
  traceStartup("workflow runtime imports begin");
  const { serverRuntime, setOnStageCompleted } = await import(
    "./runtime/server-runtime.js"
  );
  const {
    initEnrichmentBridge,
    onWorkflowStageCompleted,
    resolveWorkflowMission,
  } = await import("./core/mission-enrichment-bridge.js");
  traceStartup("workflow runtime imports end");
  initEnrichmentBridge(missionRuntime, serverRuntime.workflowRepo);
  setOnStageCompleted(onWorkflowStageCompleted);
  traceStartup("workflow enrichment bridge initialized");

  // ── ExecutionBridge: bridge WorkflowEngine deliverables → Docker executor (executor-integration Task 9.1) ──
  traceStartup("execution bridge imports begin");
  const { createExecutionBridge, buildCallbackUrl } = await import(
    "./core/execution-bridge.js"
  );
  const { workflowEngine } = await import("./core/workflow-engine.js");
  traceStartup("execution bridge imports end");

  // Wire up resolveMissionId so bridgeToExecutor can find the missionId for a workflowId
  serverRuntime.resolveMissionId = resolveWorkflowMission;

  const executionBridge = createExecutionBridge(missionRuntime, {
    executorBaseUrl:
      process.env.LOBSTER_EXECUTOR_BASE_URL?.trim() ||
      DEFAULT_EXECUTOR_BASE_URL,
    executionMode:
      process.env.LOBSTER_EXECUTION_MODE === "mock" ? "mock" : "real",
    defaultImage: process.env.LOBSTER_DEFAULT_IMAGE?.trim() || "node:20-slim",
    callbackUrl: buildCallbackUrl(
      process.env.SERVER_BASE_URL?.trim() || "http://localhost:3000"
    ),
  });
  workflowEngine.executionBridge = executionBridge;
  traceStartup("execution bridge wired");

  traceStartup("workflow cleanup begin");
  recoverWorkflowsOnStartup({
    workflows: db.getWorkflows(),
    updateWorkflow: (workflowId, updates) =>
      db.updateWorkflow(workflowId, updates),
    materializeWorkflowMemories: workflowId =>
      sessionStore.materializeWorkflowMemories(workflowId),
  });
  traceStartup("workflow cleanup end");

  traceStartup("route imports begin");
  const agentRoutes = (await import("./routes/agents.js")).default;
  const { createChatRouter } = await import("./routes/chat.js");
  const { createRobotReplyRouter } = await import("./routes/robot-reply.js");
  const reportRoutes = (await import("./routes/reports.js")).default;
  const workflowRoutes = (await import("./routes/workflows.js")).default;
  const { createOpenPageRouter } = await import("./routes/open-page.js");
  // Task 14（design §4.5 接线策略）：blueprint router 的装配改为显式构造
  // 预先构建 `BlueprintServiceContext`，这样 server/index.ts 与 blueprint router
  // 内部（Task 15 起的 docker capability bridge）共享同一个
  // `executorCallbackDispatcher` 实例；`/api/executor/events` 回调中间件
  // 也通过这个 ctx 把事件转发给 dispatcher。
  const { createBlueprintRouter } = await import("./routes/blueprint.js");
  const {
    buildBlueprintServiceContext,
    rebindBlueprintServiceContextRuntimeAdapters,
  } = await import(
    "./routes/blueprint/context.js"
  );
  // MCP GitHub capability bridge 的默认 HTTPS fetcher（仅在
  // `BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED === "true"` 时挂载）。
  const { createDefaultBlueprintHttpFetcher } = await import(
    "./routes/blueprint/mcp-github-source/http-fetcher.js"
  );
  const { resolveAllBridgeEnablement } = await import(
    "./routes/blueprint/runtime-enablement/resolver.js"
  );

  // Task 12（design §D1 / §3.1 / requirement 1.1 / 2.1 / 3.1 / 7.7）：
  // 启动期一次性解析 5 条 capability bridge 的 enablement。
  // resolver 会把解析结果写回 `process.env`，使既有 bridge 内部的
  // `process.env.X === "true"` tier-1 门禁自动继承新默认值；
  // 既有测试通过 `BUILD_TARGET=test` 强制返回 "false" 保持兼容。
  const resolvedEnablement = resolveAllBridgeEnablement(process.env);

  // Task 16.1-16.2（`autopilot-role-container-loader`）：解析 loader 的 enablement
  // 并写回 process.env，让 loader 的 Tier 1 gate 能读到最终值。
  // `resolveBridgeEnablement` 的 `envFlag` union 尚未包含此 key，用 as never 下钻。
  const { resolveBridgeEnablement } = await import(
    "./routes/blueprint/runtime-enablement/resolver.js"
  );
  const resolvedRoleContainerLoaderEnabled = resolveBridgeEnablement({
    envFlag: "BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED" as never,
    explicitEnvValue: process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED,
    masterSwitch: process.env.AUTOPILOT_REAL_RUNTIME,
    buildTarget: process.env.BUILD_TARGET,
  });
  traceStartup("bridge enablement resolved");
  if (
    resolvedRoleContainerLoaderEnabled !== undefined &&
    process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED !==
      resolvedRoleContainerLoaderEnabled
  ) {
    process.env.BLUEPRINT_ROLE_CONTAINER_LOADER_ENABLED =
      resolvedRoleContainerLoaderEnabled;
  }

  traceStartup("blueprint context build begin");
  const blueprintServiceContext = buildBlueprintServiceContext({});
  traceStartup("blueprint context build end");

  // autopilot-agent-reasoning-stream：装配 CallbackReceiver 实例，让 Agent 推理流
  // 的 HMAC 回调有宿主侧 HTTP server 接收。仅当 Agent 驱动管线开启时才装配。
  if (
    process.env.BLUEPRINT_AGENT_DRIVEN_PIPELINE_ENABLED === "true" &&
    process.env.BUILD_TARGET !== "test"
  ) {
    try {
      const { createCallbackReceiver } = await import(
        "./routes/blueprint/role-agent-runtime/callback-receiver.js"
      );
      const receiver = createCallbackReceiver({
        hmacSecret: process.env.EXECUTOR_CALLBACK_SECRET ?? "dev-callback-secret-2026",
        logger: blueprintServiceContext.logger,
        now: () => new Date(),
      });
      await receiver.start(0); // OS 分配端口
      blueprintServiceContext.callbackReceiver = receiver;
      // eslint-disable-next-line no-console
      console.log(
        `[blueprint] CallbackReceiver started on port ${receiver.actualPort}`
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[blueprint] Failed to start CallbackReceiver:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const aigcMonitoringRoutes = (await import("./routes/aigc-monitoring.js"))
    .default;
  traceStartup("post-blueprint basic route imports begin");
  const configRoutes = (await import("./routes/config.js")).default;
  const exportRoutes = (await import("./routes/export.js")).default;
  const telemetryRoutes = (await import("./routes/telemetry.js")).default;
  const costRoutes = (await import("./routes/cost.js")).default;
  const replayRoutes = (await import("./routes/replay.js")).default;
  const { costTracker } = await import("./core/cost-tracker.js");

  costTracker.loadHistory();
  traceStartup("cost history loaded");

  // ── Collaboration Replay ──
  const { ServerReplayStore } = await import("./replay/replay-store.js");
  const { EventCollector } = await import("./replay/event-collector.js");
  const {
    installMissionInterceptor,
    installMessageBusInterceptor,
    installExecutorInterceptor,
  } = await import("./replay/interceptors.js");
  const { setWebAigcRuntimeObservabilityDeps } = await import(
    "./core/web-aigc-runtime-observability.js"
  );
  const { messageBus } = await import("./core/message-bus.js");

  const replayStore = new ServerReplayStore();
  const eventCollector = new EventCollector(replayStore);
  const resolveMissionReplayId = (missionId: string): string | undefined =>
    missionRuntime.getTask(missionId)?.projection?.replayId ||
    missionRuntime.getTask(missionId)?.projection?.workflowId ||
    undefined;

  installMissionInterceptor(missionRuntime, eventCollector);
  installMessageBusInterceptor(messageBus, eventCollector);
  traceStartup("replay interceptors installed");
  app.use(
    "/api/executor/events",
    installExecutorInterceptor(eventCollector, resolveMissionReplayId)
  );

  // Task 14（design §4.5）：Blueprint capability bridge HMAC callback dispatcher。
  //
  // 这一层只做 transient in-memory 的事件分发，不持久化、不改响应、不阻塞
  // 既有 mission runtime 事件处理：
  //
  // - 顺序保证：`/api/executor/events` 的 HMAC 签名校验在 POST 处理器内
  //   （第 ~1291 行 `verifyExecutorCallbackSignature`），该校验运行在所有
  //   `app.use(...)` 中间件之后——因此 replay interceptor 与本 dispatcher
  //   都只是 observer，对 mission runtime 状态不做二次变更；HMAC 校验仍然
  //   是真正阻断非法回调的唯一关口。
  // - 实例同源：这里使用的 `blueprintServiceContext.executorCallbackDispatcher`
  //   与注入给 blueprint router 的是同一对象（通过 `createBlueprintRouter(
  //   { blueprintServiceContext })` 共享 ctx），所以 bridge 内 `awaitTerminal(jobId)`
  //   能接到这里 `handleEvent(event)` 派发过来的事件。
  // - 失败兜底：dispatcher.handleEvent 自身应当是纯内存操作；仍用 try/catch
  //   包一层，避免 blueprint 侧任何异常把 mission runtime 回调吞掉，保证
  //   `next()` 总会被调用（design §5.2）。
  app.use("/api/executor/events", (request, _response, next) => {
    try {
      const body = request.body as ExecutorCallbackRequestBody | undefined;
      const event = body?.event;
      if (
        event &&
        typeof event.jobId === "string" &&
        event.jobId.length > 0 &&
        blueprintServiceContext.executorCallbackDispatcher
      ) {
        blueprintServiceContext.executorCallbackDispatcher.handleEvent(
          event as unknown as ExecutorEvent
        );
      }
    } catch {
      // Never let blueprint dispatcher errors block mission runtime processing.
    }
    next();
  });

  // ── Knowledge Graph ──
  const { GraphStore } = await import("./knowledge/graph-store.js");
  const { OntologyRegistry } = await import("./knowledge/ontology-registry.js");
  const { KnowledgeReviewQueue } = await import("./knowledge/review-queue.js");
  const { KnowledgeGraphQuery } = await import("./knowledge/query-service.js");
  const { KnowledgeService } = await import("./knowledge/knowledge-service.js");
  const { createKnowledgeRouter } = await import("./routes/knowledge.js");
  const { createKnowledgeAdminRouter } = await import(
    "./routes/knowledge-admin.js"
  );

  const graphStore = new GraphStore();
  const ontologyRegistry = new OntologyRegistry();
  const reviewQueue = new KnowledgeReviewQueue(graphStore);
  const queryService = new KnowledgeGraphQuery(graphStore, ontologyRegistry);
  const knowledgeService = new KnowledgeService(queryService, graphStore);

  const { getSocketIO, registerSandboxRelay } = await import(
    "./core/socket.js"
  );
  const { SandboxRelay } = await import("./core/sandbox-relay.js");
  const { SANDBOX_SOCKET_EVENTS } = await import("../shared/mission/socket.js");
  const { HeartbeatMonitor } = await import("./core/execution-bridge.js");
  const sandboxRelay = new SandboxRelay();
  registerSandboxRelay(sandboxRelay);
  const heartbeatMonitor = new HeartbeatMonitor(missionRuntime);
  traceStartup("knowledge and sandbox relay initialized");

  graphStore.onEntityChanged((entity, action) => {
    const io = getSocketIO();
    if (io) {
      io.emit("knowledge.entityChanged", { entity, action });
    }
  });

  // ── RAG Pipeline ──
  const { getRAGConfig } = await import("./rag/config.js");
  const ragConfig = getRAGConfig();
  traceStartup(`rag config read enabled=${String(ragConfig.enabled)}`);
  let ragDeps:
    | Awaited<ReturnType<(typeof import("./rag/index.js"))["initRAG"]>>
    | undefined;
  let chatDocumentSearch:
    | ((
        request: import("../shared/rag/web-aigc-search.js").WebAigcSearchRequest
      ) => Promise<
        import("../shared/rag/web-aigc-search.js").WebAigcDocumentSearchResponse
      >)
    | undefined;
  if (ragConfig.enabled) {
    traceStartup("rag init begin");
    const { initRAG } = await import("./rag/index.js");
    const initializedRagDeps = initRAG();
    traceStartup("rag init end");
    ragDeps = initializedRagDeps;
    const { createRAGRouter } = await import("./routes/rag.js");
    const { normalizeWebAigcSearchRequest, projectDocumentSearchResponse } =
      await import("./rag/web-aigc-search-adapter.js");

    chatDocumentSearch = async request => {
      const options = normalizeWebAigcSearchRequest(request);
      const startedAt = Date.now();
      const results = await initializedRagDeps.retriever.search(
        request.query,
        options
      );
      const latencyMs = Math.max(0, Date.now() - startedAt);

      return projectDocumentSearchResponse({
        query: request.query,
        results,
        documentIds: request.scope.documentIds,
        latencyMs,
        mode: request.options?.mode ?? "hybrid",
      });
    };

    app.use("/api/rag", createRAGRouter(initializedRagDeps));
  }

  // Audit chain / observability wiring
  const { auditChain } = await import("./audit/audit-chain.js");
  traceStartup("audit imports begin");
  const { auditStore } = await import("./audit/audit-store.js");
  const { auditQuery } = await import("./audit/audit-query.js");
  const { auditVerifier } = await import("./audit/audit-verifier.js");
  const { anomalyDetector } = await import("./audit/anomaly-detector.js");
  const { complianceMapper } = await import("./audit/compliance-mapper.js");
  const { auditExport } = await import("./audit/audit-export.js");
  const { auditRetention } = await import("./audit/audit-retention.js");
  const { auditCollector } = await import("./audit/audit-collector.js");
  const { installAuditHooks } = await import("./audit/audit-hooks.js");
  const { createAuditRouter } = await import("./routes/audit.js");

  auditStore.init();
  auditChain.setStore(auditStore);
  auditChain.init();
  installAuditHooks({ collector: auditCollector });
  traceStartup("audit initialized");
  setWebAigcRuntimeObservabilityDeps({
    replayCollector: eventCollector,
    auditCollector,
  });

  const chatRoutes = createChatRouter({
    documentSearch: chatDocumentSearch,
  });

  app.use("/api/agents", agentRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/robot-reply", createRobotReplyRouter());
  app.use("/api/reports", reportRoutes);
  app.use("/api/workflows", workflowRoutes);
  // NOTE: blueprint router is mounted later (see below, after `mcpToolAdapter`
  // is constructed) so the autopilot-capability-bridge-mcp DI path can receive
  // the mainline MCP tool adapter when `BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED === "true"`.
  app.use("/api/v1/:tenantId/aigc-monitoring", aigcMonitoringRoutes);
  app.use("/api/config", configRoutes);
  app.use("/api/export", exportRoutes);
  app.use("/api/telemetry", telemetryRoutes);
  app.use("/api/cost", costRoutes);
  const visionRoutes = (await import("./routes/vision.js")).default;
  app.use("/api/vision", visionRoutes);
  const voiceRoutes = (await import("./routes/voice.js")).default;
  app.use("/api/voice", voiceRoutes);
  const skillRoutes = (await import("./routes/skills.js")).default;
  app.use("/api/skills", skillRoutes);
  const { seedSkills } = await import("./core/skill-seed.js");
  traceStartup("skill seed begin");
  seedSkills();
  traceStartup("skill seed end");
  const { skillRegistry } = await import("./core/dynamic-organization.js");
  const { createCoreSkillRegistryAdapter } = await import(
    "./routes/blueprint/role-container-loader/skill-registry-adapter.js"
  );
  const blueprintSkillRegistry = createCoreSkillRegistryAdapter(skillRegistry);
  rebindBlueprintServiceContextRuntimeAdapters(blueprintServiceContext, {
    skillRegistry: blueprintSkillRegistry,
  });
  const analyticsRoutes = (await import("./routes/analytics.js")).default;
  app.use("/api/analytics", analyticsRoutes);
  app.use("/api/replay", replayRoutes);
  const reputationRoutes = (await import("./routes/reputation.js")).default;
  app.use("/api", reputationRoutes);
  app.use("/api/decision-templates", createDecisionTemplatesRouter());
  app.use("/api/planets", createPlanetRouter(missionRuntime));
  app.use("/api/feishu", createFeishuRouter());
  const { readPersistenceConfig } = await import("./persistence/config.js");
  const { createMysqlQueryExecutor } = await import("./persistence/mysql.js");
  const {
    createEmailLoginTokensRepository,
    createProjectResourcesRepository,
    createProjectsRepository,
    createSessionsRepository,
    createUsersRepository,
  } = await import("./persistence/repositories.js");
  const { createEmailCodeService } = await import(
    "./auth/email-code-service.js"
  );
  const { createEmailCodeMailer, readEmailMailerConfig } = await import(
    "./auth/email-mailer.js"
  );
  const { createAuthMiddleware } = await import("./auth/middleware.js");
  const { createSessionService } = await import("./auth/session-service.js");
  const { createAdminRouter } = await import("./routes/admin.js");
  const { createAuthRouter } = await import("./routes/auth.js");
  const { createProjectsRouter } = await import("./routes/projects.js");
  const persistenceConfig = readPersistenceConfig();
  traceStartup("persistence config read");
  const authDb = createMysqlQueryExecutor(persistenceConfig.database.mysql);
  const projectsRepository = createProjectsRepository(authDb);
  const projectResourcesRepository = createProjectResourcesRepository(authDb);
  const usersRepository = createUsersRepository(authDb);
  const sessionsRepository = createSessionsRepository(authDb);
  const emailLoginTokensRepository = createEmailLoginTokensRepository(authDb);
  const emailCodeMailer = createEmailCodeMailer(readEmailMailerConfig());
  const emailCodeService = createEmailCodeService({
    mailer: emailCodeMailer,
    ttlSeconds: parsePositiveInteger(process.env.EMAIL_CODE_TTL_SECONDS, 600),
    pepper: process.env.EMAIL_CODE_PEPPER,
  });
  const sessionService = createSessionService({
    repositories: {
      users: usersRepository,
      sessions: sessionsRepository,
    },
    cookieName: persistenceConfig.session.cookieName,
    ttlDays: persistenceConfig.session.ttlDays,
    secureCookie: process.env.NODE_ENV === "production",
  });
  const authMiddleware = createAuthMiddleware(sessionService);
  traceStartup("auth services initialized");

  app.use(
    "/api/tasks",
    createTaskRouter(missionRuntime, {
      requireAuth: authMiddleware.requireAuth,
      projects: projectsRepository,
      projectResources: projectResourcesRepository,
    })
  );
  app.use(
    "/api/auth",
    createAuthRouter({
      users: usersRepository,
      sessions: sessionsRepository,
      sessionService,
      emailLoginTokens: emailLoginTokensRepository,
      emailCodeService,
    })
  );
  app.use(
    "/api/projects",
    createProjectsRouter({
      requireAuth: authMiddleware.requireAuth,
      projects: projectsRepository,
      resources: projectResourcesRepository,
    })
  );
  app.use(
    "/api/knowledge",
    createKnowledgeRouter({
      graphStore,
      reviewQueue,
      knowledgeService,
      auditCollector,
    })
  );
  app.use(
    "/api/admin/knowledge",
    createKnowledgeAdminRouter({ graphStore, ontologyRegistry, reviewQueue })
  );
  app.use(
    "/api/admin",
    createAdminRouter({
      requireAuth: authMiddleware.requireAuth,
      requireAdmin: authMiddleware.requireAdmin,
      users: usersRepository,
      projects: projectsRepository,
    })
  );
  app.use(
    "/api/audit",
    createAuditRouter({
      chain: auditChain,
      query: auditQuery,
      verifier: auditVerifier,
      anomalyDetector,
      complianceMapper,
      auditExport,
      auditRetention,
      collector: auditCollector,
    })
  );

  const { createSkillRouter } = await import("./routes/skill.js");
  app.use("/api/skill", createSkillRouter());

  // ── Agent Permission Model ──
  const { RoleStore } = await import("./permission/role-store.js");
  const { PolicyStore } = await import("./permission/policy-store.js");
  const { TokenService } = await import("./permission/token-service.js");
  const { DynamicPermissionManager } = await import(
    "./permission/dynamic-manager.js"
  );
  const { ConflictDetector } = await import(
    "./permission/conflict-detector.js"
  );
  const { AuditLogger } = await import("./permission/audit-logger.js");
  const { createPermissionRouter } = await import("./routes/permissions.js");

  const permRoleStore = new RoleStore(db);
  permRoleStore.initBuiltinRoles();
  const permPolicyStore = new PolicyStore(db, permRoleStore);
  const permTokenService = new TokenService(permPolicyStore, permRoleStore);
  const permAuditLogger = new AuditLogger(db, auditCollector);
  const permDynamicManager = new DynamicPermissionManager(
    permPolicyStore,
    permTokenService,
    db,
    permAuditLogger
  );
  const permConflictDetector = new ConflictDetector(
    permPolicyStore,
    permRoleStore
  );

  app.use(
    "/api/permissions",
    createPermissionRouter({
      roleStore: permRoleStore,
      policyStore: permPolicyStore,
      tokenService: permTokenService,
      dynamicManager: permDynamicManager,
      conflictDetector: permConflictDetector,
      auditLogger: permAuditLogger,
    })
  );

  // Wire permission system into workflow engine and agent layer
  const { workflowEngine: wfEngine } = await import(
    "./core/workflow-engine.js"
  );
  const { setPermissionCheckEngine } = await import("./core/agent.js");
  const { PermissionCheckEngine } = await import(
    "./permission/check-engine.js"
  );
  const { FilesystemChecker } = await import(
    "./permission/checkers/filesystem-checker.js"
  );
  const { DatabaseChecker } = await import(
    "./permission/checkers/database-checker.js"
  );
  const { McpChecker } = await import("./permission/checkers/mcp-checker.js");

  wfEngine.tokenService = permTokenService;

  const permCheckEngine = new PermissionCheckEngine(
    permTokenService,
    permAuditLogger,
    new Map([
      ["filesystem", new FilesystemChecker()],
      ["database", new DatabaseChecker()],
      ["mcp_tool", new McpChecker()],
    ])
  );
  setPermissionCheckEngine(permCheckEngine);

  app.use(
    "/api/open-page",
    createOpenPageRouter({
      permissionEngine: permCheckEngine,
    })
  );

  const { createMcpRouter } = await import("./routes/mcp.js");
  traceStartup("tool route imports begin");
  const { createAudioRecognitionRouter } = await import(
    "./routes/audio-recognition.js"
  );
  const { createAiPptRouter } = await import("./routes/ai-ppt.js");
  const { createDynamicChartRouter } = await import(
    "./routes/dynamic-chart.js"
  );
  const { createExcelReadRouter } = await import("./routes/excel-read.js");
  const { createFileGenerationRouter } = await import(
    "./routes/file-generation.js"
  );
  const { createFileSlicingRouter } = await import("./routes/file-slicing.js");
  const { createFileTranslationRouter } = await import(
    "./routes/file-translation.js"
  );
  const { createFormatOutputRouter } = await import(
    "./routes/format-output.js"
  );
  const { createGraphSearchRouter } = await import("./routes/graph-search.js");
  const { createImageSearchRouter } = await import("./routes/image-search.js");
  const { createImageSearchExecuteFn: createImageSearchExecuteFnEarly } = await import(
    "./routes/node-adapters/image-search-executor.js"
  );
  const imageSearchExecuteFn = createImageSearchExecuteFnEarly();
  const { createOpenDashboardRouter } = await import(
    "./routes/open-dashboard.js"
  );
  const { createOrchestrationRecognitionJumpRouter } = await import(
    "./routes/orchestration-recognition-jump.js"
  );
  const { createIntentRecognitionRouter } = await import(
    "./routes/intent-recognition.js"
  );
  const { createLongTextExtractionRouter } = await import(
    "./routes/long-text-extraction.js"
  );
  const { createOcrRecognitionRouter } = await import(
    "./routes/ocr-recognition.js"
  );
  const { createSimilarityMatchRouter } = await import(
    "./routes/similarity-match.js"
  );
  const { createStaticWebpageReadRouter } = await import(
    "./routes/static-webpage-read.js"
  );
  const { createTransactionFlowRouter } = await import(
    "./routes/transaction-flow.js"
  );
  const { createWebSearchRouter } = await import("./routes/web-search.js");
  const { createWebQaRouter } = await import("./routes/web-qa.js");
  const { createVectorDeleteRouter } = await import(
    "./routes/vector-delete.js"
  );
  const { createVectorUpdateRouter } = await import(
    "./routes/vector-update.js"
  );
  const { createGetLocationInfoRouter } = await import(
    "./routes/get-location-info.js"
  );
  const { createGetDeviceInfoRouter } = await import(
    "./routes/get-device-info.js"
  );
  const { McpToolAdapter } = await import("./tool/api/mcp-tool-adapter.js");
  const { InternalMcpToolInvoker } = await import(
    "./tool/api/internal-mcp-tool-invoker.js"
  );
  const { VectorDeleteAdapter } = await import(
    "./web-aigc/vector-delete-adapter.js"
  );
  const { VectorUpdateAdapter } = await import(
    "./web-aigc/vector-update-adapter.js"
  );
  const { registerWebAigcRuntimeExtraAdapters } = await import(
    "./core/web-aigc-runtime-extra-adapters.js"
  );
  const { executeRealWebSearch } = await import(
    "./core/web-search-provider.js"
  );
  const { callLLM: callLLMForTranslation } = await import(
    "./core/llm-client.js"
  );
  const { transcribeAudio } = await import(
    "./core/audio-transcription-provider.js"
  );
  const { generateDeckViaLLM } = await import(
    "./core/ai-ppt-generation-provider.js"
  );
  const mcpToolAdapter = new McpToolAdapter({
    invoker: new InternalMcpToolInvoker(),
    permissionEngine: permCheckEngine,
    auditLogger: permAuditLogger,
    escalationManager: permDynamicManager,
  });
  traceStartup("mcp adapter initialized");

  // —— autopilot-capability-bridge-mcp (task 18) ——
  // When the feature flag is set, wire the mainline `mcpToolAdapter` + an
  // optional default https fetcher into a fresh blueprint router instance so
  // `createRouteGenerationSandboxDerivation` can upgrade the
  // `mcp-github-source` capability from templated fallback to a real MCP /
  // HTTP invocation. Otherwise we mount the default singleton and the bridge
  // stays in fallback mode (`provenance.executionMode = "simulated_fallback"`).
  // Task 12.2：master switch / explicit flag / BUILD_TARGET 的合一由
  // resolveAllBridgeEnablement 在启动期决策，这里只消费解析结果。
  const mcpBridgeEnabled = resolvedEnablement.mcpGithub === "true";
  traceStartup(`blueprint router mount begin mcpBridge=${String(mcpBridgeEnabled)}`);
  if (mcpBridgeEnabled) {
    const blueprintHttpFetcher = createDefaultBlueprintHttpFetcher({
      maxResponseBodyBytes: 1_048_576,
      defaultTimeoutMs: 30_000,
    });
    // 同时注入 docker capability bridge 使用的 blueprintServiceContext 与
    // mcp-github-source 使用的 mcpToolAdapter / httpFetcher：两条能力桥共享
    // 同一个 router / ctx，彼此独立回退。
    app.use(
      "/api/blueprint",
      createBlueprintRouter({
        blueprintServiceContext,
        mcpToolAdapter,
        httpFetcher: blueprintHttpFetcher,
      }),
    );
    // Task 12.3：启动期同步写入 mcp-github 桥的初始 configuration；桥内部每次
    // invocation 完成后会通过 diagnostics subscriber 追加 invocation 统计。
    blueprintServiceContext.runtimeDiagnostics.recordBridgeConfiguration(
      "mcpGithub",
      { enabledByConfig: true, dependencyReady: true },
    );
  } else {
    app.use(
      "/api/blueprint",
      createBlueprintRouter({ blueprintServiceContext }),
    );
    blueprintServiceContext.runtimeDiagnostics.recordBridgeConfiguration(
      "mcpGithub",
      { enabledByConfig: false, dependencyReady: false },
    );
  }
  traceStartup("blueprint router mounted");

  // Task 12.4（design §4.4 / requirement 5.2 / 6.1 / 6.2）：把剩余 4 条桥的
  // 启动期配置状态写入 diagnostics store。docker 桥的 configuration 由
  // `resolveDefaultExecutorClient` 的 fire-and-forget probe 异步补录
  // `dependencyReady`（design §4.3）；这里同步写一次初始值作为基线。
  {
    const dockerEnabled = resolvedEnablement.docker === "true";
    blueprintServiceContext.runtimeDiagnostics.recordBridgeConfiguration(
      "docker",
      {
        enabledByConfig: dockerEnabled,
        // 启动期尚未完成 probe，暂以 enabled 为基线；probe 回调会覆盖此值。
        dependencyReady:
          dockerEnabled && !!process.env.LOBSTER_EXECUTOR_BASE_URL,
      },
    );

    const llmApiKeyReady = !!blueprintServiceContext.llm.getConfig().apiKey;

    const roleEnabled = resolvedEnablement.role === "true";
    blueprintServiceContext.runtimeDiagnostics.recordBridgeConfiguration(
      "role",
      {
        enabledByConfig: roleEnabled,
        dependencyReady: roleEnabled && llmApiKeyReady,
      },
    );

    const aigcNodeEnabled = resolvedEnablement.aigcNode === "true";
    blueprintServiceContext.runtimeDiagnostics.recordBridgeConfiguration(
      "aigcNode",
      {
        enabledByConfig: aigcNodeEnabled,
        dependencyReady: aigcNodeEnabled && llmApiKeyReady,
      },
    );

    const stageEnabled =
      resolvedEnablement.agentCrewStageActivation === "true";
    blueprintServiceContext.runtimeDiagnostics.recordBridgeConfiguration(
      "agentCrewStageActivation",
      { enabledByConfig: stageEnabled, dependencyReady: stageEnabled },
    );
  }

  // Task 16.4（`autopilot-role-container-loader`）：启动期 recordBridgeConfiguration
  // 把 loader 的 enablement 与 dependency 状态写入 diagnostics store。
  blueprintServiceContext.runtimeDiagnostics.recordBridgeConfiguration(
    "roleContainerLoader",
    {
      enabledByConfig: resolvedRoleContainerLoaderEnabled === "true",
      dependencyReady: Boolean(blueprintServiceContext.roleContainerLoader),
    },
  );

  // autopilot-streaming-experience integration-gap-2026-05-16 P1：让诊断面与启动日志对齐。
  //
  // 背景：`/api/blueprint/diagnostics` 在 fresh server 上把 `roleAutonomousAgent` 与
  // `agentReasoningBridge` 报告为 `enabledByConfig=false / dependencyReady=false /
  // mode=unknown`，即使 `.env` 已显式把对应 flag 设成 `"true"`、且启动日志已经
  // 打出 `[blueprint] agentReasoningBridge enabled`。
  //
  // 根因：上文 docker / mcpGithub / role / aigcNode / agentCrewStageActivation /
  // roleContainerLoader 均同步写入了 `recordBridgeConfiguration(...)`，而
  // roleAutonomousAgent 与 agentReasoningBridge 的桥都是按 env flag 在 createBlueprintServiceContext
  // 内部 lazy 装配的，从未在启动期把 enablement / 依赖就绪状态同步给 diagnostics store。
  //
  // 修复：补两次同步 `recordBridgeConfiguration` 调用，依据各自的 env flag 加上
  // 上下文中是否已具备最小 runtime 依赖（`roleAgentDelegator` 与 `eventBus`）来推导
  // `dependencyReady`，与启动日志保持一致；不修改 diagnostics-store 内部 BridgeId
  // 列表，也不改 agent-reasoning-bridge.ts / callback-receiver.ts /
  // lite-agent-runtime.ts / llm-call.ts。
  {
    const roleAutonomousAgentEnabled =
      process.env.BLUEPRINT_ROLE_AUTONOMOUS_AGENT_ENABLED === "true";
    blueprintServiceContext.runtimeDiagnostics.recordBridgeConfiguration(
      "roleAutonomousAgent",
      {
        enabledByConfig: roleAutonomousAgentEnabled,
        // 角色自主 Agent 的最小依赖是 `RoleAgentDelegator`：context.ts 在 env flag
        // 为 "true" 且非测试环境下 lazy 装配；缺失时 dependencyReady 应为 false。
        dependencyReady:
          roleAutonomousAgentEnabled
          && Boolean(blueprintServiceContext.roleAgentDelegator),
      },
    );

    const agentReasoningBridgeEnabled =
      process.env.BLUEPRINT_AGENT_REASONING_STREAM_ENABLED === "true";
    blueprintServiceContext.runtimeDiagnostics.recordBridgeConfiguration(
      "agentReasoningBridge",
      {
        enabledByConfig: agentReasoningBridgeEnabled,
        // Agent 推理流桥订阅 `BlueprintEventBus` 把 role.agent.* 事件 forward 到
        // Socket.IO/HUD；`eventBus` 是 context 上的必填字段，因此把 dependencyReady
        // 直接对齐到 env flag 即可（`agentReasoningBridge.start()` 内部会再做一次
        // env / callbackReceiver 校验，env-off 时只是 no-op）。
        dependencyReady: agentReasoningBridgeEnabled
          && Boolean(blueprintServiceContext.eventBus),
      },
    );
  }

  // Blueprint Socket.IO relay（autopilot-realtime-observation-bridge Task 1.5）
  const socketIoInstance = getSocketIO();
  if (socketIoInstance) {
    const { createBlueprintSocketRelay } = await import("./routes/blueprint/socket-relay.js");
    const blueprintRelay = createBlueprintSocketRelay({
      eventBus: blueprintServiceContext.eventBus,
      io: socketIoInstance,
      logger: blueprintServiceContext.logger,
    });
    blueprintRelay.start();
  }

  // `autopilot-agent-reasoning-stream` spec Task 6.2-6.4：env-flag-gated
  // 装配 AgentReasoningBridge。仅当主开关 `BLUEPRINT_AGENT_REASONING_STREAM_ENABLED
  // === "true"` 且 `BUILD_TARGET !== "test"` 时才动态 import bridge 模块并
  // `.start()`，env-off 时本块不进入，无新增 import side effect、无 eager
  // 装配（Task 6.5）。bridge 工厂内部还有第二层 env / callbackReceiver 检查
  // （design §「Env flag off 路径」），即使 callbackReceiver 缺失也只是 no-op。
  if (
    process.env.BLUEPRINT_AGENT_REASONING_STREAM_ENABLED === "true" &&
    process.env.BUILD_TARGET !== "test"
  ) {
    try {
      const { createAgentReasoningBridge } = await import(
        "./routes/blueprint/agent-reasoning-bridge.js"
      );
      const bridge = createAgentReasoningBridge({
        eventBus: blueprintServiceContext.eventBus,
        callbackReceiver: blueprintServiceContext.callbackReceiver,
        delegator: blueprintServiceContext.roleAgentDelegator,
        runtimeDiagnostics: blueprintServiceContext.runtimeDiagnostics,
        logger: blueprintServiceContext.logger,
        now: () => new Date(),
      });
      // bridge.start() 内部会调用 runtimeDiagnostics.setAgentReasoningEnabled(true)，
      // 这里不重复调用以保持单一来源。
      bridge.start();
      // eslint-disable-next-line no-console
      console.log("[blueprint] agentReasoningBridge enabled");
    } catch (err) {
      // 装配失败兜底：不让宿主启动崩溃；env-off 路径与主线行为完全等价。
      // eslint-disable-next-line no-console
      console.warn(
        "[blueprint] failed to assemble agentReasoningBridge:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  app.use(
    "/api/mcp",
    createMcpRouter({
      executeMcp: request => mcpToolAdapter.execute(request),
    })
  );
  app.use("/api/ai-ppt", createAiPptRouter());
  app.use("/api/audio-recognition", createAudioRecognitionRouter());
  app.use("/api/dynamic-chart", createDynamicChartRouter());
  app.use("/api/excel-read", createExcelReadRouter());
  app.use("/api/file-generation", createFileGenerationRouter());
  app.use("/api/file-slicing", createFileSlicingRouter());
  app.use("/api/file-translation", createFileTranslationRouter());
  app.use("/api/format-output", createFormatOutputRouter());
  app.use(
    "/api/graph-search",
    createGraphSearchRouter({
      queryService,
      knowledgeService,
    })
  );
  app.use("/api/image-search", createImageSearchRouter({ executeImageSearch: imageSearchExecuteFn }));
  app.use("/api/intent-recognition", createIntentRecognitionRouter());
  app.use(
    "/api/orchestration-recognition-jump",
    createOrchestrationRecognitionJumpRouter({
      permissionEngine: permCheckEngine,
      auditLogger: permAuditLogger,
    })
  );
  app.use("/api/long-text-extraction", createLongTextExtractionRouter());
  app.use("/api/ocr-recognition", createOcrRecognitionRouter());
  app.use(
    "/api/transaction-flow",
    createTransactionFlowRouter({
      permissionEngine: permCheckEngine,
      auditLogger: permAuditLogger,
    })
  );
  app.use(
    "/api/open-dashboard",
    createOpenDashboardRouter({
      permissionEngine: permCheckEngine,
    })
  );
  app.use("/api/similarity-match", createSimilarityMatchRouter());
  app.use("/api/static-webpage-read", createStaticWebpageReadRouter());
  if (ragDeps) {
    app.use(
      "/api/vector-update",
      createVectorUpdateRouter({
        vectorUpdateAdapter: new VectorUpdateAdapter({
          metadataStore: ragDeps.metadataStore,
          vectorStore: ragDeps.vectorStore,
          permissionEngine: permCheckEngine,
          auditLogger: permAuditLogger,
        }),
      })
    );
    app.use(
      "/api/vector-delete",
      createVectorDeleteRouter({
        vectorDeleteAdapter: new VectorDeleteAdapter({
          metadataStore: ragDeps.metadataStore,
          vectorStore: ragDeps.vectorStore,
          permissionEngine: permCheckEngine,
          auditLogger: permAuditLogger,
        }),
      })
    );
  }
  app.use("/api/web-search", createWebSearchRouter({ executeWebSearch: executeRealWebSearch }));
  app.use(
    "/api/web-qa",
    createWebQaRouter({
      documentSearch: chatDocumentSearch,
      knowledgeService,
      permissionEngine: permCheckEngine,
    })
  );
  app.use("/api/get-location-info", createGetLocationInfoRouter());
  app.use(
    "/api/get-device-info",
    createGetDeviceInfoRouter({
      processPlatform: process.platform,
      processArch: process.arch,
      processVersion: process.version,
    })
  );
  serverRuntime.documentSearch = chatDocumentSearch;

  // ── Real fetchStaticWebpageHtml implementation (Node 20+ built-in fetch) ──
  const fetchStaticWebpageHtml = async (url: string): Promise<string> => {
    const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
    const TIMEOUT_MS = 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; CubePetsOffice/1.0; +https://github.com/nicepkg/cube-pets-office)",
          Accept: "text/html, text/*;q=0.9",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("text/")
      ) {
        throw new Error(
          `Unexpected content-type: ${contentType}. Expected text/html or text/*.`,
        );
      }

      const contentLength = response.headers.get("content-length");
      if (
        contentLength &&
        Number.parseInt(contentLength, 10) > MAX_RESPONSE_SIZE
      ) {
        throw new Error(
          `Response too large: ${contentLength} bytes exceeds 5MB limit.`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return response.text();
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_SIZE) {
          reader.cancel();
          throw new Error(
            `Response too large: exceeded 5MB limit during streaming.`,
          );
        }
        chunks.push(value);
      }

      const decoder = new TextDecoder();
      return (
        chunks
          .map((chunk) => decoder.decode(chunk, { stream: true }))
          .join("") + decoder.decode()
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Static webpage fetch timed out after ${TIMEOUT_MS}ms for URL: ${url}`,
        );
      }
      throw new Error(
        `Failed to fetch static webpage (${url}): ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  };

  // ── Real LLM-based file translation ──
  const translateSegmentViaLlm = async (input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    kind: string;
    index: number;
    fileName: string;
    mimeType: string;
  }): Promise<string> => {
    if (!input.text.trim()) return input.text;

    try {
      const systemPrompt =
        `You are a professional translator. Translate the following text from ${input.sourceLanguage === "auto" ? "the detected language" : input.sourceLanguage} to ${input.targetLanguage}. ` +
        `Return ONLY the translated text, without any explanation, prefix, or formatting. ` +
        `Preserve the original meaning and tone.`;

      const response = await callLLMForTranslation(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: input.text },
        ],
        { temperature: 0.3, maxTokens: 2048 },
      );

      const translated = response.content.trim();
      return translated || input.text;
    } catch {
      // Fallback: return original text if LLM fails
      return `[${input.targetLanguage}] ${input.text}`;
    }
  };

  registerWebAigcRuntimeExtraAdapters({
    documentSearch: chatDocumentSearch,
    knowledgeService,
    executeMcp: request => mcpToolAdapter.execute(request),
    queryService,
    permissionEngine: permCheckEngine,
    executeWebSearch: executeRealWebSearch,
    executeImageSearch: imageSearchExecuteFn,
    fetchStaticWebpageHtml,
    fileTranslationRuntime: {
      translateSegment: translateSegmentViaLlm,
    },
    orchestrationRecognitionJumpRuntime: {
      permissionEngine: permCheckEngine,
      auditLogger: permAuditLogger,
    },
    audioRecognitionRuntime: {
      recognizeAudio: transcribeAudio,
    },
    aiPptRuntime: {
      generateDeck: generateDeckViaLLM,
    },
    ocrRecognitionRuntime: {},
    deviceRuntime: {
      processPlatform: process.platform,
      processArch: process.arch,
      processVersion: process.version,
    },
    transactionFlowRuntime: {
      permissionEngine: permCheckEngine,
      auditLogger: permAuditLogger,
    },
  });

  if (ragConfig.enabled && ragDeps) {
    try {
      const { VectorInsertAdapter } = await import(
        "./web-aigc/vector-insert-adapter.js"
      );
      const { VectorDeleteAdapter } = await import(
        "./web-aigc/vector-delete-adapter.js"
      );
      const { VectorUpdateAdapter } = await import(
        "./web-aigc/vector-update-adapter.js"
      );
      const { createWebAigcRiskActionRouter } = await import(
        "./routes/web-aigc-risk-actions.js"
      );

      app.use(
        "/api/rag/risk-actions",
        createWebAigcRiskActionRouter({
          vectorInsertAdapter: new VectorInsertAdapter({
            ingestionPipeline: ragDeps.ingestionPipeline,
            metadataStore: ragDeps.metadataStore,
            permissionEngine: permCheckEngine,
            auditLogger: permAuditLogger,
          }),
          vectorUpdateAdapter: new VectorUpdateAdapter({
            metadataStore: ragDeps.metadataStore,
            vectorStore: ragDeps.vectorStore,
            permissionEngine: permCheckEngine,
            auditLogger: permAuditLogger,
          }),
          vectorDeleteAdapter: new VectorDeleteAdapter({
            metadataStore: ragDeps.metadataStore,
            vectorStore: ragDeps.vectorStore,
            permissionEngine: permCheckEngine,
            auditLogger: permAuditLogger,
          }),
        })
      );
    } catch (error) {
      console.warn("[Web-AIGC] Risk action routes disabled:", error);
    }
  }

  const nlCommandRoutes = (await import("./routes/nl-command.js")).default;
  app.use("/api/nl-command", nlCommandRoutes);

  // ── A2A Protocol ──
  const { A2AServer: A2AServerClass } = await import("./core/a2a-server.js");
  const { A2AClient: A2AClientClass } = await import("./core/a2a-client.js");
  const a2aRoutes = await import("./routes/a2a.js");

  const a2aAgents = db.getAgents().map(agent => ({
    id: agent.id,
    name: agent.name,
    capabilities: [] as string[],
    description: agent.role ?? agent.name,
  }));
  const a2aServer = new A2AServerClass({
    agentExecutor: {
      execute: async (agentId, task, context) => {
        const agent = registry.get(agentId);
        if (!agent) {
          throw new Error(`Agent not found: ${agentId}`);
        }
        const prompt = context?.trim()
          ? `${task}\n\nAdditional context:\n${context}`
          : task;
        return agent.invoke(prompt, context?.trim() ? [context] : undefined, {
          stage: "a2a",
        });
      },
      executeStream: async function* (agentId, task, context) {
        const agent = registry.get(agentId);
        if (!agent) {
          throw new Error(`Agent not found: ${agentId}`);
        }
        const prompt = context?.trim()
          ? `${task}\n\nAdditional context:\n${context}`
          : task;
        const output = await agent.invoke(
          prompt,
          context?.trim() ? [context] : undefined,
          {
            stage: "a2a",
          }
        );
        if (!output) {
          return;
        }
        for (const chunk of output.match(/[\s\S]{1,400}/g) ?? [output]) {
          yield chunk;
        }
      },
    },
    exposedAgents: a2aAgents,
  });
  const a2aClient = new A2AClientClass();
  a2aRoutes.initA2ARoutes(a2aServer, a2aClient);
  app.use("/api/a2a", a2aRoutes.default);

  // ── Data Lineage Tracking ──
  const { JsonLineageStorage } = await import("./lineage/lineage-store.js");
  const { LineageQueryService } = await import("./lineage/lineage-query.js");
  const { LineageAuditService } = await import("./lineage/lineage-audit.js");
  const { ChangeDetectionService } = await import(
    "./lineage/change-detection.js"
  );
  const { LineageExportService } = await import("./lineage/lineage-export.js");
  const { createLineageRouter } = await import("./routes/lineage.js");

  const lineageStore = new JsonLineageStorage("data/lineage");
  lineageStore.init();
  const lineageQueryService = new LineageQueryService(lineageStore);
  const lineageAuditService = new LineageAuditService(
    lineageStore,
    lineageQueryService
  );
  const lineageChangeDetection = new ChangeDetectionService(
    lineageStore,
    lineageQueryService
  );
  const lineageExportService = new LineageExportService(lineageStore);

  app.use(
    "/api/lineage",
    createLineageRouter({
      queryService: lineageQueryService,
      auditService: lineageAuditService,
      exportService: lineageExportService,
      changeDetectionService: lineageChangeDetection,
      store: lineageStore,
    })
  );

  // ── Guest Agents (agent-marketplace) ──
  const guestAgentRoutes = (await import("./routes/guest-agents.js")).default;
  app.use("/api/agents/guest", guestAgentRoutes);

  app.post("/api/executor/events", async (request, response) => {
    const typedRequest = request as RequestWithRawBody;
    if (!verifyExecutorCallbackSignature(typedRequest, response)) return;

    const event = (request.body as ExecutorCallbackRequestBody | undefined)
      ?.event;
    if (
      !event?.missionId?.trim() ||
      !event?.jobId?.trim() ||
      !event?.eventId?.trim()
    ) {
      return response.status(400).json({
        ok: false,
        error:
          "Executor callback body must include event.missionId, event.jobId, and event.eventId",
      });
    }

    const missionId = event.missionId.trim();
    if (missionId.startsWith("blueprint:")) {
      return response.status(202).json({
        ok: true,
        accepted: true,
        missionId,
        jobId: event.jobId.trim(),
        eventId: event.eventId.trim(),
      });
    }

    const current = missionRuntime.getTask(missionId);
    if (!current) {
      return response.status(404).json({
        ok: false,
        error: `Mission not found for executor event: ${missionId}`,
      });
    }

    const progress =
      typeof event.progress === "number"
        ? Math.max(0, Math.min(100, event.progress))
        : current.progress;
    const stageKey = resolveExecutorStageKey(event, current.currentStageKey);
    const detail =
      event.detail?.trim() ||
      event.message?.trim() ||
      `Executor event at ${executorStageLabel(stageKey)}`;
    const executorName =
      event.executor?.trim() || current.executor?.name || "executor";
    const artifacts = normalizeExecutorArtifacts(event.artifacts);
    const instance = normalizeExecutorInstance(event.payload);
    const securitySummary = normalizeSecuritySummary(event.payload);
    const previewSession = normalizePreviewSession(event.payload);

    // ── Determine effective executor status ──
    // For job.started events, force status to "running" regardless of payload
    const effectiveExecutorStatus =
      event.type === "job.started"
        ? "running"
        : event.status?.trim() || current.executor?.status;

    missionRuntime.patchMissionExecution(missionId, {
      executor: {
        name: executorName,
        requestId: current.executor?.requestId,
        jobId: event.jobId.trim(),
        status: effectiveExecutorStatus,
        baseUrl: current.executor?.baseUrl,
        lastEventType: event.type?.trim() || current.executor?.lastEventType,
        lastEventAt: Date.now(),
      },
      instance: instance || current.instance,
      artifacts: artifacts || current.artifacts,
      securitySummary: securitySummary || current.securitySummary,
      previewSession: previewSession || current.previewSession,
    });

    // ── HeartbeatMonitor: reset on every event ──
    heartbeatMonitor.resetHeartbeat(missionId);

    if (event.type === "job.started") {
      // Req 4.1: job.started → executor.status = running (handled above via effectiveExecutorStatus)
      missionRuntime.markMissionRunning(
        missionId,
        stageKey,
        detail,
        progress,
        "executor"
      );
    } else if (event.type === "job.progress") {
      // Req 4.2: job.progress → update mission progress
      missionRuntime.markMissionRunning(
        missionId,
        stageKey,
        detail,
        progress,
        "executor"
      );
    } else if (event.type === "job.log") {
      missionRuntime.logMission(
        missionId,
        event.log?.message?.trim() || detail,
        event.log?.level === "error"
          ? "error"
          : event.log?.level === "warn"
            ? "warn"
            : "info",
        progress,
        "executor"
      );
    } else if (event.type === "job.log_stream") {
      // Req 4.5: job.log_stream → Socket.IO forward
      const logEntry = {
        missionId,
        jobId: event.jobId.trim(),
        stepIndex: typeof event.stepIndex === "number" ? event.stepIndex : 0,
        stream: (event.stream === "stderr" ? "stderr" : "stdout") as
          | "stdout"
          | "stderr",
        data: event.data ?? "",
        timestamp: event.occurredAt?.trim() || new Date().toISOString(),
      };
      sandboxRelay.appendLog(logEntry);
      const io = getSocketIO();
      if (io) {
        io.emit(SANDBOX_SOCKET_EVENTS.missionLog, logEntry);
      }
    } else if (event.type === "job.screenshot") {
      // Req 4.6: job.screenshot → Socket.IO forward
      const screenPayload = {
        missionId,
        jobId: event.jobId.trim(),
        stepIndex: typeof event.stepIndex === "number" ? event.stepIndex : 0,
        imageData: event.imageData ?? "",
        width: typeof event.imageWidth === "number" ? event.imageWidth : 0,
        height: typeof event.imageHeight === "number" ? event.imageHeight : 0,
        timestamp: event.occurredAt?.trim() || new Date().toISOString(),
      };
      const io = getSocketIO();
      if (io) {
        io.emit(SANDBOX_SOCKET_EVENTS.missionScreen, screenPayload);
      }
    } else if (event.type === "job.waiting" || event.status === "waiting") {
      missionRuntime.markMissionRunning(
        missionId,
        stageKey,
        detail,
        progress,
        "executor"
      );
      missionRuntime.waitOnMission(
        missionId,
        event.waitingFor?.trim() || detail,
        detail,
        progress,
        normalizeExecutorDecision(event.decision),
        "executor"
      );
    } else if (event.type === "job.completed" || event.status === "completed") {
      // Req 4.3: job.completed → mission.status = done
      missionRuntime.markMissionRunning(
        missionId,
        stageKey,
        detail,
        progress,
        "executor"
      );
      missionRuntime.finishMission(
        missionId,
        event.summary?.trim() || detail,
        "executor"
      );
      // Terminal event: clear heartbeat
      heartbeatMonitor.clearHeartbeat(missionId);
    } else if (
      event.type === "job.failed" ||
      event.type === "job.cancelled" ||
      event.status === "failed" ||
      event.status === "cancelled"
    ) {
      missionRuntime.markMissionRunning(
        missionId,
        stageKey,
        detail,
        progress,
        "executor"
      );
      if (event.type === "job.cancelled" || event.status === "cancelled") {
        missionRuntime.cancelMission(missionId, {
          reason: event.summary?.trim() || detail,
          requestedBy: executorName,
          source: "executor",
        });
      } else {
        // Req 4.4: job.failed → mission.status = failed
        missionRuntime.failMission(
          missionId,
          event.summary?.trim() || detail,
          "executor"
        );
      }
      // Terminal event: clear heartbeat
      heartbeatMonitor.clearHeartbeat(missionId);
    } else {
      missionRuntime.markMissionRunning(
        missionId,
        stageKey,
        detail,
        progress,
        "executor"
      );
    }

    return response.json({
      ok: true,
      accepted: true,
      missionId,
      jobId: event.jobId.trim(),
      eventId: event.eventId.trim(),
    });
  });

  app.post("/api/tasks/smoke/dispatch", async (request, response) => {
    if (!isSmokeEnabled()) return sendSmokeDisabled(response);

    const body = (request.body || {}) as DispatchSmokeRequestBody;
    const outcome = normalizeSmokeOutcome(body.outcome);
    const sourceText =
      body.sourceText?.trim() ||
      (outcome === "failed"
        ? "Execute a smoke task that should fail after staged executor updates."
        : "Execute a smoke task that should complete after staged executor updates.");
    const title =
      body.title?.trim() ||
      (outcome === "failed"
        ? "Mission integration smoke failure"
        : "Mission integration smoke success");

    const mission = missionRuntime.createTask({
      kind: "executor-smoke",
      title,
      sourceText,
      stageLabels: SMOKE_STAGE_LABELS,
    });

    try {
      missionRuntime.markMissionRunning(
        mission.id,
        "understand",
        "Smoke mission accepted and queued for plan building.",
        8,
        "brain"
      );

      const buildResult = await buildExecutionPlan({
        missionId: mission.id,
        title,
        sourceText,
        requestedBy: "system",
      });

      missionRuntime.updateMissionStage(
        mission.id,
        "understand",
        { status: "done", detail: buildResult.understanding.summary },
        16,
        "brain"
      );
      missionRuntime.markMissionRunning(
        mission.id,
        "plan",
        "Structured execution plan created for smoke dispatch.",
        28,
        "brain"
      );
      missionRuntime.updateMissionStage(
        mission.id,
        "plan",
        { status: "done", detail: buildResult.plan.summary },
        36,
        "brain"
      );
      missionRuntime.markMissionRunning(
        mission.id,
        "provision",
        "Provisioning executor job on lobster.",
        45,
        "brain"
      );

      const firstJob = buildResult.plan.jobs[0];
      if (!firstJob) {
        throw new Error("Execution plan did not produce any executor jobs.");
      }

      const executionMode =
        process.env.LOBSTER_EXECUTION_MODE === "mock" ? "mock" : "real";
      if (executionMode === "mock") {
        // Mock mode: use fake runner for quick smoke testing without Docker
        firstJob.payload = {
          ...(firstJob.payload || {}),
          runner: {
            kind: "mock",
            outcome,
            steps: 3,
            delayMs: 40,
            summary:
              outcome === "failed"
                ? "Smoke failed job completed with expected mock failure"
                : "Smoke success job completed",
          },
        };
      } else {
        // Real mode: run in Docker container
        firstJob.payload = {
          ...(firstJob.payload || {}),
          image: process.env.LOBSTER_DEFAULT_IMAGE || "node:20-slim",
          command:
            outcome === "failed"
              ? [
                  "sh",
                  "-c",
                  "echo 'Smoke test running in Docker...' && sleep 2 && echo 'Failing as requested' && exit 1",
                ]
              : [
                  "sh",
                  "-c",
                  "echo 'Smoke test running in Docker...' && sleep 2 && echo 'Success!' && mkdir -p /workspace/artifacts && echo '{\"smoke\":true}' > /workspace/artifacts/result.json",
                ],
          env: {
            SMOKE_TEST: "true",
            SMOKE_OUTCOME: outcome,
          },
        };
      }

      const executorBaseUrl =
        body.executorBaseUrl?.trim() ||
        process.env.LOBSTER_EXECUTOR_BASE_URL?.trim() ||
        DEFAULT_EXECUTOR_BASE_URL;
      const callbackUrl = new URL(
        EXECUTOR_API_ROUTES.events,
        buildServerBaseUrl(request)
      ).toString();
      const executorClient = new ExecutorClient({
        baseUrl: executorBaseUrl,
        callbackUrl,
      });

      const dispatchResult = await executorClient.dispatchPlan(
        buildResult.plan,
        {
          jobId: firstJob.id,
          requestId: `smoke_${mission.id}`,
          traceId: randomUUID(),
          idempotencyKey: `smoke:${mission.id}:${outcome}`,
        }
      );

      missionRuntime.updateMissionStage(
        mission.id,
        "provision",
        {
          status: "done",
          detail: `Executor accepted job ${dispatchResult.response.jobId}.`,
        },
        60,
        "brain"
      );
      missionRuntime.patchMissionExecution(mission.id, {
        executor: {
          name: dispatchResult.request.executor,
          requestId: dispatchResult.request.requestId,
          jobId: dispatchResult.response.jobId,
          status: "queued",
          baseUrl: executorBaseUrl,
          lastEventType: "job.accepted",
          lastEventAt: Date.now(),
        },
        instance: {
          workspaceRoot: buildResult.plan.workspaceRoot,
        },
        artifacts: buildResult.plan.artifacts,
      });
      missionRuntime.markMissionRunning(
        mission.id,
        "execute",
        "Executor is running the smoke job. Replay executor events into /api/executor/events to complete the loop.",
        64,
        "brain"
      );

      return response.json({
        ok: true,
        missionId: mission.id,
        jobId: dispatchResult.response.jobId,
        executorBaseUrl,
        callbackUrl,
        task: missionRuntime.getTask(mission.id),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      missionRuntime.failMission(mission.id, detail, "brain");
      return response.status(502).json({
        ok: false,
        missionId: mission.id,
        error: detail,
      });
    }
  });

  app.post("/api/tasks/smoke/seed-running", (request, response) => {
    if (!isSmokeEnabled()) return sendSmokeDisabled(response);

    const body = (request.body || {}) as SeedRunningSmokeRequestBody;
    const mission = missionRuntime.createTask({
      kind: "restart-smoke",
      title: body.title?.trim() || "Mission restart recovery smoke",
      sourceText:
        body.sourceText?.trim() ||
        "Create a running mission so restart recovery can mark it as failed.",
      stageLabels: SMOKE_STAGE_LABELS,
    });

    const stageKey = body.stageKey?.trim() || "execute";
    const detail =
      body.detail?.trim() ||
      "Mission is mid-flight and waiting for server restart smoke.";
    const progress =
      typeof body.progress === "number"
        ? Math.max(1, Math.min(99, Math.round(body.progress)))
        : 52;

    missionRuntime.markMissionRunning(
      mission.id,
      stageKey,
      detail,
      progress,
      "brain"
    );

    return response.json({
      ok: true,
      missionId: mission.id,
      task: missionRuntime.getTask(mission.id),
    });
  });

  heartbeatScheduler.start();

  const { createPersistenceHealthRouter } = await import(
    "./routes/persistence-health.js"
  );
  app.use("/api/health/persistence", createPersistenceHealthRouter());

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      features: {
        workflows: true,
        tasks: true,
        feishu: true,
        executorCallbacks: true,
        missionSocket: true,
      },
    });
  });

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`API available at http://localhost:${port}/api/`);
  });

  // ── Graceful shutdown ──
  // tsx watch will send SIGTERM when files change and re-spawn the process;
  // Ctrl+C triggers SIGINT. Both paths need to:
  //   1. Stop accepting new connections (server.close());
  //   2. Close the MySQL pool (authDb.close() -> pool.end()) to avoid the
  //      mysql2 pool.js:36 synchronous crash when an in-flight query races
  //      with the pool being closed on process exit.
  //   3. Force-exit so dangling handles don't block tsx watch's respawn.
  //
  // shutdown is idempotent - a second signal is a no-op.
  let isShuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Shutdown] Received ${signal}, closing gracefully...`);

    server.close(err => {
      if (err) {
        console.error("[Shutdown] HTTP server close error:", err);
      } else {
        console.log("[Shutdown] HTTP server closed");
      }
    });

    try {
      await authDb.close();
      console.log("[Shutdown] MySQL pool closed");
    } catch (error) {
      console.error("[Shutdown] MySQL pool close error:", error);
    }

    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  // 全局兜底：防止单次未处理的 async 异常（例如 MySQL 瞬时 ECONNRESET、LLM HTTP 500、
  // 第三方 SDK 内部抛错）把整个 Node 进程拖死。在开发态这会让服务崩溃后需要重启,
  // 在生产态更不能接受;默认策略是记日志但不退出进程,让下一次请求走正常错误路径。
  //
  // 例外：如果错误明确表示进程级不可恢复（例如 out-of-memory），仍然应让进程退出。
  // 目前没有这类信号,全部记日志即可。
  process.on("unhandledRejection", (reason, promise) => {
    console.error("[process] unhandledRejection:", reason);
    // 不重新抛出；下一次 tick 不会让进程退出。
    void promise;
  });
  process.on("uncaughtException", (error) => {
    console.error("[process] uncaughtException:", error);
    // 不退出进程;express 下游请求仍会继续。
  });
}

export { initializeAgentRuntime, startServer };
startServer().catch(console.error);
