/**
 * 右侧电脑档位：用户点过就钉住，没点过才按干活/预览自动切。
 *
 * ⚠ 把「有动作在跑 → 终端」改回去叠在预览上面，下面「live 优先」那条必红。
 *   把 userPinned 删掉改成永远自动切，反向那条必红。
 *   把 lastTool 丢掉、写入仍切终端，下面「写入 → 源码」那条必红。
 */
import { describe, expect, it } from "vitest";
import {
  computerViewForAction,
  FOLLOW_COMPUTER_EVENT,
  INSPECT_ACTION_EVENT,
  inspectActionDetail,
  isComputerView,
  officePreviewStage,
  presentedOfficeFile,
  presentedSourcePage,
  resolveComputerView,
  shouldAutoCreateProject,
  shouldAutoOpenPreview,
  shouldAutoWakePreview,
  shouldShowProjectComputer,
} from "../project-computer-view";

describe("用户点过下拉就钉住", () => {
  it("钉在源码时，哪怕正在跑、预览也就绪，都不许拽走", () => {
    expect(
      resolveComputerView({
        userPinned: "source",
        live: true,
        hasActivity: true,
        previewReady: true,
      })
    ).toBe("source");
  });

  it("反向：没点过才允许自动切", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: true,
        hasActivity: true,
        previewReady: true,
      })
    ).toBe("computer");
  });
});

describe("没点过：按干活 / 预览自动切", () => {
  it("有动作在跑 → 终端，预览再就绪也先看它干活", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: true,
        hasActivity: true,
        previewReady: true,
      })
    ).toBe("computer");
  });

  it("跑完且预览能打开 → 预览", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: false,
        hasActivity: true,
        previewReady: true,
      })
    ).toBe("preview");
  });

  it("跑完命令但预览还没开 → 留在终端回放，不扔进一块空占位", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: false,
        hasActivity: true,
        previewReady: false,
        lastTool: "project_exec",
      })
    ).toBe("computer");
  });

  it("跑完写入 / 读取 → 源码，不许停在没 PTY 的白纸终端", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: false,
        hasActivity: true,
        previewReady: false,
        lastTool: "project_patch",
      })
    ).toBe("source");
    expect(
      resolveComputerView({
        userPinned: null,
        live: true,
        hasActivity: true,
        previewReady: true,
        lastTool: "project_create",
      })
    ).toBe("source");
    expect(
      resolveComputerView({
        userPinned: null,
        live: true,
        hasActivity: true,
        previewReady: false,
        lastTool: "project_list",
      })
    ).toBe("source");
  });

  it("反向：命令跑过但字节没了 → 也不许钉白纸，落到源码", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: false,
        hasActivity: true,
        previewReady: false,
        lastTool: "project_exec",
        hasConsole: false,
      })
    ).toBe("source");
  });

  it("什么都没有 → 预览（跟应用中心没接 turns 的默认面孔一致）", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: false,
        hasActivity: false,
        previewReady: false,
      })
    ).toBe("preview");
  });

  it("office-file 不因为跑完就自己切预览，点了预览工具才去预览", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: true,
        hasActivity: true,
        previewReady: false,
        lastTool: "shell_exec",
        deliverableKind: "office-file",
      })
    ).toBe("computer");
    expect(
      resolveComputerView({
        userPinned: null,
        live: false,
        hasActivity: true,
        previewReady: false,
        lastTool: "shell_exec",
        deliverableKind: "office-file",
      })
    ).toBe("computer");
    expect(
      resolveComputerView({
        userPinned: null,
        live: false,
        hasActivity: true,
        previewReady: false,
        lastTool: "make_manus_page",
        deliverableKind: "office-file",
      })
    ).toBe("preview");
    expect(
      resolveComputerView({
        userPinned: "source",
        live: false,
        hasActivity: true,
        previewReady: false,
        lastTool: "file_write",
        deliverableKind: "office-file",
      })
    ).toBe("source");
  });
});

describe("左栏点工具 → 右侧开哪一档", () => {
  it("写入 / 读取源码打开代码，运行命令打开终端，启动打开预览", () => {
    expect(computerViewForAction("project_patch")).toBe("source");
    expect(computerViewForAction("project_write")).toBe("source");
    expect(computerViewForAction("project_str_replace")).toBe("source");
    expect(computerViewForAction("file_write")).toBe("source");
    expect(computerViewForAction("file_read")).toBe("source");
    expect(computerViewForAction("file_find_by_name")).toBe("source");
    expect(computerViewForAction("browser_navigate")).toBe("preview");
    expect(computerViewForAction("deploy_expose_port")).toBe("preview");
    expect(computerViewForAction("shell_exec")).toBe("computer");
    expect(computerViewForAction("write_file")).toBe("source");
    expect(computerViewForAction("grep")).toBe("source");
    expect(computerViewForAction("bash")).toBe("computer");
    expect(computerViewForAction("browser_click")).toBe("preview");
    expect(computerViewForAction("deploy_apply_deployment")).toBe("preview");
    expect(computerViewForAction("project_read")).toBe("source");
    expect(computerViewForAction("project_list")).toBe("source");
    expect(computerViewForAction("project_search")).toBe("source");
    expect(computerViewForAction("project_exec")).toBe("computer");
    expect(computerViewForAction("project_start")).toBe("preview");
    expect(computerViewForAction("project_revisions")).toBe("history");
    expect(computerViewForAction("project_delivery")).toBe("delivery");
  });

  it("反向：未知工具落到终端，不编一个预览", () => {
    expect(computerViewForAction("project_brand_new")).toBe("computer");
    expect(computerViewForAction("")).toBe("computer");
    expect(computerViewForAction("intent.parse")).toBe("computer");
  });

  it("载荷缺 id 或 tool 就不认——编一条会让右侧跟错人", () => {
    expect(inspectActionDetail({ id: "a", tool: "project_exec" })).toEqual({
      id: "a",
      tool: "project_exec",
    });
    expect(inspectActionDetail({ id: "a" })).toBeNull();
    expect(inspectActionDetail({ tool: "project_exec" })).toBeNull();
    expect(inspectActionDetail(null)).toBeNull();
  });
});

describe("事件名不许 silently 改掉", () => {
  it("inspect / follow 是外壳在听的那两个字面量", () => {
    expect(INSPECT_ACTION_EVENT).toBe("sliderule:inspect-action");
    expect(FOLLOW_COMPUTER_EVENT).toBe("sliderule:follow-computer");
  });
});

describe("计划批准后右侧是电脑，不是接线沙盘", () => {
  it("已经是工程、或有 projectId、或正在创建、或可以创建 → 电脑", () => {
    expect(shouldShowProjectComputer({ runtimeKind: "project" })).toBe(true);
    expect(
      shouldShowProjectComputer({
        runtimeKind: "html-prototype",
        projectId: "proj-1",
      })
    ).toBe(true);
    expect(
      shouldShowProjectComputer({
        runtimeKind: "html-prototype",
        creating: true,
      })
    ).toBe(true);
    expect(
      shouldShowProjectComputer({
        runtimeKind: "html-prototype",
        canCreateProject: true,
      })
    ).toBe(true);
  });

  it("反向：普通 HTML 推演不许改成电脑", () => {
    expect(
      shouldShowProjectComputer({ runtimeKind: "html-prototype" })
    ).toBe(false);
    expect(shouldShowProjectComputer({})).toBe(false);
  });

  it("空闲且能创建才自动 POST；跑着 / 已在创建 / 失败过都不重打", () => {
    expect(
      shouldAutoCreateProject({
        canCreateProject: true,
        isRunning: false,
        createStatus: "idle",
        planHasDeliverableKind: true,
      })
    ).toBe(true);
    expect(
      shouldAutoCreateProject({
        canCreateProject: true,
        isRunning: true,
        createStatus: "idle",
      })
    ).toBe(false);
    expect(
      shouldAutoCreateProject({
        canCreateProject: true,
        isRunning: false,
        createStatus: "creating",
      })
    ).toBe(false);
    expect(
      shouldAutoCreateProject({
        canCreateProject: true,
        isRunning: false,
        createStatus: "error",
      })
    ).toBe(false);
    expect(
      shouldAutoCreateProject({
        canCreateProject: false,
        isRunning: false,
        createStatus: "idle",
        planHasDeliverableKind: true,
      })
    ).toBe(false);
    expect(
      shouldAutoCreateProject({
        canCreateProject: true,
        isRunning: false,
        createStatus: "idle",
      })
    ).toBe(false);
    expect(
      shouldAutoCreateProject({
        canCreateProject: true,
        isRunning: false,
        createStatus: "idle",
        planHasDeliverableKind: false,
      })
    ).toBe(false);
  });
});

describe("会话工作台跟控制面的预览工具", () => {
  it("控制面挑了启动预览、运行已经就绪、还没换票 → 换票", () => {
    expect(
      shouldAutoOpenPreview({
        hasTurns: true,
        view: "preview",
        hasTicket: false,
        opening: false,
        runtimeReady: true,
        lastTool: "project_start",
      })
    ).toBe(true);
  });

  it("反向：只是运行就绪、当前不是预览工具，不许自己换票", () => {
    expect(
      shouldAutoOpenPreview({
        hasTurns: true,
        view: "preview",
        hasTicket: false,
        opening: false,
        runtimeReady: true,
        lastTool: "file_write",
      })
    ).toBe(false);
    expect(
      shouldAutoOpenPreview({
        hasTurns: true,
        view: "preview",
        hasTicket: false,
        opening: false,
        runtimeReady: true,
        lastTool: "shell_exec",
      })
    ).toBe(false);
    expect(
      shouldAutoOpenPreview({
        hasTurns: true,
        view: "preview",
        hasTicket: false,
        opening: false,
        runtimeReady: true,
        lastTool: "project_status",
      })
    ).toBe(false);
  });

  it("反向：没有动作流（空会话 / 应用中心），不许自己开工", () => {
    expect(
      shouldAutoOpenPreview({
        hasTurns: false,
        view: "preview",
        hasTicket: false,
        opening: false,
        runtimeReady: true,
        lastTool: "project_start",
      })
    ).toBe(false);
  });

  it("控制面正在调预览工具 → 唤醒", () => {
    expect(
      shouldAutoWakePreview({
        hasTurns: true,
        view: "preview",
        hasTicket: false,
        opening: false,
        starting: false,
        live: true,
        lastTool: "project_start",
        runtimeReady: false,
      })
    ).toBe(true);
  });

  it("反向：刷新旧会话看到历史 project_start，不许把沙箱拉起来", () => {
    expect(
      shouldAutoWakePreview({
        hasTurns: true,
        view: "preview",
        hasTicket: false,
        opening: false,
        starting: false,
        live: false,
        lastTool: "project_start",
        runtimeReady: false,
      })
    ).toBe(false);
  });

  it("反向：正在写文件或跑命令，不许当成预览决策去唤醒", () => {
    expect(
      shouldAutoWakePreview({
        hasTurns: true,
        view: "preview",
        hasTicket: false,
        opening: false,
        starting: false,
        live: true,
        lastTool: "file_write",
        runtimeReady: false,
      })
    ).toBe(false);
  });

  it("project_status 是轮询，不是预览决策", () => {
    expect(computerViewForAction("project_status")).toBe("computer");
  });
});

describe("档位名单", () => {
  it("终端 / 预览 / 源码都在，瞎写的不算", () => {
    expect(isComputerView("computer")).toBe(true);
    expect(isComputerView("preview")).toBe(true);
    expect(isComputerView("source")).toBe(true);
    expect(isComputerView("terminal")).toBe(false);
    expect(isComputerView("")).toBe(false);
  });
});

describe("文件预览只认 Agent 点名的源码页", () => {
  it("做成的 html 才是浏览器那一页", () => {
    expect(
      presentedSourcePage([
        { tool: "file_write", status: "done", detail: "slides.html" },
        { tool: "make_manus_page", status: "done", detail: "slides.html" },
      ])
    ).toBe("slides.html");
  });

  it("反向：pptx、失败、或只写了文件，宿主都不补一页", () => {
    expect(
      presentedSourcePage([
        { tool: "make_manus_page", status: "done", detail: "deck.pptx" },
      ])
    ).toBeNull();
    expect(
      presentedSourcePage([
        { tool: "make_manus_page", status: "done", detail: "slides.html" },
        { tool: "make_manus_page", status: "failed", detail: "slides.html" },
      ])
    ).toBeNull();
    expect(
      presentedSourcePage([
        { tool: "file_write", status: "done", detail: "slides.html" },
      ])
    ).toBeNull();
    expect(
      presentedSourcePage([
        { tool: "make_manus_page", status: "done", detail: "old.html" },
        { tool: "make_manus_page", status: "done", detail: "deck.pptx" },
      ])
    ).toBeNull();
  });

  it("点名已收回的 pptx 才打开那一份，没点名不许拿应用失败来充", () => {
    const named = [
      { tool: "bash", status: "done", detail: "deck.pptx" },
      { tool: "make_manus_page", status: "done", detail: "面团.pptx" },
    ];
    expect(presentedOfficeFile(named)).toBe("面团.pptx");
    expect(presentedSourcePage(named)).toBeNull();
    expect(
      officePreviewStage({ office: true, htmlPath: null, officePath: "面团.pptx" })
    ).toBe("file");
    expect(
      officePreviewStage({ office: true, htmlPath: null, officePath: null })
    ).toBe("idle");
    expect(
      officePreviewStage({ office: false, htmlPath: null, officePath: null })
    ).toBe("app");
    expect(presentedOfficeFile([])).toBeNull();
  });
});
