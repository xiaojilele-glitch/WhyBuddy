/**
 * WhyBuddy V5.1 Full-Path — S11 G_READY readiness chain.
 * Spec: docs/V5.1-full-path-test-plan.md (§2 S11; edges 53–56).
 */

import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  intakeMessage,
  driveReasoningSession,
  createDeterministicRouter,
  createDeterministicCapabilityExecutor,
  pickNextCapabilities,
  commitArtifact,
} from "./whybuddy-runtime";
import { createRawArtifact } from "./whybuddy-fullpath-fixtures";
import { gapsFromGapAskContent } from "@shared/blueprint/whybuddy-readiness-chain";
import { userClearsReadiness } from "@shared/blueprint/whybuddy-interactive-gates";

describe("S11 · G_READY readiness chain", () => {
  it("C_GAP→C_QEXP: vague cold start routes to gap.ask then question.expand", () => {
    const s = createInitialSessionState("做一个系统", "S11-pick");
    const picks = pickNextCapabilities(s, "做一个系统");
    expect(picks[0]?.capabilityId).toBe("gap.ask");
    expect(picks.some((p) => p.capabilityId === "question.expand")).toBe(true);
  });

  it("G_READY→AWAIT: parks after question.expand without LLM auto-confirm", async () => {
    const s = createInitialSessionState("做一个系统", "S11-park");
    const { preparedState } = intakeMessage(s, { turnId: "S11-t0", userText: "做一个系统" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "S11-t0",
      userText: "做一个系统",
      router: createDeterministicRouter([
        {
          selected: [
            { capabilityId: "gap.ask", roleId: "规划" },
            { capabilityId: "question.expand", roleId: "规划" },
          ],
          rationale: "readiness chain",
          source: "llm",
        },
      ]),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 1,
    });

    expect(result.stopReason).toBe("await_ready");
    expect(result.finalState.awaitReason).toBe("ready");
    expect(result.finalState.runtimePhase).toBe("awaiting");
    expect(
      (result.finalState.conversation || []).some((c) => /\[G_READY\]/.test(c.text || ""))
    ).toBe(true);
    const autoConfirm = (result.finalState.capabilityRuns || []).filter((r) =>
      /confirm|ready_pass/i.test(r.capabilityId)
    );
    expect(autoConfirm).toHaveLength(0);
  });

  it("G_READY→C_GAP: gap.ask materializes open_question gaps for回补", () => {
    let s = createInitialSessionState("做一个系统", "S11-gap");
    const gaps = gapsFromGapAskContent("- 面向谁使用？\n- 成功标准是什么？", "S11-g", "art-gap");
    const { updatedState } = commitArtifact(
      s,
      createRawArtifact("art-gap", "gap.ask", "规划", "decision", "- 面向谁使用？\n- 成功标准是什么？"),
      "S11-g-run",
      false,
      []
    );
    s = {
      ...updatedState,
      coverageGaps: [...(updatedState.coverageGaps || []), ...gaps],
      coverageContract: {
        id: "c1",
        version: 1,
        requiredCapabilities: ["report.write"],
        blockingGapIds: gaps.map((g) => g.id),
        createdAt: new Date().toISOString(),
      },
    };
    expect(s.coverageGaps?.filter((g) => g.status === "open").length).toBeGreaterThanOrEqual(2);
  });

  it("AWAIT→INTAKE: user supplement clears ready gate and continues same session", async () => {
    const s = createInitialSessionState("做一个系统", "S11-resume");
    const parked = {
      ...s,
      awaitReason: "ready" as const,
      runtimePhase: "awaiting" as const,
      sessionId: "S11-resume",
    };
    const supplement = "面向企业内部，需要 RBAC 与数据范围隔离，部署在私有云";
    expect(userClearsReadiness(supplement, parked)).toBe(true);

    const { preparedState } = intakeMessage(parked, {
      turnId: "S11-t1",
      userText: supplement,
    });
    expect(preparedState.awaitReason).toBeUndefined();
    expect(preparedState.sessionId).toBe("S11-resume");
    expect((preparedState.conversation || []).length).toBeGreaterThan(
      (parked.conversation || []).length
    );
  });
});