// @vitest-environment jsdom
/**
 * 卡片菜单不许长在会裁剪的盒子里（2026-08-24 用户截图报的）。
 *
 * ## 现场
 *
 * 「我的应用」墙上点卡片右上角的「…」，弹出四条：复刻 / 设为私有 / 移交官方 /
 * 删除应用。真机看到的是**最后一条被齐齐切掉半行**——红字「删除应用」只露出
 * 上半截，正好切在封面图的下沿。
 *
 * ## 病灶
 *
 * 菜单（CenterCard 的 `topRight`）当时挂在**画面 div 里面**，而画面为了把截图
 * 裁进圆角带着 `overflow-hidden`：
 *
 *     <div class="relative ... overflow-hidden rounded-[10px]">   ← 裁剪在这
 *       <div class="absolute inset-0 overflow-hidden">{media}</div>
 *       {topRight}                                                ← 菜单在里面
 *     </div>
 *
 * 四条菜单 ~124px，从 `top-8`(32px) 铺下去越过画面下沿，被裁掉。菜单本身、
 * z-index、层叠顺序**全是对的**——错的只是它长在一个会裁剪的祖先里。
 *
 * ## 为什么判据写成"祖先里有没有 overflow-hidden"
 *
 * 本仓第五条：判据要落在用户真正看到的东西上，别量源码。jsdom 不做布局，量不
 * 出"切掉了几像素"；但**裁剪的机制**就是这条祖先链——只要菜单还挂在
 * overflow-hidden 底下，超出的部分就一定被切。所以量 DOM 祖先链，不 grep
 * className 字面量（那种判据把 `relative` 一加就变红，改个类名又照样绿）。
 *
 * 变异验证（写完必做，本仓第二条）：把 `{topRight}` 挪回画面 div 里，
 * 「菜单不在任何会裁剪的祖先里」立刻变红。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CenterCard } from "../AppsWorkbench";

/** 把卡片壳渲染进一个真的 DOM，好按祖先链提问。 */
function mountCard() {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <CenterCard
      testid="card-1"
      title="做一个健身训练打卡小程序"
      media={<div data-testid="cover" />}
      metrics={<span>页面 4</span>}
      statusDot="bg-emerald-500"
      statusLabel="已闭环"
      mediaHeight={165}
      onClick={() => {}}
      topRight={
        <>
          <button data-testid="menu-trigger">…</button>
          <div data-testid="menu-popup" className="absolute right-2 top-8 z-10">
            <button>复刻到我的应用</button>
            <button>设为私有</button>
            <button>移交到官方应用</button>
            <button>删除应用</button>
          </div>
        </>
      }
    />
  );
  return host;
}

/** 从节点往上找第一个会裁剪内容的祖先。null = 一路到根都不裁。 */
function clippingAncestor(node: Element | null): Element | null {
  let cur = node?.parentElement ?? null;
  while (cur) {
    if (cur.classList.contains("overflow-hidden")) return cur;
    cur = cur.parentElement;
  }
  return null;
}

describe("卡片菜单与画面的裁剪边界", () => {
  const host = mountCard();
  const popup = host.querySelector('[data-testid="menu-popup"]');
  const trigger = host.querySelector('[data-testid="menu-trigger"]');

  it("正向：菜单确实渲染在卡片里（没被顺手删掉）", () => {
    expect(popup).toBeTruthy();
    expect(trigger).toBeTruthy();
    expect(popup!.textContent).toContain("删除应用");
  });

  it("★ 菜单不在任何会裁剪的祖先里 —— 这条就是那半行被切的病灶", () => {
    expect(clippingAncestor(popup)).toBeNull();
    // 触发按钮同理：它 absolute 定位的参照必须跟菜单是同一层，
    // 只挪走菜单会让「…」和弹层错位。
    expect(clippingAncestor(trigger)).toBeNull();
  });

  it("★ 反向：画面**仍然**裁剪 —— 别把圆角裁剪整个删掉来「修好」它", () => {
    // 另一种"修好了"的错法：给画面去掉 overflow-hidden。菜单是不切了，
    // 截图也会从圆角里溢出来，整墙的卡变回直角硬边。
    const cover = host.querySelector('[data-testid="cover"]');
    expect(clippingAncestor(cover)).toBeTruthy();
  });

  it("菜单的定位参照是卡片壳（壳丢了 relative，弹层会飘到页面角上）", () => {
    const shell = host.querySelector('[data-testid="card-1"]')!;
    expect(shell.className).toContain("relative");
    // 壳与菜单之间不许再插一层 positioned 容器——那样 right-2/top-2 就不是
    // 对着卡片右上角算了。
    expect(popup!.parentElement).toBe(shell);
  });
});
