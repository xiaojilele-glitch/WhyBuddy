/**
 * 层级选择区块（2026-08-10）—— 补三类此前完全缺位的交互形态。
 *
 * ## 起因：不是"区块不够"，是"形态缺了一整类"
 *
 * 审 356 个区块对 209 个基础组件的引用时数出来：`Cascader` / `TreeSelect` /
 * `Transfer` 三个 antd 组件**零区块引用**。不是它们冷门——是这三类交互
 * （多级下钻选一个、树上勾一片、两栏之间搬人）在目录里根本没有承载体：
 *
 *   · 层级：只有 `TreeNavigator`（导航，选中就跳走）和 `DataLineagePanel`
 *     （血缘，只读展示）。**没有"把层级当成一个输入控件"的那一个**。
 *   · 分配：只有 `PermissionMatrixPanel` 那种勾选框矩阵。矩阵在候选项上百
 *     的时候不可用——穿梭框存在的理由就是这个。
 *
 * 所以这一批是纯增量：三个新区块，不动任何存量。
 *
 * ## 从 antd 文档确认过的三条边界（都是会静默出错的那种）
 *
 *   Transfer   受控组件，官方原话「uncontrolled mode is not supported」——
 *              `targetKeys` 必须自己存自己给，且每项 `key` 必须唯一。
 *   TreeSelect 「Duplicate values across tree nodes can cause issues」——
 *              节点 value 必须唯一，所以这里一律用行 id 当 value，不用标签。
 *   Cascader   默认**只能选叶子**。分类筛选十有八九要允许选中间层，所以
 *              `changeOnSelect` 默认开着，由 props 关。
 *
 * ## 扁平父指针建树：抄本仓已经踩过的坑，再补一个
 *
 * 建树逻辑照 `TreeNavigatorRenderer`（block-registry.tsx）：Map 建节点、
 * 父不存在的当根、`parentId !== row.id` 挡自环。
 *
 * 它少挡了一种：**二元环**（甲的父是乙、乙的父是甲）。那种情况下甲乙互为
 * 子节点、谁都不在 roots 里，于是**两个节点在界面上凭空消失**——不报错、
 * 不空态，就是没了。模型生成的演示数据出现环并不稀奇。这里改成沿父链上溯，
 * 发现回到自己就把这一行当根，宁可层级摆错也不能让记录蒸发。
 */

import React from "react";
import { Alert, Button, Card, Cascader, Empty, Flex, Space, Tag, Transfer, TreeSelect, Typography } from "antd";
import type { ExperienceBlockRenderer, ExperienceBlockRendererProps } from "./block-registry";

type Variant = "category" | "orgTree" | "assignment";
type Config = { variant: Variant; title: string; testid: string };

const text = (value: unknown, fallback = "") => String(value ?? "").trim() || fallback;
const ref = (props: ExperienceBlockRendererProps, key: string) => text(props.block.binding?.[key]);
const targets = (props: ExperienceBlockRendererProps) =>
  Array.isArray(props.block.binding?.targets) ? props.block.binding.targets.map(String) : [];

type Row = { id: string; values?: Record<string, unknown> };
export type HierarchyNode = { value: string; label: string; title: string; children: HierarchyNode[] };

/**
 * 扁平的父指针行 → 树。父不存在、自环、以及**成环**都退化成根节点。
 *
 * 导出是为了让测试直接问它，而不是从渲染结果里反推树形。
 */
export function buildHierarchy(rows: Row[], labelRef: string, parentRef: string): HierarchyNode[] {
  const parentOf = new Map<string, string>();
  const nodes = new Map<string, HierarchyNode>();
  for (const row of rows) {
    const label = text(row.values?.[labelRef], row.id);
    nodes.set(row.id, { value: row.id, label, title: label, children: [] });
    parentOf.set(row.id, text(row.values?.[parentRef]));
  }
  /** 沿父链上溯；走回自己就是环。步数封顶是防数据里出现更长的怪链。 */
  const inCycle = (id: string) => {
    let cursor = parentOf.get(id) ?? "";
    for (let step = 0; step < nodes.size && cursor; step += 1) {
      if (cursor === id) return true;
      cursor = parentOf.get(cursor) ?? "";
    }
    return false;
  };
  const roots: HierarchyNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    const parentId = parentOf.get(row.id) ?? "";
    const parent = parentId === row.id ? undefined : nodes.get(parentId);
    if (parent && !inCycle(row.id)) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** 路径上每一层的标签，给 Cascader 回显用。 */
function pathLabels(roots: HierarchyNode[], path: string[]): string[] {
  const labels: string[] = [];
  let level = roots;
  for (const id of path) {
    const hit = level.find(node => node.value === id);
    if (!hit) break;
    labels.push(hit.label);
    level = hit.children;
  }
  return labels;
}

function createHierarchySelectionBlock(config: Config): ExperienceBlockRenderer {
  return props => {
    const entityRef = ref(props, "entityRef");
    const rows = entityRef ? props.entityRows?.[entityRef] : undefined;
    const labelRef = ref(props, "labelFieldRef");
    const parentRef = ref(props, "parentFieldRef");
    const descRef = ref(props, "descFieldRef");
    const statusRef = ref(props, "statusFieldRef");
    const assigneeRef = ref(props, "assigneeFieldRef");
    const [path, setPath] = React.useState<string[]>([]);
    const [checked, setChecked] = React.useState<string[]>([]);
    const [assigned, setAssigned] = React.useState<string[] | null>(null);
    const shell = (children: React.ReactNode) =>
      props.block.props?.surface === "plain" ? (
        <section data-testid={config.testid}>{children}</section>
      ) : (
        <Card size="small" title={text(props.block.props?.title, config.title)} data-testid={config.testid}>
          {children}
        </Card>
      );
    const needsParent = config.variant !== "assignment";
    if (!entityRef || !rows || !labelRef || (needsParent && !parentRef) || (config.variant === "assignment" && !assigneeRef)) {
      return shell(
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`${config.title}尚未绑定${needsParent ? "名称和父节点字段" : "名称和负责人字段"}`}
        />
      );
    }
    const submit = (operation: string, payload: Record<string, unknown> = {}) =>
      props.onAction?.("submitRequest", { entityRef, operation, targets: targets(props), ...payload });

    let body: React.ReactNode;
    switch (config.variant) {
      case "category": {
        const roots = buildHierarchy(rows, labelRef, parentRef);
        const labels = pathLabels(roots, path);
        body = (
          <Flex vertical gap={10}>
            <Cascader
              style={{ width: "100%" }}
              options={roots}
              value={path}
              // 默认允许选中间层：分类筛选大多要「整个甲类」，而 antd 默认只放叶子。
              changeOnSelect={props.block.props?.leafOnly !== true}
              showSearch={{ filter: (input, options) => options.some(option => String(option.label).toLowerCase().includes(input.toLowerCase())) }}
              allowClear
              placeholder={text(props.block.props?.placeholder, "选择分类")}
              fieldNames={{ label: "label", value: "value", children: "children" }}
              onChange={value => {
                const next = (value ?? []).map(String);
                setPath(next);
                const leaf = next.at(-1);
                props.onAction?.("filterChange", {
                  entityRef,
                  categoryPath: next,
                  rowId: leaf,
                  targets: targets(props),
                });
                if (leaf) props.onAction?.("itemSelect", { entityRef, rowId: leaf });
              }}
            />
            {labels.length > 0 ? (
              <Space size={4} wrap>
                {labels.map((label, index) => (
                  <Tag key={`${label}-${index}`}>{label}</Tag>
                ))}
              </Space>
            ) : (
              <Typography.Text type="secondary">尚未选择分类，下游区块按全部记录显示</Typography.Text>
            )}
          </Flex>
        );
        break;
      }
      case "orgTree": {
        const roots = buildHierarchy(rows, labelRef, parentRef);
        const disabledIds = statusRef
          ? new Set(rows.filter(row => /disabled|inactive|停用|禁用|离职/i.test(text(row.values?.[statusRef]))).map(row => row.id))
          : new Set<string>();
        const decorate = (nodes: HierarchyNode[]): Array<HierarchyNode & { disabled: boolean }> =>
          nodes.map(node => ({ ...node, disabled: disabledIds.has(node.value), children: decorate(node.children) }));
        body = (
          <Flex vertical gap={10}>
            <TreeSelect
              style={{ width: "100%" }}
              treeData={decorate(roots)}
              value={checked}
              // 节点 value 一律用行 id：antd 明说树里出现重复 value 会出问题，
              // 而标签重名（两个部门都叫「运营组」）在真实组织里再常见不过。
              treeCheckable
              showCheckedStrategy={TreeSelect.SHOW_PARENT}
              treeNodeFilterProp="label"
              treeDefaultExpandAll
              allowClear
              maxTagCount={6}
              placeholder={text(props.block.props?.placeholder, "选择部门或权限节点")}
              onChange={value => setChecked((value ?? []).map(String))}
            />
            {disabledIds.size > 0 && <Alert type="info" showIcon message={`${disabledIds.size} 个停用节点不可勾选`} />}
            <Alert type="warning" showIcon message="提交只发起授权申请，不在前端直接改权限" />
            <Button
              type="primary"
              disabled={checked.length === 0}
              onClick={() => submit("requestScopeGrant", { nodeIds: checked })}
            >
              提交授权范围
            </Button>
          </Flex>
        );
        break;
      }
      case "assignment": {
        // Transfer 是受控组件（官方原话），targetKeys 必须自己存。首次进来
        // 以「负责人字段非空」为已分配，之后交给本地草稿，别被数据回灌覆盖。
        const initial = rows.filter(row => text(row.values?.[assigneeRef])).map(row => row.id);
        const targetKeys = assigned ?? initial;
        const before = new Set(initial);
        const after = new Set(targetKeys);
        const added = targetKeys.filter(id => !before.has(id));
        const removed = initial.filter(id => !after.has(id));
        body = (
          <Flex vertical gap={10}>
            <Transfer
              dataSource={rows.map(row => ({
                key: row.id,
                title: text(row.values?.[labelRef], row.id),
                description: descRef ? text(row.values?.[descRef]) : "",
              }))}
              targetKeys={targetKeys}
              onChange={next => setAssigned(next.map(String))}
              render={item => (item.description ? `${item.title} · ${item.description}` : item.title)}
              showSearch
              filterOption={(input, item) => `${item.title} ${item.description ?? ""}`.toLowerCase().includes(input.toLowerCase())}
              titles={[
                text(props.block.props?.sourceTitle, "待分配"),
                text(props.block.props?.targetTitle, "已分配"),
              ]}
              listStyle={{ width: "45%", height: 240 }}
              locale={{ itemUnit: "项", itemsUnit: "项", searchPlaceholder: "搜索记录" }}
            />
            <Alert
              type={added.length || removed.length ? "warning" : "info"}
              showIcon
              message={
                added.length || removed.length
                  ? `待提交：新增分配 ${added.length} 项，取消分配 ${removed.length} 项`
                  : "分配尚未改动"
              }
            />
            <Button
              type="primary"
              disabled={added.length === 0 && removed.length === 0}
              onClick={() => submit("applyAssignment", { assignedIds: added, unassignedIds: removed })}
            >
              提交分配变更
            </Button>
          </Flex>
        );
        break;
      }
    }
    return shell(body);
  };
}

const configs: Record<string, Config> = {
  HierarchicalCategoryPicker: { variant: "category", title: "多级分类选择", testid: "hierarchical-category-picker" },
  OrgTreeSelector: { variant: "orgTree", title: "组织权限树选择", testid: "org-tree-selector" },
  AssignmentTransfer: { variant: "assignment", title: "穿梭分配面板", testid: "assignment-transfer" },
};

export const HIERARCHY_SELECTION_RENDERERS: Record<string, ExperienceBlockRenderer> = Object.fromEntries(
  Object.entries(configs).map(([type, config]) => [type, createHierarchySelectionBlock(config)])
);
export const HIERARCHY_SELECTION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(configs).map(([type, config]) => [type, config.title])
);
