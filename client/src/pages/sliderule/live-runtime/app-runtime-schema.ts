/**
 * app-runtime-schema — "应用运行 option"：五系统模型 → 一份可直接渲染成
 * 完整后台系统的 JSON schema（el-form-renderer / el-data-table 哲学：
 * 菜单、表格列、表单项全部 JSON 化，渲染器照 schema 出真系统长相）。
 *
 * 纯函数模块：模型进、schema 出，无副作用，便于单测。
 */

import {
  normalizeRoles,
  resolveRefEntityId,
  type FiveSystemModel,
  type FiveSystemField,
  type PageReconstructionEvidence,
} from "../system-screens/five-system-model";
import {
  normalizeFieldFormat,
  normalizeFieldOptions,
  type FieldFormat,
  type NormalizedFieldOption,
} from "./field-display";
import type {
  PageSurfaceDensity,
  PageSurfaceSpec,
  PageSurfaceType,
} from "../system-screens/five-system-model";
import { DESIGN_RECIPE_IDS } from "./design-recipes";
import {
  PAGE_CONTENT_REF,
  normalizeBusinessGrid,
  type BusinessGridLayouts,
} from "./business-page-layout";

export interface AppFormFieldSchema {
  id: string;
  label: string;
  /** string | number | date | datetime | enum | ref | text（未知类型回退 string） */
  type: string;
  /** ref 字段指向的实体 id（type==="ref" 时给出，供渲染器做下拉） */
  refEntityId?: string;
  /** enum 字段的声明取值（已归一化：非法 tone 降级 default）；无声明为空数组省略 */
  options?: NormalizedFieldOption[];
  /** 展示格式（已按字段类型校验；非法声明在派生时丢弃——门禁负责标红） */
  format?: FieldFormat;
}

/** 页面可用的 AI 动作：outputField 落在本页主实体的 AIGC 能力。 */
export interface AppAiActionSchema {
  capId: string;
  label: string;
  /** 能力声明的输入引用（"entity.field"；同实体的从当前行预填） */
  inputFields: string[];
  /** 输出写回的字段（本页主实体的字段 id） */
  outputFieldId: string;
  /** 输出字段展示名 */
  outputLabel: string;
}

/**
 * 页面级图表（模型 page.charts 声明 → 渲染器对着运行时行数据求值）。
 * 与 AppChartSchema（工作台内置图）不同：这里的维度/指标绑定 datamodel 字段，
 * 悬空引用在派生时被丢弃（门禁负责标红，运行应用不渲染坏图）。
 */
export interface AppPageChartSchema {
  id: string;
  label: string;
  type: "bar" | "line" | "pie" | "donut";
  /** 分组维度所在实体（= 取行数据的实体） */
  entityId: string;
  /** 分组维度字段 id */
  dimensionFieldId: string;
  /** 维度字段展示名 */
  dimensionLabel: string;
  /** "count" 或 "sum" */
  metric: "count" | "sum";
  /** metric === "sum" 时的求和字段 id（同实体） */
  metricFieldId?: string;
  /** 指标展示名（count → "数量"；sum → 字段名） */
  metricLabel: string;
  /**
   * 维度字段是 enum 时的取值声明（已归一化）。图例/轴类目照这个把存进行里的
   * 取值 id 换成中文 label——不给的话环图图例直接写 `refunded` `unpaid`，
   * 那是模型内部的标识符，不是给用户看的词。非 enum 维度不给。
   */
  dimensionOptions?: NormalizedFieldOption[];
}

/**
 * 页面级 KPI 统计卡（模型 page.stats 声明 → 渲染器对着运行时行数据求值）。
 * count 的行来源是声明的 entity；sum/avg 的行来源是指标字段所属实体
 * （数据在哪就从哪取）。悬空引用派生时丢弃——门禁标红，运行应用不渲染坏卡。
 */
export interface AppPageStatSchema {
  id: string;
  label: string;
  entityId: string;
  metric: "count" | "sum" | "avg";
  /** metric 为 sum/avg 时的取数字段 id */
  metricFieldId?: string;
  format: "number" | "money" | "percent";
}

/** 排行榜（E40.4）：行按 sortBy 数值倒序取 top-limit（前三名徽标高亮）。 */
export interface AppPageRankingSchema {
  id: string;
  label: string;
  entityId: string;
  sortFieldId: string;
  sortLabel: string;
  limit: number;
}

/** 动态流（E40.4）：行按 timeField 倒序；levelField 的 option tone 给级别上色。 */
export interface AppPageFeedSchema {
  id: string;
  label: string;
  entityId: string;
  timeFieldId: string;
  levelFieldId?: string;
}

/**
 * 页面级动作实例运行时声明（Step 5）。
 * permitted：当前角色是否有权执行此动作（permissionRef 对应的权限在当前角色权限集中）。
 */
export interface AppPageActionSchema {
  id: string;
  type: "navigate" | "openDetail" | "createRecord" | "updateRecord" | "changeFilter" | "drillDown";
  permissionRef?: string;
  targetPageRef?: string;
  entityRef?: string;
  targetBlockRef?: string;
  payload?: Record<string, unknown>;
  /** 当前角色有执行权限 */
  permitted: boolean;
}

/**
 * 体验区块运行时声明：id/type 必填；三阶段起 props 携带模型声明属性。
 * _legacy* 字段是 schema→renderer 内部通道，不进入模型协议或 Gate 校验；
 * _fromLegacy=true 表示此区块由旧字段自动转换而非模型直接声明。
 */
export interface AppExperienceBlockSchema {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  binding?: {
    entityRef?: string;
    aggregate?: string;
    timeDimensionRef?: string;
    timeGrain?: "day" | "week" | "month";
    seriesBy?: string;
    filter?: { fieldRef: string; operator: "eq"; value: unknown };
    sortByRef?: string;
    sortOrder?: "asc" | "desc";
    limit?: number;
    timeFieldRef?: string;
    levelFieldRef?: string;
  };
  /** 事件 → 动作 id 绑定（Step 5） */
  eventBindings?: Record<string, string>;
  /** true 表示此区块来自 legacy 转换（stats/charts/rankings/feeds） */
  _fromLegacy?: boolean;
  /** MetricGrid 转换来源 */
  _legacyStat?: AppPageStatSchema;
  /** TrendChart 转换来源 */
  _legacyChart?: AppPageChartSchema;
  /** RankedList 转换来源 */
  _legacyRanking?: AppPageRankingSchema;
  /** ActivityFeed 转换来源 */
  _legacyFeed?: AppPageFeedSchema;
  /** FreeformInsight（2026-07-23）：二段生成回填的内容树，Python 侧
   * freeform_block.py 已用 Pydantic 深校验过；生成失败的区块在回填前就已
   * 被整体摘掉，不会出现"有 block 没内容"的悬空态。 */
  freeformContent?: { root: Record<string, unknown> };
}

/**
 * 页面范式（加厚 schema 二期）：kind 决定视图骨架。kanban/calendar 的
 * 字段绑定必须解析到本页主实体的对应类型字段——绑不上时诚实降级
 * workbench（门禁负责标红，运行应用不渲染坏视图）。
 */
export type AppPageKind =
  | "workbench"
  | "kanban"
  | "calendar"
  | "dashboard"
  | "wizard"
  | "monitor";

export interface AppPageSurfaceSchema {
  type: PageSurfaceType;
  density: PageSurfaceDensity;
  source: "model" | "inferred";
}

export interface AppPageViewSchema {
  kind: AppPageKind;
  /** kanban：看板列字段 id（主实体 enum 字段，列来自其 options） */
  statusFieldId?: string;
  /** calendar：日期字段 id（主实体 date 字段） */
  dateFieldId?: string;
  /** calendar：事件着色字段 id（主实体 enum 字段，可选） */
  colorByFieldId?: string;
}

export interface AppPageSchema {
  id: string;
  title: string;
  presentation: "application" | "marketing-landing";
  /** 本页主实体（fieldBindings 中出现最多的实体）；无绑定时 null → 渲染器显示空页 */
  entityId: string | null;
  /** 数据表列（主实体字段） */
  columns: AppFormFieldSchema[];
  /** 新建/编辑表单项（页面绑定的字段；不足时回退主实体全字段） */
  formFields: AppFormFieldSchema[];
  /** 详情抽屉字段（主实体全字段，不截断） */
  detailFields: AppFormFieldSchema[];
  /** 操作权限标签（来自 page.actionPermissions，如 "life_goal:create"） */
  actions: string[];
  /** 本页是否挂了审批流（appbundle.pageBindings 里 pageRef→workflowRef） */
  workflowLinked: boolean;
  /** 详情抽屉里的 AI 生成动作（无绑定能力时为空数组） */
  aiActions: AppAiActionSchema[];
  /** 模型声明的页面级 KPI 统计卡（表格上方的指标带） */
  stats: AppPageStatSchema[];
  /** 模型声明的排行榜（E40.4，悬空引用派生时丢弃） */
  rankings: AppPageRankingSchema[];
  /** 模型声明的动态流（E40.4，悬空引用派生时丢弃） */
  feeds: AppPageFeedSchema[];
  /** 模型声明的页面级图表（库无关声明 → 运行应用用 ECharts 渲染） */
  charts: AppPageChartSchema[];
  /** 页面范式（视图骨架；绑定失效已降级 workbench） */
  view: AppPageViewSchema;
  surface: AppPageSurfaceSchema;
  /** 体验区块过渡声明；旧页面为空，不参与现有内容渲染。 */
  experienceBlocks: AppExperienceBlockSchema[];
  /** 页面级动作实例（Step 5）；空数组对旧模型兼容 */
  pageActions: AppPageActionSchema[];
  /** Step 7：区块布局 5 槽位；未声明或声明后全空为 null，渲染层回退顺序平铺。 */
  layout: AppPageLayoutSchema | null;
  /** 2026-07-24：kind=monitor 页面额外生成的 FreeformInsight 总览区块——
   * 有就优先渲染，生成失败/未声明时 AppRuntimeScreen 回退固定的
   * stats/charts/rankings/feeds 骨架，不是互相替代关系。原样透传不做
   * 类型收窄（跟 identity.generatedTheme 同一个"渲染器内部再校验"套路）。 */
  /**
   * 总览页的 AI 设计版式。当前只按 appbundle.preferredDevice 生成唯一设备档；
   * `mobile` 仅用于兼容历史双档快照。
   *
   * 形状照 react-grid-layout 的 `layouts={{lg,md,sm}}`：同一份内容、每档
   * 一份布局，取用时"有本档用本档、没有就往更大的档回退"。老快照只有 root，
   * 手机自动回退到它——与 RGL 的回退语义一致。
   */
  freeformOverview?: {
    root: Record<string, unknown>;
    mobile?: { root: Record<string, unknown> };
  };
  /** 从完整首页视觉稿解析出的可审查契约与确定性还原提示词。 */
  pageReconstruction?: PageReconstructionEvidence;
}

/** Step 7：页面布局 5 槽位——每个槽位是有序区块 id 列表；mobile 为手机端覆盖。 */
export interface AppPageLayoutSchema {
  header: string[];
  headerExtra: string[];
  headerContent: string[];
  tabs: string[];
  filters: string[];
  metrics: string[];
  charts: string[];
  main: string[];
  supplement: string[];
  aside: string[];
  footerBar: string[];
  overlay: string[];
  mobile?: {
    header?: string[];
    headerExtra?: string[];
    headerContent?: string[];
    tabs?: string[];
    filters?: string[];
    metrics?: string[];
    charts?: string[];
    main?: string[];
    supplement?: string[];
    aside?: string[];
    footerBar?: string[];
    overlay?: string[];
  };
  /** RGL-compatible responsive placements rendered with native CSS Grid. */
  grid?: BusinessGridLayouts;
}

/**
 * 表格列去掉"反规范化副本"（2026-08-11）。
 *
 * ## 现场
 *
 * 线上产物截图里同一张表并排两列：
 *
 *     自提点        精选自提点
 *     自提点名称     定制自提点     ← 同一件事说两遍，值还对不上
 *
 * 值对不上那半已经在种子侧修了（副本跟着 ref 的解析结果走）。剩下这半是
 * **两列本来就该只出一列**：`pickup_point_ref` 与 `pickup_point_name` 是
 * 模型刻意做的反规范化——存引用的同时冗余一份显示名，免得每次关联查。
 * 那是数据层的正当设计，**不该原样端到界面上**。
 *
 * ## 留哪个
 *
 * 留 `_ref`，摘掉 `_name`。理由是 ref 那一列**带着关系**（refEntityId 已解析，
 * 下拉、跳转、筛选都挂在它身上），而 name 只是一份快照文本。
 * 这跟 react-admin 的 `<ReferenceField>` / Django admin 拿 FK 的 `__str__`
 * 当列显示是同一个取舍：**列上显示人话，但那一列的身份仍是那个引用**。
 *
 * ## 只动表格列，不动详情
 *
 * `detailFields` 原样保留——摘列是为了别在一屏里说两遍，不是要把字段藏起来。
 * 点进某一行仍然能看到冗余副本的值，数据没有变得不可达。
 * 这条边界很重要：渲染层可以决定"别挤在一起"，但没有资格决定"你看不到"。
 */
export function dedupeDenormalizedColumns(
  fields: AppFormFieldSchema[]
): AppFormFieldSchema[] {
  const keep = new Set(
    dedupeDenormalizedFieldIds(
      fields.map(f => f.id),
      id => fields.some(f => f.id === id && f.type === "ref")
    )
  );
  return keep.size === fields.length ? fields : fields.filter(f => keep.has(f.id));
}

/**
 * 同一条判据的**只认字段 id** 版本。
 *
 * 2026-08-12：上面那个只接了页面内置表格。用户圈空白那张截图上，「自提点 /
 * 自提点名称」两列**照样并排**——因为那张表是 `DataTable` 积木画的，它自己
 * 从真实行的键里派生列，根本不经过 `dedupeDenormalizedColumns`。
 * 判据钉在一个调用点上，换条渲染路径就漏；所以判据下沉到 id 这一层，两条
 * 路共用。
 *
 * `isRef` 是可选的类型旁证：拿得到字段类型就用（`type === "ref"` 最硬），
 * 拿不到就只靠 `_ref` 后缀——积木那边只有键名，没有 schema。
 */
export function dedupeDenormalizedFieldIds(
  ids: string[],
  isRef?: (id: string) => boolean
): string[] {
  const refStems = new Set(
    ids
      .filter(id => isRef?.(id) || /_ref$/.test(id))
      .map(id => id.replace(/(_ref|_id|Ref|Id)$/, ""))
      .filter(stem => stem)
  );
  if (refStems.size === 0) return ids;
  return ids.filter(id => {
    const m = /^(.+?)(_name|_title|_label|Name|Title|Label)$/.exec(id);
    // 词干必须完全相同才算副本 —— 跟种子侧同一条判据，宁可漏一个不许摘错
    return !(m && refStems.has(m[1]));
  });
}

export function pageFreeformOwnsContent(
  page: Pick<AppPageSchema, "presentation" | "view" | "freeformOverview">
): boolean {
  return Boolean(page.freeformOverview) && (
    page.presentation === "marketing-landing" ||
    page.view.kind === "monitor" ||
    page.view.kind === "dashboard"
  );
}

const SURFACE_TYPES = new Set<PageSurfaceType>([
  "table",
  "editable-table",
  "split-list",
  "queue",
]);
const SURFACE_DENSITIES = new Set<PageSurfaceDensity>([
  "compact",
  "default",
  "comfortable",
]);

function surfaceText(page: { id?: string; name?: string }): string {
  return `${page.id ?? ""} ${page.name ?? ""}`.toLowerCase();
}

export function inferPageSurface(page: {
  id?: string;
  name?: string;
  kind?: string;
  surface?: PageSurfaceSpec;
  workflowLinked?: boolean;
}): AppPageSurfaceSchema {
  const declaredType = page.surface?.type;
  const declaredDensity = page.surface?.density;
  if (
    declaredType &&
    SURFACE_TYPES.has(declaredType) &&
    (!declaredDensity || SURFACE_DENSITIES.has(declaredDensity))
  ) {
    return {
      type: declaredType,
      density: declaredDensity ?? "default",
      source: "model",
    };
  }

  const text = surfaceText(page);
  if (
    /coach|staff|employee|trainer|\u6559\u7ec3|\u5458\u5de5|\u4eba\u5458/.test(text)
  ) {
    return { type: "split-list", density: "default", source: "inferred" };
  }
  const inferredType: PageSurfaceType =
    /check[-_ ]?in|attendance|签到|考勤|inventory|stock|盘点/.test(text)
      ? "editable-table"
      : /renewal|payment|reconcile|approval|audit|续费|对账|审核|审批|跟进/.test(text) ||
          page.workflowLinked === true
        ? "queue"
        : /coach|staff|employee|trainer|教练|员工|人员/.test(text)
          ? "split-list"
          : "table";
  return { type: inferredType, density: "default", source: "inferred" };
}

export interface AppStatCardSchema {
  id: string;
  label: string;
  /**
   * 取值来源（渲染器对着运行时状态求值）：
   *   "entity:<id>"（该实体行数）| "instances:running" | "instances:total" | "roles"
   */
  source: string;
  suffix: string;
}

export interface AppChartSchema {
  id: string;
  /** bar（横向条形，单色 · 各类目一个度量）| donut（状态分布环图） */
  type: "bar" | "donut";
  label: string;
  /** "entities:rowcount"（各实体行数）| "instances:status"（审批状态分布） */
  source: string;
}

/** 工作台（首页仪表盘）也 JSON 化：统计卡/图表声明，渲染器照 schema 出 Pro 风格首页。 */
export interface AppHomeSchema {
  id: "home";
  title: string;
  stats: AppStatCardSchema[];
  charts: AppChartSchema[];
}

export interface AppRuntimeSchema {
  appName: string;
  /** 应用身份（E40.2）：主题/图标/导航形态（productName 已并入 appName） */
  identity: {
    themeId: string;
    icon: string;
    nav: "side" | "top";
    /** Step 8：默认设备视口偏好；老模型缺省不指定，运行时按现有默认值走。 */
    preferredDevice?: "desktop" | "tablet" | "phone";
    /** New generated models use one authoritative device; absent on historic dual layouts. */
    deviceAuthority?: "single-v1";
    /** Step 9：视觉配方引用；老模型/未声明为 undefined，运行时按 "default" 处理。 */
    designRecipeRef?: string;
    /** 2026-07-24：生图驱动生成的身份主题 token；未声明/校验不过时降级到
     * themeId 对应的 8 预设之一（resolveIdentityTheme 内部处理）。 */
    generatedTheme?: Record<string, unknown>;
    /** 2026-08-04：从这个应用的参照图上读出来的图表分类色（sheet_palette 写入）。
     * 未声明/校验不过时退回账本色序（resolveIdentityTheme 内部处理）。
     * 原样透传不收窄类型——存量快照没走过这一版门禁，形状在渲染器里再验。 */
    chartColors?: unknown;
  };
  /** 角色**引用键**。所有比较（roleRefs.includes、assigneeRole===）都用它。 */
  roles: string[];
  /**
   * 引用键 → 显示名。刻意跟 `roles` 分开放：合成一个对象数组的话，
   * 各处的 `roles.includes(role)` 会静默变成"永远为 false"，而 TS 在
   * `string[]` → `{id,label}[]` 这步能报错的地方并不多。分开就不可能拿错。
   * 补字段之前生成的应用这里是 id→id。
   */
  roleLabels: Record<string, string>;
  /** 应用首次打开的页面；老模型缺省为 home。 */
  landingPageId: string;
  home: AppHomeSchema;
  menus: Array<{ id: string; label: string; pageId: string }>;
  pages: AppPageSchema[];
}

function toFieldSchema(field: FiveSystemField): AppFormFieldSchema {
  const type = String(field.type || "string").toLowerCase();
  const schema: AppFormFieldSchema = {
    id: field.id,
    label: field.name || field.id,
    type,
  };
  // 字段语义（加厚 schema 一期）：归一化后透传，坏声明在这里丢弃
  const options = normalizeFieldOptions(type, field.options);
  if (options.length > 0) schema.options = options;
  const format = normalizeFieldFormat(type, field.format);
  if (format) schema.format = format;
  return schema;
}

/** "entity.field" 绑定串中出现最多的实体 = 页面主实体。 */
function dominantEntityId(fieldBindings: string[] | undefined): string | null {
  const counts = new Map<string, number>();
  for (const binding of fieldBindings ?? []) {
    const dot = binding.indexOf(".");
    if (dot <= 0) continue;
    const entityId = binding.slice(0, dot);
    counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/**
 * AI 动作的试跑输入：同实体的 inputFields 从当前行取值预填，
 * 跨实体引用如实留空（不猜、不横跨行拼数据）。
 */
export function buildAiActionInputs(
  action: AppAiActionSchema,
  entityId: string,
  rowValues: Record<string, unknown>
): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const ref of action.inputFields) {
    const dot = ref.indexOf(".");
    if (dot <= 0) continue;
    const refEntity = ref.slice(0, dot);
    const refField = ref.slice(dot + 1);
    const v = refEntity === entityId ? rowValues[refField] : undefined;
    inputs[ref] = v === undefined || v === null ? "" : String(v);
  }
  return inputs;
}

/**
 * 页面区域键。
 *
 * 2026-08-08 第三轮：旧的五个槽位（summary/primary/secondary/activity/content）
 * 整套退休。实测量过它们在 12 栅格里的宽度——summary 与 primary 一样（12）、
 * secondary 与 activity 一样（4）、content 随页型在 12 和 4 之间变，也就是
 * **五个名字只有两种行为，还有一个是不定项**；而 12 个已存应用里 secondary 和
 * content 一次都没被用过。换成照 ant-design/pro-blocks 那 29 个真实页面定出来
 * 的区域名，每一个都有出处（见目录 pageRegions 的 evidence 字段）。
 *
 * 仍用字面量元组是为了保住 Record<LayoutRegionKey, …> 的类型推导——直接从目录
 * JSON 导入会退化成 string。与目录 pageRegions 的一致性由
 * __tests__/ssot-parity.test.ts 哨兵锁死（谁改目录不改这里，CI 立刻红）。
 */
export const LAYOUT_REGION_KEYS = [
  "header",
  "headerExtra",
  "headerContent",
  "tabs",
  "filters",
  "metrics",
  "charts",
  "main",
  "supplement",
  "aside",
  "footerBar",
  "overlay",
] as const;
type LayoutRegionKey = (typeof LAYOUT_REGION_KEYS)[number];

/**
 * 区域表偶发被模型多包一层 `slots`（`layout: { slots: { summary: [...] } }`）。
 * 生成侧的 prompt 和 Gate 都已经按"摊平"来管了，但**已经落库的模型改不动**，
 * 而这层包装漏过来的后果是静默的：区域一个都读不到 → hasAny=false →
 * deriveLayout 返回 null → 渲染层判定为"没声明 layout"退回顺序平铺，模型的
 * 排版意图全丢，页面照常渲染、没有任何报错。
 *
 * 解包的判定是确定的，不是猜：`slots` 不在合法区域名里，而合法区域的值是
 * 数组、这里是对象——两条同时成立时不存在别的解释。
 */
function unwrapNestedSlots(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const nested = (raw as Record<string, unknown>).slots;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return raw;
  const hasRealRegion = LAYOUT_REGION_KEYS.some(k => Array.isArray((raw as Record<string, unknown>)[k]));
  // 外层已经有真区域时以外层为准，不拿包装层去覆盖它。
  return hasRealRegion ? raw : { ...(raw as Record<string, unknown>), ...nested };
}

function normalizeLayoutSlotMap(
  raw: unknown,
  validBlockIds: Set<string>
): Record<LayoutRegionKey, string[]> {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<LayoutRegionKey, string[]>;
  for (const region of LAYOUT_REGION_KEYS) {
    const ids = Array.isArray(obj[region]) ? (obj[region] as unknown[]) : [];
    out[region] = ids.map(v => String(v)).filter(idStr => validBlockIds.has(idStr));
  }
  return out;
}

/**
 * Step 7：页面布局区域派生。Gate 已校验槽位合法 + 引用不悬空，这里仍做
 * 防御性二次过滤（悬空引用/非法槽位如实丢弃，不炸渲染，只信任模型直接
 * 声明的 page.blocks——legacy 转换来的合成块不参与布局）。未声明 layout
 * 或过滤后所有区域全空时返回 null，渲染层回退旧的顺序平铺。
 */
function deriveLayout(
  rawLayout: unknown,
  experienceBlocks: AppExperienceBlockSchema[]
): AppPageLayoutSchema | null {
  if (!rawLayout || typeof rawLayout !== "object") return null;
  const directIds = new Set(
    experienceBlocks.filter(b => !b._fromLegacy).map(b => b.id)
  );
  if (directIds.size === 0) return null;
  const layout = unwrapNestedSlots(rawLayout);
  const regions = normalizeLayoutSlotMap(layout, directIds);
  const grid = normalizeBusinessGrid(
    (layout as Record<string, unknown>).grid,
    new Set([...directIds, PAGE_CONTENT_REF])
  );
  const mobileRaw = (layout as Record<string, unknown>).mobile;
  const mobile = mobileRaw
    ? normalizeLayoutSlotMap(unwrapNestedSlots(mobileRaw), directIds)
    : undefined;
  const hasAny = LAYOUT_REGION_KEYS.some(k => regions[k].length > 0) || Boolean(grid);
  if (!hasAny) return null;
  return { ...regions, mobile, grid };
}

export function deriveAppRuntimeSchema(
  model: FiveSystemModel | null | undefined,
  appName = "推演应用"
): AppRuntimeSchema | null {
  const pages = model?.page?.pages ?? [];
  const entities = model?.datamodel?.entities ?? [];
  if (pages.length === 0 || entities.length === 0) return null;

  const entityById = new Map(entities.map(e => [e.id, e] as const));
  const workflowLinkedPages = new Set(
    (model?.appbundle?.pageBindings ?? [])
      .filter(b => b.workflowRef)
      .map(b => b.pageRef)
  );

  // AIGC 能力按 outputField 所属实体归组：outputField="entity.field" 且
  // 字段真实存在才算数（悬空引用不进运行应用——各屏已负责标红）。
  const aiActionsByEntity = new Map<string, AppAiActionSchema[]>();
  for (const [i, cap] of (model?.aigc?.capabilities ?? []).entries()) {
    const out = cap.outputField ?? "";
    const dot = out.indexOf(".");
    if (dot <= 0) continue;
    const entityId = out.slice(0, dot);
    const fieldId = out.slice(dot + 1);
    const field = entityById.get(entityId)?.fields?.find(f => f.id === fieldId);
    if (!field) continue;
    const list = aiActionsByEntity.get(entityId) ?? [];
    list.push({
      capId: cap.id || `cap-${i}`,
      label: cap.name || cap.id || `能力 ${i + 1}`,
      inputFields: (cap.inputFields ?? []).map(String),
      outputFieldId: fieldId,
      outputLabel: field.name || fieldId,
    });
    aiActionsByEntity.set(entityId, list);
  }

  const pageSchemas: AppPageSchema[] = pages.map((page, index) => {
    const id = page.id || `page-${index + 1}`;
    const entityId = dominantEntityId(page.fieldBindings);
    const entity = entityId ? entityById.get(entityId) : undefined;
    // 索引对齐由 `.map` 保证：allFields[i] 就是 rawFields[i] 投影出来的那个。
    const rawFields = entity?.fields ?? [];
    const allFields = rawFields.map(toFieldSchema);

    // ref 字段解析目标实体，供下拉渲染。**模型声明的 refEntity 优先**，没声明
    // 才回落到词干猜测（存量模型全靠它）——见 resolveRefEntityId 里的度量。
    // 自引用只认声明的那种（猜到自己身上多半是命名巧合）。
    for (const [fi, f] of allFields.entries()) {
      if (f.type === "ref" || /_ref$/.test(f.id)) {
        const { target, declared } = resolveRefEntityId(rawFields[fi], entityById.keys());
        if (target && (declared || target !== entityId)) f.refEntityId = target;
      }
    }

    // 表单项 = 页面绑定到主实体的字段；一个都对不上时回退实体全字段。
    const boundFieldIds = new Set(
      (page.fieldBindings ?? [])
        .filter(b => entityId && b.startsWith(`${entityId}.`))
        .map(b => b.slice((entityId as string).length + 1))
    );
    const boundFields = allFields.filter(f => boundFieldIds.has(f.id));

    // 页面级 KPI 统计卡：count 的 entity、sum/avg 的指标字段必须真实存在
    //（悬空的丢弃——门禁负责标红，运行应用不渲染坏卡）；format 未知回退 number。
    const stats: AppPageStatSchema[] = [];
    for (const [si, stat] of (page.stats ?? []).entries()) {
      const sid = stat.id || `stat-${id}-${si}`;
      const label = stat.name || stat.id || `指标 ${si + 1}`;
      const rawFormat = String(stat.format ?? "number");
      const format =
        rawFormat === "money" || rawFormat === "percent" ? rawFormat : "number";
      const rawMetric = String(stat.metric ?? "count");
      if (rawMetric === "count") {
        const statEntityId = String(stat.entity ?? "");
        if (!entityById.has(statEntityId)) continue;
        stats.push({
          id: sid,
          label,
          entityId: statEntityId,
          metric: "count",
          format,
        });
        continue;
      }
      if (rawMetric.startsWith("sum:") || rawMetric.startsWith("avg:")) {
        const mref = rawMetric.slice(4);
        const mdot = mref.indexOf(".");
        if (mdot <= 0) continue;
        const mEntityId = mref.slice(0, mdot);
        const mField = entityById
          .get(mEntityId)
          ?.fields?.find(f => f.id === mref.slice(mdot + 1));
        if (!mField) continue;
        stats.push({
          id: sid,
          label,
          // 数据在指标字段所属实体——从那里取行（声明的 entity 只圈定 count）
          entityId: mEntityId,
          metric: rawMetric.startsWith("sum:") ? "sum" : "avg",
          metricFieldId: mField.id,
          format,
        });
      }
    }

    // 页面级图表：维度/求和字段必须真实存在（悬空的丢弃——门禁负责标红，
    // 运行应用不渲染坏图）；type 未知回退 bar（形态降级，不丢声明）。
    const charts: AppPageChartSchema[] = [];
    for (const [ci, chart] of (page.charts ?? []).entries()) {
      const dim = String(chart.dimension ?? "");
      const dot = dim.indexOf(".");
      if (dot <= 0) continue;
      const dimEntityId = dim.slice(0, dot);
      const dimFieldId = dim.slice(dot + 1);
      const dimEntity = entityById.get(dimEntityId);
      const dimField = dimEntity?.fields?.find(f => f.id === dimFieldId);
      if (!dimField) continue;
      const rawMetric = String(chart.metric ?? "count");
      let metric: "count" | "sum" = "count";
      let metricFieldId: string | undefined;
      let metricLabel = "数量";
      if (rawMetric.startsWith("sum:")) {
        const mref = rawMetric.slice(4);
        const mdot = mref.indexOf(".");
        const mField =
          mdot > 0 && mref.slice(0, mdot) === dimEntityId
            ? dimEntity?.fields?.find(f => f.id === mref.slice(mdot + 1))
            : undefined;
        if (!mField) continue;
        metric = "sum";
        metricFieldId = mField.id;
        metricLabel = mField.name || mField.id;
      }
      const rawType = String(chart.type ?? "bar");
      const dimensionOptions = normalizeFieldOptions(dimField.type, dimField.options);
      charts.push({
        id: chart.id || `chart-${id}-${ci}`,
        label: chart.name || chart.id || `图表 ${ci + 1}`,
        type:
          rawType === "line" || rawType === "pie" || rawType === "donut"
            ? rawType
            : "bar",
        entityId: dimEntityId,
        dimensionFieldId: dimFieldId,
        dimensionLabel: dimField.name || dimFieldId,
        metric,
        metricFieldId,
        metricLabel,
        ...(dimensionOptions.length > 0 ? { dimensionOptions } : {}),
      });
    }

    // 页面范式（加厚 schema 二期）：绑定必须解析到本页主实体的对应类型
    // 字段（含一期归一化后的 options/format），绑不上诚实降级 workbench。
    const fieldOfThisEntity = (
      ref: string | undefined,
      wantType: string
    ): AppFormFieldSchema | undefined => {
      const r = String(ref ?? "");
      const dot = r.indexOf(".");
      if (dot <= 0 || !entityId || r.slice(0, dot) !== entityId)
        return undefined;
      const field = allFields.find(f => f.id === r.slice(dot + 1));
      return field?.type === wantType ? field : undefined;
    };
    let view: AppPageViewSchema = { kind: "workbench" };
    const rawKind = String(page.kind ?? "workbench");
    if (rawKind === "kanban") {
      const statusField = fieldOfThisEntity(page.statusField, "enum");
      if (statusField) view = { kind: "kanban", statusFieldId: statusField.id };
    } else if (rawKind === "calendar") {
      const dateField = fieldOfThisEntity(page.dateField, "date");
      if (dateField) {
        view = {
          kind: "calendar",
          dateFieldId: dateField.id,
          colorByFieldId: fieldOfThisEntity(page.colorBy, "enum")?.id,
        };
      }
    } else if (rawKind === "dashboard") {
      view = { kind: "dashboard" };
    } else if (rawKind === "monitor") {
      view = { kind: "monitor" };
    } else if (rawKind === "wizard") {
      // 向导范式需要流程步骤作骨架——未挂 workflow 的页诚实降级 workbench
      const linked =
        workflowLinkedPages.has(id) || workflowLinkedPages.has(page.id ?? "");
      if (linked) view = { kind: "wizard" };
    }

    // E40.4 排行榜/动态流：引用解析失败的整条丢弃（门禁负责标红，
    // 运行应用不渲染坏声明）——与 stats/charts 同一诚实降级纪律。
    const rankings: AppPageRankingSchema[] = [];
    for (const [ri, rank] of (page.rankings ?? []).entries()) {
      const sortRef = String(rank.sortBy ?? "");
      const sdot = sortRef.indexOf(".");
      if (sdot <= 0) continue;
      const sEntityId = sortRef.slice(0, sdot);
      const sField = entityById
        .get(sEntityId)
        ?.fields?.find(f => f.id === sortRef.slice(sdot + 1));
      if (!sField || String(sField.type).toLowerCase() !== "number") continue;
      const rawLimit = Number(rank.limit ?? 5);
      rankings.push({
        id: rank.id || `ranking-${id}-${ri}`,
        label: rank.name || rank.id || `排行 ${ri + 1}`,
        entityId: sEntityId,
        sortFieldId: sField.id,
        sortLabel: sField.name || sField.id,
        limit: Number.isFinite(rawLimit) ? Math.min(10, Math.max(3, rawLimit)) : 5,
      });
    }

    const feeds: AppPageFeedSchema[] = [];
    for (const [fi, feed] of (page.feeds ?? []).entries()) {
      const timeRef = String(feed.timeField ?? "");
      const tdot = timeRef.indexOf(".");
      if (tdot <= 0) continue;
      const tEntityId = timeRef.slice(0, tdot);
      const tField = entityById
        .get(tEntityId)
        ?.fields?.find(f => f.id === timeRef.slice(tdot + 1));
      if (!tField || String(tField.type).toLowerCase() !== "date") continue;
      const levelRef = String(feed.levelField ?? "");
      const ldot = levelRef.indexOf(".");
      const lField =
        ldot > 0 && levelRef.slice(0, ldot) === tEntityId
          ? entityById
              .get(tEntityId)
              ?.fields?.find(
                f =>
                  f.id === levelRef.slice(ldot + 1) &&
                  String(f.type).toLowerCase() === "enum"
              )
          : undefined;
      feeds.push({
        id: feed.id || `feed-${id}-${fi}`,
        label: feed.name || feed.id || `动态 ${fi + 1}`,
        entityId: tEntityId,
        timeFieldId: tField.id,
        levelFieldId: lField?.id,
      });
    }

    // 体验区块：优先用模型直接声明的 page.blocks；若无声明，从现有
    // stats/charts/rankings/feeds 自动转换（零视觉变化路径，三阶段接入前
    // AppRuntimeScreen 会过滤掉 _fromLegacy 块，仍走旧渲染路径）。
    const experienceBlocks: AppExperienceBlockSchema[] = (() => {
      const directBlocks: AppExperienceBlockSchema[] = (page.blocks ?? []).map(
        (block, blockIndex) => ({
          id: String(block.id ?? "").trim() || `block-${id}-${blockIndex + 1}`,
          type: String(block.type ?? "").trim(),
          props: block.props as Record<string, unknown> | undefined,
          binding: block.binding as AppExperienceBlockSchema["binding"],
          eventBindings: block.eventBindings as Record<string, string> | undefined,
          freeformContent: block.freeformContent,
        })
      );
      if (directBlocks.length > 0) return directBlocks;
      // 无 page.blocks 时从旧字段生成 legacy 占位区块（渲染层过滤）
      return [
        ...stats.map(s => ({
          id: `legacy-stat-${s.id}`,
          type: "MetricGrid" as const,
          _fromLegacy: true as const,
          _legacyStat: s,
        })),
        ...charts.map(c => ({
          id: `legacy-chart-${c.id}`,
          type: "TrendChart" as const,
          _fromLegacy: true as const,
          _legacyChart: c,
        })),
        ...rankings.map(r => ({
          id: `legacy-ranking-${r.id}`,
          type: "RankedList" as const,
          _fromLegacy: true as const,
          _legacyRanking: r,
        })),
        ...feeds.map(f => ({
          id: `legacy-feed-${f.id}`,
          type: "ActivityFeed" as const,
          _fromLegacy: true as const,
          _legacyFeed: f,
        })),
      ];
    })();

    const workflowLinked =
      workflowLinkedPages.has(id) || workflowLinkedPages.has(page.id ?? "");

    return {
      id,
      title: page.name || id,
      presentation:
        page.presentation === "marketing-landing" ? "marketing-landing" : "application",
      entityId: entity ? entityId : null,
      columns: dedupeDenormalizedColumns(allFields).slice(0, 6),
      detailFields: allFields,
      formFields: boundFields.length > 0 ? boundFields : allFields,
      actions: (page.actionPermissions ?? []).map(String),
      workflowLinked,
      surface: inferPageSurface({ ...page, workflowLinked }),
      aiActions: entityId ? (aiActionsByEntity.get(entityId) ?? []) : [],
      stats,
      rankings,
      feeds,
      charts,
      view,
      freeformOverview: page.freeformOverview,
      pageReconstruction: page.pageReconstruction,
      // 体验区块：优先用模型直接声明的 page.blocks；若无声明，从现有
      // stats/charts/rankings/feeds 自动转换（零视觉变化路径，三阶段接入前
      // AppRuntimeScreen 会过滤掉 _fromLegacy 块，仍走旧渲染路径）。
      experienceBlocks,
      /** Step 7：页面布局 5 槽位；无声明或声明后全空时为 null，渲染层回退顺序平铺。 */
      layout: deriveLayout(page.layout, experienceBlocks),
      // 页面级动作实例（Step 5）。deriveAppRuntimeSchema 无角色上下文，
      // permitted 默认 true；AppRuntimeScreen 的 handleBlockAction 用 pageAccess
      // 做实际权限检查，二次守门。
      pageActions: (page.actions ?? []).map(
        (action): AppPageActionSchema => ({
          id: action.id,
          type: action.type,
          permissionRef: action.permissionRef,
          targetPageRef: action.targetPageRef,
          entityRef: action.entityRef,
          targetBlockRef: action.targetBlockRef,
          payload: action.payload,
          permitted: true,
        })
      ),
    };
  });

  // 工作台统计卡：前两个实体行数 + 审批实例两项，凑不足 4 张时补角色数。
  const stats: AppStatCardSchema[] = entities.slice(0, 2).map(e => ({
    id: `stat-entity-${e.id}`,
    label: `${e.name || e.id}`,
    source: `entity:${e.id}`,
    suffix: "条",
  }));
  stats.push(
    {
      id: "stat-running",
      label: "进行中审批",
      source: "instances:running",
      suffix: "件",
    },
    {
      id: "stat-total",
      label: "累计流程实例",
      source: "instances:total",
      suffix: "件",
    }
  );
  if (stats.length < 4) {
    stats.push({
      id: "stat-roles",
      label: "系统角色",
      source: "roles",
      suffix: "个",
    });
  }

  const home: AppHomeSchema = {
    id: "home",
    title: "工作台",
    stats: stats.slice(0, 4),
    charts: [
      {
        id: "chart-entities",
        type: "bar",
        label: "各实体数据量",
        source: "entities:rowcount",
      },
      {
        id: "chart-instances",
        type: "donut",
        label: "审批状态分布",
        source: "instances:status",
      },
    ],
  };

  // 新模型可以直接指定一个真实业务页作为落地页；旧模型没有该字段时仍用
  // 固定工作台。Gate/Repair 负责上游引用质量，这里仍做最后一道诚实回退。
  const requestedLandingPageId = String(
    model?.appbundle?.landingPageRef ?? ""
  ).trim();
  const landingPageId = pageSchemas.some(p => p.id === requestedLandingPageId)
    ? requestedLandingPageId
    : home.id;

  // E40.2 应用身份：产品名权威 > 会话标题；枚举已过门/修复器，这里只做
  // 缺省回退（老模型无身份段 → 与历史渲染完全一致）
  const rawIdentity = model?.appbundle?.appIdentity;
  const productName = String(rawIdentity?.productName ?? "").trim();
  // Step 8：experienceShell 是 nav 的新权威来源（仅 navigation 模式下生效；
  // focus 模式暂不改变导航渲染，留给后续全屏容器实现）。旧模型没有该字段时
  // 仍读 appIdentity.nav，保证历史渲染不变。
  const rawShell = model?.appbundle?.experienceShell;
  const shellNav =
    rawShell?.mode === "navigation"
      ? String(rawShell?.navigation ?? "").trim()
      : "";
  const legacyNav = String(rawIdentity?.nav ?? "").trim();
  const preferredDeviceRaw = String(model?.appbundle?.preferredDevice ?? "").trim();
  const deviceAuthorityRaw = String(model?.appbundle?.deviceAuthority ?? "").trim();
  const designRecipeRefRaw = String(rawIdentity?.designRecipeRef ?? "").trim();
  const identity = {
    themeId: String(rawIdentity?.theme ?? "").trim() || "azure",
    icon: String(rawIdentity?.icon ?? "").trim() || "boxes",
    nav: ((shellNav || legacyNav) === "top" ? "top" : "side") as "side" | "top",
    preferredDevice: (["desktop", "tablet", "phone"].includes(preferredDeviceRaw)
      ? preferredDeviceRaw
      : undefined) as "desktop" | "tablet" | "phone" | undefined,
    deviceAuthority: deviceAuthorityRaw === "single-v1" ? ("single-v1" as const) : undefined,
    // Step 9：门禁已校验合法域；这里防御性二次过滤，悬空/非法值当未声明处理。
    designRecipeRef: DESIGN_RECIPE_IDS.includes(designRecipeRefRaw)
      ? designRecipeRefRaw
      : undefined,
    // 2026-07-24：生图驱动生成的身份主题（identity_theme_gen.py 写回），
    // 未声明或校验不过时 resolveIdentityTheme 自己会降级到 8 预设，这里
    // 原样透传不做类型收窄（跟 freeformContent 同一个"渲染器内部再校验"
    // 的处理方式）。
    generatedTheme: rawIdentity?.generatedTheme as Record<string, unknown> | undefined,
    // 2026-08-04：参照图取到的图表色，同样原样透传（校验在 identity-palette）。
    chartColors: rawIdentity?.chartColors,
  };

  const normalizedRoles = normalizeRoles(model);

  return {
    appName: productName || appName,
    identity,
    roles: normalizedRoles.map(r => r.id),
    roleLabels: Object.fromEntries(normalizedRoles.map(r => [r.id, r.label])),
    landingPageId,
    home,
    menus: [
      ...(landingPageId === home.id
        ? [{ id: "menu-home", label: home.title, pageId: home.id }]
        : []),
      ...pageSchemas.map(p => ({
        id: `menu-${p.id}`,
        label: p.title,
        pageId: p.id,
      })),
    ],
    pages: pageSchemas,
  };
}
