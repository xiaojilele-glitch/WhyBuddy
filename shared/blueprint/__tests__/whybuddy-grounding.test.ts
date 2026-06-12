import { describe, it, expect } from "vitest";
import {
  isGroundedEvidenceArtifact,
  hasGroundedExternalEvidence,
  evaluateGroundingForCommit,
  EVIDENCE_SOURCE_F1_GITHUB,
  EVIDENCE_SOURCE_WEB_SEARCH,
} from "../whybuddy-grounding.js";
import type { V5SessionState } from "../v5-reasoning-state.js";

describe("whybuddy-grounding G-GROUND", () => {
  it("treats in-session evidence as ungrounded", () => {
    expect(
      isGroundedEvidenceArtifact({
        kind: "evidence",
        provenance: "ai_generated",
        producedBy: { capabilityId: "evidence.search" },
        summary: "【来源: 会话内综合】",
      })
    ).toBe(false);
  });

  it("treats F2 web search evidence as grounded", () => {
    expect(
      isGroundedEvidenceArtifact({
        kind: "evidence",
        provenance: "web:search",
        producedBy: { capabilityId: "evidence.search" },
        summary: `【来源: ${EVIDENCE_SOURCE_WEB_SEARCH}】`,
      })
    ).toBe(true);
  });

  it("treats F1 GitHub evidence as grounded", () => {
    expect(
      isGroundedEvidenceArtifact({
        kind: "evidence",
        provenance: "mcp:github",
        producedBy: { capabilityId: "evidence.search" },
        summary: `【来源: ${EVIDENCE_SOURCE_F1_GITHUB}】`,
      })
    ).toBe(true);
  });

  it("report.write commit requires session grounded evidence", () => {
    const empty: V5SessionState = {
      goal: { text: "test", status: "needs_refinement" },
      graph: { id: "g", nodes: [], edges: [], source: "runtime" },
      artifacts: [],
      conversation: [],
      capabilityRuns: [],
      gates: [],
      dependencyGraph: [],
      staleArtifactIds: [],
    } as V5SessionState;
    expect(
      evaluateGroundingForCommit({
        capabilityId: "report.write",
        artifact: { kind: "report" },
        state: empty,
      })
    ).toBe(false);

    const grounded: V5SessionState = {
      ...empty,
      artifacts: [
        {
          id: "ev-1",
          kind: "evidence",
          provenance: "mcp:github",
          trustLevel: "gated_pass",
          producedBy: { capabilityId: "evidence.search", capabilityRunId: "r1" },
          content: "x",
        } as any,
      ],
    };
    expect(hasGroundedExternalEvidence(grounded)).toBe(true);
    expect(
      evaluateGroundingForCommit({
        capabilityId: "report.write",
        artifact: { kind: "report" },
        state: grounded,
      })
    ).toBe(true);
  });
});