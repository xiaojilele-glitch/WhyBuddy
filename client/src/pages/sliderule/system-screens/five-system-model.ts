/**
 * five-system-model — 五系统模型（LLM 生成）的前端解析与交叉引用解析。
 *
 * 模型形状与 slide-rule-python/services/v5_llm_generate.py 的 _SCHEMA_INSTRUCTION 对齐：
 *   datamodel.entities[].fields[]        — SSOT 实体字段
 *   rbac.roles / permissions / menus     — 角色 · 权限 · 菜单
 *   workflow.nodes[].assigneeRole + transitions[]
 *   page.pages[].fieldBindings / actionPermissions
 *   aigc.capabilities[].inputFields / outputField / roleRefs
 *   appbundle.pageBindings / roleRefs / dataModelRefs
 *
 * 所有交叉引用（assigneeRole→rbac.roles、"entity.field"→datamodel 等）在这里
 * 集中解析，系统屏只负责渲染 resolved/unresolved 状态 —— 未解析引用如实标红，
 * 不静默吞掉（与 v5_model_gate 的 fail-closed 语义一致）。
 *
 * 纯函数模块：无网络、无副作用，便于单测。
 */

// ---------------------------------------------------------------------------
// Types (mirror _SCHEMA_INSTRUCTION)
// ---------------------------------------------------------------------------

/**
 * enum 字段取值声明（加厚 schema 一期）：tone 是颜色语义——
 * success 正向/完成 · processing 进行中 · warning 等待/注意 ·
 * danger 风险/失败 · default 中性。渲染层据此出徽标/筛选/看板列。
 */
export interface FieldOption {
  id: string;
  label?: string;
  tone?: string;
}

export interface FiveSystemField {
  id: string;
  name?: string;
  type?: string;
  /** enum 字段的取值声明；非 enum 字段出现会被门禁标红 */
  options?: FieldOption[];
  /** 展示格式：number → money|percent|progress|score|rating；string → masked */
  format?: string;
  /**
   * ref 字段指向的实体 id（2026-08-11 加进契约）。**只有 `type:"ref"` 该带它**，
   * 悬空/越位由门禁标红（v5_model_gate.py）。缺席时运行时回落到
   * `guessRefEntityId` 的命名猜测——存量模型全都没有这个字段。
   */
  refEntity?: string;
}

export interface FiveSystemEntity {
  id: string;
  name?: string;
  fields?: FiveSystemField[];
}

export interface RbacMenu {
  id?: string;
  label?: string;
  roleRefs?: string[];
  permissionRefs?: string[];
}

export interface WorkflowNode {
  id: string;
  name?: string;
  assigneeRole?: string;
  /** 阶段标签（生成侧泳道分组，如 申请/审核/执行；可选） */
  phase?: string;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  condition?: string;
}

export interface WorkflowSection {
  id?: string;
  name?: string;
  nodes?: WorkflowNode[];
  transitions?: WorkflowTransition[];
  /** 附加业务链路（资金/治理/补偿等）；顶层 nodes/transitions 是主链路（核心对象生命周期） */
  chains?: WorkflowChain[];
}

export interface WorkflowChain {
  id?: string;
  name?: string;
  /** 链路类型：money 资金 / lifecycle 生命周期 / governance 治理 / recovery 补偿 */
  kind?: string;
  nodes?: WorkflowNode[];
  transitions?: WorkflowTransition[];
}

/**
 * 库无关图表声明（schema 丰富一期）：声明"可视化什么"，不声明用哪个图表库——
 * dimension 是分组字段，metric 是 "count" 或 "sum:<entity.field>"，
 * 渲染层（运行应用）负责映射到具体图表基建（当前为 ECharts）。
 */
export interface PageChartSpec {
  id?: string;
  name?: string;
  type?: "bar" | "line" | "pie" | string;
  dimension?: string;
  metric?: string;
}

/**
 * KPI 统计卡声明（加厚 schema 一期）：entity 圈定 count 的行来源，
 * metric 支持 count / sum:<e.f> / avg:<e.f>（sum·avg 必须指向 number 字段），
 * format 决定渲染（number 裸数字 / money ¥ / percent %）。
 */
export interface PageStatSpec {
  id?: string;
  name?: string;
  entity?: string;
  metric?: string;
  format?: string;
}

/** 排行榜声明（E40.4）：entity 行来源，sortBy 必须是 number 字段，limit 3-10。 */
export interface PageRankingSpec {
  id?: string;
  name?: string;
  entity?: string;
  sortBy?: string;
  limit?: number;
}

/** 动态流声明（E40.4）：timeField 必须是 date 字段（倒序流），levelField 可选 enum。 */
export interface PageFeedSpec {
  id?: string;
  name?: string;
  entity?: string;
  timeField?: string;
  levelField?: string;
}

/**
 * 体验区块数据绑定（Step 4 强类型版本）。
 * 第一批支持 count/sum/avg 聚合、等于筛选、时间粒度和枚举分组。
 */
export interface BlockBindingSpec {
  /** 主数据实体 id（必填，对应 datamodel.entities[].id） */
  entityRef: string;
  /** 聚合方式：count = 行数，sum:<fieldId> = 求和，avg:<fieldId> = 均值 */
  aggregate?: string;
  /** 时间维度字段 id（date 类型，用于趋势图 X 轴） */
  timeDimensionRef?: string;
  /** 时间粒度：day / week / month（默认 day） */
  timeGrain?: "day" | "week" | "month";
  /** 按枚举字段分组（用于多系列趋势或饼图分布） */
  seriesBy?: string;
  /** 等于筛选：fieldRef = value */
  filter?: { fieldRef: string; operator: "eq"; value: string | number | boolean };
  /** 排序字段 id（number 类型，RankedList 用） */
  sortByRef?: string;
  /** 排序方向（默认 desc） */
  sortOrder?: "asc" | "desc";
  /** 结果条数上限（RankedList 用，3-20） */
  limit?: number;
  /** 时间倒序字段（ActivityFeed 用，date 类型） */
  timeFieldRef?: string;
  /** 事件等级字段（ActivityFeed 用，enum 类型，可选） */
  levelFieldRef?: string;
}

/**
 * 区块事件绑定：区块的交互触发哪个动作（Step 5）。
 * key 是事件类型（onRowClick / onMetricClick / onItemClick 等），value 是 actionId。
 */
export type BlockEventBindings = Record<string, string>;

/**
 * 页面级动作实例（Step 5）。
 * permissionRef 引用 actionPermissions 里的权限标签（决定谁能做）。
 * type 决定具体做什么。
 * 第一批：navigate / openDetail / createRecord / updateRecord / changeFilter / drillDown
 */
export interface PageActionSpec {
  id: string;
  type: "navigate" | "openDetail" | "createRecord" | "updateRecord" | "changeFilter" | "drillDown";
  /** 引用 page.actionPermissions 里的权限标签（如 "risk:view"）；空串=无权限要求 */
  permissionRef?: string;
  /** navigate：目标页面 id */
  targetPageRef?: string;
  /** openDetail：目标实体 id（打开记录详情） */
  entityRef?: string;
  /** changeFilter/drillDown：目标区块 id */
  targetBlockRef?: string;
  /** payload 模板（事件变量用 $event.xxx 引用） */
  payload?: Record<string, unknown>;
}

/**
 * 体验区块实例（Step 4 强类型绑定）。binding 已升级为 BlockBindingSpec；
 * 旧页面仍由 stats/charts 等字段渲染，无 binding 时继续正常工作。
 */
export interface PageExperienceBlockSpec {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  binding?: BlockBindingSpec;
  /** 事件 → 动作 id 绑定（Step 5） */
  eventBindings?: BlockEventBindings;
  /** FreeformInsight（2026-07-23）：Python 二段生成回填，Pydantic 深校验过。 */
  freeformContent?: { root: Record<string, unknown> };
}

/**
 * 页面区块布局（Step 7）。
 * 控制区块放在哪个槽位、顺序和响应式覆盖。
 * 合法槽位来自 experience_block_catalog.json 的 allowedSlots。
 * 不允许自由写 CSS——只能在有限槽位里排布。
 */
export interface PageLayoutSpec {
  /** 摘要区（页面顶部 KPI / 筛选）：区块 id 列表，顺序即渲染顺序 */
  summary?: string[];
  /** 主内容区（趋势图 / 看板）：区块 id 列表 */
  primary?: string[];
  /** 次要区（侧边榜单 / 动态流）：区块 id 列表 */
  secondary?: string[];
  /** 活动流区（专用于 ActivityFeed）：区块 id 列表 */
  activity?: string[];
  /** 内容区（全宽表格 / 文档）：区块 id 列表 */
  content?: string[];
  /** 手机端槽位覆盖（可选，不填则与桌面相同）：槽位名 → 区块 id 列表 */
  mobile?: Partial<Omit<PageLayoutSpec, "mobile">>;
  /** 响应式 12/8/4 列网格；page-content 是本页表格/看板/日历保留节点。 */
  grid?: Partial<
    Record<
      "desktop" | "tablet" | "phone",
      Array<{
        blockRef: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }>
    >
  >;
}

export type PageSurfaceType =
  | "table"
  | "editable-table"
  | "split-list"
  | "queue";
export type PageSurfaceDensity = "compact" | "default" | "comfortable";

export interface PageSurfaceSpec {
  type: PageSurfaceType;
  density?: PageSurfaceDensity;
}

export interface PageReconstructionEvidence {
  version: "page-reconstruction-v1";
  status: "ready" | "skipped" | "failed";
  spec: Record<string, unknown> | null;
  prompt: string;
  diagnostic: string;
}

export interface PageModelDef {
  id?: string;
  name?: string;
  /** 页面范式（加厚 schema 二期）：workbench(缺省)|kanban|calendar|dashboard */
  kind?: string;
  /** 页面呈现目的：营销落地页与登录后的业务应用使用不同的视觉契约。 */
  presentation?: "application" | "marketing-landing";
  /** Ant Design Pro workbench surface; omitted on old models and inferred locally. */
  surface?: PageSurfaceSpec;
  /** kanban 的看板列字段（"entity.field"，必须是本页主实体的 enum 字段） */
  statusField?: string;
  /** calendar 的日期字段（"entity.field"，必须是本页主实体的 date 字段） */
  dateField?: string;
  /** calendar 的事件着色字段（可选，enum 字段） */
  colorBy?: string;
  fieldBindings?: string[];
  actionPermissions?: string[];
  stats?: PageStatSpec[];
  charts?: PageChartSpec[];
  rankings?: PageRankingSpec[];
  feeds?: PageFeedSpec[];
  /** 过渡期可读取但暂不直接渲染；type 必须来自体验区块目录。 */
  blocks?: PageExperienceBlockSpec[];
  /** 2026-07-24：kind=monitor 页面额外生成的 FreeformInsight 风格总览区块
   * （services/freeform_block.py 的 enrich_monitor_page_overviews 写回），
   * 用页面已选定的 stats/charts/rankings/feeds 当设计输入生成，跟这些
   * 固定字段并存——后者是生成失败时的诚实兜底，不是被这个字段取代。 */
  freeformOverview?: { root: Record<string, unknown> };
  /** 首页参考图的独立解析产物；用于审查视觉理解，不参与运行时信任判定。 */
  pageReconstruction?: PageReconstructionEvidence;
  /** 页面级动作实例（Step 5），与 actionPermissions 的权限字符串独立 */
  actions?: PageActionSpec[];
  /** 区块布局声明（Step 7）；未填时由渲染器按 kind 默认排布 */
  layout?: PageLayoutSpec;
}

export interface AigcCapability {
  id?: string;
  name?: string;
  inputFields?: string[];
  outputField?: string;
  roleRefs?: string[];
}

/**
 * AIGC 能力编排（一期，线性管线）：steps 为能力 id 执行序。
 * 衔接语义（门禁硬校验）：上一步能力的 outputField 必须出现在下一步的
 * inputFields——编排经数据模型字段接线，不是松散的节点连线。
 */
export interface AigcPipeline {
  id?: string;
  name?: string;
  steps?: string[];
}

export interface AppBundlePageBinding {
  pageRef?: string;
  workflowRef?: string;
}

export interface ModelInvariant {
  id?: string;
  /** 一句话陈述性约束（如「支付状态只能由服务端验签回调修改」） */
  statement?: string;
  /** 该不变式约束到的系统段名 */
  systems?: string[];
  /** 落地引用：实体/字段/角色/权限/流程节点 id（门禁校验必须可解析） */
  refs?: string[];
}

/** 门禁前确定性修复留痕（v5_model_repair：近邻改写 + 悬挂不变式剔除） */
export interface InvariantNotes {
  repaired?: Array<{ invariantId?: string; from?: string; to?: string }>;
  dropped?: Array<{
    invariantId?: string;
    statement?: string;
    unresolvedRefs?: string[];
  }>;
}

/** 展示层声明修复留痕（E37：page.charts/stats 的近邻改写与枚举违规剔除） */
export interface PresentationNotes {
  repaired?: Array<{ pageId?: string; path?: string; from?: string; to?: string }>;
  droppedCharts?: Array<{ pageId?: string; chartId?: string; reason?: string }>;
  droppedStats?: Array<{ pageId?: string; statId?: string; reason?: string }>;
  clearedFormats?: Array<{ pageId?: string; statId?: string; format?: string }>;
  clearedIdentity?: Array<{ key?: string; value?: string }>;
  clearedLandingPage?: Array<{ value?: string; reason?: string }>;
  droppedBlocks?: Array<{
    pageId?: string;
    blockId?: string;
    type?: string;
    reason?: string;
  }>;
}

/**
 * 应用外壳（Step 8）：取代 appIdentity.nav 成为导航形态的单一真相源。
 * 老模型 appIdentity.nav 继续兼容；运行时按 nav→shell 自动编译。
 */
export interface ExperienceShellSpec {
  /** 外壳模式：navigation（侧/顶导航）| focus（全屏沉浸，canvas 暂不进枚举） */
  mode: "navigation" | "focus";
  /** navigation 模式下的导航形态：side（侧栏）| top（顶栏） */
  navigation?: "side" | "top";
}

export interface AppBundleSection {
  pageBindings?: AppBundlePageBinding[];
  /** 应用打开后的落地页；必须引用 page.pages[].id。缺省时保留旧工作台。 */
  landingPageRef?: string;
  roleRefs?: string[];
  dataModelRefs?: string[];
  /** 系统不变式（总装约束层，改进②） */
  invariants?: ModelInvariant[];
  /** 不变式引用修复/剔除留痕（AppBundle 屏如实展示） */
  invariantNotes?: InvariantNotes;
  /** 展示层声明修复/剔除留痕（E37，AppBundle 屏如实展示） */
  presentationNotes?: PresentationNotes;
  /** 应用身份段（E40.2）：产品名 + 主题 + 图标 + 导航形态（合法域在 @legal） */
  appIdentity?: AppIdentitySection;
  /**
   * 应用外壳（Step 8）：取代 appIdentity.nav 成为导航单一真相源。
   * 新模型填此字段；老模型由 appIdentity.nav 自动编译，不影响旧快照。
   */
  experienceShell?: ExperienceShellSpec;
  /** 设备视口。新模型只生成 desktop | phone；tablet 仅保留历史读取兼容。 */
  preferredDevice?: "desktop" | "tablet" | "phone";
  /** 新生成模型的单一设备权威标记；历史双布局没有该字段。 */
  deviceAuthority?: "single-v1";
}

/** 应用身份段（E40.2）：千人千面的第一层——每个应用自己的"脸"。 */
export interface AppIdentitySection {
  /** 产品名（LLM 起的品牌名，不是用户原话） */
  productName?: string;
  /** 主题 id（identity-themes 的 8 套 token 之一） */
  theme?: string;
  /** 品牌图标 id（封闭图标集） */
  icon?: string;
  /** 导航形态：side 管理台侧栏 / top 监控型顶栏（Step 8 后由 experienceShell 接管，保留向后兼容） */
  nav?: string;
  /** 视觉配方引用（Step 9）：指向配方 id（spacious-guided / compact-dense / content-cards /
   * dark-monitoring / high-contrast）；只管密度/深浅色，不选主色（主色是 theme 的职责）；
   * 不填时为 default，跟随主题默认密度。 */
  designRecipeRef?: string;
  /** 2026-07-24：生图驱动生成的身份主题 token（Python identity_theme_gen.py
   * 生成后写回），未声明/校验不过时降级到 theme 对应的 8 预设之一。 */
  generatedTheme?: Record<string, unknown>;
  /** 2026-08-04：从这个应用的参照图上读出来的图表分类色（Python
   * services/sheet_palette.py 取色后写回）。参照图每个应用都会生成，此前只被
   * 用来学版式、配色画完就丢；这个字段把那一段接回来，让不同应用的图表色
   * 真的不一样。未声明/校验不过时退回账本里那 8 套已验证色序。
   *
   * 类型是 unknown 而不是 string[]：存量快照没走过这一版门禁，形状不可信，
   * 校验在渲染侧（lib/identity-palette 的 validExtractedCharts）。 */
  chartColors?: unknown;
}

/**
 * 角色在模型里的两种写法。
 *
 * 新生成的是 `{id, name}`（2026-08-05 起，与实体/字段/菜单一致——在那之前
 * 角色是模型里**唯一**没有中文名的概念，所以界面上只能显示 warehouse_keeper）。
 * 内置域夹具和线上库里已有的应用全是字符串，一条都不迁移（它们数据里就没有
 * 中文名，迁移只能瞎编），所以两种形态永远共存。
 */
export type RawRbacRole = string | { id?: string; name?: string; label?: string };

/** 归一之后的角色：`id` 是引用键，`label` 是给人看的。 */
export interface RbacRole {
  id: string;
  label: string;
}

/**
 * 两种写法 → `{id, label}[]`。判断只在这里做一次。
 *
 * 没有中文名时 label 回落成 id：显示英文总好过显示空白，而且一眼能看出
 * "这个应用是补字段之前生成的"。
 */
export function normalizeRoles(
  model: FiveSystemModel | null | undefined
): RbacRole[] {
  const out: RbacRole[] = [];
  const seen = new Set<string>();
  for (const raw of model?.rbac?.roles ?? []) {
    let id = "";
    let label = "";
    if (typeof raw === "string") {
      id = raw.trim();
      label = id;
    } else if (raw && typeof raw === "object") {
      id = String(raw.id ?? raw.name ?? "").trim();
      label = String(raw.name ?? raw.label ?? "").trim() || id;
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

/** 引用键 → 显示名；认不出来就把引用键原样吐回去。 */
export function roleLabel(
  roleId: string | null | undefined,
  model: FiveSystemModel | null | undefined
): string {
  const ref = String(roleId ?? "").trim();
  if (!ref) return "";
  return normalizeRoles(model).find(r => r.id === ref)?.label ?? ref;
}

export interface FiveSystemModel {
  datamodel?: { entities?: FiveSystemEntity[] };
  rbac?: {
    /** 两种写法并存，永远。用 `normalizeRoles` 读，别直接当 string[] 使 */
    roles?: RawRbacRole[];
    permissions?: string[];
    menus?: RbacMenu[];
  };
  workflow?: WorkflowSection;
  page?: { pages?: PageModelDef[] };
  aigc?: { capabilities?: AigcCapability[]; pipelines?: AigcPipeline[] };
  appbundle?: AppBundleSection;
}

export type FiveSystemModelKey = keyof FiveSystemModel;

const MODEL_KEYS: FiveSystemModelKey[] = [
  "datamodel",
  "rbac",
  "workflow",
  "page",
  "aigc",
  "appbundle",
];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function tryJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Candidate JSON payloads inside a raw string: whole text, fenced blocks, brace substring. */
function jsonCandidates(raw: string): unknown[] {
  const out: unknown[] = [];
  const whole = tryJson(raw.trim());
  if (whole !== null) out.push(whole);

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    const parsed = tryJson(m[1].trim());
    if (parsed !== null) out.push(parsed);
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const parsed = tryJson(raw.slice(first, last + 1));
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/** Detect a bare section object (e.g. `{nodes, transitions}` without the "workflow" wrapper). */
function detectBareSection(
  obj: Record<string, unknown>
): FiveSystemModel | null {
  if (Array.isArray(obj.nodes) && Array.isArray(obj.transitions)) {
    return { workflow: obj as WorkflowSection };
  }
  if (Array.isArray(obj.capabilities)) {
    return {
      aigc: obj as FiveSystemModel["aigc"] & { capabilities: AigcCapability[] },
    };
  }
  if (Array.isArray(obj.pageBindings) || Array.isArray(obj.dataModelRefs)) {
    return { appbundle: obj as AppBundleSection };
  }
  if (Array.isArray(obj.entities)) {
    return { datamodel: obj as FiveSystemModel["datamodel"] };
  }
  if (Array.isArray(obj.roles) || Array.isArray(obj.permissions)) {
    return { rbac: obj as FiveSystemModel["rbac"] };
  }
  if (Array.isArray(obj.pages)) {
    return { page: obj as FiveSystemModel["page"] };
  }
  return null;
}

function sectionsFromPlainObject(
  candidate: Record<string, unknown>
): FiveSystemModel | null {
  const sections: FiveSystemModel = {};
  let found = false;
  for (const key of MODEL_KEYS) {
    const section = candidate[key];
    if (isPlainObject(section)) {
      (sections as Record<string, unknown>)[key] = section;
      found = true;
    }
  }
  if (found) return sections;
  return detectBareSection(candidate);
}

/**
 * Parse a raw string that may contain a five-system model (full model JSON,
 * fenced JSON, or a bare single-section JSON). Returns null when nothing
 * structurally recognizable is found — callers must degrade honestly.
 */
export function parseFiveSystemModel(
  raw: string | null | undefined
): FiveSystemModel | null {
  if (!raw || !raw.trim()) return null;
  for (const candidate of jsonCandidates(raw)) {
    if (!isPlainObject(candidate)) continue;
    const parsed = sectionsFromPlainObject(candidate);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Merge model sections parsed from per-skill raw contents (skill_result SSE payloads).
 * First occurrence of each section wins. Null when no content parses.
 */
export function parseFiveSystemModelFromContents(
  contents: Partial<Record<string, string>> | null | undefined
): FiveSystemModel | null {
  if (!contents) return null;
  let merged: FiveSystemModel | null = null;
  for (const value of Object.values(contents)) {
    const parsed = parseFiveSystemModel(value);
    if (!parsed) continue;
    merged = merged ?? {};
    for (const key of MODEL_KEYS) {
      if (parsed[key] && !merged[key]) {
        (merged as Record<string, unknown>)[key] = parsed[key];
      }
    }
  }
  return merged;
}

/**
 * 从持久化的 publishClosure.perSkillEvidence 重建五系统模型（刷新/重载路径）。
 *
 * Python 侧 _build_per_skill_evidence 把 gate 通过的 LLM 模型段作为
 * perSkillEvidence[skill].modelSection 纯载荷持久化（不参与 trust 判定）。
 * 确定性域（采购/请假/工单/入职）没有 LLM 模型 → 字段缺失 → 返回 null，
 * 调用方走既有降级链（SSE mermaid / skillRuntimeGraph / 占位），不伪造。
 */
export function parseFiveSystemModelFromPerSkillEvidence(
  perSkillEvidence:
    | Partial<Record<string, { modelSection?: unknown } | undefined>>
    | null
    | undefined
): FiveSystemModel | null {
  if (!perSkillEvidence) return null;
  let model: FiveSystemModel | null = null;
  for (const key of MODEL_KEYS) {
    const section = perSkillEvidence[key]?.modelSection;
    if (isPlainObject(section)) {
      model = model ?? {};
      (model as Record<string, unknown>)[key] = section;
    }
  }
  return model;
}

/** 版本史里一条快照。舞台只取 `model`；id 用来认当前指针。 */
export interface ModelVersionSnapLike {
  id?: string;
  model?: unknown;
}

/**
 * 从 `modelVersions` 取出当前那份五系统模型。
 *
 * ⚠ 2026-09-07 社区烘焙坊进销存 sr-20260907143221：bind 5/5、mv-1 六段齐，
 *   舞台徽章却写「打过孔但没填上数据」。Python 记快照就是为了「闭环没跑完，
 *   模型别蒸发」（model_versions.record_model_snapshot 头注）；前端只读
 *   SSE skillContents + publishClosure.perSkillEvidence。那场停在
 *   max_loops，publishClosure 是空的，货架上的模型没人取。
 *
 * 指针认 currentId（◀▶ 回退）；没有或那一版没有 model 就读队尾——
 * 与 Python `latest_model_snapshot` 同一句话：队尾是最新的。
 */
export function parseFiveSystemModelFromVersionHistory(
  versions:
    | ReadonlyArray<ModelVersionSnapLike | null | undefined>
    | null
    | undefined,
  currentId?: string | null
): FiveSystemModel | null {
  if (!versions?.length) return null;
  const list = versions.filter((v): v is ModelVersionSnapLike => !!v);
  if (!list.length) return null;
  const pick =
    (currentId
      ? list.find(v => v.id === currentId && isPlainObject(v.model))
      : undefined) ??
    (isPlainObject(list[list.length - 1]?.model)
      ? list[list.length - 1]
      : undefined);
  if (!pick || !isPlainObject(pick.model)) return null;
  return sectionsFromPlainObject(pick.model);
}

/**
 * 容错解析"正在流式生成、尚未收尾"的 JSON：截到最后一个语法安全位置
 * （完整的值/闭合括号后），剪掉悬空的 key / 逗号 / 未闭合字符串，再按
 * 括号栈补齐收尾符后 JSON.parse。返回 null 表示当前前缀还拼不出对象。
 *
 * 只用于推演过程的实时预览（右侧舞台"应用长出来"）——不参与 gate/trust，
 * 最终真实模型仍以闭环证据为准。
 */
export function repairPartialJson(raw: string): unknown | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const text = raw.slice(start);

  // 字符串感知的前向扫描：括号栈 + 是否停在未闭合字符串里（及其起点）。
  const scan = (
    upto: string
  ): { stack: string[]; inStr: boolean; strStart: number } => {
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    let strStart = -1;
    for (let i = 0; i < upto.length; i++) {
      const ch = upto[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        strStart = i;
      } else if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    return { stack, inStr, strStart };
  };

  // 候选截断点：完整值结束处（闭合引号/闭合括号/数字与字面量尾字符）。
  const cuts: number[] = [];
  {
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') {
          inStr = false;
          cuts.push(i + 1);
        }
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "}" || ch === "]") cuts.push(i + 1);
      else if (/[0-9el]/.test(ch)) cuts.push(i + 1); // 数字 / true/false/null 尾字符近似
    }
  }
  cuts.push(text.length);

  // 从最靠后的候选点往回试（最多 ~40 个）：剪悬空结构 → 补括号 → parse。
  const tried = new Set<string>();
  for (let c = cuts.length - 1; c >= 0 && c >= cuts.length - 40; c--) {
    let t = text.slice(0, cuts[c]);
    // 停在字符串中间：连同开引号一起剪掉（是否在字符串内以扫描态为准，
    // 不能用正则猜——闭合字符串后面跟 }] 时正则会误伤）。
    const st = scan(t);
    if (st.inStr && st.strStart >= 0) t = t.slice(0, st.strStart);
    // 悬空的 "key": / 尾逗号冒号空白剪到稳定
    for (let pass = 0; pass < 4; pass++) {
      const before = t;
      t = t
        .replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*$/, "") // 悬空 key:
        .replace(/[,:\s]+$/, ""); // 尾逗号/冒号/空白
      if (t === before) break;
    }
    if (!t || tried.has(t)) continue;
    tried.add(t);
    const closers = scan(t)
      .stack.reverse()
      .map(b => (b === "{" ? "}" : "]"))
      .join("");
    try {
      return JSON.parse(t + closers);
    } catch {
      /* 该截断点拼不成，回退更早的候选点 */
    }
  }
  return null;
}

/**
 * 从流式生成中的原始 LLM 输出解析"部分五系统模型"（实时预览用）。
 * 已流完的段如实返回；没流到的段缺失。拼不出任何段返回 null。
 */
export function parsePartialFiveSystemModel(
  raw: string | null | undefined
): FiveSystemModel | null {
  if (!raw || !raw.trim()) return null;
  const candidate = repairPartialJson(raw);
  if (!isPlainObject(candidate)) return null;
  const sections: FiveSystemModel = {};
  let found = false;
  for (const key of MODEL_KEYS) {
    const section = candidate[key];
    if (isPlainObject(section)) {
      (sections as Record<string, unknown>)[key] = section;
      found = true;
    }
  }
  return found ? sections : null;
}

/**
 * 段级合并两个模型来源（primary 段优先，缺段由 fallback 补齐）。
 * 两者皆空返回 null —— 保持 fail-closed 语义。
 */
export function mergeFiveSystemModels(
  primary: FiveSystemModel | null | undefined,
  fallback: FiveSystemModel | null | undefined
): FiveSystemModel | null {
  if (!primary && !fallback) return null;
  const merged: FiveSystemModel = {};
  for (const key of MODEL_KEYS) {
    const section = primary?.[key] ?? fallback?.[key];
    if (section) (merged as Record<string, unknown>)[key] = section;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * 「这个会话到底有没有一个成形的应用」的唯一判据。
 *
 * 三个来源合并，前两个段优先、第三源补缺：
 *   1. 本轮 SSE 的 skill 原文（skillContents）
 *   2. 持久化闭环证据里的 modelSection（刷新/重载路径）
 *   3. 版本史 `modelVersions[].model`（闭环没落到会话上时的货架）
 *
 * 非空即意味着舞台能真的跑起应用——SlideRuleStudio 的 stage === "app"
 * 就是这么判的。
 *
 * 注意它跟"有没有目标文案"不是一回事：用户敲完目标、推演还没出模型时，
 * goal 已经有值但应用并不存在。凡是要区分"还没应用" / "已有应用"的地方
 * （入站判定的 hasApp 语境、舞台判定）都该用这个，别用 Boolean(goal)。
 *
 * 起草中的部分模型（llmDraft 流式解析）不算——那是预览，不是成品。
 *
 * ⚠ 第三源不是可选项。2026-09-07 烘焙坊那场：模型在 mv-1，闭环是空的，
 *   只读前两源 = 舞台手里没有模型 = 孔在、数不灌、样板 HTML 还挂着。
 *   Python 侧早就把模型记进版本史了；漏读等于装在不通电的插座上。
 */
export function deriveSettledFiveSystemModel(
  skillContents: Partial<Record<string, string>> | null | undefined,
  perSkillEvidence:
    | Partial<Record<string, { modelSection?: unknown } | undefined>>
    | null
    | undefined,
  versionHistory?: {
    versions?:
      | ReadonlyArray<ModelVersionSnapLike | null | undefined>
      | null;
    currentId?: string | null;
  } | null
): FiveSystemModel | null {
  return mergeFiveSystemModels(
    mergeFiveSystemModels(
      parseFiveSystemModelFromContents(skillContents ?? {}),
      parseFiveSystemModelFromPerSkillEvidence(perSkillEvidence)
    ),
    parseFiveSystemModelFromVersionHistory(
      versionHistory?.versions,
      versionHistory?.currentId
    )
  );
}

// ---------------------------------------------------------------------------
// Evidence source (honest path labeling)
// ---------------------------------------------------------------------------

export interface EvidenceSourceInfo {
  kind: "llm" | "builtin";
  label: string;
}

/**
 * 证据来源识别：Python 侧 _build_per_skill_evidence 的产物 id 前缀是路径事实——
 *   llm-linkage-*     → 真实 LLM 五系统生成（novel intent）
 *   runtime-linkage-* → 内置演示域（采购/请假/工单/入职，确定性 fixture，不调 LLM）
 * 识别不了时返回 null（不猜、不冒充）。
 */
export function evidenceSourceOf(
  evidence: { artifactId?: string; evidenceRef?: string } | null | undefined
): EvidenceSourceInfo | null {
  const id = String(evidence?.artifactId || evidence?.evidenceRef || "");
  if (id.startsWith("llm-linkage-")) return { kind: "llm", label: "LLM 生成" };
  if (id.startsWith("runtime-linkage-"))
    return { kind: "builtin", label: "内置演示域" };
  return null;
}

// ---------------------------------------------------------------------------
// Cross-reference resolution
// ---------------------------------------------------------------------------

export interface RefResolution {
  /** The raw ref string as written in the model. */
  ref: string;
  /** True when the ref resolves to a node defined in the same model. */
  resolved: boolean;
  /** Human-facing label (resolved target name, or the raw ref when unresolved). */
  label: string;
}

/** assigneeRole / roleRefs → rbac.roles */
export function resolveRoleRef(
  role: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(role ?? "").trim();
  const hit = normalizeRoles(model).find(r => r.id === ref);
  return {
    ref,
    resolved: ref.length > 0 && hit !== undefined,
    // 与 resolveEntityRef / resolveFieldRef 同款：显示名优先，回落 id。
    // 这个 label 位一直留着，只是角色以前没有名字可填。
    label: hit?.label || ref || "—",
  };
}

/** "entityId.fieldId" → datamodel.entities[].fields[] */
export function resolveFieldRef(
  fieldRef: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(fieldRef ?? "").trim();
  const dot = ref.indexOf(".");
  if (!ref || dot <= 0) return { ref, resolved: false, label: ref || "—" };
  const entityId = ref.slice(0, dot);
  const fieldId = ref.slice(dot + 1);
  const entity = (model?.datamodel?.entities ?? []).find(
    e => e.id === entityId
  );
  const field = entity?.fields?.find(f => f.id === fieldId);
  if (!entity || !field) return { ref, resolved: false, label: ref };
  return {
    ref,
    resolved: true,
    label: `${entity.name || entity.id}.${field.name || field.id}`,
  };
}

/** entityId → datamodel.entities[] */
export function resolveEntityRef(
  entityRef: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(entityRef ?? "").trim();
  const entity = (model?.datamodel?.entities ?? []).find(e => e.id === ref);
  if (!entity) return { ref, resolved: false, label: ref || "—" };
  return { ref, resolved: true, label: entity.name || entity.id };
}

/** pageRef → page.pages[] */
export function resolvePageRef(
  pageRef: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(pageRef ?? "").trim();
  const page = (model?.page?.pages ?? []).find(p => p.id === ref);
  if (!page) return { ref, resolved: false, label: ref || "—" };
  return { ref, resolved: true, label: page.name || page.id || ref };
}

/** workflowRef → workflow.id 或 workflow.nodes[].id */
export function resolveWorkflowRef(
  workflowRef: string | null | undefined,
  model: FiveSystemModel | null | undefined
): RefResolution {
  const ref = String(workflowRef ?? "").trim();
  const wf = model?.workflow;
  if (!ref || !wf) return { ref, resolved: false, label: ref || "—" };
  if (wf.id === ref) return { ref, resolved: true, label: wf.id };
  const node = (wf.nodes ?? []).find(n => n.id === ref);
  if (node) return { ref, resolved: true, label: node.name || node.id };
  return { ref, resolved: false, label: ref };
}

// ---------------------------------------------------------------------------
// Mermaid builders
// ---------------------------------------------------------------------------

function mermaidId(id: string): string {
  const safe = String(id).replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(safe) ? safe : `n_${safe}`;
}

function mermaidLabel(text: string): string {
  return String(text)
    .replace(/"/g, "'")
    .replace(/[\[\]{}|]/g, " ")
    .trim();
}

/**
 * workflow.nodes + transitions → mermaid flowchart TD。
 * 节点标签带审批人角色（`名称·@角色`），转移条件渲染为边标签。
 * nodes 为空返回 null（调用方降级）。
 */
export function workflowModelToMermaid(
  workflow: WorkflowSection | null | undefined
): string | null {
  const nodes = workflow?.nodes ?? [];
  if (nodes.length === 0) return null;
  const lines = ["flowchart TD"];
  for (const node of nodes) {
    const name = mermaidLabel(node.name || node.id);
    const role = node.assigneeRole ? mermaidLabel(node.assigneeRole) : "";
    const label = role ? `${name}<br/>@${role}` : name;
    lines.push(`  ${mermaidId(node.id)}["${label}"]`);
  }
  const nodeIds = new Set(nodes.map(n => n.id));
  for (const t of workflow?.transitions ?? []) {
    if (!t?.from || !t?.to) continue;
    if (!nodeIds.has(t.from) || !nodeIds.has(t.to)) continue; // dangling — gate should reject; skip honestly
    const cond = t.condition ? `|${mermaidLabel(t.condition)}|` : "";
    lines.push(`  ${mermaidId(t.from)} -->${cond} ${mermaidId(t.to)}`);
  }
  return lines.join("\n");
}

/**
 * datamodel.entities → mermaid erDiagram。刷新/重载路径的真实数据源
 * （modelSection 持久化在 perSkillEvidence，SSE mermaid 已丢失时用它重建）。
 * entities 为空返回 null（调用方降级，不伪造）。
 */
/**
 * ref 字段 → 目标实体推断（"user_ref"/"chart_ref" 这类命名约定）。
 * 去掉 _ref/_id 后缀得到词干，在实体 id 里找唯一匹配：精确 → 前/后缀 →
 * 包含；多个候选（歧义）或零候选时返回 null——宁可不画线，不画错线。
 */
export function guessRefEntityId(
  fieldId: string,
  entityIds: Iterable<string>
): string | null {
  const base = fieldId.replace(/_ref$/, "").replace(/_id$/, "");
  if (!base) return null;
  const ids = [...entityIds];
  if (ids.includes(base)) return base;
  const affix = ids.filter(
    id => id.startsWith(`${base}_`) || id.endsWith(`_${base}`)
  );
  if (affix.length === 1) return affix[0];
  if (affix.length > 1) return null;
  const contains = ids.filter(id => id.includes(base));
  return contains.length === 1 ? contains[0] : null;
}

/**
 * ref 字段 → 目标实体：**声明优先，猜测兜底**（2026-08-11）。
 *
 * ## 为什么不能只靠上面那个猜测
 *
 * 猜测是从字段名反推的，而字段名跟实体名对不上是常态。拿 181 个真实存过的模型
 * 量了一遍：1689 个 `type:"ref"` 字段，`guessRefEntityId` 只认出 691 个（41%），
 * 剩下 998 个（59%）返回 null。典型认不出来的三种：
 *
 *   assigned_team   → 目标实体叫 oncall_teams   （词干根本不同）
 *   route_group_id  → 目标实体叫 on_call_group  （词干是目标的子串之一，但不唯一）
 *   alert_ref       → alert_event / alert_route_rule 两个都沾（歧义，按"宁可不画"返回 null）
 *
 * 认不出来的代价不是少画一根线，而是**关系字段退化成纯文本框**：渲染器靠
 * `refEntityId` 去取候选行（block-registry 的 `entityRows[schema.refEntityId]`），
 * 拿不到就只剩一个 Input，用户得手打一个行 id 进去。
 *
 * 所以现在让模型自己声明 `refEntity`，猜测降级为存量模型的兜底——**不删猜测**，
 * 补字段之前生成的那些应用还得能跑。
 *
 * ## 返回值里为什么要带 `declared`
 *
 * 声明和猜测在"自引用"上待遇不同。**猜**到自己身上多半是命名巧合（字段
 * `order_ref` 长在实体 `order` 上），历史上一直丢弃；而**声明**是模型的明确
 * 表态（`merged_into` 指回同一张工单表这种是真的），运行时偷偷改掉它，只会让
 * 门禁的绿灯跟界面上的现象对不上——该管的是门禁，不是这里。
 *
 * 调用方拿 `declared` 自己决定：表单下拉认自引用（同表选行完全能用），
 * ER 图/mermaid 一律不认（那两条路画不了自环边，跟改动前保持一致）。
 *
 * 声明悬空（指向的实体不在这个 datamodel 里）时返回 null 而**不**回落去猜——
 * 模型已经明确说了指向谁，猜一个别的只会盖掉它的错，让门禁的标红对不上现象。
 */
export function resolveRefEntityId(
  field: FiveSystemField,
  entityIds: Iterable<string>
): { target: string | null; declared: boolean } {
  const ids = [...entityIds];
  const declared = String(field.refEntity ?? "").trim();
  if (declared) {
    return { target: ids.includes(declared) ? declared : null, declared: true };
  }
  return { target: guessRefEntityId(field.id, ids), declared: false };
}

// --- ER 图数据（G6 渲染路径；与 datamodelToMermaid 同一套关联推断） --------

export interface ErGraphField {
  id: string;
  name: string;
  type: string;
  /** ref 字段解析出的目标实体 id（唯一匹配才给，歧义为 null） */
  refTarget: string | null;
}

export interface ErGraphNode {
  id: string;
  name: string;
  fields: ErGraphField[];
}

export interface ErGraphEdge {
  /** 持 ref 的实体（"多"侧） */
  source: string;
  /** 被引用实体（"一"侧） */
  target: string;
  /** ref 字段名 */
  label: string;
}

export function deriveErGraphData(
  datamodel: FiveSystemModel["datamodel"] | null | undefined
): { nodes: ErGraphNode[]; edges: ErGraphEdge[] } | null {
  const entities = datamodel?.entities ?? [];
  if (entities.length === 0) return null;
  const entityIds = entities.map(e => e.id);
  const nodes: ErGraphNode[] = [];
  const edges: ErGraphEdge[] = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    const fields: ErGraphField[] = [];
    for (const field of entity.fields ?? []) {
      const isRef =
        String(field.type || "").toLowerCase() === "ref" ||
        /_ref$/.test(field.id);
      // 声明优先，猜测兜底（见 resolveRefEntityId）。自引用这条路画不出自环边，
      // 声明的也一样丢弃——跟加 refEntity 之前的行为保持一致。
      const target = isRef ? resolveRefEntityId(field, entityIds).target : null;
      const refTarget = target && target !== entity.id ? target : null;
      fields.push({
        id: field.id,
        name: field.name || field.id,
        type: String(field.type || "string"),
        refTarget,
      });
      if (refTarget) {
        const key = `${entity.id}->${refTarget}:${field.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ source: entity.id, target: refTarget, label: field.id });
        }
      }
    }
    nodes.push({ id: entity.id, name: entity.name || entity.id, fields });
  }
  return { nodes, edges };
}

// --- 五系统联动图数据（AppBundle 屏「联动图」视图） -------------------------

export type LinkageSystem = "datamodel" | "page" | "workflow" | "rbac" | "aigc";

export interface LinkageItem {
  /** 全局唯一：`${system}:${id}` */
  key: string;
  system: LinkageSystem;
  id: string;
  name: string;
}

export interface LinkageEdge {
  from: string;
  to: string;
  /** 语义类型（决定颜色与图例归类） */
  kind:
    | "page-entity"
    | "page-workflow"
    | "node-role"
    | "aigc-entity"
    | "aigc-role"
    // ⚠ 2026-08-17 补。这个联合类型此前缺 role-page，是"架构图少一手权限"
    //   在类型上的形态——下沉那两段边时编译器当场把它点了出来。
    //   六种边的词汇表以 shared/app-graph/edge-contract.json 为准。
    | "role-page";
}

export interface LinkageGroup {
  system: LinkageSystem;
  label: string;
  items: LinkageItem[];
}

/**
 * 五系统联动图：每个系统一组成员节点（全部展开，不截断——组内多列
 * 排布由渲染器负责），跨系统引用连线。只画模型里真实存在且解析得到的
 * 引用（悬空引用不入图——各屏已负责标红）。少于 2 个非空组返回 null。
 */
/**
 * 角色经**菜单**持有哪些权限。
 *
 * ⚠ 口径以 `rbac.menus` 为准，不是 `rbac.rolePermissions`——48 份真机模型里
 *   后者**键根本不存在**，真实数据一条不落全在 menus 里。走错口径的表现是
 *   "每个角色都没有任何权限"，而没有任何一处会报错。
 *   契约：shared/app-graph/edge-contract.json 的 role-perms-intersect-page-actions。
 *
 * ⚠ 2026-08-17 从 live-runtime/rbac-preview.ts 搬到这里，rbac-preview 再导出。
 *   原因：这张图的 role→page 边要用它，而 rbac-preview 又引本文件的
 *   normalizeRoles——直接反向引会成环。搬过来是为了让**图的唯一事实源**
 *   自给自足，不是为了省一个 import。
 */
export interface RoleAccess {
  role: string;
  /** roleRefs 含该角色的菜单的 permissionRefs 并集 */
  permissions: string[];
  /** 该角色可见的 rbac 菜单标签（证据侧口径，供预览展示） */
  menuLabels: string[];
  /** 给人看的角色名；补中文名之前生成的应用回落成 role 本身 */
  label: string;
}

export function deriveRoleAccess(model: FiveSystemModel | null | undefined): RoleAccess[] {
  // 归一后取 **id**：menu.roleRefs 里存的是引用键，拿显示名去 includes
  // 会全部落空，表现为"每个角色都没有任何权限"。
  const roles = normalizeRoles(model);
  const menus = model?.rbac?.menus ?? [];
  return roles.map(({ id: role, label }) => {
    const roleMenus = menus.filter((m) => (m.roleRefs ?? []).includes(role));
    return {
      role,
      label,
      permissions: [...new Set(roleMenus.flatMap((m) => m.permissionRefs ?? []))],
      menuLabels: roleMenus.map((m) => m.label || m.id || "").filter(Boolean),
    };
  });
}

export function deriveSystemLinkageGraph(
  model: FiveSystemModel | null | undefined
): { groups: LinkageGroup[]; edges: LinkageEdge[] } | null {
  if (!model) return null;
  const entities = model.datamodel?.entities ?? [];
  const pages = model.page?.pages ?? [];
  const wfNodes = model.workflow?.nodes ?? [];
  const roles = normalizeRoles(model);
  const caps = model.aigc?.capabilities ?? [];

  const key = (system: LinkageSystem, id: string) => `${system}:${id}`;
  const mkGroup = (
    system: LinkageSystem,
    label: string,
    all: Array<{ id: string; name: string }>
  ): LinkageGroup => ({
    system,
    label,
    items: all.map(x => ({
      key: key(system, x.id),
      system,
      id: x.id,
      name: x.name,
    })),
  });

  const groups: LinkageGroup[] = [
    mkGroup(
      "datamodel",
      "数据中台 · DataModel",
      entities.map(e => ({ id: e.id, name: e.name || e.id }))
    ),
    mkGroup(
      "page",
      "页面设计器 · Page",
      pages.map((p, i) => ({
        id: p.id || `page-${i}`,
        name: p.name || p.id || `page-${i}`,
      }))
    ),
    mkGroup(
      "workflow",
      "工作流 · Workflow",
      wfNodes.map(n => ({ id: n.id, name: n.name || n.id }))
    ),
    mkGroup(
      "rbac",
      "权限 · RBAC",
      roles.map(r => ({ id: r.id, name: r.label }))
    ),
    mkGroup(
      "aigc",
      "AIGC 中台",
      caps.map((c, i) => ({
        id: c.id || `cap-${i}`,
        name: c.name || c.id || `cap-${i}`,
      }))
    ),
  ].filter(g => g.items.length > 0);
  if (groups.length < 2) return null;

  const present = new Set(groups.flatMap(g => g.items.map(i => i.key)));
  const edges: LinkageEdge[] = [];
  const seen = new Set<string>();
  const push = (from: string, to: string, kind: LinkageEdge["kind"]) => {
    if (!present.has(from) || !present.has(to)) return; // 悬空成员不画线
    const sig = `${from}->${to}:${kind}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    edges.push({ from, to, kind });
  };

  const entityIds = entities.map(e => e.id);
  for (const [i, p] of pages.entries()) {
    const pid = p.id || `page-${i}`;
    const dominant = (() => {
      const counts = new Map<string, number>();
      for (const b of p.fieldBindings ?? []) {
        const dot = b.indexOf(".");
        if (dot > 0)
          counts.set(b.slice(0, dot), (counts.get(b.slice(0, dot)) ?? 0) + 1);
      }
      let best: string | null = null;
      let n = 0;
      for (const [id, c] of counts)
        if (c > n && entityIds.includes(id)) {
          best = id;
          n = c;
        }
      return best;
    })();
    if (dominant)
      push(key("page", pid), key("datamodel", dominant), "page-entity");
  }
  for (const b of model.appbundle?.pageBindings ?? []) {
    if (b.pageRef && b.workflowRef && wfNodes.length > 0) {
      // workflowRef 指整条流程：连到流程起点节点（无入边）
      const hasInbound = new Set(
        (model.workflow?.transitions ?? []).map(t => t.to)
      );
      const start = wfNodes.find(n => !hasInbound.has(n.id)) ?? wfNodes[0];
      push(key("page", b.pageRef), key("workflow", start.id), "page-workflow");
    }
  }
  const roleIdSet = new Set(roles.map(r => r.id));
  for (const n of wfNodes) {
    if (n.assigneeRole && roleIdSet.has(n.assigneeRole)) {
      push(key("workflow", n.id), key("rbac", n.assigneeRole), "node-role");
    }
  }
  for (const [i, c] of caps.entries()) {
    const cid = c.id || `cap-${i}`;
    const out = c.outputField ?? "";
    const dot = out.indexOf(".");
    if (dot > 0 && entityIds.includes(out.slice(0, dot))) {
      push(
        key("aigc", cid),
        key("datamodel", out.slice(0, dot)),
        "aigc-entity"
      );
    }
    for (const r of c.roleRefs ?? []) {
      if (roleIdSet.has(r))
        push(key("aigc", cid), key("rbac", r), "aigc-role");
    }
  }

  // ★ 2026-08-17：下面两段原本在 sandbox-graph.ts 里，只有沙盘看得到。
  //   架构图（linkageToMermaid）走的是本函数，于是**同一份模型两个视图画出来
  //   不是同一张网**。拿仓里 48 份真机模型量到的差距：
  //
  //       边种类           沙盘    架构图    差
  //       page-entity     262    202     +60
  //       role-page       306      0     +306   ← 整种边缺失
  //       合计            990    624     架构图少 36%
  //
  //   用户切到「架构图」看到的是打了 36% 折的网，**没有任何一处提示他少了什么**。
  //   而这个产品的核心主张恰恰是"整张网可以被整体看见、整体校验"。
  //
  //   ⚠ 修法是把增量**下沉到这里**，不是让架构图改吃 deriveSandboxGraph。
  //     后者一行就能改完，但会留下一个"故意不完整的底"，下一个调它的人照样
  //     拿到残图。事实源只能有一份。沙盘那边现在只剩它自己特有的断线体检。

  // 页→实体：fieldBindings 里出现过的**每个**实体都画。
  // 上面那段只画了"主导实体"（占比最高的那个），一页绑多个实体时其余全丢——
  // 这就是 page-entity 少 60 条的来源。
  for (const [i, p] of pages.entries()) {
    const pid = p.id || `page-${i}`;
    for (const b of p.fieldBindings ?? []) {
      const dot = b.indexOf(".");
      if (dot > 0) push(key("page", pid), key("datamodel", b.slice(0, dot)), "page-entity");
    }
  }

  // 角色→页面（可进入）：页面声明的动作权限 ∩ 角色经菜单持有的权限非空。
  // 判据与 rbac-preview.pageAccessForRole 的可见性同源，口径由
  // shared/app-graph/edge-contract.json 钉死。
  const access = deriveRoleAccess(model);
  for (const [i, p] of pages.entries()) {
    const pid = p.id || `page-${i}`;
    const declared = p.actionPermissions ?? [];
    if (declared.length === 0) continue; // 公共页不画：人人可进 = 全连接 = 零信息量
    for (const a of access) {
      if (a.permissions.some((perm) => declared.includes(perm))) {
        push(key("rbac", a.role), key("page", pid), "role-page");
      }
    }
  }

  return { groups, edges };
}

// --- 流程图数据（G6 渲染路径） ---------------------------------------------

export interface WfGraphNode {
  id: string;
  name: string;
  /** assigneeRole 原文（未声明为 null） */
  role: string | null;
  /** 角色是否在 rbac.roles 里声明（未声明如实标红） */
  roleResolved: boolean;
  /** 无入边 = 流程起点（与 live-runtime.startNodeId 同一判定） */
  isStart: boolean;
  /** 无出边 = 终点（approve 到此即 completed） */
  isTerminal: boolean;
  /** 阶段标签（泳道分组依据；未声明为 null） */
  phase: string | null;
}

export interface WfGraphEdge {
  from: string;
  to: string;
  condition: string | null;
}

export function deriveWorkflowGraphData(
  model: FiveSystemModel | null | undefined
): { nodes: WfGraphNode[]; edges: WfGraphEdge[] } | null {
  const wfNodes = model?.workflow?.nodes ?? [];
  if (wfNodes.length === 0) return null;
  const transitions = model?.workflow?.transitions ?? [];
  const hasInbound = new Set(transitions.map(t => t.to));
  const hasOutbound = new Set(transitions.map(t => t.from));
  const declaredRoles = new Set(model?.rbac?.roles ?? []);
  return {
    nodes: wfNodes.map(n => ({
      id: n.id,
      name: n.name || n.id,
      role: n.assigneeRole || null,
      roleResolved: !n.assigneeRole || declaredRoles.has(n.assigneeRole),
      isStart: !hasInbound.has(n.id),
      isTerminal: !hasOutbound.has(n.id),
      phase: (n.phase ?? "").trim() || null,
    })),
    edges: transitions.map(t => ({
      from: t.from,
      to: t.to,
      condition: t.condition || null,
    })),
  };
}

/**
 * 阶段泳道分组：全部节点都声明了 phase 且存在 ≥2 个不同阶段才启用
 * （部分缺失宁可回退平铺布局，不猜阶段归属）。阶段顺序按节点列表首现序。
 */
export function derivePhaseLanes(
  nodes: WfGraphNode[]
): Array<{ phase: string; nodeIds: string[] }> | null {
  if (nodes.length === 0 || nodes.some(n => !n.phase)) return null;
  const lanes: Array<{ phase: string; nodeIds: string[] }> = [];
  const byPhase = new Map<string, string[]>();
  for (const n of nodes) {
    const phase = n.phase as string;
    let ids = byPhase.get(phase);
    if (!ids) {
      ids = [];
      byPhase.set(phase, ids);
      lanes.push({ phase, nodeIds: ids });
    }
    ids.push(n.id);
  }
  return lanes.length >= 2 ? lanes : null;
}

// --- 五系统整体架构图（Mermaid flowchart，AppBundle 屏「架构图」视图） -------

export const LINKAGE_EDGE_LABEL: Record<LinkageEdge["kind"], string> = {
  "page-entity": "字段绑定",
  "page-workflow": "发起流程",
  "node-role": "审批人",
  "aigc-entity": "写回字段",
  "aigc-role": "可用角色",
  "role-page": "可进入",
};

export interface BundledLinkageEdge {
  fromSystem: LinkageSystem;
  toSystem: LinkageSystem;
  kind: LinkageEdge["kind"];
  count: number;
  label: string;
}

/**
 * C4 L2：成员边捆成组间边。沙盘默认面和 Mermaid 架构图共用，
 * 不许两处各聚一次（条数对不上不会报错，只会看起来像两张网）。
 */
export function bundleLinkageEdges(
  edges: Array<{ from: string; to: string; kind: string }>
): BundledLinkageEdge[] {
  const bundled = new Map<string, BundledLinkageEdge>();
  for (const e of edges) {
    const fromCut = e.from.indexOf(":");
    const toCut = e.to.indexOf(":");
    if (fromCut < 1 || toCut < 1) continue;
    const fromSystem = e.from.slice(0, fromCut) as LinkageSystem;
    const toSystem = e.to.slice(0, toCut) as LinkageSystem;
    const kind = e.kind as LinkageEdge["kind"];
    const sig = `${fromSystem}|${toSystem}|${kind}`;
    const cur = bundled.get(sig);
    if (cur) {
      cur.count += 1;
    } else {
      bundled.set(sig, {
        fromSystem,
        toSystem,
        kind,
        count: 1,
        label: LINKAGE_EDGE_LABEL[kind] ?? kind,
      });
    }
  }
  return [...bundled.values()];
}

/**
 * 五系统整体架构图：Mermaid flowchart —— 每个系统一个 subgraph 分组
 * （全部成员展开成网格），跨系统引用**捆扎成组间边**（语义标签 + 条数）。
 * 成员级逐条连线留给交互图；架构图管"哪个系统引用哪个系统、引用多重"
 * ——39 条成员边画进 dagre 会把整图摊到 4000+px 宽，捆扎后才是架构图。
 * 数据与 deriveSystemLinkageGraph 完全同源（悬空引用不入图）；
 * 少于 2 个非空系统段返回 null。
 */
export function linkageToMermaid(
  model: FiveSystemModel | null | undefined
): string | null {
  const data = deriveSystemLinkageGraph(model);
  if (!data) return null;

  // key → mermaid 安全 id（中文/符号净化后可能撞车，撞车追加后缀保唯一）
  const idMap = new Map<string, string>();
  const used = new Set<string>();
  const nid = (key: string): string => {
    let v = idMap.get(key);
    if (v) return v;
    v = mermaidId(key.replace(":", "__"));
    while (used.has(v)) v = `${v}_x`;
    used.add(v);
    idMap.set(key, v);
    return v;
  };

  // 整体 TB：系统组按引用方向垂直分层。组内不给布局自由发挥——大组会被
  // 摊成一整行（实测 6 角色的组被拉到 5000+px 宽）；用隐形链（~~~）把成员
  // 折成约 4 列的网格，组块保持紧凑，整图宽高比贴合看板画面。
  const lines = ["flowchart TB"];
  lines.push("  classDef datamodel fill:#e6f4ff,stroke:#91caff,color:#0958d9");
  lines.push("  classDef page fill:#e6fffb,stroke:#87e8de,color:#08979c");
  lines.push("  classDef workflow fill:#f9f0ff,stroke:#d3adf7,color:#531dab");
  lines.push("  classDef rbac fill:#fff7e6,stroke:#ffd591,color:#d46b08");
  lines.push("  classDef aigc fill:#fff0f6,stroke:#ffadd2,color:#c41d7f");
  for (const g of data.groups) {
    lines.push(`  subgraph sg_${g.system}["${mermaidLabel(g.label)}"]`);
    // TB 下无边成员同秩横排；>4 个时按隐形链竖排折列（每列 rows 个）
    lines.push("    direction TB");
    for (const item of g.items) {
      lines.push(`    ${nid(item.key)}["${mermaidLabel(item.name)}"]`);
    }
    const rows = g.items.length > 4 ? Math.ceil(g.items.length / 4) : 1;
    if (rows > 1) {
      for (let k = 0; k * rows < g.items.length; k++) {
        const chain = g.items.slice(k * rows, k * rows + rows);
        if (chain.length > 1) {
          lines.push(`    ${chain.map(i => nid(i.key)).join(" ~~~ ")}`);
        }
      }
    }
    lines.push("  end");
    lines.push(`  class ${g.items.map(i => nid(i.key)).join(",")} ${g.system}`);
  }
  for (const b of bundleLinkageEdges(data.edges)) {
    lines.push(
      `  sg_${b.fromSystem} -->|"${mermaidLabel(b.label)} ×${b.count}"| sg_${b.toSystem}`
    );
  }
  return lines.join("\n");
}

export function datamodelToMermaid(
  datamodel: FiveSystemModel["datamodel"] | null | undefined
): string | null {
  const entities = datamodel?.entities ?? [];
  if (entities.length === 0) return null;
  const entityIds = entities.map(e => e.id);
  const lines = ["erDiagram"];
  for (const entity of entities) {
    lines.push(`  ${mermaidId(entity.id)} {`);
    for (const field of entity.fields ?? []) {
      const type = mermaidId(String(field.type || "string")) || "string";
      const name = mermaidId(field.id);
      lines.push(`    ${type} ${name}${field.id === "id" ? " PK" : ""}`);
    }
    lines.push("  }");
  }
  // 关联边：ref 类型或 *_ref 命名的字段 → 目标实体（持 ref 的一侧是"多"）
  const seen = new Set<string>();
  for (const entity of entities) {
    for (const field of entity.fields ?? []) {
      const isRef =
        String(field.type || "").toLowerCase() === "ref" ||
        /_ref$/.test(field.id);
      if (!isRef) continue;
      // 声明优先，猜测兜底；自引用同上不画。
      const target = resolveRefEntityId(field, entityIds).target;
      if (!target || target === entity.id) continue;
      const key = `${entity.id}->${target}:${field.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(
        `  ${mermaidId(target)} ||--o{ ${mermaidId(entity.id)} : "${mermaidId(field.id)}"`
      );
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Cross-skill runtime edges (persisted skillRuntimeGraph projection)
// ---------------------------------------------------------------------------

export interface CrossSkillEdge {
  sourceSkill?: string;
  targetSkill?: string;
  state?: string;
  evidenceKey?: string;
}

export interface SkillRuntimeGraphLike {
  edges?: CrossSkillEdge[];
  bySkill?: Record<string, CrossSkillEdge[]>;
}

/** 从持久化的 skillRuntimeGraph 里取某个系统的跨系统边（刷新后仍可用）。 */
export function edgesForSkill(
  graph: SkillRuntimeGraphLike | null | undefined,
  closureKey: string
): CrossSkillEdge[] {
  const bySkill = graph?.bySkill;
  if (bySkill && Array.isArray(bySkill[closureKey])) return bySkill[closureKey];
  const all = graph?.edges ?? [];
  return all.filter(
    e => e.sourceSkill === closureKey || e.targetSkill === closureKey
  );
}

/**
 * 跨系统边 → mermaid flowchart LR。与 Python 侧 _skill_edges_to_mermaid
 * （v5_full_driver.py）同构，供刷新后无 SSE mermaid 时的客户端重建。
 */
export function crossSkillEdgesToMermaid(
  closureKey: string,
  edges: CrossSkillEdge[] | null | undefined
): string {
  const lines = ["flowchart LR"];
  const list = edges ?? [];
  if (list.length === 0) {
    lines.push(`  ${mermaidId(closureKey)}["${mermaidLabel(closureKey)}"]`);
    return lines.join("\n");
  }
  const seen = new Set<string>();
  for (const e of list) {
    const src = e?.sourceSkill;
    const tgt = e?.targetSkill;
    if (!src || !tgt) continue;
    const sig = `${src}->${tgt}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const label = mermaidLabel(e.evidenceKey || e.state || "");
    lines.push(
      `  ${mermaidId(src)}["${mermaidLabel(src)}"] -->|${label}| ${mermaidId(tgt)}["${mermaidLabel(tgt)}"]`
    );
  }
  return lines.join("\n");
}

/**
 * 闭环后的对话总结（零 LLM 模板，方案 A）：全部事实来自五系统模型与
 * 闭环证据，替换机械状态行——像 TRAE 那样"执行完说人话"，但不多花
 * 一次 LLM 调用；LLM 增强总结（方案 B）落地后本函数退为兜底。
 */
export function summarizeClosureForChat(
  model: FiveSystemModel | null,
  opts: {
    goalText?: string;
    blocked: boolean;
    evidencePresentCount: number;
    skillCount: number;
    versionPinsChecked?: boolean;
  }
): string {
  const {
    goalText,
    blocked,
    evidencePresentCount,
    skillCount,
    versionPinsChecked,
  } = opts;
  const topic = (goalText || "").trim().slice(0, 24);
  if (blocked || !model) {
    const head = topic ? `「${topic}」的推演还未收口` : "本轮推演还未收口";
    return `${head}：${evidencePresentCount}/${skillCount} 个系统证据可用。补齐缺口后再推一轮即可闭环。`;
  }
  const entities = model.datamodel?.entities ?? [];
  const fieldCount = entities.reduce((n, e) => n + (e.fields?.length ?? 0), 0);
  const nodes = model.workflow?.nodes ?? [];
  const transitions = model.workflow?.transitions ?? [];
  const phaseCount = new Set(nodes.map(n => n.phase).filter(Boolean)).size;
  const roles = normalizeRoles(model);
  const perms = model.rbac?.permissions ?? [];
  const pages = model.page?.pages ?? [];
  const bindingCount = pages.reduce(
    (n, p) => n + (p.fieldBindings?.length ?? 0),
    0
  );
  const caps = model.aigc?.capabilities ?? [];
  const wfBindings = (model.appbundle?.pageBindings ?? []).filter(
    b => b.pageRef && b.workflowRef
  ).length;

  const parts: string[] = [];
  if (entities.length)
    parts.push(`数据模型 ${entities.length} 实体 · ${fieldCount} 字段`);
  if (nodes.length) {
    parts.push(
      `工作流 ${nodes.length} 节点 · ${transitions.length} 转移${phaseCount > 1 ? ` · ${phaseCount} 阶段` : ""}`
    );
  }
  if (roles.length)
    parts.push(`角色权限 ${roles.length} 角色 · ${perms.length} 权限`);
  if (pages.length)
    parts.push(`页面 ${pages.length} 页 · ${bindingCount} 处字段绑定`);
  if (caps.length) parts.push(`AI 能力 ${caps.length} 项可写回`);

  const lines: string[] = [
    `已为${topic ? `「${topic}」` : "本话题"}搭出可运行的应用闭环（证据 ${evidencePresentCount}/${skillCount}，版本${versionPinsChecked ? "已钉扎" : "待钉扎"}）：`,
  ];
  if (parts.length) {
    lines.push(
      parts.join("；") +
        (wfBindings ? `；页面↔流程绑定 ${wfBindings} 处。` : "。")
    );
  }
  // ⚠ 2026-08-24：这句原先写"顶栏「沙盘」"，而顶栏那片 tab 已经撤了（与
  // 「透视」里的入口重复）。指路文案和真实 UI 是**生成侧/消费侧**那一对，
  // 只改按钮不改文案 = 教用户去点一个不存在的东西，且没有任何报错。
  lines.push(
    "右侧应用已在运行：可录入数据、提交审批、切换角色、试 AI 写回；开「透视」对准页面元素，能看到它背后的数据、流程和权限，侧栏顶上的「打开沙盘」是五系统接线总图。"
  );
  return lines.join("\n");
}
