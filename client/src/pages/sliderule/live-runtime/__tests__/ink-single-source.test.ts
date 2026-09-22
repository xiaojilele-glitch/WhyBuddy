/**
 * 中性色只有一个真相源（2026-08-11）。
 *
 * ## 收口之前
 *
 * 「次要文字」这一个角色，仓库里四套说法并存，`INK` 这个名字**定义了三遍、
 * 一份都没导出**，而且已经漂成两个颜色（写死版 faint = #bfbfbf，令牌版
 * faint = #8c8c8c）。区块里还混着两套灰：antd 的中性灰 + Tailwind 的石板灰
 * （#94a3b8 / #64748b / #0f172a），色相不一样，并排放看得出来。
 *
 * 最硬的那条后果是**深色配方下看不见字**：6 套设计配方里有 1 套深色，
 * ConfigProvider 开了 cssVar 所以令牌会跟着 darkAlgorithm 翻，写死的十六进制
 * 不会——页头把 #0f172a（亮度 23）当正文色写死，深色底上就是一片看不见的字。
 *
 * ## 这里锁三件事
 *
 * ① 墨色只在 business-surface-theme.ts 定义，别处不许再立一份
 * ② DOM 用的 `INK` 与 canvas 用的 `INK_HEX` 必须同源（同键、同兜底值）
 * ③ block-registry 里不许再出现中性灰字面量——**语义色和状态色除外**，
 *    那些写死是对的，见下面的清单和理由
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BLOCK_CHART_AXIS_FONT_SIZE,
  BUSINESS_SECONDARY_TEXT_COLOR,
  BUSINESS_TERTIARY_TEXT_COLOR,
  BUSINESS_TEXT_COLOR,
  INK,
  INK_HEX,
} from "../business-surface-theme";

const read = (name: string) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replace(
    /\r\n?/g,
    "\n"
  );

/** 会用到墨色的那几个文件。 */
const FILES = [
  "block-registry.tsx",
  "AppRuntimeScreen.tsx",
  "PageViews.tsx",
  "build-echarts-option.ts",
  "business-surface-theme.ts",
] as const;

describe("墨色单一真相源", () => {
  it("只有 business-surface-theme 定义墨色，别处不许再立一份", () => {
    // 判据是"有没有**写死颜色**"，不是"有没有叫 INK 的局部常量"。
    // build-echarts-option 里就留着一个 `const INK = { … INK_HEX.label … }`——
    // 那是别名（canvas 只能吃字面量，见那个文件的注释），不是第二份定义。
    // 真要拦的是重新出现 `const INK = { label: "#595959", … }` 那种。
    const offenders = FILES.filter(f => {
      if (f === "business-surface-theme.ts") return false;
      const decl = read(f).match(/^const INK\b[^;]*;/m)?.[0] ?? "";
      return /#[0-9a-fA-F]{6}/.test(decl);
    });
    expect(
      offenders,
      "这些文件又把墨色写死了一份——三份并存那次就是这么漂出两个 faint 的：\n" +
        offenders.join("\n")
    ).toEqual([]);
    // 反向：真相源那边必须真的有一份，否则上面是在证明"谁都没定义"
    expect(read("business-surface-theme.ts")).toMatch(/^const INK_SCALE\b/m);
  });

  it("DOM 那份和 canvas 那份同源：同键，且 var() 的兜底就是 hex 那份", () => {
    expect(Object.keys(INK)).toEqual(Object.keys(INK_HEX));
    for (const level of Object.keys(INK) as Array<keyof typeof INK>) {
      // `var(--ant-color-text, #262626)` 里的兜底必须等于 INK_HEX.value
      expect(INK[level], `${level} 的 var() 兜底跟 INK_HEX 不一致`).toContain(
        `, ${INK_HEX[level]})`
      );
      expect(INK[level]).toMatch(/^var\(--ant-color-text/);
    }
  });

  it("faint 是能读清的那一档，ghost 才是最浅的 —— 这次收口的核心", () => {
    // 收口前 faint 一个名字挂了两个角色：令牌版 #8c8c8c、写死版 #bfbfbf。
    // #bfbfbf 对白底约 2.3:1，连 WCAG AA 大字号的 3:1 都不到，不该写正文。
    expect(INK_HEX.faint).toBe("#8c8c8c");
    expect(INK_HEX.ghost).toBe("#bfbfbf");
    expect(INK_HEX.faint).not.toBe(INK_HEX.ghost);
  });

  it("旧名只是别名，不是第二份定义", () => {
    expect(BUSINESS_TEXT_COLOR).toBe(INK.value);
    expect(BUSINESS_SECONDARY_TEXT_COLOR).toBe(INK.label);
    expect(BUSINESS_TERTIARY_TEXT_COLOR).toBe(INK.faint);
  });
});

/**
 * 允许在区块里写死的十六进制。**判据是"这个颜色表达的是语义还是中性"**：
 *
 *   语义/状态色  成功绿、危险红、警告黄、gold、以及状态映射表里跟它们并列的
 *                中性档（`unknown` / `paused` / `flat`）。这些跟着主色走反而错：
 *                "失败"在任何品牌下都该是红的；而"未知"作为一档**状态**，语义
 *                是"跟其它状态并列的灰"，不是"次要文字"。
 *   分类色       图表序列色（#722ed1 / #13c2c2 / #eb2f96 …）与背景浅色调
 *                （#f6ffed / #f0f5ff），按序取用，不是墨色。
 *   品牌色       #1677ff 单独由 block-theming.test.ts 管（必须有调色板兜底）。
 */
const SEMANTIC_HEX = new Set([
  "#52c41a", "#3f8600", "#389e0d", "#5b8c00", // 成功/正向
  "#ff4d4f", "#cf1322", // 危险
  "#faad14", "#d48806", // 警告/gold
  "#722ed1", "#13c2c2", "#eb2f96", "#5b6cff", // 分类序列
  "#f6ffed", "#f0f5ff", "#e6f4ff", // 语义浅底
  "#1677ff", // 品牌色，另有专门的护栏
]);

/** 状态映射表里那几档中性色：跟状态色并列出现，不是墨色。 */
const NEUTRAL_IN_STATUS_MAPS = new Set(["#8c8c8c", "#d9d9d9"]);

describe("区块里不许再混硬编码中性灰", () => {
  it("Tailwind 石板灰一处都不许留 —— 它跟 antd 灰色相不同，并排能看出来", () => {
    const registry = read("block-registry.tsx");
    for (const slate of ["#0f172a", "#64748b", "#94a3b8", "#334155", "#cbd5e1"]) {
      const lines = registry
        .split("\n")
        .map((l, i) => [l, i + 1] as const)
        .filter(
          ([l]) =>
            !l.trimStart().startsWith("*") &&
            !l.trimStart().startsWith("//") &&
            l.includes(slate)
        );
      expect(
        lines.map(([, n]) => n),
        `${slate} 是 Tailwind 石板灰，换成 INK / BUSINESS_* 令牌`
      ).toEqual([]);
    }
  });

  it("剩下的十六进制必须都能说出理由（语义色 / 状态档 / 分类色）", () => {
    const registry = read("block-registry.tsx");
    const unexplained: string[] = [];
    const lines = registry.split("\n");
    lines.forEach((line, i) => {
      const t = line.trimStart();
      if (t.startsWith("*") || t.startsWith("//")) return;
      for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
        const hex = m[0].toLowerCase();
        if (SEMANTIC_HEX.has(hex)) continue;
        // 中性档只在状态/序列映射里放行：那种行上一定还有别的语义色作伴
        if (NEUTRAL_IN_STATUS_MAPS.has(hex)) {
          // 映射表可能是多行的（TREND_COLORS 就是 up/down/flat 各一行），
          // 所以看前后几行有没有语义色作伴，而不是只看本行。
          const near = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
          const hasSemanticNeighbour = [...near.matchAll(/#[0-9a-fA-F]{6}\b/g)]
            .map(x => x[0].toLowerCase())
            .some(h => SEMANTIC_HEX.has(h));
          if (hasSemanticNeighbour) continue;
        }
        unexplained.push(`第 ${i + 1} 行 ${hex}: ${t.slice(0, 90)}`);
      }
    });
    expect(
      unexplained,
      "这些颜色既不是语义色也不在状态映射里 —— 中性色请用 INK / " +
        "BUSINESS_FILL_COLOR / BUSINESS_SPLIT_COLOR：\n" + unexplained.join("\n")
    ).toEqual([]);
  });

  it("语义色照旧写死 —— 这条判据不许扩大化", () => {
    // 反向断言：哪天有人"顺手把灰都换成令牌"时连红绿一起换掉，这条会红。
    const registry = read("block-registry.tsx");
    for (const semantic of ["#52c41a", "#ff4d4f", "#faad14"]) {
      expect(
        registry.includes(semantic),
        `${semantic} 是语义色，不该被一起换成墨色令牌`
      ).toBe(true);
    }
  });
});

describe("字号", () => {
  it("不许再出现半像素字号", () => {
    for (const f of FILES) {
      expect(read(f), `${f} 里有 fontSize: 12.5 这类半像素值`).not.toMatch(
        /fontSize:\s*\d+\.\d/
      );
    }
  });

  it("区块内嵌图表的轴标签走同一个字号常量，且不小于 10", () => {
    const registry = read("block-registry.tsx");
    // 9px 原来散在 7 处（甘特/热力/箱线/雷达/直方图），都是密集小图的轴标签
    expect(registry).not.toMatch(/(axisLabel|axisName):\s*\{\s*fontSize:\s*9\b/);
    expect(
      (registry.match(/fontSize: BLOCK_CHART_AXIS_FONT_SIZE/g) ?? []).length,
      "轴标签字号应当全部走常量"
    ).toBeGreaterThanOrEqual(7);
    expect(BLOCK_CHART_AXIS_FONT_SIZE).toBeGreaterThanOrEqual(10);
  });
});
