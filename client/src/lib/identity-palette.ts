/**
 * 身份色板派生：**一个种子色 → 完整的 12 个字段**（2026-07-30）。
 *
 * ## 这件事之前是怎么做的、为什么要换
 *
 * 之前 8 套预设主题的 12 个字段全是手挑的（8 × 12 = 96 个写死的十六进制），
 * 而生成主题那条路也只是"生图取一个主色、其余 11 个照手推的规则算"。两个问题：
 *
 *  1. **中性底色的色相是拍的**。`contentBg #f0f2f5` 这种灰在橘色主题里显脏，
 *     因为它本该带一点主色的色相。Radix 是靠人工调了 warm/cool 两套灰解决，
 *     我们连那个都没有。
 *  2. **一格对比度保证都没有**。深色侧栏上的文字、浅底上的强调色，能不能读
 *     全靠肉眼过。
 *
 * 现在改成：LLM 只给**一个种子色**（它读 prompt 里的行业与调性来定），
 * 其余全部由 MCU 的 HCT / TonalPalette 算出来。手工色值从 96 个降到 1 个
 * （FALLBACK_SEED，见下）。
 *
 * ## 派生规则抄自哪里
 *
 * material-color-utilities 的 `scheme/scheme_cmf.ts`（vendored 子集见 ./mcu）：
 *
 *     primaryPalette   = fromHueAndChroma(h, c)
 *     secondaryPalette = fromHueAndChroma(h, c * 0.5)
 *     tertiaryPalette  = fromHueAndChroma(h, c * 0.75)
 *     neutralPalette   = fromHueAndChroma(h, c * 0.2)   ← 关键那一行
 *
 * 最后一行是整件事的支点：**中性色用主色的色相、彩度压到两成**。绿色应用的
 * 灰会偏绿、橘色应用的灰会偏暖——这正是手挑灰永远挑不准的那个量。
 *
 * MCU 的 `scheme/*` 与 `dynamiccolor/*` 刻意没 vendor：那是 Material Design 3
 * 自己的角色命名（primaryContainer / onSurfaceVariant …），跟 antd 的 token
 * 命名对不上，硬套只会多一层翻译。这里只借"种子色 → 色阶"这块地基，
 * 角色映射按**我们自己的 12 个字段**在下面做。
 */

import themePresets from "@identity-themes";

import { Hct } from "./mcu/hct/hct";
import { TonalPalette } from "./mcu/palettes/tonal_palette";

/** 与 identity_theme_presets.json 的单套主题同形（消费方不用改）。 */
export interface IdentityPalette {
  id: string;
  label: string;
  primary: string;
  primaryHover: string;
  gradTo: string;
  primaryFg: string;
  contentBg: string;
  accentBg: string;
  accentFg: string;
  charts: string[];
  sidebarBg: string;
  sidebarText: string;
}

/**
 * 唯一一个手工色值。
 *
 * 为什么还留一个：整个体验层是 fail-open 的（ADR / 架构图：任一步失败静默降级，
 * **绝不拦闭环发布**）。生图挂了、视觉取色返回不合法、网关超时——这些时候必须
 * 还有东西可用。删掉最后的兜底等于把 fail-open 改成 fail-closed，那是另一个
 * 决定，不能顺手做掉。
 *
 * 但它**只是个种子色**，不是一套手写主题：兜底同样走下面这条派生管道，
 * 出来的 12 个字段跟正常路径同一套算法。手工定义的色值总数 = 1。
 *
 * 取值是中性偏蓝的石板灰——不带明显行业倾向，降级时不会让人误以为"这个应用
 * 的品牌色就是这个"。
 */
export const FALLBACK_SEED = "#5b6b7c";

/** tone 取值表。都在 0~100，light 档。 */
const TONE = {
  /** 强调浅底：主色系高 tone，够浅但仍看得出色相 */
  accentBg: 94,
  /** 强调浅底上的文字 */
  accentFg: 32,
  /** 内容区底色：中性色系接近白 */
  contentBg: 97,
  /**
   * 侧栏底色：**白**（2026-08-03，用户裁决，参照 Ant Design Pro）。
   *
   * 原来是 tone 22 的深色侧栏。改白之后菜单/Header 跟内容区连成一片，
   * 主色只出现在选中态、按钮、图表这些"该被看见"的地方——这也是
   * Ant Design Pro / 现代后台的通行做法。
   *
   * tone 100 出的是纯 #ffffff（中性色系在 tone 100 与色相无关）。
   */
  sidebarBg: 100,
  /**
   * 侧栏文字：深色。
   *
   * 不能跟着改成"底色的反色"由算法自动决定——`foregroundFor` 只在纯黑纯白
   * 之间二选一，那样菜单文字会是硬邦邦的 #1f1f1f。tone 30 的中性色带一点
   * 主色色相，跟 Header/内容区是同一家人。
   */
  sidebarText: 30,
} as const;

/**
 * 强调浅底/强调字的彩度打七折——2026-07-30 调轻：全彩度铺在 accentBg 这种
 * 大面积浅底上，视觉上比想要的"淡淡一层色"（类似半透明白叠加的水洗质感）
 * 重得多。压彩度而不是提 tone：tone 已经很高（94），再提就要撞 sRGB 色域
 * 边界被裁成一个数，压彩度才是真正让它"淡"下去的那一维。
 */
const ACCENT_CHROMA_SCALE = 0.7;

/**
 * 主色系上做 hover：往**更深**走一档。
 *
 * 不用"更浅"：浅色底上的按钮 hover 变浅会看起来像失效（disabled 的通行视觉
 * 就是变浅）。antd 自己的 colorPrimaryHover 也是往深走。
 *
 * 2026-07-30：深度从 -8/-18 调到 -6/-14——原幅度配上 8 套手挑主题那种偏
 * 克制的种子色还好，但种子色一旦选得稍微艳一点，hover/渐变跳深的这一步
 * 会把"重"感再放大一层，调轻一点更稳。
 */
const HOVER_TONE_DELTA = -6;
/** 渐变终点：再深一档 + 色相微旋，避免纯明度渐变显得脏 */
const GRAD_TONE_DELTA = -14;
const GRAD_HUE_SHIFT = 12;

/**
 * 图表分类色的色相旋转量。
 *
 * 分类色要**彼此可辨**，所以按色相环大跨度分开；但第一个必须是主色本身，
 * 否则图表跟应用的身份色脱节（这条是实测教训：色板合规校验 R2 就是在查
 * "主色用量不得少于任何其他色系"，图表不带主色最容易触发它）。
 *
 * 只旋色相不动 tone/chroma：同 tone 的分类色在一起才不会有"某一条特别跳"。
 *
 * 2026-07-30：tone 48→58（更亮）、彩度下限 36→22、封顶 48（原来没有上限，
 * 种子色本身彩度很高时图表色会跟着一路冲上去）——这一组是实测"整体偏重"
 * 反馈里权重最大的一块：6 块实色图表色块并排，视觉分量比其它字段都大，
 * 原来的下限 36 意味着哪怕种子色选得很克制，图表色也会被强行拉回高彩度。
 */
const CHART_HUE_SHIFTS = [0, 62, 145, 210, 285, 330];
const CHART_TONE = 58;
const CHART_CHROMA_FLOOR = 22;
const CHART_CHROMA_CEIL = 48;

/**
 * 已验证的图表色序（账本 chartThemes.variants，前后端同读一份）。
 *
 * 这些不是"配"出来的，是**验**出来的：8 个旋转逐个跑过 dataviz 的
 * validate_palette.js（白底），0 个 FAIL。顺序本身就是安全机制——相邻对的
 * 区分度按这个顺序验，重排等于作废。
 */
const CHART_VARIANTS: readonly (readonly string[])[] =
  (themePresets as { chartThemes?: { variants?: string[][] } }).chartThemes?.variants ?? [];

/**
 * 常人视力硬底线（OKLab 欧氏距离 ×100），与 dataviz 校验器、Python 侧
 * `services/sheet_palette.py` 同一个数。
 */
const NORMAL_VISION_FLOOR = 15;
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** sRGB hex → OKLab。Björn Ottosson 的原始矩阵，只为算距离，不做反向变换。 */
function oklab(hexColor: string): [number, number, number] | null {
  if (!HEX6.test(hexColor)) return null;
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const r = lin(parseInt(hexColor.slice(1, 3), 16) / 255);
  const g = lin(parseInt(hexColor.slice(3, 5), 16) / 255);
  const b = lin(parseInt(hexColor.slice(5, 7), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaE(a: string, b: string): number {
  const x = oklab(a);
  const y = oklab(b);
  if (!x || !y) return 0;
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * 参照图取来的图表色——**在这里再验一遍**（2026-08-04）。
 *
 * 写入侧（Python `sheet_palette`）已经把过一次关，为什么还要验：这个值会
 * 经由**存量快照**和库里的老应用记录到达前端，那些数据没走过这一版的门禁；
 * 跟 freeformContent / generatedTheme 是同一条"渲染器内部再校验"的纪律。
 *
 * 验的是同两条：全是合法 hex、**相邻两色拉得开**。后一条不能省——一组读者
 * 分不开的颜色画到图表上，比朴素但能读的配色更糟；不合格就整套不要，回落
 * 账本里那 8 套验过的。
 */
function validExtractedCharts(colors: unknown): string[] | null {
  if (!Array.isArray(colors) || colors.length < 4) return null;
  const list = colors.filter((c): c is string => typeof c === "string" && HEX6.test(c));
  if (list.length !== colors.length || new Set(list).size !== list.length) return null;
  for (let i = 0; i < list.length - 1; i += 1) {
    if (deltaE(list[i], list[i + 1]) < NORMAL_VISION_FLOOR) return null;
  }
  return list.map(c => c.toLowerCase());
}

/** 稳定散列（FNV-1a 32 位）：同一个 key 永远落到同一套，刷新不换色。 */
function variantIndex(key: string, count: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % count;
}

/**
 * 这个应用的 6 个图表色。
 *
 * 没给 key（或账本里没有色序）时退回**旧的色相旋转**算法——那套区分度不合格，
 * 但它是老行为，不能因为这次改动让没传 key 的调用点悄悄变色；要换的是那些
 * 明确传了 key 的地方。
 */
function chartsFor(
  key: string | undefined,
  argb: number,
  src: Hct,
  extracted?: unknown
): string[] {
  // ① 这个应用自己参照图上的颜色最优先（2026-08-04）。
  //    整条链路上只有它是**为这个应用画的**——账本那 8 套再验得过，也是同一条
  //    ramp 的 8 个旋转，不同应用摆在一起仍然像同一套色。
  const fromSheet = validExtractedCharts(extracted);
  if (fromSheet) return fromSheet;
  if (key && CHART_VARIANTS.length > 0) {
    return [...CHART_VARIANTS[variantIndex(key, CHART_VARIANTS.length)]];
  }
  return CHART_HUE_SHIFTS.map(shift =>
    shift === 0
      ? hex(argb) // 第一条必须是主色本身（见 CHART_HUE_SHIFTS 的说明）
      : hex(
          TonalPalette.fromHueAndChroma(
            (src.hue + shift) % 360,
            Math.min(Math.max(src.chroma, CHART_CHROMA_FLOOR), CHART_CHROMA_CEIL)
          ).tone(CHART_TONE)
        )
  );
}

const hex = (argb: number): string =>
  `#${(argb & 0x00ffffff).toString(16).padStart(6, "0")}`;

/**
 * 前景色选黑还是白。
 *
 * MCU 的 tone 本身就是感知亮度（L*），所以判据可以很简单：tone < 60 的底色
 * 上用白字。60 是 M3 的惯例分界，不是我拍的——它对应 sRGB 上大约 4.5:1 的
 * 对比度拐点。
 */
const foregroundFor = (tone: number): string => (tone < 60 ? "#ffffff" : "#1f1f1f");

export interface DeriveOptions {
  /** 主题 id（透传，不参与计算） */
  id?: string;
  /** 人看的标签（透传） */
  label?: string;
  /**
   * 图表配色的挑选键（2026-08-04）——**给什么值不重要，稳定就行**。
   *
   * 传了就从账本里那 8 套已验证色序中按稳定散列挑一套，同一个应用永远拿到
   * 同一套；不传就退回第 0 套（老行为，调用点不用改）。
   *
   * 选它当"每个应用不一样"的开关而不是重新算色相：色相旋转出来的那套过不了
   * 区分度校验（见 CHART_HUE_SHIFTS 上方说明），所以变化必须来自**换一套
   * 验过的**，不能来自"再转一点"。
   */
  chartVariantKey?: string;
  /**
   * 这个应用参照图上读出来的图表色（2026-08-04，`appIdentity.chartColors`）。
   *
   * 给了且验得过就**直接用它**，chartVariantKey 那套账本色序退为兜底。
   * 这是整条链路上唯一"为这个应用画的"颜色——参照图每个应用都真的生成了，
   * 此前它的配色画完就丢了（只学版式），这个字段把那一段接回来。
   *
   * 收 unknown 而不是 string[]：它经由存量快照/老应用记录到达，形状不可信，
   * 校验在 validExtractedCharts 里做（渲染器内部再校验的纪律）。
   */
  extractedCharts?: unknown;
}

/**
 * 种子色 → 12 个字段。**纯函数、确定性**：同一个种子色永远出同一套色板。
 *
 * 种子色不合法（空串、非 hex、带 alpha 等）时落回 FALLBACK_SEED，不抛错
 * ——这条链路的纪律是 fail-open。
 */
export function deriveIdentityPalette(
  seed: string,
  opts: DeriveOptions = {}
): IdentityPalette {
  const argb = parseHexToArgb(seed) ?? parseHexToArgb(FALLBACK_SEED)!;
  const src = Hct.fromInt(argb);

  const primaryP = TonalPalette.fromHueAndChroma(src.hue, src.chroma);
  // ← scheme_cmf.ts 的那一行：中性色带主色色相、彩度压两成
  const neutralP = TonalPalette.fromHueAndChroma(src.hue, src.chroma * 0.2);
  // 强调浅底/强调字打七折彩度（ACCENT_CHROMA_SCALE 见上）——独立于
  // primaryP，不影响 primary/hover/gradTo 这几个还是要用足彩度的字段。
  const accentP = TonalPalette.fromHueAndChroma(src.hue, src.chroma * ACCENT_CHROMA_SCALE);

  const primaryTone = src.tone;
  const hoverTone = clampTone(primaryTone + HOVER_TONE_DELTA);
  const gradTone = clampTone(primaryTone + GRAD_TONE_DELTA);
  const gradP = TonalPalette.fromHueAndChroma(
    (src.hue + GRAD_HUE_SHIFT + 360) % 360,
    src.chroma
  );

  return {
    id: opts.id ?? "generated",
    label: opts.label ?? "",
    // 主色**原样保留**：那是 LLM 为这个应用选的身份色，不能被算法改掉
    primary: hex(argb),
    primaryHover: hex(primaryP.tone(hoverTone)),
    gradTo: hex(gradP.tone(gradTone)),
    primaryFg: foregroundFor(primaryTone),
    contentBg: hex(neutralP.tone(TONE.contentBg)),
    accentBg: hex(accentP.tone(TONE.accentBg)),
    accentFg: hex(accentP.tone(TONE.accentFg)),
    charts: chartsFor(opts.chartVariantKey, argb, src, opts.extractedCharts),
    sidebarBg: hex(neutralP.tone(TONE.sidebarBg)),
    sidebarText: hex(neutralP.tone(TONE.sidebarText)),
  };
}

function clampTone(t: number): number {
  return Math.min(100, Math.max(0, t));
}

/** 只认 #rgb / #rrggbb。带 alpha 或格式不对一律返回 null（由调用方兜底）。 */
export function parseHexToArgb(value: string): number | null {
  const s = String(value ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  let r: number;
  let g: number;
  let b: number;
  if (s.length === 3) {
    r = parseInt(s[0] + s[0], 16);
    g = parseInt(s[1] + s[1], 16);
    b = parseInt(s[2] + s[2], 16);
  } else if (s.length === 6) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
  } else {
    return null;
  }
  return (0xff << 24) | (r << 16) | (g << 8) | b;
}

/** 兜底色板。降级路径与正常路径走同一条派生管道（见 FALLBACK_SEED）。 */
export function fallbackIdentityPalette(): IdentityPalette {
  return deriveIdentityPalette(FALLBACK_SEED, { id: "fallback", label: "中性 · 降级" });
}
