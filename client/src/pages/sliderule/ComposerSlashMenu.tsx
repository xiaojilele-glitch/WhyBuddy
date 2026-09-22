/**
 * ComposerSlashMenu — 输入框里 `/` 唤起的能力面板。
 *
 * 判定层在 composer-slash.ts（纯函数、可变异）；这里只管画和键盘。
 *
 * ⚠ 面板锚在**输入框上方**，不跟着光标走。理由写在 composer-slash.ts 头注：
 *   跟光标要在 textarea 里量插入符坐标（镜像 div 那一套），对字号/行高/
 *   缩放/IME/滚动全敏感，是一整类难复现 bug 的来源。主流聊天输入框
 *   （ChatGPT / Claude / 豆包）都锚在上方。
 *
 * ⚠ 面板必须画在**输入框那个 relative 容器内部**。挂到 body 上的话 absolute
 *   会一路找到 body，跑去屏幕左上角——设计系统色板那条注释里记过同一个坑。
 *
 * ⚠ **pointer-events-auto 不能少。** ComposerDock 最外层是
 *   `pointer-events-none`（让指令框周围的空白透给下面的舞台），子元素各自
 *   opt-in 回来。面板从来没 opt-in——2026-08-26 用户报"选了之后框里啥也没有"
 *   的真正根因就是它：面板画得好好的、看得见，但 elementsFromPoint 在面板
 *   正中拿不到它，鼠标点穿过去落在消息气泡上。**键盘选得中、鼠标选不中**
 *   就是这个形状（画布「换图」那次一模一样）。
 */

import React from "react";
import { Blocks, Play, Plug, Search, Settings2, Users } from "lucide-react";

import type { SlashItem, SlashKind } from "./composer-slash";

const KIND_LABEL: Record<SlashKind, string> = {
  rehearsal: "计划",
  skill: "技能",
  connector: "连接器",
  partner: "伙伴",
};

const KIND_ICON: Record<SlashKind, React.ComponentType<{ className?: string }>> = {
  rehearsal: Play,
  skill: Blocks,
  connector: Plug,
  partner: Users,
};

/** 图标底色。⚠ 各类各一个色相：面板里靠颜色一眼分类，不靠读那两个字。 */
const KIND_TONE: Record<SlashKind, string> = {
  rehearsal: "bg-[#f4f4f5] text-[#171717]",
  skill: "bg-[#eef2ff] text-[#4f46e5]",
  connector: "bg-[#ecfdf5] text-[#059669]",
  partner: "bg-[#fff7ed] text-[#ea580c]",
};

const CHIP_TONE: Record<SlashKind, string> = {
  rehearsal: "border-[#e5e7eb] bg-[#fafafa] text-[#171717]",
  skill: "border-[#dfe3ff] bg-[#f5f6ff] text-[#4f46e5]",
  connector: "border-[#d3f0e0] bg-[#f2fbf6] text-[#0f8a5f]",
  partner: "border-[#ffe4cc] bg-[#fff8f1] text-[#c2570b]",
};

/** 分组顺序：计划在最前，再是伙伴 / 连接器 / 技能。 */
const KIND_ORDER: SlashKind[] = ["rehearsal", "partner", "connector", "skill"];

export function CapabilityChip({
  item,
  onRemove,
}: {
  item: SlashItem;
  onRemove?: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <span
      data-testid="sliderule-capability-chip"
      data-kind={item.kind}
      data-key={item.key}
      title={`${KIND_LABEL[item.kind]} · ${item.description}`}
      className={`inline-flex max-w-[220px] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] leading-5 ${CHIP_TONE[item.kind]}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{item.name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`移除 ${item.name}`}
          className="-mr-0.5 ml-0.5 shrink-0 rounded px-0.5 text-[13px] leading-none opacity-50 transition hover:bg-black/5 hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

function Row({
  item,
  active,
  onPick,
  onHover,
}: {
  item: SlashItem;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <button
      type="button"
      data-testid="sliderule-slash-item"
      data-kind={item.kind}
      data-key={item.key}
      data-active={active ? "1" : "0"}
      onMouseEnter={onHover}
      // ⚠ 用 onMouseDown + preventDefault，不用 onClick：onClick 之前
      //   textarea 已经失焦，面板会先关掉，点击落空。
      onMouseDown={event => {
        event.preventDefault();
        onPick();
      }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left transition ${
        active ? "bg-[#f1f4f9]" : "hover:bg-[#f7f8fa]"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${KIND_TONE[item.kind]}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      {/* 名字与说明**并排**（照用户给的样式），不是上下两行：
          一行一条，扫起来比两行块快得多，面板也矮一半。 */}
      <span className="w-[104px] shrink-0 truncate text-[13px] font-medium text-stone-800">
        {item.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-stone-500">
        {/* ⚠ 不可用时**这一格换成缺什么**：不可用的照样列出来是对的，
            但得说清缺什么，否则用户只会以为"点了没反应"。 */}
        {item.unavailable ? (
          <span
            data-testid="sliderule-slash-unavailable"
            className="text-[#d46b08]"
          >
            {item.unavailable}
          </span>
        ) : (
          item.description
        )}
      </span>
      {/* 高亮行右侧的回车提示——照用户给的样式，告诉他"现在按回车就是选它" */}
      <span
        className={`shrink-0 text-[12px] text-stone-300 transition ${active ? "opacity-100" : "opacity-0"}`}
        aria-hidden
      >
        ↵
      </span>
    </button>
  );
}

export function ComposerSlashMenu({
  items,
  highlight,
  query,
  note = "",
  onPointerDownInside,
  onPick,
  onHover,
  onManage,
}: {
  items: readonly SlashItem[];
  highlight: number;
  query: string;
  /** 挂不上时的人话原因。⚠ 有它就必须显示：选了没反应比这个条目不存在更糟。 */
  note?: string;
  /** 鼠标在面板里按下：调用方据此别在 blur 时把面板关掉（见 ComposerDock）。 */
  onPointerDownInside?: () => void;
  onPick: (item: SlashItem) => void;
  onHover: (index: number) => void;
  /** 「管理」快捷项：去「扩展中心」页 */
  onManage?: () => void;
}) {
  /*
   * 面板高度按**头顶实际剩多少**收口。
   *
   * ⚠ 2026-08-26 真机量出来的：空态大输入框位置高，面板一满
   *   （伙伴3 + 连接器2 + 快捷操作）就 365px，`bottom: 100%` 往上顶出屏幕
   *   —— boundingBox 的 y 是 **-16.75**，最上面那条伙伴被裁掉，用户根本
   *   看不见也点不到。纯 CSS 表达不了"我头顶还剩多少"，所以量一次。
   *
   * ⚠ 量的是**面板自己的 top**（不是父容器）：面板挂在指令框那一层，
   *   而指令框在空态/会话内的位置差着好几百像素。
   */
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [cap, setCap] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // 头顶剩余 = 面板当前底边 - 一点边距。底边是稳的（贴着输入框），
      // 顶边会随内容变，所以用底边算。
      const room = r.bottom - 12;
      setCap(prev => {
        const next = Math.max(180, Math.min(360, Math.round(room)));
        return prev === next ? prev : next;
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [items.length, note]);

  /* 分组渲染，但**高亮下标仍然按扁平序**——键盘上下走的是同一串，
     分组只是画法。两套下标是这类面板最容易错的地方。 */
  const groups = KIND_ORDER.map(kind => ({
    kind,
    rows: items
      .map((item, index) => ({ item, index }))
      .filter(x => x.item.kind === kind),
  })).filter(g => g.rows.length > 0);

  return (
    <div
      ref={rootRef}
      data-testid="sliderule-slash-menu"
      data-count={items.length}
      style={cap ? { maxHeight: cap } : undefined}
      onMouseDown={() => onPointerDownInside?.()}
      className="pointer-events-auto absolute bottom-[calc(100%+10px)] left-0 z-30 flex w-[min(460px,92vw)] flex-col overflow-hidden rounded-2xl border border-[#eceff3] bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.14)]"
    >
      {note ? (
        <div
          data-testid="sliderule-slash-note"
          className="mx-1 mb-1.5 rounded-lg bg-[#fff7e6] px-2.5 py-1.5 text-[11.5px] leading-5 text-[#c2570b]"
        >
          {note}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div
          data-testid="sliderule-slash-empty"
          className="px-2.5 py-4 text-center text-[12px] text-stone-400"
        >
          没有匹配「{query}」的能力
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map(g => (
            <div key={g.kind} className="mb-0.5">
              <div className="px-2 pb-0.5 pt-1 text-[11px] text-stone-400">
                {KIND_LABEL[g.kind]}
              </div>
              {g.rows.map(({ item, index }) => (
                <Row
                  key={`${item.kind}:${item.key}`}
                  item={item}
                  active={index === highlight}
                  onPick={() => onPick(item)}
                  onHover={() => onHover(index)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 快捷操作：照用户给的样式，把"去哪儿装更多"放在面板里，
          不用先记住侧栏第三项叫什么。 */}
      {onManage ? (
        <div className="mt-0.5 border-t border-[#f1f3f6] pt-1">
          <div className="px-2 pb-0.5 pt-0.5 text-[11px] text-stone-400">
            快捷操作
          </div>
          <button
            type="button"
            data-testid="sliderule-slash-manage"
            onMouseDown={event => {
              event.preventDefault();
              onManage();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left transition hover:bg-[#f7f8fa]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f1f5f9] text-stone-500">
              <Settings2 className="h-3.5 w-3.5" />
            </span>
            <span className="w-[104px] shrink-0 text-[13px] font-medium text-stone-800">
              扩展中心
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-stone-500">
              安装技能、连接数据源、攒自己的小队
            </span>
          </button>
        </div>
      ) : null}

      <div className="flex items-center justify-between px-2 pb-0.5 pt-1.5 text-[11px] text-stone-300">
        <span className="inline-flex items-center gap-1">
          <Search className="h-3 w-3" />
          接着打字可以筛
        </span>
        <span>↑↓ 选择 · Enter 确认 · Esc 关闭</span>
      </div>
    </div>
  );
}
