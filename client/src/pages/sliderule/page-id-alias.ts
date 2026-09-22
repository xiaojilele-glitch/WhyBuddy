/**
 * 把菜单点出来的那个 id 收敛成**交付页真正的 id**。
 *
 * ## 为什么需要它
 *
 * 页面 HTML 里的 `data-page-id` 是第 3.5 步 unify_shell 按**当时的草稿 id**
 * 烧进正文的；第 4.5 步再把页面改名成模型的语义 id，却改不到已经烧进去的
 * 那串字（`rekey_page_map` 只换 dict 的键，不碰 value 那串 HTML）。真机
 * sr-20260827191954：孔是 p1..p4、页键是 remote_rx_audit…，四个菜单项全点
 * 不动，且没有任何一处报错。
 *
 * ## 做法照 friendly_id 的 History
 *
 * `first_by_friendly_id` 是 `super || slug_table_record(id)`——**先按当前 id
 * 找，找不到才查历史表**。这里同构：别名挂在页面对象自己身上（`aliasIds`，
 * 对应它的 `has_many :slugs`），所以两个消费点手里有 pages 就够，不用穿 prop。
 *
 * ⚠ 顺序不能反：先查别名会让「新页恰好叫了某个旧 id」的那天指错人。
 * ⚠ 解析不出来返回 null，**不许兜底回落到某一页**：静默回落正是这个 bug 的
 *   表现形态，不能把它当成修复。调用方据 null 决定是不动还是喊。
 */

/**
 * 反转别名表：新 id → 它背过的那些旧 id。
 *
 * ⚠ 链式在**这一步**展平，不在 canonicalPageId 里跟随（2026-08-28 判据咬出来
 *   的）。别名只挂在**交付页**身上，而多轮改名的中间那个 id（p1→draft2→final
 *   里的 draft2）根本不是交付页、没有宿主对象可挂——链在挂载那步就断了，跟随
 *   写在解析侧永远走不到第二跳。所以这里一路跟到终点，只把终点是本页的收进来。
 *   跨轮累积的合并在 v5_capability_executor 落库那一处（本轮赢，对应
 *   friendly_id 的 `order(id: :desc)`）。
 */
export function aliasIdsFor(
  pageId: string,
  aliases: Record<string, string> | null | undefined
): string[] {
  if (!aliases) return [];
  const keys = Object.keys(aliases);
  const out: string[] = [];
  for (const oldId of keys) {
    if (oldId === pageId) continue;
    // 跟到终点：a→b、b→c 时 a 的终点是 c。带环则半路停下，不收。
    let cur = oldId;
    let terminal: string | null = null;
    const seen = new Set<string>([cur]);
    for (let hop = 0; hop < keys.length + 1; hop += 1) {
      const next: string | undefined = aliases[cur];
      if (next === undefined) {
        terminal = cur;
        break;
      }
      if (seen.has(next)) break; // 环，放弃这一条
      seen.add(next);
      cur = next;
    }
    if (terminal === pageId) out.push(oldId);
  }
  return out;
}

/** 先按当前 id，找不到才查这一页背过的旧 id。解析不出来给 null。 */
export function canonicalPageId(
  raw: string,
  pages: readonly { pageId: string; aliasIds?: readonly string[] }[]
): string | null {
  if (!raw) return null;
  if (pages.some(p => p.pageId === raw)) return raw; // friendly_id 的 `super`
  return pages.find(p => (p.aliasIds || []).includes(raw))?.pageId ?? null;
}
