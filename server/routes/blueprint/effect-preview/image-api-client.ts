/**
 * Image API client for the autopilot effect-preview Stage C raster step
 * (`autopilot-image-rendering-and-visual-system` spec, task 2.1).
 *
 * Owns:
 * - {@link IMAGE_GEN_MODELS} / {@link IMAGE_GEN_SIZES} /
 *   {@link IMAGE_GEN_ASPECTS} / {@link IMAGE_GEN_PATHS} — the four enum
 *   tuples that gate every outgoing request body and URL path
 *   (Requirements 5.1 / 5.2 / 5.3 / 5.5).
 * - {@link ResolvedImageGenConfig} — parsed snapshot of the seven
 *   `IMAGE_GEN_*` environment variables, with whitespace trimmed,
 *   empty-after-trim values normalised to `null`, invalid enum / integer
 *   values rejected and replaced with the documented defaults, and a
 *   sibling `errors: string[]` array describing every fallback so the
 *   diagnostics surface can show "configured but invalid" cleanly.
 * - {@link getResolvedConfig} — pure, side-effect-free function that
 *   reads the env once. Defaults to `process.env` but accepts an injected
 *   {@link NodeJS.ProcessEnv} for test setups (Requirements 5.5 / 7.1 /
 *   7.2 / 18.1).
 * - {@link ImageApiClient} interface + {@link createImageApiClient}
 *   factory. Task 2.1 shipped the typed skeleton; task 2.2 added the
 *   real fetch + response decoder path; task 2.3 lands the full 6-tier
 *   fallback detector here. Tiers are evaluated strictly in priority
 *   order — if a higher-priority tier matches, never fall through to
 *   lower tiers (Property 4):
 *     1. `env-disabled`  — `IMAGE_GEN_DISABLED === "true"` or
 *                          `AUTOPILOT_REAL_RUNTIME === "false"` (0
 *                          outgoing requests).
 *     2. `key-missing`   — `config.apiKey === null` (0 outgoing).
 *     3. `timeout`       — fetch aborted after `timeoutMs`.
 *     4. `quota`         — HTTP 429 OR response `code` field contains
 *                          `"quota_exceeded"`.
 *     5. `moderation`    — response `code` contains `"moderation"` or
 *                          `"content_filter"`. No retry (Requirement
 *                          6.5 / Property 4); the surrounding pipeline
 *                          is single-shot, so simply not retrying here
 *                          is sufficient.
 *     6. `upstream-failure` — `code === "AGENT_DOMAIN_MISMATCH"` or
 *                             `"OPENAI_IMAGE_EDIT_FAILED"` (verbatim
 *                             code preserved in `errorSummary` +
 *                             `upstreamCode`), or any other non-OK /
 *                             malformed-body case.
 *   The classifier runs on BOTH non-OK responses AND OK responses
 *   that still carry a failure-indicating `code` field — some proxies
 *   return HTTP 200 with `code: "moderation_blocked"`.
 *
 * Hard constraints carried over from design.md §"ImageApiClient":
 * - `IMAGE_GEN_API_KEY` is read **only** here. Browsers must never see
 *   the raw key in any response payload (Requirement 7.1 / 7.2).
 * - `getResolvedConfig()` is pure: no `Date.now()`, no global mutation,
 *   no module-level cache. Callers (factory) decide caching policy.
 * - Defaults: `model = "gpt-image-2"`, `path = "/v1/images/generations"`,
 *   `defaultSize = "1K"`, `defaultAspect = "1:1"`, `timeoutMs = 60_000`.
 * - `apiKey` and `baseUrl` are returned as `string | null` because the
 *   `key-missing` and `env-disabled` fallback tiers depend on
 *   distinguishing "unset / empty" from "set". `baseUrl` has no default —
 *   it is operator-supplied per environment.
 * - `disabled: boolean` surfaces the `env-disabled` gate computed from
 *   `IMAGE_GEN_DISABLED` and `AUTOPILOT_REAL_RUNTIME`. Reading the
 *   master-switch env here keeps the diagnostics surface single-source
 *   and lets `generate()` short-circuit without re-reading
 *   `process.env` on each call.
 *
 * See:
 * - design.md §"ImageApiClient — `image-api-client.ts`" (interface shape)
 * - design.md §"`ImageGenConfig` (env schema)" (defaults + validation)
 * - requirements 5.1, 5.2, 5.3, 5.5, 7.1, 7.2, 18.1
 */

import type { FallbackTier } from "../../../../shared/blueprint/contracts.js";

// ---------------------------------------------------------------------------
// Enum constants — every value MUST match design.md exactly
// ---------------------------------------------------------------------------

/**
 * Allowed `model` values (design §"ImageApiClient" + Requirement 5.3).
 * Order is the canonical enumeration order; do not sort.
 */
export const IMAGE_GEN_MODELS = [
  "gpt-image-2",
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
] as const;

export type ImageGenModel = (typeof IMAGE_GEN_MODELS)[number];

/**
 * Allowed `image_size` values (Requirement 5.2). Strings, not pixel
 * counts — the upstream proxy expects literal `"1K"` / `"512"` etc.
 */
export const IMAGE_GEN_SIZES = ["1K", "2K", "4K", "512"] as const;

export type ImageGenSize = (typeof IMAGE_GEN_SIZES)[number];

/**
 * Allowed `aspect_ratio` values (Requirement 5.2).
 */
export const IMAGE_GEN_ASPECTS = ["1:1", "2:3", "3:2", "auto"] as const;

export type ImageGenAspect = (typeof IMAGE_GEN_ASPECTS)[number];

/**
 * Allowed `IMAGE_GEN_PATH` values (Requirement 5.5). Default is
 * `/v1/images/generations`; `/v1/image/created` is a legacy compatibility
 * path kept because the reference `imageTest(2).html` proxy supports both.
 */
export const IMAGE_GEN_PATHS = [
  "/v1/images/generations",
  "/v1/image/created",
] as const;

export type ImageGenPath = (typeof IMAGE_GEN_PATHS)[number];

// ---------------------------------------------------------------------------
// Defaults — kept as named constants so later tasks can reuse them
// ---------------------------------------------------------------------------

export const DEFAULT_IMAGE_GEN_MODEL: ImageGenModel = "gpt-image-2";
export const DEFAULT_IMAGE_GEN_PATH: ImageGenPath = "/v1/images/generations";
export const DEFAULT_IMAGE_GEN_SIZE: ImageGenSize = "1K";
export const DEFAULT_IMAGE_GEN_ASPECT: ImageGenAspect = "1:1";
export const DEFAULT_IMAGE_GEN_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Resolved config
// ---------------------------------------------------------------------------

/**
 * Snapshot of the seven `IMAGE_GEN_*` environment variables after parsing
 * + validation. Always populated with safe values — invalid input falls
 * back to the documented default and an entry is appended to
 * {@link ResolvedImageGenConfig.errors} so the diagnostics surface (see
 * `AutopilotImageSettingsPanel`) can render "configured but invalid"
 * differently from "unset".
 *
 * Field semantics:
 * - `apiKey` — `null` when unset OR empty after trimming. Triggers the
 *   `key-missing` fallback tier in the future {@link ImageApiClient.generate}
 *   (Requirement 6.2).
 * - `baseUrl` — `null` when unset OR empty after trimming. There is no
 *   default; operator must configure this per environment.
 * - `model` / `path` / `defaultSize` / `defaultAspect` — always one of
 *   the documented enum values.
 * - `timeoutMs` — always a positive integer (≥ 1). Non-integer or
 *   ≤ 0 input is replaced with {@link DEFAULT_IMAGE_GEN_TIMEOUT_MS}.
 * - `disabled` — `true` when EITHER `IMAGE_GEN_DISABLED === "true"` OR
 *   `AUTOPILOT_REAL_RUNTIME === "false"`. This is the highest-priority
 *   pre-flight gate in `generate()` (Property 4 / Requirement 6.1).
 *   Both env vars are read here so that a single client instance shares
 *   a frozen view of the gate and downstream code never has to read
 *   `process.env` again. The two non-`IMAGE_GEN_*` envs read here are
 *   intentional: `AUTOPILOT_REAL_RUNTIME` is the project-wide master
 *   switch (`autopilot-capability-runtime-enablement` spec), and
 *   `IMAGE_GEN_DISABLED` is the local image-only kill switch.
 * - `errors` — human-readable summaries of every fallback that
 *   happened during this resolve. Empty array means the env was
 *   well-formed.
 */
export interface ResolvedImageGenConfig {
  readonly apiKey: string | null;
  readonly baseUrl: string | null;
  readonly model: ImageGenModel;
  readonly path: ImageGenPath;
  readonly defaultSize: ImageGenSize;
  readonly defaultAspect: ImageGenAspect;
  readonly timeoutMs: number;
  readonly disabled: boolean;
  readonly errors: string[];
}

/**
 * Read every `IMAGE_GEN_*` env variable in one pass and return a
 * normalised {@link ResolvedImageGenConfig}.
 *
 * - Pure: same input → same output. No `Date.now()`, no random, no
 *   module-level mutation.
 * - Default source is `process.env`; tests can pass a synthetic
 *   {@link NodeJS.ProcessEnv} to control the snapshot fully.
 * - All string values are `.trim()`-ed before validation. An empty
 *   string after trim is treated identically to "unset" (returned as
 *   `null` for `apiKey` / `baseUrl`, default for the four enum fields,
 *   default for `timeoutMs`).
 * - Invalid enum values fall back to the documented default and append
 *   a descriptive entry to `errors`.
 * - Non-integer or ≤ 0 `IMAGE_GEN_TIMEOUT_MS` falls back to
 *   {@link DEFAULT_IMAGE_GEN_TIMEOUT_MS} with an `errors` entry.
 */
export function getResolvedConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedImageGenConfig {
  const errors: string[] = [];

  const apiKey = readNullableString(env, "IMAGE_GEN_API_KEY");
  const baseUrl = readNullableString(env, "IMAGE_GEN_BASE_URL");

  const model = readEnumWithDefault(
    env,
    "IMAGE_GEN_MODEL",
    IMAGE_GEN_MODELS,
    DEFAULT_IMAGE_GEN_MODEL,
    errors,
  );
  const path = readEnumWithDefault(
    env,
    "IMAGE_GEN_PATH",
    IMAGE_GEN_PATHS,
    DEFAULT_IMAGE_GEN_PATH,
    errors,
  );
  const defaultSize = readEnumWithDefault(
    env,
    "IMAGE_GEN_DEFAULT_SIZE",
    IMAGE_GEN_SIZES,
    DEFAULT_IMAGE_GEN_SIZE,
    errors,
  );
  const defaultAspect = readEnumWithDefault(
    env,
    "IMAGE_GEN_DEFAULT_ASPECT",
    IMAGE_GEN_ASPECTS,
    DEFAULT_IMAGE_GEN_ASPECT,
    errors,
  );
  const timeoutMs = readPositiveIntegerWithDefault(
    env,
    "IMAGE_GEN_TIMEOUT_MS",
    DEFAULT_IMAGE_GEN_TIMEOUT_MS,
    errors,
  );

  // ---------------------------------------------------------------------
  // Resolve the `env-disabled` gate (Property 4 / Requirement 6.1).
  //
  // Two independent kill switches feed the same boolean:
  //   - `IMAGE_GEN_DISABLED=true`        → image-only kill switch
  //   - `AUTOPILOT_REAL_RUNTIME=false`   → project-wide master switch
  //     (see `autopilot-capability-runtime-enablement` spec).
  //
  // Reads use the same trim-and-compare logic as the rest of this
  // function so `"  true  "` / `"FALSE"` are handled consistently with
  // the broader `runtime-enablement/resolver.ts` semantics.
  // ---------------------------------------------------------------------
  const imageGenDisabled = readBooleanLiteral(env, "IMAGE_GEN_DISABLED");
  const autopilotRealRuntime = readBooleanLiteral(env, "AUTOPILOT_REAL_RUNTIME");
  const disabled =
    imageGenDisabled === true || autopilotRealRuntime === false;

  return {
    apiKey,
    baseUrl,
    model,
    path,
    defaultSize,
    defaultAspect,
    timeoutMs,
    disabled,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Pure parse helpers (no IO, no mutation of env)
// ---------------------------------------------------------------------------

/**
 * Read a string env variable, trim whitespace, and return `null` when
 * the value is unset or empty after trimming. Used for `IMAGE_GEN_API_KEY`
 * and `IMAGE_GEN_BASE_URL` where "unset" is a meaningful state that
 * downstream tier detection depends on (Requirements 6.2 / 7.1 / 7.2).
 */
function readNullableString(
  env: NodeJS.ProcessEnv,
  name: string,
): string | null {
  const raw = env[name];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Read a `"true"` / `"false"` env variable (case-insensitive after
 * trim). Returns `true` / `false` for the two recognised literals,
 * `null` for unset / empty / unrecognised values. Used for the
 * `env-disabled` pre-flight gate which combines `IMAGE_GEN_DISABLED`
 * and `AUTOPILOT_REAL_RUNTIME`. Unrecognised values intentionally fall
 * through to `null` so that, e.g., a typo'd `IMAGE_GEN_DISABLED="yes"`
 * does NOT silently disable image generation — the gate only fires on
 * the documented `"true"` / `"false"` literals.
 */
function readBooleanLiteral(
  env: NodeJS.ProcessEnv,
  name: string,
): boolean | null {
  const raw = env[name];
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  return null;
}

/**
 * Read an enum env variable. Empty / unset values silently use the
 * default (no `errors` entry — that is normal operator behaviour).
 * Set-but-invalid values fall back to the default AND append a
 * descriptive `errors` entry so the diagnostics panel can surface the
 * misconfiguration without breaking pipeline execution.
 */
function readEnumWithDefault<T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: ReadonlyArray<T>,
  fallback: T,
  errors: string[],
): T {
  const raw = env[name];
  if (typeof raw !== "string") {
    return fallback;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  if ((allowed as ReadonlyArray<string>).includes(trimmed)) {
    return trimmed as T;
  }
  errors.push(
    `${name}=${JSON.stringify(trimmed)} is not one of ${JSON.stringify(
      allowed,
    )}; falling back to ${JSON.stringify(fallback)}.`,
  );
  return fallback;
}

/**
 * Read a positive-integer env variable. The accepted form is a decimal
 * string with optional leading whitespace, e.g. `"60000"`. Anything that
 * fails `Number.isInteger` or is ≤ 0 falls back to the supplied default
 * and appends an `errors` entry.
 */
function readPositiveIntegerWithDefault(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  errors: string[],
): number {
  const raw = env[name];
  if (typeof raw !== "string") {
    return fallback;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  // Number(trimmed) accepts "60000.0" → 60000 which would silently widen
  // the contract; force an integer-only parse via Number.isInteger so
  // floats / `"abc"` / `"NaN"` / `" 60000 "` all consistently round-trip
  // through the fallback.
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    errors.push(
      `${name}=${JSON.stringify(trimmed)} is not a positive integer; falling back to ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// ImageApiClient — request / response / failure shapes
// ---------------------------------------------------------------------------

/**
 * Outgoing request body for the gpt-image-2 / gemini-* proxy. Field set
 * is FROZEN at six keys (Requirements 5.1 / Property 2). `response_format`
 * and `n` are pinned literals so the type system can enforce the contract.
 */
export interface ImageApiRequest {
  readonly model: ImageGenModel;
  readonly prompt: string;
  readonly response_format: "b64_json";
  readonly image_size: ImageGenSize;
  readonly aspect_ratio: ImageGenAspect;
  readonly n: 1;
}

/**
 * Successful image response (Requirement 5.6). Fields are produced by
 * decoding `json.data[0].b64_json` and `json.data[0].mime_type`.
 */
export interface ImageApiSuccess {
  readonly kind: "ok";
  readonly b64Json: string;
  readonly mimeType: string;
  readonly durationMs: number;
  readonly model: ImageGenModel;
  readonly upstreamRequestId?: string;
}

/**
 * Reason for an `ImageApiFailure`. The discriminator string set is
 * identical to {@link FallbackTier} from `shared/blueprint/contracts.ts`,
 * so callers can pipe it straight into
 * `BlueprintEffectPreview.progressPlan[].fallbackTier` and
 * `BlueprintEffectPreview.textOnlyEffectPreview.reason` without
 * remapping (Requirement 6.4).
 */
export type ImageApiFailureReason = FallbackTier;

/**
 * Failure result. Never thrown — `generate()` resolves with this shape
 * for every error condition (env disabled, key missing, timeout, quota,
 * moderation, generic upstream failure). `upstreamCode` retains the
 * verbatim upstream code (e.g. `AGENT_DOMAIN_MISMATCH`,
 * `OPENAI_IMAGE_EDIT_FAILED`) so the diagnostics panel can show the raw
 * value (Requirement 5.7 / Property 4).
 */
export interface ImageApiFailure {
  readonly kind: "error";
  readonly tier: ImageApiFailureReason;
  readonly upstreamCode?:
    | "AGENT_DOMAIN_MISMATCH"
    | "OPENAI_IMAGE_EDIT_FAILED"
    | string;
  readonly errorSummary: string;
  readonly durationMs: number;
}

/** Tagged union returned by {@link ImageApiClient.generate}. */
export type ImageApiResult = ImageApiSuccess | ImageApiFailure;

/**
 * Service interface for Stage C step 4. The factory ships the real
 * `generate()` HTTP path in task 2.2 with minimal env-disabled /
 * key-missing pre-flight gating; the full 6-tier fallback detector
 * (timeout / quota / moderation / upstream-code mapping) lands in
 * task 2.3.
 */
export interface ImageApiClient {
  /**
   * Issue a single-node image generation request. Resolves with either
   * {@link ImageApiSuccess} or {@link ImageApiFailure} — never throws,
   * never rejects (Requirement 6.4 / Property 4).
   */
  generate(request: ImageApiRequest): Promise<ImageApiResult>;
}

// ---------------------------------------------------------------------------
// Factory shell
// ---------------------------------------------------------------------------

/**
 * Optional dependencies for {@link createImageApiClient}. All three
 * keys are injected for testability:
 *
 * - `env` — alternative {@link NodeJS.ProcessEnv} snapshot. The factory
 *   resolves config eagerly via {@link getResolvedConfig} so a single
 *   client instance always sees a frozen view of the env, even if the
 *   process env mutates later.
 * - `fetchFn` — alternative fetch implementation (defaults to global
 *   `fetch`). Used by the real HTTP path in `generate()` and by tests
 *   to stub upstream responses without touching the network.
 * - `clock` — millisecond clock used for `durationMs` accounting and
 *   the `AbortController` timeout. Defaults to `Date.now`. Tests can
 *   pass a deterministic counter to assert exact durations.
 */
export interface CreateImageApiClientOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchFn?: typeof fetch;
  readonly clock?: () => number;
}

/**
 * Construct an {@link ImageApiClient}. The factory resolves config
 * eagerly via {@link getResolvedConfig} so every `generate()` call
 * shares a frozen snapshot (no per-call env reads — Requirement 7.1).
 *
 * `generate()` implements the full 6-tier fallback detector
 * (Property 4), evaluated in strict priority order:
 *   1. `env-disabled`  — `config.disabled === true` OR
 *                        `config.baseUrl === null`. 0 outgoing
 *                        requests.
 *   2. `key-missing`   — `config.apiKey === null`. 0 outgoing.
 *   3. `timeout`       — fetch aborted by the `timeoutMs` watchdog.
 *   4. `quota`         — HTTP 429 OR response `code` contains
 *                        `"quota_exceeded"`.
 *   5. `moderation`    — response `code` contains `"moderation"` or
 *                        `"content_filter"` (substring,
 *                        case-sensitive). Single-shot dispatch
 *                        guarantees outgoing-request count ≤ 1
 *                        (Requirement 6.5).
 *   6. `upstream-failure` — `code === "AGENT_DOMAIN_MISMATCH"` or
 *                           `"OPENAI_IMAGE_EDIT_FAILED"` (verbatim
 *                           code preserved in `upstreamCode` /
 *                           `errorSummary`), or any other non-OK or
 *                           malformed-body case.
 *
 * The classifier runs on BOTH non-OK responses AND OK responses that
 * still carry a failure-indicating `code` field — some proxies return
 * HTTP 200 with `code: "moderation_blocked"`.
 *
 * The factory:
 * - eagerly resolves config so every `generate()` call shares a frozen
 *   snapshot (Requirement 7.1);
 * - falls back to the global `fetch` when none is injected;
 * - uses the injected `clock` (or `Date.now`) for `durationMs`
 *   accounting around every fetch.
 */
export function createImageApiClient(
  options: CreateImageApiClientOptions = {},
): ImageApiClient {
  const env = options.env ?? process.env;
  const fetchFn: typeof fetch =
    options.fetchFn ??
    (globalThis.fetch as typeof fetch | undefined) ??
    ((..._args: Parameters<typeof fetch>) => {
      return Promise.reject(
        new Error(
          "ImageApiClient: global fetch is not available in this runtime.",
        ),
      );
    });
  const clock: () => number = options.clock ?? Date.now;

  const config = getResolvedConfig(env);

  return {
    async generate(request: ImageApiRequest): Promise<ImageApiResult> {
      // -----------------------------------------------------------------
      // Tier 1 — env-disabled (highest priority).
      //
      // Property 4 requires this to short-circuit before ANY outgoing
      // request. The gate is OR'd from two env vars:
      //   - `IMAGE_GEN_DISABLED=true`     (image-only kill switch)
      //   - `AUTOPILOT_REAL_RUNTIME=false` (project master switch)
      // The third historical condition — `baseUrl === null` — is also
      // funnelled into this tier because operating with no proxy URL
      // is operationally indistinguishable from "image generation is
      // disabled" and we must never attempt a fetch against an empty
      // URL.
      // -----------------------------------------------------------------
      if (config.disabled) {
        return {
          kind: "error",
          tier: "env-disabled",
          errorSummary:
            "Image generation is disabled via IMAGE_GEN_DISABLED=true or AUTOPILOT_REAL_RUNTIME=false.",
          durationMs: 0,
        };
      }
      if (config.baseUrl === null) {
        return {
          kind: "error",
          tier: "env-disabled",
          errorSummary:
            "IMAGE_GEN_BASE_URL is not configured; image generation is disabled.",
          durationMs: 0,
        };
      }

      // -----------------------------------------------------------------
      // Tier 2 — key-missing. Also a 0-outgoing-request gate.
      // -----------------------------------------------------------------
      if (config.apiKey === null) {
        return {
          kind: "error",
          tier: "key-missing",
          errorSummary:
            "IMAGE_GEN_API_KEY is not configured; cannot authenticate against the image proxy.",
          durationMs: 0,
        };
      }

      // -----------------------------------------------------------------
      // Build URL: trim a trailing slash from baseUrl so both
      // "https://x.com" and "https://x.com/" produce the same canonical
      // URL when concatenated with config.path (which starts with "/").
      // -----------------------------------------------------------------
      const baseUrl = config.baseUrl.replace(/\/+$/, "");
      const url = `${baseUrl}${config.path}`;

      // -----------------------------------------------------------------
      // Pin the body to exactly the six contractual fields. We rebuild
      // the object literal rather than spreading `request` so that any
      // accidental extra key from a caller is dropped before reaching
      // the proxy (Property 2 — "exactly 6 keys").
      // -----------------------------------------------------------------
      const body = JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        response_format: request.response_format,
        image_size: request.image_size,
        aspect_ratio: request.aspect_ratio,
        n: request.n,
      });

      const controller = new AbortController();
      const timeoutMs = config.timeoutMs;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const startMs = clock();

      try {
        // ---------------------------------------------------------------
        // Single fetch dispatch. NOTE: only one request per `generate()`
        // call — the surrounding pipeline never retries (Requirement
        // 6.5: moderation MUST NOT trigger a retry; the simplest way to
        // honour that is to keep the dispatch single-shot here).
        // ---------------------------------------------------------------
        const response = await fetchFn(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body,
          signal: controller.signal,
        });

        const durationMs = () => Math.max(0, clock() - startMs);
        const upstreamRequestId =
          response.headers.get("x-request-id") ??
          response.headers.get("x-amzn-requestid") ??
          undefined;

        // ---------------------------------------------------------------
        // Read the body once. Both the failure classifier and the
        // success decoder operate on the same parsed value so we do
        // not double-consume the response stream.
        // ---------------------------------------------------------------
        const parsed = await safeJson(response);

        // ---------------------------------------------------------------
        // Classifier. Runs on BOTH non-OK responses AND OK responses
        // that still carry a failure-indicating `code` field — some
        // proxies return HTTP 200 with `code: "moderation_blocked"`.
        // The classifier walks tiers 4 → 5 → 6 (timeout is handled in
        // the catch block below; tiers 1 and 2 never reach this path).
        // ---------------------------------------------------------------
        const classified = classifyResponseFailure(response.status, parsed);
        if (classified) {
          return {
            kind: "error",
            tier: classified.tier,
            ...(classified.upstreamCode
              ? { upstreamCode: classified.upstreamCode }
              : {}),
            errorSummary: classified.errorSummary,
            durationMs: durationMs(),
          };
        }

        // ---------------------------------------------------------------
        // No tier matched — by classifier construction, response.ok is
        // guaranteed `true` here (any non-2xx status would have been
        // caught by the upstream-failure catch-all inside
        // `classifyResponseFailure`). Decode the success payload; a
        // malformed body at this point is the lowest-priority
        // upstream-failure.
        // ---------------------------------------------------------------
        const decoded = decodeImageApiSuccess(parsed);
        if (!decoded) {
          return {
            kind: "error",
            tier: "upstream-failure",
            errorSummary:
              "Malformed image API response: expected json.data[0].b64_json and json.data[0].mime_type.",
            durationMs: durationMs(),
          };
        }

        return {
          kind: "ok",
          b64Json: decoded.b64Json,
          mimeType: decoded.mimeType,
          durationMs: durationMs(),
          model: request.model,
          ...(upstreamRequestId ? { upstreamRequestId } : {}),
        };
      } catch (error) {
        const durationMs = Math.max(0, clock() - startMs);
        // ---------------------------------------------------------------
        // Tier 3 — timeout. AbortController fired due to the
        // `timeoutMs` watchdog above. Detect via `name === "AbortError"`
        // (the standard fetch behaviour) and a defensive message-regex
        // fallback for runtimes that surface aborts as plain `Error`.
        // ---------------------------------------------------------------
        const isAbort =
          (error instanceof Error && error.name === "AbortError") ||
          (error instanceof Error && /abort/i.test(error.message));
        if (isAbort) {
          return {
            kind: "error",
            tier: "timeout",
            errorSummary: `Image API request aborted after ${timeoutMs}ms timeout.`,
            durationMs,
          };
        }
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          kind: "error",
          tier: "upstream-failure",
          errorSummary: message.slice(0, 240),
          durationMs,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internal response decoding helpers
// ---------------------------------------------------------------------------

/**
 * Build a short excerpt of an already-parsed response body for embedding
 * in `errorSummary`. Object inputs are JSON-stringified and clipped at
 * 200 chars so we never leak large upstream payloads or PII into logs.
 * Returns the empty string when the body could not be parsed.
 */
function excerptFromParsed(parsed: unknown): string {
  if (parsed == null) {
    return "";
  }
  if (typeof parsed === "string") {
    return parsed.slice(0, 200);
  }
  try {
    return JSON.stringify(parsed).slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * Parse the response as JSON without throwing. Returns `null` for any
 * parse failure so the caller can map it to an `upstream-failure` tier.
 */
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * 6-tier fallback classifier for an upstream response (Property 4 /
 * Requirements 5.7, 6.1, 6.2, 6.5, 7.3).
 *
 * Tiers 1 (env-disabled) and 2 (key-missing) are decided pre-flight
 * inside `generate()` and never reach this function. Tier 3 (timeout)
 * is decided in the catch block. This function evaluates the remaining
 * three response-driven tiers in strict priority order:
 *
 *   4. quota          — HTTP 429 OR `code` contains `"quota_exceeded"`
 *   5. moderation     — `code` contains `"moderation"` or
 *                       `"content_filter"` (substring, case-sensitive
 *                       per task spec)
 *   6. upstream-failure — `code === "AGENT_DOMAIN_MISMATCH"` or
 *                         `"OPENAI_IMAGE_EDIT_FAILED"`. The verbatim
 *                         upstream code is preserved in both
 *                         `upstreamCode` and `errorSummary` so the
 *                         settings panel can show e.g.
 *                         `"AGENT_DOMAIN_MISMATCH: ..."` or surface a
 *                         BASE_URL-mismatch hint.
 *
 * Returns `null` when the response is OK and carries no failure code,
 * which signals the caller to proceed to success decoding. Returns a
 * concrete failure descriptor otherwise — INCLUDING for non-OK
 * responses with an unrecognised body (which becomes
 * `upstream-failure`). The classifier intentionally does NOT include a
 * `durationMs` field; the caller stamps that from its own clock so all
 * failure paths share one source of truth for elapsed time.
 *
 * Implementation note (Property 4 priority): the order of the
 * `if`-cascade below mirrors the canonical sequence
 * `["quota", "moderation", "upstream-failure"]`. Each branch returns
 * immediately, so a higher-priority match always wins — a body whose
 * `code` somehow contains both `"quota_exceeded"` and
 * `"moderation_blocked"` would be classified as `quota`.
 */
function classifyResponseFailure(
  status: number,
  parsed: unknown,
):
  | {
      readonly tier: FallbackTier;
      readonly errorSummary: string;
      readonly upstreamCode?: string;
    }
  | null {
  const code = readResponseCode(parsed);
  const messageHint = readResponseMessage(parsed);

  // Tier 4 — quota. HTTP 429 wins on its own, even when the body has
  // no `code`. A `code` substring match is the secondary trigger and
  // also fires on 200 responses.
  if (status === 429 || (code !== null && code.includes("quota_exceeded"))) {
    const summary =
      `Image proxy reported quota exhaustion` +
      (status === 429 ? ` (HTTP 429)` : "") +
      (code ? `: code=${code}` : "") +
      (messageHint ? ` — ${messageHint}` : "");
    return {
      tier: "quota",
      errorSummary: summary.slice(0, 240),
      ...(code ? { upstreamCode: code } : {}),
    };
  }

  // Tier 5 — moderation. Substring match is case-sensitive per the
  // task spec; the upstream codes commonly seen in `imageTest(2).html`
  // are `moderation_blocked` and `content_filter_violation`. The
  // surrounding pipeline never retries (single-shot dispatch above),
  // so simply emitting this tier honours the "outgoing request count
  // ≤ 1 (no retry)" requirement (6.5).
  if (code !== null && (code.includes("moderation") || code.includes("content_filter"))) {
    const summary =
      `Image proxy rejected content for moderation: code=${code}` +
      (messageHint ? ` — ${messageHint}` : "");
    return {
      tier: "moderation",
      errorSummary: summary.slice(0, 240),
      upstreamCode: code,
    };
  }

  // Tier 6 — upstream-failure. The two well-known upstream codes are
  // mapped here with their literal value preserved in `errorSummary`
  // so the settings panel can pattern-match on `AGENT_DOMAIN_MISMATCH`
  // to surface the BASE_URL hint (Requirement 5.7 / Property 4).
  if (code === "AGENT_DOMAIN_MISMATCH" || code === "OPENAI_IMAGE_EDIT_FAILED") {
    const summary =
      `${code}` + (messageHint ? `: ${messageHint}` : "");
    return {
      tier: "upstream-failure",
      errorSummary: summary.slice(0, 240),
      upstreamCode: code,
    };
  }

  // Catch-all upstream-failure for any non-OK status that did not match
  // a higher-priority tier. OK responses with no recognised failure
  // code fall through to `null` so the caller can decode them.
  if (status < 200 || status >= 300) {
    const excerpt = excerptFromParsed(parsed);
    return {
      tier: "upstream-failure",
      errorSummary:
        `HTTP ${status}` + (excerpt ? `: ${excerpt}` : ""),
      ...(code ? { upstreamCode: code } : {}),
    };
  }

  return null;
}

/**
 * Pull a `code` string out of an arbitrary parsed JSON body. Probes
 * both the top-level `code` and the OpenAI-style nested `error.code`
 * shapes that proxies typically use. Returns `null` when no string
 * `code` is present.
 */
function readResponseCode(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const top = (parsed as { code?: unknown }).code;
  if (typeof top === "string" && top.length > 0) {
    return top;
  }
  const error = (parsed as { error?: unknown }).error;
  if (error && typeof error === "object") {
    const nested = (error as { code?: unknown }).code;
    if (typeof nested === "string" && nested.length > 0) {
      return nested;
    }
  }
  return null;
}

/**
 * Pull a human-readable hint out of `parsed.message` / `parsed.error.message`.
 * Capped at 120 characters so it does not dominate the final
 * `errorSummary`. Returns the empty string when no message is present.
 */
function readResponseMessage(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") {
    return "";
  }
  const top = (parsed as { message?: unknown }).message;
  if (typeof top === "string" && top.length > 0) {
    return top.slice(0, 120);
  }
  const error = (parsed as { error?: unknown }).error;
  if (error && typeof error === "object") {
    const nested = (error as { message?: unknown }).message;
    if (typeof nested === "string" && nested.length > 0) {
      return nested.slice(0, 120);
    }
  }
  return "";
}

/**
 * Validate and extract `{ b64_json, mime_type }` from the proxy response
 * shape `{ data: [{ b64_json, mime_type }] }`. Returns `null` when any
 * part of the shape is missing or wrong-typed so the caller can convert
 * it into a well-formed `upstream-failure` failure.
 */
function decodeImageApiSuccess(
  parsed: unknown,
): { readonly b64Json: string; readonly mimeType: string } | null {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const first = data[0];
  if (!first || typeof first !== "object") {
    return null;
  }
  const b64Json = (first as { b64_json?: unknown }).b64_json;
  const mimeType = (first as { mime_type?: unknown }).mime_type;
  if (typeof b64Json !== "string" || b64Json.length === 0) {
    return null;
  }
  if (typeof mimeType !== "string" || mimeType.length === 0) {
    return null;
  }
  return { b64Json, mimeType };
}
