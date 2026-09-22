import React from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  List,
  Progress,
  Segmented,
  Slider,
  Space,
  Switch,
  Tag,
  Tree,
  Typography,
  Upload,
} from "antd";
import {
  DeleteOutlined,
  LeftOutlined,
  MinusOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RedoOutlined,
  RightOutlined,
  SaveOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { CodeEditor } from "../base-components/custom-components";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
type Layout = { x: number; y: number; w: number; h: number };
const field = (props: ExperienceBlockRendererProps, key: string) => String(props.block.binding?.[key] ?? "").trim();
const value = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const numeric = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const targets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const bound = (props: ExperienceBlockRendererProps) => {
  const entityRef = field(props, "entityRef"), rows = entityRef ? props.entityRows?.[entityRef] : undefined;
  return entityRef && rows?.length ? { entityRef, rows } : undefined;
};
const shell = (props: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => props.block.props?.surface === "plain"
  ? <section data-testid={id} style={{ paddingBottom: 120 }}>{children}</section>
  : <Card size="small" title={String(props.block.props?.title ?? title)} data-testid={id}>{children}</Card>;
const missing = (props: ExperienceBlockRendererProps, id: string, title: string) => shell(props, id, title, <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="区块尚未绑定所需数据" />);

export const uploadOperationForStatus = (status: string) => /failed|error/i.test(status) ? "retryUpload" : /paused/i.test(status) ? "resumeUpload" : /uploading|queued/i.test(status) ? "pauseUpload" : undefined;
export const traceBarPercent = (start: number, duration: number, traceEnd: number) => ({ left: traceEnd > 0 ? Math.max(0, Math.min(100, start / traceEnd * 100)) : 0, width: traceEnd > 0 ? Math.max(2, Math.min(100, duration / traceEnd * 100)) : 2 });
export const expressionToken = (path: string) => `{{$json.${path}}}`;
export const replayEventAt = (rows: Row[], offsetRef: string, offset: number) => [...rows].sort((left, right) => Math.abs(numeric(left, offsetRef) - offset) - Math.abs(numeric(right, offsetRef) - offset))[0];
export const clampGridLayout = (layout: Layout): Layout => ({ x: Math.max(0, Math.min(11, layout.x)), y: Math.max(0, layout.y), w: Math.max(1, Math.min(12 - Math.max(0, Math.min(11, layout.x)), layout.w)), h: Math.max(1, Math.min(4, layout.h)) });
export const filterLogs = (rows: Row[], levelRef: string, level: string) => level === "all" ? rows : rows.filter(row => value(row, levelRef).toLowerCase() === level.toLowerCase());

export const ResumableUploadQueueRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), nameRef = field(props, "fileNameFieldRef"), sizeRef = field(props, "fileSizeFieldRef"), statusRef = field(props, "transferStatusFieldRef"), progressRef = field(props, "transferProgressFieldRef");
  if (!data || !nameRef || !statusRef || !progressRef) return missing(props, "resumable-upload-queue", "断点上传队列");
  const active = data.rows.filter(row => /uploading|queued/i.test(value(row, statusRef))).length;
  return shell(props, "resumable-upload-queue", "断点上传队列", <Flex vertical gap={12}>
    <Upload.Dragger showUploadList={false} multiple beforeUpload={file => { props.onAction?.("editRequest", { entityRef: data.entityRef, fileName: file.name, operation: "enqueueUpload" }); return false; }}><p className="ant-upload-drag-icon"><UploadOutlined /></p><Typography.Text strong>拖入文件或选择文件</Typography.Text><div><Typography.Text type="secondary">分片上传可暂停、恢复和失败重试</Typography.Text></div></Upload.Dragger>
    <Flex justify="space-between"><Typography.Text>{data.rows.length} 个文件 · {active} 个传输中</Typography.Text><Tag color={active ? "processing" : "default"}>{active ? "正在传输" : "队列已静止"}</Tag></Flex>
    <List dataSource={data.rows} renderItem={row => { const status = value(row, statusRef), operation = uploadOperationForStatus(status), complete = /complete/i.test(status); return <List.Item actions={[operation && <Button key="transfer" size="small" icon={operation === "pauseUpload" ? <PauseOutlined /> : <PlayCircleOutlined />} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: row.id, operation, targets: targets(props) })}>{operation === "pauseUpload" ? "暂停" : operation === "resumeUpload" ? "继续" : "重试"}</Button>, !complete && <Button key="cancel" size="small" danger icon={<DeleteOutlined />} aria-label="取消上传" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: row.id, operation: "cancelUpload", targets: targets(props) })} />].filter(Boolean)}><List.Item.Meta title={value(row, nameRef, row.id)} description={<Space><span>{sizeRef ? `${numeric(row, sizeRef)} MB` : ""}</span><Tag color={/failed|error/i.test(status) ? "error" : complete ? "success" : "processing"}>{status}</Tag></Space>} /><Progress percent={Math.max(0, Math.min(100, numeric(row, progressRef)))} size="small" style={{ width: 160 }} status={/failed|error/i.test(status) ? "exception" : complete ? "success" : "active"} /></List.Item>; }} />
  </Flex>);
};

export const DistributedTraceWaterfallRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), nameRef = field(props, "spanNameFieldRef"), parentRef = field(props, "spanParentFieldRef"), startRef = field(props, "spanStartFieldRef"), durationRef = field(props, "spanDurationFieldRef"), statusRef = field(props, "statusFieldRef");
  const [selectedId, setSelectedId] = React.useState("");
  if (!data || !nameRef || !startRef || !durationRef) return missing(props, "distributed-trace-waterfall", "分布式追踪瀑布");
  const traceEnd = Math.max(...data.rows.map(row => numeric(row, startRef) + numeric(row, durationRef)), 1), selected = data.rows.find(row => row.id === selectedId) ?? data.rows[0];
  const depth = (row: Row) => { let level = 0, current = value(row, parentRef), guard = new Set<string>(); while (current && !guard.has(current) && level < 6) { guard.add(current); level += 1; current = value(data.rows.find(item => item.id === current) ?? row, parentRef); } return level; };
  return shell(props, "distributed-trace-waterfall", "分布式追踪瀑布", <Flex gap={12} align="stretch">
    <div style={{ flex: 1, minWidth: 0 }}><Flex vertical gap={6}>{data.rows.map(row => { const bar = traceBarPercent(numeric(row, startRef), numeric(row, durationRef), traceEnd), failed = /failed|error/i.test(value(row, statusRef)); return <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} style={{ display: "grid", gridTemplateColumns: "180px 1fr 64px", alignItems: "center", gap: 8, border: selected.id === row.id ? "1px solid #1677ff" : "1px solid #f0f0f0", background: "#fff", padding: "7px 8px", textAlign: "left", width: "100%", borderRadius: 4 }}><span style={{ paddingLeft: depth(row) * 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value(row, nameRef, row.id)}</span><span style={{ height: 12, background: "#f5f5f5", position: "relative", borderRadius: 3 }}><span style={{ position: "absolute", left: `${bar.left}%`, width: `${bar.width}%`, height: "100%", borderRadius: 3, background: failed ? "#ff4d4f" : "#1677ff" }} /></span><Typography.Text type={failed ? "danger" : "secondary"}>{numeric(row, durationRef)}ms</Typography.Text></button>; })}</Flex></div>
    <Card size="small" title="Span 检查器" style={{ width: 220 }}><Descriptions column={1} size="small" items={[{ key: "name", label: "Span", children: value(selected, nameRef, selected.id) }, { key: "start", label: "起点", children: `${numeric(selected, startRef)}ms` }, { key: "duration", label: "耗时", children: `${numeric(selected, durationRef)}ms` }, { key: "status", label: "状态", children: statusRef ? <Tag>{value(selected, statusRef)}</Tag> : "-" }]} /><Button block onClick={() => props.onAction?.("itemSelect", { entityRef: data.entityRef, rowId: selected.id })}>查看 Span</Button></Card>
  </Flex>);
};

export const ExpressionDataMapperRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), pathRef = field(props, "dataPathFieldRef"), sampleRef = field(props, "sampleValueFieldRef"), typeRef = field(props, "dataTypeFieldRef");
  const [draft, setDraft] = React.useState(String(props.block.props?.expression ?? "")), [selectedId, setSelectedId] = React.useState("");
  if (!data || !pathRef || !sampleRef) return missing(props, "expression-data-mapper", "表达式数据映射器");
  const selected = data.rows.find(row => row.id === selectedId) ?? data.rows[0], exact = data.rows.find(row => draft.trim() === expressionToken(value(row, pathRef)));
  return shell(props, "expression-data-mapper", "表达式数据映射器", <div style={{ display: "grid", gridTemplateColumns: "180px minmax(0,1fr) 190px", gap: 12 }}>
    <Card size="small" title="输入数据"><Tree selectedKeys={[selected.id]} onSelect={keys => keys[0] && setSelectedId(String(keys[0]))} treeData={data.rows.map(row => ({ key: row.id, title: value(row, pathRef, row.id) }))} /><Button block size="small" icon={<PlusOutlined />} onClick={() => setDraft(current => `${current}${current ? " " : ""}${expressionToken(value(selected, pathRef))}`)}>插入字段</Button></Card>
    <Card size="small" title="表达式"><CodeEditor value={draft} onChange={setDraft} height="190px" /><Button type="primary" icon={<SaveOutlined />} disabled={!draft.trim()} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, expression: draft, operation: "saveExpressionMapping", targets: targets(props) })}>保存表达式</Button></Card>
    <Card size="small" title="输出预览"><Descriptions column={1} size="small" items={[{ key: "path", label: "字段", children: value(selected, pathRef) }, { key: "type", label: "类型", children: typeRef ? value(selected, typeRef, "unknown") : "unknown" }, { key: "sample", label: "样本", children: value(selected, sampleRef) }]} /><Alert type={exact ? "success" : "info"} showIcon message={exact ? `解析结果：${value(exact, sampleRef)}` : "复杂表达式将由宿主安全执行"} /></Card>
  </div>);
};

export const SessionReplayScrubberRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), offsetRef = field(props, "eventOffsetFieldRef"), typeRef = field(props, "eventTypeFieldRef"), summaryRef = field(props, "summaryFieldRef"), severityRef = field(props, "severityFieldRef");
  const max = data ? Math.max(...data.rows.map(row => numeric(row, offsetRef)), 1) : 1, [offset, setOffset] = React.useState(0), [playing, setPlaying] = React.useState(false), [speed, setSpeed] = React.useState("1x");
  if (!data || !offsetRef || !typeRef || !summaryRef) return missing(props, "session-replay-scrubber", "会话回放时间轴");
  const current = replayEventAt(data.rows, offsetRef, offset);
  return shell(props, "session-replay-scrubber", "会话回放时间轴", <Flex vertical gap={12}>
    <div style={{ minHeight: 210, background: "#f5f5f5", border: "1px solid #d9d9d9", borderRadius: 4, padding: 24, display: "grid", placeItems: "center" }}><Card size="small" style={{ width: "75%" }}><Typography.Title level={5}>{value(current, typeRef)}</Typography.Title><Typography.Paragraph>{value(current, summaryRef)}</Typography.Paragraph>{severityRef && <Tag color={/error|fatal/i.test(value(current, severityRef)) ? "error" : "processing"}>{value(current, severityRef)}</Tag>}</Card></div>
    <div style={{ position: "relative", padding: "0 8px" }}><Slider min={0} max={max} value={offset} onChange={setOffset} tooltip={{ formatter: next => `${next ?? 0}ms` }} />{data.rows.map(row => <span key={row.id} title={value(row, summaryRef)} style={{ position: "absolute", left: `${numeric(row, offsetRef) / max * 100}%`, top: 8, width: 5, height: 5, borderRadius: "50%", background: /error|fatal/i.test(value(row, severityRef)) ? "#ff4d4f" : "#1677ff", pointerEvents: "none" }} />)}</div>
    <Flex justify="space-between" align="center"><Space><Button icon={playing ? <PauseOutlined /> : <PlayCircleOutlined />} onClick={() => setPlaying(currentPlaying => !currentPlaying)}>{playing ? "暂停" : "播放"}</Button><Typography.Text>{offset}ms / {max}ms</Typography.Text></Space><Segmented size="small" value={speed} onChange={next => setSpeed(String(next))} options={["0.5x", "1x", "2x"]} /></Flex>
  </Flex>);
};

export const DashboardGridComposerRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), titleRef = field(props, "panelTitleFieldRef"), xRef = field(props, "gridXFieldRef"), yRef = field(props, "gridYFieldRef"), wRef = field(props, "gridWidthFieldRef"), hRef = field(props, "gridHeightFieldRef");
  const [selectedId, setSelectedId] = React.useState(""), [changes, setChanges] = React.useState<Record<string, Layout>>({});
  if (!data || !titleRef || !xRef || !yRef || !wRef || !hRef) return missing(props, "dashboard-grid-composer", "仪表盘网格编排器");
  const initial = (row: Row) => clampGridLayout({ x: numeric(row, xRef), y: numeric(row, yRef), w: numeric(row, wRef, 4), h: numeric(row, hRef, 1) }), layout = (row: Row) => changes[row.id] ?? initial(row), selected = data.rows.find(row => row.id === selectedId) ?? data.rows[0];
  const adjust = (delta: Partial<Layout>) => setChanges(current => ({ ...current, [selected.id]: clampGridLayout({ ...layout(selected), ...Object.fromEntries(Object.entries(delta).map(([key, amount]) => [key, layout(selected)[key as keyof Layout] + Number(amount)])) } as Layout) }));
  return shell(props, "dashboard-grid-composer", "仪表盘网格编排器", <Flex gap={12}>
    <div style={{ flex: 1, minHeight: 330, display: "grid", gridTemplateColumns: "repeat(12,1fr)", gridAutoRows: 76, gap: 8, padding: 8, background: "#f5f5f5", borderRadius: 4 }}>{data.rows.map(row => { const item = layout(row); return <Card key={row.id} size="small" hoverable onClick={() => setSelectedId(row.id)} style={{ gridColumn: `${item.x + 1} / span ${item.w}`, gridRow: `${item.y + 1} / span ${item.h}`, borderColor: selected.id === row.id ? "#1677ff" : undefined, overflow: "hidden" }}><Typography.Text strong>{value(row, titleRef, row.id)}</Typography.Text><div><Typography.Text type="secondary">{item.w} × {item.h}</Typography.Text></div></Card>; })}</div>
    <Card size="small" title="面板布局" style={{ width: 220 }}><Typography.Paragraph strong>{value(selected, titleRef)}</Typography.Paragraph><Space wrap><Button icon={<LeftOutlined />} aria-label="左移" onClick={() => adjust({ x: -1 })} /><Button icon={<RightOutlined />} aria-label="右移" onClick={() => adjust({ x: 1 })} /><Button icon={<MinusOutlined />} onClick={() => adjust({ w: -1 })}>收窄</Button><Button icon={<PlusOutlined />} onClick={() => adjust({ w: 1 })}>加宽</Button></Space><Flex vertical gap={8} style={{ marginTop: 12 }}><Button icon={<RedoOutlined />} disabled={!Object.keys(changes).length} onClick={() => setChanges({})}>重置</Button><Button type="primary" icon={<SaveOutlined />} disabled={!Object.keys(changes).length} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, layouts: Object.fromEntries(data.rows.map(row => [row.id, layout(row)])), operation: "saveDashboardLayout", targets: targets(props) })}>保存布局</Button></Flex></Card>
  </Flex>);
};

export const LiveLogTailerRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), timeRef = field(props, "logTimeFieldRef"), levelRef = field(props, "logLevelFieldRef"), messageRef = field(props, "logMessageFieldRef"), streamRef = field(props, "logStreamFieldRef");
  const [paused, setPaused] = React.useState(false), [follow, setFollow] = React.useState(true), [level, setLevel] = React.useState("all"), [selectedId, setSelectedId] = React.useState("");
  if (!data || !timeRef || !levelRef || !messageRef) return missing(props, "live-log-tailer", "实时日志跟随器");
  const rows = filterLogs(data.rows, levelRef, level), selected = data.rows.find(row => row.id === selectedId);
  const toggle = () => { const operation = paused ? "resumeLiveLogs" : "pauseLiveLogs"; setPaused(current => !current); props.onAction?.("submitRequest", { entityRef: data.entityRef, operation, targets: targets(props) }); };
  return shell(props, "live-log-tailer", "实时日志跟随器", <Flex vertical gap={10}>
    <Flex justify="space-between" align="center"><Segmented value={level} onChange={next => setLevel(String(next))} options={[{ label: "全部", value: "all" }, { label: "Info", value: "info" }, { label: "Warn", value: "warn" }, { label: "Error", value: "error" }]} /><Space><span>跟随最新</span><Switch checked={follow} onChange={setFollow} /><Button icon={paused ? <PlayCircleOutlined /> : <PauseOutlined />} onClick={toggle}>{paused ? "继续" : "暂停"}</Button></Space></Flex>
    <div style={{ minHeight: 260, maxHeight: 310, overflow: "auto", background: "#181818", color: "#f5f5f5", borderRadius: 4, padding: 10, fontFamily: "monospace" }}>{rows.map(row => <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} style={{ display: "grid", gridTemplateColumns: "92px 58px 1fr", width: "100%", gap: 8, padding: "5px 4px", border: 0, borderBottom: "1px solid #303030", background: selectedId === row.id ? "#303030" : "transparent", color: "inherit", textAlign: "left" }}><span style={{ color: "#bfbfbf" }}>{value(row, timeRef)}</span><span style={{ color: /error/i.test(value(row, levelRef)) ? "#ff7875" : /warn/i.test(value(row, levelRef)) ? "#ffd666" : "#69b1ff" }}>{value(row, levelRef)}</span><span style={{ overflowWrap: "anywhere" }}>{value(row, messageRef)}</span></button>)}</div>
    {selected && <Alert type={/error/i.test(value(selected, levelRef)) ? "error" : "info"} message={streamRef ? value(selected, streamRef, "默认流") : "日志详情"} description={value(selected, messageRef)} />}
  </Flex>);
};

export const INDEPENDENT_STRUCTURE_BATCH3_LABELS: Record<string, string> = {
  ResumableUploadQueue: "断点上传队列",
  DistributedTraceWaterfall: "分布式追踪瀑布",
  ExpressionDataMapper: "表达式数据映射器",
  SessionReplayScrubber: "会话回放时间轴",
  DashboardGridComposer: "仪表盘网格编排器",
  LiveLogTailer: "实时日志跟随器",
};
