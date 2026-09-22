/**
 * 思考指示接在真跑的那条路上。
 *
 * 2026-09-15：三点 bounce（sr-dot / SpinKit）用户说死。换成
 * Jakubantalik/thinking-orbs。正向：对话列和右舞台都挂 ThinkingOrbMark。
 * 反向：sr-dot 加回去必红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { thinkingOrbState } from "../thinking-orb-state";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("thinkingOrbState", () => {
  it("正向：正在想 → working，不猜成 solving", () => {
    expect(thinkingOrbState("正在想…")).toBe("working");
    expect(thinkingOrbState("")).toBe("working");
  });

  it("正向：读源码 / 起草 / 修错误 / 装依赖 各走各的态", () => {
    expect(thinkingOrbState("查看工程当前状态和源码")).toBe("searching");
    expect(thinkingOrbState("起草 SPEC")).toBe("composing");
    expect(thinkingOrbState("修复类型错误")).toBe("solving");
    expect(thinkingOrbState("创建工程并安装依赖")).toBe("connecting");
  });
});

describe("接在真跑的那条路上（§1 / §3）", () => {
  it("左栏和右舞台都走 ThinkingOrbMark，不再画 sr-dot", () => {
    const chat = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    const studio = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    const mark = stripComments(
      readFileSync(new URL("../ThinkingOrbMark.tsx", import.meta.url), "utf8")
    );
    expect(chat).toContain("<ThinkingOrbMark");
    expect(studio).toContain("<ThinkingOrbMark");
    expect(chat).not.toContain("sr-dot");
    expect(studio).not.toContain("sr-dot");
    expect(mark).toContain("thinking-orbs/engine");
    expect(mark).toContain("requestAnimationFrame");
    expect(mark).toContain("loadReduceMotionPref");
    // 反向：走库组件 = 系统减动效冻成一帧，正是用户圈的「没有动效」。
    expect(mark).not.toContain("isMotionReduced");
    expect(mark).not.toMatch(/from ["']thinking-orbs["']/);
    expect(mark).not.toContain("prefers-reduced-motion");
  });

  it("对话列顶上不再挂六步钟", () => {
    const chat = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    const surface = chat.slice(
      chat.indexOf("export function ClaudeChatSurface"),
      chat.indexOf("function DriveFullStatusBanner")
    );
    expect(surface).not.toContain("<RehearsalClockHud");
    expect(surface).not.toContain("sliderule-rehearsal-clock");
  });
});
