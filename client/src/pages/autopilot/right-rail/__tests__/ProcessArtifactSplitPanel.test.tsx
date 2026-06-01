import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";

vi.mock("@/lib/blueprint-realtime-store", () => ({
  useBlueprintRealtimeStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      agentReasoning: { entries: [] },
    };
    return selector ? selector(state) : state;
  },
}));

import { ProcessArtifactSplitPanel } from "../ProcessArtifactSplitPanel";

function makeReasoning(
  partial: Partial<AgentReasoningEntry> & {
    id: string;
    phase: AgentReasoningEntry["phase"];
  }
): AgentReasoningEntry {
  return {
    jobId: "job-split",
    iteration: 1,
    iterationLabel: "#1",
    timestamp: "2026-05-25T08:00:00.000Z",
    ...partial,
  } as AgentReasoningEntry;
}

describe("ProcessArtifactSplitPanel", () => {
  it("renders execution flow on the left and artifact flow on the right without replacing either lane", () => {
    const job = {
      id: "job-split",
      artifacts: [
        {
          id: "artifact-intake",
          type: "intake",
          title: "Blueprint input",
          createdAt: "2026-05-25T08:02:00.000Z",
          payload: {},
        },
        {
          id: "artifact-source",
          type: "github_source",
          title: "GitHub source",
          createdAt: "2026-05-25T08:03:00.000Z",
          payload: {},
        },
      ],
    } as unknown as BlueprintGenerationJob;

    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel
        locale="en-US"
        job={job}
        stageFilter="intake_created"
        artifactTypes={["intake", "github_source"]}
        reasoningEntries={[
          makeReasoning({
            id: "observe-repo",
            phase: "observing",
            stageId: "intake_created",
            observationSummary: "Repository scan completed",
          }),
          makeReasoning({
            id: "clarify-hidden",
            phase: "thinking",
            stageId: "clarification",
            thought: "This should be filtered out",
          }),
        ]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-process-artifact-split-panel"');
    expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');
    expect(markup.indexOf('data-testid="autopilot-process-execution-lane"')).toBeLessThan(
      markup.indexOf('data-testid="autopilot-process-artifact-lane"')
    );
    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    expect(markup).toContain("Repository scan completed");
    expect(markup).not.toContain("This should be filtered out");
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
    expect(markup).toContain("Blueprint input");
    expect(markup).toContain("GitHub source");
    expect(markup).not.toContain('data-testid="autopilot-process-execution-empty"');
    expect(markup).not.toContain('data-testid="autopilot-process-artifact-empty"');
  });

  it("keeps both lanes mounted when one side is empty", () => {
    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel
        locale="zh-CN"
        job={null}
        stageFilter="route_generation"
        artifactTypes={["route_set"]}
        reasoningEntries={[
          makeReasoning({
            id: "route-thinking",
            phase: "thinking",
            stageId: "route_generation",
            thought: "正在生成路线",
          }),
        ]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');
    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-placeholder"');
  });

  it("renders fallback execution facts instead of an empty process lane for completed stages without reasoning events", () => {
    const job = {
      id: "job-completed",
      artifacts: [
        {
          id: "artifact-clarification",
          type: "clarification_session",
          title: "Clarification session",
          createdAt: "2026-05-25T08:04:00.000Z",
          payload: {},
        },
      ],
    } as unknown as BlueprintGenerationJob;

    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel
        locale="zh-CN"
        job={job}
        stageFilter="clarification"
        artifactTypes={["clarification_session"]}
        reasoningEntries={[]}
        fallbackExecutionEntries={[
          {
            id: "clarification-submitted",
            stageId: "clarification",
            text: "澄清已提交，3 个必答问题已完成。",
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    expect(markup).toContain("澄清已提交");
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
    expect(markup).not.toContain('data-testid="autopilot-process-execution-empty"');
  });

  it("renders stage-local artifacts even before a generation job exists", () => {
    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel
        locale="zh-CN"
        job={null}
        stageFilter="clarification"
        artifactTypes={["clarification_session"]}
        reasoningEntries={[]}
        artifacts={[
          {
            id: "clarification-session-local",
            type: "clarification_session",
            title: "澄清会话",
            summary: "3 个问题已生成",
            createdAt: "2026-05-25T08:04:00.000Z",
            payload: {},
          },
        ]}
      />
    );

    expect(markup).toContain('data-testid="mirofish-card-artifact"');
    expect(markup).toContain('data-artifact-type="clarification_session"');
    expect(markup).not.toContain('data-testid="autopilot-process-artifact-empty"');
  });

  it("filters reasoning entries to the current job before rendering execution cards", () => {
    const job = { id: "job-current", artifacts: [] } as unknown as BlueprintGenerationJob;

    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel
        locale="en-US"
        job={job}
        stageFilter="spec_docs"
        reasoningEntries={[
          makeReasoning({
            id: "old-job-entry",
            jobId: "job-old",
            phase: "thinking",
            stageId: "spec_docs",
            thought: "old WhyBuddy document assembly",
          }),
          makeReasoning({
            id: "current-job-entry",
            jobId: "job-current",
            phase: "thinking",
            stageId: "spec_docs",
            thought: "current permission document assembly",
          }),
        ]}
      />
    );

    expect(markup).toContain("current permission document assembly");
    expect(markup).not.toContain("old WhyBuddy document assembly");
  });

  it("StageSplitMount passes descriptor stageFilter into the execution panel", () => {
    const source = readFileSync(
      resolve(__dirname, "../StageSplitMount.tsx"),
      "utf8"
    );

    expect(source).toMatch(/stageFilter=\{descriptor\.stageFilter\}/);
  });
});

/**
 * **Validates: Requirements 2.1, 2.2, 2.5, 2.6, 2.7**
 *
 * Property P2: empty-placeholder semantics — when lanes are empty the panel
 * renders stable placeholder cards (or omits them when explicitly disabled),
 * while always preserving both lane containers in the DOM.
 */
describe("empty-placeholder semantics (P2)", () => {
  it("renders exactly one execution placeholder and one artifact placeholder when inputs are empty and showEmptyPlaceholder defaults to true", () => {
    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel locale="zh-CN" />
    );
    // Count occurrences of the placeholder testids
    const execPlaceholders = (markup.match(/data-testid="autopilot-process-execution-placeholder"/g) ?? []).length;
    const artPlaceholders = (markup.match(/data-testid="autopilot-process-artifact-placeholder"/g) ?? []).length;
    expect(execPlaceholders).toBe(1);
    expect(artPlaceholders).toBe(1);
  });

  it("does not render placeholder cards when showEmptyPlaceholder={false}, but lane containers remain in DOM", () => {
    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel locale="zh-CN" showEmptyPlaceholder={false} />
    );
    expect(markup).not.toContain('data-testid="autopilot-process-execution-placeholder"');
    expect(markup).not.toContain('data-testid="autopilot-process-artifact-placeholder"');
    // Lane containers MUST still be present (Requirement 2.7)
    expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');
  });
});

describe("lane stability (P1)", () => {
  /**
   * Validates: Requirements 2.5, 2.6
   *
   * Both lane containers must be present in the DOM under all 4 input
   * combinations of artifacts × reasoningEntries (empty / non-empty).
   */

  it("both lanes present when artifacts=[] and reasoningEntries=[]", () => {
    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel
        locale="en-US"
        job={null}
        artifacts={[]}
        reasoningEntries={[]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');
  });

  it("both lanes present when artifacts=non-empty and reasoningEntries=[]", () => {
    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel
        locale="en-US"
        job={null}
        artifacts={[
          {
            id: "art-1",
            type: "intake",
            title: "Test artifact",
            summary: "Test artifact summary",
            createdAt: "2026-05-25T08:00:00.000Z",
            payload: {},
          },
        ]}
        reasoningEntries={[]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');
  });

  it("both lanes present when artifacts=[] and reasoningEntries=non-empty", () => {
    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel
        locale="en-US"
        job={null}
        artifacts={[]}
        reasoningEntries={[
          makeReasoning({
            id: "r-1",
            phase: "thinking",
            stageId: "intake_created",
            thought: "Processing",
          }),
        ]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');
  });

  it("both lanes present when artifacts=non-empty and reasoningEntries=non-empty", () => {
    const markup = renderToStaticMarkup(
      <ProcessArtifactSplitPanel
        locale="en-US"
        job={null}
        artifacts={[
          {
            id: "art-2",
            type: "github_source",
            title: "GitHub source",
            summary: "GitHub source summary",
            createdAt: "2026-05-25T08:01:00.000Z",
            payload: {},
          },
        ]}
        reasoningEntries={[
          makeReasoning({
            id: "r-2",
            phase: "observing",
            stageId: "intake_created",
            observationSummary: "Scan done",
          }),
        ]}
      />
    );

    expect(markup).toContain('data-testid="autopilot-process-execution-lane"');
    expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');
  });
});
