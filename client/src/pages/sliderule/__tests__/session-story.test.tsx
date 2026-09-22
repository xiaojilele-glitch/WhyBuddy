// @vitest-environment jsdom
/**
 * 章节面的折：完成轮默认收起过程，工具组默认收起，失败仍在组里。
 *
 * 必须 jsdom——SSR 画不出 click 之后。不跟 ClaudeChatSurface 混，
 * 那份要 TransformStream。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SessionStory } from "../SessionStory";
import type { TurnStep, UiTurn } from "../types";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function chip(
  id: string,
  tool: string,
  progress: "acting" | "completed" | "failed",
  detail?: string
): TurnStep {
  return {
    id,
    kind: "chip",
    capabilityId: tool as never,
    roleId: "system",
    label: tool,
    realLlm: false,
    progressType: progress,
    ...(detail ? { projectDetail: detail } : {}),
  };
}

function turnOf(over: Partial<UiTurn> = {}): UiTurn {
  return {
    id: "t1",
    user: "构建 TicketStream",
    status: "complete",
    durationMs: 237_000,
    steps: [
      { id: "s1", kind: "model_speech", text: "我先把工程搭起来。" },
      chip("p1a", "project_patch", "acting"),
      chip("p1b", "project_patch", "completed"),
      chip("p2a", "project_patch", "acting"),
      chip("p2b", "project_patch", "failed"),
      chip("p3a", "project_patch", "acting"),
      chip("p3b", "project_patch", "completed"),
    ],
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "TicketStream 已完成。",
    assistantSource: "llm",
    main: null,
    actions: [],
    ...over,
  };
}

describe("完成轮默认折起过程，点开才摊", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  async function mount(node: React.ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(node);
    });
    return container;
  }

  it("正向：完成轮脸上是工作了 3m 57s，过程在 DOM 里但 hidden", async () => {
    const el = await mount(<SessionStory turn={turnOf()} streaming={false} />);
    const duration = el.querySelector('[data-testid="session-story-duration"]');
    expect(duration?.textContent).toContain("工作了 3m 57s");
    expect(duration?.textContent).toContain("编辑了 3 个文件");
    expect(duration?.getAttribute("aria-expanded")).toBe("false");
    const body = el.querySelector('[data-testid="session-story-body"]');
    expect(body, "过程必须还在，只是折起来").not.toBeNull();
    expect(body?.parentElement?.hasAttribute("hidden")).toBe(true);
    expect(el.textContent).toContain("我先把工程搭起来。");
  });

  it("点用时才摊开口和工具组", async () => {
    const el = await mount(<SessionStory turn={turnOf()} streaming={false} />);
    await act(async () => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="session-story-duration"]'
      )!.click();
    });
    const body = el.querySelector('[data-testid="session-story-body"]');
    expect(body?.parentElement?.hasAttribute("hidden")).toBe(false);
    expect(
      el.querySelector('[data-testid="session-story-tools-summary"]')
        ?.textContent
    ).toContain("编辑了 3 个文件");
  });

  it("工具组折着，点开才能看见失败那一行——不许 Map 盖掉", async () => {
    const el = await mount(<SessionStory turn={turnOf()} streaming={false} />);
    await act(async () => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="session-story-duration"]'
      )!.click();
    });
    const rows = () =>
      el.querySelectorAll<HTMLButtonElement>('[data-testid="project-task-row"]');
    expect(
      el
        .querySelector('[data-testid="session-story-timeline"]')
        ?.parentElement?.hasAttribute("hidden")
    ).toBe(true);
    expect(rows().length).toBe(3);
    await act(async () => {
      el.querySelector<HTMLButtonElement>(
        '[data-testid="session-story-tools-summary"]'
      )!.click();
    });
    expect(
      el
        .querySelector('[data-testid="session-story-timeline"]')
        ?.parentElement?.hasAttribute("hidden")
    ).toBe(false);
    const failed = [...rows()].filter(
      row => row.getAttribute("data-status") === "failed"
    );
    expect(failed).toHaveLength(1);
  });

  it("流式结束且人手没点过 → 收起（assistant-ui Reasoning）", async () => {
    const streamingTurn = turnOf({
      status: "streaming",
      durationMs: undefined,
    });
    const el = await mount(
      <SessionStory turn={streamingTurn} streaming />
    );
    expect(
      el
        .querySelector('[data-testid="session-story-body"]')
        ?.parentElement?.hasAttribute("hidden")
    ).toBe(false);
    await act(async () => {
      root!.render(<SessionStory turn={turnOf()} streaming={false} />);
    });
    expect(
      el
        .querySelector('[data-testid="session-story-duration"]')
        ?.getAttribute("aria-expanded")
    ).toBe("false");
    expect(
      el
        .querySelector('[data-testid="session-story-body"]')
        ?.parentElement?.hasAttribute("hidden")
    ).toBe(true);
  });

  it("进行中的工具组脸上是当前动作和 2/3，不是收尾摘要", async () => {
    const el = await mount(
      <SessionStory
        turn={turnOf({
          status: "streaming",
          durationMs: undefined,
          steps: [
            { id: "s1", kind: "model_speech", text: "我先改文件。" },
            chip("p1a", "project_patch", "acting"),
            chip("p1b", "project_patch", "completed"),
            chip("p2a", "project_patch", "acting"),
            chip("p2b", "project_patch", "completed"),
            chip("p3a", "project_patch", "acting"),
          ],
        })}
        streaming
      />
    );
    const summary = el.querySelector(
      '[data-testid="session-story-tools-summary"]'
    );
    expect(summary?.textContent).toContain("写入源码");
    expect(summary?.getAttribute("data-tool-group-meta")).toBe("2/3");
    expect(summary?.textContent).not.toContain("编辑了 3 个文件");
    expect(summary?.getAttribute("aria-expanded")).toBe("true");
  });

  it("开口里的无空格 token 必须能折，不能把对话栏顶出横向滚动条", async () => {
    const token =
      "pop-bf815cdd6794439faffe87cec5fca58dcomponents.call:default_api:todo_write{merge:true,todos:[{content:x}]}";
    const el = await mount(
      <SessionStory
        turn={turnOf({
          status: "streaming",
          durationMs: undefined,
          steps: [
            {
              id: "s1",
              kind: "model_speech",
              text: `先看 ${token} 再动手。`,
            },
            chip("c1", "project_create", "acting"),
          ],
        })}
        streaming
      />
    );
    const p = el.querySelector('[data-testid="sliderule-model-speech"] p');
    expect(p?.textContent).toContain(token);
    expect(p?.className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(p?.className).toMatch(/whitespace-pre-wrap/);
    expect(p?.className).not.toBe("whitespace-pre-wrap");
  });

  it("反向：还在跑的轮次不折过程", async () => {
    const el = await mount(
      <SessionStory
        turn={turnOf({
          status: "streaming",
          durationMs: undefined,
          steps: [
            { id: "s1", kind: "model_speech", text: "我先把工程搭起来。" },
            chip("c1", "project_create", "acting"),
          ],
        })}
        streaming
      />
    );
    expect(el.querySelector('[data-testid="session-story-duration"]')).toBeNull();
    expect(
      el
        .querySelector('[data-testid="session-story-body"]')
        ?.parentElement?.hasAttribute("hidden")
    ).toBe(false);
    expect(el.textContent).toContain("创建工程");
  });

  it("结果卡贴在过程折页后面，不许插进创建和下一段开口之间", async () => {
    const el = await mount(
      <SessionStory
        turn={turnOf({
          steps: [
            { id: "s1", kind: "model_speech", text: "我先把工程搭起来。" },
            chip("c1", "project_create", "completed"),
            chip("l1", "project_list", "completed"),
            { id: "s2", kind: "model_speech", text: "接着改筛选。" },
            chip("p1a", "project_patch", "acting"),
            chip("p1b", "project_patch", "completed"),
          ],
        })}
        streaming={false}
        productSlot={<div>番茄钟结果卡</div>}
      />
    );
    const body = el.querySelector('[data-testid="session-story-body"]');
    const product = el.querySelector('[data-testid="session-story-product"]');
    expect(product?.textContent).toContain("番茄钟结果卡");
    expect(body?.contains(product), "卡不许进过程中间").toBe(false);
    expect(product?.closest("[hidden]"), "折着过程时卡还在").toBeNull();
    expect(body?.parentElement?.hasAttribute("hidden")).toBe(true);
    const texts = [...(body?.children ?? [])].map(node =>
      (node.textContent || "").replace(/\s+/g, " ").trim()
    );
    expect(texts.some(text => text.includes("番茄钟结果卡"))).toBe(false);
    expect(texts.join("|")).toMatch(/搭起来.*创建工程.*接着改筛选/);
    // 变异：flushTools 后再插 product 进 body → contains 为真，本条红。
  });

  it("工具组是竖轨时间线；技能行能看见名字", async () => {
    const el = await mount(
      <SessionStory
        turn={turnOf({
          status: "streaming",
          durationMs: undefined,
          steps: [
            { id: "s1", kind: "model_speech", text: "先加载设计技能。" },
            chip("sk", "skill", "acting", "frontend-design"),
            chip("c1", "project_create", "completed"),
            chip("sh", "shell_exec", "completed", "pnpm run build"),
          ],
        })}
        streaming
      />
    );
    expect(el.querySelector('[data-testid="session-story-timeline"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="session-story-timeline-dot"]').length).toBeGreaterThan(0);
    expect(el.textContent).toContain("frontend-design");
    expect(el.textContent).toContain("加载技能");
    expect(
      el.querySelector('[data-testid="project-task-row"][data-task-id="skill"]')
        ?.getAttribute("data-family")
    ).toBe("skill");
    expect(el.textContent).toContain("创建工程");
    const command = el.querySelector('[data-testid="session-story-command"]');
    expect(command?.textContent).toContain("pnpm run build");
    const summary = el.querySelector('[data-testid="session-story-tools-summary"]');
    expect(summary?.textContent).toContain("正在加载技能");
    expect(summary?.textContent).toContain("frontend-design");
    expect(summary?.textContent).not.toContain("编辑了");
  });
});
