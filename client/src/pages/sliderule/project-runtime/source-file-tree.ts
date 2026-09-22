/**
 * 把源码清单收成一棵目录树。
 *
 * 2026-09-15 对照 Manus：右侧「源码」是整份工程——左边目录、右边文件。
 * 我们这边 `GET /source` 已经给了全部文件，面板却把路径摊成一条
 * `src/pages/UsersPage.tsx` 窄列表，看起来像最近改过的几份，不像项目。
 *
 * 树只从清单里的 path 长出来。没有的目录不编，清单外的文件不补。
 */
import { validSourcePath } from "./preview-selection-bridge";

export type SourceTreeFile = { kind: "file"; name: string; path: string };
export type SourceTreeDir = {
  kind: "dir";
  name: string;
  path: string;
  children: SourceTreeNode[];
};
export type SourceTreeNode = SourceTreeFile | SourceTreeDir;

type Bucket = { files: Map<string, string>; dirs: Map<string, Bucket> };

function emptyBucket(): Bucket {
  return { files: new Map(), dirs: new Map() };
}

export function sourceFileTree(paths: readonly string[]): SourceTreeNode[] {
  const root = emptyBucket();
  for (const raw of paths || []) {
    const path = String(raw || "").trim();
    if (!validSourcePath(path)) continue;
    const parts = path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i];
      const next = node.dirs.get(name) ?? emptyBucket();
      node.dirs.set(name, next);
      node = next;
    }
    node.files.set(parts[parts.length - 1], path);
  }
  return finish(root, "");
}

function finish(node: Bucket, prefix: string): SourceTreeNode[] {
  const dirs = [...node.dirs.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, child]) => {
      const path = prefix ? `${prefix}/${name}` : name;
      return {
        kind: "dir" as const,
        name,
        path,
        children: finish(child, path),
      };
    });
  const files = [...node.files.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, path]) => ({ kind: "file" as const, name, path }));
  return [...dirs, ...files];
}

/** 树上每一份文件的 path，用来钉「清单有的都在，清单外的没有」。 */
export function sourceTreeFilePaths(nodes: SourceTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: SourceTreeNode[]) => {
    for (const node of list) {
      if (node.kind === "file") out.push(node.path);
      else walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function sourceTreeDirPaths(nodes: SourceTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: SourceTreeNode[]) => {
    for (const node of list) {
      if (node.kind === "dir") {
        out.push(node.path);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

export type SourceTreeIconKind =
  | "folder"
  | "folder-open"
  | "code"
  | "html"
  | "css"
  | "json"
  | "text"
  | "image"
  | "file";

/**
 * 树上那颗图标。只认名字和开合，不按路径关键词猜（`game.tsx` 仍是 code）。
 *
 * 无扩展 / `.env` 这种点在开头的，一律 file——别把隐藏文件当成类型。
 */
export function sourceTreeIconKind(
  name: string,
  kind: "file" | "dir",
  open = false
): SourceTreeIconKind {
  if (kind === "dir") return open ? "folder-open" : "folder";
  const base = String(name || "").trim();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "file";
  const ext = base.slice(dot + 1).toLowerCase();
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") return "code";
  if (ext === "html") return "html";
  if (ext === "css") return "css";
  if (ext === "json") return "json";
  if (ext === "md") return "text";
  if (
    ext === "png" ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "svg" ||
    ext === "webp"
  ) {
    return "image";
  }
  return "file";
}
