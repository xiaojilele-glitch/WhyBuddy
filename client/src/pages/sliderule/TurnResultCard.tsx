/**
 * TurnResultCard —— 一轮跑完之后，对话流里留下的那张卡。
 *
 * ## 为什么要它（2026-09-14，用户第二次对照 Manus 截图）
 *
 * Manus 跑完留下的是一张卡：应用名 + 未发布 + 用时 + 缩略图 + 发布按钮，
 * 底下一行 `✓ 任务已完成 · 复制 · 重试 · 评分`。往上滚看历史，每个任务都
 * 留着那张卡。我们跑完只有一段文字——成果散在右侧预览列，**对话流里没有
 * 任何一个「东西做好了，在这儿」的锚点**。
 *
 * ## 2026-09-19 卡面改抄 Cursor 文件卡（只动脸，不动判断）
 *
 * 上午对照 Manus 把发布回卡头、完成态挪到卡外。下午用户圈这张卡要
 * Cursor 风格。计划审批 / 澄清已经是那一套：12px 圆角、`#e5e7eb` 边、
 * h-9 文件头 + 小灰图标、近黑方钮。结果卡还是 16px 圆角 + 首字色块 +
 * 胶囊发布，看起来像另一张产品卡。判断仍在 `resultCardModel`。
 *
 * ## 判断全在 turn-result-card.ts
 *
 * 这里只画。「该不该出卡 / 写什么」是纯函数（`resultCardModel`），判据直接
 * 跑它，不靠渲染测。本仓一贯做法。
 *
 * ## 诚实边界
 *
 *   · 缩略图拿不到就**整块不画**，不挂占位图、不拿别的图顶。
 *     （今天恒为空：截图服务只在生成过程里做自检，没落成会话级产物。）
 *   · 评分是纯本地反馈，点了就是点了，不假装发到了哪儿——真要收集得先有
 *     落库接口，没有之前不画一个「已提交」的假回执。
 *   · 发布通道还没接通，按钮照画但 disabled，不装成能发。
 */

import React from "react";
import { AppWindow, Check, Copy, ExternalLink, RotateCw } from "lucide-react";
import { resultCardModel } from "./turn-result-card";
import { dispatchInspectAction } from "./project-computer-view";
import type { UiTurn } from "./types";

function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[13px] leading-none ${on ? "text-amber-500" : "text-stone-300"} hover:text-amber-400`}
      aria-label="评分"
    >
      ★
    </button>
  );
}

function openPreview(turnId: string, onOpen?: () => void) {
  // 结果卡上的「打开」也要带动右侧预览——Manus 那张
  // 「查看」就是这么用的。只调 onOpen 打开交付物抽屉，
  // 右侧还停在终端，看起来像点了没反应。
  dispatchInspectAction({
    id: `result:${turnId}`,
    tool: "project_start",
  });
  onOpen?.();
}

function workedShort(worked: string | null): string | null {
  return worked ? worked.replace(/^工作了\s+/, "") : null;
}

const THUMB_IMG = "max-h-64 w-full bg-[#fafafa] object-cover object-top";

export function TurnResultCard({
  turn,
  runtimeKind,
  goalText,
  projectRevision,
  hasPages,
  thumbnailUrl,
  deliverableKind,
  hasOfficeArtifact,
  onOpen,
  onRetry,
}: {
  turn: UiTurn;
  runtimeKind?: "html-prototype" | "project" | null;
  goalText?: string | null;
  projectRevision?: string | null;
  /** 结果卡缩略图取这个工程最近一次验收的截图。 */
  hasPages?: boolean;
  thumbnailUrl?: string | null;
  deliverableKind?: string | null;
  hasOfficeArtifact?: boolean;
  onOpen?: () => void;
  onRetry?: () => void;
}) {
  // 缩略图由调用方给（整页只取一次，见 SlideRule.tsx 里 thumbnailUrl 的头注）。
  // 拿不到就是 null——验收还没跑过，卡片那一块不画。
  const model = resultCardModel(turn, {
    runtimeKind,
    goalText,
    projectRevision,
    hasPages,
    thumbnailUrl,
    deliverableKind,
    hasOfficeArtifact,
  });
  const [rating, setRating] = React.useState(0);
  const [copied, setCopied] = React.useState(false);

  if (!model) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.assistant || model.title);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 复制失败就什么都不说，不弹一个假的「已复制」。
    }
  };

  const duration = workedShort(model.worked);
  const canClickThumb = Boolean(model.canOpen && onOpen && model.thumbnailUrl);

  return (
    <div className="my-2 min-w-0" data-testid="turn-result-card">
      <section
        data-result-surface="cursor"
        className="overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white text-[#171717] shadow-[0_2px_8px_rgba(31,35,40,0.06)]"
      >
        {/* ⚠ 2026-09-19 Cursor 文件卡：h-9 头 + 小灰图标 + 近黑方钮。
            首字色块和胶囊发布是上午 Manus 那版，不像 Cursor。 */}
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[#e5e7eb] px-3">
          <AppWindow className="size-3.5 shrink-0 text-[#8b8b8b]" aria-hidden />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#333]">
            {model.title}
          </h2>
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-[#9a9a9a]">
            <span data-testid="turn-result-badge">{model.badge}</span>
            {duration ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums" data-testid="turn-result-worked">
                  {duration}
                </span>
              </>
            ) : null}
          </span>
          {model.canPublish ? (
            <button
              type="button"
              disabled
              title="发布通道尚未接通"
              data-testid="turn-result-publish"
              className="inline-flex h-7 shrink-0 items-center rounded-[8px] bg-[#171717] px-2.5 text-[12px] text-white disabled:opacity-35"
            >
              发布
            </button>
          ) : null}
        </header>

        {/* ⚠ 拿不到缩略图就整块不画，不挂占位图（见文件头注）。 */}
        {model.thumbnailUrl ? (
          canClickThumb ? (
            <button type="button" onClick={() => openPreview(turn.id, onOpen)} className="block w-full text-left" aria-label="打开预览">
              <img src={model.thumbnailUrl} alt="" className={THUMB_IMG} data-testid="turn-result-thumb" />
            </button>
          ) : (
            <img src={model.thumbnailUrl} alt="" className={THUMB_IMG} data-testid="turn-result-thumb" />
          )
        ) : null}
      </section>

      <div
        className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5"
        data-testid="turn-result-status"
      >
        <span className="inline-flex items-center gap-1 text-[12px] text-emerald-600">
          <Check className="h-3.5 w-3.5" /> 任务已完成
        </span>
        {duration ? (
          <span className="tabular-nums text-[12px] text-[#9a9a9a]">
            {duration}
          </span>
        ) : null}
        {model.canOpen && onOpen && !model.thumbnailUrl ? (
          <button
            type="button"
            onClick={() => openPreview(turn.id, onOpen)}
            data-testid="turn-result-open"
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] text-[#666] hover:bg-stone-100"
          >
            <ExternalLink className="h-3.5 w-3.5" /> 打开
          </button>
        ) : null}
        <button
          type="button"
          onClick={copy}
          data-testid="turn-result-copy"
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] text-[#666] hover:bg-stone-100"
        >
          <Copy className="h-3.5 w-3.5" /> {copied ? "已复制" : "复制"}
        </button>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            data-testid="turn-result-retry"
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] text-[#666] hover:bg-stone-100"
          >
            <RotateCw className="h-3.5 w-3.5" /> 重试
          </button>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span className="text-[12px] text-[#9a9a9a]">这个结果怎么样？</span>
          <span
            className="inline-flex gap-0.5"
            data-testid="turn-result-rating"
          >
            {[1, 2, 3, 4, 5].map(n => (
              <Star key={n} on={n <= rating} onClick={() => setRating(n)} />
            ))}
          </span>
        </span>
      </div>
    </div>
  );
}
