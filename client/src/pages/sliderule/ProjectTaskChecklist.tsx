/**
 * ProjectTaskChecklist — 工程动作流（原「固定六行清单」）。
 *
 * ## 2026-09-13 改了什么，为什么
 *
 * 原来这里写死一份六行清单（创建工程 / 写入源码 / 运行命令 / 启动预览 /
 * 浏览器检查 / 确认交付），用 `Map<capabilityId, status>` 归并。固定模板下
 * 够用，但有两个硬伤：
 *
 *   · 模板之外的动作（restore / export / read …）**一行都不显示**，而
 *     §27 第 3 项下一步就是「固定模板之外的增量需求」
 *   · 同一工具跑多次会被折成一行，只留最后一次——连跑三次 patch、中间
 *     那次失败了，界面上一点痕迹都没有
 *
 * 现在行从真实动作长出来（见 `project-activity.ts` 头注）。分母是**真实
 * 发生的动作数**，不是写死的 6。
 *
 * ⚠ 原来那三条诚实性质一条没丢，判据钉着：没事件不造清单、只有
 *   `completed` 才算完成、失败要留在台面上。
 *
 * ⚠ 2026-09-14：行是按钮。点一下通过 `sliderule:inspect-action` 让右侧
 *   打开对应档（见 `computerViewForAction`）。只画勾不让点，就是 Manus
 *   左栏那列工具行和右边电脑对不上的那条缝。
 */

import React from "react";
import {
  Check,
  FilePen,
  FolderPlus,
  Globe,
  LoaderCircle,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import {
  deriveProjectActivity,
  followProjectActionId,
  projectActivityProgress,
  type ProjectActionRow,
  type ProjectActionStatus,
} from "./project-activity";
import {
  dispatchInspectAction,
  FOLLOW_COMPUTER_EVENT,
  INSPECT_ACTION_EVENT,
  inspectActionDetail,
} from "./project-computer-view";
import {
  isExpandableCommandRow,
  timelineRowTitle,
  toolFamily,
} from "./session-story";
import type { UiTurn } from "./types";

export type { ProjectActionRow, ProjectActionStatus };

function StatusIcon({ status }: { status: ProjectActionStatus }) {
  if (status === "done")
    return <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
  if (status === "failed")
    return <X className="h-3.5 w-3.5 text-rose-600" aria-hidden />;
  return (
    <LoaderCircle
      className="h-3.5 w-3.5 animate-spin text-blue-600"
      aria-hidden
    />
  );
}

function FamilyIcon({ tool }: { tool: string }) {
  const family = toolFamily(tool);
  const cls = "h-3.5 w-3.5 shrink-0 text-[#8a8a8a]";
  if (family === "create") return <FolderPlus className={cls} aria-hidden />;
  if (family === "file") return <FilePen className={cls} aria-hidden />;
  if (family === "shell") return <Terminal className={cls} aria-hidden />;
  if (family === "preview") return <Globe className={cls} aria-hidden />;
  if (family === "skill") return <Sparkles className={cls} aria-hidden />;
  return <Wrench className={cls} aria-hidden />;
}

/** 左栏和章节组共用：点一下发出 inspect，右侧跟档。 */
export function useSelectedProjectActionId(): string | null {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const onInspect = (event: Event) => {
      const detail = inspectActionDetail((event as CustomEvent).detail);
      if (detail) setSelectedId(detail.id);
    };
    const onFollow = () => setSelectedId(null);
    window.addEventListener(INSPECT_ACTION_EVENT, onInspect);
    window.addEventListener(FOLLOW_COMPUTER_EVENT, onFollow);
    return () => {
      window.removeEventListener(INSPECT_ACTION_EVENT, onInspect);
      window.removeEventListener(FOLLOW_COMPUTER_EVENT, onFollow);
    };
  }, []);
  return selectedId;
}

export function ProjectActionRowView({
  row,
  selected,
  variant = "flat",
}: {
  row: ProjectActionRow;
  selected: boolean;
  variant?: "flat" | "timeline";
}) {
  const timeline = variant === "timeline";
  const title = timeline ? timelineRowTitle(row) : row.label;
  const expandable = timeline && isExpandableCommandRow(row);
  const showInlineDetail =
    Boolean(row.detail) &&
    !expandable &&
    !(timeline && (toolFamily(row.tool) === "skill" || toolFamily(row.tool) === "preview"));

  return (
    <div className="min-w-0">
      <button
        type="button"
        data-testid="project-task-row"
        data-status={row.status}
        data-task-id={row.tool}
        data-family={timeline ? toolFamily(row.tool) : undefined}
        data-selected={selected ? "true" : "false"}
        aria-pressed={selected}
        onClick={() => dispatchInspectAction({ id: row.id, tool: row.tool })}
        className={`flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition ${
          selected
            ? "bg-stone-100 text-stone-900"
            : "text-stone-700 hover:bg-stone-50"
        }`}
      >
        <span className="mt-[3px] shrink-0">
          {timeline ? <FamilyIcon tool={row.tool} /> : <StatusIcon status={row.status} />}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={row.status === "failed" ? "text-rose-700" : undefined}
          >
            {title}
          </span>
          {showInlineDetail ? (
            <span
              className="ml-1.5 break-all text-stone-400"
              data-testid="project-task-detail"
            >
              {row.detail}
            </span>
          ) : null}
        </span>
        {row.status === "running" && !timeline ? (
          <span className="ml-auto shrink-0 text-[11px] text-blue-600">
            进行中
          </span>
        ) : null}
      </button>
      {expandable ? (
        <details
          data-testid="session-story-command"
          className="ml-7 mt-0.5 text-[12px] text-[#6b6b6b]"
        >
          <summary className="cursor-pointer select-none text-[#8a8a8a]">
            命令
          </summary>
          <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-[#555]">
            {row.detail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function ProjectTaskChecklist({ turns }: { turns: UiTurn[] }) {
  const rows = React.useMemo(() => deriveProjectActivity(turns), [turns]);
  const inspectId = useSelectedProjectActionId();
  const selectedId = followProjectActionId(rows, inspectId);
  if (rows.length === 0) return null;
  const { done, total, failed } = projectActivityProgress(rows);
  return (
    <section
      className="mb-2"
      data-testid="project-task-checklist"
      aria-label="工程动作"
    >
      {/* ⚠ 2026-09-14：对照 Manus 左栏——工具行是对话里的一列勾，
          不是一张「工程动作」卡片。卡片边框把散文和动作割开，
          整栏看起来像项目看板而不是对话。计数仍在，只是压成一行小字。 */}
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-stone-400">
        <span data-testid="project-task-count" className="tabular-nums">
          {done} / {total}
          {failed > 0 ? (
            <span className="ml-1 text-rose-600">· {failed} 失败</span>
          ) : null}
        </span>
      </div>
      <ol className="space-y-0.5">
        {rows.map(row => (
          <li key={row.id}>
            <ProjectActionRowView
              row={row}
              selected={selectedId === row.id}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
