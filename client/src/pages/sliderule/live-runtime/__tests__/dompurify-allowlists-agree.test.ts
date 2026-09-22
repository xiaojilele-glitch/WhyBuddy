/**
 * 两份 DOMPurify 白名单必须认同一套「宿主要用的 data-*」。
 *
 * ## 这条挡的是什么
 *
 * 消毒走 `ALLOW_DATA_ATTR: false` + 显式白名单——**没列进去的 data-* 会被
 * 静默删掉**，而删掉之后页面照常渲染、消毒器照常报成功、解释器 problems 也是
 * 空的（没有孔就没有错误的孔）。那个能力整条无声消失。
 *
 * 仓里这句话被写过三遍（`data-page-id`、`data-shell`、`BLOCK_ATTRS` 各一次
 * 「⚠ 两份白名单必须同改」），但**从来没有判据钉着**——全靠下一个人记得。
 *
 * ## 2026-08-28 查菜单点不动时逮到的现场
 *
 * `bound-html-surface` 那份**一直漏着 `data-page-id`**。今天没炸只是因为它
 * 当前零引用（真正在跑的是 `html-app-surface`，见 SpecPageLiveStage /
 * SpecPageCanvasStage 的 import）。
 *
 * ⚠ 这正是纪律一那个坑的另一面：我排查菜单时先在这份漏词的白名单上找到了
 *   "凶手"，差点改在不通电的插座上。查了 import 才发现它没通电。
 *   下一个人未必会查——所以把两份钉在一起，谁接上去都不会漏。
 *
 * ## 判据只比「宿主要用的那些」，不比全部
 *
 * 两份的 SVG / 表单属性本来就有细微差别（一份跑在 iframe、一份跑在 Shadow
 * DOM，各自的历史包袱不同），逐字对齐是把两个模块焊死。真正会静默失效的
 * 只有**宿主靠它认东西**的那几类：切页锚点、壳标、块标、绑定孔。
 */

import { describe, expect, it } from "vitest";

import { ALLOWED_ATTR as LIVE_ATTR } from "../html-app-surface";
import { ALLOWED_ATTR as BOUND_ATTR } from "../bound-html-surface";
import { BINDING_ATTRS } from "../html-binding-runtime";
import { BLOCK_ATTRS } from "../page-blocks";

/** 宿主靠它认东西的那几类——漏一个就是一个能力静默消失。 */
const HOST_CRITICAL = [
  // 左侧菜单切页：漏了菜单点不动，且没有任何一处报错
  "data-page-id",
  // 壳节点自报家门：漏了手机底栏永远染不上色
  "data-shell",
  // 深浅锁：漏了对比层 html[data-theme="light"] 一条都不命中
  "data-theme",
  // 块身份：漏了画布一块都认不出，HTML 看着还正常
  ...BLOCK_ATTRS,
  // 绑定孔：漏了填不上数
  ...BINDING_ATTRS,
];

describe("两份消毒白名单认同一套宿主词汇", () => {
  it("html-app-surface（在跑的那份）一个都不缺", () => {
    const missing = HOST_CRITICAL.filter(a => !LIVE_ATTR.includes(a));
    expect(missing).toEqual([]);
  });

  it("bound-html-surface（当前零引用）也一个都不缺", () => {
    /**
     * ⚠ 它现在没通电，所以漏词不会有任何症状——正因如此才要钉。
     *   谁哪天把它接上去，菜单/块标/填数会被静默剥掉。
     */
    const missing = HOST_CRITICAL.filter(a => !BOUND_ATTR.includes(a));
    expect(missing).toEqual([]);
  });

  it("两份对宿主词汇的口径完全一致（谁多谁少都算漂）", () => {
    const live = HOST_CRITICAL.filter(a => LIVE_ATTR.includes(a));
    const bound = HOST_CRITICAL.filter(a => BOUND_ATTR.includes(a));
    expect(bound).toEqual(live);
  });

  it("显式白名单模式没被改成放行任意 data-*（反向判据）", () => {
    /**
     * ⚠ 「让判据变绿」最省事的改法是 `ALLOW_DATA_ATTR: true`——那会让生成侧
     *   写什么 data-* 都进来，白名单形同虚设。所以正面钉住这个开关。
     */
    const both = [
      new URL("../html-app-surface.tsx", import.meta.url),
      new URL("../bound-html-surface.tsx", import.meta.url),
    ];
    return Promise.all(
      both.map(async url => {
        const src = await import("node:fs/promises").then(fs =>
          fs.readFile(url, "utf8")
        );
        const code = src
          .split("\n")
          .filter(l => {
            const t = l.trim();
            return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
          })
          .join("\n");
        expect(code).toContain("ALLOW_DATA_ATTR: false");
        expect(code).not.toContain("ALLOW_DATA_ATTR: true");
      })
    );
  });
});
