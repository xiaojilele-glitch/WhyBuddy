/**
 * Prompt template library for the autopilot effect-preview Stage C image
 * pipeline (`autopilot-image-rendering-and-visual-system` spec Task 3.1).
 *
 * Owns:
 * - {@link PromptStyleKey} — the four-style enum exposed to {@link ImageService}.
 * - {@link PromptTemplateInput} — structured input contract for {@link PromptTemplateLibrary.render}.
 * - {@link PromptTemplateLibrary} — interface + factory `createPromptTemplateLibrary()`
 *   producing prompts for the gpt-image-2 raster step.
 * - {@link META_PREFIX} — single shared constant prepended to every output
 *   prompt (Requirement 2.4). The prefix carries the mission framing and
 *   style-key marker; downstream raster output remains style-consistent
 *   even though concrete mission identifiers are passed via the body.
 *
 * Determinism guarantees (Requirement 2.2 + Property 1):
 * - No `Date.now()` / `Math.random()` / mutable module state — same input
 *   yields byte-identical output.
 * - Inputs are read non-mutating; `architectureNotes` / `style` are only
 *   inspected, never sorted or de-duplicated. Callers control ordering.
 * - `render(input)` with `input.style` undefined SHALL produce the exact
 *   same string as `render({ ...input, style: "system_architecture_diagram" })`
 *   (Requirement 2.3 + Property 1 fallback clause).
 *
 * No runtime / business imports. This module is intentionally a pure
 * function library so the future {@link ImageService} can compose it with
 * `SvgArchitectureDrafter`, `EffectPreviewScheduler`, and `ImageApiClient`
 * without introducing cycles.
 *
 * See design.md §"PromptTemplateLibrary" + requirements 2.1 / 2.2 / 2.3 / 2.4.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Style enumeration consumed by {@link PromptTemplateLibrary.render}.
 *
 * The four styles correspond to four visual intents documented in
 * requirements 2.1:
 * - `system_architecture_diagram` — flat layered diagram, colored block
 *   grouping, clean arrow connections, white background. Default when
 *   `style` is omitted.
 * - `ui_mockup` — flat UI screenshot, mobile layout, card-based design.
 * - `concept_sketch` — hand-drawn style, whiteboard lines, annotation
 *   stickers.
 * - `product_hero` — industrial design, premium feel, dramatic lighting.
 */
export type PromptStyleKey =
  | "system_architecture_diagram"
  | "ui_mockup"
  | "concept_sketch"
  | "product_hero";

/**
 * Structured input for {@link PromptTemplateLibrary.render}. Mirrors the
 * shape declared in design.md §"PromptTemplateLibrary":
 *
 * - `nodeId` — SPEC tree node identifier the preview is being generated for.
 * - `title` — node display title (used in the rendered prompt body).
 * - `summary` — node summary (used as scene framing in the prompt body).
 * - `architectureNotes` — ordered architecture cues; rendered verbatim in
 *   list form. Caller controls ordering / deduplication for determinism.
 * - `style` — optional style key; falls back to `"system_architecture_diagram"`
 *   when undefined (Requirement 2.3).
 */
export interface PromptTemplateInput {
  readonly nodeId: string;
  readonly title: string;
  readonly summary: string;
  readonly architectureNotes: ReadonlyArray<string>;
  readonly style?: PromptStyleKey;
}

/**
 * Stage C step-1 prompt template library. Pure function shell — no IO,
 * no module-level mutable state.
 */
export interface PromptTemplateLibrary {
  /**
   * Render a deterministic prompt for the given input. When `input.style`
   * is omitted, the result equals the result of calling `render` with
   * `style: "system_architecture_diagram"` (Requirement 2.3).
   *
   * Every produced string starts with the shared {@link META_PREFIX}
   * constant (Requirement 2.4 / Property 1).
   */
  render(input: PromptTemplateInput): string;
  /**
   * Enumerate all available style keys. Returned array is a fresh
   * read-only snapshot so callers cannot mutate {@link STYLE_KEYS}.
   */
  styles(): ReadonlyArray<PromptStyleKey>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default style applied when {@link PromptTemplateInput.style} is omitted.
 * Pinned to `"system_architecture_diagram"` per Requirement 2.3.
 */
export const DEFAULT_STYLE_KEY: PromptStyleKey = "system_architecture_diagram";

/**
 * Frozen tuple of all available style keys, in stable enumeration order.
 * `styles()` returns a copy of this array so the canonical list cannot
 * be mutated by callers.
 */
export const STYLE_KEYS: ReadonlyArray<PromptStyleKey> = Object.freeze([
  "system_architecture_diagram",
  "ui_mockup",
  "concept_sketch",
  "product_hero",
] as const);

/**
 * Shared prefix prepended to every rendered prompt (Requirement 2.4).
 *
 * Carries:
 * - The Stage C / autopilot effect-preview mission framing.
 * - A style-marker preamble that downstream image models can use as a
 *   stable cue regardless of the per-request body.
 *
 * Kept as a single static constant so:
 * - Property 1 ("every produced string starts with the same `metaPrefix`
 *   constant") holds across all inputs.
 * - Determinism guarantee is preserved — no per-call interpolation, no
 *   timestamps, no randomness.
 */
export const META_PREFIX: string = [
  "[autopilot-effect-preview/stage-c]",
  "Mission context: rendering a single-node visual preview for the autopilot",
  "Stage C image pipeline (spec_documents -> prompt -> SVG draft -> schedule -> raster).",
  "Style identifier marker: the per-request body declares one of",
  "{system_architecture_diagram, ui_mockup, concept_sketch, product_hero}.",
  "Output a single still image. No batches. No edits. White or theme-appropriate",
  "background only. Do not include trademarks, watermarks, or photoreal humans.",
].join("\n");

// ---------------------------------------------------------------------------
// Style descriptors
// ---------------------------------------------------------------------------

/**
 * Per-style descriptor block rendered into the prompt body. Each entry is
 * a frozen object literal so the descriptor table is itself a constant.
 *
 * Visual cues are sourced from requirements 2.1 + the task description
 * for `autopilot-image-rendering-and-visual-system` Task 3.1.
 */
const STYLE_DESCRIPTORS: Readonly<Record<PromptStyleKey, Readonly<{
  label: string;
  visualLanguage: ReadonlyArray<string>;
  framing: string;
}>>> = Object.freeze({
  system_architecture_diagram: Object.freeze({
    label: "System Architecture Diagram",
    visualLanguage: Object.freeze([
      "flat layered design with clearly separated horizontal tiers",
      "colored block grouping for sub-systems (cool palette, OKLCH-friendly)",
      "clean arrow connections, orthogonal routing, no curved spaghetti lines",
      "white background, generous whitespace, no decorative shadows",
      "label every block with concise English text",
    ]),
    framing:
      "Render an architecture-diagram-style still image that explains how the node fits into the surrounding system.",
  }),
  ui_mockup: Object.freeze({
    label: "UI Mockup",
    visualLanguage: Object.freeze([
      "flat UI screenshot aesthetic, no 3D bevels or skeuomorphism",
      "mobile layout, single device frame, portrait orientation",
      "card-based design with consistent rounded corners and spacing",
      "neutral light surface with one accent hue for primary actions",
      "use placeholder English labels, no real brand names",
    ]),
    framing:
      "Render a high-fidelity UI mockup screenshot that shows what the end user would see when this node is exercised.",
  }),
  concept_sketch: Object.freeze({
    label: "Concept Sketch",
    visualLanguage: Object.freeze([
      "hand-drawn style, ink lines on textured paper or whiteboard surface",
      "whiteboard line weights, occasional eraser smudges, no perfect geometry",
      "annotation stickers / sticky-note callouts pointing to key components",
      "monochrome ink with at most two highlight colors",
      "feels like an early-stage workshop sketch, not a final deliverable",
    ]),
    framing:
      "Render a hand-drawn concept sketch that captures the intent of the node before any pixel-perfect design exists.",
  }),
  product_hero: Object.freeze({
    label: "Product Hero",
    visualLanguage: Object.freeze([
      "industrial-design product photography aesthetic",
      "premium feel, matte materials, machined edges, subtle reflections",
      "dramatic lighting with a single key light and soft fill",
      "neutral studio backdrop, shallow depth of field",
      "no human subjects, no text overlays inside the image",
    ]),
    framing:
      "Render a product-hero still image that conveys the polished end-state vibe of the deliverable this node represents.",
  }),
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective style for a given input, applying the
 * Requirement 2.3 fallback to {@link DEFAULT_STYLE_KEY} when omitted.
 *
 * Defensive against unknown values (e.g. a string that does not match
 * the {@link PromptStyleKey} enum due to upstream type erosion): such
 * values fall back to the default so the pipeline never throws on
 * style resolution alone.
 */
function resolveStyle(style: PromptStyleKey | undefined): PromptStyleKey {
  if (style === undefined) {
    return DEFAULT_STYLE_KEY;
  }
  return STYLE_KEYS.includes(style) ? style : DEFAULT_STYLE_KEY;
}

/**
 * Render the architecture-notes block. Empty arrays yield a stable
 * "(none provided)" placeholder so downstream determinism is preserved
 * for both empty and non-empty inputs.
 */
function renderArchitectureNotes(notes: ReadonlyArray<string>): string {
  if (notes.length === 0) {
    return "Architecture notes:\n  (none provided)";
  }
  const lines = notes.map((note, index) => `  ${index + 1}. ${note}`);
  return ["Architecture notes:", ...lines].join("\n");
}

/**
 * Render a single style descriptor block. Pure function over a frozen
 * descriptor entry plus the resolved style key.
 */
function renderStyleBlock(style: PromptStyleKey): string {
  const descriptor = STYLE_DESCRIPTORS[style];
  const visualLines = descriptor.visualLanguage.map((cue) => `  - ${cue}`);
  return [
    `Style: ${style} (${descriptor.label})`,
    descriptor.framing,
    "Visual language requirements:",
    ...visualLines,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct a {@link PromptTemplateLibrary}. The returned object is
 * stateless; calling this factory multiple times yields equivalent
 * libraries that produce byte-identical output for equal inputs.
 */
export function createPromptTemplateLibrary(): PromptTemplateLibrary {
  return {
    render(input: PromptTemplateInput): string {
      const style = resolveStyle(input.style);
      const styleBlock = renderStyleBlock(style);
      const notesBlock = renderArchitectureNotes(input.architectureNotes);
      const subjectBlock = [
        `Node id: ${input.nodeId}`,
        `Node title: ${input.title}`,
        `Node summary: ${input.summary}`,
      ].join("\n");

      return [
        META_PREFIX,
        "",
        styleBlock,
        "",
        subjectBlock,
        "",
        notesBlock,
      ].join("\n");
    },
    styles(): ReadonlyArray<PromptStyleKey> {
      return STYLE_KEYS.slice();
    },
  };
}
