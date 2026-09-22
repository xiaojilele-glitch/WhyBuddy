/**
 * 画布档"点选元素直接改"的纯函数层（2026-08-25）。
 *
 * 用户要的形态（参照 TRAE）：**留在画布上**，按住 Ctrl 鼠标滑过画板里的元素
 * 先高亮（不选中），按下才选中，右侧面板变成那个元素的编辑器。
 *
 * ## 为什么编辑要落在**源 HTML** 上，而不是改画布里那份渲染文档
 *
 * 画布里的 iframe 是 HtmlAppSurface 渲染的：注入了 Tailwind、跑过绑定运行时
 * （html-binding-runtime 会 cloneNode 往表格里克隆行）。改那份文档等于改
 * "给人看的那一版"，存回 pages_json 会把注入的脚本/样式一起存进去，而且克隆
 * 出来的行在源里根本没有对应元素。ClickEditStage 头注把这条约束写得很清楚，
 * 这里遵循同一条：**一切编辑都作用在源 HTML 上**，改完让画板按新源重渲。
 *
 * ## 与 ClickEditStage 的关系
 *
 * 两边是**同一件事的两种呈现**（用户原话）。所以"一次编辑到底改了什么"只有
 * 这一份实现（applyElementOp），UI 可以有两套，语义不许有两套。
 */

import { resolveElementPath, type PathStep } from "./element-path";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * iframe 内元素矩形 → 画板节点内坐标。
 *
 * ⚠ 只换算**画板自身的缩放**这一层。画布的平移/缩放不用管——高亮层画在
 *   React Flow 的节点里，那两层由 React Flow 的 transform 自动带走。
 *   （对照 GrapesJS getElementPos：它要 `elRect*zoom + frameOffset -
 *   canvasOffset + scroll` 四项，是因为它的 spots 容器挂在画布外面。
 *   挂进节点里就只剩一项——这是简化，不是省略。）
 *
 * ⚠ 除零要挡：文档还没量到尺寸时回 null，调用方据此**不画高亮**，
 *   而不是画一个 0×0 或 Infinity 的框。
 */
export function frameRectToNodeRect(
  elRect: Rect,
  docSize: { width: number; height: number },
  nodeSize: { width: number; height: number }
): Rect | null {
  if (!(docSize.width > 0) || !(docSize.height > 0)) return null;
  const sx = nodeSize.width / docSize.width;
  const sy = nodeSize.height / docSize.height;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  return {
    left: elRect.left * sx,
    top: elRect.top * sy,
    width: elRect.width * sx,
    height: elRect.height * sy,
  };
}

/**
 * 一次元素编辑。
 *
 * ⚠ 样式统一走 `style` 这一种 op（一次可以带多条声明），**不是**每加一个控件
 *   就加一个 op 类型。面板有十几个控件，按控件建 op 的话这个联合类型会长到
 *   没法维护，而且每加一个都要动纯函数 + 判据 + 面板三处。
 *
 * ⚠ 值为空字符串 = **清掉这条声明**（回到样式表的值）。这是"恢复默认"的唯一
 *   做法——写一个 `font-weight: 400` 去盖住原来的粗体是错的：那不是恢复默认，
 *   是又压了一层。
 */
export type ElementOp =
  | { kind: "text"; value: string }
  | { kind: "style"; decls: Record<string, string> }
  | { kind: "remove" };

export const MIN_FONT_PX = 8;
export const MAX_FONT_PX = 96;

export function clampFontPx(px: number): number {
  return Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, Math.round(px)));
}

/**
 * 把一次编辑作用到源 HTML 上。找不到元素时 `ok:false` 且**原样返回**。
 *
 * ⚠ 找不到就返回 false，调用方必须当失败处理并告诉用户。悄悄返回一份"没改动
 *   的 HTML"再去落库，就是本仓最忌的"闸全绿但东西没变"。
 *
 * ⚠ 用 DOMParser 解析，不用 innerHTML 挂进当前文档：解析出来的是**惰性文档**，
 *   里面的 script 不执行、img 不发请求。这份 HTML 是模型生成的，不能挂进主文档。
 */
export function applyElementOp(
  html: string,
  path: readonly PathStep[],
  op: ElementOp
): { html: string; ok: boolean } {
  const source = String(html || "");
  if (!source.trim() || !path.length) return { html: source, ok: false };
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, "text/html");
  } catch {
    return { html: source, ok: false };
  }
  if (!doc?.body) return { html: source, ok: false };
  const el = resolveElementPath(doc.body, path) as HTMLElement | null;
  if (!el) return { html: source, ok: false };

  switch (op.kind) {
    case "text": {
      // ⚠ 只改**文字**，不碰子元素结构：用 textContent 而不是 innerHTML。
      //   后者等于让用户往页面里塞任意标签，而这份内容会直接落库。
      el.textContent = op.value;
      break;
    }
    case "style": {
      for (const [prop, value] of Object.entries(op.decls)) {
        if (value === "") {
          el.style.removeProperty(prop);
        } else {
          /* ⚠ 用 setProperty 而不是拼字符串：CSSOM 本身会把非法值挡掉
             （`color: red; } body{...}` 这种直接设不进去），这就是这里
             不需要另写一套值校验的原因——校验交给浏览器，别自己写正则。 */
          el.style.setProperty(prop, value);
        }
      }
      break;
    }
    case "remove": {
      const parent = el.parentElement;
      if (!parent) return { html: source, ok: false };
      parent.removeChild(el);
      break;
    }
  }

  return { html: serializeDocument(doc, source), ok: true };
}

/**
 * 把改过的文档序列化回去，**保住原来的 doctype**。
 *
 * ⚠ 少了 doctype 浏览器会进 quirks mode，页面的盒模型/行高整体走样——
 *   而且是"改了一个字号、整页布局变了"这种极难归因的走样。
 */
export function serializeDocument(doc: Document, source: string): string {
  const hadDoctype = /^\s*<!doctype/i.test(source);
  const markup = doc.documentElement.outerHTML;
  return hadDoctype ? `<!DOCTYPE html>\n${markup}` : markup;
}

/** 面板上显示的元素名：语义属性优先，其次标签 + 一小段文字。 */
export function elementTitle(tag: string, text: string, attrs: string): string {
  if (attrs) return attrs;
  const t = (text || "").trim().replace(/\s+/g, " ").slice(0, 16);
  return t ? `<${tag}> ${t}` : `<${tag}>`;
}

/**
 * 面板要显示的那些 CSS 属性。
 *
 * ⚠ 选中时从画布 iframe 里**读计算样式**存一份快照，面板显示时
 *   `行内值 ?? 快照值`：
 *     · 只读行内值 → 元素没写过行内样式时面板一片"默认"，等于什么都看不到；
 *     · 只读计算值 → 刚改完的值要等画板重渲才反映，面板会"跳"一下。
 *   两者叠着用，显示的既是真实的样子，改完也立刻对得上。
 */
export const PANEL_CSS_PROPS = [
  "display",
  "flex-direction",
  "width",
  "height",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border-radius",
  "opacity",
  "background-color",
  "border-width",
  "border-style",
  "border-color",
  "box-shadow",
  "font-size",
  "font-weight",
  "color",
  "text-align",
] as const;

/** 从一个**已渲染**的元素上取快照。只读，不改任何东西。 */
export function snapshotComputed(
  el: Element,
  view: Window | null
): Record<string, string> {
  const out: Record<string, string> = {};
  const cs = view?.getComputedStyle?.(el);
  if (!cs) return out;
  for (const prop of PANEL_CSS_PROPS) {
    const v = cs.getPropertyValue(prop);
    if (v) out[prop] = v.trim();
  }
  return out;
}

/** 从源 HTML 里读这个元素**写过的行内样式**（面板据此知道哪些是用户改过的）。 */
export function readInlineStyles(
  html: string,
  path: readonly PathStep[]
): { inline: Record<string, string>; text: string } | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  } catch {
    return null;
  }
  if (!doc?.body) return null;
  const el = resolveElementPath(doc.body, path) as HTMLElement | null;
  if (!el) return null;
  const inline: Record<string, string> = {};
  for (let i = 0; i < el.style.length; i += 1) {
    const prop = el.style.item(i);
    inline[prop] = el.style.getPropertyValue(prop).trim();
  }
  return {
    inline,
    text: (el.textContent || "").replace(/\s+/g, " ").trim(),
  };
}

/** 面板显示用的值：用户写过的行内值优先，否则用选中时的计算值。 */
export function displayValue(
  prop: string,
  inline: Record<string, string>,
  computed: Record<string, string>
): string {
  return inline[prop] ?? computed[prop] ?? "";
}

/** "12px" → 12。取不到数就回 null（面板据此显示"默认"，不编一个 0 出来）。 */
export function pxNumber(value: string): number | null {
  const n = parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 计算样式里的颜色是 `rgb(a)` 形式，`<input type=color>` 只认 `#rrggbb`。
 * 转不了（transparent / 渐变）就回 null，调用方显示一个中性色，别硬塞。
 */
export function toHexColor(value: string): string | null {
  const s = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  const m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!m) return null;
  const hex = (n: string) =>
    Math.max(0, Math.min(255, Math.round(parseFloat(n))))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`;
}
