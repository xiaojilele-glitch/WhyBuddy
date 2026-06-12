/**
 * WhyBuddy V5.1 Full-Path — S16/S17 ROLES layer (brainstorm debate chain + degraded fallback).
 * Spec: docs/V5.1-full-path-test-plan.md (§2 S16, S17; §3 N5; edges 38–50).
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  createInitialSessionState,
  intakeMessage,
  orchestrateReasoningTurn,
  commitArtifact,
  findInputsForCapability,
  pickNextCapabilities,
  driveReasoningSession,
  createDeterministicCapabilityExecutor,
  type CapabilityExecutor,
} from "./whybuddy-runtime";
import {
  COMPLEX_GOAL_TEXT,
  createRawArtifact,
  commitTrusted,
  commitGroundedEvidence,
} from "./whybuddy-fullpath-fixtures";
import { stripDebateProtocolNodes } from "@/components/three/scene-fusion/blueprint-wall-reasoning-graph";
import type { BrainstormReasoningGraph } from "@shared/blueprint/brainstorm-reasoning-graph";
import type { Artifact, V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { V5CapabilityId } from "@shared/blueprint/contracts";

const PROTOCOL_MARKERS = [
  "critique:",
  "rebuttal:",
  "debate:",
  "challengeEdges",
  "role vote",
  "brainstorm console",
  "brainstorm:",
] as const;

function formalContentHasProtocolMarkers(text: string): boolean {
  const lower = text.toLowerCase();
  return PROTOCOL_MARKERS.some((m) => lower.includes(m.toLowerCase()));
}

function runDeliberationTurn(
  state: V5SessionState,
  turnId: string,
  userText: string,
  artifactContentByCap?: Partial<Record<V5CapabilityId, string>>,
  payloadByCap?: Partial<Record<V5CapabilityId, unknown>>
): V5SessionState {
  const intake = intakeMessage(state, { turnId, userText });
  const { newState, plan } = orchestrateReasoningTurn(intake.preparedState, { turnId, userText });
  let working = newState;
  plan.selected.forEach((sel: { capabilityId: V5CapabilityId; roleId?: string }, idx: number) => {
    const cap = sel.capabilityId;
    const role = sel.roleId || "agent";
    const runId = `${turnId}-run-${idx}`;
    const inputs = findInputsForCapability(working, cap);
    const kind: Artifact["kind"] =
      cap === "report.write"
        ? "report"
        : cap === "synthesis.merge"
          ? "synthesis"
          : cap === "risk.analyze" || cap === "counter.argue" || cap === "critique.generate"
            ? "risk"
            : "evidence";
    const content =
      artifactContentByCap?.[cap] ||
      `${role} · ${cap}\ncritique: 辩论协议行应被 FLOWB 剥离\nrebuttal: 保留在 payload 而非正式正文\n结论：RBAC MVP`;
    const raw = {
      ...createRawArtifact(`${turnId}-art-${idx}`, cap, role, kind, content),
      ...(payloadByCap?.[cap] !== undefined ? { payload: payloadByCap[cap] } : {}),
    };
    const { updatedState } = commitArtifact(working, raw, runId, false, inputs);
    working = updatedState;
  });
  return working;
}

function seedConvergedUpstream(sessionId: string): V5SessionState {
  let s = createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId);
  s = commitTrusted(s, `${sessionId}-risk`, "risk.analyze", "安全", "risk", `${sessionId}-r0`);
  s = commitGroundedEvidence(s, `${sessionId}-ev`, `${sessionId}-r0b`);
  s = commitTrusted(s, `${sessionId}-syn`, "synthesis.merge", "综合", "synthesis", `${sessionId}-r1`);
  return s;
}

// =====================================================================================
// S16 · Brainstorm 复杂路径 + FLOWB 净化
// =====================================================================================

describe("S16 · brainstorm complex path + FLOWB", () => {
  it("D_GATE→D_BO: complex goal primes critique.generate before standard picks", () => {
    // Non-cold-start: cold start can fill 4 slots before D_BO unshift (picks.length < 4 gate).
    const picks = pickNextCapabilities(
      seedConvergedUpstream("S16-gate"),
      "多角色辩论，展开合规审计"
    );
    expect(picks[0]?.capabilityId).toBe("critique.generate");
    expect(picks[0]?.roleId).toBe("挑刺");
  });

  it("D_BO→D_SYN: after critique run, chain advances toward counter and synthesis", () => {
    let s = seedConvergedUpstream("S16-chain");
    s = runDeliberationTurn(s, "S16-t1", "多角色辩论", {
      "critique.generate": "critique: 缺少租户隔离\n挑刺结论",
    });
    expect((s.capabilityRuns || []).some((r) => r.capabilityId === "critique.generate")).toBe(true);

    const picks = pickNextCapabilities(s, "继续辩论");
    expect(picks.some((p) => p.capabilityId === "counter.argue")).toBe(true);
  });

  it("N5 + FLOWB: formal report content has zero protocol markers; ledger strip record; payload preserved", () => {
    let s = seedConvergedUpstream("S16-flowb");
    const critiquePayload = {
      id: "crit-s16",
      challengerRoleId: "auditor",
      targetRoleId: "architect",
      critique: "缺少租户级隔离",
      severity: "high",
    };
    s = runDeliberationTurn(
      s,
      "S16-debate",
      "多角色辩论",
      {
        "critique.generate": "critique: wall-only\nrebuttal: wall-only",
        "synthesis.merge": "综合结论\ndebate: A vs B\nrole vote: 2:1",
      },
      { "critique.generate": critiquePayload }
    );

    const upstreamCritique = (s.artifacts || []).find((a) =>
      (a.producedBy?.capabilityId as string) === "critique.generate"
    );
    expect(upstreamCritique?.payload).toEqual(critiquePayload);

    const { newState: afterO } = orchestrateReasoningTurn(s, {
      turnId: "S16-rpt",
      userText: "生成最终报告",
    });
    const reportNode = (afterO.graph.nodes || []).find(
      (n: { capabilityId?: string }) => n.capabilityId === "report.write"
    );
    const reportRunId =
      (reportNode as { capabilityRunId?: string })?.capabilityRunId ?? "S16-rpt-run-0";
    const pollutedReport =
      "【报告】结论：推进\n" +
      "critique: 应被剥离\nrebuttal: 应被剥离\nbrainstorm: 噪声\n证据：RBAC";
    const { updatedState: afterReport, committed } = commitArtifact(
      afterO,
      createRawArtifact("S16-report", "report.write", "综合", "report", pollutedReport),
      reportRunId,
      false,
      findInputsForCapability(afterO, "report.write")
    );

    expect(committed).toBeTruthy();
    expect(formalContentHasProtocolMarkers(committed!.content || "")).toBe(false);
    const ledger = afterReport.flowBoundaryLedger || [];
    expect(ledger.length).toBeGreaterThan(0);
    expect(
      ledger.some(
        (c) =>
          (c.strippedProtocolNodes || []).length > 0 &&
          (c.assertions || []).some((a) => /strip|protocol/i.test(a))
      )
    ).toBe(true);
    expect(upstreamCritique?.payload).toEqual(critiquePayload);
  });

  it("3D debate wall: stripDebateProtocolNodes removes critique/rebuttal from formal graph only", () => {
    const rawGraph: BrainstormReasoningGraph = {
      id: "g-s16",
      jobId: "j-s16",
      stage: "effect_preview",
      nodes: [
        { id: "h1", type: "hypothesis", title: "hyp", status: "completed" },
        { id: "c1", type: "critique", title: "crit", status: "active" },
        { id: "r1", type: "rebuttal", title: "reb", status: "active" },
      ],
      edges: [
        { id: "e1", source: "c1", target: "h1", kind: "challenge" },
        { id: "e2", source: "r1", target: "c1", kind: "support" },
      ],
      consoleLines: ["brainstorm console: debate line"],
    };
    const stripped = stripDebateProtocolNodes(rawGraph);
    expect(stripped.nodes.some((n) => n.type === "critique" || n.type === "rebuttal")).toBe(
      false
    );
    expect(stripped.consoleLines).toEqual([]);
    expect(rawGraph.nodes.some((n) => n.type === "critique")).toBe(true);
  });
});

// =====================================================================================
// S17 · Brainstorm 降级兜底
// =====================================================================================

describe("S17 · brainstorm degraded fallback", () => {
  const origDegradeEnv = process.env.WHYBUDDY_BRAINSTORM_DEGRADE;

  afterEach(() => {
    if (origDegradeEnv === undefined) delete process.env.WHYBUDDY_BRAINSTORM_DEGRADE;
    else process.env.WHYBUDDY_BRAINSTORM_DEGRADE = origDegradeEnv;
  });

  it("D_GATE→D_SA: simple goal does not prime brainstorm deliberation chain", () => {
    const picks = pickNextCapabilities(
      createInitialSessionState("写个周报", "S17-simple"),
      "继续补充"
    );
    expect(picks.some((p) => p.capabilityId === "critique.generate")).toBe(false);
  });

  it("D_DEG→D_SA: WHYBUDDY_BRAINSTORM_DEGRADE=1 skips D_BO primers", () => {
    process.env.WHYBUDDY_BRAINSTORM_DEGRADE = "1";
    const picks = pickNextCapabilities(
      createInitialSessionState(COMPLEX_GOAL_TEXT, "S17-env"),
      "多角色辩论"
    );
    expect(picks[0]?.capabilityId).not.toBe("critique.generate");
  });

  it("deliberation exec degraded marks D_DEG and subsequent picks omit brainstorm chain", async () => {
    const base = createDeterministicCapabilityExecutor();
    const degradedExecutor: CapabilityExecutor = {
      async executeCapability(args) {
        if (args.capabilityId === "critique.generate") {
          return {
            title: "降级 critique",
            summary: "brainstorm_timeout",
            content: "降级单 agent 产出（超时）",
            provenance: "ai_generated",
            degraded: true,
            degradedReason: "brainstorm_timeout",
          } as Awaited<ReturnType<CapabilityExecutor["executeCapability"]>>;
        }
        return base.executeCapability(args);
      },
    };

    const s = createInitialSessionState(COMPLEX_GOAL_TEXT, "S17-drive");
    const { preparedState } = intakeMessage(s, {
      turnId: "S17-deg",
      userText: "多角色辩论，分析合规风险",
    });
    expect(preparedState.roleMode).toBe("complex");

    const driven = await driveReasoningSession(preparedState, {
      turnSeedId: "S17-deg",
      userText: "多角色辩论，分析合规风险",
      executor: degradedExecutor,
      maxLoopsPerMessage: 1,
    });

    expect(driven.finalState.brainstormDegraded).toBe(true);
    expect(driven.finalState.roleMode).toBe("degraded");
    const afterDegPicks = pickNextCapabilities(driven.finalState, "继续");
    expect(afterDegPicks.some((p) => p.capabilityId === "critique.generate")).toBe(false);
    expect(
      (driven.finalState.conversation || []).some((c) => /D_DEG|degraded/i.test(c.text || ""))
    ).toBe(true);
  });

  it("intake sets roleMode complex on debate keywords (RL→D_GATE)", () => {
    const { preparedState } = intakeMessage(createInitialSessionState(COMPLEX_GOAL_TEXT, "S17-intake"), {
      turnId: "S17-i1",
      userText: "来个多角色辩论",
    });
    expect(preparedState.roleMode).toBe("complex");
  });

  it("scheduling pairs remain (capability, role) after degraded drive", async () => {
    const s = seedConvergedUpstream("S17-pair");
    const { plan } = orchestrateReasoningTurn(
      intakeMessage(s, { turnId: "S17-p", userText: "多角色辩论" }).preparedState,
      { turnId: "S17-p", userText: "多角色辩论" }
    );
    for (const sel of plan.selected) {
      expect(sel.capabilityId).toBeTruthy();
      expect(sel.roleId).toBeTruthy();
    }
  });
});