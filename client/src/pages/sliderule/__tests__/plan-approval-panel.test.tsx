// @vitest-environment jsdom
/**
 * 计划卡：三个出口和 Markdown 正文。2026-09-15 卡面改抄 Cursor 文件卡，
 * 绿批准 / 粗「计划审批」标题栏不许回来。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanApprovalPanel } from "../PlanApprovalPanel";
import { ComposerDock, isComposerSendBlocked } from "../ComposerDock";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const plan = {
  reqId: "plan-panel-request",
  planContent:
    "# Project plan\n\n## Delivery\n1. First task\n2. Final task\n\n**Acceptance criteria**\n\n| Step | State |\n| --- | --- |\n| Verify | Pending |",
};
let container: HTMLDivElement;
let root: Root;
let submit: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  submit = vi.fn();
  await act(async () =>
    root.render(<PlanApprovalPanel plan={plan} onSubmit={submit} />)
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (name: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-testid="sliderule-plan-${name}"]`
  )!;

describe("plan approval", () => {
  it("renders the complete plan as Markdown, including its final task and table", () => {
    expect(container.querySelector("h1")?.textContent).toBe("Project plan");
    expect(container.querySelector("ol")?.textContent).toContain("Final task");
    expect(container.querySelector("strong")?.textContent).toBe(
      "Acceptance criteria"
    );
    expect(container.querySelector("table")?.textContent).toContain("Pending");
  });
  it("approves once and attaches the exact request ID", async () => {
    await act(async () => {
      button("approve").click();
      button("approve").click();
      button("abandon").click();
    });
    expect(submit.mock.calls).toEqual([
      [{ reqId: plan.reqId, outcome: "approved" }],
    ]);
    expect(button("approve").disabled).toBe(true);
  });
  it("opens a feedback draft and sends a revision without approving", async () => {
    await act(async () => button("revise").click());
    expect(submit).not.toHaveBeenCalled();
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )!.set!.call(textarea, "  Add a weekly review  ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("revise").click());
    expect(submit.mock.calls).toEqual([
      [
        {
          reqId: plan.reqId,
          outcome: "cancelled",
          feedback: "Add a weekly review",
        },
      ],
    ]);
  });
  it("abandons planning explicitly", async () => {
    await act(async () => button("abandon").click());
    expect(submit.mock.calls).toEqual([
      [{ reqId: plan.reqId, outcome: "abandoned" }],
    ]);
  });
  it("the composer shows approval and keeps revision typing available without legacy selectors", () => {
    const html = renderToStaticMarkup(
      <ComposerDock
        input="Revise delivery"
        setInput={() => {}}
        sendMessage={() => {}}
        isRunning={false}
        sessionId="plan-ui"
        goal="Plan"
        hero
        pendingPlanApproval={plan}
        onSubmitPlanApproval={submit}
      />
    );
    expect(html).toContain('data-testid="sliderule-plan-approval"');
    for (const retired of [
      "sliderule-scope",
      "sliderule-assumption",
      "sliderule-intake",
      "sliderule-composer-device",
      "sliderule-composer-archetype",
      "sliderule-composer-design-system",
    ])
      expect(html).not.toContain(retired);
    expect(
      isComposerSendBlocked({
        input: "Revise delivery",
        attachments: [],
        isRunning: false,
      })
    ).toBe(false);
    expect(
      isComposerSendBlocked({ input: "", attachments: [], isRunning: false })
    ).toBe(true);
  });

  it("卡面抄 Cursor 文件卡：近黑 Accept，不是绿审批表", () => {
    const html = renderToStaticMarkup(
      <PlanApprovalPanel plan={plan} onSubmit={() => {}} />
    );
    expect(html).toContain('data-plan-approval-surface="cursor"');
    expect(html).toContain("rounded-[12px]");
    expect(html).toContain("bg-[#171717]");
    expect(html).toContain("lucide-file-text");
    expect(html).toContain("计划");
    expect(html).not.toContain("bg-[#166534]");
    expect(html).not.toContain("shadow-lg");
    const src = stripComments(
      readFileSync(resolve(__dirname, "../PlanApprovalPanel.tsx"), "utf8")
    );
    expect(src).toContain('data-plan-approval-surface="cursor"');
    expect(src).toContain("bg-[#171717]");
    expect(src).not.toContain("#166534");
    expect(src).not.toContain("shadow-lg");
  });
});
