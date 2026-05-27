// Phase 5 Task 40.3 cross-reference:
// This file covers `runStageC` CONTRACT in isolation (rasterTargets + dependencyOrder split).
// The route-level fan-out proof — i.e., that `generateEffectPreviews` actually passes
// `rasterTargets: [input.node.id]` for each target — lives in
// `./generate-batch-call-count.route.test.ts` (Phase 5 Task 40).
// If that file ever drifts apart from this one, the audit gap returns.

/**
 * Stage C raster granularity — batch generate-call count
 * (`autopilot-image-rendering-and-visual-system` spec, Phase 4 task 32.3 + 32.4).
 *
 * Validates: Requirements 1.1, 1.2, 4.1, 4.2, 7.3, 8.1
 *
 * **Background**
 *
 * `generateEffectPreviews()` (server/routes/blueprint.ts) runs
 * `Promise.all(targetNodes.map(buildEffectPreview))`, and each
 * `buildEffectPreview` invokes `runStageC(...)`. Before task 32, every
 * `runStageC` call rastered the FULL `dependencyOrder` array, causing batch
 * generation of N target nodes to amplify to O(N × M) `imageApiClient.generate`
 * calls (where M is dependency-chain length). Task 32 introduces a
 * `rasterTargets` field that decouples the explicit generate-call list from
 * the timeline-only `dependencyOrder` metadata; `buildEffectPreview` now
 * passes `rasterTargets: [input.node.id]` so the per-target cost is O(1).
 *
 * **What this file tests**
 *
 * Invoking `runStageC` 3 times (once per target node, mirroring the
 * `generateEffectPreviews` per-target fan-out) with 3 distinct target nodes
 * and overlapping `dependencyOrder` chains, and asserting that the spied
 * `imageApiClient.generate` is invoked **exactly 3 times** — never more —
 * and that the called nodeIds are exactly the 3 raster targets, not the
 * dependency-chain shared nodes.
 *
 * The test deliberately does NOT spin up the full Express server
 * (`generateEffectPreviews` is not exported); instead it simulates the
 * per-target loop using the same `runStageC` contract that
 * `buildEffectPreview` uses in production. The contract under test is the
 * same regardless of whether the loop is driven by `Promise.all` inside
 * `generateEffectPreviews` or by a `for` loop here.
 *
 * **Fallback scenarios (task 32.4)**
 *
 * - `IMAGE_GEN_DISABLED=true` env stub → 0 outgoing calls.
 * - `IMAGE_GEN_API_KEY` unset → 0 outgoing calls (key-missing path).
 * - One target with empty `specDocuments` → that target produces 0 calls;
 *   the other two each produce 1.
 *
 * For env-based fallback assertions we wire a real `createImageApiClient()`
 * (which reads env at module level on each instantiation) instead of the
 * spied client, since the env tier short-circuits inside the client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlueprintSpecDocument } from "../../../../../shared/blueprint/contracts.js";

import {
  createImageApiClient,
  type ImageApiClient,
  type ImageApiRequest,
  type ImageApiResult,
} from "../image-api-client.js";
import {
  createImageService,
  type ImageServiceRunStageCInput,
} from "../image-service.js";
import { createPromptTemplateLibrary } from "../prompt-template-library.js";
import { createEffectPreviewScheduler } from "../scheduler.js";
import { createSvgArchitectureDrafter } from "../svg-architecture-drafter.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimally valid `BlueprintSpecDocument` for the given nodeId.
 * The Stage C gate inspects `specDocuments.length`, not field values, so
 * the body content is intentionally generic.
 */
function buildSpecDocument(nodeId: string): BlueprintSpecDocument {
  return {
    id: `doc-${nodeId}`,
    jobId: "job-batch-test",
    treeId: "tree-batch-test",
    nodeId,
    type: "requirements",
    status: "accepted",
    version: 1,
    title: `Spec ${nodeId}`,
    summary: `Spec summary for ${nodeId}.`,
    content: `Spec body for ${nodeId}.`,
    format: "markdown",
    createdAt: "2026-05-07T00:00:00.000Z",
    provenance: {
      jobId: "job-batch-test",
      githubUrls: [],
      treeVersion: 1,
      // Cast to satisfy structural shape without expanding the public type
      // surface; the service does not introspect provenance fields here.
      nodeType:
        "spec_document" as unknown as BlueprintSpecDocument["provenance"]["nodeType"],
      nodeTitle: `Title-${nodeId}`,
      nodeSummary: `Summary-${nodeId}`,
      dependencies: [],
      outputs: [],
    },
  };
}

/**
 * Wrap a fresh `imageApiClient` with a vi.fn spy so we can count outgoing
 * calls and inspect the prompt that drove each one. The default impl
 * returns a deterministic success payload; tests pass `failPredicate` to
 * inject a per-call failure if they want to exercise the failure path.
 */
function buildSpiedImageApiClient(): {
  client: ImageApiClient;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(async (_req: ImageApiRequest): Promise<ImageApiResult> => {
    return {
      kind: "ok",
      b64Json: "iVBORw0KGgo-test-payload",
      mimeType: "image/png",
      durationMs: 5,
      model: "gpt-image-2",
    };
  });
  const client: ImageApiClient = { generate: spy };
  return { client, spy };
}

/**
 * Per-target invocation parameters. Mirrors the shape that
 * `buildEffectPreview` passes to `runStageC` after task 32.x:
 * `rasterTargets` is the singleton `[targetNodeId]`, and `dependencyOrder`
 * carries the full timeline chain (timeline-only; not raster-call-driving).
 */
interface TargetInvocation {
  readonly missionId: string;
  readonly targetNodeId: string;
  readonly dependencyOrder: ReadonlyArray<string>;
  readonly specDocuments: ReadonlyArray<BlueprintSpecDocument>;
}

/**
 * Mirror the per-target loop from `generateEffectPreviews` (which runs
 * `Promise.all(targetNodes.map(buildEffectPreview))`). Each iteration
 * invokes a shared `imageService` with the contract that
 * `buildEffectPreview` uses in production. We use Promise.all here too so
 * the test exercises the parallel fan-out exactly like production does.
 */
async function runBatch(
  imageService: ReturnType<typeof createImageService>,
  invocations: ReadonlyArray<TargetInvocation>,
): Promise<void> {
  await Promise.all(
    invocations.map((invocation) => {
      const input: ImageServiceRunStageCInput = {
        missionId: invocation.missionId,
        specDocuments: invocation.specDocuments,
        dependencyOrder: invocation.dependencyOrder,
        // task 32.x: each target gets its own singleton rasterTargets,
        // mirroring blueprint.ts buildEffectPreview's `[input.node.id]`.
        rasterTargets: [invocation.targetNodeId],
        architectureNotes: ["Batch test architecture note."],
      };
      return imageService.runStageC(input);
    }),
  );
}

/**
 * Build the canonical 3-target invocation set: target-A, target-B,
 * target-C, each with overlapping shared-N dependency chains so the
 * pre-32 implementation would have generated ≥ 8 outgoing calls.
 */
function buildCanonicalThreeTargets(): ReadonlyArray<TargetInvocation> {
  return [
    {
      missionId: "mission-A",
      targetNodeId: "target-A",
      dependencyOrder: ["shared-1", "target-A"],
      specDocuments: [buildSpecDocument("target-A")],
    },
    {
      missionId: "mission-B",
      targetNodeId: "target-B",
      dependencyOrder: ["shared-1", "shared-2", "target-B"],
      specDocuments: [buildSpecDocument("target-B")],
    },
    {
      missionId: "mission-C",
      targetNodeId: "target-C",
      dependencyOrder: ["shared-1", "shared-3", "target-C"],
      specDocuments: [buildSpecDocument("target-C")],
    },
  ];
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("Stage C raster granularity — batch generate-call count (task 32.3)", () => {
  // -------------------------------------------------------------------------
  // Task 32.3: 3 targets × overlapping deps → exactly 3 outgoing generate
  // calls (NOT 8 or whatever the dependency-chain accumulation produces).
  // -------------------------------------------------------------------------

  it("3 target nodes with overlapping dependency chains produce exactly 3 imageApiClient.generate calls", async () => {
    const { client, spy } = buildSpiedImageApiClient();
    const imageService = createImageService({
      imageApiClient: client,
      promptTemplateLibrary: createPromptTemplateLibrary(),
      svgArchitectureDrafter: createSvgArchitectureDrafter(),
      scheduler: createEffectPreviewScheduler(),
    });

    const invocations = buildCanonicalThreeTargets();
    await runBatch(imageService, invocations);

    // Pre-task-32 behavior would have produced ≥ 8 calls (3 targets +
    // 5 shared dependency entries). Task 32.x contract: exactly 3.
    expect(spy).toHaveBeenCalledTimes(3);

    // Called nodeIds (recoverable from each prompt) must be exactly the
    // 3 raster targets — none of shared-1/2/3 should appear in the call
    // list. We pull the prompt out of each request and search for the
    // node id; PromptTemplateLibrary.render embeds nodeId into the
    // emitted prompt (deterministic by Property 1), so this is a stable
    // marker.
    const calledNodeIds = new Set<string>();
    for (const call of spy.mock.calls) {
      const [request] = call as [ImageApiRequest];
      // Each invocation's prompt contains its nodeId. Identify which
      // target was rastered by checking the prompt body for any of the
      // 3 target ids; assert no shared-* appears anywhere.
      for (const candidate of ["target-A", "target-B", "target-C"]) {
        if (request.prompt.includes(candidate)) {
          calledNodeIds.add(candidate);
        }
      }
      for (const sharedId of ["shared-1", "shared-2", "shared-3"]) {
        // Shared nodeIds may appear as substrings of unrelated prompt
        // tokens (e.g. "shared-1" inside metaPrefix copy), so the
        // assertion uses a word-bounded search. The PromptTemplateLibrary
        // `render(input)` uses `Node id: ${nodeId}` line; we look for
        // exactly that pattern.
        expect(request.prompt).not.toContain(`Node id: ${sharedId}`);
      }
    }
    expect(calledNodeIds).toEqual(
      new Set(["target-A", "target-B", "target-C"]),
    );
  });

  it("imageBase64ByNodeId returned per target only contains the target's own id, never shared deps", async () => {
    const { client, spy } = buildSpiedImageApiClient();
    const imageService = createImageService({
      imageApiClient: client,
      promptTemplateLibrary: createPromptTemplateLibrary(),
      svgArchitectureDrafter: createSvgArchitectureDrafter(),
      scheduler: createEffectPreviewScheduler(),
    });

    const invocations = buildCanonicalThreeTargets();
    const results = await Promise.all(
      invocations.map((invocation) =>
        imageService.runStageC({
          missionId: invocation.missionId,
          specDocuments: invocation.specDocuments,
          dependencyOrder: invocation.dependencyOrder,
          rasterTargets: [invocation.targetNodeId],
          architectureNotes: ["note"],
        }),
      ),
    );

    expect(spy).toHaveBeenCalledTimes(3);

    for (let i = 0; i < invocations.length; i += 1) {
      const result = results[i]!;
      const { targetNodeId } = invocations[i]!;
      expect(result.imageBase64ByNodeId).toBeDefined();
      const keys = Object.keys(result.imageBase64ByNodeId ?? {});
      // The base64 map must contain exactly the singleton raster target,
      // never the timeline-only shared deps.
      expect(keys).toEqual([targetNodeId]);
    }
  });
});

describe("Stage C raster granularity — env / spec fallback call counts (task 32.4)", () => {
  beforeEach(() => {
    // Clear any prior env stubs so each scenario starts from a clean
    // slate; vi.unstubAllEnvs is the canonical way to peel off
    // vi.stubEnv side effects between tests.
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // 32.4(1): IMAGE_GEN_DISABLED=true → 0 outgoing calls
  // -------------------------------------------------------------------------

  it("IMAGE_GEN_DISABLED=true short-circuits all 3 targets to 0 outgoing fetch calls", async () => {
    vi.stubEnv("IMAGE_GEN_DISABLED", "true");
    // Provide a key so the disabled-tier wins over key-missing-tier; the
    // 6-tier ordering puts env-disabled first.
    vi.stubEnv("IMAGE_GEN_API_KEY", "sk-test-only-not-real");
    vi.stubEnv("IMAGE_GEN_BASE_URL", "https://example.invalid");

    const fetchSpy = vi.fn();
    // We use the real client (not the spied one) because the env tier
    // short-circuits inside `createImageApiClient.generate` before any
    // outgoing fetch. We attach a fetch spy on the global to verify zero
    // network attempts.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    try {
      const imageService = createImageService({
        imageApiClient: createImageApiClient(),
        promptTemplateLibrary: createPromptTemplateLibrary(),
        svgArchitectureDrafter: createSvgArchitectureDrafter(),
        scheduler: createEffectPreviewScheduler(),
      });

      const invocations = buildCanonicalThreeTargets();
      await runBatch(imageService, invocations);

      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 32.4(2): IMAGE_GEN_API_KEY unset → 0 outgoing calls
  // -------------------------------------------------------------------------

  it("IMAGE_GEN_API_KEY unset short-circuits all 3 targets to 0 outgoing fetch calls", async () => {
    vi.stubEnv("IMAGE_GEN_API_KEY", "");
    vi.stubEnv("IMAGE_GEN_BASE_URL", "https://example.invalid");
    // Make sure DISABLED is not set so the tier check runs through to
    // key-missing rather than short-circuiting at env-disabled tier.
    vi.stubEnv("IMAGE_GEN_DISABLED", "false");

    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    try {
      const imageService = createImageService({
        imageApiClient: createImageApiClient(),
        promptTemplateLibrary: createPromptTemplateLibrary(),
        svgArchitectureDrafter: createSvgArchitectureDrafter(),
        scheduler: createEffectPreviewScheduler(),
      });

      const invocations = buildCanonicalThreeTargets();
      await runBatch(imageService, invocations);

      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 32.4(3): one target has empty specDocuments → that target = 0 calls,
  //          the other two = 1 each (total 2).
  // -------------------------------------------------------------------------

  it("one target with empty specDocuments produces 0 calls; the other two produce 1 each (total 2)", async () => {
    const { client, spy } = buildSpiedImageApiClient();
    const imageService = createImageService({
      imageApiClient: client,
      promptTemplateLibrary: createPromptTemplateLibrary(),
      svgArchitectureDrafter: createSvgArchitectureDrafter(),
      scheduler: createEffectPreviewScheduler(),
    });

    // target-A has empty specDocuments → empty-spec gate fires inside
    // runStageC, zero outgoing calls for that target.
    const invocations: ReadonlyArray<TargetInvocation> = [
      {
        missionId: "mission-A",
        targetNodeId: "target-A",
        dependencyOrder: ["shared-1", "target-A"],
        specDocuments: [], // ← gate trigger
      },
      {
        missionId: "mission-B",
        targetNodeId: "target-B",
        dependencyOrder: ["shared-1", "shared-2", "target-B"],
        specDocuments: [buildSpecDocument("target-B")],
      },
      {
        missionId: "mission-C",
        targetNodeId: "target-C",
        dependencyOrder: ["shared-1", "shared-3", "target-C"],
        specDocuments: [buildSpecDocument("target-C")],
      },
    ];
    await runBatch(imageService, invocations);

    // 2 outgoing calls (B + C); A short-circuited at the empty-spec
    // gate. The call-count guarantee is `≤ N` — exactly N when all
    // targets have non-empty specs.
    expect(spy).toHaveBeenCalledTimes(2);

    const calledNodeIds = new Set<string>();
    for (const call of spy.mock.calls) {
      const [request] = call as [ImageApiRequest];
      for (const candidate of ["target-A", "target-B", "target-C"]) {
        if (request.prompt.includes(`Node id: ${candidate}`)) {
          calledNodeIds.add(candidate);
        }
      }
    }
    expect(calledNodeIds).toEqual(new Set(["target-B", "target-C"]));
  });
});
