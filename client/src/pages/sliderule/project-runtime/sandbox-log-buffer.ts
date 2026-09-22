/**
 * 沙箱命令行输出的滚动缓冲。**纯函数**，判据直接跑。
 *
 * ## 抄的标准答案
 *
 * grok-build `xai-grok-pager/src/app/agent.rs::BgTaskState`
 * 与 `app/acp_handler/background.rs::route_bg_task_stdout`。六条规则一条不少：
 *
 *   1. 两条写入路径都留着：全量覆盖 / 增量追加。
 *      grok 注释：`// The shell sends the full cumulative output buffer, so just overwrite`
 *      我们服务端 `/project-operations/{id}/events` 给的是 `afterSeq + nextOffset`
 *      的**增量**，所以走 append 那条；`replace` 留着给「一次性拿全量」的调用方。
 *   2. **空块不许覆盖**。grok 的事故记录：
 *      `// Don't overwrite with empty stdout (shell clears buffer on completion)`
 *      —— 命令结束时 shell 会清缓冲，一个空块能把已经收到的输出全抹掉。
 *   3. **`truncated` 是黏的**：
 *      `once true, it stays true for the rest of the task (the rolling buffer can't "un-truncate")`
 *   4. 超上限**截头保尾**——终端看的是最新的那几行，不是开头。两条写入路径
 *      都会置 `truncated`。
 *   5. 缓存行数。grok 写明了理由：否则任务面板每帧要扫最多整个缓冲。
 *   6. 状态三态 Running / Done(exit 0) / Failed(非零/信号/超时/OOM)。
 *
 * ## 两处**故意不照抄**
 *
 * · 上限不是 grok 的 `BG_TASK_MAX_STDOUT = 10 MiB`。那是原生 TUI 的量级；
 *   浏览器里每个 operation 攥着 10MB 字符串还要参与 React 重渲染，代价完全
 *   不同。取 200_000 字符（约一个长构建日志），跟本仓 `action_stationarity`
 *   重新标定 grok 阈值是同一个理由：**照抄一个在我们这边永远碰不到或者
 *   碰到就出事的数字，等于没标定**。
 *
 * · 边界对齐的理由变了。grok 是 Rust，切片会切断 UTF-8 字节序列，所以
 *   `floor_char_boundary`。JS 字符串是 UTF-16，切片会切断**代理对**
 *   （emoji、部分 CJK 扩展区），切断后渲染出半个 `�`。所以这里防的是
 *   代理对，不是字节边界——同一个病，不同的形状。
 */

/** 一个 operation 的输出上限（字符）。见模块头注为什么不是 grok 的 10 MiB。 */
export const SANDBOX_LOG_MAX_CHARS = 200_000;

export type SandboxLogStatus = "running" | "done" | "failed";

export type SandboxLogState = {
  /** 已累积的输出。 */
  text: string;
  /**
   * 活 PTY 的原始字节（`runtime.console`）。按到达顺序拼接，
   * **不许**像 `text` 那样块与块之间插换行——插了就把打字拆成假日志。
   */
  console: string;
  /** 缓存行数：渲染不重数（grok 的 `stdout_line_count`）。 */
  lineCount: number;
  /** 黏性：一旦裁过就永远是 true。 */
  truncated: boolean;
  /** 读到哪一条事件了。下次请求的 afterSeq。 */
  seq: number;
};

export function emptySandboxLog(): SandboxLogState {
  return { text: "", console: "", lineCount: 0, truncated: false, seq: 0 };
}

export type SandboxLogEventPage = {
  events?: Array<{ seq?: number; type?: string; payload?: Record<string, unknown> }>;
  nextSeq?: number;
  hasMore?: boolean;
};

/**
 * 把一页 `/events` 折进缓冲。
 *
 *   · `runtime.log` → `text`（块之间补换行，旧路径）
 *   · `runtime.console` → `console`（原样拼接，PTY 打字）
 *   · 别的事件只推游标
 */
export function applyRuntimeLogPage(
  state: SandboxLogState,
  body: SandboxLogEventPage | null | undefined
): SandboxLogState {
  if (!body) return state;
  let next = state;
  for (const event of body.events || []) {
    const payload = event?.payload || {};
    const seq = typeof event?.seq === "number" ? event.seq : undefined;
    if (event?.type === "runtime.console") {
      next = appendSandboxConsole(next, String(payload.data ?? ""), {
        seq,
        truncated: Boolean(payload.truncated),
      });
      continue;
    }
    if (event?.type !== "runtime.log") {
      if (typeof event?.seq === "number" && event.seq > next.seq) {
        next = { ...next, seq: event.seq };
      }
      continue;
    }
    next = appendSandboxLog(next, String(payload.text ?? ""), {
      seq,
      truncated: Boolean(payload.truncated),
    });
  }
  if (typeof body.nextSeq === "number" && body.nextSeq > next.seq) {
    next = { ...next, seq: body.nextSeq };
  }
  return next;
}

/** 从 `index` 往后找一个不会切断代理对的位置。 */
function safeCut(text: string, index: number): number {
  let cut = Math.max(0, Math.min(index, text.length));
  // 落在低位代理上说明正好把一对切成两半，往后挪一格。
  while (cut < text.length) {
    const code = text.charCodeAt(cut);
    if (code >= 0xdc00 && code <= 0xdfff) cut += 1;
    else break;
  }
  return cut;
}

function finish(
  text: string,
  truncated: boolean,
  seq: number,
  consoleText: string
): SandboxLogState {
  let nextText = text;
  let nextConsole = consoleText;
  let cut = truncated;
  if (nextText.length > SANDBOX_LOG_MAX_CHARS) {
    nextText = nextText.slice(safeCut(nextText, nextText.length - SANDBOX_LOG_MAX_CHARS));
    cut = true;
  }
  if (nextConsole.length > SANDBOX_LOG_MAX_CHARS) {
    nextConsole = nextConsole.slice(
      safeCut(nextConsole, nextConsole.length - SANDBOX_LOG_MAX_CHARS)
    );
    cut = true;
  }
  return {
    text: nextText,
    console: nextConsole,
    lineCount: nextText ? nextText.split("\n").length : 0,
    truncated: cut,
    seq,
  };
}

/**
 * 追加一段输出。抄 grok `append_stdout`：缓冲非空时先补一个 `\n` 分隔。
 *
 * ⚠ 空块**原样返回**（连 seq 都不动）——见规则 2。
 */
export function appendSandboxLog(
  state: SandboxLogState,
  chunk: string,
  opts: { seq?: number; truncated?: boolean } = {}
): SandboxLogState {
  const piece = typeof chunk === "string" ? chunk : "";
  const sticky = state.truncated || Boolean(opts.truncated);
  const seq = typeof opts.seq === "number" && opts.seq > state.seq ? opts.seq : state.seq;
  if (!piece) {
    // 空块不覆盖、不清空。只让黏性标记和游标往前走。
    return sticky === state.truncated && seq === state.seq
      ? state
      : { ...state, truncated: sticky, seq };
  }
  const joined = state.text ? `${state.text}\n${piece}` : piece;
  return finish(joined, sticky, seq, state.console);
}

/**
 * 整块替换。抄 grok `set_stdout`（「shell 发的是全量累计缓冲，直接覆盖」）。
 * 我们的服务端今天不走这条，留着是因为两条路 grok 都留着，而且
 * 「一次性补齐历史」天然是覆盖语义。
 *
 * ⚠ 同样**不许被空串覆盖**。
 */
export function replaceSandboxLog(
  state: SandboxLogState,
  next: string,
  opts: { seq?: number; truncated?: boolean } = {}
): SandboxLogState {
  const piece = typeof next === "string" ? next : "";
  const sticky = state.truncated || Boolean(opts.truncated);
  const seq = typeof opts.seq === "number" && opts.seq > state.seq ? opts.seq : state.seq;
  if (!piece) {
    return sticky === state.truncated && seq === state.seq
      ? state
      : { ...state, truncated: sticky, seq };
  }
  return finish(piece, sticky, seq, state.console);
}

/**
 * PTY 增量。跟 `appendSandboxLog` 的差别只有一条：块之间**不**插 `\n`。
 * `n` + `p` + `m` 必须是 `npm`，否则「实时打字」又变回一行一行的日志。
 */
export function appendSandboxConsole(
  state: SandboxLogState,
  chunk: string,
  opts: { seq?: number; truncated?: boolean } = {}
): SandboxLogState {
  const piece = typeof chunk === "string" ? chunk : "";
  const sticky = state.truncated || Boolean(opts.truncated);
  const seq = typeof opts.seq === "number" && opts.seq > state.seq ? opts.seq : state.seq;
  if (!piece) {
    return sticky === state.truncated && seq === state.seq
      ? state
      : { ...state, truncated: sticky, seq };
  }
  return finish(state.text, sticky, seq, state.console + piece);
}

/**
 * 运行状态三态。抄 grok `BgTaskStatus`：**exit 0 才算 Done**，
 * 非零/信号/超时/OOM 一律 Failed。
 *
 * ⚠ 拿不到 exitCode 的终态不许默认成功——那就是伪造绿灯（§7 闭环 fail-closed）。
 */
export function sandboxLogStatus(
  operationStatus: string | null | undefined,
  exitCode?: number | null
): SandboxLogStatus {
  const status = String(operationStatus || "").trim().toLowerCase();
  if (status === "failed" || status === "cancelled") return "failed";
  if (status !== "completed") return "running";
  return exitCode === 0 ? "done" : "failed";
}
