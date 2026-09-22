import React from "react";
import { Card, Empty, Table } from "antd";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";
import EchartsChart from "./EchartsChart";

type Row = { id: string; values?: Record<string, unknown> };
type Option = Record<string, unknown>;

const numeric = (value: unknown) =>
  value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
    ? null
    : Number(value);
const field = (props: ExperienceBlockRendererProps, key: string) => String(props.block.binding?.[key] ?? "").trim();
const fields = (props: ExperienceBlockRendererProps, key: string) => Array.isArray(props.block.binding?.[key]) ? (props.block.binding?.[key] as unknown[]).map(String).filter(Boolean) : [];
const bound = (props: ExperienceBlockRendererProps) => {
  const entityRef = String(props.block.binding?.entityRef ?? "").trim();
  return entityRef && props.entityRows?.[entityRef] ? { entityRef, rows: props.entityRows[entityRef] as Row[] } : null;
};
const aggregate = (rows: Row[], keyRef: string, valueRef?: string) => {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = String(row.values?.[keyRef] ?? "").trim();
    const value = valueRef ? numeric(row.values?.[valueRef]) : 1;
    if (key && value !== null) map.set(key, (map.get(key) ?? 0) + value);
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
};
const quartiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => { const index = (sorted.length - 1) * p; const lo = Math.floor(index); const hi = Math.ceil(index); return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo); };
  return sorted.length ? [sorted[0], at(.25), at(.5), at(.75), sorted.at(-1)!] : [];
};

function Surface({ props, testid, hint, option, table }: { props: ExperienceBlockRendererProps; testid: string; hint: string; option?: Option; table?: React.ReactNode }) {
  if (props.children != null) return <>{props.children}</>;
  const title = String(props.block.props?.title ?? "");
  return <Card size="small" variant="borderless" title={title || undefined} data-testid={testid} styles={{ body: { padding: 12 } }}>
    {table ?? (option ? <EchartsChart option={option} height={220} ariaLabel={title || testid} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={hint} />)}
  </Card>;
}
const axes = { animation: false, tooltip: { trigger: "axis", confine: true }, grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true } };

const FunnelConversionChart: ExperienceBlockRenderer = props => {
  const data = bound(props), stage = field(props, "stageFieldRef"), value = field(props, "valueFieldRef");
  const grouped = data && stage ? aggregate(data.rows, stage, value || undefined) : [];
  const order = Array.isArray(props.block.props?.stages) ? props.block.props.stages.map(String) : [];
  const sorted = order.length ? order.flatMap(name => grouped.filter(item => item.name === name)) : grouped.sort((a, b) => b.value - a.value);
  return <Surface props={props} testid="funnel-conversion-chart" hint="尚未绑定有效的阶段与转化值" option={sorted.length ? { animation: false, tooltip: { trigger: "item", confine: true }, series: [{ type: "funnel", sort: "none", left: "5%", right: "5%", top: 8, bottom: 8, gap: 2, label: { formatter: "{b}  {c}" }, data: sorted }] } : undefined} />;
};
const HistogramDistributionChart: ExperienceBlockRenderer = props => {
  const data = bound(props), valueRef = field(props, "valueFieldRef"), values = data && valueRef ? data.rows.map(row => numeric(row.values?.[valueRef])).filter((v): v is number => v !== null) : [];
  const count = Math.max(3, Math.min(20, Number(props.block.props?.bins ?? 8))), min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 0, width = max === min ? 1 : (max - min) / count, bins = Array.from({ length: count }, () => 0);
  values.forEach(value => bins[Math.min(count - 1, Math.floor((value - min) / width))]++);
  const labels = bins.map((_, i) => `${(min + i * width).toFixed(1)}-${(min + (i + 1) * width).toFixed(1)}`);
  return <Surface props={props} testid="histogram-distribution-chart" hint="尚未绑定可计算的数值字段" option={values.length ? { ...axes, xAxis: { type: "category", data: labels, axisLabel: { rotate: 25 } }, yAxis: { type: "value", minInterval: 1 }, series: [{ type: "bar", data: bins, barGap: 0 }] } : undefined} />;
};
const ScatterCorrelationChart: ExperienceBlockRenderer = props => {
  const data = bound(props), x = field(props, "xFieldRef"), y = field(props, "yFieldRef"), category = field(props, "categoryFieldRef");
  const points = data && x && y ? data.rows.flatMap(row => { const xv = numeric(row.values?.[x]), yv = numeric(row.values?.[y]); return xv === null || yv === null ? [] : [{ value: [xv, yv], name: category ? String(row.values?.[category] ?? "") : row.id }]; }) : [];
  return <Surface props={props} testid="scatter-correlation-chart" hint="尚未绑定成对的数值字段" option={points.length ? { ...axes, tooltip: { trigger: "item", confine: true }, xAxis: { type: "value" }, yAxis: { type: "value" }, series: [{ type: "scatter", data: points, symbolSize: 9 }] } : undefined} />;
};
const BoxPlotDistributionChart: ExperienceBlockRenderer = props => {
  const data = bound(props), category = field(props, "categoryFieldRef"), value = field(props, "valueFieldRef"), groups = new Map<string, number[]>();
  if (data && category && value) for (const row of data.rows) { const key = String(row.values?.[category] ?? "").trim(), number = numeric(row.values?.[value]); if (key && number !== null) groups.set(key, [...(groups.get(key) ?? []), number]); }
  const entries = [...groups.entries()];
  return <Surface props={props} testid="box-plot-distribution-chart" hint="尚未绑定分类与数值字段" option={entries.length ? { ...axes, tooltip: { trigger: "item", confine: true }, xAxis: { type: "category", data: entries.map(([name]) => name) }, yAxis: { type: "value" }, series: [{ type: "boxplot", data: entries.map(([, values]) => quartiles(values)) }] } : undefined} />;
};
const WaterfallVarianceChart: ExperienceBlockRenderer = props => {
  const data = bound(props), category = field(props, "categoryFieldRef"), value = field(props, "valueFieldRef"), grouped = data && category && value ? aggregate(data.rows, category, value) : [];
  let running = 0; const base: number[] = [], deltas: number[] = [];
  for (const item of grouped) { const next = running + item.value; base.push(Math.min(running, next)); deltas.push(Math.abs(item.value)); running = next; }
  return <Surface props={props} testid="waterfall-variance-chart" hint="尚未绑定分类与差异值" option={grouped.length ? { ...axes, xAxis: { type: "category", data: grouped.map(item => item.name) }, yAxis: { type: "value" }, series: [{ type: "bar", stack: "variance", silent: true, itemStyle: { color: "transparent" }, data: base }, { type: "bar", stack: "variance", data: deltas, itemStyle: { color: (p: { dataIndex: number }) => grouped[p.dataIndex].value >= 0 ? "#1677ff" : "#cf1322" } }] } : undefined} />;
};
function timeSeries(props: ExperienceBlockRendererProps, testid: string, refs: Array<[string, string]>) {
  const data = bound(props), time = field(props, "timeFieldRef"), resolved = refs.map(([key, label]) => [field(props, key), label] as const);
  const rows = data && time ? [...data.rows].sort((a, b) => String(a.values?.[time]).localeCompare(String(b.values?.[time]))) : [];
  const series = resolved.filter(([ref]) => ref).map(([ref, label]) => ({ name: label, type: "line", connectNulls: false, showSymbol: false, data: rows.map(row => numeric(row.values?.[ref])) }));
  return <Surface props={props} testid={testid} hint="尚未绑定完整的时间序列字段" option={rows.length && series.length ? { ...axes, legend: { bottom: 0 }, xAxis: { type: "category", data: rows.map(row => String(row.values?.[time] ?? "")) }, yAxis: { type: "value" }, series } : undefined} />;
}
const ForecastConfidenceChart: ExperienceBlockRenderer = props => timeSeries(props, "forecast-confidence-chart", [["actualFieldRef", "实际"], ["forecastFieldRef", "预测"], ["lowerFieldRef", "下界"], ["upperFieldRef", "上界"]]);
const BurnupChart: ExperienceBlockRenderer = props => timeSeries(props, "burnup-chart", [["completedFieldRef", "已完成"], ["scopeFieldRef", "总范围"]]);
const BurndownChart: ExperienceBlockRenderer = props => timeSeries(props, "burndown-chart", [["remainingFieldRef", "剩余"], ["idealFieldRef", "理想线"]]);
const ErrorBudgetGauge: ExperienceBlockRenderer = props => {
  const data = bound(props), consumed = field(props, "consumedFieldRef"), budget = field(props, "budgetFieldRef"), row = data?.rows[0], used = row && consumed ? numeric(row.values?.[consumed]) : null, total = row && budget ? numeric(row.values?.[budget]) : null, percent = used !== null && total !== null && total > 0 ? Math.max(0, Math.min(100, used / total * 100)) : null;
  return <Surface props={props} testid="error-budget-gauge" hint="尚未绑定消耗值与预算值" option={percent !== null ? { animation: false, series: [{ type: "gauge", startAngle: 210, endAngle: -30, min: 0, max: 100, progress: { show: true }, detail: { formatter: `${percent.toFixed(1)}%` }, data: [{ value: percent, name: "已消耗" }] }] } : undefined} />;
};
function graph(props: ExperienceBlockRendererProps, testid: string) {
  const data = bound(props), source = field(props, "sourceFieldRef"), target = field(props, "targetFieldRef"), value = field(props, "valueFieldRef"), status = field(props, "statusFieldRef");
  const links = data && source && target ? data.rows.flatMap(row => { const s = String(row.values?.[source] ?? "").trim(), t = String(row.values?.[target] ?? "").trim(); return s && t && s !== t ? [{ source: s, target: t, value: value ? numeric(row.values?.[value]) ?? 1 : 1, status: status ? String(row.values?.[status] ?? "") : "" }] : []; }) : [];
  const nodes = [...new Set(links.flatMap(link => [link.source, link.target]))].map(name => ({ name, symbolSize: 28 }));
  return <Surface props={props} testid={testid} hint="尚未绑定有效的来源与目标关系" option={links.length ? { animation: false, tooltip: { trigger: "item", confine: true }, series: [{ type: "graph", layout: "force", roam: true, draggable: false, force: { repulsion: 180, edgeLength: 70 }, label: { show: true }, edgeSymbol: ["none", "arrow"], data: nodes, links }] } : undefined} />;
}
const ServiceMapPanel: ExperienceBlockRenderer = props => graph(props, "service-map-panel");
const DependencyGraphPanel: ExperienceBlockRenderer = props => graph(props, "dependency-graph-panel");
const QueryResultPivot: ExperienceBlockRenderer = props => {
  const data = bound(props), rowRef = field(props, "rowFieldRef"), columnRef = field(props, "columnFieldRef"), valueRef = field(props, "valueFieldRef"), rows = data && rowRef ? [...new Set(data.rows.map(row => String(row.values?.[rowRef] ?? "")).filter(Boolean))] : [], columns = data && columnRef ? [...new Set(data.rows.map(row => String(row.values?.[columnRef] ?? "")).filter(Boolean))] : [], map = new Map<string, number>();
  if (data && rowRef && columnRef && valueRef) for (const item of data.rows) { const r = String(item.values?.[rowRef] ?? ""), c = String(item.values?.[columnRef] ?? ""), v = numeric(item.values?.[valueRef]); if (r && c && v !== null) map.set(`${r}\0${c}`, (map.get(`${r}\0${c}`) ?? 0) + v); }
  const source = rows.map(row => ({ key: row, row, ...Object.fromEntries(columns.map(column => [column, map.get(`${row}\0${column}`) ?? null])) }));
  return <Surface props={props} testid="query-result-pivot" hint="尚未绑定行、列与数值字段" table={source.length ? <Table size="small" pagination={false} scroll={{ x: "max-content" }} dataSource={source} columns={[{ title: props.fieldLabelOf?.(data!.entityRef, rowRef) ?? rowRef, dataIndex: "row", fixed: "left" }, ...columns.map(column => ({ title: column, dataIndex: column, render: (value: unknown) => value ?? "-" }))]} /> : undefined} />;
};
const MetricComparisonPanel: ExperienceBlockRenderer = props => {
  const data = bound(props), category = field(props, "categoryFieldRef"), metricRefs = fields(props, "metricFieldRefs"), rows = data && category ? data.rows : [];
  return <Surface props={props} testid="metric-comparison-panel" hint="尚未绑定分类与指标字段" option={rows.length && metricRefs.length ? { ...axes, legend: { bottom: 0 }, xAxis: { type: "category", data: rows.map(row => String(row.values?.[category] ?? "")) }, yAxis: { type: "value" }, series: metricRefs.map(ref => ({ name: props.fieldLabelOf?.(data!.entityRef, ref) ?? ref, type: "bar", data: rows.map(row => numeric(row.values?.[ref])) })) } : undefined} />;
};

export const ANALYSIS_DEPENDENCY_RENDERERS = {
  FunnelConversionChart, HistogramDistributionChart, ScatterCorrelationChart, BoxPlotDistributionChart,
  WaterfallVarianceChart, ForecastConfidenceChart, BurnupChart, BurndownChart, ErrorBudgetGauge,
  ServiceMapPanel, DependencyGraphPanel, QueryResultPivot, MetricComparisonPanel,
} satisfies Record<string, ExperienceBlockRenderer>;

export const ANALYSIS_DEPENDENCY_LABELS: Record<keyof typeof ANALYSIS_DEPENDENCY_RENDERERS, string> = {
  FunnelConversionChart: "漏斗转化图",
  HistogramDistributionChart: "分布直方图（增强）",
  ScatterCorrelationChart: "散点相关图",
  BoxPlotDistributionChart: "箱线分布图",
  WaterfallVarianceChart: "瀑布差异图",
  ForecastConfidenceChart: "预测置信带",
  BurnupChart: "燃尽增长图",
  BurndownChart: "燃尽图",
  ErrorBudgetGauge: "错误预算仪表",
  ServiceMapPanel: "服务拓扑面板",
  DependencyGraphPanel: "依赖关系图",
  QueryResultPivot: "查询结果透视",
  MetricComparisonPanel: "指标对比面板",
};
