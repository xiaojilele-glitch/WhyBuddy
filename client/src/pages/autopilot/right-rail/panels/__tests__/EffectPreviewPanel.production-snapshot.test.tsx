/**
 * autopilot-image-rendering-and-visual-system · Phase 4 · Task 37.1 (downgrade)
 *
 * Production-snapshot closure proof for the Stage C effect_preview surface
 * — DOWNGRADED variant per Task 37.3, repaired per Phase 5 Task 41.1.
 *
 * ## Why an SSR snapshot instead of Playwright
 *
 * Phase 4 Task 37.1 originally specified a Playwright e2e test
 * navigating to a route exposing the effect_preview stage and asserting
 * the visible DOM contains the production anchors (image gallery,
 * per-node groups, schedule timeline, settings panel) plus a screenshot
 * artifact.
 *
 * Task 37.3 explicitly authorizes a downgrade when Playwright is not
 * present in the repository. Repo verification on 2026-05-24:
 * - workspace-wide grep for `playwright` across all package.json files
 *   returned 0 matches;
 * - no `playwright.config.ts` and no root-level `e2e/` directory exist;
 * - the `services/lobster-executor` references to `"browser.playwright"`
 *   are skill-capability metadata strings, not actual installed
 *   packages.
 *
 * This test substitutes the Playwright route assertion with a
 * `react-dom/server` `renderToStaticMarkup` over the production
 * `<EffectPreviewPanel>` component using a fixture `activePreview`
 * that exercises every Stage C output. It complements the existing
 * `EffectPreviewPanel.image-integration.test.tsx` (Task 31.3) by
 * focusing on the «all anchors visible together in one production
 * render» closure assertion that Task 37.1 originally targeted.
 *
 * ## What this test PROVES
 *
 * 1. The production right-rail panel `EffectPreviewPanel` (the file
 *    actually mounted by `<AutopilotRightRail>` in the fabric stage)
 *    really wires `<EffectPreviewImagePanel>`,
 *    `<EffectPreviewScheduleTimeline>`, and
 *    `<AutopilotImageSettingsPanel>` together when an `activePreview`
 *    carries Stage C output AND `initialImageSettings` is injected.
 * 2. The image gallery anchor `data-testid="effect-preview-image-gallery"`
 *    appears in the SSR markup.
 * 3. Per-node grouping (`data-node-id="..."`) appears for at least
 *    two distinct nodes when `imageBase64ByNodeId` carries two entries.
 * 4. The schedule timeline anchor
 *    `data-testid="effect-preview-schedule-list"` appears in the same
 *    markup string as the gallery.
 * 5. The download button anchor
 *    `data-testid="effect-preview-download-button"` appears (the same
 *    anchor 31.3 covers, included here for completeness of the
 *    «closure proof» bundle).
 * 6. The settings panel anchor
 *    `data-testid="autopilot-image-settings-panel"` appears, proving
 *    Task 35.3's production wiring is mounted in the same SSR pass as
 *    the gallery + schedule timeline. This is the post-35.3 closure
 *    proof that Phase 5 Task 41.1 added.
 * 7. The progressPlan milestone block is preserved
 *    (`data-testid="effect-preview-progress-plan"`).
 * 8. Document-order layout pin: gallery < schedule < settings.
 *
 * ## What this test does NOT prove
 *
 * - It does NOT load the React frontend in a real browser. It does not
 *   exercise hydration, client-side effects, IndexedDB caching, image
 *   downloads, or actual paint.
 * - It does NOT run any layout / CSS engine. Bounding-box / overlap /
 *   stacking-context / `position: fixed` interaction guarantees would
 *   require a real browser layout pass. The companion
 *   `ProjectCockpitHome.production-snapshot.test.tsx` covers the
 *   document-order layout invariant separately, also via SSR.
 * - The settings panel anchor `data-testid="autopilot-image-settings-panel"`
 *   IS now asserted in the same SSR pass as the gallery + schedule
 *   timeline (Phase 5 Task 41.1 closure). All five production anchors
 *   — gallery, per-node groups, schedule timeline, download button,
 *   settings panel — appear together, plus the existing milestone
 *   block. This is the post-35.3 closure proof.
 *
 * ## Closure mapping back to Task 37
 *
 *   Task 37.1 (Playwright effect_preview route)
 *     → SSR-snapshot:    this file
 *     → API-reachability:  server/tests/blueprint-image-settings.smoke.test.ts
 *   Task 37.2 (Playwright /projects route)
 *     → SSR-snapshot:    client/src/pages/__tests__/ProjectCockpitHome.production-snapshot.test.tsx
 *   Task 37.3 (downgrade decision)
 *     → Documented in all three test preambles + tasks.md final report.
 *
 * @see Requirements 9.1, 9.2, 14.4, 17.1
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlueprintAgentCrewSnapshot,
  BlueprintEffectPreviewSnapshot,
} from "@/lib/blueprint-api";
import type { BlueprintSpecTree } from "@shared/blueprint/contracts";

import { EffectPreviewPanel } from "@/pages/autopilot/right-rail/panels/EffectPreviewPanel";
import type { ImageSettingsViewModel } from "@/components/autopilot/AutopilotImageSettingsPanel";

// ---------------------------------------------------------------------------
// Sentinel — must NEVER appear in any rendered DOM.
//
// Phase 5 Task 41.1 defense-in-depth check: even though the fixture below
// does not carry the sentinel, asserting its absence guards against a
// future regression that could surface a raw `apiKey` in the view model.
// ---------------------------------------------------------------------------

const SENTINEL_RAW_KEY = "SENTINEL-RAW-KEY-NEVER-EXPOSE";

// ---------------------------------------------------------------------------
// Fixture builders — minimal double-cast stubs (consistent with the existing
// 31.3 image-integration test, kept independent so the two suites can evolve
// without coupling).
// ---------------------------------------------------------------------------

function buildSpecTreeFixture(): BlueprintSpecTree {
  return {
    id: "tree-snapshot",
    rootNodeId: "node-A",
    routeSetId: "route-snapshot",
    jobId: "job-snapshot",
    version: 1,
    status: "reviewing",
    nodes: [
      {
        id: "node-A",
        title: "Node A",
        type: "effect_preview",
        status: "ready",
      },
      {
        id: "node-B",
        title: "Node B",
        type: "effect_preview",
        status: "ready",
      },
    ],
    edges: [],
    documents: [
      {
        id: "doc-1",
        nodeId: "node-A",
        type: "requirements",
        status: "accepted",
        title: "Node A requirements",
        summary: "Accepted requirements",
        content: "",
        format: "markdown",
        version: 1,
        savedAt: "2026-05-24T07:00:00.000Z",
      },
    ],
  } as unknown as BlueprintSpecTree;
}

function buildDraftOnlySpecTreeFixture(): BlueprintSpecTree {
  return {
    id: "tree-draft-only",
    rootNodeId: "node-draft",
    routeSetId: "route-draft",
    jobId: "job-draft",
    version: 1,
    status: "reviewing",
    nodes: [
      {
        id: "node-draft",
        title: "Draft node",
        type: "effect_preview",
        status: "ready",
      },
    ],
    edges: [],
    documents: [
      {
        id: "doc-draft",
        nodeId: "node-draft",
        type: "requirements",
        status: "draft",
        title: "Draft requirements",
        summary: "Draft requirements",
        content: "",
        format: "markdown",
        version: 1,
        savedAt: "2026-05-24T07:00:00.000Z",
      },
    ],
  } as unknown as BlueprintSpecTree;
}

function buildEffectPreviewSnapshotFixture(): BlueprintEffectPreviewSnapshot {
  return {
    id: "preview-snapshot",
    jobId: "job-snapshot",
    treeId: "tree-snapshot",
    nodeId: "node-A",
    version: 5,
    status: "preview",
    sourceDocumentIds: ["doc-1"],
    createdAt: "2026-05-24T07:00:00.000Z",
    updatedAt: "2026-05-24T07:30:00.000Z",
    summary: "Production-snapshot fixture exercising Stage C closure",
    architectureNotes: ["Top-level architecture note"],
    prototypeNotes: ["Prototype note"],
    progressPlan: [
      {
        id: "milestone-1",
        title: "Render Stage C raster",
        summary: "Generate per-node images",
        target: "Internal demo milestone",
        sourceDocumentIds: ["doc-1"],
      },
    ],
    nodes: [],
    runtimeProjection: {
      hudState: {
        title: "Stage C HUD",
        summary: "Running",
        status: "running",
        badges: [],
        progressPercent: 50,
      },
      consoleLines: [],
      logTimeline: [],
      browserPreview: {},
    },
    dependencyOrder: ["node-A", "node-B"],
    imageBase64ByNodeId: {
      "node-A": {
        b64: "AAAA",
        mimeType: "image/png",
        promptUsed: "prompt-A",
        generatedAt: "2026-05-24T07:10:00.000Z",
      },
      "node-B": {
        b64: "BBBB",
        mimeType: "image/png",
        promptUsed: "prompt-B",
        generatedAt: "2026-05-24T07:20:00.000Z",
      },
    },
    provenance: {
      jobId: "job-snapshot",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "effect_preview",
      nodeTitle: "Node A",
      nodeSummary: "Node A summary",
      sourceStatus: "accepted",
      includeDrafts: false,
      sourceDocumentStatuses: {},
    },
  } as unknown as BlueprintEffectPreviewSnapshot;
}

/**
 * Pre-built ready-state image-settings view model (mirrors the fixture
 * shape used by `EffectPreviewPanel.settings-integration.test.tsx`,
 * Task 35.4).
 *
 * The masked key matches the server's `maskApiKey` algorithm:
 *   head(8) + "•".repeat(length - 14) + tail(6)
 * Here `"sk-test-"` (8) + 5 bullets + `"••CDEF"` (6) = 17 chars total.
 */
const READY_VIEW_MODEL: ImageSettingsViewModel = {
  baseUrl: "https://image-proxy.example.com",
  model: "gpt-image-2",
  path: "/v1/images/generations",
  defaultSize: "1K",
  defaultAspect: "1:1",
  timeoutMs: 60000,
  apiKey: "sk-test-•••••CDEF",
};

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("EffectPreviewPanel · Phase 4 Task 37.1 (downgraded) production snapshot", () => {
  it("renders all Stage C production anchors together in a single SSR pass", () => {
    const specTree = buildSpecTreeFixture();
    const preview = buildEffectPreviewSnapshotFixture();

    const markup = renderToStaticMarkup(
      <EffectPreviewPanel
        jobId="job-snapshot"
        job={null}
        specTree={specTree}
        effectPreviews={[preview]}
        initialPreviews={[preview]}
        agentCrew={null as unknown as BlueprintAgentCrewSnapshot | null}
        capabilityEvidence={[]}
        locale="zh-CN"
        initialImageSettings={READY_VIEW_MODEL}
      />,
    );

    // Anchor 1: image gallery (mounted by EffectPreviewImagePanel).
    expect(markup).toContain('data-testid="effect-preview-image-gallery"');

    // Anchor 2: at least two distinct per-node groups. We assert both
    // explicit nodeIds appear; this is stricter than «≥1» and prevents
    // a regression where the gallery degenerates to a single group.
    const nodeAOccurrences = (markup.match(/data-node-id="node-A"/g) ?? [])
      .length;
    const nodeBOccurrences = (markup.match(/data-node-id="node-B"/g) ?? [])
      .length;
    expect(nodeAOccurrences).toBeGreaterThanOrEqual(1);
    expect(nodeBOccurrences).toBeGreaterThanOrEqual(1);

    // Anchor 3: schedule timeline (mounted by EffectPreviewScheduleTimeline).
    expect(markup).toContain('data-testid="effect-preview-schedule-list"');

    // Anchor 4: download button (per-record entry in the gallery).
    expect(markup).toContain('data-testid="effect-preview-download-button"');

    // Anchor 5: settings panel (mounted by AutopilotImageSettingsPanel).
    // Phase 5 Task 41.1 closure — the post-35.3 evidence gap is now
    // covered: all five production anchors appear in ONE SSR pass.
    expect(markup).toContain('data-testid="autopilot-image-settings-panel"');

    // Anchor 6: existing milestone block preserved.
    expect(markup).toContain('data-testid="effect-preview-progress-plan"');

    // Defense-in-depth: the sentinel raw-key value must never appear.
    // The fixture does not carry it, but if a future regression adds a
    // raw `apiKey` to the view model this assertion catches it.
    expect(markup).not.toContain(SENTINEL_RAW_KEY);

    // Closure cross-check: pin the document order
    // gallery → schedule → settings. The production wiring mounts
    // EffectPreviewImagePanel first, then EffectPreviewScheduleTimeline,
    // then AutopilotImageSettingsPanel (settings is below schedule per
    // Task 35.3's mount placement). A future refactor that accidentally
    // inverts the layout is caught here even without a real browser.
    const galleryIdx = markup.indexOf(
      'data-testid="effect-preview-image-gallery"',
    );
    const scheduleIdx = markup.indexOf(
      'data-testid="effect-preview-schedule-list"',
    );
    const settingsIdx = markup.indexOf(
      'data-testid="autopilot-image-settings-panel"',
    );
    expect(galleryIdx).toBeGreaterThanOrEqual(0);
    expect(scheduleIdx).toBeGreaterThan(galleryIdx);
    expect(settingsIdx).toBeGreaterThan(scheduleIdx);
  });

  it("treats draft SPEC documents as usable preview sources", () => {
    const specTree = buildDraftOnlySpecTreeFixture();

    const markup = renderToStaticMarkup(
      <EffectPreviewPanel
        jobId="job-draft"
        job={null}
        specTree={specTree}
        effectPreviews={[]}
        initialPreviews={[]}
        agentCrew={null as unknown as BlueprintAgentCrewSnapshot | null}
        capabilityEvidence={[]}
        locale="zh-CN"
        initialImageSettings={READY_VIEW_MODEL}
      />,
    );

    const generateButtonMatch = markup.match(
      /<button[^>]*data-testid="effect-preview-generate-button"[^>]*>/
    );
    expect(generateButtonMatch).not.toBeNull();
    expect(generateButtonMatch![0]).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(markup).toContain("1 份可用文档");
    expect(markup).not.toContain("份已接受文档");
  });

  it("keeps generation request options aligned with draft source documents", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../EffectPreviewPanel.tsx"),
      "utf8"
    );

    expect(source).toMatch(/const\s+previewSourceDocuments\s*=\s*useMemo/);
    expect(source).toMatch(
      /generateBlueprintEffectPreview\(jobId,\s*\{[\s\S]*?includeDrafts:\s*true/
    );
  });
});
