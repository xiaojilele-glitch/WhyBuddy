import React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  Descriptions,
  Empty,
  Flex,
  Image,
  InputNumber,
  Progress,
  Segmented,
  Space,
  Splitter,
  Statistic,
  Steps,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Row = NonNullable<ExperienceBlockRendererProps["entityRows"]>[string][number];

const field = (props: ExperienceBlockRendererProps, key: string) =>
  String(props.block.binding?.[key] ?? "").trim();
const targets = (props: ExperienceBlockRendererProps) =>
  Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const bound = (props: ExperienceBlockRendererProps) => {
  const entityRef = field(props, "entityRef");
  const rows = entityRef ? props.entityRows?.[entityRef] : undefined;
  return entityRef && rows ? { entityRef, rows } : undefined;
};
const value = (row: Row, ref: string, fallback = "") =>
  String(row.values?.[ref] ?? fallback);
const shell = (props: ExperienceBlockRendererProps, testid: string, fallback: string, body: React.ReactNode) =>
  props.block.props?.surface === "plain" ? <section data-testid={testid} style={{ paddingBottom: 120 }}>{body}</section> :
    <Card size="small" title={String(props.block.props?.title ?? fallback)} data-testid={testid}>{body}</Card>;
const missing = (props: ExperienceBlockRendererProps, testid: string, title: string) =>
  shell(props, testid, title, <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="区块尚未绑定所需数据" />);

export const SignatureFieldCanvasRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props);
  const nameRef = field(props, "nameFieldRef");
  const roleRef = field(props, "roleFieldRef");
  const statusRef = field(props, "statusFieldRef");
  const [recipientId, setRecipientId] = React.useState("");
  const [fieldType, setFieldType] = React.useState("signature");
  if (!data || !nameRef || !roleRef) return missing(props, "signature-field-canvas", "签署字段画布");
  const recipient = data.rows.find(row => row.id === recipientId) ?? data.rows[0];
  return shell(props, "signature-field-canvas", "签署字段画布",
    <Splitter style={{ minHeight: 360 }}>
      <Splitter.Panel defaultSize="68%" min="52%">
        <Flex vertical gap={12} style={{ paddingRight: 16 }}>
          <Flex justify="space-between" align="center">
            <Segmented value={fieldType} onChange={next => setFieldType(String(next))} options={[{ label: "签名", value: "signature" }, { label: "日期", value: "date" }, { label: "文本", value: "text" }]} />
            <Typography.Text type="secondary">第 1 / 3 页</Typography.Text>
          </Flex>
          <div style={{ minHeight: 292, position: "relative", background: "#f5f5f5", padding: 24 }}>
            <div style={{ height: 244, background: "#fff", boxShadow: "0 2px 12px rgba(0,0,0,.08)", padding: 24 }}>
              <Typography.Title level={4}>服务合作协议</Typography.Title>
              <Typography.Paragraph type="secondary">请核对条款，并在指定位置完成签署。</Typography.Paragraph>
              <Tag color="processing" style={{ position: "absolute", right: 52, bottom: 52 }}>
                {recipient ? value(recipient, nameRef, recipient.id) : "请选择签署人"} · {fieldType}
              </Tag>
            </div>
          </div>
          <Button type="primary" disabled={!recipient} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, recipientId: recipient?.id, fieldType, page: 1, x: 72, y: 78, operation: "placeSignatureField", targets: targets(props) })}>放置字段</Button>
        </Flex>
      </Splitter.Panel>
      <Splitter.Panel min="24%">
        <Flex vertical gap={8} style={{ paddingLeft: 16 }}>
          <Typography.Text strong>签署人轨道</Typography.Text>
          {data.rows.map(row => <Card key={row.id} size="small" hoverable onClick={() => setRecipientId(row.id)} style={{ borderColor: recipient?.id === row.id ? "#1677ff" : undefined }}>
            <Flex justify="space-between"><span>{value(row, nameRef, row.id)}</span><Tag>{value(row, roleRef, "签署人")}</Tag></Flex>
            {statusRef && <Typography.Text type="secondary">{value(row, statusRef, "待配置")}</Typography.Text>}
          </Card>)}
        </Flex>
      </Splitter.Panel>
    </Splitter>);
};

export const AlertGroupAccordionRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props);
  const titleRef = field(props, "titleFieldRef");
  const groupRef = field(props, "groupFieldRef");
  const statusRef = field(props, "statusFieldRef");
  const severityRef = field(props, "severityFieldRef");
  if (!data || !titleRef || !groupRef || !statusRef) return missing(props, "alert-group-accordion", "告警分组折叠台");
  const grouped = data.rows.reduce<Record<string, Row[]>>((all, row) => {
    (all[value(row, groupRef, "未分组")] ??= []).push(row);
    return all;
  }, {});
  const groups = Object.entries(grouped);
  return shell(props, "alert-group-accordion", "告警分组折叠台", <Collapse defaultActiveKey={groups[0]?.[0]} items={groups.map(([group, rows]) => ({
    key: group,
    label: <Flex justify="space-between"><Space><Badge status={rows!.some(row => /firing|critical/i.test(value(row, statusRef))) ? "error" : "success"} /><Typography.Text strong>{group}</Typography.Text></Space><Tag>{rows!.length} 条</Tag></Flex>,
    extra: <Button size="small" onClick={event => { event.stopPropagation(); props.onAction?.("submitRequest", { entityRef: data.entityRef, group, rowIds: rows!.map(row => row.id), operation: "muteAlertGroup", targets: targets(props) }); }}>静默组</Button>,
    children: <Flex vertical gap={8}>{rows!.map(row => <Card key={row.id} size="small"><Flex justify="space-between"><Typography.Text>{value(row, titleRef, row.id)}</Typography.Text><Space><Tag color={/critical/i.test(value(row, severityRef)) ? "error" : "warning"}>{value(row, severityRef, "warning")}</Tag><Tag>{value(row, statusRef)}</Tag></Space></Flex></Card>)}</Flex>,
  }))} />);
};

export const EvidenceCollectionWorkspaceRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props);
  const titleRef = field(props, "titleFieldRef");
  const requiredRef = field(props, "requiredFieldRef");
  const statusRef = field(props, "statusFieldRef");
  const [checked, setChecked] = React.useState<string[]>([]);
  if (!data || !titleRef || !statusRef) return missing(props, "evidence-collection-workspace", "证据采集工作区");
  const required = data.rows.filter(row => !requiredRef || /true|required|yes/i.test(value(row, requiredRef, "true")));
  const completed = data.rows.filter(row => checked.includes(row.id) || /accepted|uploaded|complete/i.test(value(row, statusRef))).length;
  const blocked = required.some(row => !checked.includes(row.id) && !/accepted|uploaded|complete/i.test(value(row, statusRef)));
  return shell(props, "evidence-collection-workspace", "证据采集工作区", <Flex gap={16} align="stretch">
    <div style={{ flex: 1 }}><Progress percent={Math.round(completed / Math.max(1, data.rows.length) * 100)} /><Checkbox.Group value={checked} onChange={items => setChecked(items.map(String))}><Flex vertical gap={8} style={{ marginTop: 12 }}>{data.rows.map(row => <Checkbox key={row.id} value={row.id} disabled={/rejected/i.test(value(row, statusRef))}><Space><span>{value(row, titleRef, row.id)}</span>{requiredRef && /true|required|yes/i.test(value(row, requiredRef)) && <Tag color="red">必需</Tag>}<Tag>{value(row, statusRef, "缺失")}</Tag></Space></Checkbox>)}</Flex></Checkbox.Group></div>
    <Card size="small" title="上传与送审" style={{ width: 260 }}><Upload.Dragger beforeUpload={() => false} multiple><Typography.Text>拖入证据文件</Typography.Text><br /><Typography.Text type="secondary">文件保留在待提交队列</Typography.Text></Upload.Dragger><Button block type="primary" disabled={blocked} style={{ marginTop: 12 }} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowIds: checked, operation: "submitEvidencePackage", targets: targets(props) })}>提交证据包</Button>{blocked && <Alert type="warning" showIcon message="必需证据尚未齐全" style={{ marginTop: 8 }} />}</Card>
  </Flex>);
};

export const AssetReviewLightboxRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props);
  const nameRef = field(props, "nameFieldRef");
  const urlRef = field(props, "urlFieldRef");
  const typeRef = field(props, "typeFieldRef");
  const createdRef = field(props, "createdFieldRef");
  const [selectedId, setSelectedId] = React.useState("");
  if (!data || !nameRef || !urlRef) return missing(props, "asset-review-lightbox", "媒体资产审阅墙");
  const selected = data.rows.find(row => row.id === selectedId) ?? data.rows[0];
  return shell(props, "asset-review-lightbox", "媒体资产审阅墙", <Flex gap={16}>
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>{data.rows.map(row => <div key={row.id} onClick={() => setSelectedId(row.id)} style={{ cursor: "pointer", outline: selected?.id === row.id ? "2px solid #1677ff" : "none" }}><Image preview={false} width="100%" height={112} style={{ objectFit: "cover" }} src={value(row, urlRef)} fallback="/brand/logo.png" /></div>)}</div>
    {selected && <Card size="small" style={{ width: 230 }}><Image width="100%" height={128} style={{ objectFit: "cover" }} src={value(selected, urlRef)} fallback="/brand/logo.png" /><Descriptions size="small" column={1} items={[{ key: "name", label: "名称", children: value(selected, nameRef, selected.id) }, { key: "type", label: "类型", children: value(selected, typeRef, "图片") }, { key: "created", label: "时间", children: value(selected, createdRef, "-") }]} /><Button block onClick={() => props.onAction?.("itemSelect", { entityRef: data.entityRef, rowId: selected.id })}>打开资产</Button></Card>}
  </Flex>);
};

export const PaymentAllocationWorkbenchRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props);
  const titleRef = field(props, "titleFieldRef");
  const dueRef = field(props, "invoiceDueFieldRef");
  const payment = Number(props.block.props?.paymentAmount ?? 10000);
  const [allocations, setAllocations] = React.useState<Record<string, number>>({});
  if (!data || !titleRef || !dueRef) return missing(props, "payment-allocation-workbench", "付款分配工作台");
  const allocated = Object.values(allocations).reduce((sum, amount) => sum + amount, 0);
  const remaining = payment - allocated;
  return shell(props, "payment-allocation-workbench", "付款分配工作台", <Flex gap={16} vertical>
    <Flex gap={16}><Statistic title="可分配付款" value={payment} precision={2} /><Statistic title="已分配" value={allocated} precision={2} /><Statistic title="剩余" value={remaining} precision={2} valueStyle={{ color: remaining < 0 ? "#cf1322" : undefined }} /></Flex>
    <Flex vertical gap={8}>{data.rows.map(row => { const due = Number(row.values?.[dueRef] ?? 0); return <Card size="small" key={row.id}><Flex justify="space-between" align="center"><div><Typography.Text strong>{value(row, titleRef, row.id)}</Typography.Text><br /><Typography.Text type="secondary">待付 {due.toFixed(2)}</Typography.Text></div><InputNumber min={0} max={due} precision={2} value={allocations[row.id] ?? 0} onChange={next => setAllocations(current => ({ ...current, [row.id]: Number(next ?? 0) }))} /></Flex></Card>; })}</Flex>
    <Button type="primary" disabled={allocated <= 0 || remaining < 0} onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, allocations, paymentAmount: payment, operation: "allocatePayment", targets: targets(props) })}>确认分配</Button>
  </Flex>);
};

export const DeploymentRolloutTrackRenderer: ExperienceBlockRenderer = props => {
  const data = bound(props);
  const titleRef = field(props, "titleFieldRef");
  const statusRef = field(props, "statusFieldRef");
  const healthRef = field(props, "rolloutHealthFieldRef");
  if (!data || !titleRef || !statusRef) return missing(props, "deployment-rollout-track", "发布编排轨道");
  const current = Math.max(0, data.rows.findIndex(row => !/succeeded|healthy|complete/i.test(value(row, statusRef))));
  return shell(props, "deployment-rollout-track", "发布编排轨道", <Flex vertical gap={16}>
    <Steps current={current} items={data.rows.map(row => ({ title: value(row, titleRef, row.id), status: /failed|degraded/i.test(value(row, statusRef)) ? "error" : /succeeded|healthy|complete/i.test(value(row, statusRef)) ? "finish" : "process", description: <Space><Tag>{value(row, statusRef)}</Tag>{healthRef && <Badge status={/healthy/i.test(value(row, healthRef)) ? "success" : "warning"} text={value(row, healthRef)} />}</Space> }))} />
    <Alert type={data.rows.some(row => /failed|degraded/i.test(value(row, statusRef))) ? "error" : "info"} message="每个阶段必须健康后才推进下一阶段" action={<Space><Button onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, operation: "pauseRollout", targets: targets(props) })}>暂停</Button><Button type="primary" onClick={() => props.onAction?.("submitRequest", { entityRef: data.entityRef, rowId: data.rows[current]?.id, operation: "retryRolloutStage", targets: targets(props) })}>重试当前阶段</Button></Space>} />
  </Flex>);
};

export const INDEPENDENT_STRUCTURE_RENDERERS = {
  SignatureFieldCanvas: SignatureFieldCanvasRenderer,
  AlertGroupAccordion: AlertGroupAccordionRenderer,
  EvidenceCollectionWorkspace: EvidenceCollectionWorkspaceRenderer,
  AssetReviewLightbox: AssetReviewLightboxRenderer,
  PaymentAllocationWorkbench: PaymentAllocationWorkbenchRenderer,
  DeploymentRolloutTrack: DeploymentRolloutTrackRenderer,
} satisfies Record<string, ExperienceBlockRenderer>;

export const INDEPENDENT_STRUCTURE_LABELS: Record<string, string> = {
  SignatureFieldCanvas: "签署字段画布",
  AlertGroupAccordion: "告警分组折叠台",
  EvidenceCollectionWorkspace: "证据采集工作区",
  AssetReviewLightbox: "媒体资产审阅墙",
  PaymentAllocationWorkbench: "付款分配工作台",
  DeploymentRolloutTrack: "发布编排轨道",
};
