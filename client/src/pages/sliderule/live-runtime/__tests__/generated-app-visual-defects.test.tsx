import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 线上产物截图上一眼可见的四处毛病（2026-08-11）。
 *
 * 用户把生成好的「邻里团长 / 邻里团享」跑起来截了三张图，四个问题各自独立、
 * 但都属于"用户第一眼就看见"那一档。这个文件把四条判据钉在一起，
 * 因为它们共享同一个来源（那三张截图），改动任何一条都该回来读这段。
 *
 * ## ① 首页重叠 —— 唯一的真 bug
 *
 * 三张图上都是：KPI 卡互相叠、环图压住下面的折线图、标题被盖掉一半、
 * 两个大数字浮在卡片上。数一下那份设计树就清楚了：
 *
 *     写死 height 的节点 17 个（136px / 260px / 200px / 40px …）
 *     用 minHeight 的      1 个
 *     用 overflow 的       0 个
 *
 * 设计 LLM **没渲染过，不知道内容实际多高**，只能照版式直觉写个数；内容更高
 * 就溢出，没有 overflow 就不裁剪，直接盖在下一块上。
 *
 * 修法：渲染端把 `height` 当 `minHeight`，且**不写 height**——两个都写的话
 * 盒子仍被钉死，min-height 只是下限，管不住"内容比 height 高"。
 *
 * ⚠ 这是渲染端兜底，不是设计端修复。真解是给设计侧高度预算（架构图缺口里记着）。
 *
 * ## ② 一页两个"新建" ③ 同字段两种格式 ④ 侧栏徽标全是 12
 *
 * 逐条理由写在被测代码的注释里，这里只钉结果。三条的共同点是
 * **同一件事在两处各说各的**——今天已经栽过很多次的那个形状。
 */

// ⚠ fileURLToPath 而不是 .pathname：URL.pathname 在 Windows 上是 "/C:/…"，
//   丢给 fs 会被拼成 "C:\C:\…"，整个文件在 Windows 机器上必红。
const SRC = fileURLToPath(new URL("..", import.meta.url));
const registry = readFileSync(`${SRC}block-registry.tsx`, "utf8");
const screen = readFileSync(`${SRC}AppRuntimeScreen.tsx`, "utf8");

describe("线上产物截图上的四处毛病", () => {
  it("① 设计模型的 height 当 minHeight 用，且不再写死 height", () => {
    const i = registry.indexOf('if (k === "height")');
    expect(i, "height 的特判没了 —— 首页重叠会立刻复发").toBeGreaterThan(-1);
    const block = registry.slice(i, i + 2000);
    expect(block, "没把 height 转成 minHeight").toContain("out.minHeight = v");
    // 关键的一半：转完必须 continue，不能再把 height 写进去
    expect(block.slice(0, block.indexOf("}"))).toContain("continue");
  });

  it("① 判据是转换不是丢弃 —— 丢掉高度会让版面塌成一团", () => {
    const i = registry.indexOf('if (k === "height")');
    const block = registry.slice(i, i + 2000);
    expect(
      block,
      "看着像是直接把 height 丢了。那个数字不是垃圾：对齐、留白、视觉节奏都靠它"
    ).toContain("minHeight");
  });

  it("② 绑本页主实体的 RecordFormDialog 要摘掉 —— 一页不许两个新建入口", () => {
    const i = screen.indexOf('b.type === "RecordFormDialog"');
    expect(i, "重复新建入口的去重没了").toBeGreaterThan(-1);
    const block = screen.slice(i - 200, i + 400);
    // 只摘绑主实体的；绑别的实体是真新增内容
    expect(block, "没比对主实体，会把有用的弹层表单也摘掉").toContain("page.entityId");
    // 脚手架那个按钮不出现时（无权限），它就是唯一入口，不能摘
    expect(block, "没看脚手架按钮在不在，无权限时会把唯一入口也摘了").toContain("canCreate");
  });

  it("③ 字段的 format 声明必须被区块表格读到 —— 不许按名字猜", () => {
    const i = registry.indexOf("function fieldSemantic(");
    const block = registry.slice(i, i + 3000);
    expect(block, "fieldSemantic 还是读不到 schema，percent 会继续丢").toContain("fieldSchemaOf");
    expect(block, "没走共用的档位表").toContain("resolveValueType");
    // 声明优先：拿得到 schema 就读，拿不到才落回老判据
    expect(
      block.indexOf("resolveValueType"),
      "按名字猜（MONEY_HINT）排在读声明前面 —— 有声明还去猜，是把确定的事实换成启发式"
    ).toBeLessThan(block.indexOf("MONEY_HINT"));
  });

  it("③ renderCell 认得 percent / score / progress 三档", () => {
    for (const semantic of ["percent", "score", "progress"]) {
      expect(registry, `renderCell 少了 ${semantic} 档`).toContain(`case "${semantic}": {`);
    }
    expect(registry, "百分比没带单位").toMatch(/\$\{n\}%/);
  });

  it("④ 侧栏徽标只数真实数据，演示种子不计", () => {
    const i = screen.indexOf("const rowCount = (() => {");
    expect(i, "侧栏计数没了").toBeGreaterThan(-1);
    const block = screen.slice(i, i + 500);
    expect(
      block,
      "还在数总行数 —— 种子给每个实体铺一样多，六个菜单项会全是同一个数字"
    ).toContain("seedRowCount");
    expect(block, "减完没兜住负数").toContain("Math.max(0");
  });
});
