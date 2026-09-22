import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { pickMainArtifactByKind } from "@shared/blueprint/sliderule-main-artifact";
import { mapArtifactsToWhyArtifacts } from "./ui-capability-executor";
import type { UiTurn, WhyArtifact } from "./types";

/**
 * `turn.main` —— 一轮的「主产物」。它不是展示字段，是**质疑按钮的渲染守卫**：
 * `SlideRule.tsx:195 / :654` 都写着 `{turn.main && …质疑…}`，main 为 null
 * 这两块整个不渲染。
 *
 * ⚠ 2026-08-27 审查真机逮到：产品面 window.prompt 已删、作曲家预填已实现、
 *   PR-1 的单测全绿——但用户点不到质疑。两个真实会话的 DOM 实测：
 *
 *     sliderule-rerun-turn      6   ← 同一块 JSX，渲染了（守卫是 turn.user）
 *     sliderule-repair-gaps     1   ← 同一块 JSX，渲染了
 *     sliderule-challenge-turn  0   ← 没有（守卫是 turn.main）
 *     全页 innerHTML 含「质疑」      false
 *
 *   成因：`main` 只在**当场跑那一轮**由 useSlideRuleSession 赋值，而
 *   derive-persisted-turn 重建轮次时写死 `main: null`。于是质疑入口只在
 *   生成它的那个标签页存在，刷新 / 重开会话就没了。
 *
 * 本模块的存在理由是**只留一份实现**（Claude.md §4）：实时轮和重建轮必须
 * 用同一条选取规则和同一条 realLlm 判定，否则「同一件事两处实现，改一条
 * 等于一半不生效」会以另一种形态复发——比如实时轮认 report、重建轮认
 * evidence，同一轮刷新前后质疑的对象不是同一个产物。
 */
export function pickMainArtifact(committed: WhyArtifact[]): UiTurn["main"] {
  const art = pickMainArtifactByKind(committed);
  if (!art) return null;
  return {
    artifactId: art.id,
    kind: art.kind,
    realLlm: Boolean(art.realLlm),
  };
}

/**
 * 持久化里 `artifacts[]` **自己不带 turnId**（真机实测：全是 `turnId=None`），
 * 归属只存在于 `capabilityRuns[].outputs`。所以重建侧要拿「本轮产物」，
 * 只能从 runs 反查，不能按 artifact 上的字段筛。
 */
export function artifactIdsFromRuns(
  runs: Array<{ outputs?: unknown }> | null | undefined
): string[] {
  const out: string[] = [];
  for (const run of runs || []) {
    const outputs = run?.outputs;
    if (!Array.isArray(outputs)) continue;
    for (const id of outputs) {
      if (typeof id === "string" && id) out.push(id);
    }
  }
  return out;
}

/**
 * runs → 产物 id → WhyArtifact → main。
 *
 * 走 `mapArtifactsToWhyArtifacts` 而不是自己读 `state.artifacts`：realLlm 的
 * 判定（`isExternalProvenance(...) || "llm" || "llm_fallback"`）和 stale →
 * untrusted 的降级都在那一份里，抄一遍就是又一个「成对的东西只改一半」。
 */
export function mainFromRuns(
  state: V5SessionState,
  runs: Array<{ outputs?: unknown }> | null | undefined
): UiTurn["main"] {
  const ids = artifactIdsFromRuns(runs);
  if (ids.length === 0) return null;
  return pickMainArtifact(mapArtifactsToWhyArtifacts(state, ids));
}
