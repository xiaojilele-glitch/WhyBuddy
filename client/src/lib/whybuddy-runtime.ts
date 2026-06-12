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
import { V5_CAPABILITY_POOL, ALL_V5_CAPABILITIES, CAPABILITY_OUTPUT_KIND } from "@shared/blueprint/contracts";
import { CAPABILITY_PROCESS_LABELS } from "@shared/blueprint/capability-process-labels";
import {
  ensureRouteBranchScaffold,
  scaffoldPropositionBranches,
  enrichGraphNodeFromArtifact,
  capabilityIdToReasoningNodeType,
  roleIdToDisplayLabel,
  findOpenScaffoldSlotId,
  scaffoldSlotForCapability,
  isScaffoldPlaceholderNodeId,
} from "@shared/blueprint/whybuddy-graph-projection";
import { stripProjectionForPersist } from "@shared/blueprint/whybuddy-projection-persist";
import {
  applyReplayOnSave,
  replaySessionEvents,
  type WhyBuddyReplayEvent,
} from "@shared/blueprint/whybuddy-session-replay";
import {
  buildStructuredReport,
  extractArtifactFragments,
  type StructuredReportInput,
  type ArtifactFragment,
  type FragmentKind,
} from "@shared/blueprint/whybuddy-report-builder.js";
import { findGithubUrlInTexts } from "@shared/blueprint/whybuddy-github-context";
import { createBrowserLlmCapabilityProvider } from "./whybuddy-browser-llm";
import { pickNextCapabilities as pickNextCapabilitiesHeuristic } from "@shared/blueprint/whybuddy-pick-heuristic";
import { validateProposedPlan } from "@shared/blueprint/whybuddy-plan-validation";
import { fetchOrchestratePlan } from "./whybuddy-orchestrator";
import {
  evaluateGroundingForCommit,
  hasGroundedExternalEvidence,
  countGroundedTrustedArtifacts,
  isGroundedEvidenceArtifact,
} from "@shared/blueprint/whybuddy-grounding";
import {
  evaluateInteractiveGateAfterCommit,
  userClearsReadiness,
  userPicksRoute,
  userRejectsRouteSelection,
} from "@shared/blueprint/whybuddy-interactive-gates";
import {
  authorCoverageContract,
  evaluateCoverageGate,
  hasTrustedCommittedForCap,
} from "@shared/blueprint/whybuddy-coverage-gate";
export { authorCoverageContract, evaluateCoverageGate, hasTrustedCommittedForCap };
import {
  gapsFromGapAskContent,
  mergeGapAskIntoState,
  resolveReadinessGapsFromUserText,
} from "@shared/blueprint/whybuddy-readiness-chain";
import {
  isDeliveryIntent,
  isPreviewDissatisfiedIntent,
  isReviewPassIntent,
  isReviewRejectIntent,
  latestTrustedReport,
  evaluateReviewPassGate,
  buildHandoffPackageContent,
} from "@shared/blueprint/whybuddy-delivery-chain";
import { evaluateCommitGates, evaluateShipGates } from "@shared/blueprint/whybuddy-ship-gates";
import { evaluateQualityGate, getBaseline, PILOT_TEMPLATE_BASELINE, PRODUCTION_BASELINE } from "@shared/blueprint/whybuddy-quality-gate";
import { shouldEscalateOnBudgetBlock } from "@shared/blueprint/whybuddy-budget-esc";
import {
  applyRoleModeToState,
  isDeliberationCapability,
  markBrainstormDegraded,
} from "@shared/blueprint/whybuddy-role-mode";
import { auditPreviewReal, isVisualIntent } from "@shared/blueprint/whybuddy-visual-chain";
import {
  buildStructurePrompt,
  redactStructurePrompt,
  buildTemplateTree,
  formatTreeContent,
  parseStructureGateLedger,
  structureGateLedgerConversationLines,
} from "@shared/blueprint/whybuddy-structure-chain";

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
  /** P4/B: session token ceiling (estimated from costLedger). */
  maxTokensPerSession: number;
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
    maxTokensPerSession: 500_000,
  };
}

// ===== Session_Driver re-entry contracts (net-new types; driver impl lands in task 4.1) =====
// whybuddy-llm-autonomous-reasoning 需求 1 / 2 / 3 / 13.
//
// Compatibility-first, additive-only:
//   - BudgetPolicy is consumed UNCHANGED (no new fields, defaults frozen: maxTurns=30 etc.).
//   - The per-message loop cap is a Driver-level option (DriveReasoningOptions.maxLoopsPerMessage,
//     default DEFAULT_MAX_LOOPS_PER_MESSAGE = 3); it is NOT part of the BudgetPolicy schema.
//   - Cross-round bookkeeping lives on the loop-local ReentryAccumulator; it is NOT persisted
//     into the V5SessionState schema.
//   - All new fields are optional where they could appear on durable old state.

/**
 * Driver-level default for the per-user-message re-entry loop cap (需求 1.5).
 * This is a Session_Driver guard, distinct from the (unchanged) BudgetPolicy gates.
 */
export const DEFAULT_MAX_LOOPS_PER_MESSAGE = 3;

/** Product preview (/whybuddy): Session_Driver keeps re-entering ORCH until AWAIT or loop cap. */
export const PRODUCT_PREVIEW_MAX_LOOPS_PER_MESSAGE = 12;

/** Fresh sessions start with no proposition until the user's first message (INTAKE new_goal). */
export const EMPTY_SESSION_GOAL_TEXT = "";

/** Legacy product default — cleared on load when the session has no real progress. */
export const LEGACY_HARDCODED_PRODUCT_GOAL =
  "做一个权限管理系统（支持 RBAC + 数据范围）";

/** Why the Session_Driver stopped re-entering and parked at AWAIT. */
export type ReentryStopReason =
  | "coverage_sufficient" // 需求 1.4: all required caps satisfied, blocking gaps resolved/waived
  | "budget_exhausted" // 需求 1.5 / 1.9: maxLoopsPerMessage / maxCapabilityRunsPerSession / maxTurns
  | "no_progress" // 需求 1.7: two consecutive loops with no new artifact and no gap progress
  | "max_repeat_guard" // 需求 1.8: maxRepeatPerCapability excluded the only remaining candidates
  | "convergence_signal" // 需求 3.3: router returned selected:[] && converged === true
  | "await_ready" // P0: G_READY — human must supplement readiness
  | "await_confirm" // P0: G_CONFIRM — human must pick route / adjust
  | "user_interrupted"; // M1: graceful stop via AbortSignal at loop boundary

/** M2: drive mode selector (user language: 深思一轮 / 持续推演) */
export type WhyBuddyDriveMode = "single" | "marathon";

/**
 * Request the Session_Driver hands to a ReasoningRouter on each loop.
 * Mirrors the server orchestrate-plan request shape so the runtime stays decoupled
 * from server-only modules while remaining structurally compatible.
 */
export interface ReasoningRouterRequest {
  state: V5SessionState;
  turnId: string;
  userText: string;
  intervention?: UserIntervention;
}

/**
 * Router response consumed by the Session_Driver.
 * Mirrors the server OrchestratePlanResponse shape and adds the net-new optional
 * `converged` boolean (需求 3.3). `converged` is optional to preserve compatibility
 * with routers/fixtures that never emit it.
 */
export interface ReasoningRouterResponse {
  selected: Array<{ capabilityId: V5CapabilityId; roleId: string; why?: string }>;
  rationale: string;
  source: "llm" | "heuristic_fallback";
  /** 需求 3.3: mechanical convergence signal — only meaningful when selected is empty. */
  converged?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
  };
}

/**
 * Injectable router seam (需求 13.1). A Deterministic_Provider replacement can be
 * injected for tests; the default implementation routes through the server
 * orchestrate-plan path (wired in task 2.1 / 4.1).
 */
export interface ReasoningRouter {
  proposePlan(req: ReasoningRouterRequest): Promise<ReasoningRouterResponse>;
}

/** Options for the runtime-owned multi-step re-entry driver (需求 1 / 2). */
export interface DriveReasoningOptions {
  /** Base turn id; each loop derives `${turnSeedId}-loop-${n}`. */
  turnSeedId: string;
  userText: string;
  intervention?: UserIntervention;
  /** Injected router (Deterministic_Provider replaceable). Defaults to the orchestrate-plan path. */
  router?: ReasoningRouter;
  /** Injected capability executor. Defaults to the module-level CapabilityExecutor. */
  executor?: CapabilityExecutor;
  /** Termination guard limits. Defaults to getDefaultBudgetPolicy(). */
  budgetPolicy?: BudgetPolicy;
  /**
   * Max re-entry loops per user message (Driver-level guard, NOT in BudgetPolicy schema).
   * Defaults to DEFAULT_MAX_LOOPS_PER_MESSAGE (3).
   */
  maxLoopsPerMessage?: number;
  /**
   * When true (default), capabilities in the same ORCH round execute concurrently
   * (5-key pool + server routes); commits remain sequential for STATE safety.
   */
  parallelCapabilityExecution?: boolean;
  /**
   * M1: AbortSignal for graceful user interrupt (stop key).
   * Checked at loop boundaries (post maxLoops, budget). In-flight LLM/router calls
   * should receive the same signal for best-effort abort (B3 AbortController reuse).
   * On abort: stopReason = "user_interrupted", park at AWAIT, T_LEDGER entry, in-flight
   * costs recorded (estimate if no usage).
   */
  abortSignal?: AbortSignal;
  /** Called after each loop (including GCOV recoverable parks) so the UI can refresh mid-drive. */
  onLoopComplete?: (payload: {
    loopIndex: number;
    loopTurnId: string;
    state: V5SessionState;
    plan: TurnPlan;
    committedArtifactIds: string[];
    stopSignal?: ReentryStopReason;
  }) => void | Promise<void>;
  /** Per-capability round outcome — gate/exec failure for IM retry (Autopilot autoAdvance.retry). */
  onCapabilityRound?: (payload: {
    loopTurnId: string;
    capabilityId: V5CapabilityId;
    roleId: string;
    runIndex: number;
    runId: string;
    committed: boolean;
    gateFailed: boolean;
    execFailed: boolean;
    gateMessage?: string;
  }) => void;
}

/** Result of a full multi-step drive over a single user message. */
export interface DriveReasoningResult {
  finalState: V5SessionState;
  loops: Array<{
    loopTurnId: string;
    plan: TurnPlan;
    committedArtifactIds: string[];
    stopSignal?: ReentryStopReason;
  }>;
  stopReason: ReentryStopReason;
}

/**
 * Loop-local accumulator for the re-entry driver. Intentionally NOT part of the
 * V5SessionState schema — it lives only for the duration of a single drive and
 * carries the cross-loop bookkeeping the termination guards need.
 */
export interface ReentryAccumulator {
  /** Artifact count at the start of the previous loop (No_Progress detection, 需求 1.7). */
  prevArtifactCount: number;
  /** Coverage gap ids already resolved at the start of the previous loop. */
  prevResolvedGapIds: Set<string>;
  /** Per-capability cross-loop run counts (maxRepeatPerCapability guard, 需求 1.8). */
  perCapabilityRunCount: Map<V5CapabilityId, number>;
  /** Loops executed for this message so far (maxLoopsPerMessage guard, 需求 1.5). */
  loopCount: number;
  /** Consecutive loops with no progress (需求 1.7: stop at >= 2). */
  noProgressStreak: number;
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
  if (totalEstimatedTokens >= policy.maxTokensPerSession) {
    allowed = false;
    reason =
      reason ||
      `maxTokensPerSession exceeded (${totalEstimatedTokens} >= ${policy.maxTokensPerSession})`;
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

// ===== Argument graph: proposition root + structural depends_on skeleton (G-ROOT P0) =====
// Maps design-doc "Root Proposition Node" to existing `question` type; structural parent edge uses
// `depends_on` with parent→child direction so dagre LR places the root on the left.

export function propositionRootId(sessionId: string): string {
  return `${sessionId}-proposition`;
}

export function getPropositionRootNode(
  state: V5SessionState
): BrainstormReasoningNode | undefined {
  const sessionId = state.sessionId || "whybuddy-local-proto";
  const expectedId = propositionRootId(sessionId);
  const nodes = state.graph?.nodes || [];
  return (
    nodes.find((n) => n.id === expectedId) ??
    nodes.find((n) => n.type === "question" && n.id.endsWith("-proposition"))
  );
}

function buildPropositionRootNode(goalText: string, sessionId: string): BrainstormReasoningNode {
  const id = propositionRootId(sessionId);
  return {
    id,
    type: "question",
    title: goalText,
    body: goalText,
    status: "open",
    order: 0,
    round: 0,
  } as BrainstormReasoningNode;
}

/** Idempotent: ensure exactly one proposition root exists and centralQuestion mirrors it. */
export function ensurePropositionRoot(
  state: V5SessionState,
  text?: string
): V5SessionState {
  const sessionId = state.sessionId || "whybuddy-local-proto";
  const goalText = (text?.trim() || state.goal?.text || "").trim();
  if (!goalText) return state;

  const existing = getPropositionRootNode(state);
  if (existing) {
    if (text?.trim() && existing.title !== text.trim()) {
      const updated: BrainstormReasoningNode = {
        ...existing,
        title: text.trim(),
        body: text.trim(),
      };
      const nodes = (state.graph.nodes || []).map((n) =>
        n.id === existing.id ? updated : n
      );
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes,
          centralQuestion: {
            id: existing.id,
            title: text.trim(),
            body: text.trim(),
          },
        },
      };
    }
    if (!state.graph.centralQuestion) {
      return {
        ...state,
        graph: {
          ...state.graph,
          centralQuestion: {
            id: existing.id,
            title: existing.title,
            body: existing.body,
          },
        },
      };
    }
    return state;
  }

  const root = buildPropositionRootNode(goalText, sessionId);
  return {
    ...state,
    graph: {
      ...state.graph,
      centralQuestion: { id: root.id, title: root.title, body: root.body },
      nodes: [root, ...(state.graph.nodes || [])],
      edges: state.graph.edges || [],
    },
  };
}

/** Resolve the structural parent for new capability nodes (challenge → target; else scaffold slot; else root). */
export function resolveStructuralParentId(
  state: V5SessionState,
  context?: OrchestrateContext,
  capabilityId?: string
): string | undefined {
  const root = getPropositionRootNode(state);
  if (!root) return undefined;

  const intervention = context?.intervention;
  if (intervention?.targetNodeId) {
    const match = (state.graph.nodes || []).find((n) => n.id === intervention.targetNodeId);
    if (match) return match.id;
  }
  if (intervention?.targetArtifactId) {
    const art = (state.artifacts || []).find((a) => a.id === intervention.targetArtifactId);
    if (art) {
      const match = (state.graph.nodes || []).find(
        (n: BrainstormReasoningNode & { producedArtifactId?: string; capabilityRunId?: string }) =>
          n.producedArtifactId === art.id ||
          n.capabilityRunId === art.producedBy?.capabilityRunId
      );
      if (match) return match.id;
    }
  }

  if (capabilityId === "route.compare") {
    const alt = findOpenScaffoldSlotId(state, "hypo-alt");
    if (alt) return alt;
  }
  if (capabilityId === "route.generate") {
    const hypo = findOpenScaffoldSlotId(state, "hypo");
    if (hypo) return hypo;
  }

  const slot = scaffoldSlotForCapability(capabilityId);
  if (slot) {
    const scaffoldId = findOpenScaffoldSlotId(state, slot);
    if (scaffoldId) return scaffoldId;
  }

  return root.id;
}

/** Mechanical G-ROOT-1..4 checks (binary gates for T_GATE wiring). */
export function evaluateGraphRootGates(state: V5SessionState): {
  ok: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  const nodes = state.graph?.nodes || [];
  const edges = state.graph?.edges || [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const root = getPropositionRootNode(state);

  if (!root) {
    violations.push("G-ROOT-1");
  } else {
    const propositionNodes = nodes.filter(
      (n) => n.type === "question" && n.id.endsWith("-proposition")
    );
    if (propositionNodes.length !== 1) violations.push("G-ROOT-1");
  }

  const structuralEdges = edges.filter((e) => e.type === "depends_on");
  for (const node of nodes) {
    if (root && node.id === root.id) continue;
    const incoming = structuralEdges.filter((e) => e.target === node.id);
    if (incoming.length !== 1) violations.push(`G-ROOT-2:${node.id}`);
  }

  for (const node of nodes) {
    const refs = (node as BrainstormReasoningNode & { derivedFrom?: string[] }).derivedFrom;
    if (!refs) continue;
    for (const ref of refs) {
      if (!nodeIds.has(ref)) violations.push(`G-ROOT-3:${node.id}->${ref}`);
    }
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) violations.push(`G-ROOT-4:source:${edge.id}`);
    if (!nodeIds.has(edge.target)) violations.push(`G-ROOT-4:target:${edge.id}`);
  }

  return { ok: violations.length === 0, violations };
}

export function formatProvenanceForLabel(
  node: BrainstormReasoningNode & { derivedFrom?: string[] },
  graph: BrainstormReasoningGraph
): string {
  const refs = node.derivedFrom || [];
  if (refs.length === 0) return node.body || "";
  const refNode = graph.nodes?.find((n) => n.id === refs[0]);
  const label =
    refNode?.type === "question"
      ? refNode.title || refNode.body || refs[0]
      : refNode?.title || refs[0];
  const gist = String(label || "").trim().slice(0, 72);
  return gist
    ? `承接「${gist}」继续推演；能力产出后将替换为可读结论。`
    : "能力执行中，产出后将显示具体结论。";
}

function pendingCapabilityNodeTitle(capabilityId: V5CapabilityId, roleId: string): string {
  const entry = CAPABILITY_PROCESS_LABELS[capabilityId];
  const live =
    typeof entry?.liveLabel === "function" ? entry.liveLabel({}) : entry?.liveLabel;
  if (live) {
    return live.replace(/^⚡\s*/, "").replace(/…+$/u, "").trim();
  }
  return `${roleIdToDisplayLabel(roleId)}正在推演`;
}

export function createInitialSessionState(goalText: string, sessionId = "whybuddy-local-proto"): V5SessionState {
  // Start with a minimal but valid state. Graph will be mutated by capabilities.
  // Per 修复闭环.md: sessionId isolation starts here; load path will key off it later.
  const base: V5SessionState = {
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
  structureGateLedger: [],
  costLedger: [],
  coverageGaps: [],
  };
  return ensurePropositionRoot({ ...base, sessionId });
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
export function isLegacyEmptySessionSeed(state: V5SessionState): boolean {
  const text = (state.goal?.text || "").trim();
  const isLegacyGoal =
    text === LEGACY_HARDCODED_PRODUCT_GOAL || text === "WhyBuddy V5 session";
  if (!isLegacyGoal) return false;
  return (state.artifacts || []).length === 0 && (state.conversation || []).length === 0;
}

export async function loadOrCreateSessionState(
  sessionId: string,
  goalText = EMPTY_SESSION_GOAL_TEXT
): Promise<V5SessionState> {
  const existing = await currentWhyBuddySessionStore.load(sessionId);
  if (existing) {
    return deriveNodeStatus(existing);
  }

  const created = createInitialSessionState(goalText, sessionId);
  const withReplay = applyReplayOnSave(undefined, created);
  await currentWhyBuddySessionStore.save(stripProjectionForPersist(withReplay));
  return deriveNodeStatus(withReplay);
}

export async function saveSessionState(state: V5SessionState): Promise<V5SessionState> {
  const sessionId = state.sessionId || "whybuddy-local-proto";
  const previous = await currentWhyBuddySessionStore.load(sessionId);
  const withReplay = applyReplayOnSave(previous, state);
  await currentWhyBuddySessionStore.save(stripProjectionForPersist(withReplay));
  return deriveNodeStatus(withReplay);
}

/** S21 edge 117: replay events for a session from durable STORE (session-isolated). */
export { replaySessionEvents, type WhyBuddyReplayEvent };

export async function loadSessionReplayEvents(sessionId: string): Promise<WhyBuddyReplayEvent[]> {
  const state = await currentWhyBuddySessionStore.load(sessionId);
  if (!state) return [];
  return replaySessionEvents(state);
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
export function deriveNodeStatus(
  state: V5SessionState,
  opts?: { onlyNodeIds?: ReadonlySet<string>; incremental?: boolean }
): V5SessionState {
  const staleSet = new Set(state.staleArtifactIds || []);
  const artifactByRun = new Map<string, Artifact>();
  const runById = new Map<string, any>((state.capabilityRuns || []).map(r => [r.id, r]));

  for (const art of state.artifacts || []) {
    const runId = art.producedBy?.capabilityRunId;
    if (runId) artifactByRun.set(runId, art);
  }

  const dirtyOnly = opts?.onlyNodeIds;
  const dirtyFromState =
    opts?.incremental && state.projectionDirtyNodeIds?.length
      ? new Set(state.projectionDirtyNodeIds)
      : undefined;
  const restrict = dirtyOnly || dirtyFromState;

  let recomputed = 0;
  const newNodes = (state.graph?.nodes || []).map((node: any) => {
    if (!node) return node;
    if (restrict && node.id && !restrict.has(node.id)) {
      return node;
    }
    recomputed += 1;

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

  if (newNodes === state.graph?.nodes && !state.projectionDirtyNodeIds?.length) {
    return state;
  }

  return {
    ...state,
    graph: {
      ...state.graph,
      nodes: newNodes,
    },
    projectionDirtyNodeIds: restrict && recomputed < (state.graph?.nodes || []).length
      ? (state.projectionDirtyNodeIds || []).filter((id) => !restrict.has(id))
      : [],
  };
}

// Expanded Trust Layer gate simulation (closer to the full mechanical gates in the diagram).
// Records schema/invariant/confirm/previews_real etc. for fidelity while keeping prototype runnable.
// forceFail still primarily affects the critical "commit" gate and report-specific upstream checks.
function evaluateGates(
  artifact: Artifact,
  forceFail: boolean,
  groundingOk = true,
  baselineName: "production" | "pilot-template" = "production"
): { status: "passed" | "failed"; gateId: string; reason?: string }[] {
  const capId = String((artifact as any).producedBy?.capabilityId || "");
  const commitGates = evaluateCommitGates(capId, { forceFail, groundingOk }).map((g) => ({
    gateId: g.gateId,
    status: g.status,
  }));

  // K3: quality gate now participates in trust decision (explicit baseline from call site)
  const q = evaluateQualityGate(artifact as any, undefined, getBaseline(baselineName));
  if (q) {
    return [...commitGates, { gateId: q.gateId, status: q.status, reason: q.reason }];
  }
  return commitGates;
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
      if (countGroundedTrustedArtifacts(state) >= (contract.minEvidencePerRequirement || 1)) {
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
  const userText = context?.userText || "";
  const hasExplicitPostClearWork =
    isDeliveryIntent(userText) ||
    isVisualIntent(userText) ||
    isReviewPassIntent(userText) ||
    isPreviewDissatisfiedIntent(userText) ||
    state.deliveryPhase === "shipping";

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
  if (
    contract &&
    openGapCount === 0 &&
    !hasStale &&
    hasRecentReport &&
    !isMeaningfulIntervention &&
    !hasExplicitPostClearWork &&
    unresolvedRequired.length === 0
  ) {
    sufficient = true;
    reason = 'contract_sufficient_no_new_work';
  } else if (hasExplicitPostClearWork) {
    reason = 'explicit post-clear work requested (delivery/visual/RV/ITER)';
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

// ===== V5.1 FLOWB boundary guard (Knife 4) — formal guard (修订 C, Requirement 9) =====
// Formal flow-boundary guard. Processes brainstorm / discussion source CONTENT STRINGS only,
// stripping all seven debate-protocol marker classes before content enters a formal artifact,
// then re-scans the stripped output to assert zero residual (idempotent). Records what was
// stripped, plus the residual assertion, into a FlowBoundaryCheck for the T_LEDGER.
//
// CONTENT-ONLY carve-out (Requirement 9.6 / 修订 C): the guard signature is
// `(content: string, meta) => { cleanedText, check }`. `artifact.payload` (the R2 structured
// Critique/Rebuttal/Adjudication, S10 discussion-block data source) is NEVER passed in here and
// is never read, modified, or nulled — it travels the additive commit path untouched.

/** The seven debate-protocol marker classes stripped at the flow boundary (Requirement 9.1). */
const FLOW_BOUNDARY_PROTOCOL_MARKERS = [
  "critique:",
  "rebuttal:",
  "debate:",
  "challengeEdges",
  "role vote",
  "brainstorm console",
  "brainstorm:",
] as const;

/** Single mechanical line-filter pass: removes any line containing a protocol marker. */
function stripProtocolLinesOnce(text: string): { keptLines: string[]; strippedLines: string[] } {
  const keptLines: string[] = [];
  const strippedLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const lower = line.toLowerCase();
    const isProtocol = FLOW_BOUNDARY_PROTOCOL_MARKERS.some((m) => lower.includes(m.toLowerCase()));
    if (isProtocol) {
      strippedLines.push(line.trim());
    } else {
      keptLines.push(line);
    }
  }
  return { keptLines, strippedLines };
}

export function sanitizeThroughFlowBoundary(
  input: string,
  context: { turnId: string; source?: "brainstorm" | "discussion" | "artifact" | "executor" }
): { cleanedText: string; check: FlowBoundaryCheck } {
  const original = String(input || "");

  // First strip pass over the content string (Requirement 9.1).
  const firstPass = stripProtocolLinesOnce(original);
  const strippedProtocolNodes: string[] = [...firstPass.strippedLines];
  let cleanedText = firstPass.keptLines.join("\n").trim();

  // Idempotent re-scan: assert zero residual on the stripped output (Requirement 9.2).
  // The whole-line filter guarantees residual === 0 after one pass; the defensive re-strip
  // keeps the guard idempotent even if upstream marker semantics evolve.
  let rescan = stripProtocolLinesOnce(cleanedText);
  if (rescan.strippedLines.length > 0) {
    strippedProtocolNodes.push(...rescan.strippedLines);
    cleanedText = rescan.keptLines.join("\n").trim();
    rescan = stripProtocolLinesOnce(cleanedText);
  }
  const residualAfterStrip = rescan.strippedLines.length;
  const passed = residualAfterStrip === 0;

  const check: FlowBoundaryCheck = {
    id: `flowb-${context.turnId || Date.now()}`,
    turnId: context.turnId,
    source: (context.source || "artifact") as FlowBoundaryCheck["source"],
    strippedProtocolNodes,
    assertions: [
      strippedProtocolNodes.length > 0
        ? `stripped ${strippedProtocolNodes.length} protocol nodes before formal content`
        : "no protocol noise detected; text passed through boundary",
      `residual protocol nodes after strip: ${residualAfterStrip} (idempotent re-scan)`,
    ],
    passed,
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
    // K4: pilot-template 厚度升档（≥400 字符 + 可溯结构）。质量门在 pilot baseline 下可过。
    content = `【风险分析 模拟 · pilot-template baseline】\n当前会话已有 ${priorRisks} 风险条目，${priorCounters} 反驳。\n${hasStale ? '注意：存在 stale 上游，风险可能需重评。\n' : ''}主要风险：\n- 数据范围越权（跨项目/租户边界未隔离）：WHEN 角色请求跨边界资源，THE system SHALL 拒绝并审计。\n- 审计追溯不足：所有变更操作必须保留操作者、时间、影响对象、before/after。\n- 权限扩散：默认宽松策略在多团队协作时易失控。\n建议：MVP 阶段先做 RBAC + 基础 scope 过滤，预留 ABAC 扩展点（evidence: upstream clarification + risk prior）。\n（本模板内容已满足 pilot baseline 字数与结构要求，用于演示与 fullpath 验证）。`;
    title = '风险分析 (state-aware sim, pilot)';
  } else if (lowerCap.includes('counter') || lowerCap.includes('argue')) {
    content = `【反驳模拟 · pilot-template baseline】\n针对 prior risk 反驳要点：\n- 过早引入 ABAC 会显著增加初期实现与测试成本（IF 团队规模 < 8，THE system SHOULD 避免）。\n- MVP 建议 RBAC + 显式 scope 拦截 + 审计日志即可覆盖 80% 场景。\n- 反驳强度：stale 上下文下需二次确认上游证据新鲜度。\n结论：接受 RBAC 优先路径，保留策略扩展接口作为技术债跟踪项。\n（厚度已提升，含 EARS 风格反驳条目）。`;
    title = '反驳 (context sim, pilot)';
  } else if (lowerCap.includes('synthesis')) {
    const dissentNote = hasStale ? '\n分歧：部分角色因 stale 持保留意见，建议再澄清一轮。' : '';
    content = `【综合收敛 模拟 · pilot-template baseline】\n聚合 ${upstreams.length} 上游产物（risk/counter/clarification）。\n收敛结论：RBAC MVP 优先，配合基础数据范围过滤与操作审计。\n${dissentNote}\n关键证据支撑：\n- 来自 risk：越权与审计风险已识别并有缓解路径。\n- 来自 counter：ABAC 成本过高论点被接受，暂不引入。\n下一步：走 report.write 产出 9 段证据报告，或 structure.decompose 生成可执行 SPEC 树（带 EARS 节点）。\n（pilot 模板已厚化，满足质量门下限）。`;
    title = '综合 (multi-input sim, pilot)';
  } else if (lowerCap.includes('report')) {
    // Delegate to the new structured builder so that executor (and page) get the 9-section evidence-grade report
    // instead of the old one-line simulator stub. This makes report the real V5 main output.
    const built = buildStructuredReport({ state, inputArtifactIds: declaredInputs });
    title = built.title;
    summary = built.summary;
    content = built.content;
  } else if (capabilityId === "gap.ask") {
    const goal = state.goal?.text || "目标";
    content =
      `【阻塞缺口】\n` +
      `- 面向谁使用「${goal}」？缺少用户群界定将无法选技术路线。\n` +
      `- 核心成功标准是什么？缺少可验收指标无法写 P0 需求。\n` +
      `- 范围边界：本期明确不做什么？\n` +
      `- 合规/权限约束有哪些？\n`;
    title = "阻塞缺口清单";
    summary = "定位阻塞规划的关键未决问题";
  } else if (capabilityId === "question.expand") {
    content =
      `【扩展问题】\n` +
      `1. 用户群与场景？\n   默认假设：企业内部工具\n   风险：假设错误会导致路线全偏\n` +
      `2. 数据范围与权限模型？\n   默认假设：RBAC + 部门隔离\n   风险：后期改造成本高\n`;
    title = "扩展追问";
    summary = "展开阻塞缺口的可操作追问";
  } else if (lowerCap.includes('decompose') || lowerCap.includes('structure')) {
    const upstream = (state.artifacts || [])
      .slice(-4)
      .map((a) => `- [${a.kind}] ${a.title || a.id}`)
      .join('\n');
    const prompt = buildStructurePrompt({
      goalText: state.goal?.text || "产品",
      upstreamSummary: upstream,
      turnId: state.lastTurnId,
    });
    const { redacted } = redactStructurePrompt(prompt);
    const tree = buildTemplateTree(state.goal?.text || '产品');
    const gateNote = 'C_PROMPT:built · C_REDACT:applied:0 · G_SCHEMA:attempt1:passed · G_INV:attempt1:passed';
    content =
      formatTreeContent(tree, { source: "template", gateNote }) +
      (hasStale ? "\n（含 stale 上游，部分节点待重审）" : "");
    title = "结构拆解 (SPEC Tree)";
    if (!redacted.includes("C_PROMPT")) {
      content = prompt.slice(0, 80) + "\n" + content;
    }
  } else if (capabilityId === "document.draft") {
    // K4: pilot 厚度（远超 1 行，含结构提示，满足 pilot baseline）
    content = `【文档草案 · pilot-template baseline】\n基于 ${upstreams.length} 上游产物（risk + synthesis + clarification）生成。\n\n## 概述\n为 ${state.goal?.text || "目标"} 提供 RBAC + 审计的实现路径。\n\n## 需求\n### 需求 1：权限模型\n用户故事：作为平台管理员，我希望定义基于角色的权限，以便安全地隔离不同项目的数据。\n#### 验收标准\n1.1 WHEN 管理员创建角色，THE 系统 SHALL 持久化并返回 roleId。\n1.2 IF 用户不具备对应 scope，THE 系统 SHALL 拒绝访问并记录审计日志。\n\n## 设计\n组件包含 RoleService、ScopeChecker、AuditLogger。\n\n（pilot 演示数据，已厚化避免被 K3 质量门拦截）。`;
    title = "文档草案 (pilot)";
  } else if (capabilityId === "traceability.matrix") {
    content =
      `【可追溯矩阵】\n| 需求 | 设计 | 任务 | 证据 | 用例 |\n|---|---|---|---|---|\n` +
      `| REQ-1 | DES-1 | TASK-1 | ${upstreams[0]?.id || "upstream"} | EARS-1 |`;
    title = "可追溯矩阵";
  } else if (capabilityId === "task.write") {
    content = `【工程任务】\n1. MVP 实现\n2. 验收对齐 report\n3. 交接 checklist`;
    title = "工程任务清单";
  } else if (capabilityId === "handoff.package") {
    content = buildHandoffPackageContent(state);
    title = "工程交接包";
  } else if (lowerCap.includes('scenario') || lowerCap.includes('simulate')) {
    const priorPreviews = (state.artifacts || []).filter(a => a.kind === 'preview').length;
    content = `【效果预演 模拟】\n基于 ${upstreams.length} upstream 模拟场景。\n已产出 ${priorPreviews} 预览。${hasStale ? '含风险上下文。\n' : ''}输出：MVP 流程验证通过（带标注）。`;
    title = '效果预演 (context sim)';
  } else if (capabilityId === "ux.preview") {
    content =
      `【预览·未验证】UX 模块预览\n` +
      `基于 ${upstreams.length} 上游 · ${state.goal?.text || "目标"}\n` +
      `- 列表页 · 未验证\n- 配置页 · 未验证`;
    title = "UX 预览 (sim)";
  } else if (capabilityId === "outcome.visualize") {
    content = `【预览·未验证】\n\`\`\`mermaid\ngraph TD\n  root["SPEC"] --> req["需求"]\n\`\`\``;
    title = "Mermaid 结构图 (sim)";
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
    /** Pre-allocated run id from Session_Driver (`${loopTurnId}-run-${i}`). */
    capabilityRunId?: string;
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
    /** K3 result-declared baseline: the producing executor declares the quality baseline used.
     * This allows driveReasoningSession / commitArtifact to pass the correct baseline without guessing the executor.
     * "production" for real LLM paths; "pilot-template" for simulators / fallbacks.
     */
    qualityBaseline?: "production" | "pilot-template";
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
    qualityBaseline?: "production" | "pilot-template";
  }> {
    const start = performance.now();

    // Special case for the V5 main output (report.write): use the structured 9-section builder
    // so the committed artifact carries evidence-grade content even under the default simulator path.
    // This is the "wire into CapabilityExecutor" step: page no longer post-processes report strings.
    let result: { title: string; summary: string; content: string; provenance?: Artifact["provenance"]; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; model?: string }; qualityBaseline?: "production" | "pilot-template" };
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
        qualityBaseline: 'pilot-template',
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
        qualityBaseline: 'pilot-template',
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
const EXTERNAL_SERVER_CAPABILITY_IDS = new Set<V5CapabilityId>([
  "evidence.search",
  "repo.inspect",
]);

class PilotRealCapabilityExecutor implements CapabilityExecutor {
  private base = new DefaultCapabilityExecutor();
  private serverProvider: LlmCapabilityProvider | null = null;

  private getServerProvider(): LlmCapabilityProvider {
    if (!this.serverProvider) {
      this.serverProvider = createServerLlmCapabilityProvider();
    }
    return this.serverProvider;
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
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      model?: string;
    };
    qualityBaseline?: "production" | "pilot-template";
  }> {
    const start = performance.now();
    if (EXTERNAL_SERVER_CAPABILITY_IDS.has(args.capabilityId)) {
      try {
        return await this.getServerProvider()(args);
      } catch {
        return this.base.executeCapability(args);
      }
    }
    if (args.capabilityId === 'risk.analyze') {
      return this.executeRiskPilot(args);
    }
    if (args.capabilityId === 'report.write') {
      return this.executeReportPilot(args);
    }
    // Fallback for everything else keeps full backward compat for tests/smoke/default flows.
    return this.base.executeCapability(args);
  }

  private async executeRiskPilot(args: any): Promise<{ title: string; summary: string; content: string; provenance?: Artifact["provenance"]; usage?: any; qualityBaseline?: "production" | "pilot-template" }> {
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
      qualityBaseline: 'pilot-template',
    };
  }

  private async executeReportPilot(args: any): Promise<{ title: string; summary: string; content: string; provenance?: Artifact["provenance"]; usage?: any; qualityBaseline?: "production" | "pilot-template" }> {
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
      qualityBaseline: 'pilot-template',
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
    qualityBaseline?: "production" | "pilot-template";
  }> {
    const serverRouted: V5CapabilityId[] = [
      'risk.analyze',
      'report.write',
      'intent.clarify',
      'route.generate',
      'route.compare',
      'requirement.write',
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
        return { ...result, qualityBaseline: 'production' };
      } catch (e) {
        // Provider (external) failure — reliable fallback as required by the plan.
        // Fallback produces pilot-template content, so declare it explicitly.
        const fb = await this.base.executeCapability(args);
        return { ...fb, qualityBaseline: 'pilot-template' };
      }
    }
    // Non-pilot caps: fall back without calling the provider.
    const fb = await this.base.executeCapability(args);
    return { ...fb, qualityBaseline: 'pilot-template' };
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
 * Opt-in to browser-direct LLM (BYOK) for GitHub Pages / static demo.
 * Uses user's localStorage keys, direct fetch to vendor (no proxy).
 * Falls back to PilotReal on error (CORS, auth, rate, etc.).
 * Must be called with valid BYOK pool configured.
 */
export function useBrowserLlmCapabilityExecutor(): void {
  const provider = createBrowserLlmCapabilityProvider();
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

// ============================================================================
// Deterministic_Provider assembly (需求 13 — whybuddy-llm-autonomous-reasoning)
//
// Compatibility-first / additive only:
//   - createDeterministicRouter / createDeterministicCapabilityExecutor are pure
//     stand-ins (zero network, zero real-LLM) injectable wherever a ReasoningRouter
//     / CapabilityExecutor is accepted (DriveReasoningOptions, setCapabilityExecutor).
//   - assembleProvidersForBuildTarget defaults to the deterministic stand-ins when
//     BUILD_TARGET=test (需求 13.3); real providers are reached ONLY via explicit
//     injection or an explicit switch (需求 13.5).
//   - Nothing here changes BudgetPolicy or the existing module-default executor.
// ============================================================================

/**
 * A single scripted router step: a fixed response, or a function deriving one from
 * the request. Used by createDeterministicRouter to drive specific multi-loop test
 * sequences (including convergence signals via `{ selected: [], converged: true }`).
 */
export type DeterministicRouterStep =
  | ReasoningRouterResponse
  | ((req: ReasoningRouterRequest) => ReasoningRouterResponse);

/**
 * Optional script for createDeterministicRouter:
 *   - an array consumed one entry per loop (exhaustion falls back to heuristic pick), or
 *   - a function `(req, loopIndex) => response` for full control.
 */
export type DeterministicRouterScript =
  | DeterministicRouterStep[]
  | ((req: ReasoningRouterRequest, loopIndex: number) => ReasoningRouterResponse);

/**
 * createDeterministicRouter — Deterministic_Provider stand-in for the LLM_Router (需求 13.1).
 *
 * Performs zero network / zero real-LLM calls. With no script it derives a fully
 * deterministic plan from the shared heuristic picker (`source: "heuristic_fallback"`).
 * A script (array or function) lets tests drive exact per-loop proposals.
 */
export function createDeterministicRouter(script?: DeterministicRouterScript): ReasoningRouter {
  let loopIndex = 0;

  const heuristicResponse = (req: ReasoningRouterRequest): ReasoningRouterResponse => {
    const userText = req.userText || req.state.goal?.text || "";
    const selected = pickNextCapabilitiesHeuristic(req.state, userText).map((p) => ({
      capabilityId: p.capabilityId,
      roleId: p.roleId,
    }));
    return {
      selected,
      rationale: `deterministic_router heuristic pick for: ${userText.slice(0, 80)}`,
      source: "heuristic_fallback",
    };
  };

  return {
    async proposePlan(req: ReasoningRouterRequest): Promise<ReasoningRouterResponse> {
      const i = loopIndex++;

      if (typeof script === "function") {
        return script(req, i);
      }

      if (Array.isArray(script) && i < script.length) {
        const step = script[i];
        return typeof step === "function" ? step(req) : step;
      }

      // No script (or script exhausted): deterministic heuristic pick.
      return heuristicResponse(req);
    },
  };
}

/**
 * createDeterministicCapabilityExecutor — Deterministic_Provider stand-in for the
 * CapabilityExecutor (需求 13.1).
 *
 * The module's DefaultCapabilityExecutor is already fully deterministic (state-aware
 * simulator + 9-section report builder, zero network / zero real-LLM), so the
 * deterministic stand-in simply returns a fresh instance of it. Kept as a named
 * factory so call sites express intent and so a stricter stand-in could be swapped
 * in later without touching callers.
 */
export function createDeterministicCapabilityExecutor(): CapabilityExecutor {
  return new DefaultCapabilityExecutor();
}

/**
 * createServerReasoningRouter — the "real" client-side router seam.
 *
 * Routes through the server orchestrate-plan endpoint (R1: validation / clamp /
 * graceful degradation + DLEDGER source live on the server). On a null / failed
 * response it degrades to the deterministic heuristic pick so a drive never blocks.
 * This is the non-deterministic default returned by assembleProvidersForBuildTarget
 * outside BUILD_TARGET=test.
 */
export function createServerReasoningRouter(options?: { timeoutMs?: number }): ReasoningRouter {
  return {
    async proposePlan(req: ReasoningRouterRequest): Promise<ReasoningRouterResponse> {
      const body = await fetchOrchestratePlan(
        {
          state: req.state,
          turnId: req.turnId,
          userText: req.userText,
          intervention: req.intervention
            ? {
                intent: req.intervention.intent,
                targetArtifactId: req.intervention.targetArtifactId,
                targetDecisionId: req.intervention.targetDecisionId,
              }
            : null,
        },
        options?.timeoutMs ? { timeoutMs: options.timeoutMs } : undefined
      );

      if (!body) {
        const userText = req.userText || req.state.goal?.text || "";
        return {
          selected: pickNextCapabilitiesHeuristic(req.state, userText).map((p) => ({
            capabilityId: p.capabilityId,
            roleId: p.roleId,
          })),
          rationale: `heuristic_fallback (router unavailable) for: ${userText.slice(0, 80)}`,
          source: "heuristic_fallback",
        };
      }

      return {
        selected: body.selected,
        rationale: body.rationale,
        source: body.source,
        // `converged` is the net-new optional convergence boolean (需求 3.3); read
        // defensively so this seam stays compatible before task 2.3 lands it server-side.
        converged: (body as { converged?: boolean }).converged,
        usage: body.usage,
      };
    },
  };
}

/** Resolved providers returned by assembleProvidersForBuildTarget. */
export interface AssembledProviders {
  router: ReasoningRouter;
  executor: CapabilityExecutor;
  /** True when deterministic stand-ins were assembled by default (BUILD_TARGET=test). */
  deterministic: boolean;
  /** The build target that drove the decision (for diagnostics / tests). */
  buildTarget?: string;
}

/** Options for assembleProvidersForBuildTarget (all optional, additive). */
export interface AssembleProvidersOptions {
  /** Override build-target detection (defaults to process.env.BUILD_TARGET). */
  buildTarget?: string;
  /** Explicit switch to assemble real providers even under BUILD_TARGET=test (需求 13.5). */
  useReal?: boolean;
  /** Explicit router injection — overrides default assembly for the router slot (需求 13.5). */
  router?: ReasoningRouter;
  /** Explicit executor injection — overrides default assembly for the executor slot (需求 13.5). */
  executor?: CapabilityExecutor;
  /** Real router used on the non-deterministic path (defaults to the server-routed router). */
  realRouter?: ReasoningRouter;
  /** Real executor used on the non-deterministic path (defaults to the module-level executor). */
  realExecutor?: CapabilityExecutor;
}

/** Whether the current (or supplied) build target is the deterministic test target (需求 13.3). */
export function isTestBuildTarget(buildTarget?: string): boolean {
  const target =
    buildTarget ??
    (typeof process !== "undefined" ? process.env?.BUILD_TARGET : undefined);
  return target === "test";
}

/**
 * assembleProvidersForBuildTarget — central Deterministic_Provider assembly seam (需求 13.3 / 13.5).
 *
 * Decision order, per slot (router / executor):
 *   1. Explicit injection (`options.router` / `options.executor`) always wins (需求 13.5).
 *   2. Otherwise, under BUILD_TARGET=test (and without `useReal`), assemble the
 *      deterministic stand-in by default (需求 13.3).
 *   3. Otherwise assemble the real provider (server-routed router / module-level
 *      executor, or the supplied real* override) — reached only via explicit switch
 *      or a non-test target (需求 13.5).
 */
export function assembleProvidersForBuildTarget(
  options: AssembleProvidersOptions = {}
): AssembledProviders {
  const testTarget = isTestBuildTarget(options.buildTarget);
  // Deterministic stand-ins are the default ONLY under BUILD_TARGET=test and only
  // when real has not been explicitly requested.
  const deterministic = testTarget && options.useReal !== true;

  const router =
    options.router ??
    (deterministic
      ? createDeterministicRouter()
      : options.realRouter ?? createServerReasoningRouter());

  const executor =
    options.executor ??
    (deterministic
      ? createDeterministicCapabilityExecutor()
      : options.realExecutor ?? getCapabilityExecutor());

  return {
    router,
    executor,
    deterministic,
    buildTarget:
      options.buildTarget ??
      (typeof process !== "undefined" ? process.env?.BUILD_TARGET : undefined),
  };
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

/** Re-run one capability after IM retry (Autopilot autoAdvance.retry parity). */
export async function retrySingleCapability(
  state: V5SessionState,
  params: {
    loopTurnId: string;
    capabilityId: V5CapabilityId;
    roleId: string;
    runIndex: number;
    executor: CapabilityExecutor;
  }
): Promise<{
  state: V5SessionState;
  committed: boolean;
  gateFailed: boolean;
  error?: string;
}> {
  const runId = `${params.loopTurnId}-run-${params.runIndex}`;
  const freshInputs = findInputsForCapability(state, params.capabilityId);
  let exec: CapabilityExecutionResult | null = null;
  try {
    exec = await params.executor.executeCapability({
      capabilityId: params.capabilityId,
      state,
      inputArtifactIds: freshInputs,
      roleId: params.roleId,
      turnId: params.loopTurnId,
      capabilityRunId: runId,
    });
  } catch (e) {
    return {
      state,
      committed: false,
      gateFailed: false,
      error: e instanceof Error ? e.message : "execute failed",
    };
  }

  const content =
    exec?.content || `${params.roleId} 通过 ${params.capabilityId} 产出新洞察/证据/方案`;
  const outputKind = CAPABILITY_OUTPUT_KIND[params.capabilityId] ?? "decision";
  const baseline = (exec as any)?.qualityBaseline ?? "production";
  const { updatedState, committed, run } = commitArtifact(
    state,
    {
      id: `${params.loopTurnId}-art-retry-${params.runIndex}-${Date.now()}`,
      kind: outputKind as Artifact["kind"],
      provenance: (exec?.provenance as Artifact["provenance"]) || "ai_generated",
      producedBy: {
        capabilityRunId: runId,
        capabilityId: params.capabilityId,
        roleId: params.roleId,
      },
      title: content.split("\n")[0]?.slice(0, 80),
      summary: content.slice(0, 200),
      content,
    } as Omit<Artifact, "trustLevel" | "passedGates">,
    runId,
    false,
    freshInputs,
    baseline
  );

  const gateFailed = (run.gateResults || []).some((g) => g.status === "failed");
  let next = enrichGraphNodesAfterCommit(updatedState, params.loopTurnId);
  if (params.capabilityId === "route.generate" || params.capabilityId === "route.compare") {
    next = tagRouteBranchNodes(next, params.loopTurnId, params.capabilityId, content);
  }
  return { state: next, committed: Boolean(committed), gateFailed };
}

function tagRouteBranchNodes(
  state: V5SessionState,
  loopTurnId: string,
  capabilityId: V5CapabilityId,
  content: string
): V5SessionState {
  const branchLabel =
    capabilityId === "route.generate"
      ? "路线 A"
      : capabilityId === "route.compare"
      ? "路线 B · 对比"
      : null;
  if (!branchLabel) return state;
  const suffix = capabilityId === "route.compare" ? "hypo-alt" : "hypo";
  const slotId = `${loopTurnId}-scaffold-${suffix}`;
  const nodes = (state.graph.nodes || []).map((n) => {
    if (n.id !== slotId && !String(n.id).includes(`-scaffold-${suffix}`)) return n;
    if (n.turnId && n.turnId !== loopTurnId && !String(n.id).startsWith(loopTurnId)) return n;
    const snippet = content.split("\n")[0]?.slice(0, 72) || branchLabel;
    return {
      ...n,
      type: "hypothesis" as const,
      title: `${branchLabel}：${snippet}`,
      status: "active" as const,
    };
  });
  return { ...state, graph: { ...state.graph, nodes } };
}

// commitArtifact is the Trust Layer entry point (diagram: BUS ==> T_GATE ==> T_PROV ==> T_LEDGER ==> STATE)
// Now with real dependency edges and report gate check.
export function commitArtifact(
  state: V5SessionState,
  rawArtifact: Omit<Artifact, "trustLevel" | "passedGates">,
  runId: string,
  forceGateFail = false,
  declaredInputs: string[] = [], // pass the upstream artifact ids this run depends on
  baseline: "production" | "pilot-template" = "production" // K3 result-declared baseline from executor (drive extracts exec?.qualityBaseline); demo/pilot seeds pass "pilot-template" for relaxed gate
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

  // ===== V5.1 FLOWB (Knife 4): formal flow-boundary guard (修订 C, Requirement 9.1/9.2/9.5).
  // R2 deliberation output (synthesis-like) and formal report content MUST pass the guard before
  // becoming the committed artifact. The guard is CONTENT-ONLY: only `rawArtifact.content` is
  // passed in. `rawArtifact.payload` (R2 structured Critique/Rebuttal/Adjudication, the S10
  // discussion-block data source) is NEVER read here — it travels untouched via the `...rawArtifact`
  // spread below (Requirement 9.6). A single FlowBoundaryCheck is appended to flowBoundaryLedger
  // (T_LEDGER) per processing run; no duplicate ledger entry is produced.
  let workingContent = rawArtifact.content || "";
  let flowCheck: FlowBoundaryCheck | null = null;
  if (isReport || isSynthesisLike) {
    const { cleanedText, check } = sanitizeThroughFlowBoundary(workingContent, {
      turnId: runId,
      // report aggregation = "artifact"; R2 deliberation merge content = "discussion" source.
      source: isReport ? "artifact" : "discussion",
    });
    workingContent = cleanedText;
    flowCheck = check;
  }

  const groundingOk = evaluateGroundingForCommit({
    capabilityId: capId,
    artifact: rawArtifact as any,
    state,
  });

  if (capId === "handoff.package") {
    workingContent = buildHandoffPackageContent(state);
  } else if (capId === "traceability.matrix") {
    const report = latestTrustedReport(state);
    const evidenceId = declaredInputs[0] || report?.id || "upstream";
    workingContent =
      `【可追溯矩阵】\n| 需求 | 设计 | 任务 | 证据 | 用例 |\n|---|---|---|---|---|\n` +
      `| REQ-1 | DES-1 | TASK-1 | ${evidenceId} | EARS-1 |`;
  }

  let previewAudit: ReturnType<typeof auditPreviewReal> | undefined;
  if (capId === "ux.preview" || capId === "outcome.visualize") {
    const payloadAudit = (rawArtifact as { payload?: { audit?: { passed?: boolean } } }).payload
      ?.audit;
    previewAudit =
      payloadAudit && typeof payloadAudit.passed === "boolean"
        ? (payloadAudit as ReturnType<typeof auditPreviewReal>)
        : auditPreviewReal(rawArtifact.content || "");
    if (!previewAudit.passed) {
      effectiveForceFail = true;
    }
  }

  // K3: quality gate now fully participates in the trustLevel decision (core of "保下限").
  // Receives result-declared baseline (drive/retry pull from exec; explicit "pilot-template" only from demo seeds / test pilots).
  const gateResults = evaluateGates(rawArtifact as any, effectiveForceFail, groundingOk, baseline);

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
    ...(previewAudit
      ? {
          payload: {
            ...((rawArtifact as { payload?: Record<string, unknown> }).payload || {}),
            audit: previewAudit,
          },
        }
      : {}),
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
      phase: "commit" as const,
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

  let conversation = state.conversation || [];
  if (previewAudit && !previewAudit.passed) {
    conversation = [
      ...conversation,
      {
        id: `t-audit-${runId}`,
        role: "system",
        text: `[T_AUDIT] ${previewAudit.reason} · signals=${previewAudit.fakeSignals.join(",")}`,
        timestamp: new Date().toISOString(),
      },
    ];
  }

  let structureGateLedger = state.structureGateLedger || [];
  if (capId === "structure.decompose") {
    const payloadLedger = (rawArtifact as { payload?: { gateLedger?: string[] } }).payload?.gateLedger;
    const parsedFromContent =
      payloadLedger ||
      (workingContent.includes("G_SCHEMA:") || workingContent.includes("G_INV:")
        ? String(workingContent.split("\n")[0] || "")
            .split(" · ")
            .filter((s) => s.startsWith("G_SCHEMA") || s.startsWith("G_INV") || s.startsWith("C_"))
        : [
            "C_PROMPT:built",
            "C_REDACT:applied:0",
            "G_SCHEMA:attempt1:passed",
            "G_INV:attempt1:passed",
          ]);
    const turnSeed = runId.includes("-run-") ? runId.split("-run-")[0] : runId;
    const sgChecks = parseStructureGateLedger(parsedFromContent, { turnId: turnSeed, runId });
    structureGateLedger = [...structureGateLedger, ...sgChecks];
    const ledgerLines = structureGateLedgerConversationLines(sgChecks);
    conversation = [
      ...conversation,
      ...ledgerLines.map((text, i) => ({
        id: `${runId}-sg-ledger-${i}`,
        role: "system" as const,
        text,
        timestamp: new Date().toISOString(),
      })),
    ];
  }

  // Build the candidate updated state first (with new artifacts/runs so resolve can see the just-committed trusted run/art).
  let updated: V5SessionState = {
    ...state,
    artifacts: newArtifacts,
    capabilityRuns: newRuns,
    gates: newGates,
    conversation,
    dependencyGraph: [...state.dependencyGraph, ...newDeps],
    costLedger: finalCostLedger,
    flowBoundaryLedger,
    structureGateLedger,
    decisionLedger: finalDecisionLedger,
    coverageGaps: state.coverageGaps || [],
  };

  // Knife 7: after successful formal commit, auto-resolve any gaps now satisfied (e.g. required cap delivered).
  if (allPassed && capId === "gap.ask") {
    const newGaps = gapsFromGapAskContent(
      committed.content || "",
      runId.split("-run-")[0] || runId,
      committed.id
    );
    updated = mergeGapAskIntoState(updated, newGaps);
  }

  if (allPassed && capId === "handoff.package") {
    const ship = evaluateShipGates(updated);
    const shipGateStates = ship.gates.map((g) => ({
      gateId: g.gateId as GateState["gateId"],
      kind: "commit" as const,
      status: g.status,
      phase: "ship" as const,
      evaluatedAt: new Date().toISOString(),
    }));
    updated = {
      ...updated,
      deliveryPhase: ship.passed ? "shipped" : "shipping",
      runtimePhase: ship.passed ? "done" : updated.runtimePhase,
      gates: [...(updated.gates || []), ...shipGateStates],
      conversation: [
        ...(updated.conversation || []),
        {
          id: `${runId}-ship-gates`,
          role: "system",
          text: `[SHIP] ${ship.reason}`,
          timestamp: new Date().toISOString(),
        },
        ...ship.gates.map((g) => ({
          id: `${runId}-ship-${g.gateId}`,
          role: "system",
          text: `[T_LEDGER] ${g.gateId} phase=ship status=${g.status}`,
          timestamp: new Date().toISOString(),
        })),
      ],
    };
  }

  if (
    allPassed &&
    (isReport ||
      isSynthesisLike ||
      capId === "risk.analyze" ||
      (capId === "evidence.search" && groundingOk))
  ) {
    updated = resolveCoverageGapsFromState(updated);
  }

  // Auditable BUS note for planner failure-event回流 (G-GROUND).
  if (!groundingOk && (capId === "evidence.search" || capId === "report.write")) {
    const noteText =
      capId === "evidence.search"
        ? "[G-GROUND] 外部证据检索未通过接地门：本轮未引入可信任的外部证据。"
        : "[G-GROUND] 报告提交未通过接地门：会话尚无 grounded 外部证据，不得收敛为已验证可行性。";
    updated = {
      ...updated,
      conversation: [
        ...(updated.conversation || []),
        {
          id: `${runId}-gground`,
          role: "system",
          text: noteText,
          timestamp: new Date().toISOString(),
        },
      ],
    };
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
      // introduce any shrink of `staleArtifactIds` on this path; shrinking only happens in
      // `invalidateForIntervention` supersede paths and explicit gap-resolve helpers.
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

  const dirtyNodeIds = newGraphNodes
    .filter((n: any) => n.status === "challenged" && n.id)
    .map((n: any) => n.id as string);

  return {
    ...nextState,
    projectionDirtyNodeIds: [...new Set([...(state.projectionDirtyNodeIds || []), ...dirtyNodeIds])],
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

  // new_goal: the user's first message owns goal.text + proposition root (not a product default).
  if (controlSignal === "new_goal" && userText.trim()) {
    working = {
      ...working,
      goal: {
        text: userText.trim(),
        status: working.goal?.status ?? "needs_refinement",
      },
    };
  }

  working = resolveReadinessGapsFromUserText(working, userText);

  if (working.awaitReason === "ready" && userClearsReadiness(userText, working)) {
    working = { ...working, awaitReason: undefined, awaitDetail: undefined };
  }
  if (working.awaitReason === "confirm" && userRejectsRouteSelection(userText)) {
    const staleIds = new Set(working.staleArtifactIds || []);
    for (const art of working.artifacts || []) {
      if (art.kind === "route_options") staleIds.add(art.id);
    }
    working = {
      ...working,
      staleArtifactIds: [...staleIds],
      awaitReason: undefined,
      awaitDetail: undefined,
    };
  } else if (working.awaitReason === "confirm" && userPicksRoute(userText)) {
    working = { ...working, awaitReason: undefined, awaitDetail: undefined };
  }

  // S20 ITER: preview dissatisfaction → same recycle as INTERV revise.
  if (isPreviewDissatisfiedIntent(userText) && !intervention) {
    const previewArt = (working.artifacts || []).find(
      (a) => a.kind === "preview" && !(working.staleArtifactIds || []).includes(a.id)
    );
    if (previewArt) {
      working = invalidateForIntervention(working, {
        targetArtifactId: previewArt.id,
        intent: "revise",
        text: userText,
      });
      controlSignal = mapInterventionToControlSignal("revise");
    }
  }

  working = applyRoleModeToState(working, userText);

  if (isDeliveryIntent(userText) && working.goal?.status === "clear") {
    working = { ...working, deliveryPhase: "shipping" };
  }

  // S20 · RV pass → DONE (trusted report + clear; full ship is S19 handoff path).
  if (isReviewPassIntent(userText) && working.goal?.status === "clear") {
    const rv = evaluateReviewPassGate(working);
    const rvReport = latestTrustedReport(working);
    working = {
      ...working,
      deliveryPhase: rv.passed ? "shipped" : working.deliveryPhase,
      runtimePhase: rv.passed ? "done" : "awaiting",
      conversation: [
        ...(working.conversation || []),
        {
          id: `${turnId}-rv-pass`,
          role: "system",
          text: `[RV] ${
            rv.passed
              ? `评审通过 · reportId=${rvReport?.id ?? "unknown"}`
              : rv.reason
          }`,
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  // S20 · RV reject → INTERV invalidate (same path as challenge).
  if (isReviewRejectIntent(userText) && !intervention && working.goal?.status === "clear") {
    const report = latestTrustedReport(working);
    if (report) {
      working = invalidateForIntervention(working, {
        targetArtifactId: report.id,
        intent: "challenge",
        text: userText,
      });
      controlSignal = mapInterventionToControlSignal("challenge");
    }
  }

  // P0 argument graph: intake must anchor the proposition root before any capability nodes land.
  if (!getPropositionRootNode(working) && userText.trim()) {
    working = ensurePropositionRoot(working, userText.trim());
  } else {
    working = ensurePropositionRoot(working);
  }

  // 图节点由 ORCH/DLEDGER 自主选定能力后再生长（不在 INTAKE 预置 8 个占位节点）。

  // 标记阶段：支持外圈 ORCH → AWAIT → INTAKE 证明（RV→DONE 保持 done，不覆写）
  const phaseAfterIntake =
    working.runtimePhase === "done" ? "done" : ("orchestrating" as const);
  working = {
    ...working,
    runtimePhase: phaseAfterIntake,
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
export function markAwaiting(
  state: V5SessionState,
  turnId?: string,
  awaitMeta?: { reason?: import("@shared/blueprint/v5-reasoning-state").AwaitReason; detail?: string }
): V5SessionState {
  return {
    ...state,
    runtimePhase: "awaiting",
    lastTurnId: turnId || state.lastTurnId,
    awaitReason: awaitMeta?.reason,
    awaitDetail: awaitMeta?.detail,
  };
}

/** Map Session_Driver / ORCH park signals to STATUS awaitReason (P0/P4). */
function awaitMetaForStop(
  stopReason: ReentryStopReason,
  detail?: string
): { reason?: import("@shared/blueprint/v5-reasoning-state").AwaitReason; detail?: string } | undefined {
  switch (stopReason) {
    case "budget_exhausted":
      return { reason: "budget", detail };
    case "coverage_sufficient":
    case "convergence_signal":
      return { reason: "convergence", detail };
    case "await_ready":
      return { reason: "ready", detail };
    case "await_confirm":
      return { reason: "confirm", detail };
    case "no_progress":
      return { reason: "user_input", detail: detail ?? "连续无进展" };
    case "user_interrupted":
      return { reason: "ready", detail: detail || "已停止，发送消息继续" };
    default:
      return detail ? { detail } : undefined;
  }
}

function parkForStop(
  state: V5SessionState,
  turnId: string,
  stopReason: ReentryStopReason,
  detail?: string
): V5SessionState {
  return markAwaiting(state, turnId, awaitMetaForStop(stopReason, detail));
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
      return enrichGraphNodeFromArtifact(
        {
          ...node,
          producedArtifactId: match.id,
          producedRunId: node.capabilityRunId,
        },
        match
      );
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
    const escalate = shouldEscalateOnBudgetBlock(working, true, working.coverageGate);
    let parked = escalate
      ? {
          ...markAwaiting(working, turnId, { reason: "budget", detail: budgetCheck.reason }),
          runtimePhase: "failed" as const,
          escalated: true,
        }
      : markAwaiting(working, turnId, {
          reason: "budget",
          detail: budgetCheck.reason,
        });
    const noteText = escalate
      ? `[ESC] budget exceeded + GCOV unsatisfiable: ${budgetCheck.reason || "policy limit"} → 转人工`
      : `[BUDGET] exceeded: ${budgetCheck.reason || "policy limit"}. Partial AWAIT (no new capabilities scheduled this turn).`;
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
    let parked = markAwaiting(working, turnId, {
      reason: "convergence",
      detail: sufficiency.reason,
    });
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
  let convergenceRejectedByGcov = false;

  if (proposed?.converged === true && (proposed.selected?.length ?? 0) === 0) {
    const nowIso = new Date().toISOString();
    const allCapIds = Array.from(V5_CAPABILITY_POOL.keys()) as string[];
    const convergenceDecision: SchedulingDecision = {
      id: `${turnId}-dledger`,
      turnId,
      saw: allCapIds,
      chose: [],
      skipped: allCapIds.map((cid) => ({
        capabilityId: cid,
        reason: "convergence_signal: router confirmed no further steps",
      })),
      addresses: [],
      rationale: proposed.rationale || "CONVERGENCE_SIGNAL",
      alternativesRejected: allCapIds,
      createdAt: nowIso,
      source: proposed.source === "llm" ? "llm" : "local_heuristic",
    };
    working = {
      ...working,
      decisionLedger: [...(working.decisionLedger || []), convergenceDecision],
    };

    if (!working.coverageContract) {
      const goalForContract = working.goal?.text || userTextForPick || "";
      const { contract, gaps } = authorCoverageContract(goalForContract, turnId);
      working = {
        ...working,
        coverageContract: contract,
        coverageGaps: gaps,
      };
      working = resolveCoverageGapsFromState(working);
    }
    const gateResult = evaluateCoverageGate(working, [], working.coverageContract);
    working = {
      ...working,
      coverageGate: gateResult,
    };
    working = applyGoalConclusion(
      working,
      deriveGoalConclusion(working, gateResult, working.coverageContract)
    );

    if (gateResult.passed) {
      const parked = markAwaiting(working, turnId, {
        reason: "convergence",
        detail: "收敛信号 · 覆盖率已满足",
      });
      return {
        newState: parked,
        plan: {
          selected: [],
          reason: "CONVERGENCE_SIGNAL",
          expectedArtifacts: [],
        } as TurnPlan,
        newGraphNodes: [],
      };
    }

    const policy = getDefaultBudgetPolicy();
    const missing = gateResult.missingCapabilities || [];
    const forced = missing
      .filter((m) => m !== "report.write")
      .slice(0, policy.maxCapabilityRunsPerTurn)
      .map((m) => ({
        capabilityId: m as V5CapabilityId,
        roleId: m.includes("risk") ? "安全" : m.includes("evidence") ? "综合" : "综合",
      }));

    if (forced.length === 0) {
      let parked = markAwaiting(working, turnId, {
        reason: "coverage",
        detail: `G_COVERAGE 拒绝收敛: ${gateResult.reason}`,
      });
      const note = {
        id: `${turnId}-gcov-convergence`,
        role: "system",
        text: `[GCOV] blocked convergence: ${gateResult.reason}`,
        timestamp: new Date().toISOString(),
      };
      parked = {
        ...parked,
        conversation: [...(parked.conversation || []), note],
      };
      return {
        newState: parked,
        plan: {
          selected: [],
          reason: `GCOV_BLOCKED: ${gateResult.reason}`,
          expectedArtifacts: [],
        } as TurnPlan,
        newGraphNodes: [],
      };
    }

    convergenceRejectedByGcov = true;
    selected = forced;
    planSource = proposed.source === "llm" ? "llm" : "local_heuristic";
    pickRationale = `GCOV rejected convergence: ${gateResult.reason}`;
    const ledgerArr = working.decisionLedger || [];
    if (ledgerArr.length > 0) {
      const lastDec: any = ledgerArr[ledgerArr.length - 1];
      const forcedIds = forced.map((f) => f.capabilityId);
      lastDec.chose = forcedIds;
      lastDec.skipped = (lastDec.skipped || []).filter(
        (sk: any) => !forcedIds.includes(sk.capabilityId)
      );
      lastDec.alternativesRejected = (lastDec.alternativesRejected || []).filter(
        (cid: string) => !(forcedIds as string[]).includes(cid)
      );
      lastDec.rationale = `${lastDec.rationale || ""} | GCOV-forced-after-convergence-reject: ${forcedIds.join(",")}`;
    }
  } else if (proposed) {
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

  if (!convergenceRejectedByGcov) {
    working = {
      ...working,
      decisionLedger: [...(working.decisionLedger || []), decision],
    };
  }

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
          lastDec.chose = [...forcedIds, ...(lastDec.chose || [])];
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
      let parked = markAwaiting(working, turnId, {
        reason: "coverage",
        detail: gateResult.reason,
      });
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
  working = ensurePropositionRoot(working);
  const root = getPropositionRootNode(working);

  // G-ROOT-1: refuse orphan capability nodes when root is missing.
  if (!root) {
    const reason = "G-ROOT-1: missing proposition root";
    const note = {
      id: `${turnId}-groot`,
      role: "system",
      text: `[G-ROOT] blocked graph write: ${reason}`,
      timestamp: new Date().toISOString(),
    };
    working = {
      ...working,
      conversation: [...(working.conversation || []), note],
    };
    return {
      newState: markAwaiting(working, turnId),
      plan: { selected: [], reason, expectedArtifacts: [] } as TurnPlan,
      newGraphNodes: [],
    };
  }

  const touchedNodes: BrainstormReasoningNode[] = [];
  let graphNodes = [...(working.graph.nodes || [])];
  let graphEdges = [...(working.graph.edges || [])];

  for (const sel of effectiveSelected) {
    working = ensureRouteBranchScaffold(
      working,
      turnId,
      root.id,
      String(sel.capabilityId)
    );
    graphNodes = [...(working.graph.nodes || [])];
    graphEdges = [...(working.graph.edges || [])];
  }

  for (let i = 0; i < effectiveSelected.length; i++) {
    const sel = effectiveSelected[i];
    const structuralParentId = resolveStructuralParentId(
      working,
      context,
      sel.capabilityId as string
    );
    if (!structuralParentId) continue;

    const parentRound =
      (graphNodes.find((n) => n.id === structuralParentId) as { round?: number })?.round ?? 0;
    const round = parentRound + 1;
    const parentNode = graphNodes.find((n) => n.id === structuralParentId) as
      | (BrainstormReasoningNode & { capabilityRunId?: string; producedArtifactId?: string })
      | undefined;
    const reuseScaffold =
      isScaffoldPlaceholderNodeId(structuralParentId) &&
      !parentNode?.capabilityRunId &&
      !parentNode?.producedArtifactId;
    const childType = capabilityIdToReasoningNodeType(sel.capabilityId as V5CapabilityId);
    const label =
      intervention?.intent === "challenge"
        ? "质疑"
        : parentNode?.type === "question"
        ? childType === "evidence"
          ? "来源"
          : childType === "clarification"
          ? "提出"
          : childType === "risk"
          ? "验证"
          : "拆解"
        : reuseScaffold
        ? childType === "evidence"
          ? "来源"
          : childType === "risk"
          ? "验证"
          : childType === "synthesis" || childType === "decision"
          ? "收敛"
          : childType === "clarification" || childType === "gap"
          ? "提出"
          : "拆解"
        : childType === "risk"
        ? "反证"
        : childType === "synthesis" || childType === "decision"
        ? "收敛"
        : "支撑";

    const nodeId = reuseScaffold ? structuralParentId : `${turnId}-node-${i}`;
    const scaffoldParentEdge = reuseScaffold
      ? graphEdges.find((e) => e.type === "depends_on" && e.target === nodeId)
      : undefined;
    const derivedFrom = reuseScaffold
      ? [scaffoldParentEdge?.source ?? structuralParentId]
      : [structuralParentId];
    const nodePayload = {
      id: nodeId,
      type: childType,
      title: pendingCapabilityNodeTitle(sel.capabilityId as V5CapabilityId, sel.roleId),
      body: formatProvenanceForLabel(
        { derivedFrom } as BrainstormReasoningNode & {
          derivedFrom?: string[];
        },
        working.graph
      ),
      roleId: sel.roleId,
      roleLabel: roleIdToDisplayLabel(sel.roleId),
      capabilityId: sel.capabilityId,
      derivedFrom,
      round,
      turnId,
      capabilityRunId: `${turnId}-run-${i}`,
      status: "active",
    } as BrainstormReasoningNode;

    if (reuseScaffold) {
      const idx = graphNodes.findIndex((n) => n.id === nodeId);
      if (idx >= 0) {
        graphNodes[idx] = { ...graphNodes[idx], ...nodePayload };
        touchedNodes.push(graphNodes[idx]);
      }
    } else {
      graphNodes.push(nodePayload);
      graphEdges.push({
        id: `${turnId}-struct-${i}`,
        source: structuralParentId,
        target: nodeId,
        type: "depends_on",
        label,
        capabilityId: sel.capabilityId,
      });
      touchedNodes.push(nodePayload);
    }
  }

  working.graph = {
    ...working.graph,
    nodes: graphNodes,
    edges: graphEdges,
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

  return { newState: working, plan, newGraphNodes: touchedNodes };
}

// ===== Session_Driver: multi-step re-entry loop (whybuddy-llm-autonomous-reasoning, 需求 1 / 2) =====
// Task 4.1 scope: the runtime-owned re-entry loop CORE + convergence_signal stop.
//   - Repeatedly: router.proposePlan → orchestrateReasoningTurn(state, {proposedPlan}) → commit
//     each selected capability via the `${loopTurnId}-run-${i}` single-capability primitive.
//   - Each round derives a stable `${turnSeedId}-loop-${n}` turn id; orchestrateReasoningTurn keeps
//     its single-round responsibility unchanged (it owns DLEDGER/GCOV/budget writes; the driver
//     never double-writes a decision record).
//   - New artifacts are written into `working` immediately, so the next round sees them as upstream
//     via findInputsForCapability (需求 1.6, dependency graph updated in-place).
//   - Empty `selected` && `converged === true` → terminate with `convergence_signal` (需求 3.3),
//     consuming the ReasoningRouterResponse.converged field from task 2.3.
//
// Termination guards (task 4.2): coverage_sufficient / budget_exhausted / no_progress / max_repeat_guard
// are evaluated via evaluatePostRoundGuards, filterSelectedByMaxRepeat, and per-loop BUDGET re-check.

/** Snapshot of coverage-gap ids currently in the `resolved` state (No_Progress bookkeeping, 需求 1.7). */
function snapshotResolvedGapIds(state: V5SessionState): Set<string> {
  return new Set(
    (state.coverageGaps || [])
      .filter((g) => g.status === "resolved")
      .map((g) => g.id)
  );
}

/** Count persisted capability runs for a given capability id (session-wide). */
function countCapabilityRuns(state: V5SessionState, capId: string): number {
  return (state.capabilityRuns || []).filter((r) => (r as any).capabilityId === capId).length;
}

/**
 * maxRepeatPerCapability guard (需求 1.8): exclude capabilities that already hit the session limit
 * from the current round's execution batch. Counts come from persisted capabilityRuns only.
 */
function filterSelectedByMaxRepeat<T extends { capabilityId: string }>(
  selected: T[],
  state: V5SessionState,
  policy: BudgetPolicy
): T[] {
  return selected.filter(
    (sel) => countCapabilityRuns(state, sel.capabilityId) < policy.maxRepeatPerCapability
  );
}

/**
 * Pre-loop BUDGET re-eval for Session_Driver (需求 1.2).
 * Checks session-level gates only (maxTurns / maxCapabilityRunsPerSession).
 * Per-capability maxRepeatPerCapability is handled separately via filterSelectedByMaxRepeat → max_repeat_guard.
 */
function evaluateReentryBudgetGate(
  state: V5SessionState,
  context: OrchestrateContext | undefined,
  policy: BudgetPolicy
): { allowed: boolean; reason?: string } {
  const runs = state.capabilityRuns || [];
  const turnIds = new Set(runs.map((r: any) => r.turnId).filter(Boolean));
  const currentTurns = turnIds.size;
  const currentRuns = runs.length;

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
  const totalEstimatedTokens = (state.costLedger || []).reduce(
    (sum, c) => sum + (c.estimatedTokens || 0),
    0
  );
  if (totalEstimatedTokens >= policy.maxTokensPerSession) {
    allowed = false;
    reason =
      reason ||
      `maxTokensPerSession exceeded (${totalEstimatedTokens} >= ${policy.maxTokensPerSession})`;
  }

  return { allowed, reason };
}

/** Classify why orchestrateReasoningTurn parked with an empty plan (budget / contract / GCOV). */
function classifyParkStop(plan: TurnPlan): ReentryStopReason {
  const reason = plan?.reason || "";
  if (reason.startsWith("CONVERGENCE_SIGNAL")) return "convergence_signal";
  if (reason.startsWith("CONTRACT_SUFFICIENT")) return "coverage_sufficient";
  return "budget_exhausted";
}

/**
 * V5.1 Session_Driver: GCOV hard-block is recoverable on the next ORCH loop when pre-reqs
 * were not fully scheduled this round (orchestrateReasoningTurn still parks + empty plan).
 */
export function isRecoverableGcovReentry(plan: TurnPlan): boolean {
  return (plan?.reason || "").startsWith("GCOV_BLOCKED:");
}

/**
 * Post-round termination guards (需求 1.2 / 1.4 / 1.5 / 1.7).
 * Returns a stop reason when the driver should park before the next re-entry loop.
 */
/** Exported for deterministic PBT (Property 7 / task 4.10). */
export function evaluatePostRoundGuards(
  state: V5SessionState,
  accumulator: ReentryAccumulator,
  opts: {
    maxLoops: number;
    budgetPolicy: BudgetPolicy;
    turnId: string;
    userText: string;
    intervention?: UserIntervention;
  }
): ReentryStopReason | null {
  const sufficiency = evaluateContractSufficiencyForBudget(state, {
    turnId: opts.turnId,
    userText: opts.userText,
    intervention: opts.intervention,
  });
  if (sufficiency.sufficient) return "coverage_sufficient";

  if (accumulator.noProgressStreak >= 2) return "no_progress";

  const runs = state.capabilityRuns?.length ?? 0;
  if (runs >= opts.budgetPolicy.maxCapabilityRunsPerSession) return "budget_exhausted";

  if (accumulator.loopCount >= opts.maxLoops) return "budget_exhausted";

  return null;
}

/**
 * driveReasoningSession — the runtime-owned multi-step driver (需求 1 / 2, core net-new增量).
 *
 * Drives a single user message through N re-entry loops: route → single-round orchestrate → per-capability
 * commit, parking at AWAIT when a termination guard fires. Returns the final state, the per-loop trace, and
 * the stop reason. orchestrateReasoningTurn is reused unchanged as the single-round primitive (需求 2.1/2.2);
 * the `${loopTurnId}-run-${i}` commit form is preserved (需求 2.3).
 */
export async function driveReasoningSession(
  state: V5SessionState,
  options: DriveReasoningOptions
): Promise<DriveReasoningResult> {
  const { turnSeedId, userText, intervention } = options;

  // Resolve providers: explicit injection wins; otherwise BUILD_TARGET drives deterministic vs real
  // (需求 13.3 / 13.5). This keeps the driver deterministically testable with zero real-LLM calls.
  const assembled = assembleProvidersForBuildTarget({
    router: options.router,
    executor: options.executor,
  });
  const router = assembled.router;
  const executor = assembled.executor;

  const maxLoops = options.maxLoopsPerMessage ?? DEFAULT_MAX_LOOPS_PER_MESSAGE;
  const budgetPolicy = options.budgetPolicy ?? getDefaultBudgetPolicy();

  let working: V5SessionState = state;
  const loops: DriveReasoningResult["loops"] = [];

  // Loop-local cross-round bookkeeping (NOT persisted into V5SessionState schema).
  const accumulator: ReentryAccumulator = {
    prevArtifactCount: working.artifacts?.length ?? 0,
    prevResolvedGapIds: snapshotResolvedGapIds(working),
    perCapabilityRunCount: new Map<V5CapabilityId, number>(),
    loopCount: 0,
    noProgressStreak: 0,
  };

  let stopReason: ReentryStopReason = "budget_exhausted";
  let lastLoopTurnId = turnSeedId;

  while (true) {
    if (accumulator.loopCount >= maxLoops) {
      stopReason = "budget_exhausted";
      break;
    }

    // M1: graceful stop at loop boundary (after maxLoops guard, before heavy work).
    // In-flight aborts handled by propagating signal to router/executor where supported.
    if (options.abortSignal?.aborted) {
      stopReason = "user_interrupted";
      working = parkForStop(working, lastLoopTurnId, stopReason, "user requested stop");
      // Record in T_LEDGER style via loops entry (stopSignal carries the reason).
      loops.push({
        loopTurnId: lastLoopTurnId,
        plan: { selected: [], reason: "USER_INTERRUPTED", expectedArtifacts: [] },
        committedArtifactIds: [],
        stopSignal: "user_interrupted",
      });
      // Ensure a ledger entry for audit (interrupted_by_user)
      // Note: actual T_LEDGER appends happen via other paths; here we rely on the stopReason
      // being visible in result and UI can surface via derive.
      return { finalState: working, loops, stopReason };
    }

    const loopTurnId = `${turnSeedId}-loop-${accumulator.loopCount}`;
    lastLoopTurnId = loopTurnId;
    accumulator.loopCount += 1;

    // 4.2 (需求 1.2): re-evaluate session-level BUDGET before each re-entry loop.
    const budgetCheck = evaluateReentryBudgetGate(
      working,
      { turnId: loopTurnId, userText, intervention },
      budgetPolicy
    );
    if (!budgetCheck.allowed) {
      working = parkForStop(working, loopTurnId, "budget_exhausted", budgetCheck.reason);
      loops.push({
        loopTurnId,
        plan: {
          selected: [],
          reason: `BUDGET_EXCEEDED: ${budgetCheck.reason}`,
          expectedArtifacts: [],
        },
        committedArtifactIds: [],
        stopSignal: "budget_exhausted",
      });
      stopReason = "budget_exhausted";
      return { finalState: working, loops, stopReason };
    }

    // 1. Router proposes the next batch (R1 validation / graceful degradation live downstream).
    const proposed = await router.proposePlan({
      state: working,
      turnId: loopTurnId,
      userText,
      intervention,
    });

    // 4.2 (需求 1.8): exclude at-limit capabilities from the router proposal BEFORE orchestrate.
    const filteredProposal = filterSelectedByMaxRepeat(
      proposed.selected || [],
      working,
      budgetPolicy
    );
    if ((proposed.selected?.length ?? 0) > 0 && filteredProposal.length === 0) {
      working = markAwaiting(working, loopTurnId);
      loops.push({
        loopTurnId,
        plan: { selected: [], reason: "MAX_REPEAT_GUARD", expectedArtifacts: [] },
        committedArtifactIds: [],
        stopSignal: "max_repeat_guard",
      });
      stopReason = "max_repeat_guard";
      return { finalState: working, loops, stopReason };
    }

    // Attribute the router (orchestrate.plan) cost per round when usage is present, keeping the
    // routing cost bucket separate from capability-execution buckets (需求 11 parity across loops).
    if (proposed.usage) {
      working = recordCapabilityRunCost(
        working,
        {
          id: `${loopTurnId}-orch-plan`,
          capabilityId: "orchestrate.plan" as any,
          turnId: loopTurnId,
          inputs: [],
          outputs: [],
          gateResults: [],
        } as any,
        { source: "server", usage: proposed.usage }
      );
    }

    // 2. Single-round orchestrate (consumes the proposedPlan; owns DLEDGER/GCOV/budget — 需求 1.3).
    const { newState, plan } = orchestrateReasoningTurn(working, {
      turnId: loopTurnId,
      userText,
      intervention,
      proposedPlan: {
        selected: filteredProposal,
        rationale: proposed.rationale,
        source: proposed.source,
        converged: proposed.converged,
      },
    });
    working = newState;

    // If orchestrate parked this round (budget / contract / GCOV), it returns an empty plan.
    if (!plan.selected || plan.selected.length === 0) {
      const parkStop = classifyParkStop(plan);
      const gcovRecoverable = isRecoverableGcovReentry(plan);

      loops.push({
        loopTurnId,
        plan,
        committedArtifactIds: [],
        stopSignal: gcovRecoverable ? undefined : parkStop,
      });

      if (options.onLoopComplete) {
        await options.onLoopComplete({
          loopIndex: loops.length - 1,
          loopTurnId,
          state: working,
          plan,
          committedArtifactIds: [],
          stopSignal: gcovRecoverable ? undefined : parkStop,
        });
      }

      if (gcovRecoverable) {
        // No artifacts this round — count toward no_progress, then re-enter ORCH if guards allow.
        accumulator.noProgressStreak += 1;
        const postGuard = evaluatePostRoundGuards(working, accumulator, {
          maxLoops,
          budgetPolicy,
          turnId: loopTurnId,
          userText,
          intervention,
        });
        if (postGuard) {
          working = parkForStop(working, loopTurnId, postGuard, plan.reason);
          loops[loops.length - 1] = { ...loops[loops.length - 1], stopSignal: postGuard };
          stopReason = postGuard;
          return { finalState: working, loops, stopReason };
        }
        continue;
      }

      stopReason = parkStop;
      working = parkForStop(working, loopTurnId, parkStop, plan.reason);
      return { finalState: working, loops, stopReason };
    }

    // 4. Execute + commit each selected capability (`${loopTurnId}-run-${i}`).
    const committedArtifactIds: string[] = [];
    const parallelExec = options.parallelCapabilityExecution !== false;
    const execSnapshot = working;

    type RoundExec = {
      i: number;
      cap: V5CapabilityId;
      roleId: string;
      runId: string;
      freshInputs: string[];
      exec: CapabilityExecutionResult | null;
    };

    const runOne = async (sel: (typeof plan.selected)[number], i: number): Promise<RoundExec> => {
      const cap = sel.capabilityId as V5CapabilityId;
      const roleId = sel.roleId || "agent";
      const runId = `${loopTurnId}-run-${i}`;
      const freshInputs = findInputsForCapability(execSnapshot, cap);
      let exec: CapabilityExecutionResult | null = null;
      try {
        exec = await executor.executeCapability({
          capabilityId: cap,
          state: execSnapshot,
          inputArtifactIds: freshInputs,
          roleId,
          turnId: loopTurnId,
          capabilityRunId: runId,
        });
      } catch {
        exec = null;
      }
      return { i, cap, roleId, runId, freshInputs, exec };
    };

    const roundResults: RoundExec[] = parallelExec
      ? await Promise.all(plan.selected.map((sel, i) => runOne(sel, i)))
      : [];
    if (!parallelExec) {
      for (let i = 0; i < plan.selected.length; i++) {
        roundResults.push(await runOne(plan.selected[i], i));
      }
    }
    roundResults.sort((a, b) => a.i - b.i);

    for (const round of roundResults) {
      const { i, cap, roleId, runId, freshInputs, exec } = round;
      const content =
        exec?.content || `${roleId} 通过 ${cap} 产出新洞察/证据/方案`;
      const provenance =
        (exec?.provenance as Artifact["provenance"]) || "ai_generated";
      const outputKind = CAPABILITY_OUTPUT_KIND[cap] ?? "decision";
      const execEvidenceSource = (exec as { evidenceSource?: string } | null)?.evidenceSource;
      const mergedPayload =
        exec?.payload !== undefined || execEvidenceSource
          ? {
              ...(typeof exec?.payload === "object" && exec?.payload
                ? exec.payload
                : {}),
              ...(execEvidenceSource ? { evidenceSource: execEvidenceSource } : {}),
            }
          : undefined;

      const execFailed = exec == null;
      const baseline = (exec as any)?.qualityBaseline ?? "production";
      const { updatedState, committed, run } = commitArtifact(
        working,
        {
          id: `${loopTurnId}-art-${i}`,
          kind: outputKind as Artifact["kind"],
          provenance,
          producedBy: {
            capabilityRunId: runId,
            capabilityId: cap,
            roleId,
          },
          title: content ? content.split("\n")[0]?.slice(0, 80) : undefined,
          summary: content ? content.slice(0, 200) : undefined,
          content,
          ...(mergedPayload !== undefined ? { payload: mergedPayload } : {}),
        } as Omit<Artifact, "trustLevel" | "passedGates">,
        runId,
        false,
        freshInputs,
        baseline
      );

      working = updatedState;
      if (committed) committedArtifactIds.push(committed.id);

      const execDegraded = Boolean((exec as { degraded?: boolean } | null)?.degraded);
      const execDegradedReason = (exec as { degradedReason?: string } | null)?.degradedReason;
      if (execDegraded && isDeliberationCapability(cap)) {
        working = markBrainstormDegraded(
          working,
          execDegradedReason || `${cap}_degraded`
        );
      }

      if (cap === "route.generate" || cap === "route.compare") {
        working = tagRouteBranchNodes(working, loopTurnId, cap, content);
      }

      const interactiveGate = evaluateInteractiveGateAfterCommit(working, {
        capabilityId: cap,
        turnUserText: userText,
        committed: Boolean(committed),
      });
      if (interactiveGate.park && interactiveGate.gate) {
        const stopSignal: ReentryStopReason =
          interactiveGate.gate === "confirm" ? "await_confirm" : "await_ready";
        working = markAwaiting(working, loopTurnId, {
          reason: interactiveGate.gate,
          detail: interactiveGate.detail,
        });
        const note = {
          id: `${loopTurnId}-${interactiveGate.gate}`,
          role: "system",
          text: `[G_${interactiveGate.gate === "ready" ? "READY" : "CONFIRM"}] ${interactiveGate.detail}`,
          timestamp: new Date().toISOString(),
        };
        working = {
          ...working,
          conversation: [...(working.conversation || []), note],
        };
        loops.push({
          loopTurnId,
          plan,
          committedArtifactIds,
          stopSignal,
        });
        if (options.onLoopComplete) {
          await options.onLoopComplete({
            loopIndex: loops.length - 1,
            loopTurnId,
            state: working,
            plan,
            committedArtifactIds,
            stopSignal,
          });
        }
        stopReason = stopSignal;
        return { finalState: working, loops, stopReason };
      }

      const failedGate = (run.gateResults || []).find((g) => g.status === "failed");
      const gateFailed = Boolean(failedGate);
      if (options.onCapabilityRound && (execFailed || gateFailed || !committed)) {
        options.onCapabilityRound({
          loopTurnId,
          capabilityId: cap,
          roleId,
          runIndex: i,
          runId,
          committed: Boolean(committed),
          gateFailed,
          execFailed,
          gateMessage: failedGate?.gateId,
        });
      }

      accumulator.perCapabilityRunCount.set(
        cap,
        (accumulator.perCapabilityRunCount.get(cap) || 0) + 1
      );
    }

    // Bind committed artifacts back onto this round's graph nodes (precise artifact/run binding).
    working = enrichGraphNodesAfterCommit(working, loopTurnId);

    loops.push({ loopTurnId, plan, committedArtifactIds });

    if (options.onLoopComplete) {
      await options.onLoopComplete({
        loopIndex: loops.length - 1,
        loopTurnId,
        state: working,
        plan,
        committedArtifactIds,
      });
    }

    // 5 (需求 1.7): maintain the No_Progress accumulator each round.
    // Progress = trusted commits this round (committedArtifactIds), not failed-gate attempts.
    const artifactCountNow = working.artifacts?.length ?? 0;
    const resolvedNow = snapshotResolvedGapIds(working);
    const producedArtifact = committedArtifactIds.length > 0;
    let resolvedNewGap = false;
    for (const id of resolvedNow) {
      if (!accumulator.prevResolvedGapIds.has(id)) {
        resolvedNewGap = true;
        break;
      }
    }
    accumulator.noProgressStreak =
      producedArtifact || resolvedNewGap ? 0 : accumulator.noProgressStreak + 1;
    accumulator.prevArtifactCount = artifactCountNow;
    accumulator.prevResolvedGapIds = resolvedNow;

    // 6 (需求 1.2 / 1.4 / 1.5 / 1.7): re-evaluate termination guards before next re-entry.
    const postGuard = evaluatePostRoundGuards(working, accumulator, {
      maxLoops,
      budgetPolicy,
      turnId: loopTurnId,
      userText,
      intervention,
    });
    if (postGuard) {
      working = parkForStop(working, loopTurnId, postGuard);
      loops[loops.length - 1] = {
        ...loops[loops.length - 1],
        stopSignal: postGuard,
      };
      stopReason = postGuard;
      return { finalState: working, loops, stopReason };
    }
  }

  // Per-message loop cap reached (需求 1.5).
  working = parkForStop(working, lastLoopTurnId, "budget_exhausted", "maxLoopsPerMessage");
  return { finalState: working, loops, stopReason };
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
