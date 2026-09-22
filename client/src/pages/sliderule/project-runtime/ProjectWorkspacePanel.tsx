import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileType,
  FileType2,
  Folder,
  FolderOpen,
} from "lucide-react";
import { activateSession } from "../../agent-loop/dashboard/SidebarSessions";
import { slideruleSessionPath } from "@/lib/sliderule-session-id";
import type { PreviewSourceLocation } from "./preview-selection-bridge";
import { sourcePathParts } from "./source-editor-language";
import {
  sourceFileTree,
  sourceTreeDirPaths,
  sourceTreeIconKind,
  type SourceTreeIconKind,
  type SourceTreeNode,
} from "./source-file-tree";
import {
  exportProjectRevision,
  forkProjectRevision,
  getProjectRevisions,
  getProjectSource,
  getProjectSourceFile,
  getSourceOperation,
  patchProjectSource,
  ProjectWorkspaceError,
  restoreProjectRevision,
  type RevisionPage,
  type SourceCommand,
  type SourceFile,
  type SourceIndex,
} from "./project-workspace-client";

type SourceEditorHandle = { reveal: (from: number, to: number) => void };
const LazySourceEditor = React.lazy(() => import("./ProjectSourceEditor"));

export interface SourceSelection extends PreviewSourceLocation {
  revision: string;
  selectionId: string;
}
interface Props {
  projectId: string;
  projectRevision?: string | null;
  revisionMode: "current" | "pinned";
  tab: "source" | "history";
  selection: SourceSelection | null;
  /**
   * 控制面正在写/读的那份文件。盖过清单第一份（常常是 README.md）。
   * 人在树里点过文件就停跟，直到控制面挑了下一份。
   */
  followPath?: string | null;
  onChanged: () => void;
}
const buttonClass =
  "inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40";
// ⚠ 2026-09-15：源码档曾经自占一条全宽「源码版本 · N 个文件 + 描边按钮」。
//   跟会话头条、验收条、编辑器路径叠在一起，真机顶部比代码区还高。
//   版本说明和读取/导出/复刻收进文件树头，编辑器顶栏只留路径和保存。
//
// ⚠ 同日第二张圈图：树头那三个字（读取最新版 / 导出源码 / 复刻工程）
//   把目录挤成说明书。Manus 源码树是纯文件；操作在右上角「源码」旁。
//   有电脑头条宿主就 portal 过去，没有（单测只挂面板）就落在保存旁边。
const treeActionClass =
  "inline-flex h-6 shrink-0 items-center rounded px-1.5 text-[11px] text-[#8b8b8b] hover:bg-[#f4f4f5] hover:text-[#3c3c3c] disabled:opacity-40";
const menuItemClass =
  "flex w-full items-center px-2.5 py-1 text-left text-[12px] text-[#3c3c3c] hover:bg-[#f7f7f8] disabled:opacity-40";

function SourceToolsMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className="relative"
      data-testid="project-source-tools"
    >
      <button
        type="button"
        data-testid="project-source-tools-trigger"
        aria-label="源码操作"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(value => !value)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-[15px] leading-none text-[#3c3c3c] hover:bg-[#f4f4f5]"
      >
        ⋯
      </button>
      <ul
        role="menu"
        hidden={!open}
        className="absolute right-0 z-30 mt-1 min-w-[8rem] rounded-lg border border-[#e5e7eb] bg-white py-1 shadow-[0_8px_24px_rgb(15_23_42/0.12)]"
      >
        {children}
      </ul>
    </div>
  );
}
const active = new Set(["queued", "running", "waiting_user", "cancelling"]);
const failure = (error: unknown) =>
  error instanceof ProjectWorkspaceError
    ? error.message
    : "暂时无法连接工程服务，请稍后重试。";

const SOURCE_TREE_ICONS: Record<
  SourceTreeIconKind,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  folder: Folder,
  "folder-open": FolderOpen,
  code: FileCode,
  html: FileType,
  css: FileType2,
  json: FileJson,
  text: FileText,
  image: FileImage,
  file: File,
};

function SourceTreeGlyph({ kind }: { kind: SourceTreeIconKind }) {
  const Icon = SOURCE_TREE_ICONS[kind];
  return (
    <Icon
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 text-[#8b8b8b]"
      strokeWidth={1.75}
    />
  );
}

function SourceTreeList({
  nodes,
  depth,
  path,
  drafts,
  openDirs,
  onToggle,
  onOpen,
}: {
  nodes: SourceTreeNode[];
  depth: number;
  path: string;
  drafts: Record<string, { base: SourceFile; content: string }>;
  openDirs: Set<string>;
  onToggle: (dir: string) => void;
  onOpen: (file: string) => void;
}) {
  return (
    <ul
      data-testid={depth === 0 ? "project-source-tree" : undefined}
      className="m-0 list-none p-0"
    >
      {nodes.map(node =>
        node.kind === "dir" ? (
          <li key={`dir:${node.path}`}>
            <button
              type="button"
              data-testid="project-source-dir"
              data-source-dir={node.path}
              data-source-icon={sourceTreeIconKind(
                node.name,
                "dir",
                openDirs.has(node.path)
              )}
              aria-expanded={openDirs.has(node.path)}
              title={node.path}
              onClick={() => onToggle(node.path)}
              className="flex w-full items-center gap-1 py-1 pr-2 text-left text-xs text-[#555] hover:bg-[#f7f7f7]"
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              {openDirs.has(node.path) ? (
                <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0 text-[#8b8b8b]" />
              ) : (
                <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-[#8b8b8b]" />
              )}
              <SourceTreeGlyph
                kind={sourceTreeIconKind(node.name, "dir", openDirs.has(node.path))}
              />
              <span className="truncate">{node.name}</span>
            </button>
            {openDirs.has(node.path) ? (
              <SourceTreeList
                nodes={node.children}
                depth={depth + 1}
                path={path}
                drafts={drafts}
                openDirs={openDirs}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ) : null}
          </li>
        ) : (
          <li key={node.path}>
            <button
              type="button"
              data-testid="project-source-file"
              data-source-path={node.path}
              data-source-icon={sourceTreeIconKind(node.name, "file")}
              aria-current={node.path === path ? "true" : undefined}
              title={node.path}
              onClick={() => onOpen(node.path)}
              className={`flex w-full items-center gap-1 py-1 pr-2 text-left font-mono text-xs ${
                node.path === path ? "bg-[#f3f4f6] text-[#171717]" : "text-[#444] hover:bg-[#f7f7f7]"
              }`}
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <SourceTreeGlyph kind={sourceTreeIconKind(node.name, "file")} />
              <span className="truncate">
                {node.name}
                {drafts[node.path] &&
                drafts[node.path].content !== drafts[node.path].base.content
                  ? " *"
                  : ""}
              </span>
            </button>
          </li>
        )
      )}
    </ul>
  );
}

export function ProjectWorkspacePanel(props: Props) {
  return <ProjectWorkspaceBody key={props.projectId} {...props} />;
}

/** Committed source and pending user drafts remain distinct, as in grok's views. */
function ProjectWorkspaceBody({
  projectId,
  projectRevision,
  revisionMode,
  tab,
  selection,
  followPath = null,
  onChanged,
}: Props) {
  const [index, setIndex] = useState<SourceIndex | null>(null);
  const [file, setFile] = useState<SourceFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileRetry, setFileRetry] = useState(0);
  const [path, setPath] = useState("");
  const userPickedPath = useRef<string | null>(null);
  const fileCache = useRef<Map<string, SourceFile>>(new Map());
  const [drafts, setDrafts] = useState<
    Record<string, { base: SourceFile; content: string }>
  >({});
  const [history, setHistory] = useState<RevisionPage | null>(null);
  const [historyLoading, setHistoryLoading] = useState(tab === "history");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [revisionOverride, setRevisionOverride] = useState<
    string | null | undefined
  >(undefined);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fork, setFork] = useState<{ sessionId: string } | null>(null);
  const [pending, setPending] = useState<SourceCommand | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [toolsHost, setToolsHost] = useState<Element | null>(null);
  const [contextHost, setContextHost] = useState<Element | null>(null);
  const editor = useRef<SourceEditorHandle | null>(null);
  const pendingReveal = useRef<{ from: number; to: number } | null>(null);
  const alive = useRef(true);
  const writes = useRef<AbortController | null>(null);
  const commandKeys = useRef(new Map<string, string>());
  const savedDraft = useRef<{ path: string; content: string } | null>(null);
  const followSelection = Boolean(
    followPath && selection?.selectionId?.startsWith("follow:")
  );
  const requestedRevision =
    revisionOverride !== undefined
      ? (revisionOverride ?? undefined)
      : followSelection
        ? undefined
        : (selection?.revision ||
          (revisionMode === "pinned"
            ? (projectRevision ?? undefined)
            : undefined));
  // 2026-09-13: model writes updated the session revision while this current
  // source view kept showing old bytes. Treat that projection as invalidation,
  // not a revision pin: the authoritative GET may already be a newer version.
  // Changing read scope also hides old files and aborts their pending responses;
  // drafts retain their original base so the existing merge guard still applies.
  const currentRevisionSignal =
    revisionMode === "current" ? projectRevision : null;
  const scope = JSON.stringify([
    projectId,
    requestedRevision,
    currentRevisionSignal,
  ]);
  const readScope = useRef(scope);
  readScope.current = scope;
  const [loadedScope, setLoadedScope] = useState(scope);
  const currentIndex = loadedScope === scope ? index : null;
  const currentFile =
    currentIndex &&
    file?.revision === currentIndex.revision &&
    file.path === path
      ? file
      : null;
  const draft = currentFile ? drafts[currentFile.path] : null;
  const content = draft?.content ?? currentFile?.content ?? "";
  const dirty = Boolean(
    currentFile && draft && draft.content !== draft.base.content
  );
  const staleDraft = Boolean(
    dirty && draft?.base.revision !== currentFile?.revision
  );
  // 2026-09-15：Manus 右侧源码是整棵工程树。GET /source 已经给了全部
  // 文件，旧面板却把 path 摊成一条 max-h-36 窄列表——看起来像最近几份，
  // 不像项目。树只从清单长出来，目录默认全开。
  const tree = useMemo(
    () => sourceFileTree((currentIndex?.files ?? []).map(row => row.path)),
    [currentIndex]
  );
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setOpenDirs(new Set(sourceTreeDirPaths(tree)));
  }, [currentIndex?.revision, tree]);
  useLayoutEffect(() => {
    setToolsHost(
      tab === "source" || tab === "history"
        ? document.querySelector("[data-testid=project-source-tools-host]")
        : null
    );
    setContextHost(
      tab === "source" || tab === "history"
        ? document.querySelector("[data-testid=project-computer-context-host]")
        : null
    );
  }, [tab, projectId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      writes.current?.abort();
    };
  }, []);
  useEffect(() => {
    setRevisionOverride(undefined);
  }, [selection?.selectionId, projectRevision, revisionMode]);
  useEffect(() => {
    fileCache.current.clear();
  }, [refresh, projectId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getProjectSource(projectId, requestedRevision, controller.signal)
      .then(next => {
        if (controller.signal.aborted) return;
        setIndex(next);
        setLoadedScope(scope);
        setConflict(false);
        setPath(prior => {
          if (userPickedPath.current) return userPickedPath.current;
          if (followPath) return followPath;
          if (selection && next.files.some(row => row.path === selection.path))
            return selection.path;
          return next.files.some(row => row.path === prior)
            ? prior
            : (next.files[0]?.path ?? "");
        });
        // followPath / selectionId 不在这份依赖里：跟文件不许重拉整棵树。
        if (
          selection &&
          !followPath &&
          !next.files.some(row => row.path === selection.path)
        )
          setError("选中元素的源码位置不在这份工程中，请从文件列表选择。");
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setIndex(null);
          setError(failure(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, requestedRevision, scope, refresh]);
  useEffect(() => {
    userPickedPath.current = null;
    if (followPath) setPath(followPath);
  }, [followPath]);
  useEffect(() => {
    if (followPath || userPickedPath.current || !index || !selection?.path)
      return;
    if (index.files.some(row => row.path === selection.path))
      setPath(selection.path);
  }, [followPath, index, selection?.path, selection?.selectionId]);
  useEffect(() => {
    setFileError(null);
    if (!currentIndex || !path) {
      setFile(null);
      setFileLoading(false);
      return;
    }
    const cacheKey = `${currentIndex.revision}\0${path}`;
    const cached = fileRetry === 0 ? fileCache.current.get(cacheKey) : undefined;
    if (cached) {
      setFile(cached);
      setFileLoading(false);
      return;
    }
    const controller = new AbortController();
    setFile(null);
    // 2026-09-13: a failed file GET left the editor saying it was still
    // loading forever. File reads need their own terminal state and retry;
    // neither changing tabs nor retrying a read may discard local drafts.
    //
    // ⚠ 2026-09-19：跟文件曾把 followPath 写进清单 GET 的依赖，每换一份
    //   就重拉整棵树再读正文，编辑器停在「正在读取文件…」。清单只跟
    //   revision；正文命中缓存就立刻画，不许先清空。
    setFileLoading(true);
    void getProjectSourceFile(
      projectId,
      currentIndex.revision,
      path,
      controller.signal
    )
      .then(next => {
        if (controller.signal.aborted) return;
        fileCache.current.set(cacheKey, next);
        setFile(next);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setFileError(failure(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setFileLoading(false);
      });
    return () => controller.abort();
  }, [projectId, currentIndex?.revision, path, refresh, fileRetry]);
  useEffect(() => {
    if (
      !selection ||
      !currentFile ||
      currentFile.path !== selection.path ||
      currentFile.revision !== selection.revision
    )
      return;
    const lines = content.split("\n");
    if (
      selection.line > lines.length ||
      selection.column > lines[selection.line - 1].length + 1
    ) {
      setError("选中元素的源码行列已失效，请重新选择。");
      return;
    }
    const from =
      lines
        .slice(0, selection.line - 1)
        .reduce((sum, line) => sum + line.length + 1, 0) +
      selection.column -
      1;
    const to =
      from +
      Math.max(1, lines[selection.line - 1].length - selection.column + 1);
    pendingReveal.current = { from, to };
    editor.current?.reveal(from, to);
  }, [selection?.selectionId, currentFile]);
  useEffect(() => {
    if (tab !== "history") return;
    const controller = new AbortController();
    // The source index often arrives before history. Its loading flag cannot
    // describe this independent GET or the version tab appears empty meanwhile.
    setHistoryLoading(true);
    setHistoryError(null);
    void getProjectRevisions(projectId, null, controller.signal)
      .then(next => {
        if (!controller.signal.aborted) setHistory(next);
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setHistory(null);
          setHistoryError(failure(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [projectId, tab, refresh]);

  const complete = (command: SourceCommand) => {
    setPending(null);
    if (command.status !== "completed") {
      setError("工程操作未完成。草稿已保留，请更新运行状态后重试。");
      return;
    }
    const saved = savedDraft.current;
    if (saved)
      setDrafts(prior => {
        if (prior[saved.path]?.content !== saved.content) return prior;
        const next = { ...prior };
        delete next[saved.path];
        return next;
      });
    savedDraft.current = null;
    setNotice(
      "源码版本已保存；运行中的预览由工程服务同步。验收记录需要重新检查。"
    );
    setRevisionOverride(null);
    setConflict(false);
    setRefresh(value => value + 1);
    onChanged();
  };
  useEffect(() => {
    if (!pending?.operationId || !active.has(pending.status)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const operation = await getSourceOperation(
          pending.operationId!,
          controller.signal
        );
        if (controller.signal.aborted) return;
        if (operation.projectId !== projectId)
          throw new ProjectWorkspaceError("操作记录与当前工程不一致。");
        if (!active.has(operation.status)) {
          complete({ ...pending, status: operation.status });
          return;
        }
        timer = setTimeout(() => void poll(), 1500);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(failure(reason));
          timer = setTimeout(() => void poll(), 3000);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pending?.operationId, projectId]);

  const command = async (
    identity: string,
    run: (key: string, signal: AbortSignal) => Promise<void>
  ) => {
    if (writes.current || pending) return;
    const controller = new AbortController();
    writes.current = controller;
    const current = readScope.current;
    const key =
      commandKeys.current.get(identity) ?? `workspace:${crypto.randomUUID()}`;
    commandKeys.current.set(identity, key);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run(key, controller.signal);
      commandKeys.current.delete(identity);
    } catch (reason) {
      if (
        !controller.signal.aborted &&
        alive.current &&
        current === readScope.current
      ) {
        setError(failure(reason));
        setConflict(reason instanceof ProjectWorkspaceError && reason.conflict);
      }
    } finally {
      if (writes.current === controller) writes.current = null;
      if (alive.current) setBusy(false);
    }
  };
  const receiveCommand = (result: SourceCommand) => {
    if (!alive.current) return;
    if (active.has(result.status) && result.operationId) {
      setPending(result);
      setNotice("修改已排队，等待工程服务保存与同步。关闭面板不会取消操作。");
    } else complete(result);
  };
  const save = () => {
    if (!currentFile || !draft || !currentIndex) return;
    const snapshot = draft;
    void command(
      `patch:${snapshot.base.revision}:${snapshot.base.path}:${snapshot.content}`,
      async (key, signal) => {
        const result = await patchProjectSource(
          projectId,
          snapshot.base.revision,
          key,
          snapshot.base,
          snapshot.content,
          signal
        );
        if (signal.aborted) return;
        savedDraft.current = {
          path: snapshot.base.path,
          content: snapshot.content,
        };
        receiveCommand(result);
      }
    );
  };
  const restore = (targetRevision: string) => {
    const expected = history?.currentRevision ?? currentIndex?.currentRevision;
    if (!expected) return;
    void command(
      `restore:${expected}:${targetRevision}`,
      async (key, signal) => {
        const result = await restoreProjectRevision(
          projectId,
          expected,
          targetRevision,
          key,
          signal
        );
        if (!signal.aborted) {
          setConfirmRestore(null);
          receiveCommand(result);
        }
      }
    );
  };
  const download = (revision: string) =>
    void command(`export:${revision}`, async (_, signal) => {
      const blob = await exportProjectRevision(projectId, revision, signal);
      if (signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `whybuddy-project-${revision.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        "源码导出已开始；导出包含运行说明，不包含业务数据库和秘密配置。"
      );
    });
  const duplicate = (revision: string) =>
    void command(`fork:${revision}`, async (key, signal) => {
      const result = await forkProjectRevision(
        projectId,
        revision,
        key,
        signal
      );
      if (signal.aborted) return;
      setFork(result);
      setNotice(
        "已复刻为新工程。业务数据库和秘密配置不复制，新会话批准后才能运行。"
      );
    });
  const locked = busy || Boolean(pending);
  const indexLabel = loading
    ? "正在读取工程源码"
    : currentIndex
      ? `源码版本 ${currentIndex.revision.slice(0, 12)} · ${currentIndex.files.length} 个文件`
      : "工程源码暂不可用";
  const sourceActions = (
    <>
      <button
        className={treeActionClass}
        type="button"
        disabled={locked || loading}
        onClick={() => {
          setRevisionOverride(null);
          setRefresh(value => value + 1);
        }}
      >
        读取最新版
      </button>
      {currentIndex ? (
        <>
          <button
            className={treeActionClass}
            type="button"
            disabled={locked}
            onClick={() => download(currentIndex.revision)}
          >
            导出源码
          </button>
          <button
            className={treeActionClass}
            type="button"
            disabled={locked}
            onClick={() => duplicate(currentIndex.revision)}
          >
            复刻工程
          </button>
        </>
      ) : null}
    </>
  );
  const sourceMenu = (
    <SourceToolsMenu>
      <li>
        <button
          className={menuItemClass}
          type="button"
          role="menuitem"
          disabled={locked || loading}
          onClick={() => {
            setRevisionOverride(null);
            setRefresh(value => value + 1);
          }}
        >
          读取最新版
        </button>
      </li>
      {currentIndex ? (
        <>
          <li>
            <button
              className={menuItemClass}
              type="button"
              role="menuitem"
              disabled={locked}
              onClick={() => download(currentIndex.revision)}
            >
              导出源码
            </button>
          </li>
          <li>
            <button
              className={menuItemClass}
              type="button"
              role="menuitem"
              disabled={locked}
              onClick={() => duplicate(currentIndex.revision)}
            >
              复刻工程
            </button>
          </li>
        </>
      ) : null}
    </SourceToolsMenu>
  );
  const contextText = currentFile
    ? `/${currentFile.path.replace(/^\//, "")}`
    : path
      ? `/${path.replace(/^\//, "")}`
      : indexLabel;
  const contextPill = (
    <span
      className="flex h-6 min-w-0 flex-1 items-center rounded-full bg-[#f4f4f5] px-3 font-mono text-[12px] text-[#8a8a8a]"
      data-testid="project-computer-context-value"
      title={currentFile?.path ?? indexLabel}
    >
      {contextText}
    </span>
  );
  const saveButton = (
    <button
      type="button"
      className={buttonClass}
      disabled={
        !currentFile ||
        !dirty ||
        locked ||
        staleDraft ||
        conflict ||
        currentIndex?.revision !== currentIndex?.currentRevision
      }
      onClick={save}
    >
      保存源码
    </button>
  );
  return (
    <section
      data-testid="project-workspace-panel"
      aria-label="工程源码与版本"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white"
    >
      {notice ? (
        <p
          role="status"
          className="shrink-0 px-3 py-2 text-xs leading-5 text-stone-600"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="shrink-0 px-3 py-2 text-xs leading-5 text-amber-800"
        >
          {error}
        </p>
      ) : null}
      {fork ? (
        <a
          className="shrink-0 px-3 py-2 text-xs underline"
          href={slideruleSessionPath(fork.sessionId)}
          onClick={() => activateSession(fork.sessionId)}
        >
          打开复刻后的会话
        </a>
      ) : null}
      {tab === "history" && !contextHost ? (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[#e5e7eb] px-2">
          <p className="min-w-0 flex-1 truncate text-[12px] text-[#8b8b8b]">
            {indexLabel}
          </p>
          {sourceActions}
        </div>
      ) : null}
      {tab === "source" ? (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="工程文件"
            className="w-56 shrink-0 overflow-auto border-r border-[#e5e7eb] bg-white py-1"
          >
            {!contextHost ? (
              <div className="flex h-8 shrink-0 items-center border-b border-[#e5e7eb] px-2">
                <p className="truncate text-[11px] text-[#8b8b8b]">{indexLabel}</p>
              </div>
            ) : null}
            <SourceTreeList
              nodes={tree}
              depth={0}
              path={path}
              drafts={drafts}
              openDirs={openDirs}
              onToggle={dir =>
                setOpenDirs(prior => {
                  const next = new Set(prior);
                  if (next.has(dir)) next.delete(dir);
                  else next.add(dir);
                  return next;
                })
              }
              onOpen={next => {
                userPickedPath.current = next;
                setPath(next);
              }}
            />
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {currentFile ? (
              <>
                {!toolsHost ? (
                <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[#e5e7eb] px-2">
                  <nav
                    aria-label="当前文件路径"
                    data-testid="project-source-crumbs"
                    className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[12px]"
                  >
                    {sourcePathParts(currentFile.path).map((part, index, all) => (
                      <React.Fragment key={`${index}:${part}`}>
                        {index > 0 ? (
                          <span className="shrink-0 text-[#c4c4c4]" aria-hidden>
                            /
                          </span>
                        ) : null}
                        <span
                          className={
                            index === all.length - 1
                              ? "truncate font-medium text-[#171717]"
                              : "shrink-0 text-[#8b8b8b]"
                          }
                        >
                          {part}
                        </span>
                      </React.Fragment>
                    ))}
                  </nav>
                  {saveButton}
                  {tab === "source" ? sourceMenu : null}
                </div>
                ) : null}
                <div
                  className="flex h-8 shrink-0 items-center border-b border-[#e5e7eb] bg-[#f7f7f8]"
                  data-testid="project-source-tabs"
                >
                  <div
                    data-testid="project-source-tab"
                    className="flex h-full max-w-[14rem] items-center border-r border-[#e5e7eb] bg-white px-3 font-mono text-[12px] text-[#171717]"
                    title={currentFile.path}
                  >
                    <span className="truncate">
                      {sourcePathParts(currentFile.path).at(-1) ??
                        currentFile.path}
                      {dirty ? " *" : ""}
                    </span>
                  </div>
                </div>
                {currentIndex?.revision !== currentIndex?.currentRevision ? (
                  <p className="shrink-0 px-3 py-2 text-xs text-amber-800">
                    正在查看历史版本。可导出、复刻或在版本列表中恢复。
                  </p>
                ) : null}
                {staleDraft ? (
                  <div className="shrink-0 px-3 py-2 text-xs leading-5 text-amber-800">
                    <p>
                      草稿基于旧版本。下方保留你的内容；请先查看服务端源码并合并差异。
                    </p>
                    <details>
                      <summary>查看最新版源码</summary>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap bg-white p-2">
                        {currentFile.content}
                      </pre>
                    </details>
                    <button
                      className={buttonClass}
                      type="button"
                      onClick={() => {
                        setDrafts(prior => ({
                          ...prior,
                          [path]: { base: currentFile, content },
                        }));
                        setConflict(false);
                        setError(null);
                      }}
                    >
                      已核对差异，以最新版为保存基础
                    </button>
                  </div>
                ) : null}
                {conflict && !staleDraft ? (
                  <p className="shrink-0 px-3 py-2 text-xs text-amber-800">
                    点击「读取最新版」核对版本与批准状态，草稿会保留。
                  </p>
                ) : null}
                <React.Suspense
                  fallback={
                    <div
                      data-testid="project-source-editor-pending"
                      className="min-h-0 flex-1 bg-white"
                    />
                  }
                >
                  <LazySourceEditor
                    key={`${currentFile.revision}:${currentFile.path}`}
                    ref={editor}
                    path={currentFile.path}
                    value={content}
                    readOnly={
                      currentIndex?.revision !== currentIndex?.currentRevision
                    }
                    onChange={next =>
                      setDrafts(prior => ({
                        ...prior,
                        [path]: {
                          base: prior[path]?.base ?? currentFile,
                          content: next,
                        },
                      }))
                    }
                    onReady={() => {
                      const pending = pendingReveal.current;
                      if (pending) editor.current?.reveal(pending.from, pending.to);
                    }}
                  />
                </React.Suspense>
              </>
            ) : followPath &&
              path === followPath &&
              !currentIndex?.files.some(row => row.path === path) ? (
              <p
                role="status"
                data-testid="project-source-writing"
                className="px-3 py-3 text-xs text-stone-500"
              >
                {fileLoading
                  ? "正在读取文件…"
                  : path
                    ? `正在写入 ${path}…`
                    : "正在写入源码…"}
              </p>
            ) : fileError ? (
              <div className="px-3 py-3 text-xs leading-5">
                <p role="alert" className="text-amber-800">
                  文件读取失败：{fileError}
                </p>
                <button
                  type="button"
                  className={`${buttonClass} mt-2`}
                  onClick={() => setFileRetry(value => value + 1)}
                >
                  重试读取文件
                </button>
              </div>
            ) : (
              <p
                role={fileLoading ? "status" : undefined}
                className="px-3 py-3 text-xs text-stone-500"
              >
                {fileLoading ? "正在读取文件…" : "选择一个工程文件查看源码。"}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2"
          aria-busy={historyLoading}
        >
          {historyLoading ? (
            <p role="status" className="text-xs leading-5 text-stone-600">
              正在读取版本记录…
            </p>
          ) : null}
          {historyError ? (
            <p role="alert" className="text-xs leading-5 text-amber-800">
              版本记录读取失败：{historyError} 请点击「读取最新版」重试。
            </p>
          ) : null}
          {!historyLoading &&
          !historyError &&
          history?.revisions.length === 0 ? (
            <p className="text-xs leading-5 text-stone-600">
              暂无已保存的源码版本。
            </p>
          ) : null}
          {history?.revisions.map(row => (
            <div
              key={row.revision}
              className="rounded border border-stone-200 bg-white p-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 break-all font-mono">
                  {row.revision}
                  {row.revision === history.currentRevision
                    ? " · 当前版本"
                    : ""}
                </p>
                <button
                  className={buttonClass}
                  disabled={locked}
                  onClick={() => download(row.revision)}
                >
                  导出此版本
                </button>
                <button
                  className={buttonClass}
                  disabled={locked}
                  onClick={() => duplicate(row.revision)}
                >
                  复刻此版本
                </button>
                <button
                  className={buttonClass}
                  disabled={locked || row.revision === history.currentRevision}
                  onClick={() => setConfirmRestore(row.revision)}
                >
                  恢复此版本
                </button>
              </div>
              <p className="mt-1 text-stone-500">
                {row.createdAt} · {row.templateVersion}
              </p>
              {confirmRestore === row.revision ? (
                <div className="mt-2">
                  <p className="mb-2">
                    将此版本的源码恢复为新版本，保留历史。业务数据不会随源码回退，旧检查记录需要重新验证。
                  </p>
                  <button
                    className={buttonClass}
                    disabled={locked}
                    onClick={() => restore(row.revision)}
                  >
                    确认恢复源码
                  </button>
                  <button
                    className={buttonClass}
                    disabled={locked}
                    onClick={() => setConfirmRestore(null)}
                  >
                    取消
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {history?.nextCursor ? (
            <button
              className={buttonClass}
              disabled={locked}
              onClick={() =>
                void command(
                  `history:${history.nextCursor}`,
                  async (_, signal) => {
                    const next = await getProjectRevisions(
                      projectId,
                      history.nextCursor,
                      signal
                    );
                    if (!signal.aborted)
                      setHistory(prior => ({
                        ...next,
                        revisions: [
                          ...(prior?.revisions ?? []),
                          ...next.revisions,
                        ].filter(
                          (row, index, all) =>
                            all.findIndex(
                              item => item.revision === row.revision
                            ) === index
                        ),
                      }));
                  }
                )
              }
            >
              加载更多版本
            </button>
          ) : null}
        </div>
      )}
      {contextHost ? createPortal(contextPill, contextHost) : null}
      {tab === "source" && toolsHost
        ? createPortal(
            <>
              {saveButton}
              {sourceMenu}
            </>,
            toolsHost
          )
        : null}
      {tab === "history" && toolsHost
        ? createPortal(sourceMenu, toolsHost)
        : null}
    </section>
  );
}
