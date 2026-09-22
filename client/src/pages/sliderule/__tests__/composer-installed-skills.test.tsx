// @vitest-environment jsdom
/**
 * `/` 面板能选已装技能，选中留下 @slug。
 *
 * 反向：没装的不出现；选中再走摘斜杠空芯片，正文没有点名。
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/skill-store-client", () => ({
  fetchSkillCatalog: async () => [
    {
      id: "office",
      slug: "office-skills",
      name: "office-skills",
      description: "做 PPT / Word / Excel",
      version: "1.0.0",
      installed: true,
    },
    {
      id: "ghost",
      slug: "ghost",
      name: "ghost",
      description: "没装",
      version: "1.0.0",
      installed: false,
    },
  ],
  selectedSkillsDrivePayload: () => undefined,
}));

vi.mock("../connectors-client", () => ({
  listConnectors: async () => [],
}));

import { ComposerDock } from "../ComposerDock";

function Harness() {
  const [input, setInput] = React.useState("");
  return (
    <ComposerDock
      input={input}
      setInput={setInput}
      sendMessage={() => {}}
      isRunning={false}
      sessionId="mention-ui"
      goal="做个PPT"
    />
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("已装技能进斜杠面板", () => {
  it("点 / 能选 office-skills，选中留下 @office-skills，没装的不出现", async () => {
    await act(async () => {
      root.render(<Harness />);
    });
    await flush();

    const hint = container.querySelector<HTMLButtonElement>(
      '[data-testid="sliderule-slash-hint"]'
    );
    expect(hint).toBeTruthy();
    await act(async () => {
      hint!.click();
    });
    await flush();

    const menu = container.querySelector('[data-testid="sliderule-slash-menu"]');
    expect(menu).toBeTruthy();
    const keys = [
      ...container.querySelectorAll("[data-testid='sliderule-slash-item']"),
    ].map(node => node.getAttribute("data-key"));
    expect(keys).toContain("scope");
    expect(keys).toContain("office-skills");
    expect(keys).not.toContain("ghost");
    expect(container.innerHTML).not.toContain("SkillSelectBar");

    const skill = container.querySelector<HTMLButtonElement>(
      '[data-testid="sliderule-slash-item"][data-key="office-skills"]'
    );
    expect(skill).toBeTruthy();
    await act(async () => {
      skill!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true })
      );
    });
    await flush();

    const box = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="sliderule-composer-input"]'
    );
    expect(box?.value).toContain("@office-skills");
    expect(box?.value).not.toMatch(/^\/off/);
  });
});
