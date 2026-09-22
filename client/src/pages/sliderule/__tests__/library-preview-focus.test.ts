/**
 * 组件库加载完滚到底：预览墙里的表单会抢焦点。
 *
 * 判据盯「墙里的程序化焦点要拦、人手点的要放」。变异：
 *   · fromPointer 也拦 → 示例点不进输入框
 *   · 墙外（搜索框）也拦 → 顶栏搜不了
 * 两条都该红。
 *
 * 2026-08-19 第二版假绿：守卫挂上了，但把浏览器为抢焦点滚到的 1721
 * 当成用户位置写回去。行为测试在 library-preview-focus.guard.test.ts，
 * 把「autofocus 引发的 scroll 也记下来」改回去必须红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_WALL_FOCUS_GUARD,
  shouldSuppressPreviewAutofocus,
} from "../library-preview-focus";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n");
}

const closest =
  (hit: string | null) =>
  (selector: string) =>
    selector === PREVIEW_WALL_FOCUS_GUARD ? hit : null;

describe("shouldSuppressPreviewAutofocus", () => {
  it("墙里的程序化焦点要拦", () => {
    expect(
      shouldSuppressPreviewAutofocus(false, { closest: closest("wall") })
    ).toBe(true);
  });

  it("人手刚点过 → 不该拦（示例还要能输入）", () => {
    expect(
      shouldSuppressPreviewAutofocus(true, { closest: closest("wall") })
    ).toBe(false);
  });

  it("墙外（顶栏搜索）不该拦", () => {
    expect(
      shouldSuppressPreviewAutofocus(false, { closest: closest(null) })
    ).toBe(false);
  });
});

describe("装在组件库真链路上", () => {
  it("第一帧就挂预览范围，并且关掉滚动锚定", () => {
    const live = stripComments(
      readFileSync(
        new URL("../ComponentsLibraryPage.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(live).toContain("LibraryPreviewScope");
    expect(live).toContain('overflowAnchor: "none"');
    // 旧接法：layout effect 里再挂，赶不上 ProForm 插入节点时的 autofocus。
    expect(live).not.toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*?attachPreviewFocusGuard\(el\)/
    );
  });

  it("预览里的 ProForm 必须关掉首字段 autofocus", () => {
    const registry = stripComments(
      readFileSync(
        new URL("../live-runtime/block-registry.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(registry).toContain("useLibraryPreview");
    expect(registry).toContain(
      "autoFocusFirstInput={preview ? false : props.autoFocusFirstInput}"
    );
    // 真应用路径必须还能走默认 true：变异成永远 false 这条该红。
    expect(registry).not.toMatch(
      /function ProForm[\s\S]*autoFocusFirstInput=\{false\}/
    );
  });
});
