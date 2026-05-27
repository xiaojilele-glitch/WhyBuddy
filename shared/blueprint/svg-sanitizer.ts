/**
 * SVG architecture draft sanitizer — shared / defense-in-depth tier
 * (`autopilot-image-rendering-and-visual-system` spec, Phase 5 Task 44.1).
 *
 * This module lives under `shared/` because BOTH server and client need
 * to call it:
 *
 * - Server: `server/routes/blueprint/effect-preview/svg-architecture-drafter.ts`
 *   pipes the freshly built SVG string through this sanitizer at the end
 *   of `draftSvgArchitecture` before persisting it to
 *   `BlueprintEffectPreview.architectureSvgDraft` (Phase 4 Task 34.1).
 *
 * - Client: `client/src/components/autopilot/EffectPreviewImagePanel.tsx`
 *   sanitizes again right before `dangerouslySetInnerHTML`. This catches
 *   legacy artifacts persisted before the server sanitizer landed,
 *   hand-crafted test fixtures, and any hypothetical future server-side
 *   bypass route (Phase 5 Task 44.2).
 *
 * `shared/` is the bottom layer of the dependency graph: it must not
 * import from `client/` or `server/`. The function is pure regex-based
 * with no DOM-parser dependency, so it runs identically in Node, jsdom,
 * Web Workers, and the browser main thread without bringing in jsdom or
 * DOMPurify.
 *
 * The sanitizer is silent — it never throws and never writes to
 * `console` directly. Pass an optional logger to receive per-detection
 * warnings.
 *
 * _Requirements: 3.1, 3.2 (defense-in-depth)_
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Optional logger interface accepted by `sanitizeSvgArchitectureDraft`.
 *
 * Emitting per-detection warnings is opt-in: callers that want telemetry
 * pass a `{ warn(message: string): void }` shim; production callers (such
 * as `draftSvgArchitecture`) currently omit it so sanitization stays
 * completely silent on the happy path.
 */
export interface SvgArchitectureSanitizerLogger {
  warn(message: string): void;
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Strip XSS-prone constructs from an SVG architecture draft string.
 *
 * `EffectPreviewImagePanel` renders the returned `architectureSvgDraft`
 * via `dangerouslySetInnerHTML`. Today's `architectureNotes` are
 * server-derived, but future LLM-sourced notes could smuggle script
 * tags / event handlers / javascript: URLs through the SVG text path.
 * This sanitizer is a regex-based whitelist with no DOM-parser
 * dependency so it can run in any Node environment without bringing in
 * jsdom or DOMPurify.
 *
 * The function is pure: same input always yields the same output, no
 * I/O, no `Date.now()`, no module-level state. It is also silent — it
 * never throws and never writes to `console` directly. Pass a `logger`
 * to receive per-detection warnings if needed.
 *
 * Categories stripped:
 *  1. `<script>...</script>` blocks (case-insensitive) plus a
 *     self-closing / unclosed `<script ...>` fallback.
 *  2. `<foreignObject>...</foreignObject>` blocks plus a self-closing
 *     / unclosed fallback (foreignObject can host arbitrary HTML).
 *  3. All `on*=` event-handler attributes regardless of element.
 *  4. `javascript:` URL schemes inside `href` / `xlink:href` / `src`.
 *     The whole attribute is removed (not just the scheme) so no
 *     malformed `href=""` residue is left behind.
 *  5. External `http://` / `https://` URLs inside `href` / `xlink:href`
 *     / `src` — but only on a narrow element list (`<a>`, `<image>`,
 *     `<link>`, `<use>`). The `<svg>` element is intentionally NOT in
 *     the list so that `xmlns="http://www.w3.org/2000/svg"` namespace
 *     declarations pass through untouched.
 */
export function sanitizeSvgArchitectureDraft(
  svg: string,
  logger?: SvgArchitectureSanitizerLogger,
): string {
  if (typeof svg !== "string" || svg.length === 0) {
    return "";
  }

  let cleaned = svg;

  // 1a. <script ...>...</script> blocks.
  cleaned = stripPattern(
    cleaned,
    /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
    "script-block",
    logger,
  );
  // 1b. Self-closing / unclosed <script ...> fallback.
  cleaned = stripPattern(
    cleaned,
    /<script\b[^>]*\/?>/gi,
    "script-tag",
    logger,
  );
  // 2a. <foreignObject ...>...</foreignObject> blocks.
  cleaned = stripPattern(
    cleaned,
    /<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi,
    "foreign-object-block",
    logger,
  );
  // 2b. Self-closing / unclosed <foreignObject ...> fallback.
  cleaned = stripPattern(
    cleaned,
    /<foreignObject\b[^>]*\/?>/gi,
    "foreign-object-tag",
    logger,
  );
  // 3. on*= event handler attributes (quoted, single-quoted, or unquoted value).
  cleaned = stripPattern(
    cleaned,
    /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    "event-handler",
    logger,
  );
  // 4. javascript: URL schemes inside href / xlink:href / src — strip
  //    the whole attribute to avoid leaving an empty href= behind.
  cleaned = stripPattern(
    cleaned,
    /\s+(?:href|xlink:href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi,
    "javascript-url",
    logger,
  );
  // 5. External http(s) URLs inside href / xlink:href / src — but only on
  //    the `<a>` / `<image>` / `<link>` / `<use>` element opening tags.
  //    Narrowing to that element list keeps `<svg xmlns="http://...">` and
  //    other namespace declarations untouched (known sanitizer footgun).
  cleaned = cleaned.replace(
    /<(a|image|link|use)\b([^>]*)>/gi,
    (_match, tagName: string, attrs: string) => {
      const filtered = attrs.replace(
        /\s+(?:href|xlink:href|src)\s*=\s*(?:"https?:[^"]*"|'https?:[^']*'|https?:[^\s>]*)/gi,
        () => {
          if (logger) {
            logger.warn(
              `[sanitizeSvgArchitectureDraft] stripped external-url on <${tagName}>`,
            );
          }
          return "";
        },
      );
      return `<${tagName}${filtered}>`;
    },
  );

  return cleaned;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stripPattern(
  input: string,
  pattern: RegExp,
  category: string,
  logger?: SvgArchitectureSanitizerLogger,
): string {
  if (!logger) {
    return input.replace(pattern, "");
  }
  return input.replace(pattern, () => {
    logger.warn(`[sanitizeSvgArchitectureDraft] stripped ${category}`);
    return "";
  });
}
