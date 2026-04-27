import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { useAppStore } from "@/lib/store";

import {
  AutopilotTakeoverControlPanel,
  localizeAutopilotTakeoverType,
} from "../AutopilotTakeoverControlPanel";

beforeEach(() => {
  useAppStore.getState().setLocale("en-US");
});

describe("AutopilotTakeoverControlPanel", () => {
  it("localizes takeover item types used by P1/P2 handoff lanes", () => {
    expect(localizeAutopilotTakeoverType("clarification")).toBe(
      "Clarification"
    );
    expect(localizeAutopilotTakeoverType("runtime-upgrade")).toBe(
      "Runtime upgrade"
    );
    expect(localizeAutopilotTakeoverType("decision")).toBe("Decision");
    expect(localizeAutopilotTakeoverType("review")).toBe("Review");
  });

  it("renders blocking current takeover items with evidence references", () => {
    const markup = renderToStaticMarkup(
      <AutopilotTakeoverControlPanel
        items={[
          {
            id: "budget-approval",
            lane: "current",
            type: "runtime-upgrade",
            status: "blocked",
            reason: "Budget exception needs operator approval.",
            recommendedAction: "Approve the extra analysis budget.",
            blocking: true,
            evidenceEventId: "evt-takeover-1",
            evidenceRefs: [
              { id: "audit-risk-7", label: "Risk audit" },
              "tool-call-3",
            ],
          },
        ]}
      />
    );

    expect(markup).toContain(
      'data-testid="autopilot-takeover-control-panel"'
    );
    expect(markup).toContain('data-testid="autopilot-takeover-lane-current"');
    expect(markup).toMatch(/Runtime upgrade|运行时升级/);
    expect(markup).toContain("Blocked");
    expect(markup).toMatch(/Blocking|阻塞/);
    expect(markup).toContain("Budget exception needs operator approval.");
    expect(markup).toContain("Approve the extra analysis budget.");
    expect(markup).toContain(
      'data-testid="autopilot-takeover-evidence-budget-approval"'
    );
    expect(markup).toContain("evt-takeover-1");
    expect(markup).toContain("Risk audit");
    expect(markup).toContain("tool-call-3");
  });

  it("renders resolved takeover items separately from current queue", () => {
    const markup = renderToStaticMarkup(
      <AutopilotTakeoverControlPanel
        items={[
          {
            id: "copy-review",
            lane: "resolved",
            type: "review",
            status: "resolved",
            reason: "Operator selected the concise executive tone.",
            recommendedAction: "Continue generation with approved tone.",
            blocking: false,
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-takeover-lane-resolved"');
    expect(markup).toMatch(/Resolved takeover|已完成接管/);
    expect(markup).toMatch(/Review|复核/);
    expect(markup).toContain("Resolved");
    expect(markup).toContain("Operator selected the concise executive tone.");
    expect(markup).toContain("Continue generation with approved tone.");
  });

  it("uses takeover terminology for DecisionPanel-owned decision items", () => {
    const markup = renderToStaticMarkup(
      <AutopilotTakeoverControlPanel
        items={[
          {
            id: "decision-publish-gate",
            lane: "current",
            type: "decision",
            status: "requested",
            reason: "DecisionPanel owns the waiting task submission.",
            recommendedAction:
              "Keep submission in DecisionPanel and show this read-only takeover queue item.",
            blocking: true,
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-takeover-lane-current"');
    expect(markup).toMatch(/Human takeover queue|人工接管队列/);
    expect(markup).toContain("Decision");
    expect(markup).toContain("DecisionPanel owns the waiting task submission.");
    expect(markup).toContain("Keep submission in DecisionPanel");
    expect(markup).not.toContain("human-in-the-loop");
  });
});
