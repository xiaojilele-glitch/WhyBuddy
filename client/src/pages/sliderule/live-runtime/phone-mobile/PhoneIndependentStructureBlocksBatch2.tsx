import React from "react";
import {
  Button,
  Card,
  Collapse,
  ErrorBlock,
  Grid,
  Input,
  List,
  ProgressBar,
  Slider,
  Space,
  Steps,
  Tag,
  TextArea,
} from "antd-mobile";
import type { ExperienceBlockRendererProps } from "../block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
const field = (props: ExperienceBlockRendererProps, key: string) => String(props.block.binding?.[key] ?? "").trim();
const value = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const targets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const bound = (props: ExperienceBlockRendererProps) => {
  const entityRef = field(props, "entityRef");
  const rows = entityRef ? props.entityRows?.[entityRef] : undefined;
  return entityRef && rows?.length ? { entityRef, rows } : undefined;
};
const shell = (props: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => (
  <Card data-testid={`phone-${id}`} title={String(props.block.props?.title ?? title)}>
    <div style={{ paddingBottom: props.block.props?.surface === "plain" ? 144 : 0 }}>{children}</div>
  </Card>
);
const empty = (props: ExperienceBlockRendererProps, id: string, title: string) => shell(
  props,
  id,
  title,
  <ErrorBlock status="empty" title="尚未绑定所需数据" />,
);

function PhoneWorkflowNodeDebugger(props: ExperienceBlockRendererProps) {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), statusRef = field(props, "statusFieldRef"), messageRef = field(props, "nodeMessageFieldRef");
  const [selectedId, setSelectedId] = React.useState("");
  if (!data || !titleRef || !statusRef) return empty(props, "workflow-node-debugger", "节点调试画布");
  const selected = data.rows.find(row => row.id === selectedId) ?? data.rows.find(row => /failed|error/i.test(value(row, statusRef))) ?? data.rows[0];
  return shell(props, "workflow-node-debugger", "节点调试画布", <Space block direction="vertical">
    <Steps direction="vertical">
      {data.rows.map(row => <Steps.Step key={row.id} title={<Button fill="none" size="mini" onClick={() => setSelectedId(row.id)}>{value(row, titleRef, row.id)}</Button>} status={/failed|error/i.test(value(row, statusRef)) ? "error" : /complete|success/i.test(value(row, statusRef)) ? "finish" : "process"} description={value(row, statusRef)} />)}
    </Steps>
    <Card><strong>{value(selected, titleRef, selected.id)}</strong><div>{value(selected, messageRef, "暂无输出")}</div></Card>
    <Button block color="primary" disabled={!/failed|error/i.test(value(selected, statusRef))} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: selected.id, operation: "retryWorkflowNode", targets: targets(props) })}>从此节点重试</Button>
  </Space>);
}

function PhoneQueryNotebookComposer(props: ExperienceBlockRendererProps) {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), queryRef = field(props, "queryFieldRef"), countRef = field(props, "resultCountFieldRef");
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  if (!data || !titleRef || !queryRef) return empty(props, "query-notebook-composer", "查询笔记本");
  return shell(props, "query-notebook-composer", "查询笔记本", <Collapse accordion defaultActiveKey={data.rows[0]?.id}>
    {data.rows.map((row, index) => <Collapse.Panel key={row.id} title={`${index + 1}. ${value(row, titleRef)}`}>
      <TextArea rows={5} value={drafts[row.id] ?? value(row, queryRef)} onChange={next => setDrafts(current => ({ ...current, [row.id]: next }))} />
      <List><List.Item extra={countRef ? value(row, countRef, "0") : "-"}>结果行</List.Item></List>
      <Button block color="primary" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: row.id, query: drafts[row.id] ?? value(row, queryRef), operation: "runNotebookCell", targets: targets(props) })}>运行单元</Button>
    </Collapse.Panel>)}
  </Collapse>);
}

function PhoneWarehouseBinHeatmap(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "nameFieldRef"), aisleRef = field(props, "aisleFieldRef"), usedRef = field(props, "binUsedFieldRef"), capacityRef = field(props, "binCapacityFieldRef");
  if (!data || !nameRef || !aisleRef || !usedRef || !capacityRef) return empty(props, "warehouse-bin-heatmap", "仓位热力格");
  return shell(props, "warehouse-bin-heatmap", "仓位热力格", <Grid columns={2} gap={8}>
    {data.rows.map(row => {
      const total = Number(row.values?.[capacityRef] ?? 0), amount = Number(row.values?.[usedRef] ?? 0), percent = total > 0 ? Math.round(amount / total * 100) : 0;
      return <Grid.Item key={row.id}><Card onClick={() => props.onAction?.("itemSelect", { entityRef: data.entityRef, rowId: row.id })}><strong>{value(row, nameRef)}</strong><div>{value(row, aisleRef)}</div><ProgressBar percent={percent} /><small>{amount} / {total}</small></Card></Grid.Item>;
    })}
  </Grid>);
}

function PhoneExperimentTrafficAllocator(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "nameFieldRef"), weightRef = field(props, "variantWeightFieldRef");
  const [weights, setWeights] = React.useState<Record<string, number>>({});
  if (!data || !nameRef || !weightRef) return empty(props, "experiment-traffic-allocator", "实验流量分配");
  const getWeight = (row: Row) => weights[row.id] ?? Number(row.values?.[weightRef] ?? 0);
  const total = data.rows.reduce((sum, row) => sum + getWeight(row), 0);
  return shell(props, "experiment-traffic-allocator", "实验流量分配", <Space block direction="vertical">
    <ProgressBar percent={Math.min(100, total)} />
    {data.rows.map(row => <Card key={row.id}><List><List.Item extra={<Tag color="primary">{getWeight(row)}%</Tag>}>{value(row, nameRef)}</List.Item></List><Slider min={0} max={100} value={getWeight(row)} onChange={next => { if (typeof next === "number") setWeights(current => ({ ...current, [row.id]: next })); }} /></Card>)}
    <Button block color="primary" disabled={total !== 100} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, weights: Object.fromEntries(data.rows.map(row => [row.id, getWeight(row)])), operation: "publishExperimentAllocation", targets: targets(props) })}>发布流量分配 · {total}%</Button>
  </Space>);
}

function PhoneSlaBreachClock(props: ExperienceBlockRendererProps) {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), deadlineRef = field(props, "slaDeadlineFieldRef"), statusRef = field(props, "statusFieldRef"), ownerRef = field(props, "slaOwnerFieldRef");
  if (!data || !titleRef || !deadlineRef || !statusRef) return empty(props, "sla-breach-clock", "SLA 响应时钟");
  const selected = [...data.rows].sort((left, right) => Date.parse(value(left, deadlineRef)) - Date.parse(value(right, deadlineRef)))[0];
  const minutes = Math.round((Date.parse(value(selected, deadlineRef)) - Date.now()) / 60000);
  return shell(props, "sla-breach-clock", "SLA 响应时钟", <Space block direction="vertical">
    <Card><div style={{ fontSize: 30, fontWeight: 700, color: minutes <= 0 ? "#cf1322" : "#1677ff" }}>{minutes <= 0 ? `超时 ${Math.abs(minutes)}m` : `剩余 ${minutes}m`}</div><strong>{value(selected, titleRef, selected.id)}</strong><div>{value(selected, statusRef)} · {value(selected, deadlineRef)}</div></Card>
    <Button block color="danger" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: selected.id, owner: value(selected, ownerRef), operation: "escalateSlaBreach", targets: targets(props) })}>立即升级</Button>
  </Space>);
}

function PhoneWarehousePickRouteScanner(props: ExperienceBlockRendererProps) {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), binRef = field(props, "pickBinFieldRef"), scanCodeRef = field(props, "scanCodeFieldRef");
  const [current, setCurrent] = React.useState(0), [scan, setScan] = React.useState(""), [error, setError] = React.useState("");
  if (!data || !titleRef || !binRef || !scanCodeRef) return empty(props, "warehouse-pick-route-scanner", "拣货扫描路径");
  const row = data.rows[current];
  const submit = () => {
    if (scan.trim() !== value(row, scanCodeRef)) {
      setError("扫描码与当前拣货项不匹配");
      return;
    }
    setError("");
    props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: row.id, scanCode: scan, operation: "confirmPickScan", targets: targets(props) });
    setScan("");
    setCurrent(index => Math.min(data.rows.length - 1, index + 1));
  };
  return shell(props, "warehouse-pick-route-scanner", "拣货扫描路径", <Space block direction="vertical">
    <Steps>{data.rows.map(item => <Steps.Step key={item.id} title={value(item, binRef)} description={value(item, titleRef)} />)}</Steps>
    <Card><strong>当前：{value(row, binRef)}</strong><Input value={scan} onChange={setScan} placeholder="扫描商品或容器条码" clearable /><Button block color="primary" onClick={submit}>确认扫描</Button>{error && <div role="alert" style={{ color: "#cf1322" }}>{error}</div>}</Card>
  </Space>);
}

export function renderIndependentStructureBatch2PhoneBlock(props: ExperienceBlockRendererProps): React.ReactNode | undefined {
  switch (props.block.type) {
    case "WorkflowNodeDebugger": return <PhoneWorkflowNodeDebugger {...props} />;
    case "QueryNotebookComposer": return <PhoneQueryNotebookComposer {...props} />;
    case "WarehouseBinHeatmap": return <PhoneWarehouseBinHeatmap {...props} />;
    case "ExperimentTrafficAllocator": return <PhoneExperimentTrafficAllocator {...props} />;
    case "SlaBreachClock": return <PhoneSlaBreachClock {...props} />;
    case "WarehousePickRouteScanner": return <PhoneWarehousePickRouteScanner {...props} />;
    default: return undefined;
  }
}
