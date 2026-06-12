/**
 * P0 · G_READY / G_CONFIRM — mechanical human-wait gates (v5.1).
 * Pure functions: no STATE writes; runtime parks at AWAIT when park=true.
 */

import type { V5CapabilityId } from "./contracts.js";
import type { V5SessionState } from "./v5-reasoning-state.js";

export type InteractiveGateKind = "ready" | "confirm";

export type InteractiveGateVerdict = {
  park: boolean;
  gate?: InteractiveGateKind;
  detail?: string;
};

/** Capabilities that surface blocking questions — must park G_READY, not LLM self-answer. */
const READINESS_CLARIFICATION_CAPS: ReadonlySet<V5CapabilityId> = new Set([
  "question.expand",
  "gap.ask",
  "intent.clarify",
]);

/** Goal too thin to plan (S11: 「做一个系统」). */
export function isVagueGoal(goalText: string): boolean {
  const t = goalText.trim();
  if (!t) return true;
  if (/^(做一个|做个|搞一个|设计一个|开发一个).{0,12}(系统|工具|产品|方案|平台)?[。.]?$/.test(t)) {
    return true;
  }
  // Ultra-thin goals with no domain anchor (S11: 「做一个系统」class).
  if (t.length < 10 && !/权限|RBAC|企业|用户|数据|安全|审计|合规/.test(t)) {
    return true;
  }
  return false;
}

export function openBlockingGapCount(state: V5SessionState): number {
  const contract = state.coverageContract as { blockingGapIds?: string[] } | undefined;
  const blocking = new Set(contract?.blockingGapIds || []);
  return (state.coverageGaps || []).filter(
    (g) => g.status === "open" && (blocking.size === 0 || blocking.has(g.id))
  ).length;
}

/** User message materially supplements readiness (not LLM self-answer). */
export function userClearsReadiness(userText: string, state: V5SessionState): boolean {
  const t = userText.trim();
  if (t.length < 14) return false;
  if (
    /面向|RBAC|权限|用户群|场景|企业|内部|范围|约束|目标|受众|部署|合规|边界|补充|明确/.test(t)
  ) {
    return true;
  }
  return openBlockingGapCount(state) === 0 && t.length >= 18;
}

/** User explicitly picks a route branch (S12). */
export function userPicksRoute(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  return /选(择)?\s*方案|方案\s*[ABCabc123一二三四]|路线\s*[ABCabc12]|选\s*[ABCabc12]|采用|就用|倾向/.test(
    t
  );
}

/** User rejects compared routes and asks to regenerate (S12 → C_RTCMP). */
export function userRejectsRouteSelection(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  return /都不行|重新(出|生成|对比)|退回|换一(条|种)|不满意/.test(t);
}

/** User picks or rejects a route (S12). */
export function userExpressesRouteSelection(userText: string): boolean {
  return userPicksRoute(userText) || userRejectsRouteSelection(userText);
}

/**
 * G_READY — after clarification capabilities when goal still not plannable.
 * Must park AWAIT; forbid LLM auto-confirm (no synthetic user reply).
 */
export function evaluateReadinessGateAfterCommit(
  state: V5SessionState,
  ctx: { capabilityId: V5CapabilityId; turnUserText: string }
): InteractiveGateVerdict {
  if (!READINESS_CLARIFICATION_CAPS.has(ctx.capabilityId)) {
    return { park: false };
  }
  const openGaps = openBlockingGapCount(state);
  const vague = isVagueGoal(state.goal?.text || "");
  const needsRefine = state.goal?.status === "needs_refinement";
  if (!openGaps && !vague && !needsRefine) {
    return { park: false };
  }
  if (userClearsReadiness(ctx.turnUserText, state)) {
    return { park: false };
  }
  const parts: string[] = [];
  if (vague) parts.push("目标过粗");
  if (openGaps > 0) parts.push(`${openGaps} 项阻塞缺口待补`);
  if (needsRefine) parts.push("结论状态需细化");
  return {
    park: true,
    gate: "ready",
    detail: `就绪度不足 · ${parts.join(" · ")} · 请补充后从 INTAKE 续跑`,
  };
}

/**
 * G_CONFIRM — after route.compare when user has not chosen a branch.
 */
export function evaluateConfirmGateAfterCommit(
  state: V5SessionState,
  ctx: { capabilityId: V5CapabilityId; turnUserText: string }
): InteractiveGateVerdict {
  if (ctx.capabilityId !== "route.compare") {
    return { park: false };
  }
  if (userExpressesRouteSelection(ctx.turnUserText)) {
    return { park: false };
  }
  const hasRouteArtifacts = (state.artifacts || []).some(
    (a) =>
      a.producedBy?.capabilityId === "route.generate" ||
      a.producedBy?.capabilityId === "route.compare"
  );
  if (!hasRouteArtifacts) {
    return { park: false };
  }
  return {
    park: true,
    gate: "confirm",
    detail: "路线已对比 · 请选择方案或说明调整方向（禁止 LLM 代答确认）",
  };
}

export function evaluateInteractiveGateAfterCommit(
  state: V5SessionState,
  ctx: { capabilityId: V5CapabilityId; turnUserText: string; committed: boolean }
): InteractiveGateVerdict {
  if (!ctx.committed) return { park: false };
  const confirm = evaluateConfirmGateAfterCommit(state, ctx);
  if (confirm.park) return confirm;
  return evaluateReadinessGateAfterCommit(state, ctx);
}