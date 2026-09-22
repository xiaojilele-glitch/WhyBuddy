import React from "react";
import {
  Button,
  Card,
  ErrorBlock,
  Grid,
  List,
  ProgressBar,
  Selector,
  Slider,
  Space,
  Steps,
  Switch,
  Tabs,
  Tag,
  TextArea,
} from "antd-mobile";
import {
  AddOutline,
  DeleteOutline,
  LeftOutline,
  MinusOutline,
  PlayOutline,
  RedoOutline,
  RightOutline,
  StopOutline,
  UploadOutline,
} from "antd-mobile-icons";
import type { ExperienceBlockRendererProps } from "../block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
type Layout = { x: number; y: number; w: number; h: number };
const field = (props: ExperienceBlockRendererProps, key: string) => String(props.block.binding?.[key] ?? "").trim();
const value = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const numeric = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const targets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const bound = (props: ExperienceBlockRendererProps) => { const entityRef = field(props, "entityRef"), rows = entityRef ? props.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const shell = (props: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => <Card data-testid={`phone-${id}`} title={String(props.block.props?.title ?? title)}><div style={{ paddingBottom: props.block.props?.surface === "plain" ? 144 : 0 }}>{children}</div></Card>;
const empty = (props: ExperienceBlockRendererProps, id: string, title: string) => shell(props, id, title, <ErrorBlock status="empty" title="尚未绑定所需数据" />);
const uploadOperation = (status: string) => /failed|error/i.test(status) ? "retryUpload" : /paused/i.test(status) ? "resumeUpload" : /uploading|queued/i.test(status) ? "pauseUpload" : undefined;
const token = (path: string) => `{{$json.${path}}}`;
const clamp = (layout: Layout): Layout => ({ x: Math.max(0, Math.min(11, layout.x)), y: Math.max(0, layout.y), w: Math.max(1, Math.min(12 - Math.max(0, Math.min(11, layout.x)), layout.w)), h: Math.max(1, Math.min(4, layout.h)) });

function PhoneResumableUploadQueue(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "fileNameFieldRef"), sizeRef = field(props, "fileSizeFieldRef"), statusRef = field(props, "transferStatusFieldRef"), progressRef = field(props, "transferProgressFieldRef");
  if (!data || !nameRef || !statusRef || !progressRef) return empty(props, "resumable-upload-queue", "断点上传队列");
  return shell(props, "resumable-upload-queue", "断点上传队列", <Space block direction="vertical">
    <Button block color="primary" fill="outline" onClick={() => props.onAction?.("editRequest", { entityRef: data.entityRef, operation: "openFilePicker" })}><UploadOutline /> 添加文件</Button>
    <List>{data.rows.map(row => { const status = value(row, statusRef), operation = uploadOperation(status), complete = /complete/i.test(status); return <List.Item key={row.id} description={<><ProgressBar percent={Math.max(0, Math.min(100, numeric(row, progressRef)))} /><small>{sizeRef ? `${numeric(row, sizeRef)} MB · ` : ""}{status}</small></>} extra={<Space>{operation && <Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: row.id, operation, targets: targets(props) })}>{operation === "pauseUpload" ? <StopOutline /> : operation === "retryUpload" ? <RedoOutline /> : <PlayOutline />}</Button>}{!complete && <Button size="mini" color="danger" aria-label="取消上传" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: row.id, operation: "cancelUpload", targets: targets(props) })}><DeleteOutline /></Button>}</Space>}>{value(row, nameRef, row.id)}</List.Item>; })}</List>
  </Space>);
}

function PhoneDistributedTraceWaterfall(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "spanNameFieldRef"), parentRef = field(props, "spanParentFieldRef"), startRef = field(props, "spanStartFieldRef"), durationRef = field(props, "spanDurationFieldRef"), statusRef = field(props, "statusFieldRef");
  const [selectedId, setSelectedId] = React.useState("");
  if (!data || !nameRef || !startRef || !durationRef) return empty(props, "distributed-trace-waterfall", "分布式追踪瀑布");
  const maxDuration = Math.max(...data.rows.map(row => numeric(row, durationRef)), 1), selected = data.rows.find(row => row.id === selectedId) ?? data.rows[0];
  return shell(props, "distributed-trace-waterfall", "分布式追踪瀑布", <Space block direction="vertical">
    <Steps direction="vertical">{data.rows.map(row => <Steps.Step key={row.id} status={/failed|error/i.test(value(row, statusRef)) ? "error" : "finish"} title={<Button fill="none" size="mini" onClick={() => setSelectedId(row.id)}>{value(row, nameRef, row.id)}</Button>} description={<><ProgressBar percent={Math.round(numeric(row, durationRef) / maxDuration * 100)} /><small>{numeric(row, startRef)}ms + {numeric(row, durationRef)}ms{parentRef && value(row, parentRef) ? ` · 子 Span` : ""}</small></>} />)}</Steps>
    <Card><strong>{value(selected, nameRef)}</strong><div>起点 {numeric(selected, startRef)}ms · 耗时 {numeric(selected, durationRef)}ms</div><Button block onClick={() => props.onAction?.("itemSelect", { entityRef: data.entityRef, rowId: selected.id })}>查看 Span</Button></Card>
  </Space>);
}

function PhoneExpressionDataMapper(props: ExperienceBlockRendererProps) {
  const data = bound(props), pathRef = field(props, "dataPathFieldRef"), sampleRef = field(props, "sampleValueFieldRef"), typeRef = field(props, "dataTypeFieldRef");
  const [draft, setDraft] = React.useState(String(props.block.props?.expression ?? "")), [selectedId, setSelectedId] = React.useState("");
  if (!data || !pathRef || !sampleRef) return empty(props, "expression-data-mapper", "表达式数据映射器");
  const selected = data.rows.find(row => row.id === selectedId) ?? data.rows[0], exact = data.rows.find(row => draft.trim() === token(value(row, pathRef)));
  return shell(props, "expression-data-mapper", "表达式数据映射器", <Tabs defaultActiveKey="data">
    <Tabs.Tab title="数据" key="data"><List>{data.rows.map(row => <List.Item key={row.id} clickable onClick={() => setSelectedId(row.id)} description={typeRef ? value(row, typeRef) : ""} extra={<Button size="mini" onClick={() => { setSelectedId(row.id); setDraft(current => `${current}${current ? " " : ""}${token(value(row, pathRef))}`); }}><AddOutline /></Button>}>{value(row, pathRef)}</List.Item>)}</List></Tabs.Tab>
    <Tabs.Tab title="表达式" key="expression"><Space block direction="vertical"><TextArea rows={7} value={draft} onChange={setDraft} placeholder="输入表达式或从数据页插入字段" /><Button block color="primary" disabled={!draft.trim()} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, expression: draft, operation: "saveExpressionMapping", targets: targets(props) })}>保存表达式</Button></Space></Tabs.Tab>
    <Tabs.Tab title="输出" key="output"><Card><strong>{value(selected, pathRef)}</strong><div>{value(selected, sampleRef)}</div><Tag color={exact ? "success" : "primary"}>{exact ? `解析结果：${value(exact, sampleRef)}` : "等待宿主安全执行"}</Tag></Card></Tabs.Tab>
  </Tabs>);
}

function PhoneSessionReplayScrubber(props: ExperienceBlockRendererProps) {
  const data = bound(props), offsetRef = field(props, "eventOffsetFieldRef"), typeRef = field(props, "eventTypeFieldRef"), summaryRef = field(props, "summaryFieldRef"), severityRef = field(props, "severityFieldRef");
  const max = data ? Math.max(...data.rows.map(row => numeric(row, offsetRef)), 1) : 1, [offset, setOffset] = React.useState(0), [playing, setPlaying] = React.useState(false), [speed, setSpeed] = React.useState<string[]>(["1x"]);
  if (!data || !offsetRef || !typeRef || !summaryRef) return empty(props, "session-replay-scrubber", "会话回放时间轴");
  const current = [...data.rows].sort((left, right) => Math.abs(numeric(left, offsetRef) - offset) - Math.abs(numeric(right, offsetRef) - offset))[0];
  return shell(props, "session-replay-scrubber", "会话回放时间轴", <Space block direction="vertical">
    <Card><strong>{value(current, typeRef)}</strong><div>{value(current, summaryRef)}</div>{severityRef && <Tag color={/error|fatal/i.test(value(current, severityRef)) ? "danger" : "primary"}>{value(current, severityRef)}</Tag>}</Card>
    <Slider min={0} max={max} value={offset} onChange={next => { if (typeof next === "number") setOffset(next); }} />
    <Grid columns={2} gap={8}><Grid.Item><Button block onClick={() => setPlaying(currentPlaying => !currentPlaying)}>{playing ? <StopOutline /> : <PlayOutline />} {playing ? "暂停" : "播放"}</Button></Grid.Item><Grid.Item><Selector columns={3} options={["0.5x", "1x", "2x"].map(item => ({ label: item, value: item }))} value={speed} onChange={setSpeed} /></Grid.Item></Grid>
    <small>{offset}ms / {max}ms</small>
  </Space>);
}

function PhoneDashboardGridComposer(props: ExperienceBlockRendererProps) {
  const data = bound(props), titleRef = field(props, "panelTitleFieldRef"), xRef = field(props, "gridXFieldRef"), yRef = field(props, "gridYFieldRef"), wRef = field(props, "gridWidthFieldRef"), hRef = field(props, "gridHeightFieldRef");
  const [selectedId, setSelectedId] = React.useState(""), [changes, setChanges] = React.useState<Record<string, Layout>>({});
  if (!data || !titleRef || !xRef || !yRef || !wRef || !hRef) return empty(props, "dashboard-grid-composer", "仪表盘网格编排器");
  const initial = (row: Row) => clamp({ x: numeric(row, xRef), y: numeric(row, yRef), w: numeric(row, wRef, 6), h: numeric(row, hRef, 1) }), layout = (row: Row) => changes[row.id] ?? initial(row), selected = data.rows.find(row => row.id === selectedId) ?? data.rows[0];
  const adjust = (delta: Partial<Layout>) => setChanges(current => { const before = layout(selected); return { ...current, [selected.id]: clamp({ x: before.x + Number(delta.x ?? 0), y: before.y + Number(delta.y ?? 0), w: before.w + Number(delta.w ?? 0), h: before.h + Number(delta.h ?? 0) }) }; });
  return shell(props, "dashboard-grid-composer", "仪表盘网格编排器", <Space block direction="vertical">
    <Grid columns={2} gap={8}>{data.rows.map(row => <Grid.Item key={row.id} span={layout(row).w >= 7 ? 2 : 1}><Card onClick={() => setSelectedId(row.id)} style={{ border: selected.id === row.id ? "1px solid #1677ff" : undefined }}><strong>{value(row, titleRef)}</strong><div>{layout(row).w >= 7 ? "整行" : "半行"}</div></Card></Grid.Item>)}</Grid>
    <Card><strong>{value(selected, titleRef)}</strong><Grid columns={4} gap={6}><Grid.Item><Button block aria-label="左移" onClick={() => adjust({ x: -1 })}><LeftOutline /></Button></Grid.Item><Grid.Item><Button block aria-label="右移" onClick={() => adjust({ x: 1 })}><RightOutline /></Button></Grid.Item><Grid.Item><Button block aria-label="收窄" onClick={() => adjust({ w: -1 })}><MinusOutline /></Button></Grid.Item><Grid.Item><Button block aria-label="加宽" onClick={() => adjust({ w: 1 })}><AddOutline /></Button></Grid.Item></Grid></Card>
    <Grid columns={2} gap={8}><Grid.Item><Button block disabled={!Object.keys(changes).length} onClick={() => setChanges({})}><RedoOutline /> 重置</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!Object.keys(changes).length} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, layouts: Object.fromEntries(data.rows.map(row => [row.id, layout(row)])), operation: "saveDashboardLayout", targets: targets(props) })}>保存布局</Button></Grid.Item></Grid>
  </Space>);
}

function PhoneLiveLogTailer(props: ExperienceBlockRendererProps) {
  const data = bound(props), timeRef = field(props, "logTimeFieldRef"), levelRef = field(props, "logLevelFieldRef"), messageRef = field(props, "logMessageFieldRef"), streamRef = field(props, "logStreamFieldRef");
  const [paused, setPaused] = React.useState(false), [follow, setFollow] = React.useState(true), [levels, setLevels] = React.useState<string[]>(["all"]), [selectedId, setSelectedId] = React.useState("");
  if (!data || !timeRef || !levelRef || !messageRef) return empty(props, "live-log-tailer", "实时日志跟随器");
  const level = levels[0] ?? "all", rows = level === "all" ? data.rows : data.rows.filter(row => value(row, levelRef).toLowerCase() === level), selected = data.rows.find(row => row.id === selectedId);
  const toggle = () => { const operation = paused ? "resumeLiveLogs" : "pauseLiveLogs"; setPaused(current => !current); props.onAction?.("submitRequest", { entityRef: data.entityRef, operation, targets: targets(props) }); };
  return shell(props, "live-log-tailer", "实时日志跟随器", <Space block direction="vertical">
    <Selector columns={2} options={[{ label: "全部", value: "all" }, { label: "Info", value: "info" }, { label: "Warn", value: "warn" }, { label: "Error", value: "error" }]} value={levels} onChange={setLevels} />
    <List header={<Space>跟随最新 <Switch checked={follow} onChange={setFollow} /><Button size="mini" onClick={toggle}>{paused ? <PlayOutline /> : <StopOutline />} {paused ? "继续" : "暂停"}</Button></Space>}>{rows.map(row => <List.Item key={row.id} clickable onClick={() => setSelectedId(row.id)} description={value(row, messageRef)} extra={<Tag color={/error/i.test(value(row, levelRef)) ? "danger" : /warn/i.test(value(row, levelRef)) ? "warning" : "primary"}>{value(row, levelRef)}</Tag>}>{value(row, timeRef)}</List.Item>)}</List>
    {selected && <Card><strong>{streamRef ? value(selected, streamRef, "默认流") : "日志详情"}</strong><div>{value(selected, messageRef)}</div></Card>}
  </Space>);
}

export function renderIndependentStructureBatch3PhoneBlock(props: ExperienceBlockRendererProps): React.ReactNode | undefined {
  switch (props.block.type) {
    case "ResumableUploadQueue": return <PhoneResumableUploadQueue {...props} />;
    case "DistributedTraceWaterfall": return <PhoneDistributedTraceWaterfall {...props} />;
    case "ExpressionDataMapper": return <PhoneExpressionDataMapper {...props} />;
    case "SessionReplayScrubber": return <PhoneSessionReplayScrubber {...props} />;
    case "DashboardGridComposer": return <PhoneDashboardGridComposer {...props} />;
    case "LiveLogTailer": return <PhoneLiveLogTailer {...props} />;
    default: return undefined;
  }
}
