/**
 * identity-themes — 应用身份段的颜色解析。
 *
 * ## 现在的规则：全站一个颜色（2026-08-03，用户裁决）
 *
 * 所有生成应用共用 BRAND_SEED 派生的同一套色板，菜单与 Header 是白的。
 * 主色只出现在选中态、按钮、图表这些该被看见的地方——Ant Design Pro 那种形态。
 *
 * ## 走到这一步的路径
 *
 * 最早是 8 套手写死的 token（96 个手挑色值）。2026-07-30 改成"LLM 选一个
 * 种子色 + MCU 的 HCT 算法派生其余 11 个字段"，手工色值降到 1 个——算法
 * 那部分是好的，保留至今（见 lib/identity-palette）。
 *
 * 换掉的是**种子色的来源**：为了让 LLM 选这一个色值，链路上要先花 ~74s
 * 生一张参照图再喂给视觉模型取色，而那张图从不展示给任何人。用一次生图
 * 换一个色值，是整条链路上性价比最低的一步，已整段移除。
 *
 * appbundle.appIdentity.theme 那个 8 选 1 的分类字段仍然存在、仍然被
 * gate/repair 校验——那是分类标签，从 2026-07-30 起就不是颜色来源了。
 */

import legalDomains from "@legal";
import themePresets from "@identity-themes";

import { deriveIdentityPalette, type IdentityPalette } from "@/lib/identity-palette";

/**
 * 全站唯一的品牌种子色，与 Python 同读 identity_theme_presets.json。
 *
 * **不在这里写死。** Python 用同一个值拼生成提示词里的"运行时已经按这套
 * 渲染了"那句色板事实；两边各写一份的话，提示词说的颜色和实际渲染的颜色
 * 会悄悄分叉，而这种分叉只有肉眼比对才看得出来。
 *
 * 只有这一个色值是手挑的，其余 11 个字段全部由 MCU 的 HCT 算法派生
 * （见 lib/identity-palette）。
 */
const BRAND_SEED: string = themePresets.brandSeed.seed;
const BRAND_LABEL: string = themePresets.brandSeed.label;

export type IdentityTheme = IdentityPalette;

/** 8 选 1 分类字段的合法域（@legal identityThemes）——仍然是 gate 校验的
 * 合法值集合，颜色解析不再读它，只在别处（生成契约/门/修复器）继续使用。 */
export const LEGAL_THEME_IDS: readonly string[] = legalDomains.identityThemes;

/**
 * 存量数据里的 generatedTheme 形状。
 *
 * 2026-08-03 起不再生成、也不再被读取（颜色统一走 BRAND_SEED），但库里
 * 还有历史应用带着这个字段。类型留着是为了那些地方读到时仍有形状可依，
 * 不是活跃契约。
 */
export type GeneratedIdentityTheme = { label?: unknown; seed?: unknown };

/**
 * 解析主题：**全站一个颜色**（2026-08-03，用户裁决）。
 *
 * ## 之前是什么样、为什么改
 *
 * 每个应用由 LLM 单独选一个种子色。为了选这一个色值，链路上要先花 ~74s
 * 生一张参照图、再喂给视觉 LLM 取色——那张图从不展示给任何人。整条链路
 * 上性价比最低的一步，已经整段移除（见 Python 侧 identity_theme_gen）。
 *
 * 现在所有生成应用共用 BRAND_SEED 派生的同一套色板。菜单与 Header 是白的
 * （见 identity-palette 的 TONE.sidebarBg），主色只出现在选中态、按钮、
 * 图表这些该被看见的地方——Ant Design Pro 那种形态。
 *
 * ## 参数为什么还留着
 *
 * `themeId` 与 `generatedTheme` 都不再参与颜色决定，但签名保持不变：
 * 调用点有十几处，且**存量应用的库里仍然存着 generatedTheme 字段**。
 * 保留参数意味着老数据不需要迁移脚本——读进来直接被忽略，不会报错，
 * 也不会有半套新半套旧的中间态。
 */
export function resolveIdentityTheme(
  _themeId?: string,
  _generatedTheme?: unknown,
  /**
   * 图表配色的挑选键（2026-08-04）。传一个**每个应用稳定且互不相同**的值
   * （产品名 / appId 都行），这个应用就固定拿到账本里 8 套已验证色序中的一套。
   *
   * 只影响 charts 这一个字段——外壳（主色、菜单白、Header 白）仍然全站统一，
   * 那是另一条裁决管的事。不传就退回老行为，十几个调用点一个都不用改。
   */
  chartVariantKey?: string,
  /**
   * 这个应用参照图上读出来的图表色（2026-08-04，`appIdentity.chartColors`）。
   *
   * 验得过就直接用，chartVariantKey 那套账本色序退为兜底——账本那 8 套是同一条
   * ramp 的 8 个旋转，不同应用摆在一起仍然像同一套色；参照图那份才是**为这个
   * 应用画的**。校验在 identity-palette 里做（形状不可信，见那边的说明）。
   */
  extractedCharts?: unknown
): IdentityTheme {
  return deriveIdentityPalette(BRAND_SEED, {
    id: "brand",
    label: BRAND_LABEL,
    chartVariantKey,
    extractedCharts,
  });
}

/** 6 位十六进制转 rgba() 字符串——菜单 hover 态要跟主色调一层半透明叠色，
 * 不能像之前那样写死 rgba(255,255,255,0.08)：那个假设侧边栏永远是深色，
 * 生成主题给了浅色侧边栏时，hover 反馈基本看不见。非法输入原样返回，
 * 不抛错（调用方本来就该传合法 hex，这里只是防御）。 */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 身份主题 → antd-mobile 的 CSS 变量。
 *
 * 换肤机制两边不是一套：antd v5 走 cssinjs token（ConfigProvider theme），
 * antd-mobile 走 CSS 变量（--adm-*）。所以 ConfigProvider 配好主色，手机档
 * 那些 antd-mobile 组件一个字都吃不到——实测过：生成主题是 #C2410C，
 * adm 按钮实际背景仍是 rgb(22,119,255)，也就是 antd-mobile 自带的默认蓝。
 * 每个生成应用的手机档主色都跟应用主题不搭。
 *
 * 只覆盖跟品牌色相关的几个，中性色（text/border/background）留给
 * antd-mobile 自己 —— 那套是按移动端可读性调过的，没必要跟着主题乱动。
 */
export function admThemeVars(theme: IdentityTheme): Record<string, string> {
  return {
    "--adm-color-primary": theme.primary,
    // 主色上的前景（Button color=primary 的文字、Toast 图标等）
    "--adm-color-text-light-solid": theme.primaryFg,
    // 主色的浅色底（选中项浅底、Tag 底色）—— 用主题自己的强调底，
    // 不用 antd-mobile 默认那个跟蓝色配的 #e7f1ff
    "--adm-color-wathet": theme.accentBg,
    // 徽标底色。默认是 --adm-color-highlight（红），那是"未读/紧急"的语义；
    // 我们挂在 TabBar 上的是**本页行数**（这页有 12 条数据），不是告警。
    // 红色数字会让人以为有 12 件事待处理。桌面侧栏那版本来就用的主题色浅底，
    // 这里跟齐。官方定制入口就是这个变量（见 badge.css 的 --color 链）。
    "--adm-badge-color": theme.primary,
  };
}
