/**
 * @description LLM Caller Adapter — bridges the brainstorm subsystem's
 * `LLMCallerFn` signature to a pluggable LLM call dependency.
 *
 * The brainstorm subsystem expects `(prompt: string, options: { signal? }) => Promise<string>`.
 * The real pipeline uses an LLM bridge with a `callJson(messages, options)` interface.
 * This adapter converts between the two without adding retry logic — the brainstorm
 * subsystem already manages its own retries and degradation.
 *
 * @see .kiro/specs/brainstorm-pipeline-hookup/design.md §2
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import type { LLMCallerFn } from "./decision-gate.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of the real LLM dependency from BlueprintServiceContext.
 * We only require the `callJson` method for message-based invocation.
 */
export interface BlueprintLlmBridge {
  callJson(
    messages: Array<{ role: string; content: string }>,
    options?: { signal?: AbortSignal },
  ): Promise<{ content: string }>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates an LLMCallerFn adapter that bridges the brainstorm subsystem's
 * `(prompt, options) => Promise<string>` signature to a `BlueprintLlmBridge`.
 *
 * Behavior:
 * - Formats the prompt string as a single user message.
 * - Delegates to `llm.callJson(messages, options)`.
 * - Returns the response `content` field as a plain string.
 * - Propagates errors unmodified — the brainstorm subsystem has its own
 *   retry and degradation logic.
 *
 * @param llm - The LLM bridge dependency (typically from ctx.llm).
 * @returns An `LLMCallerFn` compatible with the brainstorm subsystem.
 */
export function createLlmCallerAdapter(llm: BlueprintLlmBridge): LLMCallerFn {
  return async (
    prompt: string,
    options: { signal?: AbortSignal },
  ): Promise<string> => {
    const messages: Array<{ role: string; content: string }> = [
      { role: "user", content: prompt },
    ];

    const response = await llm.callJson(messages, options);
    return response.content;
  };
}
