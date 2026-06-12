/**
 * Bug Condition Exploration Test — WhyBuddy V5.1 GOAL Conclusion Gate
 * Spec: .kiro/specs/whybuddy-goal-conclusion-gate/ (Task 1, Property 1: Bug Condition)
 *
 * CRITICAL: These tests are written against UNFIXED code and are EXPECTED TO FAIL.
 * The failure confirms the bug: a session that reaches a GCOV-pass never writes the
 * conclusion (`goal.status` stays "needs_refinement"). There is no GOAL-write path at all.
 *
 * DO NOT "fix" these tests or the production code here. They encode the EXPECTED behavior
 * (design Property 1 / isBugCondition) and will be re-run after the fix lands (Task 3.5),
 * where they MUST flip from FAIL -> PASS.
 *
 * Property 1 (design): For any session + orchestrate turn where
 *   evaluateCoverageGate(...).passed === true, the orchestrator SHALL produce a state with
 *   goal.status === "clear" (written by the GCOV-owned conclusion step, never by ORCH
 *   scheduling logic); and where coverage cannot be satisfied the same GCOV-gated step SHALL
 *   write goal.status === "not_recommended".
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  evaluateCoverageGate,
  authorCoverageContract,
  waiveCoverageGap,
  type CoverageGateResult,
} from './whybuddy-runtime';
import type { V5SessionState, Artifact } from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';

// ---- helpers (mirror conventions from whybuddy-runtime.test.ts) ----

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
  runId: string
): V5SessionState {
  const { updatedState } = commitArtifact(
    state,
    createRawArtifact(id, capabilityId, roleId, kind),
    runId,
    false,
    []
  );
  // Defensive: ensure trusted + not stale (matches existing GCOV tests).
  const art = (updatedState.artifacts || []).find(
    (a: any) => a.producedBy?.capabilityId === capabilityId && a.id === id
  );
  if (art) {
    (art as any).trustLevel = 'gated_pass';
    (art as any).passedGates = ['commit'];
  }
  return updatedState;
}

/** Grounded external evidence (passes G-GROUND). */
function commitGroundedEvidence(
  state: V5SessionState,
  id: string,
  runId: string
): V5SessionState {
  const { updatedState } = commitArtifact(
    state,
    {
      ...createRawArtifact(
        id,
        'evidence.search',
        '接地',
        'evidence',
        '【来源: F1_Github_Source 取数】外部证据片段'
      ),
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

describe('WhyBuddy GCOV-pass writes goal.status when G-GROUND satisfied (Property 1)', () => {
  // ---- Concrete failing seeds (deterministic, reproducible counterexamples) ----

  it('GCOV-pass after a trusted risk.analyze combo => goal.status should be "clear"', () => {
    const goalText = '分析权限系统的风险并给出最终报告';
    let s = createInitialSessionState(goalText, 'bug-gcov-pass-combo');

    // Seed trusted required pre-reqs + grounded evidence (G-GROUND) + synthesis upstream.
    s = commitTrusted(s, 'risk-1', 'risk.analyze', '安全', 'risk', 'combo-r0');
    s = commitGroundedEvidence(s, 'ev-1', 'combo-r1');
    s = commitTrusted(s, 'synth-1', 'synthesis.merge', '综合', 'synthesis', 'combo-r2');

    const { newState } = orchestrateReasoningTurn(s, {
      turnId: 'combo-converge',
      userText: '现在可以出最终报告了',
    });

    // Sanity: this turn really is in the GCOV-pass domain.
    const gate = newState.coverageGate as CoverageGateResult | undefined;
    expect(gate?.passed).toBe(true);

    // EXPECTED (design Property 1) — FAILS on unfixed code (stays "needs_refinement").
    expect(newState.goal.status).toBe('clear');
  });

  it('GCOV-pass via waived blocking gaps (pre-reqs trusted) => goal.status should be "clear"', () => {
    const goalText = '权限系统风险分析后的最终可行性报告';
    let s = createInitialSessionState(goalText, 'bug-gcov-pass-waived');

    // Trusted required pre-reqs + grounded evidence present.
    s = commitTrusted(s, 'risk-2', 'risk.analyze', '安全', 'risk', 'wv-r0');
    s = commitGroundedEvidence(s, 'ev-2', 'wv-r1');

    // Pre-author + freeze the contract so orchestrate does not re-author/auto-resolve,
    // then waive every blocking gap (the "waived" GCOV-pass mechanism).
    const { contract, gaps } = authorCoverageContract(goalText, 'wv');
    s = { ...s, coverageContract: contract, coverageGaps: gaps };
    for (const gapId of contract.blockingGapIds) {
      s = waiveCoverageGap(s, gapId, 'user waived (test)');
    }

    const { newState } = orchestrateReasoningTurn(s, {
      turnId: 'wv-converge',
      userText: '出最终报告',
    });

    const gate = newState.coverageGate as CoverageGateResult | undefined;
    expect(gate?.passed).toBe(true);

    // EXPECTED — FAILS on unfixed code.
    expect(newState.goal.status).toBe('clear');
  });

  it('coverage cannot be satisfied (gaps waived but required pre-req never trusted) => goal.status should be "not_recommended"', () => {
    const goalText = '有风险的权限系统最终报告';
    let s = createInitialSessionState(goalText, 'bug-gcov-unsatisfiable');

    // Author + freeze contract, waive all blocking gaps, but DO NOT commit a trusted risk.analyze.
    const { contract, gaps } = authorCoverageContract(goalText, 'ns');
    s = { ...s, coverageContract: contract, coverageGaps: gaps };
    for (const gapId of contract.blockingGapIds) {
      s = waiveCoverageGap(s, gapId, 'user waived (test)');
    }

    const { newState } = orchestrateReasoningTurn(s, {
      turnId: 'ns-converge',
      userText: '出最终报告',
    });

    // Required pre-req risk.analyze still lacks a trusted committed run -> coverage unsatisfiable.
    const gate = newState.coverageGate as CoverageGateResult | undefined;
    expect(gate?.passed).toBe(false);
    expect(gate?.missingCapabilities).toContain('risk.analyze');

    // EXPECTED (design Property 1) — FAILS on unfixed code (conclusion never computed, stays "needs_refinement").
    expect(newState.goal.status).toBe('not_recommended');
  });

  // ---- Property over the GCOV-pass domain (scoped PBT) ----

  it('PROPERTY: for all sessions where evaluateCoverageGate(...).passed === true, post-orchestrate goal.status === "clear"', () => {
    const complexGoalArb = fc.constantFrom(
      '分析权限系统的风险并给出最终报告',
      '权限系统风险分析后的最终可行性报告',
      '复杂目标：风险分析后报告',
      '安全审计风险评估并产出最终报告'
    );
    const convergeTextArb = fc.constantFrom(
      '现在可以出最终报告了',
      '出最终报告',
      '生成可行性报告',
      '收敛并总结报告'
    );
    const withSynthesisArb = fc.boolean();
    const seedArb = fc.integer({ min: 0, max: 100000 });

    fc.assert(
      fc.property(complexGoalArb, convergeTextArb, withSynthesisArb, seedArb, (goalText, convergeText, withSynthesis, seed) => {
        let s = createInitialSessionState(goalText, `bug-gcov-prop-${seed}`);

        // Build a GCOV-pass candidate: trusted required pre-reqs + grounded evidence.
        s = commitTrusted(s, `risk-${seed}`, 'risk.analyze', '安全', 'risk', `prop-${seed}-r0`);
        s = commitGroundedEvidence(s, `ev-${seed}`, `prop-${seed}-r1`);
        if (withSynthesis) {
          s = commitTrusted(s, `synth-${seed}`, 'synthesis.merge', '综合', 'synthesis', `prop-${seed}-r2`);
        }

        const { newState } = orchestrateReasoningTurn(s, {
          turnId: `prop-${seed}-converge`,
          userText: convergeText,
        });

        // Scope the property to the GCOV-pass domain only.
        const gate = newState.coverageGate as CoverageGateResult | undefined;
        fc.pre(gate?.passed === true);

        // EXPECTED (design Property 1) — FAILS on unfixed code for every GCOV-pass input.
        expect(newState.goal.status).toBe('clear');
      }),
      { numRuns: 100 }
    );
  });
});
