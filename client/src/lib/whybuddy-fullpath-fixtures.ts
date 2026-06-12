/**
 * Shared fixtures / helpers for the WhyBuddy V5.1 Full-Path Acceptance Test Plan.
 * Spec: docs/V5.1-full-path-test-plan.md
 *
 * This module is the SINGLE source of reusable fixtures for the full-path scenario suites
 * (S1–S10 across batches). It deliberately mirrors the proven helper conventions already used by
 *   - client/src/lib/whybuddy-runtime.test.ts (combo commit loop, semantic contents)
 *   - client/src/lib/whybuddy-runtime.reconverge-loop.bug.test.ts (commitTrusted / buildClear...)
 *   - client/src/lib/whybuddy-runtime.reconverge-loop.preservation.test.ts (markTrusted / kindForCap)
 * so later batches can import from here instead of re-deriving them.
 *
 * REALITY-CHECK NOTES (matched against the ACTUAL runtime, not the doc's idealized fixture table):
 *  - `authorCoverageContract` produces, for a COMPLEX goal, required = [risk.analyze, evidence.search, report.write],
 *    conditional = [synthesis.merge], plus a G-GROUND missing_evidence blocking gap. (The doc's
 *    "[risk.analyze, counter.argue, synthesis.merge, report.write, evidence.search]" list is
 *    idealized.) For a SIMPLE goal, required = [report.write].
 *  - `BudgetPolicy` has ONLY { maxTurns, maxCapabilityRunsPerTurn, maxCapabilityRunsPerSession,
 *    maxRepeatPerCapability }. There is NO maxTokens. `LOW_BUDGET_POLICY` below is provided as the
 *    low-limit override for super-limit scenarios (S6/S7/S8 in later batches).
 */

import {
  createInitialSessionState,
  orchestrateReasoningTurn,
  commitArtifact,
  findInputsForCapability,
  type BudgetPolicy,
} from './whybuddy-runtime';
import type {
  V5SessionState,
  Artifact,
} from '@shared/blueprint/v5-reasoning-state';
import type { V5CapabilityId } from '@shared/blueprint/contracts';

// ===== Trigger-word constants (plan §1 trigger cheatsheet + existing combo test) =====

/** Plans the full V5 team (risk.analyze + counter.argue + synthesis.merge + report.write). */
export const COMBO_TEXT = '分析安全风险，反驳 RBAC，并生成可行性报告';
/** Carries convergence intent (报告 / 可行性 / 总结 / 收敛). */
export const CONVERGE_TEXT = '生成可行性报告';
/** A goal whose contract resolves to COMPLEX (contains 风险/安全). */
export const COMPLEX_GOAL_TEXT = '分析权限系统的风险并给出最终报告';

/**
 * Low-limit budget policy for super-limit scenarios. Matches the doc's intent
 * (maxTurns=3, per-turn cap, per-cap repeat cap) using ONLY fields that exist on BudgetPolicy
 * (there is no maxTokens). Pass this as the 3rd arg to evaluateBudgetBeforeOrchestrate.
 */
export const LOW_BUDGET_POLICY: BudgetPolicy = {
  maxTurns: 3,
  maxCapabilityRunsPerTurn: 5,
  maxCapabilityRunsPerSession: 120,
  maxRepeatPerCapability: 2,
  maxTokensPerSession: 500_000,
};

// ===== Semantic payloads (so aggregation / report content is meaningful) =====

export const SEMANTIC_CONTENTS: Partial<Record<V5CapabilityId, string>> = {
  'risk.analyze':
    '数据范围越权风险（仅 RBAC 不足以表达跨部门/项目/租户边界）；审计风险（权限变更需保留操作者、时间、影响对象）。',
  'counter.argue':
    '反驳过早引入 ABAC（会增加策略调试成本）；建议 MVP 先采用 RBAC + scoped data filter，保留策略接口。',
  'synthesis.merge': '本轮从上游聚合的初步结论：权限系统建议采用 RBAC + 数据范围 MVP，预留策略扩展。',
  'report.write': '【可行性 / 产品推演报告】结论：建议推进权限系统建设。',
};

// ===== Raw artifact + trust helpers (proven patterns from the bugfix suites) =====

export function createRawArtifact(
  id: string,
  capabilityId: V5CapabilityId,
  roleId: string,
  kind: Artifact['kind'],
  contentOverride?: string
): Omit<Artifact, 'trustLevel'> {
  const content =
    contentOverride ?? SEMANTIC_CONTENTS[capabilityId] ?? `${roleId} 通过 ${capabilityId} 贡献了内容。`;
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

/** Force an already-committed artifact to be trusted + not-stale (mirrors the bugfix suites). */
export function markTrusted(state: V5SessionState, artId: string): void {
  const art = (state.artifacts || []).find((a: any) => a.id === artId);
  if (art) {
    (art as any).trustLevel = 'gated_pass';
    (art as any).passedGates = ['commit'];
  }
}

/** Commit a trusted (gated_pass) capability run so its required pre-req is satisfied for GCOV. */
export function commitTrusted(
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

/** Raw artifact shape that passes G-GROUND (external repo / F1 source). */
export function createGroundedEvidenceRaw(
  id: string
): Omit<Artifact, 'trustLevel'> {
  return {
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
  };
}

/** Commit grounded external evidence (passes G-GROUND). */
export function commitGroundedEvidence(
  state: V5SessionState,
  id: string,
  runId: string
): V5SessionState {
  const { updatedState } = commitArtifact(
    state,
    createGroundedEvidenceRaw(id),
    runId,
    false,
    []
  );
  return updatedState;
}

/** Map a capability id to the artifact kind it produces (commit-loop helper). */
export function kindForCap(capabilityId: string): Artifact['kind'] {
  if (capabilityId === 'report.write') return 'report';
  if (capabilityId === 'synthesis.merge') return 'synthesis';
  if (capabilityId === 'risk.analyze' || capabilityId === 'counter.argue') return 'risk';
  return 'evidence';
}

/**
 * Mirror the page's same-round commit loop: orchestrate + commit each planned capability with
 * fresh per-step input resolution (this is what makes the same-round DAG work).
 * Returns the working state after all commits this turn (NOT yet markAwaiting'd).
 */
export function driveConvergeTurn(
  state: V5SessionState,
  turnId: string,
  userText: string
): V5SessionState {
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

/**
 * Drive a session to `goal.status === "clear"` with a TRUSTED, committed `report` artifact.
 * Mirrors the page's first-convergence flow: trusted risk + synthesis upstreams, a converge turn
 * (GCOV-pass -> applyGoalConclusion writes "clear"), then commit the planned report.write.
 *
 * Returns the converged state plus the ids of the seeded trusted artifacts so callers can target
 * a specific one for a challenge (S4) or coverage replay (S2).
 */
export function buildClearStateWithTrustedReport(sessionId: string): {
  state: V5SessionState;
  reportId: string;
  riskId: string;
  synthId: string;
} {
  let s = createInitialSessionState(COMPLEX_GOAL_TEXT, sessionId);

  const riskId = 'risk-1';
  const evId = 'ev-ground-1';
  const synthId = 'synth-1';
  s = commitTrusted(s, riskId, 'risk.analyze', '安全', 'risk', `${sessionId}-r0`);
  s = commitGroundedEvidence(s, evId, `${sessionId}-r0b`);
  s = commitTrusted(s, synthId, 'synthesis.merge', '综合', 'synthesis', `${sessionId}-r1`);

  // Converge turn: GCOV passes -> single-writer applyGoalConclusion writes "clear".
  const { newState } = orchestrateReasoningTurn(s, {
    turnId: `${sessionId}-cv`,
    userText: '现在可以出最终报告了',
  });

  // Commit the planned report using the planned run id so it is a real trusted report.
  const reportNode = (newState.graph.nodes || []).find((n: any) => n.capabilityId === 'report.write');
  const reportRunId = (reportNode as any)?.capabilityRunId ?? `${sessionId}-cv-run-0`;
  const reportInputs = findInputsForCapability(newState, 'report.write');
  const reportId = 'report-1';
  const { updatedState, committed } = commitArtifact(
    newState,
    createRawArtifact(reportId, 'report.write', '综合', 'report'),
    reportRunId,
    false,
    reportInputs
  );
  if (committed) markTrusted(updatedState, reportId);
  return { state: updatedState, reportId, riskId, synthId };
}

/** S20 ITER: converged session plus a fresh (non-stale) preview artifact. */
export function buildClearStateWithPreview(sessionId: string): {
  state: V5SessionState;
  reportId: string;
  riskId: string;
  synthId: string;
  previewId: string;
} {
  const built = buildClearStateWithTrustedReport(sessionId);
  const previewId = `${sessionId}-preview-1`;
  const state = commitTrusted(
    built.state,
    previewId,
    'ux.preview',
    '工程',
    'preview',
    `${sessionId}-pv0`
  );
  return { ...built, state, previewId };
}

/** Mechanical recycle signature for P2 / N4 / S20 parity (invalidation + reschedule fields only). */
export function recycleSignature(state: V5SessionState): string {
  return JSON.stringify({
    staleArtifactIds: [...(state.staleArtifactIds || [])].sort(),
    goal: state.goal,
    graphNodes: (state.graph?.nodes || []).map((n: { id?: string; status?: string }) => ({
      id: n.id,
      status: n.status,
    })),
    projectionDirtyNodeIds: [...(state.projectionDirtyNodeIds || [])].sort(),
  });
}

// ===== Coverage replay (S2 P1 acceptance helper) =====

export interface CoverageReplayRequirementLine {
  capabilityId: string;
  /** report.write is the convergence ACTION, not a pre-req gap. */
  isConvergenceAction: boolean;
  /** A trusted (gated_pass|audited), non-stale artifact produced by this capability exists. */
  satisfied: boolean;
  satisfiedByArtifactId?: string;
}

export interface CoverageReplayGapLine {
  id: string;
  kind: string;
  status: 'open' | 'resolved' | 'waived';
  requiredCapabilityId?: string;
  resolvedByArtifactId?: string;
  waivedReason?: string;
}

export interface CoverageReplay {
  hasContract: boolean;
  mode?: 'simple' | 'complex';
  /** Item-by-item, in the SAME order as contract.requiredCapabilities. */
  required: CoverageReplayRequirementLine[];
  conditional: string[];
  gaps: CoverageReplayGapLine[];
  resolvedGapIds: string[];
  waivedGapIds: string[];
  openGapIds: string[];
  /** The last computed coverageGate.passed, or null if GCOV never ran. */
  gatePassed: boolean | null;
}

/** A trusted (gated_pass|audited), non-stale artifact produced by `capId`, if any. */
function trustedArtifactForCap(state: V5SessionState, capId: string): Artifact | undefined {
  const stales = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).find(
    (a: any) =>
      a.producedBy?.capabilityId === capId &&
      (a.trustLevel === 'gated_pass' || a.trustLevel === 'audited') &&
      !stales.has(a.id)
  );
}

/**
 * S2 (P1 acceptance): replay the session's coverage from STATE + ledger. Reports which contract
 * requirements were covered (item-by-item against `contract.requiredCapabilities`) and which gaps
 * were resolved / waived / left open. Pure read-only; never mutates `state`.
 *
 * Signature: replayCoverage(state: V5SessionState): CoverageReplay
 */
export function replayCoverage(state: V5SessionState): CoverageReplay {
  const contract = state.coverageContract;
  const gaps = (state.coverageGaps || []) as Array<CoverageReplayGapLine & { status: any }>;
  const gatePassed =
    state.coverageGate && typeof state.coverageGate.passed === 'boolean'
      ? state.coverageGate.passed
      : null;

  if (!contract) {
    return {
      hasContract: false,
      required: [],
      conditional: [],
      gaps: gaps.map((g) => ({
        id: g.id,
        kind: g.kind,
        status: g.status,
        requiredCapabilityId: (g as any).requiredCapabilityId,
        resolvedByArtifactId: (g as any).resolvedByArtifactId,
        waivedReason: (g as any).waivedReason,
      })),
      resolvedGapIds: gaps.filter((g) => g.status === 'resolved').map((g) => g.id),
      waivedGapIds: gaps.filter((g) => g.status === 'waived').map((g) => g.id),
      openGapIds: gaps.filter((g) => g.status === 'open').map((g) => g.id),
      gatePassed,
    };
  }

  const required: CoverageReplayRequirementLine[] = contract.requiredCapabilities.map((cap) => {
    const isConvergenceAction = cap === 'report.write';
    const art = trustedArtifactForCap(state, cap);
    return {
      capabilityId: cap,
      isConvergenceAction,
      satisfied: !!art,
      satisfiedByArtifactId: art?.id,
    };
  });

  return {
    hasContract: true,
    mode: contract.mode,
    required,
    conditional: [...(contract.conditionalCapabilities || [])],
    gaps: gaps.map((g) => ({
      id: g.id,
      kind: g.kind,
      status: g.status,
      requiredCapabilityId: (g as any).requiredCapabilityId,
      resolvedByArtifactId: (g as any).resolvedByArtifactId,
      waivedReason: (g as any).waivedReason,
    })),
    resolvedGapIds: gaps.filter((g) => g.status === 'resolved').map((g) => g.id),
    waivedGapIds: gaps.filter((g) => g.status === 'waived').map((g) => g.id),
    openGapIds: gaps.filter((g) => g.status === 'open').map((g) => g.id),
    gatePassed,
  };
}

// ===== Small audit/state helpers reused across scenarios =====

/** Number of distinct turnIds represented in capabilityRuns (the "round count" proxy). */
export function countDistinctTurns(state: V5SessionState): number {
  const turnIds = new Set<string>(
    (state.capabilityRuns || []).map((r: any) => r.turnId).filter(Boolean)
  );
  return turnIds.size;
}

/** Trusted, non-stale artifacts (the "trusted committed" set). */
export function trustedArtifacts(state: V5SessionState): Artifact[] {
  const stales = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).filter(
    (a: any) =>
      (a.trustLevel === 'gated_pass' || a.trustLevel === 'audited') && !stales.has(a.id)
  );
}
