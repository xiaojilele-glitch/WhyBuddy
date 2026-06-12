/**
 * Preservation Property Tests — WhyBuddy V5.1 Reconverge Loop Fix
 * Spec: .kiro/specs/whybuddy-reconverge-loop-fix/ (Task 2, Property 2: Preservation)
 *
 * OBSERVATION-FIRST METHODOLOGY: These tests are written against UNFIXED code and are
 * EXPECTED TO PASS. They record the current (baseline) behavior for every flow where neither
 * bug condition holds (¬C1 fresh-kind picks / ordinary turns; ¬C2 unrelated challenges,
 * non-converged sessions, and the GCOV-pass write path), plus the single-writer and DERIVE P3
 * invariants. After the fix lands (Task 3.4) the SAME tests MUST STILL PASS — proving the C-1
 * stale-aware presence change and the C-2 single-writer downgrade did not disturb any non-buggy
 * flow.
 *
 * KEY DEVICE — `picksFixedReference`:
 *   `pickNextCapabilities` consumes `state.artifacts` ONLY to build `existingKinds`
 *   (`hasRisk` / `hasSynthesis` / `hasReport`). Every other input (staleArtifactIds count,
 *   capabilityRuns, openQuestions, ledger) is independent of the artifacts array. The C-1 fix
 *   replaces `existingKinds = Set(allArtifacts.map(kind))` with
 *   `existingKinds = Set(nonStaleArtifacts.map(kind))`. Therefore the FIXED behavior of
 *   `pickNextCapabilities(state)` equals the ORIGINAL behavior of `pickNextCapabilities(state')`
 *   where `state'` has the stale artifacts removed from `state.artifacts`. We capture that as
 *   `picksFixedReference`. For inputs where C-1 does NOT hold, the original and fixed picks are
 *   identical, so `pickNextCapabilities(state) === picksFixedReference(state)` holds BOTH on the
 *   unfixed code (today) and on the fixed code (idempotent filter), which is exactly the
 *   ¬C1 preservation equality from design Property 2.
 *
 * Property 2 (design): For any input where the C-1 bug condition does NOT hold,
 *   `pickNextCapabilities_fixed` produces picks identical to `pickNextCapabilities_original`;
 *   for any challenge where the C-2 bug condition does NOT hold (unrelated challenge /
 *   non-converged session), `invalidateForIntervention(...).goal.status` is unchanged;
 *   `applyGoalConclusion` remains the only assigner of `goal.status`; the GCOV-pass write path
 *   stays unchanged; and DERIVE P3 keeps projecting only `graph.nodes[].status`.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
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
  deriveNodeStatus,
  findInputsForCapability,
} from './whybuddy-runtime';
import { assertDeriveReadOnly } from './whybuddy-derive-readonly-guard';
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
  markTrusted(updatedState, id);
  return updatedState;
}

function kindForCap(capabilityId: string): Artifact['kind'] {
  if (capabilityId === 'report.write') return 'report';
  if (capabilityId === 'risk.analyze') return 'risk';
  if (capabilityId === 'synthesis.merge') return 'synthesis';
  if (capabilityId === 'counter.argue') return 'risk';
  return 'evidence';
}

/**
 * Models the FIXED `pickNextCapabilities`: it differs from the original ONLY by excluding stale
 * artifacts when computing `existingKinds`. Since `state.artifacts` feeds nothing else in the
 * function, running the ORIGINAL on a stale-filtered artifacts array yields exactly the FIXED
 * result. On the ¬C1 domain, original === this reference, both before and after the fix.
 */
function picksFixedReference(
  state: V5SessionState,
  userText: string
): Array<{ capabilityId: V5CapabilityId; roleId: string }> {
  const stales = new Set(state.staleArtifactIds || []);
  const filtered: V5SessionState = {
    ...state,
    artifacts: (state.artifacts || []).filter((a: any) => !stales.has(a.id)),
  };
  return pickNextCapabilities(filtered, userText);
}

/**
 * Drive a session to `goal.status === "clear"` with a TRUSTED, committed `report` artifact.
 * Mirrors the page's first-convergence flow (trusted risk + synthesis upstreams, a converge turn
 * that GCOV-passes, then commit the planned report.write).
 */
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

/** Fold a sequence of orchestrate+commit turns to produce a richly populated session. */
function buildRichSession(
  seed: number,
  goalText: string,
  turns: Array<{ text: string; trusted: boolean; stale: boolean }>
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
        false,
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

// =====================================================================================
// ¬C1 PRESERVATION: pickNextCapabilities picks unchanged for non-buggy inputs
// =====================================================================================

describe('PRESERVATION (¬C1): pickNextCapabilities picks unchanged when no stale-of-kind exists (baseline — PASSES on unfixed code)', () => {
  // ---- Concrete baseline observations ----

  it('fresh trusted report present (empty staleArtifactIds): converge text does NOT schedule a duplicate report.write (Req 3.1)', () => {
    const { state } = buildClearStateWithTrustedReport('pres-c1-fresh');
    // Sanity: a fresh, non-stale, trusted report exists and nothing is stale.
    expect((state.staleArtifactIds || []).length).toBe(0);
    expect(
      (state.artifacts || []).some((a: any) => a.kind === 'report' && a.trustLevel === 'gated_pass')
    ).toBe(true);

    const caps = pickNextCapabilities(state, '请生成最终报告 总结 可行性').map((p) => p.capabilityId);
    // No duplicate report.write while a fresh report already exists.
    expect(caps).not.toContain('report.write');
    // And the picks equal the fixed-reference picks (no stale → filter is a no-op).
    expect(pickNextCapabilities(state, '请生成最终报告 总结 可行性')).toEqual(
      picksFixedReference(state, '请生成最终报告 总结 可行性')
    );
  });

  it('ordinary turns with empty staleArtifactIds: picks equal the fixed-reference picks for varied user texts (Req 3.2)', () => {
    const texts = [
      '先看看有哪些边界情况',
      '路线对比 拆解结构',
      '继续分析风险',
      '收敛并总结',
      '请澄清需求',
      '预览效果',
    ];
    for (const t of texts) {
      const s = createInitialSessionState('分析权限系统的风险并给出最终报告', `pres-c1-ord-${t}`);
      expect((s.staleArtifactIds || []).length).toBe(0);
      // Equality to the fixed reference (no stale → identical), and a stable, deduped, capped shape.
      const picks = pickNextCapabilities(s, t);
      expect(picks).toEqual(picksFixedReference(s, t));
      expect(picks.length).toBeLessThanOrEqual(5);
      const keys = picks.map((p) => `${p.capabilityId}:${p.roleId}`);
      expect(new Set(keys).size).toBe(keys.length); // deduped
      // Determinism: same inputs → same picks.
      expect(pickNextCapabilities(s, t)).toEqual(picks);
    }
  });

  it('stale artifact of a kind that ALSO has a fresh artifact (¬C1): picks equal the fixed-reference picks', () => {
    // Two risk artifacts; stale one, keep the other fresh. hasFreshOfKind === true ⇒ ¬C1.
    let s = createInitialSessionState('分析权限系统的风险并给出最终报告', 'pres-c1-mixed');
    s = commitTrusted(s, 'risk-a', 'risk.analyze', '安全', 'risk', 'mix-r0');
    s = commitTrusted(s, 'risk-b', 'risk.analyze', '安全', 'risk', 'mix-r1');
    s = { ...s, staleArtifactIds: ['risk-a'] };

    // A fresh risk still exists, so 'risk' presence is unchanged by stale-aware filtering.
    const text = '请基于证据重新分析风险并生成报告';
    expect(pickNextCapabilities(s, text)).toEqual(picksFixedReference(s, text));
  });

  // ---- Property over the ¬C1 domain ----

  it('PROPERTY (¬C1, empty stale): for all ordinary states with no stale artifacts, picks equal fixed-reference and are well-formed', () => {
    const goalArb = fc.constantFrom(
      '分析权限系统的风险并给出最终报告',
      '整理会议纪要并输出摘要',
      '权限系统安全审计报告',
      '简单总结当前进展'
    );
    const turnsArb = fc.array(
      fc.record({
        text: fc.constantFrom('分析风险', '综合证据', '生成最终报告', '先看边界', '路线对比', '继续推进'),
        trusted: fc.boolean(),
        stale: fc.constant(false),
      }),
      { minLength: 0, maxLength: 4 }
    );
    const userTextArb = fc.constantFrom(
      '请生成最终报告',
      '请重新综合并生成报告',
      '继续分析风险',
      '路线对比 拆解结构',
      '先看看边界情况',
      '收敛并总结'
    );
    const seedArb = fc.integer({ min: 0, max: 100000 });

    fc.assert(
      fc.property(seedArb, goalArb, turnsArb, userTextArb, (seed, goalText, turns, userText) => {
        const s = buildRichSession(seed, goalText, turns);
        // Scope: ¬C1 via empty stale set (no stale artifact of any kind).
        fc.pre((s.staleArtifactIds || []).length === 0);

        const picks = pickNextCapabilities(s, userText);
        // Equality to fixed reference (filter is a no-op when nothing is stale).
        expect(picks).toEqual(picksFixedReference(s, userText));
        // Well-formed: deduped + capped.
        expect(picks.length).toBeLessThanOrEqual(5);
        const keys = picks.map((p) => `${p.capabilityId}:${p.roleId}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 150 }
    );
  });

  it('PROPERTY (¬C1, stale-but-fresh-duplicate): when a staled kind still has a fresh artifact, picks equal fixed-reference', () => {
    const kindArb = fc.constantFrom<{ kind: Artifact['kind']; cap: V5CapabilityId }>(
      { kind: 'risk', cap: 'risk.analyze' },
      { kind: 'synthesis', cap: 'synthesis.merge' },
      { kind: 'report', cap: 'report.write' }
    );
    const userTextArb = fc.constantFrom(
      '请生成最终报告',
      '请重新综合并生成报告',
      '基于证据重新分析风险并生成报告',
      '继续推进'
    );
    const seedArb = fc.integer({ min: 0, max: 100000 });

    fc.assert(
      fc.property(kindArb, userTextArb, seedArb, ({ kind, cap }, userText, seed) => {
        let s = createInitialSessionState('分析权限系统的风险并给出最终报告', `c1mix-${seed}`);
        s = commitTrusted(s, `a-${seed}`, cap, '综合', kind, `c1mix-${seed}-r0`);
        s = commitTrusted(s, `b-${seed}`, cap, '综合', kind, `c1mix-${seed}-r1`);
        // Stale one of the two; a fresh artifact of `kind` remains ⇒ ¬C1 (hasFreshOfKind).
        s = { ...s, staleArtifactIds: [`a-${seed}`] };

        const stales = new Set(s.staleArtifactIds);
        const hasFresh = (s.artifacts || []).some((x: any) => x.kind === kind && !stales.has(x.id));
        fc.pre(hasFresh);

        expect(pickNextCapabilities(s, userText)).toEqual(picksFixedReference(s, userText));
      }),
      { numRuns: 120 }
    );
  });
});

// =====================================================================================
// ¬C2 PRESERVATION: goal.status unchanged for unrelated challenges / non-converged sessions
// =====================================================================================

describe('PRESERVATION (¬C2): invalidateForIntervention leaves goal.status unchanged for non-buggy challenges (baseline — PASSES on unfixed code)', () => {
  it('non-converged session: a challenge that stales artifacts leaves goal.status === "needs_refinement"', () => {
    let s = createInitialSessionState('分析权限系统的风险并给出最终报告', 'pres-c2-noncon');
    s = commitTrusted(s, 'risk-1', 'risk.analyze', '安全', 'risk', 'nc-r0');
    expect(s.goal.status).toBe('needs_refinement');

    const challenged = invalidateForIntervention(s, {
      targetArtifactId: 'risk-1',
      intent: 'challenge',
      text: '我质疑这个风险分析',
    } as UserIntervention);

    // Something was staled, but the session was never converged ⇒ no downgrade applies.
    expect(challenged.staleArtifactIds).toContain('risk-1');
    expect(challenged.goal.status).toBe('needs_refinement');
    expect(challenged.goal).toEqual(s.goal);
  });

  it('converged "clear" session: challenging an UNRELATED standalone artifact leaves goal.status === "clear"', () => {
    const { state: clearState, reportId } = buildClearStateWithTrustedReport('pres-c2-unrelated');
    expect(clearState.goal.status).toBe('clear');

    // Add a standalone, unrelated artifact with no dependency edges to the report.
    const { updatedState } = commitArtifact(
      clearState,
      createRawArtifact('extra-unrelated', 'evidence.search', '接地', 'evidence'),
      'pres-c2-extra-run',
      false,
      []
    );
    markTrusted(updatedState, 'extra-unrelated');

    const challenged = invalidateForIntervention(updatedState, {
      targetArtifactId: 'extra-unrelated',
      intent: 'challenge',
      text: '我质疑这条无关证据',
    } as UserIntervention);

    // The conclusion-supporting report is NOT staled; only the unrelated artifact is.
    expect(challenged.staleArtifactIds).toContain('extra-unrelated');
    expect(challenged.staleArtifactIds).not.toContain(reportId);
    // Conclusion left intact (challenge did not undermine the converged conclusion).
    expect(challenged.goal.status).toBe('clear');
  });

  it('intervention with no target leaves the whole state (and goal.status) untouched', () => {
    const { state: clearState } = buildClearStateWithTrustedReport('pres-c2-notarget');
    expect(clearState.goal.status).toBe('clear');

    const challenged = invalidateForIntervention(clearState, {
      intent: 'clarify',
      text: '只是想澄清一下，没有指定目标',
    } as UserIntervention);

    expect(challenged.goal.status).toBe('clear');
    expect(challenged.goal).toEqual(clearState.goal);
  });

  it('PROPERTY (¬C2, non-converged): for all non-converged sessions and arbitrary challenges, goal.status stays "needs_refinement"', () => {
    const seedArb = fc.integer({ min: 0, max: 100000 });
    const kindArb = fc.constantFrom<{ kind: Artifact['kind']; cap: V5CapabilityId }>(
      { kind: 'risk', cap: 'risk.analyze' },
      { kind: 'synthesis', cap: 'synthesis.merge' },
      { kind: 'report', cap: 'report.write' },
      { kind: 'evidence', cap: 'evidence.search' }
    );
    const intentArb = fc.constantFrom<UserIntervention['intent']>('challenge', 'revise', 'clarify', 'expand');
    const targetExistsArb = fc.boolean();

    fc.assert(
      fc.property(seedArb, kindArb, intentArb, targetExistsArb, (seed, { kind, cap }, intent, targetExists) => {
        let s = createInitialSessionState('分析权限系统的风险并给出最终报告', `c2nc-${seed}`);
        s = commitTrusted(s, `art-${seed}`, cap, '综合', kind, `c2nc-${seed}-r0`);
        // Session was never converged.
        fc.pre(s.goal.status === 'needs_refinement');

        const intervention: UserIntervention = {
          targetArtifactId: targetExists ? `art-${seed}` : `ghost-${seed}`,
          intent,
          text: '挑战/澄清',
        } as UserIntervention;

        const next = invalidateForIntervention(s, intervention);
        // Non-converged ⇒ no legitimate downgrade ⇒ unchanged.
        expect(next.goal.status).toBe('needs_refinement');
        expect(next.goal).toEqual(s.goal);
      }),
      { numRuns: 150 }
    );
  });
});

// =====================================================================================
// SHARED PRESERVATION: GCOV-pass write, single-writer applyGoalConclusion, DERIVE P3
// =====================================================================================

describe('PRESERVATION (shared): GCOV-pass write, single-writer, DERIVE P3 invariants (baseline — PASSES on unfixed code)', () => {
  it('GCOV-pass write path is unchanged: a converge turn over trusted upstreams writes "clear" (Req 3.5)', () => {
    let s = createInitialSessionState('分析权限系统的风险并给出最终报告', 'pres-gcov-pass');
    s = commitTrusted(s, 'risk-1', 'risk.analyze', '安全', 'risk', 'gp-r0');
    s = commitGroundedEvidence(s, 'ev-ground-1', 'gp-r0b');
    s = commitTrusted(s, 'synth-1', 'synthesis.merge', '综合', 'synthesis', 'gp-r1');

    const { newState } = orchestrateReasoningTurn(s, {
      turnId: 'pres-gcov-pass-cv',
      userText: '现在可以出最终报告了',
    });
    // GCOV passes ⇒ single-writer applyGoalConclusion writes the conclusion.
    expect(newState.goal.status).toBe('clear');
  });

  it('applyGoalConclusion is a pure single-field writer: only goal.status changes, everything else deep-equals (Req 3.6)', () => {
    const { state } = buildClearStateWithTrustedReport('pres-single-writer');
    const before = structuredClone(state);

    const downgraded = applyGoalConclusion(state, 'needs_refinement');
    // The single writer must not mutate the input.
    expect(state).toEqual(before);
    // Only goal.status differs; all other goal fields and the rest of state are unchanged.
    expect(downgraded.goal.status).toBe('needs_refinement');
    expect({ ...downgraded.goal, status: undefined }).toEqual({ ...state.goal, status: undefined });
    expect({ ...downgraded, goal: undefined }).toEqual({ ...state, goal: undefined });
  });

  it('DERIVE P3 unchanged: deriveNodeStatus changes only graph.nodes[].status on a rich session (Req 3.7)', () => {
    const s = buildRichSession(7, '分析权限系统的风险并给出最终可行性报告', [
      { text: '分析风险', trusted: true, stale: false },
      { text: '综合证据', trusted: true, stale: false },
      { text: '生成最终报告', trusted: false, stale: true },
    ]);
    expect((s.graph?.nodes || []).length).toBeGreaterThan(0);
    expect((s.artifacts || []).length).toBeGreaterThan(0);

    const clone = structuredClone(s);
    const after = deriveNodeStatus(s);
    expect(s).toEqual(clone); // input not mutated
    assertDeriveReadOnly(clone, after);
  });

  it('PROPERTY (DERIVE P3): for all generated session states, DERIVE leaves authoritative STATE deep-equal', () => {
    const goalArb = fc.constantFrom(
      '分析权限系统的风险并给出最终报告',
      '整理会议纪要并输出摘要',
      '权限系统安全审计报告',
      '复杂风险评估与可行性报告'
    );
    const turnsArb = fc.array(
      fc.record({
        text: fc.constantFrom('分析风险', '综合证据', '生成最终报告', '先看边界', '路线对比', '继续推进'),
        trusted: fc.boolean(),
        stale: fc.boolean(),
      }),
      { minLength: 1, maxLength: 4 }
    );
    const seedArb = fc.integer({ min: 0, max: 100000 });

    fc.assert(
      fc.property(seedArb, goalArb, turnsArb, (seed, goalText, turns) => {
        const s = buildRichSession(seed, goalText, turns);
        const clone = structuredClone(s);
        const after = deriveNodeStatus(s);
        expect(s).toEqual(clone);
        assertDeriveReadOnly(clone, after);
      }),
      { numRuns: 120 }
    );
  });
});
