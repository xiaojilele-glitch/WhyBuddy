/**
 * PhoneKanban — 手机档看板（antd-mobile CapsuleTabs 按状态分页，2026-07-28）。
 *
 * 桌面档看板是横向并排的状态列。手机上照搬会得到一个必须左右拖的窄条，
 * 每列宽度不够放一张卡。移动端看板的通行做法是**按状态分页**：一次只看
 * 一个状态，切换靠顶部标签。
 *
 * 选 CapsuleTabs 而不是 Tabs 的理由（这条是查资料查出来的，不是拍脑袋）：
 * 移动端标签的实用上限是 4~5 个，超过就得横滚；而横滚的关键是要有"后面
 * 还有"的视觉提示，否则用户以为到头了。CapsuleTabs 本身横向可滚，且胶囊
 * 之间留有间隙，滚动时下一个会露出一角——正好同时覆盖"状态少"和"状态多"
 * 两种情况，不用自己拼滚动条和渐隐遮罩。
 *
 * 每个标签带计数：手机上看不到全局，计数是唯一能一眼判断"哪一档积压了"
 * 的信息。空状态档也保留标签（不隐藏）——某个状态是 0 本身就是信息，
 * 藏起来会让用户以为这个状态不存在。
 */

import React from "react";
import { Badge, CapsuleTabs } from "antd-mobile";

export interface PhoneKanbanColumn {
  /** 状态值（enum option 的 id） */
  key: string;
  /** 状态展示名 */
  label: string;
  count: number;
}

export default function PhoneKanban({
  columns,
  activeKey,
  onChange,
  children,
}: {
  columns: PhoneKanbanColumn[];
  activeKey: string;
  onChange: (key: string) => void;
  /** 当前状态下的行列表，由父层渲染（复用 PhonePageList） */
  children: React.ReactNode;
}) {
  if (columns.length === 0) return <>{children}</>;
  return (
    <div data-testid="phone-kanban">
      <CapsuleTabs
        activeKey={activeKey}
        onChange={onChange}
        data-testid="phone-kanban-tabs"
      >
        {columns.map(c => (
          <CapsuleTabs.Tab
            key={c.key}
            title={
              <span data-testid={`phone-kanban-tab-${c.key}`}>
                {c.label}
                <Badge content={c.count} color="primary" style={{ marginLeft: 4 }} />
              </span>
            }
          />
        ))}
      </CapsuleTabs>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}
