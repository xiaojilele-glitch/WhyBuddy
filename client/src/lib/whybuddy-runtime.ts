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

// Simple deterministic picker (can be replaced by real ML / agent later)
// Now significantly state-aware for target-driven scheduling (per V5 doc).
// Uses: userText, stale, existing artifact kinds, recent runs, to pick (capability, role) pairs
// and proactively fill gaps for report/synthesis.
export function pickNextCapabilities(
  state: V5SessionState,
  userText: string
): Array<{ capabilityId: V5CapabilityId; roleId: string }> {
  const lower = userText.toLowerCase();
  const picks: Array<{ capabilityId: V5CapabilityId; roleId: string }> = [];

  const available = V5_CAPABILITY_POOL;

  // Collect what we already have for gap analysis
  const existingKinds = new Set((state.artifacts || []).map(a => a.kind));
  const hasRisk = existingKinds.has('risk');
  const hasSynthesis = existingKinds.has('synthesis');
  const hasReport = existingKinds.has('report');
  const staleCount = (state.staleArtifactIds || []).length;
  const recentRuns = (state.capabilityRuns || []).slice(-6).map(r => r.capabilityId);
  const openQCount = (state.openQuestions || []).length;
  const ledger = getSessionLedger(state);
  const recentLedgerCaps = ledger.slice(-4).map(l => l.capabilityId);

  // Keyword driven (still useful as user "manipulator")
  if (lower.includes("路线") || lower.includes("route") || lower.includes("对比")) {
    if (available.has("route.generate")) picks.push({ capabilityId: "route.generate", roleId: "架构" });
    if (available.has("route.compare")) picks.push({ capabilityId: "route.compare", roleId: "工程" });
  }
  if (lower.includes("澄清") || lower.includes("clarif") || lower.includes("模糊")) {
    if (available.has("intent.clarify")) picks.push({ capabilityId: "intent.clarify", roleId: "产品" });
  }
  if (lower.includes("风险") || lower.includes("安全") || lower.includes("反驳")) {
    if (available.has("risk.analyze")) picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
    if (available.has("counter.argue")) picks.push({ capabilityId: "counter.argue", roleId: "挑刺" });
  }
  if (lower.includes("树") || lower.includes("拆解") || lower.includes("spec tree")) {
    if (available.has("structure.decompose")) picks.push({ capabilityId: "structure.decompose", roleId: "架构" });
  }
  if (lower.includes("报告") || lower.includes("report") || lower.includes("可行性") || lower.includes("总结")) {
    if (!hasRisk && available.has("risk.analyze")) picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
    if (!hasRisk && available.has("counter.argue")) picks.push({ capabilityId: "counter.argue", roleId: "挑刺" });
    if (!hasSynthesis && available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
    if (!hasReport && available.has("report.write")) picks.push({ capabilityId: "report.write", roleId: "综合" });
  }
  if (lower.includes("预览") || lower.includes("效果") || lower.includes("preview")) {
    if (available.has("scenario.simulate")) picks.push({ capabilityId: "scenario.simulate", roleId: "工程" });
  }

  // State-driven gap filling (core V5 "target-driven" behavior)
  if (staleCount > 0) {
    // Stale present → prefer re-analysis / counter to address them
    if (!picks.some(p => p.capabilityId.includes("risk") || p.capabilityId.includes("argue"))) {
      if (available.has("risk.analyze")) picks.push({ capabilityId: "risk.analyze", roleId: "安全" });
      if (available.has("counter.argue")) picks.push({ capabilityId: "counter.argue", roleId: "挑刺" });
    }
  }

  if (hasRisk && !hasSynthesis && !hasReport) {
    // We have evidence/risk but no convergence yet
    if (available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
  }

  if (hasSynthesis && !hasReport) {
    if (available.has("report.write")) picks.push({ capabilityId: "report.write", roleId: "综合" });
  }

  // Open questions drive clarification or decompose
  if (openQCount > 0) {
    if (available.has("intent.clarify")) picks.push({ capabilityId: "intent.clarify", roleId: "产品" });
    if (available.has("structure.decompose")) picks.push({ capabilityId: "structure.decompose", roleId: "架构" });
  }

  // Recent ledger can inform next (avoid recent if not stale)
  if (staleCount === 0) {
    const avoidLedger = new Set(recentLedgerCaps);
    if (picks.length < 3 && !avoidLedger.has("evidence.search") && available.has("evidence.search")) picks.push({ capabilityId: "evidence.search", roleId: "接地" });
  }

  // Avoid repeating the exact same capability in the very recent runs unless stale forces it
  if (picks.length === 0) {
    const avoidRecent = new Set([...recentRuns, ...recentLedgerCaps]);
    if (!avoidRecent.has("intent.parse") && available.has("intent.parse")) picks.push({ capabilityId: "intent.parse", roleId: "产品" });
    if (!avoidRecent.has("evidence.search") && available.has("evidence.search")) picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    if (available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
  }

  // Default sensible set if still nothing
  if (picks.length === 0) {
    if (available.has("intent.parse")) picks.push({ capabilityId: "intent.parse", roleId: "产品" });
    if (available.has("evidence.search")) picks.push({ capabilityId: "evidence.search", roleId: "接地" });
    if (available.has("synthesis.merge")) picks.push({ capabilityId: "synthesis.merge", roleId: "综合" });
  }

  // De-dupe while preserving order, cap at 5
  const seen = new Set<string>();
  return picks.filter(p => {
    const key = `${p.capabilityId}:${p.roleId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
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
  }> {
    // Special case for the V5 main output (report.write): use the structured 9-section builder
    // so the committed artifact carries evidence-grade content even under the default simulator path.
    // This is the "wire into CapabilityExecutor" step: page no longer post-processes report strings.
    if (args.capabilityId === 'report.write') {
      const built = buildStructuredReport({
        state: args.state,
        inputArtifactIds: args.inputArtifactIds || [],
        roleId: args.roleId,
        // turnLabel can be derived from turnId for re-entry distinction if needed by future callers
        turnLabel: args.turnId?.includes('challenge') || args.turnId?.includes('node') ? '重入' : undefined,
      });
      return {
        title: built.title,
        summary: built.summary,
        content: built.content,
        provenance: 'ai_generated',
      };
    }

    // Delegate everything else (including legacy direct simulate calls in tests) to the state-aware simulator.
    const { title, summary, content } = simulateCapabilityExecution(
      args.capabilityId,
      args.state,
      args.inputArtifactIds || []
    );
    return {
      title,
      summary,
      content,
      provenance: "ai_generated",
    };
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
  }> {
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
  }> {
    if (args.capabilityId === 'risk.analyze' || args.capabilityId === 'report.write') {
      try {
        return await this.provider(args);
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

  const gateResults = evaluateGates(rawArtifact as any, effectiveForceFail);

  const passedGates = gateResults.filter((g) => g.status === "passed").map((g) => g.gateId);
  const allPassed = gateResults.every((g) => g.status === "passed");

  const committed: Artifact = {
    ...rawArtifact,
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
    content: (rawArtifact as any).content,
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

  return {
    updatedState: {
      ...state,
      artifacts: newArtifacts,
      capabilityRuns: newRuns,
      gates: newGates,
      dependencyGraph: [...state.dependencyGraph, ...newDeps],
    },
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

  const inputs: string[] = [];
  // walk backwards to find most recent matching
  for (let i = state.artifacts.length - 1; i >= 0; i--) {
    const art = state.artifacts[i];
    if (neededKinds.includes(art.kind) && !inputs.includes(art.id)) {
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

  return {
    ...state,
    staleArtifactIds: Array.from(affected),
    graph: {
      ...state.graph,
      nodes: newGraphNodes,
    },
  };
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

  // 2. Use the provided userText for picking (the "chat manipulator" contract)
  const userTextForPick = userText || working.goal.text;

  // 3. Pick (this is where the real intelligence will live)
  const selected = pickNextCapabilities(working, userTextForPick);

  // 4. For each selected, declare real inputs from current state (this populates dependencyGraph later in commit)
  const selectedWithInputs = selected.map((sel) => ({
    ...sel,
    inputArtifactIds: findInputsForCapability(working, sel.capabilityId as V5CapabilityId),
  }));

  // 5. For the prototype, we also produce some graph nodes here (so the surface updates)
  // 携带 turnId + 预分配的 capabilityRunId（与页面 commit 循环使用的 `${turnId}-run-${i}` 一致），
  // 让 invalidate 能做到真正的 artifact/run 级精确匹配，而不是只靠 turn+capability。
  const newGraphNodes: BrainstormReasoningNode[] = selected.map((sel, i) => ({
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
    expectedArtifacts: selected.map((s) => `${s.capabilityId}-artifact`),
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
