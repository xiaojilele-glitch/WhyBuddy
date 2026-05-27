/**
 * Example-based integration tests for `createImageService(deps).runStageC`.
 *
 * Validates: Requirements 1.1, 1.2, 6.4, 7.3, 8.1
 *
 * Covers task 13.1 of the
 * `autopilot-image-rendering-and-visual-system` spec — four
 * scenarios that pin Stage C composition behaviour without exercising
 * the full property-based test surface (chapter 12 owns those).
 *
 *  13.1.A empty `specDocuments` → zero outgoing requests + textOnly
 *        reason `"empty-spec"` (Requirement 1.2 / 6.4 gate).
 *  13.1.B 4-step order is fixed: prompt template render → SVG draft →
 *        scheduler.plan → imageApiClient.generate, with the first
 *        three each invoked exactly once before the first generate.
 *  13.1.C `architectureSvgDraft` and `imageBase64ByNodeId.*.b64` do
 *        not pollute each other (Property 5 field-isolation).
 *  13.1.D `BlueprintCostTracker.record` invocation count equals the
 *        number of outgoing `imageApiClient.generate` calls
 *        (Requirements 7.3 / 8.1).
 *
 * All dependencies are constructed in-process via `vi.fn()` spies; no
 * real LLM, no real network, no `process.env` reads.
 */

import { describe, expect, it, vi } from "vitest";

import type { BlueprintSpecDocument } from "../../../../../shared/blueprint/contracts.js";

import type {
  ImageApiClient,
  ImageApiRequest,
  ImageApiResult,
} from "../image-api-client.js";
import {
  createImageService,
  type BlueprintCostTrackerLike,
  type ImageServiceDeps,
} from "../image-service.js";
import type {
  PromptTemplateInput,
  PromptTemplateLibrary,
  PromptStyleKey,
} from "../prompt-template-library.js";
import type {
  EffectPreviewScheduler,
  ProgressPlanEntry,
  SchedulerPlanInput,
} from "../scheduler.js";
import type {
  SvgArchitectureDrafter,
  SvgArchitectureDrafterInput,
  SvgDraftResult,
} from "../svg-architecture-drafter.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimal-yet-valid `BlueprintSpecDocument`. Tests only care
 * that `specDocuments.length > 0` (or === 0), so the body content does
 * not need to drive any downstream branch.
 */
function buildSpecDocument(id: string): BlueprintSpecDocument {
  return {
    id,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId: "node-cockpit-root",
    type: "requirements",
    status: "accepted",
    version: 1,
    title: `Spec ${id}`,
    summary: `Summary for ${id}.`,
    content: `Content body for ${id}.`,
    format: "markdown",
    createdAt: "2026-05-07T00:00:00.000Z",
    provenance: {
      jobId: "job-1",
      projectId: "project-1",
      sourceId: "source-1",
      targetText: "Ship the autopilot effect preview slice.",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "spec_document",
      nodeTitle: "Cockpit Root",
      nodeSummary: "Cockpit root spec node.",
      dependencies: [],
      outputs: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Stub builders
// ---------------------------------------------------------------------------

interface StubBundle {
  readonly deps: ImageServiceDeps;
  readonly renderSpy: ReturnType<typeof vi.fn>;
  readonly draftSpy: ReturnType<typeof vi.fn>;
  readonly planSpy: ReturnType<typeof vi.fn>;
  readonly generateSpy: ReturnType<typeof vi.fn>;
  readonly markCompletedSpy: ReturnType<typeof vi.fn>;
  readonly markFailedSpy: ReturnType<typeof vi.fn>;
  readonly recordSpy: ReturnType<typeof vi.fn>;
}

interface BuildStubsOptions {
  readonly svgString?: string;
  readonly svgKind?: "ok" | "skipped";
  readonly skippedReason?: string;
  readonly generateImpl?: (
    request: ImageApiRequest,
    callIndex: number,
  ) => ImageApiResult;
}

/**
 * Build a fresh dependency bundle with `vi.fn()` spies on every step.
 * Returning the spies separately keeps assertions straightforward
 * without relying on internal references inside the deps object.
 */
function buildStubs(opts: BuildStubsOptions = {}): StubBundle {
  const renderSpy = vi.fn(
    (input: PromptTemplateInput): string =>
      `[meta]\nNode id: ${input.nodeId}\nstyle:${input.style ?? "default"}`,
  );
  const styleList: ReadonlyArray<PromptStyleKey> = [
    "system_architecture_diagram",
  ];
  const promptTemplateLibrary: PromptTemplateLibrary = {
    render: renderSpy as PromptTemplateLibrary["render"],
    styles: () => styleList,
  };

  const svgKind = opts.svgKind ?? "ok";
  const draftSpy = vi.fn(
    async (
      _input: SvgArchitectureDrafterInput,
    ): Promise<SvgDraftResult> => {
      if (svgKind === "ok") {
        return {
          kind: "ok",
          svg: opts.svgString ?? "<svg>SVG-MARKER-XYZ</svg>",
        };
      }
      return {
        kind: "skipped",
        reason: opts.skippedReason ?? "no-architecture-notes",
      };
    },
  );
  const svgArchitectureDrafter: SvgArchitectureDrafter = {
    draft: draftSpy as SvgArchitectureDrafter["draft"],
  };

  const planSpy = vi.fn(
    (input: SchedulerPlanInput): ReadonlyArray<ProgressPlanEntry> => {
      return Object.freeze(
        input.dependencyOrder.map((nodeId) =>
          Object.freeze<ProgressPlanEntry>({
            nodeId,
            state: "pending",
          }),
        ),
      );
    },
  );
  const markCompletedSpy = vi.fn(
    (
      plan: ReadonlyArray<ProgressPlanEntry>,
      nodeId: string,
    ): ReadonlyArray<ProgressPlanEntry> => {
      return plan.map((entry) =>
        entry.nodeId === nodeId
          ? Object.freeze<ProgressPlanEntry>({
              ...entry,
              state: "completed",
              endedAt: "2026-05-07T10:30:00.000Z",
            })
          : entry,
      );
    },
  );
  const markFailedSpy = vi.fn(
    (
      plan: ReadonlyArray<ProgressPlanEntry>,
      nodeId: string,
      tier: ProgressPlanEntry["fallbackTier"],
      summary: string,
    ): ReadonlyArray<ProgressPlanEntry> => {
      return plan.map((entry) =>
        entry.nodeId === nodeId
          ? Object.freeze<ProgressPlanEntry>({
              ...entry,
              state: "failed",
              fallbackTier: tier,
              errorSummary: summary,
              endedAt: "2026-05-07T10:30:00.000Z",
            })
          : entry,
      );
    },
  );
  const scheduler: EffectPreviewScheduler = {
    plan: planSpy as EffectPreviewScheduler["plan"],
    markCompleted:
      markCompletedSpy as EffectPreviewScheduler["markCompleted"],
    markFailed: markFailedSpy as EffectPreviewScheduler["markFailed"],
  };

  let callIndex = 0;
  const generateImpl =
    opts.generateImpl ??
    ((_req: ImageApiRequest, idx: number): ImageApiResult => ({
      kind: "ok",
      b64Json: `BASE64-FOR-NODE-${idx}`,
      mimeType: "image/png",
      durationMs: 100 + idx,
      model: "gpt-image-2",
    }));
  const generateSpy = vi.fn(
    async (request: ImageApiRequest): Promise<ImageApiResult> => {
      const idx = callIndex;
      callIndex += 1;
      return generateImpl(request, idx);
    },
  );
  const imageApiClient: ImageApiClient = {
    generate: generateSpy as ImageApiClient["generate"],
  };

  const recordSpy = vi.fn();
  const costTracker: BlueprintCostTrackerLike = {
    record: recordSpy as BlueprintCostTrackerLike["record"],
  };

  const deps: ImageServiceDeps = {
    promptTemplateLibrary,
    svgArchitectureDrafter,
    scheduler,
    imageApiClient,
    costTracker,
  };

  return {
    deps,
    renderSpy,
    draftSpy,
    planSpy,
    generateSpy,
    markCompletedSpy,
    markFailedSpy,
    recordSpy,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createImageService.runStageC — integration (task 13.1)", () => {
  // -------------------------------------------------------------------------
  // 13.1.A empty specDocuments → zero outgoing
  // -------------------------------------------------------------------------

  describe("13.1.A empty specDocuments skips Stage C with zero outgoing requests", () => {
    it("returns textOnly reason='empty-spec' when specDocuments is undefined", async () => {
      const stubs = buildStubs();
      const service = createImageService(stubs.deps);

      const result = await service.runStageC({
        missionId: "mission-empty-undef",
        dependencyOrder: ["node-a", "node-b"],
        architectureNotes: ["Cockpit anchors runtime projection."],
      });

      expect(result.textOnlyEffectPreview).toEqual({
        active: true,
        reason: "empty-spec",
      });
      expect(result.architectureSvgDraft).toBeUndefined();
      expect(result.imageBase64ByNodeId).toBeUndefined();
      expect(result.progressPlan).toEqual([]);

      // Zero outgoing assertions — none of the four steps fire.
      expect(stubs.generateSpy).toHaveBeenCalledTimes(0);
      expect(stubs.renderSpy).toHaveBeenCalledTimes(0);
      expect(stubs.draftSpy).toHaveBeenCalledTimes(0);
      expect(stubs.planSpy).toHaveBeenCalledTimes(0);
      expect(stubs.recordSpy).toHaveBeenCalledTimes(0);
    });

    it("returns textOnly reason='empty-spec' when specDocuments is an empty array", async () => {
      const stubs = buildStubs();
      const service = createImageService(stubs.deps);

      const result = await service.runStageC({
        missionId: "mission-empty-array",
        specDocuments: [],
        dependencyOrder: ["node-a"],
        architectureNotes: ["Some notes."],
      });

      expect(result.textOnlyEffectPreview).toEqual({
        active: true,
        reason: "empty-spec",
      });
      expect(result.progressPlan).toEqual([]);
      expect(stubs.generateSpy).toHaveBeenCalledTimes(0);
      expect(stubs.renderSpy).toHaveBeenCalledTimes(0);
      expect(stubs.draftSpy).toHaveBeenCalledTimes(0);
      expect(stubs.planSpy).toHaveBeenCalledTimes(0);
      expect(stubs.recordSpy).toHaveBeenCalledTimes(0);
    });
  });

  // -------------------------------------------------------------------------
  // 13.1.B 4-step order: prompt → SVG draft → scheduler.plan → generate
  // -------------------------------------------------------------------------

  it("13.1.B invokes the four Stage C steps in fixed order", async () => {
    const stubs = buildStubs();
    const service = createImageService(stubs.deps);

    const result = await service.runStageC({
      missionId: "mission-order",
      specDocuments: [buildSpecDocument("doc-a")],
      dependencyOrder: ["node-a", "node-b"],
      // task 32.x: explicit rasterTargets for the legacy "raster every dep"
      // assertion. Production wiring (see blueprint.ts buildEffectPreview)
      // now passes only the current node id; this test still exercises the
      // multi-target path to validate ordering across multiple raster calls.
      rasterTargets: ["node-a", "node-b"],
      architectureNotes: ["Layered cockpit projection."],
    });

    // Each pre-raster step is called exactly once.
    expect(stubs.renderSpy).toHaveBeenCalled();
    expect(stubs.draftSpy).toHaveBeenCalledTimes(1);
    expect(stubs.planSpy).toHaveBeenCalledTimes(1);

    // Two raster calls (one per node).
    expect(stubs.generateSpy).toHaveBeenCalledTimes(2);

    // Order via `mock.invocationCallOrder` — vitest assigns a globally
    // monotonically increasing ordinal to every spy invocation. The
    // first prompt render must precede the SVG draft, which must
    // precede scheduler.plan, which must precede the first
    // imageApiClient.generate call.
    const firstRenderOrder = stubs.renderSpy.mock.invocationCallOrder[0];
    const draftOrder = stubs.draftSpy.mock.invocationCallOrder[0];
    const planOrder = stubs.planSpy.mock.invocationCallOrder[0];
    const firstGenerateOrder = stubs.generateSpy.mock.invocationCallOrder[0];

    expect(firstRenderOrder).toBeDefined();
    expect(draftOrder).toBeDefined();
    expect(planOrder).toBeDefined();
    expect(firstGenerateOrder).toBeDefined();

    expect(firstRenderOrder!).toBeLessThan(draftOrder!);
    expect(draftOrder!).toBeLessThan(planOrder!);
    expect(planOrder!).toBeLessThan(firstGenerateOrder!);

    // Sanity: result has both architectureSvgDraft and image records
    // since happy path completed.
    expect(result.architectureSvgDraft).toBeDefined();
    expect(result.imageBase64ByNodeId).toBeDefined();
    expect(result.textOnlyEffectPreview).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 13.1.C field isolation: SVG marker never leaks into base64 entries
  // -------------------------------------------------------------------------

  it("13.1.C architectureSvgDraft and imageBase64ByNodeId do not contaminate each other", async () => {
    const SVG_MARKER = "SVG-MARKER-XYZ";
    const stubs = buildStubs({
      svgString: `<svg>${SVG_MARKER}</svg>`,
      generateImpl: (_request, idx) => ({
        kind: "ok",
        b64Json: `BASE64-DISTINCT-${idx}-NO-SVG-LEAK`,
        mimeType: "image/png",
        durationMs: 50,
        model: "gpt-image-2",
      }),
    });
    const service = createImageService(stubs.deps);

    const result = await service.runStageC({
      missionId: "mission-isolation",
      specDocuments: [buildSpecDocument("doc-a")],
      dependencyOrder: ["node-a", "node-b", "node-c"],
      // task 32.x: rasterTargets is the explicit generate-call list. This
      // test still wants every dep to receive a raster call so it can
      // verify field-isolation across multiple records.
      rasterTargets: ["node-a", "node-b", "node-c"],
      architectureNotes: ["Note 1.", "Note 2."],
    });

    // The SVG draft contains the marker exactly once, in full.
    expect(result.architectureSvgDraft).toBe(`<svg>${SVG_MARKER}</svg>`);

    // Every base64 record exists, and none of them carry the SVG
    // marker substring (Property 5 field-isolation).
    expect(result.imageBase64ByNodeId).toBeDefined();
    const records = result.imageBase64ByNodeId!;
    expect(Object.keys(records).sort()).toEqual([
      "node-a",
      "node-b",
      "node-c",
    ]);
    for (const nodeId of Object.keys(records)) {
      const record = records[nodeId]!;
      expect(record.b64.includes(SVG_MARKER)).toBe(false);
      expect(record.mimeType).toBe("image/png");
    }
  });

  // -------------------------------------------------------------------------
  // 13.1.D costTracker.record count === outgoing generate count
  // -------------------------------------------------------------------------

  it("13.1.D records cost once per outgoing generate request (count parity)", async () => {
    const stubs = buildStubs();
    const service = createImageService(stubs.deps);

    const dependencyOrder = ["node-1", "node-2", "node-3", "node-4"];
    const result = await service.runStageC({
      missionId: "mission-cost",
      specDocuments: [buildSpecDocument("doc-a")],
      dependencyOrder,
      // task 32.x: cost-tracker parity is per outgoing generate call, so
      // pass the same nodeIds as rasterTargets to retain the original
      // 4-call assertion.
      rasterTargets: dependencyOrder,
      architectureNotes: ["A note."],
    });

    // All N generate calls succeeded.
    expect(stubs.generateSpy).toHaveBeenCalledTimes(dependencyOrder.length);
    expect(stubs.recordSpy).toHaveBeenCalledTimes(dependencyOrder.length);
    expect(stubs.recordSpy.mock.calls.length).toBe(
      stubs.generateSpy.mock.calls.length,
    );

    // Each record() invocation receives the model + a non-negative
    // durationMs, per ImageService Stage C §"成本治理". No tier on
    // success path.
    for (const call of stubs.recordSpy.mock.calls) {
      const [arg] = call as [
        Parameters<BlueprintCostTrackerLike["record"]>[0],
      ];
      expect(arg.model).toBe("gpt-image-2");
      expect(typeof arg.durationMs).toBe("number");
      expect(arg.durationMs).toBeGreaterThanOrEqual(0);
      expect(arg.tier).toBeUndefined();
    }

    // Sanity: textOnly fallback not triggered on full-success path.
    expect(result.textOnlyEffectPreview).toBeUndefined();
    expect(Object.keys(result.imageBase64ByNodeId ?? {}).length).toBe(
      dependencyOrder.length,
    );
  });
});
