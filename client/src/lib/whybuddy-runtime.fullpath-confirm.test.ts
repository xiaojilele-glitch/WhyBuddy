/**
 * WhyBuddy V5.1 Full-Path — S12 G_CONFIRM route confirmation chain.
 * Spec: docs/V5.1-full-path-test-plan.md (§2 S12; edges 57–60).
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
import { createRawArtifact, markTrusted } from "./whybuddy-fullpath-fixtures";
import { userPicksRoute, userRejectsRouteSelection } from "@shared/blueprint/whybuddy-interactive-gates";

function seedComparedRoutes(sessionId: string) {
  let s = createInitialSessionState("路线对比一下", sessionId);
  const { updatedState: withGen } = commitArtifact(
    s,
    createRawArtifact(`${sessionId}-rg`, "route.generate", "架构", "route_options", "方案 A: 渐进"),
    `${sessionId}-rg-run`,
    false,
    []
  );
  markTrusted(withGen, `${sessionId}-rg`);
  const { updatedState: withCmp } = commitArtifact(
    withGen,
    createRawArtifact(`${sessionId}-rc`, "route.compare", "工程", "route_options", "对比: A vs B"),
    `${sessionId}-rc-run`,
    false,
    []
  );
  markTrusted(withCmp, `${sessionId}-rc`);
  return withCmp;
}

describe("S12 · G_CONFIRM route confirmation", () => {
  it("C_RTGEN→C_RTCMP: route intent picks generate then compare", () => {
    const picks = pickNextCapabilities(createInitialSessionState("路线对比一下", "S12-pick"), "路线对比一下");
    expect(picks.some((p) => p.capabilityId === "route.generate")).toBe(true);
    expect(picks.some((p) => p.capabilityId === "route.compare")).toBe(true);
  });

  it("G_CONFIRM→AWAIT: parks after route.compare until user selects", async () => {
    const s = createInitialSessionState("路线对比一下", "S12-park");
    const { preparedState } = intakeMessage(s, { turnId: "S12-t0", userText: "路线对比一下" });

    const result = await driveReasoningSession(preparedState, {
      turnSeedId: "S12-t0",
      userText: "路线对比一下",
      router: createDeterministicRouter([
        {
          selected: [
            { capabilityId: "route.generate", roleId: "架构" },
            { capabilityId: "route.compare", roleId: "工程" },
          ],
          rationale: "route chain",
          source: "llm",
        },
      ]),
      executor: createDeterministicCapabilityExecutor(),
      maxLoopsPerMessage: 1,
    });

    expect(result.stopReason).toBe("await_confirm");
    expect(result.finalState.awaitReason).toBe("confirm");
    expect(
      (result.finalState.conversation || []).some((c) => /\[G_CONFIRM\]/.test(c.text || ""))
    ).toBe(true);
  });

  it("G_CONFIRM clears when user picks a route (no LLM代选)", () => {
    const parked = {
      ...seedComparedRoutes("S12-pick-route"),
      awaitReason: "confirm" as const,
      runtimePhase: "awaiting" as const,
    };
    const text = "选方案 B，先做渐进交付";
    expect(userPicksRoute(text)).toBe(true);
    const { preparedState } = intakeMessage(parked, { turnId: "S12-t1", userText: text });
    expect(preparedState.awaitReason).toBeUndefined();
  });

  it("G_CONFIRM→C_RTCMP: reject stales route_options for re-compare", () => {
    const parked = {
      ...seedComparedRoutes("S12-reject"),
      awaitReason: "confirm" as const,
      runtimePhase: "awaiting" as const,
    };
    const text = "都不行，重新对比路线";
    expect(userRejectsRouteSelection(text)).toBe(true);
    const { preparedState } = intakeMessage(parked, { turnId: "S12-t2", userText: text });
    expect(preparedState.awaitReason).toBeUndefined();
    expect(preparedState.staleArtifactIds).toContain("S12-reject-rg");
    expect(preparedState.staleArtifactIds).toContain("S12-reject-rc");
    const picks = pickNextCapabilities(preparedState, text);
    expect(picks.some((p) => p.capabilityId === "route.compare")).toBe(true);
  });
});