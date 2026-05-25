/**
 * WorkbenchExecutionPanel non-regression test (new baseline)
 *
 * Per design.md and Requirements 3.4–3.5 (and P9), the public props of
 * `WorkbenchExecutionPanel` do NOT add a `showEmptyPlaceholder` switch;
 * the new placeholder cards become the visual baseline for empty data.
 *
 * **Validates: Requirements 3.4, 3.5**
 */
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

describe("WorkbenchExecutionPanel regression (P9)", () => {
  describe("Case A: non-empty data — structural equivalence to historical baseline (NO regression)", () => {
    it("renders both lane testids with execution lane before artifact lane", () => {
      mockReasoningEntries = [];

      const job = {
        id: "job-regression-a",
        artifacts: [
          {
            id: "a1",
            type: "requirements",
            title: "Requirements",
            summary: "Requirements artifact",
            createdAt: "2026-01-01T00:00:01Z",
            payload: {},
          },
          {
            id: "a2",
            type: "design",
            title: "Design",
            summary: "Design artifact",
            createdAt: "2026-01-01T00:00:02Z",
            payload: {},
          },
        ],
      } as unknown as WorkbenchExecutionPanelProps["job"];

      const reasoningEntries = [
        {
          id: "r1",
          jobId: "job-regression-a",
          iteration: 1,
          iterationLabel: "#1",
          phase: "observing",
          timestamp: "2026-01-01T00:00:00Z",
          stageId: "spec_docs",
          observationSummary: "Generated requirements document",
          observationSuccess: true,
        },
        {
          id: "r2",
          jobId: "job-regression-a",
          iteration: 2,
          iterationLabel: "#2",
          phase: "thinking",
          timestamp: "2026-01-01T00:00:01Z",
          stageId: "spec_docs",
          thought: "Generating design document",
        },
      ] as unknown as WorkbenchExecutionPanelProps["reasoningEntries"];

      const markup = renderToStaticMarkup(
        <WorkbenchExecutionPanel {...makeProps({ job, reasoningEntries })} />
      );

      // Both lane testids present
      expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
      expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');

      // Execution lane appears before artifact lane (ordered card list)
      expect(
        markup.indexOf('data-testid="autopilot-process-execution-lane"')
      ).toBeLessThan(
        markup.indexOf('data-testid="autopilot-process-artifact-lane"')
      );

      // At least one reasoning card rendered
      expect(markup).toContain('data-testid="mirofish-card-reasoning"');

      // At least one artifact card rendered
      expect(markup).toContain('data-testid="autopilot-process-artifact-card-frame"');

      // No placeholder cards rendered (because lanes have content)
      expect(markup).not.toContain('data-testid="autopilot-process-execution-placeholder"');
      expect(markup).not.toContain('data-testid="autopilot-process-artifact-placeholder"');
    });

    it("preserves className tokens for bounded scrolling and grid layout", () => {
      mockReasoningEntries = [];

      const job = {
        id: "job-regression-class",
        artifacts: [
          {
            id: "a1",
            type: "requirements",
            title: "Requirements",
            createdAt: "2026-01-01T00:00:01Z",
            payload: {},
          },
        ],
      } as unknown as WorkbenchExecutionPanelProps["job"];

      const reasoningEntries = [
        {
          id: "r1",
          jobId: "job-regression-class",
          iteration: 1,
          iterationLabel: "#1",
          phase: "observing",
          timestamp: "2026-01-01T00:00:00Z",
          stageId: "spec_docs",
          observationSummary: "Observation",
          observationSuccess: true,
        },
      ] as unknown as WorkbenchExecutionPanelProps["reasoningEntries"];

      const markup = renderToStaticMarkup(
        <WorkbenchExecutionPanel {...makeProps({ job, reasoningEntries })} />
      );

      // Structural className tokens from the historical baseline
      expect(markup).toContain("h-full");
      expect(markup).toContain("min-h-0");
      expect(markup).toContain("overflow-hidden");
      expect(markup).toContain("overflow-y-auto");
      expect(markup).toContain("lg:grid-cols-");
    });
  });

  describe("Case B: empty data — NEW BASELINE (placeholder cards appear)", () => {
    it("renders placeholder cards when reasoning and artifacts are both empty", () => {
      mockReasoningEntries = [];

      const markup = renderToStaticMarkup(
        <WorkbenchExecutionPanel {...makeProps({ job: null, reasoningEntries: [] })} />
      );

      // Both lane testids still present
      expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
      expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');

      // NEW BASELINE: placeholder cards ARE present
      expect(markup).toContain('data-testid="autopilot-process-execution-placeholder"');
      expect(markup).toContain('data-testid="autopilot-process-artifact-placeholder"');

      // No real content cards
      expect(markup).not.toContain('data-testid="mirofish-card-reasoning"');
      expect(markup).not.toContain('data-testid="autopilot-process-artifact-card-frame"');
    });

    it("renders placeholder cards when job has empty artifacts array", () => {
      mockReasoningEntries = [];

      const job = {
        id: "job-empty",
        artifacts: [],
      } as unknown as WorkbenchExecutionPanelProps["job"];

      const markup = renderToStaticMarkup(
        <WorkbenchExecutionPanel {...makeProps({ job, reasoningEntries: [] })} />
      );

      // Both lane testids present
      expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
      expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');

      // Placeholder cards present (new baseline)
      expect(markup).toContain('data-testid="autopilot-process-execution-placeholder"');
      expect(markup).toContain('data-testid="autopilot-process-artifact-placeholder"');
    });

    it("placeholder cards have aria-busy for accessibility", () => {
      mockReasoningEntries = [];

      const markup = renderToStaticMarkup(
        <WorkbenchExecutionPanel {...makeProps({ job: null, reasoningEntries: [] })} />
      );

      expect(markup).toContain('aria-busy="true"');
    });
  });
});
