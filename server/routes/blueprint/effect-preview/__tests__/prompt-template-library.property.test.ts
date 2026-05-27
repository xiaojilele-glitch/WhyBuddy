/**
 * Feature: autopilot-image-rendering-and-visual-system, Property 1: PromptTemplateLibrary determinism
 *
 * Validates: Requirements 2.2, 2.3, 2.4
 *
 * Three property assertions over arbitrary `PromptTemplateInput` values:
 *
 *  1. Determinism — `render(input)` called twice with the same input returns
 *     strictly equal strings (Requirement 2.2).
 *  2. Style fallback — omitting `style` is exactly equivalent to passing
 *     `style: "system_architecture_diagram"` (Requirement 2.3).
 *  3. metaPrefix invariant — every produced string begins with the shared
 *     `META_PREFIX` constant (Requirement 2.4).
 *
 * Each property runs with `fc.assert(prop, { numRuns: 100 })`.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  createPromptTemplateLibrary,
  META_PREFIX,
  STYLE_KEYS,
  type PromptStyleKey,
  type PromptTemplateInput,
} from "../prompt-template-library.js";

/**
 * Build a smart fast-check arbitrary that constrains `PromptTemplateInput`
 * to the documented input space:
 *
 *  - `nodeId` / `title` / `summary`: non-empty unicode strings to ensure the
 *    rendered body has stable substitution slots.
 *  - `architectureNotes`: a (possibly empty) array of strings so the empty /
 *    non-empty branches of `renderArchitectureNotes` are both exercised.
 *  - `style`: undefined OR one of the four `STYLE_KEYS`.
 */
function promptTemplateInputArb(): fc.Arbitrary<PromptTemplateInput> {
  const nonEmptyString = fc.string({ minLength: 1, maxLength: 64 });
  const styleArb: fc.Arbitrary<PromptStyleKey | undefined> = fc.oneof(
    fc.constant<undefined>(undefined),
    fc.constantFrom<PromptStyleKey>(...STYLE_KEYS),
  );

  return fc.record({
    nodeId: nonEmptyString,
    title: nonEmptyString,
    summary: nonEmptyString,
    architectureNotes: fc.array(fc.string({ maxLength: 80 }), {
      minLength: 0,
      maxLength: 8,
    }),
    style: styleArb,
  });
}

describe("Feature: autopilot-image-rendering-and-visual-system, Property 1: PromptTemplateLibrary determinism", () => {
  const library = createPromptTemplateLibrary();

  it("renders byte-identical output for identical inputs (determinism)", () => {
    fc.assert(
      fc.property(promptTemplateInputArb(), (input) => {
        const a = library.render(input);
        const b = library.render(input);
        expect(a).toBe(b);
      }),
      { numRuns: 100 },
    );
  });

  it("treats omitted style as equivalent to style=\"system_architecture_diagram\" (Requirement 2.3)", () => {
    fc.assert(
      fc.property(promptTemplateInputArb(), (input) => {
        const withoutStyle: PromptTemplateInput = {
          nodeId: input.nodeId,
          title: input.title,
          summary: input.summary,
          architectureNotes: input.architectureNotes,
          style: undefined,
        };
        const withDefaultStyle: PromptTemplateInput = {
          ...withoutStyle,
          style: "system_architecture_diagram",
        };
        expect(library.render(withoutStyle)).toBe(
          library.render(withDefaultStyle),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("prefixes every rendered prompt with the shared META_PREFIX constant (Requirement 2.4)", () => {
    fc.assert(
      fc.property(promptTemplateInputArb(), (input) => {
        const rendered = library.render(input);
        expect(rendered.startsWith(META_PREFIX)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
