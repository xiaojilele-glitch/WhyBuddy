import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { livePagesFromSpec, missingPageHtml, specLivePageIds } from "../spec-live-pages";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("specLivePageIds", () => {
  it("名单跟 spec 导航走，不能只剩落库那两页", () => {
    const ids = specLivePageIds({
      pages: { p2: "<html>加工</html>", p3: "<html>分发</html>" },
      navItems: [
        { id: "p1", name: "拾取工作台" },
        { id: "p2", name: "加工工作站" },
        { id: "p3", name: "分发工作台" },
        { id: "p4", name: "知识资产库" },
      ],
    });
    expect(ids).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("livePagesFromSpec", () => {
  it("缺页仍能切：点 p1 有 HTML，且带着四条 data-page-id", () => {
    const pages = livePagesFromSpec({
      pages: { p2: "<html>加工</html>", p3: "<html>分发</html>" },
      navItems: [
        { id: "p1", name: "拾取工作台" },
        { id: "p2", name: "加工工作站" },
        { id: "p3", name: "分发工作台" },
        { id: "p4", name: "知识资产库" },
      ],
      failedPages: { p1: "页面 p1 的 HTML 未通过校验：未授权的外部链接 tech.example.com" },
      boundPages: 2,
    });
    expect(pages.map(p => p.pageId)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(pages[0].missing).toBe(true);
    expect(pages[1].missing).toBeFalsy();
    expect(pages[0].html).toContain('data-page-id="p1"');
    expect(pages[0].html).toContain('data-page-id="p2"');
    expect(pages[0].html).toContain("拾取工作台");
    expect(pages[0].html).toContain("tech.example.com");
    expect(pages[0].bound).toBe(false);
    expect(pages[1].html).toContain("加工");
    expect(pages.map(p => p.total)).toEqual([2, 2, 2, 2]);
  });

  it("落库还没到就走 SSE 页", () => {
    const sse = [{ pageId: "p1", html: "<html>SSE</html>", current: 1, total: 1, bound: false }];
    expect(livePagesFromSpec(null, sse)).toBe(sse);
    expect(livePagesFromSpec({ pages: {} }, sse)).toBe(sse);
  });
});

describe("missingPageHtml", () => {
  it("失败页不许看起来像成品", () => {
    const html = missingPageHtml({
      pageId: "p1",
      name: "拾取工作台",
      reason: "未授权外链",
      nav: [{ pageId: "p1", name: "拾取工作台" }, { pageId: "p2", name: "加工工作站" }],
    });
    expect(html).toContain('data-missing-page="p1"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("已接数据");
    expect(html).toContain("<aside");
    expect(html).not.toMatch(/\bhref\s*=/);
  });

  it("手机缺页必须自带白底顶栏底栏，不许塞进黑 iframe", () => {
    const html = missingPageHtml({
      pageId: "p2",
      name: "创作",
      reason: "校验未通过",
      nav: [
        { pageId: "p1", name: "首页" },
        { pageId: "p2", name: "创作" },
      ],
      device: "phone",
    });
    expect(html).toContain("bg-white");
    expect(html).toContain("<header");
    expect(html).toContain("<nav");
    expect(html).toContain('data-page-id="p1"');
    expect(html).not.toMatch(/\bhref\s*=/);
    expect(html).not.toContain("<aside");
    expect(html).toContain('data-missing-page="p2"');
  });

  it("livePagesFromSpec 把 device 传给缺页骨架", () => {
    const pages = livePagesFromSpec({
      device: "phone",
      pages: { p1: "<html>首页</html>" },
      navItems: [
        { id: "p1", name: "首页" },
        { id: "p2", name: "创作" },
      ],
    });
    expect(pages[1].missing).toBe(true);
    expect(pages[1].html).toContain("bg-white");
    expect(pages[1].html).not.toContain("<aside");
  });
});

describe("接在活路径上", () => {
  it("Studio 走 livePagesFromSpec，不许再只 map Object.keys", () => {
    const src = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    expect(src).toContain("livePagesFromSpec");
    expect(src).not.toMatch(/Object\.keys\(settled\)/);
  });
});
