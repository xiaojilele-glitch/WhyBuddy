/**
 * 支持跨列的瀑布流渲染层 —— masonic 的 `useMasonry` 换掉、其余照旧。
 *
 * ## 为什么不能继续用 useMasonry
 *
 * 它把每个格子的宽度写死成全局列宽（dist/module/use-masonry.js:93 的
 * `width: columnWidth`，以及传给 render 的第三个参数）。跨列卡即使定位算对了，
 * 外层 div 还是一列宽，卡片只能画成一列。这不是配置能绕开的，只能自己渲染。
 *
 * ## 为什么连 useResizeObserver 也自己写
 *
 * masonic 的 `createResizeObserver` 靠模块私有的 `elementsCache`（一张
 * WeakMap<Element, index>）把 resize 事件映射回格子下标，而 `elements-cache`
 * **没有出现在包的导出列表里**（dist/module/index.js 只导出 11 个模块，不含它）。
 * 也就是说自己写 ref 回调就填不进那张表，事件回来查不到 index，量高整条链断掉。
 * 与其去 import 一个私有路径（升级即碎），不如自己维护这张映射——三十行，
 * 而且从此不依赖 masonic 的内部实现。
 *
 * 仍然复用 masonic 的：`createIntervalTree`（O(log n) 视口查询，见
 * span-positioner.ts）、`useContainerPosition`。滚动源仍是本地容器（useScrollerIn）。
 *
 * 落位规则在 span-positioner.ts，那里是纯函数、有单测；这里只管渲染。
 */

import * as React from "react";
import {
  copyPlacements,
  createSpanPositioner,
  type SpanPositioner,
  type SpanPositionerOptions,
} from "./span-positioner";
import { nextLayoutEpoch } from "./masonry-append";
import {
  collectPaintIndices,
  nextMeasureBatchSize,
  shouldMeasureUnplaced,
} from "./masonry-paint";
import { findScrollParent } from "./useScrollerIn";
import { buildPureSpanLayout } from "./pure-span-layout";

/** masonic `getColumns()` 的同款算法：由容器宽度推列数，再把列宽撑满剩余空间。 */
export function computeColumns(
  width: number,
  minColumnWidth: number,
  gutter: number,
  maxColumnCount?: number
): [columnWidth: number, columnCount: number] {
  const count =
    Math.min(
      Math.floor((width + gutter) / (minColumnWidth + gutter)),
      maxColumnCount ?? Infinity
    ) || 1;
  const columnWidth = Math.floor((width - gutter * (count - 1)) / count);
  return [columnWidth, count];
}

/**
 * 建/换定位器。换列数或换数据集时重建，重建后由 `seed` 把已量到的高度喂回去。
 *
 * ## 为什么 seed 交给调用方，而不是照 masonic 那样按 index 拷贝
 *
 * masonic 的 `usePositioner` 重建时是 `next.set(i, prev.get(i).height)` —— 按**下标**
 * 搬。它只在「列宽/列数变了」时这么干，数据集变了(deps 变)时是**整张缓存丢掉重量**。
 *
 * 我们原来两种情况都按下标搬，于是筛选一次（数据集换了）就出事：新的第 3 项拿到了
 * 旧的第 3 项的高度，卡片被塞进一个装不下它的槽位——**外层 div 没有设 height，
 * 真实内容比槽位高就直接画到下一张上面去**，这就是肉眼看到的重叠。
 *
 * 现在按 `itemKey` 缓存高度（gestalt 的 MeasurementStore 就是 `WeakMap<item, height>`，
 * 同一个思路）：谁的高度归谁，换列宽、换筛选、换排序都不会串。
 */
function useSpanPositioner(
  opts: SpanPositionerOptions,
  deps: React.DependencyList,
  seed: (p: SpanPositioner) => void
): SpanPositioner {
  const { columnCount, columnWidth, columnGutter, rowGutter } = opts;
  // getSpan 每次渲染都是新函数，不能进依赖数组；用 ref 让定位器始终读到最新的。
  const getSpanRef = React.useRef(opts.getSpan);
  getSpanRef.current = opts.getSpan;

  const init = React.useCallback(
    () =>
      createSpanPositioner({
        columnCount,
        columnWidth,
        columnGutter,
        rowGutter,
        getSpan: i => getSpanRef.current(i),
      }),
    [columnCount, columnWidth, columnGutter, rowGutter]
  );

  const ref = React.useRef<SpanPositioner | undefined>(undefined);
  if (ref.current === undefined) {
    ref.current = init();
    seed(ref.current);
  }
  const prevKey = React.useRef<React.DependencyList>([
    columnCount,
    columnWidth,
    columnGutter,
    rowGutter,
    ...deps,
  ]);
  const key = [columnCount, columnWidth, columnGutter, rowGutter, ...deps];
  if (key.length !== prevKey.current.length || key.some((v, i) => prevKey.current[i] !== v)) {
    const prev = ref.current;
    const next = init();
    const prevCount = Number(prevKey.current[0]);
    const prevSig = String(prevKey.current[prevKey.current.length - 1] ?? "");
    const nextSig = String(deps[0] ?? "");
    // 列数相同且还是同一面墙：只搬 column/span，不 place() 重选列。
    // 滚动条出现会让 columnWidth 变一两像素——seed+place 就是顶部重拍。
    if (
      prev &&
      prev.size() > 0 &&
      prevCount === columnCount &&
      prevSig === nextSig
    ) {
      copyPlacements(prev, next);
    } else {
      seed(next);
    }
    prevKey.current = key;
    ref.current = next;
  }
  return ref.current;
}

/**
 * ResizeObserver 那一层。
 *
 * ## 下标写在 DOM 上，不写在 WeakMap 里
 *
 * 原来是 `setRef(index)` 返回一个新闭包 + 一张 `WeakMap<Element, index>`。两个毛病：
 *   ① `setRef(index)` **每次渲染都是新函数**，React 会 `ref(null)` 再 `ref(el)`，
 *      于是每渲染一轮就重新 observe 一遍所有格子，白白触发一轮首帧回调；
 *   ② 定位器一换（列数变、筛选变），`setRef` 的依赖变了，全部 ref 重挂，
 *      每张卡都重新走一次"首次挂载量高"。
 *
 * gestalt 的 `ItemResizeObserverWrapper` 把下标直接写成 `data-grid-item-idx` 属性，
 * RO 回调里 `Number(target.getAttribute(...))` 读回来。照抄这个：ref 回调从此是
 * **恒等函数**，React 不再反复摘挂；下标由 React 正常更新属性来维持最新。
 */
const INDEX_ATTR = "data-span-index";
const KEY_ATTR = "data-span-key";
/**
 * 判定"墙不动了"要静多久。
 *
 * 下限由 antd 那批两趟渲染的组件定：FilterBar 实测 `204 → 304`，两趟之间隔着
 * 一次 ResizeObserver 派发（下一个宏任务）。取 250ms 是留足余量又不至于让
 * 用户看见"停一下再跳"——开场首屏本来就还在陆续量高。
 */
const SETTLE_MS = 250;
/**
 * ## 重新挂载会量出不一样的高度 —— 这一层**不负责**治它
 *
 * 虚拟化把格子卸载再挂回来时，antd 表单、ECharts 这类内容刚挂上的一两帧还没铺开，
 * 量到的高度偏小。插桩录到的原样（滚下去再滚回来两轮）：
 *
 *     desktop-FilterBar   304->204  204->304  304->204  204->304  304->204
 *
 * 每次 `304->204` 触发一次重排，它下面整列跟着跳，回头又跳回去。
 *
 * 试过在这儿治：给刚 observe 的元素打个标记，把首次回调丢掉（gestalt 的
 * MeasurementStore 是"量一次就不再量"，这算是它的细化版）。**不成立**——
 * 分不清"没铺开的中间态"和"这张卡真的变高了"。实测把图表画完那次真增长也吞了，
 * 定位器记的高度比实际小 140px，直接压到下一张上面。
 *
 * 所以这条从测量层撤掉了。卸挂本身由 `retainPlaced`（默认开）拦住：
 * 已落位的卡保持挂载，overscan 只决定还要量谁。区块墙 2026-08-09 用
 * overscanBy=50 躲开过同一件事（ComponentsLibraryPage）；2026-08-18 首页
 * 活缩略图又踩了一次——overscanBy=2 把滚出窗口的 iframe 卸挂再挂。
 * 这一层只保留一条测量纪律：**整像素相同不算变化**（死区，同 gestalt 的 Math.floor）。
 */
function useSpanResizeObserver(
  positionerRef: React.MutableRefObject<SpanPositioner>,
  knownHeight: (key: string) => number | undefined,
  onMeasured: (key: string, height: number) => void
) {
  const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);
  const measure = React.useRef(onMeasured);
  measure.current = onMeasured;
  const known = React.useRef(knownHeight);
  known.current = knownHeight;

  const observer = React.useMemo(() => {
    if (typeof ResizeObserver === "undefined") return null;
    return new ResizeObserver(entries => {
      const positioner = positionerRef.current;
      const updates: number[] = [];
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const raw = el.getAttribute(INDEX_ATTR);
        if (raw === null) continue;
        const index = Number(raw);
        const height = el.offsetHeight;
        if (height <= 0) continue;
        const k = el.getAttribute(KEY_ATTR);
        if (k !== null) measure.current(k, height);
        const pos = positioner.get(index);
        // 死区同 positioner.update：整像素相同就当没变。
        if (pos !== undefined && Math.floor(height) !== Math.floor(pos.height)) {
          updates.push(index, height);
        }
      }
      if (updates.length > 0) {
        positioner.update(updates);
        forceUpdate();
      }
    });
    // 定位器换了也**不用**换观察器：它每次回调都从 ref 读当前定位器，
    // 下标又是从 DOM 属性读的，天然跟着 React 的渲染走。
  }, [positionerRef]);

  React.useEffect(() => () => observer?.disconnect(), [observer]);

  const setRef = React.useCallback(
    (el: HTMLElement | null) => {
      if (el === null) return;
      const k = el.getAttribute(KEY_ATTR);
      const index = Number(el.getAttribute(INDEX_ATTR));
      const cached = k === null ? undefined : known.current(k);
      // 落位用的高度：老熟人用缓存值，新面孔现量。
      //
      // **这里绝不能因为"是老熟人"就跳过 set** —— 定位器可能是新建的（换了列宽
      // 或换了数据集），里面还没有这一格。不落位的话 `positioner.size()` 就卡住
      // 不涨，而 SpanMasonry 拿它当"下一个该量的下标"，隐藏批次会一直重渲染
      // 同一批，同一个 key 出现在两处 —— 实测直接摞出满屏重叠。
      const h = cached ?? el.offsetHeight;
      // **落位这一步不能有任何前置条件。** 已落位的下标必须恒等于 [0, size())
      // 这一段连续前缀 —— SpanMasonry 拿 size() 当"下一个该量的下标"，中间空一个
      // 就会：第 k 格永远不落位 → size() 停在 k → 隐藏批次一直从 k 重来，
      // 而 k 之后已落位的格子同时出现在"定位好的"和"隐藏待量的"两处，
      // 同一个 key 渲染两遍 —— React 留下孤儿节点，屏幕上就是两张卡叠着。
      //
      // 这条是 2026-08-09 亲手踩的：当时给它加了个 `if (h > 0)` 的保护，
      // 想跳过"还没布局好、量出来是 0"的格子。结果 1600 视口下 19 帧全部重叠。
      // 量到 0 没关系，ResizeObserver 下一帧就会纠正；**跳过落位才是灾难**。
      if (k !== null && cached === undefined && h > 0) measure.current(k, h);
      // 首次落位就得有高度——ResizeObserver 的首帧回调赶不上这一轮渲染。
      if (positionerRef.current.get(index) === undefined) {
        positionerRef.current.set(index, h);
      }
      observer?.observe(el);
    },
    [observer, positionerRef]
  );

  return { setRef, forceUpdate };
}

export interface SpanMasonryProps<T> {
  items: T[];
  /** 容器可用宽度（由调用方用 useContainerPosition 量）。 */
  width: number;
  /** 滚动容器的可视高度与当前 scrollTop（由调用方的 useScrollerIn 给）。 */
  height: number;
  scrollTop: number;
  isScrolling?: boolean;
  minColumnWidth: number;
  gutter: number;
  maxColumnCount?: number;
  /**
   * **高度算得出来时传它——传了就整套不量了。**
   *
   * 返回第 index 项在给定格宽下的确切高度（含跨列后的宽度）。传了这个属性：
   *   · 不再隐藏渲染一遍去量（每张卡从渲染两次变一次）
   *   · 不挂 ResizeObserver
   *   · 落位表由 useMemo **纯函数重算**，不再是"挂载时写一次的可变状态"
   *
   * ## 为什么值得单开这条路
   *
   * 2026-08-23 真机（切 tab 反复试，8 次中 4 次）：整面墙只显示第一行 4 张，
   * 其余 52 张 `visibility:hidden` 叠在第一格，**等多久都不会好**。
   * 链条是——数据集换了 → 定位器重建 → `seed` 从头连续命中缓存，第一个就
   * miss，一条都没喂回来（日志实录 `prev=65 → next=0`）→ 而那些卡的 DOM
   * 节点还挂着、React 按 key 复用不重挂 → **ref 回调不再触发** → 永远不落位
   * → 永远留在隐藏批次。死锁。
   *
   * 根子在"落位只在挂载那一个时机做"。高度算得出来的墙压根不需要那个时机：
   * 输入（items × 列宽 × span）一定，输出就一定，每帧重算即可，没有会丢的状态。
   *
   * ## 只对高度确定的墙有效
   *
   * 应用中心的卡片高度是 `格宽 ÷ 设备宽高比`（信息条浮在画面上、不占高度，
   * 见 CenterCard 的 `style={{height: mediaHeight}}`），所以算得出来。
   * 组件库那两面墙的区块是真渲染出来才知道多高的，**不传这个属性**，照旧走测量。
   *
   * ⚠ 传进来的高度必须跟卡片**真实渲染高度**一致。不一致的现象是卡片之间
   *   互相压盖或留空隙，而且不会有任何报错——所以调用方与渲染函数应当共用
   *   同一个高度算式（见 AppsWorkbench 的 wallCardHeight）。
   */
  heightOf?: (item: T, index: number, cellWidth: number, columnCount: number) => number;
  /** 第 index 项占几列。会被钳进 [1, 列数]。 */
  getSpan: (item: T, index: number, columnCount: number) => number;
  itemKey: (item: T, index: number) => React.Key;
  /** 渲染一格。width 是**该格**的实际宽度（跨列时更宽）。 */
  render: (item: T, index: number, width: number, columnCount: number) => React.ReactNode;
  /** 首屏还没量到真实高度时用来估总高。 */
  itemHeightEstimate?: number;
  /**
   * 视口外多**量**几屏，默认 2。只决定隐藏批次从哪往前铺，
   * 不决定把已经落下的卡卸掉——那是 `retainPlaced` 的事。
   */
  overscanBy?: number;
  /**
   * 已落位的卡保持挂载。默认开。
   *
   * 关了才走 masonic 那套视口裁切：滚出 `scrollTop ± overscan/2` 就卸挂。
   * 活缩略图（iframe / 运行时屏）卸挂 = 整卡重渲，首页 2026-08-18 踩过。
   */
  retainPlaced?: boolean;
  /**
   * 允许「沉降重排」：全部落位且高度安静下来之后，用真高度**重选一次列**。
   * 默认关。
   *
   * 只有**不随滚动逐批落位**的墙才该开——也就是 overscanBy 大到一次性全渲染、
   * 且不接 onReachEnd 无限流的那种。虚拟化墙开了它，会在用户滚到底的那一刻
   * 把整面墙洗一遍。
   *
   * 为什么值得开：定位器重建时 `seed` 会照喂**过期列宽下量的高度**（那是它有意
   * 为之，只负责维持连续前缀），而 `update()` 只 reflow、按定义不重选列，
   * 于是开场那次用错高度选的列会**永久留下**。区块墙实测因此差了 551px
   * （填充 75.0% → 86.6%），详见 span-positioner 文件头。
   */
  settleLayout?: boolean;
  className?: string;
  /** 网格容器的 ref。同一个 ref 也给 useScrollerIn / useContainerPosition 用。 */
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  /** 滚到接近末尾时回调一次（无限流）。 */
  onReachEnd?: () => void;
}

export function SpanMasonry<T>({
  items,
  width,
  height,
  scrollTop,
  isScrolling,
  minColumnWidth,
  gutter,
  maxColumnCount,
  heightOf,
  getSpan,
  itemKey,
  render,
  itemHeightEstimate = 240,
  overscanBy = 2,
  retainPlaced = true,
  settleLayout = false,
  className,
  containerRef,
  onReachEnd,
}: SpanMasonryProps<T>) {
  const [columnWidth, columnCount] = React.useMemo(
    () => computeColumns(width, minColumnWidth, gutter, maxColumnCount),
    [width, minColumnWidth, gutter, maxColumnCount]
  );

  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const spanRef = React.useRef(getSpan);
  spanRef.current = getSpan;
  const keyRef = React.useRef(itemKey);
  keyRef.current = itemKey;

  // 量到的高度按 **itemKey** 存，不按下标。理由见 useSpanPositioner 的注释。
  // 连**当时的列宽**一起存：同一张卡在不同列宽下高度不同，得能分辨"这条是不是
  // 本次布局量的"。
  const heights = React.useRef(new Map<string, { h: number; gen: string }>()).current;
  const cellGeneration = `${columnWidth}x${columnCount}`;

  // 这张缓存**永远不整张清空**。踩过：列宽一变就 clear，结果 seed 一条都喂不出来，
  // 而已经挂在页面上的格子又不会自己重新落位（ref 是恒等函数，不重挂）——
  // 定位器里于是只有下标 8..29，0..7 是个洞，`size()` 停在 22，隐藏批次从 22 开始
  // 重渲染**已经定位好的** 22..29，同一个 key 出现两遍，满屏摞卡。
  //
  // 正确的分工是：
  //   · seed  —— 过期高度照喂。它只负责让落位保持"从 0 开始的连续前缀"，
  //             位置对不对下一步会纠正；
  //   · gen   —— 只用来判断"刚挂上来的这次量高要不要采信"。列宽变了就采信新量的。
  const onMeasured = React.useCallback(
    (k: string, h: number) => {
      heights.set(k, { h, gen: cellGeneration });
    },
    [heights, cellGeneration]
  );
  /** 本次列宽下量过的高度。过期（换过列宽）的不算，好让它重新量一次。 */
  const knownHeight = React.useCallback(
    (k: string) => {
      const rec = heights.get(k);
      return rec && rec.gen === cellGeneration ? rec.h : undefined;
    },
    [heights, cellGeneration]
  );

  // 数据集指纹：换筛选/换排序才重建定位器。下一页追加（旧 key 是新 key 的
  // 前缀）必须留下同一实例——desandro `appended` / gestalt MeasurementStore
  // 的同一条。⚠ 2026-08-18 以前把整串 key 哈希进指纹，追加 12 张就整墙
  // `place()` 重来，已落位的卡换列，用户看见「重新拍了」。
  const keysJoined = React.useMemo(
    () => items.map((it, i) => String(keyRef.current(it, i))).join("\n"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );
  const epochRef = React.useRef(0);
  const prevKeysRef = React.useRef<string[]>([]);
  const signature = React.useMemo(() => {
    const keys = keysJoined === "" ? [] : keysJoined.split("\n");
    epochRef.current = nextLayoutEpoch(prevKeysRef.current, keys, epochRef.current);
    prevKeysRef.current = keys;
    return String(epochRef.current);
  }, [keysJoined]);

  // 重建后把缓存里的高度喂回去。只喂**从头开始连续命中**的那一段：
  // SpanMasonry 拿 positioner.size() 当"下一个该量的下标"，中间留洞会漏格子。
  const seed = React.useCallback(
    (p: SpanPositioner) => {
      const list = itemsRef.current;
      for (let i = 0; i < list.length; i++) {
        // 过期列宽下量的也照喂 —— 见上面那段"这张缓存永远不整张清空"。
        const rec = heights.get(String(keyRef.current(list[i], i)));
        if (rec === undefined) break;
        p.set(i, rec.h);
      }
    },
    [heights]
  );

  const positionerRef = React.useRef<SpanPositioner | null>(null);
  const measuredPositioner = useSpanPositioner(
    {
      columnCount,
      columnWidth,
      columnGutter: gutter,
      rowGutter: gutter,
      getSpan: index => {
        const item = itemsRef.current[index];
        return item === undefined ? 1 : spanRef.current(item, index, columnCount);
      },
    },
    [signature],
    seed
  );
  /**
   * 纯函数落位（传了 `heightOf` 才有）。
   *
   * 整张表由 useMemo 从 items × 列宽 × span 重算，**不留任何跨渲染的可变状态**。
   * 重算不会让墙"重新拍一次"：贪心最短列是增量的——先摆 0..n-1 再摆 n，与一次
   * 摆完 0..n 结果相同，所以追加下一页时已有卡片的位置不动。也正因如此，
   * 这条路不需要 epoch/append 那套（那是为"落位状态不能丢"服务的）。
   */
  const heightOfRef = React.useRef(heightOf);
  heightOfRef.current = heightOf;
  const pure = Boolean(heightOf);
  const purePositioner = React.useMemo(() => {
    const compute = heightOfRef.current;
    if (!compute || width <= 0) return null;
    return buildPureSpanLayout({
      items: itemsRef.current,
      columnCount,
      columnWidth,
      gutter,
      spanOf: (item, i, cc) => spanRef.current(item, i, cc),
      heightOf: (item, i, cellW, cc) => compute(item, i, cellW, cc),
    });
    // keysJoined 覆盖"换了哪些卡"，列宽/列数/间距覆盖几何。getSpan/heightOf
    // 每轮都是新函数，走 ref，不进依赖。
  }, [pure, keysJoined, columnCount, columnWidth, gutter, width]);

  const positioner = pure && purePositioner ? purePositioner : measuredPositioner;
  positionerRef.current = positioner;
  const { setRef, forceUpdate } = useSpanResizeObserver(
    positionerRef as React.MutableRefObject<SpanPositioner>,
    knownHeight,
    onMeasured
  );
  // 纯函数路不挂 ref：不量高度，也就不需要 ResizeObserver。
  const cellRef = pure ? undefined : setRef;

  const itemCount = items.length;
  // 「下一批从哪儿开始量」问的是**第一个没落位的下标**，不是"落了几格"。
  // 两者只有在落位恰好是连续前缀时才相等，而那个前提是会被破坏的（见
  // firstUnplaced 的文档：破坏之后同一个 key 会被画两遍）。
  const measuredCount = positioner.firstUnplaced();
  const shortestColumnSize = positioner.shortestColumn();
  const overscan = height * overscanBy;
  const rangeEnd = scrollTop + overscan;
  // retain 墙：下一页一到就量，不等 overscan 窗口。列高过两屏时旧判据
  // 为假，estimateHeight 先垫出大洞，再往上滑再往下才补——2026-08-18 截图。
  const needsFreshBatch = shouldMeasureUnplaced({
    unplaced: itemCount - measuredCount,
    measureAllUnplaced: retainPlaced,
    shortestColumn: shortestColumnSize,
    rangeEnd,
  });

  const children: React.ReactNode[] = [];
  // 已落位的卡：retainPlaced 时全部画。视口 range 只在关了 retain 时用来裁切。
  // 2026-08-18：首页 overscanBy=2 按窗口卸挂活缩略图，已经出来的卡整卡重渲。
  const inViewport: number[] = [];
  if (!retainPlaced) {
    positioner.range(Math.max(0, scrollTop - overscan / 2), rangeEnd, index => {
      inViewport.push(index);
    });
  }
  const paint = collectPaintIndices({
    retainPlaced,
    placedCount: measuredCount,
    inViewport,
  });
  for (const index of paint) {
    const item = items[index];
    const pos = positioner.get(index);
    if (item === undefined || pos === undefined) continue;
    children.push(
      <div
        key={itemKey(item, index)}
        ref={cellRef}
        role="listitem"
        {...{ [INDEX_ATTR]: index, [KEY_ATTR]: String(itemKey(item, index)) }}
        style={{
          position: "absolute",
          top: pos.top,
          left: pos.left,
          width: pos.width,
          writingMode: "horizontal-tb",
        }}
      >
        {render(item, index, pos.width, columnCount)}
      </div>
    );
  }

  // 还没量到高度的：先按各自的真实宽度隐藏渲染一批，量完下一轮才定位。
  // 宽度必须是**跨列后的宽度**，否则跨列卡会按一列宽换行、量出偏高的高度。
  // 纯函数路没有「待量」这回事：上面 useMemo 已经把每一格都落好位了。
  if (!pure && needsFreshBatch) {
    const batchSize = nextMeasureBatchSize({
      unplaced: itemCount - measuredCount,
      measureAllUnplaced: retainPlaced,
      scrollTop,
      overscan,
      shortestColumn: shortestColumnSize,
      itemHeightEstimate,
      columnCount,
    });
    let queued = 0;
    for (let index = measuredCount; index < itemCount && queued < batchSize; index++) {
      const item = items[index];
      if (item === undefined) continue;
      // **已经定位好的绝不再画一遍。** 一个下标要么在上面那段（定位好的）里，
      // 要么在这里（隐藏待量），不能两边都有——两边都有就是同一个 key 渲染两次，
      // React 会留下孤儿节点，屏幕上就是两张卡严丝合缝地摞着。
      if (positioner.get(index) !== undefined) continue;
      queued++;
      const span = Math.max(1, Math.min(columnCount, spanRef.current(item, index, columnCount)));
      const w = columnWidth * span + gutter * (span - 1);
      children.push(
        <div
          key={itemKey(item, index)}
          ref={setRef}
          role="listitem"
          {...{ [INDEX_ATTR]: index, [KEY_ATTR]: String(itemKey(item, index)) }}
          style={{
            width: w,
            zIndex: -1000,
            visibility: "hidden",
            position: "absolute",
            writingMode: "horizontal-tb",
          }}
        >
          {render(item, index, w, columnCount)}
        </div>
      );
    }
  }

  // 量完一批要再渲染一轮把它们定位上去。measuredCount 必须进依赖：
  // 只盯 needsFreshBatch 的话，它保持 true 时 effect 不再跑，后半页就
  // 停在「已 set、未画」，直到下一次滚动才补上。
  React.useEffect(() => {
    if (!pure && needsFreshBatch) forceUpdate();
  }, [pure, needsFreshBatch, measuredCount, itemCount, forceUpdate]);

  // 沉降：全部落位、且高度安静下来之后，用真高度重选一次列。**只一次**，
  // 闸在定位器里（`resettle` 自带 `resettled` 标志），理由见 span-positioner 文件头。
  //
  // `revision` 一变这条 effect 就重跑、计时器重新开始数——所以"安静 SETTLE_MS"
  // 是真的安静，而不是"从第一次落位起数 SETTLE_MS"。
  //
  // ⚠ 开关由**调用方**给（`settleLayout`），不在这里猜。
  //
  // 第一版猜的是 `scrollTop === 0`，理由是"虚拟化墙要滚到底才全部落位，那时
  // 重选列就是在用户眼皮底下洗牌"。方向对，判据错——它把**分页**一起误伤了：
  // 区块墙翻页时 `onPageChange` 会调 `backToTop()`，但那个 scrollTo 不生效
  // （实测翻到第 2 页后墙的滚动父级 `MAIN.agent-ant-layout-content` 仍停在 976），
  // 于是第 2 页起永远不沉降。插桩录到的原样：第 2 页装了 6 次计时器、
  // **触发 0 次**，全被 effect 清理掉了；离线拿最终高度重跑同一批卡是 1503，
  // 浏览器是 1885 —— 382px 白丢。
  //
  // "这面墙是不是随滚动逐批落位"是调用方**知道**的事（它自己设的 overscanBy、
  // 自己接的 onReachEnd），拿滚动位置去反推只会像上面这样被别的原因带偏。
  const revision = positioner.revision();
  React.useEffect(() => {
    if (pure || !settleLayout || itemCount === 0 || measuredCount < itemCount) return;
    const timer = window.setTimeout(() => {
      if (positioner.resettle()) forceUpdate();
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [pure, positioner, revision, measuredCount, itemCount, settleLayout, forceUpdate]);

  // 无限流：滚到只剩不到一屏就喊一次。用 ref 记住上次喊的项数，避免同一批重复喊。
  // 底部哨兵走 IntersectionObserver——不依赖 scrollTop。2026-08-18 首帧
  // width=0 占位让滚动监听绑到 window，scrollTop 恒 0，墙一高过两屏就再也不喊。
  //
  // ⚠ 观察者依赖里不许有 itemCount。open-noodle/gallery #847：哨兵还在视口里
  // 时重建 IO 会立刻再报 intersecting，同一页被 concat 两次。项数变了由下面
  // 那条高度估算去 catch-up（lastAsked 按 itemCount 闸）。
  const lastAsked = React.useRef(-1);
  const onReachEndRef = React.useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;
  const itemCountRef = React.useRef(itemCount);
  itemCountRef.current = itemCount;
  const askMore = React.useCallback(() => {
    const more = onReachEndRef.current;
    const n = itemCountRef.current;
    if (!more || width <= 0 || n === 0) return;
    if (lastAsked.current === n) return;
    lastAsked.current = n;
    more();
  }, [width]);
  React.useEffect(() => {
    if (width <= 0) return;
    const tallest = positioner.estimateHeight(itemCount, itemHeightEstimate);
    if (scrollTop + height >= tallest - height) askMore();
  }, [scrollTop, height, itemCount, positioner, itemHeightEstimate, width, askMore]);
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
      { root, rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onReachEnd, width, askMore, containerRef]);

  const estimated = Math.ceil(positioner.estimateHeight(itemCount, itemHeightEstimate));
  // 宽度还没量到就先占位：用 0 宽 place 成 1 列，量到真宽再 seed+place，
  // 等于开场先拍一次又整墙重拍。容器必须先挂上，useContainerPosition 才量得到。
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
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "100%",
        height: estimated,
        maxHeight: estimated,
        willChange: isScrolling ? "contents" : undefined,
        pointerEvents: isScrolling ? "none" : undefined,
      }}
    >
      {children}
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
