/**
 * autopilot-mirofish-card-diversity / Task 2.1 — ReasoningCard
 *
 * 独立的推理卡片组件，展示 Agent 思考/执行/观察过程。
 *
 * 视觉特征（whybuddy-rebrand-and-stage3-unblock-2026-05-28 §D refinement
 * 2026-05-29，对齐 mirofish-demo/console 真实视觉语言）：
 * - 卡片：白色背景 + 1px solid #E5E5E5 边框 + 0 radius + 无阴影
 * - 左侧 2px 实色条：thinking → #FF4500，observing → #666666，acting → #000000
 * - 标签行：JetBrains Mono 0.7rem (~11px)，#999 (gray-text)，右侧补 HH:MM:SS 时间
 * - 推理文本：JetBrains Mono，#000，line-height 1.55
 * - 进入动画：animate-mirofish-fade-in（保留）
 *
 * 信息密度增强（whybuddy-3d-real-role-driven-scene-2026-05-29 reasoning-detail
 * 2026-05-31）：
 * - 旧实现对每条 entry 只 fallback-pick-one 字段（thought / action / observation
 *   / reason / error 取其一），导致一条同时带 think→act→observe 的 entry 在卡片上
 *   只显示一行，推理流看着很稀薄。
 * - 现在改为「每个存在的字段各自成行」：thought（主黑字）、`→ actionToolId`（灰）、
 *   `✓/✗ observationSummary`（成功黑 / 失败红）、reason（浅灰次要）、error（红）同屏
 *   可见，让单条 entry 的完整 ReAct 细节直接展开，而不是被压成一行。
 * - 关键约束：mark 与摘要文本必须同处一个文本节点（不要用独立 element 包裹 `✓` /
 *   `→`），否则 SSR 字符串里会被 `</span>` 截断，破坏既有 `toContain("✓ ...")` /
 *   `toContain("→ ...")` 断言。
 *
 * 流式增强（autopilot-streaming-lifecycle-weave / Task 4.1）：
 * - 可选 `streamingTokens` prop 接收来自 useStreamingWeave 的实时 token
 * - 使用 useRef 避免每次 token 到达触发整个卡片列表 re-render
 * - 实际接线在 Wave 3 task 5.1 的 AutopilotRightRail 中完成
 *
 * ReAct 循环内联展示（autopilot-llm-react-loop-inline / Task 5.1）：
 * - 当需要更细粒度的阶段差异化展示时，可使用
 *   `ReActLoopIterator`（来自 `../react-loop/ReActLoopIterator`）
 *   作为替代详情视图，它将 reasoning entries 按 ReAct 循环分组，
 *   并为每个阶段（thinking / tool-selecting / executing / observing / next-step）
 *   提供独立的彩色竖条和流式文本展示。
 * - 本组件（ReasoningCard）仍作为卡片流中的紧凑摘要视图使用，
 *   ReActLoopIterator 适用于展开详情或独立面板场景。
 */

import { type FC, useEffect, useRef } from "react";

import { blueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";

import type { MiroFishReasoningEntry } from "../mirofish-stream-types";
import { formatTimestampHHMMSS } from "./card-shell";

/**
 * 左侧 2px 实色条配色 — 替换原渐变方案。
 * 对齐 mirofish-demo/console：单一 accent (#FF4500) + 中性灰 + 黑色，
 * 不做多色渐变，保留 phase 区分度但让整体更克制。
 */
const REASONING_BAR: Record<string, string> = {
  thinking: "bg-[#FF4500]",
  observing: "bg-[#666666]",
  acting: "bg-black",
};

export interface ReasoningCardProps {
  entry: MiroFishReasoningEntry;
  locale?: AppLocale;
  /** 是否处于流式输出状态，展示闪烁光标 */
  streaming?: boolean;
  /**
   * 来自 useStreamingWeave 的实时流式 token（可选）。
   *
   * 当提供时，token 内容会追加到卡片文本末尾，使用 useRef 避免
   * 每次 token 到达触发整个卡片列表 re-render。
   *
   * 实际接线在 Wave 3 task 5.1 的 AutopilotRightRail 中完成。
   *
   * @see useStreamingWeave
   */
  streamingTokens?: string;
}

/**
 * ReasoningCard — 推理过程卡片
 *
 * 通过左侧实色竖条区分 thinking / observing / acting 三种推理阶段，
 * 使用等宽字体保持信息密度。一条 entry 上同时存在的 thought / action /
 * observation / reason / error 字段各自成行展开，流式状态下展示闪烁光标。
 *
 * 流式增强：当 `streamingTokens` 提供时，使用 useRef 将 token 追加到
 * DOM 节点，避免每次 token 到达触发整个卡片列表 re-render。
 */
export const ReasoningCard: FC<ReasoningCardProps> = ({
  entry,
  locale = "zh-CN",
  streaming = false,
  streamingTokens,
}) => {
  const bar = REASONING_BAR[entry.phase] ?? REASONING_BAR.thinking;

  // 流式 token 追加 ref — 避免每次 token 触发整个列表 re-render
  const streamingRef = useRef<HTMLSpanElement>(null);

  // 当 streamingTokens 变化时，直接操作 DOM 追加文本
  useEffect(() => {
    if (streamingTokens && streamingRef.current) {
      streamingRef.current.textContent = streamingTokens;
    }
  }, [streamingTokens]);

  // 观察行：剥掉服务端 emitter（spec-docs-llm-generation.ts）已经塞在
  // observationSummary 头部的 "✓ " / "⚠ " 前缀，避免与本组件追加的 mark
  // 叠加成 "✓ ✓ ..." / "⚠ ✗ ..."。
  const observationMark = entry.observationSuccess === false ? "✗" : "✓";
  const observationText = entry.observationSummary
    ? blueprintCopy(entry.observationSummary, locale).replace(/^[✓✗⚠]\s+/u, "")
    : "";

  const showCursor = streaming || Boolean(streamingTokens);
  const hasContent =
    Boolean(
      entry.thought ||
        entry.actionToolId ||
        entry.observationSummary ||
        entry.reason ||
        entry.error
    ) || streamingTokens !== undefined;

  return (
    <div
      data-testid="mirofish-card-reasoning"
      data-tone={entry.tone}
      data-phase={entry.phase}
      data-iteration={entry.iterationLabel}
      className="animate-mirofish-fade-in relative pl-3 pr-3 py-2 bg-white border border-[#E5E5E5]"
      style={{ borderRadius: "0px" }}
    >
      {/* 左侧 2px 实色条 — mirofish 单色 accent */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[2px] ${bar}`}
        aria-hidden="true"
      />

      {/* 标签行 — 左 phase · iteration，右 HH:MM:SS；
          注意 phase · iteration 必须同处一个 span，保持 "thinking · #1" 连续。 */}
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#999]">
          {entry.phase} · {entry.iterationLabel}
        </span>
        <span className="font-mono text-[10px] text-[#BBB] tabular-nums">
          {formatTimestampHHMMSS(entry.timestamp)}
        </span>
      </div>

      {/* 多字段详情 — 每个存在的字段各自成行，不再 fallback-pick-one。 */}
      {hasContent && (
        <div className="flex flex-col gap-1">
          {entry.thought && (
            <div className="font-mono text-[12.5px] text-black leading-[1.55] break-all">
              {blueprintCopy(entry.thought, locale)}
            </div>
          )}

          {entry.actionToolId && (
            <div className="font-mono text-[12px] text-[#555] leading-[1.5] break-all">
              → {entry.actionToolId}
            </div>
          )}

          {entry.observationSummary && (
            <div
              className={`font-mono text-[12px] leading-[1.5] break-all ${
                entry.observationSuccess === false
                  ? "text-[#C0392B]"
                  : "text-black"
              }`}
            >
              {observationMark} {observationText}
            </div>
          )}

          {entry.reason && (
            <div className="font-mono text-[11px] text-[#999] leading-[1.5] break-all">
              {blueprintCopy(entry.reason, locale)}
            </div>
          )}

          {entry.error && (
            <div className="font-mono text-[12px] text-[#C0392B] leading-[1.5] break-all">
              {blueprintCopy(entry.error, locale)}
            </div>
          )}

          {/* 流式 token 追加区域 + 闪烁光标 */}
          {(streamingTokens !== undefined || showCursor) && (
            <div className="font-mono text-[12.5px] text-black leading-[1.55] break-all">
              {streamingTokens !== undefined && (
                <span ref={streamingRef} aria-live="polite" />
              )}
              {showCursor && (
                <span
                  className="animate-mirofish-blink inline-block w-[2px] h-3 bg-[#FF4500] ml-0.5 align-middle"
                  aria-hidden="true"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReasoningCard;
