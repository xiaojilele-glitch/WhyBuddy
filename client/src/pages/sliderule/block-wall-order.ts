/**
 * 组件库「区块」墙的展示序 —— 把宽卡与窄卡摊匀。
 *
 * ## 为什么单独一个模块
 *
 * 照 `agent-loop/dashboard/app-wall-span.ts` 的先例：跨列/排序这类判据是纯函数、
 * 不碰 React 也不碰 antd，单独成文件才测得动。原来这两个函数长在
 * ComponentsLibraryPage.tsx 里，那个文件唯一的测试是**读源码做字符串断言**
 * ——那种写法碰上任何一次重构就误报（apps-workbench.test.ts 刚踩过），
 * 而且它压根测不到"铺开的结果对不对"这件事。
 *
 * ## 谁算宽卡
 *
 * `allowedRegions` 含一个**整行宽的区域**。整行区域在真实页面里就是通栏的，能放进去的区块
 * 天然需要横向空间（DataTable 要摆列、WorkflowTimeline 要横向展开阶段）。
 * 判据必须是真实信息，不是随机也不是"按好看程度挑"——纪律见 app-wall-span.ts。
 *
 * ## 为什么要摊匀
 *
 * app-wall-span.ts「原因 A」记过同一个坑：宽卡连着来，4 列布局里它们全挤进中间
 * 两列，第 1 列和第 4 列从第二行起空到底。
 *
 * ## 2026-08-08：上一版的形状是错的
 *
 * 上一版写的是「每 stride 张窄卡后面插一张宽卡，插不完的追加到末尾」，
 * **假设宽卡是少数**——写的时候确实是（4 张宽）。目录长到 v9 之后反过来了：
 * 范式=工作台那档 13 个区块里宽 8 / 窄 5，`stride` 算出来是 1，窄卡插完就没
 * 位置了，剩下的宽卡被 `while` 全倒在队尾：
 *
 *     窄宽窄宽窄宽窄宽窄宽宽宽宽   ← 末尾 4 张连着
 *
 * **它开始产出它当初要防的东西**，而且一条测试都没有，所以没人发现它失灵。
 *
 * 现在换成按比例并归（Bresenham 那套思路）：每一步比较两边"已铺出的比例"，
 * 谁落后先放谁。它对"多数在哪一边"是对称的，宽 8/窄 5 与宽 4/窄 12 都能摊匀。
 */

/**
 * 整行宽的区域 —— 判据来自实测，不是按名字猜。
 *
 * 2026-08-08 跑 upgradeLegacySlotsToGrid 量过（12 栅格）：窄的只有右侧那一列
 * （aside，4/12；看板日历 3/12），正文侧的 main / metrics / charts / supplement
 * 都是整行。旧判据写的是「allowedSlots 含 content」——而 content 恰好是实测
 * 里**随页型变宽**的那一个（仪表盘 12、其它 4），拿它当"宽"的标志本身就不稳。
 */
const WIDE_REGIONS = new Set(["main", "metrics", "charts", "supplement"]);

/** 只要能进任一整行区域，就按宽卡对待。 */
export function isWideBlock(block: { allowedRegions?: string[] }): boolean {
  return (block.allowedRegions ?? []).some(r => WIDE_REGIONS.has(r));
}

/**
 * 按比例把宽卡与窄卡交错铺开。
 *
 * 只动展示次序，不增不减：返回的元素与入参**逐个相同**（顺序不同）。
 * 目录里的数组次序本来就没有语义（不是按重要性也不是按字母），所以可以动；
 * 真有排序诉求的是筛选和搜索，那两条不经过这里。
 *
 * 只有一边为空时原样返回——没有"交错"可言，重排只会平白打乱目录次序。
 */
export function interleaveWide<T extends { allowedRegions?: string[] }>(
  blocks: T[]
): T[] {
  const wide = blocks.filter(isWideBlock);
  const narrow = blocks.filter(b => !isWideBlock(b));
  if (wide.length === 0 || narrow.length === 0) return blocks;

  const out: T[] = [];
  let wi = 0;
  let ni = 0;
  while (wi < wide.length || ni < narrow.length) {
    if (wi >= wide.length) out.push(narrow[ni++]);
    else if (ni >= narrow.length) out.push(wide[wi++]);
    // 取每一份的**中点**比较（+0.5），否则开头会恒定偏向某一边
    else if ((wi + 0.5) / wide.length <= (ni + 0.5) / narrow.length) out.push(wide[wi++]);
    else out.push(narrow[ni++]);
  }
  return out;
}
