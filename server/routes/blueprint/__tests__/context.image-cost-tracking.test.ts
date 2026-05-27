/**
 * Phase 4 Task 33.4 — context-level integration test that proves the
 * **default production assembly** of `BlueprintServiceContext` really
 * records cost when the Stage C ImageService runs.
 *
 * Phase 5 Task 43.4 — extends the success-path / failure-path assertions
 * to also prove **honest cost reporting** through the adapter:
 *
 *   - Success path with a known image model now asserts
 *     `record.actualCost > 0` AND equals
 *     `lookupImagePricing("gpt-image-2")` (= $0.04 per Task 43.1's static
 *     pricing table). This closes the silent-under-reporting gap the
 *     audit identified.
 *   - Failure path still asserts `record.actualCost === 0` because
 *     `0` is the **honest** answer for failed calls (no charge).
 *   - A NEW direct-adapter test asserts the defensive `console.warn`
 *     fires when a success-path call records `$0` (i.e. pricing source
 *     is missing for that model — Task 43.3).
 *
 * Test injection strategy
 * -----------------------
 * The brief offers two paths. We pick the **factory test-injection
 * point** (`deps.effectPreviewImageCostTracker?: CostTracker`):
 *
 *   - The `buildBlueprintServiceContext({})` code path STILL calls the
 *     real `createCostTrackerAdapter(...)` factory; `effectPreviewImageCostTracker`
 *     only swaps the underlying `CostTracker` instance from the production
 *     singleton to a hermetic `new CostTracker(tmpHistoryPath)`.
 *
 *   - We deliberately do NOT pass `deps.effectPreviewImageService`. If a
 *     future regression ever drops the `createCostTrackerAdapter(...)` call
 *     from the default ctx assembly (e.g., reverts task 33.3), this test
 *     will fail because the spy never sees `recordCall` — exactly the
 *     guarantee the brief asks for.
 *
 *   - The alternative — building the service ourselves and passing it via
 *     `deps.effectPreviewImageService` — would skip the production
 *     `createCostTrackerAdapter(...)` invocation entirely and would NOT
 *     catch the regression case above.
 *
 * Stub strategy for `imageApiClient`
 * ----------------------------------
 * The default Stage C `imageApiClient` is constructed by
 * `createImageApiClient()` reading `IMAGE_GEN_*` env vars and calling
 * `fetch(...)`. To keep the test hermetic without overriding the entire
 * `effectPreviewImageService`:
 *
 *   1. `vi.stubEnv` provides a fully-populated `IMAGE_GEN_*` snapshot so
 *      none of the 6 fallback tiers short-circuits before the call.
 *   2. `vi.stubGlobal('fetch', ...)` returns a deterministic 200 response
 *      with a fixed `b64_json` / `mime_type` body for every node, OR a
 *      timeout-shaped error for the failure case.
 *
 * Reach
 * -----
 * The default `buildBlueprintServiceContext({...})` factory pulls in real
 * runtime stores, real subscribers, real bridge late-binding, etc. None
 * of these touch the Stage C raster path under our stub fetch + stubbed
 * env, so the cost-tracking assertions are isolated to the path we care
 * about.
 *
 * Validates: Phase 4 Task 33.4 (cost-tracker-adapter wiring proof) +
 *            Phase 5 Task 43.4 (honest image cost reporting).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { CostTracker } from "../../../core/cost-tracker.js";
import type { BlueprintSpecDocument } from "../../../../shared/blueprint/contracts.js";
import { lookupImagePricing } from "../../../../shared/cost.js";
import { createCostTrackerAdapter } from "../effect-preview/cost-tracker-adapter.js";
import { buildBlueprintServiceContext } from "../context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSpecDocument(id: string): BlueprintSpecDocument {
  return {
    id,
    jobId: "job-cost-test",
    treeId: "tree-cost-test",
    nodeId: "node-cost-root",
    type: "requirements",
    status: "accepted",
    version: 1,
    title: `Spec ${id}`,
    summary: `Summary ${id}.`,
    content: `Body ${id}.`,
    format: "markdown",
    createdAt: "2026-05-23T00:00:00.000Z",
    provenance: {
      jobId: "job-cost-test",
      projectId: "project-cost",
      sourceId: "source-cost",
      targetText: "Verify Stage C cost tracking through default ctx.",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "spec_document",
      nodeTitle: "Cost Root",
      nodeSummary: "Cost root spec node.",
      dependencies: [],
      outputs: [],
    },
  };
}

function buildSuccessFetchResponse(): Response {
  // The image-api-client decodes `data[0].b64_json` and `data[0].mime_type`.
  return new Response(
    JSON.stringify({
      data: [
        {
          b64_json: "BASE64-FIXTURE-PAYLOAD",
          mime_type: "image/png",
        },
      ],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function buildTimeoutError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("buildBlueprintServiceContext — Stage C cost tracking integration (Phase 4 Task 33.4)", () => {
  let tmpDir: string;
  let historyPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ctx-image-cost-tracking-"));
    historyPath = join(tmpDir, "cost-history.json");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Populate the full IMAGE_GEN_* snapshot so the resolved client
    // skips env-disabled / key-missing tiers and reaches `fetch`.
    vi.stubEnv("IMAGE_GEN_DISABLED", "false");
    vi.stubEnv("AUTOPILOT_REAL_RUNTIME", "true");
    vi.stubEnv("IMAGE_GEN_API_KEY", "test-image-gen-api-key");
    vi.stubEnv("IMAGE_GEN_BASE_URL", "https://image-proxy.example.test");
    vi.stubEnv("IMAGE_GEN_MODEL", "gpt-image-2");
    vi.stubEnv("IMAGE_GEN_PATH", "/v1/images/generations");
    vi.stubEnv("IMAGE_GEN_DEFAULT_SIZE", "1K");
    vi.stubEnv("IMAGE_GEN_DEFAULT_ASPECT", "1:1");
    vi.stubEnv("IMAGE_GEN_TIMEOUT_MS", "60000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records one CostRecord per Stage C raster target through the default adapter wiring (success path)", async () => {
    // Arrange: hermetic CostTracker + fetch stub returning success.
    const tracker = new CostTracker(historyPath);
    const recordCallSpy = vi.spyOn(tracker, "recordCall");

    const fetchStub = vi.fn(async () => buildSuccessFetchResponse());
    vi.stubGlobal("fetch", fetchStub);

    // Build a default ctx via the production factory; only swap the
    // tracker instance via the test-injection point. We DO NOT pass
    // `effectPreviewImageService` — this is the assertion that the
    // default assembly really wires `createCostTrackerAdapter(...)`.
    const ctx = buildBlueprintServiceContext({
      effectPreviewImageCostTracker: tracker,
    });

    expect(ctx.effectPreviewImageService).toBeDefined();

    const targetIds = ["node-alpha", "node-beta", "node-gamma"] as const;

    // Act: invoke runStageC with N=3 raster targets.
    const result = await ctx.effectPreviewImageService!.runStageC({
      missionId: "mission-cost-success",
      specDocuments: [buildSpecDocument("spec-1")],
      dependencyOrder: [...targetIds],
      rasterTargets: [...targetIds],
      architectureNotes: ["Cockpit cost-tracking integration sanity check."],
    });

    // Assert: 3 successful raster calls, 3 cost records, no fallback.
    expect(fetchStub).toHaveBeenCalledTimes(targetIds.length);
    expect(result.imageBase64ByNodeId).toBeDefined();
    expect(Object.keys(result.imageBase64ByNodeId ?? {})).toHaveLength(
      targetIds.length,
    );
    expect(result.textOnlyEffectPreview).toBeUndefined();

    expect(recordCallSpy).toHaveBeenCalledTimes(targetIds.length);

    // Phase 5 Task 43.4 — `actualCost` MUST be > 0 for successful billable
    // calls (silent-under-reporting fix). The exact value equals the
    // static per-call estimate from `IMAGE_PRICING_TABLE` for `gpt-image-2`
    // (= $0.04 per Task 43.1).
    const expectedPerCallCost = lookupImagePricing("gpt-image-2");
    expect(expectedPerCallCost).toBeGreaterThan(0);

    for (const call of recordCallSpy.mock.calls) {
      const [record] = call;
      expect(record.model).toBe("gpt-image-2");
      expect(record.durationMs).toBeGreaterThanOrEqual(0);
      expect(record.tokensIn).toBe(0);
      expect(record.tokensOut).toBe(0);
      // `actualCost` is now sourced from `lookupImagePricing(model)` on
      // the success path (Task 43.2), routed through the adapter
      // (Task 43.3). NOT 0.
      expect(typeof record.actualCost).toBe("number");
      expect(record.actualCost).toBeGreaterThan(0);
      expect(record.actualCost).toBe(expectedPerCallCost);
      expect(record.error).toBeUndefined();
      // CostRecord identity / timestamp fields must be present.
      expect(typeof record.id).toBe("string");
      expect(record.id.length).toBeGreaterThan(0);
      expect(typeof record.timestamp).toBe("number");
      // Adapter resolves unit prices from PRICING_TABLE -> DEFAULT_PRICING
      // (gpt-image-2 is not in the per-token table → falls back to
      // DEFAULT_PRICING for unitPriceIn / unitPriceOut; per-call
      // `actualCost` comes from IMAGE_PRICING_TABLE separately).
      expect(typeof record.unitPriceIn).toBe("number");
      expect(typeof record.unitPriceOut).toBe("number");
    }

    // Confirm the in-memory tracker reflects the same N records.
    expect(tracker.getRecords()).toHaveLength(targetIds.length);
  });

  it("records `error: 'fallback-tier:timeout'` when the upstream image API times out", async () => {
    const tracker = new CostTracker(historyPath);
    const recordCallSpy = vi.spyOn(tracker, "recordCall");

    // Stub fetch to throw an AbortError-shaped exception so the client
    // maps the failure to tier=timeout.
    const fetchStub = vi.fn(async () => {
      throw buildTimeoutError();
    });
    vi.stubGlobal("fetch", fetchStub);

    const ctx = buildBlueprintServiceContext({
      effectPreviewImageCostTracker: tracker,
    });

    const result = await ctx.effectPreviewImageService!.runStageC({
      missionId: "mission-cost-timeout",
      specDocuments: [buildSpecDocument("spec-1")],
      dependencyOrder: ["node-alpha"],
      rasterTargets: ["node-alpha"],
      architectureNotes: ["Trigger timeout for cost-tracking error path."],
    });

    expect(result.imageBase64ByNodeId).toBeUndefined();
    expect(result.textOnlyEffectPreview?.active).toBe(true);
    expect(result.textOnlyEffectPreview?.reason).toBe("timeout");

    expect(recordCallSpy).toHaveBeenCalledTimes(1);
    const [record] = recordCallSpy.mock.calls[0]!;
    expect(record.model).toBe("gpt-image-2");
    expect(record.error).toBe("fallback-tier:timeout");
    expect(record.tokensIn).toBe(0);
    expect(record.tokensOut).toBe(0);
    expect(record.actualCost).toBe(0);
  });

  it("invokes the real createCostTrackerAdapter inside the default factory (regression guard)", async () => {
    // This is the explicit "do not mock the adapter" assertion. The
    // adapter is consumed by `createImageService(...)` inside
    // `buildBlueprintServiceContext({})` only when the field really
    // makes it into the service deps. We verify that a tracker swapped
    // ONLY through `effectPreviewImageCostTracker` (no other override)
    // observes Stage C calls — proving the production assembly path
    // wires the adapter end-to-end.
    const tracker = new CostTracker(historyPath);
    const recordCallSpy = vi.spyOn(tracker, "recordCall");

    vi.stubGlobal("fetch", vi.fn(async () => buildSuccessFetchResponse()));

    const ctx = buildBlueprintServiceContext({
      effectPreviewImageCostTracker: tracker,
    });

    await ctx.effectPreviewImageService!.runStageC({
      missionId: "mission-regression-guard",
      specDocuments: [buildSpecDocument("spec-1")],
      dependencyOrder: ["only-node"],
      rasterTargets: ["only-node"],
      architectureNotes: [],
    });

    // If a future change drops `createCostTrackerAdapter(...)` from the
    // default assembly, the spy never fires and this assertion fails.
    expect(recordCallSpy).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Phase 5 Task 43.4 — defensive `console.warn` for silent under-reporting.
  //
  // When the adapter records a success-path call (`tier === undefined`) with
  // `estimatedCost === undefined` or `0`, it must `console.warn` so audit
  // trails / log scrapers can spot pricing-source gaps. This is a direct
  // adapter test (no full ctx round-trip) because we need to feed an
  // arbitrary "fake" model name that bypasses `IMAGE_PRICING_TABLE`.
  // --------------------------------------------------------------------------

  it("warns on success-path $0 records (unknown model → pricing source missing)", () => {
    const tracker = new CostTracker(historyPath);
    const recordCallSpy = vi.spyOn(tracker, "recordCall");

    // Suppress noise from the warn the test itself triggers.
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const adapter = createCostTrackerAdapter({ tracker });

    // Cast to bypass the `ImageGenModel` enum constraint — the spec
    // explicitly tests the "unknown model" branch which by definition
    // is not in the enum.
    adapter.record({
      model: "unknown-image-model-X" as unknown as Parameters<
        typeof adapter.record
      >[0]["model"],
      durationMs: 100,
      // No tier (success path), no estimatedCost (missing pricing source).
    });

    expect(recordCallSpy).toHaveBeenCalledTimes(1);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArg = warnSpy.mock.calls[0]?.[0];
    expect(typeof warnArg).toBe("string");
    expect(warnArg as string).toContain("unknown-image-model-X");
    expect(warnArg as string).toContain("$0");

    warnSpy.mockRestore();
  });
});
