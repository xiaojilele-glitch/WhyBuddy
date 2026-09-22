/**
 * 推演页鼠标点阵：对照 interactive-dot-grid 的二次衰减，接线必须在 Studio 外壳。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cursorInfluence, HOME_HOVER_DOT, dotTileCss } from "../home-hover-dots";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("cursorInfluence 二次衰减", () => {
  it("圆心是 1，半径外是 0，半程是 0.25 不是 0.5", () => {
    expect(cursorInfluence(0, 100)).toBe(1);
    expect(cursorInfluence(100, 100)).toBe(0);
    expect(cursorInfluence(200, 100)).toBe(0);
    expect(cursorInfluence(50, 100)).toBe(0.25);
  });

  it("半径非法时不抛、不当成亮点", () => {
    expect(cursorInfluence(0, 0)).toBe(0);
    expect(cursorInfluence(10, -8)).toBe(0);
  });
});

describe("点色是浅灰不是粉紫", () => {
  it("暖灰，相对加浓那版再淡 2/3，全宽后再淡一半，密和小剩 1/3", () => {
    expect(HOME_HOVER_DOT.color).toBe("88,84,80");
    expect(HOME_HOVER_DOT.baseAlpha).toBeCloseTo((0.2 * 2) / 3 / 2, 5);
    expect(HOME_HOVER_DOT.maxAlpha).toBeCloseTo((0.78 * 2) / 3 / 2, 5);
    expect(HOME_HOVER_DOT.spacing).toBeCloseTo(24 / 3, 5);
    expect(HOME_HOVER_DOT.dotMin).toBeCloseTo(1.35 / 3, 5);
    expect(HOME_HOVER_DOT.dotMax).toBeCloseTo((1.35 / 3) * 1.8, 5);
    expect(HOME_HOVER_DOT.radiusEffect).toBe(72);
    expect(HOME_HOVER_DOT.dotMax).toBeLessThan(HOME_HOVER_DOT.spacing / 2);
    expect(HOME_HOVER_DOT.color).not.toMatch(/139,\s*92,\s*246/);
    const tile = dotTileCss(HOME_HOVER_DOT.dotMin, HOME_HOVER_DOT.baseAlpha);
    expect(tile).toContain("radial-gradient");
    expect(tile).toContain(HOME_HOVER_DOT.color);
    expect(tile).not.toContain("canvas");
  });
});

describe("活路径：Studio 全页挂点，空态和开聊都有", () => {
  it("SlideRuleStudio 外壳挂 HomeHoverDots，对话栏透底，听 window 不是听 canvas", () => {
    const slideRule = stripComments(
      readFileSync(
        fileURLToPath(new URL("../../SlideRule.tsx", import.meta.url)),
        "utf8"
      )
    );
    const emptyAt = slideRule.indexOf("function HomeEmptyState");
    expect(emptyAt).toBeGreaterThan(-1);
    const empty = slideRule.slice(
      emptyAt,
      slideRule.indexOf("function ClaudeChatSurface", emptyAt)
    );
    // 反：挂回 Empty 会被 Viewport max-w-[720px] 裁成中间一条。
    expect(empty).not.toContain("HomeHoverDots");

    const surfaceAt = slideRule.indexOf("function ClaudeChatSurface");
    expect(surfaceAt).toBeGreaterThan(-1);
    const surface = slideRule.slice(surfaceAt);
    // 反：只挂空线程，开聊（/agent-loop/sliderule 工作台）会丢点。
    expect(surface).not.toContain("HomeHoverDots");
    expect(surface).toContain("bg-transparent");
    expect(surface).toContain("max-w-[720px]");

    const studio = stripComments(
      readFileSync(
        fileURLToPath(new URL("../SlideRuleStudio.tsx", import.meta.url)),
        "utf8"
      )
    );
    expect(studio).toContain("HomeHoverDots");
    expect(studio).toContain("function StudioChrome");
    const early = studio.slice(
      studio.indexOf("if (!showStage)"),
      studio.indexOf("const stagePanel")
    );
    // 反：只挂分栏 return，空会话 early return 会丢点。
    expect(early).toContain("StudioChrome");
    const splitReturn = studio.slice(studio.lastIndexOf("return ("));
    expect(splitReturn).toContain("StudioChrome");
    expect(splitReturn).toContain("bg-transparent");

    const dotsRaw = readFileSync(
      fileURLToPath(new URL("../home-hover-dots.tsx", import.meta.url)),
      "utf8"
    );
    const dots = stripComments(dotsRaw);
    expect(dots).toContain("window.addEventListener(\"mousemove\"");
    expect(dots).not.toContain("canvas.addEventListener(\"mousemove\"");
    expect(dots).toContain("pointerEvents = \"none\"");
    expect(dots).toContain("sliderule-home-hover-dots");
    expect(dots).not.toContain("rgba(167,139,250");
    expect(dots).toContain("radial-gradient");
    expect(dots).toContain("maskImage");
    expect(dots).toContain("--mx");
    expect(dots).not.toContain('getContext("2d")');
    expect(dots).not.toContain("requestAnimationFrame");
    expect(dots).not.toContain("beginPath");
    const reducedAt = dots.indexOf("function prefersReducedMotion");
    const mountAt = dots.indexOf("export function mountHomeHoverDotGrid");
    const reducedFn = dots.slice(reducedAt, mountAt);
    expect(reducedFn).not.toContain("addEventListener");
    expect(dots).toContain("sliderule-home-hover-spot");
  });
});
