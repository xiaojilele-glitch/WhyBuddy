/**
 * 工厂公开跳 + 闭集工具名：从人话里抠出唯一工具名。
 *
 * 抄 grok-build AskUserQuestion：选项点下去是 typed 答案（Accepted），
 * 不是把标签当新 prompt 再问一轮模型。面团收尾卡
 * 「进入数据模型反推（Structure）」必须认出 structure，走 forcedTool，
 * 不许当聊天发出去（2026-09-03 真机：点了 Structure 又弹伴随式卡、
 * 控制面去 planning）。
 *
 * ⚠ 2026-09-07 真机水果店：芯片「精修（refine）」不是五件套，也不是 /精修，
 *   POST 空 forcedTool，控制面重猜成 bind。括号里的名字必须对全表。
 *
 * 跟 Python `closed_tools.factory_hop_from_text` /
 * `closed_tools.closed_tool_from_text` 同一把尺子。
 */
export const FACTORY_HOPS = [
  "spec",
  "pages",
  "structure",
  "bind",
  "closure",
] as const;

export type FactoryHop = (typeof FACTORY_HOPS)[number];

/** 跟 Python `closed_tools.CLOSED_TOOLS` 同一张表。漏一侧 = 芯片一半不认。 */
export const CLOSED_TOOLS = [
  "ask_user_question",
  // 历史 clarify 回执仍可提交，新问题统一使用问卷工具。
  "search_evidence",
  "inspect_model",
  "enter_plan_mode",
  "write_plan",
  "exit_plan_mode",
  // 报完工 2026-09-09 加（跟 Python `closed_tools.CLOSED_TOOLS` 同步）：
  // 模型声称做完了要走闭环判官，判决当场回喂。抄 grok update_goal。
  "report_done",
  // 活儿清单 2026-09-09 加（跟 Python `closed_tools.CLOSED_TOOLS` 同步）。
  "todo_write",
  // 模型记忆 2026-09-09 加（跟 Python `closed_tools.CLOSED_TOOLS` 同步）。
  "remember",
  "recall",
  // 加载磁盘技能。skill 是英文常用词，文本抠名必须忽略。
  "skill",
  "rehearse",
  "workflow",
  ...FACTORY_HOPS,
  "refine",
  "challenge",
  "repair",
  "restore_version",
  "fork_variant",
  "project_create", "project_list", "project_read", "project_search",
  "project_patch", "project_write", "project_str_replace",
  "file_read", "file_write", "file_str_replace",
  "file_find_in_content", "file_find_by_name",
  "read_file", "write_file", "search_replace", "bash", "grep", "list_dir", "glob",
  "shell_exec", "shell_view", "shell_wait", "shell_write_to_process", "shell_kill_process",
  "browser_view", "browser_navigate", "browser_restart",
  "browser_click", "browser_input", "browser_move_mouse", "browser_press_key",
  "browser_select_option", "browser_scroll_up", "browser_scroll_down",
  "browser_console_exec", "browser_console_view",
  "message_notify_user", "message_ask_user", "info_search_web",
  "deploy_expose_port", "deploy_apply_deployment", "make_manus_page", "idle",
  "project_start", "project_exec", "project_status",
  "project_logs", "project_cancel",
  // ⚠ 2026-09-15 补的五个：版本史 / 导出 / 回滚 / 验收，Python 侧
  //   `closed_tools.CLOSED_TOOLS` 早就有，TS 这份漏了。上面那句
  //   「漏一侧 = 芯片一半不认」说的就是这个失效形态——模型调了
  //   project_verify，芯片这边不认这个名字，左栏那一步静静地不出现。
  //   `test_closed_tool_from_text.py::Test两侧同一张表` 钉着两头。
  "project_revisions", "project_export", "project_restore",
  "project_verify", "project_verification",
  // 2026-09-17 核写：path+content / 唯一串替换。Python CLOSED_TOOLS 成对。
] as const;

export type ClosedTool = (typeof CLOSED_TOOLS)[number];

/** 账本上的 WRITE 身份。跟 Python `closed_tools.factory_capability_id` 同一把尺子。 */
export const FACTORY_CAP_PREFIX = "factory.";

/** 左栏人话。跟 Python `closed_tools.FACTORY_HOP_LABELS` 同一套。 */
export const FACTORY_HOP_LABELS: Record<FactoryHop, string> = {
  spec: "起草规格：成功判据、需求节点与页面清单",
  pages: "逐页画界面（并发）",
  structure: "从界面反推数据模型与关联关系",
  bind: "给界面接上数据",
  closure: "完整性检查与发布闭环",
};

export function factoryCapabilityId(hop: FactoryHop): string {
  return `${FACTORY_CAP_PREFIX}${hop}`;
}

export function hopFromFactoryCapability(
  capabilityId: string
): FactoryHop | undefined {
  const raw = String(capabilityId || "").trim();
  if (!raw.startsWith(FACTORY_CAP_PREFIX)) return undefined;
  const hop = raw.slice(FACTORY_CAP_PREFIX.length) as FactoryHop;
  return (FACTORY_HOPS as readonly string[]).includes(hop) ? hop : undefined;
}

/** 是不是工厂 hop 残留值。rehearse / refine 这类显式意图不是。 */
export function isFactoryHop(name: unknown): name is FactoryHop {
  return (FACTORY_HOPS as readonly string[]).includes(String(name || ""));
}

/**
 * 会进工厂、该亮产品钟的 WRITE。
 *
 * 抄 grok：Progress 跟工具走。ask_user / inspect / 问候不是 WRITE，
 * 不许点「规划第一轮」（2026-09-08 真机：发「你好」右栏演开场）。
 */
export function isFactoryWriteTool(name: unknown): boolean {
  const tool = String(name || "");
  return (
    tool === "rehearse" ||
    tool === "refine" ||
    tool === "repair" ||
    isFactoryHop(tool)
  );
}

const HOP_ID_RE = /(?:^|[^\w])(spec|pages|structure|bind|closure)(?:[^\w]|$)/gi;

const CLOSED_ID_RE = new RegExp(
  `(?:^|[^\\w])(${[...CLOSED_TOOLS].sort((a, b) => b.length - a.length).join("|")})(?:[^\\w]|$)`,
  "gi"
);

/** 泄漏核 29 件。名字和参数按包，提示词不贴。 */
export const FILE_KERNEL_TOOLS = [
  "file_read",
  "file_write",
  "file_str_replace",
  "file_find_in_content",
  "file_find_by_name",
] as const;

export function isProjectWorkbenchTool(name: unknown): boolean {
  const tool = String(name || "").trim();
  return (
    tool.startsWith("project_") ||
    tool.startsWith("file_") ||
    tool.startsWith("shell_") ||
    tool.startsWith("browser_") ||
    tool.startsWith("deploy_") ||
    tool.startsWith("message_") ||
    tool === "info_search_web" ||
    tool === "make_manus_page" ||
    tool === "idle" ||
    tool === "read_file" ||
    tool === "write_file" ||
    tool === "search_replace" ||
    tool === "bash" ||
    tool === "grep" ||
    tool === "list_dir" ||
    tool === "glob" ||
    // ⚠ 2026-09-20：skill 跟工程/文件/shell 一样是会话动作。
    //   不进白名单 → isProjectChip 滤掉 → 调了也像没调。
    tool === "skill"
  );
}

/** 文本不得把 rehearse 当成 forcedTool。跟 `/推演` 同一条合同。 */
const TEXT_FORCED_SKIP = new Set<string>([
  "rehearse",
  "skill",
  "idle",
  "make_manus_page",
  "bash",
  "grep",
  "glob",
  "list_dir",
  "read_file",
  "write_file",
  "search_replace",
  ...CLOSED_TOOLS.filter(name =>
    /^(project_|file_|shell_|browser_|deploy_|message_|info_)/.test(name)
  ),
]);

const ZH: Array<[RegExp, FactoryHop]> = [
  [/数据模型反推|数据结构/, "structure"],
  [/权限绑定|权限工作流/, "bind"],
  [/页面生成|画页面/, "pages"],
  [/起草\s*SPEC|起草规格/, "spec"],
  [/完整性检查|上线闭环/, "closure"],
  // 闭环发布后面不能是「管理/系统/平台/应用」——那是新产品名。
  [/闭环发布(?!管理|[系统平台应用])/, "closure"],
];

function hopIdsIn(text: string): FactoryHop[] {
  const found: FactoryHop[] = [];
  const seen = new Set<string>();
  HOP_ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HOP_ID_RE.exec(text))) {
    const id = m[1].toLowerCase() as FactoryHop;
    if (!seen.has(id)) {
      seen.add(id);
      found.push(id);
    }
  }
  return found;
}

export function factoryHopFromText(text: string): FactoryHop | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const ids = hopIdsIn(t);
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) return undefined;
  const zh: FactoryHop[] = [];
  const seen = new Set<string>();
  for (const [pat, hop] of ZH) {
    if (pat.test(t) && !seen.has(hop)) {
      seen.add(hop);
      zh.push(hop);
    }
  }
  return zh.length === 1 ? zh[0] : undefined;
}

export function looksLikeFactoryHopCommand(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (factoryHopFromText(t)) return true;
  return hopIdsIn(t).length >= 1;
}

function closedIdsIn(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  CLOSED_ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLOSED_ID_RE.exec(text))) {
    const id = m[1].toLowerCase();
    if (TEXT_FORCED_SKIP.has(id) || seen.has(id)) continue;
    seen.add(id);
    found.push(id);
  }
  return found;
}

export function closedToolFromText(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const ids = closedIdsIn(t);
  return ids.length === 1 ? ids[0] : undefined;
}

export function looksLikeClosedToolCommand(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (closedToolFromText(t)) return true;
  CLOSED_ID_RE.lastIndex = 0;
  return CLOSED_ID_RE.test(t);
}
