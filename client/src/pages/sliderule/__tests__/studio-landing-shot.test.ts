/**
 * 推演收口截落地页。盯三件：只在 running 掉沿才采、采的是导航第一页、
 * 真的接在 Studio 上（bypassBudget + replace）。
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import {
  landingPageFromSpec,
  rehearsalJustFinished,
} from "../studio-landing-shot";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("rehearsalJustFinished", () => {
  it("只认 true → false：打开已跑完的会话不该再截一次", () => {
    expect(rehearsalJustFinished(true, false)).toBe(true);
    expect(rehearsalJustFinished(false, false)).toBe(false);
    expect(rehearsalJustFinished(true, true)).toBe(false);
    expect(rehearsalJustFinished(false, true)).toBe(false);
  });
});

describe("landingPageFromSpec", () => {
  it("平板落地页保住 tablet，不折成 desktop", () => {
    const landing = landingPageFromSpec({
      pages: { home: "<html>平板首页</html>" },
      navItems: [{ pageId: "home" }],
      device: "tablet",
    });
    expect(landing?.html).toContain("平板首页");
    expect(landing?.device).toBe("tablet");
  });

  it("落地页是导航第一项，不是 Object.keys 碰巧排前的那页", () => {
    const landing = landingPageFromSpec({
      pages: {
        later: "<html>第二页</html>",
        home: "<html>首页</html>",
      },
      navItems: [{ pageId: "home" }, { pageId: "later" }],
      device: "desktop",
    });
    expect(landing?.html).toContain("首页");
    expect(landing?.device).toBe("desktop");
  });

  it("Python 壳的导航是 id/name，缺页要跳到下一份真 HTML", () => {
    const landing = landingPageFromSpec({
      pages: { p2: "<html>加工</html>", p3: "<html>分发</html>" },
      navItems: [{ id: "p1", name: "拾取" }, { id: "p2", name: "加工" }],
    });
    expect(landing?.html).toContain("加工");
  });

  it("没有导航就按 pages 里第一份非空 HTML", () => {
    const landing = landingPageFromSpec({
      pages: { only: "<html>独页</html>" },
    });
    expect(landing?.html).toContain("独页");
  });

  it("落库还没到、SSE 页在，就用 SSE 第一页——收口瞬间两份来源会交错", () => {
    const landing = landingPageFromSpec(null, [
      { pageId: "p1", html: "<html>SSE</html>", device: "phone" },
    ]);
    expect(landing?.html).toContain("SSE");
    expect(landing?.device).toBe("phone");
  });

  it("两头都空 → null，不编一份空白页去截", () => {
    expect(landingPageFromSpec(null, [])).toBeNull();
    expect(landingPageFromSpec({ pages: {} })).toBeNull();
  });
});

describe("接在活路径上", () => {
  it("StudioLandingShot 推演收口走 bypassBudget + replace + 会话查 app_id", () => {
    const src = stripComments(
      readFileSync(new URL("../studio-landing-shot.tsx", import.meta.url), "utf8")
    );
    expect(src).toContain("bypassBudget: true");
    expect(src).toContain("replace: true");
    expect(src).toContain("getGeneratedAppForSession");
    expect(src).toContain("captureAndUpload");
    expect(src).toContain("HtmlAppSurface");
    expect(src).toContain('fillPhone={job.device === "phone"}');
  });

  it("SlideRuleStudio 挂了 StudioLandingShot——卸掉就采不到", () => {
    const src = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    expect(src).toContain("<StudioLandingShot");
    expect(src).toContain("running={isRunning}");
    expect(src).toContain("StudioShareToggle");
  });

  it("私有/开放开关在生成前也占位 —— 卸掉 app 就整颗消失，用户找不到", () => {
    const src = stripComments(
      readFileSync(new URL("../StudioShareToggle.tsx", import.meta.url), "utf8")
    );
    expect(src).toContain("compact");
    expect(src).toContain("私有");
    expect(src).toContain("开放");
    expect(src).not.toMatch(/if\s*\(\s*!sessionId\s*\|\|\s*!app/);
  });
});
