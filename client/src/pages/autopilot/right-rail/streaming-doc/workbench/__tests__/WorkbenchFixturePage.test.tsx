import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: unknown) => unknown) => {
    const snapshot = {
      agentReasoning: { entries: [] as unknown[] },
      rolePhases: {} as Record<string, unknown>,
      agentProgress: {} as Record<string, unknown>,
      capabilityStatuses: [] as unknown[],
      // whybuddy-spec-tree-progress-merge-2026-05-29 §6：fixture page 现在派生
      // specDocsProgress.nodes → nodeStatusById 透传给 workbench；mock snapshot
      // 必须包含该 slice，避免 selector 命中 undefined。
      specDocsProgress: { nodes: {} as Record<string, never> },
    };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { AutopilotSpecDocumentsWorkbenchFixturePage } from "../WorkbenchFixturePage";

describe("AutopilotSpecDocumentsWorkbenchFixturePage", () => {
  it("mounts a direct inspection fixture with target metrics and execution cards", () => {
    const markup = renderToStaticMarkup(
      <AutopilotSpecDocumentsWorkbenchFixturePage />
    );

    expect(markup).toContain(
      'data-testid="autopilot-spec-documents-workbench-fixture"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-spec-documents-workbench"'
    );
    expect(markup).toContain("Workbench Route Authoring");
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-docs"[^>]*>7 \/ 9</
    );
    expect(markup).toMatch(
      /data-testid="autopilot-workbench-stat-tasks"[^>]*>2 \/ 3</
    );
    expect(markup).toContain(
      'data-testid="autopilot-process-artifact-split-panel"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-process-execution-lane"'
    );
    expect(markup).toContain('data-testid="autopilot-process-artifact-lane"');
    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    expect(markup).toContain('data-testid="mirofish-card-artifact"');
  });
});
