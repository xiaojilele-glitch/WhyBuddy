import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AutopilotDestinationGoalCard,
  buildAutopilotDestinationGoalEvidenceEvent,
  buildAutopilotDestinationGoalViewModel,
  type AutopilotDestinationGoalCardInput,
} from "../AutopilotDestinationGoalCard";

function makeDestination(
  overrides: Partial<AutopilotDestinationGoalCardInput> = {}
): AutopilotDestinationGoalCardInput {
  return {
    id: "destination-release",
    goal: "Ship the governed release brief",
    request:
      "Prepare the release brief with owner, rollback path, and evidence links.",
    subGoals: ["Summarize launch scope", "Confirm approval gates"],
    constraints: ["Use internal evidence only", "Keep customer names redacted"],
    successCriteria: ["Release owner can approve without follow-up"],
    deliverables: ["release-brief.md"],
    fieldSources: [
      {
        field: "goal",
        source: "user",
        confidence: "high",
      },
      {
        field: "constraints",
        source: "parser",
        label: "Destination parser",
        confidence: "medium",
      },
    ],
    confirmedAt: "2026-04-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildAutopilotDestinationGoalViewModel", () => {
  it("locks confirmed destinations and summarizes field sources", () => {
    const model = buildAutopilotDestinationGoalViewModel(
      makeDestination(),
      "en-US"
    );

    expect(model.lockState).toBe("locked");
    expect(model.lockLabel).toBe("Goal locked");
    expect(model.lockPrompt).toContain("destination is confirmed");
    expect(model.sourceSummary).toBe(
      "Sources: User input, Destination parser"
    );
    expect(model.subGoals).toEqual([
      "Summarize launch scope",
      "Confirm approval gates",
    ]);
  });

  it("marks missing information as needing reconfirmation", () => {
    const model = buildAutopilotDestinationGoalViewModel(
      makeDestination({
        confirmedAt: null,
        missingInfo: ["approval owner"],
      }),
      "en-US"
    );

    expect(model.lockState).toBe("needs-reconfirm");
    expect(model.lockLabel).toBe("Needs reconfirmation");
    expect(model.lockPrompt).toContain("need confirmation");
  });

  it("marks route-impacting destination changes as modified", () => {
    const model = buildAutopilotDestinationGoalViewModel(
      makeDestination({
        confirmedAt: null,
        routeImpact: {
          kind: "route-replan",
          summary: "New compliance constraint changes the safer route.",
          fromRouteId: "route-fast",
          toRouteId: "route-safe",
          affectedStageCount: 3,
          requiresConfirmation: true,
        },
      }),
      "en-US"
    );

    expect(model.lockState).toBe("modified");
    expect(model.routeImpactLabel).toBe("Route replan needed");
    expect(model.routeImpactPrompt).toContain("route-fast -> route-safe");
    expect(model.routeImpactPrompt).toContain("3 stage(s) affected");
  });

  it("keeps explicit locked state stable even when a route impact note is attached", () => {
    const model = buildAutopilotDestinationGoalViewModel(
      makeDestination({
        lockState: "locked",
        routeImpact: {
          kind: "route-confirmation",
          summary: "Route owner accepted the updated goal.",
          requiresConfirmation: false,
        },
      }),
      "en-US"
    );

    expect(model.lockState).toBe("locked");
    expect(model.lockLabel).toBe("Goal locked");
    expect(model.routeImpactLabel).toBe("Route confirmation needed");
    expect(model.routeImpactPrompt).toBe(
      "Route owner accepted the updated goal."
    );
  });

  it("builds a minimal evidence event for lock, modification, and reconfirmation", () => {
    const locked = buildAutopilotDestinationGoalEvidenceEvent(
      makeDestination(),
      "en-US"
    );
    const modified = buildAutopilotDestinationGoalEvidenceEvent(
      makeDestination({
        confirmedAt: null,
        modifiedAt: "2026-04-26T11:00:00.000Z",
        routeImpact: {
          kind: "route-replan",
          fromRouteId: "route-fast",
          toRouteId: "route-safe",
          affectedStageCount: 2,
        },
      }),
      "en-US"
    );
    const reconfirm = buildAutopilotDestinationGoalEvidenceEvent(
      makeDestination({
        confirmedAt: null,
        missingInfo: ["approval owner"],
      }),
      "en-US"
    );

    expect(locked).toMatchObject({
      eventType: "destination.locked",
      lockState: "locked",
      destinationId: "destination-release",
    });
    expect(modified).toMatchObject({
      eventType: "destination.modified",
      lockState: "modified",
      routeImpactKind: "route-replan",
      occurredAt: "2026-04-26T11:00:00.000Z",
    });
    expect(reconfirm).toMatchObject({
      eventType: "destination.reconfirm_requested",
      lockState: "needs-reconfirm",
    });
  });

  it("builds a route confirmation evidence event for a locked goal", () => {
    const event = buildAutopilotDestinationGoalEvidenceEvent(
      makeDestination({
        lockState: "locked",
        routeImpact: {
          kind: "route-confirmation",
          summary: "Selected route remains valid after goal lock.",
          requiresConfirmation: true,
        },
      }),
      "en-US"
    );

    expect(event).toMatchObject({
      eventType: "destination.locked",
      lockState: "locked",
      routeImpactKind: "route-confirmation",
    });
    expect(event.summary).toContain("Selected route remains valid");
  });
});

describe("AutopilotDestinationGoalCard", () => {
  it("renders a confirmed destination with source badges", () => {
    const markup = renderToStaticMarkup(
      <AutopilotDestinationGoalCard
        destination={makeDestination()}
        locale="en-US"
      />
    );

    expect(markup).toContain('data-testid="autopilot-destination-goal-card"');
    expect(markup).toContain('data-lock-state="locked"');
    expect(markup).toContain("Goal locked");
    expect(markup).toContain("Ship the governed release brief");
    expect(markup).toContain("Sources: User input, Destination parser");
    expect(markup).toContain("Goal · User input · High");
    expect(markup).toContain("Constraints · Destination parser · Medium");
  });

  it("renders modification and reconfirmation prompts", () => {
    const modifiedMarkup = renderToStaticMarkup(
      <AutopilotDestinationGoalCard
        destination={makeDestination({
          confirmedAt: null,
          lockState: "modified",
          modifiedBy: "operator@example.com",
        })}
        locale="en-US"
      />
    );
    const reconfirmMarkup = renderToStaticMarkup(
      <AutopilotDestinationGoalCard
        destination={makeDestination({
          confirmedAt: null,
          lockState: "needs-reconfirm",
        })}
        locale="en-US"
      />
    );

    expect(modifiedMarkup).toContain("Goal modified");
    expect(modifiedMarkup).toContain("review the route impact");
    expect(reconfirmMarkup).toContain("Needs reconfirmation");
    expect(reconfirmMarkup).toContain("need confirmation before locking");
  });

  it("renders route impact after a goal change", () => {
    const markup = renderToStaticMarkup(
      <AutopilotDestinationGoalCard
        destination={makeDestination({
          confirmedAt: null,
          routeImpact: {
            kind: "route-replan",
            summary: "New compliance constraint changes the safer route.",
            fromRouteId: "route-fast",
            toRouteId: "route-safe",
            affectedStageCount: 3,
            requiresConfirmation: true,
          },
        })}
        locale="en-US"
      />
    );

    expect(markup).toContain(
      'data-testid="autopilot-destination-route-impact"'
    );
    expect(markup).toContain("Route replan needed");
    expect(markup).toContain("New compliance constraint changes the safer route.");
    expect(markup).toContain("Route route-fast -&gt; route-safe");
    expect(markup).toContain("3 stage(s) affected");
    expect(markup).toContain(
      "Route reconfirmation is required before continuing."
    );
  });
});
