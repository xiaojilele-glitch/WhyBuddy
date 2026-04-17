import { describe, expect, it } from "vitest";

import {
  buildMissionFlowSteps,
  resolveMissionFlowCurrentStep,
} from "../mission-flow-pane-helpers";

describe("mission flow pane helpers", () => {
  it("maps planning-related stages into the plan step", () => {
    expect(
      resolveMissionFlowCurrentStep({
        currentStageKey: "understand",
        status: "running",
      })
    ).toBe("plan");

    expect(
      resolveMissionFlowCurrentStep({
        currentStageKey: "provision",
        status: "running",
      })
    ).toBe("plan");
  });

  it("maps execution and review related stages into the expected buckets", () => {
    expect(
      resolveMissionFlowCurrentStep({
        currentStageKey: "execute",
        status: "running",
      })
    ).toBe("execute");

    expect(
      resolveMissionFlowCurrentStep({
        currentStageKey: "finalize",
        status: "waiting",
      })
    ).toBe("review");
  });

  it("builds active, completed, and pending steps for a running mission", () => {
    expect(
      buildMissionFlowSteps({
        currentStageKey: "execute",
        status: "running",
      })
    ).toEqual([
      { key: "plan", state: "completed" },
      { key: "execute", state: "active" },
      { key: "review", state: "pending" },
    ]);
  });

  it("marks the current step as failed when the mission fails", () => {
    expect(
      buildMissionFlowSteps({
        currentStageKey: "execute",
        status: "failed",
      })
    ).toEqual([
      { key: "plan", state: "completed" },
      { key: "execute", state: "failed" },
      { key: "review", state: "pending" },
    ]);
  });

  it("marks every step as completed for terminal success states", () => {
    expect(
      buildMissionFlowSteps({
        currentStageKey: "finalize",
        status: "done",
      })
    ).toEqual([
      { key: "plan", state: "completed" },
      { key: "execute", state: "completed" },
      { key: "review", state: "completed" },
    ]);
  });
});
