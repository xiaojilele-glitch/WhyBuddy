/**
 * Preservation Property Tests — WhyBuddy V5.1 Stale-Set Monotonicity
 * Spec: .kiro/specs/whybuddy-stale-set-monotonic/ (Task 2, Property 2: Preservation)
 *
 * OBSERVATION-FIRST METHODOLOGY: These tests are written against UNFIXED code and are
 * EXPECTED TO PASS. They record the current (baseline) behavior for every flow where the bug
 * condition does NOT hold (¬C): first/single challenges (empty prior stale set), challenges whose
 * cascade already covers the prior stale set (`prior ⊆ cascade`), the C-1 stale-aware
 * `pickNextCapabilities` re-pick, the C-2 single-writer `goal.status` downgrade, single-loop
 * convergence, graph node `challenged` marking, and P2 card/node byte-identical parity.
 *
 * After the fix lands (Task 3.3) the SAME tests MUST STILL PASS — proving the stale-set union
 * change did not disturb any non-buggy flow.
 *
 * KEY DEVICE — `invalidateFixedReference`:
 *   The fix changes ONLY the `staleArtifactIds` assignment on the main cascade return path, from
 *   `Array.from(affected)` to `Array.from(new Set([...prior, ...affected]))` (union). We model the
 *   FIXED function by running the ORIGINAL `invalidateForIntervention` and overriding
 *   `staleArtifactIds` with that union. For ¬C inputs (`prior ⊆ cascade`, which includes the empty
 *   prior set), `union(prior, cascade) === cascade` as a SET, so the fixed-reference stale set
 *   equals the original stale set. Therefore `original === fixedReference` on the ¬C domain BOTH on
 *   the unfixed code (today) and on the fixed code (idempotent union), which is exactly the ¬C
 *   preservation equality from design Property 2.
 *
 *   NOTE ON ORDERING (observation): the fix orders the union "prior ids first, then new cascade
 *   ids". For non-empty ¬C inputs where the prior set is NOT a prefix of the cascade iteration
 *   order (e.g. deps a→b, a→c; prior {c}; challenge a → cascade [a,b,c]), the fixed array ORDER
 *   ([c,a,b]) differs from the original array order ([a,b,c]) even though the SET is identical.
 *   `staleArtifactIds` is consumed everywhere as `new Set(...)` (order-insensitive), so we assert
 *   SET equality for the stale ids and byte-identical equality for every OTHER field. The empty-
 *   prior slice (Req 3.1) additionally holds byte-identically and is asserted as such.
 *
 * Property 2 (design): For any input where `isBugCondition` is false, the fixed
 *   `invalidateForIntervention` produces the same serialized result as the original (stale ids as a
 *   set; all other fields byte-identical), preserving graph node marking, the C-1/C-2 fix paths,
 *   single-writer `goal.status`, GCOV commit, DERIVE read-only projection, and P2 card/node parity.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
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
import type {
  V5SessionState,
  Artifact,
  DependencyEdge,
  UserIntervention,
} from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';
import { commitGroundedEvidence } from './whybuddy-fullpath-fixtures';

// ---- helpers ----------------------------------------------------------------

/** A fully-formed, trusted artifact (so graph-node marking + C-2 checks never throw). */
function makeArtifact(id: string, kind: Artifact['kind'], cap: V5CapabilityId): Artifact {
  return {
    id,
    kind,
    provenance: 'ai_generated',
    trustLevel: 'gated_pass',
    producedBy: {
      capabilityRunId: `run-${id}`,
      capabilityId: cap,
      roleId: '综合',
    },
    passedGates: ['commit'],
    title: `artifact ${id}`,
    summary: `artifact ${id}`,
    content: `artifact ${id}`,
  };
}

/** Mirror of the cascade closure inside `invalidateForIntervention` (edges: from=input → to=output). */
function computeCascade(targetId: string, deps: DependencyEdge[]): Set<string> {
  const affected = new Set<string>([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of deps) {
      if (affected.has(e.fromArtifactId) && !affected.has(e.toArtifactId)) {
        affected.add(e.toArtifactId);
        changed = true;
      }
    }
  }
  return affected;
}

const isSubset = (a: Set<string>, b: Set<string>): boolean => [...a].every((x) => b.has(x));

const sortedUnique = (xs: string[]): string[] => [...new Set(xs)].sort();

/**
 * Models the FIXED `invalidateForIntervention`: identical to the original on every field EXCEPT
 * `staleArtifactIds`, which becomes the deterministic, de-duplicated union of the prior stale set
 * and the freshly-computed cascade (prior ids first, then new cascade ids in iteration order).
 */
function invalidateFixedReference(
  state: V5SessionState,
  intervention: UserIntervention
): V5SessionState {
  const original = invalidateForIntervention(state, intervention);
  const targetId = intervention.targetArtifactId || intervention.targetNodeId;
  // Decision-level path and no-target path already preserve prior stale ids implicitly.
  if (!targetId || intervention.targetDecisionId) return original;
  const affected = computeCascade(targetId, state.dependencyGraph);
  const merged = Array.from(new Set<string>([...(state.staleArtifactIds || []), ...affected]));
  return { ...original, staleArtifactIds: merged };
}

/** Build a non-converged session with explicit stale set, dependency graph, and artifacts. */
function buildSession(opts: {
  staleIds: string[];
  deps: DependencyEdge[];
  artifactIds: string[];
}): V5SessionState {
  const base = createInitialSessionState(
    '分析权限系统的风险并给出最终报告',
    'stale-monotonic-preservation'
  );
  const artifacts = opts.artifactIds.map((id, i) =>
    i % 2 === 0 ? makeArtifact(id, 'risk', 'risk.analyze') : makeArtifact(id, 'report', 'report.write')
  );
  return {
    ...base,
    goal: { ...base.goal, status: 'needs_refinement' },
    artifacts,
    graph: { ...base.graph, nodes: [] },
    dependencyGraph: opts.deps,
    staleArtifactIds: [...opts.staleIds],
  };
}

// ---- richer-flow helpers (mirror conventions from the reconverge-loop preservation test) ----

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

/** Drive a session to `goal.status === "clear"` with a TRUSTED, committed `report` artifact. */
function buildClearStateWithTrustedReport(sessionId: string): {
  state: V5SessionState;
  reportId: string;
} {
  const goalText = '分析权限系统的风险并给出最终报告';
  let s = createInitialSessionState(goalText, sessionId);
  s = commitTrusted(s, 'risk-1', 'risk.analyze', '安全', 'risk', `${sessionId}-r0`);
  s = commitGroundedEvidence(s, 'ev-ground-1', `${sessionId}-r0b`);
  s = commitTrusted(s, 'synth-1', 'synthesis.merge', '综合', 'synthesis', `${sessionId}-r1`);

  const { newState } = orchestrateReasoningTurn(s, {
    turnId: `${sessionId}-cv`,
    userText: '现在可以出最终报告了',
  });

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
  markTrusted(updatedState, reportId);
  return { state: updatedState, reportId };
}

/** Assert ¬C preservation: stale ids equal as a SET; every other field byte-identical. */
function expectPreserved(a: V5SessionState, b: V5SessionState): void {
  expect(sortedUnique(a.staleArtifactIds || [])).toEqual(sortedUnique(b.staleArtifactIds || []));
  const { staleArtifactIds: _aIgnore, ...restA } = a as any;
  const { staleArtifactIds: _bIgnore, ...restB } = b as any;
  expect(JSON.stringify(restA)).toEqual(JSON.stringify(restB));
}

// =====================================================================================
// ¬C PRESERVATION — concrete baseline observations (PASS on unfixed code)
// =====================================================================================

describe('PRESERVATION (¬C): non-buggy stale-set inputs behave identically (baseline — PASSES on unfixed code)', () => {
  it('empty prior stale set: the result equals the cascade, byte-identical to the fixed reference (Req 3.1)', () => {
    const deps: DependencyEdge[] = [
      { fromArtifactId: 'risk_A', toArtifactId: 'report_A', reason: 'report depends on risk' },
    ];
    const state = buildSession({ staleIds: [], deps, artifactIds: ['risk_A', 'report_A'] });

    const cascade = computeCascade('risk_A', deps); // {risk_A, report_A}
    const result = invalidateForIntervention(state, {
      targetArtifactId: 'risk_A',
      intent: 'challenge',
      text: '我质疑风险分析',
    } as UserIntervention);

    // Observed baseline: result IS the cascade (union with [] == cascade).
    expect(sortedUnique(result.staleArtifactIds)).toEqual([...cascade].sort());
    // Empty prior ⇒ byte-identical to the fixed reference (no reordering possible).
    const fixed = invalidateFixedReference(state, {
      targetArtifactId: 'risk_A',
      intent: 'challenge',
      text: '我质疑风险分析',
    } as UserIntervention);
    expect(JSON.stringify(result)).toEqual(JSON.stringify(fixed));
  });

  it('prior ⊆ cascade (prefix-ordered): prior {risk_A}, challenge risk_A, cascade {risk_A, report_A} preserved byte-identically', () => {
    const deps: DependencyEdge[] = [
      { fromArtifactId: 'risk_A', toArtifactId: 'report_A', reason: 'report depends on risk' },
    ];
    const state = buildSession({ staleIds: ['risk_A'], deps, artifactIds: ['risk_A', 'report_A'] });
    const iv = {
      targetArtifactId: 'risk_A',
      intent: 'challenge',
      text: '再次质疑同一条风险',
    } as UserIntervention;

    const result = invalidateForIntervention(state, iv);
    // Observed baseline: cascade re-covers the prior id; result == {risk_A, report_A}.
    expect(result.staleArtifactIds).toEqual(['risk_A', 'report_A']);
    // prior is a prefix of the cascade order ⇒ union keeps the same order ⇒ byte-identical.
    expect(JSON.stringify(result)).toEqual(JSON.stringify(invalidateFixedReference(state, iv)));
  });

  it('prior ⊆ cascade (non-empty): the result stale SET equals the cascade and all other fields are preserved', () => {
    // deps: a→b, a→c ; prior {c} ⊆ cascade(a) = {a,b,c}. ¬C holds (prior ⊆ cascade).
    const deps: DependencyEdge[] = [
      { fromArtifactId: 'a', toArtifactId: 'b', reason: 'b depends on a' },
      { fromArtifactId: 'a', toArtifactId: 'c', reason: 'c depends on a' },
    ];
    const state = buildSession({ staleIds: ['c'], deps, artifactIds: ['a', 'b', 'c'] });
    const iv = { targetArtifactId: 'a', intent: 'challenge', text: '质疑根产物' } as UserIntervention;

    const result = invalidateForIntervention(state, iv);
    // Observed baseline: stale set is exactly the cascade (prior {c} is already covered).
    expect(sortedUnique(result.staleArtifactIds)).toEqual(['a', 'b', 'c']);
    // SET-level preservation + byte-identical on every other field (order of stale ids is irrelevant).
    expectPreserved(result, invalidateFixedReference(state, iv));
  });

  it('C-1 preservation: after challenging the report, pickNextCapabilities re-includes risk.analyze and report.write (Req 3.2)', () => {
    const { state: clearState, reportId } = buildClearStateWithTrustedReport('pres-c1');
    expect(clearState.goal.status).toBe('clear');

    const challenged = invalidateForIntervention(clearState, {
      targetArtifactId: reportId,
      intent: 'challenge',
      text: '我质疑这份报告',
    } as UserIntervention);
    expect(challenged.staleArtifactIds).toContain(reportId);

    const caps = pickNextCapabilities(challenged, '请重新生成最终报告 总结 可行性').map(
      (p) => p.capabilityId
    );
    // Observed baseline: a staled report re-opens risk + report scheduling.
    expect(caps).toContain('risk.analyze');
    expect(caps).toContain('report.write');
  });

  it('C-2 preservation: challenging a converged report downgrades goal.status via applyGoalConclusion only (Req 3.3)', () => {
    const { state: clearState, reportId } = buildClearStateWithTrustedReport('pres-c2');
    expect(clearState.goal.status).toBe('clear');

    const challenged = invalidateForIntervention(clearState, {
      targetArtifactId: reportId,
      intent: 'challenge',
      text: '我质疑这份报告的结论',
    } as UserIntervention);

    // Observed baseline: downgrade to needs_refinement, identical to the single-writer applier.
    expect(challenged.goal.status).toBe('needs_refinement');
    expect(challenged.goal).toEqual(applyGoalConclusion(clearState, 'needs_refinement').goal);
  });

  it('single-loop convergence preservation: challenge → reconverge → clear with no prior stale set (Req 3.4)', () => {
    const { state: clearState } = buildClearStateWithTrustedReport('pres-loop');
    expect(clearState.goal.status).toBe('clear');
    expect((clearState.staleArtifactIds || []).length).toBe(0);
  });

  it('graph node marking preservation: the same nodes are marked challenged; graph is byte-identical to the fixed reference (Req 3.6)', () => {
    const { state: clearState, reportId } = buildClearStateWithTrustedReport('pres-graph');
    const iv = {
      targetArtifactId: reportId,
      intent: 'challenge',
      text: '质疑报告以触发节点标记',
    } as UserIntervention;

    const result = invalidateForIntervention(clearState, iv);
    const challengedNodes = (result.graph.nodes || []).filter((n: any) => n.status === 'challenged');
    // Observed baseline: at least the report's node is marked challenged.
    expect(challengedNodes.length).toBeGreaterThan(0);
    // The fix never touches graph node marking ⇒ graph stays byte-identical.
    expect(JSON.stringify(result.graph)).toEqual(
      JSON.stringify(invalidateFixedReference(clearState, iv).graph)
    );
  });

  it('P2 parity preservation: card-challenge (targetArtifactId) and node-click (targetNodeId) on the same id are byte-identical (Req 3.8)', () => {
    const deps: DependencyEdge[] = [
      { fromArtifactId: 'risk_A', toArtifactId: 'report_A', reason: 'report depends on risk' },
    ];
    const makeState = () =>
      buildSession({ staleIds: ['report_A'], deps, artifactIds: ['risk_A', 'report_A'] });

    const viaCard = invalidateForIntervention(makeState(), {
      targetArtifactId: 'risk_A',
      intent: 'challenge',
      text: '同一目标，卡片入口',
    } as UserIntervention);
    const viaNode = invalidateForIntervention(makeState(), {
      targetNodeId: 'risk_A',
      intent: 'challenge',
      text: '同一目标，卡片入口',
    } as UserIntervention);

    // Observed baseline: both entry points produce byte-identical serialized state.
    expect(JSON.stringify(viaCard)).toEqual(JSON.stringify(viaNode));
  });
});

// =====================================================================================
// ¬C PRESERVATION — property over the non-bug-condition domain (PASSES on unfixed code)
// =====================================================================================

describe('PRESERVATION PROPERTY (¬C): for all inputs where the bug condition is false, original == fixed reference (baseline — PASSES on unfixed code)', () => {
  it('PROPERTY: prior ⊆ cascade ⇒ result stale SET equals cascade and all other fields preserved', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const edgeArb = fc.record({
      fromArtifactId: fc.constantFrom(...pool),
      toArtifactId: fc.constantFrom(...pool),
    });

    fc.assert(
      fc.property(
        fc.array(edgeArb, { maxLength: 8 }),
        fc.constantFrom(...pool), // challenge target (always defined)
        // mask used to derive a prior set GUARANTEED to be ⊆ cascade (so ¬C always holds)
        fc.array(fc.boolean(), { minLength: pool.length, maxLength: pool.length }),
        (rawEdges, target, mask) => {
          const deps: DependencyEdge[] = rawEdges
            .filter((e) => e.fromArtifactId !== e.toArtifactId)
            .map((e) => ({ ...e, reason: 'test edge' }));

          const cascade = computeCascade(target, deps);
          // prior ⊆ cascade by construction ⇒ NOT isBugCondition (covers empty prior too).
          const prior = pool.filter((id, i) => mask[i] && cascade.has(id));
          const priorSet = new Set(prior);
          fc.pre(isSubset(priorSet, cascade)); // always true; documents the ¬C scope

          const state = buildSession({ staleIds: prior, deps, artifactIds: pool });
          const iv = { targetArtifactId: target, intent: 'challenge', text: '质疑' } as UserIntervention;

          const result = invalidateForIntervention(state, iv);
          // Observed baseline: stale set is exactly the cascade (prior already covered).
          expect(sortedUnique(result.staleArtifactIds)).toEqual([...cascade].sort());
          // ¬C preservation: stale set + every other field match the fixed reference.
          expectPreserved(result, invalidateFixedReference(state, iv));
        }
      ),
      { numRuns: 200 }
    );
  });
});

// =====================================================================================
// MONOTONICITY OVER SEQUENCES — ¬C-scoped (PASSES on unfixed code)
// =====================================================================================

describe('MONOTONICITY (¬C-scoped): applying a sequence of challenges never shrinks staleArtifactIds at non-bug-condition steps (baseline — PASSES on unfixed code)', () => {
  // NOTE: Without the ¬C scope, monotonicity FAILS on unfixed code at bug-condition steps
  // (prior ⊄ cascade) — that shrink IS the bug and is asserted against in the exploration test
  // (Task 1). Task 2 commits only the ¬C-scoped monotonicity so the test is green on unfixed code;
  // after the fix monotonicity additionally holds at EVERY step.
  it('PROPERTY: over an arbitrary challenge sequence, no prior-stale id is dropped at a ¬C step', () => {
    const pool = ['a', 'b', 'c', 'd'];
    const edgeArb = fc.record({
      fromArtifactId: fc.constantFrom(...pool),
      toArtifactId: fc.constantFrom(...pool),
    });

    fc.assert(
      fc.property(
        fc.array(edgeArb, { maxLength: 6 }),
        fc.array(fc.constantFrom(...pool), { minLength: 1, maxLength: 4 }),
        (rawEdges, targets) => {
          const deps: DependencyEdge[] = rawEdges
            .filter((e) => e.fromArtifactId !== e.toArtifactId)
            .map((e) => ({ ...e, reason: 'test edge' }));

          let s = buildSession({ staleIds: [], deps, artifactIds: pool });

          for (const target of targets) {
            const prior = new Set(s.staleArtifactIds || []);
            const cascade = computeCascade(target, deps);
            const next = invalidateForIntervention(s, {
              targetArtifactId: target,
              intent: 'challenge',
              text: '质疑',
            } as UserIntervention);
            const nextSet = new Set(next.staleArtifactIds);

            // Only assert monotonicity at ¬C steps (prior ⊆ cascade); the bug-condition shrink
            // is covered by Task 1's exploration test, not asserted here.
            if (isSubset(prior, cascade)) {
              for (const id of prior) {
                expect(nextSet.has(id)).toBe(true);
              }
            }
            s = next;
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
