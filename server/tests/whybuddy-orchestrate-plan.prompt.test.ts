import { describe, it, expect } from "vitest";
import { buildOrchestrateUserPrompt } from "../whybuddy/orchestrate-plan.js";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";

describe("buildOrchestrateUserPrompt compression (task 2.4 / Property 29 smoke)", () => {
  const SECRET_CONTENT =
    "FULL_ARTIFACT_BODY_SHOULD_NEVER_APPEAR_IN_ROUTER_PROMPT_" + "x".repeat(500);

  it("does not embed full artifact content — only id/kind/summary style fields", () => {
    const state: V5SessionState = {
      sessionId: "s-prompt",
      goal: { text: "权限系统", status: "needs_refinement" },
      artifacts: [
        {
          id: "art-secret",
          kind: "decision",
          trustLevel: "gated_pass",
          content: SECRET_CONTENT,
          summary: "short summary only",
          producedBy: { capabilityId: "risk.analyze", turnId: "t0" },
        } as any,
      ],
      staleArtifactIds: [],
      decisionLedger: [],
      capabilityRuns: [],
      coverageContract: {
        mode: "standard",
        requiredCapabilities: ["risk.analyze", "report.write"],
        conditionalCapabilities: ["evidence.search"],
        blockingGapIds: [],
        minEvidencePerRequirement: 1,
      } as any,
    };

    const prompt = buildOrchestrateUserPrompt({
      state,
      turnId: "t-prompt",
      userText: "继续分析",
    });

    expect(prompt).not.toContain(SECRET_CONTENT);
    expect(prompt).toContain("COVERAGE_CONTRACT");
    expect(prompt).toContain("risk.analyze");
    expect(prompt).toContain("report.write");
    expect(prompt).toContain("HEALTHY_ARTIFACT_KINDS");
  });
});