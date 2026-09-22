import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_GRID_COLUMNS,
  PAGE_CONTENT_REF,
  regionsToGrid,
  type BusinessGridItem,
  type BusinessRegions,
} from "../business-page-layout";

/**
 * 没人认领的空白：格子不存在，但邻居把行撑开了（2026-08-12）。
 *
 * ## 症状
 *
 * 用户在线上产物「邻里团享 / 团长管理」上圈出主体区左半边一整块纯白。
 * 用真实模型在本地跑一遍、量 DOM 得到的几何是：
 *
 *     business-page-grid   (268, 240) 1296×803
 *       record-detail      (1140,240)  423×260   ← 右栏
 *       data-table         ( 268,513) 1296×530   ← 整行，但从 y=513 才开始
 *                          ↑ 268..1140 × 240..513 = 870×273 什么都没有
 *
 * ## 为什么上一刀没切到
 *
 * 2026-08-11 修过一次"半边空白"，判据是 CSS `:empty`——区块**渲染成空**时
 * 把它的格子收掉。这次的白不是那样来的：那一格根本没进栅格。
 *
 *     regionsToGrid 无条件给 PAGE_CONTENT_REF 留 (0,0,8,3)
 *     辅助区跟着写死 h:3
 *     正文带无条件排在 contentY+3 之后
 *     ——而积木自己有表格时，AppRuntimeScreen 会把 PAGE_CONTENT_REF 整条摘掉
 *
 * 格子没了，三行的高度却由右栏的详情卡撑着。`:empty` 量的是"格子里有没有
 * 东西"，这里连格子都没有，它当然收不掉。**同一片白，两种成因。**
 *
 * ## 判据：一列一旦有东西，就得从第 0 行开始有
 *
 * 不查"每行是不是满的"——**右栏比主体矮是正常版式**（辅助卡说完就停，
 * 下面留白是应该的）。所以尾部的空放过。
 *
 * 查的是**头部和中间的空**：这一列下面明明有内容，上面却空着。空的那段
 * 是被下面的内容反证出来"本该有东西"的，就是用户圈的那种白。
 * 这条生成器里每一行要么整行满、要么内容列 + 右栏拼满 12 格，所以任何
 * 一列只要还有内容，它就该从第 0 行连上。
 */

const EMPTY_REGIONS: BusinessRegions = {
  header: [],
  headerExtra: [],
  headerContent: [],
  tabs: [],
  filters: [],
  metrics: [],
  charts: [],
  main: [],
  supplement: [],
  aside: [],
  footerBar: [],
  overlay: [],
};

/** 找出"下面有内容、上面却空着"的列。返回列号，空数组即无空洞。 */
function columnsWithVerticalGap(items: BusinessGridItem[], columns: number): number[] {
  const maxRow = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  const bad: number[] = [];
  for (let col = 0; col < columns; col++) {
    const occupied: boolean[] = Array.from({ length: maxRow }, () => false);
    for (const item of items) {
      if (col < item.x || col >= item.x + item.w) continue;
      for (let y = item.y; y < item.y + item.h; y++) occupied[y] = true;
    }
    const last = occupied.lastIndexOf(true);
    if (last === -1) continue;
    // 末尾的空放过（右栏比主体矮是正常的）；最后一个占用格之前的空不放过。
    if (occupied.slice(0, last).some(v => !v)) bad.push(col);
  }
  return bad;
}

/** 上游（AppRuntimeScreen 第 2014 行）在没有内置主视图时会把这条摘掉。 */
const withoutPageContent = (items: BusinessGridItem[]) =>
  items.filter(i => i.blockRef !== PAGE_CONTENT_REF);

describe("没人认领的空白", () => {
  const leaderPage = { ...EMPTY_REGIONS, main: ["leader_table"], aside: ["leader_detail"] };

  it("复现用户圈的那一块：积木自带表格 ⇒ 内置主视图被摘 ⇒ 左上角一片白", () => {
    // 修之前：page-content(0,0,8,3) 被摘 → 第 0 列 0-2 行空、第 3 行有表格
    const buggy = withoutPageContent(
      regionsToGrid("workbench", leaderPage, { hasPageContent: true }).desktop
    );
    expect(
      columnsWithVerticalGap(buggy, BUSINESS_GRID_COLUMNS.desktop).length,
      "这条是反向对照 —— 它必须还能复现出空洞，否则下面那条就是空断言"
    ).toBeGreaterThan(0);

    // 修之后：几何知道没有内置主视图，正文带自己占内容列
    const fixed = withoutPageContent(
      regionsToGrid("workbench", leaderPage, { hasPageContent: false }).desktop
    );
    expect(
      columnsWithVerticalGap(fixed, BUSINESS_GRID_COLUMNS.desktop),
      "列上还有竖直空洞 —— 用户看到的就是这片白"
    ).toEqual([]);
  });

  it("表格跟详情并排，不是排在详情下面", () => {
    const items = regionsToGrid("workbench", leaderPage, { hasPageContent: false }).desktop;
    const table = items.find(i => i.blockRef === "leader_table")!;
    const detail = items.find(i => i.blockRef === "leader_detail")!;
    expect(table.y, "表格没顶上内容列的位置").toBe(0);
    expect(detail.y).toBe(0);
    expect(table.x + table.w, "表格没让出右栏，会跟详情叠上").toBe(detail.x);
  });

  it("辅助区跨的行数跟内容列一样高，不再写死 3", () => {
    const items = regionsToGrid("workbench", leaderPage, { hasPageContent: false }).desktop;
    expect(items.find(i => i.blockRef === "leader_detail")!.h).toBe(1);
    // 有内置主视图时仍然是 3（那一格本来就三行高）
    const withContent = regionsToGrid("workbench", leaderPage, { hasPageContent: true }).desktop;
    expect(withContent.find(i => i.blockRef === "leader_detail")!.h).toBe(3);
  });

  it("只剩一个辅助区、什么内容都没有时，右栏摊平走整行", () => {
    const asideOnly = { ...EMPTY_REGIONS, aside: ["tips"] };
    const items = regionsToGrid("workbench", asideOnly, { hasPageContent: false }).desktop;
    const tips = items.find(i => i.blockRef === "tips")!;
    expect(
      { x: tips.x, w: tips.w },
      "还窝在 4/12 的右栏里 —— 左边 8/12 是纯白，没有任何东西会填它"
    ).toEqual({ x: 0, w: BUSINESS_GRID_COLUMNS.desktop });
  });

  it("手机档不再给不存在的主视图留一行", () => {
    const phone = regionsToGrid("workbench", leaderPage, { hasPageContent: false }).phone;
    expect(phone.some(i => i.blockRef === PAGE_CONTENT_REF)).toBe(false);
    expect(phone.map(i => i.y), "行号断档 —— 中间那行是空的").toEqual(
      phone.map((_, i) => i)
    );
  });

  it("**它真的被接上了** —— 上面几条只测函数，测不出有没有人传这个参数", () => {
    const src = readFileSync(new URL("../AppRuntimeScreen.tsx", import.meta.url), "utf8");
    expect(
      src,
      "regionsToGrid 还是不知道内置主视图在不在 —— 函数改对了也没用"
    ).toContain("hasPageContent: pageContent !== undefined");
  });

  it("默认值不变：不传参数时跟老几何逐格相同", () => {
    const before = regionsToGrid("workbench", leaderPage).desktop;
    const same = regionsToGrid("workbench", leaderPage, { hasPageContent: true }).desktop;
    expect(before).toEqual(same);
  });
});
