/**
 * Stage C raster granularity — **route-level** batch generate-call count
 * (`autopilot-image-rendering-and-visual-system` spec, **Phase 5 Task 40**).
 *
 * Validates: Requirements 1.1, 1.2, 4.1, 4.2, 7.3, 8.1
 *
 * **Why this file exists (audit-corrected proof)**
 *
 * Phase 4 Task 32.3 originally said "Run `generateEffectPreviews()`
 * end-to-end". The audit found that the existing
 * `generate-batch-call-count.test.ts` deliberately opts out of the
 * `generateEffectPreviews` path — it stubs the per-target loop with a
 * direct `Promise.all` over `runStageC` invocations. That file therefore
 * proves the **`runStageC` contract in isolation** (rasterTargets vs.
 * dependencyOrder split, success / failure / cost-record shapes), but
 * does NOT prove that the production fan-out call-site actually
 * invokes `runStageC` with `rasterTargets: [input.node.id]` per target.
 *
 * Phase 5 Task 40 closes that evidence gap.
 *
 * **Decision: Option B (HTTP route via supertest-style express test)**
 *
 * Per the task brief:
 *
 *   (a) Export `generateEffectPreviews` as a named test-only export, OR
 *   (b) Use the existing `POST /api/blueprint/jobs/:jobId/effect-previews`
 *       HTTP route via supertest-style express test.
 *
 * `generateEffectPreviews` is a private (non-exported) async function
 * inside `server/routes/blueprint.ts` — it is consumed only by the
 * `POST /api/blueprint/jobs/:jobId/effect-previews` route handler
 * (~L1678). Exporting it would touch a 16k+ LOC router file and risk
 * dragging additional symbols into the public surface. Option B is the
 * one the audit explicitly named ("`POST /api/blueprint/jobs/.../effect-previews`")
 * and is closest to the audit's "route-level" intent.
 *
 * **What this proves vs. what `generate-batch-call-count.test.ts` proves**
 *
 * - This file (`*.route.test.ts`):
 *     end-to-end fan-out + filtering + call site. Proves that the
 *     production `generateEffectPreviews` path, when triggered via the
 *     real HTTP route, results in **exactly N `imageApiClient.generate`
 *     calls** for N target effect_preview nodes — never N×M where M is
 *     the dependency-chain depth — and that the call-site passes
 *     `rasterTargets: [input.node.id]`, not `dependencyOrder.map(...)`.
 *
 * - `generate-batch-call-count.test.ts`:
 *     `runStageC` contract in isolation. Proves the rasterTargets vs.
 *     dependencyOrder split inside `ImageService`, plus the env / spec
 *     fallback paths.
 *
 * Both files are needed: a regression in `buildEffectPreview` could
 * silently restore the cost-amplification bug while leaving the
 * `runStageC` contract test green. Likewise, a regression in
 * `runStageC` could pass this route-level test if the call-site happens
 * to forward all dependency entries through some other code path.
 *
 * **Refs**
 *
 * - Audit: `tasks.md` Phase 5 Task 40 preamble.
 * - Production call-site: `server/routes/blueprint.ts` `buildEffectPreview`
 *   around L13700 (`rasterTargets: [input.node.id]`).
 * - Production fan-out: `server/routes/blueprint.ts` `generateEffectPreviews`
 *   around L10169 (`Promise.all(targetNodes.map(buildEffectPreview))`).
 * - Production HTTP route: `server/routes/blueprint.ts` ~L1622
 *   (`POST /jobs/:jobId/effect-previews`).
 *
 * @see ./generate-batch-call-count.test.ts (the runStageC contract proof)
 */

import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBlueprintRouter,
  createMemoryBlueprintJobStore,
  type BlueprintJobStore,
} from "../../../blueprint.js";
import { buildBlueprintServiceContext } from "../../context.js";
import { createImageService } from "../image-service.js";
import { createPromptTemplateLibrary } from "../prompt-template-library.js";
import { createEffectPreviewScheduler } from "../scheduler.js";
import { createSvgArchitectureDrafter } from "../svg-architecture-drafter.js";
import type {
  ImageApiClient,
  ImageApiRequest,
  ImageApiResult,
} from "../image-api-client.js";
import type {
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "../../../../../shared/blueprint/contracts.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const FIXTURE_NOW = "2026-05-27T00:00:00.000Z";

/**
 * Build a SPEC tree with 3 effect_preview target nodes (`node-A`,
 * `node-B`, `node-C`) plus 3 shared dependency nodes (`shared-1`,
 * `shared-2`, `shared-3`). Dependency edges:
 *
 *   node-A → shared-1
 *   node-B → shared-1, shared-2
 *   node-C → shared-1, shared-3
 *
 * `buildEffectPreviewDependencyOrder` (in blueprint.ts) walks
 * `node.dependencies` and resolves them via `nodesById`, producing a
 * timeline that includes shared-* entries. If `runStageC` ever regresses
 * back to using `dependencyOrder` instead of `rasterTargets` for the
 * generate call list, the spy will see `3 + 5 = 8` calls (3 targets +
 * 5 shared chain entries). Today's contract: exactly 3.
 */
function buildSpecTreeFixture(): BlueprintSpecTree {
  const baseNode = (
    overrides: Partial<BlueprintSpecTreeNode> & {
      id: string;
      title: string;
    },
  ): BlueprintSpecTreeNode => ({
    parentId: "node-root",
    summary: `Summary for ${overrides.id}`,
    type: "effect_preview",
    status: "accepted",
    priority: 1,
    routeId: "route-1",
    dependencies: [],
    outputs: [],
    children: [],
    ...overrides,
  });

  const nodes: BlueprintSpecTreeNode[] = [
    {
      id: "node-root",
      title: "Root",
      summary: "Root spec node.",
      type: "root",
      status: "accepted",
      priority: 0,
      dependencies: [],
      outputs: [],
      children: ["node-A", "node-B", "node-C", "shared-1", "shared-2", "shared-3"],
    },
    baseNode({ id: "shared-1", title: "Shared dependency 1" }),
    baseNode({ id: "shared-2", title: "Shared dependency 2" }),
    baseNode({ id: "shared-3", title: "Shared dependency 3" }),
    baseNode({
      id: "node-A",
      title: "Target node A",
      dependencies: ["shared-1"],
    }),
    baseNode({
      id: "node-B",
      title: "Target node B",
      dependencies: ["shared-1", "shared-2"],
    }),
    baseNode({
      id: "node-C",
      title: "Target node C",
      dependencies: ["shared-1", "shared-3"],
    }),
  ];

  return {
    id: "tree-route-test",
    routeSetId: "routeset-route-test",
    selectionId: "selection-route-test",
    selectedRouteId: "route-1",
    rootNodeId: "node-root",
    version: 1,
    status: "accepted",
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
    alternativeRouteIds: [],
    nodes,
    provenance: {
      jobId: "job-route-test",
      githubUrls: [],
    },
  };
}

/**
 * Build a `BlueprintSpecDocument` with `status: "accepted"` for the
 * given target node so the include-drafts filter inside
 * `generateEffectPreviews` sees it as eligible.
 */
function buildSpecDocument(nodeId: string): BlueprintSpecDocument {
  return {
    id: `doc-${nodeId}`,
    jobId: "job-route-test",
    treeId: "tree-route-test",
    nodeId,
    type: "requirements",
    status: "accepted",
    version: 1,
    title: `Spec ${nodeId}`,
    summary: `Spec summary for ${nodeId}.`,
    content: `Spec body for ${nodeId}.`,
    format: "markdown",
    createdAt: FIXTURE_NOW,
    provenance: {
      jobId: "job-route-test",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "effect_preview",
      nodeTitle: `Title-${nodeId}`,
      nodeSummary: `Summary-${nodeId}`,
      dependencies: [],
      outputs: [],
    },
  };
}

/**
 * Build a complete `BlueprintGenerationJob` carrying the spec tree +
 * 3 target spec documents as artifacts. This is the minimal shape
 * `generateEffectPreviews` needs:
 *
 *   - `extractSpecTree(job)` → reads `artifacts[type === "spec_tree"]`
 *   - `extractSpecDocuments(job)` → reads `artifacts[type ∈ {requirements, design, tasks}]`
 *   - `extractEffectPreviews(job)` → reads `artifacts[type === "effect_preview"]`
 *     (empty for first run)
 *
 * We do NOT include shared-1/2/3 spec documents — only target nodes
 * have specs. This ensures `targetNodes.filter(documents)` produces
 * exactly the 3 target nodes, mirroring real usage.
 */
function buildJobFixture(): BlueprintGenerationJob {
  const specTree = buildSpecTreeFixture();
  const targetIds = ["node-A", "node-B", "node-C"] as const;

  return {
    id: "job-route-test",
    request: {
      targetText: "Phase 5 Task 40 route-level fan-out proof.",
    },
    status: "reviewing",
    stage: "spec_docs",
    version: "blueprint-generation/v1",
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
    artifacts: [
      {
        id: "artifact-spec-tree",
        type: "spec_tree",
        title: "Spec tree",
        summary: "Route-level test spec tree.",
        createdAt: FIXTURE_NOW,
        payload: specTree,
      },
      ...targetIds.map((nodeId) => ({
        id: `artifact-doc-${nodeId}`,
        type: "requirements" as const,
        title: `Requirements: ${nodeId}`,
        summary: `Spec doc artifact for ${nodeId}.`,
        createdAt: FIXTURE_NOW,
        payload: buildSpecDocument(nodeId),
      })),
    ],
    events: [],
  };
}

// ---------------------------------------------------------------------------
// Express harness
// ---------------------------------------------------------------------------

async function withServer(
  jobStore: BlueprintJobStore,
  imageApiClient: ImageApiClient,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  // Build a `BlueprintServiceContext` whose `effectPreviewImageService` is
  // wired to the spied `imageApiClient`. Everything else uses defaults
  // (template-mode LLM service, no-op cost tracker, etc.) — the only
  // boundary we care about is `imageApiClient.generate`.
  const blueprintServiceContext = buildBlueprintServiceContext({
    jobStore,
    now: () => new Date(FIXTURE_NOW),
    effectPreviewImageService: createImageService({
      imageApiClient,
      promptTemplateLibrary: createPromptTemplateLibrary(),
      svgArchitectureDrafter: createSvgArchitectureDrafter(),
      scheduler: createEffectPreviewScheduler(),
    }),
  });

  const app = express();
  app.use(express.json());
  app.use(
    "/api/blueprint",
    createBlueprintRouter({
      jobStore,
      now: () => new Date(FIXTURE_NOW),
      blueprintServiceContext,
    }),
  );

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

/**
 * Wrap a fresh `imageApiClient` with a `vi.fn` spy so we can count
 * outgoing calls and inspect the prompt that drove each one. The
 * default impl returns a deterministic success payload, mirroring the
 * pattern in `generate-batch-call-count.test.ts`.
 */
function buildSpiedImageApiClient(): {
  client: ImageApiClient;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(async (_req: ImageApiRequest): Promise<ImageApiResult> => ({
    kind: "ok",
    b64Json: "iVBORw0KGgo-route-test-payload",
    mimeType: "image/png",
    durationMs: 5,
    model: "gpt-image-2",
  }));
  const client: ImageApiClient = { generate: spy };
  return { client, spy };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Stage C raster granularity — route-level fan-out (Phase 5 Task 40)", () => {
  beforeEach(() => {
    // Ensure the effect-preview LLM service stays on the template tier so
    // it does not contend with our `imageApiClient` spy. The Stage C
    // image pipeline is a separate sibling service; the LLM-content
    // service tier-1 gate is `BLUEPRINT_EFFECT_PREVIEW_LLM_ENABLED` and
    // is left unset by default, so this is mostly a defensive cleanup.
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POST /api/blueprint/jobs/:jobId/effect-previews invokes imageApiClient.generate exactly N=3 times for 3 targets with overlapping dependency chains (Task 40.2(a))", async () => {
    const { client, spy } = buildSpiedImageApiClient();
    const jobStore = createMemoryBlueprintJobStore([buildJobFixture()]);

    await withServer(jobStore, client, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/blueprint/jobs/job-route-test/effect-previews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(201);

      // The route-level fan-out invariant: each target effect_preview
      // node must produce exactly 1 outgoing `generate` call. With 3
      // target nodes and overlapping shared-* dependency chains, the
      // call count is 3, NOT 8 (3 targets + 5 shared chain entries the
      // pre-32 implementation would have rastered).
      expect(spy).toHaveBeenCalledTimes(3);
    });
  });

  it("called nodeIds are exactly the 3 target nodes — no shared-* dependency entries (Task 40.2(b))", async () => {
    const { client, spy } = buildSpiedImageApiClient();
    const jobStore = createMemoryBlueprintJobStore([buildJobFixture()]);

    await withServer(jobStore, client, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/blueprint/jobs/job-route-test/effect-previews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(201);
      expect(spy).toHaveBeenCalledTimes(3);

      // PromptTemplateLibrary embeds `Node id: ${nodeId}` deterministically,
      // so we can recover which node each `generate` call rastered by
      // searching the prompt body. This is the same recovery pattern the
      // sibling `generate-batch-call-count.test.ts` uses — see Property 1
      // (PromptTemplateLibrary determinism) for the literal stability
      // guarantee.
      const calledNodeIds = new Set<string>();
      for (const call of spy.mock.calls) {
        const [request] = call as [ImageApiRequest];
        for (const candidate of ["node-A", "node-B", "node-C"]) {
          if (request.prompt.includes(`Node id: ${candidate}`)) {
            calledNodeIds.add(candidate);
          }
        }
        // No shared-* should appear as a `Node id:` line. (They may
        // appear elsewhere in the prompt body if templated copy mentions
        // dependency lists, so the assertion is bound to the deterministic
        // `Node id: ${nodeId}` marker.)
        for (const sharedId of ["shared-1", "shared-2", "shared-3"]) {
          expect(request.prompt).not.toContain(`Node id: ${sharedId}`);
        }
      }
      expect(calledNodeIds).toEqual(new Set(["node-A", "node-B", "node-C"]));
    });
  });

  it("response artifact's imageBase64ByNodeId is keyed only by the 3 target nodes — never includes shared deps (Task 40.2(c))", async () => {
    const { client, spy } = buildSpiedImageApiClient();
    const jobStore = createMemoryBlueprintJobStore([buildJobFixture()]);

    await withServer(jobStore, client, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/blueprint/jobs/job-route-test/effect-previews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        readonly effectPreviews: ReadonlyArray<{
          readonly nodeId: string;
          readonly imageBase64ByNodeId?: Record<string, unknown>;
        }>;
      };

      expect(spy).toHaveBeenCalledTimes(3);
      expect(body.effectPreviews).toHaveLength(3);

      const aggregateKeys = new Set<string>();
      const expectedTargetByPreview = new Set<string>();
      for (const preview of body.effectPreviews) {
        expectedTargetByPreview.add(preview.nodeId);
        // Each per-target preview carries an `imageBase64ByNodeId` map
        // whose key set is the singleton `[preview.nodeId]` (Stage C
        // contract — see image-service.ts JSDoc "raster targets vs
        // timeline split"). Aggregating across all 3 previews must yield
        // exactly the 3 target ids.
        const keys = Object.keys(preview.imageBase64ByNodeId ?? {});
        expect(keys).toEqual([preview.nodeId]);
        for (const key of keys) {
          aggregateKeys.add(key);
        }
      }
      expect(expectedTargetByPreview).toEqual(
        new Set(["node-A", "node-B", "node-C"]),
      );
      expect(aggregateKeys).toEqual(new Set(["node-A", "node-B", "node-C"]));

      // Defense in depth: shared-* must never appear as a key in any
      // preview's `imageBase64ByNodeId` map.
      for (const preview of body.effectPreviews) {
        const keys = Object.keys(preview.imageBase64ByNodeId ?? {});
        for (const sharedId of ["shared-1", "shared-2", "shared-3"]) {
          expect(keys).not.toContain(sharedId);
        }
      }
    });
  });
});
