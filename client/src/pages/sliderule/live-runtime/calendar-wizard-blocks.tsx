import React from "react";
import dayjs from "dayjs";
import {
  Alert,
  Button,
  Calendar,
  Card,
  DatePicker,
  Empty,
  Flex,
  Form,
  InputNumber,
  List,
  Progress,
  Radio,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
} from "antd";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Bound = { entityRef: string; rows: NonNullable<ExperienceBlockRendererProps["entityRows"]>[string] };

function field(props: ExperienceBlockRendererProps, key: string): string | undefined {
  const value = (props.block.binding as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function bound(props: ExperienceBlockRendererProps): Bound | undefined {
  const entityRef = field(props, "entityRef");
  const rows = entityRef ? props.entityRows?.[entityRef] : undefined;
  return entityRef && rows ? { entityRef, rows } : undefined;
}

function targets(props: ExperienceBlockRendererProps): string[] {
  const value = (props.block.binding as Record<string, unknown> | undefined)?.targets;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function Shell(props: ExperienceBlockRendererProps & { testid: string; children: React.ReactNode }) {
  const title = String(props.block.props?.title ?? "").trim();
  if (props.block.props?.surface === "plain") {
    return <section data-testid={props.testid}>{title && <Typography.Title level={5}>{title}</Typography.Title>}{props.children}</section>;
  }
  return <Card title={title || undefined} data-testid={props.testid}>{props.children}</Card>;
}

function Missing({ text }: { text: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />;
}

type CalendarConfig = { testid: string; fallback: string; secondary: "resourceFieldRef" | "memberFieldRef"; editable?: boolean; creatable?: boolean };

function CalendarBlock(props: ExperienceBlockRendererProps, config: CalendarConfig) {
  const data = bound(props);
  const titleRef = field(props, "titleFieldRef");
  const startRef = field(props, "startFieldRef");
  const endRef = field(props, "endFieldRef");
  const statusRef = field(props, "statusFieldRef");
  const secondaryRef = field(props, config.secondary);
  const [selected, setSelected] = React.useState(dayjs());
  if (!data || !titleRef || !startRef || !secondaryRef) return <Shell {...props} testid={config.testid}><Missing text={`${config.fallback}尚未绑定必要字段`} /></Shell>;
  const key = selected.format("YYYY-MM-DD");
  const selectedRows = data.rows.filter(row => String(row.values[startRef] ?? "").slice(0, 10) === key);
  const count = (date: dayjs.Dayjs) => data.rows.filter(row => String(row.values[startRef] ?? "").slice(0, 10) === date.format("YYYY-MM-DD")).length;
  return <Shell {...props} testid={config.testid}>
    <Flex gap={16} align="flex-start" wrap>
      <div style={{ flex: "1 1 420px", minWidth: 280 }}><Calendar fullscreen={false} value={selected} onSelect={setSelected} cellRender={date => count(date) ? <Tag color="blue">{count(date)}</Tag> : null} /></div>
      <div style={{ flex: "1 1 280px", minWidth: 260 }}>
        <Flex justify="space-between" align="center"><Typography.Text strong>{key} 议程</Typography.Text>{config.creatable && <Button type="primary" size="small" onClick={() => props.onAction?.("createRequest", { entityRef: data.entityRef, date: key })}>新建</Button>}</Flex>
        {selectedRows.length === 0 ? <Missing text="当前日期没有安排" /> : <List dataSource={selectedRows} renderItem={row => <List.Item actions={config.editable ? [<Button key="edit" type="link" onClick={() => props.onAction?.("editRequest", { entityRef: data.entityRef, rowId: row.id })}>调整</Button>] : undefined} onClick={() => props.onAction?.("itemSelect", { entityRef: data.entityRef, rowId: row.id })}>
          <List.Item.Meta title={String(row.values[titleRef] ?? "未命名安排")} description={`${String(row.values[secondaryRef] ?? "未分配")} · ${String(row.values[startRef] ?? "")}${endRef ? ` - ${String(row.values[endRef] ?? "")}` : ""}`} />{statusRef && <Tag>{String(row.values[statusRef] ?? "")}</Tag>}
        </List.Item>} />}
      </div>
    </Flex>
  </Shell>;
}

export const ResourceBookingCalendarRenderer: ExperienceBlockRenderer = props => CalendarBlock(props, { testid: "resource-booking-calendar", fallback: "资源预约日历", secondary: "resourceFieldRef", creatable: true });

export const DeadlineAgendaRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), dueRef = field(props, "dueFieldRef"), statusRef = field(props, "statusFieldRef"), memberRef = field(props, "memberFieldRef");
  if (!data || !titleRef || !dueRef) return <Shell {...props} testid="deadline-agenda"><Missing text="截止议程尚未绑定标题和截止时间" /></Shell>;
  const rows = [...data.rows].sort((a, b) => String(a.values[dueRef]).localeCompare(String(b.values[dueRef])));
  return <Shell {...props} testid="deadline-agenda">{rows.length === 0 ? <Missing text="当前没有截止事项" /> : <List dataSource={rows} renderItem={row => { const done = ["done", "completed", "closed"].includes(String(row.values[statusRef ?? ""]).toLowerCase()); const overdue = !done && dayjs(String(row.values[dueRef])).isBefore(dayjs()); return <List.Item onClick={() => props.onAction?.("itemSelect", { entityRef: data.entityRef, rowId: row.id })} extra={<Tag color={done ? "success" : overdue ? "error" : "processing"}>{done ? "已完成" : overdue ? "已逾期" : "待处理"}</Tag>}><List.Item.Meta title={String(row.values[titleRef])} description={`${String(row.values[dueRef])}${memberRef ? ` · ${String(row.values[memberRef] ?? "未分配")}` : ""}`} /></List.Item>; }} />}</Shell>;
};

export const BookingConflictPanelRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), startRef = field(props, "startFieldRef"), endRef = field(props, "endFieldRef"), resourceRef = field(props, "resourceFieldRef"), severityRef = field(props, "severityFieldRef");
  if (!data || !titleRef || !startRef || !endRef || !resourceRef) return <Shell {...props} testid="booking-conflict-panel"><Missing text="冲突面板尚未绑定时间和资源" /></Shell>;
  return <Shell {...props} testid="booking-conflict-panel">{data.rows.length === 0 ? <Alert type="success" showIcon message="当前没有预约冲突" /> : <List dataSource={data.rows} renderItem={row => <List.Item actions={[<Button key="open" onClick={() => props.onAction?.("itemSelect", { entityRef: data.entityRef, rowId: row.id })}>查看</Button>, <Button key="edit" type="primary" onClick={() => props.onAction?.("editRequest", { entityRef: data.entityRef, rowId: row.id, operation: "rescheduleBooking", targets: targets(props) })}>改期</Button>]}><List.Item.Meta title={String(row.values[titleRef])} description={`${String(row.values[resourceRef])} · ${String(row.values[startRef])} - ${String(row.values[endRef])}`} />{severityRef && <Tag color="error">{String(row.values[severityRef] ?? "冲突")}</Tag>}</List.Item>} />}</Shell>;
};

export const ScheduleCapacityHeatmapRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), timeRef = field(props, "timeFieldRef"), capacityRef = field(props, "capacityFieldRef"), bookedRef = field(props, "bookedFieldRef"), resourceRef = field(props, "resourceFieldRef");
  if (!data || !timeRef || !capacityRef || !bookedRef) return <Shell {...props} testid="schedule-capacity-heatmap"><Missing text="容量热力图尚未绑定时间、容量和占用量" /></Shell>;
  return <Shell {...props} testid="schedule-capacity-heatmap"><Flex wrap gap={8}>{data.rows.map(row => { const capacity = Math.max(0, Number(row.values[capacityRef] ?? 0)), booked = Math.max(0, Number(row.values[bookedRef] ?? 0)), percent = capacity ? Math.round(booked / capacity * 100) : 0; return <button key={row.id} type="button" onClick={() => props.onAction?.("itemSelect", { entityRef: data.entityRef, rowId: row.id })} style={{ border: 0, borderRadius: 6, padding: 10, minWidth: 118, textAlign: "left", background: percent > 100 ? "#fff1f0" : percent >= 80 ? "#fff7e6" : "#f6ffed" }}><strong>{String(row.values[timeRef])}</strong><div>{resourceRef ? String(row.values[resourceRef] ?? "") : ""}</div><Progress percent={Math.min(100, percent)} status={percent > 100 ? "exception" : "normal"} size="small" /><small>{booked}/{capacity}</small></button>; })}</Flex></Shell>;
};

export const EventRsvpPanelRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), memberRef = field(props, "memberFieldRef"), statusRef = field(props, "statusFieldRef");
  if (!data || !titleRef || !memberRef || !statusRef) return <Shell {...props} testid="event-rsvp-panel"><Missing text="RSVP 面板尚未绑定活动、参与人和状态" /></Shell>;
  return <Shell {...props} testid="event-rsvp-panel"><List dataSource={data.rows} locale={{ emptyText: "还没有参与人" }} renderItem={row => <List.Item actions={["accepted", "tentative", "declined"].map(status => <Button key={status} size="small" type={String(row.values[statusRef]) === status ? "primary" : "default"} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: row.id, operation: "respondRsvp", status, targets: targets(props) })}>{status === "accepted" ? "参加" : status === "tentative" ? "待定" : "拒绝"}</Button>)}><List.Item.Meta title={String(row.values[memberRef])} description={String(row.values[titleRef])} /></List.Item>} /></Shell>;
};

export const RecurrenceEditorRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), frequencyRef = field(props, "frequencyFieldRef"), intervalRef = field(props, "intervalFieldRef"), endModeRef = field(props, "endModeFieldRef"), untilRef = field(props, "untilFieldRef"), countRef = field(props, "countFieldRef");
  const row = data?.rows[0];
  const [draft, setDraft] = React.useState({ frequency: String(row?.values[frequencyRef ?? ""] ?? "weekly"), interval: Number(row?.values[intervalRef ?? ""] ?? 1), endMode: String(row?.values[endModeRef ?? ""] ?? "never"), until: row?.values[untilRef ?? ""] ? dayjs(String(row?.values[untilRef ?? ""])) : null, count: Number(row?.values[countRef ?? ""] ?? 10) });
  if (!data || !row || !frequencyRef || !intervalRef || !endModeRef) return <Shell {...props} testid="recurrence-editor"><Missing text="重复规则尚未绑定必要字段" /></Shell>;
  return <Shell {...props} testid="recurrence-editor"><Form layout="vertical"><Form.Item label="频率"><Select value={draft.frequency} options={[{value:"daily",label:"每天"},{value:"weekly",label:"每周"},{value:"monthly",label:"每月"}]} onChange={frequency => setDraft(v => ({...v, frequency}))} /></Form.Item><Form.Item label="间隔"><InputNumber min={1} value={draft.interval} onChange={interval => setDraft(v => ({...v, interval: interval ?? 1}))} /></Form.Item><Form.Item label="结束"><Radio.Group value={draft.endMode} onChange={event => setDraft(v => ({...v, endMode:event.target.value}))}><Radio value="never">永不</Radio><Radio value="until">日期</Radio><Radio value="count">次数</Radio></Radio.Group></Form.Item>{draft.endMode === "until" && <DatePicker value={draft.until} onChange={until => setDraft(v => ({...v, until}))} />}{draft.endMode === "count" && <InputNumber min={1} value={draft.count} onChange={count => setDraft(v => ({...v, count:count ?? 1}))} />}<Alert style={{marginTop:12}} message={`每 ${draft.interval} 个周期重复，${draft.endMode === "never" ? "不设结束" : draft.endMode === "until" ? `截至 ${draft.until?.format("YYYY-MM-DD") ?? "未选择"}` : `共 ${draft.count} 次`}`} /><Button type="primary" style={{marginTop:12}} onClick={() => props.onAction?.("submitRequest", { entityRef:data.entityRef,rowId:row.id,operation:"saveRecurrence",...draft,until:draft.until?.format("YYYY-MM-DD"),targets:targets(props) })}>保存规则</Button></Form></Shell>;
};

function WizardBlock(props: ExperienceBlockRendererProps, testid: string, fallback: string, operation: string) {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), statusRef = field(props, "statusFieldRef"), descriptionRef = field(props, "descriptionFieldRef"), requiredRef = field(props, "requiredFieldRef");
  const [current, setCurrent] = React.useState(0);
  if (!data || !titleRef || !statusRef) return <Shell {...props} testid={testid}><Missing text={`${fallback}尚未绑定步骤和状态`} /></Shell>;
  if (data.rows.length === 0) return <Shell {...props} testid={testid}><Missing text={`${fallback}还没有步骤`} /></Shell>;
  const blocked = data.rows.some(row => ["failed", "blocked", "error"].includes(String(row.values[statusRef]).toLowerCase()) && (!requiredRef || ![false,"false"].includes(row.values[requiredRef] as never)));
  const active = data.rows[Math.min(current, data.rows.length - 1)];
  return <Shell {...props} testid={testid}><Steps current={current} items={data.rows.map(row => ({ title:String(row.values[titleRef]), status:["done","passed","completed"].includes(String(row.values[statusRef]).toLowerCase()) ? "finish" : ["failed","blocked","error"].includes(String(row.values[statusRef]).toLowerCase()) ? "error" : "process" }))} /><Card size="small" style={{marginTop:16}}><Typography.Text strong>{String(active.values[titleRef])}</Typography.Text><div>{descriptionRef ? String(active.values[descriptionRef] ?? "") : String(active.values[statusRef])}</div></Card>{blocked && <Alert type="error" showIcon style={{marginTop:12}} message="存在阻断步骤，暂不能完成" />}<Flex justify="space-between" style={{marginTop:16}}><Button disabled={current === 0} onClick={() => setCurrent(v => v - 1)}>上一步</Button>{current < data.rows.length - 1 ? <Button type="primary" onClick={() => { props.onAction?.("itemSelect", {entityRef:data.entityRef,rowId:active.id}); setCurrent(v => v + 1); }}>下一步</Button> : <Button type="primary" disabled={blocked} onClick={() => props.onAction?.("submitRequest", {entityRef:data.entityRef,operation,targets:targets(props)})}>确认完成</Button>}</Flex></Shell>;
}

export const DeploymentWizardRenderer: ExperienceBlockRenderer = props => WizardBlock(props, "deployment-wizard", "部署向导", "startDeployment");
