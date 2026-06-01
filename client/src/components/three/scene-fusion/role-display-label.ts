/**
 * whybuddy-3d-real-role-driven-scene — Task 7
 *
 * Shared display-label helper for blueprint role rendering.
 *
 * `displayLabel` is the single label function used by BOTH the right-rail
 * role chips and the 3D scene nameplates, so the same `roleId` never shows
 * under two different names (Requirement 3).
 *
 * Design principles:
 * - Pure function: no side effects, no store access, no React.
 * - Delegates canonical/fuzzy resolution to `resolveRoleLabel`, which keeps
 *   its existing unknown-id passthrough contract untouched.
 * - Adds a UI-only display fallback for unknown `role-*` identifiers.
 */

import type { AppLocale } from "@/lib/locale";
import { resolveRoleLabel } from "@/pages/autopilot/right-rail/role-labels";

const ROLE_PREFIX = "role-";

/**
 * Capitalize the first character of a word while preserving the rest as-is.
 *
 * Rest-preserving (NOT force-lowercasing the tail) is intentional: it keeps
 * already-uppercased tokens intact, e.g. `"API"` stays `"API"` rather than
 * collapsing to `"Api"`.
 */
function capitalizeWord(word: string): string {
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Resolve the human-readable label for a `roleId` in the given locale.
 *
 * Rules (design.md "Labels", rules 1-4):
 * 1. Call `resolveRoleLabel(roleId, locale)`.
 * 2. If the result differs from the raw `roleId` (canonical/fuzzy hit),
 *    return it unchanged.
 * 3. Otherwise (unknown id) AND it starts with `role-`: strip the `role-`
 *    prefix, replace remaining hyphens with spaces, and Title-Case each
 *    hyphen-separated word (rest-preserving capitalization).
 *      - `"role-foo-bar"` -> `"Foo Bar"`
 *      - `"role-x"`       -> `"X"`
 *      - `"role-API-gateway"` -> `"API Gateway"`
 * 4. Otherwise (unknown id, not `role-` prefixed): return the raw `roleId`.
 *
 * Edge cases (deterministic, non-throwing):
 * - `"role-"` (prefix only): the stripped remainder is empty, so we return
 *   the empty string `""`. Choosing the stripped form (`""`) over the raw
 *   id keeps the prefix-stripping rule consistent for degenerate input.
 * - `""` (empty string): `resolveRoleLabel("")` returns `""` which equals
 *   the raw id and does not start with `role-`, so we return `""`.
 */
export function displayLabel(roleId: string, locale: AppLocale): string {
  const resolved = resolveRoleLabel(roleId, locale);

  // Rule 2: canonical/fuzzy hit — `resolveRoleLabel` changed the string.
  if (resolved !== roleId) {
    return resolved;
  }

  // Rule 3: unknown `role-*` id — derive a Title-Cased display fallback.
  if (roleId.startsWith(ROLE_PREFIX)) {
    const remainder = roleId.slice(ROLE_PREFIX.length);
    // Prefix-only input (e.g. `"role-"`) yields an empty remainder.
    if (remainder.length === 0) return "";
    return remainder.split("-").map(capitalizeWord).join(" ");
  }

  // Rule 4: any other unknown id passes through unchanged.
  return roleId;
}
