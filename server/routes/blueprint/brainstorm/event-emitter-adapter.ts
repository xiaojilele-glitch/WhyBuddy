/**
 * @description Event Emitter Adapter — bridges the brainstorm subsystem's
 * `EventEmitterFn` signature to the real BlueprintEventBus.
 *
 * The brainstorm subsystem emits events as `(type, payload) => void`.
 * The real pipeline expects a fully-formed event object passed to
 * `eventBus.emit(event)`. This adapter constructs the full event envelope
 * with UUID, timestamps, family tagging, and context fields, then delegates
 * to the event bus. Emit errors are swallowed and logged at warn level
 * because brainstorm events are non-critical observability data.
 *
 * @see .kiro/specs/brainstorm-pipeline-hookup/design.md §3
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import crypto from "node:crypto";
import type { EventEmitterFn } from "./decision-gate.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Adapter context providing the dependencies needed to construct and emit
 * brainstorm events through the real event bus.
 */
export interface EventEmitterAdapterContext {
  eventBus: {
    emit(event: Record<string, unknown>): void;
  };
  logger: {
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
  jobId: string;
  stage: string;
  projectId?: string;
  jobStatus?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates an EventEmitterFn adapter that bridges brainstorm's
 * `(type, payload) => void` to `ctx.eventBus.emit(BlueprintGenerationEvent)`.
 *
 * Behavior:
 * - Constructs a full event object with:
 *   - `id`: generated via `crypto.randomUUID()`
 *   - `type`: the event type string from the brainstorm subsystem
 *   - `family`: always `"brainstorm"`
 *   - `jobId`: from the adapter context
 *   - `stage`: from the adapter context
 *   - `status`: from `jobStatus` in context, defaults to `"processing"`
 *   - `occurredAt`: ISO 8601 timestamp at emission time
 *   - Spread of the payload object
 * - Calls `eventBus.emit(event)`.
 * - If `emit` throws, catches the error and logs at warn level (does not propagate).
 *
 * @param adapterCtx - Context with event bus, logger, and execution metadata.
 * @returns An `EventEmitterFn` compatible with the brainstorm subsystem.
 */
export function createEventEmitterAdapter(
  adapterCtx: EventEmitterAdapterContext,
): EventEmitterFn {
  return (type: string, payload: Record<string, unknown>): void => {
    const event: Record<string, unknown> = {
      id: crypto.randomUUID(),
      type,
      family: "brainstorm",
      jobId: adapterCtx.jobId,
      stage: adapterCtx.stage,
      status: adapterCtx.jobStatus ?? "processing",
      occurredAt: new Date().toISOString(),
      ...payload,
    };

    try {
      adapterCtx.eventBus.emit(event);
    } catch (error) {
      adapterCtx.logger.warn(
        `[brainstorm] Failed to emit event "${type}": ${error instanceof Error ? error.message : String(error)}`,
        {
          eventType: type,
          jobId: adapterCtx.jobId,
          stage: adapterCtx.stage,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  };
}
