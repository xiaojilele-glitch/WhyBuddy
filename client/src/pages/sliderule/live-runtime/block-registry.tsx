/**
 * 体验区块渲染表。
 *
 * 目录定义在 experience_block_catalog.json；这里登记可信的 React 渲染边界。
 * Phase 1（Step 6）起 QuickActionPanel/FilterBar 接了真实渲染；WorkflowTimeline
 * 与 FreeformInsight（2026-07-23）接了真实渲染。其余类型
 * （MetricGrid/TrendChart/RankedList/ActivityFeed/DataTable）仍是占位，
 * 留给后续阶段接入。legacy 转换来的区块（_fromLegacy）不进这条渲染路径，
 * 视觉零变化。
 *
 * 这张表是「渲染器到底有没有」的唯一事实源。目录里每个区块的
 * rendererStatus 必须与这里一致，__tests__/ssot-parity.test.ts 对账——
 * 因为生成侧的放开名单（generationEnabled）以 rendererStatus 为前提，
 * 两边说法一旦分家，就会重演"放开了却渲染成惰性占位卡"的事故。
 */
import React from "react";
import dayjs from "dayjs";
import {
  Avatar,
  Alert,
  Badge,
  Breadcrumb,
  Button,
  Calendar,
  Card,
  Checkbox,
  Collapse,
  ConfigProvider,
  DatePicker,
  Descriptions,
  Dropdown,
  Drawer,
  Empty,
  Flex,
  Image,
  Input,
  List,
  Modal,
  Pagination,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Result,
  Space,
  Statistic,
  Switch,
  Steps,
  Table,
  Tabs,
  Tag,
  theme as antdTheme,
  Timeline,
  Tooltip,
  Tree,
  Typography,
  Upload,
} from "antd";
import type { TableColumnsType } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  CellEditorTable,
  DragSortTable,
  DrawerForm,
  FooterToolbar,
  ModalForm,
  ProCard,
  ProDescriptions,
  ProForm as AntProForm,
  ProFormDateRangePicker,
  ProFormDatePicker,
  ProFormDateTimePicker,
  ProFormDigit,
  ProFormMoney,
  ProFormRadio,
  ProFormRate,
  ProFormSegmented,
  ProFormSlider,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  QueryFilter as AntQueryFilter,
  RowEditorTable,
  StatisticCard,
  StepsForm as AntStepsForm,
} from "@ant-design/pro-components";
// WorkflowTimeline 自己的节点箭头（组件 UI，用静态 import；freeform 的
// 动态图标解析走下面的 AntdIcons 命名空间 + 目录别名表，两回事）。
// 全量图标命名空间——FreeformInsight 的 iconRef 按名字动态解析成任意 Ant
// Design 图标，不再限定在一个手维护的小集合里（2026-07-24）。legacy kebab
// 别名也走这条动态解析（映射表在目录 JSON 里，与 Python 侧同源），不再
// 静态 import 单个图标。
import * as AntdIcons from "@ant-design/icons";

import catalogJson from "@experience-blocks";
// 自研基础组件（懒加载重库，不进主包）——见 base-components/custom-components.tsx。
import { MarkdownEditor, MarkdownView, SqlEditor } from "../base-components/custom-components";
import type { WorkflowSection } from "../system-screens/five-system-model";
import type { RuntimeRow } from "./live-runtime";
import type { ActionKind, CartActionKind } from "./html-binding-runtime";
import type { AppFormFieldSchema } from "./app-runtime-schema";
import { dedupeDenormalizedFieldIds } from "./app-runtime-schema";
import type { NormalizedFieldOption } from "./field-display";
import { resolveValueType } from "./field-value-type";
import { buildEchartsOption } from "./build-echarts-option";
import {
  buildSparklineOption,
  computeDataRefTrend,
  formatTrendLabel,
  type DataRefTrend,
} from "./dataref-trend";
import {
  ImportMappingWizardRenderer,
  OnboardingChecklistWizardRenderer,
} from "./practice-wizards";
import { useLibraryPreview } from "../library-preview-focus";

/** 组件库预览里关掉首字段 autofocus；真应用仍走 ProForm 默认（true）。 */
function ProForm(
  props: React.ComponentProps<typeof AntProForm>
) {
  const preview = useLibraryPreview();
  return (
    <AntProForm
      {...props}
      autoFocusFirstInput={preview ? false : props.autoFocusFirstInput}
    />
  );
}

function QueryFilter(
  props: React.ComponentProps<typeof AntQueryFilter>
) {
  const preview = useLibraryPreview();
  return (
    <AntQueryFilter
      {...props}
      autoFocusFirstInput={preview ? false : props.autoFocusFirstInput}
    />
  );
}

/**
 * ⚠ 2026-09-13：这里原来传 `autoFocusFirstInput={preview ? false : …}`，
 * 意图是「组件库预览时别抢焦点」。但 `@ant-design/pro-components@2.8.10`
 * **整个包里已经没有这个 prop**（grep 不到，类型里也没有）——传了也是空转，
 * 只在 `pnpm run check` 里留下三条 TS 错误，而 CI 第一步就挂在 check 上，
 * 后面的架构闸整个被 skip。
 *
 * 删掉它**不改变任何运行时行为**（它本来就没生效）。「预览不抢焦点」这个
 * 意图现在是未实现状态：真要做得换一条路（比如预览容器上 inert / 拦
 * focus 事件），不能靠这个已经不存在的 prop。
 */
const StepsForm = Object.assign(
  function StepsForm(props: React.ComponentProps<typeof AntStepsForm>) {
    return <AntStepsForm {...props} />;
  },
  { StepForm: AntStepsForm.StepForm }
);

/** enum 字段取值声明的按需查询（entityId + fieldId → 归一化 options）。 */
export type EnumOptionsLookup = (
  entityId: string,
  fieldId: string
) => NormalizedFieldOption[];

/**
 * 字段显示名的按需查询（entityId + fieldId → 中文名）。
 *
 * DataTable 的列头本来直接打印字段 id（`lot_code` / `supplier_id`），跟同页
 * 其它表格的中文列名坐在一起格外刺眼。列定义在模型里，区块渲染器手里没有，
 * 所以跟 enumOptionsOf 一样按需查。查不到回落字段 id（不猜、不留空）。
 */
export type FieldLabelLookup = (
  entityId: string,
  fieldId: string
) => string | undefined;

/**
 * 字段类型的按需查询（entityId + fieldId → 数据模型里声明的类型）。
 *
 * 表单族积木（RecordForm / RecordFormDialog / StepsForm）靠它决定每个字段
 * 出哪种控件：enum→下拉、number→数字、date→日期、text→多行。**查不到就按
 * string 处理，不猜**——跟 fieldLabelOf 查不到回落字段 id 是同一条纪律。
 */
export type FieldTypeLookup = (
  entityId: string,
  fieldId: string
) => string | undefined;
import {
  buildFeedRows,
  buildRankedRows,
  buildTrendSeries,
  computeAggregate,
  parseAggregate,
  type FeedItem,
  type TimeGrain,
} from "./block-data";
import {
  BookingConflictPanelRenderer,
  DeadlineAgendaRenderer,
  DeploymentWizardRenderer,
  EventRsvpPanelRenderer,
  RecurrenceEditorRenderer,
  ResourceBookingCalendarRenderer,
  ScheduleCapacityHeatmapRenderer,
} from "./calendar-wizard-blocks";
import {
  AppointmentWaitlistPanelRenderer,
  AvailabilityOverridePanelRenderer,
  OnCallScheduleCalendarRenderer,
  RescheduleRequestDrawerRenderer,
  SchedulePublishBarRenderer,
  TimezoneOverlapPanelRenderer,
} from "./schedule-status-blocks";
import {
  CONFIGURATION_WIZARD_POLICIES,
  CONFIGURATION_WIZARD_RENDERERS,
} from "./configuration-wizard-batch";
import {
  COLLABORATION_CONTENT_LABELS,
  COLLABORATION_CONTENT_RENDERERS,
} from "./collaboration-content-blocks";
import {
  DATA_GOVERNANCE_LABELS,
  DATA_GOVERNANCE_RENDERERS,
} from "./data-governance-blocks";
import {
  HIERARCHY_SELECTION_LABELS,
  HIERARCHY_SELECTION_RENDERERS,
} from "./hierarchy-selection-blocks";
import { ANALYSIS_DEPENDENCY_RENDERERS } from "./analysis-dependency-blocks";
import {
  AlertGroupAccordionRenderer,
  AssetReviewLightboxRenderer,
  DeploymentRolloutTrackRenderer,
  EvidenceCollectionWorkspaceRenderer,
  INDEPENDENT_STRUCTURE_LABELS,
  PaymentAllocationWorkbenchRenderer,
  SignatureFieldCanvasRenderer,
} from "./independent-structure-blocks";
import {
  ExperimentTrafficAllocatorRenderer,
  INDEPENDENT_STRUCTURE_BATCH2_LABELS,
  QueryNotebookComposerRenderer,
  SlaBreachClockRenderer,
  WarehouseBinHeatmapRenderer,
  WarehousePickRouteScannerRenderer,
  WorkflowNodeDebuggerRenderer,
} from "./independent-structure-blocks-batch2";
import {
  DashboardGridComposerRenderer,
  DistributedTraceWaterfallRenderer,
  ExpressionDataMapperRenderer,
  INDEPENDENT_STRUCTURE_BATCH3_LABELS,
  LiveLogTailerRenderer,
  ResumableUploadQueueRenderer,
  SessionReplayScrubberRenderer,
} from "./independent-structure-blocks-batch3";
import {
  FlameGraphProfilerRenderer,
  FormCanvasBuilderRenderer,
  INDEPENDENT_STRUCTURE_BATCH4_LABELS,
  PdfPageOrganizerRenderer,
  PolicyDecisionSimulatorRenderer,
  StreamReplicationConfiguratorRenderer,
  ThreeWayMergeResolverRenderer,
} from "./independent-structure-blocks-batch4";
import {
  BooleanRuleTreeBuilderRenderer,
  DatasetJoinBuilderRenderer,
  GeofenceVertexEditorRenderer,
  ImageCropTransformStudioRenderer,
  INDEPENDENT_STRUCTURE_BATCH5_LABELS,
  PivotShelfComposerRenderer,
  RouteStopSequencerRenderer,
} from "./independent-structure-blocks-batch5";
import {
  AlertThresholdBandEditorRenderer,
  BomAssemblyTreeEditorRenderer,
  CompositeRoleBuilderRenderer,
  CronOccurrenceBuilderRenderer,
  HttpRequestWorkbenchRenderer,
  INDEPENDENT_STRUCTURE_BATCH6_LABELS,
  MediaTrimTimelineRenderer,
} from "./independent-structure-blocks-batch6";
import {
  ArtifactProvenanceVerifierRenderer,
  CertificateRotationPlannerRenderer,
  ColumnProfileWorkbenchRenderer,
  INDEPENDENT_STRUCTURE_BATCH7_LABELS,
  OcrRegionCorrectionCanvasRenderer,
  QueryExecutionPlanInspectorRenderer,
  WebhookPayloadSchemaExplorerRenderer,
} from "./independent-structure-blocks-batch7";
import {
  BankTransactionReconciliationMatcherRenderer,
  CvssVectorCalculatorRenderer,
  FaceIdentityAssignmentPanelRenderer,
  INDEPENDENT_STRUCTURE_BATCH8_LABELS,
  InventoryLocationLevelTunerRenderer,
  LogPatternClusterExplorerRenderer,
  ProductVariantMatrixBuilderRenderer,
} from "./independent-structure-blocks-batch8";
import { deriveWorkflowMainPath } from "./workflow-main-path";
import {
  BLOCK_CHART_AXIS_FONT_SIZE,
  BUSINESS_FILL_COLOR,
  BUSINESS_SPLIT_COLOR,
  INK,
  INK_HEX,
} from "./business-surface-theme";
// ECharts 基建走独立 chunk（跟 AppRuntimeScreen 里那份同一个组件/同一个
// import()，Vite 按 module 去重成一个 chunk，不会重复打包）。
const LazyEchartsChart = React.lazy(() => import("./EchartsChart"));

export interface ExperienceBlockCatalogEntry {
  type: string;
  description: string;
  rendererKey: string;
  /** 事实：本文件的渲染表登记的是真渲染器还是 ExistingContentAdapter 占位。 */
  rendererStatus: "real" | "placeholder";
  /** 灰度决定：准不准让 LLM 往 page.blocks 里写这个类型（前提是 real）。 */
  generationEnabled: boolean;
  propsSchema: Record<string, unknown>;
  dataKinds: string[];
  /** 这个区块能落在哪些页面区域（2026-08-08 从 allowedSlots 换过来）。 */
  allowedRegions: string[];
  events: string[];
}

/** FreeformInsight（2026-07-23）：二段生成产出的内容树，Python
 * freeform_block.py 用 Pydantic 深校验过（标签/样式/图标白名单 + dataRef
 * 强类型引用），前端渲染器仍然二次过滤，不单方面信任上游。 */
export interface FreeformDataRef {
  entityRef: string;
  aggregate?: string;
  /** 同实体下的日期字段。给了就在大数字下面出环比 + 迷你走势线（2026-07-29）。 */
  trendFieldRef?: string;
  /** 分桶粒度 day|week|month，默认 day。 */
  trendGrain?: string;
}
/** 真图表声明（2026-07-24）——不是 CSS 画的近似形状，是运行时拿真实行
 * 数据现算的 ECharts option，复用 build-echarts-option.ts 那套已经在用
 * 的确定性配色/分组逻辑，数据随真实数据变化自动更新。 */
export interface FreeformChartSpec {
  type: "bar" | "line" | "pie" | "donut";
  entityRef: string;
  dimensionFieldId: string;
  metric: "count" | "sum";
  metricFieldId?: string;
  metricLabel: string;
}
/**
 * 逐行真实数据（2026-08-03）——排行榜/动态流/最近记录这类"一行一行"的内容。
 *
 * 取代了此前的 blockRef（从固定积木清单里挑一个摆进来）。blockRef 存在的
 * 唯一理由是 dataRef 只能取聚合值、设计模型画不了逐行内容；但固定积木长什么
 * 样由组件写死，参照图上的版式落不了地。现在把逐行能力直接补给设计模型：
 * **版式它自由画，数据我们喂真的**，固定积木那条通道整体删除。
 *
 * 声明这个字段的节点是列表容器，它的 children 是**一行**的模板，按取到的
 * 行数重复渲染；模板里带 fieldRef 的节点替换成那一行的真实值。
 */
export interface FreeformRowsRef {
  entityRef: string;
  /** 模板里允许读取的字段白名单（Python 侧强制非空并逐个校验存在）。 */
  fieldRefs: string[];
  sortByRef?: string;
  order?: "asc" | "desc";
  limit?: number;
}

export interface FreeformNode {
  tag: string;
  style?: Record<string, string>;
  text?: string;
  iconRef?: string;
  imageRef?: "landing-hero";
  imageAlt?: string;
  dataRef?: FreeformDataRef;
  chart?: FreeformChartSpec;
  rowsRef?: FreeformRowsRef;
  /** 取当前行的字段值——只在 rowsRef 子树内有意义。 */
  fieldRef?: string;
  /**
   * 点了干什么（2026-08-13）。带了它的节点自动变可交互——**不加 `button`
   * 到标签白名单**：加了模型就能画出不带 actionRef 的死按钮，回到原点。
   * 而且这样整张卡片都能点，比只让角落那个按钮能点更有表达力。
   */
  actionRef?: FreeformActionRef;
  children?: FreeformNode[];
}

/** 受控动作：只管"打开哪个容器"，写入由组件完成（理由见 Python 侧同名契约）。
 *  kind **直接引用 html-binding-runtime 的 ActionKind**（2026-08-14 晚收拢）：
 *  之前这里手抄了一份联合类型，靠跨语言测试对齐——现在前端只有那一份词表，
 *  加词只改一处，这里自动跟着走。 */
export interface FreeformActionRef {
  kind: ActionKind;
  entityRef: string;
}

/**
 * 按**容器实际宽度**挑详情列数（2026-08-11）。
 *
 * ## 线上照出来的问题
 *
 * 详情面板里标签和值**直接叠在一起**——"所属班级"压住"特级班级"、"定制宠物"
 * 压住"称"。根因不是样式写错了，是判据用错了维度：
 *
 *     antd 的 `column={{ xs:1, sm:2, md:3, lg:3 }}` 看的是**视口**宽度
 *     而详情面板常待在右侧窄栏（aside 占 4/12，桌面下约 340px）
 *     视口是 lg/xl → 选 3 列 → 三对「标签+值」挤进 340px → 叠字
 *
 * 原注释写的是"写死列数在窄屏上标签和值会挤成一坨"，方向对，但换成视口断点只
 * 解决了"整个窗口窄"，没解决"容器窄而窗口宽"——而后者才是详情面板的常态。
 *
 * 区块拿不到自己在哪个区域（`ExperienceBlockInstance` 没有 region 字段），
 * 所以只能量容器本身。
 *
 * 阈值按"一对标签+值至少要 ~190px 才不换行"取：<380 一列、<640 两列，再宽才给
 * 到上限。ResizeObserver 缺席时（SSR / 老环境）回落一列——宁可稀疏，不要叠字。
 */
function useContainerColumns(max = 3): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [cols, setCols] = React.useState(1);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCols(w < 380 ? 1 : w < 640 ? Math.min(2, max) : max);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [max]);
  return [ref, cols];
}

export interface ExperienceBlockInstance {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  binding?: Record<string, unknown>;
  /** FreeformInsight 专用：二段生成回填的内容树（生成失败时区块已被整体
   * 摘掉，不会出现"有 block 没内容"的悬空态，这里仍按 optional 处理是
   * 防御性的，不代表这是正常态）。类型收窄成 FreeformNode 在渲染器内部做
   * （renderFreeformNode 本来就要逐节点跑白名单校验，不能只在类型层面假装
   * 收窄过就信任内容）。 */
  freeformContent?: { root: Record<string, unknown> };
  _fromLegacy?: boolean;
  _legacyStat?: unknown;
  _legacyChart?: unknown;
  _legacyRanking?: unknown;
  _legacyFeed?: unknown;
}

/** Step 6 QuickActionPanel：已算好本页权限（permitted）+ 可读标签的候选按钮。 */
export interface QuickActionButtonSpec {
  id: string;
  label: string;
  permitted: boolean;
}

/** Step 6 FilterBar：本页过滤态——本地视图态，不进 STATE/RBAC/门禁。 */
export interface PageFilterState {
  enumFilters: Record<string, string | undefined>;
  dateRange?: [string, string] | null;
  /**
   * 多选筛选（TagFilterRow，2026-08-08）。空数组 = 这个维度不筛（"全部"）。
   *
   * 单独一条而不是把 enumFilters 的值改成数组：下拉筛选是**单选**、标签行是
   * **多选**，两种交互对"没选"的表示都不一样（undefined vs []），混成一个
   * 字段之后每个读它的地方都要先判类型。
   */
  enumMulti?: Record<string, string[]>;
  /**
   * 关键词（SearchBox，2026-08-08）。
   *
   * **与筛选并列的独立通道**——照 pro-components 的 ToolBar：搜索词住在
   * `counter.keyWords`，不进筛选表单的 values，所以「重置筛选」不会把用户
   * 刚敲的搜索词也清掉。这是两件事，用户也是当成两件事在用。
   */
  keyword?: string;
}

/**
 * 本页的行选择态 —— DataTable 勾选，BatchActionBar 读。
 *
 * 2026-08-08：跟 PageFilterState 同一套路（本地视图态，不进 STATE/RBAC/门禁）。
 * 单独拎出来是因为**批量操作栏没有选择态就是个空壳**——照 pro-components 的
 * `table/components/Alert`，它只在 selectedRowKeys 非空时才渲染。
 *
 * 这个项目刚踩过一次同类的坑：QuickActionPanel 第一行就是"没有 pageActions
 * 就返回 null"，而装配预览从来没传过，于是它一直渲染成空气、没人发现。所以
 * 这次先把数据通路接上，再建区块。
 */
export interface PageSelectionState {
  /** 被勾选的行 id。按实体分组——一页可能有不止一张表。 */
  rowIds: Record<string, string[]>;
}

/**
 * 一张表的列视图态 —— ColumnSettingPanel 改，DataTable 读。
 *
 * 2026-08-08 照 pro-components 的 ColumnSetting 建的（②批次 1）。它那边这些
 * 状态住在 TableContext 的 `columnsMap: Record<key, {show, fixed, order}>` 里；
 * 我们**按区块 id 存**，跟 ①b 的 targets 同一套路——一页可能有两张表，状态混
 * 在一起就是当初 filterState 串台的同一个 bug。
 *
 * 三样各存各的，而不是塞进一个 `Record<field, {...}>`：
 * 判断"这列被隐藏了吗"要遍历整表，而 `hidden.includes(f)` 一眼就懂。
 */
export interface BlockColumnState {
  /** 被取消勾选的字段 id。**存隐藏而不是存显示**——数据模型加字段时，
   *  新字段默认可见才是对的；存显示的话新字段会莫名其妙不出现。 */
  hidden: string[];
  /** 显式排过序的字段 id。只含被挪动过的，其余按原顺序补在后面。 */
  order: string[];
  /** 固定在左/右的列。不在表里就是不固定。 */
  fixed: Record<string, "left" | "right">;
}

/** 按区块 id 存的列视图态。key 是**目标表格区块的 id**，不是实体名。 */
export type PageColumnState = Record<string, BlockColumnState>;

/**
 * 当前聚焦的那条记录（2026-08-08，②批次 4）。key 是实体名，值是行 id。
 *
 * 详情页要回答的第一个问题是"这是哪一条"，而我们此前**根本没有这个概念**：
 * RecordDetail 的注释写着「运行时还没有选中态时用第一条」，一直用的就是第一条。
 * 关联单据表（照 pro-blocks 的 ProfileAdvanced）必须知道主记录是谁，否则它只能
 * 把整张表搬过来——那三张 Table 各是**属于这一单**的操作日志，不是全库的日志。
 *
 * 按实体分组，跟 selection.rowIds 同一套路：一页可能同时聚焦订单和客户各一条。
 */
export type PageFocusState = Record<string, string>;

export const EMPTY_COLUMN_STATE: BlockColumnState = { hidden: [], order: [], fixed: {} };

/** Step 6 FilterBar：可筛选的枚举字段及其取值选项（来自本页主实体）。 */
export interface FilterFieldOption {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

export interface ExperienceBlockRendererProps {
  block: ExperienceBlockInstance;
  /** Resolves trusted generated assets; never accepts a model-provided URL. */
  sessionId?: string;
  /** One-time self-review token; resolves only the trusted landing hero endpoint. */
  previewId?: string;
  children?: React.ReactNode;
  /** Step 5：区块事件触发动作时的回调（actionId, eventData）。 */
  onAction?: (actionId: string, eventData?: Record<string, unknown>) => void;
  /** Step 6 QuickActionPanel 专用：本页 navigate/createRecord 候选动作。 */
  pageActions?: QuickActionButtonSpec[];
  /** Step 6 FilterBar 专用：当前过滤态。 */
  filterState?: PageFilterState;
  /** Step 6 FilterBar 专用：本页可筛的枚举字段。 */
  filterFieldOptions?: FilterFieldOption[];
  /** Step 6 FilterBar 专用：本页可用的日期范围字段（无则不渲染日期筛选）。 */
  dateRangeField?: { id: string; label: string } | null;
  /** Step 6 FilterBar 专用：过滤态变更回调（局部合并）。 */
  onFilterChange?: (patch: Partial<PageFilterState>) => void;
  /** DataTable 勾选 / BatchActionBar 读：本页的行选择态。 */
  selection?: PageSelectionState;
  /** 行选择变更回调（DataTable 勾选、BatchActionBar 清空都走它）。 */
  onSelectionChange?: (entityRef: string, rowIds: string[]) => void;
  /** ColumnSettingPanel 改 / DataTable 读：按区块 id 存的列视图态。 */
  columnState?: PageColumnState;
  /** 列视图态变更回调。blockId 是**目标表格的 id**，不是面板自己的 id。 */
  onColumnStateChange?: (blockId: string, next: BlockColumnState) => void;
  /** ColumnSettingPanel 专用：目标表格当前的列（字段 id，按当前顺序）。
   *  不传的话面板不知道该列出什么——它自己不绑行数据。 */
  targetColumns?: string[];
  /** 当前聚焦的记录（实体名 → 行 id）。关联单据表靠它知道主记录是谁。 */
  focus?: PageFocusState;
  /**
   * 字段的**完整声明**（2026-08-08，阶段④）——表单族专用的那一道门。
   *
   * ## 为什么是"一个 prop"而不是再加一个 fieldFormatOf
   *
   * 上面已经有 fieldLabelOf / fieldTypeOf / enumOptionsOf 三个查询，全都从
   * **同一个字段对象**上摘一样东西下来。阶段④本来要加第四个（fieldFormatOf），
   * 加完立刻发现第五个也躲不掉：ref 字段要做下拉，得知道它指向哪张表
   * （`refEntityId`）。
   *
   * 这正是②阶段复盘钉下来的那个形状——**要找的不是重复代码，是"加一样东西
   * 得改几处"**。每加一个字段属性就加一个 prop、改两个宿主、补一条护栏，而
   * 漏了不报错。所以这里开一扇门：字段声明整个传进来，以后加属性零改动。
   *
   * 老的三个查询留着不动：表格/详情/图表那些渲染器只要标签或类型，没必要为
   * 了对称去动它们。**表单族走这扇门**，其余照旧。
   */
  fieldSchemaOf?: (
    entityRef: string,
    fieldId: string
  ) => AppFormFieldSchema | undefined;
  /** WorkflowTimeline 专用：整份 workflow 系统数据，chainRef 从这里解析节点/连线，
   * 不接受自由文案——Gate 已校验 chainRef 能在这里面查到（留空=主链路）。 */
  workflow?: WorkflowSection | null;
  /** FreeformInsight chart 节点专用：entityId → 运行时真实行数据，key 是否
   * 存在本身就是"这个实体是否真实存在"的校验（initRuntimeState 会给数据
   * 模型里每个真实实体建 key，哪怕值是空数组）。 */
  entityRows?: Record<string, RuntimeRow[]>;
  /** FreeformInsight chart 节点专用：身份主题的图表配色（2026-07-24）——
   * 之前图表颜色是 build-echarts-option.ts 写死的几个常量，跟侧边栏/按钮
   * 用的身份主题完全无关；现在传主题自己的 primary/charts，颜色才能跟壳
   * 统一。不传时 buildEchartsOption 落到它自己的默认值，不会崩。 */
  chartPalette?: { primary: string; categorical: readonly string[] };
  /**
   * FreeformInsight chart 节点专用：enum 字段的取值声明查询（2026-07-28）。
   * 页面图表的 options 在 schema 派生时就带上了，但 freeform 的 chart 节点
   * 是 LLM 现写的 `{entityRef, dimensionFieldId}`，手里没有字段定义——不给
   * 这个查询，环图图例就只能写取值 id（`refunded` / `unpaid`）。查不到返回
   * 空数组，图例回落原值。
   */
  enumOptionsOf?: EnumOptionsLookup;
  /** DataTable 专用：字段 id → 显示名，用于列头（2026-07-28）。 */
  fieldLabelOf?: FieldLabelLookup;
  /** 表单族专用：字段 id → 类型，决定出哪种控件（2026-08-07）。 */
  fieldTypeOf?: FieldTypeLookup;
  /**
   * 角色 id → 显示名（2026-08-11）。
   *
   * 线上截图里流程步骤条底下直接写着 `music_member` / `collection_curator`
   * ——**内部标识符漏到了终端用户界面上**。而 `roleLabels`（id → 中文名）
   * 早就存在（app-runtime-schema 就在建它，角色下拉框一直在用），只是从来
   * 没送到区块这一层。查不到就回落原值：宁可显示 id，也不显示空白。
   */
  roleLabelOf?: (roleId: string) => string | undefined;
}

export type ExperienceBlockRenderer =
  React.ComponentType<ExperienceBlockRendererProps>;

interface ExperienceBlockCatalogFile {
  version: number;
  /**
   * 页面区域目录 —— 键是区域名，值带中文名、摆在哪条带、以及它在
   * ant-design/pro-blocks 那 29 个真实页面里的出处。
   *
   * 2026-08-08 收编：此前区域语法只有 Python 有、前端手抄一份；现在两边同读
   * 这个文件。同时它取代了旧的 allowedSlots（五个名字实测只有两种行为）。
   */
  pageRegions: Record<string, { label: string; band: string; evidence: string }>;
  /** 范式语法：哪个范式有哪些区域、多重、必不必填、收哪类区块。 */
  pageArchetypes: Record<
    string,
    { label: string; when: string; pageOwnsMain?: boolean;
      regions: { key: string; why: string; weight: string; required: boolean;
                 accepts: string[]; maxBlocks: number }[] }
  >;
  pageRegionBands: string[];
  dataKinds: string[];
  eventTypes: string[];
  freeformAllowedTags: string[];
  freeformAllowedIconRefs: string[];
  /** 图标组件名形状正则（与 Python freeform_block.py 同源派生） */
  freeformIconNamePattern: string;
  /** 老 kebab 语义名 → Ant Design 组件名（与 Python 侧同源派生） */
  freeformLegacyIconAliases: Record<string, string>;
  freeformAllowedStyleProps: string[];
  blocks: ExperienceBlockCatalogEntry[];
}

export const EXPERIENCE_BLOCK_CATALOG =
  catalogJson as unknown as ExperienceBlockCatalogFile;

/**
 * 区块 type → family（data / filter / action / content），从目录派生。
 *
 * 跟 Python 侧的 `EXPERIENCE_BLOCK_FAMILY_BY_TYPE` 同源同名——两边读的是同一份
 * 目录 JSON，不许任何一边手抄一张表。
 *
 * 运行时靠它回答一个具体问题：**这一页的积木里有没有真的能展示行数据的**。
 * 没有的话（比如模型只声明了一个 MetricGrid），内置表格仍要补进版面，
 * 否则翻转默认之后整页就没东西看了。
 */
export const EXPERIENCE_BLOCK_CAPABILITY_BY_TYPE: Readonly<Record<string, string>> =
  Object.freeze(
    Object.fromEntries(
      EXPERIENCE_BLOCK_CATALOG.blocks.map(b => [
        b.type,
        (b as unknown as { capability?: string }).capability ?? "",
      ])
    )
  );

/**
 * 会把 **workflow 系统**画成步骤条的区块类型（2026-08-11）。
 *
 * 宿主用它回答一个具体问题：**这一页的积木里有没有已经画了流程的**。有的话
 * 向导页顶部那条内置步骤条就不能再画一遍——线上截图里同一页出现两条步骤条，
 * 上面那条还按声明序把「拒绝兑换」铺成正向第 4 步，两条各说一套。
 *
 * 两个成员，都是**读了 workflow 又自带步骤条**的：
 *
 *   WorkflowTimeline  节点/顺序/条件全来自 workflow，正身就是一条 Steps
 *   StepsForm         步骤**名**取自 `workflow.chains[].nodes`；而 antd-pro 的
 *                     `<StepsForm>` 顶上自带一条步骤条，所以它一出现，页面上就
 *                     已经有一条了（取不到链路时回落成"填写信息/确认提交"两步，
 *                     那条条也照样在）
 *
 * ⚠ 这张表是**手写的**——渲染器读没读一个 prop，运行时问不出来。防漂移靠护栏：
 * `__tests__/workflow-steps-single-source.test.ts` 扫本文件源码，把所有解构了
 * `workflow` 的渲染器名反查回 type，跟这张表逐项比对——多一个少一个都红。
 * 这条护栏不是事后补的：写这张表时我只填了 WorkflowTimeline，是它把 StepsForm
 * 揪出来的。
 *
 * 不用 capability 判：`chain` 只有 WorkflowTimeline 和 DeploymentWizard 两个，
 * 而 DeploymentWizard 画的是实体行不是 workflow，StepsForm 的 capability 又是
 * `form`——拿 capability 当判据两头都不对。
 *
 * 也**不是"凡渲染了 Steps 就算"**：目录里另有十几个区块用 Steps 表达自己那点
 * 行数据的进度（拣货扫描路径、制品来源验证……），画的不是这一页的流程，跟内置
 * 那条不构成重复。
 */
export const EXPERIENCE_BLOCK_TYPES_DRAWING_WORKFLOW: ReadonlySet<string> =
  Object.freeze(new Set(["WorkflowTimeline", "StepsForm"])) as ReadonlySet<string>;

export const EXPERIENCE_BLOCK_FAMILY_BY_TYPE: Readonly<Record<string, string>> =
  Object.freeze(
    Object.fromEntries(
      EXPERIENCE_BLOCK_CATALOG.blocks.map(b => [
        b.type,
        (b as unknown as { family?: string }).family ?? "",
      ])
    )
  );

// 本阶段先把现有页面内容包进可信边界；真实区块内容在第三阶段接入。
// 导出仅为 SSOT 对账：测试据此判定某个 rendererKey 登记的是真渲染器还是占位。
export const ExistingContentAdapter: ExperienceBlockRenderer = ({
  block,
  children,
}) =>
  children !== undefined && children !== null ? (
    <>{children}</>
  ) : (
    <div
      data-testid="pending-experience-block"
      className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500"
    >
      区块已登记，内容将在下一阶段接入：{block.type}
    </div>
  );

/**
 * Step 6：快捷操作面板——按钮来源是本页 pageActions 里 type 为
 * navigate/createRecord 的项（AppRuntimeScreen 已按当前角色算好 permitted）。
 *
 * 2026-08-07：**一个候选动作都没有时整块不渲染**（原来是画一张卡 + 一个
 * "暂无可用操作"的空态）。
 *
 * 原注释的理由是"如实显示，不假装有按钮"——返回 null 同样没有假装任何东西，
 * 而那张空卡是有代价的：实测首页上它占 115px，而它上面/下面还排着别的积木，
 * 一起把 KPI 挤出首屏。产品在别处已经表过同一个态：喂给设计 LLM 的 brief 里
 * 明说过逐行内容"只能画出表头+空表身，比留白还难看"，所以刻意不让 LLM 画
 * （freeform_block._monitor_overview_design_brief）。渲染端理应同一条纪律。
 *
 * ⚠️ 这不是把信息藏起来：区块的声明仍然在模型里、门禁照常能标它，
 * "这一页没有可用动作"这件事本身由"没有按钮"表达得很清楚，不需要再用
 * 一张卡去说一遍。真正需要解释"为什么没有"的场景（比如权限不足），走的是
 * 按钮 disabled + title 提示那条路，不是这里。
 */
/**
 * 列表变体两兄弟（2026-08-09，批次 6）。
 *
 * 搬的是 `ant-design/pro-blocks` 的 ListCardList 与 ListBasicList。
 *
 * ## 为什么表格之外还要两种
 *
 * 目录里此前只有 DataTable 一种"列出多条记录"的方式。表格的长处是**字段多、
 * 要对比**；但业务系统里另有两类列表，用表格画就很难看：
 *
 *     字段少、每条有图或大标题   → 卡片网格（商品、模板、应用）
 *     每条要说清「谁、什么、几个数」 → 标准列表行（项目、任务、成员）
 *
 * 这两个不是"表格的皮肤"，绑定形状就不一样：表格绑一串平等的列，这两个绑的是
 * **有主次的几个位置**（标题 / 描述 / 图 / 几个小数）。所以是两个区块，不是
 * DataTable 的两个 props。
 *
 * ## 共用的取值口
 *
 * 两个都要"按字段语义把一个值画出来"，跟表格单元格是同一件事，所以共用
 * `fieldSemantic` + `renderCell`——语义判定只有一处，表格里金额是 ¥ 千分位，
 * 卡片里也得是。
 */

/** 从一条行数据里按 fieldRef 取值并按语义画出来（与表格单元格同源）。 */
function cellOf(
  entityRef: string,
  fieldRef: string | undefined,
  row: RuntimeRow,
  rows: RuntimeRow[],
  fieldTypeOf: FieldTypeLookup | undefined,
  enumOptionsOf: EnumOptionsLookup | undefined,
  fieldSchemaOf?: (entityRef: string, fieldId: string) => AppFormFieldSchema | undefined
): React.ReactNode {
  if (!fieldRef) return null;
  const options = enumOptionsOf?.(entityRef, fieldRef) ?? [];
  const sample = rows.find(r => r.values?.[fieldRef] != null)?.values?.[fieldRef];
  const semantic = fieldSemantic(entityRef, fieldRef, sample, fieldTypeOf, options, fieldSchemaOf);
  return renderCell(semantic, row.values?.[fieldRef], options, fieldRef);
}

/** binding 上的单个字段引用（不存在就 undefined，不编）。 */
const fieldRefOf = (block: ExperienceBlockInstance, key: string): string | undefined => {
  const v = (block.binding as Record<string, unknown> | undefined)?.[key];
  const s = String(v ?? "").trim();
  return s || undefined;
};

/** binding 上的字段引用数组。 */
const fieldRefListOf = (block: ExperienceBlockInstance, key: string): string[] => {
  const v = (block.binding as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
};

const CardGridListRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  fieldTypeOf,
  enumOptionsOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="card-grid-list">
        <BlockEmpty hint="卡片网格未绑定到有效实体" />
      </BlockShell>
    );
  const titleRef = fieldRefOf(block, "titleFieldRef");
  if (!titleRef)
    return (
      <BlockShell block={block} title={title} testid="card-grid-list">
        {/* 没有标题字段就没有"一眼看到的那一行"。不拿第一个字段顶上——
            顶上去看着像做完了，实际上卡片主标题成了随机字段。 */}
        <BlockEmpty hint="还没声明卡片主标题字段（titleFieldRef）" />
      </BlockShell>
    );
  if (bound.rows.length === 0)
    return (
      <BlockShell block={block} title={title} testid="card-grid-list">
        <BlockEmpty hint="还没有记录" />
      </BlockShell>
    );

  const descRef = fieldRefOf(block, "descFieldRef");
  const imageRef = fieldRefOf(block, "imageFieldRef");
  const metaRefs = fieldRefListOf(block, "metaFieldRefs").slice(0, 3);
  const compact = block.props?.density === "compact";

  return (
    <BlockShell block={block} title={title} testid="card-grid-list">
      <List
        rowKey="id"
        dataSource={bound.rows}
        // 响应式列数照搬原版（xs1/sm2/md3/xl4）。这不是随便定的：卡片宽度低于
        // 220px 时标题就开始换行，那正是这几档断点在避免的。
        grid={{ gutter: 12, xs: 1, sm: 2, md: 3, lg: 3, xl: compact ? 4 : 3, xxl: 4 }}
        renderItem={row => (
          <List.Item>
            <Card
              hoverable
              size="small"
              data-testid="card-grid-item"
              onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}
              /**
               * 封面走 antd `Image`（2026-08-10 从裸 `<img>` 换过来）。
               *
               * 这个区块的定义里一直写着 `uses: [… "Image" …]`，渲染器里却是
               * 一个裸标签——声明和实现对不上，而且对不上的正好是那三样让
               * `Image` 成为正确选择的行为：点开看大图、加载占位、加载失败的
               * 兜底。卡片网格是拿来"看"的版式，封面加载失败时给一个碎图标，
               * 整片网格就花了。
               *
               * `alt` 用卡片主标题，不再是空串——空 alt 的意思是"这张图纯装饰"，
               * 而这里的图是这张卡片在讲的那件东西。
               *
               * 预览的点击要 `stopPropagation`：外层 Card 的 onClick 是"选中这
               * 条记录"，不拦住的话点图片会既放大又跳走。
               */
              cover={
                imageRef && String(row.values?.[imageRef] ?? "").trim() ? (
                  <div onClick={e => e.stopPropagation()}>
                    <Image
                      alt={String(row.values?.[titleRef] ?? "")}
                      src={String(row.values[imageRef])}
                      width="100%"
                      height={96}
                      style={{ objectFit: "cover" }}
                      placeholder
                      preview={{ mask: "查看大图" }}
                    />
                  </div>
                ) : undefined
              }
            >
              <Card.Meta
                title={cellOf(bound.entityRef, titleRef, row, bound.rows, fieldTypeOf, enumOptionsOf)}
                description={
                  descRef ? (
                    // 描述固定 3 行省略 —— 原版就是这么定的。不定行数的话
                    // 一条长备注会把它那张卡撑到别人的两倍高，整片网格参差不齐。
                    <Typography.Paragraph
                      ellipsis={{ rows: 3 }}
                      type="secondary"
                      style={{ marginBottom: 0, fontSize: 12 }}
                    >
                      {String(row.values?.[descRef] ?? "")}
                    </Typography.Paragraph>
                  ) : undefined
                }
              />
              {metaRefs.length > 0 && (
                <Flex gap={12} wrap style={{ marginTop: 8 }}>
                  {metaRefs.map(f => (
                    <span key={f} style={{ fontSize: 11 }}>
                      <Typography.Text type="secondary">
                        {fieldLabelOf?.(bound.entityRef, f) ?? f}{" "}
                      </Typography.Text>
                      {cellOf(bound.entityRef, f, row, bound.rows, fieldTypeOf, enumOptionsOf)}
                    </span>
                  ))}
                </Flex>
              )}
            </Card>
          </List.Item>
        )}
      />
    </BlockShell>
  );
};

const StandardListRowsRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  fieldTypeOf,
  enumOptionsOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="standard-list-rows">
        <BlockEmpty hint="列表未绑定到有效实体" />
      </BlockShell>
    );
  const titleRef = fieldRefOf(block, "titleFieldRef");
  if (!titleRef)
    return (
      <BlockShell block={block} title={title} testid="standard-list-rows">
        <BlockEmpty hint="还没声明列表项的标题字段（titleFieldRef）" />
      </BlockShell>
    );
  if (bound.rows.length === 0)
    return (
      <BlockShell block={block} title={title} testid="standard-list-rows">
        <BlockEmpty hint="还没有记录" />
      </BlockShell>
    );

  const descRef = fieldRefOf(block, "descFieldRef");
  const avatarRef = fieldRefOf(block, "avatarFieldRef");
  const statRefs = fieldRefListOf(block, "statFieldRefs").slice(0, 2);
  const actions = (block.props?.actions ?? []) as string[];

  return (
    <BlockShell block={block} title={title} testid="standard-list-rows">
      <List
        rowKey="id"
        size="large"
        dataSource={bound.rows}
        renderItem={row => (
          <List.Item
            data-testid="standard-list-item"
            actions={actions.slice(0, 2).map(a => (
              <a
                key={a}
                onClick={e => {
                  e.stopPropagation();
                  onAction?.("itemSelect", {
                    entityRef: bound.entityRef,
                    rowId: row.id,
                    action: a,
                  });
                }}
              >
                {a}
              </a>
            ))}
            onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}
            style={{ cursor: "pointer" }}
          >
            <List.Item.Meta
              avatar={
                avatarRef ? (
                  <Avatar
                    shape="square"
                    size="large"
                    src={String(row.values?.[avatarRef] ?? "") || undefined}
                  >
                    {/* 没图就用标题首字兜底 —— 空头像框比没有头像更难看 */}
                    {String(row.values?.[titleRef] ?? "?").slice(0, 1)}
                  </Avatar>
                ) : undefined
              }
              title={cellOf(bound.entityRef, titleRef, row, bound.rows, fieldTypeOf, enumOptionsOf)}
              description={
                descRef ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {String(row.values?.[descRef] ?? "")}
                  </Typography.Text>
                ) : undefined
              }
            />
            {/* 右侧数值组：原版的 ListContent。标签在上、值在下，两组并排。 */}
            {statRefs.length > 0 && (
              <Flex gap={28} style={{ marginRight: 24 }}>
                {statRefs.map(f => (
                  <div key={f} style={{ minWidth: 72 }}>
                    <div style={{ fontSize: 11, color: INK.faint }}>
                      {fieldLabelOf?.(bound.entityRef, f) ?? f}
                    </div>
                    <div style={{ fontSize: 13 }}>
                      {cellOf(bound.entityRef, f, row, bound.rows, fieldTypeOf, enumOptionsOf)}
                    </div>
                  </div>
                ))}
              </Flex>
            )}
          </List.Item>
        )}
      />
    </BlockShell>
  );
};

const QuickActionPanelRenderer: ExperienceBlockRenderer = ({
  block,
  pageActions,
  onAction,
}) => {
  if ((pageActions ?? []).length === 0) return null;
  const title = String(block.props?.title ?? "").trim();
  const columnsRaw = Number(block.props?.columns);
  const columns =
    Number.isFinite(columnsRaw) && columnsRaw >= 1 && columnsRaw <= 4
      ? columnsRaw
      : 2;
  const actions = pageActions ?? [];
  return (
    <ProCard
      data-testid="quick-action-panel"
      size="small"
      title={title || undefined}
      bordered
    >
      {actions.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用操作" />
      ) : (
        <Flex wrap gap="small">
          {actions.map(a => (
            <Button
              key={a.id}
              size="small"
              disabled={!a.permitted}
              title={a.permitted ? undefined : "当前角色无此操作权限"}
              onClick={() => onAction?.(a.id)}
              style={{ flex: `1 1 calc(${100 / columns}% - 8px)` }}
            >
              {a.label}
            </Button>
          ))}
        </Flex>
      )}
    </ProCard>
  );
};

/**
 * Step 6：筛选栏——枚举字段来自本页主实体（AppRuntimeScreen 已过滤出
 * 有选项的 enum 字段）；日期范围仅当 props.showDateRange===true 且本页主
 * 实体确有 date/datetime 字段时渲染。变更经 onFilterChange 合并进页面级
 * 过滤态，同页 Table/看板/日历同步生效（同实体行数据共用一份过滤）。
 */
/**
 * ── 关键词搜索 —— 照 pro-components 的 ListToolBar search 段（2026-08-08，②批次 3）──
 *
 * 源：`src/table/components/ListToolBar/index.tsx` + `ToolBar/index.tsx`
 *
 * 这是批次 1 判定「TableToolbar 不该建成区块」时留下的那个真缺口：ListToolBar
 * 的四段里，标题/操作是 PageHeader、设置是 ColumnSettingPanel、筛选是
 * FilterBar，**只有搜索我们一个都没有**。
 *
 * 搬到的一条判断，比控件本身值钱：**搜索词是与筛选并列的独立通道。**
 * ToolBar 里它住在 `counter.keyWords`，不进筛选表单的 values——所以点「重置」
 * 清筛选的时候，用户刚敲进去的搜索词不会跟着没了。这两件事在用户心里就是
 * 两件事，混成一个状态之后必然出"我只是想换个筛选，怎么搜索也没了"。
 */
const SearchBoxRenderer: ExperienceBlockRenderer = ({
  block,
  filterState,
  onFilterChange,
}) => {
  const title = String(block.props?.title ?? "").trim();
  const placeholder =
    String(block.props?.placeholder ?? "").trim() || "输入关键词搜索";
  const keyword = filterState?.keyword ?? "";
  return (
    <BlockShell block={block} title={title} testid="search-box">
      <Input.Search
        allowClear
        data-testid="search-box-input"
        placeholder={placeholder}
        defaultValue={keyword}
        style={{ maxWidth: 320 }}
        // 只在**回车/点搜索**时才收窄，不是每敲一个字就重算一次。
        // onSearch 在 allowClear 的叉号上也会触发（值为空串），所以"清空"
        // 走的是同一条路，不用另接 onChange。
        onSearch={value => onFilterChange?.({ keyword: value.trim() || undefined })}
      />
    </BlockShell>
  );
};

/**
 * ── 标签式筛选 —— 照 pro-blocks 的 StandardFormRow + TagSelect（2026-08-08，②批次 3）──
 *
 * 源：`ListSearchApplications/src/components/{StandardFormRow,TagSelect}/index.tsx`
 *
 * 跟 FilterBar 的区别不是长相，是**多选**。下拉一次只能挑一个值，标签行可以
 * 「分类挑三个、负责人挑两个」一起筛。所以它不是 FilterBar 的一个 layout
 * 开关——筛选态的形状都不一样（`string | undefined` vs `string[]`）。
 *
 * 三条从它那儿抄的：
 *
 * 1. **一行一个维度，左边一个固定宽度的标题**（StandardFormRow 的 label/content
 *    两栏）。几行标题左对齐，扫一眼就知道有几个维度可筛。
 * 2. **「全部」本身是一颗可勾的标签**，不是一个额外的清除按钮。勾上=全选、
 *    取消=全不选，跟别的标签同一种手势。
 * 3. 取值多到一行放不下时可以展开。
 *
 * **第 3 条我们没照抄它的实现**：它的展开是 CSS `max-height: 32px → 200px`，
 * 而按钮只要 `expandable` 为真就永远显示——不判断实际有没有溢出。于是只有三个
 * 标签时也挂着一个「展开」，点了什么都不变。我们按标签数判：超过阈值才出按钮。
 */
const TAG_ROW_VISIBLE = 8;

const TagFilterRowRenderer: ExperienceBlockRenderer = ({
  block,
  filterState,
  filterFieldOptions,
  onFilterChange,
  fieldLabelOf,
}) => {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const title = String(block.props?.title ?? "").trim();
  const entityRef = String(block.binding?.entityRef ?? "").trim();
  const declared = (block.binding?.fieldRefs as string[] | undefined)?.map(String) ?? [];
  const byId = new Map((filterFieldOptions ?? []).map(f => [f.id, f]));
  const rows = declared.map(id => byId.get(id)).filter(Boolean) as FilterFieldOption[];
  if (rows.length === 0)
    return (
      <BlockShell block={block} title={title} testid="tag-filter-row">
        <BlockEmpty hint="没有可摊成标签行的枚举字段 —— fieldRefs 要指向有取值声明的枚举字段" />
      </BlockShell>
    );

  const multi = filterState?.enumMulti ?? {};
  const hideCheckAll = block.props?.hideCheckAll === true;
  const setPicked = (fieldId: string, next: string[]) =>
    onFilterChange?.({ enumMulti: { ...multi, [fieldId]: next } });

  return (
    <BlockShell block={block} title={title} testid="tag-filter-row">
      <Flex vertical gap={6}>
        {rows.map(row => {
          const picked = multi[row.id] ?? [];
          const values = row.options.map(o => o.value);
          // **全选的判据用"每个都在"，不是长度相等。** 它那边写的是
          // `getAllTags().length === value?.length`——筛选态里留着一个已经
          // 被删掉的取值时，长度照样相等，全选框就亮了。同一类坑在
          // ColumnSettingPanel 的半选分母上也踩过。
          const allChecked = values.length > 0 && values.every(v => picked.includes(v));
          const isOpen = expanded[row.id] === true;
          const overflow = row.options.length > TAG_ROW_VISIBLE;
          const shown = isOpen ? row.options : row.options.slice(0, TAG_ROW_VISIBLE);
          return (
            <Flex key={row.id} align="flex-start" gap={8} data-testid="tag-filter-dimension">
              {/* 左栏固定宽度：几行标题要左对齐，不然扫不出有几个维度 */}
              <span
                style={{ width: 72, flex: "0 0 72px", fontSize: 12, color: INK.label, lineHeight: "24px" }}
              >
                {fieldLabelOf?.(entityRef, row.id) ?? row.label}
              </span>
              <Flex wrap gap={4} style={{ flex: 1, minWidth: 0 }}>
                {!hideCheckAll && (
                  <Tag.CheckableTag
                    data-testid="tag-filter-all"
                    checked={allChecked}
                    onChange={checked => setPicked(row.id, checked ? values : [])}
                  >
                    全部
                  </Tag.CheckableTag>
                )}
                {shown.map(opt => (
                  <Tag.CheckableTag
                    key={opt.value}
                    data-testid="tag-filter-option"
                    checked={picked.includes(opt.value)}
                    onChange={checked =>
                      setPicked(
                        row.id,
                        checked
                          ? [...picked, opt.value]
                          : picked.filter(v => v !== opt.value)
                      )
                    }
                  >
                    {opt.label}
                  </Tag.CheckableTag>
                ))}
                {/* 真的放不下才出展开按钮 —— 它那边只要 expandable 就永远显示，
                    三个标签时也挂着一个点了没反应的「展开」 */}
                {overflow && (
                  <Button
                    size="small"
                    type="link"
                    data-testid="tag-filter-expand"
                    onClick={() => setExpanded(prev => ({ ...prev, [row.id]: !isOpen }))}
                  >
                    {isOpen ? "收起" : `展开（还有 ${row.options.length - TAG_ROW_VISIBLE} 个）`}
                  </Button>
                )}
              </Flex>
            </Flex>
          );
        })}
      </Flex>
    </BlockShell>
  );
};

const FilterBarRenderer: ExperienceBlockRenderer = ({
  block,
  filterState,
  filterFieldOptions,
  dateRangeField,
  onFilterChange,
}) => {
  const title = String(block.props?.title ?? "").trim();
  const showDateRange = block.props?.showDateRange === true && !!dateRangeField;
  const fields = filterFieldOptions ?? [];
  if (!showDateRange && fields.length === 0) {
    return (
      <ProCard data-testid="filter-bar-empty" size="small" bordered>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="本页无可筛选字段"
        />
      </ProCard>
    );
  }
  const enumFilters = filterState?.enumFilters ?? {};
  const dateRange = filterState?.dateRange ?? null;
  const initialValues: Record<string, unknown> = { ...enumFilters };
  if (showDateRange && dateRange) {
    initialValues.dateRange = dateRange.map(value => dayjs(value));
  }

  const applyValues = (values: Record<string, unknown>) => {
    const nextEnumFilters = Object.fromEntries(
      fields.map(field => [
        field.id,
        typeof values[field.id] === "string"
          ? (values[field.id] as string)
          : undefined,
      ])
    );
    const rawDateRange = values.dateRange;
    const nextDateRange =
      Array.isArray(rawDateRange) && rawDateRange.length === 2
        ? (rawDateRange.map(value => {
            if (typeof value === "string") return value.slice(0, 10);
            if (
              value &&
              typeof value === "object" &&
              "format" in value &&
              typeof value.format === "function"
            ) {
              return value.format("YYYY-MM-DD");
            }
            return "";
          }) as [string, string])
        : null;

    onFilterChange?.({
      enumFilters: nextEnumFilters,
      dateRange:
        nextDateRange?.[0] && nextDateRange[1] ? nextDateRange : null,
    });
  };

  const filterForm = (
    <QueryFilter
      data-testid="filter-bar"
      // 收起/展开（2026-08-08，②批次 3）。此前写死 false —— QueryFilter 的
      // 收起能力一直在，只是永远不生效。
      //
      // 它自己算得出该不该出收起按钮：needCollapseRender = 总栅格 >= 24 且
      // 控件数 > showLength，showLength = max(1, 24/span - 1)，减掉的那个 1
      // 是给「查询/重置」留的位置。一行几个由屏宽断点决定（576/768/992/
      // 1200/1600），窄屏还会从 horizontal 切成 vertical。这些都不用我们算。
      //
      // 默认展开：筛选条一般三五个字段，一进页面就收起来等于藏了功能。
      // 字段多的页面把 defaultCollapsed 打开。
      defaultCollapsed={block.props?.defaultCollapsed === true}
      // 收起了几个要写在按钮上，否则用户不知道后面还有没有东西
      showHiddenNum
      span={{ xs: 24, sm: 24, md: 12, lg: 12, xl: 8, xxl: 8 }}
      initialValues={initialValues}
      // ⚠ pro-components 的 onFinish 交出来的是 unknown（表单字段是运行时
      //   拼的，它本来就不知道形状）。这里收窄成一袋键值，跟 applyValues
      //   的入参契约对齐；不是掩盖问题，是把「表单值就是一袋键值」这句话
      //   写进类型。
      onFinish={async values => {
        applyValues((values ?? {}) as Record<string, unknown>);
        return true;
      }}
      onReset={() =>
        onFilterChange?.({
          enumFilters: Object.fromEntries(fields.map(field => [field.id, undefined])),
          dateRange: null,
        })
      }
    >
      {showDateRange && dateRangeField && (
        <ProFormDateRangePicker
          name="dateRange"
          label={dateRangeField.label}
          fieldProps={{ style: { width: "100%" } }}
        />
      )}
      {fields.map(f => (
        <ProFormSelect
          key={f.id}
          name={f.id}
          label={f.label}
          options={f.options}
          fieldProps={{ allowClear: true, style: { width: "100%" } }}
        />
      ))}
    </QueryFilter>
  );
  return title ? (
    <ProCard size="small" title={title} bordered bodyStyle={{ padding: 0 }}>
      {filterForm}
    </ProCard>
  ) : (
    filterForm
  );
};

/**
 * 横向连接的流程阶段条——节点/顺序/条件全部从 workflow 系统机械派生，
 * 不接受自由文案。props.chainRef 留空指主链路（workflow.nodes/transitions），
 * 填值时必须能在 workflow.chains 里查到（Gate 已校验，这里直接信）。
 */
const WorkflowTimelineRenderer: ExperienceBlockRenderer = ({ block, workflow, roleLabelOf }) => {
  const title = String(block.props?.title ?? "").trim();
  const chainRef = String(block.props?.chainRef ?? "").trim();
  const chain = chainRef
    ? workflow?.chains?.find(c => c.id === chainRef || c.name === chainRef)
    : undefined;
  const nodes = (chainRef ? chain?.nodes : workflow?.nodes) ?? [];
  const transitions = (chainRef ? chain?.transitions : workflow?.transitions) ?? [];

  if (!workflow || nodes.length === 0) {
    return (
      <ProCard data-testid="workflow-timeline-empty" size="small" bordered>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无可展示的流程节点"
        />
      </ProCard>
    );
  }

  /**
   * 主链路 / 分支出口的派生在 workflow-main-path.ts（那里写了为什么不能直接
   * `nodes.map` 铺 Steps）。**共用一份**是因为向导页的宿主骨架也要画同一份
   * workflow——两处各写一遍的时候，同一页上两条步骤条给出过两种说法。
   */
  const { mainPath, branchExits, advanceCondition } = deriveWorkflowMainPath(
    nodes,
    transitions
  );

  return (
    <ProCard
      data-testid="workflow-timeline"
      size="small"
      title={title || undefined}
      bordered
    >
      <Steps
        size="small"
        responsive
        current={-1}
        items={mainPath.map((node, index) => ({
          key: node.id || String(index),
          title: (
            <span data-testid="workflow-timeline-node">
              {node.name || node.id}
            </span>
          ),
          description: (
            <Flex vertical gap={2}>
              {node.assigneeRole && (
                <Typography.Text type="secondary">
                  {roleLabelOf?.(node.assigneeRole) || node.assigneeRole}
                </Typography.Text>
              )}
              {advanceCondition.get(String(node.id)) && (
                <Typography.Text type="secondary">
                  {advanceCondition.get(String(node.id))}
                </Typography.Text>
              )}
            </Flex>
          ),
        }))}
      />
      {branchExits.length > 0 && (
        <Flex
          vertical
          gap={2}
          style={{ marginTop: 10 }}
          data-testid="workflow-timeline-branches"
        >
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            分支出口（不在主流程顺序上）
          </Typography.Text>
          {branchExits.map(({ node, reasons }) => (
            <Typography.Text key={String(node.id)} type="warning" style={{ fontSize: 12 }}>
              {node.name || node.id}
              {reasons.length > 0 && `：${reasons.join(" / ")}`}
            </Typography.Text>
          ))}
        </Flex>
      )}
    </ProCard>
  );
};

/**
 * FreeformInsight（2026-07-23）安全渲染——只用 React.createElement 安全 API
 * 拼装，绝不 dangerouslySetInnerHTML/eval 任何 LLM 产出内容。白名单跟
 * Python 侧的 freeform_block.py 读同一份目录数据（@experience-blocks），
 * 改一处两边同步。这里是纵深防御的第二道：Python 已经用 Pydantic 深校验过
 * 才会落进 block.freeformContent，前端仍然过一遍白名单，不单方面信任上游。
 */
const FREEFORM_DANGEROUS_VALUE_RE = /url\(|javascript:|expression\(|import\b|@import/i;

/** lineHeight 不带单位时是字号的倍数（CSS 规范特例），不是像素值——真机
 * 逮到过 LLM 把它当像素写（比如给 28px 字号配 lineHeight: 32，本意是"行高
 * 32px"），结果渲染成 32 倍字号 = 896px 的行高，整行 KPI 卡被撑到 1000+px，
 * 后面的图表/列表全被挤出可视区域。Python 侧 freeform_block.py 的
 * check_style 已经在生成时拦这个模式，但持久化的历史产物/快照恢复不走那
 * 条校验，这里是渲染层的第二道防线：裸数字倍数超过这个阈值直接丢弃该
 * 属性（回退浏览器默认行高），不静默"纠正"成某个猜测值——安全，但不会
 * 把版式挤爆。 */
const LINE_HEIGHT_RATIO_MAX = 4;
const BARE_NUMBER_RE = /^-?\d+(\.\d+)?$/;

// 老的 kebab 语义名 → Ant Design 组件名（放开图标白名单之前用的 12 个，历史
// 生成产物里可能还有，保留兼容）。2026-07-26 起映射表不再在 TS 手抄——从
// 目录 JSON 派生（Python freeform_block.py 用同一份的键集合做校验），改目录
// 一处两端同步。新产物直接用 Ant Design 组件名（见 resolveFreeformIcon）。
const LEGACY_FREEFORM_ICONS: Record<string, string> =
  EXPERIENCE_BLOCK_CATALOG.freeformLegacyIconAliases;

// 合法的 Ant Design 图标组件名形状：PascalCase + Outlined/Filled/TwoTone 结尾。
// 这个正则同时是安全边界——只让"图标组件名"形状的字符串进来，挡掉
// @ant-design/icons 里那些非图标导出（createFromIconfontCN / getTwoToneColor
// 之类工具函数，它们不以这三个后缀结尾），也挡掉 __proto__/constructor 这类
// 原型链名字（首字符要求大写字母、且整体匹配）。定义在目录 JSON 里，与
// Python 侧 _ANTD_ICON_NAME_RE 同源派生。
export const FREEFORM_ICON_NAME_RE = new RegExp(
  EXPERIENCE_BLOCK_CATALOG.freeformIconNamePattern
);

/** iconRef → React 节点：老 kebab 别名走静态表，其余按 Ant Design 组件名
 * 动态解析。名字非法/在包里查不到（拼错、编造、非图标导出）一律返回 null，
 * 渲染成空、优雅降级——图标名永远只当组件名查表，从不被当代码执行。 */
function resolveFreeformIcon(iconRef: string | undefined): React.ReactNode {
  if (!iconRef) return null;
  // hasOwnProperty 保护：普通对象取键会落到原型链上（"__proto__" 会取到
  // Object.prototype、"constructor" 取到 Object），不 guard 的话这些名字会
  // 返回一个非 React 元素的对象、渲染时崩。别名表和命名空间取值都要 guard。
  let componentName = iconRef;
  if (Object.prototype.hasOwnProperty.call(LEGACY_FREEFORM_ICONS, iconRef)) {
    componentName = LEGACY_FREEFORM_ICONS[iconRef];
  }
  if (!FREEFORM_ICON_NAME_RE.test(componentName)) return null;
  if (!Object.prototype.hasOwnProperty.call(AntdIcons, componentName)) return null;
  const Cmp = (AntdIcons as Record<string, unknown>)[componentName];
  if (typeof Cmp !== "object" && typeof Cmp !== "function") return null;
  return React.createElement(Cmp as React.ComponentType);
}

function sanitizeFreeformStyle(
  style: Record<string, string> | undefined
): React.CSSProperties {
  const allowed = new Set(EXPERIENCE_BLOCK_CATALOG.freeformAllowedStyleProps);
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const [k, v] of Object.entries(style)) {
    if (!allowed.has(k)) continue;
    if (FREEFORM_DANGEROUS_VALUE_RE.test(String(v))) continue;
    if (k === "lineHeight" && BARE_NUMBER_RE.test(String(v)) && Number(v) > LINE_HEIGHT_RATIO_MAX) {
      continue; // 裸数字倍数离谱地大——多半是把像素值当倍数写，丢弃回退默认行高
    }
    if (k === "height") {
      // 设计模型写的 height 一律当 minHeight 用（2026-08-11）。
      //
      // ## 现场
      //
      // 线上生成的「邻里团长 / 邻里团享」首页，三张截图上都是同一个病：KPI 卡
      // 互相叠、环图压住下面的折线图、标题被盖掉一半、两个大数字浮在卡片上。
      //
      // 数一下那份设计树就清楚了：
      //     写死 height 的节点 17 个（136px / 260px / 200px / 40px …）
      //     用 minHeight 的      1 个
      //     用 overflow 的       0 个
      //
      // 设计 LLM **不知道内容实际会多高**——它没渲染过，只能照版式直觉写个数。
      // 内容比它高就溢出，而没有 overflow 就不裁剪，于是直接盖在下一块上。
      //
      // ## 为什么是当 minHeight 而不是丢弃
      //
      // 那个数字**不是垃圾**：它表达的是"这一块我想占这么高"，对齐、留白、
      // 视觉节奏都靠它。丢掉会让版面塌成一团。
      // 当成下限则两头都保住：想要的高度拿得到，内容更高时容器跟着长。
      //
      // ⚠ 这是渲染端的兜底，不是设计端的修复。真正的解法是让设计侧拿到高度
      // 预算（架构图「已知缺口」里记着这条）。在那之前，这里保证**不重叠**。
      // 只写 minHeight、**不写 height**：两个都写的话 height 仍然把盒子钉死，
      // 内容照样溢出（min-height 只是下限，管不住"内容比 height 高"这件事）。
      // 显式写了 minHeight 的，稍后循环走到那个键时会自然覆盖掉这里的值。
      if (!out.minHeight) out.minHeight = v;
      continue;
    }
    out[k] = v;
  }
  return out as React.CSSProperties;
}

const FREEFORM_CHART_TYPES = new Set(["bar", "line", "pie", "donut"]);

/** chart 节点二次校验（不单方面信任 Python 端 Pydantic 已经查过）：type
 * 在允许集合内、entityRef 在真实运行时行数据里存在这个 key（数据模型没有
 * 的实体，entityRows 里不会有这个 key）、dimensionFieldId 非空、metric 是
 * sum 时 metricFieldId 必须非空。任一条不满足就不渲染图表（不猜测、不
 * 崩溃），交回上层显示"内容生成中或暂不可用"同款诚实占位。 */
function renderFreeformChart(
  chart: FreeformChartSpec | undefined,
  entityRows: Record<string, RuntimeRow[]> | undefined,
  chartPalette: { primary: string; categorical: readonly string[] } | undefined,
  enumOptionsOf: EnumOptionsLookup | undefined,
  key: React.Key
): React.ReactNode {
  if (!chart || typeof chart !== "object") return null;
  if (!FREEFORM_CHART_TYPES.has(chart.type)) return null;
  if (!chart.entityRef || !entityRows || !(chart.entityRef in entityRows)) return null;
  if (!chart.dimensionFieldId) return null;
  if (chart.metric !== "count" && chart.metric !== "sum") return null;
  if (chart.metric === "sum" && !chart.metricFieldId) return null;

  const option = buildEchartsOption(
    {
      id: `freeform-chart-${key}`,
      label: chart.metricLabel || "",
      type: chart.type,
      entityId: chart.entityRef,
      dimensionFieldId: chart.dimensionFieldId,
      dimensionLabel: chart.dimensionFieldId,
      metric: chart.metric,
      metricFieldId: chart.metricFieldId,
      metricLabel: chart.metricLabel || "",
      // 维度是 enum 时，图例照声明的 label 显示，不写取值 id
      dimensionOptions: enumOptionsOf?.(chart.entityRef, chart.dimensionFieldId),
    },
    entityRows[chart.entityRef] ?? [],
    chartPalette
  );
  if (!option) {
    return (
      <div key={key} className="px-2 py-6 text-center text-xs text-stone-400">
        暂无数据 — 图表将在有真实记录后显示
      </div>
    );
  }
  return (
    <React.Suspense
      key={key}
      fallback={<div style={{ height: 200 }} className="animate-pulse bg-stone-50" />}
    >
      <LazyEchartsChart option={option} height={200} ariaLabel={chart.metricLabel} />
    </React.Suspense>
  );
}

/** rowsRef 单次取行上限——与 Python 侧 ROWS_REF_MAX_LIMIT 同值。
 *
 * Python 那边 Pydantic 已经夹过一次，这里是纵深防御第二道：持久化快照恢复
 * 走的是渲染这条路，不再过 Pydantic，老快照或手工改过的数据一样能进来。 */
export const ROWS_REF_MAX_LIMIT = 20;
export const ROWS_REF_DEFAULT_LIMIT = 5;

/**
 * rowsRef → 真实行数据（排序 + 截断）。
 *
 * 跟 computeDataRefText 同一套诚实原则：查不到实体就返回空数组，让上层如实
 * 显示空态，绝不编造占位行——"这一行看起来像真的但其实是假的"比空着更糟。
 */
function resolveRowsRef(
  rowsRef: FreeformRowsRef | undefined,
  entityRows: Record<string, RuntimeRow[]> | undefined
): RuntimeRow[] {
  if (!rowsRef || typeof rowsRef !== "object") return [];
  const rows = (entityRows ?? {})[rowsRef.entityRef];
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const limit = Math.max(
    1,
    Math.min(
      ROWS_REF_MAX_LIMIT,
      Number.isFinite(rowsRef.limit) ? Number(rowsRef.limit) : ROWS_REF_DEFAULT_LIMIT
    )
  );
  const sortBy = rowsRef.sortByRef;
  if (!sortBy) return rows.slice(0, limit);
  // 不给的字段/不可比的值一律沉底，保持排序稳定——排序键缺失时保持原顺序，
  // 不让"没有这个字段的行"随机跳到榜首。
  const dir = rowsRef.order === "asc" ? 1 : -1;
  const keyed = rows.map((row, i) => ({ row, i, v: row.values?.[sortBy] }));
  keyed.sort((a, b) => {
    const an = Number(a.v);
    const bn = Number(b.v);
    const aNum = Number.isFinite(an);
    const bNum = Number.isFinite(bn);
    if (aNum && bNum && an !== bn) return (an - bn) * dir;
    if (!aNum || !bNum) {
      const as = a.v == null ? "" : String(a.v);
      const bs = b.v == null ? "" : String(b.v);
      if (as !== bs) return as.localeCompare(bs, "zh-CN") * dir;
    }
    return a.i - b.i;
  });
  return keyed.slice(0, limit).map(k => k.row);
}

/** 一个单元格的显示值。空/不可读一律显「—」，跟 dataRef 算不出来时同一个记号。 */
function formatRowCell(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  const s = String(value);
  return s.trim() === "" ? "—" : s;
}

/** dataRef 聚合 → 真实数字（2026-07-24 修复真实撞到的坑）：dataRef 之前
 * 只在 Python 侧校验过"entityRef/字段是否真实存在"，从没真正驱动过显示
 * 内容——渲染的其实是 LLM 自己写的 text 字面量，"数字必须真实、不能编"
 * 这个贯穿全链路的承诺在渲染这最后一步从没兑现：校验通过不等于数字是真
 * 的，LLM 写死一个假数字、只要字段名对得上一样能过 Pydantic 校验。这里
 * 直接从 entityRows 现算，不信任 LLM 写的 text。
 *
 * 只在 aggregate 存在时接管——aggregate 为空表示"纯引用实体、不声称具体
 * 数值"（Python 侧允许省略），那种场景本来就没有"数字对不对"的问题，
 * 留给 text 自己处理。 */
function computeDataRefText(
  dataRef: FreeformDataRef | undefined,
  entityRows: Record<string, RuntimeRow[]> | undefined
): string | null {
  if (!dataRef?.aggregate) return null;
  const rows = (entityRows ?? {})[dataRef.entityRef];
  if (!rows) return null;
  if (dataRef.aggregate === "count") {
    return rows.length.toLocaleString("zh-CN");
  }
  const m = /^(sum|avg):(.+)$/.exec(dataRef.aggregate);
  if (!m) return null;
  const [, kind, fieldId] = m;
  const nums = rows
    .map(r => Number(r.values[fieldId]))
    .filter(v => Number.isFinite(v));
  // SQL/pandas 语义（SUM over 空集 = NULL；pandas sum(min_count=1) = NaN）：
  // 一行合法数值都没有时 sum 不能显 "0" 冒充真值——用户分不清"真的是 0"
  // 和"根本没数据"。sum/avg 统一：无合法数值 → null → 上层如实显「—」。
  if (nums.length === 0) return null;
  if (kind === "sum") {
    return nums
      .reduce((a, b) => a + b, 0)
      .toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return avg.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

/** 环比方向 → 颜色。用的是 antd 的状态色，跟 PageViews 的 TONE_COLORS 同一组。
 *
 * 按**方向**上色而不是按好坏——"涨了是不是好事"取决于这个指标是营收还是
 * 退款率，schema 里没有这个信息，我们也不该猜。参考图和 antd Statistic 文档
 * 都是这个做法（涨绿跌红），这是这类卡片的既定读法，不另发明一套。 */
const TREND_COLORS: Record<DataRefTrend["direction"], string> = {
  up: "#52c41a",
  down: "#ff4d4f",
  flat: "#8c8c8c",
};
const TREND_ARROWS: Record<DataRefTrend["direction"], string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

/**
 * KPI 数字的第二、三层：环比文案 + 迷你走势线（2026-07-29）。
 *
 * 形状对标 ant-design/pro-components 的 StatisticCard——Statistic 出
 * `trend: 'up' | 'down'` + `description`，StatisticCard 出 `chart` 槽位
 * （`chartPlacement: 'bottom'`）。参考图上每张 KPI 卡都是这三层，我们此前
 * 只有第一层，schema 也表达不了后两层。
 *
 * 字号/字重/行高**显式重置**：挂 dataRef 的那个节点通常自带 `fontSize: 32`
 * `fontWeight: 700`（它是大数字本体），环比小字若继承下来会变成第二个大数字。
 * 外层一律用 `display: block` 的 span：dataRef 节点可能是 `<span>`，往里塞
 * `<div>` 是非法嵌套。
 */
function renderDataRefTrend(
  dataRef: FreeformDataRef | undefined,
  entityRows: Record<string, RuntimeRow[]> | undefined,
  chartPalette: { primary: string; categorical: readonly string[] } | undefined
): React.ReactNode {
  if (!dataRef?.trendFieldRef) return null;
  const trend = computeDataRefTrend((entityRows ?? {})[dataRef.entityRef], dataRef);
  if (!trend) return null;
  const color = TREND_COLORS[trend.direction];
  const sparkOption = buildSparklineOption(trend.spark, chartPalette?.primary || "#1677ff");
  return (
    <span key="dataref-trend" data-testid="dataref-trend" style={{ display: "block" }}>
      <span
        data-testid="dataref-trend-delta"
        data-direction={trend.direction}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          marginTop: 4,
          fontSize: 12,
          fontWeight: 400,
          lineHeight: 1.4,
          letterSpacing: 0,
          color,
        }}
      >
        <span aria-hidden="true">{TREND_ARROWS[trend.direction]}</span>
        {formatTrendLabel(trend)}
      </span>
      {sparkOption ? (
        <span data-testid="dataref-sparkline" style={{ display: "block", marginTop: 6 }}>
          <React.Suspense fallback={<span style={{ display: "block", height: 32 }} />}>
            <LazyEchartsChart option={sparkOption} height={32} ariaLabel="走势" />
          </React.Suspense>
        </span>
      ) : null}
    </span>
  );
}

/** 不可信内容树的硬上限（micromark/cmark 同款纪律：解析不可信输入必须带
 * 嵌套/规模上限，超限截断降级，而不是任由深树把递归栈打爆、整个应用舞台
 * 白屏）。Python 生成侧 freeform_block.py 有同值的校验拦在 reask 环里；
 * 这里是纵深防御第二道——持久化快照恢复、历史产物同样走这条路径。 */
export const FREEFORM_MAX_DEPTH = 12;
export const FREEFORM_MAX_NODES = 300;

interface FreeformRenderBudget {
  remaining: number;
  truncated: boolean;
}

/**
 * 渲染 freeform 子树需要的全套上下文。
 *
 * 2026-07-29 从三个散参（entityRows / chartPalette / enumOptionsOf）改成一个
 * 对象：继续加散参会让这个函数的位置参数上到十个，漏传一个又是一次
 * "类型全绿、真跑没效果"（enumOptionsOf 刚这么栽过）。
 */
interface FreeformRenderCtx {
  /** 区块渲染 props（entityRows / chartPalette / enumOptionsOf 等都在里面） */
  blockProps: ExperienceBlockRendererProps;
  /**
   * 当前行——只在 rowsRef 展开出来的那棵子树里有值（2026-08-03）。
   * fieldRef 节点从这里取值；不在 rowsRef 内时是 undefined，fieldRef 渲染成
   * 「—」而不是崩掉（Python 侧已经拦过作用域外的 fieldRef，这里是第二道）。
   */
  row?: RuntimeRow;
  /** 当前行允许读取的字段白名单，同上，来自最近一层 rowsRef.fieldRefs。 */
  rowFields?: ReadonlySet<string>;
}

function renderFreeformNode(
  node: unknown,
  key: React.Key,
  ctx: FreeformRenderCtx,
  // 根节点记 depth=1（与 Python _freeform_tree_bounds 同一计法——两侧
  // 上限必须真同值，root=0 会让前端多放一层）。
  depth = 1,
  budget?: FreeformRenderBudget
): React.ReactNode {
  const { entityRows, chartPalette, enumOptionsOf } = ctx.blockProps;
  if (!node || typeof node !== "object") return null;
  if (!budget) budget = { remaining: FREEFORM_MAX_NODES, truncated: false };
  if (depth > FREEFORM_MAX_DEPTH || budget.remaining <= 0) {
    budget.truncated = true;
    return null;
  }
  budget.remaining -= 1;
  const n = node as FreeformNode;
  // blockRef 时代的存量节点：整个不渲染，**连位置也不占**（2026-08-04）。
  //
  // blockRef 通道在 rowsRef 上线时整条删掉了（schema + 渲染器），但**库里已经
  // 存着的模型没人管**——那些节点还在设计树里，带着自己的 style（flex:1 /
  // width:32%）却没有任何渲染器认领它，于是变成一块**撑着版面的空白**。
  // 真机长这样：绘本小站首页 KPI 行右边空掉三分之一、图表行右边又空掉一块，
  // 分别对应存量树里的 QuickActionPanel / WorkflowTimeline / ActivityFeed
  // 三个 children 为空的 blockRef 节点。
  //
  // 为什么在渲染端跳过而不是写迁移脚本改库：这跟 generatedTheme 那个字段是同一
  // 类问题（存量数据带着一个已经没有消费方的字段），仓库既有的处理方式就是
  // "读进来直接忽略，不需要迁移" —— 迁移脚本要跑、要回滚、还会在跑完之前留下
  // 一段新旧混杂的中间态，而这里想要的效果只是"当它不存在"。
  //
  // 判定条件带上 children 为空：blockRef 节点按当年的约定本来就不写 children
  // （积木接管那块区域）。万一有哪个节点既挂 blockRef 又有真实 children，
  // 那些 children 是真内容，不能跟着一起丢。
  if (
    (n as { blockRef?: unknown }).blockRef &&
    !(Array.isArray(n.children) && n.children.length > 0)
  ) {
    return null;
  }
  const allowedTags = new Set(EXPERIENCE_BLOCK_CATALOG.freeformAllowedTags);
  const tag = typeof n.tag === "string" && allowedTags.has(n.tag) ? n.tag : "div";
  // 图标不再查 catalog 白名单，改成按 Ant Design 组件名动态解析（老 kebab
  // 名走别名表）——放开图标集，非法/查不到的名字 resolveFreeformIcon 返回
  // null，渲染成空、优雅降级。
  const icon = resolveFreeformIcon(typeof n.iconRef === "string" ? n.iconRef : undefined);
  const chartNode = n.chart
    ? renderFreeformChart(n.chart, entityRows, chartPalette, enumOptionsOf, "chart")
    : null;
  // rowsRef：这个节点是列表容器，children 是**一行**的模板，按真实行数重复。
  // 展开发生在这里（渲染期）而不是设计树里——模板只写一次，所以设计树不会
  // 因为行数多而变大；重复出来的节点照样逐个扣 budget，行数再多也吃不穿预算。
  const rowsNode = (() => {
    if (!n.rowsRef) return null;
    const rows = resolveRowsRef(n.rowsRef, entityRows);
    // 一行都没有时如实空着，交给设计里自己写的空态文案/上层占位——绝不
    // 编造占位行冒充真实数据（同 computeDataRefText 的诚实原则）。
    if (rows.length === 0) return null;
    const template = Array.isArray(n.children) ? n.children : [];
    const fields: ReadonlySet<string> = new Set(
      Array.isArray(n.rowsRef.fieldRefs) ? n.rowsRef.fieldRefs : []
    );
    return rows.map((row, ri) =>
      template.map((child, ci) =>
        renderFreeformNode(
          child,
          `r${ri}-${ci}`,
          { ...ctx, row, rowFields: fields },
          depth + 1,
          budget
        )
      )
    );
  })();
  // chart / rowsRef 节点接管这块区域的内容，不再走普通 children 渲染（跟
  // Python 侧 prompt 的约定一致：挂了这两个字段的节点不自己另画一套）。
  //
  // ⚠ rowsRef 判定看的是**字段在不在**，不是 rowsNode 有没有值：一行数据都
  // 取不到时 rowsNode 是 null，若在这里 fall through 去渲染 children，等于把
  // "一行的模板"当普通内容画一遍——屏幕上出现一条所有字段都是「—」的行，
  // 看着像真有这么一条记录。那正是这次要消灭的东西，所以空数据时渲染成空。
  const children = chartNode
    ? []
    : n.rowsRef
      ? (rowsNode ?? [])
      : (Array.isArray(n.children) ? n.children : []).map((child, i) =>
          renderFreeformNode(child, i, ctx, depth + 1, budget)
        );
  // dataRef 声明了 aggregate 就是"这是个数字承诺"——现算不出来（实体在
  // entityRows 里查不到/avg 没有合法数值行）也不能退回 LLM 写的 text 掩盖
  // 过去，如实显示「—」，跟别处"暂无数据"占位是同一套诚实原则。
  const hasNumericClaim = Boolean(n.dataRef?.aggregate);
  const dataRefText = hasNumericClaim
    ? (computeDataRefText(n.dataRef, entityRows) ?? "—")
    : null;
  // 环比/走势线只在数字真算出来时才挂：主数字都是「—」还配一条走势线，
  // 等于用图形给一个不存在的数字背书。
  const trendNode =
    dataRefText && dataRefText !== "—"
      ? renderDataRefTrend(n.dataRef, entityRows, chartPalette)
      : null;
  // fieldRef → 当前行的真实字段值。跟 dataRefText 同一个位置、同一套纪律：
  // 取不到就是「—」，不回落 LLM 写的 text 假装有值。
  //
  // 白名单在这里再查一遍（Python 侧 FreeformDesign 已经拦过一次）：快照恢复
  // 走渲染这条路，不再过 Pydantic，声明外的字段不能因为换了条路就读得到。
  const fieldRefText =
    typeof n.fieldRef === "string"
      ? ctx.row && ctx.rowFields?.has(n.fieldRef)
        ? formatRowCell(ctx.row.values?.[n.fieldRef])
        : "—"
      : null;
  const landingHeroSrc =
    n.imageRef === "landing-hero"
      ? ctx.blockProps.previewId
        ? `/api/sliderule/freeform-preview/${encodeURIComponent(ctx.blockProps.previewId)}/media/landing-hero`
        : ctx.blockProps.sessionId
          ? `/api/sliderule/sessions/${encodeURIComponent(ctx.blockProps.sessionId)}/preview?source=sheet`
          : null
      : null;
  const imageNode =
    landingHeroSrc ? (
      <img
        key="image"
        src={landingHeroSrc}
        alt={typeof n.imageAlt === "string" ? n.imageAlt : ""}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    ) : null;
  // actionRef → 接上那条一直闲置的 onAction（2026-08-13）。
  //
  // 管道本来就是通的：ExperienceBlockRendererProps 里有 onAction，所有渲染器
  // 都收得到，组件区块靠它干活。自由树这边此前调用次数是 0——不是线断了，
  // 是节点上没有可以接线的地方。补上 actionRef 之后这里才有东西可发。
  //
  // 三个 kind 对应页面侧三个**现成**的入口（pagePipes 的 openCreate /
  // openRecordById / openEdit），一个都不用新加。
  const action = n.actionRef;
  const onAction = ctx.blockProps.onAction;
  const rowId = ctx.row?.id;
  const actionProps: Record<string, unknown> = {};
  if (action && onAction) {
    const fire = () => {
      if (action.kind === "createRecord") {
        onAction("createRequest", { entityRef: action.entityRef });
        return;
      }
      // 其余 kind 都要当前行——Python 侧的树级校验已经保证它必然落在
      // rowsRef 子树内，这里再兜一次：拿不到行就不发，别发一个空事件。
      if (!rowId) return;
      // ⚠ 显式映射，不写三元：词表 2026-08-14 晚扩了转移三种，三元的
      //   else 分支会把新词误路由成「编辑」——点「提交审批」弹出编辑表单。
      //   键集用 ActionKind 钉死（satisfies）：词表再加词而这里漏配映射，
      //   编译期就报错，不用等运行时点了没反应才发现。
      const eventByKind = {
        openRecord: "viewRequest",
        editRecord: "editRequest",
        submitWorkflow: "submitRequest",
        approveWorkflow: "approveRequest",
        rejectWorkflow: "rejectRequest",
        // ⚠ 2026-09-13：键集从 `Exclude<ActionKind, "createRecord">` 收窄成
        //   再排除购物车四种。这不是把闸放松，是把它对准这条路真正负责的
        //   范围——`CART_ACTION_KINDS`（addToCart / adjustCartQty /
        //   clearCart / checkout）走的是**另一条路**：HTML 绑定运行时产出
        //   `BindingActionEvent`，由 `SlideRuleStudio.tsx` 消费；自由树的
        //   actionRef 从不负责它们。
        //
        //   原来没排除，于是词表 2026-08 扩了购物车之后这里一直编译不过
        //   （TS1360 + TS7053）。闸本身是对的、也确实抓到了漏配，但因为
        //   `pnpm run check` 整体红着、CI 第一步就挂，没人看见它在报警。
      } satisfies Record<
        Exclude<ActionKind, "createRecord" | CartActionKind>,
        string
      >;
      // ⚠ 查表故意按「键可能不在」来取：`action.kind` 是完整的 ActionKind
      //   （含购物车四种），而这张表按设计只覆盖记录/转移两类。下一行的兜底
      //   本来就是为这种情况写的，类型这里要说同一句话，不能假装穷尽。
      const event = (eventByKind as Record<string, string | undefined>)[
        action.kind
      ];
      if (!event) return; // 表里没有（购物车走绑定运行时那条路）或存量 JSON 带了认不出的词——不发比误发便宜
      onAction(event, { entityRef: action.entityRef, rowId });
    };
    Object.assign(actionProps, {
      role: "button",
      tabIndex: 0,
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        fire();
      },
      // 键盘可达：role="button" 之后不给键盘事件，等于给自己造一个
      // 无障碍缺陷（axe 会直接报）。
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          fire();
        }
      },
      style: { ...sanitizeFreeformStyle(n.style), cursor: "pointer" },
    });
  }

  return React.createElement(
    tag,
    { key, style: sanitizeFreeformStyle(n.style), ...actionProps },
    icon ? (
      <span
        key="icon"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "1em",
          height: "1em",
        }}
      >
        {icon}
      </span>
    ) : null,
    fieldRefText ?? dataRefText ?? (typeof n.text === "string" ? n.text : null),
    trendNode,
    imageNode,
    chartNode,
    ...children
  );
}

const FreeformInsightRenderer: ExperienceBlockRenderer = props => {
  const { block } = props;
  const root = block.freeformContent?.root;
  if (!root) {
    return (
      <div
        data-testid="freeform-insight-empty"
        className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-400"
      >
        洞察卡片：内容生成中或暂不可用
      </div>
    );
  }
  const budget: FreeformRenderBudget = {
    remaining: FREEFORM_MAX_NODES,
    truncated: false,
  };
  // 整包透传：嵌进来的积木要拿到跟 page.blocks 一模一样的 props，
  // 逐个列举等于每加一个 prop 就埋一次漏传（见 ExperienceBlockBoundary 那次）。
  const rendered = renderFreeformNode(root, "root", { blockProps: props }, 1, budget);
  return (
    <div data-testid="freeform-insight" className="overflow-hidden rounded">
      {rendered}
      {budget.truncated ? (
        <div
          data-testid="freeform-insight-truncated"
          className="px-3 py-1 text-[11px] text-stone-400"
        >
          内容超出安全渲染上限，已截断
        </div>
      ) : null}
    </div>
  );
};


// ── 五个数据区块的真渲染器（2026-07-28）─────────────────────────────
// 此前它们登记的是 ExistingContentAdapter：页面上画一个灰框写"下一阶段接入"。
//
// 共同纪律（三条都来自这套代码库既有的诚实降级传统）：
// 1. binding 已经过门禁校验，但运行时**再判一次**——门禁看的是模型声明，
//    这里拿到的是用户真写进去的行，两者可能对不上（迭代改了字段名、
//    那一列全是空的）。判不了就出诚实空态，不猜也不崩。
// 2. "没有数据"和"算不出来"要显示成不同的东西，不能都糊成 0 或 —。
// 3. 数字格式化一律交给 antd Statistic，不自己拼（参考 ProComponents 的
//    Statistic：它本身就是 antd Statistic 的薄包装，只加 icon/描述/趋势，
//    格式化从不自己写）。

/**
 * 区块外壳：统一标题与留白，让区块在槽位里排起来是一套东西。
 *
 * 用 antd Card 而不是手写 div（原来是
 * `rounded border border-stone-200 bg-white px-3 py-2`，本质就是个简陋版
 * Card）。换过来的实际收益不是"少写几行"，是三件手写版做不到的事：
 *
 * 1. **吃主题**。外层 ConfigProvider 把 colorPrimary 设成了这个应用的身份
 *    主题色，antd 组件自动跟随；手写的 stone-200/白底不认这套，于是琥珀色
 *    的咖啡应用里混着一堆中性灰卡片。
 * 2. **吃 algorithm**。深色/紧凑/高对比是通过 antd 的 theme algorithm 全局
 *    切的，手写色值在深色模式下就是一块白斑。
 * 3. 头部/描边/圆角/hover 跟页面里其余 antd 组件严丝合缝，不用手动对齐。
 */
/**
 * 区块外壳 —— **标题与操作区是这个区块自己的，卡片只是可选的表面**。
 *
 * ## 2026-08-08 为什么重做
 *
 * 用户的判断（原话）：「你把信息全绑在 card 上面了，这是不对的……你实际要把
 * 这些信息绑在组件上……你不可能每个外面都套一个 card。」
 *
 * 之前这个函数是一个 antd Card，标题走 Card 的 `title` 属性、右上角操作走
 * `extra`。后果是**信息由壳提供**：想去掉卡片，标题和「编辑」「共 N 条」
 * 这些就跟着一起没了。我上一轮的说法（"拆了就变成没标题的裸组件"）正是
 * 这个错误结构逼出来的。
 *
 * 现在拆成两件独立的事：
 *
 *   · 头部（标题 + 操作区）**由区块自己画**，是它 DOM 的一部分，
 *     跟外面有没有卡片无关
 *   · 表面（白底 + 内边距那层卡片）由 `props.surface` 决定，
 *     缺省 "card" —— 已生成的应用一个都不会变样
 *
 * ## 为什么留 surface 这个开关而不是直接删掉卡片
 *
 * 区块渲染在页卡里面时，白底叠白底确实多余；但它也会被摆在灰底网格上
 * （组装页、总览页），那时候没有白底就糊成一片。**这是排布决定的，不是
 * 区块决定的**，所以做成可切换，由组装方按位置选，默认保持今天的样子。
 *
 * 到三五百个组件之后这条更重要：卡片是 100 多种布局里的一种选择，
 * 不能是每个组件出厂就焊死的。
 */
function BlockShell({
  title,
  testid,
  extra,
  block,
  children,
}: {
  title?: string;
  testid: string;
  extra?: React.ReactNode;
  /** 传了就读 props.surface；不传等同于 "card"（老调用点无需改） */
  block?: ExperienceBlockInstance;
  children: React.ReactNode;
}) {
  const hasHeader = Boolean(title || extra);
  const plain = block?.props?.surface === "plain";

  // 头部：区块自己的 DOM。字号/间距照抄原先 Card title 的观感，
  // 这样默认档位下改完前后逐像素一致。
  const header = hasHeader ? (
    <div
      data-testid={`${testid}-header`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 38,
        padding: plain ? "0 0 8px" : "0 12px",
        borderBottom: plain ? "none" : "1px solid rgba(5,5,5,0.06)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{title}</span>
      {extra}
    </div>
  ) : null;

  const body = (
    <div style={{ padding: plain ? 0 : hasHeader ? 12 : 10 }}>{children}</div>
  );

  if (plain) {
    return (
      <div data-testid={testid} style={{ height: "100%" }}>
        {header}
        {body}
      </div>
    );
  }

  return (
    <Card
      data-testid={testid}
      size="small"
      // 注意：**不再走 Card 的 title/extra**。头部是上面那个 div，属于区块。
      styles={{ body: { padding: 0 } }}
      // 2026-07-28：去掉边框。区块常渲染在页卡里面，两层都画边框就是圆角套
      // 圆角——真跑截图上很扎眼。解法照 pro-components 的 ProCard `ghost`：
      // 卡片表面由最外层容器提供一次，内层只保留结构。这里比 ghost 保守一档
      // ——只去边框，留白底和内边距，区块之间仍有分块感。
      variant="borderless"
      style={{ height: "100%" }}
    >
      {header}
      {body}
    </Card>
  );
}

/**
 * 空态：说清楚"为什么没有"，不是一句冷冰冰的暂无数据。
 *
 * 用 antd Empty 拿到统一的插画与留白；description 仍然是我们自己写的那句
 * 具体原因——Empty 默认文案是「暂无数据」，正是这里最不该出现的话。
 */
function BlockEmpty({ hint }: { hint: string }) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      styles={{ image: { height: 40 } }}
      description={
        <span style={{ fontSize: 12, color: INK.faint }}>
          {hint}
        </span>
      }
    />
  );
}

/** binding 里取实体行；实体在运行时不存在（被迭代删掉等）时返回 null 而不是空数组，
 *  好让渲染器区分"这个实体没了"和"这个实体一条数据都没有"。 */
function rowsOfBinding(
  block: ExperienceBlockInstance,
  entityRows: Record<string, RuntimeRow[]> | undefined
): { entityRef: string; rows: RuntimeRow[] } | null {
  const entityRef = String(block.binding?.entityRef ?? "").trim();
  if (!entityRef || !entityRows || !(entityRef in entityRows)) return null;
  return { entityRef, rows: entityRows[entityRef] ?? [] };
}

/**
 * 涨跌的颜色 —— 照 pro-blocks 的 Trend（`components/Trend/index.less`）。
 *
 * 它把「方向」和「颜色」做成两个开关（`colorful` / `reverseColor`），因为
 * **有些指标下降才是好事**（退款率、故障数、投诉量）。我们这一版先只做默认
 * 那一档：涨红跌绿，中式财务口径。真遇到反向指标时再开 reverseColor，
 * 不提前造开关。
 */
const TREND_TONE: Record<"up" | "down" | "flat", string | undefined> = {
  up: "#cf1322",
  down: "#3f8600",
  flat: undefined,
};

/**
 * ── 指标卡 —— 照 pro-blocks 的 ChartCard 五槽（2026-08-08，②批次 2）──
 *
 * 源：`DashboardAnalysis/src/components/Charts/ChartCard/index.tsx`（97 行）
 *   + `components/IntroduceRow.tsx`（那四张卡的用法）
 *   + `components/Trend/index.tsx`（涨跌箭头）
 *
 * 它把一张指标卡拆成**五个槽**，这个拆法就是搬到的东西：
 *
 *     title    这是什么指标
 *     action   右上角那个「指标说明」的问号
 *     total    大数字（主角）
 *     children 卡中间那条迷你图（高度固定 46）
 *     footer   一行次要信息：环比、或者「日销售额 ￥12,423」
 *
 * 我们此前只有 total 一个槽——大数字孤零零一个，用户看不出它是涨是跌、
 * 也看不出这几天什么走势。环比和走势线的算法早就有了（dataref-trend.ts，
 * 当初是给 FreeformInsight 的 dataRef 做的），这次是把它接到指标卡上。
 *
 * 两条它踩过、我们照抄的坑：
 *
 * 1. **`0` 是有效值。** 它的 renderTotal 第一行是 `if (!total && total !== 0)
 *    return null` —— 那个 `&& total !== 0` 就是为这条加的。写成 `!total` 的话，
 *    「今日新增 0 单」这张卡会整个空掉，看起来像坏了。
 * 2. **内容区高度固定**（contentHeight=46）。一排四张卡，有的有迷你图有的
 *    只有文字，不固定高度就参差不齐——而这排卡是并列比较用的。
 */
const MetricGridRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  chartPalette,
  fieldLabelOf,
}) => {
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <StatisticCard title={title || undefined} data-testid="metric-grid">
        <BlockEmpty hint="指标未绑定到有效实体" />
      </StatisticCard>
    );
  const spec = parseAggregate(block.binding?.aggregate);
  const value = computeAggregate(bound.rows, spec);
  // 副标题写**中文字段名**，不是字段 id。同一条纪律在 DataTable 的列头、
  // ActivityFeed 的等级、RecordDetail 的枚举上都兑现过了，这里是最后一处漏网
  // ——对照台上一眼看得见：「合计 · amount」，而旁边表格的同一列写着「金额」。
  const label =
    spec.kind === "count"
      ? "记录数"
      : `${spec.kind === "sum" ? "合计" : "平均"} · ${
          (spec.fieldId && fieldLabelOf?.(bound.entityRef, spec.fieldId)) || spec.fieldId
        }`;

  // 环比 + 迷你走势线。算法复用 dataref-trend.ts —— 那边已经处理了本地时区、
  // 周一起周、桶数超限自动变粗、缺失桶补零这些真正容易错的事。
  const trend = computeDataRefTrend(bound.rows, {
    aggregate: block.binding?.aggregate as string | undefined,
    trendFieldRef: block.binding?.trendFieldRef as string | undefined,
    trendGrain: block.binding?.trendGrain as string | undefined,
  });
  const hint = String(block.props?.hint ?? "").trim();
  const footnote = String(block.props?.footnote ?? "").trim();
  // 走势线用应用主题色，不写死——同页别的图表都跟着主题走，这一条也得跟上
  const sparkOption = trend
    ? buildSparklineOption(trend.spark, chartPalette?.primary ?? "#1677ff")
    : null;

  return (
    <StatisticCard
      data-testid="metric-grid"
      title={title || undefined}
      // action 槽：右上角那个「指标说明」。没写说明就不出问号——一个点开
      // 什么都没有的问号比没有更糟。
      extra={
        hint ? (
          <Tooltip title={hint}>
            <span data-testid="metric-grid-hint" style={{ color: INK.faint, fontSize: 12 }}>
              <AntdIcons.InfoCircleOutlined />
            </span>
          </Tooltip>
        ) : undefined
      }
      statistic={{
        title: <span data-testid="metric-grid-item">{label}</span>,
        // **`0` 要显示成 0，不是「—」。** 用 `??` 而不是 `||`：后者会把 0
        // 一起判掉，这正是 ChartCard 那句 `!total && total !== 0` 防的事。
        value: value ?? "—",
        precision: value !== null && Number.isInteger(value) ? 0 : 1,
        description:
          value === null ? (
            <Typography.Text type="secondary">该字段暂无有效数值</Typography.Text>
          ) : undefined,
      }}
      // children 槽：迷你走势线。高度写死 46（照它的 contentHeight），一排卡
      // 才等高——有的有线有的没有的时候，不固定高度就参差不齐。
      chart={
        sparkOption ? (
          <React.Suspense fallback={<div style={{ height: 46 }} />}>
            <div data-testid="metric-grid-spark" style={{ height: 46 }}>
              <LazyEchartsChart
                option={sparkOption}
                height={46}
                ariaLabel={`${title || label}走势`}
              />
            </div>
          </React.Suspense>
        ) : undefined
      }
      chartPlacement="bottom"
      // footer 槽：环比在前、自定义脚注在后。两个都没有就整条不出——
      // 空的 footer 会让卡片底部多出一截无意义的留白。
      footer={
        trend || footnote ? (
          <Flex align="center" gap={12} style={{ fontSize: 12 }}>
            {trend ? (
              <span data-testid="metric-grid-delta" style={{ color: TREND_TONE[trend.direction] }}>
                {formatTrendLabel(trend)}
                {trend.direction === "up" ? (
                  <AntdIcons.CaretUpOutlined style={{ marginLeft: 2 }} />
                ) : trend.direction === "down" ? (
                  <AntdIcons.CaretDownOutlined style={{ marginLeft: 2 }} />
                ) : null}
              </span>
            ) : null}
            {footnote ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {footnote}
              </Typography.Text>
            ) : null}
          </Flex>
        ) : undefined
      }
      bodyStyle={{ height: "100%" }}
    />
  );
};

const TrendChartRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  chartPalette,
}) => {
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const timeField = String(block.binding?.timeDimensionRef ?? "").trim();
  if (!bound || !timeField)
    return (
      <BlockShell block={block} title={title} testid="trend-chart">
        <BlockEmpty hint="趋势未绑定到有效的时间字段" />
      </BlockShell>
    );
  const rawGrain = String(block.binding?.timeGrain ?? "day");
  const grain: TimeGrain =
    rawGrain === "week" || rawGrain === "month" ? rawGrain : "day";
  const series = buildTrendSeries(
    bound.rows,
    timeField,
    grain,
    parseAggregate(block.binding?.aggregate)
  );
  if (!series)
    return (
      <BlockShell block={block} title={title} testid="trend-chart">
        <BlockEmpty hint={`暂无数据 — 写入「${timeField}」后自动出图`} />
      </BlockShell>
    );
  const GRAIN_LABEL: Record<TimeGrain, string> = {
    day: "按天",
    week: "按周",
    month: "按月",
  };
  const option = {
    animation: false,
    tooltip: { confine: true, trigger: "axis" },
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    xAxis: {
      type: "category",
      data: series.categories,
      axisLabel: { fontSize: BLOCK_CHART_AXIS_FONT_SIZE, color: INK_HEX.faint },
    },
    yAxis: { type: "value", axisLabel: { fontSize: BLOCK_CHART_AXIS_FONT_SIZE, color: INK_HEX.faint } },
    series: [
      {
        type: "line",
        smooth: false,
        showSymbol: series.categories.length <= 20,
        data: series.values,
        itemStyle: { color: chartPalette?.primary ?? "#1677ff" },
        areaStyle: { opacity: 0.08 },
      },
    ],
  };
  return (
    <BlockShell block={block}
      title={title}
      testid="trend-chart"
      extra={
        <span className="text-[10px] text-stone-400" data-testid="trend-chart-grain">
          {GRAIN_LABEL[series.grain]}
          {/* 粒度是被自动放粗的就说出来，否则用户会以为自己声明的粒度生效了 */}
          {series.coarsened ? "（区间过长已自动放粗）" : ""}
        </span>
      }
    >
      <React.Suspense
        fallback={<div className="px-2 py-6 text-center text-xs text-stone-400">图表加载中…</div>}
      >
        <LazyEchartsChart option={option} height={160} ariaLabel={title || "趋势"} />
      </React.Suspense>
    </BlockShell>
  );
};

/**
 * ── 占比环图 —— 照 pro-blocks 的 ProportionSales（2026-08-08，②批次 2）──
 *
 * 源：`DashboardAnalysis/src/components/ProportionSales.tsx`（78 行）
 *
 * 我们此前没有任何"构成"形态的图：TrendChart 是时间轴，RankedList 是条形
 * 名次。"销售额按渠道各占多少"这类问题，用排行是答不好的——排行回答"谁最多"，
 * 占比回答"这块饼怎么分"。
 *
 * 三条从它那儿抄的判断：
 *
 * 1. **环图不是实心饼**（`innerRadius: 0.64`）。中间那块空白不是留白，是用来
 *    写总计的（它的 `statistic.title.content: '销售额'`）——总量和构成一起看
 *    才完整，只有构成的话用户还得自己把几瓣加起来。
 * 2. **关掉图例，改用带引线的标签**（`legend: false` + `label.type: 'spider'`，
 *    文案是 `名称: 数值`）。图例和扇区要靠颜色对应，扇区一多眼睛就对不上了；
 *    引线标签把名字直接写在那一瓣旁边。
 * 3. **渠道切换（全部/线上/门店）是卡片外面的事**，它放在 Card 的 `extra` 里。
 *    在我们的模型里那是 FilterBar / StatusTabs 的活，通过 targets 连过来，
 *    不进这个区块的契约。
 */
const ProportionPieRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  chartPalette,
  enumOptionsOf,
  fieldLabelOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const dimension = String(block.binding?.dimensionRef ?? "").trim();
  if (!bound || !dimension)
    return (
      <BlockShell block={block} title={title} testid="proportion-pie">
        <BlockEmpty hint="占比图未绑定到有效的分组维度" />
      </BlockShell>
    );
  // 复用已经在用的 donut option 构造器：它自带确定性配色、中心合计、
  // 以及**长尾自动折成「其他」**（foldForPie）。再写一份的话两处配色会分家，
  // 而且折叠阈值也会分成两个数。所以契约里没有 limit —— 那件事已经有人管了。
  const spec = parseAggregate(block.binding?.aggregate);
  const sumField = spec.kind === "sum" && spec.fieldId ? spec.fieldId : undefined;
  const option = buildEchartsOption(
    {
      id: block.id ?? "proportion",
      label: title,
      type: "donut",
      entityId: bound.entityRef,
      dimensionFieldId: dimension,
      dimensionLabel: fieldLabelOf?.(bound.entityRef, dimension) ?? dimension,
      // 只有 sum 能落到扇区面积上：avg 在占比图上没有意义（几个平均数加起来
      // 不等于总体平均），碰到 avg 就退回数条数，而不是画一张读起来像那么回事
      // 的错图。
      metric: sumField ? "sum" : "count",
      metricFieldId: sumField,
      // 中心那行小字：默认说清楚这堆数是什么，别让用户猜
      metricLabel:
        String(block.props?.totalLabel ?? "").trim() ||
        (sumField ? (fieldLabelOf?.(bound.entityRef, sumField) ?? sumField) : "数量"),
      dimensionOptions: enumOptionsOf?.(bound.entityRef, dimension) ?? [],
    },
    bound.rows,
    chartPalette
  );
  if (!option)
    return (
      <BlockShell block={block} title={title} testid="proportion-pie">
        <BlockEmpty hint={`暂无数据 — 写入「${dimension}」后自动出图`} />
      </BlockShell>
    );
  return (
    <BlockShell block={block} title={title} testid="proportion-pie">
      <React.Suspense
        fallback={<div className="px-2 py-6 text-center text-xs text-stone-400">图表加载中…</div>}
      >
        <LazyEchartsChart option={option} height={220} ariaLabel={title || "占比"} />
      </React.Suspense>
    </BlockShell>
  );
};

/**
 * 排行里一行的涨跌 —— 照 pro-blocks 的 Trend（文字 + 一个 Caret 箭头 + 颜色）。
 *
 * 值取不到数就整块不画，**不画一个 0%**：字段没填和"没有变化"是两回事，
 * 后者才该显示 0。
 */
function renderRankDelta(raw: unknown): React.ReactNode {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // 恰好 0 就不出箭头（方向不明），只写数——箭头是方向的表示，没方向别画
  const direction = n > 0 ? "up" : n < 0 ? "down" : "flat";
  return (
    <span
      data-testid="ranked-list-delta"
      style={{
        width: 52,
        textAlign: "right",
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
        color: TREND_TONE[direction],
      }}
    >
      {Math.abs(n)}%
      {direction === "up" ? (
        <AntdIcons.CaretUpOutlined style={{ marginLeft: 2 }} />
      ) : direction === "down" ? (
        <AntdIcons.CaretDownOutlined style={{ marginLeft: 2 }} />
      ) : null}
    </span>
  );
}

const RankedListRenderer: ExperienceBlockRenderer = ({ children, block, entityRows, onAction }) => {
  // 取当前生效的主题 token：区块要跟应用的身份主题同色，写死色值做不到
  const { token } = antdTheme.useToken();
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const sortField = String(block.binding?.sortByRef ?? "").trim();
  if (!bound || !sortField)
    return (
      <BlockShell block={block} title={title} testid="ranked-list">
        <BlockEmpty hint="排行未绑定到有效的数值字段" />
      </BlockShell>
    );
  const order = block.binding?.sortOrder === "asc" ? "asc" : "desc";
  const items = buildRankedRows(
    bound.rows,
    sortField,
    undefined,
    order,
    Number(block.binding?.limit ?? 5)
  );
  if (items.length === 0)
    return (
      <BlockShell block={block} title={title} testid="ranked-list">
        <BlockEmpty hint={`暂无数据 — 写入「${sortField}」后自动排名`} />
      </BlockShell>
    );
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
  /**
   * 每行的涨跌（2026-08-08，②批次 2，照 pro-blocks 的 TopSearch）。
   *
   * TopSearch 那张「线上热门搜索」表有一列「周涨幅」，带 ↑↓ 箭头。看源码才
   * 确认的一件事：那个涨幅**是数据自带的字段**（searchData 里的 `range`/
   * `status`），不是图表现算的。现算需要每一行各自的时间序列——那是另一个
   * 量级的事，而且业务系统里这类涨幅通常本来就存在库里。
   *
   * 所以 deltaFieldRef 指的是数据模型里已有的数值字段，我们只负责画箭头。
   */
  const deltaField = String(block.binding?.deltaFieldRef ?? "").trim();
  return (
    <BlockShell block={block} title={title} testid="ranked-list">
      <List
        size="small"
        split={false}
        dataSource={items}
        renderItem={(item, i) => (
          <List.Item
            data-testid="ranked-list-item"
            style={{ padding: "4px 0", cursor: onAction ? "pointer" : undefined }}
            onClick={() => onAction?.("itemSelect", { rowId: item.row.id })}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
              {/* 前三名用主题色实心徽标，其余中性——名次的强弱靠颜色区分，
                  但颜色取自 token，不再是写死的靛蓝（那会跟应用主题色打架） */}
              {/* 前三名用主题色，其余中性。
                  不能用 color="processing"——那是 antd 的固定语义蓝，不跟
                  colorPrimary 走；对照台上切成琥珀主题后名次标签仍然是蓝的。 */}
              <Tag
                color={i < 3 ? token.colorPrimary : undefined}
                style={{
                  marginInlineEnd: 0,
                  minWidth: 22,
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {i + 1}
              </Tag>
              <Typography.Text
                ellipsis={{ tooltip: item.label }}
                style={{ flex: 1, minWidth: 0, fontSize: 12 }}
              >
                {item.label}
              </Typography.Text>
              {/* 条形只是相对长度，真值仍然写在右边——只给条不给数看不出量级。
                  Progress 自带主题色与无障碍语义，比手写的 span 条强。 */}
              {/* strokeColor 必须显式给：Progress 在 percent>=100 时会自动切成
                  success 绿，于是排行第一名的条永远是绿的、其余是默认蓝，
                  跟应用主题色全无关系（对照台上一眼看得出）。 */}
              <Progress
                aria-label={`${item.label}相对排名进度`}
                percent={Math.round((Math.abs(item.value) / max) * 100)}
                showInfo={false}
                size={["small", 6]}
                strokeColor={token.colorPrimary}
                trailColor={token.colorFillSecondary}
                style={{ width: 72, marginBottom: 0 }}
              />
              <Typography.Text
                type="secondary"
                style={{
                  width: 52,
                  textAlign: "right",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Number.isInteger(item.value) ? item.value : item.value.toFixed(1)}
              </Typography.Text>
              {deltaField ? renderRankDelta(item.row.values?.[deltaField]) : null}
            </div>
          </List.Item>
        )}
      />
    </BlockShell>
  );
};

/**
 * 动态流的宽行档（2026-07-29）。
 *
 * 起因是拿参考图跟真实渲染对照：参考图把动态流画成一条满宽的信息行
 *（状态 | 单号 | 描述 | 关联单据 | 时间），真实渲染是一条窄时间轴，右边三分之二
 * 全空。宽度不是 bug——积木拿到的就是满宽，是时间轴这个形态本身撑不满。
 *
 * 用 **antd Table**，不是 List 里手拼 flex 行。前两版都是 flex（先 List.Item.Meta
 * 两层、后单行 flex 分栏），真跑截图上露了同一个馅：每行的状态标签宽度不一样
 *（待审核/烘焙中/已退回），后面几列的起点就**逐行错开**几像素，一眼能看出来歪。
 * flex 行没有跨行约束，每行各算各的宽度，对齐只能靠内容碰巧一样长。
 *
 * Table 靠 `<colgroup>` 从结构上解决：rc-table 的 ColGroup 按列发一个
 * `<col style={{width}}>`（es/ColGroup.js），所有行共享同一组列宽，对不齐这件事
 * 在这个方案里不可能发生。而且只要有一列声明 `ellipsis`，rc-table 就把
 * `tableLayout` 切到 `fixed`（es/Table.js:447-463），没写宽度的列均分剩余空间——
 * 正好是"明细列铺满整行"要的行为，不用自己算百分比。
 *
 * 列构成：状态点 | 单号+标签 | 明细列… | 时间，跟参考图那条 feed 行一一对应。
 * 中段明细由 binding.detailFieldRefs 声明——只加 variant 不加字段的话，宽行只是
 * 把同样三条信息摊开，比时间轴更空。
 */
function FeedRowList({
  items,
  entityRef,
  detailFields,
  levelDecl,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
}: {
  items: FeedItem[];
  entityRef: string;
  detailFields: string[];
  levelDecl: Map<string, NormalizedFieldOption> | null;
  onAction?: ExperienceBlockRendererProps["onAction"];
  fieldLabelOf?: FieldLabelLookup;
  enumOptionsOf?: EnumOptionsLookup;
}) {
  const { token } = antdTheme.useToken();
  // 明细列的枚举取值表一次建好：跟 DataTable 同一条纪律——同一份数据在别处
  // 显示「已冻结」，这里不能显示 `frozen`。
  const detailLabelOf = new Map(
    detailFields.map(f => [
      f,
      new Map((enumOptionsOf?.(entityRef, f) ?? []).map(o => [o.id, o.label])),
    ])
  );

  const columns: TableColumnsType<FeedItem> = [
    {
      key: "__tone",
      width: 20,
      render: (_, item) => {
        const decl = item.level ? levelDecl?.get(item.level) : undefined;
        // 时间轴的节点色在宽行里退化成一个小圆点：颜色语义（tone）保留，
        // 但不再画那条竖线——一行一行的表里画竖轴反而干扰阅读。
        return (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: toneDotColor(decl?.tone, token.colorPrimary),
            }}
          />
        );
      },
    },
    {
      key: "__title",
      width: 220,
      ellipsis: true,
      render: (_, item) => {
        const decl = item.level ? levelDecl?.get(item.level) : undefined;
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Typography.Text ellipsis={{ tooltip: item.title }} style={{ fontSize: 12 }}>
              {item.title}
            </Typography.Text>
            {item.level && (
              // 出声明里的 label（「可用」），不是取值 id（`available`）
              <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>{decl?.label ?? item.level}</Tag>
            )}
          </span>
        );
      },
    },
    // 明细列不给 width：table-layout:fixed 下没写宽度的列**均分剩余空间**，
    // 于是几列自然铺满整行，不用自己算百分比。
    ...detailFields.map(f => ({
      key: f,
      ellipsis: true,
      render: (_: unknown, item: FeedItem) => {
        const raw = String(item.row.values?.[f] ?? "").trim();
        if (!raw) return <Typography.Text type="secondary">—</Typography.Text>;
        const label = fieldLabelOf?.(entityRef, f) ?? f;
        const value = detailLabelOf.get(f)?.get(raw) ?? raw;
        // 值本身已经以字段名开头时不再重复标签——「使用生豆 使用生豆 1」读起来
        // 像口吃。演示种子数据正是这个形状（string/ref 字段的种子值就是
        // 「字段名 序号」），真实数据里也有「状态：状态待定」这类。
        const prefix = value.startsWith(label) ? "" : `${label} `;
        return (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {prefix}
            <Typography.Text style={{ fontSize: 11 }}>{value}</Typography.Text>
          </Typography.Text>
        );
      },
    })),
    {
      key: "__date",
      width: 92,
      align: "right" as const,
      render: (_: unknown, item: FeedItem) => (
        <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
          {item.dateKey}
        </Typography.Text>
      ),
    },
  ];

  return (
    <Table
      size="small"
      rowKey={item => item.row.id}
      // 动态流不是数据表：参考图上这块也没有表头，一行就是一条动态。列头交给
      // 单元格里那个灰色小标签（「出豆重量 136」），比一整条表头更轻。
      // showHeader=false 不影响 <colgroup>——rc-table 的 bodyColGroup 是独立
      // 渲染的（es/Table.js:583），列宽照样逐列对齐。
      showHeader={false}
      columns={columns}
      dataSource={items}
      pagination={false}
      onRow={item => ({
        onClick: () => onAction?.("itemSelect", { rowId: item.row.id }),
        style: { cursor: onAction ? "pointer" : undefined },
        // onRow 的返回值原样摊到 <tr> 上（rc-table GetComponentProps），
        // data-* 一并透传，测试和截图脚本靠它数行数
        "data-testid": "activity-feed-row",
      })}
      // 不给 scroll.x，理由同 DataTable：区块是页面里的一块，横向滚动条藏在
      // 卡片里没人会去拉。列共享可用宽度 + 省略号（带 tooltip）才对。
    />
  );
}

const ActivityFeedRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
}) => {
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const timeField = String(block.binding?.timeFieldRef ?? "").trim();
  if (!bound || !timeField)
    return (
      <BlockShell block={block} title={title} testid="activity-feed">
        <BlockEmpty hint="动态未绑定到有效的时间字段" />
      </BlockShell>
    );
  const levelField = String(block.binding?.levelFieldRef ?? "").trim() || undefined;
  const items = buildFeedRows(bound.rows, timeField, levelField);
  // 等级字段的取值声明：拿它把 `available` 显示成「可用」，并用声明里的 tone
  // 决定节点颜色。查不到就原样显示取值，不猜。
  const levelDecl = levelField
    ? new Map(
        (enumOptionsOf?.(bound.entityRef, levelField) ?? []).map(o => [o.id, o])
      )
    : null;
  if (items.length === 0)
    return (
      <BlockShell block={block} title={title} testid="activity-feed">
        <BlockEmpty hint={`暂无动态 — 写入「${timeField}」后按时间倒序展示`} />
      </BlockShell>
    );
  // 表现档位：宽行 vs 时间轴。未声明/写了个不认识的值一律回默认时间轴——
  // 档位是长相不是数据，认不出来时给个能看的形态，不能白屏。
  if (String(block.props?.variant ?? "").trim() === "row") {
    const detailFields = (
      Array.isArray(block.binding?.detailFieldRefs) ? block.binding.detailFieldRefs : []
    )
      .map(f => String(f ?? "").trim())
      // 运行时再判一次字段是否真的在行里（门禁看的是模型声明，这里拿到的是
      // 用户真写进去的行）；顺带排掉已经在标题/标签/时间位置露过面的字段，
      // 同一个值在一行里出现两次比不显示更糟。
      .filter(f => f && f !== timeField && f !== levelField)
      .filter(f => items.some(it => String(it.row.values?.[f] ?? "").trim() !== ""))
      .slice(0, 3);
    return (
      <BlockShell block={block} title={title} testid="activity-feed">
        <FeedRowList
          items={items}
          entityRef={bound.entityRef}
          detailFields={detailFields}
          levelDecl={levelDecl}
          onAction={onAction}
          fieldLabelOf={fieldLabelOf}
          enumOptionsOf={enumOptionsOf}
        />
      </BlockShell>
    );
  }
  return (
    <BlockShell block={block} title={title} testid="activity-feed">
      {/* 动态流就是 Timeline 的原型用法：一条时间轴串起按时间倒序的事件。
          手写版是"小圆点 + 两行字"，横向 90% 是空白、圆点还写死 #5b6cff，
          在琥珀色主题的应用里格外扎眼。Timeline 的轴线与节点都吃主题 token。 */}
      {/* Timeline 默认每项 padding-bottom:20px，8 条动态就有 480px 高，把总览页
          首屏吃光。收紧到 10px 后既保留时间轴的形态，密度又跟旧版相当。

          用**逐项 inline style**而不是 Tailwind 的 `[&_.ant-timeline-item]:pb-2.5`：
          试过了，不生效——antd v5 的 CSS-in-JS 在运行时往 head 注样式，
          跟 Tailwind 工具类同为 (0,2,0) 特异性，注入顺序又在后面，于是赢的
          是 antd。inline style 直接压过样式表，不用跟特异性较劲。 */}
      <Timeline
        style={{ marginTop: 4, marginBottom: 0 }}
        items={items.map((item, i) => {
          const decl = item.level ? levelDecl?.get(item.level) : undefined;
          return {
          // 最后一项去掉底部 padding，免得卡片底下空一截
          style: { paddingBottom: i === items.length - 1 ? 0 : 10 },
          key: item.row.id,
          // 用声明里的 tone 着色，把"这条是什么性质"直接画在轴上
          color: toneTimelineColor(decl?.tone),
          children: (
            <div
              data-testid="activity-feed-item"
              style={{ cursor: onAction ? "pointer" : undefined }}
              onClick={() => onAction?.("itemSelect", { rowId: item.row.id })}
            >
              {/* 标签紧跟在标题后面。第一版给标题加了 flex:1 又限了 maxWidth，
                  结果标签被推到 520px 那个边界上，孤零零飘在行中间——比原来
                  贴右边还怪。这里不给 flex，标题按内容宽度收缩（长了才省略），
                  标签自然紧随其后。 */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Typography.Text
                  ellipsis={{ tooltip: item.title }}
                  style={{ maxWidth: 320, fontSize: 12 }}
                >
                  {item.title}
                </Typography.Text>
                {item.level && (
                  // 出声明里的 label（「可用」），不是取值 id（`available`）
                  <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>
                    {decl?.label ?? item.level}
                  </Tag>
                )}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {item.dateKey}
              </Typography.Text>
            </div>
          ),
          };
        })}
      />
    </BlockShell>
  );
};

/**
 * 枚举 tone → Timeline 节点颜色。
 *
 * 第一版在这里写了个**关键词猜测器**（匹配「冻结/异常/warn/pending」之类），
 * 对照台一跑就露馅：枚举取值是 `available` / `frozen` 这种英文 id，中文规则
 * 一条都没命中，八个节点全是同一个颜色，等于白写。
 *
 * 真正的问题是不该猜——模型声明里每个枚举取值本来就带 `tone`
 *（success/processing/warning/danger/default，见 five_system_legal.json，
 * 而且门禁校验过）。同一份 tone 已经在驱动表格里的彩色标签，这里直接复用，
 * 颜色语义天然跟页面其它地方一致。
 */
function toneTimelineColor(tone: string | undefined): string {
  if (tone === "danger") return "red";
  if (tone === "warning") return "orange";
  if (tone === "success") return "green";
  // processing / default / 查不到 → 主题色（antd 的 "blue" 走 colorPrimary）
  return "blue";
}

/**
 * 同样的 tone，宽行档要的是**真 CSS 色值**。
 *
 * 不能直接复用 toneTimelineColor：那个返回的是 antd Timeline 的预设名
 *（"red"/"green"/"blue"），只有 Timeline 认得，塞进 background 是个非法值，
 * 圆点会渲染成透明。状态三色跟 PageViews 的 TONE_COLORS 同一组。
 *
 * processing/default 落到主题色，由调用方从 `theme.useToken()` 传进来——
 * 第一版写的是 `var(--sr-primary, #1677ff)`，那个变量**整个代码库里没人定义**
 * （连隔壁的 --sr-text-muted 也一直在吃 fallback），等于把"跟随主题"写成了
 * 永远的品牌蓝，在这次的墨绿主题里就是一个突兀的蓝点。
 */
function toneDotColor(tone: string | undefined, primary: string): string {
  if (tone === "danger") return "#ff4d4f";
  if (tone === "warning") return "#faad14";
  if (tone === "success") return "#52c41a";
  return primary;
}

/**
 * 页面头 —— 用户示范图顶上那一条（2026-08-08）。
 *
 * 「门店订单管理 / 管理门店订单、跟踪状态与处理进度 / 导出 · 新建订单」
 *
 * 此前一个都没有，所以生成的页面开头就是筛选条——用户进来看不到"这是什么
 * 页、我能干什么"。refine 的 Inferencer 里对应的是 <List> 那层壳（它自带
 * 标题与 CreateButton），@ant-design/pro-layout 里对应 PageContainer。
 *
 * 主动作用主按钮、次动作用普通按钮：一页只能有一个最主要的动作，两个都画成
 * 蓝色就等于没有主次——这跟区域权重是同一条道理，只是落在按钮上。
 */
const PageHeaderRenderer: ExperienceBlockRenderer = ({ block, onAction }) => {
  const title = String(block.props?.title ?? "").trim();
  const subtitle = String(block.props?.subtitle ?? "").trim();
  const primary = String(block.props?.primaryAction ?? "").trim();
  const secondary = String(block.props?.secondaryAction ?? "").trim();
  return (
    <div
      data-testid="page-header"
      style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: INK.value }}>{title || "未命名页面"}</div>
        {subtitle && (
          <div style={{ marginTop: 2, fontSize: 12, color: INK.label }}>{subtitle}</div>
        )}
      </div>
      <Space>
        {secondary && (
          <Button onClick={() => onAction?.("actionTrigger", { action: secondary })}>
            {secondary}
          </Button>
        )}
        {primary && (
          <Button type="primary" onClick={() => onAction?.("actionTrigger", { action: primary })}>
            {primary}
          </Button>
        )}
      </Space>
    </div>
  );
};

/**
 * 结果屏 —— 一次操作结束之后的那一页。
 *
 * ## 为什么补这个区块
 *
 * 2026-08-08 扒 `ant-design/pro-blocks` 的 29 个页面时发现：**7 页的主体是
 * `<Result>`**（403 / 404 / 500 / 提交成功 / 提交失败 / 注册结果 / 分步表单
 * 的最后一步），是那个库里最常见的一种页面形状，而我们一个都没有。
 *
 * 官方那两页的写法（ResultSuccess / ResultFail）是：
 *
 *     <Result status title subTitle extra={几个按钮}>
 *       {单据 Descriptions + 流程 Steps}
 *     </Result>
 *
 * 我们只画外面那层。里面那两样是 RecordDetail 和 WorkflowTimeline 的活，
 * 摆在 supplement 区里——**不在这儿重画一遍**。区块该是区域大小的一块，
 * 把三样东西焊死在一个区块里，等于回到"一个区块管一整页"。
 *
 * ## status 决定图标和颜色，不是装饰
 *
 * 成功给绿勾、失败给红叉、404 给插画。用户扫一眼要知道"成了没有"，这件事
 * 由图标承担；只有文字的话得读完标题才知道。所以 status 是必给的：漏了就
 * 退到 info（蓝色感叹号），那是"中性通知"，不会把失败伪装成成功。
 */
const ResultPanelRenderer: ExperienceBlockRenderer = ({ block, onAction }) => {
  const raw = String(block.props?.status ?? "").trim();
  const status = (
    ["success", "error", "info", "warning", "403", "404", "500"].includes(raw)
      ? raw
      : "info"
  ) as React.ComponentProps<typeof Result>["status"];
  const title = String(block.props?.title ?? "").trim();
  const subtitle = String(block.props?.subtitle ?? "").trim();
  const primary = String(block.props?.primaryAction ?? "").trim();
  const secondary = String(block.props?.secondaryAction ?? "").trim();

  return (
    <BlockShell block={block} title="" testid="result-panel">
      <Result
        status={status}
        title={title || "操作已完成"}
        subTitle={subtitle || undefined}
        // 结果屏本来就自带大量留白（图标 + 标题 + 副标题），外面那张卡再给
        // 一层内边距就空得离谱。这里压掉纵向的一半。
        style={{ padding: "24px 16px" }}
        extra={
          primary || secondary ? (
            <Space>
              {secondary && (
                <Button onClick={() => onAction?.("actionTrigger", { action: secondary })}>
                  {secondary}
                </Button>
              )}
              {primary && (
                <Button
                  type="primary"
                  onClick={() => onAction?.("actionTrigger", { action: primary })}
                >
                  {primary}
                </Button>
              )}
            </Space>
          ) : undefined
        }
      />
    </BlockShell>
  );
};

/**
 * 状态切换栏 —— 列表页顶上那排「全部 / 待办 / 进行中 / 已完成」。
 *
 * ## 出处
 *
 * `@ant-design/pro-components` 的 `ListToolBar.tabs`（契约是
 * `{activeKey, onChange, items:[{key, tab}]}`），配合 ProTable 时几乎是标配。
 * 用户给的那张门店订单参考图顶上就是这一排。
 *
 * ## 为什么它不是 FilterBar 的一部分
 *
 * 两者都在收窄同一批行，但**代价不同**：下拉筛选要点开、选、再点查询，是
 * 「我知道自己要找什么」时用的；状态页签一眼看得见全部选项和各自条数，是
 * 「让我先看看待办有几条」时用的。列表页里后者的使用频次高一个量级，所以它
 * 值得占页面顶上一整行，而不是折进筛选条里。
 *
 * ## 条数是真数出来的
 *
 * 每个页签后面的数字来自当前行数据，不是 props 里写死的。写死的话，用户删掉
 * 一条记录、页签还写着原来的数——那种不一致比不显示条数更糟。
 */
const StatusTabsRenderer: ExperienceBlockRenderer = ({
  block,
  entityRows,
  filterState,
  onFilterChange,
  fieldLabelOf,
  enumOptionsOf,
}) => {
  const bound = rowsOfBinding(block, entityRows);
  const field = String(block.binding?.statusField ?? "").trim();
  if (!bound || !field)
    return (
      <BlockShell block={block} title="" testid="status-tabs">
        <BlockEmpty hint="状态栏未绑定到实体的状态字段" />
      </BlockShell>
    );

  const options = enumOptionsOf?.(bound.entityRef, field) ?? [];
  if (options.length === 0)
    return (
      <BlockShell block={block} title="" testid="status-tabs">
        <BlockEmpty hint={`「${fieldLabelOf?.(bound.entityRef, field) ?? field}」不是枚举字段，没有状态可分`} />
      </BlockShell>
    );

  const countOf = (value?: string) =>
    value === undefined
      ? bound.rows.length
      : bound.rows.filter(r => String(r.values?.[field] ?? "") === value).length;

  const active = filterState?.enumFilters?.[field] ?? "";
  const items = [
    { key: "", label: `全部 ${countOf()}` },
    ...options.map(o => ({
      key: String(o.id),
      label: `${o.label} ${countOf(String(o.id))}`,
    })),
  ];

  return (
    <BlockShell block={block} title="" testid="status-tabs">
      <Tabs
        size="small"
        activeKey={active}
        items={items.map(i => ({ key: i.key, label: i.label }))}
        onChange={key =>
          onFilterChange?.({
            enumFilters: {
              ...(filterState?.enumFilters ?? {}),
              [field]: key || undefined,
            },
          })
        }
        // 只当导航用，不装内容 —— 内容是主体区那张表的事。
        tabBarStyle={{ marginBottom: 0 }}
      />
    </BlockShell>
  );
};

/**
 * 批量操作栏 —— 「已选择 N 项 · 清空 · 批量操作」。
 *
 * ## 出处
 *
 * `@ant-design/pro-components` 的 `table/components/Alert`。它的关键行为是
 * **选中为空时整条不渲染**（`selectedRowKeys.length < 1 && !alwaysShowAlert`
 * 直接 return null），只在真的选了东西之后才占位。
 *
 * ## 为什么先接数据通路再建这个区块
 *
 * 它依赖「选中了哪些行」。这个项目 2026-08-08 刚踩过同类的坑：
 * QuickActionPanel 第一行就是"没有 pageActions 就返回 null"，而装配预览从来
 * 没传过，于是它一直渲染成空气、没人发现——因为它总跟别的区块挤在一个区里，
 * 看不出少了谁。所以这次是先给 DataTable 接上 rowSelection、把选择态串通，
 * 再建这个区块。
 *
 * ## 未选中时显示什么
 *
 * 官方的判据是一行：`selectedRowKeys.length < 1 && !alwaysShowAlert` → 返回
 * null，整条消失。**它把"永远显示"做成了一个开关，而不是写死**——这是我们
 * 2026-08-08 回头补的那一条：原来我们把"永远显示一句引导"写死了，等于替使用
 * 者做了决定。
 *
 * 两边的默认值故意相反，理由也不同：
 *
 *   官方默认消失   —— 它是真实应用里表格上方的一条，没选中时消失最干净
 *   我们默认显示   —— 装配预览和组件库里，一个会凭空消失的区块没法审阅，
 *                     而"消失"和"坏了"长得一样
 *
 * 想要官方那种行为的，把 `props.alwaysShow` 设成 false。
 */
const BatchActionBarRenderer: ExperienceBlockRenderer = ({
  block,
  entityRows,
  selection,
  onSelectionChange,
  onAction,
}) => {
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title="" testid="batch-action-bar">
        <BlockEmpty hint="批量操作栏未绑定到有效实体" />
      </BlockShell>
    );

  const selected = selection?.rowIds?.[bound.entityRef] ?? [];
  const actions = Array.isArray(block.props?.actions)
    ? (block.props.actions as unknown[]).map(a => String(a)).filter(Boolean)
    : [];

  // 官方的 alwaysShowAlert，默认值反过来（见上面的说明）
  const alwaysShow = block.props?.alwaysShow !== false;
  if (selected.length === 0 && !alwaysShow) return null;

  return (
    <BlockShell block={block} title="" testid="batch-action-bar">
      {selected.length === 0 ? (
        <div
          data-testid="batch-action-bar-idle"
          style={{ fontSize: 12, color: INK.faint, padding: "6px 4px" }}
        >
          勾选左侧的行以批量处理
        </div>
      ) : (
        <Flex align="center" gap="small" wrap style={{ padding: "4px 0" }}>
          <span style={{ fontSize: 13, color: INK.value }}>
            已选择 <b data-testid="batch-selected-count">{selected.length}</b> 项
          </span>
          <Button
            size="small"
            type="link"
            onClick={() => onSelectionChange?.(bound.entityRef, [])}
          >
            清空
          </Button>
          <span style={{ flex: 1 }} />
          {actions.map(label => (
            <Button
              key={label}
              size="small"
              onClick={() =>
                onAction?.("actionTrigger", {
                  action: label,
                  entityRef: bound.entityRef,
                  rowIds: selected,
                })
              }
            >
              {label}
            </Button>
          ))}
        </Flex>
      )}
    </BlockShell>
  );
};

/**
 * ── 列设置 —— 照 ant-design/pro-components 的 ColumnSetting（2026-08-08，②批次 1）──
 *
 * 源：`src/table/components/ColumnSetting/index.tsx`（605 行）。
 *
 * 搬的**不是**它那几行 JSX——我们没有 TableContext、没有 Tree、状态形状也不同。
 * 搬的是它替我们踩过的四条边界，每一条我们自己写都会漏：
 *
 * 1. **半选的分母是"面板里真的列出来的列"，不是状态表全量。** 它的注释原文：
 *    "columnsMap 可能含有 hideInSetting 列或运行时被删掉的过期 key，导致分子与
 *    分母不对齐，indeterminate 计算出现偏差"。我们同样会有过期 id——数据模型
 *    改过字段之后，hidden 里躺着的名字已经不存在了。
 *
 * 2. **改了固定之后必须重排顺序。**（它的 issue #9556）固定分左/不固定/右三段，
 *    顺序号却是全局的；只改固定不重排，一个「固定在左」的列可以排在中间那段
 *    的后面，分组和顺序自相矛盾。
 *
 * 3. **重置要连顺序一起重置。**（它的 issue #9558）只把显示状态复位、留着旧的
 *    排序数组，下一次挪动仍然基于旧顺序算，用户看到的是"重置了个寂寞"。
 *
 * 4. **没有任何固定列时不显示分组标题。**（`showTitle={showLeft || showRight}`）
 *    否则一个孤零零的「不固定」标题挂在那，用户以为还有别的组没展开。
 *
 * 一条我们做得比它多的：**全部取消勾选**时它照样把一张没有列的表交给 antd
 * Table（渲染出一片空白表头）。我们在 DataTable 里给了空态和一句话，见那边。
 */

/** 固定分组的顺序 —— 左、不固定、右。这个顺序就是列在表上的先后。 */
const FIXED_GROUPS: Array<{ key: "left" | "none" | "right"; title: string }> = [
  { key: "left", title: "固定在左侧" },
  { key: "none", title: "不固定" },
  { key: "right", title: "固定在右侧" },
];

function groupOf(field: string, state: BlockColumnState): "left" | "none" | "right" {
  return state.fixed[field] ?? "none";
}

/**
 * 把列视图态套到字段列表上 —— DataTable 和 ColumnSettingPanel 共用这一份。
 *
 * 三步的**先后不能换**（这是上面第 2 条的落点）：
 *   ① 去掉隐藏的  ② 按显式顺序排  ③ 按固定分组归拢
 * 分组必须在排序之后、并且盖过排序，否则「固定在左」的列会排在中间那段后面。
 */
export function applyColumnState(fields: string[], state?: BlockColumnState): string[] {
  if (!state) return fields;
  const hidden = new Set(state.hidden);
  const visible = fields.filter(f => !hidden.has(f));
  const rank = new Map(state.order.map((f, i) => [f, i]));
  // 没排过序的排在后面，组内保持原有相对顺序（稳定排序）
  const ordered = visible
    .map((f, i) => ({ f, i, r: rank.has(f) ? rank.get(f)! : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map(x => x.f);
  return [
    ...ordered.filter(f => state.fixed[f] === "left"),
    ...ordered.filter(f => !state.fixed[f]),
    ...ordered.filter(f => state.fixed[f] === "right"),
  ];
}

const ColumnSettingPanelRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  columnState,
  onColumnStateChange,
  targetColumns,
  fieldLabelOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim() || "列设置";
  const entityRef = String(block.binding?.entityRef ?? "").trim();
  const targets = (block.binding?.targets as string[] | undefined) ?? [];
  const targetId = targets[0];

  if (!targetId || !targetColumns || targetColumns.length === 0) {
    return (
      <BlockShell block={block} title={title} testid="column-setting-panel">
        <BlockEmpty hint="没有连到任何表格 —— 列设置要先在 binding.targets 里说清楚它管哪一张" />
      </BlockShell>
    );
  }

  const state = columnState?.[targetId] ?? EMPTY_COLUMN_STATE;
  const push = (next: BlockColumnState) => onColumnStateChange?.(targetId, next);

  // **分母只数面板里真的列出来的列**（pro-components 的那条注释）。state.hidden
  // 里可能躺着数据模型改过之后已经不存在的字段名，把它们算进去，全选框会永远
  // 停在半选。
  const hiddenHere = targetColumns.filter(f => state.hidden.includes(f));
  const allChecked = hiddenHere.length === 0;
  const indeterminate = hiddenHere.length > 0 && hiddenHere.length < targetColumns.length;

  // 重置 = 回到**表格自己声明的那一份**（targetColumns 就是它，宿主按表格的
  // fieldRefs 算好传进来的），并且**顺序和固定一起清掉**——只复位显示状态是
  // pro-components 的 issue #9558。
  //
  // 面板自己不再声明 fieldRefs（2026-08-08 当天改掉的）。一开始给了它一份，
  // 浏览器里当场露馅：面板说默认 4 列、表格自己声明 10 列，两份默认互相矛盾，
  // 结果是什么都没动过、「重置」却是可点的。同一件事不能有两个出处——列由表格
  // 声明，面板只负责在运行时改它。pro-components 也是这么分的：它的重置读的是
  // 表格的 `columnsState.defaultValue`，不是设置面板另存一份。
  const resetTo: BlockColumnState = { hidden: [], order: [], fixed: {} };
  const isPristine =
    state.hidden.length === 0 &&
    state.order.length === 0 &&
    Object.keys(state.fixed).length === 0;

  /**
   * 顺序永远按**全部列**算，不受当前隐藏影响。
   *
   * 写这个块的时候自己踩的：一开始直接把 applyColumnState 的结果存进 order，
   * 而它返回的是"可见的那些"——于是藏掉一列、挪一下别的、再把它勾回来，那一
   * 列因为丢了名次会跳到最末尾。隐藏是"这次不看"，不该顺手改掉它的位置。
   */
  const orderedAll = (s: BlockColumnState) =>
    applyColumnState(targetColumns, { ...s, hidden: [] });

  const toggle = (field: string, checked: boolean) =>
    push({
      ...state,
      hidden: checked ? state.hidden.filter(f => f !== field) : [...state.hidden, field],
    });

  const setFixed = (field: string, fixed: "left" | "right" | undefined) => {
    if ((state.fixed[field] ?? undefined) === fixed) return; // 跟当前一致就别产生一次无意义更新
    const nextFixed = { ...state.fixed };
    if (fixed) nextFixed[field] = fixed;
    else delete nextFixed[field];
    // 改完固定重排一次顺序 —— pro-components 的 issue #9556。不重排的话，
    // 分组把这一列拎到最左边，它的顺序号却还留在中段，下一次挪动就乱套。
    const next = { ...state, fixed: nextFixed };
    push({ ...next, order: orderedAll(next) });
  };

  /** 组内上移/下移。跨组挪没有意义——先后由固定分组决定，不由顺序号决定。 */
  const move = (field: string, delta: -1 | 1) => {
    const current = orderedAll(state);
    const group = groupOf(field, state);
    const peers = current.filter(f => groupOf(f, state) === group);
    const at = peers.indexOf(field);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= peers.length) return;
    const reordered = [...peers];
    reordered.splice(at, 1);
    reordered.splice(to, 0, field);
    // 只重写这一组的位置，别的组原样留在自己的位置上
    let cursor = 0;
    const merged = current.map(f => (groupOf(f, state) === group ? reordered[cursor++] : f));
    push({ ...state, order: merged });
  };

  // 面板里**连隐藏的列一起列出来**（唯一能把它们勾回来的地方），而且按它们
  // 真实的位置排——不是把隐藏的一律甩到末尾。上移/下移算的也是这一份，
  // 两处不一致的话按钮会挪走另一列。
  const rendered = orderedAll(state);
  const labelOf = (f: string) => fieldLabelOf?.(entityRef, f) ?? f;
  // 没有任何固定列时不出分组标题 —— 一个孤零零的「不固定」标题会让人以为
  // 还有别的组没展开（pro-components 的 showTitle={showLeft || showRight}）
  const anyFixed = targetColumns.some(f => state.fixed[f]);

  return (
    <BlockShell block={block}
      title={title}
      testid="column-setting-panel"
      extra={
        <Button
          size="small"
          type="link"
          disabled={isPristine}
          data-testid="column-setting-reset"
          onClick={() => push(resetTo)}
        >
          重置
        </Button>
      }
    >
      <Checkbox
        indeterminate={indeterminate}
        checked={allChecked}
        data-testid="column-setting-all"
        onChange={e =>
          push({ ...state, hidden: e.target.checked ? [] : [...targetColumns] })
        }
      >
        <span style={{ fontSize: 12 }}>
          列展示（{targetColumns.length - hiddenHere.length}/{targetColumns.length}）
        </span>
      </Checkbox>
      {FIXED_GROUPS.map(group => {
        const members = rendered.filter(f => groupOf(f, state) === group.key);
        if (members.length === 0) return null;
        return (
          <div key={group.key} style={{ marginTop: 8 }}>
            {anyFixed && (
              <div
                data-testid="column-setting-group-title"
                style={{ fontSize: 11, color: INK.faint, marginBottom: 2 }}
              >
                {group.title}
              </div>
            )}
            {members.map((f, i) => (
              <Flex key={f} align="center" gap={4} data-testid="column-setting-item">
                <Checkbox
                  checked={!state.hidden.includes(f)}
                  onChange={e => toggle(f, e.target.checked)}
                >
                  <span style={{ fontSize: 12 }}>{labelOf(f)}</span>
                </Checkbox>
                <span style={{ flex: 1 }} />
                <Tooltip title="上移">
                  <Button
                    size="small"
                    type="text"
                    disabled={i === 0}
                    data-testid="column-setting-up"
                    onClick={() => move(f, -1)}
                    icon={<AntdIcons.ArrowUpOutlined />}
                  />
                </Tooltip>
                <Tooltip title="下移">
                  <Button
                    size="small"
                    type="text"
                    disabled={i === members.length - 1}
                    data-testid="column-setting-down"
                    onClick={() => move(f, 1)}
                    icon={<AntdIcons.ArrowDownOutlined />}
                  />
                </Tooltip>
                <Tooltip title={group.key === "left" ? "取消固定" : "固定在左侧"}>
                  <Button
                    size="small"
                    type="text"
                    data-testid="column-setting-pin-left"
                    onClick={() => setFixed(f, group.key === "left" ? undefined : "left")}
                    // 左右固定用 PicLeft/PicRight（"内容靠左/靠右"），不用箭头——
                    // 同一行里再放两个箭头，跟上移下移分不开
                    icon={<AntdIcons.PicLeftOutlined />}
                  />
                </Tooltip>
                <Tooltip title={group.key === "right" ? "取消固定" : "固定在右侧"}>
                  <Button
                    size="small"
                    type="text"
                    data-testid="column-setting-pin-right"
                    onClick={() => setFixed(f, group.key === "right" ? undefined : "right")}
                    icon={<AntdIcons.PicRightOutlined />}
                  />
                </Tooltip>
              </Flex>
            ))}
          </div>
        );
      })}
    </BlockShell>
  );
};

/**
 * ── 字段渲染 —— 照 refinedev/refine 的 Inferencer 三层模型（2026-08-08）──
 *
 * ## 为什么重做
 *
 * 用户拿一张真实的「门店订单管理」页做示范，指出我们生成的表格差太远：
 * 状态该是彩色标签、金额该是 ¥428.00、时间该是完整时刻、末尾该有操作列、
 * 分页该带总数和跳页。而我此前**直接拿行数据的键当列**，没有语义、没有
 * 格式化、没有操作列——出来就是一张裸表。
 *
 * ## 抄的什么（packages/inferencer/src）
 *
 *   ① field-inferencers/     一条推断链，看 (key, value) 定字段语义。
 *                            date.ts 的判据很实在：key 匹配 /(_at|_on|At|On)$/
 *                            **且** dayjs 解析得通 **且** 含日期分隔符，三条
 *                            都满足才算 date。每条返回 {key, type, priority}，
 *                            priority 解冲突。
 *   ② inferencers/antd/list  每种语义配一个字段渲染器：
 *                            date→DateField / email→EmailField / url→UrlField /
 *                            boolean→BooleanField / relation→TagField
 *   ③ 表格自动追加操作列      EditButton / ShowButton / DeleteButton
 *
 * ## 我们比 refine 占一个便宜
 *
 * refine 只能从**值**去猜类型（所以才要那套正则和 dayjs 试解析）；我们的
 * 字段类型是数据模型里**声明**好的（string/number/date/enum/ref/text），
 * fieldTypeOf 直接查得到。所以推断链在这里退化成"声明优先、值兜底"：
 * 声明了就用声明的，没声明才按 refine 那套从值猜——那条兜底不能省，
 * 组件库对照台和遗留数据都可能没有字段声明。
 */

/**
 * 字段的展示语义。比数据类型更细：number 还要分金额与普通数字。
 *
 * 2026-08-08 从 7 种补到 13 种。补的六种（email / url / image / richtext /
 * boolean / relation）全部来自 refine 的 field-inferencers——不是想出来的，
 * 是照着它 13 个推断器逐个对的账。缺它们的后果很具体：邮箱不出 mailto、
 * 链接不可点、图片列印一串 URL、长文本把行高撑开。
 */
type FieldSemantic =
  | "money" | "number" | "boolean"
  | "percent" | "progress" | "score"
  | "date" | "datetime"
  | "email" | "url" | "image" | "richtext"
  | "enum" | "relation"
  | "text" | "id";

/** 名字里带这些词的数值列按金额显示。中英都收——生成的字段名两种都有。 */
const MONEY_HINT = /(amount|price|total|fee|cost|revenue|金额|价格|费用|总额)/i;
/** 名字里带这些词的字符串列按单号显示（等宽、不换行）。 */
const ID_HINT = /(^id$|_id$|code$|sku|no$|number$|单号|编号)/i;

// ── 值判据 —— 逐条抄自 refine 的 field-inferencers ────────────────────
// （/home/user/oss-blocks/refine/packages/inferencer/src/field-inferencers/）
//
// 抄正则而不是自己写，是因为这些边界情况人想不全：email 那条要处理引号包裹的
// local part 和 IP 字面量域名；url 那条要排掉 `a.-b` 这种；date 那条**三个条件
// 缺一不可**（见下）。
const EMAIL_RE =
  /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
const URL_RE = /^(https?|ftp):\/\/(-\.)?([^\s/?\.#-]+\.?)+(\/[^\s]*)?$/i;
const IMAGE_RE = /\.(gif|jpe?g|tiff?|png|webp|bmp|svg)$/i;
const RELATION_RE = /(-id|-ids|_id|_ids|Id|Ids|ID|IDs)(\[\])?$/;
const DATE_SUFFIX_RE = /(_at|_on|At|On|AT|ON)(\[\])?$/;
/**
 * 日期形状 —— **这一条我们比 refine 严，因为它那条有洞**。
 *
 * refine 的 dateInfer 展开之后是「有分隔符 且 dayjs 能解析」。实测
 * （node -e 跑 dayjs）：
 *
 *     dayjs("u-1").isValid()          → true，解析成 2001-01-01
 *     dayjs("SO-2026-001").isValid()  → true，解析成 2026-01-01
 *     dayjs("2").isValid()            → true，解析成 2001-02-01
 *
 * 也就是说在 refine 里，`owner_id: "u-1"` 和 `order_no: "SO-2026-001"` 都会被
 * 判成日期——而 date 的 priority(1) 还高于 relation(0)，它赢定了。这不是我们
 * 抄错，是它这条本身的缺口。
 *
 * 所以加一道形状闸：必须**以四位年份开头**，后面接分隔符和月日。真实业务里
 * 的日期长这样（我们的种子数据、用户给的参考图都是 `2026-08-06`），而单号、
 * 外键 id 不会。
 */
const DATE_SHAPE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([T ]\d{1,2}:\d{2}(:\d{2})?)?/;
const DATE_SEPARATORS = ["/", ":", "-", "."];
/** 超过这个长度按富文本处理（refine 的阈值）。 */
const RICHTEXT_MIN = 100;

/**
 * 定字段语义 —— **声明优先，值兜底**。
 *
 * ## 我们比 refine 占一个便宜
 *
 * refine 只能从**值**去猜（所以才要那套正则和 dayjs 试解析）；我们的字段类型
 * 是数据模型里**声明**好的，fieldTypeOf 直接查得到。所以推断链在这里退化成
 * "声明了就用声明的"，只有没声明时才走值判据——那条兜底不能省，组件库对照台
 * 和遗留数据都可能没有字段声明。
 *
 * ## 值兜底那一半用 refine 的**优先级**模型，不是先到先得
 *
 * 这是这次照着抄来的关键一条（`utilities/pick-inferred-field/`）：refine 让
 * **所有**推断器都跑，然后取 priority 最高的那个，而不是第一个命中的。
 *
 *     image    2   ← `avatar.png` 同时也是 url、也是 text
 *     email / url / date / richtext   1
 *     其余（number / boolean / relation / text）   0
 *
 * 先到先得会出错：`https://a.com/x.png` 按链序先撞上 url，就再也轮不到 image。
 */
function fieldSemantic(
  entityRef: string,
  fieldId: string,
  sample: unknown,
  fieldTypeOf?: FieldTypeLookup,
  options?: NormalizedFieldOption[],
  fieldSchemaOf?: (entityRef: string, fieldId: string) => AppFormFieldSchema | undefined
): FieldSemantic {
  // 字段 schema 里的 `format` 优先（2026-08-11）。
  //
  // ## 现场：同一个字段两种样子
  //
  //     页面自带表格   成团率 68%     ← 走 FieldValue → resolveValueType(读 format)
  //     DataTable 积木 成团率 63      ← 走这里 → 只看 type，format 根本没传进来
  //
  // 两张表挨着摆在同一个应用里，一个有百分号一个没有。而数据模型里
  // `completion_rate` 的 format **写着 percent**——声明是对的，是这条路读不到。
  //
  // ## 为什么不按名字猜（比如 /rate|率/ → percent）
  //
  // 因为**声明就在那儿**。仓库里 money 那一档是按名字猜的（MONEY_HINT），
  // 那是没有 format 可读时的历史做法；在有声明的情况下再去猜，等于把一个
  // 确定的事实换成一个启发式——今天已经因为"判据没挂在真相上"栽过好几次。
  //
  // 所以：拿得到 schema 就读 format，拿不到才落到下面的老判据。
  const schema = fieldSchemaOf?.(entityRef, fieldId);
  if (schema) {
    const byFormat = resolveValueType(schema);
    if (byFormat === "percent" || byFormat === "money" || byFormat === "progress" || byFormat === "score") {
      return byFormat as FieldSemantic;
    }
  }
  // **有枚举取值本身就是一种声明**，而且比 type 字段更直接：调用方能给出
  // id→label 的对照，就说明这一列是枚举。
  //
  // 2026-08-08 回归实测：只认 fieldTypeOf === "enum" 时，没传 fieldTypeOf 的
  // 调用方（对照台、老页面）枚举列会打印取值 id（`frozen` 而不是「已冻结」）
  // ——同一份数据在页面自带表格里是中文、在区块里是英文 id，坐在一起就露馅。
  if (options && options.length > 0) return "enum";

  const declared = fieldTypeOf?.(entityRef, fieldId);
  if (declared === "enum") return "enum";
  if (declared === "boolean") return "boolean";
  if (declared === "ref") return "relation";
  if (declared === "date") {
    // 值里带时刻就按时刻显示 —— 用户示范里「2025-08-06 14:28:32」这种
    const s = String(sample ?? "");
    return s.includes(":") || s.includes("T") ? "datetime" : "date";
  }
  if (declared === "number") return MONEY_HINT.test(fieldId) ? "money" : "number";
  if (declared === "string" || declared === "text") {
    // 声明成字符串**不代表没有更细的语义**：声明只说了"这是个字符串"，
    // 是不是邮箱/链接/图片得看值。所以这里不直接返回，落到下面的值判据。
    const byValue = inferByValue(fieldId, sample);
    if (byValue) return byValue;
    return ID_HINT.test(fieldId) ? "id" : "text";
  }

  // 完全没有声明：全靠值
  const byValue = inferByValue(fieldId, sample);
  if (byValue) return byValue;
  if (typeof sample === "number") return MONEY_HINT.test(fieldId) ? "money" : "number";
  if (typeof sample === "boolean") return "boolean";
  if (ID_HINT.test(fieldId)) return "id";
  return "text";
}

/**
 * 从值推语义 —— 照 refine 的优先级模型：**全跑一遍，取最高分**。
 *
 * 返回 null 表示"值里看不出更细的语义"，交回调用方按声明/名字兜底。
 */
function inferByValue(fieldId: string, sample: unknown): FieldSemantic | null {
  const hits: Array<{ semantic: FieldSemantic; priority: number }> = [];
  const str = typeof sample === "string" ? sample : "";

  if (str && IMAGE_RE.test(str)) hits.push({ semantic: "image", priority: 2 });
  if (str && EMAIL_RE.test(str)) hits.push({ semantic: "email", priority: 1 });
  if (str && URL_RE.test(str)) hits.push({ semantic: "url", priority: 1 });
  if (str.length > RICHTEXT_MIN) hits.push({ semantic: "richtext", priority: 1 });

  // 日期：refine 的两条（有分隔符 + dayjs 能解析）**再加一道形状闸**。
  //
  //   只看 key 后缀   → `create_at_count` 这种也被认成日期
  //   只看值能解析     → dayjs("2") 解析得通，"2" 就成了日期
  //   只看分隔符       → "a-b" 也有分隔符
  //   前三条都满足还不够 → "SO-2026-001" 全中，仍然不是日期（见 DATE_SHAPE_RE）
  const parseable = str !== "" && dayjs(str).isValid();
  const hasSeparator = DATE_SEPARATORS.some(sep => str.includes(sep));
  const looksLikeDate = DATE_SHAPE_RE.test(str);
  if (looksLikeDate && hasSeparator && parseable) {
    hits.push({ semantic: str.includes(":") ? "datetime" : "date", priority: 1 });
  }

  // 关联字段按**名字**判（refine 的 relationInfer 也是），值只要是标量或标量数组
  const scalar = typeof sample === "string" || typeof sample === "number";
  const scalarArray =
    Array.isArray(sample) && sample.every(v => typeof v === "string" || typeof v === "number");
  if (RELATION_RE.test(fieldId) && (scalar || scalarArray)) {
    hits.push({ semantic: "relation", priority: 0 });
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => b.priority - a.priority);
  return hits[0].semantic;
}

/**
 * 只给用例用的薄封装 —— fieldSemantic 的入参里有 entityRef 和 options 两个
 * 在语义判定里不参与的东西，用例每次都传 null 会把判据淹掉。
 */
export function fieldSemanticForTest(
  fieldId: string,
  sample: unknown,
  declared?: string
): string {
  return fieldSemantic("e", fieldId, sample, declared ? () => declared : undefined);
}

/** 枚举取值的色调 → antd Tag 的 color。空/未知一律不上色，不瞎猜。 */
const TONE_COLOR: Record<string, string | undefined> = {
  success: "success",
  processing: "processing",
  warning: "warning",
  danger: "error",
  default: undefined,
};

/** 长度不可控的单行语义 —— 表格列上要单行截断，不然会竖着折成一座塔。 */
const ELLIPSIS_SEMANTICS = new Set<FieldSemantic>(["text", "email", "url", "relation", "id"]);

/** 一个单元格怎么画 —— 每种语义一个渲染器（refine 的 ②）。 */
function renderCell(
  semantic: FieldSemantic,
  raw: unknown,
  options: NormalizedFieldOption[],
  /** 列名/字段名。只有 image 档用得上——给图片当替代文本，见那一档的说明。 */
  alt?: string
): React.ReactNode {
  const str = String(raw ?? "").trim();
  if (!str) return <Typography.Text type="secondary">—</Typography.Text>;

  switch (semantic) {
    case "enum": {
      // 出标签不出取值 id，并按 tone 上色。用户示范里「待处理」是橙的、
      // 「已完成」是绿的——那个颜色来自数据模型声明的 tone，不是我们编的。
      const opt = options.find(o => o.id === str);
      if (!opt) return str;
      const color = TONE_COLOR[opt.tone];
      return color ? <Tag color={color}>{opt.label}</Tag> : <Tag>{opt.label}</Tag>;
    }
    // 数值三档：声明里写了 format 才会走到这儿（见 fieldSemantic 头上那段）。
    // 认不出数字就原样回退——不编、不补零。
    case "percent": {
      const n = Number(raw);
      return Number.isFinite(n)
        ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{`${n}%`}</span>
        : <>{str}</>;
    }
    case "score": {
      const n = Number(raw);
      return Number.isFinite(n)
        ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{`${n} 分`}</span>
        : <>{str}</>;
    }
    case "progress": {
      const n = Number(raw);
      return Number.isFinite(n)
        ? <Progress percent={Math.max(0, Math.min(100, n))} size="small" style={{ maxWidth: 120, marginBottom: 0 }} />
        : <>{str}</>;
    }
    case "money": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return str;
      return (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          ¥{n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      );
    }
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return str;
      return (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString("zh-CN")}</span>
      );
    }
    case "datetime": {
      const d = dayjs(str);
      return d.isValid() ? d.format("YYYY-MM-DD HH:mm:ss") : str;
    }
    case "date": {
      const d = dayjs(str);
      return d.isValid() ? d.format("YYYY-MM-DD") : str;
    }
    case "id":
      return (
        <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{str}</span>
      );
    // ── 2026-08-08 补的六种。缺它们的后果都很具体：邮箱不能点、链接是死的、
    //    图片列印一串 URL、长文本把行高撑开、布尔列显示 "true"。
    case "boolean": {
      const yes = raw === true || str === "true" || str === "1" || str === "是";
      return <Tag color={yes ? "success" : undefined}>{yes ? "是" : "否"}</Tag>;
    }
    case "email":
      // 邮箱要能一键写信 —— 这是它区别于普通文本的**全部意义**
      return (
        <Typography.Link href={`mailto:${str}`} onClick={e => e.stopPropagation()}>
          {str}
        </Typography.Link>
      );
    case "url":
      // 新窗口打开：表格行本身多半是可点的（选中/查看），链接抢走点击会让
      // 用户以为自己点错了
      return (
        <Typography.Link
          href={str}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
        >
          {str}
        </Typography.Link>
      );
    case "image":
      /**
       * 缩略图走 antd `Image`（2026-08-10 从裸 `<img>` 换过来）。
       *
       * 固定高度那条理由没变——尺寸参差不齐时不给固定高度，一行高一行矮。
       * 换组件是因为**28 像素的图等于没给**：用户要看清楚只能另开一页。
       * `Image` 自带点开放大、加载占位、失败兜底，目录里那条的说明就是
       * 「带预览、加载占位与失败兜底的图片」——这正是这里缺的三样。
       *
       * 裸 `<img>` 的第二个代价是 `alt=""`：那是"这张图纯装饰"的意思，而
       * 表格里的图是内容。这个项目每次截图都跑 axe 扫描，空 alt 的内容图
       * 恰好是它扫不出来的那一类——它只查 alt 在不在，不查写得对不对。
       * 所以把列名传进来当 alt（「产品图」），没传才退回空串。
       */
      return (
        <Image
          src={str}
          alt={alt ?? ""}
          height={28}
          style={{ maxWidth: 64, objectFit: "cover", borderRadius: 4 }}
          placeholder
          preview={{ mask: "查看" }}
        />
      );
    case "richtext":
      // 长文本**不能整段铺进单元格**——一条 500 字的备注会把整行撑到半屏。
      // 截断 + tooltip 看全文，这是 x-render 的 tooltip widget 那条做法。
      return (
        <Typography.Text ellipsis={{ tooltip: str }} style={{ maxWidth: 240 }}>
          {str}
        </Typography.Text>
      );
    case "relation":
      // 关联字段展示的是被指向那条记录的标识，等宽不换行（同 id）
      return (
        <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {Array.isArray(raw) ? raw.join("、") : str}
        </span>
      );
    default:
      return str;
  }
}

const DataTableRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
  fieldSchemaOf,
  selection,
  onSelectionChange,
  columnState,
  focus,
}) => {
  // 遗留适配兜底：调用方塞了现成内容就照原样渲染（_fromLegacy 转换期的用法）。
  // 现行 renderBlock 不传 children，走下面的 binding 取数。
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  let bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="data-table">
        <BlockEmpty hint="表格未绑定到有效实体" />
      </BlockShell>
    );
  /**
   * 关联单据表（2026-08-08，②批次 4，照 pro-blocks 的 ProfileAdvanced）。
   *
   * 声明了 parentRef + viaFieldRef，这张表就只显示**属于当前那条主记录**的行。
   * ProfileAdvanced 详情页下面那三张 Table 各是属于这一单的操作日志，不是全库
   * 的日志——把整张表原样搬到详情页上是最容易犯的那个错，它长得很像"做完了"。
   *
   * 两个键要么都写要么都不写。只写一个是没说完的话，与其猜一个默认值，
   * 不如当作没声明——猜错的后果是悄悄给用户看了不属于这条记录的数据。
   */
  const parentRef = String(block.binding?.parentRef ?? "").trim();
  const viaFieldRef = String(block.binding?.viaFieldRef ?? "").trim();
  const isRelated = !!parentRef && !!viaFieldRef;
  const parentRowId = isRelated ? focus?.[parentRef] : undefined;
  if (isRelated && !parentRowId)
    return (
      <BlockShell block={block} title={title} testid="data-table">
        <BlockEmpty hint="先选中一条主记录 — 这张表只显示挂在它下面的单据" />
      </BlockShell>
    );
  if (isRelated) {
    bound = {
      ...bound,
      rows: bound.rows.filter(r => String(r.values?.[viaFieldRef] ?? "") === parentRowId),
    };
  }

  if (bound.rows.length === 0)
    return (
      <BlockShell block={block} title={title} testid="data-table">
        <BlockEmpty
          hint={
            isRelated
              ? "这条记录名下还没有关联单据"
              : "暂无数据 — 点「新建」写入第一条真实数据"
          }
        />
      </BlockShell>
    );
  // 列优先取 binding.fieldRefs；没声明才从真实行的键里派生。
  //
  // fieldRefs 是 2026-08-08 开给表格的（此前只有表单/详情族能声明）。表格是
  // 唯一"会显示字段却不能声明显示哪几个"的区块，这个例外没有道理：字段一多，
  // 派生 + 截断决定谁上榜的规则是键的顺序，模型和使用者都控制不了。对照台上
  // 就撞上了——十一个字段，截断正好切在第八个，布尔、关联、长文本三种语义
  // 全部看不见。
  //
  // 兜底上限从 5 提到 8：用户示范的订单页有 9 列，5 列砍掉的正是"支付状态"
  // "操作"这种一眼要看的东西——列少不等于清爽，等于信息不全。
  const declaredCols = boundFieldIds(block, bound.rows, 8);
  // 用户在 ColumnSettingPanel 里改过的隐藏/顺序/固定，最后套在这里。
  // 没有那个面板时 columnState 为空，applyColumnState 原样返回。
  const viewState = block.id ? columnState?.[block.id] : undefined;
  const cols = applyColumnState(declaredCols, viewState);
  // **全部列都被藏起来**是真会发生的：面板上把「列展示」的全选框取消掉就是。
  // pro-components 到这一步会把一张没有列的表交给 antd Table，渲染出一片
  // 空白表头——看起来像坏了。说清楚发生了什么，比默默画个空壳强。
  if (cols.length === 0)
    return (
      <BlockShell block={block} title={title} testid="data-table">
        <BlockEmpty hint="所有列都被隐藏了 — 在「列设置」里勾回来" />
      </BlockShell>
    );
  const columns: TableColumnsType<RuntimeRow> = cols.map(c => {
    const options = enumOptionsOf?.(bound.entityRef, c) ?? [];
    // 取第一个非空值当样本定语义——照 refine 的 inferencer，它也是看值。
    const sample = bound.rows.find(r => r.values?.[c] != null)?.values?.[c];
    const semantic = fieldSemantic(bound.entityRef, c, sample, fieldTypeOf, options, fieldSchemaOf);
    return {
      key: c,
      dataIndex: c,
      title: fieldLabelOf?.(bound.entityRef, c) ?? c,
      // 会长的语义一律单行截断（2026-08-08 从只管 text 扩到五种）。邮箱、外链、
      // 关联 id 都是长度不可控的单行串，不截断的话 tableLayout="fixed" 会把它们
      // 竖着折成一座塔——列一多整张表就成了参差不齐的一片。richtext 不在这里，
      // 它在 renderCell 里自带截断 + tooltip。
      ellipsis: ELLIPSIS_SEMANTICS.has(semantic),
      // 数值右对齐是表格的基本功——左对齐的金额列没法竖着比大小
      align: semantic === "money" || semantic === "number" ? ("right" as const) : undefined,
      // 固定列。分组顺序 applyColumnState 已经排好了，这里只负责让 antd 真的粘住
      fixed: viewState?.fixed[c],
      render: (_: unknown, row: RuntimeRow) =>
        renderCell(semantic, row.values?.[c], options, fieldLabelOf?.(bound.entityRef, c) ?? c),
    };
  });

  // 操作列 —— refine 的 ③：Inferencer 生成的每张表都自动追加
  // EditButton / ShowButton / DeleteButton。用户示范里那列「查看 编辑 取消」
  // 就是这个。此前我们一列都没有，于是表格看得见摸不着。
  //
  // 只在调用方接了 onAction 时出现：没人接的时候画一排点不动的链接，
  // 比不画更糟。
  if (onAction) {
    columns.push({
      key: "__actions",
      title: "操作",
      width: 120,
      fixed: undefined,
      render: (_: unknown, row: RuntimeRow) => (
        <Space size={4}>
          {/* 「查看」发 viewRequest，**不是** rowSelect（2026-08-13 修）。
              rowSelect 是"换一条看"的行选中语义，故意不弹抽屉（见
              AppRuntimeScreen 里那段注释）。这里复用它的后果是：页面上已经
              摆着详情面板时，点「查看」把焦点设成同一条，界面纹丝不动——
              用户看到的就是"这个链接点了没反应"。线上实测到的就是这一条。 */}
          <Typography.Link
            style={{ fontSize: 12 }}
            onClick={e => {
              e.stopPropagation();
              onAction("viewRequest", { rowId: row.id });
            }}
          >
            查看
          </Typography.Link>
          <Typography.Link
            style={{ fontSize: 12 }}
            onClick={e => {
              e.stopPropagation();
              onAction("editRequest", { rowId: row.id });
            }}
          >
            编辑
          </Typography.Link>
        </Space>
      ),
    });
  }
  /**
   * 拖拽排序（2026-08-08，②批次 1）。
   *
   * **做成 DataTable 的一个 prop，而不是第四张表。** pro-components 那边
   * `DragSortTable` 独立成组件，是因为它得包住 ProTable 的 components/
   * tableViewRender 才能塞进 dnd 上下文——那是实现约束，不是概念区分：拖得动
   * 的表和拖不动的表是同一张表。我们这边已经有 DataTable，再建一个"能拖的
   * DataTable"就是把同一个东西讲两遍，模型还得在两个几乎一样的选项里挑。
   *
   * 它的 DragSortTable 就在我们已装的 pro-components 2.8.10 里导出着，不加
   * 新依赖。拖完的语义照它：**先本地生效，再把排好的新数组回调出去**——
   * 持久化时机归调用方，组件不等服务端（等的话手一松表格会弹回去）。
   *
   * 这一档故意关掉两样东西，都是因为**手势会打架**：
   *   分页 —— 跨页拖没有意义，第 9 条拖到第 1 页要先翻页，中途松手就散了
   *   勾选 —— 复选框和拖拽把手抢同一次按下；要批量操作就别开拖拽排序
   */
  /**
   * 二级表头（2026-08-09，批次 7）。
   *
   * 中式报表里最常见的一件事：「上半年 / 下半年」各管三列，「计划 / 实际」
   * 各管两列。参照 jeecgboot 的 online 报表配置（`groupTitle` + `children`）。
   *
   * 只重组**已经在 columns 里的列**，不新增也不丢：没被任何分组认领的列留在
   * 原位（原顺序），被认领的按分组聚在一起。这条很重要——分组声明写漏一列时，
   * 那一列该照常显示，而不是从表上消失。
   */
  const groups = fieldGroupsOf(block, "columnGroups");
  const grouped = (() => {
    if (groups.length === 0) return columns;
    const claimed = new Set(groups.flatMap(g => g.fieldRefs));
    const byKey = new Map(columns.map(c => [String(c.key), c]));
    const out: typeof columns = [];
    let placed = false;
    for (const col of columns) {
      const key = String(col.key);
      if (!claimed.has(key)) {
        out.push(col);
        continue;
      }
      // 所有分组整体插在**第一个被认领的列**的位置上，保持相对次序不乱跳
      if (placed) continue;
      placed = true;
      for (const g of groups) {
        const kids = g.fieldRefs.map(f => byKey.get(f)).filter(Boolean) as typeof columns;
        if (kids.length > 0) {
          out.push({ key: `group-${g.title}`, title: g.title, children: kids } as never);
        }
      }
    }
    return out;
  })();

  /**
   * 合计行（2026-08-09，批次 7）。
   *
   * **参照 jeecgboot 提的问题，不参照它的做法。**它是把一条合计对象 push 进
   * dataSource（`usePopBiz.ts` 的 handleSumColumn），于是要把 pageSize 减一、
   * 第一次加载还得把最后一条弹掉，而且那条假行能被排序、能被勾选、能被点开。
   *
   * antd Table 自带 `summary`：合计行在 tbody 之外、固定在底部、不参与排序与
   * 选择。同一个需求，正确的位置。
   *
   * 只对 number 字段求和（门禁那条 fieldType: number 已经拦住了别的类型），
   * 空值跳过。合计的是**当前数据源全部行**，不是当前页——用户要的是"这批
   * 数据一共多少"，翻页翻到哪儿不该改变合计。
   */
  const summaryRefs = fieldRefListOf(block, "summaryFieldRefs").filter(f => cols.includes(f));
  const summaryRow =
    summaryRefs.length === 0
      ? undefined
      : () => (
          <Table.Summary fixed>
            <Table.Summary.Row data-testid="data-table-summary">
              {onSelectionChange ? <Table.Summary.Cell index={-1} /> : null}
              {cols.map((c, i) => {
                if (!summaryRefs.includes(c))
                  return (
                    <Table.Summary.Cell key={c} index={i}>
                      {i === 0 ? <strong>合计</strong> : null}
                    </Table.Summary.Cell>
                  );
                const sum = bound.rows.reduce((acc, r) => {
                  const n = Number(r.values?.[c]);
                  return Number.isFinite(n) ? acc + n : acc;
                }, 0);
                // 合计走**这一列自己的语义**，不另画一套。金额列上面每格都是
                // ¥ 千分位，底下合计写成裸数字，读起来像另一个东西——而它恰恰
                // 是那一列的和。语义判定跟单元格同源（renderCell）。
                return (
                  <Table.Summary.Cell key={c} index={i} align="right">
                    <strong>
                      {cellOf(bound.entityRef, c, { id: "__sum__", values: { [c]: sum } } as RuntimeRow, bound.rows, fieldTypeOf, enumOptionsOf)}
                    </strong>
                  </Table.Summary.Cell>
                );
              })}
            </Table.Summary.Row>
          </Table.Summary>
        );

  const sortable = block.props?.sortable === true;
  if (sortable) {
    return (
      <BlockShell block={block} title={title} testid="data-table">
        <DragSortTable
          rowKey="id"
          size="small"
          search={false}
          options={false}
          toolBarRender={false}
          pagination={false}
          // 把手挂在第一列上。不指定 dragSortKey 的话它让整行都能拖，而整行
          // 可拖会跟"点一行 = 选中/查看"打架——两个手势抢同一次按下。
          dragSortKey={cols[0]}
          columns={columns as never}
          dataSource={bound.rows}
          onDragSortEnd={(_before, _after, next) =>
            onAction?.("rowSelect", {
              reorderedRowIds: (next as RuntimeRow[]).map(r => r.id),
            })
          }
        />
      </BlockShell>
    );
  }

  return (
    <BlockShell block={block}
      title={title}
      testid="data-table"
    >
      {/* 换 antd Table：拿到省略号 tooltip、粘性表头、紧凑尺寸与主题描边，
          手写 <table> 这些都得自己补，而且列头字号/颜色跟同页别的表格对不齐 */}
      <Table
        size="small"
        rowKey="id"
        columns={grouped}
        dataSource={bound.rows}
        summary={summaryRow}
        // 分页交给 Table 自己管（2026-08-08）。此前是 slice(0, 8) + 标题栏
        // 一行"共 N 条，显示前 8 条"——那不是分页，是截断，用户根本翻不到
        // 第 9 条。用户的示范图里那一行是「共 1,268 条 ‹ 1 2 3 … › 10/页
        // 跳至 __ 页」，都是 antd Table 自带的，只是要打开。
        //
        // 分页是表格的一部分，不是一个独立区块——用户指出的"Pagination 居然
        // 变成独立大卡片"，根子就在把它当成了平级组件。
        pagination={{
          size: "small",
          pageSize: 8,
          showSizeChanger: bound.rows.length > 8,
          showQuickJumper: bound.rows.length > 40,
          showTotal: total => `共 ${total.toLocaleString("zh-CN")} 条`,
        }}
        // 默认不给 scroll.x：区块是页面里的一块，横向滚动条藏在卡片里没人会去拉，
        // 对照台上表格直接被卡片右边缘切掉、最后一列看不见。列共享可用宽度 +
        // 省略号（有 tooltip）才是这个尺寸下该有的行为。
        //
        // **有固定列时例外**：固定的意义就是"横向滚的时候这列别走"，不给
        // scroll.x 的话 antd 的 fixed 无事发生（还会告警）。用户在列设置里
        // 主动固定了某一列，就是明确表示他要横着看。
        scroll={
          viewState && Object.keys(viewState.fixed).length > 0
            ? { x: "max-content" }
            : undefined
        }
        tableLayout={
          viewState && Object.keys(viewState.fixed).length > 0 ? undefined : "fixed"
        }
        // 勾选只在宿主真的接了选择态时才出现（2026-08-08）。没有 BatchActionBar
        // 的页面凭空多一列复选框是纯噪音——勾了也没地方用。
        rowSelection={
          onSelectionChange
            ? {
                selectedRowKeys: selection?.rowIds?.[bound.entityRef] ?? [],
                onChange: keys =>
                  onSelectionChange(bound.entityRef, keys.map(k => String(k))),
              }
            : undefined
        }
        onRow={row => ({
          "data-testid": "data-table-row",
          onClick: () => onAction?.("rowSelect", { rowId: row.id }),
          style: { cursor: onAction ? "pointer" : undefined },
        })}
      />
    </BlockShell>
  );
};

/**
 * ── 表单/详情族（2026-08-07）─────────────────────────────────────────────
 *
 * 用户裁决的方向："先补积木，门槛只收 Ant Design 官方能力"。表单、抽屉、
 * 弹窗、分步表单、详情这几样是业务系统里最费工的部分，而 ProComponents
 * 早就把它们做完了——**已经装在依赖里**（@ant-design/pro-components 2.8），
 * 此前一个都没包成积木。这一批不引入任何新依赖。
 *
 * 字段从哪来：binding.fieldRefs 声明要哪几个字段（entityFieldRefLists，
 * 门禁会校验字段真的属于那个实体）；没声明就从真实行数据的键里推前 6 个。
 * **不猜字段类型**——类型从 fieldTypeOf 查，查不到按 string 处理，
 * 与其它区块"查不到就回落、不编"的纪律一致。
 */

/**
 * 表单族渲染一个字段时手里有什么。
 *
 * 收成一个对象而不是继续排位置参数：原来已经是 6 个位置参数，阶段④要再加
 * 两个（字段声明、ref 候选行），第 8 个位置参数没人读得懂，而且加一个就要
 * 回来改三个调用点。
 */
interface FormItemCtx {
  entityRef: string;
  fieldLabelOf?: FieldLabelLookup;
  fieldTypeOf?: FieldTypeLookup;
  enumOptionsOf?: EnumOptionsLookup;
  fieldSchemaOf?: (
    entityRef: string,
    fieldId: string
  ) => AppFormFieldSchema | undefined;
  /** ref 字段的候选行从这里取（entityRows[refEntityId]）。 */
  entityRows?: Record<string, RuntimeRow[]>;
}

/**
 * 字段 id → 该出哪种 ProForm 控件。
 *
 * ## 这里**不再自己判断**（2026-08-08，阶段④）
 *
 * 判定走 `field-value-type.ts` 的 `resolveValueType`——那张表已经是全站的
 * 单一判定源，读侧（FieldValue）、内置表单（FieldEditor）、手机档
 * （PhoneFormField）三处早就共读它。**只有这里是第四处，还自己写了一套**，
 * 而且是更差的一套：
 *
 *     枚举     一律 Select（2 个取值也要点开才知道有什么）
 *     boolean  掉进兜底 → 文本框（要用户手打 true/false）
 *     ref      掉进兜底 → 文本框（要用户手打一个行 id）
 *     datetime 掉进兜底 → 文本框
 *     format   压根不读 → 金额/评分/进度全是裸数字框
 *
 * 那张表的文件头写着它存在的理由："不会出现读的时候是进度条、写的时候是裸
 * 数字框"。这个文件此前恰好就是那个漂移点。接上之后，控件档位从 5 种变成
 * 17 种，而这里一行判断逻辑都没有——只剩"这一档用哪个 ProForm 组件"。
 *
 * ## 与 FieldEditor 的一处有意分歧
 *
 * percent / progress / score 在 FieldEditor 那边是"滑杆 + 数字框"并排，
 * ProForm 没有这个合体控件。这里按各档的主要用法分：进度天然是拖出来的
 * （Slider），百分比和分数常要精确值（Digit + 后缀）。档位判定仍是同一处，
 * 分歧只在这一档用哪个零件——这正是那张表允许的（它判"档"，不判"零件"）。
 */
function formItemFor(ctx: FormItemCtx, fieldId: string): React.ReactNode {
  const { entityRef } = ctx;
  const schema = ctx.fieldSchemaOf?.(entityRef, fieldId);
  const label =
    schema?.label ?? ctx.fieldLabelOf?.(entityRef, fieldId) ?? fieldId;
  const type = schema?.type ?? ctx.fieldTypeOf?.(entityRef, fieldId) ?? "string";
  // 取值声明：字段 schema 优先（已归一化），退到老的 enumOptionsOf。
  const options: NormalizedFieldOption[] =
    schema?.options ?? ctx.enumOptionsOf?.(entityRef, fieldId) ?? [];
  const common = { name: fieldId, label };
  const opts = options.map(o => ({ label: o.label, value: o.id }));

  switch (resolveValueType({ type, format: schema?.format, options })) {
    // ── 数值：全靠 format 分档 ────────────────────────────────────────
    case "money":
      return <ProFormMoney key={fieldId} {...common} />;
    case "rate":
      return <ProFormRate key={fieldId} {...common} />;
    case "progress":
      return <ProFormSlider key={fieldId} {...common} min={0} max={100} />;
    case "percent":
      return (
        <ProFormDigit key={fieldId} {...common} min={0} max={100} fieldProps={{ addonAfter: "%" }} />
      );
    case "score":
      return (
        <ProFormDigit key={fieldId} {...common} min={0} max={100} fieldProps={{ addonAfter: "分" }} />
      );
    case "digit":
      return <ProFormDigit key={fieldId} {...common} />;

    // ── 文本 ────────────────────────────────────────────────────────
    case "password":
      // masked（脱敏）：录入时按密码处理——手机号/证件号这类，摊在屏幕上给
      // 旁边的人看见就是泄露。amis 那边是独立的 input-password。
      return <ProFormText.Password key={fieldId} {...common} />;
    case "textarea":
      return <ProFormTextArea key={fieldId} {...common} />;

    // ── 时间 ────────────────────────────────────────────────────────
    case "date":
      return <ProFormDatePicker key={fieldId} {...common} />;
    case "dateTime":
      return <ProFormDateTimePicker key={fieldId} {...common} />;

    // ── 布尔 ────────────────────────────────────────────────────────
    case "switch":
      return <ProFormSwitch key={fieldId} {...common} />;

    // ── 枚举三档（按取值个数，阈值在 field-value-type.ts）────────────
    case "segmented":
      return <ProFormSegmented key={fieldId} {...common} request={async () => opts} />;
    case "radio":
      return <ProFormRadio.Group key={fieldId} {...common} options={opts} radioType="button" />;
    case "select":
      return <ProFormSelect key={fieldId} {...common} options={opts} showSearch />;
    case "tags":
      // 枚举但没有取值声明：可选可输。不出一个空下拉——那是个点开什么都
      // 没有的坑。
      return <ProFormSelect key={fieldId} {...common} mode="tags" fieldProps={{ maxCount: 1 }} />;

    // ── 关联 ────────────────────────────────────────────────────────
    case "ref": {
      // 候选是**另一张表的行**。显示名用该行的第一个字段值（跟内置表单的
      // refRowsFor 同一条约定），查不到指向就退回文本框——不编一个假下拉。
      const rows = schema?.refEntityId
        ? (ctx.entityRows?.[schema.refEntityId] ?? [])
        : [];
      if (rows.length === 0) return <ProFormText key={fieldId} {...common} />;
      return (
        <ProFormSelect
          key={fieldId}
          {...common}
          showSearch
          options={rows.map(r => ({
            value: r.id,
            label: String(Object.values(r.values)[0] ?? r.id),
          }))}
        />
      );
    }

    // 单行文本，也是判定表兜底给的那一档。**显式写出来**而不是靠 default：
    // 判定表以后加一档时，护栏会因为"少了一个 case"变红；全靠 default 兜的话
    // 新档位会静静地掉进文本框，屏幕上看不出来。
    case "text":
    default:
      return <ProFormText key={fieldId} {...common} />;
  }
}

/**
 * binding.fieldRefs 优先；没声明就从真实行的键里取前 `fallbackCap` 个（不编字段）。
 *
 * **声明了就全用，不再截断**——截断是给"没人说要哪几个"准备的兜底，模型明确
 * 写出来的列表再砍一刀等于把它的声明当建议。表单族兜底 6 个，表格族 8 个
 * （2026-08-08 表格从 5 提到 8 的那次判断，见 DataTableRenderer 的说明）。
 */
function boundFieldIds(
  block: ExperienceBlockInstance,
  rows: RuntimeRow[],
  fallbackCap = 6
): string[] {
  const declared = block.binding?.fieldRefs;
  if (Array.isArray(declared) && declared.length > 0) {
    // 模型明说了要哪几列就照办 —— 它把 `X_ref` 和 `X_name` 一起写出来，
    // 那是它的选择，渲染层没有资格替它删。去重只管下面这条派生路径。
    return declared.map(f => String(f)).filter(Boolean);
  }
  // 派生路径要先摘掉反规范化副本**再截断**（2026-08-12）。顺序反了的话，
  // 「自提点 / 自提点名称」白占一格，把本该露出来的第 8 列挤下榜。
  return dedupeDenormalizedFieldIds([
    ...new Set(rows.flatMap(r => Object.keys(r.values ?? {}))),
  ]).slice(0, fallbackCap);
}

const RecordFormRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
  fieldSchemaOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="record-form">
        <BlockEmpty hint="表单未绑定到有效实体" />
      </BlockShell>
    );
  const fields = boundFieldIds(block, bound.rows);
  if (fields.length === 0)
    return (
      <BlockShell block={block} title={title} testid="record-form">
        <BlockEmpty hint="这个实体还没有可填写的字段" />
      </BlockShell>
    );
  const layout = block.props?.layout === "horizontal" ? "horizontal" : "vertical";
  return (
    <BlockShell block={block} title={title} testid="record-form">
      <ProForm
        layout={layout}
        submitter={{
          searchConfig: { submitText: String(block.props?.submitText ?? "提交") },
          resetButtonProps: false,
        }}
        onFinish={async values => {
          onAction?.("submitRequest", { entityRef: bound.entityRef, values });
          return true;
        }}
      >
        {fields.map(f =>
          formItemFor(
            {
              entityRef: bound.entityRef,
              fieldLabelOf,
              fieldTypeOf,
              enumOptionsOf,
              fieldSchemaOf,
              entityRows,
            },
            f
          )
        )}
      </ProForm>
    </BlockShell>
  );
};

/**
 * 一段字段分组：`{ title, fieldRefs }`。门禁保证了标题非空、字段属于这个实体。
 */
interface FieldGroup {
  title: string;
  fieldRefs: string[];
}

/** 从 binding 里取分组，顺手把非法形状挡在渲染之外（生成侧已有门禁，这里防手写夹具）。 */
function fieldGroupsOf(block: ExperienceBlockInstance, key = "sections"): FieldGroup[] {
  const raw = (block.binding as Record<string, unknown> | undefined)?.[key];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(g => {
      const o = g as { title?: unknown; fieldRefs?: unknown };
      const title = String(o?.title ?? "").trim();
      const refs = Array.isArray(o?.fieldRefs)
        ? o.fieldRefs.map(String).filter(Boolean)
        : [];
      return { title, fieldRefs: refs };
    })
    .filter(g => g.title && g.fieldRefs.length > 0);
}

/**
 * SectionedForm — 分段长表单（2026-08-09，批次 5）。
 *
 * 搬的是 `ant-design/pro-blocks` 的 FormAdvancedForm。那一页三样东西值得搬：
 *
 *   ① **分段**：字段按业务含义切成「仓库管理 / 任务管理 / 成员管理」三张卡，
 *      不是按数量机械均分——这跟 StepsForm 里那条注释是同一条纪律。
 *   ② **吸底工具条**：长表单滚到哪儿提交按钮都在（FooterToolbar）。
 *   ③ **校验汇总**：提交失败时，底部显示「N 项没填对」，点开是清单，
 *      点一条**跳到那个字段**。
 *
 * ③ 是这一批真正的东西。长表单校验失败时最难受的是"红字在屏幕外某处"——
 * 原版用 `document.querySelector('label[for=…]').scrollIntoView()` 定位，
 * 这里照它的路子做，只是换成 ProForm 的 `onFinishFailed` 拿字段名。
 *
 * 与 RecordForm 的分工：只有一段、且那一段没名字，就是 RecordForm，别用这个。
 * 门禁那条 note 也是这么写的。
 */
const SectionedFormRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
  fieldSchemaOf,
}) => {
  const [badFields, setBadFields] = React.useState<string[]>([]);
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="sectioned-form">
        <BlockEmpty hint="分段表单未绑定到有效实体" />
      </BlockShell>
    );
  const sections = fieldGroupsOf(block);
  if (sections.length === 0)
    return (
      <BlockShell block={block} title={title} testid="sectioned-form">
        {/* 不回落成"把所有字段摊平画一个大表单"——那样看着像做完了，实际上
            分段这件事悄悄没了。分段是它存在的理由，没有分段就该说没有。 */}
        <BlockEmpty hint="还没有声明分段（sections）——分段表单要说清每段叫什么、放哪几个字段" />
      </BlockShell>
    );

  const labelOf = (f: string) => fieldLabelOf?.(bound.entityRef, f) ?? f;

  return (
    <BlockShell block={block} title={title} testid="sectioned-form">
      <ProForm
        layout="vertical"
        submitter={{
          searchConfig: { submitText: String(block.props?.submitText ?? "提交") },
          resetButtonProps: false,
          // 提交区搬进吸底工具条。`portalDom={false}` 让它停在这张卡里而不是
          // 整页视口底部——区块是页面的一块，不该独占整页的底边。
          render: (_p, dom) => (
            <FooterToolbar portalDom={false} extra={
              badFields.length > 0 ? (
                <Tooltip
                  title={
                    <div data-testid="sectioned-form-errors">
                      {badFields.map(f => (
                        <div
                          key={f}
                          style={{ cursor: "pointer", padding: "2px 0" }}
                          onClick={() => {
                            // 照原版：按 label[for] 找到那个字段滚过去。
                            document
                              .querySelector(`label[for="${f}"]`)
                              ?.scrollIntoView({ block: "center" });
                          }}
                        >
                          {labelOf(f)}
                        </div>
                      ))}
                    </div>
                  }
                >
                  <span data-testid="sectioned-form-error-count" style={{ color: "#ff4d4f" }}>
                    {badFields.length} 项没填对
                  </span>
                </Tooltip>
              ) : undefined
            }>
              {dom}
            </FooterToolbar>
          ),
        }}
        onFinish={async values => {
          setBadFields([]);
          onAction?.("submitRequest", { entityRef: bound.entityRef, values });
          return true;
        }}
        onFinishFailed={info => {
          setBadFields(
            (info?.errorFields ?? [])
              .map(e => String((e.name ?? [])[0] ?? ""))
              .filter(Boolean)
          );
        }}
      >
        {sections.map(sec => (
          <ProCard
            key={sec.title}
            title={sec.title}
            headerBordered
            bordered
            style={{ marginBottom: 12 }}
            data-testid="sectioned-form-section"
          >
            {sec.fieldRefs.map(f =>
              formItemFor(
                {
                  entityRef: bound.entityRef,
                  fieldLabelOf,
                  fieldTypeOf,
                  enumOptionsOf,
                  fieldSchemaOf,
                  entityRows,
                },
                f
              )
            )}
          </ProCard>
        ))}
      </ProForm>
    </BlockShell>
  );
};

const RecordFormDialogRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
  fieldSchemaOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="record-form-dialog">
        <BlockEmpty hint="表单未绑定到有效实体" />
      </BlockShell>
    );
  const fields = boundFieldIds(block, bound.rows);
  const triggerText = String(block.props?.triggerText ?? "").trim() || title || "新建";
  // 抽屉与弹窗只差呈现方式，共用同一份字段与提交回调。做成两个积木会让
  // 目录里出现一对只差一个词的孪生条目，AI 选型时也多一次无意义的分叉。
  const Dialog = block.props?.mode === "modal" ? ModalForm : DrawerForm;
  const trigger = <Button type="primary">{triggerText}</Button>;
  return (
    <div data-testid="record-form-dialog">
      <Dialog
        title={title || triggerText}
        trigger={trigger}
        onFinish={async values => {
          onAction?.("submitRequest", { entityRef: bound.entityRef, values });
          return true;
        }}
      >
        {fields.map(f =>
          formItemFor(
            {
              entityRef: bound.entityRef,
              fieldLabelOf,
              fieldTypeOf,
              enumOptionsOf,
              fieldSchemaOf,
              entityRows,
            },
            f
          )
        )}
      </Dialog>
    </div>
  );
};

const RecordDetailRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
  fieldSchemaOf,
  focus,
}) => {
  // 钩子必须在任何提前 return 之前——否则 children 非空那次会少调一个 hook，
  // React 会报 "Rendered fewer hooks than expected"。
  const [widthRef, measuredColumns] = useContainerColumns(3);
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="record-detail">
        <BlockEmpty hint="详情未绑定到有效实体" />
      </BlockShell>
    );
  if (bound.rows.length === 0)
    return (
      <BlockShell block={block} title={title} testid="record-detail">
        <BlockEmpty hint="暂无数据 — 先写入第一条真实数据" />
      </BlockShell>
    );
  // 详情展示的是"当前选中那条"。2026-08-08 之前这里只有一句注释和 rows[0]——
  // 聚焦态压根不存在。现在真有了（PageFocusState），查不到才回落第一条：
  // **不是随机一条**，顺序稳定，截图/回归才可比。
  const focusedId = focus?.[bound.entityRef];
  const row = (focusedId && bound.rows.find(r => r.id === focusedId)) || bound.rows[0];
  const fields = boundFieldIds(block, bound.rows);
  /**
   * 列数跟屏宽走（照 ProfileAdvanced 的 `column={isMobile ? 1 : 2}`）。
   *
   * 写死列数的详情在窄屏上标签和值会挤成一坨。而且同一个组件在两个位置该是两种
   * 密度——它页头那份是 size=small + 2 列，正文那份是 3 列。所以 columns 保留
   * 显式档位，只把**默认值**换成响应式，不再是写死的 2。
   */
  const declaredColumns = String(block.props?.columns ?? "responsive");
  // 显式档位照旧生效；默认档改成**量容器**（见 useContainerColumns 的说明——
  // 视口断点治不了"窗口宽但这一栏窄"，线上就是这么叠字的）。
  const columns: number =
    declaredColumns === "1" || declaredColumns === "2" || declaredColumns === "3"
      ? Number(declaredColumns)
      : measuredColumns;
  return (
    <BlockShell block={block}
      title={title}
      testid="record-detail"
      extra={
        <Button size="small" onClick={() => onAction?.("editRequest", { rowId: row.id })}>
          编辑
        </Button>
      }
    >
      <div ref={widthRef}>
        <ProDescriptions
          column={columns}
          size="small"
        dataSource={row.values ?? {}}
        columns={fields.map(f => {
          const options = enumOptionsOf?.(bound.entityRef, f) ?? [];
          // 走 DataTable 同一个 renderCell（2026-08-08）。此前这里只把枚举翻成
          // 标签，别的一律 String() 原样打印——同一条订单在表格里金额是
          // ¥428.00、邮箱能点，进了详情就变成 428 和一段死文本。"同一份数据在
          // 两个区块里必须读起来一样"这句纪律本来就写在这，只是当初只兑现了
          // 枚举那一条。
          const sample = row.values?.[f];
          const semantic = fieldSemantic(bound.entityRef, f, sample, fieldTypeOf, options, fieldSchemaOf);
          return {
            key: f,
            dataIndex: f,
            title: fieldLabelOf?.(bound.entityRef, f) ?? f,
            render: (_: unknown, record: Record<string, unknown>) =>
              renderCell(semantic, record?.[f], options, fieldLabelOf?.(bound.entityRef, f) ?? f),
          };
        })}
        />
      </div>
    </BlockShell>
  );
};

const StepsFormRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
  workflow,
  fieldSchemaOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="steps-form">
        <BlockEmpty hint="分步表单未绑定到有效实体" />
      </BlockShell>
    );
  const fields = boundFieldIds(block, bound.rows);
  if (fields.length === 0)
    return (
      <BlockShell block={block} title={title} testid="steps-form">
        <BlockEmpty hint="这个实体还没有可填写的字段" />
      </BlockShell>
    );
  // 分几步、每步叫什么：**优先跟着工作流的链路节点走**，而不是把字段机械
  // 均分。这一页的意义是"五系统关联"——步骤名来自 workflow 才叫关联上了，
  // 按字段数切段只是把一个长表单折起来。链路取不到时才回落到均分两步。
  const chainRef = String(block.props?.chainRef ?? "").trim();
  const chains = workflow?.chains ?? [];
  const chain = chainRef ? chains.find(c => c.id === chainRef) : chains[0];
  const nodeNames = (chain?.nodes ?? [])
    .map(n => String(n?.name ?? n?.id ?? "").trim())
    .filter(Boolean);
  const stepNames = nodeNames.length >= 2 ? nodeNames.slice(0, 4) : ["填写信息", "确认提交"];
  const per = Math.max(1, Math.ceil(fields.length / stepNames.length));
  return (
    <BlockShell block={block} title={title} testid="steps-form">
      <StepsForm
        onFinish={async values => {
          onAction?.("submitRequest", { entityRef: bound.entityRef, values });
          return true;
        }}
        onCurrentChange={current => onAction?.("stepChange", { step: current })}
      >
        {stepNames.map((name, i) => (
          <StepsForm.StepForm key={name} name={`step-${i}`} title={name}>
            {fields
              .slice(i * per, (i + 1) * per)
              .map(f =>
                formItemFor(
            {
              entityRef: bound.entityRef,
              fieldLabelOf,
              fieldTypeOf,
              enumOptionsOf,
              fieldSchemaOf,
              entityRows,
            },
            f
          )
              )}
          </StepsForm.StepForm>
        ))}
      </StepsForm>
    </BlockShell>
  );
};

/**
 * ── 可编辑子表 —— 照 pro-components 的 EditableTable（2026-08-08，②批次 1）──
 *
 * 源：`src/table/components/EditableTable/{index,RowEditorTable,CellEditorTable}.tsx`
 *
 * **这次搬的是"接进契约"，不是重写渲染**——`EditableProTable` / `RowEditorTable`
 * / `CellEditorTable` 三个都在我们已装的 pro-components 2.8.10 里导出着，一个
 * 新依赖都不用加。所以真正的活是：把它们接到我们的 binding 上（列从 fieldRefs
 * 来、控件类型从数据模型来），再把它们内部那几条**不看源码就不知道**的行为
 * 用用例钉住，免得哪天换实现的时候悄悄丢掉：
 *
 * 1. **失焦延迟 150ms 才退出编辑。** 原注释：「如果焦点在同一行内的字段间切换
 *    （Tab），新字段的 onFocus 会在 blur 的 setTimeout 回调之前触发，从而取消
 *    定时器、保持编辑态」。立刻退出的话，用户按一下 Tab 就被踢出编辑。
 * 2. **整行编辑与单元格编辑是两套。** 单元格档还要记 activeColumnId，把别的列
 *    显式设成 `editable: false`——不然双击一格，整行都变成输入框。
 * 3. **列标识是 `${列序号}:${dataIndex}`**，不是光用 dataIndex。dataIndex 可能
 *    缺失、也可能重名，光用它会串格。
 * 4. **新行分两种**：`dataSource` 直接进数据（不能取消，只能删）；`cache` 进
 *    缓存（一取消就消失）。这两种在业务上是不同承诺，不是实现细节。
 * 5. **到了行数上限是把新建按钮藏掉**，不是让用户点了再报错。
 */
const EditableSubTableRenderer: ExperienceBlockRenderer = ({
  children,
  block,
  entityRows,
  onAction,
  fieldLabelOf,
  enumOptionsOf,
  fieldTypeOf,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound)
    return (
      <BlockShell block={block} title={title} testid="editable-sub-table">
        <BlockEmpty hint="明细表未绑定到有效实体" />
      </BlockShell>
    );
  const fields = boundFieldIds(block, bound.rows);
  if (fields.length === 0)
    return (
      <BlockShell block={block} title={title} testid="editable-sub-table">
        <BlockEmpty hint="这个实体还没有可填写的字段" />
      </BlockShell>
    );

  // 单元格档 vs 整行档 —— pro-components 把它们做成了两个组件，我们照它分。
  // 默认整行：明细表一行几个字段是一起录的，一格一格双击太碎。
  const cellMode = String(block.props?.editMode ?? "row") === "cell";
  const Editor = cellMode ? CellEditorTable : RowEditorTable;
  const maxRows = Number(block.props?.maxRows);
  const hasLimit = Number.isFinite(maxRows) && maxRows > 0;
  const addText = String(block.props?.addText ?? "").trim() || "新增一行";
  // top / bottom：明细表默认往下加。往上加是"最近录的在最前"那种用法。
  const addPosition = block.props?.addPosition === "top" ? "top" : "bottom";
  // dataSource：新行直接进数据，不能取消只能删；cache：取消就消失。
  // 默认 cache——录一半反悔是常事，直接落进数据的那种更重，得显式选。
  const newRecordType = block.props?.newRecordType === "dataSource" ? "dataSource" : "cache";

  const value = bound.rows.map(r => ({ id: r.id, ...(r.values ?? {}) }));
  const columns = fields.map(f => {
    const options = enumOptionsOf?.(bound.entityRef, f) ?? [];
    const declared = fieldTypeOf?.(bound.entityRef, f);
    return {
      title: fieldLabelOf?.(bound.entityRef, f) ?? f,
      dataIndex: f,
      // valueType 从数据模型的字段类型来，不猜——与 formItemFor 同一条纪律。
      // 查不到按文本处理，跟别处"查不到就回落、不编"一致。
      valueType:
        options.length > 0 || declared === "enum"
          ? ("select" as const)
          : declared === "number"
            ? ("digit" as const)
            : declared === "date"
              ? ("date" as const)
              : declared === "text"
                ? ("textarea" as const)
                : ("text" as const),
      valueEnum:
        options.length > 0
          ? Object.fromEntries(options.map(o => [o.id, { text: o.label }]))
          : undefined,
    };
  });

  return (
    <BlockShell block={block} title={title} testid="editable-sub-table">
      <Editor
        rowKey="id"
        size="small"
        value={value}
        columns={columns}
        // 到上限就**不给按钮**（pro-components 的 shouldShowCreatorButton）。
        // 给了再报错是把"不行"推迟到用户已经动手之后。
        recordCreatorProps={
          hasLimit && value.length >= maxRows
            ? false
            : {
                position: addPosition,
                newRecordType,
                creatorButtonText: addText,
                record: () => ({ id: `new-${Date.now()}` }),
              }
        }
        maxLength={hasLimit ? maxRows : undefined}
        editable={{
          type: cellMode ? "single" : "multiple",
          onSave: async (_key, record) => {
            onAction?.("submitRequest", { entityRef: bound.entityRef, values: record });
          },
          onDelete: async (_key, record) => {
            onAction?.("editRequest", { entityRef: bound.entityRef, rowId: String(record?.id ?? "") });
          },
        }}
      />
    </BlockShell>
  );
};

/**
 * ContentCard —— **唯一一个"卡片"是显式选来的**积木（2026-08-08）。
 *
 * 用户裁决：「不要这个 card 的卡片包裹，组装的时候就要纯粹一点，该是啥就是
 * 啥，该是啥组件就是啥组件。当然了这个 card 它可以只是一个单独的组件，就是
 * 在真正需要包的时候，然后要让 AI 自己组装。」
 *
 * 在这之前，组装页和预设页给**每一个**积木都套了一层 Card。那是替模型做了
 * 决定：所有东西一律装进卡片。现在反过来——默认什么都不套，需要把几个积木
 * 圈在一起时，模型自己往组装结果里放一个 ContentCard，把它们写进 children。
 *
 * 它自己不取数、不发事件，binding 是空的：装什么由 children 决定，里面的
 * 积木各绑各的。
 */
const ContentCardRenderer: ExperienceBlockRenderer = ({ block, children }) => {
  const title = String(block.props?.title ?? "").trim();
  const subtitle = String(block.props?.subtitle ?? "").trim();
  return (
    <Card
      data-testid="content-card"
      size="small"
      variant={block.props?.bordered === true ? "outlined" : "borderless"}
      title={
        title ? (
          <div style={{ paddingTop: 2, paddingBottom: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 11, fontWeight: 400, color: INK.faint }}>{subtitle}</div>
            )}
          </div>
        ) : undefined
      }
      styles={{ body: { padding: 12, display: "flex", flexDirection: "column", gap: 12 } }}
    >
      {/* children 由渲染宿主按 block.children 里的 id 解析后传进来。
          容器空着时如实说空——不画一个假的占位内容充数。 */}
      {children ?? <BlockEmpty hint="这张卡片还没有装任何区块" />}
    </Card>
  );
};

/**
 * 附件面板。组合逻辑来自 MeEdu 的真实课程附件流程：附件必须把名称、可用状态
 * 和动作放在同一行；动作不可用时保留原因，不能只留一个失效链接。桌面端额外
 * 使用 Upload 管理待上传队列，beforeUpload 阶段先进入本地列表，再把真正写入
 * 交给宿主动作，避免区块擅自假定后端上传协议。
 */
const AttachmentPanelRenderer: ExperienceBlockRenderer = ({
  block,
  children,
  entityRows,
  onAction,
}) => {
  const { token } = antdTheme.useToken();
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const nameRef = fieldRefOf(block, "fileNameFieldRef");
  const sizeRef = fieldRefOf(block, "fileSizeFieldRef");
  const statusRef = fieldRefOf(block, "statusFieldRef");
  const timeRef = fieldRefOf(block, "uploadedAtFieldRef");
  const allowUpload = block.props?.allowUpload === true;
  const [queued, setQueued] = React.useState<Array<{ id: string; name: string; size: number }>>([]);

  if (!bound || !nameRef) {
    return (
      <BlockShell block={block} title={title} testid="attachment-panel">
        <BlockEmpty hint="附件面板尚未绑定有效实体和文件名字段" />
      </BlockShell>
    );
  }

  const formatSize = (value: unknown) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };
  const items = [
    ...queued.map(file => ({
      id: file.id,
      name: file.name,
      size: formatSize(file.size),
      status: "等待上传",
      time: "",
      queued: true,
    })),
    ...bound.rows.map(row => ({
      id: row.id,
      name: String(row.values?.[nameRef] ?? "").trim() || "未命名附件",
      size: sizeRef ? formatSize(row.values?.[sizeRef]) : "",
      status: statusRef ? String(row.values?.[statusRef] ?? "").trim() : "",
      time: timeRef ? String(row.values?.[timeRef] ?? "").trim() : "",
      queued: false,
    })),
  ];

  return (
    <BlockShell block={block}
      title={title}
      testid="attachment-panel"
      extra={
        allowUpload ? (
          <Upload
            showUploadList={false}
            multiple
            beforeUpload={file => {
              const id = `${file.uid}-${file.name}`;
              setQueued(current => [...current, { id, name: file.name, size: file.size }]);
              onAction?.("createRequest", {
                entityRef: bound.entityRef,
                file: { id, name: file.name, size: file.size, type: file.type },
              });
              return false;
            }}
          >
            <Button size="small">{String(block.props?.uploadText ?? "添加附件")}</Button>
          </Upload>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <BlockEmpty hint={String(block.props?.emptyText ?? "还没有附件")} />
      ) : (
        <List
          size="small"
          dataSource={items}
          renderItem={item => (
            <List.Item
              actions={[
                item.queued ? (
                  <Button
                    key="remove"
                    type="link"
                    size="small"
                    onClick={() => setQueued(current => current.filter(file => file.id !== item.id))}
                  >
                    移除
                  </Button>
                ) : (
                  <Button
                    key="open"
                    type="link"
                    size="small"
                    onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: item.id })}
                  >
                    打开
                  </Button>
                ),
              ]}
            >
              <List.Item.Meta
                avatar={<AntdIcons.PaperClipOutlined style={{ fontSize: 18, color: token.colorPrimary }} />}
                title={<Typography.Text ellipsis>{item.name}</Typography.Text>}
                description={
                  <Space size={6} wrap>
                    {item.status && <Tag color={item.queued ? "processing" : undefined}>{item.status}</Tag>}
                    {item.size && <Typography.Text type="secondary">{item.size}</Typography.Text>}
                    {item.time && <Typography.Text type="secondary">{item.time}</Typography.Text>}
                  </Space>
                }
              />
              {item.queued && <Progress percent={0} showInfo={false} size="small" style={{ width: 88 }} />}
            </List.Item>
          )}
        />
      )}
    </BlockShell>
  );
};

/** 带回复关系的讨论流。父子关系、审核态、分页展示和就地回复来自 MeEdu。 */
const CommentThreadRenderer: ExperienceBlockRenderer = ({
  block,
  children,
  entityRows,
  onAction,
}) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const authorRef = fieldRefOf(block, "authorFieldRef");
  const contentRef = fieldRefOf(block, "contentFieldRef");
  const timeRef = fieldRefOf(block, "timeFieldRef");
  const avatarRef = fieldRefOf(block, "avatarFieldRef");
  const statusRef = fieldRefOf(block, "statusFieldRef");
  const parentRef = fieldRefOf(block, "parentFieldRef");
  const [draft, setDraft] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<string | null>(null);
  /**
   * 评论正文按 Markdown 渲染（2026-08-10 接入自研档）。
   *
   * 默认关：存量讨论区里的正文是纯文本，突然按 Markdown 解析会让形如
   * `*重点*` 的星号消失、`# 1 号问题` 变成大标题——那是**改了别人已有内容的
   * 显示**，不该由一次接线顺手决定。开着的时候读写两侧成对：正文走
   * MarkdownView，输入框走 MarkdownEditor。
   */
  const markdown = block.props?.markdown === true;
  const pageSize = Math.max(1, Number(block.props?.pageSize ?? 5) || 5);
  const [visible, setVisible] = React.useState(pageSize);

  if (!bound || !authorRef || !contentRef || !timeRef) {
    return (
      <BlockShell block={block} title={title} testid="comment-thread">
        <BlockEmpty hint="讨论区尚未绑定作者、内容和时间字段" />
      </BlockShell>
    );
  }
  const roots = bound.rows.filter(row => !parentRef || !String(row.values?.[parentRef] ?? "").trim());
  const replies = (parentId: string) =>
    parentRef
      ? bound.rows.filter(row => String(row.values?.[parentRef] ?? "").trim() === parentId)
      : [];
  const submit = () => {
    const content = draft.trim();
    if (!content) return;
    onAction?.("submitRequest", {
      entityRef: bound.entityRef,
      values: { [contentRef]: content, ...(parentRef && replyTo ? { [parentRef]: replyTo } : {}) },
    });
    setDraft("");
    setReplyTo(null);
  };
  const renderComment = (row: RuntimeRow, nested = false) => {
    const status = statusRef ? String(row.values?.[statusRef] ?? "").trim() : "";
    return (
      <List.Item key={row.id} style={nested ? { paddingInlineStart: 44, background: "rgba(5,5,5,0.02)" } : undefined}>
        <List.Item.Meta
          avatar={<Avatar src={avatarRef ? String(row.values?.[avatarRef] ?? "") : undefined}>{String(row.values?.[authorRef] ?? "?").slice(0, 1)}</Avatar>}
          title={
            <Space size={6} wrap>
              <Typography.Text strong>{String(row.values?.[authorRef] ?? "未知用户")}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{String(row.values?.[timeRef] ?? "")}</Typography.Text>
              {status && <Tag color={status.includes("审核") ? "warning" : undefined}>{status}</Tag>}
            </Space>
          }
          description={
            <div>
              {markdown ? (
                <MarkdownView text={String(row.values?.[contentRef] ?? "")} style={{ margin: "4px 0 2px" }} />
              ) : (
                <Typography.Paragraph style={{ margin: "4px 0 2px" }}>{String(row.values?.[contentRef] ?? "")}</Typography.Paragraph>
              )}
              {block.props?.allowReply !== false && !nested && (
                <Button type="link" size="small" style={{ paddingInline: 0 }} onClick={() => setReplyTo(replyTo === row.id ? null : row.id)}>
                  {replyTo === row.id ? "取消回复" : "回复"}
                </Button>
              )}
            </div>
          }
        />
      </List.Item>
    );
  };

  return (
    <BlockShell block={block} title={title} testid="comment-thread" extra={<Typography.Text type="secondary">{bound.rows.length} 条</Typography.Text>}>
      {roots.length === 0 ? (
        <BlockEmpty hint="还没有讨论内容" />
      ) : (
        <List size="small">
          {roots.slice(0, visible).flatMap(row => [renderComment(row), ...replies(row.id).map(reply => renderComment(reply, true))])}
        </List>
      )}
      {visible < roots.length && (
        <Button block type="text" onClick={() => setVisible(current => current + pageSize)}>加载更多</Button>
      )}
      <Flex gap={8} align="flex-end" style={{ marginTop: 10 }}>
        {markdown ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <MarkdownEditor value={draft} onChange={setDraft} height="88px" placeholderHeight={88} />
          </div>
        ) : (
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={draft}
            placeholder={replyTo ? "写下回复" : String(block.props?.composerPlaceholder ?? "写下评论")}
            onChange={event => setDraft(event.target.value)}
          />
        )}
        <Button type="primary" disabled={!draft.trim()} onClick={submit}>{String(block.props?.submitText ?? "发布")}</Button>
      </Flex>
    </BlockShell>
  );
};

/**
 * 记录选择器。借鉴 NocoBase table-selector：搜索、选择态和确认动作属于同一个
 * 区块，不能让普通表格勾选后依赖页面上另一个遥远按钮完成选择。
 */
const RecordPickerRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const titleRef = fieldRefOf(block, "titleFieldRef");
  const descRef = fieldRefOf(block, "descFieldRef");
  const statusRef = fieldRefOf(block, "statusFieldRef");
  const multiple = block.props?.selectionMode !== "single";
  const limit = Math.max(1, Number(block.props?.maxSelected ?? 100) || 100);
  const [keyword, setKeyword] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  if (!bound || !titleRef) {
    return (
      <BlockShell block={block} title={title} testid="record-picker">
        <BlockEmpty hint="记录选择器尚未绑定有效实体和标题字段" />
      </BlockShell>
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
    onAction?.("itemSelect", { entityRef: bound.entityRef, rowIds: next });
  };
  return (
    <BlockShell block={block}
      title={title}
      testid="record-picker"
      extra={<Typography.Text type="secondary">已选 {selected.length}</Typography.Text>}
    >
      {block.props?.searchable !== false && (
        <Input.Search allowClear value={keyword} placeholder="搜索可选记录" onChange={event => setKeyword(event.target.value)} style={{ marginBottom: 8 }} />
      )}
      {shown.length === 0 ? <BlockEmpty hint={keyword ? "没有匹配的记录" : "暂无可选记录"} /> : (
        <List
          size="small"
          dataSource={shown}
          renderItem={row => {
            const checked = selected.includes(row.id);
            return (
              <List.Item onClick={() => toggle(row.id, !checked)} style={{ cursor: "pointer" }}>
                <Checkbox checked={checked} style={{ marginInlineEnd: 10 }} />
                <List.Item.Meta
                  title={String(row.values?.[titleRef] ?? "未命名记录")}
                  description={descRef ? String(row.values?.[descRef] ?? "") : undefined}
                />
                {statusRef && row.values?.[statusRef] != null && <Tag>{String(row.values[statusRef])}</Tag>}
              </List.Item>
            );
          }}
        />
      )}
      <Flex justify="space-between" align="center" style={{ marginTop: 10 }}>
        <Button type="text" disabled={selected.length === 0} onClick={() => setSelected([])}>清空</Button>
        <Button type="primary" disabled={selected.length === 0} onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowIds: selected })}>
          {String(block.props?.confirmText ?? "确认选择")}
        </Button>
      </Flex>
    </BlockShell>
  );
};

/**
 * 状态看板。结构取自 slash-admin 的 Kanban：列与记录是两级状态，移动记录时
 * 同时知道来源列和目标列。WhyBuddy 不在区块里偷改运行时行数据，移动通过
 * editRequest 交给宿主；桌面用并列列，手机端则改为一次只看一列。
 */
const KanbanBoardRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction, enumOptionsOf }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const titleRef = fieldRefOf(block, "titleFieldRef");
  const statusRef = fieldRefOf(block, "statusFieldRef");
  const descRef = fieldRefOf(block, "descFieldRef");
  const assigneeRef = fieldRefOf(block, "assigneeFieldRef");
  if (!bound || !titleRef || !statusRef) {
    return <BlockShell block={block} title={title} testid="kanban-board"><BlockEmpty hint="看板尚未绑定标题和状态字段" /></BlockShell>;
  }
  const declared = enumOptionsOf?.(bound.entityRef, statusRef) ?? [];
  const values = Array.from(new Set(bound.rows.map(row => String(row.values?.[statusRef] ?? "").trim()).filter(Boolean)));
  const columns = declared.length > 0
    ? declared.map(option => ({ value: option.id, label: option.label }))
    : values.map(value => ({ value, label: value }));
  const move = (rowId: string, status: string) => onAction?.("editRequest", {
    entityRef: bound.entityRef,
    rowId,
    values: { [statusRef]: status },
  });
  return (
    <BlockShell block={block} title={title} testid="kanban-board" extra={<Typography.Text type="secondary">{bound.rows.length} 项</Typography.Text>}>
      {columns.length === 0 ? <BlockEmpty hint="状态字段还没有可用分组" /> : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(columns.length, 4)}, minmax(150px, 1fr))`, gap: 12, overflowX: "auto", alignItems: "start" }}>
          {columns.map(column => {
            const rows = bound.rows.filter(row => String(row.values?.[statusRef] ?? "").trim() === column.value);
            return (
              <Card key={column.value} size="small" variant="borderless" styles={{ body: { padding: 8, background: BUSINESS_FILL_COLOR } }} title={<Space size={6}><span>{column.label}</span><Badge count={rows.length} showZero color={INK.faint} /></Space>}>
                {rows.length === 0 ? <BlockEmpty hint="这一列还没有记录" /> : (
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    {rows.map(row => (
                      <Card key={row.id} size="small" hoverable onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>
                        <Flex justify="space-between" gap={8} align="start">
                          <div style={{ minWidth: 0 }}>
                            <Typography.Text strong ellipsis>{String(row.values?.[titleRef] ?? "未命名记录")}</Typography.Text>
                            {descRef && row.values?.[descRef] != null && <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: "4px 0 0", fontSize: 12 }}>{String(row.values[descRef])}</Typography.Paragraph>}
                            {assigneeRef && row.values?.[assigneeRef] != null && <Tag style={{ marginTop: 6 }}>{String(row.values[assigneeRef])}</Tag>}
                          </div>
                          {block.props?.movable !== false && (
                            <Select size="small" aria-label="移动到状态" value={column.value} style={{ minWidth: 92 }} options={columns} onClick={event => event.stopPropagation()} onChange={value => move(row.id, value)} />
                          )}
                        </Flex>
                      </Card>
                    ))}
                  </Space>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </BlockShell>
  );
};

/** 月历与当日议程组合。slash-admin 的关键经验是日期导航和事件列表是一份状态。 */
const ScheduleCalendarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const titleRef = fieldRefOf(block, "titleFieldRef");
  const startRef = fieldRefOf(block, "startFieldRef");
  const endRef = fieldRefOf(block, "endFieldRef");
  const statusRef = fieldRefOf(block, "statusFieldRef");
  const [selected, setSelected] = React.useState(() => {
    const initial = dayjs(String(block.props?.initialDate ?? ""));
    return initial.isValid() ? initial : dayjs();
  });
  if (!bound || !titleRef || !startRef) {
    return <BlockShell block={block} title={title} testid="schedule-calendar"><BlockEmpty hint="日历尚未绑定标题和开始时间字段" /></BlockShell>;
  }
  const dateKey = selected.isValid() ? selected.format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD");
  const events = bound.rows.filter(row => {
    const start = dayjs(String(row.values?.[startRef] ?? ""));
    const end = endRef ? dayjs(String(row.values?.[endRef] ?? "")) : start;
    return start.isValid() && (start.format("YYYY-MM-DD") === dateKey || (end.isValid() && selected.isAfter(start.startOf("day")) && selected.isBefore(end.endOf("day"))));
  });
  const countOn = (date: dayjs.Dayjs) => bound.rows.filter(row => dayjs(String(row.values?.[startRef] ?? "")).format("YYYY-MM-DD") === date.format("YYYY-MM-DD")).length;
  return (
    <BlockShell block={block} title={title} testid="schedule-calendar" extra={block.props?.allowCreate === true ? <Button size="small" onClick={() => onAction?.("createRequest", { entityRef: bound.entityRef, date: dateKey })}>新建日程</Button> : undefined}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1.4fr) minmax(220px, 1fr)", gap: 16 }}>
        <ConfigProvider locale={zhCN}>
          <Calendar fullscreen={false} value={selected} onSelect={setSelected} cellRender={date => countOn(date) > 0 ? <Badge status="processing" /> : null} />
        </ConfigProvider>
        <div>
          <Typography.Title level={5} style={{ margin: "4px 0 10px" }}>{selected.format("M 月 D 日")}</Typography.Title>
          {events.length === 0 ? <BlockEmpty hint="这一天还没有日程" /> : (
            <List size="small" dataSource={events} renderItem={row => (
              <List.Item onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })} style={{ cursor: "pointer" }}>
                <List.Item.Meta title={String(row.values?.[titleRef] ?? "未命名日程")} description={(() => { const start = String(row.values?.[startRef] ?? ""); const end = endRef ? String(row.values?.[endRef] ?? "") : ""; return end && end !== start ? `${start} - ${end}` : start; })()} />
                {statusRef && row.values?.[statusRef] != null && <Tag>{String(row.values[statusRef])}</Tag>}
              </List.Item>
            )} />
          )}
        </div>
      </div>
    </BlockShell>
  );
};

/** 分类通知收件箱。沿用 Ant Design Pro NoticeIcon 的分类计数、已读弱化和清空边界。 */
const NotificationInboxRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const titleRef = fieldRefOf(block, "titleFieldRef");
  const contentRef = fieldRefOf(block, "contentFieldRef");
  const timeRef = fieldRefOf(block, "timeFieldRef");
  const categoryRef = fieldRefOf(block, "categoryFieldRef");
  const readRef = fieldRefOf(block, "readFieldRef");
  const [readIds, setReadIds] = React.useState<string[]>([]);
  const pageSize = Math.max(1, Number(block.props?.pageSize ?? 5) || 5);
  const [visible, setVisible] = React.useState(pageSize);
  const [activeGroup, setActiveGroup] = React.useState("全部");
  if (!bound || !titleRef || !contentRef || !timeRef) {
    return <BlockShell block={block} title={title} testid="notification-inbox"><BlockEmpty hint="通知中心尚未绑定标题、内容和时间字段" /></BlockShell>;
  }
  const isRead = (row: RuntimeRow) => readIds.includes(row.id) || (readRef ? [true, 1, "1", "true", "read", "已读"].includes(row.values?.[readRef] as never) : false);
  const categories = categoryRef ? Array.from(new Set(bound.rows.map(row => String(row.values?.[categoryRef] ?? "").trim()).filter(Boolean))) : [];
  const groups = ["全部", ...categories];
  const mark = (row: RuntimeRow) => {
    if (!isRead(row)) {
      setReadIds(current => [...current, row.id]);
      if (readRef) onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, values: { [readRef]: "read" } });
    }
    onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id });
  };
  const renderGroup = (group: string) => {
    const rows = (group === "全部" ? bound.rows : bound.rows.filter(row => String(row.values?.[categoryRef!] ?? "") === group)).slice(0, visible);
    return rows.length === 0 ? <BlockEmpty hint="这个分类还没有通知" /> : <List size="small" dataSource={rows} renderItem={row => (
      <List.Item onClick={() => mark(row)} style={{ cursor: "pointer", opacity: isRead(row) ? 0.58 : 1 }} extra={!isRead(row) ? <Badge status="processing" text="未读" /> : undefined}>
        <List.Item.Meta title={String(row.values?.[titleRef] ?? "未命名通知")} description={<><div>{String(row.values?.[contentRef] ?? "")}</div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{String(row.values?.[timeRef] ?? "")}</Typography.Text></>} />
      </List.Item>
    )} />;
  };
  const unread = bound.rows.filter(row => !isRead(row)).length;
  const activeRows = activeGroup === "全部" ? bound.rows : bound.rows.filter(row => String(row.values?.[categoryRef!] ?? "") === activeGroup);
  return (
    <BlockShell block={block} title={title} testid="notification-inbox" extra={<Space><Badge count={unread} showZero /><Button size="small" type="text" disabled={unread === 0} onClick={() => { const ids = bound.rows.filter(row => !isRead(row)).map(row => row.id); setReadIds(current => Array.from(new Set([...current, ...ids]))); onAction?.("submitRequest", { entityRef: bound.entityRef, rowIds: ids, operation: "markRead" }); }}>全部已读</Button></Space>}>
      <Tabs items={groups.map(group => ({ key: group, label: group, children: renderGroup(group) }))} onChange={group => { setActiveGroup(group); setVisible(pageSize); }} />
      {visible < activeRows.length && <Button block type="text" onClick={() => setVisible(current => current + pageSize)}>查看更多</Button>}
    </BlockShell>
  );
};

type RuntimeTreeNode = {
  key: string;
  label: string;
  title: React.ReactNode;
  children: RuntimeTreeNode[];
};

/** 可搜索层级导航。搜索保留命中节点的祖先链，清空后恢复搜索前的展开状态。 */
const TreeNavigatorRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const labelRef = fieldRefOf(block, "labelFieldRef");
  const parentRef = fieldRefOf(block, "parentFieldRef");
  const descRef = fieldRefOf(block, "descFieldRef");
  const [keyword, setKeyword] = React.useState("");
  const [expanded, setExpanded] = React.useState<React.Key[]>(() => block.props?.defaultExpandAll === true ? (bound?.rows.map(row => row.id) ?? []) : []);
  const expandedBeforeSearch = React.useRef<React.Key[] | null>(null);
  if (!bound || !labelRef || !parentRef) {
    return <BlockShell block={block} title={title} testid="tree-navigator"><BlockEmpty hint="层级导航尚未绑定名称和父节点字段" /></BlockShell>;
  }
  const nodes = new Map<string, RuntimeTreeNode>();
  for (const row of bound.rows) {
    const label = String(row.values?.[labelRef] ?? "未命名节点");
    const desc = descRef ? String(row.values?.[descRef] ?? "").trim() : "";
    nodes.set(row.id, { key: row.id, label, title: <span>{label}{desc && <Typography.Text type="secondary" style={{ marginInlineStart: 8, fontSize: 12 }}>{desc}</Typography.Text>}</span>, children: [] });
  }
  const roots: RuntimeTreeNode[] = [];
  for (const row of bound.rows) {
    const node = nodes.get(row.id)!;
    const parentId = String(row.values?.[parentRef] ?? "").trim();
    const parent = nodes.get(parentId);
    if (parent && parentId !== row.id) parent.children.push(node);
    else roots.push(node);
  }
  const normalized = keyword.trim().toLowerCase();
  const filterTree = (items: RuntimeTreeNode[]): RuntimeTreeNode[] => items.flatMap(node => {
    const matchedChildren = filterTree(node.children);
    if (!normalized || node.label.toLowerCase().includes(normalized) || matchedChildren.length > 0) return [{ ...node, children: matchedChildren }];
    return [];
  });
  const shown = filterTree(roots);
  const allShownKeys = (items: RuntimeTreeNode[]): React.Key[] => items.flatMap(node => [node.key, ...allShownKeys(node.children)]);
  const visibleExpanded = normalized ? allShownKeys(shown) : expanded;
  const changeKeyword = (next: string) => {
    if (next.trim() && !keyword.trim() && !expandedBeforeSearch.current) expandedBeforeSearch.current = expanded;
    if (!next.trim() && expandedBeforeSearch.current) {
      setExpanded(expandedBeforeSearch.current);
      expandedBeforeSearch.current = null;
    }
    setKeyword(next);
  };
  return (
    <BlockShell block={block} title={title} testid="tree-navigator" extra={<Typography.Text type="secondary">{bound.rows.length} 个节点</Typography.Text>}>
      {block.props?.searchable !== false && <Input allowClear value={keyword} placeholder="搜索层级节点" onChange={event => changeKeyword(event.target.value)} style={{ marginBottom: 8 }} />}
      {shown.length === 0 ? <BlockEmpty hint={normalized ? "没有匹配的层级节点" : "还没有层级数据"} /> : (
        <Tree
          showLine={block.props?.showLine !== false}
          blockNode
          treeData={shown}
          expandedKeys={visibleExpanded}
          onExpand={keys => setExpanded([...keys])}
          onSelect={keys => keys[0] && onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: String(keys[0]) })}
        />
      )}
    </BlockShell>
  );
};

/** 审批队列。待办与已处理是两种任务态；驳回必须先填写原因再提交。 */
const ApprovalQueueRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const titleRef = fieldRefOf(block, "titleFieldRef");
  const statusRef = fieldRefOf(block, "statusFieldRef");
  const applicantRef = fieldRefOf(block, "applicantFieldRef");
  const timeRef = fieldRefOf(block, "timeFieldRef");
  const summaryRef = fieldRefOf(block, "summaryFieldRef");
  const pendingValue = String(block.props?.pendingValue ?? "pending");
  const approvedValue = String(block.props?.approvedValue ?? "approved");
  const rejectedValue = String(block.props?.rejectedValue ?? "rejected");
  const [tab, setTab] = React.useState("pending");
  const [decisions, setDecisions] = React.useState<Record<string, string>>({});
  const [rejecting, setRejecting] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  if (!bound || !titleRef || !statusRef) {
    return <BlockShell block={block} title={title} testid="approval-queue"><BlockEmpty hint="审批队列尚未绑定标题和状态字段" /></BlockShell>;
  }
  const statusOf = (row: RuntimeRow) => decisions[row.id] ?? String(row.values?.[statusRef] ?? "");
  const pending = bound.rows.filter(row => statusOf(row) === pendingValue);
  const completed = bound.rows.filter(row => statusOf(row) !== pendingValue);
  const shown = tab === "pending" ? pending : completed;
  const submit = (rowId: string, outcome: string, comment = "") => {
    setDecisions(current => ({ ...current, [rowId]: outcome }));
    onAction?.("submitRequest", { entityRef: bound.entityRef, rowId, outcome, comment, values: { [statusRef]: outcome } });
  };
  return (
    <>
      <BlockShell block={block} title={title} testid="approval-queue" extra={<Badge count={pending.length} showZero />}>
        <Segmented block value={tab} options={[{ label: `待处理 ${pending.length}`, value: "pending" }, { label: `已处理 ${completed.length}`, value: "completed" }]} onChange={value => setTab(String(value))} style={{ marginBottom: 8 }} />
        {shown.length === 0 ? <BlockEmpty hint={tab === "pending" ? "当前没有待审批任务" : "还没有已处理任务"} /> : (
          <List size="small" dataSource={shown} renderItem={row => {
            const status = statusOf(row);
            return (
              <List.Item
                onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}
                style={{ cursor: "pointer" }}
                actions={status === pendingValue ? [
                  <Button key="reject" size="small" danger onClick={event => { event.stopPropagation(); setRejecting(row.id); setReason(""); }}>驳回</Button>,
                  <Button key="approve" size="small" type="primary" onClick={event => { event.stopPropagation(); submit(row.id, approvedValue); }}>通过</Button>,
                ] : [<Tag key="status" color={status === approvedValue ? "success" : "error"}>{status === approvedValue ? "已通过" : "已驳回"}</Tag>]}
              >
                <List.Item.Meta title={String(row.values?.[titleRef] ?? "未命名审批")} description={[applicantRef ? row.values?.[applicantRef] : "", timeRef ? row.values?.[timeRef] : "", summaryRef ? row.values?.[summaryRef] : ""].filter(Boolean).map(String).join(" · ")} />
              </List.Item>
            );
          }} />
        )}
      </BlockShell>
      <Modal title="填写驳回原因" open={Boolean(rejecting)} okText="确认驳回" okButtonProps={{ danger: true, disabled: !reason.trim() }} onCancel={() => setRejecting(null)} onOk={() => { if (rejecting && reason.trim()) submit(rejecting, rejectedValue, reason.trim()); setRejecting(null); }}>
        <Input.TextArea value={reason} onChange={event => setReason(event.target.value)} placeholder="请输入驳回原因" autoSize={{ minRows: 3, maxRows: 6 }} />
      </Modal>
    </>
  );
};

/** 审计变更记录。摘要行负责谁在何时做了什么，展开区只读展示旧值与新值。 */
const AuditTrailRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const actorRef = fieldRefOf(block, "actorFieldRef");
  const actionRef = fieldRefOf(block, "actionFieldRef");
  const timeRef = fieldRefOf(block, "timeFieldRef");
  const resultRef = fieldRefOf(block, "resultFieldRef");
  const fieldNameRef = fieldRefOf(block, "fieldNameFieldRef");
  const beforeRef = fieldRefOf(block, "beforeFieldRef");
  const afterRef = fieldRefOf(block, "afterFieldRef");
  const pageSize = Math.max(1, Number(block.props?.pageSize ?? 5) || 5);
  const [page, setPage] = React.useState(1);
  if (!bound || !actorRef || !actionRef || !timeRef) {
    return <BlockShell block={block} title={title} testid="audit-trail"><BlockEmpty hint="审计记录尚未绑定操作人、动作和时间字段" /></BlockShell>;
  }
  const rows = bound.rows.slice((page - 1) * pageSize, page * pageSize);
  return (
    <BlockShell block={block} title={title} testid="audit-trail" extra={<Typography.Text type="secondary">共 {bound.rows.length} 条</Typography.Text>}>
      {rows.length === 0 ? <BlockEmpty hint="还没有审计记录" /> : (
        <Collapse
          size="small"
          items={rows.map(row => ({
            key: row.id,
            forceRender: true,
            label: <Flex justify="space-between" gap={8} wrap><Space size={6}><Typography.Text strong>{String(row.values?.[actorRef] ?? "未知用户")}</Typography.Text><span>{String(row.values?.[actionRef] ?? "执行操作")}</span>{resultRef && row.values?.[resultRef] != null && <Tag>{String(row.values[resultRef])}</Tag>}</Space><Typography.Text type="secondary">{String(row.values?.[timeRef] ?? "")}</Typography.Text></Flex>,
            children: <div>{fieldNameRef && row.values?.[fieldNameRef] != null && <Typography.Paragraph style={{ marginBottom: 8 }}>变更字段：<Typography.Text strong>{String(row.values[fieldNameRef])}</Typography.Text></Typography.Paragraph>}<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><Typography.Text type="secondary">变更前</Typography.Text><Typography.Paragraph code style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{beforeRef ? String(row.values?.[beforeRef] ?? "空") : "未记录"}</Typography.Paragraph></div><div><Typography.Text type="secondary">变更后</Typography.Text><Typography.Paragraph code style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{afterRef ? String(row.values?.[afterRef] ?? "空") : "未记录"}</Typography.Paragraph></div></div></div>,
          }))}
          onChange={keys => { const key = Array.isArray(keys) ? keys[0] : keys; if (key) onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: String(key) }); }}
        />
      )}
      {bound.rows.length > pageSize && <Flex justify="end" style={{ marginTop: 10 }}><Pagination size="small" current={page} pageSize={pageSize} total={bound.rows.length} showSizeChanger={false} onChange={setPage} /></Flex>}
    </BlockShell>
  );
};

type ImportPhase = "select" | "mapping" | "validated" | "submitted";

/** 数据导入向导。文件、映射、校验和提交共享一条明确的状态链。 */
const DataImportWizardRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const sourceRef = fieldRefOf(block, "sourceFieldRef");
  const targetRef = fieldRefOf(block, "targetFieldRef");
  const statusRef = fieldRefOf(block, "statusFieldRef");
  const sampleRef = fieldRefOf(block, "sampleFieldRef");
  const issueRef = fieldRefOf(block, "issueFieldRef");
  const initialPhase = ["mapping", "validated", "submitted"].includes(String(block.props?.initialPhase))
    ? String(block.props?.initialPhase) as ImportPhase : "select";
  const [phase, setPhase] = React.useState<ImportPhase>(initialPhase);
  const [fileName, setFileName] = React.useState(String(block.props?.initialFileName ?? ""));
  if (!bound || !sourceRef || !targetRef || !statusRef) {
    return <BlockShell block={block} title={title} testid="data-import-wizard"><BlockEmpty hint="导入向导尚未绑定源字段、目标字段和校验状态" /></BlockShell>;
  }
  const invalidRows = bound.rows.filter(row => ["invalid", "error", "失败"].includes(String(row.values?.[statusRef] ?? "").toLowerCase()));
  const columns: TableColumnsType<RuntimeRow> = [
    { title: "源字段", key: "source", render: (_, row) => String(row.values?.[sourceRef] ?? "未命名字段") },
    { title: "目标字段", key: "target", render: (_, row) => String(row.values?.[targetRef] ?? "未映射") },
    ...(sampleRef ? [{ title: "样例", key: "sample", render: (_: unknown, row: RuntimeRow) => String(row.values?.[sampleRef] ?? "-") }] : []),
    { title: "校验", key: "status", render: (_, row) => { const value = String(row.values?.[statusRef] ?? "pending"); const failed = ["invalid", "error", "失败"].includes(value.toLowerCase()); return <Space size={4}><Tag color={failed ? "error" : value === "valid" || value === "通过" ? "success" : "default"}>{failed ? "异常" : value === "valid" || value === "通过" ? "通过" : "待校验"}</Tag>{failed && issueRef && <Typography.Text type="danger">{String(row.values?.[issueRef] ?? "")}</Typography.Text>}</Space>; } },
  ];
  const step = phase === "select" ? 0 : phase === "mapping" ? 1 : phase === "validated" ? 2 : 3;
  return (
    <BlockShell block={block} title={title} testid="data-import-wizard">
      <Steps size="small" current={step} items={[{ title: "选择文件" }, { title: "字段映射" }, { title: "校验数据" }, { title: "提交结果" }]} style={{ marginBottom: 16 }} />
      {phase === "select" && <Upload.Dragger accept=".csv,.xls,.xlsx" maxCount={1} beforeUpload={file => { setFileName(file.name); setPhase("mapping"); return false; }}><Typography.Paragraph strong>选择要导入的数据文件</Typography.Paragraph><Typography.Text type="secondary">支持 CSV、XLS 和 XLSX</Typography.Text></Upload.Dragger>}
      {phase !== "select" && phase !== "submitted" && <><Alert type="info" showIcon message={fileName || "已选择导入文件"} description={`共 ${bound.rows.length} 个字段映射，${invalidRows.length} 个异常`} style={{ marginBottom: 10 }} /><Table size="small" rowKey="id" columns={columns} dataSource={bound.rows} pagination={false} scroll={{ x: "max-content" }} /></>}
      {phase === "submitted" && <Result status="info" title="导入任务已提交" subTitle="后台处理结果会通过任务状态回传，区块不会伪造成功数量。" />}
      <Flex justify="end" gap={8} style={{ marginTop: 12 }}>
        {phase !== "select" && phase !== "submitted" && <Button onClick={() => setPhase(phase === "validated" ? "mapping" : "select")}>上一步</Button>}
        {phase === "mapping" && <Button type="primary" onClick={() => { onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "validateImport", fileName }); setPhase("validated"); }}>校验数据</Button>}
        {phase === "validated" && <Button type="primary" disabled={invalidRows.length > 0} onClick={() => { onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "startImport", fileName }); setPhase("submitted"); }}>开始导入</Button>}
      </Flex>
    </BlockShell>
  );
};

/** 异步任务监控。进度完全来自实体数据，区块只提交取消和重试意图。 */
const AsyncTaskMonitorRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const titleRef = fieldRefOf(block, "titleFieldRef");
  const statusRef = fieldRefOf(block, "statusFieldRef");
  const currentRef = fieldRefOf(block, "progressCurrentFieldRef");
  const totalRef = fieldRefOf(block, "progressTotalFieldRef");
  const errorRef = fieldRefOf(block, "errorFieldRef");
  const resultRef = fieldRefOf(block, "resultFieldRef");
  const timeRef = fieldRefOf(block, "timeFieldRef");
  if (!bound || !titleRef || !statusRef) return <BlockShell block={block} title={title} testid="async-task-monitor"><BlockEmpty hint="任务监控尚未绑定标题和状态字段" /></BlockShell>;
  const pending = String(block.props?.pendingValue ?? "pending");
  const running = String(block.props?.runningValue ?? "running");
  const succeeded = String(block.props?.succeededValue ?? "succeeded");
  const failed = String(block.props?.failedValue ?? "failed");
  const canceled = String(block.props?.canceledValue ?? "canceled");
  return <BlockShell block={block} title={title} testid="async-task-monitor" extra={<Typography.Text type="secondary">{bound.rows.length} 个任务</Typography.Text>}>
    {bound.rows.length === 0 ? <BlockEmpty hint="当前没有后台任务" /> : <List size="small" dataSource={bound.rows} renderItem={row => {
      const status = String(row.values?.[statusRef] ?? pending);
      const current = currentRef ? Number(row.values?.[currentRef] ?? 0) : 0;
      const total = totalRef ? Number(row.values?.[totalRef] ?? 0) : 0;
      const percent = total > 0 ? Math.min(100, Math.round(current / total * 100)) : 0;
      const active = status === pending || status === running;
      const statusLabel = status === succeeded ? "已完成" : status === failed ? "失败" : status === canceled ? "已取消" : status === running ? "执行中" : "等待中";
      return <List.Item actions={[
        ...(active && block.props?.cancelable !== false ? [<Button key="cancel" size="small" danger onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "cancelTask" })}>取消</Button>] : []),
        ...(status === failed ? [<Button key="retry" size="small" onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "retryTask" })}>重试</Button>] : []),
        ...(status === succeeded && resultRef ? [<Button key="result" size="small" type="link" onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id, result: row.values?.[resultRef] })}>查看结果</Button>] : []),
      ]}>
        <List.Item.Meta title={<Space><Typography.Text strong>{String(row.values?.[titleRef] ?? "未命名任务")}</Typography.Text><Tag color={status === succeeded ? "success" : status === failed ? "error" : status === running ? "processing" : "default"}>{statusLabel}</Tag></Space>} description={<div>{timeRef && <Typography.Text type="secondary">{String(row.values?.[timeRef] ?? "")}</Typography.Text>}{active && total > 0 && <Progress percent={percent} size="small" format={() => `${current}/${total}`} />}{status === failed && errorRef && <Alert type="error" showIcon message={String(row.values?.[errorRef] ?? "任务执行失败")} style={{ marginTop: 6 }} />}</div>} />
      </List.Item>;
    }} />}
  </BlockShell>;
};

const PERMISSION_KEYS = ["viewFieldRef", "createFieldRef", "editFieldRef", "deleteFieldRef"] as const;
const PERMISSION_LABELS = ["查看", "新建", "编辑", "删除"] as const;

/** 权限矩阵。固定四类动作，保留 inherit/allow/deny 三态并统一提交。 */
const PermissionMatrixRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const resourceRef = fieldRefOf(block, "resourceFieldRef");
  const refs = PERMISSION_KEYS.map(key => fieldRefOf(block, key));
  const [changes, setChanges] = React.useState<Record<string, Record<string, string>>>({});
  if (!bound || !resourceRef || !refs[0]) return <BlockShell block={block} title={title} testid="permission-matrix"><BlockEmpty hint="权限矩阵尚未绑定资源和查看权限字段" /></BlockShell>;
  const valueOf = (row: RuntimeRow, ref: string) => changes[row.id]?.[ref] ?? String(row.values?.[ref] ?? "inherit");
  const setValue = (rowId: string, ref: string, value: string) => setChanges(current => ({ ...current, [rowId]: { ...current[rowId], [ref]: value } }));
  const columns: TableColumnsType<RuntimeRow> = [{ title: "资源", key: "resource", fixed: "left", render: (_, row) => <Typography.Text strong>{String(row.values?.[resourceRef] ?? "未命名资源")}</Typography.Text> }, ...refs.flatMap((ref, index) => !ref ? [] : [{ title: <Checkbox checked={bound.rows.length > 0 && bound.rows.every(row => valueOf(row, ref) === "allow")} indeterminate={bound.rows.some(row => valueOf(row, ref) === "allow") && !bound.rows.every(row => valueOf(row, ref) === "allow")} onChange={event => bound.rows.forEach(row => setValue(row.id, ref, event.target.checked ? "allow" : "deny"))}>{PERMISSION_LABELS[index]}</Checkbox>, key: ref, align: "center" as const, render: (_: unknown, row: RuntimeRow) => <Segmented size="small" value={valueOf(row, ref)} options={[{ label: "继承", value: "inherit" }, { label: "允许", value: "allow" }, { label: "拒绝", value: "deny" }]} onChange={value => setValue(row.id, ref, String(value))} /> }])];
  const save = () => onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "savePermissions", changes: bound.rows.map(row => ({ rowId: row.id, permissions: Object.fromEntries(refs.flatMap(ref => ref ? [[ref, valueOf(row, ref)]] : [])) })) });
  return <BlockShell block={block} title={title} testid="permission-matrix" extra={<Button size="small" type="primary" disabled={Object.keys(changes).length === 0} onClick={save}>保存权限</Button>}>
    {bound.rows.length === 0 ? <BlockEmpty hint="还没有可配置的资源" /> : <Table size="small" rowKey="id" columns={columns} dataSource={bound.rows} pagination={false} scroll={{ x: "max-content" }} />}
  </BlockShell>;
};

/** 数据导出任务。范围、字段、格式和上限在提交前全部显式确认。 */
const DataExportPanelRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, selection, fieldLabelOf, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound) return <BlockShell block={block} title={title} testid="data-export-panel"><BlockEmpty hint="导出面板尚未绑定有效实体" /></BlockShell>;
  const fields = fieldRefListOf(block, "fieldRefs").length > 0 ? fieldRefListOf(block, "fieldRefs") : Array.from(new Set(bound.rows.flatMap(row => Object.keys(row.values ?? {})))).slice(0, 8);
  const selectedRowIds = selection?.rowIds?.[bound.entityRef] ?? [];
  const [scope, setScope] = React.useState(selectedRowIds.length > 0 ? "selected" : "all");
  const [selectedFields, setSelectedFields] = React.useState<string[]>(fields);
  const [format, setFormat] = React.useState("xlsx");
  const [submitted, setSubmitted] = React.useState(false);
  const limit = Math.max(1, Number(block.props?.maxRows ?? 2000) || 2000);
  const exportCount = scope === "selected" ? selectedRowIds.length : Math.min(bound.rows.length, limit);
  if (fields.length === 0) return <BlockShell block={block} title={title} testid="data-export-panel"><BlockEmpty hint="当前实体没有可导出的字段" /></BlockShell>;
  const submit = () => {
    onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "startExport", scope, rowIds: scope === "selected" ? selectedRowIds : undefined, fieldRefs: selectedFields, format, maxRows: limit });
    setSubmitted(true);
  };
  return <BlockShell block={block} title={title} testid="data-export-panel">
    {submitted ? <Result status="info" title="导出任务已提交" subTitle="文件生成完成后由宿主提供下载结果。" extra={<Button onClick={() => setSubmitted(false)}>继续导出</Button>} /> : <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Alert type="warning" showIcon message={`单次最多导出 ${limit} 条`} description={bound.rows.length > limit ? `当前共 ${bound.rows.length} 条，将按上限导出。` : `当前范围预计导出 ${exportCount} 条。`} />
      <div><Typography.Text strong>导出范围</Typography.Text><Segmented block value={scope} options={[{ label: `全部记录 ${bound.rows.length}`, value: "all" }, { label: `已选记录 ${selectedRowIds.length}`, value: "selected", disabled: selectedRowIds.length === 0 }]} onChange={value => setScope(String(value))} style={{ marginTop: 6 }} /></div>
      <div><Flex justify="space-between"><Typography.Text strong>导出字段</Typography.Text><Button type="link" size="small" onClick={() => setSelectedFields(selectedFields.length === fields.length ? [] : fields)}>{selectedFields.length === fields.length ? "清空" : "全选"}</Button></Flex><Checkbox.Group value={selectedFields} onChange={values => setSelectedFields(values.map(String))} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>{fields.map(field => <Checkbox key={field} value={field}>{fieldLabelOf?.(bound.entityRef, field) ?? field}</Checkbox>)}</Checkbox.Group></div>
      <Flex justify="space-between" align="center"><Segmented value={format} options={[{ label: "Excel", value: "xlsx" }, { label: "CSV", value: "csv" }]} onChange={value => setFormat(String(value))} /><Button type="primary" disabled={selectedFields.length === 0 || exportCount === 0} onClick={submit}>开始导出</Button></Flex>
    </Space>}
  </BlockShell>;
};

type BulkEditMode = "unchanged" | "set" | "clear";

/** 批量编辑。每个字段独立声明保持、改成或清空，只作用于现有选择态。 */
const BulkEditPanelRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, selection, fieldLabelOf, fieldTypeOf, enumOptionsOf, fieldSchemaOf, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  if (!bound) return <BlockShell block={block} title={title} testid="bulk-edit-panel"><BlockEmpty hint="批量编辑尚未绑定有效实体" /></BlockShell>;
  const fields = boundFieldIds(block, bound.rows);
  const rowIds = selection?.rowIds?.[bound.entityRef] ?? [];
  const [modes, setModes] = React.useState<Record<string, BulkEditMode>>({});
  const changedFields = fields.filter(field => (modes[field] ?? "unchanged") !== "unchanged");
  if (fields.length === 0) return <BlockShell block={block} title={title} testid="bulk-edit-panel"><BlockEmpty hint="当前实体没有可批量编辑的字段" /></BlockShell>;
  return <BlockShell block={block} title={title} testid="bulk-edit-panel" extra={<Badge count={rowIds.length} showZero overflowCount={999} />}>
    {rowIds.length === 0 ? <Alert type="warning" showIcon message="请先在目标列表选择要编辑的记录" /> : <ProForm submitter={{ searchConfig: { submitText: `更新 ${rowIds.length} 条记录` }, resetButtonProps: false }} onFinish={async rawValues => { const values = (rawValues ?? {}) as Record<string, unknown>; const updates = Object.fromEntries(changedFields.map(field => [field, modes[field] === "clear" ? null : values[field]])); onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "bulkEdit", rowIds, values: updates }); return true; }}>
      <Alert type="info" showIcon message={`将批量处理 ${rowIds.length} 条记录`} description="每个字段可保持不变、改成指定值或清空；保持不变的字段不会进入提交数据。" style={{ marginBottom: 12 }} />
      {fields.map(field => { const mode = modes[field] ?? "unchanged"; return <div key={field} style={{ display: "grid", gridTemplateColumns: "140px minmax(0, 1fr)", gap: 10, alignItems: "start", marginBottom: 10 }}><Select value={mode} options={[{ label: "保持不变", value: "unchanged" }, { label: "改成", value: "set" }, { label: "清空", value: "clear" }]} onChange={value => setModes(current => ({ ...current, [field]: value }))} />{mode === "set" ? formItemFor({ entityRef: bound.entityRef, fieldLabelOf, fieldTypeOf, enumOptionsOf, fieldSchemaOf, entityRows }, field) : <Typography.Text type="secondary" style={{ paddingTop: 6 }}>{fieldLabelOf?.(bound.entityRef, field) ?? field}{mode === "clear" ? "将被清空" : "保留原值"}</Typography.Text>}</div>; })}
    </ProForm>}
  </BlockShell>;
};

/** 角色/团队成员分配。当前成员与候选成员是两个集合，加入和移除分别提交。 */
const MemberAssignmentRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "").trim();
  const bound = rowsOfBinding(block, entityRows);
  const nameRef = fieldRefOf(block, "nameFieldRef");
  const membershipRef = fieldRefOf(block, "membershipFieldRef");
  const accountRef = fieldRefOf(block, "accountFieldRef");
  const avatarRef = fieldRefOf(block, "avatarFieldRef");
  const statusRef = fieldRefOf(block, "statusFieldRef");
  const memberValue = String(block.props?.memberValue ?? "member");
  const [tab, setTab] = React.useState("members");
  const [keyword, setKeyword] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [localMembership, setLocalMembership] = React.useState<Record<string, string>>({});
  if (!bound || !nameRef || !membershipRef) return <BlockShell block={block} title={title} testid="member-assignment"><BlockEmpty hint="成员分配尚未绑定姓名和成员状态字段" /></BlockShell>;
  const isMember = (row: RuntimeRow) => (localMembership[row.id] ?? String(row.values?.[membershipRef] ?? "")) === memberValue;
  const members = bound.rows.filter(isMember);
  const candidates = bound.rows.filter(row => !isMember(row));
  const source = tab === "members" ? members : candidates;
  const normalized = keyword.trim().toLowerCase();
  const shown = source.filter(row => !normalized || [row.values?.[nameRef], accountRef ? row.values?.[accountRef] : ""].some(value => String(value ?? "").toLowerCase().includes(normalized)));
  const remove = (rowId: string) => { setLocalMembership(current => ({ ...current, [rowId]: "candidate" })); onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "removeMembers", rowIds: [rowId] }); };
  const add = () => { setLocalMembership(current => ({ ...current, ...Object.fromEntries(selected.map(id => [id, memberValue])) })); onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "addMembers", rowIds: selected }); setSelected([]); setTab("members"); };
  return <BlockShell block={block} title={title} testid="member-assignment" extra={tab === "candidates" ? <Button size="small" type="primary" disabled={selected.length === 0} onClick={add}>添加所选 {selected.length || ""}</Button> : undefined}>
    <Segmented block value={tab} options={[{ label: `当前成员 ${members.length}`, value: "members" }, { label: `可添加 ${candidates.length}`, value: "candidates" }]} onChange={value => { setTab(String(value)); setSelected([]); }} style={{ marginBottom: 8 }} />
    <Input allowClear value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索姓名或账号" style={{ marginBottom: 8 }} />
    {shown.length === 0 ? <BlockEmpty hint={normalized ? "没有匹配的成员" : tab === "members" ? "当前还没有成员" : "没有可添加的候选人"} /> : <List size="small" dataSource={shown} renderItem={row => <List.Item actions={tab === "members" ? [<Button key="remove" type="link" danger size="small" onClick={() => remove(row.id)}>移除</Button>] : undefined}>
      {tab === "candidates" && <Checkbox checked={selected.includes(row.id)} onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} style={{ marginInlineEnd: 10 }} />}
      <List.Item.Meta avatar={<Avatar src={avatarRef ? String(row.values?.[avatarRef] ?? "") : undefined}>{String(row.values?.[nameRef] ?? "?").slice(0, 1)}</Avatar>} title={<Space>{String(row.values?.[nameRef] ?? "未命名成员")}{statusRef && row.values?.[statusRef] != null && <Tag>{String(row.values[statusRef])}</Tag>}</Space>} description={accountRef ? String(row.values?.[accountRef] ?? "") : undefined} />
    </List.Item>} />}
  </BlockShell>;
};

const chartColors = (palette?: { primary: string; categorical: readonly string[] }) =>
  palette?.categorical?.length ? [...palette.categorical] : ["#1677ff", "#52c41a", "#faad14", "#722ed1", "#13c2c2", "#eb2f96"];

function AnalysisChart({ block, title, testid, option, hint }: { block: ExperienceBlockInstance; title: string; testid: string; option?: Record<string, unknown>; hint: string }) {
  return <BlockShell block={block} title={title} testid={testid}>{option ? <React.Suspense fallback={<div style={{ height: 190 }} />}><LazyEchartsChart option={option} height={190} ariaLabel={title || testid} /></React.Suspense> : <BlockEmpty hint={hint} />}</BlockShell>;
}

const TimeSeriesAnomalyChartRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const time = fieldRefOf(block, "timeFieldRef"); const value = fieldRefOf(block, "valueFieldRef"); const lower = fieldRefOf(block, "lowerFieldRef"); const upper = fieldRefOf(block, "upperFieldRef"); const anomaly = fieldRefOf(block, "anomalyFieldRef");
  if (!bound || !time || !value) return <AnalysisChart block={block} title={String(block.props?.title ?? "时序异常")} testid="time-series-anomaly-chart" hint="异常图尚未绑定时间和值字段" />;
  const numeric=(input:unknown)=>input==null||input===""||!Number.isFinite(Number(input))?null:Number(input); const rows = [...bound.rows].sort((a,b)=>String(a.values?.[time]).localeCompare(String(b.values?.[time]))); const labels = rows.map(r=>String(r.values?.[time]??"")); const observed: Record<string, unknown> = { name:"观测值", type:"line", smooth:true, connectNulls:false, data:rows.map(r=>numeric(r.values?.[value])), symbolSize:4 };
  const series: Array<Record<string, unknown>> = []; if (lower && upper) { const low=rows.map(r=>numeric(r.values?.[lower])),range=rows.map((r,index)=>{const lo=low[index],hi=numeric(r.values?.[upper]);return lo==null||hi==null?null:Math.max(0,hi-lo)}); series.push({ name:"下限", type:"line", stack:"confidence", data:low, lineStyle:{opacity:0}, symbol:"none", tooltip:{show:false} }, { name:"期望区间", type:"line", stack:"confidence", data:range, lineStyle:{opacity:0}, symbol:"none", areaStyle:{color:"rgba(22,119,255,.14)"} }); } series.push(observed);
  const points = anomaly ? rows.flatMap((r,index)=>enabledValue(r.values?.[anomaly],"anomaly")?[{coord:[index,Number(r.values?.[value])], value:Number(r.values?.[value]), rowId:r.id}]:[]) : [];
  observed.markPoint = { data: points, itemStyle:{color:"#cf1322"}, symbolSize:28 };
  return <AnalysisChart block={block} title={String(block.props?.title ?? "时序异常")} testid="time-series-anomaly-chart" option={rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},legend:{bottom:0},xAxis:{type:"category",data:labels},yAxis:{type:"value"},series}:undefined} hint="当前没有可用的时序数据" />;
};
const CohortRetentionChartRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette }) => {
  if (children != null) return <>{children}</>;
  const bound=rowsOfBinding(block,entityRows), cohort=fieldRefOf(block,"cohortFieldRef"), period=fieldRefOf(block,"periodFieldRef"), rate=fieldRefOf(block,"rateFieldRef"); if(!bound||!cohort||!period||!rate)return <AnalysisChart block={block} title={String(block.props?.title??"留存队列")} testid="cohort-retention-chart" hint="留存图尚未绑定队列、周期和留存率" />;
  const xs=Array.from(new Set(bound.rows.map(r=>String(r.values?.[period]??"")).filter(Boolean))),ys=Array.from(new Set(bound.rows.map(r=>String(r.values?.[cohort]??"")).filter(Boolean))),map=new Map(bound.rows.flatMap(r=>{const raw=r.values?.[rate];return raw==null||raw===""||!Number.isFinite(Number(raw))?[]:[[`${r.values?.[cohort]}\u0000${r.values?.[period]}`,Number(raw)] as const]})),data=ys.flatMap((y,yi)=>xs.flatMap((x,xi)=>map.has(`${y}\u0000${x}`)?[[xi,yi,map.get(`${y}\u0000${x}`)]]:[])),max=Math.max(1,...data.map(x=>Number(x[2])));
  return <AnalysisChart block={block} title={String(block.props?.title??"留存队列")} testid="cohort-retention-chart" option={data.length?{animation:false,tooltip:{position:"top",confine:true,formatter:(p:{value:number[]})=>`${ys[p.value[1]]} · ${xs[p.value[0]]}<br/>${p.value[2]}%`},grid:{left:8,right:8,top:8,bottom:8,containLabel:true},xAxis:{type:"category",data:xs},yAxis:{type:"category",data:ys},visualMap:{min:0,max,show:false,inRange:{color:["#f6ffed",...(chartColors(chartPalette).slice(0,2))]}},series:[{type:"heatmap",data}]}:undefined} hint="当前没有完整的留存队列" />;
};
const UptimeStatusTimelineRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  const { token } = antdTheme.useToken();
  if (children != null) return <>{children}</>;
  const bound=rowsOfBinding(block,entityRows),time=fieldRefOf(block,"timeFieldRef"),status=fieldRefOf(block,"statusFieldRef"); if(!bound||!time||!status)return <AnalysisChart block={block} title={String(block.props?.title??"可用性时间线")} testid="uptime-status-timeline" hint="时间线尚未绑定时间和状态" />; const rows=[...bound.rows].sort((a,b)=>String(a.values?.[time]).localeCompare(String(b.values?.[time]))),colors={success:"#52c41a",synced:"#52c41a",running:token.colorPrimary,failed:"#ff4d4f",error:"#ff4d4f",warning:"#faad14",unknown:"#d9d9d9"};
  return <AnalysisChart block={block} title={String(block.props?.title??"可用性时间线")} testid="uptime-status-timeline" option={rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time]))},yAxis:{show:false,min:0,max:1},series:[{type:"bar",barWidth:"70%",data:rows.map(r=>({value:1,itemStyle:{color:colors[String(r.values?.[status]??"unknown").toLowerCase() as keyof typeof colors]??colors.unknown}}))}]}:undefined} hint="当前没有运行窗口" />;
};
const PercentileBandChartRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children != null) return <>{children}</>;
  const bound=rowsOfBinding(block,entityRows),time=fieldRefOf(block,"timeFieldRef"),p50=fieldRefOf(block,"p50FieldRef"),p95=fieldRefOf(block,"p95FieldRef"),p99=fieldRefOf(block,"p99FieldRef"); if(!bound||!time||!p50||!p95||!p99)return <AnalysisChart block={block} title={String(block.props?.title??"延迟分位")} testid="percentile-band-chart" hint="分位图尚未绑定时间和分位字段" />; const rows=[...bound.rows].sort((a,b)=>String(a.values?.[time]).localeCompare(String(b.values?.[time])));
  const numeric=(input:unknown)=>input==null||input===""||!Number.isFinite(Number(input))?null:Number(input); return <AnalysisChart block={block} title={String(block.props?.title??"延迟分位")} testid="percentile-band-chart" option={rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},legend:{bottom:0},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time]))},yAxis:{type:"value"},series:[{name:"P50",type:"line",connectNulls:false,data:rows.map(r=>numeric(r.values?.[p50]))},{name:"P95",type:"line",connectNulls:false,data:rows.map(r=>numeric(r.values?.[p95]))},{name:"P99",type:"line",connectNulls:false,data:rows.map(r=>numeric(r.values?.[p99]))}]}:undefined} hint="当前没有分位数据" />;
};

function groupedValues(rows: RuntimeRow[], dimension: string, valueRef?: string) {
  const values = new Map<string, number>();
  for (const row of rows) { const key = String(row.values?.[dimension] ?? "").trim(); if (!key) continue; values.set(key, (values.get(key) ?? 0) + (valueRef ? Number(row.values?.[valueRef] ?? 0) : 1)); }
  return [...values.entries()].map(([name, value]) => ({ name, value }));
}

const WaterfallChartRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "增减构成"); const bound = rowsOfBinding(block, entityRows); const categoryRef = fieldRefOf(block, "categoryFieldRef"); const valueRef = fieldRefOf(block, "valueFieldRef");
  if (!bound || !categoryRef || !valueRef) return <AnalysisChart block={block} title={title} testid="waterfall-chart" hint="瀑布图尚未绑定分类和增减值字段" />;
  const data = groupedValues(bound.rows, categoryRef, valueRef); let running = 0; const base: number[] = []; const values: number[] = [];
  for (const item of data) { const next = running + item.value; base.push(Math.min(running, next)); values.push(Math.abs(item.value)); running = next; }
  const option = data.length ? { animation: false, tooltip: { trigger: "axis", confine: true }, grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true }, xAxis: { type: "category", data: data.map(item => item.name), axisLabel: { fontSize: 10 } }, yAxis: { type: "value" }, series: [{ type: "bar", stack: "total", silent: true, itemStyle: { color: "transparent" }, data: base }, { type: "bar", stack: "total", data: values, itemStyle: { color: (params: { dataIndex: number }) => data[params.dataIndex].value >= 0 ? chartColors(chartPalette)[0] : "#cf1322" }, label: { show: true, position: "top", formatter: (params: { dataIndex: number }) => String(data[params.dataIndex].value) } }] } : undefined;
  return <AnalysisChart block={block} title={title} testid="waterfall-chart" option={option} hint="当前分类没有可计算的增减值" />;
};

const FunnelChartRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "转化漏斗"); const bound = rowsOfBinding(block, entityRows); const stageRef = fieldRefOf(block, "stageFieldRef"); const valueRef = fieldRefOf(block, "valueFieldRef");
  if (!bound || !stageRef) return <AnalysisChart block={block} title={title} testid="funnel-chart" hint="漏斗图尚未绑定阶段字段" />;
  const raw = groupedValues(bound.rows, stageRef, valueRef); const declared = Array.isArray(block.props?.stages) ? block.props.stages.map(String) : []; const data = (declared.length ? declared.flatMap(name => { const item = raw.find(row => row.name === name); return item ? [item] : []; }) : raw.sort((a, b) => b.value - a.value)); const first = data[0]?.value || 1;
  const option = data.length ? { animation: false, color: chartColors(chartPalette), tooltip: { trigger: "item", confine: true, formatter: (params: { name: string; value: number }) => `${params.name}<br/>${params.value} · ${Math.round(params.value / first * 100)}%` }, series: [{ type: "funnel", left: "5%", right: "5%", top: 8, bottom: 8, minSize: "20%", sort: "none", gap: 2, label: { show: true, position: "inside", color: "#fff", formatter: (params: { name: string; value: number }) => `${params.name} ${params.value}` }, data }] } : undefined;
  return <AnalysisChart block={block} title={title} testid="funnel-chart" option={option} hint="当前没有可用的漏斗阶段" />;
};

const DistributionHistogramRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "数值分布"); const bound = rowsOfBinding(block, entityRows); const valueRef = fieldRefOf(block, "valueFieldRef"); const values = bound && valueRef ? bound.rows.map(row => Number(row.values?.[valueRef])).filter(Number.isFinite) : [];
  if (!bound || !valueRef) return <AnalysisChart block={block} title={title} testid="distribution-histogram" hint="直方图尚未绑定数值字段" />;
  const bins = Math.max(3, Math.min(12, Number(block.props?.bins ?? 6))); const min = values.length ? Math.min(...values) : 0; const max = values.length ? Math.max(...values) : 0; const width = max === min ? 1 : (max - min) / bins; const counts = Array.from({ length: bins }, () => 0); values.forEach(value => { counts[Math.min(bins - 1, Math.floor((value - min) / width))] += 1; }); const labels = counts.map((_, index) => `${(min + index * width).toFixed(0)}–${(min + (index + 1) * width).toFixed(0)}`);
  const option = values.length ? { animation: false, tooltip: { trigger: "axis", confine: true }, grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true }, xAxis: { type: "category", data: labels, axisLabel: { fontSize: BLOCK_CHART_AXIS_FONT_SIZE, rotate: 25 } }, yAxis: { type: "value", minInterval: 1 }, series: [{ type: "bar", data: counts, barGap: 0, itemStyle: { color: chartColors(chartPalette)[0] } }] } : undefined;
  return <AnalysisChart block={block} title={title} testid="distribution-histogram" option={option} hint="当前没有可计算的数值" />;
};

const HeatmapMatrixRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "热力矩阵"); const bound = rowsOfBinding(block, entityRows); const xRef = fieldRefOf(block, "xFieldRef"); const yRef = fieldRefOf(block, "yFieldRef"); const valueRef = fieldRefOf(block, "valueFieldRef");
  if (!bound || !xRef || !yRef) return <AnalysisChart block={block} title={title} testid="heatmap-matrix" hint="热力矩阵尚未绑定横纵维度" />;
  const xs = Array.from(new Set(bound.rows.map(row => String(row.values?.[xRef] ?? "")).filter(Boolean))).slice(0, 12); const ys = Array.from(new Set(bound.rows.map(row => String(row.values?.[yRef] ?? "")).filter(Boolean))).slice(0, 10); const map = new Map<string, number>(); bound.rows.forEach(row => { const x = String(row.values?.[xRef] ?? ""); const y = String(row.values?.[yRef] ?? ""); if (x && y) map.set(`${x}\u0000${y}`, (map.get(`${x}\u0000${y}`) ?? 0) + (valueRef ? Number(row.values?.[valueRef] ?? 0) : 1)); }); const data = ys.flatMap((y, yi) => xs.map((x, xi) => [xi, yi, map.get(`${x}\u0000${y}`) ?? 0])); const max = Math.max(1, ...data.map(item => Number(item[2])));
  const option = xs.length && ys.length ? { animation: false, tooltip: { position: "top", confine: true }, grid: { left: 8, right: 8, top: 8, bottom: 24, containLabel: true }, xAxis: { type: "category", data: xs, splitArea: { show: true }, axisLabel: { fontSize: BLOCK_CHART_AXIS_FONT_SIZE } }, yAxis: { type: "category", data: ys, splitArea: { show: true }, axisLabel: { fontSize: BLOCK_CHART_AXIS_FONT_SIZE } }, visualMap: { min: 0, max, show: false, inRange: { color: ["#f0f5ff", chartColors(chartPalette)[0]] } }, series: [{ type: "heatmap", data, label: { show: data.length <= 48 } }] } : undefined;
  return <AnalysisChart block={block} title={title} testid="heatmap-matrix" option={option} hint="当前没有可组成矩阵的数据" />;
};

const TreemapBreakdownRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "层级构成"); const bound = rowsOfBinding(block, entityRows); const labelRef = fieldRefOf(block, "labelFieldRef"); const valueRef = fieldRefOf(block, "valueFieldRef"); const parentRef = fieldRefOf(block, "parentFieldRef");
  if (!bound || !labelRef || !valueRef) return <AnalysisChart block={block} title={title} testid="treemap-breakdown" hint="矩形树图尚未绑定名称和数值字段" />;
  const nodes = new Map(bound.rows.map(row => [row.id, { name: String(row.values?.[labelRef] ?? row.id), value: Number(row.values?.[valueRef] ?? 0), children: [] as Array<Record<string, unknown>> }])); const roots: Array<Record<string, unknown>> = []; bound.rows.forEach(row => { const node = nodes.get(row.id)!; const parent = parentRef ? String(row.values?.[parentRef] ?? "") : ""; const owner = parent ? nodes.get(parent) : undefined; if (owner) owner.children.push(node); else roots.push(node); }); roots.forEach(node => { if (!Array.isArray(node.children) || node.children.length === 0) delete node.children; });
  const option = roots.length ? { animation: false, color: chartColors(chartPalette), tooltip: { confine: true }, series: [{ type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, label: { show: true, formatter: "{b}\n{c}" }, upperLabel: { show: true, height: 20 }, data: roots }] } : undefined;
  return <AnalysisChart block={block} title={title} testid="treemap-breakdown" option={option} hint="当前没有可组成层级构成的数据" />;
};

const GaugeProgressRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "目标完成度"); const bound = rowsOfBinding(block, entityRows); const currentRef = fieldRefOf(block, "currentFieldRef"); const targetRef = fieldRefOf(block, "targetFieldRef"); const row = bound?.rows[0];
  if (!bound || !currentRef || !targetRef || !row) return <AnalysisChart block={block} title={title} testid="gauge-progress" hint="仪表图尚未绑定当前值和目标值" />;
  const current = Number(row.values?.[currentRef] ?? 0); const target = Number(row.values?.[targetRef] ?? 0); const percent = target > 0 ? Math.max(0, Math.min(100, current / target * 100)) : 0; const option = target > 0 ? { animation: false, series: [{ type: "gauge", startAngle: 210, endAngle: -30, min: 0, max: 100, progress: { show: true, width: 12, itemStyle: { color: chartColors(chartPalette)[0] } }, axisLine: { lineStyle: { width: 12 } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, detail: { valueAnimation: false, formatter: `${percent.toFixed(0)}%\n${current} / ${target}`, fontSize: 18, offsetCenter: [0, "12%"] }, data: [{ value: percent }] }] } : undefined;
  return <AnalysisChart block={block} title={title} testid="gauge-progress" option={option} hint="目标值必须大于零" />;
};

const GanttScheduleRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "计划排期"); const bound = rowsOfBinding(block, entityRows); const labelRef = fieldRefOf(block, "labelFieldRef"); const startRef = fieldRefOf(block, "startFieldRef"); const endRef = fieldRefOf(block, "endFieldRef"); const groupRef = fieldRefOf(block, "groupFieldRef");
  if (!bound || !labelRef || !startRef || !endRef) return <AnalysisChart block={block} title={title} testid="gantt-schedule" hint="甘特排期尚未绑定名称、开始和结束字段" />;
  const rows = bound.rows.flatMap((row, index) => { const start = dayjs(String(row.values?.[startRef] ?? "")); const end = dayjs(String(row.values?.[endRef] ?? "")); return start.isValid() && end.isValid() && !end.isBefore(start) ? [{ name: String(row.values?.[labelRef] ?? row.id), group: groupRef ? String(row.values?.[groupRef] ?? "") : "", value: [index, start.valueOf(), end.valueOf()] }] : []; }); const colors = chartColors(chartPalette);
  const option = rows.length ? { animation: false, tooltip: { confine: true, formatter: (p: { data: { name: string; group: string; value: number[] } }) => `${p.data.name}<br/>${dayjs(p.data.value[1]).format("MM-DD")} 至 ${dayjs(p.data.value[2]).format("MM-DD")}${p.data.group ? `<br/>${p.data.group}` : ""}` }, grid: { left: 80, right: 10, top: 8, bottom: 24 }, xAxis: { type: "time", minInterval: 86400000, axisLabel: { fontSize: BLOCK_CHART_AXIS_FONT_SIZE, formatter: (value: number) => dayjs(value).format("MM-DD") } }, yAxis: { type: "category", data: rows.map(row => row.name), axisLabel: { fontSize: BLOCK_CHART_AXIS_FONT_SIZE, width: 68, overflow: "truncate" } }, series: [{ type: "custom", renderItem: (params: { dataIndex: number; coordSys: { x: number; y: number; width: number; height: number } }, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => { const category = api.value(0); const start = api.coord([api.value(1), category]); const end = api.coord([api.value(2), category]); const height = Math.min(18, api.size([0, 1])[1] * 0.55); return { type: "rect", shape: { x: start[0], y: start[1] - height / 2, width: Math.max(2, end[0] - start[0]), height }, style: { fill: colors[params.dataIndex % colors.length] } }; }, encode: { x: [1, 2], y: 0 }, data: rows }] } : undefined;
  return <AnalysisChart block={block} title={title} testid="gantt-schedule" option={option} hint="当前没有有效排期记录" />;
};

const SankeyFlowRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "关系流向"); const bound = rowsOfBinding(block, entityRows); const sourceRef = fieldRefOf(block, "sourceFieldRef"); const targetRef = fieldRefOf(block, "targetFieldRef"); const valueRef = fieldRefOf(block, "valueFieldRef");
  if (!bound || !sourceRef || !targetRef) return <AnalysisChart block={block} title={title} testid="sankey-flow" hint="桑基图尚未绑定来源和目标字段" />;
  const links = bound.rows.flatMap(row => { const source = String(row.values?.[sourceRef] ?? "").trim(); const target = String(row.values?.[targetRef] ?? "").trim(); return source && target && source !== target ? [{ source, target, value: valueRef ? Number(row.values?.[valueRef] ?? 0) : 1 }] : []; }); const nodes = Array.from(new Set(links.flatMap(link => [link.source, link.target]))).map(name => ({ name }));
  const option = links.length ? { animation: false, color: chartColors(chartPalette), tooltip: { trigger: "item", confine: true }, series: [{ type: "sankey", left: 8, right: 8, top: 8, bottom: 8, emphasis: { focus: "adjacency" }, nodeAlign: "justify", lineStyle: { color: "gradient", curveness: 0.5 }, label: { fontSize: 10 }, data: nodes, links }] } : undefined;
  return <AnalysisChart block={block} title={title} testid="sankey-flow" option={option} hint="当前没有有效的来源到目标关系" />;
};

function quartiles(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const at = (p: number) => { const index = (sorted.length - 1) * p; const low = Math.floor(index); const high = Math.ceil(index); return sorted[low] + (sorted[high] - sorted[low]) * (index - low); }; return sorted.length ? [sorted[0], at(0.25), at(0.5), at(0.75), sorted[sorted.length - 1]] : [0, 0, 0, 0, 0]; }

const BoxPlotDistributionRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "箱线分布"); const bound = rowsOfBinding(block, entityRows); const categoryRef = fieldRefOf(block, "categoryFieldRef"); const valueRef = fieldRefOf(block, "valueFieldRef");
  if (!bound || !categoryRef || !valueRef) return <AnalysisChart block={block} title={title} testid="boxplot-distribution" hint="箱线图尚未绑定分类和数值字段" />;
  const groups = new Map<string, number[]>(); bound.rows.forEach(row => { const category = String(row.values?.[categoryRef] ?? "").trim(); const value = Number(row.values?.[valueRef]); if (category && Number.isFinite(value)) groups.set(category, [...(groups.get(category) ?? []), value]); }); const entries = [...groups.entries()]; const option = entries.length ? { animation: false, tooltip: { trigger: "item", confine: true }, grid: { left: 8, right: 8, top: 12, bottom: 8, containLabel: true }, xAxis: { type: "category", data: entries.map(([name]) => name), axisLabel: { fontSize: BLOCK_CHART_AXIS_FONT_SIZE } }, yAxis: { type: "value" }, series: [{ type: "boxplot", data: entries.map(([, values]) => quartiles(values)), itemStyle: { color: chartColors(chartPalette)[0], borderColor: chartColors(chartPalette)[0] } }] } : undefined;
  return <AnalysisChart block={block} title={title} testid="boxplot-distribution" option={option} hint="当前没有可计算的分类数值" />;
};

const RadarComparisonRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, chartPalette, fieldLabelOf }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const title = String(block.props?.title ?? "多维对比"); const bound = rowsOfBinding(block, entityRows); const nameRef = fieldRefOf(block, "nameFieldRef"); const fields = fieldRefListOf(block, "metricFieldRefs").slice(0, 8);
  if (!bound || !nameRef || fields.length < 3) return <AnalysisChart block={block} title={title} testid="radar-comparison" hint="雷达对比至少需要名称和三个数值维度" />;
  const maxima = fields.map(field => Math.max(1, ...bound.rows.map(row => Number(row.values?.[field] ?? 0)))); const option = bound.rows.length ? { animation: false, color: chartColors(chartPalette), tooltip: { trigger: "item", confine: true }, radar: { radius: "62%", indicator: fields.map((field, index) => ({ name: fieldLabelOf?.(bound.entityRef, field) ?? field, max: maxima[index] * 1.15 })), axisName: { fontSize: BLOCK_CHART_AXIS_FONT_SIZE } }, series: [{ type: "radar", data: bound.rows.slice(0, 5).map(row => ({ name: String(row.values?.[nameRef] ?? row.id), value: fields.map(field => Number(row.values?.[field] ?? 0)), areaStyle: { opacity: 0.08 } })) }] } : undefined;
  return <AnalysisChart block={block} title={title} testid="radar-comparison" option={option} hint="当前没有可对比的记录" />;
};

const AlertRuleEditorRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0]; const nameRef = fieldRefOf(block, "nameFieldRef"); const queryRef = fieldRefOf(block, "queryFieldRef"); const thresholdRef = fieldRefOf(block, "thresholdFieldRef"); const severityRef = fieldRefOf(block, "severityFieldRef"); const [name, setName] = React.useState(row && nameRef ? String(row.values?.[nameRef] ?? "") : ""); const [query, setQuery] = React.useState(row && queryRef ? String(row.values?.[queryRef] ?? "") : ""); const [threshold, setThreshold] = React.useState(row && thresholdRef ? Number(row.values?.[thresholdRef] ?? 0) : 0); const [severity, setSeverity] = React.useState(row && severityRef ? String(row.values?.[severityRef] ?? "warning") : "warning"); const [evaluation, setEvaluation] = React.useState("1m");
  if (!bound || !nameRef || !queryRef || !thresholdRef) return <BlockShell block={block} title={String(block.props?.title ?? "告警规则")} testid="alert-rule-editor"><BlockEmpty hint="告警规则尚未绑定名称、查询和阈值字段" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "告警规则")} testid="alert-rule-editor"><Space direction="vertical" style={{ width: "100%" }}><Input value={name} onChange={event => setName(event.target.value)} placeholder="规则名称" /><SqlEditor value={query} onChange={setQuery} height="90px" placeholderHeight={90} /><Flex gap={8} wrap><Input type="number" value={threshold} onChange={event => setThreshold(Number(event.target.value))} prefix="阈值" style={{ flex: 1, minWidth: 130 }} /><Select value={severity} onChange={setSeverity} options={[{ label: "提示", value: "info" }, { label: "警告", value: "warning" }, { label: "严重", value: "critical" }]} style={{ minWidth: 110 }} /></Flex><Segmented block value={evaluation} options={[{ label: "每 1 分钟", value: "1m" }, { label: "每 5 分钟", value: "5m" }, { label: "每 15 分钟", value: "15m" }]} onChange={value => setEvaluation(String(value))} /><Button type="primary" block disabled={!name.trim() || !query.trim() || !Number.isFinite(threshold)} onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: row ? "updateAlertRule" : "createAlertRule", values: { name, query, threshold, severity, evaluation }, targets: targetIdsOf(block) })}>保存并启用规则</Button></Space></BlockShell>;
};

const MuteTimingScheduleRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const nameRef = fieldRefOf(block, "nameFieldRef"); const weekdaysRef = fieldRefOf(block, "weekdaysFieldRef"); const startRef = fieldRefOf(block, "startTimeFieldRef"); const endRef = fieldRefOf(block, "endTimeFieldRef"); const timezoneRef = fieldRefOf(block, "timezoneFieldRef");
  if (!bound || !nameRef || !weekdaysRef || !startRef || !endRef) return <BlockShell block={block} title={String(block.props?.title ?? "静默时段")} testid="mute-timing-schedule"><BlockEmpty hint="静默时段尚未绑定名称、星期和起止时间" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "静默时段")} testid="mute-timing-schedule" extra={<Button size="small" type="primary" onClick={() => onAction?.("createRequest", { entityRef: bound.entityRef, operation: "createMuteTiming" })}>新增时段</Button>}><List size="small" dataSource={bound.rows} locale={{ emptyText: <BlockEmpty hint="当前没有静默时段" /> }} renderItem={row => <List.Item actions={[<Button key="edit" size="small" onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editMuteTiming" })}>编辑</Button>, <Popconfirm key="delete" title="删除这个静默时段？" onConfirm={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "deleteMuteTiming", targets: targetIdsOf(block) })}><Button size="small" danger>删除</Button></Popconfirm>]}><List.Item.Meta title={String(row.values?.[nameRef] ?? "未命名时段")} description={`${String(row.values?.[weekdaysRef] ?? "")} · ${String(row.values?.[startRef] ?? "")}–${String(row.values?.[endRef] ?? "")}${timezoneRef ? ` · ${String(row.values?.[timezoneRef] ?? "")}` : ""}`} /></List.Item>} /></BlockShell>;
};

const ContactPointManagerRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const nameRef = fieldRefOf(block, "nameFieldRef"); const typeRef = fieldRefOf(block, "typeFieldRef"); const addressRef = fieldRefOf(block, "addressFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const [testing, setTesting] = React.useState("");
  if (!bound || !nameRef || !typeRef || !addressRef) return <BlockShell block={block} title={String(block.props?.title ?? "通知联络点")} testid="contact-point-manager"><BlockEmpty hint="联络点尚未绑定名称、类型和地址字段" /></BlockShell>;
  const test = (rowId: string) => { setTesting(rowId); onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId, operation: "testContactPoint", targets: targetIdsOf(block) }); window.setTimeout(() => setTesting(""), 400); };
  return <BlockShell block={block} title={String(block.props?.title ?? "通知联络点")} testid="contact-point-manager" extra={<Button size="small" type="primary" onClick={() => onAction?.("createRequest", { entityRef: bound.entityRef, operation: "createContactPoint" })}>新增联络点</Button>}><List size="small" dataSource={bound.rows} renderItem={row => <List.Item actions={[<Button key="test" size="small" loading={testing === row.id} onClick={() => test(row.id)}>测试</Button>, <Button key="edit" size="small" onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editContactPoint" })}>编辑</Button>]}><List.Item.Meta title={<Space>{String(row.values?.[nameRef] ?? "未命名联络点")}{statusRef && <Badge status={String(row.values?.[statusRef] ?? "") === "ready" ? "success" : "default"} />}</Space>} description={`${String(row.values?.[typeRef] ?? "")} · ${String(row.values?.[addressRef] ?? "")}`} /></List.Item>} /></BlockShell>;
};

const ReferenceManyManagerRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const relationRef = fieldRefOf(block, "relationFieldRef"); const linkedValue = String(block.props?.linkedValue ?? "linked"); const [tab, setTab] = React.useState("linked"); const [selected, setSelected] = React.useState<string[]>([]); const [local, setLocal] = React.useState<Record<string, string>>({});
  if (!bound || !titleRef || !relationRef) return <BlockShell block={block} title={String(block.props?.title ?? "关联记录")} testid="reference-many-manager"><BlockEmpty hint="关联记录管理尚未绑定标题和关系状态字段" /></BlockShell>;
  const isLinked = (row: RuntimeRow) => (local[row.id] ?? String(row.values?.[relationRef] ?? "")) === linkedValue; const linked = bound.rows.filter(isLinked); const available = bound.rows.filter(row => !isLinked(row)); const shown = tab === "linked" ? linked : available; const add = () => { setLocal(current => ({ ...current, ...Object.fromEntries(selected.map(id => [id, linkedValue])) })); onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "linkRecords", rowIds: selected, targets: targetIdsOf(block) }); setSelected([]); };
  return <BlockShell block={block} title={String(block.props?.title ?? "关联记录")} testid="reference-many-manager" extra={tab === "available" ? <Button size="small" type="primary" disabled={!selected.length} onClick={add}>关联所选 {selected.length || ""}</Button> : undefined}><Segmented block value={tab} options={[{ label: `已关联 ${linked.length}`, value: "linked" }, { label: `可关联 ${available.length}`, value: "available" }]} onChange={value => { setTab(String(value)); setSelected([]); }} /><List size="small" dataSource={shown} renderItem={row => <List.Item actions={tab === "linked" ? [<Button key="unlink" danger type="link" size="small" onClick={() => { setLocal(current => ({ ...current, [row.id]: "available" })); onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "unlinkRecords", rowIds: [row.id], targets: targetIdsOf(block) }); }}>解除</Button>] : undefined}>{tab === "available" && <Checkbox checked={selected.includes(row.id)} onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} style={{ marginInlineEnd: 8 }} />}{String(row.values?.[titleRef] ?? "未命名记录")}</List.Item>} /></BlockShell>;
};

const GlobalSearchPaletteRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  const preview = useLibraryPreview();
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const categoryRef = fieldRefOf(block, "categoryFieldRef"); const descRef = fieldRefOf(block, "descFieldRef"); const [keyword, setKeyword] = React.useState("");
  if (!bound || !titleRef) return <BlockShell block={block} title={String(block.props?.title ?? "全局搜索")} testid="global-search-palette"><BlockEmpty hint="全局搜索尚未绑定标题字段" /></BlockShell>;
  const normalized = keyword.trim().toLowerCase(); const rows = bound.rows.filter(row => normalized && [row.values?.[titleRef], descRef ? row.values?.[descRef] : ""].some(value => String(value ?? "").toLowerCase().includes(normalized))).slice(0, 12);
  return <BlockShell block={block} title={String(block.props?.title ?? "全局搜索")} testid="global-search-palette"><Input.Search autoFocus={!preview} allowClear value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索页面、记录或操作" />{!normalized ? <Typography.Paragraph type="secondary" style={{ margin: "12px 0 0" }}>输入关键词后显示匹配结果</Typography.Paragraph> : <List size="small" dataSource={rows} locale={{ emptyText: <BlockEmpty hint="没有匹配结果" /> }} renderItem={row => <List.Item onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}><List.Item.Meta title={String(row.values?.[titleRef] ?? "未命名结果")} description={[categoryRef ? row.values?.[categoryRef] : "", descRef ? row.values?.[descRef] : ""].filter(Boolean).map(String).join(" · ")} /></List.Item>} />}</BlockShell>;
};

const LiveChangeReviewRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const actionRef = fieldRefOf(block, "actionFieldRef"); const timeRef = fieldRefOf(block, "timeFieldRef"); const actorRef = fieldRefOf(block, "actorFieldRef"); const [ignored, setIgnored] = React.useState<string[]>([]); const rows = bound?.rows.filter(row => !ignored.includes(row.id)) ?? [];
  if (!bound || !titleRef || !actionRef) return <BlockShell block={block} title={String(block.props?.title ?? "实时变更")} testid="live-change-review"><BlockEmpty hint="实时变更尚未绑定标题和动作字段" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "实时变更")} testid="live-change-review" extra={<Badge count={rows.length} showZero />}><Alert type="info" showIcon message="检测到其他用户的实时变更" description="变更不会直接覆盖当前视图；确认刷新后由宿主重新读取数据。" style={{ marginBottom: 8 }} />{rows.length ? <List size="small" dataSource={rows} renderItem={row => <List.Item actions={[<Button key="ignore" size="small" onClick={() => setIgnored(current => [...current, row.id])}>忽略</Button>, <Button key="refresh" size="small" type="primary" onClick={() => onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId: row.id, operation: "refreshAfterLiveChange", targets: targetIdsOf(block) })}>刷新查看</Button>]}><List.Item.Meta title={<Space><Tag>{String(row.values?.[actionRef] ?? "更新")}</Tag>{String(row.values?.[titleRef] ?? "未命名记录")}</Space>} description={[actorRef ? row.values?.[actorRef] : "", timeRef ? row.values?.[timeRef] : ""].filter(Boolean).map(String).join(" · ")} /></List.Item>} /> : <BlockEmpty hint="没有待处理的实时变更" />}</BlockShell>;
};

const AvailabilityPlannerRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const dayRef = fieldRefOf(block, "dayFieldRef"); const startRef = fieldRefOf(block, "startTimeFieldRef"); const endRef = fieldRefOf(block, "endTimeFieldRef"); const enabledRef = fieldRefOf(block, "enabledFieldRef"); const timezone = String(block.props?.timezone ?? "Asia/Shanghai");
  if (!bound || !dayRef || !startRef || !endRef) return <BlockShell block={block} title={String(block.props?.title ?? "可用时间")} testid="availability-planner"><BlockEmpty hint="可用时间尚未绑定星期和起止时间" /></BlockShell>;
  const days = Array.from(new Set(bound.rows.map(row => String(row.values?.[dayRef] ?? "")).filter(Boolean)));
  return <BlockShell block={block} title={String(block.props?.title ?? "可用时间")} testid="availability-planner" extra={<Tag>{timezone}</Tag>}><Collapse size="small" defaultActiveKey={days} items={days.map(day => ({ key: day, label: day, children: <List size="small" dataSource={bound.rows.filter(row => String(row.values?.[dayRef] ?? "") === day)} renderItem={row => { const enabled = !enabledRef || ![false, "false", "disabled"].includes(row.values?.[enabledRef] as never); return <List.Item actions={[<Button key="edit" size="small" disabled={!enabled} onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editAvailability" })}>编辑</Button>]}><Space><Badge status={enabled ? "success" : "default"} /><Typography.Text delete={!enabled}>{String(row.values?.[startRef] ?? "")}–{String(row.values?.[endRef] ?? "")}</Typography.Text></Space></List.Item>; }} /> }))} /></BlockShell>;
};

const BookingSlotPickerRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const startRef = fieldRefOf(block, "startFieldRef"); const endRef = fieldRefOf(block, "endFieldRef"); const availableRef = fieldRefOf(block, "availableFieldRef"); const capacityRef = fieldRefOf(block, "capacityFieldRef"); const [selected, setSelected] = React.useState("");
  if (!bound || !startRef || !endRef) return <BlockShell block={block} title={String(block.props?.title ?? "选择时段")} testid="booking-slot-picker"><BlockEmpty hint="时段选择器尚未绑定开始和结束时间" /></BlockShell>;
  const dates = Array.from(new Set(bound.rows.map(row => dayjs(String(row.values?.[startRef] ?? "")).format("YYYY-MM-DD")))); const [date, setDate] = React.useState(dates[0] ?? ""); const rows = bound.rows.filter(row => dayjs(String(row.values?.[startRef] ?? "")).format("YYYY-MM-DD") === date);
  return <BlockShell block={block} title={String(block.props?.title ?? "选择时段")} testid="booking-slot-picker"><Segmented block value={date} options={dates.slice(0, 5).map(value => ({ value, label: dayjs(value).format("MM-DD") }))} onChange={value => { setDate(String(value)); setSelected(""); }} /><Flex gap={8} wrap style={{ marginTop: 10 }}>{rows.map(row => { const available = !availableRef || ![false, "false", "full"].includes(row.values?.[availableRef] as never); return <Button key={row.id} type={selected === row.id ? "primary" : "default"} disabled={!available} onClick={() => setSelected(row.id)}>{dayjs(String(row.values?.[startRef])).format("HH:mm")}–{dayjs(String(row.values?.[endRef])).format("HH:mm")}{capacityRef ? ` · ${String(row.values?.[capacityRef] ?? 0)} 位` : ""}</Button>; })}</Flex><Button block type="primary" disabled={!selected} style={{ marginTop: 12 }} onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: selected, operation: "selectBookingSlot", targets: targetIdsOf(block) })}>确认所选时段</Button></BlockShell>;
};

const ScheduleConflictResolverRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const startRef = fieldRefOf(block, "startFieldRef"); const endRef = fieldRefOf(block, "endFieldRef"); const resourceRef = fieldRefOf(block, "resourceFieldRef");
  if (!bound || !titleRef || !startRef || !endRef || !resourceRef) return <BlockShell block={block} title={String(block.props?.title ?? "排期冲突")} testid="schedule-conflict-resolver"><BlockEmpty hint="冲突解析尚未绑定标题、资源和起止时间" /></BlockShell>;
  const conflicts: Array<{ left: RuntimeRow; right: RuntimeRow }> = []; for (let i = 0; i < bound.rows.length; i += 1) for (let j = i + 1; j < bound.rows.length; j += 1) { const left = bound.rows[i]; const right = bound.rows[j]; if (String(left.values?.[resourceRef] ?? "") !== String(right.values?.[resourceRef] ?? "")) continue; const ls = dayjs(String(left.values?.[startRef])); const le = dayjs(String(left.values?.[endRef])); const rs = dayjs(String(right.values?.[startRef])); const re = dayjs(String(right.values?.[endRef])); if (ls.isValid() && le.isValid() && rs.isValid() && re.isValid() && ls.isBefore(re) && rs.isBefore(le)) conflicts.push({ left, right }); }
  return <BlockShell block={block} title={String(block.props?.title ?? "排期冲突")} testid="schedule-conflict-resolver" extra={<Badge count={conflicts.length} showZero />}>{conflicts.length ? <List size="small" dataSource={conflicts} renderItem={({ left, right }) => <List.Item actions={[<Button key="resolve" type="primary" size="small" onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowIds: [left.id, right.id], operation: "resolveScheduleConflict", targets: targetIdsOf(block) })}>调整排期</Button>]}><List.Item.Meta title={`${String(left.values?.[titleRef] ?? left.id)} ↔ ${String(right.values?.[titleRef] ?? right.id)}`} description={`${String(left.values?.[resourceRef] ?? "")} · ${dayjs(String(left.values?.[startRef])).format("MM-DD HH:mm")}–${dayjs(String(left.values?.[endRef])).format("HH:mm")}`} /></List.Item>} /> : <Result status="success" title="当前没有排期冲突" />}</BlockShell>;
};

const StackTracePanelRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const functionRef = fieldRefOf(block, "functionFieldRef"); const fileRef = fieldRefOf(block, "fileFieldRef"); const lineRef = fieldRefOf(block, "lineFieldRef"); const codeRef = fieldRefOf(block, "codeFieldRef"); const inAppRef = fieldRefOf(block, "inAppFieldRef");
  if (!bound || !functionRef || !fileRef || !lineRef) return <BlockShell block={block} title={String(block.props?.title ?? "异常堆栈")} testid="stack-trace-panel"><BlockEmpty hint="堆栈尚未绑定函数、文件和行号字段" /></BlockShell>;
  const rows = [...bound.rows].sort((a, b) => Number(a.values?.[lineRef] ?? 0) - Number(b.values?.[lineRef] ?? 0));
  return <BlockShell block={block} title={String(block.props?.title ?? "异常堆栈")} testid="stack-trace-panel"><Collapse size="small" defaultActiveKey={rows.find(row => inAppRef && [true, "true", "in_app"].includes(row.values?.[inAppRef] as never))?.id} items={rows.map(row => ({ key: row.id, label: <Space><Tag color={inAppRef && [true, "true", "in_app"].includes(row.values?.[inAppRef] as never) ? "blue" : "default"}>{inAppRef && [true, "true", "in_app"].includes(row.values?.[inAppRef] as never) ? "应用" : "依赖"}</Tag><Typography.Text code>{String(row.values?.[functionRef] ?? "anonymous")}</Typography.Text><Typography.Text type="secondary">{String(row.values?.[fileRef] ?? "")}:{String(row.values?.[lineRef] ?? "")}</Typography.Text></Space>, children: <div><pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>{codeRef ? String(row.values?.[codeRef] ?? "暂无源码上下文") : "暂无源码上下文"}</pre><Button type="link" size="small" onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>查看帧详情</Button></div> }))} /></BlockShell>;
};

const EventBreadcrumbTimelineRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const messageRef = fieldRefOf(block, "messageFieldRef"); const categoryRef = fieldRefOf(block, "categoryFieldRef"); const levelRef = fieldRefOf(block, "levelFieldRef"); const timeRef = fieldRefOf(block, "timeFieldRef"); const [scope, setScope] = React.useState("all");
  if (!bound || !messageRef || !timeRef) return <BlockShell block={block} title={String(block.props?.title ?? "事件轨迹")} testid="event-breadcrumb-timeline"><BlockEmpty hint="事件轨迹尚未绑定消息和时间字段" /></BlockShell>;
  const rows = [...bound.rows].sort((a, b) => dayjs(String(a.values?.[timeRef])).valueOf() - dayjs(String(b.values?.[timeRef])).valueOf()).filter(row => scope === "all" || String(row.values?.[levelRef ?? ""] ?? "") === "error");
  return <BlockShell block={block} title={String(block.props?.title ?? "事件轨迹")} testid="event-breadcrumb-timeline" extra={levelRef ? <Segmented size="small" value={scope} options={[{ label: "全部", value: "all" }, { label: "仅错误", value: "error" }]} onChange={value => setScope(String(value))} /> : undefined}><Timeline items={rows.map(row => ({ color: String(row.values?.[levelRef ?? ""] ?? "") === "error" ? "red" : "blue", children: <div><Space><Tag>{categoryRef ? String(row.values?.[categoryRef] ?? "事件") : "事件"}</Tag><Typography.Text>{String(row.values?.[messageRef] ?? "")}</Typography.Text></Space><div><Typography.Text type="secondary">{String(row.values?.[timeRef] ?? "")}</Typography.Text></div></div> }))} /></BlockShell>;
};

const SuspectCommitPanelRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const hashRef = fieldRefOf(block, "hashFieldRef"); const authorRef = fieldRefOf(block, "authorFieldRef"); const messageRef = fieldRefOf(block, "messageFieldRef"); const timeRef = fieldRefOf(block, "timeFieldRef"); const scoreRef = fieldRefOf(block, "scoreFieldRef");
  if (!bound || !hashRef || !messageRef) return <BlockShell block={block} title={String(block.props?.title ?? "可疑提交")} testid="suspect-commit-panel"><BlockEmpty hint="可疑提交尚未绑定哈希和说明字段" /></BlockShell>;
  const rows = [...bound.rows].sort((a, b) => Number(b.values?.[scoreRef ?? ""] ?? 0) - Number(a.values?.[scoreRef ?? ""] ?? 0));
  return <BlockShell block={block} title={String(block.props?.title ?? "可疑提交")} testid="suspect-commit-panel"><List size="small" dataSource={rows} renderItem={row => <List.Item actions={[<Button key="cause" size="small" onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "markSuspectCommit", targets: targetIdsOf(block) })}>标记根因</Button>]}><List.Item.Meta title={<Space><Typography.Text code>{String(row.values?.[hashRef] ?? "").slice(0, 8)}</Typography.Text><Typography.Text strong>{String(row.values?.[messageRef] ?? "")}</Typography.Text></Space>} description={[authorRef ? row.values?.[authorRef] : "", timeRef ? row.values?.[timeRef] : "", scoreRef ? `相关度 ${String(row.values?.[scoreRef] ?? 0)}%` : ""].filter(Boolean).map(String).join(" · ")} /></List.Item>} /></BlockShell>;
};

const ConnectionTimelineRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const typeRef = fieldRefOf(block, "typeFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const timeRef = fieldRefOf(block, "timeFieldRef"); const summaryRef = fieldRefOf(block, "summaryFieldRef"); const recordsRef = fieldRefOf(block, "recordsFieldRef"); const [scope, setScope] = React.useState("all");
  if (!bound || !typeRef || !statusRef || !timeRef) return <BlockShell block={block} title={String(block.props?.title ?? "连接时间线")} testid="connection-timeline"><BlockEmpty hint="连接时间线尚未绑定类型、状态和时间字段" /></BlockShell>;
  const rows = [...bound.rows].sort((a, b) => dayjs(String(b.values?.[timeRef])).valueOf() - dayjs(String(a.values?.[timeRef])).valueOf()).filter(row => scope === "all" || String(row.values?.[statusRef] ?? "") === scope);
  return <BlockShell block={block} title={String(block.props?.title ?? "连接时间线")} testid="connection-timeline" extra={<Segmented size="small" value={scope} options={[{ label: "全部", value: "all" }, { label: "失败", value: "failed" }]} onChange={value => setScope(String(value))} />}><Timeline items={rows.map(row => { const status = String(row.values?.[statusRef] ?? ""); return { color: status === "failed" ? "red" : status === "running" ? "blue" : "green", children: <Flex justify="space-between" gap={8}><div><Space><Tag>{String(row.values?.[typeRef] ?? "事件")}</Tag><Typography.Text strong>{status}</Typography.Text></Space><div>{summaryRef ? String(row.values?.[summaryRef] ?? "") : ""}</div><Typography.Text type="secondary">{String(row.values?.[timeRef] ?? "")}{recordsRef ? ` · ${String(row.values?.[recordsRef] ?? 0)} 条` : ""}</Typography.Text></div>{status === "failed" && <Button size="small" onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "retryConnectionJob", targets: targetIdsOf(block) })}>重试</Button>}</Flex> }; })} /></BlockShell>;
};

const SchemaChangeReviewRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const streamRef = fieldRefOf(block, "streamFieldRef"); const fieldRef = fieldRefOf(block, "fieldNameFieldRef"); const changeRef = fieldRefOf(block, "changeTypeFieldRef"); const beforeRef = fieldRefOf(block, "beforeFieldRef"); const afterRef = fieldRefOf(block, "afterFieldRef"); const breakingRef = fieldRefOf(block, "breakingFieldRef");
  if (!bound || !streamRef || !fieldRef || !changeRef) return <BlockShell block={block} title={String(block.props?.title ?? "Schema 变更")} testid="schema-change-review"><BlockEmpty hint="Schema 审查尚未绑定数据流、字段和变更类型" /></BlockShell>;
  const breaking = bound.rows.filter(row => breakingRef && [true, "true", "breaking"].includes(row.values?.[breakingRef] as never));
  return <BlockShell block={block} title={String(block.props?.title ?? "Schema 变更")} testid="schema-change-review" extra={<Tag color={breaking.length ? "red" : "blue"}>{breaking.length} 项破坏性变更</Tag>}><Table size="small" rowKey="id" pagination={false} dataSource={bound.rows} columns={[{ title: "数据流", render: (_, row) => String(row.values?.[streamRef] ?? "") }, { title: "字段", render: (_, row) => String(row.values?.[fieldRef] ?? "") }, { title: "变更", render: (_, row) => <Tag color={breakingRef && [true, "true", "breaking"].includes(row.values?.[breakingRef] as never) ? "red" : "blue"}>{String(row.values?.[changeRef] ?? "")}</Tag> }, { title: "前 → 后", render: (_, row) => `${beforeRef ? String(row.values?.[beforeRef] ?? "-") : "-"} → ${afterRef ? String(row.values?.[afterRef] ?? "-") : "-"}` }]} /><Flex justify="end" gap={8} style={{ marginTop: 10 }}><Button onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "rejectSchemaChanges", rowIds: bound.rows.map(row => row.id), targets: targetIdsOf(block) })}>暂不应用</Button><Button type="primary" disabled={breaking.length > 0 && block.props?.allowBreaking !== true} onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "applySchemaChanges", rowIds: bound.rows.map(row => row.id), targets: targetIdsOf(block) })}>应用安全变更</Button></Flex></BlockShell>;
};

const StreamStatusMonitorRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const nameRef = fieldRefOf(block, "nameFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const lastSyncRef = fieldRefOf(block, "lastSyncFieldRef"); const freshnessRef = fieldRefOf(block, "freshnessFieldRef"); const recordsRef = fieldRefOf(block, "recordsFieldRef"); const errorRef = fieldRefOf(block, "errorFieldRef");
  if (!bound || !nameRef || !statusRef) return <BlockShell block={block} title={String(block.props?.title ?? "数据流状态")} testid="stream-status-monitor"><BlockEmpty hint="数据流监控尚未绑定名称和状态字段" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "数据流状态")} testid="stream-status-monitor"><List size="small" dataSource={bound.rows} renderItem={row => { const status = String(row.values?.[statusRef] ?? ""); return <List.Item actions={status === "failed" ? [<Button key="retry" size="small" onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "retryStream", targets: targetIdsOf(block) })}>重试</Button>] : undefined}><List.Item.Meta title={<Space><Badge status={status === "failed" ? "error" : status === "running" ? "processing" : "success"} /><Typography.Text strong>{String(row.values?.[nameRef] ?? "未命名数据流")}</Typography.Text></Space>} description={<div>{[lastSyncRef ? row.values?.[lastSyncRef] : "", freshnessRef ? `新鲜度 ${String(row.values?.[freshnessRef] ?? "-")}` : "", recordsRef ? `${String(row.values?.[recordsRef] ?? 0)} 条` : ""].filter(Boolean).map(String).join(" · ")}{status === "failed" && errorRef && <div style={{ color: "#cf1322" }}>{String(row.values?.[errorRef] ?? "同步失败")}</div>}</div>} /></List.Item>; }} /></BlockShell>;
};

const ConnectionMappingPanelRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const sourceRef = fieldRefOf(block, "sourceFieldRef"); const targetRef = fieldRefOf(block, "targetFieldRef"); const transformRef = fieldRefOf(block, "transformFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef");
  if (!bound || !sourceRef || !targetRef) return <BlockShell block={block} title={String(block.props?.title ?? "字段映射")} testid="connection-mapping-panel"><BlockEmpty hint="字段映射尚未绑定来源和目标字段" /></BlockShell>;
  const invalid = bound.rows.filter(row => statusRef && String(row.values?.[statusRef] ?? "") === "invalid");
  return <BlockShell block={block} title={String(block.props?.title ?? "字段映射")} testid="connection-mapping-panel" extra={<Tag color={invalid.length ? "red" : "green"}>{invalid.length ? `${invalid.length} 项异常` : "映射有效"}</Tag>}><List size="small" dataSource={bound.rows} renderItem={row => <List.Item actions={[<Button key="edit" size="small" onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editConnectionMapping" })}>编辑</Button>]}><List.Item.Meta title={<Space><Typography.Text code>{String(row.values?.[sourceRef] ?? "")}</Typography.Text><span>→</span><Typography.Text code>{String(row.values?.[targetRef] ?? "未映射")}</Typography.Text></Space>} description={transformRef ? String(row.values?.[transformRef] ?? "直接映射") : "直接映射"} /></List.Item>} /><Button block type="primary" disabled={invalid.length > 0} onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "saveConnectionMappings", rowIds: bound.rows.map(row => row.id), targets: targetIdsOf(block) })}>保存映射</Button></BlockShell>;
};

const IssueCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const priorityRef = fieldRefOf(block, "priorityFieldRef"); const assigneeRef = fieldRefOf(block, "assigneeFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !statusRef || !row) return <BlockShell block={block} testid="issue-command-header"><BlockEmpty hint="问题操作区尚未绑定当前问题、标题和状态" /></BlockShell>;
  const status = String(row.values?.[statusRef] ?? "unresolved"); const complete = ["resolved", "ignored", "archived"].includes(status); const submit = (operation: string) => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="issue-command-header"><Flex align="center" justify="space-between" gap={12} wrap><div><Space wrap><Typography.Title level={5} style={{ margin: 0 }}>{String(row.values?.[titleRef] ?? "未命名问题")}</Typography.Title><Tag color={complete ? "green" : "red"}>{status}</Tag>{priorityRef && <Tag>{String(row.values?.[priorityRef] ?? "未定优先级")}</Tag>}</Space>{assigneeRef && <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>负责人：{String(row.values?.[assigneeRef] ?? "未分配")}</Typography.Text>}</div><Space>{complete ? <Button type="primary" onClick={() => submit("reopenIssue")}>重新打开</Button> : <><Button type="primary" onClick={() => submit("resolveIssue")}>解决</Button><Popconfirm title="归档后将从活动问题中移除，确认继续？" onConfirm={() => submit("archiveIssue")}><Button>归档</Button></Popconfirm></>}</Space></Flex></BlockShell>;
};

const ConnectionControlHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const syncRef = fieldRefOf(block, "syncStatusFieldRef"); const scheduleRef = fieldRefOf(block, "scheduleFieldRef"); const breakingRef = fieldRefOf(block, "breakingFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !statusRef || !syncRef || !row) return <BlockShell block={block} testid="connection-control-header"><BlockEmpty hint="连接控制尚未绑定标题、连接状态和同步状态" /></BlockShell>;
  const status = String(row.values?.[statusRef] ?? "inactive"); const sync = String(row.values?.[syncRef] ?? "idle"); const running = sync === "running"; const locked = status === "locked"; const breaking = Boolean(breakingRef && [true, "true", "breaking"].includes(row.values?.[breakingRef] as never)); const action = (operation: string) => onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="connection-control-header"><Flex align="center" justify="space-between" gap={12} wrap><div><Space><Badge status={running ? "processing" : status === "active" ? "success" : "default"} /><Typography.Title level={5} style={{ margin: 0 }}>{String(row.values?.[titleRef] ?? "未命名连接")}</Typography.Title>{locked && <Tag>已锁定</Tag>}</Space>{scheduleRef && <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>计划：{String(row.values?.[scheduleRef] ?? "手动")}</Typography.Text>}</div><Space>{running ? <Popconfirm title="确认取消当前运行任务？" onConfirm={() => action("cancelConnectionJob")}><Button danger>取消运行</Button></Popconfirm> : <Button type="primary" disabled={status !== "active" || breaking} onClick={() => action("startConnectionSync")}>立即同步</Button>}<Tooltip title={breaking ? "存在破坏性 Schema 变更，暂不能启用" : locked ? "连接已锁定" : undefined}><span><Switch checked={status === "active"} disabled={locked || breaking || running} onChange={checked => action(checked ? "enableConnection" : "disableConnection")} /></span></Tooltip></Space></Flex>{breaking && <Alert type="warning" showIcon message="存在破坏性 Schema 变更，确认处理前不能启动同步或启用连接" style={{ marginTop: 10 }} />}</BlockShell>;
};

const EventUserCountMetricsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const eventRef = fieldRefOf(block, "eventCountFieldRef"); const userRef = fieldRefOf(block, "userCountFieldRef"); const row = bound?.rows[0];
  if (!bound || !eventRef || !userRef || !row) return <BlockShell block={block} title={String(block.props?.title ?? "问题影响")} testid="event-user-count-metrics"><BlockEmpty hint="影响指标尚未绑定事件数和用户数字段" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "问题影响")} testid="event-user-count-metrics"><Flex gap={24} wrap><Statistic title="事件总数" value={Number(row.values?.[eventRef] ?? 0)} /><Statistic title={`受影响用户${block.props?.periodLabel ? `（${String(block.props.periodLabel)}）` : ""}`} value={Number(row.values?.[userRef] ?? 0)} /></Flex></BlockShell>;
};

const JobRunMetricsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const bytesRef = fieldRefOf(block, "bytesFieldRef"); const recordsRef = fieldRefOf(block, "recordsFieldRef"); const rejectedRef = fieldRefOf(block, "rejectedFieldRef"); const durationRef = fieldRefOf(block, "durationFieldRef"); const attemptsRef = fieldRefOf(block, "attemptsFieldRef"); const row = bound?.rows[0];
  if (!bound || !recordsRef || !durationRef || !row) return <BlockShell block={block} title={String(block.props?.title ?? "运行指标")} testid="job-run-metrics"><BlockEmpty hint="运行指标尚未绑定记录数和耗时字段" /></BlockShell>;
  const bytes = bytesRef ? Number(row.values?.[bytesRef] ?? 0) : 0; const byteText = bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
  return <BlockShell block={block} title={String(block.props?.title ?? "运行指标")} testid="job-run-metrics"><Flex gap={20} wrap><Statistic title="已加载记录" value={Number(row.values?.[recordsRef] ?? 0)} />{bytesRef && <Statistic title="数据量" value={byteText} />}{rejectedRef && <Statistic title="拒绝记录" value={Number(row.values?.[rejectedRef] ?? 0)} valueStyle={{ color: Number(row.values?.[rejectedRef] ?? 0) ? "#cf1322" : undefined }} />}<Statistic title="耗时" value={String(row.values?.[durationRef] ?? "-")} />{attemptsRef && <Statistic title="尝试次数" value={Number(row.values?.[attemptsRef] ?? 1)} />}</Flex></BlockShell>;
};

const OccurrenceEvidenceSummaryRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const envRef = fieldRefOf(block, "environmentFieldRef"); const codeRef = fieldRefOf(block, "statusCodeFieldRef"); const reasonRef = fieldRefOf(block, "reasonFieldRef"); const successRef = fieldRefOf(block, "lastSuccessFieldRef"); const downtimeRef = fieldRefOf(block, "downtimeFieldRef"); const row = bound?.rows[0]; const fields = [["环境", envRef], ["状态码", codeRef], ["失败原因", reasonRef], ["上次成功", successRef], ["中断时长", downtimeRef]] as const;
  if (!bound || !row || fields.every(([, ref]) => !ref)) return <BlockShell block={block} title={String(block.props?.title ?? "发生摘要")} testid="occurrence-evidence-summary"><BlockEmpty hint="发生摘要尚未绑定证据字段" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "发生摘要")} testid="occurrence-evidence-summary"><Flex gap={28} wrap>{fields.flatMap(([label, ref]) => ref ? [<div key={label}><Typography.Text type="secondary">{label}</Typography.Text><Typography.Title level={5} style={{ margin: "4px 0 0", maxWidth: 300 }}>{String(row.values?.[ref] ?? "-")}</Typography.Title></div>] : [])}</Flex></BlockShell>;
};

const ConnectionRouteSummaryRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const sourceRef = fieldRefOf(block, "sourceFieldRef"); const targetRef = fieldRefOf(block, "targetFieldRef"); const sourceVersionRef = fieldRefOf(block, "sourceVersionFieldRef"); const targetVersionRef = fieldRefOf(block, "targetVersionFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const row = bound?.rows[0];
  if (!bound || !sourceRef || !targetRef || !row) return <BlockShell block={block} title={String(block.props?.title ?? "连接路径")} testid="connection-route-summary"><BlockEmpty hint="连接路径尚未绑定来源和目标字段" /></BlockShell>;
  const endpoint = (label: string, ref: string, versionRef?: string) => <div style={{ minWidth: 0 }}><Typography.Text type="secondary">{label}</Typography.Text><Typography.Title level={5} style={{ margin: "4px 0 0", overflowWrap: "anywhere" }}>{String(row.values?.[ref] ?? "-")}</Typography.Title>{versionRef && <Tag style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{String(row.values?.[versionRef] ?? "未知版本")}</Tag>}</div>;
  return <BlockShell block={block} title={String(block.props?.title ?? "连接路径")} testid="connection-route-summary" extra={statusRef ? <Badge status={String(row.values?.[statusRef] ?? "") === "active" ? "success" : "default"} text={String(row.values?.[statusRef] ?? "")} /> : undefined}><div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: 8 }}>{endpoint("来源", sourceRef, sourceVersionRef)}<Typography.Text type="secondary" style={{ fontSize: 20 }}>→</Typography.Text>{endpoint("目标", targetRef, targetVersionRef)}</div></BlockShell>;
};


const InspectorModeTabsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const keyRef = fieldRefOf(block, "keyFieldRef"); const titleRef = fieldRefOf(block, "titleFieldRef"); const enabledRef = fieldRefOf(block, "enabledFieldRef"); const issueRef = fieldRefOf(block, "issueCountFieldRef"); const [active, setActive] = React.useState("");
  if (!bound || !keyRef || !titleRef) return <BlockShell block={block} testid="inspector-mode-tabs"><BlockEmpty hint="检查器页签尚未绑定模式键和标题" /></BlockShell>;
  const rows = bound.rows.filter(row => String(row.values?.[keyRef] ?? "")); const usable = rows.filter(row => !enabledRef || ![false, "false", "disabled"].includes(row.values?.[enabledRef] as never)); const selected = usable.some(row => String(row.values?.[keyRef]) === active) ? active : String(usable[0]?.values?.[keyRef] ?? "");
  return <BlockShell block={block} testid="inspector-mode-tabs"><Tabs activeKey={selected} onChange={key => { setActive(key); onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: rows.find(row => String(row.values?.[keyRef]) === key)?.id, mode: key }); }} items={rows.map(row => ({ key: String(row.values?.[keyRef]), disabled: Boolean(enabledRef && [false, "false", "disabled"].includes(row.values?.[enabledRef] as never)), label: <Space size={4}>{String(row.values?.[titleRef] ?? "未命名模式")}{issueRef && Number(row.values?.[issueRef] ?? 0) > 0 && <Badge color="red" count={Number(row.values?.[issueRef])} />}</Space> }))} /></BlockShell>;
};

const IssueEventFilterRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const environmentRef = fieldRefOf(block, "environmentFieldRef"); const [environment, setEnvironment] = React.useState("all"); const [period, setPeriod] = React.useState("24h"); const [query, setQuery] = React.useState("");
  if (!bound || !environmentRef) return <BlockShell block={block} title={String(block.props?.title ?? "事件筛选")} testid="issue-event-filter"><BlockEmpty hint="事件筛选尚未绑定环境字段" /></BlockShell>;
  const environments = Array.from(new Set(bound.rows.map(row => String(row.values?.[environmentRef] ?? "")).filter(Boolean))); const emit = (next: Record<string, unknown>) => onAction?.("filterChange", { environment, period, query: query.trim(), ...next, targets: targetIdsOf(block) });
  return <BlockShell block={block} title={String(block.props?.title ?? "事件筛选")} testid="issue-event-filter"><Flex gap={8} wrap><Select value={environment} style={{ flex: "1 1 130px", minWidth: 0 }} options={[{ label: "全部环境", value: "all" }, ...environments.map(value => ({ label: value, value }))]} onChange={value => { setEnvironment(value); emit({ environment: value }); }} /><Select value={period} style={{ flex: "1 1 130px", minWidth: 0 }} options={[{ label: "最近 1 小时", value: "1h" }, { label: "最近 24 小时", value: "24h" }, { label: "最近 7 天", value: "7d" }, { label: "首次发生以来", value: "sinceFirst" }]} onChange={value => { setPeriod(value); emit({ period: value }); }} /><Input.Search value={query} onChange={event => setQuery(event.target.value)} onSearch={value => emit({ query: value.trim() })} placeholder="输入字段:值查询" style={{ flex: "1 1 190px", minWidth: 0 }} /></Flex></BlockShell>;
};

const TimelineFilterBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const typeRef = fieldRefOf(block, "typeFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const timeRef = fieldRefOf(block, "timeFieldRef"); const [type, setType] = React.useState("all"); const [status, setStatus] = React.useState("all"); const [range, setRange] = React.useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  if (!bound || !typeRef || !statusRef || !timeRef) return <BlockShell block={block} title={String(block.props?.title ?? "时间线筛选")} testid="timeline-filter-bar"><BlockEmpty hint="时间线筛选尚未绑定类型、状态和时间字段" /></BlockShell>;
  const types = Array.from(new Set(bound.rows.map(row => String(row.values?.[typeRef] ?? "")).filter(Boolean))); const statuses = Array.from(new Set(bound.rows.map(row => String(row.values?.[statusRef] ?? "")).filter(Boolean))); const supportsStatus = ["all", "sync", "clear", "refresh"].includes(type); const emit = (next: Record<string, unknown>) => onAction?.("filterChange", { eventType: type, status, dateRange: range?.map(value => value.format("YYYY-MM-DD")) ?? null, ...next, targets: targetIdsOf(block) });
  return <BlockShell block={block} title={String(block.props?.title ?? "时间线筛选")} testid="timeline-filter-bar"><Flex gap={8} wrap><Select value={type} style={{ minWidth: 130 }} options={[{ label: "全部类型", value: "all" }, ...types.map(value => ({ label: value, value }))]} onChange={value => { setType(value); if (!["all", "sync", "clear", "refresh"].includes(value)) setStatus("all"); emit({ eventType: value, status: ["all", "sync", "clear", "refresh"].includes(value) ? status : "all" }); }} /><Select value={supportsStatus ? status : "all"} disabled={!supportsStatus} style={{ minWidth: 120 }} options={[{ label: "全部状态", value: "all" }, ...statuses.map(value => ({ label: value, value }))]} onChange={value => { setStatus(value); emit({ status: value }); }} /><DatePicker.RangePicker value={range} onChange={value => { const next = value?.[0] && value?.[1] ? [value[0], value[1]] as [dayjs.Dayjs, dayjs.Dayjs] : null; setRange(next); emit({ dateRange: next?.map(item => item.format("YYYY-MM-DD")) ?? null }); }} /><Button disabled={type === "all" && status === "all" && !range} onClick={() => { setType("all"); setStatus("all"); setRange(null); emit({ eventType: "all", status: "all", dateRange: null }); }}>清除</Button></Flex></BlockShell>;
};

const UnsavedChangesBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const fieldRef = fieldRefOf(block, "fieldNameFieldRef"); const validRef = fieldRefOf(block, "validFieldRef"); const dirty = bound?.rows ?? []; const invalid = validRef ? dirty.filter(row => [false, "false", "invalid"].includes(row.values?.[validRef] as never)) : [];
  if (!bound || !fieldRef) return <BlockShell block={block} testid="unsaved-changes-bar"><BlockEmpty hint="未保存变更栏尚未绑定变更字段" /></BlockShell>;
  return <BlockShell block={block} testid="unsaved-changes-bar"><Flex align="center" justify="space-between" gap={12} wrap><Space><Badge count={dirty.length} showZero /><div><Typography.Text strong>{dirty.length ? `${dirty.length} 项未保存变更` : "没有未保存变更"}</Typography.Text>{invalid.length > 0 && <Typography.Text type="danger" style={{ display: "block" }}>{invalid.length} 项校验未通过</Typography.Text>}</div></Space><Space><Popconfirm title="放弃后无法恢复这些本地变更，确认继续？" onConfirm={() => onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "discardChanges", rowIds: dirty.map(row => row.id), targets: targetIdsOf(block) })}><Button disabled={!dirty.length}>放弃</Button></Popconfirm><Button type="primary" disabled={!dirty.length || invalid.length > 0} onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "saveChanges", rowIds: dirty.map(row => row.id), targets: targetIdsOf(block) })}>保存变更</Button></Space></Flex></BlockShell>;
};

const RunningJobControlBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const progressRef = fieldRefOf(block, "progressFieldRef"); const typeRef = fieldRefOf(block, "typeFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows.find(item => String(item.values?.[statusRef ?? ""]) === "running") ?? bound?.rows[0];
  if (!bound || !titleRef || !statusRef || !row) return <BlockShell block={block} testid="running-job-control-bar"><BlockEmpty hint="运行任务栏尚未绑定任务标题和状态" /></BlockShell>;
  const status = String(row.values?.[statusRef] ?? ""); const running = status === "running"; const failed = ["failed", "incomplete", "cancelled"].includes(status); const operation = running ? "cancelRunningJob" : "retryJob";
  return <BlockShell block={block} testid="running-job-control-bar"><Flex align="center" justify="space-between" gap={12} wrap><div style={{ flex: 1, minWidth: 180 }}><Space><Badge status={running ? "processing" : failed ? "error" : "success"} /><Typography.Text strong>{String(row.values?.[titleRef] ?? "未命名任务")}</Typography.Text>{typeRef && <Tag>{String(row.values?.[typeRef] ?? "任务")}</Tag>}</Space>{progressRef && <Progress percent={Math.max(0, Math.min(100, Number(row.values?.[progressRef] ?? 0)))} size="small" style={{ marginTop: 6, maxWidth: 320 }} />}</div>{running ? <Popconfirm title="确认取消当前运行任务？已处理的数据不会自动回滚。" onConfirm={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) })}><Button danger>取消任务</Button></Popconfirm> : failed ? <Button type="primary" onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) })}>重试任务</Button> : <Tag color="green">任务已完成</Tag>}</Flex></BlockShell>;
};

const BookingCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => { if (children != null) return <>{children}</>; const bound=rowsOfBinding(block,entityRows), titleRef=fieldRefOf(block,"titleFieldRef"),statusRef=fieldRefOf(block,"statusFieldRef"),startRef=fieldRefOf(block,"startFieldRef"),endRef=fieldRefOf(block,"endFieldRef"),locationRef=fieldRefOf(block,"locationFieldRef"),recurringRef=fieldRefOf(block,"recurringFieldRef"),paidRef=fieldRefOf(block,"paidFieldRef"); const row=bound?.rows.find(x=>x.id===focus?.[bound.entityRef])??bound?.rows[0]; if(!bound||!titleRef||!statusRef||!startRef||!row)return <BlockShell block={block} testid="booking-command-header"><BlockEmpty hint="预约操作页头尚未绑定标题、状态和开始时间"/></BlockShell>; const status=String(row.values?.[statusRef]??"PENDING"),past=dayjs(String(row.values?.[endRef??startRef])).isBefore(dayjs()),recurring=Boolean(recurringRef&&[true,"true","recurring"].includes(row.values?.[recurringRef] as never)),paid=!paidRef||[true,"true","paid"].includes(row.values?.[paidRef] as never); const submit=(operation:string)=>onAction?.("submitRequest",{entityRef:bound.entityRef,rowId:row.id,operation,scope:recurring?"series":"single",targets:targetIdsOf(block)}); let actions:React.ReactNode=status==="PENDING"&&!past?<><Button disabled={!paid} type="primary" onClick={()=>submit("confirmBooking")}>确认预约</Button><Button danger onClick={()=>submit("rejectBooking")}>拒绝</Button></>:status==="ACCEPTED"&&!past?<><Button onClick={()=>onAction?.("editRequest",{entityRef:bound.entityRef,rowId:row.id,operation:"rescheduleBooking"})}>改期</Button><Popconfirm title="确认取消这次预约？" onConfirm={()=>submit("cancelBooking")}><Button danger>取消</Button></Popconfirm></>:status==="ACCEPTED"&&past?<Button onClick={()=>submit("toggleNoShow")}>标记未到场</Button>:<Tag>当前状态无可用操作</Tag>; return <BlockShell block={block} testid="booking-command-header"><Flex justify="space-between" align="center" gap={12} wrap><div><Space wrap><Typography.Title level={5} style={{margin:0}}>{String(row.values?.[titleRef]??"未命名预约")}</Typography.Title><Tag>{status}</Tag>{recurring&&<Tag color="blue">重复预约</Tag>}</Space><Typography.Text type="secondary" style={{display:"block",marginTop:4}}>{String(row.values?.[startRef]??"")}{endRef?` - ${String(row.values?.[endRef]??"")}`:""}{locationRef?` · ${String(row.values?.[locationRef]??"")}`:""}</Typography.Text></div><Space wrap>{actions}</Space></Flex>{status==="PENDING"&&!paid&&<Alert type="warning" showIcon message="付款尚未完成，暂不能确认预约" style={{marginTop:8}}/>}</BlockShell>; };

const AlertRuleCommandHeaderRenderer: ExperienceBlockRenderer = ({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),titleRef=fieldRefOf(block,"titleFieldRef"),stateRef=fieldRefOf(block,"stateFieldRef"),editableRef=fieldRefOf(block,"editableFieldRef"),provisionedRef=fieldRefOf(block,"provisionedFieldRef"),silenceRef=fieldRefOf(block,"silenceableFieldRef");const row=bound?.rows.find(x=>x.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!titleRef||!stateRef||!row)return <BlockShell block={block} testid="alert-rule-command-header"><BlockEmpty hint="告警规则操作尚未绑定标题和状态"/></BlockShell>;const state=String(row.values?.[stateRef]??"active"),editable=!editableRef||![false,"false","readonly"].includes(row.values?.[editableRef] as never),provisioned=Boolean(provisionedRef&&[true,"true","provisioned"].includes(row.values?.[provisionedRef] as never)),silenceable=!silenceRef||![false,"false","disabled"].includes(row.values?.[silenceRef] as never);const act=(operation:string,event="actionTrigger")=>onAction?.(event,{entityRef:bound.entityRef,rowId:row.id,operation,targets:targetIdsOf(block)});return <BlockShell block={block} testid="alert-rule-command-header"><Flex justify="space-between" align="center" gap={12} wrap><Space><Badge status={state==="firing"?"error":state==="pending"?"warning":"success"}/><Typography.Title level={5} style={{margin:0}}>{String(row.values?.[titleRef]??"未命名规则")}</Typography.Title>{provisioned&&<Tag>受管规则</Tag>}</Space><Space wrap><Button disabled={!editable||provisioned} onClick={()=>act("editAlertRule","editRequest")}>编辑</Button><Button onClick={()=>act("duplicateAlertRule")}>复制</Button><Button disabled={!silenceable} onClick={()=>act("silenceAlertRule")}>静默</Button><Button onClick={()=>act(state==="paused"?"resumeAlertRule":"pauseAlertRule")}>{state==="paused"?"恢复":"暂停"}</Button><Popconfirm title="确认删除这条告警规则？" onConfirm={()=>act("deleteAlertRule","submitRequest")}><Button danger disabled={!editable||provisioned}>删除</Button></Popconfirm></Space></Flex></BlockShell>};

const AlertStateMetricsRenderer:ExperienceBlockRenderer=({block,children,entityRows})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),stateRef=fieldRefOf(block,"stateFieldRef"),ruleRef=fieldRefOf(block,"ruleIdFieldRef");if(!bound||!stateRef||!ruleRef)return <BlockShell block={block} title={String(block.props?.title??"告警状态")} testid="alert-state-metrics"><BlockEmpty hint="告警状态指标尚未绑定状态和规则字段"/></BlockShell>;const count=(state:string)=>bound.rows.filter(x=>String(x.values?.[stateRef])===state),rules=(state:string)=>new Set(count(state).map(x=>String(x.values?.[ruleRef]))).size;return <BlockShell block={block} title={String(block.props?.title??"告警状态")} testid="alert-state-metrics"><Flex gap={20} wrap><Statistic title="触发规则" value={rules("firing")} valueStyle={{color:"#cf1322"}}/><Statistic title="触发实例" value={count("firing").length}/><Statistic title="等待规则" value={rules("pending")} valueStyle={{color:"#d48806"}}/><Statistic title="等待实例" value={count("pending").length}/></Flex></BlockShell>};

const BookingCapacityMetricsRenderer:ExperienceBlockRenderer=({block,children,entityRows})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),capacityRef=fieldRefOf(block,"capacityFieldRef"),bookedRef=fieldRefOf(block,"bookedFieldRef"),noShowRef=fieldRefOf(block,"noShowFieldRef"),waitRef=fieldRefOf(block,"waitlistFieldRef"),row=bound?.rows[0];if(!bound||!capacityRef||!bookedRef||!row)return <BlockShell block={block} title={String(block.props?.title??"预约容量")} testid="booking-capacity-metrics"><BlockEmpty hint="预约容量尚未绑定容量和已预约字段"/></BlockShell>;const capacity=Number(row.values?.[capacityRef]??0),booked=Number(row.values?.[bookedRef]??0);return <BlockShell block={block} title={String(block.props?.title??"预约容量")} testid="booking-capacity-metrics"><Flex gap={20} wrap><Statistic title="总席位" value={capacity}/><Statistic title="已预约" value={booked}/><Statistic title="剩余" value={Math.max(0,capacity-booked)}/>{noShowRef&&<Statistic title="未到场" value={Number(row.values?.[noShowRef]??0)}/>} {waitRef&&<Statistic title="候补" value={Number(row.values?.[waitRef]??0)}/>}</Flex><Progress percent={capacity>0?Math.min(100,Math.round(booked/capacity*100)):0} size="small" style={{marginTop:8}}/></BlockShell>};

const BookingContextSummaryRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),titleRef=fieldRefOf(block,"titleFieldRef"),startRef=fieldRefOf(block,"startFieldRef"),endRef=fieldRefOf(block,"endFieldRef"),timezoneRef=fieldRefOf(block,"timezoneFieldRef"),locationRef=fieldRefOf(block,"locationFieldRef"),attendeeRef=fieldRefOf(block,"attendeeFieldRef"),recurringRef=fieldRefOf(block,"recurringFieldRef"),row=bound?.rows.find(x=>x.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!titleRef||!startRef||!row)return <BlockShell block={block} title={String(block.props?.title??"预约上下文")} testid="booking-context-summary"><BlockEmpty hint="预约上下文尚未绑定标题和开始时间"/></BlockShell>;const items=[["主题",titleRef],["开始",startRef],["结束",endRef],["时区",timezoneRef],["地点",locationRef],["参与人",attendeeRef],["重复规则",recurringRef]] as const;return <BlockShell block={block} title={String(block.props?.title??"预约上下文")} testid="booking-context-summary"><Descriptions size="small" column={2} items={items.flatMap(([label,ref])=>ref?[{key:label,label,children:String(row.values?.[ref]??"-")}]:[])}/></BlockShell>};

const AlertInstanceSummaryRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),nameRef=fieldRefOf(block,"nameFieldRef"),valueRef=fieldRefOf(block,"valueFieldRef"),labelsRef=fieldRefOf(block,"labelsFieldRef"),summaryRef=fieldRefOf(block,"summaryFieldRef"),startedRef=fieldRefOf(block,"startedFieldRef"),row=bound?.rows.find(x=>x.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!nameRef||!valueRef||!row)return <BlockShell block={block} title={String(block.props?.title??"告警实例")} testid="alert-instance-summary"><BlockEmpty hint="告警实例摘要尚未绑定名称和当前值"/></BlockShell>;return <BlockShell block={block} title={String(block.props?.title??"告警实例")} testid="alert-instance-summary"><Space direction="vertical" size={6} style={{width:"100%"}}><Flex justify="space-between" gap={8}><Typography.Text strong>{String(row.values?.[nameRef]??"未命名实例")}</Typography.Text><Tag color="red">{String(row.values?.[valueRef]??"-")}</Tag></Flex>{summaryRef&&<Typography.Paragraph style={{margin:0}}>{String(row.values?.[summaryRef]??"")}</Typography.Paragraph>}{labelsRef&&<Flex gap={4} wrap>{String(row.values?.[labelsRef]??"").split(",").filter(Boolean).map(x=><Tag key={x}>{x.trim()}</Tag>)}</Flex>}{startedRef&&<Typography.Text type="secondary">开始于 {String(row.values?.[startedRef]??"")}</Typography.Text>}</Space></BlockShell>};

const BookingStatusTabsRenderer:ExperienceBlockRenderer=({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),titleRef=fieldRefOf(block,"titleFieldRef"),keyRef=fieldRefOf(block,"keyFieldRef"),countRef=fieldRefOf(block,"countFieldRef"),enabledRef=fieldRefOf(block,"enabledFieldRef");const [active,setActive]=React.useState(String(block.props?.defaultKey??"upcoming"));if(!bound||!titleRef||!keyRef)return <BlockShell block={block} testid="booking-status-tabs"><BlockEmpty hint="预约页签尚未绑定标题和状态键"/></BlockShell>;const rows=bound.rows.filter(x=>String(x.values?.[keyRef]??""));const selected=rows.some(x=>String(x.values?.[keyRef])===active)?active:String(rows[0]?.values?.[keyRef]??"");return <BlockShell block={block} testid="booking-status-tabs"><Tabs activeKey={selected} onChange={key=>{setActive(key);const row=rows.find(x=>String(x.values?.[keyRef])===key);onAction?.("filterChange",{entityRef:bound.entityRef,rowId:row?.id,statusKey:key,preserveExistingFilters:true,targets:targetIdsOf(block)})}} items={rows.map(x=>({key:String(x.values?.[keyRef]),disabled:Boolean(enabledRef&&[false,"false","disabled"].includes(x.values?.[enabledRef] as never)),label:<Space size={4}>{String(x.values?.[titleRef]??"")}{countRef&&<Badge count={Number(x.values?.[countRef]??0)} showZero/>}</Space>}))}/></BlockShell>};

const ValidatedFormTabsRenderer:ExperienceBlockRenderer=({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),titleRef=fieldRefOf(block,"titleFieldRef"),keyRef=fieldRefOf(block,"keyFieldRef"),errorRef=fieldRefOf(block,"errorCountFieldRef"),dirtyRef=fieldRefOf(block,"dirtyCountFieldRef");const [active,setActive]=React.useState("");if(!bound||!titleRef||!keyRef||!errorRef)return <BlockShell block={block} testid="validated-form-tabs"><BlockEmpty hint="表单页签尚未绑定标题、键和错误数"/></BlockShell>;const selected=bound.rows.some(x=>String(x.values?.[keyRef])===active)?active:String(bound.rows[0]?.values?.[keyRef]??"");return <BlockShell block={block} testid="validated-form-tabs"><Tabs activeKey={selected} onChange={key=>{setActive(key);const row=bound.rows.find(x=>String(x.values?.[keyRef])===key);onAction?.("itemSelect",{entityRef:bound.entityRef,rowId:row?.id,tabKey:key,targets:targetIdsOf(block)})}} items={bound.rows.map(x=>{const errors=Number(x.values?.[errorRef]??0),dirty=dirtyRef?Number(x.values?.[dirtyRef]??0):0;return{key:String(x.values?.[keyRef]),label:<Space size={4}><span style={{color:errors?"#cf1322":undefined}}>{String(x.values?.[titleRef]??"")}</span>{errors?<Badge count={errors}/>:dirty?<Badge color="blue" count={dirty}/>:null}</Space>}})}/></BlockShell>};

const AlertMatcherFilterRenderer:ExperienceBlockRenderer=({block,children,onAction})=>{if(children!=null)return <>{children}</>;const [query,setQuery]=React.useState(String(block.props?.defaultQuery??""));const trimmed=query.trim().replace(/^\{|\}$/g,"");const parts=trimmed?trimmed.split(",").map(x=>x.trim()):[];const valid=!trimmed||parts.every(x=>/^[A-Za-z_][\w.-]*\s*(=~|!~|!=|=)\s*"[^"]*"$/.test(x)&&!/[=!~]\s+"/.test(x));return <BlockShell block={block} title={String(block.props?.title??"标签匹配")} testid="alert-matcher-filter"><Space direction="vertical" style={{width:"100%"}}><Input value={query} status={valid?undefined:"error"} onChange={e=>setQuery(e.target.value)} placeholder={'severity="critical", instance=~"cluster-.+"'}/>{!valid&&<Alert type="error" showIcon message="匹配表达式无效：操作符两侧不要留空格，值必须使用双引号"/>}<Button type="primary" disabled={!valid} onClick={()=>onAction?.("filterChange",{matcherQuery:trimmed,matchers:parts,targets:targetIdsOf(block)})}>应用标签匹配</Button></Space></BlockShell>};

const BookingDirectoryFilterRenderer:ExperienceBlockRenderer=({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),typeRef=fieldRefOf(block,"typeFieldRef"),keyRef=fieldRefOf(block,"keyFieldRef"),titleRef=fieldRefOf(block,"titleFieldRef");const [selected,setSelected]=React.useState<Record<string,string[]>>({}),[query,setQuery]=React.useState(""),[range,setRange]=React.useState<[dayjs.Dayjs,dayjs.Dayjs]|null>(null);if(!bound||!typeRef||!keyRef||!titleRef)return <BlockShell block={block} title={String(block.props?.title??"预约目录筛选")} testid="booking-directory-filter"><BlockEmpty hint="预约目录筛选尚未绑定类型、键和标题"/></BlockShell>;const types=Array.from(new Set(bound.rows.map(x=>String(x.values?.[typeRef]??"")).filter(Boolean)));const emit=(next:Record<string,unknown>)=>onAction?.("filterChange",{facets:selected,attendeeQuery:query.trim(),dateRange:range?.map(x=>x.format("YYYY-MM-DD"))??null,...next,targets:targetIdsOf(block)});return <BlockShell block={block} title={String(block.props?.title??"预约目录筛选")} testid="booking-directory-filter"><Space direction="vertical" style={{width:"100%"}}>{types.map(type=><Select key={type} mode="multiple" allowClear value={selected[type]??[]} placeholder={`选择${type}`} style={{width:"100%"}} options={bound.rows.filter(x=>String(x.values?.[typeRef])===type).map(x=>({value:String(x.values?.[keyRef]),label:String(x.values?.[titleRef])}))} onChange={values=>{const next={...selected,[type]:values};setSelected(next);emit({facets:next})}}/>)}<Flex gap={8} wrap><DatePicker.RangePicker value={range} onChange={value=>{const next=value?.[0]&&value?.[1]?[value[0],value[1]] as [dayjs.Dayjs,dayjs.Dayjs]:null;setRange(next);emit({dateRange:next?.map(x=>x.format("YYYY-MM-DD"))??null})}} style={{flex:"1 1 190px"}}/><Input.Search value={query} onChange={e=>setQuery(e.target.value)} onSearch={value=>emit({attendeeQuery:value.trim()})} placeholder="参与人姓名、邮箱或预约 UID" style={{flex:"1 1 220px"}}/></Flex></Space></BlockShell>};

const BookingDecisionBarRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),titleRef=fieldRefOf(block,"titleFieldRef"),statusRef=fieldRefOf(block,"statusFieldRef"),paidRef=fieldRefOf(block,"paidFieldRef"),recurringRef=fieldRefOf(block,"recurringFieldRef"),row=bound?.rows.find(x=>x.id===focus?.[bound.entityRef])??bound?.rows[0];const [reason,setReason]=React.useState(""),[open,setOpen]=React.useState(false);if(!bound||!titleRef||!statusRef||!row)return <BlockShell block={block} testid="booking-decision-bar"><BlockEmpty hint="预约决策栏尚未绑定标题和状态"/></BlockShell>;const pending=String(row.values?.[statusRef])==="PENDING",paid=!paidRef||[true,"true","paid"].includes(row.values?.[paidRef] as never),recurring=Boolean(recurringRef&&[true,"true","recurring"].includes(row.values?.[recurringRef] as never)),submit=(decision:string,extra={})=>onAction?.("submitRequest",{entityRef:bound.entityRef,rowId:row.id,decision,scope:recurring?"series":"single",...extra,targets:targetIdsOf(block)});return <BlockShell block={block} testid="booking-decision-bar"><Flex justify="space-between" align="center" gap={12} wrap><Space><Typography.Text strong>{String(row.values?.[titleRef]??"预约")}</Typography.Text><Tag>{pending?"待确认":"已处理"}</Tag>{recurring&&<Tag color="blue">系列预约</Tag>}</Space><Space><Button disabled={!pending} onClick={()=>setOpen(true)}>拒绝</Button><Button type="primary" disabled={!pending||!paid} onClick={()=>submit("confirm")}>确认</Button></Space></Flex>{pending&&!paid&&<Typography.Text type="warning">付款完成后才能确认</Typography.Text>}<Modal open={open} title="填写拒绝原因" onCancel={()=>setOpen(false)} onOk={()=>{if(reason.trim()){submit("reject",{reason:reason.trim()});setOpen(false)}}} okButtonProps={{disabled:!reason.trim()}}><Input.TextArea value={reason} onChange={e=>setReason(e.target.value)} rows={3}/></Modal></BlockShell>};

const DashboardSaveBarRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),titleRef=fieldRefOf(block,"titleFieldRef"),dirtyRef=fieldRefOf(block,"dirtyFieldRef"),canSaveRef=fieldRefOf(block,"canSaveFieldRef"),managedRef=fieldRefOf(block,"managedFieldRef"),templateRef=fieldRefOf(block,"templateFieldRef"),row=bound?.rows.find(x=>x.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!titleRef||!dirtyRef||!row)return <BlockShell block={block} testid="dashboard-save-bar"><BlockEmpty hint="Dashboard 保存栏尚未绑定标题和脏状态"/></BlockShell>;const dirty=[true,"true","dirty"].includes(row.values?.[dirtyRef] as never),canSave=!canSaveRef||![false,"false","denied"].includes(row.values?.[canSaveRef] as never),managed=Boolean(managedRef&&[true,"true","managed"].includes(row.values?.[managedRef] as never)),template=Boolean(templateRef&&[true,"true","template"].includes(row.values?.[templateRef] as never)),act=(operation:string)=>onAction?.("submitRequest",{entityRef:bound.entityRef,rowId:row.id,operation,targets:targetIdsOf(block)});const menu={items:[{key:"copy",label:"另存为副本"},{key:"template",label:"另存为模板",disabled:!template}],onClick:({key}:{key:string})=>act(key==="copy"?"saveDashboardCopy":"saveDashboardTemplate")};return <BlockShell block={block} testid="dashboard-save-bar"><Flex justify="space-between" align="center" gap={12} wrap><div><Typography.Text strong>{String(row.values?.[titleRef]??"未命名 Dashboard")}</Typography.Text><Typography.Text type={dirty?"warning":"secondary"} style={{display:"block"}}>{dirty?"有未保存修改":"所有修改已保存"}{managed?" · 受管 Dashboard":""}</Typography.Text></div><Space.Compact><Button type={dirty?"primary":"default"} disabled={!canSave||managed} onClick={()=>act("saveDashboard")}>保存</Button><Dropdown menu={menu} trigger={["click"]}><Button disabled={managed}>更多</Button></Dropdown></Space.Compact></Flex></BlockShell>};

const AlertTriagePanelRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const stateRef = fieldRefOf(block, "stateFieldRef"); const severityRef = fieldRefOf(block, "severityFieldRef"); const timeRef = fieldRefOf(block, "timeFieldRef"); const [scope, setScope] = React.useState("active");
  if (!bound || !titleRef || !stateRef) return <BlockShell block={block} title={String(block.props?.title ?? "告警分诊")} testid="alert-triage-panel"><BlockEmpty hint="告警分诊尚未绑定标题和状态字段" /></BlockShell>;
  const firing = String(block.props?.firingValue ?? "firing"); const pending = String(block.props?.pendingValue ?? "pending"); const shown = bound.rows.filter(row => scope === "all" || [firing, pending].includes(String(row.values?.[stateRef] ?? "")));
  return <BlockShell block={block} title={String(block.props?.title ?? "告警分诊")} testid="alert-triage-panel" extra={<Segmented size="small" value={scope} options={[{ label: `活动 ${bound.rows.filter(row => [firing, pending].includes(String(row.values?.[stateRef] ?? ""))).length}`, value: "active" }, { label: `全部 ${bound.rows.length}`, value: "all" }]} onChange={value => setScope(String(value))} />}><List size="small" dataSource={shown} locale={{ emptyText: <BlockEmpty hint="当前没有匹配告警" /> }} renderItem={row => <List.Item onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })} actions={[<Button key="silence" size="small" onClick={() => onAction?.("actionTrigger", { operation: "openSilence", rowId: row.id, targets: targetIdsOf(block) })}>静默</Button>]}><List.Item.Meta title={<Space><Badge status={String(row.values?.[stateRef]) === firing ? "error" : "warning"} /><Typography.Text strong>{String(row.values?.[titleRef] ?? "未命名告警")}</Typography.Text>{severityRef && <Tag>{String(row.values?.[severityRef] ?? "")}</Tag>}</Space>} description={timeRef ? String(row.values?.[timeRef] ?? "") : undefined} /></List.Item>} /></BlockShell>;
};

const AlertSilenceFormRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const labelRef = fieldRefOf(block, "labelFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0]; const [duration, setDuration] = React.useState("2h"); const [comment, setComment] = React.useState("");
  if (!bound || !row) return <BlockShell block={block} title={String(block.props?.title ?? "创建静默")} testid="alert-silence-form"><BlockEmpty hint="静默表单尚未找到目标告警" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "创建静默")} testid="alert-silence-form"><Space direction="vertical" style={{ width: "100%" }}><Alert type="info" showIcon message={titleRef ? String(row.values?.[titleRef] ?? "当前告警") : "当前告警"} description={labelRef ? `匹配标签：${String(row.values?.[labelRef] ?? "-")}` : undefined} /><Segmented block value={duration} options={[{ label: "30 分钟", value: "30m" }, { label: "2 小时", value: "2h" }, { label: "1 天", value: "1d" }]} onChange={value => setDuration(String(value))} /><Input.TextArea value={comment} onChange={event => setComment(event.target.value)} rows={3} placeholder="填写静默原因" /><Button type="primary" block disabled={!comment.trim()} onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "createSilence", duration, comment, targets: targetIdsOf(block) })}>创建静默</Button></Space></BlockShell>;
};

const AlertRoutingPolicyRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const nameRef = fieldRefOf(block, "nameFieldRef"); const parentRef = fieldRefOf(block, "parentFieldRef"); const matcherRef = fieldRefOf(block, "matcherFieldRef"); const receiverRef = fieldRefOf(block, "receiverFieldRef");
  if (!bound || !nameRef || !parentRef || !receiverRef) return <BlockShell block={block} title={String(block.props?.title ?? "告警路由策略")} testid="alert-routing-policy"><BlockEmpty hint="路由策略尚未绑定名称、父级和接收方字段" /></BlockShell>;
  const childrenOf = (parent: string) => bound.rows.filter(row => String(row.values?.[parentRef] ?? "") === parent); const renderNode = (row: RuntimeRow): React.ReactNode => <div key={row.id} style={{ marginBottom: 8 }}><Flex align="center" justify="space-between" gap={8}><div><Typography.Text strong>{String(row.values?.[nameRef] ?? "未命名策略")}</Typography.Text><div><Typography.Text type="secondary">{matcherRef ? String(row.values?.[matcherRef] ?? "全部告警") : "全部告警"} → {String(row.values?.[receiverRef] ?? "未配置接收方")}</Typography.Text></div></div><Button size="small" onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editPolicy" })}>编辑</Button></Flex>{childrenOf(row.id).length > 0 && <div style={{ borderLeft: `2px solid ${BUSINESS_SPLIT_COLOR}`, marginTop: 8, paddingLeft: 12 }}>{childrenOf(row.id).map(renderNode)}</div>}</div>;
  return <BlockShell block={block} title={String(block.props?.title ?? "告警路由策略")} testid="alert-routing-policy">{childrenOf("").length ? childrenOf("").map(renderNode) : <BlockEmpty hint="当前没有根路由策略" />}</BlockShell>;
};

const DeletedRecordsRecoveryRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const deletedAtRef = fieldRefOf(block, "deletedAtFieldRef"); const deletedByRef = fieldRefOf(block, "deletedByFieldRef");
  if (!bound || !titleRef || !deletedAtRef) return <BlockShell block={block} title={String(block.props?.title ?? "已删除记录")} testid="deleted-records-recovery"><BlockEmpty hint="回收站尚未绑定标题和删除时间字段" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "已删除记录")} testid="deleted-records-recovery" extra={<Badge count={bound.rows.length} showZero />}><List size="small" dataSource={bound.rows} locale={{ emptyText: <BlockEmpty hint="回收站为空" /> }} renderItem={row => <List.Item actions={[<Button key="restore" size="small" onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "restore", targets: targetIdsOf(block) })}>恢复</Button>, <Popconfirm key="delete" title="永久删除后无法恢复，确认继续？" onConfirm={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "hardDelete", targets: targetIdsOf(block) })}><Button danger size="small">永久删除</Button></Popconfirm>]}><List.Item.Meta title={String(row.values?.[titleRef] ?? "未命名记录")} description={`${String(row.values?.[deletedAtRef] ?? "")} ${deletedByRef ? `· ${String(row.values?.[deletedByRef] ?? "")}` : ""}`} /></List.Item>} /></BlockShell>;
};

const RevisionHistoryPanelRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const versionRef = fieldRefOf(block, "versionFieldRef"); const authorRef = fieldRefOf(block, "authorFieldRef"); const timeRef = fieldRefOf(block, "timeFieldRef"); const summaryRef = fieldRefOf(block, "summaryFieldRef"); const currentRef = fieldRefOf(block, "currentFieldRef");
  if (!bound || !versionRef || !timeRef) return <BlockShell block={block} title={String(block.props?.title ?? "修订历史")} testid="revision-history-panel"><BlockEmpty hint="修订历史尚未绑定版本和时间字段" /></BlockShell>;
  const rows = [...bound.rows].sort((a, b) => Number(b.values?.[versionRef] ?? 0) - Number(a.values?.[versionRef] ?? 0));
  return <BlockShell block={block} title={String(block.props?.title ?? "修订历史")} testid="revision-history-panel"><Timeline items={rows.map(row => { const current = currentRef && [true, "true", "current"].includes(row.values?.[currentRef] as never); return { color: current ? "blue" : "gray", children: <Flex justify="space-between" gap={8}><div><Space><Typography.Text strong>版本 {String(row.values?.[versionRef] ?? "-")}</Typography.Text>{current && <Tag color="blue">当前</Tag>}</Space><div><Typography.Text type="secondary">{authorRef ? `${String(row.values?.[authorRef] ?? "")} · ` : ""}{String(row.values?.[timeRef] ?? "")}</Typography.Text></div>{summaryRef && <div>{String(row.values?.[summaryRef] ?? "")}</div>}</div><Space direction="vertical"><Button size="small" onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id, operation: "compareRevision" })}>对比</Button>{!current && <Button size="small" onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "restoreRevision", targets: targetIdsOf(block) })}>恢复</Button>}</Space></Flex> }; })} /></BlockShell>;
};

const RecordComparePanelRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, selection, fieldLabelOf, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const fields = fieldRefListOf(block, "fieldRefs"); const ids = bound ? selection?.rowIds?.[bound.entityRef] ?? [] : []; const rows = bound?.rows.filter(row => ids.includes(row.id)).slice(0, 2) ?? [];
  if (!bound || fields.length === 0) return <BlockShell block={block} title={String(block.props?.title ?? "记录对比")} testid="record-compare-panel"><BlockEmpty hint="记录对比尚未绑定字段" /></BlockShell>;
  if (rows.length !== 2) return <BlockShell block={block} title={String(block.props?.title ?? "记录对比")} testid="record-compare-panel"><Alert type="warning" showIcon message="请选择恰好两条记录进行对比" /></BlockShell>;
  const data = fields.map(field => ({ key: field, field, left: rows[0].values?.[field], right: rows[1].values?.[field], changed: String(rows[0].values?.[field] ?? "") !== String(rows[1].values?.[field] ?? "") }));
  return <BlockShell block={block} title={String(block.props?.title ?? "记录对比")} testid="record-compare-panel" extra={<Tag color="orange">{data.filter(item => item.changed).length} 项差异</Tag>}><Table size="small" rowKey="key" pagination={false} dataSource={data} columns={[{ title: "字段", dataIndex: "field", render: field => fieldLabelOf?.(bound.entityRef, String(field)) ?? String(field) }, { title: rows[0].id, dataIndex: "left", render: value => String(value ?? "-") }, { title: rows[1].id, dataIndex: "right", render: (value, record) => <Typography.Text mark={record.changed}>{String(value ?? "-")}</Typography.Text> }]} /><Flex justify="end" gap={8} style={{ marginTop: 10 }}><Button onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "useAsCanonical", rowId: rows[0].id, comparedRowId: rows[1].id, targets: targetIdsOf(block) })}>采用左侧</Button><Button type="primary" onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "useAsCanonical", rowId: rows[1].id, comparedRowId: rows[0].id, targets: targetIdsOf(block) })}>采用右侧</Button></Flex></BlockShell>;
};

const targetIdsOf = (block: ExperienceBlockInstance) =>
  Array.isArray(block.binding?.targets) ? block.binding.targets.map(String).filter(Boolean) : [];

/** 路径只负责定位上下文，末级只读；单级路径不占据页头。 */
const ContextBreadcrumbRenderer: ExperienceBlockRenderer = ({ block, children, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const items = Array.isArray(block.props?.items) ? block.props.items.map(String).filter(Boolean) : [];
  if (items.length < 2) return null;
  return <BlockShell block={block} testid="context-breadcrumb"><Breadcrumb items={items.map((title, index) => ({ title: index === items.length - 1 ? title : <Button type="link" size="small" style={{ padding: 0 }} onClick={() => onAction?.("actionTrigger", { operation: "navigateBreadcrumb", index, title })}>{title}</Button> }))} /></BlockShell>;
};

/** 手动刷新和安全轮询共享一个控制器，宿主拥有真正的数据请求。 */
const LiveRefreshControlRenderer: ExperienceBlockRenderer = ({ block, children, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const targets = targetIdsOf(block);
  const [polling, setPolling] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [lastAt, setLastAt] = React.useState("");
  const refresh = () => { setRefreshing(true); onAction?.("actionTrigger", { operation: "refresh", targets }); setLastAt(dayjs().format("HH:mm:ss")); setRefreshing(false); };
  return <BlockShell block={block} title={String(block.props?.title ?? "数据刷新")} testid="live-refresh-control" extra={<Badge status={polling ? "processing" : "default"} text={polling ? "自动刷新中" : "已暂停"} />}><Flex align="center" justify="space-between" gap={12} wrap><Typography.Text type="secondary">{lastAt ? `最近刷新 ${lastAt}` : "尚未刷新"}</Typography.Text><Space><Button loading={refreshing} disabled={targets.length === 0} onClick={refresh}>刷新</Button><Button type={polling ? "default" : "primary"} disabled={targets.length === 0} onClick={() => { const next = !polling; setPolling(next); onAction?.("actionTrigger", { operation: next ? "startPolling" : "stopPolling", intervalMs: Number(block.props?.intervalMs ?? 30000), targets }); }}>{polling ? "暂停轮询" : "开启轮询"}</Button></Space></Flex></BlockShell>;
};

/** 只回显和撤销已生效条件，不创建新的筛选条件。 */
const ActiveFilterSummaryRenderer: ExperienceBlockRenderer = ({ block, children, filterState, onFilterChange, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const enumItems = Object.entries(filterState?.enumFilters ?? {}).filter(([, value]) => value);
  const multiItems = Object.entries(filterState?.enumMulti ?? {}).flatMap(([key, values]) => values.map(value => [`${key}:${value}`, value] as const));
  const items = [...enumItems.map(([key, value]) => [key, String(value)] as const), ...multiItems];
  if (items.length === 0 && !filterState?.dateRange) return null;
  const clearAll = () => { onFilterChange?.({ enumFilters: {}, enumMulti: {}, dateRange: null }); onAction?.("filterChange", { operation: "clearAll", targets: targetIdsOf(block) }); };
  return <BlockShell block={block} title={String(block.props?.title ?? "已应用条件")} testid="active-filter-summary" extra={<Button type="link" size="small" onClick={clearAll}>全部清除</Button>}><Flex gap={6} wrap>{items.map(([key, value]) => <Tag key={key} closable onClose={() => { const next = { ...(filterState?.enumFilters ?? {}) }; delete next[key]; onFilterChange?.({ enumFilters: next }); onAction?.("filterChange", { operation: "remove", key, targets: targetIdsOf(block) }); }}>{key}：{value}</Tag>)}{filterState?.dateRange && <Tag closable onClose={() => onFilterChange?.({ dateRange: null })}>{filterState.dateRange.join(" 至 ")}</Tag>}</Flex></BlockShell>;
};

/** 仪表盘多个目标共享一份时间口径，快捷周期与自定义范围共用受控值。 */
const AnalyticsDateScopeRenderer: ExperienceBlockRenderer = ({ block, children, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const [preset, setPreset] = React.useState(String(block.props?.defaultPreset ?? "month"));
  const publish = (next: string, range?: [string, string]) => { setPreset(next); onAction?.("filterChange", { operation: "dateScope", preset: next, range, targets: targetIdsOf(block) }); };
  return <BlockShell block={block} title={String(block.props?.title ?? "时间口径")} testid="analytics-date-scope"><Flex gap={8} wrap align="center"><Segmented value={preset} options={[{ label: "今日", value: "today" }, { label: "本周", value: "week" }, { label: "本月", value: "month" }, { label: "本年", value: "year" }]} onChange={value => publish(String(value))} /><DatePicker.RangePicker onChange={dates => dates?.[0] && dates?.[1] && publish("custom", [dates[0].format("YYYY-MM-DD"), dates[1].format("YYYY-MM-DD")])} /></Flex></BlockShell>;
};

/** 当前业务对象的少量关键字段摘要；完整详情仍由 main/aside 的 RecordDetail 承担。 */
const HeaderEntitySummaryRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, fieldLabelOf, fieldTypeOf, fieldSchemaOf, enumOptionsOf }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const fields = fieldRefListOf(block, "fieldRefs"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !row || fields.length === 0) return <BlockShell block={block} testid="header-entity-summary"><BlockEmpty hint="页头实体摘要尚未绑定当前记录和关键字段" /></BlockShell>;
  return <BlockShell block={block} title={String(row.values?.[titleRef] ?? block.props?.title ?? "当前记录")} testid="header-entity-summary"><ProDescriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} dataSource={row.values ?? {}} columns={fields.slice(0, 6).map(field => { const options = enumOptionsOf?.(bound.entityRef, field) ?? []; const semantic = fieldSemantic(bound.entityRef, field, row.values?.[field], fieldTypeOf, options, fieldSchemaOf); return { key: field, dataIndex: field, title: fieldLabelOf?.(bound.entityRef, field) ?? field, render: (_: unknown, record: Record<string, unknown>) => renderCell(semantic, record?.[field], options, fieldLabelOf?.(bound.entityRef, field) ?? field) }; })} /></BlockShell>;
};

/** 单个当前对象的进度、状态和下一节点摘要，不与多指标 MetricGrid 重复。 */
const HeaderProgressSummaryRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const currentRef = fieldRefOf(block, "currentFieldRef"); const totalRef = fieldRefOf(block, "totalFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const nextRef = fieldRefOf(block, "nextFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !currentRef || !totalRef || !row) return <BlockShell block={block} testid="header-progress-summary"><BlockEmpty hint="页头进度摘要尚未绑定当前值和总量字段" /></BlockShell>;
  const current = Number(row.values?.[currentRef] ?? 0); const total = Number(row.values?.[totalRef] ?? 0); const percent = total > 0 ? Math.min(100, Math.max(0, Math.round(current / total * 100))) : 0;
  return <BlockShell block={block} title={titleRef ? String(row.values?.[titleRef] ?? "当前进度") : String(block.props?.title ?? "当前进度")} testid="header-progress-summary" extra={statusRef ? <Tag color="processing">{String(row.values?.[statusRef] ?? "")}</Tag> : undefined}><Flex gap={16} align="center"><Progress type="circle" size={64} percent={percent} /><div><Typography.Text strong>{current} / {total}</Typography.Text>{nextRef && <div><Typography.Text type="secondary">下一步：{String(row.values?.[nextRef] ?? "待确认")}</Typography.Text></div>}</div></Flex></BlockShell>;
};

const WorkspaceTabsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef");
  const [closed, setClosed] = React.useState<string[]>([]); const [active, setActive] = React.useState("");
  if (!bound || !titleRef) return <BlockShell block={block} testid="workspace-tabs"><BlockEmpty hint="工作页签尚未绑定标题字段" /></BlockShell>;
  const rows = bound.rows.filter(row => !closed.includes(row.id)); const key = rows.some(row => row.id === active) ? active : rows[0]?.id;
  if (!key) return null;
  return <BlockShell block={block} testid="workspace-tabs"><Tabs type="editable-card" hideAdd activeKey={key} items={rows.map(row => ({ key: row.id, label: String(row.values?.[titleRef] ?? "未命名页签") }))} onChange={next => { setActive(next); onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: next }); }} onEdit={(target, action) => { if (action !== "remove" || rows.length <= 1) return; const id = String(target); setClosed(current => [...current, id]); onAction?.("actionTrigger", { operation: "close", rowId: id }); }} /></BlockShell>;
};

const SavedViewTabsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const presetRef = fieldRefOf(block, "presetKeyFieldRef"); const countRef = fieldRefOf(block, "countFieldRef");
  const [active, setActive] = React.useState("all");
  if (!bound || !titleRef || !presetRef) return <BlockShell block={block} testid="saved-view-tabs"><BlockEmpty hint="保存视图尚未绑定名称和预设键" /></BlockShell>;
  const items = [{ key: "all", label: "全部" }, ...bound.rows.flatMap(row => { const key = String(row.values?.[presetRef] ?? ""); return key ? [{ key, label: <Space size={4}>{String(row.values?.[titleRef] ?? "未命名视图")}{countRef && <Badge count={Number(row.values?.[countRef] ?? 0)} showZero />}</Space> }] : []; })];
  return <BlockShell block={block} testid="saved-view-tabs" extra={<Button size="small" onClick={() => onAction?.("submitRequest", { operation: "saveView", targets: targetIdsOf(block) })}>保存当前视图</Button>}><Tabs activeKey={active} items={items} onChange={key => { setActive(key); onAction?.("filterChange", { operation: key === "all" ? "clear" : "apply", presetKey: key, targets: targetIdsOf(block) }); }} /></BlockShell>;
};

const AdvancedFilterBuilderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, fieldLabelOf, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const fields = fieldRefListOf(block, "fieldRefs");
  const [logic, setLogic] = React.useState("and"); const [conditions, setConditions] = React.useState<Array<{ field: string; operator: string; value: string }>>([{ field: fields[0] ?? "", operator: "equals", value: "" }]);
  if (!bound || fields.length === 0) return <BlockShell block={block} title={String(block.props?.title ?? "高级筛选")} testid="advanced-filter-builder"><BlockEmpty hint="高级筛选尚未绑定可筛选字段" /></BlockShell>;
  const update = (index: number, patch: Partial<(typeof conditions)[number]>) => setConditions(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  return <BlockShell block={block} title={String(block.props?.title ?? "高级筛选")} testid="advanced-filter-builder" extra={<Segmented size="small" value={logic} options={[{ label: "全部满足", value: "and" }, { label: "任一满足", value: "or" }]} onChange={value => setLogic(String(value))} />}><Space direction="vertical" style={{ width: "100%" }}>{conditions.map((condition, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))", gap: 8 }}><Select value={condition.field} style={{ width: "100%", minWidth: 0 }} options={fields.map(field => ({ value: field, label: fieldLabelOf?.(bound.entityRef, field) ?? field }))} onChange={field => update(index, { field, value: "" })} /><Select value={condition.operator} style={{ width: "100%", minWidth: 0 }} options={[{ label: "等于", value: "equals" }, { label: "包含", value: "contains" }, { label: "不等于", value: "notEquals" }]} onChange={operator => update(index, { operator })} /><Input value={condition.value} onChange={event => update(index, { value: event.target.value })} style={{ width: "100%", minWidth: 0 }} /><Button danger disabled={conditions.length === 1} onClick={() => setConditions(current => current.filter((_, i) => i !== index))}>删除</Button></div>)}<Flex justify="space-between" gap={8} wrap><Button onClick={() => setConditions(current => [...current, { field: fields[0], operator: "equals", value: "" }])}>添加条件</Button><Space wrap><Button onClick={() => setConditions([{ field: fields[0], operator: "equals", value: "" }])}>重置</Button><Button type="primary" onClick={() => onAction?.("filterChange", { operation: "submit", logic, conditions: conditions.filter(item => item.field && item.value), targets: targetIdsOf(block) })}>应用筛选</Button></Space></Flex></Space></BlockShell>;
};

const FacetedFilterPanelRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, fieldLabelOf, enumOptionsOf, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const fields = fieldRefListOf(block, "fieldRefs"); const [selected, setSelected] = React.useState<Record<string, string[]>>({});
  if (!bound || fields.length < 2) return <BlockShell block={block} title={String(block.props?.title ?? "分面筛选")} testid="faceted-filter-panel"><BlockEmpty hint="分面筛选至少需要两个枚举字段" /></BlockShell>;
  const toggle = (field: string, values: string[]) => { const next = { ...selected, [field]: values }; setSelected(next); onAction?.("filterChange", { operation: "toggleValue", facets: next, targets: targetIdsOf(block) }); };
  return <BlockShell block={block} title={String(block.props?.title ?? "分面筛选")} testid="faceted-filter-panel" extra={<Button type="link" size="small" onClick={() => { setSelected({}); onAction?.("filterChange", { operation: "clearAll", targets: targetIdsOf(block) }); }}>全部清除</Button>}><Collapse size="small" defaultActiveKey={fields} items={fields.map(field => { const declared = enumOptionsOf?.(bound.entityRef, field) ?? []; const values = declared.length ? declared.map(option => ({ value: option.id, label: option.label })) : Array.from(new Set(bound.rows.map(row => String(row.values?.[field] ?? "")).filter(Boolean))).map(value => ({ value, label: value })); return { key: field, label: fieldLabelOf?.(bound.entityRef, field) ?? field, children: values.length ? <Checkbox.Group value={selected[field] ?? []} onChange={next => toggle(field, next.map(String))}><Flex gap={8} vertical>{values.map(option => <Checkbox key={option.value} value={option.value}>{option.label} <Typography.Text type="secondary">({bound.rows.filter(row => String(row.values?.[field] ?? "") === option.value).length})</Typography.Text></Checkbox>)}</Flex></Checkbox.Group> : <BlockEmpty hint="当前分面没有可选值" /> }; })} /></BlockShell>;
};

const WizardNavigationBarRenderer: ExperienceBlockRenderer = ({ block, children, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const steps = Array.isArray(block.props?.steps) ? block.props.steps.map(String) : []; const total = Math.max(steps.length, Number(block.props?.total ?? 3)); const [current, setCurrent] = React.useState(Math.min(total - 1, Math.max(0, Number(block.props?.initialStep ?? 0))));
  const move = (next: number) => { setCurrent(next); onAction?.("stepChange", { current: next, total, direction: next > current ? "next" : "previous", targets: targetIdsOf(block) }); };
  return <BlockShell block={block} testid="wizard-navigation-bar"><Flex align="center" justify="space-between" gap={10} style={{ flexWrap: "wrap", width: "100%" }}><div style={{ minWidth: 0, flex: "1 1 160px" }}><Typography.Text>第 {current + 1} / {total} 步{steps[current] ? ` · ${steps[current]}` : ""}</Typography.Text><Progress percent={Math.round((current + 1) / total * 100)} showInfo={false} size="small" /></div><Space wrap style={{ marginLeft: "auto", maxWidth: "100%" }}>{current > 0 && <Button onClick={() => move(current - 1)}>上一步</Button>}{current < total - 1 ? <Button type="primary" onClick={() => move(current + 1)}>下一步</Button> : <Button type="primary" onClick={() => onAction?.("submitRequest", { operation: "finishWizard", current, total, targets: targetIdsOf(block) })}>提交</Button>}</Space></Flex></BlockShell>;
};

const ApprovalDecisionBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const statusRef = fieldRefOf(block, "statusFieldRef"); const titleRef = fieldRefOf(block, "titleFieldRef"); const [rejecting, setRejecting] = React.useState(false); const [reason, setReason] = React.useState("");
  const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0]; const status = statusRef && row ? String(row.values?.[statusRef] ?? "pending") : ""; const pending = status === String(block.props?.pendingValue ?? "pending");
  if (!bound || !statusRef) return <BlockShell block={block} testid="approval-decision-bar"><BlockEmpty hint="审批决策栏尚未绑定状态字段" /></BlockShell>;
  const submit = (decision: string, extra?: Record<string, unknown>) => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, decision, ...extra });
  return <BlockShell block={block} testid="approval-decision-bar"><Flex align="center" justify="space-between" gap={12} wrap><Space><Tag color={pending ? "processing" : "default"}>{pending ? "待处理" : status || "无任务"}</Tag><Typography.Text>{row && titleRef ? String(row.values?.[titleRef] ?? "当前审批") : "当前审批"}</Typography.Text></Space><Space><Button disabled={!row || !pending} onClick={() => setRejecting(true)}>驳回</Button><Button type="primary" disabled={!row || !pending} onClick={() => submit("approve")}>通过</Button></Space></Flex><Modal title="填写驳回原因" open={rejecting} okButtonProps={{ disabled: !reason.trim() }} onCancel={() => setRejecting(false)} onOk={() => { submit("reject", { reason }); setRejecting(false); }}><Input.TextArea value={reason} onChange={event => setReason(event.target.value)} rows={4} placeholder="原因不能为空" /></Modal></BlockShell>;
};

const CheckoutSummaryBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, selection, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const amountRef = fieldRefOf(block, "amountFieldRef"); const discountRef = fieldRefOf(block, "discountFieldRef"); const rowIds = bound ? selection?.rowIds?.[bound.entityRef] ?? [] : []; const rows = bound?.rows.filter(row => rowIds.includes(row.id)) ?? []; const amount = rows.reduce((sum, row) => sum + Number(row.values?.[amountRef ?? ""] ?? 0), 0); const discount = rows.reduce((sum, row) => sum + Number(row.values?.[discountRef ?? ""] ?? 0), 0); const [agreed, setAgreed] = React.useState(false);
  if (!bound || !amountRef) return <BlockShell block={block} testid="checkout-summary-bar"><BlockEmpty hint="结算栏尚未绑定金额字段" /></BlockShell>;
  return <BlockShell block={block} testid="checkout-summary-bar"><Flex align="center" justify="space-between" gap={16} wrap><Space size="large"><Typography.Text>已选 {rows.length} 项</Typography.Text><Statistic title="应付" value={Math.max(0, amount - discount)} precision={2} prefix="¥" /></Space><Space><Checkbox checked={agreed} onChange={event => setAgreed(event.target.checked)}>已确认提交协议</Checkbox><Button type="primary" disabled={rows.length === 0 || !agreed} onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, operation: "checkout", rowIds, amount, discount, total: Math.max(0, amount - discount), agreementAccepted: agreed })}>确认提交</Button></Space></Flex></BlockShell>;
};

const RecordLifecycleBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children !== undefined && children !== null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]); const statusRef = fieldRefOf(block, "statusFieldRef");
  if (!bound) return <BlockShell block={block} testid="record-lifecycle-bar"><BlockEmpty hint="记录操作栏尚未绑定实体" /></BlockShell>;
  return <BlockShell block={block} testid="record-lifecycle-bar"><Flex align="center" justify="space-between" gap={12} wrap><Space>{statusRef && row && <Tag>{String(row.values?.[statusRef] ?? "")}</Tag>}<Typography.Text type="secondary">{row ? `当前记录 ${row.id}` : "请先选择一条记录"}</Typography.Text></Space><Space><Button disabled={!row} onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: "save" })}>保存</Button><Button disabled={!row} onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: "archive" })}>归档</Button><Popconfirm title="删除后无法恢复，确认继续？" onConfirm={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row?.id, operation: "delete" })}><Button danger disabled={!row}>删除</Button></Popconfirm></Space></Flex></BlockShell>;
};

const enabledValue = (value: unknown, positive = "enabled") =>
  value === true || [positive, "true", "allowed", "active", "ready", "healthy"].includes(String(value ?? "").toLowerCase());

const WorkItemCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const priorityRef = fieldRefOf(block, "priorityFieldRef"); const assigneeRef = fieldRefOf(block, "assigneeFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !statusRef || !row) return <BlockShell block={block} testid="work-item-command-header"><BlockEmpty hint="工作项页头尚未绑定标题和状态" /></BlockShell>;
  const status = String(row.values?.[statusRef] ?? "open"); const closed = ["done", "closed", "archived", "completed"].includes(status.toLowerCase()); const act = (operation: string, event = "actionTrigger") => onAction?.(event, { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="work-item-command-header"><Flex align="center" justify="space-between" gap={12} wrap><div><Space><Typography.Title level={5} style={{ margin: 0 }}>{String(row.values?.[titleRef] ?? "未命名工作项")}</Typography.Title><Tag color={closed ? "default" : "processing"}>{status}</Tag>{priorityRef && <Tag>{String(row.values?.[priorityRef] ?? "")}</Tag>}</Space>{assigneeRef && <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>负责人：{String(row.values?.[assigneeRef] ?? "未分配")}</Typography.Text>}</div><Space wrap><Button onClick={() => act("editWorkItem", "editRequest")}>编辑</Button><Button onClick={() => act("duplicateWorkItem")}>复制</Button><Popconfirm title={closed ? "确认重新打开？" : "确认归档当前工作项？"} onConfirm={() => act(closed ? "reopenWorkItem" : "archiveWorkItem", "submitRequest")}><Button danger={!closed}>{closed ? "重新打开" : "归档"}</Button></Popconfirm></Space></Flex></BlockShell>;
};

const DocumentCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const stateRef = fieldRefOf(block, "stateFieldRef"); const permissionRef = fieldRefOf(block, "permissionFieldRef"); const revisionRef = fieldRefOf(block, "revisionFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !stateRef || !row) return <BlockShell block={block} testid="document-command-header"><BlockEmpty hint="文档页头尚未绑定标题和状态" /></BlockShell>;
  const state = String(row.values?.[stateRef] ?? "draft"); const canPublish = !permissionRef || enabledValue(row.values?.[permissionRef], "publish"); const revision = Boolean(revisionRef && row.values?.[revisionRef]); const act = (operation: string, event = "actionTrigger") => onAction?.(event, { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="document-command-header"><Flex align="center" justify="space-between" gap={12} wrap><Space><Typography.Title level={5} style={{ margin: 0 }}>{String(row.values?.[titleRef] ?? "未命名文档")}</Typography.Title><Tag color={state === "published" ? "success" : "warning"}>{state === "published" ? "已发布" : "草稿"}</Tag>{revision && <Tag color="blue">历史修订</Tag>}</Space><Space wrap>{revision ? <Button type="primary" disabled={!canPublish} onClick={() => act("restoreRevision", "submitRequest")}>恢复此版本</Button> : <><Button onClick={() => act("saveDraft", "editRequest")}>保存草稿</Button><Button type="primary" disabled={!canPublish} onClick={() => act(state === "published" ? "finishEditing" : "publishDocument", "submitRequest")}>{state === "published" ? "完成编辑" : "发布"}</Button></>}</Space></Flex></BlockShell>;
};

const EnvironmentStatusStripRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const nameRef = fieldRefOf(block, "nameFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef");
  if (!bound || !nameRef || !statusRef) return <BlockShell block={block} testid="environment-status-strip"><BlockEmpty hint="环境状态尚未绑定名称和状态" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "环境状态")} testid="environment-status-strip"><Flex gap={8} wrap>{bound.rows.map(row => { const status = String(row.values?.[statusRef] ?? "unknown"); const healthy = enabledValue(status); return <Button key={row.id} size="small" onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}><Badge status={healthy ? "success" : status === "warning" ? "warning" : "error"} text={`${String(row.values?.[nameRef] ?? "环境")} · ${status}`} /></Button>; })}</Flex></BlockShell>;
};

const DataFreshnessIndicatorRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const sourceRef = fieldRefOf(block, "sourceFieldRef"); const updatedRef = fieldRefOf(block, "updatedAtFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const row = bound?.rows[0];
  if (!bound || !sourceRef || !updatedRef || !row) return <BlockShell block={block} testid="data-freshness-indicator"><BlockEmpty hint="数据新鲜度尚未绑定来源和更新时间" /></BlockShell>;
  const status = statusRef ? String(row.values?.[statusRef] ?? "fresh") : "fresh"; const stale = ["stale", "delayed", "error"].includes(status.toLowerCase());
  return <BlockShell block={block} testid="data-freshness-indicator"><Flex align="center" justify="space-between" gap={10} wrap><Space><Badge status={stale ? "warning" : "success"} /><div><Typography.Text strong>{String(row.values?.[sourceRef] ?? "数据源")}</Typography.Text><Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>更新于 {String(row.values?.[updatedRef] ?? "-")} · {stale ? "可能延迟" : "数据新鲜"}</Typography.Text></div></Space><Button size="small" onClick={() => onAction?.("actionTrigger", { operation: "refreshFreshness", targets: targetIdsOf(block) })}>刷新</Button></Flex></BlockShell>;
};

/**
 * 上下文摘要的读态（2026-08-10 改）。
 *
 * 此前这里是 `String(row.values?.[field] ?? "-")` —— 裸字符串。同一个字段，
 * 旁边的 DataTable / RecordDetail / HeaderEntitySummary 走的是
 * `fieldSemantic` + `renderCell`，于是同一份数据在同一个页面上有两副长相：
 *
 *     金额 1234567   →  摘要里「1234567」        表格里「¥1,234,567.00」
 *     状态 pending   →  摘要里「pending」        表格里 一个橙色的「待处理」
 *     日期 …T09:30Z  →  摘要里 ISO 原文          表格里「2026-08-10」
 *
 * 这不是风格差异，是**读态没走数据模型的语义声明**：枚举的 label 和 tone 明明
 * 在模型里声明了，摘要却把取值 id 摊在用户脸上。14 个区块共用这个工厂，所以
 * 一处写法差错出现 14 次。
 *
 * 改成和 HeaderEntitySummary 同一条路：ProDescriptions + renderCell。读侧和
 * 写侧（ProFormMoney 那一档）由此共用同一个 valueType 判定，跟 ProComponents
 * 把 ProField 作为 ProForm 读态的做法是同一条纪律。
 */
const compactSummaryRenderer = (testid: string, fallback: string): ExperienceBlockRenderer => ({ block, children, entityRows, focus, fieldLabelOf, fieldTypeOf, fieldSchemaOf, enumOptionsOf }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const fields = fieldRefListOf(block, "fieldRefs"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !fields.length || !row) return <BlockShell block={block} testid={testid}><BlockEmpty hint={`${fallback}尚未绑定当前记录和摘要字段`} /></BlockShell>;
  return <BlockShell block={block} title={String(row.values?.[titleRef] ?? fallback)} testid={testid}><ProDescriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} dataSource={row.values ?? {}} columns={fields.slice(0, 6).map(field => { const options = enumOptionsOf?.(bound.entityRef, field) ?? []; const semantic = fieldSemantic(bound.entityRef, field, row.values?.[field], fieldTypeOf, options, fieldSchemaOf); return { key: field, dataIndex: field, title: fieldLabelOf?.(bound.entityRef, field) ?? field, render: (_: unknown, record: Record<string, unknown>) => renderCell(semantic, record?.[field], options, fieldLabelOf?.(bound.entityRef, field) ?? field) }; })} /></BlockShell>;
};
const WorkItemContextSummaryRenderer = compactSummaryRenderer("work-item-context-summary", "工作项摘要");

const stableTabsRenderer = (testid: string, fallback: string, event: "itemSelect" | "filterChange"): ExperienceBlockRenderer => ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const keyRef = fieldRefOf(block, "keyFieldRef"); const countRef = fieldRefOf(block, "countFieldRef"); const enabledRef = fieldRefOf(block, "enabledFieldRef"); const [active, setActive] = React.useState("");
  if (!bound || !titleRef || !keyRef) return <BlockShell block={block} testid={testid}><BlockEmpty hint={`${fallback}尚未绑定标题和稳定键`} /></BlockShell>;
  const rows = bound.rows.filter(row => String(row.values?.[keyRef] ?? "")); const usable = rows.filter(row => !enabledRef || ![false, "false", "disabled"].includes(row.values?.[enabledRef] as never)); const selected = usable.some(row => String(row.values?.[keyRef]) === active) ? active : String(usable[0]?.values?.[keyRef] ?? "");
  return <BlockShell block={block} testid={testid}><Tabs activeKey={selected} onChange={key => { setActive(key); const row = rows.find(item => String(item.values?.[keyRef]) === key); onAction?.(event, { entityRef: bound.entityRef, rowId: row?.id, tabKey: key, targets: targetIdsOf(block) }); }} items={rows.map(row => ({ key: String(row.values?.[keyRef]), label: <Space size={4}>{String(row.values?.[titleRef] ?? fallback)}{countRef && <Badge count={Number(row.values?.[countRef] ?? 0)} showZero />}</Space>, disabled: Boolean(enabledRef && [false, "false", "disabled"].includes(row.values?.[enabledRef] as never)) }))} /></BlockShell>;
};


const DashboardParameterBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const keyRef = fieldRefOf(block, "keyFieldRef"); const valueRef = fieldRefOf(block, "valueFieldRef"); const requiredRef = fieldRefOf(block, "requiredFieldRef"); const [values, setValues] = React.useState<Record<string, string>>({});
  if (!bound || !titleRef || !keyRef) return <BlockShell block={block} testid="dashboard-parameter-bar"><BlockEmpty hint="Dashboard 参数尚未绑定标题和参数键" /></BlockShell>;
  const resolved = Object.fromEntries(bound.rows.map(row => { const key = String(row.values?.[keyRef] ?? row.id); return [key, values[key] ?? String(valueRef ? row.values?.[valueRef] ?? "" : "")]; })); const missing = bound.rows.some(row => requiredRef && enabledValue(row.values?.[requiredRef], "required") && !resolved[String(row.values?.[keyRef] ?? row.id)]?.trim());
  return <BlockShell block={block} title={String(block.props?.title ?? "Dashboard 参数")} testid="dashboard-parameter-bar"><Flex gap={8} align="end" wrap>{bound.rows.map(row => { const key = String(row.values?.[keyRef] ?? row.id); return <div key={row.id}><Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>{String(row.values?.[titleRef] ?? "参数")}</Typography.Text><Input value={resolved[key]} placeholder={requiredRef && enabledValue(row.values?.[requiredRef], "required") ? "必填" : "全部"} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} /></div>; })}<Button type="primary" disabled={missing} onClick={() => onAction?.("filterChange", { parameters: resolved, targets: targetIdsOf(block) })}>应用</Button></Flex></BlockShell>;
};

const CycleHealthMetricsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const completedRef = fieldRefOf(block, "completedFieldRef"); const totalRef = fieldRefOf(block, "totalFieldRef"); const overdueRef = fieldRefOf(block, "overdueFieldRef"); const unstartedRef = fieldRefOf(block, "unstartedFieldRef"); const row = bound?.rows[0];
  if (!bound || !completedRef || !totalRef || !row) return <BlockShell block={block} testid="cycle-health-metrics"><BlockEmpty hint="周期健康指标尚未绑定完成数和总数" /></BlockShell>;
  const completed = Number(row.values?.[completedRef] ?? 0); const total = Number(row.values?.[totalRef] ?? 0); return <BlockShell block={block} title={String(block.props?.title ?? "周期健康")} testid="cycle-health-metrics"><Flex gap={22} wrap><Statistic title="已完成" value={completed} suffix={`/ ${total}`} /><Statistic title="完成率" value={total ? Math.round(completed / total * 100) : 0} suffix="%" />{overdueRef && <Statistic title="已逾期" value={Number(row.values?.[overdueRef] ?? 0)} />}{unstartedRef && <Statistic title="未开始" value={Number(row.values?.[unstartedRef] ?? 0)} />}</Flex><Progress percent={total ? Math.min(100, Math.round(completed / total * 100)) : 0} showInfo={false} size="small" /></BlockShell>;
};

const QueryExecutionMetricsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const timeRef = fieldRefOf(block, "timeFieldRef"); const rowsRef = fieldRefOf(block, "rowsFieldRef"); const cachedRef = fieldRefOf(block, "cachedFieldRef"); const bytesRef = fieldRefOf(block, "bytesFieldRef"); const row = bound?.rows[0];
  if (!bound || !timeRef || !rowsRef || !row) return <BlockShell block={block} testid="query-execution-metrics"><BlockEmpty hint="查询指标尚未绑定耗时和行数" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "查询执行")} testid="query-execution-metrics"><Flex gap={22} wrap><Statistic title="执行耗时" value={Number(row.values?.[timeRef] ?? 0)} suffix="ms" /><Statistic title="结果行数" value={Number(row.values?.[rowsRef] ?? 0)} />{bytesRef && <Statistic title="扫描字节" value={Number(row.values?.[bytesRef] ?? 0)} />}{cachedRef && <Statistic title="结果来源" value={enabledValue(row.values?.[cachedRef], "cached") ? "缓存" : "实时"} />}</Flex></BlockShell>;
};

const BulkSelectionBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, selection, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const rowIds = bound ? selection?.rowIds?.[bound.entityRef] ?? [] : [];
  if (!bound) return <BlockShell block={block} testid="bulk-selection-bar"><BlockEmpty hint="批量选择栏尚未绑定实体" /></BlockShell>;
  const submit = (operation: string) => onAction?.("submitRequest", { entityRef: bound.entityRef, rowIds, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="bulk-selection-bar"><Flex align="center" justify="space-between" gap={12} wrap><Typography.Text strong>已选择 {rowIds.length} 项</Typography.Text><Space wrap><Button disabled={!rowIds.length} onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowIds, operation: "bulkMove", targets: targetIdsOf(block) })}>移动</Button><Button disabled={!rowIds.length} onClick={() => submit("bulkArchive")}>归档</Button><Popconfirm title={`确认删除所选 ${rowIds.length} 项？`} onConfirm={() => submit("bulkDelete")}><Button danger disabled={!rowIds.length}>删除</Button></Popconfirm></Space></Flex></BlockShell>;
};

const DraftPublishBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const stateRef = fieldRefOf(block, "stateFieldRef"); const dirtyRef = fieldRefOf(block, "dirtyFieldRef"); const canPublishRef = fieldRefOf(block, "canPublishFieldRef"); const locationRef = fieldRefOf(block, "locationFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !stateRef || !row) return <BlockShell block={block} testid="draft-publish-bar"><BlockEmpty hint="草稿发布栏尚未绑定标题和状态" /></BlockShell>;
  const dirty = !dirtyRef || enabledValue(row.values?.[dirtyRef], "dirty"); const canPublish = !canPublishRef || enabledValue(row.values?.[canPublishRef], "publish"); const location = locationRef ? String(row.values?.[locationRef] ?? "") : ""; const submit = (operation: string, event = "submitRequest") => onAction?.(event, { entityRef: bound.entityRef, rowId: row.id, operation, location, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="draft-publish-bar"><Flex align="center" justify="space-between" gap={12} wrap><div><Typography.Text strong>{String(row.values?.[titleRef] ?? "未命名草稿")}</Typography.Text><Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>{dirty ? "有未保存修改" : "草稿已保存"}{location ? ` · 发布到 ${location}` : ""}</Typography.Text></div><Space><Button disabled={!dirty} onClick={() => submit("saveDraft", "editRequest")}>保存草稿</Button><Button type="primary" disabled={!canPublish || !location} onClick={() => submit("publishDocument")}>发布</Button></Space></Flex></BlockShell>;
};

const QuestionCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const savedRef = fieldRefOf(block, "savedFieldRef"); const dirtyRef = fieldRefOf(block, "dirtyFieldRef"); const bookmarkRef = fieldRefOf(block, "bookmarkFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !row) return <BlockShell block={block} testid="question-command-header"><BlockEmpty hint="问题页头尚未绑定标题" /></BlockShell>;
  const saved = savedRef ? enabledValue(row.values?.[savedRef], "saved") : false; const dirty = dirtyRef ? enabledValue(row.values?.[dirtyRef], "dirty") : false; const bookmarked = bookmarkRef ? enabledValue(row.values?.[bookmarkRef], "bookmarked") : false; const act = (operation: string, event = "actionTrigger") => onAction?.(event, { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="question-command-header"><Flex align="center" justify="space-between" gap={12} wrap><Space><Typography.Title level={4} style={{ margin: 0 }}>{String(row.values?.[titleRef] ?? "未命名问题")}</Typography.Title><Tag color={saved ? "green" : "default"}>{saved ? "已保存" : "临时问题"}</Tag>{dirty && <Badge status="warning" text="有修改" />}</Space><Space><Tooltip title={bookmarked ? "取消收藏" : "收藏"}><Button type="text" icon={bookmarked ? <AntdIcons.StarFilled /> : <AntdIcons.StarOutlined />} onClick={() => act(bookmarked ? "removeBookmark" : "addBookmark")} /></Tooltip><Button onClick={() => act("duplicateQuestion")}>复制</Button><Button type="primary" disabled={!dirty} onClick={() => act("saveQuestion", "editRequest")}>保存</Button></Space></Flex></BlockShell>;
};

const CatalogEntityCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const kindRef = fieldRefOf(block, "kindFieldRef"); const typeRef = fieldRefOf(block, "typeFieldRef"); const starredRef = fieldRefOf(block, "starredFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !kindRef || !row) return <BlockShell block={block} testid="catalog-entity-command-header"><BlockEmpty hint="目录实体页头尚未绑定标题和种类" /></BlockShell>;
  const starred = Boolean(starredRef && enabledValue(row.values?.[starredRef], "starred")); const act = (operation: string) => onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="catalog-entity-command-header"><Flex align="center" justify="space-between" gap={12} wrap><Space><Typography.Title level={4} style={{ margin: 0 }}>{String(row.values?.[titleRef] ?? "未命名实体")}</Typography.Title><Tag>{String(row.values?.[kindRef] ?? "Entity")}</Tag>{typeRef && row.values?.[typeRef] != null ? <Tag color="blue">{String(row.values[typeRef])}</Tag> : null}</Space><Space><Tooltip title={starred ? "取消收藏" : "收藏"}><Button icon={starred ? <AntdIcons.StarFilled /> : <AntdIcons.StarOutlined />} onClick={() => act(starred ? "unstarEntity" : "starEntity")} /></Tooltip><Dropdown menu={{ items: [{ key: "inspect", label: "查看元数据" }, { key: "refresh", label: "刷新目录" }], onClick: ({ key }) => act(key) }}><Button icon={<AntdIcons.MoreOutlined />} /></Dropdown></Space></Flex></BlockShell>;
};

const CollaboratorPresenceStripRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  const { token } = antdTheme.useToken();
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const nameRef = fieldRefOf(block, "nameFieldRef"); const presentRef = fieldRefOf(block, "presentFieldRef"); const editingRef = fieldRefOf(block, "editingFieldRef");
  if (!bound || !nameRef || !presentRef) return <BlockShell block={block} testid="collaborator-presence-strip"><BlockEmpty hint="协作者状态尚未绑定姓名和在线状态" /></BlockShell>;
  const active = bound.rows.filter(row => enabledValue(row.values?.[presentRef], "present"));
  return <BlockShell block={block} testid="collaborator-presence-strip"><Flex align="center" justify="space-between" gap={10} wrap><Space><Avatar.Group max={{ count: 6 }}>{active.slice(0, 6).map(row => <Tooltip key={row.id} title={`${String(row.values?.[nameRef] ?? "协作者")}${editingRef && enabledValue(row.values?.[editingRef], "editing") ? " · 正在编辑" : ""}`}><Badge dot color={editingRef && enabledValue(row.values?.[editingRef], "editing") ? token.colorPrimary : "#52c41a"}><Avatar>{String(row.values?.[nameRef] ?? "?").slice(0, 1)}</Avatar></Badge></Tooltip>)}</Avatar.Group><Typography.Text type="secondary">{active.length ? `${active.length} 人在线` : "暂无在线协作者"}</Typography.Text></Space><Button size="small" disabled={!active.length} onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowIds: active.map(row => row.id), operation: "showCollaborators" })}>查看协作者</Button></Flex></BlockShell>;
};

const QueryRunStatusStripRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const statusRef = fieldRefOf(block, "statusFieldRef"); const timeRef = fieldRefOf(block, "timeFieldRef"); const cachedRef = fieldRefOf(block, "cachedFieldRef"); const row = bound?.rows[0];
  if (!bound || !statusRef || !row) return <BlockShell block={block} testid="query-run-status-strip"><BlockEmpty hint="查询状态尚未绑定运行状态" /></BlockShell>;
  const status = String(row.values?.[statusRef] ?? "idle").toLowerCase(); const running = ["running", "loading", "executing"].includes(status); const failed = ["failed", "error"].includes(status);
  return <BlockShell block={block} testid="query-run-status-strip"><Flex align="center" justify="space-between" gap={10} wrap><Space><Badge status={running ? "processing" : failed ? "error" : "success"} text={running ? "查询运行中" : failed ? "上次查询失败" : "查询已完成"} />{timeRef && <Typography.Text type="secondary">{String(row.values?.[timeRef] ?? "-")} ms</Typography.Text>}{cachedRef && <Tag>{enabledValue(row.values?.[cachedRef], "cached") ? "缓存结果" : "实时结果"}</Tag>}</Space><Button size="small" danger={running} onClick={() => onAction?.("actionTrigger", { operation: running ? "cancelQuery" : "runQuery", targets: targetIdsOf(block) })}>{running ? "取消" : "重新运行"}</Button></Flex></BlockShell>;
};

const EntityOwnershipSummaryRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const ownerRef = fieldRefOf(block, "ownerFieldRef"); const lifecycleRef = fieldRefOf(block, "lifecycleFieldRef"); const systemRef = fieldRefOf(block, "systemFieldRef"); const domainRef = fieldRefOf(block, "domainFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !ownerRef || !row) return <BlockShell block={block} testid="entity-ownership-summary"><BlockEmpty hint="所有权摘要尚未绑定标题和负责人" /></BlockShell>;
  const optional = [["生命周期", lifecycleRef], ["系统", systemRef], ["领域", domainRef]] as const;
  return <BlockShell block={block} title={String(row.values?.[titleRef] ?? "实体归属")} testid="entity-ownership-summary"><Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }} items={[{ key: "owner", label: "负责人", children: String(row.values?.[ownerRef] ?? "-") }, ...optional.flatMap(([label, ref]) => ref ? [{ key: label, label, children: String(row.values?.[ref] ?? "-") }] : [])]} /></BlockShell>;
};

const QueryDataSourceSummaryRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const databaseRef = fieldRefOf(block, "databaseFieldRef"); const schemaRef = fieldRefOf(block, "schemaFieldRef"); const sourceRef = fieldRefOf(block, "sourceFieldRef"); const typeRef = fieldRefOf(block, "typeFieldRef"); const row = bound?.rows[0];
  if (!bound || !databaseRef || !sourceRef || !row) return <BlockShell block={block} testid="query-data-source-summary"><BlockEmpty hint="查询数据源尚未绑定数据库和来源" /></BlockShell>;
  const fields = [databaseRef, schemaRef, sourceRef].filter((ref): ref is string => Boolean(ref));
  return <BlockShell block={block} title={String(block.props?.title ?? "数据来源")} testid="query-data-source-summary"><Flex align="center" justify="space-between" gap={10} wrap><Breadcrumb items={fields.map((ref, index) => ({ title: <Typography.Text strong={index === fields.length - 1}>{String(row.values?.[ref] ?? "-")}</Typography.Text> }))} />{typeRef && <Tag color="blue">{String(row.values?.[typeRef] ?? "数据表")}</Tag>}</Flex></BlockShell>;
};



const QueryClauseFilterBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const fieldRef = fieldRefOf(block, "fieldFieldRef"); const operatorRef = fieldRefOf(block, "operatorFieldRef"); const valueRef = fieldRefOf(block, "valueFieldRef"); const enabledRef = fieldRefOf(block, "enabledFieldRef");
  if (!bound || !fieldRef || !operatorRef || !valueRef) return <BlockShell block={block} testid="query-clause-filter-bar"><BlockEmpty hint="查询条件尚未绑定字段、运算符和值" /></BlockShell>;
  const active = bound.rows.filter(row => !enabledRef || enabledValue(row.values?.[enabledRef], "enabled")); const emit = (operation: string, rowId?: string) => onAction?.("filterChange", { operation, rowId, clauses: active.filter(row => row.id !== rowId).map(row => row.id), targets: targetIdsOf(block), page: 1 });
  return <BlockShell block={block} title={String(block.props?.title ?? "查询条件")} testid="query-clause-filter-bar"><Flex gap={6} wrap>{active.length ? active.map(row => <Tag key={row.id} closable onClose={event => { event.preventDefault(); emit("removeClause", row.id); }}>{String(row.values?.[fieldRef])} {String(row.values?.[operatorRef])} {String(row.values?.[valueRef])}</Tag>) : <Typography.Text type="secondary">没有已生效条件</Typography.Text>}{active.length > 1 && <Button type="link" size="small" onClick={() => emit("clearClauses")}>全部清除</Button>}</Flex></BlockShell>;
};


const MetadataQualityMetricsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const totalRef = fieldRefOf(block, "totalFieldRef"); const documentedRef = fieldRefOf(block, "documentedFieldRef"); const typedRef = fieldRefOf(block, "typedFieldRef"); const row = bound?.rows[0];
  if (!bound || !totalRef || !documentedRef || !row) return <BlockShell block={block} testid="metadata-quality-metrics"><BlockEmpty hint="元数据质量尚未绑定字段总数和已描述数" /></BlockShell>;
  const total = Number(row.values?.[totalRef] ?? 0); const documented = Number(row.values?.[documentedRef] ?? 0); const typed = typedRef ? Number(row.values?.[typedRef] ?? 0) : 0; const score = total ? Math.round((documented + typed) / (total * (typedRef ? 2 : 1)) * 100) : 0;
  return <BlockShell block={block} title={String(block.props?.title ?? "元数据质量")} testid="metadata-quality-metrics"><Flex align="center" gap={22} wrap><Progress type="circle" size={72} percent={score} /><Statistic title="已描述字段" value={documented} suffix={`/ ${total}`} />{typedRef && <Statistic title="已设置语义类型" value={typed} suffix={`/ ${total}`} />}</Flex></BlockShell>;
};

const QuestionExecutionBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const statusRef = fieldRefOf(block, "statusFieldRef"); const runnableRef = fieldRefOf(block, "runnableFieldRef"); const dirtyRef = fieldRefOf(block, "dirtyFieldRef"); const row = bound?.rows[0];
  if (!bound || !statusRef || !row) return <BlockShell block={block} testid="question-execution-bar"><BlockEmpty hint="查询执行栏尚未绑定运行状态" /></BlockShell>;
  const status = String(row.values?.[statusRef] ?? "idle").toLowerCase(); const running = ["running", "loading", "executing"].includes(status); const runnable = !runnableRef || enabledValue(row.values?.[runnableRef], "runnable"); const dirty = Boolean(dirtyRef && enabledValue(row.values?.[dirtyRef], "dirty")); const act = (operation: string, event = "actionTrigger") => onAction?.(event, { operation, entityRef: bound.entityRef, rowId: row.id, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="question-execution-bar"><Flex align="center" justify="space-between" gap={12} wrap><Typography.Text type={dirty ? "warning" : "secondary"}>{running ? "正在执行查询" : dirty ? "查询有未保存修改" : "查询已就绪"}</Typography.Text><Space><Button disabled={!dirty} onClick={() => act("saveQuestion", "editRequest")}>保存</Button><Button type="primary" danger={running} disabled={!running && !runnable} onClick={() => act(running ? "cancelQuery" : "runQuery")}>{running ? "取消查询" : "运行查询"}</Button></Space></Flex></BlockShell>;
};


const CycleCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const editableRef = fieldRefOf(block, "editableFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !statusRef || !row) return <BlockShell block={block} testid="cycle-command-header"><BlockEmpty hint="周期页头尚未绑定标题和状态" /></BlockShell>;
  const status = String(row.values?.[statusRef] ?? "draft").toLowerCase(); const archived = ["archived", "completed"].includes(status); const editable = !editableRef || enabledValue(row.values?.[editableRef], "editable"); const act = (operation: string, event = "actionTrigger") => onAction?.(event, { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="cycle-command-header"><Flex align="center" justify="space-between" gap={12} wrap><Space><Typography.Title level={4} style={{ margin: 0 }}>{String(row.values?.[titleRef] ?? "未命名周期")}</Typography.Title><Tag color={archived ? "default" : "blue"}>{status}</Tag></Space><Space><Button disabled={!editable || archived} onClick={() => act("editCycle", "editRequest")}>编辑</Button><Button onClick={() => act("copyCycleLink")}>复制链接</Button><Popconfirm title={archived ? "确认恢复这个周期？" : "确认归档这个周期？"} onConfirm={() => act(archived ? "restoreCycle" : "archiveCycle", "submitRequest")}><Button disabled={!editable}>{archived ? "恢复" : "归档"}</Button></Popconfirm></Space></Flex></BlockShell>;
};

const AlertGroupCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const editableRef = fieldRefOf(block, "editableFieldRef"); const intervalRef = fieldRefOf(block, "intervalFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !statusRef || !row) return <BlockShell block={block} testid="alert-group-command-header"><BlockEmpty hint="规则组页头尚未绑定标题和状态" /></BlockShell>;
  const editable = !editableRef || enabledValue(row.values?.[editableRef], "editable"); const paused = ["paused", "disabled"].includes(String(row.values?.[statusRef] ?? "active").toLowerCase()); const act = (operation: string, event = "actionTrigger") => onAction?.(event, { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="alert-group-command-header"><Flex align="center" justify="space-between" gap={12} wrap><Space><Typography.Title level={4} style={{ margin: 0 }}>{String(row.values?.[titleRef] ?? "未命名规则组")}</Typography.Title><Badge status={paused ? "default" : "processing"} text={paused ? "已暂停" : "评估中"} />{intervalRef && <Tag>{String(row.values?.[intervalRef] ?? "-")}</Tag>}</Space><Space><Button disabled={!editable} onClick={() => act("editAlertGroup", "editRequest")}>编辑</Button><Button disabled={!editable} onClick={() => act(paused ? "resumeAlertGroup" : "pauseAlertGroup", "submitRequest")}>{paused ? "恢复评估" : "暂停评估"}</Button></Space></Flex></BlockShell>;
};

const IncidentOwnershipStripRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const assigneeRef = fieldRefOf(block, "assigneeFieldRef"); const sourceRef = fieldRefOf(block, "sourceFieldRef"); const suggestedRef = fieldRefOf(block, "suggestedFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !assigneeRef || !row) return <BlockShell block={block} testid="incident-ownership-strip"><BlockEmpty hint="事故归属尚未绑定负责人" /></BlockShell>;
  const assignee = String(row.values?.[assigneeRef] ?? "").trim(); const suggested = suggestedRef ? String(row.values?.[suggestedRef] ?? "").trim() : "";
  return <BlockShell block={block} testid="incident-ownership-strip"><Flex align="center" justify="space-between" gap={10} wrap><Space><Avatar>{(assignee || "?").slice(0, 1)}</Avatar><div><Typography.Text strong>{assignee || "未分配"}</Typography.Text><Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>{sourceRef ? `来源：${String(row.values?.[sourceRef] ?? "手动")}` : "手动分配"}{suggested ? ` · 建议 ${suggested}` : ""}</Typography.Text></div></Space><Space><Button size="small" onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "changeAssignee", targets: targetIdsOf(block) })}>更换负责人</Button>{!assignee && suggested && <Button size="small" type="primary" onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "acceptSuggestedOwner", value: suggested })}>采用建议</Button>}</Space></Flex></BlockShell>;
};

const SyncScheduleStripRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const frequencyRef = fieldRefOf(block, "frequencyFieldRef"); const nextRef = fieldRefOf(block, "nextRunFieldRef"); const timezoneRef = fieldRefOf(block, "timezoneFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const row = bound?.rows[0];
  if (!bound || !frequencyRef || !nextRef || !row) return <BlockShell block={block} testid="sync-schedule-strip"><BlockEmpty hint="同步计划尚未绑定频率和下次运行时间" /></BlockShell>;
  const paused = statusRef && ["paused", "disabled"].includes(String(row.values?.[statusRef] ?? "").toLowerCase());
  return <BlockShell block={block} testid="sync-schedule-strip"><Flex align="center" justify="space-between" gap={10} wrap><Space><Badge status={paused ? "default" : "processing"} /><div><Typography.Text strong>{paused ? "同步计划已暂停" : `每 ${String(row.values?.[frequencyRef] ?? "-")}`}</Typography.Text><Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>下次运行 {String(row.values?.[nextRef] ?? "-")}{timezoneRef ? ` · ${String(row.values?.[timezoneRef] ?? "")}` : ""}</Typography.Text></div></Space><Button size="small" onClick={() => onAction?.("editRequest", { operation: "editSyncSchedule", entityRef: bound.entityRef, rowId: row.id, targets: targetIdsOf(block) })}>调整计划</Button></Flex></BlockShell>;
};


const CycleFilterBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  const [selected, setSelected] = React.useState<Record<string, string[]>>({}); if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const typeRef = fieldRefOf(block, "typeFieldRef"); const keyRef = fieldRefOf(block, "keyFieldRef"); const titleRef = fieldRefOf(block, "titleFieldRef");
  if (!bound || !typeRef || !keyRef || !titleRef) return <BlockShell block={block} testid="cycle-filter-bar"><BlockEmpty hint="周期筛选尚未绑定类型、键和值" /></BlockShell>;
  const groups = Array.from(new Set(bound.rows.map(row => String(row.values?.[typeRef] ?? "")).filter(Boolean))); const emit = (next: Record<string, string[]>) => onAction?.("filterChange", { facets: next, targets: targetIdsOf(block), page: 1 });
  return <BlockShell block={block} title={String(block.props?.title ?? "周期筛选")} testid="cycle-filter-bar"><Flex gap={10} wrap>{groups.map(group => <Select key={group} mode="multiple" allowClear placeholder={group} style={{ minWidth: 150 }} value={selected[group] ?? []} options={bound.rows.filter(row => String(row.values?.[typeRef]) === group).map(row => ({ value: String(row.values?.[keyRef]), label: String(row.values?.[titleRef]) }))} onChange={values => { const next = { ...selected, [group]: values }; setSelected(next); emit(next); }} />)}<Button disabled={!Object.values(selected).some(values => values.length)} onClick={() => { setSelected({}); emit({}); }}>清除</Button></Flex></BlockShell>;
};

const AlertRuleFilterBarRenderer: ExperienceBlockRenderer = ({ block, children, onAction }) => {
  const [query, setQuery] = React.useState(String(block.props?.defaultQuery ?? "")); const [view, setView] = React.useState<string | number>(String(block.props?.defaultView ?? "grouped")); if (children != null) return <>{children}</>;
  const submit = (value: string) => onAction?.("filterChange", { query: value.trim(), view, targets: targetIdsOf(block), page: 1 });
  return <BlockShell block={block} title={String(block.props?.title ?? "规则筛选")} testid="alert-rule-filter-bar"><Flex gap={10} wrap><Input.Search value={query} onChange={event => setQuery(event.target.value)} onSearch={submit} onBlur={() => submit(query)} placeholder='例如 state:firing label:team=payment' style={{ minWidth: 260, flex: 1 }} /><Segmented value={view} options={[{ label: "分组", value: "grouped" }, { label: "列表", value: "list" }]} onChange={value => { setView(value); onAction?.("filterChange", { query: query.trim(), view: value, targets: targetIdsOf(block), page: 1 }); }} /></Flex></BlockShell>;
};

const SyncReliabilityMetricsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const successRef = fieldRefOf(block, "successFieldRef"); const failedRef = fieldRefOf(block, "failedFieldRef"); const recordsRef = fieldRefOf(block, "recordsFieldRef"); const freshnessRef = fieldRefOf(block, "freshnessFieldRef"); const row = bound?.rows[0];
  if (!bound || !successRef || !failedRef || !row) return <BlockShell block={block} testid="sync-reliability-metrics"><BlockEmpty hint="同步可靠性尚未绑定成功和失败次数" /></BlockShell>;
  const success = Number(row.values?.[successRef] ?? 0); const failed = Number(row.values?.[failedRef] ?? 0); const rate = success + failed ? Math.round(success / (success + failed) * 100) : 0;
  return <BlockShell block={block} title={String(block.props?.title ?? "同步可靠性")} testid="sync-reliability-metrics"><Flex gap={22} wrap><Statistic title="成功率" value={rate} suffix="%" /><Statistic title="成功运行" value={success} /><Statistic title="失败运行" value={failed} />{recordsRef && <Statistic title="同步记录" value={Number(row.values?.[recordsRef] ?? 0)} />}{freshnessRef && <Statistic title="数据新鲜度" value={String(row.values?.[freshnessRef] ?? "-")} />}</Flex></BlockShell>;
};

const RuleEvaluationMetricsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const activeRef = fieldRefOf(block, "activeFieldRef"); const pausedRef = fieldRefOf(block, "pausedFieldRef"); const errorRef = fieldRefOf(block, "errorFieldRef"); const durationRef = fieldRefOf(block, "durationFieldRef"); const row = bound?.rows[0];
  if (!bound || !activeRef || !pausedRef || !row) return <BlockShell block={block} testid="rule-evaluation-metrics"><BlockEmpty hint="规则评估尚未绑定活跃和暂停数量" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "规则评估")} testid="rule-evaluation-metrics"><Flex gap={22} wrap><Statistic title="活跃规则" value={Number(row.values?.[activeRef] ?? 0)} /><Statistic title="暂停规则" value={Number(row.values?.[pausedRef] ?? 0)} />{errorRef && <Statistic title="评估错误" value={Number(row.values?.[errorRef] ?? 0)} />}{durationRef && <Statistic title="平均评估耗时" value={Number(row.values?.[durationRef] ?? 0)} suffix="ms" />}</Flex></BlockShell>;
};


const EventTypePublishBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const hiddenRef = fieldRefOf(block, "hiddenFieldRef"); const dirtyRef = fieldRefOf(block, "dirtyFieldRef"); const validRef = fieldRefOf(block, "validFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !hiddenRef || !row) return <BlockShell block={block} testid="event-type-publish-bar"><BlockEmpty hint="事件类型发布栏尚未绑定标题和可见状态" /></BlockShell>;
  const hidden = enabledValue(row.values?.[hiddenRef], "hidden"); const dirty = !dirtyRef || enabledValue(row.values?.[dirtyRef], "dirty"); const valid = !validRef || enabledValue(row.values?.[validRef], "valid"); const act = (operation: string, event = "submitRequest") => onAction?.(event, { operation, entityRef: bound.entityRef, rowId: row.id, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="event-type-publish-bar"><Flex align="center" justify="space-between" gap={12} wrap><div><Typography.Text strong>{String(row.values?.[titleRef] ?? "事件类型")}</Typography.Text><Typography.Text type={valid ? "secondary" : "danger"} style={{ display: "block", fontSize: 12 }}>{hidden ? "未在公开资料中显示" : "公开可预约"}{valid ? "" : " · 配置未通过校验"}</Typography.Text></div><Space><Button disabled={!dirty || !valid} onClick={() => act("saveEventType", "editRequest")}>保存</Button><Button type="primary" disabled={!valid} onClick={() => act(hidden ? "publishEventType" : "hideEventType")}>{hidden ? "发布" : "隐藏"}</Button></Space></Flex></BlockShell>;
};

const ConversationCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const titleRef = fieldRefOf(block, "titleFieldRef"); const statusRef = fieldRefOf(block, "statusFieldRef"); const verifiedRef = fieldRefOf(block, "verifiedFieldRef"); const inboxRef = fieldRefOf(block, "inboxFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !titleRef || !statusRef || !row) return <BlockShell block={block} testid="conversation-command-header"><BlockEmpty hint="会话页头尚未绑定联系人和状态" /></BlockShell>;
  const status = String(row.values?.[statusRef] ?? "open").toLowerCase(); const snoozed = status === "snoozed"; const resolved = ["resolved", "closed"].includes(status); const verified = !verifiedRef || enabledValue(row.values?.[verifiedRef], "verified"); const act = (operation: string, event = "actionTrigger") => onAction?.(event, { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="conversation-command-header"><Flex align="center" justify="space-between" gap={12} wrap><Space><Avatar>{String(row.values?.[titleRef] ?? "?").slice(0, 1)}</Avatar><div><Typography.Title level={4} style={{ margin: 0 }}>{String(row.values?.[titleRef] ?? "未知联系人")}</Typography.Title><Typography.Text type="secondary" style={{ fontSize: 12 }}>{inboxRef ? `${String(row.values?.[inboxRef] ?? "收件箱")} · ` : ""}#{row.id}</Typography.Text></div>{!verified && <Tag color="warning">未验证</Tag>}<Tag color={resolved ? "default" : snoozed ? "orange" : "blue"}>{status}</Tag></Space><Space><Button onClick={() => act("copyConversationId")}>复制编号</Button><Button type="primary" onClick={() => act(resolved ? "reopenConversation" : "resolveConversation", "submitRequest")}>{resolved ? "重新打开" : "解决"}</Button></Space></Flex></BlockShell>;
};

const UserCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const usernameRef = fieldRefOf(block, "usernameFieldRef"); const enabledRef = fieldRefOf(block, "enabledFieldRef"); const impersonateRef = fieldRefOf(block, "impersonateFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !usernameRef || !enabledRef || !row) return <BlockShell block={block} testid="user-command-header"><BlockEmpty hint="用户页头尚未绑定用户名和启用状态" /></BlockShell>;
  const enabled = enabledValue(row.values?.[enabledRef], "enabled"); const canImpersonate = Boolean(impersonateRef && enabledValue(row.values?.[impersonateRef], "allowed")); const submit = (operation: string) => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="user-command-header"><Flex align="center" justify="space-between" gap={12} wrap><Space><Typography.Title level={4} style={{ margin: 0 }}>{String(row.values?.[usernameRef] ?? "未命名用户")}</Typography.Title><Badge status={enabled ? "success" : "default"} text={enabled ? "已启用" : "已禁用"} /></Space><Space><Button disabled={!canImpersonate} onClick={() => onAction?.("actionTrigger", { entityRef: bound.entityRef, rowId: row.id, operation: "impersonateUser" })}>模拟登录</Button><Popconfirm title={`确认${enabled ? "禁用" : "启用"}这个用户？`} onConfirm={() => submit(enabled ? "disableUser" : "enableUser")}><Button>{enabled ? "禁用" : "启用"}</Button></Popconfirm></Space></Flex></BlockShell>;
};

const ConversationAssignmentStripRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const assigneeRef = fieldRefOf(block, "assigneeFieldRef"); const teamRef = fieldRefOf(block, "teamFieldRef"); const priorityRef = fieldRefOf(block, "priorityFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !assigneeRef || !row) return <BlockShell block={block} testid="conversation-assignment-strip"><BlockEmpty hint="会话分配尚未绑定处理人" /></BlockShell>;
  return <BlockShell block={block} testid="conversation-assignment-strip"><Flex align="center" justify="space-between" gap={10} wrap><Space><Avatar>{String(row.values?.[assigneeRef] ?? "?").slice(0, 1)}</Avatar><div><Typography.Text strong>{String(row.values?.[assigneeRef] ?? "未分配")}</Typography.Text><Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>{teamRef ? String(row.values?.[teamRef] ?? "未分组") : ""}{priorityRef ? ` · ${String(row.values?.[priorityRef] ?? "普通")}` : ""}</Typography.Text></div></Space><Space><Button size="small" onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "assignConversation", targets: targetIdsOf(block) })}>更换处理人</Button><Button size="small" onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "assignToMe" })}>分配给我</Button></Space></Flex></BlockShell>;
};

const RealmStatusStripRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const nameRef = fieldRefOf(block, "nameFieldRef"); const enabledRef = fieldRefOf(block, "enabledFieldRef"); const bruteRef = fieldRefOf(block, "bruteForceFieldRef"); const sslRef = fieldRefOf(block, "sslFieldRef"); const row = bound?.rows[0];
  if (!bound || !nameRef || !enabledRef || !row) return <BlockShell block={block} testid="realm-status-strip"><BlockEmpty hint="Realm 状态尚未绑定名称和启用状态" /></BlockShell>;
  const enabled = enabledValue(row.values?.[enabledRef], "enabled");
  return <BlockShell block={block} testid="realm-status-strip"><Flex align="center" justify="space-between" gap={10} wrap><Space><Badge status={enabled ? "success" : "default"} /><div><Typography.Text strong>{String(row.values?.[nameRef] ?? "Realm")}</Typography.Text><Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>{bruteRef ? `暴力破解防护 ${enabledValue(row.values?.[bruteRef], "enabled") ? "开启" : "关闭"}` : ""}{sslRef ? ` · SSL ${String(row.values?.[sslRef] ?? "-")}` : ""}</Typography.Text></div></Space><Button size="small" onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "editRealmSettings", targets: targetIdsOf(block) })}>Realm 设置</Button></Flex></BlockShell>;
};



const UserDirectoryFilterRenderer: ExperienceBlockRenderer = ({ block, children, onAction }) => {
  const [query, setQuery] = React.useState(String(block.props?.defaultQuery ?? "")); const [mode, setMode] = React.useState<string | number>(String(block.props?.defaultMode ?? "default")); if (children != null) return <>{children}</>;
  const submit = (value: string, nextMode = mode) => onAction?.("filterChange", { query: value.trim(), mode: nextMode, exact: Boolean(block.props?.exact), targets: targetIdsOf(block), page: 1 });
  return <BlockShell block={block} title={String(block.props?.title ?? "用户目录筛选")} testid="user-directory-filter"><Flex gap={10} wrap><Segmented value={mode} options={[{ label: "用户名", value: "default" }, { label: "属性", value: "attribute" }]} onChange={value => { setMode(value); setQuery(""); submit("", value); }} /><Input.Search value={query} onChange={event => setQuery(event.target.value)} onSearch={value => submit(value)} placeholder={mode === "attribute" ? "例如 department:finance" : "用户名或邮箱"} style={{ minWidth: 240, flex: 1 }} /><Button onClick={() => { setQuery(""); submit(""); }}>清除</Button></Flex></BlockShell>;
};

const ConversationSlaMetricsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const firstRef = fieldRefOf(block, "firstResponseFieldRef"); const resolutionRef = fieldRefOf(block, "resolutionFieldRef"); const breachRef = fieldRefOf(block, "breachFieldRef"); const countRef = fieldRefOf(block, "countFieldRef"); const row = bound?.rows[0];
  if (!bound || !firstRef || !resolutionRef || !row) return <BlockShell block={block} testid="conversation-sla-metrics"><BlockEmpty hint="SLA 指标尚未绑定首次响应和解决时间" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "会话 SLA")} testid="conversation-sla-metrics"><Flex gap={22} wrap><Statistic title="首次响应" value={String(row.values?.[firstRef] ?? "-")} /><Statistic title="解决时间" value={String(row.values?.[resolutionRef] ?? "-")} />{breachRef && <Statistic title="SLA 违约" value={Number(row.values?.[breachRef] ?? 0)} />}{countRef && <Statistic title="会话总数" value={Number(row.values?.[countRef] ?? 0)} />}</Flex></BlockShell>;
};


const ConversationReplyBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  const [message, setMessage] = React.useState(""); const [mode, setMode] = React.useState<string | number>("reply"); if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const statusRef = fieldRefOf(block, "statusFieldRef"); const channelRef = fieldRefOf(block, "channelFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !statusRef || !row) return <BlockShell block={block} testid="conversation-reply-bar"><BlockEmpty hint="回复栏尚未绑定会话状态" /></BlockShell>;
  const closed = ["resolved", "closed"].includes(String(row.values?.[statusRef] ?? "open").toLowerCase()); const submit = () => { const text = message.trim(); if (!text || closed) return; onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: mode === "note" ? "addPrivateNote" : "sendReply", message: text, channel: channelRef ? row.values?.[channelRef] : undefined, targets: targetIdsOf(block) }); setMessage(""); };
  return <BlockShell block={block} testid="conversation-reply-bar"><Flex gap={8} vertical><Flex gap={8} wrap><Segmented value={mode} options={[{ label: "回复", value: "reply" }, { label: "内部备注", value: "note" }]} onChange={setMode} /><Typography.Text type="secondary">{channelRef ? String(row.values?.[channelRef] ?? "") : ""}{closed ? " · 会话已关闭" : ""}</Typography.Text></Flex><Input.TextArea value={message} onChange={event => setMessage(event.target.value)} disabled={closed} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={mode === "note" ? "仅团队成员可见" : "输入回复内容"} maxLength={5000} showCount /><Flex justify="flex-end"><Button type="primary" disabled={closed || !message.trim()} onClick={submit}>{mode === "note" ? "添加备注" : "发送回复"}</Button></Flex></Flex></BlockShell>;
};

const UserAccessBarRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows); const usernameRef = fieldRefOf(block, "usernameFieldRef"); const enabledRef = fieldRefOf(block, "enabledFieldRef"); const sessionsRef = fieldRefOf(block, "sessionsFieldRef"); const manageableRef = fieldRefOf(block, "manageableFieldRef"); const row = bound?.rows.find(item => item.id === focus?.[bound.entityRef]) ?? bound?.rows[0];
  if (!bound || !usernameRef || !enabledRef || !row) return <BlockShell block={block} testid="user-access-bar"><BlockEmpty hint="用户访问栏尚未绑定用户名和启用状态" /></BlockShell>;
  const enabled = enabledValue(row.values?.[enabledRef], "enabled"); const sessions = sessionsRef ? Number(row.values?.[sessionsRef] ?? 0) : 0; const manageable = !manageableRef || enabledValue(row.values?.[manageableRef], "allowed"); const submit = (operation: string) => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation, targets: targetIdsOf(block) });
  return <BlockShell block={block} testid="user-access-bar"><Flex align="center" justify="space-between" gap={12} wrap><Typography.Text strong>{String(row.values?.[usernameRef] ?? "用户")} · {sessions} 个会话</Typography.Text><Space><Button disabled={!manageable} onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "resetCredentials", targets: targetIdsOf(block) })}>重置凭据</Button><Popconfirm title="确认注销该用户的全部会话？" onConfirm={() => submit("logoutAllSessions")}><Button disabled={!manageable || !sessions}>注销全部会话</Button></Popconfirm><Button danger={enabled} disabled={!manageable} onClick={() => submit(enabled ? "disableUser" : "enableUser")}>{enabled ? "禁用用户" : "启用用户"}</Button></Space></Flex></BlockShell>;
};


const ConnectionFleetMetricsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  const { token } = antdTheme.useToken();
  if (children != null) return <>{children}</>;
  const bound=rowsOfBinding(block,entityRows),status=fieldRefOf(block,"statusFieldRef"); if(!bound||!status)return <BlockShell block={block} title={String(block.props?.title??"连接状态")} testid="connection-fleet-metrics"><BlockEmpty hint="连接指标尚未绑定状态字段" /></BlockShell>; const states=[{key:"healthy",label:"健康",color:"#389e0d"},{key:"failed",label:"失败",color:"#cf1322"},{key:"running",label:"运行中",color:token.colorPrimary},{key:"queued",label:"排队",color:"#d48806"},{key:"paused",label:"暂停",color:"#8c8c8c"},{key:"notSynced",label:"未同步",color:"#722ed1"}];
  return <BlockShell block={block} title={String(block.props?.title??"连接状态")} testid="connection-fleet-metrics"><Flex gap={18} wrap>{states.map(item=><Button type="text" key={item.key} onClick={()=>onAction?.("filterChange",{status:item.key,targets:targetIdsOf(block),page:1})}><Statistic title={item.label} value={bound.rows.filter(r=>String(r.values?.[status])===item.key).length} valueStyle={{fontSize:22,color:item.color}} /></Button>)}</Flex></BlockShell>;
};
const IssueImpactMetricsRenderer: ExperienceBlockRenderer = ({ block, children, entityRows }) => {
  if(children!=null)return <>{children}</>; const bound=rowsOfBinding(block,entityRows),events=fieldRefOf(block,"eventCountFieldRef"),users=fieldRefOf(block,"userCountFieldRef"),first=fieldRefOf(block,"firstSeenFieldRef"),last=fieldRefOf(block,"lastSeenFieldRef"),row=bound?.rows[0]; if(!bound||!events||!users||!row)return <BlockShell block={block} title={String(block.props?.title??"问题影响")} testid="issue-impact-metrics"><BlockEmpty hint="问题影响尚未绑定事件和用户数" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title??"问题影响")} testid="issue-impact-metrics"><Flex gap={22} wrap><Statistic title="事件" value={Number(row.values?.[events]??0)}/><Statistic title="受影响用户" value={Number(row.values?.[users]??0)}/>{first&&<Statistic title="首次发生" value={String(row.values?.[first]??"-")}/>} {last&&<Statistic title="最近发生" value={String(row.values?.[last]??"-")}/>}</Flex></BlockShell>;
};
const ReleaseHealthStripRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if(children!=null)return <>{children}</>; const bound=rowsOfBinding(block,entityRows),version=fieldRefOf(block,"versionFieldRef"),health=fieldRefOf(block,"healthFieldRef"),env=fieldRefOf(block,"environmentFieldRef"),adoption=fieldRefOf(block,"adoptionFieldRef"),row=bound?.rows[0]; if(!bound||!version||!health||!row)return <BlockShell block={block} testid="release-health-strip"><BlockEmpty hint="发布健康尚未绑定版本和健康率" /></BlockShell>; const rate=Number(row.values?.[health]??0);
  return <BlockShell block={block} testid="release-health-strip"><Flex align="center" justify="space-between" gap={12} wrap><Space><Badge status={rate>=99?"success":rate>=95?"warning":"error"}/><div><Typography.Text strong>{String(row.values?.[version]??"未命名版本")}</Typography.Text><Typography.Text type="secondary" style={{display:"block",fontSize:12}}>{env?String(row.values?.[env]??"全部环境"):"全部环境"}</Typography.Text></div></Space><Space><Statistic title="无崩溃" value={rate} suffix="%" valueStyle={{fontSize:18}}/>{adoption&&<Statistic title="采用率" value={Number(row.values?.[adoption]??0)} suffix="%" valueStyle={{fontSize:18}}/>}<Button size="small" onClick={()=>onAction?.("itemSelect",{entityRef:bound.entityRef,rowId:row.id})}>详情</Button></Space></Flex></BlockShell>;
};
const DashboardCommandHeaderRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, focus, onAction }) => {
  if(children!=null)return <>{children}</>; const bound=rowsOfBinding(block,entityRows),title=fieldRefOf(block,"titleFieldRef"),starredRef=fieldRefOf(block,"starredFieldRef"),subscribedRef=fieldRefOf(block,"subscribedFieldRef"),editableRef=fieldRefOf(block,"editableFieldRef"),row=bound?.rows.find(r=>r.id===focus?.[bound.entityRef])??bound?.rows[0]; if(!bound||!title||!row)return <BlockShell block={block} testid="dashboard-command-header"><BlockEmpty hint="Dashboard 页头尚未绑定标题" /></BlockShell>; const starred=Boolean(starredRef&&enabledValue(row.values?.[starredRef],"starred")),subscribed=Boolean(subscribedRef&&enabledValue(row.values?.[subscribedRef],"subscribed")),editable=!editableRef||enabledValue(row.values?.[editableRef],"editable"),act=(operation:string,event="actionTrigger")=>onAction?.(event,{entityRef:bound.entityRef,rowId:row.id,operation,targets:targetIdsOf(block)});
  return <BlockShell block={block} testid="dashboard-command-header"><Flex align="center" justify="space-between" gap={12} wrap><Typography.Title level={4} style={{margin:0}}>{String(row.values?.[title]??"未命名 Dashboard")}</Typography.Title><Space><Tooltip title={starred?"取消收藏":"收藏"}><Button icon={starred?<AntdIcons.StarFilled/>:<AntdIcons.StarOutlined/>} onClick={()=>act(starred?"unstarDashboard":"starDashboard")}/></Tooltip><Button onClick={()=>act(subscribed?"unsubscribeDashboard":"subscribeDashboard")}>{subscribed?"取消订阅":"订阅"}</Button><Button icon={<AntdIcons.ReloadOutlined/>} onClick={()=>act("refreshDashboard")}>刷新</Button><Button type="primary" disabled={!editable} onClick={()=>act("editDashboard","editRequest")}>编辑</Button></Space></Flex></BlockShell>;
};

const nullableNumber=(input:unknown)=>input==null||input===""||!Number.isFinite(Number(input))?null:Number(input);
const DeploymentLatencyChartRenderer: ExperienceBlockRenderer = ({block,children,entityRows,chartPalette})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),time=fieldRefOf(block,"timeFieldRef"),queue=fieldRefOf(block,"queueFieldRef"),pull=fieldRefOf(block,"pullFieldRef"),start=fieldRefOf(block,"startFieldRef"),ready=fieldRefOf(block,"readyFieldRef");if(!bound||!time||!queue||!ready)return <AnalysisChart block={block} title={String(block.props?.title??"部署阶段耗时")} testid="deployment-latency-chart" hint="部署耗时尚未绑定时间、排队和就绪字段"/>;const rows=[...bound.rows].sort((a,b)=>String(a.values?.[time]).localeCompare(String(b.values?.[time]))),defs:Array<[string,string|undefined,string]>=[["排队",queue,"#8c8c8c"],["拉取镜像",pull,chartPalette?.primary??"#1677ff"],["启动",start,"#722ed1"],["就绪",ready,"#52c41a"]],series=defs.flatMap(([name,ref,color])=>ref?[{name,type:"line",connectNulls:false,data:rows.map(r=>nullableNumber(r.values?.[ref])),itemStyle:{color}}]:[]);return <AnalysisChart block={block} title={String(block.props?.title??"部署阶段耗时")} testid="deployment-latency-chart" option={rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},legend:{bottom:0},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time]))},yAxis:{type:"value",name:"秒"},series}:undefined} hint="当前没有部署阶段数据"/>};
const ReleaseAdoptionTrendChartRenderer: ExperienceBlockRenderer = ({block,children,entityRows})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),time=fieldRefOf(block,"timeFieldRef"),adoption=fieldRefOf(block,"adoptionFieldRef"),health=fieldRefOf(block,"healthFieldRef");if(!bound||!time||!adoption||!health)return <AnalysisChart block={block} title={String(block.props?.title??"发布采用趋势")} testid="release-adoption-trend-chart" hint="发布趋势尚未绑定时间、采用率和健康率"/>;const rows=[...bound.rows].sort((a,b)=>String(a.values?.[time]).localeCompare(String(b.values?.[time])));return <AnalysisChart block={block} title={String(block.props?.title??"发布采用趋势")} testid="release-adoption-trend-chart" option={rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},legend:{bottom:0},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time]))},yAxis:{type:"value",min:0,max:100,axisLabel:{formatter:"{value}%"}},series:[{name:"采用率",type:"line",areaStyle:{opacity:.08},connectNulls:false,data:rows.map(r=>nullableNumber(r.values?.[adoption]))},{name:"无崩溃率",type:"line",connectNulls:false,data:rows.map(r=>nullableNumber(r.values?.[health]))}]}:undefined} hint="当前没有发布趋势"/>};

const facetFilterRenderer=(testid:string,fallback:string):ExperienceBlockRenderer=>({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),facet=fieldRefOf(block,"facetFieldRef"),key=fieldRefOf(block,"keyFieldRef"),title=fieldRefOf(block,"titleFieldRef"),[selected,setSelected]=React.useState<Record<string,string[]>>({});if(!bound||!facet||!key||!title)return <BlockShell block={block} title={fallback} testid={testid}><BlockEmpty hint={`${fallback}尚未绑定分面、键和标题`}/></BlockShell>;const groups=Array.from(new Set(bound.rows.map(r=>String(r.values?.[facet]??"")).filter(Boolean))),change=(group:string,values:string[])=>{const next={...selected,[group]:values};setSelected(next);onAction?.("filterChange",{facets:next,targets:targetIdsOf(block),page:1})};return <BlockShell block={block} title={String(block.props?.title??fallback)} testid={testid}><Flex gap={8} wrap>{groups.map(group=><Select key={group} mode="multiple" allowClear placeholder={group} style={{minWidth:150}} value={selected[group]??[]} options={bound.rows.filter(r=>String(r.values?.[facet])===group).map(r=>({value:String(r.values?.[key]),label:String(r.values?.[title])}))} onChange={values=>change(group,values.map(String))}/>) }<Button disabled={!Object.values(selected).some(v=>v.length)} onClick={()=>{setSelected({});onAction?.("filterChange",{facets:{},targets:targetIdsOf(block),page:1})}}>清除</Button></Flex></BlockShell>};

const DeploymentRolloutMetricsRenderer:ExperienceBlockRenderer=({block,children,entityRows})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),desired=fieldRefOf(block,"desiredFieldRef"),ready=fieldRefOf(block,"readyFieldRef"),available=fieldRefOf(block,"availableFieldRef"),unavailable=fieldRefOf(block,"unavailableFieldRef"),row=bound?.rows[0];if(!bound||!desired||!ready||!row)return <BlockShell block={block} title={String(block.props?.title??"部署滚动状态")} testid="deployment-rollout-metrics"><BlockEmpty hint="部署指标尚未绑定期望和就绪副本"/></BlockShell>;const d=Number(row.values?.[desired]??0),r=Number(row.values?.[ready]??0);return <BlockShell block={block} title={String(block.props?.title??"部署滚动状态")} testid="deployment-rollout-metrics"><Flex gap={22} wrap><Statistic title="期望副本" value={d}/><Statistic title="就绪副本" value={r}/>{available&&<Statistic title="可用副本" value={Number(row.values?.[available]??0)}/>} {unavailable&&<Statistic title="不可用" value={Number(row.values?.[unavailable]??0)} valueStyle={{color:Number(row.values?.[unavailable]??0)>0?"#cf1322":undefined}}/>}</Flex><Progress percent={d>0?Math.min(100,Math.round(r/d*100)):0} showInfo={false} size="small"/></BlockShell>};
const ReleaseAdoptionMetricsRenderer:ExperienceBlockRenderer=({block,children,entityRows})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),adoption=fieldRefOf(block,"adoptionFieldRef"),health=fieldRefOf(block,"healthFieldRef"),events=fieldRefOf(block,"eventCountFieldRef"),users=fieldRefOf(block,"userCountFieldRef"),row=bound?.rows[0];if(!bound||!adoption||!health||!row)return <BlockShell block={block} title={String(block.props?.title??"发布采用")} testid="release-adoption-metrics"><BlockEmpty hint="发布指标尚未绑定采用率和健康率"/></BlockShell>;return <BlockShell block={block} title={String(block.props?.title??"发布采用")} testid="release-adoption-metrics"><Flex gap={22} wrap><Statistic title="采用率" value={Number(row.values?.[adoption]??0)} suffix="%"/><Statistic title="无崩溃率" value={Number(row.values?.[health]??0)} suffix="%"/>{events&&<Statistic title="事件" value={Number(row.values?.[events]??0)}/>} {users&&<Statistic title="用户" value={Number(row.values?.[users]??0)}/>}</Flex></BlockShell>};

const ClusterHealthStripRenderer:ExperienceBlockRenderer=({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),name=fieldRefOf(block,"nameFieldRef"),status=fieldRefOf(block,"statusFieldRef"),nodes=fieldRefOf(block,"nodeCountFieldRef"),version=fieldRefOf(block,"versionFieldRef");if(!bound||!name||!status)return <BlockShell block={block} testid="cluster-health-strip"><BlockEmpty hint="集群状态尚未绑定名称和状态"/></BlockShell>;return <BlockShell block={block} testid="cluster-health-strip"><Flex gap={8} wrap>{bound.rows.map(r=>{const state=String(r.values?.[status]??"unknown").toLowerCase(),healthy=["healthy","ready","success"].includes(state);return <Button key={r.id} size="small" onClick={()=>onAction?.("itemSelect",{entityRef:bound.entityRef,rowId:r.id})}><Badge status={healthy?"success":state==="warning"?"warning":"error"} text={`${String(r.values?.[name]??"集群")} · ${nodes?`${r.values?.[nodes]??0} 节点 · `:""}${version?String(r.values?.[version]??""):state}`}/></Button>})}</Flex></BlockShell>};
const ReleaseEnvironmentStripRenderer:ExperienceBlockRenderer=({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),version=fieldRefOf(block,"versionFieldRef"),env=fieldRefOf(block,"environmentFieldRef"),status=fieldRefOf(block,"statusFieldRef");if(!bound||!version||!env||!status)return <BlockShell block={block} testid="release-environment-strip"><BlockEmpty hint="发布环境尚未绑定版本、环境和状态"/></BlockShell>;return <BlockShell block={block} testid="release-environment-strip"><Flex gap={8} wrap>{bound.rows.map(r=><Button key={r.id} size="small" onClick={()=>onAction?.("filterChange",{environment:r.values?.[env],version:r.values?.[version],targets:targetIdsOf(block)})}><Badge status={String(r.values?.[status]).toLowerCase()==="healthy"?"success":"warning"} text={`${r.values?.[env]} · ${r.values?.[version]}`}/></Button>)}</Flex></BlockShell>};

const DeploymentCommandHeaderRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),title=fieldRefOf(block,"titleFieldRef"),status=fieldRefOf(block,"statusFieldRef"),editable=fieldRefOf(block,"editableFieldRef"),row=bound?.rows.find(r=>r.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!title||!status||!row)return <BlockShell block={block} testid="deployment-command-header"><BlockEmpty hint="部署页头尚未绑定标题和状态"/></BlockShell>;const can=!editable||enabledValue(row.values?.[editable],"editable"),act=(operation:string,event="actionTrigger")=>onAction?.(event,{entityRef:bound.entityRef,rowId:row.id,operation,targets:targetIdsOf(block)});return <BlockShell block={block} testid="deployment-command-header"><Flex justify="space-between" align="center" gap={12} wrap><Space><Typography.Title level={4} style={{margin:0}}>{String(row.values?.[title]??"未命名部署")}</Typography.Title><Tag color={String(row.values?.[status]).toLowerCase()==="healthy"?"green":"orange"}>{String(row.values?.[status])}</Tag></Space><Space><Button onClick={()=>act("viewDeploymentLogs")}>日志</Button><Button disabled={!can} onClick={()=>act("editDeployment","editRequest")}>编辑</Button><Popconfirm title="确认滚动重启这个部署？" onConfirm={()=>act("restartDeployment","submitRequest")}><Button danger disabled={!can}>重启</Button></Popconfirm></Space></Flex></BlockShell>};
const FeatureFlagCommandHeaderRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),title=fieldRefOf(block,"titleFieldRef"),enabled=fieldRefOf(block,"enabledFieldRef"),rollout=fieldRefOf(block,"rolloutFieldRef"),editable=fieldRefOf(block,"editableFieldRef"),row=bound?.rows.find(r=>r.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!title||!enabled||!row)return <BlockShell block={block} testid="feature-flag-command-header"><BlockEmpty hint="Feature Flag 页头尚未绑定标题和启用状态"/></BlockShell>;const active=enabledValue(row.values?.[enabled],"enabled"),can=!editable||enabledValue(row.values?.[editable],"editable"),act=(operation:string,event="actionTrigger")=>onAction?.(event,{entityRef:bound.entityRef,rowId:row.id,operation,targets:targetIdsOf(block)});return <BlockShell block={block} testid="feature-flag-command-header"><Flex justify="space-between" align="center" gap={12} wrap><Space><Typography.Title level={4} style={{margin:0}}>{String(row.values?.[title]??"Feature Flag")}</Typography.Title><Tag color={active?"green":"default"}>{active?"已启用":"已停用"}</Tag>{rollout&&<Tag color="blue">灰度 {Number(row.values?.[rollout]??0)}%</Tag>}</Space><Space><Button onClick={()=>act("viewFlagAudit")}>审计</Button><Button disabled={!can} onClick={()=>act("editFlagRollout","editRequest")}>调整灰度</Button><Popconfirm title={`确认${active?"停用":"启用"}这个 Flag？`} onConfirm={()=>act(active?"disableFeatureFlag":"enableFeatureFlag","submitRequest")}><Button disabled={!can}>{active?"停用":"启用"}</Button></Popconfirm></Space></Flex></BlockShell>};

const DeploymentScaleBarRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),desired=fieldRefOf(block,"desiredFieldRef"),ready=fieldRefOf(block,"readyFieldRef"),editable=fieldRefOf(block,"editableFieldRef"),row=bound?.rows.find(r=>r.id===focus?.[bound.entityRef])??bound?.rows[0],[target,setTarget]=React.useState(0);if(!bound||!desired||!ready||!row)return <BlockShell block={block} testid="deployment-scale-bar"><BlockEmpty hint="扩缩容栏尚未绑定期望和就绪副本"/></BlockShell>;const current=Number(row.values?.[desired]??0),can=!editable||enabledValue(row.values?.[editable],"editable"),next=target||current;return <BlockShell block={block} testid="deployment-scale-bar"><Flex justify="space-between" align="end" gap={12} wrap><div><Typography.Text strong>当前 {String(row.values?.[ready]??0)}/{current} 副本就绪</Typography.Text><Typography.Text type="secondary" style={{display:"block",fontSize:12}}>目标副本变更后等待真实 rollout 状态</Typography.Text></div><Space><Input type="number" min={0} value={String(next)} onChange={e=>setTarget(Math.max(0,Number(e.target.value)||0))} style={{width:90}}/><Popconfirm title={`确认将目标副本调整为 ${next}？`} onConfirm={()=>onAction?.("submitRequest",{entityRef:bound.entityRef,rowId:row.id,operation:"scaleDeployment",desired:next,targets:targetIdsOf(block)})}><Button type="primary" disabled={!can||next===current}>应用扩缩容</Button></Popconfirm></Space></Flex></BlockShell>};
const ReleaseRolloutBarRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),status=fieldRefOf(block,"statusFieldRef"),adoption=fieldRefOf(block,"adoptionFieldRef"),health=fieldRefOf(block,"healthFieldRef"),row=bound?.rows.find(r=>r.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!status||!adoption||!row)return <BlockShell block={block} testid="release-rollout-bar"><BlockEmpty hint="发布灰度栏尚未绑定状态和采用率"/></BlockShell>;const state=String(row.values?.[status]??"active").toLowerCase(),rate=Number(row.values?.[adoption]??0),healthy=!health||Number(row.values?.[health]??0)>=99,submit=(operation:string)=>onAction?.("submitRequest",{entityRef:bound.entityRef,rowId:row.id,operation,targets:targetIdsOf(block)});return <BlockShell block={block} testid="release-rollout-bar"><Flex justify="space-between" align="center" gap={12} wrap><div><Typography.Text strong>灰度采用 {rate}%</Typography.Text><Progress percent={Math.min(100,rate)} size="small" style={{width:220}}/></div><Space><Button onClick={()=>submit(state==="paused"?"resumeReleaseRollout":"pauseReleaseRollout")}>{state==="paused"?"继续灰度":"暂停灰度"}</Button><Button type="primary" disabled={!healthy||rate<100} onClick={()=>submit("completeReleaseRollout")}>完成发布</Button></Space></Flex></BlockShell>};

const CumulativeFlowChartRenderer:ExperienceBlockRenderer=({block,children,entityRows,chartPalette})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),time=fieldRefOf(block,"timeFieldRef"),state=fieldRefOf(block,"stateFieldRef"),value=fieldRefOf(block,"valueFieldRef");if(!bound||!time||!state)return <AnalysisChart block={block} title={String(block.props?.title??"累计流")} testid="cumulative-flow-chart" hint="累计流尚未绑定时间和状态"/>;const dates=Array.from(new Set(bound.rows.map(r=>String(r.values?.[time]??"")).filter(Boolean))).sort(),states=Array.from(new Set(bound.rows.map(r=>String(r.values?.[state]??"")).filter(Boolean))),map=new Map<string,number>();bound.rows.forEach(r=>{const k=`${r.values?.[time]}\u0000${r.values?.[state]}`;map.set(k,(map.get(k)??0)+(value?Number(r.values?.[value]??0):1))});const colors=chartColors(chartPalette),series=states.map((s,index)=>({name:s,type:"line",stack:"flow",areaStyle:{opacity:.35},symbol:"none",data:dates.map(d=>map.get(`${d}\u0000${s}`)??0),itemStyle:{color:colors[index%colors.length]}}));return <AnalysisChart block={block} title={String(block.props?.title??"累计流")} testid="cumulative-flow-chart" option={dates.length?{animation:false,tooltip:{trigger:"axis",confine:true},legend:{bottom:0},xAxis:{type:"category",data:dates},yAxis:{type:"value",minInterval:1},series}:undefined} hint="当前没有累计流数据"/>};
const BookingDemandChartRenderer:ExperienceBlockRenderer=({block,children,entityRows,chartPalette})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),time=fieldRefOf(block,"timeFieldRef"),available=fieldRefOf(block,"availableFieldRef"),booked=fieldRefOf(block,"bookedFieldRef"),canceled=fieldRefOf(block,"canceledFieldRef");if(!bound||!time||!available||!booked)return <AnalysisChart block={block} title={String(block.props?.title??"预约需求")} testid="booking-demand-chart" hint="预约需求尚未绑定时间、可用和已预约字段"/>;const rows=[...bound.rows].sort((a,b)=>String(a.values?.[time]).localeCompare(String(b.values?.[time]))),defs:Array<[string,string,string]>=[["可用",available,chartPalette?.primary??"#1677ff"],["已预约",booked,"#52c41a"],...(canceled?[["已取消",canceled,"#ff4d4f"] as [string,string,string]]:[])],series=defs.map(([name,ref,color])=>({name,type:"line",connectNulls:false,data:rows.map(r=>nullableNumber(r.values?.[ref])),itemStyle:{color}}));return <AnalysisChart block={block} title={String(block.props?.title??"预约需求")} testid="booking-demand-chart" option={rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},legend:{bottom:0},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time]))},yAxis:{type:"value",minInterval:1},series}:undefined} hint="当前没有预约需求数据"/>};
const CycleRiskStripRenderer:ExperienceBlockRenderer=({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),title=fieldRefOf(block,"titleFieldRef"),remaining=fieldRefOf(block,"remainingFieldRef"),blocked=fieldRefOf(block,"blockedFieldRef"),overdue=fieldRefOf(block,"overdueFieldRef"),row=bound?.rows[0];if(!bound||!title||!remaining||!row)return <BlockShell block={block} testid="cycle-risk-strip"><BlockEmpty hint="周期风险尚未绑定标题和剩余天数"/></BlockShell>;const risk=Number(blocked?row.values?.[blocked]??0:0)+Number(overdue?row.values?.[overdue]??0:0)>0;return <BlockShell block={block} testid="cycle-risk-strip"><Button type="text" onClick={()=>onAction?.("itemSelect",{entityRef:bound.entityRef,rowId:row.id})}><Badge status={risk?"warning":"success"} text={`${String(row.values?.[title])} · 剩余 ${Number(row.values?.[remaining]??0)} 天${blocked?` · 阻塞 ${Number(row.values?.[blocked]??0)}`:""}${overdue?` · 超期 ${Number(row.values?.[overdue]??0)}`:""}`}/></Button></BlockShell>};
const WorkItemMoveDrawerRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),title=fieldRefOf(block,"titleFieldRef"),group=fieldRefOf(block,"groupFieldRef"),row=bound?.rows.find(r=>r.id===focus?.[bound.entityRef])??bound?.rows[0],[open,setOpen]=React.useState(false),[target,setTarget]=React.useState("");if(!bound||!title||!group||!row)return <BlockShell block={block} testid="work-item-move-drawer"><BlockEmpty hint="移动任务尚未绑定标题和分组"/></BlockShell>;const current=String(row.values?.[group]??""),options=Array.from(new Set(bound.rows.map(r=>String(r.values?.[group]??"")).filter(v=>v&&v!==current))).map(v=>({value:v,label:v}));return <BlockShell block={block} testid="work-item-move-drawer"><Button onClick={()=>setOpen(true)}>移动 {String(row.values?.[title])}</Button><Drawer open={open} onClose={()=>setOpen(false)} title="移动工作项" width={420} extra={<Button type="primary" disabled={!target} onClick={()=>{onAction?.("submitRequest",{entityRef:bound.entityRef,rowId:row.id,operation:"moveWorkItem",targetGroup:target,targets:targetIdsOf(block)});setOpen(false)}}>确认移动</Button>}><Typography.Text type="secondary">当前分组：{current}</Typography.Text><Select value={target||undefined} options={options} placeholder="选择目标分组" onChange={setTarget} style={{width:"100%",marginTop:12}}/></Drawer></BlockShell>};
const BookingConflictDrawerRenderer:ExperienceBlockRenderer=({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),title=fieldRefOf(block,"titleFieldRef"),start=fieldRefOf(block,"startFieldRef"),end=fieldRefOf(block,"endFieldRef"),severity=fieldRefOf(block,"severityFieldRef"),[open,setOpen]=React.useState(false);if(!bound||!title||!start||!end)return <BlockShell block={block} testid="booking-conflict-drawer"><BlockEmpty hint="冲突处理尚未绑定标题和时间范围"/></BlockShell>;return <BlockShell block={block} testid="booking-conflict-drawer"><Button danger={bound.rows.length>0} onClick={()=>setOpen(true)}>查看冲突 {bound.rows.length}</Button><Drawer open={open} onClose={()=>setOpen(false)} title="预约冲突" width={480}>{bound.rows.length===0?<Empty description="当前没有冲突"/>:<List dataSource={bound.rows} renderItem={r=><List.Item actions={[<Button key="reschedule" type="link" onClick={()=>onAction?.("editRequest",{entityRef:bound.entityRef,rowId:r.id,operation:"rescheduleBooking",targets:targetIdsOf(block)})}>改期</Button>]}><List.Item.Meta title={<Space>{String(r.values?.[title])}{severity&&<Tag color={String(r.values?.[severity]).toLowerCase()==="high"?"red":"orange"}>{String(r.values?.[severity])}</Tag>}</Space>} description={`${String(r.values?.[start])} - ${String(r.values?.[end])}`}/></List.Item>}/>}</Drawer></BlockShell>};

const WorkflowDurationChartRenderer:ExperienceBlockRenderer=({block,children,entityRows,chartPalette})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),time=fieldRefOf(block,"timeFieldRef"),average=fieldRefOf(block,"averageFieldRef"),p95=fieldRefOf(block,"p95FieldRef"),failed=fieldRefOf(block,"failedFieldRef");if(!bound||!time||!average||!p95)return <AnalysisChart block={block} title={String(block.props?.title??"工作流耗时")} testid="workflow-duration-chart" hint="耗时趋势尚未绑定时间、平均和 P95"/>;const rows=[...bound.rows].sort((a,b)=>String(a.values?.[time]).localeCompare(String(b.values?.[time]))),defs:Array<[string,string,string]>=[["平均",average,chartPalette?.primary??"#1677ff"],["P95",p95,"#722ed1"],...(failed?[["失败耗时",failed,"#ff4d4f"] as [string,string,string]]:[])];return <AnalysisChart block={block} title={String(block.props?.title??"工作流耗时")} testid="workflow-duration-chart" option={rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},legend:{bottom:0},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time]))},yAxis:{type:"value",name:"ms"},series:defs.map(([name,ref,color])=>({name,type:"line",connectNulls:false,data:rows.map(r=>nullableNumber(r.values?.[ref])),itemStyle:{color}}))}:undefined} hint="当前没有工作流耗时数据"/>};
const WorkflowOutcomeMetricsRenderer:ExperienceBlockRenderer=({block,children,entityRows})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),success=fieldRefOf(block,"successFieldRef"),failed=fieldRefOf(block,"failedFieldRef"),running=fieldRefOf(block,"runningFieldRef"),pending=fieldRefOf(block,"pendingFieldRef"),row=bound?.rows[0];if(!bound||!success||!failed||!row)return <BlockShell block={block} title={String(block.props?.title??"执行结果")} testid="workflow-outcome-metrics"><BlockEmpty hint="结果指标尚未绑定成功和失败数"/></BlockShell>;const ok=Number(row.values?.[success]??0),bad=Number(row.values?.[failed]??0),ended=ok+bad;return <BlockShell block={block} title={String(block.props?.title??"执行结果")} testid="workflow-outcome-metrics"><Flex gap={22} wrap><Statistic title="成功" value={ok}/><Statistic title="失败" value={bad} valueStyle={{color:bad?"#cf1322":undefined}}/><Statistic title="成功率" value={ended?Math.round(ok/ended*100):0} suffix="%"/>{running&&<Statistic title="运行中" value={Number(row.values?.[running]??0)}/>} {pending&&<Statistic title="等待" value={Number(row.values?.[pending]??0)}/>}</Flex></BlockShell>};
const WorkflowVersionStripRenderer:ExperienceBlockRenderer=({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),name=fieldRefOf(block,"nameFieldRef"),version=fieldRefOf(block,"versionFieldRef"),enabled=fieldRefOf(block,"enabledFieldRef"),updated=fieldRefOf(block,"updatedAtFieldRef"),row=bound?.rows[0];if(!bound||!name||!version||!enabled||!row)return <BlockShell block={block} testid="workflow-version-strip"><BlockEmpty hint="工作流版本尚未绑定名称、版本和状态"/></BlockShell>;const active=enabledValue(row.values?.[enabled],"enabled");return <BlockShell block={block} testid="workflow-version-strip"><Button type="text" onClick={()=>onAction?.("itemSelect",{entityRef:bound.entityRef,rowId:row.id})}><Badge status={active?"success":"default"} text={`${String(row.values?.[name])} · ${String(row.values?.[version])}${updated?` · ${String(row.values?.[updated]??"")}`:""}`}/></Button></BlockShell>};
const WorkflowFailureDrawerRenderer:ExperienceBlockRenderer=({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),node=fieldRefOf(block,"nodeFieldRef"),message=fieldRefOf(block,"messageFieldRef"),status=fieldRefOf(block,"statusFieldRef"),time=fieldRefOf(block,"timeFieldRef"),[open,setOpen]=React.useState(false);if(!bound||!node||!message||!status)return <BlockShell block={block} testid="workflow-failure-drawer"><BlockEmpty hint="失败诊断尚未绑定节点、错误和状态"/></BlockShell>;const failedRows=bound.rows.filter(r=>["failed","aborted","rejected"].includes(String(r.values?.[status]).toLowerCase()));return <BlockShell block={block} testid="workflow-failure-drawer"><Button danger={failedRows.length>0} onClick={()=>setOpen(true)}>失败诊断 {failedRows.length}</Button><Drawer open={open} onClose={()=>setOpen(false)} title="工作流失败诊断" width={520}>{failedRows.length===0?<Empty description="没有失败执行"/>:<List dataSource={failedRows} renderItem={r=><List.Item actions={[<Button key="retry" type="link" onClick={()=>onAction?.("submitRequest",{entityRef:bound.entityRef,rowId:r.id,operation:"retryWorkflowExecution",targets:targetIdsOf(block)})}>重试</Button>]}><List.Item.Meta title={String(r.values?.[node])} description={`${String(r.values?.[message])}${time?` · ${String(r.values?.[time]??"")}`:""}`}/></List.Item>}/>}</Drawer></BlockShell>};
const WorkflowCommandHeaderRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),title=fieldRefOf(block,"titleFieldRef"),enabled=fieldRefOf(block,"enabledFieldRef"),version=fieldRefOf(block,"versionFieldRef"),editable=fieldRefOf(block,"editableFieldRef"),row=bound?.rows.find(r=>r.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!title||!enabled||!row)return <BlockShell block={block} testid="workflow-command-header"><BlockEmpty hint="工作流页头尚未绑定标题和状态"/></BlockShell>;const active=enabledValue(row.values?.[enabled],"enabled"),can=!editable||enabledValue(row.values?.[editable],"editable"),act=(operation:string,event="actionTrigger")=>onAction?.(event,{entityRef:bound.entityRef,rowId:row.id,operation,targets:targetIdsOf(block)});return <BlockShell block={block} testid="workflow-command-header"><Flex justify="space-between" align="center" gap={12} wrap><Space><Typography.Title level={4} style={{margin:0}}>{String(row.values?.[title])}</Typography.Title><Tag color={active?"green":"default"}>{active?"已启用":"已停用"}</Tag>{version&&<Tag>{String(row.values?.[version]??"")}</Tag>}</Space><Space><Button disabled={!active} onClick={()=>act("runWorkflow")}>运行</Button><Button disabled={!can} onClick={()=>act("editWorkflow","editRequest")}>编辑</Button><Button onClick={()=>act("duplicateWorkflow")}>复制</Button><Popconfirm title={`确认${active?"停用":"启用"}工作流？`} onConfirm={()=>act(active?"disableWorkflow":"enableWorkflow","submitRequest")}><Button disabled={!can}>{active?"停用":"启用"}</Button></Popconfirm></Space></Flex></BlockShell>};
const WorkflowControlBarRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),status=fieldRefOf(block,"statusFieldRef"),progress=fieldRefOf(block,"progressFieldRef"),row=bound?.rows.find(r=>r.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!status||!row)return <BlockShell block={block} testid="workflow-control-bar"><BlockEmpty hint="执行控制尚未绑定状态"/></BlockShell>;const state=String(row.values?.[status]??"pending").toLowerCase(),started=["started","running"].includes(state),retryable=["failed","aborted","rejected"].includes(state),resolved=["resolved","succeeded","success"].includes(state),submit=(operation:string)=>onAction?.("submitRequest",{entityRef:bound.entityRef,rowId:row.id,operation,targets:targetIdsOf(block)});return <BlockShell block={block} testid="workflow-control-bar"><Flex justify="space-between" align="center" gap={12} wrap><Space><Badge status={started?"processing":retryable?"error":resolved?"success":"default"} text={state}/>{progress&&started&&<Progress percent={Math.min(100,Number(row.values?.[progress]??0))} size="small" style={{width:160}}/>}</Space><Space><Button onClick={()=>onAction?.("itemSelect",{entityRef:bound.entityRef,rowId:row.id})}>查看结果</Button><Popconfirm title="确认取消当前执行？" onConfirm={()=>submit("cancelWorkflowExecution")}><Button danger disabled={!started}>取消</Button></Popconfirm><Button type="primary" disabled={!retryable} onClick={()=>submit("retryWorkflowExecution")}>重试</Button></Space></Flex></BlockShell>};
const RealmCommandHeaderRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),name=fieldRefOf(block,"nameFieldRef"),enabled=fieldRefOf(block,"enabledFieldRef"),manageable=fieldRefOf(block,"manageableFieldRef"),row=bound?.rows.find(r=>r.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!name||!enabled||!row)return <BlockShell block={block} testid="realm-command-header"><BlockEmpty hint="Realm 页头尚未绑定名称和状态"/></BlockShell>;const active=enabledValue(row.values?.[enabled],"enabled"),can=!manageable||enabledValue(row.values?.[manageable],"allowed"),act=(operation:string,event="actionTrigger")=>onAction?.(event,{entityRef:bound.entityRef,rowId:row.id,operation,targets:targetIdsOf(block)});return <BlockShell block={block} testid="realm-command-header"><Flex justify="space-between" align="center" gap={12} wrap><Space><Typography.Title level={4} style={{margin:0}}>{String(row.values?.[name])}</Typography.Title><Tag color={active?"green":"default"}>{active?"已启用":"已禁用"}</Tag></Space><Space><Button onClick={()=>act("exportRealm")}>导出</Button><Button disabled={!can} onClick={()=>act("openRealmSecurity")}>安全设置</Button><Popconfirm title={`确认${active?"禁用":"启用"} Realm？`} onConfirm={()=>act(active?"disableRealm":"enableRealm","submitRequest")}><Button disabled={!can}>{active?"禁用":"启用"}</Button></Popconfirm></Space></Flex></BlockShell>};
const CredentialLifecycleBarRenderer:ExperienceBlockRenderer=({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),username=fieldRefOf(block,"usernameFieldRef"),resettable=fieldRefOf(block,"resettableFieldRef"),temporary=fieldRefOf(block,"temporaryFieldRef"),updated=fieldRefOf(block,"updatedAtFieldRef"),row=bound?.rows.find(r=>r.id===focus?.[bound.entityRef])??bound?.rows[0];if(!bound||!username||!resettable||!row)return <BlockShell block={block} testid="credential-lifecycle-bar"><BlockEmpty hint="凭据生命周期尚未绑定用户和可重置状态"/></BlockShell>;const can=enabledValue(row.values?.[resettable],"allowed"),temp=Boolean(temporary&&enabledValue(row.values?.[temporary],"temporary")),submit=(operation:string,event="submitRequest")=>onAction?.(event,{entityRef:bound.entityRef,rowId:row.id,operation,targets:targetIdsOf(block)});return <BlockShell block={block} testid="credential-lifecycle-bar"><Flex justify="space-between" align="center" gap={12} wrap><div><Typography.Text strong>{String(row.values?.[username])}</Typography.Text><Typography.Text type="secondary" style={{display:"block",fontSize:12}}>{temp?"当前为临时密码":"当前为持久密码"}{updated?` · 更新于 ${String(row.values?.[updated]??"")}`:""}</Typography.Text></div><Space><Button disabled={!can} onClick={()=>submit("resetPassword","editRequest")}>重置密码</Button><Button disabled={!can} onClick={()=>submit("sendResetCredentialEmail")}>发送重置邮件</Button><Button disabled={!can} onClick={()=>submit("requirePasswordUpdate")}>要求下次更新</Button></Space></Flex></BlockShell>};

const multiSeriesChart=(testid:string,fallback:string,defs:Array<[string,string,string]>,unit=""):ExperienceBlockRenderer=>({block,children,entityRows,chartPalette})=>{if(children!=null)return <>{children}</>;const bound=rowsOfBinding(block,entityRows),time=fieldRefOf(block,"timeFieldRef"),resolved=defs.map(([label,key,color],i)=>[label,fieldRefOf(block,key),(i===0?chartPalette?.primary:chartPalette?.categorical?.[i])??color] as const);if(!bound||!time||resolved.slice(0,2).some(([,ref])=>!ref))return <AnalysisChart block={block} title={String(block.props?.title??fallback)} testid={testid} hint={`${fallback}尚未绑定必要字段`}/>;const rows=[...bound.rows].sort((a,b)=>String(a.values?.[time]).localeCompare(String(b.values?.[time]))),series=resolved.flatMap(([name,ref,color])=>ref?[{name,type:"line",connectNulls:false,data:rows.map(r=>nullableNumber(r.values?.[ref])),itemStyle:{color}}]:[]);return <AnalysisChart block={block} title={String(block.props?.title??fallback)} testid={testid} option={rows.length?{animation:false,tooltip:{trigger:"axis",confine:true},legend:{bottom:0},xAxis:{type:"category",data:rows.map(r=>String(r.values?.[time]))},yAxis:{type:"value",name:unit},series}:undefined} hint="当前没有趋势数据"/>};
const PanelQueryLatencyChartRenderer=multiSeriesChart("panel-query-latency-chart","面板查询延迟",[["平均","averageFieldRef","#1677ff"],["P95","p95FieldRef","#722ed1"],["超时","timeoutFieldRef","#ff4d4f"]],"ms");
const SyncVolumeTrendChartRenderer=multiSeriesChart("sync-volume-trend-chart","同步数据量",[["记录","recordsFieldRef","#1677ff"],["字节","bytesFieldRef","#52c41a"],["失败","failedFieldRef","#ff4d4f"]]);
const DatasourceQueryMetricsRenderer:ExperienceBlockRenderer=({block,children,entityRows})=>{if(children!=null)return <>{children}</>;const b=rowsOfBinding(block,entityRows),req=fieldRefOf(block,"requestFieldRef"),err=fieldRefOf(block,"errorFieldRef"),cache=fieldRefOf(block,"cacheHitFieldRef"),duration=fieldRefOf(block,"durationFieldRef"),r=b?.rows[0];if(!b||!req||!err||!r)return <BlockShell block={block} testid="datasource-query-metrics"><BlockEmpty hint="查询指标尚未绑定请求和错误数"/></BlockShell>;const total=Number(r.values?.[req]??0),errors=Number(r.values?.[err]??0);return <BlockShell block={block} title={String(block.props?.title??"数据源查询")} testid="datasource-query-metrics"><Flex gap={20} wrap><Statistic title="请求" value={total}/><Statistic title="错误率" value={total?Math.round(errors/total*100):0} suffix="%"/>{cache&&<Statistic title="缓存命中" value={total?Math.round(Number(r.values?.[cache]??0)/total*100):0} suffix="%"/>}{duration&&<Statistic title="平均耗时" value={Number(r.values?.[duration]??0)} suffix="ms"/>}</Flex></BlockShell>};
const StreamFreshnessMetricsRenderer:ExperienceBlockRenderer=({block,children,entityRows})=>{if(children!=null)return <>{children}</>;const b=rowsOfBinding(block,entityRows),lag=fieldRefOf(block,"lagFieldRef"),synced=fieldRefOf(block,"syncedAtFieldRef"),records=fieldRefOf(block,"recordsFieldRef"),failed=fieldRefOf(block,"failedFieldRef"),r=b?.rows[0];if(!b||!lag||!synced||!r)return <BlockShell block={block} testid="stream-freshness-metrics"><BlockEmpty hint="新鲜度尚未绑定延迟和同步时间"/></BlockShell>;return <BlockShell block={block} title={String(block.props?.title??"数据流新鲜度")} testid="stream-freshness-metrics"><Flex gap={20} wrap><Statistic title="延迟" value={Number(r.values?.[lag]??0)} suffix="分钟"/><Statistic title="最近同步" value={String(r.values?.[synced]??"未同步")}/>{records&&<Statistic title="记录" value={Number(r.values?.[records]??0)}/>} {failed&&<Statistic title="失败" value={Number(r.values?.[failed]??0)}/>}</Flex></BlockShell>};
const statusStrip=(testid:string,fallback:string):ExperienceBlockRenderer=>({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const b=rowsOfBinding(block,entityRows),name=fieldRefOf(block,"nameFieldRef"),status=fieldRefOf(block,"statusFieldRef"),type=fieldRefOf(block,"typeFieldRef"),version=fieldRefOf(block,"versionFieldRef"),extra=fieldRefOf(block,"checkedAtFieldRef")??fieldRefOf(block,"availableVersionFieldRef");if(!b||!name||!status)return <BlockShell block={block} testid={testid}><BlockEmpty hint={`${fallback}尚未绑定名称和状态`}/></BlockShell>;return <BlockShell block={block} testid={testid}><Flex gap={8} wrap>{b.rows.map(r=>{const state=String(r.values?.[status]??"unknown").toLowerCase(),ok=["healthy","connected","ready","current"].includes(state);return <Button key={r.id} size="small" onClick={()=>ok?onAction?.("itemSelect",{entityRef:b.entityRef,rowId:r.id}):onAction?.("actionTrigger",{entityRef:b.entityRef,rowId:r.id,operation:"retryStatusCheck",targets:targetIdsOf(block)})}><Badge status={ok?"success":state==="upgrading"?"processing":"error"} text={`${String(r.values?.[name])}${type?` · ${String(r.values?.[type]??"")}`:""}${version?` · ${String(r.values?.[version]??"")}`:""}${extra?` · ${String(r.values?.[extra]??"")}`:""}`}/></Button>})}</Flex></BlockShell>};
const commandHeader=(testid:string,fallback:string):ExperienceBlockRenderer=>({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const b=rowsOfBinding(block,entityRows),title=fieldRefOf(block,"titleFieldRef"),status=fieldRefOf(block,"statusFieldRef"),editable=fieldRefOf(block,"editableFieldRef"),dirty=fieldRefOf(block,"dirtyFieldRef"),refreshing=fieldRefOf(block,"refreshingFieldRef"),source=fieldRefOf(block,"datasourceFieldRef"),r=b?.rows.find(x=>x.id===focus?.[b.entityRef])??b?.rows[0];if(!b||!title||!r)return <BlockShell block={block} testid={testid}><BlockEmpty hint={`${fallback}尚未绑定标题`}/></BlockShell>;const can=!editable||enabledValue(r.values?.[editable],"editable"),busy=Boolean(refreshing&&enabledValue(r.values?.[refreshing],"refreshing")),act=(operation:string,event="actionTrigger")=>onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation,targets:targetIdsOf(block)});return <BlockShell block={block} testid={testid}><Flex justify="space-between" align="center" gap={12} wrap><Space><Typography.Title level={4} style={{margin:0}}>{String(r.values?.[title])}</Typography.Title>{status&&<Tag>{String(r.values?.[status]??"")}</Tag>}{source&&<Tag color="blue">{String(r.values?.[source]??"")}</Tag>}</Space><Space><Button disabled={busy} onClick={()=>act("refresh")}>刷新</Button><Button onClick={()=>act("inspect")}>检查</Button><Button type="primary" disabled={!can||busy} onClick={()=>act(dirty&&enabledValue(r.values?.[dirty],"dirty")?"save":"edit","editRequest")}>{dirty&&enabledValue(r.values?.[dirty],"dirty")?"保存":"编辑"}</Button></Space></Flex></BlockShell>};
const PanelCommandHeaderRenderer=commandHeader("panel-command-header","面板页头");
const runtimeControl=(testid:string,fallback:string):ExperienceBlockRenderer=>({block,children,entityRows,focus,onAction})=>{if(children!=null)return <>{children}</>;const b=rowsOfBinding(block,entityRows),status=fieldRefOf(block,"statusFieldRef"),query=fieldRefOf(block,"queryFieldRef"),refreshing=fieldRefOf(block,"refreshingFieldRef"),dirty=fieldRefOf(block,"dirtyFieldRef"),r=b?.rows.find(x=>x.id===focus?.[b.entityRef])??b?.rows[0];if(!b||!status||!r)return <BlockShell block={block} testid={testid}><BlockEmpty hint={`${fallback}尚未绑定状态`}/></BlockShell>;const state=String(r.values?.[status]??"idle").toLowerCase(),busy=["running","refreshing"].includes(state)||Boolean(refreshing&&enabledValue(r.values?.[refreshing],"refreshing")),canRun=!query||Boolean(String(r.values?.[query]??"").trim()),changed=Boolean(dirty&&enabledValue(r.values?.[dirty],"dirty")),act=(op:string,event="actionTrigger")=>onAction?.(event,{entityRef:b.entityRef,rowId:r.id,operation:op,targets:targetIdsOf(block)});return <BlockShell block={block} testid={testid}><Flex justify="space-between" align="center" gap={12} wrap><Badge status={busy?"processing":state.includes("error")||state.includes("breaking")?"error":"success"} text={state}/><Space><Button onClick={()=>act("inspect")}>检查</Button><Button danger disabled={!busy} onClick={()=>act("cancel","submitRequest")}>取消</Button><Button type="primary" disabled={busy||(!canRun&&!changed)} onClick={()=>act(changed?"save":"run",changed?"editRequest":"submitRequest")}>{changed?"保存":"运行"}</Button></Space></Flex></BlockShell>};
const ExploreQueryControlBarRenderer=runtimeControl("explore-query-control-bar","查询控制");
const diagnosticDrawer=(testid:string,fallback:string,refKey:string,messageKey:string,statusKey:string):ExperienceBlockRenderer=>({block,children,entityRows,onAction})=>{if(children!=null)return <>{children}</>;const b=rowsOfBinding(block,entityRows),ref=fieldRefOf(block,refKey),message=fieldRefOf(block,messageKey),status=fieldRefOf(block,statusKey),[open,setOpen]=React.useState(false);if(!b||!ref||!message||!status)return <BlockShell block={block} testid={testid}><BlockEmpty hint={`${fallback}尚未绑定诊断字段`}/></BlockShell>;const rows=b.rows.filter(r=>!["ok","healthy","resolved","no_change"].includes(String(r.values?.[status]).toLowerCase()));return <BlockShell block={block} testid={testid}><Button danger={rows.length>0} onClick={()=>setOpen(true)}>{fallback} {rows.length}</Button><Drawer open={open} onClose={()=>setOpen(false)} title={fallback} width={520}>{rows.length===0?<Empty description="当前没有异常"/>:<List dataSource={rows} renderItem={r=><List.Item actions={[<Button key="retry" type="link" onClick={()=>onAction?.("submitRequest",{entityRef:b.entityRef,rowId:r.id,operation:"resolveDiagnostic",targets:targetIdsOf(block)})}>处理</Button>]}><List.Item.Meta title={String(r.values?.[ref])} description={String(r.values?.[message])}/></List.Item>}/>}</Drawer></BlockShell>};
const QueryErrorDrawerRenderer=diagnosticDrawer("query-error-drawer","查询错误","refFieldRef","messageFieldRef","statusFieldRef");
const SchemaConflictDrawerRenderer=diagnosticDrawer("schema-conflict-drawer","Schema 冲突","streamFieldRef","fieldFieldRef","changeFieldRef");

/**
 * Plane's kanban keeps group identity separate from issue data and emits an
 * explicit source/target move. These variants preserve that behavior while
 * layering domain-specific guards (WIP, dependency, capacity) on the same
 * existing binding and event contract.
 */
type MatureKanbanVariant =
  | "swimlane" | "wip" | "backlog" | "sprint" | "dependency" | "triage"
  | "approval" | "content" | "recruitment" | "incident" | "release" | "portfolio";

const KANBAN_TITLES: Record<MatureKanbanVariant, string> = {
  swimlane: "泳道看板", wip: "WIP 限制看板", backlog: "待办优先级", sprint: "迭代规划",
  dependency: "依赖看板", triage: "分诊队列", approval: "审批阶段", content: "内容流水线",
  recruitment: "招聘流水线", incident: "事件响应", release: "发布列车", portfolio: "组合看板",
};

function MatureKanban({
  block, children, entityRows, onAction, variant,
}: ExperienceBlockRendererProps & { variant: MatureKanbanVariant }) {
  // 钩子必须在任何提前 return 之前——children 非空时若跳过它，同一个组件的
  // hook 顺序会在两次渲染间变化，React 会报 "Rendered fewer hooks than expected"。
  const { token } = antdTheme.useToken();
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows);
  const titleRef = fieldRefOf(block, "titleFieldRef");
  const statusRef = fieldRefOf(block, "statusFieldRef");
  const laneRef = fieldRefOf(block, "laneFieldRef");
  const priorityRef = fieldRefOf(block, "priorityFieldRef");
  const limitRef = fieldRefOf(block, "limitFieldRef");
  const blockedRef = fieldRefOf(block, "blockedFieldRef");
  const progressRef = fieldRefOf(block, "progressFieldRef");
  const ownerRef = fieldRefOf(block, "ownerFieldRef");
  const [moves, setMoves] = React.useState<Record<string, string>>({});
  const [selected, setSelected] = React.useState<string[]>([]);
  if (!bound || !titleRef || !statusRef) {
    return <BlockShell block={block} testid={`mature-kanban-${variant}`}><BlockEmpty hint={`${KANBAN_TITLES[variant]}尚未绑定标题和状态字段`} /></BlockShell>;
  }
  const statusOf = (row: RuntimeRow) => moves[row.id] ?? String(row.values?.[statusRef] ?? "未分组");
  const statuses = Array.from(new Set(bound.rows.map(statusOf).filter(Boolean)));
  const ordered = [...bound.rows].sort((a, b) => {
    if (variant !== "backlog" && variant !== "triage" && variant !== "incident") return 0;
    return Number(b.values?.[priorityRef ?? ""] ?? 0) - Number(a.values?.[priorityRef ?? ""] ?? 0);
  });
  const lanes = laneRef ? Array.from(new Set(ordered.map(row => String(row.values?.[laneRef] ?? "未分配")))) : ["全部"];
  const moveGuard = (row: RuntimeRow, target: string): string | undefined => {
    const source = statusOf(row);
    const targetCount = ordered.filter(item => statusOf(item) === target).length;
    const rowLimit = Number(row.values?.[limitRef ?? ""] ?? block.props?.wipLimit ?? 0);
    const blocked = blockedRef ? enabledValue(row.values?.[blockedRef], "blocked") : false;
    const progress = Number(row.values?.[progressRef ?? ""] ?? 0);
    const owner = String(row.values?.[ownerRef ?? ""] ?? "").trim();
    const sourceIndex = statuses.indexOf(source), targetIndex = statuses.indexOf(target);
    if (target === source) return;
    if (variant === "wip" && rowLimit > 0 && targetCount >= rowLimit) return "目标列已达到 WIP 上限";
    if (variant === "dependency" && blocked) return "依赖解除前不能推进";
    if (variant === "sprint" && rowLimit > 0 && targetCount >= rowLimit) return "迭代容量已满";
    if (variant === "approval" && targetIndex > sourceIndex + 1) return "审批阶段不能跨级推进";
    if (variant === "content" && /发布|published|done/i.test(target) && progress < 100) return "内容完成度达到 100% 后才能发布";
    if (variant === "recruitment" && /拒绝|rejected|hired|录用/i.test(source)) return "终态候选人不能直接改阶段";
    if (variant === "incident" && /解决|resolved|closed/i.test(target) && (blocked || progress < 100)) return "阻塞解除且处置完成后才能关闭事件";
    if (variant === "release" && targetIndex > sourceIndex + 1) return "发布必须逐环境推进";
    if (variant === "portfolio" && /完成|done|closed/i.test(target) && progress < 100) return "组合进度完成后才能进入完成阶段";
    if (variant === "triage" && targetIndex > 0 && !owner) return "分诊后必须先指定负责人";
    if (variant === "backlog" && targetIndex > 0 && !priorityRef) return "排期待办必须声明优先级";
    return undefined;
  };
  const move = (row: RuntimeRow, target: string) => {
    const source = statusOf(row);
    if (moveGuard(row, target)) return;
    setMoves(current => ({ ...current, [row.id]: target }));
    onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "moveBoardItem", source, target, targets: targetIdsOf(block) });
  };
  return (
    <BlockShell block={block} title={String(block.props?.title ?? KANBAN_TITLES[variant])} testid={`mature-kanban-${variant}`}
      extra={<Badge count={bound.rows.length} showZero color={token.colorPrimary} />}>
      {ordered.length === 0 ? <BlockEmpty hint="当前分组没有工作项" /> : <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {lanes.map(lane => <div key={lane} data-testid={`kanban-lane-${lane}`}>
          {laneRef && <Typography.Text strong>{lane}</Typography.Text>}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, statuses.length)}, minmax(190px, 1fr))`, gap: 10, overflowX: "auto", marginTop: 6 }}>
            {statuses.map(status => {
              const rows = ordered.filter(row => statusOf(row) === status && (!laneRef || String(row.values?.[laneRef] ?? "未分配") === lane));
              const limit = Math.max(0, ...rows.map(row => Number(row.values?.[limitRef ?? ""] ?? 0)), Number(block.props?.wipLimit ?? 0));
              const full = ["wip", "sprint"].includes(variant) && limit > 0 && rows.length >= limit;
              return <Card key={status} size="small" title={<Space><span>{status}</span><Badge count={rows.length} showZero /></Space>}
                extra={limit > 0 ? <Tag color={full ? "error" : "default"}>WIP {rows.length}/{limit}</Tag> : null}
                styles={{ body: { padding: 8, minHeight: 92 } }}>
                {rows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工作项" /> : rows.map(row => {
                  const blocked = blockedRef ? enabledValue(row.values?.[blockedRef], "blocked") : false;
                  const checked = selected.includes(row.id);
                  return <Card key={row.id} size="small" hoverable style={{ marginBottom: 8, opacity: blocked ? .65 : 1 }}
                    onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>
                    <Flex justify="space-between" gap={8} align="start">
                      <Checkbox checked={checked} onClick={event => event.stopPropagation()} onChange={event => setSelected(ids => event.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} />
                      <Typography.Text strong style={{ flex: 1 }}>{String(row.values?.[titleRef] ?? row.id)}</Typography.Text>
                      {priorityRef && <Tag>{String(row.values?.[priorityRef] ?? "-")}</Tag>}
                    </Flex>
                    {ownerRef && <Typography.Text type="secondary">{String(row.values?.[ownerRef] ?? "未分配")}</Typography.Text>}
                    {progressRef && <Progress size="small" percent={Math.min(100, Number(row.values?.[progressRef] ?? 0))} />}
                    {blocked && <Alert type="warning" message="存在未完成依赖" showIcon style={{ marginTop: 6 }} />}
                    <Select size="small" value={statusOf(row)} style={{ width: "100%", marginTop: 8 }}
                      options={statuses.map(value => ({ value, label: value, disabled: Boolean(moveGuard(row, value)) }))} onClick={event => event.stopPropagation()} onChange={target => move(row, target)} />
                  </Card>;
                })}
              </Card>;
            })}
          </div>
        </div>)}
        {selected.length > 0 && <Alert type="info" showIcon message={`已选择 ${selected.length} 项`} action={<Button size="small" onClick={() => onAction?.("editRequest", { entityRef: bound.entityRef, rowIds: selected, operation: "bulkEditBoardItems" })}>批量处理</Button>} />}
      </Space>}
    </BlockShell>
  );
}

const matureKanbanRenderer = (variant: MatureKanbanVariant): ExperienceBlockRenderer => props => <MatureKanban {...props} variant={variant} />;
const SwimlaneKanbanRenderer = matureKanbanRenderer("swimlane");
const WipLimitBoardRenderer = matureKanbanRenderer("wip");
const DependencyKanbanRenderer = matureKanbanRenderer("dependency");
const ContentPipelineBoardRenderer = matureKanbanRenderer("content");
const IncidentResponseBoardRenderer = matureKanbanRenderer("incident");
const PortfolioKanbanRenderer = matureKanbanRenderer("portfolio");

const SavedViewManagerRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>; const bound = rowsOfBinding(block, entityRows), name = fieldRefOf(block, "nameFieldRef"), shared = fieldRefOf(block, "sharedFieldRef"), active = fieldRefOf(block, "activeFieldRef");
  if (!bound || !name) return <BlockShell block={block} testid="saved-view-manager"><BlockEmpty hint="视图管理尚未绑定名称字段" /></BlockShell>;
  return <BlockShell block={block} title={String(block.props?.title ?? "保存视图")} testid="saved-view-manager"><List dataSource={bound.rows} locale={{ emptyText: "还没有保存视图" }} renderItem={row => <List.Item actions={[<Button key="apply" type="link" onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}>应用</Button>, <Popconfirm key="delete" title="删除这个视图？" onConfirm={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowId: row.id, operation: "deleteSavedView", targets: targetIdsOf(block) })}><Button type="link" danger>删除</Button></Popconfirm>]}><List.Item.Meta title={<Space>{String(row.values?.[name])}{active && enabledValue(row.values?.[active], "active") && <Tag color="blue">当前</Tag>}</Space>} description={shared && enabledValue(row.values?.[shared], "shared") ? "团队共享" : "仅自己"} /></List.Item>} /></BlockShell>;
};

const ColumnChooserDrawerRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>; const bound = rowsOfBinding(block, entityRows), title = fieldRefOf(block, "titleFieldRef"), visible = fieldRefOf(block, "visibleFieldRef"), [open, setOpen] = React.useState(false), [selected, setSelected] = React.useState<string[]>([]);
  if (!bound || !title) return <BlockShell block={block} testid="column-chooser-drawer"><BlockEmpty hint="列选择器尚未绑定标题字段" /></BlockShell>;
  const initial = bound.rows.filter(row => !visible || enabledValue(row.values?.[visible], "visible")).map(row => row.id); const values = selected.length ? selected : initial;
  return <BlockShell block={block} testid="column-chooser-drawer"><Button onClick={() => setOpen(true)}>配置列</Button><Drawer title="配置显示列" open={open} onClose={() => setOpen(false)} extra={<Button type="primary" onClick={() => { onAction?.("submitRequest", { entityRef: bound.entityRef, rowIds: values, operation: "setVisibleColumns", targets: targetIdsOf(block) }); setOpen(false); }}>应用</Button>}><Checkbox.Group value={values} onChange={ids => setSelected(ids.map(String))} style={{ display: "flex", flexDirection: "column", gap: 12 }}>{bound.rows.map(row => <Checkbox key={row.id} value={row.id}>{String(row.values?.[title])}</Checkbox>)}</Checkbox.Group></Drawer></BlockShell>;
};

const ActivityContextDrawerRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, onAction }) => {
  if (children != null) return <>{children}</>; const bound = rowsOfBinding(block, entityRows), title = fieldRefOf(block, "titleFieldRef"), time = fieldRefOf(block, "timeFieldRef"), actor = fieldRefOf(block, "actorFieldRef"), [open, setOpen] = React.useState(false);
  if (!bound || !title || !time) return <BlockShell block={block} testid="activity-context-drawer"><BlockEmpty hint="活动抽屉尚未绑定标题和时间字段" /></BlockShell>;
  return <BlockShell block={block} testid="activity-context-drawer"><Button onClick={() => setOpen(true)}>查看活动 <Badge count={bound.rows.length} /></Button><Drawer title="上下文活动" open={open} onClose={() => setOpen(false)}><Timeline items={[...bound.rows].sort((a,b) => String(b.values?.[time]).localeCompare(String(a.values?.[time]))).map(row => ({ children: <div onClick={() => onAction?.("itemSelect", { entityRef: bound.entityRef, rowId: row.id })}><Typography.Text strong>{String(row.values?.[title])}</Typography.Text><br/><Typography.Text type="secondary">{actor ? `${String(row.values?.[actor] ?? "系统")} · ` : ""}{String(row.values?.[time])}</Typography.Text></div> }))} /></Drawer></BlockShell>;
};

const BulkActionTrayRenderer: ExperienceBlockRenderer = ({ block, children, entityRows, selection, onAction }) => {
  if (children != null) return <>{children}</>; const bound = rowsOfBinding(block, entityRows); if (!bound) return <BlockShell block={block} testid="bulk-action-tray"><BlockEmpty hint="批量操作尚未绑定实体" /></BlockShell>;
  const ids = selection?.rowIds?.[bound.entityRef] ?? []; const actions = Array.isArray(block.props?.actions) ? block.props.actions.map(String) : ["分配", "移动", "归档"];
  return <BlockShell block={block} testid="bulk-action-tray"><Flex align="center" gap={8} wrap><Typography.Text strong>已选择 {ids.length} 项</Typography.Text>{actions.map(action => <Button key={action} disabled={!ids.length} onClick={() => onAction?.("submitRequest", { entityRef: bound.entityRef, rowIds: ids, operation: action, targets: targetIdsOf(block) })}>{action}</Button>)}<Button type="link" disabled={!ids.length} onClick={() => onAction?.("actionTrigger", { entityRef: bound.entityRef, operation: "clearSelection" })}>取消选择</Button></Flex></BlockShell>;
};

type ContextPanelVariant = "palette"|"notifications"|"filterPreset"|"exportJob"|"compare"|"inspector"|"help"|"audit"|"savedSearch"|"recent"|"related"|"permission"|"selection"|"validation"|"contextHelp"|"impact";
const CONTEXT_TITLES: Record<ContextPanelVariant,string> = { palette:"命令面板", notifications:"通知中心", filterPreset:"筛选预设", exportJob:"导出任务", compare:"对比选择", inspector:"详情检查器", help:"帮助上下文", audit:"审计差异", savedSearch:"保存搜索", recent:"最近项目", related:"关联实体", permission:"权限摘要", selection:"选择检查器", validation:"校验问题", contextHelp:"上下文帮助", impact:"变更影响" };

const ContextPanelRenderer = (variant: ContextPanelVariant): ExperienceBlockRenderer => ({ block, children, entityRows, selection, onAction }) => {
  if (children != null) return <>{children}</>;
  const bound = rowsOfBinding(block, entityRows), titleRef = fieldRefOf(block, "titleFieldRef"), statusRef = fieldRefOf(block, "statusFieldRef"), queryRef = fieldRefOf(block, "queryFieldRef"), timeRef = fieldRefOf(block, "timeFieldRef"), severityRef = fieldRefOf(block, "severityFieldRef"), relationRef = fieldRefOf(block, "relationFieldRef"), allowedRef = fieldRefOf(block, "allowedFieldRef"), messageRef = fieldRefOf(block, "messageFieldRef");
  const [open, setOpen] = React.useState(false), [query, setQuery] = React.useState(""), [preset, setPreset] = React.useState<string>();
  const ids = bound ? selection?.rowIds?.[bound.entityRef] ?? [] : [];
  if (!bound) return <BlockShell block={block} testid={`context-panel-${variant}`}><BlockEmpty hint={`${CONTEXT_TITLES[variant]}尚未绑定实体`} /></BlockShell>;
  const rows = timeRef ? [...bound.rows].sort((a,b) => String(b.values?.[timeRef]).localeCompare(String(a.values?.[timeRef]))) : bound.rows;
  const filtered = queryRef ? rows.filter(row => String(row.values?.[queryRef] ?? "").toLowerCase().includes(query.toLowerCase())) : rows;
  const status = (row: RuntimeRow) => String(row.values?.[statusRef ?? ""] ?? "").toLowerCase();
  const submit = (operation: string, extra: Record<string, unknown> = {}) => onAction?.("submitRequest", { entityRef: bound.entityRef, operation, targets: targetIdsOf(block), ...extra });
  let content: React.ReactNode;
  switch (variant) {
    case "palette": content = <Space direction="vertical" style={{ width: "100%" }}><Input prefix="⌘" placeholder="搜索命令" value={query} onChange={e=>setQuery(e.target.value)} />{filtered.slice(0,8).map(row=><Button key={row.id} block onClick={()=>onAction?.("actionTrigger",{entityRef:bound.entityRef,rowId:row.id,operation:"runCommand",targets:targetIdsOf(block)})}>{String(row.values?.[titleRef ?? ""] ?? row.id)}</Button>)}</Space>; break;
    case "notifications": content = <Button onClick={()=>setOpen(true)}>打开通知 <Badge count={bound.rows.filter(row=>status(row)==="unread").length} /></Button>; break;
    case "filterPreset": content = <Button onClick={()=>setOpen(true)}>管理筛选预设 <Badge count={rows.length} /></Button>; break;
    case "exportJob": content = <Button onClick={()=>setOpen(true)}>查看导出任务 <Badge count={rows.filter(row=>status(row)==="running").length} /></Button>; break;
    case "compare": content = <Alert type={ids.length===2?"success":"info"} message={ids.length===2?"已选择两条记录，可以对比":"请选择恰好两条记录"} action={<Button size="small" disabled={ids.length!==2} onClick={()=>onAction?.("itemSelect",{entityRef:bound.entityRef,rowIds:ids,operation:"compareSelection"})}>开始对比</Button>} />; break;
    case "inspector": content = <Button onClick={()=>setOpen(true)} disabled={!ids.length}>检查已选记录 {ids.length}</Button>; break;
    case "help": content = <Collapse items={rows.slice(0,6).map(row=>({key:row.id,label:String(row.values?.[titleRef ?? ""] ?? row.id),children:String(row.values?.[messageRef ?? ""] ?? "暂无帮助")}))} />; break;
    case "audit": content = <Button onClick={()=>setOpen(true)}>查看差异 <Badge count={rows.filter(row=>severityRef&&String(row.values?.[severityRef])).length} /></Button>; break;
    case "savedSearch": content = <List dataSource={rows} renderItem={row=><List.Item actions={[<Button key="run" type="link" onClick={()=>onAction?.("filterChange",{query:row.values?.[queryRef ?? ""],targets:targetIdsOf(block)})}>运行</Button>,<Button key="delete" type="link" danger onClick={()=>submit("deleteSavedSearch",{rowId:row.id})}>删除</Button>]}>{String(row.values?.[titleRef ?? ""] ?? row.id)}</List.Item>} />; break;
    case "recent": content = <List dataSource={rows.slice(0,10)} renderItem={row=><List.Item onClick={()=>onAction?.("itemSelect",{entityRef:bound.entityRef,rowId:row.id})}>{String(row.values?.[titleRef ?? ""] ?? row.id)}</List.Item>} />; break;
    case "related": { const groups = Array.from(new Set(rows.map(row=>String(row.values?.[relationRef ?? ""] ?? "相关")))); content = <Collapse items={groups.map(group=>({key:group,label:group,children:<List dataSource={rows.filter(row=>String(row.values?.[relationRef ?? ""] ?? "相关")===group)} renderItem={row=><List.Item onClick={()=>onAction?.("itemSelect",{entityRef:bound.entityRef,rowId:row.id})}>{String(row.values?.[titleRef ?? ""] ?? row.id)}</List.Item>} />}))} />; break; }
    case "permission": { const denied = allowedRef ? rows.filter(row=>!enabledValue(row.values?.[allowedRef],"allowed")).length : 0; content = <Alert type={denied?"warning":"success"} message={`${rows.length-denied} 项允许，${denied} 项需要申请`} action={denied?<Button size="small" onClick={()=>submit("requestPermission")}>申请权限</Button>:undefined} />; break; }
    case "selection": content = <Descriptions size="small" column={1} items={[{key:"selected",label:"已选择",children:ids.length},{key:"available",label:"可检查",children:bound.rows.length}]} />; break;
    case "validation": { const errors = severityRef ? rows.filter(row=>/error|错误/i.test(String(row.values?.[severityRef]))).length : 0; content = <Alert type={errors?"error":"success"} message={errors?`${errors} 个错误阻止提交`:"校验通过"} action={errors?<Button size="small" onClick={()=>setOpen(true)}>查看问题</Button>:undefined} />; break; }
    case "contextHelp": content = <Button onClick={()=>setOpen(true)}>打开当前页面帮助</Button>; break;
    case "impact": { const high = severityRef ? rows.filter(row=>/high|critical|高|严重/i.test(String(row.values?.[severityRef]))).length : 0; content = <Alert type={high?"warning":"info"} message={high?`${high} 项高风险影响需要确认`:`${rows.length} 项受影响`} action={<Button size="small" onClick={()=>submit("confirmChangeImpact")}>确认影响</Button>} />; break; }
  }
  let drawerBody: React.ReactNode = <List dataSource={rows} locale={{emptyText:"没有详情"}} renderItem={row=><List.Item><List.Item.Meta title={String(row.values?.[titleRef ?? ""] ?? row.id)} description={String(row.values?.[messageRef ?? statusRef ?? ""] ?? "暂无描述")} /></List.Item>} />;
  if (variant === "notifications") drawerBody = <List dataSource={rows} renderItem={row=><List.Item actions={[status(row)==="unread"?<Button key="read" type="link" onClick={()=>submit("markNotificationRead",{rowId:row.id})}>标为已读</Button>:null]}><List.Item.Meta title={String(row.values?.[titleRef ?? ""] ?? row.id)} description={String(row.values?.[messageRef ?? ""] ?? status(row))} /></List.Item>} />;
  if (variant === "filterPreset") drawerBody = <Space direction="vertical" style={{width:"100%"}}><Select value={preset} placeholder="选择预设" options={rows.map(row=>({value:row.id,label:String(row.values?.[titleRef ?? ""] ?? row.id)}))} onChange={setPreset} /><Button type="primary" block disabled={!preset} onClick={()=>{onAction?.("filterChange",{presetId:preset,targets:targetIdsOf(block)});setOpen(false)}}>应用筛选</Button></Space>;
  if (variant === "exportJob") drawerBody = <List dataSource={rows} renderItem={row=><List.Item actions={[status(row)==="completed"?<Button key="download" type="link" onClick={()=>onAction?.("actionTrigger",{entityRef:bound.entityRef,rowId:row.id,operation:"downloadExport",targets:targetIdsOf(block)})}>下载</Button>:<Button key="cancel" type="link" danger disabled={status(row)!=="running"} onClick={()=>submit("cancelExport",{rowId:row.id})}>取消</Button>]}><List.Item.Meta title={String(row.values?.[titleRef ?? ""] ?? row.id)} description={status(row)||"等待中"} /></List.Item>} />;
  if (variant === "contextHelp") drawerBody = <Space direction="vertical" style={{width:"100%"}}><Input.Search placeholder="搜索当前页面帮助" value={query} onChange={e=>setQuery(e.target.value)} onSearch={value=>onAction?.("actionTrigger",{entityRef:bound.entityRef,operation:"searchContextHelp",query:value,targets:targetIdsOf(block)})} /><List dataSource={filtered} renderItem={row=><List.Item><List.Item.Meta title={String(row.values?.[titleRef ?? ""] ?? row.id)} description={String(row.values?.[messageRef ?? ""] ?? "")} /></List.Item>} /></Space>;
  return <BlockShell block={block} title={String(block.props?.title ?? CONTEXT_TITLES[variant])} testid={`context-panel-${variant}`}>{content}<Drawer open={open} onClose={()=>setOpen(false)} title={CONTEXT_TITLES[variant]} width={520}>{drawerBody}</Drawer></BlockShell>;
};
const KeyboardCommandPaletteRenderer=ContextPanelRenderer("palette"); const ExportJobDrawerRenderer=ContextPanelRenderer("exportJob"); const CompareSelectionTrayRenderer=ContextPanelRenderer("compare"); const DetailInspectorDrawerRenderer=ContextPanelRenderer("inspector"); const HelpContextPanelRenderer=ContextPanelRenderer("help"); const AuditDiffDrawerRenderer=ContextPanelRenderer("audit"); const SavedSearchPanelRenderer=ContextPanelRenderer("savedSearch"); const RecentItemsPanelRenderer=ContextPanelRenderer("recent"); const RelatedEntityPanelRenderer=ContextPanelRenderer("related"); const PermissionSummaryPanelRenderer=ContextPanelRenderer("permission"); const SelectionInspectorRenderer=ContextPanelRenderer("selection"); const ValidationIssuePanelRenderer=ContextPanelRenderer("validation"); const ContextHelpDrawerRenderer=ContextPanelRenderer("contextHelp"); const ChangeImpactPanelRenderer=ContextPanelRenderer("impact");

/**
 * ── 区块定义表：**一条记录 = 一个组件**（2026-08-08 重做）───────────────
 *
 * ## 为什么重做
 *
 * 用户要把组件从十几个扩到三五百个。而在此之前，**每加一个组件要手写 8 处**：
 * 目录 JSON、渲染器、注册表、组件库示例数据、HAS_DEMO、IMPL_BY_TYPE、
 * ssot 放开哨兵、手机档名单。14 个时这套很好（每一处都在防漂移，真拦下过
 * 三次）；500 × 8 = 4000 处，它就从护栏变路障了。
 *
 * ## 照着谁改的
 *
 * measuredco/puck 的 ComponentConfig（packages/core/types/Config.tsx）：
 *
 *     components: { [name]: { render, label, fields, defaultProps,
 *                             metadata, permissions, resolveFields, … } }
 *
 * 渲染器与它的全部元信息装在同一个对象里，加组件就是加一条，**没有第二处
 * 名单要同步**。这里照抄这个形状。
 *
 * ## 与 Puck 的一处必要偏离
 *
 * Puck 能把契约也塞进这个对象，因为它只有 TS 一边。我们的契约要跨语言——
 * Python 侧拿 propsSchema/bindingSchema 拼 prompt、跑门禁，
 * experience_block_catalog.json 是两边的共同真相源，挪不进 TS。
 *
 * 所以这里只收**渲染这一侧**的东西（render / phone / demo / impl / label），
 * 契约仍在那份 JSON 里。8 处于是收敛成 2 处，并由
 * ssot-parity 的对账用例钉住两边不许漂。
 *
 * 将来目录从数据库生成时，这个形状不用变。
 */
export interface BlockDefinition {
  /** 桌面渲染器 */
  render: ExperienceBlockRenderer;
  /**
   * ## `uses` 已删除（2026-08-10）
   *
   * 这里曾有一个手写的 `uses: string[]`，声明"这个区块由哪些基础组件组装
   * 而成"。删掉它的理由不是它不重要，恰恰相反——是**它答不上这个问题**。
   *
   * 给 316 个区块逐条对账（生成器的 desktopDeclarationMismatches）：
   *
   *     316 个区块，**全部**与实际渲染的不一致
   *     84 条声称用了却根本没渲染   974 条渲染了却没声称
   *
   * 具体到能看的例子：CardGridList 声称 `Image` 而渲染器里是个裸 `<img>`；
   * FilterBar 声称 `Button/DatePicker/Select`，实际用的是
   * `QueryFilter/ProFormSelect/ProFormDateRangePicker`（ProForm 化那次升级
   * 之后没人回来改声明）；14 个上下文摘要声称 `Descriptions`，早就换成
   * ProDescriptions 了。
   *
   * ## 为什么是删掉，而不是"改成自动派生"
   *
   * 派生的话，产物是一份**和 block-component-usage.json 一模一样的副本**，
   * 只不过住在一个手能改的文件里。第二份拷贝正是漂移的成因——这个字段的
   * 全部历史就是在证明这件事。
   *
   * 而且它**没有任何生产代码在读**：组件库页面早就改成读依赖图了（见
   * ComponentsLibraryPage 顶部那段"组件反查来自真实渲染器依赖图，不再读取
   * 仅覆盖部分桌面组件的手写 uses"），Python 侧的 `uses` 是区块**提案**的
   * 字段（block_proposer 让模型提议新区块时说它要用什么），跟这里无关。
   * 读它的只剩三处测试，现在都改成读依赖图——那是从渲染器 AST 生成的，
   * 断言的是事实而不是意图。
   *
   * 要查"这个区块用了哪些基础组件"，问 `usageForBlock(type)`。
   */
  /** 中文名。目录 JSON 只有 description，缺一个短标题（lowcode-engine 的 title） */
  label: string;
  /**
   * 手机档有没有自己的渲染器。此前是 PhoneExperienceBlock 里另一张手写名单，
   * 与这里对不上时没有任何东西会报错——手机档会静静地拿桌面渲染器顶上。
   */
  phone?: boolean;
}

/** 目录里有、但渲染侧还没登记的类型会被 ssot 对账当场抓出来。 */
export const BLOCK_DEFINITIONS: Readonly<Record<string, BlockDefinition>> =
  Object.freeze({
    MetricGrid: { render: MetricGridRenderer, label: "指标卡", phone: true },
    TrendChart: { render: TrendChartRenderer, label: "趋势图" },
    ProportionPie: { render: ProportionPieRenderer, label: "占比环图" },
    RankedList: { render: RankedListRenderer, label: "排行榜" },
    ActivityFeed: { render: ActivityFeedRenderer, label: "动态流" },
    DataTable: { render: DataTableRenderer, label: "数据表格" },
    CardGridList: { render: CardGridListRenderer, label: "卡片网格" },
    StandardListRows: { render: StandardListRowsRenderer, label: "标准列表行" },
    QuickActionPanel: { render: QuickActionPanelRenderer, label: "快捷操作", phone: true },
    FilterBar: { render: FilterBarRenderer, label: "筛选条", phone: true },
    TagFilterRow: { render: TagFilterRowRenderer, label: "标签筛选行" },
    SearchBox: { render: SearchBoxRenderer, label: "搜索框" },
    WorkflowTimeline: { render: WorkflowTimelineRenderer, label: "流程条", phone: true },
    FreeformInsight: { render: FreeformInsightRenderer, label: "自由版式" },
    RecordForm: { render: RecordFormRenderer, label: "记录表单" },
    RecordFormDialog: { render: RecordFormDialogRenderer, label: "弹层表单" },
    RecordDetail: { render: RecordDetailRenderer, label: "记录详情" },
    SectionedForm: { render: SectionedFormRenderer, label: "分段表单" },
    StepsForm: { render: StepsFormRenderer, label: "分步表单" },
    EditableSubTable: { render: EditableSubTableRenderer, label: "可编辑子表" },
    ContentCard: { render: ContentCardRenderer, label: "内容卡片" },
    PageHeader: { render: PageHeaderRenderer, label: "页面头" },
    ResultPanel: { render: ResultPanelRenderer, label: "结果屏" },
    StatusTabs: { render: StatusTabsRenderer, label: "状态切换栏" },
    BatchActionBar: { render: BatchActionBarRenderer, label: "批量操作栏" },
    ColumnSettingPanel: { render: ColumnSettingPanelRenderer, label: "列设置" },
    AttachmentPanel: { render: AttachmentPanelRenderer, label: "附件面板", phone: true },
    CommentThread: { render: CommentThreadRenderer, label: "讨论线程", phone: true },
    RecordPicker: { render: RecordPickerRenderer, label: "记录选择器", phone: true },
    KanbanBoard: { render: KanbanBoardRenderer, label: "状态看板", phone: true },
    ScheduleCalendar: { render: ScheduleCalendarRenderer, label: "日程日历", phone: true },
    NotificationInbox: { render: NotificationInboxRenderer, label: "通知收件箱", phone: true },
    TreeNavigator: { render: TreeNavigatorRenderer, label: "层级导航", phone: true },
    ApprovalQueue: { render: ApprovalQueueRenderer, label: "审批队列", phone: true },
    AuditTrail: { render: AuditTrailRenderer, label: "审计记录", phone: true },
    DataImportWizard: { render: DataImportWizardRenderer, label: "数据导入向导", phone: true },
    AsyncTaskMonitor: { render: AsyncTaskMonitorRenderer, label: "异步任务监控", phone: true },
    PermissionMatrix: { render: PermissionMatrixRenderer, label: "权限矩阵", phone: true },
    DataExportPanel: { render: DataExportPanelRenderer, label: "数据导出面板", phone: true },
    BulkEditPanel: { render: BulkEditPanelRenderer, label: "批量编辑面板", phone: true },
    MemberAssignment: { render: MemberAssignmentRenderer, label: "成员分配器", phone: true },
    ContextBreadcrumb: { render: ContextBreadcrumbRenderer, label: "上下文路径", phone: true },
    LiveRefreshControl: { render: LiveRefreshControlRenderer, label: "实时刷新控制", phone: true },
    ActiveFilterSummary: { render: ActiveFilterSummaryRenderer, label: "已生效条件摘要", phone: true },
    AnalyticsDateScope: { render: AnalyticsDateScopeRenderer, label: "分析时间口径", phone: true },
    HeaderEntitySummary: { render: HeaderEntitySummaryRenderer, label: "页头实体摘要", phone: true },
    HeaderProgressSummary: { render: HeaderProgressSummaryRenderer, label: "页头进度摘要", phone: true },
    WorkspaceTabs: { render: WorkspaceTabsRenderer, label: "工作上下文页签", phone: true },
    SavedViewTabs: { render: SavedViewTabsRenderer, label: "保存视图页签", phone: true },
    AdvancedFilterBuilder: { render: AdvancedFilterBuilderRenderer, label: "高级条件构建器", phone: true },
    FacetedFilterPanel: { render: FacetedFilterPanelRenderer, label: "分面筛选面板", phone: true },
    WizardNavigationBar: { render: WizardNavigationBarRenderer, label: "向导导航栏", phone: true },
    ApprovalDecisionBar: { render: ApprovalDecisionBarRenderer, label: "审批决策栏", phone: true },
    CheckoutSummaryBar: { render: CheckoutSummaryBarRenderer, label: "结算确认栏", phone: true },
    RecordLifecycleBar: { render: RecordLifecycleBarRenderer, label: "记录生命周期栏", phone: true },
    WaterfallChart: { render: WaterfallChartRenderer, label: "瀑布分析图", phone: true },
    FunnelChart: { render: FunnelChartRenderer, label: "转化漏斗图", phone: true },
    DistributionHistogram: { render: DistributionHistogramRenderer, label: "分布直方图", phone: true },
    HeatmapMatrix: { render: HeatmapMatrixRenderer, label: "热力矩阵", phone: true },
    TreemapBreakdown: { render: TreemapBreakdownRenderer, label: "层级构成图", phone: true },
    GaugeProgress: { render: GaugeProgressRenderer, label: "目标完成仪表", phone: true },
    AlertTriagePanel: { render: AlertTriagePanelRenderer, label: "告警分诊台", phone: true },
    AlertSilenceForm: { render: AlertSilenceFormRenderer, label: "告警静默表单", phone: true },
    AlertRoutingPolicy: { render: AlertRoutingPolicyRenderer, label: "告警路由策略", phone: true },
    DeletedRecordsRecovery: { render: DeletedRecordsRecoveryRenderer, label: "已删除记录恢复", phone: true },
    RevisionHistoryPanel: { render: RevisionHistoryPanelRenderer, label: "修订历史", phone: true },
    RecordComparePanel: { render: RecordComparePanelRenderer, label: "记录对比", phone: true },
    GanttSchedule: { render: GanttScheduleRenderer, label: "甘特排期", phone: true },
    SankeyFlow: { render: SankeyFlowRenderer, label: "关系流向", phone: true },
    BoxPlotDistribution: { render: BoxPlotDistributionRenderer, label: "箱线分布", phone: true },
    RadarComparison: { render: RadarComparisonRenderer, label: "雷达对比", phone: true },
    AlertRuleEditor: { render: AlertRuleEditorRenderer, label: "告警规则编辑器", phone: true },
    MuteTimingSchedule: { render: MuteTimingScheduleRenderer, label: "静默时段计划", phone: true },
    ContactPointManager: { render: ContactPointManagerRenderer, label: "通知联络点", phone: true },
    ReferenceManyManager: { render: ReferenceManyManagerRenderer, label: "关联记录管理", phone: true },
    GlobalSearchPalette: { render: GlobalSearchPaletteRenderer, label: "全局搜索面板", phone: true },
    LiveChangeReview: { render: LiveChangeReviewRenderer, label: "实时变更审查", phone: true },
    AvailabilityPlanner: { render: AvailabilityPlannerRenderer, label: "可用时间计划", phone: true },
    BookingSlotPicker: { render: BookingSlotPickerRenderer, label: "预约时段选择", phone: true },
    ScheduleConflictResolver: { render: ScheduleConflictResolverRenderer, label: "排期冲突解析", phone: true },
    StackTracePanel: { render: StackTracePanelRenderer, label: "异常堆栈", phone: true },
    EventBreadcrumbTimeline: { render: EventBreadcrumbTimelineRenderer, label: "事件轨迹", phone: true },
    SuspectCommitPanel: { render: SuspectCommitPanelRenderer, label: "可疑提交", phone: true },
    ConnectionTimeline: { render: ConnectionTimelineRenderer, label: "连接时间线", phone: true },
    SchemaChangeReview: { render: SchemaChangeReviewRenderer, label: "Schema 变更审查", phone: true },
    StreamStatusMonitor: { render: StreamStatusMonitorRenderer, label: "数据流状态监控", phone: true },
    ConnectionMappingPanel: { render: ConnectionMappingPanelRenderer, label: "连接字段映射", phone: true },
    IssueCommandHeader: { render: IssueCommandHeaderRenderer, label: "问题操作页头", phone: true },
    ConnectionControlHeader: { render: ConnectionControlHeaderRenderer, label: "连接控制页头", phone: true },
    EventUserCountMetrics: { render: EventUserCountMetricsRenderer, label: "事件用户指标", phone: true },
    JobRunMetrics: { render: JobRunMetricsRenderer, label: "任务运行指标", phone: true },
    OccurrenceEvidenceSummary: { render: OccurrenceEvidenceSummaryRenderer, label: "发生证据摘要", phone: true },
    ConnectionRouteSummary: { render: ConnectionRouteSummaryRenderer, label: "连接路径摘要", phone: true },
    InspectorModeTabs: { render: InspectorModeTabsRenderer, label: "检查器模式页签", phone: true },
    IssueEventFilter: { render: IssueEventFilterRenderer, label: "问题事件筛选", phone: true },
    TimelineFilterBar: { render: TimelineFilterBarRenderer, label: "时间线筛选栏", phone: true },
    UnsavedChangesBar: { render: UnsavedChangesBarRenderer, label: "未保存变更栏", phone: true },
    RunningJobControlBar: { render: RunningJobControlBarRenderer, label: "运行任务控制栏", phone: true },
    BookingCommandHeader: { render: BookingCommandHeaderRenderer, label: "预约操作页头", phone: true },
    AlertRuleCommandHeader: { render: AlertRuleCommandHeaderRenderer, label: "告警规则操作页头", phone: true },
    AlertStateMetrics: { render: AlertStateMetricsRenderer, label: "告警状态指标", phone: true },
    BookingCapacityMetrics: { render: BookingCapacityMetricsRenderer, label: "预约容量指标", phone: true },
    BookingContextSummary: { render: BookingContextSummaryRenderer, label: "预约上下文摘要", phone: true },
    AlertInstanceSummary: { render: AlertInstanceSummaryRenderer, label: "告警实例摘要", phone: true },
    BookingStatusTabs: { render: BookingStatusTabsRenderer, label: "预约生命周期页签", phone: true },
    ValidatedFormTabs: { render: ValidatedFormTabsRenderer, label: "带校验表单页签", phone: true },
    AlertMatcherFilter: { render: AlertMatcherFilterRenderer, label: "告警标签匹配", phone: true },
    BookingDirectoryFilter: { render: BookingDirectoryFilterRenderer, label: "预约目录筛选", phone: true },
    BookingDecisionBar: { render: BookingDecisionBarRenderer, label: "预约确认决策栏", phone: true },
    DashboardSaveBar: { render: DashboardSaveBarRenderer, label: "Dashboard 保存栏", phone: true },
    WorkItemCommandHeader: { render: WorkItemCommandHeaderRenderer, label: "工作项操作页头", phone: true },
    DocumentCommandHeader: { render: DocumentCommandHeaderRenderer, label: "文档操作页头", phone: true },
    EnvironmentStatusStrip: { render: EnvironmentStatusStripRenderer, label: "环境状态条", phone: true },
    DataFreshnessIndicator: { render: DataFreshnessIndicatorRenderer, label: "数据新鲜度", phone: true },
    WorkItemContextSummary: { render: WorkItemContextSummaryRenderer, label: "工作项上下文摘要", phone: true },
    DashboardParameterBar: { render: DashboardParameterBarRenderer, label: "Dashboard 参数栏", phone: true },
    CycleHealthMetrics: { render: CycleHealthMetricsRenderer, label: "周期健康指标", phone: true },
    QueryExecutionMetrics: { render: QueryExecutionMetricsRenderer, label: "查询执行指标", phone: true },
    BulkSelectionBar: { render: BulkSelectionBarRenderer, label: "批量选择操作栏", phone: true },
    DraftPublishBar: { render: DraftPublishBarRenderer, label: "草稿发布栏", phone: true },
    QuestionCommandHeader: { render: QuestionCommandHeaderRenderer, label: "问题操作页头", phone: true },
    CatalogEntityCommandHeader: { render: CatalogEntityCommandHeaderRenderer, label: "目录实体页头", phone: true },
    CollaboratorPresenceStrip: { render: CollaboratorPresenceStripRenderer, label: "协作者在线状态", phone: true },
    QueryRunStatusStrip: { render: QueryRunStatusStripRenderer, label: "查询运行状态", phone: true },
    EntityOwnershipSummary: { render: EntityOwnershipSummaryRenderer, label: "实体所有权摘要", phone: true },
    QueryDataSourceSummary: { render: QueryDataSourceSummaryRenderer, label: "查询数据源摘要", phone: true },
    QueryClauseFilterBar: { render: QueryClauseFilterBarRenderer, label: "查询条件栏", phone: true },
    MetadataQualityMetrics: { render: MetadataQualityMetricsRenderer, label: "元数据质量指标", phone: true },
    QuestionExecutionBar: { render: QuestionExecutionBarRenderer, label: "查询执行栏", phone: true },
    CycleCommandHeader: { render: CycleCommandHeaderRenderer, label: "周期操作页头", phone: true },
    AlertGroupCommandHeader: { render: AlertGroupCommandHeaderRenderer, label: "规则组操作页头", phone: true },
    IncidentOwnershipStrip: { render: IncidentOwnershipStripRenderer, label: "事故归属状态", phone: true },
    SyncScheduleStrip: { render: SyncScheduleStripRenderer, label: "同步计划状态", phone: true },
    CycleFilterBar: { render: CycleFilterBarRenderer, label: "周期筛选栏", phone: true },
    AlertRuleFilterBar: { render: AlertRuleFilterBarRenderer, label: "告警规则筛选", phone: true },
    SyncReliabilityMetrics: { render: SyncReliabilityMetricsRenderer, label: "同步可靠性指标", phone: true },
    RuleEvaluationMetrics: { render: RuleEvaluationMetricsRenderer, label: "规则评估指标", phone: true },
    EventTypePublishBar: { render: EventTypePublishBarRenderer, label: "事件类型发布栏", phone: true },
    ConversationCommandHeader: { render: ConversationCommandHeaderRenderer, label: "会话操作页头", phone: true },
    UserCommandHeader: { render: UserCommandHeaderRenderer, label: "用户操作页头", phone: true },
    ConversationAssignmentStrip: { render: ConversationAssignmentStripRenderer, label: "会话分配状态", phone: true },
    RealmStatusStrip: { render: RealmStatusStripRenderer, label: "Realm 状态", phone: true },
    UserDirectoryFilter: { render: UserDirectoryFilterRenderer, label: "用户目录筛选", phone: true },
    ConversationSlaMetrics: { render: ConversationSlaMetricsRenderer, label: "会话 SLA 指标", phone: true },
    ConversationReplyBar: { render: ConversationReplyBarRenderer, label: "会话回复栏", phone: true },
    UserAccessBar: { render: UserAccessBarRenderer, label: "用户访问控制栏", phone: true },
    TimeSeriesAnomalyChart: { render: TimeSeriesAnomalyChartRenderer, label: "时序异常图", phone: true },
    CohortRetentionChart: { render: CohortRetentionChartRenderer, label: "留存队列图", phone: true },
    UptimeStatusTimeline: { render: UptimeStatusTimelineRenderer, label: "可用性时间线", phone: true },
    PercentileBandChart: { render: PercentileBandChartRenderer, label: "分位带趋势", phone: true },
    ConnectionFleetMetrics: { render: ConnectionFleetMetricsRenderer, label: "连接群组指标", phone: true },
    IssueImpactMetrics: { render: IssueImpactMetricsRenderer, label: "问题影响指标", phone: true },
    ReleaseHealthStrip: { render: ReleaseHealthStripRenderer, label: "发布健康状态", phone: true },
    DashboardCommandHeader: { render: DashboardCommandHeaderRenderer, label: "Dashboard 操作页头", phone: true },
    DeploymentLatencyChart: { render: DeploymentLatencyChartRenderer, label: "部署延迟趋势", phone: true },
    ReleaseAdoptionTrendChart: { render: ReleaseAdoptionTrendChartRenderer, label: "发布采用趋势", phone: true },
    DeploymentRolloutMetrics: { render: DeploymentRolloutMetricsRenderer, label: "部署滚动指标", phone: true },
    ReleaseAdoptionMetrics: { render: ReleaseAdoptionMetricsRenderer, label: "发布采用指标", phone: true },
    ClusterHealthStrip: { render: ClusterHealthStripRenderer, label: "集群健康状态", phone: true },
    ReleaseEnvironmentStrip: { render: ReleaseEnvironmentStripRenderer, label: "发布环境状态", phone: true },
    DeploymentCommandHeader: { render: DeploymentCommandHeaderRenderer, label: "部署操作页头", phone: true },
    FeatureFlagCommandHeader: { render: FeatureFlagCommandHeaderRenderer, label: "Feature Flag 操作页头", phone: true },
    DeploymentScaleBar: { render: DeploymentScaleBarRenderer, label: "部署扩缩容栏", phone: true },
    ReleaseRolloutBar: { render: ReleaseRolloutBarRenderer, label: "发布灰度栏", phone: true },
    CumulativeFlowChart: { render: CumulativeFlowChartRenderer, label: "累计流图", phone: true },
    BookingDemandChart: { render: BookingDemandChartRenderer, label: "预约需求趋势", phone: true },
    CycleRiskStrip: { render: CycleRiskStripRenderer, label: "周期风险状态", phone: true },
    WorkItemMoveDrawer: { render: WorkItemMoveDrawerRenderer, label: "工作项移动抽屉", phone: true },
    BookingConflictDrawer: { render: BookingConflictDrawerRenderer, label: "预约冲突抽屉", phone: true },
    WorkflowDurationChart: { render: WorkflowDurationChartRenderer, label: "工作流耗时趋势", phone: true },
    WorkflowOutcomeMetrics: { render: WorkflowOutcomeMetricsRenderer, label: "工作流结果指标", phone: true },
    WorkflowVersionStrip: { render: WorkflowVersionStripRenderer, label: "工作流版本状态", phone: true },
    WorkflowFailureDrawer: { render: WorkflowFailureDrawerRenderer, label: "工作流失败诊断", phone: true },
    WorkflowCommandHeader: { render: WorkflowCommandHeaderRenderer, label: "工作流操作页头", phone: true },
    WorkflowControlBar: { render: WorkflowControlBarRenderer, label: "工作流执行控制栏", phone: true },
    RealmCommandHeader: { render: RealmCommandHeaderRenderer, label: "Realm 操作页头", phone: true },
    CredentialLifecycleBar: { render: CredentialLifecycleBarRenderer, label: "凭据生命周期栏", phone: true },
    PanelQueryLatencyChart: { render: PanelQueryLatencyChartRenderer, label: "面板查询延迟", phone: true },
    SyncVolumeTrendChart: { render: SyncVolumeTrendChartRenderer, label: "同步数据量趋势", phone: true },
    DatasourceQueryMetrics: { render: DatasourceQueryMetricsRenderer, label: "数据源查询指标", phone: true },
    StreamFreshnessMetrics: { render: StreamFreshnessMetricsRenderer, label: "数据流新鲜度", phone: true },
    PanelCommandHeader: { render: PanelCommandHeaderRenderer, label: "面板操作页头", phone: true },
    ExploreQueryControlBar: { render: ExploreQueryControlBarRenderer, label: "Explore 查询控制栏", phone: true },
    QueryErrorDrawer: { render: QueryErrorDrawerRenderer, label: "查询错误抽屉", phone: true },
    SchemaConflictDrawer: { render: SchemaConflictDrawerRenderer, label: "Schema 冲突抽屉", phone: true },
    SwimlaneKanban: { render: SwimlaneKanbanRenderer, label: "泳道看板", phone: true },
    WipLimitBoard: { render: WipLimitBoardRenderer, label: "WIP 限制看板", phone: true },
    DependencyKanban: { render: DependencyKanbanRenderer, label: "依赖看板", phone: true },
    ContentPipelineBoard: { render: ContentPipelineBoardRenderer, label: "内容流水线看板", phone: true },
    IncidentResponseBoard: { render: IncidentResponseBoardRenderer, label: "事件响应看板", phone: true },
    PortfolioKanban: { render: PortfolioKanbanRenderer, label: "项目组合看板", phone: true },
    SavedViewManager: { render: SavedViewManagerRenderer, label: "保存视图管理", phone: true },
    ColumnChooserDrawer: { render: ColumnChooserDrawerRenderer, label: "列选择抽屉", phone: true },
    ActivityContextDrawer: { render: ActivityContextDrawerRenderer, label: "活动上下文抽屉", phone: true },
    BulkActionTray: { render: BulkActionTrayRenderer, label: "批量操作托盘", phone: true },
    OnboardingChecklistWizard: { render: OnboardingChecklistWizardRenderer, label: "入职检查向导", phone: true },
    ImportMappingWizard: { render: ImportMappingWizardRenderer, label: "导入映射向导", phone: true },
    ResourceBookingCalendar: { render: ResourceBookingCalendarRenderer, label: "资源预约日历", phone: true },
    DeadlineAgenda: { render: DeadlineAgendaRenderer, label: "截止事项议程", phone: true },
    BookingConflictPanel: { render: BookingConflictPanelRenderer, label: "预约冲突面板", phone: true },
    ScheduleCapacityHeatmap: { render: ScheduleCapacityHeatmapRenderer, label: "排期容量热力图", phone: true },
    EventRsvpPanel: { render: EventRsvpPanelRenderer, label: "活动 RSVP 面板", phone: true },
    RecurrenceEditor: { render: RecurrenceEditorRenderer, label: "重复规则编辑器", phone: true },
    DeploymentWizard: { render: DeploymentWizardRenderer, label: "部署向导", phone: true },
    OnCallScheduleCalendar: { render: OnCallScheduleCalendarRenderer, label: "值班日历", phone: true },
    AppointmentWaitlistPanel: { render: AppointmentWaitlistPanelRenderer, label: "预约候补面板", phone: true },
    AvailabilityOverridePanel: { render: AvailabilityOverridePanelRenderer, label: "可用时间覆盖面板", phone: true },
    TimezoneOverlapPanel: { render: TimezoneOverlapPanelRenderer, label: "时区重叠面板", phone: true },
    SchedulePublishBar: { render: SchedulePublishBarRenderer, label: "排期发布栏", phone: true },
    RescheduleRequestDrawer: { render: RescheduleRequestDrawerRenderer, label: "改期请求抽屉", phone: true },
    KeyboardCommandPalette: { render: KeyboardCommandPaletteRenderer, label: "键盘命令面板", phone: true },
    ExportJobDrawer: { render: ExportJobDrawerRenderer, label: "导出任务抽屉", phone: true },
    CompareSelectionTray: { render: CompareSelectionTrayRenderer, label: "对比选择托盘", phone: true },
    DetailInspectorDrawer: { render: DetailInspectorDrawerRenderer, label: "详情检查抽屉", phone: true },
    HelpContextPanel: { render: HelpContextPanelRenderer, label: "帮助上下文面板", phone: true },
    AuditDiffDrawer: { render: AuditDiffDrawerRenderer, label: "审计差异抽屉", phone: true },
    SavedSearchPanel: { render: SavedSearchPanelRenderer, label: "保存搜索面板", phone: true },
    RecentItemsPanel: { render: RecentItemsPanelRenderer, label: "最近项目面板", phone: true },
    RelatedEntityPanel: { render: RelatedEntityPanelRenderer, label: "关联实体面板", phone: true },
    PermissionSummaryPanel: { render: PermissionSummaryPanelRenderer, label: "权限摘要面板", phone: true },
    SelectionInspector: { render: SelectionInspectorRenderer, label: "选择检查器", phone: true },
    ValidationIssuePanel: { render: ValidationIssuePanelRenderer, label: "校验问题面板", phone: true },
    ContextHelpDrawer: { render: ContextHelpDrawerRenderer, label: "上下文帮助抽屉", phone: true },
    ChangeImpactPanel: { render: ChangeImpactPanelRenderer, label: "变更影响面板", phone: true },
    FunnelConversionChart: { render: ANALYSIS_DEPENDENCY_RENDERERS.FunnelConversionChart, label: "漏斗转化图", phone: true },
    HistogramDistributionChart: { render: ANALYSIS_DEPENDENCY_RENDERERS.HistogramDistributionChart, label: "分布直方图（增强）", phone: true },
    ScatterCorrelationChart: { render: ANALYSIS_DEPENDENCY_RENDERERS.ScatterCorrelationChart, label: "散点相关图", phone: true },
    BoxPlotDistributionChart: { render: ANALYSIS_DEPENDENCY_RENDERERS.BoxPlotDistributionChart, label: "箱线分布图", phone: true },
    WaterfallVarianceChart: { render: ANALYSIS_DEPENDENCY_RENDERERS.WaterfallVarianceChart, label: "瀑布差异图", phone: true },
    ForecastConfidenceChart: { render: ANALYSIS_DEPENDENCY_RENDERERS.ForecastConfidenceChart, label: "预测置信带", phone: true },
    BurnupChart: { render: ANALYSIS_DEPENDENCY_RENDERERS.BurnupChart, label: "燃尽增长图", phone: true },
    BurndownChart: { render: ANALYSIS_DEPENDENCY_RENDERERS.BurndownChart, label: "燃尽图", phone: true },
    ErrorBudgetGauge: { render: ANALYSIS_DEPENDENCY_RENDERERS.ErrorBudgetGauge, label: "错误预算仪表", phone: true },
    ServiceMapPanel: { render: ANALYSIS_DEPENDENCY_RENDERERS.ServiceMapPanel, label: "服务拓扑面板", phone: true },
    DependencyGraphPanel: { render: ANALYSIS_DEPENDENCY_RENDERERS.DependencyGraphPanel, label: "依赖关系图", phone: true },
    QueryResultPivot: { render: ANALYSIS_DEPENDENCY_RENDERERS.QueryResultPivot, label: "查询结果透视", phone: true },
    MetricComparisonPanel: { render: ANALYSIS_DEPENDENCY_RENDERERS.MetricComparisonPanel, label: "指标对比面板", phone: true },
    ...Object.fromEntries(
      Object.entries(CONFIGURATION_WIZARD_POLICIES).map(([type, policy]) => [
        type,
        {
          render: CONFIGURATION_WIZARD_RENDERERS[type],
          label: policy.title,
          phone: true,
        },
      ])
    ),
    ...Object.fromEntries(
      Object.entries(COLLABORATION_CONTENT_RENDERERS).map(([type, render]) => [
        type,
        { render, label: COLLABORATION_CONTENT_LABELS[type], phone: true },
      ])
    ),
    ...Object.fromEntries(
      Object.entries(DATA_GOVERNANCE_RENDERERS).map(([type, render]) => [
        type,
        { render, label: DATA_GOVERNANCE_LABELS[type], phone: true },
      ])
    ),
    ...Object.fromEntries(
      Object.entries(HIERARCHY_SELECTION_RENDERERS).map(([type, render]) => [
        type,
        { render, label: HIERARCHY_SELECTION_LABELS[type], phone: true },
      ])
    ),
    SignatureFieldCanvas: { render: SignatureFieldCanvasRenderer, label: INDEPENDENT_STRUCTURE_LABELS.SignatureFieldCanvas, phone: true },
    AlertGroupAccordion: { render: AlertGroupAccordionRenderer, label: INDEPENDENT_STRUCTURE_LABELS.AlertGroupAccordion, phone: true },
    EvidenceCollectionWorkspace: { render: EvidenceCollectionWorkspaceRenderer, label: INDEPENDENT_STRUCTURE_LABELS.EvidenceCollectionWorkspace, phone: true },
    AssetReviewLightbox: { render: AssetReviewLightboxRenderer, label: INDEPENDENT_STRUCTURE_LABELS.AssetReviewLightbox, phone: true },
    PaymentAllocationWorkbench: { render: PaymentAllocationWorkbenchRenderer, label: INDEPENDENT_STRUCTURE_LABELS.PaymentAllocationWorkbench, phone: true },
    DeploymentRolloutTrack: { render: DeploymentRolloutTrackRenderer, label: INDEPENDENT_STRUCTURE_LABELS.DeploymentRolloutTrack, phone: true },
    WorkflowNodeDebugger: { render: WorkflowNodeDebuggerRenderer, label: INDEPENDENT_STRUCTURE_BATCH2_LABELS.WorkflowNodeDebugger, phone: true },
    QueryNotebookComposer: { render: QueryNotebookComposerRenderer, label: INDEPENDENT_STRUCTURE_BATCH2_LABELS.QueryNotebookComposer, phone: true },
    WarehouseBinHeatmap: { render: WarehouseBinHeatmapRenderer, label: INDEPENDENT_STRUCTURE_BATCH2_LABELS.WarehouseBinHeatmap, phone: true },
    ExperimentTrafficAllocator: { render: ExperimentTrafficAllocatorRenderer, label: INDEPENDENT_STRUCTURE_BATCH2_LABELS.ExperimentTrafficAllocator, phone: true },
    SlaBreachClock: { render: SlaBreachClockRenderer, label: INDEPENDENT_STRUCTURE_BATCH2_LABELS.SlaBreachClock, phone: true },
    WarehousePickRouteScanner: { render: WarehousePickRouteScannerRenderer, label: INDEPENDENT_STRUCTURE_BATCH2_LABELS.WarehousePickRouteScanner, phone: true },
    ResumableUploadQueue: { render: ResumableUploadQueueRenderer, label: INDEPENDENT_STRUCTURE_BATCH3_LABELS.ResumableUploadQueue, phone: true },
    DistributedTraceWaterfall: { render: DistributedTraceWaterfallRenderer, label: INDEPENDENT_STRUCTURE_BATCH3_LABELS.DistributedTraceWaterfall, phone: true },
    ExpressionDataMapper: { render: ExpressionDataMapperRenderer, label: INDEPENDENT_STRUCTURE_BATCH3_LABELS.ExpressionDataMapper, phone: true },
    SessionReplayScrubber: { render: SessionReplayScrubberRenderer, label: INDEPENDENT_STRUCTURE_BATCH3_LABELS.SessionReplayScrubber, phone: true },
    DashboardGridComposer: { render: DashboardGridComposerRenderer, label: INDEPENDENT_STRUCTURE_BATCH3_LABELS.DashboardGridComposer, phone: true },
    LiveLogTailer: { render: LiveLogTailerRenderer, label: INDEPENDENT_STRUCTURE_BATCH3_LABELS.LiveLogTailer, phone: true },
    FlameGraphProfiler: { render: FlameGraphProfilerRenderer, label: INDEPENDENT_STRUCTURE_BATCH4_LABELS.FlameGraphProfiler, phone: true },
    ThreeWayMergeResolver: { render: ThreeWayMergeResolverRenderer, label: INDEPENDENT_STRUCTURE_BATCH4_LABELS.ThreeWayMergeResolver, phone: true },
    PolicyDecisionSimulator: { render: PolicyDecisionSimulatorRenderer, label: INDEPENDENT_STRUCTURE_BATCH4_LABELS.PolicyDecisionSimulator, phone: true },
    FormCanvasBuilder: { render: FormCanvasBuilderRenderer, label: INDEPENDENT_STRUCTURE_BATCH4_LABELS.FormCanvasBuilder, phone: true },
    PdfPageOrganizer: { render: PdfPageOrganizerRenderer, label: INDEPENDENT_STRUCTURE_BATCH4_LABELS.PdfPageOrganizer, phone: true },
    StreamReplicationConfigurator: { render: StreamReplicationConfiguratorRenderer, label: INDEPENDENT_STRUCTURE_BATCH4_LABELS.StreamReplicationConfigurator, phone: true },
    GeofenceVertexEditor: { render: GeofenceVertexEditorRenderer, label: INDEPENDENT_STRUCTURE_BATCH5_LABELS.GeofenceVertexEditor, phone: true },
    RouteStopSequencer: { render: RouteStopSequencerRenderer, label: INDEPENDENT_STRUCTURE_BATCH5_LABELS.RouteStopSequencer, phone: true },
    PivotShelfComposer: { render: PivotShelfComposerRenderer, label: INDEPENDENT_STRUCTURE_BATCH5_LABELS.PivotShelfComposer, phone: true },
    BooleanRuleTreeBuilder: { render: BooleanRuleTreeBuilderRenderer, label: INDEPENDENT_STRUCTURE_BATCH5_LABELS.BooleanRuleTreeBuilder, phone: true },
    ImageCropTransformStudio: { render: ImageCropTransformStudioRenderer, label: INDEPENDENT_STRUCTURE_BATCH5_LABELS.ImageCropTransformStudio, phone: true },
    DatasetJoinBuilder: { render: DatasetJoinBuilderRenderer, label: INDEPENDENT_STRUCTURE_BATCH5_LABELS.DatasetJoinBuilder, phone: true },
    CompositeRoleBuilder: { render: CompositeRoleBuilderRenderer, label: INDEPENDENT_STRUCTURE_BATCH6_LABELS.CompositeRoleBuilder, phone: true },
    HttpRequestWorkbench: { render: HttpRequestWorkbenchRenderer, label: INDEPENDENT_STRUCTURE_BATCH6_LABELS.HttpRequestWorkbench, phone: true },
    BomAssemblyTreeEditor: { render: BomAssemblyTreeEditorRenderer, label: INDEPENDENT_STRUCTURE_BATCH6_LABELS.BomAssemblyTreeEditor, phone: true },
    AlertThresholdBandEditor: { render: AlertThresholdBandEditorRenderer, label: INDEPENDENT_STRUCTURE_BATCH6_LABELS.AlertThresholdBandEditor, phone: true },
    MediaTrimTimeline: { render: MediaTrimTimelineRenderer, label: INDEPENDENT_STRUCTURE_BATCH6_LABELS.MediaTrimTimeline, phone: true },
    CronOccurrenceBuilder: { render: CronOccurrenceBuilderRenderer, label: INDEPENDENT_STRUCTURE_BATCH6_LABELS.CronOccurrenceBuilder, phone: true },
    OcrRegionCorrectionCanvas: { render: OcrRegionCorrectionCanvasRenderer, label: INDEPENDENT_STRUCTURE_BATCH7_LABELS.OcrRegionCorrectionCanvas, phone: true },
    QueryExecutionPlanInspector: { render: QueryExecutionPlanInspectorRenderer, label: INDEPENDENT_STRUCTURE_BATCH7_LABELS.QueryExecutionPlanInspector, phone: true },
    ColumnProfileWorkbench: { render: ColumnProfileWorkbenchRenderer, label: INDEPENDENT_STRUCTURE_BATCH7_LABELS.ColumnProfileWorkbench, phone: true },
    CertificateRotationPlanner: { render: CertificateRotationPlannerRenderer, label: INDEPENDENT_STRUCTURE_BATCH7_LABELS.CertificateRotationPlanner, phone: true },
    WebhookPayloadSchemaExplorer: { render: WebhookPayloadSchemaExplorerRenderer, label: INDEPENDENT_STRUCTURE_BATCH7_LABELS.WebhookPayloadSchemaExplorer, phone: true },
    ArtifactProvenanceVerifier: { render: ArtifactProvenanceVerifierRenderer, label: INDEPENDENT_STRUCTURE_BATCH7_LABELS.ArtifactProvenanceVerifier, phone: true },
    BankTransactionReconciliationMatcher: { render: BankTransactionReconciliationMatcherRenderer, label: INDEPENDENT_STRUCTURE_BATCH8_LABELS.BankTransactionReconciliationMatcher, phone: true },
    CvssVectorCalculator: { render: CvssVectorCalculatorRenderer, label: INDEPENDENT_STRUCTURE_BATCH8_LABELS.CvssVectorCalculator, phone: true },
    LogPatternClusterExplorer: { render: LogPatternClusterExplorerRenderer, label: INDEPENDENT_STRUCTURE_BATCH8_LABELS.LogPatternClusterExplorer, phone: true },
    ProductVariantMatrixBuilder: { render: ProductVariantMatrixBuilderRenderer, label: INDEPENDENT_STRUCTURE_BATCH8_LABELS.ProductVariantMatrixBuilder, phone: true },
    InventoryLocationLevelTuner: { render: InventoryLocationLevelTunerRenderer, label: INDEPENDENT_STRUCTURE_BATCH8_LABELS.InventoryLocationLevelTuner, phone: true },
    FaceIdentityAssignmentPanel: { render: FaceIdentityAssignmentPanelRenderer, label: INDEPENDENT_STRUCTURE_BATCH8_LABELS.FaceIdentityAssignmentPanel, phone: true },
  });

/** 手机档有专属渲染器的类型 —— 从定义表派生，不再另立名单。 */
export const PHONE_BLOCK_TYPES: ReadonlySet<string> = new Set(
  Object.entries(BLOCK_DEFINITIONS)
    .filter(([, d]) => d.phone)
    .map(([type]) => type)
);

/**
 * rendererKey → 渲染器。**从定义表派生**，不再手写第二份。
 *
 * 保留这张表是因为目录 JSON 用 rendererKey 索引（区块 type 与渲染器实现是
 * 多对一的，将来一个渲染器要带多个行业变体时更是如此——见 lowcode-engine
 * 的 snippets）。这里只是把 type→render 换算成 rendererKey→render。
 */
export const EXPERIENCE_BLOCK_RENDERERS: Readonly<
  Record<string, ExperienceBlockRenderer>
> = Object.freeze(
  Object.fromEntries(
    EXPERIENCE_BLOCK_CATALOG.blocks
      .map(entry => [entry.rendererKey, BLOCK_DEFINITIONS[entry.type]?.render])
      .filter(([, render]) => Boolean(render))
  ) as Record<string, ExperienceBlockRenderer>
);

export function experienceBlockEntry(
  type: string
): ExperienceBlockCatalogEntry | undefined {
  return EXPERIENCE_BLOCK_CATALOG.blocks.find(entry => entry.type === type);
}

/** 未知 type 或漏登记 renderer 时明确报不支持，不能白屏或假装成功。 */
/**
 * 区块渲染分发口。
 *
 * 这里**整包透传 props**，不逐个列举。2026-07-28 之前是把每个 prop 解构出来
 * 再手写一遍转发，于是新增 enumOptionsOf 时漏了这一处——类型全绿、单测全绿，
 * 环图图例照样写着取值 id，只有真跑截图才看得出来。逐个列举等于每加一个
 * prop 就埋一次同样的雷，改成 {...props} 之后这一类漏传不可能再发生。
 */
export function ExperienceBlockBoundary(props: ExperienceBlockRendererProps) {
  const { block } = props;
  const entry = experienceBlockEntry(block.type);
  const Renderer = entry
    ? EXPERIENCE_BLOCK_RENDERERS[entry.rendererKey]
    : undefined;
  if (!entry || !Renderer) {
    return (
      <div
        role="alert"
        data-testid="unsupported-experience-block"
        className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
      >
        暂不支持此区块：{block.type || "未声明类型"}
      </div>
    );
  }
  return <Renderer {...props} />;
}
