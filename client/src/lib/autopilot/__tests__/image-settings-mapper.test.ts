/**
 * Feature: autopilot-image-rendering-and-visual-system, Phase 5 / Tasks 42.2 + 42.3
 *
 * Validates: Requirements 10.1, 10.2, 10.3 (audit-corrected: real fetch link evidence)
 *
 * --- WHAT THIS TEST PROVES -----------------------------------------------
 *
 * `mapImageSettingsResponseToViewModel` is the pure helper extracted from
 * `EffectPreviewPanel.tsx`'s mount-time `useEffect` body in Phase 5 / Task
 * 42.1. The settings panel's fetch + body-to-view-model mapping was bypassed
 * in every prior test (Phase 4 / Task 35.4 injects `initialImageSettings` to
 * skip the `useEffect` entirely), so the field-copy logic itself had zero
 * unit coverage. This test file closes that gap by exercising the helper
 * directly:
 *
 *   1. Valid mapping — full server response yields a view-model whose 7
 *      fields are copied verbatim, and specifically `viewModel.apiKey` is
 *      sourced from `body.maskedApiKey` (the SERVER → CLIENT field rename).
 *   2. Malformed responses — missing field, wrong type
 *      (e.g. `timeoutMs: "60000"` string instead of number), top-level
 *      `null`, `undefined`, primitive, or array all return `null`.
 *   3. Sentinel raw-key non-leak — even when input contains a rogue
 *      `apiKey` field (which the legitimate server contract does NOT send,
 *      but defense-in-depth), the output's `apiKey` field equals
 *      `body.maskedApiKey`, NOT the rogue raw value.
 *   4. Edge cases — `baseUrl: null` and `maskedApiKey: null` are accepted
 *      per the server contract.
 *
 * --- WHAT THIS TEST DOES NOT PROVE --------------------------------------
 *
 * The following gaps remain residual risks tracked in the Notes section of
 * `tasks.md` per Task 45.2. Closing them would require a real DOM/effect
 * harness (jsdom + React Testing Library, or Playwright) which is
 * intentionally out of Phase 5's scope per the post-Phase-4 audit (a')
 * agreement:
 *
 *   - Real `useEffect` execution under React runtime. This file does not
 *     mount the panel; it calls the helper as a plain function.
 *   - Real network round-trip. `fetch("/api/blueprint/image-settings")`,
 *     `response.json()` parsing, abort/cancellation, and HTTP error paths
 *     are not exercised here.
 *   - Error-state UI rendering after a failed fetch. The fact that
 *     `mapImageSettingsResponseToViewModel(...) === null` flips
 *     `imageSettingsState` to `"error"` and renders the
 *     `data-testid="autopilot-image-settings-panel-error"` block is not
 *     covered by this file — only the helper's `null` return value is.
 *
 * These three gaps are documented in tasks.md §"Residual risks" so the
 * spec's closure status remains honest.
 */

import { describe, expect, it } from "vitest";

import { mapImageSettingsResponseToViewModel } from "../image-settings-mapper.js";

const VALID_BODY = {
  baseUrl: "https://image-proxy.example.com",
  model: "gpt-image-2",
  path: "/v1/images/generations",
  defaultSize: "1K",
  defaultAspect: "1:1",
  timeoutMs: 60000,
  maskedApiKey: "sk-test-•••••CDEF",
} as const;

describe("mapImageSettingsResponseToViewModel — valid mapping", () => {
  it("copies all 7 fields from a full server response and renames maskedApiKey → apiKey", () => {
    const result = mapImageSettingsResponseToViewModel({ ...VALID_BODY });

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.baseUrl).toBe(VALID_BODY.baseUrl);
    expect(result.model).toBe(VALID_BODY.model);
    expect(result.path).toBe(VALID_BODY.path);
    expect(result.defaultSize).toBe(VALID_BODY.defaultSize);
    expect(result.defaultAspect).toBe(VALID_BODY.defaultAspect);
    expect(result.timeoutMs).toBe(VALID_BODY.timeoutMs);
    // The rename invariant: viewModel.apiKey is sourced from body.maskedApiKey.
    expect(result.apiKey).toBe(VALID_BODY.maskedApiKey);
  });

  it("accepts baseUrl: null (server reports no IMAGE_GEN_BASE_URL)", () => {
    const result = mapImageSettingsResponseToViewModel({
      ...VALID_BODY,
      baseUrl: null,
    });
    expect(result).not.toBeNull();
    expect(result?.baseUrl).toBeNull();
  });

  it("accepts maskedApiKey: null (server reports unconfigured key)", () => {
    const result = mapImageSettingsResponseToViewModel({
      ...VALID_BODY,
      maskedApiKey: null,
    });
    expect(result).not.toBeNull();
    expect(result?.apiKey).toBeNull();
  });
});

describe("mapImageSettingsResponseToViewModel — malformed: missing field", () => {
  const requiredFields = [
    "baseUrl",
    "model",
    "path",
    "defaultSize",
    "defaultAspect",
    "timeoutMs",
    "maskedApiKey",
  ] as const;

  for (const field of requiredFields) {
    it(`returns null when field "${field}" is missing`, () => {
      const partial: Record<string, unknown> = { ...VALID_BODY };
      delete partial[field];
      expect(mapImageSettingsResponseToViewModel(partial)).toBeNull();
    });
  }
});

describe("mapImageSettingsResponseToViewModel — malformed: wrong type", () => {
  it("rejects timeoutMs as string '60000' (defends against accidental coercion)", () => {
    expect(
      mapImageSettingsResponseToViewModel({
        ...VALID_BODY,
        timeoutMs: "60000",
      }),
    ).toBeNull();
  });

  it("rejects timeoutMs as zero (must be positive)", () => {
    expect(
      mapImageSettingsResponseToViewModel({ ...VALID_BODY, timeoutMs: 0 }),
    ).toBeNull();
  });

  it("rejects timeoutMs as negative", () => {
    expect(
      mapImageSettingsResponseToViewModel({ ...VALID_BODY, timeoutMs: -1 }),
    ).toBeNull();
  });

  it("rejects timeoutMs as non-integer", () => {
    expect(
      mapImageSettingsResponseToViewModel({ ...VALID_BODY, timeoutMs: 1.5 }),
    ).toBeNull();
  });

  it("rejects timeoutMs as NaN", () => {
    expect(
      mapImageSettingsResponseToViewModel({ ...VALID_BODY, timeoutMs: Number.NaN }),
    ).toBeNull();
  });

  it("rejects model as number", () => {
    expect(
      mapImageSettingsResponseToViewModel({ ...VALID_BODY, model: 42 }),
    ).toBeNull();
  });

  it("rejects model as empty string", () => {
    expect(
      mapImageSettingsResponseToViewModel({ ...VALID_BODY, model: "" }),
    ).toBeNull();
  });

  it("rejects path as null", () => {
    expect(
      mapImageSettingsResponseToViewModel({ ...VALID_BODY, path: null }),
    ).toBeNull();
  });

  it("rejects defaultSize as boolean", () => {
    expect(
      mapImageSettingsResponseToViewModel({
        ...VALID_BODY,
        defaultSize: true,
      }),
    ).toBeNull();
  });

  it("rejects defaultAspect as empty string", () => {
    expect(
      mapImageSettingsResponseToViewModel({
        ...VALID_BODY,
        defaultAspect: "",
      }),
    ).toBeNull();
  });

  it("rejects baseUrl as number", () => {
    expect(
      mapImageSettingsResponseToViewModel({ ...VALID_BODY, baseUrl: 42 }),
    ).toBeNull();
  });

  it("rejects maskedApiKey as number 0 (not string-or-null)", () => {
    expect(
      mapImageSettingsResponseToViewModel({
        ...VALID_BODY,
        maskedApiKey: 0,
      }),
    ).toBeNull();
  });
});

describe("mapImageSettingsResponseToViewModel — malformed: top-level non-object", () => {
  it("returns null for null", () => {
    expect(mapImageSettingsResponseToViewModel(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(mapImageSettingsResponseToViewModel(undefined)).toBeNull();
  });

  it("returns null for a string", () => {
    expect(mapImageSettingsResponseToViewModel("not an object")).toBeNull();
  });

  it("returns null for a number", () => {
    expect(mapImageSettingsResponseToViewModel(42)).toBeNull();
  });

  it("returns null for a boolean", () => {
    expect(mapImageSettingsResponseToViewModel(true)).toBeNull();
  });

  it("returns null for an array", () => {
    expect(mapImageSettingsResponseToViewModel([])).toBeNull();
  });
});

describe("mapImageSettingsResponseToViewModel — sentinel raw-key non-leak", () => {
  it("ignores a rogue `apiKey` field on the input and sources viewModel.apiKey from `maskedApiKey`", () => {
    const SENTINEL_RAW = "SENTINEL-RAW-KEY-NEVER-EXPOSE";
    const SAFE_MASKED = "sk-test-•••••CDEF";

    const result = mapImageSettingsResponseToViewModel({
      ...VALID_BODY,
      maskedApiKey: SAFE_MASKED,
      // Defense-in-depth: rogue field that the legitimate server contract
      // does NOT send, but a malicious or buggy upstream might inject. The
      // mapper MUST ignore this and use `maskedApiKey` only.
      apiKey: SENTINEL_RAW,
    } as Record<string, unknown>);

    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.apiKey).toBe(SAFE_MASKED);
    expect(result.apiKey).not.toBe(SENTINEL_RAW);
  });
});
