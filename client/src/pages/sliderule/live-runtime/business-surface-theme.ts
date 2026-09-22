/**
 * 业务表面的中性色（墨色 + 面）单一真相源。
 *
 * ## 收口之前是什么样（2026-08-11）
 *
 * 「次要文字」这一个角色，仓库里同时有**四套**说法：
 *
 *     PageViews.tsx            读本文件的令牌            ✓ 跟主题变
 *     AppRuntimeScreen.tsx     自己写死 #595959/#262626/#bfbfbf   ✗
 *     build-echarts-option.ts  同样写死一份              ✗
 *     block-registry.tsx       一次都没用令牌，混了 antd 灰 + Tailwind 石板灰  ✗
 *
 * `INK` 这个名字被**定义了三遍、一份都没导出**，而且已经漂了：写死版
 * `faint = #bfbfbf`，令牌版 `faint = #8c8c8c` —— 不是同一个颜色。所以"次要
 * 文字"在不同区块里是不同的灰，并排放能看出来（石板灰偏冷、antd 灰偏中性，
 * 色相本来就不一样）。
 *
 * 更要紧的是**深色配方下会看不见**：6 套设计配方里有 1 套是深色
 * （design-recipes.ts 的 `dark: true`），而 ConfigProvider 开了 `cssVar: true`
 * ——令牌那套会跟着 darkAlgorithm 翻过来，写死的十六进制不会。页头把近黑
 * （#0f172a，亮度 23）当正文色写死，深色底上就是一片看不见的字。
 *
 * ## 两种形态，一份定义
 *
 * DOM 和 canvas 吃不了同一种值：
 *
 *   · 内联样式（`style={{ color }}`）能吃 `var(--ant-color-text, #262626)`
 *     ——浏览器解析，主题换了自动跟。
 *   · **ECharts 的 option 不能**。图表画在 canvas 上，`var(...)` 对它只是一个
 *     认不出的字符串，颜色会直接失效。那边只能拿字面量。
 *
 * 所以下面从**同一张表**派生出两份：`INK`（带 var 的，给 DOM）和 `INK_HEX`
 * （纯字面量，给 canvas）。派生而不是各写一遍，就是为了不再出现上面那种
 * "同名不同色"。
 */
import type { CSSProperties } from "react";

/**
 * 墨色四级：`[antd token 名, 亮色主题下的字面量]`。
 *
 * 四级而不是三级——原来的三级里 `faint` 一个名字挂了两个角色：
 *
 *   · 令牌版指的是 **tertiary**（#8c8c8c，antd `Typography type="secondary"` 那档）
 *   · 写死版指的是 **quaternary**（#bfbfbf，antd 用来画 disabled / 占位符的那档）
 *
 * 收口时把后者单独取名 `ghost`，因为它们的用途真的不同：#bfbfbf 对白底只有
 * 约 2.3:1 的对比度，WCAG AA 要 4.5:1、连大字号的 3:1 都不到，**不该拿去写
 * 11px 的提示文字**（收口前 AppRuntimeScreen 有十来处这么用）。它适合的是
 * 分割线、饼图引导线这类"不是字"的地方。
 */
const INK_SCALE = {
  /** 正文/标题 */
  value: ["color-text", "#262626"],
  /** 字段名、说明这类次要文字 */
  label: ["color-text-secondary", "#595959"],
  /** 提示、空态、辅助说明——**能读得清的最浅一档** */
  faint: ["color-text-tertiary", "#8c8c8c"],
  /** 不是字的地方：引导线、极弱分隔。拿它写正文属于误用（见上） */
  ghost: ["color-text-quaternary", "#bfbfbf"],
} as const satisfies Record<string, readonly [string, string]>;

type InkLevel = keyof typeof INK_SCALE;

const inkVar = ([token, hex]: readonly [string, string]) =>
  `var(--ant-${token}, ${hex})`;

/** 墨色（DOM 用）。跟着 antd 主题走，深色算法下自动翻过来。 */
export const INK = Object.freeze(
  Object.fromEntries(
    Object.entries(INK_SCALE).map(([level, pair]) => [level, inkVar(pair)])
  )
) as Readonly<Record<InkLevel, string>>;

/**
 * 同一套墨色的纯字面量形态。**只给吃不了 CSS 变量的地方用**（ECharts option
 * 里的 textStyle/axisLabel/label 等等，画在 canvas 上）。
 *
 * 代价要说清：这一份**不跟深色主题变**。图表在深色配方下文字偏暗是已知的、
 * 尚未解决的问题——真正的治法是把 token 在 JS 侧解析出来喂给 ECharts
 * （`theme.useToken()` 的值传进 option），不是在这里堆第二套字面量。
 */
export const INK_HEX = Object.freeze(
  Object.fromEntries(
    Object.entries(INK_SCALE).map(([level, [, hex]]) => [level, hex])
  )
) as Readonly<Record<InkLevel, string>>;

/** 面色与线色。同 INK 的理由，也从令牌走。 */
export const BUSINESS_FILL_COLOR = "var(--ant-color-fill-tertiary, #f5f5f5)";
export const BUSINESS_BORDER_COLOR = "var(--ant-color-border, #d9d9d9)";
export const BUSINESS_SPLIT_COLOR =
  "var(--ant-color-border-secondary, #f0f0f0)";

export const BUSINESS_SURFACE_STYLE: CSSProperties = {
  background: "var(--ant-color-bg-container, #ffffff)",
  borderColor: BUSINESS_SPLIT_COLOR,
  color: INK.value,
};

export const BUSINESS_MUTED_SURFACE_STYLE: CSSProperties = {
  ...BUSINESS_SURFACE_STYLE,
  background: "var(--ant-color-fill-quaternary, #fafafa)",
  color: INK.label,
};

// 旧名保留：调用点不少，而且 BUSINESS_TEXT_COLOR 这个名字在语义上没错。
// 但**只是 INK 的别名**，不再是第二份定义——这才是"单一真相源"的意思。
export const BUSINESS_TEXT_COLOR = INK.value;
export const BUSINESS_SECONDARY_TEXT_COLOR = INK.label;
export const BUSINESS_TERTIARY_TEXT_COLOR = INK.faint;

/**
 * 区块内嵌图表的轴标签字号。
 *
 * 收口前是 9 / 10 两个值散在七处（甘特、热力图、箱线、雷达、直方图）。9px
 * 已经小到影响辨认，统一提到 10：这批图表本来就密，再往上（页面级图表用的
 * 是 11）overlap 风险明显变大，所以取"能读 + 不改版"的那一档。
 *
 * 页面级图表（build-echarts-option.ts）保持 11 不动——那是整卡尺寸的图，
 * 跟塞在区块里的密集小图不是一个排版环境，硬拉成同一个数字没有道理。
 */
export const BLOCK_CHART_AXIS_FONT_SIZE = 10;
