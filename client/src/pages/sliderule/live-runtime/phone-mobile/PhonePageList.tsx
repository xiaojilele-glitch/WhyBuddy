/**
 * PhonePageList — 手机档业务页（antd-mobile 渲染档，④）。
 *
 * 设备 → 库映射的第三档：desktop/tablet=antd，phone=antd-mobile。
 * 本组件只经 React.lazy 引入（antd-mobile 独立 chunk，不进主 bundle）。
 * 行数据 → List.Item（标题 = 首字段值，描述 = 后续 2-3 字段），
 * 新建 = antd-mobile 主按钮；空态文案与桌面档一致（诚实空态）。
 */

import React from "react";
import {
  List,
  Button as MobileButton,
  SearchBar,
  SwipeAction,
  PullToRefresh,
  ErrorBlock,
  Ellipsis,
} from "antd-mobile";
import { AddOutline, LockOutline } from "antd-mobile-icons";

export interface PhoneListField {
  id: string;
  label: string;
}

export interface PhoneListRow {
  id: string;
  values: Record<string, unknown>;
}

interface PhonePageListProps {
  rows: PhoneListRow[];
  /** 描述区字段（通常 detailFields 第 2-4 个） */
  descFields: PhoneListField[];
  canCreate: boolean;
  createLockedHint?: string;
  /** X 光元素级埋点属性（父层 probe() 产出，spread 到新建按钮包裹层） */
  createProbeProps?: React.HTMLAttributes<HTMLElement>;
  onCreate: () => void;
  onOpenRow: (row: PhoneListRow) => void;
  /** 行尾操作区（提交审批/删除等，由父层用现有逻辑渲染） */
  renderRowActions?: (row: PhoneListRow) => React.ReactNode;
  /** 左滑动作（移动端原生形态；给了就用 SwipeAction 收起行内按钮） */
  swipeActions?: (row: PhoneListRow) => Array<{
    key: string;
    text: string;
    color?: "primary" | "warning" | "danger";
    onClick: () => void;
  }>;
  /** 下拉刷新；不传则不启用（没有真事可做的刷新是假动作） */
  onRefresh?: () => Promise<void> | void;
}

/** 有左滑动作就包 SwipeAction，没有就原样透传——避免在列表体里写两份几乎
 *  一样的 JSX 分支。 */
function SwipeItem({
  row,
  swipeActions,
  children,
}: {
  row: PhoneListRow;
  swipeActions?: PhonePageListProps["swipeActions"];
  children: React.ReactNode;
}) {
  const actions = swipeActions?.(row) ?? [];
  if (actions.length === 0) return <>{children}</>;
  return (
    <SwipeAction
      data-testid={`phone-swipe-${row.id}`}
      rightActions={actions.map(a => ({
        key: a.key,
        text: a.text,
        color: a.color,
        onClick: a.onClick,
      }))}
    >
      {children}
    </SwipeAction>
  );
}

export default function PhonePageList({
  rows,
  descFields,
  canCreate,
  createLockedHint,
  createProbeProps,
  onCreate,
  onOpenRow,
  renderRowActions,
  swipeActions,
  onRefresh,
}: PhonePageListProps) {
  // 搜索：桌面档表格自带列筛选，手机档此前完全没有筛选入口——十几行往下
  // 翻就只能靠滚。这里做的是纯客户端子串匹配（行的所有值拼起来找），
  // 不发请求：数据本来就全在手里，发请求反而慢。
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? rows.filter(r =>
        Object.values(r.values).some(v =>
          String(v ?? "").toLowerCase().includes(q)
        )
      )
    : rows;
  // 搜索框只在行数值得搜时出现——3 行数据配一个搜索框是噪声
  const showSearch = rows.length >= 6;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span {...createProbeProps}>
        <MobileButton
          color="primary"
          block
          disabled={!canCreate}
          onClick={onCreate}
          data-testid="app-runtime-create"
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {canCreate ? <AddOutline /> : <LockOutline />}
            {canCreate ? "新建" : createLockedHint || "无新建权限"}
          </span>
        </MobileButton>
      </span>
      {showSearch && (
        <SearchBar
          placeholder="搜索本页数据"
          value={query}
          onChange={setQuery}
          data-testid="phone-list-search"
        />
      )}
      {/* 两处空态都用 ErrorBlock，不再手搓灰字 div——插画/标题/描述的层级与
          留白是它给的，手搓的那两行在手机上就是一句飘在中间的小灰字。
          用 ErrorBlock 而不是 Empty：源码里 Empty 挂着
          `@deprecated ... will be removed in the next major version`，
          ErrorBlock 的 status='empty' 就是这个场景的档位。
          标题/描述仍然是我们自己写的那两句——ErrorBlock 的默认文案是
          「暂无数据」，正是这里最不该出现的话（说不清为什么没有）。 */}
      {rows.length === 0 ? (
        <ErrorBlock
          status="empty"
          title="还没有数据"
          description="点上面的「新建」写入第一条真实数据"
          style={{ padding: "16px 0", "--image-height": "64px" } as React.CSSProperties}
        />
      ) : shown.length === 0 ? (
        // 搜没了 ≠ 没有数据，文案必须分开——否则用户以为数据丢了
        <ErrorBlock
          status="empty"
          title={`没有匹配「${query}」的记录`}
          description={`清空搜索可看全部 ${rows.length} 条`}
          data-testid="phone-list-no-match"
          style={{ padding: "16px 0", "--image-height": "64px" } as React.CSSProperties}
        />
      ) : (
        <PullToRefresh
          onRefresh={async () => {
            await onRefresh?.();
          }}
          // 没给 onRefresh 时禁用：下拉后什么都不会发生的刷新是假动作，
          // 比没有更糟——用户会以为数据已经是最新的。
          disabled={!onRefresh}
        >
        <List mode="card">
          {shown.map((row) => (
            <SwipeItem
              key={row.id}
              row={row}
              swipeActions={swipeActions}
            >
            <List.Item
              onClick={() => onOpenRow(row)}
              description={
                <div>
                  {descFields.map((f) => (
                    <div key={f.id} style={{ display: "flex", fontSize: 12, marginTop: 2 }}>
                      <span style={{ color: "#999", width: 84, flexShrink: 0 }}>{f.label}</span>
                      {/* 长文本字段（备注/AI 摘要）会把行撑成一大段，整屏只
                          剩两三条记录。Ellipsis 按真实渲染宽度测量后截断，
                          比 CSS 的 text-overflow 稳（后者在 flex 子项里要靠
                          min-width:0 才生效，这里嵌了三层容易漏）。

                          **不给 expandText/collapseText**：那对文案会渲染成
                          一个 <a>，而 antd-mobile 的 List.Item 本身就是
                          <a class="adm-list-item adm-plain-anchor">——<a> 套
                          <a> 是非法嵌套，React 真跑就报 validateDOMNesting。
                          原地展开在这儿也是多余的：点这一行本来就打开详情，
                          那里有完整值。 */}
                      <Ellipsis
                        content={String(row.values[f.id] ?? "—")}
                        rows={1}
                        style={{ color: "#262626", minWidth: 0 }}
                      />
                    </div>
                  ))}
                  {renderRowActions && !swipeActions && (
                    <div
                      style={{ marginTop: 6, textAlign: "right" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderRowActions(row)}
                    </div>
                  )}
                </div>
              }
            >
              <span style={{ fontWeight: 600, fontSize: 14, color: "#262626" }}>
                {String(Object.values(row.values)[0] ?? row.id)}
              </span>
            </List.Item>
            </SwipeItem>
          ))}
        </List>
        </PullToRefresh>
      )}
    </div>
  );
}
