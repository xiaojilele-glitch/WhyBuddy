/**
 * spec-first 导航项的 id / 名字。
 *
 * Python `page_shell` 落库是 `{ id, name }`。前端有几处手抄成了
 * `{ pageId, label }`（应用中心测试夹具、落地截图）。只认其中一套，
 * 菜单顺序和落地页就会静默走 Object.keys——Foclip 那次导航第一项
 * 是缺页 p1，按错字段读等于没读。
 */
export function navItemId(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const row = item as { id?: unknown; pageId?: unknown };
  return String(row.id || row.pageId || "").trim();
}

export function navItemName(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const row = item as { name?: unknown; label?: unknown };
  return String(row.name || row.label || "").trim();
}
