/**
 * Checkpoint Coverage — WhyBuddy V5.1 Reconverge Loop Fix
 * Spec: .kiro/specs/whybuddy-reconverge-loop-fix/ (Task 4, design "Testing Strategy")
 *
 * This file adds ONLY the genuinely-missing unit / edge-case / integration coverage from the
 * design Testing Strategy that the Task 1 (bug exploration) and Task 2 (preservation) suites do
 * NOT already assert, avoiding duplication:
 *
 *   1. C-2 DECISION-LEVEL downgrade — `invalidateForIntervention` with a `targetDecisionId`
 *      challenge against a converged conclusion downgrades `goal.status` to "needs_refinement"
 *      through the single-writer `applyGoalConclusion` (the early-return `targetDecisionId` branch;
 *      the Task 1 suite only covers the artifact-cascade branch).
 *   2. C-2 DECISION-LEVEL preservation — a decision challenge on a NON-converged session leaves
 *      `goal.status` unchanged (the non-converged path of the same branch).
 *   3. Full CLOSED-LOOP re-convergence — drive `/whybuddy` runtime to `goal.status === "clear"`,
 *      challenge the report (badge -> "needs_refinement"), re-orchestrate + re-commit, and assert
 *      the session re-converges all the way back to `"clear"` (the Task 1 closed-loop test stops at
 *      proving `report.write` is re-selected / re-committed; it never asserts the conclusion closes).
 *   4. EDGE CASE — `pickNextCapabilities` on a session with NO artifacts returns a well-formed,
 *      deduped, capped, non-empty default plan.
 *
 * It does not duplicate the C-1 re-selection, fresh/ordinary preservation, mixed stale/fresh,
 * single-writer purity, DERIVE P3, or badge assertions already owned by the Task 1 / Task 2 files.
 *
 * Validates: Requirements 2.4, 2.5, 2.6, 2.7, 3.4, 3.6, 3.10
 */

import { describe, it, expect } from 'vitest';
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  invalidateForIntervention,
  pickNextCapabilities,
  getDecisionLedger,
  findInputsForCapability,
} from './whybuddy-runtime';
import type {
  V5SessionState,
  Artifact,
  UserIntervention,
} from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';
import { commitGroundedEvidence } from './whybuddy-fullpath-fixtures';

// ---- helpers (mirror conventions from whybuddy-runtime.reconverge-loop.bug.test.ts) ----

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
    producedBy: { capabilityRunId: `run-${id}`, capabilityId, roleId },
    passedGates: [],
    title: content.split('\n')[0]?.slice(0, 80),
    summary: content.slice(0, 200),
    content,
  };
}

function markTrusted(state: V5SessionState, artId: string): void {
  const art = (state.artifacts || []).find((a: any) => a.id === artId);
  if (art) {
    (art as any).trustLevel = 'gated_pass';
    (art as any).passedGates = ['commit'];
  }
}

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
  markTrusted(updatedState, id);
  return updatedState;
}

function kindForCap(capabilityId: string): Artifact['kind'] {
  if (capabilityId === 'report.write') return 'report';
  if (capabilityId === 'synthesis.merge') return 'synthesis';
  if (capabilityId === 'risk.analyze' || capabilityId === 'counter.argue') return 'risk';
  return 'evidence';
}

/** Drive a session to `goal.status === "clear"` with a TRUSTED, committed `report` artifact. */
function buildClearStateWithTrustedReport(
  sessionId: string
): { state: V5SessionState; reportId: string } {
  const goalText = '分析权限系统的风险并给出最终报告';
  let s = createInitialSessionState(goalText, sessionId);
  s = commitTrusted(s, 'risk-1', 'risk.analyze', '安全', 'risk', `${sessionId}-r0`);
  s = commitGroundedEvidence(s, 'ev-ground-1', `${sessionId}-r0b`);
  s = commitTrusted(s, 'synth-1', 'synthesis.merge', '综合', 'synthesis', `${sessionId}-r1`);

  const { newState } = orchestrateReasoningTurn(s, {
    turnId: `${sessionId}-cv`,
    userText: '现在可以出最终报告了',
  });

  const reportNode = (newState.graph.nodes || []).find(
    (n: any) => n.capabilityId === 'report.write'
  );
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
  markTrusted(updatedState, reportId);
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
    const { updatedState } = commitArtifact(
      working,
      createRawArtifact(`${turnId}-art-${idx}`, cap, role, kindForCap(cap)),
      runId,
      false,
      inputs
    );
    working = updatedState;
  });
  return working;
}

// =====================================================================================
// C-2 DECISION-LEVEL downgrade (targetDecisionId branch) — genuinely missing unit coverage
// =====================================================================================

describe('CHECKPOINT C-2 (decision-level): challenging a supporting decision downgrades the conclusion through the single writer', () => {
  it('converged "clear" session: a targetDecisionId challenge downgrades goal.status to "needs_refinement" (Req 2.5, 2.6, 2.7)', () => {
    const { state: clearState } = buildClearStateWithTrustedReport('chk-c2-decision');
    expect(clearState.goal.status).toBe('clear');

    // The converge turn appended a decision to the ledger; that decision is the supporting
    // reasoning the conclusion depended on.
    const ledger = getDecisionLedger(clearState);
    expect(ledger.length).toBeGreaterThan(0);
    const decisionId = (ledger[0] as any).id;
    expect(decisionId).toBeTruthy();

    const challenged = invalidateForIntervention(clearState, {
      targetDecisionId: decisionId,
      intent: 'challenge',
      text: '我质疑这个决策依据',
    } as UserIntervention);

    // The decision is marked challenged...
    const challengedDecision = getDecisionLedger(challenged).find((d: any) => d.id === decisionId);
    expect((challengedDecision as any)?.status).toBe('challenged');

    // ...and the converged conclusion is legitimately downgraded through applyGoalConclusion.
    expect(challenged.goal.status).toBe('needs_refinement');
    // The downgrade only touched goal.status; the rest of the goal object is preserved.
    expect({ ...challenged.goal, status: undefined }).toEqual({ ...clearState.goal, status: undefined });
  });

  it('PRESERVATION (¬C2, decision-level): a decision challenge on a NON-converged session leaves goal.status unchanged (Req 3.4)', () => {
    // Non-converged session that still has a decision in the ledger.
    let s = createInitialSessionState('分析权限系统的风险并给出最终报告', 'chk-c2-decision-noncon');
    const { newState } = orchestrateReasoningTurn(s, {
      turnId: 'noncon-cv',
      userText: '分析风险并生成报告',
    });
    s = newState;
    expect(s.goal.status).toBe('needs_refinement');

    const ledger = getDecisionLedger(s);
    expect(ledger.length).toBeGreaterThan(0);
    const decisionId = (ledger[0] as any).id;

    const challenged = invalidateForIntervention(s, {
      targetDecisionId: decisionId,
      intent: 'challenge',
      text: '质疑这个决策',
    } as UserIntervention);

    // Decision is marked challenged, but a non-converged conclusion is never downgraded.
    const challengedDecision = getDecisionLedger(challenged).find((d: any) => d.id === decisionId);
    expect((challengedDecision as any)?.status).toBe('challenged');
    expect(challenged.goal.status).toBe('needs_refinement');
    expect(challenged.goal).toEqual(s.goal);
  });

  it('PRESERVATION: an unknown targetDecisionId on a converged session leaves goal.status unchanged (Req 3.4)', () => {
    const { state: clearState } = buildClearStateWithTrustedReport('chk-c2-decision-ghost');
    expect(clearState.goal.status).toBe('clear');

    const challenged = invalidateForIntervention(clearState, {
      targetDecisionId: 'no-such-decision',
      intent: 'challenge',
      text: '质疑一个不存在的决策',
    } as UserIntervention);

    // No matching decision and no artifact/node target ⇒ nothing staled, conclusion intact.
    expect(challenged.goal.status).toBe('clear');
    expect(challenged.goal).toEqual(clearState.goal);
  });
});

// =====================================================================================
// Full CLOSED-LOOP re-convergence — genuinely missing integration assertion
// =====================================================================================

describe('CHECKPOINT integration: clear -> challenge -> re-orchestrate -> re-clear closes the loop', () => {
  it('re-converges all the way back to goal.status === "clear" after a report challenge (Req 2.4, 3.10)', () => {
    // 1) First convergence.
    const { state: clearState, reportId } = buildClearStateWithTrustedReport('chk-loop');
    expect(clearState.goal.status).toBe('clear');

    // 2) Challenge the supporting report — C-2 downgrades the conclusion at challenge time so the
    //    STATUS badge never shows a stale "clear" in the interim.
    const challenged = invalidateForIntervention(clearState, {
      targetArtifactId: reportId,
      intent: 'challenge',
      text: '我质疑这个最终报告，请重新评估',
    } as UserIntervention);
    expect(challenged.staleArtifactIds).toContain(reportId);
    expect(challenged.goal.status).toBe('needs_refinement');

    // 3) Re-orchestrate + re-commit. C-1 makes the staled report kind eligible again, so a fresh
    //    trusted report is re-committed and GCOV can re-pass on a subsequent converge turn.
    let working = challenged;
    let reconverged = false;
    for (let i = 0; i < 5 && !reconverged; i++) {
      working = driveConvergeTurn(working, `chk-loop-recv-${i}`, '请基于现有证据重新生成最终报告');
      if (working.goal.status === 'clear') reconverged = true;
    }

    // 4) The loop closes: the second convergence reaches "clear" again.
    expect(working.goal.status).toBe('clear');

    // And the freshly converged session rests on a fresh (non-stale) trusted report.
    const stales = new Set(working.staleArtifactIds || []);
    const freshTrustedReports = (working.artifacts || []).filter(
      (a: any) =>
        a.kind === 'report' &&
        a.producedBy?.capabilityId === 'report.write' &&
        (a.trustLevel === 'gated_pass' || a.trustLevel === 'audited') &&
        !stales.has(a.id)
    );
    expect(freshTrustedReports.length).toBeGreaterThan(0);
  });
});

// =====================================================================================
// EDGE CASE — no artifacts present
// =====================================================================================

describe('CHECKPOINT edge case: pickNextCapabilities with no artifacts present', () => {
  it('returns a well-formed, deduped, capped, non-empty default plan for a fresh session', () => {
    const s = createInitialSessionState('分析权限系统的风险并给出最终报告', 'chk-empty');
    expect((s.artifacts || []).length).toBe(0);
    expect((s.staleArtifactIds || []).length).toBe(0);

    const picks = pickNextCapabilities(s, '帮我开始这个目标');
    // Non-empty default plan, deduped and capped at 5.
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(5);
    const keys = picks.map((p) => `${p.capabilityId}:${p.roleId}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Determinism: same inputs → same picks.
    expect(pickNextCapabilities(s, '帮我开始这个目标')).toEqual(picks);
  });
});
