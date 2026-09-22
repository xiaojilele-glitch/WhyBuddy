/**
 * 工程源码编辑器按文件名选语言。
 *
 * ⚠ 2026-09-15：右侧源码曾经是裸 `<textarea>`。真机 TicketStream 对照
 *   Manus：那边是带行号、高亮的编辑器，我们这边是一块等宽白纸。
 *   语言只从**路径**认，不猜内容——猜错会把 CSS 当成 TS 上色。
 *
 * 语言包只用 package.json 里已经声明的四份（js / json / sql / markdown），
 * 不许顺手 import 传递依赖里的 html/css：pnpm 隔离下那是未声明边。
 */
export type SourceEditorLanguage = "javascript" | "json" | "markdown" | "sql";

export function sourcePathParts(path: string): string[] {
  return String(path || "")
    .split("/")
    .map(part => part.trim())
    .filter(Boolean);
}

export function sourceEditorLanguage(path: string): SourceEditorLanguage {
  const name = sourcePathParts(path).at(-1)?.toLowerCase() ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  if (ext === ".json" || ext === ".jsonc") return "json";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".sql") return "sql";
  return "javascript";
}

export function sourceEditorUsesJsx(path: string): boolean {
  const name = sourcePathParts(path).at(-1)?.toLowerCase() ?? "";
  return (
    name.endsWith(".tsx") ||
    name.endsWith(".jsx") ||
    name.endsWith(".html") ||
    name.endsWith(".htm")
  );
}
