/**
 * 书签仍可达的旧路由页顶标。
 *
 * ⚠ 2026-08-27 M17：Autopilot / projects / tasks / workbench/legacy
 * 不许 404，也不许再混进主导航。藏 = 留 URL + 这张条，不是删路由。
 */
export function LegacyUnmaintainedBanner() {
  return (
    <div
      role="status"
      data-testid="legacy-unmaintained-banner"
      className="legacy-unmaintained-banner shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950"
    >
      legacy，不维护
    </div>
  );
}
