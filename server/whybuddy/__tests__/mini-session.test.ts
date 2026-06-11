import { describe, it, expect } from "vitest";
import {
  buildMiniSession,
  buildStageContext,
  extractUpstreamClaim,
} from "../mini-session.js";

describe("mini-session (R2)", () => {
  it("extractUpstreamClaim prefers trusted route_options artifacts", () => {
    const state = {
      sessionId: "s1",
      goal: { text: "goal" },
      artifacts: [
        {
          id: "r1",
          kind: "route_options",
          trustLevel: "gated_pass",
          content: "路线 A：RBAC + scoped filter",
        },
        {
          id: "e1",
          kind: "evidence",
          trustLevel: "gated_pass",
          content: "ignored kind",
        },
      ],
    } as any;

    expect(extractUpstreamClaim(state, ["e1", "r1"])).toContain("RBAC");
  });

  it("buildMiniSession creates two-member crew", () => {
    const session = buildMiniSession({
      turnId: "t1",
      challengerRole: "auditor",
      targetRole: "architect",
      stageContext: "ctx",
    });
    expect(session.crewMembers.has("auditor")).toBe(true);
    expect(session.crewMembers.has("architect")).toBe(true);
    expect(session.status).toBe("active");
  });

  it("buildStageContext includes goal and claim", () => {
    const ctx = buildStageContext("权限", "主张 X");
    expect(ctx).toContain("权限");
    expect(ctx).toContain("主张 X");
  });
});