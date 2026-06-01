/**
 * autopilot-i18n-consistency — Task 1.1
 *
 * Role label resolver and stage label localizer for the RoleStatusStrip.
 *
 * Design principles:
 * - Pure functions, no side effects, no store access
 * - Graceful fallback: unknown roleId returns raw string unchanged
 * - Extensible: add new entries to ROLE_LABELS as new roles appear
 */

import type { AppLocale } from "@/lib/locale";

// ---------------------------------------------------------------------------
// Role Labels Dictionary
// ---------------------------------------------------------------------------

/**
 * Role ID → localized human-readable label.
 *
 * Keys are the machine identifiers emitted by the backend role system
 * (e.g., `intake-analyst`). Values provide both zh-CN and en-US labels.
 */
export const ROLE_LABELS: Record<string, Record<AppLocale, string>> = {
  // Design-document role identifiers (from requirements spec)
  "intake-analyst": { "zh-CN": "输入分析师", "en-US": "Intake Analyst" },
  "repo-researcher": { "zh-CN": "仓库研究员", "en-US": "Repo Researcher" },
  "route-planner": { "zh-CN": "路线规划师", "en-US": "Route Planner" },
  "spec-curator": { "zh-CN": "规格策展师", "en-US": "Spec Curator" },
  "effect-previewer": { "zh-CN": "效果预演师", "en-US": "Effect Previewer" },
  "prompt-packager": { "zh-CN": "提示词打包师", "en-US": "Prompt Packager" },
  "engineering-operator": {
    "zh-CN": "工程执行员",
    "en-US": "Engineering Operator",
  },
  "review-auditor": { "zh-CN": "评审审计员", "en-US": "Review Auditor" },

  // Real runtime roleIds (from server/routes/blueprint.ts role definitions)
  "role-product-decision": { "zh-CN": "产品决策者", "en-US": "Product Decision Lead" },
  "role-architecture-planner": { "zh-CN": "架构规划师", "en-US": "Architecture Planner" },
  "role-runtime-executor": { "zh-CN": "执行工程师", "en-US": "Runtime Executor" },
  "role-quality-auditor": { "zh-CN": "质量审计员", "en-US": "Quality Auditor" },
  "role-experience-presenter": { "zh-CN": "表现导演", "en-US": "Experience Presenter" },
  "role-memory-curator": { "zh-CN": "记忆管理员", "en-US": "Memory Curator" },

  // Real autopilot job role ids (from role-id-bridge + role timelines).
  // These ids do NOT carry a `role-` prefix, so without explicit entries
  // they would render as raw machine ids in both the right rail and the 3D
  // nameplate. Listing them here makes them KNOWN/canonical so the shared
  // displayLabel shows full human-readable names instead of abbreviations.
  "intake-coordinator": { "zh-CN": "需求协调员", "en-US": "Intake Coordinator" },
  "product-strategist": { "zh-CN": "产品策略师", "en-US": "Product Strategist" },
  "repository-analyst": { "zh-CN": "仓库分析师", "en-US": "Repository Analyst" },
  "spec-architect": { "zh-CN": "规格架构师", "en-US": "Spec Architect" },
  "spec-author": { "zh-CN": "规格作者", "en-US": "Spec Author" },
  "executor-architect": { "zh-CN": "执行架构师", "en-US": "Executor Architect" },
  "runtime-quality-auditor": {
    "zh-CN": "运行时质量审计员",
    "en-US": "Runtime Quality Auditor",
  },
  "repo-engineer": { "zh-CN": "仓库工程师", "en-US": "Repo Engineer" },
  "product-researcher": { "zh-CN": "产品研究员", "en-US": "Product Researcher" },

  // Legacy short-form roleIds (from tests and older event sources)
  planner: { "zh-CN": "规划师", "en-US": "Planner" },
  analyzer: { "zh-CN": "分析师", "en-US": "Analyzer" },
  reviewer: { "zh-CN": "评审员", "en-US": "Reviewer" },
};

/**
 * Resolve a role identifier to a human-readable localized label.
 * Falls back to the raw roleId if no mapping exists.
 */
export function resolveRoleLabel(roleId: string, locale: AppLocale): string {
  const entry = ROLE_LABELS[roleId];
  if (!entry) return roleId;
  return entry[locale] ?? roleId;
}

// ---------------------------------------------------------------------------
// Stage Labels
// ---------------------------------------------------------------------------

/**
 * Locale-aware stage labels. Replaces the previous English-only
 * `STAGE_LABELS: Record<number, string>` in RoleStatusStrip.
 */
const STAGE_LABELS: Record<AppLocale, Record<number, string>> = {
  "zh-CN": {
    0: "阶段 0",
    1: "阶段 1",
    2: "阶段 2",
    3: "阶段 3",
    4: "阶段 4",
    5: "阶段 5",
  },
  "en-US": {
    0: "Stage 0",
    1: "Stage 1",
    2: "Stage 2",
    3: "Stage 3",
    4: "Stage 4",
    5: "Stage 5",
  },
};

/**
 * Resolve a stage index to a localized label.
 * Falls back to a dynamically constructed label for unknown indices.
 */
export function resolveStageLabel(index: number, locale: AppLocale): string {
  const labels = STAGE_LABELS[locale] ?? STAGE_LABELS["en-US"];
  return labels[index] ?? (locale === "zh-CN" ? `阶段 ${index}` : `Stage ${index}`);
}
