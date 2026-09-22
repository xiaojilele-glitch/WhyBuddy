import React from "react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  ErrorBlock,
  Grid,
  Image,
  Input,
  List,
  Popup,
  ProgressBar,
  Space,
  Steps,
  Tabs,
  Tag,
} from "antd-mobile";
import type { ExperienceBlockRendererProps } from "../block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];
const field = (props: ExperienceBlockRendererProps, key: string) => String(props.block.binding?.[key] ?? "").trim();
const targets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const bound = (props: ExperienceBlockRendererProps) => { const entityRef = field(props, "entityRef"); const rows = entityRef ? props.entityRows?.[entityRef] : undefined; return entityRef && rows ? { entityRef, rows } : undefined; };
const value = (row: Row, ref: string, fallback = "") => String(row.values?.[ref] ?? fallback);
const empty = (description: string) => <ErrorBlock status="empty" title={description} style={{ padding: "12px 0", "--image-height": "52px" } as React.CSSProperties} />;
const shell = (props: ExperienceBlockRendererProps, testid: string, title: string, children: React.ReactNode) => <Card data-testid={`phone-${testid}`} title={String(props.block.props?.title ?? title)}><div style={{ paddingBottom: props.block.props?.surface === "plain" ? 144 : 0 }}>{children}</div></Card>;

function PhoneSignatureFieldCanvas(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "nameFieldRef"), roleRef = field(props, "roleFieldRef");
  const [recipientId, setRecipientId] = React.useState(""), [fieldType, setFieldType] = React.useState("signature");
  if (!data || !nameRef || !roleRef) return shell(props, "signature-field-canvas", "签署字段画布", empty("尚未绑定签署人"));
  const recipient = data.rows.find(row => row.id === recipientId) ?? data.rows[0];
  return shell(props, "signature-field-canvas", "签署字段画布", <Tabs defaultActiveKey="document"><Tabs.Tab title="文档" key="document"><div style={{ minHeight: 230, background: "#f5f5f5", padding: 16 }}><div style={{ minHeight: 198, background: "white", padding: 16, position: "relative" }}><strong>服务合作协议</strong><Tag color="primary" style={{ position: "absolute", right: 12, bottom: 18 }}>{value(recipient, nameRef, "签署人")} · {fieldType}</Tag></div></div><Space block direction="vertical" style={{ marginTop: 12 }}><Tabs activeKey={fieldType} onChange={setFieldType}><Tabs.Tab title="签名" key="signature" /><Tabs.Tab title="日期" key="date" /><Tabs.Tab title="文本" key="text" /></Tabs><Button block color="primary" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, recipientId: recipient.id, fieldType, page: 1, operation: "placeSignatureField", targets: targets(props) })}>放置字段</Button></Space></Tabs.Tab><Tabs.Tab title="签署人" key="recipients"><List>{data.rows.map(row => <List.Item key={row.id} clickable onClick={() => setRecipientId(row.id)} extra={<Tag>{value(row, roleRef)}</Tag>}>{value(row, nameRef, row.id)}{recipient.id === row.id && <Badge content="当前" />}</List.Item>)}</List></Tabs.Tab></Tabs>);
}

function PhoneAlertGroupAccordion(props: ExperienceBlockRendererProps) {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), groupRef = field(props, "groupFieldRef"), statusRef = field(props, "statusFieldRef"), severityRef = field(props, "severityFieldRef");
  if (!data || !titleRef || !groupRef || !statusRef) return shell(props, "alert-group-accordion", "告警分组折叠台", empty("尚未绑定告警分组"));
  const groups = data.rows.reduce<Record<string, Row[]>>((all, row) => { (all[value(row, groupRef, "未分组")] ??= []).push(row); return all; }, {});
  return shell(props, "alert-group-accordion", "告警分组折叠台", <Collapse accordion defaultActiveKey={Object.keys(groups)[0]}>{Object.entries(groups).map(([group, rows]) => <Collapse.Panel key={group} title={`${group} · ${rows.length}`}><List>{rows.map(row => <List.Item key={row.id} description={value(row, statusRef)} extra={<Tag color={/critical/i.test(value(row, severityRef)) ? "danger" : "warning"}>{value(row, severityRef, "warning")}</Tag>}>{value(row, titleRef, row.id)}</List.Item>)}</List><Button block size="small" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, group, rowIds: rows.map(row => row.id), operation: "muteAlertGroup", targets: targets(props) })}>静默该组</Button></Collapse.Panel>)}</Collapse>);
}

function PhoneEvidenceCollectionWorkspace(props: ExperienceBlockRendererProps) {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), requiredRef = field(props, "requiredFieldRef"), statusRef = field(props, "statusFieldRef");
  const [checked, setChecked] = React.useState<string[]>([]);
  if (!data || !titleRef || !statusRef) return shell(props, "evidence-collection-workspace", "证据采集工作区", empty("尚未绑定证据要求"));
  const required = data.rows.filter(row => !requiredRef || /true|required|yes/i.test(value(row, requiredRef, "true"))), completed = data.rows.filter(row => checked.includes(row.id) || /accepted|uploaded|complete/i.test(value(row, statusRef))).length, blocked = required.some(row => !checked.includes(row.id) && !/accepted|uploaded|complete/i.test(value(row, statusRef)));
  return shell(props, "evidence-collection-workspace", "证据采集工作区", <Space block direction="vertical"><ProgressBar percent={Math.round(completed / Math.max(1, data.rows.length) * 100)} /><Checkbox.Group value={checked} onChange={values => setChecked(values.map(String))}>{data.rows.map(row => <Checkbox key={row.id} value={row.id} block disabled={/rejected/i.test(value(row, statusRef))}>{value(row, titleRef, row.id)} {requiredRef && /true|required|yes/i.test(value(row, requiredRef)) && <Tag color="danger">必需</Tag>}</Checkbox>)}</Checkbox.Group><Button block onClick={() => props.onAction?.("editRequest", { entityRef: data.entityRef, operation: "openEvidenceUpload" })}>添加证据</Button><Button block color="primary" disabled={blocked} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowIds: checked, operation: "submitEvidencePackage", targets: targets(props) })}>提交证据包</Button></Space>);
}

function PhoneAssetReviewLightbox(props: ExperienceBlockRendererProps) {
  const data = bound(props), nameRef = field(props, "nameFieldRef"), urlRef = field(props, "urlFieldRef"), typeRef = field(props, "typeFieldRef");
  const [selectedId, setSelectedId] = React.useState("");
  if (!data || !nameRef || !urlRef) return shell(props, "asset-review-lightbox", "媒体资产审阅墙", empty("尚未绑定媒体资产"));
  const selected = data.rows.find(row => row.id === selectedId);
  return shell(props, "asset-review-lightbox", "媒体资产审阅墙", <><Grid columns={3} gap={4}>{data.rows.map(row => <Grid.Item key={row.id}><Image width="100%" height={94} fit="cover" src={value(row, urlRef)} fallback="/brand/logo.png" onClick={() => setSelectedId(row.id)} /></Grid.Item>)}</Grid><Popup visible={Boolean(selected)} onMaskClick={() => setSelectedId("")} bodyStyle={{ padding: 16 }}><Image width="100%" height={260} fit="contain" src={selected ? value(selected, urlRef) : ""} fallback="/brand/logo.png" /><List><List.Item extra={selected ? value(selected, typeRef, "图片") : ""}>{selected ? value(selected, nameRef, selected.id) : ""}</List.Item></List><Button block color="primary" onClick={() => selected && props.onAction?.("itemSelect", { entityRef: data.entityRef, rowId: selected.id })}>打开资产</Button></Popup></>);
}

function PhonePaymentAllocationWorkbench(props: ExperienceBlockRendererProps) {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), dueRef = field(props, "invoiceDueFieldRef"), payment = Number(props.block.props?.paymentAmount ?? 10000);
  const [allocations, setAllocations] = React.useState<Record<string, number>>({});
  if (!data || !titleRef || !dueRef) return shell(props, "payment-allocation-workbench", "付款分配工作台", empty("尚未绑定待付款发票"));
  const allocated = Object.values(allocations).reduce((sum, amount) => sum + amount, 0), remaining = payment - allocated;
  return shell(props, "payment-allocation-workbench", "付款分配工作台", <Space block direction="vertical"><Card><strong>剩余 {remaining.toFixed(2)}</strong><ProgressBar percent={Math.min(100, Math.round(allocated / Math.max(1, payment) * 100))} /></Card><List>{data.rows.map(row => <List.Item key={row.id} description={`待付 ${Number(row.values?.[dueRef] ?? 0).toFixed(2)}`} extra={<Input type="number" value={String(allocations[row.id] ?? 0)} onChange={next => setAllocations(current => ({ ...current, [row.id]: Number(next || 0) }))} style={{ width: 92 }} />}>{value(row, titleRef, row.id)}</List.Item>)}</List><Button block color="primary" disabled={allocated <= 0 || remaining < 0} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, allocations, paymentAmount: payment, operation: "allocatePayment", targets: targets(props) })}>确认分配</Button></Space>);
}

function PhoneDeploymentRolloutTrack(props: ExperienceBlockRendererProps) {
  const data = bound(props), titleRef = field(props, "titleFieldRef"), statusRef = field(props, "statusFieldRef"), healthRef = field(props, "rolloutHealthFieldRef");
  if (!data || !titleRef || !statusRef) return shell(props, "deployment-rollout-track", "发布编排轨道", empty("尚未绑定发布阶段"));
  const current = Math.max(0, data.rows.findIndex(row => !/succeeded|healthy|complete/i.test(value(row, statusRef))));
  return shell(props, "deployment-rollout-track", "发布编排轨道", <Space block direction="vertical"><Steps direction="vertical">{data.rows.map(row => <Steps.Step key={row.id} title={value(row, titleRef, row.id)} description={`${value(row, statusRef)}${healthRef ? ` · ${value(row, healthRef)}` : ""}`} status={/failed|degraded/i.test(value(row, statusRef)) ? "error" : /succeeded|healthy|complete/i.test(value(row, statusRef)) ? "finish" : "process"} />)}</Steps><Grid columns={2} gap={8}><Grid.Item><Button block onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, operation: "pauseRollout", targets: targets(props) })}>暂停</Button></Grid.Item><Grid.Item><Button block color="primary" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: data.rows[current]?.id, operation: "retryRolloutStage", targets: targets(props) })}>重试阶段</Button></Grid.Item></Grid></Space>);
}

export function renderIndependentStructurePhoneBlock(props: ExperienceBlockRendererProps): React.ReactNode | undefined {
  switch (props.block.type) {
    case "SignatureFieldCanvas": return <PhoneSignatureFieldCanvas {...props} />;
    case "AlertGroupAccordion": return <PhoneAlertGroupAccordion {...props} />;
    case "EvidenceCollectionWorkspace": return <PhoneEvidenceCollectionWorkspace {...props} />;
    case "AssetReviewLightbox": return <PhoneAssetReviewLightbox {...props} />;
    case "PaymentAllocationWorkbench": return <PhonePaymentAllocationWorkbench {...props} />;
    case "DeploymentRolloutTrack": return <PhoneDeploymentRolloutTrack {...props} />;
    default: return undefined;
  }
}
