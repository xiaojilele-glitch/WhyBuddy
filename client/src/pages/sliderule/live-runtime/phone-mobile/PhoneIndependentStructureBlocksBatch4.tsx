import React from "react";
import {
  Button,
  Card,
  Checkbox,
  Collapse,
  ErrorBlock,
  Grid,
  Image,
  Input,
  List,
  ProgressBar,
  Selector,
  Space,
  Steps,
  Switch,
  Tabs,
  Tag,
} from "antd-mobile";
import {
  AddOutline,
  DeleteOutline,
  DownOutline,
  LeftOutline,
  RedoOutline,
  RightOutline,
  UpOutline,
} from "antd-mobile-icons";
import type { ExperienceBlockRendererProps } from "../block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
type PageDraft = { rotation: number; splitAfter: boolean };
const field = (props: ExperienceBlockRendererProps, key: string) => String(props.block.binding?.[key] ?? "").trim();
const value = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const numeric = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const targets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const bound = (props: ExperienceBlockRendererProps) => { const entityRef = field(props, "entityRef"), rows = entityRef ? props.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const shell = (props: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => <Card data-testid={`phone-${id}`} title={String(props.block.props?.title ?? title)}><div style={{ paddingBottom: props.block.props?.surface === "plain" ? 144 : 0 }}>{children}</div></Card>;
const empty = (props: ExperienceBlockRendererProps, id: string, title: string) => shell(props, id, title, <ErrorBlock status="empty" title="尚未绑定所需数据" />);
const decisionOf = (effects: string[]) => effects.some(effect => /deny/i.test(effect)) ? "deny" : effects.length && effects.every(effect => /allow|permit/i.test(effect)) ? "allow" : "indeterminate";
const streamValid = (mode: string, cursor: string) => !/incremental/i.test(mode) || Boolean(cursor.trim());

function PhoneFlameGraphProfiler(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "functionNameFieldRef"), depthRef = field(props, "profileDepthFieldRef"), totalRef = field(props, "totalSamplesFieldRef"), selfRef = field(props, "selfSamplesFieldRef");
  const [selectedId, setSelectedId] = React.useState("");
  if (!data || !nameRef || !depthRef || !totalRef) return empty(props, "flame-graph-profiler", "火焰图性能剖析器");
  const max = Math.max(...data.rows.map(row => numeric(row, totalRef)), 1), selected = data.rows.find(row => row.id === selectedId) ?? data.rows[0];
  return shell(props, "flame-graph-profiler", "火焰图性能剖析器", <Tabs defaultActiveKey="flame"><Tabs.Tab title="火焰" key="flame"><Space block direction="vertical">{[...new Set(data.rows.map(row => numeric(row, depthRef)))].sort().map(depth => <div key={depth} style={{ display: "flex", gap: 3 }}>{data.rows.filter(row => numeric(row, depthRef) === depth).map(row => <Button key={row.id} size="mini" color={selected.id === row.id ? "primary" : "default"} onClick={() => setSelectedId(row.id)} style={{ flex: Math.max(1, numeric(row, totalRef)), overflow: "hidden" }}>{value(row, nameRef)}</Button>)}</div>)}</Space></Tabs.Tab><Tabs.Tab title="调用树" key="tree"><List>{[...data.rows].sort((left, right) => numeric(right, totalRef) - numeric(left, totalRef)).map(row => <List.Item key={row.id} clickable onClick={() => setSelectedId(row.id)} description={<ProgressBar percent={Math.round(numeric(row, totalRef) / max * 100)} />} extra={`${numeric(row, totalRef)} samples`}>{value(row, nameRef)}</List.Item>)}</List></Tabs.Tab></Tabs>);
}

function PhoneThreeWayMergeResolver(props: ExperienceBlockRendererProps) {
  const data = bound(props), pathRef = field(props, "conflictPathFieldRef"), baseRef = field(props, "baseContentFieldRef"), oursRef = field(props, "oursContentFieldRef"), theirsRef = field(props, "theirsContentFieldRef");
  const [choices, setChoices] = React.useState<Record<string, string>>({});
  if (!data || !pathRef || !baseRef || !oursRef || !theirsRef) return empty(props, "three-way-merge-resolver", "三方冲突合并器");
  const resolved = data.rows.every(row => Boolean(choices[row.id]));
  return shell(props, "three-way-merge-resolver", "三方冲突合并器", <Space block direction="vertical"><Tag color={resolved ? "success" : "warning"}>{resolved ? "冲突全部已选择" : `未处理 ${data.rows.filter(row => !choices[row.id]).length} 项`}</Tag><Collapse accordion defaultActiveKey={data.rows[0]?.id}>{data.rows.map(row => <Collapse.Panel key={row.id} title={value(row, pathRef)}><Tabs><Tabs.Tab title="基线" key="base"><pre style={{ whiteSpace: "pre-wrap" }}>{value(row, baseRef)}</pre></Tabs.Tab><Tabs.Tab title="当前" key="ours"><pre style={{ whiteSpace: "pre-wrap" }}>{value(row, oursRef)}</pre></Tabs.Tab><Tabs.Tab title="传入" key="theirs"><pre style={{ whiteSpace: "pre-wrap" }}>{value(row, theirsRef)}</pre></Tabs.Tab></Tabs><Selector columns={3} options={[{ label: "基线", value: "base" }, { label: "当前", value: "ours" }, { label: "传入", value: "theirs" }]} value={choices[row.id] ? [choices[row.id]] : []} onChange={next => setChoices(current => ({ ...current, [row.id]: next[0] }))} /></Collapse.Panel>)}</Collapse><Button block color="primary" disabled={!resolved} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, choices, operation: "resolveMergeConflicts", targets: targets(props) })}>提交合并结果</Button></Space>);
}

function PhonePolicyDecisionSimulator(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "policyNameFieldRef"), effectRef = field(props, "policyEffectFieldRef"), reasonRef = field(props, "policyReasonFieldRef");
  const [subject, setSubject] = React.useState(String(props.block.props?.subject ?? "user-1008")), [resource, setResource] = React.useState(String(props.block.props?.resource ?? "orders")), [scopes, setScopes] = React.useState<string[]>([String(props.block.props?.scope ?? "read")]), [evaluated, setEvaluated] = React.useState(true);
  if (!data || !nameRef || !effectRef) return empty(props, "policy-decision-simulator", "权限决策模拟器");
  const decision = decisionOf(data.rows.map(row => value(row, effectRef)));
  return shell(props, "policy-decision-simulator", "权限决策模拟器", <Space block direction="vertical"><Input value={subject} onChange={next => { setSubject(next); setEvaluated(false); }} placeholder="主体" /><Input value={resource} onChange={next => { setResource(next); setEvaluated(false); }} placeholder="资源" /><Selector columns={3} options={["read", "write", "delete"].map(item => ({ label: item, value: item }))} value={scopes} onChange={next => { setScopes(next); setEvaluated(false); }} /><Button block color="primary" disabled={!subject || !resource || !scopes[0]} onClick={() => { setEvaluated(true); props.onAction?.("submitRequest", { entityRef: data.entityRef, subject, resource, scope: scopes[0], operation: "evaluateAccessPolicy", targets: targets(props) }); }}>运行评估</Button>{evaluated ? <><Card><strong style={{ color: decision === "allow" ? "#00b578" : "#cf1322" }}>{decision === "allow" ? "允许访问" : decision === "deny" ? "拒绝访问" : "无法确定"}</strong><div>{subject} · {resource}:{scopes[0]}</div></Card><Steps direction="vertical">{data.rows.map(row => <Steps.Step key={row.id} title={value(row, nameRef)} status={/deny/i.test(value(row, effectRef)) ? "error" : "finish"} description={`${value(row, effectRef)}${reasonRef ? ` · ${value(row, reasonRef)}` : ""}`} />)}</Steps></> : <ErrorBlock status="default" title="上下文已变化，请重新评估" />}</Space>);
}

function PhoneFormCanvasBuilder(props: ExperienceBlockRendererProps) {
  const data = bound(props), labelRef = field(props, "fieldLabelFieldRef"), typeRef = field(props, "fieldTypeFieldRef"), requiredRef = field(props, "requiredFieldRef");
  const [placed, setPlaced] = React.useState<string[]>(data?.rows.slice(0, 3).map(row => row.id) ?? []), [selectedId, setSelectedId] = React.useState(""), [drafts, setDrafts] = React.useState<Record<string, { label?: string; required?: boolean }>>({});
  if (!data || !labelRef || !typeRef) return empty(props, "form-canvas-builder", "表单画布构建器");
  const selected = data.rows.find(row => row.id === selectedId) ?? data.rows.find(row => placed.includes(row.id)) ?? data.rows[0], config = drafts[selected.id] ?? {};
  return shell(props, "form-canvas-builder", "表单画布构建器", <Tabs defaultActiveKey="canvas"><Tabs.Tab title="组件" key="palette"><List>{data.rows.map(row => <List.Item key={row.id} description={value(row, typeRef)} extra={<Button size="mini" disabled={placed.includes(row.id)} onClick={() => { setPlaced(current => [...current, row.id]); setSelectedId(row.id); }}><AddOutline /></Button>}>{value(row, labelRef)}</List.Item>)}</List></Tabs.Tab><Tabs.Tab title="画布" key="canvas"><List>{placed.map(id => { const row = data.rows.find(item => item.id === id)!; return <List.Item key={id} clickable onClick={() => setSelectedId(id)} extra={<Tag>{value(row, typeRef)}</Tag>}>{drafts[id]?.label ?? value(row, labelRef)}{(drafts[id]?.required ?? /true|required/i.test(value(row, requiredRef))) ? " *" : ""}</List.Item>; })}</List></Tabs.Tab><Tabs.Tab title="属性" key="props"><Space block direction="vertical"><Input value={config.label ?? value(selected, labelRef)} onChange={next => setDrafts(current => ({ ...current, [selected.id]: { ...current[selected.id], label: next } }))} /><Checkbox checked={config.required ?? /true|required/i.test(value(selected, requiredRef))} onChange={checked => setDrafts(current => ({ ...current, [selected.id]: { ...current[selected.id], required: checked } }))}>必填</Checkbox><Button block color="danger" disabled={!placed.includes(selected.id)} onClick={() => setPlaced(current => current.filter(id => id !== selected.id))}><DeleteOutline /> 移出画布</Button><Button block color="primary" disabled={!placed.length} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, fields: placed.map(id => ({ rowId: id, ...drafts[id] })), operation: "saveFormSchema", targets: targets(props) })}>保存表单</Button></Space></Tabs.Tab></Tabs>);
}

function PhonePdfPageOrganizer(props: ExperienceBlockRendererProps) {
  const data = bound(props), pageRef = field(props, "pageNumberFieldRef"), imageRef = field(props, "thumbnailFieldRef");
  const [order, setOrder] = React.useState(data?.rows.map(row => row.id) ?? []), [selectedId, setSelectedId] = React.useState(""), [drafts, setDrafts] = React.useState<Record<string, PageDraft>>({});
  if (!data || !pageRef || !imageRef) return empty(props, "pdf-page-organizer", "PDF 页面整理器");
  const selected = data.rows.find(row => row.id === selectedId) ?? data.rows.find(row => order.includes(row.id)) ?? data.rows[0], draft = drafts[selected.id] ?? { rotation: 0, splitAfter: false };
  const move = (delta: number) => setOrder(current => { const index = current.indexOf(selected.id), next = Math.max(0, Math.min(current.length - 1, index + delta)), copy = [...current]; copy.splice(index, 1); copy.splice(next, 0, selected.id); return copy; });
  return shell(props, "pdf-page-organizer", "PDF 页面整理器", <Space block direction="vertical"><Grid columns={2} gap={8}>{order.map(id => { const row = data.rows.find(item => item.id === id)!; return <Grid.Item key={id}><Card onClick={() => setSelectedId(id)} style={{ border: selected.id === id ? "1px solid #1677ff" : undefined }}><Image width="100%" height={110} fit="contain" src={value(row, imageRef)} fallback="/brand/logo.png" style={{ transform: `rotate(${drafts[id]?.rotation ?? 0}deg)` }} /><div>第 {value(row, pageRef)} 页 {drafts[id]?.splitAfter ? "· 拆分" : ""}</div></Card></Grid.Item>; })}</Grid><Card><strong>第 {value(selected, pageRef)} 页 · {draft.rotation}°</strong><Grid columns={4} gap={6}><Grid.Item><Button block aria-label="前移" onClick={() => move(-1)}><UpOutline /></Button></Grid.Item><Grid.Item><Button block aria-label="后移" onClick={() => move(1)}><DownOutline /></Button></Grid.Item><Grid.Item><Button block aria-label="旋转" onClick={() => setDrafts(current => ({ ...current, [selected.id]: { ...draft, rotation: (draft.rotation + 90) % 360 } }))}><RedoOutline /></Button></Grid.Item><Grid.Item><Button block color={draft.splitAfter ? "primary" : "default"} onClick={() => setDrafts(current => ({ ...current, [selected.id]: { ...draft, splitAfter: !draft.splitAfter } }))}>拆</Button></Grid.Item></Grid><Button block color="danger" disabled={order.length <= 1} onClick={() => setOrder(current => current.filter(id => id !== selected.id))}><DeleteOutline /> 删除页面</Button></Card><Button block color="primary" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, pages: order.map(id => ({ rowId: id, rotation: drafts[id]?.rotation ?? 0, splitAfter: drafts[id]?.splitAfter ?? false })), operation: "savePdfPageOperations", targets: targets(props) })}>保存页面操作</Button></Space>);
}

function PhoneStreamReplicationConfigurator(props: ExperienceBlockRendererProps) {
  const data = bound(props), namespaceRef = field(props, "namespaceFieldRef"), nameRef = field(props, "streamNameFieldRef"), modeRef = field(props, "syncModeFieldRef"), cursorRef = field(props, "cursorFieldRef"), pkRef = field(props, "primaryKeyFieldRef");
  const [configs, setConfigs] = React.useState<Record<string, { selected: boolean; mode: string; cursor: string; pk: string }>>({});
  if (!data || !namespaceRef || !nameRef || !modeRef) return empty(props, "stream-replication-configurator", "数据流复制配置器");
  const get = (row: Row) => configs[row.id] ?? { selected: true, mode: value(row, modeRef, "full_refresh"), cursor: value(row, cursorRef), pk: value(row, pkRef) }, update = (row: Row, patch: Partial<ReturnType<typeof get>>) => setConfigs(current => ({ ...current, [row.id]: { ...get(row), ...patch } })), selected = data.rows.filter(row => get(row).selected), valid = selected.length > 0 && selected.every(row => streamValid(get(row).mode, get(row).cursor)), namespaces = [...new Set(data.rows.map(row => value(row, namespaceRef)))];
  return shell(props, "stream-replication-configurator", "数据流复制配置器", <Space block direction="vertical"><Tag color={valid ? "success" : "warning"}>{valid ? `已选择 ${selected.length} 个流` : "增量流必须设置游标"}</Tag><Collapse accordion defaultActiveKey={namespaces[0]}>{namespaces.map(namespace => <Collapse.Panel key={namespace} title={namespace}>{data.rows.filter(row => value(row, namespaceRef) === namespace).map(row => { const config = get(row); return <Card key={row.id}><List><List.Item extra={<Switch checked={config.selected} onChange={checked => update(row, { selected: checked })} />}>{value(row, nameRef)}</List.Item></List><Selector columns={2} options={[{ label: "全量", value: "full_refresh" }, { label: "增量", value: "incremental" }]} value={[config.mode]} onChange={next => update(row, { mode: next[0] })} /><Input value={config.cursor} disabled={!/incremental/i.test(config.mode)} onChange={next => update(row, { cursor: next })} placeholder="游标字段" /><Input value={config.pk} onChange={next => update(row, { pk: next })} placeholder="主键字段" />{config.selected && !streamValid(config.mode, config.cursor) && <Tag color="warning">缺少游标</Tag>}</Card>; })}</Collapse.Panel>)}</Collapse><Button block color="primary" disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, streams: selected.map(row => ({ rowId: row.id, ...get(row) })), operation: "saveReplicationCatalog", targets: targets(props) })}>保存复制配置</Button></Space>);
}

export function renderIndependentStructureBatch4PhoneBlock(props: ExperienceBlockRendererProps): React.ReactNode | undefined {
  switch (props.block.type) {
    case "FlameGraphProfiler": return <PhoneFlameGraphProfiler {...props} />;
    case "ThreeWayMergeResolver": return <PhoneThreeWayMergeResolver {...props} />;
    case "PolicyDecisionSimulator": return <PhonePolicyDecisionSimulator {...props} />;
    case "FormCanvasBuilder": return <PhoneFormCanvasBuilder {...props} />;
    case "PdfPageOrganizer": return <PhonePdfPageOrganizer {...props} />;
    case "StreamReplicationConfigurator": return <PhoneStreamReplicationConfigurator {...props} />;
    default: return undefined;
  }
}
