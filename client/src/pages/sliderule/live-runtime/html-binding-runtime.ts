/**
 * HTML 绑定解释器 —— 把第 6.5 步打进 HTML 的 data-* 孔填成真数据。
 *
 * ## 它在链路的哪一头
 *
 *     3    spec 每一页 → HTML          只有版式，一个数字都不写
 *     6    汇合 → 五系统模型            实体/字段/角色/权限/节点在此定死
 *     6.5  给 HTML 打 data-* 绑定孔     services/html_bindings.py
 *     ——— 到这里，页面上有孔但没人填 ———
 *     **本文件**：运行时按孔取数、填进去
 *
 * 用用户那个比喻：HTML 是木偶，五系统模型是那双手，`data-*` 是木偶身上让线
 * 穿过去的孔。**本文件是穿线的那一下。** 没有它，前六步的产物在产品里
 * 仍然是一张静态图。
 *
 * ## 为什么是纯函数，不是组件
 *
 * 判据要能机械跑。做成 React 组件就只能靠渲染快照测，而今天在「造个代理去
 * 替代看一眼」上栽了四次。这里把解释逻辑做成对一棵已有 DOM 的纯操作，
 * jsdom 里直接断言节点和文本——**改一个字段就能断言多一列**，这正是 G2 组
 * 验过的那条判据（`experiments/visual-first/g2_render_test.mjs`）。
 *
 * 宿主安全（Shadow DOM 隔离 + DOMPurify）由挂载它的那一层负责，不在这里，
 * 理由是那两件事各自有各自的判据，混在一个函数里两边都测不干净。
 *
 * ## 词汇表照 docs/绑定契约草案-v1.md，一个字不自创
 *
 *     data-rows="<entity>"        逐行容器；可带 data-sort / data-order / data-limit
 *     data-record="<entity>"      **单条记录作用域**；可带 data-record-id
 *                                 （没写 id 时读宿主 selection，再没有才第一条）
 *     data-field="<fieldId>"      取**当前作用域**那条记录的字段
 *                                 （行内 = 当前行，data-record 内 = 那一条）
 *     data-head="<entity>" + data-col   表头按字段清单展开
 *     data-cell                   行内单元格模板，按字段清单展开
 *     data-value + data-aggregate 单值聚合（count / sum / avg / max / min）
 *     data-chart + data-entity + data-dimension + data-metric   图表
 *     data-action + data-entity   动作，点了发事件
 *
 * ⚠ 动作词表**每种语言只有一份**（2026-08-14 晚收拢）：前端就是本文件的
 *   ACTION_KINDS（block-registry 的 FreeformActionRef 直接引用 ActionKind 类型），
 *   Python 是 html_bindings.ACTION_KINDS（freeform_block 查它校验）。
 *   两份之间靠 test_html_bindings 的跨语言看门测试钉死——**词表分叉就是
 *   下一个对不齐的地方**，本仓在「手写 uses 声明 / 前端手抄区域词汇」上
 *   踩过两次。加词只改两处：本文件 + html_bindings.py，看门测试不改就红。
 */

import { formatFieldText, EMPTY_TEXT } from "./field-text";

export const HTML_BINDING_RUNTIME_VERSION = "html-binding-runtime-v1";

/**
 * 这套词汇里**所有**属性名。消毒那一层要照它放行，别处不许手抄第二份。
 *
 * ## 为什么必须是单一来源
 *
 * 宿主消毒用的是 `ALLOW_DATA_ATTR: false` + 显式白名单（理由见
 * bound-html-surface.tsx）——也就是说**没列进白名单的 data-* 会被静默删掉**。
 * 删掉之后页面照常渲染、消毒器照常报成功、解释器 problems 也是空的
 * （没有孔就没有错误的孔），**那个能力整条无声消失**。
 *
 * 这正是本仓数到第九次的形状。而它最常见的成因是**同一份清单被抄了两遍**：
 * 「区块 uses 声明」与实际渲染不符 316 个、前端手抄的区域词汇与目录漂移——
 * 都是这么来的。所以词表只有这一份，消毒那边 import 它。
 */
export const BINDING_ATTRS = [
  // 逐行容器与它的取数参数
  "data-rows", "data-sort", "data-order", "data-limit", "data-fields",
  // 单条记录作用域（只建作用域、不迭代）。照 petite-vue 的 v-scope：
  // 它跟 v-for 走同一个 createScopedContext，读字段的指令不关心作用域从哪来。
  "data-record", "data-record-id",
  // 表头 / 单元格模板
  "data-head", "data-col", "data-cell",
  // 取值
  "data-field", "data-value", "data-aggregate",
  // 图表
  "data-chart", "data-entity", "data-dimension", "data-metric", "data-metric-field",
  // 动作
  "data-action",
  // 搜索 / 筛选 / 购物车视图（照 petite-vue v-model / v-on：指令打在标签上）
  "data-search", "data-filter", "data-match", "data-view", "data-delta", "data-cart-qty",
  // 运行时**写回**的三个：行 id、算好的 series、动作上锁的原因。
  // ⚠ 它们由解释器写、不由生成侧写，但消毒发生在解释之**前**也可能在之后
  //   （重新消毒一份已填好的 HTML），漏了它们等于点击丢行、图表丢数、锁丢因。
  "data-row-id", "data-series", "data-locked",
] as const;

/** 一行数据。键是 fieldId。 */
export type BindingRow = Record<string, unknown>;

export interface BindingField {
  id: string;
  name?: string;
  /** 缺省当 "string"（模型里字段类型可以不写，读侧不该因此炸） */
  type?: string;
  /** money / percent / progress / score / mask…（见 field-display 的 FieldFormat） */
  format?: string;
  /**
   * enum 声明取值。
   *
   * ⚠ 键是 **id**，不是 value。头一版写的是 `{ value, label }`，而
   * `formatFieldText` 读的是 `o.id`——两边对不上的后果不是报错，是
   * **enum 恒显内部 id**（`music_member` 这种漏到界面上，线上截图逮到过）。
   * 页面照常渲染、解释器 problems 是空的、消毒器照常成功，没有一处会红。
   *
   * 当时那行注释写着"与 field-text 的 FieldLike 对齐"，而它并没有对齐——
   * 注释声称的对齐必须由类型或转换函数**兑现**，见下面的 asFieldLike。
   */
  options?: Array<{ id: string; label?: string }>;
}

/**
 * BindingField → field-text 要的 FieldLike。**真转一次，不是类型断言。**
 *
 * 断言只会让编译器闭嘴，字段形状该对不上还是对不上（上面那条 options 就是
 * 这么漏的）。这里补齐 FieldLike 要求的三处：type 缺省、label 缺省回落 id、
 * tone 缺省 default。
 */
function asFieldLike(f: BindingField) {
  return {
    type: f.type || "string",
    format: f.format as FieldLikeFormat,
    options: f.options?.map((o) => ({
      id: o.id,
      label: o.label ?? o.id,
      tone: "default" as const,
    })),
  };
}

type FieldLikeFormat = NonNullable<
  Parameters<typeof formatFieldText>[1]
>["format"];

export interface BindingSource {
  /** entityId → 行数组 */
  rows: Record<string, BindingRow[]>;
  /** entityId → 字段定义（顺序即列序） */
  fields: Record<string, BindingField[]>;
  /**
   * 宿主当前选中的行 id。详情卡没写 data-record-id 时用这份，
   * 跟 petite-vue `evaluate(ctx.scope, exp)` 一样：对象在宿主，不写进模板。
   */
  selected?: Record<string, string>;
  /**
   * 购物车行（带 qty）。同一页两个 data-rows 绑同一实体时，
   * 非 grid / 非表的那一份读这里，不要把整张商品表倒进去。
   */
  cartRows?: Record<string, BindingRow[]>;
  /** 货架搜索词 / 筛选芯片。只滤非购物车的 data-rows。 */
  catalogQuery?: Record<string, string>;
  catalogChip?: Record<string, string>;
}

/**
 * 动作封闭词表。数组是运行时判定用的**唯一真相源**，类型从它派生——
 * 写成手抄 union 的话，加词只改类型不改数组，判定会把新词当垃圾拒掉。
 *
 * 总表由两个子表**组合**而成（2026-08-14 晚收拢）：之前总表和转移子表
 * 是两份重叠手写，改一处漏一处。现在每个词只出现一次。
 */
/** 记录三种（openRecord/editRecord 要当前行）。 */
export const RECORD_ACTION_KINDS = ["createRecord", "openRecord", "editRecord"] as const;

/** 转移三种：把行提交进审批流 / 通过 / 驳回。三个都要当前行、
 *  要实体真的挂了流程——流程实例是挂在具体那条记录上的（entityRef）。 */
export const WORKFLOW_ACTION_KINDS = [
  "submitWorkflow", "approveWorkflow", "rejectWorkflow",
] as const;

/** 购物车四种。照 Stimulus：动作写在标签上，不猜「清空」「结算」。 */
export const CART_ACTION_KINDS = [
  "addToCart", "adjustCartQty", "clearCart", "checkout",
] as const;

export const ACTION_KINDS = [...RECORD_ACTION_KINDS, ...WORKFLOW_ACTION_KINDS, ...CART_ACTION_KINDS] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];
export type WorkflowActionKind = (typeof WORKFLOW_ACTION_KINDS)[number];
/** 购物车四种。自由树的 actionRef 不负责它们，见 block-registry 的 eventByKind。 */
export type CartActionKind = (typeof CART_ACTION_KINDS)[number];

/** 使用点判断"是不是转移词"统一走这里——别再手写三个 `===` 串。 */
export function isWorkflowActionKind(v: string): v is WorkflowActionKind {
  return (WORKFLOW_ACTION_KINDS as readonly string[]).includes(v);
}

/** 运行时从画面推出来的动作，不进封闭词表、不写进 HTML。 */
export const IMPLICIT_ACTION_KINDS = ["filterCatalog"] as const;
export type ImplicitActionKind = (typeof IMPLICIT_ACTION_KINDS)[number];

export function isImplicitActionKind(v: string): v is ImplicitActionKind {
  return (IMPLICIT_ACTION_KINDS as readonly string[]).includes(v);
}

export function isRecordActionKind(v: string): v is (typeof RECORD_ACTION_KINDS)[number] {
  return (RECORD_ACTION_KINDS as readonly string[]).includes(v);
}

/**
 * 孔驱动的点击。照 petite-vue v-on / Stimulus：认标签上的 data-*，不认文案。
 * 已有 data-action 的不抢——交给 applyBindings 挂的监听。
 */
export function implicitActionFromClick(
  target: Element | null,
  root: Element
): BindingActionEvent | null {
  if (!target || !root.contains(target)) return null;
  if (target.closest("input, textarea, select, [data-action]")) return null;

  const filterEl = target.closest("[data-filter]");
  if (filterEl && !filterEl.closest("[data-rows]")) {
    const entityId = filterEl.getAttribute("data-filter") || "";
    const match = (filterEl.getAttribute("data-match") || "*").trim();
    if (entityId) {
      return {
        kind: "filterCatalog",
        entityId,
        rowId: null,
        chip: !match || match === "*" ? "" : match,
      };
    }
  }

  const rowEl = target.closest("[data-row-id]");
  const box = rowEl?.closest("[data-rows]");
  if (!rowEl || !box) return null;
  const entityId = box.getAttribute("data-rows") || "";
  const rowId = rowEl.getAttribute("data-row-id") || "";
  if (!entityId || !rowId) return null;

  const peers = root.querySelectorAll(
    `[data-rows="${entityId.replace(/"/g, "")}"]`
  );
  if (Array.from(peers).some(peer => isCartList(peer, root)) && !isCartList(box, root)) {
    return { kind: "addToCart", entityId, rowId };
  }
  return { kind: "openRecord", entityId, rowId };
}

export interface BindingActionEvent {
  kind: ActionKind | ImplicitActionKind;
  entityId: string;
  /** 行内动作带得出当前行 id；页头动作没有行，为 null */
  rowId: string | null;
  /** adjustCartQty 用：+1 / -1 */
  delta?: number;
  /** filterCatalog：data-match 的词；空 / * = 全部 */
  chip?: string;
}

/**
 * 角色上下文——权限那只手伸进页面的形状（2026-08-14 晚）。
 *
 * 模式照 CASL 的 ability：宿主按当前角色**派生一次**（rbac-preview 的
 * deriveHtmlActionGates），解释器填孔时逐点检查。无权的动作**禁用不隐藏**
 * ——版式一个像素不能动（打孔那步的纪律），且用户该知道这个动作存在、
 * 只是当前角色没权（锁原因写进 title，游标也能读到）。
 *
 * 不传 gates = 不设卡（跟 rbac-preview 一贯的语义：没声明就是公共的）。
 */
export interface ActionGates {
  /** 当前角色 id；null = 模型没声明角色，不设卡 */
  role?: string | null;
  /** 给人看的角色名（锁话术用） */
  roleLabel?: string;
  /**
   * entityId → 新建卡。语义与 rbac-preview 的 PageAccess.canCreate 同源：
   * 页面声明了 *:create 权限才有卡；granted=false 时锁。
   */
  createGate?: Record<string, { permission: string; granted: boolean }>;
  /**
   * 挂了审批流的实体（页面 workflowLinked 且有主实体）。undefined = 不校验
   * （宿主没算，别把没算当成没挂）；空数组 = 真的一个都没挂。
   */
  workflowEntities?: readonly string[];
}

export interface ApplyBindingsOptions {
  source: BindingSource;
  onAction?: (event: BindingActionEvent) => void;
  /** 行 id 从哪个字段取。缺省 "id"。 */
  rowIdField?: string;
  /** 角色上下文。不传 = 不设卡。 */
  gates?: ActionGates;
}

export interface ApplyBindingsReport {
  version: string;
  /** 各类孔各填了多少个 */
  filled: Record<string, number>;
  /** 填不了的孔（引用了不存在的实体/字段等），每条都说清是哪儿 */
  problems: string[];
}

const ROW_TPL = "__slideruleRowTpl";
const HEAD_TPL = "__slideruleHeadTpl";
const OVERLAY_TPL = "__slideruleOverlayTpl";

interface TemplateCache {
  [ROW_TPL]?: Element;
  [HEAD_TPL]?: Element;
  [OVERLAY_TPL]?: Element[];
}

/**
 * 行模板 vs 装饰层。
 *
 * ⚠ 2026-08-31 会聚通 p1 时段矩阵：
 *
 *     <div data-rows="meeting_room">
 *       <div class="absolute … pointer-events-none">当前时间线</div>  ← 装饰
 *       <div class="h-14">… <span data-field="name">启明星</span></div>
 *
 * 旧挑选是 ``tr || firstElementChild``。时间线是第一个子元素，于是被缓存成
 * ROW_TPL，``innerHTML=""`` 之后按实体数克隆 N 条红线，真正的房间行被擦掉。
 * 页脚 ``data-value count`` 填成 6，看起来像「画了 6 间」，用户看见的是
 * 一块白 + 一条红线。
 *
 * 对照 FullCalendar 的 now-indicator：刻度一层、资源行一层、now-line 是
 * 独立覆盖层，不是行模板。petite-vue 的 v-for 也是重复带绑定的那一个节点。
 */
function hasBindHole(el: Element): boolean {
  return (
    el.hasAttribute("data-field") ||
    el.hasAttribute("data-cell") ||
    !!el.querySelector("[data-field],[data-cell]")
  );
}

function isOverlayChild(el: Element): boolean {
  if (hasBindHole(el)) return false;
  const cls = el.getAttribute("class") || "";
  return /\babsolute\b/.test(cls) || /\bpointer-events-none\b/.test(cls);
}

/**
 * data-rows 常常打在滚动层上，真正重复的项在里面那一层 `grid` 里。
 *
 * ⚠ 2026-09-07 烘焙坊收银台：
 *
 *     <div class="overflow-y-auto" data-rows="product">
 *       <div class="grid grid-cols-4">
 *         <!-- 只有一张模板卡 -->
 *
 *   旧逻辑把 **grid 整块**当行模板，`innerHTML=""` 后再克隆 12 份网格。
 *   每份仍是四列、里面一张卡 → 画面上一列卡、右边空出三列。
 *   petite-vue / Alpine 的循环打在**项**上，父网格从不清空外壳。
 *
 *   只有「唯一子节点是 grid」时才把宿主下移；购物车那种 `space-y-3`
 *   直接挂条目的，仍以 data-rows 自己为宿主。
 */
export function rowsHost(box: Element): Element {
  const kids = Array.from(box.children).filter((el) => !isOverlayChild(el));
  if (kids.length !== 1) return box;
  const only = kids[0];
  if (
    only.hasAttribute("data-rows") ||
    only.hasAttribute("data-record")
  ) {
    return box;
  }
  const cls = only.getAttribute("class") || "";
  if (/\bgrid\b/.test(cls)) return only;
  return box;
}

/**
 * Cart semantics require an explicit marker; layout does not identify data.
 */
export function isCartList(box: Element, root: Element): boolean {
  return root.contains(box) && box.getAttribute("data-view") === "cart";
}

function stampRowId(rowEl: Element, rid: unknown): void {
  // ⚠ 不能 `instanceof HTMLElement`：iframe 里的节点是另一份 realm，
  //   父页的 HTMLElement 对不上，属性根本打不上。jsdom 单测同 realm 绿、
  //   真机点了没反应（2026-09-07 烘焙坊收银台）。
  const id = rid == null ? "" : String(rid);
  rowEl.setAttribute("data-row-id", id);
  selfAndDescendants<HTMLElement>(rowEl, "[data-action]").forEach(el => {
    el.setAttribute("data-row-id", id);
  });
}

function fillCartQuantity(rowEl: Element, quantity: unknown): void {
  const n = Number(quantity);
  const text = quantity != null && Number.isFinite(n) ? String(n) : EMPTY_TEXT;
  selfAndDescendants<HTMLElement>(rowEl, "[data-cart-qty]").forEach(el => {
    // Nested row containers are filled independently, like data-field.
    const owner = el.parentElement?.closest("[data-rows]");
    if (owner && owner !== rowEl && rowEl.contains(owner)) return;
    setFieldText(el, text);
  });
}

export function catalogEntityId(root: Element): string {
  const boxes = Array.from(root.querySelectorAll("[data-rows]"));
  const shelf = boxes.find(b => !isCartList(b, root));
  return (shelf || boxes[0])?.getAttribute("data-rows") || "";
}

export function chipStem(label: string): string {
  return label.replace(/\s*\(\d+\)\s*$/, "").trim();
}

export function rowBlob(row: BindingRow): string {
  return Object.values(row)
    .map(v => String(v ?? ""))
    .join(" ")
    .toLowerCase();
}

export function catalogChipKeys(chip: string): string[] {
  const stem = chipStem(chip);
  if (!stem || stem === "*") return [];
  return [stem];
}

export function filterCatalogRows(
  rows: BindingRow[],
  query: string | undefined,
  chip: string | undefined
): BindingRow[] {
  const q = (query || "").trim().toLowerCase();
  const keys = catalogChipKeys(chip || "");
  return rows.filter(row => {
    const blob = rowBlob(row);
    if (q && !blob.includes(q)) return false;
    if (!keys.length) return true;
    return keys.some(k => blob.includes(k.toLowerCase()));
  });
}

export function findCatalogSearchInput(root: Element): HTMLInputElement | null {
  const el = root.querySelector("[data-search]");
  if (!el) return null;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return el as HTMLInputElement;
  return (el.querySelector("input, textarea") as HTMLInputElement | null) ?? null;
}

export function searchEntityId(el: Element | null): string {
  if (!el) return "";
  return (
    el.getAttribute("data-search") ||
    el.closest("[data-search]")?.getAttribute("data-search") ||
    ""
  );
}

function pickRowTemplate(box: Element): Element | null {
  const directTr = box.querySelector(":scope > tr");
  if (directTr) return directTr;
  const kids = Array.from(box.children);
  const withHole = kids.find(hasBindHole);
  if (withHole) return withHole;
  const nonOverlay = kids.find((el) => !isOverlayChild(el));
  if (nonOverlay) return nonOverlay;
  return kids[0] || null;
}

function pickOverlayChildren(box: Element, rowTpl: Element): Element[] {
  return Array.from(box.children).filter((el) => el !== rowTpl && isOverlayChild(el));
}

const MEDIA_SEL = "img, picture, video, canvas, iframe";

function childHasImg(el: Element): boolean {
  return el.tagName === "IMG" || !!el.querySelector("img");
}

/**
 * 货架上的画面项：带图的直接子节点；若只有一个包装层（grid / 卡片墙），
 * 再往里看一层。装饰层不算。
 *
 * 对照 petite-vue `v-for`（for.ts:20-25）：指令打在**被重复的那一项**上，
 * 父节点只 `removeChild(模板)`，从不 `innerHTML=""`。Alpine `x-for` 同口径
 * （x-for.js 的 templateEl 是那一项，兄弟节点不动）。
 */
function galleryItems(box: Element): Element[] {
  const direct = Array.from(box.children).filter(
    (el) => !isOverlayChild(el) && childHasImg(el)
  );
  if (direct.length >= 2) return direct;
  if (direct.length === 1) {
    const nested = Array.from(direct[0].children).filter(childHasImg);
    if (nested.length >= 2) return nested;
  }
  return direct;
}

function distinctImgSrcs(root: Element): Set<string> {
  const srcs = new Set<string>();
  for (const img of root.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src") || "";
    if (src) srcs.add(src);
  }
  return srcs;
}

/**
 * 多张不同 src 的图在容器里 = 这一页的画面，不是「只留一行」的台账模板。
 *
 * ⚠ 2026-09-01 幼儿作息：素材栏抽出 6 张 Unsplash，画面上没了。源 HTML
 * 还在；`data-rows` 打在货架容器上之后 applyBindings 走 ``innerHTML=""``
 * 再按实体数克隆第一项——N=0 清空，N=1~2 只剩第一张的复印件。
 * 2026-08-31 团子的一天只改提示词「至少留 4 张」，运行时没改，闸绿、图还是没。
 *
 * 真机常见形状不是四张 figure 平铺，而是 ``<div data-rows><div class="grid">``
 * 再包四张图——所以认的是**整棵子树里有没有 ≥2 个不同 src**，不认直接子节点。
 *
 * 表路径（tbody / thead / table）仍按行展开：台账可以有两行示例图，那是要删的。
 */
function looksLikeCardLedger(box: Element): boolean {
  if (box.querySelector("[data-record]")) return true;
  const items = Array.from(box.children).filter((el) => !isOverlayChild(el));
  if (items.length < 2) return false;
  return items.every(
    (el) => el.querySelectorAll("[data-field]").length >= 2
  );
}

function isStaticGallery(box: Element): boolean {
  const tag = box.tagName;
  if (tag === "TBODY" || tag === "THEAD" || tag === "TABLE") return false;
  // 卡片台账每张卡也有头像/封面图。≥2 张不同 src 不等于货架。
  if (looksLikeCardLedger(box)) return false;
  return distinctImgSrcs(box).size >= 2;
}

/**
 * 行里未绑定的时间块（absolute + 有字、自己没有 data-field）。
 *
 * 对照 FullCalendar resource timeline：资源行是骨架，事件是另一份数据，
 * 不写进资源模板里跟着 clone。petite-vue / Alpine 的循环打在项上，
 * 父容器从不清空——多行已经画好的日程应当留着。
 */
function unboundLaneChips(row: Element): Element[] {
  return Array.from(row.querySelectorAll(".absolute")).filter((el) => {
    if (hasBindHole(el)) return false;
    return (el.textContent || "").trim().length > 0;
  });
}

function laneSignature(row: Element): string {
  return unboundLaneChips(row)
    .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("|");
}

function laneItems(box: Element): Element[] {
  return Array.from(box.children).filter(
    (el) => !isOverlayChild(el) && hasBindHole(el)
  );
}

function isTableBox(box: Element): boolean {
  const tag = box.tagName;
  return tag === "TBODY" || tag === "THEAD" || tag === "TABLE";
}

/**
 * 多行且时间块文案不同 = 这一页已经画好的矩阵，不是「只留一行」的台账模板。
 *
 * ⚠ 2026-09-01 会席宝今日排期：静态页每间会议室日程不同，「已接数据」
 * 一亮全变成第一行的复印件。顶栏 filled 几十，用户以为数据源写错了。
 * 日历 / 排期 / 甘特 / 矩阵都会这样，不限于会议室。
 *
 * 表路径仍按行展开。
 */
function isStaticLane(box: Element): boolean {
  if (isTableBox(box)) return false;
  const items = laneItems(box);
  if (items.length < 2) return false;
  const sigs = new Set(items.map(laneSignature).filter(Boolean));
  return sigs.size >= 2;
}

function stripUnboundLaneChips(row: Element): void {
  for (const chip of unboundLaneChips(row)) chip.remove();
}

function paintedItems(box: Element): Element[] | null {
  if (isStaticGallery(box)) return galleryItems(box);
  if (isStaticLane(box)) return laneItems(box);
  return null;
}

/**
 * 把字段值写进孔。petite-vue `v-text` / Alpine `x-text` 都是打在文字叶子上
 * 的；我们的生成侧常把 `data-field` 盖在还含 `<img>` 的父节点上，
 * ``textContent =`` 会把子图一并抹掉——跟上面清空货架是同一类静默事故。
 */
function setFieldText(el: HTMLElement, text: string): boolean {
  if (el.querySelector(MEDIA_SEL)) {
    // 不含 div：卡片渐变遮罩是空 div，写进去看不见，filled.field 却照加。
    const leaf = Array.from(
      el.querySelectorAll<HTMLElement>(
        "span, p, figcaption, h1, h2, h3, h4, h5, h6, time, em, strong, small, label, a"
      )
    ).find((n) => n.childElementCount === 0 && !n.matches(MEDIA_SEL));
    if (!leaf) return false;
    leaf.textContent = text;
    return true;
  }
  el.textContent = text;
  return true;
}

/** 排序：只按字段值比大小，认不出就保持原序（不排比乱排好）。 */
function sortRows(rows: BindingRow[], sortBy: string, order: string): BindingRow[] {
  if (!sortBy) return rows;
  const dir = order.toLowerCase() === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[sortBy];
    const y = b[sortBy];
    if (x == null && y == null) return 0;
    if (x == null) return 1;   // 空值恒沉底，不受升降序影响——空不是"最小"，是"没有"
    if (y == null) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x).localeCompare(String(y), "zh") * dir;
  });
}

function clampLimit(raw: string | null): number | null {
  // ⚠ 不能写 Number(raw)：raw 为 null 时 Number(null) === 0，
  //   于是「没写 limit」会被解释成「只要 0 行」。这个坑本仓踩过一次。
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), 200);
}

function aggregate(kind: string, rows: BindingRow[], fieldId: string, cart = false): string {
  if (kind === "count") return String(rows.length);
  const nums = rows
    .map((r) => {
      if (r[fieldId] == null || String(r[fieldId]).trim() === "") return NaN;
      const n = Number(r[fieldId]);
      if (!Number.isFinite(n)) return NaN;
      const qty = Number(r.qty);
      return cart && kind === "sum" && Number.isFinite(qty) && qty > 0 ? n * qty : n;
    })
    .filter((n) => Number.isFinite(n));
  // 空数据不显 0 —— 0 是个真值，拿它冒充"没有"是在撒谎。
  // 这条跟 ✦3「sum 空数据显 —」同一口径（SQL / pandas 语义）。
  if (!nums.length) return EMPTY_TEXT;
  switch (kind) {
    case "sum": return String(nums.reduce((a, b) => a + b, 0));
    case "avg": return String(Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100);
    case "max": return String(Math.max(...nums));
    case "min": return String(Math.min(...nums));
    default: return EMPTY_TEXT;
  }
}

function fieldOf(fields: BindingField[] | undefined, id: string): BindingField | undefined {
  return (fields || []).find((f) => f.id === id);
}

/**
 * 把一棵 DOM 上的 data-* 孔填成真数据。**就地修改 root**，返回填充报告。
 *
 * 可重复调用：模板在首次调用时被缓存到节点上，之后每次都从模板重建，
 * 所以「改一份 JSON 再调一次」能得到正确结果，而不是在上一次的产物上叠加。
 * 这正是「只迭代业务逻辑模型就能无限迭代」那句话在运行时的落点。
 */
/**
 * 在一个**作用域元素**内部填充 `data-field`。
 *
 * ⚠ 抽出来是为了让「一行」和「一条记录」共用同一段逻辑——这条是照
 *   petite-vue 学的：它的 `v-scope` 和 `v-for` 都走同一个
 *   `createScopedContext(ctx, data)`（walk.ts:44 与 for.ts:105），
 *   而读字段的指令根本不关心作用域是循环建的还是 scope 建的。
 *
 *   我们原来把「作用域」和「迭代」焊死在 `data-rows` 一个词里，于是详情卡
 *   （只要作用域、不要循环）无路可走——真机上模型只能把 data-field 打在
 *   容器外面，然后被判据拦下、整页 bind 失败。
 */
/**
 * 作用域**自己和它的后代**里匹配 selector 的元素。
 *
 * ⚠ `querySelectorAll` **只找后代，不含自己**。真机（健身房 p4）撞上：
 * 行模板的根节点自己带着 `data-action="openRecord"`——
 *
 *     <div data-rows="lesson_bill">
 *       <div data-action="openRecord" data-entity="lesson_bill">   ← 行根节点
 *
 * 于是 `tr.querySelectorAll("[data-action]")` 一个都没找到，行 id 没打上，
 * 12 个动作全报「取不到行 id，不挂监听」——**整块列表点不动**。
 * 而 Python 侧判据看的是标签嵌套，判 0 条：又一次两边语义不一致。
 */
function selfAndDescendants<T extends Element>(scope: Element, selector: string): T[] {
  const out = Array.from(scope.querySelectorAll<T>(selector));
  if (scope.matches(selector)) out.unshift(scope as unknown as T);
  return out;
}


function fillFields(
  scope: Element,
  record: Record<string, unknown>,
  fields: Array<{ id: string; name?: string; type?: string }>,
  entityId: string,
  problems: string[],
  filled: Record<string, number>,
  /** 这一轮是不是"行内"（data-rows 的每一行）。决定嵌套 data-record 归谁填。 */
  inRow: boolean
): void {
  selfAndDescendants<HTMLElement>(scope, "[data-field]").forEach((el) => {
    // ⚠ **内层作用域的字段归内层管**（2026-08-16 真机揪出来的）。
    //
    // querySelectorAll 抓的是**全部后代**，包括嵌套在内层 data-rows /
    // data-record 里的字段。真机形状（健身房 p1/p2）：
    //
    //     <div data-record="member">          ← 会员详情卡
    //       …
    //       <tbody data-rows="consumption_record">   ← 里面套着消费流水表
    //         <td data-field="date">…         ← 它属于 consumption_record
    //
    // 不判归属的话，member 那一轮会把 date/store_ref/project_name 也认领走，
    // 然后报「不是实体 member 的字段」——真机一页报 8~9 条。
    //
    // ⚠ 而 Python 侧的 scan_bindings 用**标签栈**，内层作用域天然覆盖外层，
    //   所以它判 0 problems。**两边语义不一致**：判据说没事，运行时报一串。
    //   petite-vue 靠原型链实现同样的覆盖（createScopedContext），
    //   这里结构简单，按 closest 判归属就够——但必须判。
    //
    // ⚠ 判据是「内层那个作用域**会不会被独立处理**」，不是「有没有内层作用域」。
    //
    //   内层 data-rows            → 上面那一轮一定会处理它  → 跳过
    //   内层 data-record 在行里    → record 那一轮会 closest 守卫跳过它，
    //                               约定是**由当前行来填**（见下面那段注释与
    //                               「不许把行内字段覆盖成同一条」用例）→ 不跳
    //   内层 data-record 不在行里  → record 那一轮会处理它 → 跳过
    //
    // ⚠ 第一版只判「有没有内层作用域」，把行里那个 data-record 也跳了，
    //   既有用例当场红（三行的 owner 全留在占位符 'y'）。
    // ⚠ 第二版改成去 DOM 里查「这个 data-record 在不在 data-rows 里」——**也错**：
    //   行内那一轮的 scope 是**还没挂进文档的克隆行**，closest 查不到外面的
    //   容器，于是判成"独立处理"又跳了。所以用显式的 inRow，不靠挂载状态。
    const owner = el.parentElement?.closest("[data-rows],[data-record]");
    if (owner && owner !== scope && scope.contains(owner)) {
      // 内层 data-rows 一定会被那一轮独立处理；内层 data-record 只有**不在行里**
      // 时才会（record 那一轮自己有 closest("[data-rows]") 守卫）。
      const ownedIndependently = owner.hasAttribute("data-rows") || !inRow;
      if (ownedIndependently) return;
    }

    const fid = el.getAttribute("data-field") || "";
    const f = fieldOf(fields, fid);
    if (!f) {
      problems.push(`data-field="${fid}"：不是实体 ${entityId} 的字段`);
      return;
    }
    if (setFieldText(el, formatFieldText(record[fid], asFieldLike(f)))) {
      filled.field += 1;
    } else {
      problems.push(
        `data-field="${fid}"：有图的孔里找不到可写文字叶子，值没写上`
      );
    }
  });
}

// 照 HTMX / Stimulus：点击挂在根上委托。搜索 bindNow 每按一键再跑
// applyBindings，逐钮 addEventListener 会让「结算」点一次发 N 次。
const actionDelegates = new WeakSet<Element>();
const actionHandlers = new WeakMap<Element, (e: BindingActionEvent) => void>();

export function applyBindings(
  root: Element,
  opts: ApplyBindingsOptions
): ApplyBindingsReport {
  const { source, onAction } = opts;
  const rowIdField = opts.rowIdField || "id";
  const filled: Record<string, number> = {
    rows: 0, record: 0, field: 0, head: 0, value: 0, chart: 0, action: 0, locked: 0,
  };
  const problems: string[] = [];

  // ── 表头：按字段清单展开 ────────────────────────────────────────
  root.querySelectorAll<HTMLElement>("[data-head]").forEach((head) => {
    const entityId = head.getAttribute("data-head") || "";
    const fields = source.fields[entityId];
    if (!fields) {
      problems.push(`data-head="${entityId}"：模型里没有这个实体`);
      return;
    }
    const cache = head as unknown as TemplateCache;
    // ⚠ 父节点必须**从活 DOM 上现查**，不能从缓存的模板上取。
    //   缓存的是 cloneNode 出来的**游离节点**，它的 parentElement 恒为 null——
    //   第二次调用时走缓存分支就会直接 return，表现是「改了字段清单，列不跟」，
    //   而这正是 G2 那条判据要验的东西。一次都不报错，只是不动。
    const live = head.querySelector("[data-col]");
    if (!cache[HEAD_TPL]) {
      if (!live) {
        problems.push(`data-head="${entityId}"：里面没有 [data-col] 列模板`);
        return;
      }
      cache[HEAD_TPL] = live.cloneNode(true) as Element;
    }
    const parent = live?.parentElement || head.querySelector("tr");
    if (!parent) return;
    parent.innerHTML = "";
    fields.forEach((f) => {
      const th = cache[HEAD_TPL]!.cloneNode(true) as HTMLElement;
      th.textContent = f.name || f.id;
      parent.appendChild(th);
    });
    filled.head += fields.length;
  });

  // ── 逐行容器 ───────────────────────────────────────────────────
  root.querySelectorAll<HTMLElement>("[data-rows]").forEach((box) => {
    const entityId = box.getAttribute("data-rows") || "";
    const all = source.rows[entityId];
    if (!all) {
      problems.push(`data-rows="${entityId}"：模型里没有这个实体`);
      return;
    }
    const fields = source.fields[entityId] || [];
    const cart = isCartList(box, root);
    const listed = cart
      ? source.cartRows?.[entityId] ?? []
      : filterCatalogRows(
          all,
          source.catalogQuery?.[entityId],
          source.catalogChip?.[entityId]
        );
    let rows = sortRows(
      listed,
      box.getAttribute("data-sort") || "",
      box.getAttribute("data-order") || "asc"
    );
    const limit = clampLimit(box.getAttribute("data-limit"));
    if (limit != null) rows = rows.slice(0, limit);

    const host = rowsHost(box);
    const painted = paintedItems(host);
    if (painted) {
      painted.forEach((item, i) => {
        const row = rows[i];
        if (!row) return;
        fillFields(item, row, fields, entityId, problems, filled, true);
        if (cart) fillCartQuantity(item, row.qty);
        stampRowId(item, row[rowIdField]);
      });
      filled.rows += Math.min(painted.length, rows.length);
      return;
    }

    const cache = box as unknown as TemplateCache;
    let rowTpl = cache[ROW_TPL];
    if (!rowTpl) {
      const first = pickRowTemplate(host);
      if (!first) {
        problems.push(`data-rows="${entityId}"：容器里没有行模板`);
        return;
      }
      cache[ROW_TPL] = first.cloneNode(true) as Element;
      rowTpl = cache[ROW_TPL];
      // 单行模板里的示例会议是这一行的插画，不是每个资源的数据。
      // FullCalendar 不把事件写进资源行再 clone；这里剥掉再展开。
      stripUnboundLaneChips(rowTpl);
      const overlayOf = host === box ? first : host;
      cache[OVERLAY_TPL] = pickOverlayChildren(box, overlayOf).map(
        (el) => el.cloneNode(true) as Element
      );
    }

    host.innerHTML = "";
    rows.forEach((row) => {
      const tr = rowTpl!.cloneNode(true) as HTMLElement;
      // 单元格模板：按字段清单展开（G2 验过的那条——加字段自动多列）
      const cellAnchor = tr.querySelector("[data-cell]");
      if (cellAnchor && fields.length) {
        const parent = cellAnchor.parentElement;
        if (parent) {
          const cellTpl = cellAnchor.cloneNode(true) as HTMLElement;
          // 操作列那类**不带 data-cell 的兄弟节点**要保住，并且留在最后
          const rest = Array.from(parent.children).filter(
            (c) => !c.hasAttribute("data-cell")
          );
          parent.innerHTML = "";
          fields.forEach((f) => {
            const cell = cellTpl.cloneNode(true) as HTMLElement;
            setFieldText(cell, formatFieldText(row[f.id], asFieldLike(f)));
            parent.appendChild(cell);
          });
          rest.forEach((c) => parent.appendChild(c));
        }
      }
      // 行内 data-field：作用域是**这一行**
      fillFields(tr, row, fields, entityId, problems, filled, true);
      if (cart) fillCartQuantity(tr, row.qty);
      stampRowId(tr, row[rowIdField]);
      host.appendChild(tr);
    });
    // 装饰层（当前时间线）在行之后重新挂上。absolute 相对 data-rows
    // 这个 relative 容器，top/bottom:0 才能跨过克隆出来的 N 行。
    // 对照 FullCalendar now-indicator：覆盖层不是行模板。
    (cache[OVERLAY_TPL] || []).forEach((ov) => {
      box.appendChild(ov.cloneNode(true));
    });
    filled.rows += rows.length;
  });

  // ── 单条记录作用域 ─────────────────────────────────────────────
  //
  // 照 petite-vue 的 `v-scope`：**只建作用域、不迭代**。详情卡、主从视图的
  // 右侧面板、编辑表单都是这个形状——真机（烘焙那趟 p1 右侧「多因子算法分析」
  // 面板）就是它，而此前词表里压根没有它的位置。
  //
  // ⚠ 跳过已经在 data-rows 里的：那些字段属于「当前行」，上面那轮已经填过。
  //   petite-vue 靠原型链让内层作用域覆盖外层，我们这里结构简单，
  //   直接按 closest 判归属就够——但**必须判**，否则行内字段会被这一轮
  //   拿"第一条记录"再覆盖一次，表格里每行都变成同一条数据。
  root.querySelectorAll<HTMLElement>("[data-record]").forEach((box) => {
    if (box.closest("[data-rows]")) return;
    const entityId = box.getAttribute("data-record") || "";
    const rows = source.rows[entityId];
    const fields = source.fields[entityId];
    if (!rows || !fields) {
      problems.push(`data-record="${entityId}"：模型里没有这个实体`);
      return;
    }
    // 指定了 id 就取那条（模板写死的优先）；没写读宿主选中态；
    // 都没有才用第一条做预览。选中的那条已经被删时回落第一条，
    // 不报错——删除侧会清 selection，这里是防陈旧指针。
    const wanted = box.getAttribute("data-record-id");
    const selectedId = source.selected?.[entityId];
    const byId = (id: string) =>
      rows.find((r) => String(r[rowIdField]) === id);
    const record =
      wanted != null
        ? byId(wanted)
        : selectedId != null
          ? byId(selectedId) ?? rows[0]
          : rows[0];
    if (!record) {
      problems.push(
        `data-record="${entityId}"${wanted != null ? ` data-record-id="${wanted}"` : ""}：取不到记录`
      );
      return;
    }
    fillFields(box, record, fields, entityId, problems, filled, false);
    // 作用域里的动作同样带得出"当前这条"——跟行内一个口径
    const rid = record[rowIdField];
    selfAndDescendants<HTMLElement>(box, "[data-action]").forEach((el) => {
      el.setAttribute("data-row-id", rid == null ? "" : String(rid));
    });
    filled.record += 1;
  });

  // ── 单值聚合 ───────────────────────────────────────────────────
  root.querySelectorAll<HTMLElement>("[data-value]").forEach((el) => {
    const entityId = el.getAttribute("data-value") || "";
    let rows = source.rows[entityId];
    if (!rows) {
      problems.push(`data-value="${entityId}"：模型里没有这个实体`);
      return;
    }
    if ((el.getAttribute("data-view") || "") === "cart") {
      rows = source.cartRows?.[entityId] ?? [];
    }
    const match =
      el.getAttribute("data-match") ||
      el.closest("[data-filter]")?.getAttribute("data-match") ||
      "";
    if (match && match !== "*") {
      rows = filterCatalogRows(rows, undefined, match);
    }
    const kind = (el.getAttribute("data-aggregate") || "count").toLowerCase();
    el.textContent = aggregate(kind, rows, el.getAttribute("data-field") || "", el.getAttribute("data-view") === "cart");
    filled.value += 1;
  });

  // ── 图表：本文件只把数据算出来挂上，**不画** ────────────────────
  // 画交给 ECharts 那一层。理由是画图有自己的一堆判据（配色/空态/grain），
  // 混进来这个函数就测不干净了。
  root.querySelectorAll<HTMLElement>("[data-chart]").forEach((el) => {
    const entityId = el.getAttribute("data-entity") || "";
    const rows = source.rows[entityId];
    if (!rows) {
      problems.push(`data-chart 的 data-entity="${entityId}"：模型里没有这个实体`);
      return;
    }
    const dim = el.getAttribute("data-dimension") || "";
    const metric = (el.getAttribute("data-metric") || "count").toLowerCase();
    const buckets = new Map<string, BindingRow[]>();
    rows.forEach((r) => {
      const key = r[dim] == null ? EMPTY_TEXT : String(r[dim]);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    });
    const series = Array.from(buckets.entries()).map(([name, bucket]) => ({
      name,
      value: aggregate(metric, bucket, el.getAttribute("data-metric-field") || ""),
    }));
    el.setAttribute("data-series", JSON.stringify(series));
    filled.chart += 1;
  });

  // ── 动作：点了发事件，且不发空事件；无权的锁住不隐藏 ─────────────
  const gates = opts.gates;
  root.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
    const kind = el.getAttribute("data-action") as ActionKind;
    const entityId = el.getAttribute("data-entity") || "";
    if (!(ACTION_KINDS as readonly string[]).includes(kind)) {
      problems.push(`data-action="${kind}"：不在封闭词表里（${ACTION_KINDS.join("/")}）`);
      return;
    }
    // 可重复调用的纪律：上一轮的锁要先卸掉（切了角色再填一遍，
    // 有权了的按钮不能还挂着锁）。
    if (el.hasAttribute("data-locked")) {
      el.removeAttribute("data-locked");
      el.removeAttribute("aria-disabled");
      el.removeAttribute("title");
      el.style.opacity = "";
      el.style.cursor = "";
    }
    if (!source.rows[entityId]) {
      problems.push(`data-action 的 data-entity="${entityId}"：模型里没有这个实体`);
      return;
    }
    // 转移动作只许打在真的挂了审批流的实体上——没挂流程的实体上一个
    // 「提交审批」按钮点下去无处可去，那是打孔的问题，如实点名。
    if (
      isWorkflowActionKind(kind) &&
      gates?.workflowEntities &&
      !gates.workflowEntities.includes(entityId)
    ) {
      problems.push(
        `data-action="${kind}" entity=${entityId}：这个实体没有绑定审批流，转移动作无处可去`
      );
      return;
    }
    // 行内动作必须带得出行 id。带不出还挂监听，点下去就是一个空事件——
    // 页面开出一个空详情，看着像"点了没反应"。宁可如实报问题。
    const raw = el.getAttribute("data-row-id");
    const needsRow = !["createRecord", "clearCart", "checkout"].includes(kind);
    if (needsRow && (raw == null || raw === "")) {
      problems.push(`data-action="${kind}" entity=${entityId}：取不到行 id，不挂监听`);
      return;
    }
    // 权限卡（目前只有新建有卡，口径与老区块舞台的 canCreate 完全一致）。
    // 锁 = 禁用 + 原因，不隐藏：版式不动，用户知道动作存在、只是没权。
    const gate = kind === "createRecord" ? gates?.createGate?.[entityId] : null;
    if (gate && !gate.granted) {
      const who = gates?.roleLabel || gates?.role || "当前角色";
      const reason = `需要权限「${gate.permission}」，${who}未持有`;
      el.setAttribute("data-locked", reason);
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("title", reason);
      el.style.opacity = "0.45";
      el.style.cursor = "not-allowed";
      filled.locked += 1;
      return; // 不挂监听：锁住的按钮点了不该有任何事发生
    }
    el.setAttribute("role", "button");
    // 键盘可达：axe 会报但没人跑 axe，所以这里直接给上
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    filled.action += 1;
  });

  // 照 HTMX / Stimulus：点击挂在根上委托，不在每个按钮上。
  // ⚠ 2026-09-07 搜索 bindNow 每按一键再跑 applyBindings。逐钮
  //   addEventListener 让「结算」点一次发 N 次——jsdom 单测只绑一次所以绿，
  //   真机输入框一打字，页头按钮就叠一层。
  if (onAction) {
    actionHandlers.set(root, onAction);
    if (!actionDelegates.has(root)) {
      actionDelegates.add(root);
      root.addEventListener("click", (ev) => {
        const el = (ev.target as Element | null)?.closest?.("[data-action]");
        if (!el || !root.contains(el) || el.hasAttribute("data-locked")) return;
        const kind = el.getAttribute("data-action") as ActionKind;
        if (!(ACTION_KINDS as readonly string[]).includes(kind)) return;
        const entityId = el.getAttribute("data-entity") || "";
        const raw = el.getAttribute("data-row-id");
        const needsRow = !["createRecord", "clearCart", "checkout"].includes(kind);
        if (needsRow && (raw == null || raw === "")) return;
        actionHandlers.get(root)?.({
          kind,
          entityId,
          rowId: needsRow ? raw : null,
          delta:
            kind === "adjustCartQty"
              ? Number(el.getAttribute("data-delta"))
              : undefined,
        });
      });
    }
  }

  return { version: HTML_BINDING_RUNTIME_VERSION, filled, problems };
}

/**
 * 整页至少要有一个数据源，否则渲染出来还是死的静态页。
 *
 * ⚠ 这条**不能靠 applyBindings 的 problems 判**：一份一个孔都没打的 HTML
 * 走完 applyBindings，problems 是空的、filled 全 0，**看起来完美通过**。
 * 「没有绑定就没有错误的绑定」——今天在这个形状上栽了五次，所以单列一条。
 */
export function hasAnyDataSource(root: Element): boolean {
  // ⚠ 必须与 html_bindings.DATA_SOURCE_KEYS 同一份。漏 data-record
  //   时，向导/表单打对了孔，徽标仍说「尚未接数据」。
  return Boolean(
    root.querySelector("[data-rows], [data-record], [data-value], [data-chart]")
  );
}
