// @vitest-environment jsdom
/**
 * 画布点选编辑的纯函数层。
 *
 * 正向：改文字/字号/加粗/颜色/删除都真的落到源 HTML 上。
 * 反向：**找不到元素时必须 ok:false**，不许悄悄返回一份没改动的 HTML
 *       再让调用方拿去落库（"闸全绿但东西没变"）。
 */
import { describe, expect, it } from "vitest";

import {
  applyElementOp,
  clampFontPx,
  frameRectToNodeRect,
  MAX_FONT_PX,
  MIN_FONT_PX,
} from "../canvas-element-edit";
import { elementPath } from "../element-path";

const PAGE = `<!DOCTYPE html><html><head><title>t</title></head><body><main><h1>标题</h1><p class="x">正文</p></main></body></html>`;

function pathTo(sel: string, html = PAGE) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return elementPath(doc.querySelector(sel)!, doc.body)!;
}

describe("坐标换算", () => {
  it("按画板缩放换算，宽高一起缩", () => {
    const r = frameRectToNodeRect(
      { left: 100, top: 50, width: 200, height: 40 },
      { width: 1000, height: 500 },
      { width: 500, height: 250 }
    )!;
    expect(r).toEqual({ left: 50, top: 25, width: 100, height: 20 });
  });

  it("文档还没量到尺寸时回 null——不画高亮，而不是画个 0×0 的框", () => {
    expect(
      frameRectToNodeRect(
        { left: 0, top: 0, width: 10, height: 10 },
        { width: 0, height: 0 },
        { width: 100, height: 100 }
      )
    ).toBeNull();
  });
});

describe("元素编辑作用在源 HTML 上", () => {
  it("改文字", () => {
    const r = applyElementOp(PAGE, pathTo("h1"), {
      kind: "text",
      value: "新标题",
    });
    expect(r.ok).toBe(true);
    expect(r.html).toContain("<h1>新标题</h1>");
    expect(r.html).not.toContain("标题</h1>标题");
  });

  it("改文字只动文字，不许塞标签进去（这份内容会直接落库）", () => {
    const r = applyElementOp(PAGE, pathTo("h1"), {
      kind: "text",
      value: "<img src=x onerror=alert(1)>",
    });
    expect(r.ok).toBe(true);
    /*
     * ⚠ 第一版写的是 `not.toContain("onerror")` —— **判据本身错了**：
     *   textContent 转义之后 "onerror" 这串字符当然还在（它现在是**文字**
     *   不是属性）。要钉的语义是"没有真的生成元素"，所以解析回 DOM 来判。
     */
    const doc = new DOMParser().parseFromString(r.html, "text/html");
    const h1 = doc.querySelector("h1")!;
    expect(h1.querySelector("img")).toBeNull();
    expect(h1.children.length).toBe(0);
    expect(h1.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("一次 style op 可以带多条声明", () => {
    const r = applyElementOp(PAGE, pathTo("p"), {
      kind: "style",
      decls: {
        "font-size": "20px",
        "font-weight": "700",
        color: "#ff0000",
        "border-radius": "8px",
      },
    });
    expect(r.ok).toBe(true);
    expect(r.html).toMatch(/font-size:\s*20px/);
    expect(r.html).toMatch(/font-weight:\s*700/);
    expect(r.html).toMatch(/color:\s*(#ff0000|rgb\(255, 0, 0\))/);
    expect(r.html).toMatch(/border-radius:\s*8px/);
  });

  it("空值 = 清掉这条声明，不是写个默认值盖上去", () => {
    /*
     * ⚠ 写 `font-weight: 400` 去盖住粗体是错的：那不是"恢复默认"，是又压了
     *   一层——元素原本从样式表拿到的值（比如 h1 的 700）会被这一层永久钉死。
     */
    let html = applyElementOp(PAGE, pathTo("p"), {
      kind: "style",
      decls: { "font-weight": "700" },
    }).html;
    html = applyElementOp(html, pathTo("p", html), {
      kind: "style",
      decls: { "font-weight": "" },
    }).html;
    expect(html).not.toMatch(/font-weight/);
  });

  it("非法值设不进去（CSSOM 自己挡，不用另写正则）", () => {
    const r = applyElementOp(PAGE, pathTo("p"), {
      kind: "style",
      decls: { color: "red; } body { display: none" },
    });
    expect(r.ok).toBe(true);
    expect(r.html).not.toContain("display: none");
    expect(r.html).not.toContain("body {");
  });

  it("删除元素", () => {
    const r = applyElementOp(PAGE, pathTo("p"), { kind: "remove" });
    expect(r.ok).toBe(true);
    expect(r.html).not.toContain("正文");
    expect(r.html).toContain("标题");
  });

  it("找不到元素 → ok:false 且原样返回（不许悄悄当成功）", () => {
    const bogus = [{ tag: "div", index: 9 }];
    const r = applyElementOp(PAGE, bogus, { kind: "text", value: "x" });
    expect(r.ok).toBe(false);
    expect(r.html).toBe(PAGE);
  });

  it("空路径 / 空 HTML 都判失败", () => {
    expect(applyElementOp(PAGE, [], { kind: "remove" }).ok).toBe(false);
    expect(applyElementOp("", pathTo("h1"), { kind: "remove" }).ok).toBe(false);
  });

  it("doctype 要保住——丢了浏览器进 quirks mode，整页布局走样", () => {
    const r = applyElementOp(PAGE, pathTo("h1"), { kind: "text", value: "x" });
    expect(r.html.toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("字号夹在上下限内", () => {
    expect(clampFontPx(2)).toBe(MIN_FONT_PX);
    expect(clampFontPx(999)).toBe(MAX_FONT_PX);
    expect(clampFontPx(17.6)).toBe(18);
  });
});

/**
 * 「顺手带走了东西」这条回执不许自己消失。
 *
 * ⚠ 2026-09-05：画布的提示条 2.6 秒自动消失——对「已连上」「PNG 已导出」
 *   这类回执是对的，对那条**要人去做点什么**的话不是：它说的是
 *   「你这一存把页面脚本 / 数据孔 / 表单控件弄少了，撤销后重存」。
 *   闪一下就没，等于没说过。真机那次（点选编辑把交付页的 Tailwind 摘掉）
 *   能被抓到靠的是服务端日志，不是屏幕。
 *
 * 判据钉在源码上：这条分支散在 effect 和渲染两处，单渲染一处证明不了另一处。
 * 剥注释再匹配——本仓踩过"判据 grep 的词同时出现在注释里，删了实现照样绿"。
 */
describe("带走了东西的回执要留在屏幕上", () => {
  const code = () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    return (
      fs.readFileSync(
        path.resolve(__dirname, "../SpecPageCanvasStage.tsx"),
        "utf8"
      ) as string
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  };

  it("自动消失的计时器对这一条不生效", () => {
    const src = code();
    expect(src).toMatch(/toastIsLoss/);
    // effect 里必须有"是这条就别起计时器"的早退
    expect(src).toMatch(/if\s*\(!toast\s*\|\|\s*toastIsLoss\)\s*return;/);
  });

  it("屏幕上给得出关掉它的办法（不许只能等）", () => {
    expect(code()).toContain("sliderule-canvas-toast-dismiss");
  });

  it("反向配对：普通回执还得自己消失", () => {
    // 全都不消失的话，画布上会堆一排「已连上」——那是另一种坏。
    const src = code();
    expect(src).toMatch(/setTimeout\(\(\)\s*=>\s*setToast\(null\),\s*2600\)/);
  });

  it("判的是语义不是某个域名/字面", () => {
    // 「顺手带走了」这句由后端 losses_message 出，前端只认它这半句。
    expect(code()).toContain('toast.includes("顺手带走了")');
  });
});
