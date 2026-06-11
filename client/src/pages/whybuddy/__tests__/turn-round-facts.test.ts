import { describe, it, expect } from "vitest";
import { buildTurnRoundsFromDrive } from "../turn-round-facts";

describe("buildTurnRoundsFromDrive (task 7.2)", () => {
  it("returns undefined for single-loop drive", () => {
    expect(
      buildTurnRoundsFromDrive([], {
        loops: [
          {
            loopTurnId: "t-loop-0",
            plan: { selected: [{ capabilityId: "risk.analyze", roleId: "安全", inputArtifactIds: [] }], reason: "pick", expectedArtifacts: [] },
            committedArtifactIds: ["a1"],
          },
        ],
        stopReason: "budget_exhausted",
      })
    ).toBeUndefined();
  });

  it("maps each loop to TurnRoundFacts with dledger + parkReason", () => {
    const rounds = buildTurnRoundsFromDrive(
      [
        {
          id: "t-loop-0-dledger",
          turnId: "t-loop-0",
          saw: [],
          chose: ["risk.analyze"],
          skipped: [],
          addresses: [],
          rationale: "r0",
          alternativesRejected: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          source: "llm",
        },
        {
          id: "t-loop-1-dledger",
          turnId: "t-loop-1",
          saw: [],
          chose: [],
          skipped: [],
          addresses: [],
          rationale: "r1",
          alternativesRejected: [],
          createdAt: "2026-01-01T00:00:01.000Z",
          source: "llm",
        },
      ],
      {
        loops: [
          {
            loopTurnId: "t-loop-0",
            plan: { selected: [{ capabilityId: "risk.analyze", roleId: "安全", inputArtifactIds: [] }], reason: "pick", expectedArtifacts: [] },
            committedArtifactIds: ["a1"],
          },
          {
            loopTurnId: "t-loop-1",
            plan: { selected: [], reason: "CONVERGENCE_SIGNAL", expectedArtifacts: [] },
            committedArtifactIds: [],
            stopSignal: "convergence_signal",
          },
        ],
        stopReason: "convergence_signal",
      }
    );

    expect(rounds).toHaveLength(2);
    expect(rounds![0].roundIndex).toBe(1);
    expect(rounds![0].planSource).toBe("llm");
    expect(rounds![1].parkReason).toBe("convergence_signal");
  });
});