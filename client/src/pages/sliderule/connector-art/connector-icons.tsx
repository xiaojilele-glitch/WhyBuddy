/**
 * connector-art — 连接器的图标**图稿**（不是字体图标）。
 *
 * 2026-08-26 用户要"图标使用真图片"。做法是仓里自带的多色 SVG 图稿，
 * 不是去外网拉别人的 logo：
 *
 *   1. 浏览器在这个容器里没有外网（真机实测 fonts.googleapis.com 都
 *      ERR_CONNECTION_RESET），线上也不该为一个图标去依赖第三方 CDN——
 *      挂了就是一排碎图。
 *   2. 钉钉 / 飞书 / Notion 那类是**别人的商标**，热链进产品界面是另一码事，
 *      要用得先谈授权。等真接了它们的连接器再说。
 *
 * ⚠ 图稿按 `icon` 名映射，而 `icon` 是**连接器自己声明的**
 *   （services/connectors.py 的 ConnectorSpec.icon）。前端这张表只做
 *   "名字 → 图稿"，并且**一定有兜底**：认不出的一律画插头，不留空、不报错。
 *   新连接器忘了配图稿时，页面上是一个中性插头，不是一个破图。
 *
 * ⚠ 尺寸交给外面（用 width/height class），图稿本身只画 viewBox 0 0 48 48。
 */

import React from "react";

function Weather() {
  /*
   * ⚠ 2026-08-26 第一版在 3× 截图下露馅：太阳画在云**后面正中**，只从左上角
   *   露出一小块橙色，看着像"白云沾了块橙渍"。图标在 48px 上只有几十个有效
   *   像素，任何"被挡住 80%"的元素都等于没画。
   *   现在太阳挪到右上、露出大半个圆，云压在左下——两个东西各自完整可辨。
   */
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="天气">
      <defs>
        <linearGradient id="sr-c-weather" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5cb2ff" />
          <stop offset="1" stopColor="#1a73e8" />
        </linearGradient>
        <linearGradient id="sr-c-sun" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe27a" />
          <stop offset="1" stopColor="#ffa726" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#sr-c-weather)" />
      <circle cx="31.5" cy="16.5" r="8" fill="url(#sr-c-sun)" />
      <g fill="#ffffff">
        <circle cx="18" cy="27.5" r="6.5" />
        <circle cx="26" cy="25.5" r="8.5" />
        <circle cx="31.5" cy="30" r="5.5" />
        <rect x="12" y="28" width="22" height="8" rx="4" />
      </g>
    </svg>
  );
}

function Chart() {
  /*
   * ⚠ 同一次截图里，第一版的 K 线柱子又细又矮、影线只有 1.2px，
   *   缩到 48px 之后三根柱子看着像"三个小瓶子"。改成粗柱子 + 右上一根上扬
   *   箭头：即使缩到 24px，"往上走的行情"这层意思也还读得出来。
   */
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="行情">
      <defs>
        <linearGradient id="sr-c-chart" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3ddc97" />
          <stop offset="1" stopColor="#0a9b62" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#sr-c-chart)" />
      {/* 柱子：等宽、递增，底边对齐 */}
      <g fill="#ffffff">
        <rect x="11" y="27" width="7" height="10" rx="2" />
        <rect x="20.5" y="22" width="7" height="15" rx="2" />
        <rect x="30" y="17" width="7" height="20" rx="2" />
      </g>
      {/* 上扬箭头压在柱子顶上，用浅一档的绿白，跟柱子分得开 */}
      <path
        d="M12 22.5 21 17l6 3.5 8-8.5"
        fill="none"
        stroke="#d8fbec"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M30.5 11.5H36V17" fill="none" stroke="#d8fbec" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FxArt() {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="外汇">
      <defs>
        <linearGradient id="sr-c-fx" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#sr-c-fx)" />
      <text
        x="24"
        y="31"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="22"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        ¥$
      </text>
    </svg>
  );
}

function PlugArt() {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="连接器">
      <defs>
        <linearGradient id="sr-c-plug" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#64748b" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#sr-c-plug)" />
      <path
        d="M19 14v7m10-7v7"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M15 21h18v4a9 9 0 0 1-9 9 9 9 0 0 1-9-9z"
        fill="#ffffff"
      />
      <path d="M24 34v5" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const ART: Record<string, () => React.ReactElement> = {
  weather: Weather,
  chart: Chart,
  fx: FxArt,
  plug: PlugArt,
};

/**
 * 画一个连接器图标。
 *
 * `iconUrl` 给将来自带 logo 的连接器用（后端可以带上来）。⚠ 图挂了要
 * **回落到图稿**，不能留一个破图 alt——一排碎图比统一的插头难看得多，
 * 而且让人以为连接器本身坏了。
 */
export function ConnectorIcon({
  icon,
  iconUrl,
  className = "h-12 w-12",
}: {
  icon: string;
  iconUrl?: string;
  className?: string;
}) {
  const [broken, setBroken] = React.useState(false);
  const Art = ART[icon] ?? ART.plug!;
  if (iconUrl && !broken) {
    return (
      <img
        src={iconUrl}
        alt=""
        data-testid="connector-icon"
        data-art="url"
        // 外链图标不带 referrer（跟画布换图那条同一个理由）
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`${className} shrink-0 rounded-[14px] object-cover`}
      />
    );
  }
  return (
    <span
      data-testid="connector-icon"
      data-art={ART[icon] ? icon : "plug"}
      className={`${className} shrink-0`}
    >
      <Art />
    </span>
  );
}
