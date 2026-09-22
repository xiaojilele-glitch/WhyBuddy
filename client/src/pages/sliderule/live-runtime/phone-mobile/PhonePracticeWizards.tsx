import React from "react";
import { Button, Card, Dialog, ErrorBlock, List, ProgressBar, Selector, Space, Steps, Tag } from "antd-mobile";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "../block-registry";

type Policy = { title: string; testid: string; confirm: string; mapping?: boolean };
const text = (value: unknown, fallback = "") => String(value ?? "").trim() || fallback;
const ref = (props: ExperienceBlockRendererProps, key: string) => text(props.block.binding?.[key]);

function rowsOf(props: ExperienceBlockRendererProps) {
  const entityRef = ref(props, "entityRef");
  return entityRef && props.entityRows && entityRef in props.entityRows ? { entityRef, rows: props.entityRows[entityRef] ?? [] } : null;
}

function createPhoneWizard(policy: Policy): ExperienceBlockRenderer {
  return props => {
    const bound = rowsOf(props);
    const titleRef = ref(props, "titleFieldRef");
    const statusRef = ref(props, "statusFieldRef");
    const descRef = ref(props, "descFieldRef");
    const [current, setCurrent] = React.useState(0);
    const [mappings, setMappings] = React.useState<Record<string, string>>({});
    const shell = (children: React.ReactNode) => props.block.props?.surface === "plain" ? <section data-testid={`phone-${policy.testid}`}>{children}</section> : <Card title={text(props.block.props?.title, policy.title)} data-testid={`phone-${policy.testid}`}>{children}</Card>;
    if (!bound || !titleRef || !statusRef) return shell(<ErrorBlock status="empty" description="尚未绑定步骤标题和状态字段" />);
    if (!bound.rows.length) return shell(<ErrorBlock status="empty" description="暂无配置步骤" />);
    const row = bound.rows[Math.min(current, bound.rows.length - 1)];
    const status = text(row.values?.[statusRef]);
    const invalid = ["error", "invalid", "blocked", "failed", "错误", "阻塞"].includes(status.toLowerCase());
    const options = props.enumOptionsOf?.(bound.entityRef, statusRef)?.map(item => ({ label: item.label, value: item.id })) ?? [];
    const ready = !invalid && (!policy.mapping || Boolean(mappings[row.id] || status));
    const changeStep = (next: number) => { setCurrent(next); props.onAction?.("stepChange", { step: next, rowId: bound.rows[next]?.id }); };
    const finish = async () => {
      if (!await Dialog.confirm({ content: policy.confirm, confirmText: "确认提交", cancelText: "继续检查" })) return;
      const rawTargets = props.block.binding?.targets;
      props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowIds: bound.rows.map(item => item.id), mappings, targets: Array.isArray(rawTargets) ? rawTargets.map(String) : [] });
    };
    return shell(<Space block direction="vertical" style={{ "--gap": "12px" }}>
      <Steps current={current}>{bound.rows.map(item => <Steps.Step key={item.id} title={text(item.values?.[titleRef], "未命名步骤")} />)}</Steps>
      <List mode="card" style={{ margin: 0 }}><List.Item description={descRef ? text(row.values?.[descRef]) : undefined} extra={<Tag color={invalid ? "danger" : "primary"}>{status || "待配置"}</Tag>}>{text(row.values?.[titleRef], "未命名步骤")}</List.Item></List>
      {policy.mapping && <Selector columns={2} value={mappings[row.id] ? [mappings[row.id]] : []} options={options} onChange={selected => setMappings(previous => ({ ...previous, [row.id]: String(selected[0] ?? "") }))} />}
      {invalid && <ErrorBlock status="default" title="当前步骤存在校验错误" description="修正后才能继续" />}
      <ProgressBar percent={Math.round(((current + 1) / bound.rows.length) * 100)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><Button disabled={current === 0} onClick={() => changeStep(Math.max(0, current - 1))}>上一步</Button>{current < bound.rows.length - 1 ? <Button color="primary" disabled={!ready} onClick={() => changeStep(current + 1)}>下一步</Button> : <Button color="primary" disabled={!ready} onClick={() => void finish()}>完成配置</Button>}</div>
    </Space>);
  };
}

export const PHONE_PRACTICE_WIZARDS: Readonly<Record<string, ExperienceBlockRenderer>> = {
  OnboardingChecklistWizard: createPhoneWizard({ title: "入职检查向导", testid: "onboarding-checklist-wizard", confirm: "确认所有入职准备均已核对？" }),
  ImportMappingWizard: createPhoneWizard({ title: "导入映射向导", testid: "import-mapping-wizard", confirm: "确认字段映射并开始导入？", mapping: true }),
};
