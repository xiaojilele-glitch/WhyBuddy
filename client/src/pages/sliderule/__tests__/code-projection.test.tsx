/**
 * 代码投影（代码视图二期）测试。
 * 锁：完整工程结构投影——工程清单/入口路由/每实体数据访问层/每页面一文件/
 * 每能力一文件/范式组件契约；DDL 的 enum CHECK、TS union、状态机链路、
 * RBAC 常量、README 不变式清单；缺段文件如实缺席；中文 id 净化为合法
 * 标识符；CodeProjectionView 目录树静态渲染（编辑器懒加载回退 <pre>）。
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveCodeProjection } from "../live-runtime/code-projection";
import { CodeProjectionView } from "../live-runtime/CodeProjectionView";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "customer",
        name: "客户",
        fields: [
          { id: "id", name: "编号", type: "string" },
          { id: "name", name: "客户名称", type: "string" },
          {
            id: "deal_amount",
            name: "成交金额",
            type: "number",
            format: "money",
          },
          {
            id: "status",
            name: "跟进状态",
            type: "enum",
            options: [
              { id: "待跟进", tone: "warning" },
              { id: "已成交", tone: "success" },
            ],
          },
        ],
      },
    ],
  },
  rbac: {
    roles: ["sales", "manager"],
    permissions: ["customer:create"],
    menus: [
      {
        id: "m1",
        label: "客户",
        roleRefs: ["sales"],
        permissionRefs: ["customer:create"],
      },
    ],
  },
  workflow: {
    id: "wf_follow",
    name: "跟进主链路",
    nodes: [
      { id: "n_new", name: "新建", assigneeRole: "sales", phase: "录入" },
      { id: "n_ok", name: "成交", assigneeRole: "manager", phase: "收口" },
    ],
    transitions: [{ from: "n_new", to: "n_ok", condition: "确认成交" }],
    chains: [
      {
        id: "chain_money",
        name: "回款",
        kind: "money",
        nodes: [{ id: "m_pay", name: "回款确认", assigneeRole: "manager" }],
        transitions: [],
      },
    ],
  },
  page: {
    pages: [
      {
        id: "p_board",
        name: "跟进看板",
        kind: "kanban",
        statusField: "customer.status",
        fieldBindings: ["customer.name", "customer.status"],
        actionPermissions: ["customer:create"],
        stats: [
          {
            id: "s1",
            name: "成交总额",
            entity: "customer",
            metric: "sum:customer.deal_amount",
            format: "money",
          },
        ],
      },
    ],
  },
  aigc: {
    capabilities: [
      {
        id: "cap_summary",
        name: "跟进摘要",
        inputFields: ["customer.name"],
        outputField: "customer.status",
        roleRefs: ["sales"],
      },
    ],
    pipelines: [
      { id: "pipe_1", name: "摘要链", steps: ["cap_summary", "cap_summary"] },
    ],
  },
  appbundle: {
    pageBindings: [{ pageRef: "p_board", workflowRef: "wf_follow" }],
    roleRefs: ["sales"],
    dataModelRefs: ["customer"],
    invariants: [
      {
        id: "inv1",
        statement: "成交金额只能由回款确认节点写入",
        systems: ["workflow"],
        refs: ["m_pay"],
      },
    ],
  },
};

describe("deriveCodeProjection", () => {
  const files = deriveCodeProjection(MODEL, "轻量 CRM");
  const byPath = Object.fromEntries(files.map(f => [f.path, f.content]));

  it("完整工程结构齐全，均带只读投影头注", () => {
    expect(files.map(f => f.path)).toEqual([
      "README.md",
      "package.json",
      "db/schema.sql",
      "src/main.tsx",
      "src/types.ts",
      "src/rbac.ts",
      "src/workflow.ts",
      "src/api/customer.ts",
      "src/components/paradigms.tsx",
      "src/pages/p_board.tsx",
      "src/aigc/client.ts",
      "src/aigc/cap_summary.ts",
      "src/aigc/pipelines.ts",
    ]);
    for (const f of files) {
      expect(f.content).toContain("确定性投影");
    }
  });

  it("工程清单：npm 安全名 + 依赖/脚本（有页面才带 antd）", () => {
    const pkg = JSON.parse(byPath["package.json"]);
    expect(pkg.private).toBe(true);
    expect(pkg.name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(pkg.dependencies.antd).toBeTruthy();
    expect(pkg.scripts.dev).toBe("vite");
  });

  it("DDL：enum 取值落成 CHECK；format/展示名进注释", () => {
    const sql = byPath["db/schema.sql"];
    expect(sql).toContain("CREATE TABLE customer (");
    expect(sql).toContain("CHECK (status IN ('待跟进', '已成交'))");
    expect(sql).toContain("deal_amount NUMERIC");
    expect(sql).toContain("format=money");
  });

  it("类型：enum 取值落成 union；实体名 PascalCase", () => {
    const ts = byPath["src/types.ts"];
    expect(ts).toContain("export interface Customer {");
    expect(ts).toContain('status: "待跟进" | "已成交";');
    expect(ts).toContain("deal_amount: number;");
  });

  it("入口路由：每页面 import + 路由表", () => {
    const main = byPath["src/main.tsx"];
    expect(main).toContain('import { PBoardPage } from "./pages/p_board";');
    expect(main).toContain('path: "/p_board"');
    expect(main).toContain('name: "跟进看板"');
  });

  it("数据访问层：每实体一份 CRUD 契约（诚实骨架，不伪造实现）", () => {
    const api = byPath["src/api/customer.ts"];
    expect(api).toContain('import type { Customer } from "../types";');
    expect(api).toContain(
      "export async function listCustomer(): Promise<Customer[]> {"
    );
    expect(api).toContain(
      'export async function createCustomer(input: Omit<Customer, "id">): Promise<Customer> {'
    );
    expect(api).toContain("投影骨架：待接入真实后端");
  });

  it("状态机：主链路 + 附加链路（kind/phase/condition 保留）", () => {
    const wf = byPath["src/workflow.ts"];
    expect(wf).toContain("主链路：跟进主链路");
    expect(wf).toContain('assigneeRole: "sales"');
    expect(wf).toContain('condition: "确认成交"');
    expect(wf).toContain("附加链路：回款");
    expect(wf).toContain('kind: "money"');
  });

  it("RBAC：角色/权限/菜单授予常量", () => {
    const rbac = byPath["src/rbac.ts"];
    expect(rbac).toContain('"sales"');
    expect(rbac).toContain('"customer:create"');
    expect(rbac).toContain("export const MENUS");
  });

  it("页面文件：范式组件 import + KPI 注释；范式契约文件存在", () => {
    const page = byPath["src/pages/p_board.tsx"];
    expect(page).toContain(
      'import { KanbanBoard } from "../components/paradigms";'
    );
    expect(page).toContain("范式：kanban");
    expect(page).toContain('<KanbanBoard statusField="customer.status" />');
    expect(page).toContain("KPI：成交总额");
    const paradigms = byPath["src/components/paradigms.tsx"];
    expect(paradigms).toContain("export function KanbanBoard(");
    expect(paradigms).toContain("export interface DataTableProps {");
  });

  it("AIGC：每能力一文件（契约签名）+ 通道占位 + 编排", () => {
    const cap = byPath["src/aigc/cap_summary.ts"];
    expect(cap).toContain("export async function cap_summary(input: {");
    expect(cap).toContain('"customer.name": string;');
    expect(cap).toContain("写回目标：customer.status");
    expect(cap).toContain(
      'import { callLlmExplain, type ExplainedOutput } from "./client";'
    );
    const client = byPath["src/aigc/client.ts"];
    expect(client).toContain("export async function callLlmExplain(");
    expect(client).toContain("投影骨架：待接入 LLM 通道");
    expect(byPath["src/aigc/pipelines.ts"]).toContain("export const pipe_1");
  });

  it("README：规模统计 + 目录对照 + 不变式验收清单", () => {
    const readme = byPath["README.md"];
    expect(readme).toContain("# 轻量 CRM");
    expect(readme).toContain("1 实体 · 1 页面 · 1 项 AI 能力");
    expect(readme).toContain("`src/api/`");
    expect(readme).toContain("- [ ] 成交金额只能由回款确认节点写入");
  });

  it("缺段文件如实缺席；空模型返回空数组；投影确定性（两次相同）", () => {
    const partial = deriveCodeProjection({
      datamodel: MODEL.datamodel,
      page: { pages: [] },
    } as FiveSystemModel);
    expect(partial.map(f => f.path)).toEqual([
      "README.md",
      "package.json",
      "db/schema.sql",
      "src/types.ts",
      "src/api/customer.ts",
    ]);
    expect(deriveCodeProjection(null)).toEqual([]);
    expect(deriveCodeProjection(MODEL, "轻量 CRM")).toEqual(files);
  });

  it("中文/非法 id 净化为合法标识符（原文保留在注释/字面量）", () => {
    const weird = deriveCodeProjection({
      datamodel: {
        entities: [
          {
            id: "客户档案",
            name: "客户档案",
            fields: [{ id: "姓名", name: "姓名", type: "string" }],
          },
        ],
      },
      page: { pages: [] },
    } as FiveSystemModel);
    const sql = weird.find(f => f.path === "db/schema.sql")!.content;
    expect(sql).toMatch(/CREATE TABLE [A-Za-z_][A-Za-z0-9_]* \(/);
    expect(sql).not.toMatch(/CREATE TABLE 客户档案/);
    expect(sql).toContain("-- 客户档案");
    const api = weird.find(f => f.path.startsWith("src/api/"))!;
    expect(api.path).toMatch(/^src\/api\/[A-Za-z_][A-Za-z0-9_]*\.ts$/);
  });
});

describe("CodeProjectionView 渲染", () => {
  it("目录树（文件夹 + 文件）+ 代码面板回退 <pre>（无顶部说明条）", () => {
    const html = renderToStaticMarkup(
      <CodeProjectionView model={MODEL} appName="轻量 CRM" />
    );
    expect(html).toContain('data-testid="app-runtime-code"');
    expect(html).toContain('data-testid="code-dir-src"');
    expect(html).toContain('data-testid="code-dir-src/api"');
    expect(html).toContain('data-testid="code-file-db/schema.sql"');
    expect(html).toContain('data-testid="code-file-src/pages/p_board.tsx"');
    expect(html).toContain("ant-tree");
    // 顶部说明条已按用户裁决移除；诚实声明留在投影文件首行注释（上一用例锁）
    expect(html).not.toContain("要改内容请回到意图重新推演");
    // 编辑器懒加载未就绪时回退 <pre>，内容为默认展示文件（README）
    expect(html).toContain('data-testid="code-content"');
    expect(html).toContain("# 轻量 CRM");
  });

  it("空模型如实空态", () => {
    const html = renderToStaticMarkup(
      <CodeProjectionView model={{} as FiveSystemModel} />
    );
    expect(html).toContain("还没有可投影的五系统模型");
  });
});
