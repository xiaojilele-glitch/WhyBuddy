import React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  Flex,
  Input,
  Progress,
  Segmented,
  Slider,
  Space,
  Statistic,
  Steps,
  Tag,
  Timeline,
  Typography,
} from "antd";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SqlEditor } from "../base-components/custom-components";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
const f = (p: ExperienceBlockRendererProps, key: string) => String(p.block.binding?.[key] ?? "").trim();
const v = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const bound = (p: ExperienceBlockRendererProps) => { const entityRef = f(p, "entityRef"); const rows = entityRef ? p.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const targets = (p: ExperienceBlockRendererProps) => Array.isArray(p.block.binding?.targets) ? p.block.binding.targets.map(String) : [];
const shell = (p: ExperienceBlockRendererProps, testid: string, title: string, body: React.ReactNode) => p.block.props?.surface === "plain" ? <section data-testid={testid} style={{ paddingBottom: 120 }}>{body}</section> : <Card size="small" title={String(p.block.props?.title ?? title)} data-testid={testid}>{body}</Card>;
const missing = (p: ExperienceBlockRendererProps, id: string, title: string) => shell(p, id, title, <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="区块尚未绑定所需数据" />);

export const isRetryableNodeStatus = (status: string) => /failed|error/i.test(status);
export const resolveQueryDraft = (draft: string | undefined, stored: string) => draft ?? stored;
export const calculateBinUsagePercent = (used: number, capacity: number) => capacity > 0 ? Math.max(0, Math.min(100, Math.round(used / capacity * 100))) : 0;
export const canPublishTrafficAllocation = (weights: number[]) => weights.reduce((sum, weight) => sum + weight, 0) === 100;
export const pickScanMatches = (scan: string, expected: string) => scan.trim() === expected;
export const selectUrgentSlaRow = (rows: Row[], deadlineRef: string) => [...rows].sort((left, right) => Date.parse(v(left, deadlineRef)) - Date.parse(v(right, deadlineRef)))[0];

export const WorkflowNodeDebuggerRenderer: ExperienceBlockRenderer = p => {
  const d = bound(p), title = f(p, "titleFieldRef"), status = f(p, "statusFieldRef"), parent = f(p, "nodeParentFieldRef"), message = f(p, "nodeMessageFieldRef");
  const [selectedId, setSelectedId] = React.useState("");
  if (!d || !title || !status) return missing(p, "workflow-node-debugger", "节点调试画布");
  const nodes: Node[] = d.rows.map((row, index) => ({ id: row.id, position: { x: (index % 3) * 170, y: Math.floor(index / 3) * 110 }, data: { label: `${v(row, title, row.id)} · ${v(row, status)}` }, style: { borderColor: isRetryableNodeStatus(v(row, status)) ? "#ff4d4f" : "#91caff", width: 150 } }));
  const edges: Edge[] = parent ? d.rows.filter(row => v(row, parent)).map(row => ({ id: `${v(row, parent)}-${row.id}`, source: v(row, parent), target: row.id, animated: /running/i.test(v(row, status)) })) : [];
  const selected = d.rows.find(row => row.id === selectedId) ?? d.rows.find(row => isRetryableNodeStatus(v(row, status))) ?? d.rows[0];
  return shell(p, "workflow-node-debugger", "节点调试画布", <Flex gap={12}><div style={{ flex: 1, height: 330, minWidth: 0 }}><ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={(_, node) => setSelectedId(node.id)}><Background /><Controls showInteractive={false} /></ReactFlow></div><Card size="small" title="节点检查器" style={{ width: 240 }}><Descriptions size="small" column={1} items={[{ key: "node", label: "节点", children: v(selected, title, selected.id) }, { key: "status", label: "状态", children: <Tag color={isRetryableNodeStatus(v(selected, status)) ? "error" : "processing"}>{v(selected, status)}</Tag> }, { key: "message", label: "输出", children: v(selected, message, "暂无输出") }]} /><Button block disabled={!isRetryableNodeStatus(v(selected, status))} onClick={() => p.onAction?.("submitRequest", { entityRef: d.entityRef, rowId: selected.id, operation: "retryWorkflowNode", targets: targets(p) })}>从此节点重试</Button></Card></Flex>);
};

export const QueryNotebookComposerRenderer: ExperienceBlockRenderer = p => {
  const d = bound(p), title = f(p, "titleFieldRef"), query = f(p, "queryFieldRef"), status = f(p, "statusFieldRef"), count = f(p, "resultCountFieldRef");
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  if (!d || !title || !query) return missing(p, "query-notebook-composer", "查询笔记本");
  return shell(p, "query-notebook-composer", "查询笔记本", <Collapse defaultActiveKey={d.rows[0]?.id} items={d.rows.map((row, index) => ({ key: row.id, label: <Space><Badge count={index + 1} />{v(row, title, `查询 ${index + 1}`)}{status && <Tag>{v(row, status)}</Tag>}</Space>, children: <Flex vertical gap={8}><SqlEditor value={resolveQueryDraft(drafts[row.id], v(row, query))} onChange={next => setDrafts(current => ({ ...current, [row.id]: next }))} height="150px" /><Flex justify="space-between" align="center">{count ? <Statistic title="结果行" value={Number(row.values?.[count] ?? 0)} /> : <span />}<Button type="primary" onClick={() => p.onAction?.("submitRequest", { entityRef: d.entityRef, rowId: row.id, query: resolveQueryDraft(drafts[row.id], v(row, query)), operation: "runNotebookCell", targets: targets(p) })}>运行单元</Button></Flex></Flex> }))} />);
};

export const WarehouseBinHeatmapRenderer: ExperienceBlockRenderer = p => {
  const d = bound(p), name = f(p, "nameFieldRef"), aisle = f(p, "aisleFieldRef"), used = f(p, "binUsedFieldRef"), capacity = f(p, "binCapacityFieldRef");
  const aisles = d && aisle ? [...new Set(d.rows.map(row => v(row, aisle)).filter(Boolean))] : [];
  const [active, setActive] = React.useState(aisles[0] ?? "all");
  if (!d || !name || !aisle || !used || !capacity) return missing(p, "warehouse-bin-heatmap", "仓位热力格");
  const rows = active === "all" ? d.rows : d.rows.filter(row => v(row, aisle) === active);
  return shell(p, "warehouse-bin-heatmap", "仓位热力格", <Flex vertical gap={12}><Segmented value={active} onChange={next => setActive(String(next))} options={[{ label: "全部", value: "all" }, ...aisles.map(value => ({ label: value, value }))]} /><div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>{rows.map(row => { const total = Number(row.values?.[capacity] ?? 0), amount = Number(row.values?.[used] ?? 0), percent = calculateBinUsagePercent(amount, total); return <Card key={row.id} size="small" hoverable onClick={() => p.onAction?.("itemSelect", { entityRef: d.entityRef, rowId: row.id })} style={{ background: percent >= 90 ? "#fff1f0" : percent >= 60 ? "#fffbe6" : "#f6ffed" }}><Typography.Text strong>{v(row, name, row.id)}</Typography.Text><Progress percent={percent} size="small" status={percent >= 100 ? "exception" : "normal"} /><Typography.Text type="secondary">{amount} / {total}</Typography.Text></Card>; })}</div></Flex>);
};

export const ExperimentTrafficAllocatorRenderer: ExperienceBlockRenderer = p => {
  const d = bound(p), name = f(p, "nameFieldRef"), weight = f(p, "variantWeightFieldRef");
  const [weights, setWeights] = React.useState<Record<string, number>>({});
  if (!d || !name || !weight) return missing(p, "experiment-traffic-allocator", "实验流量分配");
  const get = (row: Row) => weights[row.id] ?? Number(row.values?.[weight] ?? 0), total = d.rows.reduce((sum, row) => sum + get(row), 0), publishable = canPublishTrafficAllocation(d.rows.map(get));
  return shell(p, "experiment-traffic-allocator", "实验流量分配", <Flex vertical gap={12}><Progress percent={Math.min(100, total)} status={publishable ? "success" : "exception"} format={() => `${total}% / 100%`} />{d.rows.map(row => <Card size="small" key={row.id}><Flex align="center" gap={16}><Typography.Text strong style={{ width: 110 }}>{v(row, name, row.id)}</Typography.Text><Slider style={{ flex: 1 }} min={0} max={100} value={get(row)} onChange={next => setWeights(current => ({ ...current, [row.id]: next }))} /><Tag>{get(row)}%</Tag></Flex></Card>)}<Button type="primary" disabled={!publishable} onClick={() => p.onAction?.("submitRequest", { entityRef: d.entityRef, weights: Object.fromEntries(d.rows.map(row => [row.id, get(row)])), operation: "publishExperimentAllocation", targets: targets(p) })}>发布流量分配</Button></Flex>);
};

export const SlaBreachClockRenderer: ExperienceBlockRenderer = p => {
  const d = bound(p), title = f(p, "titleFieldRef"), deadline = f(p, "slaDeadlineFieldRef"), status = f(p, "statusFieldRef"), owner = f(p, "slaOwnerFieldRef");
  if (!d || !title || !deadline || !status) return missing(p, "sla-breach-clock", "SLA 响应时钟");
  const selected = selectUrgentSlaRow(d.rows, deadline), remaining = Math.round((Date.parse(v(selected, deadline)) - Date.now()) / 60000), risk = remaining <= 0 ? "error" : remaining <= 60 ? "warning" : "success";
  return shell(p, "sla-breach-clock", "SLA 响应时钟", <Flex gap={20} align="center"><Progress type="dashboard" percent={Math.max(0, Math.min(100, 100 - remaining / 5))} status={risk === "error" ? "exception" : "normal"} format={() => remaining <= 0 ? `超时 ${Math.abs(remaining)}m` : `${remaining}m`} /><div style={{ flex: 1 }}><Typography.Title level={5}>{v(selected, title, selected.id)}</Typography.Title><Timeline items={[{ color: "green", children: "工单已创建" }, { color: risk === "success" ? "blue" : "orange", children: `当前状态：${v(selected, status)}` }, { color: risk === "error" ? "red" : "gray", children: `截止：${v(selected, deadline)}` }]} /><Button danger={risk === "error"} onClick={() => p.onAction?.("submitRequest", { entityRef: d.entityRef, rowId: selected.id, owner: v(selected, owner), operation: "escalateSlaBreach", targets: targets(p) })}>立即升级</Button></div></Flex>);
};

export const WarehousePickRouteScannerRenderer: ExperienceBlockRenderer = p => {
  const d = bound(p), title = f(p, "titleFieldRef"), bin = f(p, "pickBinFieldRef"), expected = f(p, "scanCodeFieldRef"), picked = f(p, "pickedQuantityFieldRef");
  const [current, setCurrent] = React.useState(0), [scan, setScan] = React.useState(""), [error, setError] = React.useState("");
  if (!d || !title || !bin || !expected) return missing(p, "warehouse-pick-route-scanner", "拣货扫描路径");
  const row = d.rows[current];
  const submit = () => { if (!pickScanMatches(scan, v(row, expected))) { setError("扫描码与当前拣货项不匹配"); return; } setError(""); p.onAction?.("submitRequest", { entityRef: d.entityRef, rowId: row.id, scanCode: scan, operation: "confirmPickScan", targets: targets(p) }); setScan(""); setCurrent(index => Math.min(d.rows.length - 1, index + 1)); };
  return shell(p, "warehouse-pick-route-scanner", "拣货扫描路径", <Flex vertical gap={14}><Steps current={current} items={d.rows.map(item => ({ title: v(item, bin), description: `${v(item, title, item.id)}${picked ? ` · 已拣 ${v(item, picked, "0")}` : ""}` }))} /><Card size="small" title={`当前：${v(row, bin)}`}><Space.Compact block><Input value={scan} onChange={event => setScan(event.target.value)} placeholder="扫描商品或容器条码" onPressEnter={submit} /><Button type="primary" onClick={submit}>确认扫描</Button></Space.Compact>{error && <Alert type="error" showIcon message={error} style={{ marginTop: 8 }} />}</Card></Flex>);
};

export const INDEPENDENT_STRUCTURE_BATCH2_LABELS: Record<string, string> = {
  WorkflowNodeDebugger: "节点调试画布",
  QueryNotebookComposer: "查询笔记本",
  WarehouseBinHeatmap: "仓位热力格",
  ExperimentTrafficAllocator: "实验流量分配",
  SlaBreachClock: "SLA 响应时钟",
  WarehousePickRouteScanner: "拣货扫描路径",
};
