// @vitest-environment jsdom
/**
 * 思考球必须转。2026-09-15 真机 prefers-reduced-motion=reduce，
 * 库组件冻成一帧，用户圈了「没有动效」。判据钉的是 rAF 被叫过。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThinkingOrbMark } from "../ThinkingOrbMark";

let root: Root;
let container: HTMLDivElement;
let raf: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: String(query).includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
    onchange: null,
  }));
  raf = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy(
      {},
      {
        get: () => () => {},
      }
    )) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  localStorage.removeItem("sliderule:reduce-motion");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("系统减动效不许冻思考球", () => {
  it("prefers-reduced-motion 为 reduce 时仍然申请 rAF", async () => {
    await act(async () => {
      root.render(<ThinkingOrbMark label="正在想…" />);
    });
    expect(container.querySelector('[data-testid="sliderule-thinking-orb"]')).not.toBeNull();
    expect(raf).toHaveBeenCalled();
  });

  it("反向：应用内减少动态效果才冻，不申请 rAF", async () => {
    localStorage.setItem("sliderule:reduce-motion", "1");
    await act(async () => {
      root.render(<ThinkingOrbMark label="正在想…" />);
    });
    expect(raf).not.toHaveBeenCalled();
  });
});
