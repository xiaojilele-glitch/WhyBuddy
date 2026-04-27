import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { useAppStore } from "@/lib/store";

import { AutopilotDriveStateTimeline } from "../AutopilotDriveStateTimeline";

beforeEach(() => {
  useAppStore.getState().setLocale("en-US");
});

describe("AutopilotDriveStateTimeline", () => {
  it("renders localized main rail states and exception states", () => {
    const markup = renderToStaticMarkup(
      <AutopilotDriveStateTimeline
        currentState="executing"
        exceptionStates={["blocked", "replanning"]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-drive-state-timeline"');
    expect(markup).toMatch(/Understanding|理解中/);
    expect(markup).toMatch(/Clarifying|澄清中/);
    expect(markup).toMatch(/Planning|规划中/);
    expect(markup).toMatch(/Fleet Forming|车队编组/);
    expect(markup).toMatch(/Executing|执行中/);
    expect(markup).toMatch(/Reviewing|复核中/);
    expect(markup).toMatch(/Delivered|已交付/);
    expect(markup).toMatch(/Blocked|已阻塞/);
    expect(markup).toMatch(/Takeover Required|需要接管/);
    expect(markup).toMatch(/Replanning|重新规划/);
    expect(markup).toMatch(/Failed|执行失败/);
  });

  it("highlights the current main state", () => {
    const markup = renderToStaticMarkup(
      <AutopilotDriveStateTimeline
        currentState="reviewing"
        completedStates={[
          "understanding",
          "clarifying",
          "planning",
          "fleet-forming",
          "executing",
        ]}
        stateDetails={{
          reviewing: "Reviewer is checking the generated packet.",
        }}
      />
    );

    expect(markup).toContain('data-testid="drive-state-reviewing"');
    expect(markup).toContain('data-current="true"');
    expect(markup).toMatch(/Current: Reviewing|当前: 复核中/);
    expect(markup).toContain("Reviewer is checking the generated packet.");
  });

  it("renders next step, remaining steps, and a runtime replan banner", () => {
    const markup = renderToStaticMarkup(
      <AutopilotDriveStateTimeline
        currentState="replanning"
        nextStep="Compare candidate routes"
        remainingSteps={["Select safer route", "Resume execution"]}
        replan={{
          mode: "runtime_replanned",
          fromRoute: "route-fast",
          toRoute: "route-safe",
          reason: "Runtime detected approval risk.",
          triggeredBy: "runtime",
          impact: "Execution pauses until the safer route is accepted.",
        }}
      />
    );

    expect(markup).toContain('data-testid="drive-state-next-steps"');
    expect(markup).toMatch(/Next Step: Compare candidate routes|下一步: Compare candidate routes|涓嬩竴姝? Compare candidate routes/);
    expect(markup).toMatch(
      /Remaining Steps: Select safer route; Resume execution|剩余步骤: Select safer route; Resume execution|鍓╀綑姝ラ: Select safer route; Resume execution/
    );
    expect(markup).toContain('data-testid="drive-state-replan-banner"');
    expect(markup).toContain('data-replan-mode="runtime_replanned"');
    expect(markup).toMatch(/Runtime Replanned|运行时重规划|杩愯鏃堕噸瑙勫垝/);
    expect(markup).toContain("route-fast");
    expect(markup).toContain("route-safe");
    expect(markup).toContain("Runtime detected approval risk.");
    expect(markup).toContain("runtime");
    expect(markup).toContain("Execution pauses until the safer route is accepted.");
  });

  it("reserves display for system downgraded replans", () => {
    const markup = renderToStaticMarkup(
      <AutopilotDriveStateTimeline
        currentState="blocked"
        replan={{
          mode: "system_downgraded",
          fromRoute: "route-deep",
          toRoute: "route-standard",
          reason: "Deep verification exceeded runtime budget.",
          triggeredBy: "system",
          impact: "Lower-cost route keeps review moving.",
        }}
      />
    );

    expect(markup).toContain('data-replan-mode="system_downgraded"');
    expect(markup).toMatch(/System Downgraded|系统降级|绯荤粺闄嶇骇/);
    expect(markup).toContain("route-deep");
    expect(markup).toContain("route-standard");
    expect(markup).toContain("Deep verification exceeded runtime budget.");
    expect(markup).toContain("system");
    expect(markup).toContain("Lower-cost route keeps review moving.");
  });

  it("reserves display for user selected replans", () => {
    const markup = renderToStaticMarkup(
      <AutopilotDriveStateTimeline
        currentState="planning"
        replan={{
          mode: "user_selected",
          fromRoute: "route-auto",
          toRoute: "route-human-approved",
          reason: "Operator picked the human-approved path.",
          triggeredBy: "operator",
          impact: "Planner aligns remaining steps to the selected route.",
        }}
      />
    );

    expect(markup).toContain('data-replan-mode="user_selected"');
    expect(markup).toMatch(/User Selected|用户选择|鐢ㄦ埛閫夋嫨/);
    expect(markup).toContain("route-auto");
    expect(markup).toContain("route-human-approved");
    expect(markup).toContain("Operator picked the human-approved path.");
    expect(markup).toContain("operator");
    expect(markup).toContain(
      "Planner aligns remaining steps to the selected route."
    );
  });

  it("links replan banner to route evidence when evidence metadata is present", () => {
    const markup = renderToStaticMarkup(
      <AutopilotDriveStateTimeline
        currentState="replanning"
        replan={{
          mode: "runtime_replanned",
          fromRoute: "route-standard",
          toRoute: "route-safe",
          reason: "Evidence changed after operator review.",
          triggeredBy: "runtime",
          impact: "Route evidence is available for replay.",
          evidenceEventId: "evt-route-replanned-42",
          evidenceHref: "#evidence/evt-route-replanned-42",
          routeEvidenceLabel: "Route replanned evidence",
        }}
      />
    );

    expect(markup).toContain('data-testid="drive-state-replan-evidence"');
    expect(markup).toMatch(/Route Evidence|路线证据/);
    expect(markup).toContain("Route replanned evidence");
    expect(markup).toContain("evt-route-replanned-42");
    expect(markup).toContain('href="#evidence/evt-route-replanned-42"');
  });

  it("marks the timeline rails as mobile horizontal scroll regions", () => {
    const markup = renderToStaticMarkup(
      <AutopilotDriveStateTimeline
        currentState="executing"
        exceptionStates={["blocked"]}
      />
    );

    expect(markup).toContain('data-testid="drive-state-main-rail"');
    expect(markup).toContain('data-mobile-timeline="horizontal-scroll"');
    expect(markup).toContain('data-testid="drive-state-exception-rail"');
    expect(markup).toContain(
      'data-mobile-timeline="exception-horizontal-scroll"'
    );
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain("snap-x");
    expect(markup).toContain("min-w-[148px]");
    expect(markup).toContain("min-w-[168px]");
  });

  it("formats unknown drive state keys instead of rendering the raw token", () => {
    const markup = renderToStaticMarkup(
      <AutopilotDriveStateTimeline currentState="handoff_waiting" />
    );

    expect(markup).toContain("Handoff Waiting");
    expect(markup).not.toContain("handoff_waiting");
  });

  it("uses Chinese labels when the app locale is zh", () => {
    useAppStore.getState().setLocale("zh-CN");

    const markup = renderToStaticMarkup(
      <AutopilotDriveStateTimeline
        currentState="takeover-required"
        exceptionStates={["blocked"]}
      />
    );

    expect(markup).toContain("驾驶状态时间线");
    expect(markup).toContain("需要接管");
    expect(markup).toContain("已阻塞");
    expect(markup).toContain("重新规划");
    expect(markup).toContain("执行失败");
    expect(markup).toContain('data-testid="drive-exception-takeover-required"');
    expect(markup).toContain('data-current="true"');
  });
});
