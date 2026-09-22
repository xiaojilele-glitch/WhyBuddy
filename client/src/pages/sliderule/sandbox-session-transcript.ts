/**
 * 把一步工程动作收成一段「真在用的终端」。
 *
 * ## 为什么要这个（2026-09-14，用户对照 Manus 沙箱截图）
 *
 * Manus 右侧是一台正在被用的机器：提示符、刚敲的命令、stdout 往下滚。
 * 我们这边同一份 E2B 日志被收成「运行命令 / project_exec / 命令行输出 26 行」
 * ——卡片在解释这一步，不是在看这台机器。
 *
 * 活路径是 `start_console` → PTY → `runtime.console` → xterm。
 * 嵌进面不再用这份拼贴当脸——没字节就空着等，好过写死 create/get/`$`。
 * 函数还留着，是为了独立测「摘要该怎么收」，不是给面板回头抄。
 *
 * ## 诚实边界
 *
 *   · 提示符只写 `$`。服务端没发 hostname / cwd，不许写成
 *     `ubuntu@sandbox:~$`——那是 Manus 的机器，不是我们的。
 *   · 命令行只来自这一步的脱敏摘要，且只在它真的跑过命令时
 *     （`project_exec` / `project_logs`）。`src/Home.tsx` 不是一条 shell。
 *   · 没有输出就没有输出，不编 `ls` / `find` 来填屏。
 *
 * ⚠ 2026-09-15 第二趟：对照 Manus 的 `find` 输出，把 `GET /source`
 *   的路径整页铺进终端。用户圈了那面白纸说「终端咋是这样的」——
 *   那是源码树，不是壳。清单回「源码」档，这里不许再当脸。
 */

export function sandboxCommandLine(row: {
  tool?: string;
  detail?: string;
}): string | null {
  const tool = String(row.tool || "").trim();
  const detail = String(row.detail || "").trim();
  if (!detail) return null;
  if (
    tool === "project_exec" ||
    tool === "project_logs" ||
    tool === "shell_exec" ||
    tool === "shell_view" ||
    tool === "shell_wait" ||
    tool === "bash"
  ) {
    return detail;
  }
  return null;
}

/**
 * 文件类动作收成传输日志的一行。对照 FTP 的 put/get：人要看见
 * 「哪个文件正在进沙箱」，不是再看左栏芯片。
 *
 * ⚠ 路径只来自脱敏摘要。没有摘要就不写——不编 `src/App.tsx`。
 * ⚠ 不许套 `$`：那是 shell，这份判据在 `sandbox-session-transcript.test.ts`。
 */
export function sandboxTransferLine(row: {
  tool?: string;
  detail?: string;
}): string | null {
  const tool = String(row.tool || "").trim();
  const detail = String(row.detail || "").trim();
  if (!detail) return null;
  if (
    tool === "project_patch" ||
    tool === "project_write" ||
    tool === "project_str_replace" ||
    tool === "file_write" ||
    tool === "file_str_replace" ||
    tool === "write_file" ||
    tool === "search_replace"
  ) {
    return `put ${detail}`;
  }
  if (tool === "project_read" || tool === "file_read" || tool === "read_file") {
    return `get ${detail}`;
  }
  if (tool === "project_create") return `create ${detail}`;
  if (tool === "project_export") return `get ${detail}`;
  return null;
}

/**
 * 整段工程动作流收成传输日志。嵌进面不许拿它当脸。
 *
 * ⚠ 每条 exec 只铺**自己的** `runtime.log`。2026-09-15 对照 Manus：
 *   第一版只订「当前这一步」，上一条 `$ pnpm` 的 stdout 还在服务端，
 *   面板已经换成 put 或下一条 `$`——看起来像假终端。对不上 id 仍不铺。
 */
/**
 * 右侧终端该订哪一条 operation。
 *
 * ⚠ 2026-09-18：切到「终端」档时曾经把最近 12 条 exec 全订上、按返回
 *   顺序拼进同一块 PTY。面板会闪过一串旧命令，网络面板连打 `/events`。
 *   用户没点左栏某一条时，只该看**当前最新在执行的**那条；点了才钉住。
 *
 *   正在跑的 exec 优先于后写完的 `npm list`——真机那张卡把已结束的
 *   list 当成「当前」，正在跑的 test 反而看不见。
 */
export function followSandboxOperationId(
  rows: Array<{
    id?: string;
    tool?: string;
    detail?: string;
    operationId?: string;
    status?: string;
  }>,
  opts: { focusId?: string | null; runtimeOperationId?: string | null } = {}
): string | null {
  const focus = String(opts.focusId || "").trim();
  if (focus) {
    const row = (rows || []).find(item => String(item.id || "") === focus);
    if (row && sandboxCommandLine(row)) {
      return String(row.operationId || "").trim() || null;
    }
    // 点的是写入/预览，不是终端行：仍跟最新命令。
    // ⚠ 不许退到 runtime.start——那会把 npm ci 的残留 PTY 当成当前命令。
  }
  const commands = (rows || []).filter(row => sandboxCommandLine(row));
  // ⚠ 正在跑的那条优先。还没有 operationId 时返回 null——退到
  //   runtime.start 会把 npm ci 的残留 PTY 当成「当前命令在打字」。
  const running = [...commands].reverse().find(row => row.status === "running");
  if (running) return String(running.operationId || "").trim() || null;
  const withId = commands.filter(row => String(row.operationId || "").trim());
  if (withId.length) return String(withId[withId.length - 1].operationId).trim();
  if (focus) return null;
  return String(opts.runtimeOperationId || "").trim() || null;
}

export function sandboxLogOperationIds(
  rows: Array<{ tool?: string; detail?: string; operationId?: string }>,
  opts: { limit?: number; hotId?: string } = {}
): string[] {
  const limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : 12;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows || []) {
    if (!sandboxCommandLine(row)) continue;
    const id = String(row.operationId || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const hot = String(opts.hotId || "").trim();
  if (ids.length <= limit) return ids;
  const kept = ids.slice(-limit);
  if (hot && seen.has(hot) && !kept.includes(hot)) {
    return [hot, ...kept.slice(1)];
  }
  return kept;
}

export function sandboxActivityTranscript(input: {
  rows: Array<{
    tool?: string;
    detail?: string;
    operationId?: string;
    status?: string;
  }>;
  /** 按 operationId 挂上的沙箱 stdout。优先于单条 logText。 */
  logs?: Record<string, string>;
  logText?: string;
  logOperationId?: string;
  running?: boolean;
  dockedPrompt?: boolean;
}): {
  lines: string[];
  cursor: boolean;
  idlePrompt: boolean;
} {
  const lines: string[] = [];
  const logId = String(input.logOperationId || "").trim();
  const log = String(input.logText || "").replace(/\n+$/, "");
  const logs = input.logs || {};
  for (const row of input.rows || []) {
    const command = sandboxCommandLine(row);
    if (command) {
      lines.push(`$ ${command}`);
      const rowOp = String(row.operationId || "").trim();
      const fromMap = rowOp ? String(logs[rowOp] || "").replace(/\n+$/, "") : "";
      const fromSingle = log && rowOp && rowOp === logId ? log : "";
      const attached = fromMap || fromSingle;
      if (attached) {
        for (const line of attached.split("\n")) lines.push(line);
      }
      continue;
    }
    const transfer = sandboxTransferLine(row);
    if (transfer) lines.push(transfer);
  }
  const running = Boolean(input.running);
  return {
    lines,
    cursor: running,
    idlePrompt: !running && !input.dockedPrompt,
  };
}

export function sandboxSessionTranscript(input: {
  command: string | null | undefined;
  logText: string;
  running: boolean;
  /**
   * ⚠ 2026-09-16：底栏不再钉 `$`。Manus 的提示符在 PTY 的 PS1 里。
   * 这个开关留给「宿主已经画了提示符」的调用方，会话面默认不要再叠一行。
   */
  dockedPrompt?: boolean;
}): {
  lines: string[];
  cursor: boolean;
  idlePrompt: boolean;
} {
  const lines: string[] = [];
  const command = String(input.command || "").trim();
  if (command) lines.push(`$ ${command}`);
  const log = String(input.logText || "").replace(/\n+$/, "");
  if (log) {
    for (const line of log.split("\n")) lines.push(line);
  }
  return {
    lines,
    cursor: Boolean(input.running),
    idlePrompt: !input.running && !input.dockedPrompt,
  };
}
