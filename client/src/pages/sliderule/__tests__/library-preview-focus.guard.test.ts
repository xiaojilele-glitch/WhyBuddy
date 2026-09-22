// @vitest-environment jsdom
/**
 * 守卫行为。单独开 jsdom：和源码字符串断言放一起会让 import.meta.url
 * 变成 http，readFileSync 直接炸。
 */
import { afterEach, describe, expect, it } from "vitest";
import { attachPreviewFocusGuard } from "../library-preview-focus";

function mountWall() {
  const scroller = document.createElement("div");
  scroller.className = "native-content";
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    writable: true,
    value: 0,
  });
  const wall = document.createElement("div");
  wall.setAttribute("data-testid", "components-wall");
  const input = document.createElement("input");
  wall.appendChild(input);
  scroller.appendChild(wall);
  document.body.appendChild(scroller);
  const stop = attachPreviewFocusGuard(document);
  return { scroller, input, stop };
}

describe("attachPreviewFocusGuard", () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.replaceChildren();
  });

  it("autofocus 引发的 scroll 不该被记下——拦完要回到 0", () => {
    const wall = mountWall();
    stop = wall.stop;
    // 模拟浏览器：先为抢焦点滚进视野，再 focusin。
    wall.scroller.scrollTop = 1721;
    wall.scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    wall.input.focus();
    expect(wall.scroller.scrollTop).toBe(0);
    expect(document.activeElement).not.toBe(wall.input);
  });

  it("用户自己滚过之后，拦焦点应回到用户位置", () => {
    const wall = mountWall();
    stop = wall.stop;
    wall.scroller.scrollTop = 400;
    wall.scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    wall.scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    wall.scroller.scrollTop = 1721;
    wall.input.focus();
    expect(wall.scroller.scrollTop).toBe(400);
  });

  it("人手点进输入框不该被拦", () => {
    const wall = mountWall();
    stop = wall.stop;
    wall.input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    wall.input.focus();
    expect(document.activeElement).toBe(wall.input);
  });
});
