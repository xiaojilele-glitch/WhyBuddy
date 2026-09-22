// @vitest-environment jsdom
/**
 * 右侧是一块电脑，不是终端卡叠预览卡。
 *
 * 2026-09-14 对照 Manus：干活看终端、跑起来看预览，同一块外壳切档。
 * 判据落在**渲染后的 DOM 父子关系**上（§5），再配一条剥注释的通电链
 * （§1 / §3）：Studio 必须把 turns 交给预览面，不许自己再叠一份面板。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideRuleStudio } from "../SlideRuleStudio";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import { ProjectTaskChecklist } from "../ProjectTaskChecklist";
import {
  projectModeLabels,
  projectModeValue,
  selectProjectMode,
} from "./fixtures/select-project-mode";
import type { TurnStep, UiTurn } from "../types";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (relative: string) =>
  stripComments(readFileSync(resolve(__dirname, relative), "utf8"));

function projectTurn(
  status: "acting" | "completed",
  extra: { projectDetail?: string; operationId?: string } = {}
): UiTurn {
  return {
    id: "t1",
    user: "做一个任务台",
    status: status === "acting" ? "streaming" : "complete",
    steps: [
      {
        id: "a",
        kind: "chip",
        capabilityId: "project_exec",
        roleId: "system",
        label: "运行命令",
        realLlm: false,
        progressType: status,
        ...extra,
      } as unknown as TurnStep,
    ],
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "",
    assistantSource: "llm",
    main: null,
    actions: [],
  };
}

let root: Root;
let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;

class FakeEventSource {
  static opened: string[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  url: string;
  private closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.opened.push(url);
    queueMicrotask(() => void this.pump());
  }
  private async pump() {
    if (this.closed) return;
    const pageUrl = this.url.replace("/events/stream", "/events");
    try {
      const response = await fetch(pageUrl, { credentials: "include" });
      const body = (await response.json()) as { events?: unknown[] };
      for (const event of body.events || []) {
        if (this.closed) return;
        this.onmessage?.({ data: JSON.stringify(event) });
      }
    } catch {
      if (!this.closed) this.onerror?.();
    }
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  FakeEventSource.opened = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  fetcher = vi.fn(async (url: string) => {
    const path = String(url);
    if (path.includes("/source") && !path.includes("/source/file")) {
      return Response.json({
        projectId: "project-one",
        revision: "revision-one",
        currentRevision: "revision-one",
        files: [
          { path: "package.json", sha256: "hash-pkg", sizeBytes: 2 },
          { path: "src/App.tsx", sha256: "hash-app", sizeBytes: 4 },
        ],
      });
    }
    return Response.json({
      operationId: "operation-one",
      available: true,
      reason: null,
      descriptor: {
        kind: "project",
        projectId: "project-one",
        runtimeId: "runtime-one",
        revision: "revision-one",
        status: "executing",
        entryUrl: null,
      },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const $ = <T extends Element = HTMLElement>(testid: string) =>
  container.querySelector<T>(`[data-testid="${testid}"]`);

describe("通电链：Studio 把动作流交给电脑面，自己不再叠一份", () => {
  it("SandboxPreviewSurface 的调用带着 turns，源码里没有叠层残骸", () => {
    const studio = read("../SlideRuleStudio.tsx");
    const start = studio.indexOf("<SandboxPreviewSurface");
    expect(start, "ProjectStudio 必须渲染预览面").toBeGreaterThan(-1);
    const open = studio.slice(start, start + 700);
    expect(open).toMatch(/turns=\{turns\}/);
    expect(open).toMatch(/chromeSlot=\{chromeSlot\}/);
    expect(open).toMatch(/resetSlot=\{resetSlot\}/);
    expect(open).toMatch(/deliverableKind=\{deliverableKind\}/);
    // 反向：叠回去那一版的特征。注释里的 max-h-[38%] 已经被剥掉。
    expect(studio).not.toMatch(/max-h-\[38%\]/);
    expect(studio).not.toMatch(/ProjectComputerPanel/);
    const projectStudio = studio.slice(
      studio.indexOf("function ProjectStudio"),
      studio.indexOf("function HtmlSlideRuleStudio")
    );
    // 反向：重置/分栏再叠在电脑壳上面 = 又是两行顶栏。
    expect(projectStudio).not.toMatch(/ml-auto">\{chromeSlot\}/);
    // 反向：舞台再包一圈 p-3，电脑四周会空出 12px（2026-09-14 真机圈的）。
    expect(projectStudio).not.toMatch(/\bp-3\b/);
    // ⚠ 2026-09-20：藏右栏后仍要挂 chromeSlot，否则只能藏不能开。
    const hidden = projectStudio.slice(projectStudio.indexOf("showStage ?"));
    expect(hidden).toContain("chromeSlot || resetSlot");
    expect(hidden).toContain("{chromeSlot}");
  });

  it("预览面自己按 resolveComputerView 切档，终端是其中一档", () => {
    const surface = read("../project-runtime/SandboxPreviewSurface.tsx");
    expect(surface).toMatch(/resolveComputerView/);
    expect(surface).toMatch(/lastTool/);
    expect(surface).toMatch(/computerNow\.current/);
    expect(surface).toMatch(/computerNow\.live/);
    expect(surface).toMatch(/hasConsole/);
    expect(surface).toMatch(/shouldAutoOpenPreview/);
    expect(surface).toMatch(/shouldAutoWakePreview/);
    expect(surface).toMatch(/deliverableKind/);
    expect(surface).toMatch(/followPath/);
    expect(surface).toMatch(/sourcePathFromActionDetail/);
    const followAt = surface.indexOf("const followPath");
    const follow = surface.slice(followAt, surface.indexOf("const [selecting]", followAt));
    expect(follow).toMatch(/revision: ""/);
    expect(follow).not.toMatch(/revision: String\(projectRevision/);
    expect(surface).toMatch(/<ProjectComputerPanel/);
    expect(surface).toMatch(/embedded/);
    // 反向：工程还没落库就钉死终端 = TicketStream 列文件时那面白纸。
    expect(surface).not.toMatch(/awaitingProject\s*\?\s*userPinned/);
  });

  it("终端不再去拉 GET /source 当脸——那是源码档的事", () => {
    const panel = read("../ProjectComputerPanel.tsx");
    expect(panel).not.toContain("getProjectSource");
    expect(panel).not.toContain("useProjectListing");
    expect(panel).not.toContain("projectPaths");
    expect(panel).toContain("SandboxLiveTerminal");
    expect(panel).not.toContain("project-computer-session");
    expect(panel).not.toContain("sandboxActivityTranscript");
    expect(panel).toMatch(/data-testid="project-computer-pty-text" className="sr-only"/);
    const ptyMark = panel.indexOf('data-testid="project-computer-pty"');
    const pty = panel.slice(Math.max(0, ptyMark - 180), panel.indexOf('data-testid="project-computer-pty-text"'));
    expect(pty).toMatch(/relative min-h-0 flex-1 overflow-hidden/);
    expect(pty).toMatch(/absolute inset-x-3 inset-y-2\.5/);
    expect(pty).not.toMatch(/absolute inset-0/);
    expect(pty).not.toMatch(/className="min-h-0 flex-1"/);
    expect(panel).not.toMatch(/live\s*\?\s*"sr-only"/);
    const open = read("../project-runtime/SandboxPreviewSurface.tsx");
    const call = open.slice(
      open.indexOf("<ProjectComputerPanel"),
      open.indexOf("<ProjectComputerPanel") + 280
    );
    expect(call).not.toContain("projectId=");
  });
});

describe("渲染后：电脑在外壳里面，不在它上头", () => {
  it("有动作在跑 → 终端档亮着，面板是预览面的孩子", async () => {
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          projectRevision="revision-one"
          isRunning
          liveActionLabel="正在运行命令"
          turns={[projectTurn("acting", { projectDetail: "pnpm install" })]}
        />
      )
    );
    const surface = $<HTMLElement>("sandbox-preview-surface");
    const computer = $<HTMLElement>("project-computer-panel");
    expect(surface, "电脑外壳必须在").not.toBeNull();
    expect(computer, "终端面板必须在").not.toBeNull();
    expect(surface!.contains(computer!), "终端必须在外壳里面，不许叠在上头").toBe(
      true
    );
    expect(surface!.className, "贴边铺满时圆角会漏出底色").not.toMatch(
      /rounded-lg/
    );
    expect(surface!.getAttribute("data-computer-view")).toBe("computer");
    // ⚠ 2026-09-16 拉齐强度：这条原来是 `toContain("终端")`，而同一个文件里
    //   应用中心那条（下面「没有会话」那个用例）钉的是**精确列表相等**。
    //   只 contain 的话，少一档、多一档、或者顺序换了都咬不住——而会话态
    //   这六档正是用户天天看的那个下拉。两种形态用同一种强度。
    expect(projectModeLabels(container)).toEqual([
      "终端",
      "预览",
      "代码",
      "版本",
      "数据",
      "交付",
    ]);
    expect(projectModeValue(container)).toBe("computer");
    expect($("project-live-action"), "有会话时不许再占一条「正在运行命令」顶栏").toBeNull();
    expect($("project-computer-chrome"), "会话顶栏必须在").not.toBeNull();
    expect($("project-computer-gears"), "功能必须堆在头条右侧").not.toBeNull();
    expect(
      $("project-computer-gears")!.className,
      "overflow-x-auto 会把菜单裁进矮顶栏"
    ).not.toMatch(/overflow-x-auto/);
    expect($("project-computer-chrome")!.className).toMatch(/\bz-10\b/);
    expect($("project-computer-chrome")!.className).toMatch(/\bpx-3\b/);
    expect($("project-computer-chrome")!.className).toMatch(/\bh-9\b/);
    expect($("project-computer-chrome")!.className).not.toMatch(/\bpx-2\b/);
    expect($("project-computer-chrome")!.className).not.toMatch(/\bh-8\b/);
    expect($("project-preview-open"), "打开预览是真接通的，必须在头条").not.toBeNull();
    expect($("project-computer-promptbar"), "电脑壳上要有 Manus 底栏").toBeTruthy();
    expect(
      computer!.querySelector('[data-testid="project-computer-promptbar"]'),
      "底栏在外壳上，不许再叠进面板"
    ).toBeNull();
    expect(
      $("project-computer-promptbar")!.textContent,
      "Manus 的 $ 在 PTY 里，不在回放栏上"
    ).not.toContain("$");
    expect($("project-computer-live")?.textContent).toBe("实时");
    expect($("project-computer-promptbar")!.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(surface!.textContent).not.toContain("跳到实时");
    expect(surface!.textContent).not.toContain("工程尚未启动");
    expect(surface!.textContent).not.toContain("更新状态");
    expect(surface!.textContent).not.toContain("E2B 沙盒");
    expect(surface!.textContent).not.toContain("点选元素");
    expect(surface!.textContent).not.toContain("点选编辑");
    expect(surface!.textContent).not.toContain("关联");
    expect($("project-computer-pty"), "嵌进的终端必须是原始 PTY，不是说明书").not.toBeNull();
    expect($("project-computer-session")).toBeNull();
    expect($("project-computer-panel")?.textContent).not.toContain("$ pnpm install");
    expect($("project-computer-panel")?.textContent).not.toContain("src/App.tsx");
    expect($("project-computer-panel")?.textContent).not.toMatch(/\bput /);
    expect($("project-computer-panel")?.textContent).not.toMatch(/\$ find\b/);
    expect($("project-computer-detail")).toBeNull();
    expect(computer!.textContent).not.toContain("没有可展示的细节");
    expect(computer!.textContent).not.toContain("命令行输出");
  });

  it("只写入源码时自动开源码档，不许停在空白终端", async () => {
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          projectRevision="revision-one"
          turns={[
            {
              ...projectTurn("completed"),
              steps: [
                {
                  id: "a",
                  kind: "chip",
                  capabilityId: "project_patch",
                  roleId: "system",
                  label: "写入源码",
                  realLlm: false,
                  progressType: "completed",
                  projectDetail: "src/components/Header.tsx",
                } as unknown as TurnStep,
              ],
            },
          ]}
        />
      )
    );
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "source"
    );
    expect($("project-computer-stage")?.getAttribute("data-active")).toBe("false");
    expect($("project-computer-title")?.textContent).toBe("代码");
    expect(
      $("project-workspace-panel"),
      "代码档必须真的挂上源码面板，不许只换标题留白纸"
    ).toBeTruthy();
    expect($("project-source-waiting")).toBeNull();
    expect($("project-verification-panel"), "源码档不许再挂验收条").toBeNull();
    expect($("project-preview-open"), "打开预览不属于代码脸").toBeNull();
    expect($("sandbox-preview-surface")?.textContent).not.toContain("工程尚未启动");
    expect($("sandbox-preview-surface")?.textContent).not.toContain("检查应用");
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector('[aria-label="工程文件"]')?.textContent,
      "树头不再堆读取/导出/复刻"
    ).not.toContain("读取最新版");
    expect($("project-source-tools-host"), "右上角要有操作宿主").toBeTruthy();
    const trigger = $("project-source-tools-trigger");
    expect(trigger, "⋯ 必须在").toBeTruthy();
    expect(
      $("project-computer-gears")?.contains(trigger!),
      "⋯ 在源码下拉旁边，不许在文件树里"
    ).toBe(true);
  });

  it("写入源码时代码面跟当前文件，不许钉在 README", async () => {
    fetcher.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes("/source/file")) {
        const file = new URL(path, "http://localhost").searchParams.get("path");
        return Response.json({
          projectId: "project-one",
          revision: "revision-one",
          path: file,
          sha256: "hash",
          content: file === "src/components/Header.tsx" ? "export function Header(){}" : "readme",
        });
      }
      if (path.includes("/source")) {
        return Response.json({
          projectId: "project-one",
          revision: "revision-one",
          currentRevision: "revision-one",
          files: [
            { path: "README.md", sha256: "hash-readme", sizeBytes: 6 },
            { path: "src/components/Header.tsx", sha256: "hash-header", sizeBytes: 8 },
          ],
        });
      }
      return Response.json({
        operationId: "operation-one",
        available: true,
        reason: null,
        descriptor: {
          kind: "project",
          projectId: "project-one",
          runtimeId: "runtime-one",
          revision: "revision-one",
          status: "executing",
          entryUrl: null,
        },
      });
    });
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          projectRevision="revision-one"
          isRunning
          turns={[
            {
              ...projectTurn("acting"),
              steps: [
                {
                  id: "a",
                  kind: "chip",
                  capabilityId: "file_write",
                  roleId: "system",
                  label: "写入源码",
                  realLlm: false,
                  progressType: "acting",
                  projectDetail: "src/components/Header.tsx",
                } as unknown as TurnStep,
              ],
            },
          ]}
        />
      )
    );
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "source"
    );
    expect(
      container
        .querySelector('[data-source-path="src/components/Header.tsx"]')
        ?.getAttribute("aria-current"),
      "树必须亮着正在写的那份，不许停在 README"
    ).toBe("true");
    expect($("project-computer-context-value")?.textContent).toContain(
      "src/components/Header.tsx"
    );
    expect(
      container
        .querySelector('[data-source-path="README.md"]')
        ?.getAttribute("aria-current")
    ).not.toBe("true");
  });

  it("控制面调了启动预览才自动换票，不许停在唤醒", async () => {
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("/preview-ticket") && init?.method === "POST") {
        return Response.json({
          projectId: "project-one",
          operationId: "operation-one",
          runtimeId: "runtime-one",
          revision: "revision-one",
          entryUrl: "https://preview.example/entry?ticket=one-use",
          ticketExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          accessExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      if (path.includes("/source") && !path.includes("/source/file")) {
        return Response.json({
          projectId: "project-one",
          revision: "revision-one",
          currentRevision: "revision-one",
          files: [{ path: "src/App.tsx", sha256: "hash-app", sizeBytes: 4 }],
        });
      }
      return Response.json({
        operationId: "operation-one",
        available: true,
        reason: null,
        descriptor: {
          kind: "project",
          projectId: "project-one",
          runtimeId: "runtime-one",
          revision: "revision-one",
          status: "ready",
          entryUrl: null,
        },
      });
    });
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          projectRevision="revision-one"
          turns={[
            {
              ...projectTurn("completed"),
              steps: [
                {
                  id: "a",
                  kind: "chip",
                  capabilityId: "project_start",
                  roleId: "system",
                  label: "启动预览",
                  realLlm: false,
                  progressType: "completed",
                } as unknown as TurnStep,
              ],
            },
          ]}
        />
      )
    );
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("/preview-ticket")),
      "控制面挑了启动预览就必须换票，不许等人点唤醒"
    ).toBe(true);
    expect($("project-preview-wake")).toBeNull();
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain(
      "preview.example"
    );
  });

  it("列文件也开源码档——project_list 不产 PTY，钉终端必白", async () => {
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          projectRevision="revision-one"
          isRunning
          turns={[
            {
              ...projectTurn("completed"),
              steps: [
                {
                  id: "a",
                  kind: "chip",
                  capabilityId: "project_create",
                  roleId: "system",
                  label: "创建工程",
                  realLlm: false,
                  progressType: "completed",
                  projectDetail: "react-vite",
                } as unknown as TurnStep,
                {
                  id: "b",
                  kind: "chip",
                  capabilityId: "project_list",
                  roleId: "system",
                  label: "读取工程列表",
                  realLlm: false,
                  progressType: "completed",
                  projectDetail: "prv-d3a1db551ba1",
                } as unknown as TurnStep,
              ],
            },
          ]}
        />
      )
    );
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "source"
    );
    expect(
      $("project-computer-stage")?.getAttribute("data-active"),
      "列文件不许把空终端当成脸"
    ).toBe("false");
    expect(
      $("project-workspace-panel"),
      "列文件开了代码档，源码面板必须在，不许标题「代码」下面白纸"
    ).toBeTruthy();
  });

  it("工程从空落到 id，代码档要把源码面板挂上，不许卸成白纸", async () => {
    const turns: UiTurn[] = [
      {
        ...projectTurn("completed"),
        steps: [
          {
            id: "a",
            kind: "chip",
            capabilityId: "project_create",
            roleId: "system",
            label: "创建工程",
            realLlm: false,
            progressType: "completed",
            projectDetail: "react-vite-tasks",
          } as unknown as TurnStep,
          {
            id: "b",
            kind: "chip",
            capabilityId: "project_list",
            roleId: "system",
            label: "读取工程列表",
            realLlm: false,
            progressType: "completed",
            projectDetail: "prv-00af4023",
          } as unknown as TurnStep,
        ],
      },
    ];
    const studio = (projectId: string | null) => (
      <SlideRuleStudio
        chatSlot={<p>conversation</p>}
        activeSkillId={null}
        runtimeKind="project"
        projectId={projectId}
        projectRevision={projectId ? "revision-one" : null}
        turns={turns}
      />
    );
    await act(async () => root.render(studio(null)));
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "source"
    );
    expect($("project-source-waiting"), "还没有 id 时要等人，不许假装有源码").toBeTruthy();
    expect($("project-workspace-panel")).toBeNull();

    await act(async () => root.render(studio("project-one")));
    expect($("project-source-waiting"), "id 到了还在等 = 面板没挂上").toBeNull();
    expect(
      $("project-workspace-panel"),
      "真机团长工作台：id 一到就把 workspaceOpened 关死，标题「代码」下面白纸"
    ).toBeTruthy();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const files = [
      ...container.querySelectorAll('[data-testid="project-source-file"]'),
    ].map(node => node.textContent);
    expect(files, "清单已经读过文件，树里必须看得到，不许空壳").toEqual(
      expect.arrayContaining(["package.json", "App.tsx"])
    );
    expect(files).toHaveLength(2);
  });

  it("没接 turns 的预览面不加终端档（应用中心那条链）", async () => {
    await act(async () =>
      root.render(
        <SandboxPreviewSurface
          projectId="project-one"
          projectRevision="revision-one"
          revisionMode="current"
          appTitle="任务管理"
        />
      )
    );
    expect(projectModeLabels(container)).toEqual([
      "预览",
      "代码",
      "版本",
      "数据",
      "交付",
    ]);
    expect($("project-computer-panel")).toBeNull();
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "preview"
    );
  });

  it("用户点了预览就钉住，不因还在跑被拽回终端", async () => {
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          isRunning
          turns={[projectTurn("acting")]}
        />
      )
    );
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "computer"
    );
    await act(async () => selectProjectMode(container, "预览"));
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "preview"
    );
    // 切走终端不许卸面板：卸了再挂会重订 /events、PTY 闪一串旧命令。
    expect($("project-computer-stage")?.getAttribute("data-active")).toBe("false");
    expect($("project-computer-panel")).not.toBeNull();
    expect(
      $("project-computer-chrome")!.querySelector(
        '[data-testid="project-preview-open"]'
      ),
      "预览档头条不再堆打开预览，唤醒在画布上"
    ).toBeNull();
    expect(
      $("project-preview-addressbar")?.querySelector(
        '[data-testid="project-preview-reload"]'
      ),
      "对照 Manus：刷新在地址胶囊里，不在右侧齿轮"
    ).not.toBeNull();
    expect($("project-preview-addressbar"), "预览档头条是地址").not.toBeNull();
    expect($("project-preview-addressbar")?.className).toMatch(/rounded-full/);
    expect($("project-preview-addressbar")?.className).toMatch(/max-w-/);
    expect($("project-preview-addressbar")?.className).not.toMatch(
      /(?:^|\s)flex-1(?:\s|$)/
    );
    expect($("project-computer-context")?.className).toMatch(/justify-center/);
    expect($("project-preview-view"), "设备下拉在左侧，不能被挤走").not.toBeNull();
    expect(
      $("project-preview-addressbar")?.contains($("project-preview-view")!)
    ).toBe(false);
    expect($("project-computer-chrome")?.className).toMatch(/grid-cols-/);
    expect($("project-preview-url")?.textContent).toBe("/");
    expect($("project-computer-chrome")!.textContent).not.toContain("它的电脑");
    expect($("project-preview-wake"), "画布是唤醒，不是验收条").not.toBeNull();
    expect($("project-verification-panel")).toBeNull();
    expect($("sandbox-preview-surface")?.textContent).not.toContain("检查应用");
    expect($("project-computer-chrome"), "头条不跟档卸掉").not.toBeNull();
    await act(async () => selectProjectMode(container, "终端"));
    expect($("project-computer-stage")?.getAttribute("data-active")).toBe("true");
    expect($("project-computer-panel")).not.toBeNull();
  });

  it("预览和代码共用同一条头条槽位，下拉不许左右跳", async () => {
    // 2026-09-16 真机：预览把切档放左边，代码档又甩到 ml-auto，切一次
    // 控件左右跳。Manus 是切档 | 路径 | 操作，三槽锁死。
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          projectRevision="revision-one"
          turns={[projectTurn("completed")]}
        />
      )
    );
    const order = () => {
      const html = $("project-computer-chrome")!.innerHTML;
      return [
        html.indexOf("project-mode-select"),
        html.indexOf("project-computer-context"),
        html.indexOf("project-computer-gears"),
      ];
    };
    const assertSlots = () => {
      const [mode, ctx, gears] = order();
      expect(mode).toBeGreaterThan(-1);
      expect(ctx).toBeGreaterThan(mode);
      expect(gears).toBeGreaterThan(ctx);
      expect(
        $("project-computer-gears")?.querySelector(
          '[data-testid="project-mode-select"]'
        ),
        "切档不许再进右侧齿轮里左右跳"
      ).toBeNull();
    };
    assertSlots();
    await act(async () => selectProjectMode(container, "预览"));
    assertSlots();
    expect($("project-preview-addressbar")).not.toBeNull();
    await act(async () => selectProjectMode(container, "代码"));
    assertSlots();
    expect($("project-computer-title")?.textContent).toBe("代码");
  });

  it("重置和分栏落在电脑头条，重置在标题左边", async () => {
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          isRunning
          turns={[projectTurn("acting")]}
          resetSlot={<button data-testid="sliderule-reset-session">reset</button>}
          chromeSlot={<div data-testid="sliderule-status-bar">分栏</div>}
        />
      )
    );
    const bar = $("project-computer-chrome")!;
    const reset = $("sliderule-reset-session")!;
    const hud = $("sliderule-status-bar")!;
    expect(bar.contains(reset), "重置必须进头条，不许再叠一行").toBe(true);
    expect(bar.contains(hud), "分栏/交付物必须进头条右侧").toBe(true);
    const html = bar.innerHTML;
    expect(html.indexOf("sliderule-reset-session")).toBeLessThan(
      html.indexOf("project-mode-select")
    );
    expect(html.indexOf("project-mode-select")).toBeLessThan(
      html.indexOf("project-computer-context")
    );
    expect(html.indexOf("project-computer-context")).toBeLessThan(
      html.indexOf("project-computer-gears")
    );
  });

  it("runtime.log 不是 PTY 脸：不许再拼 $ cmd + 日志", async () => {
    fetcher.mockImplementation(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/events")) {
        return Response.json({
          events: [
            {
              seq: 1,
              type: "runtime.log",
              payload: { text: "added 21 packages" },
            },
          ],
          nextSeq: 2,
          hasMore: false,
        });
      }
      return Response.json({
        operationId: "operation-one",
        available: true,
        reason: null,
        descriptor: {
          kind: "project",
          projectId: "project-one",
          runtimeId: "runtime-one",
          revision: "revision-one",
          status: "executing",
          entryUrl: null,
        },
      });
    });
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          isRunning
          turns={[
            projectTurn("acting", {
              projectDetail: "build",
              operationId: "op-live",
            }),
          ]}
        />
      )
    );
    const started = Date.now();
    while (Date.now() - started < 1500) {
      if (fetcher.mock.calls.some(call => String(call[0]).includes("/events"))) {
        break;
      }
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
      });
    }
    expect($("project-computer-pty"), "没 console 也要空着等 PTY，不许退回拼贴").not.toBeNull();
    expect($("project-computer-session")).toBeNull();
    expect($("project-computer-pty-text")?.textContent || "").not.toContain(
      "added 21 packages"
    );
    expect($("project-computer-panel")?.textContent).not.toContain("$ build");
    expect($("project-computer-panel")?.textContent).not.toContain("命令行输出");
    expect(fetcher.mock.calls.some(call => String(call[0]).includes("/events"))).toBe(
      true
    );
  });

  it("有 PTY 字节就画活终端，不再自己拼一行 $ cmd", async () => {
    fetcher.mockImplementation(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/events")) {
        return Response.json({
          events: [
            {
              seq: 1,
              type: "runtime.console",
              payload: { data: "user@sb:/home/user/workspace$ npm ci" },
            },
          ],
          nextSeq: 2,
          hasMore: false,
        });
      }
      return Response.json({
        operationId: "operation-one",
        available: true,
        reason: null,
        descriptor: {
          kind: "project",
          projectId: "project-one",
          runtimeId: "runtime-one",
          revision: "revision-one",
          status: "executing",
          entryUrl: null,
        },
      });
    });
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          isRunning
          turns={[
            projectTurn("acting", {
              projectDetail: "build",
              operationId: "op-live",
            }),
          ]}
        />
      )
    );
    const started = Date.now();
    while (Date.now() - started < 1500) {
      if ($("project-computer-pty-text")?.textContent?.includes("npm ci")) {
        break;
      }
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
      });
    }
    expect($("project-computer-pty-text")?.textContent).toContain(
      "user@sb:/home/user/workspace$ npm ci"
    );
    expect($("project-computer-session")).toBeNull();
    expect($("project-computer-panel")?.textContent).not.toContain("$ build");
  });

  it("CSI 原字节不许当可见面：ESC 被吃掉就会印出 [32m", async () => {
    fetcher.mockImplementation(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/events")) {
        return Response.json({
          events: [
            {
              seq: 1,
              type: "runtime.console",
              payload: { data: "\u001b[32mvite built\u001b[39m\n\u001b[1m\u001b[0K" },
            },
          ],
          nextSeq: 2,
          hasMore: false,
        });
      }
      return Response.json({
        operationId: "operation-one",
        available: true,
        reason: null,
        descriptor: {
          kind: "project",
          projectId: "project-one",
          runtimeId: "runtime-one",
          revision: "revision-one",
          status: "executing",
          entryUrl: null,
        },
      });
    });
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<p>conversation</p>}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          isRunning
          turns={[
            projectTurn("acting", {
              projectDetail: "build",
              operationId: "op-live",
            }),
          ]}
        />
      )
    );
    const started = Date.now();
    while (Date.now() - started < 1500) {
      if ($("project-computer-pty-text")?.textContent?.includes("vite built")) {
        break;
      }
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
      });
    }
    const pre = $("project-computer-pty-text");
    expect(pre?.textContent).toContain("\u001b[32m");
    expect(pre?.className).toMatch(/\bsr-only\b/);
    expect(pre?.className).not.toMatch(/flex-1/);
    const visible = [
      ...($("project-computer-pty")?.querySelectorAll("*") ?? []),
    ]
      .filter(el => !el.classList.contains("sr-only") && !el.closest(".sr-only"))
      .map(el => el.textContent || "")
      .join("");
    expect(visible).not.toMatch(/\[32m/);
    expect(visible).not.toMatch(/\[1m\[0K/);
  });
});

function mixedTurn(): UiTurn {
  return {
    ...projectTurn("acting"),
    steps: [
      {
        id: "patch-1",
        kind: "chip",
        capabilityId: "project_patch",
        roleId: "system",
        label: "写入源码",
        realLlm: false,
        progressType: "completed",
        projectDetail: "src/Home.tsx",
      } as unknown as TurnStep,
      {
        id: "exec-1",
        kind: "chip",
        capabilityId: "project_exec",
        roleId: "system",
        label: "运行命令",
        realLlm: false,
        progressType: "acting",
      } as unknown as TurnStep,
    ],
  };
}

function finishedMixedTurn(): UiTurn {
  const turn = mixedTurn();
  return {
    ...turn,
    status: "complete",
    steps: turn.steps.map(step => ({ ...step, progressType: "completed" })),
  };
}

describe("左栏点工具，右侧跟档", () => {
  it("通电链：清单发出 inspect，外壳听 computerViewForAction", () => {
    const list = read("../ProjectTaskChecklist.tsx");
    const story = read("../SessionStory.tsx");
    const surface = read("../project-runtime/SandboxPreviewSurface.tsx");
    expect(list).toMatch(/dispatchInspectAction/);
    expect(list).toMatch(/data-testid="project-task-row"/);
    expect(list).toMatch(/followProjectActionId/);
    expect(list).toMatch(/FOLLOW_COMPUTER_EVENT/);
    // 对话列现网走章节面，行复用同一份 ProjectActionRowView。
    // 只钉清单 = 只测了外壳夹具。
    expect(story).toMatch(/ProjectActionRowView/);
    expect(story).toMatch(/followProjectActionId/);
    expect(list).toMatch(/export function ProjectActionRowView/);
    expect(surface).toMatch(/INSPECT_ACTION_EVENT/);
    expect(surface).toMatch(/FOLLOW_COMPUTER_EVENT/);
    expect(surface).toMatch(/computerViewForAction/);
    const dock = surface.slice(
      surface.indexOf("function ComputerReplayDock"),
      surface.indexOf("function PreviewPausedFace")
    );
    expect(dock, "底栏不许再钉 $").not.toMatch(/>\s*\$\s*</);
    expect(dock).not.toMatch(/accent-blue-500/);
    expect(dock).not.toMatch(/\$\{index \+ 1\} \/ \$\{rows\.length\}/);
    expect(dock).toMatch(/rounded-full bg-\[#171717\]/);
    // 反向：只发事件外壳不听 = 点了没反应，正是这一轮要修的缝。
    expect(surface).toMatch(/addEventListener\(\s*INSPECT_ACTION_EVENT/);
    expect(surface).toMatch(/addEventListener\(\s*FOLLOW_COMPUTER_EVENT/);
  });

  it("没点左栏：写入进行中右侧就要切到源码，并亮着那一行", async () => {
    const turns = [
      {
        ...projectTurn("acting"),
        steps: [
          {
            id: "patch-live",
            kind: "chip",
            capabilityId: "project_patch",
            roleId: "system",
            label: "写入源码",
            realLlm: false,
            progressType: "acting",
            projectDetail: "src/style.css",
          } as unknown as TurnStep,
        ],
      },
    ];
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<ProjectTaskChecklist turns={turns} />}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          isRunning
          turns={turns}
        />
      )
    );
    const row = container.querySelector<HTMLButtonElement>(
      '[data-testid="project-task-row"]'
    );
    expect(row?.getAttribute("data-task-id")).toBe("project_patch");
    expect(row?.getAttribute("data-selected")).toBe("true");
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "source"
    );
  });

  it("点写入源码打开代码，点运行命令打开终端，选中行亮着", async () => {
    const turns = [mixedTurn()];
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<ProjectTaskChecklist turns={turns} />}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          isRunning
          turns={turns}
        />
      )
    );
    const rows = () =>
      [...container.querySelectorAll<HTMLButtonElement>('[data-testid="project-task-row"]')];
    expect(rows()).toHaveLength(2);
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "computer"
    );
    expect(
      rows().find(row => row.getAttribute("data-task-id") === "project_exec")
        ?.getAttribute("data-selected"),
      "没点过也要亮着当前在跑的那一步"
    ).toBe("true");

    await act(async () => {
      rows().find(row => row.getAttribute("data-task-id") === "project_patch")!.click();
    });
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "source"
    );
    expect(
      rows().find(row => row.getAttribute("data-task-id") === "project_patch")
        ?.getAttribute("data-selected")
    ).toBe("true");

    await act(async () => {
      rows().find(row => row.getAttribute("data-task-id") === "project_exec")!.click();
    });
    expect($("sandbox-preview-surface")?.getAttribute("data-computer-view")).toBe(
      "computer"
    );
    expect($("project-computer-panel"), "终端必须跟过来").not.toBeNull();
    expect(
      rows().find(row => row.getAttribute("data-task-id") === "project_exec")
        ?.getAttribute("data-selected")
    ).toBe("true");
  });

  it("电脑壳上有回放底栏，面板里不再叠第二条", async () => {
    const turns = [mixedTurn()];
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<ProjectTaskChecklist turns={turns} />}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          isRunning
          turns={turns}
        />
      )
    );
    expect($("project-computer-pty"), "原始 PTY 还在").not.toBeNull();
    expect($("project-computer-session")).toBeNull();
    expect($("project-computer-promptbar"), "底栏必须在外壳上").toBeTruthy();
    expect($("project-computer-prev")).toBeTruthy();
    expect(
      $("project-computer-panel")?.querySelector(
        '[data-testid="project-computer-promptbar"]'
      )
    ).toBeNull();
    expect($("project-computer-panel")?.textContent).not.toContain("跳到实时");
    expect($("project-computer-promptbar")!.textContent).not.toContain("$");
    expect($("project-computer-live")?.textContent).toBe("实时");
    expect($("project-computer-promptbar")!.querySelector(".accent-blue-500")).toBeNull();
  });

  it("跟在队尾写实时，不许变成播放器那种 n/total", async () => {
    const turns = [finishedMixedTurn()];
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<ProjectTaskChecklist turns={turns} />}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          turns={turns}
        />
      )
    );
    await act(async () => {
      selectProjectMode(container, "终端");
    });
    const bar = $("project-computer-promptbar")!;
    expect(bar.textContent).not.toContain("$");
    expect(bar.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
    expect($("project-computer-live")?.textContent).toBe("实时");
    expect($("project-computer-follow")).toBeNull();
  });

  it("倒回去看：跳到实时是进度条上方的深色胶囊，不是右边一条蓝链接", async () => {
    const turns = [finishedMixedTurn()];
    await act(async () =>
      root.render(
        <SlideRuleStudio
          chatSlot={<ProjectTaskChecklist turns={turns} />}
          activeSkillId={null}
          runtimeKind="project"
          projectId="project-one"
          turns={turns}
        />
      )
    );
    await act(async () => {
      selectProjectMode(container, "终端");
    });
    await act(async () => {
      $("project-computer-prev")!.click();
    });
    const bar = $("project-computer-promptbar")!;
    expect(bar.textContent).not.toContain("$");
    expect(bar.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
    expect($("project-computer-live")).toBeNull();
    const follow = $("project-computer-follow")!;
    expect(follow.textContent).toContain("跳到实时");
    expect(follow.className).toMatch(/rounded-full/);
    expect(follow.className).toMatch(/bg-\[#171717\]/);
    expect(follow.className).not.toMatch(/underline/);
  });
});
