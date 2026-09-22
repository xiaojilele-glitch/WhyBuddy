/**
 * 画布档的几何：排版、可见性剔除、标签反缩放。**全是纯函数，单测钉着。**
 *
 * ## 为什么单独抽一个文件
 *
 * 画布组件本体是 React Flow + iframe，jsdom 里跑不动（React Flow 要真实
 * ResizeObserver 与布局尺寸，iframe 要 srcdoc 加载）。本仓第二条纪律要求
 * 判据能被变异咬住——组件层测不到的东西，判据就必须落在纯函数上，
 * 否则只能写出"渲染了没报错"这种一改就还是绿的假判据。
 *
 * 所以这里的规矩是：**凡是能算出数字的，都算在这一层**。组件只负责把
 * 数字贴到 DOM 上。
 *
 * ## 坐标系
 *
 * 三套坐标必须分清，混用是这类画布最常见的错法：
 *
 *   画布坐标（canvas / flow）— 画板的 x/y/w/h，跟缩放无关。排版算这一套。
 *   屏幕坐标（screen）      — 画布坐标 × zoom + pan。剔除算这一套。
 *   设计坐标（design）      — 页面自己的 1920×1080 / 390×844。画板尺寸取这一套。
 *
 * ⚠ 画板在画布坐标里就是**原尺寸**（1920×1080），不再自己缩放——缩放整个
 *   交给 React Flow 的 viewport transform。第一版试过"画板内部先 scale 一次，
 *   画布再 scale 一次"，两级缩放叠起来的结果是 iframe 里的字被光栅化两遍，
 *   放大到 100% 反而比页面档糊。一级缩放才有清晰的放大。
 */

/** 画板在画布坐标里的盒子。 */
export interface ArtboardBox {
  pageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** React Flow 的视口变换（transform = [x, y, zoom]）。 */
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * 画板之间的留白，画布坐标。
 *
 * ⚠ 这不是审美参数：gapY 必须装得下标题条（画板上方，见 LABEL_BAND）。
 * 桌面画板 1080 高、手机 844 高，两档共用同一份留白会让手机档看起来空旷，
 * 所以按档给。判据 `canvas-board-layout.test.ts` 卡的是"上下两排之间的净空
 * ≥ 标题条高度"，改小 gapY 会当场变红。
 */
export const BOARD_GAP = {
  desktop: { x: 168, y: 232 },
  phone: { x: 104, y: 176 },
} as const;

/**
 * 标题条占的画布高度（画板上方）。屏幕上它靠反缩放保持 ~24px，
 * 但布局要按画布坐标预留，否则缩到 20% 时上一排的画板会压住下一排的标题。
 */
export const LABEL_BAND = 96;

/**
 * 一组画板按 cols 列排开之后，外接盒的长宽比（含标题条与留白）。
 *
 * `extraGapX` 是刀 2 块条带占的宽度。条带在**每张画板右侧**，所以：
 *   · 列与列之间多留 extra
 *   · 最右一列的条带还要再伸出 extra（不算进去的话选列数会当图比实际更窄）
 *
 * ⚠ 2026-08-31 真机：会议室预约 5 页开块之后 fitView 16%。列数仍按
 *   「没条带」选成 3 列，条带叠在下一页上，整张图又宽又挤、上下空一截。
 *   extra 必须参与长宽比，开块后才能收到 2 列。
 */
export function gridAspect(
  count: number,
  cols: number,
  design: { w: number; h: number },
  gap: { x: number; y: number },
  extraGapX = 0
): number {
  const c = Math.max(1, Math.min(cols, Math.max(1, count)));
  const rows = Math.ceil(Math.max(1, count) / c);
  const usedCols = Math.min(c, Math.max(1, count));
  const extra = Math.max(0, extraGapX);
  const w =
    usedCols * design.w + (usedCols - 1) * (gap.x + extra) + extra;
  const h = rows * design.h + (rows - 1) * gap.y + LABEL_BAND;
  return w / h;
}

/**
 * 每行放几块 —— **按容器的长宽比挑**，不是写死的常数。
 *
 * ⚠ 2026-08-25 真机第一版就是写死的 `桌面 3 列 / 手机 5 列`，结果是：
 *   对话栏占掉左半屏之后，舞台只有 805×825（接近正方形），而三列排开的
 *   外接盒是 6096×2392（2.55:1）。contain 到正方形容器里被宽度卡死，
 *   fitView 给出 **12%**，五块画板挤在上半部分、下面空掉整整一屏。
 *
 *   截图上看着就是"画布好空"。判据全绿（5 块画板都在、标题都对），
 *   但用户真正看到的东西是坏的——本仓第五条纪律的标准形状。
 *
 * 现在的做法：枚举 1..count 列，取**外接盒长宽比最接近容器长宽比**的那个。
 * 这等价于最大化 contain 缩放系数——contain 取 min(容器宽/盒宽, 容器高/盒高)，
 * 两个比值在长宽比相等时相交，也就是那一点最大。同一份内容，窄舞台自动收成
 * 两列、宽舞台自动摊成三列四列，用户拖分栏就能看到它重排。
 *
 * containerAspect 缺席（还没量到尺寸）时退回旧的固定值，保证首帧有个合理排布。
 */
export function boardColumns(
  count: number,
  design: { w: number; h: number },
  containerAspect?: number,
  extraGapX = 0
): number {
  const n = Math.max(1, count);
  const gap = design.w >= design.h ? BOARD_GAP.desktop : BOARD_GAP.phone;
  if (!(containerAspect && containerAspect > 0)) {
    return Math.min(n, design.w >= design.h ? 3 : 5);
  }
  let best = 1;
  let bestErr = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    // 比长宽比要在**对数尺度**上比：线性差会偏袒"比容器更宽"的那一侧
    // （2.5 与 1.0 对 1.5 的线性距离是 1.0 vs 0.5，但视觉上一样偏）。
    const err = Math.abs(
      Math.log(
        gridAspect(n, cols, design, gap, extraGapX) / containerAspect
      )
    );
    if (err < bestErr - 1e-9) {
      bestErr = err;
      best = cols;
    }
  }
  return best;
}

/**
 * 排版：按行优先铺开，行内左对齐，整体以 (0,0) 为左上角。
 *
 * 顺序**就是 pages 的顺序**（导航顺序，见 spec-live-pages.specLivePageIds）——
 * 不按名字排、不按到达时间排。用户在页面档看到的第一页，在画布上就该是左上角
 * 那一块，两个档位对同一份产物必须给出同一个次序。
 */
export function layoutArtboards(
  pages: ReadonlyArray<{ pageId: string }>,
  design: { w: number; h: number },
  containerAspect?: number,
  /**
   * 每列额外多留的横向间距（刀 2 的块条带占的宽度）。
   *
   * ⚠ 必须传进 boardColumns：条带把图拉宽之后，还按「没条带」选 3 列，
   *   真机（2026-08-31 会议室预约）fitView 16%，块叠在下一页上。
   *   开关块会重适应画布（SpecPageCanvasStage 里 fitView），列数跟着
   *   变不是故障——变完才能摊匀。
   * ⚠ 不留的话条带会盖住右边那列画板——而缩到 13% 的全景下这只是
   *   "看着有点挤"，不报错、不告警。
   */
  extraGapX = 0
): ArtboardBox[] {
  const extra = Math.max(0, extraGapX);
  const cols = boardColumns(pages.length, design, containerAspect, extra);
  const gap = design.w >= design.h ? BOARD_GAP.desktop : BOARD_GAP.phone;
  const stepX = design.w + gap.x + extra;
  return pages.map((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      pageId: p.pageId,
      x: col * stepX,
      y: row * (design.h + gap.y),
      w: design.w,
      h: design.h,
    };
  });
}

/** 一组画板的外接盒（画布坐标），含标题条。给「适应画布」与空态用。 */
export function boardsBounds(boxes: ReadonlyArray<ArtboardBox>): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y - LABEL_BAND);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 画布坐标 → 屏幕坐标。React Flow 的 transform 就是 `translate(x,y) scale(zoom)`，
 * 所以是先缩放再平移。
 */
export function boxToScreen(
  box: ArtboardBox,
  vp: CanvasViewport
): { left: number; top: number; width: number; height: number } {
  return {
    left: box.x * vp.zoom + vp.x,
    top: box.y * vp.zoom + vp.y,
    width: box.w * vp.zoom,
    height: box.h * vp.zoom,
  };
}

/**
 * 预挂载余量（屏幕像素）：画板离开视口这么远之内仍算"该挂着"。
 *
 * 给得比较宽（一屏半左右）是有原因的：iframe 挂载要写 srcdoc、等 Tailwind、
 * 再 applyBindings，真机量到 300~600ms。余量给小了，慢速平移会看到一格一格
 * 的白板闪。宁可多挂两块。
 */
export const MOUNT_MARGIN = 600;

/**
 * 这块画板现在该不该挂真渲染。
 *
 * ⚠ 这是**性能剔除**，不是可见性判定：返回 false 只意味着"先别挂 iframe"，
 * 画板的白底和标题照画。第一版把它当可见性用（false 就整个不渲染），
 * 结果是缩到 15% 看全景时满屏空白——那正是用户最需要看到轮廓的时候。
 */
export function shouldMountBoard(
  box: ArtboardBox,
  vp: CanvasViewport,
  size: CanvasSize,
  margin = MOUNT_MARGIN
): boolean {
  if (!(size.width > 0) || !(size.height > 0)) return false;
  const s = boxToScreen(box, vp);
  return (
    s.left < size.width + margin &&
    s.left + s.width > -margin &&
    s.top < size.height + margin &&
    s.top + s.height > -margin
  );
}

/** 缩放档位。0.05 起步是为了让 20 页的会话也能一眼看全。 */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 2;

/**
 * 标题条的反缩放系数：让标题在屏幕上恒为可读大小，而不是跟着画板一起缩没。
 *
 * Figma / tldraw 的画板名就是这么做的——名字属于**编辑器 chrome**，不属于
 * 被缩放的内容。上下都夹住：不夹上限的话缩到 5% 时标题会比画板还大，
 * 整屏只剩一排巨字。
 */
export function labelCounterScale(zoom: number): number {
  if (!(zoom > 0)) return 1;
  return Math.min(Math.max(1 / zoom, 0.6), 6);
}

/**
 * 反缩放标签的**宽度上限**（CSS px），让它不超过所属画板/素材卡的宽度。
 *
 * ⚠ 2026-08-25 真机踩到：素材卡是 260 画布 px，适应画布时 19% 缩放 = 屏幕
 *   49px；而标签被反缩放成恒定屏幕尺寸（"placehold.co/120x120" ≈ 150px），
 *   于是**三张素材卡的标签横着压成一坨**，谁也读不出来。截图上就是一行糊字。
 *
 *   画板没露出这个问题只是因为它宽（1920 画布 px），不是因为写法不同——
 *   同一个 bug 在窄一点的东西上才现形。所以上限对两者一起加。
 *
 * 推导：标签在画布坐标系里挂着 `scale(labelScale)`，屏幕宽度 =
 * cssWidth × labelScale × zoom；要它 ≤ 卡片屏幕宽度（boxW × zoom），
 * 两边约掉 zoom 得 cssWidth ≤ boxW / labelScale。
 *
 * 配合 `overflow:hidden` + `text-overflow:ellipsis` 用，光有上限不截断没意义。
 */
export function labelMaxCssWidth(boxW: number, zoom: number): number {
  const scale = labelCounterScale(zoom);
  if (!(boxW > 0) || !(scale > 0)) return 0;
  return boxW / scale;
}

/**
 * 画板标题：导航名 > HTML 里的 <title> > pageId。
 *
 * ⚠ 走 SSE 逐页到达的那条路（sliderule-marathon-driver 的 spec_page 事件）
 * **不带 name**——它只有 pageId/html/current/total/bound/device。所以
 * "推演中的画布"必须能从 HTML 自己扒出名字，否则跑的过程中满屏 p1 p2 p3，
 * 跑完刷新才突然变成中文名。两条来源同一个结果，是本仓第四条纪律。
 */
export function artboardLabel(page: {
  pageId: string;
  name?: string;
  html?: string;
}): string {
  const explicit = (page.name ?? "").trim();
  if (explicit) return explicit;
  const m = (page.html ?? "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (m?.[1] ?? "").replace(/\s+/g, " ").trim();
  if (title) return title;
  return page.pageId;
}

/**
 * 一组画板按 contain 装进容器后的缩放系数。
 *
 * ⚠ 这不是给渲染用的（渲染的缩放是 React Flow 的 fitView 算的，别再算第二遍
 *   ——两份缩放必然分叉，本仓第四条纪律）。它只有一个用途：**给判据用**，
 *   证明"按容器长宽比选列数"确实比写死列数看得更大。
 *   canvas-board-layout.test.ts 里那条 12% → 更大 的判据就卡在它上面。
 */
export function containScale(
  boxes: ReadonlyArray<ArtboardBox>,
  size: CanvasSize,
  padding = 0.14
): number {
  const b = boardsBounds(boxes);
  if (!(b.w > 0) || !(b.h > 0) || !(size.width > 0) || !(size.height > 0)) {
    return 0;
  }
  const usableW = size.width * (1 - padding * 2);
  const usableH = size.height * (1 - padding * 2);
  return Math.min(usableW / b.w, usableH / b.h);
}

/* --------------------------------------------------- 连线接在哪条边上 */

/** 画板四条边的把手 id。跟 ArtboardNode 里 <Handle id> 一一对应。 */
export type BoardSide = "t" | "r" | "b" | "l";

/**
 * 一条连线该从哪条边出、进哪条边。
 *
 * ⚠ 2026-08-25 真机：第一版把 source 写死在右、target 写死在左（React Flow
 *   最常见的写法）。那套是给**从左往右的流程图**用的，而这里是**网格**——
 *   p1 在左上、p3 在它正下方，右出左进的线要绕过整块画板再兜回来，
 *   截图上看就是一条不知道从哪来到哪去的线。
 *
 * 规则很简单：谁的位移大就走谁那条轴。水平位移大就左右出入，垂直位移大就
 * 上下出入。正下方的画板得到一条笔直的竖线，同排的得到一条笔直的横线。
 *
 * ⚠ 相等时走水平：网格里同排相邻是最常见的情形，让它稳定落在横线上，
 *   而不是随浮点误差在横竖之间跳。
 */
export function pickLinkSides(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number }
): { source: BoardSide; target: BoardSide } {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { source: "r", target: "l" }
      : { source: "l", target: "r" };
  }
  return dy >= 0 ? { source: "b", target: "t" } : { source: "t", target: "b" };
}

/* ------------------------------------------------- 画板重排：位置存档 */

/**
 * 手动挪过的画板位置，按会话存。
 *
 * ⚠ 跟手画连线同一套写法（manualLinksStorageKey）：换会话就换一份，
 *   否则上一个应用的位置会串到这个应用的画板上。
 */
export function boardPositionsStorageKey(
  sessionId: string | null | undefined
): string {
  return `sliderule:canvas-boards:${sessionId || "anon"}`;
}

export interface BoardPosition {
  x: number;
  y: number;
}

/**
 * 读存档。
 *
 * ⚠ **必须按当前页面清单过滤**：重新推演之后 pageId 会变（或某页没生成出来），
 *   留着旧 id 的位置不会报错，只会让"自动排布"在某些页上莫名其妙不生效——
 *   跟手画连线那条踩过的是同一个坑。
 *
 * ⚠ 坐标要逐个验有限数：存档被手改过、或者哪天写入端出 bug 存了 NaN，
 *   直接喂给 React Flow 会让那块画板消失在无穷远处，而且屏幕上只是"少了一块"，
 *   很难归因。
 */
export function readBoardPositions(
  raw: string | null,
  knownPageIds: readonly string[]
): Record<string, BoardPosition> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const known = new Set(knownPageIds);
  const out: Record<string, BoardPosition> = {};
  for (const [pageId, value] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    if (!known.has(pageId)) continue;
    if (!value || typeof value !== "object") continue;
    const { x, y } = value as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (typeof y !== "number" || !Number.isFinite(y)) continue;
    out[pageId] = { x, y };
  }
  return out;
}

export function writeBoardPositions(
  positions: Record<string, BoardPosition>
): string {
  return JSON.stringify(positions);
}

/**
 * 焦点在能打字的地方吗。空格平移必须让开这些地方——
 * 在输入框里敲空格是打空格，不是平移画布。
 *
 * ⚠ excalidraw 把键盘监听挂在 document 上、且没有这层判断，是因为它的文本
 *   编辑是自己那套 wysiwyg；我们页面里有真实的 input/textarea（对话框、
 *   元素面板、搜索框），少了这层会变成"在输入框里打不出空格"。
 */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}
