/**
 * 推演中补的话：排队到下一轮（纯逻辑层）。
 *
 * 用户的原话就是产品要求：「对了，登录页面不要手机号，改成工号」——
 * 正常人的理解是**我补充了一条要求**，不是"停掉重来"，更不是"这句话消失"。
 *
 * ⚠ 2026-08-27 真机实测的老形态：推演中点发送 → `queuedTurnRef.current = text`
 *   + `setInput("")`，而那个 ref **没有 state、没导出、没有任何地方渲染**。
 *   于是用户看到的是：输入框清空、整页搜不到这句话、几分钟后它自己发出去。
 *   机制是通的，人是懵的。
 *
 * ⚠ 而且旧写法是**覆盖**：连补两句，第一句被第二句悄悄顶掉。"队列"这个词
 *   本身就是承诺了会累积；覆盖是第二次无声丢失。
 *
 * ──────────────────────────────────────────────────────────────────────
 * ## 2026-09-09：合并规则照 grok 重写
 *
 * 抄的标准答案：grok-build `xai-prompt-queue/src/combine.rs`
 *
 *     //! Pure merge rules for `[ui].combine_queued_prompts`.
 *     pub struct CombineGate<'a> {
 *         pub is_plain_prompt: bool,
 *         /// Synthetic / auto-wake origins never combine.
 *         pub is_synthetic: bool,
 *         ...
 *     }
 *     pub fn combine_prefix_len(...) -> usize   // 只合并**开头连续的**一段
 *
 * 两件事跟改造前不一样：
 *
 * **① 合成品不许跟用户的话粘一起。** `useSlideRuleSession` 第 762 行往队列里
 *    塞的是系统自己生成的「假设已确认。继续画页面。」。改造前它会跟用户排队
 *    的真需求合成一条，模型收到的是「登录页改成工号\n假设已确认。继续画页面。」
 *    ——把系统的指令当成用户说的话。grok 用 `is_synthetic` 明确挡掉。
 *
 * **② 只合并开头连续的一段，不是全都揉。** 碰到第一个不能合的就停，剩下的
 *    留在队列里等下一次 flush（flush 挂在回合完成上，发出去的那一条完成时
 *    自然会再 flush 一次——跟 grok 的 drain 一个形状）。
 *
 * ⚠ 分隔符仍用 `\n`，**没跟 grok 换成 `\n\n`**。那一改会改变模型看到的正文，
 *   而"哪种分隔更好"没有真机数据支持——重构不许顺手改产品行为。
 *   要换是另一个决定，换的时候得跑真话题量。
 */

/** 队列里的一条。`synthetic` = 系统自己生成的，不是用户打的。 */
export type QueuedTurn = {
  text: string;
  /** 合成品：确认卡回执、自动唤醒之类。**永远不参与合并**（grok is_synthetic）。 */
  synthetic?: boolean;
};

/** 追加一条。空白忽略；跟上一条一模一样也忽略（用户连点两下发送）。 */
export function enqueueTurn(
  list: readonly QueuedTurn[],
  text: string,
  opts?: { synthetic?: boolean }
): QueuedTurn[] {
  const t = String(text ?? "").trim();
  if (!t) return [...list];
  const last = list.length > 0 ? list[list.length - 1] : undefined;
  if (last && last.text === t && Boolean(last.synthetic) === Boolean(opts?.synthetic)) {
    return [...list];
  }
  const row: QueuedTurn = opts?.synthetic ? { text: t, synthetic: true } : { text: t };
  return [...list, row];
}

/** 撤掉其中一条（用户改主意了）。越界返回原样，不抛。 */
export function removeQueued(
  list: readonly QueuedTurn[],
  index: number
): QueuedTurn[] {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    return [...list];
  }
  return list.filter((_, i) => i !== index);
}

/** 这一条能不能当合并段的**头**。抄 grok `can_merge_front`。 */
export function canMergeFront(row: QueuedTurn | undefined): boolean {
  return Boolean(row) && !row!.synthetic && row!.text.trim().length > 0;
}

/**
 * 队列 → 这一次真正要发的那段话 + 剩下的。
 *
 * 抄 grok `combine_prefix_len`：只合并**开头连续可合并的一段**；
 * 头本身不能合（合成品）就**只取头一条**，让它自己单独发一轮。
 *
 * ⚠ 合成一条而不是逐条各发一轮：三句补充发三轮 = 烧三次工厂，而且前两轮的
 *   产物立刻被后一轮推翻。用户补的是同一件事的三个细节。
 */
export function combinePrefix(list: readonly QueuedTurn[]): {
  text: string;
  segments: string[];
  rest: QueuedTurn[];
} {
  if (list.length === 0) return { text: "", segments: [], rest: [] };
  const front = list[0];
  // grok: `if !can_merge_front(&front) { return 1; }` —— 头不能合就只取头。
  let n = 1;
  if (canMergeFront(front)) {
    while (n < list.length && canMergeFront(list[n])) n += 1;
  }
  // ⚠ 两条分支都要走 trim + 过滤空。第一版「只取头」那条直接返回
  //   `front.text`，空白条目会被原样发出去（判据 `combinePrefix(q("  "))`
  //   逮到的）。grok 的 `join_texts` 同样先 `filter(|t| !t.is_empty())`。
  const segments = list.slice(0, n).map(r => r.text.trim()).filter(Boolean);
  return { text: segments.join("\n"), segments, rest: list.slice(n) };
}
