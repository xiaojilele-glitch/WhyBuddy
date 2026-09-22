/**
 * 瀑布流「画哪些已落位的卡」。
 *
 * overscan / 视口 range 只决定**还要量谁**，不决定**卸谁**。
 *
 * masonic 默认 `range(scrollTop ± overscan)` 会把滚出窗口的卡卸挂。
 * 应用中心每张卡是活缩略图（iframe / AppRuntimeScreen）：卸挂 =
 * 整卡重渲 + `useThumbMountGate` 从 false 重来。区块墙 2026-08-09 用
 * `overscanBy={50}` 躲开过同一件事（ComponentsLibraryPage）——那是把
 * 取件窗口拉到无穷远，碰巧不卸；正确的规则是已落位的卡保持挂载。
 *
 * 2026-08-18 首页滚动时，已经出来的卡又刷一遍，就是这条被违反了。
 */

export function collectPaintIndices(opts: {
  retainPlaced: boolean;
  placedCount: number;
  inViewport: readonly number[];
}): number[] {
  if (opts.placedCount <= 0) return [];
  // ⚠ 别把 retain 写成「仍按 inViewport 裁」——那正是滚出窗口就卸挂。
  if (opts.retainPlaced) {
    return Array.from({ length: opts.placedCount }, (_, i) => i);
  }
  return opts.inViewport.filter(i => i >= 0 && i < opts.placedCount);
}

/**
 * 还没落位的卡要不要现在量。
 *
 * retain 墙（首页活缩略图）下一页一进 `items` 就必须量。overscan 只决定
 * 虚拟化还要往前铺几屏，不决定新卡什么时候量——12 张活卡的列高经常已经
 * 超过 2 屏，`shortest < scrollTop + overscan` 为假，`estimateHeight` 先
 * 把容器垫高，用户看见中间一个大洞。2026-08-18 截图：滚到底空洞，再往上
 * 滑再往下才补上。
 */
export function shouldMeasureUnplaced(opts: {
  unplaced: number;
  measureAllUnplaced: boolean;
  shortestColumn: number;
  rangeEnd: number;
}): boolean {
  if (opts.unplaced <= 0) return false;
  if (opts.measureAllUnplaced) return true;
  return opts.shortestColumn < opts.rangeEnd;
}

/** 这一轮隐藏量高排几张。retain 墙一次量完未落位的；虚拟化才按窗口估。 */
export function nextMeasureBatchSize(opts: {
  unplaced: number;
  measureAllUnplaced: boolean;
  scrollTop: number;
  overscan: number;
  shortestColumn: number;
  itemHeightEstimate: number;
  columnCount: number;
}): number {
  if (opts.unplaced <= 0) return 0;
  if (opts.measureAllUnplaced) return opts.unplaced;
  const slack = opts.scrollTop + opts.overscan - opts.shortestColumn;
  if (slack <= 0) return 0;
  const estimate = Math.max(1, opts.itemHeightEstimate);
  const cols = Math.max(1, opts.columnCount);
  return Math.min(opts.unplaced, Math.max(1, Math.ceil((slack / estimate) * cols)));
}
