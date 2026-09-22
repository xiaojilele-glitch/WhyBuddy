/**
 * 画布档右侧的**元素设计面板**（2026-08-25）。
 *
 * 用户裁决：画布上 Ctrl+单击选中元素后，右侧直接改它，不跳页面档。
 * 第二轮又说"看着没有 TRAE 那个丰富"——所以按参考图排成三段：
 * **容器 / 文字 / 外观**，含那个内外边距九宫格。
 *
 * ## 显示的值从哪来
 *
 * `行内值 ?? 选中时的计算值`。只读行内值的话，元素没写过行内样式时面板一片
 * "默认"（第一版就是这样，用户一眼就看出来"没那个丰富"）；只读计算值的话，
 * 刚改完要等画板重渲才反映，面板会跳一下。两者叠着用才既真实又跟手。
 *
 * ## 写的是什么
 *
 * 一律写**行内样式到源 HTML**（applyElementOp 的 style op）。空值 = 清掉这条
 * 声明，回到样式表的值——不是写个"默认值"盖上去（那是又压一层，不是恢复）。
 *
 * ## 跟页面档点选编辑的关系
 *
 * 两套 UI、一套语义：可编辑判定共用 closestEditable，编辑语义共用
 * applyElementOp。这里只是把同一件事排成设计面板的样子。
 */

import React from "react";
import { Loader2, Trash2, X } from "lucide-react";

import {
  applyElementOp,
  clampFontPx,
  displayValue,
  pxNumber,
  readInlineStyles,
  toHexColor,
  MAX_FONT_PX,
  MIN_FONT_PX,
  type ElementOp,
} from "./canvas-element-edit";
import type { PathStep } from "./element-path";

export interface CanvasElementPanelProps {
  picked: {
    pageId: string;
    path: PathStep[];
    tag: string;
    title: string;
    /** 这个元素属于哪一块（`data-block`）。不在任何块里就是 null。 */
    block?: { name: string; kind: string; label: string; kindLabel: string } | null;
    computed: Record<string, string>;
  };
  /** 这一页的**源** HTML */
  html: string;
  pageName: string;
  onApply: (pageId: string, nextHtml: string) => Promise<void>;
  onClose: () => void;
}

/* ------------------------------------------------------------ 小控件 */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="border-b border-[#f0f1f3] px-3 py-2.5 last:border-b-0">
      <h4 className="mb-2 text-[11px] font-medium text-stone-700">{title}</h4>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-2">
      <span className="w-11 shrink-0 text-[11px] text-stone-500">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1">{children}</span>
    </label>
  );
}

/** 一个数值输入。**回车或失焦才提交**——每敲一个字符就落一次库是灾难。 */
function NumField({
  value,
  suffix,
  disabled,
  onCommit,
  testId,
}: {
  value: number | null;
  suffix?: string;
  disabled?: boolean;
  onCommit: (n: number | null) => void;
  testId?: string;
}): React.ReactElement {
  const [draft, setDraft] = React.useState(value === null ? "" : String(value));
  React.useEffect(() => {
    setDraft(value === null ? "" : String(value));
  }, [value]);
  const commit = () => {
    const t = draft.trim();
    if (t === "") return onCommit(null);
    const n = parseFloat(t);
    if (Number.isFinite(n)) onCommit(n);
    else setDraft(value === null ? "" : String(value));
  };
  return (
    <span className="relative flex min-w-0 flex-1 items-center">
      <input
        value={draft}
        disabled={disabled}
        data-testid={testId}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="默认"
        className="w-full rounded border border-stone-200 px-1.5 py-0.5 text-[11px] tabular-nums outline-none focus:border-[#1677ff] disabled:opacity-40"
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-1.5 text-[10px] text-stone-300">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}

const SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * 内外边距九宫格（参考图里那个）。外圈 margin、内圈 padding。
 *
 * ⚠ 四个方向分开写（padding-top 而不是 padding 简写）：写简写会把用户没动的
 *   那三边一起钉死成当前计算值，之后样式表改了也跟不动。
 */
function BoxSpacing({
  read,
  disabled,
  onSet,
}: {
  read: (prop: string) => number | null;
  disabled: boolean;
  onSet: (prop: string, n: number | null) => void;
}): React.ReactElement {
  const cell = (kind: "margin" | "padding", side: (typeof SIDES)[number]) => (
    <NumField
      key={`${kind}-${side}`}
      value={read(`${kind}-${side}`)}
      disabled={disabled}
      testId={`sliderule-canvas-el-${kind}-${side}`}
      onCommit={n => onSet(`${kind}-${side}`, n)}
    />
  );
  return (
    <div
      className="rounded border border-stone-200 p-1.5"
      data-testid="sliderule-canvas-el-spacing"
    >
      <div className="mb-1 flex items-center gap-1">
        <span className="w-8 shrink-0 text-[10px] text-stone-400">外</span>
        {cell("margin", "top")}
        {cell("margin", "bottom")}
        {cell("margin", "left")}
        {cell("margin", "right")}
      </div>
      <div className="flex items-center gap-1">
        <span className="w-8 shrink-0 text-[10px] text-stone-400">内</span>
        {cell("padding", "top")}
        {cell("padding", "bottom")}
        {cell("padding", "left")}
        {cell("padding", "right")}
      </div>
      <p className="mt-1 text-[10px] leading-3 text-stone-300">上 下 左 右</p>
    </div>
  );
}

/* ------------------------------------------------------------ 面板 */

export function CanvasElementPanel({
  picked,
  html,
  pageName,
  onApply,
  onClose,
}: CanvasElementPanelProps): React.ReactElement {
  const source = React.useMemo(
    () => readInlineStyles(html, picked.path),
    [html, picked.path]
  );
  const [text, setText] = React.useState(source?.text ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setText(source?.text ?? "");
    setError(null);
  }, [source?.text, picked.pageId, picked.path]);

  const show = React.useCallback(
    (prop: string) => displayValue(prop, source?.inline ?? {}, picked.computed),
    [source, picked.computed]
  );
  const num = React.useCallback((prop: string) => pxNumber(show(prop)), [show]);

  const run = React.useCallback(
    async (op: ElementOp) => {
      setBusy(true);
      setError(null);
      try {
        const res = applyElementOp(html, picked.path, op);
        if (!res.ok) {
          /* ⚠ 定位不到就是失败，不许把原样 HTML 拿去落库当成功。 */
          setError("在这一页里定位不到这个元素了，刷新一下重新选");
          return;
        }
        await onApply(picked.pageId, res.html);
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
      } finally {
        setBusy(false);
      }
    },
    [html, picked.path, picked.pageId, onApply]
  );

  const setStyle = React.useCallback(
    (decls: Record<string, string>) => run({ kind: "style", decls }),
    [run]
  );
  const setPx = React.useCallback(
    (prop: string, n: number | null) =>
      setStyle({ [prop]: n === null ? "" : `${n}px` }),
    [setStyle]
  );

  if (!source) {
    /* ⚠ 画布里点得到、源 HTML 里找不到 —— 多半是运行时按数据克隆出来的表格行。
       如实说清是哪一类，别只丢一句"出错了"。 */
    return (
      <aside
        className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-l border-[#e8eaed] bg-white"
        data-testid="sliderule-canvas-element-panel"
        data-page-id={picked.pageId}
        data-tag={picked.tag}
      >
        <PanelHead title={picked.title} onClose={onClose} />
        <p
          className="m-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-700"
          data-testid="sliderule-canvas-element-missing"
        >
          这个元素在页面源码里没有对应项，多半是运行时按数据生成的（表格行
          之类）。这类内容要改数据或改模板，不能直接改这一格。
        </p>
      </aside>
    );
  }

  const fontPx = num("font-size");
  const bold = /^(bold|[6-9]00)$/.test(show("font-weight"));
  const align = show("text-align");

  return (
    <aside
      className="flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-l border-[#e8eaed] bg-white"
      data-testid="sliderule-canvas-element-panel"
      data-page-id={picked.pageId}
      data-tag={picked.tag}
    >
      <PanelHead title={picked.title} onClose={onClose} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-3 pt-2 text-[11px] leading-4 text-stone-400">
          在「{pageName}」这一页
          {picked.block ? (
            /* 块身份（2026-08-27）：一页是若干块拼出来的，先告诉用户
               「你在改哪一块」，再说这一块里的哪个元素。 */
            <>
              {" · "}
              <span
                data-testid="sliderule-canvas-panel-block"
                className="rounded bg-[#eef4ff] px-1 py-px text-[#1677ff]"
              >
                {picked.block.kindLabel}·{picked.block.label}
              </span>
            </>
          ) : null}
          {" · "}&lt;{picked.tag}&gt;
        </p>

        <Section title="容器">
          <Row label="尺寸">
            <NumField
              value={num("width")}
              suffix="W"
              disabled={busy}
              testId="sliderule-canvas-el-width"
              onCommit={n => setPx("width", n)}
            />
            <NumField
              value={num("height")}
              suffix="H"
              disabled={busy}
              testId="sliderule-canvas-el-height"
              onCommit={n => setPx("height", n)}
            />
          </Row>
          <BoxSpacing read={num} disabled={busy} onSet={setPx} />
          <Row label="圆角">
            <NumField
              value={num("border-radius")}
              suffix="px"
              disabled={busy}
              testId="sliderule-canvas-el-radius"
              onCommit={n => setPx("border-radius", n)}
            />
          </Row>
          <Row label="不透明">
            <NumField
              value={(() => {
                const o = parseFloat(show("opacity"));
                return Number.isFinite(o) ? Math.round(o * 100) : null;
              })()}
              suffix="%"
              disabled={busy}
              testId="sliderule-canvas-el-opacity"
              onCommit={n =>
                setStyle({
                  opacity:
                    n === null ? "" : String(Math.min(1, Math.max(0, n / 100))),
                })
              }
            />
          </Row>
        </Section>

        <Section title="文字">
          <Row label="字号">
            <NumField
              value={fontPx}
              suffix="px"
              disabled={busy}
              testId="sliderule-canvas-el-fontsize"
              onCommit={n =>
                setStyle({
                  "font-size": n === null ? "" : `${clampFontPx(n)}px`,
                })
              }
            />
            <span className="text-[10px] text-stone-300">
              {MIN_FONT_PX}–{MAX_FONT_PX}
            </span>
          </Row>
          <Row label="样式">
            <button
              type="button"
              disabled={busy}
              data-testid="sliderule-canvas-element-bold"
              onClick={() => setStyle({ "font-weight": bold ? "" : "700" })}
              className={`h-6 flex-1 rounded border text-[12px] font-bold transition disabled:opacity-40 ${
                bold
                  ? "border-[#1677ff] bg-[#f0f6ff] text-[#1677ff]"
                  : "border-stone-200 text-stone-600 hover:border-[#1677ff]"
              }`}
            >
              B
            </button>
            <input
              type="color"
              disabled={busy}
              data-testid="sliderule-canvas-el-color"
              value={toHexColor(show("color")) ?? "#111111"}
              onChange={e => setStyle({ color: e.target.value })}
              className="h-6 w-8 shrink-0 cursor-pointer rounded border border-stone-200 bg-white p-0.5"
              aria-label="文字颜色"
            />
          </Row>
          <Row label="对齐">
            {(["left", "center", "right"] as const).map(a => (
              <button
                key={a}
                type="button"
                disabled={busy}
                data-testid={`sliderule-canvas-el-align-${a}`}
                onClick={() => setStyle({ "text-align": align === a ? "" : a })}
                className={`h-6 flex-1 rounded border text-[11px] transition disabled:opacity-40 ${
                  align === a
                    ? "border-[#1677ff] bg-[#f0f6ff] text-[#1677ff]"
                    : "border-stone-200 text-stone-600 hover:border-[#1677ff]"
                }`}
              >
                {a === "left" ? "左" : a === "center" ? "中" : "右"}
              </button>
            ))}
          </Row>
        </Section>

        <Section title="外观">
          <Row label="填充">
            <input
              type="color"
              disabled={busy}
              data-testid="sliderule-canvas-el-bg"
              value={toHexColor(show("background-color")) ?? "#ffffff"}
              onChange={e => setStyle({ "background-color": e.target.value })}
              className="h-6 w-8 shrink-0 cursor-pointer rounded border border-stone-200 bg-white p-0.5"
              aria-label="背景色"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => setStyle({ "background-color": "" })}
              className="h-6 flex-1 rounded border border-stone-200 text-[11px] text-stone-500 transition hover:border-[#1677ff] disabled:opacity-40"
            >
              清除
            </button>
          </Row>
          <Row label="边框">
            <NumField
              value={num("border-width")}
              suffix="px"
              disabled={busy}
              testId="sliderule-canvas-el-border"
              onCommit={n =>
                setStyle(
                  n === null
                    ? { "border-width": "", "border-style": "" }
                    : {
                        "border-width": `${n}px`,
                        /* ⚠ 只写宽度不写 style，边框**不会出现**（CSS 默认
                           border-style:none）。改完看不见会以为功能坏了。 */
                        "border-style": "solid",
                      }
                )
              }
            />
            <input
              type="color"
              disabled={busy}
              value={toHexColor(show("border-color")) ?? "#e5e7eb"}
              onChange={e => setStyle({ "border-color": e.target.value })}
              className="h-6 w-8 shrink-0 cursor-pointer rounded border border-stone-200 bg-white p-0.5"
              aria-label="边框颜色"
            />
          </Row>
          <Row label="阴影">
            <button
              type="button"
              disabled={busy}
              data-testid="sliderule-canvas-el-shadow"
              onClick={() =>
                setStyle({
                  "box-shadow":
                    show("box-shadow") && show("box-shadow") !== "none"
                      ? ""
                      : "0 2px 8px rgba(15,23,42,0.12)",
                })
              }
              className={`h-6 flex-1 rounded border text-[11px] transition disabled:opacity-40 ${
                show("box-shadow") && show("box-shadow") !== "none"
                  ? "border-[#1677ff] bg-[#f0f6ff] text-[#1677ff]"
                  : "border-stone-200 text-stone-600 hover:border-[#1677ff]"
              }`}
            >
              投影
            </button>
          </Row>
        </Section>

        <Section title="内容">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            data-testid="sliderule-canvas-element-text"
            className="w-full resize-y rounded border border-stone-200 px-2 py-1 text-[12px] outline-none focus:border-[#1677ff]"
          />
          <button
            type="button"
            disabled={busy || text === source.text}
            onClick={() => run({ kind: "text", value: text })}
            data-testid="sliderule-canvas-element-apply-text"
            className="flex w-full items-center justify-center gap-1 rounded bg-[#1677ff] px-2 py-1 text-[11px] text-white transition hover:bg-[#0958d9] disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            改这段文字
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm("确定删掉这个元素吗？")) {
                run({ kind: "remove" });
              }
            }}
            data-testid="sliderule-canvas-element-remove"
            className="flex w-full items-center justify-center gap-1 rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-600 transition hover:bg-rose-50 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            删掉这个元素
          </button>
        </Section>

        {error ? (
          <p
            className="m-3 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] leading-4 text-rose-600"
            data-testid="sliderule-canvas-element-error"
          >
            {error}
          </p>
        ) : null}
      </div>

      <p className="shrink-0 border-t border-[#f0f1f3] px-3 py-2 text-[10px] leading-4 text-stone-400">
        改动直接存进这一页（跟页面档的点选编辑同一条写回路径）。留空 =
        恢复默认。
      </p>
    </aside>
  );
}

function PanelHead({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-[#f0f1f3] px-3 py-2">
      <span className="truncate text-[12px] font-medium text-stone-700">
        {title}
      </span>
      <button
        type="button"
        onClick={onClose}
        className="ml-auto rounded p-0.5 text-stone-400 transition hover:bg-stone-100"
        aria-label="取消选中"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
