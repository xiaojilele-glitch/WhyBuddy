import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BusinessPageGrid from "../BusinessPageGrid";

describe("BusinessPageGrid", () => {
  it("renders normalized desktop coordinates through CSS Grid", () => {
    const html = renderToStaticMarkup(
      <BusinessPageGrid
        breakpoint="desktop"
        items={[
          { blockRef: "metrics", x: 0, y: 0, w: 4, h: 1 },
          { blockRef: "page-content", x: 4, y: 0, w: 8, h: 2 },
        ]}
        renderItem={ref => <div>{ref}</div>}
      />
    );

    expect(html).toContain("repeat(12,minmax(0,1fr))");
    expect(html).toContain("grid-column:1 / span 4");
    expect(html).toContain("grid-column:5 / span 8");
    expect(html).toContain('data-layout-ref="page-content"');
  });

  it("skips unrenderable refs without failing the remaining layout", () => {
    const html = renderToStaticMarkup(
      <BusinessPageGrid
        breakpoint="phone"
        items={[
          { blockRef: "missing", x: 0, y: 0, w: 4, h: 1 },
          { blockRef: "feed", x: 0, y: 1, w: 4, h: 1 },
        ]}
        renderItem={ref => (ref === "feed" ? <div>动态</div> : null)}
      />
    );

    expect(html).not.toContain('data-layout-ref="missing"');
    expect(html).toContain('data-layout-ref="feed"');
    expect(html).toContain("动态");
  });

  /**
   * 区块自己渲染成空时，格子要一起收掉（2026-08-11，线上截图那批遗留项）。
   *
   * 上面那条测的是"压根没有区块"——那种 renderItem 直接返回 null，容器看得见。
   * 这一条测的是**区块有、但它渲染成了空**：有 6 个渲染器在没东西可显示时如实
   * `return null`（QuickActionPanel 没有页面动作、ActiveFilterSummary 没有生效
   * 条件、WorkspaceTabs 页签全关掉……）。这时 renderItem 返回的是一个**非空的
   * React 元素**，容器那道 `node === null` 判断看不见，于是留下一个位置写死
   * （gridColumn/gridRow）、里面什么都没有的格子——同一行旁边有高卡片时就是
   * 半边空白。
   *
   * 判据是 CSS `:empty`（Tailwind 的 `empty:` 变体）。这里能验的是**它依赖的
   * 前提**：格子最终真的一个子节点都没有，且带着那个类名。生成的规则
   * `.empty\:hidden:empty{display:none}` 另外用项目自己的 Tailwind 管线编译
   * index.css 核对过一次（v4 自动扫源码，这个类确实在产物里）。
   */
  it("区块渲染成空时格子收掉，而不是占着位置露白", () => {
    const EmptyBlock = () => null;
    const html = renderToStaticMarkup(
      <BusinessPageGrid
        breakpoint="desktop"
        items={[
          { blockRef: "quick-actions", x: 0, y: 0, w: 4, h: 1 },
          { blockRef: "table", x: 4, y: 0, w: 8, h: 2 },
        ]}
        renderItem={ref =>
          ref === "table" ? <div>表格</div> : <EmptyBlock />
        }
      />
    );

    // 空格子仍在 DOM 里（属性没丢，测试/调试还认得出它），但没有任何子节点,
    // 所以 `:empty` 命中、display:none 生效，版面上不留那块白
    const cell = html.match(
      /<div data-layout-ref="quick-actions"[^>]*>(.*?)<\/div>/
    );
    expect(cell, "空区块的格子应当还在 DOM 里").not.toBeNull();
    expect(cell![1], "格子里不能有任何内容，否则 :empty 不会命中").toBe("");
    expect(html).toContain("empty:hidden");

    // 反向：有内容的格子不许被这条规则波及
    expect(html).toContain("表格");
  });
});
