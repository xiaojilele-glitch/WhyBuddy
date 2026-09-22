import React from "react";
import { PHONE_BLOCK_TYPES } from "../block-registry";
import {
  Badge,
  Button,
  Card,
  CalendarPicker,
  Checkbox,
  Collapse,
  ErrorBlock,
  Form,
  Grid,
  Image,
  Input,
  List,
  Picker,
  Popup,
  ProgressBar,
  SearchBar,
  Segmented,
  Selector,
  Space,
  Steps,
  Tabs,
  TextArea,
} from "antd-mobile";
import { computeAggregate, parseAggregate } from "../block-data";
import type {
  ExperienceBlockRendererProps,
  FilterFieldOption,
  PageFilterState,
} from "../block-registry";
import { renderCalendarWizardPhoneBlock } from "./PhoneCalendarWizardBlocks";
import { renderScheduleStatusPhoneBlock } from "./PhoneScheduleStatusBlocks";
import { PHONE_PRACTICE_WIZARDS } from "./PhonePracticeWizards";
import { renderConfigurationWizardPhoneBlock } from "./PhoneConfigurationWizardBatch";
import { renderCollaborationContentPhoneBlock } from "./PhoneCollaborationContentBlocks";
import { renderDataGovernancePhoneBlock } from "./PhoneDataGovernanceBlocks";
import { renderHierarchySelectionPhoneBlock } from "./PhoneHierarchySelectionBlocks";
import { renderIndependentStructurePhoneBlock } from "./PhoneIndependentStructureBlocks";
import { renderIndependentStructureBatch2PhoneBlock } from "./PhoneIndependentStructureBlocksBatch2";
import { renderIndependentStructureBatch3PhoneBlock } from "./PhoneIndependentStructureBlocksBatch3";
import { renderIndependentStructureBatch4PhoneBlock } from "./PhoneIndependentStructureBlocksBatch4";
import { renderIndependentStructureBatch5PhoneBlock } from "./PhoneIndependentStructureBlocksBatch5";
import { renderIndependentStructureBatch6PhoneBlock } from "./PhoneIndependentStructureBlocksBatch6";
import { renderIndependentStructureBatch7PhoneBlock } from "./PhoneIndependentStructureBlocksBatch7";
import { renderIndependentStructureBatch8PhoneBlock } from "./PhoneIndependentStructureBlocksBatch8";

const PhoneLazyEchartsChart = React.lazy(() => import("../EchartsChart"));

/**
 * 手机档有没有专属渲染器 —— **从区块定义表派生**（2026-08-08）。
 *
 * 此前这里是一张手写名单，与 block-registry 那边各写各的。两处对不上时
 * 没有任何东西会报错：手机档会静静地拿桌面渲染器顶上，而"顶上了"和"本来
 * 就该这样"在界面上长得一模一样。500 个组件时这种沉默漂移必然发生。
 *
 * 现在唯一真相是 BLOCK_DEFINITIONS 里那条记录的 `phone` 字段。
 */
export function isPhoneExperienceBlock(type: string): boolean {
  return PHONE_BLOCK_TYPES.has(type);
}

function titleOf(props: ExperienceBlockRendererProps) {
  return String(props.block.props?.title ?? "").trim();
}

/**
 * 手机档外壳 —— 与桌面 BlockShell 同一条规矩（2026-08-08）：
 * **标题是这个区块自己的，卡片只是可选的表面**。
 *
 * 此前这四个手机渲染器各自直接套 antd-mobile 的 `<Card title=…>`，于是
 * 标题又一次由壳提供。桌面那边刚改完，手机这条路径**完全没被碰到**——
 * 我当时以为改的是"渲染器"，实际只改了走 BlockShell 的那八个，手机档
 * 走的是另一套代码。用户一眼看出来卡片还在。
 *
 * surface 的判据与桌面逐字一致（props.surface === "plain"），这样同一个
 * 区块在两个档位下的行为不会分叉——分叉了也没人看得出来，因为多一层白底
 * 和本来就该有一层长得一样。
 */
function PhoneShell({
  block,
  title,
  testid,
  children,
}: {
  block: ExperienceBlockRendererProps["block"];
  title?: string;
  testid: string;
  children: React.ReactNode;
}) {
  const plain = block?.props?.surface === "plain";
  if (plain) {
    return (
      <div data-testid={testid}>
        {title && (
          <div
            data-testid={`${testid}-header`}
            style={{ fontSize: 15, fontWeight: 600, padding: "0 0 8px" }}
          >
            {title}
          </div>
        )}
        {children}
      </div>
    );
  }
  return (
    <Card title={title || undefined} data-testid={testid}>
      {children}
    </Card>
  );
}

function MobileEmpty({ description }: { description: string }) {
  return (
    <ErrorBlock
      status="empty"
      title={description}
      style={{ padding: "12px 0", "--image-height": "52px" } as React.CSSProperties}
    />
  );
}

function FilterSelector({
  field,
  value,
  onChange,
}: {
  field: FilterFieldOption;
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [visible, setVisible] = React.useState(false);
  const useSelector = field.options.length <= 6;

  return (
    <Form.Item label={field.label} layout="vertical">
      {useSelector ? (
        <Selector
          columns={2}
          options={field.options}
          value={value ? [value] : []}
          onChange={values => onChange(values[0])}
          showCheckMark={false}
        />
      ) : (
        <>
          <List mode="card" style={{ margin: 0 }}>
            <List.Item
              clickable
              arrowIcon
              onClick={() => setVisible(true)}
              extra={field.options.find(option => option.value === value)?.label ?? "未选择"}
              data-testid={`phone-filter-picker-${field.id}`}
            >
              选择{field.label}
            </List.Item>
          </List>
          <Picker
            columns={[field.options]}
            visible={visible}
            value={value ? [value] : []}
            title={field.label}
            onClose={() => setVisible(false)}
            onConfirm={values => {
              const next = values[0];
              onChange(typeof next === "string" ? next : undefined);
              setVisible(false);
            }}
          />
        </>
      )}
    </Form.Item>
  );
}

function DateRangeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: [string, string] | null;
  onChange: (value: [string, string] | null) => void;
}) {
  const [active, setActive] = React.useState(false);
  const parse = (raw?: string) => (raw ? new Date(`${raw}T00:00:00`) : undefined);
  const format = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const start = value?.[0];
  const end = value?.[1];
  const selectedRange = start && end
    ? ([parse(start)!, parse(end)!] as [Date, Date])
    : null;

  return (
    <Form.Item label={label} layout="vertical">
      <List mode="card" style={{ margin: 0 }}>
        <List.Item
          clickable
          arrowIcon
          extra={start && end ? `${start} - ${end}` : "未选择"}
          onClick={() => setActive(true)}
          data-testid="phone-filter-date-range"
        >
          选择日期范围
        </List.Item>
      </List>
      <CalendarPicker
        visible={active}
        selectionMode="range"
        value={selectedRange}
        title={label}
        onClose={() => setActive(false)}
        onConfirm={range => {
          onChange(range ? [format(range[0]), format(range[1])] : null);
          setActive(false);
        }}
      />
    </Form.Item>
  );
}

function PhoneFilterBar(props: ExperienceBlockRendererProps) {
  const fields = props.filterFieldOptions ?? [];
  const showDateRange =
    props.block.props?.showDateRange === true && Boolean(props.dateRangeField);
  const [draft, setDraft] = React.useState<PageFilterState>(() => ({
    enumFilters: { ...(props.filterState?.enumFilters ?? {}) },
    dateRange: props.filterState?.dateRange ?? null,
  }));

  React.useEffect(() => {
    setDraft({
      enumFilters: { ...(props.filterState?.enumFilters ?? {}) },
      dateRange: props.filterState?.dateRange ?? null,
    });
  }, [props.filterState]);

  if (!showDateRange && fields.length === 0) {
    return (
      <PhoneShell block={props.block} testid="phone-filter-bar-empty">
        <MobileEmpty description="本页无可筛选字段" />
      </PhoneShell>
    );
  }

  const reset = () => {
    const next = {
      enumFilters: Object.fromEntries(fields.map(field => [field.id, undefined])),
      dateRange: null,
    } satisfies PageFilterState;
    setDraft(next);
    props.onFilterChange?.(next);
  };

  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-filter-bar">
      <Form layout="vertical" mode="card" style={{ margin: 0 }}>
        {showDateRange && props.dateRangeField && (
          <DateRangeField
            label={props.dateRangeField.label}
            value={draft.dateRange ?? null}
            onChange={dateRange => setDraft(current => ({ ...current, dateRange }))}
          />
        )}
        {fields.map(field => (
          <FilterSelector
            key={field.id}
            field={field}
            value={draft.enumFilters[field.id]}
            onChange={value =>
              setDraft(current => ({
                ...current,
                enumFilters: { ...current.enumFilters, [field.id]: value },
              }))
            }
          />
        ))}
      </Form>
      <Grid columns={2} gap={8} style={{ marginTop: 12 }}>
        <Grid.Item>
          <Button block fill="outline" onClick={reset}>
            重置
          </Button>
        </Grid.Item>
        <Grid.Item>
          <Button block color="primary" onClick={() => props.onFilterChange?.(draft)}>
            查询
          </Button>
        </Grid.Item>
      </Grid>
    </PhoneShell>
  );
}

function PhoneMetricGrid(props: ExperienceBlockRendererProps) {
  const entityRef = String(props.block.binding?.entityRef ?? "").trim();
  const rows = entityRef ? props.entityRows?.[entityRef] : undefined;
  const aggregate = parseAggregate(props.block.binding?.aggregate);
  const value = rows ? computeAggregate(rows, aggregate) : null;
  const label =
    aggregate.kind === "count"
      ? "记录数"
      : `${aggregate.kind === "sum" ? "合计" : "平均"} · ${aggregate.fieldId}`;
  const displayValue =
    value === null ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(1);

  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-metric-grid">
      {rows ? (
        <List mode="card" style={{ margin: 0 }}>
          <List.Item title={label} extra={displayValue} />
        </List>
      ) : (
        <MobileEmpty description="指标未绑定到有效实体" />
      )}
    </PhoneShell>
  );
}

function PhoneWorkflowTimeline(props: ExperienceBlockRendererProps) {
  const chainRef = String(props.block.props?.chainRef ?? "").trim();
  const chain = chainRef
    ? props.workflow?.chains?.find(item => item.id === chainRef || item.name === chainRef)
    : undefined;
  const nodes = (chainRef ? chain?.nodes : props.workflow?.nodes) ?? [];
  const transitions = (chainRef ? chain?.transitions : props.workflow?.transitions) ?? [];
  const conditionByFrom = new Map(
    transitions.filter(item => item.condition).map(item => [item.from, item.condition])
  );

  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-workflow-timeline">
      {nodes.length > 0 ? (
        <Steps
          direction="vertical"
          current={-1}
        >
          {nodes.map(node => (
            <Steps.Step
              key={node.id}
              title={node.name || node.id}
              description={[node.assigneeRole, conditionByFrom.get(node.id)]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </Steps>
      ) : (
        <MobileEmpty description="暂无可展示的流程节点" />
      )}
    </PhoneShell>
  );
}

function PhoneQuickActionPanel(props: ExperienceBlockRendererProps) {
  const actions = props.pageActions ?? [];
  // 与桌面档同一条纪律（2026-08-07）：一个候选动作都没有时整块不渲染。
  // 手机档屏幕更窄，一张只写着"暂无可用操作"的卡代价比桌面还大。
  // 理由与边界见 block-registry.tsx 的 QuickActionPanelRenderer。
  //
  // 两档要一起改：只改桌面会造成"同一个应用，手机上多出一张空卡"这种
  // 档位不对称——这类不对称在这个项目里踩过（见任务 17 那轮）。
  if (actions.length === 0) return null;
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-quick-action-panel">
      {actions.length > 0 ? (
        <Space direction="vertical" block style={{ "--gap": "8px" } as React.CSSProperties}>
          {actions.map(action => (
            <Button
              key={action.id}
              block
              fill="outline"
              disabled={!action.permitted}
              onClick={() => props.onAction?.(action.id)}
            >
              {action.label}
            </Button>
          ))}
        </Space>
      ) : (
        <MobileEmpty description="暂无可用操作" />
      )}
    </PhoneShell>
  );
}

function phoneField(props: ExperienceBlockRendererProps, key: string): string | undefined {
  const value = props.block.binding?.[key];
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function phoneFieldList(props: ExperienceBlockRendererProps, key: string): string[] {
  const value = props.block.binding?.[key];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function phoneRows(props: ExperienceBlockRendererProps) {
  const entityRef = String(props.block.binding?.entityRef ?? "").trim();
  if (!entityRef || !props.entityRows || !(entityRef in props.entityRows)) return null;
  return { entityRef, rows: props.entityRows[entityRef] ?? [] };
}

function formatPhoneSize(value: unknown) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function PhoneAttachmentPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const nameRef = phoneField(props, "fileNameFieldRef");
  const sizeRef = phoneField(props, "fileSizeFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const timeRef = phoneField(props, "uploadedAtFieldRef");
  if (!bound || !nameRef) {
    return (
      <PhoneShell block={props.block} title={titleOf(props)} testid="phone-attachment-panel">
        <MobileEmpty description="附件面板尚未绑定有效实体和文件名字段" />
      </PhoneShell>
    );
  }
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-attachment-panel">
      {bound.rows.length === 0 ? (
        <MobileEmpty description={String(props.block.props?.emptyText ?? "还没有附件")} />
      ) : (
        <List mode="card" style={{ margin: 0 }}>
          {bound.rows.map(row => {
            const status = statusRef ? String(row.values?.[statusRef] ?? "").trim() : "";
            const size = sizeRef ? formatPhoneSize(row.values?.[sizeRef]) : "";
            const time = timeRef ? String(row.values?.[timeRef] ?? "").trim() : "";
            const pending = status.includes("上传") || status.includes("等待");
            return (
              <List.Item
                key={row.id}
                clickable
                arrowIcon
                extra={size}
                description={[status, time].filter(Boolean).join(" · ")}
                onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}
              >
                {String(row.values?.[nameRef] ?? "未命名附件")}
                {pending && <ProgressBar percent={25} style={{ marginTop: 6 }} />}
              </List.Item>
            );
          })}
        </List>
      )}
      {props.block.props?.allowUpload === true && (
        <Button
          block
          color="primary"
          fill="outline"
          style={{ marginTop: 10 }}
          onClick={() => props.onAction?.("createRequest", { entityRef: bound.entityRef })}
        >
          {String(props.block.props?.uploadText ?? "添加附件")}
        </Button>
      )}
    </PhoneShell>
  );
}

function PhoneCommentThread(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const authorRef = phoneField(props, "authorFieldRef");
  const contentRef = phoneField(props, "contentFieldRef");
  const timeRef = phoneField(props, "timeFieldRef");
  const avatarRef = phoneField(props, "avatarFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const parentRef = phoneField(props, "parentFieldRef");
  const [draft, setDraft] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(Math.max(1, Number(props.block.props?.pageSize ?? 5) || 5));
  if (!bound || !authorRef || !contentRef || !timeRef) {
    return (
      <PhoneShell block={props.block} title={titleOf(props)} testid="phone-comment-thread">
        <MobileEmpty description="讨论区尚未绑定作者、内容和时间字段" />
      </PhoneShell>
    );
  }
  const roots = bound.rows.filter(row => !parentRef || !String(row.values?.[parentRef] ?? "").trim());
  const replies = (id: string) => parentRef
    ? bound.rows.filter(row => String(row.values?.[parentRef] ?? "").trim() === id)
    : [];
  const renderRow = (row: (typeof bound.rows)[number], nested = false) => (
    <List.Item
      key={row.id}
      prefix={
        avatarRef && row.values?.[avatarRef] ? (
          <Image src={String(row.values[avatarRef])} width={32} height={32} fit="cover" style={{ borderRadius: 16 }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: 16, background: "#eef3ff", color: "#1677ff", display: "grid", placeItems: "center" }}>
            {String(row.values?.[authorRef] ?? "?").slice(0, 1)}
          </div>
        )
      }
      description={
        <div>
          <div style={{ color: "#999", fontSize: 12 }}>{String(row.values?.[timeRef] ?? "")}</div>
          <div style={{ marginTop: 4, color: "#333", whiteSpace: "normal" }}>{String(row.values?.[contentRef] ?? "")}</div>
          {statusRef && row.values?.[statusRef] != null && <div style={{ marginTop: 3, color: "#fa8c16", fontSize: 12 }}>{String(row.values[statusRef])}</div>}
          {!nested && props.block.props?.allowReply !== false && (
            <Button size="mini" fill="none" onClick={() => setReplyTo(replyTo === row.id ? null : row.id)}>
              {replyTo === row.id ? "取消回复" : "回复"}
            </Button>
          )}
        </div>
      }
      style={nested ? { paddingLeft: 32, background: "#fafafa" } : undefined}
    >
      {String(row.values?.[authorRef] ?? "未知用户")}
    </List.Item>
  );
  const submit = () => {
    const content = draft.trim();
    if (!content) return;
    props.onAction?.("submitRequest", {
      entityRef: bound.entityRef,
      values: { [contentRef]: content, ...(parentRef && replyTo ? { [parentRef]: replyTo } : {}) },
    });
    setDraft("");
    setReplyTo(null);
  };
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-comment-thread">
      {roots.length === 0 ? <MobileEmpty description="还没有讨论内容" /> : (
        <List mode="card" style={{ margin: 0 }}>
          {roots.slice(0, visible).flatMap(row => [renderRow(row), ...replies(row.id).map(reply => renderRow(reply, true))])}
        </List>
      )}
      {visible < roots.length && <Button block fill="none" onClick={() => setVisible(current => current + 5)}>加载更多</Button>}
      <TextArea
        value={draft}
        autoSize={{ minRows: 2, maxRows: 5 }}
        placeholder={replyTo ? "写下回复" : String(props.block.props?.composerPlaceholder ?? "写下评论")}
        onChange={setDraft}
        style={{ marginTop: 10, padding: 10, background: "#f7f8fa", borderRadius: 6 }}
      />
      <Button block color="primary" disabled={!draft.trim()} onClick={submit} style={{ marginTop: 8 }}>
        {String(props.block.props?.submitText ?? "发布")}
      </Button>
    </PhoneShell>
  );
}

function PhoneRecordPicker(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const descRef = phoneField(props, "descFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const [keyword, setKeyword] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const multiple = props.block.props?.selectionMode !== "single";
  const limit = Math.max(1, Number(props.block.props?.maxSelected ?? 100) || 100);
  if (!bound || !titleRef) {
    return (
      <PhoneShell block={props.block} title={titleOf(props)} testid="phone-record-picker">
        <MobileEmpty description="记录选择器尚未绑定有效实体和标题字段" />
      </PhoneShell>
    );
  }
  const shown = bound.rows.filter(row =>
    [row.values?.[titleRef], descRef ? row.values?.[descRef] : ""]
      .some(value => String(value ?? "").toLowerCase().includes(keyword.trim().toLowerCase()))
  );
  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? multiple ? [...selected.filter(value => value !== id), id].slice(-limit) : [id]
      : selected.filter(value => value !== id);
    setSelected(next);
    props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowIds: next });
  };
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-record-picker">
      {props.block.props?.searchable !== false && <SearchBar value={keyword} onChange={setKeyword} placeholder="搜索可选记录" style={{ marginBottom: 8 }} />}
      {shown.length === 0 ? <MobileEmpty description={keyword ? "没有匹配的记录" : "暂无可选记录"} /> : (
        <List mode="card" style={{ margin: 0 }}>
          {shown.map(row => {
            const checked = selected.includes(row.id);
            return (
              <List.Item
                key={row.id}
                prefix={
                  <span onClick={event => event.stopPropagation()}>
                    <Checkbox checked={checked} onChange={value => toggle(row.id, value)} />
                  </span>
                }
                extra={statusRef ? String(row.values?.[statusRef] ?? "") : undefined}
                description={descRef ? String(row.values?.[descRef] ?? "") : undefined}
                onClick={() => toggle(row.id, !checked)}
              >
                {String(row.values?.[titleRef] ?? "未命名记录")}
              </List.Item>
            );
          })}
        </List>
      )}
      <Grid columns={2} gap={8} style={{ marginTop: 10 }}>
        <Grid.Item><Button block fill="outline" disabled={selected.length === 0} onClick={() => setSelected([])}>清空</Button></Grid.Item>
        <Grid.Item>
          <Button block color="primary" disabled={selected.length === 0} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowIds: selected })}>
            {String(props.block.props?.confirmText ?? `确认选择 (${selected.length})`)}
          </Button>
        </Grid.Item>
      </Grid>
    </PhoneShell>
  );
}

function PhoneKanbanBoard(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const descRef = phoneField(props, "descFieldRef");
  const assigneeRef = phoneField(props, "assigneeFieldRef");
  const [active, setActive] = React.useState("");
  const [moving, setMoving] = React.useState<string | null>(null);
  if (!bound || !titleRef || !statusRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-kanban-board"><MobileEmpty description="看板尚未绑定标题和状态字段" /></PhoneShell>;
  }
  const declared = props.enumOptionsOf?.(bound.entityRef, statusRef) ?? [];
  const raw = Array.from(new Set(bound.rows.map(row => String(row.values?.[statusRef] ?? "").trim()).filter(Boolean)));
  const columns = declared.length > 0 ? declared.map(option => ({ label: option.label, value: option.id })) : raw.map(value => ({ label: value, value }));
  const current = columns.some(column => column.value === active) ? active : columns[0]?.value ?? "";
  const rows = bound.rows.filter(row => String(row.values?.[statusRef] ?? "") === current);
  const move = (status: string) => {
    if (!moving) return;
    props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: moving, values: { [statusRef]: status } });
    setMoving(null);
  };
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-kanban-board">
      {columns.length === 0 ? <MobileEmpty description="状态字段还没有可用分组" /> : (
        <>
          <Segmented block value={current} options={columns} onChange={value => setActive(String(value))} />
          {rows.length === 0 ? <MobileEmpty description="这一列还没有记录" /> : (
            <List mode="card" style={{ margin: "10px 0 0" }}>
              {rows.map(row => (
                <List.Item
                  key={row.id}
                  clickable
                  arrowIcon
                  description={[descRef ? row.values?.[descRef] : "", assigneeRef ? row.values?.[assigneeRef] : ""].filter(Boolean).join(" · ")}
                  extra={props.block.props?.movable !== false ? <Button size="mini" fill="outline" onClick={event => { event.stopPropagation(); setMoving(row.id); }}>移动</Button> : undefined}
                  onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}
                >
                  {String(row.values?.[titleRef] ?? "未命名记录")}
                </List.Item>
              ))}
            </List>
          )}
          <Picker
            columns={[columns]}
            visible={Boolean(moving)}
            value={[current]}
            title="移动到状态"
            onClose={() => setMoving(null)}
            onConfirm={values => move(String(values[0] ?? current))}
          />
        </>
      )}
    </PhoneShell>
  );
}

function PhoneScheduleCalendar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const startRef = phoneField(props, "startFieldRef");
  const endRef = phoneField(props, "endFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const initial = new Date(String(props.block.props?.initialDate ?? ""));
  const [selected, setSelected] = React.useState<Date>(Number.isNaN(initial.getTime()) ? new Date() : initial);
  const [pickerVisible, setPickerVisible] = React.useState(false);
  if (!bound || !titleRef || !startRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-schedule-calendar"><MobileEmpty description="日历尚未绑定标题和开始时间字段" /></PhoneShell>;
  }
  const key = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`;
  const events = bound.rows.filter(row => String(row.values?.[startRef] ?? "").slice(0, 10) === key);
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-schedule-calendar">
      <List mode="card" style={{ margin: 0 }}>
        <List.Item clickable arrowIcon extra={key} onClick={() => setPickerVisible(true)}>选择日期</List.Item>
      </List>
      <CalendarPicker
        selectionMode="single"
        visible={pickerVisible}
        value={selected}
        onClose={() => setPickerVisible(false)}
        onConfirm={value => { if (value) setSelected(value); setPickerVisible(false); }}
        weekStartsOn="Monday"
        renderBottom={date => bound.rows.some(row => String(row.values?.[startRef] ?? "").slice(0, 10) === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`) ? <Badge content={Badge.dot} /> : null}
      />
      <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600 }}>{selected.getMonth() + 1} 月 {selected.getDate()} 日</div>
      {events.length === 0 ? <MobileEmpty description="这一天还没有日程" /> : (
        <List mode="card" style={{ margin: "8px 0 0" }}>
          {events.map(row => (
            <List.Item key={row.id} clickable arrowIcon description={(() => { const start = String(row.values?.[startRef] ?? ""); const end = endRef ? String(row.values?.[endRef] ?? "") : ""; const range = end && end !== start ? `${start} - ${end}` : start; const status = statusRef ? String(row.values?.[statusRef] ?? "") : ""; return [range, status].filter(Boolean).join(" · "); })()} onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>
              {String(row.values?.[titleRef] ?? "未命名日程")}
            </List.Item>
          ))}
        </List>
      )}
      {props.block.props?.allowCreate === true && <Button block color="primary" fill="outline" style={{ marginTop: 10 }} onClick={() => props.onAction?.("createRequest", { entityRef: bound.entityRef, date: key })}>新建日程</Button>}
    </PhoneShell>
  );
}

function PhoneNotificationInbox(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const contentRef = phoneField(props, "contentFieldRef");
  const timeRef = phoneField(props, "timeFieldRef");
  const categoryRef = phoneField(props, "categoryFieldRef");
  const readRef = phoneField(props, "readFieldRef");
  const [category, setCategory] = React.useState("全部");
  const [readIds, setReadIds] = React.useState<string[]>([]);
  const pageSize = Math.max(1, Number(props.block.props?.pageSize ?? 5) || 5);
  const [visible, setVisible] = React.useState(pageSize);
  if (!bound || !titleRef || !contentRef || !timeRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-notification-inbox"><MobileEmpty description="通知中心尚未绑定标题、内容和时间字段" /></PhoneShell>;
  }
  const isRead = (row: (typeof bound.rows)[number]) => readIds.includes(row.id) || (readRef ? [true, 1, "1", "true", "read", "已读"].includes(row.values?.[readRef] as never) : false);
  const categories = categoryRef ? Array.from(new Set(bound.rows.map(row => String(row.values?.[categoryRef] ?? "").trim()).filter(Boolean))) : [];
  const shown = (category === "全部" ? bound.rows : bound.rows.filter(row => String(row.values?.[categoryRef!] ?? "") === category)).slice(0, visible);
  const unread = bound.rows.filter(row => !isRead(row)).length;
  const mark = (row: (typeof bound.rows)[number]) => {
    if (!isRead(row)) {
      setReadIds(current => [...current, row.id]);
      if (readRef) props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, values: { [readRef]: "read" } });
    }
    props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id });
  };
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-notification-inbox">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <Button size="mini" fill="none" disabled={unread === 0} onClick={() => { const ids = bound.rows.filter(row => !isRead(row)).map(row => row.id); setReadIds(current => Array.from(new Set([...current, ...ids]))); props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowIds: ids, operation: "markRead" }); }}>全部已读</Button>
      </div>
      <Segmented block value={category} options={["全部", ...categories]} onChange={value => { setCategory(String(value)); setVisible(pageSize); }} style={{ marginBottom: 8 }} />
      {shown.length === 0 ? <MobileEmpty description="这个分类还没有通知" /> : (
        <List mode="card" style={{ margin: 0 }}>
          {shown.map(row => (
            <List.Item key={row.id} clickable arrowIcon prefix={!isRead(row) ? <Badge content={Badge.dot}><span style={{ width: 8 }} /></Badge> : <span style={{ width: 8 }} />} description={<><div style={{ whiteSpace: "normal", opacity: isRead(row) ? 0.55 : 1 }}>{String(row.values?.[contentRef] ?? "")}</div><div style={{ marginTop: 3, color: "#999", fontSize: 12 }}>{String(row.values?.[timeRef] ?? "")}</div></>} onClick={() => mark(row)}>
              <span style={{ opacity: isRead(row) ? 0.55 : 1 }}>{String(row.values?.[titleRef] ?? "未命名通知")}</span>
            </List.Item>
          ))}
        </List>
      )}
      {visible < (category === "全部" ? bound.rows.length : bound.rows.filter(row => String(row.values?.[categoryRef!] ?? "") === category).length) && <Button block fill="none" onClick={() => setVisible(current => current + pageSize)}>查看更多</Button>}
    </PhoneShell>
  );
}

type PhoneTreeNode = { id: string; label: string; desc: string; children: PhoneTreeNode[] };

function PhoneTreeNavigator(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const labelRef = phoneField(props, "labelFieldRef");
  const parentRef = phoneField(props, "parentFieldRef");
  const descRef = phoneField(props, "descFieldRef");
  const [keyword, setKeyword] = React.useState("");
  if (!bound || !labelRef || !parentRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-tree-navigator"><MobileEmpty description="层级导航尚未绑定名称和父节点字段" /></PhoneShell>;
  }
  const nodes = new Map<string, PhoneTreeNode>();
  for (const row of bound.rows) nodes.set(row.id, { id: row.id, label: String(row.values?.[labelRef] ?? "未命名节点"), desc: descRef ? String(row.values?.[descRef] ?? "") : "", children: [] });
  const roots: PhoneTreeNode[] = [];
  for (const row of bound.rows) {
    const node = nodes.get(row.id)!;
    const parent = nodes.get(String(row.values?.[parentRef] ?? ""));
    if (parent && parent.id !== row.id) parent.children.push(node); else roots.push(node);
  }
  const search = keyword.trim().toLowerCase();
  const filter = (items: PhoneTreeNode[]): PhoneTreeNode[] => items.flatMap(node => {
    const children = filter(node.children);
    return !search || node.label.toLowerCase().includes(search) || children.length ? [{ ...node, children }] : [];
  });
  const shown = filter(roots);
  const select = (id: string) => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: id });
  const render = (items: PhoneTreeNode[], depth = 0): React.ReactNode => (
    <Collapse accordion={false} defaultActiveKey={search ? items.map(item => item.id) : []}>
      {items.map(node => node.children.length > 0 ? (
        <Collapse.Panel key={node.id} title={<span>{node.label}{node.desc && <span style={{ marginLeft: 6, color: "#999", fontSize: 12 }}>{node.desc}</span>}</span>}>
          <Button size="mini" fill="none" onClick={() => select(node.id)}>查看当前节点</Button>
          <div style={{ marginLeft: Math.min(depth + 1, 2) * 8, marginTop: 6 }}>{render(node.children, depth + 1)}</div>
        </Collapse.Panel>
      ) : (
        <Collapse.Panel key={node.id} arrowIcon={false} title={<span onClick={() => select(node.id)}>{node.label}{node.desc && <span style={{ marginLeft: 6, color: "#999", fontSize: 12 }}>{node.desc}</span>}</span>} />
      ))}
    </Collapse>
  );
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-tree-navigator">
      {props.block.props?.searchable !== false && <SearchBar value={keyword} onChange={setKeyword} placeholder="搜索层级节点" style={{ marginBottom: 8 }} />}
      {shown.length === 0 ? <MobileEmpty description={search ? "没有匹配的层级节点" : "还没有层级数据"} /> : render(shown)}
    </PhoneShell>
  );
}

function PhoneApprovalQueue(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const applicantRef = phoneField(props, "applicantFieldRef");
  const timeRef = phoneField(props, "timeFieldRef");
  const summaryRef = phoneField(props, "summaryFieldRef");
  const pendingValue = String(props.block.props?.pendingValue ?? "pending");
  const approvedValue = String(props.block.props?.approvedValue ?? "approved");
  const rejectedValue = String(props.block.props?.rejectedValue ?? "rejected");
  const [tab, setTab] = React.useState("pending");
  const [decisions, setDecisions] = React.useState<Record<string, string>>({});
  const [rejecting, setRejecting] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  if (!bound || !titleRef || !statusRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-approval-queue"><MobileEmpty description="审批队列尚未绑定标题和状态字段" /></PhoneShell>;
  }
  const statusOf = (row: (typeof bound.rows)[number]) => decisions[row.id] ?? String(row.values?.[statusRef] ?? "");
  const pending = bound.rows.filter(row => statusOf(row) === pendingValue);
  const completed = bound.rows.filter(row => statusOf(row) !== pendingValue);
  const shown = tab === "pending" ? pending : completed;
  const submit = (rowId: string, outcome: string, comment = "") => {
    setDecisions(current => ({ ...current, [rowId]: outcome }));
    props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId, outcome, comment, values: { [statusRef]: outcome } });
  };
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-approval-queue">
      <Segmented block value={tab} options={[{ label: `待处理 ${pending.length}`, value: "pending" }, { label: `已处理 ${completed.length}`, value: "completed" }]} onChange={value => setTab(String(value))} />
      {shown.length === 0 ? <MobileEmpty description={tab === "pending" ? "当前没有待审批任务" : "还没有已处理任务"} /> : (
        <List mode="card" style={{ margin: "8px 0 0" }}>
          {shown.map(row => {
            const status = statusOf(row);
            return <List.Item key={row.id} description={[applicantRef ? row.values?.[applicantRef] : "", timeRef ? row.values?.[timeRef] : "", summaryRef ? row.values?.[summaryRef] : ""].filter(Boolean).map(String).join(" · ")} onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>
              <div>{String(row.values?.[titleRef] ?? "未命名审批")}</div>
              {status === pendingValue ? <Grid columns={2} gap={8} style={{ marginTop: 8 }}><Grid.Item><Button block size="small" color="danger" fill="outline" onClick={event => { event.stopPropagation(); setRejecting(row.id); setReason(""); }}>驳回</Button></Grid.Item><Grid.Item><Button block size="small" color="primary" onClick={event => { event.stopPropagation(); submit(row.id, approvedValue); }}>通过</Button></Grid.Item></Grid> : <div style={{ marginTop: 5, color: status === approvedValue ? "#00b578" : "#ff3141", fontSize: 12 }}>{status === approvedValue ? "已通过" : "已驳回"}</div>}
            </List.Item>;
          })}
        </List>
      )}
      <Popup visible={Boolean(rejecting)} position="bottom" closeOnMaskClick onMaskClick={() => setRejecting(null)} bodyStyle={{ padding: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>填写驳回原因</div>
        <TextArea value={reason} onChange={setReason} placeholder="请输入驳回原因" autoSize={{ minRows: 3, maxRows: 6 }} style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }} />
        <Grid columns={2} gap={8} style={{ marginTop: 12 }}><Grid.Item><Button block fill="outline" onClick={() => setRejecting(null)}>取消</Button></Grid.Item><Grid.Item><Button block color="danger" disabled={!reason.trim()} onClick={() => { if (rejecting && reason.trim()) submit(rejecting, rejectedValue, reason.trim()); setRejecting(null); }}>确认驳回</Button></Grid.Item></Grid>
      </Popup>
    </PhoneShell>
  );
}

function PhoneAuditTrail(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const actorRef = phoneField(props, "actorFieldRef");
  const actionRef = phoneField(props, "actionFieldRef");
  const timeRef = phoneField(props, "timeFieldRef");
  const resultRef = phoneField(props, "resultFieldRef");
  const fieldNameRef = phoneField(props, "fieldNameFieldRef");
  const beforeRef = phoneField(props, "beforeFieldRef");
  const afterRef = phoneField(props, "afterFieldRef");
  const pageSize = Math.max(1, Number(props.block.props?.pageSize ?? 5) || 5);
  const [visible, setVisible] = React.useState(pageSize);
  if (!bound || !actorRef || !actionRef || !timeRef) {
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-audit-trail"><MobileEmpty description="审计记录尚未绑定操作人、动作和时间字段" /></PhoneShell>;
  }
  const rows = bound.rows.slice(0, visible);
  return (
    <PhoneShell block={props.block} title={titleOf(props)} testid="phone-audit-trail">
      {rows.length === 0 ? <MobileEmpty description="还没有审计记录" /> : (
        <Collapse accordion={false} onChange={keys => keys[0] && props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: keys[0] })}>
          {rows.map(row => <Collapse.Panel key={row.id} title={<div><div>{String(row.values?.[actorRef] ?? "未知用户")} · {String(row.values?.[actionRef] ?? "执行操作")}</div><div style={{ color: "#999", fontSize: 12 }}>{String(row.values?.[timeRef] ?? "")}{resultRef && row.values?.[resultRef] != null ? ` · ${String(row.values[resultRef])}` : ""}</div></div>}>
            {fieldNameRef && row.values?.[fieldNameRef] != null && <div style={{ marginBottom: 8 }}>变更字段：{String(row.values[fieldNameRef])}</div>}
            <div style={{ color: "#999", fontSize: 12 }}>变更前</div><div style={{ padding: 8, background: "#f5f5f5", borderRadius: 4, whiteSpace: "pre-wrap" }}>{beforeRef ? String(row.values?.[beforeRef] ?? "空") : "未记录"}</div>
            <div style={{ marginTop: 8, color: "#999", fontSize: 12 }}>变更后</div><div style={{ padding: 8, background: "#f5f5f5", borderRadius: 4, whiteSpace: "pre-wrap" }}>{afterRef ? String(row.values?.[afterRef] ?? "空") : "未记录"}</div>
          </Collapse.Panel>)}
        </Collapse>
      )}
      {visible < bound.rows.length && <Button block fill="none" onClick={() => setVisible(current => current + pageSize)}>查看更多</Button>}
    </PhoneShell>
  );
}

type PhoneImportPhase = "select" | "mapping" | "validated" | "submitted";

function PhoneDataImportWizard(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const sourceRef = phoneField(props, "sourceFieldRef");
  const targetRef = phoneField(props, "targetFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const issueRef = phoneField(props, "issueFieldRef");
  const initial = ["mapping", "validated", "submitted"].includes(String(props.block.props?.initialPhase)) ? String(props.block.props?.initialPhase) as PhoneImportPhase : "select";
  const [phase, setPhase] = React.useState<PhoneImportPhase>(initial);
  const [fileName, setFileName] = React.useState(String(props.block.props?.initialFileName ?? ""));
  if (!bound || !sourceRef || !targetRef || !statusRef) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-data-import-wizard"><MobileEmpty description="导入向导尚未绑定映射和校验字段" /></PhoneShell>;
  const invalid = bound.rows.filter(row => ["invalid", "error", "失败"].includes(String(row.values?.[statusRef] ?? "").toLowerCase()));
  const step = phase === "select" ? 0 : phase === "mapping" ? 1 : phase === "validated" ? 2 : 3;
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-data-import-wizard">
    <Steps current={step} style={{ marginBottom: 12 }}><Steps.Step title="文件" /><Steps.Step title="映射" /><Steps.Step title="校验" /><Steps.Step title="提交" /></Steps>
    {phase === "select" && <div style={{ padding: 16, textAlign: "center", background: "#f5f5f5", borderRadius: 6 }}><div style={{ marginBottom: 10, color: "#666" }}>选择 CSV、XLS 或 XLSX 文件</div><Button color="primary" onClick={() => document.getElementById(`import-${props.block.id}`)?.click()}>选择文件</Button><input id={`import-${props.block.id}`} hidden type="file" accept=".csv,.xls,.xlsx" onChange={event => { const file = event.target.files?.[0]; if (file) { setFileName(file.name); setPhase("mapping"); } }} /></div>}
    {phase !== "select" && phase !== "submitted" && <><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6, marginBottom: 8 }}><div>{fileName || "已选择导入文件"}</div><div style={{ color: invalid.length ? "#ff3141" : "#999", fontSize: 12 }}>共 {bound.rows.length} 个字段，{invalid.length} 个异常</div></div><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => { const status = String(row.values?.[statusRef] ?? "pending"); const failed = ["invalid", "error", "失败"].includes(status.toLowerCase()); return <List.Item key={row.id} description={<span style={{ color: failed ? "#ff3141" : "#999" }}>{failed && issueRef ? String(row.values?.[issueRef] ?? "映射异常") : status === "valid" || status === "通过" ? "校验通过" : "待校验"}</span>}>{String(row.values?.[sourceRef] ?? "未命名字段")} → {String(row.values?.[targetRef] ?? "未映射")}</List.Item>; })}</List></>}
    {phase === "submitted" && <div style={{ padding: 24, textAlign: "center" }}><div style={{ fontSize: 17, fontWeight: 600 }}>导入任务已提交</div><div style={{ color: "#999", marginTop: 6 }}>处理结果将通过任务状态回传</div></div>}
    <Grid columns={2} gap={8} style={{ marginTop: 12 }}>{phase !== "select" && phase !== "submitted" && <Grid.Item><Button block fill="outline" onClick={() => setPhase(phase === "validated" ? "mapping" : "select")}>上一步</Button></Grid.Item>}{phase === "mapping" && <Grid.Item><Button block color="primary" onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "validateImport", fileName }); setPhase("validated"); }}>校验数据</Button></Grid.Item>}{phase === "validated" && <Grid.Item><Button block color="primary" disabled={invalid.length > 0} onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "startImport", fileName }); setPhase("submitted"); }}>开始导入</Button></Grid.Item>}</Grid>
  </PhoneShell>;
}

function PhoneAsyncTaskMonitor(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const titleRef = phoneField(props, "titleFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const currentRef = phoneField(props, "progressCurrentFieldRef");
  const totalRef = phoneField(props, "progressTotalFieldRef");
  const errorRef = phoneField(props, "errorFieldRef");
  const resultRef = phoneField(props, "resultFieldRef");
  if (!bound || !titleRef || !statusRef) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-async-task-monitor"><MobileEmpty description="任务监控尚未绑定标题和状态字段" /></PhoneShell>;
  const pending = String(props.block.props?.pendingValue ?? "pending");
  const running = String(props.block.props?.runningValue ?? "running");
  const succeeded = String(props.block.props?.succeededValue ?? "succeeded");
  const failed = String(props.block.props?.failedValue ?? "failed");
  const canceled = String(props.block.props?.canceledValue ?? "canceled");
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-async-task-monitor">{bound.rows.length === 0 ? <MobileEmpty description="当前没有后台任务" /> : <List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => { const status = String(row.values?.[statusRef] ?? pending); const current = currentRef ? Number(row.values?.[currentRef] ?? 0) : 0; const total = totalRef ? Number(row.values?.[totalRef] ?? 0) : 0; const percent = total > 0 ? Math.min(100, current / total * 100) : 0; const active = status === pending || status === running; const statusLabel = status === failed ? "失败" : status === succeeded ? "已完成" : status === canceled ? "已取消" : status === running ? "执行中" : "等待中"; return <List.Item key={row.id} description={<div>{active && total > 0 && <><ProgressBar percent={percent} style={{ marginTop: 6 }} /><div style={{ marginTop: 3, color: "#999" }}>{current}/{total}</div></>}{status === failed && errorRef && <div style={{ color: "#ff3141" }}>{String(row.values?.[errorRef] ?? "任务执行失败")}</div>}<Space style={{ marginTop: 8 }}>{active && props.block.props?.cancelable !== false && <Button size="mini" color="danger" fill="outline" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "cancelTask" })}>取消</Button>}{status === failed && <Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "retryTask" })}>重试</Button>}{status === succeeded && resultRef && <Button size="mini" fill="none" onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id, result: row.values?.[resultRef] })}>查看结果</Button>}</Space></div>}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{String(row.values?.[titleRef] ?? "未命名任务")}</span><span style={{ color: status === failed ? "#ff3141" : status === succeeded ? "#00b578" : status === canceled ? "#999" : "#1677ff", fontSize: 12 }}>{statusLabel}</span></div></List.Item>; })}</List>}</PhoneShell>;
}

const PHONE_PERMISSION_KEYS = ["viewFieldRef", "createFieldRef", "editFieldRef", "deleteFieldRef"] as const;
const PHONE_PERMISSION_LABELS = ["查看", "新建", "编辑", "删除"] as const;

function PhonePermissionMatrix(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const resourceRef = phoneField(props, "resourceFieldRef");
  const refs = PHONE_PERMISSION_KEYS.map(key => phoneField(props, key));
  const [changes, setChanges] = React.useState<Record<string, Record<string, string>>>({});
  if (!bound || !resourceRef || !refs[0]) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-permission-matrix"><MobileEmpty description="权限矩阵尚未绑定资源和查看权限字段" /></PhoneShell>;
  const valueOf = (row: (typeof bound.rows)[number], ref: string) => changes[row.id]?.[ref] ?? String(row.values?.[ref] ?? "inherit");
  const setValue = (rowId: string, ref: string, value: string) => setChanges(current => ({ ...current, [rowId]: { ...current[rowId], [ref]: value } }));
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-permission-matrix">{bound.rows.length === 0 ? <MobileEmpty description="还没有可配置的资源" /> : <Collapse accordion defaultActiveKey={bound.rows[0]?.id}>{bound.rows.map(row => <Collapse.Panel key={row.id} title={String(row.values?.[resourceRef] ?? "未命名资源")}><List style={{ margin: 0 }}>{refs.flatMap((ref, index) => !ref ? [] : [<List.Item key={ref} description={<Selector columns={3} value={[valueOf(row, ref)]} options={[{ label: "继承", value: "inherit" }, { label: "允许", value: "allow" }, { label: "拒绝", value: "deny" }]} onChange={values => values[0] && setValue(row.id, ref, String(values[0]))} />}>{PHONE_PERMISSION_LABELS[index]}</List.Item>])}</List></Collapse.Panel>)}</Collapse>}<Button block color="primary" disabled={Object.keys(changes).length === 0} style={{ marginTop: 12 }} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "savePermissions", changes: bound.rows.map(row => ({ rowId: row.id, permissions: Object.fromEntries(refs.flatMap(ref => ref ? [[ref, valueOf(row, ref)]] : [])) })) })}>保存权限</Button></PhoneShell>;
}

function PhoneDataExportPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  if (!bound) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-data-export-panel"><MobileEmpty description="导出面板尚未绑定有效实体" /></PhoneShell>;
  const declared = phoneFieldList(props, "fieldRefs");
  const fields = declared.length > 0 ? declared : Array.from(new Set(bound.rows.flatMap(row => Object.keys(row.values ?? {})))).slice(0, 8);
  const selectedRowIds = props.selection?.rowIds?.[bound.entityRef] ?? [];
  const [scope, setScope] = React.useState(selectedRowIds.length > 0 ? "selected" : "all");
  const [selectedFields, setSelectedFields] = React.useState<string[]>(fields);
  const [format, setFormat] = React.useState("xlsx");
  const [submitted, setSubmitted] = React.useState(false);
  const limit = Math.max(1, Number(props.block.props?.maxRows ?? 2000) || 2000);
  const count = scope === "selected" ? selectedRowIds.length : Math.min(bound.rows.length, limit);
  const labelOf = (field: string) => props.fieldLabelOf?.(bound.entityRef, field) ?? field;
  if (fields.length === 0) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-data-export-panel"><MobileEmpty description="当前实体没有可导出的字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-data-export-panel">{submitted ? <div style={{ padding: 24, textAlign: "center" }}><div style={{ fontSize: 17, fontWeight: 600 }}>导出任务已提交</div><div style={{ color: "#999", margin: "6px 0 12px" }}>文件生成后由宿主提供下载结果</div><Button size="small" onClick={() => setSubmitted(false)}>继续导出</Button></div> : <Space direction="vertical" block style={{ "--gap": "12px" }}>
    <div style={{ padding: 10, background: "#fff7e6", borderRadius: 6 }}><div>单次最多导出 {limit} 条</div><div style={{ color: "#999", fontSize: 12 }}>当前范围预计导出 {count} 条</div></div>
    <Segmented block value={scope} options={[{ label: `全部 ${bound.rows.length}`, value: "all" }, { label: `已选 ${selectedRowIds.length}`, value: "selected", disabled: selectedRowIds.length === 0 }]} onChange={value => setScope(String(value))} />
    <div><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><strong>导出字段</strong><Button size="mini" fill="none" onClick={() => setSelectedFields(selectedFields.length === fields.length ? [] : fields)}>{selectedFields.length === fields.length ? "清空" : "全选"}</Button></div><Checkbox.Group value={selectedFields} onChange={values => setSelectedFields(values.map(String))}><Grid columns={2} gap={8}>{fields.map(field => <Grid.Item key={field}><Checkbox value={field}>{labelOf(field)}</Checkbox></Grid.Item>)}</Grid></Checkbox.Group></div>
    <Segmented block value={format} options={[{ label: "Excel", value: "xlsx" }, { label: "CSV", value: "csv" }]} onChange={value => setFormat(String(value))} />
    <Button block color="primary" disabled={selectedFields.length === 0 || count === 0} onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "startExport", scope, rowIds: scope === "selected" ? selectedRowIds : undefined, fieldRefs: selectedFields, format, maxRows: limit }); setSubmitted(true); }}>开始导出</Button>
  </Space>}</PhoneShell>;
}

type PhoneBulkEditMode = "unchanged" | "set" | "clear";

function PhoneBulkEditPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  if (!bound) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-bulk-edit-panel"><MobileEmpty description="批量编辑尚未绑定有效实体" /></PhoneShell>;
  const declared = phoneFieldList(props, "fieldRefs");
  const fields = declared.length > 0 ? declared : Array.from(new Set(bound.rows.flatMap(row => Object.keys(row.values ?? {})))).slice(0, 6);
  const rowIds = props.selection?.rowIds?.[bound.entityRef] ?? [];
  const [modes, setModes] = React.useState<Record<string, PhoneBulkEditMode>>({});
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const labelOf = (field: string) => props.fieldSchemaOf?.(bound.entityRef, field)?.label ?? props.fieldLabelOf?.(bound.entityRef, field) ?? field;
  if (fields.length === 0) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-bulk-edit-panel"><MobileEmpty description="当前实体没有可批量编辑的字段" /></PhoneShell>;
  const submit = () => { const changed = fields.filter(field => (modes[field] ?? "unchanged") !== "unchanged"); props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "bulkEdit", rowIds, values: Object.fromEntries(changed.map(field => [field, modes[field] === "clear" ? null : values[field]])) }); };
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-bulk-edit-panel">{rowIds.length === 0 ? <div style={{ padding: 12, color: "#ff8f1f", background: "#fff7e6", borderRadius: 6 }}>请先在目标列表选择要编辑的记录</div> : <><div style={{ padding: 10, background: "#e7f1ff", borderRadius: 6, marginBottom: 8 }}>将批量处理 {rowIds.length} 条记录</div><List mode="card" style={{ margin: 0 }}>{fields.map(field => { const mode = modes[field] ?? "unchanged"; const schema = props.fieldSchemaOf?.(bound.entityRef, field); const options = schema?.options ?? props.enumOptionsOf?.(bound.entityRef, field) ?? []; return <List.Item key={field} description={<div style={{ marginTop: 8 }}><Selector columns={3} value={[mode]} options={[{ label: "不变", value: "unchanged" }, { label: "改成", value: "set" }, { label: "清空", value: "clear" }]} onChange={next => next[0] && setModes(current => ({ ...current, [field]: String(next[0]) as PhoneBulkEditMode }))} />{mode === "set" && <div style={{ marginTop: 8 }}>{options.length > 0 ? <Selector columns={2} value={values[field] == null ? [] : [String(values[field])]} options={options.map(option => ({ label: option.label, value: option.id }))} onChange={next => setValues(current => ({ ...current, [field]: next[0] }))} /> : <Input type={schema?.type === "number" ? "number" : "text"} value={String(values[field] ?? "")} onChange={(value: string) => setValues(current => ({ ...current, [field]: schema?.type === "number" ? Number(value) : value }))} placeholder={`输入${labelOf(field)}`} style={{ padding: 8, background: "#f5f5f5", borderRadius: 4 }} />}</div>}</div>}>{labelOf(field)}</List.Item>; })}</List><Button block color="primary" disabled={!fields.some(field => (modes[field] ?? "unchanged") !== "unchanged")} style={{ marginTop: 12 }} onClick={submit}>更新 {rowIds.length} 条记录</Button></>}</PhoneShell>;
}

function PhoneMemberAssignment(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const nameRef = phoneField(props, "nameFieldRef");
  const membershipRef = phoneField(props, "membershipFieldRef");
  const accountRef = phoneField(props, "accountFieldRef");
  const statusRef = phoneField(props, "statusFieldRef");
  const memberValue = String(props.block.props?.memberValue ?? "member");
  const [tab, setTab] = React.useState("members");
  const [keyword, setKeyword] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [localMembership, setLocalMembership] = React.useState<Record<string, string>>({});
  if (!bound || !nameRef || !membershipRef) return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-member-assignment"><MobileEmpty description="成员分配尚未绑定姓名和成员状态字段" /></PhoneShell>;
  const isMember = (row: (typeof bound.rows)[number]) => (localMembership[row.id] ?? String(row.values?.[membershipRef] ?? "")) === memberValue;
  const members = bound.rows.filter(isMember); const candidates = bound.rows.filter(row => !isMember(row));
  const normalized = keyword.trim().toLowerCase(); const source = tab === "members" ? members : candidates;
  const shown = source.filter(row => !normalized || [row.values?.[nameRef], accountRef ? row.values?.[accountRef] : ""].some(value => String(value ?? "").toLowerCase().includes(normalized)));
  const add = () => { setLocalMembership(current => ({ ...current, ...Object.fromEntries(selected.map(id => [id, memberValue])) })); props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "addMembers", rowIds: selected }); setSelected([]); setTab("members"); };
  return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-member-assignment"><Segmented block value={tab} options={[{ label: `当前 ${members.length}`, value: "members" }, { label: `可添加 ${candidates.length}`, value: "candidates" }]} onChange={value => { setTab(String(value)); setSelected([]); }} /><SearchBar value={keyword} onChange={setKeyword} placeholder="搜索姓名或账号" style={{ margin: "8px 0" }} />{shown.length === 0 ? <MobileEmpty description={normalized ? "没有匹配的成员" : tab === "members" ? "当前还没有成员" : "没有可添加的候选人"} /> : <List mode="card" style={{ margin: 0 }}>{shown.map(row => <List.Item key={row.id} prefix={tab === "candidates" ? <Checkbox checked={selected.includes(row.id)} onChange={checked => setSelected(current => checked ? [...current, row.id] : current.filter(id => id !== row.id))} /> : undefined} description={[accountRef ? row.values?.[accountRef] : "", statusRef ? row.values?.[statusRef] : ""].filter(Boolean).map(String).join(" · ")} extra={tab === "members" ? <Button size="mini" color="danger" fill="none" onClick={() => { setLocalMembership(current => ({ ...current, [row.id]: "candidate" })); props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "removeMembers", rowIds: [row.id] }); }}>移除</Button> : undefined}>{String(row.values?.[nameRef] ?? "未命名成员")}</List.Item>)}</List>}{tab === "candidates" && <Button block color="primary" disabled={selected.length === 0} style={{ marginTop: 12 }} onClick={add}>添加所选 {selected.length || ""}</Button>}</PhoneShell>;
}

function PhoneAnalysisChart({ props, testid, option, hint }: { props: ExperienceBlockRendererProps; testid: string; option?: Record<string, unknown>; hint: string }) {
  return <PhoneShell block={props.block} title={titleOf(props)} testid={testid}>{option ? <React.Suspense fallback={<div style={{ height: 180 }} />}><PhoneLazyEchartsChart option={option} height={180} ariaLabel={titleOf(props) || testid} /></React.Suspense> : <MobileEmpty description={hint} />}</PhoneShell>;
}

function phoneGrouped(props: ExperienceBlockRendererProps, dimensionKey: string, valueKey?: string) {
  const bound = phoneRows(props); const dimension = phoneField(props, dimensionKey); const valueRef = valueKey ? phoneField(props, valueKey) : undefined; if (!bound || !dimension) return [];
  const values = new Map<string, number>(); bound.rows.forEach(row => { const key = String(row.values?.[dimension] ?? "").trim(); if (key) values.set(key, (values.get(key) ?? 0) + (valueRef ? Number(row.values?.[valueRef] ?? 0) : 1)); }); return [...values.entries()].map(([name, value]) => ({ name, value }));
}

function PhoneWaterfallChart(props: ExperienceBlockRendererProps) {
  const data = phoneGrouped(props, "categoryFieldRef", "valueFieldRef"); let running = 0; const base: number[] = []; const values: number[] = []; data.forEach(item => { const next = running + item.value; base.push(Math.min(running, next)); values.push(Math.abs(item.value)); running = next; });
  const option = data.length ? { animation: false, tooltip: { trigger: "axis", confine: true }, grid: { left: 4, right: 4, top: 12, bottom: 8, containLabel: true }, xAxis: { type: "category", data: data.map(item => item.name), axisLabel: { fontSize: 9 } }, yAxis: { type: "value" }, series: [{ type: "bar", stack: "total", silent: true, itemStyle: { color: "transparent" }, data: base }, { type: "bar", stack: "total", data: values, itemStyle: { color: (p: { dataIndex: number }) => data[p.dataIndex].value >= 0 ? "#1677ff" : "#cf1322" } }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-waterfall-chart" option={option} hint="当前没有可计算的增减值" />;
}

function PhoneFunnelChart(props: ExperienceBlockRendererProps) {
  const raw = phoneGrouped(props, "stageFieldRef", "valueFieldRef"); const declared = Array.isArray(props.block.props?.stages) ? props.block.props.stages.map(String) : []; const data = declared.length ? declared.flatMap(name => { const item = raw.find(row => row.name === name); return item ? [item] : []; }) : raw.sort((a, b) => b.value - a.value);
  const option = data.length ? { animation: false, tooltip: { trigger: "item", confine: true }, series: [{ type: "funnel", left: "4%", right: "4%", top: 6, bottom: 6, minSize: "20%", sort: "none", gap: 2, label: { show: true, position: "inside", color: "#fff", fontSize: 10, formatter: "{b} {c}" }, data }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-funnel-chart" option={option} hint="当前没有可用的漏斗阶段" />;
}

function PhoneDistributionHistogram(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const ref = phoneField(props, "valueFieldRef"); const values = bound && ref ? bound.rows.map(row => Number(row.values?.[ref])).filter(Number.isFinite) : []; const bins = Math.max(3, Math.min(8, Number(props.block.props?.bins ?? 5))); const min = values.length ? Math.min(...values) : 0; const max = values.length ? Math.max(...values) : 0; const width = max === min ? 1 : (max - min) / bins; const counts = Array.from({ length: bins }, () => 0); values.forEach(value => counts[Math.min(bins - 1, Math.floor((value - min) / width))] += 1); const labels = counts.map((_, i) => `${(min + i * width).toFixed(0)}-${(min + (i + 1) * width).toFixed(0)}`);
  const option = values.length ? { animation: false, tooltip: { trigger: "axis", confine: true }, grid: { left: 4, right: 4, top: 12, bottom: 8, containLabel: true }, xAxis: { type: "category", data: labels, axisLabel: { fontSize: 8, rotate: 30 } }, yAxis: { type: "value", minInterval: 1 }, series: [{ type: "bar", data: counts, itemStyle: { color: "#1677ff" } }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-distribution-histogram" option={option} hint="当前没有可计算的数值" />;
}

function PhoneHeatmapMatrix(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const xRef = phoneField(props, "xFieldRef"); const yRef = phoneField(props, "yFieldRef"); const valueRef = phoneField(props, "valueFieldRef"); if (!bound || !xRef || !yRef) return <PhoneAnalysisChart props={props} testid="phone-heatmap-matrix" hint="热力矩阵尚未绑定横纵维度" />; const xs = Array.from(new Set(bound.rows.map(row => String(row.values?.[xRef] ?? "")).filter(Boolean))).slice(0, 8); const ys = Array.from(new Set(bound.rows.map(row => String(row.values?.[yRef] ?? "")).filter(Boolean))).slice(0, 8); const map = new Map<string, number>(); bound.rows.forEach(row => { const x = String(row.values?.[xRef] ?? ""); const y = String(row.values?.[yRef] ?? ""); if (x && y) map.set(`${x}\u0000${y}`, (map.get(`${x}\u0000${y}`) ?? 0) + (valueRef ? Number(row.values?.[valueRef] ?? 0) : 1)); }); const data = ys.flatMap((y, yi) => xs.map((x, xi) => [xi, yi, map.get(`${x}\u0000${y}`) ?? 0])); const max = Math.max(1, ...data.map(item => Number(item[2]))); const option = data.length ? { animation: false, tooltip: { position: "top", confine: true }, grid: { left: 4, right: 4, top: 4, bottom: 8, containLabel: true }, xAxis: { type: "category", data: xs, axisLabel: { fontSize: 8 } }, yAxis: { type: "category", data: ys, axisLabel: { fontSize: 8 } }, visualMap: { min: 0, max, show: false, inRange: { color: ["#f0f5ff", "#1677ff"] } }, series: [{ type: "heatmap", data }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-heatmap-matrix" option={option} hint="当前没有可组成矩阵的数据" />;
}

function PhoneTreemapBreakdown(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const labelRef = phoneField(props, "labelFieldRef"); const valueRef = phoneField(props, "valueFieldRef"); const parentRef = phoneField(props, "parentFieldRef"); if (!bound || !labelRef || !valueRef) return <PhoneAnalysisChart props={props} testid="phone-treemap-breakdown" hint="矩形树图尚未绑定名称和数值字段" />; const nodes = new Map(bound.rows.map(row => [row.id, { name: String(row.values?.[labelRef] ?? row.id), value: Number(row.values?.[valueRef] ?? 0), children: [] as Array<Record<string, unknown>> }])); const roots: Array<Record<string, unknown>> = []; bound.rows.forEach(row => { const node = nodes.get(row.id)!; const owner = parentRef ? nodes.get(String(row.values?.[parentRef] ?? "")) : undefined; if (owner) owner.children.push(node); else roots.push(node); }); roots.forEach(node => { if ((node.children as unknown[]).length === 0) delete node.children; }); const option = roots.length ? { animation: false, tooltip: { confine: true }, series: [{ type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, label: { show: true, fontSize: 10, formatter: "{b}\n{c}" }, data: roots }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-treemap-breakdown" option={option} hint="当前没有层级构成数据" />;
}

function PhoneGaugeProgress(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const currentRef = phoneField(props, "currentFieldRef"); const targetRef = phoneField(props, "targetFieldRef"); const row = bound?.rows[0]; const current = row && currentRef ? Number(row.values?.[currentRef] ?? 0) : 0; const target = row && targetRef ? Number(row.values?.[targetRef] ?? 0) : 0; const percent = target > 0 ? Math.max(0, Math.min(100, current / target * 100)) : 0; const option = target > 0 ? { animation: false, series: [{ type: "gauge", startAngle: 210, endAngle: -30, min: 0, max: 100, progress: { show: true, width: 10 }, axisLine: { lineStyle: { width: 10 } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, detail: { formatter: `${percent.toFixed(0)}%\n${current}/${target}`, fontSize: 16 }, data: [{ value: percent }] }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-gauge-progress" option={option} hint="目标值必须大于零" />;
}

function PhoneAlertTriagePanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const stateRef = phoneField(props, "stateFieldRef"); const severityRef = phoneField(props, "severityFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const [scope, setScope] = React.useState("active"); if (!bound || !titleRef || !stateRef) return <PhoneShell block={props.block} title={titleOf(props) || "告警分诊"} testid="phone-alert-triage-panel"><MobileEmpty description="告警分诊尚未绑定标题和状态字段" /></PhoneShell>; const firing = String(props.block.props?.firingValue ?? "firing"); const pending = String(props.block.props?.pendingValue ?? "pending"); const active = bound.rows.filter(row => [firing, pending].includes(String(row.values?.[stateRef] ?? ""))); const shown = scope === "all" ? bound.rows : active;
  return <PhoneShell block={props.block} title={titleOf(props) || "告警分诊"} testid="phone-alert-triage-panel"><Segmented block value={scope} options={[{ label: `活动 ${active.length}`, value: "active" }, { label: `全部 ${bound.rows.length}`, value: "all" }]} onChange={value => setScope(String(value))} /><List mode="card" style={{ margin: "8px 0 0" }}>{shown.map(row => <List.Item key={row.id} description={[severityRef ? row.values?.[severityRef] : "", timeRef ? row.values?.[timeRef] : ""].filter(Boolean).join(" · ")} extra={<Button size="mini" onClick={() => props.onAction?.("actionTrigger", { operation: "openSilence", rowId: row.id, targets: phoneTargets(props) })}>静默</Button>} onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>{String(row.values?.[titleRef] ?? "未命名告警")}</List.Item>)}</List></PhoneShell>;
}

function PhoneAlertSilenceForm(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const labelRef = phoneField(props, "labelFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0]; const [duration, setDuration] = React.useState("2h"); const [comment, setComment] = React.useState(""); if (!bound || !row) return <PhoneShell block={props.block} title={titleOf(props) || "创建静默"} testid="phone-alert-silence-form"><MobileEmpty description="静默表单尚未找到目标告警" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "创建静默"} testid="phone-alert-silence-form"><div style={{ padding: 10, background: "#e7f1ff", borderRadius: 6, marginBottom: 8 }}><strong>{titleRef ? String(row.values?.[titleRef] ?? "当前告警") : "当前告警"}</strong>{labelRef && <div style={{ fontSize: 12, color: "#666" }}>{String(row.values?.[labelRef] ?? "")}</div>}</div><Selector columns={3} value={[duration]} options={[{ label: "30 分", value: "30m" }, { label: "2 小时", value: "2h" }, { label: "1 天", value: "1d" }]} onChange={values => values[0] && setDuration(String(values[0]))} /><TextArea value={comment} onChange={setComment} rows={3} placeholder="填写静默原因" style={{ margin: "10px 0", padding: 8, background: "#f5f5f5" }} /><Button block color="primary" disabled={!comment.trim()} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "createSilence", duration, comment, targets: phoneTargets(props) })}>创建静默</Button></PhoneShell>;
}

function PhoneAlertRoutingPolicy(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const nameRef = phoneField(props, "nameFieldRef"); const parentRef = phoneField(props, "parentFieldRef"); const matcherRef = phoneField(props, "matcherFieldRef"); const receiverRef = phoneField(props, "receiverFieldRef"); if (!bound || !nameRef || !parentRef || !receiverRef) return <PhoneShell block={props.block} title={titleOf(props) || "告警路由策略"} testid="phone-alert-routing-policy"><MobileEmpty description="路由策略尚未绑定必要字段" /></PhoneShell>; const childrenOf = (parent: string) => bound.rows.filter(row => String(row.values?.[parentRef] ?? "") === parent); const render = (row: (typeof bound.rows)[number], depth = 0): React.ReactNode => <div key={row.id} style={{ marginLeft: depth * 12, padding: "9px 0", borderBottom: "1px solid #eee" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><div><strong>{String(row.values?.[nameRef] ?? "未命名策略")}</strong><div style={{ color: "#999", fontSize: 12 }}>{matcherRef ? String(row.values?.[matcherRef] ?? "全部告警") : "全部告警"} → {String(row.values?.[receiverRef] ?? "未配置")}</div></div><Button size="mini" onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editPolicy" })}>编辑</Button></div>{childrenOf(row.id).map(child => render(child, depth + 1))}</div>;
  return <PhoneShell block={props.block} title={titleOf(props) || "告警路由策略"} testid="phone-alert-routing-policy">{childrenOf("").map(row => render(row))}</PhoneShell>;
}

function PhoneDeletedRecordsRecovery(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const deletedAtRef = phoneField(props, "deletedAtFieldRef"); const deletedByRef = phoneField(props, "deletedByFieldRef"); const [confirmId, setConfirmId] = React.useState(""); if (!bound || !titleRef || !deletedAtRef) return <PhoneShell block={props.block} title={titleOf(props) || "已删除记录"} testid="phone-deleted-records-recovery"><MobileEmpty description="回收站尚未绑定标题和删除时间" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || `已删除记录 ${bound.rows.length}`} testid="phone-deleted-records-recovery"><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => <List.Item key={row.id} description={`${String(row.values?.[deletedAtRef] ?? "")} ${deletedByRef ? `· ${String(row.values?.[deletedByRef] ?? "")}` : ""}`} extra={<Space><Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "restore", targets: phoneTargets(props) })}>恢复</Button><Button size="mini" color="danger" onClick={() => setConfirmId(row.id)}>删除</Button></Space>}>{String(row.values?.[titleRef] ?? "未命名记录")}</List.Item>)}</List><Popup visible={Boolean(confirmId)} onMaskClick={() => setConfirmId("")} bodyStyle={{ padding: 16 }}><strong>永久删除后无法恢复</strong><Button block color="danger" style={{ marginTop: 12 }} onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: confirmId, operation: "hardDelete", targets: phoneTargets(props) }); setConfirmId(""); }}>确认永久删除</Button></Popup></PhoneShell>;
}

function PhoneRevisionHistoryPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const versionRef = phoneField(props, "versionFieldRef"); const authorRef = phoneField(props, "authorFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const summaryRef = phoneField(props, "summaryFieldRef"); const currentRef = phoneField(props, "currentFieldRef"); if (!bound || !versionRef || !timeRef) return <PhoneShell block={props.block} title={titleOf(props) || "修订历史"} testid="phone-revision-history-panel"><MobileEmpty description="修订历史尚未绑定版本和时间" /></PhoneShell>; const rows = [...bound.rows].sort((a, b) => Number(b.values?.[versionRef] ?? 0) - Number(a.values?.[versionRef] ?? 0));
  return <PhoneShell block={props.block} title={titleOf(props) || "修订历史"} testid="phone-revision-history-panel"><List mode="card" style={{ margin: 0 }}>{rows.map(row => { const current = currentRef && [true, "true", "current"].includes(row.values?.[currentRef] as never); return <List.Item key={row.id} description={`${authorRef ? `${String(row.values?.[authorRef] ?? "")} · ` : ""}${String(row.values?.[timeRef] ?? "")}${summaryRef ? ` · ${String(row.values?.[summaryRef] ?? "")}` : ""}`} extra={current ? "当前" : <Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "restoreRevision", targets: phoneTargets(props) })}>恢复</Button>}>版本 {String(row.values?.[versionRef] ?? "-")}</List.Item>; })}</List></PhoneShell>;
}

function PhoneRecordComparePanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const fields = phoneFieldList(props, "fieldRefs"); const ids = bound ? props.selection?.rowIds?.[bound.entityRef] ?? [] : []; const rows = bound?.rows.filter(row => ids.includes(row.id)).slice(0, 2) ?? []; if (!bound || !fields.length) return <PhoneShell block={props.block} title={titleOf(props) || "记录对比"} testid="phone-record-compare-panel"><MobileEmpty description="记录对比尚未绑定字段" /></PhoneShell>; if (rows.length !== 2) return <PhoneShell block={props.block} title={titleOf(props) || "记录对比"} testid="phone-record-compare-panel"><div style={{ padding: 10, background: "#fff7e6", borderRadius: 6 }}>请选择恰好两条记录进行对比</div></PhoneShell>; const changed = fields.filter(field => String(rows[0].values?.[field] ?? "") !== String(rows[1].values?.[field] ?? ""));
  return <PhoneShell block={props.block} title={titleOf(props) || `记录对比 · ${changed.length} 项差异`} testid="phone-record-compare-panel"><List mode="card" style={{ margin: 0 }}>{fields.map(field => <List.Item key={field} description={<Grid columns={2} gap={8}><Grid.Item>{String(rows[0].values?.[field] ?? "-")}</Grid.Item><Grid.Item><span style={{ background: changed.includes(field) ? "#fff1b8" : undefined }}>{String(rows[1].values?.[field] ?? "-")}</span></Grid.Item></Grid>}>{props.fieldLabelOf?.(bound.entityRef, field) ?? field}</List.Item>)}</List><Grid columns={2} gap={8} style={{ marginTop: 8 }}><Grid.Item><Button block onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: rows[0].id, operation: "useAsCanonical", targets: phoneTargets(props) })}>采用左侧</Button></Grid.Item><Grid.Item><Button block color="primary" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: rows[1].id, operation: "useAsCanonical", targets: phoneTargets(props) })}>采用右侧</Button></Grid.Item></Grid></PhoneShell>;
}

function PhoneGanttSchedule(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const labelRef = phoneField(props, "labelFieldRef"); const startRef = phoneField(props, "startFieldRef"); const endRef = phoneField(props, "endFieldRef"); const groupRef = phoneField(props, "groupFieldRef"); if (!bound || !labelRef || !startRef || !endRef) return <PhoneShell block={props.block} title={titleOf(props) || "计划排期"} testid="phone-gantt-schedule"><MobileEmpty description="甘特排期尚未绑定必要字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "计划排期"} testid="phone-gantt-schedule"><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => <List.Item key={row.id} description={`${String(row.values?.[startRef] ?? "")} 至 ${String(row.values?.[endRef] ?? "")}${groupRef ? ` · ${String(row.values?.[groupRef] ?? "")}` : ""}`}>{String(row.values?.[labelRef] ?? "未命名任务")}</List.Item>)}</List></PhoneShell>;
}

function PhoneSankeyFlow(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const sourceRef = phoneField(props, "sourceFieldRef"); const targetRef = phoneField(props, "targetFieldRef"); const valueRef = phoneField(props, "valueFieldRef"); if (!bound || !sourceRef || !targetRef) return <PhoneAnalysisChart props={props} testid="phone-sankey-flow" hint="桑基图尚未绑定来源和目标" />; const links = bound.rows.flatMap(row => { const source = String(row.values?.[sourceRef] ?? "").trim(); const target = String(row.values?.[targetRef] ?? "").trim(); return source && target && source !== target ? [{ source, target, value: valueRef ? Number(row.values?.[valueRef] ?? 0) : 1 }] : []; }); const nodes = Array.from(new Set(links.flatMap(link => [link.source, link.target]))).map(name => ({ name })); const option = links.length ? { animation: false, tooltip: { trigger: "item", confine: true }, series: [{ type: "sankey", left: 4, right: 4, top: 4, bottom: 4, nodeWidth: 12, nodeGap: 8, lineStyle: { color: "gradient", curveness: 0.5 }, label: { fontSize: 9 }, data: nodes, links }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-sankey-flow" option={option} hint="当前没有有效关系流" />;
}

function phoneQuartiles(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const at = (p: number) => { const i = (sorted.length - 1) * p; const low = Math.floor(i); const high = Math.ceil(i); return sorted[low] + (sorted[high] - sorted[low]) * (i - low); }; return sorted.length ? [sorted[0], at(.25), at(.5), at(.75), sorted[sorted.length - 1]] : [0, 0, 0, 0, 0]; }

function PhoneBoxPlotDistribution(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const categoryRef = phoneField(props, "categoryFieldRef"); const valueRef = phoneField(props, "valueFieldRef"); if (!bound || !categoryRef || !valueRef) return <PhoneAnalysisChart props={props} testid="phone-boxplot-distribution" hint="箱线图尚未绑定分类和数值" />; const groups = new Map<string, number[]>(); bound.rows.forEach(row => { const key = String(row.values?.[categoryRef] ?? ""); const value = Number(row.values?.[valueRef]); if (key && Number.isFinite(value)) groups.set(key, [...(groups.get(key) ?? []), value]); }); const entries = [...groups.entries()]; const option = entries.length ? { animation: false, tooltip: { trigger: "item", confine: true }, grid: { left: 4, right: 4, top: 8, bottom: 8, containLabel: true }, xAxis: { type: "category", data: entries.map(([name]) => name), axisLabel: { fontSize: 8 } }, yAxis: { type: "value" }, series: [{ type: "boxplot", data: entries.map(([, values]) => phoneQuartiles(values)), itemStyle: { color: "#91caff", borderColor: "#1677ff" } }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-boxplot-distribution" option={option} hint="当前没有可计算的分类数值" />;
}

function PhoneRadarComparison(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const nameRef = phoneField(props, "nameFieldRef"); const fields = phoneFieldList(props, "metricFieldRefs").slice(0, 6); if (!bound || !nameRef || fields.length < 3) return <PhoneAnalysisChart props={props} testid="phone-radar-comparison" hint="雷达对比至少需要三个数值维度" />; const maxima = fields.map(field => Math.max(1, ...bound.rows.map(row => Number(row.values?.[field] ?? 0)))); const option = bound.rows.length ? { animation: false, tooltip: { trigger: "item", confine: true }, radar: { radius: "55%", indicator: fields.map((field, i) => ({ name: props.fieldLabelOf?.(bound.entityRef, field) ?? field, max: maxima[i] * 1.15 })), axisName: { fontSize: 8 } }, series: [{ type: "radar", data: bound.rows.slice(0, 3).map(row => ({ name: String(row.values?.[nameRef] ?? row.id), value: fields.map(field => Number(row.values?.[field] ?? 0)), areaStyle: { opacity: .08 } })) }] } : undefined;
  return <PhoneAnalysisChart props={props} testid="phone-radar-comparison" option={option} hint="当前没有可对比记录" />;
}

function PhoneAnalysisDependencyBlock(props: ExperienceBlockRendererProps) {
  const type = props.block.type;
  if (type === "FunnelConversionChart") return <PhoneFunnelChart {...props} />;
  if (type === "HistogramDistributionChart") return <PhoneDistributionHistogram {...props} />;
  if (type === "BoxPlotDistributionChart") return <PhoneBoxPlotDistribution {...props} />;
  if (type === "WaterfallVarianceChart") return <PhoneWaterfallChart {...props} />;
  if (type === "ServiceMapPanel" || type === "DependencyGraphPanel") return <PhoneSankeyFlow {...props} />;
  if (type === "ScatterCorrelationChart") {
    const data = phoneRows(props), x = phoneField(props, "xFieldRef"), y = phoneField(props, "yFieldRef");
    const points = data && x && y ? data.rows.flatMap(row => { const xv = Number(row.values?.[x]), yv = Number(row.values?.[y]); return Number.isFinite(xv) && Number.isFinite(yv) ? [{ value: [xv, yv] }] : []; }) : [];
    return <PhoneAnalysisChart props={props} testid="phone-scatter-correlation-chart" option={points.length ? { animation: false, tooltip: { trigger: "item", confine: true }, xAxis: { type: "value" }, yAxis: { type: "value" }, series: [{ type: "scatter", symbolSize: 9, data: points }] } : undefined} hint="尚未绑定成对的数值字段" />;
  }
  if (type === "ErrorBudgetGauge") {
    const data = phoneRows(props), consumed = phoneField(props, "consumedFieldRef"), budget = phoneField(props, "budgetFieldRef"), row = data?.rows[0];
    const used = row && consumed ? Number(row.values?.[consumed]) : NaN, total = row && budget ? Number(row.values?.[budget]) : NaN;
    const percent = Number.isFinite(used) && Number.isFinite(total) && total > 0 ? Math.max(0, Math.min(100, used / total * 100)) : null;
    return <PhoneAnalysisChart props={props} testid="phone-error-budget-gauge" option={percent !== null ? { animation: false, series: [{ type: "gauge", startAngle: 210, endAngle: -30, min: 0, max: 100, progress: { show: true }, detail: { formatter: `${percent.toFixed(1)}%`, fontSize: 18 }, data: [{ value: percent, name: "已消耗" }] }] } : undefined} hint="尚未绑定消耗值与预算值" />;
  }
  const data = phoneRows(props), time = phoneField(props, "timeFieldRef");
  const refs = type === "ForecastConfidenceChart" ? ["actualFieldRef", "forecastFieldRef", "lowerFieldRef", "upperFieldRef"] : type === "BurnupChart" ? ["completedFieldRef", "scopeFieldRef"] : ["remainingFieldRef", "idealFieldRef"];
  if (type === "ForecastConfidenceChart" || type === "BurnupChart" || type === "BurndownChart") {
    const timeField = time;
    const rows = data && timeField ? [...data.rows].sort((a, b) => String(a.values?.[timeField]).localeCompare(String(b.values?.[timeField]))) : [];
    const series = refs
      .map(bindingKey => phoneField(props, bindingKey))
      .filter((fieldRef): fieldRef is string => Boolean(fieldRef))
      .map(fieldRef => ({ name: fieldRef, type: "line", connectNulls: false, showSymbol: false, data: rows.map(row => Number.isFinite(Number(row.values?.[fieldRef])) ? Number(row.values?.[fieldRef]) : null) }));
    return <PhoneAnalysisChart props={props} testid={`phone-${type.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`).replace(/^-/, "")}`} option={rows.length && series.length && timeField ? { animation: false, tooltip: { trigger: "axis", confine: true }, xAxis: { type: "category", data: rows.map(row => String(row.values?.[timeField] ?? "")) }, yAxis: { type: "value" }, series } : undefined} hint="尚未绑定完整的时间序列字段" />;
  }
  if (type === "QueryResultPivot") {
    const rowRef = phoneField(props, "rowFieldRef"), columnRef = phoneField(props, "columnFieldRef"), valueRef = phoneField(props, "valueFieldRef");
    const rows = data && rowRef && columnRef && valueRef ? data.rows.map(row => `${String(row.values?.[rowRef!] ?? "")} · ${String(row.values?.[columnRef!] ?? "")} · ${String(row.values?.[valueRef!] ?? "-")}`) : [];
    return <PhoneShell block={props.block} title={titleOf(props)} testid="phone-query-result-pivot">{rows.length ? <List mode="card">{rows.map((row, index) => <List.Item key={`${row}-${index}`}>{row}</List.Item>)}</List> : <MobileEmpty description="尚未绑定透视结果字段" />}</PhoneShell>;
  }
  const category = phoneField(props, "categoryFieldRef"), metrics = Array.isArray(props.block.binding?.metricFieldRefs) ? (props.block.binding.metricFieldRefs as unknown[]).map(String).filter(Boolean) : [];
  const labels = data && category ? data.rows.map(row => String(row.values?.[category] ?? "")) : [];
  return <PhoneAnalysisChart props={props} testid="phone-metric-comparison-panel" option={labels.length && metrics.length ? { animation: false, tooltip: { trigger: "axis", confine: true }, legend: { bottom: 0 }, xAxis: { type: "category", data: labels }, yAxis: { type: "value" }, series: metrics.map(ref => ({ name: ref, type: "bar", data: data!.rows.map(row => Number.isFinite(Number(row.values?.[ref])) ? Number(row.values?.[ref]) : null) })) } : undefined} hint="尚未绑定分类与指标字段" />;
}

function PhoneAlertRuleEditor(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0]; const nameRef = phoneField(props, "nameFieldRef"); const queryRef = phoneField(props, "queryFieldRef"); const thresholdRef = phoneField(props, "thresholdFieldRef"); const [name, setName] = React.useState(row && nameRef ? String(row.values?.[nameRef] ?? "") : ""); const [query, setQuery] = React.useState(row && queryRef ? String(row.values?.[queryRef] ?? "") : ""); const [threshold, setThreshold] = React.useState(row && thresholdRef ? String(row.values?.[thresholdRef] ?? "") : ""); const [evaluation, setEvaluation] = React.useState("1m"); if (!bound || !nameRef || !queryRef || !thresholdRef) return <PhoneShell block={props.block} title={titleOf(props) || "告警规则"} testid="phone-alert-rule-editor"><MobileEmpty description="告警规则尚未绑定必要字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "告警规则"} testid="phone-alert-rule-editor"><Space direction="vertical" block style={{ "--gap": "8px" }}><Input value={name} onChange={setName} placeholder="规则名称" style={{ padding: 9, background: "#f5f5f5" }} /><TextArea value={query} onChange={setQuery} rows={3} placeholder="查询表达式" style={{ padding: 9, background: "#f5f5f5" }} /><Input value={threshold} onChange={setThreshold} type="number" placeholder="阈值" style={{ padding: 9, background: "#f5f5f5" }} /><Selector columns={3} value={[evaluation]} options={[{ label: "1 分", value: "1m" }, { label: "5 分", value: "5m" }, { label: "15 分", value: "15m" }]} onChange={values => values[0] && setEvaluation(String(values[0]))} /><Button block color="primary" disabled={!name.trim() || !query.trim() || !threshold} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: row ? "updateAlertRule" : "createAlertRule", values: { name, query, threshold: Number(threshold), evaluation }, targets: phoneTargets(props) })}>保存并启用规则</Button></Space></PhoneShell>;
}

function PhoneMuteTimingSchedule(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const nameRef = phoneField(props, "nameFieldRef"); const weekdaysRef = phoneField(props, "weekdaysFieldRef"); const startRef = phoneField(props, "startTimeFieldRef"); const endRef = phoneField(props, "endTimeFieldRef"); const timezoneRef = phoneField(props, "timezoneFieldRef"); if (!bound || !nameRef || !weekdaysRef || !startRef || !endRef) return <PhoneShell block={props.block} title={titleOf(props) || "静默时段"} testid="phone-mute-timing-schedule"><MobileEmpty description="静默时段尚未绑定必要字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "静默时段"} testid="phone-mute-timing-schedule"><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => <List.Item key={row.id} description={`${String(row.values?.[weekdaysRef] ?? "")} · ${String(row.values?.[startRef] ?? "")}–${String(row.values?.[endRef] ?? "")}${timezoneRef ? ` · ${String(row.values?.[timezoneRef] ?? "")}` : ""}`} extra={<Button size="mini" onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editMuteTiming" })}>编辑</Button>}>{String(row.values?.[nameRef] ?? "未命名时段")}</List.Item>)}</List><Button block color="primary" style={{ marginTop: 8 }} onClick={() => props.onAction?.("createRequest", { entityRef: bound.entityRef, operation: "createMuteTiming" })}>新增时段</Button></PhoneShell>;
}

function PhoneContactPointManager(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const nameRef = phoneField(props, "nameFieldRef"); const typeRef = phoneField(props, "typeFieldRef"); const addressRef = phoneField(props, "addressFieldRef"); const [testing, setTesting] = React.useState(""); if (!bound || !nameRef || !typeRef || !addressRef) return <PhoneShell block={props.block} title={titleOf(props) || "通知联络点"} testid="phone-contact-point-manager"><MobileEmpty description="联络点尚未绑定必要字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "通知联络点"} testid="phone-contact-point-manager"><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => <List.Item key={row.id} description={`${String(row.values?.[typeRef] ?? "")} · ${String(row.values?.[addressRef] ?? "")}`} extra={<Button size="mini" loading={testing === row.id} onClick={() => { setTesting(row.id); props.onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId: row.id, operation: "testContactPoint", targets: phoneTargets(props) }); setTimeout(() => setTesting(""), 400); }}>测试</Button>}>{String(row.values?.[nameRef] ?? "未命名联络点")}</List.Item>)}</List><Button block color="primary" style={{ marginTop: 8 }} onClick={() => props.onAction?.("createRequest", { entityRef: bound.entityRef, operation: "createContactPoint" })}>新增联络点</Button></PhoneShell>;
}

function PhoneReferenceManyManager(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const relationRef = phoneField(props, "relationFieldRef"); const linkedValue = String(props.block.props?.linkedValue ?? "linked"); const [tab, setTab] = React.useState("linked"); const [selected, setSelected] = React.useState<string[]>([]); const [local, setLocal] = React.useState<Record<string, string>>({}); if (!bound || !titleRef || !relationRef) return <PhoneShell block={props.block} title={titleOf(props) || "关联记录"} testid="phone-reference-many-manager"><MobileEmpty description="关联记录尚未绑定必要字段" /></PhoneShell>; const isLinked = (row: (typeof bound.rows)[number]) => (local[row.id] ?? String(row.values?.[relationRef] ?? "")) === linkedValue; const linked = bound.rows.filter(isLinked); const available = bound.rows.filter(row => !isLinked(row)); const shown = tab === "linked" ? linked : available;
  return <PhoneShell block={props.block} title={titleOf(props) || "关联记录"} testid="phone-reference-many-manager"><Segmented block value={tab} options={[{ label: `已关联 ${linked.length}`, value: "linked" }, { label: `可关联 ${available.length}`, value: "available" }]} onChange={value => { setTab(String(value)); setSelected([]); }} /><List mode="card" style={{ margin: "8px 0 0" }}>{shown.map(row => <List.Item key={row.id} prefix={tab === "available" ? <Checkbox checked={selected.includes(row.id)} onChange={checked => setSelected(current => checked ? [...current, row.id] : current.filter(id => id !== row.id))} /> : undefined} extra={tab === "linked" ? <Button size="mini" color="danger" fill="none" onClick={() => { setLocal(current => ({ ...current, [row.id]: "available" })); props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "unlinkRecords", rowIds: [row.id], targets: phoneTargets(props) }); }}>解除</Button> : undefined}>{String(row.values?.[titleRef] ?? "未命名记录")}</List.Item>)}</List>{tab === "available" && <Button block color="primary" disabled={!selected.length} style={{ marginTop: 8 }} onClick={() => { setLocal(current => ({ ...current, ...Object.fromEntries(selected.map(id => [id, linkedValue])) })); props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "linkRecords", rowIds: selected, targets: phoneTargets(props) }); setSelected([]); }}>关联所选 {selected.length || ""}</Button>}</PhoneShell>;
}

function PhoneGlobalSearchPalette(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const categoryRef = phoneField(props, "categoryFieldRef"); const descRef = phoneField(props, "descFieldRef"); const [keyword, setKeyword] = React.useState(""); if (!bound || !titleRef) return <PhoneShell block={props.block} title={titleOf(props) || "全局搜索"} testid="phone-global-search-palette"><MobileEmpty description="全局搜索尚未绑定标题字段" /></PhoneShell>; const normalized = keyword.trim().toLowerCase(); const rows = bound.rows.filter(row => normalized && [row.values?.[titleRef], descRef ? row.values?.[descRef] : ""].some(value => String(value ?? "").toLowerCase().includes(normalized))).slice(0, 10);
  return <PhoneShell block={props.block} title={titleOf(props) || "全局搜索"} testid="phone-global-search-palette"><SearchBar value={keyword} onChange={setKeyword} placeholder="搜索页面、记录或操作" />{normalized ? <List mode="card" style={{ margin: "8px 0 0" }}>{rows.map(row => <List.Item key={row.id} description={[categoryRef ? row.values?.[categoryRef] : "", descRef ? row.values?.[descRef] : ""].filter(Boolean).map(String).join(" · ")} onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>{String(row.values?.[titleRef] ?? "未命名结果")}</List.Item>)}</List> : <div style={{ color: "#999", fontSize: 12, padding: "10px 0" }}>输入关键词后显示匹配结果</div>}</PhoneShell>;
}

function PhoneLiveChangeReview(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const actionRef = phoneField(props, "actionFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const actorRef = phoneField(props, "actorFieldRef"); const [ignored, setIgnored] = React.useState<string[]>([]); const rows = bound?.rows.filter(row => !ignored.includes(row.id)) ?? []; if (!bound || !titleRef || !actionRef) return <PhoneShell block={props.block} title={titleOf(props) || "实时变更"} testid="phone-live-change-review"><MobileEmpty description="实时变更尚未绑定必要字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || `实时变更 ${rows.length}`} testid="phone-live-change-review"><div style={{ padding: 9, background: "#e7f1ff", borderRadius: 6, marginBottom: 8 }}>其他用户的变更不会直接覆盖当前视图</div>{rows.length ? <List mode="card" style={{ margin: 0 }}>{rows.map(row => <List.Item key={row.id} description={[actorRef ? row.values?.[actorRef] : "", timeRef ? row.values?.[timeRef] : ""].filter(Boolean).map(String).join(" · ")} extra={<Button size="mini" onClick={() => props.onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId: row.id, operation: "refreshAfterLiveChange", targets: phoneTargets(props) })}>刷新</Button>}>{String(row.values?.[actionRef] ?? "更新")} · {String(row.values?.[titleRef] ?? "未命名记录")}</List.Item>)}</List> : <MobileEmpty description="没有待处理的实时变更" />}</PhoneShell>;
}

const phoneTargets = (props: ExperienceBlockRendererProps) => Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String).filter(Boolean) : [];

function PhoneContextBreadcrumb(props: ExperienceBlockRendererProps) {
  const items = Array.isArray(props.block.props?.items) ? props.block.props.items.map(String).filter(Boolean) : [];
  if (items.length < 2) return null;
  const parent = items[items.length - 2];
  return <PhoneShell block={props.block} testid="phone-context-breadcrumb"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Button size="mini" fill="none" onClick={() => props.onAction?.("actionTrigger", { operation: "navigateBreadcrumb", index: items.length - 2, title: parent })}>‹ {parent}</Button><span style={{ color: "#999" }}>/</span><strong>{items[items.length - 1]}</strong></div></PhoneShell>;
}

function PhoneLiveRefreshControl(props: ExperienceBlockRendererProps) {
  const [polling, setPolling] = React.useState(false); const [lastAt, setLastAt] = React.useState(""); const targets = phoneTargets(props);
  return <PhoneShell block={props.block} title={titleOf(props) || "数据刷新"} testid="phone-live-refresh-control"><div style={{ color: "#999", fontSize: 12, marginBottom: 8 }}>{lastAt ? `最近刷新 ${lastAt}` : "尚未刷新"} · {polling ? "自动刷新中" : "已暂停"}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!targets.length} onClick={() => { setLastAt(new Date().toLocaleTimeString("zh-CN", { hour12: false })); props.onAction?.("actionTrigger", { operation: "refresh", targets }); }}>刷新</Button></Grid.Item><Grid.Item><Button block color={polling ? "default" : "primary"} disabled={!targets.length} onClick={() => { const next = !polling; setPolling(next); props.onAction?.("actionTrigger", { operation: next ? "startPolling" : "stopPolling", targets }); }}>{polling ? "暂停轮询" : "开启轮询"}</Button></Grid.Item></Grid></PhoneShell>;
}

function PhoneActiveFilterSummary(props: ExperienceBlockRendererProps) {
  const entries = Object.entries(props.filterState?.enumFilters ?? {}).filter(([, value]) => value);
  if (!entries.length && !props.filterState?.dateRange) return null;
  return <PhoneShell block={props.block} title={titleOf(props) || "已应用条件"} testid="phone-active-filter-summary"><Space wrap>{entries.map(([key, value]) => <Button key={key} size="mini" onClick={() => { const next = { ...(props.filterState?.enumFilters ?? {}) }; delete next[key]; props.onFilterChange?.({ enumFilters: next }); props.onAction?.("filterChange", { operation: "remove", key, targets: phoneTargets(props) }); }}>{key}：{String(value)} ×</Button>)}{props.filterState?.dateRange && <Button size="mini" onClick={() => props.onFilterChange?.({ dateRange: null })}>{props.filterState.dateRange.join(" 至 ")} ×</Button>}</Space><Button block fill="none" size="small" style={{ marginTop: 6 }} onClick={() => { props.onFilterChange?.({ enumFilters: {}, enumMulti: {}, dateRange: null }); props.onAction?.("filterChange", { operation: "clearAll", targets: phoneTargets(props) }); }}>全部清除</Button></PhoneShell>;
}

function PhoneAnalyticsDateScope(props: ExperienceBlockRendererProps) {
  const [preset, setPreset] = React.useState(String(props.block.props?.defaultPreset ?? "month"));
  return <PhoneShell block={props.block} title={titleOf(props) || "时间口径"} testid="phone-analytics-date-scope"><Selector columns={4} value={[preset]} options={[{ label: "今日", value: "today" }, { label: "本周", value: "week" }, { label: "本月", value: "month" }, { label: "本年", value: "year" }]} onChange={values => { const value = String(values[0] ?? "month"); setPreset(value); props.onAction?.("filterChange", { operation: "dateScope", preset: value, targets: phoneTargets(props) }); }} /></PhoneShell>;
}

function PhoneHeaderEntitySummary(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const fields = phoneFieldList(props, "fieldRefs"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !row || !fields.length) return <PhoneShell block={props.block} testid="phone-header-entity-summary"><MobileEmpty description="页头实体摘要尚未绑定当前记录和关键字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={String(row.values?.[titleRef] ?? "当前记录")} testid="phone-header-entity-summary"><List mode="card" style={{ margin: 0 }}>{fields.slice(0, 4).map(field => <List.Item key={field} extra={String(row.values?.[field] ?? "-")}>{props.fieldLabelOf?.(bound.entityRef, field) ?? field}</List.Item>)}</List></PhoneShell>;
}

function PhoneHeaderProgressSummary(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const currentRef = phoneField(props, "currentFieldRef"); const totalRef = phoneField(props, "totalFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const nextRef = phoneField(props, "nextFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !currentRef || !totalRef || !row) return <PhoneShell block={props.block} testid="phone-header-progress-summary"><MobileEmpty description="页头进度摘要尚未绑定当前值和总量字段" /></PhoneShell>;
  const current = Number(row.values?.[currentRef] ?? 0); const total = Number(row.values?.[totalRef] ?? 0); const percent = total > 0 ? Math.min(100, Math.max(0, Math.round(current / total * 100))) : 0;
  return <PhoneShell block={props.block} title={titleRef ? String(row.values?.[titleRef] ?? "当前进度") : titleOf(props) || "当前进度"} testid="phone-header-progress-summary"><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><strong>{current} / {total}</strong><span style={{ color: "#1677ff" }}>{statusRef ? String(row.values?.[statusRef] ?? "") : `${percent}%`}</span></div><ProgressBar percent={percent} />{nextRef && <div style={{ color: "#999", fontSize: 12, marginTop: 8 }}>下一步：{String(row.values?.[nextRef] ?? "待确认")}</div>}</PhoneShell>;
}

function PhoneWorkspaceTabs(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const [active, setActive] = React.useState("");
  if (!bound || !titleRef || !bound.rows.length) return null; const selected = bound.rows.some(row => row.id === active) ? active : bound.rows[0].id;
  return <PhoneShell block={props.block} testid="phone-workspace-tabs"><Segmented block value={selected} options={bound.rows.slice(0, 4).map(row => ({ value: row.id, label: String(row.values?.[titleRef] ?? "未命名") }))} onChange={value => { setActive(String(value)); props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: String(value) }); }} /><Button size="mini" fill="none" style={{ marginTop: 6 }} onClick={() => props.onAction?.("actionTrigger", { operation: "openTabManager" })}>管理全部页签</Button></PhoneShell>;
}

function PhoneSavedViewTabs(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const presetRef = phoneField(props, "presetKeyFieldRef"); const [active, setActive] = React.useState("all");
  if (!bound || !titleRef || !presetRef) return <PhoneShell block={props.block} testid="phone-saved-view-tabs"><MobileEmpty description="保存视图尚未绑定名称和预设键" /></PhoneShell>;
  const options = [{ label: "全部", value: "all" }, ...bound.rows.flatMap(row => { const value = String(row.values?.[presetRef] ?? ""); return value ? [{ value, label: String(row.values?.[titleRef] ?? "未命名") }] : []; })];
  return <PhoneShell block={props.block} testid="phone-saved-view-tabs"><Segmented block value={active} options={options} onChange={value => { const key = String(value); setActive(key); props.onAction?.("filterChange", { operation: key === "all" ? "clear" : "apply", presetKey: key, targets: phoneTargets(props) }); }} /><Button block fill="none" size="small" onClick={() => props.onAction?.("submitRequest", { operation: "saveView", targets: phoneTargets(props) })}>保存当前视图</Button></PhoneShell>;
}

function PhoneAdvancedFilterBuilder(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const fields = phoneFieldList(props, "fieldRefs"); const [logic, setLogic] = React.useState("and"); const [field, setField] = React.useState(fields[0] ?? ""); const [value, setValue] = React.useState("");
  if (!bound || !fields.length) return <PhoneShell block={props.block} title={titleOf(props) || "高级筛选"} testid="phone-advanced-filter-builder"><MobileEmpty description="高级筛选尚未绑定字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "高级筛选"} testid="phone-advanced-filter-builder"><Selector columns={2} value={[logic]} options={[{ label: "全部满足", value: "and" }, { label: "任一满足", value: "or" }]} onChange={next => next[0] && setLogic(String(next[0]))} /><Picker columns={[fields.map(item => ({ label: props.fieldLabelOf?.(bound.entityRef, item) ?? item, value: item }))]} value={[field]} onConfirm={next => setField(String(next[0] ?? fields[0]))}>{(_, actions) => <Button block style={{ marginTop: 8 }} onClick={actions.open}>字段：{props.fieldLabelOf?.(bound.entityRef, field) ?? field}</Button>}</Picker><Input value={value} onChange={setValue} placeholder="输入条件值" style={{ margin: "8px 0", padding: 10, background: "#f5f5f5", borderRadius: 6 }} /><Grid columns={2} gap={8}><Grid.Item><Button block onClick={() => setValue("")}>重置</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!value.trim()} onClick={() => props.onAction?.("filterChange", { operation: "submit", logic, conditions: [{ field, operator: "equals", value }], targets: phoneTargets(props) })}>应用筛选</Button></Grid.Item></Grid></PhoneShell>;
}

function PhoneFacetedFilterPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const fields = phoneFieldList(props, "fieldRefs"); const [selected, setSelected] = React.useState<Record<string, string[]>>({});
  if (!bound || fields.length < 2) return <PhoneShell block={props.block} title={titleOf(props) || "分面筛选"} testid="phone-faceted-filter-panel"><MobileEmpty description="分面筛选至少需要两个枚举字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "分面筛选"} testid="phone-faceted-filter-panel"><Collapse defaultActiveKey={fields}>{fields.map(field => { const options = props.enumOptionsOf?.(bound.entityRef, field) ?? Array.from(new Set(bound.rows.map(row => String(row.values?.[field] ?? "")).filter(Boolean))).map(value => ({ id: value, label: value })); return <Collapse.Panel key={field} title={props.fieldLabelOf?.(bound.entityRef, field) ?? field}><Selector columns={2} multiple value={selected[field] ?? []} options={options.map(option => ({ value: option.id, label: `${option.label} (${bound.rows.filter(row => String(row.values?.[field] ?? "") === option.id).length})` }))} onChange={values => { const next = { ...selected, [field]: values.map(String) }; setSelected(next); props.onAction?.("filterChange", { operation: "toggleValue", facets: next, targets: phoneTargets(props) }); }} /></Collapse.Panel>; })}</Collapse><Button block fill="none" onClick={() => { setSelected({}); props.onAction?.("filterChange", { operation: "clearAll", targets: phoneTargets(props) }); }}>全部清除</Button></PhoneShell>;
}

function PhoneWizardNavigationBar(props: ExperienceBlockRendererProps) {
  const steps = Array.isArray(props.block.props?.steps) ? props.block.props.steps.map(String) : []; const total = Math.max(steps.length, Number(props.block.props?.total ?? 3)); const [current, setCurrent] = React.useState(Math.min(total - 1, Math.max(0, Number(props.block.props?.initialStep ?? 0)))); const move = (next: number) => { setCurrent(next); props.onAction?.("stepChange", { current: next, total, direction: next > current ? "next" : "previous", targets: phoneTargets(props) }); };
  return <PhoneShell block={props.block} testid="phone-wizard-navigation-bar"><div style={{ marginBottom: 8 }}>第 {current + 1} / {total} 步{steps[current] ? ` · ${steps[current]}` : ""}</div><ProgressBar percent={Math.round((current + 1) / total * 100)} /><Grid columns={2} gap={8} style={{ marginTop: 10 }}><Grid.Item><Button block disabled={current === 0} onClick={() => move(current - 1)}>上一步</Button></Grid.Item><Grid.Item>{current < total - 1 ? <Button block color="primary" onClick={() => move(current + 1)}>下一步</Button> : <Button block color="primary" onClick={() => props.onAction?.("submitRequest", { operation: "finishWizard", current, total, targets: phoneTargets(props) })}>提交</Button>}</Grid.Item></Grid></PhoneShell>;
}

function PhoneApprovalDecisionBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const statusRef = phoneField(props, "statusFieldRef"); const titleRef = phoneField(props, "titleFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0]; const pending = statusRef && row && String(row.values?.[statusRef] ?? "pending") === String(props.block.props?.pendingValue ?? "pending"); const [open, setOpen] = React.useState(false); const [reason, setReason] = React.useState("");
  if (!bound || !statusRef) return <PhoneShell block={props.block} testid="phone-approval-decision-bar"><MobileEmpty description="审批决策栏尚未绑定状态字段" /></PhoneShell>;
  return <PhoneShell block={props.block} testid="phone-approval-decision-bar"><div style={{ marginBottom: 8 }}>{row && titleRef ? String(row.values?.[titleRef] ?? "当前审批") : "当前审批"} · {pending ? "待处理" : "已结束"}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!pending} onClick={() => setOpen(true)}>驳回</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!pending} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, decision: "approve" })}>通过</Button></Grid.Item></Grid><Popup visible={open} onMaskClick={() => setOpen(false)} bodyStyle={{ padding: 16 }}><strong>填写驳回原因</strong><TextArea value={reason} onChange={setReason} rows={4} placeholder="原因不能为空" style={{ margin: "12px 0" }} /><Button block color="danger" disabled={!reason.trim()} onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, decision: "reject", reason }); setOpen(false); }}>确认驳回</Button></Popup></PhoneShell>;
}

function PhoneCheckoutSummaryBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const amountRef = phoneField(props, "amountFieldRef"); const discountRef = phoneField(props, "discountFieldRef"); const rowIds = bound ? props.selection?.rowIds?.[bound.entityRef] ?? [] : []; const rows = bound?.rows.filter(row => rowIds.includes(row.id)) ?? []; const amount = rows.reduce((sum, row) => sum + Number(row.values?.[amountRef ?? ""] ?? 0), 0); const discount = rows.reduce((sum, row) => sum + Number(row.values?.[discountRef ?? ""] ?? 0), 0); const [agreed, setAgreed] = React.useState(false);
  if (!bound || !amountRef) return <PhoneShell block={props.block} testid="phone-checkout-summary-bar"><MobileEmpty description="结算栏尚未绑定金额字段" /></PhoneShell>;
  return <PhoneShell block={props.block} testid="phone-checkout-summary-bar"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}><span>已选 {rows.length} 项</span><strong style={{ fontSize: 20, color: "#e5484d" }}>¥{Math.max(0, amount - discount).toFixed(2)}</strong></div><Checkbox checked={agreed} onChange={setAgreed}>已确认提交协议</Checkbox><Button block color="primary" disabled={!rows.length || !agreed} style={{ marginTop: 8 }} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "checkout", rowIds, amount, discount, total: Math.max(0, amount - discount), agreementAccepted: agreed })}>确认提交</Button></PhoneShell>;
}

function PhoneRecordLifecycleBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]); const [more, setMore] = React.useState(false);
  if (!bound) return <PhoneShell block={props.block} testid="phone-record-lifecycle-bar"><MobileEmpty description="记录操作栏尚未绑定实体" /></PhoneShell>;
  return <PhoneShell block={props.block} testid="phone-record-lifecycle-bar"><div style={{ color: "#999", fontSize: 12, marginBottom: 8 }}>{row ? `当前记录 ${row.id}` : "请先选择一条记录"}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!row} onClick={() => setMore(true)}>更多</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!row} onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: "save" })}>保存</Button></Grid.Item></Grid><Popup visible={more} onMaskClick={() => setMore(false)} bodyStyle={{ padding: 16 }}><Space direction="vertical" block><Button block disabled={!row} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: "archive" })}>归档</Button><Button block color="danger" disabled={!row} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: "delete" })}>确认删除</Button></Space></Popup></PhoneShell>;
}

const phoneTruthy = (value: unknown, truthy = "true") =>
  [true, "true", "enabled", "available", "in_app", "breaking", truthy].includes(value as never);

const phoneTime = (value: unknown) => {
  const timestamp = new Date(String(value ?? "")).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

function PhoneAvailabilityPlanner(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props);
  const dayRef = phoneField(props, "dayFieldRef");
  const startRef = phoneField(props, "startTimeFieldRef");
  const endRef = phoneField(props, "endTimeFieldRef");
  const enabledRef = phoneField(props, "enabledFieldRef");
  if (!bound || !dayRef || !startRef || !endRef) return <PhoneShell block={props.block} title={titleOf(props) || "可用时间"} testid="phone-availability-planner"><MobileEmpty description="可用时间尚未绑定星期和起止时间" /></PhoneShell>;
  const days = Array.from(new Set(bound.rows.map(row => String(row.values?.[dayRef] ?? "")).filter(Boolean)));
  return <PhoneShell block={props.block} title={titleOf(props) || "可用时间"} testid="phone-availability-planner">
    <div style={{ color: "#999", fontSize: 12, marginBottom: 8 }}>时区 · {String(props.block.props?.timezone ?? "Asia/Shanghai")}</div>
    {days.length === 0 ? <MobileEmpty description="还没有设置可用时间" /> : <Collapse defaultActiveKey={[days[0]]}>{days.map(day => <Collapse.Panel key={day} title={`${day} · ${bound.rows.filter(row => String(row.values?.[dayRef] ?? "") === day).length} 段`}><List style={{ margin: 0 }}>{bound.rows.filter(row => String(row.values?.[dayRef] ?? "") === day).map(row => { const enabled = !enabledRef || phoneTruthy(row.values?.[enabledRef], "enabled"); return <List.Item key={row.id} description={enabled ? "可预约" : "已停用"} extra={<Button size="mini" disabled={!enabled} onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editAvailability" })}>编辑</Button>}><span style={{ textDecoration: enabled ? undefined : "line-through", color: enabled ? undefined : "#999" }}>{String(row.values?.[startRef] ?? "")} - {String(row.values?.[endRef] ?? "")}</span></List.Item>; })}</List></Collapse.Panel>)}</Collapse>}
  </PhoneShell>;
}

function PhoneBookingSlotPicker(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const startRef = phoneField(props, "startFieldRef"); const endRef = phoneField(props, "endFieldRef"); const availableRef = phoneField(props, "availableFieldRef"); const capacityRef = phoneField(props, "capacityFieldRef"); const [selected, setSelected] = React.useState("");
  const dates = bound && startRef ? Array.from(new Set(bound.rows.map(row => String(row.values?.[startRef] ?? "").slice(0, 10)).filter(Boolean))) : [];
  const [date, setDate] = React.useState(dates[0] ?? "");
  React.useEffect(() => { if (!date && dates[0]) setDate(dates[0]); }, [date, dates]);
  if (!bound || !startRef || !endRef) return <PhoneShell block={props.block} title={titleOf(props) || "选择时段"} testid="phone-booking-slot-picker"><MobileEmpty description="时段选择器尚未绑定开始和结束时间" /></PhoneShell>;
  const rows = bound.rows.filter(row => String(row.values?.[startRef] ?? "").slice(0, 10) === date);
  return <PhoneShell block={props.block} title={titleOf(props) || "选择时段"} testid="phone-booking-slot-picker">{dates.length === 0 ? <MobileEmpty description="当前没有可预约日期" /> : <><Segmented block value={date} options={dates.slice(0, 5).map(value => ({ label: value.slice(5), value }))} onChange={value => { setDate(String(value)); setSelected(""); }} /><Selector style={{ marginTop: 10 }} columns={2} value={selected ? [selected] : []} options={rows.map(row => { const available = !availableRef || phoneTruthy(row.values?.[availableRef], "available"); return { value: row.id, disabled: !available, label: `${String(row.values?.[startRef] ?? "").slice(11, 16)}-${String(row.values?.[endRef] ?? "").slice(11, 16)}${capacityRef ? ` · ${String(row.values?.[capacityRef] ?? 0)} 位` : ""}` }; })} onChange={values => setSelected(String(values[0] ?? ""))} /><Button block color="primary" disabled={!selected} style={{ marginTop: 10 }} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: selected, operation: "selectBookingSlot", targets: phoneTargets(props) })}>确认所选时段</Button></>}</PhoneShell>;
}

function PhoneScheduleConflictResolver(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const startRef = phoneField(props, "startFieldRef"); const endRef = phoneField(props, "endFieldRef"); const resourceRef = phoneField(props, "resourceFieldRef");
  if (!bound || !titleRef || !startRef || !endRef || !resourceRef) return <PhoneShell block={props.block} title={titleOf(props) || "排期冲突"} testid="phone-schedule-conflict-resolver"><MobileEmpty description="冲突解析尚未绑定标题、资源和起止时间" /></PhoneShell>;
  const conflicts: Array<{ left: (typeof bound.rows)[number]; right: (typeof bound.rows)[number] }> = [];
  for (let i = 0; i < bound.rows.length; i += 1) for (let j = i + 1; j < bound.rows.length; j += 1) { const left = bound.rows[i]; const right = bound.rows[j]; if (String(left.values?.[resourceRef] ?? "") === String(right.values?.[resourceRef] ?? "") && phoneTime(left.values?.[startRef]) < phoneTime(right.values?.[endRef]) && phoneTime(right.values?.[startRef]) < phoneTime(left.values?.[endRef])) conflicts.push({ left, right }); }
  return <PhoneShell block={props.block} title={titleOf(props) || `排期冲突 · ${conflicts.length}`} testid="phone-schedule-conflict-resolver">{conflicts.length === 0 ? <MobileEmpty description="当前没有排期冲突" /> : <List mode="card" style={{ margin: 0 }}>{conflicts.map(({ left, right }) => <List.Item key={`${left.id}-${right.id}`} description={`${String(left.values?.[resourceRef] ?? "")} · ${String(left.values?.[startRef] ?? "")} - ${String(left.values?.[endRef] ?? "")}`} extra={<Button size="mini" color="primary" onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowIds: [left.id, right.id], operation: "resolveScheduleConflict", targets: phoneTargets(props) })}>调整</Button>}>{String(left.values?.[titleRef] ?? left.id)} / {String(right.values?.[titleRef] ?? right.id)}</List.Item>)}</List>}</PhoneShell>;
}

function PhoneStackTracePanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const functionRef = phoneField(props, "functionFieldRef"); const fileRef = phoneField(props, "fileFieldRef"); const lineRef = phoneField(props, "lineFieldRef"); const codeRef = phoneField(props, "codeFieldRef"); const inAppRef = phoneField(props, "inAppFieldRef");
  if (!bound || !functionRef || !fileRef || !lineRef) return <PhoneShell block={props.block} title={titleOf(props) || "异常堆栈"} testid="phone-stack-trace-panel"><MobileEmpty description="堆栈尚未绑定函数、文件和行号字段" /></PhoneShell>;
  const rows = [...bound.rows].sort((a, b) => Number(a.values?.[lineRef] ?? 0) - Number(b.values?.[lineRef] ?? 0)); const firstApp = rows.find(row => inAppRef && phoneTruthy(row.values?.[inAppRef], "in_app"))?.id;
  return <PhoneShell block={props.block} title={titleOf(props) || "异常堆栈"} testid="phone-stack-trace-panel">{rows.length === 0 ? <MobileEmpty description="没有可显示的堆栈帧" /> : <Collapse accordion defaultActiveKey={firstApp}>{rows.map(row => { const inApp = Boolean(inAppRef && phoneTruthy(row.values?.[inAppRef], "in_app")); return <Collapse.Panel key={row.id} title={`${inApp ? "应用" : "依赖"} · ${String(row.values?.[functionRef] ?? "anonymous")}`}><div style={{ color: "#666", fontSize: 12, overflowWrap: "anywhere" }}>{String(row.values?.[fileRef] ?? "")}:{String(row.values?.[lineRef] ?? "")}</div><pre style={{ margin: "8px 0", padding: 8, background: "#f5f5f5", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11 }}>{codeRef ? String(row.values?.[codeRef] ?? "暂无源码上下文") : "暂无源码上下文"}</pre><Button size="mini" fill="none" onClick={() => props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>查看帧详情</Button></Collapse.Panel>; })}</Collapse>}</PhoneShell>;
}

function PhoneEventBreadcrumbTimeline(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const messageRef = phoneField(props, "messageFieldRef"); const categoryRef = phoneField(props, "categoryFieldRef"); const levelRef = phoneField(props, "levelFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const [scope, setScope] = React.useState("all");
  if (!bound || !messageRef || !timeRef) return <PhoneShell block={props.block} title={titleOf(props) || "事件轨迹"} testid="phone-event-breadcrumb-timeline"><MobileEmpty description="事件轨迹尚未绑定消息和时间字段" /></PhoneShell>;
  const rows = [...bound.rows].sort((a, b) => phoneTime(a.values?.[timeRef]) - phoneTime(b.values?.[timeRef])).filter(row => scope === "all" || String(row.values?.[levelRef ?? ""] ?? "") === "error");
  return <PhoneShell block={props.block} title={titleOf(props) || "事件轨迹"} testid="phone-event-breadcrumb-timeline">{levelRef && <Segmented block value={scope} options={[{ label: `全部 ${bound.rows.length}`, value: "all" }, { label: "仅错误", value: "error" }]} onChange={value => setScope(String(value))} />}<Steps direction="vertical" style={{ marginTop: 10 }}>{rows.map(row => <Steps.Step key={row.id} status={String(row.values?.[levelRef ?? ""] ?? "") === "error" ? "error" : "finish"} title={String(row.values?.[messageRef] ?? "未命名事件")} description={`${categoryRef ? `${String(row.values?.[categoryRef] ?? "事件")} · ` : ""}${String(row.values?.[timeRef] ?? "")}`} />)}</Steps>{rows.length === 0 && <MobileEmpty description="当前范围没有事件" />}</PhoneShell>;
}

function PhoneSuspectCommitPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const hashRef = phoneField(props, "hashFieldRef"); const authorRef = phoneField(props, "authorFieldRef"); const messageRef = phoneField(props, "messageFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const scoreRef = phoneField(props, "scoreFieldRef");
  if (!bound || !hashRef || !messageRef) return <PhoneShell block={props.block} title={titleOf(props) || "可疑提交"} testid="phone-suspect-commit-panel"><MobileEmpty description="可疑提交尚未绑定哈希和说明字段" /></PhoneShell>;
  const rows = [...bound.rows].sort((a, b) => Number(b.values?.[scoreRef ?? ""] ?? 0) - Number(a.values?.[scoreRef ?? ""] ?? 0));
  return <PhoneShell block={props.block} title={titleOf(props) || "可疑提交"} testid="phone-suspect-commit-panel">{rows.length === 0 ? <MobileEmpty description="没有关联到可疑提交" /> : <List mode="card" style={{ margin: 0 }}>{rows.map(row => <List.Item key={row.id} description={[authorRef ? row.values?.[authorRef] : "", timeRef ? row.values?.[timeRef] : "", scoreRef ? `相关度 ${String(row.values?.[scoreRef] ?? 0)}%` : ""].filter(Boolean).join(" · ")} extra={<Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "markSuspectCommit", targets: phoneTargets(props) })}>标记根因</Button>}><div style={{ fontFamily: "monospace", fontSize: 12 }}>{String(row.values?.[hashRef] ?? "").slice(0, 8)}</div><div>{String(row.values?.[messageRef] ?? "未命名提交")}</div></List.Item>)}</List>}</PhoneShell>;
}

function PhoneConnectionTimeline(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const typeRef = phoneField(props, "typeFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const summaryRef = phoneField(props, "summaryFieldRef"); const recordsRef = phoneField(props, "recordsFieldRef"); const [scope, setScope] = React.useState("all");
  if (!bound || !typeRef || !statusRef || !timeRef) return <PhoneShell block={props.block} title={titleOf(props) || "连接时间线"} testid="phone-connection-timeline"><MobileEmpty description="连接时间线尚未绑定类型、状态和时间字段" /></PhoneShell>;
  const rows = [...bound.rows].sort((a, b) => phoneTime(b.values?.[timeRef]) - phoneTime(a.values?.[timeRef])).filter(row => scope === "all" || String(row.values?.[statusRef] ?? "") === scope);
  return <PhoneShell block={props.block} title={titleOf(props) || "连接时间线"} testid="phone-connection-timeline"><Segmented block value={scope} options={[{ label: `全部 ${bound.rows.length}`, value: "all" }, { label: "失败", value: "failed" }]} onChange={value => setScope(String(value))} /><List style={{ marginTop: 8 }}>{rows.map(row => { const status = String(row.values?.[statusRef] ?? ""); return <List.Item key={row.id} description={[summaryRef ? row.values?.[summaryRef] : "", row.values?.[timeRef], recordsRef ? `${String(row.values?.[recordsRef] ?? 0)} 条` : ""].filter(Boolean).join(" · ")} extra={status === "failed" ? <Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "retryConnectionJob", targets: phoneTargets(props) })}>重试</Button> : status}><strong>{String(row.values?.[typeRef] ?? "事件")}</strong></List.Item>; })}</List>{rows.length === 0 && <MobileEmpty description="当前范围没有连接事件" />}</PhoneShell>;
}

function PhoneSchemaChangeReview(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const streamRef = phoneField(props, "streamFieldRef"); const fieldNameRef = phoneField(props, "fieldNameFieldRef"); const changeRef = phoneField(props, "changeTypeFieldRef"); const beforeRef = phoneField(props, "beforeFieldRef"); const afterRef = phoneField(props, "afterFieldRef"); const breakingRef = phoneField(props, "breakingFieldRef");
  if (!bound || !streamRef || !fieldNameRef || !changeRef) return <PhoneShell block={props.block} title={titleOf(props) || "Schema 变更"} testid="phone-schema-change-review"><MobileEmpty description="Schema 审查尚未绑定数据流、字段和变更类型" /></PhoneShell>;
  const breaking = bound.rows.filter(row => breakingRef && phoneTruthy(row.values?.[breakingRef], "breaking"));
  return <PhoneShell block={props.block} title={titleOf(props) || `Schema 变更 · ${breaking.length} 项破坏性`} testid="phone-schema-change-review">{bound.rows.length === 0 ? <MobileEmpty description="没有待审查的 Schema 变更" /> : <><Collapse accordion>{bound.rows.map(row => { const dangerous = Boolean(breakingRef && phoneTruthy(row.values?.[breakingRef], "breaking")); return <Collapse.Panel key={row.id} title={`${dangerous ? "破坏性 · " : ""}${String(row.values?.[streamRef] ?? "")} / ${String(row.values?.[fieldNameRef] ?? "")}`}><div>{String(row.values?.[changeRef] ?? "变更")}</div><div style={{ color: "#666", marginTop: 6, overflowWrap: "anywhere" }}>{beforeRef ? String(row.values?.[beforeRef] ?? "-") : "-"} → {afterRef ? String(row.values?.[afterRef] ?? "-") : "-"}</div></Collapse.Panel>; })}</Collapse><Grid columns={2} gap={8} style={{ marginTop: 10 }}><Grid.Item><Button block onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "rejectSchemaChanges", rowIds: bound.rows.map(row => row.id), targets: phoneTargets(props) })}>暂不应用</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={breaking.length > 0 && props.block.props?.allowBreaking !== true} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "applySchemaChanges", rowIds: bound.rows.map(row => row.id), targets: phoneTargets(props) })}>应用安全变更</Button></Grid.Item></Grid></>}</PhoneShell>;
}

function PhoneStreamStatusMonitor(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const nameRef = phoneField(props, "nameFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const lastSyncRef = phoneField(props, "lastSyncFieldRef"); const freshnessRef = phoneField(props, "freshnessFieldRef"); const recordsRef = phoneField(props, "recordsFieldRef"); const errorRef = phoneField(props, "errorFieldRef");
  if (!bound || !nameRef || !statusRef) return <PhoneShell block={props.block} title={titleOf(props) || "数据流状态"} testid="phone-stream-status-monitor"><MobileEmpty description="数据流监控尚未绑定名称和状态字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "数据流状态"} testid="phone-stream-status-monitor">{bound.rows.length === 0 ? <MobileEmpty description="还没有数据流状态" /> : <List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => { const status = String(row.values?.[statusRef] ?? ""); return <List.Item key={row.id} description={<div>{[lastSyncRef ? row.values?.[lastSyncRef] : "", freshnessRef ? `新鲜度 ${String(row.values?.[freshnessRef] ?? "-")}` : "", recordsRef ? `${String(row.values?.[recordsRef] ?? 0)} 条` : ""].filter(Boolean).join(" · ")}{status === "failed" && errorRef && <div style={{ color: "#ff3141", marginTop: 4 }}>{String(row.values?.[errorRef] ?? "同步失败")}</div>}</div>} extra={status === "failed" ? <Button size="mini" onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "retryStream", targets: phoneTargets(props) })}>重试</Button> : status}><strong>{String(row.values?.[nameRef] ?? "未命名数据流")}</strong></List.Item>; })}</List>}</PhoneShell>;
}

function PhoneConnectionMappingPanel(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const sourceRef = phoneField(props, "sourceFieldRef"); const targetRef = phoneField(props, "targetFieldRef"); const transformRef = phoneField(props, "transformFieldRef"); const statusRef = phoneField(props, "statusFieldRef");
  if (!bound || !sourceRef || !targetRef) return <PhoneShell block={props.block} title={titleOf(props) || "字段映射"} testid="phone-connection-mapping-panel"><MobileEmpty description="字段映射尚未绑定来源和目标字段" /></PhoneShell>;
  const invalid = bound.rows.filter(row => statusRef && String(row.values?.[statusRef] ?? "") === "invalid");
  return <PhoneShell block={props.block} title={titleOf(props) || `字段映射 · ${invalid.length ? `${invalid.length} 项异常` : "有效"}`} testid="phone-connection-mapping-panel">{bound.rows.length === 0 ? <MobileEmpty description="还没有字段映射" /> : <><List mode="card" style={{ margin: 0 }}>{bound.rows.map(row => <List.Item key={row.id} description={transformRef ? String(row.values?.[transformRef] ?? "直接映射") : "直接映射"} extra={<Button size="mini" onClick={() => props.onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editConnectionMapping" })}>编辑</Button>}><div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "center", gap: 6, fontFamily: "monospace", fontSize: 12 }}><span style={{ overflowWrap: "anywhere" }}>{String(row.values?.[sourceRef] ?? "")}</span><span>→</span><span style={{ overflowWrap: "anywhere" }}>{String(row.values?.[targetRef] ?? "未映射")}</span></div></List.Item>)}</List><Button block color="primary" disabled={invalid.length > 0} style={{ marginTop: 10 }} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "saveConnectionMappings", rowIds: bound.rows.map(row => row.id), targets: phoneTargets(props) })}>保存映射</Button></>}</PhoneShell>;
}

function PhoneIssueCommandHeader(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const priorityRef = phoneField(props, "priorityFieldRef"); const assigneeRef = phoneField(props, "assigneeFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0]; const [archiveOpen, setArchiveOpen] = React.useState(false);
  if (!bound || !titleRef || !statusRef || !row) return <PhoneShell block={props.block} testid="phone-issue-command-header"><MobileEmpty description="问题操作区尚未绑定当前问题、标题和状态" /></PhoneShell>;
  const status = String(row.values?.[statusRef] ?? "unresolved"); const complete = ["resolved", "ignored", "archived"].includes(status); const submit = (operation: string) => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation, targets: phoneTargets(props) });
  return <PhoneShell block={props.block} testid="phone-issue-command-header"><strong style={{ fontSize: 16, overflowWrap: "anywhere" }}>{String(row.values?.[titleRef] ?? "未命名问题")}</strong><div style={{ color: "#666", fontSize: 12, margin: "6px 0 10px" }}>{[status, priorityRef ? row.values?.[priorityRef] : "", assigneeRef ? `负责人 ${String(row.values?.[assigneeRef] ?? "未分配")}` : ""].filter(Boolean).join(" · ")}</div>{complete ? <Button block color="primary" onClick={() => submit("reopenIssue")}>重新打开</Button> : <Grid columns={2} gap={8}><Grid.Item><Button block onClick={() => setArchiveOpen(true)}>归档</Button></Grid.Item><Grid.Item><Button block color="primary" onClick={() => submit("resolveIssue")}>解决</Button></Grid.Item></Grid>}<Popup visible={archiveOpen} onMaskClick={() => setArchiveOpen(false)} bodyStyle={{ padding: 16 }}><strong>确认归档问题？</strong><div style={{ color: "#666", margin: "8px 0 12px" }}>归档后将从活动问题中移除。</div><Button block color="danger" onClick={() => { submit("archiveIssue"); setArchiveOpen(false); }}>确认归档</Button></Popup></PhoneShell>;
}

function PhoneConnectionControlHeader(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const syncRef = phoneField(props, "syncStatusFieldRef"); const scheduleRef = phoneField(props, "scheduleFieldRef"); const breakingRef = phoneField(props, "breakingFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows[0]; const [cancelOpen, setCancelOpen] = React.useState(false);
  if (!bound || !titleRef || !statusRef || !syncRef || !row) return <PhoneShell block={props.block} testid="phone-connection-control-header"><MobileEmpty description="连接控制尚未绑定标题、连接状态和同步状态" /></PhoneShell>;
  const status = String(row.values?.[statusRef] ?? "inactive"); const sync = String(row.values?.[syncRef] ?? "idle"); const running = sync === "running"; const locked = status === "locked"; const breaking = Boolean(breakingRef && phoneTruthy(row.values?.[breakingRef], "breaking")); const action = (operation: string) => props.onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId: row.id, operation, targets: phoneTargets(props) });
  return <PhoneShell block={props.block} testid="phone-connection-control-header"><strong style={{ fontSize: 16 }}>{String(row.values?.[titleRef] ?? "未命名连接")}</strong><div style={{ color: "#666", fontSize: 12, margin: "6px 0 10px" }}>{[status, sync, scheduleRef ? `计划 ${String(row.values?.[scheduleRef] ?? "手动")}` : ""].filter(Boolean).join(" · ")}</div>{breaking && <div style={{ background: "#fff7e6", color: "#ad6800", padding: 8, borderRadius: 6, marginBottom: 8 }}>存在破坏性 Schema 变更，暂不能启用或同步</div>}<Grid columns={2} gap={8}><Grid.Item><Button block disabled={locked || breaking || running} onClick={() => action(status === "active" ? "disableConnection" : "enableConnection")}>{status === "active" ? "停用连接" : "启用连接"}</Button></Grid.Item><Grid.Item>{running ? <Button block color="danger" onClick={() => setCancelOpen(true)}>取消运行</Button> : <Button block color="primary" disabled={status !== "active" || breaking} onClick={() => action("startConnectionSync")}>立即同步</Button>}</Grid.Item></Grid><Popup visible={cancelOpen} onMaskClick={() => setCancelOpen(false)} bodyStyle={{ padding: 16 }}><strong>确认取消当前运行任务？</strong><Button block color="danger" style={{ marginTop: 12 }} onClick={() => { action("cancelConnectionJob"); setCancelOpen(false); }}>确认取消</Button></Popup></PhoneShell>;
}

function PhoneEventUserCountMetrics(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const eventRef = phoneField(props, "eventCountFieldRef"); const userRef = phoneField(props, "userCountFieldRef"); const row = bound?.rows[0];
  if (!bound || !eventRef || !userRef || !row) return <PhoneShell block={props.block} title={titleOf(props) || "问题影响"} testid="phone-event-user-count-metrics"><MobileEmpty description="影响指标尚未绑定事件数和用户数字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "问题影响"} testid="phone-event-user-count-metrics"><Grid columns={2} gap={8}><Grid.Item><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }}><div style={{ color: "#666", fontSize: 12 }}>事件总数</div><strong style={{ fontSize: 22 }}>{Number(row.values?.[eventRef] ?? 0).toLocaleString()}</strong></div></Grid.Item><Grid.Item><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }}><div style={{ color: "#666", fontSize: 12 }}>受影响用户</div><strong style={{ fontSize: 22 }}>{Number(row.values?.[userRef] ?? 0).toLocaleString()}</strong></div></Grid.Item></Grid></PhoneShell>;
}

function PhoneJobRunMetrics(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const bytesRef = phoneField(props, "bytesFieldRef"); const recordsRef = phoneField(props, "recordsFieldRef"); const rejectedRef = phoneField(props, "rejectedFieldRef"); const durationRef = phoneField(props, "durationFieldRef"); const attemptsRef = phoneField(props, "attemptsFieldRef"); const row = bound?.rows[0];
  if (!bound || !recordsRef || !durationRef || !row) return <PhoneShell block={props.block} title={titleOf(props) || "运行指标"} testid="phone-job-run-metrics"><MobileEmpty description="运行指标尚未绑定记录数和耗时字段" /></PhoneShell>;
  const bytes = bytesRef ? Number(row.values?.[bytesRef] ?? 0) : 0; const items = [["已加载记录", Number(row.values?.[recordsRef] ?? 0).toLocaleString()], ...(bytesRef ? [["数据量", bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`]] : []), ...(rejectedRef ? [["拒绝记录", String(row.values?.[rejectedRef] ?? 0)]] : []), ["耗时", String(row.values?.[durationRef] ?? "-")], ...(attemptsRef ? [["尝试次数", String(row.values?.[attemptsRef] ?? 1)]] : [])];
  return <PhoneShell block={props.block} title={titleOf(props) || "运行指标"} testid="phone-job-run-metrics"><Grid columns={2} gap={8}>{items.map(([label, value]) => <Grid.Item key={label}><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }}><div style={{ color: "#666", fontSize: 12 }}>{label}</div><strong style={{ fontSize: 18 }}>{value}</strong></div></Grid.Item>)}</Grid></PhoneShell>;
}

function PhoneOccurrenceEvidenceSummary(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const row = bound?.rows[0]; const fields = [["环境", phoneField(props, "environmentFieldRef")], ["状态码", phoneField(props, "statusCodeFieldRef")], ["失败原因", phoneField(props, "reasonFieldRef")], ["上次成功", phoneField(props, "lastSuccessFieldRef")], ["中断时长", phoneField(props, "downtimeFieldRef")]] as const;
  if (!bound || !row || fields.every(([, ref]) => !ref)) return <PhoneShell block={props.block} title={titleOf(props) || "发生摘要"} testid="phone-occurrence-evidence-summary"><MobileEmpty description="发生摘要尚未绑定证据字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "发生摘要"} testid="phone-occurrence-evidence-summary"><List mode="card" style={{ margin: 0 }}>{fields.flatMap(([label, ref]) => ref ? [<List.Item key={label} extra={<span style={{ maxWidth: 150, overflowWrap: "anywhere", textAlign: "right" }}>{String(row.values?.[ref] ?? "-")}</span>}>{label}</List.Item>] : [])}</List></PhoneShell>;
}

function PhoneConnectionRouteSummary(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const sourceRef = phoneField(props, "sourceFieldRef"); const targetRef = phoneField(props, "targetFieldRef"); const sourceVersionRef = phoneField(props, "sourceVersionFieldRef"); const targetVersionRef = phoneField(props, "targetVersionFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const row = bound?.rows[0];
  if (!bound || !sourceRef || !targetRef || !row) return <PhoneShell block={props.block} title={titleOf(props) || "连接路径"} testid="phone-connection-route-summary"><MobileEmpty description="连接路径尚未绑定来源和目标字段" /></PhoneShell>;
  return <PhoneShell block={props.block} title={titleOf(props) || "连接路径"} testid="phone-connection-route-summary"><div style={{ color: "#666", fontSize: 12, marginBottom: 8 }}>{statusRef ? String(row.values?.[statusRef] ?? "") : ""}</div><Grid columns={3} gap={6}><Grid.Item span={1}><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6, overflowWrap: "anywhere" }}><small>来源</small><div><strong>{String(row.values?.[sourceRef] ?? "-")}</strong></div>{sourceVersionRef && <small>{String(row.values?.[sourceVersionRef] ?? "")}</small>}</div></Grid.Item><Grid.Item><div style={{ textAlign: "center", paddingTop: 22 }}>→</div></Grid.Item><Grid.Item><div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6, overflowWrap: "anywhere" }}><small>目标</small><div><strong>{String(row.values?.[targetRef] ?? "-")}</strong></div>{targetVersionRef && <small>{String(row.values?.[targetVersionRef] ?? "")}</small>}</div></Grid.Item></Grid></PhoneShell>;
}

function PhoneResourceDetailTabs(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const keyRef = phoneField(props, "keyFieldRef"); const availableRef = phoneField(props, "availableFieldRef"); const countRef = phoneField(props, "countFieldRef"); const [active, setActive] = React.useState("");
  if (!bound || !titleRef || !keyRef) return <PhoneShell block={props.block} testid="phone-resource-detail-tabs"><MobileEmpty description="资源页签尚未绑定标题和稳定键" /></PhoneShell>; const rows = bound.rows.filter(row => String(row.values?.[keyRef] ?? "")); const usable = rows.filter(row => !availableRef || ![false, "false", "disabled"].includes(row.values?.[availableRef] as never)); const selected = usable.some(row => String(row.values?.[keyRef]) === active) ? active : String(usable[0]?.values?.[keyRef] ?? "");
  return <PhoneShell block={props.block} testid="phone-resource-detail-tabs"><Tabs activeKey={selected} onChange={key => { setActive(key); const row = rows.find(item => String(item.values?.[keyRef]) === key); props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row?.id, sectionKey: key, targets: phoneTargets(props) }); }}>{rows.map(row => <Tabs.Tab key={String(row.values?.[keyRef])} title={`${String(row.values?.[titleRef] ?? "未命名")}${countRef ? ` ${String(row.values?.[countRef] ?? 0)}` : ""}`} disabled={Boolean(availableRef && [false, "false", "disabled"].includes(row.values?.[availableRef] as never))} />)}</Tabs></PhoneShell>;
}

function PhoneInspectorModeTabs(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const keyRef = phoneField(props, "keyFieldRef"); const titleRef = phoneField(props, "titleFieldRef"); const enabledRef = phoneField(props, "enabledFieldRef"); const issueRef = phoneField(props, "issueCountFieldRef"); const [active, setActive] = React.useState("");
  if (!bound || !keyRef || !titleRef) return <PhoneShell block={props.block} testid="phone-inspector-mode-tabs"><MobileEmpty description="检查器页签尚未绑定模式键和标题" /></PhoneShell>; const rows = bound.rows.filter(row => String(row.values?.[keyRef] ?? "")); const usable = rows.filter(row => !enabledRef || ![false, "false", "disabled"].includes(row.values?.[enabledRef] as never)); const selected = usable.some(row => String(row.values?.[keyRef]) === active) ? active : String(usable[0]?.values?.[keyRef] ?? "");
  return <PhoneShell block={props.block} testid="phone-inspector-mode-tabs"><Tabs activeKey={selected} onChange={key => { setActive(key); props.onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: rows.find(row => String(row.values?.[keyRef]) === key)?.id, mode: key }); }}>{rows.map(row => <Tabs.Tab key={String(row.values?.[keyRef])} title={`${String(row.values?.[titleRef] ?? "模式")}${issueRef && Number(row.values?.[issueRef] ?? 0) ? ` ${String(row.values?.[issueRef])}` : ""}`} disabled={Boolean(enabledRef && [false, "false", "disabled"].includes(row.values?.[enabledRef] as never))} />)}</Tabs></PhoneShell>;
}

function PhoneIssueEventFilter(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const environmentRef = phoneField(props, "environmentFieldRef"); const [environment, setEnvironment] = React.useState("all"); const [period, setPeriod] = React.useState("24h"); const [query, setQuery] = React.useState("");
  if (!bound || !environmentRef) return <PhoneShell block={props.block} title={titleOf(props) || "事件筛选"} testid="phone-issue-event-filter"><MobileEmpty description="事件筛选尚未绑定环境字段" /></PhoneShell>; const environments = Array.from(new Set(bound.rows.map(row => String(row.values?.[environmentRef] ?? "")).filter(Boolean))); const emit = (next: Record<string, unknown>) => props.onAction?.("filterChange", { environment, period, query: query.trim(), ...next, targets: phoneTargets(props) });
  return <PhoneShell block={props.block} title={titleOf(props) || "事件筛选"} testid="phone-issue-event-filter"><Selector columns={2} value={[environment]} options={[{ label: "全部环境", value: "all" }, ...environments.map(value => ({ label: value, value }))]} onChange={values => { const value = String(values[0] ?? "all"); setEnvironment(value); emit({ environment: value }); }} /><Segmented block value={period} options={[{ label: "1h", value: "1h" }, { label: "24h", value: "24h" }, { label: "7d", value: "7d" }, { label: "首次以来", value: "sinceFirst" }]} onChange={value => { setPeriod(String(value)); emit({ period: String(value) }); }} style={{ marginTop: 8 }} /><SearchBar value={query} onChange={setQuery} onSearch={value => emit({ query: value.trim() })} placeholder="输入字段:值查询" style={{ marginTop: 8 }} /></PhoneShell>;
}

function PhoneTimelineFilterBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const typeRef = phoneField(props, "typeFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const timeRef = phoneField(props, "timeFieldRef"); const [type, setType] = React.useState("all"); const [status, setStatus] = React.useState("all"); const [range, setRange] = React.useState<[Date, Date] | null>(null); const [calendarOpen, setCalendarOpen] = React.useState(false);
  if (!bound || !typeRef || !statusRef || !timeRef) return <PhoneShell block={props.block} title={titleOf(props) || "时间线筛选"} testid="phone-timeline-filter-bar"><MobileEmpty description="时间线筛选尚未绑定类型、状态和时间字段" /></PhoneShell>; const types = Array.from(new Set(bound.rows.map(row => String(row.values?.[typeRef] ?? "")).filter(Boolean))); const statuses = Array.from(new Set(bound.rows.map(row => String(row.values?.[statusRef] ?? "")).filter(Boolean))); const supportsStatus = ["all", "sync", "clear", "refresh"].includes(type); const emit = (next: Record<string, unknown>) => props.onAction?.("filterChange", { eventType: type, status, dateRange: range?.map(value => value.toISOString().slice(0, 10)) ?? null, ...next, targets: phoneTargets(props) });
  return <PhoneShell block={props.block} title={titleOf(props) || "时间线筛选"} testid="phone-timeline-filter-bar"><Selector columns={2} value={[type]} options={[{ label: "全部类型", value: "all" }, ...types.map(value => ({ label: value, value }))]} onChange={values => { const value = String(values[0] ?? "all"); setType(value); if (!["all", "sync", "clear", "refresh"].includes(value)) setStatus("all"); emit({ eventType: value, status: ["all", "sync", "clear", "refresh"].includes(value) ? status : "all" }); }} /><Selector columns={2} value={[supportsStatus ? status : "all"]} options={[{ label: "全部状态", value: "all" }, ...statuses.map(value => ({ label: value, value, disabled: !supportsStatus }))]} onChange={values => { const value = String(values[0] ?? "all"); setStatus(value); emit({ status: value }); }} style={{ marginTop: 8 }} /><Grid columns={2} gap={8} style={{ marginTop: 8 }}><Grid.Item><Button block onClick={() => setCalendarOpen(true)}>{range ? `${range[0].toISOString().slice(5, 10)} 至 ${range[1].toISOString().slice(5, 10)}` : "选择日期"}</Button></Grid.Item><Grid.Item><Button block disabled={type === "all" && status === "all" && !range} onClick={() => { setType("all"); setStatus("all"); setRange(null); emit({ eventType: "all", status: "all", dateRange: null }); }}>清除</Button></Grid.Item></Grid><CalendarPicker selectionMode="range" visible={calendarOpen} value={range} onClose={() => setCalendarOpen(false)} onConfirm={value => { const next = value?.[0] && value?.[1] ? [value[0], value[1]] as [Date, Date] : null; setRange(next); setCalendarOpen(false); emit({ dateRange: next?.map(item => item.toISOString().slice(0, 10)) ?? null }); }} /></PhoneShell>;
}

function PhoneUnsavedChangesBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const fieldRef = phoneField(props, "fieldNameFieldRef"); const validRef = phoneField(props, "validFieldRef"); const [discardOpen, setDiscardOpen] = React.useState(false); const dirty = bound?.rows ?? []; const invalid = validRef ? dirty.filter(row => [false, "false", "invalid"].includes(row.values?.[validRef] as never)) : [];
  if (!bound || !fieldRef) return <PhoneShell block={props.block} testid="phone-unsaved-changes-bar"><MobileEmpty description="未保存变更栏尚未绑定变更字段" /></PhoneShell>;
  return <PhoneShell block={props.block} testid="phone-unsaved-changes-bar"><div style={{ marginBottom: 8 }}><strong>{dirty.length ? `${dirty.length} 项未保存变更` : "没有未保存变更"}</strong>{invalid.length > 0 && <div style={{ color: "#ff3141", fontSize: 12 }}>{invalid.length} 项校验未通过</div>}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!dirty.length} onClick={() => setDiscardOpen(true)}>放弃</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!dirty.length || invalid.length > 0} onClick={() => props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "saveChanges", rowIds: dirty.map(row => row.id), targets: phoneTargets(props) })}>保存变更</Button></Grid.Item></Grid><Popup visible={discardOpen} onMaskClick={() => setDiscardOpen(false)} bodyStyle={{ padding: 16 }}><strong>确认放弃本地变更？</strong><Button block color="danger" style={{ marginTop: 12 }} onClick={() => { props.onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "discardChanges", rowIds: dirty.map(row => row.id), targets: phoneTargets(props) }); setDiscardOpen(false); }}>确认放弃</Button></Popup></PhoneShell>;
}

function PhoneRunningJobControlBar(props: ExperienceBlockRendererProps) {
  const bound = phoneRows(props); const titleRef = phoneField(props, "titleFieldRef"); const statusRef = phoneField(props, "statusFieldRef"); const progressRef = phoneField(props, "progressFieldRef"); const typeRef = phoneField(props, "typeFieldRef"); const row = bound?.rows.find(item => item.id === props.focus?.[bound.entityRef]) ?? bound?.rows.find(item => String(item.values?.[statusRef ?? ""]) === "running") ?? bound?.rows[0]; const [cancelOpen, setCancelOpen] = React.useState(false);
  if (!bound || !titleRef || !statusRef || !row) return <PhoneShell block={props.block} testid="phone-running-job-control-bar"><MobileEmpty description="运行任务栏尚未绑定任务标题和状态" /></PhoneShell>; const status = String(row.values?.[statusRef] ?? ""); const running = status === "running"; const failed = ["failed", "incomplete", "cancelled"].includes(status); const submit = (operation: string) => props.onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation, targets: phoneTargets(props) });
  return <PhoneShell block={props.block} testid="phone-running-job-control-bar"><div><strong>{String(row.values?.[titleRef] ?? "未命名任务")}</strong><span style={{ color: "#666", marginLeft: 6 }}>{typeRef ? String(row.values?.[typeRef] ?? "") : ""} · {status}</span></div>{progressRef && <ProgressBar percent={Math.max(0, Math.min(100, Number(row.values?.[progressRef] ?? 0)))} style={{ margin: "8px 0" }} />}{running ? <Button block color="danger" onClick={() => setCancelOpen(true)}>取消任务</Button> : failed ? <Button block color="primary" onClick={() => submit("retryJob")}>重试任务</Button> : <div style={{ color: "#00b578", marginTop: 8 }}>任务已完成</div>}<Popup visible={cancelOpen} onMaskClick={() => setCancelOpen(false)} bodyStyle={{ padding: 16 }}><strong>确认取消当前运行任务？</strong><div style={{ color: "#666", margin: "8px 0 12px" }}>已处理的数据不会自动回滚。</div><Button block color="danger" onClick={() => { submit("cancelRunningJob"); setCancelOpen(false); }}>确认取消</Button></Popup></PhoneShell>;
}

function PhoneBookingCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),s=phoneField(props,"statusFieldRef"),start=phoneField(props,"startFieldRef"),end=phoneField(props,"endFieldRef"),loc=phoneField(props,"locationFieldRef"),rec=phoneField(props,"recurringFieldRef"),paidRef=phoneField(props,"paidFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];const[confirm,setConfirm]=React.useState("");if(!b||!t||!s||!start||!r)return <PhoneShell block={props.block} testid="phone-booking-command-header"><MobileEmpty description="预约操作页头尚未绑定标题、状态和开始时间"/></PhoneShell>;const status=String(r.values?.[s]??"PENDING"),past=phoneTime(r.values?.[end??start])<Date.now(),recurring=Boolean(rec&&phoneTruthy(r.values?.[rec],"recurring")),paid=!paidRef||phoneTruthy(r.values?.[paidRef],"paid"),submit=(op:string)=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:op,scope:recurring?"series":"single",targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-booking-command-header"><strong>{String(r.values?.[t]??"未命名预约")}</strong><div style={{fontSize:12,color:"#666",margin:"6px 0 10px"}}>{status} · {String(r.values?.[start]??"")}{loc?` · ${String(r.values?.[loc]??"")}`:""}</div>{status==="PENDING"&&!past?<Grid columns={2} gap={8}><Grid.Item><Button block color="danger" onClick={()=>setConfirm("rejectBooking")}>拒绝</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!paid} onClick={()=>submit("confirmBooking")}>确认预约</Button></Grid.Item></Grid>:status==="ACCEPTED"&&!past?<Grid columns={2} gap={8}><Grid.Item><Button block onClick={()=>props.onAction?.("editRequest",{entityRef:b.entityRef,rowId:r.id,operation:"rescheduleBooking"})}>改期</Button></Grid.Item><Grid.Item><Button block color="danger" onClick={()=>setConfirm("cancelBooking")}>取消</Button></Grid.Item></Grid>:status==="ACCEPTED"&&past?<Button block onClick={()=>submit("toggleNoShow")}>标记未到场</Button>:<div style={{color:"#999"}}>当前状态无可用操作</div>}{status==="PENDING"&&!paid&&<div style={{color:"#ff8f1f",fontSize:12,marginTop:6}}>付款尚未完成，暂不能确认</div>}<Popup visible={Boolean(confirm)} onMaskClick={()=>setConfirm("")} bodyStyle={{padding:16}}><strong>确认执行此预约操作？</strong><Button block color="danger" style={{marginTop:12}} onClick={()=>{submit(confirm);setConfirm("")}}>确认</Button></Popup></PhoneShell>}

function PhoneAlertRuleCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),s=phoneField(props,"stateFieldRef"),editable=phoneField(props,"editableFieldRef"),prov=phoneField(props,"provisionedFieldRef"),silence=phoneField(props,"silenceableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];const[more,setMore]=React.useState(false);if(!b||!t||!s||!r)return <PhoneShell block={props.block} testid="phone-alert-rule-command-header"><MobileEmpty description="告警规则操作尚未绑定标题和状态"/></PhoneShell>;const state=String(r.values?.[s]??"active"),canEdit=!editable||!([false,"false","readonly"].includes(r.values?.[editable] as never)),managed=Boolean(prov&&phoneTruthy(r.values?.[prov],"provisioned")),canSilence=!silence||!([false,"false","disabled"].includes(r.values?.[silence] as never)),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-alert-rule-command-header"><strong>{String(r.values?.[t]??"未命名规则")}</strong><div style={{fontSize:12,color:"#666",margin:"6px 0 10px"}}>{state}{managed?" · 受管规则":""}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!canEdit||managed} onClick={()=>act("editAlertRule","editRequest")}>编辑</Button></Grid.Item><Grid.Item><Button block onClick={()=>setMore(true)}>更多操作</Button></Grid.Item></Grid><Popup visible={more} onMaskClick={()=>setMore(false)} bodyStyle={{padding:16}}><Space direction="vertical" block><Button block onClick={()=>act("duplicateAlertRule")}>复制</Button><Button block disabled={!canSilence} onClick={()=>act("silenceAlertRule")}>静默</Button><Button block onClick={()=>act(state==="paused"?"resumeAlertRule":"pauseAlertRule")}>{state==="paused"?"恢复":"暂停"}</Button><Button block color="danger" disabled={!canEdit||managed} onClick={()=>act("deleteAlertRule","submitRequest")}>删除</Button></Space></Popup></PhoneShell>}

function PhoneAlertStateMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),s=phoneField(props,"stateFieldRef"),rule=phoneField(props,"ruleIdFieldRef");if(!b||!s||!rule)return <PhoneShell block={props.block} title={titleOf(props)||"告警状态"} testid="phone-alert-state-metrics"><MobileEmpty description="告警状态指标尚未绑定状态和规则字段"/></PhoneShell>;const c=(x:string)=>b.rows.filter(r=>String(r.values?.[s])===x),u=(x:string)=>new Set(c(x).map(r=>String(r.values?.[rule]))).size,items=[["触发规则",u("firing")],["触发实例",c("firing").length],["等待规则",u("pending")],["等待实例",c("pending").length]];return <PhoneShell block={props.block} title={titleOf(props)||"告警状态"} testid="phone-alert-state-metrics"><Grid columns={2} gap={8}>{items.map(([l,v])=><Grid.Item key={l}><div style={{background:"#f5f5f5",padding:10,borderRadius:6}}><small>{l}</small><div><strong style={{fontSize:20}}>{v}</strong></div></div></Grid.Item>)}</Grid></PhoneShell>}

function PhoneBookingCapacityMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),cap=phoneField(props,"capacityFieldRef"),book=phoneField(props,"bookedFieldRef"),no=phoneField(props,"noShowFieldRef"),wait=phoneField(props,"waitlistFieldRef"),r=b?.rows[0];if(!b||!cap||!book||!r)return <PhoneShell block={props.block} title={titleOf(props)||"预约容量"} testid="phone-booking-capacity-metrics"><MobileEmpty description="预约容量尚未绑定容量和已预约字段"/></PhoneShell>;const total=Number(r.values?.[cap]??0),used=Number(r.values?.[book]??0),items=[["总席位",total],["已预约",used],["剩余",Math.max(0,total-used)],...(no?[["未到场",Number(r.values?.[no]??0)]]:[]),...(wait?[["候补",Number(r.values?.[wait]??0)]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"预约容量"} testid="phone-booking-capacity-metrics"><Grid columns={2} gap={8}>{items.map(([l,v])=><Grid.Item key={l}><div style={{background:"#f5f5f5",padding:10,borderRadius:6}}><small>{l}</small><div><strong style={{fontSize:20}}>{v}</strong></div></div></Grid.Item>)}</Grid><ProgressBar percent={total?Math.min(100,Math.round(used/total*100)):0} style={{marginTop:10}}/></PhoneShell>}

function PhoneBookingContextSummary(props:ExperienceBlockRendererProps){const b=phoneRows(props),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],fields=[["主题",phoneField(props,"titleFieldRef")],["开始",phoneField(props,"startFieldRef")],["结束",phoneField(props,"endFieldRef")],["时区",phoneField(props,"timezoneFieldRef")],["地点",phoneField(props,"locationFieldRef")],["参与人",phoneField(props,"attendeeFieldRef")],["重复规则",phoneField(props,"recurringFieldRef")]] as const;if(!b||!r||!fields[0][1]||!fields[1][1])return <PhoneShell block={props.block} title={titleOf(props)||"预约上下文"} testid="phone-booking-context-summary"><MobileEmpty description="预约上下文尚未绑定标题和开始时间"/></PhoneShell>;return <PhoneShell block={props.block} title={titleOf(props)||"预约上下文"} testid="phone-booking-context-summary"><List mode="card" style={{margin:0}}>{fields.flatMap(([l,f])=>f?[<List.Item key={l} extra={<span style={{maxWidth:150,textAlign:"right",overflowWrap:"anywhere"}}>{String(r.values?.[f]??"-")}</span>}>{l}</List.Item>]:[])}</List></PhoneShell>}

function PhoneAlertInstanceSummary(props:ExperienceBlockRendererProps){const b=phoneRows(props),name=phoneField(props,"nameFieldRef"),value=phoneField(props,"valueFieldRef"),labels=phoneField(props,"labelsFieldRef"),summary=phoneField(props,"summaryFieldRef"),started=phoneField(props,"startedFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!name||!value||!r)return <PhoneShell block={props.block} title={titleOf(props)||"告警实例"} testid="phone-alert-instance-summary"><MobileEmpty description="告警实例摘要尚未绑定名称和当前值"/></PhoneShell>;return <PhoneShell block={props.block} title={titleOf(props)||"告警实例"} testid="phone-alert-instance-summary"><div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong>{String(r.values?.[name]??"")}</strong><span style={{color:"#ff3141"}}>{String(r.values?.[value]??"")}</span></div>{summary&&<div style={{marginTop:8}}>{String(r.values?.[summary]??"")}</div>}{labels&&<div style={{fontSize:12,color:"#666",overflowWrap:"anywhere",marginTop:8}}>{String(r.values?.[labels]??"")}</div>}{started&&<div style={{fontSize:12,color:"#999",marginTop:6}}>开始于 {String(r.values?.[started]??"")}</div>}</PhoneShell>}

function PhoneBookingStatusTabs(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),key=phoneField(props,"keyFieldRef"),count=phoneField(props,"countFieldRef"),enabled=phoneField(props,"enabledFieldRef");const[active,setActive]=React.useState(String(props.block.props?.defaultKey??"upcoming"));if(!b||!t||!key)return <PhoneShell block={props.block} testid="phone-booking-status-tabs"><MobileEmpty description="预约页签尚未绑定标题和状态键"/></PhoneShell>;const selected=b.rows.some(x=>String(x.values?.[key])===active)?active:String(b.rows[0]?.values?.[key]??"");return <PhoneShell block={props.block} testid="phone-booking-status-tabs"><Tabs activeKey={selected} onChange={v=>{setActive(v);const r=b.rows.find(x=>String(x.values?.[key])===v);props.onAction?.("filterChange",{entityRef:b.entityRef,rowId:r?.id,statusKey:v,preserveExistingFilters:true,targets:phoneTargets(props)})}}>{b.rows.map(r=><Tabs.Tab key={String(r.values?.[key])} title={`${String(r.values?.[t]??"")}${count?` ${String(r.values?.[count]??0)}`:""}`} disabled={Boolean(enabled&&[false,"false","disabled"].includes(r.values?.[enabled] as never))}/>)}</Tabs></PhoneShell>}

function PhoneValidatedFormTabs(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),key=phoneField(props,"keyFieldRef"),err=phoneField(props,"errorCountFieldRef"),dirty=phoneField(props,"dirtyCountFieldRef");const[active,setActive]=React.useState("");if(!b||!t||!key||!err)return <PhoneShell block={props.block} testid="phone-validated-form-tabs"><MobileEmpty description="表单页签尚未绑定标题、键和错误数"/></PhoneShell>;const selected=b.rows.some(x=>String(x.values?.[key])===active)?active:String(b.rows[0]?.values?.[key]??"");return <PhoneShell block={props.block} testid="phone-validated-form-tabs"><Tabs activeKey={selected} onChange={v=>{setActive(v);const r=b.rows.find(x=>String(x.values?.[key])===v);props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r?.id,tabKey:v,targets:phoneTargets(props)})}}>{b.rows.map(r=>{const e=Number(r.values?.[err]??0),d=dirty?Number(r.values?.[dirty]??0):0;return <Tabs.Tab key={String(r.values?.[key])} title={`${String(r.values?.[t]??"")}${e?` 错误${e}`:d?` ${d}`:""}`}/>})}</Tabs></PhoneShell>}

function PhoneAlertMatcherFilter(props:ExperienceBlockRendererProps){const[q,setQ]=React.useState(String(props.block.props?.defaultQuery??"")),trim=q.trim().replace(/^\{|\}$/g,""),parts=trim?trim.split(",").map(x=>x.trim()):[],valid=!trim||parts.every(x=>/^[A-Za-z_][\w.-]*\s*(=~|!~|!=|=)\s*"[^"]*"$/.test(x)&&!/[=!~]\s+"/.test(x));return <PhoneShell block={props.block} title={titleOf(props)||"标签匹配"} testid="phone-alert-matcher-filter"><Input value={q} onChange={setQ} placeholder={'severity="critical"'} style={{padding:10,background:"#f5f5f5",borderRadius:6}}/>{!valid&&<div style={{color:"#ff3141",fontSize:12,marginTop:6}}>表达式无效，值必须使用双引号</div>}<Button block color="primary" disabled={!valid} style={{marginTop:8}} onClick={()=>props.onAction?.("filterChange",{matcherQuery:trim,matchers:parts,targets:phoneTargets(props)})}>应用标签匹配</Button></PhoneShell>}

function PhoneBookingDirectoryFilter(props:ExperienceBlockRendererProps){const b=phoneRows(props),type=phoneField(props,"typeFieldRef"),key=phoneField(props,"keyFieldRef"),title=phoneField(props,"titleFieldRef"),[selected,setSelected]=React.useState<Record<string,string[]>>({}),[query,setQuery]=React.useState(""),[range,setRange]=React.useState<[Date,Date]|null>(null),[calendar,setCalendar]=React.useState(false);if(!b||!type||!key||!title)return <PhoneShell block={props.block} title={titleOf(props)||"预约目录筛选"} testid="phone-booking-directory-filter"><MobileEmpty description="预约目录筛选尚未绑定类型、键和标题"/></PhoneShell>;const types=Array.from(new Set(b.rows.map(x=>String(x.values?.[type]??"")).filter(Boolean))),emit=(next:Record<string,unknown>)=>props.onAction?.("filterChange",{facets:selected,attendeeQuery:query.trim(),dateRange:range?.map(x=>x.toISOString().slice(0,10))??null,...next,targets:phoneTargets(props)});return <PhoneShell block={props.block} title={titleOf(props)||"预约目录筛选"} testid="phone-booking-directory-filter">{types.map(v=><div key={v} style={{marginBottom:8}}><small>{v}</small><Selector columns={2} multiple value={selected[v]??[]} options={b.rows.filter(x=>String(x.values?.[type])===v).map(x=>({value:String(x.values?.[key]),label:String(x.values?.[title])}))} onChange={vals=>{const next={...selected,[v]:vals.map(String)};setSelected(next);emit({facets:next})}}/></div>)}<SearchBar value={query} onChange={setQuery} onSearch={v=>emit({attendeeQuery:v.trim()})} placeholder="姓名、邮箱或预约 UID"/><Button block style={{marginTop:8}} onClick={()=>setCalendar(true)}>{range?`${range[0].toISOString().slice(5,10)} 至 ${range[1].toISOString().slice(5,10)}`:"选择日期范围"}</Button><CalendarPicker visible={calendar} selectionMode="range" value={range} onClose={()=>setCalendar(false)} onConfirm={v=>{const next=v?.[0]&&v?.[1]?[v[0],v[1]] as [Date,Date]:null;setRange(next);setCalendar(false);emit({dateRange:next?.map(x=>x.toISOString().slice(0,10))??null})}}/></PhoneShell>}

function PhoneBookingDecisionBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),s=phoneField(props,"statusFieldRef"),paidRef=phoneField(props,"paidFieldRef"),rec=phoneField(props,"recurringFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[open,setOpen]=React.useState(false),[reason,setReason]=React.useState("");if(!b||!t||!s||!r)return <PhoneShell block={props.block} testid="phone-booking-decision-bar"><MobileEmpty description="预约决策栏尚未绑定标题和状态"/></PhoneShell>;const pending=String(r.values?.[s])==="PENDING",paid=!paidRef||phoneTruthy(r.values?.[paidRef],"paid"),scope=rec&&phoneTruthy(r.values?.[rec],"recurring")?"series":"single",submit=(decision:string,extra={})=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,decision,scope,...extra,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-booking-decision-bar"><div style={{marginBottom:8}}><strong>{String(r.values?.[t]??"预约")}</strong><span style={{color:"#666"}}> · {pending?"待确认":"已处理"}</span></div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!pending} onClick={()=>setOpen(true)}>拒绝</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!pending||!paid} onClick={()=>submit("confirm")}>确认</Button></Grid.Item></Grid><Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:16}}><strong>填写拒绝原因</strong><TextArea value={reason} onChange={setReason} rows={3} style={{margin:"10px 0"}}/><Button block color="danger" disabled={!reason.trim()} onClick={()=>{submit("reject",{reason:reason.trim()});setOpen(false)}}>确认拒绝</Button></Popup></PhoneShell>}

function PhoneDashboardSaveBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),dirtyRef=phoneField(props,"dirtyFieldRef"),canRef=phoneField(props,"canSaveFieldRef"),managedRef=phoneField(props,"managedFieldRef"),templateRef=phoneField(props,"templateFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[more,setMore]=React.useState(false);if(!b||!t||!dirtyRef||!r)return <PhoneShell block={props.block} testid="phone-dashboard-save-bar"><MobileEmpty description="Dashboard 保存栏尚未绑定标题和脏状态"/></PhoneShell>;const dirty=phoneTruthy(r.values?.[dirtyRef],"dirty"),can=!canRef||!([false,"false","denied"].includes(r.values?.[canRef] as never)),managed=Boolean(managedRef&&phoneTruthy(r.values?.[managedRef],"managed")),template=Boolean(templateRef&&phoneTruthy(r.values?.[templateRef],"template")),act=(op:string)=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-dashboard-save-bar"><div style={{marginBottom:8}}><strong>{String(r.values?.[t]??"Dashboard")}</strong><div style={{fontSize:12,color:dirty?"#ff8f1f":"#999"}}>{dirty?"有未保存修改":"所有修改已保存"}{managed?" · 受管":""}</div></div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={managed} onClick={()=>setMore(true)}>更多</Button></Grid.Item><Grid.Item><Button block color={dirty?"primary":"default"} disabled={!can||managed} onClick={()=>act("saveDashboard")}>保存</Button></Grid.Item></Grid><Popup visible={more} onMaskClick={()=>setMore(false)} bodyStyle={{padding:16}}><Space direction="vertical" block><Button block onClick={()=>act("saveDashboardCopy")}>另存为副本</Button><Button block disabled={!template} onClick={()=>act("saveDashboardTemplate")}>另存为模板</Button></Space></Popup></PhoneShell>}

function PhoneWorkItemCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),s=phoneField(props,"statusFieldRef"),p=phoneField(props,"priorityFieldRef"),a=phoneField(props,"assigneeFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[more,setMore]=React.useState(false);if(!b||!t||!s||!r)return <PhoneShell block={props.block} testid="phone-work-item-command-header"><MobileEmpty description="工作项页头尚未绑定标题和状态"/></PhoneShell>;const status=String(r.values?.[s]??"open"),closed=["done","closed","archived","completed"].includes(status.toLowerCase()),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-work-item-command-header"><strong>{String(r.values?.[t]??"未命名工作项")}</strong><div style={{fontSize:12,color:"#666",margin:"6px 0 10px"}}>{status}{p?` · ${String(r.values?.[p]??"")}`:""}{a?` · ${String(r.values?.[a]??"未分配")}`:""}</div><Grid columns={2} gap={8}><Grid.Item><Button block onClick={()=>act("editWorkItem","editRequest")}>编辑</Button></Grid.Item><Grid.Item><Button block onClick={()=>setMore(true)}>更多</Button></Grid.Item></Grid><Popup visible={more} onMaskClick={()=>setMore(false)} bodyStyle={{padding:16}}><Space direction="vertical" block><Button block onClick={()=>act("duplicateWorkItem")}>复制</Button><Button block color={closed?"primary":"danger"} onClick={()=>act(closed?"reopenWorkItem":"archiveWorkItem","submitRequest")}>{closed?"重新打开":"归档"}</Button></Space></Popup></PhoneShell>}

function PhoneDocumentCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),s=phoneField(props,"stateFieldRef"),perm=phoneField(props,"permissionFieldRef"),rev=phoneField(props,"revisionFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!t||!s||!r)return <PhoneShell block={props.block} testid="phone-document-command-header"><MobileEmpty description="文档页头尚未绑定标题和状态"/></PhoneShell>;const state=String(r.values?.[s]??"draft"),can=!perm||phoneTruthy(r.values?.[perm],"publish"),revision=Boolean(rev&&r.values?.[rev]),act=(op:string,event="submitRequest")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-document-command-header"><strong>{String(r.values?.[t]??"未命名文档")}</strong><div style={{fontSize:12,color:"#666",margin:"6px 0 10px"}}>{state==="published"?"已发布":"草稿"}{revision?" · 历史修订":""}</div>{revision?<Button block color="primary" disabled={!can} onClick={()=>act("restoreRevision")}>恢复此版本</Button>:<Grid columns={2} gap={8}><Grid.Item><Button block onClick={()=>act("saveDraft","editRequest")}>保存草稿</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!can} onClick={()=>act(state==="published"?"finishEditing":"publishDocument")}>{state==="published"?"完成编辑":"发布"}</Button></Grid.Item></Grid>}</PhoneShell>}

function PhoneEnvironmentStatusStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),n=phoneField(props,"nameFieldRef"),s=phoneField(props,"statusFieldRef");if(!b||!n||!s)return <PhoneShell block={props.block} title={titleOf(props)||"环境状态"} testid="phone-environment-status-strip"><MobileEmpty description="环境状态尚未绑定名称和状态"/></PhoneShell>;return <PhoneShell block={props.block} title={titleOf(props)||"环境状态"} testid="phone-environment-status-strip"><List mode="card" style={{margin:0}}>{b.rows.map(r=>{const status=String(r.values?.[s]??"unknown");return <List.Item key={r.id} prefix={<Badge color={["healthy","ready","active"].includes(status.toLowerCase())?"success":"danger"} content=""/>} extra={status} onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id})}>{String(r.values?.[n]??"环境")}</List.Item>})}</List></PhoneShell>}

function PhoneDataFreshnessIndicator(props:ExperienceBlockRendererProps){const b=phoneRows(props),source=phoneField(props,"sourceFieldRef"),updated=phoneField(props,"updatedAtFieldRef"),statusRef=phoneField(props,"statusFieldRef"),r=b?.rows[0];if(!b||!source||!updated||!r)return <PhoneShell block={props.block} testid="phone-data-freshness-indicator"><MobileEmpty description="数据新鲜度尚未绑定来源和更新时间"/></PhoneShell>;const status=statusRef?String(r.values?.[statusRef]??"fresh"):"fresh",stale=["stale","delayed","error"].includes(status.toLowerCase());return <PhoneShell block={props.block} testid="phone-data-freshness-indicator"><div style={{display:"flex",justifyContent:"space-between",gap:8}}><div><strong>{String(r.values?.[source]??"数据源")}</strong><div style={{fontSize:12,color:stale?"#ff8f1f":"#00b578"}}>更新于 {String(r.values?.[updated]??"-")} · {stale?"可能延迟":"数据新鲜"}</div></div><Button size="mini" onClick={()=>props.onAction?.("actionTrigger",{operation:"refreshFreshness",targets:phoneTargets(props)})}>刷新</Button></div></PhoneShell>}

function PhoneCompactSummary(props:ExperienceBlockRendererProps,testid:string,fallback:string){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),fields=phoneFieldList(props,"fieldRefs"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!t||!fields.length||!r)return <PhoneShell block={props.block} title={fallback} testid={testid}><MobileEmpty description={`${fallback}尚未绑定当前记录和摘要字段`}/></PhoneShell>;return <PhoneShell block={props.block} title={String(r.values?.[t]??fallback)} testid={testid}><List mode="card" style={{margin:0}}>{fields.slice(0,6).map(f=><List.Item key={f} extra={<span style={{maxWidth:150,textAlign:"right",overflowWrap:"anywhere"}}>{String(r.values?.[f]??"-")}</span>}>{props.fieldLabelOf?.(b.entityRef,f)??f}</List.Item>)}</List></PhoneShell>}
const PhoneWorkItemContextSummary=(props:ExperienceBlockRendererProps)=>PhoneCompactSummary(props,"phone-work-item-context-summary","工作项摘要");

function PhoneStableTabs(props:ExperienceBlockRendererProps,testid:string,fallback:string){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),key=phoneField(props,"keyFieldRef"),count=phoneField(props,"countFieldRef"),enabled=phoneField(props,"enabledFieldRef"),[active,setActive]=React.useState("");if(!b||!t||!key)return <PhoneShell block={props.block} testid={testid}><MobileEmpty description={`${fallback}尚未绑定标题和稳定键`}/></PhoneShell>;const usable=b.rows.filter(r=>!enabled||![false,"false","disabled"].includes(r.values?.[enabled] as never)),selected=usable.some(r=>String(r.values?.[key])===active)?active:String(usable[0]?.values?.[key]??"");return <PhoneShell block={props.block} testid={testid}><Tabs activeKey={selected} onChange={v=>{setActive(v);const r=b.rows.find(x=>String(x.values?.[key])===v);props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r?.id,tabKey:v,targets:phoneTargets(props)})}}>{b.rows.map(r=><Tabs.Tab key={String(r.values?.[key])} title={`${String(r.values?.[t]??fallback)}${count?` ${String(r.values?.[count]??0)}`:""}`} disabled={Boolean(enabled&&[false,"false","disabled"].includes(r.values?.[enabled] as never))}/>)}</Tabs></PhoneShell>}

function PhoneWorkItemFilterBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),type=phoneField(props,"typeFieldRef"),key=phoneField(props,"keyFieldRef"),title=phoneField(props,"titleFieldRef"),[selected,setSelected]=React.useState<Record<string,string[]>>({});if(!b||!type||!key||!title)return <PhoneShell block={props.block} title={titleOf(props)||"工作项筛选"} testid="phone-work-item-filter-bar"><MobileEmpty description="工作项筛选尚未绑定类型、键和标题"/></PhoneShell>;const types=Array.from(new Set(b.rows.map(r=>String(r.values?.[type]??"")).filter(Boolean))),emit=(next:Record<string,string[]>)=>props.onAction?.("filterChange",{facets:next,targets:phoneTargets(props)});return <PhoneShell block={props.block} title={titleOf(props)||"工作项筛选"} testid="phone-work-item-filter-bar">{types.map(v=><div key={v} style={{marginBottom:8}}><small>{v}</small><Selector columns={2} multiple value={selected[v]??[]} options={b.rows.filter(r=>String(r.values?.[type])===v).map(r=>({value:String(r.values?.[key]),label:String(r.values?.[title])}))} onChange={vals=>{const next={...selected,[v]:vals.map(String)};setSelected(next);emit(next)}}/></div>)}<Button block fill="none" disabled={!Object.values(selected).some(v=>v.length)} onClick={()=>{setSelected({});emit({})}}>清除筛选</Button></PhoneShell>}

function PhoneDashboardParameterBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),key=phoneField(props,"keyFieldRef"),value=phoneField(props,"valueFieldRef"),required=phoneField(props,"requiredFieldRef"),[values,setValues]=React.useState<Record<string,string>>({});if(!b||!t||!key)return <PhoneShell block={props.block} title={titleOf(props)||"Dashboard 参数"} testid="phone-dashboard-parameter-bar"><MobileEmpty description="Dashboard 参数尚未绑定标题和参数键"/></PhoneShell>;const resolved=Object.fromEntries(b.rows.map(r=>{const k=String(r.values?.[key]??r.id);return[k,values[k]??String(value?r.values?.[value]??"":"")]})),missing=b.rows.some(r=>required&&phoneTruthy(r.values?.[required],"required")&&!resolved[String(r.values?.[key]??r.id)]?.trim());return <PhoneShell block={props.block} title={titleOf(props)||"Dashboard 参数"} testid="phone-dashboard-parameter-bar"><Space direction="vertical" block>{b.rows.map(r=>{const k=String(r.values?.[key]??r.id);return <div key={r.id}><small>{String(r.values?.[t]??"参数")}</small><Input value={resolved[k]} onChange={v=>setValues(x=>({...x,[k]:v}))} placeholder={required&&phoneTruthy(r.values?.[required],"required")?"必填":"全部"} style={{padding:9,background:"#f5f5f5"}}/></div>})}<Button block color="primary" disabled={missing} onClick={()=>props.onAction?.("filterChange",{parameters:resolved,targets:phoneTargets(props)})}>应用参数</Button></Space></PhoneShell>}

function PhoneCycleHealthMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),completed=phoneField(props,"completedFieldRef"),total=phoneField(props,"totalFieldRef"),overdue=phoneField(props,"overdueFieldRef"),unstarted=phoneField(props,"unstartedFieldRef"),r=b?.rows[0];if(!b||!completed||!total||!r)return <PhoneShell block={props.block} title={titleOf(props)||"周期健康"} testid="phone-cycle-health-metrics"><MobileEmpty description="周期指标尚未绑定完成数和总数"/></PhoneShell>;const done=Number(r.values?.[completed]??0),all=Number(r.values?.[total]??0),items=[["已完成",done],["总工作项",all],...(overdue?[["已逾期",Number(r.values?.[overdue]??0)]]:[]),...(unstarted?[["未开始",Number(r.values?.[unstarted]??0)]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"周期健康"} testid="phone-cycle-health-metrics"><Grid columns={2} gap={8}>{items.map(([l,v])=><Grid.Item key={l}><div style={{padding:10,background:"#f5f5f5",borderRadius:6}}><small>{l}</small><div><strong style={{fontSize:20}}>{v}</strong></div></div></Grid.Item>)}</Grid><ProgressBar percent={all?Math.min(100,Math.round(done/all*100)):0} style={{marginTop:10}}/></PhoneShell>}

function PhoneQueryExecutionMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),time=phoneField(props,"timeFieldRef"),rows=phoneField(props,"rowsFieldRef"),cached=phoneField(props,"cachedFieldRef"),bytes=phoneField(props,"bytesFieldRef"),r=b?.rows[0];if(!b||!time||!rows||!r)return <PhoneShell block={props.block} title={titleOf(props)||"查询执行"} testid="phone-query-execution-metrics"><MobileEmpty description="查询指标尚未绑定耗时和行数"/></PhoneShell>;const items=[["执行耗时",`${Number(r.values?.[time]??0)} ms`],["结果行数",Number(r.values?.[rows]??0)],...(bytes?[["扫描字节",Number(r.values?.[bytes]??0)]]:[]),...(cached?[["结果来源",phoneTruthy(r.values?.[cached],"cached")?"缓存":"实时"]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"查询执行"} testid="phone-query-execution-metrics"><Grid columns={2} gap={8}>{items.map(([l,v])=><Grid.Item key={l}><div style={{padding:10,background:"#f5f5f5",borderRadius:6}}><small>{l}</small><div><strong style={{fontSize:18}}>{v}</strong></div></div></Grid.Item>)}</Grid></PhoneShell>}

function PhoneBulkSelectionBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),ids=b?props.selection?.rowIds?.[b.entityRef]??[]:[],[open,setOpen]=React.useState(false);if(!b)return <PhoneShell block={props.block} testid="phone-bulk-selection-bar"><MobileEmpty description="批量选择栏尚未绑定实体"/></PhoneShell>;const act=(op:string,event="submitRequest")=>props.onAction?.(event,{entityRef:b.entityRef,rowIds:ids,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-bulk-selection-bar"><strong>已选择 {ids.length} 项</strong><Grid columns={3} gap={6} style={{marginTop:8}}><Grid.Item><Button block size="small" disabled={!ids.length} onClick={()=>act("bulkMove","editRequest")}>移动</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!ids.length} onClick={()=>act("bulkArchive")}>归档</Button></Grid.Item><Grid.Item><Button block size="small" color="danger" disabled={!ids.length} onClick={()=>setOpen(true)}>删除</Button></Grid.Item></Grid><Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:16}}><strong>确认删除所选 {ids.length} 项？</strong><Button block color="danger" style={{marginTop:12}} onClick={()=>{act("bulkDelete");setOpen(false)}}>确认删除</Button></Popup></PhoneShell>}

function PhoneDraftPublishBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),s=phoneField(props,"stateFieldRef"),dirtyRef=phoneField(props,"dirtyFieldRef"),canRef=phoneField(props,"canPublishFieldRef"),loc=phoneField(props,"locationFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!t||!s||!r)return <PhoneShell block={props.block} testid="phone-draft-publish-bar"><MobileEmpty description="草稿发布栏尚未绑定标题和状态"/></PhoneShell>;const dirty=!dirtyRef||phoneTruthy(r.values?.[dirtyRef],"dirty"),can=!canRef||phoneTruthy(r.values?.[canRef],"publish"),location=loc?String(r.values?.[loc]??""):"",act=(op:string,event="submitRequest")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,location,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-draft-publish-bar"><strong>{String(r.values?.[t]??"未命名草稿")}</strong><div style={{fontSize:12,color:dirty?"#ff8f1f":"#999",margin:"5px 0 9px"}}>{dirty?"有未保存修改":"草稿已保存"}{location?` · ${location}`:""}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!dirty} onClick={()=>act("saveDraft","editRequest")}>保存草稿</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!can||!location} onClick={()=>act("publishDocument")}>发布</Button></Grid.Item></Grid></PhoneShell>}

function PhoneQuestionCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),saved=phoneField(props,"savedFieldRef"),dirty=phoneField(props,"dirtyFieldRef"),bookmark=phoneField(props,"bookmarkFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!t||!r)return <PhoneShell block={props.block} testid="phone-question-command-header"><MobileEmpty description="问题页头尚未绑定标题"/></PhoneShell>;const isSaved=saved?phoneTruthy(r.values?.[saved],"saved"):false,isDirty=dirty?phoneTruthy(r.values?.[dirty],"dirty"):false,isBookmarked=bookmark?phoneTruthy(r.values?.[bookmark],"bookmarked"):false,act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-question-command-header"><strong>{String(r.values?.[t]??"未命名问题")}</strong><div style={{fontSize:12,color:isDirty?"#ff8f1f":"#999",margin:"5px 0 9px"}}>{isSaved?"已保存":"临时问题"}{isDirty?" · 有修改":""}</div><Grid columns={3} gap={6}><Grid.Item><Button block size="small" onClick={()=>act(isBookmarked?"removeBookmark":"addBookmark")}>{isBookmarked?"已收藏":"收藏"}</Button></Grid.Item><Grid.Item><Button block size="small" onClick={()=>act("duplicateQuestion")}>复制</Button></Grid.Item><Grid.Item><Button block size="small" color="primary" disabled={!isDirty} onClick={()=>act("saveQuestion","editRequest")}>保存</Button></Grid.Item></Grid></PhoneShell>}

function PhoneCatalogEntityCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),kind=phoneField(props,"kindFieldRef"),type=phoneField(props,"typeFieldRef"),star=phoneField(props,"starredFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[open,setOpen]=React.useState(false);if(!b||!t||!kind||!r)return <PhoneShell block={props.block} testid="phone-catalog-entity-command-header"><MobileEmpty description="目录实体页头尚未绑定标题和种类"/></PhoneShell>;const starred=Boolean(star&&phoneTruthy(r.values?.[star],"starred")),act=(op:string)=>props.onAction?.("actionTrigger",{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-catalog-entity-command-header"><strong>{String(r.values?.[t]??"未命名实体")}</strong><div style={{fontSize:12,color:"#666",margin:"5px 0 9px"}}>{String(r.values?.[kind]??"Entity")}{type?` · ${String(r.values?.[type]??"")}`:""}</div><Grid columns={2} gap={8}><Grid.Item><Button block onClick={()=>act(starred?"unstarEntity":"starEntity")}>{starred?"取消收藏":"收藏"}</Button></Grid.Item><Grid.Item><Button block onClick={()=>setOpen(true)}>更多</Button></Grid.Item></Grid><Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:16}}><Space direction="vertical" block><Button block onClick={()=>act("inspect")}>查看元数据</Button><Button block onClick={()=>act("refresh")}>刷新目录</Button></Space></Popup></PhoneShell>}

function PhoneCollaboratorPresenceStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),name=phoneField(props,"nameFieldRef"),present=phoneField(props,"presentFieldRef"),editing=phoneField(props,"editingFieldRef");if(!b||!name||!present)return <PhoneShell block={props.block} testid="phone-collaborator-presence-strip"><MobileEmpty description="协作者状态尚未绑定姓名和在线状态"/></PhoneShell>;const active=b.rows.filter(r=>phoneTruthy(r.values?.[present],"present"));return <PhoneShell block={props.block} testid="phone-collaborator-presence-strip"><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}><div style={{display:"flex",alignItems:"center"}}>{active.slice(0,5).map((r,i)=><div key={r.id} title={String(r.values?.[name]??"")} style={{width:30,height:30,borderRadius:15,display:"grid",placeItems:"center",marginLeft:i?-7:0,border:"2px solid white",background:editing&&phoneTruthy(r.values?.[editing],"editing")?"#1677ff":"#00b578",color:"white"}}>{String(r.values?.[name]??"?").slice(0,1)}</div>)}<span style={{fontSize:12,color:"#666",marginLeft:8}}>{active.length?`${active.length} 人在线`:"暂无在线协作者"}</span></div><Button size="mini" disabled={!active.length} onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowIds:active.map(r=>r.id),operation:"showCollaborators"})}>查看</Button></div></PhoneShell>}

function PhoneQueryRunStatusStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),status=phoneField(props,"statusFieldRef"),time=phoneField(props,"timeFieldRef"),cached=phoneField(props,"cachedFieldRef"),r=b?.rows[0];if(!b||!status||!r)return <PhoneShell block={props.block} testid="phone-query-run-status-strip"><MobileEmpty description="查询状态尚未绑定运行状态"/></PhoneShell>;const state=String(r.values?.[status]??"idle").toLowerCase(),running=["running","loading","executing"].includes(state),failed=["failed","error"].includes(state);return <PhoneShell block={props.block} testid="phone-query-run-status-strip"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}><div><strong style={{color:running?"#1677ff":failed?"#ff3141":"#00b578"}}>{running?"查询运行中":failed?"上次查询失败":"查询已完成"}</strong><div style={{fontSize:12,color:"#666"}}>{time?`${String(r.values?.[time]??"-")} ms`:""}{cached?` · ${phoneTruthy(r.values?.[cached],"cached")?"缓存结果":"实时结果"}`:""}</div></div><Button size="small" color={running?"danger":"primary"} onClick={()=>props.onAction?.("actionTrigger",{operation:running?"cancelQuery":"runQuery",targets:phoneTargets(props)})}>{running?"取消":"重新运行"}</Button></div></PhoneShell>}

function PhoneEntityOwnershipSummary(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),owner=phoneField(props,"ownerFieldRef"),lifecycle=phoneField(props,"lifecycleFieldRef"),system=phoneField(props,"systemFieldRef"),domain=phoneField(props,"domainFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!t||!owner||!r)return <PhoneShell block={props.block} testid="phone-entity-ownership-summary"><MobileEmpty description="所有权摘要尚未绑定标题和负责人"/></PhoneShell>;const items=[["负责人",owner],["生命周期",lifecycle],["系统",system],["领域",domain]].filter((x):x is [string,string]=>Boolean(x[1]));return <PhoneShell block={props.block} title={String(r.values?.[t]??"实体归属")} testid="phone-entity-ownership-summary"><List mode="card" style={{margin:0}}>{items.map(([label,ref])=><List.Item key={label} extra={String(r.values?.[ref]??"-")}>{label}</List.Item>)}</List></PhoneShell>}

function PhoneQueryDataSourceSummary(props:ExperienceBlockRendererProps){const b=phoneRows(props),database=phoneField(props,"databaseFieldRef"),schema=phoneField(props,"schemaFieldRef"),source=phoneField(props,"sourceFieldRef"),type=phoneField(props,"typeFieldRef"),r=b?.rows[0];if(!b||!database||!source||!r)return <PhoneShell block={props.block} testid="phone-query-data-source-summary"><MobileEmpty description="查询数据源尚未绑定数据库和来源"/></PhoneShell>;return <PhoneShell block={props.block} title={titleOf(props)||"数据来源"} testid="phone-query-data-source-summary"><div style={{overflowWrap:"anywhere"}}><strong>{String(r.values?.[source]??"-")}</strong><div style={{fontSize:12,color:"#666",marginTop:4}}>{[database,schema].filter(Boolean).map(ref=>String(r.values?.[ref!]??"-")).join(" / ")}{type?` · ${String(r.values?.[type]??"数据表")}`:""}</div></div></PhoneShell>}


function PhoneCatalogEntityFilterBar(props:ExperienceBlockRendererProps){const [selected,setSelected]=React.useState<Record<string,string[]>>({}),b=phoneRows(props),facet=phoneField(props,"facetFieldRef"),key=phoneField(props,"keyFieldRef"),title=phoneField(props,"titleFieldRef");if(!b||!facet||!key||!title)return <PhoneShell block={props.block} testid="phone-catalog-entity-filter-bar"><MobileEmpty description="目录筛选尚未绑定分面、键和值"/></PhoneShell>;const groups=Array.from(new Set(b.rows.map(r=>String(r.values?.[facet]??"")).filter(Boolean))),emit=(next:Record<string,string[]>)=>props.onAction?.("filterChange",{facets:next,targets:phoneTargets(props),page:1});return <PhoneShell block={props.block} title={titleOf(props)||"目录筛选"} testid="phone-catalog-entity-filter-bar">{groups.map(group=><div key={group} style={{marginBottom:10}}><small>{group}</small><Selector columns={2} multiple value={selected[group]??[]} options={b.rows.filter(r=>String(r.values?.[facet])===group).map(r=>({value:String(r.values?.[key]),label:String(r.values?.[title])}))} onChange={values=>{const next={...selected,[group]:values.map(String)};setSelected(next);emit(next)}}/></div>)}<Button block fill="none" disabled={!Object.values(selected).some(v=>v.length)} onClick={()=>{setSelected({});emit({})}}>清除</Button></PhoneShell>}

function PhoneQueryClauseFilterBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),field=phoneField(props,"fieldFieldRef"),operator=phoneField(props,"operatorFieldRef"),value=phoneField(props,"valueFieldRef"),enabled=phoneField(props,"enabledFieldRef");if(!b||!field||!operator||!value)return <PhoneShell block={props.block} testid="phone-query-clause-filter-bar"><MobileEmpty description="查询条件尚未绑定字段、运算符和值"/></PhoneShell>;const active=b.rows.filter(r=>!enabled||phoneTruthy(r.values?.[enabled],"enabled")),emit=(op:string,rowId?:string)=>props.onAction?.("filterChange",{operation:op,rowId,clauses:active.filter(r=>r.id!==rowId).map(r=>r.id),targets:phoneTargets(props),page:1});return <PhoneShell block={props.block} title={titleOf(props)||"查询条件"} testid="phone-query-clause-filter-bar"><List mode="card" style={{margin:0}}>{active.map(r=><List.Item key={r.id} extra={<Button size="mini" fill="none" onClick={()=>emit("removeClause",r.id)}>移除</Button>}><span style={{overflowWrap:"anywhere"}}>{String(r.values?.[field])} {String(r.values?.[operator])} {String(r.values?.[value])}</span></List.Item>)}</List>{active.length>1&&<Button block fill="none" onClick={()=>emit("clearClauses")}>全部清除</Button>}</PhoneShell>}

function PhoneDocumentInsightMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),views=phoneField(props,"viewsFieldRef"),contributors=phoneField(props,"contributorsFieldRef"),created=phoneField(props,"createdAtFieldRef"),updated=phoneField(props,"updatedAtFieldRef"),r=b?.rows[0];if(!b||!views||!contributors||!r)return <PhoneShell block={props.block} testid="phone-document-insight-metrics"><MobileEmpty description="文档洞察尚未绑定阅读和贡献者数据"/></PhoneShell>;const items=[["阅读次数",r.values?.[views]??0],["贡献者",r.values?.[contributors]??0],...(created?[["创建时间",r.values?.[created]??"-"]]:[]),...(updated?[["最近更新",r.values?.[updated]??"-"]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"文档洞察"} testid="phone-document-insight-metrics"><Grid columns={2} gap={8}>{items.map(([label,val])=><Grid.Item key={String(label)}><div style={{padding:10,background:"#f5f5f5",borderRadius:6}}><small>{String(label)}</small><div style={{fontWeight:600,overflowWrap:"anywhere"}}>{String(val)}</div></div></Grid.Item>)}</Grid></PhoneShell>}

function PhoneMetadataQualityMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),total=phoneField(props,"totalFieldRef"),documented=phoneField(props,"documentedFieldRef"),typed=phoneField(props,"typedFieldRef"),r=b?.rows[0];if(!b||!total||!documented||!r)return <PhoneShell block={props.block} testid="phone-metadata-quality-metrics"><MobileEmpty description="元数据质量尚未绑定字段总数和已描述数"/></PhoneShell>;const all=Number(r.values?.[total]??0),docs=Number(r.values?.[documented]??0),semantic=typed?Number(r.values?.[typed]??0):0,score=all?Math.round((docs+semantic)/(all*(typed?2:1))*100):0;return <PhoneShell block={props.block} title={titleOf(props)||"元数据质量"} testid="phone-metadata-quality-metrics"><strong>{score}% 完整</strong><ProgressBar percent={score} style={{margin:"8px 0 12px"}}/><Grid columns={2} gap={8}><Grid.Item><div style={{padding:8,background:"#f5f5f5"}}>已描述 {docs}/{all}</div></Grid.Item>{typed&&<Grid.Item><div style={{padding:8,background:"#f5f5f5"}}>语义类型 {semantic}/{all}</div></Grid.Item>}</Grid></PhoneShell>}

function PhoneQuestionExecutionBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),status=phoneField(props,"statusFieldRef"),runnable=phoneField(props,"runnableFieldRef"),dirty=phoneField(props,"dirtyFieldRef"),r=b?.rows[0];if(!b||!status||!r)return <PhoneShell block={props.block} testid="phone-question-execution-bar"><MobileEmpty description="查询执行栏尚未绑定运行状态"/></PhoneShell>;const state=String(r.values?.[status]??"idle").toLowerCase(),running=["running","loading","executing"].includes(state),canRun=!runnable||phoneTruthy(r.values?.[runnable],"runnable"),changed=Boolean(dirty&&phoneTruthy(r.values?.[dirty],"dirty")),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{operation:op,entityRef:b.entityRef,rowId:r.id,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-question-execution-bar"><div style={{fontSize:12,color:changed?"#ff8f1f":"#666",marginBottom:8}}>{running?"正在执行查询":changed?"查询有未保存修改":"查询已就绪"}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!changed} onClick={()=>act("saveQuestion","editRequest")}>保存</Button></Grid.Item><Grid.Item><Button block color={running?"danger":"primary"} disabled={!running&&!canRun} onClick={()=>act(running?"cancelQuery":"runQuery")}>{running?"取消查询":"运行查询"}</Button></Grid.Item></Grid></PhoneShell>}

function PhoneDocumentShareBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),visibility=phoneField(props,"visibilityFieldRef"),domain=phoneField(props,"domainFieldRef"),permission=phoneField(props,"permissionFieldRef"),link=phoneField(props,"linkFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!t||!visibility||!r)return <PhoneShell block={props.block} testid="phone-document-share-bar"><MobileEmpty description="文档分享栏尚未绑定标题和可见性"/></PhoneShell>;const publicShare=phoneTruthy(r.values?.[visibility],"public"),canShare=!permission||phoneTruthy(r.values?.[permission],"share"),submit=(op:string)=>props.onAction?.("submitRequest",{operation:op,entityRef:b.entityRef,rowId:r.id,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-document-share-bar"><strong>{String(r.values?.[t]??"文档")}</strong><div style={{fontSize:12,color:"#666",margin:"5px 0 9px"}}>{publicShare?`公开分享${domain?` · ${String(r.values?.[domain]??"")}`:""}`:"仅团队成员可见"}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!publicShare||!link} onClick={()=>props.onAction?.("actionTrigger",{operation:"copyShareLink",value:link?String(r.values?.[link]??""):""})}>复制链接</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!canShare} onClick={()=>submit(publicShare?"manageShare":"enableShare")}>{publicShare?"管理分享":"开启分享"}</Button></Grid.Item></Grid></PhoneShell>}

function PhoneCycleCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),status=phoneField(props,"statusFieldRef"),editable=phoneField(props,"editableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[more,setMore]=React.useState(false);if(!b||!t||!status||!r)return <PhoneShell block={props.block} testid="phone-cycle-command-header"><MobileEmpty description="周期页头尚未绑定标题和状态"/></PhoneShell>;const state=String(r.values?.[status]??"draft").toLowerCase(),archived=["archived","completed"].includes(state),can=!editable||phoneTruthy(r.values?.[editable],"editable"),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-cycle-command-header"><strong>{String(r.values?.[t]??"未命名周期")}</strong><div style={{fontSize:12,color:"#666",margin:"5px 0 9px"}}>{state}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!can||archived} onClick={()=>act("editCycle","editRequest")}>编辑</Button></Grid.Item><Grid.Item><Button block onClick={()=>setMore(true)}>更多</Button></Grid.Item></Grid><Popup visible={more} onMaskClick={()=>setMore(false)} bodyStyle={{padding:16}}><Space direction="vertical" block><Button block onClick={()=>act("copyCycleLink")}>复制链接</Button><Button block disabled={!can} onClick={()=>act(archived?"restoreCycle":"archiveCycle","submitRequest")}>{archived?"恢复":"归档"}</Button></Space></Popup></PhoneShell>}

function PhoneAlertGroupCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),status=phoneField(props,"statusFieldRef"),editable=phoneField(props,"editableFieldRef"),interval=phoneField(props,"intervalFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!t||!status||!r)return <PhoneShell block={props.block} testid="phone-alert-group-command-header"><MobileEmpty description="规则组页头尚未绑定标题和状态"/></PhoneShell>;const can=!editable||phoneTruthy(r.values?.[editable],"editable"),paused=["paused","disabled"].includes(String(r.values?.[status]??"active").toLowerCase()),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-alert-group-command-header"><strong>{String(r.values?.[t]??"未命名规则组")}</strong><div style={{fontSize:12,color:paused?"#999":"#1677ff",margin:"5px 0 9px"}}>{paused?"已暂停":"评估中"}{interval?` · ${String(r.values?.[interval]??"-")}`:""}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!can} onClick={()=>act("editAlertGroup","editRequest")}>编辑</Button></Grid.Item><Grid.Item><Button block disabled={!can} onClick={()=>act(paused?"resumeAlertGroup":"pauseAlertGroup","submitRequest")}>{paused?"恢复评估":"暂停评估"}</Button></Grid.Item></Grid></PhoneShell>}

function PhoneIncidentOwnershipStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),assignee=phoneField(props,"assigneeFieldRef"),source=phoneField(props,"sourceFieldRef"),suggested=phoneField(props,"suggestedFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!assignee||!r)return <PhoneShell block={props.block} testid="phone-incident-ownership-strip"><MobileEmpty description="事故归属尚未绑定负责人"/></PhoneShell>;const current=String(r.values?.[assignee]??"").trim(),hint=suggested?String(r.values?.[suggested]??"").trim():"";return <PhoneShell block={props.block} testid="phone-incident-ownership-strip"><strong>{current||"未分配"}</strong><div style={{fontSize:12,color:"#666",margin:"4px 0 9px"}}>{source?`来源：${String(r.values?.[source]??"手动")}`:"手动分配"}{hint?` · 建议 ${hint}`:""}</div><Grid columns={current||!hint?1:2} gap={8}><Grid.Item><Button block onClick={()=>props.onAction?.("editRequest",{entityRef:b.entityRef,rowId:r.id,operation:"changeAssignee",targets:phoneTargets(props)})}>更换负责人</Button></Grid.Item>{!current&&hint&&<Grid.Item><Button block color="primary" onClick={()=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:"acceptSuggestedOwner",value:hint})}>采用建议</Button></Grid.Item>}</Grid></PhoneShell>}

function PhoneSyncScheduleStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),frequency=phoneField(props,"frequencyFieldRef"),next=phoneField(props,"nextRunFieldRef"),timezone=phoneField(props,"timezoneFieldRef"),status=phoneField(props,"statusFieldRef"),r=b?.rows[0];if(!b||!frequency||!next||!r)return <PhoneShell block={props.block} testid="phone-sync-schedule-strip"><MobileEmpty description="同步计划尚未绑定频率和下次运行时间"/></PhoneShell>;const paused=Boolean(status&&["paused","disabled"].includes(String(r.values?.[status]??"").toLowerCase()));return <PhoneShell block={props.block} testid="phone-sync-schedule-strip"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}><div><strong>{paused?"同步计划已暂停":`每 ${String(r.values?.[frequency]??"-")}`}</strong><div style={{fontSize:12,color:"#666"}}>下次运行 {String(r.values?.[next]??"-")}{timezone?` · ${String(r.values?.[timezone]??"")}`:""}</div></div><Button size="small" onClick={()=>props.onAction?.("editRequest",{operation:"editSyncSchedule",entityRef:b.entityRef,rowId:r.id,targets:phoneTargets(props)})}>调整</Button></div></PhoneShell>}


function PhoneCycleFilterBar(props:ExperienceBlockRendererProps){const [selected,setSelected]=React.useState<Record<string,string[]>>({}),b=phoneRows(props),type=phoneField(props,"typeFieldRef"),key=phoneField(props,"keyFieldRef"),title=phoneField(props,"titleFieldRef");if(!b||!type||!key||!title)return <PhoneShell block={props.block} testid="phone-cycle-filter-bar"><MobileEmpty description="周期筛选尚未绑定类型、键和值"/></PhoneShell>;const groups=Array.from(new Set(b.rows.map(r=>String(r.values?.[type]??"")).filter(Boolean))),emit=(next:Record<string,string[]>)=>props.onAction?.("filterChange",{facets:next,targets:phoneTargets(props),page:1});return <PhoneShell block={props.block} title={titleOf(props)||"周期筛选"} testid="phone-cycle-filter-bar">{groups.map(group=><div key={group} style={{marginBottom:10}}><small>{group}</small><Selector columns={2} multiple value={selected[group]??[]} options={b.rows.filter(r=>String(r.values?.[type])===group).map(r=>({value:String(r.values?.[key]),label:String(r.values?.[title])}))} onChange={values=>{const next={...selected,[group]:values.map(String)};setSelected(next);emit(next)}}/></div>)}<Button block fill="none" disabled={!Object.values(selected).some(v=>v.length)} onClick={()=>{setSelected({});emit({})}}>清除</Button></PhoneShell>}

function PhoneAlertRuleFilterBar(props:ExperienceBlockRendererProps){const [query,setQuery]=React.useState(String(props.block.props?.defaultQuery??"")),[view,setView]=React.useState<string|number>(String(props.block.props?.defaultView??"grouped")),submit=(value:string,nextView=view)=>props.onAction?.("filterChange",{query:value.trim(),view:nextView,targets:phoneTargets(props),page:1});return <PhoneShell block={props.block} title={titleOf(props)||"规则筛选"} testid="phone-alert-rule-filter-bar"><SearchBar value={query} onChange={setQuery} onSearch={submit} placeholder="名称或过滤语法"/><Segmented value={view} options={[{label:"分组",value:"grouped"},{label:"列表",value:"list"}]} onChange={value=>{setView(value);submit(query,value)}} style={{marginTop:8}}/></PhoneShell>}

function PhoneSyncReliabilityMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),success=phoneField(props,"successFieldRef"),failed=phoneField(props,"failedFieldRef"),records=phoneField(props,"recordsFieldRef"),freshness=phoneField(props,"freshnessFieldRef"),r=b?.rows[0];if(!b||!success||!failed||!r)return <PhoneShell block={props.block} testid="phone-sync-reliability-metrics"><MobileEmpty description="同步可靠性尚未绑定成功和失败次数"/></PhoneShell>;const ok=Number(r.values?.[success]??0),bad=Number(r.values?.[failed]??0),rate=ok+bad?Math.round(ok/(ok+bad)*100):0,items=[["成功率",`${rate}%`],["成功运行",ok],["失败运行",bad],...(records?[["同步记录",r.values?.[records]??0]]:[]),...(freshness?[["新鲜度",r.values?.[freshness]??"-"]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"同步可靠性"} testid="phone-sync-reliability-metrics"><Grid columns={2} gap={8}>{items.map(([label,value])=><Grid.Item key={String(label)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(label)}</small><div style={{fontWeight:600}}>{String(value)}</div></div></Grid.Item>)}</Grid></PhoneShell>}

function PhoneRuleEvaluationMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),active=phoneField(props,"activeFieldRef"),paused=phoneField(props,"pausedFieldRef"),error=phoneField(props,"errorFieldRef"),duration=phoneField(props,"durationFieldRef"),r=b?.rows[0];if(!b||!active||!paused||!r)return <PhoneShell block={props.block} testid="phone-rule-evaluation-metrics"><MobileEmpty description="规则评估尚未绑定活跃和暂停数量"/></PhoneShell>;const items=[["活跃规则",r.values?.[active]??0],["暂停规则",r.values?.[paused]??0],...(error?[["评估错误",r.values?.[error]??0]]:[]),...(duration?[["平均耗时",`${r.values?.[duration]??0} ms`]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"规则评估"} testid="phone-rule-evaluation-metrics"><Grid columns={2} gap={8}>{items.map(([label,value])=><Grid.Item key={String(label)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(label)}</small><div style={{fontWeight:600}}>{String(value)}</div></div></Grid.Item>)}</Grid></PhoneShell>}

function PhoneCycleLifecycleBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),status=phoneField(props,"statusFieldRef"),editable=phoneField(props,"editableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[danger,setDanger]=React.useState(false);if(!b||!t||!status||!r)return <PhoneShell block={props.block} testid="phone-cycle-lifecycle-bar"><MobileEmpty description="周期生命周期栏尚未绑定标题和状态"/></PhoneShell>;const state=String(r.values?.[status]??"draft").toLowerCase(),archived=state==="archived",completed=state==="completed",can=!editable||phoneTruthy(r.values?.[editable],"editable"),submit=(op:string)=>props.onAction?.("submitRequest",{operation:op,entityRef:b.entityRef,rowId:r.id,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-cycle-lifecycle-bar"><strong>{String(r.values?.[t]??"周期")} · {state}</strong><Grid columns={3} gap={6} style={{marginTop:8}}><Grid.Item><Button block size="small" disabled={!can||completed||archived} onClick={()=>submit("completeCycle")}>完成</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!can} onClick={()=>submit(archived?"restoreCycle":"archiveCycle")}>{archived?"恢复":"归档"}</Button></Grid.Item><Grid.Item><Button block size="small" color="danger" disabled={!can||!archived} onClick={()=>setDanger(true)}>删除</Button></Grid.Item></Grid><Popup visible={danger} onMaskClick={()=>setDanger(false)} bodyStyle={{padding:16}}><strong>删除后不可恢复</strong><Button block color="danger" style={{marginTop:12}} onClick={()=>{submit("deleteCycle");setDanger(false)}}>确认删除</Button></Popup></PhoneShell>}

function PhoneEventTypePublishBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),hiddenRef=phoneField(props,"hiddenFieldRef"),dirtyRef=phoneField(props,"dirtyFieldRef"),validRef=phoneField(props,"validFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!t||!hiddenRef||!r)return <PhoneShell block={props.block} testid="phone-event-type-publish-bar"><MobileEmpty description="事件类型发布栏尚未绑定标题和可见状态"/></PhoneShell>;const hidden=phoneTruthy(r.values?.[hiddenRef],"hidden"),dirty=!dirtyRef||phoneTruthy(r.values?.[dirtyRef],"dirty"),valid=!validRef||phoneTruthy(r.values?.[validRef],"valid"),act=(op:string,event="submitRequest")=>props.onAction?.(event,{operation:op,entityRef:b.entityRef,rowId:r.id,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-event-type-publish-bar"><strong>{String(r.values?.[t]??"事件类型")}</strong><div style={{fontSize:12,color:valid?"#666":"#ff3141",margin:"5px 0 9px"}}>{hidden?"未在公开资料中显示":"公开可预约"}{valid?"":" · 配置未通过校验"}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!dirty||!valid} onClick={()=>act("saveEventType","editRequest")}>保存</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!valid} onClick={()=>act(hidden?"publishEventType":"hideEventType")}>{hidden?"发布":"隐藏"}</Button></Grid.Item></Grid></PhoneShell>}

function PhoneConversationCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),t=phoneField(props,"titleFieldRef"),status=phoneField(props,"statusFieldRef"),verified=phoneField(props,"verifiedFieldRef"),inbox=phoneField(props,"inboxFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!t||!status||!r)return <PhoneShell block={props.block} testid="phone-conversation-command-header"><MobileEmpty description="会话页头尚未绑定联系人和状态"/></PhoneShell>;const state=String(r.values?.[status]??"open").toLowerCase(),resolved=["resolved","closed"].includes(state),trusted=!verified||phoneTruthy(r.values?.[verified],"verified"),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-conversation-command-header"><strong>{String(r.values?.[t]??"未知联系人")}</strong><div style={{fontSize:12,color:trusted?"#666":"#ff8f1f",margin:"5px 0 9px"}}>{inbox?`${String(r.values?.[inbox]??"收件箱")} · `:""}#{r.id} · {state}{trusted?"":" · 未验证"}</div><Grid columns={2} gap={8}><Grid.Item><Button block onClick={()=>act("copyConversationId")}>复制编号</Button></Grid.Item><Grid.Item><Button block color="primary" onClick={()=>act(resolved?"reopenConversation":"resolveConversation","submitRequest")}>{resolved?"重新打开":"解决"}</Button></Grid.Item></Grid></PhoneShell>}

function PhoneUserCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),username=phoneField(props,"usernameFieldRef"),enabledRef=phoneField(props,"enabledFieldRef"),impersonate=phoneField(props,"impersonateFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[confirm,setConfirm]=React.useState(false);if(!b||!username||!enabledRef||!r)return <PhoneShell block={props.block} testid="phone-user-command-header"><MobileEmpty description="用户页头尚未绑定用户名和启用状态"/></PhoneShell>;const enabled=phoneTruthy(r.values?.[enabledRef],"enabled"),can=Boolean(impersonate&&phoneTruthy(r.values?.[impersonate],"allowed"));return <PhoneShell block={props.block} testid="phone-user-command-header"><strong>{String(r.values?.[username]??"未命名用户")}</strong><div style={{fontSize:12,color:enabled?"#00b578":"#999",margin:"5px 0 9px"}}>{enabled?"已启用":"已禁用"}</div><Grid columns={2} gap={8}><Grid.Item><Button block disabled={!can} onClick={()=>props.onAction?.("actionTrigger",{entityRef:b.entityRef,rowId:r.id,operation:"impersonateUser"})}>模拟登录</Button></Grid.Item><Grid.Item><Button block onClick={()=>setConfirm(true)}>{enabled?"禁用":"启用"}</Button></Grid.Item></Grid><Popup visible={confirm} onMaskClick={()=>setConfirm(false)} bodyStyle={{padding:16}}><strong>确认{enabled?"禁用":"启用"}这个用户？</strong><Button block color={enabled?"danger":"primary"} style={{marginTop:12}} onClick={()=>{props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:enabled?"disableUser":"enableUser",targets:phoneTargets(props)});setConfirm(false)}}>确认</Button></Popup></PhoneShell>}

function PhoneConversationAssignmentStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),assignee=phoneField(props,"assigneeFieldRef"),team=phoneField(props,"teamFieldRef"),priority=phoneField(props,"priorityFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!assignee||!r)return <PhoneShell block={props.block} testid="phone-conversation-assignment-strip"><MobileEmpty description="会话分配尚未绑定处理人"/></PhoneShell>;return <PhoneShell block={props.block} testid="phone-conversation-assignment-strip"><strong>{String(r.values?.[assignee]??"未分配")}</strong><div style={{fontSize:12,color:"#666",margin:"4px 0 9px"}}>{team?String(r.values?.[team]??"未分组"):""}{priority?` · ${String(r.values?.[priority]??"普通")}`:""}</div><Grid columns={2} gap={8}><Grid.Item><Button block onClick={()=>props.onAction?.("editRequest",{entityRef:b.entityRef,rowId:r.id,operation:"assignConversation",targets:phoneTargets(props)})}>更换处理人</Button></Grid.Item><Grid.Item><Button block color="primary" onClick={()=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:"assignToMe"})}>分配给我</Button></Grid.Item></Grid></PhoneShell>}

function PhoneRealmStatusStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),name=phoneField(props,"nameFieldRef"),enabledRef=phoneField(props,"enabledFieldRef"),brute=phoneField(props,"bruteForceFieldRef"),ssl=phoneField(props,"sslFieldRef"),r=b?.rows[0];if(!b||!name||!enabledRef||!r)return <PhoneShell block={props.block} testid="phone-realm-status-strip"><MobileEmpty description="Realm 状态尚未绑定名称和启用状态"/></PhoneShell>;const enabled=phoneTruthy(r.values?.[enabledRef],"enabled");return <PhoneShell block={props.block} testid="phone-realm-status-strip"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}><div><strong>{String(r.values?.[name]??"Realm")}</strong><div style={{fontSize:12,color:enabled?"#00b578":"#999"}}>{enabled?"已启用":"已禁用"}{brute?` · 防护${phoneTruthy(r.values?.[brute],"enabled")?"开启":"关闭"}`:""}{ssl?` · SSL ${String(r.values?.[ssl]??"-")}`:""}</div></div><Button size="small" onClick={()=>props.onAction?.("editRequest",{entityRef:b.entityRef,rowId:r.id,operation:"editRealmSettings",targets:phoneTargets(props)})}>设置</Button></div></PhoneShell>}


function PhoneConversationInboxFilter(props:ExperienceBlockRendererProps){const [selected,setSelected]=React.useState<Record<string,string[]>>({}),b=phoneRows(props),type=phoneField(props,"typeFieldRef"),key=phoneField(props,"keyFieldRef"),title=phoneField(props,"titleFieldRef");if(!b||!type||!key||!title)return <PhoneShell block={props.block} testid="phone-conversation-inbox-filter"><MobileEmpty description="会话筛选尚未绑定类型、键和值"/></PhoneShell>;const groups=Array.from(new Set(b.rows.map(r=>String(r.values?.[type]??"")).filter(Boolean))),emit=(next:Record<string,string[]>)=>props.onAction?.("filterChange",{facets:next,targets:phoneTargets(props),page:1});return <PhoneShell block={props.block} title={titleOf(props)||"会话筛选"} testid="phone-conversation-inbox-filter">{groups.map(group=><div key={group} style={{marginBottom:10}}><small>{group}</small><Selector columns={2} multiple value={selected[group]??[]} options={b.rows.filter(r=>String(r.values?.[type])===group).map(r=>({value:String(r.values?.[key]),label:String(r.values?.[title])}))} onChange={values=>{const next={...selected,[group]:values.map(String)};setSelected(next);emit(next)}}/></div>)}<Button block fill="none" disabled={!Object.values(selected).some(v=>v.length)} onClick={()=>{setSelected({});emit({})}}>清除</Button></PhoneShell>}

function PhoneUserDirectoryFilter(props:ExperienceBlockRendererProps){const [query,setQuery]=React.useState(String(props.block.props?.defaultQuery??"")),[mode,setMode]=React.useState<string|number>(String(props.block.props?.defaultMode??"default")),submit=(value:string,nextMode=mode)=>props.onAction?.("filterChange",{query:value.trim(),mode:nextMode,exact:Boolean(props.block.props?.exact),targets:phoneTargets(props),page:1});return <PhoneShell block={props.block} title={titleOf(props)||"用户目录筛选"} testid="phone-user-directory-filter"><Segmented value={mode} options={[{label:"用户名",value:"default"},{label:"属性",value:"attribute"}]} onChange={value=>{setMode(value);setQuery("");submit("",value)}}/><SearchBar value={query} onChange={setQuery} onSearch={value=>submit(value)} placeholder={mode==="attribute"?"department:finance":"用户名或邮箱"} style={{marginTop:8}}/></PhoneShell>}

function PhoneConversationSlaMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),first=phoneField(props,"firstResponseFieldRef"),resolution=phoneField(props,"resolutionFieldRef"),breach=phoneField(props,"breachFieldRef"),count=phoneField(props,"countFieldRef"),r=b?.rows[0];if(!b||!first||!resolution||!r)return <PhoneShell block={props.block} testid="phone-conversation-sla-metrics"><MobileEmpty description="SLA 指标尚未绑定首次响应和解决时间"/></PhoneShell>;const items=[["首次响应",r.values?.[first]??"-"],["解决时间",r.values?.[resolution]??"-"],...(breach?[["SLA 违约",r.values?.[breach]??0]]:[]),...(count?[["会话总数",r.values?.[count]??0]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"会话 SLA"} testid="phone-conversation-sla-metrics"><Grid columns={2} gap={8}>{items.map(([label,value])=><Grid.Item key={String(label)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(label)}</small><div style={{fontWeight:600}}>{String(value)}</div></div></Grid.Item>)}</Grid></PhoneShell>}

function PhoneUserSessionMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),active=phoneField(props,"activeFieldRef"),offline=phoneField(props,"offlineFieldRef"),client=phoneField(props,"clientFieldRef"),risk=phoneField(props,"riskFieldRef"),r=b?.rows[0];if(!b||!active||!offline||!r)return <PhoneShell block={props.block} testid="phone-user-session-metrics"><MobileEmpty description="用户会话指标尚未绑定在线和离线会话"/></PhoneShell>;const items=[["在线会话",r.values?.[active]??0],["离线会话",r.values?.[offline]??0],...(client?[["登录客户端",r.values?.[client]??0]]:[]),...(risk?[["风险会话",r.values?.[risk]??0]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"用户会话"} testid="phone-user-session-metrics"><Grid columns={2} gap={8}>{items.map(([label,value])=><Grid.Item key={String(label)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(label)}</small><div style={{fontWeight:600}}>{String(value)}</div></div></Grid.Item>)}</Grid></PhoneShell>}

function PhoneConversationReplyBar(props:ExperienceBlockRendererProps){const [message,setMessage]=React.useState(""),[mode,setMode]=React.useState<string|number>("reply"),b=phoneRows(props),status=phoneField(props,"statusFieldRef"),channel=phoneField(props,"channelFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!status||!r)return <PhoneShell block={props.block} testid="phone-conversation-reply-bar"><MobileEmpty description="回复栏尚未绑定会话状态"/></PhoneShell>;const closed=["resolved","closed"].includes(String(r.values?.[status]??"open").toLowerCase()),submit=()=>{const text=message.trim();if(!text||closed)return;props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:mode==="note"?"addPrivateNote":"sendReply",message:text,channel:channel?r.values?.[channel]:undefined,targets:phoneTargets(props)});setMessage("")};return <PhoneShell block={props.block} testid="phone-conversation-reply-bar"><Segmented value={mode} options={[{label:"回复",value:"reply"},{label:"内部备注",value:"note"}]} onChange={setMode}/><div style={{fontSize:12,color:"#666",margin:"6px 0"}}>{channel?String(r.values?.[channel]??""):""}{closed?" · 会话已关闭":""}</div><TextArea value={message} onChange={setMessage} disabled={closed} rows={3} maxLength={5000} placeholder={mode==="note"?"仅团队成员可见":"输入回复内容"}/><Button block color="primary" disabled={closed||!message.trim()} style={{marginTop:8}} onClick={submit}>{mode==="note"?"添加备注":"发送回复"}</Button></PhoneShell>}

function PhoneUserAccessBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),username=phoneField(props,"usernameFieldRef"),enabledRef=phoneField(props,"enabledFieldRef"),sessionsRef=phoneField(props,"sessionsFieldRef"),manageable=phoneField(props,"manageableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[logout,setLogout]=React.useState(false);if(!b||!username||!enabledRef||!r)return <PhoneShell block={props.block} testid="phone-user-access-bar"><MobileEmpty description="用户访问栏尚未绑定用户名和启用状态"/></PhoneShell>;const enabled=phoneTruthy(r.values?.[enabledRef],"enabled"),sessions=sessionsRef?Number(r.values?.[sessionsRef]??0):0,can=!manageable||phoneTruthy(r.values?.[manageable],"allowed"),submit=(op:string)=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-user-access-bar"><strong>{String(r.values?.[username]??"用户")} · {sessions} 个会话</strong><Grid columns={3} gap={6} style={{marginTop:8}}><Grid.Item><Button block size="small" disabled={!can} onClick={()=>props.onAction?.("editRequest",{entityRef:b.entityRef,rowId:r.id,operation:"resetCredentials",targets:phoneTargets(props)})}>重置凭据</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!can||!sessions} onClick={()=>setLogout(true)}>注销会话</Button></Grid.Item><Grid.Item><Button block size="small" color={enabled?"danger":"primary"} disabled={!can} onClick={()=>submit(enabled?"disableUser":"enableUser")}>{enabled?"禁用":"启用"}</Button></Grid.Item></Grid><Popup visible={logout} onMaskClick={()=>setLogout(false)} bodyStyle={{padding:16}}><strong>确认注销全部会话？</strong><Button block color="danger" style={{marginTop:12}} onClick={()=>{submit("logoutAllSessions");setLogout(false)}}>确认注销</Button></Popup></PhoneShell>}

function PhoneTimeSeriesAnomalyChart(props:ExperienceBlockRendererProps){const b=phoneRows(props),time=phoneField(props,"timeFieldRef"),value=phoneField(props,"valueFieldRef"),anomaly=phoneField(props,"anomalyFieldRef");if(!b||!time||!value)return <PhoneAnalysisChart props={props} testid="phone-time-series-anomaly-chart" hint="异常图尚未绑定时间和值字段"/>;const numeric=(input:unknown)=>input==null||input===""||!Number.isFinite(Number(input))?null:Number(input),rows=[...b.rows].sort((a,c)=>String(a.values?.[time]).localeCompare(String(c.values?.[time]))),data=rows.map(r=>numeric(r.values?.[value])),points=anomaly?rows.flatMap((r,i)=>{const v=numeric(r.values?.[value]);return phoneTruthy(r.values?.[anomaly],"anomaly")&&v!=null?[{coord:[i,v]}]:[]}):[];const option=rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},grid:{left:4,right:4,top:12,bottom:8,containLabel:true},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time])),axisLabel:{fontSize:8}},yAxis:{type:"value"},series:[{type:"line",smooth:true,connectNulls:false,data,markPoint:{data:points,itemStyle:{color:"#cf1322"},symbolSize:24}}]}:undefined;return <PhoneAnalysisChart props={props} testid="phone-time-series-anomaly-chart" option={option} hint="当前没有时序数据"/>}
function PhoneCohortRetentionChart(props:ExperienceBlockRendererProps){const b=phoneRows(props),cohort=phoneField(props,"cohortFieldRef"),period=phoneField(props,"periodFieldRef"),rate=phoneField(props,"rateFieldRef");if(!b||!cohort||!period||!rate)return <PhoneAnalysisChart props={props} testid="phone-cohort-retention-chart" hint="留存图尚未绑定队列、周期和留存率"/>;const xs=Array.from(new Set(b.rows.map(r=>String(r.values?.[period]??"")).filter(Boolean))).slice(0,8),ys=Array.from(new Set(b.rows.map(r=>String(r.values?.[cohort]??"")).filter(Boolean))).slice(0,8),map=new Map(b.rows.flatMap(r=>{const raw=r.values?.[rate];return raw==null||raw===""||!Number.isFinite(Number(raw))?[]:[[`${r.values?.[cohort]}\u0000${r.values?.[period]}`,Number(raw)] as const]})),data=ys.flatMap((y,yi)=>xs.flatMap((x,xi)=>map.has(`${y}\u0000${x}`)?[[xi,yi,map.get(`${y}\u0000${x}`)]]:[])),max=Math.max(1,...data.map(x=>Number(x[2]))),option=data.length?{animation:false,grid:{left:4,right:4,top:4,bottom:8,containLabel:true},xAxis:{type:"category",data:xs,axisLabel:{fontSize:8}},yAxis:{type:"category",data:ys,axisLabel:{fontSize:8}},visualMap:{min:0,max,show:false,inRange:{color:["#f6ffed","#1677ff"]}},series:[{type:"heatmap",data}]}:undefined;return <PhoneAnalysisChart props={props} testid="phone-cohort-retention-chart" option={option} hint="当前没有完整的留存队列"/>}
function PhoneUptimeStatusTimeline(props:ExperienceBlockRendererProps){const b=phoneRows(props),time=phoneField(props,"timeFieldRef"),status=phoneField(props,"statusFieldRef");if(!b||!time||!status)return <PhoneAnalysisChart props={props} testid="phone-uptime-status-timeline" hint="时间线尚未绑定时间和状态"/>;const rows=[...b.rows].sort((a,c)=>String(a.values?.[time]).localeCompare(String(c.values?.[time]))),colors:Record<string,string>={success:"#52c41a",synced:"#52c41a",running:"#1677ff",failed:"#ff4d4f",error:"#ff4d4f",warning:"#faad14",unknown:"#d9d9d9"},option=rows.length?{animation:false,grid:{left:4,right:4,top:8,bottom:8,containLabel:true},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time])),axisLabel:{fontSize:8}},yAxis:{show:false,min:0,max:1},series:[{type:"bar",barWidth:"70%",data:rows.map(r=>({value:1,itemStyle:{color:colors[String(r.values?.[status]??"unknown").toLowerCase()]??colors.unknown}}))}]}:undefined;return <PhoneAnalysisChart props={props} testid="phone-uptime-status-timeline" option={option} hint="当前没有运行窗口"/>}
function PhonePercentileBandChart(props:ExperienceBlockRendererProps){const b=phoneRows(props),time=phoneField(props,"timeFieldRef"),p50=phoneField(props,"p50FieldRef"),p95=phoneField(props,"p95FieldRef"),p99=phoneField(props,"p99FieldRef");if(!b||!time||!p50||!p95||!p99)return <PhoneAnalysisChart props={props} testid="phone-percentile-band-chart" hint="分位图尚未绑定时间和分位字段"/>;const numeric=(input:unknown)=>input==null||input===""||!Number.isFinite(Number(input))?null:Number(input),rows=[...b.rows].sort((a,c)=>String(a.values?.[time]).localeCompare(String(c.values?.[time]))),option=rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},grid:{left:4,right:4,top:8,bottom:8,containLabel:true},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time])),axisLabel:{fontSize:8}},yAxis:{type:"value"},series:[{name:"P50",type:"line",connectNulls:false,data:rows.map(r=>numeric(r.values?.[p50]))},{name:"P95",type:"line",connectNulls:false,data:rows.map(r=>numeric(r.values?.[p95]))},{name:"P99",type:"line",connectNulls:false,data:rows.map(r=>numeric(r.values?.[p99]))}]}:undefined;return <PhoneAnalysisChart props={props} testid="phone-percentile-band-chart" option={option} hint="当前没有分位数据"/>}

function PhoneConnectionFleetMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),status=phoneField(props,"statusFieldRef");if(!b||!status)return <PhoneShell block={props.block} testid="phone-connection-fleet-metrics"><MobileEmpty description="连接指标尚未绑定状态字段"/></PhoneShell>;const states=[["healthy","健康"],["failed","失败"],["running","运行中"],["queued","排队"],["paused","暂停"],["notSynced","未同步"]];return <PhoneShell block={props.block} title={titleOf(props)||"连接状态"} testid="phone-connection-fleet-metrics"><Grid columns={3} gap={6}>{states.map(([key,label])=><Grid.Item key={key}><Button block size="small" onClick={()=>props.onAction?.("filterChange",{status:key,targets:phoneTargets(props),page:1})}><small>{label}</small><div style={{fontWeight:600}}>{b.rows.filter(r=>String(r.values?.[status])===key).length}</div></Button></Grid.Item>)}</Grid></PhoneShell>}
function PhoneIssueImpactMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),events=phoneField(props,"eventCountFieldRef"),users=phoneField(props,"userCountFieldRef"),first=phoneField(props,"firstSeenFieldRef"),last=phoneField(props,"lastSeenFieldRef"),r=b?.rows[0];if(!b||!events||!users||!r)return <PhoneShell block={props.block} testid="phone-issue-impact-metrics"><MobileEmpty description="问题影响尚未绑定事件和用户数"/></PhoneShell>;const items=[["事件",r.values?.[events]??0],["受影响用户",r.values?.[users]??0],...(first?[["首次发生",r.values?.[first]??"-"]]:[]),...(last?[["最近发生",r.values?.[last]??"-"]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"问题影响"} testid="phone-issue-impact-metrics"><Grid columns={2} gap={8}>{items.map(([label,value])=><Grid.Item key={String(label)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(label)}</small><div style={{fontWeight:600}}>{String(value)}</div></div></Grid.Item>)}</Grid></PhoneShell>}
function PhoneReleaseHealthStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),version=phoneField(props,"versionFieldRef"),health=phoneField(props,"healthFieldRef"),env=phoneField(props,"environmentFieldRef"),adoption=phoneField(props,"adoptionFieldRef"),r=b?.rows[0];if(!b||!version||!health||!r)return <PhoneShell block={props.block} testid="phone-release-health-strip"><MobileEmpty description="发布健康尚未绑定版本和健康率"/></PhoneShell>;return <PhoneShell block={props.block} testid="phone-release-health-strip"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}><div><strong>{String(r.values?.[version]??"版本")}</strong><div style={{fontSize:12,color:"#666"}}>{env?String(r.values?.[env]??"全部环境"):"全部环境"}</div></div><div style={{textAlign:"right"}}><strong>{Number(r.values?.[health]??0)}%</strong><div style={{fontSize:12,color:"#666"}}>{adoption?`采用 ${Number(r.values?.[adoption]??0)}%`:"无崩溃"}</div></div></div></PhoneShell>}
function PhoneDashboardCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),star=phoneField(props,"starredFieldRef"),sub=phoneField(props,"subscribedFieldRef"),editable=phoneField(props,"editableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!title||!r)return <PhoneShell block={props.block} testid="phone-dashboard-command-header"><MobileEmpty description="Dashboard 页头尚未绑定标题"/></PhoneShell>;const starred=Boolean(star&&phoneTruthy(r.values?.[star],"starred")),subscribed=Boolean(sub&&phoneTruthy(r.values?.[sub],"subscribed")),can=!editable||phoneTruthy(r.values?.[editable],"editable"),act=(operation:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-dashboard-command-header"><strong>{String(r.values?.[title]??"Dashboard")}</strong><Grid columns={4} gap={5} style={{marginTop:8}}><Grid.Item><Button block size="small" onClick={()=>act(starred?"unstarDashboard":"starDashboard")}>{starred?"已收藏":"收藏"}</Button></Grid.Item><Grid.Item><Button block size="small" onClick={()=>act(subscribed?"unsubscribeDashboard":"subscribeDashboard")}>{subscribed?"退订":"订阅"}</Button></Grid.Item><Grid.Item><Button block size="small" onClick={()=>act("refreshDashboard")}>刷新</Button></Grid.Item><Grid.Item><Button block size="small" color="primary" disabled={!can} onClick={()=>act("editDashboard","editRequest")}>编辑</Button></Grid.Item></Grid></PhoneShell>}

const phoneNullableNumber=(input:unknown)=>input==null||input===""||!Number.isFinite(Number(input))?null:Number(input);
function PhoneDeploymentLatencyChart(props:ExperienceBlockRendererProps){const b=phoneRows(props),time=phoneField(props,"timeFieldRef"),queue=phoneField(props,"queueFieldRef"),pull=phoneField(props,"pullFieldRef"),start=phoneField(props,"startFieldRef"),ready=phoneField(props,"readyFieldRef");if(!b||!time||!queue||!ready)return <PhoneAnalysisChart props={props} testid="phone-deployment-latency-chart" hint="部署耗时尚未绑定时间、排队和就绪字段"/>;const rows=[...b.rows].sort((a,c)=>String(a.values?.[time]).localeCompare(String(c.values?.[time]))),defs:Array<[string,string|undefined]>=[["排队",queue],["拉取",pull],["启动",start],["就绪",ready]],series=defs.flatMap(([name,ref])=>ref?[{name,type:"line",connectNulls:false,data:rows.map(r=>phoneNullableNumber(r.values?.[ref]))}]:[]),option=rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},grid:{left:4,right:4,top:8,bottom:8,containLabel:true},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time])),axisLabel:{fontSize:8}},yAxis:{type:"value"},series}:undefined;return <PhoneAnalysisChart props={props} testid="phone-deployment-latency-chart" option={option} hint="当前没有部署阶段数据"/>}
function PhoneReleaseAdoptionTrendChart(props:ExperienceBlockRendererProps){const b=phoneRows(props),time=phoneField(props,"timeFieldRef"),adoption=phoneField(props,"adoptionFieldRef"),health=phoneField(props,"healthFieldRef");if(!b||!time||!adoption||!health)return <PhoneAnalysisChart props={props} testid="phone-release-adoption-trend-chart" hint="发布趋势尚未绑定时间、采用率和健康率"/>;const rows=[...b.rows].sort((a,c)=>String(a.values?.[time]).localeCompare(String(c.values?.[time]))),option=rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},grid:{left:4,right:4,top:8,bottom:8,containLabel:true},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time])),axisLabel:{fontSize:8}},yAxis:{type:"value",min:0,max:100},series:[{name:"采用率",type:"line",areaStyle:{opacity:.08},connectNulls:false,data:rows.map(r=>phoneNullableNumber(r.values?.[adoption]))},{name:"健康率",type:"line",connectNulls:false,data:rows.map(r=>phoneNullableNumber(r.values?.[health]))}]}:undefined;return <PhoneAnalysisChart props={props} testid="phone-release-adoption-trend-chart" option={option} hint="当前没有发布趋势"/>}
function PhoneFacetFilter(props:ExperienceBlockRendererProps,testid:string,fallback:string){const b=phoneRows(props),facet=phoneField(props,"facetFieldRef"),key=phoneField(props,"keyFieldRef"),title=phoneField(props,"titleFieldRef"),[selected,setSelected]=React.useState<Record<string,string[]>>({});if(!b||!facet||!key||!title)return <PhoneShell block={props.block} testid={testid}><MobileEmpty description={`${fallback}尚未绑定分面、键和标题`}/></PhoneShell>;const groups=Array.from(new Set(b.rows.map(r=>String(r.values?.[facet]??"")).filter(Boolean))),emit=(next:Record<string,string[]>)=>props.onAction?.("filterChange",{facets:next,targets:phoneTargets(props),page:1});return <PhoneShell block={props.block} title={titleOf(props)||fallback} testid={testid}>{groups.map(group=><div key={group} style={{marginBottom:10}}><small>{group}</small><Selector columns={2} multiple value={selected[group]??[]} options={b.rows.filter(r=>String(r.values?.[facet])===group).map(r=>({value:String(r.values?.[key]),label:String(r.values?.[title])}))} onChange={values=>{const next={...selected,[group]:values.map(String)};setSelected(next);emit(next)}}/></div>)}<Button block fill="none" disabled={!Object.values(selected).some(v=>v.length)} onClick={()=>{setSelected({});emit({})}}>清除</Button></PhoneShell>}
function PhoneDeploymentRolloutMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),desired=phoneField(props,"desiredFieldRef"),ready=phoneField(props,"readyFieldRef"),available=phoneField(props,"availableFieldRef"),unavailable=phoneField(props,"unavailableFieldRef"),r=b?.rows[0];if(!b||!desired||!ready||!r)return <PhoneShell block={props.block} testid="phone-deployment-rollout-metrics"><MobileEmpty description="部署指标尚未绑定期望和就绪副本"/></PhoneShell>;const d=Number(r.values?.[desired]??0),rd=Number(r.values?.[ready]??0),items=[["期望",d],["就绪",rd],...(available?[["可用",r.values?.[available]??0]]:[]),...(unavailable?[["不可用",r.values?.[unavailable]??0]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"部署滚动状态"} testid="phone-deployment-rollout-metrics"><Grid columns={2} gap={8}>{items.map(([label,value])=><Grid.Item key={String(label)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(label)}</small><div style={{fontWeight:600}}>{String(value)}</div></div></Grid.Item>)}</Grid><ProgressBar percent={d>0?Math.min(100,rd/d*100):0} style={{marginTop:8}}/></PhoneShell>}
function PhoneReleaseAdoptionMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),adoption=phoneField(props,"adoptionFieldRef"),health=phoneField(props,"healthFieldRef"),events=phoneField(props,"eventCountFieldRef"),users=phoneField(props,"userCountFieldRef"),r=b?.rows[0];if(!b||!adoption||!health||!r)return <PhoneShell block={props.block} testid="phone-release-adoption-metrics"><MobileEmpty description="发布指标尚未绑定采用率和健康率"/></PhoneShell>;const items=[["采用率",`${r.values?.[adoption]??0}%`],["无崩溃率",`${r.values?.[health]??0}%`],...(events?[["事件",r.values?.[events]??0]]:[]),...(users?[["用户",r.values?.[users]??0]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"发布采用"} testid="phone-release-adoption-metrics"><Grid columns={2} gap={8}>{items.map(([label,value])=><Grid.Item key={String(label)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(label)}</small><div style={{fontWeight:600}}>{String(value)}</div></div></Grid.Item>)}</Grid></PhoneShell>}
function PhoneClusterHealthStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),name=phoneField(props,"nameFieldRef"),status=phoneField(props,"statusFieldRef"),nodes=phoneField(props,"nodeCountFieldRef"),version=phoneField(props,"versionFieldRef");if(!b||!name||!status)return <PhoneShell block={props.block} testid="phone-cluster-health-strip"><MobileEmpty description="集群状态尚未绑定名称和状态"/></PhoneShell>;return <PhoneShell block={props.block} testid="phone-cluster-health-strip"><List>{b.rows.map(r=><List.Item key={r.id} description={`${String(r.values?.[status]??"unknown")}${nodes?` · ${r.values?.[nodes]??0} 节点`:""}${version?` · ${r.values?.[version]??""}`:""}`} onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id})}>{String(r.values?.[name]??"集群")}</List.Item>)}</List></PhoneShell>}
function PhoneReleaseEnvironmentStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),version=phoneField(props,"versionFieldRef"),env=phoneField(props,"environmentFieldRef"),status=phoneField(props,"statusFieldRef");if(!b||!version||!env||!status)return <PhoneShell block={props.block} testid="phone-release-environment-strip"><MobileEmpty description="发布环境尚未绑定版本、环境和状态"/></PhoneShell>;return <PhoneShell block={props.block} testid="phone-release-environment-strip"><Selector columns={2} options={b.rows.map(r=>({value:r.id,label:`${r.values?.[env]} · ${r.values?.[version]}`}))} onChange={values=>{const r=b.rows.find(x=>x.id===values[0]);if(r)props.onAction?.("filterChange",{environment:r.values?.[env],version:r.values?.[version],targets:phoneTargets(props)})}}/></PhoneShell>}
function PhoneDeploymentCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),status=phoneField(props,"statusFieldRef"),editable=phoneField(props,"editableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[confirm,setConfirm]=React.useState(false);if(!b||!title||!status||!r)return <PhoneShell block={props.block} testid="phone-deployment-command-header"><MobileEmpty description="部署页头尚未绑定标题和状态"/></PhoneShell>;const can=!editable||phoneTruthy(r.values?.[editable],"editable"),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-deployment-command-header"><strong>{String(r.values?.[title]??"部署")}</strong><div style={{fontSize:12,color:"#666",margin:"4px 0 8px"}}>{String(r.values?.[status])}</div><Grid columns={3} gap={6}><Grid.Item><Button block size="small" onClick={()=>act("viewDeploymentLogs")}>日志</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!can} onClick={()=>act("editDeployment","editRequest")}>编辑</Button></Grid.Item><Grid.Item><Button block size="small" color="danger" disabled={!can} onClick={()=>setConfirm(true)}>重启</Button></Grid.Item></Grid><Popup visible={confirm} onMaskClick={()=>setConfirm(false)} bodyStyle={{padding:16}}><strong>确认滚动重启？</strong><Button block color="danger" style={{marginTop:12}} onClick={()=>{act("restartDeployment","submitRequest");setConfirm(false)}}>确认重启</Button></Popup></PhoneShell>}
function PhoneFeatureFlagCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),enabled=phoneField(props,"enabledFieldRef"),rollout=phoneField(props,"rolloutFieldRef"),editable=phoneField(props,"editableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!title||!enabled||!r)return <PhoneShell block={props.block} testid="phone-feature-flag-command-header"><MobileEmpty description="Feature Flag 页头尚未绑定标题和启用状态"/></PhoneShell>;const active=phoneTruthy(r.values?.[enabled],"enabled"),can=!editable||phoneTruthy(r.values?.[editable],"editable"),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-feature-flag-command-header"><strong>{String(r.values?.[title]??"Feature Flag")}</strong><div style={{fontSize:12,color:active?"#00b578":"#999",margin:"4px 0 8px"}}>{active?"已启用":"已停用"}{rollout?` · 灰度 ${r.values?.[rollout]??0}%`:""}</div><Grid columns={3} gap={6}><Grid.Item><Button block size="small" onClick={()=>act("viewFlagAudit")}>审计</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!can} onClick={()=>act("editFlagRollout","editRequest")}>灰度</Button></Grid.Item><Grid.Item><Button block size="small" color={active?"danger":"primary"} disabled={!can} onClick={()=>act(active?"disableFeatureFlag":"enableFeatureFlag","submitRequest")}>{active?"停用":"启用"}</Button></Grid.Item></Grid></PhoneShell>}
function PhoneDeploymentScaleBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),desired=phoneField(props,"desiredFieldRef"),ready=phoneField(props,"readyFieldRef"),editable=phoneField(props,"editableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[target,setTarget]=React.useState<string>("");if(!b||!desired||!ready||!r)return <PhoneShell block={props.block} testid="phone-deployment-scale-bar"><MobileEmpty description="扩缩容栏尚未绑定期望和就绪副本"/></PhoneShell>;const current=Number(r.values?.[desired]??0),next=target===""?current:Math.max(0,Number(target)||0),can=!editable||phoneTruthy(r.values?.[editable],"editable");return <PhoneShell block={props.block} testid="phone-deployment-scale-bar"><strong>当前 {String(r.values?.[ready]??0)}/{current} 副本就绪</strong><Grid columns={2} gap={8} style={{marginTop:8}}><Grid.Item><Input type="number" value={target} onChange={setTarget} placeholder={String(current)} style={{padding:8,background:"#f5f5f5"}}/></Grid.Item><Grid.Item><Button block color="primary" disabled={!can||next===current} onClick={()=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:"scaleDeployment",desired:next,targets:phoneTargets(props)})}>应用</Button></Grid.Item></Grid></PhoneShell>}
function PhoneReleaseRolloutBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),status=phoneField(props,"statusFieldRef"),adoption=phoneField(props,"adoptionFieldRef"),health=phoneField(props,"healthFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!status||!adoption||!r)return <PhoneShell block={props.block} testid="phone-release-rollout-bar"><MobileEmpty description="发布灰度栏尚未绑定状态和采用率"/></PhoneShell>;const state=String(r.values?.[status]??"active").toLowerCase(),rate=Number(r.values?.[adoption]??0),healthy=!health||Number(r.values?.[health]??0)>=99,submit=(op:string)=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-release-rollout-bar"><strong>灰度采用 {rate}%</strong><ProgressBar percent={Math.min(100,rate)} style={{margin:"8px 0"}}/><Grid columns={2} gap={8}><Grid.Item><Button block onClick={()=>submit(state==="paused"?"resumeReleaseRollout":"pauseReleaseRollout")}>{state==="paused"?"继续灰度":"暂停灰度"}</Button></Grid.Item><Grid.Item><Button block color="primary" disabled={!healthy||rate<100} onClick={()=>submit("completeReleaseRollout")}>完成发布</Button></Grid.Item></Grid></PhoneShell>}

function PhoneCumulativeFlowChart(props:ExperienceBlockRendererProps){const b=phoneRows(props),time=phoneField(props,"timeFieldRef"),state=phoneField(props,"stateFieldRef"),value=phoneField(props,"valueFieldRef");if(!b||!time||!state)return <PhoneAnalysisChart props={props} testid="phone-cumulative-flow-chart" hint="累计流尚未绑定时间和状态"/>;const dates=Array.from(new Set(b.rows.map(r=>String(r.values?.[time]??"")).filter(Boolean))).sort(),states=Array.from(new Set(b.rows.map(r=>String(r.values?.[state]??"")).filter(Boolean))),map=new Map<string,number>();b.rows.forEach(r=>{const k=`${r.values?.[time]}\u0000${r.values?.[state]}`;map.set(k,(map.get(k)??0)+(value?Number(r.values?.[value]??0):1))});const option=dates.length?{animation:false,tooltip:{trigger:"axis",confine:true},grid:{left:4,right:4,top:8,bottom:8,containLabel:true},xAxis:{type:"category",data:dates,axisLabel:{fontSize:8}},yAxis:{type:"value",minInterval:1},series:states.map(s=>({name:s,type:"line",stack:"flow",areaStyle:{opacity:.35},symbol:"none",data:dates.map(d=>map.get(`${d}\u0000${s}`)??0)}))}:undefined;return <PhoneAnalysisChart props={props} testid="phone-cumulative-flow-chart" option={option} hint="当前没有累计流数据"/>}
function PhoneBookingDemandChart(props:ExperienceBlockRendererProps){const b=phoneRows(props),time=phoneField(props,"timeFieldRef"),available=phoneField(props,"availableFieldRef"),booked=phoneField(props,"bookedFieldRef"),canceled=phoneField(props,"canceledFieldRef");if(!b||!time||!available||!booked)return <PhoneAnalysisChart props={props} testid="phone-booking-demand-chart" hint="预约需求尚未绑定时间、可用和已预约字段"/>;const rows=[...b.rows].sort((a,c)=>String(a.values?.[time]).localeCompare(String(c.values?.[time]))),defs:Array<[string,string]>=[["可用",available],["已预约",booked],...(canceled?[["已取消",canceled] as [string,string]]:[])],option=rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},grid:{left:4,right:4,top:8,bottom:8,containLabel:true},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time])),axisLabel:{fontSize:8}},yAxis:{type:"value",minInterval:1},series:defs.map(([name,ref])=>({name,type:"line",connectNulls:false,data:rows.map(r=>phoneNullableNumber(r.values?.[ref]))}))}:undefined;return <PhoneAnalysisChart props={props} testid="phone-booking-demand-chart" option={option} hint="当前没有预约需求数据"/>}
function PhoneWorkloadThroughputMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),completed=phoneField(props,"completedFieldRef"),entered=phoneField(props,"enteredFieldRef"),wip=phoneField(props,"wipFieldRef"),blocked=phoneField(props,"blockedFieldRef"),r=b?.rows[0];if(!b||!completed||!entered||!r)return <PhoneShell block={props.block} testid="phone-workload-throughput-metrics"><MobileEmpty description="吞吐指标尚未绑定完成和进入量"/></PhoneShell>;const done=Number(r.values?.[completed]??0),input=Number(r.values?.[entered]??0),items=[["已完成",done],["进入量",input],["完成率",`${input>0?Math.round(done/input*100):0}%`],...(wip?[["在制",r.values?.[wip]??0]]:[]),...(blocked?[["阻塞",r.values?.[blocked]??0]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"工作流吞吐"} testid="phone-workload-throughput-metrics"><Grid columns={2} gap={8}>{items.map(([label,val])=><Grid.Item key={String(label)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(label)}</small><div style={{fontWeight:600}}>{String(val)}</div></div></Grid.Item>)}</Grid></PhoneShell>}
function PhoneCalendarUtilizationMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),available=phoneField(props,"availableFieldRef"),booked=phoneField(props,"bookedFieldRef"),canceled=phoneField(props,"canceledFieldRef"),noShow=phoneField(props,"noShowFieldRef"),r=b?.rows[0];if(!b||!available||!booked||!r)return <PhoneShell block={props.block} testid="phone-calendar-utilization-metrics"><MobileEmpty description="利用率尚未绑定可用和已预约分钟"/></PhoneShell>;const total=Number(r.values?.[available]??0),used=Number(r.values?.[booked]??0),rate=total>0?Math.round(used/total*100):0;return <PhoneShell block={props.block} title={titleOf(props)||"日历利用率"} testid="phone-calendar-utilization-metrics"><strong>利用率 {rate}%</strong><ProgressBar percent={rate} style={{margin:"8px 0"}}/><Grid columns={3} gap={6}><Grid.Item>预约 {used} 分</Grid.Item><Grid.Item>取消 {canceled?Number(r.values?.[canceled]??0):0}</Grid.Item><Grid.Item>未到 {noShow?Number(r.values?.[noShow]??0):0}</Grid.Item></Grid></PhoneShell>}
function PhoneCycleRiskStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),remaining=phoneField(props,"remainingFieldRef"),blocked=phoneField(props,"blockedFieldRef"),overdue=phoneField(props,"overdueFieldRef"),r=b?.rows[0];if(!b||!title||!remaining||!r)return <PhoneShell block={props.block} testid="phone-cycle-risk-strip"><MobileEmpty description="周期风险尚未绑定标题和剩余天数"/></PhoneShell>;return <PhoneShell block={props.block} testid="phone-cycle-risk-strip"><List.Item description={`剩余 ${r.values?.[remaining]??0} 天${blocked?` · 阻塞 ${r.values?.[blocked]??0}`:""}${overdue?` · 超期 ${r.values?.[overdue]??0}`:""}`} onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id})}>{String(r.values?.[title])}</List.Item></PhoneShell>}
function PhoneCalendarConnectionStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),account=phoneField(props,"accountFieldRef"),status=phoneField(props,"statusFieldRef"),provider=phoneField(props,"providerFieldRef"),synced=phoneField(props,"syncedAtFieldRef");if(!b||!account||!status)return <PhoneShell block={props.block} testid="phone-calendar-connection-strip"><MobileEmpty description="日历连接尚未绑定账号和状态"/></PhoneShell>;return <PhoneShell block={props.block} testid="phone-calendar-connection-strip"><List>{b.rows.map(r=>{const ok=["synced","healthy","connected"].includes(String(r.values?.[status]).toLowerCase());return <List.Item key={r.id} description={`${String(r.values?.[status])}${synced?` · ${String(r.values?.[synced]??"")}`:""}`} extra={!ok?<Button size="mini" onClick={()=>props.onAction?.("actionTrigger",{entityRef:b.entityRef,rowId:r.id,operation:"retryCalendarSync",targets:phoneTargets(props)})}>重试</Button>:undefined}>{provider?`${String(r.values?.[provider])} · `:""}{String(r.values?.[account])}</List.Item>})}</List></PhoneShell>}
function PhoneWorkItemMoveDrawer(props:ExperienceBlockRendererProps){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),group=phoneField(props,"groupFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0],[open,setOpen]=React.useState(false),[target,setTarget]=React.useState<string[]>([]);if(!b||!title||!group||!r)return <PhoneShell block={props.block} testid="phone-work-item-move-drawer"><MobileEmpty description="移动任务尚未绑定标题和分组"/></PhoneShell>;const current=String(r.values?.[group]??""),options=Array.from(new Set(b.rows.map(x=>String(x.values?.[group]??"")).filter(v=>v&&v!==current))).map(v=>({value:v,label:v}));return <PhoneShell block={props.block} testid="phone-work-item-move-drawer"><Button block onClick={()=>setOpen(true)}>移动 {String(r.values?.[title])}</Button><Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:16}}><strong>当前分组：{current}</strong><Selector columns={2} value={target} options={options} onChange={setTarget} style={{margin:"12px 0"}}/><Button block color="primary" disabled={!target[0]} onClick={()=>{props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:"moveWorkItem",targetGroup:target[0],targets:phoneTargets(props)});setOpen(false)}}>确认移动</Button></Popup></PhoneShell>}
function PhoneBookingConflictDrawer(props:ExperienceBlockRendererProps){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),start=phoneField(props,"startFieldRef"),end=phoneField(props,"endFieldRef"),severity=phoneField(props,"severityFieldRef"),[open,setOpen]=React.useState(false);if(!b||!title||!start||!end)return <PhoneShell block={props.block} testid="phone-booking-conflict-drawer"><MobileEmpty description="冲突处理尚未绑定标题和时间范围"/></PhoneShell>;return <PhoneShell block={props.block} testid="phone-booking-conflict-drawer"><Button block color={b.rows.length?"danger":"default"} onClick={()=>setOpen(true)}>查看冲突 {b.rows.length}</Button><Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:12,maxHeight:"75vh",overflow:"auto"}}><strong>预约冲突</strong>{b.rows.length===0?<MobileEmpty description="当前没有冲突"/>:<List>{b.rows.map(r=><List.Item key={r.id} description={`${String(r.values?.[start])} - ${String(r.values?.[end])}${severity?` · ${String(r.values?.[severity])}`:""}`} extra={<Button size="mini" onClick={()=>props.onAction?.("editRequest",{entityRef:b.entityRef,rowId:r.id,operation:"rescheduleBooking",targets:phoneTargets(props)})}>改期</Button>}>{String(r.values?.[title])}</List.Item>)}</List>}</Popup></PhoneShell>}

function PhoneWorkflowDurationChart(props:ExperienceBlockRendererProps){const b=phoneRows(props),time=phoneField(props,"timeFieldRef"),average=phoneField(props,"averageFieldRef"),p95=phoneField(props,"p95FieldRef"),failed=phoneField(props,"failedFieldRef");if(!b||!time||!average||!p95)return <PhoneAnalysisChart props={props} testid="phone-workflow-duration-chart" hint="耗时趋势尚未绑定时间、平均和 P95"/>;const rows=[...b.rows].sort((a,c)=>String(a.values?.[time]).localeCompare(String(c.values?.[time]))),defs:Array<[string,string]>=[["平均",average],["P95",p95],...(failed?[["失败耗时",failed] as [string,string]]:[])],option=rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},grid:{left:4,right:4,top:8,bottom:8,containLabel:true},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time])),axisLabel:{fontSize:8}},yAxis:{type:"value"},series:defs.map(([name,ref])=>({name,type:"line",connectNulls:false,data:rows.map(r=>phoneNullableNumber(r.values?.[ref]))}))}:undefined;return <PhoneAnalysisChart props={props} testid="phone-workflow-duration-chart" option={option} hint="当前没有工作流耗时数据"/>}
function PhoneWorkflowOutcomeMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),success=phoneField(props,"successFieldRef"),failed=phoneField(props,"failedFieldRef"),running=phoneField(props,"runningFieldRef"),pending=phoneField(props,"pendingFieldRef"),r=b?.rows[0];if(!b||!success||!failed||!r)return <PhoneShell block={props.block} testid="phone-workflow-outcome-metrics"><MobileEmpty description="结果指标尚未绑定成功和失败数"/></PhoneShell>;const ok=Number(r.values?.[success]??0),bad=Number(r.values?.[failed]??0),ended=ok+bad,items=[["成功",ok],["失败",bad],["成功率",`${ended?Math.round(ok/ended*100):0}%`],...(running?[["运行中",r.values?.[running]??0]]:[]),...(pending?[["等待",r.values?.[pending]??0]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"执行结果"} testid="phone-workflow-outcome-metrics"><Grid columns={2} gap={8}>{items.map(([label,val])=><Grid.Item key={String(label)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(label)}</small><div style={{fontWeight:600}}>{String(val)}</div></div></Grid.Item>)}</Grid></PhoneShell>}
function PhoneWorkflowVersionStrip(props:ExperienceBlockRendererProps){const b=phoneRows(props),name=phoneField(props,"nameFieldRef"),version=phoneField(props,"versionFieldRef"),enabled=phoneField(props,"enabledFieldRef"),updated=phoneField(props,"updatedAtFieldRef"),r=b?.rows[0];if(!b||!name||!version||!enabled||!r)return <PhoneShell block={props.block} testid="phone-workflow-version-strip"><MobileEmpty description="工作流版本尚未绑定名称、版本和状态"/></PhoneShell>;return <PhoneShell block={props.block} testid="phone-workflow-version-strip"><List.Item description={`${phoneTruthy(r.values?.[enabled],"enabled")?"已启用":"已停用"}${updated?` · ${String(r.values?.[updated]??"")}`:""}`} onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id})}>{String(r.values?.[name])} · {String(r.values?.[version])}</List.Item></PhoneShell>}
function PhoneWorkflowFailureDrawer(props:ExperienceBlockRendererProps){const b=phoneRows(props),node=phoneField(props,"nodeFieldRef"),message=phoneField(props,"messageFieldRef"),status=phoneField(props,"statusFieldRef"),time=phoneField(props,"timeFieldRef"),[open,setOpen]=React.useState(false);if(!b||!node||!message||!status)return <PhoneShell block={props.block} testid="phone-workflow-failure-drawer"><MobileEmpty description="失败诊断尚未绑定节点、错误和状态"/></PhoneShell>;const rows=b.rows.filter(r=>["failed","aborted","rejected"].includes(String(r.values?.[status]).toLowerCase()));return <PhoneShell block={props.block} testid="phone-workflow-failure-drawer"><Button block color={rows.length?"danger":"default"} onClick={()=>setOpen(true)}>失败诊断 {rows.length}</Button><Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:12,maxHeight:"75vh",overflow:"auto"}}>{rows.length===0?<MobileEmpty description="没有失败执行"/>:<List>{rows.map(r=><List.Item key={r.id} description={`${String(r.values?.[message])}${time?` · ${String(r.values?.[time]??"")}`:""}`} extra={<Button size="mini" onClick={()=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:"retryWorkflowExecution",targets:phoneTargets(props)})}>重试</Button>}>{String(r.values?.[node])}</List.Item>)}</List>}</Popup></PhoneShell>}
function PhoneWorkflowCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),enabled=phoneField(props,"enabledFieldRef"),version=phoneField(props,"versionFieldRef"),editable=phoneField(props,"editableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!title||!enabled||!r)return <PhoneShell block={props.block} testid="phone-workflow-command-header"><MobileEmpty description="工作流页头尚未绑定标题和状态"/></PhoneShell>;const active=phoneTruthy(r.values?.[enabled],"enabled"),can=!editable||phoneTruthy(r.values?.[editable],"editable"),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-workflow-command-header"><strong>{String(r.values?.[title])}</strong><div style={{fontSize:12,color:active?"#00b578":"#999",margin:"4px 0 8px"}}>{active?"已启用":"已停用"}{version?` · ${String(r.values?.[version]??"")}`:""}</div><Grid columns={4} gap={5}><Grid.Item><Button block size="small" disabled={!active} onClick={()=>act("runWorkflow")}>运行</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!can} onClick={()=>act("editWorkflow","editRequest")}>编辑</Button></Grid.Item><Grid.Item><Button block size="small" onClick={()=>act("duplicateWorkflow")}>复制</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!can} onClick={()=>act(active?"disableWorkflow":"enableWorkflow","submitRequest")}>{active?"停用":"启用"}</Button></Grid.Item></Grid></PhoneShell>}
function PhoneWorkflowControlBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),status=phoneField(props,"statusFieldRef"),progress=phoneField(props,"progressFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!status||!r)return <PhoneShell block={props.block} testid="phone-workflow-control-bar"><MobileEmpty description="执行控制尚未绑定状态"/></PhoneShell>;const state=String(r.values?.[status]??"pending").toLowerCase(),started=["started","running"].includes(state),retryable=["failed","aborted","rejected"].includes(state),submit=(op:string)=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-workflow-control-bar"><strong>{state}</strong>{progress&&started&&<ProgressBar percent={Math.min(100,Number(r.values?.[progress]??0))} style={{margin:"8px 0"}}/>}<Grid columns={3} gap={6} style={{marginTop:8}}><Grid.Item><Button block size="small" onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id})}>结果</Button></Grid.Item><Grid.Item><Button block size="small" color="danger" disabled={!started} onClick={()=>submit("cancelWorkflowExecution")}>取消</Button></Grid.Item><Grid.Item><Button block size="small" color="primary" disabled={!retryable} onClick={()=>submit("retryWorkflowExecution")}>重试</Button></Grid.Item></Grid></PhoneShell>}
function PhoneRealmCommandHeader(props:ExperienceBlockRendererProps){const b=phoneRows(props),name=phoneField(props,"nameFieldRef"),enabled=phoneField(props,"enabledFieldRef"),manageable=phoneField(props,"manageableFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!name||!enabled||!r)return <PhoneShell block={props.block} testid="phone-realm-command-header"><MobileEmpty description="Realm 页头尚未绑定名称和状态"/></PhoneShell>;const active=phoneTruthy(r.values?.[enabled],"enabled"),can=!manageable||phoneTruthy(r.values?.[manageable],"allowed"),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-realm-command-header"><strong>{String(r.values?.[name])}</strong><div style={{fontSize:12,color:active?"#00b578":"#999",margin:"4px 0 8px"}}>{active?"已启用":"已禁用"}</div><Grid columns={3} gap={6}><Grid.Item><Button block size="small" onClick={()=>act("exportRealm")}>导出</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!can} onClick={()=>act("openRealmSecurity")}>安全</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!can} onClick={()=>act(active?"disableRealm":"enableRealm","submitRequest")}>{active?"禁用":"启用"}</Button></Grid.Item></Grid></PhoneShell>}
function PhoneCredentialLifecycleBar(props:ExperienceBlockRendererProps){const b=phoneRows(props),username=phoneField(props,"usernameFieldRef"),resettable=phoneField(props,"resettableFieldRef"),temporary=phoneField(props,"temporaryFieldRef"),updated=phoneField(props,"updatedAtFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!username||!resettable||!r)return <PhoneShell block={props.block} testid="phone-credential-lifecycle-bar"><MobileEmpty description="凭据生命周期尚未绑定用户和可重置状态"/></PhoneShell>;const can=phoneTruthy(r.values?.[resettable],"allowed"),temp=Boolean(temporary&&phoneTruthy(r.values?.[temporary],"temporary")),submit=(op:string,event="submitRequest")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid="phone-credential-lifecycle-bar"><strong>{String(r.values?.[username])}</strong><div style={{fontSize:12,color:"#666",margin:"4px 0 8px"}}>{temp?"临时密码":"持久密码"}{updated?` · ${String(r.values?.[updated]??"")}`:""}</div><Grid columns={3} gap={6}><Grid.Item><Button block size="small" disabled={!can} onClick={()=>submit("resetPassword","editRequest")}>重置</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!can} onClick={()=>submit("sendResetCredentialEmail")}>邮件</Button></Grid.Item><Grid.Item><Button block size="small" disabled={!can} onClick={()=>submit("requirePasswordUpdate")}>下次更新</Button></Grid.Item></Grid></PhoneShell>}

function PhoneMultiSeriesChart(props:ExperienceBlockRendererProps,testid:string,defs:Array<[string,string]>,fallback:string){const b=phoneRows(props),time=phoneField(props,"timeFieldRef"),resolved=defs.map(([label,key])=>[label,phoneField(props,key)] as const);if(!b||!time||resolved.slice(0,2).some(([,ref])=>!ref))return <PhoneAnalysisChart props={props} testid={testid} hint={`${fallback}尚未绑定必要字段`}/>;const rows=[...b.rows].sort((a,c)=>String(a.values?.[time]).localeCompare(String(c.values?.[time]))),option=rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},grid:{left:4,right:4,top:8,bottom:8,containLabel:true},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time])),axisLabel:{fontSize:8}},yAxis:{type:"value"},series:resolved.flatMap(([name,ref])=>ref?[{name,type:"line",connectNulls:false,data:rows.map(r=>phoneNullableNumber(r.values?.[ref]))}]:[])}:undefined;return <PhoneAnalysisChart props={props} testid={testid} option={option} hint="当前没有趋势数据"/>}
const PhonePanelQueryLatencyChart=(props:ExperienceBlockRendererProps)=>PhoneMultiSeriesChart(props,"phone-panel-query-latency-chart",[["平均","averageFieldRef"],["P95","p95FieldRef"],["超时","timeoutFieldRef"]],"面板查询延迟");
const PhoneSyncVolumeTrendChart=(props:ExperienceBlockRendererProps)=>PhoneMultiSeriesChart(props,"phone-sync-volume-trend-chart",[["记录","recordsFieldRef"],["字节","bytesFieldRef"],["失败","failedFieldRef"]],"同步数据量");
function PhoneDatasourceQueryMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),req=phoneField(props,"requestFieldRef"),err=phoneField(props,"errorFieldRef"),cache=phoneField(props,"cacheHitFieldRef"),duration=phoneField(props,"durationFieldRef"),r=b?.rows[0];if(!b||!req||!err||!r)return <PhoneShell block={props.block} testid="phone-datasource-query-metrics"><MobileEmpty description="查询指标尚未绑定请求和错误数"/></PhoneShell>;const total=Number(r.values?.[req]??0),items=[["请求",total],["错误率",`${total?Math.round(Number(r.values?.[err]??0)/total*100):0}%`],...(cache?[["缓存命中",`${total?Math.round(Number(r.values?.[cache]??0)/total*100):0}%`]]:[]),...(duration?[["平均耗时",`${r.values?.[duration]??0} ms`]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"数据源查询"} testid="phone-datasource-query-metrics"><Grid columns={2} gap={8}>{items.map(([l,v])=><Grid.Item key={String(l)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(l)}</small><div style={{fontWeight:600}}>{String(v)}</div></div></Grid.Item>)}</Grid></PhoneShell>}
function PhoneStreamFreshnessMetrics(props:ExperienceBlockRendererProps){const b=phoneRows(props),lag=phoneField(props,"lagFieldRef"),synced=phoneField(props,"syncedAtFieldRef"),records=phoneField(props,"recordsFieldRef"),failed=phoneField(props,"failedFieldRef"),r=b?.rows[0];if(!b||!lag||!synced||!r)return <PhoneShell block={props.block} testid="phone-stream-freshness-metrics"><MobileEmpty description="新鲜度尚未绑定延迟和同步时间"/></PhoneShell>;const items=[["延迟",`${r.values?.[lag]??0} 分钟`],["最近同步",r.values?.[synced]??"未同步"],...(records?[["记录",r.values?.[records]??0]]:[]),...(failed?[["失败",r.values?.[failed]??0]]:[])];return <PhoneShell block={props.block} title={titleOf(props)||"数据流新鲜度"} testid="phone-stream-freshness-metrics"><Grid columns={2} gap={8}>{items.map(([l,v])=><Grid.Item key={String(l)}><div style={{padding:9,background:"#f5f5f5",borderRadius:6}}><small>{String(l)}</small><div style={{fontWeight:600}}>{String(v)}</div></div></Grid.Item>)}</Grid></PhoneShell>}
function PhoneStatusStrip(props:ExperienceBlockRendererProps,testid:string,fallback:string){const b=phoneRows(props),name=phoneField(props,"nameFieldRef"),status=phoneField(props,"statusFieldRef"),type=phoneField(props,"typeFieldRef"),version=phoneField(props,"versionFieldRef"),extra=phoneField(props,"checkedAtFieldRef")??phoneField(props,"availableVersionFieldRef");if(!b||!name||!status)return <PhoneShell block={props.block} testid={testid}><MobileEmpty description={`${fallback}尚未绑定名称和状态`}/></PhoneShell>;return <PhoneShell block={props.block} testid={testid}><List>{b.rows.map(r=><List.Item key={r.id} description={`${String(r.values?.[status])}${type?` · ${String(r.values?.[type]??"")}`:""}${version?` · ${String(r.values?.[version]??"")}`:""}${extra?` · ${String(r.values?.[extra]??"")}`:""}`} extra={<Button size="mini" onClick={()=>props.onAction?.("actionTrigger",{entityRef:b.entityRef,rowId:r.id,operation:"retryStatusCheck",targets:phoneTargets(props)})}>检查</Button>}>{String(r.values?.[name])}</List.Item>)}</List></PhoneShell>}
function PhoneCommandHeader(props:ExperienceBlockRendererProps,testid:string,fallback:string){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),status=phoneField(props,"statusFieldRef"),editable=phoneField(props,"editableFieldRef"),dirty=phoneField(props,"dirtyFieldRef"),refreshing=phoneField(props,"refreshingFieldRef"),source=phoneField(props,"datasourceFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!title||!r)return <PhoneShell block={props.block} testid={testid}><MobileEmpty description={`${fallback}尚未绑定标题`}/></PhoneShell>;const can=!editable||phoneTruthy(r.values?.[editable],"editable"),busy=Boolean(refreshing&&phoneTruthy(r.values?.[refreshing],"refreshing")),changed=Boolean(dirty&&phoneTruthy(r.values?.[dirty],"dirty")),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid={testid}><strong>{String(r.values?.[title])}</strong><div style={{fontSize:12,color:"#666",margin:"4px 0 8px"}}>{status?String(r.values?.[status]??""):""}{source?` · ${String(r.values?.[source]??"")}`:""}</div><Grid columns={3} gap={6}><Grid.Item><Button block size="small" disabled={busy} onClick={()=>act("refresh")}>刷新</Button></Grid.Item><Grid.Item><Button block size="small" onClick={()=>act("inspect")}>检查</Button></Grid.Item><Grid.Item><Button block size="small" color="primary" disabled={!can||busy} onClick={()=>act(changed?"save":"edit","editRequest")}>{changed?"保存":"编辑"}</Button></Grid.Item></Grid></PhoneShell>}
const PhonePanelCommandHeader=(props:ExperienceBlockRendererProps)=>PhoneCommandHeader(props,"phone-panel-command-header","面板页头");
function PhoneRuntimeControl(props:ExperienceBlockRendererProps,testid:string,fallback:string){const b=phoneRows(props),status=phoneField(props,"statusFieldRef"),query=phoneField(props,"queryFieldRef"),refreshing=phoneField(props,"refreshingFieldRef"),dirty=phoneField(props,"dirtyFieldRef"),r=b?.rows.find(x=>x.id===props.focus?.[b.entityRef])??b?.rows[0];if(!b||!status||!r)return <PhoneShell block={props.block} testid={testid}><MobileEmpty description={`${fallback}尚未绑定状态`}/></PhoneShell>;const state=String(r.values?.[status]??"idle").toLowerCase(),busy=["running","refreshing"].includes(state)||Boolean(refreshing&&phoneTruthy(r.values?.[refreshing],"refreshing")),changed=Boolean(dirty&&phoneTruthy(r.values?.[dirty],"dirty")),canRun=!query||Boolean(String(r.values?.[query]??"").trim()),act=(op:string,event="actionTrigger")=>props.onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:phoneTargets(props)});return <PhoneShell block={props.block} testid={testid}><strong>{state}</strong><Grid columns={3} gap={6} style={{marginTop:8}}><Grid.Item><Button block size="small" onClick={()=>act("inspect")}>检查</Button></Grid.Item><Grid.Item><Button block size="small" color="danger" disabled={!busy} onClick={()=>act("cancel","submitRequest")}>取消</Button></Grid.Item><Grid.Item><Button block size="small" color="primary" disabled={busy||(!canRun&&!changed)} onClick={()=>act(changed?"save":"run",changed?"editRequest":"submitRequest")}>{changed?"保存":"运行"}</Button></Grid.Item></Grid></PhoneShell>}
const PhoneExploreQueryControlBar=(props:ExperienceBlockRendererProps)=>PhoneRuntimeControl(props,"phone-explore-query-control-bar","查询控制");
function PhoneDiagnosticDrawer(props:ExperienceBlockRendererProps,testid:string,fallback:string,refKey:string,messageKey:string,statusKey:string){const b=phoneRows(props),ref=phoneField(props,refKey),message=phoneField(props,messageKey),status=phoneField(props,statusKey),[open,setOpen]=React.useState(false);if(!b||!ref||!message||!status)return <PhoneShell block={props.block} testid={testid}><MobileEmpty description={`${fallback}尚未绑定诊断字段`}/></PhoneShell>;const rows=b.rows.filter(r=>!["ok","healthy","resolved","no_change"].includes(String(r.values?.[status]).toLowerCase()));return <PhoneShell block={props.block} testid={testid}><Button block color={rows.length?"danger":"default"} onClick={()=>setOpen(true)}>{fallback} {rows.length}</Button><Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:12,maxHeight:"75vh",overflow:"auto"}}>{rows.length===0?<MobileEmpty description="当前没有异常"/>:<List>{rows.map(r=><List.Item key={r.id} description={String(r.values?.[message])} extra={<Button size="mini" onClick={()=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:"resolveDiagnostic",targets:phoneTargets(props)})}>处理</Button>}>{String(r.values?.[ref])}</List.Item>)}</List>}</Popup></PhoneShell>}
const PhoneQueryErrorDrawer=(props:ExperienceBlockRendererProps)=>PhoneDiagnosticDrawer(props,"phone-query-error-drawer","查询错误","refFieldRef","messageFieldRef","statusFieldRef");
const PhoneSchemaConflictDrawer=(props:ExperienceBlockRendererProps)=>PhoneDiagnosticDrawer(props,"phone-schema-conflict-drawer","Schema 冲突","streamFieldRef","fieldFieldRef","changeFieldRef");

type PhoneKanbanVariant = "swimlane"|"wip"|"backlog"|"sprint"|"dependency"|"triage"|"approval"|"content"|"recruitment"|"incident"|"release"|"portfolio";
const PHONE_KANBAN_TITLES:Record<PhoneKanbanVariant,string>={swimlane:"泳道看板",wip:"WIP 限制看板",backlog:"待办优先级",sprint:"迭代规划",dependency:"依赖看板",triage:"分诊队列",approval:"审批阶段",content:"内容流水线",recruitment:"招聘流水线",incident:"事件响应",release:"发布列车",portfolio:"组合看板"};
function PhoneMatureKanban(props:ExperienceBlockRendererProps & {variant:PhoneKanbanVariant}){
  const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),status=phoneField(props,"statusFieldRef"),lane=phoneField(props,"laneFieldRef"),priority=phoneField(props,"priorityFieldRef"),blocked=phoneField(props,"blockedFieldRef"),limit=phoneField(props,"limitFieldRef"),progress=phoneField(props,"progressFieldRef"),owner=phoneField(props,"ownerFieldRef");
  const [active,setActive]=React.useState(""),[moving,setMoving]=React.useState<string|null>(null),[moves,setMoves]=React.useState<Record<string,string>>({}),[selected,setSelected]=React.useState<string[]>([]);
  if(!b||!title||!status)return <PhoneShell block={props.block} testid={`phone-mature-kanban-${props.variant}`}><MobileEmpty description={`${PHONE_KANBAN_TITLES[props.variant]}尚未绑定标题和状态字段`}/></PhoneShell>;
  const statusOf=(r:(typeof b.rows)[number])=>moves[r.id]??String(r.values?.[status]??"未分组"),statuses=Array.from(new Set(b.rows.map(statusOf).filter(Boolean))),current=active&&statuses.includes(active)?active:statuses[0]??"";
  const sorted=[...b.rows].sort((a,c)=>(["backlog","triage","incident"].includes(props.variant)?Number(c.values?.[priority??""]??0)-Number(a.values?.[priority??""]??0):0)),shown=sorted.filter(r=>statusOf(r)===current),lanes=lane?Array.from(new Set(shown.map(r=>String(r.values?.[lane]??"未分配")))):["全部"];
  const movingRow=b.rows.find(r=>r.id===moving),moveGuard=(r:(typeof b.rows)[number],target:string)=>{const source=statusOf(r),targetCount=b.rows.filter(x=>statusOf(x)===target).length,rowLimit=Number(r.values?.[limit??""]??props.block.props?.wipLimit??0),isBlocked=Boolean(blocked&&phoneTruthy(r.values?.[blocked],"blocked")),completion=Number(r.values?.[progress??""]??0),assignee=String(r.values?.[owner??""]??"").trim(),sourceIndex=statuses.indexOf(source),targetIndex=statuses.indexOf(target);if(target===source)return "当前阶段";if(props.variant==="wip"&&rowLimit>0&&targetCount>=rowLimit)return "目标列已达到 WIP 上限";if(props.variant==="dependency"&&isBlocked)return "依赖解除前不能推进";if(props.variant==="sprint"&&rowLimit>0&&targetCount>=rowLimit)return "迭代容量已满";if(props.variant==="approval"&&targetIndex>sourceIndex+1)return "审批阶段不能跨级推进";if(props.variant==="content"&&/发布|published|done/i.test(target)&&completion<100)return "完成度达到 100% 后才能发布";if(props.variant==="recruitment"&&/拒绝|rejected|hired|录用/i.test(source))return "终态候选人不能直接改阶段";if(props.variant==="incident"&&/解决|resolved|closed/i.test(target)&&(isBlocked||completion<100))return "处置完成后才能关闭";if(props.variant==="release"&&targetIndex>sourceIndex+1)return "发布必须逐环境推进";if(props.variant==="portfolio"&&/完成|done|closed/i.test(target)&&completion<100)return "组合进度完成后才能关闭";if(props.variant==="triage"&&targetIndex>0&&!assignee)return "分诊后必须指定负责人";if(props.variant==="backlog"&&targetIndex>0&&!priority)return "排期待办必须声明优先级";return undefined},move=(target:string)=>{if(!movingRow||moveGuard(movingRow,target))return;const source=statusOf(movingRow);setMoves(x=>({...x,[movingRow.id]:target}));props.onAction?.("submitRequest",{entityRef:b.entityRef,rowId:movingRow.id,operation:"moveBoardItem",source,target,targets:phoneTargets(props)});setMoving(null);setActive(target)};
  return <PhoneShell block={props.block} title={titleOf(props)||PHONE_KANBAN_TITLES[props.variant]} testid={`phone-mature-kanban-${props.variant}`}>
    {statuses.length?<><Tabs activeKey={current} onChange={setActive}>{statuses.map(value=><Tabs.Tab key={value} title={`${value} ${b.rows.filter(r=>statusOf(r)===value).length}`}/>)}</Tabs>{lanes.map(laneName=><div key={laneName}>{lane&&<div style={{fontSize:12,fontWeight:600,margin:"10px 0 6px"}}>{laneName}</div>}<Space direction="vertical" block>{shown.filter(r=>!lane||String(r.values?.[lane]??"未分配")===laneName).map(r=>{const isBlocked=Boolean(blocked&&phoneTruthy(r.values?.[blocked],"blocked"));return <List key={r.id} mode="card" style={{margin:0}}><List.Item onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id})}><div style={{width:"100%"}}><div style={{display:"flex",gap:8,alignItems:"start"}}><Checkbox checked={selected.includes(r.id)} onChange={checked=>setSelected(ids=>checked?[...ids,r.id]:ids.filter(id=>id!==r.id))}/><strong style={{flex:1}}>{String(r.values?.[title]??r.id)}</strong>{priority&&<Badge content={String(r.values?.[priority]??"-")}/>}</div>{owner&&<div style={{fontSize:12,color:"#666",marginTop:4}}>{String(r.values?.[owner]??"未分配")}</div>}{progress&&<ProgressBar percent={Math.min(100,Number(r.values?.[progress]??0))} style={{marginTop:8}}/>}{isBlocked&&<div style={{fontSize:12,color:"#ff8f1f",marginTop:6}}>存在未完成依赖</div>}<Button block size="small" disabled={isBlocked} style={{marginTop:8}} onClick={event=>{event.stopPropagation();setMoving(r.id)}}>移动到其他阶段</Button></div></List.Item></List>})}</Space></div>)}{selected.length>0&&<Button block color="primary" style={{marginTop:10}} onClick={()=>props.onAction?.("editRequest",{entityRef:b.entityRef,rowIds:selected,operation:"bulkEditBoardItems"})}>批量处理 {selected.length} 项</Button>}</>:<MobileEmpty description="当前分组没有工作项"/>}
    <Popup visible={Boolean(moving)} onMaskClick={()=>setMoving(null)} bodyStyle={{padding:12}}><strong>移动工作项</strong><Selector columns={2} value={movingRow?[statusOf(movingRow)]:[]} options={statuses.map(value=>({value,label:value,disabled:Boolean(movingRow&&moveGuard(movingRow,value))}))} onChange={values=>values[0]&&move(String(values[0]))}/><Button block fill="none" onClick={()=>setMoving(null)}>取消</Button></Popup>
  </PhoneShell>;
}
const PhoneSwimlaneKanban=(p:ExperienceBlockRendererProps)=><PhoneMatureKanban {...p} variant="swimlane"/>;
const PhoneWipLimitBoard=(p:ExperienceBlockRendererProps)=><PhoneMatureKanban {...p} variant="wip"/>;
const PhoneDependencyKanban=(p:ExperienceBlockRendererProps)=><PhoneMatureKanban {...p} variant="dependency"/>;
const PhoneContentPipelineBoard=(p:ExperienceBlockRendererProps)=><PhoneMatureKanban {...p} variant="content"/>;
const PhoneIncidentResponseBoard=(p:ExperienceBlockRendererProps)=><PhoneMatureKanban {...p} variant="incident"/>;
const PhonePortfolioKanban=(p:ExperienceBlockRendererProps)=><PhoneMatureKanban {...p} variant="portfolio"/>;

function PhoneSavedViewManager(props:ExperienceBlockRendererProps){const b=phoneRows(props),name=phoneField(props,"nameFieldRef"),shared=phoneField(props,"sharedFieldRef"),active=phoneField(props,"activeFieldRef");if(!b||!name)return <PhoneShell block={props.block} testid="phone-saved-view-manager"><MobileEmpty description="视图管理尚未绑定名称字段"/></PhoneShell>;return <PhoneShell block={props.block} title={titleOf(props)||"保存视图"} testid="phone-saved-view-manager"><List>{b.rows.map(r=><List.Item key={r.id} description={shared&&phoneTruthy(r.values?.[shared],"shared")?"团队共享":"仅自己"} extra={<Button size="mini" color="primary" onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id})}>应用</Button>}>{String(r.values?.[name])}{active&&phoneTruthy(r.values?.[active],"active")&&<Badge content="当前"/>}</List.Item>)}</List></PhoneShell>}
function PhoneColumnChooserDrawer(props:ExperienceBlockRendererProps){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),visible=phoneField(props,"visibleFieldRef"),[open,setOpen]=React.useState(false),[selected,setSelected]=React.useState<string[]>([]);if(!b||!title)return <PhoneShell block={props.block} testid="phone-column-chooser-drawer"><MobileEmpty description="列选择器尚未绑定标题字段"/></PhoneShell>;const initial=b.rows.filter(r=>!visible||phoneTruthy(r.values?.[visible],"visible")).map(r=>r.id),values=selected.length?selected:initial;return <PhoneShell block={props.block} testid="phone-column-chooser-drawer"><Button block onClick={()=>setOpen(true)}>配置列</Button><Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:12,maxHeight:"75vh",overflow:"auto"}}><strong>配置显示列</strong><Selector columns={1} multiple value={values} options={b.rows.map(r=>({value:r.id,label:String(r.values?.[title])}))} onChange={ids=>setSelected(ids.map(String))}/><Button block color="primary" onClick={()=>{props.onAction?.("submitRequest",{entityRef:b.entityRef,rowIds:values,operation:"setVisibleColumns",targets:phoneTargets(props)});setOpen(false)}}>应用</Button></Popup></PhoneShell>}
function PhoneActivityContextDrawer(props:ExperienceBlockRendererProps){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),time=phoneField(props,"timeFieldRef"),actor=phoneField(props,"actorFieldRef"),[open,setOpen]=React.useState(false);if(!b||!title||!time)return <PhoneShell block={props.block} testid="phone-activity-context-drawer"><MobileEmpty description="活动抽屉尚未绑定标题和时间字段"/></PhoneShell>;return <PhoneShell block={props.block} testid="phone-activity-context-drawer"><Button block onClick={()=>setOpen(true)}>查看活动 {b.rows.length}</Button><Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:12,maxHeight:"75vh",overflow:"auto"}}><List>{[...b.rows].sort((a,c)=>String(c.values?.[time]).localeCompare(String(a.values?.[time]))).map(r=><List.Item key={r.id} description={`${actor?`${String(r.values?.[actor]??"系统")} · `:""}${String(r.values?.[time])}`} onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id})}>{String(r.values?.[title])}</List.Item>)}</List></Popup></PhoneShell>}
function PhoneBulkActionTray(props:ExperienceBlockRendererProps){const b=phoneRows(props);if(!b)return <PhoneShell block={props.block} testid="phone-bulk-action-tray"><MobileEmpty description="批量操作尚未绑定实体"/></PhoneShell>;const ids=props.selection?.rowIds?.[b.entityRef]??[],actions=Array.isArray(props.block.props?.actions)?props.block.props.actions.map(String):["分配","移动","归档"];return <PhoneShell block={props.block} testid="phone-bulk-action-tray"><div style={{fontWeight:600,marginBottom:8}}>已选择 {ids.length} 项</div><Grid columns={Math.min(3,actions.length)} gap={6}>{actions.map(action=><Grid.Item key={action}><Button block size="small" disabled={!ids.length} onClick={()=>props.onAction?.("submitRequest",{entityRef:b.entityRef,rowIds:ids,operation:action,targets:phoneTargets(props)})}>{action}</Button></Grid.Item>)}</Grid></PhoneShell>}

type PhoneContextVariant="palette"|"notifications"|"filterPreset"|"exportJob"|"compare"|"inspector"|"help"|"audit"|"savedSearch"|"recent"|"related"|"permission"|"selection"|"validation"|"contextHelp"|"impact";
const PHONE_CONTEXT_TITLES:Record<PhoneContextVariant,string>={palette:"命令面板",notifications:"通知中心",filterPreset:"筛选预设",exportJob:"导出任务",compare:"对比选择",inspector:"详情检查器",help:"帮助上下文",audit:"审计差异",savedSearch:"保存搜索",recent:"最近项目",related:"关联实体",permission:"权限摘要",selection:"选择检查器",validation:"校验问题",contextHelp:"上下文帮助",impact:"变更影响"};
function PhoneContextPanel(props:ExperienceBlockRendererProps & {variant:PhoneContextVariant}){const b=phoneRows(props),title=phoneField(props,"titleFieldRef"),status=phoneField(props,"statusFieldRef"),queryField=phoneField(props,"queryFieldRef"),time=phoneField(props,"timeFieldRef"),severity=phoneField(props,"severityFieldRef"),relation=phoneField(props,"relationFieldRef"),allowed=phoneField(props,"allowedFieldRef"),message=phoneField(props,"messageFieldRef"),[open,setOpen]=React.useState(false),[query,setQuery]=React.useState(""),ids=b?props.selection?.rowIds?.[b.entityRef]??[]:[];if(!b)return <PhoneShell block={props.block} testid={`phone-context-${props.variant}`}><MobileEmpty description={`${PHONE_CONTEXT_TITLES[props.variant]}尚未绑定实体`}/></PhoneShell>;const rows=time?[...b.rows].sort((a,c)=>String(c.values?.[time]).localeCompare(String(a.values?.[time]))):b.rows,filtered=queryField?rows.filter(r=>String(r.values?.[queryField]??"").toLowerCase().includes(query.toLowerCase())):rows,state=(r:(typeof b.rows)[number])=>String(r.values?.[status??""]??"").toLowerCase(),submit=(operation:string,extra:Record<string,unknown>={})=>props.onAction?.("submitRequest",{entityRef:b.entityRef,operation,targets:phoneTargets(props),...extra});let body:React.ReactNode;
switch(props.variant){case"palette":body=<><SearchBar value={query} onChange={setQuery} placeholder="搜索命令"/><List>{filtered.slice(0,8).map(r=><List.Item key={r.id} onClick={()=>props.onAction?.("actionTrigger",{entityRef:b.entityRef,rowId:r.id,operation:"runCommand",targets:phoneTargets(props)})}>{String(r.values?.[title??""]??r.id)}</List.Item>)}</List></>;break;case"notifications":body=<Button block onClick={()=>setOpen(true)}>打开通知 <Badge content={rows.filter(r=>state(r)==="unread").length}/></Button>;break;case"filterPreset":body=<Button block onClick={()=>setOpen(true)}>管理筛选预设</Button>;break;case"exportJob":body=<Button block onClick={()=>setOpen(true)}>查看导出任务 <Badge content={rows.filter(r=>state(r)==="running").length}/></Button>;break;case"compare":body=<><div style={{padding:10,background:ids.length===2?"#e7f8f2":"#f5f5f5"}}>{ids.length===2?"已选择两条记录":"请选择恰好两条记录"}</div><Button block color="primary" disabled={ids.length!==2} onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowIds:ids,operation:"compareSelection"})}>开始对比</Button></>;break;case"inspector":body=<Button block disabled={!ids.length} onClick={()=>setOpen(true)}>检查已选记录 {ids.length}</Button>;break;case"help":body=<Collapse>{rows.slice(0,6).map(r=><Collapse.Panel key={r.id} title={String(r.values?.[title??""]??r.id)}>{String(r.values?.[message??""]??"暂无帮助")}</Collapse.Panel>)}</Collapse>;break;case"audit":body=<Button block onClick={()=>setOpen(true)}>查看审计差异</Button>;break;case"savedSearch":body=<List>{rows.map(r=><List.Item key={r.id} extra={<Button size="mini" onClick={()=>props.onAction?.("filterChange",{query:r.values?.[queryField??""],targets:phoneTargets(props)})}>运行</Button>}>{String(r.values?.[title??""]??r.id)}</List.Item>)}</List>;break;case"recent":body=<List>{rows.slice(0,10).map(r=><List.Item key={r.id} onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id})}>{String(r.values?.[title??""]??r.id)}</List.Item>)}</List>;break;case"related":{const groups=Array.from(new Set(rows.map(r=>String(r.values?.[relation??""]??"相关"))));body=<Collapse>{groups.map(group=><Collapse.Panel key={group} title={group}><List>{rows.filter(r=>String(r.values?.[relation??""]??"相关")===group).map(r=><List.Item key={r.id} onClick={()=>props.onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id})}>{String(r.values?.[title??""]??r.id)}</List.Item>)}</List></Collapse.Panel>)}</Collapse>;break}case"permission":{const denied=allowed?rows.filter(r=>!phoneTruthy(r.values?.[allowed],"allowed")).length:0;body=<><div style={{padding:10,background:denied?"#fff7e6":"#e7f8f2"}}>{rows.length-denied} 项允许，{denied} 项需要申请</div>{denied>0&&<Button block onClick={()=>submit("requestPermission")}>申请权限</Button>}</>;break}case"selection":body=<Grid columns={2} gap={8}><Grid.Item><div style={{padding:10,background:"#f5f5f5"}}>已选择<br/><strong>{ids.length}</strong></div></Grid.Item><Grid.Item><div style={{padding:10,background:"#f5f5f5"}}>可检查<br/><strong>{rows.length}</strong></div></Grid.Item></Grid>;break;case"validation":{const errors=severity?rows.filter(r=>/error|错误/i.test(String(r.values?.[severity]))).length:0;body=<><div style={{padding:10,background:errors?"#fff1f0":"#e7f8f2"}}>{errors?`${errors} 个错误阻止提交`:"校验通过"}</div>{errors>0&&<Button block onClick={()=>setOpen(true)}>查看问题</Button>}</>;break}case"contextHelp":body=<Button block onClick={()=>setOpen(true)}>打开当前页面帮助</Button>;break;case"impact":{const high=severity?rows.filter(r=>/high|critical|高|严重/i.test(String(r.values?.[severity]))).length:0;body=<><div style={{padding:10,background:high?"#fff7e6":"#f5f5f5"}}>{high?`${high} 项高风险影响需要确认`:`${rows.length} 项受影响`}</div><Button block onClick={()=>submit("confirmChangeImpact")}>确认影响</Button></>;break}}
let popup=<List>{rows.map(r=><List.Item key={r.id} description={String(r.values?.[message??status??""]??"")}>{String(r.values?.[title??""]??r.id)}</List.Item>)}</List>;if(props.variant==="notifications")popup=<List>{rows.map(r=><List.Item key={r.id} extra={state(r)==="unread"?<Button size="mini" onClick={()=>submit("markNotificationRead",{rowId:r.id})}>已读</Button>:null}>{String(r.values?.[title??""]??r.id)}</List.Item>)}</List>;if(props.variant==="filterPreset")popup=<List>{rows.map(r=><List.Item key={r.id} extra={<Button size="mini" color="primary" onClick={()=>{props.onAction?.("filterChange",{presetId:r.id,targets:phoneTargets(props)});setOpen(false)}}>应用</Button>}>{String(r.values?.[title??""]??r.id)}</List.Item>)}</List>;if(props.variant==="exportJob")popup=<List>{rows.map(r=><List.Item key={r.id} description={state(r)||"等待中"} extra={state(r)==="completed"?<Button size="mini" onClick={()=>props.onAction?.("actionTrigger",{entityRef:b.entityRef,rowId:r.id,operation:"downloadExport",targets:phoneTargets(props)})}>下载</Button>:<Button size="mini" disabled={state(r)!=="running"} onClick={()=>submit("cancelExport",{rowId:r.id})}>取消</Button>}>{String(r.values?.[title??""]??r.id)}</List.Item>)}</List>;if(props.variant==="contextHelp")popup=<><SearchBar value={query} onChange={setQuery} onSearch={v=>props.onAction?.("actionTrigger",{entityRef:b.entityRef,operation:"searchContextHelp",query:v,targets:phoneTargets(props)})}/><List>{filtered.map(r=><List.Item key={r.id} description={String(r.values?.[message??""]??"")}>{String(r.values?.[title??""]??r.id)}</List.Item>)}</List></>;
return <PhoneShell block={props.block} title={titleOf(props)||PHONE_CONTEXT_TITLES[props.variant]} testid={`phone-context-${props.variant}`}>{body}<Popup visible={open} onMaskClick={()=>setOpen(false)} bodyStyle={{padding:12,maxHeight:"78vh",overflow:"auto"}}>{popup}</Popup></PhoneShell>}
const PhoneKeyboardCommandPalette=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="palette"/>;const PhoneNotificationCenterDrawer=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="notifications"/>;const PhoneFilterPresetDrawer=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="filterPreset"/>;const PhoneExportJobDrawer=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="exportJob"/>;const PhoneCompareSelectionTray=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="compare"/>;const PhoneDetailInspectorDrawer=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="inspector"/>;const PhoneHelpContextPanel=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="help"/>;const PhoneAuditDiffDrawer=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="audit"/>;const PhoneSavedSearchPanel=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="savedSearch"/>;const PhoneRecentItemsPanel=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="recent"/>;const PhoneRelatedEntityPanel=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="related"/>;const PhonePermissionSummaryPanel=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="permission"/>;const PhoneSelectionInspector=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="selection"/>;const PhoneValidationIssuePanel=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="validation"/>;const PhoneContextHelpDrawer=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="contextHelp"/>;const PhoneChangeImpactPanel=(p:ExperienceBlockRendererProps)=><PhoneContextPanel {...p} variant="impact"/>;

export default function PhoneExperienceBlock(props: ExperienceBlockRendererProps) {
  const independentStructureBatch7Block = renderIndependentStructureBatch7PhoneBlock(props);
  if (independentStructureBatch7Block !== undefined) return independentStructureBatch7Block;
  const independentStructureBatch8Block = renderIndependentStructureBatch8PhoneBlock(props);
  if (independentStructureBatch8Block !== undefined) return independentStructureBatch8Block;
  const independentStructureBatch6Block = renderIndependentStructureBatch6PhoneBlock(props);
  if (independentStructureBatch6Block !== undefined) return independentStructureBatch6Block;
  const independentStructureBatch5Block = renderIndependentStructureBatch5PhoneBlock(props);
  if (independentStructureBatch5Block !== undefined) return independentStructureBatch5Block;
  const independentStructureBatch4Block = renderIndependentStructureBatch4PhoneBlock(props);
  if (independentStructureBatch4Block !== undefined) return independentStructureBatch4Block;
  const independentStructureBatch3Block = renderIndependentStructureBatch3PhoneBlock(props);
  if (independentStructureBatch3Block !== undefined) return independentStructureBatch3Block;
  const independentStructureBatch2Block = renderIndependentStructureBatch2PhoneBlock(props);
  if (independentStructureBatch2Block !== undefined) return independentStructureBatch2Block;
  const independentStructureBlock = renderIndependentStructurePhoneBlock(props);
  if (independentStructureBlock !== undefined) return independentStructureBlock;
  const scheduleStatusBlock = renderScheduleStatusPhoneBlock(props);
  if (scheduleStatusBlock !== undefined) return scheduleStatusBlock;
  const calendarWizardBlock = renderCalendarWizardPhoneBlock(props);
  if (calendarWizardBlock !== undefined) return calendarWizardBlock;
  const configurationWizardBlock = renderConfigurationWizardPhoneBlock(props);
  if (configurationWizardBlock !== undefined) return configurationWizardBlock;
  const collaborationContentBlock = renderCollaborationContentPhoneBlock(props);
  if (collaborationContentBlock !== undefined) return collaborationContentBlock;
  const dataGovernanceBlock = renderDataGovernancePhoneBlock(props);
  if (dataGovernanceBlock !== undefined) return dataGovernanceBlock;
  const hierarchySelectionBlock = renderHierarchySelectionPhoneBlock(props);
  if (hierarchySelectionBlock !== undefined) return hierarchySelectionBlock;
  switch (props.block.type) {
    case "FunnelConversionChart":
    case "HistogramDistributionChart":
    case "ScatterCorrelationChart":
    case "BoxPlotDistributionChart":
    case "WaterfallVarianceChart":
    case "ForecastConfidenceChart":
    case "BurnupChart":
    case "BurndownChart":
    case "ErrorBudgetGauge":
    case "ServiceMapPanel":
    case "DependencyGraphPanel":
    case "QueryResultPivot":
    case "MetricComparisonPanel":
      return <PhoneAnalysisDependencyBlock {...props} />;
    case "FilterBar":
      return <PhoneFilterBar {...props} />;
    case "MetricGrid":
      return <PhoneMetricGrid {...props} />;
    case "WorkflowTimeline":
      return <PhoneWorkflowTimeline {...props} />;
    case "QuickActionPanel":
      return <PhoneQuickActionPanel {...props} />;
    case "AttachmentPanel":
      return <PhoneAttachmentPanel {...props} />;
    case "CommentThread":
      return <PhoneCommentThread {...props} />;
    case "RecordPicker":
      return <PhoneRecordPicker {...props} />;
    case "KanbanBoard":
      return <PhoneKanbanBoard {...props} />;
    case "ScheduleCalendar":
      return <PhoneScheduleCalendar {...props} />;
    case "NotificationInbox":
      return <PhoneNotificationInbox {...props} />;
    case "TreeNavigator":
      return <PhoneTreeNavigator {...props} />;
    case "ApprovalQueue":
      return <PhoneApprovalQueue {...props} />;
    case "AuditTrail":
      return <PhoneAuditTrail {...props} />;
    case "DataImportWizard":
      return <PhoneDataImportWizard {...props} />;
    case "AsyncTaskMonitor":
      return <PhoneAsyncTaskMonitor {...props} />;
    case "PermissionMatrix":
      return <PhonePermissionMatrix {...props} />;
    case "DataExportPanel":
      return <PhoneDataExportPanel {...props} />;
    case "BulkEditPanel":
      return <PhoneBulkEditPanel {...props} />;
    case "MemberAssignment":
      return <PhoneMemberAssignment {...props} />;
    case "ContextBreadcrumb": return <PhoneContextBreadcrumb {...props} />;
    case "LiveRefreshControl": return <PhoneLiveRefreshControl {...props} />;
    case "ActiveFilterSummary": return <PhoneActiveFilterSummary {...props} />;
    case "AnalyticsDateScope": return <PhoneAnalyticsDateScope {...props} />;
    case "HeaderEntitySummary": return <PhoneHeaderEntitySummary {...props} />;
    case "HeaderProgressSummary": return <PhoneHeaderProgressSummary {...props} />;
    case "WorkspaceTabs": return <PhoneWorkspaceTabs {...props} />;
    case "SavedViewTabs": return <PhoneSavedViewTabs {...props} />;
    case "AdvancedFilterBuilder": return <PhoneAdvancedFilterBuilder {...props} />;
    case "FacetedFilterPanel": return <PhoneFacetedFilterPanel {...props} />;
    case "WizardNavigationBar": return <PhoneWizardNavigationBar {...props} />;
    case "ApprovalDecisionBar": return <PhoneApprovalDecisionBar {...props} />;
    case "CheckoutSummaryBar": return <PhoneCheckoutSummaryBar {...props} />;
    case "RecordLifecycleBar": return <PhoneRecordLifecycleBar {...props} />;
    case "WaterfallChart": return <PhoneWaterfallChart {...props} />;
    case "FunnelChart": return <PhoneFunnelChart {...props} />;
    case "DistributionHistogram": return <PhoneDistributionHistogram {...props} />;
    case "HeatmapMatrix": return <PhoneHeatmapMatrix {...props} />;
    case "TreemapBreakdown": return <PhoneTreemapBreakdown {...props} />;
    case "GaugeProgress": return <PhoneGaugeProgress {...props} />;
    case "AlertTriagePanel": return <PhoneAlertTriagePanel {...props} />;
    case "AlertSilenceForm": return <PhoneAlertSilenceForm {...props} />;
    case "AlertRoutingPolicy": return <PhoneAlertRoutingPolicy {...props} />;
    case "DeletedRecordsRecovery": return <PhoneDeletedRecordsRecovery {...props} />;
    case "RevisionHistoryPanel": return <PhoneRevisionHistoryPanel {...props} />;
    case "RecordComparePanel": return <PhoneRecordComparePanel {...props} />;
    case "GanttSchedule": return <PhoneGanttSchedule {...props} />;
    case "SankeyFlow": return <PhoneSankeyFlow {...props} />;
    case "BoxPlotDistribution": return <PhoneBoxPlotDistribution {...props} />;
    case "RadarComparison": return <PhoneRadarComparison {...props} />;
    case "AlertRuleEditor": return <PhoneAlertRuleEditor {...props} />;
    case "MuteTimingSchedule": return <PhoneMuteTimingSchedule {...props} />;
    case "ContactPointManager": return <PhoneContactPointManager {...props} />;
    case "ReferenceManyManager": return <PhoneReferenceManyManager {...props} />;
    case "GlobalSearchPalette": return <PhoneGlobalSearchPalette {...props} />;
    case "LiveChangeReview": return <PhoneLiveChangeReview {...props} />;
    case "AvailabilityPlanner": return <PhoneAvailabilityPlanner {...props} />;
    case "BookingSlotPicker": return <PhoneBookingSlotPicker {...props} />;
    case "ScheduleConflictResolver": return <PhoneScheduleConflictResolver {...props} />;
    case "StackTracePanel": return <PhoneStackTracePanel {...props} />;
    case "EventBreadcrumbTimeline": return <PhoneEventBreadcrumbTimeline {...props} />;
    case "SuspectCommitPanel": return <PhoneSuspectCommitPanel {...props} />;
    case "ConnectionTimeline": return <PhoneConnectionTimeline {...props} />;
    case "SchemaChangeReview": return <PhoneSchemaChangeReview {...props} />;
    case "StreamStatusMonitor": return <PhoneStreamStatusMonitor {...props} />;
    case "ConnectionMappingPanel": return <PhoneConnectionMappingPanel {...props} />;
    case "IssueCommandHeader": return <PhoneIssueCommandHeader {...props} />;
    case "ConnectionControlHeader": return <PhoneConnectionControlHeader {...props} />;
    case "EventUserCountMetrics": return <PhoneEventUserCountMetrics {...props} />;
    case "JobRunMetrics": return <PhoneJobRunMetrics {...props} />;
    case "OccurrenceEvidenceSummary": return <PhoneOccurrenceEvidenceSummary {...props} />;
    case "ConnectionRouteSummary": return <PhoneConnectionRouteSummary {...props} />;
    case "InspectorModeTabs": return <PhoneInspectorModeTabs {...props} />;
    case "IssueEventFilter": return <PhoneIssueEventFilter {...props} />;
    case "TimelineFilterBar": return <PhoneTimelineFilterBar {...props} />;
    case "UnsavedChangesBar": return <PhoneUnsavedChangesBar {...props} />;
    case "RunningJobControlBar": return <PhoneRunningJobControlBar {...props} />;
    case "BookingCommandHeader": return <PhoneBookingCommandHeader {...props} />;
    case "AlertRuleCommandHeader": return <PhoneAlertRuleCommandHeader {...props} />;
    case "AlertStateMetrics": return <PhoneAlertStateMetrics {...props} />;
    case "BookingCapacityMetrics": return <PhoneBookingCapacityMetrics {...props} />;
    case "BookingContextSummary": return <PhoneBookingContextSummary {...props} />;
    case "AlertInstanceSummary": return <PhoneAlertInstanceSummary {...props} />;
    case "BookingStatusTabs": return <PhoneBookingStatusTabs {...props} />;
    case "ValidatedFormTabs": return <PhoneValidatedFormTabs {...props} />;
    case "AlertMatcherFilter": return <PhoneAlertMatcherFilter {...props} />;
    case "BookingDirectoryFilter": return <PhoneBookingDirectoryFilter {...props} />;
    case "BookingDecisionBar": return <PhoneBookingDecisionBar {...props} />;
    case "DashboardSaveBar": return <PhoneDashboardSaveBar {...props} />;
    case "WorkItemCommandHeader": return <PhoneWorkItemCommandHeader {...props} />;
    case "DocumentCommandHeader": return <PhoneDocumentCommandHeader {...props} />;
    case "EnvironmentStatusStrip": return <PhoneEnvironmentStatusStrip {...props} />;
    case "DataFreshnessIndicator": return <PhoneDataFreshnessIndicator {...props} />;
    case "WorkItemContextSummary": return <PhoneWorkItemContextSummary {...props} />;
    case "DashboardParameterBar": return <PhoneDashboardParameterBar {...props} />;
    case "CycleHealthMetrics": return <PhoneCycleHealthMetrics {...props} />;
    case "QueryExecutionMetrics": return <PhoneQueryExecutionMetrics {...props} />;
    case "BulkSelectionBar": return <PhoneBulkSelectionBar {...props} />;
    case "DraftPublishBar": return <PhoneDraftPublishBar {...props} />;
    case "QuestionCommandHeader": return <PhoneQuestionCommandHeader {...props} />;
    case "CatalogEntityCommandHeader": return <PhoneCatalogEntityCommandHeader {...props} />;
    case "CollaboratorPresenceStrip": return <PhoneCollaboratorPresenceStrip {...props} />;
    case "QueryRunStatusStrip": return <PhoneQueryRunStatusStrip {...props} />;
    case "EntityOwnershipSummary": return <PhoneEntityOwnershipSummary {...props} />;
    case "QueryDataSourceSummary": return <PhoneQueryDataSourceSummary {...props} />;
    case "QueryClauseFilterBar": return <PhoneQueryClauseFilterBar {...props} />;
    case "MetadataQualityMetrics": return <PhoneMetadataQualityMetrics {...props} />;
    case "QuestionExecutionBar": return <PhoneQuestionExecutionBar {...props} />;
    case "CycleCommandHeader": return <PhoneCycleCommandHeader {...props} />;
    case "AlertGroupCommandHeader": return <PhoneAlertGroupCommandHeader {...props} />;
    case "IncidentOwnershipStrip": return <PhoneIncidentOwnershipStrip {...props} />;
    case "SyncScheduleStrip": return <PhoneSyncScheduleStrip {...props} />;
    case "CycleFilterBar": return <PhoneCycleFilterBar {...props} />;
    case "AlertRuleFilterBar": return <PhoneAlertRuleFilterBar {...props} />;
    case "SyncReliabilityMetrics": return <PhoneSyncReliabilityMetrics {...props} />;
    case "RuleEvaluationMetrics": return <PhoneRuleEvaluationMetrics {...props} />;
    case "EventTypePublishBar": return <PhoneEventTypePublishBar {...props} />;
    case "ConversationCommandHeader": return <PhoneConversationCommandHeader {...props} />;
    case "UserCommandHeader": return <PhoneUserCommandHeader {...props} />;
    case "ConversationAssignmentStrip": return <PhoneConversationAssignmentStrip {...props} />;
    case "RealmStatusStrip": return <PhoneRealmStatusStrip {...props} />;
    case "UserDirectoryFilter": return <PhoneUserDirectoryFilter {...props} />;
    case "ConversationSlaMetrics": return <PhoneConversationSlaMetrics {...props} />;
    case "ConversationReplyBar": return <PhoneConversationReplyBar {...props} />;
    case "UserAccessBar": return <PhoneUserAccessBar {...props} />;
    case "TimeSeriesAnomalyChart": return <PhoneTimeSeriesAnomalyChart {...props} />;
    case "CohortRetentionChart": return <PhoneCohortRetentionChart {...props} />;
    case "UptimeStatusTimeline": return <PhoneUptimeStatusTimeline {...props} />;
    case "PercentileBandChart": return <PhonePercentileBandChart {...props} />;
    case "ConnectionFleetMetrics": return <PhoneConnectionFleetMetrics {...props} />;
    case "IssueImpactMetrics": return <PhoneIssueImpactMetrics {...props} />;
    case "ReleaseHealthStrip": return <PhoneReleaseHealthStrip {...props} />;
    case "DashboardCommandHeader": return <PhoneDashboardCommandHeader {...props} />;
    case "DeploymentLatencyChart": return <PhoneDeploymentLatencyChart {...props} />;
    case "ReleaseAdoptionTrendChart": return <PhoneReleaseAdoptionTrendChart {...props} />;
    case "DeploymentRolloutMetrics": return <PhoneDeploymentRolloutMetrics {...props} />;
    case "ReleaseAdoptionMetrics": return <PhoneReleaseAdoptionMetrics {...props} />;
    case "ClusterHealthStrip": return <PhoneClusterHealthStrip {...props} />;
    case "ReleaseEnvironmentStrip": return <PhoneReleaseEnvironmentStrip {...props} />;
    case "DeploymentCommandHeader": return <PhoneDeploymentCommandHeader {...props} />;
    case "FeatureFlagCommandHeader": return <PhoneFeatureFlagCommandHeader {...props} />;
    case "DeploymentScaleBar": return <PhoneDeploymentScaleBar {...props} />;
    case "ReleaseRolloutBar": return <PhoneReleaseRolloutBar {...props} />;
    case "CumulativeFlowChart": return <PhoneCumulativeFlowChart {...props} />;
    case "BookingDemandChart": return <PhoneBookingDemandChart {...props} />;
    case "CycleRiskStrip": return <PhoneCycleRiskStrip {...props} />;
    case "WorkItemMoveDrawer": return <PhoneWorkItemMoveDrawer {...props} />;
    case "BookingConflictDrawer": return <PhoneBookingConflictDrawer {...props} />;
    case "WorkflowDurationChart": return <PhoneWorkflowDurationChart {...props} />;
    case "WorkflowOutcomeMetrics": return <PhoneWorkflowOutcomeMetrics {...props} />;
    case "WorkflowVersionStrip": return <PhoneWorkflowVersionStrip {...props} />;
    case "WorkflowFailureDrawer": return <PhoneWorkflowFailureDrawer {...props} />;
    case "WorkflowCommandHeader": return <PhoneWorkflowCommandHeader {...props} />;
    case "WorkflowControlBar": return <PhoneWorkflowControlBar {...props} />;
    case "RealmCommandHeader": return <PhoneRealmCommandHeader {...props} />;
    case "CredentialLifecycleBar": return <PhoneCredentialLifecycleBar {...props} />;
    case "PanelQueryLatencyChart": return <PhonePanelQueryLatencyChart {...props} />;
    case "SyncVolumeTrendChart": return <PhoneSyncVolumeTrendChart {...props} />;
    case "DatasourceQueryMetrics": return <PhoneDatasourceQueryMetrics {...props} />;
    case "StreamFreshnessMetrics": return <PhoneStreamFreshnessMetrics {...props} />;
    case "PanelCommandHeader": return <PhonePanelCommandHeader {...props} />;
    case "ExploreQueryControlBar": return <PhoneExploreQueryControlBar {...props} />;
    case "QueryErrorDrawer": return <PhoneQueryErrorDrawer {...props} />;
    case "SchemaConflictDrawer": return <PhoneSchemaConflictDrawer {...props} />;
    case "SwimlaneKanban": return <PhoneSwimlaneKanban {...props} />;
    case "WipLimitBoard": return <PhoneWipLimitBoard {...props} />;
    case "DependencyKanban": return <PhoneDependencyKanban {...props} />;
    case "ContentPipelineBoard": return <PhoneContentPipelineBoard {...props} />;
    case "IncidentResponseBoard": return <PhoneIncidentResponseBoard {...props} />;
    case "PortfolioKanban": return <PhonePortfolioKanban {...props} />;
    case "SavedViewManager": return <PhoneSavedViewManager {...props} />;
    case "ColumnChooserDrawer": return <PhoneColumnChooserDrawer {...props} />;
    case "ActivityContextDrawer": return <PhoneActivityContextDrawer {...props} />;
    case "BulkActionTray": return <PhoneBulkActionTray {...props} />;
    case "OnboardingChecklistWizard": return React.createElement(PHONE_PRACTICE_WIZARDS.OnboardingChecklistWizard, props);
    case "ImportMappingWizard": return React.createElement(PHONE_PRACTICE_WIZARDS.ImportMappingWizard, props);
    case "KeyboardCommandPalette": return <PhoneKeyboardCommandPalette {...props} />;
    case "ExportJobDrawer": return <PhoneExportJobDrawer {...props} />;
    case "CompareSelectionTray": return <PhoneCompareSelectionTray {...props} />;
    case "DetailInspectorDrawer": return <PhoneDetailInspectorDrawer {...props} />;
    case "HelpContextPanel": return <PhoneHelpContextPanel {...props} />;
    case "AuditDiffDrawer": return <PhoneAuditDiffDrawer {...props} />;
    case "SavedSearchPanel": return <PhoneSavedSearchPanel {...props} />;
    case "RecentItemsPanel": return <PhoneRecentItemsPanel {...props} />;
    case "RelatedEntityPanel": return <PhoneRelatedEntityPanel {...props} />;
    case "PermissionSummaryPanel": return <PhonePermissionSummaryPanel {...props} />;
    case "SelectionInspector": return <PhoneSelectionInspector {...props} />;
    case "ValidationIssuePanel": return <PhoneValidationIssuePanel {...props} />;
    case "ContextHelpDrawer": return <PhoneContextHelpDrawer {...props} />;
    case "ChangeImpactPanel": return <PhoneChangeImpactPanel {...props} />;
    default:
      return null;
  }
}
