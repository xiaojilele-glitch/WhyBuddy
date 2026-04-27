import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { useAppStore } from "@/lib/store";

import {
  AUTOPILOT_EVIDENCE_CATEGORIES,
  AUTOPILOT_EVIDENCE_EVENT_PREFIXES,
  AutopilotEvidenceRecorder,
  filterAutopilotEvidenceEvents,
  getAutopilotEvidenceCategory,
  getAutopilotEvidenceDetailDescription,
  getAutopilotEvidenceDetailTitle,
  isAutopilotEvidenceCategory,
  isAutopilotEvidenceEventPrefix,
  localizeAutopilotEvidenceEventType,
  sortAutopilotEvidenceEvents,
} from "../AutopilotEvidenceRecorder";

beforeEach(() => {
  useAppStore.getState().setLocale("en-US");
});

describe("AutopilotEvidenceRecorder", () => {
  it("keeps client category and event-prefix allow lists aligned", () => {
    expect(AUTOPILOT_EVIDENCE_CATEGORIES).toEqual([
      "route",
      "takeover",
      "fleet",
      "tool",
      "output",
      "audit",
    ]);
    expect(AUTOPILOT_EVIDENCE_EVENT_PREFIXES).toEqual(
      AUTOPILOT_EVIDENCE_CATEGORIES
    );
    expect(isAutopilotEvidenceCategory("route")).toBe(true);
    expect(isAutopilotEvidenceEventPrefix("takeover")).toBe(true);
    expect(isAutopilotEvidenceEventPrefix("artifact")).toBe(false);
    expect(
      getAutopilotEvidenceCategory({
        eventType: "artifact.created",
        category: "output",
      })
    ).toBe("output");
  });

  it("localizes known autopilot evidence event types", () => {
    expect(localizeAutopilotEvidenceEventType("route.recommended")).toBe(
      "Route recommended"
    );
    expect(localizeAutopilotEvidenceEventType("route.selected")).toBe(
      "Route selected"
    );
    expect(localizeAutopilotEvidenceEventType("route.locked")).toBe(
      "Route locked"
    );
    expect(localizeAutopilotEvidenceEventType("route.replanned")).toBe(
      "Route replanned"
    );
    expect(localizeAutopilotEvidenceEventType("takeover.requested")).toBe(
      "Takeover requested"
    );
    expect(localizeAutopilotEvidenceEventType("takeover.resolved")).toBe(
      "Takeover resolved"
    );
    expect(localizeAutopilotEvidenceEventType("fleet.assigned")).toBe(
      "Fleet assigned"
    );
    expect(localizeAutopilotEvidenceEventType("tool.called")).toBe(
      "Tool called"
    );
    expect(localizeAutopilotEvidenceEventType("output.generated")).toBe(
      "Output generated"
    );
    expect(localizeAutopilotEvidenceEventType("audit.recorded")).toBe(
      "Audit recorded"
    );
  });

  it("sorts evidence events by occurrence time before rendering", () => {
    const sorted = sortAutopilotEvidenceEvents([
      {
        id: "second",
        eventType: "tool.called",
        summary: "Search tool called.",
        occurredAt: "2026-04-26T10:02:00.000Z",
      },
      {
        id: "first",
        eventType: "route.selected",
        summary: "Stable route selected.",
        occurredAt: "2026-04-26T10:01:00.000Z",
      },
    ]);

    expect(sorted.map(event => event.id)).toEqual(["first", "second"]);
  });

  it("filters route takeover fleet tool output and audit evidence categories", () => {
    const events = [
      { id: "route", eventType: "route.selected", summary: "Route selected." },
      {
        id: "takeover",
        eventType: "takeover.requested",
        summary: "Takeover requested.",
      },
      { id: "fleet", eventType: "fleet.assigned", summary: "Fleet assigned." },
      { id: "tool", eventType: "tool.called", summary: "Tool called." },
      {
        id: "output",
        eventType: "artifact.created",
        category: "output",
        summary: "Output generated.",
      },
      { id: "audit", eventType: "audit.recorded", summary: "Audit recorded." },
    ];

    expect(getAutopilotEvidenceCategory(events[0])).toBe("route");
    expect(getAutopilotEvidenceCategory(events[4])).toBe("output");
    expect(filterAutopilotEvidenceEvents(events, "route").map(event => event.id))
      .toEqual(["route"]);
    expect(
      filterAutopilotEvidenceEvents(events, "takeover").map(event => event.id)
    ).toEqual(["takeover"]);
    expect(filterAutopilotEvidenceEvents(events, "fleet").map(event => event.id))
      .toEqual(["fleet"]);
    expect(filterAutopilotEvidenceEvents(events, "tool").map(event => event.id))
      .toEqual(["tool"]);
    expect(
      filterAutopilotEvidenceEvents(events, "output").map(event => event.id)
    ).toEqual(["output"]);
    expect(filterAutopilotEvidenceEvents(events, "audit").map(event => event.id))
      .toEqual(["audit"]);
  });

  it("renders event timeline details with drawer-ready payload", () => {
    const markup = renderToStaticMarkup(
      <AutopilotEvidenceRecorder
        initialDetailEventId="takeover"
        events={[
          {
            id: "output",
            eventType: "output.generated",
            trust: "verified",
            status: "completed",
            actor: "Generator",
            summary: "Draft report artifact generated.",
            occurredAt: "2026-04-26T10:04:00.000Z",
          },
          {
            id: "takeover",
            eventType: "takeover.requested",
            trust: "partial",
            status: "recorded",
            actor: "Autopilot",
            summary: "Operator approval requested for release handoff.",
            occurredAt: "2026-04-26T10:03:00.000Z",
            detail: {
              title: "Release approval packet",
              description: "Drawer can render this payload later.",
              attributes: {
                takeoverId: "takeover-release",
                blocking: true,
              },
              raw: {
                decisionId: "decision-release",
                recommendedAction: "approve",
              },
            },
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-evidence-recorder"');
    expect(markup).toContain('data-motion="evidence-timeline"');
    expect(markup).toContain('data-reduced-motion="evidence-timeline-static"');
    expect(markup).toContain('data-motion="evidence-timeline-append"');
    expect(markup).toContain('data-motion-index="0"');
    expect(markup).toContain('data-motion-index="1"');
    expect(markup).toContain('data-reduced-motion="evidence-event-static"');
    expect(markup).toContain("motion-reduce:transition-none");
    const takeoverIndex = Math.max(
      markup.indexOf("Takeover requested"),
      markup.indexOf("已请求接管")
    );
    const outputIndex = Math.max(
      markup.indexOf("Output generated"),
      markup.indexOf("输出已生成")
    );

    expect(takeoverIndex).toBeGreaterThanOrEqual(0);
    expect(outputIndex).toBeGreaterThanOrEqual(0);
    expect(takeoverIndex).toBeLessThan(outputIndex);
    expect(markup).toContain("Partial");
    expect(markup).toContain("Recorded");
    expect(markup).toContain("Autopilot");
    expect(markup).toContain("Operator approval requested for release handoff.");
    expect(markup).toContain('data-testid="autopilot-evidence-detail-takeover"');
    expect(markup).toMatch(/Drawer detail ready|详情已准备/);
    expect(markup).toContain("Release approval packet");
    expect(markup).toContain("Drawer can render this payload later.");
    expect(markup).toContain("TakeoverId");
    expect(markup).toContain("takeover-release");
    expect(markup).toContain('data-testid="autopilot-evidence-detail-drawer"');
    expect(markup).toMatch(/Evidence detail|证据详情/);
    expect(markup).toMatch(/Attributes|属性/);
    expect(markup).toMatch(/Raw record|原始记录/);
    expect(markup).toContain("decision-release");
    expect(markup).toContain("recommendedAction");
    expect(markup).toMatch(/Close|关闭/);
    expect(markup).toContain("Verified");
    expect(markup).toContain("Completed");
    expect(markup).toContain("Generator");
    expect(markup).toContain("Draft report artifact generated.");
  });

  it("applies categoryFilter in rendered evidence list", () => {
    const markup = renderToStaticMarkup(
      <AutopilotEvidenceRecorder
        categoryFilter="audit"
        events={[
          {
            id: "route",
            eventType: "route.selected",
            summary: "Stable route selected.",
          },
          {
            id: "audit",
            eventType: "audit.recorded",
            summary: "Audit record is ready.",
          },
        ]}
      />
    );

    expect(markup).toContain("Audit record is ready.");
    expect(markup).not.toContain("Stable route selected.");
  });

  it("falls back to summary type and status when detail payload is absent", () => {
    const event = {
      id: "route-lock",
      eventType: "route.locked",
      status: "recorded",
      trust: "verified",
      summary: "Route was locked after operator confirmation.",
      occurredAt: "2026-04-26T10:05:00.000Z",
    };
    const markup = renderToStaticMarkup(
      <AutopilotEvidenceRecorder
        initialDetailEventId="route-lock"
        events={[event]}
      />
    );

    expect(getAutopilotEvidenceDetailTitle(event)).toBe("Route locked");
    expect(getAutopilotEvidenceDetailDescription(event)).toBe(
      "Route was locked after operator confirmation."
    );
    expect(markup).toContain('data-testid="autopilot-evidence-detail-drawer"');
    expect(markup).toMatch(/Route locked|路线已锁定/);
    expect(markup).toContain("Route was locked after operator confirmation.");
    expect(markup).toContain("Recorded");
    expect(markup).toContain("Verified");
    expect(markup).toMatch(/Event ID|事件 ID/);
    expect(markup).toContain("route-lock");
    expect(markup).not.toContain("Raw record");
  });
});
