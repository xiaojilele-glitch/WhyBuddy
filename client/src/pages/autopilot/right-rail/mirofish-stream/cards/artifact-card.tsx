/**
 * autopilot-mirofish-card-diversity / Task 2.4 — ArtifactCard
 *
 * 独立的产物创建卡片组件，展示文件/代码/文档等产物信息。
 *
 * 视觉特征（whybuddy-rebrand-and-stage3-unblock-2026-05-28 §D refinement
 * 2026-05-29，对齐 mirofish-demo/console 的 .mock-file 模式）：
 * - 卡片底色：#FAFAFA + 1px solid #EEEEEE，0 radius
 * - 标题：Inter / Noto Sans SC，黑色，0.86rem
 * - 类型徽章：JetBrains Mono 0.7rem，#666 (gray-text)
 * - 展开按钮整体在 hover 时 file-name 变 #FF4500（mirofish hover 习惯）
 * - 进入动画：animate-mirofish-slide-in（保留）
 *
 * 类型 → 强调线色保留 4 类区分（在卡片底部 1px 实色条），但所有色调都被
 * 限制在 mirofish 调色板内（黑 / 灰 / 橙）以避免引入新的强调色。
 */

import { useState, type FC } from "react";

import { blueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";

import type { MiroFishArtifactCreatedEntry } from "../mirofish-stream-types";

/**
 * 产物类型 → 底部强调线（1px 实色条）。
 * 用同一基底色（#FAFAFA + #EEE 边框）+ 底部 1px accent 区分类型，
 * 而非整卡背景色，避免和 mirofish 的克制配色冲突。
 */
const ARTIFACT_BAR_BOTTOM: Record<string, string> = {
  code: "bg-[#FF4500]",
  document: "bg-black",
  image: "bg-[#999]",
  data: "bg-[#666]",
};

/** 产物类型 → 文件图标映射 */
const ARTIFACT_ICON: Record<string, string> = {
  code: "📄",
  document: "📝",
  image: "🖼",
  data: "📊",
};

export interface ArtifactCardProps {
  entry: MiroFishArtifactCreatedEntry;
  locale?: AppLocale;
  /** 预览摘要文本（可选） */
  previewSummary?: string;
}

/**
 * ArtifactCard — 产物创建卡片
 *
 * 横向布局展示文件图标、文件名和类型标签，
 * 根据产物类型使用差异化背景色调。支持点击展开预览摘要。
 */
export const ArtifactCard: FC<ArtifactCardProps> = ({
  entry,
  locale = "zh-CN",
  previewSummary,
}) => {
  const [expanded, setExpanded] = useState(false);

  const artType = entry.artifactType.toLowerCase();
  const barClass = ARTIFACT_BAR_BOTTOM[artType] ?? "bg-[#E5E5E5]";
  const icon = ARTIFACT_ICON[artType] ?? "📦";
  const titleText = blueprintCopy(entry.title, locale);

  return (
    <div
      data-testid="mirofish-card-artifact"
      data-tone={entry.tone}
      data-artifact-id={entry.artifactId}
      data-artifact-type={entry.artifactType}
      className="animate-mirofish-slide-in relative bg-[#FAFAFA] border border-[#EEEEEE]"
      style={{ borderRadius: "0px" }}
    >
      {/* 主行：图标 + 文件名 + 类型徽章 — 复刻 mirofish .mock-file 行 */}
      <button
        type="button"
        className="group flex items-center gap-3 px-4 py-3 w-full text-left"
        onClick={() => previewSummary && setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {/* 文件图标 */}
        <span
          className="flex-shrink-0 text-base text-[#666]"
          aria-hidden="true"
        >
          {icon}
        </span>

        {/* 文件名 — Inter / Noto Sans SC，hover → #FF4500（mirofish .file-name） */}
        <span className="text-[13.6px] font-normal text-black truncate flex-1 transition-colors group-hover:text-[#FF4500]">
          {titleText}
        </span>

        {/* 类型徽章 — JetBrains Mono 0.7rem，#666 */}
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#666] flex-shrink-0">
          {`artifact · ${entry.artifactType}`}
        </span>

        {/* 展开图标按钮（28×28，1px solid #DDD，hover → 黑） */}
        {previewSummary ? (
          <span
            className="flex-shrink-0 w-7 h-7 inline-flex items-center justify-center border border-[#DDD] text-[#666] transition-colors group-hover:border-black group-hover:text-black"
            aria-hidden="true"
          >
            {expanded ? "−" : "+"}
          </span>
        ) : null}
      </button>

      {/* 展开预览摘要 — JetBrains Mono 11px #666 */}
      {expanded && previewSummary && (
        <div className="px-4 pb-3 pt-2 font-mono text-[11px] text-[#666] leading-[1.6] border-t border-[#EEEEEE] break-all">
          {previewSummary}
        </div>
      )}

      {/* 底部 1px accent 条 — 区分 code / document / image / data 类型 */}
      <div className={`h-[1px] w-full ${barClass}`} aria-hidden="true" />
    </div>
  );
};

export default ArtifactCard;
