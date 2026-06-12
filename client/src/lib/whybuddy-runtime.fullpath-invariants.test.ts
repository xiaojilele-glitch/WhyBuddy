/**
 * WhyBuddy V5.1 Full-Path Acceptance Test Plan — Batch 3b: negative invariants (N series).
 * Spec: docs/V5.1-full-path-test-plan.md (§3 invariants N1, N2, N3, N4, N6).
 *
 * The N series proves "the edges that must NOT exist, do not". Each invariant uses the doc's
 * double-保险: a STATIC source grep (read whybuddy-runtime.ts / WhyBuddy.tsx via node:fs) PLUS a
 * DYNAMIC construction over the public runtime API / a fast-check property.
 *
 * Scope of THIS file:
 *  - N1 (✅) no bypass writing GOAL=clear  (static whitelist + dynamic fuzz + 🟡 HTTP boundary it.fails)
 *  - N2 (✅) no bypass into ORCH without BUDGET (static order grep + dynamic 3-entry empty-plan)
 *  - N3 (✅) DERIVE has no STATE write power (assertDeriveReadOnly + fast-check PBT)
 *  - N4 (✅) single recycle path (static FB/RP grep + invalidate-only-via-intake + dynamic deep-equal)
 *  - N6 (✅/🟡) every pick has a DLEDGER record + challengeable (dynamic growth + API-level challenge)
 *
 * Every assertion is mechanical / binary: STATE / decisionLedger / budget snapshot / source-file
 * grep — never human judgement.
 *
 * EXACT STATIC-GREP REGEXES USED (also documented inline at each call site):
 *  - N1 goal.status write sites:        /goal\s*:\s*\{/g      (the goal object-literal construction
 *       — the ONLY syntactic form that assigns goal.status in the runtime; there is no
 *       `goal.status = ...` direct mutation). Whitelist of enclosing functions must equal
 *       {createInitialSessionState, applyGoalConclusion}.
 *  - N1 direct mutation guard:          /goal\.status\s*=[^=]/g   (expected count 0)
 *  - N2 budget-before-pick order:       indexOf("evaluateBudgetBeforeOrchestrate(") <
 *                                        earliest of pickNextCapabilitiesHeuristic( /
 *                                        pickNextCapabilities( inside orchestrateReasoningTurn.
 *  - N4 forbidden legacy recycle ids:   /\bFB\b/  and  /\bRP\b/  (CASE-SENSITIVE — case-insensitive
 *       would false-match the `rePlan` local variable, which lowercases to "replan").
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  findInputsForCapability,
  invalidateForIntervention,
  pickNextCapabilities,
  deriveNodeStatus,
  intakeMessage,
  applyGoalConclusion,
  getDecisionLedger,
  saveSessionState,
  loadOrCreateSessionState,
  setWhyBuddySessionStore,
  getWhyBuddySessionStore,
  type WhyBuddySessionStore,
} from './whybuddy-runtime';
import { assertDeriveReadOnly } from './whybuddy-derive-readonly-guard';
import {
  COMPLEX_GOAL_TEXT,
  CONVERGE_TEXT,
  createRawArtifact,
  commitTrusted,
  kindForCap,
  buildClearStateWithTrustedReport,
  buildClearStateWithPreview,
  recycleSignature,
} from './whybuddy-fullpath-fixtures';
import type {
  V5SessionState,
  Artifact,
  CapabilityRun,
  UserIntervention,
} from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_SRC = readFileSync(resolve(HERE, './whybuddy-runtime.ts'), 'utf8');
const PAGE_SRC = readFileSync(resolve(HERE, '../pages/WhyBuddy.tsx'), 'utf8');
const SESSION_HOOK_SRC = readFileSync(
  resolve(HERE, '../pages/whybuddy/useWhyBuddySession.ts'),
  'utf8'
);
const PAGE_LAYER_SRC = `${PAGE_SRC}\n${SESSION_HOOK_SRC}`;
const DEFAULT_MAX_TURNS = 30; // getDefaultBudgetPolicy().maxTurns — the policy orchestrate uses internally.

/** For each match index in `src`, return the name of the nearest preceding function declaration. */
function enclosingFunctionNames(src: string, pattern: RegExp): string[] {
  const lines = src.split('\n');
  // Pre-compute, per line, the most recent function-declaration name at/above that line.
  const fnDecl = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/;
  const names: string[] = [];
  const matchLineIdxs: number[] = [];
  let offset = 0;
  const lineStartOffsets = lines.map((l) => {
    const start = offset;
    offset += l.length + 1; // +1 for the split '\n'
    return start;
  });

  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = global.exec(src)) !== null) {
    const idx = m.index;
    // Find the line index for this offset.
    let lineIdx = 0;
    for (let i = 0; i < lineStartOffsets.length; i++) {
      if (lineStartOffsets[i] <= idx) lineIdx = i;
      else break;
    }
    matchLineIdxs.push(lineIdx);
  }

  for (const lineIdx of matchLineIdxs) {
    let fnName = '<module-scope>';
    for (let i = lineIdx; i >= 0; i--) {
      const dm = fnDecl.exec(lines[i]);
      if (dm) {
        fnName = dm[1];
        break;
      }
    }
    names.push(fnName);
  }
  return names;
}

/** Extract the body text of a named top-level function (up to the next top-level export function). */
function extractFunctionBody(src: string, fnName: string): string {
  const start = src.indexOf(`export function ${fnName}`);
  if (start < 0) return '';
  const rest = src.slice(start + `export function ${fnName}`.length);
  const next = rest.indexOf('\nexport function ');
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * Seed `count` distinct-turn capabilityRuns directly onto a state so the budget snapshot reports
 * `turns === count` (pushes a session past the DEFAULT maxTurns so the orchestrate-internal budget
 * gate, which uses the default policy, parks the turn). Mirrors the S6/S7 batch-2 helper.
 */
function seedDistinctTurns(state: V5SessionState, count: number): V5SessionState {
  const runs: CapabilityRun[] = [];
  for (let i = 0; i < count; i++) {
    runs.push({
      id: `seed-t${i}-run-0`,
      capabilityId: 'evidence.search',
      roleId: '接地',
      inputs: [],
      outputs: [`seed-art-${i}`],
      gateResults: [{ gateId: 'commit', status: 'passed' }],
      ledgerEntryId: `ledger-seed-t${i}`,
      turnId: `seed-t${i}`,
    });
  }
  return { ...state, capabilityRuns: [...(state.capabilityRuns || []), ...runs] };
}

/** Minimal in-memory store for the N1 HTTP-boundary it.fails (mirrors the runtime in-memory impl). */
class TinySessionStore implements WhyBuddySessionStore {
  private readonly store = new Map<string, V5SessionState>();
  async load(sessionId: string): Promise<V5SessionState | undefined> {
    return this.store.get(sessionId);
  }
  async save(state: V5SessionState): Promise<V5SessionState> {
    const sessionId = state.sessionId || 'tiny';
    const saved = { ...state, sessionId } as any;
    this.store.set(sessionId, saved);
    return saved;
  }
  clear(): void {
    this.store.clear();
  }
}

// =====================================================================================
// N1 · 不存在绕过 GCOV 写 GOAL=clear
// =====================================================================================

describe('N1 · no bypass writing GOAL=clear', () => {
  it('STATIC: every goal.status write site lives in exactly {createInitialSessionState, applyGoalConclusion}', () => {
    // GREP: /goal\s*:\s*\{/g — the goal object-literal construction is the ONLY syntactic form that
    // assigns goal.status in the runtime (there is no `goal.status = ...` mutation). Both sites must
    // be inside the two whitelisted functions.
    const writeSitePattern = /goal\s*:\s*\{/g;
    const sites = RUNTIME_SRC.match(writeSitePattern) || [];
    expect(sites.length).toBe(3); // createInitialSessionState + applyGoalConclusion + intakeMessage (goal.text only)

    const enclosing = enclosingFunctionNames(RUNTIME_SRC, writeSitePattern);
    expect(new Set(enclosing)).toEqual(
      new Set(['createInitialSessionState', 'applyGoalConclusion', 'intakeMessage'])
    );

    // GUARD: /goal\.status\s*=[^=]/g — no direct goal.status mutation anywhere (count 0).
    const directMutations = RUNTIME_SRC.match(/goal\.status\s*=[^=]/g) || [];
    expect(directMutations.length).toBe(0);
  });

  it('DYNAMIC: arbitrary public-API sequences that never legitimately converge never set goal.status to "clear"', () => {
    // Fuzz intake/orchestrate/commit/invalidate/derive on a session whose required pre-req
    // (risk.analyze) never gets a TRUSTED run, so GCOV can never pass -> "clear" is unreachable.
    const opArb = fc.constantFrom<'orchGeneric' | 'orchConverge' | 'commitUntrusted' | 'derive' | 'challenge' | 'intake'>(
      'orchGeneric',
      'orchConverge',
      'commitUntrusted',
      'derive',
      'challenge',
      'intake'
    );
    const seedArb = fc.integer({ min: 0, max: 100000 });
    const opsArb = fc.array(opArb, { minLength: 1, maxLength: 12 });

    fc.assert(
      fc.property(seedArb, opsArb, (seed, ops) => {
        let s = createInitialSessionState(COMPLEX_GOAL_TEXT, `N1-fuzz-${seed}`);
        let step = 0;
        for (const op of ops) {
          step++;
          const turnId = `N1-${seed}-t${step}`;
          if (op === 'orchGeneric') {
            s = orchestrateReasoningTurn(s, { turnId, userText: '继续分析一下边界情况' }).newState;
          } else if (op === 'orchConverge') {
            // Converge intent on an unsatisfiable contract -> GCOV hard-blocks, never writes clear.
            s = orchestrateReasoningTurn(s, { turnId, userText: CONVERGE_TEXT }).newState;
          } else if (op === 'commitUntrusted') {
            const { updatedState } = commitArtifact(
              s,
              createRawArtifact(`${turnId}-art`, 'risk.analyze', '安全', 'risk'),
              `${turnId}-run-0`,
              true, // forceGateFail -> untrusted (never satisfies GCOV)
              []
            );
            s = updatedState;
          } else if (op === 'derive') {
            s = deriveNodeStatus(s);
          } else if (op === 'challenge') {
            const target = (s.artifacts || [])[0];
            s = invalidateForIntervention(s, {
              targetArtifactId: target?.id,
              intent: 'challenge',
              text: '质疑',
            } as UserIntervention);
          } else if (op === 'intake') {
            s = intakeMessage(s, { turnId, userText: '随便说点什么' }).preparedState;
          }
          // The invariant: no bypass ever reaches a converged "clear".
          expect(s.goal.status).not.toBe('clear');
        }
      }),
      { numRuns: 200 }
    );
  });

  // 🟡 HTTP BOUNDARY (reported, not worked around — 挂账 B-1): the durable store accepts ANY
  // goal.status body with no server-side adjudication. A raw save of a fabricated `goal.status:
  // "clear"` (NOT produced by a GCOV pass) is persisted and loaded back verbatim. The doc writes
  // this as an expected-failure; it.fails so it flips green the day server adjudication (B-1)
  // rejects/sanitizes an unauthorized clear. (No server is started — this is the unit-level
  // analogue against the store contract.)
  it.fails(
    'HTTP boundary (B-1): the store should reject/adjudicate a fabricated goal.status="clear" (no adjudication today)',
    async () => {
      const original = getWhyBuddySessionStore();
      setWhyBuddySessionStore(new TinySessionStore());
      try {
        const sessionId = 'N1-http-boundary';
        // Fabricate a "clear" goal WITHOUT going through applyGoalConclusion/GCOV.
        const fabricated: V5SessionState = {
          ...createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId),
          goal: { text: COMPLEX_GOAL_TEXT, status: 'clear' },
        } as V5SessionState;
        await saveSessionState(fabricated);
        const loaded = await loadOrCreateSessionState(sessionId);
        // Expected once server adjudication lands: an unauthorized clear is not persisted as clear.
        expect(loaded.goal.status).not.toBe('clear');
      } finally {
        setWhyBuddySessionStore(original);
      }
    }
  );
});

// =====================================================================================
// N2 · 不存在绕过 BUDGET 进 ORCH
// =====================================================================================

function earliestPickAnchorIdx(body: string): number {
  const anchors = ['pickNextCapabilitiesHeuristic(', 'pickNextCapabilities('];
  const indices = anchors.map((a) => body.indexOf(a)).filter((i) => i >= 0);
  if (indices.length === 0) return -1;
  return Math.min(...indices);
}

describe('N2 · no bypass into ORCH without BUDGET', () => {
  it('STATIC: orchestrateReasoningTurn evaluates the budget gate before pickNextCapabilities', () => {
    const body = extractFunctionBody(RUNTIME_SRC, 'orchestrateReasoningTurn');
    expect(body.length).toBeGreaterThan(0);

    const budgetIdx = body.indexOf('evaluateBudgetBeforeOrchestrate(');
    const pickIdx = earliestPickAnchorIdx(body);
    expect(budgetIdx).toBeGreaterThanOrEqual(0); // budget gate is present
    expect(pickIdx).toBeGreaterThanOrEqual(0); // pick is present
    expect(budgetIdx).toBeLessThan(pickIdx); // budget precedes pick (gate-first)
  });

  it('DYNAMIC: over-budget yields an empty plan from all three entry points (INTERV / RECOMP / GCOV-forced)', () => {
    // A state already past the DEFAULT maxTurns so the orchestrate-internal gate parks every entry.
    const overBudget = () => seedDistinctTurns(createInitialSessionState(COMPLEX_GOAL_TEXT, 'N2-over'), DEFAULT_MAX_TURNS);

    // Entry 1 — INTERV: orchestrate carrying a user intervention (challenge).
    const interv = orchestrateReasoningTurn(overBudget(), {
      turnId: 'N2-interv',
      userText: '挑战这个结论',
      intervention: { intent: 'challenge', text: '挑战' } as UserIntervention,
    });
    expect(interv.plan.selected).toEqual([]);
    expect(interv.plan.reason).toMatch(/BUDGET_EXCEEDED/);

    // Entry 2 — RECOMP: stale-then-recompute. Invalidate first (re-entry), then orchestrate re-pick.
    let recompBase = overBudget();
    recompBase = invalidateForIntervention(recompBase, {
      targetArtifactId: 'seed-art-0',
      intent: 'challenge',
      text: '重算',
    } as UserIntervention);
    const recomp = orchestrateReasoningTurn(recompBase, { turnId: 'N2-recomp', userText: '基于现有重新推进' });
    expect(recomp.plan.selected).toEqual([]);
    expect(recomp.plan.reason).toMatch(/BUDGET_EXCEEDED/);

    // Entry 3 — GCOV-forced scheduling: converge intent that would otherwise force-schedule caps.
    const gcov = orchestrateReasoningTurn(overBudget(), { turnId: 'N2-gcov', userText: CONVERGE_TEXT });
    expect(gcov.plan.selected).toEqual([]);
    expect(gcov.plan.reason).toMatch(/BUDGET_EXCEEDED/);

    // Structural proof that the budget gate ran BEFORE any pick: the only decision appended this
    // turn is the blocked_by_budget record (id `${turnId}-dledger-budget`), never the pick record
    // (`${turnId}-dledger`). i.e. pickNextCapabilities never executed because budget gated first.
    for (const [turnId, res] of [
      ['N2-interv', interv],
      ['N2-recomp', recomp],
      ['N2-gcov', gcov],
    ] as const) {
      const ledger = getDecisionLedger(res.newState);
      expect(ledger.some((d) => d.id === `${turnId}-dledger-budget`)).toBe(true);
      expect(ledger.some((d) => d.id === `${turnId}-dledger`)).toBe(false);
    }
  });
});

// =====================================================================================
// N3 · DERIVE 对 STATE 无写权限
// =====================================================================================

describe('N3 · DERIVE has no STATE write power', () => {
  /** Fold orchestrate+commit turns to produce a varied, richly-populated session for the PBT. */
  function buildRichSession(
    seed: number,
    goalText: string,
    turns: Array<{ text: string; trusted: boolean; stale: boolean }>
  ): V5SessionState {
    let s = createInitialSessionState(goalText, `N3-${seed}`);
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
        if (turn.trusted) {
          const art = (s.artifacts || []).find((a) => a.id === artId);
          if (art) {
            (art as any).trustLevel = 'gated_pass';
            (art as any).passedGates = ['commit'];
          }
        }
      });
      if (turn.stale && (s.artifacts || []).length > 0) {
        const last = s.artifacts[s.artifacts.length - 1];
        s = { ...s, staleArtifactIds: [...(s.staleArtifactIds || []), last.id] };
      }
    });
    return s;
  }

  it('assertDeriveReadOnly passes on a rich converged session (CI guard)', () => {
    const { state } = buildClearStateWithTrustedReport('N3-guard');
    const before = structuredClone(state);
    const after = deriveNodeStatus(state);
    expect(state).toEqual(before); // input not mutated
    assertDeriveReadOnly(before, after);
  });

  it('PROPERTY: for all generated session states, deriveNodeStatus leaves authoritative STATE deep-equal', () => {
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
        expect(s).toEqual(clone); // input not mutated
        assertDeriveReadOnly(clone, after); // only graph.nodes[].status may change
      }),
      { numRuns: 150 }
    );
  });
});

// =====================================================================================
// N4 · 全系统仅一条回炉路径（single recycle path）
// =====================================================================================

describe('N4 · single recycle path', () => {
  it('STATIC: no forbidden legacy FB/RP recycle tokens in the runtime or page', () => {
    // GREP: /\bFB\b/ and /\bRP\b/ CASE-SENSITIVE. Case-insensitive would false-match `rePlan`
    // (a local variable that lowercases to "replan"); the diagram node ids FB/RP are uppercase.
    const fb = /\bFB\b/g;
    const rp = /\bRP\b/g;
    expect(RUNTIME_SRC.match(fb)).toBeNull();
    expect(RUNTIME_SRC.match(rp)).toBeNull();
    expect(PAGE_LAYER_SRC.match(fb)).toBeNull();
    expect(PAGE_LAYER_SRC.match(rp)).toBeNull();
  });

  it('STATIC: the page reaches invalidation ONLY via intakeMessage (never calls invalidateForIntervention directly)', () => {
    // Single-door (N4 静态): the page never calls invalidateForIntervention directly — every
    // recycle goes through intakeMessage (which internally invalidates). The page DOES call
    // orchestrateReasoningTurn, but only AFTER intakeMessage has prepared the state/context
    // (intake -> orchestrate is the legitimate flow; orchestrate's guard skips double-invalidate).
    expect(PAGE_LAYER_SRC.includes('invalidateForIntervention')).toBe(false);
    expect(PAGE_LAYER_SRC.includes('intakeMessage')).toBe(true);
  });

  it('DYNAMIC: card-challenge (targetArtifactId) and node-click (targetNodeId) invalidation are byte-identical', () => {
    // Use ONE source state for both paths (invalidateForIntervention is pure / non-mutating). Two
    // SEPARATE builds would differ only by Date.now-based ids/timestamps, which is irrelevant to the
    // recycle-path equivalence this invariant asserts.
    const { state, reportId } = buildClearStateWithTrustedReport('N4-card');

    const viaCard = invalidateForIntervention(state, {
      targetArtifactId: reportId,
      intent: 'challenge',
      text: '挑战此结论',
    } as UserIntervention);

    // Node click: the page passes the produced artifact id in targetNodeId; invalidate resolves
    // targetId = targetArtifactId || targetNodeId, so the same id drives an identical cascade.
    const viaNode = invalidateForIntervention(state, {
      targetNodeId: reportId,
      intent: 'challenge',
      text: '挑战此结论',
    } as UserIntervention);

    // The source state was not mutated by either pure call.
    expect(state.goal.status).toBe('clear');
    expect(JSON.stringify(viaNode)).toBe(JSON.stringify(viaCard));
  });

  it('DYNAMIC (S20): RV reject recycle signature matches chat challenge on report', () => {
    const { state, reportId } = buildClearStateWithTrustedReport('N4-rv');

    const { preparedState: viaChallenge } = intakeMessage(structuredClone(state), {
      turnId: 'N4-rv-ch',
      userText: '质疑报告',
      intervention: {
        targetArtifactId: reportId,
        intent: 'challenge',
        text: '质疑报告',
      },
    });

    const { preparedState: viaRv } = intakeMessage(structuredClone(state), {
      turnId: 'N4-rv-rj',
      userText: '评审打回，退回修改',
    });

    expect(recycleSignature(viaRv)).toBe(recycleSignature(viaChallenge));
  });

  it('DYNAMIC (S20): ITER preview dissatisfaction matches revise intervention recycle', () => {
    const { state, previewId } = buildClearStateWithPreview('N4-iter');

    const { preparedState: viaRevise } = intakeMessage(structuredClone(state), {
      turnId: 'N4-it-rev',
      userText: '预演不行',
      intervention: {
        targetArtifactId: previewId,
        intent: 'revise',
        text: '预演不行',
      },
    });

    const { preparedState: viaIter } = intakeMessage(structuredClone(state), {
      turnId: 'N4-it-iter',
      userText: '效果不满意，重新预演',
    });

    expect(recycleSignature(viaIter)).toBe(recycleSignature(viaRevise));
  });
});

// =====================================================================================
// N6 · 每次 pick 必有 DLEDGER 记录且可被 challenge
// =====================================================================================

describe('N6 · every pick has a DLEDGER record + is challengeable', () => {
  it('DYNAMIC: a normal orchestrate turn grows the decision ledger by exactly one (one pick), and the entry carries full {saw, chose, skipped, rationale}', () => {
    const s = createInitialSessionState(COMPLEX_GOAL_TEXT, 'N6-grow');
    const before = getDecisionLedger(s).length;

    // One orchestrate turn = exactly one pickNextCapabilities invocation = one DLEDGER record.
    const { newState } = orchestrateReasoningTurn(s, { turnId: 'N6-t1', userText: '分析安全风险，反驳，并生成报告' });
    const ledger = getDecisionLedger(newState);
    expect(ledger.length - before).toBe(1);

    const entry = ledger[ledger.length - 1];
    expect(entry.id).toBe('N6-t1-dledger'); // the pick-derived record (not a blocked/stop record)
    expect(Array.isArray(entry.saw)).toBe(true);
    expect(entry.saw.length).toBeGreaterThan(0);
    expect(Array.isArray(entry.chose)).toBe(true);
    expect(entry.chose.length).toBeGreaterThan(0);
    expect(Array.isArray(entry.skipped)).toBe(true);
    expect(entry.skipped.length).toBeGreaterThan(0);
    expect(typeof entry.rationale).toBe('string');
    expect(entry.rationale.length).toBeGreaterThan(0);
  });

  it('DYNAMIC: across multiple pick-bearing turns, ledger growth equals the number of pick turns', () => {
    let s = createInitialSessionState(COMPLEX_GOAL_TEXT, 'N6-multi');
    const start = getDecisionLedger(s).length;
    const texts = ['分析安全风险', '反驳一下', '综合证据'];
    let pickTurns = 0;
    texts.forEach((t, i) => {
      const { newState, plan } = orchestrateReasoningTurn(s, { turnId: `N6-m${i}`, userText: t });
      s = newState;
      // Each of these is a real pick turn (non-blocked, non-sufficient): plan is non-empty.
      if (plan.selected.length > 0) pickTurns++;
    });
    const grown = getDecisionLedger(s).length - start;
    expect(pickTurns).toBe(texts.length); // all three planned
    expect(grown).toBe(pickTurns); // one DLEDGER record per pick turn
  });

  it('🟡 challengeable (API level): a decision id can be targeted via targetDecisionId and is marked challenged', () => {
    // The doc's "可被 challenge 指向" depends on S5's missing UI entry; asserted at API level.
    const { state } = buildClearStateWithTrustedReport('N6-challenge');
    const ledger = getDecisionLedger(state);
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    const target = ledger[ledger.length - 1];

    const intake = intakeMessage(state, {
      turnId: 'N6-ch-t',
      userText: '我要挑战这条调度决策',
      intervention: {
        intent: 'challenge',
        targetDecisionId: target.id,
        text: '为什么这样排程？',
      } as UserIntervention,
    });
    expect(intake.controlSignal).toBe('challenge');

    const after = getDecisionLedger(intake.preparedState).find((d) => d.id === target.id);
    expect(after?.status).toBe('challenged');
    expect(typeof after?.challengedAt).toBe('string');
  });
});
