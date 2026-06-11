/**
 * Epic 9 baseline preservation — client-side property tests (tasks 9.4–9.11).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createInitialSessionState,
  commitArtifact,
  findInputsForCapability,
  simulateCapabilityExecution,
  orchestrateReasoningTurn,
  intakeMessage,
  invalidateForIntervention,
  getDecisionLedger,
} from "../whybuddy-runtime";
import { buildStructuredReport } from "@shared/blueprint/whybuddy-report-builder";
import { ALL_V5_CAPABILITIES } from "@shared/blueprint/contracts";

const PBT_OPTS = { numRuns: 100 };

const REPORT_SECTIONS = [
  "结论：",
  "支撑证据：",
  "反证/挑战：",
  "风险：",
  "分歧：",
  "收敛决策：",
  "未解缺口：",
  "下一步工程化分支：",
  "provenance / upstream refs：",
] as const;

function trustedArtifact(
  id: string,
  kind: string,
  cap: string,
  content: string
) {
  return {
    id,
    kind,
    trustLevel: "gated_pass" as const,
    content,
    summary: content.slice(0, 80),
    producedBy: { capabilityId: cap, capabilityRunId: `run-${id}`, roleId: "角色" },
  };
}

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 20: LLM 能力产物 provenance 为 llm
 * Validates: Requirements 5.3, 6.3, 7.3, 10.1
 */
describe("Property 20: LLM capability artifacts use llm provenance", () => {
  it("committed artifacts with llm provenance stay llm (not template)", () => {
    fc.assert(
      fc.property(fc.constantFrom("risk.analyze", "evidence.search", "counter.argue"), (cap) => {
        let s = createInitialSessionState("prov", "s-p20");
        const { updatedState, committed } = commitArtifact(
          s,
          {
            id: "art-llm",
            kind: "decision",
            provenance: "llm",
            producedBy: { capabilityId: cap, roleId: "安全" },
            content: "LLM 产出内容",
          } as any,
          "t-p20-run",
          false,
          []
        );
        const art = (updatedState.artifacts || []).find((a) => a.id === "art-llm");
        expect(art?.provenance).toBe("llm");
        expect(art?.provenance).not.toBe("template");
        if (committed) expect(committed.provenance).toBe("llm");
      }),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 21: 上游依赖正确解析并完整纳入
 * Validates: Requirements 6.2, 7.2, 10.2
 */
describe("Property 21: findInputsForCapability resolves existing artifacts", () => {
  it("every resolved input id exists in state.artifacts", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_V5_CAPABILITIES.filter((c) => c === "synthesis.merge" || c === "report.write")),
        (cap) => {
          let s = createInitialSessionState("deps", "s-p21");
          s = {
            ...s,
            artifacts: [
              trustedArtifact("risk-1", "risk", "risk.analyze", "风险：越权"),
              trustedArtifact("ev-1", "evidence", "evidence.search", "证据：会话内"),
              trustedArtifact("syn-1", "synthesis", "synthesis.merge", "综合结论"),
            ] as any,
          };
          const inputs = findInputsForCapability(s, cap);
          for (const id of inputs) {
            expect(s.artifacts.some((a) => a.id === id)).toBe(true);
          }
        }
      ),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 22: LLM 产物不绕过信任闸
 * Validates: Requirements 5.3, 6.3, 7.3, 10.3
 */
describe("Property 22: trust gate governs trustLevel", () => {
  it("force-failed commit is not gated_pass or audited", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4, maxLength: 40 }), (content) => {
        let s = createInitialSessionState("gate", "s-p22");
        const { updatedState, committed } = commitArtifact(
          s,
          {
            id: "art-fail",
            kind: "decision",
            provenance: "llm",
            producedBy: { capabilityId: "risk.analyze", roleId: "安全" },
            content,
          } as any,
          "t-p22-run",
          true,
          []
        );
        expect(committed).toBeNull();
        const art = (updatedState.artifacts || []).find((a) => a.id === "art-fail");
        if (art) {
          expect(art.trustLevel).not.toBe("gated_pass");
          expect(art.trustLevel).not.toBe("audited");
        }
      }),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 23: stale 上游被标注
 * Validates: Requirements 10.4
 */
describe("Property 23: stale upstream annotation", () => {
  it("simulated risk output mentions stale when session has stale artifacts", () => {
    fc.assert(
      fc.property(fc.uuid(), (staleId) => {
        let s = createInitialSessionState("stale", "s-p23");
        s = {
          ...s,
          staleArtifactIds: [staleId],
          artifacts: [trustedArtifact(staleId, "risk", "risk.analyze", "旧风险")] as any,
        };
        const sim = simulateCapabilityExecution("risk.analyze", s, [staleId]);
        expect(sim.content).toMatch(/stale/i);
      }),
      PBT_OPTS
    );
  });

  it("no stale annotation when session has no stale ids", () => {
    const s = createInitialSessionState("clean", "s-p23b");
    const sim = simulateCapabilityExecution("risk.analyze", s, []);
    expect(sim.content).not.toMatch(/含stale/);
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 24: 报告九段式结构完整
 * Validates: Requirements 7.1
 */
describe("Property 24: nine-section report structure", () => {
  it("buildStructuredReport contains all section labels", () => {
    fc.assert(
      fc.property(fc.boolean(), (withStale) => {
        let s = createInitialSessionState("报告", "s-p24");
        const arts = [
          trustedArtifact("risk-r", "risk", "risk.analyze", "风险：越权"),
          trustedArtifact("syn-r", "synthesis", "synthesis.merge", "综合：推进"),
        ];
        s = {
          ...s,
          artifacts: arts as any,
          staleArtifactIds: withStale ? ["risk-r"] : [],
        };
        const report = buildStructuredReport({
          state: s,
          inputArtifactIds: arts.map((a) => a.id),
        });
        for (const section of REPORT_SECTIONS) {
          expect(report.content).toContain(section);
        }
      }),
      PBT_OPTS
    );
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 30: LLM 路由 DLEDGER 记录完整
 * Validates: Requirements 12.1
 */
describe("Property 30: LLM route DLEDGER completeness", () => {
  it("orchestrate with llm proposedPlan records full scheduling decision", () => {
    let s = createInitialSessionState("dledger", "s-p30");
    const { preparedState, context } = intakeMessage(s, { turnId: "t30", userText: "分析" });
    const { newState } = orchestrateReasoningTurn(preparedState, {
      ...context,
      proposedPlan: {
        selected: [{ capabilityId: "risk.analyze", roleId: "安全" }],
        rationale: "LLM 路由选择风险分析",
        source: "llm",
      },
    });
    const dec = getDecisionLedger(newState).find((d) => d.turnId === "t30");
    expect(dec?.source).toBe("llm");
    expect(Array.isArray(dec?.saw)).toBe(true);
    expect(Array.isArray(dec?.chose)).toBe(true);
    expect(Array.isArray(dec?.skipped)).toBe(true);
    expect(Array.isArray(dec?.addresses)).toBe(true);
    expect(typeof dec?.rationale).toBe("string");
    expect(Array.isArray(dec?.alternativesRejected)).toBe(true);
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 31: 降级时 DLEDGER 记录来源与原因
 * Validates: Requirements 12.2
 */
describe("Property 31: heuristic fallback DLEDGER", () => {
  it("orchestrate without proposedPlan uses local_heuristic with rationale", () => {
    let s = createInitialSessionState("fallback", "s-p31");
    const { preparedState, context } = intakeMessage(s, {
      turnId: "t31",
      userText: "对比一下方案的运维成本",
    });
    const { newState } = orchestrateReasoningTurn(preparedState, context);
    const dec = getDecisionLedger(newState).find((d) => d.turnId === "t31");
    expect(dec?.source).toBe("local_heuristic");
    expect(dec?.rationale?.length).toBeGreaterThan(0);
  });
});

/**
 * Feature: whybuddy-llm-autonomous-reasoning, Property 32: 路由决策可被 challenge 重排程
 * Validates: Requirements 12.3
 */
describe("Property 32: challenge marks decision and triggers stale cascade", () => {
  it("targetDecisionId challenge marks ledger entry challenged", () => {
    fc.assert(
      fc.property(fc.uuid(), (decisionId) => {
        let s = createInitialSessionState("challenge", "s-p32");
        s = {
          ...s,
          decisionLedger: [
            {
              id: decisionId,
              turnId: "t0",
              saw: ["risk.analyze"],
              chose: ["risk.analyze"],
              skipped: [],
              addresses: [],
              rationale: "prior route",
              alternativesRejected: [],
              createdAt: new Date().toISOString(),
              source: "llm",
            } as any,
          ],
        };
        const next = invalidateForIntervention(s, {
          intent: "challenge",
          targetDecisionId: decisionId,
          text: "质疑路由",
        });
        const entry = (next.decisionLedger || []).find((d: any) => d.id === decisionId);
        expect(entry?.status).toBe("challenged");
      }),
      PBT_OPTS
    );
  });

  it("targetArtifactId challenge cascades stale artifacts", () => {
    let s = createInitialSessionState("challenge-stale", "s-p32b");
    s = {
      ...s,
      artifacts: [trustedArtifact("rep-c", "report", "report.write", "报告结论")] as any,
    };
    const next = invalidateForIntervention(s, {
      intent: "challenge",
      targetArtifactId: "rep-c",
      text: "质疑报告",
    });
    expect((next.staleArtifactIds || []).includes("rep-c")).toBe(true);
  });
});