/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — StoreObservabilityHud 回归测试。
 *
 * 测试三件事：
 * 1. 当 store 三个切片都为空时，HUD 容器仍渲染（保持 testid 可见），但内部
 *    三个子组件全部返回 null，使 HUD 实际只是一个空壳子（视觉上几乎不可见）。
 * 2. 当任一切片有数据时，对应子组件出现在 HUD 内部。
 * 3. AutopilotRoutePage 把 <StoreObservabilityHud /> 挂在 AutopilotVisualStage
 *    内部 absolute overlay 中，并位于 fabric 分支之外，使得 input / clarification
 *    等阶段也能看到该 HUD。
 *
 * 测试策略与本仓既有 right-rail 测试保持一致：使用 `react-dom/server`
 * `renderToStaticMarkup` + `vi.mock` 替换 `useBlueprintRealtimeStore`。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentProgressEntry,
  CapabilityStatus,
  RolePhase,
} from "@/lib/blueprint-realtime-store";

// ─── 受控的 store 切片 ────────────────────────────────────────────────────

interface MockedSlices {
  rolePhases: Record<string, RolePhase>;
  capabilityStatuses: Record<string, CapabilityStatus>;
  agentProgress: AgentProgressEntry[];
  agentReasoning: {
    jobId: string | null;
    entries: Array<{
      id: string;
      jobId: string;
      iteration: number;
      iterationLabel: string;
      phase: string;
      thought?: string;
      actionToolId?: string;
      observationSuccess?: boolean;
      observationSummary?: string;
      reason?: string;
      error?: string;
      timestamp: string;
    }>;
    currentIteration: number;
    status: string;
  };
}

let mockedSlices: MockedSlices = {
  rolePhases: {},
  capabilityStatuses: {},
  agentProgress: [],
  agentReasoning: {
    jobId: null,
    entries: [],
    currentIteration: 0,
    status: "idle",
  },
};

function setMockedSlices(next: Partial<MockedSlices>): void {
  mockedSlices = {
    rolePhases: next.rolePhases ?? {},
    capabilityStatuses: next.capabilityStatuses ?? {},
    agentProgress: next.agentProgress ?? [],
    agentReasoning:
      next.agentReasoning ?? {
        jobId: null,
        entries: [],
        currentIteration: 0,
        status: "idle",
      },
  };
}

function resetMockedSlices(): void {
  mockedSlices = {
    rolePhases: {},
    capabilityStatuses: {},
    agentProgress: [],
    agentReasoning: {
      jobId: null,
      entries: [],
      currentIteration: 0,
      status: "idle",
    },
  };
}

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: MockedSlices) => unknown) => {
    return selector ? selector(mockedSlices) : mockedSlices;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { StoreObservabilityHud } from "../StoreObservabilityHud";

// ─── 用例 ──────────────────────────────────────────────────────────────────

describe("StoreObservabilityHud", () => {
  beforeEach(() => {
    resetMockedSlices();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMockedSlices();
  });

  it("renders the HUD container even when all slices are empty (子组件 null 但壳子存在)", () => {
    const markup = renderToStaticMarkup(<StoreObservabilityHud />);

    // 容器自身仍被渲染（只是一个透明壳子）
    expect(markup).toContain('data-testid="store-observability-hud"');

    // 子组件的 testid 都不应该出现，因为切片为空时它们各自返回 null。
    // RoleStatusStrip 已从 HUD 移除（角色身份由 3D 真实角色承载）。
    expect(markup).not.toContain('data-testid="role-status-strip"');
    expect(markup).not.toContain('data-testid="capability-rail"');
    // autopilot-mirofish-stream 重构后 testid 改为 mirofish-card-stream
    expect(markup).not.toContain('data-testid="mirofish-card-stream"');
    expect(markup).not.toContain('data-testid="fleet-activation-log"');
  });

  it("no longer mounts RoleStatusStrip even when rolePhases has data (moved to 3D scene)", () => {
    setMockedSlices({ rolePhases: { planner: "thinking" } });

    const markup = renderToStaticMarkup(<StoreObservabilityHud />);

    expect(markup).toContain('data-testid="store-observability-hud"');
    // Role identity / phase is now carried by the real 3D agents, so the rail
    // strip is no longer mounted here.
    expect(markup).not.toContain('data-testid="role-status-strip"');
  });

  it("no longer renders the legacy capability pills row (moved to 3D role chips)", () => {
    setMockedSlices({
      capabilityStatuses: { "docker-analysis-sandbox": "invoking" },
    });

    const markup = renderToStaticMarkup(<StoreObservabilityHud />);

    expect(markup).toContain('data-testid="store-observability-hud"');
    // CapabilityRail no longer renders the top pills row; the capability status
    // pills (data-testid="capability-rail") are carried by the 3D role chips.
    // The detailed bridge panel is driven by useCapabilityBridgeState (not by
    // capabilityStatuses alone), so it does not render from this slice here.
    expect(markup).not.toContain('data-testid="capability-rail"');
    expect(markup).not.toContain("data-capability-id");
  });

  it("mounts AgentReasoningSubTimeline when agentReasoning.entries has data", () => {
    setMockedSlices({
      agentReasoning: {
        jobId: "intake-1",
        entries: [
          {
            id: "evt-1",
            jobId: "intake-1",
            iteration: 1,
            iterationLabel: "iter-1",
            phase: "thinking",
            thought: "正在扫描 GitHub 仓库...",
            timestamp: "2026-05-16T07:19:16.085Z",
          },
        ],
        currentIteration: 1,
        status: "streaming",
      },
    });

    const markup = renderToStaticMarkup(<StoreObservabilityHud />);

    expect(markup).toContain('data-testid="store-observability-hud"');
    // autopilot-mirofish-stream 重构后 testid 改为 mirofish-card-stream
    expect(markup).toContain('data-testid="mirofish-card-stream"');
    expect(markup).toContain("正在扫描 GitHub 仓库");
  });

  it("mounts FleetActivationLog when agentProgress has data", () => {
    setMockedSlices({
      agentProgress: [
        {
          id: "p-1",
          roleId: "role-01",
          type: "thinking",
          message: "scanning repo",
          timestamp: Date.UTC(2025, 0, 1, 0, 0, 0),
        },
      ],
    });

    const markup = renderToStaticMarkup(<StoreObservabilityHud />);

    expect(markup).toContain('data-testid="store-observability-hud"');
    expect(markup).toContain('data-testid="fleet-activation-log"');
    expect(markup).toContain("role-01");
    expect(markup).toContain("scanning repo");
  });

  it("AutopilotRoutePage 把 <AgentReasoningSubTimeline /> 挂在每个 active 子阶段卡片内（HUD 浮条已移除）", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../../AutopilotRoutePage.tsx"),
      "utf8"
    );

    // HUD 浮层已移除（用户反馈：不要 HUD 浮条），AutopilotRoutePage 不再
    // 引用 <StoreObservabilityHud />。
    expect(source).not.toMatch(/<StoreObservabilityHud\b/);

    // After Batch 3.8 migration, the page uses <StageSplitMount> +
    // deriveStageSplitDescriptor instead of direct <ProcessArtifactSplitPanel>
    // JSX with buildPreflightArtifactEntries callsites.
    // Verify the source imports/contains the unified mount surface:
    expect(source).toMatch(/StageSplitMount/);
    expect(source).toMatch(/deriveStageSplitDescriptor/);

    // Verify that the descriptor computation references each preflight sub-stage
    // name, ensuring all 4 preflight subs are wired through the unified surface:
    expect(source).toMatch(/sub:\s*"intake_created"/);
    expect(source).toMatch(/sub:\s*"clarification"/);
    expect(source).toMatch(/sub:\s*"route"/);
    expect(source).toMatch(/sub:\s*"target_input"/);
  });
});
