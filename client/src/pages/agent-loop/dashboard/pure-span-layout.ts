/**
 * 纯函数落位：高度算得出来的墙不需要「先隐藏渲染一遍去量」。
 *
 * ## 为什么单独抽出来
 *
 * 2026-08-23 真机（切 tab 反复试，8 次中 4 次）：应用中心只显示第一行 4 张，
 * 其余 52 张 `visibility:hidden` 叠在第一格，**等多久都不会好**。链条是——
 * 数据集换了 → 定位器重建 → `seed` 从头连续命中缓存、第一个就 miss，一条都没
 * 喂回来（日志实录 `prev=65 → next=0`）→ 而那些卡的 DOM 节点还挂着、React 按
 * key 复用不重挂 → **ref 回调不再触发** → 永远不落位 → 永远留在隐藏批次。死锁。
 *
 * 根子在「落位只在挂载那一个时机做」，也就是落位表是**挂载时写一次的可变状态**，
 * 丢了就再也补不回来。而应用中心的卡片高度是 `格宽 ÷ 设备宽高比` 算出来的
 * （信息条浮在画面上不占高度，见 CenterCard），压根不需要那个时机。
 *
 * 这里把它变成纯函数：输入（items × 列宽 × 列数 × span × 高度算式）一定，输出
 * 就一定，每帧重算即可，**没有会丢的状态**，同款死锁在结构上不成立。
 *
 * ## 重算不会让墙「重新拍一次」
 *
 * 贪心最短列是增量的：先摆 0..n-1 再摆 n，与一次摆完 0..n 结果相同（下面
 * `追加下一页不动已有卡片` 那条判据钉住了它）。所以追加分页时已有卡片位置不动，
 * 这条路也就不需要 masonry-append 那套 epoch —— 那是为「落位状态不能丢」服务的。
 *
 * ## 只对高度确定的墙成立
 *
 * 组件库那两面墙的区块是真渲染出来才知道多高，**不能**走这条路，仍旧测量。
 */
import { createSpanPositioner, type SpanPositioner } from "./span-positioner";

export interface PureSpanLayoutOptions<T> {
  items: readonly T[];
  columnCount: number;
  columnWidth: number;
  gutter: number;
  /** 第 index 项占几列（会被钳进 [1, columnCount]）。 */
  spanOf: (item: T, index: number, columnCount: number) => number;
  /** 第 index 项在该格实际宽度下的确切高度。 */
  heightOf: (item: T, index: number, cellWidth: number, columnCount: number) => number;
}

/** 跨列后这一格的实际宽度。布局与渲染必须用同一个算式，否则卡片压盖。 */
export function cellWidthForSpan(columnWidth: number, gutter: number, span: number): number {
  return columnWidth * span + gutter * (span - 1);
}

export function clampSpan(span: number, columnCount: number): number {
  if (!Number.isFinite(span)) return 1;
  return Math.max(1, Math.min(columnCount, Math.floor(span)));
}

/**
 * 把全部 items 一次落位，返回一个**已经填满**的定位器。
 *
 * 返回值仍是 SpanPositioner，好让渲染层（区间树查询、estimateHeight）原样复用。
 */
export function buildPureSpanLayout<T>(opts: PureSpanLayoutOptions<T>): SpanPositioner {
  const { items, columnCount, columnWidth, gutter, spanOf, heightOf } = opts;
  const positioner = createSpanPositioner({
    columnCount,
    columnWidth,
    columnGutter: gutter,
    rowGutter: gutter,
    getSpan: i => clampSpan(spanOf(items[i], i, columnCount), columnCount),
  });
  for (let i = 0; i < items.length; i++) {
    const span = clampSpan(spanOf(items[i], i, columnCount), columnCount);
    const cellW = cellWidthForSpan(columnWidth, gutter, span);
    const raw = heightOf(items[i], i, cellW, columnCount);
    // 高度必须 ≥1。0 会让整列坍塌成同一个 top —— 肉眼就是「所有卡叠在一起」，
    // 正是这次要根治的那个现象，不能让一个坏高度把它从另一头带回来。
    positioner.set(i, Number.isFinite(raw) ? Math.max(1, Math.round(raw)) : 1);
  }
  return positioner;
}
