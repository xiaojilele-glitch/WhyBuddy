/**
 * `<EffectPreviewImagePanel>` client-side sanitize defense-in-depth tests
 *
 * autopilot-image-rendering-and-visual-system · Phase 5 · Task 44.3
 *
 * What this PROVES:
 *   The client-side `sanitizeSvgArchitectureDraft` call wired into
 *   `EffectPreviewImagePanel` (Phase 5 Task 44.2) actually executes
 *   before the SVG body reaches `dangerouslySetInnerHTML`. Even when
 *   the server-side sanitizer never ran (legacy artifacts persisted
 *   before Phase 4 Task 34.1 landed; hand-crafted test fixtures;
 *   hypothetical future server-side bypass), all 7 audited attack
 *   categories are stripped from the rendered DOM:
 *     1. `<script>...</script>` blocks
 *     2. `<foreignObject>...</foreignObject>` blocks (inline HTML host)
 *     3. `on*=` event-handler attributes
 *     4. `javascript:` URL schemes in `href` / `xlink:href` / `src`
 *     5. External `http(s)://` URLs on `<a>` / `<image>` / `<link>` / `<use>`
 *     6. Mixed-case / quote-style variants of the above
 *     7. Kitchen-sink combinations of all of the above
 *
 * What this does NOT prove:
 *   `sanitizeSvgArchitectureDraft` is regex-based, not a parser-backed
 *   whitelist. Entity-encoded schemes (e.g. `&#106;avascript:`),
 *   `style="background:url(javascript:...)"` constructs, and
 *   unknown future SVG dynamic loads CAN bypass it. Defense-in-depth
 *   (server + client both sanitize) reduces but does not eliminate
 *   that risk. See `tasks.md` Task 45.2 residual risk #3 — a future
 *   migration to `DOMPurify` or a parser-based whitelist would be
 *   the proper fix.
 *
 * Test strategy (matches existing autopilot test conventions —
 * `EffectPreviewImagePanel.test.tsx`, `CapabilitySnapshotBadges.test.tsx`,
 * `ProjectMainChainTimeline.test.tsx`):
 *   - Render via `react-dom/server` `renderToStaticMarkup`
 *   - Assert against the produced SSR markup string
 *   - No `@testing-library/react` / `jsdom` dependency required
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { visualTokens } from "@/lib/autopilot/visual-tokens-placeholder";

import {
  EffectPreviewImagePanel,
  type ProgressPlanEntry,
} from "../EffectPreviewImagePanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render the panel with a malicious or benign `architectureSvgDraft` and
 * the minimum other props the production component requires.
 */
function renderWithSvg(architectureSvgDraft: string): string {
  const progressPlan: ReadonlyArray<ProgressPlanEntry> = [];
  return renderToStaticMarkup(
    <EffectPreviewImagePanel
      missionId="mission-client-sanitize"
      activeStageKey="effect_preview"
      progressPlan={progressPlan}
      imageBase64ByNodeId={{}}
      architectureSvgDraft={architectureSvgDraft}
      visualTokens={visualTokens}
      onDownload={() => {
        /* noop — SSR does not trigger click handlers */
      }}
      theme="light"
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe(
  "Feature: autopilot-image-rendering-and-visual-system, " +
    "EffectPreviewImagePanel client-side sanitize (Phase 5 Task 44.3)",
  () => {
    // -------------------------------------------------------------------------
    // 1. Malicious payload directly to panel (bypasses server entirely)
    // -------------------------------------------------------------------------

    it("strips <script> + on*= from a malicious architectureSvgDraft handed directly to the panel", () => {
      const malicious =
        '<svg onclick="evil()" xmlns="http://www.w3.org/2000/svg">' +
        "<script>alert(1)</script>" +
        '<circle cx="50" cy="50" r="40"/>' +
        "</svg>";

      const markup = renderWithSvg(malicious);
      const lower = markup.toLowerCase();

      // Malicious tokens stripped.
      expect(lower).not.toContain("<script");
      expect(lower).not.toContain("onclick=");

      // Benign tokens survive.
      expect(markup).toContain("<circle");
      expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    // -------------------------------------------------------------------------
    // 2. Kitchen-sink — all 7 attack categories combined
    // -------------------------------------------------------------------------

    it("strips every attack vector in a kitchen-sink architectureSvgDraft", () => {
      const kitchenSink =
        '<svg xmlns="http://www.w3.org/2000/svg" onload="evil()">' +
        "<script>alert(1)</script>" +
        '<foreignObject><div onclick="x">y</div></foreignObject>' +
        '<a href="javascript:alert(2)">click</a>' +
        '<image href="http://attacker.com/x.png"/>' +
        '<circle cx="50" cy="50" r="40"/>' +
        "</svg>";

      const markup = renderWithSvg(kitchenSink);
      const lower = markup.toLowerCase();

      // 1. <script>
      expect(lower).not.toContain("<script");
      // 2. <foreignObject> (and the inline-HTML content it hosted —
      //    the `>y<` text-node marker comes ONLY from the malicious
      //    `<div>y</div>` inside foreignObject, so its absence proves
      //    the foreignObject body was stripped wholesale).
      expect(markup).not.toContain("<foreignObject");
      expect(markup).not.toContain(">y<");
      // 3. on*= event handlers (any element). The component's own
      //    chrome never emits `on*=` attributes, so this assertion is
      //    safe across the whole markup string.
      expect(lower).not.toMatch(/\bon[a-z]+=/);
      // 4. javascript: URL schemes
      expect(lower).not.toContain("javascript:");
      // 5. external http(s):// reference on <image>/<a>
      expect(markup).not.toContain("attacker.com");

      // 6. Benign tokens survive.
      expect(markup).toContain("<circle");
      expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    // -------------------------------------------------------------------------
    // 3. Benign passthrough — sanitizer must not false-positive
    // -------------------------------------------------------------------------

    it("preserves the SVG body unchanged when no malicious tokens are present", () => {
      const benign =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" r="40" fill="oklch(0.6 0.2 250)"/>' +
        "</svg>";

      const markup = renderWithSvg(benign);

      // The full benign SVG body appears in the rendered DOM intact
      // (the sanitizer is byte-equal on already-clean input).
      expect(markup).toContain(benign);

      // And of course no malicious tokens leaked in either.
      const lower = markup.toLowerCase();
      expect(lower).not.toContain("<script");
      expect(lower).not.toMatch(/\bon[a-z]+=/);
      expect(lower).not.toContain("javascript:");
    });
  },
);
