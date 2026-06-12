/**
 * S9: Deterministic turn-route projection from runtime-recorded facts.
 * Zero LLM, zero V5SessionState writes.
 * V5.1 product IM: stations name architecture nodes (INTAKE / ORCH / C_EVID …), not generic「推演」.
 */

import {
  formatV51CapabilityStation,
  formatV51ChoseSummary,
  formatV51ControlStation,
  isAutonomousClosureReason,
} from "./v51-architecture-nodes.js";

export type SelectedCapabilityPick = { capabilityId: string; roleId: string };

export type GoalStatusValue = "clear" | "needs_refinement" | "not_recommended" | undefined;

export type PlanSourceValue = "llm" | "heuristic_fallback" | "local_heuristic" | null | undefined;

/**
 * Why the Session_Driver stopped re-entering for a given round (需求 14.6).
 * Structurally mirrors `ReentryStopReason` in `client/src/lib/whybuddy-runtime.ts`;
 * defined locally so the shared projection stays decoupled from the client runtime.
 */
export type ReentryStopReason =
  | "coverage_sufficient" // 需求 1.4
  | "budget_exhausted" // 需求 1.5 / 1.9
  | "no_progress" // 需求 1.7
  | "max_repeat_guard" // 需求 1.8
  | "convergence_signal" // 需求 3.3
  | "await_ready" // P0: G_READY
  | "await_confirm"; // P0: G_CONFIRM

/**
 * Per-round derived facts for a single planning+reasoning loop within one user turn (需求 14.1).
 * Runtime-recorded; zero V5SessionState writes. `rounds` is only populated when the
 * Session_Driver actually re-enters (N ≥ 2); single-round turns leave it undefined and
 * degrade to the legacy single-round projection.
 */
export type TurnRoundFacts = {
  /** 1-based round index within the turn. */
  roundIndex: number;
  /** Session_Driver loop turn id — scopes execution substeps to this round. */
  loopTurnId?: string;
  planSelectedCount?: number;
  planSource?: PlanSourceValue;
  /** Carries `BUDGET_EXCEEDED…` style park reasons (需求 14.6). */
  planReason?: string;
  dledgerDecisionId?: string | null;
  /** Set when this round terminated re-entry (需求 14.6). */
  parkReason?: ReentryStopReason;
  /** ORCH/DLEDGER chose for this loop — drives per-pool capability stations. */
  selectedCapabilities?: SelectedCapabilityPick[];
};

export type TurnRouteFacts = {
  turnId: string;
  timestamp?: string;
  interventionIntent?: string | null;
  challengeTargetLabel?: string | null;

  staleArtifactIdsBefore?: string[];
  staleArtifactIdsAfter?: string[];
  goalStatusBefore?: GoalStatusValue;
  /** Post-invalidate status (challenge turns) — drives stale-cascade downgrade copy. */
  goalStatusAfterInvalidate?: GoalStatusValue;
  goalStatusAfter?: GoalStatusValue;

  planReason?: string;
  planSelectedCount?: number;
  planSource?: PlanSourceValue;
  /** R1/D1: orchestrate-plan fallback reason when source ≠ llm (dev + timeline hint). */
  planOrchestrateReason?: string | null;
  dledgerDecisionId?: string | null;

  committedCount?: number;
  trustPassedCount?: number;
  trustTotalCount?: number;
  /** Runs where G-GROUND failed this turn (for timeline copy). */
  trustGroundFailedCount?: number;

  runtimePhase?: "awaiting" | "orchestrating" | "idle" | "failed" | "done";

  /**
   * Multi-round sequence (需求 14.1). When present and non-empty, the projection
   * derives a planning+reasoning station pair per round. When absent/undefined the
   * projection degrades to the legacy single-round path (full backward compatibility).
   */
  rounds?: TurnRoundFacts[];
  /** Single-round ORCH pick list (when `rounds` absent). */
  selectedCapabilities?: SelectedCapabilityPick[];
  /** Session_Driver stop reason — drives DONE vs AWAIT terminal station. */
  closureReason?: ReentryStopReason | null;
};

export type RouteStationKind =
  | "intake"
  | "stale_cascade"
  | "budget_pass"
  | "plan"
  | "budget_block"
  | "execution"
  | "capability"
  | "interactive_gate"
  | "trust_gate"
  | "verdict"
  | "reentry"
  | "await";

/** 架构图边类型：前进 / 并行分叉 / 回边再入 */
export type RouteLinkKind = "forward" | "parallel" | "reentry";

export type RouteStationTone =
  | "process"
  | "reconverge"
  | "pass"
  | "partial"
  | "fail"
  | "pending"
  | "active";

export type RouteStation = {
  id: string;
  kind: RouteStationKind;
  /** V5.1 architecture node id (INTAKE, ORCH, C_EVID, …). */
  v51NodeId?: string;
  title: string;
  detail?: string;
  tone: RouteStationTone;
  timestamp?: string;
  sessionId?: string;
  dledgerDecisionId?: string;
  summaryToken?: string;
  loopTurnId?: string;
  /** Causal parent in execution order. */
  parentId?: string;
  /** V5.1 架构平面层级（回边不加深此值）. */
  depth?: number;
  /** 0 = 控制平面脊柱；≥1 = BUS 并行叉枝横向展开. */
  lane?: number;
  linkKind?: RouteLinkKind;
  /** 回边目标架构节点（如 GCOV → BUDGET 再入）. */
  reentryTargetV51?: string;
  /** 本回合首次出现的同架构节点 station id. */
  reentryOfStationId?: string;
  /** Sibling index under ORCH / BUS parallel dispatch. */
  branchIndex?: number;
  /** Last capability sibling under the same ORCH (for └─ connector). */
  isLastSibling?: boolean;
};

/** V5.1 架构图固定平面 — 与 mermaid 控制平面 + 能力池分叉对齐 */
const ARCH_SPINE_DEPTH: Partial<Record<RouteStationKind, number>> = {
  intake: 0,
  stale_cascade: 1,
  reentry: 1,
  budget_pass: 1,
  budget_block: 1,
  plan: 2,
  capability: 3,
  interactive_gate: 4,
  trust_gate: 4,
  verdict: 5,
  await: 6,
};

function isInteractivePark(
  reason?: ReentryStopReason | null
): reason is "await_ready" | "await_confirm" {
  return reason === "await_ready" || reason === "await_confirm";
}

function buildInteractiveGateStation(
  idPrefix: string,
  closureReason: "await_ready" | "await_confirm"
): RouteStation {
  const nodeId = closureReason === "await_ready" ? "G_READY" : "G_CONFIRM";
  const detail =
    closureReason === "await_ready"
      ? "目标未就绪 · 等用户补充后经 INTAKE 续跑"
      : "路线待确认 · 等用户选择后经 INTAKE 续跑";
  const gate = formatV51ControlStation(nodeId, detail);
  return {
    id: `${idPrefix}-${nodeId.toLowerCase()}`,
    kind: "interactive_gate",
    v51NodeId: nodeId,
    title: gate.title,
    detail: gate.detail,
    tone: "pending",
    summaryToken: nodeId,
  };
}

function stationRoundIndex(station: RouteStation): number {
  const m = station.id.match(/-r(\d+)-/);
  return m ? Number(m[1]) : 1;
}

function findRoundBudget(
  result: RouteStation[],
  roundIndex: number,
  turnId: string
): string | undefined {
  if (roundIndex > 1) {
    return result.find(
      (s) =>
        (s.kind === "budget_pass" || s.kind === "budget_block") &&
        s.id.includes(`-r${roundIndex}-`)
    )?.id;
  }
  return (
    result.find((s) => s.kind === "budget_pass" && s.id === `${turnId}-budget-pass`)?.id ??
    result.find((s) => s.kind === "budget_pass" && s.id.includes("-r1-"))?.id
  );
}

function findRoundOrch(result: RouteStation[], roundIndex: number, turnId: string): string | undefined {
  if (roundIndex > 1) {
    return result.find((s) => s.kind === "plan" && s.id.includes(`-r${roundIndex}-`))?.id;
  }
  return (
    result.find((s) => s.kind === "plan" && s.id === `${turnId}-plan`)?.id ??
    result.find((s) => s.kind === "plan" && s.id.includes("-r1-"))?.id
  );
}

function buildGcovToBudgetReentry(id: string, roundLabel: string): RouteStation {
  const gcov = formatV51ControlStation("GCOV", `${roundLabel} · 覆盖率未足 · 强制再调度`);
  return {
    id,
    kind: "reentry",
    v51NodeId: "GCOV",
    title: gcov.title,
    detail: "↩ 架构回边 GCOV → BUDGET",
    tone: "reconverge",
    summaryToken: "GCOV",
    linkKind: "reentry",
    reentryTargetV51: "BUDGET",
  };
}

/** Raw engineering leakage — V5.1 架构真名（含 risk.analyze 等）允许出现在 title。 */
const FORBIDDEN_TERMS = /\b(stale|artifact|upstream)\b/i;

export function goalStatusUserLabel(status: GoalStatusValue): string {
  if (status === "clear") return "已收敛";
  if (status === "not_recommended") return "不建议";
  return "待细化";
}

function planSourceUserLabel(source: PlanSourceValue): string | null {
  if (!source) return null;
  if (source === "llm") return "智能调度";
  return "规则调度";
}

export function staleAddedCount(facts: TurnRouteFacts): number {
  const before = new Set(facts.staleArtifactIdsBefore || []);
  const after = facts.staleArtifactIdsAfter || [];
  return after.filter((id) => !before.has(id)).length;
}

function isBudgetBlocked(facts: TurnRouteFacts): boolean {
  return String(facts.planReason || "").startsWith("BUDGET_EXCEEDED");
}

function hasPlanData(facts: TurnRouteFacts): boolean {
  return (
    facts.planSource != null &&
    typeof facts.planSelectedCount === "number" &&
    Boolean(facts.dledgerDecisionId)
  );
}

function trustCounts(facts: TurnRouteFacts): { passed: number; total: number } | null {
  if (typeof facts.trustTotalCount !== "number" || facts.trustTotalCount <= 0) return null;
  const total = facts.trustTotalCount;
  const passed = Math.min(total, Math.max(0, facts.trustPassedCount ?? 0));
  return { passed, total };
}

export function deriveTurnRoute(facts: TurnRouteFacts): RouteStation[] {
  if (facts.rounds && facts.rounds.length > 0) {
    return deriveMultiRoundRoute(facts);
  }
  return deriveSingleRoundRoute(facts);
}

function buildIntakeStations(facts: TurnRouteFacts): RouteStation[] {
  const stations: RouteStation[] = [];
  const challenged = facts.interventionIntent === "challenge";

  const intake = formatV51ControlStation(
    challenged ? "INTERV" : "INTAKE",
    challenged && facts.challengeTargetLabel
      ? `INTAKE → INTERV · 针对「${facts.challengeTargetLabel}」`
      : undefined
  );
  stations.push({
    id: `${facts.turnId}-intake`,
    kind: "intake",
    v51NodeId: challenged ? "INTERV" : "INTAKE",
    title: intake.title,
    detail: intake.detail,
    tone: challenged ? "reconverge" : "process",
    timestamp: facts.timestamp,
    summaryToken: challenged ? "INTERV" : "INTAKE",
  });

  const delta = staleAddedCount(facts);
  if (challenged && delta > 0) {
    const before = goalStatusUserLabel(facts.goalStatusBefore);
    const after = goalStatusUserLabel(
      facts.goalStatusAfterInvalidate ?? facts.goalStatusAfter ?? "needs_refinement"
    );
    const stale = formatV51ControlStation(
      "INVAL",
      `DEP → INVAL → 失效索引 · ${delta} 项需重算 · GOAL ${before} → ${after}`
    );
    stations.push({
      id: `${facts.turnId}-stale`,
      kind: "stale_cascade",
      v51NodeId: "INVAL",
      title: stale.title,
      detail: stale.detail,
      tone: "reconverge",
      summaryToken: "INVAL",
    });
  }

  return stations;
}

function buildBudgetPassStation(id: string, roundLabel?: string): RouteStation {
  const b = formatV51ControlStation("BUDGET", roundLabel ? `${roundLabel} · 余量足 · 放行` : "余量足 · 放行");
  return {
    id,
    kind: "budget_pass",
    v51NodeId: "BUDGET",
    title: b.title,
    detail: b.detail,
    tone: "pass",
    summaryToken: "BUDGET",
  };
}

function buildOrchStation(
  id: string,
  picks: SelectedCapabilityPick[],
  planSource?: PlanSourceValue,
  dledgerDecisionId?: string | null,
  reasonHint?: string
): RouteStation {
  const n = picks.length;
  const src = planSourceUserLabel(planSource);
  const chose = formatV51ChoseSummary(picks.map((p) => p.capabilityId));
  const orch = formatV51ControlStation(
    "ORCH",
    `DLEDGER · 选定 ${n} 个池节点：${chose}${src ? ` · ${src}` : ""}${reasonHint || ""}`
  );
  return {
    id,
    kind: "plan",
    v51NodeId: "ORCH",
    title: orch.title,
    detail: orch.detail,
    tone: "process",
    dledgerDecisionId: dledgerDecisionId || undefined,
    summaryToken: "ORCH",
  };
}

function buildCapabilityStations(
  idPrefix: string,
  picks: SelectedCapabilityPick[],
  loopTurnId?: string
): RouteStation[] {
  return picks.map((pick, i) => {
    const cap = formatV51CapabilityStation(pick.capabilityId, pick.roleId);
    return {
      id: `${idPrefix}-cap-${i}`,
      kind: "capability",
      v51NodeId: cap.v51NodeId,
      title: cap.title,
      detail: cap.detail,
      tone: "process",
      summaryToken: cap.v51NodeId,
      loopTurnId,
    };
  });
}

/** Session-level trailing stations (trust gate + verdict) appended after normal completion. */
function buildTrailingVerdictStations(facts: TurnRouteFacts): RouteStation[] {
  const stations: RouteStation[] = [];

  const trust = trustCounts(facts);
  if (trust) {
    const allPass = trust.passed === trust.total;
    const groundNote =
      (facts.trustGroundFailedCount ?? 0) > 0
        ? ` · ${facts.trustGroundFailedCount} 项未通过接地门`
        : "";
    const tg = formatV51ControlStation(
      "T_GATE",
      `T_PROV · ${trust.passed}/${trust.total} 通过提交闸${groundNote}`
    );
    stations.push({
      id: `${facts.turnId}-trust`,
      kind: "trust_gate",
      v51NodeId: "T_GATE",
      title: tg.title,
      detail: tg.detail,
      tone: allPass && !(facts.trustGroundFailedCount ?? 0) ? "pass" : "partial",
      summaryToken: "T_GATE",
    });
  }

  const before = facts.goalStatusBefore;
  const after = facts.goalStatusAfter ?? before;
  const beforeLabel = goalStatusUserLabel(before);
  const afterLabel = goalStatusUserLabel(after);
  const changed = before !== after && after != null;
  const notRec = after === "not_recommended";

  const gcov = formatV51ControlStation(
    "GCOV",
    changed
      ? `GOAL 只读写入 · ${beforeLabel} → ${afterLabel}`
      : `GOAL 只读 · 维持 ${afterLabel}`
  );
  stations.push({
    id: `${facts.turnId}-verdict`,
    kind: "verdict",
    v51NodeId: "GCOV",
    title: gcov.title,
    detail: gcov.detail,
    tone: notRec ? "fail" : after === "clear" ? "pass" : "process",
    summaryToken: "GCOV",
  });

  return stations;
}

function terminalStation(facts: TurnRouteFacts): RouteStation {
  const closed =
    isAutonomousClosureReason(facts.closureReason) ||
    facts.goalStatusAfter === "clear" ||
    facts.runtimePhase === "done";
  if (closed) {
    const done = formatV51ControlStation(
      "DONE",
      facts.runtimePhase === "done"
        ? "RV 评审通过 · 交付完成"
        : facts.closureReason === "coverage_sufficient"
        ? "覆盖率合约满足 · 本回合闭环完成"
        : facts.closureReason === "convergence_signal"
        ? "机械收敛 · 本回合闭环完成"
        : "GOAL 已收敛 · 本回合闭环完成"
    );
    return {
      id: `${facts.turnId}-done`,
      kind: "await",
      v51NodeId: "DONE",
      title: done.title,
      detail: done.detail,
      tone: "pass",
      summaryToken: "DONE",
    };
  }
  const awaitDetail =
    facts.closureReason === "await_ready"
      ? "等用户补充就绪度 · 下条消息经 INTAKE 续跑"
      : facts.closureReason === "await_confirm"
      ? "等用户选路线 · 下条消息经 INTAKE 续跑"
      : facts.runtimePhase === "awaiting"
      ? "环上歇脚点 · 下条消息经 INTAKE 续跑"
      : undefined;
  const a = formatV51ControlStation("AWAIT", awaitDetail);
  return {
    id: `${facts.turnId}-await`,
    kind: "await",
    v51NodeId: "AWAIT",
    title: a.title,
    detail: a.detail,
    tone: "pending",
    summaryToken: "AWAIT",
  };
}

/**
 * V5.1 架构树布线：脊柱深度固定；BUS 能力并行叉出；多轮 GCOV→BUDGET / ORCH 回边不叠深度。
 */
function wireTreeTopology(stations: RouteStation[], turnId: string): RouteStation[] {
  const result = stations.map((s) => ({ ...s }));
  const archAnchor = new Map<string, string>();

  let intakeId: string | undefined;
  let staleId: string | undefined;
  let execTailId: string | undefined;
  let currentOrchId: string | undefined;
  let currentRound = 0;

  for (const s of result) {
    const spine = ARCH_SPINE_DEPTH[s.kind] ?? 0;
    s.depth = spine;
    s.lane = 0;
    s.linkKind = s.linkKind ?? "forward";

    if (s.kind === "intake") {
      intakeId = s.id;
      execTailId = s.id;
      if (s.v51NodeId) archAnchor.set(s.v51NodeId, s.id);
      continue;
    }

    if (s.kind === "stale_cascade") {
      staleId = s.id;
      s.parentId = intakeId;
      s.linkKind = "forward";
      execTailId = s.id;
      if (s.v51NodeId) archAnchor.set(s.v51NodeId, s.id);
      continue;
    }

    if (s.kind === "reentry") {
      s.parentId = execTailId;
      s.depth = ARCH_SPINE_DEPTH.reentry!;
      s.lane = 0;
      s.linkKind = "reentry";
      if (s.reentryTargetV51 && archAnchor.has(s.reentryTargetV51)) {
        s.reentryOfStationId = archAnchor.get(s.reentryTargetV51);
      }
      execTailId = s.id;
      continue;
    }

    if (s.kind === "budget_pass" || s.kind === "budget_block") {
      const ri = stationRoundIndex(s);
      const entryParent = staleId ?? intakeId;
      if (ri > 1) {
        s.linkKind = "reentry";
        s.reentryTargetV51 = "BUDGET";
        s.reentryOfStationId = archAnchor.get("BUDGET");
        s.parentId = execTailId;
        s.depth = ARCH_SPINE_DEPTH.budget_pass!;
      } else {
        s.parentId = entryParent;
        s.linkKind = "forward";
        archAnchor.set("BUDGET", s.id);
      }
      execTailId = s.id;
      currentRound = ri;
      currentOrchId = undefined;
      continue;
    }

    if (s.kind === "plan") {
      const ri = stationRoundIndex(s);
      const budgetId = findRoundBudget(result, ri, turnId);
      s.parentId = budgetId ?? execTailId;
      if (ri > 1) {
        s.linkKind = "reentry";
        s.reentryTargetV51 = "ORCH";
        s.reentryOfStationId = archAnchor.get("ORCH");
      } else {
        s.linkKind = "forward";
        archAnchor.set("ORCH", s.id);
      }
      currentOrchId = s.id;
      execTailId = s.id;
      continue;
    }

    if (s.kind === "capability") {
      const ri = stationRoundIndex(s);
      const orchId = findRoundOrch(result, ri, turnId) ?? currentOrchId;
      s.parentId = orchId;
      s.linkKind = "parallel";
      s.depth = ARCH_SPINE_DEPTH.capability!;
      const prior = result.filter(
        (x) =>
          x.kind === "capability" &&
          x.parentId === orchId &&
          result.indexOf(x) < result.indexOf(s)
      );
      s.branchIndex = prior.length;
      s.lane = 1 + (s.branchIndex ?? 0);
      execTailId = s.id;
      continue;
    }

    if (s.kind === "interactive_gate") {
      const lastCap = [...result].reverse().find((x) => x.kind === "capability");
      s.parentId = lastCap?.id ?? execTailId;
      s.linkKind = "forward";
      if (s.v51NodeId) archAnchor.set(s.v51NodeId, s.id);
      execTailId = s.id;
      continue;
    }

    if (s.kind === "trust_gate") {
      const lastOrch = [...result]
        .reverse()
        .find((x) => x.kind === "plan");
      s.parentId = lastOrch?.id ?? currentOrchId ?? execTailId;
      s.linkKind = "forward";
      archAnchor.set("T_GATE", s.id);
      execTailId = s.id;
      continue;
    }

    if (s.kind === "verdict") {
      const trust = result.find((x) => x.kind === "trust_gate");
      s.parentId = trust?.id ?? execTailId;
      s.linkKind = "forward";
      archAnchor.set("GCOV", s.id);
      execTailId = s.id;
      continue;
    }

    if (s.kind === "await") {
      const ig = [...result].reverse().find((x) => x.kind === "interactive_gate");
      const gcov = [...result].reverse().find((x) => x.kind === "verdict");
      const budgetBlock = [...result].reverse().find((x) => x.kind === "budget_block");
      if (ig) {
        s.parentId = ig.id;
      } else if (!gcov && budgetBlock) {
        s.parentId = budgetBlock.id;
        s.detail =
          s.detail ??
          (s.v51NodeId === "AWAIT" ? "架构回边 BUDGET → AWAIT · 超限停泊" : s.detail);
      } else {
        s.parentId = gcov?.id ?? execTailId;
      }
      s.linkKind = "forward";
      execTailId = s.id;
    }
  }

  const capsByParent = new Map<string, RouteStation[]>();
  for (const s of result) {
    if (s.kind !== "capability" || !s.parentId) continue;
    const group = capsByParent.get(s.parentId) || [];
    group.push(s);
    capsByParent.set(s.parentId, group);
  }
  for (const group of capsByParent.values()) {
    group[group.length - 1]!.isLastSibling = true;
  }

  return result;
}

/**
 * Multi-round projection (需求 14.1/14.5/14.6): one planning+reasoning station pair per
 * round, ordered planning₁ → reasoning₁ → … → planningN → reasoningN. A round that
 * terminates re-entry via budget block (`planReason` starts with `BUDGET_EXCEEDED`) or
 * `convergence_signal` reflects the parking reason at that round's position and no further
 * round stations are appended. Pure derive: zero LLM, zero V5SessionState writes.
 */
function deriveMultiRoundRoute(facts: TurnRouteFacts): RouteStation[] {
  const stations = buildIntakeStations(facts);
  const rounds = facts.rounds ?? [];
  let parked: "budget" | "convergence" | null = null;

  for (const round of rounds) {
    const roundBudgetBlocked = String(round.planReason || "").startsWith("BUDGET_EXCEEDED");
    const roundConverged = round.parkReason === "convergence_signal";
    const roundLabel = `第 ${round.roundIndex} 轮`;
    const picks = round.selectedCapabilities || [];

    if (round.roundIndex > 1 && !roundBudgetBlocked && !roundConverged) {
      stations.push(
        buildGcovToBudgetReentry(`${facts.turnId}-r${round.roundIndex}-reentry`, roundLabel)
      );
    }

    if (!roundBudgetBlocked) {
      stations.push(
        buildBudgetPassStation(`${facts.turnId}-r${round.roundIndex}-budget-pass`, roundLabel)
      );
    }

    stations.push(
      buildOrchStation(
        `${facts.turnId}-r${round.roundIndex}-plan`,
        picks,
        round.planSource,
        round.dledgerDecisionId
      )
    );

    if (roundBudgetBlocked) {
      const b = formatV51ControlStation("BUDGET", `${roundLabel} · 超限 · 停泊 partial`);
      stations.push({
        id: `${facts.turnId}-r${round.roundIndex}-budget`,
        kind: "budget_block",
        v51NodeId: "BUDGET",
        title: b.title,
        detail: b.detail,
        tone: "fail",
        summaryToken: "BUDGET",
      });
      parked = "budget";
      break;
    }

    if (roundConverged) {
      const gcov = formatV51ControlStation("GCOV", `${roundLabel} · 机械收敛 · 无需再入 ORCH`);
      stations.push({
        id: `${facts.turnId}-r${round.roundIndex}-verdict`,
        kind: "verdict",
        v51NodeId: "GCOV",
        title: gcov.title,
        detail: gcov.detail,
        tone: "pass",
        summaryToken: "GCOV",
      });
      parked = "convergence";
      break;
    }

    stations.push(
      ...buildCapabilityStations(
        `${facts.turnId}-r${round.roundIndex}`,
        picks,
        round.loopTurnId
      )
    );

    if (isInteractivePark(round.parkReason)) {
      stations.push(
        buildInteractiveGateStation(
          `${facts.turnId}-r${round.roundIndex}`,
          round.parkReason
        )
      );
      break;
    }
  }

  if (parked === null && !isInteractivePark(facts.closureReason)) {
    stations.push(...buildTrailingVerdictStations(facts));
  } else if (isInteractivePark(facts.closureReason) && parked === null) {
    stations.push(buildInteractiveGateStation(facts.turnId, facts.closureReason));
  }

  stations.push(terminalStation(facts));

  return wireTreeTopology(stations, facts.turnId);
}

function deriveSingleRoundRoute(facts: TurnRouteFacts): RouteStation[] {
  const stations: RouteStation[] = [];
  const budgetBlocked = isBudgetBlocked(facts);

  stations.push(...buildIntakeStations(facts));

  const picks = facts.selectedCapabilities || [];
  const reasonHint =
    facts.planSource !== "llm" && facts.planOrchestrateReason
      ? ` · ${facts.planOrchestrateReason}`
      : "";

  if (hasPlanData(facts)) {
    if (!budgetBlocked) {
      stations.push(buildBudgetPassStation(`${facts.turnId}-budget-pass`));
    }
    stations.push(
      buildOrchStation(
        `${facts.turnId}-plan`,
        picks,
        facts.planSource,
        facts.dledgerDecisionId,
        reasonHint
      )
    );
  }

  if (budgetBlocked) {
    const b = formatV51ControlStation("BUDGET", "超限 · 未进入 BUS");
    stations.push({
      id: `${facts.turnId}-budget`,
      kind: "budget_block",
      v51NodeId: "BUDGET",
      title: b.title,
      detail: b.detail,
      tone: "fail",
      summaryToken: "BUDGET",
    });
  } else if (picks.length > 0) {
    stations.push(...buildCapabilityStations(`${facts.turnId}`, picks, facts.turnId));
  }

  if (isInteractivePark(facts.closureReason)) {
    stations.push(buildInteractiveGateStation(facts.turnId, facts.closureReason));
  } else if (!budgetBlocked) {
    stations.push(...buildTrailingVerdictStations(facts));
  }

  stations.push(terminalStation(facts));

  return wireTreeTopology(stations, facts.turnId);
}

/** One-line collapsed summary — same tokens as expanded route (S9-A5). */
export function buildRouteSummary(stations: RouteStation[]): string {
  const tokens = stations
    .map((s) => s.summaryToken)
    .filter(
      (t): t is string =>
        Boolean(t) && t !== "AWAIT" && t !== "DONE" && t !== "INTAKE" && t !== "INTERV"
    );
  const head = stations.find((s) => s.kind === "intake")?.summaryToken || "INTAKE";
  const tail = stations.find((s) => s.kind === "verdict")?.summaryToken;
  const middle = tokens.filter((t) => t !== head && t !== tail);
  const parts = [head, ...middle, ...(tail ? [tail] : [])];
  return `${parts.join(" → ")} ▸`;
}

export function assertRouteCopySanitized(stations: RouteStation[]): void {
  for (const s of stations) {
    const blob = `${s.title} ${s.detail || ""}`;
    if (FORBIDDEN_TERMS.test(blob)) {
      throw new Error(`Route copy contains forbidden term: ${blob}`);
    }
  }
}