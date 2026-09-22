import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Monitor,
  Play,
  RotateCw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { PreviewDescriptor } from "@shared/project-runtime.generated";
import type { ProjectPreviewReference } from "./project-preview-client";
import { useProjectPreview } from "./useProjectPreview";
import { usePreviewPresence } from "./usePreviewPresence";
import {
  previewAddressPath,
  previewAddressTitle,
  previewFrameAfterLoad,
  previewFrameCovered,
  previewIsAuthorizeEntry,
  previewOpenUrl,
} from "./project-preview-frame";
import {
  PREVIEW_COMING_UP,
  previewWakeLocked,
} from "./project-preview-wake";
import { ProjectVerificationPanel } from "./ProjectVerificationPanel";
import {
  ProjectWorkspacePanel,
  type SourceSelection,
} from "./ProjectWorkspacePanel";
import {
  connectPreviewSelection,
  sourcePathFromActionDetail,
} from "./preview-selection-bridge";
import { ProjectDataPanel } from "./ProjectDataPanel";
import { ProjectDeliveryPanel } from "./ProjectDeliveryPanel";
import { OfficeArtifactPane } from "./OfficeArtifactPane";
import { PresentedOfficeFile } from "./PresentedOfficeFile";
import { PresentedSourcePage } from "./PresentedSourcePage";
import { isOfficeFileDeliverable } from "../deliverable-kind";
import {
  ProjectWorkspaceError,
  requestProjectWorkspace,
} from "./project-workspace-client";
import { ProjectComputerPanel } from "../ProjectComputerPanel";
import { StudioShareToggle } from "../StudioShareToggle";
import { deriveProjectActivity, projectComputerView } from "../project-activity";
import {
  computerViewForAction,
  dispatchFollowComputer,
  dispatchInspectAction,
  FOLLOW_COMPUTER_EVENT,
  INSPECT_ACTION_EVENT,
  inspectActionDetail,
  officePreviewStage,
  presentedOfficeFile,
  presentedSourcePage,
  resolveComputerView,
  shouldAutoOpenPreview,
  shouldAutoWakePreview,
  type ComputerView,
} from "../project-computer-view";
import { sandboxCommandLine } from "../sandbox-session-transcript";
import type { UiTurn } from "../types";
import { useStudioLayout } from "../StudioLayoutContext";
import { useScaleToFit } from "../live-runtime/canvas-scale";
import { ScaledStageFrame } from "../live-runtime/ScaledStageFrame";
import {
  STAGE_FRAME_PAD,
  phoneFramePad,
} from "../live-runtime/stage-frame-style";
import {
  loadProjectPreviewViewId,
  projectPreviewViewOptions,
  resolveProjectPreviewView,
  saveProjectPreviewViewId,
} from "./project-preview-view";

/**
 * 地址栏只显示**路径**，不显示那串 runtimeId 主机名。
 *
 * ⚠ 主机名是 `{runtimeId}.预览域`，对用户没有信息量，却会把这一行撑满
 *   （Manus 那张截图里显示的也只是 `/`）。授权入口外开走另开的票，
 *   不是 iframe 那张，也不是光秃 `/`。
 */
function previewPath(entryUrl: string): string {
  return previewAddressPath(entryUrl);
}

const STATUS: Record<PreviewDescriptor["status"], string> = {
  provisioning: "正在准备运行环境",
  syncing: "正在同步工程源码",
  installing: "正在安装依赖",
  executing: "正在执行工程任务",
  starting: "正在启动应用",
  ready: "预览就绪",
  stopping: "正在停止应用",
  stopped: "应用已停止",
  expired: "运行环境已过期",
  failed: "应用运行失败",
  reconciling: "正在核对运行状态",
};

/** Stable server reason codes are translated here so rollout gates are visible
 * at the point where a user tries to open the project. */
const PREVIEW_REASON: Record<string, string> = {
  project_rollout_disabled:
    "工程模式当前已关闭（WHYBUDDY_PROJECT_ROLLOUT=disabled）。管理员开启工程 rollout 后才能启动沙盒。",
  project_preview_not_configured:
    "工程预览尚未配置独立预览域名、网关密钥或其他必要参数。",
  project_preview_gateway_not_configured:
    "工程预览网关尚未配置，暂时不能提供私有预览。",
  project_private_preview_origin_required:
    "工程预览缺少独立 HTTPS 来源，不能安全打开生成应用。",
  project_runtime_not_started:
    "工程还没有启动运行实例。请先启动工程，系统会在沙盒准备好后提供预览。",
  project_runtime_not_ready:
    "工程运行实例还没有就绪，请等待启动完成后再打开预览。",
  project_preview_tunnel_not_started:
    "工程已启动，但私有预览通道还没有建立。",
  project_preview_binding_changed:
    "工程运行授权已变化，当前预览需要重新同步或启动。",
};

function previewReasonText(reason: string | null | undefined) {
  if (!reason) return null;
  return PREVIEW_REASON[reason] ?? `工程预览暂不可用（${reason}）。`;
}

const SESSION_MODES = [
  ["computer", "终端"],
  ["preview", "预览"],
  ["source", "代码"],
  ["history", "版本"],
  ["data", "数据"],
  ["delivery", "交付"],
] as const;

/** 头条中间那条路径槽。预览和代码同一份圆角条，切档才不会左右跳。 */
const CONTEXT_PILL =
  "flex h-6 w-full min-w-0 items-center rounded-full bg-[#f4f4f5] px-3 font-mono text-[12px] text-[#8a8a8a]";
/**
 * 对照 Manus：地址是一条居中胶囊，左图标、中路径、右刷新。
 *
 * ⚠ 2026-09-19 真机：`flex-1` 把胶囊拉满中间槽，设备下拉和右侧齿轮
 *   被外壳 `overflow-hidden` 裁掉。有上限、居中，把宽度让给两侧按钮。
 */
const ADDRESS_PILL =
  "flex h-6 w-full min-w-0 max-w-[18rem] items-center gap-1.5 rounded-full bg-[#f4f4f5] pl-2.5 pr-1 font-mono text-[12px] text-[#8a8a8a]";
/** 两侧按内容占位（按钮不被挤），中间先让宽度、地址居中。 */
const CHROME_GRID =
  "grid h-9 min-w-0 shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,1fr)_minmax(max-content,1fr)] items-center gap-2 border-b border-[#e5e7eb] px-3";
const APP_MODES = SESSION_MODES.filter(([value]) => value !== "computer");

/**
 * 切档。对照 Cursor 的模型/视图菜单：触发器是安静的字 + 箭头，
 * 浮层自己画，不用系统 `<select>`——Windows 原生列表会把整条顶栏
 * 撑成一块系统控件（2026-09-14 真机圈的）。
 *
 * ⚠ 2026-09-14 点开「看着没有」：菜单是 absolute，父级
 *   `overflow-x-auto` 会把 overflow-y 也收成裁切（CSS 规定），
 *   36px 高的顶栏把整张菜单剪没。终端又在后面画，没 z-index
 *   也会盖住漏出来的那一点。头条要 `relative z-10`，齿轮条
 *   不许写 overflow-x-auto。
 */
function ComputerModeSelect({
  tab,
  hasSession,
  onPick,
}: {
  tab: ComputerView;
  hasSession: boolean;
  onPick: (value: ComputerView) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const modes = hasSession ? SESSION_MODES : APP_MODES;
  const current = modes.find(([value]) => value === tab)?.[1] ?? modes[0][1];
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
      data-testid="project-mode-select"
      data-mode={tab}
      aria-label="工程工作台视图"
    >
      <button
        type="button"
        data-testid="project-mode-trigger"
        aria-label="工程工作台视图"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(value => !value)}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5]"
      >
        <Monitor className="h-3.5 w-3.5 text-[#8a8a8a]" aria-hidden />
        <span data-testid="project-computer-title">{current}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[#8a8a8a]" aria-hidden />
      </button>
      <ul
        role="listbox"
        hidden={!open}
        className="absolute left-0 z-30 mt-1 min-w-[8rem] rounded-lg border border-[#e5e7eb] bg-white py-1 shadow-[0_8px_24px_rgb(15_23_42/0.12)]"
      >
        {modes.map(([value, label]) => {
          const selected = tab === value;
          return (
            <li key={value}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                data-mode-label={label}
                onClick={() => {
                  onPick(value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] ${
                  selected
                    ? "bg-[#f4f4f5] font-medium text-[#1f1f1f]"
                    : "text-[#3c3c3c] hover:bg-[#f7f7f8]"
                }`}
              >
                <Check
                  className={`h-3.5 w-3.5 ${selected ? "text-[#1f1f1f]" : "opacity-0"}`}
                  aria-hidden
                />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Manus 右侧终端底下那条：跳转 + 细进度 + 「实时」。
 * 画在外壳上，不画进面板——再叠一条就是 2026-09-14 拆掉的第二层壳。
 *
 * ⚠ 2026-09-16 对照 Manus 真机底栏：`$` 在 PTY 的 PS1 里，不在这条回放
 *   栏上。第一版把 `$`、粗 `accent` 滑条、跟在队尾时的 `61 / 61` 全塞进
 *   footer，看起来像播放器。跳到实时也不是右边一条蓝链接——倒回去看时
 *   是进度条上方的深色胶囊。
 *   「实时」在这里是队尾位置，不是「还在跑」灯。停了也跟在队尾就写
 *   「实时」，还在跑用蓝色分开。独立卡片 ProjectComputerPanel 仍
 *   fail-closed：停了不许亮「实时」。
 */
function ComputerReplayDock({
  rows,
  focusId,
}: {
  rows: ReturnType<typeof deriveProjectActivity>;
  focusId: string | null;
}) {
  const focusIndex = focusId ? rows.findIndex(row => row.id === focusId) : -1;
  const { index, live, following } = projectComputerView(
    rows,
    focusIndex >= 0 ? focusIndex : null
  );
  const seek = (next: number) => {
    const row = rows[next];
    if (!row) return;
    dispatchInspectAction({ id: row.id, tool: row.tool, keepView: true });
  };
  const pct = rows.length ? ((index + 1) / rows.length) * 100 : 0;
  const skipBtn =
    "flex h-6 w-6 items-center justify-center rounded text-[#8c8c8c] hover:bg-stone-100 hover:text-[#3c3c3c] disabled:opacity-30";
  return (
    <div className="relative shrink-0">
      {following ? null : (
        <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-3 flex justify-center">
          <button
            type="button"
            data-testid="project-computer-follow"
            onClick={() => dispatchFollowComputer()}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[#171717] px-3.5 py-1.5 text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,.18)]"
          >
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
            跳到实时
          </button>
        </div>
      )}
      <footer
        data-testid="project-computer-promptbar"
        className="flex shrink-0 items-center gap-2.5 border-t border-[#ececec] px-3 py-2"
      >
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label="上一步"
            data-testid="project-computer-prev"
            disabled={index <= 0}
            onClick={() => seek(Math.max(index - 1, 0))}
            className={skipBtn}
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="下一步"
            data-testid="project-computer-next"
            disabled={index >= rows.length - 1}
            onClick={() => seek(Math.min(index + 1, rows.length - 1))}
            className={skipBtn}
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative h-3.5 min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-0 flex items-center">
            <div className="h-[2px] w-full rounded-full bg-[#e8e8e8]">
              <div
                className="h-full rounded-full bg-[#2f6bff]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(rows.length - 1, 0)}
            value={index}
            aria-label="回放进度"
            onChange={event => seek(Number(event.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        {following ? (
          <span
            className={`shrink-0 text-[12px] ${live ? "text-[#2f6bff]" : "text-[#8c8c8c]"}`}
            data-testid="project-computer-live"
          >
            实时
          </span>
        ) : null}
      </footer>
    </div>
  );
}

/**
 * 预览没打开时的脸。2026-09-16 第二轮对照 Manus 空态：
 * 窗骨架 + 一句「预览已暂停，点击以唤醒。」+ 黑底「唤醒」。
 * 配置/HTTP 错误才加第二行；「工程还没启动」那种说明书不许再写。
 *
 * 唤醒 = 能开就换票（open），过期/停止就 POST /preview/wake；
 * 失败必须把原因写在第二行，不许假装刷新就好了。
 *
 * ⚠ 2026-09-19 点唤醒后 `opening` 一把就放下，provisioning 时
 *   按钮又变回「唤醒」，真机还能再点。路上把按钮收掉，窗骨架扫光
 *   （对照 Manus 恢复环境），失败才把按钮还回来。
 *
 * ⚠ 2026-09-19 下午用户圈了：停着的两块白板没有动画，看着像坏了。
 *   改成小浏览器 + 页骨架一直扫光；醒的时候只加快，不另发明一套。
 */
function PreviewPausedFace({
  title,
  detail,
  waking,
  disabled,
  alert,
  onWake,
  testid = "project-preview-paused",
}: {
  title: string;
  detail: string | null;
  waking: boolean;
  disabled: boolean;
  alert?: boolean;
  onWake: () => void;
  testid?: string;
}) {
  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center bg-white"
      data-testid={testid}
      data-preview-waking={waking ? "true" : "false"}
      aria-busy={waking}
    >
      <div
        className={`sr-preview-window mb-6 w-[168px] overflow-hidden rounded-xl border border-[#ececee] bg-[#f7f7f8] shadow-[0_10px_28px_rgb(15_23_42/0.06)]${
          waking ? " sr-preview-wake-window" : ""
        }`}
        data-testid="project-preview-window"
        aria-hidden
      >
        <div className="flex items-center gap-1.5 px-2.5 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#e4e4e7]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#e4e4e7]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#e4e4e7]" />
          <span className="ml-1 h-2 flex-1 rounded-full bg-white" />
        </div>
        <div
          className={`sr-preview-page mx-2 mb-2 h-[72px] overflow-hidden rounded-lg bg-white${
            waking ? " sr-preview-wake-pane" : ""
          }`}
        >
          <span className="sr-preview-page-line w-[74%]" />
          <span className="sr-preview-page-line w-[52%]" />
          <span className="sr-preview-page-line w-[63%]" />
        </div>
      </div>
      <p className="text-[13px] text-[#8a8a8a]">{title}</p>
      {detail ? (
        <p
          role={alert ? "alert" : undefined}
          className="mt-1 max-w-sm px-6 text-center text-[12px] leading-5 text-[#a1a1aa]"
        >
          {detail}
        </p>
      ) : null}
      {waking ? (
        <span
          className="sr-preview-wake-spin mt-4"
          data-testid="project-preview-wake-spin"
          aria-hidden
        />
      ) : (
        <button
          type="button"
          data-testid="project-preview-wake"
          disabled={disabled}
          onClick={onWake}
          className="mt-4 rounded-full bg-[#171717] px-5 py-1.5 text-[13px] text-white disabled:opacity-40"
        >
          唤醒
        </button>
      )}
    </div>
  );
}

/**
 * 对照 Manus：预览档地址一直在头条，没打开也画 `/`。
 * 完整 URL 只进 title / 外开，行里只留路径。
 * 设备下拉在槽外面，分辨率读数也不进槽——进了就把胶囊挤扁。
 */
function PreviewDeviceChrome({
  viewId,
  scale,
  onChange,
}: {
  viewId: string;
  scale: number;
  onChange: (id: string) => void;
}) {
  const view = resolveProjectPreviewView(viewId);
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <select
        value={view.id}
        onChange={event => onChange(event.target.value)}
        data-testid="project-preview-view"
        aria-label="预览设备"
        title="换一台机器看：只改预览画布尺寸，不会重新生成"
        className="h-6 max-w-[9.5rem] shrink-0 cursor-pointer rounded border border-[#e5e7eb] bg-white px-1 text-[11px] text-[#555] outline-none hover:border-[#d3d8e0]"
      >
        {projectPreviewViewOptions().map(option => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        className="sr-only"
        data-testid="project-preview-scale"
        title={`固定 ${view.viewport.w}×${view.viewport.h} 设计分辨率，按容器等比缩放`}
      >
        {view.viewport.w}×{view.viewport.h} · {Math.round(scale * 100)}%
      </span>
    </div>
  );
}

function PreviewAddressBar({
  entryUrl,
  canReload,
  onReload,
  onOpenExternal,
}: {
  entryUrl: string | null;
  canReload: boolean;
  onReload: () => void;
  onOpenExternal: () => void;
}) {
  const authorize = Boolean(entryUrl && previewIsAuthorizeEntry(entryUrl));
  return (
    <div
      className={ADDRESS_PILL}
      data-testid="project-preview-addressbar"
    >
      <Monitor
        className="h-3.5 w-3.5 shrink-0 text-[#b4b4b4]"
        aria-hidden
      />
      <span
        className="min-w-0 flex-1 truncate"
        title={entryUrl ? previewAddressTitle(entryUrl) : undefined}
        data-testid="project-preview-url"
      >
        {entryUrl ? previewPath(entryUrl) : "/"}
      </span>
      {entryUrl ? (
        authorize ? (
          <button
            type="button"
            onClick={onOpenExternal}
            data-testid="project-preview-open-external"
            title="在新标签页打开"
            aria-label="在新标签页打开预览"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#8a8a8a] hover:bg-white"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        ) : (
          <a
            href={previewOpenUrl(entryUrl)}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="project-preview-open-external"
            title="在新标签页打开"
            aria-label="在新标签页打开预览"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#8a8a8a] hover:bg-white"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )
      ) : null}
      <button
        type="button"
        title="重新载入页面"
        aria-label="重新载入预览"
        data-testid="project-preview-reload"
        disabled={!canReload}
        onClick={onReload}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#8a8a8a] hover:bg-white disabled:opacity-40"
      >
        <RotateCw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** 配置/通道类理由才写在空态第二行；未启动、未就绪跟 Manus 一样只说暂停。 */
const PREVIEW_FACE_REASONS = new Set([
  "project_preview_not_configured",
  "project_preview_gateway_not_configured",
  "project_private_preview_origin_required",
  "project_preview_tunnel_not_started",
  "project_preview_binding_changed",
  "project_rollout_disabled",
]);

export function SandboxPreviewSurface({
  projectId,
  projectRevision,
  revisionMode = "pinned",
  appTitle = "工程预览",
  turns,
  className = "",
  chromeSlot,
  resetSlot,
  sessionId,
  isRunning = false,
  projectCreateError = null,
  deliverableKind,
}: ProjectPreviewReference & {
  appTitle?: string;
  /**
   * 会话工作台才传。有它，「终端」才进下拉，并按 `resolveComputerView`
   * 自动切档。应用中心那条预览链不传——那边没有正在干活的动作流。
   */
  turns?: UiTurn[];
  className?: string;
  /**
   * 舞台头条右侧：分栏 / 全屏 + 交付物。从 ProjectStudio 挪进来，
   * 跟「打开预览」同一条，不再在电脑壳上面另叠一行。
   */
  chromeSlot?: React.ReactNode;
  /** 标题左侧：重置会话。HTML 推演顶栏同一颗，工程档也要够得着。 */
  resetSlot?: React.ReactNode;
  sessionId?: string;
  isRunning?: boolean;
  /** 会话工作台：工程还没落库时的创建失败。应用中心不传。 */
  projectCreateError?: string | null;
  /** 办公文件不把 Vite iframe 叫醒当交付物。 */
  deliverableKind?: string;
}) {
  const preview = useProjectPreview({
    projectId,
    projectRevision,
    revisionMode,
  });
  const descriptor = preview.snapshot?.descriptor;
  const [userPinned, setUserPinned] = useState<ComputerView | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  useEffect(() => {
    setFrameReady(false);
    setFrameSrc(preview.entryUrl);
  }, [preview.entryUrl]);
  const activityRows = useMemo(
    () => (turns ? deriveProjectActivity(turns) : []),
    [turns]
  );
  const focusIndex = focusId
    ? activityRows.findIndex(row => row.id === focusId)
    : -1;
  const computerNow = projectComputerView(
    activityRows,
    focusIndex >= 0 ? focusIndex : null
  );
  // 切档只认「已经换到的票」。能不能开 ≠ 控制面挑了预览——
  // 把 canOpen 焊进 previewReady，装依赖时右侧会被拽去唤醒脸。
  const runtimeReady = preview.canOpen || Boolean(preview.entryUrl);
  const previewReady = Boolean(preview.entryUrl);
  // ⚠ 2026-09-18：自动切档必须看**当前跟的那一行**，不是数组最后一项
  //   另算一份。人没点过时跟队尾；点过就跟那一条的工具。
  const lastTool = computerNow.current?.tool ?? null;
  const presentedPath = presentedSourcePage(activityRows);
  const presentedOfficePath = presentedOfficeFile(activityRows);
  const previewStage = officePreviewStage({
    office: isOfficeFileDeliverable(deliverableKind),
    htmlPath: presentedPath,
    officePath: presentedOfficePath,
  });
  const hasConsole = activityRows.some(
    row => Boolean(sandboxCommandLine(row) && row.operationId)
  );
  const awaitingProject = Boolean(turns) && !projectId;
  // ⚠ 2026-09-15：工程还没落库时不许改口钉死「computer」。
  //   TicketStream 那趟 create + list 已经有动作，短接会让
  //   resolveComputerView 根本跑不到，右侧白纸。
  const tab: ComputerView = turns
    ? resolveComputerView({
        userPinned,
        live: computerNow.live,
        hasActivity: activityRows.length > 0,
        previewReady: isOfficeFileDeliverable(deliverableKind)
          ? false
          : previewReady,
        lastTool,
        hasConsole,
        deliverableKind,
      })
    : userPinned && userPinned !== "computer"
      ? userPinned
      : "preview";
  const [stopBusy, setStopBusy] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const stopRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setStopBusy(false);
    setStopError(null);
    return () => {
      stopRequest.current?.abort();
      stopRequest.current = null;
    };
  }, [projectId, preview.snapshot?.operationId]);
  const stopRuntime = async () => {
    const operationId = preview.snapshot?.operationId;
    if (!operationId || stopRequest.current) return;
    const controller = new AbortController();
    stopRequest.current = controller;
    setStopBusy(true);
    setStopError(null);
    try {
      await requestProjectWorkspace(
        `/project-operations/${encodeURIComponent(operationId)}/cancel`,
        controller.signal,
        {}
      );
      if (!controller.signal.aborted) await preview.refresh();
    } catch (error) {
      if (!controller.signal.aborted)
        setStopError(
          error instanceof ProjectWorkspaceError
            ? error.message
            : "停止请求未能确认，请更新运行状态后重试。"
        );
    } finally {
      if (stopRequest.current === controller) stopRequest.current = null;
      if (!controller.signal.aborted) setStopBusy(false);
    }
  };
  const [workspaceOpened, setWorkspaceOpened] = useState(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const pinView = (value: ComputerView) => {
    setUserPinned(value);
    if (value === "source" || value === "history") setWorkspaceOpened(true);
  };
  useEffect(() => {
    if (tab === "source" || tab === "history") setWorkspaceOpened(true);
  }, [tab]);
  const goPreview = () => {
    pinView("preview");
    void preview.open();
  };
  const canStop = Boolean(
    preview.snapshot?.operationId &&
    descriptor &&
    !["stopped", "expired", "failed"].includes(descriptor.status)
  );
  useEffect(() => {
    const onInspect = (event: Event) => {
      const detail = inspectActionDetail((event as CustomEvent).detail);
      if (!detail) return;
      setFocusId(detail.id);
      if (detail.keepView) return;
      const view = computerViewForAction(detail.tool);
      pinView(view);
    };
    const onFollow = () => {
      // 人已经在看终端，跳回最新那条——不许因为预览就绪被自动切走。
      setFocusId(null);
      setUserPinned("computer");
    };
    window.addEventListener(INSPECT_ACTION_EVENT, onInspect);
    window.addEventListener(FOLLOW_COMPUTER_EVENT, onFollow);
    return () => {
      window.removeEventListener(INSPECT_ACTION_EVENT, onInspect);
      window.removeEventListener(FOLLOW_COMPUTER_EVENT, onFollow);
    };
  }, []);
  const [selection, setSelection] = useState<SourceSelection | null>(null);
  const [manualSelect, setManualSelect] = useState(false);
  // 跟控制面正在写/读的那份 path（tool_start 白名单摘要），不是清单第一份 README。
  const followPath = useMemo(() => {
    const row = computerNow.current;
    if (!row || computerViewForAction(row.tool) !== "source") return null;
    return sourcePathFromActionDetail(row.detail || "");
  }, [computerNow.current]);
  const followActionId = computerNow.current?.id ?? "";
  useEffect(() => {
    setManualSelect(false);
  }, [followActionId]);
  useEffect(() => {
    if (manualSelect || !followPath) return;
    setSelection(prev => {
      // ⚠ 2026-09-19：跟文件曾把 projectRevision 写进 selection.revision。
      //   requestedRevision 优先吃它，清单钉死在开写那一版；文件落在新
      //   版本上，GET 旧树 404，编辑器停在「正在写入源码…」。跟文件只
      //   带 path，版本跟 current。
      if (
        prev?.path === followPath &&
        prev.selectionId.startsWith("follow:") &&
        !prev.revision
      )
        return prev;
      return {
        path: followPath,
        line: 1,
        column: 1,
        revision: "",
        selectionId: `follow:${followActionId}:${followPath}`,
      };
    });
  }, [followPath, followActionId, manualSelect]);
  const [selecting, setSelecting] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<
    "waiting" | "ready" | "missing-source"
  >("waiting");
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ReturnType<typeof connectPreviewSelection> | null>(
    null
  );
  useEffect(() => {
    setUserPinned(null);
    setFocusId(null);
    setSelection(null);
    // ⚠ 2026-09-15 真机团长工作台 `sr-20260915161915-B2601PBD1Q`：
    //   计划批准后右侧已经停在「代码」等 id，projectId 落到
    //   `prj-4ec824406ad35125a3595c4d419c9eb0` 时这里曾经无条件
    //   `setWorkspaceOpened(false)`。tab 还是 source，下面那条
    //   `[tab]` 不重跑；waiting 卸了（已经有 id），面板又没挂上——
    //   标题写着「代码」，下面整面白纸。用户圈了那张图。
    //   换工程仍要卸上一份的钉档/点选；当前已经在代码/版本档
    //   就立刻再打开，不许经过一个空窗。
    const view = tabRef.current;
    setWorkspaceOpened(view === "source" || view === "history");
  }, [projectId]);
  useEffect(() => {
    setSelecting(false);
    setBridgeStatus("waiting");
    setSelection(null);
    if (!frame.current || !preview.entryUrl || !descriptor) return;
    const connection = connectPreviewSelection({
      frame: frame.current,
      origin: new URL(preview.entryUrl).origin,
      scope: {
        projectId: descriptor.projectId,
        runtimeId: descriptor.runtimeId,
        revision: descriptor.revision,
      },
      onStatus: setBridgeStatus,
      onSelection: location => {
        setManualSelect(true);
        setSelection({
          ...location,
          revision: descriptor.revision,
          selectionId: crypto.randomUUID(),
        });
        setWorkspaceOpened(true);
        pinView("source");
        setSelecting(false);
        connection.setEnabled(false);
      },
    });
    bridge.current = connection;
    return () => {
      connection.dispose();
      if (bridge.current === connection) bridge.current = null;
    };
  }, [
    preview.entryUrl,
    descriptor?.projectId,
    descriptor?.runtimeId,
    descriptor?.revision,
  ]);
  const mismatch =
    revisionMode === "pinned" &&
    descriptor &&
    projectRevision &&
    descriptor.revision !== projectRevision;
  const previewError = awaitingProject ? projectCreateError : preview.error;
  const previewIdle =
    !descriptor ||
    descriptor.status === "stopped" ||
    descriptor.status === "expired" ||
    descriptor.status === "ready";
  const blockedReason = previewReasonText(preview.snapshot?.reason);
  const faceReason =
    !previewError &&
    !mismatch &&
    preview.snapshot?.reason &&
    PREVIEW_FACE_REASONS.has(preview.snapshot.reason)
      ? blockedReason
      : null;
  const comingUpTitle =
    descriptor && PREVIEW_COMING_UP.has(descriptor.status)
      ? STATUS[descriptor.status]
      : null;
  const waking = previewWakeLocked({
    opening: preview.opening,
    starting: preview.starting,
    loading: preview.loading,
    awaitingProject,
    status: descriptor?.status,
  });
  const pausedTitle = preview.opening
    ? "正在打开预览…"
    : previewError
      ? "暂时无法打开预览"
      : awaitingProject
        ? "正在准备工程"
        : mismatch
          ? "运行版本与当前工程不同"
          : faceReason
            ? "暂时无法打开预览"
            : comingUpTitle
              ? comingUpTitle
              : preview.starting
                ? "正在启动应用…"
                : preview.loading
                  ? "正在准备预览…"
                  : previewIdle
                    ? "预览已暂停，点击以唤醒。"
                    : STATUS[descriptor!.status];
  const pausedDetail = previewError
    ? previewError
    : mismatch
      ? "当前运行的是另一份源码版本，请先同步或启动当前工程。"
      : faceReason;
  const officeFile = isOfficeFileDeliverable(deliverableKind);
  const canWake = Boolean(projectId) && !waking && !officeFile;
  const [previewViewId, setPreviewViewId] = useState(loadProjectPreviewViewId);
  const previewView = resolveProjectPreviewView(previewViewId);
  const studioLayout = useStudioLayout();
  const { ref: previewFitRef, scale: previewScale } = useScaleToFit(
    previewView.viewport.w,
    previewView.viewport.h,
    "contain",
    studioLayout?.resizing ?? false,
    previewView.framed && previewView.frame
      ? phoneFramePad(previewView.frame)
      : STAGE_FRAME_PAD,
    previewView.maxScale
  );
  const changePreviewView = (id: string) => {
    setPreviewViewId(id);
    saveProjectPreviewViewId(id);
  };
  const wakePreview = () => {
    if (waking) return;
    void preview.wake();
  };
  const reloadPreview = () => {
    if (preview.entryUrl) {
      void preview.open();
      return;
    }
    wakePreview();
  };
  useEffect(() => {
    if (
      !shouldAutoOpenPreview({
        hasTurns: Boolean(turns && turns.length),
        view: tab,
        hasTicket: Boolean(preview.entryUrl),
        opening: preview.opening,
        runtimeReady,
        lastTool,
        deliverableKind,
      })
    ) {
      return;
    }
    void preview.open();
  }, [
    turns,
    tab,
    preview.entryUrl,
    preview.opening,
    runtimeReady,
    lastTool,
    deliverableKind,
    preview.open,
  ]);
  useEffect(() => {
    if (
      !shouldAutoWakePreview({
        hasTurns: Boolean(turns && turns.length),
        view: tab,
        hasTicket: Boolean(preview.entryUrl),
        opening: preview.opening,
        starting: preview.starting,
        live: computerNow.live,
        lastTool,
        runtimeReady,
        deliverableKind,
      })
    ) {
      return;
    }
    void preview.wake();
  }, [
    turns,
    tab,
    preview.entryUrl,
    preview.opening,
    preview.starting,
    computerNow.live,
    lastTool,
    runtimeReady,
    deliverableKind,
    preview.wake,
  ]);
  const presence = usePreviewPresence({
    view: tab,
    hasTicket: Boolean(preview.entryUrl),
    operationId: preview.snapshot?.operationId,
  });
  const showPreviewPick = tab === "preview" && Boolean(preview.entryUrl);
  const previewPickButton = showPreviewPick ? (
    <button
      type="button"
      disabled={bridgeStatus === "waiting"}
      aria-pressed={selecting}
      className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
      onClick={() => {
        const value = !selecting;
        setSelecting(value);
        bridge.current?.setEnabled(value);
        pinView("preview");
      }}
    >
      {selecting ? "退出点选" : "点选"}
    </button>
  ) : null;

  return (
    <section
      data-testid="sandbox-preview-surface"
      data-project-id={projectId ?? ""}
      data-project-revision={descriptor?.revision ?? ""}
      data-computer-view={tab}
      data-preview-status={descriptor?.status ?? "none"}
      className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden border border-stone-200 bg-white ${
        // 会话工作台贴边铺满：圆角会在四角漏出舞台底色（2026-09-14 真机圈的）。
        // 应用中心那条链没有 turns，仍是卡片，保留 rounded-lg。
        turns ? "" : "rounded-lg "
      }${className}`}
    >
      {turns ? (
        <div
          className={`relative z-10 ${CHROME_GRID}`}
          data-testid="project-computer-chrome"
          data-header-pattern="primer-page-header"
        >
          {/* ⚠ 2026-09-16 对照 Manus 电脑头条：切档永远在左，中间永远是
              路径槽，操作永远在右。第一版预览把下拉放左边、代码档又把
              下拉甩到 `ml-auto`，切一次就左右跳。源码标题「代码」和下拉
              「源码」还各写一遍。现在三槽锁死，预览/代码同一条骨架。 */}
          <div className="flex items-center gap-1.5 justify-self-start">
            {resetSlot}
            <ComputerModeSelect tab={tab} hasSession onPick={pinView} />
            {tab === "preview" && !officeFile ? (
              <PreviewDeviceChrome
                viewId={previewView.id}
                scale={previewScale}
                onChange={changePreviewView}
              />
            ) : null}
          </div>
          <div
            data-testid="project-computer-context"
            className="flex min-w-0 justify-center overflow-hidden"
          >
            {tab === "preview" ? (
              <PreviewAddressBar
                entryUrl={officeFile ? null : preview.entryUrl}
                canReload={
                  officeFile
                    ? false
                    : preview.entryUrl
                      ? preview.canOpen
                      : canWake
                }
                onReload={reloadPreview}
                onOpenExternal={() => void preview.openExternal()}
              />
            ) : tab === "computer" ? (
              <p
                role="status"
                className={CONTEXT_PILL}
                data-testid={
                  computerNow.current?.status === "running"
                    ? "project-computer-live-command"
                    : "project-computer-context-value"
                }
              >
                {computerNow.current?.status === "running"
                  ? sandboxCommandLine(computerNow.current) ||
                    computerNow.current.label
                  : "/"}
              </p>
            ) : (
              <div
                data-testid="project-computer-context-host"
                className="flex min-w-0 w-full items-center"
              />
            )}
          </div>
          <div
            className="flex items-center justify-end justify-self-end gap-1"
            data-testid="project-computer-gears"
          >
            {tab === "source" || tab === "history" ? (
              <div
                data-testid="project-source-tools-host"
                className="contents"
              />
            ) : null}
            {previewPickButton}
            {tab === "source" || tab === "history" || tab === "preview" ? null : (
              <>
                <button
                  type="button"
                  onClick={goPreview}
                  disabled={!preview.canOpen}
                  data-testid="project-preview-open"
                  className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
                >
                  {preview.opening
                    ? "正在授权…"
                    : preview.entryUrl
                      ? "刷新预览"
                      : "打开预览"}
                </button>
                {canStop ? (
                  <button
                    type="button"
                    disabled={stopBusy || descriptor?.status === "stopping"}
                    onClick={() => void stopRuntime()}
                    className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
                  >
                    {stopBusy ? "正在请求停止…" : "停止应用"}
                  </button>
                ) : null}
                <StudioShareToggle
                  sessionId={sessionId}
                  running={isRunning}
                />
              </>
            )}
            {chromeSlot}
          </div>
        </div>
      ) : (
      <div className={CHROME_GRID}>
        <div className="flex items-center gap-1.5 justify-self-start">
          <ComputerModeSelect
            tab={tab}
            hasSession={false}
            onPick={pinView}
          />
          {tab === "preview" && !officeFile ? (
            <PreviewDeviceChrome
              viewId={previewView.id}
              scale={previewScale}
              onChange={changePreviewView}
            />
          ) : null}
        </div>
        {tab === "preview" ? (
          <div className="flex min-w-0 justify-center overflow-hidden">
            <PreviewAddressBar
              entryUrl={officeFile ? null : preview.entryUrl}
              canReload={
                officeFile
                  ? false
                  : preview.entryUrl
                    ? preview.canOpen
                    : canWake
              }
              onReload={reloadPreview}
              onOpenExternal={() => void preview.openExternal()}
            />
          </div>
        ) : (
          <span className="min-w-0" />
        )}
        <div className="flex items-center justify-end justify-self-end gap-1">
          {previewPickButton}
          <button
            type="button"
            onClick={() => void preview.refresh()}
            disabled={preview.loading}
            className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
          >
            更新状态
          </button>
          <button
            type="button"
            onClick={() => void preview.open()}
            disabled={!preview.canOpen}
            data-testid="project-preview-open"
            className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
          >
            {preview.opening
              ? "正在授权…"
              : preview.entryUrl
                ? "刷新预览"
                : "打开预览"}
          </button>
          {preview.snapshot?.operationId &&
          descriptor &&
          !["stopped", "expired", "failed"].includes(descriptor.status) ? (
            <button
              type="button"
              disabled={stopBusy || descriptor.status === "stopping"}
              onClick={() => void stopRuntime()}
              className="flex h-7 items-center rounded-md px-2 text-[12px] text-[#3c3c3c] hover:bg-[#f4f4f5] disabled:opacity-40"
            >
              {stopBusy ? "正在请求停止…" : "停止应用"}
            </button>
          ) : null}
        </div>
      </div>
      )}
      {tab === "computer" && turns ? null : stopError ? (
        <p role="alert" className="px-4 py-2 text-xs text-amber-800">
          {stopError}
        </p>
      ) : null}
      {/* 告警条只留给占位区说的是另一件事的时候（版本钉住对不上）。
          未启动 / 通道未建写在空态，不再叠一条黄条。 */}
      {!(tab === "computer" && turns) &&
      mismatch &&
      !preview.loading &&
      !preview.error &&
      blockedReason ? (
        <div
          role="status"
          data-testid="project-preview-blocked-reason"
          className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
        >
          <p className="font-semibold">工程预览当前不可用</p>
          <p className="mt-1 leading-5">{blockedReason}</p>
        </div>
      ) : null}
      {tab === "computer" && activityRows.length === 0 ? (
        <div
          className="flex min-h-0 flex-1 items-center justify-center p-8"
          data-testid="project-computer-empty"
        >
          <p className="max-w-md text-center text-sm leading-6 text-stone-500">
            {awaitingProject
              ? projectCreateError ||
                "计划已批准，正在创建工程。命令会写在这里。"
              : "还没有工程动作。模型开始干活之后，这里会显示它正在跑的命令。"}
          </p>
        </div>
      ) : null}
      {/* ⚠ 2026-09-18：终端面不许随切档卸掉。卸了再挂会把 xterm 拆掉、
          重新订 /events，内容闪一串旧命令。预览面已经是 hidden 保活，
          终端必须同一条。没点左栏时只订当前最新在跑的那条。 */}
      {turns && activityRows.length > 0 ? (
        <div
          data-testid="project-computer-stage"
          data-active={tab === "computer" ? "true" : "false"}
          className={
            tab === "computer"
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "hidden"
          }
        >
          <ProjectComputerPanel
            turns={turns}
            embedded
            focusId={focusId}
            runtimeOperationId={preview.snapshot?.operationId}
            className="min-h-0 flex-1"
          />
          <ComputerReplayDock rows={activityRows} focusId={focusId} />
        </div>
      ) : null}
      {tab === "source" && !projectId ? (
        <div
          className="flex min-h-0 flex-1 items-center justify-center p-8"
          data-testid="project-source-waiting"
        >
          <p className="max-w-md text-center text-sm leading-6 text-stone-500">
            {projectCreateError ||
              "计划已批准，正在创建工程。源码会出现在这里。"}
          </p>
        </div>
      ) : null}
      {/* ⚠ 挂面板不能只听 workspaceOpened。真机那张白纸：tab 已经是
          source、projectId 也有了，换 id 把 opened 扳回 false，首屏
          在 effect 跑完前（以及 [tab] 不重跑之后）什么都不画。
          人正在看代码/版本档、有工程，就必须挂；opened 只负责切走
          预览时把草稿藏着不卸。 */}
      {(workspaceOpened || tab === "source" || tab === "history") &&
      projectId ? (
        <div
          className={
            tab === "preview" ||
            tab === "data" ||
            tab === "delivery" ||
            tab === "computer"
              ? "hidden"
              : "flex min-h-0 flex-1 flex-col"
          }
        >
          <ProjectWorkspacePanel
            projectId={projectId}
            projectRevision={projectRevision}
            revisionMode={revisionMode}
            tab={tab === "history" ? "history" : "source"}
            selection={selection}
            followPath={manualSelect ? null : followPath}
            onChanged={() => void preview.refresh()}
          />
        </div>
      ) : null}
      {tab === "data" && projectId ? (
        <ProjectDataPanel
          projectId={projectId}
          runtimeStopped={Boolean(
            !preview.loading &&
            !preview.error &&
            (!descriptor || descriptor.status === "stopped")
          )}
        />
      ) : null}
      {tab === "delivery" && projectId && !officeFile ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ProjectVerificationPanel
            projectId={projectId}
            revision={
              revisionMode === "current"
                ? descriptor?.revision
                : (projectRevision ?? descriptor?.revision)
            }
            runtimeOperationId={preview.snapshot?.operationId}
            runtimeId={descriptor?.runtimeId}
            suiteVersion={descriptor?.capabilities
              ?.find(capability => capability.startsWith("verification:"))
              ?.slice("verification:".length)}
            ready={Boolean(
              !preview.error &&
              !preview.loading &&
              !mismatch &&
              descriptor?.status === "ready"
            )}
          />
          <ProjectDeliveryPanel projectId={projectId} />
        </div>
      ) : null}
      <div
        className={
          tab === "preview"
            ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            : "hidden"
        }
      >
        {/* ⚠ 2026-09-16：iframe 自己身上不许写 transform——点按会错位。
            以前能点，是因为框铺满、没有缩放。16:9 要缩，祖先 `scale()`
            只对 HTML 舞台的 srcdoc 同源框有效；工程预览票跨源，
            Chromium 命中盒还按 1920 算。zoom 写在 iframe 上，布局盒
            和看见的盒子才是同一份。pointer-events-auto 仍钉着。 */}
        {previewStage === "page" && presentedPath && projectId ? (
          <PresentedSourcePage projectId={projectId} path={presentedPath} />
        ) : previewStage === "file" && presentedOfficePath && projectId ? (
          <PresentedOfficeFile projectId={projectId} path={presentedOfficePath} />
        ) : previewStage === "idle" ? (
          <div
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
            data-testid="office-preview-idle"
          >
            <p className="m-0 text-sm text-[#3c3c3c]">预览还没打开</p>
            <p className="m-0 text-xs text-[#8a8a8a]">控制面还没有点名要打开的文件。</p>
          </div>
        ) : (
        <ScaledStageFrame
          viewport={previewView.viewport}
          scale={previewScale}
          canvasRef={previewFitRef}
          framed={previewView.framed}
          frame={previewView.frame ?? undefined}
          canvasTestId="project-preview-canvas"
          hitFit="zoom"
        >
          {preview.entryUrl ? (
            <>
              <iframe
                ref={frame}
                title={`${appTitle} · 运行页面`}
                src={frameSrc ?? preview.entryUrl}
                data-testid="project-preview-frame"
                tabIndex={-1}
                onLoad={() => {
                  // ⚠ 2026-09-20：entryUrl / frameSrc 在契约里都是 string | null，
                  //   ed38b9bf 直接把它们喂给要 string 的 previewFrameAfterLoad，
                  //   tsc 两条 TS2322。顺带一个真 bug：src 两个都为 null 时
                  //   React 省略属性，iframe 加载 about:blank 照样触发 onLoad，
                  //   原来的写法会把那一发当成"预览就绪"。没有入口地址就直接返回。
                  if (!preview.entryUrl) return;
                  const loadedSrc =
                    frame.current?.getAttribute("src") ||
                    frameSrc ||
                    preview.entryUrl;
                  const next = previewFrameAfterLoad({
                    entryUrl: preview.entryUrl,
                    loadedSrc,
                  });
                  if (next.nextSrc !== loadedSrc) {
                    setFrameSrc(next.nextSrc);
                    return;
                  }
                  if (next.ready) setFrameReady(true);
                }}
                onPointerDown={() => {
                  frame.current?.focus();
                  presence.nudge();
                }}
                style={{
                  width: previewView.viewport.w,
                  height: previewView.viewport.h,
                  zoom: previewScale,
                }}
                className="block border-0 bg-white pointer-events-auto [touch-action:manipulation]"
                sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-downloads"
                referrerPolicy="no-referrer"
              />
              {previewFrameCovered({
                entryUrl: preview.entryUrl,
                frameReady,
              }) ? (
                <div className="absolute inset-0 z-[1] flex min-h-0 flex-col">
                  <PreviewPausedFace
                    testid="project-preview-frame-loading"
                    title="正在打开预览…"
                    detail={null}
                    waking
                    disabled
                    onWake={() => {}}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <PreviewPausedFace
              title={pausedTitle}
              detail={pausedDetail}
              waking={waking}
              disabled={!canWake}
              alert={Boolean(previewError)}
              onWake={wakePreview}
            />
          )}
        </ScaledStageFrame>
        )}
        {officeFile && projectId ? (
          <OfficeArtifactPane projectId={projectId} filesOnly />
        ) : null}
      </div>
    </section>
  );
}
