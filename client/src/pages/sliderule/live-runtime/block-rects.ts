/**
 * 刀 1：块矩形——每一块在页面上占的那个方框（2026-08-27）。
 *
 * 后面三刀全踩在这上面：摊到画布上要按矩形裁（刀 2）、点中一块要按矩形命中
 * （刀 3）、影响面点亮哪一块也是照着矩形画（刀 4）。量歪了，上面三刀一起歪，
 * 而且**不会报错**——框画在旁边，判据照样绿。
 *
 * ## 抄的是谁
 *
 * grok-build `crates/codegen/xai-grok-pager/src/scrollback/link_map.rs`
 * 的 `VisibleLinkMap`（本地已 clone，commit 9684fa3）。它解决的是同一个问题：
 * 每帧一份「屏幕区域 → 身份」的映射，带 `generation` 世代号，`is_stale()`
 * 判陈旧，一个逻辑对象允许跨多个矩形。
 *
 * 抄过来三条：
 *   1. 映射带世代号，消费前先问陈不陈旧，别拿旧矩形画框
 *   2. `rebuild` 先 `clear` 再写世代号——半份旧数据配新世代号是最坏的情况
 *   3. 身份**不靠序号**认（见下面那条 ⚠）
 *
 * ## ⚠ 世代号是两条，不是一条
 *
 * 这条**计划文档里漏了**，是 clone 下来逐行读才发现的。grok 那边
 * `scrollback/state/mod.rs:237` 起并排放着两个计数器，注释写死了分法：
 *
 *   · `generation`         可见位置**或策略输入**变了就推进（含折叠、外观、滚动、视口）
 *   · `content_generation` 只在条目增删或内容变化时推进，
 *                          "never on display toggles, appearance, scroll, or viewport"
 *                          ——理由是它要当 content-derived cache 的失效键，
 *                          必须"survive view changes"
 *
 * 我们这儿是同一个二分，合成一条两头都错：
 *
 *   · 只跟内容走 → 容器宽度变了（响应式回流）矩形已经飘了，世代号还是"新的"，
 *     框画在旧位置上。**这正是风险台账 #02。**
 *   · 只要动就推进 → 刀 4 的绑定反查索引会在每次缩放平移时整个重算。
 *     绑定关系跟视口毫无关系，纯白烧。
 *
 * 所以这里两个都留：`geometryGeneration` 管矩形，`contentGeneration` 管
 * 内容派生的缓存（刀 4 的索引）。`deriveGenerations` 是唯一的推进口。
 *
 * ## ⚠ 必须在 applyBindings **之后**量
 *
 * 表格的行是 `applyBindings` 时 `cloneNode` 出来的（html-binding-runtime
 * 的 ROW_TPL）。绑定之前 tbody 里只有一个模板行，量到的高度是真实高度的
 * 几分之一——框只有实际的一小截，不报错、不告警。
 *
 * 挂载点因此定在 `HtmlAppSurface` 的 `onReport`：它在 `applyBindings` 的
 * 下一行触发（html-app-surface.tsx，"填数必须在写进框之后"那段）。
 * `measureBlockRects` 是纯的，判据用 `test_measure_after_bindings` 那条
 * 前后对比把这个时机钉住。
 *
 * ## ⚠ 身份是 (页, 块名)，序号不作数
 *
 * 同样抄自 link_map.rs 的合并规则，那边的原话是
 * "Same `id` alone is not enough: markdown ids restart per document"。
 * 我们这儿一模一样：`data-block` 的名字只保证**页内**唯一，两页各有一块
 * 叫「统计概览」是完全正常的。跨页连线时只拿名字当键，就会把两页的块连成
 * 一块——线画错了，而且看起来很合理。
 */

import { frameRectToNodeRect, type Rect } from "./canvas-element-edit";
import {
  identityOf,
  listBlockElements,
  type BlockIdentity,
} from "./page-blocks";

/** 一块，以及它在**画板节点坐标**里占的方框。 */
export interface BlockRect extends BlockIdentity {
  /**
   * 画板节点内坐标（已经过 `frameRectToNodeRect`）。
   *
   * ⚠ 跟 `PickedElement.rect` 同一个口径：React Flow 的平移缩放由节点自己
   *   带走，这里只算画板自身那一层。别再乘一次 zoom——那个"缩两次"的坑
   *   canvas-element-edit 头注里记着真机对过的账。
   */
  rect: Rect;
}

/**
 * 一页的块矩形快照。
 *
 * 对应 `VisibleLinkMap` 本体：一份映射 + 一个世代号。**没有可变方法**——
 * 本仓是函数式 React，`rebuild` 那种就地改写在这边会变成一堆 ref 传递。
 * 语义靠 `measureBlockRects` 每次产出一份新快照来保证（等价于那边先 clear
 * 再写世代号：不存在"半份旧数据配新世代号"的中间态）。
 */
export interface BlockRectSnapshot {
  /** 产出这份快照时的几何世代号。 */
  geometryGeneration: number;
  rects: readonly BlockRect[];
}

/**
 * 还没量过的空快照。
 *
 * ⚠ 世代号取 -1 而不是 0：0 是 `deriveGenerations` 的**合法初值**，拿 0 当
 *   "没量过"会让第一份快照被认成"不陈旧"，于是永远不量第一次——这种错
 *   的表现是画布上一个框都没有，而所有判据都绿。
 */
export const EMPTY_BLOCK_RECTS: BlockRectSnapshot = {
  geometryGeneration: -1,
  rects: [],
};

/**
 * 这份快照相对当前几何世代号是不是陈旧了。
 *
 * 抄 `VisibleLinkMap::is_stale`：不等就是陈旧，不比大小。用 `!==` 而不是
 * `<` 是有意的——世代号可能回绕（那边用的 `wrapping_add`），比大小会在
 * 回绕那一次判反。
 */
export function isBlockRectsStale(
  snapshot: BlockRectSnapshot,
  currentGeometryGeneration: number
): boolean {
  return snapshot.geometryGeneration !== currentGeometryGeneration;
}

/** `deriveGenerations` 的输入：什么变了。 */
export interface GenerationInputs {
  /** 这一页的源 HTML。变了 = 内容变了。 */
  html: string;
  /**
   * 布局纪元：跟内容无关、但会让矩形失效的那些事。
   *
   * 真机上有三样：容器宽度变化（响应式回流）、Tailwind Play 扫完 DOM 之后
   * 补注的那一层 utility（html-app-surface 头注里"刚铺满又缩回去"那段）、
   * `fillPhone` 开关。宿主每遇到一件就 +1。
   */
  layoutEpoch: number;
}

export interface Generations {
  /**
   * 内容世代号：只跟 HTML 走。
   *
   * 刀 4 的绑定反查索引拿它当失效键——绑定关系跟视口、缩放、容器宽度
   * 统统无关，跟着几何世代号走等于每次平移都重算一遍。
   */
  contentGeneration: number;
  /**
   * 几何世代号：内容变了要重量，光是布局变了也要重量。
   *
   * ⚠ 它必须**同时**含内容和布局两项。只含布局的话，改一块之后 HTML 变了
   *   但 layoutEpoch 没动，旧矩形会被认成新鲜的。
   */
  geometryGeneration: number;
}

/**
 * 从"什么变了"算出两条世代号。**唯一的推进口**。
 *
 * ⚠ 别在别处手搓世代号。两处各推进一次，就会出现几何世代号推进了而内容
 *   世代号没推进（或反之）的组合，而这类错全是静默的。
 *
 * 内容世代号用 HTML 的哈希而不是"第几次渲染"：同一份 HTML 重渲（换主题、
 * 父组件重挂）不该让刀 4 的索引失效——那正是 grok 注释里 content_generation
 * 要 "survive view changes" 的意思。
 */
export function deriveGenerations(inputs: GenerationInputs): Generations {
  const contentGeneration = hashString(inputs.html);
  return {
    contentGeneration,
    // 两项混在一起：内容或布局任一变化都让矩形失效。
    geometryGeneration: mixHash(contentGeneration, inputs.layoutEpoch),
  };
}

/** FNV-1a 32 位。够用且稳定——这里只要"变了就不同"，不要密码学强度。 */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mixHash(a: number, b: number): number {
  return (Math.imul(a ^ b, 0x01000193) ^ (b + 0x9e3779b9)) >>> 0;
}

/**
 * 量出这一页每一块的方框。
 *
 * ⚠ 调用时机必须在 `applyBindings` 之后。见文件头注那条——早一步量，表格块
 *   的高度是模板行的高度，只有实际的几分之一。
 *
 * ⚠ 认块走 `listBlockElements`，**不在这儿另筛一遍**：检视器的块清单和这里
 *   的块矩形必须一样多（CLAUDE.md 第四条，同一件事两处实现必然分叉）。
 *
 * ⚠ 量到的是**文档坐标**：`getBoundingClientRect` 给的是 iframe 视口坐标，
 *   页面滚过之后两者差一个 scroll 偏移。画布档的 iframe 常态不滚（没进板
 *   时手势层盖着），但"常态不滚"不是"永远不滚"——进板交互过再退出来就滚过了，
 *   那时候不补偏移，所有框会整体偏上。
 */
export function measureBlockRects(
  body: HTMLElement | null | undefined,
  docSize: { width: number; height: number },
  nodeSize: { width: number; height: number },
  geometryGeneration: number
): BlockRectSnapshot {
  const rects: BlockRect[] = [];
  if (!body) return { geometryGeneration, rects };

  const view = body.ownerDocument?.defaultView ?? null;
  const scrollX = view?.scrollX ?? 0;
  const scrollY = view?.scrollY ?? 0;

  for (const el of listBlockElements(body)) {
    const id = identityOf(el);
    if (!id) continue;
    const r = el.getBoundingClientRect();
    /*
     * ⚠ 塌成 0 的块**丢掉，不收**。真机上会出现：块在折叠面板里、在
     *   `display:none` 的 tab 页里。收下一个 0×0 的框，刀 2 会给它挂一个
     *   看不见的空卡片，刀 4 会给它连一条画不出来的线——两处都不报错。
     *   如实少一块，比端出一个假的强（纪律七：这是几何量测，不是增强）。
     */
    if (!(r.width > 0) || !(r.height > 0)) continue;
    const rect = frameRectToNodeRect(
      {
        left: r.left + scrollX,
        top: r.top + scrollY,
        width: r.width,
        height: r.height,
      },
      docSize,
      nodeSize
    );
    if (!rect) continue;
    rects.push({ ...id, rect });
  }
  return { geometryGeneration, rects };
}

/**
 * 刚量到的这份要不要顶掉上一份。
 *
 * ## ⚠ 这条是 2026-08-27 真机抓出来的，别改回去
 *
 * 第一版直接拿 `isBlockRectsStale(prev, next.geometryGeneration)` 当采纳判据
 * ——世代号一样就不采纳。抄 `VisibleLinkMap` 抄过头了：那边 `rebuild` 是在
 * **渲染帧里**调的，那一刻布局已经定了，同一世代号下不可能量出两种结果。
 * 我们这边不是——`onReport` 之后 iframe 的内容还会再落一次，于是：
 *
 *     第一次量（同一世代号）  blocks in body 0  → rects 0，采纳
 *     第二次量（同一世代号）  blocks in body 6  → rects 6，**被守卫丢掉**
 *
 * 表现：画布上一个块框都没有，`data-block-rects` 恒为 0，而单测 13 条全绿、
 * 控制台无报错、HTML 里 `data-block` 一个不少。正是本仓最贵的那种坏法。
 *
 * 根因是**把守卫用错了地方**：世代号该决定"要不要去量"（effect 的依赖），
 * 不该决定"量完了要不要采纳"。已经量出来的就是此刻的事实，无条件比旧的新。
 *
 * 所以这里只做一件事：**内容真的一样就别换对象**（省掉一次无谓重渲染），
 * 除此之外一律采纳。
 */
export function shouldAdoptSnapshot(
  prev: BlockRectSnapshot,
  next: BlockRectSnapshot
): boolean {
  if (prev.geometryGeneration !== next.geometryGeneration) return true;
  if (prev.rects.length !== next.rects.length) return true;
  for (let i = 0; i < next.rects.length; i += 1) {
    const a = prev.rects[i];
    const b = next.rects[i];
    if (
      a.name !== b.name ||
      a.rect.left !== b.rect.left ||
      a.rect.top !== b.rect.top ||
      a.rect.width !== b.rect.width ||
      a.rect.height !== b.rect.height
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 画板节点坐标 (x, y) 落在哪一块里。没有就是 null。
 *
 * 抄 `VisibleLinkMap::link_at`。**倒着找**：块互不嵌套，但真机上出现过
 * 相邻块的框差一两个像素地贴在一起，倒着找等于"后画的在上面"，跟视觉一致。
 */
export function blockRectAt(
  snapshot: BlockRectSnapshot,
  x: number,
  y: number
): BlockRect | null {
  for (let i = snapshot.rects.length - 1; i >= 0; i -= 1) {
    const b = snapshot.rects[i];
    const { left, top, width, height } = b.rect;
    if (x >= left && x < left + width && y >= top && y < top + height) return b;
  }
  return null;
}

/**
 * 跨页唯一的块键。
 *
 * ⚠ **不许**只用 `name`。见文件头注那条：名字只保证页内唯一，两页各有一块
 *   叫「统计概览」很正常。刀 4 连线时拿它当键。
 */
export function blockKey(pageId: string, name: string): string {
  // 分隔符用显式转义的 U+001F（单元分隔符）：它不可能出现在 pageId 或块名里，
  // 拼不出歧义键。⚠ 写成裸字节会让整个源文件被当成二进制
  // （grep 报 "binary file matches"，刚踩过）。
  return `${pageId}\u001f${name}`;
}
