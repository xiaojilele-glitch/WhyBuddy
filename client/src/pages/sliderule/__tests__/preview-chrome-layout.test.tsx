// @vitest-environment jsdom
/**
 * 预览右上两颗：全屏切档、隐藏卸舞台。藏完同一颗能开回来。
 *
 * 必须 jsdom——SSR 点不了。不挂整页 StudioSplit：隐藏只翻
 * stagePageHidden；全屏要 chatRef 才折对话，这里只验调用口。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PreviewChromeLayoutButtons } from "../SlideRuleTopHud";
import {
  StudioLayoutProvider,
  useStudioLayout,
} from "../StudioLayoutContext";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe() {
  const studio = useStudioLayout();
  return (
    <span data-testid="layout-probe">
      {studio?.stagePageHidden ? "hidden" : "shown"}
    </span>
  );
}

describe("预览右上角全屏 + 隐藏右栏", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  async function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <StudioLayoutProvider available>
          <PreviewChromeLayoutButtons />
          <Probe />
        </StudioLayoutProvider>
      );
    });
    return container;
  }

  it("隐藏卸掉右栏，同一颗变成显示页面并能开回", async () => {
    const el = await mount();
    const hide = el.querySelector<HTMLButtonElement>(
      '[data-testid="project-preview-hide-stage"]'
    );
    expect(hide?.getAttribute("aria-label")).toBe("隐藏页面");
    expect(el.querySelector('[data-testid="project-preview-fullscreen"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="layout-probe"]')?.textContent).toBe(
      "shown"
    );

    await act(async () => {
      hide!.click();
    });
    expect(el.querySelector('[data-testid="layout-probe"]')?.textContent).toBe(
      "hidden"
    );
    expect(
      el
        .querySelector('[data-testid="project-preview-hide-stage"]')
        ?.getAttribute("aria-label")
    ).toBe("显示页面");
    expect(el.querySelector('[data-testid="project-preview-fullscreen"]')).toBeNull();

    await act(async () => {
      el
        .querySelector<HTMLButtonElement>(
          '[data-testid="project-preview-hide-stage"]'
        )!
        .click();
    });
    expect(el.querySelector('[data-testid="layout-probe"]')?.textContent).toBe(
      "shown"
    );
    expect(el.querySelector('[data-testid="project-preview-fullscreen"]')).not.toBeNull();
    // 变异：走 panel.collapse → stagePageHidden 不翻，probe 仍 shown，本条红。
  });
});
