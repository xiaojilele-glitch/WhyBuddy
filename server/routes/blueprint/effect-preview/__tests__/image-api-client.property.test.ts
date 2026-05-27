/**
 * Feature: autopilot-image-rendering-and-visual-system,
 *   - Property 2: ImageApiClient request body schema validity
 *   - Property 3: ImageApiClient response round-trip
 *   - Property 4: 6-tier fallback ordering — no tier skipped, highest-priority match wins
 *
 * Validates: Requirements 1.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7,
 *            6.1, 6.2, 6.3, 6.4, 6.5, 8.1
 *
 * Owns three property-based test suites for the {@link ImageApiClient}
 * shipped by `image-api-client.ts`. Each suite is its own `describe`
 * block so the test reporter and the `Feature: ...` tagging convention
 * can both name them independently.
 *
 * The tests never touch the real network. They construct fresh client
 * instances per scenario via `createImageApiClient({ env, fetchFn })`,
 * passing a synthetic `NodeJS.ProcessEnv` to drive `getResolvedConfig`
 * and a `vi.fn()`-backed fetch stub to capture the outgoing request and
 * shape the response.
 */

import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import {
  createImageApiClient,
  IMAGE_GEN_ASPECTS,
  IMAGE_GEN_MODELS,
  IMAGE_GEN_PATHS,
  IMAGE_GEN_SIZES,
  type ImageApiRequest,
  type ImageGenAspect,
  type ImageGenModel,
  type ImageGenPath,
  type ImageGenSize,
} from "../image-api-client.js";
import type { FallbackTier } from "../../../../../shared/blueprint/contracts.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TEST_BASE_URL = "https://image-proxy.example.test";
const TEST_API_KEY = "test-api-key-1234567890ABCDEF";

/**
 * Build a synthetic env snapshot. Keeping the seven `IMAGE_GEN_*`
 * variables in one place ensures every test starts from a known-good
 * configuration and only opts into specific failure conditions through
 * targeted overrides.
 */
function buildEnv(
  overrides: Partial<Record<string, string | undefined>> = {},
): NodeJS.ProcessEnv {
  // `AUTOPILOT_REAL_RUNTIME` is left unset (null) by default; the
  // `env-disabled` gate fires only if it's literally `"false"`.
  const base: NodeJS.ProcessEnv = {
    IMAGE_GEN_BASE_URL: TEST_BASE_URL,
    IMAGE_GEN_API_KEY: TEST_API_KEY,
    IMAGE_GEN_MODEL: "gpt-image-2",
    IMAGE_GEN_PATH: "/v1/images/generations",
    IMAGE_GEN_DEFAULT_SIZE: "1K",
    IMAGE_GEN_DEFAULT_ASPECT: "1:1",
    IMAGE_GEN_TIMEOUT_MS: "60000",
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete base[k];
    } else {
      base[k] = v;
    }
  }
  return base;
}

/**
 * Build a successful upstream Response stub that carries `data[0]`
 * with the supplied b64/mime fields. The shape mirrors the real proxy
 * response so the success decoder path is exercised.
 */
function buildSuccessResponse(b64Json: string, mimeType: string): Response {
  return new Response(
    JSON.stringify({ data: [{ b64_json: b64Json, mime_type: mimeType }] }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// ---------------------------------------------------------------------------
// Property 2 — request body schema validity
// ---------------------------------------------------------------------------

describe("Feature: autopilot-image-rendering-and-visual-system, Property 2: ImageApiClient request body schema validity", () => {
  const requestArb: fc.Arbitrary<ImageApiRequest> = fc.record({
    model: fc.constantFrom<ImageGenModel>(...IMAGE_GEN_MODELS),
    prompt: fc.string({ minLength: 1, maxLength: 200 }),
    response_format: fc.constant("b64_json" as const),
    image_size: fc.constantFrom<ImageGenSize>(...IMAGE_GEN_SIZES),
    aspect_ratio: fc.constantFrom<ImageGenAspect>(...IMAGE_GEN_ASPECTS),
    n: fc.constant(1 as const),
  });

  const pathArb: fc.Arbitrary<ImageGenPath> = fc.constantFrom<ImageGenPath>(
    ...IMAGE_GEN_PATHS,
  );

  it("emits exactly six body fields with valid enum values, Bearer auth, and URL = baseUrl + IMAGE_GEN_PATH", async () => {
    await fc.assert(
      fc.asyncProperty(requestArb, pathArb, async (request, path) => {
        // Capture the (url, init) pair from each fetch call so we can
        // make assertions on the outgoing request shape.
        const fetchFn = vi.fn(
          async (_url: RequestInfo | URL, _init?: RequestInit) => {
            return buildSuccessResponse(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
              "image/png",
            );
          },
        );

        const client = createImageApiClient({
          env: buildEnv({ IMAGE_GEN_PATH: path }),
          fetchFn: fetchFn as unknown as typeof fetch,
        });

        const result = await client.generate(request);
        // Sanity: the success path is taken so we know the request was
        // actually dispatched. We don't assert success contents here —
        // that's Property 3's job.
        expect(result.kind).toBe("ok");

        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [calledUrl, init] = fetchFn.mock.calls[0]!;

        // ---------------------------------------------------------------
        // URL = baseUrl + path. The client trims trailing slashes from
        // baseUrl, so the canonical form is the literal concatenation.
        // ---------------------------------------------------------------
        expect(typeof calledUrl).toBe("string");
        expect(calledUrl).toBe(`${TEST_BASE_URL}${path}`);

        // ---------------------------------------------------------------
        // HTTP method + Authorization header invariants.
        // ---------------------------------------------------------------
        expect(init?.method).toBe("POST");
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers).toBeDefined();
        const authHeader =
          headers?.Authorization ?? headers?.authorization ?? "";
        expect(authHeader).toMatch(/^Bearer .+$/);
        const contentTypeHeader =
          headers?.["Content-Type"] ?? headers?.["content-type"] ?? "";
        expect(contentTypeHeader).toBe("application/json");

        // ---------------------------------------------------------------
        // Body schema invariants: exactly six contractual fields and
        // every value falls inside the documented enum / pinned literal.
        // ---------------------------------------------------------------
        expect(typeof init?.body).toBe("string");
        const body = JSON.parse(init?.body as string) as Record<
          string,
          unknown
        >;
        const keys = Object.keys(body).sort();
        expect(keys).toEqual(
          [
            "aspect_ratio",
            "image_size",
            "model",
            "n",
            "prompt",
            "response_format",
          ].sort(),
        );
        expect(keys).toHaveLength(6);

        expect(IMAGE_GEN_MODELS).toContain(body.model);
        expect(IMAGE_GEN_SIZES).toContain(body.image_size);
        expect(IMAGE_GEN_ASPECTS).toContain(body.aspect_ratio);
        expect(body.response_format).toBe("b64_json");
        expect(body.n).toBe(1);
        expect(typeof body.prompt).toBe("string");

        // Round-trip: the body's enum fields equal the input request's
        // enum fields (the client must not mutate them).
        expect(body.model).toBe(request.model);
        expect(body.image_size).toBe(request.image_size);
        expect(body.aspect_ratio).toBe(request.aspect_ratio);
        expect(body.prompt).toBe(request.prompt);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 — response round-trip
// ---------------------------------------------------------------------------

describe("Feature: autopilot-image-rendering-and-visual-system, Property 3: ImageApiClient response round-trip", () => {
  it("propagates b64_json and mime_type from the upstream response into the success result unchanged", async () => {
    const fixedRequest: ImageApiRequest = {
      model: "gpt-image-2",
      prompt: "round-trip",
      response_format: "b64_json",
      image_size: "1K",
      aspect_ratio: "1:1",
      n: 1,
    };

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 256 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        async (b64Json, mimeType) => {
          const fetchFn = vi.fn(async () => buildSuccessResponse(b64Json, mimeType));
          const client = createImageApiClient({
            env: buildEnv(),
            fetchFn: fetchFn as unknown as typeof fetch,
          });

          const result = await client.generate(fixedRequest);

          expect(result.kind).toBe("ok");
          if (result.kind !== "ok") {
            return;
          }
          expect(result.b64Json).toBe(b64Json);
          expect(result.mimeType).toBe(mimeType);
          expect(result.model).toBe(fixedRequest.model);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4 — 6-tier fallback ordering
// ---------------------------------------------------------------------------

describe("Feature: autopilot-image-rendering-and-visual-system, Property 4: 6-tier fallback ordering — no tier skipped, highest-priority match wins", () => {
  /**
   * Canonical priority order. `fc.subarray` preserves the source-array
   * order, so the expected winning tier is always the first element of
   * the generated subarray.
   */
  const TIERS: readonly FallbackTier[] = [
    "env-disabled",
    "key-missing",
    "timeout",
    "quota",
    "moderation",
    "upstream-failure",
  ];

  type Scenario = {
    readonly env: NodeJS.ProcessEnv;
    readonly fetchFn: ReturnType<typeof vi.fn>;
  };

  /**
   * Build a scenario that activates *every* trigger in `S`. The 6-tier
   * classifier is expected to pick the highest-priority tier (S[0]).
   *
   * Triggers:
   *   - `env-disabled`     → `IMAGE_GEN_DISABLED=true`
   *   - `key-missing`      → unset `IMAGE_GEN_API_KEY`
   *   - `timeout`          → fetch rejects with an AbortError-shaped error
   *   - `quota`            → response { status: 429, body: { code: "quota_exceeded" } }
   *   - `moderation`       → response { status: 200, body: { code: "moderation_blocked" } }
   *   - `upstream-failure` → response { status: 200, body: { code: "AGENT_DOMAIN_MISMATCH" } }
   *
   * The single response body can only carry one `code` field, so when
   * both `moderation` and `upstream-failure` are in `S` we encode the
   * higher-priority `moderation` code (which is what the property
   * predicts will win anyway).
   */
  function buildScenario(S: readonly FallbackTier[]): Scenario {
    const set = new Set(S);
    const expected = TIERS.find((t) => set.has(t));

    const envOverrides: Record<string, string | undefined> = {};
    if (set.has("env-disabled")) {
      envOverrides.IMAGE_GEN_DISABLED = "true";
    }
    if (set.has("key-missing")) {
      envOverrides.IMAGE_GEN_API_KEY = undefined;
    }

    let fetchFn: ReturnType<typeof vi.fn>;
    if (expected === "timeout") {
      fetchFn = vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      });
    } else if (expected === "quota") {
      fetchFn = vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "quota_exceeded" }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }),
      );
    } else if (expected === "moderation") {
      fetchFn = vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "moderation_blocked" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );
    } else if (expected === "upstream-failure") {
      fetchFn = vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "AGENT_DOMAIN_MISMATCH" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );
    } else {
      // expected ∈ { env-disabled, key-missing, undefined } — fetch
      // should never be invoked. Provide a fetch that would have
      // produced a *different* failure if called, so any accidental
      // fetch invocation surfaces clearly.
      fetchFn = vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "moderation_blocked" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );
    }

    return { env: buildEnv(envOverrides), fetchFn };
  }

  const requestStub: ImageApiRequest = {
    model: "gpt-image-2",
    prompt: "fallback-tier-property",
    response_format: "b64_json",
    image_size: "1K",
    aspect_ratio: "1:1",
    n: 1,
  };

  it("non-empty failure subset S: classifier picks the canonical first match in S", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...TIERS], { minLength: 1 }),
        async (S) => {
          const expected = TIERS.find((t) => S.includes(t));
          // Sanity: S is non-empty so `expected` is always defined.
          expect(expected).toBeDefined();

          const { env, fetchFn } = buildScenario(S);
          const client = createImageApiClient({
            env,
            fetchFn: fetchFn as unknown as typeof fetch,
          });

          const result = await client.generate(requestStub);

          // Highest-priority match wins.
          expect(result.kind).toBe("error");
          if (result.kind !== "error") return;
          expect(result.tier).toBe(expected);

          // env-disabled and key-missing both gate before any outgoing
          // request. Every other tier dispatches exactly once (no retry).
          if (expected === "env-disabled" || expected === "key-missing") {
            expect(fetchFn).toHaveBeenCalledTimes(0);
          } else {
            expect(fetchFn).toHaveBeenCalledTimes(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("key-missing alone: zero outgoing fetch calls", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: "x", mime_type: "image/png" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = createImageApiClient({
      env: buildEnv({ IMAGE_GEN_API_KEY: undefined }),
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await client.generate(requestStub);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.tier).toBe("key-missing");
    expect(fetchFn).toHaveBeenCalledTimes(0);
  });

  it("moderation: outgoing fetch count ≤ 1 (no retry)", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "moderation_blocked" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = createImageApiClient({
      env: buildEnv(),
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await client.generate(requestStub);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.tier).toBe("moderation");
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("upstream code AGENT_DOMAIN_MISMATCH: tier=upstream-failure and errorSummary preserves the literal code", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "AGENT_DOMAIN_MISMATCH", message: "domain check failed" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = createImageApiClient({
      env: buildEnv(),
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await client.generate(requestStub);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.tier).toBe("upstream-failure");
    expect(result.errorSummary).toContain("AGENT_DOMAIN_MISMATCH");
    expect(result.upstreamCode).toBe("AGENT_DOMAIN_MISMATCH");
  });

  it("upstream code OPENAI_IMAGE_EDIT_FAILED: tier=upstream-failure and errorSummary preserves the literal code", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "OPENAI_IMAGE_EDIT_FAILED", message: "edit failed" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = createImageApiClient({
      env: buildEnv(),
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await client.generate(requestStub);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.tier).toBe("upstream-failure");
    expect(result.errorSummary).toContain("OPENAI_IMAGE_EDIT_FAILED");
    expect(result.upstreamCode).toBe("OPENAI_IMAGE_EDIT_FAILED");
  });
});
