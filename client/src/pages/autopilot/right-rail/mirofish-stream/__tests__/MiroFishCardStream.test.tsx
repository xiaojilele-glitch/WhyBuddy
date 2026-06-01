/**
 * autopilot-mirofish-stream / Wave 0 — 主组件 SSR 集成测试
 *
 * 用 react-dom/server renderToStaticMarkup + vi.mock 替换
 * useBlueprintRealtimeStore（与既有 right-rail 测试一致）。
 *
 * 测试覆盖：
 * - 空态：所有 slice 空 + 无 job → 返回 null
 * - 6 类 entry 同时存在时全部按 timestamp 渲染（reasoning + capability + artifact +
 *   route_decision + node_completed）
 * - stageFilter string / readonly string[] 两种形态
 * - 单纵向布局：markup 不含 grid-cols-[1fr_2px_1fr]
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentReasoningEntry,
  CapabilityStatus,
} from "@/lib/blueprint-realtime-store";
import type {
  BlueprintGenerationJob,
} from "@shared/blueprint/contracts";

// ─── store mock ───────────────────────────────────────────────────────────

interface MockedSlices {
  agentReasoningEntries: AgentReasoningEntry[];
  capabilityStatuses: Record<string, CapabilityStatus>;
}

let mockedSlices: MockedSlices = {
  agentReasoningEntries: [],
  capabilityStatuses: {},
};

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: any) => unknown) => {
    const state = {
      agentReasoning: { entries: mockedSlices.agentReasoningEntries },
      capabilityStatuses: mockedSlices.capabilityStatuses,
    };
    return selector ? selector(state) : state;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;
  return { useBlueprintRealtimeStore };
});

import { MiroFishCardStream } from "../MiroFishCardStream";

// ─── 工厂 ─────────────────────────────────────────────────────────────────

function makeReasoning(
  partial: Partial<AgentReasoningEntry> & {
    id: string;
    phase: AgentReasoningEntry["phase"];
  }
): AgentReasoningEntry {
  return {
    jobId: "job-1",
    iteration: 1,
    iterationLabel: "#1",
    timestamp: "2026-05-17T07:00:00.000Z",
    ...partial,
  } as AgentReasoningEntry;
}

function makeJob(
  partial: Partial<BlueprintGenerationJob> = {}
): BlueprintGenerationJob {
  return {
    id: "job-1",
    events: [],
    artifacts: [],
    ...partial,
  } as unknown as BlueprintGenerationJob;
}

// ─── 用例 ─────────────────────────────────────────────────────────────────

describe("MiroFishCardStream", () => {
  beforeEach(() => {
    mockedSlices = {
      agentReasoningEntries: [],
      capabilityStatuses: {},
    };
  });
  afterEach(() => {
    mockedSlices = {
      agentReasoningEntries: [],
      capabilityStatuses: {},
    };
  });

  it("空态:返回 null（无 testid）", () => {
    const markup = renderToStaticMarkup(
      <MiroFishCardStream locale="zh-CN" />
    );
    expect(markup).toBe("");
  });

  it("有 reasoning entries 时:渲染 stream 容器 + reasoning 卡片", () => {
    mockedSlices.agentReasoningEntries = [
      makeReasoning({
        id: "evt-1",
        phase: "thinking",
        thought: "正在分析",
        stageId: "spec_tree",
      }),
      makeReasoning({
        id: "evt-2",
        phase: "acting",
        actionToolId: "llm.spec_tree",
        timestamp: "2026-05-17T07:00:01.000Z",
        stageId: "spec_tree",
      }),
    ];
    const markup = renderToStaticMarkup(
      <MiroFishCardStream locale="zh-CN" />
    );
    expect(markup).toContain('data-testid="mirofish-card-stream"');
    expect(markup).toContain('data-testid="mirofish-card-reasoning"');
    // 应该出现两次 reasoning 卡片
    const matches = markup.match(/data-testid="mirofish-card-reasoning"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("单纵向布局:markup 不含 grid-cols 双轨布局 class", () => {
    mockedSlices.agentReasoningEntries = [
      makeReasoning({
        id: "evt-1",
        phase: "thinking",
        thought: "x",
        stageId: "spec_tree",
      }),
    ];
    const markup = renderToStaticMarkup(
      <MiroFishCardStream locale="zh-CN" />
    );
    expect(markup).not.toContain("grid-cols-[1fr_2px_1fr]");
  });

  it("stageFilter string:仅显示该阶段 entry", () => {
    mockedSlices.agentReasoningEntries = [
      makeReasoning({
        id: "evt-clarify",
        phase: "thinking",
        thought: "C",
        stageId: "clarification",
      }),
      makeReasoning({
        id: "evt-spec",
        phase: "thinking",
        thought: "S",
        stageId: "spec_tree",
      }),
    ];
    const markup = renderToStaticMarkup(
      <MiroFishCardStream locale="zh-CN" stageFilter="spec_tree" />
    );
    expect(markup).toContain("S");
    expect(markup).not.toContain('thought>C');
  });

  it("filters store reasoning entries to the current job when job is provided", () => {
    mockedSlices.agentReasoningEntries = [
      makeReasoning({
        id: "old-job-entry",
        jobId: "job-old",
        phase: "thinking",
        thought: "old WhyBuddy residue",
        stageId: "spec_docs",
      }),
      makeReasoning({
        id: "current-job-entry",
        jobId: "job-1",
        phase: "thinking",
        thought: "current permission project",
        stageId: "spec_docs",
      }),
    ];

    const markup = renderToStaticMarkup(
      <MiroFishCardStream locale="en-US" job={makeJob({ id: "job-1" })} />
    );

    expect(markup).toContain("current permission project");
    expect(markup).not.toContain("old WhyBuddy residue");
  });

  it("stageFilter readonly string[]:多阶段合并视图", () => {
    mockedSlices.agentReasoningEntries = [
      makeReasoning({
        id: "evt-rg",
        phase: "thinking",
        thought: "RG",
        stageId: "route_generation",
      }),
      makeReasoning({
        id: "evt-rs",
        phase: "thinking",
        thought: "RS",
        stageId: "route_selection",
      }),
      makeReasoning({
        id: "evt-clarify",
        phase: "thinking",
        thought: "C",
        stageId: "clarification",
      }),
    ];
    const markup = renderToStaticMarkup(
      <MiroFishCardStream
        locale="zh-CN"
        stageFilter={["route_generation", "route_selection"]}
      />
    );
    // 应包含 RG 与 RS,不包含 C
    expect(markup).toContain("RG");
    expect(markup).toContain("RS");
    expect(markup).not.toMatch(/>C<\/div>/);
  });

  it("缺失 stageId 的 entry 在任何 stageFilter 下都显示（视为全局事件）", () => {
    mockedSlices.agentReasoningEntries = [
      makeReasoning({
        id: "evt-global",
        phase: "thinking",
        thought: "GLOBAL",
        // 不设 stageId
      }),
    ];
    const markup = renderToStaticMarkup(
      <MiroFishCardStream locale="zh-CN" stageFilter="spec_tree" />
    );
    expect(markup).toContain("GLOBAL");
  });

  it("artifact + reasoning 混合时按 timestamp 排序", () => {
    mockedSlices.agentReasoningEntries = [
      makeReasoning({
        id: "evt-1",
        phase: "thinking",
        thought: "EARLY",
        timestamp: "2026-05-17T07:00:00.000Z",
        stageId: "spec_tree",
      }),
      makeReasoning({
        id: "evt-2",
        phase: "thinking",
        thought: "LATE",
        timestamp: "2026-05-17T07:02:00.000Z",
        stageId: "spec_tree",
      }),
    ];
    const job = makeJob({
      artifacts: [
        {
          id: "artifact-1",
          type: "spec_tree",
          title: "Mid artifact",
          summary: "x",
          createdAt: "2026-05-17T07:01:00.000Z",
        } as unknown as BlueprintGenerationJob["artifacts"][0],
      ],
    });
    const markup = renderToStaticMarkup(
      <MiroFishCardStream locale="zh-CN" job={job} />
    );
    // 三张卡片都应出现
    expect(markup).toContain("EARLY");
    expect(markup).toContain("Mid artifact");
    expect(markup).toContain("LATE");
    // 按文本出现位置反推顺序：EARLY < Mid < LATE
    const idxEarly = markup.indexOf("EARLY");
    const idxMid = markup.indexOf("Mid artifact");
    const idxLate = markup.indexOf("LATE");
    expect(idxEarly).toBeLessThan(idxMid);
    expect(idxMid).toBeLessThan(idxLate);
  });

  it("capability 仅在 reasoning 有 acting 反查 timestamp 时入流", () => {
    mockedSlices.agentReasoningEntries = [
      makeReasoning({
        id: "act-1",
        phase: "acting",
        actionToolId: "docker-analysis-sandbox",
        stageId: "spec_tree",
        timestamp: "2026-05-17T07:00:01.000Z",
      }),
    ];
    mockedSlices.capabilityStatuses = {
      "docker-analysis-sandbox": "completed",
      "mcp-github-source": "invoking", // 没有 acting,被跳过
    };
    const markup = renderToStaticMarkup(
      <MiroFishCardStream locale="zh-CN" />
    );
    expect(markup).toContain("docker-analysis-sandbox");
    expect(markup).not.toContain("mcp-github-source");
  });
});
