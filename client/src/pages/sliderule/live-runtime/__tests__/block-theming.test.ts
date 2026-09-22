/**
 * 区块样式必须跟随应用的身份主题（2026-08-11）。
 *
 * ## 这条护栏是怎么来的
 *
 * 用户在线上翻了几把生成出来的应用，反馈"区块样式要逐个审视一遍"。第一轮扫出来
 * 的最大一类是**硬编码颜色**：block-registry 里有 84 处 `#rrggbb` 字面量，而主题
 * 令牌（`theme.useToken()`）只用了 5 处。
 *
 * 这里要分清两种，**不是所有硬编码都是错的**：
 *
 *   语义色  成功绿 #52c41a / 危险红 #ff4d4f / 警告黄 #faad14 …
 *           —— 写死是**对的**。"失败"在任何品牌下都该是红的，跟着主色走反而错。
 *   品牌色  #1677ff（antd 的默认主色）
 *           —— 写死是**错的**。生成的应用每套身份主题主色都不同（咖啡那套是
 *              #3F7656），而 AppRuntimeScreen 已经把它灌进 ConfigProvider 的
 *              `colorPrimary`，antd 组件都跟得上，只有这些字面量跟不上。
 *              表现是：换了主题，这些区块还是 antd 蓝，跟整页格格不入。
 *
 * ## 为什么只盯 #1677ff
 *
 * 它是**唯一**能机械判定的那个：等于 antd 默认主色，就说明作者想表达"主色"，
 * 而不是某个语义。别的十六进制值判不出意图，硬拦只会逼人写 eslint-disable。
 *
 * ## 允许的例外：兜底
 *
 * `chartPalette?.primary ?? "#1677ff"` 这种是对的——宿主传了调色板就用调色板，
 * 没传（比如某些预览路径）才回落。判据因此是"这一处**附近**有没有 palette 来源"，
 * 而不是"文件里不许出现这个串"。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const registry = readFileSync(
  new URL("../block-registry.tsx", import.meta.url),
  "utf8"
).replace(/\r\n?/g, "\n");

/** antd v5 的默认主色。出现它 = 作者想表达"主色"。 */
const ANTD_DEFAULT_PRIMARY = "#1677ff";

describe("区块颜色跟随身份主题", () => {
  it("品牌色不许无兜底地硬编码 —— 换了主题它就跟整页脱节", () => {
    const offenders: string[] = [];
    registry.split("\n").forEach((line, i) => {
      if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
      let at = line.indexOf(ANTD_DEFAULT_PRIMARY);
      while (at !== -1) {
        // 判据：同一行、这一处**之前**要能看到调色板来源（?? / || 兜底），
        // 或者整行在给 categorical 兜底
        const before = line.slice(Math.max(0, at - 90), at);
        const guarded =
          /chartPalette|palette\?|categorical/.test(before) ||
          /categorical/.test(line) ||
          // `multiSeriesChart(...)` 的 defs 里的颜色**按构造就是兜底**：工厂
          // 逐条序列都先取调色板（`i===0 ? chartPalette.primary :
          // chartPalette.categorical[i]`），取不到才回落到这里写的字面量。
          // 所以这不是判据上的洞——放过的是工厂已经接管了的那批。
          /multiSeriesChart\(/.test(line);
        if (!guarded) offenders.push(`第 ${i + 1} 行: …${line.slice(Math.max(0, at - 60), at + 8).trim()}`);
        at = line.indexOf(ANTD_DEFAULT_PRIMARY, at + 1);
      }
    });
    expect(
      offenders,
      "这些地方把 antd 默认主色写死了，生成的应用换一套身份主题就会露馅——\n" +
        "改成 `theme.useToken().token.colorPrimary`（UI 强调色）或 " +
        "`chartPalette?.primary ?? …`（图表序列色）：\n" +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("语义色照旧允许写死 —— 这条判据不许扩大化", () => {
    // 反向断言：成功/危险这类仍然应当以字面量存在。哪天有人"顺手统一"
    // 把它们也改成主色，红色的失败态会变成品牌色，这条会红。
    for (const semantic of ["#52c41a", "#ff4d4f"]) {
      expect(
        registry.includes(semantic),
        `${semantic} 这类语义色不该被一起改掉——失败在任何品牌下都该是红的`
      ).toBe(true);
    }
  });

  it("宿主真的把身份主题灌进了 ConfigProvider —— 否则上面两条都是空谈", () => {
    const screen = readFileSync(
      new URL("../AppRuntimeScreen.tsx", import.meta.url),
      "utf8"
    ).replace(/\r\n?/g, "\n");
    expect(screen).toContain("colorPrimary: identityTheme.primary");
    // 图表那条通道也要在：区块用的 chartPalette 就是从这儿来的
    expect(screen).toMatch(/chartPalette:\s*\{/);
  });
});
