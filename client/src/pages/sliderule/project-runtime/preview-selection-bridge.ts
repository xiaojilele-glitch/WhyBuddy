export interface PreviewSelectionScope {
  projectId: string;
  runtimeId: string;
  revision: string;
}
export interface PreviewSourceLocation {
  path: string;
  line: number;
  column: number;
}

export function validSourcePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    !/[\\\x00-\x1f:]/.test(value) &&
    !value.startsWith("/") &&
    value.split("/").every(part => part !== "." && part !== ".." && part !== "")
  );
}

/**
 * 从工程动作的结构化细节里取出正在改的那份文件。
 *
 * 开场摘要是 `src/Home.tsx、src/api/tasks.ts`；命令 / 版本号不是 path。
 * 认 validSourcePath，不解析人话 label。
 */
export function sourcePathFromActionDetail(detail: string): string | null {
  const raw = String(detail || "").trim();
  if (!raw) return null;
  for (const part of raw.split(/[、,，\s]+/)) {
    let path = part.trim();
    if (path.includes("等") && /个文件$/.test(path)) {
      path = path.split("等")[0]?.trim() ?? "";
    }
    if (!validSourcePath(path)) continue;
    if (!path.includes("/") && !/\.[A-Za-z0-9]{1,8}$/.test(path)) continue;
    return path;
  }
  return null;
}

/** Sandpack's source/channel lifecycle, with explicit origin and revision fencing. */
export function connectPreviewSelection({
  frame,
  origin,
  scope,
  onSelection,
  onStatus,
}: {
  frame: HTMLIFrameElement;
  origin: string;
  scope: PreviewSelectionScope;
  onSelection: (location: PreviewSourceLocation) => void;
  onStatus: (status: "ready" | "missing-source") => void;
}) {
  const channelId = crypto.randomUUID();
  let enabled = false;
  let disposed = false;
  const send = () => {
    if (!frame.isConnected || disposed) return;
    frame.contentWindow?.postMessage(
      {
        type: "whybuddy:select:init",
        schemaVersion: 1,
        ...scope,
        channelId,
        enabled,
      },
      origin
    );
  };
  const receive = (event: MessageEvent) => {
    if (
      disposed ||
      event.source !== frame.contentWindow ||
      event.origin !== origin
    )
      return;
    const data = event.data;
    if (
      !data ||
      data.schemaVersion !== 1 ||
      data.channelId !== channelId ||
      data.projectId !== scope.projectId ||
      data.runtimeId !== scope.runtimeId ||
      data.revision !== scope.revision
    )
      return;
    if (data.type === "whybuddy:select:ready") {
      onStatus("ready");
      return;
    }
    if (!enabled || data.type !== "whybuddy:select:element") return;
    if (data.location === null) {
      onStatus("missing-source");
      return;
    }
    const location = data.location;
    if (
      !validSourcePath(location?.path) ||
      !Number.isInteger(location.line) ||
      location.line < 1 ||
      location.line > 1_000_000 ||
      !Number.isInteger(location.column) ||
      location.column < 1 ||
      location.column > 1_000_000
    )
      return;
    onSelection({
      path: location.path,
      line: location.line,
      column: location.column,
    });
  };
  window.addEventListener("message", receive);
  frame.addEventListener("load", send);
  send();
  return {
    setEnabled(value: boolean) {
      enabled = value;
      send();
    },
    dispose() {
      enabled = false;
      send();
      disposed = true;
      window.removeEventListener("message", receive);
      frame.removeEventListener("load", send);
    },
  };
}
