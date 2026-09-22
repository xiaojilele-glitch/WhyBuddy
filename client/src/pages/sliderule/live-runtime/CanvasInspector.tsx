/**
 * 画布右侧属性面板：选中的那块画板**到底是什么**。
 *
 * ## 它跟参考图里那个面板不是同一种东西，这是有意的
 *
 * 用户给的参考图（TRAE Design）右侧面板是**元素级样式编辑器**：容器类型、
 * 宽高、内外边距、圆角、填充。那套在这个产品里已经有了，叫**点选编辑**
 * （ClickEditStage）——它能真的改一个元素并存回 pages_json。
 *
 * 在画布上再摆一套一模一样的，会踩本仓第四条纪律最经典的形状：同一件事两套
 * 实现，改一处忘一处。而且画布是"看全套"的视角，选中的单位是**画板**不是元素，
 * 强行给画板配元素属性只能配出一堆改不动的假输入框。
 *
 * 所以这里是**画板级检视器**：把这一页背后的事实汇到一处——它绑了哪些实体
 * 字段、要哪些权限、连到哪几页、引了几张图（几张还是占位图）、多重。
 * 全部来自已有产物，一行都不推断（`boardFacts` 是纯函数，判据咬得住）。
 * 要改元素，面板底部一颗按钮把这一页送进点选编辑，不在这儿重造。
 *
 * ⚠ 面板上每一行都会被用户当成事实。哪天想在这儿加一个"复杂度评分"之类算出来
 *   的数，先读一遍本仓第五条纪律。
 */

import React from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  ImageOff,
  Images,
  KeyRound,
  LayoutGrid,
  MousePointerClick,
  RefreshCw,
  X,
} from "lucide-react";

import type { BoardFacts, BoardLink, CanvasAsset } from "./canvas-board-graph";

export interface CanvasInspectorProps {
  facts: BoardFacts | null;
  /** pageId → 人话名（连线那一段要显示对方页名） */
  nameOf: (pageId: string) => string;
  onClose: () => void;
  onJumpToPage: (pageId: string) => void;
  onOpenInPageView: (pageId: string) => void;
  onRegenerate: (pageId: string) => void;
  onRemoveLink: (linkId: string) => void;
  /** 把这条连线落回一句话（页面作用域精修） */
  onApplyLink: (link: BoardLink) => void;
  onFocusAsset: (asset: CanvasAsset) => void;
}

function Row({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="border-t border-[#f0f1f3] px-3 py-3 first:border-t-0">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-[0.02em] text-stone-400">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

const STATUS_TEXT: Record<
  BoardFacts["status"],
  { label: string; cls: string }
> = {
  bound: { label: "已接数据", cls: "bg-[#f0f9f0] text-[#2f7a34]" },
  unbound: { label: "尚未接数据", cls: "bg-[#f4f4f5] text-stone-500" },
  missing: { label: "未通过校验", cls: "bg-[#FDF6F1] text-[#C05621]" },
};

export function CanvasInspector({
  facts,
  nameOf,
  onClose,
  onJumpToPage,
  onOpenInPageView,
  onRegenerate,
  onRemoveLink,
  onApplyLink,
  onFocusAsset,
}: CanvasInspectorProps): React.ReactElement {
  return (
    <aside
      className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-l border-[#e8eaed] bg-white"
      data-testid="sliderule-canvas-inspector"
      data-page-id={facts?.pageId ?? undefined}
    >
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[#f0f1f3] px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em] text-stone-800">
          {facts ? facts.name : "画板属性"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭属性面板"
          title="关闭属性面板"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-stone-400 transition hover:bg-[#f4f4f5] hover:text-stone-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!facts ? (
        /* 空态如实说要干什么，不摆一堆灰掉的假输入框。 */
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-stone-400"
          data-testid="sliderule-canvas-inspector-empty"
        >
          <MousePointerClick className="h-4 w-4" />
          <span className="text-[11px] leading-5">
            点一块画板，这里显示它绑了哪些数据、要什么权限、连到哪几页
          </span>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
          <Row icon={<Boxes className="h-3 w-3" />} title="页面">
            <dl className="space-y-1 text-[11px] leading-4">
              <div className="flex gap-2">
                <dt className="w-12 shrink-0 text-stone-400">标识</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-stone-600">
                  {facts.pageId}
                </dd>
              </div>
              {facts.kind ? (
                <div className="flex gap-2">
                  <dt className="w-12 shrink-0 text-stone-400">范式</dt>
                  <dd className="min-w-0 flex-1 font-mono text-stone-600">
                    {facts.kind}
                  </dd>
                </div>
              ) : null}
              <div className="flex gap-2">
                <dt className="w-12 shrink-0 text-stone-400">画布</dt>
                <dd className="min-w-0 flex-1 font-mono tabular-nums text-stone-600">
                  {facts.viewport.w}×{facts.viewport.h}
                  <span className="ml-1 text-stone-400">
                    {facts.device === "phone"
                      ? "竖屏"
                      : facts.device === "tablet"
                        ? "平板"
                        : "桌面"}
                  </span>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-12 shrink-0 text-stone-400">体积</dt>
                <dd className="min-w-0 flex-1 font-mono tabular-nums text-stone-600">
                  {(facts.htmlBytes / 1024).toFixed(1)} KB
                </dd>
              </div>
              <div className="flex gap-2 pt-0.5">
                <dt className="w-12 shrink-0 text-stone-400">状态</dt>
                <dd className="min-w-0 flex-1">
                  <span
                    className={`rounded px-1.5 py-px text-[10px] font-medium ${STATUS_TEXT[facts.status].cls}`}
                    data-testid="sliderule-canvas-inspector-status"
                  >
                    {STATUS_TEXT[facts.status].label}
                  </span>
                </dd>
              </div>
            </dl>
          </Row>

          {/*
            这一页是由哪几块拼起来的（2026-08-27）。用户原话：「我们在双击其中
            一个页面，进入他的模式，所有这种零散元素现在拼成了我们的一个页面」
            ——那就先把「哪几块」如实列出来。名字和类型都是后端划的
            （services/page_blocks.py），这里一行都不推断。
          */}
          <Row
            icon={<LayoutGrid className="h-3 w-3" />}
            title={`拼成这一页的块 ${facts.blocks.length}`}
          >
            {facts.blocks.length === 0 ? (
              <p className="text-[11px] leading-4 text-stone-400">
                这一页还没打块标（这一轮之前跑的应用没有）
              </p>
            ) : (
              <ul className="space-y-1" data-testid="sliderule-canvas-inspector-blocks">
                {facts.blocks.map(b => (
                  <li key={b.name} className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded bg-[#eef4ff] px-1.5 py-px text-[10px] text-[#1677ff]">
                      {b.kindLabel}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-stone-600">
                      {b.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Row>

          <Row
            icon={<Boxes className="h-3 w-3" />}
            title={`数据绑定 ${facts.bindings.length}`}
          >
            {facts.bindings.length === 0 ? (
              <p className="text-[11px] leading-4 text-stone-400">
                模型没给这一页声明字段绑定
              </p>
            ) : (
              <ul className="space-y-1.5">
                {facts.bindings.map(b => (
                  <li key={b.entity}>
                    <div className="text-[11px] font-medium text-stone-600">
                      {b.entityName}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {b.fields.map(f => (
                        <span
                          key={f}
                          className="rounded bg-[#f4f6f8] px-1.5 py-px font-mono text-[10px] text-stone-500"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Row>

          <Row
            icon={<KeyRound className="h-3 w-3" />}
            title={`权限 ${facts.actions.length}`}
          >
            {facts.actions.length === 0 ? (
              <p className="text-[11px] leading-4 text-stone-400">
                未声明动作权限
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {facts.actions.map(a => (
                  <span
                    key={a}
                    className="rounded bg-[#f4f6f8] px-1.5 py-px font-mono text-[10px] text-stone-500"
                  >
                    {a}
                  </span>
                ))}
              </div>
            )}
          </Row>

          <Row
            icon={<ArrowUpRight className="h-3 w-3" />}
            title={`连线 ${facts.linksOut.length + facts.linksIn.length}`}
          >
            {facts.linksOut.length + facts.linksIn.length === 0 ? (
              <p className="text-[11px] leading-4 text-stone-400">
                还没有连线。从画板边缘的圆点拖到另一块画板即可连上。
              </p>
            ) : (
              <ul
                className="space-y-1"
                data-testid="sliderule-canvas-inspector-links"
              >
                {[
                  ...facts.linksOut.map(l => ({ l, out: true })),
                  ...facts.linksIn.map(l => ({ l, out: false })),
                ].map(({ l, out }) => (
                  <li key={l.id} className="flex items-center gap-1">
                    {out ? (
                      <ArrowUpRight className="h-3 w-3 shrink-0 text-stone-400" />
                    ) : (
                      <ArrowDownLeft className="h-3 w-3 shrink-0 text-stone-400" />
                    )}
                    <button
                      type="button"
                      onClick={() => onJumpToPage(out ? l.to : l.from)}
                      className="min-w-0 flex-1 truncate text-left text-[11px] text-stone-600 transition hover:text-[#1677ff]"
                      title="跳到这块画板"
                    >
                      {nameOf(out ? l.to : l.from)}
                      <span className="ml-1 text-stone-400">{l.label}</span>
                    </button>
                    {l.kind === "manual" ? (
                      <>
                        {/* 手画的线不许只是装饰：一键落回一句话去改页面。 */}
                        <button
                          type="button"
                          onClick={() => onApplyLink(l)}
                          className="shrink-0 rounded px-1 text-[10px] text-[#1677ff] transition hover:bg-[#f0f6ff]"
                          title="把这条跳转写成一句话，交给推演去改页面"
                          data-testid="sliderule-canvas-link-apply"
                        >
                          写进页面
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveLink(l.id)}
                          aria-label="删除这条连线"
                          title="删除这条连线"
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-stone-300 transition hover:bg-[#fdf2f2] hover:text-[#c0392b]"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </>
                    ) : (
                      <span
                        className="shrink-0 rounded bg-[#f4f4f5] px-1 py-px text-[9px] text-stone-400"
                        title="从五系统模型派生：写这个实体的页 → 读它的页"
                      >
                        派生
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Row>

          <Row
            icon={<Images className="h-3 w-3" />}
            title={`素材 ${facts.assets.length}`}
          >
            {facts.assets.length === 0 ? (
              <p className="text-[11px] leading-4 text-stone-400">
                这一页没有引用图片
              </p>
            ) : (
              <>
                {facts.placeholderAssets > 0 ? (
                  /* 占位图是**如实告警**，不是装饰徽章：交付前这些图得换掉。 */
                  <div
                    className="mb-1.5 flex items-center gap-1 rounded bg-[#FDF6F1] px-1.5 py-1 text-[10px] text-[#C05621]"
                    data-testid="sliderule-canvas-inspector-placeholder-warn"
                  >
                    <ImageOff className="h-3 w-3 shrink-0" />
                    {facts.placeholderAssets} / {facts.assets.length}{" "}
                    张还是占位图
                  </div>
                ) : null}
                <ul className="space-y-1">
                  {facts.assets.slice(0, 8).map(a => (
                    <li key={a.url}>
                      <button
                        type="button"
                        onClick={() => onFocusAsset(a)}
                        className="w-full truncate text-left font-mono text-[10px] text-stone-500 transition hover:text-[#1677ff]"
                        title={a.url}
                      >
                        {a.placeholder ? "○ " : "● "}
                        {a.label}
                      </button>
                    </li>
                  ))}
                  {facts.assets.length > 8 ? (
                    <li className="text-[10px] text-stone-400">
                      还有 {facts.assets.length - 8} 张，见画布下方
                    </li>
                  ) : null}
                </ul>
              </>
            )}
          </Row>
        </div>
      )}

      {facts ? (
        <div className="shrink-0 space-y-1.5 border-t border-[#f0f1f3] p-3">
          <button
            type="button"
            onClick={() => onOpenInPageView(facts.pageId)}
            data-testid="sliderule-canvas-inspector-open-page"
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[#e8eaed] bg-white text-[12px] font-medium text-stone-700 transition hover:bg-[#f7f8fa]"
            title="去页面档：那里有点选编辑（改元素）与透视"
          >
            <MousePointerClick className="h-3 w-3" />
            在页面档打开（可点选编辑）
          </button>
          <button
            type="button"
            onClick={() => onRegenerate(facts.pageId)}
            data-testid="sliderule-canvas-inspector-regenerate"
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[#e8eaed] bg-white text-[12px] font-medium text-stone-700 transition hover:bg-[#f7f8fa]"
            title="把这一页的重画指令填进输入框（只重画这一页，其余照搬）"
          >
            <RefreshCw className="h-3 w-3" />
            重新生成这一页…
          </button>
        </div>
      ) : null}
    </aside>
  );
}
