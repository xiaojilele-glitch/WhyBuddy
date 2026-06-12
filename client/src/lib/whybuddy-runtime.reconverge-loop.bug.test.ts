/**
 * Bug Condition Exploration Test — WhyBuddy V5.1 Reconverge Loop Fix
 * Spec: .kiro/specs/whybuddy-reconverge-loop-fix/ (Task 1, Property 1: Bug Condition)
 *
 * CRITICAL: These tests are written against UNFIXED code and are EXPECTED TO FAIL.
 * The failures confirm two distinct defects that break the V5.1 soul loop
 * `clear -> challenge -> re-clear`:
 *
 *   C-1 (Reconvergence deadlock): `pickNextCapabilities` derives its presence flags
 *        (`hasReport` / `hasRisk` / `hasSynthesis`) from `existingKinds`, a set built from ALL
 *        artifacts without excluding stale ones. After a challenge stales a committed artifact,
 *        the kind is still treated as present, so the staled capability is never re-scheduled and
 *        GCOV can never re-pass.
 *
 *   C-2 (Stale "clear" conclusion): `invalidateForIntervention` handles the challenge/stale
 *        cascade but never touches `goal`, so `goal.status` stays `"clear"` after the supporting
 *        artifacts are staled.
 *
 * DO NOT "fix" these tests or the production code here. They encode the EXPECTED behavior
 * (design Property 1 / isBugCondition_C1 + isBugCondition_C2) and will be re-run after the fix
 * lands (Task 3.3), where they MUST flip from FAIL -> PASS.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  invalidateForIntervention,
  pickNextCapabilities,
  applyGoalConclusion,
  findInputsForCapability,
} from './whybuddy-runtime';
import type { V5SessionState, Artifact, UserIntervention } from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';

// ---- helpers (mirror conventions from whybuddy-runtime.goal-conclusion-gate.bug.test.ts) ----

function createRawArtifact(
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact['kind'],
  content = `${roleId} 通过 ${capabilityId} 贡献了内容。`
): Omit<Artifact, 'trustLevel' | 'passedGates'> {
  return {
    id,
    kind,
    provenance: 'ai_generated',
    producedBy: {
      capabilityRunId: `run-${id}`,
      capabilityId,
      roleId,
    },
    passedGates: [],
    title: content.split('\n')[0]?.slice(0, 80),
    summary: content.slice(0, 200),
    content,
  };
}

/** Commit a trusted (gated_pass) capability run so its required pre-req is satisfied for GCOV. */
function commitTrusted(
  state: V5SessionState,
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact['kind'],
  runId: string,
  declaredInputs: string[] = []
): V5SessionState {
  const { updatedState } = commitArtifact(
    state,
    createRawArtifact(id, capabilityId, roleId, kind),
    runId,
    false,
    declaredInputs
  );
  // Defensive: ensure trusted + not stale (matches existing GCOV tests).
  const art = (updatedState.artifacts || []).find((a: any) => a.id === id);
  if (art) {
    (art as any).trustLevel = 'gated_pass';
    (art as any).passedGates = ['commit'];
  }
  return updatedState;
}

function commitGroundedEvidence(
  state: V5SessionState,
  id: string,
  runId: string
): V5SessionState {
  const { updatedState } = commitArtifact(
    state,
    {
      ...createRawArtifact(id, 'evidence.search', '接地', 'evidence', '【来源: F1_Github_Source 取数】外部'),
      provenance: 'mcp:github' as Artifact['provenance'],
      summary: '【来源: F1_Github_Source 取数】',
      payload: { evidenceSource: 'F1_Github_Source 取数' },
    },
    runId,
    false,
    []
  );
  return updatedState;
}

/**
 * Drive a session to `goal.status === "clear"` with a TRUSTED, committed `report` artifact.
 * Mirrors the page's first-convergence flow: trusted risk + synthesis upstreams, a converge turn
 * (GCOV-pass -> applyGoalConclusion writes "clear"), then commit the planned report.write.
 */
function buildClearStateWithTrustedReport(sessionId: string): { state: V5SessionState; reportId: string } {
  const goalText = '分析权限系统的风险并给出最终报告';
  let s = createInitialSessionState(goalText, sessionId);

  // Trusted required pre-reqs (risk.analyze) + synthesis upstream.
  s = commitTrusted(s, 'risk-1', 'risk.analyze', '安全', 'risk', `${sessionId}-r0`);
  s = commitGroundedEvidence(s, 'ev-ground-1', `${sessionId}-r0b`);
  s = commitTrusted(s, 'synth-1', 'synthesis.merge', '综合', 'synthesis', `${sessionId}-r1`);

  // Converge turn: GCOV passes -> single-writer applyGoalConclusion writes "clear".
  const { newState } = orchestrateReasoningTurn(s, {
    turnId: `${sessionId}-cv`,
    userText: '现在可以出最终报告了',
  });

  // Commit the report planned this turn, using the planned run id so it is a real trusted report.
  const reportNode = (newState.graph.nodes || []).find((n: any) => n.capabilityId === 'report.write');
  const reportRunId = (reportNode as any)?.capabilityRunId ?? `${sessionId}-cv-run-0`;
  const reportInputs = findInputsForCapability(newState, 'report.write');
  const reportId = 'report-1';
  const { updatedState } = commitArtifact(
    newState,
    createRawArtifact(reportId, 'report.write', '综合', 'report'),
    reportRunId,
    false,
    reportInputs
  );
  const art = (updatedState.artifacts || []).find((a: any) => a.id === reportId);
  if (art) {
    (art as any).trustLevel = 'gated_pass';
    (art as any).passedGates = ['commit'];
  }
  return { state: updatedState, reportId };
}

/** Mirror the page's same-round commit loop: orchestrate + commit each planned capability. */
function driveConvergeTurn(state: V5SessionState, turnId: string, userText: string): V5SessionState {
  const { newState, plan } = orchestrateReasoningTurn(state, { turnId, userText });
  let working = newState;
  plan.selected.forEach((sel: any, idx: number) => {
    const cap = sel.capabilityId as V5CapabilityId;
    const role = sel.roleId || 'agent';
    const runId = `${turnId}-run-${idx}`;
    const inputs = findInputsForCapability(working, cap);
    const kind: Artifact['kind'] =
      cap === 'report.write'
        ? 'report'
        : cap === 'synthesis.merge'
        ? 'synthesis'
        : cap === 'risk.analyze' || cap === 'counter.argue'
        ? 'risk'
        : 'evidence';
    const { updatedState } = commitArtifact(working, createRawArtifact(`${turnId}-art-${idx}`, cap, role, kind), runId, false, inputs);
    working = updatedState;
  });
  return working;
}

describe('BUG: WhyBuddy reconverge loop deadlock + stale conclusion (Property 1 exploration — EXPECTED TO FAIL on unfixed code)', () => {
  // ---- C-1 deterministic seeds (kind-deduped artifacts cannot be re-emitted after a challenge) ----

  it('C-1 report: after staling a trusted report, pickNextCapabilities should re-select report.write', () => {
    const { state: clearState, reportId } = buildClearStateWithTrustedReport('bug-c1-report');

    // Sanity: first convergence really reached "clear" with a trusted report.
    expect(clearState.goal.status).toBe('clear');

    const challenge: UserIntervention = { targetArtifactId: reportId, intent: 'challenge', text: '我质疑这个最终报告' };
    const challenged = invalidateForIntervention(clearState, challenge);
    expect(challenged.staleArtifactIds).toContain(reportId);

    const caps = pickNextCapabilities(challenged, '请重新出最终报告').map((p) => p.capabilityId);

    // EXPECTED (design Property 1 / Req 2.2) — FAILS on unfixed code: hasReport stays true
    // (stale report still counted), so report.write is never re-scheduled.
    expect(caps).toContain('report.write');
  });

  it('C-1 synthesis: after staling the only synthesis artifact, pickNextCapabilities should re-select synthesis.merge', () => {
    let s = createInitialSessionState('分析权限系统的风险并给出最终报告', 'bug-c1-synth');
    s = commitTrusted(s, 'risk-1', 'risk.analyze', '安全', 'risk', 'syn-r0');
    s = commitTrusted(s, 'synth-1', 'synthesis.merge', '综合', 'synthesis', 'syn-r1');

    const challenged = invalidateForIntervention(s, {
      targetArtifactId: 'synth-1',
      intent: 'challenge',
      text: '我质疑这个综合结论',
    } as UserIntervention);
    expect(challenged.staleArtifactIds).toContain('synth-1');

    const caps = pickNextCapabilities(challenged, '请重新综合并生成报告').map((p) => p.capabilityId);

    // EXPECTED (design Property 1 / Req 2.3) — FAILS on unfixed code: hasSynthesis stays true,
    // so synthesis.merge is never re-scheduled.
    expect(caps).toContain('synthesis.merge');
  });

  // ---- C-2 deterministic seed (goal.status not downgraded on challenge) ----

  it('C-2 downgrade: challenging the supporting report at goal.status === "clear" should downgrade to "needs_refinement"', () => {
    const { state: clearState, reportId } = buildClearStateWithTrustedReport('bug-c2-downgrade');
    expect(clearState.goal.status).toBe('clear');

    const challenged = invalidateForIntervention(clearState, {
      targetArtifactId: reportId,
      intent: 'challenge',
      text: '我质疑这个结论',
    } as UserIntervention);

    // Sanity: the supporting artifact really was staled.
    expect(challenged.staleArtifactIds).toContain(reportId);

    // EXPECTED (design Property 2 / Req 2.5, 2.7) — FAILS on unfixed code:
    // invalidateForIntervention never touches goal, so goal.status stays a stale "clear".
    expect(challenged.goal.status).toBe('needs_refinement');
  });

  // ---- Closed-loop seed (clear -> challenge -> re-orchestrate -> re-clear) ----

  it('closed loop: after a challenge, re-orchestrating a converge turn should re-select report.write and re-commit a fresh trusted report', () => {
    const { state: clearState, reportId } = buildClearStateWithTrustedReport('bug-loop');
    expect(clearState.goal.status).toBe('clear');

    const challenged = invalidateForIntervention(clearState, {
      targetArtifactId: reportId,
      intent: 'challenge',
      text: '我质疑这个结论，请重新评估',
    } as UserIntervention);

    // Re-orchestrate with converge intent.
    const { plan } = orchestrateReasoningTurn(challenged, {
      turnId: 'reconverge',
      userText: '请基于现有证据重新生成最终报告',
    });
    const caps = plan.selected.map((s: any) => s.capabilityId);

    // EXPECTED (design Property 1 / Req 2.4) — FAILS on unfixed code: report.write is never
    // re-selected, so the loop deadlocks at the second convergence.
    expect(caps).toContain('report.write');

    // And driving the full converge turn should produce a fresh (non-stale) trusted report.
    const reconverged = driveConvergeTurn(challenged, 'reconverge2', '请基于现有证据重新生成最终报告');
    const stales = new Set(reconverged.staleArtifactIds || []);
    const freshReports = (reconverged.artifacts || []).filter(
      (a: any) =>
        a.kind === 'report' &&
        a.producedBy?.capabilityId === 'report.write' &&
        (a.trustLevel === 'gated_pass' || a.trustLevel === 'audited') &&
        !stales.has(a.id)
    );
    // EXPECTED — FAILS on unfixed code: no new report.write is ever scheduled/committed.
    expect(freshReports.length).toBeGreaterThan(0);
  });

  // ---- Property over the C-1 domain (isBugCondition_C1) ----

  it('PROPERTY (C-1): for all stale-only-kind states, pickNextCapabilities re-selects that kind\'s capability', () => {
    const kindArb = fc.constantFrom<Artifact['kind']>('report', 'synthesis', 'risk');
    const convergeArb = fc.constantFrom(
      '请生成最终报告',
      '请重新综合并生成报告',
      '基于证据重新分析风险并生成报告'
    );
    const seedArb = fc.integer({ min: 0, max: 100000 });

    fc.assert(
      fc.property(kindArb, convergeArb, seedArb, (kind, convergeText, seed) => {
        let s = createInitialSessionState('分析权限系统的风险并给出最终报告', `c1prop-${seed}`);
        s = commitTrusted(s, `risk-${seed}`, 'risk.analyze', '安全', 'risk', `c1p-${seed}-r0`);
        s = commitTrusted(s, `synth-${seed}`, 'synthesis.merge', '综合', 'synthesis', `c1p-${seed}-r1`);
        const reportInputs = findInputsForCapability(s, 'report.write');
        const committedReport = commitArtifact(
          s,
          createRawArtifact(`report-${seed}`, 'report.write', '综合', 'report'),
          `c1p-${seed}-r2`,
          false,
          reportInputs
        );
        let st = committedReport.updatedState;
        const rep = (st.artifacts || []).find((a: any) => a.id === `report-${seed}`);
        if (rep) {
          (rep as any).trustLevel = 'gated_pass';
          (rep as any).passedGates = ['commit'];
        }

        const targetId =
          kind === 'report' ? `report-${seed}` : kind === 'synthesis' ? `synth-${seed}` : `risk-${seed}`;
        const challenged = invalidateForIntervention(st, {
          targetArtifactId: targetId,
          intent: 'challenge',
          text: '质疑',
        } as UserIntervention);

        // Scope to the C-1 bug domain: a stale-only artifact of `kind` exists with no fresh one.
        const stales = new Set(challenged.staleArtifactIds || []);
        const arts = challenged.artifacts || [];
        const hasStaleOfKind = arts.some((a: any) => a.kind === kind && stales.has(a.id));
        const hasFreshOfKind = arts.some((a: any) => a.kind === kind && !stales.has(a.id));
        fc.pre(hasStaleOfKind && !hasFreshOfKind);

        const capForKind: V5CapabilityId =
          kind === 'report' ? 'report.write' : kind === 'synthesis' ? 'synthesis.merge' : 'risk.analyze';
        const caps = pickNextCapabilities(challenged, convergeText).map((p) => p.capabilityId);

        // EXPECTED (design Property 1) — FAILS on unfixed code (counterexample for report/synthesis).
        expect(caps).toContain(capForKind);
      }),
      { numRuns: 80 }
    );
  });

  // ---- Property over the C-2 domain (isBugCondition_C2) ----

  it('PROPERTY (C-2): for all converged states whose supporting report is challenged, goal.status downgrades to "needs_refinement"', () => {
    const convergedArb = fc.constantFrom<V5SessionState['goal']['status']>('clear', 'not_recommended');
    const seedArb = fc.integer({ min: 0, max: 100000 });

    fc.assert(
      fc.property(convergedArb, seedArb, (status, seed) => {
        let s = createInitialSessionState('分析权限系统的风险并给出最终报告', `c2prop-${seed}`);
        s = commitTrusted(s, `risk-${seed}`, 'risk.analyze', '安全', 'risk', `c2p-${seed}-r0`);
        const reportInputs = findInputsForCapability(s, 'report.write');
        const committedReport = commitArtifact(
          s,
          createRawArtifact(`report-${seed}`, 'report.write', '综合', 'report'),
          `c2p-${seed}-r1`,
          false,
          reportInputs
        );
        let st = committedReport.updatedState;
        const rep = (st.artifacts || []).find((a: any) => a.id === `report-${seed}`);
        if (rep) {
          (rep as any).trustLevel = 'gated_pass';
          (rep as any).passedGates = ['commit'];
        }

        // Set the converged conclusion through the single writer (mirrors the GCOV-pass write).
        st = applyGoalConclusion(st, status);

        const challenged = invalidateForIntervention(st, {
          targetArtifactId: `report-${seed}`,
          intent: 'challenge',
          text: '质疑结论',
        } as UserIntervention);

        // Scope to the C-2 bug domain: the supporting conclusion artifact really was staled.
        fc.pre((challenged.staleArtifactIds || []).includes(`report-${seed}`));

        // EXPECTED (design Property 2 / Req 2.5) — FAILS on unfixed code (goal.status left stale).
        expect(challenged.goal.status).toBe('needs_refinement');
      }),
      { numRuns: 80 }
    );
  });
});
