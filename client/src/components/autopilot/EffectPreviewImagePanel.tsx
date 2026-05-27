/**
 * autopilot-image-rendering-and-visual-system · Phase 1 · Task 9.1
 *
 * `EffectPreviewImagePanel` — autopilot 右侧 rail 的 effect preview 图像画廊。
 *
 * 行为约束：
 * - `activeStageKey === "effect_preview"` 时挂在 autopilot 右侧 rail 渲染；
 *   其它阶段返回 `null`（需求 9.1）。
 * - `architectureSvgDraft` 非空时优先渲染 SVG 架构草图，与 raster 图像分区展示
 *   （需求 3.3 / 8.1）。
 * - `progressPlan` 中每个节点渲染为 `<section data-node-id={nodeId}>`：
 *   - `state === "running"` 时展示 conic-gradient loading orb 与节点名称标签
 *     （需求 9.2）。
 *   - `imageBase64ByNodeId[nodeId]` 存在时展示 `<img src="data:..." />` 与
 *     下载按钮；下载按钮点击时构造文件名
 *     `effect-preview-${nodeId}-v${version}-${Date.now()}.png` 并通过
 *     `onDownload(filename, b64, mimeType)` 回调（需求 8.2 / 8.3）。
 *
 * 取色契约（Phase 2 视觉令牌单一替换点）：
 * - 颜色统一从 `@/lib/autopilot/visual-tokens-placeholder` 通过 `resolveToken`
 *   或注入的 `visualTokens` 取得；组件内部 **禁止** 出现 `#`、`rgb(`、`hsl(`、
 *   `oklch(` 等颜色字面量（需求 17.1）。
 * - conic-gradient loading orb 使用 3 段 token 颜色插值
 *   （`entry` → `data-state` → `ai-capability`）以表达 「活跃入口 → 数据状态 →
 *   AI 能力」的视觉层次。
 *
 * 缓存策略（可选）：
 * - 当 `cache` 注入且节点存在 `imageBase64ByNodeId[nodeId]` 时，组件 fire-and-forget
 *   写入 `ImageGalleryCache`；写入失败被静默吞掉，绝不冒泡到调用方（需求 9.3 / 9.4）。
 *
 * @see Requirements 8.2, 8.3, 9.1, 9.2, 17.1, 18.3
 */

import { useEffect, type ReactElement } from "react";

import { sanitizeSvgArchitectureDraft } from "@shared/blueprint/svg-sanitizer";

import {
  resolveToken,
  type VisualTokenKey,
  type VisualTokenSet,
} from "@/lib/autopilot/visual-tokens-placeholder";
import type { ImageGalleryCache } from "@/lib/autopilot/image-gallery-cache";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `progressPlan` 单条条目可达状态。
 *
 * 与 `EffectPreviewScheduleTimeline` 中的 `ProgressPlanState` 联合保持一致；
 * 客户端组件只读这些字段，永不写回。
 */
export type ProgressPlanState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "text-only";

/**
 * 6 级降级层级。与 `shared/blueprint/contracts.ts` 中的 `FallbackTier`
 * 一致；本文件本地声明等价别名以维持 props 形状自描述。
 */
export type FallbackTier =
  | "env-disabled"
  | "key-missing"
  | "timeout"
  | "quota"
  | "moderation"
  | "upstream-failure";

/**
 * `EffectPreviewImagePanel` 消费的 `progressPlan` 元素。
 *
 * 字段语义与服务端 `EffectPreviewScheduler` 输出的 `ProgressPlanEntry`
 * 保持一致。
 */
export interface ProgressPlanEntry {
  /** SPEC tree node id；与 `imageBase64ByNodeId` 的键一一对应。 */
  readonly nodeId: string;
  /** 当前节点处理状态。 */
  readonly state: ProgressPlanState;
  /** 可选 — 节点显示标题；缺失时回退展示 `nodeId`。 */
  readonly title?: string;
  /** 可选 — 节点摘要。 */
  readonly summary?: string;
  /** 进入 raster 调用的起始时间（ISO8601）。 */
  readonly startedAt?: string;
  /** 处理完成 / 失败时间（ISO8601）。 */
  readonly endedAt?: string;
  /** 6 级降级层级；仅 `failed` / `text-only` 终态写入。 */
  readonly fallbackTier?: FallbackTier;
  /** 失败摘要；不含密钥或原始 prompt。 */
  readonly errorSummary?: string;
}

/**
 * 单节点最近一次成功生成的 base64 图像记录。
 *
 * 与 `shared/blueprint/contracts.ts#NodeImageRecord` 字段级一致；客户端组件
 * 本地重声明以避免在 client/server 之间产生交叉依赖。
 */
export interface NodeImageRecord {
  /** Image bytes encoded as base64 (no `data:` prefix). */
  readonly b64: string;
  /** MIME type returned by the upstream image API, e.g. `"image/png"`。 */
  readonly mimeType: string;
  /** 写入该节点的 prompt 字符串；用于审计与重放。 */
  readonly promptUsed: string;
  /** ISO8601 timestamp when the image was generated. */
  readonly generatedAt: string;
}

/**
 * 组件 props。
 *
 * - `activeStageKey`：当前 autopilot 阶段 key；非 `"effect_preview"` 时返回 `null`。
 * - `missionId`：当前 mission 标识；用于 `ImageGalleryCache` 的复合主键。
 * - `progressPlan`：节点 → 状态映射的有序数组；DOM 渲染顺序来源。
 * - `imageBase64ByNodeId`：节点 ID → `NodeImageRecord` 的成功生成记录映射。
 * - `architectureSvgDraft`：SVG 架构草图字符串；非空时渲染在画廊顶部。
 * - `visualTokens`：8-key OKLCH 调色板（由消费方从 `visual-tokens-placeholder` 注入）。
 * - `cache`：可选 IndexedDB LRU 24 缓存；命中时 fire-and-forget 写入。
 * - `onDownload`：下载按钮回调；接收文件名、b64 与 mime 类型。
 * - `theme`：当前主题，决定从 `OklchPair` 中取 `light` / `dark` 分支。
 * - `version`：当前 effect preview 版本号；缺省回退到 `1`。
 */
export interface EffectPreviewImagePanelProps {
  readonly missionId: string;
  readonly activeStageKey: string;
  readonly progressPlan: ReadonlyArray<ProgressPlanEntry>;
  readonly imageBase64ByNodeId: Record<string, NodeImageRecord>;
  readonly architectureSvgDraft?: string;
  readonly visualTokens: VisualTokenSet;
  readonly cache?: ImageGalleryCache;
  readonly onDownload: (
    filename: string,
    b64: string,
    mimeType: string,
  ) => void;
  readonly theme: "light" | "dark";
  readonly version?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 从注入的 `visualTokens` 取色，缺失时回落到模块级 `resolveToken`。
 *
 * 两侧最终都来自 `visual-tokens-placeholder` 这个单一替换点，保持
 * 「取色单一来源」的语义不变。
 */
function colorFor(
  key: VisualTokenKey,
  visualTokens: VisualTokenSet,
  theme: "light" | "dark",
): string {
  const pair = visualTokens[key];
  if (pair !== undefined && pair[theme] !== undefined) {
    return pair[theme];
  }
  return resolveToken(key, theme);
}

/**
 * 状态 → 视觉令牌 key 的稳定映射。
 *
 * 与 `EffectPreviewScheduleTimeline` 中的 `PROGRESS_STATE_TOKEN_KEY` 对齐，
 * 避免画廊节点框线与时间线条目颜色不一致。
 */
const PROGRESS_STATE_TOKEN_KEY: {
  readonly [S in ProgressPlanState]: VisualTokenKey;
} = {
  pending: "data-state",
  running: "entry",
  completed: "backend-core",
  failed: "business-loop",
  "text-only": "governance",
};

/**
 * 状态 → 可访问性文本的稳定映射。
 */
const STATE_LABEL: { readonly [S in ProgressPlanState]: string } = {
  pending: "待出图",
  running: "出图中",
  completed: "已完成",
  failed: "已失败",
  "text-only": "纯文本兜底",
};

/**
 * 构造下载文件名 — `effect-preview-${nodeId}-v${version}-${timestamp}.png`。
 *
 * Property 7（Filename generation determinism）要求 timestamp 来自调用时刻
 * 的 `Date.now()`，nodeId / version 直接拼接。
 *
 * 公开为命名导出，便于 Property 7 PBT 直接断言纯函数行为，无需依赖
 * SSR / DOM event 模拟。
 */
export function buildDownloadFilename(
  nodeId: string,
  version: number,
  timestamp: number,
): string {
  return `effect-preview-${nodeId}-v${version}-${timestamp}.png`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `EffectPreviewImagePanel` — autopilot 右侧 rail 图像画廊。
 *
 * 实现要点：
 * - `activeStageKey !== "effect_preview"` 时直接返回 `null`，确保组件挂在
 *   rail 槽位时不会污染其它阶段的视觉（需求 9.1）。
 * - `architectureSvgDraft` 非空时使用 `dangerouslySetInnerHTML` 把 SVG
 *   字符串渲染在 `<div data-architecture-svg>` 容器中，与 raster 图像
 *   严格分区展示（需求 3.3）。
 * - 每个 `progressPlan` 节点渲染为 `<section data-node-id={nodeId}>`：
 *   - `state === "running"` 时展示 conic-gradient loading orb（3 段
 *     token 颜色插值）与节点名称标签（需求 9.2）。
 *   - `imageBase64ByNodeId[nodeId]` 存在时展示 `<img>` 与下载按钮，
 *     并通过 `cache.put` fire-and-forget 写入 IndexedDB LRU 24 缓存
 *     （需求 8.2 / 8.3 / 9.3 / 9.4）。
 * - 颜色全部来自 `visualTokens` + `resolveToken`，组件内部 **不出现**
 *   任何颜色字面量（需求 17.1）。
 */
export function EffectPreviewImagePanel(
  props: EffectPreviewImagePanelProps,
): ReactElement | null {
  const {
    missionId,
    activeStageKey,
    progressPlan,
    imageBase64ByNodeId,
    architectureSvgDraft,
    visualTokens,
    cache,
    onDownload,
    theme,
    version = 1,
  } = props;

  // hooks 必须在所有 early return 之前调用，遵循 React Rules of Hooks。
  // 缓存写入：fire-and-forget；任何失败都在 .catch 中静默吞掉。
  useEffect(() => {
    if (cache === undefined) {
      return;
    }
    for (const entry of progressPlan) {
      const record = imageBase64ByNodeId[entry.nodeId];
      if (record === undefined) {
        continue;
      }
      const key = `${missionId}:${entry.nodeId}:${version}`;
      try {
        void cache
          .put({
            key,
            missionId,
            nodeId: entry.nodeId,
            version,
            b64: record.b64,
            mimeType: record.mimeType,
            promptUsed: record.promptUsed,
            generatedAt: record.generatedAt,
            storedAt: Date.now(),
          })
          .catch(() => {
            /* swallow cache write errors silently */
          });
      } catch {
        /* swallow cache write errors silently */
      }
    }
  }, [cache, imageBase64ByNodeId, missionId, progressPlan, version]);

  // 仅在 effect_preview 阶段渲染（需求 9.1）。
  if (activeStageKey !== "effect_preview") {
    return null;
  }

  // conic-gradient loading orb 使用 3 段 token 颜色插值。
  const orbEntryColor = colorFor("entry", visualTokens, theme);
  const orbDataStateColor = colorFor("data-state", visualTokens, theme);
  const orbAiCapabilityColor = colorFor("ai-capability", visualTokens, theme);
  const orbBackground = `conic-gradient(${orbEntryColor} 0deg, ${orbDataStateColor} 180deg, ${orbAiCapabilityColor} 360deg)`;

  // SVG 区块边框使用 `data-state` 表达「中间产物 / 数据态」语义。
  const svgBorderColor = colorFor("data-state", visualTokens, theme);
  const svgLabelColor = colorFor("data-state", visualTokens, theme);

  return (
    <section
      data-component="effect-preview-image-panel"
      data-active-stage-key={activeStageKey}
      data-mission-id={missionId}
      data-theme={theme}
      aria-label="effect preview image gallery"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        minWidth: 0,
      }}
    >
      {architectureSvgDraft !== undefined && architectureSvgDraft.length > 0 && (
        <div
          data-architecture-svg
          data-testid="effect-preview-architecture-svg"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            padding: "0.5rem",
            borderRadius: "0.5rem",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: svgBorderColor,
          }}
        >
          <span
            data-testid="effect-preview-architecture-svg-label"
            style={{
              fontSize: "0.75rem",
              fontWeight: 500,
              color: svgLabelColor,
            }}
          >
            架构草图
          </span>
          <div
            data-testid="effect-preview-architecture-svg-content"
            style={{ display: "flex", minWidth: 0 }}
            // Defense-in-depth (Phase 5 Task 44.2): even though the
            // server-side `draftSvgArchitecture` already runs the SVG
            // through `sanitizeSvgArchitectureDraft` before persisting
            // it to `BlueprintEffectPreview.architectureSvgDraft`, we
            // sanitize again here. This catches:
            //   - legacy artifacts persisted before the server
            //     sanitizer landed (Phase 4 Task 34.1);
            //   - hand-crafted test fixtures that bypass the drafter;
            //   - any hypothetical future server-side bypass route.
            // The sanitizer is pure / deterministic / silent, so the
            // double pass is effectively free on already-clean input.
            dangerouslySetInnerHTML={{
              __html: sanitizeSvgArchitectureDraft(architectureSvgDraft),
            }}
          />
        </div>
      )}

      <ol
        data-testid="effect-preview-image-gallery"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {progressPlan.map((entry) => {
          const stateColor = colorFor(
            PROGRESS_STATE_TOKEN_KEY[entry.state],
            visualTokens,
            theme,
          );
          const label = entry.title ?? entry.nodeId;
          const stateLabel = STATE_LABEL[entry.state];
          const record = imageBase64ByNodeId[entry.nodeId];

          const handleDownload = () => {
            if (record === undefined) {
              return;
            }
            const filename = buildDownloadFilename(
              entry.nodeId,
              version,
              Date.now(),
            );
            onDownload(filename, record.b64, record.mimeType);
          };

          return (
            <li
              key={entry.nodeId}
              style={{ listStyle: "none" }}
            >
              <section
                data-node-id={entry.nodeId}
                data-testid="effect-preview-image-group"
                data-state={entry.state}
                aria-label={`${label} (${stateLabel})`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.5rem",
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor: stateColor,
                  color: stateColor,
                  minWidth: 0,
                }}
              >
                <header
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span
                    data-testid="effect-preview-image-node-label"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={entry.summary}
                  >
                    {label}
                  </span>
                  <span
                    data-testid="effect-preview-image-state-text"
                    data-state={entry.state}
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 400,
                      opacity: 0.85,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {stateLabel}
                  </span>
                </header>

                {entry.state === "running" && (
                  <div
                    data-testid="effect-preview-loading-orb-wrapper"
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <div
                      data-testid="effect-preview-loading-orb"
                      role="status"
                      aria-label={`${label} 出图中`}
                      style={{
                        width: "1.5rem",
                        height: "1.5rem",
                        borderRadius: "9999px",
                        background: orbBackground,
                      }}
                    />
                    <span
                      data-testid="effect-preview-loading-orb-label"
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 500,
                      }}
                    >
                      {label} 出图中
                    </span>
                  </div>
                )}

                {record !== undefined && (
                  <div
                    data-testid="effect-preview-image-record"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                      minWidth: 0,
                    }}
                  >
                    <img
                      data-testid="effect-preview-image"
                      src={`data:${record.mimeType};base64,${record.b64}`}
                      alt={`${label} effect preview`}
                      style={{
                        maxWidth: "100%",
                        height: "auto",
                        borderRadius: "0.375rem",
                      }}
                    />
                    <button
                      type="button"
                      data-testid="effect-preview-download-button"
                      data-node-id={entry.nodeId}
                      onClick={handleDownload}
                      style={{
                        alignSelf: "flex-start",
                        padding: "0.25rem 0.625rem",
                        borderRadius: "0.375rem",
                        borderWidth: "1px",
                        borderStyle: "solid",
                        borderColor: stateColor,
                        backgroundColor: "transparent",
                        color: stateColor,
                        fontSize: "0.75rem",
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      下载图像
                    </button>
                  </div>
                )}

                {entry.fallbackTier !== undefined && (
                  <span
                    data-testid="effect-preview-image-fallback-tier"
                    data-fallback-tier={entry.fallbackTier}
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 400,
                      opacity: 0.75,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.fallbackTier}
                    {entry.errorSummary !== undefined &&
                      `: ${entry.errorSummary}`}
                  </span>
                )}
              </section>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default EffectPreviewImagePanel;
