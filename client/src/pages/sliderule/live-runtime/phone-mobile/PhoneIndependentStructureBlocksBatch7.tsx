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
  Selector,
  Space,
  Steps,
  Tabs,
  Tag,
  TextArea,
} from "antd-mobile";
import { CheckCircleOutline, CheckShieldOutline, EditSOutline, FileOutline } from "antd-mobile-icons";
import type { ExperienceBlockRendererProps } from "../block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
const field = (p: ExperienceBlockRendererProps, key: string) => String(p.block.binding?.[key] ?? "").trim();
const value = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const numeric = (row: Row, ref: string, fallback = 0) => Number(row.values?.[ref] ?? fallback);
const targets = (p: ExperienceBlockRendererProps) => Array.isArray(p.block.binding?.targets) ? p.block.binding.targets.map(String) : [];
const bound = (p: ExperienceBlockRendererProps) => { const entityRef = field(p, "entityRef"), rows = entityRef ? p.entityRows?.[entityRef] : undefined; return entityRef && rows?.length ? { entityRef, rows } : undefined; };
const shell = (p: ExperienceBlockRendererProps, id: string, title: string, content: React.ReactNode) => <Card data-testid={`phone-${id}`} title={String(p.block.props?.title ?? title)}><div style={{ paddingBottom: p.block.props?.surface === "plain" ? 144 : 0 }}>{content}</div></Card>;
const empty = (p: ExperienceBlockRendererProps, id: string, title: string) => shell(p, id, title, <ErrorBlock status="empty" title="尚未绑定所需数据" />);

function PhoneOcrRegionCorrectionCanvas(p: ExperienceBlockRendererProps) {
  const b = bound(p), textRef = field(p, "recognizedTextFieldRef"), confidenceRef = field(p, "confidenceFieldRef"), [selectedId, setSelectedId] = React.useState(b?.rows[0]?.id ?? ""), [draft, setDraft] = React.useState("");
  if (!b || !textRef || !confidenceRef) return empty(p, "ocr-region-correction-canvas", "OCR 区域校正画布");
  const selected = b.rows.find(row => row.id === selectedId) ?? b.rows[0], text = draft || value(selected, textRef), confidence = numeric(selected, confidenceRef);
  return shell(p, "ocr-region-correction-canvas", "OCR 区域校正画布", <Tabs defaultActiveKey="regions"><Tabs.Tab title={`区域 ${b.rows.length}`} key="regions"><Space block direction="vertical"><div style={{ position: "relative", height: 240, background: "#f3f4f6", padding: 18 }}><div style={{ height: "100%", background: "white", padding: 20, boxShadow: "0 2px 8px #0001" }}><strong>采购验收单</strong><p>供应商：青云工业设备</p><p>订单编号 WB-20260811</p><p>验收数量 120 件</p></div>{b.rows.map((row, index) => <button key={row.id} type="button" aria-label={value(row, textRef)} onClick={() => { setSelectedId(row.id); setDraft(""); }} style={{ position: "absolute", left: `${12 + index * 7}%`, top: `${28 + index * 22}%`, width: `${70 - index * 8}%`, height: 28, border: row.id === selected.id ? "2px solid #1677ff" : "1px solid #69b1ff", background: "#1677ff18" }} />)}</div><List>{b.rows.map(row => <List.Item key={row.id} onClick={() => setSelectedId(row.id)} extra={<Tag color={numeric(row, confidenceRef) < 90 ? "warning" : "success"}>{numeric(row, confidenceRef)}%</Tag>}>{value(row, textRef)}</List.Item>)}</List></Space></Tabs.Tab><Tabs.Tab title="校正" key="edit"><Space block direction="vertical"><ProgressBar percent={confidence} /><TextArea rows={5} value={text} onChange={setDraft} /><Button block color="primary" disabled={!text.trim()} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, rowId: selected.id, text, operation: "correctOcrRegion", targets: targets(p) })}><EditSOutline /> 保存区域文字</Button></Space></Tabs.Tab></Tabs>);
}

function PhoneQueryExecutionPlanInspector(p: ExperienceBlockRendererProps) {
  const b = bound(p), nameRef = field(p, "operatorNameFieldRef"), parentRef = field(p, "operatorParentFieldRef"), costRef = field(p, "estimatedCostFieldRef"), rowsRef = field(p, "actualRowsFieldRef"), durationRef = field(p, "durationFieldRef"), [selectedId, setSelectedId] = React.useState(b?.rows[0]?.id ?? "");
  if (!b || !nameRef || !parentRef || !costRef || !rowsRef || !durationRef) return empty(p, "query-execution-plan-inspector", "查询执行计划检查器");
  const selected = b.rows.find(row => row.id === selectedId) ?? b.rows[0], total = b.rows.reduce((sum, row) => sum + numeric(row, durationRef), 0);
  return shell(p, "query-execution-plan-inspector", "查询执行计划检查器", <Tabs defaultActiveKey="tree"><Tabs.Tab title="算子树" key="tree"><Selector columns={3} value={["analyze"]} options={[{ label: "逻辑", value: "logical" }, { label: "物理", value: "physical" }, { label: "实际", value: "analyze" }]} /><List>{b.rows.map(row => { const depth = value(row, parentRef) ? 1 : 0; return <List.Item key={row.id} onClick={() => setSelectedId(row.id)} prefix={<span style={{ marginLeft: depth * 18, color: "#1677ff" }}>{depth ? "└" : "●"}</span>} extra={<Tag color={numeric(row, durationRef) > 80 ? "danger" : "primary"}>{numeric(row, durationRef)}ms</Tag>}>{value(row, nameRef)}</List.Item>; })}</List></Tabs.Tab><Tabs.Tab title="热点" key="hotspot"><Space block direction="vertical"><Card title={value(selected, nameRef)}><Grid columns={2} gap={8}><Grid.Item>估算成本<br /><strong>{numeric(selected, costRef)}</strong></Grid.Item><Grid.Item>实际行数<br /><strong>{numeric(selected, rowsRef).toLocaleString()}</strong></Grid.Item></Grid><ProgressBar percent={Math.min(100, numeric(selected, durationRef) / Math.max(total, 1) * 100)} /></Card><ErrorBlock status={numeric(selected, durationRef) > 80 ? "busy" : "default"} title={numeric(selected, durationRef) > 80 ? "当前执行热点" : "耗时占比正常"} /><Button block color="primary" onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, operation: "analyzeQueryPlan", targets: targets(p) })}>重新分析</Button></Space></Tabs.Tab></Tabs>);
}

function PhoneColumnProfileWorkbench(p: ExperienceBlockRendererProps) {
  const b = bound(p), nameRef = field(p, "columnNameFieldRef"), typeRef = field(p, "columnTypeFieldRef"), nullRef = field(p, "nullRatioFieldRef"), uniqueRef = field(p, "uniqueRatioFieldRef"), minRef = field(p, "minValueFieldRef"), maxRef = field(p, "maxValueFieldRef"), [selectedId, setSelectedId] = React.useState(b?.rows[0]?.id ?? "");
  if (!b || !nameRef || !typeRef || !nullRef || !uniqueRef) return empty(p, "column-profile-workbench", "数据列画像工作台");
  const selected = b.rows.find(row => row.id === selectedId) ?? b.rows[0], bars = [20, 48, 76, 94, 68, 42, 24];
  return shell(p, "column-profile-workbench", "数据列画像工作台", <Space block direction="vertical"><Selector columns={2} value={[selected.id]} onChange={keys => setSelectedId(keys[0])} options={b.rows.map(row => ({ label: value(row, nameRef), value: row.id, description: value(row, typeRef) }))} /><Grid columns={2} gap={8}><Grid.Item><Card title="空值率"><strong>{numeric(selected, nullRef)}%</strong></Card></Grid.Item><Grid.Item><Card title="唯一率"><strong>{numeric(selected, uniqueRef)}%</strong></Card></Grid.Item></Grid><Card title="区间分布"><div style={{ height: 150, display: "flex", alignItems: "end", gap: 6 }}>{bars.map((height, index) => <div key={index} style={{ flex: 1, height: `${height}%`, background: index === 3 ? "#faad14" : "#1677ff", borderRadius: "3px 3px 0 0" }} />)}</div><div style={{ display: "flex", justifyContent: "space-between", color: "#999" }}><span>{value(selected, minRef, "最小")}</span><span>{value(selected, maxRef, "最大")}</span></div></Card><ProgressBar percent={100 - numeric(selected, nullRef)} text /> </Space>);
}

function PhoneCertificateRotationPlanner(p: ExperienceBlockRendererProps) {
  const b = bound(p), nameRef = field(p, "certificateNameFieldRef"), statusRef = field(p, "certificateStatusFieldRef"), fromRef = field(p, "validFromFieldRef"), untilRef = field(p, "validUntilFieldRef"), fingerprintRef = field(p, "fingerprintFieldRef"), [activated, setActivated] = React.useState(false);
  if (!b || !nameRef || !statusRef || !fromRef || !untilRef || b.rows.length < 2) return empty(p, "certificate-rotation-planner", "证书重叠轮换规划器");
  const active = b.rows.find(row => /active|current/i.test(value(row, statusRef))) ?? b.rows[0], pending = b.rows.find(row => row.id !== active.id) ?? b.rows[1], overlap = Math.round((Date.parse(value(active, untilRef)) - Date.parse(value(pending, fromRef))) / 86400000), valid = overlap >= 0;
  return shell(p, "certificate-rotation-planner", "证书重叠轮换规划器", <Space block direction="vertical"><Steps direction="vertical" current={activated ? 2 : 1}><Steps.Step title={value(active, nameRef)} description={`当前有效至 ${value(active, untilRef)}`} /><Steps.Step title={`双证书窗口 ${overlap} 天`} description={valid ? "客户端可验证两份证书" : "存在认证中断"} /><Steps.Step title={value(pending, nameRef)} description={`新证书自 ${value(pending, fromRef)} 生效`} /></Steps><Collapse><Collapse.Panel key="fingerprints" title="核对指纹"><List><List.Item description={value(active, fingerprintRef)}>{value(active, nameRef)}</List.Item><List.Item description={value(pending, fingerprintRef)}>{value(pending, nameRef)}</List.Item></List></Collapse.Panel></Collapse><ErrorBlock status={valid ? "default" : "busy"} title={valid ? "轮换窗口有效" : "轮换窗口断裂"} /><Button block color="primary" disabled={!valid || activated} onClick={() => { setActivated(true); p.onAction?.("submitRequest", { entityRef: b.entityRef, activeId: active.id, pendingId: pending.id, operation: "activateCertificateRotation", targets: targets(p) }); }}><CheckShieldOutline /> 启用新证书</Button></Space>);
}

function PhoneWebhookPayloadSchemaExplorer(p: ExperienceBlockRendererProps) {
  const b = bound(p), pathRef = field(p, "fieldPathFieldRef"), typeRef = field(p, "fieldTypeFieldRef"), sampleRef = field(p, "sampleValueFieldRef"), requiredRef = field(p, "requiredFieldRef"), [selectedId, setSelectedId] = React.useState(b?.rows[0]?.id ?? ""), [payload, setPayload] = React.useState(String(p.block.props?.samplePayload ?? '{"order":{"id":"WB-2048"}}'));
  if (!b || !pathRef || !typeRef || !sampleRef) return empty(p, "webhook-payload-schema-explorer", "Webhook 负载 Schema 检查台");
  const selected = b.rows.find(row => row.id === selectedId) ?? b.rows[0], valid = (() => { try { return Boolean(JSON.parse(payload)); } catch { return false; } })();
  return shell(p, "webhook-payload-schema-explorer", "Webhook 负载 Schema 检查台", <Tabs defaultActiveKey="schema"><Tabs.Tab title="Schema" key="schema"><List>{b.rows.map(row => <List.Item key={row.id} arrow={false} onClick={() => setSelectedId(row.id)} prefix={<FileOutline />} description={value(row, sampleRef)} extra={<Tag color={/true|required/i.test(value(row, requiredRef)) ? "danger" : "default"}>{value(row, typeRef)}</Tag>}>{value(row, pathRef)}</List.Item>)}</List></Tabs.Tab><Tabs.Tab title="示例" key="sample"><Space block direction="vertical"><TextArea rows={10} value={payload} onChange={setPayload} style={{ fontFamily: "monospace" }} /><Card title="选中路径"><Input value={value(selected, pathRef)} readOnly /></Card><Button block color="primary" disabled={!valid} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, selectedPath: value(selected, pathRef), payload, operation: "acceptWebhookSample", targets: targets(p) })}>采用字段路径</Button></Space></Tabs.Tab></Tabs>);
}

function PhoneArtifactProvenanceVerifier(p: ExperienceBlockRendererProps) {
  const b = bound(p), subjectRef = field(p, "subjectFieldRef"), kindRef = field(p, "evidenceKindFieldRef"), statusRef = field(p, "verificationStatusFieldRef"), digestRef = field(p, "digestFieldRef"), issuerRef = field(p, "issuerFieldRef");
  if (!b || !subjectRef || !kindRef || !statusRef || !digestRef) return empty(p, "artifact-provenance-verifier", "制品来源证明验证器");
  const ok = (status: string) => /verified|passed|trusted/i.test(status), verified = b.rows.filter(row => ok(value(row, statusRef))).length, valid = verified === b.rows.length;
  return shell(p, "artifact-provenance-verifier", "制品来源证明验证器", <Space block direction="vertical"><ProgressBar percent={verified / b.rows.length * 100} text /><Collapse defaultActiveKey={[b.rows[0].id]}>{b.rows.map(row => <Collapse.Panel key={row.id} title={<span><CheckCircleOutline color={ok(value(row, statusRef)) ? "#52c41a" : "#ff4d4f"} /> {value(row, kindRef)}</span>}><List><List.Item description={value(row, subjectRef)}>主体</List.Item><List.Item description={value(row, issuerRef, "-")}>签发方</List.Item><List.Item description={<span style={{ wordBreak: "break-all" }}>{value(row, digestRef)}</span>}>摘要</List.Item></List></Collapse.Panel>)}</Collapse><div style={{ padding: 12, borderRadius: 4, background: valid ? "#f6ffed" : "#fff1f0", color: valid ? "#389e0d" : "#cf1322" }}><CheckShieldOutline /> {valid ? "来源证明完整可信" : "存在未通过证据，禁止发布"}</div><Button block color="primary" disabled={!valid} onClick={() => p.onAction?.("submitRequest", { entityRef: b.entityRef, evidenceIds: b.rows.map(row => row.id), operation: "approveArtifactProvenance", targets: targets(p) })}>批准制品发布</Button></Space>);
}

export function renderIndependentStructureBatch7PhoneBlock(p: ExperienceBlockRendererProps): React.ReactNode | undefined {
  switch (p.block.type) {
    case "OcrRegionCorrectionCanvas": return <PhoneOcrRegionCorrectionCanvas {...p} />;
    case "QueryExecutionPlanInspector": return <PhoneQueryExecutionPlanInspector {...p} />;
    case "ColumnProfileWorkbench": return <PhoneColumnProfileWorkbench {...p} />;
    case "CertificateRotationPlanner": return <PhoneCertificateRotationPlanner {...p} />;
    case "WebhookPayloadSchemaExplorer": return <PhoneWebhookPayloadSchemaExplorer {...p} />;
    case "ArtifactProvenanceVerifier": return <PhoneArtifactProvenanceVerifier {...p} />;
    default: return undefined;
  }
}
