import { describe, it, expect } from "vitest";
import {
  createInitialSessionState,
  commitArtifact,
  orchestrateReasoningTurn,
  intakeMessage,
  evaluateCoverageGate,
  authorCoverageContract,
  resolveCoverageGapsFromState,
} from "./whybuddy-runtime";
import type { Artifact, V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { EVIDENCE_SOURCE_F1_GITHUB } from "@shared/blueprint/whybuddy-grounding";

function commitEvidence(
  state: V5SessionState,
  opts: { grounded?: boolean; runId?: string; id?: string }
): V5SessionState {
  const runId = opts.runId || "t-ev-run-0";
  const id = opts.id || "ev-art-0";
  const grounded = opts.grounded ?? false;
  const { updatedState } = commitArtifact(
    state,
    {
      id,
      kind: "evidence",
      provenance: grounded ? "mcp:github" : "ai_generated",
      producedBy: {
        capabilityRunId: runId,
        capabilityId: "evidence.search",
        roleId: "接地",
      },
      content: grounded
        ? `【来源: ${EVIDENCE_SOURCE_F1_GITHUB}】外部证据`
        : "【来源: 会话内综合】无外部证据",
      summary: grounded ? `【来源: ${EVIDENCE_SOURCE_F1_GITHUB}】` : "会话内",
      payload: grounded
        ? { evidenceSource: EVIDENCE_SOURCE_F1_GITHUB }
        : { evidenceSource: "会话内综合" },
    } as Omit<Artifact, "trustLevel" | "passedGates">,
    runId,
    false,
    []
  );
  return updatedState;
}

describe("G-GROUND integration", () => {
  it("in-session evidence.search commits as untrusted (G-GROUND fail)", () => {
    let s = createInitialSessionState("路线对比分析", "g-in-session");
    s = commitEvidence(s, { grounded: false });
    const art = s.artifacts?.find((a) => a.id === "ev-art-0");
    expect(art?.trustLevel).toBe("untrusted");
    const run = s.capabilityRuns?.find((r) => r.id === "t-ev-run-0");
    expect(run?.gateResults?.find((g) => g.gateId === "ground")?.status).toBe("failed");
    expect(s.conversation?.some((c) => c.text?.includes("[G-GROUND]"))).toBe(true);
  });

  it("GCOV does not pass clear without grounded evidence", () => {
    let s = createInitialSessionState("路线对比分析", "g-gcov");
    const { contract, gaps } = authorCoverageContract(s.goal.text, "auth");
    s = { ...s, coverageContract: contract, coverageGaps: gaps };
    s = commitEvidence(s, { grounded: false, id: "ev-bad", runId: "t-bad-0" });

    const gate = evaluateCoverageGate(
      s,
      [{ capabilityId: "report.write", roleId: "综合" }],
      contract
    );
    expect(gate.passed).toBe(false);

    const turnId = "turn-no-clear";
    const { preparedState, context } = intakeMessage(s, { turnId, userText: "出报告" });
    const { newState } = orchestrateReasoningTurn(preparedState, context);
    expect(newState.goal.status).not.toBe("clear");
  });

  it("grounded evidence allows GCOV pass path when other pre-reqs met", () => {
    let s = createInitialSessionState("路线对比分析", "g-ok");
    const { contract, gaps } = authorCoverageContract(s.goal.text, "auth2");
    s = { ...s, coverageContract: contract, coverageGaps: gaps };
    s = commitEvidence(s, { grounded: true, id: "ev-good", runId: "t-good-0" });
    s = resolveCoverageGapsFromState(s);

    const gate = evaluateCoverageGate(
      s,
      [{ capabilityId: "report.write", roleId: "综合" }],
      s.coverageContract
    );
    expect(gate.passed).toBe(true);
  });
});