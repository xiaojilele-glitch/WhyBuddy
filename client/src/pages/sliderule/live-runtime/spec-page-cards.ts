/**
 * spec-page-cards — 直播期间那批页面卡片的认卡规则。
 *
 * 推演过程中 `spec_page` 会把**同样几页推三遍**：第 3 步素颜（bound=false）→
 * 3.5 外壳统一后重发（仍 false）→ 6.5 打完 `data-*` 孔重发（true）。所以
 * 收到一页不能一味 push，得先认认这是不是已经有的那张卡。
 *
 * ## 为什么这两个函数必须住在一起
 *
 * 认卡靠 `pageId`。而服务端第 4.5 步**会改 pageId**——把草稿 id 换成模型铸的
 * 语义 id（`p1` → `seat_selection`）。于是"按 pageId 认卡"这个前提会在半路
 * 失效一次，而 `upsert` 自己看不出来：它只会发现"这个 id 没见过"，然后老老
 * 实实追加。
 *
 * 真机 sr-20260906111901（自习室占座）的后果：
 *
 *     65~110s   spec_page × 6   p3 p1 p2 p6 p5 p4       bound=false
 *     110.4s    spec_page × 6   同样六个 p*              bound=false
 *     225.3s    spec_page × 6   seat_hogging_report …    bound=true
 *     ──────────────────────────────────────────────────────────────
 *     结果：画布 12 张卡对应 6 个页面
 *
 * 前 6 张永久孤儿：素颜、未打孔、点不动。左栏「🖼 界面已出」同样出了 12 条。
 *
 * 所以 `upsert` 和 `rename` 是**同一条规则的两半**，分开放迟早只改一半——
 * 那正是本仓 §4 反复记的那个形状（2026-09-05 芯片重复就是同一个坑的另一次
 * 上演：页面覆盖了、芯片却还在追加）。
 *
 * ## 抄的标准答案
 *
 * grok-build `crates/codegen/xai-codebase-graph/src/types/file_event.rs`：
 *
 *     /// A file was renamed/moved.
 *     Renamed { from: PathBuf, to: PathBuf },
 *
 *     fn requires_reparse(&self) -> bool {
 *         FileEvent::Renamed { .. } => false,   // Only path update needed
 *     }
 *
 * 配套 `graph.rs:939` 的 `rename_file(&mut self, from: &Path, to: &Path)`
 * ——"update paths without reparsing"。改名是一等事件、自带两头，消费方
 * **只换键**。这里逐字同一个语义：卡片的 HTML 一个字都不用重取。
 */

/** 认卡只需要 pageId；其余字段随调用方（hook 里那个 useState 的元素类型）。 */
export interface HasPageId {
  pageId: string;
}

/**
 * 同一页第二次到达 → 覆盖；没见过的 → 追加。
 *
 * ⚠ 覆盖而不是 push：第 6.5 步打完孔那份才是接上了数据的那份，两份并存的话
 *   右侧会出现两个同名页，而用户点的多半是先来的那个空壳。
 */
export function upsertSpecPageCard<T extends HasPageId>(
  prev: readonly T[],
  page: T
): T[] {
  const i = prev.findIndex(p => p.pageId === page.pageId);
  if (i < 0) return [...prev, page];
  const next = prev.slice();
  next[i] = page;
  return next;
}

/**
 * 改名：把 `from` 那张卡的键换成 `to`，**内容不动**。
 *
 * 返回值在"没有这张卡"时是**原数组引用**，调用方可据此跳过重渲染
 * （同 page-panel-dedupe.dropLegacyPanelsCoveredByBlocks 的约定）。
 *
 * ⚠ 新键已经有卡了怎么办：丢掉旧那张。会走到这一支的两种情况——
 *   ① 改名事件被重放（续播、断线重连后从 `since=0` 重放）；
 *   ② 两个旧 id 指到同一个新 id（服务端 rekey 表允许，`merge_page_id_aliases`
 *      的规则是"冲突时本轮赢"）。
 *   两种都不该留下两张同名卡。
 */
export function renameSpecPageCard<T extends HasPageId>(
  prev: readonly T[],
  from: string,
  to: string
): T[] {
  // 两头缺一头、或者改成自己，都不是改名。原样返回，别惊动渲染。
  if (!from || !to || from === to) return prev as T[];
  const i = prev.findIndex(p => p.pageId === from);
  if (i < 0) return prev as T[];
  if (prev.some(p => p.pageId === to)) return prev.filter((_, k) => k !== i);
  const next = prev.slice();
  next[i] = { ...next[i], pageId: to };
  return next;
}

/**
 * 左栏「🖼 界面已出」那个已播报集合跟着改键。
 *
 * ⚠ 不跟着改的后果不是"少一条"，是**多一条**：6.5 那批用新 id 来问
 *   `has(to)`，答 false，于是再播报一遍。2026-09-05 真机
 *   sr-20260905004750 第 3 轮已经上演过一次（五页的「界面已出」连着出现
 *   两遍，编号逐字相同）——那次是漏了覆盖分支，这次是漏了改名分支，同一个
 *   「只改一半」。
 *
 * 原地改传进来的 Set（它是本轮作用域的可变集合，调用方就指望这个），
 * 返回是否真的改过。
 */
export function renameAnnouncedPage(
  announced: Set<string>,
  from: string,
  to: string
): boolean {
  if (!from || !to || from === to) return false;
  if (!announced.has(from)) return false;
  announced.delete(from);
  announced.add(to);
  return true;
}
