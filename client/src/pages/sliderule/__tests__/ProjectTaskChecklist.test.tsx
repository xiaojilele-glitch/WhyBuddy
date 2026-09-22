/**
 * 工程动作流：**发生了什么就显示什么**。
 *
 * 2026-09-13 从「固定六行清单」改成涌现式（见 `project-activity.ts` 头注）。
 * 这份判据分两半：
 *
 *   · 前三条是**原来就有的诚实性质**，改实现不许丢：没事件不造清单、
 *     只有 completed 才算完成、失败要留在台面上。
 *   · 后几条钉新行为：模板之外的工具要有行、同一工具跑几次就是几行、
 *     细节来自结构化字段而不是解析文案。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectTaskChecklist } from "../ProjectTaskChecklist";
import {
  chipFromControlTranscriptRow,
  deriveProjectActivity,
  followProjectActionId,
  projectActionDetail,
  projectActionLabel,
  projectActivityProgress,
  projectToolStillOpen,
  weaveTranscriptChips,
} from "../project-activity";
import type { UiTurn } from "../types";

function turn(
  steps: Array<{
    id: string;
    capabilityId: string;
    progressType?: "acting" | "completed" | "failed";
    projectDetail?: string;
    operationId?: string;
  }>,
  status: UiTurn["status"] = "complete"
): UiTurn {
  return {
    id: "turn-1",
    user: "build a project",
    status,
    steps: steps.map(step => ({
      ...step,
      capabilityId: step.capabilityId as never,
      kind: "chip" as const,
      roleId: "system",
      label: step.capabilityId,
      realLlm: false,
    })),
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "",
    assistantSource: "fallback",
    main: null,
    actions: [],
  };
}

describe("原来就有的三条诚实性质（改实现不许丢）", () => {
  it("没有任何工程事件时不凭空造清单", () => {
    expect(deriveProjectActivity([turn([])])).toEqual([]);
  });

  it("只有 completed 能算完成——acting 不行", () => {
    const rows = deriveProjectActivity([
      turn([
        { id: "a", capabilityId: "project_create", progressType: "completed" },
        { id: "b", capabilityId: "project_patch", progressType: "acting" },
      ]),
    ]);
    expect(rows.map(r => [r.tool, r.status])).toEqual([
      ["project_create", "done"],
      ["project_patch", "running"],
    ]);
    expect(projectActivityProgress(rows)).toEqual({ done: 1, total: 2, failed: 0 });
  });

  it("失败要留在台面上，不被后续动作抹掉", () => {
    const rows = deriveProjectActivity([
      turn([
        { id: "a", capabilityId: "project_verify", progressType: "acting" },
        { id: "b", capabilityId: "project_verify", progressType: "failed" },
        { id: "c", capabilityId: "project_status", progressType: "acting" },
        { id: "d", capabilityId: "project_status", progressType: "completed" },
      ]),
    ]);
    expect(rows.find(r => r.tool === "project_verify")?.status).toBe("failed");
    expect(projectActivityProgress(rows).failed).toBe(1);
  });
});

describe("模板之外的动作也要显示（这是改它的理由）", () => {
  it("restore / export 这类不在原六行里的工具，各自有行", () => {
    const rows = deriveProjectActivity([
      turn([
        { id: "a", capabilityId: "project_restore", progressType: "completed" },
        { id: "b", capabilityId: "project_export", progressType: "completed" },
      ]),
    ]);
    expect(rows.map(r => r.tool)).toEqual(["project_restore", "project_export"]);
    expect(rows.map(r => r.label)).toEqual(["恢复到历史版本", "导出源码"]);
  });

  it("泄漏包的 file_* / shell_* 也有行，不因为不是 project_ 前缀而消失", () => {
    const rows = deriveProjectActivity([
      turn([
        { id: "a", capabilityId: "file_write", progressType: "completed" },
        { id: "b", capabilityId: "shell_exec", progressType: "completed" },
      ]),
    ]);
    expect(rows.map(r => r.tool)).toEqual(["file_write", "shell_exec"]);
    expect(rows.map(r => r.label)).toEqual(["写入源码", "运行命令"]);
  });

  it("完全没见过的 project_* 工具也有行，不静静消失", () => {
    const rows = deriveProjectActivity([
      turn([
        { id: "a", capabilityId: "project_brand_new", progressType: "completed" },
      ]),
    ]);
    expect(rows).toHaveLength(1);
    expect(projectActionLabel("project_brand_new")).toBe("brand_new");
  });

  it("skill 也有行，脸上是加载技能", () => {
    const rows = deriveProjectActivity([
      turn([
        {
          id: "sk",
          capabilityId: "skill",
          progressType: "completed",
          projectDetail: "frontend-design",
        },
      ]),
    ]);
    expect(rows).toEqual([
      {
        id: "sk",
        tool: "skill",
        label: "加载技能",
        status: "done",
        detail: "frontend-design",
      },
    ]);
    expect(projectActionLabel("skill")).toBe("加载技能");
  });

  it("反向：非工程步骤不许混进来", () => {
    const rows = deriveProjectActivity([
      turn([
        { id: "a", capabilityId: "intent.parse", progressType: "completed" },
        { id: "b", capabilityId: "factory.pages", progressType: "completed" },
      ]),
    ]);
    expect(rows).toEqual([]);
  });
});

describe("同一工具跑几次就是几行（原实现会折成一行）", () => {
  it("连跑三次 patch → 三行，中间那次失败留得住", () => {
    const rows = deriveProjectActivity([
      turn([
        { id: "a1", capabilityId: "project_patch", progressType: "acting" },
        { id: "a2", capabilityId: "project_patch", progressType: "completed" },
        { id: "b1", capabilityId: "project_patch", progressType: "acting" },
        { id: "b2", capabilityId: "project_patch", progressType: "failed" },
        { id: "c1", capabilityId: "project_patch", progressType: "acting" },
        { id: "c2", capabilityId: "project_patch", progressType: "completed" },
      ]),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.status)).toEqual(["done", "failed", "done"]);
    // 变异写清楚：改回 Map<capabilityId> 归并，这里会变成 1 行。
    expect(projectActivityProgress(rows)).toEqual({ done: 2, total: 3, failed: 1 });
  });

  it("只剩结果没有开场（刷新后从持久化恢复的形态）也要成行", () => {
    const rows = deriveProjectActivity([
      turn([
        { id: "only", capabilityId: "project_exec", progressType: "completed" },
      ]),
    ]);
    expect(rows).toEqual([
      { id: "only", tool: "project_exec", label: "运行命令", status: "done" },
    ]);
  });

  it("跨轮次的动作按发生顺序连起来", () => {
    const rows = deriveProjectActivity([
      turn([{ id: "a", capabilityId: "project_create", progressType: "completed" }]),
      turn([{ id: "b", capabilityId: "project_start", progressType: "acting" }]),
    ]);
    expect(rows.map(r => r.tool)).toEqual(["project_create", "project_start"]);
  });
});

describe("细节来自结构化字段，不解析文案", () => {
  it("exec 说出真实命令", () => {
    expect(projectActionDetail({ command: "pnpm run build", exitCode: 0 })).toBe(
      "pnpm run build"
    );
  });

  it("坏消息优先：错误盖过命令", () => {
    expect(
      projectActionDetail({ command: "pnpm run build", error: "project_revision_conflict" })
    ).toBe("project_revision_conflict");
  });

  it("非零退出码说得出来", () => {
    expect(projectActionDetail({ exitCode: 1 })).toBe("退出码 1");
  });

  it("patch 说出版本迁移", () => {
    expect(
      projectActionDetail({ parentRevision: "rev-aaaaaaaaaaaaaaa", revision: "rev-bbbbbbbbbbbbbbb" })
    ).toBe("rev-aaaaaaaa → rev-bbbbbbbb");
  });

  it("写入结果优先说 path，不许被版本号盖掉", () => {
    expect(
      projectActionDetail({
        path: "src/components/CreateModal.tsx",
        parentRevision: "rev-aaaaaaaaaaaaaaa",
        revision: "rev-bbbbbbbbbbbbbbb",
      })
    ).toBe("src/components/CreateModal.tsx");
    expect(
      projectActionDetail({
        changedFiles: ["src/pages/Todos.tsx", "src/api/tasks.ts"],
        revision: "rev-bbbbbbbbbbbbbbb",
      })
    ).toBe("src/pages/Todos.tsx、src/api/tasks.ts");
  });

  it("反向：拿不到细节就是没有，不许用 kind 之类的内部名凑数", () => {
    expect(projectActionDetail({ kind: "runtime.command", status: "completed" })).toBe("");
    expect(projectActionDetail({})).toBe("");
    expect(projectActionDetail(null)).toBe("");
    expect(projectActionDetail({ exitCode: 0 })).toBe("");
  });

  it("没点过：亮着队尾正在跑的那一行，不许整列都不亮", () => {
    const html = renderToStaticMarkup(
      <ProjectTaskChecklist
        turns={[
          turn(
            [
              { id: "a", capabilityId: "project_patch", progressType: "completed" },
              { id: "b", capabilityId: "project_exec", progressType: "acting" },
            ],
            "streaming"
          ),
        ]}
      />
    );
    expect(html).toMatch(
      /data-task-id="project_exec"[^>]*data-selected="true"/
    );
    expect(html).toMatch(
      /data-task-id="project_patch"[^>]*data-selected="false"/
    );
    expect(followProjectActionId(
      deriveProjectActivity([
        turn([
          { id: "a", capabilityId: "project_patch", progressType: "completed" },
          { id: "b", capabilityId: "project_exec", progressType: "acting" },
        ]),
      ]),
      null
    )).toBe("b");
    expect(followProjectActionId(
      [{ id: "a" }, { id: "b" }],
      "a"
    )).toBe("a");
  });

  it("execute 补上的 operationId 合进开着的那一行，不许裂成两步", () => {
    const rows = deriveProjectActivity([
      turn([
        { id: "a", capabilityId: "project_exec", progressType: "acting", projectDetail: "npm test" },
        {
          id: "b",
          capabilityId: "project_exec",
          progressType: "acting",
          projectDetail: "npm test",
          operationId: "op-test",
        },
      ]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "a",
      status: "running",
      detail: "npm test",
      operationId: "op-test",
    });
  });

  it("反向：已经有 id 的开着的命令 + 下一步同名工具，不许合成一行", () => {
    const rows = deriveProjectActivity([
      turn([
        {
          id: "a",
          capabilityId: "project_exec",
          progressType: "acting",
          projectDetail: "npm test",
          operationId: "op-test",
        },
        {
          id: "b",
          capabilityId: "project_exec",
          progressType: "acting",
          projectDetail: "npm run lint",
        },
      ]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.detail)).toEqual(["npm test", "npm run lint"]);
  });

  it("回执还在 running：行继续开着，刷新日志也要把 id 带上", () => {
    expect(projectToolStillOpen({ ok: true, status: "running" })).toBe(true);
    expect(projectToolStillOpen({ ok: true, status: "queued" })).toBe(true);
    expect(projectToolStillOpen({ ok: true, status: "completed" })).toBe(false);
    expect(projectToolStillOpen({ ok: false, status: "running" })).toBe(false);
    expect(projectToolStillOpen({ ok: true })).toBe(false);
    const skillStart = chipFromControlTranscriptRow({
      kind: "tool_start",
      tool: "skill",
      summary: "frontend-design",
    });
    expect(skillStart).toMatchObject({
      progressType: "acting",
      projectDetail: "frontend-design",
      label: "正在加载技能",
    });
    const start = chipFromControlTranscriptRow({
      kind: "tool_start",
      tool: "project_exec",
      summary: "npm test",
      operationId: "op-test",
    });
    expect(start).toMatchObject({
      progressType: "acting",
      projectDetail: "npm test",
      operationId: "op-test",
    });
    const open = chipFromControlTranscriptRow({
      kind: "tool_result",
      tool: "project_exec",
      ok: true,
      status: "running",
      detail: "npm test",
      operationId: "op-test",
    });
    expect(open).toMatchObject({
      progressType: "acting",
      operationId: "op-test",
    });
    const done = chipFromControlTranscriptRow({
      kind: "tool_result",
      tool: "project_exec",
      ok: true,
      status: "completed",
      operationId: "op-test",
    });
    expect(done?.progressType).toBe("completed");
  });

  it("细节挂到对应那一行上", () => {
    const rows = deriveProjectActivity([
      turn([
        { id: "a", capabilityId: "project_exec", progressType: "acting" },
        {
          id: "b",
          capabilityId: "project_exec",
          progressType: "completed",
          projectDetail: "pnpm run build",
        },
      ]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toBe("pnpm run build");
  });

  it("日志工具织回叙述占位，不许把开口全部赶到工具前面", () => {
    const speech = (id: string, text: string) =>
      ({ id, kind: "model_speech" as const, text });
    const slot = (id: string) =>
      ({
        id,
        kind: "chip" as const,
        capabilityId: "project_patch" as never,
        roleId: "system",
        label: "写入源码",
        realLlm: false,
        progressType: "completed" as const,
      });
    const log = [
      { ...slot("log-1"), projectDetail: "src/main.tsx" },
      { ...slot("log-2"), projectDetail: "src/style.css" },
    ];
    const weaved = weaveTranscriptChips(
      [speech("s1", "先改入口。"), slot("n1"), speech("s2", "再补样式。"), slot("n2")],
      log
    );
    expect(weaved.map(step =>
      step.kind === "chip" ? step.projectDetail : "text" in step ? step.text : undefined
    )).toEqual([
      "先改入口。",
      "src/main.tsx",
      "再补样式。",
      "src/style.css",
    ]);
  });
});
