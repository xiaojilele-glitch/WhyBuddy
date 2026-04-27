import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AutopilotCockpitLayout } from "../AutopilotCockpitLayout";

describe("AutopilotCockpitLayout", () => {
  it("renders the three cockpit columns and their core section titles", () => {
    const markup = renderToStaticMarkup(
      <AutopilotCockpitLayout
        destination={<div>Destination goal card</div>}
        route={<div>Route planner card</div>}
        liveDrive={<div>Live drive stage</div>}
        decision={<div>Decision handoff</div>}
        takeover={<div>Takeover queue</div>}
        evidence={<div>Evidence trail</div>}
        costRisk={<div>Cost risk forecast</div>}
      />
    );

    expect(markup).toContain('data-testid="autopilot-cockpit-layout"');
    expect(markup).toContain('data-testid="autopilot-cockpit-left"');
    expect(markup).toContain('data-testid="autopilot-cockpit-center"');
    expect(markup).toContain('data-testid="autopilot-cockpit-right"');
    expect(markup).toContain("Destination &amp; Route");
    expect(markup).toContain("Live Drive");
    expect(markup).toContain("Takeover &amp; Evidence");
    expect(markup).toContain("Destination goal card");
    expect(markup).toContain("Route planner card");
    expect(markup).toContain("Live drive stage");
    expect(markup).toContain("Decision handoff");
    expect(markup).toContain("Takeover queue");
    expect(markup).toContain("Evidence trail");
    expect(markup).toContain("Cost risk forecast");
  });

  it("keeps a mobile fallback marker and stacked-first responsive grid classes", () => {
    const markup = renderToStaticMarkup(<AutopilotCockpitLayout />);

    expect(markup).toContain(
      'data-layout-mode="desktop-three-column tablet-two-column stacked-mobile segmented-mobile"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-cockpit-mobile-fallback"'
    );
    expect(markup).toContain(
      'data-overflow-guard="mobile-status-chip-wrap"'
    );
    expect(markup).toContain("max-w-full");
    expect(markup).toContain("whitespace-normal");
    expect(markup).toContain("break-words");
    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain("md:grid-cols-2");
    expect(markup).toContain("lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.35fr)_minmax(0,0.95fr)]");
    expect(markup).toContain('data-tablet-layout="two-column-center-priority"');
    expect(markup).toContain("Stacked");
    expect(markup).toContain("Tabs-ready");
  });

  it("adds mobile segmented navigation semantics for route, drive, takeover, and evidence", () => {
    const markup = renderToStaticMarkup(<AutopilotCockpitLayout />);

    expect(markup).toContain('data-testid="autopilot-cockpit-segment-nav"');
    expect(markup).toContain(
      'data-overflow-guard="mobile-segment-chip-wrap"'
    );
    expect(markup).toContain('aria-label="Autopilot cockpit sections"');
    expect(markup).toContain('href="#autopilot-cockpit-route-title"');
    expect(markup).toContain('href="#autopilot-cockpit-center-title"');
    expect(markup).toContain('href="#autopilot-cockpit-takeover-title"');
    expect(markup).toContain('href="#autopilot-cockpit-evidence-title"');
    expect(markup).toContain(">Route</a>");
    expect(markup).toContain(">Drive</a>");
    expect(markup).toContain(">Takeover</a>");
    expect(markup).toContain(">Evidence</a>");
  });

  it("marks decision, takeover, evidence, and cost risk as right rail slots", () => {
    const markup = renderToStaticMarkup(
      <AutopilotCockpitLayout
        decision={<div>DecisionPanel handoff stays on the rail</div>}
        takeover={<div>Approval is blocking progress</div>}
        evidence={<div>Audit trail follows takeover</div>}
        costRisk={<div>Cost and risk summary follows evidence</div>}
      />
    );

    const rightRailIndex = markup.indexOf(
      'data-testid="autopilot-cockpit-right"'
    );
    const decisionIndex = markup.indexOf(
      'data-testid="autopilot-cockpit-decision"'
    );
    const takeoverIndex = markup.indexOf(
      'data-testid="autopilot-cockpit-takeover"'
    );
    const evidenceIndex = markup.indexOf(
      'data-testid="autopilot-cockpit-evidence"'
    );
    const costRiskIndex = markup.indexOf(
      'data-testid="autopilot-cockpit-cost-risk"'
    );

    expect(markup).toContain(
      'data-right-rail-slots="decision takeover evidence cost-risk"'
    );
    expect(markup).toContain("DecisionPanel handoff stays on the rail");
    expect(markup).toContain("Cost and risk summary follows evidence");
    expect(rightRailIndex).toBeGreaterThan(-1);
    expect(decisionIndex).toBeGreaterThan(rightRailIndex);
    expect(takeoverIndex).toBeGreaterThan(decisionIndex);
    expect(evidenceIndex).toBeGreaterThan(takeoverIndex);
    expect(costRiskIndex).toBeGreaterThan(evidenceIndex);
  });

  it("marks the right rail as blocking-takeover-first before evidence", () => {
    const markup = renderToStaticMarkup(
      <AutopilotCockpitLayout
        takeover={<div>Approval is blocking progress</div>}
        evidence={<div>Audit trail follows takeover</div>}
      />
    );

    const markerIndex = markup.indexOf(
      'data-testid="autopilot-cockpit-blocking-takeover-marker"'
    );
    const takeoverIndex = markup.indexOf(
      'data-testid="autopilot-cockpit-takeover"'
    );
    const evidenceIndex = markup.indexOf(
      'data-testid="autopilot-cockpit-evidence"'
    );

    expect(markup).toContain('data-priority="blocking-takeover-first"');
    expect(markup).toContain("Blocking takeover stays visible");
    expect(markerIndex).toBeGreaterThan(-1);
    expect(takeoverIndex).toBeGreaterThan(markerIndex);
    expect(evidenceIndex).toBeGreaterThan(takeoverIndex);
    expect(markup).toContain("Approval is blocking progress");
    expect(markup).toContain("Audit trail follows takeover");
  });

  it("renders empty placeholders for unwired cockpit panes", () => {
    const markup = renderToStaticMarkup(<AutopilotCockpitLayout />);

    expect(markup).toContain(
      "Destination will appear here when connected to task autopilot data."
    );
    expect(markup).toContain(
      "Route will appear here when connected to task autopilot data."
    );
    expect(markup).toContain(
      "Live Drive will appear here when connected to task autopilot data."
    );
    expect(markup).toContain(
      "Takeover will appear here when connected to task autopilot data."
    );
    expect(markup).toContain(
      "Evidence will appear here when connected to task autopilot data."
    );
  });
});
