/**
 * 决定卡片墙上哪些卡跨两列。
 *
 * ## 为什么需要它
 *
 * 卡片高度是 `列宽 / 设备宽高比` 算出来的，而设备只有桌面/平板/手机三档，线上
 * 真实分布是桌面 12、手机 2、空串 5（空串按桌面算）——89% 的卡走同一个比例。
 * 1920px 下实测 12 张卡里 11 张高度**恰好都是 234px**。瀑布流的输入是常数，
 * 输出就只能是整齐网格，这跟用哪个瀑布流库无关。
 *
 * 花瓣/Pinterest 的错落来自图片宽高比本身千差万别，那个前提我们没有。Pinterest
 * 自己在 gestalt 里给出的答案是**跨列**（`Masonry/multiColumnLayout.ts` 的
 * `ColumnSpanConfig`），这里照这个思路走。
 *
 * ## 凭什么判"这张该宽"——必须是真实信息，不能是随机
 *
 * 随机跨列能立刻做出错落感，但那是**假信息**：用户会以为宽卡代表什么，其实什么
 * 都不代表，而且每次刷新还会变。这里的规则是两条都能讲清楚的事实：
 *
 *   ① 只有**桌面档**有资格。宽版应用本来就是横向内容（1440×810），给两列是让它
 *      显示得更完整——跟花瓣上横构图的图片占两列是同一个道理。手机档是 405×720（9:16）
 *      的竖比例，跨两列会算出 1400px 以上的巨条，把整面墙拉垮。
 *   ② 在有资格的卡里按**页面数**降序取前 ratio。页面多 = 应用做得更完整，值得
 *      更大的展位。页面数在列表接口 (`AppStoreSummary.page_count`) 里就有，
 *      同步可得——不用等详情加载，所以不会出现"加载完详情整面墙重排一次"。
 *
 * ratio 默认 0.25 是量出来的：在真实高度分布（22 张卡、桌面 234px 为主、5 列）
 * 上逐档试过，每 3 张跨 1 张时墙高 1994、列底参差 494；每 4 张跨 1 张时墙高 1750、
 * 参差 250；每 5 张跨 1 张参差 244 但错落感明显变弱。1/4 是"够错落又不散"的那一档。
 *
 * ## 2026-08-03：整面墙看着又变回整齐网格了，两个原因
 *
 * 上面那套规则本身没问题，但它在真实数据上**选出来的宽卡全挤在一起**，而且**候选
 * 池比预想的小得多**。真机看到的效果就是一面平网格，跟没开跨列一样。
 *
 * ### 原因 A：宽卡按页面数取前 1/4，而墙是按最近更新排的
 *
 * 这两个序高度相关——最近几轮生成的应用页面数都是 5~6，于是"页面最多的前 1/4"
 * 差不多就是"最近更新的前 1/4"，宽卡**全部落在墙的头部**。往下滚几行之后，一张
 * 宽卡都没有，剩下几十张全是同一个 234px。
 *
 * 修法不是放弃真实信息，而是把这条规则拆成两步：
 *   · **谁有资格**当宽卡 —— 仍然由真实信息决定（桌面档 + 页面数排名靠前）；
 *   · **在哪儿放**宽卡 —— 按展示序**均匀铺开**，每 stride 张里挑一张。
 * 这样"宽 = 内容更完整"的语义一点没变（能被选中的仍然只有页面数排前面的那批），
 * 但视觉上整面墙每隔几张就有一次呼吸，而不是头部堆一坨、后面一马平川。
 *
 * ### 原因 B：`source === "app"` 把一大批卡挡在候选池外
 *
 * 会话落库（94c8ed7e）之后，墙上多了一批 source=session 的卡。旧写法要求
 * `source === "app" && summary`，这些卡直接**没有资格**——哪怕它就是一个正常的
 * 桌面应用。候选池一小，`floor(n * 0.25)` 就更小，甚至归零。
 *
 * 现在的口径跟 `aspectForDevice` 对齐：**只把明确写着 phone 的排除掉**，其余
 * （桌面/平板/空串/没有 summary）一律按桌面处理。理由是同一条——错判成桌面只是
 * 卡片偏宽，错判成手机会把宽版应用压进窄条里，糊得没法看。两处兜底方向必须一致，
 * 否则会出现"按桌面比例渲染、却没资格跨列"这种自相矛盾的卡。
 */

import type { GalleryItem } from "./AppsWorkbench";
import { isKeyPrefixAppend } from "./masonry-append";

/** 明确是这一档就没有跨列资格，理由见文件头 ①。 */
const NON_SPANNABLE_DEVICE = "phone";

/**
 * 有没有跨列资格。
 *
 * 口径与 `aspectForDevice` 对齐：只排除**明确写着 phone** 的，其余一律按桌面。
 * 空串（preferredDevice 未声明的老记录）、没有 summary 的会话卡都算在内——
 * 见文件头「原因 B」。
 */
function isSpannableDevice(item: GalleryItem): boolean {
  const device = (item.summary?.device || "").trim().toLowerCase();
  return device !== NON_SPANNABLE_DEVICE;
}

/**
 * 算出该跨两列的卡片 key 集合。
 *
 * 纯函数、结果只由入参决定：同一份列表两次调用给同一个集合，刷新页面不会换一批。
 * **不含任何随机数**——错落感来自"均匀铺开"，不是来自掷骰子（理由见文件头）。
 *
 * @param items 当前要铺墙的卡片（已筛选、已排序的那一份，**顺序就是展示序**）
 * @param ratio 跨列卡占**有资格卡**的比例，默认 0.25
 */
export function computeSpanKeys(items: GalleryItem[], ratio = 0.25): Set<string> {
  // 保留展示序：下面"均匀铺开"这一步依赖它，用 filter 而不是先排序。
  const eligible = items.filter(isSpannableDevice);
  if (eligible.length === 0) return new Set();
  const take = Math.floor(eligible.length * ratio);
  if (take === 0) return new Set();

  // 把展示序切成 take 段，**每段里选内容最完整的那一张**给两列。
  //
  // 这个写法同时满足两件此前互相打架的事：
  //   · 铺开 —— 一段一张是构造出来的，不是碰运气，整面墙从头到尾每隔几张就有
  //     一次呼吸。
  //   · 仍然是真实信息 —— 段内比的还是页面数，语义只是从"全墙最完整的前 1/4"
  //     收窄成"**这一片里**最完整的那张"。宽卡依然代表内容更完整，只是尺度变
  //     成了局部。
  //
  // 为什么不能保留"全墙排名"那版：墙按最近更新排，而最近几轮生成的应用页面数
  // 都是 5~6，两个序高度相关——"页面最多的前 1/4"几乎就是"最近更新的前 1/4"，
  // 宽卡全堆在头部。相关性拉满时（页面数随位置严格递减）**全墙排名和均匀铺开
  // 在数学上就不可兼得**，必须有一个让步。让步的是尺度，不是"凭真实信息"这条
  // 原则本身——换成随机才是把原则丢了。
  const picked = new Set<string>();
  const total = eligible.length;
  for (let slot = 0; slot < take; slot += 1) {
    // 用乘法算边界而不是累加 stride：整除不尽时余数被均摊到各段，
    // 不会全堆在最后一段（24 张取 5 段：5/5/5/5/4，而不是 4/4/4/4/8）。
    const start = Math.floor((slot * total) / take);
    const stop = Math.floor(((slot + 1) * total) / take);
    let best: GalleryItem | null = null;
    for (let i = start; i < stop; i += 1) {
      const candidate = eligible[i];
      const cur = candidate.summary?.page_count ?? 0;
      const bestCount = best?.summary?.page_count ?? -1;
      // 页面数相同就按 key 破平——不加这一条，同一份数据在不同引擎下可能
      // 给出不同的跨列集合（Array 遍历顺序是稳的，但"谁算更好"必须有定义）。
      if (cur > bestCount || (cur === bestCount && best !== null && candidate.key < best.key)) {
        best = candidate;
      }
    }
    if (best) picked.add(best.key);
  }
  return picked;
}

/**
 * 滚动分页追加时的跨列集合：已经拿了两列的卡继续拿，只在**新尾巴**上再跑
 * 一遍分段规则。
 *
 * `computeSpanKeys` 的分段边界是 `floor(n * ratio)`，n 一变，第一页里谁该宽
 * 就会跟着变——这就是下一页到来时整墙「重新拍」的另一半。gestalt 把「这张
 * 是不是两列」当成卡片自己的属性，不按当前列表长度重算；我们没有把 span
 * 写进数据，就用「旧决策冻结 + 新页局部再算」对齐同一条纪律。
 *
 * 换筛选/换排序（不是前缀追加）仍走全量 `computeSpanKeys`，该重拍就重拍。
 */
export function appendStableSpanKeys(
  prevSpans: ReadonlySet<string>,
  prevKeys: readonly string[],
  nextItems: GalleryItem[],
  ratio = 0.25,
): Set<string> {
  const nextKeys = nextItems.map(item => item.key);
  if (!isKeyPrefixAppend(prevKeys, nextKeys)) {
    return computeSpanKeys(nextItems, ratio);
  }
  const tail = nextItems.slice(prevKeys.length);
  const next = new Set(prevSpans);
  for (const key of computeSpanKeys(tail, ratio)) next.add(key);
  return next;
}

/**
 * 卡片墙实际用的 span：列数不够时必须退回 1。
 *
 * 单列（窄屏/手机档浏览器）下"跨 2 列"没有意义，定位器虽然也会钳，但这里先钳掉
 * 能让隐藏量高那一批直接按正确宽度渲染，少一次重排。
 */
export function spanForColumnCount(isSpan: boolean, columnCount: number): number {
  if (!isSpan) return 1;
  return columnCount >= 3 ? 2 : 1;
}
