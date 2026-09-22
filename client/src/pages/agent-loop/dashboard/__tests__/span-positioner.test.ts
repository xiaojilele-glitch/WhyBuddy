/**
 * 跨列定位器的几何不变式。
 *
 * 这类布局代码最容易出的不是"算得不好看"，是**偶发重叠**——两张卡在某个高度
 * 组合下叠到一起，肉眼要滚到那一屏才看得见，截图还不一定截得到。所以这里不测
 * "长得对不对"（那是截图的活），只测几条能用数学判定的硬约束：不重叠、不越界、
 * 跨列真的抬起了每一列。
 */

import { describe, it, expect } from "vitest";
import { copyPlacements, createSpanPositioner, bestSpanStart } from "../span-positioner";

const W = 100;
const G = 10;

function make(columnCount: number, getSpan: (i: number) => number) {
  return createSpanPositioner({
    columnCount,
    columnWidth: W,
    columnGutter: G,
    rowGutter: G,
    getSpan,
  });
}

/** 两个矩形是否相交（共边不算）。 */
function overlaps(
  a: { top: number; left: number; width: number; height: number },
  b: { top: number; left: number; width: number; height: number }
) {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

function assertNoOverlap(items: ReturnType<ReturnType<typeof make>["all"]>) {
  const real = items.filter(Boolean);
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      expect(
        overlaps(real[i], real[j]),
        `#${i} ${JSON.stringify(real[i])} 与 #${j} ${JSON.stringify(real[j])} 重叠`
      ).toBe(false);
    }
  }
}

describe("createSpanPositioner", () => {
  it("全单列时与 masonic 原生一致：落最矮列", () => {
    const p = make(3, () => 1);
    p.set(0, 100);
    p.set(1, 50);
    p.set(2, 30);
    // 三列铺满后，第四个应落到最矮的第 2 列（30）
    p.set(3, 10);
    expect(p.get(3)!.column).toBe(2);
    expect(p.get(3)!.top).toBe(30 + G);
    expect(p.get(3)!.width).toBe(W);
  });

  it("跨列卡的宽度含中间的沟槽", () => {
    const p = make(4, i => (i === 0 ? 2 : 1));
    p.set(0, 100);
    expect(p.get(0)!.width).toBe(W * 2 + G);
    expect(p.get(0)!.span).toBe(2);
  });

  it("跨列卡把跨到的每一列都抬到同一高度", () => {
    const p = make(3, i => (i === 0 ? 1 : 2));
    p.set(0, 100); // 落第 0 列
    p.set(1, 40); // 跨 2 列
    const spanItem = p.get(1)!;
    // 跨列后，被跨的两列高度必须一致（否则后续单列卡会插进缝里造成重叠）
    const next = spanItem.top + spanItem.height + G;
    p.set(2, 10);
    p.set(3, 10);
    p.set(4, 10);
    assertNoOverlap(p.all());
    // 被跨的两列此时起点相同
    const tops = [p.get(2)!, p.get(3)!, p.get(4)!].map(x => x.top);
    expect(Math.max(...tops)).toBeGreaterThanOrEqual(next - 1);
  });

  it("首行的跨列卡靠左对齐，不在第一排留洞", () => {
    const p = make(4, i => (i === 0 ? 2 : 1));
    p.set(0, 80);
    expect(p.get(0)!.column).toBe(0);
    expect(p.get(0)!.left).toBe(0);
  });

  it("span 超过列数时钳回列数，不画到容器外", () => {
    const p = make(2, () => 5);
    p.set(0, 50);
    const it = p.get(0)!;
    expect(it.span).toBe(2);
    expect(it.left + it.width).toBe(W * 2 + G);
  });

  it("单列容器上跨列自动退回一列", () => {
    const p = make(1, () => 2);
    p.set(0, 50);
    p.set(1, 50);
    expect(p.get(0)!.span).toBe(1);
    expect(p.get(0)!.width).toBe(W);
    assertNoOverlap(p.all());
  });

  it("混合跨列 + 随机高度：50 个格子无重叠、不越界", () => {
    const columnCount = 5;
    // 确定性伪随机：失败能复现
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const spans = Array.from({ length: 50 }, () => (rand() < 0.25 ? 2 : 1));
    const p = make(columnCount, i => spans[i]);
    for (let i = 0; i < 50; i++) p.set(i, Math.round(100 + rand() * 500));
    assertNoOverlap(p.all());
    const maxRight = W * columnCount + G * (columnCount - 1);
    for (const it of p.all()) {
      expect(it.left).toBeGreaterThanOrEqual(0);
      expect(it.left + it.width).toBeLessThanOrEqual(maxRight);
    }
  });

  it("update 改高之后仍然无重叠（跨列卡改高会横向扩散，这里是全量重排的理由）", () => {
    const p = make(4, i => (i % 4 === 0 ? 2 : 1));
    for (let i = 0; i < 20; i++) p.set(i, 100);
    // 把两张跨列卡和几张单列卡改高
    p.update([0, 400, 4, 30, 7, 250, 12, 90]);
    assertNoOverlap(p.all());
    expect(p.get(0)!.height).toBe(400);
    expect(p.get(4)!.height).toBe(30);
  });

  it("update 之后 size 不变（重排不能丢格子）", () => {
    const p = make(3, i => (i === 1 ? 2 : 1));
    for (let i = 0; i < 9; i++) p.set(i, 100);
    const before = p.size();
    p.update([1, 300]);
    expect(p.size()).toBe(before);
  });

  it("range 只回视口内的格子", () => {
    const p = make(2, () => 1);
    for (let i = 0; i < 10; i++) p.set(i, 100);
    const hit: number[] = [];
    p.range(0, 150, idx => hit.push(idx));
    // 前两行落在 0~150 内，第三行 top=220 不该命中
    expect(hit).toContain(0);
    expect(hit).toContain(1);
    expect(hit).not.toContain(6);
  });

  it("estimateHeight 对未量到的格子按默认高度补", () => {
    const p = make(2, () => 1);
    p.set(0, 100);
    p.set(1, 100);
    // 已量 2 个，总共 6 个 → 还有 4 个 = 2 行 × 默认高
    expect(p.estimateHeight(6, 50)).toBe(110 + 2 * 50);
    expect(p.estimateHeight(2, 50)).toBe(110);
  });
});

describe("bestSpanStart", () => {
  it("先比窗口内总空白，不是先比 top（= gestalt 原版）", () => {
    // 窗口 [0,100]→空白 100、[100,110]→空白 10、[110,20]→空白 90
    // 选 index 1：它最平，跨上去只在矮列留 10px；选 index 0 会留 100px 的洞。
    //
    // 这条 2026-07-31 反转过一次：上午改成"先比 top"，下午被线上截图推翻
    // （真实数据上留了两个 189px 的洞，各正好空掉一个卡位）。理由见
    // bestSpanStart 的文档，别再照"墙底更整齐"把它改回去。
    expect(bestSpanStart([0, 100, 110, 20], 2)).toBe(1);
  });

  it("空白并列时才用 top 破平", () => {
    // [50,50]→空白 0 top 50；[10,10]→空白 0 top 10。两个都平，取落得低的。
    expect(bestSpanStart([50, 50, 10, 10], 2)).toBe(2);
  });

  it("跨列不在矮列留下整卡高度的洞（线上截图暴露的那个缺陷）", () => {
    // 线上复现的形状：某列比邻列矮整整一个卡位(189px)，此时跨列若按 top 择位
    // 就会把矮的那列从当前高度直接抬到高列，留下 189px 谁也填不进的空白。
    // 空白优先会绕开这个窗口。
    const heights = [800, 611, 800, 800, 800]; // 第 1 列矮 189
    const s = bestSpanStart(heights, 2);
    const seg = heights.slice(s, s + 2);
    const hole = Math.max(...seg) - Math.min(...seg);
    expect(hole).toBeLessThan(189);
  });

  it("span=1 时退化成最矮列（与 masonic 原生逐字一致）", () => {
    expect(bestSpanStart([100, 30, 80], 1)).toBe(1);
    expect(bestSpanStart([0, 0, 0], 1)).toBe(0);
  });

  it("首行（全 0）时取最左，不需要特例分支", () => {
    expect(bestSpanStart([0, 0, 0, 0], 2)).toBe(0);
  });

  it("只有部分列为 0 时选全 0 的那个窗口", () => {
    // [50,0]→top 50、[0,0]→top 0、[0,80]→top 80
    expect(bestSpanStart([50, 0, 0, 80], 2)).toBe(1);
  });

  it("跨列卡不会全部堆在最左边（用实测高度，不是等高模拟）", () => {
    // **这条用例 2026-08-08 改过——原来是假绿的。**
    //
    // 原版模拟每张卡都是 234px。等高时各列自然就散开了，所以它一直是绿的，
    // 而线上真实高度从 102 到 846，正反馈才咬合：一张跨列卡把两列设成完全
    // 相等 → 那对窗口空白恒为 0 → 下一张还挑它 → 又设成相等。
    //
    // 下面的高度是从组件库区块墙上量下来的原样（5 列、宽卡 span=2）。
    // 修之前跑这段：10 张宽卡全部 start=0，第 0/1 列摞到 4153px。
    const CC = 5;
    const wide = [242, 102, 102, 188, 360, 521, 126, 263, 846, 200, 306, 105];
    const narrow = [120, 80, 120, 170, 280, 120, 236, 32, 102, 70, 102, 120];
    const heights = new Array(CC).fill(0);
    const starts: number[] = [];
    // 宽窄交错，跟 interleaveWide 铺出来的次序一致
    for (let i = 0; i < wide.length + narrow.length; i++) {
      const isWide = i % 2 === 0;
      const span = isWide ? 2 : 1;
      const h = isWide ? wide[i >> 1] : narrow[i >> 1];
      const s = bestSpanStart(heights, span);
      if (isWide) starts.push(s);
      let top = heights[s];
      for (let j = s + 1; j < s + span; j++) if (heights[j] > top) top = heights[j];
      for (let j = s; j < s + span; j++) heights[j] = top + h + 16;
    }
    // ① 跨列卡得真的分散：5 列里 span=2 有 4 个可能的起点，至少用上 3 个
    expect(
      new Set(starts).size,
      `跨列卡的起始列：${starts.join(", ")}`
    ).toBeGreaterThanOrEqual(3);
    // ② 最终各列高度不能悬殊。修之前是 4153 : 500 ≈ 8.3 倍
    const mx = Math.max(...heights);
    const mn = Math.min(...heights);
    expect(mx / mn, `各列高度：${heights.join(", ")}`).toBeLessThan(1.6);
  });

  it("等高的两列不再永远赢过更矮但不齐的两列", () => {
    // 这就是正反馈的那一步，单独钉住：
    // [4000,4000] 空白 0，[400,300] 空白 100 —— 纯空白规则会选前者。
    expect(bestSpanStart([4000, 4000, 500, 400, 300], 2)).toBe(3);
  });
});

/**
 * update 的稳定性 —— 2026-08-09 补。
 *
 * 用户报「区块的布局算法不是很稳定」，Playwright 逐屏滚动实测：视口 1600 下
 * 19 帧里卡片位移 80 次、最大 501px，而且是 `1203→634→1203` 这样**来回**跳。
 * 根因是当时的 `update()` 走全量重排，连"落进哪一列"都重算一遍——任何一张卡
 * 改高（图表画完、滚出去又滚回来重新量）都会把整面墙重新洗牌。
 *
 * masonic / gestalt / react-photo-album 三家的共同做法是**测量结果可以变，
 * 落位决策不能变**。下面这组把这条钉死。
 */
describe("update 的稳定性", () => {
  /** 建一面墙：3 列，交错的跨列卡。 */
  function wall() {
    const spans = [2, 1, 1, 2, 1, 1, 2, 1, 1, 1];
    const p = make(3, i => spans[i] ?? 1);
    const h = [200, 120, 300, 150, 260, 90, 400, 110, 180, 220];
    h.forEach((v, i) => p.set(i, v));
    return { p, spans, h };
  }

  it("改高不改列 —— 每一格的 column/span 与改高前逐个相同", () => {
    const { p } = wall();
    const before = p.all().map(it => ({ column: it.column, span: it.span }));
    // 挑一张跨列卡大幅改高：这是最容易引发重新洗牌的情形
    p.update([0, 640]);
    p.all().forEach((it, i) => {
      expect({ i, column: it.column, span: it.span }).toEqual({ i, ...before[i] });
    });
  });

  it("改高之后仍然不重叠", () => {
    const { p } = wall();
    p.update([0, 640, 3, 40, 6, 80]);
    assertNoOverlap(p.all());
    // 反方向再来一次：收缩
    p.update([0, 60, 6, 700]);
    assertNoOverlap(p.all());
  });

  it("改高只影响它下面的，上面的一动不动", () => {
    const { p } = wall();
    const before = p.all().map(it => it.top);
    const target = 6; // 一张靠后的跨列卡
    const bottom = p.get(target)!.top + p.get(target)!.height;
    p.update([target, 700]);
    p.all().forEach((it, i) => {
      if (i === target) return;
      // 完全在它上方（底边不低于它的顶边）的格子不该动
      if (before[i] + it.height <= p.get(target)!.top) {
        expect(it.top, `#${i} 在改高的格子上方却动了`).toBe(before[i]);
      }
    });
    expect(bottom).toBeGreaterThan(0);
  });

  it("整像素相同的高度是死区，不引发任何位移", () => {
    const { p, h } = wall();
    const before = p.all().map(it => ({ ...it }));
    // gestalt `recalcHeights` 用 Math.floor 比较：亚像素抖动不该动整面墙
    p.update([2, h[2] + 0.4, 5, h[5] + 0.9]);
    expect(p.all()).toEqual(before);
  });

  it("同一个下标被 set 两次不会把它放两遍", () => {
    // 放两遍的症状正是"偶发重叠"：第二遍落在自己下面，两张同 key 的卡叠在一起。
    const { p } = wall();
    const n = p.size();
    p.set(4, 999);
    expect(p.size(), "重复 set 之后格子数变了").toBe(n);
    expect(p.get(4)!.height).toBe(999);
    assertNoOverlap(p.all());
  });

  it("size() 是格子数，不随区间树的实现细节漂移", () => {
    const { p } = wall();
    expect(p.size()).toBe(10);
    p.update([0, 640]); // 重排会重建区间树
    expect(p.size()).toBe(10);
  });
});

/**
 * 「哪些格子该进下一批测量」——2026-08-09 补。
 *
 * 渲染层原来问的是 `size()`（落了几格），把它当成"下一个该量的下标"。这只在
 * 落位下标恰好是 [0, size()) 连续前缀时才成立。当天亲手破坏过一次这个前提：
 * ref 回调里给落位加了个 `h > 0` 的条件，量到 0 的那格被跳过，于是
 *
 *     items 里有 8..29，order.length = 22
 *       → 渲染层从 22 开始画"隐藏待量"批次
 *       → 22..29 明明已经定位好了，又被画了一遍
 *       → 同一个 key 渲染两次，React 留下孤儿节点
 *
 * 浏览器实测：1600 视口 19 帧**全部**出现重叠，一张卡同时出现在两三个位置。
 * 现在渲染层改问 `firstUnplaced()`，问题从"靠纪律维持"变成"问不出错的问题"。
 */
describe("firstUnplaced", () => {
  it("连续落位时等于 size()", () => {
    const p = make(3, () => 1);
    expect(p.firstUnplaced()).toBe(0);
    [100, 120, 90, 140].forEach((h, i) => p.set(i, h));
    expect(p.firstUnplaced()).toBe(4);
    expect(p.firstUnplaced()).toBe(p.size());
  });

  it("中间留洞时指向洞，而不是跟着 size() 漂到已定位的格子上", () => {
    const p = make(3, () => 1);
    p.set(0, 100);
    p.set(1, 120);
    // 第 2 格被跳过（真实成因：量到 0 被一个前置条件挡下了）
    p.set(3, 140);
    p.set(4, 110);
    expect(p.size(), "落位格子数").toBe(4);
    expect(p.firstUnplaced(), "size() 会说 4 —— 而 4 已经定位好了").toBe(2);
  });

  it("高度量成 0 也必须算落位过，否则洞就是这么来的", () => {
    const p = make(3, () => 1);
    p.set(0, 0);
    expect(p.get(0), "量到 0 不等于没落位").toBeDefined();
    expect(p.firstUnplaced()).toBe(1);
  });
});

/**
 * 沉降重排 —— 2026-08-09 补，为的是一条实测出来的**永久性**错位。
 *
 * 组件库区块墙 1920 视口下 5 列 30 张卡，浏览器实测各列末端
 * `[4246,4246,3418,3418,1792]`，填充率 75.0%；把同一批 `(span, 最终高度)`
 * 离线喂给**同一条** `bestSpanStart`，得到 `[3695,3695,2141,3668,3668]`、
 * 填充率 86.2%。规则没错，错的是决策时读到的高度——`seed()` 会照喂过期列宽下
 * 量的高度（它有意为之），而 `update()` 只 `reflow()`、按定义不重选列，
 * 于是开场那一次的错误列**永远留下**。
 *
 * 同一成因还让版面不确定：三次加载总高 4246 / 4388 / 4388。
 */
describe("resettle", () => {
  it("用真高度重选列——错高度冻出来的列会被纠正", () => {
    const p = make(3, i => (i === 0 ? 2 : 1));
    // 开场：第 0 格（跨 2 列）被量成很矮
    p.set(0, 10);
    p.set(1, 100);
    p.set(2, 100);
    expect(p.get(1)!.column, "此时第 2 列还空着").toBe(2);

    // 真高度到货：第 0 格其实很高。reflow 只改几何，列不动。
    p.update([0, 500]);
    expect(p.get(1)!.column, "reflow 按定义不重选列").toBe(2);

    expect(p.resettle()).toBe(true);
    // 用真高度重来：第 0 格跨 0/1 列到 510，第 1 格该落到还空着的第 2 列
    expect(p.get(1)!.column).toBe(2);
    expect(p.get(2)!.column, "第 3 格不该再摞在 510 上").toBe(2);
    assertNoOverlap(p.all());
  });

  it("只放行一次——之后永久回到 reflow-only", () => {
    const p = make(3, () => 1);
    [100, 120, 90].forEach((h, i) => p.set(i, h));
    expect(p.resettle()).toBe(true);
    expect(p.resettle(), "第二次必须被闸挡下").toBe(false);
    expect(p.resettle()).toBe(false);
  });

  it("一格都没落位时不动，也不消耗那一次机会", () => {
    const p = make(3, () => 1);
    expect(p.resettle()).toBe(false);
    p.set(0, 100);
    expect(p.resettle(), "机会还在").toBe(true);
  });

  it("重排之后 items 仍是从 0 开始的连续前缀", () => {
    // 破坏这条不变式的后果是满屏摞卡，见 firstUnplaced 的文档。
    const p = make(4, i => (i % 3 === 0 ? 2 : 1));
    [120, 90, 300, 60, 210, 45, 180, 75].forEach((h, i) => p.set(i, h));
    p.resettle();
    expect(p.size()).toBe(8);
    expect(p.firstUnplaced()).toBe(8);
    expect(p.all().filter(Boolean).length).toBe(8);
    assertNoOverlap(p.all());
  });

  it("中间有洞时只排到洞前，不跳过去接着排", () => {
    const p = make(3, () => 1);
    p.set(0, 100);
    p.set(1, 120);
    p.set(3, 140); // 第 2 格没落位
    p.resettle();
    expect(p.firstUnplaced(), "洞的位置不变").toBe(2);
    expect(p.size(), "只重排了连续前缀那两格").toBe(2);
  });

  it("revision 只跟高度走，位置变化不算", () => {
    // 渲染层拿它给沉降计时续期：位置也算的话 resettle 会把自己的计时器续起来。
    const p = make(3, () => 1);
    const r0 = p.revision();
    [100, 120, 90].forEach((h, i) => p.set(i, h));
    expect(p.revision()).toBeGreaterThan(r0);

    const r1 = p.revision();
    p.update([0, 100]); // 高度没变 —— 死区拦下
    expect(p.revision(), "没变的高度不该推高 revision").toBe(r1);

    p.update([0, 400]);
    expect(p.revision()).toBeGreaterThan(r1);

    const r2 = p.revision();
    p.resettle();
    expect(p.revision(), "resettle 自己不能推高 revision，否则会自激").toBe(r2);
  });
});

describe("copyPlacements", () => {
  it("列宽变了也沿用原来的列，不该有：place() 重选之后换列", () => {
    const wide = createSpanPositioner({
      columnCount: 4,
      columnWidth: 300,
      columnGutter: G,
      rowGutter: G,
      getSpan: i => (i === 2 ? 2 : 1),
    });
    [180, 180, 360, 180, 180, 180].forEach((h, i) => wide.set(i, h));
    const cols = [0, 1, 2, 3, 4, 5].map(i => wide.get(i)!.column);

    const narrow = createSpanPositioner({
      columnCount: 4,
      columnWidth: 285,
      columnGutter: G,
      rowGutter: G,
      // 故意换一套 getSpan：走 set() 就会按新规则重选列
      getSpan: () => 1,
    });
    expect(copyPlacements(wide, narrow)).toBe(6);
    for (let i = 0; i < 6; i++) {
      expect(narrow.get(i)!.column, `#${i} 必须还在原列`).toBe(cols[i]);
      expect(narrow.get(i)!.span).toBe(wide.get(i)!.span);
    }
    expect(narrow.get(0)!.width).toBe(285);
    expect(narrow.get(2)!.width).toBe(285 * 2 + G);
    assertNoOverlap(narrow.all());
  });
});
