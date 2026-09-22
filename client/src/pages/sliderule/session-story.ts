/**
 * session-story — 一轮工程对话的章节消费。
 *
 * ## 修的是什么（2026-09-15，对照 Manus TicketStream 完成态六张图）
 *
 * 差的不是零件，是编排。Manus 一轮是一篇能折起来的故事：
 *
 *     工作了 3m 57s → 我准备怎么做 → 「构建网页」→ 工具组 →
 *     「编辑了 4 个文件 · 已运行 1 个命令」→ 「TicketStream 已完成」
 *     → 结果卡贴在过程后面
 *
 * ⚠ 2026-09-20 番茄钟真机 sr-20260919232309-4FHP30DQPZ：第一版在
 *   `project_create` 完成后立刻 emit 一块 product。消费侧把
 *   TurnResultCard（标题=用户原话，「未发布·12m」「任务已完成」）
 *   塞进「创建工程 · 读取工程」和下一段开口之间。人圈出来位置不对——
 *   这张卡是收尾锚点，不是「工程出现了」。活页 DOM kids[2] 就是那张卡，
 *   后面还有二十多段开口/工具。章节块不再 emit product。
 *
 * 我们 `ImAssistantMessage` 按 kind 分桶：所有开口散文一把倒，
 * 再铺扁平 `project_*` 勾，再挂结果卡。`UiTurn.steps` 里没有 chapter，
 * 消费侧也不按「这一段工作」切。
 *
 * 更贵的是历史：`showProjectChecklist` 只挂 `latestTurn`，往上滚过程没了。
 * Manus 章节还在。
 *
 * ## 这里只做消费，不改控制面协议
 *
 * 步骤仍是扁的 `model_speech` / `chip`。章节是消费侧按发生顺序切出来的：
 * 开口把工具组切开；一组里的行仍按 `applyProjectChip` 配对——
 * **不许再 Map 按工具名归并**。三次 patch 中间那次失败必须还在组里，
 * 点得开。Manus 的「编辑了 4 个文件」是折起来的外观，不是把四次盖成一次。
 *
 * 判断全是纯函数。组件只负责折和画。
 *
 * ## 2026-09-15 第二刀：开源标准答案在哪
 *
 * GitHub 上这块没有「Manus 官方实现」，有的是三条已经写进文档的消费策略：
 *
 *   · assistant-ui `GroupedParts` / ToolGroup / Reasoning
 *     https://www.assistant-ui.com/docs/ui/tool-group
 *     https://www.assistant-ui.com/docs/guides/chain-of-thought
 *   · Vercel AI Elements Reasoning（流式撑开、结束收起、人手锁定）
 *   · OpenHands EventGroup（进行中看当前动作 + n/total，收尾才写摘要）
 *
 * 本仓已经依赖 `@assistant-ui/react`，但对话正文走的是 `UiTurn.steps`，
 * 不是 assistant-ui 的 `tool-call` parts。把整页改接到
 * `MessagePrimitive.GroupedParts` 是换插座，不是优化这一版。
 * 这里只把那三条策略抄进纯函数，消费面继续吃 steps。
 */

import { isOfficeFileDeliverable } from "./deliverable-kind";
import {
  isChecklistSnapshot,
  isUserFacingSpeech,
} from "./model-speech";
import {
  applyProjectChip,
  projectActivityProgress,
  type ProjectActionRow,
} from "./project-activity";
import { workedLabel } from "./turn-result-card";
import type { TurnStep, UiTurn } from "./types";

export type SessionStorySpeech = {
  kind: "speech";
  id: string;
  text: string;
};

export type SessionStoryTools = {
  kind: "tools";
  id: string;
  chapter: string;
  /** 跟上组同一章就不重复画标题。 */
  showChapter: boolean;
  summary: string;
  rows: ProjectActionRow[];
};

export type SessionStoryProduct = {
  kind: "product";
  id: string;
};

export type SessionStoryBlock =
  | SessionStorySpeech
  | SessionStoryTools
  | SessionStoryProduct;

const FILE_TOOLS = new Set([
  "project_patch",
  "project_write",
  "project_str_replace",
  "file_write",
  "file_str_replace",
  "write_file",
  "search_replace",
]);
const EXEC_TOOLS = new Set(["project_exec", "shell_exec", "bash"]);
const READ_TOOLS = new Set([
  "project_list",
  "project_search",
  "project_read",
  "file_read",
  "file_find_in_content",
  "file_find_by_name",
  "read_file",
  "grep",
  "list_dir",
  "glob",
]);
const CREATE_TOOLS = new Set(["project_create"]);
const PREVIEW_TOOLS = new Set([
  "project_start",
  "project_verify",
  "browser_navigate",
  "browser_restart",
  "deploy_expose_port",
]);
const COUNTED_TOOLS = new Set([
  ...FILE_TOOLS,
  ...EXEC_TOOLS,
  ...READ_TOOLS,
  ...CREATE_TOOLS,
  ...PREVIEW_TOOLS,
]);

export type ToolFamily =
  | "create"
  | "file"
  | "shell"
  | "preview"
  | "skill"
  | "unknown";

/** 时间线图标按家族分，未知工具仍有行。 */
export function toolFamily(tool: string): ToolFamily {
  const name = String(tool || "").trim();
  if (name === "skill") return "skill";
  if (CREATE_TOOLS.has(name)) return "create";
  if (FILE_TOOLS.has(name) || READ_TOOLS.has(name)) return "file";
  if (
    EXEC_TOOLS.has(name) ||
    name.startsWith("shell_") ||
    name === "bash"
  ) {
    return "shell";
  }
  if (
    PREVIEW_TOOLS.has(name) ||
    name.startsWith("browser_") ||
    name === "make_manus_page" ||
    name.startsWith("deploy_")
  ) {
    return "preview";
  }
  return "unknown";
}

/** shell 命令原文收进可展开条，不摊在行上。 */
export function isExpandableCommandRow(row: ProjectActionRow): boolean {
  return toolFamily(row.tool) === "shell" && Boolean(String(row.detail || "").trim());
}

/** 预览/浏览器步骤脸上写「预览页面」，细节另挂。 */
export function timelineRowTitle(row: ProjectActionRow): string {
  const family = toolFamily(row.tool);
  if (family === "preview") return "预览页面";
  if (family === "skill") {
    const name = String(row.detail || "").trim();
    return name ? `加载技能 ${name}` : "加载技能";
  }
  return row.label;
}

/**
 * 进行中脸上的阶段。收尾仍走 `toolGroupSummary`，这里只改还在跑的那一句。
 */
export function liveStageTitle(row: ProjectActionRow): string {
  const family = toolFamily(row.tool);
  const name = String(row.detail || "").trim();
  if (family === "skill") {
    return name ? `正在加载技能 ${name}` : "正在加载技能";
  }
  if (family === "shell") return "正在运行命令";
  if (family === "preview") return "正在打开预览";
  if (family === "create") return "正在创建工程";
  return "";
}

function countWhere(
  rows: readonly ProjectActionRow[],
  tools: ReadonlySet<string>
): number {
  return rows.filter(row => tools.has(row.tool)).length;
}

/**
 * 一组工具折起来时脸上写什么。认工具名，不解析 label。
 *
 * 未知的 `project_*` 也要出现——模板之外的动作不许静静消失。
 */
export function toolGroupSummary(rows: readonly ProjectActionRow[]): string {
  if (!rows.length) return "";
  const parts: string[] = [];
  if (countWhere(rows, CREATE_TOOLS)) parts.push("创建工程");
  const files = countWhere(rows, FILE_TOOLS);
  if (files) parts.push(`编辑了 ${files} 个文件`);
  const cmds = countWhere(rows, EXEC_TOOLS);
  if (cmds) parts.push(`已运行 ${cmds} 个命令`);
  const reads = countWhere(rows, READ_TOOLS);
  if (reads === 1) parts.push("读取工程");
  else if (reads > 1) parts.push(`读取 ${reads} 次`);
  const previews = countWhere(rows, PREVIEW_TOOLS);
  if (previews === 1) parts.push("预览检查");
  else if (previews > 1) parts.push(`预览检查 ${previews} 次`);

  const extra = new Map<string, number>();
  for (const row of rows) {
    if (COUNTED_TOOLS.has(row.tool)) continue;
    extra.set(row.label, (extra.get(row.label) ?? 0) + 1);
  }
  for (const [label, count] of extra) {
    parts.push(count === 1 ? label : `${label} ${count} 次`);
  }
  return parts.join(" · ") || `${rows.length} 步`;
}

/**
 * 这一组算哪一章。没有后端 chapter，就从工具家族推。
 *
 * 工程档做出来的是网页工作台，所以构建/预览跟 Manus 那两章对齐。
 * 回滚单独成章——把它算进「构建」会把一次 restore 说成还在搭。
 */
export function chapterTitleForRows(
  rows: readonly ProjectActionRow[],
  deliverableKind?: string
): string {
  const tools = rows.map(row => row.tool);
  const restored = tools.some(tool => tool === "project_restore");
  const browsing = tools.some(
    tool =>
      tool === "project_start" ||
      tool === "project_verify" ||
      tool === "project_status" ||
      tool === "browser_view" ||
      tool === "browser_navigate" ||
      tool === "browser_restart" ||
      tool === "deploy_expose_port"
  );
  const building = tools.some(
    tool =>
      tool === "project_create" ||
      tool === "project_patch" ||
      tool === "project_write" ||
      tool === "project_str_replace" ||
      tool === "file_write" ||
      tool === "file_str_replace" ||
      tool === "write_file" ||
      tool === "search_replace" ||
      tool === "read_file" ||
      tool === "grep" ||
      tool === "list_dir" ||
      tool === "glob" ||
      tool === "bash" ||
      tool === "file_read" ||
      tool === "file_find_in_content" ||
      tool === "file_find_by_name" ||
      tool === "project_exec" ||
      tool === "shell_exec" ||
      tool === "project_list" ||
      tool === "project_read" ||
      tool === "project_search"
  );
  if (restored && !building) return "回滚";
  if (isOfficeFileDeliverable(deliverableKind)) {
    if (browsing && !building) return "查看文件";
    if (building) return "制作文件";
    return "";
  }
  if (browsing && !building) return "预览网页";
  if (building) return "构建网页";
  return "";
}

/**
 * 完成轮开头那句「工作了 2m 45s」。还在跑、或拿不到用时 → null，不编。
 *
 * 复用 `workedLabel`，不另抄一份格式——那是 §4 的成对物。
 */
export function sessionStoryDuration(
  turn: UiTurn | null | undefined
): string | null {
  if (!turn || turn.status === "streaming") return null;
  return workedLabel(turn.durationMs);
}

function isStorySpeech(
  step: TurnStep,
  userText?: string
): step is Extract<TurnStep, { kind: "model_speech" }> {
  return (
    step.kind === "model_speech" &&
    isUserFacingSpeech(step.text, userText) &&
    !isChecklistSnapshot(step.text)
  );
}

/**
 * 把一轮的 steps 编成章节块。只看这一轮，不把历史轮次的动作摊进来。
 *
 * ⚠ 开口按发生位置切开工具组。把所有 speech 先倒出来再倒 chip，
 *   中间那句「接着改筛选」会跑到第一组工具前面——正是三桶并排的病。
 */
export function deriveSessionStory(
  turn: UiTurn | null | undefined,
  options?: { deliverableKind?: string }
): SessionStoryBlock[] {
  const steps = turn?.steps;
  if (!Array.isArray(steps)) return [];

  const blocks: SessionStoryBlock[] = [];
  const allRows: ProjectActionRow[] = [];
  let current: ProjectActionRow[] = [];
  let lastChapter = "";

  const flushTools = () => {
    if (!current.length) return;
    const rows = current;
    current = [];
    const chapter = chapterTitleForRows(rows, options?.deliverableKind);
    const showChapter = Boolean(chapter && chapter !== lastChapter);
    if (chapter) lastChapter = chapter;
    blocks.push({
      kind: "tools",
      id: `tools:${rows[0].id}`,
      chapter,
      showChapter,
      summary: toolGroupSummary(rows),
      rows,
    });
  };

  for (const step of steps) {
    if (isStorySpeech(step, turn?.user)) {
      flushTools();
      const last = blocks[blocks.length - 1];
      if (
        last?.kind === "speech" &&
        last.text.trim() === step.text.trim()
      ) {
        continue;
      }
      blocks.push({ kind: "speech", id: step.id, text: step.text });
      continue;
    }

    const created = applyProjectChip(allRows, step);
    if (created) current.push(created);
  }
  flushTools();
  return blocks;
}

export function sessionStoryHasProcess(
  blocks: readonly SessionStoryBlock[]
): boolean {
  return blocks.some(block => block.kind === "speech" || block.kind === "tools");
}

/** 折起来时脸上那句，避免刷新后只剩「工作了 2m」像步骤丢了。 */
export function sessionStoryCollapsedHint(
  blocks: readonly SessionStoryBlock[]
): string {
  return blocks
    .filter((block): block is SessionStoryTools => block.kind === "tools")
    .map(block => block.summary)
    .filter(Boolean)
    .join(" · ");
}

/**
 * 折叠件开不开。抄 assistant-ui Reasoning / Vercel AI Elements：
 *
 *   · 还在流 → 撑开（人要看见它在干什么）
 *   · 流停了 → 回到 defaultOpen（默认关，对照 Manus 完成态）
 *   · 人手点过一次 → 永远听人的，流停了也不许抢回去
 *
 * ⚠ 不把这个写成 `useState(!streaming)`。流式切完成时 state 不会重初始化，
 *   过程会停在撑开——正是 2026-09-15 第一版完成轮摊开的原因。
 *   判据必须直接跑这个函数，组件只消费返回值。
 */
export function disclosureOpen(input: {
  streaming: boolean;
  defaultOpen?: boolean;
  userOpen: boolean | null;
}): boolean {
  if (input.userOpen !== null) return input.userOpen;
  if (input.streaming) return true;
  return Boolean(input.defaultOpen);
}

export type ToolGroupFace = {
  title: string;
  meta: string;
  running: boolean;
};

/**
 * 一组工具脸上写什么。抄 OpenHands EventGroup + assistant-ui 静态 ToolGroup：
 *
 *   进行中、还是这一轮的尾巴 → 当前这一步的人话 + `已结/总数`
 *   已经翻篇 / 整轮完成 → 收尾摘要（「编辑了 3 个文件」）
 *
 * 失败数仍单独给，不许被摘要盖掉。
 */
export function latestToolRowTitle(rows: readonly ProjectActionRow[]): string {
  if (!rows.length) return "";
  const live =
    rows.find(row => row.status === "running") ?? rows[rows.length - 1];
  const detail = String(live.detail || "").trim();
  if (detail && detail.length <= 48) return `${live.label} ${detail}`;
  return live.label;
}

export function toolGroupFace(
  rows: readonly ProjectActionRow[],
  opts: { finalized?: boolean } = {}
): ToolGroupFace {
  const { done, total, failed } = projectActivityProgress(
    rows as ProjectActionRow[]
  );
  const running = rows.some(row => row.status === "running");
  const live = running && !opts.finalized;
  if (live) {
    const current =
      rows.find(row => row.status === "running") ?? rows[rows.length - 1];
    const staged = current ? liveStageTitle(current) : "";
    return {
      title: staged || latestToolRowTitle(rows),
      meta: `${done + failed}/${total}`,
      running: true,
    };
  }
  return {
    title: toolGroupSummary(rows),
    meta: failed > 0 ? `${failed} 失败` : "",
    running: false,
  };
}
