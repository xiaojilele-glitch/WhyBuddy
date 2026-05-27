/**
 * autopilot-image-rendering-and-visual-system · Phase 4 · Task 35.4
 *
 * Production integration regression for `<EffectPreviewPanel>` 与
 * `<AutopilotImageSettingsPanel>` 之间的接线。
 *
 * 背景：Phase 1 落地了 `AutopilotImageSettingsPanel` 的脱敏 API key
 * 视图，Phase 4 Task 35.1 / 35.2 落地了 server route
 * `GET /api/blueprint/image-settings` 与 sentinel-leak regression。
 * Task 35.3 把面板挂在 right-rail 的「调度时间线下方、milestone 区块
 * 上方」位置，并通过 `useEffect` 在 mount 时拉取真实配置。
 *
 * 本测试覆盖 Task 35.3 的接线契约。
 *
 * --- 测试策略（Strategy A：`initialImageSettings` prop 注入） ---
 *
 * 仓库测试惯例使用 `react-dom/server` 的 `renderToStaticMarkup`，**SSR
 * 路径不会执行 `useEffect`**，因此无法在 SSR 渲染产物里观测「fetch
 * 完成后再次渲染」的状态变化。为了仍然能验证「拿到 view model 之后
 * 面板内挂出 masked key / model / timeout」这条链路，本面板暴露了一个
 * 测试专用 prop `initialImageSettings: ImageSettingsViewModel | null`：
 * - 传入时，面板把它当作初始 state，跳过 fetch
 * - 不传（生产路径）时，挂载后异步 fetch
 *
 * 这模式与已有的 `initialPreviews` / `onPreviewsChange` 一致（参见
 * `EffectPreviewPanel.image-integration.test.tsx`）。
 *
 * --- 测试用例 ---
 *
 * 1. **Loading state**：不传 `initialImageSettings`、不 mock fetch（SSR
 *    下 `useEffect` 不触发，因此 fetch 永不发出）。断言 SSR markup
 *    包含 `data-testid="autopilot-image-settings-panel-loading"` 且
 *    **不** 包含任何 masked key 字面量。这等价于「fetch 仍在 in-flight」。
 *
 * 2. **Ready state**：通过 `initialImageSettings={...}` 直接注入一份
 *    view model，断言 SSR markup：
 *    - 包含 masked key `"sk-test-•••••CDEF"`
 *    - 包含 model `"gpt-image-2"`
 *    - 包含 timeout `"60000"`
 *    - **不** 包含 sentinel raw-key `"SENTINEL-RAW-KEY-NEVER-EXPOSE"`
 *
 * 3. ~~**Error state**~~：在 SSR + `react-dom/server` 路径下无法可靠
 *    地把组件状态推到 `"error"`（fetch 不会触发 `useEffect`，且没有
 *    专用 `initialImageSettings={"error"}` 输入端口）。如果想验证错误
 *    UI，需要走 jsdom + `@testing-library/react`，那是跨规格的工具链
 *    改造，不在本任务范围内。本文件因此 **drop test 3**，并在面板
 *    源码里通过显式分支保证 `imageSettingsState === "error"` 时渲染
 *    `data-testid="autopilot-image-settings-panel-error"` 与字面量
 *    `"无法读取图像服务配置"`。Loading-state 测试已经覆盖「无 view
 *    model 时不出现 masked key」这一最关键安全不变量。
 *
 * --- 实现约束 ---
 *
 * - 严格走 `renderToStaticMarkup`，与 `EffectPreviewPanel.image-integration.test.tsx`
 *   一致
 * - 不引入 `@testing-library/react` / `jsdom` / `happy-dom`
 * - 不 mock `EffectPreviewPanel` / `AutopilotImageSettingsPanel` 本身
 * - fixture 用最小 spec tree + 单 preview，足够触发面板挂载分支
 *
 * @see Requirements 10.1, 10.2, 10.3
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
// Sentinel — must NEVER appear in any rendered DOM
// ---------------------------------------------------------------------------

/**
 * Unique raw-key sentinel string. The wire contract guarantees that the
 * raw `IMAGE_GEN_API_KEY` is replaced server-side by `maskedApiKey`
 * (see `server/routes/blueprint/image-settings.ts`), so a value matching
 * this sentinel must never reach the panel.
 */
const SENTINEL_RAW_KEY = "SENTINEL-RAW-KEY-NEVER-EXPOSE";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function buildSpecTreeFixture(): BlueprintSpecTree {
  return {
    id: "tree-settings-1",
    rootNodeId: "node-A",
    routeSetId: "route-1",
    jobId: "job-settings-1",
    version: 1,
    status: "reviewing",
    nodes: [
      {
        id: "node-A",
        title: "Node A",
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

function buildEffectPreviewFixture(): BlueprintEffectPreviewSnapshot {
  return {
    id: "preview-settings-1",
    jobId: "job-settings-1",
    treeId: "tree-settings-1",
    nodeId: "node-A",
    version: 1,
    status: "preview",
    sourceDocumentIds: ["doc-1"],
    createdAt: "2026-05-23T07:00:00.000Z",
    updatedAt: "2026-05-23T07:00:00.000Z",
    summary: "Preview without Stage C raster output",
    architectureNotes: [],
    prototypeNotes: [],
    progressPlan: [
      {
        id: "milestone-1",
        title: "Milestone",
        summary: "summary",
        target: "target",
        sourceDocumentIds: ["doc-1"],
      },
    ],
    nodes: [],
  } as unknown as BlueprintEffectPreviewSnapshot;
}

/**
 * Pre-built ready-state view model. The masked key shape matches the
 * server's `maskApiKey` algorithm:
 *   head(8) + "•".repeat(length - 14) + tail(6)
 * Here `"sk-test-"` (8) + 3 bullets + `"••CDEF"` (6) = 17 chars total.
 *
 * The panel re-applies its own `maskApiKey` to the `apiKey` prop. For an
 * already-masked input where the middle segment is composed of the same
 * U+2022 BULLET fill character, the operation is idempotent — slice(0,8)
 * + bullets × (length - 14) + slice(-6) reproduces the input byte-for-byte.
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
// Tests
// ---------------------------------------------------------------------------

describe("EffectPreviewPanel · Phase 4 Task 35.3 image settings wiring", () => {
  it("renders the loading placeholder and no masked key when initialImageSettings is omitted in SSR", () => {
    const specTree = buildSpecTreeFixture();
    const preview = buildEffectPreviewFixture();

    const markup = renderToStaticMarkup(
      <EffectPreviewPanel
        jobId="job-settings-1"
        job={null}
        specTree={specTree}
        effectPreviews={[preview]}
        initialPreviews={[preview]}
        agentCrew={null as unknown as BlueprintAgentCrewSnapshot | null}
        capabilityEvidence={[]}
        locale="zh-CN"
      />
    );

    // Loading anchor is mounted while imageSettings is null + state === "loading".
    expect(markup).toContain(
      'data-testid="autopilot-image-settings-panel-loading"'
    );

    // Ready / error anchors must NOT appear in loading state.
    expect(markup).not.toContain(
      'data-testid="autopilot-image-settings-panel"'
    );
    expect(markup).not.toContain(
      'data-testid="autopilot-image-settings-panel-error"'
    );
    expect(markup).not.toContain('data-testid="masked-api-key"');

    // No masked key value should be rendered yet — the fetch hasn't run
    // (SSR skips useEffect) and no `initialImageSettings` was injected.
    expect(markup).not.toContain("sk-test-");

    // Sentinel raw-key value must never appear in any state.
    expect(markup).not.toContain(SENTINEL_RAW_KEY);
  });

  it("renders the masked api key, model, and timeout when initialImageSettings is injected", () => {
    const specTree = buildSpecTreeFixture();
    const preview = buildEffectPreviewFixture();

    const markup = renderToStaticMarkup(
      <EffectPreviewPanel
        jobId="job-settings-1"
        job={null}
        specTree={specTree}
        effectPreviews={[preview]}
        initialPreviews={[preview]}
        agentCrew={null as unknown as BlueprintAgentCrewSnapshot | null}
        capabilityEvidence={[]}
        locale="zh-CN"
        initialImageSettings={READY_VIEW_MODEL}
      />
    );

    // Real panel anchor is mounted.
    expect(markup).toContain('data-testid="autopilot-image-settings-panel"');

    // Loading / error anchors are absent.
    expect(markup).not.toContain(
      'data-testid="autopilot-image-settings-panel-loading"'
    );
    expect(markup).not.toContain(
      'data-testid="autopilot-image-settings-panel-error"'
    );

    // Masked key value is rendered byte-for-byte (re-mask is idempotent
    // on already-masked input — see fixture comment).
    expect(markup).toContain("sk-test-\u2022\u2022\u2022\u2022\u2022CDEF");

    // Config enum values flow through.
    expect(markup).toContain("gpt-image-2");
    expect(markup).toContain("60000");

    // Sentinel raw-key value must never appear.
    expect(markup).not.toContain(SENTINEL_RAW_KEY);
  });
});
