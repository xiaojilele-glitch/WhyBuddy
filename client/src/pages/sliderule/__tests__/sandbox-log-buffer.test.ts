/**
 * 沙箱命令行滚动缓冲：抄 grok `BgTaskState` 那六条，一条配一条反向。
 *
 * 抄的标准答案：grok-build
 *   `xai-grok-pager/src/app/agent.rs::BgTaskState`（set_stdout / append_stdout）
 *   `xai-grok-pager/src/app/acp_handler/background.rs::route_bg_task_stdout`
 *
 * 这六条里有两条是**事故记录**，不是设计偏好——反向判据钉的就是它们：
 *   · 空块不许覆盖：`// Don't overwrite with empty stdout (shell clears buffer on completion)`
 *   · truncated 黏性：`once true, it stays true (the rolling buffer can't "un-truncate")`
 */
import { describe, expect, it } from "vitest";
import {
  SANDBOX_LOG_MAX_CHARS,
  appendSandboxLog,
  applyRuntimeLogPage,
  emptySandboxLog,
  replaceSandboxLog,
  sandboxLogStatus,
} from "../project-runtime/sandbox-log-buffer";

describe("追加：分隔符与行数缓存", () => {
  it("正向：非空缓冲追加时补一个换行（抄 append_stdout）", () => {
    let s = appendSandboxLog(emptySandboxLog(), "npm install");
    s = appendSandboxLog(s, "added 214 packages");
    expect(s.text).toBe("npm install\nadded 214 packages");
    expect(s.lineCount).toBe(2);
  });

  it("正向：第一段前面不许凭空多一个换行", () => {
    expect(appendSandboxLog(emptySandboxLog(), "first").text).toBe("first");
  });

  it("行数是缓存出来的，跟真实行数一致（grok 留它是为了不每帧重扫）", () => {
    const s = appendSandboxLog(emptySandboxLog(), "a\nb\nc");
    expect(s.lineCount).toBe(3);
    expect(s.lineCount).toBe(s.text.split("\n").length);
  });
});

describe("空块不许覆盖（grok 的事故记录）", () => {
  it("反向：命令结束时 shell 清缓冲，空块不许把已收到的输出抹掉", () => {
    const before = appendSandboxLog(emptySandboxLog(), "build ok");
    const after = appendSandboxLog(before, "");
    expect(after.text).toBe("build ok");
    expect(after).toBe(before); // 什么都没变时连对象都不换，省一次重渲染
  });

  it("反向：replace 那条路同样不许被空串清空", () => {
    const before = replaceSandboxLog(emptySandboxLog(), "build ok");
    expect(replaceSandboxLog(before, "").text).toBe("build ok");
  });

  it("正向：空块仍然可以推进游标和黏性标记", () => {
    const before = appendSandboxLog(emptySandboxLog(), "x");
    const after = appendSandboxLog(before, "", { seq: 9, truncated: true });
    expect(after.text).toBe("x");
    expect(after.seq).toBe(9);
    expect(after.truncated).toBe(true);
  });
});

describe("truncated 是黏的", () => {
  it("反向：置上之后，后面的干净块不许把它抹回 false", () => {
    let s = appendSandboxLog(emptySandboxLog(), "head", { truncated: true });
    expect(s.truncated).toBe(true);
    s = appendSandboxLog(s, "more");
    expect(s.truncated).toBe(true); // 变异：把黏性去掉 → 这里变 false
    s = replaceSandboxLog(s, "whole");
    expect(s.truncated).toBe(true);
  });

  it("正向：从来没裁过就不许自己亮起来", () => {
    const s = appendSandboxLog(appendSandboxLog(emptySandboxLog(), "a"), "b");
    expect(s.truncated).toBe(false);
  });
});

describe("滚动缓冲：截头保尾", () => {
  const long = (n: number) => "x".repeat(n);

  it("正向：超上限保的是**尾巴**——终端看的是最新几行，不是开头", () => {
    let s = appendSandboxLog(emptySandboxLog(), long(SANDBOX_LOG_MAX_CHARS));
    s = appendSandboxLog(s, "TAIL-MARKER");
    expect(s.text.endsWith("TAIL-MARKER")).toBe(true);
    expect(s.text.length).toBeLessThanOrEqual(SANDBOX_LOG_MAX_CHARS);
    expect(s.truncated).toBe(true);
  });

  it("反向：没超上限的一个字都不许裁", () => {
    const body = long(SANDBOX_LOG_MAX_CHARS - 10);
    const s = appendSandboxLog(emptySandboxLog(), body);
    expect(s.text).toBe(body);
    expect(s.truncated).toBe(false);
  });

  it("replace 超限同样截头保尾并置位", () => {
    const s = replaceSandboxLog(emptySandboxLog(), long(SANDBOX_LOG_MAX_CHARS + 500) + "END");
    expect(s.text.endsWith("END")).toBe(true);
    expect(s.text.length).toBeLessThanOrEqual(SANDBOX_LOG_MAX_CHARS);
    expect(s.truncated).toBe(true);
  });

  it("⚠ 不许切断代理对——切出半个字符会渲染成 \\ufffd", () => {
    // grok 那边防的是 UTF-8 字节边界（Rust 切片）；JS 是 UTF-16，
    // 同一个病换了形状：切在代理对中间。
    const emoji = "\u{1F642}"; // 两个 code unit
    // ⚠ 夹具必须让裁切点**真的落在代理对中间**，否则这条判据是假的：
    //   纯 emoji 串时 cut = len - MAX 永远落在高位代理上，切不断，
    //   把防护删掉照样绿（2026-09-14 变异时逮到）。
    //   尾部补**奇数个** ASCII，cut 的奇偶翻过来，正好落在低位代理上。
    const text = emoji.repeat(150_000) + "Z";
    const cut = text.length - SANDBOX_LOG_MAX_CHARS;
    const at = text.charCodeAt(cut);
    expect(at >= 0xdc00 && at <= 0xdfff).toBe(true); // 夹具自检：确实切在半个字符上

    const s = replaceSandboxLog(emptySandboxLog(), text);
    expect(s.text.length).toBeLessThanOrEqual(SANDBOX_LOG_MAX_CHARS);
    const first = s.text.charCodeAt(0);
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    expect(s.text.endsWith("Z")).toBe(true);
    expect([...s.text.slice(0, -1)].every(ch => ch === emoji)).toBe(true);
  });
});

describe("游标只许前进", () => {
  it("反向：迟到的小 seq 不许把游标拽回去（会导致重复拉同一段）", () => {
    let s = appendSandboxLog(emptySandboxLog(), "a", { seq: 10 });
    s = appendSandboxLog(s, "b", { seq: 3 });
    expect(s.seq).toBe(10);
  });
});

describe("状态三态：exit 0 才算成功", () => {
  it("正向", () => {
    expect(sandboxLogStatus("running")).toBe("running");
    expect(sandboxLogStatus("queued")).toBe("running");
    expect(sandboxLogStatus("completed", 0)).toBe("done");
  });

  it("反向：非零退出是失败，不是完成", () => {
    expect(sandboxLogStatus("completed", 1)).toBe("failed");
    expect(sandboxLogStatus("completed", 137)).toBe("failed");
    expect(sandboxLogStatus("failed")).toBe("failed");
    expect(sandboxLogStatus("cancelled")).toBe("failed");
  });

  it("反向：终态但拿不到退出码，不许默认成功（§7 闭环 fail-closed）", () => {
    expect(sandboxLogStatus("completed")).toBe("failed");
    expect(sandboxLogStatus("completed", null)).toBe("failed");
    expect(sandboxLogStatus("completed", undefined)).toBe("failed");
  });
});

describe("一页 events 折进缓冲", () => {
  it("只把 runtime.log 的 text 拼进去，别的事件只推游标", () => {
    const next = applyRuntimeLogPage(emptySandboxLog(), {
      events: [
        { seq: 1, type: "runtime.phase", payload: { phase: "install" } },
        { seq: 2, type: "runtime.log", payload: { text: "added 21 packages" } },
      ],
      nextSeq: 3,
      hasMore: false,
    });
    expect(next.text).toBe("added 21 packages");
    expect(next.seq).toBe(3);
    expect(next.text).not.toContain("install");
  });

  it("runtime.console 按到达顺序拼接，不许插换行——插了就把打字拆成假日志", () => {
    const next = applyRuntimeLogPage(emptySandboxLog(), {
      events: [
        { seq: 1, type: "runtime.console", payload: { data: "n" } },
        { seq: 2, type: "runtime.console", payload: { data: "p" } },
        { seq: 3, type: "runtime.console", payload: { data: "m ci" } },
      ],
      nextSeq: 3,
    });
    expect(next.console).toBe("npm ci");
    expect(next.text).toBe("");
  });

  it("反向：log 不许写进 console，console 也不许写进 text", () => {
    const next = applyRuntimeLogPage(emptySandboxLog(), {
      events: [
        { seq: 1, type: "runtime.log", payload: { text: "added 21 packages" } },
        { seq: 2, type: "runtime.console", payload: { data: "user@sb$ n" } },
      ],
      nextSeq: 2,
    });
    expect(next.text).toBe("added 21 packages");
    expect(next.console).toBe("user@sb$ n");
    expect(next.text).not.toContain("user@sb");
    expect(next.console).not.toContain("added 21");
  });

  it("反向：空页或没有 runtime.log 不许把已有输出抹掉", () => {
    const before = appendSandboxLog(emptySandboxLog(), "build ok", { seq: 4 });
    expect(applyRuntimeLogPage(before, null).text).toBe("build ok");
    expect(
      applyRuntimeLogPage(before, {
        events: [{ seq: 5, type: "runtime.phase" }],
        nextSeq: 6,
      }).text
    ).toBe("build ok");
  });
});

describe("通电：真的接在面板和会话链路上（§3）", () => {
  it("面板订阅了日志，且 operationId 一路串到了行上", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (p: string) =>
      fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

    const panel = read("client/src/pages/sliderule/ProjectComputerPanel.tsx");
    const panelLive = panel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(panel).toMatch(/useSandboxLog\(/);
    expect(panel).toMatch(/followSandboxOperationId\(/);
    expect(panel).toMatch(/<SandboxConsole[\s/>]/);
    // 会话工作台走 SandboxSession；只留 Console = 嵌进那条链又变回说明书。
    expect(panel).toMatch(/<SandboxSession[\s/>]/);
    expect(panel).toMatch(/<SandboxLiveTerminal[\s/>]/);
    expect(panel).toMatch(/runtimeOperationId/);
    // 反向：再订一整串 exec 再 join = 切到终端闪旧命令、连打 /events。
    expect(panelLive).toMatch(/operationId \? \[operationId\] : \[\]/);
    expect(panelLive).not.toMatch(/sandboxLogOperationIds\(/);
    expect(panelLive).not.toMatch(/\.join\(""\)/);
    expect(panel).toMatch(/absolute inset-x-3 inset-y-2\.5/);
    // 反向：拼贴重回嵌进面 = 用户圈的 create/get/`$ cmd`。
    expect(panel).not.toContain("project-computer-session");
    expect(panel).not.toContain("sandboxActivityTranscript");
    expect(panel).not.toMatch(/logs:\s*textById/);
    expect(panel).toMatch(/data-testid="project-computer-pty-text" className="sr-only"/);
    expect(panel).not.toMatch(/live\s*\?\s*"sr-only"/);
    const surface = read("client/src/pages/sliderule/project-runtime/SandboxPreviewSurface.tsx");
    const surfaceLive = surface.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(surface).toMatch(/runtimeOperationId=\{preview\.snapshot\?\.operationId\}/);
    expect(surface).toMatch(/data-testid="project-computer-stage"/);
    expect(surfaceLive).toMatch(
      /tab === "computer"[\s\S]*flex min-h-0 flex-1 flex-col overflow-hidden[\s\S]*: "hidden"/
    );
    const worker = read("slide-rule-python/services/project_runtime_worker.py");
    const live = worker.replace(/#[^\n]*/g, "");
    expect(live).toMatch(/start_console/);
    expect(live).toMatch(/_start_visible/);
    expect(live).toMatch(/runtime\.console/);
    // 反向：有 start_console 还只走 start_process 装依赖 = 装在不通电的插座上。
    expect(live).toMatch(/npm ci --ignore-scripts/);
    const provider = read("slide-rule-python/services/e2b_workspace_provider.py");
    expect(provider).toContain("sandbox.pty");
    expect(provider).toContain("CONSOLE_TYPE_INTERVAL");
    const route = read("slide-rule-python/routes/project_runtime.py");
    expect(route).toContain('event.type == "runtime.console"');

    // 服务端一直在发 operationId，前端此前全程丢掉——这三处缺一处就订阅不到。
    const session = read("client/src/pages/sliderule/useSlideRuleSession.ts");
    expect(session).toContain("operationId: event.operationId");
    expect(session).toContain("onControlToolStart: (tool: string, summary?: string, operationId?: string)");
    expect(session).toContain("projectToolStillOpen");
    const driver = read("client/src/lib/sliderule-marathon-driver.ts");
    const driverLive = driver.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(driverLive).toMatch(/case "control_tool_start"/);
    expect(driverLive).toMatch(/event\.operationId/);
    const activity = read("client/src/pages/sliderule/project-activity.ts");
    expect(activity).toContain("open.operationId = operationId");
    expect(activity).toContain("followProjectActionId");
    const hook = read("client/src/pages/sliderule/project-runtime/useSandboxLog.ts");
    const hookLive = hook.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(hook).toContain("/events/stream?afterSeq=");
    expect(hookLive).toContain("new EventSource");
    expect(hookLive).toContain("withCredentials: true");
    expect(hookLive).not.toMatch(/setInterval/);
    expect(hookLive).not.toMatch(/\/events\?afterSeq=/);
    expect(hook).toContain("export function useSandboxLogs");
  });
});
