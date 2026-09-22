/**
 * 两端对齐行布局。
 *
 * 这些断言钉的是**设计稿那几条结构性质**，不是实现细节——只要这几条成立，
 * 排出来就是那个样子；反之改坏了立刻能看出来。
 */
import { describe, expect, it } from "vitest";

import { DEVICE_ASPECT, aspectForDevice, justifiedRows } from "../justified-rows";

/** 真实设备档的宽高比（与 AppRuntimeScreen 的 DEVICE_SPECS 同源） */
const DESKTOP = 1440 / 810; // 1.778
const PHONE = 405 / 720; //   0.5625（9:16，与出图画布同比）

const ar = (n: number) => ({ aspectRatio: n });

describe("justifiedRows", () => {
  it("同一行里所有卡片高度一致——这是「等高变宽」的定义", () => {
    const r = justifiedRows([DESKTOP, DESKTOP, PHONE, DESKTOP, PHONE, DESKTOP].map(ar), {
      containerWidth: 1400,
      targetRowHeight: 260,
    });
    const byRow = new Map<number, number[]>();
    for (const b of r.boxes) byRow.set(b.row, [...(byRow.get(b.row) ?? []), b.height]);
    for (const [row, heights] of byRow) {
      expect(new Set(heights).size, `第 ${row} 行高度不一致: ${heights}`).toBe(1);
    }
  });

  it("每一行正好铺满容器宽度（末行除外）——「两端对齐」的定义", () => {
    const r = justifiedRows(Array.from({ length: 11 }, (_, i) => ar(i % 3 === 0 ? PHONE : DESKTOP)), {
      containerWidth: 1400,
      targetRowHeight: 260,
      spacing: 12,
    });
    const rows = [...new Set(r.boxes.map(b => b.row))];
    const lastRow = Math.max(...rows);
    for (const row of rows) {
      if (row === lastRow) continue; // 末行允许留白
      const inRow = r.boxes.filter(b => b.row === row);
      const total =
        inRow.reduce((s, b) => s + b.width, 0) + (inRow.length - 1) * 12;
      expect(Math.abs(total - 1400), `第 ${row} 行没铺满: ${total}`).toBeLessThan(1);
    }
  });

  it("手机档（0.46）自动变窄竖条，桌面档（1.78）变宽幅——设计稿那两根窄列的来历", () => {
    // 设计稿里「待办事项」「消息中心」不是手工摆的窄列，是宽高比 0.46 的卡片
    // 落进等高行里的必然结果。这条断言就是钉这个因果。
    // 行高目标越小，一行装得越多——这里用 240 让手机档和桌面档落进同一行。
    // （原先写 300 时行在两张桌面卡处就封了，手机被推到下一行：那不是算法
    // 的问题，是我这条用例的参数选错了。）
    const r = justifiedRows([DESKTOP, DESKTOP, PHONE, DESKTOP].map(ar), {
      containerWidth: 1400,
      targetRowHeight: 240,
    });
    const first = r.boxes.filter(b => b.row === 0);
    expect(first.length, "手机档没落进第一行，这条用例的参数要重挑").toBeGreaterThanOrEqual(3);
    const phoneBox = first.find(b => b.aspectRatio === PHONE)!;
    const deskBox = first.find(b => b.aspectRatio === DESKTOP)!;
    expect(phoneBox.height).toBe(deskBox.height); // 等高
    expect(phoneBox.width).toBeLessThan(deskBox.width / 3); // 窄得多（1.778 / 0.5625 ≈ 3.2）
  });

  it("行高在目标值附近浮动，不会离谱", () => {
    const r = justifiedRows(Array.from({ length: 20 }, (_, i) => ar(i % 4 === 0 ? PHONE : DESKTOP)), {
      containerWidth: 1400,
      targetRowHeight: 260,
      targetRowHeightTolerance: 0.25,
    });
    const rows = [...new Set(r.boxes.map(b => b.row))];
    const lastRow = Math.max(...rows);
    for (const h of r.rowHeights.slice(0, lastRow)) {
      expect(h).toBeGreaterThan(260 * 0.5);
      expect(h).toBeLessThan(260 * 2);
    }
  });

  it("单张超宽卡自己占一行，不会把别人挤变形", () => {
    const r = justifiedRows([ar(8), ar(DESKTOP), ar(DESKTOP)], {
      containerWidth: 1400,
      targetRowHeight: 260,
    });
    expect(r.boxes[0].row).toBe(0);
    expect(r.boxes.filter(b => b.row === 0)).toHaveLength(1);
  });

  it("末行不足时默认左对齐留白，不强行拉满（单张拉满会变成巨幅卡）", () => {
    const left = justifiedRows([DESKTOP, DESKTOP, DESKTOP, DESKTOP, DESKTOP].map(ar), {
      containerWidth: 1400,
      targetRowHeight: 260,
    });
    const justify = justifiedRows([DESKTOP, DESKTOP, DESKTOP, DESKTOP, DESKTOP].map(ar), {
      containerWidth: 1400,
      targetRowHeight: 260,
      lastRowBehavior: "justify",
    });
    const lastLeft = left.rowHeights.at(-1)!;
    const lastJustify = justify.rowHeights.at(-1)!;
    expect(lastLeft).toBe(260);
    expect(lastJustify).toBeGreaterThan(lastLeft);
  });

  it("空输入与零宽容器不炸", () => {
    expect(justifiedRows([], { containerWidth: 1400 }).boxes).toEqual([]);
    expect(justifiedRows([ar(DESKTOP)], { containerWidth: 0 }).boxes).toEqual([]);
  });

  it("卡片不重叠：同行左边界递增，行与行之间 top 递增", () => {
    const r = justifiedRows(Array.from({ length: 14 }, (_, i) => ar(i % 5 === 0 ? PHONE : DESKTOP)), {
      containerWidth: 1400,
      targetRowHeight: 260,
      spacing: 12,
    });
    for (const row of [...new Set(r.boxes.map(b => b.row))]) {
      const inRow = r.boxes.filter(b => b.row === row).sort((a, b) => a.left - b.left);
      for (let i = 1; i < inRow.length; i++) {
        expect(inRow[i].left).toBeGreaterThanOrEqual(inRow[i - 1].left + inRow[i - 1].width);
      }
    }
    const tops = r.rowHeights.map((_, i) => r.boxes.find(b => b.row === i)!.top);
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1]);
  });
});

// ── 设备档宽高比（2026-07-31 从 dev-harness 抽上来，应用中心也用同一份）──

describe("aspectForDevice", () => {
  it("手机档必须比桌面档窄——这是整个混排的目的", () => {
    expect(aspectForDevice("phone")).toBeLessThan(1);
    expect(aspectForDevice("desktop")).toBeGreaterThan(1);
    expect(aspectForDevice("phone")).toBeLessThan(aspectForDevice("desktop"));
  });

  it("空串/未知值按桌面处理", () => {
    // 线上实测 19 个应用里 5 个是空串（preferredDevice 未声明的老记录）。
    // 保守方向：错判成桌面只是卡片偏宽；错判成手机会把宽版应用压进窄条里。
    for (const v of ["", "  ", null, undefined, "watch", "DESKTOP"]) {
      expect(aspectForDevice(v as string)).toBe(DEVICE_ASPECT.desktop);
    }
  });

  it("与首页参照板的出图画布一致（卡片装的是那张图）", () => {
    // 卡片比例的唯一依据是 freeform_block._DEVICE_IMAGE_SIZE：
    //   desktop / tablet → 1280×720、phone → 720×1280。
    // 不 import 那边（Python）：卡片比例的依据是**出图画布**，不是屏幕物理比。
    // 2026-08-01 起卡片装的是参照板而不是活渲染，抄 AppRuntimeScreen 的
    // DEVICE_SPECS 反而是错的——当时手机档 390/844 比 9:16 窄 22%，卡片就高
    // 22%，即用户看到的「过长」。
    //
    // 2026-08-03 起 DEVICE_SPECS 也是 9:16（405×720），三处数值上一致了，
    // 但**依据仍然不同**：这里跟的是出图，那里跟的是"设计 LLM 照着哪块画布
    // 排的版式"。恰好同源不等于可以互相 import——出图尺寸若单独改动，
    // 这条当场红，而画布那头由 sheet-thumb.test 的一致性用例盯着。
    expect(DEVICE_ASPECT.desktop).toBeCloseTo(16 / 9, 6);
    expect(DEVICE_ASPECT.tablet).toBeCloseTo(16 / 9, 6);
    expect(DEVICE_ASPECT.phone).toBeCloseTo(9 / 16, 6);
  });
});

describe("混排：手机档落进等高行会自动变窄竖条", () => {
  it("同一行里手机卡明显窄于桌面卡，且两者等高", () => {
    // 设计稿那种「大中小交错」不是随机摆的，是宽高比落进等高行的必然结果。
    const items = [
      { aspectRatio: DEVICE_ASPECT.desktop },
      { aspectRatio: DEVICE_ASPECT.phone },
      { aspectRatio: DEVICE_ASPECT.desktop },
    ];
    const r = justifiedRows(items, { containerWidth: 1200, targetRowHeight: 260, spacing: 16 });
    const row0 = r.boxes.filter(b => b.row === 0);
    expect(row0.length).toBeGreaterThan(1);
    const heights = new Set(row0.map(b => Math.round(b.height)));
    expect(heights.size).toBe(1); // 同行等高

    const phone = r.boxes.find(b => b.aspectRatio < 1)!;
    const desktop = r.boxes.find(b => b.aspectRatio > 1)!;
    expect(phone.width).toBeLessThan(desktop.width / 2);
  });

  it("全是桌面档时不会退化成竖条（回归保护）", () => {
    const r = justifiedRows(
      Array.from({ length: 6 }, () => ({ aspectRatio: DEVICE_ASPECT.desktop })),
      { containerWidth: 1200, targetRowHeight: 260, spacing: 16 }
    );
    for (const b of r.boxes) expect(b.width).toBeGreaterThan(b.height);
  });
});
