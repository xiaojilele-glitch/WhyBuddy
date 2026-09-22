/**
 * partner-art — 伙伴的头像。
 *
 * ⚠ **不画人。** 效果图上是一排真人感的 AI 头像（数据分析师、PPT 专家…），
 *   我们不做人设——partners.ts 的头注写着为什么：人设是最容易造出一堆
 *   看着丰满、其实什么也不接的东西的地方，而这整条链路的出发点正是
 *   "假的没有意义"。给「天气播报台」配一张职业女性照片，只会让人以为
 *   背后有个真的分析师。
 *
 * 所以头像**由它装配的东西拼出来**：接了天气就是天气那张图稿，接了行情
 *   就是行情那张，两样都接就主图 + 右下角一枚小徽标。好处是用户自己攒的
 *   伙伴也自动有头像，且头像跟"它到底接了什么"永远一致——换掉依赖，头像
 *   跟着换，不会出现"图标说天气、实际接的是行情"。
 *
 * ⚠ 图稿复用 connector-art，不另画一套（仓里第四条：同一件事两处实现，
 *   改一处不报错、只有一半不生效）。
 */

import React from "react";

import { ConnectorIcon } from "../connector-art/connector-icons";

/** 一个人都不接连接器时（纯技能伙伴）的中性底：两个抽象小人。 */
function TeamPlate() {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="伙伴">
      <defs>
        <linearGradient id="sr-p-team" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#475569" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="24" fill="url(#sr-p-team)" />
      <g fill="#ffffff">
        <circle cx="19" cy="19" r="5.5" />
        <path d="M9 36c0-5 4.5-8.5 10-8.5S29 31 29 36z" />
        <circle cx="32" cy="21" r="4.5" opacity="0.85" />
        <path d="M24.5 36c0-4.2 3.4-7 7.5-7s7.5 2.8 7.5 7z" opacity="0.85" />
      </g>
    </svg>
  );
}

export function PartnerAvatar({
  icons,
  className = "h-11 w-11",
}: {
  /** 这个伙伴接的连接器图稿名，按 needs 的顺序 */
  icons: readonly string[];
  className?: string;
}) {
  const [primary, second] = icons;
  return (
    <span
      className={`relative inline-flex shrink-0 ${className}`}
      data-testid="partner-avatar"
      data-icons={icons.length ? icons.join("+") : "team"}
    >
      <span className="h-full w-full overflow-hidden rounded-full">
        {primary ? (
          <ConnectorIcon icon={primary} className="h-full w-full" />
        ) : (
          <TeamPlate />
        )}
      </span>
      {/* ⚠ 第二枚只画**不重复**的那个：两条 needs 都是天气时再叠一枚一模一样的
          小徽标，看着像渲染坏了。 */}
      {second && second !== primary ? (
        <span className="absolute -bottom-0.5 -right-0.5 h-[45%] w-[45%] overflow-hidden rounded-full ring-2 ring-white">
          <ConnectorIcon icon={second} className="h-full w-full" />
        </span>
      ) : null}
    </span>
  );
}

export default PartnerAvatar;
