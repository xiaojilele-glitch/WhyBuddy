/**
 * boundPages 是成功数，不是全有全无开关。
 *
 * 2026-08-18 CareBridge：3 页打上、p2 失败，落库写成 0，刷新后四页
 * 徽标全撒谎。把判定改回去（只看 boundPages > 0）这条必须红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageIsBoundFromSpec } from "../spec-page-bound";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const partial = {
  boundPages: 3,
  failedPages: { p2: "页面 p2 打孔失败（重问 2 次后）" },
};

describe("pageIsBoundFromSpec", () => {
  it("部分失败：成功页 bound、失败页不是", () => {
    expect(pageIsBoundFromSpec("p1", partial)).toBe(true);
    expect(pageIsBoundFromSpec("p3", partial)).toBe(true);
    expect(pageIsBoundFromSpec("p2", partial)).toBe(false);
  });

  it("boundPages=0 一律没打上——含旧存档把部分失败记成 0", () => {
    expect(pageIsBoundFromSpec("p1", { boundPages: 0, failedPages: { p2: "x" } })).toBe(
      false
    );
    expect(pageIsBoundFromSpec("p1", { boundPages: 0 })).toBe(false);
    expect(pageIsBoundFromSpec("p1", null)).toBe(false);
  });

  it("反向：只看 boundPages>0 会把失败页也说成打上了", () => {
    const naive = Number(partial.boundPages) > 0;
    expect(naive).toBe(true);
    expect(pageIsBoundFromSpec("p2", partial)).toBe(false);
  });

  it("有 pageBindStatus 时认相位，不靠成功数反推", () => {
    const spec = {
      boundPages: 0,
      pageBindStatus: { p1: "bound", p2: "failed", p3: "skipped" },
    };
    expect(pageIsBoundFromSpec("p1", spec)).toBe(true);
    expect(pageIsBoundFromSpec("p2", spec)).toBe(false);
    expect(pageIsBoundFromSpec("p3", spec)).toBe(false);
  });
});

describe("打孔徽标接在通电的两处", () => {
  it("会话舞台和中心预览都走 pageIsBoundFromSpec，不许退回 boundPages>0", () => {
    const live = stripComments(
      readFileSync(new URL("../spec-live-pages.ts", import.meta.url), "utf8")
    );
    expect(live).toContain("pageIsBoundFromSpec");

    const studio = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    expect(studio).toContain("livePagesFromSpec");
    expect(studio).not.toContain("boundPages ?? 0) > 0");

    const workbench = stripComments(
      readFileSync(
        new URL(
          "../../agent-loop/dashboard/AppsWorkbench.tsx",
          import.meta.url
        ),
        "utf8"
      )
    );
    expect(workbench).toContain("livePagesFromSpec");
    expect(workbench).not.toContain("boundPages ?? 0) > 0");
  });
});
