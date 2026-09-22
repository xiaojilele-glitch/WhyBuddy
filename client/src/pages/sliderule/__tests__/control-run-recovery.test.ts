import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeControlStreamResponse,
  postControlTurnStream,
  resumeControlTurnStream,
} from "../../../lib/sliderule-marathon-driver";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { loadActiveRun, saveActiveRun } from "../active-run-store";

function stream(events: Record<string, unknown>[]) {
  return new Response(
    events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "X-Control-Run-Id": "ctr-1",
      },
    }
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("durable control stream", () => {
  it("uses one caller request identity and resumes with GET without replaying POST", async () => {
    const state = { sessionId: "session-1" } as V5SessionState;
    const fetcher = vi
      .fn()
      .mockImplementation(async () => stream([{ type: "complete", state }]));
    vi.stubGlobal("fetch", fetcher);
    const onControlRunId = vi.fn();
    await postControlTurnStream(state, "Continue", {
      controlRequestId: "request-1",
      onControlRunId,
    });
    expect(fetcher.mock.calls[0][1].headers["X-Control-Request-Id"]).toBe(
      "request-1"
    );
    expect(onControlRunId).toHaveBeenCalledWith("ctr-1");
    await resumeControlTurnStream("ctr-1");
    expect(fetcher.mock.calls[1][0]).toBe(
      "/api/sliderule/control-runs/ctr-1/stream"
    );
    expect(fetcher.mock.calls[1][1].method).toBeUndefined();
    expect(fetcher.mock.calls[1][1].body).toBeUndefined();
  });

  it("deduplicates persisted sequence numbers before applying tool results", async () => {
    const result = {
      type: "control_tool_result",
      tool: "project_create",
      ok: true,
      controlRunId: "ctr-1",
      seq: 1,
    };
    const onControlToolResult = vi.fn();
    const onControlRunId = vi.fn();
    const onRunId = vi.fn();
    await consumeControlStreamResponse(
      stream([
        { type: "control_run_started", controlRunId: "ctr-1" },
        result,
        result,
        {
          type: "complete",
          state: { sessionId: "session-1" },
          controlRunId: "ctr-1",
          seq: 2,
        },
      ]),
      { onControlToolResult, onControlRunId, onRunId }
    );
    expect(onControlToolResult).toHaveBeenCalledTimes(1);
    expect(onControlRunId).toHaveBeenCalledWith("ctr-1");
    expect(onRunId).not.toHaveBeenCalled();
  });

  it("treats an interrupted run as an error without inventing a completed state", async () => {
    const onRunSettled = vi.fn();
    const out = await consumeControlStreamResponse(
      stream([
        {
          type: "control_run_settled",
          status: "interrupted",
          error: "control_reconciliation_required",
        },
      ]),
      { onRunSettled }
    );
    expect(onRunSettled).toHaveBeenCalledWith("error");
    expect(out).toBeNull();
  });

  it("treats a settled provider stop as an error instead of a successful turn", async () => {
    const onRunSettled = vi.fn();
    const onControlText = vi.fn();
    const out = await consumeControlStreamResponse(
      stream([
        {
          type: "control_text",
          text: "模型服务返回内容过滤（content_filter），本轮已停止，未自动重试。",
          stopReason: "llm_unavailable",
          stoppedBy: "provider",
          providerFinishReason: "content_filter",
        },
        // The durable Python run is settled after persisting the provider
        // failure receipt.  Its status alone must not turn this into success.
        { type: "complete", state: { sessionId: "session-1" } },
        {
          type: "control_run_settled",
          status: "completed",
          controlRunId: "ctr-filtered",
        },
      ]),
      { onRunSettled, onControlText }
    );
    expect(onControlText).toHaveBeenCalledWith(
      expect.stringContaining("content_filter"),
      expect.objectContaining({ stopReason: "llm_unavailable" })
    );
    expect(onRunSettled).toHaveBeenCalledWith("error");
    expect(onRunSettled).not.toHaveBeenCalledWith("complete");
    expect(out).toBeNull();
  });

  it("retains the control kind across bookmark reloads", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      setItem: (key: string, value: string) => data.set(key, value),
      getItem: (key: string) => data.get(key) ?? null,
    });
    saveActiveRun("s1", {
      runId: "ctr-1",
      kind: "control",
      userText: "Continue",
      startedAt: "now",
    });
    expect(loadActiveRun("s1")?.kind).toBe("control");
    saveActiveRun("s2", {
      runId: "factory-1",
      userText: "Continue",
      startedAt: "now",
    });
    expect(loadActiveRun("s2")?.kind).toBeUndefined();
  });

  it.each(["post", "resume"] as const)("delivers the same public project projection on %s", async entry => {
    const state = { sessionId: "session-1" } as V5SessionState;
    const projection = { sessionId: "session-1", runtimeKind: "project", projectId: "project-1", projectRevision: "revision-1" };
    const fetcher = vi.fn(async () => stream([
      { type: "control_project_state", ...projection, internalCredential: "must be dropped" },
      { type: "complete", state },
    ]));
    vi.stubGlobal("fetch", fetcher);
    const onControlProjectState = vi.fn();
    if (entry === "post") await postControlTurnStream(state, "Continue", { onControlProjectState });
    else await resumeControlTurnStream("ctr-1", { onControlProjectState });
    expect(onControlProjectState).toHaveBeenCalledExactlyOnceWith(projection);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not overwrite the provider explanation with a generic failed-settled message", async () => {
    const onControlText = vi.fn();
    const onRunSettled = vi.fn();
    const text = "模型服务返回内容过滤（content_filter），本轮已停止，未自动重试。";
    await consumeControlStreamResponse(stream([
      { type: "control_text", text, stopReason: "llm_unavailable", stoppedBy: "provider" },
      { type: "control_run_settled", status: "failed", error: "llm_unavailable" },
    ]), { onControlText, onRunSettled });
    expect(onControlText).toHaveBeenCalledExactlyOnceWith(text, expect.objectContaining({ stopReason: "llm_unavailable" }));
    expect(onRunSettled).toHaveBeenCalledExactlyOnceWith("error");
  });

  it("reports a provider stop even when resuming from only the failed settled event", async () => {
    const onControlText = vi.fn();
    const onControlHostText = vi.fn();
    const onRunSettled = vi.fn();
    await consumeControlStreamResponse(stream([
      { type: "control_run_settled", status: "failed", error: "llm_unavailable" },
    ]), { onControlText, onControlHostText, onRunSettled });
    expect(onControlText).toHaveBeenCalledWith(expect.stringContaining("模型服务"), expect.objectContaining({ stopReason: "llm_unavailable" }));
    expect(onControlHostText).toHaveBeenCalledWith(expect.stringContaining("模型服务"));
    expect(onRunSettled).toHaveBeenCalledExactlyOnceWith("error");
  });

  it("preserves an unexpected control failure before complete instead of exiting as success", async () => {
    const onControlText = vi.fn();
    const onControlState = vi.fn();
    const onRunSettled = vi.fn();
    const text = "运行这一轮时出了问题，现有工程已保存。";
    const state = { sessionId: "session-1", runtimeKind: "project", projectRevision: "current-revision" };
    const result = await consumeControlStreamResponse(stream([
      { type: "control_text", text, stopReason: "unknown", stoppedBy: "unknown" },
      { type: "complete", state },
      { type: "control_run_settled", status: "failed", error: "unknown" },
    ]), { onControlText, onControlState, onRunSettled });
    expect(onControlText).toHaveBeenCalledExactlyOnceWith(text, expect.objectContaining({ stopReason: "unknown" }));
    expect(onControlState).toHaveBeenCalledExactlyOnceWith(state);
    expect(onRunSettled).toHaveBeenCalledExactlyOnceWith("error");
    expect(result).toBeNull();
  });

  it("does not settle on the first complete when the durable run continues", async () => {
    // 2026-09-14 入职系统：wall_clock 后第一发 complete 不是整轮终局。
    const tools: string[] = [];
    const continuations: number[] = [];
    const onRunSettled = vi.fn();
    const state = { sessionId: "session-1" };
    const result = await consumeControlStreamResponse(
      stream([
        { type: "control_run_started", controlRunId: "ctr-slice" },
        {
          type: "control_text",
          text: "本轮工程任务达到时间上限。",
          stopReason: "wall_clock",
          stoppedBy: "runtime",
          limit: 180,
          used: 181.5,
        },
        { type: "complete", state },
        {
          type: "control_continuation",
          attempt: 1,
          blockedReasons: ["project_verification_required"],
        },
        { type: "control_tool_start", tool: "project_patch", summary: "src/App.tsx" },
        { type: "control_run_settled", status: "completed", error: null },
      ]),
      {
        onRunSettled,
        onControlContinuation: event => continuations.push(event.attempt),
        onControlToolStart: tool => tools.push(tool),
      }
    );
    expect(continuations).toEqual([1]);
    expect(tools).toEqual(["project_patch"]);
    expect(onRunSettled).toHaveBeenCalledTimes(1);
    expect(onRunSettled).toHaveBeenCalledWith("complete");
    expect(result?.finalState).toEqual(state);
  });

  it("keeps a normal tool-round budget stop as a completed control turn", async () => {
    const onRunSettled = vi.fn();
    const state = { sessionId: "session-1" };
    const result = await consumeControlStreamResponse(stream([
      { type: "control_text", text: "本轮工具预算已用完。", stopReason: "tool_rounds", stoppedBy: "host" },
      { type: "complete", state },
      { type: "control_run_settled", status: "completed", error: null },
    ]), { onRunSettled });
    expect(onRunSettled).toHaveBeenCalledExactlyOnceWith("complete");
    expect(result?.finalState).toEqual(state);
  });

  it.each(["cancelled", "failed", "interrupted"])(
    "does not return a nested factory result when the control run is %s",
    async status => {
      const onRunSettled = vi.fn();
      const out = await consumeControlStreamResponse(stream([
        { type: "control_handoff_factory", runId: "factory-1" },
        { type: "factory_complete", state: { sessionId: "s1" }, stopReason: "completed" },
        { type: "control_run_settled", status },
      ]), { onRunSettled });
      expect(out).toBeNull();
      expect(onRunSettled).toHaveBeenLastCalledWith(status === "cancelled" ? "cancelled" : "error");
      expect(onRunSettled).not.toHaveBeenCalledWith("complete");
    }
  );

  it("cancels a discovered run when resume is stopped before any response", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException("Stopped", "AbortError");
    }).mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    expect(await resumeControlTurnStream("discovered-run", { stopSignal: controller.signal })).toBeNull();
    expect(fetcher.mock.calls[1][0]).toBe("/api/sliderule/control-runs/discovered-run");
    expect(fetcher.mock.calls[1][1].method).toBe("DELETE");
    expect(fetcher.mock.calls[1][1].signal).toBeUndefined();
  });

  it("keeps the discovered run alive after an ordinary resume network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetcher);
    expect(await resumeControlTurnStream("discovered-run")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops the submitted request even when abort precedes its first response header", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new DOMException("Stopped", "AbortError");
      })
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    await postControlTurnStream(
      { sessionId: "s1" } as V5SessionState,
      "Continue",
      {
        stopSignal: controller.signal,
        controlRequestId: "request-early-stop",
      }
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      "/api/sliderule/control-requests/request-early-stop?sessionId=s1"
    );
    expect(fetcher.mock.calls[1][1].method).toBe("DELETE");
    expect(fetcher.mock.calls[1][1].signal).toBeUndefined();
  });
});
