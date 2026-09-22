/**
 * 层级选择三件套的手机档（2026-08-10）。
 *
 * 桌面档用的 Cascader / TreeSelect / Transfer 在 antd-mobile 里各有对应，
 * 但对应得并不整齐，逐条记一下换算依据：
 *
 *   Cascader  → `CascaderView`。antd-mobile 的 `Cascader` 是**弹层**，要自己
 *               管 visible；这里的区块是常驻在页面上的一段，用内联的
 *               `CascaderView` 才对得上桌面档的形态。
 *   TreeSelect→ `TreeSelect`。同名同义，值同样是一串 id。
 *   Transfer  → **没有对应组件**。手机上左右两栏搬运本来就不成立（宽度不够、
 *               拖拽手势与滚动打架）。换成 `CheckList` 勾选 + 一个提交按钮：
 *               保留"最终提交的是差集"这条语义，放弃"两栏"这个形态。
 */

import React from "react";
import { Button, CascaderView, CheckList, ErrorBlock, Card, Space, Tag, TreeSelect } from "antd-mobile";
import type { ExperienceBlockRendererProps } from "../block-registry";
import { HIERARCHY_SELECTION_LABELS, buildHierarchy } from "../hierarchy-selection-blocks";

const text = (value: unknown, fallback = "") => String(value ?? "").trim() || fallback;
const ref = (props: ExperienceBlockRendererProps, key: string) => text(props.block.binding?.[key]);
const targets = (props: ExperienceBlockRendererProps) =>
  Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];

export function renderHierarchySelectionPhoneBlock(
  props: ExperienceBlockRendererProps
): React.ReactNode | undefined {
  const label = HIERARCHY_SELECTION_LABELS[props.block.type];
  if (!label) return undefined;
  const entityRef = ref(props, "entityRef");
  const rows = entityRef ? props.entityRows?.[entityRef] : undefined;
  const labelRef = ref(props, "labelFieldRef");
  const parentRef = ref(props, "parentFieldRef");
  const descRef = ref(props, "descFieldRef");
  const assigneeRef = ref(props, "assigneeFieldRef");
  const [path, setPath] = React.useState<string[]>([]);
  const [checked, setChecked] = React.useState<string[]>([]);
  const [assigned, setAssigned] = React.useState<string[] | null>(null);
  const shell = (children: React.ReactNode) =>
    props.block.props?.surface === "plain" ? (
      <section data-testid={`phone-${props.block.type}`}>{children}</section>
    ) : (
      <Card title={text(props.block.props?.title, label)} data-testid={`phone-${props.block.type}`}>
        {children}
      </Card>
    );
  const needsParent = props.block.type !== "AssignmentTransfer";
  if (!entityRef || !rows || !labelRef || (needsParent && !parentRef) || (!needsParent && !assigneeRef)) {
    return shell(<ErrorBlock status="empty" title={`${label}尚未绑定层级字段`} />);
  }
  const submit = (operation: string, payload: Record<string, unknown> = {}) =>
    props.onAction?.("submitRequest", { entityRef, operation, targets: targets(props), ...payload });

  let body: React.ReactNode;
  switch (props.block.type) {
    case "HierarchicalCategoryPicker":
      body = (
        <Space direction="vertical" block>
          <CascaderView
            options={buildHierarchy(rows, labelRef, parentRef)}
            value={path}
            onChange={value => {
              const next = value.map(String).filter(Boolean);
              setPath(next);
              const leaf = next.at(-1);
              props.onAction?.("filterChange", { entityRef, categoryPath: next, rowId: leaf, targets: targets(props) });
              if (leaf) props.onAction?.("itemSelect", { entityRef, rowId: leaf });
            }}
          />
          {path.length > 0 ? (
            <Space wrap>
              {path.map(id => (
                <Tag key={id} color="primary" fill="outline">
                  {text(rows.find(row => row.id === id)?.values?.[labelRef], id)}
                </Tag>
              ))}
            </Space>
          ) : (
            <small>尚未选择分类，下游区块按全部记录显示。</small>
          )}
        </Space>
      );
      break;
    case "OrgTreeSelector":
      body = (
        <Space direction="vertical" block>
          <TreeSelect
            options={buildHierarchy(rows, labelRef, parentRef)}
            value={checked}
            onChange={value => setChecked(value.map(String))}
          />
          <small>提交只发起授权申请，不在前端直接改权限。</small>
          <Button
            block
            color="primary"
            disabled={checked.length === 0}
            onClick={() => submit("requestScopeGrant", { nodeIds: checked })}
          >
            提交授权范围
          </Button>
        </Space>
      );
      break;
    case "AssignmentTransfer": {
      const initial = rows.filter(row => text(row.values?.[assigneeRef])).map(row => row.id);
      const current = assigned ?? initial;
      const before = new Set(initial);
      const after = new Set(current);
      const added = current.filter(id => !before.has(id));
      const removed = initial.filter(id => !after.has(id));
      body = (
        <Space direction="vertical" block>
          <CheckList multiple value={current} onChange={value => setAssigned(value.map(String))}>
            {rows.map(row => (
              <CheckList.Item key={row.id} value={row.id} description={descRef ? text(row.values?.[descRef]) : undefined}>
                {text(row.values?.[labelRef], row.id)}
              </CheckList.Item>
            ))}
          </CheckList>
          <small>
            {added.length || removed.length
              ? `待提交：新增分配 ${added.length} 项，取消分配 ${removed.length} 项`
              : "分配尚未改动。"}
          </small>
          <Button
            block
            color="primary"
            disabled={added.length === 0 && removed.length === 0}
            onClick={() => submit("applyAssignment", { assignedIds: added, unassignedIds: removed })}
          >
            提交分配变更
          </Button>
        </Space>
      );
      break;
    }
    default:
      return undefined;
  }
  return shell(body);
}
