/**
 * 画布档：这一轮产出的**所有页面并排摊在一张无限画布上**，可平移、可缩放、
 * 可进板交互、可连线、可看属性、可导出，页面引的图也摊在下面。
 * 位置在顶栏档位组的第一片（画布 / 页面 / 代码）。
 *
 * ## 为什么要它（2026-08-25 用户提的）
 *
 * 页面档一次只看得见一页，而 spec-first 一轮交五页。"这个应用长什么样"
 * 是个**整体**问题：五页的版式一不一致、配色是不是一套、导航有没有断，
 * 一页一页翻是看不出来的——翻到第四页时第一页长什么样已经忘了。
 * 同类工具（Stitch / TRAE Design / Onlook / v0）全都有这一档，就是这个原因。
 *
 * ⚠ 画布**不替代**页面档。页面档是"用这个应用"，画布是"看这套应用"。
 *   两个都留着，这不是重复：页面档有点选编辑、透视、角色切换，画布有全局。
 *
 * ## 底座选 React Flow，不自己写 d3-zoom
 *
 * 仓里已经有 @xyflow/react（SystemLinkageGraph / WorkflowGraph /
 * EntityRelationGraph 三处在用），平移缩放、fitView、minimap、
 * 触控板双指与 ctrl+滚轮的分流全都是它现成的。自己写这一套要踩的坑
 * （缩放锚点漂移、触控板惯性、pinch 与 wheel 分不清）Onlook 的
 * canvas/index.tsx 里那句 `TODO: Debug where this offset is coming from`
 * 就是活证据——他们自己写的，锚点至今在漂。
 *
 * ## iframe 会吞掉画布手势 —— 必须盖一层手势层
 *
 * 这是本档唯一的**结构性**坑，第一版就踩了：滚轮停在画板上时缩放整个失灵。
 * 原因不是 React Flow 的问题——**wheel 事件进了 iframe 的文档，根本没冒泡
 * 到父页面**。同源不同源都一样，iframe 是独立的事件目标。
 *
 * 解法是 Onlook 的做法（apps/web/client/.../canvas/frame/gesture.tsx）：
 * 每块画板上盖一张 `absolute inset-0 bg-transparent` 的透明层，事件落在父
 * 文档里，正常冒泡给 React Flow。只有"进板"之后才把这层撤掉，让 iframe
 * 拿回点击权。
 *
 * ⚠ 别想着用 `pointer-events:none` 给 iframe 代替这层。那样确实能平移，
 *   但进板之后要一个一个把它加回来，而且 hover 态在切换的那一帧会闪。
 *   盖一层是加法，撤一层是减法，减法更不容易漏。
 *
 * ## 挂载是懒的，卸载不是
 *
 * 画板进入视口（含 MOUNT_MARGIN 余量）才挂 HtmlAppSurface；**挂上之后不再
 * 卸**。理由是 iframe 重挂要重写 srcdoc + 等 Tailwind + 重新 applyBindings，
 * 真机 300~600ms，来回平移会看到白板闪。一轮页面数是个位数（真机最多见过
 * 8 页），全挂上也扛得住。
 *
 * ⚠ 如果哪天单轮页数上到 20+，这里要改成真剔除（出视口就卸），届时请连同
 *   MOUNT_MARGIN 一起重新量，别只改一个数。
 *
 * ## 连线 / 属性面板 / 右键菜单 / 素材图（2026-08-25 第二轮）
 *
 * 四件事的"数据从哪来"都在 canvas-board-graph.ts 的头注里，尤其是**为什么
 * 连线必须以手画为主**（自动派生在三个真机会话上只有 1/0/0 条，读
 * data-page-id 则是 20 条完全图的毛线团）。动这块之前先读那份。
 *
 * ## fail-open
 *
 * 画布是**增强类**（第七条纪律）：它自己炸了不许拖垮主链路。外面套
 * AppStageErrorBoundary，炸了收进降级卡并明确指路"切回页面档"——
 * 但**不自动切**。自动切就是本仓最恨的那个形状：同一个入口两种面孔，
 * 而且换脸发生在用户看不见的地方。
 */

import React from "react";
import {
  Handle,
  MarkerType,
  MiniMap,
  type NodeChange,
  Position,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ImageOff,
  Images,
  Link2,
  Maximize2,
  Minus,
  MousePointerClick,
  PanelRight,
  Plus,
  LayoutGrid,
  RefreshCw,
  Scan,
} from "lucide-react";

import { HtmlAppSurface } from "./html-app-surface";
import { specPageViewport } from "./canvas-scale";
import { findDevicePreset, loadDevicePresetId } from "./device-presets";
import { CANVAS_CHROME_SHADOW, STAGE_FRAME_FLAT } from "./stage-frame-style";
import { elementPath, type PathStep } from "./element-path";
import { blockIdentity, type BlockIdentity } from "./page-blocks";
import { useBlockRects } from "./use-block-rects";
import { blockKey, type BlockRect, type BlockRectSnapshot } from "./block-rects";
import {
  BLOCK_CELL,
  BLOCK_CHROME,
  blockGridExtraGapX,
  blockGridSpan,
  blockKindTint,
  layoutBlockNodes,
  shouldDrawBlockDetail,
  type BlockNodeBox,
} from "./block-node-layout";
import { buildCurvePath } from "./canvas-curve";
import { fitBlockNodes, type BlockNodeCandidate } from "./block-node-fit";
import {
  IMPACT_DIM_EDGE,
  IMPACT_DIM_NODE,
  IMPACT_FOCUS_IDLE,
  buildImpactEdges,
  impactEdgeDimmed,
  impactFocus,
  impactNodeDimmed,
  islandBlockKeys,
  isRealLinkage,
  scanBlockBindings,
  type ImpactEdgeKind,
  type ImpactFocus,
} from "./block-impact";
import {
  frameRectToNodeRect,
  elementTitle,
  snapshotComputed,
  type Rect,
} from "./canvas-element-edit";
import { closestEditable } from "../../agent-loop/dashboard/ClickEditStage";
import { BINDING_ATTRS as BINDING_ATTR_LIST } from "./html-binding-runtime";
import { deriveBindingSource } from "./derive-binding-source";
import { canonicalPageId } from "../page-id-alias";
import {
  boardPositionsStorageKey,
  isTypingTarget,
  readBoardPositions,
  writeBoardPositions,
  type BoardPosition,
  MAX_ZOOM,
  MIN_ZOOM,
  artboardLabel,
  boardsBounds,
  labelCounterScale,
  labelMaxCssWidth,
  layoutArtboards,
  pickLinkSides,
  shouldMountBoard,
  type ArtboardBox,
} from "./canvas-board-layout";
import {
  ASSET_TILE,
  addManualLink,
  boardFacts,
  deriveDataflowLinks,
  assetUseGroups,
  extractPageAssets,
  layoutAssets,
  planAssetReplacement,
  linkToRefineInstruction,
  manualLinksStorageKey,
  readManualLinks,
  removeLink,
  writeManualLinks,
  type BoardLink,
  type AssetUseGroup,
  type CanvasAsset,
} from "./canvas-board-graph";
import { exportBoardHtml, exportBoardPng } from "./canvas-board-export";
import { CanvasInspector } from "./CanvasInspector";
import { AssetReplacePanel } from "./AssetReplacePanel";
import { CanvasElementPanel } from "./CanvasElementPanel";
import { CanvasBlockPanel } from "./CanvasBlockPanel";
import { aiEditBlock, updateAppPage } from "../../agent-loop/dashboard/app-store-client";
import { CanvasBoardMenu } from "./CanvasBoardMenu";
import type { SpecPageLive } from "./SpecPageLiveStage";
import type { ActionGates, BindingActionEvent } from "./html-binding-runtime";
import type { RuntimeState } from "./live-runtime";
import type { FiveSystemModel } from "../system-screens/five-system-model";

export interface SpecPageCanvasStageProps {
  pages: SpecPageLive[];
  /** 还在推演中：页面会陆续到达，标题条上如实说"还在画"。 */
  running?: boolean;
  model?: FiveSystemModel | null;
  runtime?: RuntimeState | null;
  gates?: ActionGates;
  onAction?: (event: BindingActionEvent) => void;
  onHoverBinding?: (
    info: { attr: string; value: string; el: Element } | null
  ) => void;
  /** 选中的画板 = 当前页（透视面板跟着它切片）。 */
  activePageId?: string | null;
  onActivePageChange?: (pageId: string) => void;
  /** 「在页面档打开」：把这一页送回单页舞台。 */
  onOpenInPageView?: (pageId: string) => void;
  /** 手画连线按会话存档；不传的话存在 anon 键下（换会话会串味，宿主务必传）。 */
  sessionId?: string;
  /**
   * 这个会话背后已落库的应用 id。换图要写回 `pages_json`，没有它就换不了。
   *
   * ⚠ 会话不一定已经落库（推演没跑完/还没存），所以这里是可空的，
   *   而且**不能拿它当"功能坏了"处理**——要如实说"还没存成应用，先跑完一轮"。
   */
  appId?: string | null;
  /** 换图落库成功后把新 HTML 交回宿主（宿主用它更新 pageOverrides，
   *  否则画布上还是旧图：存了但看着没变，本仓最忌的那种）。 */
  onPagesReplaced?: (patch: Record<string, string>) => void;
  /**
   * Ctrl/⌘+Click 画板里的某个元素 → 宿主切到点选编辑，带上这一页和这个元素。
   *
   * ⚠ path 可能是 null：点在空白处、或点到的是**运行时克隆出来的**表格行
   *   （源 HTML 里没有对应元素）。宿主要如实说"定位不到"，别静默选别的。
   */
  /** 说明行右侧（角色切换）。跟页面档同一个位置。 */
  metaTrailing?: React.ReactNode;
  className?: string;
}

/**
 * 把一句话填进输入框并聚焦。
 *
 * ⚠ 用的是仓里**已有**的 `sliderule:fill-prompt` 事件（ComposerDock 在听，
 *   空态示例卡片走的就是它），不新造一条 prop 链路。这条也决定了这个功能的
 *   边界：**只填不发**。一轮推演是几分钟 + 真金白银的 token，右键点一下就
 *   开跑是敌意设计——按不按回车是用户的事。
 */
function fillComposer(text: string): void {
  window.dispatchEvent(
    new CustomEvent("sliderule:fill-prompt", { detail: { text } })
  );
}

interface ArtboardData extends Record<string, unknown> {
  page: SpecPageLive;
  box: ArtboardBox;
  index: number;
  label: string;
  fillPhone: boolean;
}

interface AssetData extends Record<string, unknown> {
  asset: CanvasAsset;
  w: number;
  h: number;
}

/**
 * 从画布上的一次点击，取出 iframe 里被点到的那个元素的结构路径。
 *
 * ⚠ 取不到就回 null，**不猜**。调用方据此如实告诉用户"这个位置定位不到"，
 *   而不是退而求其次选个别的元素——选错了用户改完保存才发现，代价是内容被
 *   改坏。iframe 是 srcdoc 同源，contentDocument 拿得到；拿不到（还没加载完 /
 *   被浏览器策略挡了）也是回 null。
 */
/**
 * 一个高亮框。hover 是细虚线，select 是实线 + 元素名标签——两种状态一眼能分开
 * （GrapesJS/Figma 都是这个区分法：悬停轻、选中重）。
 *
 * ⚠ 描边宽度和标签要**反缩放**：画布缩到 25% 时 1px 的框只有 0.25px，
 *   亚像素直接看不见——本仓在点阵那次已经栽过同一个坑。
 */
function ElementSpot({
  rect,
  kind,
  label,
}: {
  rect: Rect;
  kind: "hover" | "select";
  label?: string;
}): React.ReactElement {
  const zoom = useStore(s => s.transform[2]);
  const inv = zoom > 0 ? 1 / zoom : 1;
  const color = kind === "select" ? "#1677ff" : "#7aa2ff";
  return (
    <div
      className="pointer-events-none absolute"
      data-testid={`sliderule-canvas-element-${kind}`}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        outline: `${(kind === "select" ? 2 : 1.5) * inv}px ${
          kind === "select" ? "solid" : "dashed"
        } ${color}`,
        outlineOffset: 0,
        background:
          kind === "select" ? "rgba(22,119,255,0.06)" : "rgba(22,119,255,0.04)",
        borderRadius: 2 * inv,
      }}
    >
      {label ? (
        <span
          className="absolute whitespace-nowrap rounded px-1 py-px text-white"
          style={{
            left: 0,
            top: 0,
            transform: `scale(${inv}) translateY(-100%)`,
            transformOrigin: "top left",
            background: color,
            fontSize: 11,
            marginTop: -2 * inv,
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 块框：刀 1 量出来的那个方框，画在画板上。
 *
 * ⚠ 跟 `ElementSpot` 是**两回事**，别合并：元素框是"你正指着/选中的那一个
 *   元素"，块框是"这一页由哪几块拼成"的常驻底图。两者会同时出现——
 *   Ctrl 滑过表格里某个单元格时，元素框在单元格上，块框在整块表格上。
 *
 * ⚠ 描边同样要**反缩放**（`inv`），理由见 ElementSpot 头注：缩到 25% 时
 *   1px 的线只有 0.25px，亚像素直接看不见。
 */
function BlockSpot({
  block,
  active,
}: {
  block: BlockRect;
  active: boolean;
}): React.ReactElement {
  const zoom = useStore(s => s.transform[2]);
  const inv = zoom > 0 ? 1 / zoom : 1;
  const color = active ? "#7c3aed" : "#c4b5fd";
  return (
    <div
      className="pointer-events-none absolute"
      data-testid="sliderule-canvas-block-spot"
      data-block-name={block.name}
      style={{
        left: block.rect.left,
        top: block.rect.top,
        width: block.rect.width,
        height: block.rect.height,
        outline: `${(active ? 2 : 1) * inv}px ${active ? "solid" : "dashed"} ${color}`,
        outlineOffset: 0,
        borderRadius: 3 * inv,
        background: active ? "rgba(124,58,237,0.06)" : "transparent",
      }}
    >
      <span
        className="absolute whitespace-nowrap rounded px-1 py-px text-white"
        style={{
          left: 0,
          top: 0,
          transform: `scale(${inv}) translateY(-100%)`,
          transformOrigin: "top left",
          background: color,
          fontSize: 10,
          marginTop: -2 * inv,
        }}
      >
        {block.kindLabel}·{block.label}
      </span>
    </div>
  );
}

/**
 * 高亮框上那行字。
 *
 * 悬停只报**块**（「表格·待指派工单」），选中报「块 › 元素」。
 *
 * ⚠ 不在任何块里的元素（壳里的菜单、面包屑）报空，让 ElementSpot 不画标签
 *   ——不是报「未知块」。没有块身份和"块叫未知"是两回事。
 */
export function blockTag(p: PickedElement | null): string | undefined {
  if (!p?.block) return undefined;
  return `${p.block.kindLabel}·${p.block.label}`;
}

/** 选中态的标签：有块就「块 › 元素」，没块就只报元素。 */
export function pickTitle(p: PickedElement): string {
  const b = blockTag(p);
  return b ? `${b} › ${p.title}` : p.title;
}

/** 两次拾取是不是同一个元素（同页同路径）。悬停时用它收敛重渲。 */
export function samePick(
  a: PickedElement | null,
  b: PickedElement | null
): boolean {
  if (!a || !b) return a === b;
  if (a.pageId !== b.pageId) return false;
  if (a.path.length !== b.path.length) return false;
  return a.path.every(
    (s, i) => s.tag === b.path[i]!.tag && s.index === b.path[i]!.index
  );
}

/** 画布上选中/悬停到的那个元素——路径 + 在画板节点内的矩形 + 一点显示信息。 */
export interface PickedElement {
  pageId: string;
  path: PathStep[];
  /** 画板节点内坐标（React Flow 的平移缩放由节点自己带走） */
  rect: Rect;
  tag: string;
  title: string;
  /**
   * 这个元素属于**哪一块**（`data-block`，Python 那边划的）。不在任何块里
   * （壳里的菜单、面包屑）就是 null——**不就近兜底**，那会让用户以为自己
   * 选中了正文里的某一块。
   */
  block: BlockIdentity | null;
  /** 选中那一刻元素**真实**的样子（计算样式）。面板拿它当显示底值。 */
  computed: Record<string, string>;
}

/**
 * 从画布上的一次鼠标事件，取出 iframe 里那个元素。
 *
 * ⚠ 手势层盖在 iframe 上，事件落不到页面元素——所以**透过手势层去问 iframe**：
 *   把落点换算成 iframe 内坐标，用 elementFromPoint 取真正被指到的那个。
 *   让手势层在按住 Ctrl 时 pointer-events:none 也能做到，但那样平移/缩放/
 *   右键会在按键期间一起失灵。
 *
 * ⚠ 取不到就回 null，**不猜**。调用方据此不画高亮，而不是画一个位置存疑的框。
 *
 * ⚠ "什么算一个可编辑元素"用的是点选编辑那份 closestEditable——同一条规则，
 *   不在这里另写一套（各写一套的话两边选中的东西会不一样，还不报错）。
 */
function pickElementAtPoint(
  e: React.MouseEvent,
  pageId: string
): PickedElement | null {
  const shield = e.currentTarget as HTMLElement;
  const host = shield.parentElement;
  const frame = host?.querySelector("iframe");
  if (!frame) return null;
  let doc: Document | null = null;
  try {
    doc = frame.contentDocument;
  } catch {
    return null; // 跨源，理论上不会走到（srcdoc 同源）
  }
  if (!doc?.body) return null;
  const box = frame.getBoundingClientRect();
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const docW = doc.documentElement.clientWidth || frame.clientWidth;
  const docH = doc.documentElement.clientHeight || frame.clientHeight;
  if (!(docW > 0) || !(docH > 0)) return null;
  const hit = doc.elementFromPoint(
    ((e.clientX - box.left) / box.width) * docW,
    ((e.clientY - box.top) / box.height) * docH
  );
  if (!hit || hit === doc.body || hit === doc.documentElement) return null;
  const el = closestEditable(hit) ?? (hit as HTMLElement);
  const path = elementPath(el, doc.body);
  if (!path) return null;
  const r = el.getBoundingClientRect();
  /*
   * ⚠ 节点尺寸要用 **offsetWidth/offsetHeight（布局尺寸）**，不能用
   *   getBoundingClientRect（屏幕尺寸）。2026-08-25 真机踩到：
   *
   *     iframe 布局 1920×1080，屏幕 488×274，比值 0.254 = React Flow 的 zoom
   *
   *   高亮框画在 React Flow 的节点里，React Flow 已经会乘一次 zoom；这里再拿
   *   屏幕尺寸算比例等于**又除了一次**，框被缩两次。真机对过账：元素屏幕
   *   14×5，框画成 4×1（14×0.254≈3.5），正是这个平方误差。
   */
  const rect = frameRectToNodeRect(
    { left: r.left, top: r.top, width: r.width, height: r.height },
    { width: docW, height: docH },
    { width: frame.offsetWidth, height: frame.offsetHeight }
  );
  if (!rect) return null;
  const attrs = BINDING_ATTR_LIST.map(a =>
    el.hasAttribute(a) ? `${a}="${el.getAttribute(a)}"` : ""
  ).find(Boolean);
  return {
    pageId,
    path,
    rect,
    computed: snapshotComputed(el, doc.defaultView),
    block: blockIdentity(el),
    tag: el.tagName.toLowerCase(),
    title: elementTitle(
      el.tagName.toLowerCase(),
      el.textContent || "",
      attrs || ""
    ),
  };
}

/** 进板之后 iframe 才拿回点击权；没进板时手势层挡着。 */
interface CanvasCtx {
  enteredPageId: string | null;
  activePageId: string | null;
  source: ReturnType<typeof deriveBindingSource>;
  gates?: ActionGates;
  onAction?: (event: BindingActionEvent) => void;
  onHoverBinding?: SpecPageCanvasStageProps["onHoverBinding"];
  onSelect: (pageId: string) => void;
  onEnter: (pageId: string) => void;
  onNavigate: (pageId: string) => void;
  onOpenInPageView?: (pageId: string) => void;
  onBoardMenu: (pageId: string, x: number, y: number) => void;
  /** Ctrl/⌘+Click 选中画板里的某个元素（右侧面板变成它的编辑器）。
   *  null = 宿主没给 appId（这一轮还没落库），那就不接这条手势。 */
  onPickElement: ((picked: PickedElement | null) => void) | null;
  /** 当前选中的元素——画板据此画选中框（只画自己那一页的）。 */
  picked: PickedElement | null;
  /** 连线态：等着点第二块画板 */
  linkFrom: string | null;
  /** 连线态开着（画板边缘露出连线把手） */
  linkMode: boolean;
  /** 导出要拿到画板 DOM。挂载时登记，卸载时注销。 */
  registerBoardEl: (pageId: string, el: HTMLDivElement | null) => void;
  /** 素材高亮：点了素材卡，用到它的页面描边 */
  highlightPageIds: readonly string[];
  /** 刀 2：画板把量到的块矩形报上来，舞台据此造块节点。 */
  onBlockRects: (pageId: string, snap: BlockRectSnapshot) => void;
  /** 块条带开着（块节点摊在画板右侧） */
  blocksShown: boolean;
  /** 刀 3：点中一块 → 右侧面板变成「这一块」。 */
  onPickBlock: (pageId: string, name: string) => void;
  /** 当前选中的那一块（跨页唯一的 key）。 */
  pickedBlockKey: string | null;
  /** 刀 4：选中一块时邻域点亮、其余压暗。没选中 = idle。 */
  impactFocus: ImpactFocus;
  /** 影响图上没有任何线的块。用来标「无影响」，不是「未计算」。 */
  islandKeys: ReadonlySet<string>;
  /** 点了素材卡：记下来给画板描边（"这张图哪几页在用"） */
  onSelectAsset: (asset: CanvasAsset) => void;
  /** 打开换图面板。null = 宿主没给 appId，卡片上就不摆这颗按钮。 */
  onReplaceAsset: ((asset: CanvasAsset) => void) | null;
}

const CanvasContext = React.createContext<CanvasCtx | null>(null);

/** 无模型时的空数据源。`deriveBindingSource(null, null)` 本身就是纯的，
 *  比在渲染处手搓一个 `{} as never` 强——那种写法一旦 BindingSource 加字段
 *  就会在运行期而不是编译期炸。 */
const EMPTY_SOURCE = deriveBindingSource(null, null);

/**
 * fitView 的留白。⚠ React Flow 把它当**外接盒的乘数**（bounds × (1+padding)），
 * 不是视口的百分比——写 0.14 是"盒子四周各留 7% 盒宽"，不是"视口各留 14%"。
 * 列数已经按容器长宽比配过了，两轴都贴得紧，留白直接吃缩放，所以取小值。
 */
const FIT_PADDING = 0.08;

/** 连线的两种来源用两种画法：派生=灰实线，手画=蓝虚线。 */
const EDGE_STYLE = {
  /* ⚠ 线宽跟影响线统一到 3（ComfyUI 的 connections_width）：同一张画布上
     两套粗细会让人以为是两种东西。2026-08-28 随配色一起调的。 */
  dataflow: { stroke: "#94a3b8", strokeWidth: 3 },
  manual: { stroke: "#1677ff", strokeWidth: 3, strokeDasharray: "8 6" },
} as const;

/**
 * 刀 4 的影响线配色与粗细。**分色分虚实是功能，不是审美。**
 *
 * ⚠ 真联动（跳转/动作/素材）是"改了运行时那边真的跟着变"；仅同源（读同一个
 *   实体.字段）是"改数据模型会一起变，但改这一块的文案另一块不会跟着变"。
 *   画成一样的线，用户会以为改一处自动同步了 —— 这是风险台账 #03。
 *
 * ## 色值抄的是谁（2026-08-28 第二轮）
 *
 * ComfyUI_frontend `src/assets/palettes/light.json` 的 `node_slot`
 * （本地 clone，commit 5d24e4e）。⚠ 抄的是它的**浅色主题**那一份，不是
 * 截图里那套深色的——我们画布是浅底，深色主题的色值搬过来会偏暗发脏。
 *
 *     CLIP #FFA726  CONDITIONING #EF5350  IMAGE #42A5F5
 *     LATENT #AB47BC  MODEL #7E57C2  VAE #FF7043  NOISE #B0B0B0
 *
 * 它们全是 **Material 400 档**：饱和、中明度，浅底深底都读得出。
 * 上一版我用的是 200~300 档的淡色（#a5b4fc / #e2e8f0），白底上直接看不见
 * ——用户原话"太淡了，灰色都看不出来了，颜色也有些丑"。
 *
 * 粗细同样照它：`LGraphCanvas.connections_width = 3`。上一版真联动 2px、
 * 同源 1px，1px 在缩放后就是一条断续的灰点。
 *
 * ⚠ 但**不照抄它的"全部同宽同实线"**：ComfyUI 的每条线都是平级的数据流，
 *   我们这儿有"真联动 vs 仅同源"的分级，虚实仍然要留着当区分。
 *   同源那档给 6/6 的长虚线而不是 2/6 的点——点在缩放后会碎成灰尘。
 */
const IMPACT_STYLE: Record<
  ImpactEdgeKind,
  { stroke: string; strokeWidth: number; strokeDasharray?: string }
> = {
  nav: { stroke: "#42A5F5", strokeWidth: 3 },
  action: { stroke: "#FF7043", strokeWidth: 3 },
  asset: { stroke: "#AB47BC", strokeWidth: 3 },
  field: { stroke: "#5C6BC0", strokeWidth: 2, strokeDasharray: "6 6" },
};

/**
 * 归属线（块 → 它所属的整页）的画法。
 *
 * ⚠ 比所有影响线都**更轻**：块本来就摆在它那张画板旁边，归属靠位置已经
 *   读得出来，这条线只是确认。做重了会跟真正要看的影响线抢注意力。
 * ⚠ 但"更轻"不等于"看不见"（2026-08-28 修）：上一版 #e2e8f0 在白底上
 *   就是没有。改用 ComfyUI 浅色主题里那个中性灰 #B0B0B0（它给 NOISE 用的），
 *   轻但确实在。
 */
const OWNERSHIP_STYLE = {
  stroke: "#B0B0B0",
  strokeWidth: 2,
  strokeDasharray: "2 6",
} as const;

/**
 * 画布上**所有**线的描边色，集中一处。
 *
 * ⚠ 存在的唯一理由是那条反向判据：**任何两种线不许同色**。
 *   2026-08-28 就是栽在这儿——归属线和同源字段各自定义在两个地方，
 *   都写了 #cbd5e1，没有任何一处能看出它们撞了。
 *   加线的种类时把颜色加进这里，判据会替你挡住撞色。
 */
export const ALL_EDGE_STROKES: Record<string, string> = {
  boardDataflow: EDGE_STYLE.dataflow.stroke,
  boardManual: EDGE_STYLE.manual.stroke,
  ownership: OWNERSHIP_STYLE.stroke,
  impactNav: IMPACT_STYLE.nav.stroke,
  impactAction: IMPACT_STYLE.action.stroke,
  impactAsset: IMPACT_STYLE.asset.stroke,
  impactField: IMPACT_STYLE.field.stroke,
};

const IMPACT_LABEL: Record<ImpactEdgeKind, string> = {
  nav: "跳转",
  action: "同一动作",
  asset: "共用素材",
  field: "同源字段",
};

/**
 * 画板本体。
 *
 * ⚠ 这里**不做任何缩放**：宽高就是设计分辨率原值，缩放整个交给 React Flow
 *   的 viewport transform。两级缩放叠加会让放大后的字比页面档还糊
 *   （见 canvas-board-layout 头注的"三套坐标"）。
 */
function ArtboardNode({ data }: NodeProps<Node<ArtboardData>>) {
  /** 按住 Ctrl 滑过时高亮的那个元素（只高亮，不选中）。 */
  const [hover, setHover] = React.useState<PickedElement | null>(null);
  const ctx = React.useContext(CanvasContext);
  const { page, box, index, label, fillPhone } = data;

  // 自己订阅视口：只有**这一块**的可见性翻面时才重渲染，平移不会把
  // 所有画板一起拖着重渲染。选择器返回布尔值，React Flow 的浅比较即够。
  const inRange = useStore(
    React.useCallback(
      s =>
        shouldMountBoard(
          box,
          { x: s.transform[0], y: s.transform[1], zoom: s.transform[2] },
          { width: s.width, height: s.height }
        ),
      [box]
    )
  );
  const zoom = useStore(s => s.transform[2]);

  // 挂上就不再卸（见文件头注）。用 ref 记住"曾经进过视口"。
  const everInRange = React.useRef(false);
  if (inRange) everInRange.current = true;
  const mounted = everInRange.current;

  const entered = ctx?.enteredPageId === page.pageId;
  const isActive = ctx?.activePageId === page.pageId;

  /* 刀 1：量这一块画板上每一块的方框。
     ⚠ `mounted` 传进去当 enabled：没进过视口的画板里根本没有 iframe，
       量了也是空——更要紧的是别给它装 ResizeObserver。 */
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const blocks = useBlockRects(hostRef, page.pageId, page.html, { width: box.w, height: box.h }, mounted);

  /* 把快照报给舞台（刀 2 要在画板外面造块节点，那里够不到 iframe）。
     ⚠ 进 effect 而不是渲染期直接调：渲染期 setState 别人的组件会触发
       React 的 "Cannot update a component while rendering" 告警，
       而且真机上会多刷一帧。 */
  const reportBlocks = ctx?.onBlockRects;
  React.useEffect(() => {
    reportBlocks?.(page.pageId, blocks.snapshot);
  }, [reportBlocks, page.pageId, blocks.snapshot]);
  const isLinkSource = ctx?.linkFrom === page.pageId;
  const highlighted = ctx?.highlightPageIds.includes(page.pageId) ?? false;
  const impactLit =
    ctx?.impactFocus.active === true &&
    ctx.impactFocus.litKeys.has(page.pageId);
  const labelScale = labelCounterScale(zoom);

  const outline = entered
    ? "3px solid #1677ff"
    : isLinkSource
      ? "3px dashed #1677ff"
      : highlighted
        ? "3px solid #C05621"
        : impactLit
          ? "2px dashed #42A5F5"
          : isActive
            ? "2px solid #1677ff"
            : "none";

  return (
    <div
      className="relative"
      style={{ width: box.w, height: box.h }}
      data-testid="sliderule-canvas-artboard"
      data-page-id={page.pageId}
      data-entered={entered ? "1" : undefined}
      data-mounted={mounted ? "1" : "0"}
      /* 刀 1 的可观测点（照 data-mounted 的先例）：量到几块、这块画板是不是
         当前选中。真机判据靠它区分"没量到"和"量到了但没画"——这两种在
         截图上长得一模一样。 */
      data-block-rects={blocks.snapshot.rects.length}
      data-board-active={isActive || entered ? "1" : "0"}
      data-impact-lit={impactLit ? "1" : "0"}
      ref={el => {
        /* ⚠ 两个消费者共用这一个 ref：导出要拿画板 DOM，刀 1 要从这儿往下
           找 iframe。写成两个 ref 属性后一个会覆盖前一个（React 的既定行为），
           表现是导出正常而块框一个都不出现——静默。 */
        hostRef.current = el;
        ctx?.registerBoardEl(page.pageId, el);
      }}
    >
      {/* 连线把手（四条边各一个）。
          ⚠ **永远渲染**，不能"连线态才挂"——React Flow 要靠 handle 的位置
          算边的起终点，把手不在时已有的边会直接画不出来（控制台 #008）。
          所以是常挂 + 连线态才可见可点。

          ⚠ 2026-08-25 真机：`zIndex` 那条**不是样式，是功能**。手势层是
          `absolute inset-0`，在 DOM 里排在把手后面，同一层里后来者居上——
          于是把手看得见（opacity 已经是 1）却**按不下去**，从把手拖出去
          什么都不发生。判据 L1「把手可见」全绿，L2「拖出一条连线」失败，
          又是一次"看着有、其实没通电"。把手必须浮在手势层之上。

          ⚠ 四个都声明成 type="source"，靠 <ReactFlow connectionMode="loose">
          让它们同时能当终点。声明成 source/target 各四个（八个重叠的把手）
          的话，命中的是哪一个取决于 DOM 顺序，拖上去时好时坏。 */}
      {(
        [
          ["t", Position.Top, "translate(-50%, -50%)"],
          ["r", Position.Right, "translate(50%, -50%)"],
          ["b", Position.Bottom, "translate(-50%, 50%)"],
          ["l", Position.Left, "translate(-50%, -50%)"],
        ] as const
      ).map(([id, pos, shift]) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={pos}
          isConnectable={ctx?.linkMode ?? false}
          style={{
            width: 14,
            height: 14,
            background: "#fff",
            border: "3px solid #1677ff",
            opacity: ctx?.linkMode ? 1 : 0,
            pointerEvents: ctx?.linkMode ? "auto" : "none",
            zIndex: 10,
            transform: `${shift} scale(${labelCounterScale(zoom)})`,
          }}
        />
      ))}

      {/* 标题条：画板**上方**，反缩放保持可读（Figma/tldraw 同款——画板名
          属于编辑器 chrome，不属于被缩放的内容）。 */}
      <div
        className="absolute left-0 flex origin-bottom-left cursor-default select-none items-center gap-1.5 overflow-hidden whitespace-nowrap"
        style={{
          bottom: box.h + 10,
          transform: `scale(${labelScale})`,
          // 反缩放的标签必须夹宽度，否则缩小时相邻画板的标题会压在一起
          // （见 labelMaxCssWidth 的注释——素材卡上先炸的，画板只是宽所以晚炸）。
          maxWidth: labelMaxCssWidth(box.w, zoom),
        }}
        onDoubleClick={e => {
          e.stopPropagation();
          ctx?.onEnter(page.pageId);
        }}
      >
        <span
          className={`min-w-0 truncate text-[13px] font-medium ${
            isActive ? "text-[#1677ff]" : "text-stone-500"
          }`}
          data-testid="sliderule-canvas-artboard-label"
        >
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-stone-400">
          {index + 1}
        </span>
        {page.missing ? (
          <span
            className="rounded bg-[#FDF6F1] px-1.5 py-px text-[10px] font-medium text-[#C05621]"
            data-testid="sliderule-canvas-artboard-missing"
          >
            未通过校验
          </span>
        ) : page.bound ? null : (
          <span className="rounded bg-[#f4f4f5] px-1.5 py-px text-[10px] text-stone-400">
            尚未接数据
          </span>
        )}
        {entered ? (
          <span className="rounded bg-[#1677ff] px-1.5 py-px text-[10px] font-medium text-white">
            已进入 · Esc 退出
          </span>
        ) : null}
        {isLinkSource ? (
          <span className="rounded bg-[#1677ff] px-1.5 py-px text-[10px] font-medium text-white">
            连线起点 · 点另一块连上
          </span>
        ) : null}
      </div>

      {/* 画板白底。选中描边用品牌蓝，跟顶栏「透视」「点选编辑」同一支。 */}
      <div
        className="absolute inset-0 overflow-hidden bg-white"
        style={{
          borderRadius: 6,
          boxShadow: STAGE_FRAME_FLAT,
          outline,
          outlineOffset: 2,
        }}
      >
        {mounted ? (
          <HtmlAppSurface
            key={page.pageId}
            html={page.html}
            fillPhone={fillPhone}
            className="bg-white"
            source={ctx?.source ?? EMPTY_SOURCE}
            gates={ctx?.gates}
            onAction={ctx?.onAction}
            onNavigate={pid => ctx?.onNavigate(pid)}
            onHoverBinding={entered ? ctx?.onHoverBinding : undefined}
            /* 刀 1 的量测时机：applyBindings 的下一行。⚠ 别挪到 onLoad——
               那时候表格里只有模板行（见 use-block-rects 头注）。 */
            onReport={blocks.onSurfaceReport}
          />
        ) : (
          /* 还没进视口：**画轮廓，不留白**。剔除是性能手段，不是可见性判定
             ——缩到看全景时正是最需要看见每块画板在哪的时候。 */
          <div
            className="flex h-full w-full items-center justify-center bg-[#fafafa]"
            data-testid="sliderule-canvas-artboard-placeholder"
          >
            <span className="text-[64px] font-medium text-stone-200">
              {label.slice(0, 8)}
            </span>
          </div>
        )}
      </div>

      {/* 手势层（Onlook 同款）：没进板时盖住 iframe，让滚轮/拖拽落在父文档里
          冒泡给 React Flow。进板之后撤掉，iframe 拿回点击权。
          ⚠ 撤这一层等于把画布手势让给 iframe——这是**双击进板**才该发生的，
            别为了"点着方便"默认撤掉。 */}
      {entered ? null : (
        <div
          className="absolute inset-0"
          data-testid="sliderule-canvas-gesture-shield"
          onClick={e => {
            e.stopPropagation();
            /* Ctrl/⌘ + 单击 = **选中**这个元素，右侧面板变成它的编辑器。
               留在画布上，不跳去页面档（2026-08-25 用户裁决，参照 TRAE）。 */
            if (ctx?.onPickElement && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              ctx.onPickElement(pickElementAtPoint(e, page.pageId));
              return;
            }
            ctx?.onSelect(page.pageId);
          }}
          /*
           * 按住 Ctrl 滑过 = **只高亮不选中**（用户原话："鼠标没有按下去的
           * 时候选不中，只是纯高亮"）。GrapesJS 把 hover 和 select 做成两个
           * 独立的 canvas spot，就是这个道理——两种状态不能合成一个。
           *
           * ⚠ 同一个元素不重复 setState（samePick 收敛），否则一路滑过去
           *   会刷出几百次重渲，画布上还挂着 iframe。
           */
          onMouseMove={e => {
            if (!ctx?.onPickElement) return;
            if (!(e.ctrlKey || e.metaKey)) {
              setHover(prev => (prev ? null : prev));
              return;
            }
            const found = pickElementAtPoint(e, page.pageId);
            setHover(prev => (samePick(prev, found) ? prev : found));
          }}
          onMouseLeave={() => setHover(prev => (prev ? null : prev))}
          onDoubleClick={e => {
            e.stopPropagation();
            ctx?.onEnter(page.pageId);
          }}
          title={
            ctx?.onPickElement
              ? "单击选中 · 拖动重排 · 空格+拖动平移 · 双击进入交互 · Ctrl/⌘ 滑过高亮、单击改它 · 右键更多"
              : "单击选中 · 拖动重排 · 空格+拖动平移 · 双击进入交互 · 右键更多"
          }
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            ctx?.onBoardMenu(page.pageId, e.clientX, e.clientY);
          }}
        />
      )}

      {/*
        高亮层（GrapesJS 的 canvas spots 同款：hover 和 select 是两个独立的
        spot，不是一个状态的两种样式）。

        ⚠ 画在**节点里**：画布的平移/缩放由 React Flow 的 transform 自动带走，
          这里只剩画板自身的缩放要算（frameRectToNodeRect）。GrapesJS 要算
          四项是因为它的 spots 容器挂在画布外面。

        ⚠ pointer-events-none 是**功能**：这两个框盖在手势层上面，漏了它
          鼠标一移上去就把 mousemove/click 全吃掉——高亮会闪、点不中。
      */}
      {/* 块框（刀 1）。⚠ 只在这块画板被选中/进板时画：六页十几块全画满
          虚线会糊成一片，而"这一页由哪几块拼成"本来就是看某一页时才问的问题。
          刀 4 的影响面点亮走另一条路（跨页常驻），不走这里。 */}
      {isActive || entered
        ? blocks.snapshot.rects.map(b => (
            <BlockSpot key={b.name} block={b} active={entered} />
          ))
        : null}
      {hover && !samePick(hover, ctx?.picked ?? null) ? (
        <ElementSpot rect={hover.rect} kind="hover" label={blockTag(hover)} />
      ) : null}
      {ctx?.picked && ctx.picked.pageId === page.pageId ? (
        <ElementSpot
          rect={ctx.picked.rect}
          kind="select"
          label={pickTitle(ctx.picked)}
        />
      ) : null}
    </div>
  );
}

/** 块节点的数据。 */
interface BlockNodeData extends Record<string, unknown> {
  box: BlockNodeBox;
  page: SpecPageLive;
  /** 画板尺寸（整页原尺寸）——裁剪要按它铺整页。 */
  board: { w: number; h: number };
  /** 真渲染还是静态卡（由 block-node-fit 那道阶梯定）。 */
  live: boolean;
  kindLabel: string;
  /** `data-block-kind`，给底色用（跟 Python 的 BLOCK_KINDS 一字不差）。 */
  kind: string;
}

/**
 * 一个块节点：**整页真渲染，裁到那一块**。
 *
 * ⚠ 为什么不单独渲染那一块的 HTML：块的 Tailwind 类来自页面注入的样式表，
 *   布局还依赖父级 flex/grid。抠出来单渲会变形——变形之后它仍然"是一张卡片"，
 *   没有任何报错，只是长得跟页面里不一样。所以只能整页渲染 + 开一个洞。
 *
 * ⚠ 不可拖（用户裁决「页组框能拖、块不能拖」）。块没有自己的位置，它的位置
 *   是画板位置推出来的——可拖就得存档、就得处理"画板挪了块没挪"的漂移。
 *   `draggable: false` 写在节点上，这里再挂一层 nodrag 兜住内部元素。
 */
function BlockNode({ data }: NodeProps<Node<BlockNodeData>>) {
  const ctx = React.useContext(CanvasContext);
  const zoom = useStore(s => s.transform[2]);
  const inv = zoom > 0 ? 1 / zoom : 1;
  const { box, page, board, live, kindLabel, kind } = data;
  const tint = blockKindTint(kind);
  const showDetail = shouldDrawBlockDetail(zoom);
  /* ⚠ 选中态以**块面板**的选择为准，不看元素选择：这两件事经常不是同一块
     （Ctrl+点某个单元格选中的是元素，块面板选中的是整块）。 */
  const selected = ctx?.pickedBlockKey === box.key;
  const focus = ctx?.impactFocus ?? IMPACT_FOCUS_IDLE;
  const dimmed = impactNodeDimmed(focus, box.key);
  const island = ctx?.islandKeys.has(box.key) ?? false;
  /* 孤岛标记：选中时必须看见（风险 #05）；放大到能读字时也标，
     全景缩到 17% 不标——那时候字比节点还大，会糊成一片。 */
  const showIsland = island && (selected || showDetail);

  return (
    <div
      className="nodrag relative"
      /* ⚠ `pointerEvents: "all"` 是**功能不是样式**：React Flow 对
         既不可选也不可拖的节点整体加 `pointer-events: none`，于是下面那个
         onPointerDown 一次都收不到——真机上表现为"点块没反应、面板不出来"，
         而节点渲染完全正常、控制台一声不吭。 */
      style={{
        width: box.w,
        height: box.h,
        pointerEvents: "all",
        /* cytoscape semitransp：压暗无关块，邻域跳出来。没选中时全是 1。 */
        opacity: dimmed ? IMPACT_DIM_NODE : 1,
      }}
      data-testid="sliderule-canvas-block-node"
      /* ⚠ 标题条砍掉之后，名字在画面上没有落脚点了。原生 title 是零重量的
         补偿：悬停一下认得出是哪一块，不占一个像素。全名在右侧面板里。 */
      title={`${kindLabel}·${box.name}`}
      data-block-name={box.name}
      data-block-page={box.pageId}
      data-block-live={live ? "1" : "0"}
      data-block-truncated={box.truncated ? "1" : "0"}
      data-block-selected={selected ? "1" : "0"}
      data-block-dimmed={dimmed ? "1" : "0"}
      data-block-island={island ? "1" : "0"}
      /* ⚠ 块节点 `selectable:false`（不进 React Flow 的选择集，避免它跟画板
         抢选中态），所以点选自己接。onPointerDown 而不是 onClick——
         React Flow 会在 pointerdown 阶段吃掉一部分事件。 */
      onPointerDown={e => {
        e.stopPropagation();
        ctx?.onPickBlock(box.pageId, box.name);
      }}
    >
      {/* 四条边各一个落点。
          ⚠ **必须常挂**，不能"要连线才挂"——React Flow 靠把手的位置算边的
            起终点，把手不在时这条边直接画不出来（控制台 #008，画板那边
            头注记过同一个坑）。这里不给用户连，所以 isConnectable=false。
          ⚠ **四条边都要**，不能只留左边（2026-08-28 改）：只有左把手时，
            块↔块的影响线两端都从左侧出入，贝塞尔的两个控制点都朝左，
            线就往左兜一个大圈——真机截图上就是几十条横扫全场的长弧。
            ComfyUI 的 pathRenderer.calculateControlPoints 是按**出入方向**
            给控制点偏移的（getDirectionOffset），方向对了曲线才自然。
            边由 pickLinkSides 按相对位置挑，跟画板连线同一套规则。 */}
      {(
        [
          ["t", Position.Top],
          ["r", Position.Right],
          ["b", Position.Bottom],
          ["l", Position.Left],
        ] as const
      ).map(([id, pos]) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={pos}
          isConnectable={false}
          style={{
            width: 1,
            height: 1,
            minWidth: 1,
            minHeight: 1,
            background: "transparent",
            border: "none",
            opacity: 0,
          }}
        />
      ))}
      {/*
        ## 卡片：圆角 + 分层投影，**没有标题条**

        2026-08-28 走了三步才到这儿，每一步都是用户看完真机说的：

          一、"太平了"     → 照 ComfyUI 的 RenderShape.CARD 补了
                             标题条 + 分隔线 + 主体 + 投影
          二、"我们是区块，不是属性面板"
                           → 按类型分色的标题条读起来是分类目录，改成中性色
          三、"直接去掉标题条"

        ⚠ 砍标题条**不是**回到最早那个白方块。"太平"是两件事叠出来的：
          没有层次，以及标签因为 LOD 阈值算错从来没显示过（见
          blockDetailZoomThreshold 头注）。层次这半是圆角 + 分层投影给的，
          跟标题条无关，所以留着。

        ⚠ 块可以没有标题，是因为它跟 ComfyUI 的节点不是一回事：它画的是
          **抽象算子**，不写名字就认不出；我们这儿是**页面那一块的真渲染**，
          内容自己就是名字。名字要用的时候在右侧面板里。
          这里只挂一个原生 title——鼠标停一下能看到全名，画面上零重量。

        ⚠ 排布那边跟着删了 labelBand（block-node-layout）。这两处是同一件事
          的两半：只删一边，整条块带会整体错开 56 个单位，而画面上看着只是
          "跟画板没对齐"，不报错。
      */}
      <div
        className="absolute inset-0 overflow-hidden"
        data-testid="sliderule-canvas-block-card"
        style={{
          borderRadius: BLOCK_CHROME.radius,
          boxShadow: BLOCK_CHROME.shadow,
          background: "#fff",
          /* ⚠ 选中框**反缩放**：它是交互反馈不是节点外观，画布单位的 2px
             在 17% 全景下只有 0.34 屏幕像素，等于没有。同 ElementSpot。 */
          outline: selected ? `${2 * inv}px solid #7c3aed` : "none",
          outlineOffset: `${1 * inv}px`,
        }}
      >
        {live ? (
          /*
           * 整页铺进来，再往左上挪，那一块正好落在洞口。
           *
           * ⚠ 内层盒子必须是**页面原尺寸**（1920×1080），缩放只走 transform。
           *   2026-08-27 真机踩过：第一版写成 `board.w * scale`，等于改
           *   iframe 的尺寸 —— 文档宽度一变，页面就**按新宽度重新响应式布局**，
           *   块在新布局里的位置跟量测那一刻完全不同，裁出来的是别处的内容
           *   （标着「表格·物资台账出入库实时流水」的节点里显示的是壳里的
           *   用户下拉）。块框位置还是对的，所以两件事各自都"看着正常"。
           *
           *   这跟 canvas-board-layout 头注那条是同一条纪律：画板在画布坐标
           *   里就是原尺寸，缩放整个交给 transform。
           *
           * ⚠ transform 的顺序不能反：`scale(s) translate(-left,-top)`，
           *   CSS 右结合 —— 先 translate（设计坐标）再 scale，最终位移正好
           *   是 -left*s。写成 translate 在前会少乘一次 scale。
           */
          <div
            style={{
              width: board.w,
              height: board.h,
              transform: `scale(${box.crop.scale}) translate(${-box.crop.left}px, ${-box.crop.top}px)`,
              transformOrigin: "top left",
              pointerEvents: "none",
            }}
          >
            <HtmlAppSurface
              key={`${box.pageId}:blocknode`}
              html={page.html}
              source={ctx?.source ?? EMPTY_SOURCE}
              gates={ctx?.gates}
              className="bg-white"
            />
          </div>
        ) : (
          /* 降级：如实说"这一块没在真渲染"，不摆一个假的灰块冒充内容。
             ⚠ 没有内容和"内容是灰的"是两回事（同 AssetNode 那条纪律）。 */
          /*
           * ⚠ 卡片**里面**的字不反缩放（外面那行标签才反缩放）。
           *   2026-08-27 真机：这里原本写了 `fontSize: 12 * inv`，17% 全景下
           *   等于 70 画布单位，而矮块的节点只有三四十单位高——字直接溢出去
           *   压住下一块。节点内容本来就该跟画布一起缩，这跟画板里的 iframe
           *   一个道理。
           */
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden"
            data-testid="sliderule-canvas-block-node-static"
            /* ⚠ 按类型上色（抄 ComfyUI 低质量档"保形状保颜色、只丢细节"）。
               上一版是统一的浅灰，全景下 19 张静态卡就是一堆白方块，
               看着像加载坏了。上色之后至少读得出"这一页由几张表、
               几个指标、一个图表拼成"。 */
            style={{ background: tint.fill }}
          >
            <span style={{ fontSize: 28, color: tint.ink, opacity: 0.75 }}>
              {kindLabel}
            </span>
            <span
              style={{ fontSize: 20, color: tint.ink, opacity: 0.45 }}
              className="px-2 text-center leading-tight"
            >
              块太多，这一块暂未实时渲染
            </span>
          </div>
        )}

        {/* ⚠ 截断要**如实说**。这是节点上**仅剩的一处文字**，LOD 阈值就是
            从它的字号反推的（见 blockDetailZoomThreshold）。 */}
        {box.truncated && showDetail ? (
          <span
            className="pointer-events-none absolute rounded text-white"
            data-testid="sliderule-canvas-block-truncated"
            style={{
              right: BLOCK_CHROME.radius,
              bottom: BLOCK_CHROME.radius,
              padding: `${BLOCK_CHROME.hintFont * 0.15}px ${BLOCK_CHROME.hintFont * 0.4}px`,
              fontSize: BLOCK_CHROME.hintFont,
              lineHeight: 1,
              background: "rgba(15,23,42,0.72)",
            }}
          >
            只显示上半截
          </span>
        ) : null}
        {showIsland ? (
          /* ⚠ 必须写「无影响」，不许空着或写「未计算」（风险 #05）。
             选中孤岛时邻域是空的，不标这句话用户会以为点亮坏了。 */
          <span
            className="pointer-events-none absolute rounded text-white"
            data-testid="sliderule-canvas-block-island"
            style={{
              left: BLOCK_CHROME.radius,
              bottom: BLOCK_CHROME.radius,
              padding: `${BLOCK_CHROME.hintFont * 0.15}px ${BLOCK_CHROME.hintFont * 0.4}px`,
              fontSize: BLOCK_CHROME.hintFont,
              lineHeight: 1,
              background: "rgba(15,23,42,0.72)",
            }}
          >
            无影响
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 素材卡：这套应用引用到的一张图。
 *
 * ⚠ 图是**外链**（真机上多为 placehold.co / flickr）。加载不出来时如实显示
 *   "加载不出来"，不摆一个灰方块假装是图——用户会以为图本身就长那样。
 *   `onError` 那条是这个功能唯一的失败态，别省。
 */
function AssetNode({ data }: NodeProps<Node<AssetData>>) {
  const ctx = React.useContext(CanvasContext);
  const { asset, w, h } = data;
  const zoom = useStore(s => s.transform[2]);
  const [failed, setFailed] = React.useState(false);
  /** 图的**真实像素尺寸**。设计师最想知道的一件事：一张 40×40 的图是不是被
   *  拉成了 banner。只有加载成功才有，加载不出来就不显示（不编）。 */
  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(null);
  const labelScale = labelCounterScale(zoom);
  const labelWidth = labelMaxCssWidth(w, zoom);
  /**
   * 窄到放不下整行时只留**名字**（外加一个占位图小点）。
   *
   * ⚠ 2026-08-25 真机第二次踩：加了宽度上限之后不炸了，但截断把文件名整个
   *   吃掉，三张卡只剩「占位图 5页」「占位图 1页」——**标签还在、信息没了**。
   *   夹宽度只解决了"不重叠"，没解决"读得出来"。名字是识别用的，最后才能丢。
   */
  const compact = labelWidth < 170;
  /* ⚠ 17% 缩放下 1/zoom ≈ 6，整颗「换图」会盖住卡片。Figma 缩略图
     上的动作不跟着反缩放到比图还大——夹住上限，窄卡只留图标。 */
  const btnScale = Math.min(labelScale, 2.15);

  return (
    <div
      className="group/asset relative"
      /*
       * ⚠ 2026-08-25 用户报"换图点了没反应"，真机查出来的根因：
       *   素材节点建的时候写了 `selectable: false`，React Flow 据此给整个
       *   `react-flow__node-asset` 挂 **pointer-events:none**（它按"这个节点
       *   可不可交互"逐个决定；画板节点没写 selectable:false，所以是 all）。
       *   于是这张卡**整个点不动**——换图按钮点不了，点卡片高亮引用页也点不了。
       *   按钮画得好好的、位置也对，`elementFromPoint` 拿到的却是
       *   react-flow__pane。
       *
       *   这里显式把命中打开：子元素的 pointer-events:auto 能盖过父层的 none。
       *   不去掉 `selectable: false` —— 那会把 React Flow 的选中语义
       *   （选中框、Delete 键删节点）一并带进来，不是我们要的。
       *
       * ⚠ 判据教训：smoke 里那几条用的是 `btn.click()`（DOM 调用），**绕过命中
       *   测试**，所以一直是绿的。这类"点得到吗"的判据必须走真实鼠标坐标。
       */
      style={{ width: w, height: h, pointerEvents: "auto" }}
      data-testid="sliderule-canvas-asset"
      data-asset-url={asset.url}
      data-placeholder={asset.placeholder ? "1" : "0"}
      data-natural={dims ? `${dims.w}x${dims.h}` : undefined}
    >
      <div
        className="absolute left-0 flex origin-bottom-left select-none items-center gap-1.5 overflow-hidden whitespace-nowrap"
        style={{
          bottom: h + 8,
          transform: `scale(${labelScale})`,
          // ⚠ 这一行是 2026-08-25 真机截图上"三张素材卡的标签糊成一坨"的修复。
          //   素材卡只有 420 画布 px，适应画布时约 76 屏幕 px，而反缩放后的
          //   标签是恒定屏幕尺寸（150px 量级）——不夹宽度必然互相压。
          maxWidth: labelWidth,
        }}
      >
        {asset.placeholder && compact ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#C05621]"
            title="占位图"
            aria-hidden
          />
        ) : null}
        <span
          className="min-w-0 truncate text-[12px] font-medium text-stone-500"
          data-testid="sliderule-canvas-asset-label"
        >
          {asset.label}
        </span>
        {compact ? null : (
          <>
            {dims ? (
              <span
                className="shrink-0 font-mono text-[11px] tabular-nums text-stone-400"
                data-testid="sliderule-canvas-asset-dims"
                title="这张图的真实像素尺寸"
              >
                {dims.w}×{dims.h}
              </span>
            ) : null}
            {asset.placeholder ? (
              /* 占位图是**如实告警**：交付前这些图得换掉。真机团购那趟
                 3 张去重后的图全是占位图，一页一页翻根本看不出来。 */
              <span
                className="shrink-0 rounded bg-[#FDF6F1] px-1.5 py-px text-[10px] font-medium text-[#C05621]"
                data-testid="sliderule-canvas-asset-placeholder-badge"
              >
                占位图
              </span>
            ) : null}
            <span className="shrink-0 text-[11px] text-stone-400">
              {asset.pageIds.length} 页
            </span>
          </>
        )}
      </div>

      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl bg-[#f7f8fa]"
        style={{ boxShadow: STAGE_FRAME_FLAT }}
        title={asset.url}
        onClick={e => {
          e.stopPropagation();
          ctx?.onSelectAsset(asset);
        }}
      >
        {failed ? (
          /* ⚠ 加载不出来要**说出来**，不摆一个灰方块假装图本身就长那样。
             外链图（placehold.co / flickr）在内网或断网环境下常态失败。 */
          <div
            className="flex flex-col items-center gap-3 px-4 text-center text-stone-400"
            data-testid="sliderule-canvas-asset-failed"
          >
            <ImageOff style={{ width: 56, height: 56 }} />
            <span className="text-[22px] leading-7">加载不出来</span>
            <span className="max-w-full truncate font-mono text-[15px] text-stone-300">
              {asset.url}
            </span>
          </div>
        ) : (
          /* h/w-full + object-contain：小图会被放大到卡片大小。这不是"骗人"
             ——真实尺寸就印在标签上（dims），卡片只是预览。不放大的话
             一张 40×40 的图在 18% 缩放下是 7 个屏幕像素，等于没画。 */
          <img
            src={asset.url}
            alt={asset.label}
            referrerPolicy="no-referrer"
            className="h-full w-full object-contain p-2"
            onLoad={e => {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) {
                setDims({ w: el.naturalWidth, h: el.naturalHeight });
              }
            }}
            onError={() => setFailed(true)}
          />
        )}

        {/* 「换图」——反缩放，让它在任何缩放下都是可点的大小。
            ⚠ 没有 appId 时**不摆这颗按钮**，而不是摆一颗点了报错的：
              会话还没落库是正常状态（推演没跑完），不是错误。 */}
        {ctx?.onReplaceAsset ? (
          <button
            type="button"
            data-testid="sliderule-canvas-asset-replace-btn"
            title="换掉这张图"
            onClick={e => {
              e.stopPropagation();
              ctx.onReplaceAsset?.(asset);
            }}
            style={{
              transform: `scale(${btnScale})`,
              transformOrigin: "bottom right",
            }}
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-white/95 px-1.5 py-1 text-[11px] font-medium text-stone-600 shadow-[0_1px_3px_rgba(15,23,42,0.12)] ring-1 ring-black/[0.06] transition hover:text-stone-900"
          >
            <RefreshCw className="h-3 w-3" />
            {compact ? null : "换图"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 块相关的连线：走 ComfyUI 那套控制点（见 canvas-curve.ts 头注）。
 *
 * ⚠ 为什么不用 React Flow 自带的 `bezier`：它顺向时把控制点摆在**半程**
 *   （`0.5 * distance`，写死的），长线上就是又宽又平的懒弧；而它暴露的
 *   `curvature` 参数**只作用于逆向那一支**，调不动我们想调的地方。
 *   ComfyUI 是 `max(30, 欧氏距离 * 0.25)`，曲线贴着两点之间那条直线走，
 *   短、有方向感——那才是"节点图"的手感。
 *
 * ⚠ `pointer-events: none`：这些线不接受交互（用户连的线是另一条路径，
 *   走 React Flow 自带的边）。漏了它，线会盖住底下的块节点，点不中。
 */
function BlockCurveEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
}: EdgeProps): React.ReactElement {
  const { path } = buildCurvePath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <path
      id={id}
      d={path}
      fill="none"
      className="react-flow__edge-path"
      style={{ ...style, pointerEvents: "none" }}
    />
  );
}

const edgeTypes = { blockCurve: BlockCurveEdge };

const nodeTypes = { artboard: ArtboardNode, asset: AssetNode, block: BlockNode };

function CanvasInner({
  pages,
  running = false,
  model = null,
  runtime = null,
  gates,
  onAction,
  onHoverBinding,
  activePageId = null,
  onActivePageChange,
  onOpenInPageView,
  sessionId,
  appId,
  onPagesReplaced,
  metaTrailing = null,
}: SpecPageCanvasStageProps): React.ReactElement {
  const flow = useReactFlow();
  const [entered, setEntered] = React.useState<string | null>(null);
  const [linkMode, setLinkMode] = React.useState(false);
  const [linkFrom, setLinkFrom] = React.useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [menu, setMenu] = React.useState<{
    pageId: string;
    x: number;
    y: number;
  } | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [focusedAsset, setFocusedAsset] = React.useState<string | null>(null);

  const device = pages.find(p => p.device)?.device;
  const isPhone = device === "phone";
  // 机型只决定**用多大画布看**（观看态），跟后端那个 device 决定"生成什么"
  // 是两件事——见 SpecPageLiveStage 里同一条注释。
  const preset = findDevicePreset(loadDevicePresetId());
  const design = isPhone
    ? { w: preset.width, h: preset.height }
    : { w: specPageViewport(device).w, h: specPageViewport(device).h };

  /**
   * 舞台长宽比 → 列数（见 canvas-board-layout.boardColumns 的头注）。
   *
   * ⚠ 量的是**画布容器**，不是窗口：这块舞台被左侧对话栏挤过，窗口尺寸
   *   跟它没关系。拖分栏时列数会重排，这是有意的——同一份内容在窄舞台上
   *   收成两列、宽舞台上摊成三列，才看得最大。
   */
  const flowHostRef = React.useRef<HTMLDivElement | null>(null);
  const [hostAspect, setHostAspect] = React.useState(0);
  /**
   * 量化过的容器尺寸，只给"要不要重新适应画布"当依据。
   *
   * ⚠ 2026-08-28 修 D9 时补的。排版指纹原来只有 `节点数:列数`，于是
   *   **容器变了而列数没变**时画布不重新适应——真机上把窗口从 1600 缩到
   *   1100（容器 1305→1000，两次都是 2 列），fitView 一次都不跑，
   *   **两块画板留在视口外**。用户看到的就是"窗口一窄，两页没了"，
   *   而没有任何报错。
   *
   *   fitView 的结果完全依赖容器尺寸，所以容器尺寸本来就该在指纹里。
   *
   * ⚠ 量化到 32px 一档：拖窗口边框时每帧一个新尺寸会让 fitView 每帧跑一次
   *   （它自带 240ms 动画），画面会一路抽搐。32px 一档既跟得上真实的
   *   尺寸变化，又不会被拖动过程中的连续帧点着。
   * ⚠ 拖画板**不改容器尺寸**，所以这条不会把 D8 那条弄红。
   */
  const [hostSizeKey, setHostSizeKey] = React.useState("");
  React.useEffect(() => {
    const el = flowHostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (!r || !(r.width > 0) || !(r.height > 0)) return;
      // 量化到 0.02 一档再进 state：拖分栏时每帧一个新浮点会让排版
      // 每帧重算一次，节点位置抖动。列数本来就是离散的，这里跟着离散。
      const next = Math.round((r.width / r.height) * 50) / 50;
      setHostAspect(prev => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * 重新适应画布的触发源：**外层那一行**的尺寸（不是画布本身的）。
   *
   * ⚠ 观察哪个元素是这条的**全部**要害，2026-08-28 真机换过来的：
   *
   *   观察 `.react-flow` 本身的话，右侧面板（元素编辑 / 块面板 / 属性面板）
   *   一开就把它挤窄 → 指纹变 → fitView → **整个画布在用户点元素的那一刻
   *   平移一下**。判据 AD（高亮框逐像素落在元素上）当场红：框和元素只差在
   *   left 上、正好 128px——那不是框画错了，是画布在两次测量之间挪了。
   *
   *   面板是这一行里的**兄弟节点**：它一开只让画布变窄，**这一行的宽度不变**。
   *   所以观察这一行天然把"窗口/分栏真的变了"和"只是开了个面板"分开，
   *   而且不需要任何状态或时序判断。
   *
   * ⚠ 列数仍然跟着 `.react-flow` 的长宽比走（上面那个 observer）——列数该按
   *   **真实可用的画布区域**排，那是另一件事，别合并。
   *
   * ⚠ 量化到 32px 一档：拖窗口边框时每帧一个新尺寸会让 fitView（自带 240ms
   *   动画）每帧跑一次，画面一路抽搐。
   */
  const stageRowRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = stageRowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (!r || !(r.width > 0) || !(r.height > 0)) return;
      const sizeKey = `${Math.round(r.width / 32)}x${Math.round(r.height / 32)}`;
      setHostSizeKey(prev => (prev === sizeKey ? prev : sizeKey));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* 刀 2：块条带。默认**关**——一进画布先看整页，要拆开再点。
     ⚠ 声明必须在 `boxes` 那个 memo **之前**：boxes 要读 blocksShown 决定
       多留不多留列间距，放后面是 TDZ（"used before its declaration"）。 */
  const [blocksShown, setBlocksShown] = React.useState(false);
  /* 每页量到的块矩形，由 ArtboardNode 经 ctx.onBlockRects 报上来。 */
  const [blockRects, setBlockRects] = React.useState<
    Record<string, BlockRectSnapshot>
  >({});
  const onBlockRects = React.useCallback(
    (pageId: string, snap: BlockRectSnapshot) => {
      setBlockRects(prev =>
        prev[pageId] === snap ? prev : { ...prev, [pageId]: snap }
      );
    },
    []
  );

  /* 网格最宽的那一页有多宽——决定画板之间要多留多宽。
     ⚠ 必须跟 layoutBlockNodes **走同一个 plan**（blockGridSpan 内部就是
       planBlockGrid），各算各的话留的间距和实际网格宽对不上，网格会盖住
       右边那列画板。
     ⚠ 2026-08-28 从"列数 × 常数格宽"改成量真实网格宽：列宽现在各列各算
       （computeSize 口径），乘常数会留少。 */
  const maxBlockSpan = React.useMemo(
    () =>
      Object.values(blockRects).reduce(
        (n, snap) => Math.max(n, blockGridSpan(snap.rects, design.h)),
        0
      ),
    [blockRects, design.h]
  );

  const boxes = React.useMemo(
    () =>
      layoutArtboards(
        pages,
        design,
        hostAspect || undefined,
        /* 开着块网格时给每列多留一份网格宽，否则网格盖住右边那列画板。
           ⚠ 按**块最多的那一页**算：按平均值留，块多的那页照样盖住邻居。 */
        blocksShown ? blockGridExtraGapX(maxBlockSpan) : 0
      ),
    [pages, design.w, design.h, hostAspect, blocksShown, maxBlockSpan]
  );

  const pageIds = React.useMemo(() => pages.map(p => p.pageId), [pages]);
  const labelOf = React.useCallback(
    (p: { pageId: string; name?: string; html?: string }) => artboardLabel(p),
    []
  );
  const nameOf = React.useCallback(
    (pageId: string) => {
      const p = pages.find(x => x.pageId === pageId);
      return p ? artboardLabel(p) : pageId;
    },
    [pages]
  );

  /* --------------------------------------------------------- 连线 */

  const storageKey = manualLinksStorageKey(sessionId);
  const [manualLinks, setManualLinks] = React.useState<BoardLink[]>([]);
  // 换会话 / 页面清单变了都要重读一次存档并按新清单过滤（存档里可能有指向
  // 已经不存在页面的线——那是用户浏览器里躺着的旧数据，永远会有）。
  React.useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey);
    } catch {
      /* 隐私模式：连线只在本次会话内有效，功能本身照常 */
    }
    setManualLinks(readManualLinks(raw, pageIds));
  }, [storageKey, pageIds]);

  const persistManual = React.useCallback(
    (next: BoardLink[]) => {
      setManualLinks(next);
      try {
        localStorage.setItem(storageKey, writeManualLinks(next));
      } catch {
        /* 存不下就只在本次会话内有效，不影响画布 */
      }
    },
    [storageKey]
  );

  const dataflowLinks = React.useMemo(
    () => deriveDataflowLinks(model, pageIds),
    [model, pageIds]
  );
  const links = React.useMemo(
    () => [...dataflowLinks, ...manualLinks],
    [dataflowLinks, manualLinks]
  );

  const connect = React.useCallback(
    (from: string, to: string) => {
      const next = addManualLink(manualLinks, from, to);
      if (next === manualLinks) {
        setToast(from === to ? "同一块画板不用连自己" : "这条线已经有了");
        return;
      }
      persistManual(next as BoardLink[]);
      setToast(`已连上：${nameOf(from)} → ${nameOf(to)}`);
    },
    [manualLinks, persistManual, nameOf]
  );

  const dropLink = React.useCallback(
    (id: string) => persistManual(removeLink(manualLinks, id)),
    [manualLinks, persistManual]
  );

  /** 把一条连线落回一句话（页面作用域精修）。手画的线不许只是装饰。 */
  const applyLink = React.useCallback(
    (link: BoardLink) => {
      fillComposer(linkToRefineInstruction(link, nameOf));
      setToast("已填进输入框，看一眼再按回车");
    },
    [nameOf]
  );

  /* --------------------------------------------------------- 素材 */

  const assets = React.useMemo(() => extractPageAssets(pages), [pages]);

  /** 正在换的那张图（null = 面板关着）。存 URL 不存对象：pages 一变
   *  assets 会重算，存对象会拿着一份过期快照。 */
  /**
   * 画布上选中的那个元素（右侧面板据此变成它的编辑器）。
   *
   * ⚠ 存在这一层而不是画板节点里：右侧面板要读它，画板要据它画选中框，
   *   两处共用一份。存进节点的话面板读不到，就会各存一份、迟早分叉。
   */
  const [picked, setPicked] = React.useState<PickedElement | null>(null);
  /* 刀 3：选中的那一块。⚠ 跟 `picked`（元素）是两件事，不能合并——
     Ctrl+点单元格选中的是元素，点块节点选中的是整块。 */
  const [pickedBlock, setPickedBlock] = React.useState<{
    pageId: string;
    name: string;
  } | null>(null);
  const onPickBlock = React.useCallback((pageId: string, name: string) => {
    setPickedBlock({ pageId, name });
  }, []);
  // 换页面清单 / 换会话 → 之前选中的元素多半已经不在了，别留着一个悬空的框。
  React.useEffect(() => setPicked(null), [sessionId, pages.length]);
  React.useEffect(() => setPickedBlock(null), [sessionId, pages.length]);

  /* ------------------------------------------------- 空格平移 / 画板重排 */

  /**
   * 按住空格 = 平移画布（Figma / excalidraw 那套）。
   *
   * 为什么需要它：画布上最高频的手势是"按住拖着看"，而画板可拖之后，
   * 在画板上按下就被 React Flow 的节点拖拽接管了，平移够不着。空格给平移
   * 留一条任何位置都走得通的路。
   *
   * ⚠ 四条都是从 excalidraw 抄的，缺一条都会出问题（App.tsx 里 isHoldingSpace
   *   那几处）：
   *     1. 只在**没有指针按下**时进入空格态——不在手势中途切模式；
   *     2. `preventDefault()`——否则空格把页面滚下去了；
   *     3. **窗口失焦要强制清掉**——Alt+Tab 走了 keyup 永远不来，
   *        回来就卡在平移态，这是这类实现最常见的 bug；
   *     4. 页面隐藏（切标签页）同样要清。
   *
   * ⚠ 第五条是我们特有的：excalidraw 把监听挂 document 上且没有输入框判断，
   *   因为它的文本编辑是自己那套 wysiwyg。我们页面里有真实 input/textarea
   *   （对话框、元素面板、搜索框），少了 isTypingTarget 这层，用户在输入框里
   *   **敲不出空格**。
   */
  const [spaceHeld, setSpaceHeld] = React.useState(false);
  /* 当前有没有按着指针。KeyboardEvent 上没有 buttons，excalidraw 用的是它自己
     维护的 gesture.pointers.size —— 这里同样自己记一个。 */
  const pointerDownRef = React.useRef(false);
  React.useEffect(() => {
    const onDown = () => {
      pointerDownRef.current = true;
    };
    const onUp = () => {
      pointerDownRef.current = false;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, []);
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.repeat) return;
      if (isTypingTarget(document.activeElement)) return;
      if (pointerDownRef.current) return; // 手势进行中，不切模式
      e.preventDefault();
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") setSpaceHeld(false);
    };
    const clear = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);

  /**
   * 手动挪过的画板位置。没挪过的页用自动排布算出来的位置。
   *
   * ⚠ 存档按会话分键并按当前页面清单过滤（readBoardPositions 里做）——
   *   重新推演之后 pageId 会变，留着旧 id 会让自动排布在某些页上莫名不生效。
   */
  const posKey = boardPositionsStorageKey(sessionId);
  const [boardPos, setBoardPos] = React.useState<Record<string, BoardPosition>>(
    {}
  );
  React.useEffect(() => {
    try {
      setBoardPos(
        readBoardPositions(
          window.localStorage.getItem(posKey),
          pages.map(p => p.pageId)
        )
      );
    } catch {
      setBoardPos({});
    }
  }, [posKey, pages]);
  const persistPos = React.useCallback(
    (next: Record<string, BoardPosition>) => {
      setBoardPos(next);
      try {
        window.localStorage.setItem(posKey, writeBoardPositions(next));
      } catch {
        /* 存档失败不拦交互——挪动本身已经生效了，只是下次打开回到自动排布 */
      }
    },
    [posKey]
  );

  const [replacingUrl, setReplacingUrl] = React.useState<string | null>(null);
  const replacingAsset = React.useMemo(
    () => assets.find(a => a.url === replacingUrl) ?? null,
    [assets, replacingUrl]
  );

  /**
   * 换图：纯字符串替换 → 既有 PATCH 落库 → 把新 HTML 交回宿主。**零 LLM**。
   *
   * ⚠ 三条边界，每条都对应一次真实的失败形态：
   *   1. `planAssetReplacement` 回空 = 画布上看到的图跟页面 HTML 已经对不上，
   *      **必须抛错**。悄悄"成功"就是本仓最忌的"闸全绿但东西没了"。
   *   2. 有一页写失败就整体报错，不吞——半换成功比没换更难排查。
   *   3. 落库成功必须 `onPagesReplaced`，否则画布还显示旧图：存了但看着没变。
   */
  /**
   * 元素编辑落库。跟换图**同一条写回路径**（PATCH /apps/{id}/pages/{pageId}），
   * 不另造。
   *
   * ⚠ 落库成功必须 onPagesReplaced：画板是按 pages 渲染的，不把新 HTML 交回
   *   宿主的话，库里改了、画布上还是旧的——"存了但看着没变"跟"没存上"在屏幕上
   *   长得一模一样。
   */
  const applyElementEdit = React.useCallback(
    async (pageId: string, nextHtml: string) => {
      if (!appId) throw new Error("这个会话还没存成应用，先跑完一轮推演");
      const res = await updateAppPage(appId, pageId, nextHtml);
      if (!res.ok) throw new Error(res.error);
      onPagesReplaced?.({ [pageId]: nextHtml });
      // ⚠ 2026-09-05：存成功但顺手带走了东西（脚本 / 数据孔 / 表单控件变少），
      //   后端如实报了，这里就得显出来——只说「已改好」等于绿灯盖住了缺口。
      //   点选编辑那一侧同一天一起修的，两处别只改一处（§4）。
      setToast(res.warn || "已改好并存进这一页");
    },
    [appId, onPagesReplaced]
  );

  /**
   * 刀 3：只重写这一块。
   *
   * ⚠ **不落库**。后端那条接口本身没有副作用，这里拿到新页面只交给调用方
   *   预览；用户在面板上点「保存这一页」才走 applyElementEdit（那条会存）。
   *   没有这条边界，AI 改块就绕开了"未保存可以放弃"——而重写一整块恰恰是
   *   最需要能反悔的操作。
   */
  const rewriteBlock = React.useCallback(
    async (pageId: string, blockName: string, instruction: string) => {
      if (!appId) throw new Error("这个会话还没存成应用，先跑完一轮推演");
      const html = pages.find(p => p.pageId === pageId)?.html ?? "";
      if (!html) throw new Error("这一页还没有内容");
      const res = await aiEditBlock(appId, pageId, html, blockName, instruction);
      if (!res.ok) throw new Error(res.error);
      return res.html;
    },
    [appId, pages]
  );

  const replaceAsset = React.useCallback(
    async (group: AssetUseGroup, nextUrl: string): Promise<number> => {
      if (!appId) throw new Error("这个会话还没存成应用，先跑完一轮推演");
      const patches = planAssetReplacement(pages, group, nextUrl);
      if (patches.length === 0) {
        throw new Error("页面里没找到这张图（可能刚被别处改过）——刷新一下再试");
      }
      const saved: Record<string, string> = {};
      let lostWarn = "";
      for (const patch of patches) {
        const res = await updateAppPage(appId, patch.pageId, patch.html);
        if (res.ok && res.warn) lostWarn = res.warn;
        if (!res.ok) {
          throw new Error(
            `「${nameOf(patch.pageId)}」保存失败：${res.error}` +
              (Object.keys(saved).length
                ? `（前 ${Object.keys(saved).length} 页已改）`
                : "")
          );
        }
        saved[patch.pageId] = patch.html;
      }
      onPagesReplaced?.(saved);
      const n = patches.reduce((acc, x) => acc + x.replaced, 0);
      setToast(lostWarn || `已换掉 ${n} 处，共 ${patches.length} 页`);
      return n;
    },
    [appId, pages, nameOf, onPagesReplaced]
  );

  const assetBoxes = React.useMemo(
    () => layoutAssets(assets, boardsBounds(boxes), ASSET_TILE),
    [assets, boxes]
  );
  const [assetsShown, setAssetsShown] = React.useState(true);
  const highlightPageIds = React.useMemo(
    () =>
      focusedAsset
        ? (assets.find(a => a.url === focusedAsset)?.pageIds ?? [])
        : [],
    [focusedAsset, assets]
  );

  /* --------------------------------------------------------- 节点 */

  const source = React.useMemo(
    () => deriveBindingSource(model, runtime),
    [model, runtime]
  );

  /**
   * 画板被拖动 → 记下新位置。
   *
   * ⚠ 只认 **artboard 节点**的位置变更：素材卡是自动排在画板下方的，
   *   让它也能挪等于多一套要存的位置，而且素材本来就按引用数排序。
   *
   * ⚠ 只在**拖完**（dragging === false）才落存档。拖动中每一帧都写
   *   localStorage 是几百次同步写，会把拖拽拖成一卡一卡。
   */
  /**
   * 最近挪过的那块画板，画在最上层。
   *
   * ⚠ 2026-08-25 真机同一趟：把一块拖到另一块身上，它整块**滑到人家底下**
   *   （React Flow 按数组顺序叠，我们的 selected 只跟 activePageId 走，拖动
   *   不会选中，所以 elevateNodesOnSelect 抬不起来）。用户看到的就是"页面
   *   没了"。Figma / TRAE 都是"谁刚被拖谁在最上面"，这里照抄。
   */
  const [frontId, setFrontId] = React.useState<string | null>(null);

  const onNodesChange = React.useCallback(
    (changes: NodeChange[]) => {
      let next: Record<string, BoardPosition> | null = null;
      for (const c of changes) {
        if (c.type !== "position" || !c.position) continue;
        if (c.id.startsWith("asset:")) continue;
        setFrontId(c.id);
        next = { ...(next ?? boardPos), [c.id]: { ...c.position } };
        if (c.dragging) {
          // 拖动中：只更新内存，画板跟手；不写存档。
          setBoardPos(next);
          next = null;
        }
      }
      if (next) persistPos(next);
    },
    [boardPos, persistPos]
  );

  /**
   * 画板的**当前**位置：手动挪过的用存档，没挪过的用自动排布算出来的。
   *
   * ⚠ 存档里只会有当前页面清单里的 id（readBoardPositions 过滤过），
   *   所以新生成的页自然落在自动排布的位置上，不会挤在 (0,0)。
   *
   * ⚠ 2026-08-25 真机（校园二手书那趟，用户报"连线一拖动页面就没了"）：
   *   节点位置早就按 boardPos 画了，**连线的出入方向却还在按自动排布的
   *   boxes 挑**（pickLinkSides 吃的是 boxById，boxById 只依赖 boxes）。
   *   把第一块拖到右下角之后，线仍然从它的右边出发再绕回目标的左边，画出
   *   一个跟谁都不挨着的方框——不报错、边数不变、路径也不是 NaN，看起来
   *   就是"线没了"。典型的"只改一半必然静默失效"。
   *   **位置只留这一份**：节点、连线选边、定位都从 placedBoxes 取。
   *   没挪过的画板原样返回同一个对象，别让整排节点每拖一次就换身份。
   */
  const placedBoxes = React.useMemo(
    () =>
      boxes.map(box => {
        const p = boardPos[box.pageId];
        return p ? { ...box, x: p.x, y: p.y } : box;
      }),
    [boxes, boardPos]
  );

  /*
   * 刀 4：影响面。**从源 HTML 扫**，不看 iframe。
   *
   * ⚠ 依赖只有 pages —— 绑定关系跟视口、缩放、画板位置统统无关。这正是刀 1
   *   里两条世代号要分开的理由：跟着几何世代号走的话，每次平移都要重扫一遍
   *   五页 HTML，纯白烧。
   */
  const blockBindings = React.useMemo(
    () => pages.flatMap(pg => scanBlockBindings(pg.pageId, pg.html)),
    [pages]
  );
  const impactEdges = React.useMemo(
    () => buildImpactEdges(blockBindings),
    [blockBindings]
  );
  const pickedBlockKey = pickedBlock
    ? blockKey(pickedBlock.pageId, pickedBlock.name)
    : null;
  /* 刀 4 开整：选中 → 邻域点亮。纯函数，几何量不许进来。 */
  const blockImpactFocus = React.useMemo(
    () => impactFocus(impactEdges, pickedBlockKey),
    [impactEdges, pickedBlockKey]
  );
  const islandKeys = React.useMemo(
    () => islandBlockKeys(blockBindings, impactEdges),
    [blockBindings, impactEdges]
  );

  /** 块 key → 给人看的名字（跨页时带上页名，否则重名分不清）。 */
  const labelOfBlockKey = React.useCallback(
    (key: string) => {
      const b = blockBindings.find(x => x.key === key);
      if (!b) return key;
      return b.pageId === pickedBlock?.pageId
        ? b.name
        : `${nameOf(b.pageId)}·${b.name}`;
    },
    [blockBindings, pickedBlock, nameOf]
  );

  /* 刀 2：块条带的盒子。位置从 placedBoxes 算——画板拖到哪，块跟到哪。 */
  const blockBoxes = React.useMemo<BlockNodeBox[]>(() => {
    if (!blocksShown) return [];
    const out: BlockNodeBox[] = [];
    for (const box of placedBoxes) {
      const snap = blockRects[box.pageId];
      if (!snap) continue;
      out.push(...layoutBlockNodes(box, snap.rects));
    }
    return out;
  }, [blocksShown, placedBoxes, blockRects]);

  /*
   * 谁真渲染、谁退静态卡。阶梯在 block-node-fit（抄 fit.rs 的 ordered ladder）。
   * ⚠ 视口判定复用 shouldMountBoard —— **不另写一套**：画板和块节点用两套
   *   可见性规则的话，缩放到某个档位会出现"画板挂着而它的块全静态"这种
   *   自相矛盾的画面，而且不报错。
   */
  /*
   * 视口，**量化过**的。
   *
   * ⚠ 不量化会真机上卡：阶梯的结果进 `nodes` 的 useMemo，视口每帧变一次
   *   就等于整份节点数组每帧换一次身份，React Flow 每帧重 diff 所有节点。
   *   MOUNT_MARGIN 是 600，所以 128 的抖动窗口完全在安全余量里——
   *   代价只是"块节点最晚会在你多平移 128 画布单位之后才挂上"。
   */
  const vp = useStore(
    React.useCallback(
      (st: { transform: [number, number, number]; width: number; height: number }) => ({
        x: st.transform[0],
        y: st.transform[1],
        zoom: st.transform[2],
        width: st.width,
        height: st.height,
      }),
      []
    ),
    (a, b) =>
      Math.abs(a.x - b.x) < 128 &&
      Math.abs(a.y - b.y) < 128 &&
      Math.abs(a.zoom - b.zoom) < 0.01 &&
      a.width === b.width &&
      a.height === b.height
  );

  /*
   * 阶梯第 2 档里的"当前页"。
   *
   * ⚠ 不能直接用 `activePageId`：它默认是 null（没点过任何画板时），于是
   *   第 2 档筛出 0 块——真机上量到过，开了块条带 24 个节点全是静态卡，
   *   档位显示 inactive_pages_collapsed。功能没坏，但用户看到的就是"点了
   *   没反应"。没选中时取第一页，跟画布首屏对着的那一页一致。
   */
  const focusPageId = React.useMemo(() => {
    /*
     * ⚠ 宿主传来的 `activePageId` **可能指向一个这套应用里不存在的页**。
     *   真机上量到过：它是 "home"，而这份应用的五页叫
     *   material_requisition_hall 等等。拿它去筛第 2 档，筛出 0 块——
     *   表现是开了块条带 24 个节点全是静态卡，档位显示
     *   inactive_pages_collapsed，看着像阶梯写坏了，其实是筛选键对不上。
     *
     *   所以必须**校验它在页清单里**，不在就退回第一页（画布首屏对着的那页）。
     */
    const known = new Set(pages.map(p => p.pageId));
    for (const id of [entered, activePageId]) {
      if (id && known.has(id)) return id;
    }
    return pages[0]?.pageId ?? null;
  }, [entered, activePageId, pages]);

  const blockBoxById = React.useMemo(
    () => new Map(blockBoxes.map(b => [b.key, b])),
    [blockBoxes]
  );

  const blockNodeIds = React.useMemo(
    () => new Set(blockBoxes.map(b => `block:${b.key}`)),
    [blockBoxes]
  );

  const blockFit = React.useMemo(() => {
    const candidates: BlockNodeCandidate[] = blockBoxes.map(b => ({
      key: b.key,
      inViewport: shouldMountBoard(
        { pageId: b.pageId, x: b.x, y: b.y, w: b.w, h: b.h },
        { x: vp.x, y: vp.y, zoom: vp.zoom },
        { width: vp.width, height: vp.height }
      ),
      onActivePage: b.pageId === focusPageId,
      isSelected:
        picked?.pageId === b.pageId && picked?.block?.name === b.name,
    }));
    return fitBlockNodes(candidates);
  }, [blockBoxes, vp, focusPageId, picked]);

  const nodes = React.useMemo<Node[]>((): Node[] => {
    const boards: Node<ArtboardData>[] = placedBoxes.map((box, i) => ({
      id: box.pageId,
      type: "artboard",
      position: { x: box.x, y: box.y },
      // React Flow 要显式尺寸才能算 fitView 与 minimap；不给的话它得等
      // ResizeObserver 量一遍，首帧 fitView 会算在 0×0 上（全屏一团糊）。
      width: box.w,
      height: box.h,
      /* ⚠ 1001 不是 1：React Flow 的 elevateNodesOnSelect 给**选中**的节点
         加 1000，写 1 的话"刚拖过的那块"照样压在选中的那块底下——而这两件
         事经常不是同一块（选中跟着 activePageId 走，拖动不改选中）。 */
      zIndex: box.pageId === frontId ? 1001 : 0,
      selected: pages[i]?.pageId === activePageId,
      data: {
        page: pages[i]!,
        box,
        index: i,
        label: artboardLabel(pages[i]!),
        fillPhone: isPhone,
      },
    }));
    const blockNodes: Node<BlockNodeData>[] = blockBoxes.map(b => {
      const page = pages.find(p => p.pageId === b.pageId)!;
      const snap = blockRects[b.pageId];
      const rect = snap?.rects.find(r => r.name === b.name);
      return {
        id: `block:${b.key}`,
        type: "block",
        position: { x: b.x, y: b.y },
        width: b.w,
        height: b.h,
        /* 用户裁决：页组框能拖、**块不能拖**。块没有自己的位置，
           它的位置是画板位置推出来的。 */
        draggable: false,
        selectable: false,
        zIndex:
          blockImpactFocus.active && blockImpactFocus.litKeys.has(b.key)
            ? 2
            : 0,
        data: {
          box: b,
          page,
          board: { w: design.w, h: design.h },
          live: blockFit.live.has(b.key),
          kindLabel: rect?.kindLabel ?? "块",
          kind: rect?.kind ?? "card",
        },
      };
    });
    if (!assetsShown) return [...boards, ...blockNodes];
    const assetNodes: Node<AssetData>[] = assetBoxes.map((b, i) => ({
      id: `asset:${b.url}`,
      type: "asset",
      position: { x: b.x, y: b.y },
      width: b.w,
      height: b.h,
      selectable: false,
      data: { asset: assets[i]!, w: b.w, h: b.h },
    }));
    return [...boards, ...blockNodes, ...assetNodes];
  }, [
    placedBoxes,
    pages,
    isPhone,
    activePageId,
    assetBoxes,
    assets,
    assetsShown,
    frontId,
    blockBoxes,
    blockFit,
    blockRects,
    blockImpactFocus,
    design.w,
    design.h,
  ]);

  const boxById = React.useMemo(
    () => new Map(placedBoxes.map(b => [b.pageId, b])),
    [placedBoxes]
  );
  const edges = React.useMemo<Edge[]>(
    () => {
      /* 归属线：每个块 → 它所属的那张整页画板。
         ⚠ 这是**常驻**线，跟刀 4 的影响线不是一回事：它答的是"这一块是哪
           一页的"，不是"改了它谁跟着变"。两种线混成一种，用户会把归属
           当成联动。所以颜色/虚实都跟 EDGE_STYLE 那两种分开。 */
      const ownership: Edge[] = blockBoxes.map(b => {
        const board = boxById.get(b.pageId);
        /* ⚠ 按相对位置选边，跟画板连线同一套 pickLinkSides——**不另写一套**。
           块网格在画板右侧，多数时候会挑出"左出右进"，但块摆到画板下方那几行
           时挑的是"上出下进"，那才是短且直的走法。 */
        const sides = board
          ? pickLinkSides(b, board)
          : { source: "l" as const, target: "r" as const };
        const dim = impactNodeDimmed(blockImpactFocus, b.key);
        return {
        id: `own:${b.key}`,
        source: `block:${b.key}`,
        target: b.pageId,
        sourceHandle: sides.source,
        targetHandle: sides.target,
        /* ⚠ 归属线也走曲线（2026-08-28）：上一版是直线，和影响线的曲线混在
           一起时像两套画法拼起来的。同一张图上的线该是同一种手感。 */
        type: "blockCurve",
        selectable: false,
        focusable: false,
        style: {
          ...OWNERSHIP_STYLE,
          opacity: dim ? IMPACT_DIM_EDGE : 1,
        },
        };
      });
      const linkEdges = links.map(l => {
        const a = boxById.get(l.from);
        const b = boxById.get(l.to);
        // 两端都在才挑得出边；缺一端时退回右→左（React Flow 至少画得出来）。
        const sides =
          a && b
            ? pickLinkSides(a, b)
            : { source: "r" as const, target: "l" as const };
        return {
          id: l.id,
          source: l.from,
          target: l.to,
          sourceHandle: sides.source,
          targetHandle: sides.target,
          type: "smoothstep",
          animated: l.kind === "manual",
          label: l.label,
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.92 },
          labelStyle: {
            fill: l.kind === "manual" ? "#1677ff" : "#64748b",
            fontSize: 26,
            fontWeight: 500,
          },
          style: EDGE_STYLE[l.kind],
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
            color: EDGE_STYLE[l.kind].stroke,
          },
          data: { kind: l.kind },
        };
      });
      /*
       * 影响线。用户 2026-08-27 裁决**两类都常驻画**（我原本建议同源字段
       * 只在选中时点亮）。按裁决实现：线还在。选中时邻域点亮、其余压暗
       * （cytoscape neighborhood-highlight），不删某一类。
       *
       * ⚠ 只在块条带开着时画：块节点不存在时这些边两端都落空，React Flow
       *   会静默丢掉（不报错），但计算白做。
       */
      const impact: Edge[] = blocksShown
        ? impactEdges
            .filter(e => {
              /* 两端都得有节点。nav 的 to 是页面 id（画板节点）。 */
              const fromOk = blockNodeIds.has(`block:${e.from}`);
              const toOk =
                e.kind === "nav"
                  ? boxById.has(e.to)
                  : blockNodeIds.has(`block:${e.to}`);
              return fromOk && toOk;
            })
            .map(e => {
              /* ⚠ 两端都写死同一侧的话（上一版 l→l），贝塞尔的两个控制点
                 都朝同一个方向，线会兜一个大圈——真机上就是横扫全场的长弧。
                 按相对位置挑边，短、直、看得懂。 */
              const fromBox = blockBoxById.get(e.from);
              const toBox =
                e.kind === "nav" ? boxById.get(e.to) : blockBoxById.get(e.to);
              const sides =
                fromBox && toBox
                  ? pickLinkSides(fromBox, toBox)
                  : { source: "r" as const, target: "l" as const };
              const dim = impactEdgeDimmed(blockImpactFocus, e.id);
              const lit = blockImpactFocus.active && !dim;
              return {
              id: e.id,
              source: `block:${e.from}`,
              target: e.kind === "nav" ? e.to : `block:${e.to}`,
              sourceHandle: sides.source,
              targetHandle: sides.target,
              type: "blockCurve",
              selectable: false,
              focusable: false,
              zIndex: lit
                ? isRealLinkage(e.kind)
                  ? 4
                  : 3
                : dim
                  ? 0
                  : isRealLinkage(e.kind)
                    ? 2
                    : 1,
              style: {
                ...IMPACT_STYLE[e.kind],
                opacity: dim ? IMPACT_DIM_EDGE : 1,
              },
              data: { impactKind: e.kind, shared: e.shared },
              };
            })
        : [];
      return [...ownership, ...linkEdges, ...impact];
    },
    [
      links,
      boxById,
      blockBoxes,
      blockBoxById,
      impactEdges,
      blocksShown,
      blockNodeIds,
      blockImpactFocus,
    ]
  );

  /* --------------------------------------------------------- 交互 */

  const boardEls = React.useRef(new Map<string, HTMLDivElement>());
  const registerBoardEl = React.useCallback(
    (pageId: string, el: HTMLDivElement | null) => {
      if (el) boardEls.current.set(pageId, el);
      else boardEls.current.delete(pageId);
    },
    []
  );

  const zoomToBoard = React.useCallback(
    (pageId: string) => {
      // ⚠ 必须用 placedBoxes：拖走之后 boxes 里还是自动排布的老坐标，
      //   用它 fitBounds 会把镜头对到一块空地上。
      const box = placedBoxes.find(b => b.pageId === pageId);
      if (!box) return;
      // fitBounds 用 React Flow 自己的容器尺寸算，比我们手算稳（它知道
      // padding 与当前 transform）。自己再算一遍等于两份缩放，必然分叉。
      flow.fitBounds(
        { x: box.x, y: box.y, width: box.w, height: box.h },
        { padding: 0.12, duration: 260 }
      );
    },
    [placedBoxes, flow]
  );

  const select = React.useCallback(
    (pageId: string) => {
      // 连线态下点画板 = 连线（右键菜单「从这里连一条线」进来的那条路），
      // 不是选中。两种语义在同一次点击上，必须由 linkFrom 明确分流。
      if (linkFrom) {
        if (linkFrom !== pageId) connect(linkFrom, pageId);
        setLinkFrom(null);
        return;
      }
      onActivePageChange?.(pageId);
      setFocusedAsset(null);
    },
    [linkFrom, connect, onActivePageChange]
  );

  const enter = React.useCallback(
    (pageId: string) => {
      if (linkFrom) return; // 连线态下双击不进板，避免误触
      onActivePageChange?.(pageId);
      setEntered(pageId);
      zoomToBoard(pageId);
    },
    [linkFrom, onActivePageChange, zoomToBoard]
  );

  /** 页面自己的左侧菜单点了某一项：画布上滚到那块画板，而不是原地换内容。 */
  const navigate = React.useCallback(
    (pageId: string) => {
      // ⚠ 收到的可能是改名前的旧 id：页面 HTML 里的 data-page-id 是第 3.5 步
      //   按草稿 id 烧的，第 4.5 步改键改不到正文（见 page-id-alias 头注）。
      //   此前这里直接 `if (!boxes.some(...)) return` ——画布档的菜单跟直播档
      //   一样点了没反应，且同样一声不吭。两处必须同改（纪律四）。
      const canon = canonicalPageId(pageId, pages);
      if (!canon || !boxes.some(b => b.pageId === canon)) return;
      onActivePageChange?.(canon);
      setEntered(canon);
      zoomToBoard(canon);
    },
    [boxes, pages, onActivePageChange, zoomToBoard]
  );

  const jumpTo = React.useCallback(
    (pageId: string) => {
      onActivePageChange?.(pageId);
      zoomToBoard(pageId);
    },
    [onActivePageChange, zoomToBoard]
  );

  const regenerate = React.useCallback(
    (pageId: string) => {
      // ⚠ 指令里要出现**人话页名**：后端判作用域那一步
      //   (services/refine_page_scope.py) 是拿指令文本点名页面的，
      //   只写 pageId 它点不到，会退回全量重画。
      fillComposer(`把「${nameOf(pageId)}」这一页重画一版，其余页面不要改。`);
      setToast("重画指令已填进输入框，看一眼再按回车");
    },
    [nameOf]
  );

  const doExportPng = React.useCallback(
    async (pageId: string) => {
      setToast("正在导出 PNG…");
      const ok = await exportBoardPng(
        boardEls.current.get(pageId) ?? null,
        nameOf(pageId)
      );
      // fail-open 不等于静静地什么都不发生：点了导出却没下载，
      // 比报个错更让人以为是自己点错了。
      setToast(ok ? "PNG 已导出" : "导出没成——画板还没渲染完，等一下再试");
    },
    [nameOf]
  );

  const doExportHtml = React.useCallback(
    (pageId: string) => {
      const page = pages.find(p => p.pageId === pageId);
      const ok = exportBoardHtml(page?.html ?? "", nameOf(pageId));
      setToast(ok ? "HTML 已导出" : "这一页没有可导出的 HTML");
    },
    [pages, nameOf]
  );

  const copyPageId = React.useCallback((pageId: string) => {
    navigator.clipboard?.writeText(pageId).then(
      () => setToast(`已复制 ${pageId}`),
      () => setToast("复制失败——浏览器没给剪贴板权限")
    );
  }, []);

  const ctx = React.useMemo<CanvasCtx>(
    () => ({
      enteredPageId: entered,
      activePageId,
      source,
      gates,
      onAction,
      onHoverBinding,
      onSelect: select,
      onEnter: enter,
      onNavigate: navigate,
      onOpenInPageView,
      onBoardMenu: (pageId, x, y) => {
        onActivePageChange?.(pageId);
        setMenu({ pageId, x, y });
      },
      onSelectAsset: (a: CanvasAsset) => setFocusedAsset(a.url),
      onReplaceAsset: appId ? (a: CanvasAsset) => setReplacingUrl(a.url) : null,
      /* 选中→编辑整条收在画布内部（跟换图一样）。宿主只在落库后
         收一次新 HTML（onPagesReplaced），不用把选中态穿来穿去。 */
      onPickElement: appId ? setPicked : null,
      picked,
      linkFrom,
      linkMode,
      registerBoardEl,
      highlightPageIds,
      onBlockRects,
      blocksShown,
      onPickBlock,
      pickedBlockKey,
      impactFocus: blockImpactFocus,
      islandKeys,
    }),
    [
      entered,
      activePageId,
      source,
      gates,
      onAction,
      onHoverBinding,
      select,
      enter,
      navigate,
      onOpenInPageView,
      onActivePageChange,
      appId,
      picked,
      linkFrom,
      linkMode,
      registerBoardEl,
      highlightPageIds,
      onBlockRects,
      blocksShown,
      onPickBlock,
      pickedBlockKey,
      blockImpactFocus,
      islandKeys,
    ]
  );

  // Esc：先退连线态，再退进板态。⚠ 只在有态可退时挂监听——常挂会把
  // Studio 里其它 Esc 语义（系统屏抽屉）抢掉。
  React.useEffect(() => {
    if (!entered && !linkFrom && !picked && !pickedBlock) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 退的顺序：先撤选中的元素，再撤选中的块（邻域点亮跟着灭），
      // 再退连线态，最后退进板态。
      if (picked) setPicked(null);
      else if (pickedBlock) setPickedBlock(null);
      else if (linkFrom) setLinkFrom(null);
      else setEntered(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, linkFrom, picked, pickedBlock]);

  // 提示条自己消失。⚠ 用 key 重置计时：连着点两次导出，第二次的提示
  // 不该被第一次的计时器提前掐掉。
  //
  // ⚠ 2026-09-05：**「顺手带走了东西」那条不许自己消失。**
  //   2.6 秒对"已连上"「PNG 已导出」这类回执够了，但那条说的是
  //   「你这一存把页面脚本 / 数据孔 / 表单控件弄少了，撤销后重存」——
  //   一条需要人去做点什么的话，闪一下就没，等于没说过。
  //   真机那次（点选编辑把交付页的 Tailwind 摘掉）能被抓到，
  //   靠的是服务端日志，不是屏幕。
  const toastIsLoss = !!toast && toast.includes("顺手带走了");
  React.useEffect(() => {
    if (!toast || toastIsLoss) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast, toastIsLoss]);

  /**
   * 页面数变了（推演中逐页到达）重新适应一次画布。
   *
   * ⚠ 2026-08-25 真机第一版就栽在这里：写的是 `setTimeout(fitView, 60)`，
   *   打开画布档停在 100%——**一屏只看得见一页**，正好把画布要解决的问题
   *   原样保留下来，而且不报错、判据全绿（画板确实渲染了 5 块）。
   *
   *   病因是 fitView 依赖 React Flow 已经量到容器尺寸和节点尺寸。挂载后
   *   60ms 这两样都还可能是 0，fitView 算在 0×0 上就直接放弃，静默返回。
   *   拿墙钟等一个**状态**，是这类 bug 的标准形状。
   *
   *   正确做法是等它自己说"量完了"——但**别用 useNodesInitialized()**，
   *   那条路第二次又栽了（原因写在下面 flowLayoutKey 那处）。判据要直接读
   *   nodeLookup 里每个节点的 measured 尺寸。同时给 <ReactFlow fitView>
   *   兜首帧：只等量完的话，推演中第 2、3 页陆续到达时首帧会闪一下空画布。
   *
   * ⚠ 只认**页数**变化：依赖写成 pages 会让每次填数刷新都把用户手动调好的
   *   视口拽回原位。
   */
  /**
   * 排版指纹：节点数 + 首行块数（= 列数）。任一变了就重新适应一次画布。
   * 节点还没量完时返回空串——空串不触发 fit（fitView 在没量到尺寸的节点上
   * 会算在 0×0 上，静默返回）。
   *
   * ⚠ 2026-08-25 这里连栽两次，两次的形状都是"判据看着有、其实没通电"：
   *
   *   第一次：指纹从**我自己算的 boxes** 推。列数 3→2 重排之后，effect 跟
   *   nodes prop 在同一次提交里跑，我调 fitView 的那一刻 React Flow 的 store
   *   还是上一帧的位置——**拿自己的状态去问它的问题**。
   *
   *   第二次：改成读 store 了，但守卫写的是 `useNodesInitialized()`。
   *   真机日志（在这行打 console.log 打出来的）：
   *       fit-effect {nodesReady: false, flowLayoutKey: "5:2", did: ""}
   *   它**恒为 false**。因为 v12 的 nodesInitialized 除了尺寸还要
   *   handleBounds，而画板节点当时没有任何 <Handle>。
   *   于是 effect 每次都早退，屏幕上是 2 列、缩放却是 3 列那次算出来的 12%。
   *   ——用一个"顺便还要求别的东西"的现成布尔值当守卫，是这类静默失效的
   *   标准来源。守卫要**直接问自己真正依赖的那个条件**：节点量完了没有。
   *
   *   ⚠ 第二轮加连线之后画板**有** Handle 了，nodesInitialized 大概会开始
   *     返回 true——但**别因此改回去**。它依赖的东西比这里需要的多，
   *     哪天连线态改成按需挂把手，它又会悄悄变回恒 false。
   *
   * ⚠ 素材卡也算节点，所以指纹里要把它们排除，只数画板：素材开关一开一关
   *   会让 nodeLookup.size 变，但**排版没变**，不该把用户的视口拽回原位。
   *
   * 想验证这条还通电：在下面 fitView 那行打一句 log，切到画布档看它有没有
   * 打出来。判据 canvas-board-layout.test.ts 钉的是纯函数那一半。
   */
  /*
   * ⚠ 2026-08-25 第三次栽在这儿，用户报的是"一拖动远一点，连接线就没了"。
   *
   *   指纹里的列数原来是数**store 里 y===0 的画板**。手动把一块拖走之后
   *   它的 y 不再是 0 —— 指纹从 "4:4" 变成 "4:3"，这条 effect 就当成
   *   "排版变了"，在**拖动过程中**调了一次 fitView。视口当场跳走，而拖拽
   *   是按指针在 flow 空间的位移算的，视口一换算，画板跟着甩到很远的地方，
   *   连着它的线自然跑出屏幕——看起来就是"拖远一点线就没了"。
   *   （真机复现：缩放 21% 时拖一下，松手后读数自己变回 52%，画板落到
   *   视口外。）
   *
   *   这条 effect 要盯的是**自动排版**变了没有（页数/列数），那是我们自己
   *   算出来的，跟用户手动挪画板无关。所以列数改从 boxes 里数。
   *
   *   但也不能就此不问 store —— 前两次栽的就是"拿自己的状态去问它的问题"
   *   （见上面）。守卫改成**直接问 store 追上没有**：每块画板都量到了尺寸，
   *   且位置跟我们给的 placedBoxes 对得上。没追上就返回空串，effect 早退，
   *   didFit 不动；追上之后指纹跟拖动前一样，也就不会再 fit 一次。
   */
  const autoCols = React.useMemo(
    () => boxes.reduce((n, b) => n + (b.y === 0 ? 1 : 0), 0),
    [boxes]
  );
  const flowLayoutKey = useStore(s => {
    let boards = 0;
    let ready = 0;
    for (const n of s.nodeLookup.values()) {
      if (n.type !== "artboard") continue;
      boards++;
      const want = boxById.get(n.id);
      if (
        (n.measured?.width ?? 0) > 0 &&
        (n.measured?.height ?? 0) > 0 &&
        want &&
        n.position.x === want.x &&
        n.position.y === want.y
      )
        ready++;
    }
    if (boards === 0 || ready < boards) return "";
    /* ⚠ 容器尺寸也在指纹里（2026-08-28 修 D9）：fitView 的结果依赖它，
       容器变了而不重新适应 = 画板留在视口外。见 hostSizeKey 的头注。 */
    return `${boards}:${autoCols}:${hostSizeKey}`;
  });
  const didFit = React.useRef("");
  React.useEffect(() => {
    if (!flowLayoutKey || didFit.current === flowLayoutKey) return;
    didFit.current = flowLayoutKey;
    flow.fitView({ padding: FIT_PADDING, duration: 240, maxZoom: 1 });
  }, [flowLayoutKey, flow]);

  const zoom = useStore(s => s.transform[2]);
  const delivered = pages.filter(p => !p.missing).length;
  const placeholderCount = assets.filter(a => a.placeholder).length;

  const activePage = pages.find(p => p.pageId === activePageId) ?? null;
  const facts = React.useMemo(
    () =>
      activePage
        ? boardFacts(activePage, model, links, assets, design, labelOf)
        : null,
    [activePage, model, links, assets, design, labelOf]
  );

  const fitAll = React.useCallback(
    () => flow.fitView({ padding: FIT_PADDING, duration: 240, maxZoom: 1 }),
    [flow]
  );

  return (
    <div
      /* ⚠ 2026-08-28 用户裁决：「画布模式下顶部这块不要给高度」。
         说明行原来是画板上方一条 shrink-0 的行，白占约 20px 高，而画布本来
         就该是"整块台面"。它现在画在台面**左下角**（抄 ComfyUI 左下那组
         T/I/N/V/FPS：压在画布上、不占布局），角色切换浮在右上角。
         所以这里既不留行、也不留 gap。 */
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="sliderule-canvas-stage"
      data-page-count={pages.length}
      data-entered={entered ?? undefined}
      data-link-mode={linkMode ? "1" : "0"}
      /* 刀 2 的真机观测点。⚠ `rung` 不是装饰：截图上"全量真渲染"和"已经
         降到全静态"长得差不多（都是一排卡片），只有档位读得出区别。
         这就是 fit.rs 里 FitPlan::rung 的用意。 */
      data-block-fit-rung={blockFit.rung}
      data-block-fit-live={blockFit.liveCount}
      data-block-fit-total={blockBoxes.length}
      data-viewport-size={`${Math.round(vp.width)}x${Math.round(vp.height)}`}
      data-block-focus-page={focusPageId ?? ""}
      data-link-count={links.length}
      data-asset-count={assets.length}
    >
      <div ref={stageRowRef} className="flex min-h-0 min-w-0 flex-1 gap-2">
        <div
          ref={flowHostRef}
          /*
           * 台面**完全透明**（2026-08-25 用户裁决："完全透明就行，现在就是有
           * 两层点阵背景了"）。不画底色、不画点阵、不描边——画布直接露出外壳
           * 那一层，只有一个背景。
           *
           * ⚠ 这一路走了三版才落到这儿，把过程记下来免得下一个人再走一遍：
           *   1) 深底 + 跟指针的聚光灯 + 全套前景改色 —— 做过头了，撤了。
           *   2) 浅灰台面 —— 顺带量到：字面意义上"去掉背景"是**看不见的**，
           *      台面原来 #fbfbfc，去掉后露出外壳 #f4f4f6，差一个色阶。
           *   3) 浅灰 + 自画点阵 —— 于是变成两层背景叠着。
           *   结论：这块地方**不该有自己的背景**。要改画布观感就去改外壳那层
           *   （--sr-shell-bg），别在这里再糊一层。
           */
          data-space-pan={spaceHeld ? "1" : "0"}
          /* 光标反馈跟 excalidraw 一致：按住空格是 grab，真拖起来是 grabbing。
             没有这层反馈，用户按了空格也不知道模式已经变了。 */
          /* ⚠ 台面**不圆角**：浮层贴边之后（2026-08-28 用户裁决
             「悬浮元素贴边，不要给往里的位移」），宿主的 rounded-md 配
             overflow-hidden 会把四个角上的浮层各啃掉一块——那种错不报错，
             只是看着像没画完。 */
          className={`relative min-h-0 min-w-0 flex-1 overflow-hidden ${
            spaceHeld ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        >
          <CanvasContext.Provider value={ctx}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1 }}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              /* Figma / Stitch 的滚动语义：滚轮=平移，ctrl/⌘+滚轮=缩放，
                 触控板双指=平移、捏合=缩放。zoomOnScroll 开着的话（React Flow
                 默认）滚一下就整屏跳缩放，跟同类工具全反。 */
              panOnScroll
              zoomOnScroll={false}
              zoomOnPinch
              zoomOnDoubleClick={false}
              panOnDrag={[0, 1, 2]}
              selectionOnDrag={false}
              /* 只有连线态才允许拉线。常开的话画板边缘一直挂着两个能拖的
                 圆点，误触率高，而连线不是高频动作。 */
              nodesConnectable={linkMode}
              /* 四个把手都声明成 source，靠 loose 让它们同时能当终点
                 （见 ArtboardNode 里那段注释）。 */
              connectionMode={ConnectionMode.Loose}
              onConnect={c => {
                if (c.source && c.target) connect(c.source, c.target);
              }}
              /* ⚠ **别把 elementsSelectable 关掉。** 2026-08-25 真机踩到：
                 写了 `elementsSelectable={false}` + `nodesDraggable={false}`
                 之后，React Flow 判定这节点没人要事件，给它挂上
                 `pointer-events: none`——于是每块画板上那层手势层**在 DOM 里、
                 数量也对（5 块画板 5 层），但一个事件都收不到**。
                 单击选中、双击进板全是哑的，而判据"手势层存在"照样全绿。
                 真机 elementFromPoint(画板中心) 返回的是 .react-flow__pane，
                 这一行才是证据。
                 平移缩放当时看着还是好的，但那是**因为节点整个不吃事件**，
                 跟手势层没关系——修好之后手势层才真的开始干它的活。 */
              /* ⚠ 画板**不可拖动**，这是拿真机换来的取舍，别顺手改回 true。
                 2026-08-25 第一版给标题条挂了 dragHandle 想支持重排，真机实测
                 D 项失败：**画板本体上按住拖拽不平移画布**。因为只要节点是
                 draggable，React Flow 就会在节点上接管 mousedown，事件到不了
                 d3-zoom（dragHandle 只决定"从哪儿开始拖"，不决定"要不要拦"）。
                 而画布上最高频的手势就是按住拖着看——为了一个"能重排画板"
                 （列数本来就按容器长宽比自动算了）去牺牲它，不划算。 */
              /*
               * 空格按着时**画板不可拖**——只要节点 draggable，React Flow 就在
               * 节点上接管 mousedown，事件到不了 d3-zoom，平移就够不着画板
               * 底下那片区域（2026-08-25 第一版给标题条挂 dragHandle 失败的
               * 就是这条：dragHandle 只决定"从哪儿开始拖"，不决定"要不要拦"）。
               * 关掉 draggable，事件冒到缩放层，空格+拖就能在画板上平移。
               */
              nodesDraggable={!spaceHeld}
              onNodesChange={onNodesChange}
              proOptions={{ hideAttribution: true }}
              onPaneClick={() => {
                setEntered(null);
                setLinkFrom(null);
                setFocusedAsset(null);
                /* cytoscape neighborhood-highlight：点空白恢复概览。
                   不撤选中的话，邻域点亮会一直亮着，像坏了。 */
                setPickedBlock(null);
                setPicked(null);
              }}
              onEdgeClick={(_e, edge) => {
                const l = links.find(x => x.id === edge.id);
                if (l) {
                  onActivePageChange?.(l.from);
                  setInspectorOpen(true);
                }
              }}
              className="bg-transparent"
            >
              <MiniMap
                pannable
                zoomable
                ariaLabel="画布缩略图"
                maskColor="rgba(244,244,246,0.72)"
                nodeColor={n =>
                  n.type === "asset"
                    ? "#e2e8f0"
                    : n.id === activePageId
                      ? "#1677ff"
                      : "#cbd5e1"
                }
                className="!bottom-3 !right-3 !h-[96px] !w-[152px] overflow-hidden !rounded-xl !border-0 !bg-white/95 ![box-shadow:0_0_0_1px_rgba(15,23,42,0.06),0_8px_20px_-6px_rgba(15,23,42,0.12)]"
              />
            </ReactFlow>
          </CanvasContext.Provider>

          {/*
            ## 台面 chrome：Figma / Stitch 浮药丸（2026-09-04）

            读数仍在左下、仍不占布局高度（2026-08-28 ComfyUI 位置裁决还在）。
            变的是**贴边切一角**→**内缩 12px、四角全圆、近距投影**。
            用户截图指了四处（读数 / 缩放条 / 素材卡 / 右侧面板）。

            ⚠ `pointer-events-none` 是功能：漏了它鼠标划过就把平移吃掉。
            ⚠ 缩放百分比不在读数里重复：正下方的药丸就是读数（还能点）。
          */}
          <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-1.5">
          <div
            className="pointer-events-none flex flex-col gap-0.5 rounded-xl bg-white/92 px-2.5 py-1.5 text-[11px] leading-[1.45] text-stone-500 backdrop-blur-md"
            style={{ boxShadow: CANVAS_CHROME_SHADOW }}
            data-testid="sliderule-canvas-meta"
          >
            <span className="font-mono tabular-nums text-stone-400">
              {design.w}×{design.h}
            </span>
            <span data-testid="sliderule-canvas-page-count">
              {running ? `界面生成中 ${delivered} 页` : `共 ${delivered} 页`}
            </span>
            {assets.length > 0 ? (
              <span data-testid="sliderule-canvas-asset-summary">
                {assets.length} 张图
                {placeholderCount > 0 ? (
                  <span className="ml-1 text-[#C05621]">
                    （{placeholderCount} 张占位图）
                  </span>
                ) : null}
              </span>
            ) : null}
            <span data-testid="sliderule-canvas-hint" className="text-stone-400">
              {linkFrom
                ? "点另一块画板连上，Esc 取消"
                : entered
                  ? "已进入画板，Esc 退出"
                  : linkMode
                    ? /* ⚠ 派生边真机上经常是 0 条（三个会话量到 1/0/0，见
                         canvas-board-graph 头注）。开了连线态却一条线都没有时
                         必须**说出为什么**——静静地什么都不画，用户只会以为
                         功能坏了。这条是那份头注里写下的要求，不是文案润色。 */
                      dataflowLinks.length === 0
                      ? "模型里没有可派生的页面间数据流 · 从画板边缘的圆点拖到另一块画板即可自己连"
                      : "从画板边缘的圆点拖到另一块画板即可连线"
                    : "双击画板进入交互 · 右键更多"}
            </span>
          </div>

          {/* 缩放药丸：Figma/Stitch 浮条，读数可点=适应画布。 */}
          <div
            className="flex items-center gap-0.5 rounded-xl bg-white/95 p-1 backdrop-blur-md"
            style={{ boxShadow: CANVAS_CHROME_SHADOW }}
            data-testid="sliderule-canvas-zoom"
          >
            <button
              type="button"
              onClick={() => flow.zoomOut({ duration: 160 })}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition hover:bg-[#f1f3f5] hover:text-stone-800"
              aria-label="缩小"
              title="缩小"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={fitAll}
              className="min-w-[3.2rem] rounded-lg px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-stone-600 transition hover:bg-[#f1f3f5]"
              data-testid="sliderule-canvas-zoom-readout"
              title="适应画布（看全所有页面）"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => flow.zoomIn({ duration: 160 })}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition hover:bg-[#f1f3f5] hover:text-stone-800"
              aria-label="放大"
              title="放大"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <span className="mx-0.5 h-4 w-px bg-[#eceef1]" aria-hidden />
            <button
              type="button"
              onClick={fitAll}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition hover:bg-[#f1f3f5] hover:text-stone-800"
              aria-label="适应画布"
              title="适应画布"
            >
              <Scan className="h-3.5 w-3.5" />
            </button>
            {/*
              恢复自动排布。⚠ 只在**真挪过**的时候出现——没挪过还摆一颗按钮，
              用户会以为当前就是"手动排的"。挪乱了必须有退路，否则重排是
              单向操作（这块画布没有撤销栈）。
            */}
            {Object.keys(boardPos).length > 0 ? (
              <button
                type="button"
                data-testid="sliderule-canvas-reset-layout"
                onClick={() => {
                  persistPos({});
                  window.setTimeout(fitAll, 60);
                  setToast("已恢复自动排布");
                }}
                className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-stone-500 transition hover:bg-[#f4f4f5] hover:text-stone-800"
                title="把画板放回自动排布的位置"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                复位
              </button>
            ) : null}
            <span className="mx-0.5 h-4 w-px bg-[#eceef1]" aria-hidden />
            <button
              type="button"
              onClick={() => {
                setLinkMode(v => !v);
                setLinkFrom(null);
              }}
              aria-pressed={linkMode}
              data-testid="sliderule-canvas-link-toggle"
              className={`flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition ${
                linkMode
                  ? "bg-[#1677ff] text-white"
                  : "text-stone-600 hover:bg-[#f4f4f5] hover:text-stone-800"
              }`}
              title="连线：从画板右缘的圆点拖到另一块画板。连好的线可以一键写回页面。"
            >
              <Link2 className="h-3 w-3" />
              连线
              {links.length > 0 ? (
                <span className="font-mono tabular-nums">{links.length}</span>
              ) : null}
            </button>
            {assets.length > 0 ? (
              <button
                type="button"
                onClick={() => setAssetsShown(v => !v)}
                aria-pressed={assetsShown}
                data-testid="sliderule-canvas-assets-toggle"
                className={`flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition ${
                  assetsShown
                    ? "text-stone-800"
                    : "text-stone-400 hover:bg-[#f4f4f5]"
                }`}
                title="页面引用到的图，摊在画板下方"
              >
                <Images className="h-3 w-3" />
                素材
                <span className="font-mono tabular-nums">{assets.length}</span>
              </button>
            ) : null}
            {/* 刀 2：块条带开关。⚠ 计数用**量到的块矩形**条数，不是"应该有
                几块"——量不到就该显示 0，而不是拿源码里的块数冒充。 */}
            <button
              type="button"
              onClick={() => {
                const next = !blocksShown;
                setBlocksShown(next);
                /* ⚠ 切开关必须重新适应画布：条带排在画板右侧，开了之后整个
                   排版宽出一大截。不重适应的话，用户点了「块」屏幕上什么都
                   不变（新节点全在视口外），而且降级阶梯会如实把它们全判成
                   视口外 → 全静态。真机上量到过：24 个块节点、0 个真渲染。
                   延一帧是等 boxes/blockBoxes 按新排版重算完。 */
                requestAnimationFrame(() =>
                  flow.fitView({ padding: FIT_PADDING, duration: 240, maxZoom: 1 })
                );
              }}
              aria-pressed={blocksShown}
              data-testid="sliderule-canvas-blocks-toggle"
              className={`flex h-6 items-center gap-1 rounded px-1.5 text-[11px] transition ${
                blocksShown
                  ? "text-stone-800"
                  : "text-stone-400 hover:bg-[#f4f4f5]"
              }`}
              title="把每一页拆成一块块，摊在画板右侧"
            >
              <LayoutGrid className="h-3 w-3" />
              块
              <span className="font-mono tabular-nums">
                {Object.values(blockRects).reduce(
                  (n, snap) => n + snap.rects.length,
                  0
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setInspectorOpen(v => !v)}
              aria-pressed={inspectorOpen}
              data-testid="sliderule-canvas-inspector-toggle"
              className={`flex h-6 w-6 items-center justify-center rounded transition ${
                inspectorOpen
                  ? "bg-[#1677ff] text-white"
                  : "text-stone-500 hover:bg-[#f4f4f5] hover:text-stone-800"
              }`}
              aria-label="属性面板"
              title="属性面板：选中画板背后的数据、权限、连线与素材"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
            {activePageId && onOpenInPageView ? (
              <>
                <span className="mx-0.5 h-4 w-px bg-[#eceef1]" aria-hidden />
                <button
                  type="button"
                  onClick={() => onOpenInPageView(activePageId)}
                  data-testid="sliderule-canvas-open-in-page"
                  className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-stone-600 transition hover:bg-[#f4f4f5] hover:text-stone-800"
                  title="把选中的这一页送回页面档（那里有点选编辑与透视）"
                >
                  <Maximize2 className="h-3 w-3" />
                  在页面档打开
                </button>
              </>
            ) : null}
          </div>
          </div>

          {/* 角色切换：浮在台面**右上角**（2026-08-28 用户裁决
              「右上角的权限切换改为悬浮显示」）。
              ⚠ 外层不能 pointer-events-none：这是要点的控件，不是读数。 */}
          {metaTrailing ? (
            <div
              className="absolute right-3 top-3 z-10"
              data-testid="sliderule-canvas-meta-trailing"
            >
              {metaTrailing}
            </div>
          ) : null}

          {/* 操作回执。⚠ 增强类是 fail-open，但**失败也要说话**：
              点了导出却什么都没下载，比报个错更让人以为是自己点错了。 */}
          {toast ? (
            <div
              className={`absolute left-1/2 top-0 max-w-[70%] -translate-x-1/2 rounded-b-md px-3 py-1.5 text-[11px] shadow-lg ${
                toastIsLoss
                  ? "bg-amber-500 text-white"
                  : "pointer-events-none bg-stone-800/90 text-white"
              }`}
              data-testid="sliderule-canvas-toast"
            >
              {toast}
              {toastIsLoss ? (
                <button
                  type="button"
                  className="ml-2 underline underline-offset-2"
                  onClick={() => setToast(null)}
                  data-testid="sliderule-canvas-toast-dismiss"
                >
                  知道了
                </button>
              ) : null}
            </div>
          ) : null}

          {/* 空态：一页都还没到。⚠ 不画假画板占位——本仓不允许"看起来有东西"。 */}
          {pages.length === 0 ? (
            <div
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-stone-400"
              data-testid="sliderule-canvas-empty"
            >
              <MousePointerClick className="h-5 w-5" />
              <span className="text-[12px]">
                {running
                  ? "页面还在生成，画好一页就落到这张画布上"
                  : "这一轮没有可看的页面"}
              </span>
            </div>
          ) : null}
        </div>

        {picked ? (
          <CanvasElementPanel
            picked={picked}
            html={pages.find(p => p.pageId === picked.pageId)?.html ?? ""}
            pageName={nameOf(picked.pageId)}
            onApply={applyElementEdit}
            onClose={() => setPicked(null)}
          />
        ) : null}

        {pickedBlock && !picked ? (
          /* ⚠ 元素面板优先：两个面板同时出现会挤在一起，而用户此刻关心的是
             他刚 Ctrl+点的那个元素。块面板等元素面板关掉再回来。 */
          <CanvasBlockPanel
            pageId={pickedBlock.pageId}
            pageName={nameOf(pickedBlock.pageId)}
            blockName={pickedBlock.name}
            kindLabel={
              blockRects[pickedBlock.pageId]?.rects.find(
                r => r.name === pickedBlock.name
              )?.kindLabel ?? "块"
            }
            indexInPage={(() => {
              const i =
                blockRects[pickedBlock.pageId]?.rects.findIndex(
                  r => r.name === pickedBlock.name
                ) ?? -1;
              return i >= 0 ? i + 1 : null;
            })()}
            live={blockFit.live.has(
              blockKey(pickedBlock.pageId, pickedBlock.name)
            )}
            bindings={
              blockBindings.find(
                b => b.key === blockKey(pickedBlock.pageId, pickedBlock.name)
              ) ?? null
            }
            impactEdges={impactEdges}
            labelOfKey={labelOfBlockKey}
            canEdit={!!appId}
            onRewrite={ins =>
              rewriteBlock(pickedBlock.pageId, pickedBlock.name, ins)
            }
            onPreview={html => onPagesReplaced?.({ [pickedBlock.pageId]: html })}
            onSave={html => applyElementEdit(pickedBlock.pageId, html)}
            onClose={() => setPickedBlock(null)}
          />
        ) : null}

        {replacingAsset ? (
          <AssetReplacePanel
            asset={replacingAsset}
            nameOf={nameOf}
            onReplace={replaceAsset}
            onClose={() => setReplacingUrl(null)}
            disabledReason={
              appId
                ? null
                : "这个会话还没存成应用（推演跑完才会落库），现在还改不了页面。"
            }
          />
        ) : null}

        {inspectorOpen ? (
          <CanvasInspector
            facts={facts}
            nameOf={nameOf}
            onClose={() => setInspectorOpen(false)}
            onJumpToPage={jumpTo}
            onOpenInPageView={pid => onOpenInPageView?.(pid)}
            onRegenerate={regenerate}
            onRemoveLink={dropLink}
            onApplyLink={applyLink}
            onFocusAsset={a => {
              setFocusedAsset(a.url);
              const b = assetBoxes.find(x => x.url === a.url);
              if (b) {
                setAssetsShown(true);
                flow.fitBounds(
                  { x: b.x, y: b.y, width: b.w, height: b.h },
                  { padding: 1.4, duration: 260 }
                );
              }
            }}
          />
        ) : null}
      </div>

      {menu ? (
        <CanvasBoardMenu
          x={menu.x}
          y={menu.y}
          pageName={nameOf(menu.pageId)}
          onClose={() => setMenu(null)}
          onEnter={() => enter(menu.pageId)}
          onOpenInPageView={() => onOpenInPageView?.(menu.pageId)}
          onStartLink={() => {
            setLinkMode(true);
            setLinkFrom(menu.pageId);
            setToast("点另一块画板连上，Esc 取消");
          }}
          onRegenerate={() => regenerate(menu.pageId)}
          onExportPng={() => void doExportPng(menu.pageId)}
          onExportHtml={() => doExportHtml(menu.pageId)}
          onCopyPageId={() => copyPageId(menu.pageId)}
        />
      ) : null}
    </div>
  );
}

/**
 * 对外入口。ReactFlowProvider 必须在外层：useReactFlow / useStore 都要它，
 * 而画布本体自己就在用（缩放药丸、进板动画）。
 */
export function SpecPageCanvasStage(
  props: SpecPageCanvasStageProps
): React.ReactElement {
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col ${props.className ?? ""}`}
    >
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
