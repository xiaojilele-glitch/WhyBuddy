/**
 * EntityDataPanel — DataModel 屏的「数据表」视图（浏览器运行时 M2）。
 *
 * 实体行的直接编辑面：按实体切页，单元格即改即存（onBlur/Enter 提交，
 * number 字段经 validateRowValues 校验，非法值不落库并如实提示）。
 * 与「运行应用」「工作流试运行」共享同一份 localStorage 运行时状态——
 * 这里改一格，运行应用的表格实时变。零后端、零数据库。
 */

import React from "react";
import { Alert, Button, Empty, Flex, Input, Segmented, Space, Table, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import {
  type RuntimeState,
  initRuntimeState,
  addRow,
  updateRow,
  deleteRow,
  validateRowValues,
} from "./live-runtime";
import {
  loadRuntimeState,
  saveRuntimeState,
  notifyRuntimeChanged,
  subscribeRuntimeChanged,
} from "./runtime-persistence";
import { seedRuntimeState, dropSeedRowsFor, isSeedRow } from "./demo-seed";

function EditableCell({
  value,
  onCommit,
}: {
  value: unknown;
  onCommit: (raw: string) => void;
}) {
  const text = value === undefined || value === null ? "" : String(value);
  return (
    <Input
      size="small"
      variant="borderless"
      defaultValue={text}
      onBlur={(e) => {
        if (e.target.value !== text) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function EntityDataPanel({
  model,
  sessionId,
}: {
  model: FiveSystemModel;
  sessionId: string;
}) {
  const entities = model.datamodel?.entities ?? [];
  // 与运行应用共享同一份状态，也共享同一套演示种子（只铺空实体，幂等）
  const hydrate = React.useCallback(
    () => seedRuntimeState(loadRuntimeState(sessionId) ?? initRuntimeState(model), model),
    [sessionId, model]
  );
  const [state, setState] = React.useState<RuntimeState>(hydrate);
  const [activeEntityId, setActiveEntityId] = React.useState<string | null>(
    entities[0]?.id ?? null
  );
  const [problem, setProblem] = React.useState<string | null>(null);

  // 运行应用/工作流侧变更时重载（同一份状态）
  React.useEffect(
    () =>
      subscribeRuntimeChanged(sessionId, () => setState(hydrate())),
    [sessionId, hydrate]
  );

  const apply = (next: RuntimeState) => {
    setState(next);
    saveRuntimeState(sessionId, next);
    notifyRuntimeChanged(sessionId);
  };

  const entity = entities.find((e) => e.id === activeEntityId) ?? entities[0] ?? null;
  const fields = entity?.fields ?? [];
  const rows = entity ? state.entities[entity.id] ?? [] : [];

  const columns = [
    ...fields.map(field => ({
      key: field.id,
      title: (
        <Space size={4}>
          <span>{field.name || field.id}</span>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {field.type}
          </Typography.Text>
        </Space>
      ),
      render: (_: unknown, row: (typeof rows)[number]) => (
        <EditableCell
          value={row.values[field.id]}
          onCommit={raw => commitCell(row.id, field.id, raw)}
        />
      ),
    })),
    {
      key: "actions",
      title: "操作",
      width: 72,
      render: (_: unknown, row: (typeof rows)[number]) => (
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          aria-label="删除"
          onClick={() => entity && apply(deleteRow(state, entity.id, row.id))}
        />
      ),
    },
  ];

  const commitCell = (rowId: string, fieldId: string, raw: string) => {
    if (!entity) return;
    const row = rows.find((r) => r.id === rowId);
    const merged = { ...(row?.values ?? {}), [fieldId]: raw };
    const problems = validateRowValues(model, entity.id, merged);
    if (problems.length > 0) {
      // fail-closed：非法值不落库，如实提示（输入框失焦后仍显示旧值）
      setProblem(problems.join("；"));
      return;
    }
    setProblem(null);
    apply(updateRow(state, entity.id, rowId, { [fieldId]: raw }));
  };

  if (entities.length === 0) {
    return (
      <Empty description="本话题模型缺少实体定义，推演闭环后可编辑数据" />
    );
  }

  return (
    <Flex vertical gap="middle" className="h-full overflow-auto p-4" data-testid="datamodel-data-panel">
      <Alert
        type="info"
        showIcon
        message="单元格即改即存，与运行应用、工作流试运行共享同一份运行时数据"
      />
      {rows.some(isSeedRow) && (
        <Alert
          data-testid="datamodel-seed-notice"
          type="warning"
          showIcon
          message="示例数据"
          description={`当前 ${rows.length} 行里有 ${rows.filter(isSeedRow).length} 行是自动铺的演示行；新增一行会整批清除，直接改某一格则只有该行转为真实数据`}
        />
      )}

      <Segmented
        value={entity?.id}
        onChange={value => setActiveEntityId(String(value))}
        options={entities.map(item => ({
          value: item.id,
          label: (
            <span data-testid={`datamodel-entity-${item.id}`}>
              {item.name || item.id} <Tag bordered={false}>{(state.entities[item.id] ?? []).length}</Tag>
            </span>
          ),
        }))}
      />

      {problem && (
        <Alert type="error" showIcon message={`未保存：${problem}`} />
      )}

      <Table
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: <Empty description="暂无数据，可新增一行或到运行应用里新建" /> }}
      />

      <Button
        type="primary"
        icon={<PlusOutlined />}
        data-testid="datamodel-add-row"
        onClick={() => {
          if (!entity) return;
          apply(
            addRow(
              dropSeedRowsFor(state, entity.id),
              entity.id,
              {},
              new Date().toISOString()
            ).state
          );
        }}
      >
        新增一行
      </Button>
    </Flex>
  );
}
