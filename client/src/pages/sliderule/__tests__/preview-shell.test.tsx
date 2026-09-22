// @vitest-environment jsdom
/**
 * 预览面板的外壳：视图下拉 + 地址行（对照 Manus，2026-09-14）。
 *
 * 判据全部落在**真渲染出来的 DOM 和真发出去的请求**上（§5：不量源码）。
 * 两条反向判据钉的是这一轮删掉的两个东西，它们都是「看着对、真机上没用」：
 *   · 「首页」按钮把 iframe 导回 entryUrl —— 那张 ticket 是一次性的
 *   · 「刷新」接 refresh() —— 那只重拉状态快照，页面纹丝不动
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import {
  projectModeLabels,
  projectModeValue,
  selectProjectMode,
} from "./fixtures/select-project-mode";
import type {
  ProjectPreviewSnapshot,
  ProjectPreviewTicket,
} from "../project-runtime/project-preview-client";

let root: Root;
let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;

const snapshot = (): ProjectPreviewSnapshot => ({
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
    expiresAt: null,
    capabilities: [],
  },
});
const ticket = (): ProjectPreviewTicket => ({
  projectId: "project-one",
  operationId: "operation-one",
  runtimeId: "runtime-one",
  revision: "revision-one",
  // 开发环回：`{runtimeId}.localhost` 是 isolatedPreviewUrl 允许的独立来源。
  entryUrl: "http://runtime-one.localhost:3100/tasks?view=all",
  ticketExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  accessExpiresAt: new Date(Date.now() + 300_000).toISOString(),
});

const $ = <T extends Element>(testid: string) =>
  container.querySelector<T>(`[data-testid="${testid}"]`);
const posts = () =>
  fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
const ticketPosts = () =>
  posts().filter(([url]) => String(url).includes("/preview-ticket"));

async function render() {
  await act(async () => {
    root.render(
      <SandboxPreviewSurface
        projectId="project-one"
        projectRevision="revision-one"
        revisionMode="current"
        appTitle="任务管理"
      />
    );
  });
}
/** 点「打开预览」换一张票，地址行才会出现。 */
async function opened() {
  await render();
  await act(async () => $<HTMLButtonElement>("project-preview-open")!.click());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json(init?.method === "POST" ? ticket() : snapshot())
  );
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("视图下拉（原来是一排平铺 tab）", () => {
  it("五个视图一个不少，默认停在预览", async () => {
    await render();
    expect(projectModeLabels(container)).toEqual([
      "预览",
      "代码",
      "版本",
      "数据",
      "交付",
    ]);
    expect(projectModeValue(container)).toBe("preview");
    expect(
      $("sandbox-preview-surface")?.className,
      "应用中心仍是卡片，圆角留着"
    ).toMatch(/rounded-lg/);
  });

  it("有无障碍名字（原来的 role=tablist 有 aria-label，换控件不许丢）", async () => {
    await render();
    expect($("project-mode-select")!.getAttribute("aria-label")).toBe(
      "工程工作台视图"
    );
  });

  it("点开菜单，浮层必须在（不许被顶栏裁掉）", async () => {
    await render();
    const list = $("project-mode-select")!.querySelector("[role='listbox']");
    expect(list?.hasAttribute("hidden")).toBe(true);
    await act(async () => $<HTMLElement>("project-mode-trigger")!.click());
    expect(
      $("project-mode-select")!.querySelector("[role='listbox']")?.hasAttribute(
        "hidden"
      ),
      "点了还 hidden = 菜单没打开，真机就是「看着没有」"
    ).toBe(false);
  });

  it("切到源码就真的换面板", async () => {
    await render();
    await act(async () => selectProjectMode(container, "代码"));
    expect(projectModeValue(container)).toBe("source");
    // ⚠ 判据要落在真的换了面板上：只断言 select.value 变了，等于只证明
    //   「受控组件是受控的」，把 onChange 里那句 setWorkspaceOpened 删掉也绿。
    expect($("project-workspace-panel"), "源码面板必须真的挂出来").toBeTruthy();
  });
});

describe("地址行", () => {
  it("没打开也画地址，路径是 /（对照 Manus）；空态是唤醒不是说明书", async () => {
    await render();
    expect($("project-preview-addressbar")).not.toBeNull();
    expect($("project-preview-url")?.textContent).toBe("/");
    expect($("project-preview-paused"), "Manus 空态：窗骨架 + 唤醒").not.toBeNull();
    expect($("project-preview-paused")?.className).toMatch(/h-full/);
    expect($("project-preview-window"), "空态必须是小浏览器，不许两块白板").not.toBeNull();
    expect($("project-preview-window")?.className).toContain("sr-preview-window");
    expect($("project-preview-window")?.querySelector(".sr-preview-page")).not.toBeNull();
    expect($("project-preview-window")?.className).not.toContain(
      "sr-preview-wake-window"
    );
    expect($("project-preview-paused")?.getAttribute("data-preview-waking")).toBe(
      "false"
    );
    expect($("project-preview-wake")?.textContent).toBe("唤醒");
    expect($("project-preview-wake-spin"), "停着不许转圈").toBeNull();
    expect($("project-preview-frame-loading"), "没票不许盖框").toBeNull();
    expect(container.textContent).toContain("预览已暂停，点击以唤醒。");
    expect(container.textContent).not.toContain("检查应用");
    expect(container.textContent).not.toContain("点选元素定位源码");
    expect(container.textContent).not.toContain("获取本次访问授权");
    expect(container.textContent).not.toContain("E2B 沙盒");
    expect($("project-preview-canvas"), "空态也要落在 16:9 画布里").not.toBeNull();
    expect(
      $("project-preview-canvas")?.className,
      "台面必须是外壳灰，白画板才看得出 16:9"
    ).toContain("sr-shell-bg");
    expect(
      $("project-preview-canvas")?.className,
      "1920 画板不许把台面撑出可见栏"
    ).toMatch(/\bmin-w-0\b/);
    expect(
      $("scaled-stage-fit")?.getAttribute("data-hit-fit"),
      "空态也要 zoom，不能等有票才换命中"
    ).toBe("zoom");
    expect($("project-preview-scale")?.textContent).toContain("1920×1080");
    expect($("project-preview-scale")?.textContent).not.toContain("1920×1920");
    const view = $<HTMLSelectElement>("project-preview-view")!;
    expect(view.value).toBe("desktop");
    expect([...view.options].some(option => option.value === "iphone-14")).toBe(
      true
    );
    expect(
      $("project-preview-addressbar")?.querySelector(
        '[data-testid="project-preview-reload"]'
      ),
      "对照 Manus：刷新在地址胶囊里"
    ).not.toBeNull();
    expect($("project-preview-addressbar")?.className).toMatch(/rounded-full/);
    expect(
      $("project-preview-addressbar")?.className,
      "胶囊有上限，不许 flex-1 把两侧按钮挤出 overflow"
    ).toMatch(/max-w-/);
    expect($("project-preview-addressbar")?.className).not.toMatch(
      /(?:^|\s)flex-1(?:\s|$)/
    );
    expect(
      $("project-preview-addressbar")?.parentElement?.className,
      "地址在中间槽居中"
    ).toMatch(/justify-center/);
    expect($("project-preview-view"), "设备下拉必须还在，不能被挤走").not.toBeNull();
    expect(
      $("project-preview-addressbar")?.contains($("project-preview-view")!),
      "设备下拉在左侧，不进胶囊"
    ).toBe(false);
    expect($("project-mode-select")).not.toBeNull();
    expect($("project-preview-open"), "打开/刷新预览在右侧").not.toBeNull();
  });

  it("切设备只换画布，数字来自机型清单", async () => {
    await render();
    const view = $<HTMLSelectElement>("project-preview-view")!;
    await act(async () => {
      view.value = "iphone-14";
      view.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(view.value).toBe("iphone-14");
    expect($("project-preview-scale")?.textContent).toContain("390×844");
    expect($("project-preview-scale")?.textContent).not.toContain("1920×1080");
    expect($("sliderule-phone-frame"), "手机档要套机身").not.toBeNull();
  });

  it("打开后显示**路径**，完整地址留在 title 上", async () => {
    await opened();
    const url = $("project-preview-url")!;
    expect(url.textContent).toBe("/tasks?view=all");
    // ⚠ 反向：那串 runtimeId 主机名不许出现在行里（它会把这一行撑满）。
    expect(url.textContent).not.toContain("runtime-one.localhost");
    expect(url.getAttribute("title")).toContain("runtime-one.localhost");
  });

  it("授权入口在行里是 /，一次性票不许摊在脸上", async () => {
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) =>
      Response.json(
        init?.method === "POST"
          ? {
              ...ticket(),
              entryUrl:
                "http://runtime-one.localhost:3100/_whybuddy/authorize?ticket=secret-ticket",
            }
          : snapshot()
      )
    );
    await opened();
    expect($("project-preview-url")?.textContent).toBe("/");
    expect($("project-preview-url")?.getAttribute("title")).not.toContain(
      "ticket="
    );
    expect(container.textContent).not.toContain("secret-ticket");
    const open = $("project-preview-open-external");
    expect(open?.tagName).toBe("BUTTON");
    expect(open?.getAttribute("href")).toBeNull();
    expect(
      $("project-preview-frame-loading"),
      "授权还在路上必须盖着"
    ).not.toBeNull();
    expect(
      $("project-preview-frame-loading")?.className,
      "脸必须铺满盖层，不能塌成顶上一小块"
    ).toMatch(/h-full/);
    expect(
      $("project-preview-frame-loading")?.parentElement?.className,
      "盖层自己必须是 flex 列，否则 justify-center 没有高度"
    ).toMatch(/flex/);
  });

  it("外开链接是真链接，且带 noopener", async () => {
    await opened();
    const link = $<HTMLAnchorElement>("project-preview-addressbar")!.querySelector("a")!;
    expect(link.getAttribute("href")).toContain("/tasks?view=all");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("data-testid")).toBe("project-preview-open-external");
    expect(link.getAttribute("aria-label")).toBe("在新标签页打开预览");
  });

  it("授权入口外开另开一张票，iframe 那张不动；不许去光秃 /", async () => {
    let issued = 0;
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(_url).includes("/preview-ticket")) {
        issued += 1;
        return Response.json({
          ...ticket(),
          entryUrl: `http://runtime-one.localhost:3100/_whybuddy/authorize?ticket=ticket-${issued}`,
        });
      }
      return Response.json(snapshot());
    });
    const replace = vi.fn();
    const tab = {
      location: { href: "about:blank", replace },
      close: vi.fn(),
      opener: {} as Window | null,
    };
    const open = vi.fn(() => tab);
    vi.stubGlobal("open", open);
    await opened();
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toContain("ticket-1");
    expect(ticketPosts()).toHaveLength(1);
    await act(async () =>
      $<HTMLButtonElement>("project-preview-open-external")!.click()
    );
    expect(ticketPosts()).toHaveLength(2);
    expect(frame?.getAttribute("src")).toContain("ticket-1");
    expect(frame?.getAttribute("src")).not.toContain("ticket-2");
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(replace).toHaveBeenCalledWith(
      "http://runtime-one.localhost:3100/_whybuddy/authorize?ticket=ticket-2"
    );
    expect(replace.mock.calls[0][0]).not.toMatch(/\/$/);
    expect($("project-preview-url")?.textContent).toBe("/");
    expect(container.textContent).not.toContain("ticket-1");
    expect(container.textContent).not.toContain("ticket-2");
  });

  it("没票点刷新也要换票，不许把钮藏起来", async () => {
    await render();
    expect(ticketPosts()).toHaveLength(0);
    await act(async () => $<HTMLButtonElement>("project-preview-reload")!.click());
    expect(ticketPosts()).toHaveLength(1);
  });

  it("刷新 = 重新换一张票（POST），不是重拉状态快照", async () => {
    await opened();
    expect(ticketPosts()).toHaveLength(1);
    await act(async () => $<HTMLButtonElement>("project-preview-reload")!.click());
    // ⚠ 这一条钉的就是那个事故：第一版接的是 refresh()，只发 GET，
    //   页面纹丝不动。接错回去时 POST 停在 1 条，这里就红。
    expect(ticketPosts()).toHaveLength(2);
  });

  it("反向：不许有把 iframe 导回一次性 ticket 的「首页」按钮", async () => {
    await opened();
    const bar = $("project-preview-addressbar")!;
    const titles = [...bar.querySelectorAll("[title]")].map(el =>
      el.getAttribute("title")
    );
    expect(titles).not.toContain("回到首页");
  });
});
