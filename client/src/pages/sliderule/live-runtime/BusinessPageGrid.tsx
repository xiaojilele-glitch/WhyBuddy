import React from "react";
import {
  BUSINESS_GRID_COLUMNS,
  type BusinessGridItem,
  type BusinessPageBreakpoint,
} from "./business-page-layout";

export default function BusinessPageGrid({
  breakpoint,
  items,
  renderItem,
}: {
  breakpoint: BusinessPageBreakpoint;
  items: BusinessGridItem[];
  renderItem: (blockRef: string) => React.ReactNode;
}) {
  const columns = BUSINESS_GRID_COLUMNS[breakpoint];
  return (
    <div
      data-testid="business-page-grid"
      data-breakpoint={breakpoint}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(" + columns + ",minmax(0,1fr))",
        gridAutoRows: "minmax(min-content,auto)",
        gap: breakpoint === "phone" ? 8 : 12,
        alignItems: "start",
        minWidth: 0,
      }}
    >
      {items.map(item => {
        const node = renderItem(item.blockRef);
        // 这一层只挡得住"压根没有区块"（blockById 查不到 / PAGE_CONTENT_REF
        // 没内容）。**挡不住"区块自己渲染成了空"**：renderItem 返回的是
        // `<ExperienceBlockBoundary/>` 这个元素，null 是在它内部产生的，
        // 从外面看永远是个非空元素。那种情况交给下面的 `empty:hidden`。
        if (node === null || node === undefined || node === false) return null;
        return (
          <div
            key={item.blockRef}
            data-layout-ref={item.blockRef}
            /**
             * 区块渲染成空时，把格子一起收掉（2026-08-11）。
             *
             * 有 5 个渲染器在"没东西可显示"时如实 `return null`——那是对的
             *（按函数体顶层 return null 逐个配平括号数出来的，不是估的）：
             *
             *     QuickActionPanel     这一页没有任何页面动作
             *     BatchActionBar       一行都没勾（且声明了不常显）
             *     ContextBreadcrumb    面包屑不足两级
             *     ActiveFilterSummary  当前没有任何生效条件
             *     WorkspaceTabs        页签全被关掉了
             *
             * 错的是这个格子：它的位置是**显式**写死的（gridColumn/gridRow），
             * 所以内容为空时留下的不是"没有这块"，而是"占了位、里面什么都没有"
             * ——同一行里旁边有个高卡片时，就是半边一片空白。
             *
             * 判据用 CSS `:empty`（Tailwind 的 `empty:` 变体）而不是问每个区块
             * "你会不会渲染成空"：后者要在容器里复刻 6 份判空条件，那 6 份跟渲染器
             * 里的真条件早晚要漂——本轮已经在别处修过三次同一形状的漂移。
             * `:empty` 量的是**结果**，区块以后怎么改都不会漏。
             *
             * 诚实空态**不受影响**：`ColumnSettingPanel` 没连到表格时给的是
             * BlockEmpty 提示（"列设置要先在 binding.targets 里说清楚它管哪一张"），
             * 那是真 DOM，`:empty` 不匹配，照样显示——它本来就该显示，那句话是
             * 在告诉人模型声明漏了什么。被收掉的只有真正一个节点都没产出的那些。
             */
            className="empty:hidden"
            style={{
              gridColumn: item.x + 1 + " / span " + item.w,
              gridRow: item.y + 1 + " / span " + item.h,
              minWidth: 0,
              alignSelf: "stretch",
            }}
          >
            {node}
          </div>
        );
      })}
    </div>
  );
}
