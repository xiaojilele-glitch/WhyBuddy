/**
 * 左栏活动列表。对照 Cursor Agent：一行一个动作，没有 Brain、没有竖线轴。
 *
 * 2026-08-18 真机：ChainOfThought 把步骤画成「图标 + 原文日志」，
 * 和 LlmLiveOutput 的「标题 · N 字符」各说各话，看起来无规则。
 */
import React from "react";
import { Check, ChevronRight, LoaderCircle, X } from "lucide-react";
import { Shimmer } from "@/components/ai/shimmer";
import type { ActivityGroup, ActivityRowModel, ActivityStatus } from "./activity-rows";

function StatusGlyph({ status }: { status: ActivityStatus }) {
  if (status === "running") {
    return (
      <LoaderCircle
        className="h-3.5 w-3.5 shrink-0 animate-spin text-[#52525b]"
        strokeWidth={1.75}
      />
    );
  }
  if (status === "failed") {
    return <X className="h-3.5 w-3.5 shrink-0 text-rose-500" strokeWidth={1.75} />;
  }
  if (status === "pending") {
    return (
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-[#d4d4d8]"
        aria-hidden
      />
    );
  }
  return (
    <Check className="h-3.5 w-3.5 shrink-0 text-[#a1a1aa]" strokeWidth={1.75} />
  );
}

export function ActivityToggleRow({
  status,
  verb,
  meta,
  open,
  onClick,
  testId,
}: {
  status: ActivityStatus;
  verb: string;
  meta?: string;
  open?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-expanded={open}
      onClick={onClick}
      className="flex h-6 w-full min-w-0 items-center gap-2 rounded-[4px] px-0.5 text-left hover:bg-[#f4f4f5]"
    >
      <StatusGlyph status={status} />
      {status === "running" ? (
        <Shimmer as="span" className="min-w-0 truncate text-[13px] font-normal">
          {verb}
        </Shimmer>
      ) : (
        <span className="min-w-0 truncate text-[13px] text-[#3f3f46]">{verb}</span>
      )}
      {meta ? (
        <span
          className="ml-auto shrink-0 tabular-nums text-[11px] text-[#a1a1aa]"
          data-testid="sliderule-activity-meta"
        >
          {meta}
        </span>
      ) : null}
      {onClick ? (
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-[#a1a1aa] transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
      ) : null}
    </button>
  );
}

export function ActivityRow({
  row,
}: {
  row: ActivityRowModel;
}) {
  return (
    <div
      className="flex h-6 min-w-0 items-center gap-2 px-0.5"
      data-testid="sliderule-activity-row"
      data-status={row.status}
      data-verb={row.verb}
      data-stage-id={row.stageId || ""}
    >
      <StatusGlyph status={row.status} />
      {row.status === "running" ? (
        <Shimmer as="span" className="shrink-0 text-[13px] font-normal">
          {row.verb}
        </Shimmer>
      ) : (
        <span
          className={`shrink-0 text-[13px] ${
            row.status === "pending" ? "text-[#d4d4d8]" : "text-[#3f3f46]"
          }`}
        >
          {row.verb}
        </span>
      )}
      {row.target ? (
        <span className="min-w-0 truncate text-[12px] text-[#a1a1aa]">
          {row.target}
        </span>
      ) : null}
      {row.meta ? (
        <span
          className="ml-auto shrink-0 tabular-nums text-[11px] text-[#a1a1aa]"
          data-testid="sliderule-activity-meta"
        >
          {row.meta}
        </span>
      ) : null}
    </div>
  );
}

export function ActivityList({
  groups,
  streaming,
  header,
  closureMeta,
}: {
  groups: ActivityGroup[];
  streaming: boolean;
  header: string;
  closureMeta?: string | null;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const open = streaming || expanded;

  if (groups.length === 0) return null;

  return (
    <div className="mt-1 w-full min-w-0" data-testid="sliderule-turn-phases">
      {!streaming ? (
        <button
          type="button"
          data-testid="sliderule-turn-steps-toggle"
          aria-expanded={open}
          onClick={() => setExpanded(next => !next)}
          className="flex w-full items-center gap-1.5 py-0.5 text-left text-[13px] text-[#71717a] transition-colors hover:text-[#3f3f46]"
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-[#a1a1aa] transition-transform ${
              open ? "rotate-90" : ""
            }`}
          />
          <span className="min-w-0 truncate">{header}</span>
          {closureMeta ? (
            <span
              className="ml-auto shrink-0 tabular-nums text-[11px] text-[#a1a1aa]"
              data-testid="sliderule-activity-closure"
            >
              {closureMeta}
            </span>
          ) : null}
        </button>
      ) : null}

      {open
        ? groups.map(group => {
            const lines =
              group.authority === "recipe" || group.status !== "running"
                ? group.rows
                : group.rows.slice(-6);
            if (lines.length === 0) return null;
            return (
              <div
                key={group.id}
                className="mt-1.5"
                data-testid={`sliderule-phase-${group.id}`}
                data-authority={group.authority || ""}
              >
                <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-[#a1a1aa]">
                  <span>{group.title}</span>
                  {group.badge ? (
                    <span
                      className="rounded px-1 py-px text-[10px] text-[#71717a] ring-1 ring-[#e4e4e7]"
                      data-testid="sliderule-stage-badge"
                    >
                      {group.badge}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-col">
                  {lines.map(row => (
                    <ActivityRow key={row.id} row={row} />
                  ))}
                </div>
              </div>
            );
          })
        : null}
    </div>
  );
}
