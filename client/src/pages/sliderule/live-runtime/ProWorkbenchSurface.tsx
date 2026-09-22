import React from "react";
import {
  EditableProTable,
  ProDescriptions,
  ProList,
  ProTable,
  type ProColumns,
  type ProDescriptionsItemProps,
} from "@ant-design/pro-components";
import { PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Segmented, Space, Tag, Typography } from "antd";
import type {
  AppFormFieldSchema,
  AppPageSurfaceSchema,
} from "./app-runtime-schema";
import type { RuntimeRow } from "./live-runtime";

interface ProWorkbenchSurfaceProps {
  surface: AppPageSurfaceSchema;
  title: string;
  fields: AppFormFieldSchema[];
  rows: RuntimeRow[];
  canCreate: boolean;
  onCreate: () => void;
  onOpenRow: (row: RuntimeRow) => void;
  onSaveRow: (row: RuntimeRow) => void;
}

const toneColor: Record<string, string> = {
  success: "success",
  processing: "processing",
  warning: "warning",
  danger: "error",
  default: "default",
};

function fieldValueType(
  field: AppFormFieldSchema
): ProColumns<RuntimeRow>["valueType"] {
  if (field.type === "enum" || field.type === "ref") return "select";
  if (field.type === "date") return "date";
  if (field.type === "number") {
    return field.format === "money" ? "money" : "digit";
  }
  return field.type === "text" ? "textarea" : "text";
}

function fieldValueEnum(field: AppFormFieldSchema) {
  if (!field.options?.length) return undefined;
  return Object.fromEntries(
    field.options.map(option => [
      option.id,
      {
        text: option.label,
        status:
          option.tone === "danger"
            ? "Error"
            : option.tone === "warning"
              ? "Warning"
              : option.tone === "success"
                ? "Success"
                : option.tone === "processing"
                  ? "Processing"
                  : "Default",
      },
    ])
  );
}

function displayValue(field: AppFormFieldSchema, value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  const option = field.options?.find(item => item.id === String(value));
  if (option) {
    return <Tag color={toneColor[option.tone ?? "default"]}>{option.label}</Tag>;
  }
  return String(value);
}

function buildColumns(
  fields: AppFormFieldSchema[],
  onOpenRow: (row: RuntimeRow) => void
): ProColumns<RuntimeRow>[] {
  const columns: ProColumns<RuntimeRow>[] = fields.map((field, index) => ({
    title: field.label,
    dataIndex: ["values", field.id],
    valueType: fieldValueType(field),
    valueEnum: fieldValueEnum(field),
    ellipsis: true,
    search: index < 3,
    render: (_, row) => displayValue(field, row.values[field.id]),
  }));
  columns.push({
    title: "操作",
    valueType: "option",
    width: 72,
    render: (_, row) => (
      <a onClick={() => onOpenRow(row)} aria-label={`查看 ${row.id}`}>
        查看
      </a>
    ),
  });
  return columns;
}

function SurfaceTitle({ title }: { title: string }) {
  return (
    <Space direction="vertical" size={0}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      <Typography.Text type="secondary">{new Date().toLocaleDateString()}</Typography.Text>
    </Space>
  );
}

function CreateButton({
  canCreate,
  onCreate,
}: Pick<ProWorkbenchSurfaceProps, "canCreate" | "onCreate">) {
  return canCreate ? (
    <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
      新建
    </Button>
  ) : null;
}

function TableSurface(props: ProWorkbenchSurfaceProps) {
  return (
    <ProTable<RuntimeRow>
      headerTitle={<SurfaceTitle title={props.title} />}
      rowKey="id"
      columns={buildColumns(props.fields, props.onOpenRow)}
      dataSource={props.rows}
      search={{ labelWidth: "auto", defaultCollapsed: false }}
      options={{ density: true, setting: true, reload: false }}
      toolBarRender={() => [
        <CreateButton key="create" canCreate={props.canCreate} onCreate={props.onCreate} />,
      ]}
      pagination={{ pageSize: props.surface.density === "compact" ? 10 : 8 }}
      cardBordered={false}
      /**
       * 列多了横向滚动，不要把每列挤成省略号（2026-08-11）。
       *
       * buildColumns 给每列都开了 `ellipsis: true` 但没有宽度提示，antd 默认均分
       * 容器宽度：线上截图里 9 列挤在约 740px 的卡里，每列剩 ~80px，「加分事项」
       * 显示成"加分事..."、「AI行为分析」成"AI行为..."，表头「AI建议积分」还折成
       * 两行——几乎每一列都截断到读不出内容。
       *
       * 这是 antd 对多列表格的标准做法，而且本仓库早就在用（EntityDataPanel、
       * DataImportWizard 那两张表），只有页面表格一直漏着。
       */
      scroll={{ x: "max-content" }}
      onRow={row => ({ onDoubleClick: () => props.onOpenRow(row) })}
    />
  );
}

function EditableSurface(props: ProWorkbenchSurfaceProps) {
  const [editableKeys, setEditableKeys] = React.useState<React.Key[]>([]);
  const columns = buildColumns(props.fields, props.onOpenRow).map(column => ({
    ...column,
    ...(column.valueType === "option"
      ? {
          render: (_: unknown, row: RuntimeRow, __: number, action: any) => [
            <a key="edit" onClick={() => action?.startEditable?.(row.id)}>
              编辑
            </a>,
            <a key="detail" onClick={() => props.onOpenRow(row)}>
              详情
            </a>,
          ],
        }
      : {}),
  }));
  return (
    <EditableProTable<RuntimeRow>
      headerTitle={<SurfaceTitle title={props.title} />}
      rowKey="id"
      columns={columns}
      value={props.rows}
      recordCreatorProps={false}
      search={false}
      options={{ density: true, setting: true, reload: false }}
      toolBarRender={() => [
        <CreateButton key="create" canCreate={props.canCreate} onCreate={props.onCreate} />,
      ]}
      editable={{
        type: "multiple",
        editableKeys,
        onChange: setEditableKeys,
        onSave: async (_key, row) => props.onSaveRow(row),
      }}
      pagination={{ pageSize: props.surface.density === "compact" ? 10 : 8 }}
    />
  );
}

function SplitListSurface(props: ProWorkbenchSurfaceProps) {
  const [selectedId, setSelectedId] = React.useState(props.rows[0]?.id);
  const selected = props.rows.find(row => row.id === selectedId) ?? props.rows[0];
  const titleField = props.fields[0];
  const descriptionField = props.fields[1];
  const descriptionColumns: ProDescriptionsItemProps<RuntimeRow>[] = props.fields.map(
    field => ({
      title: field.label,
      dataIndex: ["values", field.id],
      render: (_, row) => displayValue(field, row.values[field.id]),
    })
  );
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <SurfaceTitle title={props.title} />
        <CreateButton canCreate={props.canCreate} onCreate={props.onCreate} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 0.85fr) minmax(420px, 1.5fr)",
          border: "1px solid #f0f0f0",
          minHeight: 460,
        }}
      >
        <ProList<RuntimeRow>
          rowKey="id"
          dataSource={props.rows}
          search={{ filterType: "light" }}
          pagination={{ pageSize: 8, size: "small" }}
          metas={{
            title: {
              render: (_, row) =>
                titleField ? displayValue(titleField, row.values[titleField.id]) : row.id,
            },
            description: {
              render: (_, row) =>
                descriptionField
                  ? displayValue(descriptionField, row.values[descriptionField.id])
                  : row.id,
            },
          }}
          onRow={row => ({
            onClick: () => setSelectedId(row.id),
            style: {
              cursor: "pointer",
              background: row.id === selected?.id ? "#e6f4ff" : undefined,
            },
          })}
        />
        <div style={{ borderInlineStart: "1px solid #f0f0f0", padding: 24 }}>
          {selected ? (
            <ProDescriptions<RuntimeRow>
              title={
                titleField
                  ? displayValue(titleField, selected.values[titleField.id])
                  : selected.id
              }
              dataSource={selected}
              columns={descriptionColumns}
              column={2}
              extra={<Button onClick={() => props.onOpenRow(selected)}>完整详情</Button>}
            />
          ) : (
            <Empty description="暂无可查看的数据" />
          )}
        </div>
      </div>
    </div>
  );
}

function QueueSurface(props: ProWorkbenchSurfaceProps) {
  const statusField = props.fields.find(
    field => field.type === "enum" && (field.options?.length ?? 0) > 0
  );
  const options = statusField?.options ?? [];
  const [lane, setLane] = React.useState<string>("all");
  const filteredRows =
    lane === "all" || !statusField
      ? props.rows
      : props.rows.filter(row => String(row.values[statusField.id]) === lane);
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <SurfaceTitle title={props.title} />
        <CreateButton canCreate={props.canCreate} onCreate={props.onCreate} />
      </div>
      <Segmented
        block
        value={lane}
        onChange={value => setLane(String(value))}
        options={[
          { label: `全部 ${props.rows.length}`, value: "all" },
          ...options.map(option => ({
            label: `${option.label} ${props.rows.filter(row => String(row.values[statusField?.id ?? ""]) === option.id).length}`,
            value: option.id,
          })),
        ]}
        style={{ marginBottom: 16 }}
      />
      <ProTable<RuntimeRow>
        rowKey="id"
        columns={buildColumns(props.fields, props.onOpenRow)}
        dataSource={filteredRows}
        search={{ filterType: "light" }}
        options={{ density: true, setting: true, reload: false }}
        toolbar={{ settings: [] }}
        pagination={{ pageSize: props.surface.density === "compact" ? 10 : 8 }}
        cardBordered={false}
      />
    </div>
  );
}

export default function ProWorkbenchSurface(props: ProWorkbenchSurfaceProps) {
  const content =
    props.surface.type === "editable-table" ? (
      <EditableSurface {...props} />
    ) : props.surface.type === "split-list" ? (
      <SplitListSurface {...props} />
    ) : props.surface.type === "queue" ? (
      <QueueSurface {...props} />
    ) : (
      <TableSurface {...props} />
    );
  return (
    <section data-workbench-surface={props.surface.type} style={{ minWidth: 0 }}>
      {content}
    </section>
  );
}
