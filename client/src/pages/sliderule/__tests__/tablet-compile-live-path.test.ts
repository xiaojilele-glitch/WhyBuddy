/**
 * 平板编译必须接到通电的插座上（2026-08-30 夜）。
 *
 * 授予已经是 tablet，SSE / 画布 / 应用中心若再写成
 * `device === "phone" ? "phone" : "desktop"`，舞台静默领走 1920。
 *
 * ⚠ 先剥注释再匹配。本文件和被查文件都写着 tablet，不剥的话
 * 把调用点删了判据照样绿。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deviceViewportCss, layoutDevice } from "../product-archetypes";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function load(rel: string): string {
  return stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));
}

describe("layoutDevice / deviceViewportCss", () => {
  it("接通的 tablet 不许折成 desktop", () => {
    expect(layoutDevice("tablet")).toBe("tablet");
    expect(layoutDevice("phone")).toBe("phone");
    expect(layoutDevice("watch")).toBe("desktop");
    expect(deviceViewportCss("tablet")).toEqual({ w: 1112, h: 834 });
  });
});

describe("活路不许再写成 phone else desktop", () => {
  it("SSE spec_page 用 layoutDevice，不二分", () => {
    const src = load("../../../lib/sliderule-marathon-driver.ts");
    expect(src).toContain("layoutDevice(event.device)");
    expect(src).not.toMatch(
      /device:\s*event\.device\s*===\s*"phone"\s*\?\s*"phone"\s*:\s*"desktop"/,
    );
  });

  it("画布属性用 layoutDevice，不二分", () => {
    const src = load("../live-runtime/canvas-board-graph.ts");
    expect(src).toContain("layoutDevice(page.device)");
    expect(src).not.toMatch(
      /device:\s*page\.device\s*===\s*"phone"\s*\?\s*"phone"\s*:\s*"desktop"/,
    );
  });

  it("画布视口从账本读，不手写 phone ? 390 : 1920", () => {
    const src = load("../live-runtime/canvas-scale.tsx");
    expect(src).toContain("deviceViewportCss");
    expect(src).not.toMatch(
      /device\s*===\s*"phone"\s*\?\s*SPEC_PAGE_VIEWPORT_PHONE\s*:\s*SPEC_PAGE_VIEWPORT/,
    );
  });

  it("应用中心收载荷用 layoutDevice", () => {
    const src = load(
      "../../agent-loop/dashboard/AppsWorkbench.tsx",
    );
    expect(src).toContain("layoutDevice(r.device)");
    expect(src).not.toMatch(
      /device:\s*r\.device\s*===\s*"phone"\s*\?\s*"phone"\s*:\s*"desktop"/,
    );
  });
});

describe("消费侧 device 类型必须含 tablet", () => {
  /**
   * 2026-08-30 CI：SSE 已经放出 tablet，舞台 / 分栏 / 落图 / 点选编辑
   * 的 props 还停在 `phone | desktop`，tsc 把整条活路挡住。
   * 反面：这些文件里若还留着二分类型，本条必须红。
   */
  it("舞台落库 blob 用 SpecFirstPagesBlob，不再手写二分 device", () => {
    const src = load("../SlideRuleStudio.tsx");
    expect(src).toContain("SpecFirstPagesBlob");
    expect(src).not.toMatch(/device\?: "desktop" \| "phone";/);
  });

  const files = [
    "../StudioSplit.tsx",
    "../studio-landing-shot.tsx",
    "../useSlideRuleSession.ts",
    "../live-runtime/canvas-board-graph.ts",
    "../../agent-loop/dashboard/ClickEditStage.tsx",
  ];

  it.each(files)("%s 收下 tablet，不许再写二分类型", rel => {
    const src = load(rel);
    expect(src).toMatch(/"desktop"\s*\|\s*"phone"\s*\|\s*"tablet"/);
    expect(src).not.toMatch(/device\?: "desktop" \| "phone";/);
    expect(src).not.toMatch(/device\?: "desktop" \| "phone"\)/);
    expect(src).not.toMatch(/device\?: "desktop" \| "phone" \}/);
  });
});

