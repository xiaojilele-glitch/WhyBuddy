/**
 * autopilot-streaming-experience Spec Task 2.1：子时间线挂载条件回归测试。
 *
 * 该测试覆盖需求 2.1 / 2.2 / 2.6：
 * - 2.1：currentStage === "fabric" 且某子阶段被判定为 active 时，active 卡片
 *   内部挂载 `AgentReasoningSubTimeline`。
 * - 2.6：currentStage !== "fabric" 时不挂载子时间线。
 * - 2.2：当 store 中 `agentReasoning.entries.length === 0 && status === "idle"`
 *   时子时间线返回 null（折叠态，不抢占布局）；当存在至少一条
 *   `phase === "thinking"` 且 `status === "streaming"` 时返回非 null。
 *
 * 实现口径（与本仓现有 React 组件测试保持一致）：
 *
 *   本仓库 *未* 集成 `@testing-library/react`、`jsdom` 或 `happy-dom`；引入
 *   这些工具属于跨规格的工具链改造，不在本规格的约束范围内（NFR-1：不扩张
 *   5140+ 既有测试集 / TS 基线）。
 *
 *   本测试参照 `AutopilotRoutePage.test.tsx` 的 "E1: route selection must
 *   NOT navigate" 双层模式：
 *
 *   1. 源代码层断言：直接读取 `AutopilotRightRail.tsx` 文件内容，证明
 *      `<AgentReasoningSubTimeline />` 的 JSX 引用只出现在 `ActiveNodeContent`
 *      函数内部，并且 `ActiveNodeContent` 仅在 `status === "active"` 子阶段
 *      卡片中被挂载；同时 fabric 早返回保证 `currentStage !== "fabric"` 时
 *      整条时间线（含 active 卡片）都不渲染。
 *
 *   2. SSR 层断言：用 `react-dom/server` 的 `renderToStaticMarkup` 在
 *      mocked `useBlueprintRealtimeStore` 状态下渲染 `<AutopilotRightRail>`，
 *      通过判断输出 markup 中是否包含子时间线容器的稳定标识
 *      （`max-h-[360px]` + `grid-cols-[1fr_2px_1fr]`，二者只出现在子时间线
 *      自身的双轨布局容器上）来锁定折叠态与展开态契约。
 *
 *      备注：Zustand v5 的 `useSyncExternalStore` 在 SSR 路径下使用
 *      `getInitialState()` 作为 snapshot，故无法通过 `setState` 在 SSR 期间
 *      seed 实时切片；本测试改用 `vi.mock` 直接替换 hook 实现，让
 *      `useBlueprintRealtimeStore(selector)` 在 selector 调用时返回受控的
 *      mocked state，与 React `useSyncExternalStore` 解耦。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type { BlueprintAgentCrewSnapshot } from "@/lib/blueprint-api";
import type {
  AgentReasoningEntry,
  AgentReasoningSliceState,
} from "@/lib/blueprint-realtime-store";

// ─── 受控的 agentReasoning slice 状态 ────────────────────────────────────────

let mockedAgentReasoning: AgentReasoningSliceState = {
  jobId: null,
  entries: [],
  currentIteration: 0,
  status: "idle",
};

function setMockedAgentReasoning(next: Partial<AgentReasoningSliceState>): void {
  mockedAgentReasoning = {
    ...mockedAgentReasoning,
    ...next,
  };
}

function resetMockedAgentReasoning(): void {
  mockedAgentReasoning = {
    jobId: null,
    entries: [],
    currentIteration: 0,
    status: "idle",
  };
}

// ─── Mock `@/lib/blueprint-realtime-store` ──────────────────────────────────

vi.mock("@/lib/blueprint-realtime-store", () => {
  // 仅需提供 `useBlueprintRealtimeStore`（hook + selector）的最小子集；
  // AutopilotRightRail 不直接读写其它字段，且 sub-timeline 仅消费
  // `agentReasoning.entries`。其它 API（subscribe / unsubscribe / dispatchEvent
  // / __setSocket）在本测试中不被调用。
  const useBlueprintRealtimeStore = ((selector?: (state: { agentReasoning: AgentReasoningSliceState; specDocsProgress: { nodes: Record<string, never> } }) => unknown) => {
    const snapshot = {
      agentReasoning: mockedAgentReasoning,
      // whybuddy-spec-tree-progress-merge-2026-05-29 §6：RightRail 现在派生
      // specDocsProgress.nodes → nodeStatusById 透传给 SPEC 树。真实 store 始终
      // 初始化该切片，这里补一个空 nodes record 让 SSR selector 不命中 undefined。
      specDocsProgress: { nodes: {} as Record<string, never> },
    };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { AutopilotRightRail } from "../AutopilotRightRail";
import type { AutopilotRightRailProps } from "../types";

// ─── 公共 fixture ───────────────────────────────────────────────────────────

const EMPTY_AGENT_CREW = {
  roleTimelines: [],
} as unknown as BlueprintAgentCrewSnapshot;

const EMPTY_SPEC_TREE = {
  id: "spec-tree-test",
  nodes: [],
  documents: [],
} as unknown as BlueprintSpecTree;

function makeProps(
  overrides: Partial<AutopilotRightRailProps> = {}
): AutopilotRightRailProps {
  return {
    jobId: "job-test",
    currentStage: "fabric",
    currentSubStage: "agent_crew_fabric",
    job: {
      id: "job-test",
      stage: "agent_crew_fabric",
    } as unknown as BlueprintGenerationJob,
    routeSet: null,
    selection: null,
    specTree: null,
    agentCrew: EMPTY_AGENT_CREW,
    capabilities: [],
    capabilityInvocations: [],
    capabilityEvidence: [],
    effectPreviews: [],
    locale: "zh-CN",
    onSubStageChange: () => {},
    ...overrides,
  };
}

function makeThinkingEntry(): AgentReasoningEntry {
  return {
    id: "job-test:1:thinking:2025-01-01T00:00:00.000Z",
    jobId: "job-test",
    iteration: 1,
    iterationLabel: "#1",
    phase: "thinking",
    thought: "正在分析仓库目录结构…",
    timestamp: "2025-01-01T00:00:00.000Z",
  };
}

// ─── Layer 1：源代码层 — JSX 挂载点的 fabric & active 双重 gating ─────────────

describe("AutopilotRightRail subtimeline mount (source-level contract)", () => {
  it("only references <AgentReasoningSubTimeline /> from a fabric & active gated path", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../AutopilotRightRail.tsx"),
      "utf8"
    );

    // 关键事实 1：当 currentStage !== "fabric" 时整条时间线（包括 active 卡片）
    // 都不会渲染，因此子时间线也不可能挂载。
    expect(source).toMatch(
      /if\s*\(\s*currentStage\s*!==\s*"fabric"\s*\)\s*\{[\s\S]*?return\s*\(/
    );

    // 关键事实 2：active 卡片内容仅在 activeSubStage !== undefined 时挂载，
    // 该分支同时是 <ActiveNodeContent /> 的唯一 JSX 引用所在地。
    //
    // autopilot-streaming-doc-renderer Task 6.1（2026-05-18）：
    // StageContent 现在通过 `activeStageKey === "spec_documents" ? <StreamingDocRenderer /> : (activeSubStage !== undefined && <ActiveNodeContent />)`
    // 的三元分支选择渲染。`<ActiveNodeContent />` 仍然只出现在 `activeSubStage !== undefined`
    // 这一臂中，但它现在嵌套在 ternary `:` 分支里，因此正则不再要求紧跟 `}`。
    expect(source).toMatch(
      /activeSubStage\s*!==\s*undefined\s*&&\s*\(\s*\n[\s\S]*?<ActiveNodeContent[\s\S]*?\)\s*\)/
    );

    // 关键事实 3：<AgentReasoningSubTimeline /> 的 JSX 引用恰好出现一次，
    // 且嵌入在 ActiveNodeContent 函数体内（在 fabric 早返回之后），
    // 不在 currentStage !== "fabric" 的占位分支里。
    const jsxMatches = source.match(/<AgentReasoningSubTimeline\b/g) ?? [];
    expect(jsxMatches).toHaveLength(1);

    // 进一步确认 ActiveNodeContent 函数体内包含子时间线 JSX 引用：
    // 用 “function ActiveNodeContent” 作为函数体起点，匹配到下一个顶层 “export const”
    // 或下一个 “function ”定义之前的范围。
    const activeBodyMatch = source.match(
      /function\s+ActiveNodeContent\b[\s\S]*?(?=\nexport\s+const\s+AutopilotRightRail|\nfunction\s+AgentReasoningSubTimeline)/
    );
    expect(activeBodyMatch).not.toBeNull();
    expect(activeBodyMatch?.[0] ?? "").toMatch(/<AgentReasoningSubTimeline\b/);
  });
});

// ─── Layer 2：SSR + mocked store — 折叠态 / 展开态契约 ───────────────────────

describe("AgentReasoningSubTimeline render contract via AutopilotRightRail SSR", () => {
  beforeEach(() => {
    resetMockedAgentReasoning();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMockedAgentReasoning();
  });

  it("returns null when entries are empty and status is idle (folded state)", () => {
    // Mock 默认即 entries === [] && status === "idle"，对应需求 2.2 折叠态。
    const markup = renderToStaticMarkup(<AutopilotRightRail {...makeProps()} />);

    // active 卡片仍然存在（agent_crew_fabric 子阶段为 active）。
    expect(markup).toContain('data-timeline-status="active"');
    expect(markup).toContain('data-sub-stage-placeholder="agent_crew_fabric"');

    // 但子时间线容器（autopilot-mirofish-stream 重构后用 testid="mirofish-card-stream"
    // 标识；旧版本是 max-h-[360px] + grid-cols-[1fr_2px_1fr] 双轨容器，现已删除）
    // 不应出现，即 AgentReasoningSubTimeline → MiroFishCardStream 早返回 null。
    expect(markup).not.toContain('data-testid="mirofish-card-stream"');
  });

  it("renders the canonical agent crew panel instead of the legacy subtimeline for agent_crew_fabric", () => {
    setMockedAgentReasoning({
      jobId: "job-test",
      entries: [makeThinkingEntry()],
      currentIteration: 1,
      status: "streaming",
    });

    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          specTree: EMPTY_SPEC_TREE,
        })}
      />
    );

    expect(markup).toContain('data-testid="blueprint-agent-crew-surface"');
    expect(markup).not.toContain('data-testid="mirofish-card-stream"');
    expect(markup).not.toContain("正在分析仓库目录结构");
  });

  it("does not mount the subtimeline when currentStage !== 'fabric'", () => {
    // 即便 mocked store 持有 streaming 数据，currentStage !== "fabric" 时
    // 整条时间线（含 active 卡片与子时间线容器）都不应渲染。
    setMockedAgentReasoning({
      jobId: "job-test",
      entries: [makeThinkingEntry()],
      currentIteration: 1,
      status: "streaming",
    });

    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentStage: "input",
          currentSubStage: undefined,
          job: null,
          agentCrew: null,
        })}
      />
    );

    expect(markup).not.toContain('data-testid="mirofish-card-stream"');
    expect(markup).not.toContain('data-timeline-status="active"');
    expect(markup).toContain('data-stage-placeholder="input"');
  });
});
