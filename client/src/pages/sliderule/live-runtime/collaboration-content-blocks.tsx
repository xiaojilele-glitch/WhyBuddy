import React from "react";
import { Alert, Avatar, Badge, Button, Card, Checkbox, Empty, Flex, Input, List, Mentions, Popconfirm, Segmented, Select, Space, Tag, Timeline, Tree, Typography } from "antd";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Variant = "mention" | "reaction" | "resolution" | "outline" | "version" | "approval" | "backlink" | "presence" | "assignment" | "escalation" | "ownership" | "watcher";
type Config = { variant: Variant; title: string; testid: string };
const text = (value: unknown, fallback = "") => String(value ?? "").trim() || fallback;
const field = (props: ExperienceBlockRendererProps, key: string) => text(props.block.binding?.[key]);
const targets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];
const truthy = (value: unknown) => value === true || /^(true|yes|online|watching|resolved|active|1|是|在线|已解决)$/i.test(text(value));

function createCollaborationBlock(config: Config): ExperienceBlockRenderer {
  return props => {
    const entityRef = field(props, "entityRef");
    const rows = entityRef ? props.entityRows?.[entityRef] : undefined;
    const titleRef = field(props, "titleFieldRef");
    const statusRef = field(props, "statusFieldRef");
    const messageRef = field(props, "messageFieldRef");
    const memberRef = field(props, "memberFieldRef");
    const parentRef = field(props, "parentFieldRef");
    const countRef = field(props, "countFieldRef");
    const timeRef = field(props, "timeFieldRef");
    const [draft, setDraft] = React.useState("");
    const [selected, setSelected] = React.useState<string[]>([]);
    const [mode, setMode] = React.useState<string>("pending");
    const shell = (children: React.ReactNode) => props.block.props?.surface === "plain"
      ? <section data-testid={config.testid}>{children}</section>
      : <Card size="small" title={text(props.block.props?.title, config.title)} data-testid={config.testid}>{children}</Card>;
    if (!entityRef || !rows) return shell(<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${config.title}尚未绑定实体`} />);
    const submit = (operation: string, payload: Record<string, unknown> = {}) => props.onAction?.("submitRequest", { entityRef, operation, targets: targets(props), ...payload });
    const choose = (rowId: string) => props.onAction?.("itemSelect", { entityRef, rowId });
    let body: React.ReactNode;

    switch (config.variant) {
      case "mention": {
        const options = rows.map(row => ({ value: text(row.values?.[titleRef], row.id), label: text(row.values?.[titleRef], row.id) }));
        body = <Flex vertical gap={10}><Mentions value={draft} onChange={setDraft} options={options} placeholder="输入内容，使用 @ 提及协作者" /><Typography.Text type="secondary">候选人仅用于补全，不会自动加入正文或发送通知。</Typography.Text><Button type="primary" disabled={!draft.trim()} onClick={() => { submit("publishMention", { body: draft }); setDraft(""); }}>发布</Button></Flex>;
        break;
      }
      case "reaction":
        body = <Flex wrap gap={8}>{rows.map(row => <Badge key={row.id} count={Number(row.values?.[countRef] ?? 0)} offset={[-2, 2]}><Button onClick={() => submit("toggleReaction", { rowId: row.id })}>{text(row.values?.[titleRef], "回应")}</Button></Badge>)}</Flex>;
        break;
      case "resolution": {
        const current = rows[0];
        const resolved = current ? truthy(current.values?.[statusRef]) : false;
        body = current ? <Alert type={resolved ? "success" : "info"} showIcon message={resolved ? "讨论已解决" : "讨论仍在进行"} action={<Popconfirm title={resolved ? "确认重新打开讨论？" : "确认解决讨论？"} onConfirm={() => submit(resolved ? "reopenThread" : "resolveThread", { rowId: current.id })}><Button size="small">{resolved ? "重新打开" : "标记解决"}</Button></Popconfirm>} /> : <Empty description="暂无讨论" />;
        break;
      }
      case "outline": {
        const tree = rows.map(row => ({ key: row.id, title: text(row.values?.[titleRef], "未命名章节"), parent: text(row.values?.[parentRef]) }));
        const roots = tree.filter(item => !item.parent).map(item => ({ ...item, children: tree.filter(child => child.parent === item.key) }));
        body = roots.length ? <Tree treeData={roots} defaultExpandAll onSelect={keys => keys[0] && choose(String(keys[0]))} /> : <Empty description="暂无文档大纲" />;
        break;
      }
      case "version": {
        const selectedRows = rows.filter(row => selected.includes(row.id));
        body = <Flex vertical gap={10}><Checkbox.Group value={selected} onChange={values => setSelected(values.map(String))}><Space direction="vertical">{rows.slice(0, 10).map(row => <Checkbox key={row.id} value={row.id} disabled={!selected.includes(row.id) && selected.length >= 2}>{text(row.values?.[titleRef], row.id)} {timeRef && <Typography.Text type="secondary">{text(row.values?.[timeRef])}</Typography.Text>}</Checkbox>)}</Space></Checkbox.Group><Alert type={selected.length === 2 ? "info" : "warning"} message={selected.length === 2 ? `只读比较：${selectedRows.map(row => text(row.values?.[titleRef], row.id)).join(" / ")}` : "请选择恰好两个版本"} /><Button disabled={selected.length !== 2} onClick={() => props.onAction?.("itemSelect", { entityRef, rowIds: selected, operation: "compareVersions" })}>查看差异</Button></Flex>;
        break;
      }
      case "approval": {
        const row = rows[0];
        body = row ? <Flex vertical gap={10}><Typography.Text>{text(row.values?.[messageRef], "暂无审批说明")}</Typography.Text><Input.TextArea value={draft} onChange={event => setDraft(event.target.value)} placeholder="填写审批评论" /><Flex gap={8}><Button onClick={() => submit("saveApprovalComment", { rowId: row.id, comment: draft })} disabled={!draft.trim()}>保存评论</Button><Button type="primary" onClick={() => submit("submitApprovalDecision", { rowId: row.id, decision: "approve", comment: draft })}>通过</Button></Flex></Flex> : <Empty description="暂无待审批内容" />;
        break;
      }
      case "backlink":
        body = <List dataSource={rows} locale={{ emptyText: "暂无反向链接" }} renderItem={row => <List.Item onClick={() => choose(row.id)} extra={<Tag>{text(row.values?.[statusRef], "引用")}</Tag>}><List.Item.Meta title={text(row.values?.[titleRef], "未命名文档")} description={text(row.values?.[messageRef])} /></List.Item>} />;
        break;
      case "presence":
        body = <Avatar.Group max={{ count: 6 }}>{rows.map(row => <Badge key={row.id} dot status={truthy(row.values?.[statusRef]) ? "success" : "default"}><Avatar>{text(row.values?.[memberRef || titleRef], "?").slice(0, 1)}</Avatar></Badge>)}</Avatar.Group>;
        break;
      case "assignment": {
        const filtered = rows.filter(row => mode === "all" || text(row.values?.[statusRef]).toLowerCase() === mode);
        body = <Flex vertical gap={10}><Segmented value={mode} onChange={value => setMode(String(value))} options={[{ label: "待分配", value: "pending" }, { label: "处理中", value: "active" }, { label: "全部", value: "all" }]} /><List dataSource={filtered} locale={{ emptyText: "当前队列为空" }} renderItem={row => <List.Item actions={[<Button key="assign" size="small" onClick={() => submit("assignItem", { rowId: row.id })}>分配</Button>]}><List.Item.Meta title={text(row.values?.[titleRef], row.id)} description={text(row.values?.[memberRef], "未分配")} /></List.Item>} /></Flex>;
        break;
      }
      case "escalation":
        body = <Timeline items={[...rows].sort((a, b) => Number(a.values?.[countRef] ?? 0) - Number(b.values?.[countRef] ?? 0)).map(row => ({ children: <Flex justify="space-between"><span>{text(row.values?.[titleRef], row.id)}</span><Tag>{text(row.values?.[countRef], "0")} 分钟</Tag></Flex> }))} />;
        break;
      case "ownership": {
        const row = rows[0];
        const options = rows.map(item => ({ value: item.id, label: text(item.values?.[memberRef || titleRef], item.id) }));
        body = row ? <Flex vertical gap={10}><Alert type="warning" showIcon message={`当前所有者：${text(row.values?.[memberRef], "未指定")}`} /><Select value={selected[0]} onChange={value => setSelected([value])} options={options} placeholder="选择新所有者" /><Popconfirm title="确认转移所有权？此操作会改变后续管理责任。" onConfirm={() => submit("transferOwnership", { rowId: row.id, newOwnerId: selected[0] })}><Button danger disabled={!selected[0]}>确认转移</Button></Popconfirm></Flex> : <Empty description="暂无可转移对象" />;
        break;
      }
      case "watcher":
        body = <List dataSource={rows} locale={{ emptyText: "暂无关注者" }} renderItem={row => { const watching = truthy(row.values?.[statusRef]); return <List.Item actions={[<Button key="toggle" size="small" onClick={() => submit(watching ? "removeWatcher" : "addWatcher", { rowId: row.id })}>{watching ? "取消关注" : "关注"}</Button>]}><List.Item.Meta avatar={<Avatar>{text(row.values?.[memberRef || titleRef], "?").slice(0, 1)}</Avatar>} title={text(row.values?.[memberRef || titleRef], row.id)} description="关注只影响通知，不改变访问权限" /></List.Item>; }} />;
        break;
    }
    return shell(body);
  };
}

const configs: Record<string, Config> = {
  MentionComposer: { variant: "mention", title: "提及编辑器", testid: "mention-composer" }, ReactionSummary: { variant: "reaction", title: "回应摘要", testid: "reaction-summary" }, ThreadResolutionBar: { variant: "resolution", title: "讨论解决栏", testid: "thread-resolution-bar" }, DocumentOutlinePanel: { variant: "outline", title: "文档大纲面板", testid: "document-outline-panel" }, VersionComparePanel: { variant: "version", title: "版本对比面板", testid: "version-compare-panel" }, ApprovalCommentPanel: { variant: "approval", title: "审批评论面板", testid: "approval-comment-panel" }, KnowledgeBacklinkPanel: { variant: "backlink", title: "知识反向链接", testid: "knowledge-backlink-panel" }, PresenceRosterPanel: { variant: "presence", title: "在线成员面板", testid: "presence-roster-panel" }, AssignmentQueuePanel: { variant: "assignment", title: "分配队列面板", testid: "assignment-queue-panel" }, EscalationPolicyPanel: { variant: "escalation", title: "升级策略面板", testid: "escalation-policy-panel" }, OwnershipTransferPanel: { variant: "ownership", title: "所有权转移面板", testid: "ownership-transfer-panel" }, WatcherManagerPanel: { variant: "watcher", title: "关注者管理面板", testid: "watcher-manager-panel" },
};
export const COLLABORATION_CONTENT_RENDERERS: Record<string, ExperienceBlockRenderer> = Object.fromEntries(Object.entries(configs).map(([type, config]) => [type, createCollaborationBlock(config)]));
export const COLLABORATION_CONTENT_LABELS: Record<string, string> = Object.fromEntries(Object.entries(configs).map(([type, config]) => [type, config.title]));
