/**
 * whybuddy-3d-real-role-driven-scene-2026-05-29 — Task 18
 *
 * Pure Vitest tests for `role-display-label.ts`. No Three.js, no React, no DOM.
 *
 * Coverage (design.md "Testing Strategy" → "Pure Vitest Tests";
 * Requirements 3.5, 3.6, 9.4):
 * - canonical/known ids match `resolveRoleLabel` for both locales (label parity)
 * - unknown `role-*` ids get prefix-stripped + Title-Cased (rest-preserving)
 * - unknown non-`role-` ids pass through unchanged
 * - degenerate edges (`role-`, ``) return empty string
 */

import { describe, expect, it } from "vitest";

import { resolveRoleLabel } from "@/pages/autopilot/right-rail/role-labels";

import { displayLabel } from "../role-display-label";

// ---------------------------------------------------------------------------
// Canonical parity with resolveRoleLabel (Requirement 3.5)
// ---------------------------------------------------------------------------

describe("displayLabel canonical parity", () => {
  it("matches resolveRoleLabel for a known id in both locales", () => {
    const knownId = "intake-analyst";

    expect(displayLabel(knownId, "zh-CN")).toBe(resolveRoleLabel(knownId, "zh-CN"));
    expect(displayLabel(knownId, "en-US")).toBe(resolveRoleLabel(knownId, "en-US"));
  });
});

// ---------------------------------------------------------------------------
// role- prefix strip + Title-Case (Requirement 3.6)
// ---------------------------------------------------------------------------

describe("displayLabel role- prefix stripping", () => {
  it("strips role- and Title-Cases hyphen-separated words", () => {
    expect(displayLabel("role-foo-bar", "en-US")).toBe("Foo Bar");
  });

  it("Title-Cases a single-word remainder", () => {
    expect(displayLabel("role-x", "en-US")).toBe("X");
  });

  it("preserves already-uppercased tokens (rest-preserving capitalization)", () => {
    expect(displayLabel("role-API-gateway", "en-US")).toBe("API Gateway");
  });
});

// ---------------------------------------------------------------------------
// Non-role- unknown passthrough (Requirement 3.7)
// ---------------------------------------------------------------------------

describe("displayLabel unknown passthrough", () => {
  it("returns a non-role- unknown id unchanged", () => {
    expect(displayLabel("totally-unknown", "en-US")).toBe("totally-unknown");
  });
});

// ---------------------------------------------------------------------------
// Degenerate edge cases
// ---------------------------------------------------------------------------

describe("displayLabel edge cases", () => {
  it("returns empty string for the prefix-only id 'role-'", () => {
    expect(displayLabel("role-", "en-US")).toBe("");
  });

  it("returns empty string for the empty id", () => {
    expect(displayLabel("", "en-US")).toBe("");
  });
});
