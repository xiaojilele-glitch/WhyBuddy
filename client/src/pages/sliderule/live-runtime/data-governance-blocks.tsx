import React from "react";
import { Alert, Button, Card, Checkbox, Descriptions, Empty, Flex, Input, List, Popconfirm, Progress, Select, Space, Table, Tag, Timeline, Tree, Typography } from "antd";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";
import { CodeEditor, JsonEditor, SqlEditor } from "../base-components/custom-components";

/**
 * 转换表达式用哪一档编辑器（2026-08-10）。
 *
 * 此前这里是一个 `Input.TextArea`，placeholder 写着"填写转换表达式"——**这个
 * 区块的全部意义就是写表达式，却给了一个纯文本框**：没有行号、没有高亮、没有
 * 括号匹配。自研档里躺着现成的 CodeMirror，一直没人接。
 *
 * 语言按 props 选而不是写死 JS：转换表达式在 ToolJet 这类工具里默认是 JS，
 * 但接数据库的场景写的是 SQL、配映射的场景写的是 JSON。同一个区块三种语言，
 * 比拆三个区块诚实。
 */
const TRANSFORM_EDITORS: Record<string, typeof CodeEditor> = {
  javascript: CodeEditor,
  sql: SqlEditor,
  json: JsonEditor,
};

type Variant = "schema" | "transform" | "validation" | "duplicate" | "merge" | "checkpoint" | "retry" | "history" | "lineage" | "change" | "permission" | "webhook";
type Config = { variant: Variant; title: string; testid: string };
const text = (value: unknown, fallback = "") => String(value ?? "").trim() || fallback;
const ref = (props: ExperienceBlockRendererProps, key: string) => text(props.block.binding?.[key]);
const targets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const failed = (value: unknown) => /failed|error|invalid|conflict|失败|错误|冲突/i.test(text(value));

function createDataGovernanceBlock(config: Config): ExperienceBlockRenderer {
  return props => {
    const entityRef = ref(props, "entityRef"), rows = entityRef ? props.entityRows?.[entityRef] : undefined;
    const titleRef = ref(props, "titleFieldRef"), sourceRef = ref(props, "sourceFieldRef"), targetRef = ref(props, "targetFieldRef"), statusRef = ref(props, "statusFieldRef"), messageRef = ref(props, "messageFieldRef"), valueRef = ref(props, "valueFieldRef"), parentRef = ref(props, "parentFieldRef"), timeRef = ref(props, "timeFieldRef"), oldRef = ref(props, "oldValueFieldRef"), newRef = ref(props, "newValueFieldRef"), allowedRef = ref(props, "allowedFieldRef");
    const [drafts, setDrafts] = React.useState<Record<string, string>>({}), [selected, setSelected] = React.useState<Record<string, string>>({}), [ack, setAck] = React.useState(false);
    const shell = (children: React.ReactNode) => props.block.props?.surface === "plain" ? <section data-testid={config.testid}>{children}</section> : <Card size="small" title={text(props.block.props?.title, config.title)} data-testid={config.testid}>{children}</Card>;
    if (!entityRef || !rows) return shell(<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${config.title}尚未绑定实体`} />);
    const submit = (operation: string, payload: Record<string, unknown> = {}) => props.onAction?.("submitRequest", { entityRef, operation, targets: targets(props), ...payload });
    const choose = (rowId: string) => props.onAction?.("itemSelect", { entityRef, rowId });
    let body: React.ReactNode;
    switch (config.variant) {
      case "schema": { const invalid = rows.filter(row => failed(row.values?.[statusRef])); body = <Flex vertical gap={10}><Table size="small" pagination={false} rowKey="id" dataSource={rows} columns={[{ title: "源字段", render: (_, row) => text(row.values?.[sourceRef], row.id) }, { title: "目标字段", render: (_, row) => <Input value={drafts[row.id] ?? text(row.values?.[targetRef])} onChange={event => setDrafts(previous => ({ ...previous, [row.id]: event.target.value }))} /> }, { title: "状态", render: (_, row) => <Tag color={failed(row.values?.[statusRef]) ? "error" : "success"}>{text(row.values?.[statusRef], "待校验")}</Tag> }]} /><Alert type={invalid.length ? "error" : "info"} message={invalid.length ? `${invalid.length} 个非法映射阻止提交` : "映射草稿尚未写入"} /><Button onClick={() => submit("validateSchemaMapping", { mappings: drafts })}>校验映射</Button><Button type="primary" disabled={invalid.length > 0 || Object.keys(drafts).length === 0} onClick={() => submit("saveSchemaMapping", { mappings: drafts })}>提交映射</Button></Flex>; break; }
      case "transform": { const row = rows[0]; const Editor = TRANSFORM_EDITORS[text(props.block.props?.language, "javascript")] ?? CodeEditor; body = row ? <Flex vertical gap={10}><Editor value={drafts[row.id] ?? text(row.values?.[messageRef])} onChange={next => setDrafts({ [row.id]: next })} height="120px" placeholderHeight={120} /><Descriptions size="small" items={[{ key: "source", label: "输入", children: text(row.values?.[sourceRef], "-") }, { key: "preview", label: "预览", children: text(row.values?.[valueRef], "尚未预览") }]} /><Button onClick={() => submit("previewFieldTransform", { rowId: row.id, expression: drafts[row.id] })}>预览</Button><Button type="primary" disabled={!drafts[row.id]} onClick={() => submit("saveFieldTransform", { rowId: row.id, expression: drafts[row.id] })}>保存转换</Button></Flex> : <Empty description="暂无转换字段" />; break; }
      case "validation": { const errors = rows.filter(row => failed(row.values?.[statusRef])), warnings = rows.filter(row => /warning|warn|警告/i.test(text(row.values?.[statusRef]))); body = <Flex vertical gap={10}><Alert type={errors.length ? "error" : warnings.length ? "warning" : "success"} message={`${errors.length} 个错误，${warnings.length} 个警告`} /><List dataSource={rows} renderItem={row => <List.Item><List.Item.Meta title={text(row.values?.[titleRef], row.id)} description={text(row.values?.[messageRef])} /></List.Item>} /><Button type="primary" disabled={errors.length > 0} onClick={() => submit("startValidatedImport", { rowIds: rows.map(row => row.id) })}>开始导入</Button></Flex>; break; }
      case "duplicate": { const groups = [...new Set(rows.map(row => text(row.values?.[parentRef], "default")))]; body = <Flex vertical gap={10}>{groups.map(group => <Select key={group} style={{ width: "100%" }} placeholder={`${group}：选择保留记录`} value={selected[group]} onChange={value => setSelected(previous => ({ ...previous, [group]: value }))} options={rows.filter(row => text(row.values?.[parentRef], "default") === group).map(row => ({ value: row.id, label: text(row.values?.[titleRef], row.id) }))} />)}<Button type="primary" disabled={groups.some(group => !selected[group])} onClick={() => submit("resolveDuplicates", { winners: selected })}>提交去重方案</Button></Flex>; break; }
      case "merge": body = <Flex vertical gap={10}><Descriptions size="small" column={1} items={rows.map(row => ({ key: row.id, label: text(row.values?.[titleRef], row.id), children: text(row.values?.[valueRef], "-") }))} /><Alert type="info" message="当前仅为合并预览，尚未写入目标记录" /><Popconfirm title="确认按当前预览提交合并请求？" onConfirm={() => submit("confirmMerge", { rowIds: rows.map(row => row.id) })}><Button type="primary">确认合并</Button></Popconfirm></Flex>; break;
      case "checkpoint": body = <List dataSource={[...rows].sort((a, b) => text(b.values?.[timeRef]).localeCompare(text(a.values?.[timeRef])))} renderItem={(row, index) => <List.Item actions={[<Button key="resume" size="small" disabled={index !== 0 || failed(row.values?.[statusRef])} onClick={() => submit("resumeFromCheckpoint", { rowId: row.id })}>继续同步</Button>]}><List.Item.Meta title={text(row.values?.[titleRef], row.id)} description={`${text(row.values?.[timeRef])} · ${text(row.values?.[statusRef])}`} /></List.Item>} />; break;
      case "retry": { const ids = rows.filter(row => failed(row.values?.[statusRef])).map(row => row.id); body = <Flex vertical gap={10}><Alert type={ids.length ? "warning" : "success"} message={ids.length ? `${ids.length} 个失败项可重试` : "没有失败项"} /><List dataSource={rows} renderItem={row => <List.Item extra={<Tag color={failed(row.values?.[statusRef]) ? "error" : "success"}>{text(row.values?.[statusRef])}</Tag>}>{text(row.values?.[titleRef], row.id)}</List.Item>} /><Button disabled={!ids.length} onClick={() => submit("retryFailedItems", { rowIds: ids })}>仅重试失败项</Button></Flex>; break; }
      case "history": body = <Timeline items={[...rows].sort((a, b) => text(b.values?.[timeRef]).localeCompare(text(a.values?.[timeRef]))).map(row => ({ children: <Button type="link" onClick={() => choose(row.id)}>{text(row.values?.[titleRef], row.id)} · {text(row.values?.[statusRef])} · {text(row.values?.[timeRef])}</Button> }))} />; break;
      case "lineage": { const nodes = rows.map(row => ({ key: row.id, title: text(row.values?.[titleRef], row.id), parent: text(row.values?.[parentRef]) })), roots = nodes.filter(node => !node.parent).map(node => ({ ...node, children: nodes.filter(child => child.parent === node.key) })); body = <Tree treeData={roots} defaultExpandAll onSelect={keys => keys[0] && choose(String(keys[0]))} />; break; }
      case "change": body = <Flex vertical gap={10}><Table size="small" pagination={false} rowKey="id" dataSource={rows} columns={[{ title: "字段", render: (_, row) => text(row.values?.[titleRef], row.id) }, { title: "原值", render: (_, row) => <Typography.Text delete>{text(row.values?.[oldRef], "-")}</Typography.Text> }, { title: "新值", render: (_, row) => text(row.values?.[newRef], "-") }]} /><Alert type="info" message="变更预览尚未写入" /><Button type="primary" onClick={() => submit("confirmRecordChanges", { rowIds: rows.map(row => row.id) })}>提交变更请求</Button></Flex>; break;
      case "permission": body = <Flex vertical gap={10}><Checkbox.Group value={Object.entries(selected).filter(([, value]) => value === "allow").map(([id]) => id)} onChange={values => setSelected(Object.fromEntries(rows.map(row => [row.id, values.includes(row.id) ? "allow" : "deny"]))) }><Space direction="vertical">{rows.map(row => <Checkbox key={row.id} value={row.id}>{text(row.values?.[titleRef], row.id)} <Tag>{text(row.values?.[allowedRef], "继承")}</Tag></Checkbox>)}</Space></Checkbox.Group><Alert type="warning" message="保存只提交权限申请，不在前端直接提权" /><Button type="primary" disabled={!Object.keys(selected).length} onClick={() => submit("requestPermissionMatrixChange", { permissions: selected })}>提交权限申请</Button></Flex>; break;
      case "webhook": { const failures = rows.filter(row => failed(row.values?.[statusRef])); body = <Flex vertical gap={10}><Progress percent={rows.length ? Math.round(((rows.length - failures.length) / rows.length) * 100) : 0} /><List dataSource={rows} renderItem={row => <List.Item extra={failed(row.values?.[statusRef]) ? <Button size="small" onClick={() => submit("retryWebhookDelivery", { rowIds: [row.id] })}>重试</Button> : <Tag color="success">成功</Tag>}><List.Item.Meta title={text(row.values?.[titleRef], row.id)} description={text(row.values?.[messageRef])} /></List.Item>} /><Button disabled={!failures.length} onClick={() => submit("retryWebhookDelivery", { rowIds: failures.map(row => row.id) })}>重试全部失败项</Button></Flex>; break; }
    }
    return shell(body);
  };
}

const configs: Record<string, Config> = {
  SchemaMappingPanel: { variant: "schema", title: "Schema 映射面板", testid: "schema-mapping-panel" }, FieldTransformPanel: { variant: "transform", title: "字段转换面板", testid: "field-transform-panel" }, ImportValidationPanel: { variant: "validation", title: "导入校验面板", testid: "import-validation-panel" }, DuplicateResolutionPanel: { variant: "duplicate", title: "重复记录解决面板", testid: "duplicate-resolution-panel" }, MergePreviewPanel: { variant: "merge", title: "合并预览面板", testid: "merge-preview-panel" }, SyncCheckpointPanel: { variant: "checkpoint", title: "同步检查点面板", testid: "sync-checkpoint-panel" }, RetryQueuePanel: { variant: "retry", title: "重试队列面板", testid: "retry-queue-panel" }, JobRunHistoryPanel: { variant: "history", title: "任务运行历史", testid: "job-run-history-panel" }, DataLineagePanel: { variant: "lineage", title: "数据血缘面板", testid: "data-lineage-panel" }, RecordChangePreview: { variant: "change", title: "记录变更预览", testid: "record-change-preview" }, PermissionMatrixPanel: { variant: "permission", title: "权限矩阵面板", testid: "permission-matrix-panel" }, WebhookDeliveryPanel: { variant: "webhook", title: "Webhook 投递面板", testid: "webhook-delivery-panel" },
};
export const DATA_GOVERNANCE_RENDERERS: Record<string, ExperienceBlockRenderer> = Object.fromEntries(Object.entries(configs).map(([type, config]) => [type, createDataGovernanceBlock(config)]));
export const DATA_GOVERNANCE_LABELS: Record<string, string> = Object.fromEntries(Object.entries(configs).map(([type, config]) => [type, config.title]));
