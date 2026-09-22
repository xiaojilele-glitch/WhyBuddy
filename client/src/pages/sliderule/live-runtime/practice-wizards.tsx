import React from "react";
import { Alert, Button, Card, Empty, Flex, Popconfirm, Progress, Select, Steps, Tag, Typography } from "antd";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type WizardPolicy = { title: string; testid: string; confirm: string; mapping?: boolean };

const text = (value: unknown, fallback = "") => String(value ?? "").trim() || fallback;
const fieldRef = (props: ExperienceBlockRendererProps, key: string) => text(props.block.binding?.[key]);
const targetIds = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(value => text(value)).filter(Boolean) : [];

function rowsOf(props: ExperienceBlockRendererProps) {
  const entityRef = text(props.block.binding?.entityRef);
  return entityRef && props.entityRows && entityRef in props.entityRows
    ? { entityRef, rows: props.entityRows[entityRef] ?? [] }
    : null;
}

function WizardSurface({ props, policy, children }: { props: ExperienceBlockRendererProps; policy: WizardPolicy; children: React.ReactNode }) {
  const title = text(props.block.props?.title, policy.title);
  if (props.block.props?.surface === "plain") return <section data-testid={policy.testid}>{children}</section>;
  return <Card size="small" title={title} data-testid={policy.testid}>{children}</Card>;
}

function createWizard(policy: WizardPolicy): ExperienceBlockRenderer {
  return props => {
    if (props.children !== undefined && props.children !== null) return <>{props.children}</>;
    const bound = rowsOf(props);
    const titleRef = fieldRef(props, "titleFieldRef");
    const statusRef = fieldRef(props, "statusFieldRef");
    const descRef = fieldRef(props, "descFieldRef");
    const [current, setCurrent] = React.useState(0);
    const [mappings, setMappings] = React.useState<Record<string, string>>({});
    if (!bound || !titleRef || !statusRef) return <WizardSurface props={props} policy={policy}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未绑定步骤标题和状态字段" /></WizardSurface>;
    if (bound.rows.length === 0) return <WizardSurface props={props} policy={policy}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无配置步骤" /></WizardSurface>;
    const row = bound.rows[Math.min(current, bound.rows.length - 1)];
    const status = text(row.values?.[statusRef]);
    const invalid = ["error", "invalid", "blocked", "failed", "错误", "阻塞"].includes(status.toLowerCase());
    const options = props.enumOptionsOf?.(bound.entityRef, statusRef)?.map(item => ({ value: item.id, label: item.label })) ?? [];
    const ready = !invalid && (!policy.mapping || Boolean(mappings[row.id] || status));
    const changeStep = (next: number) => {
      setCurrent(next);
      props.onAction?.("stepChange", { step: next, rowId: bound.rows[next]?.id });
    };
    const submit = () => props.onAction?.("submitRequest", {
      entityRef: bound.entityRef,
      rowIds: bound.rows.map(item => item.id),
      mappings,
      targets: targetIds(props),
    });
    return <WizardSurface props={props} policy={policy}>
      <Steps current={current} responsive items={bound.rows.map(item => ({ title: text(item.values?.[titleRef], "未命名步骤"), status: ["done", "complete", "ready", "完成"].includes(text(item.values?.[statusRef]).toLowerCase()) ? "finish" : undefined }))} />
      <Card size="small" style={{ marginTop: 16 }}>
        <Flex vertical gap={12}>
          <Flex justify="space-between" align="center" gap={8}><Typography.Title level={5} style={{ margin: 0 }}>{text(row.values?.[titleRef], "未命名步骤")}</Typography.Title><Tag color={invalid ? "error" : "processing"}>{status || "待配置"}</Tag></Flex>
          {descRef && row.values?.[descRef] != null && <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{text(row.values[descRef])}</Typography.Paragraph>}
          {policy.mapping && <Select aria-label="选择映射目标" value={mappings[row.id]} placeholder="选择映射目标" options={options} onChange={value => setMappings(previous => ({ ...previous, [row.id]: value }))} />}
          {invalid && <Alert type="error" showIcon message="当前步骤存在校验错误" description="修正后才能继续，系统不会跳过失败步骤。" />}
          <Progress percent={Math.round(((current + 1) / bound.rows.length) * 100)} size="small" />
          <Flex justify="space-between"><Button disabled={current === 0} onClick={() => changeStep(Math.max(0, current - 1))}>上一步</Button>{current < bound.rows.length - 1 ? <Button type="primary" disabled={!ready} onClick={() => changeStep(current + 1)}>下一步</Button> : <Popconfirm title={policy.confirm} okText="确认提交" cancelText="继续检查" onConfirm={submit}><Button type="primary" disabled={!ready}>完成配置</Button></Popconfirm>}</Flex>
        </Flex>
      </Card>
    </WizardSurface>;
  };
}

export const OnboardingChecklistWizardRenderer = createWizard({ title: "入职检查向导", testid: "onboarding-checklist-wizard", confirm: "确认所有入职准备均已核对？" });
export const ImportMappingWizardRenderer = createWizard({ title: "导入映射向导", testid: "import-mapping-wizard", confirm: "确认字段映射并开始导入？", mapping: true });
