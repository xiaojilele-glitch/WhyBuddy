// @vitest-environment jsdom
/**
 * 宿主安全层：消毒 + 影子根。
 *
 * 这组测试分两半，分别对应这一层要治的两件事——**它们不是一件事**：
 *   可执行内容（script / on* / javascript:）→ DOMPurify
 *   样式外溢                                 → Shadow DOM（**不是安全边界**）
 *
 * 第三半是这一层最容易静默出错的地方：`ALLOW_DATA_ATTR: false` 之下，
 * 漏列一个绑定属性 = 那个能力整条无声消失（页面照常渲染、消毒器照常成功、
 * 解释器 problems 也是空的）。所以有一条测试直接拿解释器的词表去比。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

import { sanitizeBoundHtml } from "../bound-html-surface";
import { BINDING_ATTRS } from "../html-binding-runtime";

describe("挡执行面", () => {
  it("script 整个摘掉", () => {
    const out = sanitizeBoundHtml('<div>正文<script>alert(1)</script></div>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("正文");
  });

  it("on* 事件属性摘掉，元素留下", () => {
    const out = sanitizeBoundHtml('<button onclick="alert(1)">点我</button>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("点我");
  });

  it("javascript: 伪协议摘掉", () => {
    const out = sanitizeBoundHtml('<a href="javascript:alert(1)">链接</a>');
    expect(out).not.toContain("javascript:");
  });

  it("链接上的 data: 摘掉 —— 点下去等于导航到一份自带内容的文档", () => {
    const out = sanitizeBoundHtml('<a href="data:text/html,<h1>x</h1>">链接</a>');
    expect(out).not.toMatch(/href=["']\s*data:/i);
  });

  it("iframe / object / embed / base 一律不留", () => {
    for (const tag of ["iframe", "object", "embed", "base"]) {
      expect(sanitizeBoundHtml(`<${tag} src="x"></${tag}>`)).not.toContain(`<${tag}`);
    }
  });

  it("img 的 onerror 摘掉但 img 本身留着", () => {
    const out = sanitizeBoundHtml('<img src="https://x/a.png" onerror="alert(1)" alt="图">');
    expect(out).not.toContain("onerror");
    expect(out).toContain("<img");
  });
});

describe("放行页面真正需要的东西", () => {
  it("表单控件必须活着 —— 不然整页只剩文字", () => {
    // 「能读能写」正是这条链路存在的理由。控件不是执行面（on* 由 DOMPurify 摘）。
    const html = '<form><label for="a">名</label><input id="a" name="n" placeholder="请输入">'
      + '<select name="s"><option value="1">甲</option></select>'
      + '<textarea rows="3"></textarea><button type="submit">保存</button></form>';
    const out = sanitizeBoundHtml(html);
    for (const want of ["<input", "<select", "<option", "<textarea", "<button",
                        'name="n"', 'placeholder="请输入"', 'value="1"']) {
      expect(out).toContain(want);
    }
  });

  it("内联 SVG 的几何属性活着 —— viewBox / d 被删掉图标就成空壳", () => {
    const out = sanitizeBoundHtml(
      '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="#333"/></svg>');
    expect(out).toContain("viewBox");
    expect(out).toContain('d="M0 0h24v24H0z"');
  });

  it("https 图片放行", () => {
    expect(sanitizeBoundHtml('<img src="https://x/a.png">')).toContain("https://x/a.png");
  });
});

describe("绑定词汇一个都不能漏", () => {
  /**
   * ⚠ 这条是这一层最容易静默出错的地方。`ALLOW_DATA_ATTR: false` 之下，
   * 没列进白名单的 data-* 会被**悄悄删掉**——页面照常渲染、消毒器照常报成功、
   * 解释器 problems 也是空的（没有孔就没有错误的孔）。那个能力整条无声消失。
   *
   * 本仓数到第九次的形状，而它最常见的成因就是"同一份清单抄了两遍"。
   * 所以词表只有 BINDING_ATTRS 一份，这里拿它逐个过消毒。
   */
  it.each(BINDING_ATTRS)("%s 消毒后还在", (attr) => {
    const out = sanitizeBoundHtml(`<div ${attr}="x">格</div>`);
    expect(out).toContain(attr);
  });

  it("没列进白名单的 data-* 会被删 —— 所以词表必须单一来源", () => {
    // 这条不是"要求删"，是**证明删这件事真的会发生**，从而说明漏列的代价
    const out = sanitizeBoundHtml('<div data-随便编一个="x">格</div>');
    expect(out).not.toContain("data-随便编一个");
  });

  it("一整份打过孔的表格消毒后结构完整", () => {
    const html = `<table>
      <thead data-head="vehicle"><tr><th data-col>列</th></tr></thead>
      <tbody data-rows="vehicle" data-sort="mileage" data-order="desc" data-limit="5">
        <tr><td data-cell>格</td><td><button data-action="editRecord" data-entity="vehicle">改</button></td></tr>
      </tbody></table>
      <span data-value="vehicle" data-aggregate="count"></span>
      <div data-chart="bar" data-entity="vehicle" data-dimension="brand" data-metric="count"></div>`;
    const out = sanitizeBoundHtml(html);
    for (const want of ['data-head="vehicle"', "data-col", 'data-rows="vehicle"',
                        'data-sort="mileage"', 'data-order="desc"', 'data-limit="5"',
                        "data-cell", 'data-action="editRecord"', 'data-entity="vehicle"',
                        'data-value="vehicle"', 'data-aggregate="count"',
                        'data-chart="bar"', 'data-dimension="brand"']) {
      expect(out).toContain(want);
    }
  });
});

describe("fail-closed", () => {
  it("空输入不炸", () => {
    expect(sanitizeBoundHtml("")).toBe("");
  });

  it("消毒不了就返回空串，不是原样放行", () => {
    /**
     * DOMPurify 在没有 window 的环境里导出的是工厂函数，`.sanitize` 压根不存在。
     * 那时"原样返回"等于把不可信 HTML 直接放行——宁可这一块空着，也不能漏一次。
     * 判据钉在源码上：这条线断了不会有任何用例变红（测试里 window 一直在）。
     */
    const src = sanitizeBoundHtml.toString();
    expect(src).toContain('typeof purify.sanitize !== "function"');
    expect(src).toContain('return ""');
  });
});

describe("两件事别混：Shadow DOM 不是安全边界", () => {
  it("挂载走 closed 影子根，且先消毒再挂", () => {
    /**
     * 顺序反了等于把不可信 HTML 先塞进文档再补救——那一瞬间的副作用
     * （比如 <img onerror>）已经发生了。判据只能钉在源码顺序上。
     */
    // ⚠ 不用 import.meta.url 定位：jsdom 环境下它不是 file: 协议，
    //   readFileSync 会抛「The URL must be of scheme file」。从 cwd 拼绝对路径。
    // ⚠ cwd 可能是仓根也可能是 client/（vitest 的 root 是 client，
    //   而 process.cwd() 是仓根），两个候选都试一遍，别赌其中一个。
    const rel = "src/pages/sliderule/live-runtime/bound-html-surface.tsx";
    const found = [`client/${rel}`, rel]
      .map((c) => resolve(process.cwd(), c))
      .find((c) => existsSync(c));
    expect(found).toBeTruthy();
    const src = readFileSync(found as string, "utf8");
    expect(src).toContain('attachShadow({ mode: "closed" })');
    expect(src.indexOf("sanitizeBoundHtml(html)")).toBeLessThan(src.indexOf("applyBindings("));
    // 文件头必须写明分工，免得后人以为影子根管安全
    expect(src).toContain("Shadow DOM **不是**安全边界");
  });
});

/**
 * `data-shell` 必须活着穿过消毒（2026-08-22）。
 *
 * ⚠ 这条链上有**两份**白名单（本文件测 bound-html-surface，另一条在
 * html-app-surface）。新增 data-* 漏进任何一份都会被**静默剥掉**——
 * 不报错、不告警，只是下游选择器再也选不中壳。`data-page-id` 当年就是
 * 这么丢的：菜单还在，点了没反应。
 */
describe("data-shell 穿过消毒", () => {
  it("壳节点上的 data-shell 不许被剥", () => {
    const out = sanitizeBoundHtml(
      '<aside data-shell="aside"><nav>菜单</nav></aside>' +
        '<header data-shell="header">顶</header>' +
        '<main data-shell="main">正文</main>' +
        '<nav data-shell="nav">底</nav>',
    );
    for (const v of ["aside", "header", "main", "nav"]) {
      expect(out, `data-shell="${v}" 被剥掉了`).toContain(`data-shell="${v}"`);
    }
  });

  it("反向：没在白名单里的 data-* 仍然该被剥（消毒还在干活）", () => {
    // 判据自己得能证明「不是所有 data-* 都放行」，否则上一条恒真。
    expect(sanitizeBoundHtml('<div data-not-allowed="x">正文</div>')).not.toContain(
      "data-not-allowed",
    );
  });
});

/**
 * `data-block` / `data-block-kind` 必须活着穿过消毒（2026-08-27）。
 *
 * 跟 `data-shell` 同一口井：**两份**白名单，漏进任何一份都是静默剥掉。
 * 剥掉之后画布上一块都认不出来，而 HTML 看着完全正常——不报错、不告警。
 */
describe("data-block 穿过消毒", () => {
  it("块标与块类型都不许被剥", () => {
    const out = sanitizeBoundHtml(
      '<main data-shell="main">' +
        '<div data-block="待指派工单" data-block-kind="table"><table></table></div>' +
        "</main>",
    );
    expect(out, "data-block 被剥掉了").toContain('data-block="待指派工单"');
    expect(out, "data-block-kind 被剥掉了").toContain('data-block-kind="table"');
  });

  it("反向：白名单外的块状 data-* 仍然被剥（判据不恒真）", () => {
    expect(sanitizeBoundHtml('<div data-block-secret="x">正文</div>')).not.toContain(
      "data-block-secret",
    );
  });
});
