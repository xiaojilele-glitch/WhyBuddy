/**
 * 宿主安全层：把打好孔的 HTML 消毒后挂进 Shadow DOM，再交给解释器填数。
 *
 * ## 这一层解决什么
 *
 * 新链路产出的是**一整份 HTML 文档**（第 3 步生成、6.5 步打孔），不是受控的
 * React 节点树。直接 `dangerouslySetInnerHTML` 进主文档有两个独立的问题，
 * 各由一样东西治：
 *
 *     可执行内容（script / on* / javascript: / 外链）  → **DOMPurify**
 *     样式外溢（生成的 CSS 污染整个产品界面）          → **Shadow DOM**
 *
 * ⚠ 两件事别混：Shadow DOM **不是**安全边界（脚本在影子里照样能拿到
 * document），它治的是"样式互相干扰"。真正挡执行面的是 DOMPurify。
 * 这条在 08-12 那份 OverviewHtmlSurface 的注释里写过，这里照抄结论。
 *
 * ## 白名单从解释器 import，不手抄
 *
 * 消毒走 `ALLOW_DATA_ATTR: false` + 显式白名单——**没列进去的 data-* 会被
 * 静默删掉**，而删掉之后页面照常渲染、消毒器照常报成功、解释器 problems
 * 也是空的（没有孔就没有错误的孔）。那个能力整条无声消失。
 *
 * 所以 `BINDING_ATTRS` 只有一份，在 html-binding-runtime.ts 里，这边 import。
 * 本仓在"同一份清单抄两遍"上栽过两次（区块 uses 声明与实际渲染不符 316 条、
 * 前端手抄的区域词汇与目录漂移）。
 *
 * ## 为什么不用 ALLOWED_URI_REGEXP —— 这条是踩出来的
 *
 * 放开 src/href 之后第一版给 `ALLOWED_URI_REGEXP` 塞了个严格正则，**当场砸了
 * 自己的占位契约**：DOMPurify 把这个正则用在**所有不在它内部 URI-safe 清单里
 * 的属性**上，于是 `data-field` / `viewBox` / `d="M0 0h24"` 全被判成非法 URI
 * 删掉——页面一个数字都填不上、图标全成空壳，而消毒"看着还在工作"。
 *
 * 它的默认 URI 策略实测是对的（拦 javascript:、放行 https 图片与 data:image/、
 * 不碰 data-* 与 SVG 几何属性）。唯一漏的是 `data:text/html` 落在 `<img src>`
 * 上——图片标签加载不了 HTML，那不是执行面。真正该堵的是**链接**上的 data:
 * （点下去等于导航到一份自带内容的文档）。所以留默认策略，只用钩子精确摘那一处。
 */

import React from "react";
import DOMPurify from "dompurify";
import { BLOCK_ATTRS } from "./page-blocks";

import {
  applyBindings,
  hasAnyDataSource,
  BINDING_ATTRS,
  type ApplyBindingsReport,
  type BindingActionEvent,
  type BindingSource,
} from "./html-binding-runtime";

export const BOUND_HTML_SURFACE_VERSION = "bound-html-surface-v1";

const ALLOWED_TAGS = [
  "div", "span", "p", "section", "article", "header", "footer", "main", "aside",
  "nav", "h1", "h2", "h3", "h4", "h5", "h6", "form", "label", "fieldset", "legend",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "strong", "em", "b", "i", "u", "s", "small", "mark", "code", "pre", "blockquote",
  "hr", "br", "wbr", "style",
  "img", "picture", "source", "figure", "figcaption", "a", "link",
  "details", "summary", "time", "abbr", "kbd", "samp", "var", "sub", "sup",
  // 表单控件：第 3 步的页面里到处是输入框/下拉/按钮。**不放开等于整页只剩文字**
  // ——而"能读能写"正是这条链路存在的理由。它们不是执行面（on* 由 DOMPurify 摘）。
  "input", "select", "option", "optgroup", "textarea", "button", "progress", "meter",
  // 内联 SVG
  "svg", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "g",
  "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask",
  "text", "tspan", "use", "symbol", "title", "desc", "pattern", "filter",
  "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix",
];

export const ALLOWED_ATTR = [
  "class", "style", "id", "title", "colspan", "rowspan", "scope", "lang", "dir",
  "role", "tabindex", "datetime", "open",
  "aria-label", "aria-hidden", "aria-describedby", "aria-current", "aria-expanded",
  // 表单控件的形状。⚠ 不放行 name/value/placeholder 的话，输入框全成空盒子
  "type", "name", "value", "placeholder", "checked", "selected", "disabled",
  "readonly", "required", "min", "max", "step", "rows", "cols", "for", "maxlength",
  // 图片与外部资源
  "src", "srcset", "sizes", "alt", "loading", "decoding", "referrerpolicy",
  "href", "target", "rel", "media", "crossorigin",
  // 内联 svg 的形状与外观
  "viewBox", "preserveAspectRatio", "xmlns", "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "stroke-opacity",
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
  "width", "height", "points", "opacity", "transform", "offset", "stop-color",
  "stop-opacity", "gradientUnits", "gradientTransform", "clip-path", "mask",
  "text-anchor", "dominant-baseline", "font-size", "font-weight", "font-family",
  "dx", "dy", "patternUnits",
  // 导航切页的锚点（page_shell 打的）。⚠ 漏了它左侧菜单就点不动，而且不会有
  // 任何一处报错——菜单还在，只是点了没反应。
  //
  // ⚠ 2026-08-28 补：这个词在 html-app-surface 那份里一直有，**这份一直漏着**。
  //   今天没炸只是因为这个模块**当前零引用**（真正在跑的是 html-app-surface，
  //   见文件头）。谁哪天把它接上去，菜单会被 DOMPurify 静默剥掉——ALLOW_DATA_ATTR
  //   是 false，没列进来的 data-* 一律删，不报错。
  //   两份白名单必须同改这条现在有判据钉着（dompurify-allowlists-agree）。
  "data-page-id",
  // 壳节点自报家门（page_shell.mark_shell_parts 打的）。⚠ 两份白名单必须同改。
  "data-shell",
  // 深浅锁。对比层认 html[data-theme]。⚠ 两份白名单必须同改。
  "data-theme",
  // 块身份（page_blocks.mark_page_blocks 打的）。画布靠它认出「这一页是
  // 哪几块拼的」、以及「双击进去改的是哪一块」。⚠ 两份白名单必须同改；
  // 漏了不会报错——块标被静默剥掉，画布一块都认不出，HTML 看着还正常。
  ...BLOCK_ATTRS,
  // 绑定词汇 —— **从解释器 import，不手抄**（见文件头）
  ...BINDING_ATTRS,
];

//: 只剩可执行内容与能改变文档基址的东西。宿主安全，不是审美。
const FORBID_TAGS = ["script", "iframe", "object", "embed", "base", "meta", "template"];

type PurifyLike = {
  sanitize?: (s: string, c: object) => string;
  addHook?: (name: string, cb: (node: Element) => void) => void;
};

let hooksInstalled = false;

function installSanitizeHooks(p: PurifyLike): void {
  if (hooksInstalled || typeof p.addHook !== "function") return;
  p.addHook("afterSanitizeAttributes", (node) => {
    const href = node.getAttribute?.("href");
    if (href && /^\s*data:/i.test(href)) node.removeAttribute("href");
  });
  hooksInstalled = true;
}

/**
 * 消毒。**没有 DOM 就返回空串** —— 消毒不了就不渲染。
 *
 * DOMPurify 在没有 window 的环境里导出的是工厂函数而不是实例，`.sanitize`
 * 压根不存在。那种情况下"原样返回"等于把不可信 HTML 直接放行，所以
 * fail-closed：宁可这一块空着，也不能漏一次。
 */
export function sanitizeBoundHtml(markup: string): string {
  const purify = DOMPurify as unknown as PurifyLike;
  if (typeof purify.sanitize !== "function") return "";
  installSanitizeHooks(purify);
  return purify.sanitize(markup || "", {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    // ⚠ 显式白名单模式。改成 true 会放行任意 data-*（生成侧写什么都进来），
    //   改成 false 而漏列词汇则是那个能力静默消失。两个方向都危险，
    //   所以 BINDING_ATTRS 必须是单一来源。
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });
}

/** 影子根地基样式：字体从宿主继承，否则影子里会掉回浏览器默认字体。 */
const SHADOW_BASE_CSS = `:host{display:block;font:inherit;color:inherit}
*{box-sizing:border-box}`;

export interface BoundHtmlSurfaceProps {
  html: string;
  source: BindingSource;
  onAction?: (event: BindingActionEvent) => void;
  /** 消毒 + 填数之后回调一次，把报告交出去（谁挂谁负责看，不在这里吞） */
  onReport?: (report: ApplyBindingsReport & { hasDataSource: boolean }) => void;
  className?: string;
}

/**
 * 挂载：Shadow DOM 隔离 → 消毒 → 解释器填数。
 *
 * ⚠ 顺序不能反。先消毒再挂，挂的是已经安全的内容；反过来等于把不可信 HTML
 * 先塞进文档再补救，那一瞬间的副作用（比如 `<img onerror>`）已经发生了。
 */
export function BoundHtmlSurface({
  html,
  source,
  onAction,
  onReport,
  className,
}: BoundHtmlSurfaceProps): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const shadowRef = React.useRef<ShadowRoot | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shadowRef.current) {
      // closed 而不是 open：外面拿不到 shadowRoot，少一条被顺手 querySelector
      // 进去乱改的路。调试要看内容有 onReport。
      shadowRef.current = host.attachShadow({ mode: "closed" });
    }
    const root = shadowRef.current;
    const clean = sanitizeBoundHtml(html);
    root.innerHTML = `<style>${SHADOW_BASE_CSS}</style>${clean}`;

    const container = root as unknown as Element;
    const report = applyBindings(container, { source, onAction });
    onReport?.({ ...report, hasDataSource: hasAnyDataSource(container) });
  }, [html, source, onAction, onReport]);

  return <div ref={hostRef} className={className} data-testid="bound-html-surface" />;
}
