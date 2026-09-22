/**
 * PageViews — 页面范式（加厚 schema 二期）的视图骨架组件。
 *
 * KanbanBoard：statusField 的声明 options → 看板列（tone 给列头着色），
 *   卡片点击进详情；「未归类」列承载声明外/空值行（如实呈现）。
 * CalendarBoard：antd Calendar，默认展示行数最多的月份；日期格里挂事件条，
 *   按 colorBy 的 option tone 着色（对标官方 notice-calendar 示例）。
 * 两者只负责展示与点击回调——数据变更仍走工作台的新建/详情通道。
 */

import React from "react";
import { Badge, Button, Calendar, Card, Empty, Flex, Tag, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import type { AppFormFieldSchema } from "./app-runtime-schema";
import type { RuntimeRow } from "./live-runtime";
import { FieldValue } from "./FieldValue";
import { toneToTagColor, type FieldTone } from "./field-display";
import {
  dominantMonth,
  groupRowsForKanban,
  rowsByDateKey,
} from "./page-views";
import {
  BUSINESS_MUTED_SURFACE_STYLE,
  BUSINESS_TEXT_COLOR,
  INK,
} from "./business-surface-theme";

/** tone → 事件点/列顶条颜色（与 antd 状态色一致）。 */
const TONE_COLORS: Record<FieldTone, string> = {
  success: "#52c41a",
  processing: "#1677ff",
  warning: "#faad14",
  danger: "#ff4d4f",
  default: "#8c8c8c",
};

export function KanbanBoard({
  rows,
  statusField,
  cardFields,
  onOpenRow,
}: {
  rows: RuntimeRow[];
  /** 看板列字段（enum，带一期归一化 options） */
  statusField: AppFormFieldSchema;
  /** 卡片正文字段（statusField 之外的前几列） */
  cardFields: AppFormFieldSchema[];
  onOpenRow: (row: RuntimeRow) => void;
}) {
  const columns = groupRowsForKanban(
    rows,
    statusField.id,
    statusField.options ?? []
  );
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        overflowX: "auto",
      }}
      data-testid="app-runtime-kanban"
    >
      {columns.map(col => (
        <div
          key={col.id}
          style={{
            flex: "1 0 0",
            minWidth: 170,
            ...BUSINESS_MUTED_SURFACE_STYLE,
            borderRadius: 8,
            borderTop: `3px solid ${TONE_COLORS[col.tone]}`,
            padding: "8px 8px 10px",
          }}
          data-testid={`app-kanban-col-${col.id}`}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <Tag
              color={toneToTagColor(col.tone)}
              style={{ marginInlineEnd: 0 }}
            >
              {col.label}
            </Tag>
            <span style={{ fontSize: 11, color: INK.faint }}>
              {col.rows.length}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {col.rows.length === 0 ? (
              <div
                style={{
                  fontSize: 11,
                  color: INK.faint,
                  textAlign: "center",
                  padding: "10px 0",
                }}
              >
                暂无
              </div>
            ) : (
              col.rows.map(row => {
                const [titleField, ...restFields] = cardFields;
                return (
                  <Card
                    key={row.id}
                    size="small"
                    hoverable
                    onClick={() => onOpenRow(row)}
                    styles={{ body: { padding: "8px 10px" } }}
                    data-testid={`app-kanban-card-${row.id}`}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: INK.value,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {titleField ? (
                        <FieldValue
                          field={titleField}
                          value={row.values[titleField.id]}
                        />
                      ) : (
                        row.id
                      )}
                    </div>
                    {restFields.slice(0, 2).map(f => (
                      <div
                        key={f.id}
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: INK.label,
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        <span style={{ color: INK.faint }}>{f.label}</span>
                        <FieldValue field={f} value={row.values[f.id]} />
                      </div>
                    ))}
                  </Card>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 一个日期格里最多铺几条事件——再多就撑破行高，剩下的以 "+N 更多" 收口。 */
const MAX_EVENTS_PER_CELL = 3;

/** tone → antd Badge 的 status 档。两边语义一一对得上，只有 danger 叫法不同。 */
const TONE_BADGE_STATUS: Record<FieldTone, "success" | "processing" | "warning" | "error" | "default"> = {
  success: "success",
  processing: "processing",
  warning: "warning",
  danger: "error",
  default: "default",
};

/**
 * 面板落点：数据月就是本月时落在今天，否则落在那个月的 1 号。
 * 见 CalendarBoard 里对 antd Calendar `value` 语义的说明。
 */
function monthAnchor(dataMonth: string | null): Dayjs {
  const today = dayjs();
  if (!dataMonth || dataMonth === today.format("YYYY-MM")) return today;
  return dayjs(`${dataMonth}-01`);
}

/**
 * 日历页：antd Calendar + 日期格里的事件条。
 *
 * 2026-07-29 从**自建月历**换过来。此前是自己用 CSS grid 铺 7 列、自己算
 * 整周补位（buildMonthGrid）、自己写死「周一…周日」表头、自己做上/下月按钮
 * ——一百多行，而 antd 有现成的 Calendar，官方 `notice-calendar` 示例做的
 * 正是这件事（`cellRender` 往日期格里塞 `Badge status text`）。
 *
 * 换过来同时修掉了自建版做不对的两处：
 * 1. **今天的高亮**、日期选中态、键盘可达 —— 自建版一概没有；
 * 2. 月份/星期的**本地化**：自建版靠硬编码中文字符串糊住了，一旦要出别的
 *    语种就是死的。现在跟 DatePicker 走同一套 locale（见 AppRuntimeScreen
 *    的 ConfigProvider locale={zhCN} + dayjs.locale("zh-cn")）。
 *
 * 头部仍然自定义（headerRender）：官方默认头是「年/月 + 年月下拉」，我们要的
 * 是「上/下月 + 回到数据月 + 共 N 条排期」——这些是业务信息，不是日历本身的
 * 功能，官方头给不了也不该给。
 */
export function CalendarBoard({
  rows,
  dateFieldId,
  colorByField,
  titleFieldId,
  onOpenRow,
}: {
  rows: RuntimeRow[];
  dateFieldId: string;
  /** 事件着色字段（enum，带 options；未声明时事件点用中性色） */
  colorByField?: AppFormFieldSchema;
  /** 事件条标题字段 id（通常是首列） */
  titleFieldId?: string;
  onOpenRow: (row: RuntimeRow) => void;
}) {
  const byDate = React.useMemo(
    () => rowsByDateKey(rows, dateFieldId),
    [rows, dateFieldId]
  );
  const dataMonth = dominantMonth(byDate);
  // antd Calendar 的 `value` 是**选中日期**，同时决定面板停在哪个月——没有
  // "只定月、不选日"的档。所以数据月正好是本月时就落在今天（官方
  // notice-calendar 示例的默认态就是这样，读起来自然）；只有数据在别的月份
  // 才退到那个月的 1 号。第一版一律给 1 号，结果 7 月那张图上 7/01 被涂成
  // 一整块选中色，看着像渲染坏了——用户根本没点过它。
  const [panel, setPanel] = React.useState<Dayjs>(() => monthAnchor(dataMonth));
  // 数据月变化（如首条排期写入）时跳到数据所在月
  const lastDataMonth = React.useRef(dataMonth);
  React.useEffect(() => {
    if (dataMonth && dataMonth !== lastDataMonth.current) {
      lastDataMonth.current = dataMonth;
      setPanel(monthAnchor(dataMonth));
    }
  }, [dataMonth]);

  const total = [...byDate.values()].reduce((n, list) => n + list.length, 0);
  const panelMonth = panel.format("YYYY-MM");

  const badgeStatus = (row: RuntimeRow) => {
    if (!colorByField?.options) return TONE_BADGE_STATUS.default;
    const v = String(row.values[colorByField.id] ?? "");
    const option = colorByField.options.find(o => o.id === v);
    return TONE_BADGE_STATUS[option?.tone ?? "default"];
  };

  return (
    <div data-testid="app-runtime-calendar">
      {byDate.size === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无带日期的数据 — 点「新建」写入后自动入历"
          style={{ margin: "8px 0" }}
        />
      )}
      <Calendar
        value={panel}
        onChange={setPanel}
        onPanelChange={setPanel}
        headerRender={({ value, onChange }) => (
          // 用 antd Flex 而不是 inline `display:flex`：同一份 gap token，
          // 跟别处的间距对得齐（运行时里还有几十处 inline flex，逐步换）。
          <Flex align="center" gap={8} style={{ padding: "0 0 8px" }}>
            <Button
              size="small"
              type="text"
              icon={<LeftOutlined />}
              onClick={() => onChange(value.subtract(1, "month"))}
              data-testid="app-calendar-prev"
            />
            <Typography.Text
              strong
              style={{ fontSize: 13 }}
              data-testid="app-calendar-month"
            >
              {value.format("YYYY 年 M 月")}
            </Typography.Text>
            <Button
              size="small"
              type="text"
              icon={<RightOutlined />}
              onClick={() => onChange(value.add(1, "month"))}
              data-testid="app-calendar-next"
            />
            {dataMonth && dataMonth !== panelMonth && (
              <Button
                size="small"
                type="link"
                onClick={() => onChange(monthAnchor(dataMonth))}
              >
                回到数据月
              </Button>
            )}
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              共 {total} 条排期
            </Typography.Text>
          </Flex>
        )}
        cellRender={(current, info) => {
          // 只接管日期格；月/年视图交回官方默认渲染（info.originNode），
          // 不然切到年视图会整片空白。
          if (info.type !== "date") return info.originNode;
          const events = byDate.get(current.format("YYYY-MM-DD")) ?? [];
          if (events.length === 0) return null;
          return (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {events.slice(0, MAX_EVENTS_PER_CELL).map(row => (
                <li
                  key={row.id}
                  onClick={e => {
                    // 不冒泡到日期格：点事件是"打开这条记录"，不是"选中这一天"
                    e.stopPropagation();
                    onOpenRow(row);
                  }}
                  style={{ cursor: "pointer", overflow: "hidden" }}
                  data-testid={`app-calendar-event-${row.id}`}
                >
                  <Badge
                    status={badgeStatus(row)}
                    text={
                      <span style={{ fontSize: 11 }}>
                        {String((titleFieldId && row.values[titleFieldId]) || row.id)}
                      </span>
                    }
                    style={{ width: "100%", overflow: "hidden", whiteSpace: "nowrap" }}
                  />
                </li>
              ))}
              {events.length > MAX_EVENTS_PER_CELL && (
                <li style={{ fontSize: 10, color: INK.faint }}>
                  +{events.length - MAX_EVENTS_PER_CELL} 更多
                </li>
              )}
            </ul>
          );
        }}
      />
    </div>
  );
}
