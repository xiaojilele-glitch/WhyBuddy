/**
 * Unit Tests — WhyBuddy V5.1 GOAL Conclusion Gate (Task 3.1)
 * Spec: .kiro/specs/whybuddy-goal-conclusion-gate/
 *
 * Focused unit coverage for the two pure/single-writer functions added in Task 3.1:
 *   - `deriveGoalConclusion(state, gateResult, contract)` maps a gate result + coverage state
 *     onto the next `goal.status`: "clear" / "not_recommended" / "needs_refinement".
 *   - `applyGoalConclusion(state, status)` is the single writer of `goal.status` and leaves the
 *     rest of the state structurally intact.
 *
 * These functions are NOT yet wired into `orchestrateReasoningTurn` (that is Task 3.2).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 3.3
 */

import { describe, it, expect } from 'vitest';
import {
  createInitialSessionState,
  commitArtifact,
  authorCoverageContract,
  waiveCoverageGap,
  evaluateCoverageGate,
  deriveGoalConclusion,
  applyGoalConclusion,
} from './whybuddy-runtime';
import type {
  V5SessionState,
  Artifact,
  CoverageGateResult,
} from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';

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
    producedBy: { capabilityRunId: `run-${id}`, capabilityId, roleId },
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
  const art = (updatedState.artifacts || []).find(
    (a: any) => a.producedBy?.capabilityId === capabilityId && a.id === id
  );
  if (art) {
    (art as any).trustLevel = 'gated_pass';
    (art as any).passedGates = ['commit'];
  }
  return updatedState;
}

const PASSED_GATE: CoverageGateResult = {
  passed: true,
  missingCapabilities: [],
  unresolvedGaps: [],
  waivedGaps: [],
  reason: 'test: passed',
};

describe('deriveGoalConclusion (pure GCOV conclusion mapping, Task 3.1)', () => {
  it('returns "clear" whenever the gate passed (regardless of gaps/runs)', () => {
    const s = createInitialSessionState('分析权限系统的风险并给出最终报告', 'unit-clear');
    expect(deriveGoalConclusion(s, PASSED_GATE, s.coverageContract)).toBe('clear');

    // Even with no contract and open gaps, a passed gate is authoritative.
    const failContract = authorCoverageContract('风险报告', 'u-clear').contract;
    expect(deriveGoalConclusion(s, PASSED_GATE, failContract)).toBe('clear');
  });

  it('returns "not_recommended" when all blocking gaps are waived but a required pre-req lacks a trusted run', () => {
    const goalText = '有风险的权限系统最终报告';
    let s = createInitialSessionState(goalText, 'unit-not-recommended');

    // Author + freeze contract, waive ALL blocking gaps, but DO NOT commit a trusted risk.analyze.
    const { contract, gaps } = authorCoverageContract(goalText, 'u-nr');
    s = { ...s, coverageContract: contract, coverageGaps: gaps };
    for (const gapId of contract.blockingGapIds) {
      s = waiveCoverageGap(s, gapId, 'user waived (unit test)');
    }

    const gate = evaluateCoverageGate(s, [], s.coverageContract);
    expect(gate.passed).toBe(false);
    expect(gate.missingCapabilities).toContain('risk.analyze');

    expect(deriveGoalConclusion(s, gate, s.coverageContract)).toBe('not_recommended');
  });

  it('returns "needs_refinement" when blocking gaps are still open (coverage not yet satisfiable/unsatisfiable)', () => {
    const goalText = '分析权限系统的风险并给出最终报告';
    let s = createInitialSessionState(goalText, 'unit-needs-refine');

    // Author contract, leave gaps OPEN (none waived, none resolved).
    const { contract, gaps } = authorCoverageContract(goalText, 'u-nr2');
    s = { ...s, coverageContract: contract, coverageGaps: gaps };
    expect((s.coverageGaps || []).some((g) => g.status === 'open')).toBe(true);

    const gate = evaluateCoverageGate(s, [], s.coverageContract);
    expect(gate.passed).toBe(false);

    expect(deriveGoalConclusion(s, gate, s.coverageContract)).toBe('needs_refinement');
  });

  it('returns "needs_refinement" when gaps are waived but the required pre-req IS trusted (not unsatisfiable)', () => {
    const goalText = '权限系统风险分析后的最终可行性报告';
    let s = createInitialSessionState(goalText, 'unit-needs-refine-trusted');

    // Trusted required pre-reqs present (incl. grounded evidence for G-GROUND contract).
    s = commitTrusted(s, 'risk-ok', 'risk.analyze', '安全', 'risk', 'u-rr0');
    s = commitTrusted(s, 'ev-ok', 'evidence.search', '接地', 'evidence', 'u-rr1');
    const ev = (s.artifacts || []).find((a) => a.id === 'ev-ok');
    if (ev) {
      (ev as any).provenance = 'mcp:github';
      (ev as any).payload = { evidenceSource: 'F1_Github_Source 取数' };
      (ev as any).summary = '【来源: F1_Github_Source 取数】';
    }

    const { contract, gaps } = authorCoverageContract(goalText, 'u-rr');
    s = { ...s, coverageContract: contract, coverageGaps: gaps };
    for (const gapId of contract.blockingGapIds) {
      s = waiveCoverageGap(s, gapId, 'user waived (unit test)');
    }

    // Force a non-passing gate result to exercise the fallthrough (gaps waived but not "unsatisfiable").
    const failGate: CoverageGateResult = {
      passed: false,
      missingCapabilities: [],
      unresolvedGaps: [],
      waivedGaps: contract.blockingGapIds,
      reason: 'test: forced non-pass with trusted pre-req',
    };
    expect(deriveGoalConclusion(s, failGate, s.coverageContract)).toBe('needs_refinement');
  });
});

describe('applyGoalConclusion (single writer of goal.status, Task 3.1)', () => {
  it('writes only goal.status and leaves the rest of the state structurally intact', () => {
    const s = createInitialSessionState('分析权限系统的风险并给出最终报告', 'unit-apply');
    const snapshotBefore = structuredClone(s);

    const next = applyGoalConclusion(s, 'clear');

    // goal.status updated.
    expect(next.goal.status).toBe('clear');
    // goal.text preserved.
    expect(next.goal.text).toBe(s.goal.text);

    // Every other top-level field is referentially preserved (only goal is a new object).
    expect(next.graph).toBe(s.graph);
    expect(next.artifacts).toBe(s.artifacts);
    expect(next.capabilityRuns).toBe(s.capabilityRuns);
    expect(next.decisions).toBe(s.decisions);
    expect(next.coverageGaps).toBe(s.coverageGaps);
    expect(next.decisionLedger).toBe(s.decisionLedger);
    expect(next.goal).not.toBe(s.goal);

    // The whole state, minus goal.status, is deep-equal to the original.
    expect({ ...next, goal: { ...next.goal, status: s.goal.status } }).toEqual(s);

    // Input is not mutated.
    expect(s).toEqual(snapshotBefore);
  });

  it('can write each conclusion value', () => {
    const s = createInitialSessionState('权限系统', 'unit-apply-each');
    expect(applyGoalConclusion(s, 'clear').goal.status).toBe('clear');
    expect(applyGoalConclusion(s, 'needs_refinement').goal.status).toBe('needs_refinement');
    expect(applyGoalConclusion(s, 'not_recommended').goal.status).toBe('not_recommended');
    // Original unchanged across calls.
    expect(s.goal.status).toBe('needs_refinement');
  });
});
