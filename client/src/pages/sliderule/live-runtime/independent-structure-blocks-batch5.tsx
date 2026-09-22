import React from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Flex,
  Image,
  Input,
  InputNumber,
  List,
  Progress,
  Segmented,
  Select,
  Space,
  Steps,
  Switch,
  Tag,
  Typography,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  RotateRightOutlined,
  SaveOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
type Shelf = "rows" | "columns" | "values";
const field = (props: ExperienceBlockRendererProps, key: string) => String(props.block.binding?.[key] ?? "").trim();
const value = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const numeric = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const targets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const bound = (props: ExperienceBlockRendererProps) => { const entityRef = field(props, "entityRef"), rows = entityRef ? props.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const shell = (props: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => props.block.props?.surface === "plain" ? <section data-testid={id} style={{ paddingBottom: 120 }}>{children}</section> : <Card size="small" title={String(props.block.props?.title ?? title)} data-testid={id}>{children}</Card>;
const missing = (props: ExperienceBlockRendererProps, id: string, title: string) => shell(props, id, title, <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="区块尚未绑定所需数据" />);

export const polygonCanSave = (vertices: Array<{ x: number; y: number }>) => vertices.length >= 3 && new Set(vertices.map(point => `${point.x}:${point.y}`)).size >= 3;
export const routeCanPublish = (statuses: string[]) => statuses.length >= 2 && statuses.every(status => !/blocked|invalid|阻塞|无效/i.test(status));
export const pivotCanPreview = (shelves: Record<Shelf, string[]>) => shelves.rows.length > 0 && shelves.values.length > 0;
export const conditionTreeValid = (rows: Array<{ field: string; operator: string; compare: string }>) => rows.length > 0 && rows.every(row => row.field.trim() && row.operator.trim() && row.compare.trim());
export const cropCanApply = (width: number, height: number) => Number.isFinite(width) && Number.isFinite(height) && width >= 10 && height >= 10;
export const joinCanRun = (left: string, right: string) => Boolean(left.trim() && right.trim());

const normalizedPoint = (row: Row, xRef: string, yRef: string) => ({ x: Math.max(5, Math.min(95, numeric(row, xRef))), y: Math.max(5, Math.min(95, numeric(row, yRef))) });
const MapSurface = ({ rows, xRef, yRef, selectedId, onSelect, polygon = false }: { rows: Row[]; xRef: string; yRef: string; selectedId: string; onSelect: (id: string) => void; polygon?: boolean }) => {
  const points = rows.map(row => normalizedPoint(row, xRef, yRef));
  return <div style={{ position: "relative", minHeight: 260, overflow: "hidden", borderRadius: 6, background: "linear-gradient(90deg,#e6f4ff 1px,transparent 1px),linear-gradient(#e6f4ff 1px,transparent 1px),#f6ffed", backgroundSize: "32px 32px" }}>
    {polygon && <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}><polygon points={points.map(point => `${point.x},${point.y}`).join(" ")} fill="rgba(22,119,255,.16)" stroke="#1677ff" strokeWidth="1.2" /></svg>}
    {!polygon && points.slice(1).map((point, index) => { const previous = points[index]; const dx = point.x - previous.x, dy = point.y - previous.y; return <div key={`${rows[index].id}-line`} style={{ position: "absolute", left: `${previous.x}%`, top: `${previous.y}%`, width: `${Math.hypot(dx, dy)}%`, height: 2, background: "#1677ff", transformOrigin: "left", transform: `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)` }} />; })}
    {rows.map((row, index) => { const point = points[index]; return <Button key={row.id} type={selectedId === row.id ? "primary" : "default"} shape="circle" size="small" aria-label={`选择点 ${index + 1}`} onClick={() => onSelect(row.id)} style={{ position: "absolute", left: `calc(${point.x}% - 14px)`, top: `calc(${point.y}% - 14px)`, zIndex: 2 }}>{index + 1}</Button>; })}
  </div>;
};

export const GeofenceVertexEditorRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), nameRef = field(props, "vertexNameFieldRef"), xRef = field(props, "longitudeFieldRef"), yRef = field(props, "latitudeFieldRef");
  const [selectedId, setSelectedId] = React.useState(data?.rows[0]?.id ?? ""), [vertices, setVertices] = React.useState(data?.rows ?? []);
  if (!data || !nameRef || !xRef || !yRef) return missing(props, "geofence-vertex-editor", "地图围栏顶点编辑器");
  const selected = vertices.find(row => row.id === selectedId) ?? vertices[0], points = vertices.map(row => normalizedPoint(row, xRef, yRef)), valid = polygonCanSave(points);
  return shell(props, "geofence-vertex-editor", "地图围栏顶点编辑器", <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 220px", gap: 12 }}>
    <MapSurface rows={vertices} xRef={xRef} yRef={yRef} selectedId={selected.id} onSelect={setSelectedId} polygon />
    <Card size="small" title={<Space><EnvironmentOutlined />围栏顶点</Space>}><Flex vertical gap={10}><List size="small" dataSource={vertices} renderItem={(row, index) => <List.Item onClick={() => setSelectedId(row.id)} extra={<Tag color={row.id === selected.id ? "blue" : "default"}>P{index + 1}</Tag>}>{value(row, nameRef, `顶点 ${index + 1}`)}</List.Item>} /><Space.Compact block><InputNumber aria-label="经度" value={numeric(selected, xRef)} min={0} max={100} /><InputNumber aria-label="纬度" value={numeric(selected, yRef)} min={0} max={100} /></Space.Compact><Button icon={<PlusOutlined />} onClick={() => setVertices(current => [...current, { id: `draft-${current.length}`, values: { [nameRef]: `新顶点 ${current.length + 1}`, [xRef]: 50, [yRef]: 50 }, createdAt: new Date().toISOString() }])}>增加顶点</Button><Button danger icon={<DeleteOutlined />} disabled={vertices.length <= 3} onClick={() => setVertices(current => current.filter(row => row.id !== selected.id))}>删除顶点</Button><Button type="primary" icon={<SaveOutlined />} disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, vertices: vertices.map(row => ({ rowId: row.id, ...normalizedPoint(row, xRef, yRef) })), operation: "saveGeofence", targets: targets(props) })}>保存围栏</Button></Flex></Card>
  </div>);
};

export const RouteStopSequencerRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), nameRef = field(props, "stopNameFieldRef"), xRef = field(props, "longitudeFieldRef"), yRef = field(props, "latitudeFieldRef"), statusRef = field(props, "stopStatusFieldRef"), etaRef = field(props, "etaFieldRef");
  const [order, setOrder] = React.useState(data?.rows.map(row => row.id) ?? []), [selectedId, setSelectedId] = React.useState(data?.rows[0]?.id ?? "");
  if (!data || !nameRef || !xRef || !yRef || !statusRef) return missing(props, "route-stop-sequencer", "路线停靠编排器");
  const rows = order.map(id => data.rows.find(row => row.id === id)!).filter(Boolean), move = (index: number, delta: number) => setOrder(current => { const next = [...current], target = index + delta; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; }), valid = routeCanPublish(rows.map(row => value(row, statusRef)));
  return shell(props, "route-stop-sequencer", "路线停靠编排器", <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(230px,.8fr)", gap: 12 }}>
    <MapSurface rows={rows} xRef={xRef} yRef={yRef} selectedId={selectedId} onSelect={setSelectedId} />
    <Flex vertical gap={10}><Steps direction="vertical" size="small" current={Math.max(0, rows.findIndex(row => row.id === selectedId))} items={rows.map((row, index) => ({ title: <Space><span>{value(row, nameRef)}</span><Tag color={/blocked|阻塞/i.test(value(row, statusRef)) ? "error" : "success"}>{value(row, statusRef)}</Tag></Space>, description: <Space><span>{etaRef ? value(row, etaRef) : ""}</span><Button size="small" icon={<ArrowUpOutlined />} disabled={!index} onClick={() => move(index, -1)} aria-label="上移停靠点" /><Button size="small" icon={<ArrowDownOutlined />} disabled={index === rows.length - 1} onClick={() => move(index, 1)} aria-label="下移停靠点" /></Space>, onClick: () => setSelectedId(row.id) }))} /><Alert type={valid ? "success" : "error"} showIcon message={valid ? "路线可发布" : "存在阻塞停靠点"} /><Button type="primary" disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowIds: order, operation: "publishRoute", targets: targets(props) })}>发布路线</Button></Flex>
  </div>);
};

export const PivotShelfComposerRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), nameRef = field(props, "fieldNameFieldRef"), typeRef = field(props, "fieldTypeFieldRef"), defaultRef = field(props, "defaultShelfFieldRef");
  const initial = React.useMemo(() => ({ rows: data?.rows.filter(row => /row|行/i.test(value(row, defaultRef))).map(row => row.id) ?? [], columns: data?.rows.filter(row => /column|列/i.test(value(row, defaultRef))).map(row => row.id) ?? [], values: data?.rows.filter(row => /value|metric|值|指标/i.test(value(row, defaultRef))).map(row => row.id) ?? [] }), [data, defaultRef]);
  const [shelves, setShelves] = React.useState<Record<Shelf, string[]>>(initial), valid = pivotCanPreview(shelves);
  if (!data || !nameRef || !typeRef) return missing(props, "pivot-shelf-composer", "透视字段货架");
  const assign = (id: string, shelf: Shelf) => setShelves(current => ({ rows: current.rows.filter(item => item !== id), columns: current.columns.filter(item => item !== id), values: current.values.filter(item => item !== id), [shelf]: [...current[shelf].filter(item => item !== id), id] }));
  const ShelfCard = ({ shelf, title }: { shelf: Shelf; title: string }) => <Card size="small" title={title} styles={{ body: { minHeight: 72 } }}><Flex wrap gap={6}>{shelves[shelf].map(id => { const row = data.rows.find(item => item.id === id)!; return <Tag key={id} closable onClose={() => setShelves(current => ({ ...current, [shelf]: current[shelf].filter(item => item !== id) }))}>{value(row, nameRef)}</Tag>; })}</Flex></Card>;
  return shell(props, "pivot-shelf-composer", "透视字段货架", <div style={{ display: "grid", gridTemplateColumns: "190px minmax(0,1fr)", gap: 12 }}>
    <Card size="small" title="数据字段"><List size="small" dataSource={data.rows} renderItem={row => <List.Item><Flex vertical gap={5} style={{ width: "100%" }}><Space><Typography.Text>{value(row, nameRef)}</Typography.Text><Tag>{value(row, typeRef)}</Tag></Space><Segmented size="small" block options={[{ label: "行", value: "rows" }, { label: "列", value: "columns" }, { label: "值", value: "values" }]} onChange={next => assign(row.id, next as Shelf)} /></Flex></List.Item>} /></Card>
    <Flex vertical gap={10}><div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}><ShelfCard shelf="rows" title="行维度" /><ShelfCard shelf="columns" title="列维度" /><ShelfCard shelf="values" title="指标值" /></div><Card size="small" title="透视预览">{valid ? <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "#d9d9d9" }}>{["华东 / 本月", "订单数", "销售额", "杭州", "328", "¥82.4k", "上海", "271", "¥69.8k"].map((item, index) => <div key={index} style={{ padding: 8, background: index < 3 ? "#e6f4ff" : "white", fontWeight: index < 3 ? 600 : 400 }}>{item}</div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="至少配置一个行维度和一个指标" />}</Card><Button type="primary" disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, shelves, operation: "savePivotLayout", targets: targets(props) })}>保存透视布局</Button></Flex>
  </div>);
};

export const BooleanRuleTreeBuilderRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), groupRef = field(props, "conditionGroupFieldRef"), logicRef = field(props, "groupLogicFieldRef"), fieldRef = field(props, "conditionFieldFieldRef"), operatorRef = field(props, "operatorFieldRef"), compareRef = field(props, "compareValueFieldRef");
  const [logic, setLogic] = React.useState<Record<string, string>>({}), [drafts, setDrafts] = React.useState<Record<string, string>>({});
  if (!data || !groupRef || !logicRef || !fieldRef || !operatorRef || !compareRef) return missing(props, "boolean-rule-tree-builder", "布尔规则树构建器");
  const groups = [...new Set(data.rows.map(row => value(row, groupRef)))], checks = data.rows.map(row => ({ field: value(row, fieldRef), operator: value(row, operatorRef), compare: drafts[row.id] ?? value(row, compareRef) })), valid = conditionTreeValid(checks);
  return shell(props, "boolean-rule-tree-builder", "布尔规则树构建器", <Flex vertical gap={10}>
    <Card size="small" title={<Space><Tag color="blue">ROOT</Tag><span>满足以下规则组</span></Space>}><Segmented value={logic.root ?? "and"} onChange={next => setLogic(current => ({ ...current, root: String(next) }))} options={[{ label: "全部 AND", value: "and" }, { label: "任一 OR", value: "or" }]} /></Card>
    <Collapse defaultActiveKey={groups} items={groups.map((group, groupIndex) => ({ key: group, label: <Space><Tag color="purple">组 {groupIndex + 1}</Tag><span>{group}</span></Space>, children: <Flex vertical gap={8}><Segmented size="small" value={logic[group] ?? value(data.rows.find(row => value(row, groupRef) === group)!, logicRef, "and")} onChange={next => setLogic(current => ({ ...current, [group]: String(next) }))} options={[{ label: "组内 AND", value: "and" }, { label: "组内 OR", value: "or" }]} />{data.rows.filter(row => value(row, groupRef) === group).map(row => <Space.Compact key={row.id} block><Button disabled>{value(row, fieldRef)}</Button><Select value={value(row, operatorRef)} options={["equals", "contains", "greater_than"].map(item => ({ label: item, value: item }))} style={{ width: 130 }} /><Input value={drafts[row.id] ?? value(row, compareRef)} onChange={event => setDrafts(current => ({ ...current, [row.id]: event.target.value }))} /></Space.Compact>)}</Flex> }))} />
    <Alert type={valid ? "success" : "error"} showIcon message={valid ? `${groups.length} 个规则组可以保存` : "存在不完整条件"} /><Button type="primary" disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rootLogic: logic.root ?? "and", groupLogic: logic, values: drafts, operation: "saveBooleanRuleTree", targets: targets(props) })}>保存规则树</Button>
  </Flex>);
};

export const ImageCropTransformStudioRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), nameRef = field(props, "assetNameFieldRef"), imageRef = field(props, "imageUrlFieldRef");
  const [rotation, setRotation] = React.useState(0), [mirror, setMirror] = React.useState(false), [ratio, setRatio] = React.useState("4:3"), [width, setWidth] = React.useState(72), [height, setHeight] = React.useState(68);
  if (!data || !nameRef || !imageRef) return missing(props, "image-crop-transform-studio", "图片裁剪调校台");
  const row = data.rows[0], valid = cropCanApply(width, height);
  return shell(props, "image-crop-transform-studio", "图片裁剪调校台", <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 210px", gap: 12 }}>
    <div style={{ position: "relative", minHeight: 300, display: "grid", placeItems: "center", overflow: "hidden", borderRadius: 6, background: "#141414" }}><Image preview={false} src={value(row, imageRef)} alt={value(row, nameRef)} style={{ maxHeight: 280, transform: `rotate(${rotation}deg) scaleX(${mirror ? -1 : 1})`, transition: "transform .2s" }} /><div style={{ position: "absolute", width: `${width}%`, height: `${height}%`, border: "2px solid white", boxShadow: "0 0 0 999px rgba(0,0,0,.48)", backgroundImage: "linear-gradient(90deg,transparent 32.8%,rgba(255,255,255,.7) 33%,transparent 33.2%,transparent 66.2%,rgba(255,255,255,.7) 66.4%,transparent 66.6%),linear-gradient(transparent 32.8%,rgba(255,255,255,.7) 33%,transparent 33.2%,transparent 66.2%,rgba(255,255,255,.7) 66.4%,transparent 66.6%)" }} /></div>
    <Card size="small" title={value(row, nameRef)}><Flex vertical gap={12}><Segmented block value={ratio} onChange={next => setRatio(String(next))} options={["自由", "1:1", "4:3", "16:9"]} /><Space.Compact block><Button icon={<RotateRightOutlined />} onClick={() => setRotation(current => (current + 90) % 360)}>旋转</Button><Button icon={<SwapOutlined />} type={mirror ? "primary" : "default"} onClick={() => setMirror(current => !current)}>镜像</Button></Space.Compact><Typography.Text type="secondary">裁剪宽度</Typography.Text><Space.Compact block><InputNumber min={10} max={100} value={width} onChange={next => setWidth(Number(next ?? 10))} style={{ width: "100%" }} /><Button disabled>%</Button></Space.Compact><Typography.Text type="secondary">裁剪高度</Typography.Text><Space.Compact block><InputNumber min={10} max={100} value={height} onChange={next => setHeight(Number(next ?? 10))} style={{ width: "100%" }} /><Button disabled>%</Button></Space.Compact><Progress percent={Math.round(width * height / 100)} size="small" /><Button type="primary" disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: row.id, transform: { rotation, mirror, ratio, width, height }, operation: "applyImageTransform", targets: targets(props) })}>应用变换</Button></Flex></Card>
  </div>);
};

export const DatasetJoinBuilderRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props), sideRef = field(props, "datasetSideFieldRef"), datasetRef = field(props, "datasetNameFieldRef"), columnRef = field(props, "columnNameFieldRef"), typeRef = field(props, "columnTypeFieldRef");
  const leftRows = data?.rows.filter(row => /left|左|主/i.test(value(row, sideRef))) ?? [], rightRows = data?.rows.filter(row => /right|右|关联/i.test(value(row, sideRef))) ?? [], [left, setLeft] = React.useState(leftRows[0]?.id ?? ""), [right, setRight] = React.useState(rightRows[0]?.id ?? ""), [strategy, setStrategy] = React.useState("left"), [selected, setSelected] = React.useState<string[]>(data?.rows.map(row => row.id) ?? []);
  if (!data || !sideRef || !datasetRef || !columnRef || !typeRef) return missing(props, "dataset-join-builder", "数据集关联构建器");
  const valid = joinCanRun(left, right), leftRow = leftRows.find(row => row.id === left), rightRow = rightRows.find(row => row.id === right);
  const ColumnList = ({ rows, active, onSelect }: { rows: Row[]; active: string; onSelect: (id: string) => void }) => <List size="small" dataSource={rows} renderItem={row => <List.Item onClick={() => onSelect(row.id)} style={{ background: row.id === active ? "#e6f4ff" : undefined, paddingInline: 8 }} extra={<Tag>{value(row, typeRef)}</Tag>}><Checkbox checked={selected.includes(row.id)} onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))}>{value(row, columnRef)}</Checkbox></List.Item>} />;
  return shell(props, "dataset-join-builder", "数据集关联构建器", <Flex vertical gap={12}>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 150px minmax(0,1fr)", gap: 10, alignItems: "center" }}><Card size="small" title={leftRows[0] ? value(leftRows[0], datasetRef) : "左数据集"}><ColumnList rows={leftRows} active={left} onSelect={setLeft} /></Card><Flex vertical align="center" gap={8}><Segmented value={strategy} onChange={next => setStrategy(String(next))} options={[{ label: "LEFT", value: "left" }, { label: "INNER", value: "inner" }, { label: "FULL", value: "full" }]} /><Tag color="blue">{leftRow ? value(leftRow, columnRef) : "?"} = {rightRow ? value(rightRow, columnRef) : "?"}</Tag><SwapOutlined style={{ fontSize: 24, color: "#1677ff" }} /></Flex><Card size="small" title={rightRows[0] ? value(rightRows[0], datasetRef) : "右数据集"}><ColumnList rows={rightRows} active={right} onSelect={setRight} /></Card></div>
    <Alert type={valid ? "success" : "warning"} showIcon message={valid ? `将输出 ${selected.length} 个字段` : "请分别选择左右关联字段"} /><Button type="primary" disabled={!valid} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, strategy, leftColumnId: left, rightColumnId: right, outputColumnIds: selected, operation: "saveDatasetJoin", targets: targets(props) })}>保存关联</Button>
  </Flex>);
};

export const INDEPENDENT_STRUCTURE_BATCH5_LABELS: Record<string, string> = {
  GeofenceVertexEditor: "地图围栏顶点编辑器",
  RouteStopSequencer: "路线停靠编排器",
  PivotShelfComposer: "透视字段货架",
  BooleanRuleTreeBuilder: "布尔规则树构建器",
  ImageCropTransformStudio: "图片裁剪调校台",
  DatasetJoinBuilder: "数据集关联构建器",
};
