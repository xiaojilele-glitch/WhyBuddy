/**
 * 组件库的**收藏与最近使用**（2026-08-08）。
 *
 * 用户的原话：「全部 / 最近使用 / 收藏……对几百个组件以后非常有必要」。
 * 目录已经 217 条，这话不是"以后"，是现在。
 *
 * ## 为什么存 localStorage 而不是后端
 *
 * 这两样是**个人的取用习惯**，不是应用数据——换台机器重新收藏一遍不算丢
 * 东西。走后端要建表、要接口、要登录态，而收益只是跨设备同步。等真有人抱怨
 * 跨设备再说。
 *
 * ## id 的形状
 *
 * `block:DataTable` / `base:ProFormSelect`。两档可能重名（区块叫 SearchBox，
 * 基础组件里也可以有），不带前缀会串档。跟 component-search 的 SearchDoc.id
 * 是同一套，两边共用一个 id 空间是有意的——搜索结果直接就能收藏。
 */

const FAV_KEY = "sliderule.componentLibrary.favorites";
const RECENT_KEY = "sliderule.componentLibrary.recent";

/** 最近使用留多少条。太多就不叫"最近"了，一屏看不完等于没有。 */
export const RECENT_LIMIT = 24;

/**
 * 读一份字符串数组。
 *
 * localStorage 在隐私模式/被禁用时**读写都会抛**，不是返回 null——所以整个
 * 模块每个出入口都得包住。收藏功能挂掉不该把组件库整页带崩。
 */
function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // 写不进去就算了 —— 收藏丢了是小事，抛出去把页面搞崩是大事
  }
}

export function readFavorites(): string[] {
  return readList(FAV_KEY);
}

/** 收藏/取消收藏，返回新的全量列表（调用方拿它直接 setState）。 */
export function toggleFavorite(id: string): string[] {
  const cur = readFavorites();
  const next = cur.includes(id) ? cur.filter(x => x !== id) : [id, ...cur];
  writeList(FAV_KEY, next);
  return next;
}

export function readRecent(): string[] {
  return readList(RECENT_KEY);
}

/**
 * 记一次使用，返回新列表。
 *
 * 语义是"最近**用过**"，所以同一个再用一次要**冒到最前面**而不是留在原位，
 * 也不能出现两条。先剔重再插队。
 */
export function markRecent(id: string): string[] {
  const next = [id, ...readRecent().filter(x => x !== id)].slice(0, RECENT_LIMIT);
  writeList(RECENT_KEY, next);
  return next;
}

/** 清空最近使用（收藏不给一键清 —— 那是用户攒出来的，误触代价太大）。 */
export function clearRecent(): string[] {
  writeList(RECENT_KEY, []);
  return [];
}
