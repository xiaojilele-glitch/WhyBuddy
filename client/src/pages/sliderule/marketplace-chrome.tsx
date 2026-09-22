/**
 * 扩展中心三层共用的市场壳（技能 / 连接器 / 伙伴）。
 *
 * 2026-08-26 用户反馈：技能页四列卡片墙 + 页内「技能/连接器/伙伴」二次菜单
 * 跟应用市场、组件库、侧栏都不一档，点进去像进了另一个产品。对照 Cursor
 * Skills 市场重做。
 *
 * 版式不是拍脑袋，三处成熟来源各管一块：
 *
 *   1. **列表行** — VS Code 扩展市场 `extension-list-item`
 *      （github.com/microsoft/vscode …/extensions/browser/media/extension.css，MIT）。
 *      Cursor 的 Skills 市场就是这套：左图标，中间名字+一行描述，右侧作者和
 *      Add。跟着光标走的浮层、四列卡片墙，都比这个容易翻车。
 *   2. **顶栏** — 本仓 AppsWorkbench。灰壳 `--sr-shell-bg`、搜索框、tab/chip
 *      配色。dashboard.css 头注写过：别再出现「会话页一种底、应用中心另一种」。
 *   3. **交互** — Cursor Skills 截图。All / Installed 切列表，不在同一页把
 *      已装的再铺一遍；行右是文字钮「添加」，不是圆 +。
 *
 * 2026-09-20 完整技能包商店底下改成分类三列扁卡。顶栏不许另起：图标+标题、
 * 中间搜索、筛选一排，跟 AppsWorkbench 同一套。四列描边墙仍不许回来。
 *
 * ⚠ **不造 Popular、不下假下载数。** Cursor 那两项靠它们的安装遥测。79 条
 *   技能里分不出哪些更"热门"，瞎标一批跟摆一个点了没反应的按钮是同一类。
 * ⚠ **不放「新建技能」。** 自建链路不存在（见 SkillsLibraryPage 头注）。
 *   伙伴那颗「存成伙伴」是真能存的，所以只在伙伴层出现。
 */

import React from "react";
import { Search } from "lucide-react";

export function MarketPage({
  title,
  icon,
  search,
  extra,
  tabs,
  chips,
  children,
  testid,
}: {
  title: string;
  icon?: React.ReactNode;
  search: React.ReactNode;
  extra?: React.ReactNode;
  tabs?: React.ReactNode;
  chips?: React.ReactNode;
  children: React.ReactNode;
  testid: string;
}) {
  return (
    <div
      data-testid={testid}
      className="min-h-full bg-[var(--sr-shell-bg,#f4f4f6)] px-6 py-5 md:px-8 md:py-6"
    >
      {/*
        吸顶跟 AppsWorkbench 同一套负 margin 把戏：铺满 native-content 的
        内边距，否则列表从左右缝里透出来。背景必须显式给，sticky 默认透明。
      */}
      <div className="sticky top-0 z-30 -mx-6 -mt-5 bg-[var(--sr-shell-bg,#f4f4f6)] px-6 pt-5 pb-3 md:-mx-8 md:-mt-6 md:px-8 md:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            {icon ? (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5b6cff]">
                {icon}
              </span>
            ) : null}
            <h1 className="m-0 text-[18px] font-bold tracking-tight text-slate-900 md:text-[20px]">
              {title}
            </h1>
          </div>
          <div className="w-full min-w-[200px] flex-1 sm:mx-4 sm:max-w-xl md:max-w-2xl">
            {search}
          </div>
          {extra ? (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              {extra}
            </div>
          ) : null}
        </div>
        {/*
          2026-08-26 用户截图像两排：上面「全部 / 已安装」，下面又来一颗「全部」
          再跟分类。全部重复了，我的（已安装 / 已添加）就该挨在全部右侧，
          分类跟在后面——同一条 flex，不折行。分类多了横向滑，不再另起一行。
        */}
        {tabs || chips ? (
          <div className="mt-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs}
            {chips}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function MarketSearch({
  value,
  onChange,
  placeholder,
  testid,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  testid: string;
}) {
  return (
    <div className="relative">
      <Search
        size={15}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        data-testid={testid}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border-0 bg-white/70 py-2.5 pl-10 pr-4 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200/60 placeholder:text-slate-400 transition focus:bg-white focus:ring-2 focus:ring-[#5b6cff]/25"
      />
    </div>
  );
}

export function MarketViewTab({
  label,
  count,
  active,
  onClick,
  testid,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
        active
          ? "bg-[#e8eeff] text-[#3b5bdb]"
          : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
      }`}
    >
      {label}
      {typeof count === "number" ? (
        <span
          className={`tabular-nums text-[11px] ${
            active ? "text-[#3b5bdb]/80" : "text-slate-400"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function MarketChip({
  label,
  count,
  active,
  onClick,
  testid,
  attr,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  testid?: string;
  attr?: Record<string, string>;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
        active
          ? "bg-[#e8eeff] text-[#3b5bdb]"
          : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
      }`}
      {...attr}
    >
      {label}
      {typeof count === "number" ? (
        <span
          className={`tabular-nums text-[11px] ${
            active ? "text-[#3b5bdb]/80" : "text-slate-400"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * 一行：图标 | 名字+描述 | 作者/元信息 | 动作。
 *
 * 高度跟着内容走，不锁死 VS Code 那 62px——已安装行要能展开试跑。
 * hover 是一层白，不是描边卡片；描边卡片是上一版四列墙的气味。
 */
export function MarketRow({
  icon,
  name,
  description,
  meta,
  action,
  open,
  children,
  testid,
  attr,
}: {
  icon: React.ReactNode;
  name: React.ReactNode;
  description: React.ReactNode;
  meta?: React.ReactNode;
  action: React.ReactNode;
  open?: boolean;
  children?: React.ReactNode;
  testid?: string;
  attr?: Record<string, string>;
}) {
  return (
    <div
      className={`transition ${open ? "bg-white" : "hover:bg-white/70"}`}
      data-testid={testid}
      {...attr}
    >
      <div className="flex items-center gap-3 px-2.5 py-2.5">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="min-w-0 text-[13px] font-semibold leading-5 text-slate-900">
            {name}
          </div>
          <div className="mt-0.5 min-w-0 text-[12px] leading-[18px] text-slate-500">
            {description}
          </div>
        </div>
        {meta ? (
          <div className="hidden w-[200px] shrink-0 overflow-hidden text-[12px] text-slate-400 md:block">
            {meta}
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-1.5">{action}</div>
      </div>
      {open ? children : null}
    </div>
  );
}

export function MarketSection({
  title,
  children,
  testid,
}: {
  title: string;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <section className="mt-6 first:mt-1" data-testid={testid}>
      <h2 className="mb-2 px-1 text-[13px] font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

export function MarketCardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="market-card-grid"
      className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3"
    >
      {children}
    </div>
  );
}

/**
 * 货架扁卡：圆图标 | 名字+一行描述 | 安装。
 * 没有描边底板——那是 08-26 裁掉的四列墙。
 */
export function MarketCard({
  icon,
  name,
  description,
  action,
  testid,
}: {
  icon: React.ReactNode;
  name: React.ReactNode;
  description: React.ReactNode;
  action: React.ReactNode;
  testid?: string;
}) {
  return (
    <div
      className="flex min-w-0 items-center gap-3 rounded-xl px-1 py-2.5 transition hover:bg-white/70"
      data-testid={testid}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-5 text-slate-900">
          {name}
        </div>
        <div className="mt-0.5 truncate text-[12px] leading-[18px] text-slate-500">
          {description}
        </div>
      </div>
      <div className="flex shrink-0 items-center">{action}</div>
    </div>
  );
}

export function MarketAddButton({
  on,
  offLabel,
  onLabel,
  title,
  onClick,
  testid,
  disabled,
}: {
  on: boolean;
  offLabel: string;
  onLabel: string;
  title: string;
  onClick: () => void;
  testid: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        on
          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100/80"
          : "bg-white text-slate-700 ring-1 ring-slate-200/80 hover:bg-slate-50"
      }`}
    >
      {on ? onLabel : offLabel}
    </button>
  );
}

export function MarketEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-16 text-center text-[13px] text-slate-400">
      {children}
    </div>
  );
}
