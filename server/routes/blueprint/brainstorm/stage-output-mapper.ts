/**
 * @description Stage Output Mapper — maps brainstorm synthesis output to the
 * expected format of each pipeline stage.
 *
 * Structured stages (route_generation, spec_tree, spec_docs) require valid JSON.
 * Text-only stages (effect_preview, prompt_packaging, engineering_handoff) pass
 * through without transformation. On parse failure for structured stages, the
 * mapper signals failure so the Stage Wrapper can degrade to single-agent.
 *
 * @see .kiro/specs/brainstorm-pipeline-hookup/design.md §5
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import type { BrainstormEligibleStage } from "./stage-config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of mapping brainstorm output to a stage-specific format. */
export interface StageOutputMapResult {
  /** Whether the mapping succeeded. */
  success: boolean;
  /** Mapped output string, or null on parse failure. */
  output: string | null;
  /** Error message on parse failure. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Maps brainstorm synthesis output to the expected format of a pipeline stage.
 *
 * Rules:
 * - `route_generation`: parse as JSON, validate it's an object, re-serialize.
 * - `spec_tree`: parse as JSON, validate it's an array, re-serialize.
 * - `spec_docs`: parse as JSON — if valid object with expected doc structure,
 *   re-serialize; otherwise treat as markdown text and pass through.
 * - `effect_preview`: always pass-through text.
 * - `prompt_packaging`: always pass-through text.
 * - `engineering_handoff`: always pass-through text.
 *
 * On parse failure for structured stages:
 * `{ success: false, output: null, error: "..." }`
 *
 * On success:
 * `{ success: true, output: theString }`
 *
 * @param stageId - The target pipeline stage.
 * @param rawOutput - The raw synthesis output string from brainstorm.
 */
export function mapStageOutput(
  stageId: BrainstormEligibleStage,
  rawOutput: string,
): StageOutputMapResult {
  switch (stageId) {
    case "route_generation":
      return parseAsJsonObject(rawOutput, "route_generation");

    case "spec_tree":
      return parseAsJsonArray(rawOutput, "spec_tree");

    case "spec_docs":
      return parseSpecDocs(rawOutput);

    case "effect_preview":
    case "prompt_packaging":
    case "engineering_handoff":
      return { success: true, output: rawOutput };

    default:
      return { success: true, output: rawOutput };
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Attempts to parse raw output as a JSON object (non-null, non-array).
 * Re-serializes on success for downstream consistency.
 */
function parseAsJsonObject(
  raw: string,
  stageId: string,
): StageOutputMapResult {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        success: false,
        output: null,
        error: `${stageId}: expected JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
      };
    }
    return { success: true, output: JSON.stringify(parsed) };
  } catch (e) {
    return {
      success: false,
      output: null,
      error: `${stageId}: invalid JSON — ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Attempts to parse raw output as a JSON array.
 * Re-serializes on success for downstream consistency.
 */
function parseAsJsonArray(
  raw: string,
  stageId: string,
): StageOutputMapResult {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        success: false,
        output: null,
        error: `${stageId}: expected JSON array, got ${typeof parsed}`,
      };
    }
    return { success: true, output: JSON.stringify(parsed) };
  } catch (e) {
    return {
      success: false,
      output: null,
      error: `${stageId}: invalid JSON — ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Handles spec_docs: if valid JSON object with doc-like structure, re-serialize;
 * otherwise treat as markdown text and pass through.
 */
function parseSpecDocs(raw: string): StageOutputMapResult {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      // Valid object — re-serialize for downstream consistency
      return { success: true, output: JSON.stringify(parsed) };
    }
    // Parsed but not an object — treat as text pass-through
    return { success: true, output: raw };
  } catch {
    // Not valid JSON — treat as markdown text and pass through
    return { success: true, output: raw };
  }
}
