/**
 * 预览「正在醒」：点过就不许再点。
 *
 * ⚠ 2026-09-19 坦克大战点唤醒：`opening` 只包住那一发 POST。
 *   202 回来、状态已经是 provisioning / starting，hook 把
 *   `opening` 放下、`starting` 也清掉（STARTABLE 里没有这两态）。
 *   面上标题换成「正在准备运行环境」，按钮又变回「唤醒」，
 *   真机还能再点，连发第二声 /preview/wake。
 *
 * 锁的是「沙箱还在路上」：请求在飞、点过还没就绪、或 descriptor
 * 已经是起来的中间态。轮询 GET 不续这把锁的语义——锁看状态，
 * 不看有没有人在 poll。
 */

const STARTABLE = new Set(["stopped", "expired", "failed"]);

export const PREVIEW_COMING_UP = new Set([
  "provisioning",
  "syncing",
  "installing",
  "starting",
  "reconciling",
  "stopping",
]);

export function previewWakeLocked(input: {
  opening: boolean;
  starting: boolean;
  loading?: boolean;
  awaitingProject?: boolean;
  status?: string | null;
}): boolean {
  if (
    input.opening ||
    input.starting ||
    Boolean(input.loading) ||
    Boolean(input.awaitingProject)
  ) {
    return true;
  }
  return Boolean(input.status && PREVIEW_COMING_UP.has(input.status));
}

/** 点过唤醒之后，沙箱还在路上就继续锁；回到能再点的态才放。 */
export function previewStillStarting(
  started: boolean,
  status?: string | null
): boolean {
  if (!started) return false;
  if (!status) return true;
  if (status === "ready" || STARTABLE.has(status)) return false;
  return true;
}
