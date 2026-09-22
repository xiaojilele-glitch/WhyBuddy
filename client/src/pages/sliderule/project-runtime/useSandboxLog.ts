/**
 * 把沙箱命令行输出拉到前端，喂给滚动缓冲。
 *
 * ## 服务端早就有，缺的一直是这条管子（2026-09-14）
 *
 * `/api/sliderule/project-operations/{id}/events` 把 `runtime.log` 和
 * `runtime.console` 按白名单投影出来。`console` 是 PTY 原字节；`log` 是旧的
 * 进程文件尾巴。同一根管子，两种载荷。
 *
 * ## 2026-09-19：浏览器不许再轮询 afterSeq
 *
 * 上一版 200ms 打一次 `/events?afterSeq=`。命令在打字时网络面板像死循环，
 * 没字的时候也在空转。终端看起来像日志回放，因为每次都是「拉一页再拼」。
 *
 * 活路径改成 EventSource 订 `/events/stream`：有 `runtime.console` 才推一帧，
 * 没有就挂着等。重连带 `Last-Event-ID` / `afterSeq`，不许从头闪旧命令。
 *
 * ⚠ `hasMore` 追平是旧轮询的事。SSE 一次推一条，追历史也走同一根管子。
 */
import { useEffect, useRef, useState } from "react";
import {
  applyRuntimeLogPage,
  emptySandboxLog,
  type SandboxLogState,
} from "./sandbox-log-buffer";

const BASE = "/api/sliderule";
const RECONNECT_MS = 400;

function streamUrl(operationId: string, afterSeq: number): string {
  return (
    `${BASE}/project-operations/${encodeURIComponent(operationId)}` +
    `/events/stream?afterSeq=${afterSeq}`
  );
}

function applySseMessage(state: SandboxLogState, raw: string): {
  state: SandboxLogState;
  settled: boolean;
} {
  let event: { type?: string; seq?: number; payload?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return { state, settled: false };
  }
  if (!event || typeof event !== "object") return { state, settled: false };
  if (event.type === "runtime.settled") return { state, settled: true };
  return {
    state: applyRuntimeLogPage(state, {
      events: [event],
      nextSeq: typeof event.seq === "number" ? event.seq : undefined,
    }),
    settled: false,
  };
}

/**
 * 订阅一个 operation 的命令行输出。
 *
 * `operationId` 为空时返回空缓冲并且**不发请求**——没有在跑的操作就没有日志。
 */
export function useSandboxLog(operationId: string | null | undefined): SandboxLogState {
  const [state, setState] = useState<SandboxLogState>(emptySandboxLog);
  const ref = useRef<SandboxLogState>(state);
  ref.current = state;

  useEffect(() => {
    const id = String(operationId || "").trim();
    setState(emptySandboxLog());
    if (!id) return;
    ref.current = emptySandboxLog();
    return openSandboxEventStream(id, ref, setState);
  }, [operationId]);

  return state;
}

function openSandboxEventStream(
  operationId: string,
  ref: { current: SandboxLogState },
  setState: (state: SandboxLogState) => void
): () => void {
  let stopped = false;
  let socket: EventSource | null = null;
  let reconnectTimer: number | undefined;
  let generation = 0;

  const open = () => {
    if (stopped || typeof EventSource === "undefined") return;
    const mine = ++generation;
    socket?.close();
    const next = new EventSource(streamUrl(operationId, ref.current.seq), {
      withCredentials: true,
    });
    socket = next;
    next.onmessage = message => {
      if (stopped || mine !== generation) return;
      const applied = applySseMessage(ref.current, message.data);
      if (applied.settled) {
        generation += 1;
        next.close();
        return;
      }
      if (applied.state !== ref.current) {
        ref.current = applied.state;
        setState(applied.state);
      }
    };
    next.onerror = () => {
      next.close();
      if (stopped || mine !== generation) return;
      reconnectTimer = window.setTimeout(open, RECONNECT_MS);
    };
  };

  open();
  return () => {
    stopped = true;
    generation += 1;
    if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
    socket?.close();
  };
}

/**
 * 订一段会话里多条命令的沙箱 stdout。
 *
 * 每条 operation 一根 SSE。卸掉的 id 立刻关连接，不许继续占着。
 */
export function useSandboxLogs(
  operationIds: readonly string[],
  _opts: { hotIds?: readonly string[] } = {}
): Record<string, SandboxLogState> {
  const [state, setState] = useState<Record<string, SandboxLogState>>({});
  const ref = useRef(state);
  ref.current = state;
  const idsKey = operationIds.map(id => String(id || "").trim()).filter(Boolean).join("\0");

  useEffect(() => {
    const ids = idsKey ? idsKey.split("\0") : [];
    const initial: Record<string, SandboxLogState> = {};
    for (const id of ids) initial[id] = ref.current[id] || emptySandboxLog();
    ref.current = initial;
    setState(initial);
    if (ids.length === 0) return;

    const stoppers: Array<() => void> = [];
    for (const id of ids) {
      const bucket = {
        get current() {
          return ref.current[id] || emptySandboxLog();
        },
        set current(value: SandboxLogState) {
          ref.current = { ...ref.current, [id]: value };
        },
      };
      stoppers.push(
        openSandboxEventStream(id, bucket, nextState => {
          ref.current = { ...ref.current, [id]: nextState };
          setState(ref.current);
        })
      );
    }
    return () => {
      for (const stop of stoppers) stop();
    };
  }, [idsKey]);

  return state;
}
