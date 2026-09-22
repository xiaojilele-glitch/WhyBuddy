import React from "react";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Collapse,
  Descriptions,
  Empty,
  Flex,
  Image,
  Input,
  List,
  Progress,
  Radio,
  Result,
  Segmented,
  Select,
  Space,
  Steps,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  RotateRightOutlined,
  SaveOutlined,
  ScissorOutlined,
} from "@ant-design/icons";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
type PageDraft = { rotation: number; splitAfter: boolean };
const field = (props: ExperienceBlockRendererProps, key: string) => String(props.block.binding?.[key] ?? "").trim();
const value = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const numeric = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const targets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const bound = (props: ExperienceBlockRendererProps) => { const entityRef = field(props, "entityRef"), rows = entityRef ? props.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const shell = (props: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => props.block.props?.surface === "plain" ? <section data-testid={id} style={{ paddingBottom: 120 }}>{children}</section> : <Card size="small" title={String(props.block.props?.title ?? title)} data-testid={id}>{children}</Card>;
const missing = (props: ExperienceBlockRendererProps, id: string, title: string) => shell(props, id, title, <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="区块尚未绑定所需数据" />);

export const flameWidthPercent = (value: number, levelTotal: number) => levelTotal > 0 ? Math.max(4, Math.min(100, value / levelTotal * 100)) : 4;
export const mergeResolved = (rowIds: string[], choices: Record<string, string>) => rowIds.every(id => ["base", "ours", "theirs"].includes(choices[id]));
export const policyDecision = (effects: string[]) => effects.some(effect => /deny/i.test(effect)) ? "deny" : effects.length && effects.every(effect => /allow|permit/i.test(effect)) ? "allow" : "indeterminate";
export const nextRotation = (rotation: number) => (rotation + 90) % 360;
export const streamConfigurationValid = (mode: string, cursor: string) => !/incremental/i.test(mode) || Boolean(cursor.trim());

export const FlameGraphProfilerRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), nameRef = field(props, "functionNameFieldRef"), parentRef = field(props, "profileParentFieldRef"), depthRef = field(props, "profileDepthFieldRef"), totalRef = field(props, "totalSamplesFieldRef"), selfRef = field(props, "selfSamplesFieldRef");
  const [focusId, setFocusId] = React.useState(""), [selectedId, setSelectedId] = React.useState("");
  if (!data || !nameRef || !depthRef || !totalRef) return missing(props, "flame-graph-profiler", "火焰图性能剖析器");
  const descendants = (root: string) => { const ids = new Set([root]); let changed = true; while (changed) { changed = false; data.rows.forEach(row => { if (ids.has(value(row, parentRef)) && !ids.has(row.id)) { ids.add(row.id); changed = true; } }); } return ids; };
  const visible = focusId ? data.rows.filter(row => descendants(focusId).has(row.id)) : data.rows, levels = [...new Set(visible.map(row => numeric(row, depthRef)))].sort((a, b) => a - b), selected = data.rows.find(row => row.id === selectedId) ?? data.rows.find(row => row.id === focusId) ?? data.rows[0], focus = data.rows.find(row => row.id === focusId);
  return shell(props, "flame-graph-profiler", "火焰图性能剖析器", <Flex vertical gap={10}>
    <Breadcrumb items={[{ title: <Button type="link" size="small" onClick={() => setFocusId("")}>全部调用</Button> }, ...(focus ? [{ title: value(focus, nameRef) }] : [])]} />
    <div style={{ background: "#fff7e6", padding: 10, borderRadius: 4 }}>{levels.map(level => { const rows = visible.filter(row => numeric(row, depthRef) === level), total = rows.reduce((sum, row) => sum + numeric(row, totalRef), 0); return <Flex key={level} gap={3} style={{ marginTop: level ? 3 : 0 }}>{rows.map(row => { const width = flameWidthPercent(numeric(row, totalRef), total); return <Tooltip key={row.id} title={`${value(row, nameRef)} · ${numeric(row, totalRef)} samples`}><button type="button" onClick={() => { setSelectedId(row.id); setFocusId(row.id); }} style={{ width: `${width}%`, minWidth: 42, height: 34, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: selected.id === row.id ? "2px solid #1677ff" : "1px solid #d46b08", background: level % 2 ? "#ffd591" : "#ffe7ba", borderRadius: 3 }}>{value(row, nameRef)}</button></Tooltip>; })}</Flex>; })}</div>
    <Descriptions size="small" column={3} items={[{ key: "name", label: "函数", children: value(selected, nameRef) }, { key: "total", label: "总样本", children: numeric(selected, totalRef) }, { key: "self", label: "自身样本", children: selfRef ? numeric(selected, selfRef) : "-" }]} />
  </Flex>);
};

export const ThreeWayMergeResolverRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), pathRef = field(props, "conflictPathFieldRef"), baseRef = field(props, "baseContentFieldRef"), oursRef = field(props, "oursContentFieldRef"), theirsRef = field(props, "theirsContentFieldRef");
  const [choices, setChoices] = React.useState<Record<string, string>>({});
  if (!data || !pathRef || !baseRef || !oursRef || !theirsRef) return missing(props, "three-way-merge-resolver", "三方冲突合并器");
  const resolved = mergeResolved(data.rows.map(row => row.id), choices);
  return shell(props, "three-way-merge-resolver", "三方冲突合并器", <Flex vertical gap={10}>
    <Alert type={resolved ? "success" : "warning"} showIcon message={resolved ? "所有冲突已选择" : `仍有 ${data.rows.filter(row => !choices[row.id]).length} 个冲突未处理`} />
    <Collapse defaultActiveKey={data.rows[0]?.id} items={data.rows.map(row => ({ key: row.id, label: <Space><Typography.Text strong>{value(row, pathRef)}</Typography.Text>{choices[row.id] && <Tag color="success">已选择 {choices[row.id]}</Tag>}</Space>, children: <Flex vertical gap={8}><div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>{[["base", "共同基线", baseRef], ["ours", "当前分支", oursRef], ["theirs", "传入分支", theirsRef]].map(([key, label, ref]) => <Card key={key} size="small" title={label} style={{ borderColor: choices[row.id] === key ? "#1677ff" : undefined }}><Typography.Paragraph code copyable={{ text: value(row, ref) }} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value(row, ref)}</Typography.Paragraph></Card>)}</div><Radio.Group optionType="button" buttonStyle="solid" value={choices[row.id]} onChange={event => setChoices(current => ({ ...current, [row.id]: event.target.value }))} options={[{ label: "采用基线", value: "base" }, { label: "采用当前", value: "ours" }, { label: "采用传入", value: "theirs" }]} /></Flex> }))} />
    <Button type="primary" icon={<SaveOutlined />} disabled={!resolved} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, choices, operation: "resolveMergeConflicts", targets: targets(props) })}>提交合并结果</Button>
  </Flex>);
};

export const PolicyDecisionSimulatorRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), nameRef = field(props, "policyNameFieldRef"), effectRef = field(props, "policyEffectFieldRef"), reasonRef = field(props, "policyReasonFieldRef");
  const [subject, setSubject] = React.useState(String(props.block.props?.subject ?? "user-1008")), [resource, setResource] = React.useState(String(props.block.props?.resource ?? "orders")), [scope, setScope] = React.useState(String(props.block.props?.scope ?? "read")), [evaluated, setEvaluated] = React.useState(true);
  if (!data || !nameRef || !effectRef) return missing(props, "policy-decision-simulator", "权限决策模拟器");
  const decision = policyDecision(data.rows.map(row => value(row, effectRef)));
  return shell(props, "policy-decision-simulator", "权限决策模拟器", <Flex gap={14} align="stretch">
    <Card size="small" title="评估上下文" style={{ width: 230 }}><Flex vertical gap={10}><Space.Compact block><Button disabled>主体</Button><Input value={subject} onChange={event => { setSubject(event.target.value); setEvaluated(false); }} /></Space.Compact><Space.Compact block><Button disabled>资源</Button><Input value={resource} onChange={event => { setResource(event.target.value); setEvaluated(false); }} /></Space.Compact><Select value={scope} onChange={next => { setScope(next); setEvaluated(false); }} options={["read", "write", "delete"].map(item => ({ label: item, value: item }))} /><Button type="primary" disabled={!subject || !resource || !scope} onClick={() => { setEvaluated(true); props.onAction?.("submitRequest", { entityRef: data.entityRef, subject, resource, scope, operation: "evaluateAccessPolicy", targets: targets(props) }); }}>运行评估</Button></Flex></Card>
    <div style={{ flex: 1 }}>{evaluated ? <><Result status={decision === "allow" ? "success" : decision === "deny" ? "error" : "warning"} title={decision === "allow" ? "允许访问" : decision === "deny" ? "拒绝访问" : "无法确定"} subTitle={`${subject} · ${resource}:${scope}`} /><Steps direction="vertical" size="small" items={data.rows.map(row => ({ title: value(row, nameRef), status: /deny/i.test(value(row, effectRef)) ? "error" : "finish", description: <Space><Tag color={/deny/i.test(value(row, effectRef)) ? "error" : "success"}>{value(row, effectRef)}</Tag>{reasonRef && <span>{value(row, reasonRef)}</span>}</Space> }))} /></> : <Empty description="上下文已变化，请重新评估" />}</div>
  </Flex>);
};

export const FormCanvasBuilderRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), labelRef = field(props, "fieldLabelFieldRef"), typeRef = field(props, "fieldTypeFieldRef"), requiredRef = field(props, "requiredFieldRef");
  const [placed, setPlaced] = React.useState<string[]>(data?.rows.slice(0, 3).map(row => row.id) ?? []), [selectedId, setSelectedId] = React.useState(""), [drafts, setDrafts] = React.useState<Record<string, { label?: string; required?: boolean }>>({});
  if (!data || !labelRef || !typeRef) return missing(props, "form-canvas-builder", "表单画布构建器");
  const selected = data.rows.find(row => row.id === selectedId) ?? data.rows.find(row => placed.includes(row.id)) ?? data.rows[0], config = drafts[selected.id] ?? {};
  return shell(props, "form-canvas-builder", "表单画布构建器", <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0,1fr) 210px", gap: 12 }}>
    <Card size="small" title="字段组件"><List size="small" dataSource={data.rows} renderItem={row => <List.Item actions={[<Button key="add" size="small" icon={<PlusOutlined />} disabled={placed.includes(row.id)} onClick={() => { setPlaced(current => [...current, row.id]); setSelectedId(row.id); }} aria-label="添加字段" />]}><List.Item.Meta title={value(row, labelRef)} description={value(row, typeRef)} /></List.Item>} /></Card>
    <Card size="small" title="表单画布">{placed.length ? <Flex vertical gap={8}>{placed.map(id => { const row = data.rows.find(item => item.id === id)!; return <Card key={id} size="small" hoverable onClick={() => setSelectedId(id)} style={{ borderColor: selected.id === id ? "#1677ff" : undefined }}><Flex justify="space-between"><span>{drafts[id]?.label ?? value(row, labelRef)}{(drafts[id]?.required ?? /true|required/i.test(value(row, requiredRef))) && <Typography.Text type="danger"> *</Typography.Text>}</span><Tag>{value(row, typeRef)}</Tag></Flex></Card>; })}</Flex> : <Empty description="从左侧添加字段" />}</Card>
    <Card size="small" title="字段属性"><Flex vertical gap={10}><Space.Compact block><Button disabled>标题</Button><Input value={config.label ?? value(selected, labelRef)} onChange={event => setDrafts(current => ({ ...current, [selected.id]: { ...current[selected.id], label: event.target.value } }))} /></Space.Compact><Flex justify="space-between"><span>必填</span><Switch checked={config.required ?? /true|required/i.test(value(selected, requiredRef))} onChange={checked => setDrafts(current => ({ ...current, [selected.id]: { ...current[selected.id], required: checked } }))} /></Flex><Button danger icon={<DeleteOutlined />} disabled={!placed.includes(selected.id)} onClick={() => setPlaced(current => current.filter(id => id !== selected.id))}>移出画布</Button><Button type="primary" icon={<SaveOutlined />} disabled={!placed.length} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, fields: placed.map(id => ({ rowId: id, ...drafts[id] })), operation: "saveFormSchema", targets: targets(props) })}>保存表单</Button></Flex></Card>
  </div>);
};

export const PdfPageOrganizerRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), pageRef = field(props, "pageNumberFieldRef"), imageRef = field(props, "thumbnailFieldRef");
  const [order, setOrder] = React.useState(data?.rows.map(row => row.id) ?? []), [selectedId, setSelectedId] = React.useState(""), [drafts, setDrafts] = React.useState<Record<string, PageDraft>>({});
  if (!data || !pageRef || !imageRef) return missing(props, "pdf-page-organizer", "PDF 页面整理器");
  const selected = data.rows.find(row => row.id === selectedId) ?? data.rows.find(row => order.includes(row.id)) ?? data.rows[0], draft = drafts[selected.id] ?? { rotation: 0, splitAfter: false };
  const move = (delta: number) => setOrder(current => { const index = current.indexOf(selected.id), next = Math.max(0, Math.min(current.length - 1, index + delta)); if (index === next) return current; const copy = [...current]; copy.splice(index, 1); copy.splice(next, 0, selected.id); return copy; });
  return shell(props, "pdf-page-organizer", "PDF 页面整理器", <Flex vertical gap={10}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>{order.map(id => { const row = data.rows.find(item => item.id === id)!; return <Card key={id} size="small" hoverable onClick={() => setSelectedId(id)} style={{ borderColor: selected.id === id ? "#1677ff" : undefined }} cover={<Image preview={false} height={105} src={value(row, imageRef)} fallback="/brand/logo.png" style={{ objectFit: "contain", transform: `rotate(${drafts[id]?.rotation ?? 0}deg)` }} />}><Flex justify="space-between"><span>第 {value(row, pageRef)} 页</span>{drafts[id]?.splitAfter && <Tag color="warning">拆分</Tag>}</Flex></Card>; })}</div>
    <Card size="small"><Flex justify="space-between" align="center"><Typography.Text strong>第 {value(selected, pageRef)} 页 · 旋转 {draft.rotation}°</Typography.Text><Space><Button icon={<ArrowUpOutlined />} aria-label="前移" onClick={() => move(-1)} /><Button icon={<ArrowDownOutlined />} aria-label="后移" onClick={() => move(1)} /><Button icon={<RotateRightOutlined />} onClick={() => setDrafts(current => ({ ...current, [selected.id]: { ...draft, rotation: nextRotation(draft.rotation) } }))}>旋转</Button><Button icon={<ScissorOutlined />} type={draft.splitAfter ? "primary" : "default"} onClick={() => setDrafts(current => ({ ...current, [selected.id]: { ...draft, splitAfter: !draft.splitAfter } }))}>页后拆分</Button><Button danger icon={<DeleteOutlined />} disabled={order.length <= 1} onClick={() => setOrder(current => current.filter(id => id !== selected.id))}>删除</Button><Button type="primary" icon={<SaveOutlined />} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, pages: order.map(id => ({ rowId: id, rotation: drafts[id]?.rotation ?? 0, splitAfter: drafts[id]?.splitAfter ?? false })), operation: "savePdfPageOperations", targets: targets(props) })}>保存</Button></Space></Flex></Card>
  </Flex>);
};

export const StreamReplicationConfiguratorRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), namespaceRef = field(props, "namespaceFieldRef"), nameRef = field(props, "streamNameFieldRef"), modeRef = field(props, "syncModeFieldRef"), cursorRef = field(props, "cursorFieldRef"), pkRef = field(props, "primaryKeyFieldRef");
  const [configs, setConfigs] = React.useState<Record<string, { selected: boolean; mode: string; cursor: string; pk: string }>>({});
  if (!data || !namespaceRef || !nameRef || !modeRef) return missing(props, "stream-replication-configurator", "数据流复制配置器");
  const get = (row: Row) => configs[row.id] ?? { selected: true, mode: value(row, modeRef, "full_refresh"), cursor: value(row, cursorRef), pk: value(row, pkRef) }, namespaces = [...new Set(data.rows.map(row => value(row, namespaceRef)))], selected = data.rows.filter(row => get(row).selected), valid = selected.length > 0 && selected.every(row => streamConfigurationValid(get(row).mode, get(row).cursor));
  const update = (row: Row, patch: Partial<ReturnType<typeof get>>) => setConfigs(current => ({ ...current, [row.id]: { ...get(row), ...patch } }));
  return shell(props, "stream-replication-configurator", "数据流复制配置器", <Flex vertical gap={10}>
    <Alert type={valid ? "success" : "warning"} showIcon message={valid ? `已选择 ${selected.length} 个数据流` : "至少选择一个数据流，增量模式必须设置游标"} />
    <Collapse defaultActiveKey={namespaces[0]} items={namespaces.map(namespace => ({ key: namespace, label: `${namespace} · ${data.rows.filter(row => value(row, namespaceRef) === namespace && get(row).selected).length}/${data.rows.filter(row => value(row, namespaceRef) === namespace).length}`, children: <Flex vertical gap={8}>{data.rows.filter(row => value(row, namespaceRef) === namespace).map(row => { const config = get(row), rowValid = streamConfigurationValid(config.mode, config.cursor); return <Card key={row.id} size="small" style={{ borderColor: !rowValid && config.selected ? "#faad14" : undefined }}><Flex gap={10} align="center"><Checkbox checked={config.selected} onChange={event => update(row, { selected: event.target.checked })}>{value(row, nameRef)}</Checkbox><Segmented size="small" value={config.mode} onChange={next => update(row, { mode: String(next) })} options={[{ label: "全量", value: "full_refresh" }, { label: "增量", value: "incremental" }]} /><Input size="small" value={config.cursor} disabled={!/incremental/i.test(config.mode)} onChange={event => update(row, { cursor: event.target.value })} placeholder="游标字段" style={{ width: 120 }} /><Input size="small" value={config.pk} onChange={event => update(row, { pk: event.target.value })} placeholder="主键" style={{ width: 100 }} />{!rowValid && config.selected && <Tag color="warning">缺少游标</Tag>}</Flex></Card>; })}</Flex> }))} />
    <Button type="primary" icon={<SaveOutlined />} disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, streams: selected.map(row => ({ rowId: row.id, ...get(row) })), operation: "saveReplicationCatalog", targets: targets(props) })}>保存复制配置</Button>
  </Flex>);
};

export const INDEPENDENT_STRUCTURE_BATCH4_LABELS: Record<string, string> = {
  FlameGraphProfiler: "火焰图性能剖析器",
  ThreeWayMergeResolver: "三方冲突合并器",
  PolicyDecisionSimulator: "权限决策模拟器",
  FormCanvasBuilder: "表单画布构建器",
  PdfPageOrganizer: "PDF 页面整理器",
  StreamReplicationConfigurator: "数据流复制配置器",
};
