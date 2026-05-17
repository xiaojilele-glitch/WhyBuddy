/**
 * autopilot-spec-tree-workbench / Wave 0 Task 3
 *
 * 节点行展开后的单份文档预览块。每个 SPEC 树节点最多有 3 份文档
 * （requirements / design / tasks），本组件渲染其中一份。
 *
 * 设计目标：
 * - 只读、SSR 友好、不订阅 store。
 * - 文档不存在时显示"尚未生成"占位，不显示标题/摘要，避免误导用户。
 * - 标题 + 摘要 + status + source 四个字段一目了然，不引入折叠层级
 *   （行展开本身已经是一层折叠）。
 */

import type { FC } from "react";

import type {
  BlueprintSpecDocument,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentType,
} from "@shared/blueprint/contracts";

const TYPE_LABEL: Record<BlueprintSpecDocumentType, string> = {
  requirements: "requirements",
  design: "design",
  tasks: "tasks",
};

const TYPE_BADGE_CLASS: Record<BlueprintSpecDocumentType, string> = {
  requirements: "bg-indigo-50 text-indigo-700 border-indigo-200",
  design: "bg-violet-50 text-violet-700 border-violet-200",
  tasks: "bg-teal-50 text-teal-700 border-teal-200",
};

const STATUS_LABEL: Record<BlueprintSpecDocumentStatus, string> = {
  draft: "draft",
  reviewing: "reviewing",
  accepted: "accepted",
  rejected: "rejected",
};

const STATUS_TONE_CLASS: Record<BlueprintSpecDocumentStatus, string> = {
  draft: "text-slate-600",
  reviewing: "text-sky-700",
  accepted: "text-emerald-700",
  rejected: "text-red-700",
};

export interface SpecDocPreviewBlockProps {
  /** 该节点该类型当前的 doc；undefined 代表尚未生成。 */
  document: BlueprintSpecDocument | undefined;
  /** 当 document === undefined 时仍需渲染占位行,因此该 prop 必填。 */
  type: BlueprintSpecDocumentType;
}

export const SpecDocPreviewBlock: FC<SpecDocPreviewBlockProps> = ({
  document,
  type,
}) => {
  const typeBadge = (
    <span
      className={
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase " +
        TYPE_BADGE_CLASS[type]
      }
    >
      {TYPE_LABEL[type]}
    </span>
  );

  if (!document) {
    return (
      <div
        data-testid="spec-doc-preview-block"
        data-doc-type={type}
        data-doc-state="missing"
        className="flex items-start gap-2 rounded-md border border-dashed border-slate-200 bg-slate-50/50 px-3 py-2"
      >
        {typeBadge}
        <span className="text-[11px] font-semibold text-slate-400">
          尚未生成
        </span>
      </div>
    );
  }

  const status: BlueprintSpecDocumentStatus = document.status ?? "draft";
  const source = document.provenance.generationSource ?? "llm";
  // generationSource 可能是 "llm" / "llm_fallback" / "template"；UI 上把
  // "llm_fallback" 显示为 "fallback"，与 chip 上的 sourceTag 保持一致。
  const sourceLabel =
    source === "llm_fallback"
      ? "fallback"
      : source === "template"
        ? "template"
        : "llm";

  return (
    <div
      data-testid="spec-doc-preview-block"
      data-doc-type={type}
      data-doc-state="present"
      data-doc-status={status}
      data-doc-source={sourceLabel}
      className="rounded-md border border-slate-200 bg-white px-3 py-2"
    >
      <div className="flex items-center gap-2">
        {typeBadge}
        <span
          className={
            "text-[10px] font-bold uppercase " + STATUS_TONE_CLASS[status]
          }
        >
          {STATUS_LABEL[status]}
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          · {sourceLabel}
        </span>
        {/* 如有 review 路由,这里挂跳转链接;暂时占位 */}
      </div>
      <div className="mt-1 text-xs font-bold text-slate-800 truncate">
        {document.title}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-slate-600 line-clamp-2">
        {document.summary}
      </div>
    </div>
  );
};

export default SpecDocPreviewBlock;
