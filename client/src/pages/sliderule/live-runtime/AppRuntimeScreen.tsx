/**
 * AppRuntimeScreen — JSON 渲染出的"真系统"（应用运行，浏览器运行时 M1.6）。
 *
 * el-form-renderer / el-data-table 哲学：菜单、统计卡、图表、表格、表单、
 * 详情抽屉全部由 app-runtime-schema（从五系统模型推导的 JSON）驱动，
 * antd（稳定版 5.x）渲染成 Ant Design Pro 风格的后台系统。
 * 零后端、零数据库：状态在 live-runtime 内核 + localStorage。
 *
 * 多端画布：桌面 1440×810（16:9）/ 平板 1112×834 / 手机 405×720（9:16），
 * 均按固定设计分辨率渲染再 CSS transform 等比缩放（"缩放 iframe"效果）；
 * 手机端换 App 壳（顶栏 + 卡片列表 + 底部标签导航）。弹层经
 * getPopupContainer 挂进画布随缩放（antd 5 trigger 自带 scale 校正）。
 *
 * 图表遵循 dataviz 规范：单色细条 + 数值直标（文字用墨色不用系列色）、
 * 状态环图配图例文字+计数（不靠颜色单独传达）、状态色经校验
 * （#1677ff/#52c41a/#ff4d4f，CVD ΔE 15.9 PASS）。
 */

import React from "react";
import { createPortal } from "react-dom";
import { ScaleBadge, useScaleToFit, type ScaleFitMode } from "./canvas-scale";
import { STAGE_FRAME_PAD, STAGE_FRAME_SHADOW } from "./stage-frame-style";
import {
  Layout,
  Menu,
  Table,
  Button,
  Modal,
  Input,
  InputNumber,
  Select,
  Tag,
  Steps,
  Space,
  Card,
  Statistic,
  Breadcrumb,
  Avatar,
  Timeline,
  Collapse,
  Drawer,
  Descriptions,
  Flex,
  ConfigProvider,
  theme as antdTheme,
  message,
  Popover,
  Popconfirm,
  Tooltip,
  Checkbox,
  Form,
  Alert,
  Skeleton,
  Empty,
  Badge,
  Segmented,
} from "antd";
import {
  DashboardOutlined,
  TableOutlined,
  ProfileOutlined,
  FormOutlined,
  AppstoreOutlined,
  UserOutlined,
  PlusOutlined,
  LockOutlined,
  SettingOutlined,
  BarChartOutlined,
  BookOutlined,
  CalendarOutlined,
  FileTextOutlined,
  GlobalOutlined,
  HeartOutlined,
  SafetyOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { markConnectorEntities } from "./connector-rows";
import { connectorEntityIds } from "../connectors-client";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import { resolveEntityRef } from "../system-screens/five-system-model";
import {
  resolveIdentityTheme,
  hexToRgba,
  admThemeVars,
} from "./identity-themes";
import { autoPlaceGrid } from "./grid-compact";
import { deriveLayoutTokens } from "./design-tokens";
import {
  buildAiActionInputs,
  deriveAppRuntimeSchema,
  pageFreeformOwnsContent,
  type AppAiActionSchema,
  type AppChartSchema,
  type AppFormFieldSchema,
  type AppPageChartSchema,
  type AppPageFeedSchema,
  type AppPageRankingSchema,
  type AppPageSchema,
  type AppRuntimeSchema,
} from "./app-runtime-schema";
import {
  buildEchartsOption,
  buildEntityRowcountOption,
  buildInstanceStatusOption,
} from "./build-echarts-option";

// ECharts 基建走独立 chunk（React.lazy）：主 bundle 不背 echarts，
// 首个带图表声明的页面打开时才加载。
const LazyEchartsChart = React.lazy(() => import("./EchartsChart"));
const LazyProWorkbenchSurface = React.lazy(
  () => import("./ProWorkbenchSurface")
);
// 手机档 UI 基建（antd-mobile）同样独立 chunk：切到手机设备档才加载。
const LazyPhonePageList = React.lazy(
  () => import("./phone-mobile/PhonePageList")
);
const LazyPhoneTabBar = React.lazy(() => import("./phone-mobile/PhoneTabBar"));
const LazyPhoneFormPopup = React.lazy(
  () => import("./phone-mobile/PhoneFormPopup")
);
const LazyPhoneDetailPopup = React.lazy(
  () => import("./phone-mobile/PhoneDetailPopup")
);
const LazyPhoneRolePicker = React.lazy(
  () => import("./phone-mobile/PhoneRolePicker")
);
const LazyPhoneHome = React.lazy(() => import("./phone-mobile/PhoneHome"));
const LazyPhoneDetailSections = React.lazy(
  () => import("./phone-mobile/PhoneDetailSections")
);
const LazyPhoneDetailFields = React.lazy(
  () => import("./phone-mobile/PhoneDetailFields")
);
const LazyPhoneActionButton = React.lazy(
  () => import("./phone-mobile/PhoneActionButton")
);
const LazyPhonePageSections = React.lazy(
  () => import("./phone-mobile/PhonePageSections")
);
const LazyPhoneKanban = React.lazy(
  () => import("./phone-mobile/PhoneKanban")
);
const LazyPhoneNavBar = React.lazy(() => import("./phone-mobile/PhoneNavBar"));
const LazyPhoneSeedNotice = React.lazy(
  () => import("./phone-mobile/PhoneSeedNotice")
);
const LazyPhoneCalendar = React.lazy(
  () => import("./phone-mobile/PhoneCalendar")
);
const LazyPhoneExperienceBlock = React.lazy(
  () => import("./phone-mobile/PhoneExperienceBlock")
);
const PHONE_EXPERIENCE_BLOCK_TYPES = new Set([
  "FilterBar",
  "MetricGrid",
  "WorkflowTimeline",
  "QuickActionPanel",
]);
import {
  type RuntimeState,
  type RuntimeRow,
  initRuntimeState,
  addRow,
  deleteRow,
  updateRow,
  validateRowFields,
  startInstance,
  applyHtmlWorkflowAction,
  nodeById,
} from "./live-runtime";
import {
  seedRuntimeState,
  dropSeedRowsFor,
  entityShowsSeed,
  seedRowCount,
} from "./demo-seed";
import { normalizeFieldFormat, normalizeFieldOptions } from "./field-display";
import {
  loadRuntimeState,
  saveRuntimeState,
  notifyRuntimeChanged,
  subscribeRuntimeChanged,
  loadRuntimeRole,
  saveRuntimeRole,
  notifyRoleChanged,
  subscribeRoleChanged,
} from "./runtime-persistence";
import {
  accessForRole,
  pageAccessForRole,
  resolveVisiblePageId,
  type PageAccess,
} from "./rbac-preview";
import {
  ExperienceBlockBoundary,
  EXPERIENCE_BLOCK_CAPABILITY_BY_TYPE,
  EXPERIENCE_BLOCK_TYPES_DRAWING_WORKFLOW,
  type BlockColumnState,
  type PageColumnState,
  type PageFilterState,
  type PageFocusState,
  type PageSelectionState,
  type FilterFieldOption,
  type QuickActionButtonSpec,
} from "./block-registry";
import {
  resolveDesignRecipe,
  designRecipeAlgorithms,
  DARK_CANVAS_BG,
} from "./design-recipes";
import { INK } from "./business-surface-theme";
import { deriveWorkflowMainPath } from "./workflow-main-path";
import { buildColumnFeatures } from "./table-features";
import { FieldValue } from "./FieldValue";
import { FieldEditor } from "./FieldEditor";
import {
  dedupeBlocksByPanelKey,
  dropLegacyPanelsCoveredByBlocks,
} from "./page-panel-dedupe";
import { KanbanBoard, CalendarBoard } from "./PageViews";
import BusinessPageGrid from "./BusinessPageGrid";
import {
  BUSINESS_GRID_COLUMNS,
  PAGE_CONTENT_REF,
  ensurePageContentItem,
  resolveBusinessGrid,
  regionsToGrid,
  type BusinessRegions,
  type BusinessGridItem,
  type BusinessPageBreakpoint,
} from "./business-page-layout";
// 看板分组是纯函数，桌面与手机共用同一份——两档各分各的会让同一条记录
// 在两个档位落进不同的列。
import {
  groupRowsForKanban,
  localDateKey,
  rowsByDateKey,
  type KanbanColumn,
} from "./page-views";
import { AiSuggestionCard } from "./AiSuggestionCard";
import { CodeProjectionView } from "./CodeProjectionView";
import zhCN from "antd/locale/zh_CN";
// dayjs 的 locale 是**独立于 antd 的第二套**：antd 的 locale 管按钮/占位这些
// 文案，星期几的短名（一二三…）和「周一起周」是 dayjs 给的。只设一边的话
// 面板会一半中文一半 Su/Mo——两行都得有。
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { confirmDestructive, notify } from "./phone-mobile/phone-feedback";

// 模块级设一次。放在组件里会每次渲染都调，dayjs.locale 是全局副作用。
dayjs.locale("zh-cn");
import type { AppPageStatSchema } from "./app-runtime-schema";
import type { XrayTarget } from "../XrayPanel";

// 多端设计分辨率（固定渲染 + 等比缩放）
//
// ⚠️ 手机档必须是 **9:16**，与出图画布同比（2026-08-03 修）。
//
// 事故形状：手机档此前是 390×844（0.462，iPhone 19.5:9 的物理屏比），而首页
// 参照板出图是 720×1280（9:16），设计 LLM 是**照着 9:16 那张图排的版式**，
// 真实渲染却把它铺进一块高出 22% 的画布——版式被拉长，底部多出一截空。
//
// 链路上另外三处一直是 9:16，只有这里不是：
//   · 出图      freeform_block._DEVICE_IMAGE_SIZE.phone = 720x1280
//   · 卡片画幅  justified-rows.DEVICE_ASPECT.phone      = 720/1280
//   · 缩略图裁切 thumb-capture.SHOT_CANVAS.phone        = 720x1280
// 2026-08-01 那次把卡片对齐到出图时，就地记了一笔"手机档 0.462 比 9:16 窄 22%，
// 正是「移动端看着过长」的来源"——那次只改了卡片，画布留到了现在。
//
// 尺寸取 405×720（= 9×45 : 16×45，精确 9:16）。宽度从 390 往**大**挪而不是把
// 高度压到 693：这块画布的横向一直很紧（antd Modal 默认 520 顶穿两边、
// PhoneFormPopup 量到右侧溢出 130 设计像素——见那两处注释），往窄了改会把这
// 类问题全部放大一档，往宽 15px 则只会更宽松。
const DEVICE_SPECS = {
  desktop: { w: 1440, h: 810, label: "桌面" },
  tablet: { w: 1112, h: 834, label: "平板" },
  phone: { w: 405, h: 720, label: "手机" },
} as const;
type DeviceKey = keyof typeof DEVICE_SPECS;

/**
 * 这个应用**实际有设计的**档位（2026-07-30）。
 *
 * 起因：07-30 起明说 preferredDevice=desktop 的应用不再多花一次调用去设计手机
 * 版式（省约 67s/总览页）。那样一来切换条上的「手机」就成了一个通往没设计过
 * 的档位的入口——点进去看到的是桌面版式被 CSS 掰弯的样子。**与其想办法把回退
 * 做得好看，不如不给这个入口。**
 *
 * 形状照 Appsmith 的 LayoutSystemFeatures（`useLayoutSystemFeatures()` 按当前
 * 布局系统类型回答"这个能力开不开"，其中 ENABLE_CANVAS_LAYOUT_CONTROL 管的
 * 正是"要不要显示档位控件"）。抄的是**用一处派生回答、各处只管问**这个结构：
 * 不在每个用到档位的地方各写一遍 `preferredDevice === 'desktop' ? …`，否则
 * 迟早出现"切换条显示手机档、渲染层却没有手机设计"的错位。
 *
 * 新模型由 deviceAuthority + preferredDevice 声明唯一档位；只有没有该标记的历史数据
 * 才按实际已有设计判断：
 *   · 声明接通的档（desktop / phone / tablet）且 single-v1 → 只开放那一档
 *   · 未声明 → 看总览页有没有挂 mobile 设计；挂了就两档都给，没挂就只给桌面档
 * 最后那条兜的是老数据：07-30 之前生成的应用 preferredDevice 一律 desktop
 * （那时这个字段没判据、9/9 都是它），但它们**确实有** mobile 设计——按声明
 * 判会把已有的设计藏起来，按"有没有"判才对。
 */
export function availableDeviceTiers(
  schema: {
    identity?: { preferredDevice?: string; deviceAuthority?: string };
    pages?: unknown[];
  } | null | undefined
): DeviceKey[] {
  const declared = schema?.identity?.preferredDevice;
  if (schema?.identity?.deviceAuthority === "single-v1") {
    if (declared === "phone") return ["phone"];
    if (declared === "tablet") return ["tablet"];
    return ["desktop"];
  }
  if (declared === "phone") return ["phone"];
  if (declared === "tablet") return ["tablet"];
  const hasMobileDesign = (schema?.pages ?? []).some(
    p =>
      !!(p as { freeformOverview?: { mobile?: { root?: unknown } } })?.freeformOverview?.mobile
        ?.root
  );
  const hasBusinessPhoneGrid = (schema?.pages ?? []).some(p => {
    const phone = (
      p as { layout?: { grid?: { phone?: unknown } } | null }
    )?.layout?.grid?.phone;
    return Array.isArray(phone) && phone.length > 0;
  });
  if (hasMobileDesign || hasBusinessPhoneGrid) return ["desktop", "phone"];
  return ["desktop"];
}

/**
 * 弹层在各设备画布里的尺寸。
 *
 * antd Modal 是桌面组件：不给 width 默认 520px、垂直偏移 top:100。手机画布
 * 才 405 宽，520 直接顶穿两边——展会上访客点「新建」就能看见。旁边的详情
 * Drawer 早就按 isPhone 改成了底部弹起，Modal 这块漏了。
 *
 * 手机上按原生表单页的做法处理：左右各留 16 边距、垂直居中、内容超高自己
 * 滚（画布是固定 405×720 的等比缩放渲染，不是真实视口，所以这里按设计分辨率
 * 算死值而不是用 vh）。
 */
export function deviceModalSizing(device: DeviceKey): {
  width: number;
  centered: boolean;
  bodyMaxHeight: number;
} {
  const spec = DEVICE_SPECS[device];
  if (device === "phone") {
    return {
      width: spec.w - 32,
      centered: true,
      // 减掉标题栏 + 按钮栏 + 上下留白，剩下的给表单内容
      bodyMaxHeight: Math.round(spec.h * 0.6),
    };
  }
  return {
    width: 520,
    centered: false,
    bodyMaxHeight: Math.round(spec.h * 0.7),
  };
}

// 缩放画布（useScaleToFit / ScaleFitMode / ScaleBadge）2026-08-14 抽去了
// ./canvas-scale —— spec-first 那条链路的页面也要同一套等比缩放，两处共用
// 一份实现而不是各抄一遍（理由见那个文件的头注）。
// ⚠ 抽走的只是机制，本文件的设计分辨率仍是 DEVICE_SPECS 里那三档。
export type { ScaleFitMode } from "./canvas-scale";

const MENU_ICONS = [
  TableOutlined,
  ProfileOutlined,
  FormOutlined,
  AppstoreOutlined,
];

// E40.2 品牌图标封闭集（id 合法域在 @legal identityIcons；未知 id 回退 boxes）
const BRAND_ICONS: Record<
  string,
  React.ComponentType<{ style?: React.CSSProperties }>
> = {
  boxes: AppstoreOutlined,
  chart: BarChartOutlined,
  shield: SafetyOutlined,
  cart: ShoppingCartOutlined,
  users: TeamOutlined,
  calendar: CalendarOutlined,
  file: FileTextOutlined,
  spark: ThunderboltOutlined,
  globe: GlobalOutlined,
  wrench: ToolOutlined,
  heart: HeartOutlined,
  book: BookOutlined,
};

// --- 图表（dataviz 规范：墨色文字、细标记、状态色已校验） --------------------
// 墨色从 business-surface-theme 来（本文件此前自己写死了一份，faint 还跟令牌
// 版漂成了两个颜色，见那个文件的说明）。注意 faint 由 #bfbfbf 变成 #8c8c8c：
// 下面十来处 11px 提示文字原来对白底只有约 2.3:1 的对比度，改完读得清了。
const STATUS_META: Record<string, { color: string; label: string }> = {
  running: { color: "#1677ff", label: "进行中" },
  completed: { color: "#52c41a", label: "已完成" },
  rejected: { color: "#ff4d4f", label: "已驳回" },
};

/**
 * 页面级 KPI 卡取值（加厚 schema 一期）：对着运行时行数据求值声明的
 * metric。sum/avg 只统计能解析成数值的行（脏值跳过，不猜）；
 * avg 无可统计行时返回 null——渲染层如实显示"—"，不冒充 0。
 */
function pageStatValue(
  stat: AppPageStatSchema,
  rows: Array<{ values: Record<string, unknown> }>
): number | null {
  if (stat.metric === "count") return rows.length;
  const nums = rows
    .map(r => Number(r.values[stat.metricFieldId ?? ""]))
    .filter(n => Number.isFinite(n));
  if (stat.metric === "sum") return nums.reduce((a, b) => a + b, 0);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Step 6 FilterBar：本页主实体行数据过滤（枚举精确匹配 AND 日期范围）。
 * 只作用于与 page.entityId 直接绑定的视图（Table/看板/日历）——stats/
 * rankings/feeds 各自可能引用不同实体（state.entities[其他 entityId]），
 * 语义上不归这份"本页主实体"过滤态管，不在这里处理。
 */
function applyPageFilter(
  rows: RuntimeRow[],
  filterState: PageFilterState | undefined,
  dateFieldId: string | null | undefined
): RuntimeRow[] {
  if (!filterState) return rows;
  let out = rows;
  const activeEnumEntries = Object.entries(
    filterState.enumFilters ?? {}
  ).filter(([, v]) => Boolean(v));
  for (const [fieldId, value] of activeEnumEntries) {
    out = out.filter(r => String(r.values[fieldId] ?? "") === value);
  }
  // 多选标签行（TagFilterRow，2026-08-08）。**空数组 = 不筛这个维度**——
  // 「全部」取消勾选之后是空数组，那时候该看到全部而不是一条都没有。
  for (const [fieldId, picked] of Object.entries(filterState.enumMulti ?? {})) {
    if (!picked || picked.length === 0) continue;
    out = out.filter(r => picked.includes(String(r.values[fieldId] ?? "")));
  }
  // 关键词（SearchBox，2026-08-08）。跨这一行的所有值做子串匹配。
  const kw = (filterState.keyword ?? "").trim().toLowerCase();
  if (kw) {
    out = out.filter(r =>
      Object.values(r.values ?? {}).some(v =>
        String(v ?? "").toLowerCase().includes(kw)
      )
    );
  }
  if (filterState.dateRange && dateFieldId) {
    const [from, to] = filterState.dateRange;
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
      out = out.filter(r => {
        const raw = r.values[dateFieldId];
        if (!raw) return false;
        const t = new Date(String(raw)).getTime();
        return Number.isFinite(t) && t >= fromMs && t <= toMs;
      });
    }
  }
  return out;
}

/** 工作台统计卡取值：对着运行时状态求值 schema 声明的 source。 */
function statValue(
  state: RuntimeState,
  schema: AppRuntimeSchema,
  source: string
): number {
  if (source.startsWith("entity:"))
    return (state.entities[source.slice("entity:".length)] ?? []).length;
  if (source === "instances:running")
    return state.instances.filter(i => i.status === "running").length;
  if (source === "instances:total") return state.instances.length;
  if (source === "roles") return schema.roles.length;
  return 0;
}

export function AppRuntimeScreen({
  model,
  sessionId,
  appTitle,
  onActivePageChange,
  xrayActive = false,
  onXrayTarget,
  controlsContainer,
  scaleFit = "contain",
  showScaleBadge = true,
}: {
  model: FiveSystemModel;
  sessionId: string;
  appTitle?: string;
  /** 当前页变化时上报（游标透视栏跟随应用内导航） */
  onActivePageChange?: (pageId: string) => void;
  /** 元素级游标：开启时被埋点的元素悬停上报目标 + 描边高亮 */
  xrayActive?: boolean;
  onXrayTarget?: (target: XrayTarget | null) => void;
  /** 档位切换条的外部挂载点（studio 顶条「游标」左侧）。传了本 prop 就
   *  不再浮在画布左上角：元素就绪前不渲染切换条（避免闪跳）。 */
  controlsContainer?: HTMLElement | null;
  /** 画布缩放口径。缩略图墙传 "width"（宽度定缩放、高度跟内容），
   *  应用舞台用默认 "contain"（要看全）。见 ScaleFitMode 的说明。 */
  scaleFit?: ScaleFitMode;
  /**
   * 右下角那枚「1440×810 · 21%」缩放标识要不要画。
   *
   * 它是**可交互运行时**的自述——告诉你当前看到的是固定设计分辨率按容器等比
   * 缩下来的结果。放进应用中心的缩略图里就变成了噪声：9px 的字再被整体缩到
   * 21% 根本读不出来，而且卡片信息条 2026-07-31 改成压在画面底部之后，两者
   * 抢同一个右下角，实测叠成一块糊斑。所以缩略图传 false。
   */
  showScaleBadge?: boolean;
}) {
  // 2026-07-24：间距/圆角/阴影刻度——直接吃 antd 自己的 Design Token（见
  // design-tokens.ts 头部注释），不是另起一套静态数字。卡片族（KPI/图表/
  // 排行/动态）的 padding/margin/gap 统一从这里取，不再各处手写数字。
  const { token: antdToken } = antdTheme.useToken();
  const layout = React.useMemo(
    () => deriveLayoutTokens(antdToken),
    [antdToken]
  );

  // 表格列设置（表格自带能力）：按 pageId 记用户勾选的列；undefined = 默认列
  const [tableColPrefs, setTableColPrefs] = React.useState<
    Record<string, string[]>
  >({});

  const schema = React.useMemo(
    () => deriveAppRuntimeSchema(model, appTitle || "推演应用"),
    [model, appTitle]
  );
  // hydrate 后统一过一遍 seedRuntimeState：只给"完全为空的实体"铺演示行，
  // 幂等且不碰已有真实数据（见 demo-seed.ts 的三条边界）。放在 load 之后
  // 而不是只在 init 里，是因为别的面板可能先存过一份没种子的状态。
  const hydrate = React.useCallback(
    () => seedRuntimeState(loadRuntimeState(sessionId) ?? initRuntimeState(model), model),
    [sessionId, model]
  );
  const [state, setState] = React.useState<RuntimeState>(hydrate);

  /*
   * ⚠ 连接器供数的表，**在这里也不许铺演示种子**（2026-08-25）。
   *
   *   上面的 hydrate 里 `loadRuntimeState(sessionId) ?? init...` 看着够了——
   *   推演机上 SlideRuleStudio 已经把 connectorEntities 存进去了，读回来就有。
   *   但**换一台机器打开分享出去的应用时存档是空的**，于是 init 出一份干净
   *   状态，seedRuntimeState 照铺不误：作者自己看是真天气，别人看到的是 12 行
   *   编的，而且两边都不报错。这正是这条链路要消灭的东西。
   *
   *   所以从注册表问一次"哪些实体是连接器供的"，标记上（只标记、不取数——
   *   取数只有一个写入点），再让 seed 自然跳过。
   */
  React.useEffect(() => {
    let alive = true;
    void connectorEntityIds().then(ids => {
      if (!alive || ids.length === 0) return;
      setState(prev => {
        const marked = markConnectorEntities(prev, ids, "实时数据源 · 本机还没取过数");
        return marked === prev ? prev : seedRuntimeState(marked, model);
      });
    });
    return () => {
      alive = false;
    };
  }, [model]);
  const [activePageId, setActivePageId] = React.useState<string>(
    () => schema?.landingPageId ?? "home"
  );
  // Step 8：新模型的 preferredDevice 是唯一运行时档位；历史模型才保留切换兼容。
  const [device, setDevice] = React.useState<DeviceKey>(() => {
    const declared = schema?.identity.preferredDevice;
    if (declared === "phone" || declared === "tablet" || declared === "desktop") {
      return declared;
    }
    return "desktop";
  });
  // 这个应用有设计的档位。切换条、代码视图旁的档位按钮都问它，不各自判
  // （见 availableDeviceTiers 的说明）。
  const deviceTiers = React.useMemo(() => availableDeviceTiers(schema), [schema]);
  // 只有一档时把当前档钉在那一档上：老会话可能把 device 存成了一个现在
  // 不再提供的档（比如之前切到过手机、这次的应用只有桌面档），不纠回来
  // 就会渲染一个切换条上选不中的视图。
  React.useEffect(() => {
    if (!deviceTiers.includes(device)) setDevice(deviceTiers[0]);
  }, [deviceTiers, device]);
  // 代码视图档（代码视图一期）：schema 的确定性代码投影——与设备档并列的
  // 观察视角切换，开着时替换缩放画布（代码要整幅面积，不做 16:9 缩放）
  const [codeView, setCodeView] = React.useState(false);
  // 当前角色与 RBAC 屏「角色预览」共享（localStorage + 事件），谁改都实时生效
  const [role, setRole] = React.useState<string | undefined>(
    () => loadRuntimeRole(sessionId) ?? schema?.roles[0]
  );
  // Step 6 FilterBar：按 pageId 存一份本地过滤态（视图态，不进 STATE/门禁）。
  const [pageFilters, setPageFilters] = React.useState<
    Record<string, PageFilterState>
  >({});
  /**
   * 2026-08-08 复盘补的三份页面态。
   *
   * 批次 1-4 建的区块里有六个靠它们活着，而这条路径（**真实运行时**）一份
   * 都没接——装配预览接了，所以一直看着是好的。表现全是"渲染正常但点不动"：
   * BatchActionBar 永远显示「勾选左侧的行」、表格没有勾选列、列设置说「没有
   * 连到任何表格」、关联单据表说「先选中一条主记录」。
   *
   * 这跟 QuickActionPanel 当初渲染成空气是同一个故事，只是换了四个 prop。
   */
  const [selection, setSelection] = React.useState<PageSelectionState>({
    rowIds: {},
  });
  const [columnState, setColumnState] = React.useState<PageColumnState>({});
  const [focus, setFocus] = React.useState<PageFocusState>({});
  const [formOpen, setFormOpen] = React.useState(false);
  const [formValues, setFormValues] = React.useState<Record<string, unknown>>(
    {}
  );
  //: 表单当前在改哪一行；null = 新建。**这一维之前根本不存在**——表单只有
  //: openCreate 一个入口（`setFormValues({})` 恒清空），所以行内那个「编辑」
  //: 无处可去，被接到了详情抽屉上。见 handleBlockAction 的 editRequest。
  const [editingRowId, setEditingRowId] = React.useState<string | null>(null);
  //: 提交被拦下时的字段级问题（fieldId → 提示）。空 fieldId 是整表级的。
  const [formProblems, setFormProblems] = React.useState<
    Record<string, string>
  >({});
  const [detailRow, setDetailRow] = React.useState<RuntimeRow | null>(null);
  // 手机档看板当前选中的状态列（桌面档并排显示所有列，不需要这个 state）
  const [phoneKanbanKey, setPhoneKanbanKey] = React.useState("");
  // 手机档日历选中的那一天（null = 不筛，显示全部）
  const [phoneCalDate, setPhoneCalDate] = React.useState<Date | null>(null);
  // AI 生成：正在跑的能力 id + 最近一次失败诊断（fail-closed，不冒充输出）
  const [aiRunningCapId, setAiRunningCapId] = React.useState<string | null>(
    null
  );
  const [aiError, setAiError] = React.useState<{
    code: string;
    detail: string;
  } | null>(null);
  // AI 建议（加厚 schema 三期"可解释输出"）：生成结果先落建议卡，
  // 用户确认才写回行字段——AI 永远是建议式，不直改数据。
  const [aiSuggestion, setAiSuggestion] = React.useState<{
    action: AppAiActionSchema;
    entityId: string;
    rowId: string;
    output: string;
    confidence: number | null;
    rationale: string | null;
  } | null>(null);
  const spec = DEVICE_SPECS[device];
  const { ref: fitRef, scale } = useScaleToFit(
    spec.w,
    spec.h,
    scaleFit,
    false,
    // 与 spec-first 舞台同一份余量：不扣的话新的 ring + 分层阴影
    // 会被画布的 overflow:hidden 切掉（2026-08-24 真机量到 gapTop=0）。
    STAGE_FRAME_PAD
  );
  // 弹层（Modal/Select/Drawer）挂进画布，跟随 transform 缩放
  const [canvasEl, setCanvasEl] = React.useState<HTMLDivElement | null>(null);

  // 与工作流试运行面共享一份状态：对方变更时重载
  React.useEffect(
    () =>
      subscribeRuntimeChanged(sessionId, () => setState(hydrate())),
    [sessionId, hydrate]
  );
  React.useEffect(
    () =>
      subscribeRoleChanged(sessionId, () => {
        const next = loadRuntimeRole(sessionId);
        if (next) setRole(next);
      }),
    [sessionId]
  );

  const changeRole = (next: string) => {
    setRole(next);
    saveRuntimeRole(sessionId, next);
    notifyRoleChanged(sessionId);
  };

  // 角色 → 页面可见性/操作权（RBAC 模型驱动；公共页恒可见）
  const pageAccess = React.useMemo(() => {
    const map = new Map<string, PageAccess>();
    if (!schema) return map;
    for (const a of pageAccessForRole(
      schema.pages,
      accessForRole(model, role)
    )) {
      map.set(a.pageId, a);
    }
    return map;
  }, [schema, model, role]);

  // 会话或模型换了一套时，从新模型声明的落地页重新进入；旧模型仍是 home。
  React.useEffect(() => {
    if (schema) setActivePageId(schema.landingPageId);
  }, [sessionId, schema?.landingPageId]);

  // 当前页对该角色不可见时，降级到第一个可见业务页；一个都没有才回旧工作台。
  React.useEffect(() => {
    if (!schema) return;
    const resolved = resolveVisiblePageId(
      schema.pages,
      pageAccess,
      activePageId,
      schema.home.id
    );
    if (resolved !== activePageId) setActivePageId(resolved);
  }, [activePageId, pageAccess, schema]);

  React.useEffect(() => {
    onActivePageChange?.(activePageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageId]);

  if (!schema) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-stone-400">
        本话题模型缺少页面/实体定义，推演闭环后可运行应用
      </div>
    );
  }

  const isPhone = device === "phone";
  const isTablet = device === "tablet";
  const modalSizing = deviceModalSizing(device);
  const isHome = activePageId === "home";
  const page: AppPageSchema | null = isHome
    ? null
    : (schema.pages.find(p => p.id === activePageId) ??
      schema.pages[0] ??
      null);
  const currentTitle = isHome ? schema.home.title : (page?.title ?? "");
  const allRows = page?.entityId ? (state.entities[page.entityId] ?? []) : [];
  /**
   * 本页主表里还剩几行演示种子（0 = 展示的全是真实数据）。
   *
   * 一页里的表格、图表、KPI、体验区块吃的都是这同一批行，所以标注也只需要
   * 这一处——不给每个渲染器各挂一个徽标（那样一页能挂出七八个"示例数据"，
   * 反而没人看）。用户往这张表写第一条真实数据时种子整批清掉，徽标随之消失。
   */
  const pageSeedCount = seedRowCount(state, page?.entityId);

  const freeformOwnsPage = page ? pageFreeformOwnsContent(page) : false;
  const dashboardUsesBusinessGrid =
    page?.view.kind === "dashboard" && !freeformOwnsPage;

  /**
   * ── 这一页由积木画，还是由固定骨架画（2026-08-08，三步走的第②步）──
   *
   * **翻转默认**：声明了 blocks 就用积木，没声明才回落骨架。骨架从"拥有者"
   * 变回"兜底"——它本来就该是这个角色。
   *
   * 翻之前是反的：桌面档的 workbench/wizard 页一律交给内置 ProTable 骨架，
   * `blockScaffold` 只在 monitor/dashboard 上摆出来。后果是**列表页上的积木
   * 一个都不上屏**——而列表页是最常见的页面类型。更难受的是，给模型的
   * prompt 里那十套「参考排布」有三套推荐 `DataTable` 放 main，模型照做了、
   * 门禁放行了，运行时又给扔了：我们在教模型生成一个必定被丢掉的东西。
   *
   * 判据是"**声明了没有**"，不是"页面形态是什么"。形态决定的是骨架长什么样，
   * 决定不了这一页该由谁画——那是模型的声明说了算。
   */
  const declaredBlocks = (page?.experienceBlocks ?? []).filter(b => !b._fromLegacy);
  const blocksOwnPage = !freeformOwnsPage && declaredBlocks.length > 0;
  /**
   * 积木里有没有真的在"展示这一页的记录"的。
   *
   * 没有的话**仍然把内置表格补进版面**：模型只声明了一个 MetricGrid 就把整页
   * 的表格弄没了，那是"翻转默认"最容易造成的伤害——用户看到的是一张少了东西
   * 的页面，而不是一个更灵活的页面。兜底比纯粹更重要。
   *
   * 判据用 **capability === "entityRows"**，不是 family === "data"。第一版写的
   * 是后者，台子上当场露馅：MetricGrid 的 family 就是 data（它自己取数、能独立
   * 存在），于是"只声明了一个指标卡"的页面被判成"记录已经有人展示了"，表格没
   * 补回来，整页只剩一张卡。**family 回答的是"能不能独立存在"，capability 才
   * 回答"展示的是什么"** —— 这里要问的是后者。
   */
  /**
   * ── 2026-08-11：判据再补一维——**它落在哪个区域** ──────────────────────
   *
   * 上面那段记的是 family → capability 那次修正。线上截图照出同一个 bug 的第三次
   * 变体：「宠物成长看板」整个主区**一片空白**（约 400px 高的白），卡片在、内容没有。
   *
   * 原因是这条判据不看区域。目录里有一批 entityRows 区块**物理上进不了 main**：
   *
   *     HeaderEntitySummary / HeaderProgressSummary   regions=headerContent（页头小字）
   *     AlertRoutingPolicy                            regions=aside,supplement
   *     RecordComparePanel                            regions=supplement,overlay
   *     GlobalSearchPalette                           regions=overlay,headerContent
   *
   * 一个页面只声明了「页头说明」这种 entityRows，就被判成"记录已经有人展示了"，
   * 内置表格不补回来——主区于是空着。放在右侧窄栏的 RecordDetail 同理：它显示的是
   * **一条**记录，替代不了行列表。
   *
   * 所以"覆盖了数据"要求区块真的落在**正文带的全宽区域**（main / supplement，
   * 见 business-page-layout 的 REGIONS_BY_BAND）。aside 是 3~4/12 的窄栏、
   * headerContent 是页头小字、overlay 点了才出来，都替代不了主区的行列表。
   *
   * 没声明 layout 时所有区块都被塞进 main（renderExperienceBlockScaffold 里
   * `regionSource?.main ?? （没 layout 就是全部）`），那种情况按全部算。
   */
  // 正文带的全宽区域（business-page-layout 的 REGIONS_BY_BAND.main 里那两个吃全宽的）。
  // 直接取字段而不是按字符串索引——AppPageLayoutSchema 是具名字段，不是索引签名。
  const coveringBlockIds = page?.layout
    ? new Set([...(page.layout.main ?? []), ...(page.layout.supplement ?? [])])
    : null;
  const blocksCoverData = declaredBlocks.some(
    b =>
      EXPERIENCE_BLOCK_CAPABILITY_BY_TYPE[b.type] === "entityRows" &&
      (coveringBlockIds === null || coveringBlockIds.has(b.id))
  );

  /**
   * 这一页的积木里有没有已经把 workflow 画出来的（2026-08-11）。
   *
   * 向导页顶部有一条内置步骤条（下面 `page.view.kind === "wizard"` 那段），画的
   * 就是 `model.workflow.nodes`。而 `WorkflowTimeline` 区块画的是同一份数据——
   * 线上截图里同一页于是叠了**两条流程步骤条**，还各说一套（内置那条按声明序铺，
   * 把「拒绝兑换」画成正向第 4 步）。有区块画了就让区块画，宿主不再补。
   *
   * **不看区域**（跟 blocksCoverData 那条不同）：那条问的是"主区的行列表有没有
   * 人替代"，所以要求落在正文带；这条问的是"同一个东西是不是画了两遍"，在窄栏
   * 画一遍也是画了。WorkflowTimeline 的 allowedRegions 是 main/aside/supplement，
   * 没有 overlay 那种点了才出来的，所以声明了就一定看得见。
   */
  const blocksDrawWorkflow = declaredBlocks.some(b =>
    EXPERIENCE_BLOCK_TYPES_DRAWING_WORKFLOW.has(b.type)
  );

  /**
   * 内置步骤条要画的节点：**主链路**，不是 `workflow.nodes` 的声明顺序。
   *
   * 跟 WorkflowTimeline 共用 deriveWorkflowMainPath（那里写了为什么按声明序铺
   * Steps 会把驳回画成正向的下一步）。桌面档和手机档两处内置步骤条都读这一份。
   */
  const wizardMainPath = deriveWorkflowMainPath(
    model?.workflow?.nodes ?? [],
    model?.workflow?.transitions ?? []
  ).mainPath;

  // Step 6 FilterBar：本页可筛的枚举字段（有声明选项的 enum 字段）+
  // 可选日期范围字段（主实体第一个 date/datetime 字段）。
  const filterableEnumFields: FilterFieldOption[] = page
    ? page.detailFields
        .filter(f => f.type === "enum" && (f.options?.length ?? 0) > 0)
        .map(f => ({
          id: f.id,
          label: f.label,
          options: (f.options ?? []).map(o => ({
            value: o.id,
            label: o.label,
          })),
        }))
    : [];
  const dateRangeField = page
    ? (() => {
        const f = page.detailFields.find(
          fi => fi.type === "date" || fi.type === "datetime"
        );
        return f ? { id: f.id, label: f.label } : null;
      })()
    : null;
  const activePageFilter: PageFilterState = page
    ? (pageFilters[page.id] ?? { enumFilters: {} })
    : { enumFilters: {} };
  const rows = applyPageFilter(allRows, activePageFilter, dateRangeField?.id);

  const handlePageFilterChange = (patch: Partial<PageFilterState>) => {
    if (!page) return;
    const pageId = page.id;
    setPageFilters(prev => {
      const cur = prev[pageId] ?? { enumFilters: {} };
      return {
        ...prev,
        [pageId]: {
          enumFilters: { ...cur.enumFilters, ...(patch.enumFilters ?? {}) },
          dateRange:
            patch.dateRange !== undefined
              ? patch.dateRange
              : (cur.dateRange ?? null),
          // 2026-08-08：这里原来只重建 enumFilters 和 dateRange，于是
          // TagFilterRow 和 SearchBox 发过来的补丁被**默默丢掉**——区块本身
          // 渲染得完全正常，点了就是没反应。逐字段重建的写法每加一条通道
          // 就要回来补一次，漏了不报错，这正是下面那条护栏要挡的事。
          enumMulti:
            patch.enumMulti !== undefined
              ? { ...cur.enumMulti, ...patch.enumMulti }
              : cur.enumMulti,
          keyword: patch.keyword !== undefined ? patch.keyword : cur.keyword,
        },
      };
    });
  };

  // Step 6 QuickActionPanel：本页 navigate/createRecord 候选动作，标签现拼
  // （navigate→目标页标题；createRecord→目标实体名）。pageActions[].permitted
  // 派生时恒 true（deriveAppRuntimeSchema 没有角色上下文），真实权限判定和
  // handleBlockAction 点击时同一套公式（pageAccess.grantedActions），这里
  // 重算是为了按钮态本身就诚实——不能显示可点、点了却因权限被吞。
  const quickActionButtons: QuickActionButtonSpec[] = page
    ? page.pageActions
        .filter(a => a.type === "navigate" || a.type === "createRecord")
        .map(a => {
          const pa = pageAccess.get(page.id);
          const permitted =
            !a.permissionRef ||
            (pa?.grantedActions ?? []).includes(a.permissionRef);
          if (a.type === "navigate") {
            const target = schema.pages.find(p => p.id === a.targetPageRef);
            return {
              id: a.id,
              label: target ? `前往 ${target.title}` : "跳转",
              permitted,
            };
          }
          const entity = resolveEntityRef(a.entityRef, model);
          return {
            id: a.id,
            label: entity.resolved ? `新建 ${entity.label}` : "新建",
            permitted,
          };
        })
    : [];

  /**
   * enum 字段取值声明的查询（entityId + fieldId → 归一化 options）。
   *
   * 页面图表的 options 在 schema 派生时就带上了，freeform 的 chart 节点是
   * LLM 现写的 `{entityRef, dimensionFieldId}`，手里没有字段定义——不给它
   * 这个查询，环图图例就只能写取值 id（`refunded` / `unpaid`）。
   */
  const enumOptionsOf = React.useCallback(
    (entityId: string, fieldId: string) => {
      const field = model?.datamodel?.entities
        ?.find(e => e.id === entityId)
        ?.fields?.find(f => f.id === fieldId);
      return normalizeFieldOptions(field?.type, field?.options);
    },
    [model]
  );

  /**
   * 字段显示名查询，给 DataTable 区块的列头用（2026-07-28）。
   *
   * 区块渲染器手里只有 binding.entityRef 和运行时行数据，没有字段定义，
   * 于是列头一直在打印字段 id（`lot_code`），跟同页其它表格的中文列名
   * 坐在一起格外刺眼。查不到回落 undefined，渲染器自己退回字段 id。
   */
  const fieldLabelOf = React.useCallback(
    (entityId: string, fieldId: string) =>
      model?.datamodel?.entities
        ?.find(e => e.id === entityId)
        ?.fields?.find(f => f.id === fieldId)?.name || undefined,
    [model]
  );

  /**
   * 字段类型的按需查询（2026-08-07，表单族积木用）。
   *
   * RecordForm / RecordFormDialog / StepsForm 要按字段类型决定出哪种控件。
   * 跟 fieldLabelOf 同一条路子：渲染器手里只有 binding 和运行时行数据，
   * 没有字段定义，所以从模型按需查；**查不到回落 undefined**，渲染器自己
   * 按 string 处理，不在这里替它猜。
   */
  const fieldTypeOf = React.useCallback(
    (entityId: string, fieldId: string) =>
      model?.datamodel?.entities
        ?.find(e => e.id === entityId)
        ?.fields?.find(f => f.id === fieldId)?.type || undefined,
    [model]
  );
  /**
   * 字段的**完整声明**，表单族积木专用（2026-08-08，阶段④）。
   *
   * 上面 fieldLabelOf / fieldTypeOf 都是从同一个字段对象上摘一样东西下来。
   * 阶段④要接 `format`（金额/评分/进度…）本来会加第三个，接着 ref 下拉又要
   * 第四个（`refEntityId`）——每加一样就多一根线、两个宿主各改一处、护栏补
   * 一条，**漏了不报错**。所以这里改成把字段声明整个传下去。
   *
   * 归一化在这里做，不推给渲染器：格式与类型不匹配的声明要丢掉（number 字段
   * 声明 masked、string 字段声明 money 都是非法的），非法 tone 降级 default。
   * 这一层的四个读侧消费者无一例外都归一化过，表单侧不该是那个例外——一个坏
   * 声明就能把手机号字段画成金额框。
   */
  const fieldSchemaOf = React.useCallback(
    (entityId: string, fieldId: string): AppFormFieldSchema | undefined => {
      const field = model?.datamodel?.entities
        ?.find(e => e.id === entityId)
        ?.fields?.find(f => f.id === fieldId);
      if (!field) return undefined;
      const type = String(field.type || "string").toLowerCase();
      const schema: AppFormFieldSchema = {
        id: field.id,
        label: field.name || field.id,
        type,
      };
      const options = normalizeFieldOptions(type, field.options);
      if (options.length > 0) schema.options = options;
      const format = normalizeFieldFormat(type, (field as { format?: string }).format);
      if (format) schema.format = format;
      const refEntityId = (field as { refEntityId?: string }).refEntityId;
      if (refEntityId) schema.refEntityId = refEntityId;
      return schema;
    },
    [model]
  );

  // antd v5 的静态 message.xxx() 拿不到 ConfigProvider 上下文（控制台明写着
  // 「Static function can not consume context like dynamic theme」）——身份主色、
  // 深色/紧凑档、圆角配方全都下发不到提示条上。改用 hook 版拿带上下文的实例，
  // messageHolder 挂在 ConfigProvider 里面（见下方渲染处）。
  const [messageApi, messageHolder] = message.useMessage();
  /** 提示的统一出口：设备分流 + 落在画布内 + 带主题上下文，调用点只给档位和文案。 */
  const toast = React.useCallback(
    (kind: "success" | "warning" | "info" | "error", content: string) =>
      notify(isPhone, kind, content, () => canvasEl, messageApi),
    [isPhone, canvasEl, messageApi]
  );

  const apply = (next: RuntimeState) => {
    setState(next);
    saveRuntimeState(sessionId, next);
    notifyRuntimeChanged(sessionId);
  };

  // 元素级游标探针：开着游标时，埋点元素悬停上报目标 + 类名描边（对齐焦点）
  const probe = (t: XrayTarget): React.HTMLAttributes<HTMLElement> =>
    xrayActive && onXrayTarget
      ? {
          className: "xray-el",
          onMouseEnter: () => onXrayTarget(t),
          onMouseLeave: () => onXrayTarget(null),
        }
      : {};

  const refRowsFor = (field: AppFormFieldSchema) => {
    if (!field.refEntityId) return [];
    return (state.entities[field.refEntityId] ?? []).map(r => ({
      id: r.id,
      label: String(Object.values(r.values)[0] ?? r.id),
    }));
  };

  /** 关详情：未确认的 AI 建议随之丢弃（不悄悄写回）。两个设备档共用。 */
  const closeDetail = () => {
    setDetailRow(null);
    setAiError(null);
    setAiSuggestion(null);
  };

  /** enum 字段的历史取值（已写入行里出现过的，去重）——无声明取值时的候选来源。 */
  const enumOptionsFor = (field: AppFormFieldSchema) => {
    if (field.type !== "enum" || !page?.entityId) return [];
    return [
      ...new Set(
        (state.entities[page.entityId] ?? [])
          .map(r => String(r.values[field.id] ?? "").trim())
          .filter(Boolean)
      ),
    ];
  };

  const closeForm = () => {
    setFormOpen(false);
    setFormValues({});
    setEditingRowId(null);
    setFormProblems({});
  };

  /** 新建与编辑共用一条提交路径——差别只在最后落地那一步是 add 还是 update。 */
  const handleCreate = () => {
    if (!page?.entityId) return;
    // 校验带上 state.entities：ref 字段要能验"指向的记录真的存在"。
    const problems = validateRowFields(
      model,
      page.entityId,
      formValues,
      state.entities
    );
    if (problems.length > 0) {
      // 字段级的红字标在对应那一栏；同时保留 toast，手机档没有 Form.Item 的
      // 错误位，只靠红字的话那边等于没提示。
      setFormProblems(
        Object.fromEntries(problems.map(p => [p.fieldId, p.message]))
      );
      toast("warning", problems.map(p => p.message).join("；"));
      return;
    }
    if (editingRowId) {
      apply(updateRow(state, page.entityId, editingRowId, formValues));
      closeForm();
      toast("success", "已保存");
      return;
    }
    // 第一条真实数据落地前，先把这张表的演示种子整批清掉——种子和真实数据
    // 不混表，否则用户找不到自己刚写的那条，「示例数据」徽标也不再准确。
    const { state: next } = addRow(
      dropSeedRowsFor(state, page.entityId),
      page.entityId,
      formValues,
      new Date().toISOString()
    );
    apply(next);
    closeForm();
    toast("success", "已保存");
  };

  /**
   * AI 生成（三期"可解释输出"）：当前行喂给绑定能力（真 LLM，explain 通道），
   * 成功后不直接写回——先落建议卡（建议值+置信度+依据），用户确认才应用。
   */
  const runAiAction = async (action: AppAiActionSchema) => {
    if (!page?.entityId || !detailRow || aiRunningCapId) return;
    const entityId = page.entityId;
    const rowId = detailRow.id;
    setAiRunningCapId(action.capId);
    setAiError(null);
    setAiSuggestion(null);
    try {
      const res = await fetch("/api/sliderule/aigc-tryrun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: {
            id: action.capId,
            name: action.label,
            inputFields: action.inputFields,
            outputField: `${entityId}.${action.outputFieldId}`,
          },
          inputs: buildAiActionInputs(action, entityId, detailRow.values),
          goal: appTitle,
          explain: true,
        }),
      });
      const body = res.ok
        ? ((await res.json()) as {
            ok: boolean;
            output?: string;
            confidence?: number;
            rationale?: string;
            code?: string;
            detail?: string;
          })
        : { ok: false, code: `HTTP_${res.status}`, detail: await res.text() };
      if (!body.ok || body.output === undefined) {
        setAiError({ code: body.code ?? "UNKNOWN", detail: body.detail ?? "" });
        return;
      }
      setAiSuggestion({
        action,
        entityId,
        rowId,
        output: body.output,
        confidence:
          typeof body.confidence === "number" ? body.confidence : null,
        rationale: body.rationale?.trim() || null,
      });
    } catch (e) {
      setAiError({ code: "NETWORK_ERROR", detail: String(e) });
    } finally {
      setAiRunningCapId(null);
    }
  };

  /** 建议卡「确认并应用」：此刻才真正写回行字段。 */
  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    const { action, entityId, rowId, output } = aiSuggestion;
    const next = updateRow(state, entityId, rowId, {
      [action.outputFieldId]: output,
    });
    apply(next);
    const updated = (next.entities[entityId] ?? []).find(r => r.id === rowId);
    if (updated) setDetailRow(updated);
    setAiSuggestion(null);
    toast("success", `已应用 AI 建议 →「${action.outputLabel}」`);
  };

  const handleSubmitToWorkflow = (rowId: string, rowLabel: string) => {
    if (!page?.entityId) return;
    const { state: next, instance } = startInstance(
      state,
      model,
      `${page.title} · ${rowLabel}`,
      new Date().toISOString(),
      { entityId: page.entityId, rowId }
    );
    if (instance) {
      apply(next);
      toast("success", `已提交审批：${instance.title}（到 Workflow 试运行里推进）`);
    }
  };

  // 行操作跨设备共用同一套 onClick，只换按钮壳：手机档 antd-mobile Button
  // （触摸目标够大、按下有原生反馈），桌面档 antd type="link"。外层容器也分档
  // ——antd Space 是桌面组件，手机上直接用 flex，少一层 PC DOM。
  const rowActions = (row: RuntimeRow) => {
    const submit = (e: React.MouseEvent) => {
      e.stopPropagation();
      handleSubmitToWorkflow(
        row.id,
        String(Object.values(row.values)[0] ?? row.id)
      );
    };
    const remove = (e: React.MouseEvent) => {
      e.stopPropagation();
      apply(deleteRow(state, page!.entityId!, row.id));
    };
    if (isPhone) {
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {page?.workflowLinked && (
            <span
              {...probe({ kind: "workflow", label: "提交审批", pageId: page.id })}
            >
              <React.Suspense fallback={null}>
                <LazyPhoneActionButton color="primary" onClick={submit}>
                  提交审批
                </LazyPhoneActionButton>
              </React.Suspense>
            </span>
          )}
          <React.Suspense fallback={null}>
            <LazyPhoneActionButton color="danger" onClick={remove}>
              删除
            </LazyPhoneActionButton>
          </React.Suspense>
        </div>
      );
    }
    return (
      <Space size="small">
        {page?.workflowLinked && (
          <span
            {...probe({ kind: "workflow", label: "提交审批", pageId: page.id })}
          >
            <Button size="small" type="link" onClick={submit}>
              提交审批
            </Button>
          </span>
        )}
        {/* 删除是不可逆的，此前一点就没了——展会上访客手一滑就把演示数据
            删掉，还不知道自己干了什么。antd Popconfirm 是这个场景的标准解，
            不用自己搭一个确认弹框。手机档不套：那边是左滑出删除键，
            滑动本身已经是"不会误触"的确认动作。 */}
        <Popconfirm
          title="删除这条记录？"
          description="删掉之后无法恢复。"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          getPopupContainer={() => canvasEl ?? document.body}
          onConfirm={() => {
            apply(deleteRow(state, page!.entityId!, row.id));
            toast("success", "已删除");
          }}
        >
          <Button
            size="small"
            type="link"
            danger
            onClick={e => e.stopPropagation()}
          >
            删除
          </Button>
        </Popconfirm>
      </Space>
    );
  };

  // 表格列：列设置勾选优先（从实体全字段挑），否则默认列；
  // 每列自带排序（按字段类型）与筛选（enum/低基数真实取值）——表格自带能力，不走设计面板。
  // kanban 范式的看板列字段（派生层已保证是主实体 enum 字段；再解析一次
  // 拿到带 options 的完整字段 schema，解析不到 = 视图退回表格）
  const kanbanStatusField =
    page && page.view.kind === "kanban" && page.view.statusFieldId
      ? page.detailFields.find(f => f.id === page.view.statusFieldId)
      : undefined;

  const chosenColIds = page ? tableColPrefs[page.id] : undefined;
  const shownColumns = chosenColIds
    ? (page?.detailFields ?? []).filter(f => chosenColIds.includes(f.id))
    : (page?.columns ?? []);
  const columns = [
    ...shownColumns.map(c => ({
      title: c.label,
      dataIndex: ["values", c.id],
      key: c.id,
      ellipsis: true,
      // 列头过滤下拉的候选值取全量 allRows（不随 FilterBar 收窄），避免选项
      // 随筛选结果消失。
      ...buildColumnFeatures(c, allRows),
      onHeaderCell: () =>
        page?.entityId
          ? probe({
              kind: "field",
              entityId: page.entityId,
              fieldId: c.id,
              label: c.label,
            })
          : {},
      // 字段语义渲染（加厚 schema 一期）：enum tone 徽标 / 金额 / 进度条 / 星级 / 脱敏
      render: (v: unknown) => <FieldValue field={c} value={v} />,
    })),
    {
      title: "操作",
      key: "__actions",
      width: 170,
      render: (_: unknown, row: RuntimeRow) => rowActions(row),
    },
  ];

  /**
   * 列设置（ProTable 式齿轮）：从实体全字段勾选表格列。
   *
   * ── 三步走的第③步：收掉重复的那一个（2026-08-08）────────────────────
   *
   * 这个齿轮改的是 `tableColPrefs` → `page.columns` → **内置表格**的列。
   * 第②步翻转默认之后，声明了积木且积木里有表格的页面**根本不渲染内置表格**
   * ——那时候这个齿轮不只是跟 ColumnSettingPanel 重复，它是**完全失效的**：
   * 点开、勾掉一列，屏幕上什么都不会变。
   *
   * 接线台实测（三页并排）：
   *   积木档   齿轮 1 个 + ColumnSettingPanel 1 个   ← 重复，且齿轮无效
   *   兜底档   齿轮 1 个（内置表格在，它是唯一的那个）
   *   骨架档   ProTable 自带的那个（options.setting）
   *
   * 所以判据不是"有没有 ColumnSettingPanel"，是"**内置表格在不在屏幕上**"
   * ——它governs 谁，就跟着谁出现。这跟 pro-components 的分法一致：
   * 那边 ColumnSetting 是 ProTable `columnsState` 的一个视图，表不在、
   * 设置面板也就无从谈起。
   *
   * 两份列状态**故意不合并**：`tableColPrefs` 按页面 id 存（内置表格没有区块
   * id），`columnState` 按目标区块 id 存。合并要先给内置表格编一个假 id，
   * 那是为了对称而对称。等内置表格哪天真的退成一个区块，再合。
   */
  const builtInTableOnScreen = !(blocksOwnPage && blocksCoverData);
  const columnSettings = page && builtInTableOnScreen && page.detailFields.length > 0 && (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={
        <div
          style={{
            maxHeight: 260,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {page.detailFields.map(f => {
            const current =
              tableColPrefs[page.id] ?? page.columns.map(c => c.id);
            const checked = current.includes(f.id);
            return (
              <Checkbox
                key={f.id}
                checked={checked}
                onChange={e => {
                  const next = e.target.checked
                    ? [...current, f.id]
                    : current.filter(id => id !== f.id);
                  // 保实体字段声明序 + 至少保留一列
                  const ordered = page.detailFields
                    .map(d => d.id)
                    .filter(id => next.includes(id));
                  if (ordered.length > 0)
                    setTableColPrefs(prev => ({ ...prev, [page.id]: ordered }));
                }}
              >
                {f.label}
              </Checkbox>
            );
          })}
        </div>
      }
    >
      <Button
        size="small"
        type="text"
        icon={<SettingOutlined />}
        title="列设置"
        data-testid="app-table-col-settings"
      />
    </Popover>
  );

  const recentInstances = [...state.instances].slice(-5).reverse();

  // E40.2 应用身份：主题 token 决定品牌区/主色/内容底色/图表配色；缺省 = azure（老模型渲染与历史一致）。
  // 声明必须在 chartCard 之前——homeContent 是即时求值的 JSX（非函数），
  // 里面 .map(chartCard) 在这一行就会同步执行，晚声明会触发 TDZ 报错。
  // 第三个参数是**图表配色的挑选键**（2026-08-04）：应用名每个应用不同且稳定，
  // 所以同一个应用每次打开图表颜色一致，不同应用之间换一套。应用名缺失时退回
  // 老行为（全站同一套图表色），不去编一个 key——编出来的键会让同一个应用在
  // 不同渲染路径上拿到不同颜色，比"都一样"更糟。
  // 第四个参数（2026-08-04）：这个应用参照图上读出来的图表色。验得过就用它，
  // 第三个参数那套账本色序退为兜底——账本 8 套是同一条 ramp 的 8 个旋转，
  // 不同应用摆在一起仍然像同一套色，参照图那份才是为这个应用画的。
  const identityTheme = resolveIdentityTheme(
    schema.identity.themeId,
    schema.identity.generatedTheme,
    schema.appName || undefined,
    schema.identity.chartColors
  );

  // 工作台内置图：ECharts 基建（与页面级声明图表同一 lazy chunk / 同一套 dataviz 约定）
  /** 图表正文（真图 or 诚实空态）——两个设备档共用，只有外面那层卡片不同。 */
  const chartBody = (chart: AppChartSchema, height: number) => {
    let option: Record<string, unknown> | null = null;
    let emptyHint = "";
    const ariaLabel = chart.label;
    if (chart.source === "entities:rowcount") {
      option = buildEntityRowcountOption(
        (model.datamodel?.entities ?? []).slice(0, 6).map(e => ({
          label: e.name || e.id,
          value: (state.entities[e.id] ?? []).length,
        })),
        { primary: identityTheme.primary, categorical: identityTheme.charts }
      );
      emptyHint = "暂无数据 — 到业务页面「新建」写入";
    } else if (chart.source === "instances:status") {
      const counts: Record<string, number> = {};
      for (const inst of state.instances)
        counts[inst.status] = (counts[inst.status] ?? 0) + 1;
      option = buildInstanceStatusOption(counts);
      emptyHint = "暂无流程实例 — 到业务页面「提交审批」发起";
    }
    if (!option)
      return (
        <div style={{ fontSize: 11, color: INK.faint, padding: "16px 0" }}>
          {emptyHint}
        </div>
      );
    return (
      <React.Suspense
        fallback={
          <div style={{ fontSize: 11, color: INK.faint, padding: "16px 0" }}>
            图表加载中…
          </div>
        }
      >
        <LazyEchartsChart
          option={option}
          height={height}
          ariaLabel={ariaLabel}
        />
      </React.Suspense>
    );
  };

  const chartCard = (chart: AppChartSchema) => (
    <Card
      key={chart.id}
      title={chart.label}
      size="small"
      style={{ flex: 1, minWidth: 0 }}
      data-testid={`app-runtime-${chart.id}`}
    >
      {chartBody(chart, 168)}
    </Card>
  );

  const timelineCard = (
    <Card title="审批动态" size="small" style={{ flex: 1.2, minWidth: 0 }}>
      {recentInstances.length === 0 ? (
        <div style={{ fontSize: 11, color: INK.faint }}>
          暂无流程实例 — 到业务页面「提交审批」发起
        </div>
      ) : (
        <Timeline
          items={recentInstances.map(inst => {
            const meta = STATUS_META[inst.status] ?? STATUS_META.running;
            return {
              color:
                inst.status === "running"
                  ? "blue"
                  : inst.status === "completed"
                    ? "green"
                    : "red",
              children: (
                <div style={{ fontSize: 12 }}>
                  <div
                    style={{
                      color: INK.value,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inst.title}
                  </div>
                  <div style={{ color: INK.label, marginTop: 2 }}>
                    {nodeById(model, inst.currentNodeId)?.name ??
                      inst.currentNodeId}
                    <Tag
                      style={{ marginLeft: 8 }}
                      color={
                        meta.color === "#1677ff"
                          ? "processing"
                          : inst.status === "completed"
                            ? "success"
                            : "error"
                      }
                    >
                      {meta.label}
                    </Tag>
                  </div>
                </div>
              ),
            };
          })}
        />
      )}
    </Card>
  );

  // 桌面/平板档首页。手机档走 phoneHomeContent（antd-mobile），所以这里
  // 不再有 isPhone 分支——留着会让人以为手机还走这条路。
  const homeContent = (
    <>
      <div style={{ display: "flex", gap: 16 }}>
        {schema.home.stats.map(s => (
          <Card
            key={s.id}
            size="small"
            style={{ flex: 1 }}
            styles={{ body: { padding: "16px 20px" } }}
          >
            <Statistic
              title={s.label}
              value={statValue(state, schema, s.source)}
              suffix={s.suffix}
            />
          </Card>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
        {schema.home.charts.map(chartCard)}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
        <Card title="快速入口" size="small" style={{ flex: 1 }}>
          <Space wrap>
            {schema.pages.map(p => {
              const locked = pageAccess.get(p.id)?.visible === false;
              return (
                <Button
                  key={p.id}
                  icon={locked ? <LockOutlined /> : undefined}
                  disabled={locked}
                  title={
                    locked ? `当前角色（${role ?? "-"}）无本页权限` : undefined
                  }
                  onClick={() => setActivePageId(p.id)}
                >
                  {p.title}
                </Button>
              );
            })}
          </Space>
          {[...pageAccess.values()].some(a => !a.visible) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#999" }}>
              <LockOutlined /> 当前角色不可见{" "}
              {[...pageAccess.values()].filter(a => !a.visible).length} 个页面 —
              右上角切换角色试试（RBAC 权限实时生效）
            </div>
          )}
        </Card>
        {timelineCard}
      </div>
    </>
  );

  // 手机端首页：同一份数据（统计/图表/审批动态）交给 antd-mobile 渲染。
  // 桌面档那版是 antd 的 Card+Statistic+Timeline —— 之前手机档跟着复用，
  // 只加了几个 isPhone 三元调间距：间距对了，组件还是 PC 的。
  const phoneHomeContent = (
    <React.Suspense
      fallback={
        <Skeleton active paragraph={{ rows: 4 }} style={{ padding: "12px 4px" }} />
      }
    >
      <LazyPhoneHome
        stats={schema.home.stats.map(s => ({
          id: s.id,
          label: s.label,
          value: statValue(state, schema, s.source),
          suffix: s.suffix,
        }))}
        charts={schema.home.charts.map(c => ({
          id: c.id,
          label: c.label,
          node: chartBody(c, 148),
        }))}
        timeline={recentInstances.map(inst => ({
          id: inst.id,
          title: inst.title,
          nodeLabel:
            nodeById(model, inst.currentNodeId)?.name ?? inst.currentNodeId,
          statusLabel: (STATUS_META[inst.status] ?? STATUS_META.running).label,
          status:
            inst.status === "completed"
              ? "completed"
              : inst.status === "rejected"
                ? "rejected"
                : "running",
        }))}
        timelineEmptyHint="暂无流程实例 — 到业务页面「提交审批」发起"
      />
    </React.Suspense>
  );

  // 方案 C 的两张名单：哪些 kind 属于"总览页"、哪些区块类型属于"KPI/图表类"。
  // 总览页归 freeformOverview（AI 现场设计，每个应用长得不一样）；
  // 业务页归积木（模板渲染，整齐可预期）。
  const OVERVIEW_KINDS = new Set(["monitor", "dashboard"]);
  const KPI_BLOCK_TYPES = new Set(["MetricGrid", "TrendChart"]);

  /**
   * 总览页由 AI 设计**独占**（2026-08-03 用户裁决：「首页只由 LLM 动态设计，
   * 参照图上有什么就设计什么，不要固定组件」）。
   *
   * 一旦这一页有 freeformOverview，设计树就是这一页的全部内容：脚手架、固定
   * 榜/流一律让位。逐行内容不再靠固定积木补——设计模型用 rowsRef 自己画，
   * 真实行数据由渲染端绑进去（见 block-registry.tsx 的 FreeformRowsRef）。
   *
   * 为什么渲染端必须也收口、光在生成端收不够：那些积木仍然写在 page.blocks
   * 里，没被设计安置就会掉到设计区**外面**的脚手架里照样渲染——用户看到的
   * 固定组件一个没少，只是位置更差，还把本来就超高的版面再撑长一截（真跑
   * 量到的溢出是 790px，图表整个被裁在画布之外）。
   *
   * fail-open 不变：生成失败 → 没有 freeformOverview → 这个开关自动是 false，
   * 一切照旧走固定骨架，页面不会因此变空。
   */

  // 体验区块渲染：桌面壳与手机壳共用同一份摆法逻辑，只有槽位来源分档。
  // 抽成函数之前它内联在 defaultPageContent 里，于是手机档一个区块都渲染不到。
  // Step 5：区块事件 → 页面动作调度（零破坏，不影响 aiActions 路径）。
  // 2026-08-01 提到组件层：此前定义在 renderExperienceBlockScaffold 闭包里，
  // 首页设计路径（renderFreeformOverview）够不到它，是下面那份共享 props
  // 一直缺 onAction 的直接原因。
  /**
   * ── 页面级管道（2026-08-08，列表页归属三步走的第①步）────────────────
   *
   * 三样东西一直**长在固定骨架身上**：新建表单、行详情抽屉、演示数据徽标。
   * 骨架自己调 setFormOpen / setDetailRow，积木那条路想干同一件事没有入口
   * ——于是积木永远只能"显示"，不能"打开点什么"。
   *
   * 这一步只做一件事：**把这三样从骨架身上摘下来，变成整页共用的服务**。
   * 骨架照旧调它们（行为一模一样，视觉零变化），积木从今天起也能调。
   *
   * 命名和分层照 nocobase 的 ActionContext / ActionContainer
   *（`schema-component/antd/action/`）：那边的关键一条是
   * **openMode 决定容器（drawer / modal / page），而不是触发它的那个组件决定**。
   * 我们这边同理——积木只说"打开这条记录"，落在抽屉还是平板右栏、还是手机
   * 底部弹层，由页面自己按设备决定，积木不需要知道。
   */
  const pagePipes = React.useMemo(
    () => ({
      /** 打开「新建」表单（骨架的新建按钮、积木的 createRequest 都走这条）。 */
      openCreate: () => {
        setFormValues({});
        setEditingRowId(null);
        setFormProblems({});
        setFormOpen(true);
      },
      /**
       * 打开「编辑」表单：把这一行的值预填进去，落地时走 update 而不是 add。
       *
       * 2026-08-13 补。在这之前**编辑根本没有落点**——积木的 editRequest 被
       * 接到了 openRecordById 上，于是行内点「编辑」弹出来的是详情抽屉。
       * 一个只读的抽屉顶着「编辑」这个名字，比没有这个按钮更误导。
       */
      openEdit: (rowId: string) => {
        for (const list of Object.values(state.entities)) {
          const hit = (list ?? []).find(r => r.id === rowId);
          if (hit) {
            setFormValues({ ...hit.values });
            setEditingRowId(rowId);
            setFormProblems({});
            setFormOpen(true);
            return;
          }
        }
      },
      /** 打开某一行的详情（骨架的行点击、积木的 viewRequest 都走这条）。 */
      openRecord: (row: RuntimeRow | null | undefined) => {
        if (row) setDetailRow(row);
      },
      /** 按 id 找行再打开 —— 积木事件里带的是 rowId，不是整行。 */
      openRecordById: (rowId: string) => {
        for (const list of Object.values(state.entities)) {
          const hit = (list ?? []).find(r => r.id === rowId);
          if (hit) {
            setDetailRow(hit);
            return;
          }
        }
      },
    }),
    [state.entities]
  );

  const handleBlockAction = (
    actionId: string,
    eventData?: Record<string, unknown>
  ) => {
    if (!page) return;
    // rowSelect 是**区块事件**，不是页面动作。下面那句
    // `page.pageActions.find(...)` 查不到就 return，所以在这之前处理——
    // 否则点一行永远什么都不发生（详情和关联单据表就都认不出"这是哪一条"）。
    if (actionId === "rowSelect") {
      const rowId = String(eventData?.rowId ?? "");
      if (!rowId) return;
      const owner = Object.entries(state.entities).find(([, list]) =>
        (list ?? []).some(r => r.id === rowId)
      );
      if (owner) setFocus(prev => ({ ...prev, [owner[0]]: rowId }));
      return;
    }
    // 积木要打开的那几样，跟骨架走同一条管道（见 pagePipes 的说明）。
    //
    // rowSelect 故意**不**弹抽屉：这一页可能已经摆了 RecordDetail 积木，
    // 点一行的本意是"换一条看"，再弹一个抽屉是同一件事做两遍。
    //
    // 2026-08-13 把「看」和「改」分开：以前只有 editRequest 一个入口、还接在
    // 详情上，结果是**行内两个链接一个没反应、一个名不副实**——「查看」发
    // rowSelect（只换焦点，页面上已有详情面板时纹丝不动），「编辑」弹出只读
    // 抽屉。现在 viewRequest 管看，editRequest 管改，各归各位。
    if (actionId === "viewRequest") {
      const rowId = String(eventData?.rowId ?? "");
      if (rowId) pagePipes.openRecordById(rowId);
      return;
    }
    if (actionId === "editRequest") {
      const rowId = String(eventData?.rowId ?? "");
      if (rowId) pagePipes.openEdit(rowId);
      return;
    }
    if (actionId === "createRequest") {
      pagePipes.openCreate();
      return;
    }
    // 转移三种（词表 2026-08-14 晚扩容）：与 HTML 舞台走同一个纯函数
    // applyHtmlWorkflowAction——角色把关、防重复提交、终态判定只有一份口径。
    if (
      actionId === "submitRequest" ||
      actionId === "approveRequest" ||
      actionId === "rejectRequest"
    ) {
      const rowId = String(eventData?.rowId ?? "");
      const entityRef = String(eventData?.entityRef ?? "");
      if (!rowId || !entityRef) return;
      const kind =
        actionId === "submitRequest"
          ? "submitWorkflow"
          : actionId === "approveRequest"
            ? "approveWorkflow"
            : "rejectWorkflow";
      const res = applyHtmlWorkflowAction(
        state,
        model,
        { kind, entityId: entityRef, rowId },
        role,
        new Date().toISOString()
      );
      if (res.ok) {
        apply(res.state);
        toast("success", res.message);
      } else {
        toast("warning", res.message);
      }
      return;
    }
    const action = page.pageActions.find(a => a.id === actionId);
    if (!action) return;
    // 实际权限检查：permissionRef 须在当前角色 grantedActions 里。
    const pa = pageAccess.get(page.id);
    const permitted =
      !action.permissionRef ||
      (pa?.grantedActions ?? []).includes(action.permissionRef);
    if (!permitted) return;
    switch (action.type) {
      case "navigate":
        if (action.targetPageRef) setActivePageId(action.targetPageRef);
        break;
      case "createRecord":
        // 复用既有「新建」表单：只支持目标实体=本页主实体的场景（表单
        // 字段就是照本页主实体拼的）；指向别的实体如实拒绝，不假装能建。
        if (action.entityRef && action.entityRef === page.entityId) {
          pagePipes.openCreate();
        } else {
          toast("info", "该操作指向的实体暂不支持在此页创建");
        }
        break;
      case "changeFilter":
        console.log("[action:changeFilter]", actionId, eventData);
        break;
      default:
        console.log(`[action:${action.type}]`, actionId, eventData);
    }
  };

  /**
   * 积木渲染 props 的**唯一真相源**（2026-08-01）。
   *
   * 积木有两条渲染入口：page.layout 的 5 槽位骨架，以及首页设计树里用
   * blockRef 嵌进去的（✱C 桥）。此前两处各自逐个列举 props，结果漂移了：
   * 骨架路径传 12 个，首页设计路径只传 4 个（漏了 onAction / pageActions /
   * workflow / filter 那一组）。而 FreeformInsight 渲染器是整包透传的，
   * 它自己收到什么就转交什么——于是嵌进首页设计的 QuickActionPanel 拿不到
   * pageActions 渲染成空面板、WorkflowTimeline 拿不到 workflow 走 empty 分支，
   * 同一个积木在下面骨架里却是好的。表现为"上面空壳、下面能用"。
   *
   * 收成一份对象后两条路径同源：以后加 prop 只能同时加给两边，漂移不了。
   * （block-registry 里那句"逐个列举等于每加一个 prop 就埋一次漏传"说的
   * 就是这件事，只是当时只在下游做了整包透传，上游两个入口还是各写各的。）
   */
  const sharedBlockRendererProps = {
    sessionId,
    onAction: handleBlockAction,
    pageActions: quickActionButtons,
    filterState: activePageFilter,
    filterFieldOptions: filterableEnumFields,
    dateRangeField,
    onFilterChange: handlePageFilterChange,
    selection,
    onSelectionChange: (entityRef: string, rowIds: string[]) =>
      setSelection(prev => ({ rowIds: { ...prev.rowIds, [entityRef]: rowIds } })),
    columnState,
    onColumnStateChange: (blockId: string, next: BlockColumnState) =>
      setColumnState(prev => ({ ...prev, [blockId]: next })),
    focus,
    workflow: model.workflow,
    // 角色 id → 中文名。不传的后果是流程步骤条底下直接显示 `music_member`
    // 这类内部标识符（线上截图逮到过）。
    roleLabelOf: (roleId: string) => schema.roleLabels[roleId],
    // 注意：这是**未收窄**的全量行。筛选是按区块算的（谁筛我），
    // 在下面 renderBlock 里按 targets 逐块套上去——见 rowsForBlockOf。
    entityRows: state.entities,
    chartPalette: {
      primary: identityTheme.primary,
      categorical: identityTheme.charts,
    },
    enumOptionsOf,
    fieldLabelOf,
    fieldTypeOf,
    fieldSchemaOf,
  };

  const renderExperienceBlockScaffold = (
    forPhone: boolean,
    pageContent?: React.ReactNode
  ) => {
    if (!page) return null;
    // 首页归 AI 设计独占（见 freeformOwnsPage）——设计树没安置的积木不再
    // 外挂到设计区下面。
    if (freeformOwnsPage) return null;
        // 保守策略：_fromLegacy 区块只是转换占位，渲染仍走旧路径（statsBand 等）。
        // 真正的新模型 blocks 不带 _fromLegacy，走 ExperienceBlockBoundary。
        const directBlocks = page.experienceBlocks
          .filter(
            b =>
              !(b as import("./block-registry").ExperienceBlockInstance)
                ._fromLegacy
          )
          // 归属划分（2026-07-28）：KPI/图表在一页里只能由一条路负责。
          //
          // 总览页（monitor/dashboard）的 stats/charts 会被 ENRICH 重新设计成
          // freeformOverview——那是同一份声明的美化版，不是另一份内容。这类页
          // 上再出 MetricGrid/TrendChart 积木，就会和总览区画出两张说同一件事
          // 的卡。这里直接把它们摘掉：不指望 LLM 一定守规矩，渲染层兜死。
          //
          // 反方向在下面（statsBand/chartsBand 让位给积木）。
          .filter(b => !(OVERVIEW_KINDS.has(page.view.kind) && KPI_BLOCK_TYPES.has(b.type)))
          // 同一条"一页一个主人"的规矩，用在表格上（2026-07-28 真跑发现）。
          //
          // 每一页本来就会把自己的主实体渲染成一张表——带中文列名、枚举彩色标签、
          // 排序/筛选/分页/行内操作。DataTable 积木绑同一个实体时画的是**同一批行**，
          // 却只有裸字段名（lot_code / supplier_id）、没有枚举标签、没有操作，
          // 于是一页里同样的数据出现两遍，上面那遍还更难看。
          //
          // 实测：放开 DataTable 生成后，五个业务页全中——模型不知道"这一页已经
          // 自带主实体表"，只当页面是张白纸。所以跟 KPI 一样在渲染层兜死。
          //
          // 只摘"绑主实体"的那些；绑**别的**实体的 DataTable 是真新增内容
          //（例如库存页上挂一张供应商表），必须留着。
          //
          // **2026-08-08 第②步之后这条规矩只在骨架还在的时候生效。** 翻转默认
          // 以后，声明了积木的页面根本不渲染内置表格，那时候这个 DataTable 就是
          // 这一页唯一的表——再摘掉的话页面直接空了。当初这条是为了挡"一页两张
          // 表"，现在"要不要内置表"由 businessPageGrid 那边决定，这里不该再摘。
          .filter(
            b =>
              !(
                !blocksOwnPage &&
                b.type === "DataTable" &&
                page.entityId &&
                (b.binding as { entityRef?: string } | undefined)?.entityRef ===
                  page.entityId
              )
          )
          // 同一条规矩的第三例（2026-07-28）：总览页不要筛选条。
          //
          // FilterBar 筛的是"本页主实体行"，可总览页压根不逐行展示数据，
          // 筛了看不出任何变化；更糟的是它绑单个实体，而总览页的 KPI/图表
          // 通常跨好几个实体（真跑那次跨了 4 个），筛一个也管不着另外三个。
          // 也就是说它在这类页面上是**功能性无效**的，不只是难看。
          //
          // 2026-08-11：判据从"名字叫 FilterBar"换成 **capability === "filter"**。
          // 上面那段理由一个字都不用改，但它对**所有**筛选类区块都成立。
          // 按名字挡等于只挡了这一族里最出名的那个：SavedViewTabs / TagFilterRow /
          // SearchBox 摆到总览页照样上屏、照样按不动。
          //
          // ⚠️ 数字更正（2026-08-11 复核）：原注释写"32 个里 31 个只发
          // filterChange"，真数是 **28/32**。例外是四个——SavedViewTabs 与
          // SavedSearchPanel 多发 submitRequest，HierarchicalCategoryPicker 多发
          // itemSelect，ValidatedFormTabs 只发 itemSelect（一个 filterChange 都没有）。
          //
          // 那能不能因此放过这 4 个？**不能**，别再往这个方向改：它们多发的事件
          // 同样到不了岸。`eventBindings`（事件名→动作 id）只在
          // app-runtime-schema.ts:823 被解析，全仓库没有第二处读它；而
          // handleBlockAction（:1607）只特判 rowSelect / editRequest /
          // createRequest，其余一律去 page.pageActions 里找 **id 等于事件名**的
          // 动作——动作 id 是模型生成的，不会恰好叫 "submitRequest"。放宽只是把
          // 按不动的控件放回总览页。真要救它们，先把 eventBindings 接上。
          // 同一条判据现在有三处：目录 pageKinds（filter 区块已剥掉 monitor/
          // dashboard）、提示词禁令（schema_legal 的 monitor_forbidden_live）、
          // 这里的渲染层兜底。三处同源同判据，别再各写各的。
          .filter(
            b =>
              !(
                OVERVIEW_KINDS.has(page.view.kind) &&
                EXPERIENCE_BLOCK_CAPABILITY_BY_TYPE[b.type] === "filter"
              )
          )
          // 同一条"一页一个主人"的规矩，第四例：**新建入口不许出现两个**
          //（2026-08-11 线上产物截图照出来的）。
          //
          // 现场：「团长管理」页右上角有脚手架的「+ 新建」，表格底下又有一个
          // 「新增团长」按钮——后者是 RecordFormDialog{title:"新增团长"} 画的。
          // 两个按钮打开的是同一张表单、写的是同一个实体，用户不知道该点哪个。
          //
          // 成因跟 DataTable 那条完全一样：**模型不知道这一页已经自带新建入口**，
          // 只当页面是张白纸。所以判据也照抄那条——只摘"绑本页主实体"的，
          // 绑**别的**实体的弹层表单是真新增内容（例如在团长页上新建自提点），
          // 必须留着。
          //
          // 同样只在脚手架还在的时候摘：`canCreate` 为假（无权限）或本页没有
          // 主实体时，脚手架那个按钮根本不出现，这时候它就是唯一的入口。
          .filter(
            b =>
              !(
                b.type === "RecordFormDialog" &&
                page.entityId &&
                pageAccess.get(page.id)?.canCreate !== false &&
                (b.binding as { entityRef?: string } | undefined)?.entityRef ===
                  page.entityId
              )
          );
        // 积木内部的自我去重：模型偶尔把同一份榜/流声明两次（见
        // page-panel-dedupe.ts 的内容指纹判定）。
        const dedupedBlocks = dedupeBlocksByPanelKey(directBlocks);
        if (dedupedBlocks.length === 0 && pageContent === undefined) return null;

        /**
         * 列设置面板要列出的字段 —— 从它 targets 指向的那张表来。
         *
         * **这一条不能进 sharedBlockRendererProps**：那份是整页共享的一份，
         * 而这个值是按区块算的。共享 props 那个模式挡的是"漏传"，挡不住
         * "本来就该按区块算"的东西。
         */
        const targetColumnsOf = (b: (typeof dedupedBlocks)[number]) => {
          const targets = (b.binding?.targets as string[] | undefined) ?? [];
          if (targets.length === 0) return undefined;
          const target = dedupedBlocks.find(x => x.id === targets[0]);
          if (!target) return undefined;
          const declared = target.binding?.fieldRefs as string[] | undefined;
          if (Array.isArray(declared) && declared.length > 0) return declared.map(String);
          const list = state.entities[String(target.binding?.entityRef ?? "")] ?? [];
          return [...new Set(list.flatMap(r => Object.keys(r.values ?? {})))].slice(0, 8);
        };

        /**
         * 一个数据区块**自己**看到的行 —— 只被指向它的筛选收窄。
         *
         * 2026-08-08 接线台逮到的：此前区块拿到的是 `state.entities` 全量，
         * 而 `applyPageFilter` 算出来的 `rows` 只喂给内置骨架那张表。也就是说
         * **筛选从来没有作用到区块上**——FilterBar / StatusTabs / TagFilterRow /
         * SearchBox 连着 DataTable 时，勾了、敲了，表一动不动。不是新通道没接，
         * 是这条路上筛选和区块从一开始就没接通。
         *
         * 做法照 ComponentsLibraryPage 的 rowsForBlock（那边一直是对的）：
         * 筛选区块显式声明自己筛谁（targets），数据区块反过来问"谁在筛我"。
         */
        const rowsForBlockOf = (blockId: string) => {
          const applies = dedupedBlocks.some(b =>
            (b.binding?.targets as string[] | undefined)?.includes(blockId)
          );
          if (!applies) return state.entities;
          const out: Record<string, RuntimeRow[]> = {};
          for (const [entityId, list] of Object.entries(state.entities)) {
            out[entityId] = applyPageFilter(
              list ?? [],
              activePageFilter,
              dateRangeField?.id
            );
          }
          return out;
        };

        const renderBlock = (block: (typeof dedupedBlocks)[number]) =>
          forPhone && PHONE_EXPERIENCE_BLOCK_TYPES.has(block.type) ? (
            <React.Suspense key={block.id} fallback={<Skeleton active paragraph={{ rows: 2 }} />}>
              <LazyPhoneExperienceBlock
                {...sharedBlockRendererProps}
                block={block}
              />
            </React.Suspense>
          ) : (
            <ExperienceBlockBoundary
              key={block.id}
              {...sharedBlockRendererProps}
              entityRows={rowsForBlockOf(block.id)}
              targetColumns={targetColumnsOf(block)}
              block={block}
            />
          );

        const blockById = new Map(dedupedBlocks.map(b => [b.id, b]));
        // 手机档用 layout.mobile 覆盖（未声明则退回桌面区域，同一套摆法）。
        // forPhone 由调用方传入——从前这里读的是 isPhone，而这段代码只在桌面
        // 壳里跑（手机壳走 phonePageContent），isPhone 恒 false，layout.mobile
        // 是死字段：LLM 在生成它、Gate 在校验它，运行时永远读不到。
        const regionSource =
          forPhone && page.layout?.mobile
            ? { ...page.layout, ...page.layout.mobile }
            : page.layout;
        // 没声明 layout 时把所有区块塞进 main —— 让它们整行依次铺开，跟
        // 从前塞 summary 的效果一样（两者都是全宽），但语义对了：那是页面
        // 主体内容，不是"页头摘要"。
        const regions = {
          header: regionSource?.header ?? [],
          headerExtra: regionSource?.headerExtra ?? [],
          headerContent: regionSource?.headerContent ?? [],
          tabs: regionSource?.tabs ?? [],
          filters: regionSource?.filters ?? [],
          metrics: regionSource?.metrics ?? [],
          charts: regionSource?.charts ?? [],
          main: regionSource?.main ?? (page.layout ? [] : dedupedBlocks.map(b => b.id)),
          supplement: regionSource?.supplement ?? [],
          aside: regionSource?.aside ?? [],
          footerBar: regionSource?.footerBar ?? [],
          overlay: regionSource?.overlay ?? [],
        } as Record<string, string[]>;
        const placedIds = new Set(Object.values(regions).flat());
        // 声明了 layout 但没被任何区域引用到的区块：如实照样渲染，不能因为
        // 没排进区域就悄悄丢内容——排在末尾，视觉上标为"未分配区域"。
        const orphanBlocks = dedupedBlocks.filter(b => !placedIds.has(b.id));
        const breakpoint: BusinessPageBreakpoint = forPhone
          ? "phone"
          : isTablet
            ? "tablet"
            : "desktop";
        const layouts =
          page.layout?.grid ??
          regionsToGrid(
            page.view.kind,
            {
              ...(regions as unknown as BusinessRegions),
              main: [...regions.main, ...orphanBlocks.map(b => b.id)],
            },
            // 几何必须知道内置主视图在不在。不告诉它，它就照样给
            // PAGE_CONTENT_REF 留三行、把正文带排到那三行之后——而这一格
            // 下面第 2014 行又会被摘掉，留下一片没人认领的空白。
            { hasPageContent: pageContent !== undefined }
          );
        let items = resolveBusinessGrid(layouts, breakpoint);
        const itemRefs = new Set(items.map(item => item.blockRef));
        const nextY = items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
        const missingBlocks: BusinessGridItem[] = dedupedBlocks
          .filter(block => !itemRefs.has(block.id))
          .map((block, index) => ({
            blockRef: block.id,
            x: 0,
            y: nextY + index,
            w: BUSINESS_GRID_COLUMNS[breakpoint],
            h: 1,
          }));
        items = [...items, ...missingBlocks];
        if (pageContent !== undefined) {
          items = ensurePageContentItem(items, breakpoint);
        } else {
          items = items.filter(item => item.blockRef !== PAGE_CONTENT_REF);
        }

        return (
          <div className="mb-3" data-testid="app-runtime-experience-block-layout">
            <BusinessPageGrid
              breakpoint={breakpoint}
              items={items}
              renderItem={blockRef => {
                if (blockRef === PAGE_CONTENT_REF) return pageContent ?? null;
                const block = blockById.get(blockRef);
                return block ? renderBlock(block) : null;
              }}
            />
          </div>
        );
  };

  // 页面级 KPI 的取数抽成一处，桌面 statsBand 与手机档共用——两边各算一遍的
  // 话，同一个指标在两个档位会出现一个有值、一个是"—"。只有摆法分档，取数不分。
  //
  // 2026-07-28：这里原本在"真实值为 0/null 时"临时造一批预览行算个数出来，
  // 那是只给 KPI 打的补丁——同一页的表格、图表、体验区块照样空着，一页里
  // 半边有数半边空。现在种子行已经在**运行时状态**这一层铺好了
  //（demo-seed.ts），所有取数口径共用同一批行，这里只需照常算，
  // 外加如实标一句"这些行是示例"。
  const pageStatDisplay = (stat: AppPageStatSchema) => {
    const rows = state.entities[stat.entityId] ?? [];
    return {
      value: pageStatValue(stat, rows),
      isPreview: entityShowsSeed(state, stat.entityId),
    };
  };

  // 页面图表的手机形态：取数与桌面 renderChartCard 完全一致
  //（同一个 buildEchartsOption + 同一份主题色），只把高度压到 140，
  // 空态文案也照搬——两个档位不能对同一份数据给出不同说法。
  const phoneChartNode = (chart: AppPageChartSchema) => {
    const chartRows = state.entities[chart.entityId] ?? [];
    if (chartRows.length === 0)
      return (
        <div style={{ fontSize: 11, color: INK.faint, padding: "12px 0" }}>
          暂无数据 — 写入「{chart.dimensionLabel}」后自动出图
        </div>
      );
    const option = buildEchartsOption(chart, chartRows, {
      primary: identityTheme.primary,
      categorical: identityTheme.charts,
    });
    // 维度取不到值时 buildEchartsOption 返回 null —— 如实给空态，不画空图
    if (!option)
      return (
        <div style={{ fontSize: 11, color: INK.faint, padding: "12px 0" }}>
          暂无数据 — 写入「{chart.dimensionLabel}」后自动出图
        </div>
      );
    return (
      <React.Suspense
        fallback={
          <div style={{ fontSize: 11, color: INK.faint, padding: "12px 0" }}>
            图表加载中…
          </div>
        }
      >
        <LazyEchartsChart
          option={option}
          height={140}
          ariaLabel={`${chart.label}：按${chart.dimensionLabel}统计${chart.metricLabel}`}
        />
      </React.Suspense>
    );
  };

  // 手机档看板：列分组复用桌面同一个纯函数 groupRowsForKanban——两档如果各分
  // 各的，同一条记录可能在桌面归 A 列、手机归"未归类"。这里只决定"当前看哪
  // 一列"，分组本身不重写。
  const phoneKanban =
    page && page.view.kind === "kanban" && kanbanStatusField
      ? groupRowsForKanban(
          rows,
          kanbanStatusField.id,
          kanbanStatusField.options ?? []
        )
      : null;
  // 选中列：默认第一列。列集合变了（换页/状态取值变化）时回到第一列，
  // 而不是卡在一个已经不存在的 key 上显示空白。
  const phoneKanbanKeys = (phoneKanban ?? [])
    .map((c: KanbanColumn) => c.id)
    .join("|");
  React.useEffect(() => {
    setPhoneKanbanKey(phoneKanban?.[0]?.id ?? "");
  }, [phoneKanbanKeys]);
  const phoneKanbanRows =
    phoneKanban?.find((c: KanbanColumn) => c.id === phoneKanbanKey)?.rows ??
    rows;

  // 手机档按 pageKind 决定出哪几段。取数与桌面共用（pageStatDisplay /
  // phoneChartNode），只有摆法分档——同一个指标不能在两个档位算出不同的数。
  // 声明位置：必须在 phoneSectionData / phonePageContent 之前——手机档
  // 2026-07-29 起也渲染这份设计版式，而且 phoneSectionData 要据它决定
  // 固定骨架让不让位。原来它挨着桌面的 defaultPageContent 放（2400 行开外），
  // 手机路径引用会直接 TDZ 报错。
  //
  // 2026-07-24：monitor 页面的总览区块——freeformOverview 是 Python
  // enrich_monitor_page_overviews 按这个页面已声明的 stats/charts 当内容
  // 清单、交给 FreeformInsight 设计出来的 KPI+图表版式（不再是所有 app
  // 首页都长一样的固定网格骨架）。数字仍然经 ExperienceBlockBoundary →
  // renderFreeformNode 的 dataRef 现算校验，不会因为换了渲染路径就失去
  // "不能编数字"这层保证。未声明（老快照/生成失败）时下面的
  // monitorCombinedRow 固定骨架原样兜底。
  //
  // 故意不包含 rankings/feeds——FreeformInsight 的 dataRef 只能表达聚合值
  // （count/sum/avg），没有"枚举真实第 N 行记录"的能力（真机测试过：LLM
  // 收到这个要求后只能画出表头+空表身）。排行榜/动态流这类必须逐行展示
  // 真实记录的内容，固定走 monitorDynamicLists 下面的动态渲染。
  /**
   * 按设备档取设计版式（2026-07-29，方案 B）。
   *
   * 回退语义照 react-grid-layout 的 findOrGenerateResponsiveLayout：
   * **有本档就用本档，没有就往更大的档回退**。这里只有两档，所以手机档
   * 取不到 mobile 就退回 root（桌面那份）——老快照、以及手机那版生成失败的
   * 页面都走这条路，配合 .phone-freeform-scope 的收窄仍然读得下来。
   */
  const renderFreeformOverview = (forPhone: boolean) => {
    if (!page?.freeformOverview) return null;
    const picked =
      (forPhone && page.freeformOverview.mobile) || page.freeformOverview;
    return (
      <div
        data-testid="app-runtime-monitor-freeform-overview"
        // 手机上到底用的是哪一档，真机排查时一眼看得出，不用去翻模型
        data-freeform-variant={
          forPhone && page.freeformOverview.mobile ? "mobile" : "root"
        }
      >
        {/* 共享同一份 props（见 sharedBlockRendererProps 的说明）：设计树里用
            blockRef 嵌进来的积木由 FreeformInsight 整包透传拿到它们，跟骨架
            路径逐字节一致。此前这里只传 4 个，嵌入的 QuickActionPanel /
            WorkflowTimeline 因此渲染成空壳。 */}
        <ExperienceBlockBoundary
          {...sharedBlockRendererProps}
          block={{
            id: `${page.id}:freeform-overview`,
            type: "FreeformInsight",
            freeformContent: picked,
          }}
        />
      </div>
    );
  };
  const monitorFreeformOverview = renderFreeformOverview(false);

  const phoneSectionData = (() => {
    if (!page) return null;
    const kind = page.view.kind;
    // freeformOverview 就是拿这一页的 stats/charts 重新设计出来的版式——
    // 同一份声明的美化版，不是另一份内容。它渲染了，固定骨架的 KPI/图表
    // 就必须让位，否则同样的数字在一屏里出现两遍（桌面档早就是这个规矩，
    // 见 defaultPageContent 里 monitorFreeformOverview 的分支）。
    const freeformTookOver = pageFreeformOwnsContent(page);
    const wantsMetrics =
      !freeformTookOver &&
      (kind === "dashboard" || kind === "monitor" || kind === "workbench");
    const wantsSteps = kind === "wizard";
    const stats =
      wantsMetrics && page.stats.length > 0
        ? page.stats.map(stat => {
            const { value, isPreview } = pageStatDisplay(stat);
            return {
              id: stat.id,
              label: stat.label,
              value,
              isPreview,
              prefix: stat.format === "money" ? "¥" : undefined,
              suffix: stat.format === "percent" ? "%" : undefined,
              precision:
                value !== null && Number.isInteger(value)
                  ? 0
                  : stat.format === "money"
                    ? 2
                    : 1,
            };
          })
        : [];
    const charts =
      wantsMetrics && page.charts.length > 0
        ? page.charts.map(c => ({
            id: c.id,
            label: c.label,
            node: phoneChartNode(c),
          }))
        : [];
    // wizard：流程节点即步骤条。桌面用横向 Steps，手机竖排更读得下来。
    // 顺序走主链路、积木画了就让位——跟桌面档同一套判据（见 blocksDrawWorkflow
    // 和 wizardMainPath 那两段注释）。手机档也渲染声明的积木（下面
    // renderExperienceBlockScaffold(true)），所以叠两条的问题在这一档一样成立。
    const steps =
      wantsSteps && !blocksDrawWorkflow && wizardMainPath.length > 0
        ? wizardMainPath.slice(0, 8).map(n => ({
            id: n.id,
            title: n.name || n.id,
            description: n.phase,
          }))
        : [];
    if (stats.length === 0 && charts.length === 0 && steps.length === 0)
      return null;
    return { stats, charts, steps };
  })();

  // 手机档日历：只算"哪些天有数据"和"选中那天有哪些行"。归组复用桌面
  // CalendarBoard 同一个 rowsByDateKey——两档对同一个值算出不同的天，
  // 会让日历上的圆点和下面的列表自己打架。
  const phoneCalendar =
    page && page.view.kind === "calendar" && page.view.dateFieldId
      ? (() => {
          const byKey = rowsByDateKey(rows, page.view.dateFieldId);
          const marked = new Set(byKey.keys());
          const selKey = phoneCalDate ? localDateKey(phoneCalDate) : null;
          // 选中日无记录时给空数组（不是回退全量）——用户点了 3 号就该看到
          // 3 号的情况，"这天没有"本身是答案。
          const filtered = selKey ? (byKey.get(selKey) ?? []) : rows;
          return { marked, filtered };
        })()
      : null;

  // 日历壳：非日历页直接透传（同 PhoneKanbanShell 的理由）。
  const PhoneCalendarShell = ({
    data,
    children,
  }: {
    data: { marked: Set<string>; filtered: unknown[] } | null;
    children: React.ReactNode;
  }) => {
    if (!data) return <>{children}</>;
    return (
      <React.Suspense fallback={<>{children}</>}>
        <LazyPhoneCalendar
          markedDates={data.marked}
          value={phoneCalDate}
          onChange={setPhoneCalDate}
        >
          {children}
        </LazyPhoneCalendar>
      </React.Suspense>
    );
  };

  // 手机档列表最终喂什么行：看板页给选中列、日历页给选中日、其余全量。
  // 两种范式不会同时出现（view.kind 是单选），所以这里是顺序取第一个命中的。
  const phoneListRows = phoneKanban
    ? phoneKanbanRows
    : (phoneCalendar?.filtered as typeof rows | undefined) ?? rows;

  // 看板壳：非看板页（columns 为 null/空）直接透传 children，省得在 JSX 里
  // 写"条件包裹"那种两份几乎一样的分支。
  const PhoneKanbanShell = ({
    columns,
    activeKey,
    onChange,
    children,
  }: {
    columns: KanbanColumn[] | null;
    activeKey: string;
    onChange: (k: string) => void;
    children: React.ReactNode;
  }) => {
    if (!columns || columns.length === 0) return <>{children}</>;
    return (
      <React.Suspense fallback={<>{children}</>}>
        <LazyPhoneKanban
          columns={columns.map(c => ({
            key: c.id,
            label: c.label,
            count: c.rows.length,
          }))}
          activeKey={activeKey}
          onChange={onChange}
        >
          {children}
        </LazyPhoneKanban>
      </React.Suspense>
    );
  };

  // 本页有没有 KPI/图表类积木——决定固定骨架要不要让位（方案 C 反方向）。
  // 只看非 legacy 的真区块：_fromLegacy 是转换占位，本来就走旧路径渲染。
  const pageHasKpiBlocks = Boolean(
    page &&
      !OVERVIEW_KINDS.has(page.view.kind) &&
      page.experienceBlocks.some(
        b =>
          !(b as import("./block-registry").ExperienceBlockInstance)._fromLegacy &&
          KPI_BLOCK_TYPES.has(b.type)
      )
  );

  const phonePrimaryDataView = page && (
    <React.Suspense
      fallback={
        <Skeleton active paragraph={{ rows: 4 }} style={{ padding: "12px 4px" }} />
      }
    >
      <PhoneKanbanShell
        columns={phoneKanban}
        activeKey={phoneKanbanKey}
        onChange={setPhoneKanbanKey}
      >
      <PhoneCalendarShell data={phoneCalendar}>
      <LazyPhonePageList
        rows={phoneListRows}
        descFields={page.detailFields
          .slice(1, 4)
          .map(f => ({ id: f.id, label: f.label }))}
        createProbeProps={probe({
          kind: "action",
          label: "新建",
          pageId: page.id,
          permission: pageAccess.get(page.id)?.createPermission ?? null,
          granted: pageAccess.get(page.id)?.canCreate !== false,
          role,
        })}
        canCreate={
          Boolean(page.entityId) &&
          pageAccess.get(page.id)?.canCreate !== false
        }
        createLockedHint={
          pageAccess.get(page.id)?.canCreate === false
            ? "当前角色（" + (role ?? "-") + "）无新建权限"
            : undefined
        }
        onCreate={() => {
          setFormValues({});
          setFormOpen(true);
        }}
        onOpenRow={row => setDetailRow(row as RuntimeRow)}
        renderRowActions={row => rowActions(row as RuntimeRow)}
        swipeActions={row => {
          const r = row as RuntimeRow;
          const acts: Array<{
            key: string;
            text: string;
            color?: "primary" | "warning" | "danger";
            onClick: () => void;
          }> = [];
          if (page.workflowLinked)
            acts.push({
              key: "submit",
              text: "提交审批",
              color: "primary",
              onClick: () =>
                handleSubmitToWorkflow(
                  r.id,
                  String(Object.values(r.values)[0] ?? r.id)
                ),
            });
          acts.push({
            key: "delete",
            text: "删除",
            color: "danger",
            onClick: () => {
              void confirmDestructive(
                "删除这条记录？",
                "删掉之后无法恢复。",
                () => canvasEl
              ).then(ok => {
                if (!ok) return;
                apply(deleteRow(state, page.entityId!, r.id));
                toast("success", "已删除");
              });
            },
          });
          return acts;
        }}
      />
      </PhoneCalendarShell>
      </PhoneKanbanShell>
    </React.Suspense>
  );

  // 手机端业务页：体验区块 + 卡片列表（前 3 字段 + 操作），Pro App 的移动端习惯
  const phonePageContent = page && (
    // data-page-kind：手机档按 pageKind 出不同骨架，把 kind 摆到 DOM 上，
    // 测试和真机排查都能直接看出"这页该长什么样"，不用去翻模型。
    <div
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
      data-testid="phone-page-content"
      data-page-kind={page.view.kind}
    >
      {/* 演示种子的如实标注，与桌面页卡上那个 Tag 同源（pageShowsSeed），
          一页只标一处。手机档没有 Card title 的位置，用 antd-mobile 的
          NoticeBar——此前这里是手搓的一个橙字小方块，跟旁边的移动端组件
          不是一套观感（见 PhoneSeedNotice 的注释）。 */}
      {pageSeedCount > 0 && !freeformOwnsPage && (
        <React.Suspense fallback={null}>
          <LazyPhoneSeedNotice count={pageSeedCount} />
        </React.Suspense>
      )}
      {/* 体验区块：与桌面壳同一份摆法逻辑，槽位走 layout.mobile（未声明则退回
          桌面槽位）。从前手机档只有一个裸列表——桌面有的 KPI/图表/筛选条/流程
          时间线，手机一个都拿不到。 */}
      {/* 总览页的 AI 设计版式（2026-07-29）。
          此前只有桌面壳渲染它，手机档一直只有固定骨架——同一个总览页，
          换个档位就从"每个应用长得不一样"退回"所有应用长一样"。

          更别扭的是 preferredDevice=phone 的应用：那份 freeform **本来就是
          照手机单列生成的**（生成侧 _DEVICE_CONTAINER_HINTS 里 phone 档明确
          要求"内容区窄、必须单列纵向排布、字号图标间距收紧一档"），结果只有
          桌面壳会渲染它——专为手机做的版式送不到手机上。

          外面套 phone-freeform-scope：设计树是照 preferredDevice 那一档生成的，
          desktop 档的多列/固定宽度进了 405px 会横向撑爆。强制单列不是跟设计
          较劲，正是把 phone 档提示词里那条规矩补执行一遍。 */}
      {freeformOwnsPage && (
        <div className="phone-freeform-scope">
          {renderFreeformOverview(true)}
        </div>
      )}
      {!freeformOwnsPage && (OVERVIEW_KINDS.has(page.view.kind)
        ? dashboardUsesBusinessGrid
          ? renderExperienceBlockScaffold(true, phonePrimaryDataView)
          : renderExperienceBlockScaffold(true)
        : renderExperienceBlockScaffold(true, phonePrimaryDataView))}
      {/* pageKind 骨架：schema 有 6 种，手机档此前一种都没有（无论什么 kind
          都渲染成同一个裸列表）。dashboard/monitor 出 KPI + 图表，wizard 出
          流程步骤——形态复用首页那套（Grid 两列 / Steps 竖排）。 */}
      {phoneSectionData && (
        <React.Suspense fallback={null}>
          <LazyPhonePageSections {...phoneSectionData} />
        </React.Suspense>
      )}
      {!freeformOwnsPage && OVERVIEW_KINDS.has(page.view.kind) ? <React.Suspense
        fallback={
          <Skeleton active paragraph={{ rows: 4 }} style={{ padding: "12px 4px" }} />
        }
      >
        {/* 看板：桌面并排的状态列在手机上改成按状态分页（CapsuleTabs 横向
            可滚，状态多时下一个露一角，不用自己拼滚动提示）。非看板页
            phoneKanban 为 null，PhoneKanban 直接透传 children。 */}
        <PhoneKanbanShell
          columns={phoneKanban}
          activeKey={phoneKanbanKey}
          onChange={setPhoneKanbanKey}
        >
        <PhoneCalendarShell data={phoneCalendar}>
        <LazyPhonePageList
          rows={phoneListRows}
          descFields={page.detailFields
            .slice(1, 4)
            .map(f => ({ id: f.id, label: f.label }))}
          createProbeProps={probe({
            kind: "action",
            label: "新建",
            pageId: page.id,
            permission: pageAccess.get(page.id)?.createPermission ?? null,
            granted: pageAccess.get(page.id)?.canCreate !== false,
            role,
          })}
          canCreate={
            Boolean(page.entityId) &&
            pageAccess.get(page.id)?.canCreate !== false
          }
          createLockedHint={
            pageAccess.get(page.id)?.canCreate === false
              ? `当前角色（${role ?? "-"}）无新建权限`
              : undefined
          }
          onCreate={() => {
            setFormValues({});
            setFormOpen(true);
          }}
          onOpenRow={row => setDetailRow(row as RuntimeRow)}
          renderRowActions={row => rowActions(row as RuntimeRow)}
          // 左滑动作：与行内按钮同一套 handler，只换触发方式。给了 swipeActions
          // 之后 PhonePageList 不再渲染行内按钮，行高省一截。
          swipeActions={row => {
            const r = row as RuntimeRow;
            const acts: Array<{
              key: string;
              text: string;
              color?: "primary" | "warning" | "danger";
              onClick: () => void;
            }> = [];
            if (page.workflowLinked)
              acts.push({
                key: "submit",
                text: "提交审批",
                color: "primary",
                onClick: () =>
                  handleSubmitToWorkflow(
                    r.id,
                    String(Object.values(r.values)[0] ?? r.id)
                  ),
              });
            acts.push({
              key: "delete",
              text: "删除",
              color: "danger",
              // 删除不可逆，桌面档早就套了 Popconfirm；手机档此前是滑开一点
              // 就没了、连提示都没有。Dialog.confirm 返回 Promise<boolean>，
              // 确认了才真删，删完给一句 Toast。
              onClick: () => {
                void confirmDestructive(
                  "删除这条记录？",
                  "删掉之后无法恢复。",
                  () => canvasEl
                ).then(ok => {
                  if (!ok) return;
                  apply(deleteRow(state, page.entityId!, r.id));
                  toast("success", "已删除");
                });
              },
            });
            return acts;
          }}
        />
        </PhoneCalendarShell>
        </PhoneKanbanShell>
      </React.Suspense> : null}
    </div>
  );

  const detailInstances = detailRow
    ? state.instances.filter(i => i.entityRef?.rowId === detailRow.id)
    : [];

  // 详情内容块：桌面/手机走 Drawer，平板走右栏主从面板（同一 JSX 两处挂载）
  // 字段标签（带 X 光探针）与值的渲染跨设备共用，只有「摆法」分档：
  // 手机走 antd-mobile List（一行一字段），桌面留 antd Descriptions。
  const detailFieldNodes =
    detailRow && page
      ? page.detailFields.map(f => ({
          id: f.id,
          label: page.entityId ? (
            <span
              {...probe({
                kind: "field",
                entityId: page.entityId,
                fieldId: f.id,
                label: f.label,
              })}
            >
              {f.label}
            </span>
          ) : (
            f.label
          ),
          value: (
            <FieldValue
              field={f}
              value={detailRow.values[f.id]}
              phone={isPhone}
            />
          ),
        }))
      : [];

  // 详情面板的次级分区（AI 能力 / 关联审批）。此前每段都是手搓的
  // 「marginTop:16 + fontWeight:600 的一行小标题 + 一坨内容」，竖着堆，
  // 面板一开就要往下滚才看得到审批。官方对 Collapse 的定位正是这件事：
  // 「对复杂区域进行分组和隐藏，保持页面的整洁」。
  //
  // 不用 Tabs：官方说 Tabs 提供的是「**平级**的区域」，而这里字段是主、
  // AI/审批是次，不是平级；Tabs 还会在切走时把字段藏起来，反而更糟。
  //
  // 数据在这里算一次，**壳按设备分档**：桌面 antd Collapse、手机
  // antd-mobile Collapse。第一版只换了桌面的，结果 antd 的 Collapse 被渲染
  // 进 antd-mobile 的 Popup 里，成了新的跨库混用——字段部分早就分档了，
  // 分区的壳没道理不分。
  const detailSectionItems = detailRow && page
    ? [
        ...(page.aiActions.length > 0
        ? [
            {
              key: "ai",
              label: (
                <span style={{ fontSize: 12, fontWeight: 600, color: INK.value }}>
                  AI 能力 · {page.aiActions.length}
                </span>
              ),
              children: (
                <>
        <Flex vertical gap={6}>
        {page.aiActions.map(action => (
          <Flex key={action.capId} align="center" gap={8}>
            <span
              {...probe({
                kind: "ai",
                capId: action.capId,
                label: action.label,
              })}
            >
              {isPhone ? (
                // 手机档用 antd-mobile Button：触摸目标更大、按下有原生
                // 反馈；antd 的 size="small" ghost 在指尖下太小太轻。
                <React.Suspense fallback={null}>
                  <LazyPhoneActionButton
                    size="small"
                    color="primary"
                    testId={`app-ai-action-${action.capId}`}
                    loading={aiRunningCapId === action.capId}
                    disabled={
                      aiRunningCapId !== null &&
                      aiRunningCapId !== action.capId
                    }
                    onClick={() => runAiAction(action)}
                  >
                    ✨ {action.label}
                  </LazyPhoneActionButton>
                </React.Suspense>
              ) : (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  data-testid={`app-ai-action-${action.capId}`}
                  loading={aiRunningCapId === action.capId}
                  disabled={
                    aiRunningCapId !== null &&
                    aiRunningCapId !== action.capId
                  }
                  onClick={() => runAiAction(action)}
                >
                  ✨ {action.label}
                </Button>
              )}
            </span>
            <span style={{ fontSize: 11, color: INK.faint }}>
              → 写回「{action.outputLabel}」
            </span>
          </Flex>
        ))}
        </Flex>
        {aiRunningCapId && (
        <div style={{ marginTop: 8, fontSize: 11, color: INK.faint }}>
          真 LLM 生成中……（与五系统生成同一通道）
        </div>
        )}
        {aiSuggestion && aiSuggestion.rowId === detailRow.id && (
        <AiSuggestionCard
          outputLabel={aiSuggestion.action.outputLabel}
          output={aiSuggestion.output}
          confidence={aiSuggestion.confidence}
          rationale={aiSuggestion.rationale}
          onApply={applyAiSuggestion}
          onDismiss={() => setAiSuggestion(null)}
        />
        )}
        {aiError && (
        // 此前是手写的红框（#fff2f0/#ffccc7 写死），深色档下红底红字读不出来，
        // 也不跟主题的 colorError 走。antd Alert 就是干这个的。
        <Alert
          data-testid="app-ai-error"
          type="error"
          showIcon
          style={{ marginTop: 8 }}
          message={
            <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 11 }}>
              {aiError.code}
            </span>
          }
          description={<span style={{ fontSize: 11 }}>{aiError.detail}</span>}
        />
        )}
                </>
              ),
            },
          ]
        : []),
        {
        key: "workflow",
        label: (
          <span style={{ fontSize: 12, fontWeight: 600, color: INK.value }}>
            关联审批实例 · {detailInstances.length}
          </span>
        ),
        children:
          detailInstances.length === 0 ? (
            <span style={{ fontSize: 12, color: INK.faint }}>
              本行尚未提交审批
            </span>
          ) : (
            detailInstances.map(inst => {
        const meta = STATUS_META[inst.status] ?? STATUS_META.running;
        return (
        <div
          key={inst.id}
          style={{ marginTop: 8, fontSize: 12, color: INK.label }}
        >
          {inst.title} ·{" "}
          {nodeById(model, inst.currentNodeId)?.name ?? inst.currentNodeId}
          <Tag
            style={{ marginLeft: 8 }}
            color={
              inst.status === "running"
                ? "processing"
                : inst.status === "completed"
                  ? "success"
                  : "error"
            }
          >
            {meta.label}
          </Tag>
        </div>
        );
            })
          ),
        },
          ]
    : [];

  const detailBody = detailRow && page && (
    <>
      {isPhone ? (
        <React.Suspense fallback={null}>
          <LazyPhoneDetailFields fields={detailFieldNodes} />
        </React.Suspense>
      ) : (
        <Descriptions
          size="small"
          column={1}
          items={detailFieldNodes.map(f => ({
            key: f.id,
            label: f.label,
            children: f.value,
          }))}
        />
      )}
      {/* 壳按设备分档，数据同源（见 detailSectionItems 上的说明）。
          桌面用 ghost 档（无边框无底色）——抽屉本身已经是一层容器面，
          再套一层描边就是卡片套卡片。 */}
      {isPhone ? (
        <React.Suspense fallback={null}>
          <LazyPhoneDetailSections
            sections={detailSectionItems.map(it => ({
              key: it.key,
              title: it.label,
              content: it.children,
            }))}
          />
        </React.Suspense>
      ) : (
        <Collapse
          ghost
          size="small"
          defaultActiveKey={["ai", "workflow"]}
          style={{ marginTop: 8 }}
          items={detailSectionItems}
        />
      )}
    </>
  );

  // E40.5：三条数据带抽成积木——monitor 骨架把图表与榜/流排成主侧两栏，
  // 其余范式保持历史堆叠顺序（stats → widgets → charts）。
  const statsBand = page && (
    <>
      {page.stats.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: layout.space.sm,
            marginBottom: layout.space.sm,
            flexWrap: "wrap",
          }}
          data-testid="app-runtime-page-stats"
        >
          {page.stats.map(stat => {
            // Phase B: 真实数据为零时用预览种子数据填充，加"示例"标注
            const { value: displayVal, isPreview } = pageStatDisplay(stat);
            return (
              <Card
                key={stat.id}
                size="small"
                style={{ flex: 1, minWidth: 140 }}
                styles={{
                  body: {
                    padding: `${layout.space.sm}px ${layout.space.md}px`,
                  },
                }}
                data-testid={`app-runtime-page-stat-${stat.id}`}
              >
                {displayVal === null ? (
                  <Statistic title={stat.label} value="—" />
                ) : (
                  <>
                    <Statistic
                      title={stat.label}
                      value={displayVal}
                      precision={
                        Number.isInteger(displayVal)
                          ? 0
                          : stat.format === "money"
                            ? 2
                            : 1
                      }
                      prefix={stat.format === "money" ? "¥" : undefined}
                      suffix={stat.format === "percent" ? "%" : undefined}
                    />
                    {isPreview && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "#adb5bd",
                          marginTop: 2,
                          display: "block",
                        }}
                      >
                        示例数据
                      </span>
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );

  // E40.6 修复：monitor 骨架之前把 chartsBand（主列）和 widgetsBand（侧列）
  // 拆成两个各自独立宽度的 flex 列——rankings+feeds 摞起来比 charts 那一行
  // 高时，主列下方就会空出一块（真实撞到：2 图表 114px 高 vs 排行+动态摞起来
  // 233px 高，主列下方净空 120px 左右什么都没有）。抽成下面这三个纯函数，
  // monitorCombinedCards 把图表/排行/动态卡片放进同一个 flex-wrap 流里，
  // 不再按列预分宽度，卡片跟着内容高度自然排布，不会再留出这种空档。
  const renderRankingCard = (ranking: AppPageRankingSchema) => {
    if (!page) return null;
    {
      const rankRows = [...(state.entities[ranking.entityId] ?? [])]
        .map(row => ({ row, v: Number(row.values[ranking.sortFieldId]) }))
        .filter(({ v }) => Number.isFinite(v))
        .sort((a, b) => b.v - a.v)
        .slice(0, ranking.limit);
      const titleFieldId =
        page.detailFields.find(f => f.type === "string" && f.id !== "id")?.id ??
        "id";
      return (
        <Card
          key={ranking.id}
          size="small"
          title={ranking.label}
          style={{ flex: 1, minWidth: 240 }}
          data-testid={`app-runtime-ranking-${ranking.id}`}
        >
          {rankRows.length === 0 ? (
            <div style={{ color: "#999", fontSize: 12 }}>
              暂无数据 — 录入带「{ranking.sortLabel}」的记录后自动上榜
            </div>
          ) : (
            rankRows.map(({ row, v }, i) => (
              <div
                key={row.id || String(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: layout.space.xs,
                  padding: `${layout.space.xxs}px 0`,
                  borderBottom:
                    i < rankRows.length - 1 ? "1px solid #f5f5f5" : "none",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: layout.radius.md,
                    textAlign: "center",
                    lineHeight: "20px",
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                    background:
                      i < 3 ? "var(--app-primary,#1677ff)" : "#f0f0f0",
                    color: i < 3 ? "#fff" : "#8c8c8c",
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 13,
                  }}
                >
                  {String(row.values[titleFieldId] ?? "—")}
                </span>
                <span
                  style={{ fontSize: 13, fontWeight: 600, color: "#262626" }}
                >
                  {v.toLocaleString("zh-CN")}
                </span>
              </div>
            ))
          )}
        </Card>
      );
    }
  };

  const renderFeedCard = (feed: AppPageFeedSchema) => {
    if (!page) return null;
    const levelField = page.detailFields.find(f => f.id === feed.levelFieldId);
    const feedRows = [...(state.entities[feed.entityId] ?? [])]
      .filter(row => row.values[feed.timeFieldId])
      .sort((a, b) =>
        String(b.values[feed.timeFieldId] ?? "").localeCompare(
          String(a.values[feed.timeFieldId] ?? "")
        )
      )
      .slice(0, 6);
    const titleFieldId =
      page.detailFields.find(f => f.type === "string" && f.id !== "id")?.id ??
      "id";
    return (
      <Card
        key={feed.id}
        size="small"
        title={feed.label}
        style={{ flex: 1, minWidth: 240 }}
        data-testid={`app-runtime-feed-${feed.id}`}
      >
        {feedRows.length === 0 ? (
          <div style={{ color: "#999", fontSize: 12 }}>
            暂无动态 — 新记录会按时间倒序流入这里
          </div>
        ) : (
          feedRows.map((row, i) => {
            const levelValue = String(
              row.values[feed.levelFieldId ?? ""] ?? ""
            );
            const option = levelField?.options?.find(o => o.id === levelValue);
            return (
              <div
                key={row.id || String(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: layout.space.xs,
                  padding: `${layout.space.xxs}px 0`,
                  borderBottom:
                    i < feedRows.length - 1 ? "1px solid #f5f5f5" : "none",
                }}
              >
                {option && (
                  <Tag
                    color={option.tone === "danger" ? "error" : option.tone}
                    style={{ marginInlineEnd: 0 }}
                  >
                    {option.label}
                  </Tag>
                )}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 13,
                  }}
                >
                  {String(row.values[titleFieldId] ?? "—")}
                </span>
                <span style={{ fontSize: 11, color: "#8c8c8c", flexShrink: 0 }}>
                  {String(row.values[feed.timeFieldId] ?? "")}
                </span>
              </div>
            );
          })
        )}
      </Card>
    );
  };

  const widgetsBand = page && (
    <>
      {(page.rankings.length > 0 || page.feeds.length > 0) && (
        <div
          style={{
            display: "flex",
            gap: layout.space.sm,
            marginBottom: layout.space.sm,
            flexWrap: "wrap",
          }}
          data-testid="app-runtime-page-widgets"
        >
          {page.rankings.map(renderRankingCard)}
          {page.feeds.map(renderFeedCard)}
        </div>
      )}
    </>
  );

  const renderChartCard = (chart: AppPageChartSchema) => {
    if (!page) return null;
    const chartRows = state.entities[chart.entityId] ?? [];
    const option = buildEchartsOption(chart, chartRows, {
      primary: identityTheme.primary,
      categorical: identityTheme.charts,
    });
    return (
      <Card
        key={chart.id}
        size="small"
        title={chart.label}
        style={{
          flex: 1,
          // dashboard 范式：图表升主角，两列铺开（表格退居下方小表）
          minWidth: page.view.kind === "dashboard" ? "45%" : 220,
        }}
        // 试过 Tremor 的"图表 height:100% 跟着卡片拉伸"思路，真机验证是反面
        // 案例：卡片被 monitorCombinedRow 的 alignItems:"stretch" 拉高是个
        // 多轮布局才收敛的过程，ECharts 的 ResizeObserver 在中间某次尺寸
        // （355×264）上调用了 resize()，最终容器收敛到 246×202 后再没收到
        // 新的 resize，画布跟容器错位、图表整个看起来是空的——这正是 shadcn
        // ChartContainer 讨论里"图表必须有明确高度锚点，不能指望流式百分比
        // 高度在容器还在变化时也能测准"的真实反面教材。改回图表固定高度
        // （不跟着卡片拉伸），卡片被拉高时用 justifyContent:"center" 把
        // 固定高度的图表在多出来的空间里居中，而不是让图表本身去追一个
        // 还没稳定下来的容器尺寸。
        styles={{
          body: {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          },
        }}
        data-testid={`app-runtime-page-chart-${chart.id}`}
      >
        {option ? (
          <React.Suspense
            fallback={
              <Skeleton.Node active style={{ width: "100%", height: 200 }} />
            }
          >
            <LazyEchartsChart
              option={option}
              height={200}
              ariaLabel={`${chart.label}：按${chart.dimensionLabel}统计${chart.metricLabel}`}
            />
          </React.Suspense>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`写入「${chart.dimensionLabel}」后自动出图`}
            style={{ margin: `${layout.space.md}px 0` }}
          />
        )}
      </Card>
    );
  };

  const chartsBand = page && (
    <>
      {page.charts.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: layout.space.sm,
            marginBottom: layout.space.sm,
            flexWrap: "wrap",
          }}
          data-testid="app-runtime-page-charts"
        >
          {page.charts.map(renderChartCard)}
        </div>
      )}
    </>
  );

  // E40.6 修复：monitor 骨架的 chartsBand/widgetsBand 之前拆成两个各自独立
  // 宽度的 flex 列（图表主列 + 排行/动态侧列），排行+动态摞起来比图表那一行
  // 高时，主列下方就会净空出一块（真实撞到：2 图表 114px 高 vs 排行+动态
  // 233px 高，主列下方空出 120px 左右）。第一版临时改成单条 flex-wrap 流
  // 绕开了这一次，但卡片一多、高度差异一大，从左到右顺序换行不会往回找
  // 空位，还是会留白——现在接上 grid-compact.ts（搬自 GitHub 上
  // react-grid-layout 的核心压实算法，见该文件头部）："最短列优先"贪心
  // 摆放 + 竖直压实兜底，卡片按估算高度自动分列、列内紧贴堆叠，不会再
  // 留出空档。高度是估算值（图表固定/排行动态按真实行数算），不追求
  // 像素级精确，只保证不留白。
  const monitorCombinedRow =
    page &&
    (() => {
      const CHART_HEIGHT_ESTIMATE = 230; // 卡片头(40) + echarts 固定 180 + 内边距
      const ROW_HEIGHT_ESTIMATE = 30; // 排行/动态每行的实测行高（padding 5px*2 + 内容）
      const LIST_CHROME_ESTIMATE = 56; // 卡片头(40) + 上下内边距

      const cardHeights: Array<{ i: string; h: number }> = [
        ...page.charts.map(c => ({
          i: `chart:${c.id}`,
          h: CHART_HEIGHT_ESTIMATE,
        })),
        ...page.rankings.map(r => {
          const rowCount = Math.min(
            (state.entities[r.entityId] ?? []).length,
            r.limit
          );
          return {
            i: `ranking:${r.id}`,
            h:
              LIST_CHROME_ESTIMATE +
              Math.max(1, rowCount) * ROW_HEIGHT_ESTIMATE,
          };
        }),
        ...page.feeds.map(f => {
          const rowCount = Math.min(
            (state.entities[f.entityId] ?? []).length,
            6
          );
          return {
            i: `feed:${f.id}`,
            h:
              LIST_CHROME_ESTIMATE +
              Math.max(1, rowCount) * ROW_HEIGHT_ESTIMATE,
          };
        }),
      ];
      if (cardHeights.length === 0) return null;

      const cols = Math.min(3, cardHeights.length);
      const placed = autoPlaceGrid(cardHeights, cols);

      const nodeById = new Map<string, React.ReactNode>([
        ...page.charts.map(c => [`chart:${c.id}`, renderChartCard(c)] as const),
        ...page.rankings.map(
          r => [`ranking:${r.id}`, renderRankingCard(r)] as const
        ),
        ...page.feeds.map(f => [`feed:${f.id}`, renderFeedCard(f)] as const),
      ]);

      const columns: string[][] = Array.from({ length: cols }, () => []);
      for (const item of [...placed].sort((a, b) => a.y - b.y)) {
        columns[item.x]?.push(item.i);
      }

      return (
        // alignItems: "stretch"（不是 flex-start）——列与列之间高度天然不同步
        // （比如这一列就 1 张图表卡，隔壁摞了排行+动态两张），flex-start 会让
        // 矮的那列在自己内容结束处直接停住，下面空出一块没有任何元素的白底，
        // 用户截图圈过的就是这个（真去查过 DOM，那块确实不是渲染了个空
        // Card，就是纯背景）。改 stretch 后每一列都撑到最高列那么高，列内
        // 卡片本来就带的 flex:1（renderChartCard/renderRankingCard/
        // renderFeedCard 三处都设了）会把卡片自己的边框/背景撑满这段高度——
        // 富余空间留在卡片"内部"（看起来是留白排版），不再是卡片外面一块
        // 没有归属的裸白背景。
        <div
          style={{
            display: "flex",
            gap: layout.space.sm,
            alignItems: "stretch",
          }}
          data-testid="app-runtime-monitor-combined"
        >
          {columns.map((ids, colIdx) => (
            <div
              key={colIdx}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: layout.space.sm,
              }}
            >
              {ids.map(id => (
                <React.Fragment key={id}>{nodeById.get(id)}</React.Fragment>
              ))}
            </div>
          ))}
        </div>
      );
    })();


  // freeformOverview 只负责 KPI+图表；排行榜/动态流这类"必须是真实逐行
  // 记录"的内容永远走这条真实动态渲染路径（renderRankingCard/
  // renderFeedCard 直接读 state.entities 真实行数据），跟 freeformOverview
  // 是否存在无关——两者并列渲染，不是互斥关系。
  //
  // 2026-07-28 去重：模型会把同一份动态流在 blocks 和 feeds 两条通道里各
  // 声明一遍（真跑逮到：绑定逐字段相同、只有 id 和名字不同），于是首页出
  // 现两张一模一样的卡。撞车时保留积木那份（它带槽位摆放 + 新渲染器），
  // 这里只渲染没被积木覆盖的。判定见 page-panel-dedupe.ts。
  //
  // 2026-08-03：上面那条"两者并列渲染"的老规矩，在**首页**上被用户裁决推翻了
  //（「首页只 LLM 生成，先不要固定组件」）。首页有 AI 设计时它独占整页，榜/流
  // 一并让位——首页因此只剩聚合与图表，逐行明细回到各自的业务页。其余页面
  // （workbench/kanban/…）没有 freeformOverview，这条老规矩原样保留。
  const dedupedLists =
    page && !freeformOwnsPage
      ? dropLegacyPanelsCoveredByBlocks(
          { rankings: page.rankings, feeds: page.feeds },
          page.experienceBlocks
        )
      : { rankings: [], feeds: [] };
  const monitorDynamicLists =
    page && (dedupedLists.rankings.length > 0 || dedupedLists.feeds.length > 0) ? (
      <div
        style={{
          display: "flex",
          gap: layout.space.sm,
          flexWrap: "wrap",
          marginTop: layout.space.sm,
        }}
        data-testid="app-runtime-monitor-dynamic-lists"
      >
        {dedupedLists.rankings.map(renderRankingCard)}
        {dedupedLists.feeds.map(renderFeedCard)}
      </div>
    ) : null;


  // 声明了积木的页面不再走 ProTable 骨架（第②步的翻转就落在这一行）
  const usesProWorkbench = Boolean(
    page &&
      !isPhone &&
      !isTablet &&
      !blocksOwnPage &&
      (page.view.kind === "workbench" || page.view.kind === "wizard")
  );

  const pageDataView = page && (
    isTablet ? (
      <div
        style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
        data-testid="app-runtime-tablet-split"
      >
        <div style={{ flex: 3, minWidth: 0 }}>
          <Table
            size="small"
            rowKey="id"
            columns={
              columns
                .slice(0, Math.min(4, columns.length - 1))
                .concat(columns.slice(-1)) as any
            }
            dataSource={rows}
            onRow={row => ({
              onClick: () => setDetailRow(row as RuntimeRow),
              style: { cursor: "pointer" },
            })}
            rowClassName={row =>
              (row as RuntimeRow).id === detailRow?.id
                ? "ant-table-row-selected"
                : ""
            }
            pagination={rows.length > 10 ? { pageSize: 10 } : false}
            locale={{ emptyText: "暂无数据 — 点「新建」写入第一条真实数据" }}
          />
        </div>
        <Card
          size="small"
          title={detailRow ? "详情" : "详情 · 未选中"}
          style={{ flex: 2, minWidth: 0 }}
          data-testid="app-runtime-tablet-detail"
        >
          {detailRow ? (
            detailBody
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="点击左侧行查看详情与 AI 能力"
              style={{ padding: "16px 0" }}
            />
          )}
        </Card>
      </div>
    ) : page.view.kind === "kanban" && kanbanStatusField ? (
      <KanbanBoard
        rows={rows}
        statusField={kanbanStatusField}
        cardFields={page.columns.filter(f => f.id !== kanbanStatusField.id)}
        onOpenRow={setDetailRow}
      />
    ) : page.view.kind === "calendar" && page.view.dateFieldId ? (
      <CalendarBoard
        rows={rows}
        dateFieldId={page.view.dateFieldId}
        colorByField={page.detailFields.find(
          f => f.id === page.view.colorByFieldId
        )}
        titleFieldId={
          page.columns.find(f => f.id !== page.view.dateFieldId)?.id
        }
        onOpenRow={setDetailRow}
      />
    ) : usesProWorkbench ? (
      <React.Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
        <LazyProWorkbenchSurface
          surface={page.surface}
          title={page.title}
          fields={page.formFields}
          rows={rows}
          canCreate={Boolean(
            page.entityId && pageAccess.get(page.id)?.canCreate !== false
          )}
          // 走页面级管道，不再自己 setState —— 跟积木那条路同源
          onCreate={pagePipes.openCreate}
          onOpenRow={pagePipes.openRecord}
          onSaveRow={row => {
            if (!page.entityId) return;
            apply(updateRow(state, page.entityId, row.id, row.values));
          }}
        />
      </React.Suspense>
    ) : (
      <Table
        size={page.view.kind === "dashboard" ? "small" : "middle"}
        rowKey="id"
        columns={columns as any}
        dataSource={rows}
        /**
         * 列多了让表格**横向滚动**，而不是把每列挤成省略号（2026-08-11）。
         *
         * 线上截图里 9 列挤在约 740px 的卡里，每列剩 ~80px，于是「加分事项」
         * 显示成"加分事..."、「行为说明」成"行为说..."、「AI行为分析」成
         * "AI行为..."——几乎每一列都截断到读不出内容，表头「AI建议积分」还折成
         * 两行。列上开着 `ellipsis: true` 但没有任何宽度提示，antd 默认把容器
         * 宽度均分，列数一多必然如此。
         *
         * `x: "max-content"` 让每列按内容取自然宽度、整表横向滚动——这是 antd
         * 对多列表格的标准做法，而且这个仓库**早就在用**（EntityDataPanel.tsx
         * 那张表、DataImportWizard / 资源配置那两个区块都是这么写的），只有
         * 页面内置表格一直漏着。
         */
        scroll={{ x: "max-content" }}
        onRow={row => ({
          onClick: () => setDetailRow(row as RuntimeRow),
          style: { cursor: "pointer" },
        })}
        pagination={
          page.view.kind === "dashboard"
            ? rows.length > 5 && { pageSize: 5 }
            : rows.length > 8 && { pageSize: 8 }
        }
        locale={{ emptyText: "暂无数据 — 点「新建」写入第一条真实数据" }}
      />
    )
  );

  // 一次求值、多处摆位（见下方 D1 注释）
  const blockScaffold = renderExperienceBlockScaffold(false);
  const businessPageGrid = usesProWorkbench
    ? pageDataView
    : renderExperienceBlockScaffold(
        false,
        // 积木拥有这一页、且它们里面确实有展示行数据的 → 不再塞内置表格，
        // 否则一页两张表（这也正是"绑主实体的 DataTable 会被摘掉"那条规矩
        // 当初要挡的事——翻转之后由这里决定，不再靠摘积木）。
        blocksOwnPage && blocksCoverData ? undefined : pageDataView
      );

  /**
   * 演示数据徽标 —— 第三样从骨架身上摘下来的（2026-08-08，第①步）。
   *
   * 它此前只写在 `defaultPageContent` 的 Card 标题里，而那个标题在
   * `usesProWorkbench` 为真时是 `undefined`——也就是说**桌面档的列表页
   * 今天根本看不到这个徽标**，而列表页恰恰是用户最会看到演示行的地方。
   *
   * 这一步只把它抽成一个可复用的节点、挂载点原样不动（承诺了这一步不改
   * 视觉）。要不要在列表页也挂上，是第②步翻转默认时一并决定的事。
   */
  const seedNotice = pageSeedCount > 0 && (
    <Tooltip
      title={`本页 ${allRows.length} 条记录里有 ${pageSeedCount} 条是自动铺的演示数据；点「新建」写入第一条真实记录后即被整批取代`}
    >
      <Tag
        color="orange"
        style={{ marginInlineEnd: 0, fontWeight: 400 }}
        data-testid="app-runtime-seed-tag"
      >
        示例数据 {pageSeedCount}
      </Tag>
    </Tooltip>
  );

  const defaultPageContent = page && (
    <Card
      size="small"
      bordered={page.presentation === "marketing-landing" ? false : !usesProWorkbench}
      styles={
        usesProWorkbench || page.presentation === "marketing-landing"
          ? { body: { padding: 0 } }
          : undefined
      }
      title={
        usesProWorkbench || page.presentation === "marketing-landing" ? undefined : <Space size={6}>
          <span>{page.title}</span>
          {seedNotice}
        </Space>
      }
      extra={
        usesProWorkbench || page.presentation === "marketing-landing" ? undefined : <Space size="small">
          {/* 权限标识符只在 X 光（检查模式）下露出（2026-08-11）。
              线上截图里业务页头挂着 `student:read` `pet:read` `redemption:create`
              这类蓝标签——那是**内部标识符**，交付给终端用户的应用里没人看得懂，
              而且泄漏了权限命名。它本来是开发期的自查affordance，可这个仓库早就
              有正经通道了：X 光模式的 probe() 悬停上报（含 permission/granted），
              信息更全还不占版面。所以不是删掉，是收进 X 光里。
              顺带说一句 `.slice(0, 3)`：页面有 5 条权限时它只显示前 3 条，
              既不完整也不说明被截断了——这种"看着像全量其实是抽样"的展示比不展示更糟。 */}
          {xrayActive &&
            page.actions.map(a => (
              <Tag key={a} color="blue" style={{ marginInlineEnd: 0 }}>
                {a}
              </Tag>
            ))}
          {columnSettings}
          <span
            {...probe({
              kind: "action",
              label: "新建",
              pageId: page.id,
              permission: pageAccess.get(page.id)?.createPermission ?? null,
              granted: pageAccess.get(page.id)?.canCreate !== false,
              role,
            })}
          >
            <Button
              type="primary"
              icon={
                pageAccess.get(page.id)?.canCreate === false ? (
                  <LockOutlined />
                ) : (
                  <PlusOutlined />
                )
              }
              onClick={() => {
                setFormValues({});
                setFormOpen(true);
              }}
              disabled={
                !page.entityId || pageAccess.get(page.id)?.canCreate === false
              }
              title={
                pageAccess.get(page.id)?.canCreate === false
                  ? `当前角色（${role ?? "-"}）未持有 ${pageAccess.get(page.id)?.createPermission ?? ""}`
                  : undefined
              }
              data-testid="app-runtime-create"
            >
              新建
            </Button>
          </span>
        </Space>
      }
    >
      {/* D1（2026-07-28）：总览页的积木脚手架挪到设计版式**后面**去渲染。
          此前它固定排在最前，于是首页第一眼看到的是排行榜/动态流这两张
          外挂卡，AI 现场设计的总览区反倒被压到下面——顺序把主次颠倒了。
          非总览页保持原样（那些页的积木本来就是页面主角）。

          脚手架只求值一次、在下面每个分支里显式摆位——不这么写就得在
          "总览页"那个条件外面再判一次 kind，dashboard 没有 freeformOverview
          时会掉进最末的兜底分支、积木一个都渲染不出来（第一版就是这个洞）。 */}
      {!freeformOwnsPage &&
        (!OVERVIEW_KINDS.has(page.view.kind) || dashboardUsesBusinessGrid) &&
        businessPageGrid}
      {/* 向导页顶部的内置步骤条。
          两处修正（2026-08-11，线上截图 #8）：

          ① **积木已经画了流程就不画**（blocksDrawWorkflow）。原来无条件画，
             于是声明了 WorkflowTimeline 的向导页上叠着两条步骤条。
          ② **顺序按图走，不按声明数组走**。原来是 `nodes.slice(0, 8).map(...)`，
             把驳回节点铺成正向的下一步——跟 WorkflowTimeline 修过的是同一个 bug，
             只是这一份漏掉了。现在两处共用 deriveWorkflowMainPath，分支出口不
             进步骤条（这里只画主链路，分支明细留给 WorkflowTimeline 区块）。 */}
      {page.view.kind === "wizard" &&
        !blocksDrawWorkflow &&
        wizardMainPath.length > 0 && (
          <Steps
            size="small"
            current={0}
            items={wizardMainPath.slice(0, 8).map(n => ({
              title: n.name || n.id,
              description: n.phase,
            }))}
            style={{ marginBottom: 14 }}
            data-testid="app-runtime-wizard-steps"
          />
        )}
      {freeformOwnsPage ? (
        <>{monitorFreeformOverview}</>
      ) : page.view.kind === "monitor" ? (
        monitorFreeformOverview ? (
          <>
            {monitorFreeformOverview}
            {blockScaffold}
            {monitorDynamicLists}
          </>
        ) : (
          // 没有设计版式时的兜底。**顺序必须跟上面那一支一致**：聚合在前，
          // 积木垫后（2026-08-07 修）。
          //
          // 此前这里是 blockScaffold → statsBand → monitorCombinedRow，
          // 跟产品自己定的首页信息架构正好相反。那套架构写在喂给设计 LLM 的
          // brief 里（freeform_block._monitor_overview_design_brief）：
          //
          //     必须包含的 KPI 统计卡：…
          //     必须包含的图表：…
          //     这一页还声明了这些逐行内容（blockRef）：…
          //
          // 即「先给聚合结论 → 再给分布 → 最后才是明细」。上面那一支
          // （monitorFreeformOverview → blockScaffold → monitorDynamicLists）
          // 是照这个顺序来的，2026-07-28 的 D1 就是为此把脚手架挪到设计版式
          // 后面的；但**当时只改了有设计版式的那一支**，兜底支原样留着。
          //
          // 平时 LLM 都能画出设计版式，所以没人踩到；关掉生图、或者预算不够
          // （freeformOverviewStatus=deferred_budget）才掉进兜底支，老毛病
          // 才露出来。实测（药联协同，1920 宽）：
          //
          //     快捷操作卡   392→507   115px
          //     处方处理流程 515→601    86px
          //     预警动态     610→921   311px   ← 512px 积木压在上面
          //     KPI 行       929        71px   ← 总览页最该先看的，掉出首屏
          //     图表        1036       …
          //
          // 一个总览页，最该看的数字全在屏幕外。
          <>
            {statsBand}
            {monitorCombinedRow}
            {blockScaffold}
          </>
        )
      ) : page.view.kind === "dashboard" && monitorFreeformOverview ? (
        // 2026-07-27：dashboard 页也吃 freeformOverview——此前只有 monitor
        // 一个 kind 走得到设计版式，LLM 把总览页写成 dashboard 时整条
        // "照参考图设计"的产出送不到页面上（首页恒回固定骨架的根因之一）。
        //
        // ⚠ 2026-08-03 补漏：这里原本还渲染 widgetsBand，注释写的是"dashboard
        // 特有的快速入口保留，不被设计版式吞掉"。但 widgetsBand 渲染的其实就是
        // page.rankings / page.feeds——跟 monitorDynamicLists 同一批榜/流，只是
        // 数据源直接读原始字段、绕过了 dedupedLists 那道闸。于是总览页收口只在
        // monitor 档生效（那条分支里没有 widgetsBand），dashboard 档的排行榜/
        // 动态流照旧冒出来。真实数据里 13 个 dashboard 页有 11 个带设计版式、
        // 其中 3 个同时带榜/流，是真会撞上的。
        // 设计版式独占整页，这里跟着一起让位。
        <>
          {monitorFreeformOverview}
          {blockScaffold}
          {freeformOwnsPage ? null : widgetsBand}
          {monitorDynamicLists}
        </>
      ) : pageHasKpiBlocks ? (
        // 方案 C 反方向：业务页声明了 MetricGrid/TrendChart 积木时，固定骨架的
        // statsBand/chartsBand 让位——两条路画的是同一份指标，都渲染就是两张
        // 说同一件事的卡。widgetsBand（快速入口等）不属于 KPI/图表，照常保留。
        <>{widgetsBand}</>
      ) : (
        <>
          {/* dashboard 页没有 freeformOverview 时会走到这里（pageHasKpiBlocks
              要求非总览页，所以 dashboard 永远不满足上一支）。总览页的脚手架
              在上面被跳过了，得在这里补回来，否则积木整页消失。 */}
          {OVERVIEW_KINDS.has(page.view.kind) && !dashboardUsesBusinessGrid
            ? blockScaffold
            : null}
          {statsBand}
          {widgetsBand}
          {chartsBand}
        </>
      )}
      {OVERVIEW_KINDS.has(page.view.kind) && !dashboardUsesBusinessGrid && (isTablet ? (
        // 平板范式：紧凑双栏（iPad 式主从视图）——左列表右详情，详情不走 Drawer
        <div
          style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
          data-testid="app-runtime-tablet-split"
        >
          <div style={{ flex: 3, minWidth: 0 }}>
            <Table
              size="small"
              rowKey="id"
              // 双栏下收窄列表：最多 4 个数据列 + 操作列（字段少时不重复操作列）
              columns={
                columns
                  .slice(0, Math.min(4, columns.length - 1))
                  .concat(columns.slice(-1)) as any
              }
              dataSource={rows}
              onRow={row => ({
                onClick: () => setDetailRow(row as RuntimeRow),
                style: { cursor: "pointer" },
              })}
              rowClassName={row =>
                (row as RuntimeRow).id === detailRow?.id
                  ? "ant-table-row-selected"
                  : ""
              }
              pagination={rows.length > 10 ? { pageSize: 10 } : false}
              locale={{ emptyText: "暂无数据 — 点「新建」写入第一条真实数据" }}
            />
          </div>
          <Card
            size="small"
            title={detailRow ? "详情" : "详情 · 未选中"}
            style={{ flex: 2, minWidth: 0 }}
            data-testid="app-runtime-tablet-detail"
          >
            {detailRow ? (
              detailBody
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="点击左侧行查看详情与 AI 能力"
                style={{ padding: "16px 0" }}
              />
            )}
          </Card>
        </div>
      ) : page.view.kind === "kanban" && kanbanStatusField ? (
        // 页面范式（加厚 schema 二期）：kanban——列来自 statusField 声明取值，
        // 卡片点击进详情抽屉。平板保持主从双栏（详情面板依赖表格视图）。
        <KanbanBoard
          rows={rows}
          statusField={kanbanStatusField}
          cardFields={page.columns.filter(f => f.id !== kanbanStatusField.id)}
          onOpenRow={setDetailRow}
        />
      ) : page.view.kind === "calendar" && page.view.dateFieldId ? (
        // calendar——自建月历，默认展示数据所在月；事件按 colorBy tone 着色
        <CalendarBoard
          rows={rows}
          dateFieldId={page.view.dateFieldId}
          colorByField={page.detailFields.find(
            f => f.id === page.view.colorByFieldId
          )}
          titleFieldId={
            page.columns.find(f => f.id !== page.view.dateFieldId)?.id
          }
          onOpenRow={setDetailRow}
        />
      ) : (
        <Table
          size={page.view.kind === "dashboard" ? "small" : "middle"}
          rowKey="id"
          columns={columns as any}
          dataSource={rows}
          scroll={{ x: "max-content" }}
          onRow={row => ({
            onClick: () => setDetailRow(row as RuntimeRow),
            style: { cursor: "pointer" },
          })}
          pagination={
            page.view.kind === "dashboard"
              ? rows.length > 5 && { pageSize: 5 }
              : rows.length > 8 && { pageSize: 8 }
          }
          locale={{ emptyText: "暂无数据 — 点「新建」写入第一条真实数据" }}
        />
      ))}
    </Card>
  );

  const pageContent = defaultPageContent;

  // identityTheme 已在上面 chartCard 之前声明（菜单项抽出来给 side/top 两种导航形态共用）。
  // Step 9：视觉配方——只管密度/深色开关/圆角，主色仍归 identityTheme；两者叠加。
  const designRecipe = resolveDesignRecipe(schema.identity.designRecipeRef);
  const brandGradient = `linear-gradient(135deg,${identityTheme.primary},${identityTheme.gradTo})`;
  const BrandIcon = BRAND_ICONS[schema.identity.icon] ?? AppstoreOutlined;
  const hasLegacyHomeMenu = schema.menus[0]?.pageId === schema.home.id;
  const navMenuItems = schema.menus.map((m, i) => {
    const locked =
      m.pageId !== "home" && pageAccess.get(m.pageId)?.visible === false;
    const Icon =
      m.pageId === "home"
        ? DashboardOutlined
        : locked
          ? LockOutlined
          : MENU_ICONS[
              (i - (hasLegacyHomeMenu ? 1 : 0) + MENU_ICONS.length) %
                MENU_ICONS.length
            ];
    // 菜单项右侧挂本页主实体的行数（antd Badge）。此前侧栏只有一列文字，
    // 哪一页有货、哪一页是空的要挨个点进去才知道；有了计数，应用一打开就
    // 有"这套系统里已经有数据在跑"的实感。锁住的页不显示——那是权限信息，
    // 不该从计数里泄出去。
    //
    // 2026-08-11：**只数真实数据，演示种子不计**。
    //
    // 线上产物截图照出来的：左侧六个菜单项后面**全是 12**。因为种子生成器给
    // 每个实体都铺同样多的行，于是这个徽标对每一页说同一个数——
    // **每项都一样的数字等于没有信息**，只剩噪音，而且长得像未读消息角标。
    //
    // 上面那句"哪一页有货、哪一页是空的"正是这条的初衷，而种子把每一页都
    // 变成"有货"，初衷当场落空。页面里本来就另有一个「示例数据 N」徽标如实
    // 标着种子，侧栏再数一遍是把同一份假数据吹两次。
    //
    // 所以判据换成真实行数：全是种子时侧栏干干净净，用户写下第一条真数据
    // 之后徽标才出现——那一刻它才真的在说"这套系统里有数据在跑"。
    const rowCount = (() => {
      if (locked || m.pageId === "home") return 0;
      const entityId = schema.pages.find(p => p.id === m.pageId)?.entityId;
      if (!entityId) return 0;
      const total = state.entities[entityId]?.length ?? 0;
      return Math.max(0, total - seedRowCount(state, entityId));
    })();
    return {
      key: m.pageId,
      icon: <Icon />,
      label: (
        <span
          data-testid={`app-runtime-menu-${m.pageId}`}
          {...probe({ kind: "menu", pageId: m.pageId, label: m.label })}
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          {m.label}
          {rowCount > 0 && (
            <Badge
              count={rowCount}
              overflowCount={99}
              color={hexToRgba(identityTheme.primaryFg, 0.22)}
              style={{ color: identityTheme.sidebarText, fontSize: 10, boxShadow: "none" }}
            />
          )}
        </span>
      ),
      disabled: locked,
      title: locked ? `当前角色（${role ?? "-"}）无本页权限` : m.label,
    };
  });

  const desktopShell = (
    <Layout style={{ height: "100%" }} data-testid="app-shell-side">
      <Layout.Sider
        width={device === "tablet" ? 176 : 208}
        theme="dark"
        // antd 的 Layout.siderBg token 是当 background-color 用的，塞一个
        // linear-gradient(...) 字符串进去会被静默吃掉、退化成纯色（实测
        // 2026-07-24）。渐变必须走这条原生 style.background，token 仍然
        //留着当纯色场景的默认值（generatedTheme 没给渐变时两条路径同值，
        // 互不冲突）。
        style={{ background: identityTheme.sidebarBg }}
      >
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 16px",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              flexShrink: 0,
              background: brandGradient,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            data-testid="app-brand-mark"
          >
            <BrandIcon style={{ color: "#fff", fontSize: 15 }} />
          </div>
          <span
            style={{
              // 标题文字直接落在 identityTheme.sidebarBg 上（跟图标不一样，图标
              // 在小色块徽标里，背景永远是 brandGradient）——之前写死白字，主题
              // 生成出浅色/近白侧边栏时标题就看不见了，改跟 sidebarText 走。
              color: identityTheme.sidebarText,
              fontWeight: 600,
              fontSize: 15,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={schema.appName}
          >
            {schema.appName}
          </span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activePageId]}
          onClick={({ key }) => setActivePageId(String(key))}
          items={navMenuItems}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            background: "#fff",
            padding: "0 20px",
            height: 56,
            lineHeight: "56px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            boxShadow: "0 1px 4px rgba(0,21,41,0.08)",
            zIndex: 1,
          }}
        >
          <Breadcrumb
            items={[{ title: schema.appName }, { title: currentTitle }]}
          />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: "#999" }}>当前角色</span>
          <Select
            size="small"
            style={{ minWidth: 140 }}
            value={role}
            onChange={changeRole}
            options={schema.roles.map(r => ({ value: r, label: schema.roleLabels[r] ?? r }))}
            data-testid="app-runtime-role"
          />
          <Avatar
            size={30}
            style={{ background: identityTheme.primary }}
            icon={<UserOutlined />}
          />
        </Layout.Header>
        <Layout.Content style={{ padding: 20, overflow: "auto" }}>
          {isHome ? homeContent : pageContent}
        </Layout.Content>
      </Layout>
    </Layout>
  );

  // E40.2 nav=top：监控/总览型产品的顶栏形态——品牌区 + 横向主菜单 +
  // 角色切换收在同一条深色 Header，内容区独占全宽（菜单少的域更开阔）。
  const topShell = (
    <Layout style={{ height: "100%" }} data-testid="app-shell-top">
      <Layout.Header
        style={{
          background: identityTheme.sidebarBg,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 16px",
          height: 52,
          lineHeight: "52px",
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            flexShrink: 0,
            background: brandGradient,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          data-testid="app-brand-mark"
        >
          <BrandIcon style={{ color: "#fff", fontSize: 14 }} />
        </div>
        <span
          style={{
            // 同上：文字直接落在 identityTheme.sidebarBg 上，不能写死白色。
            color: identityTheme.sidebarText,
            fontWeight: 600,
            fontSize: 15,
            whiteSpace: "nowrap",
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={schema.appName}
        >
          {schema.appName}
        </span>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[activePageId]}
          onClick={({ key }) => setActivePageId(String(key))}
          items={navMenuItems}
          style={{ flex: 1, minWidth: 0, background: "transparent" }}
        />
        <span
          style={{
            fontSize: 13,
            color: identityTheme.sidebarText,
            opacity: 0.65,
          }}
        >
          当前角色
        </span>
        <Select
          size="small"
          style={{ minWidth: 140 }}
          value={role}
          onChange={changeRole}
          options={schema.roles.map(r => ({ value: r, label: schema.roleLabels[r] ?? r }))}
          data-testid="app-runtime-role"
        />
        <Avatar
          size={28}
          style={{ background: identityTheme.primary }}
          icon={<UserOutlined />}
        />
      </Layout.Header>
      <Layout.Content style={{ padding: 20, overflow: "auto" }}>
        {isHome ? homeContent : pageContent}
      </Layout.Content>
    </Layout>
  );

  const phoneShell = (
    <div
      data-testid="app-shell-phone"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#f0f2f5",
      }}
    >
      {/* 顶栏走 antd-mobile NavBar（左 品牌 / 中 标题 / 右 角色）。此前是手搓的
          48px flex div，自己摆 logo、自己 flex:1 顶右、自己加投影——三段布局
          本来就是 NavBar 的事。fallback 给一条等高空白，避免加载那一拍内容区
          往上跳。 */}
      <React.Suspense
        fallback={
          <div style={{ height: 48, flexShrink: 0, background: "#fff" }} />
        }
      >
        <LazyPhoneNavBar
          title={currentTitle}
          brand={
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: brandGradient,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <BrandIcon style={{ color: "#fff", fontSize: 12 }} />
            </span>
          }
          right={
            // 角色切换：手机档用 antd-mobile Picker（整屏滚轮，手指点得准），
            // 不用 antd Select——它的下拉浮层在缩放过的画布里定位会飘。
            <React.Suspense fallback={<span style={{ width: 96, height: 24 }} />}>
              <LazyPhoneRolePicker
                roles={schema.roles}
                roleLabels={schema.roleLabels}
                value={role}
                onChange={changeRole}
                getContainer={() => canvasEl ?? document.body}
              />
            </React.Suspense>
          }
        />
      </React.Suspense>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
        {isHome ? phoneHomeContent : phonePageContent}
      </div>
      <div style={{ flexShrink: 0 }}>
        <React.Suspense
          fallback={
            <div
              style={{
                height: 54,
                background: "#fff",
                borderTop: "1px solid #f0f0f0",
              }}
            />
          }
        >
          <LazyPhoneTabBar
            items={schema.menus.map(m => {
              const locked =
                m.pageId !== "home" &&
                pageAccess.get(m.pageId)?.visible === false;
              // 行数徽标与桌面侧栏同源同口径（见 menuItems 里那段）：
              // 锁住的页和首页不计数，锁住的那条是权限信息、不能从计数里泄出去。
              const entityId =
                locked || m.pageId === "home"
                  ? undefined
                  : schema.pages.find(p => p.id === m.pageId)?.entityId;
              return {
                pageId: m.pageId,
                label: m.label,
                locked,
                rowCount: entityId
                  ? (state.entities[entityId]?.length ?? 0)
                  : 0,
              };
            })}
            activeId={activePageId}
            onChange={setActivePageId}
            // 锁定 tab 点了要出声：灰图标 + title 在触屏上等于没有提示，
            // 用户只会以为点不动是应用卡了。走同一个 notify（手机档=Toast）。
            onLockedTap={item =>
              notify(
                true,
                "warning",
                `当前角色（${role ?? "-"}）无「${item.label}」权限`,
                () => canvasEl
              )
            }
          />
        </React.Suspense>
      </div>
    </div>
  );

  return (
    <div
      ref={fitRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: "transparent" }}
      data-testid="app-runtime-screen"
      data-landing-page-id={schema.landingPageId ?? ""}
      data-active-page-id={activePageId ?? ""}
    >
      {codeView ? (
        // 档位胶囊浮在画布上（旧消费方）时才需要 pt-11 头带给它让位；
        // 切换条已 portal 到顶条（studio）时代码区铺满、无多余留白（用户反馈）
        <div
          className={`absolute inset-0 ${controlsContainer === undefined ? "pt-11" : ""}`}
          style={{ background: "#f7f8fa" }}
          data-testid="app-runtime-code-host"
        >
          <CodeProjectionView model={model} appName={appTitle} />
        </div>
      ) : null}
      <div
        style={{
          width: spec.w * scale,
          height: spec.h * scale,
          position: "relative",
          display: codeView ? "none" : undefined,
        }}
      >
        <div
          ref={setCanvasEl}
          className={xrayActive ? "xray-scan" : undefined}
          style={{
            width: spec.w,
            height: spec.h,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            // E40.2：主题变量下发（非 antd 的裸元素经 var(--app-primary) 吃主题）
            ["--app-primary" as string]: identityTheme.primary,
            ["--app-primary-hover" as string]: identityTheme.primaryHover,
            // 手机档的 antd-mobile 组件不吃 ConfigProvider 的 token，只认
            // --adm-* 变量。挂在画布上（而不是 :root），生成主题就只染这个
            // 应用，不会漏到 SlideRule 自己的界面上。
            ...admThemeVars(identityTheme),
            // Step 9：深色配方覆盖 canvas 底色（不读 identityTheme.contentBg，
            // 避免深色配方叠浅色主题时底色反而变浅）。
            background: designRecipe.dark
              ? DARK_CANVAS_BG
              : identityTheme.contentBg,
            borderRadius: isPhone ? 12 : 5,
            overflow: "hidden",
            boxShadow: STAGE_FRAME_SHADOW,
          }}
        >
          <ConfigProvider
            // 生成的应用通篇中文，日期组件却一直是英文的——实测过：新建表单里
            // 点开日期字段，星期表头是 "Su Mo Tu We Th Fr Sa"、月份是 "Jul"，
            // 而且**周日起周**（中文习惯是周一起）。antd 不配 locale 时默认
            // en_US，这一条漏了就等于每个生成出来的应用都带着一个英文日历。
            locale={zhCN}
            getPopupContainer={() => canvasEl ?? document.body}
            theme={{
              cssVar: true,
              // E40.2：身份主题的主色一把翻全部 antd 组件（按钮/选中态/链接…）
              // Step 9：配方叠加圆角 + 深色/紧凑 algorithm；高对比额外加深边框、
              // 略增字号（无障碍场景，antd token 全局生效，不用逐组件改）。
              token: {
                colorPrimary: identityTheme.primary,
                // 「选中项的浅底」交给主题自己声明的 accentBg，不吃 antd 从
                // colorPrimary 派生的那个。派生值对常规亮色主色没问题，但主色
                // 一旦是**低饱和深色**（生成主题很容易挑到，比如咖啡那套的
                // #3F7656），派生出来是中灰绿 rgb(170,181,173)——配上同样深绿的
                // 文字，实测对比度只有 2.6:1，低于 WCAG AA 的 4.5:1，日历选中格
                // 的日号几乎看不清。accentBg 本来就是主题为"强调浅底"声明的，
                // 用它既保证是浅的，又跟侧栏/标签的浅底同源。
                // 这一个 token 同时管住 Calendar 选中格 / Select 选中项 /
                // Menu 选中项，不用逐组件打补丁。
                controlItemBgActive: identityTheme.accentBg,
                borderRadius: designRecipe.borderRadius,
                padding: designRecipe.padding,
                ...(designRecipe.highContrast
                  ? {
                      colorBorder: "#000000",
                      colorBorderSecondary: "#00000040",
                      fontSize: 15,
                    }
                  : {}),
              },
              algorithm: designRecipeAlgorithms(designRecipe, isTablet),
              // 8 套身份主题此前只染了头像/图标这些边角元素——Sider/Menu 的
              // theme="dark" 是 antd 内置深蓝 #001529，跟 identityTheme 完全无关，
              // 导致 8 套主题的侧栏永远长一个样。这里用 antd v5 的组件级 token
              // 把侧栏底色/文字接到 identityTheme.sidebarBg/sidebarText；选中态
              // 直接复用 primary/primaryFg（对齐 tweakcn 真实预设的
              // sidebar-primary 惯例：选中态就是主色本身，不用另起一套配色）。
              components: {
                Layout: { siderBg: identityTheme.sidebarBg },
                Menu: {
                  darkItemBg: identityTheme.sidebarBg,
                  darkSubMenuItemBg: identityTheme.sidebarBg,
                  darkItemColor: identityTheme.sidebarText,
                  // 之前写死白底白字假设侧边栏永远深色——生成主题给浅色侧边栏
                  // 时这层 hover 反馈直接消失/文字不可读，改成跟主色调一层
                  // 半透明叠色，深浅侧边栏都看得见、且跟品牌色呼应。
                  darkItemHoverBg: hexToRgba(identityTheme.primary, 0.12),
                  darkItemHoverColor: identityTheme.sidebarText,
                  darkItemSelectedBg: identityTheme.primary,
                  darkItemSelectedColor: identityTheme.primaryFg,
                  // 2026-07-24 修复真实撞到的坑：antd 的 darkItemDisabledColor
                  // 默认值是"白色 25% 透明度"（colorTextLightSolid 打折），
                  // 这个默认值假设侧边栏永远是深色——生成主题给了纯白侧边栏
                  // （sidebarBg:"#FFFFFF"）时，无权限菜单项的文字/锁图标变成
                  // 白底白字，直接隐形（真机截图核实：8 个菜单项里 5 个被
                  // 锁的位置只剩一段空白，肉眼看不出还有内容）。改成跟
                  // sidebarText 同色但打透明度，深浅侧边栏都能读出"这项被
                  // 锁住了"而不是凭空消失。
                  darkItemDisabledColor: hexToRgba(
                    identityTheme.sidebarText,
                    0.35
                  ),
                },
              },
            }}
          >
            {/* message 的挂载点必须在 ConfigProvider 里面，提示条才吃得到
                身份主色/深色档/圆角配方；挂外面等于白用 hook 版。 */}
            {messageHolder}
            {isPhone
              ? phoneShell
              : schema.identity.nav === "top"
                ? topShell
                : desktopShell}

            {/* 新建表单：手机档走 antd-mobile Popup（底部弹起），桌面档留 antd
                Modal。同一份 formFields / formValues / handleCreate，只换容器
                和录入控件——PC 弹框塞进 405 画布会顶穿两边，实测过。 */}
            {isPhone ? (
              <React.Suspense fallback={null}>
                <LazyPhoneFormPopup
                  open={formOpen}
                  title={`${editingRowId ? "编辑" : "新建"} · ${page?.title ?? ""}`}
                  fields={page?.formFields ?? []}
                  values={formValues}
                  onChange={(fieldId, v) =>
                    setFormValues(prev => ({ ...prev, [fieldId]: v }))
                  }
                  onCancel={closeForm}
                  onSubmit={handleCreate}
                  refRowsFor={refRowsFor}
                  enumOptionsFor={enumOptionsFor}
                  fieldProbeProps={f =>
                    page?.entityId
                      ? probe({
                          kind: "field",
                          entityId: page.entityId,
                          fieldId: f.id,
                          label: f.label,
                        })
                      : {}
                  }
                  getContainer={() => canvasEl ?? document.body}
                />
              </React.Suspense>
            ) : (
              <Modal
                title={`${editingRowId ? "编辑" : "新建"} · ${page?.title ?? ""}`}
                open={formOpen}
                onOk={handleCreate}
                onCancel={closeForm}
                okText="保存"
                cancelText="取消"
                destroyOnHidden
                width={modalSizing.width}
                centered={modalSizing.centered}
                styles={{
                  body: {
                    maxHeight: modalSizing.bodyMaxHeight,
                    overflowY: "auto",
                  },
                }}
                getContainer={() => canvasEl ?? document.body}
              >
                {/* antd Form：此前是手写 div + 12px 灰字当 label，没有必填
                    标记、没有错误态、label 也不对齐，右边还挂着 `string`
                    `number` 这种给开发看的类型名。改用 Form 之后这些是白送的——
                    手机档早就在用 antd-mobile 的 Form，PC 反倒落在后面。
                    Form.Item 一律**不给 name**：值仍由 formValues 这个受控
                    state 持有（handleCreate 照旧读它）。不带 name 的 Form.Item
                    在 antd 里就是纯布局容器（form-item.js:213 直接走
                    renderLayout），跟父级受控的值兼容，不会来抢数据。

                    校验也因此**不能用 Form 的 rules**（rules 挂在 name 上，这里
                    没有 name）。所以走 validateRowFields + 受控的 validateStatus/
                    help：提交时算一次，红字标在出问题那一栏。这跟"值由父级持有"
                    是同一个取舍的两面，不是偷懒。 */}
                <Form
                  layout="vertical"
                  size="small"
                  requiredMark
                  style={{ paddingTop: 8 }}
                >
                  {formProblems[""] && (
                    <Alert
                      type="warning"
                      showIcon
                      message={formProblems[""]}
                      style={{ marginBottom: 12 }}
                    />
                  )}
                  {(page?.formFields ?? []).map(f => (
                    <Form.Item
                      key={f.id}
                      label={f.label}
                      style={{ marginBottom: 14 }}
                      validateStatus={formProblems[f.id] ? "error" : undefined}
                      help={formProblems[f.id]}
                    >
                      {/* 游标探针挂在内层 div，不挂 Form.Item——Form.Item 的
                          props 是它自己的一套（onReset 等签名跟 DOM 事件不兼容），
                          它也不会把陌生 prop 透传到 DOM 上。 */}
                      <div
                        {...(page?.entityId
                          ? probe({
                              kind: "field",
                              entityId: page.entityId,
                              fieldId: f.id,
                              label: f.label,
                            })
                          : {})}
                      >
                        <FieldEditor
                          field={f}
                          value={formValues[f.id]}
                          refRows={refRowsFor(f)}
                          enumOptions={enumOptionsFor(f)}
                          onChange={v =>
                            setFormValues(prev => ({ ...prev, [f.id]: v }))
                          }
                        />
                      </div>
                    </Form.Item>
                  ))}
                </Form>
              </Modal>
            )}

            {/* 行详情：手机档走 antd-mobile Popup，桌面档留 antd Drawer。
                原来是把桌面 Drawer 掰成 placement="bottom" 冒充移动端；
                Popup 才是移动端原生形态（圆角/拖拽条/遮罩关闭都是默认行为）。
                正文 detailBody 跨设备共用，这里只换容器。 */}
            {isPhone ? (
              <React.Suspense fallback={null}>
                <LazyPhoneDetailPopup
                  open={detailRow !== null}
                  title={`详情 · ${page?.title ?? currentTitle}`}
                  onClose={closeDetail}
                  getContainer={() => canvasEl ?? document.body}
                >
                  {detailBody}
                </LazyPhoneDetailPopup>
              </React.Suspense>
            ) : (
              <Drawer
                title={`详情 · ${page?.title ?? currentTitle}`}
                open={detailRow !== null && !isTablet}
                onClose={closeDetail}
                placement="right"
                width={420}
                destroyOnHidden
                getContainer={() => canvasEl ?? document.body}
                data-testid="app-runtime-detail"
              >
                {detailBody}
              </Drawer>
            )}
          </ConfigProvider>
        </div>
      </div>

      {/* 档位切换（画布外的排练控制）：设备档 + 代码投影视角。
          平板档已按用户裁决从切换条下架（渲染范式代码保留，随时可回归）。
          有外部挂载点（studio 顶条）时 portal 过去，否则浮在画布左上角。 */}
      {(() => {
        const inBar = controlsContainer !== undefined;
        const gearBar = (
          <div
            className={
              inBar
                ? "flex items-center gap-0.5 rounded-full bg-[#e9edf2] p-0.5"
                : "absolute left-3 top-2 flex items-center gap-0.5 rounded-full bg-black/25 p-0.5"
            }
          >
            {/* 只列这个应用真有设计的档（见 availableDeviceTiers）。
                只剩一档时**这一档的按钮仍然要在**：它同时是「从代码视图回到
                应用视图」的唯一入口（旁边的「代码」按钮只负责进去）。一度想
                过一档就把整条收起来，那会把人留在代码视图里出不来。 */}
            <Segmented
              size="small"
              value={codeView ? "code" : device}
              options={[
                ...deviceTiers.map(key => ({
                  value: key,
                  label: <span data-testid={`app-device-${key}`}>{DEVICE_SPECS[key].label}</span>,
                })),
                { value: "code", label: <span data-testid="app-device-code">代码</span> },
              ]}
              onChange={value => {
                if (value === "code") {
                  setCodeView(true);
                } else if (deviceTiers.includes(value as (typeof deviceTiers)[number])) {
                  setCodeView(false);
                  setDevice(value as (typeof deviceTiers)[number]);
                }
              }}
            />
          </div>
        );
        if (!inBar) return gearBar;
        return controlsContainer
          ? createPortal(gearBar, controlsContainer)
          : null;
      })()}
      {!codeView && showScaleBadge && (
        <ScaleBadge w={spec.w} h={spec.h} scale={scale} />
      )}
    </div>
  );
}
