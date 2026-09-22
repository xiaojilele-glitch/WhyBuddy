/**
 * 等宽瀑布流卡片墙（2026-08-23 下午，用户对着花瓣的墙选定）。
 *
 * ## 这个文件是 JustifiedWall 改名来的，历史看 git log --follow
 *
 * 当天上午刚从「等宽变高」换到「等高变宽」（两端对齐行，B 方案），下午又换回
 * 等宽——**不是反复，是两次比的不是同一个东西**，记下来免得下次再绕：
 *
 *   上午那一票，A（等宽）和 B（等高）的卡片**都还是信息压在图上、都带边框
 *   阴影**。在那个前提下 B 赢，因为桌面卡能宽到 348~421px，截图里的字第一次
 *   看得清。
 *
 *   下午改的是**卡片本身**：字挪出画面、去掉边框阴影。改完 B 立刻塌了——
 *   手机档在等高变宽下只有 110~133px 宽，标题挪到图外就只剩「构建面…」
 *   「做一个…」，等于没有标题（真机效果图 02 就是这个样子）。
 *
 * 所以「字在图外」和「等宽」是一套：**字挪出去以后，宽度必须由列决定，不能
 * 由宽高比决定**。只做一半就是 02 那张图。
 *
 * ## 层次结构上差在哪（这次要修的）
 *
 * 对着花瓣逐条比，差距只有两条，而且互为因果：
 *   ① 字压在图上（还默认 opacity-30）→ 图被盖一截、字又读不清，两头不讨好；
 *   ② 同一行里手机卡 110px、桌面卡 420px，**大小不再代表任何意思**，眼睛没
 *      有落脚点。参考站是等宽的：每张卡地位一样，靠高度不同产生节奏。
 *
 * ## 落位仍是纯函数（这条不许退）
 *
 * 复用 `buildPureSpanLayout`——那是 2026-08-23 上午为 A 方案写的引擎，换 B 之后
 * 一直**没有调用方**（pure-span-layout.test 里那条判据当时就写着"暂时没有"）。
 * 现在它接回来了。
 *
 * 纪律不变：输入（items × 列宽 × 列数 × 高度算式）定则输出定，每帧 useMemo
 * 重算，**不留跨渲染的可变状态**。那次死锁（切 tab 后只显示第一行 4 张、其余
 * 52 张 visibility:hidden 叠在第一格、等多久都不好）的根子就是"落位表是挂载时
 * 写一次的可变状态，丢了补不回来"，这条路上结构性地不成立。
 *
 * 列数用 `computeColumns`（masonic getColumns() 的同款移植，SpanMasonry 已经
 * 导出），不另写一份。
 *
 * ⚠ 虚拟化按视口过滤，也是纯的（比大小，不存状态）。别改成"记住已渲染的"，
 *   那就把可丢的状态又请回来了。
 */
import * as React from "react";

import { buildPureSpanLayout } from "./pure-span-layout";
import { computeColumns } from "./SpanMasonry";
import { findScrollParent } from "./useScrollerIn";

export interface ColumnsWallProps<T> {
  items: readonly T[];
  /** 容器可用宽度（调用方用 useContainerPosition 量）。 */
  width: number;
  /** 滚动容器可视高度与当前 scrollTop（调用方的 useScrollerIn 给）。 */
  height: number;
  scrollTop: number;
  /** 第 index 项画面的宽高比（宽/高）。桌面 1.6、手机 0.5625。 */
  aspectOf: (item: T, index: number) => number;
  itemKey: (item: T, index: number) => React.Key;
  /**
   * 渲染一格。第三、四个参数是**格宽**和**画面高**（不含图外那条信息行）。
   *
   * ⚠ 给的是画面高不是格高：信息行的高度只有布局知道（captionHeight），
   *   卡片再算一遍就是两处真值，一改一处就压盖或留缝，而且不报错。
   */
  render: (item: T, index: number, width: number, mediaHeight: number) => React.ReactNode;
  /** 列宽下限。列数由容器宽度推出来，再把列宽撑满剩余空间。 */
  minColumnWidth?: number;
  /** 图外那条信息行的高度。计进格高，但**不**计进画面高。 */
  captionHeight?: number;
  spacing?: number;
  /** 视口外多渲几屏，默认 2。 */
  overscanBy?: number;
  className?: string;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  onReachEnd?: () => void;
}

export function ColumnsWall<T>({
  items,
  width,
  height,
  scrollTop,
  aspectOf,
  itemKey,
  render,
  minColumnWidth = 240,
  captionHeight = 32,
  spacing = 16,
  overscanBy = 2,
  className,
  containerRef,
  onReachEnd,
}: ColumnsWallProps<T>) {
  const aspectRef = React.useRef(aspectOf);
  aspectRef.current = aspectOf;
  const keyRef = React.useRef(itemKey);
  keyRef.current = itemKey;

  const keysJoined = React.useMemo(
    () => items.map((it, i) => String(keyRef.current(it, i))).join("\n"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items]
  );

  const [columnWidth, columnCount] = React.useMemo(
    () => (width > 0 ? computeColumns(width, minColumnWidth, spacing) : [0, 1]),
    [width, minColumnWidth, spacing]
  );

  const positioner = React.useMemo(() => {
    if (width <= 0 || items.length === 0) return null;
    return buildPureSpanLayout({
      items,
      columnCount,
      columnWidth,
      gutter: spacing,
      // 等宽是这面墙的全部意义：每张卡占一列，谁都不许跨。错落由画面高度
      // （宽高比不同）产生，不再靠「按页面数取前 1/4 跨两列」那条人工规则。
      spanOf: () => 1,
      heightOf: (it, i, cellW) => {
        const aspect = aspectRef.current(it, i);
        const media = aspect > 0 ? cellW / aspect : cellW;
        return media + captionHeight;
      },
    });
    // keysJoined 覆盖"换了哪些卡"；宽高比由 aspectOf 走 ref 读，不进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysJoined, columnCount, columnWidth, spacing, captionHeight, width]);

  const estimated = positioner ? Math.ceil(positioner.estimateHeight(items.length, 0)) : 0;

  const overscan = Math.max(height, 1) * overscanBy;
  const lo = Math.max(0, scrollTop - overscan);
  const hi = scrollTop + height + overscan;
  // 区间树查一次，拿到视口（含 overscan）内的格子。纯查询，不存任何
  // "已渲染过"的状态。
  const visible = React.useMemo(() => {
    if (!positioner) return [] as { index: number; left: number; top: number; height: number }[];
    const out: { index: number; left: number; top: number; height: number }[] = [];
    positioner.range(lo, hi, (index, left, top) => {
      out.push({ index, left, top, height: positioner.get(index)?.height ?? 0 });
    });
    return out;
  }, [positioner, lo, hi]);

  // 无限流：底部哨兵进视口就喊一次。用 ref 记住上次喊的项数，同一批不重复喊。
  const lastAsked = React.useRef(-1);
  const onReachEndRef = React.useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;
  const itemCountRef = React.useRef(items.length);
  itemCountRef.current = items.length;
  const askMore = React.useCallback(() => {
    const more = onReachEndRef.current;
    const n = itemCountRef.current;
    if (!more || width <= 0 || n === 0 || lastAsked.current === n) return;
    lastAsked.current = n;
    more();
  }, [width]);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!onReachEnd || width <= 0) return;
    const el = sentinelRef.current;
    const grid = containerRef.current;
    if (!el || !grid || typeof IntersectionObserver === "undefined") return;
    const root = findScrollParent(grid);
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) askMore();
      },
      { root, rootMargin: "400px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // ⚠ 依赖里不许有 items.length：哨兵还在视口里时重建 IO 会立刻再报
    //   intersecting，同一页被 concat 两次（同 SpanMasonry 那条）。
  }, [onReachEnd, width, askMore, containerRef]);

  // 宽度还没量到就先挂个占位，useContainerPosition 才量得到。
  if (width <= 0) {
    return (
      <div
        ref={containerRef}
        role="list"
        className={className}
        style={{ position: "relative", width: "100%", minHeight: 1 }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      role="list"
      className={className}
      style={{ position: "relative", width: "100%", maxWidth: "100%", height: estimated }}
    >
      {visible.map(box => {
        const item = items[box.index];
        if (item === undefined) return null;
        return (
          <div
            key={itemKey(item, box.index)}
            role="listitem"
            style={{
              position: "absolute",
              top: box.top,
              left: box.left,
              width: columnWidth,
              height: box.height,
            }}
          >
            {render(item, box.index, columnWidth, Math.max(0, box.height - captionHeight))}
          </div>
        );
      })}
      <div
        ref={sentinelRef}
        aria-hidden
        data-testid="masonry-end"
        style={{
          position: "absolute",
          left: 0,
          top: Math.max(0, estimated - 1),
          width: 1,
          height: 1,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
