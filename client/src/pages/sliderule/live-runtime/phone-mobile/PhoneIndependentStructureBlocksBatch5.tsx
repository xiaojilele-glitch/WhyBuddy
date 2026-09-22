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
  Slider,
  Space,
  Stepper,
  Steps,
  Switch,
  Tabs,
  Tag,
} from "antd-mobile";
import { AddOutline, DeleteOutline, DownOutline, RedoOutline, UpOutline } from "antd-mobile-icons";
import type { ExperienceBlockRendererProps } from "../block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
type Shelf = "rows" | "columns" | "values";
const field = (props: ExperienceBlockRendererProps, key: string) => String(props.block.binding?.[key] ?? "").trim();
const value = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const numeric = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const targets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const bound = (props: ExperienceBlockRendererProps) => { const entityRef = field(props, "entityRef"), rows = entityRef ? props.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const shell = (props: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => <Card data-testid={`phone-${id}`} title={String(props.block.props?.title ?? title)}><div style={{ paddingBottom: props.block.props?.surface === "plain" ? 144 : 0 }}>{children}</div></Card>;
const empty = (props: ExperienceBlockRendererProps, id: string, title: string) => shell(props, id, title, <ErrorBlock status="empty" title="尚未绑定所需数据" />);
const point = (row: Row, xRef: string, yRef: string) => ({ x: Math.max(7, Math.min(93, numeric(row, xRef))), y: Math.max(7, Math.min(93, numeric(row, yRef))) });
const PhoneMap = ({ rows, xRef, yRef, selectedId, onSelect, polygon = false }: { rows: Row[]; xRef: string; yRef: string; selectedId: string; onSelect: (id: string) => void; polygon?: boolean }) => { const points = rows.map(row => point(row, xRef, yRef)); return <div style={{ position: "relative", height: 220, borderRadius: 4, background: "linear-gradient(90deg,#e6f4ff 1px,transparent 1px),linear-gradient(#e6f4ff 1px,transparent 1px),#f6ffed", backgroundSize: "28px 28px" }}><svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>{polygon ? <polygon points={points.map(item => `${item.x},${item.y}`).join(" ")} fill="rgba(22,119,255,.16)" stroke="#1677ff" strokeWidth="1.4" /> : <polyline points={points.map(item => `${item.x},${item.y}`).join(" ")} fill="none" stroke="#1677ff" strokeWidth="1.4" />}</svg>{rows.map((row, index) => { const p = points[index]; return <Button key={row.id} size="mini" color={row.id === selectedId ? "primary" : "default"} shape="rounded" onClick={() => onSelect(row.id)} style={{ position: "absolute", left: `calc(${p.x}% - 13px)`, top: `calc(${p.y}% - 12px)`, minWidth: 26, padding: 0 }}>{index + 1}</Button>; })}</div>; };

function PhoneGeofenceVertexEditor(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "vertexNameFieldRef"), xRef = field(props, "longitudeFieldRef"), yRef = field(props, "latitudeFieldRef"), [selectedId, setSelectedId] = React.useState(data?.rows[0]?.id ?? ""), [count, setCount] = React.useState(data?.rows.length ?? 0);
  if (!data || !nameRef || !xRef || !yRef) return empty(props, "geofence-vertex-editor", "地图围栏顶点编辑器");
  const visible = data.rows.slice(0, count), selected = visible.find(row => row.id === selectedId) ?? visible[0];
  return shell(props, "geofence-vertex-editor", "地图围栏顶点编辑器", <Space block direction="vertical"><PhoneMap rows={visible} xRef={xRef} yRef={yRef} selectedId={selected.id} onSelect={setSelectedId} polygon /><List><List.Item description={`经度 ${numeric(selected, xRef)} · 纬度 ${numeric(selected, yRef)}`}>{value(selected, nameRef)}</List.Item></List><Grid columns={2} gap={8}><Grid.Item><Button block onClick={() => setCount(current => Math.min(data.rows.length, current + 1))}><AddOutline /> 增加顶点</Button></Grid.Item><Grid.Item><Button block color="danger" disabled={count <= 3} onClick={() => setCount(current => current - 1)}><DeleteOutline /> 删除顶点</Button></Grid.Item></Grid><Button block color="primary" disabled={count < 3} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowIds: visible.map(row => row.id), operation: "saveGeofence", targets: targets(props) })}>保存围栏</Button></Space>);
}

function PhoneRouteStopSequencer(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "stopNameFieldRef"), xRef = field(props, "longitudeFieldRef"), yRef = field(props, "latitudeFieldRef"), statusRef = field(props, "stopStatusFieldRef"), etaRef = field(props, "etaFieldRef"), [order, setOrder] = React.useState(data?.rows.map(row => row.id) ?? []), [selectedId, setSelectedId] = React.useState(data?.rows[0]?.id ?? "");
  if (!data || !nameRef || !xRef || !yRef || !statusRef) return empty(props, "route-stop-sequencer", "路线停靠编排器");
  const rows = order.map(id => data.rows.find(row => row.id === id)!).filter(Boolean), move = (index: number, delta: number) => setOrder(current => { const next = [...current], target = index + delta; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; }), valid = rows.every(row => !/blocked|invalid|阻塞|无效/i.test(value(row, statusRef)));
  return shell(props, "route-stop-sequencer", "路线停靠编排器", <Tabs defaultActiveKey="stops"><Tabs.Tab title="停靠顺序" key="stops"><Steps direction="vertical">{rows.map((row, index) => <Steps.Step key={row.id} title={value(row, nameRef)} description={<Space><Tag color={/blocked|阻塞/i.test(value(row, statusRef)) ? "danger" : "success"}>{value(row, statusRef)}</Tag><span>{etaRef ? value(row, etaRef) : ""}</span><Button size="mini" disabled={!index} onClick={() => move(index, -1)}><UpOutline /></Button><Button size="mini" disabled={index === rows.length - 1} onClick={() => move(index, 1)}><DownOutline /></Button></Space>} />)}</Steps></Tabs.Tab><Tabs.Tab title="路线地图" key="map"><PhoneMap rows={rows} xRef={xRef} yRef={yRef} selectedId={selectedId} onSelect={setSelectedId} /></Tabs.Tab><Tabs.Tab title="发布" key="publish"><ErrorBlock status={valid ? "default" : "busy"} title={valid ? "路线可以发布" : "存在阻塞停靠点"} /><Button block color="primary" disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowIds: order, operation: "publishRoute", targets: targets(props) })}>发布路线</Button></Tabs.Tab></Tabs>);
}

function PhonePivotShelfComposer(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "fieldNameFieldRef"), typeRef = field(props, "fieldTypeFieldRef"), defaultRef = field(props, "defaultShelfFieldRef"), [shelves, setShelves] = React.useState<Record<Shelf, string[]>>({ rows: data?.rows.filter(row => /row|行/i.test(value(row, defaultRef))).map(row => row.id) ?? [], columns: data?.rows.filter(row => /column|列/i.test(value(row, defaultRef))).map(row => row.id) ?? [], values: data?.rows.filter(row => /value|metric|值|指标/i.test(value(row, defaultRef))).map(row => row.id) ?? [] });
  if (!data || !nameRef || !typeRef) return empty(props, "pivot-shelf-composer", "透视字段货架");
  const assign = (id: string, shelf: Shelf) => setShelves(current => ({ rows: current.rows.filter(item => item !== id), columns: current.columns.filter(item => item !== id), values: current.values.filter(item => item !== id), [shelf]: [...current[shelf].filter(item => item !== id), id] })), valid = shelves.rows.length > 0 && shelves.values.length > 0;
  return shell(props, "pivot-shelf-composer", "透视字段货架", <Tabs defaultActiveKey="fields"><Tabs.Tab title="字段" key="fields"><List>{data.rows.map(row => <List.Item key={row.id} description={<Selector columns={3} options={[{ label: "行", value: "rows" }, { label: "列", value: "columns" }, { label: "值", value: "values" }]} onChange={next => assign(row.id, next[0] as Shelf)} />} extra={<Tag>{value(row, typeRef)}</Tag>}>{value(row, nameRef)}</List.Item>)}</List></Tabs.Tab><Tabs.Tab title="货架" key="shelves"><Space block direction="vertical">{(["rows", "columns", "values"] as Shelf[]).map(shelf => <Card key={shelf} title={{ rows: "行维度", columns: "列维度", values: "指标值" }[shelf]}>{shelves[shelf].length ? shelves[shelf].map(id => <Tag key={id}>{value(data.rows.find(row => row.id === id)!, nameRef)}</Tag>) : "未配置"}</Card>)}</Space></Tabs.Tab><Tabs.Tab title="预览" key="preview">{valid ? <Grid columns={3} gap={1}>{["区域", "订单数", "销售额", "杭州", "328", "82.4k", "上海", "271", "69.8k"].map((item, index) => <Grid.Item key={index}><div style={{ padding: 8, background: index < 3 ? "#e6f4ff" : "#f5f5f5" }}>{item}</div></Grid.Item>)}</Grid> : <ErrorBlock status="empty" title="需要行维度和指标" />}<Button block color="primary" disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, shelves, operation: "savePivotLayout", targets: targets(props) })}>保存布局</Button></Tabs.Tab></Tabs>);
}

function PhoneBooleanRuleTreeBuilder(props: ExperienceBlockRendererProps) {
  const data = bound(props), groupRef = field(props, "conditionGroupFieldRef"), logicRef = field(props, "groupLogicFieldRef"), fieldRef = field(props, "conditionFieldFieldRef"), operatorRef = field(props, "operatorFieldRef"), compareRef = field(props, "compareValueFieldRef"), [rootLogic, setRootLogic] = React.useState("and"), [drafts, setDrafts] = React.useState<Record<string, string>>({});
  if (!data || !groupRef || !logicRef || !fieldRef || !operatorRef || !compareRef) return empty(props, "boolean-rule-tree-builder", "布尔规则树构建器");
  const groups = [...new Set(data.rows.map(row => value(row, groupRef)))], valid = data.rows.every(row => (drafts[row.id] ?? value(row, compareRef)).trim());
  return shell(props, "boolean-rule-tree-builder", "布尔规则树构建器", <Space block direction="vertical"><Selector columns={2} value={[rootLogic]} onChange={next => setRootLogic(next[0])} options={[{ label: "全部规则组", value: "and" }, { label: "任一规则组", value: "or" }]} /><Collapse defaultActiveKey={groups}>{groups.map(group => <Collapse.Panel key={group} title={`${group} · ${value(data.rows.find(row => value(row, groupRef) === group)!, logicRef).toUpperCase()}`}><Space block direction="vertical">{data.rows.filter(row => value(row, groupRef) === group).map(row => <Card key={row.id} title={`${value(row, fieldRef)} ${value(row, operatorRef)}`}><Input value={drafts[row.id] ?? value(row, compareRef)} onChange={next => setDrafts(current => ({ ...current, [row.id]: next }))} /></Card>)}</Space></Collapse.Panel>)}</Collapse><Button block color="primary" disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rootLogic, values: drafts, operation: "saveBooleanRuleTree", targets: targets(props) })}>保存规则树</Button></Space>);
}

function PhoneImageCropTransformStudio(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "assetNameFieldRef"), imageRef = field(props, "imageUrlFieldRef"), [rotation, setRotation] = React.useState(0), [mirror, setMirror] = React.useState(false), [width, setWidth] = React.useState(72), [height, setHeight] = React.useState(68);
  if (!data || !nameRef || !imageRef) return empty(props, "image-crop-transform-studio", "图片裁剪调校台");
  const row = data.rows[0];
  return shell(props, "image-crop-transform-studio", "图片裁剪调校台", <Space block direction="vertical"><div style={{ position: "relative", height: 260, display: "grid", placeItems: "center", overflow: "hidden", background: "#111" }}><Image src={value(row, imageRef)} fit="contain" style={{ maxHeight: 240, transform: `rotate(${rotation}deg) scaleX(${mirror ? -1 : 1})` }} /><div style={{ position: "absolute", width: `${width}%`, height: `${height}%`, border: "2px solid white", boxShadow: "0 0 0 999px rgba(0,0,0,.45)" }} /></div><Selector columns={4} options={["自由", "1:1", "4:3", "16:9"].map(item => ({ label: item, value: item }))} /><Grid columns={2} gap={8}><Grid.Item><Button block onClick={() => setRotation(current => (current + 90) % 360)}><RedoOutline /> 旋转</Button></Grid.Item><Grid.Item><Button block color={mirror ? "primary" : "default"} onClick={() => setMirror(current => !current)}>镜像</Button></Grid.Item></Grid><span>裁剪宽度</span><Slider min={10} max={100} value={width} onChange={next => setWidth(Array.isArray(next) ? next[0] : next)} /><span>裁剪高度</span><Slider min={10} max={100} value={height} onChange={next => setHeight(Array.isArray(next) ? next[0] : next)} /><ProgressBar percent={Math.round(width * height / 100)} /><Button block color="primary" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: row.id, transform: { rotation, mirror, width, height }, operation: "applyImageTransform", targets: targets(props) })}>应用变换</Button></Space>);
}

function PhoneDatasetJoinBuilder(props: ExperienceBlockRendererProps) {
  const data = bound(props), sideRef = field(props, "datasetSideFieldRef"), datasetRef = field(props, "datasetNameFieldRef"), columnRef = field(props, "columnNameFieldRef"), typeRef = field(props, "columnTypeFieldRef"), leftRows = data?.rows.filter(row => /left|左|主/i.test(value(row, sideRef))) ?? [], rightRows = data?.rows.filter(row => /right|右|关联/i.test(value(row, sideRef))) ?? [], [left, setLeft] = React.useState(leftRows[0]?.id ?? ""), [right, setRight] = React.useState(rightRows[0]?.id ?? ""), [strategy, setStrategy] = React.useState("left"), [selected, setSelected] = React.useState(data?.rows.map(row => row.id) ?? []);
  if (!data || !sideRef || !datasetRef || !columnRef || !typeRef) return empty(props, "dataset-join-builder", "数据集关联构建器");
  const fieldOptions = (rows: Row[]) => rows.map(row => ({ label: value(row, columnRef), value: row.id })), valid = Boolean(left && right);
  return shell(props, "dataset-join-builder", "数据集关联构建器", <Space block direction="vertical"><Selector columns={3} value={[strategy]} onChange={next => setStrategy(next[0])} options={[{ label: "LEFT", value: "left" }, { label: "INNER", value: "inner" }, { label: "FULL", value: "full" }]} /><Card title={leftRows[0] ? value(leftRows[0], datasetRef) : "左数据集"}><Selector value={left ? [left] : []} onChange={next => setLeft(next[0])} options={fieldOptions(leftRows)} /></Card><div style={{ textAlign: "center", color: "#1677ff", fontWeight: 600 }}>= 关联条件 =</div><Card title={rightRows[0] ? value(rightRows[0], datasetRef) : "右数据集"}><Selector value={right ? [right] : []} onChange={next => setRight(next[0])} options={fieldOptions(rightRows)} /></Card><Collapse><Collapse.Panel key="output" title={`输出字段 ${selected.length}`}><List>{data.rows.map(row => <List.Item key={row.id} extra={<Tag>{value(row, typeRef)}</Tag>}><Checkbox checked={selected.includes(row.id)} onChange={checked => setSelected(current => checked ? [...current, row.id] : current.filter(id => id !== row.id))}>{value(row, columnRef)}</Checkbox></List.Item>)}</List></Collapse.Panel></Collapse><Button block color="primary" disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, strategy, leftColumnId: left, rightColumnId: right, outputColumnIds: selected, operation: "saveDatasetJoin", targets: targets(props) })}>保存关联</Button></Space>);
}

export function renderIndependentStructureBatch5PhoneBlock(props: ExperienceBlockRendererProps): React.ReactNode | undefined {
  switch (props.block.type) {
    case "GeofenceVertexEditor": return <PhoneGeofenceVertexEditor {...props} />;
    case "RouteStopSequencer": return <PhoneRouteStopSequencer {...props} />;
    case "PivotShelfComposer": return <PhonePivotShelfComposer {...props} />;
    case "BooleanRuleTreeBuilder": return <PhoneBooleanRuleTreeBuilder {...props} />;
    case "ImageCropTransformStudio": return <PhoneImageCropTransformStudio {...props} />;
    case "DatasetJoinBuilder": return <PhoneDatasetJoinBuilder {...props} />;
    default: return undefined;
  }
}
