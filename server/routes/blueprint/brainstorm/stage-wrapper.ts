/**
 * @description Stage Wrapper — wraps a pipeline stage with brainstorm decision gating.
 *
 * This is the core integration module that ties the brainstorm subsystem to the
 * real autopilot pipeline. It checks per-stage configuration, assembles adapters,
 * invokes `executeStageWithBrainstorm()`, maps the output to stage format, and
 * degrades gracefully to single-agent on any failure.
 *
 * Key invariant: this wrapper NEVER throws. Any exception triggers fallback to
 * the original single-agent handler.
 *
 * @see .kiro/specs/brainstorm-pipeline-hookup/design.md §4
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.4
 */

import type { BrainstormEligibleStage } from "./stage-config.js";
import type { BrainstormServiceContext, StageContext } from "./pipeline-integration.js";
import type { BlueprintLlmBridge } from "./llm-adapter.js";

import { isStageEnabled } from "./stage-config.js";
import { createLlmCallerAdapter } from "./llm-adapter.js";
import { createEventEmitterAdapter } from "./event-emitter-adapter.js";
import { executeStageWithBrainstorm } from "./pipeline-integration.js";
import { mapStageOutput } from "./stage-output-mapper.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for wrapping a pipeline stage with brainstorm decision gating.
 */
export interface StageWrapperOptions {
  /** A minimal subset of BlueprintServiceContext needed by the wrapper */
  brainstormContext: BrainstormServiceContext | null;
  /** LLM bridge for brainstorm subsystem calls */
  llm: BlueprintLlmBridge;
  /** Event bus for emitting brainstorm lifecycle events */
  eventBus: { emit(event: Record<string, unknown>): void };
  /** Logger for debug and warning messages */
  logger: {
    warn(msg: string, meta?: Record<string, unknown>): void;
    debug?(msg: string, meta?: Record<string, unknown>): void;
  };
  /** Current blueprint job ID */
  jobId: string;
  /** The pipeline stage being executed */
  stageId: BrainstormEligibleStage;
  /** Human-readable description of the stage */
  stageDescription: string;
  /** Current job status for event metadata */
  jobStatus?: string;
  /** Project ID for event metadata */
  projectId?: string;
  /** Summaries from prior completed stages */
  previousStageOutputs?: string[];
  /** Currently degraded capability bridges */
  degradedBridges?: string[];
  /** The original single-agent handler that produces stage output */
  singleAgentFn: () => Promise<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wraps a pipeline stage with brainstorm decision gating.
 * Returns the stage output string (same format as singleAgentFn return).
 *
 * Algorithm:
 * 1. Check isStageEnabled(stageId) — if false, run singleAgentFn directly (log debug)
 * 2. Check brainstormContext — if null, run singleAgentFn directly (log debug)
 * 3. Build StageContext from options
 * 4. Create LLM adapter via createLlmCallerAdapter(options.llm)
 * 5. Create Event adapter via createEventEmitterAdapter({...})
 * 6. Call executeStageWithBrainstorm(stageCtx, brainstormContext, llmCaller, emitEvent, singleAgentFn)
 * 7. If result.type === "brainstorm":
 *    a. Call mapStageOutput(stageId, result.output)
 *    b. If mapping succeeds → return mapped output
 *    c. If mapping fails → emit brainstorm.degraded event, run singleAgentFn
 * 8. If result.type === "single-agent":
 *    → return result.output directly
 * 9. Top-level try/catch wrapping steps 3-8:
 *    On ANY exception → log warn, run singleAgentFn, return its result
 */
export async function wrapStageWithBrainstorm(
  options: StageWrapperOptions,
): Promise<string> {
  const {
    brainstormContext,
    llm,
    eventBus,
    logger,
    jobId,
    stageId,
    stageDescription,
    jobStatus,
    projectId,
    previousStageOutputs,
    degradedBridges,
    singleAgentFn,
  } = options;

  // Step 1: Check per-stage config
  if (!isStageEnabled(stageId)) {
    logger.debug?.(
      `[brainstorm] Stage "${stageId}" is disabled — skipping brainstorm, running single-agent`,
      { jobId, stageId },
    );
    return singleAgentFn();
  }

  // Step 2: Check brainstormContext availability
  if (!brainstormContext) {
    logger.debug?.(
      `[brainstorm] brainstormContext is null — skipping brainstorm, running single-agent`,
      { jobId, stageId },
    );
    return singleAgentFn();
  }

  // Steps 3-8 wrapped in try/catch for graceful degradation
  try {
    // Step 3: Build StageContext
    const stageCtx: StageContext = {
      jobId,
      stageId,
      stageDescription,
      degradedBridges: degradedBridges ?? [],
      previousStageOutputs,
    };

    // Step 4: Create LLM adapter
    const llmCaller = createLlmCallerAdapter(llm);

    // Step 5: Create Event adapter
    const emitEvent = createEventEmitterAdapter({
      eventBus,
      logger,
      jobId,
      stage: stageId,
      projectId,
      jobStatus,
    });

    // Step 6: Call executeStageWithBrainstorm
    // The singleAgentFallback expected by executeStageWithBrainstorm takes a StageContext,
    // but our singleAgentFn is a no-arg function — wrap it to match the expected signature.
    const result = await executeStageWithBrainstorm(
      stageCtx,
      brainstormContext,
      llmCaller,
      emitEvent,
      () => singleAgentFn(),
    );

    // Step 7: Handle brainstorm result
    if (result.type === "brainstorm") {
      const mapped = mapStageOutput(stageId, result.output);

      if (mapped.success && mapped.output !== null) {
        return mapped.output;
      }

      // Mapping failed — degrade to single-agent
      emitEvent("brainstorm.degraded", {
        reason: `Output mapping failed for stage "${stageId}": ${mapped.error ?? "unknown error"}`,
        affectedComponent: "output-mapper",
        fallbackAction: "single-agent",
      });

      logger.warn(
        `[brainstorm] Output mapping failed for stage "${stageId}" — degrading to single-agent`,
        {
          jobId,
          stageId,
          error: mapped.error,
        },
      );

      return singleAgentFn();
    }

    // Step 8: Single-agent result — return directly
    return result.output;
  } catch (error) {
    // Step 9: Top-level catch — graceful degradation
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    logger.warn(
      `[brainstorm] Exception in brainstorm path for stage "${stageId}" — degrading to single-agent: ${errorMessage}`,
      {
        jobId,
        stageId,
        error: errorMessage,
      },
    );

    return singleAgentFn();
  }
}
