/**
 * 刀 2 的几何：块节点摆在哪、整页 iframe 怎么裁（2026-08-27）。
 *
 * 照 canvas-board-layout 的规矩来：**凡是能算出数字的都算在这一层**，
 * 组件只负责把数字贴到 DOM 上。理由同那边头注——画布组件在 jsdom 里跑不动，
 * 判据只能落在纯函数上，否则只写得出"渲染了没报错"这种一改还是绿的假判据。
 *
 * ## 摆位：块条带跟着**画板现在的位置**走
 *
 * 条带排在画板右侧，坐标从 `placedBoxes`（含手工拖动后的位置）算，不是从
 * `layoutArtboards` 的原始网格算。这样拖动画板时它的块跟着一起走——正是
 * 用户裁决的「页组框能拖、块不能拖」：块没有自己的位置，它的位置是画板的
 * 位置推出来的。
 *
 * ⚠ 这条同时避开了一个坑：块若有自己可拖的位置，就得存档、得处理"画板挪了
 *   而块没挪"的漂移。canvas-board-layout 头注里记着"位置只留这一份"的教训
 *   （D5 那趟：节点位置和连线选边各存一份，拖完线就没了）。
 *
 * ## 裁剪：块片段**不能单独渲染**
 *
 * 块的 Tailwind 类来自页面注入的样式表，布局还依赖父级 flex/grid，抠出来
 * 就变形。所以块节点里装的是**整页**，只是用 overflow:hidden 开一个洞，
 * 把那一块挪到洞口。`crop` 里给的就是这个洞的参数。
 *
 * 代价是 iframe 数量——那是 `block-node-fit.ts` 那道阶梯管的事。
 *
 * ## ⚠ 2026-08-28：块宽不再是一个常数（用户："太规矩了，太平了"）
 *
 * 上一版所有块**一律 440 宽**。真机上量到的设计宽度是 289 → 1632（5.6 倍
 * 跨度，见 `BLOCK_SIZE` 的标定表），全压成同一个数的后果有两条：
 *
 *   · 一条通栏指标条（1616×110）和一张小卡（289×307）在画布上一样宽，
 *     "这是通栏的、那是一小张"这个信息**整个丢了** —— 就是"太规矩"。
 *   · 每块各自的缩放差 4 倍（289→440 是 1.5×，1632→440 是 0.27×），
 *     于是节点里的字号也差 4 倍：小卡的字巨大、宽表的字看不见。
 *
 * 改成照 ComfyUI `LGraphNode.computeSize()` 的口径——**从内容算，带下限**：
 *
 *     size[0] = Math.max(slotsWidth, widgetWidth, title_width, minWidth)
 *
 * 三件事一起抄（缺一件就还是规矩的）：
 *
 *   1. 宽度从内容来（我们的"内容"＝这块在页面里的设计宽 × 统一缩放）
 *   2. **标题宽也参与取最大**（`title_width` 那一项）——名字长的块自己变宽，
 *      顺带保证标题不会被截断
 *   3. 有下限没上限（`minWidth`；上限只是量测溢出的兜底护栏）
 *
 * 列宽也跟着变：抄 `useArrangeNodes.arrangeGrid` 的 `colWidths[col] = max(...)`
 * ＋ `cumulativeOffsets` —— **每列各宽各的**，不是一个全局格宽。
 */

import type { ArtboardBox } from "./canvas-board-layout";
import type { BlockRect } from "./block-rects";
import { blockKey } from "./block-rects";

/**
 * 条带几何，画布坐标。
 */
export const BLOCK_CELL = {
  /** 画板右缘到块网格左缘 */
  stripGap: 72,
  /**
   * 单元格之间的间距，**横竖同一个数**——横竖不一样的话看着就不是网格，
   * 是"一列一列硬凑的"。
   */
  gap: 56,
  /**
   * 单个块节点的高宽比上限。
   *
   * ⚠ 真机上有"长表格"这种块，原始高宽比能到 6:1，按宽度等比放大后会拖出
   *   几千个画布单位长。超过就**只裁上半截**（如实截断，不压扁——压扁会让
   *   里面的字变形，那是在骗人）。
   */
  maxAspect: 2.4,
} as const;

/**
 * 列数上限。
 *
 * ⚠ 列宽现在各列各算（见头注），所以这个数不再直接等于"网格有多宽"。
 *   留着是防止块特别多的页排出十几列把右边那一页推到天边。
 */
export const MAX_BLOCK_COLS = 4;

/**
 * 块尺寸的标定。
 *
 * ## 真机量到的分布（2026-08-28，会话 sr-20260827212138，5 页 25 块）
 *
 *     设计宽   min 289 · p25 396 · p50 941 · p75 1624 · max 1632
 *     高宽比   min 0.04 · p50 0.34 · max 1.45
 *
 * 三档形态各自的样子：通栏指标条 1616×110、四联指标卡 396×103、
 * 主表 1624×1242。
 *
 * ## ⚠ 为什么是 0.40 —— 这一档是扫出来的，不是挑好看的
 *
 * 缩放越大，块占的面积越大 → 为了装进画板高度要开更多列 → 网格越宽 →
 * 整张图横向拉开 →「适应画布」的缩放跟着掉。这条链是**二次的**，
 * 差一档就掉一大截。拿真机那 5 页各自跑一遍（判据 sweep 见 git 历史）：
 *
 *     designScale   最宽那页的网格   各块缩放的极差   「适应画布」估算
 *        0.32            1459            2.81            14.5%
 *        0.40            1589            2.25            14.0%
 *        0.44            1654            2.04            13.8%
 *        0.50            2200            1.80            12.1%   ← 断崖
 *
 * 0.50 那一档断崖式变宽，是因为消耗看板那页从 3 列变成 4 列——正是上一版
 * 4×520 踩过的同一个坑（整张图横向拉开，「适应画布」从 16% 掉到 12%，
 * 反而更看不清）。0.40 是"块够大、极差够小、还没触发多开一列"的那一档。
 *
 * ## 为什么下限是 260
 *
 * 抄 `LiteGraph.NODE_WIDTH * (widgets ? 1.5 : 1)` 那条"有下限没上限"。
 *
 * ⚠ 真正撑住小块的其实是**标题宽**（`title_width` 那一项）：名字八个字的
 *   指标卡光标题就要 348，比这个下限还宽。所以 260 是"名字很短的块"的兜底，
 *   不是主力。把它调高只会让更多块挤到同一个数上——**「太规矩」就是这么来的**：
 *   扫下来 260 比 320 多出两档不同的宽度，而网格宽一点没变。
 *
 * ⚠ 上限 960 是**护栏不是设计参数**：块不可能比它所在的页（1920）还宽，
 *   量到更宽的只能是量测溢出（overflow 的表格能量出 3000+），
 *   不夹住会把整张图横向撕开。
 */
export const BLOCK_SIZE = {
  /** 设计尺寸 → 画布尺寸的统一缩放。 */
  designScale: 0.4,
  minWidth: 260,
  maxWidth: 960,
} as const;

/**
 * 节点外观的尺寸，**画布坐标**。
 *
 * ## 为什么还剩这两条
 *
 * 用户 2026-08-28 的原话是"太平了"。第一版按 ComfyUI 的 `RenderShape.CARD`
 * 补了一整套：标题条（含 title box 那个点）+ 分隔线 + 主体 + 投影。
 * 随后两轮裁决把标题条那半整个砍掉了：
 *
 *   一、"我们是区块，不是属性面板" —— 按类型分色的色带读起来是分类目录
 *   二、"直接去掉标题条"
 *
 * ⚠ 砍掉标题条**不等于回到上一版的白方块**。"太平"是两件事叠出来的：
 *   没有层次，以及（更要命的）标签因为 LOD 阈值算错从来没显示过。
 *   层次这半靠圆角 + 分层投影，跟标题条无关，所以留着。
 *
 * ## 为什么块可以没有标题
 *
 * ComfyUI 的节点必须有标题：它画的是**抽象算子**，不写名字就认不出。
 * 我们的块是**页面上那一块的真渲染**——内容自己就是它的名字。
 * 名字要用的时候（选中改写、反查影响面）在右侧面板里，那儿有地方写全。
 *
 * 比例仍照 ComfyUI 折算（`src/lib/litegraph/src/LiteGraphGlobal.ts`，
 * 本地 clone commit 5d24e4e）：
 *
 *     ROUND_RADIUS = 8   NODE_TITLE_HEIGHT = 30   NODE_TEXT_SIZE = 14
 *     DEFAULT_SHADOW_COLOR = 'rgba(0,0,0,0.5)'   offset (2,2) blur 3
 *
 * ⚠ 投影的 alpha **不照抄 0.5**：ComfyUI 画在深色画布上，我们的画布是浅色，
 *   0.5 的黑投影在浅底上是一圈脏。取 0.22/0.16 两层（分层的道理见
 *   stage-frame-style 头注：单层大模糊只是糊，分层才像光照）。
 *
 * ⚠ 这些数都是**画布单位**，不反缩放——节点本来就该跟画布一起缩，
 *   同 BlockNode 里 iframe 那条纪律。
 */
export const BLOCK_CHROME = {
  /** 圆角。整张卡一个圆角 + overflow:hidden，投影只画一次。 */
  radius: 14,
  /**
   * 「只显示上半截」那枚提示的字号，画布单位。
   *
   * ⚠ LOD 阈值就是从它反推的（见 blockDetailZoomThreshold）。它是节点上
   *   **仅剩的一处文字**——标题条砍掉之后，阈值该盯的就是它。
   *   留着一个不再对应任何文字的字号去算阈值，是最典型的"改了一半"。
   */
  hintFont: 26,
  /** 投影，画布单位（ComfyUI 的 shadow 也是图坐标，随缩放一起变）。 */
  shadow: "0 6px 14px -4px rgba(0,0,0,0.22), 0 2px 4px rgba(0,0,0,0.16)",
} as const;

/**
 * 一块的画布尺寸——照 `computeSize` 的口径：**取最大值，带下限**。
 *
 * ⚠ 返回的 `scale` 是**这一块自己的**缩放（内容宽 → 节点宽），
 *   裁剪那一侧直接用它。上一版是全局同一个 440/w，各块的 scale 差 4 倍。
 */
export function computeBlockSize(
  rect: BlockRect,
  boardHeight: number
): { w: number; h: number; scale: number; truncated: boolean } {
  const natural = rect.rect.width * BLOCK_SIZE.designScale;
  /* ⚠ 上一版这里还有一项 `title_width`（ComfyUI computeSize 的第三项），
     用来保证节点宽到装得下标题条。标题条 2026-08-28 被砍掉之后那一项
     **必须一起删**——否则就是在为一个不画的东西留宽度，而且它撑出来的
     那几档宽度看着还挺"自然"，谁也不会发现多算了。 */
  const wanted = Math.max(natural, BLOCK_SIZE.minWidth);
  const w = Math.min(wanted, BLOCK_SIZE.maxWidth);
  const scale = w / rect.rect.width;
  const wantedH = rect.rect.height * scale;
  const maxH = cellMaxHeight(w, boardHeight);
  return {
    w,
    h: Math.min(wantedH, maxH),
    scale,
    truncated: wantedH > maxH,
  };
}

/**
 * 单块内容的高度上限。
 *
 * ⚠ 两条一起卡：高宽比上限，**以及画板高度**。
 *   只卡高宽比的话，一个特别长的表格块自己就有 960×2.4 = 2304 高，
 *   加上标签带远超画板 1080——那一页无论分几列都装不进画板高度，
 *   "列数选到装得下为止"这条规则就永远达不成。真机上量到过：
 *   远程审方页的网格 1832 高，越过下一排画板 520。
 */
function cellMaxHeight(width: number, boardHeight: number): number {
  return Math.min(width * BLOCK_CELL.maxAspect, Math.max(0, boardHeight));
}

/**
 * 一块按自己的宽度铺开之后占多高。
 *
 * ⚠ 标题条砍掉之后"视觉高"就等于内容高了，这个函数只剩一层转发。留着是因为
 *   排布那两处（选列数、摆位）必须**同一个口径**——各写各的迟早分叉。
 */
function cellVisualHeight(rect: BlockRect, boardHeight: number): number {
  return computeBlockSize(rect, boardHeight).h;
}

/** 瀑布流按 cols 列 packing 之后的总高。 */
function masonryHeight(heights: readonly number[], cols: number): number {
  const bottoms = new Array<number>(cols).fill(0);
  for (const h of heights) {
    let col = 0;
    for (let c = 1; c < cols; c += 1) {
      if (bottoms[c] < bottoms[col] - 0.5) col = c;
    }
    bottoms[col] += h + BLOCK_CELL.gap;
  }
  /* 末尾那个 gap 不算进总高 */
  return Math.max(0, Math.max(...bottoms) - BLOCK_CELL.gap);
}

/**
 * 这一页的块该摆几列。
 *
 * ## ⚠ 2026-08-28：从 `ceil(sqrt(n))` 改成「**装得进画板高度**为止」
 *
 * √n 只管形状方不方，不管**跟画板比起来多高**。真机上量到（4 页 15 块）：
 *
 *     画板行距            1312（1080 高 + 232 间距）
 *     远程审方页的块网格   y 0 → 1832 —— 越过下一排画板 520
 *
 * 后果就是用户报的那个：缩小时看着还行，一放大就是大片空白里几条线穿过——
 * 因为网格把整张图在垂直方向撑开了，画板之间被拉出很远的空隙。
 *
 * 改成从 1 列开始试，直到瀑布流的总高装得进画板高度。这样块簇始终跟它的
 * 画板齐平，整张图横成一条带，放大到任何一档看到的都是"一页 + 它的块"。
 *
 * ⚠ 有上限（MAX_BLOCK_COLS）：块特别多的页装不进去也不许无限加列，
 *   否则会把右边那一页推到天边。装不下就如实溢出一点，不假装。
 */
export function chooseBlockGridColumns(
  rects: readonly BlockRect[],
  boardHeight: number
): number {
  const usable = usableRects(rects);
  if (usable.length === 0) return 1;
  const heights = usable.map(r => cellVisualHeight(r, boardHeight));
  for (let cols = 1; cols <= MAX_BLOCK_COLS; cols += 1) {
    if (masonryHeight(heights, cols) <= boardHeight) return cols;
  }
  return MAX_BLOCK_COLS;
}

/** 塌成 0 的块不进网格——跟量测那一侧同一条规则。 */
function usableRects(rects: readonly BlockRect[]): BlockRect[] {
  return rects.filter(b => b.rect.width > 0 && b.rect.height > 0);
}

/** 一个块节点的盒子（画布坐标）+ 它那个"洞"的参数。 */
export interface BlockNodeBox {
  /** `blockKey(pageId, name)`——跨页唯一。 */
  key: string;
  pageId: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 裁剪参数。消费侧照这个用，**顺序不能反**：
   *
   *     transform: scale(scale) translate(-left px, -top px)
   *     transform-origin: top left
   *
   * `left`/`top` 是**设计坐标**（页面原尺寸里的位置），不是缩放后的像素。
   * CSS 的 transform 是右结合：先 translate 再 scale，所以最终位移正好是
   * `-left * scale`。
   *
   * ## ⚠ 整页必须保持**原尺寸**，只用 transform 缩放（2026-08-27 真机）
   *
   * 第一版把内层盒子的宽高写成 `board.w * scale`，也就是**改 iframe 的尺寸**。
   * 后果是 iframe 里的文档宽度跟着变，页面按新宽度**重新响应式布局**了——
   * 于是块在新布局里的位置跟量测那一刻完全不同，裁出来的是别处的内容。
   *
   * 真机上的样子：标着「表格·物资台账出入库实时流水」的节点里显示的是壳里
   * 的用户下拉。块框位置是对的（AH 通过），内容是错的——两件事各自都"看着
   * 正常"，合起来才看得出不对。
   *
   * 这跟 canvas-board-layout 头注那条是同一条纪律：画板在画布坐标里就是
   * 原尺寸，缩放整个交给 transform。
   */
  crop: { left: number; top: number; scale: number };
  /** 原始矩形被高宽比上限截断过（节点里只看得到上半截）。 */
  truncated: boolean;
}

/** 一页块网格的排布结果（**相对网格左上角**，还没加画板位置）。 */
export interface BlockGridPlan {
  cols: number;
  /** 每列各宽各的（arrangeGrid 的 colWidths）。 */
  colWidths: number[];
  /** 每列左缘相对网格左缘的偏移（arrangeGrid 的 cumulativeOffsets）。 */
  colX: number[];
  /** 网格总宽。**给"画板之间要多留多宽"用**，不是 cols × 某个常数。 */
  width: number;
  items: {
    rect: BlockRect;
    col: number;
    /** 视觉顶（标题条上沿）相对网格视觉顶的偏移。 */
    visualTop: number;
    w: number;
    h: number;
    scale: number;
    truncated: boolean;
  }[];
}

/**
 * 抄 `cumulativeOffsets(sizes, origin, gap)`：前缀和 + 间距。
 *
 * ⚠ 不能写成 `i * (width + gap)` —— 那是"每列一样宽"才成立的式子，
 *   正是这次要改掉的东西。
 */
function cumulativeOffsets(
  sizes: readonly number[],
  origin: number,
  gap: number
): number[] {
  const out: number[] = [origin];
  for (let i = 1; i < sizes.length; i += 1) {
    out.push(out[i - 1] + sizes[i - 1] + gap);
  }
  return out;
}

/**
 * 一页的块怎么排（不含画板位置）。
 *
 * 两遍：先瀑布流定"哪块落哪列"，再按落进去的块算**每列的宽**。
 * 这个顺序是对的——列归属只看高度（最矮的那列），跟宽度无关，
 * 所以不存在"宽度定不下来"的循环。
 */
export function planBlockGrid(
  rects: readonly BlockRect[],
  boardHeight: number
): BlockGridPlan {
  const usable = usableRects(rects);
  if (usable.length === 0) {
    return { cols: 0, colWidths: [], colX: [], width: 0, items: [] };
  }
  const cols = chooseBlockGridColumns(usable, boardHeight);

  /*
   * ## 瀑布流：每块落进**当前最矮的那一列**
   *
   * 2026-08-28 用户要"节点自由散布"的观感。更早那版是严格网格（逐行取最大高、
   * 行行对齐），块高低差很大时（指标卡矮、表格高）会：
   *   · 每行被最高那块撑开，矮块下面留一大片空 —— 看着像表格，不像图
   *   · 所有块的顶边对齐成一条直线 —— "电子表格感"的来源
   *
   * ⚠ 用瀑布流而**不是随机抖动**：抖动是乱，不是自由，而且每次渲染位置都
   *   得稳定（否则块会在画布上跳）。瀑布流是确定性的，同一份输入永远同一个
   *   结果，还顺带把空隙填掉了。
   *
   * ⚠ 列高累加的是**视觉高**（含标题条），理由同上一版：标题条画在节点外面，
   *   不算进去的话下一块的标题会压住上一块的内容。
   */
  const colVisualBottom = new Array<number>(cols).fill(0);
  const colWidths = new Array<number>(cols).fill(0);
  const items: BlockGridPlan["items"] = [];

  for (const b of usable) {
    const size = computeBlockSize(b, boardHeight);

    /* 最矮的那一列；并列时取最左的（确定性，且从左往右填看着自然）。 */
    let col = 0;
    for (let c = 1; c < cols; c += 1) {
      if (colVisualBottom[c] < colVisualBottom[col] - 0.5) col = c;
    }

    const visualTop = colVisualBottom[col];
    items.push({ rect: b, col, visualTop, ...size });
    colVisualBottom[col] = visualTop + size.h + BLOCK_CELL.gap;
    if (size.w > colWidths[col]) colWidths[col] = size.w;
  }

  const colX = cumulativeOffsets(colWidths, 0, BLOCK_CELL.gap);
  /* ⚠ 空列（块少于列数时会有）宽 0，不能让它白占一份 gap 变成末尾一段空白。 */
  const used = colWidths.filter(w => w > 0);
  const width =
    used.length === 0
      ? 0
      : used.reduce((a, b) => a + b, 0) + (used.length - 1) * BLOCK_CELL.gap;

  return { cols, colWidths, colX, width, items };
}

/**
 * 这一页的块网格有多宽（画布坐标）。给"画板之间要多留多少间距"用。
 *
 * ⚠ 必须跟 `layoutBlockNodes` 走**同一个 plan**——各算各的话留的间距
 *   和实际网格宽对不上，网格会盖住右边那列画板，而在 13% 全景下
 *   "盖住了"看起来只是"有点挤"，不会有任何报错。
 */
export function blockGridSpan(
  rects: readonly BlockRect[],
  boardHeight: number
): number {
  return planBlockGrid(rects, boardHeight).width;
}

/**
 * 把一页的块摆成画板右侧的一条竖带。
 *
 * @param board 画板盒子（**当前**位置，含拖动后的）
 * @param rects 这一页量到的块矩形（画板节点坐标，即与 board.w/h 同一尺度）
 */
export function layoutBlockNodes(
  board: ArtboardBox,
  rects: readonly BlockRect[]
): BlockNodeBox[] {
  if (!(board.w > 0) || !(board.h > 0)) return [];

  const plan = planBlockGrid(rects, board.h);
  if (plan.items.length === 0) return [];

  const originX = board.x + board.w + BLOCK_CELL.stripGap;
  /* 顶端跟画板顶齐平。
     ⚠ 上一版这里是 `board.y - labelBand`，配合下面的 `+ labelBand`——那是
       抄 arrangeGrid 的 `anchor.posY - anchor.titleHeight` → `visualTop +
       titleHeight`，为的是把画在盒子外面的标题条算进视觉盒。标题条没了，
       这两个偏移**必须成对删掉**：只删一处，整条块带会整体上移或下移
       56 个单位，而画面上看着只是"跟画板没对齐"，不报错。 */
  const originTop = board.y;

  return plan.items.map(it => ({
    key: blockKey(board.pageId, it.rect.name),
    pageId: board.pageId,
    name: it.rect.name,
    x: originX + plan.colX[it.col],
    y: originTop + it.visualTop,
    w: it.w,
    h: it.h,
    crop: {
      /* 设计坐标，**不乘 scale**——消费侧是 scale(s) translate(-left,-top)，
         CSS 会替我们乘。这里先乘一遍等于乘两次。 */
      left: it.rect.rect.left,
      top: it.rect.rect.top,
      scale: it.scale,
    },
    truncated: it.truncated,
  }));
}

/**
 * 开着块网格时，画板之间要多留的横向间距。
 *
 * ⚠ 不留的话网格会盖住右边那一列画板——而"盖住了"在缩到 13% 的全景下
 *   看起来只是"有点挤"，不会有任何报错。
 * ⚠ 参数是**最宽的那一页的网格宽**（`blockGridSpan` 取 max），不是列数：
 *   列数乘一个常数格宽的老算法在"每列各宽各的"之后就不成立了，
 *   按它留会留少，网格照样盖住邻居。
 */
export function blockGridExtraGapX(maxSpan: number): number {
  if (maxSpan <= 0) return 0;
  return BLOCK_CELL.stripGap + maxSpan;
}

/**
 * 一页块网格的总高（含行距）。给"这一页的块摆不摆得下"用。
 *
 * ⚠ 空数组回 0——多算一行会让外接盒每页都虚高一截，「适应画布」跟着偏。
 */
export function blockGridHeight(boxes: readonly BlockNodeBox[]): number {
  if (boxes.length === 0) return 0;
  let top = Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    top = Math.min(top, b.y);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return bottom - top;
}

/**
 * 细节的可读性下限（LOD）：缩放低于这一档就别画那些细节了。
 *
 * ## 抄的是谁
 *
 * ComfyUI_frontend `src/lib/litegraph/src/LGraphCanvas.ts` 的
 * `updateLowQualityThreshold()`（本地 clone，commit 5d24e4e）。
 * 它的做法是**从"字还读不读得清"反推阈值**，而不是拍一个魔数：
 *
 *     threshold = min_font_size_for_lod / (NODE_TEXT_SIZE * sqrt(DPR))
 *
 * 用 sqrt(DPR) 是它注释里的原话：高 DPR 屏对可读性的提升不是线性的，
 * DPR=2 大约提升 40%，用 sqrt 近似。
 *
 * ## ⚠ 2026-08-28：这条阈值曾经**从来没成立过**
 *
 * 公式没错，代进去的数错了：当时块标签是**反缩放**画的（`fontSize: 11`
 * 配 `transform: scale(1/zoom)`），屏幕上永远是 11px，跟缩放无关。而公式里
 * 的 NODE_TEXT_SIZE 指的是**图坐标字号**。拿 11 代进去得到 6/11 = 0.545——
 * 于是画布常态的 17%~25% 全部低于阈值，**块标签一次都没显示过**。
 * 用户说的"太平了"，一半就是这个：一排没有标题的白方块。
 *
 * ## 现在它管的是什么
 *
 * 标题条后来被砍掉了（见 BLOCK_CHROME 头注），节点上**仅剩的文字**是
 * 「只显示上半截」那枚提示。阈值就从它的字号反推：6/26 ≈ 0.23。
 *
 * ⚠ 字号换了就得换这里。留着一个不再对应任何文字的字号去算阈值，
 *   跟上一版那个错是同一种错——公式看着还对，数已经没有意义了。
 */
/** 节点上仅剩那处文字的字号（画布单位）。阈值从它反推——两者必须是同一个数。 */
export const BLOCK_HINT_FONT_PX = BLOCK_CHROME.hintFont;
/** 低于这个字号就认为读不出来了（同 ComfyUI 的 min_font_size_for_lod 默认档）。 */
export const MIN_READABLE_FONT_PX = 6;

export function blockDetailZoomThreshold(
  devicePixelRatio = typeof window !== "undefined"
    ? window.devicePixelRatio || 1
    : 1
): number {
  const dpr = Math.sqrt(devicePixelRatio > 0 ? devicePixelRatio : 1);
  return MIN_READABLE_FONT_PX / (BLOCK_HINT_FONT_PX * dpr);
}

/**
 * 这个缩放档位该不该画块上的文字。
 *
 * ⚠ 收的是**文字**，不是块：块节点本身照画（同 shouldMountBoard 那条
 *   "剔除是性能手段，不是可见性判定"）。缩到看全景时正是最需要看见
 *   每块在哪的时候。
 */
export function shouldDrawBlockDetail(
  zoom: number,
  devicePixelRatio?: number
): boolean {
  return zoom >= blockDetailZoomThreshold(devicePixelRatio);
}

/**
 * 按块类型给底色，**只给降级的静态卡用**。
 *
 * ## 为什么需要
 *
 * 抄 ComfyUI 低质量档的口径：`low_quality` 时它把圆角、阴影、文字全关掉，
 * 但**照画节点的形状和颜色**（LGraphCanvas.ts:5901 那段 `shape == BOX ||
 * low_quality` 走的仍是填色的 rect）。
 *
 * 我们这边更早那版在 LOD 档把标签收起来之后，降级的静态卡就成了**一片空白
 * 方块**——真机 24 块里 19 块是静态的，全景看过去就是一堆白格子，
 * 比不画还糟（看着像加载坏了）。给它按类型上色，全景下至少读得出
 * "这一页由几张表、几个指标、一个图表拼成"。
 *
 * ## ⚠ 只给静态卡，真渲染的块一点类型色都不上
 *
 * 2026-08-28 我一度给每个块配了一条按类型上色的标题条，用户两轮打回：
 * **"我们是区块，不是属性面板"**，然后 **"直接去掉标题条"**。
 *
 * 分界是**这块有没有内容可看**：静态卡什么都没有，颜色是它唯一说得出口的
 * 信息；真渲染的块内容自己就在那儿，再糊一层分类色只是噪音。
 *
 * ⚠ 颜色只用来**分类**，不表示状态（好/坏/告警）。真机上块的类型是
 *   `data-block-kind`，跟 Python 的 BLOCK_KINDS 一字不差。
 */
export const BLOCK_KIND_TINT: Record<string, { fill: string; ink: string }> = {
  chart: { fill: "#eef2ff", ink: "#4f46e5" },
  table: { fill: "#ecfeff", ink: "#0e7490" },
  form: { fill: "#f0fdf4", ink: "#15803d" },
  detail: { fill: "#fefce8", ink: "#a16207" },
  metric: { fill: "#fef2f2", ink: "#b91c1c" },
  list: { fill: "#f5f3ff", ink: "#6d28d9" },
  media: { fill: "#fff7ed", ink: "#c2410c" },
  card: { fill: "#f8fafc", ink: "#475569" },
};

/**
 * 一个颜色的**色度**（最大通道 − 最小通道，归一到 0..1）。
 *
 * 判据用它卡"面积大的颜色不许太艳"：标题条铺满整块的宽度，色度一高就会被
 * 读成状态色（我第一版给指标块配的 `#b91c1c` 是 0.616，真机上就是一条
 * 通栏红带）。ComfyUI 的 `node_colors` 全在 0.07 上下。
 */
export function colorChroma(hex: string): number {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map(i => Number.parseInt(h.slice(i, i + 2), 16));
  return (Math.max(...ch) - Math.min(...ch)) / 255;
}

/**
 * 取某一类块的底色。
 *
 * ⚠ 认不出的类型回 `card` 那档，**不回透明**：透明就是那片白方块，
 *   而"认不出类型"和"没有内容"是两回事。
 */
export function blockKindTint(kind: string): { fill: string; ink: string } {
  return BLOCK_KIND_TINT[kind] ?? BLOCK_KIND_TINT.card;
}
