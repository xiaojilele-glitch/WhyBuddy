/**
 * 画板右键菜单。
 *
 * 参考图那个工具的节点菜单是「编辑连线 / 重新生成 / 导出 / 删除」。这里逐项
 * 对过一遍，**只留在这个产品里说得通的**：
 *
 *   编辑连线 → 留。改成"从这里连一条线"，落到画布的连线态。
 *   重新生成 → 留，但**不直接开跑**。一轮推演是几分钟 + 真金白银的 token，
 *              右键点一下就开跑是敌意设计。改成把页面作用域的指令填进输入框
 *              并聚焦（走仓里已有的 `sliderule:fill-prompt` 事件），
 *              用户看一眼再按回车。菜单项带省略号，是"会再问一次"的通用约定。
 *   导出     → 留。PNG（所见）与 HTML（交付原文）两种，语义不同，都要。
 *   删除     → **不留**。画板不是用户放上去的图元，是这一轮推演的产物；
 *              在画布上"删掉"一页，删的到底是画布上的显示还是 pages_json 里的
 *              那一页？前者是假的（刷新就回来），后者是破坏性动作，不该藏在
 *              右键菜单第四项里。宁可没有。
 *
 * ⚠ 菜单项文案里凡是会花钱/花时间的，都要在 title 里说清代价。
 */

import React from "react";
import {
  Code2,
  Copy,
  Image as ImageIcon,
  Link2,
  Maximize2,
  MousePointerClick,
  RefreshCw,
} from "lucide-react";

export interface CanvasBoardMenuProps {
  /** 屏幕坐标（clientX/clientY） */
  x: number;
  y: number;
  pageName: string;
  onClose: () => void;
  onEnter: () => void;
  onOpenInPageView: () => void;
  onStartLink: () => void;
  onRegenerate: () => void;
  onExportPng: () => void;
  onExportHtml: () => void;
  onCopyPageId: () => void;
}

interface ItemProps {
  icon: React.ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
}

function Item({ icon, label, title, onClick }: ItemProps): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      title={title}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-stone-600 transition hover:bg-[#f4f6f8] hover:text-stone-900"
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-stone-400">
        {icon}
      </span>
      {label}
    </button>
  );
}

/** 菜单大致尺寸，用来把它掰回视口里。够用即可，不必精确。 */
const MENU_W = 208;
const MENU_H = 268;

/** 贴边时把菜单掰回视口内。纯函数，判据钉着。 */
export function clampMenuPosition(
  x: number,
  y: number,
  win: { w: number; h: number },
  size: { w: number; h: number } = { w: MENU_W, h: MENU_H }
): { left: number; top: number } {
  return {
    left: Math.max(8, Math.min(x, win.w - size.w - 8)),
    top: Math.max(8, Math.min(y, win.h - size.h - 8)),
  };
}

export function CanvasBoardMenu({
  x,
  y,
  pageName,
  onClose,
  onEnter,
  onOpenInPageView,
  onStartLink,
  onRegenerate,
  onExportPng,
  onExportHtml,
  onCopyPageId,
}: CanvasBoardMenuProps): React.ReactElement {
  const ref = React.useRef<HTMLDivElement | null>(null);

  // 点外面 / Esc 关掉。⚠ 监听挂在捕获阶段：菜单项自己的 onClick 在冒泡阶段，
  // 挂冒泡会先被外层 pane 的点击处理吃掉，表现是"菜单一闪就没了"。
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const pos = clampMenuPosition(x, y, {
    w: typeof window === "undefined" ? 1280 : window.innerWidth,
    h: typeof window === "undefined" ? 800 : window.innerHeight,
  });

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="sliderule-canvas-board-menu"
      className="fixed z-50 w-52 rounded-lg border border-[#e9edf2] bg-white p-1 shadow-lg"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="truncate px-2 py-1 text-[11px] font-medium text-stone-400">
        {pageName}
      </div>
      <Item
        icon={<MousePointerClick className="h-3.5 w-3.5" />}
        label="进入交互"
        title="在画布上直接用这一页（双击同效）"
        onClick={run(onEnter)}
      />
      <Item
        icon={<Maximize2 className="h-3.5 w-3.5" />}
        label="在页面档打开"
        title="去页面档：那里有点选编辑与透视"
        onClick={run(onOpenInPageView)}
      />
      <div className="my-1 h-px bg-[#f0f1f3]" />
      <Item
        icon={<Link2 className="h-3.5 w-3.5" />}
        label="从这里连一条线"
        title="接着点另一块画板，连上一条跳转"
        onClick={run(onStartLink)}
      />
      <Item
        icon={<RefreshCw className="h-3.5 w-3.5" />}
        label="重新生成这一页…"
        title="把重画指令填进输入框（只重画这一页，其余照搬）。要不要开跑由你按回车决定——一轮推演是几分钟。"
        onClick={run(onRegenerate)}
      />
      <div className="my-1 h-px bg-[#f0f1f3]" />
      <Item
        icon={<ImageIcon className="h-3.5 w-3.5" />}
        label="导出 PNG"
        title="导出画板上现在看到的样子"
        onClick={run(onExportPng)}
      />
      <Item
        icon={<Code2 className="h-3.5 w-3.5" />}
        label="导出 HTML"
        title="导出交付的 HTML 原文（不含预览注入的 Tailwind）"
        onClick={run(onExportHtml)}
      />
      <Item
        icon={<Copy className="h-3.5 w-3.5" />}
        label="复制页面标识"
        title="复制 pageId"
        onClick={run(onCopyPageId)}
      />
    </div>
  );
}
