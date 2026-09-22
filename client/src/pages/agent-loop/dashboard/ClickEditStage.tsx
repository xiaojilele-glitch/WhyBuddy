/**
 * 点选编辑舞台（2026-08-24）——应用中心只读预览里的"点一下改一下"。
 *
 * 前身是 `client/public/click-edit.html`：独立小工具，验证"点选编辑接真实
 * pages_json 能不能走通"（真机 E2E 过：真登录、真选中、真保存、真落库）。
 * 这里是把它收进正式 UI 的那一半，渲染管线换成跟只读预览**同一条**
 * （html-app-surface 的 sanitize + Tailwind 注入），不再自己另起一套。
 *
 * ## 存库时不能把"渲染用"的文档整份存回去 —— 这是设计的核心约束
 *
 * 画布里看到的 iframe 文档被注入了 Tailwind CDN script、铺满/对比度覆盖层
 * （见 html-app-surface.buildDocument）——那是**给人看的**，存回
 * `pages_json` 会：①下次 HtmlAppSurface 渲染时再注入一遍，脚本标签越攒越多；
 * ②`sanitizeAppHtml` 下次消毒会把我们自己注入的 `<script>` 摘掉但摘不干净
 * 残留的配色/覆盖 `<style>`，两边分叉。
 *
 * 做法：body 之外一律不碰。存库时单独把**原始** HTML（不经 Tailwind 注入的
 * `stripFrameNavigatingHrefs(sanitizeAppHtml(...))`）重跑一遍拿到"干净壳"，
 * 只用画布里编辑过的 `<body>` 去换那份干净壳的 `<body>`。两者的 body 在没有
 * 编辑动作时逐字节相同（`buildDocument` 第一步就是这同一对函数，且 Tailwind
 * Play 只往 head 塞样式、不改 body 结构/属性——这条断言没有测试钉，
 * 全靠这两处调用的是同一份函数保证，改动其中一处务必回来看这条注释）。
 */

import React from "react";

import {
  buildDocument,
  sanitizeAppHtml,
  sanitizeHtmlFragment,
  stripFrameNavigatingHrefs,
  markSrcdocGeneration,
  PREVIEW_INJECTED_SCRIPT_MARKS,
} from "@/pages/sliderule/live-runtime/html-app-surface";
import { BINDING_ATTRS } from "@/pages/sliderule/live-runtime/html-binding-runtime";
import {
  useScaleToFit,
  specPageViewport,
} from "@/pages/sliderule/live-runtime/canvas-scale";
import {
  STAGE_FRAME_PAD,
  STAGE_FRAME_SHADOW,
} from "@/pages/sliderule/live-runtime/stage-frame-style";
import {
  findDevicePreset,
  loadDevicePresetId,
} from "@/pages/sliderule/live-runtime/device-presets";
import { updateAppPage, aiEditElement } from "./app-store-client";
import {
  Undo2,
  Save,
  Trash2,
  Bold as BoldIcon,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Loader2,
} from "lucide-react";

const BLOCK_TAGS = new Set([
  "BUTTON",
  "A",
  "TD",
  "TH",
  "LI",
  "LABEL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "SPAN",
  "P",
]);

/**
 * 选中策略跟 click-edit.html 一致：语义 data-* 优先，退化到块级标签。
 *
 * ⚠ 导出是给**画布档的点选**用的（SpecPageCanvasStage）。两处呈现不同，
 *   但"什么算一个可编辑元素"必须是同一条规则——各写一套的话，画布上选得中
 *   的元素在页面档里选不中，或者反过来，而且不会报错。
 */
export function closestEditable(start: Element | null): HTMLElement | null {
  let cur: Element | null = start;
  while (cur && cur.tagName !== "BODY" && cur.tagName !== "HTML") {
    for (const attr of BINDING_ATTRS) {
      if (cur.hasAttribute(attr)) return cur as HTMLElement;
    }
    cur = cur.parentElement;
  }
  cur = start;
  while (cur && cur.tagName !== "BODY" && cur.tagName !== "HTML") {
    if (BLOCK_TAGS.has(cur.tagName)) return cur as HTMLElement;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * 面包屑/上一级导航用的祖先判据，比点选用的 `closestEditable` 宽一档：
 * 多认 NAV/HEADER/ASIDE/MAIN/FOOTER/FORM 这几个结构地标。
 *
 * ⚠ 故意不合并进 `closestEditable`：点选点在 nav 的空白处应该穿透选中
 * 里面具体那条菜单项（真机 E2E 验的就是这个），把地标标签塞进点选判据
 * 会让"点哪都选中最外层导航"，体验倒退。面包屑/上一级要的是相反的东西——
 * 允许一路"跳出"到这几个结构容器，两处判据故意不同，别为了"复用一份"
 * 合并成一份，那会两头都不对。
 */
const LANDMARK_TAGS = new Set([
  "NAV",
  "HEADER",
  "ASIDE",
  "MAIN",
  "FOOTER",
  "FORM",
]);

function closestBreadcrumbAncestor(start: Element | null): HTMLElement | null {
  let cur: Element | null = start;
  while (cur && cur.tagName !== "BODY" && cur.tagName !== "HTML") {
    for (const attr of BINDING_ATTRS) {
      if (cur.hasAttribute(attr)) return cur as HTMLElement;
    }
    if (LANDMARK_TAGS.has(cur.tagName) || BLOCK_TAGS.has(cur.tagName))
      return cur as HTMLElement;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * 找"下一层"可编辑元素——`closestEditable` 的反方向。参照 GrapesJS
 * `ComponentExit`（`core:component-exit`/`select-parent`：沿 parent() 链
 * 一路爬到第一个 `selectable` 的祖先）反过来写：不爬祖先，改成沿子树
 * document order 找第一个够格的后代。两轮判据跟 `closestEditable` 对齐
 * （语义属性优先，退化到块级标签），保证"选中判据"只有一份，不会两边分叉。
 */
export function firstEditableDescendant(root: Element): HTMLElement | null {
  const all = Array.from(root.querySelectorAll<HTMLElement>("*"));
  for (const el of all) {
    for (const attr of BINDING_ATTRS) {
      if (el.hasAttribute(attr)) return el;
    }
  }
  for (const el of all) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
  }
  return null;
}

/**
 * 面包屑：从选中元素往上收可编辑祖先（含自己），最多 max 级。
 * 同样是 GrapesJS ComponentExit 那条"爬到第一个够格祖先"的判据，
 * 只是这里要收集整条链而不是只找一个——面包屑要能一路点上去。
 */
export function editableAncestorChain(el: HTMLElement, max = 4): HTMLElement[] {
  const chain: HTMLElement[] = [el];
  let cur: HTMLElement = el;
  while (chain.length < max) {
    const found = closestBreadcrumbAncestor(cur.parentElement);
    if (!found) break;
    chain.unshift(found);
    cur = found;
  }
  return chain;
}

const STRUCTURAL_BREADCRUMB_LABELS: Record<string, string> = {
  NAV: "导航",
  HEADER: "顶栏",
  ASIDE: "侧栏",
  MAIN: "主体",
  FOOTER: "底部",
  FORM: "表单",
};

/** 面包屑每一节的短标签：结构容器给中文名，其余走语义属性值，再退化成文字摘要。 */
export function breadcrumbLabel(el: HTMLElement): string {
  const structural = STRUCTURAL_BREADCRUMB_LABELS[el.tagName];
  if (structural) return structural;
  for (const attr of BINDING_ATTRS) {
    if (el.hasAttribute(attr))
      return el.getAttribute(attr) || el.tagName.toLowerCase();
  }
  const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 10);
  return text || el.tagName.toLowerCase();
}

export function labelOfEditable(el: HTMLElement): string {
  for (const attr of BINDING_ATTRS) {
    if (el.hasAttribute(attr)) return `${attr}="${el.getAttribute(attr)}"`;
  }
  const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 18);
  return text
    ? `<${el.tagName.toLowerCase()}> ${text}`
    : `<${el.tagName.toLowerCase()}>`;
}

/**
 * 字号：跟 Tiptap `extension-text-style/font-size` 同一条纪律——**读的时候
 * 优先信行内 `style.fontSize`**（用户改过的值），只有从没改过才退回
 * `getComputedStyle`。全用 px 存，跟 Tiptap 存 `style="font-size: Xpx"`
 * 一样直白，不引入 rem/em 的相对换算。
 */
export const MIN_FONT_SIZE_PX = 8;
export const MAX_FONT_SIZE_PX = 96;

export function clampFontSizePx(px: number): number {
  return Math.min(MAX_FONT_SIZE_PX, Math.max(MIN_FONT_SIZE_PX, Math.round(px)));
}

/**
 * AI 编辑返回的（已消毒过的）HTML 片段 → 真实 DOM 节点。纯函数，接一个
 * `Document` 是为了单测不用起真的 iframe。只取**第一个**顶层元素——
 * AI 有时会不听话地吐出多个兄弟节点，这里跟后端提示词的"只输出一个元素"
 * 对齐，多出来的直接丢，不悄悄拼接（拼接等于给页面塞进一段没人要过的结构）。
 */
export function parseFirstElement(
  doc: Document,
  html: string
): HTMLElement | null {
  const wrap = doc.createElement("div");
  wrap.innerHTML = html;
  return wrap.firstElementChild as HTMLElement | null;
}

export function resolveFontSizePx(
  el: HTMLElement,
  computedFontSize: string
): number {
  const inline = el.style.fontSize;
  if (inline && inline.trim().endsWith("px")) {
    const n = parseFloat(inline);
    if (!Number.isNaN(n)) return n;
  }
  const n = parseFloat(computedFontSize);
  return Number.isNaN(n) ? 16 : n;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * iframe 内元素坐标 → 画布容器坐标。**这是 2026-08-24 那个"点选之后高亮框和
 * 工具条飘到别处去"的病根**，用户截图报的。
 *
 * `getBoundingClientRect()` 量出来的是 **iframe 自己视口**里的坐标——
 * 1920×1080 设计分辨率、**未缩放**。而高亮框/工具条是画布容器的 `absolute`
 * 子元素。两个坐标系之间隔着两层，第一版一层都没换算：
 *
 *   ① `transform: scale(scale)` —— 画布按容器大小等比缩放（真机 47%~59%）；
 *   ② 居中留白 —— 缩放后的画框在容器里 `items-center justify-center`，
 *      左上角**不在** (0,0)。
 *
 * 少乘一个 scale 是**乘法误差**：元素越靠下越靠右偏得越狠。真机对过账——
 * 缩放 59%、画框起点屏幕 (810,270)，导航项在屏幕 (884,411) 即 iframe 坐标
 * (125,239)，漏换算直接把 (125,239) 当容器坐标用，工具条落在 y≈297，
 * 跟用户截图里那条一模一样。
 *
 * ⚠ frameOffset 必须由调用方拿**两个真实 DOM 矩形**量出来（画框 vs 容器），
 *   别在这里按 `(容器宽 - 画框宽)/2` 推算居中量：容器有 padding、圆角、
 *   将来加个工具栏都会让推算值和真实值分叉，而分叉了不会报错，只会又偏一次。
 */
export function toCanvasRect(
  frameRect: Box,
  scale: number,
  frameOffset: { left: number; top: number }
): Box {
  return {
    left: frameOffset.left + frameRect.left * scale,
    top: frameOffset.top + frameRect.top * scale,
    width: frameRect.width * scale,
    height: frameRect.height * scale,
  };
}

/** 工具条贴着选中框放，放不下就翻面/贴边。纯函数，单测钉着。
 *
 *  规则照 floating-ui 的 flip + shift（Tiptap BubbleMenu 用的就是它，
 *  这个仓的面包屑/字号也是照 Tiptap 抄的，行为保持一路）：
 *    - 默认放在选中框**上方**；上方顶到容器边就翻到**下方**；
 *    - 左右超出容器就贴边推回来，不让工具条跑到画布外面去。
 *
 *  ⚠ 坐标修好之前这条没意义（工具条本来就不在元素旁边，谈不上溢出）；
 *    修好之后它才真的会贴着右边的元素跑出画布，所以两件事是一起的。
 */
export function placeToolbar(
  rect: Box,
  toolbar: { width: number; height: number },
  container: { width: number; height: number },
  gap = 8,
  edge = 4
): { left: number; top: number } {
  const h = toolbar.height || 0;
  const w = toolbar.width || 0;
  let top = rect.top - h - gap;
  if (top < edge) {
    // 上方放不下 → 翻到下方；下方也放不下就贴容器底，总之不出界。
    const below = rect.top + rect.height + gap;
    top =
      container.height > 0
        ? Math.min(below, Math.max(edge, container.height - h - edge))
        : below;
  }
  let left = rect.left;
  if (w > 0 && container.width > 0)
    left = Math.min(left, container.width - w - edge);
  return { left: Math.max(edge, left), top: Math.max(edge, top) };
}

/**
 * 存库前把编辑过的 body 换回干净壳。纯函数，单测钉着。
 * 找不到 `<body>` 就返回 null——**不许**编一份出来，宁可保存失败让用户重试。
 */
/**
 * 我们自己注入进画布那份文档的东西——它们**不许**跟着存回去。
 *
 * ⚠ 2026-09-05 真机（同一天的第二刀）：这份清单第一版是**手写**的，里面
 *   多了一条 `cdn.tailwindcss.com`。预览注的是本地 `/vendor/tailwind-play-3.js`
 *   （buildDocument:646），从来不是那个 CDN；而**交付页自己带着**那一行
 *   （spec_page_html:66 的栈约束点名要引，缺了判"栈约束没被遵守"）。
 *
 *   后果：点选编辑每存一次就把交付页的 Tailwind 摘掉一次。真机
 *   sr-20260904232526 的 p1 就是这么从 2 个脚本变成 1 个的——页面在站外打开
 *   一条样式都没有，而屏幕上是绿色的「已保存」。服务端的 page_edit_guard
 *   报了「页面脚本 2→1」，是那条告警把它捞出来的。
 *
 *   现在清单**从注入方那边取**（PREVIEW_INJECTED_SCRIPT_MARKS），不再手写：
 *   手写的清单是一份关于别人在做什么的猜测，而猜测会过期。
 */
const INJECTED_SCRIPT_MARKS = PREVIEW_INJECTED_SCRIPT_MARKS;

/**
 * 原文里的 `<script>`，按出现顺序。**不含**我们注入的那几个。
 *
 * ⚠ 2026-09-05：消毒器的 `FORBID_TAGS` 里有 `script`（那是给**展示**用的，
 *   舞台不跑页面脚本，页面是数据绑定驱动的木偶）。但存库那份是**交付物**，
 *   而 `spliceEditedBody` 先把整份原文消毒再换 body——于是**点选编辑存一次，
 *   这一页里所有 `<script>` 就永久没了**，接口还返回 `{ok:true}`。
 *
 *   真机 sr-20260904232526（汉字连线消除小游戏）三页各带 2~3 个内联 script、
 *   最多 880 字符，整局逻辑（落子、下落补位、连击计数）全在里面。用户去改一
 *   个标题，存完游戏就变成一张死图——而他改的那处跟脚本毫无关系。
 *   这正是本仓最忌的「闸绿但东西没了」：没有报错、没有告警、判据全绿。
 */
export function preservedScripts(originalHtml: string): string[] {
  const all = String(originalHtml || "").match(/<script\b[\s\S]*?<\/script>/gi) || [];
  return all.filter(tag => !INJECTED_SCRIPT_MARKS.some(mark => tag.includes(mark)));
}

export function spliceEditedBody(
  originalHtml: string,
  editedBodyOuterHtml: string
): string | null {
  const clean = stripFrameNavigatingHrefs(sanitizeAppHtml(originalHtml));
  if (!clean || !/<body[^>]*>[\s\S]*<\/body>/i.test(clean)) return null;
  // 编辑过的 body 来自消过毒的 DOM，脚本已经不在里面了；从原文捞回来补在
  // body 末尾。补在末尾而不是原位：位置信息在消毒那一刻就没了，而 body 末尾
  // 是最安全的一处（DOM 已经解析完，取元素不会取空）。
  const keep = preservedScripts(originalHtml);
  const body = keep.length
    ? /<\/body>/i.test(editedBodyOuterHtml)
      ? editedBodyOuterHtml.replace(/<\/body>/i, () => `\n${keep.join("\n")}\n</body>`)
      : `${editedBodyOuterHtml}\n${keep.join("\n")}`
    : editedBodyOuterHtml;
  return clean.replace(/<body[^>]*>[\s\S]*<\/body>/i, () => body);
}

interface Selection {
  el: HTMLElement;
  /** ⚠ **画布容器坐标系**（已经过 toCanvasRect 换算），不是 iframe 里量到的
   *  原始矩形。存进来之前必须换算——存原始矩形就是 2026-08-24 那个偏移 bug。 */
  rect: Box;
}

export interface ClickEditStageProps {
  appId: string;
  pageId: string;
  html: string;
  device?: "desktop" | "phone" | "tablet";
  /** 存成功后把最终 HTML 报给宿主，好更新本地缓存（details[key].specPages）。 */
  onSaved?: (pageId: string, html: string) => void;
  /** 有没有未保存的改动——宿主切页/关弹窗前拿它决定要不要拦一下。 */
  onDirtyChange?: (dirty: boolean) => void;
  className?: string;
}

/**
 * ⚠ 按 `${appId}:${pageId}` 当 React key 挂载（AppsWorkbench 那边保证）：
 * 切页 = 整个组件重新挂载，内部状态（选中/撤销栈/脏标记）不用手动重置。
 */
export function ClickEditStage({
  appId,
  pageId,
  html,
  device,
  onSaved,
  onDirtyChange,
  className = "",
}: ClickEditStageProps): React.ReactElement {
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const rawBaseRef = React.useRef(html); // 最近一次落库成功的原始 HTML（存库时的换壳底）
  const undoStackRef = React.useRef<string[]>([]); // body outerHTML 快照
  const [selected, setSelected] = React.useState<Selection | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [canUndo, setCanUndo] = React.useState(false);
  const [status, setStatus] = React.useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "ok"; text: string; warn?: string }
    | { kind: "err"; text: string }
  >({ kind: "idle" });
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiInstruction, setAiInstruction] = React.useState("");
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);

  const fillPhone = device === "phone";
  // ⚠ 跟预览舞台读同一份机型偏好。点选编辑改的就是舞台上那份页面——两边画布
  // 尺寸不一致的话，用户在 iPhone SE 下看到的换行位置，进编辑态会变回 390 宽的
  // 排版，"所见即所改"当场失效，且不会有任何报错。
  // 这里只读不写：切机型的入口只有舞台那一个下拉，编辑态跟随即可。
  const viewport = fillPhone
    ? (p => ({ w: p.width, h: p.height }))(
        findDevicePreset(loadDevicePresetId())
      )
    : specPageViewport(device);
  const { ref: fitRef, scale } = useScaleToFit(
    viewport.w,
    viewport.h,
    "contain",
    false,
    // 与预览舞台同一份余量：点选编辑用的是同一个画框，不扣余量
    // 新的 ring 会被容器切掉（2026-08-24）。
    STAGE_FRAME_PAD
  );
  /** 缩放后的画框本体。量它跟容器的差值就是"居中留白"，不靠公式推。 */
  const frameBoxRef = React.useRef<HTMLDivElement | null>(null);
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);
  const [toolbarSize, setToolbarSize] = React.useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = React.useState({
    width: 0,
    height: 0,
  });
  /**
   * 工具条和容器的实测尺寸——placeToolbar 要拿它们判"放不放得下"。
   *
   * ⚠ 不写依赖数组（每次渲染都量）：工具条高度会随 AI 编辑面板展开/收起变，
   *   面包屑长短也影响宽度，列依赖必漏。setState 前先比一遍**并按整像素比**，
   *   不然亚像素抖动会来回 setState 把渲染钉死。首帧量到 0 也没关系——
   *   placeToolbar 对 0 尺寸退化成"就贴着选中框放"，下一帧量准了再归位。
   */
  React.useLayoutEffect(() => {
    const t = toolbarRef.current?.getBoundingClientRect();
    const c = fitRef.current?.getBoundingClientRect();
    if (t) {
      setToolbarSize(prev =>
        Math.round(prev.width) === Math.round(t.width) &&
        Math.round(prev.height) === Math.round(t.height)
          ? prev
          : { width: t.width, height: t.height }
      );
    }
    if (c) {
      setContainerSize(prev =>
        Math.round(prev.width) === Math.round(c.width) &&
        Math.round(prev.height) === Math.round(c.height)
          ? prev
          : { width: c.width, height: c.height }
      );
    }
  });

  /**
   * 量一个 iframe 内元素在**画布容器坐标系**里的位置。整个组件里
   * `getBoundingClientRect` 只该经过这一处——散在四处各量各的，就是当初
   * 四个入口三种写法、修一处漏三处的由来。
   */
  const measureInCanvas = React.useCallback(
    (el: HTMLElement): Box => {
      const r = el.getBoundingClientRect();
      const box = frameBoxRef.current?.getBoundingClientRect();
      const container = fitRef.current?.getBoundingClientRect();
      const offset =
        box && container
          ? { left: box.left - container.left, top: box.top - container.top }
          : { left: 0, top: 0 };
      return toCanvasRect(
        { left: r.left, top: r.top, width: r.width, height: r.height },
        scale,
        offset
      );
    },
    [scale, fitRef]
  );
  // iframe 里的监听只挂一次（见下面那个 effect），拿不到后续渲染的新闭包——
  // 用 ref 转发最新的那一份，别把 scale 冻结在第一帧（冻结了缩放一变就又偏）。
  const measureRef = React.useRef(measureInCanvas);
  measureRef.current = measureInCanvas;

  const markDirty = React.useCallback(() => {
    setDirty(true);
    onDirtyChange?.(true);
  }, [onDirtyChange]);

  const pushUndoSnapshot = React.useCallback(() => {
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    const stack = undoStackRef.current;
    stack.push(body.outerHTML);
    if (stack.length > 25) stack.shift();
    setCanUndo(true);
  }, []);

  // 挂文档：同源 iframe（不加 sandbox），跟只读预览同一份 buildDocument——
  // 画出来的样子要跟预览一致，编辑才不会"看着改对了，退出预览又不一样"。
  React.useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const raw = buildDocument(rawBaseRef.current, fillPhone);
    if (!raw) return;
    const token = `ce${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const doc = markSrcdocGeneration(raw, token);
    let disposed = false;
    let wired = false;

    const onLoad = () => {
      if (disposed || wired) return;
      const d = frame.contentDocument;
      if (!d || !d.body) return;
      if (d.documentElement.getAttribute("data-sr-frame") !== token) return;
      if (!d.body.childNodes.length && !d.head?.childNodes.length) return;
      wired = true;

      d.addEventListener(
        "click",
        ev => {
          const target = ev.target as Element | null;
          if (!target) return;
          ev.preventDefault();
          ev.stopPropagation();
          const found = closestEditable(target);
          if (!found) {
            setSelected(null);
            return;
          }
          setSelected({ el: found, rect: measureRef.current(found) });
        },
        true
      );

      // 页面内部会滚（壳给 main 打了 overflow-y:auto）。选中之后一滚，
      // 元素动了而高亮框不动 —— 表现跟这次修的偏移是同一类"框和东西对不上"。
      // 捕获阶段挂在 document 上：内层滚动容器的 scroll 不冒泡，不捕获就收不到。
      d.addEventListener("scroll", () => remeasureRef.current(), true);
    };
    frame.addEventListener("load", onLoad);
    frame.srcdoc = doc;
    onLoad();

    /* ⚠ 2026-08-25 真机（健身房那趟）：点选编辑整个选不中，而且**一声不响**——
       进得去编辑态、iframe 画得出页面、控制台零报错，只是点谁都没反应。
       静态判据全绿：组件在、iframe 在、元素也在（量到 122 个可点元素）。

       第一版排查还被自己的判据骗了一次：拿"点完出现『保存修改』"当选中成功的
       依据，而那颗按钮是编辑态常驻的（见下面 :749 一带），跟选没选中无关，
       于是报了假绿。换成 selected 门控下的 click-edit-toolbar / -outline 才
       露出来。**这就是"每写一条应该有 X，配一条 X 真的被用到了"的原型。**

       真因在这行下面：挂点击监听器只发生在 onLoad 里，而 `frame.srcdoc = doc`
       之后 **load 事件不来**。浏览器打桩量到的时序：

         20019ms 挂 load 监听器
         20027ms   ↳ load 回调进入：token=∅ bodyKids=0     ← about:blank 那次
         20036ms 挂 load 监听器 + set srcdoc token=ce...
         （此后 4 秒静默，load 再没触发，document 上的 click 一次都没挂上）

       srcdoc 是写进那个**初始 about:blank 文档**的，浏览器按"替换初始空文档"
       处理，不再补第二次 load；而那唯一一次 load 早于我们挂监听器。同步补调的
       `onLoad()` 也救不了：那一刻 contentDocument 还是空的，token 对不上，
       正好被 guard 挡掉。

       所以别把挂载时机绑死在一个不保证会来的事件上：srcdoc 写完就开始轮询，
       文档带上我们的 token 就立刻接管。token 判据一个字不动——它挡的是"接管
       到上一份文档上去"，那才是这段代码真正要防的东西。 */
    const poll = window.setInterval(() => {
      onLoad();
      if (disposed || wired) window.clearInterval(poll);
    }, 50);
    // 兜底停表：这是增强类逻辑，自己卡住也不许拖着一个永动定时器（fail-open）。
    const pollStop = window.setTimeout(() => window.clearInterval(poll), 10000);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      window.clearTimeout(pollStop);
      frame.removeEventListener("load", onLoad);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只挂一次——切页靠外层换 key 重新挂载整个组件，见上面的类头注释

  /** 重新量当前选中元素（缩放变了、页面滚了、内容改了尺寸都要重量）。 */
  const reselect = React.useCallback(() => {
    setSelected(prev =>
      prev ? { ...prev, rect: measureInCanvas(prev.el) } : prev
    );
  }, [measureInCanvas]);
  const remeasureRef = React.useRef(reselect);
  remeasureRef.current = reselect;

  // 缩放系数变了（拖分栏、窗口 resize）：画框大小和居中留白同时变，两样都在
  // measureInCanvas 里重新量，这里只管触发。
  React.useEffect(() => {
    reselect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // 换了选中对象（含取消选中）就把 AI 编辑面板收起来——上一个元素的改法
  // 说明留在输入框里、糊到下一个元素身上，是会让人分不清"AI 到底改的是哪个"。
  React.useEffect(() => {
    setAiOpen(false);
    setAiError(null);
    setAiInstruction("");
  }, [selected?.el]);

  const selectElement = React.useCallback(
    (el: HTMLElement) => {
      setSelected({ el, rect: measureInCanvas(el) });
    },
    [measureInCanvas]
  );

  /** 面包屑箭头：往上选父级 / 往下选子级——GrapesJS ComponentExit 的"爬到
   *  第一个够格祖先"反过来配一个"下钻到第一个够格后代"，两个方向对称。 */
  const handleSelectParent = () => {
    if (!selected) return;
    const found = closestBreadcrumbAncestor(selected.el.parentElement);
    if (found) selectElement(found);
  };

  const handleSelectChild = () => {
    if (!selected) return;
    const found = firstEditableDescendant(selected.el);
    if (found) selectElement(found);
  };

  const handleEditText = () => {
    if (!selected) return;
    pushUndoSnapshot();
    const el = selected.el;
    el.contentEditable = "true";
    el.focus();
    const onBlur = () => {
      el.contentEditable = "false";
      el.removeEventListener("blur", onBlur);
      markDirty();
      reselect();
    };
    el.addEventListener("blur", onBlur);
  };

  const handleBold = () => {
    if (!selected) return;
    pushUndoSnapshot();
    const el = selected.el;
    const cur =
      frameRef.current?.contentWindow?.getComputedStyle(el).fontWeight ?? "400";
    const isBold = parseInt(cur, 10) >= 600;
    el.style.fontWeight = isBold ? "400" : "700";
    markDirty();
  };

  const handleColor = (value: string) => {
    if (!selected) return;
    pushUndoSnapshot();
    selected.el.style.color = value;
    markDirty();
  };

  const handleFontSizeStep = (delta: number) => {
    if (!selected) return;
    pushUndoSnapshot();
    const el = selected.el;
    const computed =
      frameRef.current?.contentWindow?.getComputedStyle(el).fontSize ?? "16px";
    const next = clampFontSizePx(resolveFontSizePx(el, computed) + delta);
    el.style.fontSize = `${next}px`;
    markDirty();
    reselect(); // 字号变了，选中框跟着元素新尺寸走
  };

  const handleDelete = () => {
    if (!selected) return;
    pushUndoSnapshot();
    selected.el.remove();
    setSelected(null);
    markDirty();
  };

  /** ✨ AI 编辑：选中元素的 HTML + 一句改法 → 后端 LLM 换一份 HTML 回来，
   *  消毒之后**整个换掉**选中元素（不是塞进去）。不落库——跟其它编辑动作
   *  一样，用户还得点右上角"保存修改"才真正写库，这里出错也不影响已有内容。 */
  const handleAiEditSubmit = async () => {
    if (!selected || !aiInstruction.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    const res = await aiEditElement(
      appId,
      pageId,
      selected.el.outerHTML,
      aiInstruction.trim()
    );
    if (!res.ok) {
      setAiBusy(false);
      setAiError(res.error);
      return;
    }
    const doc = frameRef.current?.contentDocument;
    const clean = sanitizeHtmlFragment(res.html);
    const newEl = doc && clean.trim() ? parseFirstElement(doc, clean) : null;
    setAiBusy(false);
    if (!newEl) {
      setAiError("AI 返回的内容解析不出可用的元素，换个说法再试试");
      return;
    }
    pushUndoSnapshot();
    selected.el.replaceWith(newEl);
    selectElement(newEl);
    markDirty();
    setAiOpen(false);
    setAiInstruction("");
  };

  const handleUndo = () => {
    const stack = undoStackRef.current;
    const snapshot = stack.pop();
    setCanUndo(stack.length > 0);
    const d = frameRef.current?.contentDocument;
    if (!snapshot || !d?.body) return;
    const wrap = d.createElement("html");
    wrap.innerHTML = snapshot;
    const newBody = wrap.querySelector("body");
    if (newBody) d.documentElement.replaceChild(newBody, d.body);
    setSelected(null);
    markDirty();
  };

  const handleSave = async () => {
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    setStatus({ kind: "saving" });
    const finalHtml = spliceEditedBody(rawBaseRef.current, body.outerHTML);
    if (!finalHtml) {
      setStatus({
        kind: "err",
        text: "生成保存内容失败（页面结构异常），请重试或联系维护者",
      });
      return;
    }
    const res = await updateAppPage(appId, pageId, finalHtml);
    if (!res.ok) {
      setStatus({ kind: "err", text: res.error });
      return;
    }
    rawBaseRef.current = finalHtml;
    setDirty(false);
    onDirtyChange?.(false);
    // ⚠ 2026-09-05：`warn` 是"存进去了，但顺手带走了东西"（后端数出来的：
    //   脚本 / 数据孔 / 表单控件变少）。它不是错误——东西确实存了——但只显
    //   「已保存」就是本仓最忌的那句"闸全绿但东西没了"：真机上一次点选编辑
    //   把整局游戏逻辑吃掉，屏幕上照样是绿色的「已保存」。
    setStatus({
      kind: "ok",
      text: `已保存 · ${res.bytes.toLocaleString("zh-CN")} 字节`,
      warn: res.warn,
    });
    onSaved?.(pageId, finalHtml);
  };

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col gap-2 ${className}`}
      data-testid="click-edit-stage"
    >
      <div className="flex shrink-0 items-center gap-2 px-0.5 text-[11px] leading-4 text-stone-500">
        <span className="font-mono tabular-nums">
          {viewport.w}×{viewport.h} · {Math.round(scale * 100)}%
        </span>
        <span aria-hidden>·</span>
        <span data-testid="click-edit-hint">
          点页面里的文字或按钮就能改；改完记得点右侧保存
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {status.kind === "ok" && (
            <span
              className="text-emerald-600"
              data-testid="click-edit-status-ok"
            >
              {status.text}
            </span>
          )}
          {status.kind === "ok" && status.warn ? (
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800"
              data-testid="click-edit-status-warn"
              title={status.warn}
            >
              {status.warn}
            </span>
          ) : null}
          {status.kind === "err" && (
            <span className="text-red-600" data-testid="click-edit-status-err">
              {status.text}
            </span>
          )}
          {dirty && status.kind !== "err" && (
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700"
              data-testid="click-edit-dirty"
            >
              有未保存的修改
            </span>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-stone-600 transition hover:bg-stone-100 disabled:opacity-40"
            disabled={!canUndo}
            onClick={handleUndo}
            data-testid="click-edit-undo"
          >
            <Undo2 size={13} /> 撤销
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-[#5b6cff] px-2.5 py-1 font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-40"
            disabled={!dirty || status.kind === "saving"}
            onClick={() => void handleSave()}
            data-testid="click-edit-save"
          >
            <Save size={13} />{" "}
            {status.kind === "saving" ? "保存中…" : "保存修改"}
          </button>
        </div>
      </div>

      <div
        ref={fitRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-[#eef0f4]"
        data-testid="click-edit-canvas"
        onClick={e => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        <div
          ref={frameBoxRef}
          style={{
            width: viewport.w * scale,
            height: viewport.h * scale,
            position: "relative",
            overflow: "hidden",
            borderRadius: 5,
            boxShadow: STAGE_FRAME_SHADOW,
            background: "#fff",
          }}
        >
          <div
            style={{
              width: viewport.w,
              height: viewport.h,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <iframe
              ref={frameRef}
              title="点选编辑画布"
              referrerPolicy="no-referrer"
              style={{
                width: viewport.w,
                height: viewport.h,
                border: 0,
                background: "#fff",
              }}
              data-testid="click-edit-frame"
            />
          </div>
        </div>

        {selected && (
          <div
            className="pointer-events-none absolute z-10 rounded outline outline-2 outline-[#5b6cff]"
            style={{
              left: selected.rect.left,
              top: selected.rect.top,
              width: selected.rect.width,
              height: selected.rect.height,
            }}
            data-testid="click-edit-outline"
          />
        )}
        {selected && (
          <div
            ref={toolbarRef}
            className="absolute z-20 flex max-w-[92%] flex-col gap-1.5 rounded-lg border border-stone-200 bg-white px-2 py-1.5 shadow-lg"
            style={placeToolbar(selected.rect, toolbarSize, containerSize)}
            data-testid="click-edit-toolbar"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-1">
              {/* 面包屑：可编辑祖先链，点哪级就选中哪级；title 兜底显示完整选择器
                （labelOfEditable），鼠标停久一点还能看到 data-field 这类精确信息。 */}
              <div
                className="flex max-w-[200px] items-center overflow-hidden"
                data-testid="click-edit-breadcrumb"
              >
                {editableAncestorChain(selected.el).map((el, i, arr) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="px-0.5 text-stone-300">·</span>}
                    <button
                      type="button"
                      title={labelOfEditable(el)}
                      className={`shrink-0 truncate rounded px-1 text-[11px] hover:bg-stone-100 ${
                        i === arr.length - 1
                          ? "font-semibold text-stone-700"
                          : "text-stone-400"
                      }`}
                      style={
                        i === arr.length - 1 ? undefined : { maxWidth: 56 }
                      }
                      onClick={() => selectElement(el)}
                      data-testid={`click-edit-crumb-${i}`}
                    >
                      {breadcrumbLabel(el)}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <button
                type="button"
                className="rounded p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                title="选中上一级"
                disabled={!closestBreadcrumbAncestor(selected.el.parentElement)}
                onClick={handleSelectParent}
                data-testid="click-edit-select-parent"
              >
                <ChevronLeft size={13} />
              </button>
              <button
                type="button"
                className="rounded p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                title="选中下一级"
                disabled={!firstEditableDescendant(selected.el)}
                onClick={handleSelectChild}
                data-testid="click-edit-select-child"
              >
                <ChevronRight size={13} />
              </button>
              <span className="mx-0.5 h-4 w-px bg-stone-200" aria-hidden />
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[12px] font-semibold text-stone-600 hover:bg-stone-100 disabled:opacity-30"
                title="缩小字号"
                onClick={() => handleFontSizeStep(-1)}
                disabled={
                  clampFontSizePx(
                    resolveFontSizePx(
                      selected.el,
                      frameRef.current?.contentWindow?.getComputedStyle(
                        selected.el
                      ).fontSize ?? "16px"
                    )
                  ) <= MIN_FONT_SIZE_PX
                }
                data-testid="click-edit-font-minus"
              >
                A-
              </button>
              <span
                className="w-6 shrink-0 text-center font-mono text-[11px] tabular-nums text-stone-500"
                data-testid="click-edit-font-size"
              >
                {clampFontSizePx(
                  resolveFontSizePx(
                    selected.el,
                    frameRef.current?.contentWindow?.getComputedStyle(
                      selected.el
                    ).fontSize ?? "16px"
                  )
                )}
              </span>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[14px] font-semibold text-stone-600 hover:bg-stone-100 disabled:opacity-30"
                title="放大字号"
                onClick={() => handleFontSizeStep(1)}
                disabled={
                  clampFontSizePx(
                    resolveFontSizePx(
                      selected.el,
                      frameRef.current?.contentWindow?.getComputedStyle(
                        selected.el
                      ).fontSize ?? "16px"
                    )
                  ) >= MAX_FONT_SIZE_PX
                }
                data-testid="click-edit-font-plus"
              >
                A+
              </button>
              <span className="mx-0.5 h-4 w-px bg-stone-200" aria-hidden />
              <button
                type="button"
                className="rounded p-1 text-stone-600 hover:bg-stone-100"
                title="改文字"
                onClick={handleEditText}
                data-testid="click-edit-text"
              >
                文字
              </button>
              <button
                type="button"
                className="rounded p-1 text-stone-600 hover:bg-stone-100"
                title="加粗/取消加粗"
                onClick={handleBold}
                data-testid="click-edit-bold"
              >
                <BoldIcon size={13} />
              </button>
              <label
                className="rounded p-1 text-stone-600 hover:bg-stone-100"
                title="文字颜色"
              >
                <input
                  type="color"
                  className="h-3.5 w-3.5 cursor-pointer align-middle"
                  onChange={e => handleColor(e.target.value)}
                  data-testid="click-edit-color"
                />
              </label>
              <span className="mx-0.5 h-4 w-px bg-stone-200" aria-hidden />
              <button
                type="button"
                className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium transition ${
                  aiOpen
                    ? "bg-violet-100 text-violet-700"
                    : "text-violet-600 hover:bg-violet-50"
                }`}
                title="用一句话让 AI 改这个元素"
                onClick={() => setAiOpen(o => !o)}
                data-testid="click-edit-ai"
              >
                <Sparkles size={13} /> AI 编辑
              </button>
              <button
                type="button"
                className="rounded p-1 text-red-500 hover:bg-red-50"
                title="删除这个元素"
                onClick={handleDelete}
                data-testid="click-edit-delete"
              >
                <Trash2 size={13} />
              </button>
              <button
                type="button"
                className="rounded p-1 text-stone-400 hover:bg-stone-100"
                title="取消选中"
                onClick={() => setSelected(null)}
                data-testid="click-edit-deselect"
              >
                <X size={13} />
              </button>
            </div>
            {aiOpen && (
              <div
                className="flex items-center gap-1.5"
                data-testid="click-edit-ai-panel"
              >
                <input
                  type="text"
                  autoFocus
                  value={aiInstruction}
                  onChange={e => setAiInstruction(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") void handleAiEditSubmit();
                    if (e.key === "Escape") setAiOpen(false);
                  }}
                  placeholder="想怎么改？比如：改成更醒目的警示色、加一句副标题"
                  disabled={aiBusy}
                  className="h-7 w-64 flex-1 rounded border border-stone-200 px-2 text-[12px] outline-none focus:border-violet-400 disabled:opacity-60"
                  data-testid="click-edit-ai-input"
                />
                <button
                  type="button"
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded bg-violet-600 px-2.5 text-[12px] font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
                  disabled={aiBusy || !aiInstruction.trim()}
                  onClick={() => void handleAiEditSubmit()}
                  data-testid="click-edit-ai-submit"
                >
                  {aiBusy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  {aiBusy ? "生成中…" : "生成"}
                </button>
              </div>
            )}
            {aiError && (
              <div
                className="max-w-[20rem] text-[11px] text-red-600"
                data-testid="click-edit-ai-error"
              >
                {aiError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
