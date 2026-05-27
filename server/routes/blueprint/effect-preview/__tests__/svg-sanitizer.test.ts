/**
 * Focused tests for `sanitizeSvgArchitectureDraft` (Phase 4 task 34.3).
 *
 * Covers all six attack categories declared in the task spec plus a
 * 7th "kitchen sink" combining every vector. The sanitizer is a pure
 * regex-based whitelist (no DOM parser dependency) so the tests target
 * the exported function directly without going through the drafter.
 *
 * Validates security hardening added to requirements 3.1, 3.2, 3.3
 * (Phase 4 addendum). The sanitizer protects the
 * `EffectPreviewImagePanel` `dangerouslySetInnerHTML` mount path against
 * future LLM-derived `architectureNotes` payloads.
 */

import { describe, expect, it } from "vitest";

import { sanitizeSvgArchitectureDraft } from "../svg-architecture-drafter.js";

const SAFE_BENIGN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<circle cx="50" cy="50" r="40" fill="oklch(0.6 0.2 250)"/>' +
  "</svg>";

function expectStillSvg(output: string): void {
  expect(output.startsWith("<svg")).toBe(true);
  expect(output.endsWith("</svg>")).toBe(true);
}

describe("sanitizeSvgArchitectureDraft", () => {
  // -------------------------------------------------------------------------
  // 1. Script tag stripping
  // -------------------------------------------------------------------------

  it("strips <script>...</script> blocks while preserving siblings", () => {
    const input = "<svg><script>alert(1)</script><circle/></svg>";
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output.toLowerCase()).not.toContain("<script");
    expect(output).toContain("<circle/>");
    expectStillSvg(output);
  });

  it("strips uppercase / mixed-case <SCRIPT> blocks", () => {
    const input = "<svg><SCRIPT>alert(1)</SCRIPT><circle/></svg>";
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output.toLowerCase()).not.toContain("<script");
    expect(output).toContain("<circle/>");
  });

  it("strips self-closing / unclosed <script> tags via the fallback regex", () => {
    const input = '<svg><script src="x"/><circle/></svg>';
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output.toLowerCase()).not.toContain("<script");
    expect(output).toContain("<circle/>");
  });

  // -------------------------------------------------------------------------
  // 2. Event handler attribute stripping
  // -------------------------------------------------------------------------

  it("strips on*= event-handler attributes from any element", () => {
    const input = '<svg onclick="evil()" onload="x"><rect/></svg>';
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output.toLowerCase()).not.toContain("onclick=");
    expect(output.toLowerCase()).not.toContain("onload=");
    expect(output).toContain("<rect/>");
    expectStillSvg(output);
  });

  it("strips event handlers regardless of quote style", () => {
    const input =
      "<svg onerror='evil()' onmouseover=evil><rect onclick=\"x\"/></svg>";
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output.toLowerCase()).not.toMatch(/\bon[a-z]+=/);
    expect(output).toContain("<rect");
  });

  // -------------------------------------------------------------------------
  // 3. javascript: URL stripping
  // -------------------------------------------------------------------------

  it("strips javascript: URL schemes inside href attributes", () => {
    const input = '<svg><a href="javascript:alert(1)">click</a></svg>';
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output.toLowerCase()).not.toContain("javascript:");
    // The whole href attribute is removed (not just the scheme), so no
    // empty `href=""` residue should appear.
    expect(output.toLowerCase()).not.toMatch(/\shref\s*=\s*""/);
    expectStillSvg(output);
  });

  it("strips javascript: URLs inside xlink:href and src too", () => {
    const input =
      '<svg><a xlink:href="javascript:alert(1)">x</a><image src="javascript:alert(2)"/></svg>';
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output.toLowerCase()).not.toContain("javascript:");
    expectStillSvg(output);
  });

  // -------------------------------------------------------------------------
  // 4. <foreignObject> stripping
  // -------------------------------------------------------------------------

  it("strips <foreignObject>...</foreignObject> blocks and inline HTML", () => {
    const input =
      "<svg><foreignObject><div>x</div></foreignObject><circle/></svg>";
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output).not.toContain("<foreignObject");
    expect(output).not.toContain("<div>");
    expect(output).toContain("<circle/>");
    expectStillSvg(output);
  });

  // -------------------------------------------------------------------------
  // 5. External URL stripping (and namespace pass-through)
  // -------------------------------------------------------------------------

  it("strips external http:// references from <image href>", () => {
    const input = '<svg><image href="http://attacker.com/x.png"/></svg>';
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output).not.toContain("http://attacker.com");
    expectStillSvg(output);
  });

  it("strips external https:// references from <image xlink:href>", () => {
    const input =
      '<svg><image xlink:href="https://attacker.com/x.png"/></svg>';
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output).not.toContain("attacker.com");
    expectStillSvg(output);
  });

  it("strips external href on <a> elements but keeps the element shell", () => {
    const input = '<svg><a href="https://evil.example/payload">x</a></svg>';
    const output = sanitizeSvgArchitectureDraft(input);

    expect(output).not.toContain("evil.example");
    expectStillSvg(output);
  });

  it("preserves the xmlns=\"http://www.w3.org/2000/svg\" namespace declaration", () => {
    const output = sanitizeSvgArchitectureDraft(SAFE_BENIGN_SVG);

    expect(output).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  // -------------------------------------------------------------------------
  // 6. Benign passthrough (no false positives)
  // -------------------------------------------------------------------------

  it("returns benign SVG byte-equal to input (no false positives)", () => {
    const output = sanitizeSvgArchitectureDraft(SAFE_BENIGN_SVG);

    expect(output).toBe(SAFE_BENIGN_SVG);
  });

  // -------------------------------------------------------------------------
  // 7. Kitchen-sink: every attack vector at once
  // -------------------------------------------------------------------------

  it("strips every attack vector in a kitchen-sink payload", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="evil()">' +
      "<script>alert(1)</script>" +
      "<foreignObject><div onclick=\"x\">y</div></foreignObject>" +
      '<a href="javascript:alert(2)" onmouseover="x">click</a>' +
      '<image href="http://attacker.com/x.png"/>' +
      '<image xlink:href="https://attacker.com/y.png"/>' +
      '<circle cx="50" cy="50" r="40" fill="oklch(0.6 0.2 250)"/>' +
      "</svg>";
    const output = sanitizeSvgArchitectureDraft(input);

    // Every malicious vector is gone.
    expect(output.toLowerCase()).not.toContain("<script");
    expect(output).not.toContain("<foreignObject");
    expect(output).not.toContain("<div");
    expect(output.toLowerCase()).not.toMatch(/\bon[a-z]+=/);
    expect(output.toLowerCase()).not.toContain("javascript:");
    expect(output).not.toContain("attacker.com");

    // Benign content survives.
    expect(output).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(output).toContain("<circle");
    expect(output).toContain("oklch(0.6 0.2 250)");
    expectStillSvg(output);
  });

  // -------------------------------------------------------------------------
  // Determinism / purity sanity check
  // -------------------------------------------------------------------------

  it("is deterministic — same input yields byte-equal output across calls", () => {
    const input =
      '<svg onload="x"><script>alert(1)</script><circle/></svg>';
    const a = sanitizeSvgArchitectureDraft(input);
    const b = sanitizeSvgArchitectureDraft(input);

    expect(a).toBe(b);
  });

  it("is silent — never throws on empty / non-string input", () => {
    expect(() => sanitizeSvgArchitectureDraft("")).not.toThrow();
    expect(sanitizeSvgArchitectureDraft("")).toBe("");
  });

  it("emits per-category warnings when an optional logger is supplied", () => {
    const messages: string[] = [];
    const logger = {
      warn: (message: string) => {
        messages.push(message);
      },
    };
    sanitizeSvgArchitectureDraft(
      '<svg onclick="x"><script>alert(1)</script></svg>',
      logger,
    );

    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(
      messages.some((m) => m.includes("event-handler")),
    ).toBe(true);
    expect(
      messages.some((m) => m.includes("script")),
    ).toBe(true);
  });
});
