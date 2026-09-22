/** Plan approval must cross the actual SSE and POST boundaries unchanged. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeControlStreamResponse,
  postControlTurnStream,
} from "../sliderule-marathon-driver";
import { CLOSED_TOOLS } from "../factory-hops";

const state = { sessionId: "plan-session", goal: { text: "A booking app" } } as never;
const plan = { reqId: "plan-v2", planContent: "# Plan\n\n1. Booking\n2. Availability" };
function sse(events: unknown[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("plan approval transport", () => {
  it("surfaces the exact persisted plan without igniting the factory", async () => {
    const onControlPlanApproval = vi.fn();
    const onRunId = vi.fn();
    const out = await consumeControlStreamResponse(sse([
      { type: "control_plan_approval", ...plan },
      { type: "complete", state },
    ]), { onControlPlanApproval, onRunId });
    expect(onControlPlanApproval).toHaveBeenCalledExactlyOnceWith(plan);
    expect(onRunId).not.toHaveBeenCalled();
    expect(out?.finalState).toEqual(state);
  });

  it.each([
    { reqId: "", planContent: "text" },
    { reqId: "plan-v2", planContent: "   " },
    { reqId: "plan-v2" },
  ])("does not offer approval for an incomplete plan: %j", async event => {
    const onControlPlanApproval = vi.fn();
    await consumeControlStreamResponse(sse([
      { type: "control_plan_approval", ...event },
      { type: "complete", state },
    ]), { onControlPlanApproval });
    expect(onControlPlanApproval).not.toHaveBeenCalled();
  });

  it.each(["approved", "cancelled", "abandoned"] as const)("posts %s as a typed receipt", async outcome => {
    const fetch = vi.fn(async () => sse([{ type: "complete", state }]));
    vi.stubGlobal("fetch", fetch);
    const toolAnswer = { kind: "plan_approval", reqId: plan.reqId, outcome,
      ...(outcome === "cancelled" ? { feedback: "Add conflict handling" } : {}) };
    await postControlTurnStream(state, "Plan decision", { toolAnswer });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.toolAnswer).toEqual(toolAnswer);
    expect(body).not.toHaveProperty("forcedTool");
    expect(body).not.toHaveProperty("planContent");
  });

  it("registers plan tools and removes the retired scope tool", () => {
    expect(CLOSED_TOOLS).toEqual(expect.arrayContaining([
      "enter_plan_mode", "write_plan", "exit_plan_mode",
    ]));
    expect(CLOSED_TOOLS).not.toContain("scope_card");
  });
});
