// @vitest-environment jsdom
/**
 * Exercise the real hook, HTTP session store, and control SSE consumer together.
 * A question can be answered before the previous stream releases its run lock.
 * The reply must survive that interval and must never attach to another prompt.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSessionState } from "@/lib/sliderule-runtime";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { useSlideRuleSession } from "../useSlideRuleSession";
import type { QuestionnaireOutcome } from "../QuestionnaireCard";

vi.mock("@/lib/use-auth", () => ({ useAuth: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/sliderule-narrator", () => ({
  fetchNarration: async () => ({ text: "", source: "fallback" }),
}));
vi.mock("@/pages/agent-loop/dashboard/SidebarSessions", () => ({
  notifySessionsUpdated: vi.fn(),
}));

const SID = "questionnaire-session-test";
const QUESTIONS = [
  {
    id: "audience",
    question: "Who uses the app?",
    multiSelect: true,
    options: [
      { label: "Managers", description: "Approve requests", preview: "Inbox" },
    ],
  },
  {
    id: "region",
    question: "Which region?",
    options: [{ label: "CN", description: "China region" }],
  },
];
const ASK = {
  type: "control_ask_user",
  question: QUESTIONS[0].question,
  options: ["Managers"],
  questions: QUESTIONS,
  reqId: "need-questionnaire",
};
const PLAN = {
  type: "control_plan_approval",
  reqId: "plan-one",
  planContent:
    "# Request tracker\n\n## Steps\n1. Collect requests\n2. Review requests",
};

function parkPlan(reqId = PLAN.reqId) {
  saved = {
    ...saved,
    awaitReason: "control_plan_approval",
    controlTranscript: [
      {
        role: "assistant",
        kind: "plan_approval",
        text: "Review the plan",
        reqId,
        planContent: PLAN.planContent,
      },
    ],
  };
}

let current: ReturnType<typeof useSlideRuleSession>;
let root: Root;
let container: HTMLDivElement;
let saved: V5SessionState;
let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
let posts: Array<Record<string, any>>;
let runningTurn: Promise<void> | undefined;
let approvalFailure: "before" | "after" | undefined;

function Harness() {
  current = useSlideRuleSession({ sessionId: SID });
  return null;
}

function event(value: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
}

function parkQuestion() {
  saved = {
    ...saved,
    awaitReason: "control_ask",
    awaitDetail: ASK.question,
    controlTranscript: [
      {
        role: "assistant",
        kind: "ask_user",
        text: ASK.question,
        options: ASK.options,
        questions: QUESTIONS,
        reqId: ASK.reqId,
      },
    ],
  };
}

async function mount() {
  await act(async () => {
    root.render(<Harness />);
  });
  await expect.poll(() => current.sessionHydrated).toBe(true);
}

async function startQuestion(queuedText?: string) {
  await act(async () => {
    runningTurn = current.sendMessage("Ask about the app");
    await vi.waitFor(() => expect(posts).toHaveLength(1));
  });
  if (queuedText) {
    await act(async () => {
      await current.sendMessage(queuedText);
    });
  }
  parkQuestion();
  await act(async () => {
    stream!.enqueue(event(ASK));
  });
  expect(current.isRunning).toBe(true);
  expect(current.pendingAsk?.questions).toEqual(QUESTIONS);
}

async function finishQuestion() {
  await act(async () => {
    stream!.enqueue(event({ type: "complete", state: saved }));
    stream!.close();
    stream = undefined;
    await runningTurn;
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ReadableStream", NodeReadableStream);
  localStorage.clear();
  saved = createInitialSessionState("Questionnaire app", SID);
  posts = [];
  runningTurn = undefined;
  approvalFailure = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/sessions/${SID}`)) {
        if (init?.method === "PUT") {
          saved = {
            ...JSON.parse(String(init.body)),
            controlTranscript: saved.controlTranscript,
            awaitReason: saved.awaitReason,
            awaitDetail: saved.awaitDetail,
          };
          return Response.json({ ok: true });
        }
        return Response.json({ state: saved, backend: "python" });
      }
      if (url.includes("/runs/active?")) return Response.json({ active: null });
      if (url.endsWith("/control-turn-stream")) {
        const body = JSON.parse(String(init?.body));
        posts.push(body);
        if (body.toolAnswer?.kind === "plan_approval" && approvalFailure) {
          const failure = approvalFailure;
          approvalFailure = undefined;
          if (failure === "after") {
            saved = { ...saved, awaitReason: undefined, awaitDetail: undefined };
          }
          return new Response("Temporarily unavailable", { status: 503 });
        }
        if (posts.length === 1 && body.userText === "Ask about the app") {
          return new Response(
            new ReadableStream({
              start(controller) {
                stream = controller;
              },
            })
          );
        }
        saved = { ...saved, awaitReason: undefined, awaitDetail: undefined };
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(event({ type: "complete", state: saved }));
              controller.close();
            },
          })
        );
      }
      throw new Error(`Unexpected fetch: ${init?.method || "GET"} ${url}`);
    })
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (stream) await finishQuestion();
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("questionnaire replies through the session hook", () => {
  it.each<QuestionnaireOutcome>([
    {
      outcome: "accepted",
      answers: { audience: ["Managers"], region: ["CN"] },
      notes: { audience: "Two teams" },
    },
    { outcome: "cancelled" },
    { outcome: "skip_interview", answers: { audience: ["Managers"] } },
  ])(
    "sends $outcome exactly once after the running stream completes",
    async result => {
      await mount();
      await startQuestion();
      await act(async () => {
        current.submitQuestionnaire(result);
      });
      expect(current.pendingAsk).toBeNull();
      expect(posts).toHaveLength(1);
      await finishQuestion();
      await expect.poll(() => posts.length).toBe(2);
      expect(posts[1].toolAnswer).toMatchObject({
        kind: "ask_user",
        reqId: ASK.reqId,
        ...result,
      });
      await expect.poll(() => current.isRunning).toBe(false);
      await act(async () => {
        await current.sendMessage("Unrelated follow-up");
      });
      expect(posts).toHaveLength(3);
      expect(posts[2]).not.toHaveProperty("toolAnswer");
    }
  );

  it("removing the queued reply also removes its structured answer", async () => {
    await mount();
    await startQuestion();
    await act(async () => {
      current.submitQuestionnaire({ outcome: "cancelled" });
    });
    expect(current.queuedTurns).toHaveLength(1);
    await act(async () => {
      current.removeQueuedTurn(0);
    });
    await finishQuestion();
    await expect.poll(() => current.isRunning).toBe(false);
    expect(posts).toHaveLength(1);
    await act(async () => {
      await current.sendMessage("A new answer");
    });
    expect(posts[1].toolAnswer).not.toHaveProperty("outcome");
    expect(posts[1].toolAnswer.text).toBe("A new answer");
  });

  it("answers the question before queued prompts without reusing the reply", async () => {
    await mount();
    await startQuestion("Add an export button");
    await act(async () => {
      current.submitQuestionnaire({ outcome: "cancelled" });
      current.submitQuestionnaire({ outcome: "cancelled" });
    });
    expect(current.queuedTurns).toHaveLength(2);
    await finishQuestion();
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[1].toolAnswer).toMatchObject({
      reqId: ASK.reqId,
      outcome: "cancelled",
    });
    expect(posts[2].userText).toBe("Add an export button");
    expect(posts[2]).not.toHaveProperty("toolAnswer");
  });

  it.each(["ask_user", "ask_user_question"])("restores every question and option from persisted %s", async kind => {
    parkQuestion();
    saved.controlTranscript![0].kind = kind;
    await mount();
    expect(current.pendingAsk).toEqual({
      question: ASK.question,
      options: ASK.options,
      reqId: ASK.reqId,
      questions: QUESTIONS,
    });
  });

  it("submits a restored question immediately while idle", async () => {
    parkQuestion();
    await mount();
    await act(async () => {
      current.submitQuestionnaire({
        outcome: "accepted",
        answers: { audience: ["Managers"] },
        notes: {},
      });
      await vi.waitFor(() => expect(posts).toHaveLength(1));
    });
    expect(posts[0].toolAnswer).toMatchObject({
      reqId: ASK.reqId,
      outcome: "accepted",
      answers: { audience: ["Managers"] },
    });
    expect(current.queuedTurns).toEqual([]);
  });
});

describe("full plan approval through the session hook", () => {
  it("removing a queued approval restores the plan for another decision", async () => {
    await mount();
    await startQuestion();
    parkPlan();
    await act(async () => stream!.enqueue(event(PLAN)));
    await act(async () =>
      current.submitPlanApproval({ reqId: PLAN.reqId, outcome: "approved" })
    );
    await act(async () => current.removeQueuedTurn(0));
    expect(current.pendingPlanApproval).toEqual({
      reqId: PLAN.reqId,
      planContent: PLAN.planContent,
    });
    await finishQuestion();
    expect(posts).toHaveLength(1);
    await act(async () =>
      current.submitPlanApproval({ reqId: PLAN.reqId, outcome: "abandoned" })
    );
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1].toolAnswer).toMatchObject({
      reqId: PLAN.reqId,
      outcome: "abandoned",
    });
  });

  it.each(["approved", "cancelled", "abandoned"] as const)(
    "sends %s once after the active stream completes",
    async outcome => {
      await mount();
      await startQuestion();
      parkPlan();
      await act(async () => {
        stream!.enqueue(event(PLAN));
      });
      expect(current.pendingAsk).toBeNull();
      expect(current.pendingPlanApproval).toEqual({
        reqId: PLAN.reqId,
        planContent: PLAN.planContent,
      });
      await act(async () => {
        current.submitPlanApproval({
          reqId: PLAN.reqId,
          outcome,
          ...(outcome === "cancelled" ? { feedback: "Add export" } : {}),
        });
        current.submitPlanApproval({ reqId: PLAN.reqId, outcome });
        stream!.enqueue(event(PLAN));
      });
      expect(current.pendingPlanApproval).toBeNull();
      expect(current.queuedTurns).toHaveLength(1);
      expect(posts).toHaveLength(1);
      await finishQuestion();
      await expect.poll(() => posts.length).toBe(2);
      expect(posts[1].toolAnswer).toMatchObject({
        kind: "plan_approval",
        reqId: PLAN.reqId,
        outcome,
        ...(outcome === "cancelled" ? { feedback: "Add export" } : {}),
      });
      expect(posts[1]).not.toHaveProperty("forcedTool");
      await expect.poll(() => current.isRunning).toBe(false);
      await act(async () => {
        await current.sendMessage("A new request");
      });
      expect(posts[2]).not.toHaveProperty("toolAnswer");
    }
  );

  it("restores Markdown and rejects stale request IDs", async () => {
    parkPlan("plan-two");
    await mount();
    expect(current.pendingPlanApproval).toEqual({
      reqId: "plan-two",
      planContent: PLAN.planContent,
    });
    await act(async () => {
      current.submitPlanApproval({ reqId: "plan-one", outcome: "approved" });
    });
    expect(posts).toHaveLength(0);
    expect(current.pendingPlanApproval?.reqId).toBe("plan-two");
    await act(async () => {
      current.submitPlanApproval({ reqId: "plan-two", outcome: "approved" });
    });
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].toolAnswer).toMatchObject({
      kind: "plan_approval",
      reqId: "plan-two",
      outcome: "approved",
    });
  });

  it("restores an unaccepted plan after a failed POST and allows retry", async () => {
    parkPlan();
    await mount();
    approvalFailure = "before";
    await act(async () => {
      current.submitPlanApproval({ reqId: PLAN.reqId, outcome: "approved" });
    });
    await expect.poll(() => current.isRunning).toBe(false);
    await expect.poll(() => current.pendingPlanApproval?.reqId).toBe(PLAN.reqId);
    await act(async () => {
      current.submitPlanApproval({ reqId: PLAN.reqId, outcome: "approved" });
    });
    await expect.poll(() => posts.length).toBe(2);
    await expect.poll(() => current.isRunning).toBe(false);
    expect(current.pendingPlanApproval).toBeNull();
  });

  it("does not reopen approval when the server accepted it before the response failed", async () => {
    parkPlan();
    await mount();
    approvalFailure = "after";
    await act(async () => {
      current.submitPlanApproval({ reqId: PLAN.reqId, outcome: "approved" });
    });
    await expect.poll(() => posts.length).toBe(1);
    await expect.poll(() => current.isRunning).toBe(false);
    expect(current.pendingPlanApproval).toBeNull();
  });

  it.each(["Use a weekly review instead", "structure", "refine", "/精修"])(
    "normal typing %s requests changes, never approval or a forced tool",
    async feedback => {
      parkPlan();
      await mount();
      await act(async () => {
        await current.sendMessage(feedback);
      });
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0].toolAnswer).toMatchObject({
        kind: "plan_approval",
        reqId: PLAN.reqId,
        outcome: "cancelled",
        feedback,
      });
      expect(posts[0]).not.toHaveProperty("forcedTool");
    }
  );

  it("ignores replay of an older plan after a newer request replaced it", async () => {
    await mount();
    await startQuestion();
    await act(async () => {
      stream!.enqueue(event(PLAN));
      stream!.enqueue(event({ ...PLAN, reqId: "plan-two" }));
      stream!.enqueue(event(PLAN));
    });
    expect(current.pendingPlanApproval?.reqId).toBe("plan-two");
    expect(posts).toHaveLength(1);
  });

  it("does not reconstruct retired assumption or scope UI from persisted state", async () => {
    saved = {
      ...saved,
      awaitReason: "control_scope",
      awaitDetail: "Old scope",
      specFirstPages: {
        spec: { assumptions: [{ id: "a1", decision: "Use phone" }] },
      },
    } as V5SessionState;
    await mount();
    expect(current).not.toHaveProperty("pendingScope");
    expect(current).not.toHaveProperty("specAssumptions");
    expect(current.pendingAsk).toBeNull();
    expect(current.pendingPlanApproval).toBeNull();
  });
});
