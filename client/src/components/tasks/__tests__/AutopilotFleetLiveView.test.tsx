import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "@/lib/store";

import { AutopilotFleetLiveView } from "../AutopilotFleetLiveView";

beforeEach(() => {
  useAppStore.getState().setLocale("en-US");
});

describe("AutopilotFleetLiveView", () => {
  it("renders fleet role cards with role and status labels", () => {
    const markup = renderToStaticMarkup(
      <AutopilotFleetLiveView
        roles={[
          {
            id: "planner",
            role: "planner",
            status: "running",
            currentFocus: "Shape the route plan",
            boundAgents: ["agent-planner"],
          },
          {
            id: "clarifier",
            role: "clarifier",
            status: "waiting",
            currentFocus: "Wait for missing context",
            boundAgents: ["agent-clarifier"],
          },
          {
            id: "researcher",
            role: "researcher",
            status: "idle",
            boundAgents: [],
          },
          {
            id: "generator",
            role: "generator",
            status: "done",
            currentFocus: "Draft output complete",
            boundAgents: ["agent-generator"],
          },
          {
            id: "reviewer",
            role: "reviewer",
            status: "running",
            currentFocus: "Review generated packet",
            boundAgents: ["agent-reviewer"],
          },
          {
            id: "auditor",
            role: "auditor",
            status: "idle",
            boundAgents: [],
          },
          {
            id: "operator",
            role: "operator",
            status: "waiting",
            currentFocus: "Prepare handoff",
            boundAgents: ["agent-operator"],
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-fleet-live-view"');
    expect(markup).toContain('data-testid="fleet-lanes"');
    expect(markup).toContain("Fleet Live View");
    expect(markup).toContain("Planner");
    expect(markup).toContain("Clarifier");
    expect(markup).toContain("Researcher");
    expect(markup).toContain("Generator");
    expect(markup).toContain("Reviewer");
    expect(markup).toContain("Auditor");
    expect(markup).toContain("Operator");
    expect(markup).toContain("Running");
    expect(markup).toContain("Waiting");
    expect(markup).toContain("Done");
    expect(markup).toContain("Shape the route plan");
    expect(markup).toContain("1 Reviewer binding");
    expect(markup).toContain("No bound agents");
    expect(markup).not.toContain("agent-reviewer");
  });

  it("groups roles into parallel lanes while preserving custom lane labels", () => {
    const markup = renderToStaticMarkup(
      <AutopilotFleetLiveView
        roles={[
          {
            id: "planner",
            role: "planner",
            status: "running",
            currentFocus: "Prepare route",
          },
          {
            id: "researcher",
            role: "researcher",
            status: "running",
            laneId: "evidence",
            laneLabel: "Evidence lane",
            currentFocus: "Collect source notes",
          },
          {
            id: "generator",
            role: "generator",
            status: "waiting",
            laneId: "evidence",
            laneLabel: "Evidence lane",
            currentFocus: "Wait for research packet",
          },
          {
            id: "operator",
            role: "operator",
            status: "blocked",
            currentFocus: "Need approval",
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="fleet-lane-planning"');
    expect(markup).toContain('data-testid="fleet-lane-evidence"');
    expect(markup).toContain('data-testid="fleet-lane-governance"');
    expect(markup).toContain("Planning lane");
    expect(markup).toContain("Evidence lane");
    expect(markup).toContain("Governance lane");
    expect(markup).toContain("Collect source notes");
    expect(markup).toContain("Wait for research packet");
  });

  it("shows blocked role status, takeover anchor link, and blocked count", () => {
    const markup = renderToStaticMarkup(
      <AutopilotFleetLiveView
        takeoverAnchorId="takeover-panel"
        roles={[
          {
            id: "planner",
            role: "planner",
            status: "running",
            currentFocus: "Compare candidate routes",
            boundAgents: ["agent-planner"],
          },
          {
            id: "operator",
            role: "operator",
            status: "blocked",
            currentFocus: "Waiting for external approval",
            currentAction: "Hold external write",
            waitingReason: "Release owner has not approved the handoff.",
            latestArtifact: "approval-packet.md",
            boundAgents: ["operator-1", "operator-2"],
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="fleet-role-operator"');
    expect(markup).toContain('data-status="blocked"');
    expect(markup).toContain("Blocked: 1");
    expect(markup).toContain("Waiting for external approval");
    expect(markup).toContain("Current Action");
    expect(markup).toContain("Hold external write");
    expect(markup).toContain("Waiting Reason");
    expect(markup).toContain("Release owner has not approved the handoff.");
    expect(markup).toContain("Latest Artifact");
    expect(markup).toContain("approval-packet.md");
    expect(markup).toContain('href="#takeover-panel"');
    expect(markup).toContain('data-takeover-anchor="takeover-panel"');
    expect(markup).toContain("Open takeover");
    expect(markup).toContain("2 Operator bindings");
    expect(markup).not.toContain("operator-1");
    expect(markup).not.toContain("operator-2");
  });

  it("uses per-role takeover anchors when provided", () => {
    const markup = renderToStaticMarkup(
      <AutopilotFleetLiveView
        takeoverAnchorId="global-takeover"
        roles={[
          {
            id: "auditor",
            role: "auditor",
            status: "blocked",
            currentFocus: "Audit exception is pending",
            takeoverAnchorId: "audit-takeover",
          },
        ]}
      />
    );

    expect(markup).toContain('href="#audit-takeover"');
    expect(markup).toContain('data-takeover-anchor="audit-takeover"');
    expect(markup).not.toContain('href="#global-takeover"');
  });

  it("renders onOpenTakeover callback controls only for blocked roles", () => {
    const onOpenTakeover = vi.fn();
    const markup = renderToStaticMarkup(
      <AutopilotFleetLiveView
        onOpenTakeover={onOpenTakeover}
        roles={[
          {
            id: "planner",
            role: "planner",
            status: "running",
            currentFocus: "Planning route",
          },
          {
            id: "operator",
            role: "operator",
            status: "blocked",
            currentFocus: "Waiting for approval",
          },
        ]}
      />
    );

    expect(markup).toContain(
      'data-testid="fleet-role-operator-takeover-callback"'
    );
    expect(markup).not.toContain(
      'data-testid="fleet-role-planner-takeover-callback"'
    );
    expect(markup).toContain("Focus takeover");
    expect(onOpenTakeover).not.toHaveBeenCalled();
  });

  it("keeps role semantics stable when the app locale is zh", () => {
    useAppStore.getState().setLocale("zh-CN");

    const markup = renderToStaticMarkup(
      <AutopilotFleetLiveView
        roles={[
          {
            id: "auditor",
            role: "auditor",
            status: "blocked",
            currentFocus: "Waiting for audit evidence",
            boundAgents: ["audit-agent"],
          },
        ]}
      />
    );

    expect(markup).toContain("Fleet Live View");
    expect(markup).toContain("Auditor");
    expect(markup).toContain("Blocked");
    expect(markup).toContain("Blocked: 1");
    expect(markup).toContain("Waiting for audit evidence");
    expect(markup).toContain("1 Auditor binding");
    expect(markup).not.toContain("audit-agent");
  });
});
