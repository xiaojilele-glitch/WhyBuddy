import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let mockReasoningEntries: unknown[] = [];

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: unknown) => unknown) => {
    const snapshot = {
      agentReasoning: { entries: mockReasoningEntries },
      rolePhases: {} as Record<string, unknown>,
      agentProgress: {} as Record<string, unknown>,
      capabilityStatuses: [] as unknown[],
    };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { WorkbenchExecutionPanel } from "../WorkbenchExecutionPanel";
import type { WorkbenchExecutionPanelProps } from "../WorkbenchExecutionPanel";

function makeProps(
  overrides: Partial<WorkbenchExecutionPanelProps> = {}
): WorkbenchExecutionPanelProps {
  return {
    job: null,
    locale: "zh-CN",
    reasoningEntries: [],
    ...overrides,
  };
}

describe("WorkbenchExecutionPanel split layout", () => {
  it("renders execution flow before artifact flow and keeps both lanes in one split panel", () => {
    const job = {
      id: "job-1",
      artifacts: [
        {
          id: "a1",
          type: "requirements",
          title: "Requirements",
          summary: "Requirements artifact",
          createdAt: "2026-01-01T00:00:01Z",
          payload: {},
        },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          job,
          reasoningEntries: [
            {
              id: "r1",
              jobId: "job-1",
              iteration: 1,
              iterationLabel: "#1",
              phase: "observing",
              timestamp: "2026-01-01T00:00:00Z",
              stageId: "spec_docs",
              observationSummary: "Auth Domain spec document generated",
            },
          ] as any,
        })}
      />
    );

    expect(markup).toContain('data-testid="autopilot-process-artifact-split-panel"');
    expect(markup.indexOf('data-testid="autopilot-process-execution-lane"')).toBeLessThan(
      markup.indexOf('data-testid="autopilot-process-artifact-lane"')
    );
    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
    expect(markup).toContain("Auth Domain spec document generated");
    expect(markup).toContain('data-artifact-type="requirements"');
  });

  it("uses bounded internal scrolling so a long execution does not push the document area", () => {
    const job = {
      id: "job-fixed-height",
      artifacts: Array.from({ length: 8 }, (_, index) => ({
        id: `artifact-${index}`,
        type: "requirements",
        title: `Requirements ${index}`,
        createdAt: "2026-01-01T00:00:01Z",
        payload: {},
      })),
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          job,
          reasoningEntries: Array.from({ length: 12 }, (_, index) => ({
            id: `reasoning-${index}`,
            jobId: "job-fixed-height",
            iteration: index + 1,
            phase: "observing",
            timestamp: "2026-01-01T00:00:00Z",
            stageId: "spec_docs",
            observationSummary: `Observation ${index}`,
          })) as any,
        })}
      />
    );

    expect(markup).toContain("h-full");
    expect(markup).toContain("min-h-0");
    expect(markup).toContain("overflow-hidden");
    expect(markup).toContain("overflow-y-auto");
  });

  it("filters the artifact lane to spec document artifact types", () => {
    const job = {
      id: "job-filter",
      artifacts: [
        { id: "a1", type: "requirements", title: "Requirements", payload: {} },
        { id: "a2", type: "route_selection", title: "Route selection", payload: {} },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps({ job })} />
    );

    expect(markup).toContain('data-artifact-type="requirements"');
    expect(markup).not.toContain('data-artifact-type="route_selection"');
  });

  it("keeps next-stage reasoning visible after spec document artifacts exist", () => {
    const job = {
      id: "job-next-stage",
      artifacts: [
        { id: "a1", type: "spec_document", title: "Spec document", payload: {} },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel
        {...makeProps({
          job,
          reasoningEntries: [
            {
              id: "preview-1",
              jobId: "job-next-stage",
              iteration: 1,
              iterationLabel: "#1",
              phase: "thinking",
              timestamp: "2026-01-01T00:00:00Z",
              stageId: "effect_preview",
              thought: "Generating the effect preview from completed SPEC documents",
            },
          ] as any,
        })}
      />
    );

    expect(markup).toContain("Generating the effect preview");
    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
  });

  it("renders stale badges inside the artifact lane for stale spec artifacts", () => {
    const job = {
      id: "job-stale-doc-artifact",
      artifacts: [
        {
          id: "artifact-stale-requirements",
          type: "requirements",
          title: "Requirements",
          createdAt: "2026-01-01T00:00:01Z",
          payload: {},
          staleSince: "2026-05-23T08:00:00.000Z",
          invalidatedBy: {
            stage: "route_generation",
            artifactId: "route-selection-1",
            artifactType: "route_selection",
            reason: "upstream_route_selection_changed",
            triggeredAt: "2026-05-23T08:00:00.000Z",
          },
        },
      ],
    } as unknown as WorkbenchExecutionPanelProps["job"];

    const markup = renderToStaticMarkup(
      <WorkbenchExecutionPanel {...makeProps({ job, reasoningEntries: [] })} />
    );

    expect(markup).toContain('data-testid="autopilot-stale-badge"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-card-frame"');
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
  });
});
