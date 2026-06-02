/**
 * @description Per-stage configuration resolver for brainstorm Decision Gate.
 *
 * Resolves environment variables to determine whether brainstorm is enabled
 * for a given pipeline stage. Pure synchronous function — no LLM calls, no
 * network I/O. All reads come from process.env (or an injected env object).
 *
 * @see .kiro/specs/brainstorm-pipeline-hookup/design.md §1
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The 6 pipeline stages eligible for brainstorm decision gating. */
export type BrainstormEligibleStage =
  | "route_generation"
  | "spec_tree"
  | "spec_docs"
  | "effect_preview"
  | "prompt_packaging"
  | "engineering_handoff";

/** Resolved brainstorm configuration. */
export interface BrainstormStageConfig {
  masterEnabled: boolean;
  perStage: Record<BrainstormEligibleStage, boolean>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Mapping from eligible stage to its corresponding environment variable.
 * Each per-stage var must equal exactly `"true"` (case-sensitive) to be enabled.
 */
const STAGE_ENV_MAP: Record<BrainstormEligibleStage, string> = {
  route_generation: "BRAINSTORM_STAGE_ROUTE_GENERATION_ENABLED",
  spec_tree: "BRAINSTORM_STAGE_SPEC_TREE_ENABLED",
  spec_docs: "BRAINSTORM_STAGE_SPEC_DOCS_ENABLED",
  effect_preview: "BRAINSTORM_STAGE_EFFECT_PREVIEW_ENABLED",
  prompt_packaging: "BRAINSTORM_STAGE_PROMPT_PACKAGING_ENABLED",
  engineering_handoff: "BRAINSTORM_STAGE_ENGINEERING_HANDOFF_ENABLED",
};

/** All eligible stage identifiers. */
export const ELIGIBLE_STAGES: BrainstormEligibleStage[] = Object.keys(
  STAGE_ENV_MAP,
) as BrainstormEligibleStage[];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves brainstorm configuration from environment variables.
 *
 * Master switch: `BLUEPRINT_BRAINSTORM_ENABLED` must equal `"true"`.
 * Per-stage: `BRAINSTORM_STAGE_{STAGE}_ENABLED` must equal `"true"`.
 *
 * @param env - Optional env object for testability. Defaults to `process.env`.
 * @returns Resolved configuration with master and per-stage booleans.
 */
export function resolveStageConfig(
  env: NodeJS.ProcessEnv = process.env,
): BrainstormStageConfig {
  const masterEnabled = env.BLUEPRINT_BRAINSTORM_ENABLED === "true";

  const perStage = {} as Record<BrainstormEligibleStage, boolean>;
  for (const stage of ELIGIBLE_STAGES) {
    const envVar = STAGE_ENV_MAP[stage];
    perStage[stage] = env[envVar] === "true";
  }

  return { masterEnabled, perStage };
}

/**
 * Checks whether brainstorm is enabled for a specific stage.
 *
 * Returns `true` only when BOTH the master switch AND the per-stage switch
 * are set to exactly `"true"`. This is a logical AND — either switch being
 * off disables brainstorm for the stage.
 *
 * @param stageId - The pipeline stage to check.
 * @param env - Optional env object for testability. Defaults to `process.env`.
 */
export function isStageEnabled(
  stageId: BrainstormEligibleStage,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const config = resolveStageConfig(env);
  return config.masterEnabled && config.perStage[stageId];
}
