/**
 * V5.1 STATUS 状态条 — 借鉴 Autopilot 右栏指标 + Dev 驾驶舱常驻条。
 * 纯派生，只读 sessionState（架构图 STATUS 节点）。
 *
 * 2026-08-27 PR-2：产品六步钟也从这里投影。内部模块 → 步的映射必须落在
 * 本文件（M8），否则 SSE 只是能力 id 和页 sink，钟是假的。
 */

import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { goalStatusUserLabel } from "@shared/blueprint/sliderule-turn-route";
import {
  countGroundedTrustedArtifacts,
  hasGroundedExternalEvidence,
  recentUngroundedEvidenceAttempts,
} from "@shared/blueprint/sliderule-grounding";
import type { SlideRuleExecutorMode } from "./types";
import { projectConclusionBadge } from "./conclusion-badge";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";
import {
  deriveFactoryDecisionView,
  type FactoryDecisionView,
} from "./derive-factory-decision";

/** 墙上钟 v1。8–9 / 2 / 20 不是标定集，禁止写进产品 DOM（KD4）。 */
export const REHEARSAL_WALL_CLOCK_COPY = "大约数分钟，第一页会先出现";

export type RehearsalProductStepId = 1 | 2 | 3 | 4 | 5 | 6;

export type RehearsalProductStepDef = {
  id: RehearsalProductStepId;
  label: string;
  skippable: boolean;
};

/**
 * 产品口径六步。第 1 步默认 skippable：PR-5 短清单从起草 SPEC 起跳，
 * 若不标可跳过，第一格会空转（M8）。
 */
export const REHEARSAL_PRODUCT_STEPS: readonly RehearsalProductStepDef[] = [
  { id: 1, label: "澄清与取证", skippable: true },
  { id: 2, label: "起草 SPEC", skippable: false },
  { id: 3, label: "每页 HTML", skippable: false },
  { id: 4, label: "结构反推", skippable: false },
  { id: 5, label: "权限/工作流/不变式", skippable: false },
  { id: 6, label: "汇合过闸", skippable: false },
];

/** 没拿到步集时的缺省：工厂五格全开。 */
const ALL_FACTORY_STEPS: readonly RehearsalProductStepId[] = [2, 3, 4, 5, 6];

/**
 * 本轮该亮哪几格——**由后端账本算好随 goal 下发，这里不查表**。
 *
 * ⚠ 2026-09-02：这里原本有一张 `PUBLIC_TOOL_TO_STEP`（公开工具 → 步号），
 * 是全前端最后一张翻译表，而且跟账本对不上：
 *
 *     bind      前端 5 / 账本 6          → bind 那 4~10 分钟钟上没有 current
 *     closure   前端 6 / 账本里没这个阶段  → pages-preview 第 6 格永远 pending
 *     semantics 前端没有                  → [spec,pages,structure,bind] 第 5 格整格不画
 *
 * 上一轮把 `bind: 5` 改成 `6`——但**改表不是删表**。`stage_legal` 模块头写着
 * 「正确的抄法是删表」，`session_events` 写着「不许在前端再补一张表」：后端事件
 * 自描述之后，前端再留一份静态映射，逐跳编排一铺开就会再错位一次。
 *
 * 现在步集来自 `goal.productSteps`（`stage_legal.product_steps_for_stages`
 * 按本轮真跑的 stage 算）。拿不到就全开——**老会话没有这个字段，不许因此把格子
 * 画没**；这也是改造前的默认行为。
 */
export function enabledFactorySteps(
  productSteps?: readonly number[] | null
): Set<RehearsalProductStepId> {
  const chosen = (productSteps || [])
    .map(step => Number(step))
    .filter((step): step is RehearsalProductStepId =>
      Number.isInteger(step) && step >= 1 && step <= 6
    );
  return new Set(chosen.length > 0 ? chosen : ALL_FACTORY_STEPS);
}

/**
 * 推演钟不再查内部模块名。步号只认事件上的 `productStep`
 * （stage_legal.describe / session_events.envelope）。
 * 删掉 REHEARSAL_MODULE_TO_STEP / EVENT_ALIASES：那就是翻译表。
 */

export type RehearsalClockCursor = {
  currentStep: RehearsalProductStepId | null;
  sawStep1: boolean;
  receivedMappedEvent: boolean;
  /** 真正接到过映射事件的步。Math.max 跳步时，没在这里的格只能是 skipped。 */
  seenSteps: readonly RehearsalProductStepId[];
};

export type RehearsalStepStatus = "pending" | "current" | "done" | "skipped";

export type RehearsalClockStepView = RehearsalProductStepDef & {
  status: RehearsalStepStatus;
};

export type RehearsalClockView = {
  currentStep: RehearsalProductStepId | null;
  currentLabel: string | null;
  steps: RehearsalClockStepView[];
  wallClockCopy: string;
};

export type ContextHudFacts = {
  /** 闸过的证据条数。缺 publishClosure / 缺字段 = 0（fail-closed）。 */
  gatedEvidenceCount: number;
  /** 只累加 costLedger source="server"。估数 / manual 不进事实列（fail-open）。 */
  narrativeTokens: number;
  /** 没有 server 行时 token 列画「—」，不许把缺账报成 0。 */
  hasServerTokenFacts: boolean;
};

export function idleRehearsalCursor(): RehearsalClockCursor {
  return {
    currentStep: null,
    sawStep1: false,
    receivedMappedEvent: false,
    seenSteps: [],
  };
}

/** 默认 rehearse 从第 2 步起跳，第 1 步不亮成 current。 */
export function startRehearsalCursor(): RehearsalClockCursor {
  return {
    currentStep: 2,
    sawStep1: false,
    receivedMappedEvent: false,
    seenSteps: [],
  };
}

function rememberSeen(
  seen: readonly RehearsalProductStepId[] | undefined,
  step: RehearsalProductStepId
): RehearsalProductStepId[] {
  if (seen && seen.includes(step)) return seen as RehearsalProductStepId[];
  return [...(seen || []), step];
}

export function mapInternalEventToProductStep(
  _event: string | null | undefined
): RehearsalProductStepId | null {
  // 故意不查表。事件没带 productStep 就不要猜。
  return null;
}

function asProductStep(raw: number | null | undefined): RehearsalProductStepId | null {
  if (raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5 || raw === 6) {
    return raw;
  }
  return null;
}

export function advanceRehearsalCursor(
  cursor: RehearsalClockCursor,
  event: string | null | undefined,
  productStep?: number | null
): RehearsalClockCursor {
  const step =
    asProductStep(productStep) || mapInternalEventToProductStep(event);
  if (!step) return cursor;
  const seenSteps = rememberSeen(cursor.seenSteps, step);
  if (step === 1) {
    const keepHigher =
      cursor.receivedMappedEvent &&
      cursor.currentStep != null &&
      cursor.currentStep > 1;
    return {
      currentStep: keepHigher ? cursor.currentStep : 1,
      sawStep1: true,
      receivedMappedEvent: true,
      seenSteps,
    };
  }
  const current: RehearsalProductStepId =
    cursor.currentStep == null
      ? step
      : ((Math.max(cursor.currentStep, step) as RehearsalProductStepId));
  return {
    currentStep: current,
    sawStep1: cursor.sawStep1,
    receivedMappedEvent: true,
    seenSteps,
  };
}

export function buildRehearsalClockView(
  cursor: RehearsalClockCursor,
  opts: {
    isRunning: boolean;
    publishClosed?: boolean;
    /** 本轮该亮哪几格。来自 goal.productSteps（后端账本算），不是工具名。 */
    productSteps?: readonly number[] | null;
  }
): RehearsalClockView {
  const current = cursor.currentStep;
  const seen = new Set(cursor.seenSteps || []);
  const enabled = enabledFactorySteps(opts.productSteps);
  const mapped: RehearsalClockStepView[] = REHEARSAL_PRODUCT_STEPS.map((def) => {
    let status: RehearsalStepStatus = "pending";
    const toolSkipped = def.id >= 2 && !enabled.has(def.id);
    if (toolSkipped) {
      return { ...def, skippable: true, status: "skipped" as RehearsalStepStatus };
    }
    if (def.id === 1) {
      if (cursor.sawStep1) {
        status = opts.isRunning && current === 1 ? "current" : "done";
      } else if (current != null && current >= 2) {
        // 默认 skippable：停跑后也保持 skipped。不许 isRunning 一翻 false
        // 第一格又变 pending（用户点停止，取证格「活过来」）。
        status = "skipped";
      } else {
        status = "pending";
      }
    } else if (opts.isRunning && current === def.id) {
      status = "current";
    } else if (seen.has(def.id) || (!opts.isRunning && current === def.id)) {
      // 停跑后没有 current。默认起点（current=2 还没事件）也算到过。
      status = "done";
    } else if (current != null && current > def.id) {
      // ⚠ 不能凭 Math.max 把中间格涂成 done。闭环末尾的 dataModel
      // skill_start 映射到第 6 步；精修/复用没跑 spec-first 时 3–5 没发生。
      status = "skipped";
    }
    return { ...def, status };
  });
  // 抄 grok：进度只画选中的步。skipped 留在状态机里，钟上不占格——
  // 永远六格就是死日历。
  const steps = mapped.filter((s) => s.status !== "skipped");
  const live = steps.find((s) => s.status === "current");
  return {
    currentStep: current,
    currentLabel: live?.label ?? null,
    steps,
    wallClockCopy:
      opts.isRunning && current != null ? REHEARSAL_WALL_CLOCK_COPY : "",
  };
}

/** 钟格只在真正点火后出现。跑着但 currentStep 空 = 廉价回合，不许铺六格日历。 */
export function rehearsalClockShowSteps(clock: RehearsalClockView): boolean {
  return (
    clock.currentStep != null ||
    clock.steps.some(step => step.status !== "pending")
  );
}

export function deriveContextHudFacts(
  state: V5SessionState,
  publishClosure?: PublishClosureSummary | null
): ContextHudFacts {
  // 证据列 fail-closed：没有闭环摘要就当 0。控制面 search_evidence 不在这里。
  const gatedEvidenceCount = Number(publishClosure?.evidencePresentCount ?? 0);
  const ledger = state.costLedger || [];
  let hasServerTokenFacts = false;
  const narrativeTokens = ledger.reduce((sum, row) => {
    if (row.source !== "server") return sum;
    hasServerTokenFacts = true;
    return sum + Number(row.estimatedTokens ?? 0);
  }, 0);
  return { gatedEvidenceCount, narrativeTokens, hasServerTokenFacts };
}

export type StatusBarFacts = {
  goalSnippet: string;
  conclusionLabel: string;
  conclusionClassName: string;
  turnCount: number;
  capabilityRunCount: number;
  openGapCount: number;
  phaseLabel: string;
  parkHint: string | null;
  llmRunCount: number;
  trustedArtifactCount: number;
  driveLoopCount: number;
  dataReady: boolean;
  /** User-facing: evidence grounding status (hides G-GROUND mechanism per M7). */
  groundingLabel: string;
  groundingClassName: string;
  groundingHint: string | null;
  groundedEvidenceCount: number;
  /** Capability executor seam (pilot vs server-llm). */
  executorModeLabel: string;
  executorModeClassName: string;
  /** Python degraded/timeout/error states from orchestrate-plan (task 16) surfaced in status for UI visibility. */
  planDegraded?: boolean;
  planError?: string | null;
  publishClosureLabel?: string;
  publishClosureClassName?: string;
  publishClosureHint?: string;
  publishClosureFailClosed?: boolean;
  rehearsalClock: RehearsalClockView;
  hud: ContextHudFacts;
  /** 最近一次工厂选材。没有账本条目就是 null，不许伪造。 */
  factoryDecision: FactoryDecisionView | null;
};

export function deriveStatusBarFacts(
  state: V5SessionState,
  opts: {
    turnCount: number;
    isRunning: boolean;
    driveLoopCount?: number;
    closureReason?: string | null;
    /** 沉浸画布：不展示「停泊/歇脚」文案，架构图无 AWAIT 歇脚点。 */
    immersion?: boolean;
    executorMode?: SlideRuleExecutorMode;
    /** From Python-owned plan when degraded (timeout etc) */
    planDegraded?: boolean;
    planError?: string | null;
    publishClosure?: PublishClosureSummary | null;
    rehearsalCursor?: RehearsalClockCursor;
  }
): StatusBarFacts {
  const badge = projectConclusionBadge(state);
  const goalSnippet = (state.goal?.text || "").trim().slice(0, 48) || "—";
  const openGapCount = (state.coverageGaps || []).filter((g) => g.status === "open").length;
  const runs = state.capabilityRuns || [];
  const llmRunCount = runs.filter(
    (r) =>
      (r as { provenance?: string }).provenance === "llm" ||
      (r as { source?: string }).source === "llm"
  ).length;

  const stale = new Set(state.staleArtifactIds || []);
  const trustedArtifactCount = (state.artifacts || []).filter(
    (a) =>
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") && !stale.has(a.id)
  ).length;
  const driveLoopCount =
    opts.driveLoopCount ??
    new Set((state.capabilityRuns || []).map((r) => r.turnId).filter(Boolean)).size;
  const publishClosureClosed = !!(
    opts.publishClosure &&
    !opts.publishClosure.blocked &&
    opts.publishClosure.skillCount > 0 &&
    opts.publishClosure.evidencePresentCount >= opts.publishClosure.skillCount
  );

  const phase = state.runtimePhase || "idle";
  let phaseLabel: string;
  if (phase === "orchestrating" || opts.isRunning) {
    phaseLabel = "推演中";
  } else if (opts.immersion) {
    if (phase === "failed") phaseLabel = "失败";
    else if (openGapCount > 0) phaseLabel = "待补缺口";
    else if (state.goal?.status === "clear") phaseLabel = "已收敛";
    else phaseLabel = "就绪";
  } else if (phase === "awaiting") {
    phaseLabel = "停泊";
  } else if (phase === "failed") {
    phaseLabel = state.escalated ? "转人工" : "失败";
  } else if (phase === "done" || state.deliveryPhase === "shipped") {
    phaseLabel = "已交付";
  } else {
    phaseLabel = "空闲";
  }

  if (publishClosureClosed && !opts.isRunning) {
    phaseLabel = "发布闭环完成";
  }

  const awaitDetail = state.awaitDetail?.trim();
  const awaitReason = state.awaitReason;

  let parkHint: string | null = null;
  if (opts.immersion) {
    if (opts.isRunning) {
      parkHint = "架构节点推进中";
    } else if (awaitDetail) {
      parkHint = awaitDetail;
    } else if (awaitReason === "confirm") {
      parkHint = "等待用户确认";
    } else if (awaitReason === "ready") {
      parkHint = "有待回答问题";
    } else if (openGapCount > 0) {
      parkHint = `待补 ${openGapCount} 项缺口`;
    } else {
      parkHint = null;
    }
  } else if (opts.isRunning) {
    parkHint = "推演中 · 自主推进";
  } else if (opts.closureReason === "await_ready") {
    parkHint = state.awaitDetail || "等待用户补充就绪信息";
  } else if (opts.closureReason === "await_confirm") {
    parkHint = state.awaitDetail || "等待用户确认路线选择";
  } else if (opts.closureReason) {
    parkHint = `已停 · ${opts.closureReason}`; // M7: hide raw in default, but keep for now; audit will show raw
  } else if (phase === "awaiting") {
    if (awaitDetail) {
      parkHint = awaitDetail;
    } else if (awaitReason === "confirm") {
      parkHint = "等待用户确认 · 禁止 LLM 代答";
    } else if (awaitReason === "ready") {
      parkHint = "有待回答问题";
    } else if (awaitReason === "coverage") {
      parkHint = "覆盖率未满足";
    } else if (awaitReason === "budget") {
      parkHint = "预算超限 · 部分停泊";
    } else if (state.goal?.status === "clear") {
      parkHint = "闭环完成 · 可续跑或质疑";
    } else if (openGapCount > 0) {
      parkHint = `${openGapCount} 个覆盖率缺口 · 下条消息可再入 ORCH`;
    } else {
      parkHint = "环上歇脚 · 下条消息经 INTAKE 续跑";
    }
  } else if (openGapCount > 0) {
    parkHint = `待补 ${openGapCount} 项缺口`;
  }

  if (publishClosureClosed && !opts.isRunning) {
    parkHint = "6/6 Skill 证据已闭环，可查看交付物或继续细化";
  }

  const dataReady =
    publishClosureClosed ||
    (trustedArtifactCount > 0 &&
      openGapCount === 0 &&
      (phase === "awaiting" || state.goal?.status === "clear"));

  const groundedEvidenceCount = countGroundedTrustedArtifacts(state);
  const sessionGrounded = hasGroundedExternalEvidence(state);
  const ungroundedAttempts = recentUngroundedEvidenceAttempts(state, 6);
  const gcovGroundingOk = state.coverageGate?.reason?.includes("G-GROUND: true") ?? false;

  let groundingLabel: string;
  let groundingClassName: string;
  let groundingHint: string | null = null;

  if (sessionGrounded || groundedEvidenceCount > 0) {
    groundingLabel = `接地 ${groundedEvidenceCount}`;
    groundingClassName =
      "bg-emerald-50 text-emerald-800 ring-emerald-200/80";
  } else if (ungroundedAttempts > 0) {
    groundingLabel = "接地 degraded";
    groundingClassName = "bg-amber-50 text-amber-800 ring-amber-200/80";
    groundingHint = "外部证据未接地 · 本轮为规则推演";
  } else if (state.coverageGate && !gcovGroundingOk) {
    groundingLabel = "待外部接地";
    groundingClassName = "bg-[#e9edf2] text-stone-600 ring-[#e5e7eb]/80";
    groundingHint = "证据未完全落地 · 需补充外部来源";
  } else {
    groundingLabel = "未接地";
    groundingClassName = "bg-[#e9edf2] text-stone-500 ring-[#e5e7eb]/70";
  }

  const executorMode = opts.executorMode ?? "server-llm";
  const executorModeLabel =
    executorMode === "demo"
      ? "demo · 模拟数据"
      : executorMode === "server-llm"
      ? "executor: server-llm"
      : executorMode === "pilot"
      ? "executor: pilot"
      : executorMode === "browser-llm"
      ? "executor: browser-llm (BYOK, production)"
      : "executor: default";
  const executorModeClassName =
    executorMode === "demo"
      ? "bg-amber-50 text-amber-900 ring-amber-200/80"
      : executorMode === "server-llm"
      ? "bg-sky-50 text-sky-800 ring-sky-200/80"
      : executorMode === "browser-llm"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200/80"
      : "bg-[#e6f4ff] text-[#1677ff] ring-[#EBCEC0]/80";

  const publishClosure = opts.publishClosure;
  const publishClosureLabel = publishClosure
    ? publishClosure.blocked
      ? "publish blocked"
      : "publish closed"
    : undefined;
  const publishClosureClassName = publishClosure
    ? publishClosure.blocked
      ? "bg-rose-50 text-rose-800 ring-rose-200/80"
      : "bg-emerald-50 text-emerald-800 ring-emerald-200/80"
    : undefined;
  const publishClosureHint = publishClosure
    ? [
        `${publishClosure.evidencePresentCount}/${publishClosure.skillCount} evidence`,
        publishClosure.versionPinsChecked ? "pins checked" : "pins missing",
        `hard ${publishClosure.tierCounts.hard_blocker}`,
        `warn ${publishClosure.tierCounts.warning}`,
        `info ${publishClosure.tierCounts.info}`,
      ].join(" - ")
    : undefined;
  const publishClosureFailClosed = !!(
    publishClosure?.blocked &&
    (!Array.isArray(publishClosure.topBlockers) || publishClosure.topBlockers.length === 0)
  );

  const goalProductSteps = Array.isArray(
    (state.goal as { productSteps?: unknown } | undefined)?.productSteps
  )
    ? ((state.goal as { productSteps: unknown[] }).productSteps as number[])
    : undefined;
  const rehearsalClock = buildRehearsalClockView(
    opts.rehearsalCursor ?? idleRehearsalCursor(),
    {
      isRunning: opts.isRunning,
      publishClosed: publishClosureClosed,
      productSteps: goalProductSteps,
    }
  );
  const hud = deriveContextHudFacts(state, opts.publishClosure);

  return {
    goalSnippet,
    conclusionLabel: publishClosureClosed ? "已闭环" : badge.label,
    conclusionClassName: publishClosureClosed
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : badge.className,
    turnCount: opts.turnCount,
    capabilityRunCount: runs.length,
    openGapCount,
    phaseLabel,
    parkHint,
    llmRunCount: llmRunCount || runs.filter((r) => String(r.capabilityId || "").length > 0).length,
    trustedArtifactCount,
    driveLoopCount,
    dataReady,
    groundingLabel,
    groundingClassName,
    groundingHint,
    groundedEvidenceCount,
    executorModeLabel,
    executorModeClassName,
    publishClosureLabel,
    publishClosureClassName,
    publishClosureHint,
    publishClosureFailClosed,
    // surfaced for Python planner_* degraded visibility (see useSlideRuleSession + orchestrator pass-through)
    planDegraded: !!opts.planDegraded,
    planError: opts.planError ?? null,
    rehearsalClock,
    hud,
    factoryDecision: deriveFactoryDecisionView(state),
  };
}

export function statusGoalStatusLabel(state: V5SessionState): string {
  return goalStatusUserLabel(state.goal?.status);
}
