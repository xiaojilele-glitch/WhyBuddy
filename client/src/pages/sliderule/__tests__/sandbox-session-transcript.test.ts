/**
 * 终端会话怎么拼：有命令才写 `$`，有日志才铺日志，不许编一台 ubuntu。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  followSandboxOperationId,
  sandboxActivityTranscript,
  sandboxCommandLine,
  sandboxLogOperationIds,
  sandboxSessionTranscript,
  sandboxTransferLine,
} from "../sandbox-session-transcript";

describe("哪一句能当命令", () => {
  it("exec / logs 的摘要就是命令", () => {
    expect(sandboxCommandLine({ tool: "project_exec", detail: "pnpm run build" }))
      .toBe("pnpm run build");
    expect(sandboxCommandLine({ tool: "project_logs", detail: "tail -f app.log" }))
      .toBe("tail -f app.log");
  });

  it("反向：写入源码的文件列表不是一条 shell，不许套 `$`", () => {
    expect(
      sandboxCommandLine({
        tool: "project_patch",
        detail: "src/Home.tsx、src/api/tasks.ts",
      })
    ).toBeNull();
    expect(sandboxCommandLine({ tool: "project_exec", detail: "" })).toBeNull();
    expect(sandboxCommandLine({ tool: "project_exec" })).toBeNull();
  });
});

describe("会话怎么铺", () => {
  it("有命令有输出：先 `$ cmd` 再日志", () => {
    const out = sandboxSessionTranscript({
      command: "pnpm run build",
      logText: "vite v7 built in 3s\n✓ built",
      running: false,
    });
    expect(out.lines[0]).toBe("$ pnpm run build");
    expect(out.lines).toContain("vite v7 built in 3s");
    expect(out.lines).toContain("✓ built");
    expect(out.cursor).toBe(false);
    expect(out.idlePrompt).toBe(true);
  });

  it("还在跑：光标亮着，不许先画一个闲置提示符", () => {
    const out = sandboxSessionTranscript({
      command: "build",
      logText: "installing…",
      running: true,
    });
    expect(out.cursor).toBe(true);
    expect(out.idlePrompt).toBe(false);
  });

  it("反向：没有命令就不许冒出 `$ undefined` / `$ null`", () => {
    const out = sandboxSessionTranscript({
      command: null,
      logText: "added 21 packages",
      running: false,
    });
    expect(out.lines[0]).toBe("added 21 packages");
    expect(out.lines.some(line => line.startsWith("$ "))).toBe(false);
  });

  it("宿主已经画了提示符时，会话里不许再叠一个闲置 `$`", () => {
    const out = sandboxSessionTranscript({
      command: "build",
      logText: "ok",
      running: false,
      dockedPrompt: true,
    });
    expect(out.idlePrompt).toBe(false);
    expect(out.cursor).toBe(false);
  });
});

describe("文件动作收成传输日志，不是 shell", () => {
  it("有脱敏路径才写 put/get/create", () => {
    expect(
      sandboxTransferLine({ tool: "project_patch", detail: "src/i18n/translations.ts" })
    ).toBe("put src/i18n/translations.ts");
    expect(
      sandboxTransferLine({ tool: "project_write", detail: "src/App.tsx" })
    ).toBe("put src/App.tsx");
    expect(
      sandboxTransferLine({ tool: "project_str_replace", detail: "src/App.tsx" })
    ).toBe("put src/App.tsx");
    expect(
      sandboxTransferLine({ tool: "file_write", detail: "src/App.tsx" })
    ).toBe("put src/App.tsx");
    expect(
      sandboxTransferLine({ tool: "file_str_replace", detail: "src/App.tsx" })
    ).toBe("put src/App.tsx");
    expect(sandboxTransferLine({ tool: "project_read", detail: "package.json" })).toBe(
      "get package.json"
    );
    expect(sandboxTransferLine({ tool: "file_read", detail: "package.json" })).toBe(
      "get package.json"
    );
    expect(sandboxTransferLine({ tool: "project_create", detail: "react-vite" })).toBe(
      "create react-vite"
    );
  });

  it("反向：没有摘要就不写，也不许把 patch 收成 `$`", () => {
    expect(sandboxTransferLine({ tool: "project_patch", detail: "" })).toBeNull();
    expect(sandboxTransferLine({ tool: "project_exec", detail: "build" })).toBeNull();
    expect(sandboxCommandLine({ tool: "project_patch", detail: "src/Home.tsx" })).toBeNull();
  });

  it("整段会话按发生顺序铺：create / get / put / $ cmd，日志只挂对得上的 exec", () => {
    const out = sandboxActivityTranscript({
      rows: [
        { tool: "project_create", detail: "react-vite" },
        { tool: "project_read", detail: "package.json" },
        { tool: "project_patch", detail: "src/i18n/translations.ts" },
        { tool: "project_exec", detail: "pnpm run build", operationId: "op-build" },
        { tool: "project_exec", detail: "pnpm test", operationId: "op-test" },
      ],
      logText: "vite v7 built in 3s",
      logOperationId: "op-build",
      running: false,
    });
    expect(out.lines).toEqual([
      "create react-vite",
      "get package.json",
      "put src/i18n/translations.ts",
      "$ pnpm run build",
      "vite v7 built in 3s",
      "$ pnpm test",
    ]);
    expect(out.lines.some(line => line.startsWith("$ src/"))).toBe(false);
  });

  it("每条 exec 挂自己的 stdout：只订当前一步时上一条会丢", () => {
    const out = sandboxActivityTranscript({
      rows: [
        { tool: "project_exec", detail: "pnpm install", operationId: "op-install" },
        { tool: "project_exec", detail: "pnpm run build", operationId: "op-build" },
      ],
      logs: {
        "op-install": "added 21 packages",
        "op-build": "vite v7 built in 3s",
      },
      running: false,
    });
    expect(out.lines).toEqual([
      "$ pnpm install",
      "added 21 packages",
      "$ pnpm run build",
      "vite v7 built in 3s",
    ]);
  });

  it("反向：logs 里没有的 id 不许拿别人的 stdout 凑", () => {
    const out = sandboxActivityTranscript({
      rows: [
        { tool: "project_exec", detail: "install", operationId: "op-a" },
        { tool: "project_exec", detail: "build", operationId: "op-b" },
      ],
      logs: { "op-b": "built" },
      logText: "secret stdout",
      logOperationId: "op-other",
      running: false,
    });
    expect(out.lines).toEqual(["$ install", "$ build", "built"]);
    expect(out.lines).not.toContain("secret stdout");
  });

  it("反向：日志对不上 operationId 就不铺——贴过来就是编", () => {
    const out = sandboxActivityTranscript({
      rows: [{ tool: "project_exec", detail: "build", operationId: "op-a" }],
      logText: "secret stdout",
      logOperationId: "op-other",
      running: true,
    });
    expect(out.lines).toEqual(["$ build"]);
    expect(out.lines).not.toContain("secret stdout");
    expect(out.cursor).toBe(true);
  });
});

describe("右侧终端订哪一条", () => {
  const install = {
    id: "row-install",
    tool: "project_exec",
    detail: "npm install",
    operationId: "op-install",
    status: "done",
  };
  const testCmd = {
    id: "row-test",
    tool: "project_exec",
    detail: "npm test",
    operationId: "op-test",
    status: "running",
  };
  const listCmd = {
    id: "row-list",
    tool: "project_exec",
    detail: "npm list",
    operationId: "op-list",
    status: "done",
  };

  it("没点左栏：正在跑的那条优先于后写完的 list", () => {
    expect(
      followSandboxOperationId([install, testCmd, listCmd])
    ).toBe("op-test");
  });

  it("没点左栏、都停了：跟最后一条命令", () => {
    expect(
      followSandboxOperationId([
        install,
        { ...testCmd, status: "done" },
        listCmd,
      ])
    ).toBe("op-list");
  });

  it("点了左栏某一条终端：只订那一条，不许偷偷跟最新", () => {
    expect(
      followSandboxOperationId([install, testCmd, listCmd], {
        focusId: "row-install",
      })
    ).toBe("op-install");
  });

  it("点的不是终端行：仍跟正在跑的命令，不许退到 npm ci", () => {
    expect(
      followSandboxOperationId(
        [
          { id: "row-patch", tool: "project_patch", detail: "src/App.tsx", operationId: "op-patch" },
          testCmd,
        ],
        { focusId: "row-patch", runtimeOperationId: "op-runtime" }
      )
    ).toBe("op-test");
  });

  it("反向：点的不是终端行、又没有任何命令，才空着——不许订 runtime.start", () => {
    expect(
      followSandboxOperationId(
        [
          { id: "row-patch", tool: "project_patch", detail: "src/App.tsx", operationId: "op-patch" },
        ],
        { focusId: "row-patch", runtimeOperationId: "op-runtime" }
      )
    ).toBeNull();
  });

  it("反向：没有命令时才退到 runtime.start，有 exec 不许捎带把预览那条拼进来", () => {
    expect(
      followSandboxOperationId([listCmd], { runtimeOperationId: "op-runtime" })
    ).toBe("op-list");
    expect(
      followSandboxOperationId(
        [{ id: "row-patch", tool: "project_patch", detail: "src/App.tsx" }],
        { runtimeOperationId: "op-runtime" }
      )
    ).toBe("op-runtime");
  });

  it("正在跑但还没有 operationId：空等，不许退到 npm ci 那条 runtime", () => {
    expect(
      followSandboxOperationId(
        [
          {
            id: "row-test",
            tool: "project_exec",
            detail: "npm test",
            status: "running",
          },
        ],
        { runtimeOperationId: "op-runtime" }
      )
    ).toBeNull();
    expect(
      followSandboxOperationId(
        [
          install,
          {
            id: "row-test",
            tool: "project_exec",
            detail: "npm test",
            status: "running",
          },
        ],
        { runtimeOperationId: "op-runtime" }
      )
    ).toBeNull();
  });
});

describe("订哪些 operation 的日志", () => {
  it("只收真跑过命令的 id，patch 不订", () => {
    expect(
      sandboxLogOperationIds([
        { tool: "project_patch", detail: "src/App.tsx", operationId: "op-patch" },
        { tool: "project_exec", detail: "pnpm install", operationId: "op-install" },
        { tool: "project_exec", detail: "pnpm run build", operationId: "op-build" },
      ])
    ).toEqual(["op-install", "op-build"]);
  });

  it("超限时保住正在跑的那条，不许只剩最新几条把热的挤掉", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      tool: "project_exec",
      detail: `cmd-${i}`,
      operationId: `op-${i}`,
    }));
    const ids = sandboxLogOperationIds(rows, { limit: 3, hotId: "op-0" });
    expect(ids).toContain("op-0");
    expect(ids).toContain("op-13");
    expect(ids).toHaveLength(3);
    expect(
      sandboxLogOperationIds(rows, { limit: 3, hotId: "op-missing" })
    ).not.toContain("op-0");
  });
});

describe("终端不是源码树：不许把 GET /source 当脸", () => {
  it("写入和命令按发生顺序铺，不先倒一份路径清单", () => {
    const out = sandboxActivityTranscript({
      rows: [
        { tool: "project_patch", detail: "src/App.tsx" },
        { tool: "project_exec", detail: "pnpm run build", operationId: "op-build" },
      ],
      logs: { "op-build": "vite v7 built in 3s" },
      running: false,
    });
    expect(out.lines).toEqual([
      "put src/App.tsx",
      "$ pnpm run build",
      "vite v7 built in 3s",
    ]);
    expect(out.lines.join("\n")).not.toMatch(/\$ find\b/);
    expect(out.lines.join("\n")).not.toMatch(/ubuntu@/);
  });

  it("反向：源码不许再收 projectPaths——加回去就是又把清单当脸", () => {
    const src = readFileSync(
      resolve(__dirname, "../sandbox-session-transcript.ts"),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toContain("projectPaths");
    expect(src).not.toContain("sandboxProjectListing");
  });
});

describe("反向：整段不许出现 ubuntu@ 或 ~$（那是别人的机器）", () => {
  it("反向：整段不许出现 ubuntu@ 或 ~$（那是别人的机器）", () => {
    const src = [
      sandboxCommandLine({ tool: "project_exec", detail: "build" }),
      ...sandboxSessionTranscript({
        command: "build",
        logText: "ok",
        running: false,
      }).lines,
    ].join("\n");
    expect(src).not.toMatch(/ubuntu@/);
    expect(src).not.toMatch(/~\$/);
  });
});
