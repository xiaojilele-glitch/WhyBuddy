/**
 * `<EffectPreviewImagePanel>` PBT (Property 7) + 例子测试 (Task 13.2)
 *
 * autopilot-image-rendering-and-visual-system · Phase 1 · Tasks 12.7 + 13.2
 *
 * 测试策略（与本仓库现有 autopilot 组件测试惯例一致）：
 *   本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`（引入这些
 *   工具属于跨规格的工具链改造，不在本规格范围内）。因此沿用
 *   `CapabilitySnapshotBadges.test.tsx` / `ProjectMainChainTimeline.test.tsx` /
 *   `AutopilotImageSettingsPanel.test.tsx` 的做法：
 *     - 渲染：`react-dom/server` 的 `renderToStaticMarkup`
 *     - 取值：在产物 HTML 上做字符串 / 正则断言，依赖组件的稳定
 *       `data-component` / `data-node-id` / `data-testid` anchors
 *     - 文件名：通过组件命名导出 `buildDownloadFilename` 直接覆盖
 *       Property 7 的纯函数行为（spec 13.2 的 fallback 路径），
 *       这样不需要 simulate click 即可对 `onDownload` 期望传入的文件名
 *       建立强契约。
 *
 * 软耦合校验：所有取色都通过 `@/lib/autopilot/visual-tokens-placeholder`
 * 的 `visualTokens` 注入，与 Phase 2 / Phase 3 的单一替换点约束一致。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import { visualTokens } from "@/lib/autopilot/visual-tokens-placeholder";

import {
  buildDownloadFilename,
  EffectPreviewImagePanel,
  type NodeImageRecord,
  type ProgressPlanEntry,
} from "../EffectPreviewImagePanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 渲染 panel SSR markup 的精简包装。
 *
 * - 默认 `activeStageKey="effect_preview"` 触发挂载；其它阶段需要测试时显式覆盖。
 * - `onDownload` 默认 noop，因为 SSR 不会触发点击 handler；Property 7 的
 *   下载文件名行为通过纯导出 `buildDownloadFilename` 直接覆盖。
 */
function renderPanel(args: {
  readonly activeStageKey?: string;
  readonly progressPlan: ReadonlyArray<ProgressPlanEntry>;
  readonly imageBase64ByNodeId?: Record<string, NodeImageRecord>;
  readonly architectureSvgDraft?: string;
  readonly missionId?: string;
  readonly version?: number;
  readonly theme?: "light" | "dark";
}): string {
  return renderToStaticMarkup(
    <EffectPreviewImagePanel
      missionId={args.missionId ?? "mission-test"}
      activeStageKey={args.activeStageKey ?? "effect_preview"}
      progressPlan={args.progressPlan}
      imageBase64ByNodeId={args.imageBase64ByNodeId ?? {}}
      architectureSvgDraft={args.architectureSvgDraft}
      visualTokens={visualTokens}
      onDownload={() => {
        /* noop — SSR 不触发 click handler */
      }}
      theme={args.theme ?? "light"}
      version={args.version}
    />,
  );
}

/**
 * 提取 markup 中所有 `data-node-id="X"` 的 X，按出现顺序返回。
 *
 * 同一 nodeId 在 download button 上也会出现一次（带 `data-testid` 区分），
 * 这里只保留 `<section data-testid="effect-preview-image-group">` 上的 group
 * 级 anchor —— 通过 testid 同时匹配过滤掉 download button 的次出现。
 */
function extractGroupNodeIds(markup: string): string[] {
  // 匹配 <section ... data-node-id="X" ... data-testid="effect-preview-image-group" ...>
  // 或者 data-testid 与 data-node-id 顺序相反的两种排列。
  const re =
    /<section\b[^>]*\bdata-node-id="([^"]+)"[^>]*\bdata-testid="effect-preview-image-group"[^>]*>|<section\b[^>]*\bdata-testid="effect-preview-image-group"[^>]*\bdata-node-id="([^"]+)"[^>]*>/g;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    ids.push(m[1] ?? m[2]);
  }
  return ids;
}

/**
 * 构造一个最小可用的 `NodeImageRecord`（任意稳定占位字符串）。
 */
function makeImageRecord(seed: string): NodeImageRecord {
  return {
    b64: `b64-${seed}`,
    mimeType: "image/png",
    promptUsed: `prompt for ${seed}`,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Property 7 — Filename generation determinism
// ---------------------------------------------------------------------------

describe(
  "Feature: autopilot-image-rendering-and-visual-system, " +
    "Property 7: Filename generation determinism",
  () => {
    /**
     * Property 7a — `buildDownloadFilename(nodeId, version, timestamp)` 严格
     * 等于 `effect-preview-${nodeId}-v${version}-${timestamp}.png`。
     *
     * 直接对纯函数取证（与 spec 中 "If filename is computed by a pure helper
     * exposed alongside the component, you can additionally test that helper
     * directly" 的允许路径一致），同时也是 Task 13.2 Test 3 的 fallback
     * 实现路径。
     *
     * **Validates: Requirements 8.2, 8.3**
     */
    it("buildDownloadFilename returns effect-preview-${nodeId}-v${version}-${timestamp}.png exactly", () => {
      fc.assert(
        fc.property(
          // nodeId 是普通字符串；不限制字符以覆盖任意非空命名空间。
          fc.string({ minLength: 1, maxLength: 64 }),
          // version 是非负整数（spec：`v${version}`）
          fc.integer({ min: 0, max: 1_000_000 }),
          // timestamp 是非负整数毫秒（spec：`Date.now()` 形态）
          fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
          (nodeId, version, timestamp) => {
            const filename = buildDownloadFilename(nodeId, version, timestamp);
            expect(filename).toBe(
              `effect-preview-${nodeId}-v${version}-${timestamp}.png`,
            );
            // 调用两次必须等价（纯函数 / 确定性）
            expect(buildDownloadFilename(nodeId, version, timestamp)).toBe(
              filename,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    /**
     * Property 7b — 任意 N ∈ [1,8] 个 distinct nodeIds，渲染 panel 后 DOM
     * 中恰好出现 N 个 `<section data-node-id="…" data-testid="effect-preview-image-group">`
     * group 元素，且 nodeId 集合与输入集合相等（无 group 复用同一 nodeId）。
     *
     * **Validates: Requirements 8.2, 8.3**
     */
    it("renders exactly N group elements with one data-node-id per distinct nodeId", () => {
      fc.assert(
        fc.property(
          // 1..8 个 distinct nodeId
          fc
            .uniqueArray(
              // nodeIds 限制在 ASCII letter / digit / dash 集合，确保不会被
              // SSR HTML 转义后影响 data-node-id 属性匹配（避免 `<` / `&` / `"`
              // 等元字符干扰提取正则）。
              fc.stringMatching(/^[a-zA-Z0-9-]{1,16}$/),
              { minLength: 1, maxLength: 8 },
            )
            .filter((arr) => arr.length >= 1),
          (nodeIds) => {
            const progressPlan: ProgressPlanEntry[] = nodeIds.map((id) => ({
              nodeId: id,
              state: "completed" as const,
            }));
            const imageBase64ByNodeId: Record<string, NodeImageRecord> = {};
            for (const id of nodeIds) {
              imageBase64ByNodeId[id] = makeImageRecord(id);
            }

            const markup = renderPanel({
              progressPlan,
              imageBase64ByNodeId,
            });

            const rendered = extractGroupNodeIds(markup);

            // 数量恰好等于 N
            expect(rendered).toHaveLength(nodeIds.length);
            // 内容集合一致（顺序由 progressPlan 决定，与输入数组顺序相同）
            expect(rendered).toEqual([...nodeIds]);
            // pairwise 唯一：没有两个 group 共享同一 nodeId
            expect(new Set(rendered).size).toBe(rendered.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Task 13.2 — Example tests
// ---------------------------------------------------------------------------

describe("<EffectPreviewImagePanel> · Task 13.2 example tests", () => {
  /**
   * Test 1 — 渲染条件：`activeStageKey === "effect_preview"` 时挂载，其它
   * stage 时不渲染（DOM 中不出现 panel root `data-component` 标记）。
   *
   * **Validates: Requirements 8.2, 9.1**
   */
  describe("activeStageKey gating", () => {
    it('mounts the panel when activeStageKey === "effect_preview"', () => {
      const markup = renderPanel({
        activeStageKey: "effect_preview",
        progressPlan: [
          { nodeId: "n-1", state: "pending" },
        ],
      });
      expect(markup).toContain('data-component="effect-preview-image-panel"');
    });

    it("renders nothing when activeStageKey is any other value", () => {
      const otherStageKeys = [
        "spec_documents",
        "route_planning",
        "execution",
        "evidence",
        "",
        "unknown",
      ];
      for (const stage of otherStageKeys) {
        const markup = renderPanel({
          activeStageKey: stage,
          progressPlan: [
            { nodeId: "n-1", state: "running" },
          ],
        });
        expect(markup).not.toContain(
          'data-component="effect-preview-image-panel"',
        );
        // 同时也不应渲染 group / orb 等内部 anchor
        expect(markup).not.toContain('data-testid="effect-preview-image-group"');
        expect(markup).not.toContain('data-testid="effect-preview-loading-orb"');
      }
    });
  });

  /**
   * Test 2 — Loading orb 存在性：当 `progressPlan` 至少一条 entry
   * `state === "running"` 时，conic-gradient orb DOM 元素必须出现。
   *
   * 该组件用 `data-testid="effect-preview-loading-orb"` 作为 orb 的稳定 anchor，
   * 同时其 inline style 包含 `conic-gradient(`（spec 允许的兜底标志）。两条线
   * 索都做断言以加固契约。
   *
   * **Validates: Requirements 9.1, 9.2**
   */
  describe("loading orb existence", () => {
    it("renders a conic-gradient orb when at least one entry is running", () => {
      const markup = renderPanel({
        progressPlan: [
          { nodeId: "n-pending", state: "pending" },
          { nodeId: "n-running", state: "running", title: "正在出图节点" },
          { nodeId: "n-completed", state: "completed" },
        ],
      });

      // 1. orb 元素本身（带稳定 testid）。
      expect(markup).toContain('data-testid="effect-preview-loading-orb"');

      // 2. orb 的 inline 背景应以 conic-gradient(...) 渲染（spec 兜底标志）。
      //    SSR 会把 `background: "conic-gradient(...)"` 序列化为
      //    `style="background:conic-gradient(...)"`，因此简单字面量包含即可。
      expect(markup).toContain("conic-gradient(");

      // 3. 节点名称标签紧随 orb 出现。
      expect(markup).toContain('data-testid="effect-preview-loading-orb-label"');
      expect(markup).toContain("正在出图节点 出图中");
    });

    it("does not render a loading orb when no entry is running", () => {
      const markup = renderPanel({
        progressPlan: [
          { nodeId: "n-1", state: "pending" },
          { nodeId: "n-2", state: "completed" },
          { nodeId: "n-3", state: "failed", fallbackTier: "timeout" },
          { nodeId: "n-4", state: "text-only", fallbackTier: "moderation" },
        ],
      });
      expect(markup).not.toContain(
        'data-testid="effect-preview-loading-orb"',
      );
      expect(markup).not.toContain("conic-gradient(");
    });
  });

  /**
   * Test 3 — 下载文件名匹配 Property 7 模板。
   *
   * 实现路径：本仓库未集成 jsdom，无法在 SSR 输出上 simulate 真实点击；
   * 因此沿 spec 13.2 中 "fall back to testing the pure filename helper
   * directly" 的允许路径，对组件的命名导出 `buildDownloadFilename`
   * 取证。同时为了证明组件在「有图像记录」时确实会渲染下载按钮（即点击会
   * 触发 handler），额外用 SSR markup 校验 download button 与 image record
   * 的成对出现。
   *
   * **Validates: Requirements 8.2, 8.3, 9.1, 9.2**
   */
  describe("download filename template", () => {
    it("buildDownloadFilename matches /^effect-preview-.+-v\\d+-\\d+\\.png$/", () => {
      const filename = buildDownloadFilename("node-abc", 7, 1_700_000_000_000);
      expect(filename).toBe("effect-preview-node-abc-v7-1700000000000.png");
      expect(filename).toMatch(/^effect-preview-.+-v\d+-\d+\.png$/);
    });

    it("renders the download button when a NodeImageRecord exists for a node", () => {
      const markup = renderPanel({
        progressPlan: [
          { nodeId: "node-with-image", state: "completed" },
        ],
        imageBase64ByNodeId: {
          "node-with-image": makeImageRecord("node-with-image"),
        },
      });

      // 下载按钮必须出现并携带 nodeId（这是 onClick handler 用来构造文件名的输入）
      expect(markup).toContain(
        'data-testid="effect-preview-download-button"',
      );
      expect(markup).toMatch(
        /<button\b[^>]*data-testid="effect-preview-download-button"[^>]*data-node-id="node-with-image"|<button\b[^>]*data-node-id="node-with-image"[^>]*data-testid="effect-preview-download-button"/,
      );
    });

    it("does not render a download button when no image record exists", () => {
      const markup = renderPanel({
        progressPlan: [
          { nodeId: "node-without-image", state: "running" },
        ],
        imageBase64ByNodeId: {},
      });
      expect(markup).not.toContain(
        'data-testid="effect-preview-download-button"',
      );
    });
  });
});
