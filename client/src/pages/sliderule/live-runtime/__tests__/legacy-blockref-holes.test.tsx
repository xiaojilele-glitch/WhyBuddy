import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExperienceBlockBoundary } from "../block-registry";
import type { ExperienceBlockInstance, FreeformNode } from "../block-registry";

/**
 * 存量 blockRef 节点不能在版面上留洞（2026-08-04）。
 *
 * ## 这条防的是一次真实回归
 *
 * blockRef 通道在 rowsRef 上线时被整条删掉——schema、prompt、渲染器三处同步
 * 移除。但**库里已经存着的模型没人管**：那些节点还留在设计树里，带着自己的
 * style（`flex:1` / `width:32%`）却没有任何渲染器认领，于是变成一块**撑着
 * 版面的空白**。
 *
 * 真机长这样（绘本小站首页）：KPI 行右边空掉三分之一、图表行右边又空一块，
 * 分别对应存量树里 children 为空的 QuickActionPanel / WorkflowTimeline /
 * ActivityFeed 三个节点。用户看到的是"排版坏了"，而模型本身是好的。
 *
 * 所以这里钉两件事：
 *   ① 空的 blockRef 节点**整个不渲染**——不是渲染成空 div（那还占位），是连
 *      DOM 节点都不产生；
 *   ② 万一某个节点既挂 blockRef 又带着真实 children，那些 children 是真内容，
 *      不能跟着一起丢。
 */
describe("存量 blockRef 节点", () => {
  function renderTree(root: FreeformNode): string {
    const block: ExperienceBlockInstance = {
      id: "b1",
      type: "FreeformInsight",
      freeformContent: { root: root as unknown as Record<string, unknown> },
    };
    return renderToStaticMarkup(<ExperienceBlockBoundary block={block} entityRows={{}} />);
  }

  it("children 为空 → 整个不渲染，不留占位", () => {
    const out = renderTree({
      tag: "div",
      style: { display: "flex" },
      children: [
        { tag: "span", text: "真内容" },
        // 存量树里那三个的形状：挂 blockRef、无 children、带撑版面的 style
        { tag: "div", style: { flex: "1" }, blockRef: { type: "QuickActionPanel" } },
        {
          tag: "div",
          style: { width: "32%", minWidth: "280px" },
          blockRef: { type: "ActivityFeed" },
        },
      ],
    } as unknown as FreeformNode);
    expect(out).toContain("真内容");
    // 占位的证据就是那两条 style——它们一旦出现在 DOM 里，版面上就是一块空白
    expect(out).not.toContain("32%");
    expect(out).not.toContain("280px");
  });

  it("blockRef 带着真实 children 时，children 必须留下", () => {
    const out = renderTree({
      tag: "div",
      blockRef: { type: "ActivityFeed" },
      children: [{ tag: "span", text: "别把我删了" }],
    } as unknown as FreeformNode);
    expect(out).toContain("别把我删了");
  });

  it("普通节点不受影响——这条改动只针对 blockRef", () => {
    const out = renderTree({
      tag: "div",
      style: { width: "32%" },
      children: [{ tag: "span", text: "正常" }],
    } as unknown as FreeformNode);
    expect(out).toContain("正常");
    expect(out).toContain("32%");
  });
});
