/**
 * project-activity — 工程动作流：**发生了什么就显示什么**。
 *
 * ## 修的是什么（2026-09-13，用户对照 Manus 截图：「页面没跟上」第 3 件）
 *
 * 原来的 `ProjectTaskChecklist` 是一份写死的六行清单：
 *
 *     创建工程 / 写入源码 / 运行命令 / 启动预览 / 浏览器检查 / 确认交付
 *
 * 固定模板下够用，但下一步就是「模板之外的增量需求」（§27 第 3 项）。那时
 * 模型会 restore 一个旧版本、export 一份源码、连跑三次 patch——清单还是那
 * 六行，一个字都说不出来，而且**三次 patch 会被折成一行**（原实现用
 * `Map<capabilityId>`，同一工具后写覆盖先写）。
 *
 * Manus 那边是涌现式的：「编辑了 4 个文件」「修正回复发送状态的 TypeScript
 * 类型: Home.tsx」「运行 TicketStream 类型检查与生产构建」——行从真实动作
 * 长出来，跑了几次就是几行。
 *
 * ## 细节从**结构化字段**来，不从 label 里解析
 *
 * 后端 `yield {"type": "control_tool_result", "tool": name, **body}` 把整个
 * 工具返回体摊进事件，里面有 `command` / `exitCode` / `revision` /
 * `parentRevision` / `errorCode`。前端原来只读 `tool`/`ok`/`error`，其余全扔。
 *
 * ⚠ 不去解析 `label` 里的文字。本仓在「锚点窗口 / 前缀匹配」上栽过多次
 *   （见 `derive-turn-phases` 的 `phaseKeyForStep`、以及 2026-09-05 那条
 *   「往后数 900 个字符」的判据）。文案一改判据就哑，而结构化字段不会。
 *
 * ## 保住原来那三条诚实性质
 *
 *   1. 没有任何工程事件时 → 空数组，不凭空造清单
 *   2. 只有 `completed` 能算「完成」，不因为轮次存在就算
 *   3. 失败要留在台面上，不许被后续动作抹掉
 */

import { isProjectWorkbenchTool } from "@/lib/factory-hops";
import { validSourcePath } from "./project-runtime/preview-selection-bridge";
import type { TurnChipStep, TurnStep, UiTurn } from "./types";

export type ProjectActionStatus = "running" | "done" | "failed";

export type ProjectActionRow = {
  /** 稳定 key：取开启这一行的那个 step id。 */
  id: string;
  tool: string;
  label: string;
  /** 真实细节（命令 / 版本 / 退出码 / 错误码）。没有就没有，不编。 */
  detail?: string;
  /** 远端操作 id；「它的电脑」靠它订阅沙箱命令行输出。没有就订不了，不编。 */
  operationId?: string;
  status: ProjectActionStatus;
};

/** 人话标签。未知的 `project_*` 也要有行——正是「模板之外」要显示的东西。 */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  project_create: "创建工程",
  project_list: "读取工程列表",
  project_search: "搜索源码",
  project_patch: "写入源码",
  project_write: "写入源码",
  project_str_replace: "替换源码",
  file_read: "读取源码",
  file_write: "写入源码",
  file_str_replace: "替换源码",
  file_find_in_content: "搜索源码",
  file_find_by_name: "按名查找源码",
  shell_exec: "运行命令",
  shell_view: "读取运行日志",
  shell_wait: "等待命令",
  shell_write_to_process: "写入进程",
  shell_kill_process: "取消运行",
  browser_view: "查看预览",
  browser_navigate: "打开预览",
  browser_restart: "重启预览",
  browser_click: "点击页面",
  browser_input: "输入页面",
  browser_move_mouse: "移动指针",
  browser_press_key: "按键",
  browser_select_option: "选择选项",
  browser_scroll_up: "向上滚动",
  browser_scroll_down: "向下滚动",
  browser_console_exec: "执行页面脚本",
  browser_console_view: "读取控制台",
  deploy_expose_port: "启动预览",
  deploy_apply_deployment: "公开部署",
  make_manus_page: "展示页面",
  message_notify_user: "通知用户",
  message_ask_user: "询问用户",
  info_search_web: "检索资料",
  idle: "等待用户",
  skill: "加载技能",
  read_file: "读取源码",
  write_file: "写入源码",
  search_replace: "替换源码",
  bash: "运行命令",
  grep: "搜索源码",
  list_dir: "读取工程列表",
  glob: "按名查找源码",
  project_exec: "运行命令",
  project_start: "启动预览",
  project_verify: "浏览器检查",
  project_status: "查看运行状态",
  project_logs: "读取运行日志",
  project_cancel: "取消运行",
  project_read: "读取源码",
  project_revisions: "查看历史版本",
  project_restore: "恢复到历史版本",
  project_export: "导出源码",
  project_verification: "读取验收结果",
  project_delivery: "确认交付",
};

export function projectActionLabel(tool: string): string {
  return TOOL_LABELS[tool] || tool.replace(/^(project_|file_|shell_|browser_|deploy_)/, "");
}

function short(revision: unknown): string {
  const value = String(revision ?? "").trim();
  return value.length > 12 ? value.slice(0, 12) : value;
}

/**
 * 从**真实的工具结果字段**里取一句细节。
 *
 * 顺序即优先级：先说坏消息，再说这次具体干了什么。拿不到就返回空串——
 * 「没有细节」是一个诚实的结果，不许用 kind 之类的内部名凑数。
 */
export function projectActionDetail(
  event: Record<string, unknown> | null | undefined
): string {
  if (!event || typeof event !== "object") return "";
  const text = (key: string): string => {
    const value = event[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const failure = text("error") || text("errorCode") || text("message");
  if (failure) return failure;

  const exit = event.exitCode;
  if (typeof exit === "number" && exit !== 0) return `退出码 ${exit}`;

  const command = text("command");
  if (command) return command.length > 80 ? command.slice(0, 80) + "…" : command;

  // ⚠ 2026-09-19：结果里常有 path / changedFiles，却被后面的
  //   parent→revision 盖掉。代码面跟文件靠这一句，版本号说不出正在改哪份。
  const path = text("path");
  if (validSourcePath(path)) return path;
  const changed = event.changedFiles;
  if (Array.isArray(changed)) {
    const files = changed.filter(
      (item): item is string => typeof item === "string" && validSourcePath(item)
    );
    if (files.length === 1) return files[0];
    if (files.length > 1) {
      const head = files.slice(0, 3).join("、");
      return files.length > 3 ? `${head} 等 ${files.length} 个文件` : head;
    }
  }

  const revision = short(event.revision);
  const parent = short(event.parentRevision);
  if (revision && parent && revision !== parent) return `${parent} → ${revision}`;
  if (revision) return revision;

  return "";
}

function isProjectChip(
  step: TurnStep
): step is Extract<TurnStep, { kind: "chip" }> {
  return (
    step.kind === "chip" &&
    isProjectWorkbenchTool((step as { capabilityId?: string }).capabilityId)
  );
}

/**
 * 吃一枚工程 chip，按顺序配对到 `rows` 上。
 *
 * 新开一行 → 返回那一行（章节消费好把它放进当前组）。
 * 收进已有行 / 不是工程 chip → 返回 null。
 *
 * ⚠ 配对规则跟 `deriveProjectActivity` 是同一份，不许再抄一遍。
 *   会话章节要按开口切开，但三次 patch 中间那次失败仍得是三行。
 */
export function applyProjectChip(
  rows: ProjectActionRow[],
  step: TurnStep
): ProjectActionRow | null {
  if (!isProjectChip(step)) return null;
  const tool = String(step.capabilityId);
  const progress = step.progressType;
  const detail = String(
    (step as { projectDetail?: string }).projectDetail || ""
  ).trim();
  const operationId = String(
    (step as { operationId?: string }).operationId || ""
  ).trim();

  if (progress === "completed" || progress === "failed") {
    // 收尾：优先合进**同一工具最近一个还开着的行**。找不到说明只剩结果
    // （刷新后从持久化恢复的典型形态），那就单独成行——有结果却不显示，
    // 就是「闸全绿但东西没了」的另一种写法。
    const open = [...rows]
      .reverse()
      .find(row => row.tool === tool && row.status === "running");
    if (open) {
      open.status = progress === "failed" ? "failed" : "done";
      // ⚠ 合并规则：**坏消息优先**，其次保留开场那句「对什么动手」。
      //
      //   开场摘要是「src/Home.tsx、src/api/tasks.ts」，结果细节常常是
      //   「rev-a → rev-b」。对着看的人关心的是前者——后者是版本号，
      //   在行里说不出任何东西。但失败时反过来：错误码比文件名重要。
      if (progress === "failed") {
        if (detail) open.detail = detail;
      } else if (!open.detail && detail) {
        open.detail = detail;
      }
      // ⚠ 开场那一发按设计没有 id（还没 enqueue）。execute 之后会再来
      //   一发 acting 把 id 补上；结果事件也带。都要合进已经开着的行，
      //   否则「它的电脑」订不到正在打字的那条 PTY。
      if (!open.operationId && operationId) open.operationId = operationId;
      return null;
    }
    const row: ProjectActionRow = {
      id: step.id,
      tool,
      label: projectActionLabel(tool),
      status: progress === "failed" ? "failed" : "done",
      ...(detail ? { detail } : {}),
      ...(operationId ? { operationId } : {}),
    };
    rows.push(row);
    return row;
  }
  // acting / observing / thinking：开一行，等结果来收。
  //
  // ⚠ 2026-09-18：同一工具还开着、后来的 chip 带着同一个（或刚补上的）
  //   operationId → 合进开着的那一行。真机开场没有 id，execute 之后
  //   才补；再开一行左栏会裂成两步，右侧还订着空的。
  //   已经有 id 的开着的行 + 新来的**没有** id = 下一步同名工具，不许合。
  const open = [...rows]
    .reverse()
    .find(row => row.tool === tool && row.status === "running");
  if (
    open &&
    operationId &&
    (!open.operationId || open.operationId === operationId)
  ) {
    if (!open.operationId) open.operationId = operationId;
    if (detail && !open.detail) open.detail = detail;
    return null;
  }
  const row: ProjectActionRow = {
    id: step.id,
    tool,
    label: projectActionLabel(tool),
    status: "running",
    ...(detail ? { detail } : {}),
    ...(operationId ? { operationId } : {}),
  };
  rows.push(row);
  return row;
}

/**
 * 把平铺的步骤配成一行一次调用。
 *
 * ⚠ **按顺序配对，不按工具名归并**。原实现用 `Map<capabilityId, status>`，
 *   连跑三次 `project_patch` 只剩一行、只留最后一次的状态——中间那次失败
 *   就这么消失了。判据 `连跑三次 patch 要有三行` 钉的就是这条。
 */
export function deriveProjectActivity(turns: UiTurn[]): ProjectActionRow[] {
  const steps = (Array.isArray(turns) ? turns : []).flatMap(
    turn => (turn && Array.isArray(turn.steps) ? turn.steps : []) as TurnStep[]
  );
  const rows: ProjectActionRow[] = [];
  for (const step of steps) applyProjectChip(rows, step);
  return rows;
}

/**
 * 「它的电脑」此刻该摊开哪一条、「实时」该不该亮。
 *
 * 抽成纯函数是因为这个仓的组件判据走 `react-dom/server` 静态渲染，点不了
 * 按钮。把决策放在这里，正反两面都能直接测，组件只负责画。
 *
 * ⚠ 「实时」只在**真有动作在跑** 且 **用户没有倒回去看历史**时亮。一个永远
 *   亮着的实时灯比没有更坏：它让人以为还在跑。`pinned` 非空就是用户钉住了
 *   某一条，此时哪怕后台还在跑，这块屏幕显示的也是过去，不能说「实时」。
 */
export function projectComputerView(
  rows: ProjectActionRow[],
  pinned: number | null
): {
  index: number;
  current: ProjectActionRow | null;
  live: boolean;
  following: boolean;
} {
  const following = pinned == null;
  const last = Math.max(rows.length - 1, 0);
  const index = following ? last : Math.min(Math.max(pinned, 0), last);
  const running = rows.some(row => row.status === "running");
  return {
    index,
    current: rows[index] ?? null,
    live: running && following,
    following,
  };
}

const TERMINAL_OPERATION = new Set(["completed", "failed", "cancelled"]);

/**
 * 工具回执还没到终态：命令还在沙箱里跑。
 *
 * ⚠ 2026-09-18：`project_exec` 15 秒等不完就交回 `status=running`。
 *   前端以前只看 `ok`，立刻勾成完成——左栏没了「进行中」，PTY 也不再
 *   热轮询，打字字节到了也看不见。
 */
export function projectToolStillOpen(
  event: Record<string, unknown> | null | undefined
): boolean {
  if (!event || typeof event !== "object") return false;
  if (event.ok === false) return false;
  // ⚠ 2026-09-20 review：后端 project_tools.py:109 每个工具回执都带
  //   `commandFinished`，而**服务中的 runtime.start 永远停在 status=running**
  //   （服务中的沙盒不会进 completed，等它进终态就是等它死）。只看终态集合，
  //   project_start 成功之后那条 chip 会永远转「正在启动工程」。
  //   后端专门加这个字段就是为了治它，前端一直没读（§4 只改一半）。
  //   只认显式 true：旧事件没有这个字段，仍走下面的终态判定，不改行为。
  if (event.commandFinished === true) return false;
  const status = String(event.status || "").trim().toLowerCase();
  if (!status) return false;
  return !TERMINAL_OPERATION.has(status);
}

/**
 * 左栏该亮哪一行。
 *
 * 人点过某一条 → 钉住。没点过 → 跟队尾（当前正在做的那一步）。
 * 点了才亮、跟着跑的时候整列都不亮，就是 2026-09-18 真机那张图。
 */
export function followProjectActionId(
  rows: Array<{ id?: string }>,
  inspectId?: string | null
): string | null {
  const focus = String(inspectId || "").trim();
  if (focus && (rows || []).some(row => String(row.id || "") === focus)) {
    return focus;
  }
  const last = (rows || [])[(rows || []).length - 1];
  const id = last ? String(last.id || "").trim() : "";
  return id || null;
}

function isToolChip(
  step: TurnStep
): step is Extract<TurnStep, { kind: "chip" }> {
  return step.kind === "chip";
}

export function turnsHaveProjectChips(turns: readonly UiTurn[]): boolean {
  return turns.some(turn => (turn.steps || []).some(isProjectChip));
}

/**
 * 从 controlTranscript 里的 tool_start / tool_result 还原执行 chip。
 *
 * 抄 OpenHands / AI SDK：host 写的那份日志是权威。刷新读这一份，
 * 不许只靠客户端轮末 PUT 的 turnNarrations。
 */
export function chipFromControlTranscriptRow(
  row: unknown,
  index = 0
  // ⚠ 2026-09-20：原来声明 `TurnStep | null`，但三个 return 只有 null 和
  //   kind:"chip" 两种——类型比实现宽，调用方取 .progressType 一律 TS2339。
  //   收窄到 TurnChipStep，调用方不用再 as 任何东西。
): TurnChipStep | null {
  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  const tool = String(item.tool || "").trim();
  if (!tool) return null;
  const kind = String(item.kind || "");
  const id = String(item.id || `ct-tool-${index}`);
  const detail = String(item.detail || item.summary || "").trim();
  const operationId = String(item.operationId || "").trim();
  const label = projectActionLabel(tool);
  if (kind === "tool_start") {
    return {
      id: `${id}-start`,
      kind: "chip",
      capabilityId: tool as `project_${string}`,
      roleId: "system",
      label: `正在${label}`,
      realLlm: false,
      progressType: "acting",
      ...(detail ? { projectDetail: detail } : {}),
      ...(operationId ? { operationId } : {}),
    };
  }
  if (kind === "tool_result") {
    const ok = item.ok !== false;
    const stillOpen = projectToolStillOpen(item);
    return {
      id: `${id}-result`,
      kind: "chip",
      capabilityId: tool as `project_${string}`,
      roleId: "system",
      label: !ok ? `执行失败：${label}` : stillOpen ? `正在${label}` : `已${label}`,
      realLlm: false,
      progressType: !ok ? "failed" : stillOpen ? "acting" : "completed",
      ...(detail ? { projectDetail: detail } : {}),
      ...(operationId ? { operationId } : {}),
    };
  }
  return null;
}

export function chipsFromControlTranscript(rows: unknown): TurnStep[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row, index) => {
    const chip = chipFromControlTranscriptRow(row, index);
    return chip ? [chip] : [];
  });
}

/**
 * 叙述里的 chip 占位换成日志里的工具行，但**开口位置不许动**。
 *
 * ⚠ 2026-09-17：第一版 `kept + chips` 先剥光工具再整列接到散文后面。
 *   SessionStory 靠开口切开工具组，这一接就把「开口 → 写入 → 开口」
 *   收成扁平勾选——正是刷新后格式没了。叙述里还有 chip 占位时，按占位
 *   把日志行织回去；没有占位才接到末尾（旧会话叙述只剩开口）。
 */
export function weaveTranscriptChips(
  steps: TurnStep[],
  chips: TurnStep[]
): TurnStep[] {
  if (!chips.length) return steps.filter(step => !isToolChip(step));
  const out: TurnStep[] = [];
  let logIndex = 0;
  let pendingSlots = 0;
  const flushSlots = () => {
    while (pendingSlots > 0 && logIndex < chips.length) {
      out.push(chips[logIndex++]);
      pendingSlots -= 1;
    }
    pendingSlots = 0;
  };
  for (const step of steps) {
    if (isToolChip(step)) {
      pendingSlots += 1;
      continue;
    }
    flushSlots();
    out.push(step);
  }
  flushSlots();
  while (logIndex < chips.length) out.push(chips[logIndex++]);
  return out;
}

export function attachProjectChipsToTurns(
  turns: UiTurn[],
  chips: TurnStep[]
): UiTurn[] {
  if (!turns.length || !chips.length) return turns;
  const host =
    [...turns]
      .reverse()
      .find(turn => turn.user || (turn.steps || []).length > 0) ??
    turns[turns.length - 1];
  return turns.map(turn => {
    if (turn.id !== host.id) return turn;
    return { ...turn, steps: weaveTranscriptChips(turn.steps || [], chips) };
  });
}

/** 已完成的条数 / 总条数——分母是**真实发生的动作数**，不是写死的 6。 */
export function projectActivityProgress(rows: ProjectActionRow[]): {
  done: number;
  total: number;
  failed: number;
} {
  return {
    done: rows.filter(row => row.status === "done").length,
    total: rows.length,
    failed: rows.filter(row => row.status === "failed").length,
  };
}
