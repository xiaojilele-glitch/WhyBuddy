/**
 * Blueprint Socket.IO 中继模块。
 *
 * 订阅 `BlueprintEventBus` 的事件，按 jobId 隔离推送到对应 Socket.IO room。
 * 默认只推送 `role` / `capability` / `crew` / `job` / `evidence` / `sandbox` 六个家族，
 * 其余家族（`clarification` / `route` / `spec` / `preview` / `prompt` / `mission`）
 * 由现有 HTTP 轮询或专用通道处理。
 *
 * 高频事件场景下使用 100ms 聚合窗口，通过 `blueprint:batch` 批量推送。
 *
 * 对应 `.kiro/specs/autopilot-realtime-observation-bridge` Task 1 / Task 6。
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { BlueprintEventBus, BlueprintLogger } from "./context.js";
import type { BlueprintGenerationEvent } from "../../../shared/blueprint/contracts.js";
import { resolveBlueprintEventFamily } from "../../../shared/blueprint/events.js";
import type { BlueprintGenerationEventFamily } from "../../../shared/blueprint/events.js";

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

/**
 * Socket.IO 中继实例接口。
 */
export interface BlueprintSocketRelay {
  /** 启动中继，订阅 eventBus 并绑定 Socket.IO 连接事件 */
  start(): void;
  /** 停止中继，清理订阅 */
  stop(): void;
}

/**
 * 工厂函数依赖。
 */
export interface BlueprintSocketRelayDeps {
  eventBus: BlueprintEventBus;
  io: SocketIOServer;
  logger?: BlueprintLogger;
  /** 可选：事件家族过滤集合，默认推送 role / capability / crew / job / evidence / sandbox */
  familyFilter?: Set<string>;
  /** 可选：批量推送聚合窗口（毫秒），默认 100ms */
  batchWindowMs?: number;
  /** 可选：每批最大事件数，默认 10 */
  maxBatchSize?: number;
}

// ---------------------------------------------------------------------------
// 默认家族过滤
// ---------------------------------------------------------------------------

/** 默认推送到前端的事件家族 */
const DEFAULT_RELAY_FAMILIES: Set<string> = new Set<string>([
  "role",
  "capability",
  "crew",
  "job",
  "evidence",
  "sandbox",
  "brainstorm",
]);

/** 默认批量聚合窗口 */
const DEFAULT_BATCH_WINDOW_MS = 100;

/** 默认每批最大事件数 */
const DEFAULT_MAX_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// jobId 校验
// ---------------------------------------------------------------------------

const MAX_JOB_ID_LENGTH = 128;

/**
 * 校验 jobId 是否合法：非空字符串且长度 ≤ 128。
 */
function isValidJobId(jobId: unknown): jobId is string {
  return (
    typeof jobId === "string" &&
    jobId.length > 0 &&
    jobId.length <= MAX_JOB_ID_LENGTH
  );
}

// ---------------------------------------------------------------------------
// 批量推送缓冲区
// ---------------------------------------------------------------------------

interface BatchBuffer {
  events: Array<{
    type: string;
    jobId: string;
    timestamp: string;
    payload?: Record<string, unknown>;
  }>;
  timer: ReturnType<typeof setTimeout> | null;
}

function buildRelayedPayload(
  event: BlueprintGenerationEvent
): Record<string, unknown> {
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? { ...(event.payload as Record<string, unknown>) }
      : {};

  payload.stage ??= event.stage;
  payload.status ??= event.status;
  payload.message ??= event.message;
  payload.roleId ??= event.roleId;

  return payload;
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 Blueprint Socket.IO 中继实例。
 *
 * @param deps - 依赖注入
 * @returns BlueprintSocketRelay 实例
 */
export function createBlueprintSocketRelay(
  deps: BlueprintSocketRelayDeps,
): BlueprintSocketRelay {
  const { eventBus, io, logger, familyFilter, batchWindowMs, maxBatchSize } =
    deps;
  const allowedFamilies = familyFilter ?? DEFAULT_RELAY_FAMILIES;
  const windowMs = batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS;
  const maxBatch = maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  let unsubscribe: (() => void) | null = null;
  let started = false;

  /** 按 jobId 维护的批量缓冲区 */
  const batchBuffers = new Map<string, BatchBuffer>();

  /**
   * 刷新指定 jobId 的批量缓冲区。
   */
  function flushBatch(jobId: string): void {
    const buffer = batchBuffers.get(jobId);
    if (!buffer || buffer.events.length === 0) return;

    const room = `blueprint:${jobId}`;
    const roomSockets = io.sockets.adapter.rooms.get(room);
    if (!roomSockets || roomSockets.size === 0) {
      // Room 已空，丢弃缓冲
      buffer.events.length = 0;
      return;
    }

    // 批量推送
    io.to(room).emit("blueprint:batch", buffer.events);
    buffer.events = [];

    if (buffer.timer !== null) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
  }

  /**
   * 将事件加入批量缓冲区。
   */
  function enqueueEvent(
    jobId: string,
    payload: {
      type: string;
      jobId: string;
      timestamp: string;
      payload?: Record<string, unknown>;
    }
  ): void {
    let buffer = batchBuffers.get(jobId);
    if (!buffer) {
      buffer = { events: [], timer: null };
      batchBuffers.set(jobId, buffer);
    }

    buffer.events.push(payload);

    // 达到最大批量大小时立即刷新
    if (buffer.events.length >= maxBatch) {
      flushBatch(jobId);
      return;
    }

    // 启动聚合窗口定时器
    if (buffer.timer === null) {
      buffer.timer = setTimeout(() => {
        buffer!.timer = null;
        flushBatch(jobId);
      }, windowMs);
    }
  }

  /**
   * 处理 eventBus 事件：按家族过滤、按 jobId 路由到 room。
   * 高频事件使用批量缓冲区聚合推送。
   */
  function handleEvent(event: BlueprintGenerationEvent): void {
    if (!started) return;

    // 1. 家族过滤：优先使用 event.family 字段，fallback 到从 type 解析
    const family: string =
      event.family ?? resolveBlueprintEventFamily(event.type);
    if (!allowedFamilies.has(family)) return;

    // 2. jobId 校验
    if (!isValidJobId(event.jobId)) return;

    // 3. 按 jobId 路由到 room
    const room = `blueprint:${event.jobId}`;

    // 4. 构造精简 payload
    const payload = {
      type: event.type,
      jobId: event.jobId,
      timestamp: event.occurredAt ?? new Date().toISOString(),
      payload: buildRelayedPayload(event),
    };

    // 5. 高频事件（capability 家族）使用批量推送
    //    autopilot-streaming-experience 需求 3：批量缓冲路径仍保留 flushBatch
    //    内的空房间裁剪，因此这里把事件入队即可。
    if (family === "capability") {
      enqueueEvent(event.jobId, payload);
      return;
    }

    // 6. 其他事件直接推送
    //    autopilot-streaming-experience 需求 3：
    //    不再因为房间当前为空就丢弃事件。Socket.IO 在房间无订阅者时会自然忽略 emit，
    //    不会阻塞后到达的 socket；订阅前/订阅瞬间的事件因此不会被静默丢弃。
    io.to(room).emit("blueprint:event", payload);
  }

  /**
   * 处理新 Socket.IO 连接：绑定 subscribe / unsubscribe 事件。
   */
  function handleConnection(socket: Socket): void {
    socket.on("blueprint:subscribe", (data: unknown) => {
      const jobId = (data as { jobId?: unknown })?.jobId;
      if (!isValidJobId(jobId)) return;
      socket.join(`blueprint:${jobId}`);
      logger?.info?.(`Socket ${socket.id} joined blueprint:${jobId}`);
    });

    socket.on("blueprint:unsubscribe", (data: unknown) => {
      const jobId = (data as { jobId?: unknown })?.jobId;
      if (!isValidJobId(jobId)) return;
      socket.leave(`blueprint:${jobId}`);
      logger?.info?.(`Socket ${socket.id} left blueprint:${jobId}`);
    });
  }

  return {
    start() {
      if (started) return;
      started = true;
      unsubscribe = eventBus.subscribe(handleEvent);
      io.on("connection", handleConnection);
      logger?.info?.("BlueprintSocketRelay started");
    },
    stop() {
      if (!started) return;
      started = false;
      unsubscribe?.();
      unsubscribe = null;
      io.off("connection", handleConnection);

      // 清理所有批量缓冲区
      for (const [, buffer] of batchBuffers) {
        if (buffer.timer !== null) {
          clearTimeout(buffer.timer);
        }
      }
      batchBuffers.clear();

      logger?.info?.("BlueprintSocketRelay stopped");
    },
  };
}
