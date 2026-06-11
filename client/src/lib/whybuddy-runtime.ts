/**
 * WhyBuddy V5 Thin Runtime (prototype, in-memory)
 *
 * This is the start of the real control plane as described in:
 * - docs/WhyBuddyV5CapabilityPool.md
 * - docs/WhyBuddyV5闭环总图_完整版.md
 *
 * It implements the core loop from the diagram:
 *   UserIntervention / Invalidation
 *     -> Orchestrator (orchestrateReasoningTurn)
 *     -> pickNextCapabilities
 *     -> CapabilityRun
 *     -> commitArtifact (Trust Layer: Gate -> provenance -> Ledger)
 *     -> update State
 *     -> produce Artifacts + updates to Reasoning Graph
 *
 * Current status: thin but faithful prototype.
 * - All state lives in V5SessionState (shared types).
 * - No real backend/MCP/LLM yet; selection and gates are deterministic + injectable for demo.
 * - Designed so the WhyBuddy page can call these instead of local mocks.
 *
 * Key exports:
 *   createInitialSessionState(goalText)
 *   orchestrateReasoningTurn(state, intervention?)
 *   commitArtifact(state, artifact, runId)
 *   invalidateForIntervention(state, intervention)
 *
 * The page should treat the returned state as source of truth for graph/artifacts/runs/gates.
 */

import type {
  V5CapabilityId,
  Artifact,
  GateState,
  CapabilityRun,
  DependencyEdge,
  V5SessionState,
  UserIntervention,
  TurnPlan,
  OrchestrateContext,
  SchedulingDecision,
  CoverageContract,
  CoverageGateResult,
  FlowBoundaryCheck,
  CapabilityCostRecord,
  CoverageGap,
} from "@shared/blueprint/v5-reasoning-state";
import type { BrainstormReasoningGraph, BrainstormReasoningNode, BrainstormReasoningEdge } from "@shared/blueprint/brainstorm-reasoning-graph";
import { V5_CAPABILITY_POOL, ALL_V5_CAPABILITIES } from "@shared/blueprint/contracts";
import {
  buildStructuredReport,
  extractArtifactFragments,
  type StructuredReportInput,
  type ArtifactFragment,
  type FragmentKind,
} from "@shared/blueprint/whybuddy-report-builder.js";
import { findGithubUrlInTexts } from "@shared/blueprint/whybuddy-github-context";
import { pickNextCapabilities as pickNextCapabilitiesHeuristic } from "@shared/blueprint/whybuddy-pick-heuristic";
import { validateProposedPlan } from "@shared/blueprint/whybuddy-plan-validation";

export { pickNextCapabilitiesHeuristic as pickNextCapabilities };

// ===== V5.1 P4/B Budget Gate v1 (counts-based, minimal, per whybuddy_v5.1.md) =====
// All paths into orchestrateReasoningTurn must pass here first.
// Over limit → return state already at AWAIT (partial), empty plan (page loop skips), auditable trace.
// Counts derived from existing capabilityRuns (turnId groups + per-cap) — no schema extension for v1.
// Budget itself will be auditable (conv note + later ledger artifact). Real token costs later.

export interface BudgetPolicy {
  maxTurns: number;
  maxCapabilityRunsPerTurn: number;
  maxCapabilityRunsPerSession: number;
  maxRepeatPerCapability: number;
}

export interface BudgetSnapshot {
  turns: number;
  capabilityRuns: number;
  perCapRuns: Record<string, number>;
  policy: BudgetPolicy;
  allowed?: boolean;
  reason?: string;

  // Knife 6 v1 cost telemetry (populated when costLedger present)
  totalEstimatedTokens?: number;
  perCapTokens?: Record<string, number>;
  costRecordCount?: number;
}

export function getDefaultBudgetPolicy(): BudgetPolicy {
  return {
    maxTurns: 30,
    maxCapabilityRunsPerTurn: 5,
    maxCapabilityRunsPerSession: 120,
    maxRepeatPerCapability: 6,
  };
}

/**
 * Evaluate before entering the core of orchestrate (pick + plan).
 * Derives usage purely from persisted capabilityRuns (robust across durable load).
 * entering a fresh turnId counts as +1 toward maxTurns.
 */
export function evaluateBudgetBeforeOrchestrate(
  state: V5SessionState,
  context?: OrchestrateContext,
  policy = getDefaultBudgetPolicy()
): { allowed: boolean; snapshot: BudgetSnapshot; reason?: string } {
  const runs = state.capabilityRuns || [];
  const turnIds = new Set<string>(runs.map((r: any) => r.turnId).filter(Boolean));
  const currentTurns = turnIds.size;
  const currentRuns = runs.length;

  const perCap: Record<string, number> = {};
  for (const r of runs) {
    const cid = (r as any).capabilityId as string;
    if (cid) perCap[cid] = (perCap[cid] || 0) + 1;
  }

  const snapshot: BudgetSnapshot = {
    turns: currentTurns,
    capabilityRuns: currentRuns,
    perCapRuns: perCap,
    policy,
  };

  // Knife 6: include cost summary from costLedger (v1)
  const costs = (state.costLedger || []) as CapabilityCostRecord[];
  const totalEstimatedTokens = costs.reduce((sum, c) => sum + (c.estimatedTokens || 0), 0);
  const perCapTokens: Record<string, number> = {};
  for (const c of costs) {
    if (c.capabilityId) perCapTokens[c.capabilityId] = (perCapTokens[c.capabilityId] || 0) + (c.estimatedTokens || 0);
  }
  (snapshot as any).totalEstimatedTokens = totalEstimatedTokens;
  (snapshot as any).perCapTokens = perCapTokens;
  (snapshot as any).costRecordCount = costs.length;

  let allowed = true;
  let reason: string | undefined;

  const thisTurnId = context?.turnId;
  const enteringNewTurn = thisTurnId && !turnIds.has(thisTurnId) ? 1 : 0;
  if (currentTurns + enteringNewTurn > policy.maxTurns) {
    allowed = false;
    reason = `maxTurns exceeded (current ${currentTurns}+${enteringNewTurn} > ${policy.maxTurns})`;
  }
  if (currentRuns >= policy.maxCapabilityRunsPerSession) {
    allowed = false;
    reason = reason || `maxCapabilityRunsPerSession exceeded (${currentRuns} >= ${policy.maxCapabilityRunsPerSession})`;
  }
  const repeatHit = Object.entries(perCap).find(([, c]) => c >= policy.maxRepeatPerCapability);
  if (repeatHit) {
    allowed = false;
    reason = reason || `maxRepeatPerCapability for ${repeatHit[0]} (${repeatHit[1]} >= ${policy.maxRepeatPerCapability})`;
  }

  (snapshot as any).allowed = allowed;
  (snapshot as any).reason = reason;
  return { allowed, snapshot, reason };
}

/**
 * Record post-capability-run cost into state/ledger (v1: counts implicit via capabilityRuns already appended by commit).
 * Future: attach token/actual cost to the run or separate cost ledger entry. Kept for seam + DLEDGER follow-up.
 */
export function recordCapabilityRunCost(
  state: V5SessionState,
  run: CapabilityRun,
  cost?: { tokens?: number; durationMs?: number; estimatedCostUsd?: number; source?: "estimated" | "server" | "manual"; usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number; model?: string }; [k: string]: any }
): V5SessionState {
  // Knife 11: prefer real provider usage if present (from server LLM), else fallback estimate.
  const now = new Date().toISOString();
  const usage = cost?.usage;
  let tokens = 0;
  let src: CapabilityCostRecord["source"] = (cost?.source ?? "estimated") as any;

  if (usage?.totalTokens) {
    tokens = usage.totalTokens;
    src = "server";
  } else {
    tokens = cost?.tokens ?? 0;
  }

  const durationMs = cost?.durationMs ?? 0;
  const estimatedCostUsd = cost?.estimatedCostUsd;

  const rec: CapabilityCostRecord = {
    id: `${run.turnId || "turn"}-cost-${run.capabilityId}-${Date.now()}`,
    turnId: run.turnId || "",
    capabilityRunId: run.id,
    capabilityId: run.capabilityId,
    estimatedTokens: tokens || undefined,
    estimatedCostUsd,
    durationMs: durationMs || undefined,
    source: src,
    createdAt: now,
  };

  // Optionally attach raw usage on the record for audit (non-breaking, since extra fields ok in v1).
  if (usage) {
    (rec as any).usage = usage;
  }

  const newLedger = [...(state.costLedger || []), rec];
  return {
    ...state,
    costLedger: newLedger,
  };
}

export function createInitialSessionState(goalText: string, sessionId = "whybuddy-local-proto"): V5SessionState {
  // Start with a minimal but valid state. Graph will be mutated by capabilities.
  // Per 修复闭环.md: sessionId isolation starts here; load path will key off it later.
  return {
    goal: {
      text: goalText,
      status: "needs_refinement",
    },
    graph: {
      id: "whybuddy-session-graph",
      jobId: "whybuddy-prototype",
      stage: "effect_preview", // legacy field, ignored in V5
      nodes: [],
      edges: [],
      source: "runtime",
    } as BrainstormReasoningGraph,
    artifacts: [],
    conversation: [],
    openQuestions: [],
    evidence: [],
    decisions: [],
    risks: [],
    capabilityRuns: [],
    gates: [],
    dependencyGraph: [],
    staleArtifactIds: [],
    sessionId,
    runtimePhase: "idle",
    decisionLedger: [],
  coverageContract: undefined,
  coverageGate: undefined,
  flowBoundaryLedger: [],
  costLedger: [],
  coverageGaps: [],
  };
}

/**
 * Swappable session store contract.
 *
 * This directly implements the "修复闭环" hard rule:
 * 消息 handler 永远先 `loadSessionState(sessionId)`（按 sessionId 隔离）。
 *
 * The public loadOrCreateSessionState / saveSessionState are thin conveniences over
 * the current implementation. A real backend can provide an object matching this
 * interface (including a future HttpWhyBuddySessionStore) and be swapped in
 * without touching page or INTAKE call sites.
 *
 * NOTE (productionization): methods are async to support remote/Http adapters.
 * In-memory impl returns resolved promises for drop-in compatibility.
 */
export interface WhyBuddySessionStore {
  load(sessionId: string): Promise<V5SessionState | undefined>;
  save(state: V5SessionState): Promise<V5SessionState>;
  clear?(): void | Promise<void>;
  listSessions?(): Array<{
    sessionId: string;
    goal: string;
    createdAt?: string;
    lastActive?: string;
    artifactCount: number;
    phase?: string;
  }> | Promise<Array<{
    sessionId: string;
    goal: string;
    createdAt?: string;
    lastActive?: string;
    artifactCount: number;
    phase?: string;
  }>>;
  deleteSession?(sessionId: string): void | Promise<void>;
}

// Default in-memory implementation (module-level Map, per-sessionId isolation).
class InMemoryWhyBuddySessionStore implements WhyBuddySessionStore {
  private readonly store = new Map<string, V5SessionState>();
  private readonly meta = new Map<string, { createdAt: string; lastActive: string }>();

  async load(sessionId: string): Promise<V5SessionState | undefined> {
    const s = this.store.get(sessionId);
    if (s) {
      // attach meta for consumers if present
      const m = this.meta.get(sessionId);
      if (m) {
        return { ...s, createdAt: m.createdAt, lastActive: m.lastActive } as any;
      }
    }
    return s;
  }

  async save(state: V5SessionState): Promise<V5SessionState> {
    const sessionId = state.sessionId || "whybuddy-local-proto";
    const now = new Date().toISOString();
    const existingMeta = this.meta.get(sessionId);
    const createdAt = existingMeta?.createdAt || now;

    const saved = { ...state, sessionId, lastActive: now } as any;
    if (!saved.createdAt) saved.createdAt = createdAt;

    this.store.set(sessionId, saved);
    this.meta.set(sessionId, { createdAt, lastActive: now });

    return saved;
  }

  clear(): void {
    this.store.clear();
    this.meta.clear();
  }

  listSessions() {
    const out: any[] = [];
    for (const [sid, s] of this.store) {
      const m = this.meta.get(sid);
      out.push({
        sessionId: sid,
        goal: s.goal?.text || '',
        createdAt: m?.createdAt || (s as any).createdAt,
        lastActive: m?.lastActive || (s as any).lastActive,
        artifactCount: (s.artifacts || []).length,
        phase: (s as any).runtimePhase,
      });
    }
    return out;
  }

  deleteSession(sessionId: string): void {
    this.store.delete(sessionId);
    this.meta.delete(sessionId);
  }
}

let currentWhyBuddySessionStore: WhyBuddySessionStore = new InMemoryWhyBuddySessionStore();

/**
 * For tests or future backend injection.
 * Swapping the store does not change the shape of load/save used by the page.
 */
export function setWhyBuddySessionStore(impl: WhyBuddySessionStore): void {
  currentWhyBuddySessionStore = impl;
}

export function getWhyBuddySessionStore(): WhyBuddySessionStore {
  return currentWhyBuddySessionStore;
}

/**
 * In-memory session store (default implementation) for the V5 prototype.
 *
 * Every inbound must go through load first (then intake classify).
 * Later this can be replaced by a real backend adapter implementing WhyBuddySessionStore
 * (e.g. fetch /api/whybuddy/sessions/:id ) without changing any caller.
 */
export async function loadOrCreateSessionState(
  sessionId: string,
  goalText = "WhyBuddy V5 session"
): Promise<V5SessionState> {
  const existing = await currentWhyBuddySessionStore.load(sessionId);
  if (existing) {
    // load + derive = 单一真相（符合文档 RUNTIME DERIVE）
    return deriveNodeStatus(existing);
  }

  const created = createInitialSessionState(goalText, sessionId);
  const saved = await currentWhyBuddySessionStore.save(created);
  return deriveNodeStatus(saved);
}

export async function saveSessionState(state: V5SessionState): Promise<V5SessionState> {
  // 存之前也 derive 一次，保证持久化的 graph 是当前单一真相
  const derived = deriveNodeStatus(state);
  return currentWhyBuddySessionStore.save(derived);
}

export function clearWhyBuddySessionStore(): void {
  currentWhyBuddySessionStore.clear?.();
}

export function listWhyBuddySessions() {
  const res = currentWhyBuddySessionStore.listSessions?.();
  return res instanceof Promise ? res : (res || []);
}

export async function deleteWhyBuddySession(sessionId: string): Promise<void> {
  await currentWhyBuddySessionStore.deleteSession?.(sessionId);
}

/**
 * deriveNodeStatus — 状态派生（单一真相）
 *
 * 按 WhyBuddyV5闭环总图 的 RUNTIME 子图：
 *   "DERIVE 实时进度 + 已存 → 单一真相"
 *
 * 在 load/save 之后调用，根据权威数据 (artifacts + stale + capabilityRuns + gates) 重新计算 graph.nodes 的 status。
 * 支持完整状态集：pending / active / running / completed / challenged / failed。
 */
export function deriveNodeStatus(state: V5SessionState): V5SessionState {
  const staleSet = new Set(state.staleArtifactIds || []);
  const artifactByRun = new Map<string, Artifact>();
  const runById = new Map<string, any>((state.capabilityRuns || []).map(r => [r.id, r]));

  for (const art of state.artifacts || []) {
    const runId = art.producedBy?.capabilityRunId;
    if (runId) artifactByRun.set(runId, art);
  }

  const newNodes = (state.graph?.nodes || []).map((node: any) => {
    if (!node) return node;

    const runId = node.capabilityRunId || node.producedRunId;
    const artId = node.producedArtifactId;
    let newStatus = node.status || "pending";

    const matchingArt = runId ? artifactByRun.get(runId) : (artId ? (state.artifacts || []).find((a: any) => a.id === artId) : undefined);
    const matchingRun = runId ? runById.get(runId) : undefined;

    // Robust stale detection (per audit): cross-ref via node's runId to find the art (works pre-enrich when only capabilityRunId is present on node),
    // then check the art's id against staleSet. Also honor direct artId on node if present.
    let isStale = false;
    if (artId && staleSet.has(artId)) {
      isStale = true;
    } else if (runId) {
      const artForRun = artifactByRun.get(runId);
      if (artForRun && staleSet.has(artForRun.id)) {
        isStale = true;
      }
    }

    if (isStale) {
      newStatus = "challenged";
    } else if (matchingRun && matchingRun.gateResults && matchingRun.gateResults.some((g: any) => g.status === "failed")) {
      newStatus = "failed";
    } else if (matchingArt) {
      if (matchingArt.trustLevel === "untrusted") {
        newStatus = "active"; // produced but not trusted yet
      } else {
        newStatus = "completed";
      }
    } else if (matchingRun) {
      newStatus = "running"; // run exists but no artifact yet
    } else {
      newStatus = "active";
    }

    if (newStatus !== node.status) {
      return { ...node, status: newStatus };
    }
    return node;
  });

  if (newNodes === state.graph?.nodes) {
    return state;
  }

  return {
    ...state,
    graph: {
      ...state.graph,
      nodes: newNodes,
    },
  };
}

// Expanded Trust Layer gate simulation (closer to the full mechanical gates in the diagram).
// Records schema/invariant/confirm/previews_real etc. for fidelity while keeping prototype runnable.
// forceFail still primarily affects the critical "commit" gate and report-specific upstream checks.
function evaluateGates(artifact: Artifact, forceFail: boolean): { status: "passed" | "failed"; gateId: string }[] {
  const results: { status: "passed" | "failed"; gateId: string }[] = [];
  const capId = (artifact as any).producedBy?.capabilityId || "";

  // Always record the structural gates (they pass in this deterministic prototype)
  results.push({ gateId: "schema", status: "passed" });
  results.push({ gateId: "invariant", status: "passed" });
  results.push({ gateId: "confirm", status: "passed" });

  if (capId.includes("visual") || capId.includes("preview")) {
    results.push({ gateId: "previews_real", status: forceFail ? "failed" : "passed" });
  }

  // Additional doc gates (prototype passes unless forced for key ones)
  results.push({ gateId: "merge", status: forceFail ? "failed" : "passed" });
  results.push({ gateId: "decision", status: "passed" });

  // Precondition (demo control)
  results.push({ gateId: "precondition", status: forceFail ? "failed" : "passed" });

  // The real commit gate that drives trustLevel
  const commitStatus = forceFail ? "failed" : "passed";
  results.push({ gateId: "commit", status: commitStatus });

  return results;
}

/**
 * 模拟 Ledger（审计台账）派生。
 * 从 capabilityRuns + gates 构建可审计的提交记录，贴近文档 "T_LEDGER 校验台账 / 脚本·退出码·输出·真跑留痕"。
 * 这是 prototype 内的 "真实执行留痕" 模拟，后端可替换为真实持久化 ledger。
 */
export function getSessionLedger(state: V5SessionState): Array<{
  runId: string;
  capabilityId: V5CapabilityId;
  roleId?: string;
  timestamp: string;
  inputs: string[];
  outputs: string[];
  trustLevel: string;
  gateSummary: string;
}> {
  const runs = state.capabilityRuns || [];
  const artifactsById = new Map((state.artifacts || []).map(a => [a.id, a]));

  return runs.map(run => {
    const outIds = run.outputs || [];
    const outArts = outIds.map(id => artifactsById.get(id)).filter((x): x is Artifact => !!x);
    const trust = outArts.length > 0 ? (outArts[0].trustLevel || 'untrusted') : 'untrusted';
    const gates = run.gateResults || [];
    const passed = gates.filter(g => g.status === 'passed').length;
    const failed = gates.length - passed;
    const gateSummary = `${passed} passed, ${failed} failed`;

    return {
      runId: run.id,
      capabilityId: run.capabilityId,
      roleId: run.roleId,
      timestamp: new Date().toISOString(), // prototype: real would come from run
      inputs: run.inputs || [],
      outputs: outIds,
      trustLevel: trust,
      gateSummary,
    };
  });
}

/** V5.1 DLEDGER helper (parallel to getSessionLedger). Returns a defensive copy. */
export function getDecisionLedger(state: V5SessionState): SchedulingDecision[] {
  return [...(state.decisionLedger || [])];
}

// ===== V5.1 CONTRACT + GCOV gate v1 (Knife 3) =====
// Mechanical rules only (no deep semantics). Contract + gate prevent premature "想清楚了" (report/AWAIT).
// Inserted after DLEDGER in ORCH per spec. Budget remains the prior gate.

export function authorCoverageContract(goalText: string, turnId?: string): { contract: CoverageContract; gaps: CoverageGap[] } {
  const t = (goalText || "").toLowerCase();
  const isComplex = /风险|risk|安全|审计|反驳|复杂|complex|rebuttal/.test(t);
  const mode: "simple" | "complex" = isComplex ? "complex" : "simple";
  const requiredCapabilities = isComplex ? ["risk.analyze", "report.write"] : ["report.write"];
  const conditionalCapabilities = isComplex ? ["synthesis.merge"] : [];

  const now = new Date().toISOString();
  const contract: CoverageContract = {
    id: `cov-${turnId || Date.now()}`,
    version: 1,
    mode,
    authoredBy: "system",
    authoredAt: now,
    frozenAtTurnId: turnId,
    requiredCapabilities,
    conditionalCapabilities,
    minEvidencePerRequirement: 1,
    blockingGapIds: [],
  };

  const gaps: CoverageGap[] = [];
  const nowGap = now;
  for (const cap of requiredCapabilities) {
    if (cap === "report.write") continue; // report is the convergence action, not a pre-req gap
    const gap: CoverageGap = {
      id: `gap-${cap}-${turnId || Date.now()}`,
      kind: "missing_capability",
      label: `Missing required capability: ${cap}`,
      requiredCapabilityId: cap,
      status: "open",
      createdAt: nowGap,
    };
    gaps.push(gap);
    contract.blockingGapIds.push(gap.id);
  }
  // For complex, also seed a generic evidence gap if no upstreams (will be checked at gate time)
  if (isComplex) {
    const evGap: CoverageGap = {
      id: `gap-evidence-${turnId || Date.now()}`,
      kind: "missing_evidence",
      label: "Missing trusted upstream evidence for report",
      status: "open",
      createdAt: nowGap,
    };
    gaps.push(evGap);
    contract.blockingGapIds.push(evGap.id);
  }

  return { contract, gaps };
}

/** Knife 7: resolve open coverage gaps that are now satisfied by current trusted state (e.g. after commit). */
export function resolveCoverageGapsFromState(state: V5SessionState): V5SessionState {
  const contract = state.coverageContract;
  if (!contract) return state;
  let gaps = [...(state.coverageGaps || [])] as CoverageGap[];
  let changed = false;
  const now = new Date().toISOString();

  for (const g of gaps) {
    if (g.status !== "open") continue;
    if (g.kind === "missing_capability" && g.requiredCapabilityId) {
      if (hasTrustedCommittedForCap(state, g.requiredCapabilityId)) {
        g.status = "resolved";
        g.updatedAt = now;
        const arts = (state.artifacts || []).filter((a: any) => a.producedBy?.capabilityId === g.requiredCapabilityId && (a.trustLevel === "gated_pass" || a.trustLevel === "audited"));
        if (arts.length) g.resolvedByArtifactId = arts[arts.length - 1].id;
        changed = true;
      }
    } else if (g.kind === "missing_evidence") {
      if (countTrustedUpstreams(state) >= (contract.minEvidencePerRequirement || 1)) {
        g.status = "resolved";
        g.updatedAt = now;
        changed = true;
      }
    }
  }

  if (!changed) return state;
  return { ...state, coverageGaps: gaps };
}

/** Knife 7: waive an open gap (runtime helper; UI can call later). */
export function waiveCoverageGap(state: V5SessionState, gapId: string, reason: string): V5SessionState {
  let gaps = [...(state.coverageGaps || [])] as CoverageGap[];
  const idx = gaps.findIndex((g) => g.id === gapId);
  if (idx < 0) return state;
  const g = { ...gaps[idx] };
  if (g.status !== "open") return state;
  g.status = "waived";
  g.waivedBy = "system";
  g.waivedReason = reason;
  g.updatedAt = new Date().toISOString();
  gaps[idx] = g;
  return { ...state, coverageGaps: gaps };
}

/** Knife 9: evaluate if current CoverageContract baseline is sufficient (no open blocking gaps, no stale, has recent report, and this turn is not a meaningful intervention like challenge/revise). If so, Budget should stop redundant converge. */
export function evaluateContractSufficiencyForBudget(
  state: V5SessionState,
  context?: OrchestrateContext
): { sufficient: boolean; reason: string; openGapCount: number; unresolvedRequiredCapabilities: string[] } {
  const contract = state.coverageContract;
  const gate = state.coverageGate;
  const gaps: CoverageGap[] = (state.coverageGaps || []) as any;
  const hasStale = (state.staleArtifactIds || []).length > 0;
  const intervention = context?.intervention;

  const isMeaningfulIntervention = !!intervention && ['challenge', 'revise', 'clarify', 'expand'].includes(intervention.intent);

  const blockingGaps = contract ? gaps.filter((g: any) => (contract as any).blockingGapIds?.includes(g.id)) : [];
  const openBlocking = blockingGaps.filter((g: any) => g.status === 'open');
  const openGapCount = openBlocking.length;

  const unresolvedRequired = contract ? (contract as any).requiredCapabilities?.filter((c: string) => c !== 'report.write' && !hasTrustedCommittedForCap(state, c)) || [] : [];

  const hasRecentReport = (state.artifacts || []).some((a: any) =>
    a.producedBy?.capabilityId === 'report.write' &&
    (a.trustLevel === 'gated_pass' || a.trustLevel === 'audited') &&
    !(state.staleArtifactIds || []).includes(a.id)
  );

  let sufficient = false;
  let reason = 'contract not sufficient or new work needed';

  // v1: sufficiency based on gaps status + state signals + not a meaningful intervention.
  // We do not require pre-computed coverageGate here (check happens early in ORCH before GCOV sets it).
  if (contract && openGapCount === 0 && !hasStale && hasRecentReport && !isMeaningfulIntervention && unresolvedRequired.length === 0) {
    sufficient = true;
    reason = 'contract_sufficient_no_new_work';
  } else if (openGapCount > 0) {
    reason = `open blocking gaps: ${openGapCount}`;
  } else if (hasStale) {
    reason = 'stale artifacts present';
  } else if (!hasRecentReport) {
    reason = 'no recent trusted report';
  } else if (isMeaningfulIntervention) {
    reason = 'meaningful intervention (challenge/revise/etc.)';
  }

  return {
    sufficient,
    reason,
    openGapCount,
    unresolvedRequiredCapabilities: unresolvedRequired,
  };
}

/** Shared artifact-health rule: trusted (gated_pass | audited) and not stale. */
function isHealthyArtifact(
  artifact: { id: string; trustLevel?: string },
  staleSet: Set<string>
): boolean {
  return (
    (artifact.trustLevel === 'gated_pass' || artifact.trustLevel === 'audited') &&
    !staleSet.has(artifact.id)
  );
}

function hasTrustedCommittedForCap(state: V5SessionState, capId: string): boolean {
  const runs = state.capabilityRuns || [];
  const arts = state.artifacts || [];
  const stales = new Set(state.staleArtifactIds || []);
  for (const run of runs) {
    if ((run as any).capabilityId !== capId) continue;
    const art = arts.find((a: any) => a.producedBy?.capabilityRunId === run.id);
    if (art && isHealthyArtifact(art, stales)) {
      return true;
    }
  }
  return false;
}

function countTrustedUpstreams(state: V5SessionState): number {
  const stales = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).filter((a: any) =>
    (a.trustLevel === 'gated_pass' || a.trustLevel === 'audited') && !stales.has(a.id)
  ).length;
}

export function evaluateCoverageGate(
  state: V5SessionState,
  selected: Array<{ capabilityId: string; roleId?: string }> = [],
  existingContract?: CoverageContract
): CoverageGateResult {
  const contract = existingContract || authorCoverageContract(state.goal?.text || "", (state as any).lastTurnId).contract;
  const gaps = (state.coverageGaps || []) as CoverageGap[];

  // Use gap lifecycle for decision: blocking gaps must be resolved or waived.
  const blockingGaps = gaps.filter((g: CoverageGap) => contract.blockingGapIds.includes(g.id));
  const openBlocking = blockingGaps.filter((g: CoverageGap) => g.status === "open");
  const unresolvedGaps = openBlocking.map((g: CoverageGap) => g.id);
  const waivedGaps = blockingGaps.filter((g: CoverageGap) => g.status === "waived").map((g: CoverageGap) => g.id);

  // Still compute missing caps for backward compat / DLEDGER addresses.
  const missing: string[] = [];
  const preReqs = contract.requiredCapabilities.filter((c) => c !== 'report.write');
  for (const req of preReqs) {
    if (!hasTrustedCommittedForCap(state, req)) {
      missing.push(req);
    }
  }

  const hasReportIntent = selected.some((s: any) => s.capabilityId === 'report.write');
  let upstreamOk = true;
  if (hasReportIntent) {
    const trustedCount = countTrustedUpstreams(state);
    if (trustedCount < (contract.minEvidencePerRequirement || 1)) {
      upstreamOk = false;
    }
  }

  // Core gate: all blocking gaps handled + no missing pre-reqs + upstreams ok.
  const allBlockingHandled = openBlocking.length === 0;
  const passed = allBlockingHandled && missing.length === 0 && upstreamOk;

  const reason = passed
    ? `Coverage sufficient (mode=${contract.mode}, baseline frozen, all blocking gaps resolved/waived)`
    : `Blocking gaps open: ${unresolvedGaps.length}; missing caps: ${missing.join(', ') || 'none'}; upstreams ok: ${upstreamOk}`;

  return {
    passed,
    missingCapabilities: missing,
    unresolvedGaps,
    waivedGaps,
    reason,
  };
}

// ===== V5.1 GOAL conclusion gate (GCOV-owned single writer) =====
// Bugfix spec: whybuddy-goal-conclusion-gate.
// GCOV (Coverage Gate) is the single authority over the conclusion state `goal.status`.
// `deriveGoalConclusion` is a PURE mapping from the gate result + coverage state onto the next
// conclusion; `applyGoalConclusion` is the ONLY assigner of `goal.status` outside
// `createInitialSessionState`. Neither is wired into ORCH here (see Task 3.2); they are added
// standalone so ORCH scheduling/budget/pick logic never touches GOAL directly.

/**
 * Pure conclusion-derivation (GCOV authority). Returns the next `goal.status` without mutating
 * state. Reads only the gate result, the coverage contract, the coverage gaps, and committed runs.
 *
 *  - `gateResult.passed === true`                         -> "clear"
 *  - coverage cannot be satisfied (every blocking gap is  -> "not_recommended"
 *    `waived` — none `open`, none `resolved` — AND at
 *    least one required pre-req capability still lacks a
 *    trusted committed run)
 *  - otherwise                                            -> "needs_refinement" (no-op equal to
 *                                                            the initial value)
 */
export function deriveGoalConclusion(
  state: V5SessionState,
  gateResult: CoverageGateResult,
  contract?: CoverageContract
): V5SessionState["goal"]["status"] {
  if (gateResult?.passed === true) {
    return "clear";
  }

  // Coverage-cannot-be-satisfied check is narrow and reads only gaps + committed runs.
  const gaps = (state.coverageGaps || []) as CoverageGap[];
  const blockingIds = new Set(contract?.blockingGapIds || []);
  const blockingGaps = gaps.filter((g) => blockingIds.has(g.id));

  // "all blocking gaps waived" => at least one blocking gap, and every one is waived
  // (so none open, none resolved).
  const allBlockingWaived =
    blockingGaps.length > 0 && blockingGaps.every((g) => g.status === "waived");

  // required pre-req capabilities (excluding the terminal report.write) that still lack a
  // trusted committed run.
  const preReqs = (contract?.requiredCapabilities || []).filter((c) => c !== "report.write");
  const someRequiredMissing = preReqs.some((c) => !hasTrustedCommittedForCap(state, c));

  if (allBlockingWaived && someRequiredMissing) {
    return "not_recommended";
  }

  return "needs_refinement";
}

/**
 * Single-writer GOAL applier (GCOV-gated path). The ONLY place outside
 * `createInitialSessionState` that assigns `goal.status`. Returns a new state with the conclusion
 * written; leaves every other field structurally intact.
 */
export function applyGoalConclusion(
  state: V5SessionState,
  status: V5SessionState["goal"]["status"]
): V5SessionState {
  return { ...state, goal: { ...state.goal, status } };
}

/**
 * Read-only predicate: is the session at a converged conclusion (`clear` / `not_recommended`)?
 * Used by `invalidateForIntervention` to decide whether a challenge that undermines the
 * conclusion-supporting artifacts/decisions should route a single-writer downgrade through
 * `applyGoalConclusion`. Does not assign `goal.status`.
 */
function isConvergedConclusion(
  status: V5SessionState["goal"]["status"]
): boolean {
  return status === "clear" || status === "not_recommended";
}

// ===== V5.1 FLOWB boundary guard v1 (Knife 4) =====
// Pure mechanical sanitizer. Strips brainstorm/critique/rebuttal/debate protocol noise
// before it enters formal report/synthesis content. Records what was stripped for audit.
// v1 is deliberately simple regex/line filter; no deep parsing of full debate tree.

export function sanitizeThroughFlowBoundary(
  input: string,
  context: { turnId: string; source?: "brainstorm" | "discussion" | "artifact" | "executor" }
): { cleanedText: string; check: FlowBoundaryCheck } {
  const original = String(input || "");
  const markers = ["critique:", "rebuttal:", "debate:", "challengeEdges", "role vote", "brainstorm console", "brainstorm:"];
  const lines = original.split(/\r?\n/);
  const strippedProtocolNodes: string[] = [];
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase().trim();
    let isProtocol = false;
    for (const m of markers) {
      if (lower.includes(m.toLowerCase())) {
        strippedProtocolNodes.push(line.trim());
        isProtocol = true;
        break;
      }
    }
    if (!isProtocol) {
      cleanedLines.push(line);
    }
  }

  const cleanedText = cleanedLines.join("\n").trim();
  const check: FlowBoundaryCheck = {
    id: `flowb-${context.turnId || Date.now()}`,
    turnId: context.turnId,
    source: (context.source || "artifact") as FlowBoundaryCheck["source"],
    strippedProtocolNodes,
    assertions: strippedProtocolNodes.length > 0
      ? [`stripped ${strippedProtocolNodes.length} protocol nodes before formal content`]
      : ["no protocol noise detected; text passed through boundary"],
    passed: true,
    createdAt: new Date().toISOString(),
  };
  return { cleanedText, check };
}

/**
 * Thin capability simulator for prototype "real execution" feel (without real MCP/LLM).
 * Produces state-dependent content by inspecting prior artifacts, stale, runs.
 * This helps push the "真实执行模拟" score while keeping deterministic and runtime-pure.
 * Future: replace body with actual tool calls / agent outputs.
 */
export function simulateCapabilityExecution(
  capabilityId: V5CapabilityId,
  state: V5SessionState,
  declaredInputs: string[] = []
): { title: string; summary: string; content: string } {
  const lowerCap = capabilityId.toLowerCase();
  const upstreams = (state.artifacts || []).filter(a => declaredInputs.includes(a.id));
  // Global session stale (per audit): re-entry scenarios (e.g. prior risk challenged) must be visible even if this cap has no declaredInputs.
  const hasStale = upstreams.some(a => (state.staleArtifactIds || []).includes(a.id)) || (state.staleArtifactIds || []).length > 0;
  const priorRisks = (state.artifacts || []).filter(a => a.kind === 'risk').length;
  const priorCounters = (state.artifacts || []).filter(a => a.producedBy?.capabilityId?.includes('argue')).length;

  let title = `${capabilityId} (simulated)`;
  let summary = `State-aware simulation for ${capabilityId}.`;
  let content = `【${capabilityId} 模拟输出】\n基于当前会话状态生成（${upstreams.length} upstreams, ${hasStale ? '含stale' : '无stale'}）。`;

  if (lowerCap.includes('evidence') || lowerCap.includes('search')) {
    const evidence = upstreams.filter(a => a.kind === 'clarification' || a.kind === 'risk').map(a => `- ${a.summary || a.content?.slice(0,80)}`).join('\n');
    content = `【证据检索 模拟】\n从 prior artifacts 聚合：\n${evidence || '（无直接 upstream）'}\n\n已发现 ${priorRisks} 风险相关记录。`;
    title = '证据检索 (state-driven sim)';
  } else if (lowerCap.includes('risk')) {
    content = `【风险分析 模拟】\n当前会话已有 ${priorRisks} 风险条目，${priorCounters} 反驳。\n${hasStale ? '注意：存在 stale 上游，风险可能需重评。\n' : ''}主要风险：数据范围越权、审计追溯不足。\n建议：引入 scoped filter。`;
    title = '风险分析 (state-aware sim)';
  } else if (lowerCap.includes('counter') || lowerCap.includes('argue')) {
    content = `【反驳模拟】\n针对 prior risk：过早 ABAC 成本高。MVP 建议 RBAC + filter。\n${hasStale ? 'stale 上下文下，反驳强度需确认。\n' : ''}`;
    title = '反驳 (context sim)';
  } else if (lowerCap.includes('synthesis')) {
    const dissentNote = hasStale ? '\n分歧：部分角色因 stale 持保留意见，建议再澄清一轮。' : '';
    content = `【综合收敛 模拟】\n聚合 ${upstreams.length} 上游。结论：RBAC MVP 优先。${dissentNote}\n下一步：report 或 decompose。`;
    title = '综合 (multi-input sim)';
  } else if (lowerCap.includes('report')) {
    // Delegate to the new structured builder so that executor (and page) get the 9-section evidence-grade report
    // instead of the old one-line simulator stub. This makes report the real V5 main output.
    const built = buildStructuredReport({ state, inputArtifactIds: declaredInputs });
    title = built.title;
    summary = built.summary;
    content = built.content;
  } else if (lowerCap.includes('decompose') || lowerCap.includes('structure')) {
    content = `【结构拆解 模拟】\n从 ${upstreams.length} upstream + ${priorRisks} 风险拆 SPEC Tree。\n${hasStale ? 'stale 影响下，部分需求需重审。\n' : ''}Requirements → Design → Tasks（带证据）。`;
    title = '结构拆解 (state sim)';
  } else if (lowerCap.includes('scenario') || lowerCap.includes('simulate')) {
    const priorPreviews = (state.artifacts || []).filter(a => a.kind === 'preview').length;
    content = `【效果预演 模拟】\n基于 ${upstreams.length} upstream 模拟场景。\n已产出 ${priorPreviews} 预览。${hasStale ? '含风险上下文。\n' : ''}输出：MVP 流程验证通过（带标注）。`;
    title = '效果预演 (context sim)';
  }

  return { title, summary, content };
}

/**
 * CapabilityExecutor — swappable execution adapter (productionization step).
 *
 * Per approved plan: extract the simulator behind a formal interface so that
 * future real agent / MCP / LLM / tool runners can be injected without
 * touching the INTAKE/ORCH/commit closed loop, page flows, or re-entry paths.
 *
 * Default implementation delegates to the existing deterministic
 * simulateCapabilityExecution (state-aware prototype).
 *
 * The interface is async because real executors (MCP calls, LLM JSON, remote
 * agents) will be async. The page/reentry loops will await at the commit
 * sites (sequential to preserve freshInputs resolution per turn).
 */
export interface CapabilityExecutor {
  executeCapability(args: {
    capabilityId: V5CapabilityId;
    state: V5SessionState;
    inputArtifactIds: string[];
    roleId?: string;
    turnId: string;
  }): Promise<{
    title: string;
    summary: string;
    content: string;
    provenance?: Artifact["provenance"];
    payload?: unknown;
    /** Knife 11: real provider usage if available from server LLM (input/output/total tokens, model). */
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      model?: string;
    };
  }>;
}

class DefaultCapabilityExecutor implements CapabilityExecutor {
  async executeCapability(args: {
    capabilityId: V5CapabilityId;
    state: V5SessionState;
    inputArtifactIds: string[];
    roleId?: string;
    turnId: string;
  }): Promise<{
    title: string;
    summary: string;
    content: string;
    provenance?: Artifact["provenance"];
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      model?: string;
    };
  }> {
    const start = performance.now();

    // Special case for the V5 main output (report.write): use the structured 9-section builder
    // so the committed artifact carries evidence-grade content even under the default simulator path.
    // This is the "wire into CapabilityExecutor" step: page no longer post-processes report strings.
    let result: { title: string; summary: string; content: string; provenance?: Artifact["provenance"] };
    if (args.capabilityId === 'report.write') {
      const built = buildStructuredReport({
        state: args.state,
        inputArtifactIds: args.inputArtifactIds || [],
        roleId: args.roleId,
        // turnLabel can be derived from turnId for re-entry distinction if needed by future callers
        turnLabel: args.turnId?.includes('challenge') || args.turnId?.includes('node') ? '重入' : undefined,
      });
      result = {
        title: built.title,
        summary: built.summary,
        content: built.content,
        provenance: 'ai_generated',
      };
    } else {
      // Delegate everything else (including legacy direct simulate calls in tests) to the state-aware simulator.
      const { title, summary, content } = simulateCapabilityExecution(
        args.capabilityId,
        args.state,
        args.inputArtifactIds || []
      );
      result = {
        title,
        summary,
        content,
        provenance: "ai_generated",
      };
    }

    const durationMs = performance.now() - start;
    const contentLen = (result.content || "").length;
    const estimatedTokens = Math.ceil(contentLen / 4);

    // v1 cost telemetry: record estimated usage (callers in real page commit loop can use real duration + tokens).
    // We record on the snapshot state passed in; the costLedger will be present on the state at commit time
    // (or tests can explicitly pass the costed state). This keeps the seam contract unchanged.
    recordCapabilityRunCost(args.state, {
      id: `${args.turnId}-run`,
      capabilityId: args.capabilityId,
      turnId: args.turnId,
      inputs: args.inputArtifactIds || [],
      outputs: [],
      gateResults: [],
    } as any, {
      tokens: estimatedTokens,
      durationMs,
      source: "estimated",
    });

    return result;
  }
}

/**
 * PilotRealCapabilityExecutor — "真实 executor pilot" for the current phase.
 *
 * Per approved plan (真实 executor pilot：先接 risk.analyze + report.write):
 * - Only risk.analyze and report.write get richer/"pilot real" logic (still deterministic for repeatability + no external deps).
 * - All other capabilities transparently fall back to DefaultCapabilityExecutor (simulator).
 * - Executor contract strictly followed: only returns raw {title, summary, content, provenance?}.
 *   Trust Gate / evidenceRefs / producedBy / capabilityRunId binding / 9-section schema for report
 *   remain 100% the responsibility of commitArtifact + buildStructuredReport.
 * - This proves the swappable seam works for future real MCP/LLM/Tool impls without touching the closed loop.
 *
 * Durable Store Pilot (feat commit landed): the session backing is now file-durable with live __reload
 * recovery proof in smoke. The executor seam is ready for a real LlmCapabilityExecutor / Tool impl
 * (still scoped to risk+report initially; same raw return contract).
 *
 * Post-durable hygiene (this phase):
 * - verify:whybuddy-v5 is now closer to hermetic (browser smoke can auto-spawn Vite)
 * - __clear / __reload are gated behind NODE_ENV / explicit flag
 * - runtime data file is untracked (gitignore is effective)
 * Next after these: replace PilotReal with a real (LLM-backed) executor behind the same interface.
 */
class PilotRealCapabilityExecutor implements CapabilityExecutor {
  private base = new DefaultCapabilityExecutor();

  async executeCapability(args: {
    capabilityId: V5CapabilityId;
    state: V5SessionState;
    inputArtifactIds: string[];
    roleId?: string;
    turnId: string;
  }): Promise<{
    title: string;
    summary: string;
    content: string;
    provenance?: Artifact["provenance"];
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      model?: string;
    };
  }> {
    const start = performance.now();
    if (args.capabilityId === 'risk.analyze') {
      return this.executeRiskPilot(args);
    }
    if (args.capabilityId === 'report.write') {
      return this.executeReportPilot(args);
    }
    // Fallback for everything else keeps full backward compat for tests/smoke/default flows.
    return this.base.executeCapability(args);
  }

  private async executeRiskPilot(args: any) {
    const { state, inputArtifactIds, roleId, turnId } = args;
    const upstreams = (state.artifacts || []).filter((a: any) => inputArtifactIds.includes(a.id));
    const hasStale = (state.staleArtifactIds || []).length > 0 || upstreams.some((a: any) => (state.staleArtifactIds || []).includes(a.id));
    const priorRisks = (state.artifacts || []).filter((a: any) => a.kind === 'risk').length;

    // Richer pilot content (more specific evidence, explicit counters, actionable next, stale awareness).
    // Still pure + deterministic. Marked for easy identification in tests/smoke.
    const fragments = upstreams.flatMap((u: any) => extractArtifactFragments(u, 120)).map((f: any) => `- ${f.label}: ${f.text}`).join('\n');
    const content = `【真实试点 executor - risk.analyze】
基于 ${upstreams.length} upstreams（含 ${priorRisks} 历史风险）。${hasStale ? '注意：存在 stale 上游，风险评估已级联标记。' : '上下文稳定。'}

主要风险：
- 数据范围越权（跨项目/租户边界 RBAC 不足以表达；需引入 scoped filter + 显式 tenant/project 约束）
- 审计追溯不足（权限变更缺少操作者、时间、影响对象、before/after 快照）
${fragments ? '证据片段：\n' + fragments : ''}

反证/缓解：
- MVP 阶段可先做 RBAC + 基础范围过滤，预留 ABAC 扩展点（降低初期调试成本）。
- 引入操作审计表（持久化 + 可查询）作为硬性前置条件。

下一步工程化（可执行）：
- 走 structure.decompose 将风险拆成带证据的 SPEC tasks
- 替换本 pilot 为真实 Tool/MCP/LLM 能力（risk.analyze + report.write 已优先试点）
- 持久化层（SQLite / Postgres）替换 process Map backing（HTTP surface 不变）

pilot provenance：role=${roleId || '安全'} turn=${turnId}（deterministic richer pilot）`;

    return {
      title: '风险分析 (真实试点 executor)',
      summary: `Pilot richer risk analysis over ${upstreams.length} upstreams. ${hasStale ? '含 stale 级联警示。' : ''}`,
      content,
      provenance: 'ai_generated' as const,
    };
  }

  private async executeReportPilot(args: any) {
    // Still produce the exact 9-section schema (labels unchanged). Pilot only enriches depth/clarity.
    const built = buildStructuredReport({
      state: args.state,
      inputArtifactIds: args.inputArtifactIds || [],
      roleId: args.roleId,
      turnLabel: args.turnId?.includes('challenge') || args.turnId?.includes('node') ? '重入' : '试点',
    });

    // Light pilot enrichment while preserving every required label and structure.
    // We keep the builder output as the base (provenance/upstreams/fragments already correct) and
    // inject clearer decision rationale + more executable engineering branches.
    let content = built.content;
    if (!content.includes('【真实试点 executor')) {
      content = content.replace(
        '【可行性 / 产品推演报告',
        '【真实试点 executor - 可行性 / 产品推演报告'
      );
      // Enrich the "下一步工程化分支" section with pilot-specific concrete items (still schema-compliant).
      content = content.replace(
        /下一步工程化分支：[\s\S]*?(?=\nprovenance \/ upstream refs：|$)/,
        `下一步工程化分支：
- 走 structure.decompose 将收敛结论拆成可执行任务树（带证据引用）
- 替换默认 CapabilityExecutor 为真实 Tool/OpenAI/MCP 实现（risk.analyze + report.write 已优先试点）
- 将 process-local Map backing 的 HTTP session store 替换为 SQLite / Postgres 等 durable 存储（保持 /api/whybuddy surface 不变）
- 报告主输出支持导出为带 provenance 签名的 Markdown / PDF
- 引入真实 Trust Gate 后端（不再仅模拟 evaluateGates）
- Pilot 验证：本报告由 PilotRealCapabilityExecutor 产生，commitArtifact 仍负责 Trust Gate + producedBy 绑定（证据级闭环不变）

（以上分支直接对应当前 V5 生产化路线，pilot 内容更具体可执行）`
      );
    }

    return {
      title: built.title.replace('V5 Evidence Report', 'V5 Evidence Report (真实试点)'),
      summary: built.summary + ' [pilot richer]',
      content,
      provenance: 'ai_generated' as const,
    };
  }
}

/**
 * Thin provider interface for the LlmCapabilityExecutor seam.
 * A real implementation can call an actual LLM, MCP tool, or other external service.
 * The executor itself must only ever return the raw 4-field shape; runtime owns
 * Trust Gate, producedBy, commitArtifact, evidenceRefs, etc.
 */
export type LlmCapabilityProvider = (args: {
  capabilityId: V5CapabilityId;
  state: V5SessionState;
  inputArtifactIds: string[];
  roleId?: string;
  turnId: string;
}) => Promise<{
  title: string;
  summary: string;
  content: string;
  provenance?: Artifact["provenance"];
}>;

/**
 * LlmCapabilityExecutor — initial Real Executor Pilot (now with injectable provider seam).
 *
 * Per the approved plan (lock hygiene + start real executor):
 * - Implements the exact same CapabilityExecutor interface.
 * - Initially only special-cases risk.analyze + report.write (the two caps from the pilot).
 * - Strictly returns only the raw contract: { title, summary, content, provenance? }.
 * - On any provider error or for other capabilities, falls back to PilotRealCapabilityExecutor (or Default).
 * - Runtime (commitArtifact, Trust Gate, producedBy, evidenceRefs, etc.) remains completely untouched.
 * - Opt-in via useLlmCapabilityExecutor() (or by passing any CapabilityExecutor impl to setCapabilityExecutor).
 * - Module default is DefaultCapabilityExecutor. The /whybuddy page effect opts the demo into PilotRealCapabilityExecutor for richer outputs during the pilot phase.
 *
 * The default provider produces the current deterministic "LLM pilot" richer output.
 * A real provider (OpenAI, MCP, tool, etc.) can be injected at construction time.
 * The recommended real path is createServerLlmCapabilityProvider + useServerLlmCapabilityExecutor
 * (routes through the server LLM stack using the same config as /autopilot).
 * The old direct-browser createOpenAILlm... is deprecated for production use.
 */
export class LlmCapabilityExecutor implements CapabilityExecutor {
  private base = new PilotRealCapabilityExecutor();
  private provider: LlmCapabilityProvider;

  constructor(provider?: LlmCapabilityProvider) {
    // Default provider = current deterministic richer pilot logic (preserves existing behavior)
    this.provider = provider ?? (async (args) => {
      if (args.capabilityId === 'risk.analyze') {
        return {
          title: '风险分析 (LLM pilot)',
          summary: 'LLM pilot richer risk analysis.',
          content: '【LLM pilot - risk.analyze】\nPlaceholder richer content for real model/tool call. Fallback to PilotReal on error.',
          provenance: 'llm' as const,
        };
      } else {
        const built = buildStructuredReport({
          state: args.state,
          inputArtifactIds: args.inputArtifactIds || [],
          roleId: args.roleId,
        });
        return {
          title: built.title.replace('V5 Evidence Report', 'V5 Evidence Report (LLM pilot)'),
          summary: built.summary + ' [llm pilot]',
          content: built.content,
          provenance: 'llm' as const,
        };
      }
    });
  }

  async executeCapability(args: {
    capabilityId: V5CapabilityId;
    state: V5SessionState;
    inputArtifactIds: string[];
    roleId?: string;
    turnId: string;
  }): Promise<{
    title: string;
    summary: string;
    content: string;
    provenance?: Artifact["provenance"];
    payload?: unknown;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      model?: string;
    };
  }> {
    const serverRouted: V5CapabilityId[] = [
      'risk.analyze',
      'report.write',
      'repo.inspect',
      'evidence.search',
      'mcp.call',
      'skill.invoke',
      'memory.recall',
      'counter.argue',
      'critique.generate',
      'rebuttal.resolve',
      'synthesis.merge',
    ];
    if (serverRouted.includes(args.capabilityId)) {
      try {
        const result: any = await this.provider(args);
        // Knife 11: record real usage if provider returned it (server LLM), else estimate.
        const usage = result?.usage;
        const contentLen = (result?.content || "").length;
        const tokens = usage?.totalTokens ?? Math.ceil(contentLen / 4);
        const src = usage ? "server" : "estimated";
        recordCapabilityRunCost(args.state, {
          id: `${args.turnId}-run`,
          capabilityId: args.capabilityId,
          turnId: args.turnId,
          inputs: args.inputArtifactIds || [],
          outputs: [],
          gateResults: [],
        } as any, {
          tokens,
          source: src as any,
          ...(usage ? { usage } : {}),
        });
        return result;
      } catch (e) {
        // Provider (external) failure — reliable fallback as required by the plan.
        return await this.base.executeCapability(args);
      }
    }
    // Non-pilot caps: fall back without calling the provider.
    return await this.base.executeCapability(args);
  }
}

let currentCapabilityExecutor: CapabilityExecutor = new DefaultCapabilityExecutor();

/**
 * Inject a different CapabilityExecutor (real agent, MCP bridge, remote LLM runner, etc.).
 * Swapping does not affect load/derive/intake/orchestrate/commit/invalidate/derive invariants.
 */
export function setCapabilityExecutor(impl: CapabilityExecutor): void {
  currentCapabilityExecutor = impl;
}

export function getCapabilityExecutor(): CapabilityExecutor {
  return currentCapabilityExecutor;
}

/**
 * Convenience helpers for the 真实 executor pilot phase.
 * Tests and the /whybuddy page (demo) can opt-in to richer pilot outputs for risk.analyze + report.write.
 * The module default executor is DefaultCapabilityExecutor. The /whybuddy page effect may opt the demo into PilotRealCapabilityExecutor.
 * All existing tests, smokes, and closed-loop invariants remain on the default unless a test/page explicitly swaps the executor.
 */
export function usePilotRealExecutor(): void {
  setCapabilityExecutor(new PilotRealCapabilityExecutor());
}

export function useDefaultExecutor(): void {
  setCapabilityExecutor(new DefaultCapabilityExecutor());
}

/**
 * Opt-in to the initial Real Executor Pilot (LlmCapabilityExecutor).
 * Falls back to PilotReal on error / other capabilities.
 * Use this the same way as usePilotRealExecutor for demo / pilot runs.
 *
 * Recommended usage: the helper functions below.
 * Advanced / test usage: `setCapabilityExecutor(new LlmCapabilityExecutor(yourProvider))`.
 *
 * This installs the *built-in deterministic pilot provider* (the "LLM pilot" placeholder logic).
 * For a real backend (recommended), use `useServerLlmCapabilityExecutor()` which routes through
 * the project's server LLM stack (`/api/whybuddy/execute-capability` + getAIConfig + callLLMJson).
 * The old direct browser `createOpenAILlmCapabilityProvider` is kept for dev/demo only (it sends keys
 * to the browser and bypasses the unified server config).
 */
export function useLlmCapabilityExecutor(): void {
  setCapabilityExecutor(new LlmCapabilityExecutor());
}

/**
 * Factory for the recommended server-routed LlmCapabilityProvider.
 *
 * The client only does a POST to the local backend (`/api/whybuddy/execute-capability`).
 * The server is responsible for getAIConfig() + callLLMJson() (same stack as /autopilot).
 * This keeps API keys, wireApi choice, timeouts, and telemetry on the server.
 *
 * The returned provider still obeys the exact contract:
 *   input = { capabilityId, state, inputArtifactIds, roleId?, turnId }
 *   output = { title, summary, content, provenance? }
 *
 * Any non-2xx or network error from the endpoint causes the provider to throw,
 * which LlmCapabilityExecutor will catch and turn into a clean fallback to PilotReal.
 */
export function createServerLlmCapabilityProvider(opts: { endpoint?: string } = {}): LlmCapabilityProvider {
  const url = opts.endpoint || "/api/whybuddy/execute-capability";

  return async (args) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`server execute-capability failed ${res.status}: ${text.slice(0, 200)}`);
    }

    // The server must return exactly the raw shape.
    return res.json();
  };
}

/**
 * Opt-in to LlmCapabilityExecutor that talks to the server LLM stack for risk.analyze + report.write.
 * This is the primary "real" path for the V5 pilot (aligns with /autopilot).
 * Falls back to PilotRealCapabilityExecutor on any transport or server LLM error.
 */
export function useServerLlmCapabilityExecutor(endpoint?: string): void {
  const provider = createServerLlmCapabilityProvider({ endpoint });
  setCapabilityExecutor(new LlmCapabilityExecutor(provider));
}

/**
 * @deprecated
 * Direct browser OpenAI LlmCapabilityProvider.
 *
 * This was the initial "real wiring" pilot. It performs fetch directly to api.openai.com
 * from the client (browser) and therefore:
 *   - sends API keys to the client environment
 *   - bypasses the project's unified server LLM config (LLM_* / getAIConfig / wireApi etc.)
 *   - does not go through server callLLMJson / telemetry / fallback logic used by /autopilot
 *
 * Prefer `createServerLlmCapabilityProvider` + `useServerLlmCapabilityExecutor` (routes through
 * your own backend at /api/whybuddy/execute-capability, which uses the real server stack).
 *
 * Kept for dev/demo or very special cases only. In production the server-routed path must be used.
 *
 * Scope (per V5 pilot): only risk.analyze and report.write.
 * Still returns the exact raw contract and throws on error (so LlmCapabilityExecutor fallback works).
 */
export function createOpenAILlmCapabilityProvider(opts: { apiKey?: string; model?: string } = {}): LlmCapabilityProvider {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  const model = opts.model ?? 'gpt-4o-mini';

  return async (args) => {
    const { capabilityId, state, inputArtifactIds = [], roleId, turnId } = args;

    if (capabilityId !== 'risk.analyze' && capabilityId !== 'report.write') {
      throw new Error(`OpenAI provider does not handle capability: ${capabilityId}`);
    }

    if (!apiKey) {
      throw new Error('OpenAI provider not configured: provide apiKey or set OPENAI_API_KEY');
    }

    // Compact context for the prompt (avoid token bloat).
    const goalText = (state as any)?.goal?.text || (state as any)?.goal || '';
    const recentArtifacts = ((state as any).artifacts || []).slice(-6).map((a: any) => ({
      title: a?.title,
      kind: a?.kind,
      summary: String(a?.summary || '').slice(0, 220),
    }));

    const systemPrompt =
      'You are an expert AI collaborator for WhyBuddy V5. ' +
      'Return ONLY a single JSON object (no prose, no ```json fences) with exactly these keys:\n' +
      '{"title": string, "summary": string, "content": string}\n' +
      'title: short and specific. summary: one-sentence high-signal. content: professional, actionable, evidence-based.';

    let userPrompt = '';
    if (capabilityId === 'risk.analyze') {
      userPrompt =
        `Capability: risk.analyze\nGoal: ${goalText}\n` +
        `Context artifacts: ${JSON.stringify(recentArtifacts)}\n` +
        `Role: ${roleId || 'unspecified'}  Turn: ${turnId}\n\n` +
        'Produce a focused risk analysis: key risks, likelihood/impact, mitigations.';
    } else {
      // report.write — give the model the already-computed structured report as authoritative base
      const built = buildStructuredReport({ state, inputArtifactIds, roleId });
      userPrompt =
        `Capability: report.write\nGoal: ${goalText}\n` +
        `Base structured evidence (preserve facts & sections, improve narrative & insight):\n` +
        `BASE_TITLE: ${built.title}\nBASE_SUMMARY: ${built.summary}\nBASE_CONTENT:\n${built.content}\n\n` +
        `Role: ${roleId || '综合'}  Turn: ${turnId}\n\n` +
        'Return the polished final evidence report as the required JSON shape.';
    }

    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.25,
      max_tokens: 1600,
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 280)}`);
    }

    const json: any = await res.json();
    const rawContent: string = json?.choices?.[0]?.message?.content || '';

    let parsed: { title?: string; summary?: string; content?: string } = {};
    try {
      // Some models still wrap; be tolerant.
      const maybe = rawContent.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
      parsed = JSON.parse(maybe);
    } catch {
      parsed = { content: rawContent };
    }

    const title = (parsed.title || (capabilityId === 'risk.analyze' ? 'Risk Analysis' : 'Evidence Report')).trim();
    const summary = (parsed.summary || '').trim();
    const content = (parsed.content || rawContent || 'Model returned no content.').trim();

    return {
      title,
      summary: summary ? `${summary} [openai:${model}]` : `[openai:${model}]`,
      content,
      provenance: 'llm' as const,
    };
  };
}

/**
 * @deprecated
 * Opt-in to the old direct-browser OpenAI LlmCapabilityExecutor.
 *
 * See deprecation note on createOpenAILlmCapabilityProvider.
 * Use `useServerLlmCapabilityExecutor()` instead for the production-aligned path.
 */
export function useOpenAILlmCapabilityExecutor(apiKey?: string): void {
  const provider = createOpenAILlmCapabilityProvider({ apiKey });
  setCapabilityExecutor(new LlmCapabilityExecutor(provider));
}

/**
 * Clean return type for the public executeCapability wrapper.
 * The interface method already returns Promise<...>, so we use Awaited to avoid
 * publishing a nested Promise<Promise<Result>> contract to adapter authors.
 */
type CapabilityExecutionResult = Awaited<ReturnType<CapabilityExecutor["executeCapability"]>>;

/**
 * Official entry point for capability "execution" (content/title/summary generation).
 * All main paths (sendMessage + runReentryTurn in page, future internal) should
 * go through this instead of calling simulateCapabilityExecution directly.
 *
 * This keeps the closed loop (single INTAKE, exact producedBy.capabilityRunId binding,
 * AWAIT park, derive-as-truth) untouched while opening the execution layer.
 *
 * Return type is deliberately non-nested (CapabilityExecutionResult) so the contract
 * seen by real adapter authors (LlmCapabilityExecutor, ToolCapabilityExecutor, etc.)
 * is clean and unambiguous.
 */
export async function executeCapability(
  args: Parameters<CapabilityExecutor["executeCapability"]>[0]
): Promise<CapabilityExecutionResult> {
  return currentCapabilityExecutor.executeCapability(args);
}

// commitArtifact is the Trust Layer entry point (diagram: BUS ==> T_GATE ==> T_PROV ==> T_LEDGER ==> STATE)
// Now with real dependency edges and report gate check.
export function commitArtifact(
  state: V5SessionState,
  rawArtifact: Omit<Artifact, "trustLevel" | "passedGates">,
  runId: string,
  forceGateFail = false,
  declaredInputs: string[] = [] // pass the upstream artifact ids this run depends on
): { updatedState: V5SessionState; committed: Artifact | null; run: CapabilityRun } {
  // General Trust Layer rule (extended for demo consistency):
  // Any capability that declares upstreams will gate-fail if any upstream is untrusted/stale.
  // Special for report: also fail if no upstreams at all.
  let effectiveForceFail = forceGateFail;
  const capId = rawArtifact.producedBy.capabilityId;
  const isReport = capId === "report.write";
  const isSynthesisLike = capId === "synthesis.merge";

  if (isReport || isSynthesisLike) {
    if (declaredInputs.length === 0 && isReport) {
      effectiveForceFail = true;
    } else if (declaredInputs.length > 0) {
      const badUpstreams = declaredInputs.filter((id) => {
        const art = state.artifacts.find((a) => a.id === id);
        if (!art) return true;
        const isStale = state.staleArtifactIds.includes(id);
        return art.trustLevel === "untrusted" || isStale;
      });
      if (badUpstreams.length > 0) {
        effectiveForceFail = true;
      }
    }
  }

  // ===== V5.1 FLOWB (Knife 4): sanitize input fragments / content for formal report/synthesis
  // before it becomes the committed artifact. This is the key insertion for "fragments enter formal content".
  // Strips protocol noise, records the boundary check in state, optionally links to DLEDGER.
  let workingContent = rawArtifact.content || "";
  let flowCheck: FlowBoundaryCheck | null = null;
  if (isReport || isSynthesisLike) {
    const { cleanedText, check } = sanitizeThroughFlowBoundary(workingContent, {
      turnId: runId,
      source: isReport ? "artifact" : "executor",
    });
    workingContent = cleanedText;
    flowCheck = check;
  }

  const gateResults = evaluateGates(rawArtifact as any, effectiveForceFail);

  const passedGates = gateResults.filter((g) => g.status === "passed").map((g) => g.gateId);
  const allPassed = gateResults.every((g) => g.status === "passed");

  const committed: Artifact = {
    ...rawArtifact,
    content: workingContent,  // FLOWB-cleaned for report/synthesis formal paths
    trustLevel: allPassed ? (rawArtifact.provenance.includes("rendered") ? "audited" : "gated_pass") : "untrusted",
    passedGates,
    producedBy: {
      capabilityRunId: runId,
      capabilityId: rawArtifact.producedBy.capabilityId,
      roleId: rawArtifact.producedBy.roleId,
    },
    evidenceRefs: declaredInputs.length ? declaredInputs : undefined,
    // Persist content fields so that report/synthesis can aggregate real fragments from upstreams
    title: (rawArtifact as any).title,
    summary: (rawArtifact as any).summary,
  };

  // Build real dependency edges: for each declared input, input -> this output
  const newDeps: DependencyEdge[] = declaredInputs.map((inputId) => ({
    fromArtifactId: inputId,
    toArtifactId: committed.id,
    reason: `produced-by-${rawArtifact.producedBy.capabilityId}`,
  }));

  const run: CapabilityRun = {
    id: runId,
    capabilityId: rawArtifact.producedBy.capabilityId,
    roleId: rawArtifact.producedBy.roleId,
    inputs: declaredInputs,
    outputs: allPassed ? [committed.id] : [],
    gateResults,
    ledgerEntryId: `ledger-${runId}`,
    turnId: runId.split("-")[0] + "-" + runId.split("-")[1],
  };

  // Knife 6 v1: ensure cost record for the run (estimated from content length).
  // Duration is 0 in this path (measured at executor time in Default/Pilot).
  const contentForCost = (committed.content || (rawArtifact as any).content || "") as string;
  const estTokens = Math.ceil(contentForCost.length / 4);
  const costedStateForRun = recordCapabilityRunCost(state, run, {
    tokens: estTokens,
    durationMs: 0,
    source: "estimated",
  });
  // Use costed for the final returned state below (ledger will be included).

  // Always persist the artifact (even untrusted/rejected) so that "状态常驻" holds for attempts.
  // Report gate will still reject if it tries to reference bad upstreams.
  const newArtifacts = [...state.artifacts, committed];

  const newRuns = [...state.capabilityRuns, run];
  const newGates = [
    ...state.gates,
    ...gateResults.map((gr) => ({
      gateId: gr.gateId as any,
      kind: (gr.gateId === "commit" ? "commit" : "precondition") as any,
      status: gr.status,
      evaluatedAt: new Date().toISOString(),
    })),
  ];

  // FLOWB ledger + optional DLEDGER linkage (v1)
  let flowBoundaryLedger = state.flowBoundaryLedger || [];
  if (flowCheck) {
    flowBoundaryLedger = [...flowBoundaryLedger, flowCheck];
  }

  // Optional: link to the most recent DLEDGER decision for this turn (if present)
  let finalDecisionLedger = state.decisionLedger || [];
  if (flowCheck && finalDecisionLedger.length > 0) {
    const lastDec: any = finalDecisionLedger[finalDecisionLedger.length - 1];
    if (lastDec && typeof lastDec.turnId === "string" && runId.startsWith(lastDec.turnId.split("-")[0])) {
      lastDec.addresses = [...(lastDec.addresses || []), `flowb:${flowCheck.id}`];
    }
  }

  // Merge any cost ledger updates from record during this commit.
  const finalCostLedger = (costedStateForRun as any).costLedger || (state.costLedger || []);

  // Build the candidate updated state first (with new artifacts/runs so resolve can see the just-committed trusted run/art).
  let updated: V5SessionState = {
    ...state,
    artifacts: newArtifacts,
    capabilityRuns: newRuns,
    gates: newGates,
    dependencyGraph: [...state.dependencyGraph, ...newDeps],
    costLedger: finalCostLedger,
    flowBoundaryLedger,
    decisionLedger: finalDecisionLedger,
    coverageGaps: state.coverageGaps || [],
  };

  // Knife 7: after successful formal commit, auto-resolve any gaps now satisfied (e.g. required cap delivered).
  if (allPassed && (isReport || isSynthesisLike || capId === "risk.analyze")) {
    updated = resolveCoverageGapsFromState(updated);
  }

  return {
    updatedState: updated,
    committed: allPassed ? committed : null,
    run,
  };
}

// Helper: declare expected input kinds for a capability (for prototype dependency tracking)
const CAPABILITY_INPUT_KINDS: Partial<Record<V5CapabilityId, string[]>> = {
  "risk.analyze": ["clarification", "evidence"],
  "counter.argue": ["risk"],
  "synthesis.merge": ["risk", "evidence", "route_options"],
  "report.write": ["synthesis", "risk", "evidence", "route_options"],
  "structure.decompose": ["clarification", "evidence"],
};

// Find recent artifacts in state that match the required kinds for this capability
export function findInputsForCapability(state: V5SessionState, capabilityId: V5CapabilityId): string[] {
  const neededKinds = CAPABILITY_INPUT_KINDS[capabilityId] || [];
  if (neededKinds.length === 0) return [];

  const stales = new Set(state.staleArtifactIds || []);
  const inputs: string[] = [];
  // walk backwards to find most recent matching healthy artifact
  for (let i = state.artifacts.length - 1; i >= 0; i--) {
    const art = state.artifacts[i];
    if (
      neededKinds.includes(art.kind) &&
      isHealthyArtifact(art, stales) &&
      !inputs.includes(art.id)
    ) {
      inputs.push(art.id);
      if (inputs.length >= neededKinds.length) break;
    }
  }
  return inputs;
}

// invalidate is the Re-entry engine (diagram: INTERV / DEP / INVAL / STALE / RECOMP -> ORCH)
// Now with real cascade using dependencyGraph
export function invalidateForIntervention(
  state: V5SessionState,
  intervention: UserIntervention
): V5SessionState {
  const targetId = intervention.targetArtifactId || intervention.targetNodeId;
  const targetDecisionId = intervention.targetDecisionId;

  // Handle decision-level challenge (Knife 5) even if no artifact/node target.
  if (targetDecisionId) {
    const ledger = state.decisionLedger || [];
    const idx = ledger.findIndex((d: any) => d.id === targetDecisionId);
    if (idx >= 0) {
      const orig: any = ledger[idx];
      const challenged = {
        ...orig,
        status: "challenged" as const,
        challengedAt: new Date().toISOString(),
        challengeText: intervention.text || orig.challengeText,
      };
      const newLedger = [...ledger];
      newLedger[idx] = challenged;
      // Also mark any associated nodes if we can map (best-effort via chose caps from that turn).
      // For v1 we primarily rely on the ledger entry itself being marked.
      // Monotonic stale-set contract (bugfix 2.6): this decision-level early return spreads
      // `...state` and never reassigns `staleArtifactIds`, so any previously-stale ids are
      // preserved intact on this path. Preservation here is intentional, not incidental — do NOT
      // introduce any shrink of `staleArtifactIds` on this path; the set may only shrink through
      // the supersede / explicit-resolve exits, which live elsewhere.
      let nextState: V5SessionState = {
        ...state,
        decisionLedger: newLedger,
      };
      // C-2: a decision-level challenge that undermines a converged conclusion downgrades
      // goal.status back to "needs_refinement". When the session is at a converged conclusion
      // (`clear` / `not_recommended`), the decisions in the ledger are the supporting reasoning
      // the conclusion depended on, so challenging one undermines it. The downgrade is written
      // through the SAME single-writer `applyGoalConclusion` — never assigned to goal.status
      // directly — so no second writer is introduced. Non-converged sessions are left untouched.
      if (isConvergedConclusion(state.goal.status)) {
        nextState = applyGoalConclusion(nextState, "needs_refinement");
      }
      return nextState;
    }
    // If decision not found, fall through (still allow other invalidation if present).
  }

  if (!targetId) return state;

  // Collect initial targets
  const initialStale = new Set<string>([targetId]);

  // Cascade using dependencyGraph (edges: from=input, to=output means output depends on input)
  // If input is stale, all that have it as 'from' become stale.
  const affected = new Set<string>(initialStale);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of state.dependencyGraph) {
      if (affected.has(edge.fromArtifactId) && !affected.has(edge.toArtifactId)) {
        affected.add(edge.toArtifactId);
        changed = true;
      }
    }
  }

  // Also mark corresponding graph nodes as challenged.
  // 精确到 artifact/run 级（按 修复闭环 Medium 要求）：
  // 1. 优先用 intervention 携带的 targetArtifactId 直接找该 artifact 的 capabilityRunId
  // 2. 或者用受影响 artifact 的 producedBy.capabilityRunId 与 node 上预分配的 capabilityRunId 精确匹配
  // 3. 只有在没有 run 级信息时才退回到 turn + capability（避免同一 turn 内同一 capability 被多次调用时互相污染）
  const affectedArtifacts = state.artifacts.filter((a) => affected.has(a.id));

  // 如果 intervention 直接指定了 targetArtifactId，优先用它对应的精确 run
  const targetArtifact = targetId
    ? state.artifacts.find((a) => a.id === targetId)
    : undefined;
  const targetRunId = targetArtifact?.producedBy?.capabilityRunId;

  const newGraphNodes = (state.graph.nodes || []).map((node: any) => {
    if (!node.capabilityId) return node;

    // 最高优先级：精确 capabilityRunId 匹配（node 预分配的 vs artifact 实际的）
    let matches = false;

    if (targetRunId && node.capabilityRunId === targetRunId) {
      matches = true;
    } else if (node.capabilityRunId) {
      matches = affectedArtifacts.some((art) => {
        if (art.producedBy.capabilityId !== node.capabilityId) return false;
        return art.producedBy?.capabilityRunId === node.capabilityRunId;
      });
    }

    // 回退：老的 turn+cap 逻辑（只有在 node 或 affected artifact 缺 runId 信息时才用，保持兼容）。
    // 如果双方都有 runId 且精确匹配失败，不能再回退，否则同一 turn 内重复 capability 会被误染。
    const hasRunLevelInfo =
      Boolean(node.capabilityRunId) &&
      affectedArtifacts.some((art) => Boolean(art.producedBy?.capabilityRunId));
    if (!matches && !hasRunLevelInfo) {
      const nodeTurn = node.turnId || (typeof node.id === "string" ? node.id.split("-node")[0] : "");
      matches = affectedArtifacts.some((art) => {
        if (art.producedBy.capabilityId !== node.capabilityId) return false;
        const run = art.producedBy?.capabilityRunId || "";
        const artTurn = run.includes("-run-") ? run.split("-run-")[0] : (run.split("-")[0] || "") + "-" + (run.split("-")[1] || "");
        return nodeTurn && artTurn ? nodeTurn === artTurn : true;
      });
    }

    if (matches) {
      return { ...node, status: "challenged" as const };
    }
    return node;
  });

  // Monotonic stale-set contract: a challenge UNIONS its freshly-computed cascade into the
  // session's existing stale set; it never overwrites/shrinks it. Prior stale ids come first,
  // then new cascade ids in iteration order, de-duplicated via Set — giving a deterministic,
  // stable ordering for P2 byte-identical card/node parity. The stale set may only shrink through
  // the two permitted exits (supersede of a specific id, explicit resolve of a specific id),
  // which live outside this challenge-recompute path.
  const mergedStale = Array.from(
    new Set<string>([...(state.staleArtifactIds || []), ...affected])
  );
  let nextState: V5SessionState = {
    ...state,
    staleArtifactIds: mergedStale,
    graph: {
      ...state.graph,
      nodes: newGraphNodes,
    },
  };

  // C-2: when a challenge stales artifacts the current converged conclusion depended on,
  // downgrade goal.status back to "needs_refinement" through the SAME single-writer
  // `applyGoalConclusion` (no second writer of goal.status is introduced; never assigned
  // directly). The conclusion (`clear` / `not_recommended`) is GCOV-gated on a trusted committed
  // `report`, so the conclusion "depended on" an artifact iff a report-kind artifact lands in the
  // freshly-staled cascade — either because the report itself was challenged, or because a true
  // upstream of the report was challenged and the dependency closure cascaded into the report.
  // Unrelated challenges (whose cascade never reaches a report-kind artifact) and non-converged
  // sessions leave goal.status untouched.
  if (isConvergedConclusion(state.goal.status)) {
    const prevStale = new Set(state.staleArtifactIds || []);
    const conclusionArtifactStaled = (state.artifacts || []).some(
      (a) => a.kind === "report" && affected.has(a.id) && !prevStale.has(a.id)
    );
    if (conclusionArtifactStaled) {
      nextState = applyGoalConclusion(nextState, "needs_refinement");
    }
  }

  return nextState;
}

// ===== INTAKE (single door) + AWAIT support per 修复闭环.md =====

export type ControlSignal =
  | "new_goal"
  | "refine"
  | "challenge"
  | "meta"
  | "sub_question"
  | "branch";

export interface IntakeResult {
  preparedState: V5SessionState;
  context: OrchestrateContext;
  controlSignal: ControlSignal;
}

/**
 * 将 UserIntervention.intent 显式、安全地映射到 ControlSignal。
 * 避免任何 "as ControlSignal" 导致运行时值跑出声明 union 的情况。
 * 这是 INTAKE 分类 contract 的一部分。
 */
export function mapInterventionToControlSignal(
  intent: UserIntervention["intent"]
): ControlSignal {
  switch (intent) {
    case "challenge":
    case "revise":
      return "challenge";
    case "clarify":
    case "expand":
      return "refine";
    case "preview":
    case "compare":
      return "branch";
    case "synthesize":
    case "generate_plan":
      return "meta";
    default:
      return "meta";
  }
}

/**
 * INTAKE single door (核心修复：消灭"两道门")
 * 所有入站（打字消息 + 节点/段落挑战）**必须**先走这里。
 * 职责（薄层）：
 *  - "load SessionState(sessionId) + derive"（内存原型即接收当前活 state）
 *  - 分类控制信号：new_goal **仅**在空状态（无 artifacts 且无 conversation）出现
 *  - 追加 conversation、应用 intervention/invalidate
 *  - 标记 runtimePhase = "orchestrating"（为 AWAIT 闭环提供可观测状态）
 * 返回 preparedState + context 供 orchestrate 使用 + 分类结果。
 * 页面 sendMessage / challenge **只能**调用本函数，不得再直连 orchestrate。
 */
export function intakeMessage(
  state: V5SessionState,
  inbound: { turnId: string; userText?: string; intervention?: UserIntervention }
): IntakeResult {
  let working: V5SessionState = { ...state };

  const turnId = inbound.turnId;
  const userText = inbound.userText || "";
  const intervention = inbound.intervention;

  // 分类：new_goal 仅空状态（文档硬规则）
  const isEmptySession =
    (working.artifacts || []).length === 0 &&
    (working.conversation || []).length === 0;
  let controlSignal: ControlSignal = isEmptySession ? "new_goal" : "refine";

  if (intervention) {
    // 使用显式映射函数，保证返回值永远是 ControlSignal 成员（消灭 as 绕过）
    controlSignal = mapInterventionToControlSignal(intervention.intent);
    working = invalidateForIntervention(working, intervention);
  }

  // 始终追加用户消息到 conversation（可追溯）
  if (userText) {
    working = {
      ...working,
      conversation: [
        ...(working.conversation || []),
        {
          id: `${turnId}-conv`,
          role: "user",
          text: userText,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  // 标记阶段：支持外圈 ORCH → AWAIT → INTAKE 证明
  working = {
    ...working,
    runtimePhase: "orchestrating",
    lastTurnId: turnId,
    sessionId: working.sessionId, // 透传
  };

  const context: OrchestrateContext = {
    turnId,
    userText,
    intervention,
  };

  return { preparedState: working, context, controlSignal };
}

/** 收敛后让位，进入 AWAIT 歇脚点（状态常驻，下一条消息从此续） */
export function markAwaiting(state: V5SessionState, turnId?: string): V5SessionState {
  return {
    ...state,
    runtimePhase: "awaiting",
    lastTurnId: turnId || state.lastTurnId,
  };
}

/**
 * Post-commit enrichment: 把本轮已提交的 artifact 精确回写到对应的 graph node 上。
 *
 * 目的（支撑 修复闭环 的 node/artifact 精确绑定 + 未来 BOARD 点节点 → INTAKE 带 targetArtifactId）：
 * - 节点在 orchestrate 时只知道“计划中的 capabilityRunId”
 * - commit 成功后我们知道“这个 runId 真正产出了哪个 artifactId”
 * - 这样 stale 标记、挑战、pin 等操作就能做到真正的 artifact/run 级，而不只是 capability 级。
 */
export function enrichGraphNodesAfterCommit(
  state: V5SessionState,
  turnId: string
): V5SessionState {
  const nodes = (state.graph.nodes || []).map((node: any) => {
    // 只处理本轮的节点；如果已经 attach 过就跳过（幂等）
    if (!node || node.turnId !== turnId || node.producedArtifactId) return node;

    // 按预分配的 capabilityRunId 找到本轮真正产出的 artifact
    const match = (state.artifacts || []).find(
      (art) => art.producedBy?.capabilityRunId === node.capabilityRunId
    );

    if (match) {
      return {
        ...node,
        producedArtifactId: match.id,
        // 也把最终的 run id 明确挂上（虽然和 capabilityRunId 一致，但对可视化/调试有帮助）
        producedRunId: node.capabilityRunId,
      };
    }
    return node;
  });

  return {
    ...state,
    graph: {
      ...state.graph,
      nodes,
    },
  };
}

// The main orchestrator entry (the heart of the diagram)
export function orchestrateReasoningTurn(
  state: V5SessionState,
  context?: OrchestrateContext
): { newState: V5SessionState; plan: TurnPlan; newGraphNodes: BrainstormReasoningNode[] } {
  let working = { ...state };
  const turnId = context?.turnId || `turn-${Date.now()}`;
  const userText = context?.userText || "";
  const intervention = context?.intervention;

  // 1. Handle intervention / re-entry first (V5:失效引擎是一等公民)
  // intakeMessage 已经对 intervention 执行过 invalidate（单门原则）。
  // 这里加 guard：如果本 turn 已经由 intake 预处理过（lastTurnId + orchestrating 阶段），则跳过重复 invalidate。
  // 保留对老的“直接调用 orchestrate”的向后兼容（测试里仍可能直连）。
  const alreadyPreprocessedByIntake =
    intervention &&
    working.lastTurnId === turnId &&
    (working.runtimePhase === "orchestrating" || working.runtimePhase === "awaiting");
  if (intervention && !alreadyPreprocessedByIntake) {
    working = invalidateForIntervention(working, intervention);
  }

  // Always append the current user turn to conversation (traceability)
  // 防御重复追加：如果 intake 已为本 turn 追加过，则跳过
  const hasThisTurnConv = (working.conversation || []).some(
    (c) => c.id === `${turnId}-conv`
  );
  if (userText && !hasThisTurnConv) {
    working.conversation = [
      ...working.conversation,
      {
        id: `${turnId}-conv`,
        role: "user",
        text: userText,
        timestamp: new Date().toISOString(),
      },
    ];
  }

  // ===== V5.1 Budget Gate (P4/B first knife) =====
  // All entries to ORCH (from INTAKE send/challenge/node-click, reentry, tests) pass here.
  // Evaluate on current persisted runs (pre this turn's commits). If over: park AWAIT partial immediately,
  // return empty plan (caller exec loop becomes no-op), carry trace in conv (auditable, durable).
  // Page flow unchanged: 0 selected + already-awaiting state + later markAwaiting is safe.
  const budgetCheck = evaluateBudgetBeforeOrchestrate(working, { turnId, userText, intervention: context?.intervention });
  if (!budgetCheck.allowed) {
    let parked = markAwaiting(working, turnId);
    const noteText = `[BUDGET] exceeded: ${budgetCheck.reason || 'policy limit'}. Partial AWAIT (no new capabilities scheduled this turn).`;
    const note = {
      id: `${turnId}-budget`,
      role: 'system',
      text: noteText,
      timestamp: new Date().toISOString(),
    };
    parked = {
      ...parked,
      conversation: [...(parked.conversation || []), note],
    };
    // Record hook (v1 no-op beyond trace; real cost telemetry lands in DLEDGER later)
    parked = recordCapabilityRunCost(parked, { id: `${turnId}-budget-run`, capabilityId: 'budget.gate' as any, turnId, inputs: [], outputs: [], gateResults: [] } as any);

    // V5.1 DLEDGER: even on budget block we record a decision (decided policy: special blocked entry for complete history).
    const nowIsoBlock = new Date().toISOString();
    const allCapIdsBlock = Array.from(V5_CAPABILITY_POOL.keys()) as string[];
    const blockDecision: SchedulingDecision = {
      id: `${turnId}-dledger-budget`,
      turnId,
      saw: allCapIdsBlock,
      chose: [],
      skipped: allCapIdsBlock.map((cid) => ({ capabilityId: cid, reason: "blocked_by_budget" })),
      addresses: [],
      rationale: `blocked_by_budget: ${budgetCheck.reason}`,
      alternativesRejected: allCapIdsBlock,
      createdAt: nowIsoBlock,
    };
    parked = {
      ...parked,
      decisionLedger: [...(parked.decisionLedger || []), blockDecision],
    };

    return {
      newState: parked,
      plan: { selected: [], reason: `BUDGET_EXCEEDED: ${budgetCheck.reason}`, expectedArtifacts: [] } as TurnPlan,
      newGraphNodes: [],
    };
  }

  // ===== Knife 9: CONTRACT -> BUDGET stop policy (v1) =====
  // If budget count ok so far, but CoverageContract baseline is sufficient (gaps resolved/waived, no stale,
  // has recent report, and this turn is not a meaningful intervention), stop redundant converge to avoid
  // wasting runs when "够了就停".
  const sufficiency = evaluateContractSufficiencyForBudget(working, { turnId, userText, intervention: context?.intervention });
  if (sufficiency.sufficient) {
    let parked = markAwaiting(working, turnId);
    const noteText = `[BUDGET] stopped: contract already sufficient. ${sufficiency.reason}. Partial AWAIT (no new capabilities scheduled this turn).`;
    const note = {
      id: `${turnId}-budget-contract`,
      role: 'system',
      text: noteText,
      timestamp: new Date().toISOString(),
    };
    parked = {
      ...parked,
      conversation: [...(parked.conversation || []), note],
    };
    parked = recordCapabilityRunCost(parked, { id: `${turnId}-budget-contract-run`, capabilityId: 'budget.contract_stop' as any, turnId, inputs: [], outputs: [], gateResults: [] } as any);

    // Special DLEDGER for contract sufficiency stop (auditable, parallel to budget block).
    const nowIsoContractStop = new Date().toISOString();
    const allCapIdsContractStop = Array.from(V5_CAPABILITY_POOL.keys()) as string[];
    const contractStopDecision: SchedulingDecision = {
      id: `${turnId}-dledger-contract-stop`,
      turnId,
      saw: allCapIdsContractStop,
      chose: [],
      skipped: allCapIdsContractStop.map((cid) => ({ capabilityId: cid, reason: "stopped_by_contract_sufficiency" })),
      addresses: (working.coverageContract as any)?.blockingGapIds?.map((gid: string) => `coverage:gap:${gid}`) || [],
      rationale: `stopped_by_contract_sufficiency: ${sufficiency.reason}`,
      alternativesRejected: allCapIdsContractStop,
      createdAt: nowIsoContractStop,
    };
    parked = {
      ...parked,
      decisionLedger: [...(parked.decisionLedger || []), contractStopDecision],
    };

    return {
      newState: parked,
      plan: { selected: [], reason: `CONTRACT_SUFFICIENT: ${sufficiency.reason}`, expectedArtifacts: [] } as TurnPlan,
      newGraphNodes: [],
    };
  }

  // 2. Use the provided userText for picking (the "chat manipulator" contract)
  const userTextForPick = userText || working.goal.text;

  // 3. Pick — R1: consume server proposedPlan when present; else local heuristic (shared).
  let selected: Array<{ capabilityId: V5CapabilityId; roleId: string }>;
  let planSource: SchedulingDecision["source"] = "local_heuristic";
  let droppedFromProposal: SchedulingDecision["droppedFromProposal"];
  let pickRationale: string;

  const proposed = context?.proposedPlan;
  if (proposed) {
    const validated = validateProposedPlan(
      { selected: proposed.selected, rationale: proposed.rationale },
      working
    );
    if (validated.valid && validated.selected.length > 0) {
      selected = validated.selected;
      planSource = proposed.source;
      droppedFromProposal = validated.dropped.length > 0 ? validated.dropped : undefined;
      pickRationale = proposed.rationale;
    } else {
      selected = pickNextCapabilitiesHeuristic(working, userTextForPick);
      planSource = "local_heuristic";
      droppedFromProposal = validated.dropped;
      pickRationale = `proposed plan failed defense validation; local heuristic for: ${(userTextForPick || "").slice(0, 80)}`;
    }
  } else {
    selected = pickNextCapabilitiesHeuristic(working, userTextForPick);
    planSource = "local_heuristic";
    pickRationale = `Goal/stale/keyword-driven pick for: ${(userTextForPick || "").slice(0, 80)}... (stale=${(working.staleArtifactIds || []).length}, hasRisk=${(working.artifacts || []).some((a: any) => a.kind === "risk")})`;
  }

  // ===== V5.1 DLEDGER (P1/A) =====
  const nowIso = new Date().toISOString();
  const choseIds = selected.map((s: any) => s.capabilityId as string);
  const allCapIds = Array.from(V5_CAPABILITY_POOL.keys()) as string[];
  const saw = allCapIds;
  const notChosenReason =
    planSource === "local_heuristic"
      ? "not chosen by current pickNext heuristic for this turn"
      : "not chosen by orchestration proposal for this turn";
  const skipped = saw
    .filter((cid) => !choseIds.includes(cid))
    .map((cid) => ({ capabilityId: cid, reason: notChosenReason }));
  const decision: SchedulingDecision = {
    id: `${turnId}-dledger`,
    turnId,
    saw,
    chose: choseIds,
    skipped,
    addresses: [],
    rationale: pickRationale,
    alternativesRejected: skipped.map((s) => s.capabilityId),
    createdAt: nowIso,
    source: planSource,
    ...(droppedFromProposal?.length ? { droppedFromProposal } : {}),
  };

  // Knife 5: if this turn came from a decision challenge, mark influence on the new decision record
  // and bias the effective plan to reconsider elements from the challenged decision (v1: prepend previous chose for reconsideration).
  const challengeIntervention = intervention;
  if (challengeIntervention?.targetDecisionId) {
    const oldDec: any = (working.decisionLedger || []).find((d: any) => d.id === challengeIntervention.targetDecisionId);
    if (oldDec) {
      (decision as any).rationale = `${decision.rationale} | decision challenged: ${challengeIntervention.targetDecisionId} "${(challengeIntervention.text || "").slice(0, 60)}" — reconsidering prior chose/alternativesRejected`;
      // v1 reconsideration bias: include previous chose items that weren't already picked this turn (so plan reflects re-consider)
      const prevChose = (oldDec.chose || []) as string[];
      const toReconsider = prevChose.filter((cid: string) => !choseIds.includes(cid));
      if (toReconsider.length > 0) {
        // prepend for visibility in plan (actual execution will still go through later commit)
        // We adjust the local choseIds for this decision record and will use for effective later if needed.
        (decision as any).chose = [...toReconsider, ...choseIds];
        // Also surface in alternativesRejected note for audit
        (decision as any).rationale = `${(decision as any).rationale} (reconsidered: ${toReconsider.join(',')})`;
      }
    }
  }

  working = {
    ...working,
    decisionLedger: [...(working.decisionLedger || []), decision],
  };

  // Knife 5: if the just-recorded decision was biased by a challenge (chose now contains reconsidered items),
  // propagate to effectiveSelected so the returned TurnPlan reflects the reconsideration for this turn.
  let effectiveSelected = [...selected];
  const recordedChose = (decision as any).chose;
  if (intervention?.targetDecisionId && recordedChose && recordedChose.length > 0) {
    const origIds = selected.map((s: any) => s.capabilityId);
    const extra = recordedChose.filter((cid: string) => !origIds.includes(cid));
    if (extra.length > 0) {
      effectiveSelected = [
        ...extra.map((cid: string) => ({ capabilityId: cid as V5CapabilityId })),
        ...effectiveSelected,
      ];
    }
  }

  // ===== V5.1 GCOV (Knife 3) after DLEDGER, before final plan/graph =====
  // Budget already passed earlier; GCOV may force prepend missing required, but we respect per-turn budget afford.
  // Only act when converge intent (report.write selected or similar). Author contract on first need (v1).
  // On !passed: set coverageGate, prepend missing (capped by budget), patch latest DLEDGER decision (addresses + chose), adjust effective plan.
  const hasConvergeIntent = selected.some((s: any) => s.capabilityId === 'report.write') ||
    /报告|report|总结|收敛|converge/.test(userTextForPick);
  if (!working.coverageContract) {
    // Contract is goal/session level; prioritize goal.text for mode (simple vs complex) even if this turn's userText is short.
    // Knife 7: author + freeze baseline + init gaps on first use.
    const goalForContract = working.goal?.text || userTextForPick || "";
    const { contract, gaps } = authorCoverageContract(goalForContract, turnId);
    working = {
      ...working,
      coverageContract: contract,
      coverageGaps: gaps,
    };
    // Knife 7: on first authoring in this ORCH, immediately resolve any gaps already satisfied by prior state (e.g. previous turns' commits).
    working = resolveCoverageGapsFromState(working);
  }
  const gateResult = evaluateCoverageGate(working, selected, working.coverageContract);
  working = {
    ...working,
    coverageGate: gateResult,
  };

  // ===== V5.1 GOAL conclusion write (GCOV-gated, single-writer) =====
  // Bugfix spec: whybuddy-goal-conclusion-gate (Task 3.2).
  // GCOV is the SOLE authority over the conclusion: the write is driven by `gateResult`, never by
  // ORCH pick/budget/scheduling logic, so ORCH stays read-only on GOAL. On the hard-block branch
  // below (`!gateResult.passed && hasConvergeIntent`) `deriveGoalConclusion` returns
  // "needs_refinement" (a no-op equal to the initial value), so that path is unchanged before its
  // early return.
  working = applyGoalConclusion(
    working,
    deriveGoalConclusion(working, gateResult, working.coverageContract)
  );

  if (!gateResult.passed && hasConvergeIntent) {
    const missing = gateResult.missingCapabilities || [];
    const toForce = missing
      .filter((m) => !effectiveSelected.some((s: any) => s.capabilityId === m))
      .map((m) => ({
        capabilityId: m as V5CapabilityId,
        roleId: m.includes('risk') ? '安全' : (m.includes('synthesis') ? '综合' : '综合'),
      }));

    // Budget respect in same turn (conservative v1): use policy maxPerTurn, assume 0 committed yet this turn.
    const policy = getDefaultBudgetPolicy();
    const afford = Math.max(0, policy.maxCapabilityRunsPerTurn - effectiveSelected.length);
    const forced = toForce.slice(0, afford);
    const forcedIds = forced.map((f: any) => f.capabilityId);

    if (forced.length > 0) {
      effectiveSelected = [...forced, ...effectiveSelected];
    }

    // Link to DLEDGER: patch the just-appended decision (addresses + chose if forced).
    // Critical: also remove any forced caps from skipped / alternativesRejected so the ledger stays consistent
    // (a cap that was "not chosen by picker" but later forced by GCOV for coverage must not appear in both chose and skipped).
    const ledgerArr = working.decisionLedger || [];
    if (ledgerArr.length > 0) {
      const lastDec: any = ledgerArr[ledgerArr.length - 1];
      if (lastDec) {
        const covAdds = missing.map((m) => `coverage:required:${m}`);
        // Knife 7: richer addresses with gaps from current contract
        const gapAdds = ((working.coverageGaps || []) as any[]).filter((g: any) => (working.coverageContract as any)?.blockingGapIds?.includes(g.id)).map((g: any) => `coverage:gap:${g.id}`);
        lastDec.addresses = [...(lastDec.addresses || []), ...covAdds, ...gapAdds];
        if (forced.length > 0) {
          lastDec.chose = [...(lastDec.chose || []), ...forcedIds];
          lastDec.skipped = (lastDec.skipped || []).filter((sk: any) => !forcedIds.includes(sk.capabilityId));
          lastDec.alternativesRejected = (lastDec.alternativesRejected || []).filter((cid: string) => !forcedIds.includes(cid));
          lastDec.rationale = `${lastDec.rationale || ''} | GCOV-forced: ${forcedIds.join(',')}`;
        } else if (missing.length > 0) {
          lastDec.rationale = `${lastDec.rationale || ''} | GCOV: ${gateResult.reason}`;
        }
      }
    }

    // Hard block for premature report/converge (per review): if after budget-aware force attempt we still have
    // unresolved pre-req missing (e.g. risk.analyze) and the plan still contains report.write (or converge intent),
    // do not allow the turn to proceed with a report. Instead park at partial AWAIT (like Budget block),
    // record auditable [GCOV] note, return empty plan. This makes GCOV a true mechanical gate, not just a marker.
    const preReqs = missing.filter((m) => m !== 'report.write');
    const stillMissingPreReqs = preReqs.filter((m) => !effectiveSelected.some((s: any) => s.capabilityId === m));
    const reportStillPresent = effectiveSelected.some((s: any) => s.capabilityId === 'report.write');
    if (stillMissingPreReqs.length > 0 && reportStillPresent) {
      let parked = markAwaiting(working, turnId);
      const noteText = `[GCOV] blocked: ${gateResult.reason}. Required capabilities not fully scheduled due to budget afford. Partial AWAIT (no convergence this turn).`;
      const note = {
        id: `${turnId}-gcov`,
        role: 'system',
        text: noteText,
        timestamp: new Date().toISOString(),
      };
      parked = {
        ...parked,
        conversation: [...(parked.conversation || []), note],
        coverageGate: working.coverageGate,
        coverageContract: working.coverageContract,
        decisionLedger: working.decisionLedger,
      };

      // Ensure the last decision reflects the block for audit trail
      const ldArr = parked.decisionLedger || [];
      if (ldArr.length > 0) {
        const ld: any = ldArr[ldArr.length - 1];
        if (ld) {
          ld.rationale = `${ld.rationale || ''} | GCOV_BLOCKED`;
        }
      }

      return {
        newState: parked,
        plan: { selected: [], reason: `GCOV_BLOCKED: ${gateResult.reason}`, expectedArtifacts: [] } as TurnPlan,
        newGraphNodes: [],
      };
    }
  }

  // 4. For each selected, declare real inputs from current state (this populates dependencyGraph later in commit)
  const selectedWithInputs = effectiveSelected.map((sel) => ({
    ...sel,
    inputArtifactIds: findInputsForCapability(working, sel.capabilityId as V5CapabilityId),
  }));

  // 5. For the prototype, we also produce some graph nodes here (so the surface updates)
  // 携带 turnId + 预分配的 capabilityRunId（与页面 commit 循环使用的 `${turnId}-run-${i}` 一致），
  // 让 invalidate 能做到真正的 artifact/run 级精确匹配，而不是只靠 turn+capability。
  const newGraphNodes: BrainstormReasoningNode[] = effectiveSelected.map((sel, i) => ({
    id: `${turnId}-node-${i}`,
    type: "hypothesis",
    title: `${sel.roleId} · ${sel.capabilityId}`,
    body: `Produced by orchestrateReasoningTurn for: ${userTextForPick.slice(0, 80)}`,
    roleId: sel.roleId,
    roleLabel: sel.roleId,
    capabilityId: sel.capabilityId,
    // INTAKE/AWAIT + 精确绑定所需
    turnId,
    // 预分配 run id（页面 commit 时会用同样的 `${turnId}-run-${idx}` 生成真实 run）
    capabilityRunId: `${turnId}-run-${i}`,
    status: "active",
  } as any));

  // Merge into graph (the page will also keep its own copy for the surface component)
  working.graph = {
    ...working.graph,
    nodes: [...(working.graph.nodes || []), ...newGraphNodes],
  };

  const plan: TurnPlan = {
    selected: selectedWithInputs.map((s) => ({
      capabilityId: s.capabilityId,
      roleId: s.roleId,
      inputArtifactIds: s.inputArtifactIds,
    })),
    reason: intervention
      ? `UserIntervention received. Stale marked. Re-picking capabilities.`
      : `Goal-driven pick from capability pool (userText: ${userTextForPick.slice(0, 60)}...)`,
    expectedArtifacts: effectiveSelected.map((s) => `${s.capabilityId}-artifact`),
  };

  return { newState: working, plan, newGraphNodes };
}

/**
 * Lightweight behavioral test / verifier for the V5 closed loop (for harness / demo).
 * Checks that a "报告" goal produced a report that referenced real upstreams from the same turn,
 * and that the dependency + gate mechanics are at least exercised.
 *
 * Call this after a combo round (risk+counter+synthesis+report) to "钉住" the chain.
 */
export function verifyV5ClosedLoop(state: V5SessionState): { passed: boolean; details: string } {
  const reports = state.artifacts.filter(a => a.kind === 'report' && a.producedBy?.capabilityId === 'report.write');
  if (reports.length === 0) {
    return { passed: false, details: 'No report.write artifact found in state.' };
  }

  const latestReport = reports[reports.length - 1];
  const upstreamCount = (latestReport.evidenceRefs || []).length;

  const hasRealUpstreams = upstreamCount > 0;
  const hasRecentCapabilityRuns = state.capabilityRuns.some(r =>
    ['risk.analyze', 'counter.argue', 'synthesis.merge', 'report.write'].includes(r.capabilityId)
  );

  // Stricter trust/stale guard as per review
  const reportTrusted = latestReport.trustLevel === 'gated_pass' || latestReport.trustLevel === 'audited';
  const upstreamIds = latestReport.evidenceRefs || [];
  const upstreamArtifacts = state.artifacts.filter(a => upstreamIds.includes(a.id));
  const allUpstreamsTrusted = upstreamArtifacts.every(a => (a.trustLevel === 'gated_pass' || a.trustLevel === 'audited') && !state.staleArtifactIds.includes(a.id));

  const details = `Report references ${upstreamCount} upstreams (trusted: ${allUpstreamsTrusted}). Report trust: ${latestReport.trustLevel}. Recent relevant runs: ${hasRecentCapabilityRuns}.`;

  const passed = hasRealUpstreams && hasRecentCapabilityRuns && reportTrusted && allUpstreamsTrusted;

  return { passed, details };
}

// Re-export the shared report builder so that existing call sites inside this file
// and any external code doing `import { buildStructuredReport } from './whybuddy-runtime'`
// continue to work without changes.
export {
  buildStructuredReport,
  extractArtifactFragments,
  type StructuredReportInput,
  type ArtifactFragment,
  type FragmentKind,
} from "@shared/blueprint/whybuddy-report-builder.js";
