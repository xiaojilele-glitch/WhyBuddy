/**
 * SVG architecture drafter — Stage C 中间制品生成器
 * （`autopilot-image-rendering-and-visual-system` spec, task 4.1）。
 *
 * 在调用栅格图像 API 之前，先把 `architectureNotes` 渲染成一张确定性的
 * SVG 架构草图，作为低成本的人类可审视中间制品（design §「Stage C
 * Pipeline Sequence」、requirements 3.1 / 3.2 / 3.3）。
 *
 * 设计原则：
 *
 * - 永不抛错：任何异常都被翻译为 `{ kind: "skipped", reason }`，由上游
 *   `ImageService` 决定是否在 `progressPlan[]` 上记录降级。
 * - 确定性：同输入必同输出。不调用 `Math.random()`，不读 `Date.now()`，
 *   不依赖外部状态；layout 完全由 `architectureNotes` 数组顺序与 index
 *   推导。
 * - 空输入快速跳过：`architectureNotes` 长度为 0 → 立即返回
 *   `{ kind: "skipped", reason: "no-architecture-notes" }`，零成本。
 * - 字段隔离：返回的 SVG 字符串供 `BlueprintEffectPreview.architectureSvgDraft`
 *   独立保存，不混入 `imageBase64ByNodeId` 的 raster 字段
 *   （Property 5 字段隔离不变量）。
 * - 输出契约：成功路径必含完整 `<svg ...>...</svg>` 字符串，且包含
 *   `viewBox` 属性、每条 note 一个分层 `<g>` 节点、文本标签与节点间
 *   的连接线（design 「SvgArchitectureDrafter」组件描述 + task 4.1
 *   验收清单）。
 *
 * 该模块没有任何 runtime / business import，亦不读取 `process.env`，
 * 因此可以从单元测试与上层 `image-service.ts` 同时安全引用。
 *
 * _Requirements: 3.1, 3.2, 3.3_
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `draft()` 输入。
 *
 * - `architectureNotes`：上游 spec 文档/effect preview 已产出的架构注释，
 *   长度为 0 时返回 `skipped`。
 * - `missionId`：用于在 SVG 标题/根节点 `data-mission-id` 上保留出处，
 *   便于审计回放。
 */
export interface SvgArchitectureDrafterInput {
  readonly architectureNotes: ReadonlyArray<string>;
  readonly missionId: string;
}

/**
 * `draft()` 结果。
 *
 * 任务 4.1 显式约定 `SvgDraftResult` 类型别名导出（与 design 中
 * `SvgArchitectureDrafterResult` 等价），下游 `image-service.ts` 通过
 * `kind` 字段做窄化判定。
 */
export type SvgDraftResult =
  | { readonly kind: "ok"; readonly svg: string }
  | { readonly kind: "skipped"; readonly reason: string };

/** Design §「SvgArchitectureDrafter」中暴露的别名，与 `SvgDraftResult` 等价。 */
export type SvgArchitectureDrafterResult = SvgDraftResult;

/**
 * `SvgArchitectureDrafter` 接口。
 *
 * `draft()` 返回 `Promise` 以便后续可换成异步生成器（例如本地 mermaid
 * CLI），当前实现是同步的纯函数包装。
 */
export interface SvgArchitectureDrafter {
  draft(input: SvgArchitectureDrafterInput): Promise<SvgDraftResult>;
}

// ---------------------------------------------------------------------------
// Layout constants — 全部确定性，禁止随机数与时间戳
// ---------------------------------------------------------------------------

const SVG_WIDTH = 720;
const NODE_WIDTH = 520;
const NODE_HEIGHT = 64;
const NODE_GAP = 32;
const PADDING_X = (SVG_WIDTH - NODE_WIDTH) / 2;
const PADDING_TOP = 96;
const PADDING_BOTTOM = 48;
const TITLE_Y = 56;

// 单条 note 渲染时允许的最大字符数；过长会被截断并附加省略号，
// 既避免 SVG 文本溢出，也保留在标签内对人眼可读的密度。
const MAX_LABEL_CHARS = 96;
const ELLIPSIS = "…";

// ---------------------------------------------------------------------------
// XML escape — 防止 note / missionId 中的 `<`、`&`、`"` 破坏 SVG 结构
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const ch = value.charCodeAt(index);
    switch (ch) {
      case 0x26: // &
        result += "&amp;";
        break;
      case 0x3c: // <
        result += "&lt;";
        break;
      case 0x3e: // >
        result += "&gt;";
        break;
      case 0x22: // "
        result += "&quot;";
        break;
      case 0x27: // '
        result += "&apos;";
        break;
      default:
        // 过滤 SVG 不接受的控制字符（除制表 / 换行 / 回车外的 <0x20）。
        if (ch < 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d) {
          result += " ";
        } else {
          result += value[index];
        }
        break;
    }
  }
  return result;
}

function truncateLabel(value: string): string {
  // 把所有空白折叠成单个空格，避免换行污染 SVG 文本。
  const collapsed = value.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= MAX_LABEL_CHARS) {
    return collapsed;
  }
  return collapsed.slice(0, MAX_LABEL_CHARS - 1) + ELLIPSIS;
}

// ---------------------------------------------------------------------------
// SVG fragment builders — 每个函数都是纯字符串拼接，便于单元测试
// ---------------------------------------------------------------------------

function buildBackground(height: number): string {
  return [
    `<rect x="0" y="0" width="${SVG_WIDTH}" height="${height}" fill="#0f172a" />`,
    `<rect x="0" y="0" width="${SVG_WIDTH}" height="${height}" fill="url(#sad-grid)" opacity="0.18" />`,
  ].join("");
}

function buildDefs(): string {
  return [
    "<defs>",
    '<pattern id="sad-grid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">',
    '<path d="M 32 0 L 0 0 0 32" fill="none" stroke="#1e293b" stroke-width="1" />',
    "</pattern>",
    '<marker id="sad-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">',
    '<path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />',
    "</marker>",
    "</defs>",
  ].join("");
}

function buildTitle(missionId: string): string {
  const label = `Architecture Draft · mission ${truncateLabel(missionId)}`;
  return [
    `<g class="sad-title">`,
    `<text x="${SVG_WIDTH / 2}" y="${TITLE_Y}" text-anchor="middle" `,
    'font-family="Inter, system-ui, sans-serif" font-size="20" font-weight="600" ',
    `fill="#e2e8f0">${escapeXml(label)}</text>`,
    "</g>",
  ].join("");
}

function buildNoteLayer(
  index: number,
  note: string,
  missionId: string,
): string {
  const y = PADDING_TOP + index * (NODE_HEIGHT + NODE_GAP);
  const labelText = truncateLabel(note) || `Note #${index + 1}`;
  const indexLabel = `0${index + 1}`.slice(-2);
  return [
    `<g class="sad-layer" data-layer-index="${index}" data-mission-id="${escapeXml(missionId)}">`,
    `<rect x="${PADDING_X}" y="${y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="14" ry="14" `,
    'fill="#1e293b" stroke="#38bdf8" stroke-width="1.5" />',
    `<text x="${PADDING_X + 24}" y="${y + 28}" font-family="JetBrains Mono, ui-monospace, monospace" `,
    `font-size="14" fill="#38bdf8">${escapeXml(indexLabel)}</text>`,
    `<text x="${PADDING_X + 64}" y="${y + 28}" font-family="Inter, system-ui, sans-serif" `,
    `font-size="14" font-weight="600" fill="#e2e8f0">Layer ${index + 1}</text>`,
    `<text x="${PADDING_X + 64}" y="${y + 50}" font-family="Inter, system-ui, sans-serif" `,
    `font-size="13" fill="#cbd5f5">${escapeXml(labelText)}</text>`,
    "</g>",
  ].join("");
}

function buildConnector(index: number): string {
  // index 表示「上一层」编号；本函数把 index 与 index+1 之间用一根带箭头
  // 的连接线串起来，形成「自顶向下」的依赖关系。
  const fromY = PADDING_TOP + index * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT;
  const toY = PADDING_TOP + (index + 1) * (NODE_HEIGHT + NODE_GAP);
  const x = SVG_WIDTH / 2;
  return [
    `<g class="sad-connector" data-from-index="${index}" data-to-index="${index + 1}">`,
    `<line x1="${x}" y1="${fromY}" x2="${x}" y2="${toY}" stroke="#38bdf8" stroke-width="1.5" `,
    'stroke-dasharray="6 4" marker-end="url(#sad-arrow)" />',
    "</g>",
  ].join("");
}

// ---------------------------------------------------------------------------
// Pure SVG builder — 任何异常都会在 `draftInternal` 中被捕获
// ---------------------------------------------------------------------------

function buildSvgString(
  notes: ReadonlyArray<string>,
  missionId: string,
): string {
  const totalHeight =
    PADDING_TOP +
    notes.length * NODE_HEIGHT +
    Math.max(0, notes.length - 1) * NODE_GAP +
    PADDING_BOTTOM;

  const layers = notes
    .map((note, index) => buildNoteLayer(index, note, missionId))
    .join("");
  const connectors = notes
    .slice(0, -1)
    .map((_, index) => buildConnector(index))
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${totalHeight}" `,
    `width="${SVG_WIDTH}" height="${totalHeight}" role="img" `,
    `aria-label="architecture draft for mission ${escapeXml(missionId)}" `,
    `data-mission-id="${escapeXml(missionId)}" data-layer-count="${notes.length}">`,
    buildDefs(),
    buildBackground(totalHeight),
    buildTitle(missionId),
    layers,
    connectors,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// SVG sanitizer — whitelist-based defense-in-depth
//
// The implementation now lives in `shared/blueprint/svg-sanitizer.ts` so the
// client `EffectPreviewImagePanel` can run the same whitelist before its
// `dangerouslySetInnerHTML` mount path (Phase 5 Task 44.1). We re-export the
// pure function and the optional logger interface so existing server-side
// imports of `sanitizeSvgArchitectureDraft` from this module keep working
// without rewrite.
// ---------------------------------------------------------------------------

import {
  sanitizeSvgArchitectureDraft,
  type SvgArchitectureSanitizerLogger,
} from "../../../../shared/blueprint/svg-sanitizer.js";

export { sanitizeSvgArchitectureDraft, type SvgArchitectureSanitizerLogger };

// ---------------------------------------------------------------------------
// Public function + factory
// ---------------------------------------------------------------------------

/**
 * 计算 SVG 草图。永不抛错：任何异常都被翻译为 `{ kind: "skipped" }`。
 *
 * 与 `SvgArchitectureDrafter.draft` 的语义一致；导出独立的纯函数版本是为
 * 了让上层 `image-service.ts` 与单元测试可以选择是否经过工厂封装。
 */
export async function draftSvgArchitecture(
  input: SvgArchitectureDrafterInput,
): Promise<SvgDraftResult> {
  try {
    if (!input || typeof input !== "object") {
      return { kind: "skipped", reason: "invalid-input" };
    }
    const { architectureNotes, missionId } = input;
    if (!Array.isArray(architectureNotes)) {
      return { kind: "skipped", reason: "invalid-architecture-notes" };
    }
    if (architectureNotes.length === 0) {
      return { kind: "skipped", reason: "no-architecture-notes" };
    }
    if (typeof missionId !== "string") {
      return { kind: "skipped", reason: "invalid-mission-id" };
    }

    // 过滤 / 折叠空字符串，确保至少有一层可渲染。
    const sanitisedNotes: string[] = [];
    for (const note of architectureNotes) {
      if (typeof note === "string" && note.trim().length > 0) {
        sanitisedNotes.push(note);
      }
    }
    if (sanitisedNotes.length === 0) {
      return { kind: "skipped", reason: "no-architecture-notes" };
    }

    const svg = buildSvgString(sanitisedNotes, missionId);
    // Defense-in-depth: even though `buildSvgString` only emits trusted
    // structural fragments, the per-note label values flow through
    // `escapeXml` and could in theory carry future LLM-derived payloads.
    // Running the final string through the regex whitelist sanitizer
    // strips `<script>`, `<foreignObject>`, on*= handlers, `javascript:`
    // URLs and external `<a>` / `<image>` href references before the
    // SVG reaches the client's `dangerouslySetInnerHTML` mount path
    // (Phase 4 task 34.1, security-hardening addendum to req 3.x).
    const sanitised = sanitizeSvgArchitectureDraft(svg);
    return { kind: "ok", svg: sanitised };
  } catch (error) {
    const reason =
      error instanceof Error && error.message.length > 0
        ? `svg-build-failed:${error.message.slice(0, 120)}`
        : "svg-build-failed";
    return { kind: "skipped", reason };
  }
}

/**
 * 工厂：返回 `SvgArchitectureDrafter` 实例，供
 * `server/routes/blueprint.ts` 在 `ctx.effectPreviewLlmService` 装配时
 * 调用（design §「Components and Interfaces · SvgArchitectureDrafter」）。
 *
 * 当前实现是无状态的，直接复用 `draftSvgArchitecture`。保留工厂形式是为
 * 了给未来潜在的「带缓存 / 预热 / 注入 logger」演进留口子，与同目录
 * `createEffectPreviewLlmService(ctx)` 的工厂风格保持一致。
 */
export function createSvgArchitectureDrafter(): SvgArchitectureDrafter {
  return {
    draft: draftSvgArchitecture,
  };
}
