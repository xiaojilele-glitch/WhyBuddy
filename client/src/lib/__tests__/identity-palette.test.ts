/**
 * 身份色板派生。断言钉的是**换掉 8 套手挑主题所要换来的那几样保证**，
 * 不是具体色值——色值会随 MCU 升级微动，保证不能动。
 */
import { describe, expect, it } from "vitest";

import {
  FALLBACK_SEED,
  deriveIdentityPalette,
  fallbackIdentityPalette,
  parseHexToArgb,
} from "../identity-palette";
import { Hct } from "../mcu/hct/hct";

/** 原来 8 套预设的主色，用来跟手挑那版对照 */
const OLD_SEEDS = {
  azure: "#1677ff",
  forest: "#2e7d32",
  graphite: "#525252",
  tangerine: "#e05d38",
  violet: "#7033ff",
  amber: "#d97706",
  clay: "#c96442",
  indigo: "#6366f1",
};

const hctOf = (hex: string) => {
  const argb = parseHexToArgb(hex)!;
  return Hct.fromInt(argb);
};

describe("deriveIdentityPalette", () => {
  it("主色原样保留——那是 LLM 为这个应用选的身份色，算法不许改掉它", () => {
    for (const seed of Object.values(OLD_SEEDS)) {
      expect(deriveIdentityPalette(seed).primary.toLowerCase()).toBe(seed.toLowerCase());
    }
  });

  it("确定性：同一个种子色永远出同一套色板", () => {
    const a = deriveIdentityPalette("#2e7d32");
    const b = deriveIdentityPalette("#2e7d32");
    expect(a).toEqual(b);
  });

  it("中性色带主色的色相——这是换掉手挑灰的全部理由", () => {
    // scheme_cmf.ts: neutralPalette = fromHueAndChroma(h, c * 0.2)
    // 绿色应用的灰该偏绿、橘色应用的灰该偏暖。手挑的 #f0f2f5 对每套都一样，
    // 那才是"显脏"的来源。
    for (const seed of [OLD_SEEDS.forest, OLD_SEEDS.tangerine, OLD_SEEDS.violet]) {
      const p = deriveIdentityPalette(seed);
      const seedHue = hctOf(seed).hue;
      const bgHue = hctOf(p.contentBg).hue;
      const diff = Math.min(Math.abs(bgHue - seedHue), 360 - Math.abs(bgHue - seedHue));
      expect(diff, `${seed} 的内容底色相偏离主色 ${diff.toFixed(0)}°`).toBeLessThan(25);
    }
  });

  it("中性色确实是「中性」——彩度被压下来，不是又一块主色", () => {
    // 两条分开断言。**不能只用比例**：graphite #525252 自己彩度就只有 1.46，
    // 而 tone 97 接近纯白，HctSolver 反解到 8bit sRGB 时的量化噪声本身就有
    // ~1 的量级——对这种近中性种子色，比例断言量的是舍入误差不是色板行为
    // （第一版就是这么挂的）。
    for (const seed of Object.values(OLD_SEEDS)) {
      const p = deriveIdentityPalette(seed);
      const bgChroma = hctOf(p.contentBg).chroma;
      const seedChroma = hctOf(seed).chroma;
      // 直接断言规则本身：neutralPalette 请求的是 chroma × 0.2，实得应当贴着
      // 这个值（+3 是给 HctSolver 反解到 8bit sRGB 的余量——tone 97 接近纯白
      // 时量化噪声本身就有 ~1 的量级）。
      //
      // 前两版断言都写歪了，记下来免得再犯：先写成 `< seedChroma * 0.45`，
      // 对 graphite（自身彩度仅 1.46）等于在量舍入误差；改成绝对上界 8，
      // 又比规则本身还紧——forest 彩度 44，×0.2 = 8.8 本来就该超过 8。
      expect(
        bgChroma,
        `${seed}: 内容底彩度 ${bgChroma.toFixed(2)}，规则要求 ≈${(seedChroma * 0.2).toFixed(2)}`
      ).toBeLessThan(seedChroma * 0.2 + 3);
    }
  });

  it("侧栏是白的、侧栏文字是深的，且明度差拉得开", () => {
    // 2026-08-03（用户裁决，参照 Ant Design Pro）：菜单与 Header 改成白底。
    // 方向反过来了，但**要守的东西没变**——明度差必须够大，否则菜单文字
    // 在自己的底色上读不出来。深浅只是取向，可读性不是。
    for (const seed of Object.values(OLD_SEEDS)) {
      const p = deriveIdentityPalette(seed);
      const bg = hctOf(p.sidebarBg).tone;
      const fg = hctOf(p.sidebarText).tone;
      expect(bg).toBeGreaterThan(95);
      expect(fg).toBeLessThan(45);
      expect(bg - fg, `${seed} 侧栏明度差只有 ${(bg - fg).toFixed(0)}`).toBeGreaterThan(50);
    }
  });

  it("白侧栏是真的白，不带任何色相偏移", () => {
    // 中性色系在 tone 100 与色相无关，出的必须是纯 #ffffff——参照图那种
    // 干净的白底菜单，带一点色相就会显脏（尤其跟纯白的内容卡片并排时）。
    for (const seed of Object.values(OLD_SEEDS)) {
      expect(deriveIdentityPalette(seed).sidebarBg.toLowerCase()).toBe("#ffffff");
    }
  });

  it("强调浅底够浅、其上的文字够深——手挑那版没有这条保证", () => {
    for (const seed of Object.values(OLD_SEEDS)) {
      const p = deriveIdentityPalette(seed);
      const bg = hctOf(p.accentBg).tone;
      const fg = hctOf(p.accentFg).tone;
      expect(bg).toBeGreaterThan(85);
      expect(bg - fg).toBeGreaterThan(45);
    }
  });

  it("主色上的前景按 tone 选黑白，深色主色配白字", () => {
    // graphite #525252 tone 约 35 → 白字；amber #d97706 tone 约 60+ → 深字
    expect(deriveIdentityPalette(OLD_SEEDS.graphite).primaryFg).toBe("#ffffff");
    expect(deriveIdentityPalette(OLD_SEEDS.azure).primaryFg).toBe("#ffffff");
  });

  it("hover 往更深走，不往浅走——变浅在浅底上会被当成失效态", () => {
    for (const seed of Object.values(OLD_SEEDS)) {
      const p = deriveIdentityPalette(seed);
      expect(hctOf(p.primaryHover).tone).toBeLessThan(hctOf(seed).tone);
    }
  });

  it("图表色第一条必须是主色本身——否则色板合规的 R2「主色在场」最容易被触发", () => {
    for (const seed of Object.values(OLD_SEEDS)) {
      expect(deriveIdentityPalette(seed).charts[0].toLowerCase()).toBe(seed.toLowerCase());
    }
  });

  it("图表分类色彼此可辨：相邻两条的色相差都拉开了", () => {
    const p = deriveIdentityPalette(OLD_SEEDS.forest);
    expect(p.charts.length).toBeGreaterThanOrEqual(5);
    const hues = p.charts.map(c => hctOf(c).hue);
    for (let i = 1; i < hues.length; i++) {
      const d = Math.min(Math.abs(hues[i] - hues[i - 1]), 360 - Math.abs(hues[i] - hues[i - 1]));
      expect(d, `第 ${i} 条与前一条只差 ${d.toFixed(0)}°`).toBeGreaterThan(20);
    }
  });

  // ── 参照图取到的图表色（2026-08-04）─────────────────────────────
  //
  // 每个应用都会生成一张参照图，此前只被用来学版式、配色画完就丢；图表色另走
  // 账本 8 套预置色序按应用名散列挑一套，而那 8 套是同一条 ramp 的 8 个旋转
  // ——不同应用摆在一起仍然是同一串珠子从不同位置起数（用户实测三个不同业务
  // 的应用"图表的颜色是一样的"）。这一组断言钉住那条被接回来的线。

  it("参照图取到的色**原样**用上，不被算法改掉", () => {
    const fromSheet = ["#c0392b", "#16a085", "#8e44ad", "#f39c12", "#2980b9"];
    const p = deriveIdentityPalette(OLD_SEEDS.azure, { extractedCharts: fromSheet });
    expect(p.charts).toEqual(fromSheet);
  });

  it("优先级高于账本色序——同一个 key 给不给取色结果不一样", () => {
    const fromSheet = ["#c0392b", "#16a085", "#8e44ad", "#f39c12"];
    const ledger = deriveIdentityPalette(OLD_SEEDS.azure, { chartVariantKey: "宠护提醒" });
    const sheet = deriveIdentityPalette(OLD_SEEDS.azure, {
      chartVariantKey: "宠护提醒",
      extractedCharts: fromSheet,
    });
    expect(sheet.charts).toEqual(fromSheet);
    expect(sheet.charts).not.toEqual(ledger.charts);
  });

  it("读者分不开的一套整套不要，回落账本——不勉强留半套", () => {
    // 生图模型很常见的"高级灰蓝紫"：好看，但相邻两色 ΔE 过不了常人视力底线。
    // 好看但读不出来的图表比朴素的图表更糟。
    const prettyButUnreadable = ["#6b7fd7", "#7183d4", "#6f86dd", "#7480d0"];
    const p = deriveIdentityPalette(OLD_SEEDS.azure, {
      chartVariantKey: "某应用",
      extractedCharts: prettyButUnreadable,
    });
    expect(p.charts).toEqual(deriveIdentityPalette(OLD_SEEDS.azure, { chartVariantKey: "某应用" }).charts);
  });

  it("形状不可信的输入一律回落，不抛错", () => {
    // 这个字段经由**存量快照**和库里的老应用记录到达前端，那些数据没走过
    // 这一版的门禁——渲染器内部必须自己再验一遍。
    const base = deriveIdentityPalette(OLD_SEEDS.azure, { chartVariantKey: "k" }).charts;
    for (const bad of [
      undefined,
      null,
      "#1677ff",
      [],
      ["#1677ff", "#52c41a"], // 数量不够
      ["#1677ff", "#52c41a", "#fa8c16", "红色"], // 混了非 hex
      ["#1677ff", "#52c41a", "#fa8c16", "#1677ff"], // 有重复
      [1, 2, 3, 4],
    ]) {
      const p = deriveIdentityPalette(OLD_SEEDS.azure, {
        chartVariantKey: "k",
        extractedCharts: bad,
      });
      expect(p.charts, `脏输入 ${JSON.stringify(bad)} 没有回落`).toEqual(base);
    }
  });

  it("种子色不合法一律落兜底，不抛错（这条链路是 fail-open）", () => {
    for (const bad of ["", "  ", "#12", "not-a-color", "#gggggg", "#11223344"]) {
      const p = deriveIdentityPalette(bad);
      expect(p.primary.toLowerCase()).toBe(FALLBACK_SEED.toLowerCase());
    }
  });

  it("兜底走同一条派生管道，出的是完整 12 个字段", () => {
    const f = fallbackIdentityPalette();
    expect(f.primary.toLowerCase()).toBe(FALLBACK_SEED.toLowerCase());
    for (const k of [
      "primaryHover", "gradTo", "primaryFg", "contentBg",
      "accentBg", "accentFg", "sidebarBg", "sidebarText",
    ] as const) {
      expect(f[k], `兜底缺 ${k}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(f.charts.length).toBeGreaterThanOrEqual(5);
  });

  it("#rgb 短写与 #rrggbb 等价", () => {
    expect(deriveIdentityPalette("#0af")).toEqual(
      expect.objectContaining({ primary: "#00aaff" })
    );
  });
});
