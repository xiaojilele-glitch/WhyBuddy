/**
 * 层级选择三件套（2026-08-10）。
 *
 * 这三个区块是为了填 `Cascader` / `TreeSelect` / `Transfer` 三个零引用的
 * 基础组件而加的，所以第一条用例问的是**接线**：目录、桌面注册表、手机
 * 分发链三处都得认它们，少一处就是"加了但用不上"。
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import { HIERARCHY_SELECTION_LABELS, buildHierarchy } from "../hierarchy-selection-blocks";
import { usageForBlock } from "../../component-usage";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const row = (id: string, name: string, parent: string, assignee = "", status = "active") => ({
  id,
  createdAt: "2026-08-10T09:00:00.000Z",
  values: { name, parent, assignee, status, desc: `${name}说明` },
});
const binding = {
  entityRef: "nodes",
  labelFieldRef: "name",
  parentFieldRef: "parent",
  assigneeFieldRef: "assignee",
  statusFieldRef: "status",
  descFieldRef: "desc",
  targets: ["data"],
};
const block = (type: string): ExperienceBlockInstance => ({
  id: type,
  type,
  props: { title: HIERARCHY_SELECTION_LABELS[type], surface: "card" },
  binding,
});
const entityRows = {
  nodes: [
    row("root", "华东大区", ""),
    row("child", "上海分部", "root", "张三"),
    row("stopped", "已撤销组", "root", "", "disabled"),
  ],
};

describe("层级选择区块", () => {
  it("三个类型进入目录、桌面注册表和手机分发链", () => {
    const catalog = catalogJson as {
      blocks: Array<{ type: string; label?: string; rendererStatus: string; generationEnabled: boolean; source?: { repo?: string; path?: string } }>;
    };
    for (const type of Object.keys(HIERARCHY_SELECTION_LABELS)) {
      const entry = catalog.blocks.find(item => item.type === type);
      expect(entry?.rendererStatus, type).toBe("real");
      expect(entry?.generationEnabled, type).toBe(true);
      expect(entry?.label, type).toBe(HIERARCHY_SELECTION_LABELS[type]);
      expect(entry?.source?.repo, type).toBeTruthy();
      expect(BLOCK_DEFINITIONS[type]?.render, type).toBeTypeOf("function");
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true);
    }
  });

  it("这三个正是把 Cascader / TreeSelect / Transfer 用起来的那三个", () => {
    // 加它们的**理由**就是这个。
    //
    // 2026-08-10 改判据：此前读的是注册表上手写的 `uses` 声明，注释还写着
    // "声明漂了这条就红"。**反了**——手写声明恰恰是会说谎的那一头，它红
    // 只说明有人改了字符串。真出过的事故正是这个方向：这三个区块当时压根
    // 没进依赖图（批量登记的 spread 读不到），Cascader/TreeSelect/Transfer
    // 在统计里还是"零引用"，而这条用例一直是绿的。
    //
    // 现在读从渲染器 AST 生成的依赖图——断言"真的渲染了"，不是"真的写了"。
    const used = (type: string) => usageForBlock(type).all;
    expect(used("HierarchicalCategoryPicker")).toContain("Cascader");
    expect(used("OrgTreeSelector")).toContain("TreeSelect");
    expect(used("AssignmentTransfer")).toContain("Transfer");
  });

  it("桌面与手机都渲染真实层级数据，不是占位壳", () => {
    for (const type of Object.keys(HIERARCHY_SELECTION_LABELS)) {
      const props = { block: block(type), entityRows };
      const desktop = renderToStaticMarkup(<ExperienceBlockBoundary {...props} />);
      const phone = renderToStaticMarkup(<PhoneExperienceBlock {...props} />);
      expect(desktop, type).toContain(HIERARCHY_SELECTION_LABELS[type]);
      expect(phone, type).toContain(HIERARCHY_SELECTION_LABELS[type]);
      expect(desktop, type).not.toContain("尚未绑定");
    }
  });

  it("穿梭分配的初始右栏取自负责人字段，未改动时提交按钮是禁用的", () => {
    const html = renderToStaticMarkup(<ExperienceBlockBoundary block={block("AssignmentTransfer")} entityRows={entityRows} />);
    expect(html).toContain("分配尚未改动");
    expect(html).toContain("disabled");
    expect(html).toContain("上海分部");
  });

  it("组织树把停用节点数出来，并且明说提交只是申请", () => {
    const html = renderToStaticMarkup(<ExperienceBlockBoundary block={block("OrgTreeSelector")} entityRows={entityRows} />);
    expect(html).toContain("1 个停用节点不可勾选");
    expect(html).toContain("不在前端直接改权限");
  });

  it("绑定缺字段时给的是空态，不是崩", () => {
    const bare: ExperienceBlockInstance = { id: "x", type: "HierarchicalCategoryPicker", props: {}, binding: { entityRef: "nodes" } };
    expect(renderToStaticMarkup(<ExperienceBlockBoundary block={bare} entityRows={entityRows} />)).toContain("尚未绑定");
  });
});

describe("buildHierarchy —— 扁平父指针建树", () => {
  const rows = (pairs: Array<[string, string]>) =>
    pairs.map(([id, parent]) => ({ id, values: { name: id.toUpperCase(), parent } }));

  it("父不存在的当根，正常父子挂上去", () => {
    const tree = buildHierarchy(rows([["a", ""], ["b", "a"], ["c", "不存在"]]), "name", "parent");
    expect(tree.map(node => node.value)).toEqual(["a", "c"]);
    expect(tree[0].children.map(node => node.value)).toEqual(["b"]);
    expect(tree[0].label).toBe("A");
  });

  it("自环当根", () => {
    const tree = buildHierarchy(rows([["a", "a"]]), "name", "parent");
    expect(tree.map(node => node.value)).toEqual(["a"]);
  });

  it("二元环两边都当根 —— 而不是双双从界面上消失", () => {
    // TreeNavigator 那版只挡自环：甲乙互为父子时两个都不在 roots 里，
    // 界面上凭空少两条记录且不报错。这条就是钉住那个回归。
    const tree = buildHierarchy(rows([["a", "b"], ["b", "a"]]), "name", "parent");
    expect(tree.map(node => node.value).sort()).toEqual(["a", "b"]);
  });

  it("长环也不死循环", () => {
    const tree = buildHierarchy(rows([["a", "c"], ["b", "a"], ["c", "b"]]), "name", "parent");
    expect(tree.length).toBeGreaterThan(0);
    expect(tree.map(node => node.value).sort()).toEqual(["a", "b", "c"]);
  });

  it("每条记录只出现一次", () => {
    const tree = buildHierarchy(rows([["a", ""], ["b", "a"], ["c", "b"], ["d", "不存在"]]), "name", "parent");
    const flat = (nodes: ReturnType<typeof buildHierarchy>): string[] =>
      nodes.flatMap(node => [node.value, ...flat(node.children)]);
    expect(flat(tree).sort()).toEqual(["a", "b", "c", "d"]);
  });
});
