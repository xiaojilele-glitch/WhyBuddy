/**
 * autopilot-image-rendering-and-visual-system · Phase 5 / Task 42.1
 *
 * Pure helper extracted from `EffectPreviewPanel.tsx`'s mount-time `useEffect`
 * body. The original `useEffect` constructed an `ImageSettingsViewModel` inline
 * from the `/api/blueprint/image-settings` JSON response. That inline mapping
 * was structurally untestable: every existing settings-integration test (Phase
 * 4 Task 35.4) bypasses the `useEffect` entirely by injecting
 * `initialImageSettings`, so the field-copy logic itself had zero unit
 * coverage.
 *
 * This module exists specifically so the mapping logic can be exercised in
 * isolation, without a DOM harness, jsdom, or React effect runner. The
 * production component now calls into this helper instead of inlining the
 * field copy, so the same mapper code runs in production and in tests.
 *
 * Behavior contract:
 *
 * - The function validates that the input is a non-null object.
 * - It validates each of the 7 required fields using `typeof` checks
 *   (with `null` allowed for `baseUrl` and `maskedApiKey`, per the server
 *   contract in `server/routes/blueprint/image-settings.ts`).
 * - `timeoutMs` must be a positive integer; the literal string `"60000"` is
 *   rejected to defend against accidental type coercion at the network layer.
 * - Any validation failure causes the helper to return `null`. The caller
 *   (the `useEffect` in `EffectPreviewPanel.tsx`) treats `null` the same as
 *   a failed fetch, transitioning the panel to its error state.
 * - On valid input, the output's `apiKey` field is sourced from
 *   `body.maskedApiKey` (the SERVER's masked field name) → CLIENT's `apiKey`
 *   prop. This rename happens here, in one place, so the rest of the codebase
 *   only ever sees the `apiKey` prop name.
 *
 * Defense-in-depth: even if a malicious or buggy upstream injects a rogue
 * `apiKey` field on the response (which the legitimate server contract does
 * NOT send), this mapper IGNORES it. The output's `apiKey` always comes from
 * `body.maskedApiKey`. Task 42.2's sentinel test pins this invariant.
 *
 * Residual risk: this module does NOT prove that the production `useEffect`
 * actually runs the helper, that the network round-trip is wired correctly,
 * or that the panel renders the error UI when this helper returns `null`.
 * Those gaps require a real DOM/effect harness (jsdom + RTL or Playwright)
 * and are tracked in the Notes section of `tasks.md` per Task 45.2.
 *
 * @see Requirements 10.1, 10.2, 10.3 (audit-corrected: real fetch link evidence)
 */

import type { ImageSettingsViewModel } from "@/components/autopilot/AutopilotImageSettingsPanel";

/**
 * Map a raw `/api/blueprint/image-settings` response body to a typed
 * `ImageSettingsViewModel`. Returns `null` if the body is malformed in any
 * way (missing field, wrong type, non-object). The caller MUST treat `null`
 * as if the fetch had failed.
 */
export function mapImageSettingsResponseToViewModel(
  body: unknown,
): ImageSettingsViewModel | null {
  // 1. Top-level must be a non-null, non-array object.
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;

  // 2. baseUrl: string | null (null is allowed per server contract).
  const baseUrl = record.baseUrl;
  if (baseUrl !== null && typeof baseUrl !== "string") {
    return null;
  }

  // 3. model: non-empty string.
  const model = record.model;
  if (typeof model !== "string" || model.length === 0) {
    return null;
  }

  // 4. path: non-empty string.
  const path = record.path;
  if (typeof path !== "string" || path.length === 0) {
    return null;
  }

  // 5. defaultSize: non-empty string.
  const defaultSize = record.defaultSize;
  if (typeof defaultSize !== "string" || defaultSize.length === 0) {
    return null;
  }

  // 6. defaultAspect: non-empty string.
  const defaultAspect = record.defaultAspect;
  if (typeof defaultAspect !== "string" || defaultAspect.length === 0) {
    return null;
  }

  // 7. timeoutMs: positive integer (rejects `"60000"` string, NaN, Infinity,
  //    negative, zero, fractional values).
  const timeoutMs = record.timeoutMs;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return null;
  }

  // 8. maskedApiKey: string | null (null is allowed when server reports
  //    unconfigured; rejects number/boolean/etc.).
  const maskedApiKey = record.maskedApiKey;
  if (maskedApiKey !== null && typeof maskedApiKey !== "string") {
    return null;
  }

  // Defense-in-depth: explicitly source `apiKey` from `maskedApiKey`. Even if
  // the input has a rogue `record.apiKey` field, it is IGNORED here. This is
  // the field-name swap pinned by the sentinel test in Task 42.2.
  return {
    baseUrl,
    model,
    path,
    defaultSize,
    defaultAspect,
    timeoutMs,
    apiKey: maskedApiKey,
  };
}
