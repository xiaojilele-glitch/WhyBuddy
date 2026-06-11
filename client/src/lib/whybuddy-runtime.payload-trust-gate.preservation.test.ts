/**
 * R2-B7: Artifact.payload is additive — Trust Gate must not read it.
 */

import { describe, it, expect } from "vitest";
import { createInitialSessionState, commitArtifact } from "./whybuddy-runtime";
import type { V5CapabilityId } from "@shared/blueprint/contracts";

describe("commitArtifact payload preservation (R2-B7)", () => {
  const cap: V5CapabilityId = "critique.generate";

  function baseArtifact(id: string) {
    return {
      id,
      kind: "decision" as const,
      provenance: "llm" as const,
      producedBy: {
        capabilityRunId: `run-${id}`,
        capabilityId: cap,
        roleId: "挑刺",
      },
      title: "结构化质疑",
      summary: "summary",
      content: "质疑正文",
    };
  }

  it("trust gate outcome is identical with or without payload", () => {
    const state = createInitialSessionState("权限系统", "payload-gate");

    const without = commitArtifact(state, baseArtifact("a-plain"), "run-plain", false, []);
    const withPayload = commitArtifact(
      state,
      {
        ...baseArtifact("a-payload"),
        payload: [
          {
            id: "crit-1",
            challengerRoleId: "auditor",
            targetRoleId: "architect",
            targetClaim: "RBAC 足够",
            critique: "缺租户隔离",
            severity: "high",
            roundNumber: 1,
            resolved: false,
          },
        ],
      },
      "run-payload",
      false,
      []
    );

    expect(without.committed?.trustLevel).toBe(withPayload.committed?.trustLevel);
    expect(without.committed?.passedGates).toEqual(withPayload.committed?.passedGates);
    expect(withPayload.committed?.payload).toBeDefined();
    expect(Array.isArray(withPayload.committed?.payload)).toBe(true);
  });

  it("force-fail gate behavior is identical with payload present", () => {
    const state = createInitialSessionState("权限系统", "payload-fail");

    const r1 = commitArtifact(state, baseArtifact("f1"), "run-f1", true, []);
    const r2 = commitArtifact(
      state,
      { ...baseArtifact("f2"), payload: { synthesis: { decision: "x" } } },
      "run-f2",
      true,
      []
    );

    expect(r1.committed).toBeNull();
    expect(r2.committed).toBeNull();
    expect(r1.run.gateResults).toEqual(r2.run.gateResults);

    const a1 = r1.updatedState.artifacts.find((a) => a.id === "f1");
    const a2 = r2.updatedState.artifacts.find((a) => a.id === "f2");
    expect(a1?.trustLevel).toBe("untrusted");
    expect(a2?.trustLevel).toBe("untrusted");
    expect(a1?.passedGates).toEqual(a2?.passedGates);
    expect(a2?.payload).toEqual({ synthesis: { decision: "x" } });
  });
});