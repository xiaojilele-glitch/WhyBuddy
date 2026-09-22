/**
 * 左栏活动行。对照 Cursor Agent 的视觉语法，不拉 Cursor 仓。
 *
 * Cursor 这块不是「日志 + JSON 墙」，是整齐的一行动作：
 *   状态图标 · 短动词 · 次要目标 · 右边极淡的数字
 * 2026-08-18 真机：旧左栏把「推演过程 · 6 阶段 · 54 步」配 Brain
 * 竖线，再把「⚙ 数据模型 系统画面生成中...」原文铺下去，看起来无规则。
 */

import type { TurnPhase } from "./derive-turn-phases";

export type ActivityStatus = "running" | "done" | "failed" | "pending";

export type StageAuthority = "agent" | "recipe" | "gate";

export type ActivityRowModel = {
  id: string;
  status: ActivityStatus;
  verb: string;
  target?: string;
  meta?: string;
  authority?: StageAuthority;
  stageId?: string;
};

export type ActivityGroup = {
  id: string;
  title: string;
  status: "running" | "done";
  rows: ActivityRowModel[];
  authority?: StageAuthority;
  badge?: string;
};

const DECOR_PREFIX = /^[🖋⚙✓✗⚡]\s*/;

function stripDecor(text: string): string {
  return text.replace(DECOR_PREFIX, "").replace(/^⚡\s*/, "").trim();
}

export function compactVerb(text: string): string {
  const t = stripDecor(text)
    .replace(/^LLM\s*/, "")
    .replace(/^正在/, "")
    .replace(/（实时输出见下方）/, "")
    .replace(/\.\.\.$/, "")
    .trim();
  if (t.length > 24) return `${t.slice(0, 23)}…`;
  return t;
}

export function formatCharMeta(chars: number): string {
  return `${chars} 字`;
}

export function parseActivityLine(
  text: string
): Omit<ActivityRowModel, "id"> {
  const raw = text.trim();
  let status: ActivityStatus = "done";
  if (
    raw.startsWith("✗") ||
    raw.includes("证据缺失") ||
    raw.includes("失败") ||
    /^\s*blocked\b/i.test(raw)
  ) {
    status = "failed";
  } else if (
    raw.startsWith("⚙") ||
    raw.startsWith("🖋") ||
    raw.includes("生成中") ||
    raw.includes("正在")
  ) {
    status = "running";
  }

  const cleaned = stripDecor(raw)
    .replace(/（实时输出见下方）/, "")
    .replace(/\.\.\.$/, "")
    .trim();

  const round = cleaned.match(/^第 (\d+) 轮\s*·\s*(.+)$/);
  if (round) {
    return {
      status,
      verb: compactVerb(round[2]),
      target: `第 ${round[1]} 轮`,
    };
  }

  const generating = cleaned.match(/^(.+?)\s+系统画面生成中/);
  if (generating) {
    return {
      status: status === "failed" ? "failed" : "running",
      verb: "生成画面",
      target: generating[1],
    };
  }

  const landed = cleaned.match(/^(.+?)\s+证据落地(?:\s*·\s*(.+))?/);
  if (landed) {
    return {
      status: "done",
      verb: "落地",
      target: landed[1],
      meta: landed[2]?.trim() || undefined,
    };
  }

  const missing = cleaned.match(/^(.+?)\s+证据缺失/);
  if (missing) {
    return { status: "failed", verb: "缺失", target: missing[1] };
  }

  const draft = cleaned.match(
    /^最新定义：(.+?)\s*·\s*已产出\s*(\d+)\s*字符/
  );
  if (draft) {
    return {
      status,
      verb: "起草",
      target: draft[1],
      meta: formatCharMeta(Number(draft[2])),
    };
  }

  const closure = cleaned.match(/^(closed|blocked)\s+(\d+\/\d+)/i);
  if (closure) {
    return {
      status: closure[1].toLowerCase() === "blocked" ? "failed" : "done",
      verb: closure[1].toLowerCase() === "blocked" ? "拦截" : "闭环",
      meta: closure[2],
    };
  }

  if (
    cleaned.startsWith("指令已接收") ||
    cleaned.startsWith("上一话题已闭环") ||
    cleaned.startsWith("本话题已闭环")
  ) {
    return { status: "done", verb: "接收意图" };
  }

  const chars = cleaned.match(/^(.+?)\s*·\s*(\d+)\s*字符/);
  if (chars) {
    return {
      status,
      verb: compactVerb(chars[1]),
      meta: formatCharMeta(Number(chars[2])),
    };
  }

  return { status, verb: compactVerb(cleaned) };
}

export function groupsFromPhases(phases: TurnPhase[]): ActivityGroup[] {
  return phases.map(phase => ({
    id: phase.id,
    title: phase.title,
    status: phase.status,
    rows: phase.lines.map((line, index) => {
      const parsed = parseActivityLine(line);
      let status = parsed.status;
      if (status !== "failed") {
        if (phase.status === "done") status = "done";
        else if (index === phase.lines.length - 1) status = "running";
        else status = "done";
      }
      return {
        id: `${phase.id}-${index}`,
        ...parsed,
        status,
      };
    }),
  }));
}

/**
 * 收口句。精修有沿用说明时写「改了哪一页」，不用步数吓人。
 * 不再写「推演过程 · N 阶段」——那是旧日志头。
 */
export function turnTimelineHeader(opts: {
  stepCount: number;
  durationMs?: number;
  refineReuseNote?: string;
}): string {
  const sec = opts.durationMs
    ? `${Math.max(1, Math.round(opts.durationMs / 1000))}s`
    : "";
  const note = opts.refineReuseNote?.trim();
  if (note) return sec ? `${note} · ${sec}` : note;
  if (!opts.stepCount) return sec || "0 步";
  return sec ? `${opts.stepCount} 步 · ${sec}` : `${opts.stepCount} 步`;
}
