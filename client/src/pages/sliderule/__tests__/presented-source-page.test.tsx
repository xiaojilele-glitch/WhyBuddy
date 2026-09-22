// @vitest-environment jsdom
/**
 * 预览框里是 Agent 写的那一页，不是宿主套的幻灯片。
 *
 * ⚠ 2026-09-22 把 srcdoc 换成产物预览地址，或正文被改写，本条变红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PresentedSourcePage } from "../project-runtime/PresentedSourcePage";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("PresentedSourcePage", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  it("原样打开点名的源码，不套幻灯片", async () => {
    const page = "<!DOCTYPE html><h1>面团启动会</h1>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).toContain("/projects/proj-office/source/file?");
        expect(url).toContain("path=slides.html");
        expect(url).not.toContain("render=browser");
        return new Response(JSON.stringify({ path: "slides.html", content: page }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<PresentedSourcePage projectId="proj-office" path="slides.html" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const frame = container.querySelector<HTMLIFrameElement>(
      '[data-testid="agent-presented-page"]'
    );
    expect(frame?.getAttribute("srcdoc")).toBe(page);
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("src")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
  });
});
