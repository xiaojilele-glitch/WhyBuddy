/**
 * 刀 2 几何的判据（2026-08-27）。
 *
 * 最要紧的一条是**块的左上角对到节点原点**——裁剪参数一改块就飘，而飘了
 * 之后画布上仍然是"一排卡片"，看着完全正常。这是刀 2 最该被变异咬住的地方。
 *
 * 2026-08-28 第一轮改成瀑布流摆位（用户要"自由散布"的观感）。
 *
 * 2026-08-28 第二轮（用户："太规矩了，太平了"）把**格宽从常数改成按内容算**，
 * 抄 ComfyUI `LGraphNode.computeSize()` 与 `useArrangeNodes.arrangeGrid`
 * （本地 clone commit 5d24e4e）。判据跟着它的四条要害走：
 *
 *   · 宽度随内容变，不是一个常数     ← "太规矩"就是这条丢了
 *   · 有下限（minWidth），没上限（上限只是量测溢出的护栏）
 *   · **标题宽也参与取最大**（title_width 那一项）
 *   · 每列各宽各的（colWidths + cumulativeOffsets），不是 i × 常数格宽
 */
import { describe, expect, it } from "vitest";

import {
  BLOCK_CELL,
  BLOCK_CHROME,
  BLOCK_SIZE,
  chooseBlockGridColumns,
  computeBlockSize,
  MAX_BLOCK_COLS,
  blockGridExtraGapX,
  blockGridHeight,
  blockGridSpan,
  blockDetailZoomThreshold,
  layoutBlockNodes,
  planBlockGrid,
  shouldDrawBlockDetail,
  BLOCK_HINT_FONT_PX,
  MIN_READABLE_FONT_PX,
  BLOCK_KIND_TINT,
  blockKindTint,
  colorChroma,
} from "../block-node-layout";
import { BLOCK_KINDS } from "../page-blocks";
import type { BlockRect } from "../block-rects";

const BOARD = { pageId: "p1", x: 100, y: 200, w: 1920, h: 1080 };

function rect(
  name: string,
  left: number,
  top: number,
  width: number,
  height: number
): BlockRect {
  return {
    name,
    kind: "card",
    label: name,
    kindLabel: "卡片",
    rect: { left, top, width, height },
  };
}

/** 排布用的宽度，跟被测代码同源取——判据不许自己另算一份格宽。 */
const widthOf = (r: BlockRect, boardH = BOARD.h) =>
  computeBlockSize(r, boardH).w;

/**
 * 真机量到的那 25 块的设计尺寸，**按页分组**（2026-08-28，
 * 会话 sr-20260827212138）。标定用的原始数据，不是编的——见
 * block-node-layout 里 BLOCK_SIZE 的头注。
 *
 * ⚠ 必须按页分组：网格是**逐页**排的，把 25 块当成一页会排出真机上不存在
 *   的宽度，据此定的阈值也就跟真机对不上。
 */
const REAL_PAGES: [string, [string, number, number][]][] = [
  [
    "material_requisition_hall",
    [
      ["通栏指标条", 1616, 110],
      ["全部物资", 1616, 107],
      ["在库充足二", 1200, 307],
      ["在库充足", 289, 307],
      ["显示第", 1200, 48],
      ["待提报申领清单", 400, 537],
    ],
  ],
  [
    "requisition_approval_center",
    [
      ["待我审批", 396, 103],
      ["流转中单据", 396, 103],
      ["本月已领结单", 396, 103],
      ["已驳回单据", 396, 103],
      ["领用单据列表", 1045, 818],
      ["单据明细与审批决策", 563, 818],
    ],
  ],
  [
    "stock_in_out_verification",
    [
      ["今日待出库核销", 1632, 110],
      ["扫码枪极速出库核验台", 1632, 606],
      ["物资台账出入库实时流水", 1632, 585],
    ],
  ],
  [
    "material_ledger_management",
    [
      ["全公司在库总数", 1624, 109],
      ["快速视图", 1624, 103],
      ["全公司物资在库实时主台账", 1624, 679],
    ],
  ],
  [
    "dept_monthly_consumption_dashboard",
    [
      ["当月核销消耗总额", 394, 133],
      ["最高领用频次部门", 394, 133],
      ["高耗物资品类", 394, 133],
      ["全员人均月消耗", 394, 133],
      ["各部门月度领用金额对比", 941, 390],
      ["物资分类消耗金额占比", 667, 390],
      ["部门月度消耗聚合台账", 1624, 1242],
    ],
  ],
];
const realPageRects = REAL_PAGES.map(([, list]) =>
  list.map(([n, w, h]) => rect(n, 0, 0, w, h))
);
const REAL: [string, number, number][] = REAL_PAGES.flatMap(([, l]) => l);
const realRects = REAL.map(([n, w, h]) => rect(n, 0, 0, w, h));

describe("⚠ 块宽按内容算（computeSize 口径）——这是「太规矩」那条", () => {
  it("宽的块在画布上就是更宽：通栏条 ≠ 小卡", () => {
    /*
     * 上一版所有块一律 440，真机上 1616×110 的通栏指标条和 289×307 的小卡
     * 在画布上一样宽——"这是通栏的、那是一小张"整个信息丢了。
     * 变异：computeBlockSize 回一个常数，这条红。
     */
    const wide = widthOf(rect("通栏", 0, 0, 1616, 110));
    const narrow = widthOf(rect("小卡", 0, 0, 289, 307));
    expect(wide).toBeGreaterThan(narrow);
    // 差得看得出来，不是差几个像素
    expect(wide / narrow).toBeGreaterThan(2);
  });

  it("自然宽 = 设计宽 × designScale（在下限之上时严格成立）", () => {
    const r = rect("甲", 0, 0, 1200, 300);
    expect(widthOf(r)).toBeCloseTo(1200 * BLOCK_SIZE.designScale, 6);
  });

  it("⚠ 有下限：小块夹到 minWidth，不许缩成看不清的小色块", () => {
    // 抄 `LiteGraph.NODE_WIDTH * (widgets ? 1.5 : 1)` 那条"有下限没上限"。
    // 变异：去掉 minWidth 那一项，这条红——396 的指标卡会只有 198。
    const tiny = rect("小", 0, 0, 200, 200);
    expect(widthOf(tiny)).toBe(BLOCK_SIZE.minWidth);
    expect(BLOCK_SIZE.minWidth).toBeGreaterThan(0);
  });

  it("⚠ 有上限护栏：量测溢出的超宽块不许把整张图撕开", () => {
    // overflow 的表格能量出 3000+ 设计宽；折算后 1500+，比画板还宽。
    const huge = rect("溢出表", 0, 0, 3600, 400);
    expect(widthOf(huge)).toBe(BLOCK_SIZE.maxWidth);
  });

  it("⚠ 各块的缩放差被收窄（上一版差 4.1 倍，字号跟着差 4 倍）", () => {
    /*
     * 统一 440 宽时：289→440 是 1.52×，1632→440 是 0.27×，差 5.6 倍；
     * 于是同一张图上小卡的字巨大、宽表的字看不见。
     * 按内容算之后小块被放大、大块按 designScale，差应当明显收窄。
     * 变异：回到统一格宽，这条红。
     */
    const scales = realRects.map(r => computeBlockSize(r, BOARD.h).scale);
    const spread = Math.max(...scales) / Math.min(...scales);
    expect(spread).toBeLessThan(2.5);
    // 反向：也不许收成 1（那就是"所有块同一个缩放"，小块又看不清了）
    expect(spread).toBeGreaterThan(1.2);
  });

  it("真机那 25 块：宽度不是一个数（至少五档）", () => {
    /*
     * 这条是"太规矩"的直接反向判据：全压成一个数就红。
     *
     * ⚠ 2026-08-28 标题条砍掉、`title_width` 那一项跟着删掉之后，档数从
     *   13 掉到 8——名字长的块不再自己撑宽了。8 档仍然够读出"这是通栏的、
     *   那是一小张"，所以门槛留在 5 不动；真要退回一个常数照样红。
     */
    const widths = new Set(realRects.map(r => widthOf(r)));
    expect(widths.size).toBeGreaterThanOrEqual(5);
  });
});

describe("网格摆位", () => {
  it("⚠ 列数选到**装得进画板高度**为止，不是拍 √n", () => {
    /*
     * 2026-08-28 真机（4 页 15 块）量到的：
     *     画板行距          1312（1080 高 + 232 间距）
     *     远程审方页的网格   y 0 → 1832 —— 越过下一排画板 520
     * √n 只管形状方不方，不管跟画板比起来多高。溢出之后整张图在垂直方向
     * 被撑开，放大到工作档位看到的就是大片空白里几条线穿过。
     * 变异：改回 ceil(sqrt(n))，这条红。
     */
    /* ⚠ 这组数是**挑过的**：8 块 → √n = 3 列时 3 块一叠正好超过 1080，
       4 列时 2 块一叠装得下。数字随便写的话两条规则给同一个答案，
       这条判据就废了（变异也咬不住）。 */
    const tall = Array.from({ length: 8 }, (_, i) =>
      rect(`b${i}`, 0, 0, 520, 700)
    );
    const cols = chooseBlockGridColumns(tall, 1080);
    const boxes = layoutBlockNodes({ ...BOARD, h: 1080 }, tall);
    const top = Math.min(...boxes.map(b => b.y));
    const bottom = Math.max(...boxes.map(b => b.y + b.h));
    expect(bottom - top).toBeLessThanOrEqual(1080);
    expect(cols).toBeGreaterThan(Math.ceil(Math.sqrt(tall.length)) - 1);
  });

  it("块少且矮时就一列——不为了方而硬加列", () => {
    const few = [rect("甲", 0, 0, 520, 200)];
    expect(chooseBlockGridColumns(few, 1080)).toBe(1);
  });

  it("⚠ 列数有上限：块特别多也不许把右边那页推到天边", () => {
    // 装不下就如实溢出一点，不假装。
    const many = Array.from({ length: 60 }, (_, i) =>
      rect(`b${i}`, 0, 0, 520, 1200)
    );
    expect(chooseBlockGridColumns(many, 1080)).toBe(MAX_BLOCK_COLS);
  });

  it("空清单回 1 列，不炸也不回 0", () => {
    expect(chooseBlockGridColumns([], 1080)).toBe(1);
  });

  it("排在画板右侧，第一格与画板顶对齐（顶上留出标题条）", () => {
    const r = rect("甲", 0, 0, 520, 260);
    const [a] = layoutBlockNodes(BOARD, [r]);
    expect(a.x).toBe(BOARD.x + BOARD.w + BLOCK_CELL.stripGap);
    // ⚠ 顶端跟画板顶齐平。标题条砍掉之后这里不再有 ±labelBand 的成对偏移
    expect(a.y).toBe(BOARD.y);
    expect(a.w).toBe(widthOf(r));
  });

  it("跟着画板**现在**的位置走（拖过之后块也跟着走）", () => {
    const moved = { ...BOARD, x: 5000, y: 7000 };
    const [a] = layoutBlockNodes(moved, [rect("甲", 0, 0, 520, 260)]);
    expect(a.x).toBe(5000 + BOARD.w + BLOCK_CELL.stripGap);
    expect(a.y).toBe(7000);
  });

  it("⚠ 每列各宽各的（arrangeGrid 的 colWidths + cumulativeOffsets）", () => {
    /*
     * 抄 `colWidths[col] = max(visualWidth)` ＋ `cumulativeOffsets`。
     * 变异：写成 `x = col * (某个常数格宽 + gap)`，这条红——
     *   窄列后面会白留一大段空，宽列会盖住右边那列。
     */
    const boxes = layoutBlockNodes({ ...BOARD, h: 1080 }, [
      rect("宽块", 0, 0, 1600, 1400), // 自己占满一列
      rect("窄块", 0, 0, 300, 1400),
    ]);
    const [wide, narrow] = boxes;
    expect(wide.w).toBeGreaterThan(narrow.w);
    // 第二列的左缘 = 第一列宽 + gap，**用第一列自己的宽**，不是某个常数
    expect(narrow.x - wide.x).toBe(wide.w + BLOCK_CELL.gap);
  });

  it("⚠ 瀑布流：每块落进当前最矮的那一列（不是按行填）", () => {
    // 2026-08-28 用户要"自由散布"的观感。严格网格会让所有块顶边对齐成一条
    // 直线，那是"电子表格感"的来源。
    // 变异：改回按行填（col = i % cols），这条红。
    /* ⚠ 用**宽块**：块高有高宽比上限，窄块再长也顶不高，一列就装下了，
       逼不出第二列（改成按内容算宽度之后第一版判据就栽在这上面）。 */
    const boxes = layoutBlockNodes(BOARD, [
      rect("高", 0, 0, 1600, 2700), // 第 1 列，自己顶满一列
      rect("矮", 0, 0, 1600, 150), // 第 2 列
      rect("第三块", 0, 0, 1600, 150),
    ]);
    // 3 块 → 2 列。第 3 块该落进**矮的那一列**（第 2 列），不是回到第 1 列
    expect(boxes[2].x).toBe(boxes[1].x);
    expect(boxes[2].x).not.toBe(boxes[0].x);
  });

  it("⚠ 同一列里，下一块的**视觉顶**接在上一块底下（含标题条）", () => {
    // 抄 ComfyUI `visualHeight = size + titleHeight` 的那条。
    // 变异：列高忘了加内容高或漏掉 gap，块会叠在一起——不报错，只是看着糊。
    const boxes = layoutBlockNodes(BOARD, [
      rect("甲", 0, 0, 520, 700),
      rect("乙", 0, 0, 520, 700),
      rect("丙", 0, 0, 520, 700),
      rect("丁", 0, 0, 520, 700),
    ]);
    const sameCol = boxes.filter(b => b.x === boxes[0].x);
    expect(sameCol.length).toBeGreaterThanOrEqual(2);
    const gapBetween = sameCol[1].y - (sameCol[0].y + sameCol[0].h);
    expect(gapBetween).toBe(BLOCK_CELL.gap);
  });

  it("反向：块之间不许重叠（瀑布流最容易写坏的地方）", () => {
    const boxes = layoutBlockNodes(
      BOARD,
      Array.from({ length: 9 }, (_, i) =>
        rect(`b${i}`, 0, 0, 300 + i * 140, 100 + i * 90)
      )
    );
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        /* 视觉盒（含标题条）都不许相交 */
        const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
        const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlapX && overlapY, `${a.name} 和 ${b.name} 叠了`).toBe(false);
      }
    }
  });

  it("反向：真机那 25 块摆出来也不许重叠（宽度不齐最容易漏）", () => {
    // 上一条用的是构造数据；这条用真机的形状分布再过一遍。
    const boxes = layoutBlockNodes(BOARD, realRects);
    expect(boxes.length).toBe(realRects.length);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
        const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlapX && overlapY, `${a.name} 和 ${b.name} 叠了`).toBe(false);
      }
    }
  });

  it("确定性：同一份输入永远同一个结果（块不许在画布上跳）", () => {
    // 变异：用随机抖动做"自由散布"，这条红。
    const a = layoutBlockNodes(BOARD, realRects);
    const b = layoutBlockNodes(BOARD, realRects);
    expect(a).toEqual(b);
  });

  it("键是跨页唯一的（含 pageId）", () => {
    const a = layoutBlockNodes(BOARD, [rect("统计概览", 0, 0, 100, 100)])[0];
    const b = layoutBlockNodes({ ...BOARD, pageId: "p2" }, [
      rect("统计概览", 0, 0, 100, 100),
    ])[0];
    expect(a.key).not.toBe(b.key);
  });
});

describe("⚠ 裁剪：块的左上角必须对到节点原点", () => {
  it("按自己的宽度铺满，缩放比 = 节点宽 / 块宽", () => {
    const r = rect("甲", 260, 130, 1040, 520);
    const [a] = layoutBlockNodes(BOARD, [r]);
    expect(a.crop.scale).toBeCloseTo(widthOf(r) / 1040, 6);
    expect(a.h).toBeCloseTo(520 * (widthOf(r) / 1040), 6);
  });

  it("位移是**设计坐标**（CSS 的 scale 会替我们乘，这里不许先乘一遍）", () => {
    // 变异：crop.left 写成 b.rect.left * scale（乘两次），块会飘到左上角外面。
    // 消费侧是 `scale(s) translate(-left, -top)`，CSS 先 translate 再 scale。
    const [a] = layoutBlockNodes(BOARD, [rect("甲", 260, 130, 1040, 520)]);
    expect(a.crop.left).toBe(260);
    expect(a.crop.top).toBe(130);
  });

  it("反向：块在页面原点时位移就是 0（别硬加偏移）", () => {
    const [a] = layoutBlockNodes(BOARD, [rect("甲", 0, 0, 1040, 520)]);
    expect(a.crop.left).toBe(0);
    expect(a.crop.top).toBe(0);
  });

  it("整页缩放后，那一块正好落在洞口 —— 逐数对账", () => {
    // 把裁剪参数当成"整页缩放 scale 后左上挪 (left, top)"来算一遍，
    // 检查块的四个角是否落在 [0,w]×[0,h] 上。这条是上面几条的合并对账。
    const r = rect("甲", 300, 600, 800, 400);
    const [a] = layoutBlockNodes(BOARD, [r]);
    const { scale, left, top } = a.crop;
    /* 按消费侧那条公式复算：scale(s) translate(-left,-top) 之后，
       块的左上角落在 (rect.left - left) * s。 */
    const blockLeftInNode = (r.rect.left - left) * scale;
    const blockTopInNode = (r.rect.top - top) * scale;
    expect(blockLeftInNode).toBeCloseTo(0, 6);
    expect(blockTopInNode).toBeCloseTo(0, 6);
    expect(r.rect.width * scale).toBeCloseTo(a.w, 6);
    expect(r.rect.height * scale).toBeCloseTo(a.h, 6);
  });

  it("⚠ 真机那 25 块逐块对账：每块的裁剪都对到自己的节点原点", () => {
    // 宽度不再统一之后，crop.scale 必须**逐块**跟着自己的宽度走。
    // 变异：scale 用某个全局常数，这条红。
    const boxes = layoutBlockNodes(BOARD, realRects);
    boxes.forEach((b, i) => {
      const r = realRects[i];
      expect(r.rect.width * b.crop.scale, r.name).toBeCloseTo(b.w, 6);
    });
  });
});

describe("长块截断", () => {
  it("超过高宽比上限就截断，并如实标记", () => {
    // 原始 6:1 的长表格。画板给足够高，让高宽比那条成为生效的上限。
    const r = rect("长表", 0, 0, 400, 2400);
    const [a] = layoutBlockNodes({ ...BOARD, h: 4000 }, [r]);
    expect(a.truncated).toBe(true);
    expect(a.h).toBeCloseTo(widthOf(r, 4000) * BLOCK_CELL.maxAspect, 6);
  });

  it("⚠ 单块高度也按**画板高度**封顶（否则永远装不进画板）", () => {
    /*
     * 2026-08-28 真机：一个长表格块自己就比画板还高，加标题条更超——
     * 那一页无论分几列都装不下，"列数选到装得下为止"这条规则永远达不成，
     * 网格照样溢出到下一排（量到 1832，越过 520）。
     * 变异：把这条上限去掉，只留高宽比，这条红。
     */
    const r = rect("长表", 0, 0, 1200, 6000);
    const [a] = layoutBlockNodes({ ...BOARD, h: 1080 }, [r]);
    expect(a.h).toBe(1080);
    expect(a.h).toBeLessThan(widthOf(r) * BLOCK_CELL.maxAspect);
    expect(a.truncated).toBe(true);
  });

  it("⚠ 选列数和摆位用**同一条**高度上限（不然选的时候以为装得下）", () => {
    const tall = Array.from({ length: 5 }, (_, i) =>
      rect(`b${i}`, 0, 0, 400, 2400)
    );
    const boxes = layoutBlockNodes({ ...BOARD, h: 1080 }, tall);
    const cols = chooseBlockGridColumns(tall, 1080);
    const top = Math.min(...boxes.map(b => b.y));
    const bottom = Math.max(...boxes.map(b => b.y + b.h));
    expect(cols).toBe(MAX_BLOCK_COLS);
    expect(bottom - top).toBeGreaterThan(0);
    // 每一块自己都不许超过画板高度
    for (const b of boxes) expect(b.h).toBeLessThanOrEqual(1080);
  });

  it("反向：没超的不许被标成截断", () => {
    // 变异：把 truncated 恒写 true，用户会看到每一块都挂"只显示上半截"，
    // 那是在谎报。
    const [a] = layoutBlockNodes(BOARD, [rect("甲", 0, 0, 520, 260)]);
    expect(a.truncated).toBe(false);
  });

  it("反向：真机那 25 块一个都不该被截断（截断是异常，不是常态）", () => {
    // 最长的那块 1624×1242 折算后 812×621，离画板高度还远。
    // 变异：把高度上限调到常态就会咬到的档，这条红。
    const boxes = layoutBlockNodes(BOARD, realRects);
    expect(boxes.filter(b => b.truncated).map(b => b.name)).toEqual([]);
  });

  it("截断**不压扁**：缩放比仍按宽度算，字不变形", () => {
    const r = rect("长表", 0, 0, 400, 2400);
    const [a] = layoutBlockNodes(BOARD, [r]);
    expect(a.crop.scale).toBeCloseTo(widthOf(r) / 400, 6);
  });
});

describe("反向判据", () => {
  it("塌成 0 的块不进条带（跟量测那一侧同一条规则）", () => {
    const boxes = layoutBlockNodes(BOARD, [
      rect("甲", 0, 0, 520, 260),
      rect("塌了", 0, 0, 0, 0),
    ]);
    expect(boxes.map(b => b.name)).toEqual(["甲"]);
  });

  it("画板尺寸为 0 时回空数组，不抛也不算出 NaN", () => {
    expect(
      layoutBlockNodes({ ...BOARD, w: 0 }, [rect("甲", 0, 0, 1, 1)])
    ).toEqual([]);
  });

  it("空块清单 → 网格高 0（不是一行）", () => {
    // 多算一行会让外接盒每页虚高一截，「适应画布」跟着偏。
    expect(blockGridHeight([])).toBe(0);
  });

  it("网格高从首行顶量到末行底", () => {
    const boxes = layoutBlockNodes(BOARD, [
      rect("甲", 0, 0, 520, 260),
      rect("乙", 0, 0, 520, 520),
    ]);
    const top = Math.min(...boxes.map(b => b.y));
    const bottom = Math.max(...boxes.map(b => b.y + b.h));
    expect(blockGridHeight(boxes)).toBe(bottom - top);
  });

  it("⚠ 网格宽 = 摆出来真实占的宽（不是列数 × 常数格宽）", () => {
    /*
     * 这条是"留的间距和实际网格宽对不上"的防伪标记：把 span 跟**摆出来的
     * 盒子右缘**对账。变异：blockGridSpan 回 cols × minWidth，这条红。
     */
    const boxes = layoutBlockNodes(BOARD, realRects);
    const originX = BOARD.x + BOARD.w + BLOCK_CELL.stripGap;
    const right = Math.max(...boxes.map(b => b.x + b.w));
    expect(blockGridSpan(realRects, BOARD.h)).toBeCloseTo(right - originX, 6);
  });

  it("网格宽 = 各列宽之和 + 列间距（列宽各算各的）", () => {
    const plan = planBlockGrid(realRects, BOARD.h);
    const used = plan.colWidths.filter(w => w > 0);
    expect(plan.width).toBeCloseTo(
      used.reduce((a, b) => a + b, 0) + (used.length - 1) * BLOCK_CELL.gap,
      6
    );
    // 反向：列宽真的不齐（齐了说明又退回常数格宽）
    expect(new Set(used).size).toBeGreaterThan(1);
  });

  it("空清单 → 网格宽 0，不留一份空格宽", () => {
    expect(blockGridSpan([], BOARD.h)).toBe(0);
    expect(planBlockGrid([], BOARD.h).items).toEqual([]);
  });

  it("画板要多留的横向间距 = 间隙 + **最宽那页**的网格宽", () => {
    // 少留的话网格会盖住右边那列画板，而全景下只是"看着有点挤"，不报错。
    const span = blockGridSpan(realRects, BOARD.h);
    expect(blockGridExtraGapX(span)).toBe(BLOCK_CELL.stripGap + span);
    expect(blockGridExtraGapX(span)).toBeGreaterThan(
      blockGridExtraGapX(span / 2)
    );
    expect(blockGridExtraGapX(0)).toBe(0);
  });

  it("⚠ 真机每一页的网格都不许比画板还宽（横向拉开＝适应画布掉档）", () => {
    /*
     * 上一版 4×520 = 2248 那次的教训：整张图横向拉开，「适应画布」
     * 从 16% 掉到 12%，反而更看不清。
     *
     * ⚠ 这条钉的是**标定的那一档**：designScale 调到 0.5 时消耗看板那页
     *   会从 3 列变 4 列、网格宽 2200 —— 这条红。见 BLOCK_SIZE 的扫描表。
     */
    for (const [i, rects] of realPageRects.entries()) {
      const span = blockGridSpan(rects, BOARD.h);
      expect(span, REAL_PAGES[i][0]).toBeLessThanOrEqual(BOARD.w);
    }
  });
});

describe("LOD：缩放太低就不画细节（抄 ComfyUI 的可读性反推）", () => {
  it("阈值是从字号反推的，不是拍的魔数", () => {
    // threshold = 最小可读字号 / (标题字号 * sqrt(DPR))
    expect(blockDetailZoomThreshold(1)).toBeCloseTo(
      MIN_READABLE_FONT_PX / BLOCK_HINT_FONT_PX,
      6
    );
  });

  it("⚠ 反推用的字号必须是**画布单位**那一个", () => {
    /*
     * 2026-08-28：上一版这条阈值从来没成立过——标题是反缩放画的
     * （11px 恒定），而公式里的 NODE_TEXT_SIZE 指图坐标字号。代 11 进去
     * 得 0.545，于是画布常态 17%~25% 全在阈值之下，**标签一次没显示过**，
     * 用户看到的就是一排没有标题的白方块（"太平了"的一半）。
     * 变异：BLOCK_HINT_FONT_PX 改回 11，这条和下面那条一起红。
     */
    expect(BLOCK_HINT_FONT_PX).toBe(BLOCK_CHROME.hintFont);
  });

  it("真机那三档：21% 全景不画字，40%／100% 画", () => {
    // 变异：字号回 11（阈值 0.545），40% 那条红——那正是踩过的坑。
    expect(shouldDrawBlockDetail(0.21, 1)).toBe(false);
    expect(shouldDrawBlockDetail(0.4, 1)).toBe(true);
    expect(shouldDrawBlockDetail(1, 1)).toBe(true);
  });

  it("高 DPR 屏阈值更低（同样的缩放下字更清楚）", () => {
    // ComfyUI 注释里的原话：高 DPR 对可读性的提升不是线性的，用 sqrt 近似。
    expect(blockDetailZoomThreshold(2)).toBeLessThan(
      blockDetailZoomThreshold(1)
    );
    expect(blockDetailZoomThreshold(2)).toBeCloseTo(
      blockDetailZoomThreshold(1) / Math.SQRT2,
      6
    );
  });

  it("反向：阈值本身必须是个正数且小于 1（不然要么全关要么全开）", () => {
    const t = blockDetailZoomThreshold(1);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });

  it("DPR 传 0 / 负数不炸（当 1 处理）", () => {
    expect(blockDetailZoomThreshold(0)).toBe(blockDetailZoomThreshold(1));
    expect(blockDetailZoomThreshold(-3)).toBe(blockDetailZoomThreshold(1));
  });
});

describe("⚠ 节点外观：有卡片的层次，**没有标题条**", () => {
  it("标题条那一套常量全删干净了（留着＝改了一半）", () => {
    /*
     * 2026-08-28 用户三轮裁决的终点：「直接去掉标题条」。
     *
     * ⚠ 这条钉的是"删干净"。留一个 titleFont 在那儿不画任何字、留一个
     *   labelBand 在排布里白占 56 个单位——两样都不报错，只是永远对不上。
     * 变异：把任意一条加回来，这条红。
     */
    const chrome = BLOCK_CHROME as Record<string, unknown>;
    for (const dead of ["titleFont", "titleDot", "separator", "titleBar"]) {
      expect(chrome[dead], dead).toBeUndefined();
    }
    const cell = BLOCK_CELL as Record<string, unknown>;
    expect(cell.labelBand).toBeUndefined();
  });

  it("⚠ 砍标题条不等于回到白方块：圆角和投影得留着", () => {
    /*
     * "太平了"是两件事叠出来的：没有层次，以及标签因为 LOD 阈值算错
     * 从来没显示过。层次这半跟标题条无关。
     * 变异：把 radius/shadow 也一起删掉，这条红。
     */
    expect(BLOCK_CHROME.radius).toBeGreaterThan(0);
    expect(BLOCK_CHROME.shadow).toContain("rgba");
  });

  it("投影是**分层**的，不是单层大模糊", () => {
    // 分层的道理见 stage-frame-style 头注：单层只是糊，分层才像光照。
    expect(BLOCK_CHROME.shadow.split("rgba").length - 1).toBeGreaterThanOrEqual(
      2
    );
  });

  it("⚠ 投影不照抄 ComfyUI 那个 alpha 0.5（浅底上是一圈脏）", () => {
    for (const m of BLOCK_CHROME.shadow.matchAll(/rgba\([^)]*?([\d.]+)\)/g)) {
      expect(Number(m[1])).toBeLessThan(0.5);
    }
  });

  it("提示字号是正数（LOD 阈值从它反推，为 0 会把阈值打成无穷）", () => {
    expect(BLOCK_CHROME.hintFont).toBeGreaterThan(0);
  });
});

describe("块类型底色（抄 ComfyUI 低质量档「保形状保颜色、只丢细节」）", () => {
  it("每一种块类型都有底色——不许有类型落到「没颜色」", () => {
    // 变异：删掉任意一档，这条红。缺色的那类在全景下会变回白方块。
    for (const k of BLOCK_KINDS) {
      expect(BLOCK_KIND_TINT[k], `缺 ${k} 的底色`).toBeDefined();
    }
  });

  it("认不出的类型回 card 那档，不回透明", () => {
    // "认不出类型"和"没有内容"是两回事；透明就是那片白方块。
    expect(blockKindTint("不存在的类型")).toEqual(BLOCK_KIND_TINT.card);
    expect(blockKindTint("")).toEqual(BLOCK_KIND_TINT.card);
  });

  it("反向：不同类型的底色互不相同（同色等于没分类）", () => {
    const fills = BLOCK_KINDS.map(k => BLOCK_KIND_TINT[k].fill);
    expect(new Set(fills).size).toBe(fills.length);
  });

  it("⚠ 只有 fill/ink 两档——不许再冒出按类型分色的第三种用法", () => {
    /*
     * 2026-08-28 用户两轮打回：「我们是区块，不是属性面板」→
     * 「直接去掉标题条」。类型色现在**只给降级静态卡**。
     * 变异：加回一个 bar 字段，这条红。
     */
    for (const k of BLOCK_KINDS) {
      expect(Object.keys(BLOCK_KIND_TINT[k]).sort(), k).toEqual(["fill", "ink"]);
    }
  });

  it("色度函数本身对得上（判据自己也得能被咬）", () => {
    expect(colorChroma("#ffffff")).toBe(0);
    expect(colorChroma("#ff0000")).toBe(1);
    // ComfyUI 那档 red 的色度
    expect(colorChroma("#332222")).toBeCloseTo(17 / 255, 6);
  });
});
