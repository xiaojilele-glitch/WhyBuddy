/**
 * autopilot-image-rendering-and-visual-system · Phase 4 · Task 31.3
 *
 * Production integration regression for `<EffectPreviewPanel>` 与 Stage C
 * 图像 / 调度组件之间的接线。
 *
 * 背景：Phase 1 / Phase 3 在
 * `client/src/components/autopilot/EffectPreviewImagePanel.tsx` 与
 * `client/src/components/autopilot/EffectPreviewScheduleTimeline.tsx` 落地了
 * 图像画廊与调度时间线，但生产 right-rail 入口
 * `client/src/pages/autopilot/right-rail/panels/EffectPreviewPanel.tsx` 在
 * Task 31.1 之前并未挂载它们 —— 后端 Stage C 写入的
 * `imageBase64ByNodeId` / `dependencyOrder` 在右栏不可见。
 *
 * 本测试覆盖 Task 31.1 的接线契约：
 *
 * 1. `data-testid="effect-preview-image-gallery"` 出现 → 图像画廊已挂载
 * 2. 两个不同节点的 `data-node-id="node-A"` / `data-node-id="node-B"` 子串
 *    都出现 → 画廊按 nodeId 分组渲染
 * 3. `data-testid="effect-preview-download-button"` 出现 → 下载按钮锚点存在
 * 4. `data-testid="effect-preview-schedule-list"` 出现 → 调度时间线已挂载
 * 5. `data-testid="effect-preview-progress-plan"` 仍然出现 → milestone 块
 *    没有被 Task 31.1 误删
 *
 * 实现约束：
 * - 严格按仓库惯例使用 `react-dom/server` `renderToStaticMarkup`，与
 *   `panel-chrome-strip.test.tsx` / `SpecDocPreviewBlock.test.tsx` 一致。
 * - 不引入 `@testing-library/react` / `jsdom` / `happy-dom`（仓库未集成）。
 * - 不 mock `EffectPreviewPanel`、`EffectPreviewImagePanel`、
 *   `EffectPreviewScheduleTimeline` 本身；fixture 直接走真实组件。
 * - 测试 fixture 里 `activePreview` 是从 `BlueprintEffectPreviewSnapshot`
 *   double-cast 宽化的最小骨架（与 `panel-chrome-strip.test.tsx` 中
 *   stale preview fixture 的写法保持一致）。
 *
 * @see Requirements 8.2, 8.3, 9.1, 9.2, 15.1, 15.2, 17.1
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlueprintAgentCrewSnapshot,
  BlueprintEffectPreviewSnapshot,
} from "@/lib/blueprint-api";
import type { BlueprintSpecTree } from "@shared/blueprint/contracts";

import { EffectPreviewPanel } from "@/pages/autopilot/right-rail/panels/EffectPreviewPanel";

// ---------------------------------------------------------------------------
// Fixture builders — minimal double-cast stubs (与 panel-chrome-strip 保持一致)
// ---------------------------------------------------------------------------

function buildSpecTreeFixture(): BlueprintSpecTree {
  return {
    id: "tree-1",
    rootNodeId: "node-A",
    routeSetId: "route-1",
    jobId: "job-1",
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
        savedAt: "2026-05-23T07:00:00.000Z",
      },
    ],
  } as unknown as BlueprintSpecTree;
}

function buildEffectPreviewSnapshotFixture(): BlueprintEffectPreviewSnapshot {
  return {
    id: "preview-1",
    jobId: "job-1",
    treeId: "tree-1",
    nodeId: "node-A",
    version: 3,
    status: "preview",
    sourceDocumentIds: ["doc-1"],
    createdAt: "2026-05-23T07:00:00.000Z",
    updatedAt: "2026-05-23T07:30:00.000Z",
    summary: "Preview with Stage C raster output",
    architectureNotes: ["Top-level architecture note"],
    prototypeNotes: ["Prototype note"],
    progressPlan: [
      {
        id: "milestone-running-1",
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
        generatedAt: "2026-05-23T07:10:00.000Z",
      },
      "node-B": {
        b64: "BBBB",
        mimeType: "image/png",
        promptUsed: "prompt-B",
        generatedAt: "2026-05-23T07:20:00.000Z",
      },
    },
    provenance: {
      jobId: "job-1",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EffectPreviewPanel · Phase 4 Task 31.1 production integration", () => {
  it("mounts EffectPreviewImagePanel + EffectPreviewScheduleTimeline above the existing milestone block when activePreview has Stage C output", () => {
    const specTree = buildSpecTreeFixture();
    const preview = buildEffectPreviewSnapshotFixture();

    const markup = renderToStaticMarkup(
      <EffectPreviewPanel
        jobId="job-1"
        job={null}
        specTree={specTree}
        effectPreviews={[preview]}
        initialPreviews={[preview]}
        agentCrew={null as unknown as BlueprintAgentCrewSnapshot | null}
        capabilityEvidence={[]}
        locale="zh-CN"
      />
    );

    // 1. EffectPreviewImagePanel gallery 已挂载
    expect(markup).toContain('data-testid="effect-preview-image-gallery"');

    // 2. 两个不同节点的 group 元素都出现（按 nodeId 分组渲染）
    expect(markup).toContain('data-node-id="node-A"');
    expect(markup).toContain('data-node-id="node-B"');

    // 3. 下载按钮锚点存在（来自 EffectPreviewImagePanel 内 record !== undefined 分支）
    expect(markup).toContain('data-testid="effect-preview-download-button"');

    // 4. 调度时间线锚点存在（来自 EffectPreviewScheduleTimeline 的 <ol>）
    expect(markup).toContain('data-testid="effect-preview-schedule-list"');

    // 5. 现有 milestone block 仍然出现（regression check：Task 31.1 没有删它）
    expect(markup).toContain('data-testid="effect-preview-progress-plan"');
  });

  it("does not mount the Stage C image panel / schedule timeline when no preview is active", () => {
    const specTree = buildSpecTreeFixture();

    const markup = renderToStaticMarkup(
      <EffectPreviewPanel
        jobId="job-1"
        job={null}
        specTree={specTree}
        effectPreviews={[]}
        initialPreviews={[]}
        agentCrew={null as unknown as BlueprintAgentCrewSnapshot | null}
        capabilityEvidence={[]}
        locale="zh-CN"
      />
    );

    // 当 activePreview === null 时，新组件不应该出现，避免污染空态视图
    expect(markup).not.toContain('data-testid="effect-preview-image-gallery"');
    expect(markup).not.toContain(
      'data-testid="effect-preview-schedule-list"'
    );
  });

  // -------------------------------------------------------------------------
  // Phase 4 · Tasks 31.2 + 34.4: architectureSvgDraft now flows from
  // activePreview through to the dangerouslySetInnerHTML mount path inside
  // EffectPreviewImagePanel. The server-side `draftSvgArchitecture`
  // (svg-architecture-drafter.ts) runs the whitelist sanitizer
  // `sanitizeSvgArchitectureDraft` before the SVG reaches the client, so
  // the production wiring can pass the field through directly.
  // -------------------------------------------------------------------------

  /** Known sanitized SVG body used to assert pass-through to the DOM mount. */
  const SANITIZED_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';

  it("renders the architecture-svg anchor and SVG body when activePreview.architectureSvgDraft is a sanitized string", () => {
    const specTree = buildSpecTreeFixture();
    const previewWithSvg: BlueprintEffectPreviewSnapshot = {
      ...buildEffectPreviewSnapshotFixture(),
      architectureSvgDraft: SANITIZED_SVG,
    };

    const markup = renderToStaticMarkup(
      <EffectPreviewPanel
        jobId="job-1"
        job={null}
        specTree={specTree}
        effectPreviews={[previewWithSvg]}
        initialPreviews={[previewWithSvg]}
        agentCrew={null as unknown as BlueprintAgentCrewSnapshot | null}
        capabilityEvidence={[]}
        locale="zh-CN"
      />
    );

    // The architecture-svg content anchor is mounted by EffectPreviewImagePanel
    // when it receives a non-empty architectureSvgDraft prop.
    expect(markup).toContain(
      'data-testid="effect-preview-architecture-svg-content"'
    );
    // The sanitized SVG body is injected via dangerouslySetInnerHTML.
    expect(markup).toContain('viewBox="0 0 100 100"');
    expect(markup).toContain('<circle cx="50" cy="50" r="40"');
  });

  it("omits the architecture-svg anchor when activePreview.architectureSvgDraft is undefined", () => {
    const specTree = buildSpecTreeFixture();
    const previewNoSvg = buildEffectPreviewSnapshotFixture();
    // Defensive: ensure the field really is absent on the fixture (the
    // production type is `string | undefined`, so we test the `undefined`
    // path. The shared contract does not include `null`, so we don't
    // assert that case — TypeScript prevents it from reaching the panel
    // through a normalized snapshot anyway).
    expect(
      (previewNoSvg as { architectureSvgDraft?: string }).architectureSvgDraft
    ).toBeUndefined();

    const markup = renderToStaticMarkup(
      <EffectPreviewPanel
        jobId="job-1"
        job={null}
        specTree={specTree}
        effectPreviews={[previewNoSvg]}
        initialPreviews={[previewNoSvg]}
        agentCrew={null as unknown as BlueprintAgentCrewSnapshot | null}
        capabilityEvidence={[]}
        locale="zh-CN"
      />
    );

    expect(markup).not.toContain(
      'data-testid="effect-preview-architecture-svg-content"'
    );
  });
});
