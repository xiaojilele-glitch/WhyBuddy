/**
 * 刀 1 **真的接在通电的那条链路上**吗（2026-08-27）。
 *
 * `block-rects.test.ts` 那 13 条全绿，但把 ArtboardNode 里的挂载点整段删掉
 * **照样全绿**——它们只直接调纯函数，从没验证过它接在链路上。这正是
 * CLAUDE.md 第三条点名的那种形态（"11 条测试全绿，但把调用点删掉照样全绿"）。
 *
 * 这个文件补的就是缺的那一半。
 *
 * ## ⚠ 判据必须先剥注释
 *
 * 本仓踩过：判据 grep 源码里的标识符，而那个词**同时出现在文档字符串里**，
 * 变异后照样绿。这份实现里 `useBlockRects`、`onReport`、`BlockSpot`
 * 在中文注释里出现得比在代码里还多，不剥注释这些判据一条都不作数。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** 剥掉块注释与行注释再查。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function read(rel: string): string {
  return stripComments(readFileSync(resolve(__dirname, rel), "utf8"));
}

const STAGE = read("../SpecPageCanvasStage.tsx");
const HOOK = read("../use-block-rects.ts");
const PURE = read("../block-rects.ts");

describe("量测真的挂在画板上（不是只写了个 hook）", () => {
  it("ArtboardNode 里**调用**了 useBlockRects，不只是 import", () => {
    // ⚠ 查调用点，不查 import。只 import 不调用是本仓最经典的
    //   "装在不通电的插座上"。
    expect(STAGE).toContain("useBlockRects(");
    // 反向：调用的结果得真的被用上，不能算完就扔
    expect(STAGE).toMatch(/blocks\s*=\s*useBlockRects\(/);
  });

  it("HtmlAppSurface 的 onReport 接的就是量测回调", () => {
    // 这条是整刀的命脉：接错时机 = 表格块量在绑定之前 = 框只有几分之一，
    // 不报错、不告警。
    expect(STAGE).toContain("onReport={blocks.onSurfaceReport}");
  });

  it("块框有 JSX 挂载点，且用的是量出来的快照", () => {
    expect(STAGE).toContain("<BlockSpot");
    expect(STAGE).toContain("blocks.snapshot.rects.map");
  });

  it("量测的 enabled 跟着画板的挂载态走", () => {
    // 没进过视口的画板里根本没有 iframe。传 true 会给它白装一个
    // ResizeObserver，六页就是六个。
    expect(STAGE).toMatch(/useBlockRects\([^)]*mounted[^)]*\)/s);
  });
});

describe("反向判据", () => {
  it("量测**不**挂在 onLoad / onNavigate 上（那些时机在填数之前）", () => {
    // 变异：把 onReport 换成 onLoad，这条红。
    expect(STAGE).not.toContain("onLoad={blocks.onSurfaceReport}");
    expect(STAGE).not.toContain("onNavigate={blocks.onSurfaceReport}");
  });

  it("纯函数侧不自己筛块——认块的规则只有 page-blocks 一处", () => {
    // CLAUDE.md 第四条：同一件事两处实现必然分叉，而且不报错。
    expect(PURE).toContain("listBlockElements");
    expect(PURE).not.toContain("querySelectorAll");
  });

  it("坐标换算复用 frameRectToNodeRect，不另写一套比例", () => {
    // canvas-element-edit 头注里记着真机上"缩两次"那笔账（14×5 画成 4×1）。
    // 另写一套等于把那个坑重挖一遍。
    expect(PURE).toContain("frameRectToNodeRect");
  });

  it("hook 侧 fail-open：取不到 iframe / 跨源一律 return，不抛", () => {
    // 纪律七：块矩形是增强，炸了只该少一层框，不许拖垮画板。
    expect(HOOK).toContain("catch");
    expect(HOOK).not.toContain("throw new");
  });

  it("ResizeObserver / MutationObserver 缺席时不炸（老环境 / jsdom）", () => {
    expect(HOOK).toContain('typeof ResizeObserver !== "undefined"');
    expect(HOOK).toContain('typeof MutationObserver !== "undefined"');
  });
});

describe("⚠ 2026-08-27 真机抓出来的三个坑，各钉一条", () => {
  /*
   * 这三条都是"单测全绿而画布上一个块框都没有"的形态，且都只在**第一块
   * 画板**上发作（另外四块正常）——这正是本仓最贵的那类 bug。
   * 修完必须留判据，否则下一次重构会原样退回去。
   */

  it("坑一：量测不只挂宿主的 onReport（它是一次性的，可能发在布局之前）", () => {
    // html-app-surface 里 `wired` 闭包标志成功一次就不再响应后续 load。
    // 只靠 onReport 的话，抢跑那一块永远停在空快照。
    expect(HOOK).toContain('addEventListener("load"');
  });

  it("坑二：接不上要有界重试（子 effect 先于父跑，那次 load 已经错过了）", () => {
    // React 的 effect 是子先于父。HtmlAppSurface 早就赋完 srcdoc 了，
    // 父组件这时候挂监听等不到那一发；一 return 就再没有第二次机会。
    expect(HOOK).toContain("tryAttach");
    // 反向：重试必须**有界**，不许无限空转
    expect(HOOK).toMatch(/tries\s*>\s*\d+/);
  });

  it("坑三：判「接上了」的条件是 body **有内容**，不是 body 存在", () => {
    // about:blank 的空 body 也是 body。挂上去之后文档被整体替换，
    // 观察的那棵树成了孤儿，applyBindings 克隆多少行都不会回调。
    expect(HOOK).toContain("doc?.body?.childNodes.length");
    // 反向：不许退回"只判 body 在不在"
    expect(HOOK).not.toMatch(/if\s*\(\s*!doc\?\.body\s*\)\s*return false/);
  });

  it("坑四（同源）：采纳用 shouldAdoptSnapshot，不是 isBlockRectsStale", () => {
    // 世代号该决定"要不要去量"，不该决定"量完了要不要采纳"。
    // 用错的话，同一世代号下第二次量到的正确结果会被丢掉。
    expect(HOOK).toContain("shouldAdoptSnapshot(prev, next)");
    expect(HOOK).not.toContain("isBlockRectsStale(prev,");
  });
});
