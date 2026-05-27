/**
 * Feature: autopilot-image-rendering-and-visual-system, Property 8: VisualTokens light/dark variant completeness and OKLCH format
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 12.2, 13.3, 15.4, 16.3, 17.1
 *
 * Three sub-tests over the 8-key OKLCH palette declared in `visual-tokens.ts`:
 *
 *  1. Example assertion — `VISUAL_TOKEN_KEYS` has length 8 and contains no
 *     duplicates.
 *  2. Format invariant (PBT) — for every `(key, theme)` pair the resolved
 *     value is a non-empty string starting with `"oklch("` and ending with
 *     `")"`.
 *  3. resolveToken parity (PBT) — `resolveToken(key, theme)` returns exactly
 *     `visualTokens[key][theme]` for every `(key, theme)` pair.
 *
 * Each property runs with `fc.assert(prop, { numRuns: 100 })`.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  VISUAL_TOKEN_KEYS,
  visualTokens,
  resolveToken,
} from "../visual-tokens.js";

describe("Feature: autopilot-image-rendering-and-visual-system, Property 8: VisualTokens light/dark variant completeness and OKLCH format", () => {
  it("VISUAL_TOKEN_KEYS has length 8 and contains no duplicates", () => {
    expect(VISUAL_TOKEN_KEYS).toHaveLength(8);
    expect(new Set(VISUAL_TOKEN_KEYS).size).toBe(8);
  });

  it("every (key, theme) pair resolves to a non-empty `oklch(...)` string (format invariant)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VISUAL_TOKEN_KEYS),
        fc.constantFrom<"light" | "dark">("light", "dark"),
        (key, theme) => {
          const v = visualTokens[key][theme];
          return (
            typeof v === "string" &&
            v.startsWith("oklch(") &&
            v.endsWith(")") &&
            v.length > "oklch()".length
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolveToken(key, theme) === visualTokens[key][theme] for every (key, theme) pair (parity)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VISUAL_TOKEN_KEYS),
        fc.constantFrom<"light" | "dark">("light", "dark"),
        (key, theme) => {
          return resolveToken(key, theme) === visualTokens[key][theme];
        },
      ),
      { numRuns: 100 },
    );
  });
});
