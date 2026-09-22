/**
 * 支持「跨列」的瀑布流定位器 —— masonic 的 Positioner 接口 + Pinterest 的跨列放置规则。
 *
 * ## 为什么要自己写这一个
 *
 * masonic 自带的 `usePositioner` 里，一格恒等于一列：
 *     set(index, height) { 找最矮列; items[index] = { left: column * (w + g), ... } }
 * 宽度没有逐项的概念，`useMasonry` 渲染时也是把 `positioner.columnWidth` 直接写死到
 * 每个格子的 style 上（dist/module/use-masonry.js:93）。所以「让某些卡占两列」这件事
 * 在 masonic 的模型里表达不出来，不是配置问题。
 *
 * 而我们**必须**有跨列：应用中心的卡片高度是 `列宽 / 设备宽高比` 算出来的，设备只有
 * 桌面/平板/手机三档，线上真实分布是桌面 12、手机 2、空串 5（空串按桌面算）——
 * 89% 的卡走同一个比例。实测 1920px 下 12 张卡里 11 张高度**恰好都是 234px**，
 * 一个像素不差。瀑布流算法再好，输入是常数，输出就只能是整齐网格。花瓣/Pinterest
 * 的错落来自图片宽高比本身千差万别，那个前提我们没有，只能另找一个**真实的**
 * 差异来源——跨列就是 Pinterest 自己给出的答案。
 *
 * ## 放置规则的出处
 *
 * 照抄 Pinterest 开源设计系统 gestalt 的 `Masonry/multiColumnLayout.ts`
 * （https://github.com/pinterest/gestalt，pinterest.com 线上在跑的那个组件）：
 *
 *   · 单列格子 —— 落最矮列（`mindex.ts`，跟 masonic 原生一致）
 *   · 跨列格子 —— `getMultiColItemPosition()`：
 *       ① 在所有长度为 span 的**相邻列窗口**里，挑「高度差最小」的那个窗口起点
 *          （即最平的一段，跨上去产生的空白最少）
 *       ② top 取该窗口内**最高**的那列——取最矮会盖住旁边已有的卡
 *       ③ 落位后把窗口内**每一列**都抬到 `top + height + rowGutter`
 *     ①的度量取他们 `_multiColPositionAlgoV2` 那一支（窗口内总空白
 *     `Σ(max - h)`）而不是老的相邻两列差绝对值：老那支的推导只在 span=2 成立，
 *     span≥3 要另外再求一次均值；总空白的写法对任意 span 都是同一个式子。
 *   · 首行特例 —— gestalt 用 `heights.indexOf(0)` 让能塞进首行的跨列格子靠左对齐，
 *     否则第一排就会先在左边留一个洞。这里收紧成「窗口内每列都还是 0」，因为
 *     `indexOf(0)` 只检查了起点那一列。
 *
 * ## update 只重算几何，**不重新选列**（2026-08-09 改，见下）
 *
 * ### 之前是怎么写的，为什么错
 *
 * 原来 `update()` 走「全量重排」：把记录的高度从头喂一遍 `place()`，连**选哪一列**
 * 都重新算。当时的理由写在这儿是「拿一个常数倍开销换不可能重叠」。
 *
 * 那个理由只对了一半：重叠确实没了，但**换来了更难受的毛病——整面墙会自己动**。
 * 任何一张卡改高（图表画完、表格拿到数据、卡片被滚出去又滚回来重新量），
 * `bestSpanStart` 就在新的列高上重选一遍，于是**所有卡的列都可能重新洗牌**。
 *
 * 实测（体验区块墙，Playwright 逐屏滚动、每帧单独判）：
 *
 *     视口 2000：13 帧里卡片位移 44 次，最大位移 569px
 *     视口 1600：19 帧里位移 80 次，最大 501px，2 帧出现真重叠
 *     视口 1280：23 帧里位移 63 次，最大 202px，1 帧出现真重叠
 *
 * 而且是**来回**跳：`WorkflowTimeline 1203→634→1203→634`、`FilterBar 238→207→238`
 * ——往下滚一屏跳一次，滚回来又跳回去。用户报的「不是很稳定」就是这个。
 *
 * ### 开源实现是怎么做的（都拉到本地看过）
 *
 *   · **masonic**（`use-positioner.ts` 的 `update`）：一格落进哪一列在 `set` 时就
 *     定死，记在 `columnItems[column]` 里；`update` 只在**受影响的那几列内部**
 *     二分找到第一个受影响的格子，往下顺序推 top。列归属**永不改变**。
 *   · **pinterest/gestalt**（`Masonry/dynamicHeightsUtils.ts` 的 `recalcHeights`）：
 *     改高的那张卡 top/left/width 原地不动，只把「在它下方 且 横向与受影响区域
 *     有交叠」的卡整体平移 `heightDelta`；受影响区域随着往下走逐步变宽——这正是
 *     跨列所需要的横向扩散，人家早就写了。同样**不重选列**。
 *   · **react-photo-album**（`layouts/masonry/masonry.ts`）：连选最矮列都带 1px 死区，
 *     注释原话是「两列高度相同时浮点误差会让图片在重渲染之间**在列之间跳来跳去**」。
 *
 * 三家的共同点很清楚：**测量结果可以变，落位决策不能变。**
 *
 * ### 现在的写法：保序重排（reflow）
 *
 * `place()` 只在一个格子**第一次**落位时调用，它决定 `column`/`span` 并记进
 * `order`。`update()` 改走 `reflow()`：按**当初的落位顺序**、用**当初记下的
 * column/span**，拿最新高度把 top 重新算一遍。
 *
 * 好处是三条一起拿到：
 *   ① 不重叠 —— 与 `place` 同一个不变式（top 取所占各列的最大列高），可数学判定；
 *   ② 不横跳 —— 列归属是 `place` 时定死的，update 碰不到；
 *   ③ 比 gestalt 的增量平移更强 —— 它是「按 delta 平移」，收缩时可能把卡拉到
 *      旁边列的卡上面；这里是重算，任何高度变化后都仍然满足①。
 *
 * 代价还是 O(n·span)，跟原来的全量重排同一个数量级——**这次改动没有变慢，
 * 只是不再重选列**。
 *
 * ## `resettle()`：开场**只**重选一次列（2026-08-09 加）
 *
 * ### 症状
 *
 * 组件库区块墙 1920 视口下 5 列 30 张卡，实测各列末端
 * `[4246,4246,3418,3418,1792]`——第 4 列停在 1792，其余摞到 4246，填充率 75.0%。
 * 起始列分布是 `[7,0,13,1,9]`：**第 1 列和第 3 列几乎从不作为跨列卡的起点**，
 * 5 列实际退化成 `{0,1} / {2,3} / {4}` 三条轨道，落单的第 4 列只吃得到窄卡。
 *
 * ### 原因不是 `bestSpanStart` 选错，是**喂给它的高度是错的**
 *
 * 拿实测的 30 组 `(span, 最终高度)` 离线跑同一条规则：墙高 3695、填充 **86.2%**、
 * 各列 `[3695,3695,2141,3668,3668]`。规则本身没问题，浏览器里差出 551px，
 * 差在决策时读到的列高不是这一版布局的高度：
 *
 *   · `seed()` 在定位器重建时会**照喂过期列宽下量的高度**（那是它有意为之的，
 *     理由见 SpanMasonry「这张缓存永远不整张清空」——它只负责维持连续前缀）；
 *   · 页面开场容器宽度会变（侧边栏/滚动条落定），于是重建一次；
 *   · 重建后 `place()` 用**旧列宽的高度**把列全选定了，`update()` 随后只走
 *     `reflow()`——按定义**不重选列**，几何被纠正，列的错误却永久留下。
 *
 * 同一个成因还让版面**不确定**：三次加载总高 4246 / 4388 / 4388，
 * `desktop-BatchActionBar` 有时落第 0 列有时落第 2 列——取决于纠正来得比它的
 * 落位早还是晚。
 *
 * ### 为什么是"只一次"
 *
 * 文件头那三家开源实现的共识是「测量结果可以变，落位决策不能变」，那条纪律治的是
 * **交互期**整面墙自己动。开场高度还在收敛的那几百毫秒不属于交互期——那时用户
 * 还没开始看，而决策一旦冻在错的高度上就再也回不来了。
 *
 * 所以 `resettle()` 有一道**一次性闸**（`resettled` 标志，随定位器实例存亡）：
 * 高度安静下来之后重选一次列，之后永久回到 reflow-only。换列宽/换数据集会重建
 * 定位器，闸自然重置——那本来就是该重新选列的时刻。
 */

import { createIntervalTree } from "masonic";

/** 一个格子的落位结果。比 masonic 的 PositionerItem 多了 width/span。 */
export interface SpanPositionerItem {
  top: number;
  left: number;
  height: number;
  width: number;
  /** 起始列。跨列格子记的是最左那一列。 */
  column: number;
  span: number;
}

export interface SpanPositionerOptions {
  columnCount: number;
  columnWidth: number;
  columnGutter: number;
  rowGutter: number;
  /**
   * 第 index 个格子占几列。返回值会被钳进 [1, columnCount]——
   * 窄屏只有 1 列时，「跨 2 列」必须自动退回 1 列，否则整张卡会画到容器外面。
   */
  getSpan: (index: number) => number;
}

/**
 * masonic `useMasonry`/`useResizeObserver` 依赖的那套接口。
 * 字段名不能改：`createResizeObserver` 会直接调 `positioner.update(updates)`。
 */
export interface SpanPositioner {
  columnCount: number;
  columnWidth: number;
  set: (index: number, height: number) => void;
  /**
   * 按已经定过的 column/span 落位。列宽变了要重算 left/width，但**不重选列**。
   * 滚动条出现把容器挤窄几像素时，seed+place 会整墙重选列——顶部已落位的
   * 卡换列，用户看见「滚到底，上面又重拍了」。
   */
  setPreserving: (index: number, height: number, column: number, span: number) => void;
  get: (index: number) => SpanPositionerItem | undefined;
  update: (updates: number[]) => void;
  range: (
    lo: number,
    hi: number,
    cb: (index: number, left: number, top: number) => void
  ) => void;
  size: () => number;
  /**
   * 第一个**还没落位**的下标。渲染层拿它当「从哪儿开始量下一批」。
   *
   * 为什么不用 `size()`：`size()` 是"落了几格"，只有在落位下标恰好是 `[0, size())`
   * 这段连续前缀时两者才相等。2026-08-09 亲手把这个前提破坏过一次（ref 回调里
   * 给落位加了个 `h > 0` 的前置条件，量到 0 的那一格被跳过），结果是**同一个 key
   * 同时出现在"已定位"和"隐藏待量"两处，React 留下孤儿节点，满屏摞卡**。
   *
   * 与其在那行上写注释叮嘱"别加条件"，不如让渲染层问一个它真正想知道的问题。
   */
  firstUnplaced: () => number;
  estimateHeight: (itemCount: number, defaultItemHeight: number) => number;
  shortestColumn: () => number;
  all: () => SpanPositionerItem[];
  /**
   * 每次高度**真的变了**就 +1。渲染层拿它当"墙还在动"的信号来给沉降计时续期。
   * 位置变化不计——`resettle()` 自己不会把它推高，所以不会自激。
   */
  revision: () => number;
  /**
   * 用当前高度重选一次列。**整个定位器生命周期内只生效一次**（理由见文件头）。
   * 返回是否真的重排了，false 表示闸已落或没有可重排的格子。
   */
  resettle: () => boolean;
}

/**
 * 跨列格子的起始列：在所有长度为 span 的相邻列窗口里，**先**挑落位后 top 最低的
 * （`max(窗口内列高)` 最小），并列时**再**挑窗口内总空白 `Σ(max - h)` 最小的。
 *
 * ## 跟 gestalt 一致，而且是**撤回过一次偏离之后**才一致的
 *
 * 2026-07-31 上午我把这条规则改成了「先比落位后的 top、并列再比空白」，理由是
 * 照搬空白优先会让跨列卡自我强化地堆在最左边（跨列卡落位后把跨到的每一列设成
 * 完全相等，"最平的窗口"从此永远是这一对）。当天下午被线上截图推翻，撤回。
 *
 * ### 我当时错在哪 —— 用合成数据下的结论去覆盖了人家在真实数据上的选择
 *
 * 那个「全堆 left=0」是拿**随机高度 100~600px 的合成探针**测出来的。真实数据
 * 里卡片高度近似恒等（桌面单列 173、跨列 356、手机 667），根本不会形成那种
 * 自我强化。而我当时选的评价指标是「墙高 + 列底参差」，**没有把「洞」单独量**
 * ——洞正是空白优先在治的东西，指标里没有它，自然就选错了。
 *
 * ### 线上真实数据的复核（20 个应用的 device/page_count，5 列）
 *
 *   规模    空白优先 洞数/洞总高      top 优先 洞数/洞总高    参差(ws vs top)
 *    20        0 / 0                  2 / 378              555 vs 494
 *    40        1 / 61                 4 / 628              616 vs 500
 *    60        1 / 61                 5 / 811              781 vs 604
 *   100        1 / 61                 9 / 1238            1513 vs 512
 *
 * top 优先每个规模都多出一个数量级的洞；换来的只是墙**底**参差小一些。
 * 洞在视野中央、永远不会被填上；参差在最底下，且无限流往下加载会自己补平。
 * 这笔交易是亏的——20 个应用时那两个 189px 的洞（各正好空掉一个卡位）在
 * 线上截图里一眼就能看见。
 *
 * 教训记在这儿：**拿合成数据推翻成熟开源项目的既有选择之前，先确认自己的
 * 评价指标覆盖了人家那条规则在治的问题。**
 *
 * ### 现在的规则：**落位高度 + 制造的空白**，两者相加取最小
 *
 * 在每个长度为 span 的相邻列窗口上算两样东西：
 *
 *     max        = 落位后这张卡的 top（窗口里最高的那列）
 *     whitespace = Σ(max - h)，跨上去在矮列留下的死空间
 *
 * 取 `max + whitespace` 最小的窗口。两项都是 px，直接相加即可比较——一句话
 * 说就是「既别落太低，也别留太多洞」。
 *
 * span=1 时窗口只有一列，whitespace 恒为 0，代价退化成 `max`，也就是**最矮列**
 * ——跟 masonic/gestalt 的单列行为逐字一致，单列跨列不是两套逻辑。
 *
 * 首行不需要特例：全 0 窗口代价为 0，并列取最左。
 *
 * ### 这条规则翻过两次，两次都是被实测推翻的，别再翻回去
 *
 * **第一次（2026-07-31）**：原本"先比 top"，被线上截图推翻——跨列卡按 top 择位
 * 会在矮列留下整整一个卡位（189px）的洞。于是改成"先比空白"。
 *
 * **第二次（2026-08-08）**：纯空白优先在组件库区块墙上翻车，而且是**必然翻车**
 * ——它完全不看绝对高度：
 *
 *     一张跨列卡落下去，会把它盖住的两列设成**完全相等**
 *       → 那一对窗口的空白恒为 0
 *       → 下一张跨列卡还挑它（0 比任何正数都小）
 *       → 又设成相等 …… 正反馈
 *
 * 实测：5 列布局，10 张跨列卡**全部** left=0，第 0/1 列摞到 4153px，
 * 第 2/3/4 列停在 500px 就再没东西了。用户截图报的「卡片展示算法是不是有
 * 问题」就是这个。
 *
 * 相加之后两次的教训都保住：`[0,100,110,20]` 仍然选 index 1（不留 100px 的洞），
 * `[4000,4000,500,400,300]` 会选 index 3（不再往最高的那对上摞）。
 *
 * 当时那条回归用例（「跨列卡不会全部堆在最左边」）是**假绿**的：它模拟的每张
 * 卡高度都一样，各列自然就散开了。真实高度从 102 到 846，正反馈才咬合。
 * 用例已改成用实测高度。
 *
 * 导出是为了单测能直接打这个规则，不用绕整个定位器。
 */
export function bestSpanStart(heights: number[], span: number): number {
  const last = heights.length - span;
  let bestIndex = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= last; i++) {
    let max = heights[i];
    for (let j = i + 1; j < i + span; j++) if (heights[j] > max) max = heights[j];
    let whitespace = 0;
    for (let j = i; j < i + span; j++) whitespace += max - heights[j];
    // 代价 = 落位高度 + 制造的空白（同一单位，都是 px）
    const cost = max + whitespace;
    if (cost < bestCost) {
      bestCost = cost;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function createSpanPositioner(opts: SpanPositionerOptions): SpanPositioner {
  const { columnCount, columnWidth, columnGutter, rowGutter, getSpan } = opts;
  const columnWidthAndGutter = columnWidth + columnGutter;

  let intervalTree = createIntervalTree();
  let columnHeights: number[] = new Array(columnCount).fill(0);
  const items: SpanPositionerItem[] = [];
  /** 量到的原始高度，按 index 存。reflow 的唯一输入。 */
  const measured: number[] = [];
  /** 落位顺序。reflow 按这个顺序重放，**不重新选列**——理由见文件头。 */
  let order: number[] = [];
  /** 高度改动次数。渲染层用它判断"墙还在动没有"。 */
  let revision = 0;
  /** 一次性闸：`resettle()` 只准放行一次。 */
  let resettled = false;

  /** 把第 index 个格子按当前列高落位。**只在第一次落位时调用。** */
  function place(index: number, height: number) {
    const span = Math.max(1, Math.min(columnCount, Math.floor(getSpan(index)) || 1));
    // 单列走同一条规则——bestSpanStart 在 span=1 时退化成"最矮列"，见其文档。
    const column = bestSpanStart(columnHeights, span);
    settle(index, height, column, span);
    order.push(index);
  }

  /**
   * 把第 index 个格子按**已定的** column/span 放在当前列高之上。
   * place 与 reflow 共用同一段几何，这样"不重叠"这条不变式只有一个来源。
   */
  function settle(index: number, height: number, column: number, span: number) {
    // top 取所占各列的最高那列：取最矮会压在旁边已有的卡上面。
    let top = columnHeights[column];
    for (let j = column + 1; j < column + span; j++) {
      if (columnHeights[j] > top) top = columnHeights[j];
    }
    const next = top + height + rowGutter;
    for (let j = column; j < column + span; j++) columnHeights[j] = next;
    items[index] = {
      top,
      left: column * columnWidthAndGutter,
      height,
      width: columnWidth * span + columnGutter * (span - 1),
      column,
      span,
    };
    intervalTree.insert(top, top + height, index);
  }

  /** 保序重排：列归属沿用当初的，只用最新高度把 top 重算一遍。 */
  function reflow() {
    intervalTree = createIntervalTree();
    columnHeights = new Array(columnCount).fill(0);
    for (const index of order) {
      const prev = items[index];
      if (prev === undefined) continue;
      settle(index, measured[index] ?? prev.height, prev.column, prev.span);
    }
  }

  return {
    columnCount,
    columnWidth,
    set(index, height = 0) {
      if (measured[index] !== height) revision++;
      measured[index] = height;
      // 同一个下标被 set 两次时按改高处理：再 place 一次会往 order 里塞重复项，
      // reflow 就会把同一张卡放两遍（第二遍落在自己下面）——正是"偶发重叠"。
      if (items[index] !== undefined) {
        if (Math.floor(items[index].height) === Math.floor(height)) return;
        reflow();
        return;
      }
      place(index, height);
    },
    setPreserving(index, height, column, span) {
      const clampedSpan = Math.max(1, Math.min(columnCount, Math.floor(span) || 1));
      const clampedCol = Math.max(0, Math.min(columnCount - clampedSpan, Math.floor(column) || 0));
      if (measured[index] !== height) revision++;
      measured[index] = height;
      if (items[index] !== undefined) {
        items[index] = { ...items[index], column: clampedCol, span: clampedSpan };
        reflow();
        return;
      }
      settle(index, height, clampedCol, clampedSpan);
      order.push(index);
    },
    get: index => items[index],
    update(updates) {
      // updates 是 [index, height, index, height, ...] 的扁平数组（masonic 的约定）。
      let changed = false;
      for (let i = 0; i < updates.length - 1; i += 2) {
        const index = updates[i];
        const height = updates[i + 1];
        const item = items[index];
        if (item === undefined) continue;
        // 死区：整像素相同就不动。照 gestalt `recalcHeights` 的 Math.floor 比较——
        // 亚像素抖动（缩放比、字体回退）不该引发一次全墙重排。
        if (Math.floor(item.height) === Math.floor(height)) continue;
        measured[index] = height;
        changed = true;
      }
      if (changed) {
        revision++;
        reflow();
      }
    },
    range(lo, hi, cb) {
      intervalTree.search(lo, hi, (index: number, top: number) => {
        const item = items[index];
        if (item) cb(index, item.left, top);
      });
    },
    // 已落位的**格子数**，不是区间树里的节点数。调用方（SpanMasonry）拿它当
    // "下一个该量的下标"，所以它必须恒等于 order.length —— 用区间树的 size 顶替
    // 就要求"一格恰好一个节点"，而那是实现细节，一改就静默漏格子。
    size: () => order.length,
    firstUnplaced() {
      let i = 0;
      while (items[i] !== undefined) i++;
      return i;
    },
    estimateHeight(itemCount, defaultItemHeight) {
      const tallest = Math.max(0, ...columnHeights);
      if (itemCount === order.length) return tallest;
      return (
        tallest + Math.ceil((itemCount - order.length) / columnCount) * defaultItemHeight
      );
    },
    shortestColumn: () =>
      columnHeights.length > 1 ? Math.min(...columnHeights) : columnHeights[0] || 0,
    all: () => items,
    revision: () => revision,
    resettle() {
      if (resettled) return false;
      // 只重排**从 0 开始连续量到**的那一段。`items` 必须恒等于 `[0, size())`
      // 这个连续前缀（见 firstUnplaced 的文档：破坏它会满屏摞卡），所以碰到
      // 第一个没量到的下标就停，绝不跳过去接着排。
      let n = 0;
      while (n < items.length && items[n] !== undefined && measured[n] !== undefined) n++;
      if (n === 0) return false;
      resettled = true;

      intervalTree = createIntervalTree();
      columnHeights = new Array(columnCount).fill(0);
      order = [];
      // 只清掉要重排的那一段：后面本来就没有（连续前缀），length 截断即可。
      items.length = 0;
      for (let i = 0; i < n; i++) place(i, measured[i]);
      return true;
    },
  };
}

/**
 * 列数没变、只是列宽变了：把旧墙的 column/span 搬过去，用新几何重算 left/top。
 * 走 `set()` 会 `place()` 重选列——那就是滚动条挤窄之后顶部卡换列。
 *
 * 碰到第一个没落位的下标就停，保持连续前缀。
 */
export function copyPlacements(from: SpanPositioner, to: SpanPositioner): number {
  let n = 0;
  while (true) {
    const pos = from.get(n);
    if (pos === undefined) break;
    to.setPreserving(n, pos.height, pos.column, pos.span);
    n += 1;
  }
  return n;
}
