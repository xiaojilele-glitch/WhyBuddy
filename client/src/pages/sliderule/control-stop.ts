/**
 * 「为什么停」那一行左栏文案。
 *
 * ## 病（2026-09-14 复审）
 *
 * 服务端是**特意**把 `limit` / `used` 挂在停止信封上的，`rehearsal_control`
 * 里那段注释写得很直白：
 *
 *   ⚠ limit/used 不是装饰：光说「打转了」没法行动，说「同一件 inspect_model
 *     连了 4 轮、紧档上限就是 4」才知道该不该调这个数。
 *
 * 而前端收到之后只做了一件事——`lastControlStopRef.current = stop`。全仓
 * 三处引用：声明、清空、赋值，**一处读都没有**。现有判据
 * `control-turn-stream.test.ts` 还钉了一条 `toContain("lastControlStopRef.current = stop")`，
 * 正向有、反向没有——CLAUDE.md §3 那句「名单里有名字 ≠ 埋点在」的活标本。
 *
 * 于是用户只看得到罐头那句「我在同一步上打转了」，看不到连了几次、上限多少。
 * 两道打转闸（整轮签名上限 4 / 同一次调用同一份结果上限 5）在界面上更是
 * 完全分不开——**唯一能分开它们的就是这个 limit**。
 *
 * ## 只补「量」，不重写「话」
 *
 * ⚠ 那句人话是服务端 `stop_text()` 生成的，已经在 `text` 里了。这里**不再
 *   翻译一遍停因**（那就成了同一个 enum 两处中文映射，§4 那张表上的老毛病）。
 *   这里只加服务端量出来、前端一直没显示的那两个数，外加它们的单位。
 *
 * 所以 `_UNIT` 是**量纲**不是文案：它回答「4/4 的 4 是什么的 4」。
 */
import type { ControlStop, ControlStopReason } from "@/lib/sliderule-marathon-driver";

/** limit/used 的量纲。不是停因的中文名——那句话服务端已经给了。 */
const _UNIT: Record<ControlStopReason, string> = {
  wall_clock: "秒",
  token_budget: "token",
  tool_rounds: "轮",
  stationarity: "次",
  llm_unavailable: "",
  unknown: "",
};

/** 谁把它停下来的。决定用户「再试一次有没有用」。 */
const _BY: Record<string, string> = {
  runtime: "我们的闸",
  provider: "模型侧",
};

/**
 * 停下来那一行的完整文案：服务端的话 + 服务端量到的数。
 *
 * 没有 limit/used 就**原样返回**——`llm_unavailable` 的 text 本身已经带了
 * 「ReadTimeout after 45.2s (budget 45s)」，再缀一个空括号只是噪声。
 */
export function controlStopLine(text: string, stop: ControlStop | null | undefined): string {
  const head = String(text ?? "").trim();
  if (!stop) return head;
  const { limit, used } = stop;
  if (typeof limit !== "number" || typeof used !== "number") return head;
  const unit = _UNIT[stop.stopReason] ?? "";
  const by = _BY[String(stop.stoppedBy || "")] || "";
  const measured = `${used}/${limit}${unit}`;
  return by ? `${head}（${measured}，${by}）` : `${head}（${measured}）`;
}
