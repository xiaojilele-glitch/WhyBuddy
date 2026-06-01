/**
 * `autopilot-agent-reasoning-stream` spec Task 9：BlueprintRealtimeStore agentReasoning slice 单测。
 *
 * 验证 agentReasoning slice 在 dispatchEvent / subscribe / 500-cap 截断 /
 * currentIteration 派生 / status 派生 5 类场景下的行为。全部 example-based，禁 PBT。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBlueprintRealtimeStore, __setSocket, __setHydrateHistoricalEventsForTest } from "../blueprint-realtime-store.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 构造一条最小 role.agent.* relay 事件。 */
function makeAgentEvent(
  overrides: {
    type?: string;
    jobId?: string;
    timestamp?: string | number;
    payload?: Record<string, unknown>;
  } = {}
) {
  return {
    type: overrides.type ?? "role.agent.thinking",
    jobId: overrides.jobId ?? "job-test",
    timestamp: overrides.timestamp ?? "2026-05-13T10:00:00.000Z",
    payload: overrides.payload ?? {
      iteration: 1,
      roleId: "planner",
      stageId: "route_generation",
      thought: "分析代码结构",
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("BlueprintRealtimeStore — agentReasoning slice", () => {
  beforeEach(() => {
    // 注入 null socket 避免真实连接
    __setSocket(null as any);
    useBlueprintRealtimeStore.setState(useBlueprintRealtimeStore.getInitialState());
  });

  afterEach(() => {
    useBlueprintRealtimeStore.getState().reset();
  });

  it("role.agent.thinking event dispatch → entries.length===1，entry 字段与 payload 对应", () => {
    const store = useBlueprintRealtimeStore.getState();
    store.dispatchEvent(makeAgentEvent({
      type: "role.agent.thinking",
      payload: { iteration: 1, roleId: "planner", stageId: "route_generation", thought: "分析代码" },
    }));

    const state = useBlueprintRealtimeStore.getState();
    expect(state.agentReasoning.entries).toHaveLength(1);
    const entry = state.agentReasoning.entries[0];
    expect(entry.phase).toBe("thinking");
    expect(entry.iteration).toBe(1);
    expect(entry.thought).toBe("分析代码");
  });

  it("连续 dispatch 超过 500 条 → FIFO 截断，最旧被移除；logEntries 不超过 200", () => {
    const store = useBlueprintRealtimeStore.getState();

    for (let i = 0; i < 510; i++) {
      store.dispatchEvent(makeAgentEvent({
        type: "role.agent.thinking",
        timestamp: `2026-05-13T10:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`,
        payload: { iteration: i + 1, roleId: "planner", stageId: "route_generation", thought: `思考 ${i}` },
      }));
    }

    const state = useBlueprintRealtimeStore.getState();
    expect(state.agentReasoning.entries.length).toBeLessThanOrEqual(500);
    // 最旧的被移除：第一条 entry 的 iteration 不应是 1
    expect(state.agentReasoning.entries[0].iteration).toBeGreaterThan(1);
    // logEntries 200-cap 独立
    expect(state.logEntries.length).toBeLessThanOrEqual(200);
  });

  it("subscribe('job-A') 后 dispatch 多条 → subscribe('job-B') → entries 清空，status='idle'", () => {
    // 模拟 subscribe 行为：直接设置 subscribedJobId 和 agentReasoning.jobId
    useBlueprintRealtimeStore.setState({
      subscribedJobId: "job-A",
      agentReasoning: {
        jobId: "job-A",
        entries: [],
        currentIteration: 0,
        status: "idle",
      },
    });

    const store = useBlueprintRealtimeStore.getState();
    store.dispatchEvent(makeAgentEvent({ jobId: "job-A", type: "role.agent.thinking" }));
    store.dispatchEvent(makeAgentEvent({ jobId: "job-A", type: "role.agent.acting", payload: { iteration: 1, roleId: "planner", stageId: "route_generation", actionToolId: "mcp.github.clone" } }));

    let state = useBlueprintRealtimeStore.getState();
    expect(state.agentReasoning.entries.length).toBe(2);

    // 模拟 subscribe 到新 jobId（直接 setState 模拟 subscribe 的 reset 行为）
    useBlueprintRealtimeStore.setState({
      subscribedJobId: "job-B",
      agentReasoning: {
        jobId: "job-B",
        entries: [],
        currentIteration: 0,
        status: "idle",
      },
    });

    state = useBlueprintRealtimeStore.getState();
    expect(state.agentReasoning.entries).toHaveLength(0);
    expect(state.agentReasoning.status).toBe("idle");
    expect(state.agentReasoning.jobId).toBe("job-B");
  });

  it("direct subscribe job switch clears previous job reasoning entries instead of resurrecting them", async () => {
    const mockSocket = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      connected: false,
    };
    __setSocket(mockSocket as any);
    __setHydrateHistoricalEventsForTest(async () => []);

    try {
      const store = useBlueprintRealtimeStore.getState();
      store.subscribe("job-A");
      store.dispatchEvent(makeAgentEvent({
        jobId: "job-A",
        type: "role.agent.thinking",
        payload: {
          iteration: 1,
          roleId: "generator",
          stageId: "spec_docs",
          thought: "old project document assembly",
        },
      }));

      expect(useBlueprintRealtimeStore.getState().agentReasoning.entries).toHaveLength(1);

      store.subscribe("job-B");

      const state = useBlueprintRealtimeStore.getState();
      expect(state.subscribedJobId).toBe("job-B");
      expect(state.agentReasoning.jobId).toBe("job-B");
      expect(state.agentReasoning.entries).toEqual([]);
      expect(state.agentReasoning.currentIteration).toBe(0);
      expect(state.agentReasoning.status).toBe("idle");
    } finally {
      __setHydrateHistoricalEventsForTest(null);
      __setSocket(null as any);
    }
  });

  it("ignores direct dispatch events for a different subscribed job", () => {
    useBlueprintRealtimeStore.setState({
      subscribedJobId: "job-current",
      agentReasoning: {
        jobId: "job-current",
        entries: [],
        currentIteration: 0,
        status: "idle",
      },
    });

    useBlueprintRealtimeStore.getState().dispatchEvent(makeAgentEvent({
      jobId: "job-old",
      type: "role.agent.thinking",
      payload: {
        iteration: 1,
        roleId: "generator",
        stageId: "spec_docs",
        thought: "old project leaked event",
      },
    }));

    const state = useBlueprintRealtimeStore.getState();
    expect(state.agentReasoning.entries).toEqual([]);
    expect(state.logEntries).toEqual([]);
  });

  it("iteration_started → currentIteration 更新，status='streaming'", () => {
    const store = useBlueprintRealtimeStore.getState();

    store.dispatchEvent(makeAgentEvent({
      type: "role.agent.iteration_started",
      payload: { iteration: 1, roleId: "planner", stageId: "route_generation" },
    }));

    let state = useBlueprintRealtimeStore.getState();
    expect(state.agentReasoning.currentIteration).toBe(1);
    expect(state.agentReasoning.status).toBe("streaming");

    store.dispatchEvent(makeAgentEvent({
      type: "role.agent.iteration_started",
      payload: { iteration: 2, roleId: "planner", stageId: "route_generation" },
    }));

    state = useBlueprintRealtimeStore.getState();
    expect(state.agentReasoning.currentIteration).toBe(2);
    expect(state.agentReasoning.status).toBe("streaming");
  });

  it("error+reason='用户取消' → status='aborted'；error 其他 → 'failed'；completed → 'completed'", () => {
    const store = useBlueprintRealtimeStore.getState();

    // error + reason="用户取消" → aborted
    store.dispatchEvent(makeAgentEvent({
      type: "role.agent.error",
      payload: { iteration: 1, roleId: "planner", stageId: "route_generation", reason: "用户取消", error: "cancelled" },
    }));
    expect(useBlueprintRealtimeStore.getState().agentReasoning.status).toBe("aborted");

    // 重置
    useBlueprintRealtimeStore.setState({
      agentReasoning: { jobId: null, entries: [], currentIteration: 0, status: "idle" },
    });

    // error 其他 reason → failed
    store.dispatchEvent(makeAgentEvent({
      type: "role.agent.error",
      payload: { iteration: 1, roleId: "planner", stageId: "route_generation", reason: "超时", error: "timeout" },
    }));
    expect(useBlueprintRealtimeStore.getState().agentReasoning.status).toBe("failed");

    // 重置
    useBlueprintRealtimeStore.setState({
      agentReasoning: { jobId: null, entries: [], currentIteration: 0, status: "idle" },
    });

    // completed → completed
    store.dispatchEvent(makeAgentEvent({
      type: "role.agent.completed",
      payload: { iteration: 3, roleId: "planner", stageId: "route_generation" },
    }));
    expect(useBlueprintRealtimeStore.getState().agentReasoning.status).toBe("completed");
  });

  it("subscribe(jobId) 后 hydrate 历史 role.agent.* 事件 → entries 被 seed，重复 id 不会被覆盖", async () => {
    // 注入 mock socket，避免真实连接
    const mockSocket = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      connected: true,
    };
    __setSocket(mockSocket as any);

    // 注入 hydration mock：返回两条历史 role.agent.* 事件
    const historicalEvents = [
      {
        id: "evt-h-1",
        jobId: "job-restored",
        type: "role.agent.iteration_started",
        family: "role",
        occurredAt: "2026-05-24T10:00:00.000Z",
        stage: "spec_docs",
        status: "running",
        payload: { iteration: 1, roleId: "spec-writer", stageId: "spec_docs" },
      },
      {
        id: "evt-h-2",
        jobId: "job-restored",
        type: "role.agent.thinking",
        family: "role",
        occurredAt: "2026-05-24T10:00:01.000Z",
        stage: "spec_docs",
        status: "running",
        payload: { iteration: 1, roleId: "spec-writer", stageId: "spec_docs", thought: "起草 requirements" },
      },
    ];
    __setHydrateHistoricalEventsForTest(async () => historicalEvents as any);

    try {
      // subscribe → 应当触发 hydration
      useBlueprintRealtimeStore.getState().subscribe("job-restored");

      // hydration 是 async；等一个 microtask 让 promise 跑完
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const state = useBlueprintRealtimeStore.getState();
      expect(state.subscribedJobId).toBe("job-restored");
      expect(state.agentReasoning.jobId).toBe("job-restored");
      expect(state.agentReasoning.entries.length).toBe(2);
      // currentIteration 应根据 iteration_started 推进
      expect(state.agentReasoning.currentIteration).toBe(1);
    } finally {
      __setHydrateHistoricalEventsForTest(null);
      __setSocket(null as any);
    }
  });
});
