// @vitest-environment jsdom
/**
 * 元素结构路径。正向：同一棵树上找得回来。
 * 反向：**两边 DOM 不一样时必须失败**，不许静默选中别的元素。
 */
import { describe, expect, it } from "vitest";

import {
  decodeElementPath,
  elementPath,
  encodeElementPath,
  resolveElementPath,
} from "../element-path";

function tree(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("元素结构路径", () => {
  it("同一棵树：算出来的路径找得回同一个元素", () => {
    const root = tree(`<section><p>a</p><p><b>x</b><i>y</i></p></section>`);
    const target = root.querySelector("i")!;
    const path = elementPath(target, root)!;
    expect(path).toEqual([
      { tag: "section", index: 0 },
      { tag: "p", index: 1 },
      { tag: "i", index: 1 },
    ]);
    expect(resolveElementPath(root, path)).toBe(target);
  });

  it("只数元素子节点，不数文本节点", () => {
    // ⚠ 两边 iframe 的空白文本节点会因 sanitize/格式化不同而分叉，数进去必错。
    const a = tree(`<div><span>1</span><span>2</span></div>`);
    const b = tree(`<div>\n  <span>1</span>\n  <span>2</span>\n</div>`);
    const path = elementPath(a.querySelectorAll("span")[1]!, a)!;
    expect(resolveElementPath(b, path)?.textContent).toBe("2");
  });

  it("标签对不上就整条判失败——不许就近选一个凑数", () => {
    /*
     * ⚠ 这条是这个模块存在的理由。运行时会往 tbody 里 cloneNode 克隆行/单元格，
     *   画布里的 DOM 比源 HTML 多节点。只记下标的话，下标**恰好存在但是别的
     *   东西**时会静默选中不相干的元素，用户改完保存，改错地方还不知道。
     */
    const bound = tree(
      `<table><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`
    );
    const raw = tree(`<table><tbody><tr><td>1</td></tr></tbody></table>`);
    const path = elementPath(bound.querySelectorAll("td")[1]!, bound)!;
    expect(resolveElementPath(raw, path)).toBeNull();

    // 下标存在、但那一格是别的标签 → 也必须失败
    const other = tree(
      `<table><tbody><tr><td>1</td><th>2</th></tr></tbody></table>`
    );
    expect(resolveElementPath(other, path)).toBeNull();
  });

  it("克隆出来的行在源里不存在 → 定位失败（这类元素本来就没得编辑）", () => {
    // ⚠ 夹具必须是完整 <table>：裸 <tbody> 塞进 div 会被 HTML 解析器整段丢掉，
    //   那样测的就不是"克隆行定位失败"，而是"两棵树都空"。
    const bound = tree(
      `<table><tbody><tr><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td></tr></tbody></table>`
    );
    const raw = tree(`<table><tbody><tr><td>a</td></tr></tbody></table>`);
    const path = elementPath(bound.querySelectorAll("tr")[2]!, bound)!;
    expect(resolveElementPath(raw, path)).toBeNull();
  });

  it("root 本身 / 不在 root 里的元素回 null", () => {
    const root = tree(`<p>x</p>`);
    expect(elementPath(root, root)).toBeNull();
    const outside = document.createElement("span");
    expect(elementPath(outside, root)).toBeNull();
  });

  it("空路径解析不出东西（否则会当成选中了 root）", () => {
    const root = tree(`<p>x</p>`);
    expect(resolveElementPath(root, [])).toBeNull();
  });

  it("序列化能原样转回来", () => {
    const path = [
      { tag: "section", index: 0 },
      { tag: "p", index: 12 },
    ];
    expect(decodeElementPath(encodeElementPath(path))).toEqual(path);
  });

  it("坏字符串解码成空，不炸也不给半条路径", () => {
    expect(decodeElementPath("")).toEqual([]);
    expect(decodeElementPath("p")).toEqual([]);
    expect(decodeElementPath("p:x")).toEqual([]);
    expect(decodeElementPath("p:-1")).toEqual([]);
  });
});
