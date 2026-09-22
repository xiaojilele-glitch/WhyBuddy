import React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Descriptions,
  Flex,
  Input,
  List,
  Progress,
  Segmented,
  Select,
  Space,
  Splitter,
  Statistic,
  Steps,
  Tag,
  Tree,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  CodeOutlined,
  EditOutlined,
  ExperimentOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
const field = (p: ExperienceBlockRendererProps, key: string) => String(p.block.binding?.[key] ?? "").trim();
const value = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const numeric = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const targets = (p: ExperienceBlockRendererProps) => Array.isArray(p.block.binding?.targets) ? p.block.binding.targets.map(String) : [];
const bound = (p: ExperienceBlockRendererProps) => {
  const entityRef = field(p, "entityRef");
  const rows = entityRef ? p.entityRows?.[entityRef] : undefined;
  return entityRef && rows?.length ? { entityRef, rows } : undefined;
};
const shell = (p: ExperienceBlockRendererProps, id: string, title: string, children: React.ReactNode) => p.block.props?.surface === "plain"
  ? <section data-testid={id} style={{ paddingBottom: 120 }}>{children}</section>
  : <Card size="small" title={String(p.block.props?.title ?? title)} data-testid={id}>{children}</Card>;
const missing = (p: ExperienceBlockRendererProps, id: string, title: string) => shell(p, id, title, <Alert type="warning" showIcon message="区块尚未绑定所需数据" />);

export const ocrCorrectionValid = (text: string, confidence: number) => Boolean(text.trim()) && confidence >= 0 && confidence <= 100;
export const planCanAnalyze = (costs: number[]) => costs.length > 0 && costs.every(Number.isFinite);
export const profileHasSignal = (nullRatio: number, uniqueRatio: number) => [nullRatio, uniqueRatio].every(v => v >= 0 && v <= 100);
export const rotationWindowValid = (activeUntil: number, pendingFrom: number) => pendingFrom <= activeUntil;
export const webhookSampleValid = (payload: string) => { try { return Boolean(JSON.parse(payload)); } catch { return false; } };
export const provenanceCanApprove = (statuses: string[]) => statuses.length > 0 && statuses.every(status => /verified|passed|trusted/i.test(status));

export const OcrRegionCorrectionCanvasRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p), textRef = field(p, "recognizedTextFieldRef"), confidenceRef = field(p, "confidenceFieldRef"), xRef = field(p, "boxXFieldRef"), yRef = field(p, "boxYFieldRef"), widthRef = field(p, "boxWidthFieldRef"), heightRef = field(p, "boxHeightFieldRef");
  const [selectedId, setSelectedId] = React.useState(b?.rows[0]?.id ?? ""), [draft, setDraft] = React.useState("");
  if (!b || !textRef || !confidenceRef || !xRef || !yRef || !widthRef || !heightRef) return missing(p, "ocr-region-correction-canvas", "OCR 区域校正画布");
  const selected = b.rows.find(row => row.id === selectedId) ?? b.rows[0], text = draft || value(selected, textRef), confidence = numeric(selected, confidenceRef);
  return shell(p, "ocr-region-correction-canvas", "OCR 区域校正画布", <Splitter style={{ minHeight: 390 }}>
    <Splitter.Panel defaultSize="64%" min="45%"><div style={{ position: "relative", height: 390, overflow: "hidden", borderRadius: 6, background: "#f1f3f5", padding: 28 }}><div style={{ height: "100%", background: "white", boxShadow: "0 2px 12px #00000014", padding: 34 }}><Typography.Title level={4}>采购验收单</Typography.Title><Typography.Paragraph type="secondary">供应商：青云工业设备有限公司</Typography.Paragraph><Typography.Paragraph>订单编号 WB-20260811，验收数量 120 件。</Typography.Paragraph><Typography.Paragraph>交付地址：杭州市滨江区协同路 18 号</Typography.Paragraph></div>{b.rows.map(row => <button key={row.id} type="button" aria-label={value(row, textRef)} onClick={() => { setSelectedId(row.id); setDraft(""); }} style={{ position: "absolute", left: `${numeric(row, xRef)}%`, top: `${numeric(row, yRef)}%`, width: `${numeric(row, widthRef)}%`, height: `${numeric(row, heightRef)}%`, border: row.id === selected.id ? "2px solid #1677ff" : "1px solid #69b1ff", background: row.id === selected.id ? "#1677ff22" : "#69b1ff12", cursor: "text" }} />)}</div></Splitter.Panel>
    <Splitter.Panel min="30%"><Flex vertical gap={12} style={{ padding: 16 }}><Flex justify="space-between" align="center"><Typography.Title level={5} style={{ margin: 0 }}>识别区域</Typography.Title><Tag color={confidence < 90 ? "warning" : "success"}>{confidence}%</Tag></Flex><Progress percent={confidence} status={confidence < 80 ? "exception" : "normal"} /><Input.TextArea rows={5} value={text} onChange={event => setDraft(event.target.value)} /><Alert type={confidence < 90 ? "warning" : "success"} showIcon message={confidence < 90 ? "低置信度，需要人工确认" : "识别结果可信"} /><Button type="primary" icon={<SaveOutlined />} disabled={!ocrCorrectionValid(text, confidence)} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, rowId: selected.id, text, operation: "correctOcrRegion", targets: targets(p) })}>保存区域文字</Button></Flex></Splitter.Panel>
  </Splitter>);
};

export const QueryExecutionPlanInspectorRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p), nameRef = field(p, "operatorNameFieldRef"), parentRef = field(p, "operatorParentFieldRef"), costRef = field(p, "estimatedCostFieldRef"), rowsRef = field(p, "actualRowsFieldRef"), durationRef = field(p, "durationFieldRef");
  const [selectedId, setSelectedId] = React.useState(b?.rows[0]?.id ?? ""), [mode, setMode] = React.useState<string>("analyze");
  if (!b || !nameRef || !parentRef || !costRef || !rowsRef || !durationRef) return missing(p, "query-execution-plan-inspector", "查询执行计划检查器");
  const children = (id: string) => b.rows.filter(row => value(row, parentRef) === id), makeNode = (row: Row): any => ({ key: row.id, title: <Space><span>{value(row, nameRef)}</span><Tag color={numeric(row, durationRef) > 80 ? "error" : "blue"}>{numeric(row, durationRef)} ms</Tag></Space>, children: children(row.id).map(makeNode) }), roots = b.rows.filter(row => !value(row, parentRef)), selected = b.rows.find(row => row.id === selectedId) ?? b.rows[0], total = b.rows.reduce((sum, row) => sum + numeric(row, durationRef), 0);
  return shell(p, "query-execution-plan-inspector", "查询执行计划检查器", <Flex vertical gap={12}><Flex justify="space-between"><Segmented value={mode} onChange={v => setMode(String(v))} options={[{ label: "逻辑计划", value: "logical" }, { label: "物理计划", value: "physical" }, { label: "实际分析", value: "analyze" }]} /><Button icon={<ExperimentOutlined />} disabled={!planCanAnalyze(b.rows.map(row => numeric(row, costRef)))} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, operation: "analyzeQueryPlan", targets: targets(p) })}>重新分析</Button></Flex><div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1.15fr) minmax(220px, .85fr)", gap: 12 }}><Card size="small" title="算子树"><Tree showLine defaultExpandAll selectedKeys={[selected.id]} onSelect={keys => keys[0] && setSelectedId(String(keys[0]))} treeData={roots.map(makeNode)} /></Card><Card size="small" title="热点检查器"><Descriptions size="small" column={1} items={[{ key: "op", label: "算子", children: value(selected, nameRef) }, { key: "cost", label: "估算成本", children: numeric(selected, costRef) }, { key: "rows", label: "实际行数", children: numeric(selected, rowsRef).toLocaleString() }, { key: "duration", label: "耗时", children: `${numeric(selected, durationRef)} ms` }]} /><Progress percent={Math.min(100, Math.round(numeric(selected, durationRef) / Math.max(total, 1) * 100))} strokeColor={numeric(selected, durationRef) > 80 ? "#ff4d4f" : undefined} /><Alert style={{ marginTop: 12 }} type={numeric(selected, durationRef) > 80 ? "warning" : "info"} message={numeric(selected, durationRef) > 80 ? "该算子是当前执行热点" : "耗时占比正常"} /></Card></div><Flex gap={12}><Statistic title="总耗时" value={total} suffix="ms" /><Statistic title="计划算子" value={b.rows.length} /></Flex></Flex>);
};

export const ColumnProfileWorkbenchRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p), nameRef = field(p, "columnNameFieldRef"), typeRef = field(p, "columnTypeFieldRef"), nullRef = field(p, "nullRatioFieldRef"), uniqueRef = field(p, "uniqueRatioFieldRef"), minRef = field(p, "minValueFieldRef"), maxRef = field(p, "maxValueFieldRef");
  const [selectedId, setSelectedId] = React.useState(b?.rows[0]?.id ?? "");
  if (!b || !nameRef || !typeRef || !nullRef || !uniqueRef) return missing(p, "column-profile-workbench", "数据列画像工作台");
  const selected = b.rows.find(row => row.id === selectedId) ?? b.rows[0], nullRatio = numeric(selected, nullRef), uniqueRatio = numeric(selected, uniqueRef), bars = [18, 38, 62, 88, 72, 44, 27, 14];
  return shell(p, "column-profile-workbench", "数据列画像工作台", <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0,1fr)", gap: 12 }}><Card size="small" title="数据列"><List size="small" dataSource={b.rows} renderItem={row => <List.Item onClick={() => setSelectedId(row.id)} style={{ cursor: "pointer", background: row.id === selected.id ? "#e6f4ff" : undefined, paddingInline: 10 }} extra={<Tag>{value(row, typeRef)}</Tag>}>{value(row, nameRef)}</List.Item>} /></Card><Flex vertical gap={12}><Flex gap={12} wrap><Card size="small"><Statistic title="空值率" value={nullRatio} suffix="%" /></Card><Card size="small"><Statistic title="唯一率" value={uniqueRatio} suffix="%" /></Card><Card size="small"><Statistic title="范围" value={`${value(selected, minRef, "-")} - ${value(selected, maxRef, "-")}`} /></Card></Flex><Card size="small" title={`${value(selected, nameRef)} 分布`} extra={<Tag color={profileHasSignal(nullRatio, uniqueRatio) ? "success" : "error"}>最新画像</Tag>}><div style={{ height: 170, display: "flex", alignItems: "end", gap: 8, padding: "12px 8px 0", background: "linear-gradient(#fafafa 1px,transparent 1px)", backgroundSize: "100% 34px" }}>{bars.map((height, index) => <div key={index} style={{ flex: 1, height: `${height}%`, minWidth: 10, borderRadius: "4px 4px 0 0", background: index === 3 ? "#faad14" : "#1677ff" }} title={`区间 ${index + 1}`} />)}</div><Flex justify="space-between"><Typography.Text type="secondary">{value(selected, minRef, "最小值")}</Typography.Text><Tag color="warning">异常密集区间</Tag><Typography.Text type="secondary">{value(selected, maxRef, "最大值")}</Typography.Text></Flex></Card><Alert type={nullRatio > 20 ? "warning" : "success"} showIcon message={nullRatio > 20 ? "空值率超过质量阈值" : "当前列质量指标正常"} /></Flex></div>);
};

export const CertificateRotationPlannerRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p), nameRef = field(p, "certificateNameFieldRef"), statusRef = field(p, "certificateStatusFieldRef"), fromRef = field(p, "validFromFieldRef"), untilRef = field(p, "validUntilFieldRef"), fingerprintRef = field(p, "fingerprintFieldRef");
  const [activated, setActivated] = React.useState(false);
  if (!b || !nameRef || !statusRef || !fromRef || !untilRef || b.rows.length < 2) return missing(p, "certificate-rotation-planner", "证书重叠轮换规划器");
  const active = b.rows.find(row => /active|current/i.test(value(row, statusRef))) ?? b.rows[0], pending = b.rows.find(row => row.id !== active.id) ?? b.rows[1], activeUntil = Date.parse(value(active, untilRef)), pendingFrom = Date.parse(value(pending, fromRef)), overlapDays = Math.round((activeUntil - pendingFrom) / 86400000), valid = rotationWindowValid(activeUntil, pendingFrom);
  return shell(p, "certificate-rotation-planner", "证书重叠轮换规划器", <Flex vertical gap={14}><div style={{ display: "grid", gridTemplateColumns: "1fr 72px 1fr", alignItems: "stretch", gap: 10 }}><Card size="small" title={<Space><Badge status="success" />当前证书</Space>}><Typography.Title level={5}>{value(active, nameRef)}</Typography.Title><Typography.Text code>{value(active, fingerprintRef).slice(0, 20)}...</Typography.Text><div style={{ marginTop: 12 }}><Tag>{value(active, fromRef)} 至 {value(active, untilRef)}</Tag></div></Card><Flex vertical align="center" justify="center"><SafetyCertificateOutlined style={{ fontSize: 28, color: valid ? "#52c41a" : "#ff4d4f" }} /><Typography.Text type="secondary">重叠<br />{overlapDays} 天</Typography.Text></Flex><Card size="small" title={<Space><Badge status={activated ? "success" : "processing"} />待启用证书</Space>}><Typography.Title level={5}>{value(pending, nameRef)}</Typography.Title><Typography.Text code>{value(pending, fingerprintRef).slice(0, 20)}...</Typography.Text><div style={{ marginTop: 12 }}><Tag color="blue">{value(pending, fromRef)} 至 {value(pending, untilRef)}</Tag></div></Card></div><div style={{ position: "relative", height: 54, background: "#f5f5f5", borderRadius: 6, overflow: "hidden" }}><div style={{ position: "absolute", inset: "8px 34% 28px 4%", background: "#52c41a", borderRadius: 8 }} /><div style={{ position: "absolute", inset: "28px 4% 8px 44%", background: "#1677ff", borderRadius: 8 }} /><div style={{ position: "absolute", insetBlock: 4, left: "44%", width: "22%", border: "1px dashed #faad14", background: "#faad1422" }} /></div><Alert type={valid ? "success" : "error"} showIcon message={valid ? `存在 ${overlapDays} 天双证书验证窗口，可安全轮换` : "新证书生效晚于旧证书失效，存在认证中断"} /><Flex justify="end" gap={8}><Button danger disabled={!activated} onClick={() => setActivated(false)}>撤销待启用证书</Button><Button type="primary" disabled={!valid || activated} onClick={() => { setActivated(true); p.onAction?.("submitRequest", { entityRef: b.entityRef, activeId: active.id, pendingId: pending.id, operation: "activateCertificateRotation", targets: targets(p) }); }}>启用新证书</Button></Flex></Flex>);
};

export const WebhookPayloadSchemaExplorerRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p), pathRef = field(p, "fieldPathFieldRef"), typeRef = field(p, "fieldTypeFieldRef"), sampleRef = field(p, "sampleValueFieldRef"), requiredRef = field(p, "requiredFieldRef"), [selectedId, setSelectedId] = React.useState(b?.rows[0]?.id ?? ""), [payload, setPayload] = React.useState(String(p.block.props?.samplePayload ?? '{"order":{"id":"WB-2048","amount":688}}'));
  if (!b || !pathRef || !typeRef || !sampleRef) return missing(p, "webhook-payload-schema-explorer", "Webhook 负载 Schema 检查台");
  const selected = b.rows.find(row => row.id === selectedId) ?? b.rows[0], parts = (row: Row) => value(row, pathRef).split("."), nodeFor = (row: Row) => ({ key: row.id, title: <Space><CodeOutlined />{value(row, pathRef)}<Tag>{value(row, typeRef)}</Tag></Space> });
  return shell(p, "webhook-payload-schema-explorer", "Webhook 负载 Schema 检查台", <Flex vertical gap={12}><Alert type={webhookSampleValid(payload) ? "info" : "error"} showIcon message={webhookSampleValid(payload) ? "已捕获最新 Webhook 示例，可从 Schema 选择字段" : "示例负载不是有效 JSON"} /><div style={{ display: "grid", gridTemplateColumns: "minmax(220px,.8fr) minmax(0,1.2fr)", gap: 12 }}><Card size="small" title="输出 Schema"><Tree blockNode treeData={b.rows.map(nodeFor)} selectedKeys={[selected.id]} onSelect={keys => keys[0] && setSelectedId(String(keys[0]))} /></Card><Card size="small" title="示例负载"><Input.TextArea value={payload} onChange={event => setPayload(event.target.value)} rows={9} style={{ fontFamily: "monospace" }} /></Card></div><Descriptions size="small" column={4} items={[{ key: "path", label: "字段路径", children: <Typography.Text copyable>{value(selected, pathRef)}</Typography.Text> }, { key: "depth", label: "层级", children: parts(selected).length }, { key: "type", label: "类型", children: value(selected, typeRef) }, { key: "required", label: "约束", children: <Tag color={/true|required/i.test(value(selected, requiredRef)) ? "red" : "default"}>{/true|required/i.test(value(selected, requiredRef)) ? "必填" : "可选"}</Tag> }]} /><Button type="primary" icon={<ScanOutlined />} disabled={!webhookSampleValid(payload)} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, selectedPath: value(selected, pathRef), payload, operation: "acceptWebhookSample", targets: targets(p) })}>采用字段路径</Button></Flex>);
};

export const ArtifactProvenanceVerifierRenderer: ExperienceBlockRenderer = p => {
  const b = bound(p), subjectRef = field(p, "subjectFieldRef"), kindRef = field(p, "evidenceKindFieldRef"), statusRef = field(p, "verificationStatusFieldRef"), digestRef = field(p, "digestFieldRef"), issuerRef = field(p, "issuerFieldRef");
  const [expanded, setExpanded] = React.useState<string[]>([b?.rows[0]?.id ?? ""]);
  if (!b || !subjectRef || !kindRef || !statusRef || !digestRef) return missing(p, "artifact-provenance-verifier", "制品来源证明验证器");
  const statuses = b.rows.map(row => value(row, statusRef)), valid = provenanceCanApprove(statuses), verified = statuses.filter(status => /verified|passed|trusted/i.test(status)).length;
  return shell(p, "artifact-provenance-verifier", "制品来源证明验证器", <Flex vertical gap={12}><Flex gap={12} wrap><Card size="small"><Statistic title="可信证据" value={verified} suffix={`/ ${b.rows.length}`} /></Card><Card size="small"><Statistic title="证明覆盖" value={Math.round(verified / b.rows.length * 100)} suffix="%" /></Card><Alert style={{ flex: 1 }} type={valid ? "success" : "error"} showIcon message={valid ? "来源、构建器、材料和签名均已验证" : "存在未通过的来源证明，禁止发布"} /></Flex><Steps size="small" current={valid ? 4 : Math.max(0, verified - 1)} items={["制品摘要", "源码身份", "构建器", "材料清单", "签名"].map(title => ({ title }))} /><Collapse activeKey={expanded} onChange={keys => setExpanded(keys.map(String))} items={b.rows.map(row => ({ key: row.id, label: <Flex justify="space-between" align="center"><Space><SafetyCertificateOutlined />{value(row, kindRef)}</Space><Tag color={/verified|passed|trusted/i.test(value(row, statusRef)) ? "success" : "error"}>{value(row, statusRef)}</Tag></Flex>, children: <Descriptions size="small" column={2} items={[{ key: "subject", label: "主体", children: value(row, subjectRef) }, { key: "issuer", label: "签发方", children: value(row, issuerRef, "-") }, { key: "digest", label: "摘要", span: 2, children: <Typography.Text code copyable>{value(row, digestRef)}</Typography.Text> }]} /> }))} /><Button type="primary" icon={<CheckCircleOutlined />} disabled={!valid} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, evidenceIds: b.rows.map(row => row.id), operation: "approveArtifactProvenance", targets: targets(p) })}>批准制品发布</Button></Flex>);
};

export const INDEPENDENT_STRUCTURE_BATCH7_LABELS: Record<string, string> = {
  OcrRegionCorrectionCanvas: "OCR 区域校正画布",
  QueryExecutionPlanInspector: "查询执行计划检查器",
  ColumnProfileWorkbench: "数据列画像工作台",
  CertificateRotationPlanner: "证书重叠轮换规划器",
  WebhookPayloadSchemaExplorer: "Webhook 负载 Schema 检查台",
  ArtifactProvenanceVerifier: "制品来源证明验证器",
};
