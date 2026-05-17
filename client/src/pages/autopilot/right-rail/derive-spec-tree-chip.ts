/**
 * autopilot-spec-tree-workbench / Wave 0 Task 1
 *
 * 纯函数：把某个 SPEC 树节点的 0–3 份 BlueprintSpecDocument 聚合成一个
 * 用于"行右侧 chip"展示的描述符。SpecTreeWorkbench 在每行渲染时调用本函数
 * 一次，得到 `{ label, tone, sourceTag, detail, ephemeralProgress }`，然后
 * 由 SpecTreeChip 组件按 tone 选 class、按 label 显示文字。
 *
 * 设计目标：
 * - 与 React 完全解耦，便于在 vitest node 环境下做密集 PBT。
 * - 优先看稳定数据（已落库的 BlueprintSpecDocument），ephemeral 信号只在
 *   "节点完全没有 docs" 的窗口期内提供 UI 反馈，避免与稳定 docs 互相覆盖
 *   导致 chip 抖动。
 * - source tag 用"最严重级"取代多数派：`template` > `llm_fallback` >
 *   `llm`，因为用户对降级路径远比对 LLM 命中路径敏感，错把 fallback 显
 *   示成 llm 比反向更危险。
 */

import type {
  BlueprintSpecDocument,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentType,
} from "@shared/blueprint/contracts";

/**
 * chip 的视觉色调；具体颜色由 SpecTreeChip 组件按 tone 选 className，
 * 这里只声明语义。
 */
export type ChipTone =
  | "neutral" // 完全未生成
  | "info" // 进行中 / reviewing / draft
  | "warning" // 含 fallback / template
  | "success" // 全部 accepted
  | "danger"; // 含 rejected

/**
 * 文档生成来源；与 BlueprintSpecDocument.provenance.generationSource 对齐，
 * 但 chip 上以 ChipTone 决定底色，这里只决定 tag 文字（"llm" / "fallback" /
 * "template"）。
 */
export type SpecTreeChipSourceTag = "llm" | "fallback" | "template";

export interface SpecTreeChipDetailEntry {
  status: BlueprintSpecDocumentStatus;
  source?: SpecTreeChipSourceTag;
}

export interface SpecTreeChipDescriptor {
  /** 一行文字，例如 "未生成" / "2/3 reviewing" / "3/3 accepted" / "生成中"。 */
  label: string;
  tone: ChipTone;
  /** 末尾 tag 文字，用于在 chip 末尾以小号字体显示（"· llm" 等）。 */
  sourceTag?: SpecTreeChipSourceTag;
  /**
   * 三种类型各自的状态明细；展开预览时由 SpecDocPreviewBlock 消费。
   * 缺失键代表该类型尚未生成。
   */
  detail: Partial<Record<BlueprintSpecDocumentType, SpecTreeChipDetailEntry>>;
  /**
   * 来自实时 observing 流的临时进度信号；用于在稳定 docs 还没回来的窗口
   * 内给用户一点 UI 反馈。仅当 docs 不全时才生效，docs 已全时被忽略。
   */
  ephemeralProgress?: "generating" | "fallback";
}

/**
 * 实时 observing 解析器（parse-spec-docs-observing.ts）会喂这个值给
 * deriveSpecTreeChip。"generating" 表示该节点正在生成且生成路径尚不确定；
 * "fallback" 表示该节点已经在 observing 中被标记为降级模板。
 */
export type SpecTreeEphemeralProgress = "generating" | "fallback" | undefined;

const DOCUMENT_TYPES: readonly BlueprintSpecDocumentType[] = [
  "requirements",
  "design",
  "tasks",
];

const REVIEWING_STATUSES: ReadonlySet<BlueprintSpecDocumentStatus> = new Set([
  "draft",
  "reviewing",
]);

/**
 * 把 BlueprintSpecDocument.provenance.generationSource (`"llm" |
 * "llm_fallback" | "template"` | undefined) 折算到 chip 上的 tag 文字。
 * `undefined` 与 `"llm"` 都视为 "llm"（未明确标记的旧数据按非降级处理）。
 */
function normalizeGenerationSource(
  source: BlueprintSpecDocument["provenance"]["generationSource"]
): SpecTreeChipSourceTag {
  if (source === "template") return "template";
  if (source === "llm_fallback") return "fallback";
  return "llm";
}

/**
 * "最严重级"折算：template > fallback > llm。混合时取最严重的那一个。
 */
function combineSourceTags(
  tags: ReadonlyArray<SpecTreeChipSourceTag>
): SpecTreeChipSourceTag | undefined {
  if (tags.length === 0) return undefined;
  if (tags.includes("template")) return "template";
  if (tags.includes("fallback")) return "fallback";
  return "llm";
}

/**
 * 根据 docs 与 ephemeral 信号派生 chip 描述符。
 *
 * docs 不必排序、不必去重；本函数会按 type 取每种类型最新的一份（按 docs
 * 出现顺序中后者覆盖前者，调用方一般传入按 createdAt 升序的列表即可）。
 */
export function deriveSpecTreeChip(
  docs: ReadonlyArray<BlueprintSpecDocument>,
  ephemeral: SpecTreeEphemeralProgress = undefined
): SpecTreeChipDescriptor {
  const detail: Partial<
    Record<BlueprintSpecDocumentType, SpecTreeChipDetailEntry>
  > = {};
  // 按 type 折叠到 detail 里；后者覆盖前者，调用方按 createdAt 升序传入即可。
  for (const doc of docs) {
    const status: BlueprintSpecDocumentStatus = doc.status ?? "draft";
    detail[doc.type] = {
      status,
      source: normalizeGenerationSource(doc.provenance.generationSource),
    };
  }

  const presentTypes = DOCUMENT_TYPES.filter(
    type => detail[type] !== undefined
  );
  const presentCount = presentTypes.length;

  // ── 1. 全部未生成 + 无 ephemeral 信号 ──────────────────────────────────
  if (presentCount === 0 && ephemeral === undefined) {
    return {
      label: "未生成",
      tone: "neutral",
      detail,
    };
  }

  // ── 2. ephemeral "generating" 在 docs 不全（< 3）时优先 ────────────────
  if (presentCount < DOCUMENT_TYPES.length && ephemeral === "generating") {
    return {
      label: presentCount === 0 ? "生成中" : `${presentCount}/3 生成中`,
      tone: "info",
      detail,
      ephemeralProgress: "generating",
    };
  }

  // ── 3. 任一份 rejected → danger ────────────────────────────────────────
  const hasRejected = presentTypes.some(
    type => detail[type]?.status === "rejected"
  );
  if (hasRejected) {
    const sourceTag = combineSourceTags(
      presentTypes.map(type => detail[type]!.source!).filter(Boolean)
    );
    return {
      label: `${presentCount}/3 rejected`,
      tone: "danger",
      sourceTag,
      detail,
    };
  }

  // ── 4. 三份齐全且全部 accepted → success ──────────────────────────────
  const allAccepted =
    presentCount === DOCUMENT_TYPES.length &&
    presentTypes.every(type => detail[type]?.status === "accepted");
  if (allAccepted) {
    const sourceTag = combineSourceTags(
      presentTypes.map(type => detail[type]!.source!)
    );
    return {
      label: "3/3 accepted",
      tone: "success",
      sourceTag,
      detail,
    };
  }

  // ── 5. 至少一份 draft / reviewing → info ──────────────────────────────
  const hasReviewing = presentTypes.some(type => {
    const status = detail[type]!.status;
    return REVIEWING_STATUSES.has(status);
  });
  if (hasReviewing || presentCount > 0) {
    const sourceTag = combineSourceTags(
      presentTypes.map(type => detail[type]!.source!)
    );

    // 当 sourceTag 是 fallback / template 时，tone 升级为 warning
    const tone: ChipTone =
      sourceTag === "fallback" || sourceTag === "template" ? "warning" : "info";

    // ephemeral fallback 信号也提升 tone
    const finalTone: ChipTone =
      ephemeral === "fallback" && tone === "info" ? "warning" : tone;

    return {
      label: `${presentCount}/3 reviewing`,
      tone: finalTone,
      sourceTag,
      detail,
      ephemeralProgress: ephemeral,
    };
  }

  // ── 兜底：理论不可达（ephemeral !== undefined 且 presentCount === 0
  //    会在 step 2 拦截；其余路径都被前面分支覆盖）。保留 neutral 防御。
  return {
    label: "未生成",
    tone: "neutral",
    detail,
  };
}
