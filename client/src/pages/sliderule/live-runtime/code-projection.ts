/**
 * code-projection — 五系统 schema → 工程代码的确定性投影（代码视图二期）。
 *
 * 与运行应用同源：schema 是唯一真相，运行界面是它的交互投影，这里是
 * 它的代码投影——纯函数、零 LLM、可逐字节测试。二期投影的是完整工程
 * 结构（工程清单/入口路由/每实体数据访问层/每页面一文件/每能力一文件/
 * 范式组件契约），仍是"读得懂的工程骨架"，不是可直接部署的成品；
 * 每个文件头都注明这一点，修改应回到意图重新推演而不是改产物。
 */

import type {
  FiveSystemModel,
  FiveSystemField,
  FiveSystemEntity,
  PageModelDef,
  WorkflowChain,
} from "../system-screens/five-system-model";
import { normalizeFieldFormat, normalizeFieldOptions } from "./field-display";

export interface ProjectedFile {
  /** 展示用相对路径（如 "db/schema.sql"） */
  path: string;
  /** 渲染提示（目录树图标 + 编辑器语言） */
  language: "sql" | "typescript" | "tsx" | "markdown" | "json";
  content: string;
}

const HEADER_NOTE =
  "由面团 AI 五系统 schema 确定性投影生成（只读视图）——想改这里的内容，请回到意图重新推演，而不是改这份代码";

function comment(lang: ProjectedFile["language"], text: string): string {
  return lang === "sql"
    ? `-- ${text}`
    : lang === "markdown"
      ? `<!-- ${text} -->`
      : `// ${text}`;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 中文/非法 id → 合法标识符（保留原文进注释；确定性哈希后缀防撞） */
function toIdent(raw: string, fallback: string): string {
  const s = String(raw || "").trim();
  if (IDENT_RE.test(s)) return s;
  const ascii = s.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (ascii && IDENT_RE.test(ascii)) return ascii;
  let hash = 0;
  for (const ch of s) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${fallback}_${hash.toString(36)}`;
}

/** 同一目录里不同原始 id 净化后可能撞名 → 确定性去重（_2、_3…） */
function uniqueIdent(raw: string, fallback: string, used: Set<string>): string {
  const base = toIdent(raw, fallback);
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}

function toPascal(ident: string): string {
  return ident
    .split("_")
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join("");
}

function sqlType(field: FiveSystemField): string {
  switch (String(field.type || "string").toLowerCase()) {
    case "number":
      return "NUMERIC";
    case "date":
      return "DATE";
    default:
      return "TEXT"; // string / text / enum / ref 底层都存文本
  }
}

// --- db/schema.sql -----------------------------------------------------------

function buildSchemaSql(model: FiveSystemModel): string {
  const lines: string[] = [comment("sql", HEADER_NOTE), ""];
  for (const entity of model.datamodel?.entities ?? []) {
    const table = toIdent(entity.id, "entity");
    lines.push(`-- ${entity.name || entity.id}`);
    lines.push(`CREATE TABLE ${table} (`);
    const cols: string[] = [`  id TEXT PRIMARY KEY`];
    for (const field of entity.fields ?? []) {
      if (field.id === "id") continue;
      const col = toIdent(field.id, "field");
      let def = `  ${col} ${sqlType(field)}`;
      const options = normalizeFieldOptions(field.type, field.options);
      if (options.length > 0) {
        def += ` CHECK (${col} IN (${options.map(o => `'${o.id.replace(/'/g, "''")}'`).join(", ")}))`;
      }
      const notes: string[] = [];
      if (field.name && field.name !== field.id) notes.push(field.name);
      const format = normalizeFieldFormat(field.type, field.format);
      if (format) notes.push(`format=${format}`);
      if (String(field.type).toLowerCase() === "ref")
        notes.push("外键（按命名约定关联）");
      if (notes.length > 0) def += ` -- ${notes.join(" · ")}`;
      cols.push(def);
    }
    lines.push(cols.join(",\n"));
    lines.push(`);`);
    lines.push("");
  }
  return lines.join("\n");
}

// --- src/types.ts ------------------------------------------------------------

function tsType(field: FiveSystemField): string {
  const options = normalizeFieldOptions(field.type, field.options);
  if (options.length > 0)
    return options.map(o => JSON.stringify(o.id)).join(" | ");
  switch (String(field.type || "string").toLowerCase()) {
    case "number":
      return "number";
    default:
      return "string";
  }
}

function buildTypesTs(model: FiveSystemModel): string {
  const lines: string[] = [comment("typescript", HEADER_NOTE), ""];
  for (const entity of model.datamodel?.entities ?? []) {
    const name = toPascal(toIdent(entity.id, "entity"));
    lines.push(`/** ${entity.name || entity.id} */`);
    lines.push(`export interface ${name} {`);
    for (const field of entity.fields ?? []) {
      const notes: string[] = [];
      if (field.name && field.name !== field.id) notes.push(field.name);
      const format = normalizeFieldFormat(field.type, field.format);
      if (format) notes.push(`format=${format}`);
      if (notes.length > 0) lines.push(`  /** ${notes.join(" · ")} */`);
      lines.push(`  ${toIdent(field.id, "field")}: ${tsType(field)};`);
    }
    lines.push(`}`);
    lines.push("");
  }
  return lines.join("\n");
}

// --- src/api/<entity>.ts -------------------------------------------------------

function buildApiTs(entity: FiveSystemEntity, ident: string): string {
  const pascal = toPascal(ident);
  const label = entity.name || entity.id;
  return [
    comment("typescript", HEADER_NOTE),
    `// ${label} 的数据访问层（CRUD 契约）——投影骨架，对接真实后端时实现`,
    "",
    `import type { ${pascal} } from "../types";`,
    "",
    `export async function list${pascal}(): Promise<${pascal}[]> {`,
    `  throw new Error("投影骨架：待接入真实后端");`,
    `}`,
    "",
    `export async function get${pascal}(id: string): Promise<${pascal} | null> {`,
    `  throw new Error("投影骨架：待接入真实后端");`,
    `}`,
    "",
    `export async function create${pascal}(input: Omit<${pascal}, "id">): Promise<${pascal}> {`,
    `  throw new Error("投影骨架：待接入真实后端");`,
    `}`,
    "",
    `export async function update${pascal}(id: string, patch: Partial<${pascal}>): Promise<${pascal}> {`,
    `  throw new Error("投影骨架：待接入真实后端");`,
    `}`,
    "",
    `export async function remove${pascal}(id: string): Promise<void> {`,
    `  throw new Error("投影骨架：待接入真实后端");`,
    `}`,
    "",
  ].join("\n");
}

// --- src/workflow.ts ---------------------------------------------------------

function chainBlock(
  label: string,
  chain: WorkflowChain,
  indent = ""
): string[] {
  const lines: string[] = [];
  lines.push(`${indent}/** ${label} */`);
  lines.push(`${indent}{`);
  lines.push(`${indent}  id: ${JSON.stringify(chain.id ?? "")},`);
  if (chain.kind) lines.push(`${indent}  kind: ${JSON.stringify(chain.kind)},`);
  lines.push(`${indent}  states: [`);
  for (const node of chain.nodes ?? []) {
    const parts = [
      `id: ${JSON.stringify(node.id)}`,
      `name: ${JSON.stringify(node.name || node.id)}`,
    ];
    if (node.assigneeRole)
      parts.push(`assigneeRole: ${JSON.stringify(node.assigneeRole)}`);
    if (node.phase) parts.push(`phase: ${JSON.stringify(node.phase)}`);
    lines.push(`${indent}    { ${parts.join(", ")} },`);
  }
  lines.push(`${indent}  ],`);
  lines.push(`${indent}  transitions: [`);
  for (const t of chain.transitions ?? []) {
    const cond = t.condition
      ? `, condition: ${JSON.stringify(t.condition)}`
      : "";
    lines.push(
      `${indent}    { from: ${JSON.stringify(t.from)}, to: ${JSON.stringify(t.to)}${cond} },`
    );
  }
  lines.push(`${indent}  ],`);
  lines.push(`${indent}},`);
  return lines;
}

function buildWorkflowTs(model: FiveSystemModel): string {
  const wf = model.workflow ?? {};
  const lines: string[] = [
    comment("typescript", HEADER_NOTE),
    "// 状态机声明：主链路 = 核心业务对象生命周期；chains = 附加业务链路",
    "",
    "export const workflows = [",
  ];
  lines.push(
    ...chainBlock(`主链路：${wf.name || wf.id || "primary"}`, wf, "  ")
  );
  for (const chain of wf.chains ?? []) {
    lines.push(
      ...chainBlock(
        `附加链路：${chain.name || chain.id || chain.kind || "chain"}`,
        chain,
        "  "
      )
    );
  }
  lines.push("] as const;");
  lines.push("");
  return lines.join("\n");
}

// --- src/rbac.ts ---------------------------------------------------------------

function buildRbacTs(model: FiveSystemModel): string {
  const rbac = model.rbac ?? {};
  const lines: string[] = [comment("typescript", HEADER_NOTE), ""];
  lines.push(
    `export const ROLES = ${JSON.stringify(rbac.roles ?? [], null, 2)} as const;`
  );
  lines.push("");
  lines.push(
    `export const PERMISSIONS = ${JSON.stringify(rbac.permissions ?? [], null, 2)} as const;`
  );
  lines.push("");
  lines.push("/** 菜单可见性与权限授予（角色 → 菜单 → 权限） */");
  lines.push("export const MENUS = [");
  for (const menu of rbac.menus ?? []) {
    lines.push(
      `  { id: ${JSON.stringify(menu.id ?? "")}, label: ${JSON.stringify(menu.label ?? "")}, roles: ${JSON.stringify(menu.roleRefs ?? [])}, permissions: ${JSON.stringify(menu.permissionRefs ?? [])} },`
    );
  }
  lines.push("] as const;");
  lines.push("");
  return lines.join("\n");
}

// --- src/components/paradigms.tsx ------------------------------------------------

function buildParadigmsTsx(): string {
  return [
    comment("tsx", HEADER_NOTE),
    "// 视图范式组件契约：page.kind → 组件（与运行应用同一套范式语义）。",
    "// 这里只声明契约与占位实现，真实渲染能力在运行时范式库里。",
    "",
    `export interface DataTableProps {`,
    `  /** 列绑定（entity.field 引用） */`,
    `  columns: string[];`,
    `  /** 行内动作（permission 引用，可见性由 RBAC 决定） */`,
    `  actions: string[];`,
    `}`,
    "",
    `export function DataTable(props: DataTableProps) {`,
    `  return <div>范式占位：workbench 表格（{props.columns.length} 列）</div>;`,
    `}`,
    "",
    `export interface KanbanBoardProps {`,
    `  /** 泳道字段（必须是 enum 字段引用，列 = 取值 + 未归类） */`,
    `  statusField: string;`,
    `}`,
    "",
    `export function KanbanBoard(props: KanbanBoardProps) {`,
    `  return <div>范式占位：kanban 看板（泳道 = {props.statusField}）</div>;`,
    `}`,
    "",
    `export interface CalendarBoardProps {`,
    `  /** 日期字段（必须是 date 字段引用） */`,
    `  dateField: string;`,
    `  /** 可选着色字段（enum 字段引用，tone → 色点） */`,
    `  colorBy?: string;`,
    `}`,
    "",
    `export function CalendarBoard(props: CalendarBoardProps) {`,
    `  return <div>范式占位：calendar 月历（日期 = {props.dateField}）</div>;`,
    `}`,
    "",
  ].join("\n");
}

// --- src/pages/<page>.tsx ---------------------------------------------------------

function buildPageTsx(page: PageModelDef, pascal: string): string {
  const kind = String(page.kind ?? "workbench");
  const paradigm =
    kind === "kanban"
      ? "KanbanBoard"
      : kind === "calendar"
        ? "CalendarBoard"
        : "DataTable";
  const lines: string[] = [
    comment("tsx", HEADER_NOTE),
    "",
    `import { ${paradigm} } from "../components/paradigms";`,
    "",
  ];
  lines.push(`/** ${page.name || page.id} · 范式：${kind} */`);
  lines.push(`export function ${pascal}Page() {`);
  for (const stat of page.stats ?? []) {
    lines.push(
      `  // KPI：${stat.name ?? stat.id}（${stat.metric ?? "count"}${stat.format && stat.format !== "number" ? ` · ${stat.format}` : ""}）`
    );
  }
  for (const chart of page.charts ?? []) {
    lines.push(
      `  // 图表：${chart.name ?? chart.id}（${chart.type} · ${chart.dimension} · ${chart.metric ?? "count"}）`
    );
  }
  lines.push(`  return (`);
  if (kind === "kanban") {
    lines.push(
      `    <KanbanBoard statusField=${JSON.stringify(page.statusField ?? "")} />`
    );
  } else if (kind === "calendar") {
    const colorBy = page.colorBy
      ? ` colorBy=${JSON.stringify(page.colorBy)}`
      : "";
    lines.push(
      `    <CalendarBoard dateField=${JSON.stringify(page.dateField ?? "")}${colorBy} />`
    );
  } else {
    lines.push(`    <DataTable`);
    lines.push(`      columns={${JSON.stringify(page.fieldBindings ?? [])}}`);
    lines.push(
      `      actions={${JSON.stringify(page.actionPermissions ?? [])}}`
    );
    lines.push(`    />`);
  }
  lines.push(`  );`);
  lines.push(`}`);
  lines.push("");
  return lines.join("\n");
}

// --- src/main.tsx -------------------------------------------------------------------

function buildMainTsx(
  pageFiles: Array<{ page: PageModelDef; ident: string; pascal: string }>
): string {
  const lines: string[] = [
    comment("tsx", HEADER_NOTE),
    "// 应用入口与路由：路由来自 page 段投影；菜单可见性由 ./rbac 的 MENUS 决定",
    "",
  ];
  for (const pf of pageFiles) {
    lines.push(`import { ${pf.pascal}Page } from "./pages/${pf.ident}";`);
  }
  lines.push("");
  lines.push("export const routes = [");
  for (const pf of pageFiles) {
    lines.push(
      `  { path: ${JSON.stringify(`/${pf.ident}`)}, name: ${JSON.stringify(pf.page.name ?? pf.page.id ?? pf.ident)}, Component: ${pf.pascal}Page },`
    );
  }
  lines.push("] as const;");
  lines.push("");
  return lines.join("\n");
}

// --- src/aigc/* ----------------------------------------------------------------------

function buildAigcClientTs(): string {
  return [
    comment("typescript", HEADER_NOTE),
    "// LLM 通道占位：运行时走服务端可解释通道（output/confidence/rationale），",
    "// 写回是建议式的——用户确认才落数据（见运行应用 AiSuggestionCard）",
    "",
    `export interface ExplainedOutput {`,
    `  output: string;`,
    `  confidence?: number;`,
    `  rationale?: string;`,
    `}`,
    "",
    `export async function callLlmExplain(`,
    `  capability: string,`,
    `  input: Record<string, string>`,
    `): Promise<ExplainedOutput> {`,
    `  throw new Error("投影骨架：待接入 LLM 通道");`,
    `}`,
    "",
  ].join("\n");
}

function buildCapTs(
  cap: NonNullable<
    NonNullable<FiveSystemModel["aigc"]>["capabilities"]
  >[number],
  fn: string
): string {
  const lines: string[] = [
    comment("typescript", HEADER_NOTE),
    "// AI 能力接口：inputFields → outputField 是字段级契约",
    "",
    `import { callLlmExplain, type ExplainedOutput } from "./client";`,
    "",
  ];
  lines.push(
    `/** ${cap.name ?? cap.id} · 可用角色：${(cap.roleRefs ?? []).join("/") || "全部"} */`
  );
  lines.push(`export async function ${fn}(input: {`);
  for (const ref of cap.inputFields ?? []) {
    lines.push(`  ${JSON.stringify(ref)}: string;`);
  }
  lines.push(`}): Promise<ExplainedOutput> {`);
  lines.push(`  // 写回目标：${cap.outputField ?? "（未声明）"}`);
  lines.push(
    `  return callLlmExplain(${JSON.stringify(cap.name ?? cap.id ?? fn)}, input);`
  );
  lines.push(`}`);
  lines.push("");
  return lines.join("\n");
}

function buildPipelinesTs(model: FiveSystemModel): string {
  const lines: string[] = [
    comment("typescript", HEADER_NOTE),
    "// 编排：步骤为能力 id，上一步 outputField 必须是下一步 inputFields 之一",
    "",
  ];
  for (const pipe of model.aigc?.pipelines ?? []) {
    lines.push(`/** ${pipe.name ?? pipe.id} */`);
    lines.push(
      `export const ${toIdent(pipe.id ?? "pipeline", "pipeline")} = ${JSON.stringify(pipe.steps ?? [])} as const;`
    );
    lines.push("");
  }
  return lines.join("\n");
}

// --- package.json ---------------------------------------------------------------------

function buildPackageJson(appName: string, hasPages: boolean): string {
  const pkg: Record<string, unknown> = {
    "//": HEADER_NOTE,
    name: toIdent(appName, "app").toLowerCase().replace(/_/g, "-"),
    private: true,
    version: "0.1.0",
    scripts: { dev: "vite", build: "vite build" },
    dependencies: hasPages
      ? { react: "^19.0.0", "react-dom": "^19.0.0", antd: "^5.0.0" }
      : { react: "^19.0.0", "react-dom": "^19.0.0" },
    devDependencies: { typescript: "^5.0.0", vite: "^7.0.0" },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

// --- README.md ------------------------------------------------------------------

function buildReadme(model: FiveSystemModel, appName: string): string {
  const entities = model.datamodel?.entities ?? [];
  const pages = model.page?.pages ?? [];
  const caps = model.aigc?.capabilities ?? [];
  const invariants = model.appbundle?.invariants ?? [];
  const lines: string[] = [
    `# ${appName}`,
    "",
    comment("markdown", HEADER_NOTE),
    "",
    "本目录是五系统 schema 的**代码投影**：与运行应用同源同真相。",
    "",
    "| 文件 | 来源系统 | 内容 |",
    "|---|---|---|",
    "| `package.json` | — | 工程清单（依赖 / 脚本） |",
  ];
  if (entities.length > 0) {
    lines.push(
      "| `db/schema.sql` | datamodel | 表结构（enum 取值落成 CHECK 约束） |",
      "| `src/types.ts` | datamodel | 实体类型（enum 取值落成 union） |",
      "| `src/api/` | datamodel | 每实体一份数据访问层（CRUD 契约） |"
    );
  }
  if ((model.workflow?.nodes ?? []).length > 0) {
    lines.push(
      "| `src/workflow.ts` | workflow | 状态机（主链路 + 附加链路） |"
    );
  }
  if ((model.rbac?.roles ?? []).length > 0) {
    lines.push("| `src/rbac.ts` | rbac | 角色 / 权限 / 菜单授予 |");
  }
  if (pages.length > 0) {
    lines.push(
      "| `src/main.tsx` | page + rbac | 入口与路由 |",
      "| `src/pages/` | page | 每页面一文件（范式骨架 / KPI / 图表声明） |",
      "| `src/components/` | page | 视图范式组件契约（kind → 组件） |"
    );
  }
  if (caps.length > 0) {
    lines.push(
      "| `src/aigc/` | aigc | 每能力一文件（字段级输入输出契约）+ 编排 |"
    );
  }
  lines.push(
    "",
    `规模：${entities.length} 实体 · ${pages.length} 页面 · ${caps.length} 项 AI 能力`,
    ""
  );
  if (invariants.length > 0) {
    lines.push("## 不变式（实现验收清单）");
    lines.push("");
    for (const inv of invariants) {
      lines.push(
        `- [ ] ${inv.statement ?? inv.id}（约束：${(inv.systems ?? []).join("/")}；落点：${(inv.refs ?? []).join(", ")}）`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * 五系统模型 → 代码投影文件组（完整工程结构）。模型缺段时对应文件如实
 * 缺席（不伪造）；五段全空时连 README/package.json 也不出。
 */
export function deriveCodeProjection(
  model: FiveSystemModel | null | undefined,
  appName = "推演应用"
): ProjectedFile[] {
  if (!model) return [];
  const entities = model.datamodel?.entities ?? [];
  const pages = model.page?.pages ?? [];
  const caps = model.aigc?.capabilities ?? [];
  const pipelines = model.aigc?.pipelines ?? [];
  const hasWorkflow = (model.workflow?.nodes ?? []).length > 0;
  const hasRbac = (model.rbac?.roles ?? []).length > 0;

  const files: ProjectedFile[] = [];

  if (entities.length > 0) {
    files.push({
      path: "db/schema.sql",
      language: "sql",
      content: buildSchemaSql(model),
    });
  }

  // src/ 顶层：入口 → 类型 → 权限 → 状态机（阅读顺序）
  const pageIdents = new Set<string>();
  const pageFiles = pages.map((page, i) => {
    const ident = uniqueIdent(page.id ?? `page_${i + 1}`, "page", pageIdents);
    return { page, ident, pascal: toPascal(ident) };
  });
  if (pages.length > 0) {
    files.push({
      path: "src/main.tsx",
      language: "tsx",
      content: buildMainTsx(pageFiles),
    });
  }
  if (entities.length > 0) {
    files.push({
      path: "src/types.ts",
      language: "typescript",
      content: buildTypesTs(model),
    });
  }
  if (hasRbac) {
    files.push({
      path: "src/rbac.ts",
      language: "typescript",
      content: buildRbacTs(model),
    });
  }
  if (hasWorkflow) {
    files.push({
      path: "src/workflow.ts",
      language: "typescript",
      content: buildWorkflowTs(model),
    });
  }

  const entityIdents = new Set<string>();
  for (const entity of entities) {
    const ident = uniqueIdent(entity.id, "entity", entityIdents);
    files.push({
      path: `src/api/${ident}.ts`,
      language: "typescript",
      content: buildApiTs(entity, ident),
    });
  }

  if (pages.length > 0) {
    files.push({
      path: "src/components/paradigms.tsx",
      language: "tsx",
      content: buildParadigmsTsx(),
    });
    for (const pf of pageFiles) {
      files.push({
        path: `src/pages/${pf.ident}.tsx`,
        language: "tsx",
        content: buildPageTsx(pf.page, pf.pascal),
      });
    }
  }

  if (caps.length > 0) {
    files.push({
      path: "src/aigc/client.ts",
      language: "typescript",
      content: buildAigcClientTs(),
    });
    const capIdents = new Set<string>();
    for (const [i, cap] of caps.entries()) {
      const fn = uniqueIdent(cap.id ?? `cap_${i + 1}`, "cap", capIdents);
      files.push({
        path: `src/aigc/${fn}.ts`,
        language: "typescript",
        content: buildCapTs(cap, fn),
      });
    }
    if (pipelines.length > 0) {
      files.push({
        path: "src/aigc/pipelines.ts",
        language: "typescript",
        content: buildPipelinesTs(model),
      });
    }
  }

  if (files.length === 0) return [];
  return [
    {
      path: "README.md",
      language: "markdown" as const,
      content: buildReadme(model, appName),
    },
    {
      path: "package.json",
      language: "json" as const,
      content: buildPackageJson(appName, pages.length > 0),
    },
    ...files,
  ];
}
