/**
 * 手机月历只承担日期导航：官方 CalendarPickerView 标记有数据的日期，选中后
 * 由下方业务列表展示详情。CalendarPickerView 是官方为替代旧 Calendar 提供的 API。
 */

import React from "react";
import { CalendarPickerView, NoticeBar } from "antd-mobile";

// localDateKey 放在 page-views.ts（纯函数、无 antd-mobile 依赖）——父层
// AppRuntimeScreen 也要用它，从这个文件引会把 antd-mobile 拉进静态依赖图，
// node 环境的测试会在收集期直接炸。
import { localDateKey } from "../page-views";

export default function PhoneCalendar({
  markedDates,
  value,
  onChange,
  children,
}: {
  /** 有数据的日期键集合（localDateKey 产出） */
  markedDates: Set<string>;
  value: Date | null;
  onChange: (d: Date | null) => void;
  /** 选中日的列表，由父层渲染（复用 PhonePageList） */
  children: React.ReactNode;
}) {
  return (
    <div data-testid="phone-calendar">
      <CalendarPickerView
        selectionMode="single"
        value={value}
        onChange={onChange}
        allowClear
        renderBottom={date =>
          markedDates.has(localDateKey(date)) ? (
            <span data-testid="phone-calendar-dot">有安排</span>
          ) : null
        }
      />
      <div style={{ marginTop: 8 }} data-testid="phone-calendar-list">
        {value && (
          <NoticeBar
            content={`${localDateKey(value)} · 再点一次该日期可看全部`}
            color="info"
          />
        )}
        {children}
      </div>
    </div>
  );
}
