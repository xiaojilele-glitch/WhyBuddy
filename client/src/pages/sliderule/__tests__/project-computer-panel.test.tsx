/**
 * 「它的电脑」面板：看得见它在干什么，而且不许说它做不到的事。
 *
 * 2026-09-13，对照 Manus 截图第 4 件。三组判据：
 *
 *   1. 有动作才有面板（没事件不造界面）
 *   2. 细节只来自服务端脱敏摘要，没有就明说没有——**不拿工具名凑一段**
 *   3. 「实时」不许骗人：动作停了、或用户倒回去看历史，就不许再亮
 *
 * ⚠ 第 3 组是重点。一个永远亮着的「实时」灯比没有更坏：它让人以为还在跑。
 *   跟 §7「不许端出成功但内容为空」是同一件事。
 *
 * ⚠ 交互（点上一步）走**纯函数** `projectComputerView`，不点按钮：本仓的
 *   组件判据是 `react-dom/server` 静态渲染，点不了。决策抽在纯函数里，
 *   正反两面都测得到，组件只负责画。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectComputerPanel } from "../ProjectComputerPanel";
import {
  deriveProjectActivity,
  projectComputerView,
} from "../project-activity";
import type { TurnStep, UiTurn } from "../types";

function turnOf(
  steps: Array<{
    id: string;
    capabilityId: string;
    progressType?: "acting" | "completed" | "failed";
    projectDetail?: string;
  }>
): UiTurn {
  return {
    id: "t1",
    user: "构建一个服务台",
    status: "streaming",
    steps: steps.map(
      step =>
        ({
          ...step,
          kind: "chip",
          roleId: "system",
          label: step.capabilityId,
          realLlm: false,
        }) as unknown as TurnStep
    ),
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "",
    assistantSource: "llm",
    main: null,
    actions: [],
  };
}

const html = (turn: UiTurn, embedded = false) =>
  renderToStaticMarkup(<ProjectComputerPanel turns={[turn]} embedded={embedded} />);

describe("没动作就没有面板", () => {
  it("一条工程动作都没有 → 什么都不渲染", () => {
    expect(html(turnOf([]))).toBe("");
  });

  it("反向：只有非工程步骤也不渲染", () => {
    expect(
      html(turnOf([{ id: "a", capabilityId: "intent.parse", progressType: "completed" }]))
    ).toBe("");
  });
});

describe("细节只来自脱敏摘要", () => {
  it("有摘要就原样摊开", () => {
    const out = html(
      turnOf([
        {
          id: "a",
          capabilityId: "project_patch",
          progressType: "acting",
          projectDetail: "src/Home.tsx、src/api/tasks.ts",
        },
      ])
    );
    expect(out).toContain('data-testid="project-computer-detail"');
    expect(out).toContain("src/Home.tsx、src/api/tasks.ts");
  });

  it("反向：没有摘要就明说没有，不拿工具名凑一段假细节", () => {
    const out = html(
      turnOf([{ id: "a", capabilityId: "project_verify", progressType: "acting" }])
    );
    expect(out).not.toContain('data-testid="project-computer-detail"');
    expect(out).toContain("没有可展示的细节");
  });
});

describe("「实时」不许骗人", () => {
  const rowsOf = (
    steps: Parameters<typeof turnOf>[0]
  ) => deriveProjectActivity([turnOf(steps)]);

  it("有动作在跑且跟随最新 → 亮", () => {
    const rows = rowsOf([
      { id: "a", capabilityId: "project_exec", progressType: "acting" },
    ]);
    expect(projectComputerView(rows, null).live).toBe(true);
    expect(html(turnOf([{ id: "a", capabilityId: "project_exec", progressType: "acting" }])))
      .toContain("实时");
  });

  it("反向：动作全部结束 → 不许再亮", () => {
    const rows = rowsOf([
      { id: "a", capabilityId: "project_exec", progressType: "acting" },
      { id: "b", capabilityId: "project_exec", progressType: "completed" },
    ]);
    expect(projectComputerView(rows, null).live).toBe(false);
    const out = html(
      turnOf([
        { id: "a", capabilityId: "project_exec", progressType: "acting" },
        { id: "b", capabilityId: "project_exec", progressType: "completed" },
      ])
    );
    expect(out).not.toContain("实时");
    expect(out).toContain("1 / 1");
  });

  it("反向：用户倒回去看历史时，即使还在跑也不许亮", () => {
    const rows = rowsOf([
      { id: "a", capabilityId: "project_create", progressType: "completed" },
      { id: "b", capabilityId: "project_exec", progressType: "acting" },
    ]);
    // 跟随最新 → 亮
    expect(projectComputerView(rows, null).live).toBe(true);
    // 钉住第 0 条 → 不亮，而且摊开的确实是上一条
    const pinnedView = projectComputerView(rows, 0);
    expect(pinnedView.live).toBe(false);
    expect(pinnedView.following).toBe(false);
    expect(pinnedView.current?.tool).toBe("project_create");
  });

  it("反向：游标越界不许崩，也不许把 live 算错", () => {
    const rows = rowsOf([
      { id: "a", capabilityId: "project_exec", progressType: "acting" },
    ]);
    const view = projectComputerView(rows, 99);
    expect(view.index).toBe(0);
    expect(view.current?.tool).toBe("project_exec");
    // 钉住状态下即使越界回落到最后一条，也仍然算「用户在看历史」——
    // 不许因为下标碰巧等于最新就偷偷把实时灯点亮。
    expect(view.live).toBe(false);
  });

  it("反向：一条动作都没有时不崩", () => {
    const view = projectComputerView([], null);
    expect(view.current).toBeNull();
    expect(view.live).toBe(false);
  });
});

describe("嵌进整块电脑面时画原始 PTY，不画说明书", () => {
  it("永远是 xterm 面，不许再套工具名片或 $ cmd 拼贴", () => {
    const out = html(
      turnOf([
        {
          id: "a",
          capabilityId: "project_exec",
          progressType: "acting",
          projectDetail: "pnpm run build",
        },
      ]),
      true
    );
    expect(out).toContain('data-testid="project-computer-pty"');
    expect(out).toContain('data-testid="project-computer-pty-text"');
    expect(out).toMatch(/data-testid="project-computer-pty-text" class="sr-only"/);
    expect(out).not.toContain('data-testid="project-computer-session"');
    expect(out).not.toContain("$ pnpm run build");
    expect(out).not.toContain('data-testid="project-computer-cursor"');
    expect(out).not.toContain('data-testid="project-computer-promptbar"');
    expect(out).not.toContain("跳到实时");
    expect(out).not.toContain("没有可展示的细节");
    expect(out).not.toContain("命令行输出");
    expect(out).not.toContain("project_exec");
    expect(out).not.toContain("正在运行命令");
    expect(out).not.toMatch(/ubuntu@/);
  });

  it("反向：独立卡片仍摊开脱敏摘要——嵌进那条链不许把这条诚实边界改掉", () => {
    const out = html(
      turnOf([
        {
          id: "a",
          capabilityId: "project_exec",
          progressType: "acting",
          projectDetail: "pnpm run build",
        },
      ])
    );
    expect(out).toContain('data-testid="project-computer-detail"');
    expect(out).toContain("pnpm run build");
    expect(out).not.toContain('data-testid="project-computer-session"');
    expect(out).not.toContain('data-testid="project-computer-pty"');
  });

  it("反向：写入源码不是一条 shell，也不许写成 put 当脸", () => {
    const out = html(
      turnOf([
        {
          id: "a",
          capabilityId: "project_patch",
          progressType: "completed",
          projectDetail: "src/Home.tsx、src/api/tasks.ts",
        },
      ]),
      true
    );
    expect(out).toContain('data-testid="project-computer-pty"');
    expect(out).not.toContain('data-testid="project-computer-session"');
    expect(out).not.toContain("put src/Home.tsx");
    expect(out).not.toContain("$ src/Home.tsx");
    expect(out).not.toContain('data-testid="project-computer-promptbar"');
    expect(out).not.toContain('data-testid="project-computer-idle"');
  });

  it("反向：create/get/put 不许充屏——那是传输日志，不是 PTY", () => {
    const out = html(
      turnOf([
        {
          id: "a",
          capabilityId: "project_create",
          progressType: "completed",
          projectDetail: "react-vite",
        },
        {
          id: "b",
          capabilityId: "project_read",
          progressType: "completed",
          projectDetail: "package.json",
        },
        {
          id: "c",
          capabilityId: "project_patch",
          progressType: "completed",
          projectDetail: "src/i18n/translations.ts",
        },
      ]),
      true
    );
    expect(out).toContain('data-testid="project-computer-pty"');
    expect(out).not.toContain("create react-vite");
    expect(out).not.toContain("get package.json");
    expect(out).not.toContain("put src/i18n/translations.ts");
  });
});
