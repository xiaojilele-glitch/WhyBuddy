/**
 * ProjectComputerPanel — 「它的电脑」：看着它干活，也能倒回去看。
 *
 * ## 为什么要这个（2026-09-13，用户对照 Manus 截图第 4 件）
 *
 * Manus 右侧那块面板是感知差距最大的一件：正在调什么工具、参数是什么、
 * 返回了什么，底下还有一条可拖的时间轴能回放。我们这边同一时刻只有左栏
 * 一行「正在执行工程命令」，看不出它在对什么动手。
 *
 * ## 它跟左栏那份动作流不是一回事
 *
 * 左栏 `ProjectTaskChecklist` 回答「这一轮干了哪些事」——一眼扫完的清单。
 * 这里回答「这台机器上发生了什么」。嵌进时是原始 PTY（xterm 写
 * `runtime.console` 字节），不是 create/get/`$` 拼贴。独立卡片仍摊开
 * 一条脱敏摘要。两者共用 `deriveProjectActivity` 的同一份真实数据。
 *
 * ⚠ 2026-09-14：它不再叠在预览上面各吃一截。会话工作台里它是整块
 *   「它的电脑」的「终端」档（见 `project-computer-view.ts`）。应用中心
 *   那条预览链没有 turns，不会走到这一档。
 *
 * ⚠ 2026-09-15 对照 Manus：右侧是**正在执行的 PTY**，能看见字一个一个
 *   被敲进去。第一版把 `runtime.log` 收成 `$ cmd` + 行，用户一眼就看出来
 *   是日志。嵌进面永远走 xterm 原字节。提示符从 PTY 的 PS1 来，
 *   前端不许编 `ubuntu@`，也不许用 create/get/`$ cmd` 充屏。
 *   2026-09-15 下午对照 Manus 原始终端：用户圈了 `create react-vite`
 *   / `get package.json` 说不是 PTY。没 console 就空着等字节，
 *   好过写死一张传输日志。
 *   同日再圈了 `[32m` / `[1m[0K]`：那不是坏终端，是 `<pre>` 把 PTY
 *   原字节当正文。浏览器不画 ESC，CSI 颜色/清行码就变成乱码。
 *   译码器是 xterm.js（VS Code / Hyper / Jupyter 同一套），不要另接
 *   一个模拟器。原字节只许呆在 sr-only 里给判据读。
 *
 * ⚠ 2026-09-15：stdout / console 按 operationId 订。运行时那条
 *   `runtime.start` 在**没有 exec** 时才订——`npm ci` 打在它上面。
 * ⚠ 2026-09-18：嵌进面只订 `followSandboxOperationId` 一条。全订再
 *   join 会在切到终端时闪旧命令、连打 `/events`。没点左栏 = 当前最新
 *   在跑的那条；点了 = 钉住。
 *
 * ⚠ 2026-09-14：嵌进时不画内顶栏，也不画 `$` / 回放底栏——那两条是
 *   叠在会话上的第二层壳。回放靠左栏点工具行。不许把预览的
 *   「工程尚未启动」写进来。
 *
 * ## 诚实边界
 *
 *   · 细节来自服务端**脱敏白名单**摘要（`project_tool_summary`）。
 *     approvalRef 和文件内容永远不会到这儿——不是这里过滤，是那边就没发。
 *   · 没有摘要就显示不了细节，**不从别处拼一个**。界面少一句，好过编一句。
 *   · 「实时」只在真的还有动作在跑时才亮；停了就是停了，不留一个骗人的转圈。
 */

import React from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, X } from "lucide-react";
import {
  deriveProjectActivity,
  projectActivityProgress,
  projectComputerView,
  type ProjectActionRow,
} from "./project-activity";
import { dispatchInspectAction } from "./project-computer-view";
import { followSandboxOperationId } from "./sandbox-session-transcript";
import type { UiTurn } from "./types";
import { useSandboxLog, useSandboxLogs } from "./project-runtime/useSandboxLog";

function StatusMark({ status }: { status: ProjectActionRow["status"] }) {
  if (status === "done")
    return <Check className="h-4 w-4 text-emerald-600" aria-hidden />;
  if (status === "failed")
    return <X className="h-4 w-4 text-rose-600" aria-hidden />;
  return (
    <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" aria-hidden />
  );
}

/**
 * 沙箱命令行输出。**这一块才是「它的电脑」名副其实的地方**——在它之前，
 * 面板只说得出「正在运行命令」，说不出它打印了什么。
 *
 * ⚠ 拿不到 operationId（这一步不是远端操作，比如 project_read）就整块不画。
 *   §7 增强类 fail-open：日志是加分项，不许它的缺席让面板本身变难看。
 */
/**
 * 一行命令行输出该用什么颜色。**只按行首那几个公认的标记判**，不做语义分析。
 *
 * ⚠ 判据是「这一行自己说了什么」，不是猜它的意思：`WARN`/`ERR` 是工具自己
 *   打的前缀，`✓`/`✗` 是它自己打的符号。靠关键词猜「这行像不像错误」会在
 *   `found 0 vulnerabilities` 这种话上翻车（含 vulnerabilities 但它是好消息）。
 */
function consoleLineClass(line: string): string {
  const text = line.trimStart();
  if (/^(ERR|ERROR|FAIL|FATAL)\b/i.test(text) || text.startsWith("✗")) return "text-rose-600";
  if (/^(WARN|WARNING)\b/i.test(text)) return "text-amber-600";
  if (text.startsWith("✓") || /^(DONE|SUCCESS)\b/i.test(text)) return "text-emerald-600";
  // `>` 是包管理器回显的子命令，`$` 是提示符——都是结构行，压一级。
  if (text.startsWith(">") || text.startsWith("$")) return "text-stone-400";
  return "";
}

function SandboxConsole({
  operationId,
  fill = false,
}: {
  operationId?: string;
  fill?: boolean;
}) {
  const log = useSandboxLog(operationId);
  if (!operationId || !log.text) return null;
  return (
    <div
      className={fill ? "flex min-h-0 flex-1 flex-col space-y-1" : "space-y-1"}
      data-testid="project-computer-console"
    >
      <div className="flex shrink-0 items-center gap-2 text-[11px] text-stone-400">
        <span>命令行输出</span>
        <span className="tabular-nums">{log.lineCount} 行</span>
        {log.truncated ? (
          <span className="text-amber-600" data-testid="project-computer-console-truncated">
            · 只保留了最近部分
          </span>
        ) : null}
      </div>
      {/* 截头保尾，所以看的是尾巴——滚动条默认停在底部才对得上。
          ⚠ 2026-09-14 从纯深色改成浅色：对照 Manus 那张终端截图，它是浅底
            加**语义色**（WARN 黄、✓ 绿、链接蓝），信息一眼能分层；纯深底
            白字看着像终端，但一屏日志全是同一个灰度，反而读不出重点。
          ⚠ 嵌进整块电脑面时不许再 max-h-56：那是叠在预览上面那版的残骸，
            整面都是终端时要把日志铺满，否则下半截空白。 */}
      <pre
        className={
          fill
            ? "min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded border border-stone-200 bg-stone-50 px-2.5 py-2 font-mono text-[11px] leading-[1.6] text-stone-700"
            : "max-h-56 overflow-auto whitespace-pre-wrap break-all rounded border border-stone-200 bg-stone-50 px-2.5 py-2 font-mono text-[11px] leading-[1.6] text-stone-700"
        }
        data-testid="project-computer-console-text"
      >
        {log.text.split("\n").map((line, i) => (
          <div key={i} className={consoleLineClass(line)}>
            {line || "\u00a0"}
          </div>
        ))}
      </pre>
    </div>
  );
}

/**
 * 活 PTY。字节从沙箱来，这里只写进 xterm。jsdom 没有真实终端时退回
 * 同一份原文，判据读 `project-computer-pty-text`，不许另编一份。
 *
 * ⚠ 2026-09-15：这份原文**不许**当可见面。`<pre>{text}` 不会译 CSI，
 *   浏览器再把 ESC 吃掉，`\\x1b[32m` 就印成 `[32m`——用户圈的那屏乱码。
 */
function SandboxLiveTerminal({ text, running }: { text: string; running: boolean }) {
  const host = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<{
    write: (data: string) => void;
    reset: () => void;
    dispose: () => void;
    options?: { cursorBlink?: boolean };
  } | null>(null);
  const written = React.useRef(0);
  const [ready, setReady] = React.useState(0);

  React.useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    // xterm touches `self` / canvas. Static panel tests run in Node — keep
    // the import off the module graph so renderToStaticMarkup still works.
    void Promise.all([
      import("xterm"),
      import("@xterm/addon-fit"),
      import("xterm/css/xterm.css"),
    ])
      .then(([{ Terminal }, { FitAddon }]) => {
        if (disposed || !host.current) return;
        const term = new Terminal({
          disableStdin: true,
          convertEol: false,
          fontSize: 12,
          scrollback: 5000,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
          theme: {
            background: "#fafaf9",
            foreground: "#44403c",
            cursor: "#44403c",
          },
          cursorBlink: running,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host.current);
        fit.fit();
        termRef.current = term;
        written.current = 0;
        setReady(n => n + 1);
        if (typeof ResizeObserver !== "undefined") {
          const ro = new ResizeObserver(() => fit.fit());
          ro.observe(host.current);
          cleanup = () => ro.disconnect();
        }
      })
      .catch(() => {
        if (!disposed) termRef.current = null;
      });
    return () => {
      disposed = true;
      cleanup?.();
      termRef.current?.dispose();
      termRef.current = null;
    };
    // ⚠ 不要把 running 放进 deps：命令停下来会拆掉 xterm，短暂退回
    //   那张 CSI 乱码脸。光标闪不闪下面另更。
  }, []);

  React.useEffect(() => {
    const term = termRef.current;
    if (term?.options) term.options.cursorBlink = running;
  }, [running, ready]);

  React.useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (text.length < written.current) {
      term.reset();
      written.current = 0;
    }
    const slice = text.slice(written.current);
    if (slice) {
      term.write(slice);
      written.current = text.length;
    }
  }, [text, ready]);

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden bg-stone-50"
      data-testid="project-computer-pty"
      data-running={running ? "true" : "false"}
    >
      {/* ⚠ 2026-09-19：宿主若只写 flex-1，高度跟着 xterm 默认 24 行走，
          FitAddon 再量这一圈，右侧空出一大块白。绝对铺满才是格子尺寸。
          inset-0 又贴死顶栏/回放条，字顶到边。inset 按原来的 px-3 py-2.5。 */}
      <div ref={host} className="absolute inset-x-3 inset-y-2.5" />
      <pre data-testid="project-computer-pty-text" className="sr-only">
        {text}
      </pre>
    </div>
  );
}

/**
 * 整面原始 PTY。只写 `runtime.console` 字节。没字节就空着等，
 * 不许用 create / get / `$ cmd` 充屏——那是传输日志，不是壳。
 */
function SandboxSession({
  rows,
  current,
  focusId,
  runtimeOperationId,
}: {
  rows: ProjectActionRow[];
  current: ProjectActionRow | null;
  focusId?: string | null;
  runtimeOperationId?: string | null;
}) {
  // ⚠ 2026-09-18：不许再订一整串 exec 再 join。切到终端档会按返回
  //   顺序把旧命令刷进 PTY，网络连打 /events。没点左栏就只订当前
  //   最新在跑的那条；点了才钉住。见 followSandboxOperationId。
  const operationId = followSandboxOperationId(rows, {
    focusId,
    runtimeOperationId,
  });
  const followed = rows.find(row => row.operationId === operationId) ?? null;
  const running =
    followed?.status === "running" ||
    (Boolean(operationId) &&
      current?.operationId === operationId &&
      current.status === "running");
  const ids = operationId ? [operationId] : [];
  const logs = useSandboxLogs(ids, { hotIds: running ? ids : [] });
  const log = (operationId && logs[operationId]) || { console: "", truncated: false };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SandboxLiveTerminal text={log.console} running={running} />
      {log.truncated ? (
        <div
          className="shrink-0 px-3 py-1 text-[11px] text-amber-600"
          data-testid="project-computer-console-truncated"
        >
          · 只保留了最近部分
        </div>
      ) : null}
    </div>
  );
}

export function ProjectComputerPanel({
  turns,
  className = "",
  embedded = false,
  focusId = null,
  runtimeOperationId = null,
}: {
  turns: UiTurn[];
  className?: string;
  /**
   * 嵌进整块电脑面时去掉自己的卡片壳和「它的电脑」标题——
   * 外壳已经是这一面，再套一层边框就是 2026-09-13 那版叠卡片。
   */
  embedded?: boolean;
  /** 左栏点中的那一行。有它就摊开这一条，不再跟着最新走。 */
  focusId?: string | null;
  /** `runtime.start` 那条 operation。`npm ci` 的 PTY 挂在它上面。 */
  runtimeOperationId?: string | null;
}) {
  const rows = React.useMemo(() => deriveProjectActivity(turns), [turns]);
  // 游标：null = 跟着最新那条走（实时）。用户点了前后才钉住某一条。
  // 「摊开哪条 / 实时亮不亮」的决策在 projectComputerView 里，纯函数可测。
  const [pinned, setPinned] = React.useState<number | null>(null);
  const focusIndex = focusId ? rows.findIndex(row => row.id === focusId) : -1;
  const { index, current, live, following } = projectComputerView(
    rows,
    focusIndex >= 0 ? focusIndex : pinned
  );
  const inspectAt = (nextIndex: number) => {
    const row = rows[nextIndex];
    if (!row) return;
    setPinned(nextIndex);
    dispatchInspectAction({ id: row.id, tool: row.tool, keepView: true });
  };

  if (rows.length === 0) return null;
  const progress = embedded ? null : projectActivityProgress(rows);

  return (
    <section
      className={
        embedded
          ? `flex min-h-0 flex-1 flex-col bg-white ${className}`
          : `flex min-h-0 flex-col rounded-lg border border-stone-200 bg-white ${className}`
      }
      data-testid="project-computer-panel"
      data-live={live ? "true" : "false"}
      data-following={following ? "true" : "false"}
      aria-label="工程执行面板"
    >
      {embedded ? null : (
        <header className="flex shrink-0 items-center gap-2 border-b border-stone-100 px-3 py-2">
          <span className="text-[13px] font-medium text-stone-700">它的电脑</span>
          <span
            className="text-[11px] text-stone-400"
            data-testid="project-computer-subtitle"
          >
            {current
              ? current.status === "running"
                ? `正在${current.label}`
                : `${current.label}${current.status === "failed" ? " · 失败" : ""}`
              : ""}
          </span>
          <span className="ml-auto tabular-nums text-[11px] text-stone-400">
            {progress ? progress.done : 0} / {progress ? progress.total : 0}
            {progress && progress.failed > 0 ? (
              <span className="ml-1 text-rose-600">· {progress.failed} 失败</span>
            ) : null}
          </span>
        </header>
      )}

      <div
        className={
          embedded
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "min-h-0 flex-1 overflow-y-auto px-3 py-3"
        }
      >
        {current && embedded ? (
          <div
            className="flex min-h-0 flex-1 flex-col"
            data-testid="project-computer-current"
          >
            <SandboxSession
              rows={rows}
              current={current}
              focusId={focusId}
              runtimeOperationId={runtimeOperationId}
            />
          </div>
        ) : null}
        {current && !embedded ? (
          <div className="space-y-2" data-testid="project-computer-current">
            <div className="flex shrink-0 items-center gap-2">
              <StatusMark status={current.status} />
              <span className="text-[13px] text-stone-800">{current.label}</span>
              <code className="rounded bg-stone-50 px-1.5 py-0.5 text-[11px] text-stone-500">
                {current.tool}
              </code>
            </div>
            {current.detail ? (
              <pre
                className="shrink-0 whitespace-pre-wrap break-all rounded bg-stone-50 px-2.5 py-2 text-[12px] leading-5 text-stone-600"
                data-testid="project-computer-detail"
              >
                {current.detail}
              </pre>
            ) : (
              // ⚠ 没摘要就明说没有，不拿工具名凑一段假细节。
              <p className="shrink-0 text-[12px] text-stone-400">这一步没有可展示的细节。</p>
            )}
            <SandboxConsole operationId={current.operationId} />
          </div>
        ) : null}
      </div>

      {embedded ? null : (
        <footer className="flex shrink-0 items-center gap-2 border-t border-stone-100 px-3 py-2">
          <button
            type="button"
            aria-label="上一步"
            data-testid="project-computer-prev"
            disabled={index <= 0}
            onClick={() => inspectAt(Math.max(index - 1, 0))}
            className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="下一步"
            data-testid="project-computer-next"
            disabled={index >= rows.length - 1}
            onClick={() => inspectAt(Math.min(index + 1, rows.length - 1))}
            className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-blue-500 transition-[width]"
              style={{ width: `${((index + 1) / rows.length) * 100}%` }}
            />
          </div>
          <span
            className="shrink-0 text-[11px]"
            data-testid="project-computer-live"
          >
            {live && following ? (
              <span className="text-blue-600">● 实时</span>
            ) : (
              <span className="text-stone-400 tabular-nums">
                {index + 1} / {rows.length}
              </span>
            )}
          </span>
        </footer>
      )}
    </section>
  );
}
