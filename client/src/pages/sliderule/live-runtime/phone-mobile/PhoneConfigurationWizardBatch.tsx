import React from "react";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  ErrorBlock,
  ProgressBar,
  Selector,
  Space,
  Steps,
  Tag,
  TextArea,
} from "antd-mobile";
import {
  CONFIGURATION_WIZARD_POLICIES,
  type ConfigurationWizardPolicy,
} from "../configuration-wizard-batch";
import type {
  ExperienceBlockRenderer,
  ExperienceBlockRendererProps,
} from "../block-registry";

const valueText = (value: unknown, fallback = "") =>
  String(value ?? "").trim() || fallback;

const bindingRef = (props: ExperienceBlockRendererProps, key: string) =>
  valueText(props.block.binding?.[key]);

const blockedStatuses = new Set([
  "error",
  "invalid",
  "blocked",
  "failed",
  "denied",
  "conflict",
  "错误",
  "阻塞",
  "拒绝",
  "冲突",
]);

function phoneRows(props: ExperienceBlockRendererProps) {
  const entityRef = bindingRef(props, "entityRef");
  return entityRef && props.entityRows && entityRef in props.entityRows
    ? { entityRef, rows: props.entityRows[entityRef] ?? [] }
    : null;
}

function createPhoneConfigurationWizard(
  policy: ConfigurationWizardPolicy
): ExperienceBlockRenderer {
  return props => {
    const bound = phoneRows(props);
    const titleRef = bindingRef(props, "titleFieldRef");
    const statusRef = bindingRef(props, "statusFieldRef");
    const descRef = bindingRef(props, "descFieldRef");
    const [current, setCurrent] = React.useState(0);
    const [drafts, setDrafts] = React.useState<
      Record<string, Record<string, unknown>>
    >({});
    const title = valueText(props.block.props?.title, policy.title);
    const shell = (children: React.ReactNode) =>
      props.block.props?.surface === "plain" ? (
        <section data-testid={`phone-${policy.testid}`}>{children}</section>
      ) : (
        <Card title={title} data-testid={`phone-${policy.testid}`}>
          {children}
        </Card>
      );

    if (!bound || !titleRef || !statusRef)
      return shell(
        <ErrorBlock status="empty" title="尚未绑定步骤标题和状态字段" />
      );
    if (!bound.rows.length)
      return shell(<ErrorBlock status="empty" title="暂无配置步骤" />);

    const row = bound.rows[Math.min(current, bound.rows.length - 1)];
    const status = valueText(row.values?.[statusRef]);
    const blocked = blockedStatuses.has(status.toLowerCase());
    const selectedIds = props.selection?.rowIds?.[bound.entityRef] ?? [];
    const draft = drafts[row.id] ?? {};
    const choiceOptions =
      props.enumOptionsOf?.(bound.entityRef, statusRef)?.map(item => ({
        value: item.id,
        label: item.label,
      })) ?? [];
    const missingSelection =
      policy.requiresSelection === true && selectedIds.length === 0;
    const ready =
      !blocked &&
      !missingSelection &&
      (!policy.requiresChoice || Boolean(draft.choice)) &&
      (!policy.requiresAcknowledgement || draft.acknowledged === true);
    const updateDraft = (patch: Record<string, unknown>) =>
      setDrafts(previous => ({
        ...previous,
        [row.id]: { ...(previous[row.id] ?? {}), ...patch },
      }));
    const changeStep = (next: number) => {
      setCurrent(next);
      props.onAction?.("stepChange", {
        step: next,
        rowId: bound.rows[next]?.id,
        operation: policy.operation,
      });
    };
    const submit = async () => {
      const confirmed = await Dialog.confirm({
        content: policy.confirm,
        confirmText: "确认提交",
        cancelText: "继续检查",
      });
      if (!confirmed) return;
      props.onAction?.("submitRequest", {
        entityRef: bound.entityRef,
        operation: policy.operation,
        rowIds: policy.requiresSelection
          ? selectedIds
          : bound.rows.map(item => item.id),
        drafts,
        targets: Array.isArray(props.block.binding?.targets)
          ? props.block.binding.targets.map(String)
          : [],
      });
    };

    return shell(
      <Space direction="vertical" block style={{ "--gap": "12px" }}>
        <Steps current={current} direction="vertical">
          {bound.rows.map(item => (
            <Steps.Step
              key={item.id}
              title={valueText(item.values?.[titleRef], "未命名步骤")}
              description={valueText(item.values?.[statusRef], "待配置")}
            />
          ))}
        </Steps>
        <div style={{ fontSize: 16, fontWeight: 600 }}>
          {valueText(row.values?.[titleRef], "未命名步骤")}
          <Tag
            color={blocked ? "danger" : "primary"}
            style={{ marginLeft: 8, verticalAlign: 2 }}
          >
            {status || "待配置"}
          </Tag>
        </div>
        {descRef && row.values?.[descRef] != null && (
          <div style={{ color: "var(--adm-color-weak)", fontSize: 13 }}>
            {valueText(row.values[descRef])}
          </div>
        )}
        {policy.requiresChoice && (
          <Selector
            columns={2}
            options={choiceOptions}
            value={draft.choice ? [String(draft.choice)] : []}
            onChange={values => updateDraft({ choice: values[0] })}
          />
        )}
        <TextArea
          value={valueText(draft.note)}
          onChange={note => updateDraft({ note })}
          placeholder={policy.draftLabel}
          autoSize={{ minRows: 3, maxRows: 6 }}
          showCount
          maxLength={500}
        />
        {policy.requiresAcknowledgement && (
          <Checkbox
            checked={draft.acknowledged === true}
            onChange={acknowledged => updateDraft({ acknowledged })}
          >
            我已核对当前步骤的影响范围和风险
          </Checkbox>
        )}
        {missingSelection && (
          <ErrorBlock
            status="default"
            title="没有选中任何记录"
            description="请先在主体列表选择记录，再进入批量配置。"
          />
        )}
        {blocked && (
          <ErrorBlock
            status="disconnected"
            title="当前步骤被阻塞"
            description="修正错误或解除冲突后才能继续。"
          />
        )}
        <ProgressBar
          percent={Math.round(((current + 1) / bound.rows.length) * 100)}
        />
        <Space block justify="between">
          <Button
            disabled={current === 0}
            onClick={() => changeStep(Math.max(0, current - 1))}
          >
            上一步
          </Button>
          {current < bound.rows.length - 1 ? (
            <Button
              color="primary"
              disabled={!ready}
              onClick={() => changeStep(current + 1)}
            >
              下一步
            </Button>
          ) : (
            <Button color="primary" disabled={!ready} onClick={submit}>
              完成配置
            </Button>
          )}
        </Space>
      </Space>
    );
  };
}

export const PHONE_CONFIGURATION_WIZARD_RENDERERS: Record<
  string,
  ExperienceBlockRenderer
> = Object.fromEntries(
  Object.entries(CONFIGURATION_WIZARD_POLICIES).map(([type, policy]) => [
    type,
    createPhoneConfigurationWizard(policy),
  ])
);

export function renderConfigurationWizardPhoneBlock(
  props: ExperienceBlockRendererProps
): React.ReactNode | undefined {
  const Renderer = PHONE_CONFIGURATION_WIZARD_RENDERERS[props.block.type];
  return Renderer ? <Renderer {...props} /> : undefined;
}
