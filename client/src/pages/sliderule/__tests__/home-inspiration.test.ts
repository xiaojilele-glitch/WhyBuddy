import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INSPIRATION_LEAD,
  INSPIRATION_LINK,
  INSPIRATION_TAIL,
} from "../home-inspiration";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("空态灵感是一句导去应用市场", () => {
  it("文案是需要灵感？应用市场，Fork一下，快人一步", () => {
    expect(`${INSPIRATION_LEAD}${INSPIRATION_LINK}${INSPIRATION_TAIL}`).toBe(
      "需要灵感？应用市场，Fork一下，快人一步"
    );
  });

  it("活路径只有应用市场链接，不拉货架、不画卡", () => {
    const src = stripComments(
      readFileSync(
        fileURLToPath(new URL("../home-inspiration.tsx", import.meta.url)),
        "utf8"
      )
    );
    expect(src).toContain('href="/agent-loop/workbench"');
    expect(src).toContain("INSPIRATION_LEAD");
    expect(src).toContain("INSPIRATION_TAIL");
    expect(src).not.toContain("listApps");
    expect(src).not.toContain("justifiedRows");
    expect(src).not.toContain("appPreviewUrl");
    expect(src).not.toContain("grid-cols-3");
    expect(src).not.toContain("AppsWorkbench");
    expect(src).not.toContain("MiniAppPreview");
    expect(src).not.toContain("采购审批应用");
    expect(src).not.toContain("sliderule:fill-prompt");
  });

  it("空态接的是 HomeInspiration，不是 QUICK_STARTS 再画一遍", () => {
    const src = stripComments(
      readFileSync(
        fileURLToPath(new URL("../../SlideRule.tsx", import.meta.url)),
        "utf8"
      )
    );
    const emptyAt = src.indexOf("function HomeEmptyState");
    expect(emptyAt).toBeGreaterThan(-1);
    const body = src.slice(
      emptyAt,
      src.indexOf("function ClaudeChatSurface", emptyAt)
    );
    expect(body).toContain("HomeInspiration");
    expect(body).not.toContain("sliderule-inspiration-${");
  });
});
