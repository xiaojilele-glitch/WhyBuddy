// @vitest-environment jsdom
/**
 * Exercise the workspace entry through the real hook and HTTP session store.
 * A successful POST is not enough: the shell must receive the same session's
 * authoritative project projection. In-flight creation may outlive navigation.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createHash, webcrypto } from "node:crypto";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSessionState } from "@/lib/sliderule-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { useSlideRuleSession } from "../useSlideRuleSession";

const authentication = vi.hoisted(() => ({
  ready: undefined as boolean | undefined,
  user: undefined as { id: string } | null | undefined,
}));
vi.mock("@/lib/use-auth", () => ({ useAuth: () => ({ refresh: vi.fn(), ...authentication }) }));
vi.mock("@/lib/sliderule-narrator", () => ({
  fetchNarration: async () => ({ text: "", source: "fallback" }),
}));
vi.mock("@/pages/agent-loop/dashboard/SidebarSessions", () => ({
  notifySessionsUpdated: vi.fn(),
}));

const SID = "project-entry-session";
const PLAN = { planId: "plan-entry", revision: 2, planContent: "# 任务应用\n新增、刷新与权限 🐈" };
const PROJECT = { projectId: "project-entry", sessionId: SID, currentRevision: "revision-entry" };
function approvedState(sid = SID): V5SessionState {
  return {
    ...createInitialSessionState("A project application", sid),
    runtimeKind: "html-prototype",
    controlTranscript: [
      { role: "assistant", kind: "plan_written", text: PLAN.planContent, ...PLAN },
      { role: "assistant", kind: "plan_approval", text: PLAN.planContent, reqId: "approval-entry", ...PLAN },
      { role: "user", kind: "plan_approved", text: "Approved", reqId: "approval-entry", ...PLAN },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

let current: ReturnType<typeof useSlideRuleSession>;
let root: Root;
let container: HTMLDivElement;
let saved: Map<string, V5SessionState>;
let posts: Array<{ sid: string; body: Record<string, unknown> }>;
let createResponse: (() => Promise<Response>) | undefined;
let reloadResponse: (() => Promise<Response>) | undefined;
let controlStream: ReadableStreamDefaultController<Uint8Array> | undefined;
let controlTurn: Promise<void> | undefined;
let latestControlResponse: (() => Promise<Response>) | undefined;
let resumeControlResponse: (() => Promise<Response>) | undefined;

function streamEvent(value: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
}

async function startControlTurn() {
  await act(async () => {
    controlTurn = current.sendMessage("Continue the approved project");
    await vi.waitFor(() => expect(controlStream).toBeDefined());
  });
}

async function finishControlTurn() {
  if (!controlStream) return;
  await act(async () => {
    controlStream!.enqueue(streamEvent({ type: "complete", state: saved.get(SID) }));
    controlStream!.close();
    controlStream = undefined;
    await controlTurn;
  });
}

function Harness({ sid }: { sid: string }) {
  current = useSlideRuleSession({ sessionId: sid });
  return <div data-testid="runtime" data-app-title={current.goal}>{current.sessionState.runtimeKind}</div>;
}

async function mount(sid = SID) {
  await act(async () => { root.render(<Harness sid={sid} />); });
  await expect.poll(() => current.sessionState.sessionId).toBe(sid);
  await expect.poll(() => current.sessionHydrated).toBe(true);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("ReadableStream", NodeReadableStream);
  localStorage.clear();
  authentication.ready = undefined;
  authentication.user = undefined;
  saved = new Map([[SID, approvedState()]]);
  posts = [];
  createResponse = undefined;
  reloadResponse = undefined;
  controlStream = undefined;
  controlTurn = undefined;
  latestControlResponse = undefined;
  resumeControlResponse = undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/control-runs/latest?")) {
      return latestControlResponse ? latestControlResponse() : Response.json({ run: null });
    }
    if (/\/control-runs\/[^/]+\/stream$/.test(url)) {
      if (!resumeControlResponse) throw new Error("Unexpected control resume");
      return resumeControlResponse();
    }
    if (url.endsWith("/control-turn-stream")) {
      return new Response(new ReadableStream({ start(controller) { controlStream = controller; } }));
    }
    const match = url.match(/\/sessions\/([^/?]+)(\/project)?$/);
    if (match) {
      const sid = decodeURIComponent(match[1]);
      if (!match[2] && init?.method === "PUT") {
        saved.set(sid, { ...JSON.parse(String(init.body)), controlTranscript: saved.get(sid)?.controlTranscript });
        return Response.json({ ok: true });
      }
      if (match[2] && init?.method === "POST") {
        posts.push({ sid, body: JSON.parse(String(init.body)) });
        if (createResponse) return createResponse();
        saved.set(sid, { ...saved.get(sid)!, runtimeKind: "project", projectId: PROJECT.projectId, projectRevision: PROJECT.currentRevision });
        return Response.json({ project: { ...PROJECT, sessionId: sid }, verification: "not_run" }, { status: 201 });
      }
      if (posts.some(post => post.sid === sid) && reloadResponse) return reloadResponse();
      return saved.has(sid)
        ? Response.json({ state: saved.get(sid), backend: "python" })
        : Response.json({ detail: "not_found" }, { status: 404 });
    }
    if (url.includes("/runs/active?")) return Response.json({ active: null });
    if (url.endsWith("/control-runs/latest")) return Response.json({ run: null });
    throw new Error(`Unexpected fetch: ${init?.method || "GET"} ${url}`);
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

describe("restoring the latest failed control run after refresh", () => {
  const failure = "模型服务返回内容过滤（content_filter），本轮已停止，未自动重试。";
  function configureLatest(status = "failed") {
    authentication.ready = true;
    authentication.user = { id: "owner-entry" };
    latestControlResponse = async () => Response.json({ run: {
      runId: "failed-entry", sessionId: SID, status, error: status === "failed" ? "llm_unavailable" : null,
    } });
    const state = saved.get(SID)!;
    state.controlTranscript!.push({ role: "assistant", kind: "canned", text: failure });
    resumeControlResponse = async () => new Response([
      { type: "control_run_started", controlRunId: "failed-entry" },
      { type: "control_text", text: failure, stopReason: "llm_unavailable", stoppedBy: "provider" },
      { type: "complete", state },
      { type: "control_run_settled", status: "failed", error: "llm_unavailable" },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
  }

  it("restores the server's failure without a local bookmark, a model POST or a session PUT", async () => {
    configureLatest();
    await mount();
    await act(async () => {
      await vi.waitFor(() => expect(current.uiTurns.at(-1)?.assistant).toContain(failure));
    });
    expect(current.isRunning).toBe(false);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.filter(([url]) => String(url).endsWith("/failed-entry/stream"))).toHaveLength(1);
    expect(calls.filter(([, init]) => init?.method === "PUT" || init?.method === "POST")).toHaveLength(0);
    expect(current.uiTurns.at(-1)?.user).toBe("");
  });

  it("failed run 的工程动作刷新后还在左栏——不许只回放失败说明", async () => {
    configureLatest();
    saved.get(SID)!.runtimeKind = "project";
    saved.get(SID)!.turnNarrations = [{
      turnId: "turn-1789462833327",
      user: "构建一个名为 TicketStream 的服务台 SaaS 界面",
      steps: [{ id: "s1", kind: "model_speech", text: "我先把工程搭起来。" }],
      durationMs: 127000,
    }];
    resumeControlResponse = async () => new Response([
      { type: "control_run_started", controlRunId: "failed-entry" },
      { type: "control_tool_start", tool: "project_create", summary: "react-vite-tasks" },
      { type: "control_tool_result", tool: "project_create", ok: true },
      { type: "control_tool_start", tool: "project_patch", summary: "src/index.html" },
      { type: "control_tool_result", tool: "project_patch", ok: true, path: "src/index.html" },
      { type: "control_text", text: failure, stopReason: "llm_unavailable", stoppedBy: "provider" },
      { type: "complete", state: saved.get(SID) },
      { type: "control_run_settled", status: "failed", error: "llm_unavailable" },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
    await mount();
    await act(async () => {
      await vi.waitFor(() => expect(current.uiTurns.at(-1)?.assistant).toContain(failure));
    });
    const chips = current.uiTurns.flatMap(turn =>
      (turn.steps || []).filter(step => step.kind === "chip")
    );
    expect(chips.map(step => step.capabilityId)).toEqual([
      "project_create",
      "project_create",
      "project_patch",
      "project_patch",
    ]);
    expect(current.uiTurns.some(turn => turn.user.includes("TicketStream"))).toBe(true);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  });

  it("keeps the persisted user conversation alongside the recovered failure", async () => {
    configureLatest();
    saved.get(SID)!.turnNarrations = [{
      turnId: "turn-1700000000000", user: "创建我的任务管理应用", steps: [], durationMs: 500,
    }];
    await mount();
    await act(async () => { await vi.waitFor(() => expect(current.uiTurns.at(-1)?.assistant).toContain(failure)); });
    expect(current.uiTurns.some(turn => turn.user === "创建我的任务管理应用")).toBe(true);
    expect(current.uiTurns.filter(turn => turn.id === "control-failure-failed-entry")).toHaveLength(1);
  });

  it.each(["completed", "waiting_user"])("does not revive an older failure when the latest run is %s", async status => {
    configureLatest(status);
    await mount();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/failed-entry/stream"))).toBe(false);
    // ⚠ 2026-09-15 改了钉法。原来写的是「failure 这句话整页不许出现」，
    //   而失败**本来就是会话历史的一部分**——它以 canned 行落在
    //   controlTranscript 里，`turnsFromControlTranscript` 把它当历史铺回来，
    //   这是「刷新不丢左栏」那一笔想要的。判据原意不是禁掉历史，是禁掉
    //   **把旧失败当成一条新通知翻出来**。那条通知有确切身份，就钉它。
    expect(current.uiTurns.filter(turn => turn.id === "control-failure-failed-entry")).toHaveLength(0);
  });

  it("keeps source revisions and the goal edited after the failed run while restoring only its explanation", async () => {
    configureLatest();
    const historical = { ...saved.get(SID)!, runtimeKind: "project", projectId: "saved-project", projectRevision: "old-revision" };
    saved.set(SID, { ...saved.get(SID)!, runtimeKind: "project", projectId: "saved-project", projectRevision: "edited-revision",
      goal: { ...saved.get(SID)!.goal, text: "Updated goal after the failed run" },
    });
    resumeControlResponse = async () => new Response([
      { type: "control_project_state", sessionId: SID, runtimeKind: "project", projectId: "saved-project", projectRevision: "old-revision" },
      { type: "control_text", text: failure, stopReason: "llm_unavailable", stoppedBy: "provider" },
      { type: "complete", state: historical },
      { type: "control_run_settled", status: "failed", error: "llm_unavailable" },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
    await mount();
    await act(async () => { await vi.waitFor(() => expect(current.uiTurns.at(-1)?.assistant).toContain(failure)); });
    expect(current.sessionState.projectRevision).toBe("edited-revision");
    expect(current.sessionState.goal.text).toBe("Updated goal after the failed run");
    expect(saved.get(SID)!.projectRevision).toBe("edited-revision");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  });

  it("restores an unknown control error using its exact explanation", async () => {
    configureLatest();
    const text = "运行这一轮时出了问题，现有工程已保存。";
    latestControlResponse = async () => Response.json({ run: { runId: "failed-entry", sessionId: SID, status: "failed", error: "unknown" } });
    resumeControlResponse = async () => new Response([
      { type: "control_text", text, stopReason: "unknown", stoppedBy: "unknown" },
      { type: "complete", state: saved.get(SID) },
      { type: "control_run_settled", status: "failed", error: "unknown" },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
    await mount();
    await act(async () => { await vi.waitFor(() => expect(current.uiTurns.at(-1)?.assistant).toBe(text)); });
    expect(current.uiTurns.at(-1)?.assistant).not.toContain("模型服务");
    expect(current.isRunning).toBe(false);
  });

  it("discards the old latest response when the user starts a new turn before it arrives", async () => {
    configureLatest();
    const delayed = deferred<Response>();
    latestControlResponse = () => delayed.promise;
    await mount();
    await startControlTurn();
    await act(async () => {
      delayed.resolve(Response.json({ run: { runId: "failed-entry", sessionId: SID, status: "failed", error: "llm_unavailable" } }));
    });
    await finishControlTurn();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/failed-entry/stream"))).toBe(false);
    // ⚠ 2026-09-15 改了钉法。原来写的是「failure 这句话整页不许出现」，
    //   而失败**本来就是会话历史的一部分**——它以 canned 行落在
    //   controlTranscript 里，`turnsFromControlTranscript` 把它当历史铺回来，
    //   这是「刷新不丢左栏」那一笔想要的。判据原意不是禁掉历史，是禁掉
    //   **把旧失败当成一条新通知翻出来**。那条通知有确切身份，就钉它。
    expect(current.uiTurns.filter(turn => turn.id === "control-failure-failed-entry")).toHaveLength(0);
  });

  it.each(["queued", "running", "waiting_continue", "waiting_operation"])(
    "resumes a live control run whose latest status is %s",
    async status => {
      authentication.ready = true;
      authentication.user = { id: "owner-entry" };
      latestControlResponse = async () => Response.json({
        run: { runId: "live-entry", sessionId: SID, status, error: null },
      });
      resumeControlResponse = async () => new Response(
        [
          { type: "control_run_started", controlRunId: "live-entry" },
          { type: "control_continuation", attempt: 1, blockedReasons: [] },
          { type: "complete", state: saved.get(SID) },
          { type: "control_run_settled", status: "completed", error: null },
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("")
      );
      await mount();
      await act(async () => {
        await vi.waitFor(() =>
          expect(
            vi.mocked(fetch).mock.calls.some(([url]) =>
              String(url).includes("/live-entry/stream")
            )
          ).toBe(true)
        );
      });
    }
  );

  it("ignores the old session's delayed failure and restores the newly selected session", async () => {
    configureLatest();
    const delayed = deferred<Response>();
    latestControlResponse = () => delayed.promise;
    await mount();
    const nextSid = "project-entry-next";
    saved.set(nextSid, approvedState(nextSid));
    latestControlResponse = async () => Response.json({ run: null });
    await mount(nextSid);
    await act(async () => {
      delayed.resolve(Response.json({ run: { runId: "failed-entry", sessionId: SID, status: "failed", error: "llm_unavailable" } }));
    });
    expect(current.sessionState.sessionId).toBe(nextSid);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith(`latest?sessionId=${nextSid}`))).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/failed-entry/stream"))).toBe(false);
  });
});

afterEach(async () => {
  await finishControlTurn();
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("project projection while the model's control stream is still running", () => {
  const projection = {
    type: "control_project_state", sessionId: SID, runtimeKind: "project",
    projectId: PROJECT.projectId, projectRevision: PROJECT.currentRevision,
  } as const;

  it.each(["approved", "cancelled"] as const)("keeps the original application title while a %s plan reply is running", async outcome => {
    const originalGoal = "创建一个真实任务管理应用，新增、编辑、筛选并刷新保留数据";
    const state = saved.get(SID)!;
    state.goal.text = "";
    state.awaitReason = "control_plan_approval";
    state.controlTranscript = [
      { role: "user", kind: "turn", text: originalGoal },
      { role: "user", kind: "user_answer", text: "管理员与只读用户" },
      ...state.controlTranscript!.slice(0, 2),
    ];
    await mount();
    expect(current.pendingPlanApproval?.reqId).toBe("approval-entry");
    const feedback = "请在现有计划中增加导出，不要改变任务应用的需求";
    await act(async () => {
      current.submitPlanApproval({ reqId: "approval-entry", outcome, ...(outcome === "cancelled" ? { feedback } : {}) });
      await vi.waitFor(() => expect(controlStream).toBeDefined());
    });
    const command = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/control-turn-stream"))!;
    expect(JSON.parse(String(command[1]?.body))).toMatchObject({
      userText: outcome === "approved" ? "批准计划并执行" : feedback,
      toolAnswer: { kind: "plan_approval", reqId: "approval-entry", outcome },
    });
    // The backend has confirmed its goal, but only the project reference has
    // streamed to React. Do not invent/persist a goal to repair a display label.
    const putsBeforeProject = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT").length;
    saved.set(SID, { ...state, goal: { ...state.goal, text: originalGoal } });
    await act(async () => controlStream!.enqueue(streamEvent(projection)));
    expect(current.isRunning).toBe(true);
    expect(current.sessionState.goal.text).toBe("");
    expect(current.goal).toBe(originalGoal);
    expect(container.firstElementChild?.getAttribute("data-app-title")).toBe(originalGoal);
    expect(current.uiTurns.at(-1)?.user).toBe(outcome === "approved" ? "批准计划并执行" : feedback);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(putsBeforeProject);
    await finishControlTurn();
    await expect.poll(() => current.isRunning).toBe(false);
    expect(current.goal).toBe(originalGoal);
  });

  it("keeps a confirmed goal as the title during a new read-only control turn", async () => {
    saved.get(SID)!.goal.text = "原始任务应用目标";
    await mount();
    await startControlTurn();
    expect(current.isRunning).toBe(true);
    expect(current.goal).toBe("原始任务应用目标");
    expect(current.uiTurns.at(-1)?.user).toBe("Continue the approved project");
  });

  it("switches the shell from the persisted project event without waiting for complete or making another GET", async () => {
    await mount();
    await startControlTurn();
    const requestsBefore = vi.mocked(fetch).mock.calls.length;
    const oldGoal = current.sessionState.goal;
    await act(async () => {
      controlStream!.enqueue(streamEvent({ ...projection, goal: { text: "must not replace the conversation" } }));
    });
    expect(current.isRunning).toBe(true);
    expect(current.sessionState).toMatchObject({ runtimeKind: "project", projectId: PROJECT.projectId, projectRevision: PROJECT.currentRevision });
    expect(current.sessionState.goal).toEqual(oldGoal);
    expect(container.textContent).toBe("project");
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requestsBefore);
  });

  it.each([
    { sessionId: "different-session" },
    { projectRevision: null },
    { projectId: "" },
    { runtimeKind: "html-prototype" },
  ])("ignores an invalid or unrelated project event: %s", async invalid => {
    await mount();
    await startControlTurn();
    await act(async () => { controlStream!.enqueue(streamEvent({ ...projection, ...invalid })); });
    expect(current.isRunning).toBe(true);
    expect(current.sessionState.runtimeKind).toBe("html-prototype");
    expect(current.sessionState.projectId).toBeUndefined();
  });

  it("updates project revisions from the ordered stream and ignores replayed older events", async () => {
    await mount();
    await startControlTurn();
    await act(async () => {
      controlStream!.enqueue(streamEvent({ ...projection, controlRunId: "stream-run", seq: 10 }));
      controlStream!.enqueue(streamEvent({ ...projection, controlRunId: "stream-run", seq: 11, projectRevision: "patched-revision" }));
      controlStream!.enqueue(streamEvent({ ...projection, controlRunId: "stream-run", seq: 10 }));
    });
    expect(current.sessionState.projectRevision).toBe("patched-revision");
    expect(current.isRunning).toBe(true);
  });

  it("keeps the project and exact provider failure when the same model turn fails later", async () => {
    await mount();
    await startControlTurn();
    const failure = "模型服务返回内容过滤（content_filter），本轮已停止，未自动重试。";
    await act(async () => {
      controlStream!.enqueue(streamEvent(projection));
      controlStream!.enqueue(streamEvent({ type: "control_text", text: failure,
        stopReason: "llm_unavailable", stoppedBy: "provider", providerFinishReason: "content_filter" }));
      controlStream!.enqueue(streamEvent({ type: "control_run_settled", status: "failed", error: "llm_unavailable" }));
      controlStream!.close();
      controlStream = undefined;
      await controlTurn;
    });
    expect(current.isRunning).toBe(false);
    expect(current.sessionState.runtimeKind).toBe("project");
    expect(current.sessionState.projectId).toBe(PROJECT.projectId);
    expect(current.uiTurns.at(-1)?.assistant).toContain(failure);
    expect(current.uiTurns.at(-1)?.assistant).not.toContain("控制面未返回结果");
    expect(JSON.stringify(current.sessionState.turnNarrations)).toContain("content_filter");
    expect(current.driveFullStatus).toBe("control_failed");
    expect(JSON.stringify(current.sessionState.turnNarrations)).not.toContain("已降级显示");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/drive-full"))).toBe(false);
  });

  it.each([true, false])("does not PUT the stale pre-run goal after provider failure (complete snapshot: %s)", async hasComplete => {
    saved.get(SID)!.goal.text = "";
    await mount();
    await startControlTurn();
    const requestsBefore = vi.mocked(fetch).mock.calls.length;
    const authoritative = { ...saved.get(SID)!, ...projection,
      goal: { ...saved.get(SID)!.goal, text: "A task application approved on the server" },
    };
    saved.set(SID, authoritative);
    await act(async () => {
      controlStream!.enqueue(streamEvent(projection));
      controlStream!.enqueue(streamEvent({ type: "control_text", text: "模型服务返回内容过滤（content_filter）。",
        stopReason: "llm_unavailable", stoppedBy: "provider" }));
      if (hasComplete) controlStream!.enqueue(streamEvent({ type: "complete", state: authoritative }));
      controlStream!.enqueue(streamEvent({ type: "control_run_settled", status: "failed", error: "llm_unavailable" }));
      controlStream!.close();
      controlStream = undefined;
      await controlTurn;
    });
    const puts = vi.mocked(fetch).mock.calls.slice(requestsBefore).filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(0);
    expect(saved.get(SID)!.goal.text).toBe(authoritative.goal.text);
    expect(saved.get(SID)!.controlTranscript!.at(-1)?.kind).toBe("plan_approved");
    expect(current.sessionState.runtimeKind).toBe("project");
    if (hasComplete) expect(current.sessionState.goal.text).toBe(authoritative.goal.text);
    expect(current.uiTurns.at(-1)?.assistant).toContain("content_filter");
  });
});

describe("approved project entry through the session hook", () => {
  it("sends the exact UTF-8 plan reference and renders the authoritative project after reload", async () => {
    await mount();
    expect(current.canCreateProject).toBe(true);
    let result: boolean | undefined;
    await act(async () => { result = await current.createProjectFromApprovedPlan(); });
    expect(result).toBe(true);
    expect(posts).toEqual([{ sid: SID, body: {
      approvalRef: `${PLAN.planId}:${PLAN.revision}:${createHash("sha256").update(PLAN.planContent, "utf8").digest("hex")}`,
      templateId: "react-vite-tasks",
    } }]);
    expect(current.sessionState).toMatchObject({ sessionId: SID, runtimeKind: "project", projectId: PROJECT.projectId, projectRevision: PROJECT.currentRevision });
    expect(container.textContent).toBe("project");
    expect(current.canCreateProject).toBe(false);
  });

  it("办公文件计划 POST react-vite，不再默认任务清单", async () => {
    const office = approvedState();
    office.controlTranscript = office.controlTranscript!.map(row =>
      row.kind === "plan_written" ? { ...row, deliverableKind: "office-file" } : row
    );
    saved.set(SID, office);
    await mount();
    await act(async () => { await current.createProjectFromApprovedPlan(); });
    expect(posts[0]?.body.templateId).toBe("react-vite");
  });

  it.each([
    ["no request", (state: V5SessionState) => { state.controlTranscript!.splice(1, 1); }],
    ["mismatched request", (state: V5SessionState) => { state.controlTranscript![2].reqId = "different"; }],
    ["mismatched document", (state: V5SessionState) => { state.controlTranscript![2].planContent = "different"; }],
    ["new revision", (state: V5SessionState) => { state.controlTranscript!.push({ ...state.controlTranscript![0], revision: 3 }); }],
    ["cancelled plan", (state: V5SessionState) => { state.controlTranscript!.push({ role: "user", kind: "plan_cancelled", text: "Cancel" }); }],
    ["blank plan", (state: V5SessionState) => { state.controlTranscript!.forEach(row => { row.planContent = "  \n"; }); }],
    ["fractional revision", (state: V5SessionState) => { state.controlTranscript!.forEach(row => { row.revision = 1.5; }); }],
  ] as const)("refuses %s before making a project request", async (_name, invalidate) => {
    invalidate(saved.get(SID)!);
    await mount();
    expect(current.canCreateProject).toBe(false);
    await act(async () => { expect(await current.createProjectFromApprovedPlan()).toBe(false); });
    expect(posts).toHaveLength(0);
    expect(current.projectCreateState.status).toBe("error");
  });

  it("does not offer direct creation for a session that already owns generated HTML", async () => {
    Object.assign(saved.get(SID)!, { specFirstPages: { pages: [{ pageId: "existing", html: "<h1>Saved application</h1>" }] } });
    await mount();
    expect(current.canCreateProject).toBe(false);
    await act(async () => { expect(await current.createProjectFromApprovedPlan()).toBe(false); });
    expect(posts).toHaveLength(0);
    expect(current.projectCreateState.error).toContain("已有 HTML");
  });

  it("coalesces two calls made before React renders or the plan digest finishes", async () => {
    await mount();
    let results!: boolean[];
    await act(async () => {
      results = await Promise.all([current.createProjectFromApprovedPlan(), current.createProjectFromApprovedPlan()]);
    });
    expect(posts).toHaveLength(1);
    expect(results).toEqual([true, false]);
  });

  it.each(["html", "missing", "different-project", "no-revision"] as const)("does not report success when authoritative reload is %s", async shape => {
    reloadResponse = async () => {
      if (shape === "missing") return Response.json({}, { status: 404 });
      const state = { ...saved.get(SID)! };
      if (shape === "html") state.runtimeKind = "html-prototype";
      if (shape === "different-project") state.projectId = "other-project";
      if (shape === "no-revision") state.projectRevision = null;
      return Response.json({ state });
    };
    await mount();
    await act(async () => { expect(await current.createProjectFromApprovedPlan()).toBe(false); });
    expect(current.sessionState.runtimeKind).toBe("html-prototype");
    expect(current.projectCreateState.status).toBe("error");
    expect(current.projectCreateState.error).toContain("读取");
  });

  it("explains the server's explicit conversion conflict", async () => {
    createResponse = async () => Response.json({ detail: "project_conversion_required" }, { status: 409 });
    await mount();
    await act(async () => { expect(await current.createProjectFromApprovedPlan()).toBe(false); });
    expect(current.projectCreateState.error).toContain("已有 HTML");
    expect(current.sessionState.runtimeKind).toBe("html-prototype");
  });

  it("releases its lock after a rejected create request so the user can retry", async () => {
    createResponse = async () => Response.json({ detail: "project_plan_approval_required" }, { status: 403 });
    await mount();
    await act(async () => { expect(await current.createProjectFromApprovedPlan()).toBe(false); });
    expect(current.projectCreateState.error).toContain("授权已失效");
    createResponse = undefined;
    await act(async () => { expect(await current.createProjectFromApprovedPlan()).toBe(true); });
    expect(posts).toHaveLength(2);
    expect(current.projectCreateState).toEqual({ status: "idle", error: null });
  });

  it("does not send a request when navigation happens during the plan digest", async () => {
    const digest = deferred<ArrayBuffer>();
    vi.spyOn(webcrypto.subtle, "digest").mockImplementationOnce(() => digest.promise);
    await mount();
    let pending!: Promise<boolean>;
    await act(async () => { pending = current.createProjectFromApprovedPlan(); });
    const nextSid = "project-entry-next";
    saved.set(nextSid, approvedState(nextSid));
    await mount(nextSid);
    await act(async () => {
      digest.resolve(new Uint8Array(32).buffer);
      expect(await pending).toBe(false);
    });
    expect(posts).toHaveLength(0);
    expect(current.sessionState.sessionId).toBe(nextSid);
  });

  it("does not overwrite the next session when a successful create's reload finishes late", async () => {
    const reload = deferred<Response>();
    const readStarted = vi.fn();
    reloadResponse = () => { readStarted(); return reload.promise; };
    await mount();
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = current.createProjectFromApprovedPlan();
      await vi.waitFor(() => expect(readStarted).toHaveBeenCalledOnce());
    });
    const nextSid = "project-entry-next";
    saved.set(nextSid, approvedState(nextSid));
    await mount(nextSid);
    await act(async () => {
      reload.resolve(Response.json({ state: saved.get(SID) }));
      expect(await pending).toBe(false);
    });
    expect(current.sessionState.sessionId).toBe(nextSid);
    expect(current.projectCreateState).toEqual({ status: "idle", error: null });
  });

  it.each(["success", "failure"] as const)("does not apply an old session's %s after navigation", async result => {
    const response = deferred<Response>();
    createResponse = () => response.promise;
    await mount();
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = current.createProjectFromApprovedPlan();
      await vi.waitFor(() => expect(posts).toHaveLength(1));
    });
    const nextSid = "project-entry-next";
    saved.set(nextSid, approvedState(nextSid));
    await mount(nextSid);
    expect(current.projectCreateState.status).toBe("idle");
    saved.set(SID, { ...saved.get(SID)!, runtimeKind: "project", projectId: PROJECT.projectId, projectRevision: PROJECT.currentRevision });
    await act(async () => {
      response.resolve(result === "success"
        ? Response.json({ project: PROJECT }, { status: 201 })
        : Response.json({ detail: "project_rollout_disabled" }, { status: 403 }));
      expect(await pending).toBe(false);
    });
    expect(current.sessionState.sessionId).toBe(nextSid);
    expect(current.sessionState.runtimeKind).toBe("html-prototype");
    expect(current.projectCreateState).toEqual({ status: "idle", error: null });
  });

  it("handles digest errors without leaking a rejected click promise", async () => {
    vi.spyOn(webcrypto.subtle, "digest").mockRejectedValueOnce(new Error("digest unavailable"));
    await mount();
    await act(async () => { expect(await current.createProjectFromApprovedPlan()).toBe(false); });
    expect(posts).toHaveLength(0);
    expect(current.projectCreateState.status).toBe("error");
  });
});
