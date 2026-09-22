/**
 * CodeProjectionView — 代码投影视图（代码视图二期）。
 *
 * 左侧目录树（文件夹分层、可折叠）+ 右侧 CodeMirror 只读编辑器
 * （懒加载分包；未就绪/测试态回退纯 <pre>）。
 * "确定性投影（只读）"的诚实声明在每份投影文件的首行注释里
 * （顶部常驻说明条已按用户裁决移除）。
 */

import React from "react";
import { Button, Empty, Tree, message } from "antd";
import type { DataNode } from "antd/es/tree";
import {
  CopyOutlined,
  DownloadOutlined,
  FileOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import { deriveCodeProjection, type ProjectedFile } from "./code-projection";

const LazyCodeMirrorPanel = React.lazy(() => import("./CodeMirrorPanel"));

const LANGUAGE_ICON_COLOR: Record<ProjectedFile["language"], string> = {
  typescript: "#3178c6",
  tsx: "#3178c6",
  sql: "#b45309",
  json: "#ca8a04",
  markdown: "#6b7280",
};

// --- 目录树（由文件路径确定性推导，文件夹在前 · 首现顺序） -----------------

interface DirNode {
  name: string;
  path: string;
  dirs: DirNode[];
  files: ProjectedFile[];
}

function buildDirTree(files: ProjectedFile[]): DirNode {
  const root: DirNode = { name: "", path: "", dirs: [], files: [] };
  const dirMap = new Map<string, DirNode>([["", root]]);
  for (const f of files) {
    const parts = f.path.split("/");
    let parentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parentPath ? `${parentPath}/${parts[i]}` : parts[i];
      if (!dirMap.has(p)) {
        const node: DirNode = { name: parts[i], path: p, dirs: [], files: [] };
        dirMap.get(parentPath)!.dirs.push(node);
        dirMap.set(p, node);
      }
      parentPath = p;
    }
    dirMap.get(parentPath)!.files.push(f);
  }
  return root;
}

function treeDataOf(node: DirNode): DataNode[] {
  return [
    ...node.dirs.map(dir => ({
      key: `dir:${dir.path}`,
      title: <span data-testid={`code-dir-${dir.path}`}>{dir.name}</span>,
      icon: <FolderOutlined />,
      children: treeDataOf(dir),
    })),
    ...node.files.map(file => ({
      key: file.path,
      title: <span data-testid={`code-file-${file.path}`}>{file.path.split("/").pop() ?? file.path}</span>,
      icon: <FileOutlined style={{ color: LANGUAGE_ICON_COLOR[file.language] }} />,
      isLeaf: true,
    })),
  ];
}

// --- 主视图 -----------------------------------------------------------------

export function CodeProjectionView({
  model,
  appName,
}: {
  model: FiveSystemModel;
  appName?: string;
}) {
  const files = React.useMemo(
    () => deriveCodeProjection(model, appName),
    [model, appName]
  );
  const tree = React.useMemo(() => buildDirTree(files), [files]);
  const [activePath, setActivePath] = React.useState<string>(
    files[0]?.path ?? ""
  );
  const active = files.find(f => f.path === activePath) ?? files[0];

  if (files.length === 0) {
    return (
      <Empty description="本话题还没有可投影的五系统模型" />
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
      }}
      data-testid="app-runtime-code"
    >
      {/* 顶部说明条已按用户裁决移除——"确定性投影（只读）"的诚实声明
          仍在每份投影文件的首行注释与「代码」档的悬停提示里 */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          style={{
            width: 210,
            flexShrink: 0,
            overflowY: "auto",
            borderRight: "1px solid #e5e7eb",
            padding: "8px 6px",
            background: "#fcfcfd",
          }}
        >
          <Tree
            showIcon
            blockNode
            defaultExpandAll
            treeData={treeDataOf(tree)}
            selectedKeys={active ? [active.path] : []}
            onSelect={keys => {
              const selected = String(keys[0] ?? "");
              if (files.some(file => file.path === selected)) setActivePath(selected);
            }}
          />
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderBottom: "1px solid #f0f0f0",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontFamily: "ui-monospace, monospace",
                color: "#262626",
              }}
            >
              {active?.path}
            </span>
            <span style={{ fontSize: 10, color: "#bfbfbf" }}>
              {active ? `${active.content.split("\n").length} 行` : ""}
            </span>
            <Button
              size="small"
              type="link"
              icon={<CopyOutlined />}
              style={{ marginLeft: "auto" }}
              data-testid="code-copy"
              onClick={() => {
                if (!active) return;
                navigator.clipboard
                  .writeText(active.content)
                  .then(() => message.success(`已复制 ${active.path}`))
                  .catch(() =>
                    message.warning("复制失败（浏览器未授权剪贴板）")
                  );
              }}
            >
              复制
            </Button>
            {/* E28：整包下载——全部投影文件按目录结构打成 zip（用户裁决） */}
            <Button
              size="small"
              type="link"
              icon={<DownloadOutlined />}
              data-testid="code-export-zip"
              onClick={async () => {
                try {
                  const { default: JSZip } = await import("jszip");
                  const zip = new JSZip();
                  for (const f of files) zip.file(f.path, f.content);
                  const blob = await zip.generateAsync({ type: "blob" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  const safe = (appName || "sliderule-app").replace(
                    /[^a-zA-Z0-9_\-一-鿿]/g,
                    "_"
                  );
                  a.href = url;
                  a.download = `${safe}-code.zip`;
                  a.click();
                  URL.revokeObjectURL(url);
                  message.success(`已导出 ${files.length} 个文件`);
                } catch {
                  message.warning("打包失败，请重试");
                }
              }}
            >
              打包导出
            </Button>
          </div>
          <React.Suspense
            fallback={
              <pre
                data-testid="code-content"
                style={{
                  flex: 1,
                  minHeight: 0,
                  margin: 0,
                  overflow: "auto",
                  padding: "12px 16px",
                  fontSize: 12,
                  lineHeight: 1.7,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "#1f2329",
                  whiteSpace: "pre",
                }}
              >
                {active?.content}
              </pre>
            }
          >
            {active ? (
              <LazyCodeMirrorPanel
                key={active.path}
                language={active.language}
                value={active.content}
              />
            ) : null}
          </React.Suspense>
        </div>
      </div>
    </div>
  );
}
