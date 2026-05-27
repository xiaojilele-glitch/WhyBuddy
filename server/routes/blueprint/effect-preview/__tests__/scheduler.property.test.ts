/**
 * Feature: autopilot-image-rendering-and-visual-system, Property 5: Scheduler topological ordering and per-node fault isolation
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 3.3, 4.1, 4.2, 4.3
 *
 * Four assertions captured by Property 5 (design.md §"Correctness Properties"):
 *
 *  1. **plan ordering** — for any non-empty `dependencyOrder: string[]`, the
 *     `progressPlan` returned by `EffectPreviewScheduler.plan({ dependencyOrder })`
 *     should expose a `nodeId` sequence strictly equal to the input array, and
 *     every entry should start in `state === "pending"`.
 *  2. **per-node fault isolation** — for any random failing subset `F` (encoded
 *     as a boolean mask the same length as `dependencyOrder`), sequentially
 *     applying `markFailed` for indices in `F` and `markCompleted` for the
 *     complement should leave each entry in the expected terminal state with
 *     the right `fallbackTier`, and only the targeted node's state should
 *     change at each step (other nodes' state preserved).
 *  3. **empty-spec gate** — `imageService.runStageC({ ..., specDocuments: [] })`
 *     should not invoke `imageApiClient.generate` at all (zero outgoing
 *     requests), and the resulting `textOnlyEffectPreview` should carry
 *     `active === true` and `reason === "empty-spec"`.
 *  4. **field isolation** — on a successful happy-path run where the SVG
 *     drafter returns a string containing the marker `"STAMP-<missionId>"`,
 *     no `imageBase64ByNodeId[*].b64` value should contain the substring
 *     `"STAMP-"`. The SVG draft and raster fields are disjoint artifacts.
 *
 * Each property runs with `fc.assert(prop, { numRuns: 100 })`. The two example
 * tests (empty-spec gate and field isolation) require asynchronous orchestration
 * through `ImageService.runStageC`, so they are written as single-shot it()
 * cases inside the same describe block — they still validate Property 5
 * sub-clauses that aren't naturally amenable to fast-check generation.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { BlueprintSpecDocument } from "../../../../../shared/blueprint/contracts.js";

import { createEffectPreviewScheduler } from "../scheduler.js";
import { createImageService } from "../image-service.js";
import { createPromptTemplateLibrary } from "../prompt-template-library.js";
import type {
  ImageApiClient,
  ImageApiRequest,
  ImageApiResult,
} from "../image-api-client.js";
import type { SvgArchitectureDrafter } from "../svg-architecture-drafter.js";

// ---------------------------------------------------------------------------
// Stubs — minimal deps that ImageService can drive without network IO.
// ---------------------------------------------------------------------------

/**
 * Build a deterministic `ImageApiClient` stub. The `onGenerate` callback is
 * invoked once per outgoing call, allowing the test to count requests and
 * shape the response per call. Defaults to a successful 1-pixel-style result
 * with a base64 payload that does NOT contain the `"STAMP-"` marker — that
 * way the field-isolation property test only has to override `b64Json` if it
 * wants to inject a marker.
 */
function buildImageApiClientStub(
  onGenerate: (request: ImageApiRequest, callIndex: number) => ImageApiResult,
): { client: ImageApiClient; getCallCount: () => number } {
  let callCount = 0;
  const client: ImageApiClient = {
    async generate(request: ImageApiRequest): Promise<ImageApiResult> {
      const result = onGenerate(request, callCount);
      callCount += 1;
      return result;
    },
  };
  return { client, getCallCount: () => callCount };
}

function buildSvgArchitectureDrafterStub(
  buildSvg: (missionId: string) => string,
): SvgArchitectureDrafter {
  return {
    async draft({ missionId }) {
      return { kind: "ok", svg: buildSvg(missionId) };
    },
  };
}

/**
 * Construct a minimally typed `BlueprintSpecDocument` shaped object. The
 * gate inside `ImageService.runStageC` only inspects `specDocuments.length`,
 * so nothing here needs to be wired to a real document; we cast through
 * `unknown` to satisfy the structural contract without expanding the test
 * surface area.
 */
function buildSpecDocumentStub(nodeId: string): BlueprintSpecDocument {
  return {
    id: `doc-${nodeId}`,
    jobId: "job-stub",
    treeId: "tree-stub",
    nodeId,
    type: "design",
    title: `Title-${nodeId}`,
    summary: `Summary-${nodeId}`,
    content: `Content-${nodeId}`,
    format: "markdown",
    createdAt: "2026-01-01T00:00:00.000Z",
    provenance: {
      jobId: "job-stub",
      githubUrls: [],
      treeVersion: 1,
      // The downstream service does not introspect provenance fields here,
      // so a minimal `nodeType` cast through `unknown` keeps the literal off
      // the public type surface while still satisfying the structural shape.
      nodeType: "spec_document" as unknown as BlueprintSpecDocument["provenance"]["nodeType"],
      nodeTitle: `Title-${nodeId}`,
      nodeSummary: `Summary-${nodeId}`,
      dependencies: [],
      outputs: [],
    },
  };
}

describe("Feature: autopilot-image-rendering-and-visual-system, Property 5: Scheduler topological ordering and per-node fault isolation", () => {
  // -------------------------------------------------------------------------
  // Sub-property 1 — plan ordering
  // -------------------------------------------------------------------------

  it("plan(dependencyOrder) preserves the input nodeId sequence and starts every entry pending", () => {
    fc.assert(
      fc.property(
        // Smart generator: arbitrary dependencyOrder where each id is a
        // non-empty string. Duplicates are allowed because design.md
        // explicitly states that `plan()` accepts any input including
        // repeats — the scheduler only guarantees positional preservation.
        fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
          minLength: 1,
          maxLength: 10,
        }),
        (dependencyOrder) => {
          const scheduler = createEffectPreviewScheduler();
          const plan = scheduler.plan({ dependencyOrder });

          // Length and per-position nodeId equality.
          expect(plan).toHaveLength(dependencyOrder.length);
          expect(plan.map((entry) => entry.nodeId)).toEqual(dependencyOrder);

          // All initial states are "pending".
          for (const entry of plan) {
            expect(entry.state).toBe("pending");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Sub-property 2 — per-node fault isolation via markFailed / markCompleted
  // -------------------------------------------------------------------------

  it("markFailed/markCompleted isolate state changes to the targeted node and preserve the rest", () => {
    // Build a single arbitrary that emits both a unique `dependencyOrder`
    // AND a same-length boolean mask describing which nodes should fail.
    // Using `uniqueArray` keeps node identifiers distinct so we can address
    // each entry exactly once with `markFailed` / `markCompleted` (the
    // scheduler updates the first matching index, so duplicates would
    // confuse the per-node assertion below).
    const arb = fc
      .uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 1,
        maxLength: 8,
      })
      .chain((dependencyOrder) =>
        fc
          .array(fc.boolean(), {
            minLength: dependencyOrder.length,
            maxLength: dependencyOrder.length,
          })
          .map((failureMask) => ({ dependencyOrder, failureMask })),
      );

    fc.assert(
      fc.property(arb, ({ dependencyOrder, failureMask }) => {
        const scheduler = createEffectPreviewScheduler();
        let plan = scheduler.plan({ dependencyOrder });

        // Apply transitions sequentially. After each step, verify that the
        // ONLY entry whose state changed is the one we just touched —
        // i.e., other nodes preserve their previous state across each step.
        for (let i = 0; i < dependencyOrder.length; i += 1) {
          const nodeId = dependencyOrder[i]!;
          const before = plan;
          plan = failureMask[i]
            ? scheduler.markFailed(plan, nodeId, "timeout", "stub")
            : scheduler.markCompleted(plan, nodeId);

          for (let j = 0; j < dependencyOrder.length; j += 1) {
            if (j === i) continue;
            expect(plan[j]!.state).toBe(before[j]!.state);
            expect(plan[j]!.fallbackTier).toBe(before[j]!.fallbackTier);
          }
        }

        // Final per-node terminal-state assertions:
        for (let i = 0; i < dependencyOrder.length; i += 1) {
          const entry = plan[i]!;
          expect(entry.nodeId).toBe(dependencyOrder[i]);
          if (failureMask[i]) {
            expect(entry.state).toBe("failed");
            // `fallbackTier` must be non-empty (a defined FallbackTier).
            expect(entry.fallbackTier).toBe("timeout");
          } else {
            expect(entry.state).toBe("completed");
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Sub-property 3 — empty-spec gate (zero outgoing requests, textOnly).
  // -------------------------------------------------------------------------

  it("empty specDocuments triggers textOnlyEffectPreview(reason='empty-spec') with zero outgoing requests", async () => {
    const { client: imageApiClient, getCallCount } = buildImageApiClientStub(
      // Should never be invoked. The fail-on-call return shape is irrelevant
      // because the assertion below verifies the call count is zero.
      () => ({
        kind: "ok",
        b64Json: "should-not-be-used",
        mimeType: "image/png",
        durationMs: 1,
        model: "gpt-image-2",
      }),
    );
    const svgArchitectureDrafter = buildSvgArchitectureDrafterStub(
      (missionId) => `<svg>STAMP-${missionId}</svg>`,
    );
    const service = createImageService({
      promptTemplateLibrary: createPromptTemplateLibrary(),
      svgArchitectureDrafter,
      scheduler: createEffectPreviewScheduler(),
      imageApiClient,
    });

    const result = await service.runStageC({
      missionId: "mission-empty-spec",
      specDocuments: [], // ← gate trigger
      dependencyOrder: ["alpha", "beta"],
      architectureNotes: ["arch-1"],
    });

    // Property 5 sub-clause 3.a: zero outgoing image API requests.
    expect(getCallCount()).toBe(0);

    // Property 5 sub-clause 3.b: textOnlyEffectPreview present with the
    // canonical empty-spec reason.
    expect(result.textOnlyEffectPreview?.active).toBe(true);
    expect(result.textOnlyEffectPreview?.reason).toBe("empty-spec");

    // Empty-spec gate also short-circuits SVG / raster work.
    expect(result.architectureSvgDraft).toBeUndefined();
    expect(result.imageBase64ByNodeId).toBeUndefined();
    expect(result.progressPlan).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Sub-property 4 — field isolation (architectureSvgDraft vs imageBase64ByNodeId).
  // -------------------------------------------------------------------------

  it("architectureSvgDraft string never appears in imageBase64ByNodeId b64 values on a successful run", async () => {
    const dependencyOrder = ["alpha", "beta", "gamma"];
    const missionId = "mission-stamp";

    // SVG drafter emits a marker so we can search the raster b64 outputs
    // for any leakage of the SVG content into the raster field.
    const svgArchitectureDrafter = buildSvgArchitectureDrafterStub(
      (mid) => `<svg>STAMP-${mid}</svg>`,
    );

    // Image API stub always returns success with a deterministic base64
    // payload that DOES NOT contain "STAMP-". Per-node payload is suffixed
    // with the call index so we can still distinguish entries downstream.
    const { client: imageApiClient, getCallCount } = buildImageApiClientStub(
      (_request, callIndex) => ({
        kind: "ok",
        b64Json: `iVBORw0KGgoAAAANSUhEUg-payload-${callIndex}`,
        mimeType: "image/png",
        durationMs: 5,
        model: "gpt-image-2",
      }),
    );

    const service = createImageService({
      promptTemplateLibrary: createPromptTemplateLibrary(),
      svgArchitectureDrafter,
      scheduler: createEffectPreviewScheduler(),
      imageApiClient,
    });

    const result = await service.runStageC({
      missionId,
      specDocuments: dependencyOrder.map(buildSpecDocumentStub),
      dependencyOrder,
      // task 32.x: this property test still wants every dep to receive a
      // raster call so we can search the resulting b64 entries. Pass an
      // explicit rasterTargets equal to dependencyOrder to retain the
      // pre-32 behavior.
      rasterTargets: dependencyOrder,
      architectureNotes: ["arch-note-1", "arch-note-2"],
    });

    // Sanity: drafter ran, marker landed in the SVG draft field.
    expect(result.architectureSvgDraft).toBeDefined();
    expect(result.architectureSvgDraft).toContain(`STAMP-${missionId}`);

    // Sanity: every node went through one outgoing call.
    expect(getCallCount()).toBe(dependencyOrder.length);
    expect(result.imageBase64ByNodeId).toBeDefined();

    const records = Object.values(result.imageBase64ByNodeId ?? {});
    expect(records).toHaveLength(dependencyOrder.length);

    // Property 5 sub-clause 4: the SVG draft string never appears as a
    // value inside any b64 entry. We assert the cheap and stable check —
    // the marker substring "STAMP-" must not leak across the field
    // boundary.
    for (const record of records) {
      expect(record.b64.includes("STAMP-")).toBe(false);
    }
  });
});
