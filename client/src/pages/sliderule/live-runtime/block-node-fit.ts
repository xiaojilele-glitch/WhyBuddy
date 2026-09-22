/**
 * 刀 2 的降级阶梯：块节点太多时，哪些还真渲染、哪些退成静态卡（2026-08-27）。
 *
 * ## 为什么需要它
 *
 * 用户裁决块节点走**真渲染**（不是静态截图）。而块片段**没法单独渲染**——
 * 它的 Tailwind 类来自页面注入的样式表，布局还依赖父级 flex/grid，抠出来
 * 就变形。所以每个块节点实际是「整页 iframe 裁到那一块的矩形」。
 *
 * 代价是 iframe 数量：真机基线 4 页 15 块，加上 4 张整页画板就是 19 个
 * iframe；用户截图里那套 6 页更多。全挂上去会卡死。
 *
 * ## 抄的是谁
 *
 * grok-build `crates/common/xai-grok-compaction/src/intra_compaction/fit.rs`
 * （本地 clone，commit 9684fa3）的 ordered ladder。抄的是它的**形状**，
 * 四条一条不少：
 *
 *   1. 分档**严格有序**，头注写死 "do not reorder"
 *   2. 后一档**只在**前一档跑完仍超预算时才启用
 *   3. 效果**累加**（第 2 档不撤销第 1 档已经剔掉的）
 *   4. **不做二分**——一档一档往下走，别搞"找一个刚好的中间值"
 *
 * 还抄了第五条，那边叫 `FitPlan::rung`：结果**记录最终落在哪一档**。
 * 这条不是装饰——没有它，真机上分不清"全量真渲染"还是"已经降到全静态"，
 * 而这两种情况截图看起来可能差不多（都有卡片、都有标签）。本仓第五条纪律
 * 说判据要落在用户真正看到的东西上，`rung` 就是那个可被判据读到的事实。
 *
 * ## ⚠ 预算是 iframe 数，不是"块数"或"字符数"
 *
 * 本仓第五条踩过的坑：用字符数量页面密度，排序跟真实渲染几乎相反。这里
 * 真正稀缺的资源是**活的 iframe**（每个都是一份完整文档 + 一次 Tailwind
 * 扫描），所以预算就直接数它，不找代理指标。
 */

/**
 * 阶梯档位。**顺序即语义，不许重排**（同 fit.rs 的 `FitRung`）。
 *
 * 每一档都**含**前面所有档的效果。
 */
export const BLOCK_FIT_RUNGS = [
  /** 全都真渲染。预算够用时就停在这儿。 */
  "verbatim",
  /** 只挂视口内（含预留边）的。最便宜的一刀，跟画板的可见性剔除同一套机制。 */
  "offscreen_culled",
  /** 还超：非当前页的块退成静态卡，当前页的照旧真渲染。 */
  "inactive_pages_collapsed",
  /** 还超：只有选中的那一块真渲染。 */
  "live_only_selected",
  /**
   * 还超：全静态。一个活 iframe 都不留。
   *
   * ⚠ 预算 >= 1 时**走不到这一档**——第 3 档最多留 1 块，必然收敛。
   *   它唯一的入口是预算 <= 0，也就是"块节点整个关掉"那种配置。
   *   别把它当死码删了。
   */
  "all_static",
] as const;

export type BlockFitRung = (typeof BLOCK_FIT_RUNGS)[number];

/** 一个候选块节点，以及决定它去留的那几个事实。 */
export interface BlockNodeCandidate {
  /** `blockKey(pageId, name)`——**跨页唯一**。⚠ 不许用块名，两页会重名。 */
  key: string;
  /** 在视口内（或预留边内）。 */
  inViewport: boolean;
  /** 属于当前选中/进入的那一页。 */
  onActivePage: boolean;
  /** 就是用户选中的那一块。 */
  isSelected: boolean;
}

export interface BlockFitPlan {
  /** 真渲染的那些块的 key。其余退静态卡。 */
  live: ReadonlySet<string>;
  /**
   * 最终**启用到**哪一档——照 fit.rs 的 `FitPlan::rung` 口径。
   *
   * ⚠ 它记的是"哪一档的规则收敛了这次分配"，**不是**"结果长什么样"。
   *   一块都没选中时第 3 档会给出 0 块真渲染，档位仍如实报
   *   `live_only_selected`（第 3 档确实跑了、也确实收敛了），不报
   *   `all_static`——那等于谎称又降了一档。
   *   真机上判断"是不是降到底了"要读 `liveCount`，不是读档位名。
   */
  rung: BlockFitRung;
  liveCount: number;
  staticCount: number;
}

/**
 * 默认预算：同时活着的块 iframe 上限。
 *
 * ## ⚠ 32 是**量出来的**，不是拍的（2026-08-28）
 *
 * 用户裁决"区块要是真实的区块"——降级卡片不算数。所以预算要开到真机上常见
 * 的会话都能全量真渲染。同一份会话（5 页 24 块）两档实测：
 *
 *                     真渲染   iframe   内存    平移帧率
 *     预算 12（旧）     5/24     10     217MB    40 fps
 *     全量真渲染       24/24     29     296MB    25 fps
 *
 * 代价是实的（帧率掉四成、内存多 79MB），但 25fps 平移仍然可用，而"块是假的"
 * 是功能层面的缺失。取 32：4~7 页 × 3~7 块的真实会话都落在里面。
 *
 * ⚠ 阶梯**没有删**：它仍然是病态输入（几十页、上百块）的兜底。真到那一天
 *   宁可降级也不能让标签页崩掉——而降级是看得见的（data-block-fit-rung）。
 * ⚠ 这个数跟机器和会话规模有关，不是标定过的常量。真机上量出更好的就改，
 *   但**改之前先量**，别照感觉调。
 */
export const DEFAULT_BLOCK_IFRAME_BUDGET = 32;

/**
 * 按预算决定哪些块节点真渲染。
 *
 * ⚠ 严格有序，**不许重排**（见文件头注第 1 条）。每一档进来先问一句
 *   "还超吗"，不超就地返回——这正是 fit.rs 里每档前面那个 `if still over`。
 *
 * @param candidates 全部块节点候选
 * @param budget     同时活着的 iframe 上限。<= 0 直接落到全静态。
 */
export function fitBlockNodes(
  candidates: readonly BlockNodeCandidate[],
  budget: number = DEFAULT_BLOCK_IFRAME_BUDGET
): BlockFitPlan {
  const total = candidates.length;

  // 预算为 0/负：没有可谈的，直接最后一档（同 fit.rs 的 `budget == 0` 早返回）。
  if (!(budget > 0)) return plan(new Set<string>(), "all_static", total);

  // ── 0) Verbatim：全都真渲染 ──────────────────────────────────
  if (total <= budget) {
    return plan(new Set(candidates.map(c => c.key)), "verbatim", total);
  }

  // ── 1) OffscreenCulled：只留视口内的 ─────────────────────────
  let kept = candidates.filter(c => c.inViewport);
  if (kept.length <= budget) {
    return plan(new Set(kept.map(c => c.key)), "offscreen_culled", total);
  }

  // ── 2) InactivePagesCollapsed：只留当前页的 ──────────────────
  //    ⚠ 累加：这一档是在上一档**已经剔掉视口外**的基础上再筛。
  kept = kept.filter(c => c.onActivePage);
  if (kept.length <= budget) {
    return plan(
      new Set(kept.map(c => c.key)),
      "inactive_pages_collapsed",
      total
    );
  }

  // ── 3) LiveOnlySelected：只留选中的那一块 ────────────────────
  kept = kept.filter(c => c.isSelected);
  if (kept.length <= budget) {
    return plan(new Set(kept.map(c => c.key)), "live_only_selected", total);
  }

  // ── 4) AllStatic：兜底 ───────────────────────────────────────
  return plan(new Set<string>(), "all_static", total);
}

function plan(
  live: Set<string>,
  rung: BlockFitRung,
  total: number
): BlockFitPlan {
  return {
    live,
    rung,
    liveCount: live.size,
    staticCount: total - live.size,
  };
}

/** 这一档相对另一档是不是更靠后（降得更狠）。判据和日志用。 */
export function rungIndex(rung: BlockFitRung): number {
  return BLOCK_FIT_RUNGS.indexOf(rung);
}
