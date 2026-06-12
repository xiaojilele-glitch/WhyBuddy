/**
 * V5.1 STATUS 状态条 — 借鉴 Autopilot 右栏指标 + Dev 驾驶舱常驻条。
 * 纯派生，只读 sessionState（架构图 STATUS 节点）。
 */

import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { goalStatusUserLabel } from "@shared/blueprint/whybuddy-turn-route";
import {
  countGroundedTrustedArtifacts,
  hasGroundedExternalEvidence,
  recentUngroundedEvidenceAttempts,
} from "@shared/blueprint/whybuddy-grounding";
import type { WhyBuddyExecutorMode } from "./types";
import { projectConclusionBadge } from "./conclusion-badge";

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
    executorMode?: WhyBuddyExecutorMode;
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

  const dataReady =
    trustedArtifactCount > 0 &&
    openGapCount === 0 &&
    (phase === "awaiting" || state.goal?.status === "clear");

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
    groundingClassName = "bg-slate-100 text-slate-600 ring-slate-200/80";
    groundingHint = "证据未完全落地 · 需补充外部来源";
  } else {
    groundingLabel = "未接地";
    groundingClassName = "bg-slate-100 text-slate-500 ring-slate-200/70";
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
      : "bg-violet-50 text-violet-800 ring-violet-200/80";

  return {
    goalSnippet,
    conclusionLabel: badge.label,
    conclusionClassName: badge.className,
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
  };
}

export function statusGoalStatusLabel(state: V5SessionState): string {
  return goalStatusUserLabel(state.goal?.status);
}