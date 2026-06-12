/**
 * WhyBuddy V5.1 Full-Path Acceptance Test Plan — Batch 1: core control plane + trust spine.
 * Spec: docs/V5.1-full-path-test-plan.md (§2 scenarios S1–S4, §5 suite layering).
 *
 * Scope of THIS file: S1 (cold start / new_goal single door), S2 (converge to clear + P1 coverage
 * replay), S3 (GCOV hard-block + forced scheduling), S4 (challenge -> cascade -> reconverge,
 * C-1 / C-2 acceptance + two-and-a-half loops + P2 deep-equal). All S1–S4 are ✅ tier in the doc.
 *
 * Every assertion is mechanical / binary, sourced ONLY from V5SessionState, the ledgers
 * (getSessionLedger / getDecisionLedger), and pure runtime helpers — never human judgement.
 *
 * STATUS-bar (DOM) assertions: the doc's S1 STATUS line ("轮次=1、已调用能力数>0") has no
 * dedicated DOM field on the page STATUS bar (round count is bound to `chatTurns.length`, which is
 * component-interaction state, and there is no rendered capability-count element). Per the doc's
 * own degrade rule, those are asserted as STATE fields here (distinct turn count === 1,
 * capabilityRuns > 0). The S2 conclusion-badge DOM binding ("已收敛 / clear" bound to
 * sessionState.goal.status) IS rendered, so it is asserted via SSR in the sibling file
 * whybuddy-runtime.fullpath-status.test.tsx (renderToStaticMarkup, no jsdom).
 */

import { describe, it, expect } from 'vitest';
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  findInputsForCapability,
  invalidateForIntervention,
  pickNextCapabilities,
  applyGoalConclusion,
  intakeMessage,
  markAwaiting,
  getSessionLedger,
  getDecisionLedger,
  evaluateCoverageGate,
  evaluateBudgetBeforeOrchestrate,
} from './whybuddy-runtime';
import {
  COMBO_TEXT,
  CONVERGE_TEXT,
  COMPLEX_GOAL_TEXT,
  createRawArtifact,
  createGroundedEvidenceRaw,
  commitTrusted,
  commitGroundedEvidence,
  driveConvergeTurn,
  buildClearStateWithTrustedReport,
  replayCoverage,
  countDistinctTurns,
} from './whybuddy-fullpath-fixtures';
import type {
  V5SessionState,
  Artifact,
  UserIntervention,
} from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';

const TRUSTED = new Set(['gated_pass', 'audited']);

/** Page-style same-round flow: intake -> orchestrate -> commit each planned cap -> markAwaiting. */
function runFullTurn(
  state: V5SessionState,
  turnId: string,
  userText: string
): { state: V5SessionState; controlSignal: string; committedIds: string[] } {
  const intake = intakeMessage(state, { turnId, userText });
  const { newState, plan } = orchestrateReasoningTurn(intake.preparedState, { turnId, userText });
  let working = newState;
  const committedIds: string[] = [];
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
    const raw =
      cap === 'evidence.search'
        ? createGroundedEvidenceRaw(`${turnId}-art-${idx}`)
        : createRawArtifact(`${turnId}-art-${idx}`, cap, role, kind);
    const { updatedState, committed } = commitArtifact(working, raw, runId, false, inputs);
    working = updatedState;
    if (committed) committedIds.push(committed.id);
  });
  working = markAwaiting(working, turnId);
  return { state: working, controlSignal: intake.controlSignal, committedIds };
}

// =====================================================================================
// S1 · 冷启动首轮（new_goal 单门入站）
// =====================================================================================

describe('S1 · cold start first turn (new_goal single-door intake)', () => {
  it('classifies the first message as new_goal and only the first message', () => {
    const fresh = createInitialSessionState('做一个权限管理系统', 'S1-coldstart');
    const first = intakeMessage(fresh, { turnId: 'S1-t1', userText: '做一个权限管理系统' });
    expect(first.controlSignal).toBe('new_goal');

    // Drive the first turn fully so state is non-empty, then the next message must NOT be new_goal.
    const turn1 = runFullTurn(fresh, 'S1-t1', COMBO_TEXT);
    const second = intakeMessage(turn1.state, { turnId: 'S1-t2', userText: '再补充一点' });
    expect(second.controlSignal).not.toBe('new_goal');
  });

  it('grows the decision ledger with full {saw, chose, skipped, rationale} fields on the first turn', () => {
    const fresh = createInitialSessionState('做一个权限管理系统', 'S1-dledger');
    const { newState } = orchestrateReasoningTurn(intakeMessage(fresh, { turnId: 'S1-d1', userText: COMBO_TEXT }).preparedState, {
      turnId: 'S1-d1',
      userText: COMBO_TEXT,
    });

    const ledger = getDecisionLedger(newState);
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    const latest = ledger[ledger.length - 1];
    expect(Array.isArray(latest.saw)).toBe(true);
    expect(latest.saw.length).toBeGreaterThan(0);
    expect(Array.isArray(latest.chose)).toBe(true);
    expect(latest.chose.length).toBeGreaterThan(0); // combo text plans a real team
    expect(Array.isArray(latest.skipped)).toBe(true);
    expect(latest.skipped.length).toBeGreaterThan(0);
    expect(typeof latest.rationale).toBe('string');
    expect(latest.rationale.length).toBeGreaterThan(0);
  });

  it('every committed artifact passedGates includes "commit" and trustLevel ∈ {gated_pass, audited}', () => {
    const turn1 = runFullTurn(createInitialSessionState('做一个权限管理系统', 'S1-trust'), 'S1-trust1', COMBO_TEXT);
    const committed = turn1.state.artifacts.filter((a) => TRUSTED.has(a.trustLevel));
    expect(committed.length).toBeGreaterThan(0);
    for (const art of committed) {
      expect(art.passedGates).toContain('commit');
      expect(TRUSTED.has(art.trustLevel)).toBe(true);
    }
    // The full team (combo text) committed all four — none left untrusted.
    expect(turn1.state.artifacts.every((a) => TRUSTED.has(a.trustLevel))).toBe(true);
  });

  it('parks at AWAIT with the round\'s turnId and the ledger entry count equals the capabilityRuns count', () => {
    const turnId = 'S1-await1';
    const turn1 = runFullTurn(createInitialSessionState('做一个权限管理系统', 'S1-await'), turnId, COMBO_TEXT);

    expect(turn1.state.runtimePhase).toBe('awaiting');
    expect((turn1.state as any).lastTurnId).toBe(turnId);

    // T_LEDGER: one ledger entry per capability run.
    expect(getSessionLedger(turn1.state).length).toBe(turn1.state.capabilityRuns.length);

    // STATUS-bar degrade (state fields): round count === 1, capability runs > 0.
    expect(countDistinctTurns(turn1.state)).toBe(1);
    expect(turn1.state.capabilityRuns.length).toBeGreaterThan(0);
  });
});

// =====================================================================================
// S2 · 标准收敛到 clear（灵魂循环第一圈）
// =====================================================================================

describe('S2 · standard convergence to clear (soul loop, first lap)', () => {
  it('a converge turn over trusted upstreams passes the coverage gate and writes goal.status = clear', () => {
    let s = createInitialSessionState(COMPLEX_GOAL_TEXT, 'S2-clear');
    s = commitTrusted(s, 'risk-1', 'risk.analyze', '安全', 'risk', 'S2-r0');
    s = commitGroundedEvidence(s, 'ev-ground-1', 'S2-r0b');
    s = commitTrusted(s, 'synth-1', 'synthesis.merge', '综合', 'synthesis', 'S2-r1');

    const { newState } = orchestrateReasoningTurn(s, {
      turnId: 'S2-cv',
      userText: CONVERGE_TEXT,
    });

    expect(newState.coverageGate?.passed).toBe(true);
    expect(newState.goal.status).toBe('clear');
  });

  it('the clear conclusion is reproducible only through applyGoalConclusion (single writer no-op proof)', () => {
    // applyGoalConclusion is the ONLY writer besides createInitialSessionState; re-applying the
    // same status is structurally identical except goal.status (binary single-writer proof).
    const { state } = buildClearStateWithTrustedReport('S2-writer');
    expect(state.goal.status).toBe('clear');
    const reapplied = applyGoalConclusion(state, 'clear');
    expect(reapplied).toEqual(state);
  });

  it('P1 replayCoverage lines up item-by-item with the contract required capabilities', () => {
    const { state } = buildClearStateWithTrustedReport('S2-replay');
    const replay = replayCoverage(state);

    expect(replay.hasContract).toBe(true);
    expect(replay.mode).toBe('complex');

    // Item-by-item: replay.required mirrors contract.requiredCapabilities in order.
    const contractRequired = (state.coverageContract as any).requiredCapabilities as string[];
    expect(replay.required.map((r) => r.capabilityId)).toEqual(contractRequired);

    // Every required pre-req (risk.analyze) is satisfied by a trusted committed artifact; the
    // convergence action (report.write) is satisfied by the trusted report.
    for (const line of replay.required) {
      expect(line.satisfied).toBe(true);
      expect(typeof line.satisfiedByArtifactId).toBe('string');
    }

    // Gaps: every blocking gap is resolved (none left open) once converged.
    expect(replay.openGapIds.length).toBe(0);
    expect(replay.resolvedGapIds.length).toBeGreaterThan(0);
    expect(replay.gatePassed).toBe(true);
  });
});

// =====================================================================================
// S3 · GCOV 硬阻断 + 强制排程
// =====================================================================================

describe('S3 · GCOV hard-block + forced scheduling', () => {
  /**
   * Build a COMPLEX-contract session missing a trusted risk.analyze run. An untrusted risk may
   * also exist; with the unified isHealthyArtifact predicate it no longer counts as "present".
   */
  function seedMissingRequiredCapability(sessionId: string): V5SessionState {
    let s = createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId);
    const { updatedState } = commitArtifact(
      s,
      createRawArtifact('untrusted-risk', 'risk.analyze', '安全', 'risk'),
      `${sessionId}-r0`,
      true, // forceGateFail -> untrusted
      []
    );
    s = updatedState;
    const art = s.artifacts.find((a) => a.id === 'untrusted-risk');
    expect(art?.trustLevel).toBe('untrusted');
    return s;
  }

  /**
   * GCOV hard-block setup: trusted synthesis exists (state-driven report.write) but no trusted
   * risk.analyze. Keyword text fills the per-turn pick cap (5) without report/可行性 tokens so
   * risk.analyze is not keyword-scheduled; the 5th slot is report.write from hasSynthesis.
   */
  function seedGcovHardBlock(sessionId: string): V5SessionState {
    let s = seedMissingRequiredCapability(sessionId);
    s = commitTrusted(s, 'trusted-synth', 'synthesis.merge', '综合', 'synthesis', `${sessionId}-s0`);
    return s;
  }

  it('evaluateCoverageGate fails when a required capability lacks a trusted committed run', () => {
    const s = seedMissingRequiredCapability('S3-gate');
    const gate = evaluateCoverageGate(
      s,
      [{ capabilityId: 'report.write', roleId: '综合' }],
      undefined
    );
    expect(gate.passed).toBe(false);
    expect(gate.missingCapabilities).toContain('risk.analyze');
  });

  it('a converge turn hard-blocks (GCOV_BLOCKED): empty plan, partial AWAIT, goal stays needs_refinement', () => {
    const s = seedGcovHardBlock('S3-block');
    // Keyword text fills the cap (5) with report.write (from trusted synthesis) but without
    // risk.analyze, so GCOV cannot force-schedule the missing pre-req this turn -> hard block.
    const { newState, plan } = orchestrateReasoningTurn(s, {
      turnId: 'S3-blk',
      userText: '路线对比，拆解结构，预览效果',
    });

    expect(plan.selected).toEqual([]);
    expect(plan.reason).toMatch(/GCOV_BLOCKED/);
    expect(newState.runtimePhase).toBe('awaiting');
    expect(newState.coverageGate?.passed).toBe(false);
    expect(newState.goal.status).toBe('needs_refinement'); // never jumps to clear

    // [GCOV] blocked note carried in conversation (auditable).
    expect((newState.conversation || []).some((c: any) => /\[GCOV\] blocked/.test(c.text))).toBe(true);

    // DLEDGER records a GCOV_BLOCKED rationale.
    const ledger = getDecisionLedger(newState);
    expect(ledger.some((d) => /GCOV_BLOCKED/.test(d.rationale))).toBe(true);
  });

  it('the missing capability is force-scheduled on the next converge turn (through the budget gate)', () => {
    const blocked = orchestrateReasoningTurn(seedGcovHardBlock('S3-force'), {
      turnId: 'S3-f0',
      userText: '路线对比，拆解结构，预览效果',
    }).newState;

    // Budget is checked before orchestrate runs (auditable: no over-limit on the parked state).
    const budget = evaluateBudgetBeforeOrchestrate(blocked, { turnId: 'S3-f1', userText: CONVERGE_TEXT });
    expect(budget.allowed).toBe(true);

    // Next converge turn: GCOV force-prepends the still-missing required risk.analyze into the plan.
    const { plan } = orchestrateReasoningTurn(blocked, { turnId: 'S3-f1', userText: CONVERGE_TEXT });
    const caps = plan.selected.map((p) => p.capabilityId);
    expect(caps).toContain('risk.analyze');
    expect(caps).toContain('report.write');
  });

  it('after supplying the missing capability (trusted), convergence reaches clear', () => {
    let s = seedMissingRequiredCapability('S3-recover');
    // Supply a trusted risk.analyze run (resolves the required pre-req + evidence gap).
    s = commitTrusted(s, 'trusted-risk', 'risk.analyze', '安全', 'risk', 'S3-rec-r0');
    s = commitGroundedEvidence(s, 'ev-ground-1', 'S3-rec-r0b');
    s = commitTrusted(s, 'trusted-synth', 'synthesis.merge', '综合', 'synthesis', 'S3-rec-r1', ['trusted-risk']);

    const { newState } = orchestrateReasoningTurn(s, { turnId: 'S3-rec-cv', userText: CONVERGE_TEXT });
    expect(newState.coverageGate?.passed).toBe(true);
    expect(newState.goal.status).toBe('clear');
  });
});

// =====================================================================================
// S4 · 挑战产物 → 级联失效 → 重新收敛（灵魂循环第二圈，C-1 / C-2 验收）
// =====================================================================================

describe('S4 · challenge -> cascade -> reconverge (soul loop second lap, C-1 / C-2)', () => {
  it('challenging risk cascades stale to the downstream report and marks graph nodes challenged', () => {
    const { state, reportId, riskId } = buildClearStateWithTrustedReport('S4-cascade');
    expect(state.goal.status).toBe('clear');

    const challenged = invalidateForIntervention(state, {
      targetArtifactId: riskId,
      intent: 'challenge',
      text: '这个风险分析有问题',
    } as UserIntervention);

    // Risk + its downstream report are both stale (dependency cascade).
    expect(challenged.staleArtifactIds).toContain(riskId);
    expect(challenged.staleArtifactIds).toContain(reportId);

    // Any graph nodes bound to the challenged runs become "challenged".
    const challengedNodes = (challenged.graph.nodes || []).filter((n: any) => n.status === 'challenged');
    expect(challengedNodes.length).toBeGreaterThan(0);
  });

  it('C-2: challenge downgrades goal.status to needs_refinement immediately (single-writer)', () => {
    const { state, riskId } = buildClearStateWithTrustedReport('S4-c2');
    expect(state.goal.status).toBe('clear');

    const challenged = invalidateForIntervention(state, {
      targetArtifactId: riskId,
      intent: 'challenge',
      text: '我质疑这个结论',
    } as UserIntervention);

    expect(challenged.goal.status).toBe('needs_refinement');
  });

  it('C-1: the next picks re-include BOTH risk.analyze and report.write after the challenge', () => {
    const { state, riskId } = buildClearStateWithTrustedReport('S4-c1');
    const challenged = invalidateForIntervention(state, {
      targetArtifactId: riskId,
      intent: 'challenge',
      text: '请重新评估风险并出报告',
    } as UserIntervention);

    const caps = pickNextCapabilities(challenged, '请基于现有证据重新生成最终报告').map((p) => p.capabilityId);
    expect(caps).toContain('risk.analyze');
    expect(caps).toContain('report.write');
  });

  it('reconverge reaches clear again with a fresh trusted report whose evidenceRefs are all non-stale (healthy) upstreams', () => {
    // Challenge the conclusion-supporting REPORT (the C-1/C-2 fix path the runtime supports): this
    // stales only the report, leaving its risk/synthesis upstreams fresh, so the same-round
    // reconverge can commit a brand-new TRUSTED report. (Challenging an upstream risk instead is a
    // known runtime limitation — see the it.fails below.)
    const { state, reportId } = buildClearStateWithTrustedReport('S4-reconverge');
    const challenged = invalidateForIntervention(state, {
      targetArtifactId: reportId,
      intent: 'challenge',
      text: '请重新生成最终报告',
    } as UserIntervention);
    expect(challenged.goal.status).toBe('needs_refinement');

    // Drive a full converge turn (orchestrate + commit each planned cap with fresh inputs).
    const reconverged = driveConvergeTurn(challenged, 'S4-rc', '请基于现有证据重新生成最终报告');

    const stales = new Set(reconverged.staleArtifactIds || []);
    const freshReports = reconverged.artifacts.filter(
      (a) =>
        a.kind === 'report' &&
        a.producedBy?.capabilityId === 'report.write' &&
        TRUSTED.has(a.trustLevel) &&
        !stales.has(a.id)
    );
    expect(freshReports.length).toBeGreaterThan(0);

    const freshReport = freshReports[freshReports.length - 1];
    // The fresh report references upstreams, and NONE of them is a stale (challenged) artifact.
    expect((freshReport.evidenceRefs || []).length).toBeGreaterThan(0);
    for (const ref of freshReport.evidenceRefs || []) {
      expect(stales.has(ref)).toBe(false);
    }
    // Specifically the freshly-staled old report is not referenced.
    expect(freshReport.evidenceRefs).not.toContain(reportId);

    // Re-running GCOV with a converge turn now writes clear again.
    const { newState } = orchestrateReasoningTurn(reconverged, {
      turnId: 'S4-rc2',
      userText: CONVERGE_TEXT,
    });
    expect(newState.goal.status).toBe('clear');
  });

  // KNOWN RUNTIME LIMITATION (reported, not worked around): challenging an UPSTREAM (risk) cannot
  // reconverge a TRUSTED report in the same flow on current code. After the risk is staled, a new
  // risk is committed this turn, but `findInputsForCapability` does NOT filter stale artifacts and
  // (capping at the needed-kind count) still grabs the leftover stale risk as a report upstream, so
  // the report's commit gate rejects it (untrusted). The C-1/C-2 *scheduling/downgrade* fixes are
  // landed (see the passing cascade/C-1/C-2 tests), but the stale upstream is not excluded from
  // input resolution. Marked it.fails so it flips to a failure (alerting us) once the runtime
  // filters stale upstreams in findInputsForCapability.
  it(
    'reconverging after challenging an UPSTREAM risk should produce a fresh trusted report (currently blocked by stale upstream grab in findInputsForCapability)',
    () => {
      const { state, riskId } = buildClearStateWithTrustedReport('S4-upstream-fail');
      const challenged = invalidateForIntervention(state, {
        targetArtifactId: riskId,
        intent: 'challenge',
        text: '请重新评估风险并生成最终报告',
      } as UserIntervention);
      const reconverged = driveConvergeTurn(challenged, 'S4-uf', '请基于现有证据重新生成最终报告');
      const stales = new Set(reconverged.staleArtifactIds || []);
      const freshReports = reconverged.artifacts.filter(
        (a) =>
          a.kind === 'report' &&
          a.producedBy?.capabilityId === 'report.write' &&
          TRUSTED.has(a.trustLevel) &&
          !stales.has(a.id)
      );
      expect(freshReports.length).toBeGreaterThan(0);
    }
  );

  it('two-and-a-half loops: challenging the 2nd clear still drives a working 3rd loop (stale set does not poison the new healthy set)', () => {
    // Loop 1: clear.
    const { state: clear1, reportId: report1 } = buildClearStateWithTrustedReport('S4-loops');
    expect(clear1.goal.status).toBe('clear');

    // Challenge the conclusion (report) -> reconverge -> clear (loop 2).
    const challenged1 = invalidateForIntervention(clear1, {
      targetArtifactId: report1,
      intent: 'challenge',
      text: '重新评估',
    } as UserIntervention);
    const reconverged1 = driveConvergeTurn(challenged1, 'S4-l2', '请基于现有证据重新生成最终报告');
    const clear2 = orchestrateReasoningTurn(reconverged1, { turnId: 'S4-l2cv', userText: CONVERGE_TEXT }).newState;
    expect(clear2.goal.status).toBe('clear');

    // Challenge the SECOND clear's fresh report -> C-2 downgrades again, and the 3rd loop must
    // still re-converge to clear. (Note: invalidateForIntervention REPLACES staleArtifactIds with
    // the new cascade rather than accumulating, so the loop-1 report un-stales and resurfaces as a
    // healthy trusted report — which is exactly "the stale set does not poison the new healthy
    // set". The 3rd loop therefore still converges.)
    const freshReport2 = clear2.artifacts
      .filter((a) => a.kind === 'report' && TRUSTED.has(a.trustLevel) && !(clear2.staleArtifactIds || []).includes(a.id))
      .slice(-1)[0];
    expect(freshReport2).toBeTruthy();

    const challenged2 = invalidateForIntervention(clear2, {
      targetArtifactId: freshReport2.id,
      intent: 'challenge',
      text: '第三圈再质疑一次',
    } as UserIntervention);
    expect(challenged2.goal.status).toBe('needs_refinement');

    const reconverged2 = driveConvergeTurn(challenged2, 'S4-l3', '请基于现有证据重新生成最终报告');
    const clear3 = orchestrateReasoningTurn(reconverged2, { turnId: 'S4-l3cv', userText: CONVERGE_TEXT }).newState;
    expect(clear3.goal.status).toBe('clear');
  });

  // RESTORED STRONG ASSERTION (whybuddy-stale-set-monotonic has landed). The doc's S4
  // "两圈半" intent is a MONOTONIC stale set: an id leaves only via supersede or explicit resolve,
  // so a later UNRELATED challenge (no reconverge/supersede in between) must NOT un-stale an
  // earlier challenge's victims. invalidateForIntervention now UNIONS the new cascade into the
  // prior staleArtifactIds instead of overwriting, so the first challenge's ids are preserved.
  // This assertion was previously weakened to "the 3rd loop still reaches clear"; it is now
  // restored from its it.fails placeholder to a passing assertion.
  // Tracked by .kiro/specs/whybuddy-stale-set-monotonic.
  it(
    'STRONG (monotonic stale set): a later unrelated challenge does not un-stale an earlier challenge\'s victims (no supersede/resolve between them)',
    () => {
      const { state, reportId } = buildClearStateWithTrustedReport('S4-monotonic');
      // Seed an UNRELATED standalone artifact (no dependency edges to the report) so the second
      // challenge's cascade is just itself and cannot re-include the report by dependency.
      const staged = commitTrusted(state, 'mono-unrelated', 'evidence.search', '接地', 'evidence', 'S4-mono-x');

      // Challenge 1: stale the report.
      const c1 = invalidateForIntervention(staged, {
        targetArtifactId: reportId,
        intent: 'challenge',
        text: '挑战报告',
      } as UserIntervention);
      expect(c1.staleArtifactIds).toContain(reportId);

      // Challenge 2: an UNRELATED artifact, with NO reconverge/supersede in between.
      const c2 = invalidateForIntervention(c1, {
        targetArtifactId: 'mono-unrelated',
        intent: 'challenge',
        text: '挑战一条无关件',
      } as UserIntervention);

      // Monotonic invariant: the report staled by challenge 1 was neither superseded nor resolved,
      // so it MUST remain stale after challenge 2 (now preserved by the union semantics).
      expect(c2.staleArtifactIds).toContain(reportId);
      expect(c2.staleArtifactIds).toContain('mono-unrelated');
    }
  );

  it('P2: card-challenge (targetArtifactId) and node-click (targetNodeId) produce byte-identical serialized state', () => {
    const { state, reportId } = buildClearStateWithTrustedReport('S4-p2');
    // Clone so both entry points start from byte-identical state (avoid Date.now() drift between builds).
    const cardState = structuredClone(state);
    const nodeState = structuredClone(state);

    const viaCard = invalidateForIntervention(cardState, {
      targetArtifactId: reportId,
      intent: 'challenge',
      text: '挑战此结论',
    } as UserIntervention);

    // Node click: target by node id, but the page passes the produced artifact id in targetNodeId
    // when no enriched artifact id is available. invalidateForIntervention resolves
    // targetId = targetArtifactId || targetNodeId, so the same id drives an identical cascade.
    const viaNode = invalidateForIntervention(nodeState, {
      targetNodeId: reportId,
      intent: 'challenge',
      text: '挑战此结论',
    } as UserIntervention);

    expect(JSON.stringify(viaNode)).toBe(JSON.stringify(viaCard));
  });
});
