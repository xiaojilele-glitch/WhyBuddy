import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  intakeMessage,
  orchestrateReasoningTurn,
  retrySingleCapability,
  type CapabilityExecutor,
} from "./whybuddy-runtime";

describe("retrySingleCapability", () => {
  it("re-executes a capability and commits a new artifact", async () => {
    let s = createInitialSessionState("分析权限风险", "sess-retry");
    const turnId = "turn-retry-1";
    const { preparedState, context } = intakeMessage(s, {
      turnId,
      userText: "分析权限风险",
    });
    const { newState, plan } = orchestrateReasoningTurn(preparedState, context);
    const pick = plan.selected[0];
    expect(pick).toBeDefined();

    const executor: CapabilityExecutor = {
      async executeCapability() {
        return {
          title: "重试产出",
          summary: "重试摘要",
          content: "重试后内容",
          provenance: "ai_generated",
        };
      },
    };

    const beforeArts = (newState.artifacts || []).length;
    const result = await retrySingleCapability(newState, {
      loopTurnId: turnId,
      capabilityId: pick.capabilityId,
      roleId: pick.roleId || "agent",
      runIndex: 0,
      executor,
    });

    expect(result.error).toBeUndefined();
    expect(result.committed).toBe(true);
    expect((result.state.artifacts || []).length).toBeGreaterThan(beforeArts);
  });

  it("returns error without mutating state when executor throws", async () => {
    let s = createInitialSessionState("测试失败重试", "sess-retry-fail");
    const turnId = "turn-retry-fail";
    const { preparedState, context } = intakeMessage(s, {
      turnId,
      userText: "测试",
    });
    const { newState, plan } = orchestrateReasoningTurn(preparedState, context);
    const pick = plan.selected[0];

    const executor: CapabilityExecutor = {
      async executeCapability() {
        throw new Error("simulated failure");
      },
    };

    const beforeArts = (newState.artifacts || []).length;
    const result = await retrySingleCapability(newState, {
      loopTurnId: turnId,
      capabilityId: pick.capabilityId,
      roleId: pick.roleId || "agent",
      runIndex: 0,
      executor,
    });

    expect(result.committed).toBe(false);
    expect(result.error).toContain("simulated failure");
    expect((result.state.artifacts || []).length).toBe(beforeArts);
  });
});