/**
 * skill-art — 技能卡的图标**图稿**（不是字体图标、不是字母头像）。
 *
 * 2026-08-26 用户按效果图要求技能库也用"真图片"。做法沿用 connector-art
 * 的结论，一字不改地照抄两条理由：
 *   1. 这个容器里的浏览器没有外网（真机实测 fonts.googleapis.com 都
 *      ERR_CONNECTION_RESET），线上也不该为一个图标去依赖第三方 CDN。
 *   2. 别人的 logo 是别人的商标，热链进产品界面要先谈授权。
 * 所以图稿全部是仓里自带的多色 SVG。
 *
 * ⚠ **按分类映射，不按技能 id。** 目录里 79 条技能只有 10 个分类
 *   （client/src/data/featured-skills.json 的 category 字段），一条一张图稿
 *   等于要画 79 张，而且每加一条技能就多一张空图。按分类画 10 张，新技能
 *   只要落在已有分类里就自动有图。
 *
 * ⚠ **一定有兜底。** 认不出的分类画一颗星，不留空、不报错。数据里新增分类
 *   时页面上是一颗中性的星，不是一个破图。这条跟 connector-art 同款——
 *   那边是插头，这边是星。
 *
 * ⚠ 图稿只画 viewBox 0 0 48 48，尺寸交给外面（width/height class）。
 *   glyph 都按"缩到 24px 还认得出"画：connector-art 那边第一版栽在
 *   "元素被挡住 80% 等于没画"和"1.2px 影线缩完就没了"，这里一开始就避开——
 *   白色实心块 + 大留白，不画细线、不画重叠。
 *
 * ⚠ SVG 的 gradient id 是**全页面全局**的。一页 79 张卡同时在 DOM 里，
 *   id 撞了会让后面的卡全部套上第一张的渐变。所以每张图稿的 id 都带
 *   `sr-sk-` 前缀 + 自己的名字，跟 connector-art 的 `sr-c-` 分开。
 */

import React from "react";

/** 渐变底板：所有图稿共用的那层圆角方块。 */
function Plate({ id, from, to }: { id: string; from: string; to: string }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${id})`} />
    </>
  );
}

function Svg({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

/** 界面设计：一个窗口——顶栏三个点 + 内容块。 */
function UiDesign() {
  return (
    <Svg label="界面设计">
      <Plate id="sr-sk-ui" from="#7c8dff" to="#3f51e0" />
      <rect x="10" y="12" width="28" height="24" rx="4" fill="#ffffff" />
      <rect x="10" y="12" width="28" height="7" rx="3.5" fill="#dfe4ff" />
      <g fill="#8b9aff">
        <circle cx="14.5" cy="15.5" r="1.4" />
        <circle cx="19" cy="15.5" r="1.4" />
        <circle cx="23.5" cy="15.5" r="1.4" />
      </g>
      <rect x="13.5" y="22.5" width="9" height="10" rx="2" fill="#c3cbff" />
      <rect x="25" y="22.5" width="9.5" height="3" rx="1.5" fill="#c3cbff" />
      <rect x="25" y="28" width="6.5" height="3" rx="1.5" fill="#c3cbff" />
    </Svg>
  );
}

/** 页面设计：一张纸 + 折角 + 文字行。 */
function PageDesign() {
  return (
    <Svg label="页面设计">
      <Plate id="sr-sk-page" from="#4fc3f7" to="#1976d2" />
      <path
        d="M14 11h13l8 8v18a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V13a2 2 0 0 1 2-2z"
        fill="#ffffff"
      />
      <path d="M27 11l8 8h-8z" fill="#bfe0f7" />
      <g fill="#9fc9ec">
        <rect x="16" y="24" width="16" height="3" rx="1.5" />
        <rect x="16" y="29.5" width="16" height="3" rx="1.5" />
        <rect x="16" y="35" width="10" height="3" rx="1.5" />
      </g>
    </Svg>
  );
}

/** 布局排版：一大两小的栅格块。 */
function Layout() {
  return (
    <Svg label="布局排版">
      <Plate id="sr-sk-layout" from="#4dd0c4" to="#0f9b8e" />
      <g fill="#ffffff">
        <rect x="11" y="11" width="15" height="26" rx="3" />
        <rect x="29" y="11" width="8" height="11" rx="3" />
        <rect x="29" y="26" width="8" height="11" rx="3" />
      </g>
    </Svg>
  );
}

/** 色彩搭配：调色盘上的三色圆点（这张自己就是"多色"的意思）。 */
function Palette() {
  return (
    <Svg label="色彩搭配">
      <Plate id="sr-sk-palette" from="#b07cff" to="#7126d9" />
      <circle cx="24" cy="24" r="13" fill="#ffffff" />
      <circle cx="19" cy="20" r="3.6" fill="#ff6b6b" />
      <circle cx="29" cy="21" r="3.6" fill="#ffc93c" />
      <circle cx="24" cy="29.5" r="3.6" fill="#4c9aff" />
    </Svg>
  );
}

/** 数据分析：饼图（跟 connector-art 的柱状图刻意区分开）。 */
function Analysis() {
  return (
    <Svg label="数据分析">
      <Plate id="sr-sk-analysis" from="#ffb266" to="#ef6c00" />
      <circle cx="24" cy="24" r="13" fill="#ffffff" />
      <path d="M24 24V11a13 13 0 0 1 11.3 6.6z" fill="#ff9d3d" />
      <path d="M24 24l11.3-6.4A13 13 0 0 1 33 33z" fill="#ffd9a8" />
    </Svg>
  );
}

/** 数据可视化：折线 + 端点（"看趋势"，不是"算数字"）。 */
function Viz() {
  return (
    <Svg label="数据可视化">
      <Plate id="sr-sk-viz" from="#5fd88a" to="#159c4d" />
      <rect x="10" y="11" width="28" height="26" rx="4" fill="#ffffff" />
      <path
        d="M14.5 30.5l6-7 4.5 4 8-10"
        fill="none"
        stroke="#159c4d"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14.5" cy="30.5" r="2.4" fill="#159c4d" />
      <circle cx="33" cy="17.5" r="2.4" fill="#159c4d" />
    </Svg>
  );
}

/** 内容创作：一支笔尖朝下的笔。 */
function Writing() {
  return (
    <Svg label="内容创作">
      <Plate id="sr-sk-write" from="#ff8fb1" to="#e0356f" />
      <path d="M30.5 10.5l7 7-16 16-7-7z" fill="#ffffff" />
      <path d="M13 35l1.5-6.5 5 5z" fill="#ffe0ea" />
      <rect
        x="28.2"
        y="9.4"
        width="9.9"
        height="5"
        rx="2.5"
        transform="rotate(45 33.2 11.9)"
        fill="#ffd0de"
      />
    </Svg>
  );
}

/** 办公：公文包。Word / PPT / 汇报坐这一栏，不跟规格混。 */
function Office() {
  return (
    <Svg label="办公">
      <Plate id="sr-sk-office" from="#7dd3fc" to="#0369a1" />
      <rect x="18" y="11" width="12" height="6" rx="2" fill="#bae6fd" />
      <rect x="11" y="16" width="26" height="20" rx="4" fill="#ffffff" />
      <rect x="11" y="22" width="26" height="5" fill="#e0f2fe" />
    </Svg>
  );
}

/** 效率提升：闪电。 */
function Efficiency() {
  return (
    <Svg label="效率提升">
      <Plate id="sr-sk-eff" from="#ffd257" to="#f5a300" />
      <path d="M27 9l-13 17h8l-3 13 14-18h-8z" fill="#ffffff" />
    </Svg>
  );
}

/** 需求分析：写字板 + 勾。 */
function Requirement() {
  return (
    <Svg label="需求分析">
      <Plate id="sr-sk-req" from="#5ec8e8" to="#0d7fa8" />
      <rect x="12" y="12" width="24" height="26" rx="4" fill="#ffffff" />
      <rect x="18" y="8.5" width="12" height="7" rx="3.5" fill="#cfeaf5" />
      <path
        d="M17.5 26.5l4.5 4.5 9-9.5"
        fill="none"
        stroke="#0d7fa8"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 交互体验：手型光标 + 点击波纹。 */
function Interaction() {
  return (
    <Svg label="交互体验">
      <Plate id="sr-sk-inter" from="#a78bfa" to="#5b21b6" />
      <path
        d="M17 12l14 12.5-6.2 1.3 3.4 7.4-4 1.8-3.4-7.4-4.4 4.6z"
        fill="#ffffff"
      />
      <g fill="none" stroke="#e3d9ff" strokeWidth="2.4" strokeLinecap="round">
        <path d="M33 15.5a7 7 0 0 1 1.6 5.4" />
        <path d="M31.5 30.5a7 7 0 0 0 4.2-3.4" />
      </g>
    </Svg>
  );
}

/** 兜底：一颗星（认不出的分类走这里，见文件头注）。 */
function Fallback() {
  return (
    <Svg label="技能">
      <Plate id="sr-sk-fallback" from="#94a3b8" to="#475569" />
      <path
        d="M24 11l4 8.6 9.4 1.2-6.9 6.4 1.8 9.3L24 32l-8.3 4.5 1.8-9.3-6.9-6.4 9.4-1.2z"
        fill="#ffffff"
      />
    </Svg>
  );
}

/**
 * 分类 → 图稿。key 必须跟 featured-skills.json 里的 category 字面一致；
 * 对不上就走兜底（`skill-icons.test.tsx` 里有一条哨兵盯着"每个真实分类都
 * 有自己的图稿"，加了新分类忘配图会红）。
 */
const ART: Record<string, () => React.JSX.Element> = {
  界面设计: UiDesign,
  页面设计: PageDesign,
  布局排版: Layout,
  色彩搭配: Palette,
  数据分析: Analysis,
  数据可视化: Viz,
  内容创作: Writing,
  办公: Office,
  效率提升: Efficiency,
  需求分析: Requirement,
  交互体验: Interaction,
};

export function hasSkillArt(category: string | undefined): boolean {
  return !!category && category in ART;
}

export function SkillIcon({
  category,
  className = "h-11 w-11",
}: {
  category?: string;
  className?: string;
}) {
  const Art = (category && ART[category]) || Fallback;
  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-[14px] ${className}`}
      data-testid="skill-icon"
      data-art={category && ART[category] ? category : "fallback"}
    >
      <Art />
    </span>
  );
}

export default SkillIcon;
