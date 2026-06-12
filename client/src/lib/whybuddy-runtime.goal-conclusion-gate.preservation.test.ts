/**
 * Preservation Property Tests — WhyBuddy V5.1 GOAL Conclusion Gate
 * Spec: .kiro/specs/whybuddy-goal-conclusion-gate/ (Task 2, Property 2 + Property 3)
 *
 * OBSERVATION-FIRST METHODOLOGY: These tests are written against UNFIXED code and are
 * EXPECTED TO PASS. They capture the current (baseline) behavior for every flow that does
 * NOT reach a GCOV-pass, plus the DERIVE read-only-on-STATE invariant (P3). After the fix
 * lands (Task 3.6) the SAME tests MUST STILL PASS — proving the GCOV-gated conclusion write
 * did not disturb any non-GCOV-pass flow and that DERIVE never writes authoritative STATE.
 *
 * Property 2 (design): For any input where the bug condition does NOT hold (GCOV does not
 *   pass / the turn does not reach a GCOV-pass), the code SHALL preserve `goal.status`
 *   unchanged, the GCOV hard-block partial AWAIT (note, empty plan, `GCOV_BLOCKED` rationale),
 *   the Budget block and contract-sufficiency stop paths, and ORCH staying read-only on GOAL.
 *   Validates: Requirements 3.1, 3.2, 3.3, 3.4
 *
 * Property 3 (design): For any session state, `deriveNodeStatus(state)` SHALL change only
 *   `graph.nodes[].status` and leave every authoritative STATE field (`artifacts`, `goal`,
 *   `decisions`, `capabilityRuns`, `coverageGaps`, `decisionLedger`, etc.) deep-equal to the
 *   input.
 *   Validates: Requirements 2.5, 3.5
 *
 * Validates: Requirements 2.5, 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  deriveNodeStatus,
  authorCoverageContract,
  getDecisionLedger,
  type CoverageGateResult,
} from './whybuddy-runtime';
// Task 3.3: the DERIVE P3 invariant is pinned by the shared guard helper.
import { assertDeriveReadOnly } from './whybuddy-derive-readonly-guard';
import type { V5SessionState, Artifact, CapabilityRun } from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';
import { commitGroundedEvidence } from './whybuddy-fullpath-fixtures';

// ---- helpers (mirror conventions from whybuddy-runtime.test.ts / .bug.test.ts) ----

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

function markTrusted(state: V5SessionState, artId: string): void {
  const art = (state.artifacts || []).find((a: any) => a.id === artId);
  if (art) {
    (art as any).trustLevel = 'gated_pass';
    (art as any).passedGates = ['commit'];
  }
}

function kindForCap(capabilityId: string): Artifact['kind'] {
  if (capabilityId === 'report.write') return 'report';
  if (capabilityId === 'risk.analyze') return 'risk';
  if (capabilityId === 'synthesis.merge') return 'synthesis';
  if (capabilityId === 'counter.argue') return 'risk';
  return 'doc';
}

/**
 * Build a richly populated session by folding a sequence of orchestrate+commit turns.
 * Mirrors the page commit loop (runId === `${turnId}-run-${i}`) so graph nodes line up with
 * runs/artifacts and DERIVE actually exercises its status branches while STATE stays intact.
 */
function buildRichSession(
  seed: number,
  goalText: string,
  turns: Array<{ text: string; trusted: boolean; forceFail: boolean; stale: boolean }>
): V5SessionState {
  let s = createInitialSessionState(goalText, `pres-${seed}`);
  turns.forEach((turn, ti) => {
    const turnId = `t${seed}-${ti}`;
    const { newState, plan } = orchestrateReasoningTurn(s, { turnId, userText: turn.text });
    s = newState;
    (plan.selected || []).forEach((sel: any, i: number) => {
      const runId = `${turnId}-run-${i}`;
      const artId = `${turnId}-art-${i}`;
      const { updatedState } = commitArtifact(
        s,
        createRawArtifact(artId, sel.capabilityId as V5CapabilityId, sel.roleId || '综合', kindForCap(sel.capabilityId)),
        runId,
        turn.forceFail,
        sel.inputArtifactIds || []
      );
      s = updatedState;
      if (turn.trusted) markTrusted(s, artId);
    });
    if (turn.stale && (s.artifacts || []).length > 0) {
      const last = s.artifacts[s.artifacts.length - 1];
      s = { ...s, staleArtifactIds: [...(s.staleArtifactIds || []), last.id] };
    }
  });
  return s;
}

// P3 guard (`assertDeriveReadOnly`) is imported from the shared, pinned helper module
// (`whybuddy-derive-readonly-guard`). Task 3.3 extracted it there and added a dedicated guard
// test that proves it FAILS on any DERIVE write to authoritative STATE.

// =====================================================================================
// Property 2: Preservation — Non-GCOV-Pass Flows and ORCH Read-Only-on-GOAL
// =====================================================================================

describe('PRESERVATION (Property 2): non-GCOV-pass flows leave goal.status unchanged (baseline — PASSES on unfixed code)', () => {
  // ---- Concrete baseline observations ----

  it('GCOV hard-block: converge turn with missing pre-reqs parks at partial AWAIT, goal.status unchanged', () => {
    // afford==0 + still-missing pre-req while report selected => hard block (mirrors existing GCOV test).
    const goal = '有风险的权限系统最终可行性报告';
    let s = createInitialSessionState(goal, 'pres-gcov-block');

    const { updatedState: sWithRisk } = commitArtifact(
      s,
      createRawArtifact('untrusted-risk', 'risk.analyze', '安全', 'risk'),
      'pres-gcov-run-risk',
      true,
      []
    );
    s = commitArtifact(
      sWithRisk,
      createRawArtifact('trusted-synth', 'synthesis.merge', '综合', 'synthesis'),
      'pres-gcov-run-synth',
      false,
      []
    ).updatedState;
    s = { ...s, openQuestions: [{ id: 'q1', text: '边界？' }] } as any;

    const statusBefore = s.goal.status;
    const { newState: afterO, plan } = orchestrateReasoningTurn(s, {
      turnId: 'pres-gcov-block',
      userText: '路线对比 拆解结构 预览效果',
    });

    const gate = afterO.coverageGate as CoverageGateResult | undefined;
    expect(gate?.passed).toBe(false);
    // Existing hard-block behavior preserved.
    expect(plan.selected.length).toBe(0);
    expect(afterO.runtimePhase).toBe('awaiting');
    const hasGcovNote = (afterO.conversation || []).some((c: any) => (c.text || '').includes('[GCOV] blocked'));
    expect(hasGcovNote).toBe(true);
    const last = getDecisionLedger(afterO).pop()!;
    expect(last.rationale).toMatch(/GCOV_BLOCKED/);
    // goal.status unchanged.
    expect(afterO.goal.status).toBe(statusBefore);
    expect(afterO.goal).toEqual(s.goal);
  });

  it('Budget block: over-budget turn parks at partial AWAIT with blocked_by_budget DLEDGER, goal.status unchanged', () => {
    let s = createInitialSessionState('权限系统预算阻断', 'pres-budget-block');
    // Seed >= maxRepeatPerCapability (6) runs of one capability => budget block.
    const runs: CapabilityRun[] = Array.from({ length: 6 }, (_, i) => ({
      id: `pres-budget-run-${i}`,
      capabilityId: 'risk.analyze' as V5CapabilityId,
      turnId: `pres-budget-t${i}`,
      inputs: [],
      outputs: [],
      gateResults: [],
    }));
    s = { ...s, capabilityRuns: runs };

    const statusBefore = s.goal.status;
    const { newState: afterO, plan } = orchestrateReasoningTurn(s, {
      turnId: 'pres-budget-block',
      userText: '继续分析',
    });

    expect(afterO.runtimePhase).toBe('awaiting');
    expect(plan.selected.length).toBe(0);
    expect(plan.reason).toMatch(/BUDGET_EXCEEDED/);
    const hasBudgetNote = (afterO.conversation || []).some((c: any) => (c.text || '').includes('[BUDGET] exceeded'));
    expect(hasBudgetNote).toBe(true);
    const last = getDecisionLedger(afterO).pop()!;
    expect(last.rationale).toMatch(/blocked_by_budget/);
    expect(last.chose.length).toBe(0);
    // goal.status unchanged.
    expect(afterO.goal.status).toBe(statusBefore);
    expect(afterO.goal).toEqual(s.goal);
  });

  it('Contract-sufficiency stop: redundant converge stops with stopped_by_contract_sufficiency, goal.status unchanged', () => {
    let s = createInitialSessionState('权限系统', 'pres-contract-stop');
    const { contract, gaps } = authorCoverageContract(s.goal.text, 't-stop');
    const satisfiedGaps = gaps.map((g: any) => ({ ...g, status: 'resolved' as const }));
    s = { ...s, coverageContract: contract, coverageGaps: satisfiedGaps };
    s = commitGroundedEvidence(s, 'ev-ground-stop', 't-stop-run-ev');

    const { updatedState: sWithReport } = commitArtifact(
      s,
      createRawArtifact('rep-stop', 'report.write', '综合', 'report'),
      't-stop-run-rep',
      false,
      []
    );
    markTrusted(sWithReport, 'rep-stop');

    const statusBefore = sWithReport.goal.status;
    const { newState: afterO, plan } = orchestrateReasoningTurn(sWithReport, {
      turnId: 't-stop',
      userText: '再生成一次报告',
    });

    expect(afterO.runtimePhase).toBe('awaiting');
    expect(plan.selected.length).toBe(0);
    expect(plan.reason).toMatch(/CONTRACT_SUFFICIENT|contract_sufficient/);
    const hasStopNote = (afterO.conversation || []).some((c: any) => (c.text || '').includes('contract already sufficient'));
    expect(hasStopNote).toBe(true);
    const last = getDecisionLedger(afterO).pop()!;
    expect(last.rationale).toMatch(/stopped_by_contract_sufficiency/);
    // goal.status unchanged.
    expect(afterO.goal.status).toBe(statusBefore);
    expect(afterO.goal).toEqual(sWithReport.goal);
  });

  it('Ordinary turn (complex goal, missing pre-reqs) does not pass GCOV and leaves goal.status unchanged', () => {
    const s = createInitialSessionState('分析权限系统的风险并给出最终报告', 'pres-ordinary');
    const statusBefore = s.goal.status;
    const { newState: afterO } = orchestrateReasoningTurn(s, {
      turnId: 'pres-ordinary',
      userText: '先看看有哪些边界情况',
    });
    const gate = afterO.coverageGate as CoverageGateResult | undefined;
    expect(gate?.passed).toBe(false);
    expect(afterO.goal.status).toBe(statusBefore);
    expect(afterO.goal).toEqual(s.goal);
  });

  it('Re-entry / challenge turn (no GCOV-pass) leaves goal.status unchanged', () => {
    let s = createInitialSessionState('权限系统风险审计报告', 'pres-challenge');
    // First an ordinary turn to create a decision to challenge.
    const o1 = orchestrateReasoningTurn(s, { turnId: 'pres-ch-1', userText: '初步分析' });
    s = o1.newState;
    const dec = getDecisionLedger(s).pop()!;

    const statusBefore = s.goal.status;
    const intv: any = { targetDecisionId: dec.id, intent: 'challenge', text: '重新考虑这个调度' };
    const { newState: afterO } = orchestrateReasoningTurn(s, {
      turnId: 'pres-ch-2',
      userText: '挑战这条决策',
      intervention: intv,
    });
    const gate = afterO.coverageGate as CoverageGateResult | undefined;
    expect(gate?.passed).toBe(false);
    expect(afterO.goal.status).toBe(statusBefore);
    expect(afterO.goal).toEqual(s.goal);
  });

  // ---- Property over the non-GCOV-pass domain (PBT) ----

  it('PROPERTY: for all turns that do NOT reach a GCOV-pass, post-orchestrate goal deep-equals input goal (ORCH read-only on GOAL)', () => {
    // Complex goals (contain 风险/安全/审计) without a trusted risk.analyze never pass GCOV.
    const complexGoalArb = fc.constantFrom(
      '分析权限系统的风险并给出最终报告',
      '权限系统安全审计报告',
      '复杂风险评估与可行性报告',
      '反驳现有方案的安全风险'
    );
    const userTextArb = fc.constantFrom(
      '先看看边界情况',
      '出最终报告',
      '生成可行性报告',
      '继续分析风险',
      '收敛并总结',
      '路线对比 拆解结构'
    );
    const seedArb = fc.integer({ min: 0, max: 100000 });
    const seedUntrustedRiskArb = fc.boolean();
    const challengeArb = fc.boolean();

    fc.assert(
      fc.property(
        complexGoalArb,
        userTextArb,
        seedArb,
        seedUntrustedRiskArb,
        challengeArb,
        (goalText, userText, seed, seedUntrustedRisk, challenge) => {
          let s = createInitialSessionState(goalText, `pres-prop-${seed}`);

          if (seedUntrustedRisk) {
            const { updatedState } = commitArtifact(
              s,
              createRawArtifact(`ur-${seed}`, 'risk.analyze', '安全', 'risk'),
              `pres-prop-${seed}-ur`,
              false,
              []
            );
            s = updatedState;
            const art = (s.artifacts || []).find((a: any) => a.id === `ur-${seed}`);
            if (art) {
              (art as any).trustLevel = 'untrusted';
              (art as any).passedGates = [];
            }
          }

          const goalBefore = JSON.parse(JSON.stringify(s.goal));

          let intervention: any = undefined;
          if (challenge) {
            intervention = { intent: 'challenge', targetDecisionId: 'nonexistent', text: '挑战' };
          }

          const { newState } = orchestrateReasoningTurn(s, {
            turnId: `pres-prop-${seed}`,
            userText,
            intervention,
          });

          // Scope strictly to the non-GCOV-pass domain (Property 1 owns the pass domain).
          const gate = newState.coverageGate as CoverageGateResult | undefined;
          fc.pre(gate?.passed !== true);

          // goal.status (and the whole goal object) must be unchanged by ORCH.
          expect(newState.goal).toEqual(goalBefore);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// =====================================================================================
// Property 3: Preservation — DERIVE Read-Only on Authoritative STATE (P3)
// =====================================================================================

describe('PRESERVATION (Property 3): deriveNodeStatus changes only graph.nodes[].status (baseline — PASSES on unfixed code)', () => {
  it('on a richly populated state, DERIVE leaves all authoritative STATE deep-equal; only node statuses may differ', () => {
    const s = buildRichSession(1, '分析权限系统的风险并给出最终可行性报告', [
      { text: '分析风险', trusted: true, forceFail: false, stale: false },
      { text: '综合证据', trusted: true, forceFail: false, stale: false },
      { text: '生成最终报告', trusted: false, forceFail: false, stale: true },
    ]);

    // Sanity: the state is actually rich (has nodes + artifacts + runs + ledger).
    expect((s.graph?.nodes || []).length).toBeGreaterThan(0);
    expect((s.artifacts || []).length).toBeGreaterThan(0);
    expect((s.capabilityRuns || []).length).toBeGreaterThan(0);
    expect((s.decisionLedger || []).length).toBeGreaterThan(0);

    const clone = structuredClone(s);
    const after = deriveNodeStatus(s);

    // Input must not be mutated.
    expect(s).toEqual(clone);
    // Output: only graph.nodes[].status may differ.
    assertDeriveReadOnly(clone, after);
  });

  it('PROPERTY: for all generated session states, DERIVE leaves authoritative STATE deep-equal (P3)', () => {
    const goalArb = fc.constantFrom(
      '分析权限系统的风险并给出最终报告',
      '整理会议纪要并输出摘要',
      '权限系统安全审计报告',
      '简单总结当前进展',
      '复杂风险评估与可行性报告'
    );
    const turnArb = fc.record({
      text: fc.constantFrom('分析风险', '综合证据', '生成最终报告', '先看边界', '路线对比', '继续推进'),
      trusted: fc.boolean(),
      forceFail: fc.boolean(),
      stale: fc.boolean(),
    });
    const turnsArb = fc.array(turnArb, { minLength: 1, maxLength: 4 });
    const seedArb = fc.integer({ min: 0, max: 100000 });

    fc.assert(
      fc.property(seedArb, goalArb, turnsArb, (seed, goalText, turns) => {
        const s = buildRichSession(seed, goalText, turns);

        const clone = structuredClone(s);
        const after = deriveNodeStatus(s);

        // Input not mutated.
        expect(s).toEqual(clone);
        // Only graph.nodes[].status may differ.
        assertDeriveReadOnly(clone, after);
      }),
      { numRuns: 150 }
    );
  });
});
