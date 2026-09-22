/**
 * 「多久没动静了」——长时间静默时给用户一个可读的等待感。
 *
 * ## 为什么需要它（2026-09-14）
 *
 * 同一天把工程档的**单发** LLM 读超时从 45 秒放宽到 120 秒
 * （`ControlBudget.max_request_seconds`，真机 67d437a8：模型一轮读完六个源
 * 文件之后，带着 ~32K 字源码去想「接下来怎么改」，45 秒不够）。
 *
 * 放宽是对的，但它在页面上开了一个新坑：`SlideRule.tsx` 的状态文案是
 *
 *     liveAction?.label || latestStepText || "正在推演..."
 *
 * **跟时间无关**。模型在想的那一两分钟，页面显示的是上一个工具的标签，
 * 一动不动——跟卡死长得一模一样。改之前 45 秒就报错了，用户至少知道出了事；
 * 现在是更久的沉默。
 *
 * ## 量的是「静默」，不是「这一轮跑了多久」
 *
 * 用户要判断的是「还在动吗」，不是「一共花了多久」。所以游标在**有新动静时
 * 重置**（`marker` 变了 = 又落了一步/一句话），显示的是「距上一次动静多久」。
 * 一轮里跑了十个工具、每个两秒，不该累加成「已等待 20 秒」。
 *
 * ⚠ 门槛以下返回 null，不是返回 "0 秒"。短回合本来就该干干净净，
 *   给每一次两秒的等待都缀一个计时器只是噪声。
 */

/** 静默多久才开始显示。低于它一个字都不出。 */
export const QUIET_HINT_AFTER_SECONDS = 12;

/**
 * 静默秒数 → 给用户看的一句话；没到门槛返回 null。
 *
 * 纯函数，判据直接跑它（组件里的 setInterval 只负责把秒数喂进来）。
 */
export function quietHint(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < QUIET_HINT_AFTER_SECONDS) return null;
  const whole = Math.floor(seconds);
  if (whole < 60) return `已等待 ${whole} 秒`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `已等待 ${minutes} 分 ${rest} 秒` : `已等待 ${minutes} 分`;
}
