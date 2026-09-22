/**
 * 落库页打没打上 data-* 孔。
 *
 * ⚠ 2026-08-18 CareBridge：bind 日志 `bound=3 failed=1`，writer 却把
 * boundPages 写成「有一页失败就整记 0」。刷新后四页徽标全说没打孔。
 *
 * 对照 Kubernetes：Deployment.status.readyReplicas 是聚合，
 * Pod.status.phase 才是这一单元的权威（kubernetes/api/core/v1）。
 * 有 pageBindStatus 就认相位，不许再用「成功数 > 0」反推。
 *
 * 旧存档没有相位：回落 boundPages + failedPages。boundPages=0 且
 * failedPages 有键时分不清「没跑」和「部分失败被记成 0」，
 * fail-closed 当没打上，等下一轮重推改写。
 */
export function pageIsBoundFromSpec(
  pageId: string,
  spec: {
    boundPages?: number;
    failedPages?: Record<string, unknown> | null;
    pageBindStatus?: Record<string, unknown> | null;
  } | null | undefined
): boolean {
  const phase = spec?.pageBindStatus?.[pageId];
  if (phase === "bound") return true;
  if (phase === "failed" || phase === "skipped") return false;
  if (!spec || Number(spec.boundPages ?? 0) <= 0) return false;
  const failed = spec.failedPages;
  if (failed && Object.prototype.hasOwnProperty.call(failed, pageId)) {
    return false;
  }
  return true;
}
