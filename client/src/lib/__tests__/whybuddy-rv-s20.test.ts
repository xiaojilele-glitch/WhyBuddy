import { describe, it, expect } from "vitest";
import { intakeMessage, invalidateForIntervention } from "../whybuddy-runtime";
import {
  buildClearStateWithTrustedReport,
  buildClearStateWithPreview,
  recycleSignature,
} from "../whybuddy-fullpath-fixtures";

describe("S20 · RV review pass/reject + ITER recycle parity", () => {
  it("RV reject recycle signature matches chat challenge on report (P2 parity)", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("s20-rv-reject");

    const { preparedState: viaChallenge, controlSignal: challengeSignal } = intakeMessage(
      structuredClone(state),
      {
        turnId: "s20-ch",
        userText: "质疑报告",
        intervention: {
          targetArtifactId: reportId,
          intent: "challenge",
          text: "质疑报告",
        },
      }
    );

    const { preparedState: viaRv, controlSignal: rvSignal } = intakeMessage(structuredClone(state), {
      turnId: "s20-rv",
      userText: "评审打回，退回修改",
    });

    expect(recycleSignature(viaRv)).toBe(recycleSignature(viaChallenge));
    expect(viaRv.goal.status).toBe("needs_refinement");
    expect(rvSignal).toBe(challengeSignal);
  });

  it("RV pass sets runtimePhase done and deliveryPhase shipped", () => {
    const { state } = buildClearStateWithTrustedReport("s20-rv-pass");
    const { preparedState } = intakeMessage(state, {
      turnId: "s20-pass",
      userText: "评审通过，可以交付",
    });
    expect(preparedState.runtimePhase).toBe("done");
    expect(preparedState.deliveryPhase).toBe("shipped");
  });

  it("RV pass blocked without trusted report keeps awaiting phase", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("s20-rv-blocked");
    const noReport = {
      ...state,
      artifacts: (state.artifacts || []).filter((a) => a.id !== reportId),
    };
    const { preparedState } = intakeMessage(noReport, {
      turnId: "s20-block",
      userText: "评审通过，可以交付",
    });
    expect(preparedState.runtimePhase).not.toBe("done");
    expect(preparedState.deliveryPhase).not.toBe("shipped");
  });

  it("ITER preview dissatisfaction matches revise intervention recycle signature", () => {
    const { state, previewId } = buildClearStateWithPreview("s20-iter");

    const { preparedState: viaRevise } = intakeMessage(structuredClone(state), {
      turnId: "s20-rev",
      userText: "预演不行",
      intervention: {
        targetArtifactId: previewId,
        intent: "revise",
        text: "预演不行",
      },
    });

    const { preparedState: viaIter } = intakeMessage(structuredClone(state), {
      turnId: "s20-iter",
      userText: "效果不满意，重新预演",
    });

    expect(recycleSignature(viaIter)).toBe(recycleSignature(viaRevise));
    expect(viaIter.staleArtifactIds).toContain(previewId);
  });

  it("invalidate-only parity: RV target equals direct challenge on report", () => {
    const { state, reportId } = buildClearStateWithTrustedReport("s20-inv");
    const viaChallenge = invalidateForIntervention(state, {
      targetArtifactId: reportId,
      intent: "challenge",
      text: "质疑",
    });
    const viaRvEquivalent = invalidateForIntervention(state, {
      targetArtifactId: reportId,
      intent: "challenge",
      text: "评审打回",
    });
    expect(JSON.stringify(viaRvEquivalent)).toBe(JSON.stringify(viaChallenge));
  });
});