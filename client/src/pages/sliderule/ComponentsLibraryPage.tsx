/**
 * ComponentsLibraryPage — 组件库（左侧菜单「组件库」，/agent-loop/components）。
 *
 * ## 为什么不进数据库
 *
 * 这份清单是**从代码派生的**，不是内容数据。experience_block_catalog.json 已经是
 * 唯一真相源：Python 侧拿它拼提示词白名单（services/schema_legal.py），TS 侧拿它
 * 做渲染器注册表（vite 的 @experience-blocks 别名指向同一个文件）。
 *
 * 把它抄进数据库就多了第二份真相，一定会漂移——而这里的漂移是危险的：库里说有
 * 某个区块、渲染器却没有（或反过来），而这份目录正是 LLM 生成时对着的契约。
 *
 * 所以这一页**运行时读那份目录**，再逐个用真实渲染器（ExperienceBlockBoundary）
 * 挂起来。往目录里加一个区块，这一页自动就有；渲染器忘了注册，这一页会直接显示
 * 「暂不支持此区块」——漂移不但不会发生，还会被当场看见。
 *
 * 数据库将来可以存的是别的东西：哪个区块被生成得最多、用户的收藏与备注。
 * 那是加法，不影响这一页。
 *
 * ## 形制
 *
 * 数据取法照技能库（SkillsLibraryPage 也是 import json、没有后端表）；
 * **外观照应用中心**（AppsWorkbench，2026-08-07 用户裁决"参考应用中心的这种样式、
 * 筛选、以及卡片的块大小算法"）：
 *
 *   · 吸顶头 —— 图标 + 标题 + 搜索框 + 带计数的筛选 chip，与 AppsWorkbench 同一套类名
 *   · 卡片壳 —— 画面铺满整卡、信息条以底部黑色渐变浮层压在画面上（CenterCard 同款）
 *   · 排布   —— 复用 SpanMasonry（AppsWorkbench 那面卡片墙的同一个组件）
 *
 * 卡片墙那边高度靠"列宽 / 设备宽高比"算，因为应用截图只有三种比例；这里不用算——
 * SpanMasonry 本来就用 ResizeObserver 量真实高度，而各区块**渲染出来的真实高度
 * 本来就差很多**（实测 148~451px），错落是真的，不需要造。
 *
 * 跨列的判据同样必须是真实信息（纪律见 app-wall-span.ts 顶部）：这里用
 * **allowedRegions 含整行区域** —— 整行区域在真实页面里就是通栏的，能放进去的区块
 * 天然需要横向空间（DataTable 要摆列、WorkflowTimeline 要横向展开阶段）。
 * 不是随机、也不是按好看程度挑。
 */

import React from "react";
import { Card, Dropdown, Empty, Pagination, Skeleton, Tooltip } from "antd";
// 顶部一律用 lucide，与 AppsWorkbench 同源；antd 图标只留给卡片内部。
import { ChevronDown, LayoutGrid, Monitor, Rows3, Search, Smartphone, Sparkles, Star, X } from "lucide-react";
import { useContainerPosition } from "masonic";
import catalogJson from "@experience-blocks";
import { SpanMasonry } from "@/pages/agent-loop/dashboard/SpanMasonry";
import { useScrollerIn } from "@/pages/agent-loop/dashboard/useScrollerIn";
import { spanForColumnCount } from "@/pages/agent-loop/dashboard/app-wall-span";
import { requestMountPermit } from "@/lib/mount-scheduler";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary } from "./live-runtime/block-registry";
import { interleaveWide, isWideBlock } from "./block-wall-order";
import {
  buildComponentPreviewEntries,
  COMPONENT_WALL_PAGE_SIZE,
  paginateComponentPreviews,
  type ComponentPreviewDevice,
  type ComponentWallDevice,
} from "./component-wall-pagination";
import {
  BASE_COMPONENTS,
  BASE_GROUPS,
  BASE_SOURCES,
} from "./base-components/base-catalog";
import { findScrollParent } from "../agent-loop/dashboard/useScrollerIn";
import { LibraryPreviewScope } from "./library-preview-focus";
import { buildIndex } from "./component-search";
import { blocksUsing, usageForBlock, usageMapFor, usageStats } from "./component-usage";
import {
  clearRecent,
  markRecent,
  readFavorites,
  readRecent,
  toggleFavorite,
} from "./component-marks";
import BusinessPageGrid from "./live-runtime/BusinessPageGrid";
import {
  resolveBusinessGrid,
  regionsToGrid,
  type BusinessRegions,
} from "./live-runtime/business-page-layout";
import type {
  ExperienceBlockInstance,
  FilterFieldOption,
  BlockColumnState,
  PageColumnState,
  PageFilterState,
  PageFocusState,
  PageSelectionState,
} from "./live-runtime/block-registry";
import { isPhoneExperienceBlock } from "./live-runtime/phone-mobile/PhoneExperienceBlock";
import type { RuntimeRow } from "./live-runtime/live-runtime";
import type {
  FieldFormat,
  NormalizedFieldOption,
} from "./live-runtime/field-display";
import type { AppFormFieldSchema } from "./live-runtime/app-runtime-schema";


const PRIMARY = "#1677ff";
const CHARTS = ["#1677ff", "#52c41a", "#faad14", "#722ed1", "#13c2c2"];
/**
 * 顶部筛选 chip —— 与 AppsWorkbench 的 TabButton / StatChip 逐字同款。
 *
 * 原来用的是 antd `Tag.CheckableTag`，配色虽然对上了，但得靠一串 `!important`
 * 去压 antd 自带的 margin/border/padding；`!m-0`、`!border-0`、`!px-3` 这些一旦
 * 有一条被 antd 版本改动顶掉，样式就会悄悄偏一点。应用中心那边本来就是普通
 * button，直接用同一个，`!important` 一个都不需要。
 *
 * icon 可选，是照那边的分工：库切换那排（我的应用 / 官方示例）不带图标，
 * 只有条件筛选那排才带——混着用会让"切内容"和"筛条件"在视觉上分不开。
 */
function FilterChip({
  icon,
  label,
  count,
  active,
  onClick,
  testid,
}: {
  icon?: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  testid?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testid}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
        active
          ? "bg-[#e8eeff] text-[#3b5bdb]"
          : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
      }`}
      onClick={onClick}
    >
      {icon && <span className={active ? "opacity-100" : "opacity-70"}>{icon}</span>}
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`tabular-nums text-[11px] ${
            active ? "text-[#3b5bdb]/80" : "text-slate-400"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
/**
 * ── 筛选条 —— 照 Shopify Polaris 的 Filters 模型重做（2026-08-08）─────────
 *
 * ## 为什么重做
 *
 * 用户："目前顶部的筛选区域已经承载不了我们目前的页面，包括筛选的级联关系，
 * 包括现在的排列方式，已经承载不住了。"
 *
 * 症结有两条，第二条更要命：
 *
 *   ① **占地方**：三行 chip 常驻（范式 7 + 区域 6 + 能力 7 = 20 个），
 *      内容还没开始就吃掉三行高度。组件从 14 长到 137，只会更糟。
 *   ② **层次混了**：范式/区域是"区块"那一层的维度（页面形态、槽位），
 *      能力是"基础组件"那一层的（官方分组），行业是"模板"那一层的。
 *      现在不管在哪个档都全摆着——在基础组件档下摆着区块的槽位筛选，
 *      点了什么也不会发生。这就是用户说的"级联关系承载不住"。
 *
 * ## 抄的什么
 *
 * Shopify/polaris 的 Filters（polaris-react/src/components/Filters）：
 *
 *     filters: FilterInterface[]       每个维度一条：key + label + 控件
 *                                      pinned 才常驻，其余收进「+ 添加筛选」
 *     appliedFilters: AppliedFilter[]  **只有已选中的**才以 pill 形式占位，
 *                                      可单独 × 掉
 *     onClearAll                       一键清空
 *
 * 关窍是那句 "Applied filters which are rendered as filter pills"——
 * **筛选项平时不占地方，占地方的只有你已经选了的**。20 个 chip 于是塌成
 * 几个下拉按钮 + 零到三个 pill。
 *
 * 层次问题则靠"每个模式带自己那套维度"解决（对应 Polaris 的 tabs + 每个 tab
 * 自己的 filters 数组）：基础组件档只有能力和端，区块档才有范式和区域。
 * 不适用的维度**根本不出现**，而不是出现了点不动。
 */
interface FilterDim {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string; count?: number }[];
  onChange: (v: string) => void;
}

function FilterBarRow({
  dims,
  extra,
}: {
  dims: FilterDim[];
  extra?: React.ReactNode;
}) {
  const applied = dims.filter(d => d.value !== "all");
  const labelOf = (d: FilterDim) =>
    d.options.find(o => o.value === d.value)?.label ?? d.value;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="components-filters">
      {dims.map(d => (
        <Dropdown
          key={d.key}
          trigger={["click"]}
          menu={{
            selectable: true,
            selectedKeys: [d.value],
            items: d.options.map(o => ({
              key: o.value,
              label: (
                <span className="inline-flex min-w-[120px] items-center gap-3">
                  <span>{o.label}</span>
                  {o.count !== undefined && (
                    <span className="ml-auto tabular-nums text-[11px] text-slate-400">
                      {o.count}
                    </span>
                  )}
                </span>
              ),
            })),
            onClick: ({ key }) => d.onChange(key),
          }}
        >
          <button
            type="button"
            data-testid={`filter-dim-${d.key}`}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
              d.value !== "all"
                ? "bg-[#e8eeff] text-[#3b5bdb]"
                : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
            }`}
          >
            {d.label}
            <ChevronDown size={13} className="opacity-60" />
          </button>
        </Dropdown>
      ))}

      {/* 已选中的才占位。这是整个改动的关窍——平时这一段是空的。 */}
      {applied.length > 0 && (
        <>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          {applied.map(d => (
            <span
              key={d.key}
              data-testid={`filter-pill-${d.key}`}
              className="inline-flex items-center gap-1 rounded-lg bg-[#5b6cff] px-2.5 py-1.5 text-[12px] font-medium text-white"
            >
              {d.label}：{labelOf(d)}
              <button
                type="button"
                aria-label={`清除${d.label}筛选`}
                className="ml-0.5 opacity-70 transition hover:opacity-100"
                onClick={() => d.onChange("all")}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            type="button"
            data-testid="filter-clear-all"
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-slate-500 transition hover:bg-slate-100"
            onClick={() => applied.forEach(d => d.onChange("all"))}
          >
            清空
          </button>
        </>
      )}

      {extra && <span className="ml-auto flex items-center gap-1.5">{extra}</span>}
    </div>
  );
}

interface CatalogBlock {
  type: string;
  description?: string;
  rendererKey?: string;
  rendererStatus?: string;
  generationEnabled?: boolean;
  dataKinds?: string[];
  allowedRegions?: string[];
  pageKinds?: string[];
  freeformGenerated?: boolean;
}

/** 页面形态预设：一套"已经排好的积木组合"。与 Python 侧同源同一份 JSON。 */
interface PagePreset {
  id: string;
  name: string;
  when: string;
  blocks: { type: string; slot: string }[];
}

const CATALOG = catalogJson as unknown as {
  blocks: CatalogBlock[];
  /** 区域目录 —— 键就是区域名，值带 label / band / 出处（见 pageRegions 的注释）。 */
  pageRegions: Record<string, { label: string; band: string; evidence: string }>;
  dataKinds: string[];
  pageKindPresets?: Record<string, PagePreset[]>;
};

/**
 * 「背后是哪个真组件」这一条**目录里没有**——它是渲染器的实现细节，得手维护。
 *
 * 手维护的东西会烂，所以下面有一道自检：目录里有、这张表里没有的类型会显示成
 * 「未登记」，而不是静静地空着。看见「未登记」就是在提醒来补一行。
 */
/**
 * 「背后是哪个真组件」与中文名 —— **从区块定义表派生**（2026-08-08）。
 *
 * 此前这里是一张手维护的表，加组件忘了补就显示「实现未登记」。现在唯一
 * 真相是 block-registry 的 BLOCK_DEFINITIONS：那条记录里已经带着 impl 和
 * label，这里只是读出来。加组件不再需要来改这一处。
 */
const IMPL_BY_TYPE: Record<string, string> = Object.fromEntries(
  Object.keys(BLOCK_DEFINITIONS).map(type => {
    const usage = usageForBlock(type);
    const parts = [
      usage.desktop.length > 0 ? `桌面 ${usage.desktop.join(" + ")}` : "",
      usage.phone.length > 0 ? `手机 ${usage.phone.join(" + ")}` : "",
    ].filter(Boolean);
    return [type, parts.length > 0 ? parts.join(" / ") : "非组件实现"];
  })
);

/**
 * 反查：这个基础组件被哪些区块用到了。
 *
 * 2026-08-08 用户问了一句要害的话：「AI 组装它是真的从这 130 多个组件里面
 * 组装的吗」。答案是不是——装配器看得见的是 13 个区块，基础组件由区块内部
 * 调用。所以真正该回答的是"137 个里有多少真的被区块用上了"，而这个数字
 * 此前**说不出来**，因为那层关系只存在一个手写字符串里。
 *
 * 现在能算了，而且组件库直接把它标出来：没有任何区块用到的组件，如实显示
 * 「还没接进区块」。那是覆盖缺口，不是 bug——但看不见它就没法有意识地补。
 */
/**
 * 组件反查来自真实渲染器依赖图，不再读取仅覆盖部分桌面组件的手写 `uses`。
 * 依赖图由脚本从桌面/手机渲染器的 JSX 与本地 helper 调用链生成。
 */
const COMPONENT_USAGE = usageMapFor(BASE_COMPONENTS);
const BLOCKS_USING: Record<string, string[]> = Object.fromEntries(
  BASE_COMPONENTS.map(component => [component.name, blocksUsing(component.name)])
);
const COMPONENT_USAGE_STATS = usageStats(BASE_COMPONENTS);
const LABEL_BY_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(BLOCK_DEFINITIONS).map(([type, d]) => [type, d.label])
);


/**
 * 检索索引**建一次**。
 *
 * 语料是两份静态目录（区块 23 + 基础组件 217），运行期不会变，所以在模块级
 * 建好。放进组件里用 useMemo 也行，但那样每个挂载点各建一份——这一页在预览
 * 和真实壳里可能同时存在。
 */
const SEARCH = buildIndex(
  type => LABEL_BY_TYPE[type],
  name => BLOCKS_USING[name] ?? []
);

/**
 * 卡片阴影。**必须走行内样式，不能用 Tailwind 的 `shadow-[…]` 类**。
 *
 * 2026-08-08 用户说"阴影再多一丢丢"，去量才发现：这一页三处卡片上写了半年的
 * `shadow-[0_3px_14px_rgba(15,23,42,0.10)]` **一次都没生效过**，屏幕上一直是
 * antd Card 自己那三层默认阴影。
 *
 * 原因不是拼错、也不是没被 Tailwind 扫到——那条规则确实生成了，实测就在
 * CSS 里：
 *
 *     Tailwind  @layer utilities { .shadow-\[0_4px_18px…\] { … } }
 *     antd      （无 layer）      :where(.css-…).ant-card:not(.ant-card-bordered) { … }
 *
 * **无 layer 的样式整体压过任何 layer 里的样式**，跟选择器权重无关（antd 那条
 * 还特意用了 `:where()` 把权重降到 0，照样赢）。所以只要组件是 antd 的，
 * Tailwind 的工具类就盖不住它自带的那几个属性。
 *
 * 行内样式没有这个问题——它在层叠里高于所有规则。
 *
 * 想从根上解决得让 antd 也进 layer（StyleProvider 的 `layer` 选项），那是全站
 * 行为，不该在"把卡片阴影调深一点"这件事里顺手改。
 */
const CARD_SHADOW = "0 4px 18px rgba(15, 23, 42, 0.14)";

/** 次级卡（提议卡、区域分组卡）用更轻的一档，同样只能走行内样式。 */
const CARD_SHADOW_SOFT = "0 1px 6px rgba(15, 23, 42, 0.08)";

const SLOT_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(CATALOG.pageRegions ?? {}).map(([key, region]) => [key, region.label])
);

const DATAKIND_LABEL: Record<string, string> = {
  aggregate: "聚合值",
  series: "时间序列",
  rankedRows: "排序行",
  timelineRows: "时间轴行",
  entityRows: "实体行",
};

// ── 夹具：所有区块共用一份，看的是长相不是数据 ─────────────────────

const FIELD_LABEL: Record<string, string> = {
  name: "门店",
  amount: "金额",
  status: "状态",
  channel: "渠道",
  at: "日期",
  // 2026-08-08 补的六种字段语义要在对照台上**看得见**才叫接上了。
  // 只有类型定义没有真实数据的话，邮箱有没有出 mailto、图片有没有出缩略图，
  // 谁都不知道。
  contact: "联系邮箱",
  detailUrl: "详情链接",
  cover: "门店照片",
  remark: "备注",
  urgent: "加急",
  owner_id: "负责人",
  weekDelta: "周涨幅",
  // 三个数值字段专为**格式**而设（阶段④）：类型都是 number，长相三样都不同，
  // 靠的正是 format。少了它们，六种格式里有三种在对照台上根本没有承载体。
  fulfillRate: "履约完成度",
  healthScore: "健康分",
  starLevel: "服务星级",
  orderId: "所属订单",
  action: "操作",
  operator: "操作人",
  fileName: "文件名",
  fileSize: "文件大小",
  fileStatus: "文件状态",
  uploadedAt: "上传时间",
  author: "作者",
  content: "内容",
  avatar: "头像",
  commentStatus: "审核状态",
  parentId: "父评论",
  commentedAt: "评论时间",
  eventTitle: "日程标题",
  startAt: "开始时间",
  endAt: "结束时间",
  eventStatus: "日程状态",
  noticeTitle: "通知标题",
  noticeContent: "通知内容",
  noticeCategory: "通知分类",
  noticeRead: "是否已读",
  notifiedAt: "通知时间",
  nodeLabel: "节点名称",
  nodeParent: "父节点",
  nodeDesc: "节点说明",
  approvalTitle: "审批标题",
  approvalStatus: "审批状态",
  applicant: "申请人",
  submittedAt: "提交时间",
  approvalSummary: "申请摘要",
  auditActor: "操作人",
  auditAction: "操作动作",
  auditTime: "操作时间",
  auditResult: "执行结果",
  changedField: "变更字段",
  beforeValue: "变更前",
  afterValue: "变更后",
  workProject: "所属项目",
  workCycle: "所属周期",
  workDue: "截止时间",
  workLabels: "标签",
  documentCollection: "所属集合",
  documentOwner: "所有者",
  documentVisibility: "可见范围",
  documentUpdated: "最后更新",
  catalogOwner: "负责人",
  catalogLifecycle: "生命周期",
  catalogSystem: "所属系统",
  catalogDomain: "所属领域",
  sourceDatabase: "数据库",
  sourceSchema: "Schema",
  sourceName: "数据来源",
  sourceType: "来源类型",
};

/** 字段类型：表单族按它决定出哪种控件（enum→下拉、number→数字、date→日期）。
 *  与 FIELD_LABEL 同源同形——这一页是对照台，两张表都得跟真实数据模型对得上。 */
const FIELD_TYPE: Record<string, string> = {
  name: "string",
  amount: "number",
  status: "enum",
  channel: "enum",
  at: "date",
  // cover 用的是**站内静态资源路径**，不是 picsum 这类外链图床。对照台要在
  // 离线/内网里也能看出"图片语义出的是缩略图"——外链一挡就是六个碎图标，
  // 那时候分不清是语义没接上还是网没通。
  //
  // 这几个**故意声明成 string**：真实数据模型里邮箱、链接、图片地址都是字符串，
  // 更细的语义得从值看出来。这正好压住"声明成字符串就不再往下看"那个坑
  // （上一版就是那样，六种新语义对声明过的字段全部失效）。
  contact: "string",
  detailUrl: "string",
  cover: "string",
  remark: "text",
  urgent: "boolean",
  owner_id: "ref",
  weekDelta: "number",
  fulfillRate: "number",
  healthScore: "number",
  starLevel: "number",
  orderId: "ref",
  action: "string",
  operator: "string",
  fileName: "string",
  fileSize: "number",
  fileStatus: "enum",
  uploadedAt: "date",
  author: "string",
  content: "text",
  avatar: "string",
  commentStatus: "enum",
  parentId: "ref",
  commentedAt: "date",
  eventTitle: "string",
  startAt: "date",
  endAt: "date",
  eventStatus: "enum",
  noticeTitle: "string",
  noticeContent: "text",
  noticeCategory: "enum",
  noticeRead: "enum",
  notifiedAt: "date",
  nodeLabel: "string",
  nodeParent: "ref",
  nodeDesc: "text",
  approvalTitle: "string",
  approvalStatus: "enum",
  applicant: "string",
  submittedAt: "date",
  approvalSummary: "text",
  auditActor: "string",
  auditAction: "string",
  auditTime: "date",
  auditResult: "enum",
  changedField: "string",
  beforeValue: "text",
  afterValue: "text",
  workProject: "string",
  workCycle: "string",
  workDue: "date",
  workLabels: "string",
  documentCollection: "string",
  documentOwner: "string",
  documentVisibility: "enum",
  documentUpdated: "date",
};

/**
 * 字段的展示格式（2026-08-08，阶段④）。
 *
 * 类型决定用哪个控件**族**，格式决定这一族里的**哪一个**：三个字段同为
 * number，money 出金额框、percent 出带 % 的数字框、progress 出滑杆、
 * rating 出星星、score 出无上限数字框——差别全在格式上。
 *
 * 合法域见 five_system_legal.json 的 numberFormats / stringFormats，六种在这里
 * **一次全露**：对照台上看不见就等于没接上——这条在 ①c 上已经吃过一次亏
 * （六种字段语义写完了，但没有一个字段用得上，全是死代码而看不出来）。
 */
const FIELD_FORMAT: Record<string, FieldFormat> = {
  amount: "money",
  weekDelta: "percent",
  fulfillRate: "progress",
  healthScore: "score",
  starLevel: "rating",
  contact: "masked",
};

/**
 * 枚举取值：表单族的 enum 字段靠它出下拉，表格/详情靠它把取值 id 翻成标签。
 *
 * **必须与 ENTITY_ROWS 里真实出现的取值对上**——对不上的话下拉里选不到行数据
 * 里已有的值，而这一页恰恰是用来看"契约真的接上了没有"的。
 */
const ENUM_OPTIONS: Record<string, NormalizedFieldOption[]> = {
  status: [
    { id: "todo", label: "待办", tone: "default" },
    { id: "doing", label: "进行中", tone: "processing" },
    { id: "done", label: "已完成", tone: "success" },
  ],
  channel: [
    { id: "线上", label: "线上", tone: "default" },
    { id: "门店", label: "门店", tone: "default" },
    { id: "电话", label: "电话", tone: "default" },
  ],
  fileStatus: [
    { id: "ready", label: "可用", tone: "success" },
    { id: "uploading", label: "上传中", tone: "processing" },
    { id: "failed", label: "失败", tone: "danger" },
  ],
  commentStatus: [
    { id: "published", label: "已发布", tone: "success" },
    { id: "reviewing", label: "审核中", tone: "warning" },
  ],
  eventStatus: [
    { id: "confirmed", label: "已确认", tone: "success" },
    { id: "pending", label: "待确认", tone: "warning" },
  ],
  noticeCategory: [
    { id: "系统", label: "系统", tone: "processing" },
    { id: "任务", label: "任务", tone: "warning" },
    { id: "协作", label: "协作", tone: "default" },
  ],
  noticeRead: [
    { id: "read", label: "已读", tone: "default" },
    { id: "unread", label: "未读", tone: "processing" },
  ],
  approvalStatus: [
    { id: "pending", label: "待处理", tone: "warning" },
    { id: "approved", label: "已通过", tone: "success" },
    { id: "rejected", label: "已驳回", tone: "danger" },
  ],
  auditResult: [
    { id: "success", label: "成功", tone: "success" },
    { id: "failed", label: "失败", tone: "danger" },
  ],
};

/**
 * 关联单据的示例数据（2026-08-08，②批次 4）。
 *
 * 关联单据表要证明的正是"**只显示挂在这一条下面的**"，所以必须有一个子实体、
 * 而且它的行要分属不同的主记录——全挂在同一条下面的话，筛没筛都一样，看不出
 * 对错。这里六条日志分给三张订单。
 */
const ORDER_LOGS: RuntimeRow[] = [
  ["order-1", "创建订单", "曲丽丽", "2026-08-06"],
  ["order-1", "财务复核", "付小小", "2026-08-06"],
  ["order-1", "已发货", "周毛毛", "2026-08-07"],
  ["order-2", "创建订单", "林东东", "2026-08-05"],
  ["order-2", "部门初审", "陈帅帅", "2026-08-05"],
  ["order-4", "创建订单", "曲丽丽", "2026-08-04"],
].map(([orderId, action, operator, at], i) => ({
  id: `log-${i + 1}`,
  values: { orderId, action, operator, at },
  createdAt: `2026-08-0${(i % 7) + 1}T09:00:00.000Z`,
}));


/**
 * 字段声明的**单一出口**（2026-08-08，阶段④）。
 *
 * 表单族原来要四个查询各问一次（标签/类型/取值/格式），加一样属性就要多接一
 * 根线、两个宿主各改一处、护栏补一条。这里把上面四张夹具表拼成渲染器认识的
 * 字段声明，以后加属性只改这一个函数。
 *
 * 真实运行时那边同名的 fieldSchemaOf 是从数据模型现查的——两边形状必须一样，
 * 否则对照台上好使、真应用里不好使，而这一页存在的意义正是把这种差别照出来。
 */
function fieldSchemaOf(_entityRef: string, fieldId: string): AppFormFieldSchema {
  const schema: AppFormFieldSchema = {
    id: fieldId,
    label: FIELD_LABEL[fieldId] ?? fieldId,
    type: FIELD_TYPE[fieldId] ?? "string",
  };
  const options = ENUM_OPTIONS[fieldId];
  if (options?.length) schema.options = options;
  const format = FIELD_FORMAT[fieldId];
  if (format) schema.format = format;
  // ref 字段指向哪张表。夹具里 orderLog.orderId 指向订单；owner_id 没有对应
  // 实体，**故意留空**——渲染器该退回文本框而不是编一个假下拉，这一档也得
  // 在对照台上看得见。
  if (fieldId === "orderId") schema.refEntityId = "order";
  return schema;
}

export const ENTITY_ROWS: Record<string, RuntimeRow[]> = {
  orderLog: ORDER_LOGS,
  attachment: [
    { id: "file-1", values: { fileName: "门店巡检报告.pdf", fileSize: 2488320, fileStatus: "ready", uploadedAt: "2026-08-08" }, createdAt: "2026-08-08T09:00:00.000Z" },
    { id: "file-2", values: { fileName: "现场照片.zip", fileSize: 7340032, fileStatus: "uploading", uploadedAt: "2026-08-09" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "file-3", values: { fileName: "整改说明.docx", fileSize: 184320, fileStatus: "ready", uploadedAt: "2026-08-09" }, createdAt: "2026-08-09T10:00:00.000Z" },
  ],
  comment: [
    { id: "comment-1", values: { author: "陈晓", content: "高新店的整改材料已经补齐，请复核。", avatar: "/brand/miantuan-mark.png", commentStatus: "published", parentId: "", commentedAt: "2026-08-09" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "comment-2", values: { author: "周宁", content: "收到，消防通道照片还需要补一张近景。", avatar: "/assets/sliderule-mark.svg", commentStatus: "published", parentId: "comment-1", commentedAt: "2026-08-09" }, createdAt: "2026-08-09T09:20:00.000Z" },
    { id: "comment-3", values: { author: "林雪", content: "人民路店本周的复查时间调整到周五下午。", avatar: "/brand/logo.png", commentStatus: "reviewing", parentId: "", commentedAt: "2026-08-08" }, createdAt: "2026-08-08T15:00:00.000Z" },
  ],
  schedule: [
    { id: "event-1", values: { eventTitle: "高新店复查", startAt: "2026-08-09", endAt: "2026-08-09", eventStatus: "confirmed" }, createdAt: "2026-08-08T09:00:00.000Z" },
    { id: "event-2", values: { eventTitle: "消防材料评审", startAt: "2026-08-09", endAt: "2026-08-09", eventStatus: "pending" }, createdAt: "2026-08-08T10:00:00.000Z" },
    { id: "event-3", values: { eventTitle: "人民路店季度盘点", startAt: "2026-08-12", endAt: "2026-08-12", eventStatus: "confirmed" }, createdAt: "2026-08-08T11:00:00.000Z" },
  ],
  notification: [
    { id: "notice-1", values: { noticeTitle: "巡检报告已通过", noticeContent: "人民路店本周巡检报告已经完成复核。", noticeCategory: "系统", noticeRead: "unread", notifiedAt: "2026-08-09 10:30" }, createdAt: "2026-08-09T10:30:00.000Z" },
    { id: "notice-2", values: { noticeTitle: "待补充现场照片", noticeContent: "高新店消防通道需要补充一张近景照片。", noticeCategory: "任务", noticeRead: "unread", notifiedAt: "2026-08-09 09:20" }, createdAt: "2026-08-09T09:20:00.000Z" },
    { id: "notice-3", values: { noticeTitle: "复查时间已调整", noticeContent: "林雪将人民路店复查调整到周五下午。", noticeCategory: "协作", noticeRead: "read", notifiedAt: "2026-08-08 16:10" }, createdAt: "2026-08-08T16:10:00.000Z" },
  ],
  hierarchy: [
    { id: "region-east", values: { nodeLabel: "华东区域", nodeParent: "", nodeDesc: "6 家门店" }, createdAt: "2026-08-09T08:00:00.000Z" },
    { id: "city-hangzhou", values: { nodeLabel: "杭州", nodeParent: "region-east", nodeDesc: "4 家" }, createdAt: "2026-08-09T08:01:00.000Z" },
    { id: "store-renmin", values: { nodeLabel: "人民路店", nodeParent: "city-hangzhou", nodeDesc: "正常营业" }, createdAt: "2026-08-09T08:02:00.000Z" },
    { id: "store-gaoxin", values: { nodeLabel: "高新店", nodeParent: "city-hangzhou", nodeDesc: "待复查" }, createdAt: "2026-08-09T08:03:00.000Z" },
    { id: "city-suzhou", values: { nodeLabel: "苏州", nodeParent: "region-east", nodeDesc: "2 家" }, createdAt: "2026-08-09T08:04:00.000Z" },
    { id: "region-south", values: { nodeLabel: "华南区域", nodeParent: "", nodeDesc: "3 家门店" }, createdAt: "2026-08-09T08:05:00.000Z" },
  ],
  approval: [
    { id: "approval-1", values: { approvalTitle: "高新店整改延期", approvalStatus: "pending", applicant: "陈晓", submittedAt: "2026-08-09 09:30", approvalSummary: "申请延期至本周五完成消防材料补充" }, createdAt: "2026-08-09T09:30:00.000Z" },
    { id: "approval-2", values: { approvalTitle: "人民路店临时闭店", approvalStatus: "pending", applicant: "周宁", submittedAt: "2026-08-09 08:50", approvalSummary: "设备检修，申请闭店两小时" }, createdAt: "2026-08-09T08:50:00.000Z" },
    { id: "approval-3", values: { approvalTitle: "季度盘点人员调整", approvalStatus: "approved", applicant: "林雪", submittedAt: "2026-08-08 16:10", approvalSummary: "增加一名盘点复核人员" }, createdAt: "2026-08-08T16:10:00.000Z" },
  ],
  audit: [
    { id: "audit-1", values: { auditActor: "陈晓", auditAction: "更新门店状态", auditTime: "2026-08-09 10:18", auditResult: "success", changedField: "status", beforeValue: "待复查", afterValue: "已完成" }, createdAt: "2026-08-09T10:18:00.000Z" },
    { id: "audit-2", values: { auditActor: "周宁", auditAction: "修改复查时间", auditTime: "2026-08-09 09:42", auditResult: "success", changedField: "reviewAt", beforeValue: "2026-08-10 14:00", afterValue: "2026-08-12 15:30" }, createdAt: "2026-08-09T09:42:00.000Z" },
    { id: "audit-3", values: { auditActor: "系统", auditAction: "同步审批结果", auditTime: "2026-08-08 18:05", auditResult: "failed", changedField: "approvalStatus", beforeValue: "pending", afterValue: "网络超时，未写入" }, createdAt: "2026-08-08T18:05:00.000Z" },
  ],
  importMapping: [
    { id: "map-1", values: { sourceColumn: "门店名称", targetField: "storeName", mappingStatus: "valid", sampleValue: "人民路店", mappingIssue: "" }, createdAt: "2026-08-09T11:00:00.000Z" },
    { id: "map-2", values: { sourceColumn: "巡检日期", targetField: "inspectedAt", mappingStatus: "valid", sampleValue: "2026-08-09", mappingIssue: "" }, createdAt: "2026-08-09T11:00:00.000Z" },
    { id: "map-3", values: { sourceColumn: "整改状态", targetField: "status", mappingStatus: "pending", sampleValue: "待复查", mappingIssue: "" }, createdAt: "2026-08-09T11:00:00.000Z" },
  ],
  asyncTask: [
    { id: "task-1", values: { taskTitle: "导入门店巡检数据", taskStatus: "running", progressCurrent: 68, progressTotal: 120, taskError: "", taskResult: "", taskTime: "2026-08-09 11:08" }, createdAt: "2026-08-09T11:08:00.000Z" },
    { id: "task-2", values: { taskTitle: "生成月度经营报表", taskStatus: "succeeded", progressCurrent: 80, progressTotal: 80, taskError: "", taskResult: "report-2026-08.xlsx", taskTime: "2026-08-09 10:42" }, createdAt: "2026-08-09T10:42:00.000Z" },
    { id: "task-3", values: { taskTitle: "同步历史审批记录", taskStatus: "failed", progressCurrent: 23, progressTotal: 60, taskError: "上游接口连接超时", taskResult: "", taskTime: "2026-08-09 09:55" }, createdAt: "2026-08-09T09:55:00.000Z" },
  ],
  permission: [
    { id: "perm-1", values: { resourceName: "门店档案", canView: "allow", canCreate: "allow", canEdit: "allow", canDelete: "deny" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "perm-2", values: { resourceName: "巡检任务", canView: "allow", canCreate: "inherit", canEdit: "allow", canDelete: "deny" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "perm-3", values: { resourceName: "审批记录", canView: "allow", canCreate: "deny", canEdit: "inherit", canDelete: "deny" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  member: [
    { id: "member-1", values: { memberName: "陈晓", memberAccount: "chenxiao@example.com", memberStatus: "active", membership: "member", memberAvatar: "/brand/miantuan-mark.png" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "member-2", values: { memberName: "周宁", memberAccount: "zhouning@example.com", memberStatus: "active", membership: "member", memberAvatar: "/assets/sliderule-mark.svg" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "member-3", values: { memberName: "林雪", memberAccount: "linxue@example.com", memberStatus: "active", membership: "candidate", memberAvatar: "/brand/logo.png" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "member-4", values: { memberName: "王晨", memberAccount: "wangchen@example.com", memberStatus: "invited", membership: "candidate", memberAvatar: "" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  alert: [
    { id: "alert-1", values: { alertTitle: "支付接口错误率升高", alertState: "firing", alertSeverity: "critical", alertTime: "2026-08-09 11:20", alertLabels: "service=payment, env=prod" }, createdAt: "2026-08-09T11:20:00.000Z" },
    { id: "alert-2", values: { alertTitle: "订单积压接近阈值", alertState: "pending", alertSeverity: "warning", alertTime: "2026-08-09 11:10", alertLabels: "queue=orders, env=prod" }, createdAt: "2026-08-09T11:10:00.000Z" },
    { id: "alert-3", values: { alertTitle: "库存同步延迟", alertState: "resolved", alertSeverity: "info", alertTime: "2026-08-09 10:40", alertLabels: "job=inventory" }, createdAt: "2026-08-09T10:40:00.000Z" },
  ],
  alertPolicy: [
    { id: "policy-root", values: { policyName: "默认路由", policyParent: "", policyMatcher: "全部告警", policyReceiver: "运维值班群" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "policy-critical", values: { policyName: "严重告警", policyParent: "policy-root", policyMatcher: "severity=critical", policyReceiver: "电话 + 短信" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "policy-payment", values: { policyName: "支付服务", policyParent: "policy-critical", policyMatcher: "service=payment", policyReceiver: "支付负责人" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  deletedRecord: [
    { id: "deleted-1", values: { deletedTitle: "湖畔店旧巡检任务", deletedAt: "2026-08-08", deletedBy: "陈晓" }, createdAt: "2026-08-08T09:00:00.000Z" },
    { id: "deleted-2", values: { deletedTitle: "季度临时报表", deletedAt: "2026-08-07", deletedBy: "周宁" }, createdAt: "2026-08-07T09:00:00.000Z" },
  ],
  revision: [
    { id: "revision-3", values: { revisionVersion: 3, revisionAuthor: "陈晓", revisionTime: "2026-08-09", revisionSummary: "补充消防材料", revisionCurrent: "current" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "revision-2", values: { revisionVersion: 2, revisionAuthor: "周宁", revisionTime: "2026-08-08", revisionSummary: "调整复查日期", revisionCurrent: "history" }, createdAt: "2026-08-08T09:00:00.000Z" },
    { id: "revision-1", values: { revisionVersion: 1, revisionAuthor: "林雪", revisionTime: "2026-08-07", revisionSummary: "创建记录", revisionCurrent: "history" }, createdAt: "2026-08-07T09:00:00.000Z" },
  ],
  funnelStage: [
    { id: "stage-1", values: { stageName: "访问", stageValue: 1200 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "stage-2", values: { stageName: "咨询", stageValue: 760 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "stage-3", values: { stageName: "下单", stageValue: 420 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "stage-4", values: { stageName: "支付", stageValue: 318 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  businessFlow: [
    { id: "flow-1", values: { flowSource: "访问", flowTarget: "咨询", flowValue: 760 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "flow-2", values: { flowSource: "咨询", flowTarget: "下单", flowValue: 420 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "flow-3", values: { flowSource: "下单", flowTarget: "支付", flowValue: 318 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "flow-4", values: { flowSource: "咨询", flowTarget: "流失", flowValue: 340 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  projectSchedule: [
    { id: "plan-1", values: { planTitle: "需求确认", planStart: "2026-08-09", planEnd: "2026-08-11", planGroup: "已完成" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "plan-2", values: { planTitle: "现场巡检", planStart: "2026-08-11", planEnd: "2026-08-15", planGroup: "进行中" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "plan-3", values: { planTitle: "整改复核", planStart: "2026-08-14", planEnd: "2026-08-18", planGroup: "待开始" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  alertRule: [
    { id: "rule-1", values: { ruleName: "支付错误率", ruleQuery: "rate(payment_errors[5m])", ruleThreshold: 5, ruleSeverity: "critical" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  muteTiming: [
    { id: "mute-1", values: { muteName: "周末维护", muteWeekdays: "周六、周日", muteStart: "00:00", muteEnd: "06:00", muteTimezone: "Asia/Shanghai" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "mute-2", values: { muteName: "每日备份", muteWeekdays: "每天", muteStart: "02:00", muteEnd: "02:30", muteTimezone: "Asia/Shanghai" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  contactPoint: [
    { id: "contact-1", values: { contactName: "运维值班群", contactType: "webhook", contactAddress: "https://hooks.example.com/ops", contactStatus: "ready" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "contact-2", values: { contactName: "严重告警短信", contactType: "sms", contactAddress: "值班号码组", contactStatus: "ready" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  liveChange: [
    { id: "change-1", values: { changeTitle: "人民路店", changeAction: "更新", changeActor: "周宁", changeTime: "2026-08-09 11:26" }, createdAt: "2026-08-09T11:26:00.000Z" },
    { id: "change-2", values: { changeTitle: "高新店复查", changeAction: "新增", changeActor: "林雪", changeTime: "2026-08-09 11:24" }, createdAt: "2026-08-09T11:24:00.000Z" },
  ],
  availability: [
    { id: "availability-1", values: { weekday: "周一", startTime: "09:00", endTime: "12:00", enabled: "enabled" }, createdAt: "2026-08-09T08:00:00.000Z" },
    { id: "availability-2", values: { weekday: "周一", startTime: "14:00", endTime: "18:00", enabled: "enabled" }, createdAt: "2026-08-09T08:01:00.000Z" },
    { id: "availability-3", values: { weekday: "周二", startTime: "10:00", endTime: "16:00", enabled: "disabled" }, createdAt: "2026-08-09T08:02:00.000Z" },
  ],
  bookingSlot: [
    { id: "slot-1", values: { slotStart: "2026-08-11T09:00:00+08:00", slotEnd: "2026-08-11T09:30:00+08:00", availability: "available", capacity: 3 }, createdAt: "2026-08-09T08:00:00.000Z" },
    { id: "slot-2", values: { slotStart: "2026-08-11T10:00:00+08:00", slotEnd: "2026-08-11T10:30:00+08:00", availability: "full", capacity: 0 }, createdAt: "2026-08-09T08:01:00.000Z" },
    { id: "slot-3", values: { slotStart: "2026-08-12T14:00:00+08:00", slotEnd: "2026-08-12T14:30:00+08:00", availability: "available", capacity: 2 }, createdAt: "2026-08-09T08:02:00.000Z" },
  ],
  scheduleConflict: [
    { id: "conflict-1", values: { scheduleTitle: "会议室设备检查", scheduleStart: "2026-08-11T09:00:00+08:00", scheduleEnd: "2026-08-11T10:30:00+08:00", resource: "会议室 A" }, createdAt: "2026-08-09T08:00:00.000Z" },
    { id: "conflict-2", values: { scheduleTitle: "项目复盘", scheduleStart: "2026-08-11T10:00:00+08:00", scheduleEnd: "2026-08-11T11:00:00+08:00", resource: "会议室 A" }, createdAt: "2026-08-09T08:01:00.000Z" },
    { id: "conflict-3", values: { scheduleTitle: "供应商沟通", scheduleStart: "2026-08-11T10:00:00+08:00", scheduleEnd: "2026-08-11T11:00:00+08:00", resource: "会议室 B" }, createdAt: "2026-08-09T08:02:00.000Z" },
  ],
  stackFrame: [
    { id: "frame-1", values: { functionName: "submitInspection", fileName: "src/features/inspection/submit.ts", lineNumber: 84, codeContext: "82  const payload = buildPayload(form);\n83  const result = await api.submit(payload);\n84  return result.data.id;", inApp: "in_app" }, createdAt: "2026-08-09T11:20:00.000Z" },
    { id: "frame-2", values: { functionName: "request", fileName: "node_modules/axios/lib/core/Axios.js", lineNumber: 41, codeContext: "return await dispatchRequest(config);", inApp: "dependency" }, createdAt: "2026-08-09T11:20:00.000Z" },
  ],
  eventBreadcrumb: [
    { id: "crumb-1", values: { breadcrumbMessage: "打开巡检详情", breadcrumbCategory: "navigation", breadcrumbLevel: "info", breadcrumbTime: "2026-08-09 11:19:42" }, createdAt: "2026-08-09T11:19:42.000Z" },
    { id: "crumb-2", values: { breadcrumbMessage: "提交整改表单", breadcrumbCategory: "ui.click", breadcrumbLevel: "info", breadcrumbTime: "2026-08-09 11:20:03" }, createdAt: "2026-08-09T11:20:03.000Z" },
    { id: "crumb-3", values: { breadcrumbMessage: "POST /inspections 返回 500", breadcrumbCategory: "http", breadcrumbLevel: "error", breadcrumbTime: "2026-08-09 11:20:05" }, createdAt: "2026-08-09T11:20:05.000Z" },
  ],
  suspectCommit: [
    { id: "commit-1", values: { commitHash: "9fe21a0c6b42", commitAuthor: "陈晓", commitMessage: "调整巡检提交数据结构", commitTime: "2026-08-09 10:12", suspectScore: 92 }, createdAt: "2026-08-09T10:12:00.000Z" },
    { id: "commit-2", values: { commitHash: "72ca8d19e531", commitAuthor: "周宁", commitMessage: "更新错误提示文案", commitTime: "2026-08-09 09:40", suspectScore: 37 }, createdAt: "2026-08-09T09:40:00.000Z" },
  ],
  connectionEvent: [
    { id: "connection-1", values: { connectionType: "sync", connectionStatus: "succeeded", connectionTime: "2026-08-09 11:10", connectionSummary: "增量同步完成", connectionRecords: 18420 }, createdAt: "2026-08-09T11:10:00.000Z" },
    { id: "connection-2", values: { connectionType: "schema update", connectionStatus: "failed", connectionTime: "2026-08-09 10:32", connectionSummary: "目标字段类型不兼容", connectionRecords: 0 }, createdAt: "2026-08-09T10:32:00.000Z" },
    { id: "connection-3", values: { connectionType: "refresh", connectionStatus: "running", connectionTime: "2026-08-09 10:18", connectionSummary: "正在刷新历史分区", connectionRecords: 9230 }, createdAt: "2026-08-09T10:18:00.000Z" },
  ],
  schemaChange: [
    { id: "schema-1", values: { streamName: "orders", fieldName: "customer_level", changeType: "added", beforeType: "-", afterType: "string", breaking: "safe" }, createdAt: "2026-08-09T10:30:00.000Z" },
    { id: "schema-2", values: { streamName: "orders", fieldName: "amount", changeType: "type_changed", beforeType: "number", afterType: "string", breaking: "breaking" }, createdAt: "2026-08-09T10:31:00.000Z" },
  ],
  streamStatus: [
    { id: "stream-1", values: { streamName: "orders", streamStatus: "succeeded", lastSyncAt: "2026-08-09 11:10", freshness: "2 分钟", recordCount: 18420, streamError: "" }, createdAt: "2026-08-09T11:10:00.000Z" },
    { id: "stream-2", values: { streamName: "customers", streamStatus: "running", lastSyncAt: "2026-08-09 11:04", freshness: "同步中", recordCount: 6230, streamError: "" }, createdAt: "2026-08-09T11:04:00.000Z" },
    { id: "stream-3", values: { streamName: "payments", streamStatus: "failed", lastSyncAt: "2026-08-09 10:32", freshness: "40 分钟", recordCount: 0, streamError: "目标表无写入权限" }, createdAt: "2026-08-09T10:32:00.000Z" },
  ],
  connectionMapping: [
    { id: "mapping-1", values: { sourceField: "order_id", targetField: "id", transformType: "direct", mappingStatus: "valid" }, createdAt: "2026-08-09T10:20:00.000Z" },
    { id: "mapping-2", values: { sourceField: "amount_cents", targetField: "amount", transformType: "divide_100", mappingStatus: "valid" }, createdAt: "2026-08-09T10:21:00.000Z" },
    { id: "mapping-3", values: { sourceField: "legacy_status", targetField: "", transformType: "lookup", mappingStatus: "invalid" }, createdAt: "2026-08-09T10:22:00.000Z" },
  ],
  issueCommand: [
    { id: "issue-1", values: { issueTitle: "支付回调间歇性失败", issueStatus: "unresolved", issuePriority: "high", issueAssignee: "陈晓" }, createdAt: "2026-08-09T11:20:00.000Z" },
  ],
  connectionControl: [
    { id: "control-1", values: { connectionName: "订单库 → 数据仓库", connectionStatus: "active", syncStatus: "running", scheduleLabel: "每 30 分钟", hasBreakingChange: "safe" }, createdAt: "2026-08-09T11:18:00.000Z" },
  ],
  issueMetrics: [
    { id: "impact-1", values: { eventCount: 1842, userCount: 327 }, createdAt: "2026-08-09T11:20:00.000Z" },
  ],
  jobMetrics: [
    { id: "job-metric-1", values: { bytesLoaded: 187695104, recordsLoaded: 18420, recordsRejected: 23, runDuration: "4 分 18 秒", attemptsCount: 2 }, createdAt: "2026-08-09T11:10:00.000Z" },
  ],
  occurrenceEvidence: [
    { id: "evidence-1", values: { environment: "production", httpStatus: "500", failureReason: "目标表无写入权限", lastSuccessfulAt: "2026-08-09 10:32", downtime: "48 分钟" }, createdAt: "2026-08-09T11:20:00.000Z" },
  ],
  connectionRoute: [
    { id: "route-1", values: { sourceConnector: "PostgreSQL", targetConnector: "Snowflake", sourceVersion: "v3.6.1", targetVersion: "v2.9.0", routeStatus: "active" }, createdAt: "2026-08-09T11:00:00.000Z" },
  ],
  resourceSection: [
    { id: "section-status", values: { sectionTitle: "状态", sectionKey: "status", sectionAvailable: "enabled", sectionCount: 0 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "section-timeline", values: { sectionTitle: "时间线", sectionKey: "timeline", sectionAvailable: "enabled", sectionCount: 12 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "section-schema", values: { sectionTitle: "Schema", sectionKey: "schema", sectionAvailable: "disabled", sectionCount: 2 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "section-settings", values: { sectionTitle: "设置", sectionKey: "settings", sectionAvailable: "enabled", sectionCount: 0 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  inspectorMode: [
    { id: "inspect-data", values: { modeTitle: "数据", modeKey: "data", modeEnabled: "enabled", issueCount: 0 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "inspect-stats", values: { modeTitle: "统计", modeKey: "stats", modeEnabled: "enabled", issueCount: 0 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "inspect-json", values: { modeTitle: "JSON", modeKey: "json", modeEnabled: "enabled", issueCount: 0 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "inspect-error", values: { modeTitle: "错误", modeKey: "error", modeEnabled: "enabled", issueCount: 3 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "inspect-query", values: { modeTitle: "查询", modeKey: "query", modeEnabled: "disabled", issueCount: 0 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  issueEvent: [
    { id: "issue-event-1", values: { eventEnvironment: "production" }, createdAt: "2026-08-09T11:20:00.000Z" },
    { id: "issue-event-2", values: { eventEnvironment: "staging" }, createdAt: "2026-08-09T10:42:00.000Z" },
    { id: "issue-event-3", values: { eventEnvironment: "production" }, createdAt: "2026-08-09T10:18:00.000Z" },
  ],
  dirtyField: [
    { id: "dirty-1", values: { changedField: "连接名称", changeValid: "valid" }, createdAt: "2026-08-09T11:20:00.000Z" },
    { id: "dirty-2", values: { changedField: "同步频率", changeValid: "valid" }, createdAt: "2026-08-09T11:21:00.000Z" },
    { id: "dirty-3", values: { changedField: "目标命名空间", changeValid: "invalid" }, createdAt: "2026-08-09T11:22:00.000Z" },
  ],
  runningJob: [
    { id: "running-job-1", values: { jobTitle: "订单增量同步", jobStatus: "running", jobProgress: 68, jobType: "sync" }, createdAt: "2026-08-09T11:18:00.000Z" },
    { id: "running-job-2", values: { jobTitle: "历史数据刷新", jobStatus: "failed", jobProgress: 42, jobType: "refresh" }, createdAt: "2026-08-09T10:30:00.000Z" },
  ],
  bookingCommand: [
    { id: "booking-command-1", values: { bookingTitle: "专家义诊预约", bookingStatus: "PENDING", bookingStart: "2026-08-12 14:00", bookingEnd: "2026-08-12 14:30", bookingLocation: "线上诊室", bookingRecurring: "single", bookingPaid: "paid", bookingTimezone: "Asia/Shanghai", bookingAttendee: "张女士" }, createdAt: "2026-08-09T11:00:00.000Z" },
  ],
  alertRuleCommand: [
    { id: "alert-rule-command-1", values: { alertRuleTitle: "支付错误率", alertRuleState: "firing", alertRuleEditable: "editable", alertRuleProvisioned: "custom", alertRuleSilenceable: "enabled" }, createdAt: "2026-08-09T11:20:00.000Z" },
  ],
  alertInstanceMetric: [
    { id: "instance-1", values: { instanceName: "payment-api-01", alertState: "firing", ruleUid: "payment-errors", instanceValue: "8.2%", instanceLabels: "service=payment,env=prod", instanceSummary: "5 分钟错误率超过 5%", instanceStarted: "2026-08-09 11:12" }, createdAt: "2026-08-09T11:12:00.000Z" },
    { id: "instance-2", values: { instanceName: "payment-api-02", alertState: "firing", ruleUid: "payment-errors", instanceValue: "6.7%", instanceLabels: "service=payment,env=prod", instanceSummary: "错误率持续升高", instanceStarted: "2026-08-09 11:15" }, createdAt: "2026-08-09T11:15:00.000Z" },
    { id: "instance-3", values: { instanceName: "order-queue", alertState: "pending", ruleUid: "queue-depth", instanceValue: "920", instanceLabels: "queue=orders", instanceSummary: "接近积压阈值", instanceStarted: "2026-08-09 11:18" }, createdAt: "2026-08-09T11:18:00.000Z" },
  ],
  bookingCapacity: [
    { id: "capacity-1", values: { totalCapacity: 40, bookedSeats: 31, noShowCount: 2, waitlistCount: 4 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  bookingStatus: [
    { id: "booking-tab-upcoming", values: { tabTitle: "即将发生", tabKey: "upcoming", tabCount: 12, tabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "booking-tab-unconfirmed", values: { tabTitle: "待确认", tabKey: "unconfirmed", tabCount: 3, tabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "booking-tab-recurring", values: { tabTitle: "重复预约", tabKey: "recurring", tabCount: 2, tabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "booking-tab-past", values: { tabTitle: "过去", tabKey: "past", tabCount: 28, tabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "booking-tab-cancelled", values: { tabTitle: "已取消", tabKey: "cancelled", tabCount: 4, tabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  validatedFormTab: [
    { id: "form-tab-basic", values: { formTabTitle: "基础信息", formTabKey: "basic", formTabErrors: 0, formTabDirty: 2 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "form-tab-schedule", values: { formTabTitle: "排期规则", formTabKey: "schedule", formTabErrors: 2, formTabDirty: 1 }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "form-tab-notification", values: { formTabTitle: "通知", formTabKey: "notification", formTabErrors: 0, formTabDirty: 0 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  bookingFilterOption: [
    { id: "option-event-consult", values: { optionType: "事件类型", optionKey: "consult", optionTitle: "专家咨询" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "option-event-clinic", values: { optionType: "事件类型", optionKey: "clinic", optionTitle: "线上义诊" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "option-team-medical", values: { optionType: "团队", optionKey: "medical", optionTitle: "医疗服务组" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "option-user-chen", values: { optionType: "成员", optionKey: "chen", optionTitle: "陈医生" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  dashboardSave: [
    { id: "dashboard-save-1", values: { dashboardTitle: "支付服务监控", dashboardDirty: "dirty", dashboardCanSave: "allowed", dashboardManaged: "custom", dashboardTemplate: "template" }, createdAt: "2026-08-09T11:20:00.000Z" },
  ],
  workItem: [
    { id: "work-1", values: { workTitle: "完善门店巡检流程", workStatus: "in_progress", workPriority: "high", workAssignee: "陈晓", workProject: "运营平台", workCycle: "八月迭代", workDue: "2026-08-18", workLabels: "流程,巡检" }, createdAt: "2026-08-09T11:30:00.000Z" },
  ],
  document: [
    { id: "doc-1", values: { documentTitle: "门店巡检操作手册", documentState: "draft", documentPermission: "publish", documentRevision: "", documentCollection: "运营规范", documentOwner: "周宁", documentVisibility: "团队可见", documentUpdated: "2026-08-09 11:25", documentDirty: "dirty", documentLocation: "运营规范 / 门店", documentShareVisibility: "public", documentShareDomain: "docs.example.com", documentSharePermission: "share", documentShareLink: "https://docs.example.com/store-inspection" }, createdAt: "2026-08-09T11:25:00.000Z" },
  ],
  environmentStatus: [
    { id: "env-prod", values: { environmentName: "生产环境", environmentStatus: "healthy" }, createdAt: "2026-08-09T11:25:00.000Z" },
    { id: "env-stage", values: { environmentName: "预发布", environmentStatus: "warning" }, createdAt: "2026-08-09T11:24:00.000Z" },
    { id: "env-dev", values: { environmentName: "开发环境", environmentStatus: "healthy" }, createdAt: "2026-08-09T11:23:00.000Z" },
  ],
  dataFreshness: [
    { id: "freshness-1", values: { dataSourceName: "订单数仓", dataUpdatedAt: "2026-08-09 11:28", freshnessStatus: "fresh" }, createdAt: "2026-08-09T11:28:00.000Z" },
  ],
  workItemTab: [
    { id: "work-tab-overview", values: { workTabTitle: "概览", workTabKey: "overview", workTabCount: 0, workTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "work-tab-activity", values: { workTabTitle: "活动", workTabKey: "activity", workTabCount: 18, workTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "work-tab-sub", values: { workTabTitle: "子任务", workTabKey: "subtasks", workTabCount: 4, workTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  queryMode: [
    { id: "query-mode-viz", values: { queryModeTitle: "可视化", queryModeKey: "visualization", queryModeCount: 0, queryModeEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "query-mode-result", values: { queryModeTitle: "结果", queryModeKey: "results", queryModeCount: 1280, queryModeEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "query-mode-sql", values: { queryModeTitle: "SQL", queryModeKey: "sql", queryModeCount: 0, queryModeEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  workFilterOption: [
    { id: "wf-state-doing", values: { workFilterType: "状态", workFilterKey: "in_progress", workFilterTitle: "进行中" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "wf-state-done", values: { workFilterType: "状态", workFilterKey: "done", workFilterTitle: "已完成" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "wf-priority-high", values: { workFilterType: "优先级", workFilterKey: "high", workFilterTitle: "高" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "wf-owner-chen", values: { workFilterType: "负责人", workFilterKey: "chen", workFilterTitle: "陈晓" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  dashboardParameter: [
    { id: "param-region", values: { parameterTitle: "区域", parameterKey: "region", parameterValue: "华东", parameterRequired: "required" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "param-channel", values: { parameterTitle: "渠道", parameterKey: "channel", parameterValue: "全部", parameterRequired: "optional" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  cycleHealth: [
    { id: "cycle-health-1", values: { cycleCompleted: 34, cycleTotal: 52, cycleOverdue: 5, cycleUnstarted: 8 }, createdAt: "2026-08-09T11:20:00.000Z" },
  ],
  queryExecution: [
    { id: "query-execution-1", values: { queryTimeMs: 842, queryRows: 1280, queryCached: "realtime", queryBytes: 1843200 }, createdAt: "2026-08-09T11:20:00.000Z" },
  ],
  questionState: [
    { id: "question-1", values: { questionTitle: "门店履约趋势", questionSaved: "saved", questionDirty: "dirty", questionBookmarked: "bookmarked", queryStatus: "completed", queryRunnable: "runnable", queryTime: 842, queryCached: "realtime" }, createdAt: "2026-08-09T11:35:00.000Z" },
  ],
  catalogEntity: [
    { id: "catalog-1", values: { catalogTitle: "订单聚合服务", catalogKind: "Component", catalogType: "service", catalogStarred: "starred", catalogOwner: "数据平台组", catalogLifecycle: "production", catalogSystem: "交易平台", catalogDomain: "零售交易" }, createdAt: "2026-08-09T11:30:00.000Z" },
  ],
  collaborator: [
    { id: "collab-1", values: { collaboratorName: "周宁", collaboratorPresent: "present", collaboratorEditing: "editing" }, createdAt: "2026-08-09T11:36:00.000Z" },
    { id: "collab-2", values: { collaboratorName: "陈晓", collaboratorPresent: "present", collaboratorEditing: "viewing" }, createdAt: "2026-08-09T11:35:00.000Z" },
    { id: "collab-3", values: { collaboratorName: "林静", collaboratorPresent: "offline", collaboratorEditing: "viewing" }, createdAt: "2026-08-09T10:10:00.000Z" },
  ],
  querySource: [
    { id: "query-source-1", values: { sourceDatabase: "经营数仓", sourceSchema: "commerce", sourceName: "store_fulfillment_daily", sourceType: "模型" }, createdAt: "2026-08-09T11:34:00.000Z" },
  ],
  datasetEditorTab: [
    { id: "dataset-query", values: { datasetTabTitle: "查询", datasetTabKey: "query", datasetTabCount: 0, datasetTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "dataset-columns", values: { datasetTabTitle: "字段", datasetTabKey: "columns", datasetTabCount: 18, datasetTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "dataset-settings", values: { datasetTabTitle: "设置", datasetTabKey: "metadata", datasetTabCount: 0, datasetTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  documentHistoryTab: [
    { id: "history-revisions", values: { historyTabTitle: "修订", historyTabKey: "revisions", historyTabCount: 12, historyTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "history-events", values: { historyTabTitle: "事件", historyTabKey: "events", historyTabCount: 28, historyTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "history-changes", values: { historyTabTitle: "变更对照", historyTabKey: "changes", historyTabCount: 4, historyTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  catalogFilterOption: [
    { id: "catalog-kind", values: { catalogFacet: "种类", catalogFilterKey: "component", catalogFilterTitle: "Component" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "catalog-type", values: { catalogFacet: "类型", catalogFilterKey: "service", catalogFilterTitle: "服务" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "catalog-life", values: { catalogFacet: "生命周期", catalogFilterKey: "production", catalogFilterTitle: "生产" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "catalog-owner", values: { catalogFacet: "负责人", catalogFilterKey: "data-platform", catalogFilterTitle: "数据平台组" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  queryClause: [
    { id: "clause-region", values: { queryField: "区域", queryOperator: "=", queryValue: "华东", queryClauseEnabled: "enabled" }, createdAt: "2026-08-09T11:32:00.000Z" },
    { id: "clause-date", values: { queryField: "日期", queryOperator: ">=", queryValue: "2026-08-01", queryClauseEnabled: "enabled" }, createdAt: "2026-08-09T11:32:00.000Z" },
  ],
  documentInsight: [
    { id: "document-insight-1", values: { documentViews: 1842, documentContributors: 6, documentCreatedAt: "2026-07-18", documentUpdatedAt: "2026-08-09" }, createdAt: "2026-08-09T11:30:00.000Z" },
  ],
  metadataQuality: [
    { id: "metadata-quality-1", values: { metadataTotal: 24, metadataDocumented: 19, metadataTyped: 21 }, createdAt: "2026-08-09T11:30:00.000Z" },
  ],
  cycleManagement: [
    { id: "cycle-manage-1", values: { cycleTitle: "八月交付周期", cycleStatus: "active", cycleEditable: "editable", cycleOwner: "周宁", cycleMembers: "陈晓、林静", cycleDateRange: "08-01 至 08-18", cycleProgress: "34 / 52 工作项" }, createdAt: "2026-08-09T11:40:00.000Z" },
  ],
  alertGroup: [
    { id: "alert-group-1", values: { alertGroupTitle: "支付服务规则组", alertGroupStatus: "active", alertGroupEditable: "editable", alertGroupInterval: "每 1 分钟", alertGroupNamespace: "production", alertGroupRules: "12 条规则", alertGroupFiring: "3 个触发", alertGroupDatasource: "Prometheus" }, createdAt: "2026-08-09T11:40:00.000Z" },
  ],
  incidentOwnership: [
    { id: "ownership-1", values: { incidentAssignee: "陈晓", assignmentSource: "ownership_rule", suggestedOwner: "支付平台组" }, createdAt: "2026-08-09T11:39:00.000Z" },
  ],
  syncSchedule: [
    { id: "sync-schedule-1", values: { syncFrequency: "30 分钟", syncNextRun: "2026-08-09 12:00", syncTimezone: "Asia/Shanghai", syncScheduleStatus: "active" }, createdAt: "2026-08-09T11:30:00.000Z" },
  ],
  eventTypeTab: [
    { id: "event-tab-setup", values: { eventTabTitle: "设置", eventTabKey: "setup", eventTabCount: 0, eventTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "event-tab-availability", values: { eventTabTitle: "可用时间", eventTabKey: "availability", eventTabCount: 0, eventTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "event-tab-limits", values: { eventTabTitle: "限制", eventTabKey: "limits", eventTabCount: 2, eventTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "event-tab-webhooks", values: { eventTabTitle: "Webhook", eventTabKey: "webhooks", eventTabCount: 1, eventTabEnabled: "disabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  incidentEvidenceTab: [
    { id: "evidence-events", values: { evidenceTabTitle: "事件", evidenceTabKey: "events", evidenceTabCount: 1842, evidenceTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "evidence-attachments", values: { evidenceTabTitle: "附件", evidenceTabKey: "attachments", evidenceTabCount: 3, evidenceTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "evidence-replays", values: { evidenceTabTitle: "回放", evidenceTabKey: "replays", evidenceTabCount: 0, evidenceTabEnabled: "disabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  cycleFilterOption: [
    { id: "cycle-status-active", values: { cycleFilterType: "状态", cycleFilterKey: "active", cycleFilterTitle: "进行中" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "cycle-status-completed", values: { cycleFilterType: "状态", cycleFilterKey: "completed", cycleFilterTitle: "已完成" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "cycle-start-aug", values: { cycleFilterType: "开始时间", cycleFilterKey: "august", cycleFilterTitle: "八月" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  syncReliability: [
    { id: "sync-reliability-1", values: { syncSuccessRuns: 47, syncFailedRuns: 3, syncRecordCount: 18420, syncFreshness: "8 分钟" }, createdAt: "2026-08-09T11:40:00.000Z" },
  ],
  ruleEvaluation: [
    { id: "rule-evaluation-1", values: { evaluationActive: 38, evaluationPaused: 4, evaluationErrors: 2, evaluationDuration: 128 }, createdAt: "2026-08-09T11:40:00.000Z" },
  ],
  eventTypeState: [
    { id: "event-type-1", values: { eventTypeTitle: "专家义诊 30 分钟", eventTypeHidden: "hidden", eventTypeDirty: "dirty", eventTypeValid: "valid" }, createdAt: "2026-08-09T11:40:00.000Z" },
  ],
  supportConversation: [
    { id: "conv-1842", values: { contactName: "张女士", conversationStatus: "open", sessionVerified: "verified", inboxName: "微信客服", assignedAgent: "陈晓", assignedTeam: "售后服务组", conversationPriority: "urgent", conversationChannel: "wechat", contactPhone: "138****6621", conversationSnooze: "未暂停", conversationSla: "剩余 12 分钟" }, createdAt: "2026-08-09T11:48:00.000Z" },
  ],
  identityUser: [
    { id: "user-1", values: { identityUsername: "wang.xiao", identityEnabled: "enabled", impersonateAllowed: "allowed", identityEmail: "wang.xiao@example.com", identityProvider: "corporate-ldap", identityCreated: "2026-06-18", emailVerified: "verified", requiredActions: "更新密码", activeSessions: 3, manageableUser: "allowed" }, createdAt: "2026-08-09T11:45:00.000Z" },
  ],
  realmStatus: [
    { id: "realm-1", values: { realmName: "whybuddy", realmEnabled: "enabled", bruteForceProtection: "enabled", sslRequired: "external" }, createdAt: "2026-08-09T11:45:00.000Z" },
  ],
  conversationTab: [
    { id: "conv-tab-messages", values: { conversationTabTitle: "消息", conversationTabKey: "messages", conversationTabCount: 28, conversationTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "conv-tab-activity", values: { conversationTabTitle: "活动", conversationTabKey: "activity", conversationTabCount: 6, conversationTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "conv-tab-attachments", values: { conversationTabTitle: "附件", conversationTabKey: "attachments", conversationTabCount: 2, conversationTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  userSecurityTab: [
    { id: "user-tab-details", values: { securityTabTitle: "详情", securityTabKey: "settings", securityTabCount: 0, securityTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "user-tab-credentials", values: { securityTabTitle: "凭据", securityTabKey: "credentials", securityTabCount: 3, securityTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "user-tab-sessions", values: { securityTabTitle: "会话", securityTabKey: "sessions", securityTabCount: 3, securityTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "user-tab-workflows", values: { securityTabTitle: "工作流", securityTabKey: "workflows", securityTabCount: 0, securityTabEnabled: "disabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  conversationFilterOption: [
    { id: "conv-filter-open", values: { conversationFilterType: "状态", conversationFilterKey: "open", conversationFilterTitle: "待处理" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "conv-filter-snoozed", values: { conversationFilterType: "状态", conversationFilterKey: "snoozed", conversationFilterTitle: "已暂停" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "conv-filter-wechat", values: { conversationFilterType: "收件箱", conversationFilterKey: "wechat", conversationFilterTitle: "微信客服" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "conv-filter-urgent", values: { conversationFilterType: "优先级", conversationFilterKey: "urgent", conversationFilterTitle: "紧急" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  conversationSla: [
    { id: "sla-1", values: { slaFirstResponse: "4 分 12 秒", slaResolution: "1 小时 18 分", slaBreaches: 7, slaConversationCount: 286 }, createdAt: "2026-08-09T11:45:00.000Z" },
  ],
  userSessionMetric: [
    { id: "session-metric-1", values: { sessionActive: 18, sessionOffline: 4, sessionClients: 6, sessionRisk: 2 }, createdAt: "2026-08-09T11:45:00.000Z" },
  ],
  analysisWindow: [
    { id: "window-1", values: { windowTime: "08-05", observedValue: 86, expectedLow: 74, expectedHigh: 96, anomalyState: "normal", cohortName: "六月", cohortPeriod: "第 1 周", retentionRate: 82, uptimeStatus: "success", latencyP50: 82, latencyP95: 146, latencyP99: 238 }, createdAt: "2026-08-05T09:00:00.000Z" },
    { id: "window-2", values: { windowTime: "08-06", observedValue: 91, expectedLow: 76, expectedHigh: 98, anomalyState: "normal", cohortName: "六月", cohortPeriod: "第 2 周", retentionRate: 68, uptimeStatus: "success", latencyP50: 88, latencyP95: 154, latencyP99: 246 }, createdAt: "2026-08-06T09:00:00.000Z" },
    { id: "window-3", values: { windowTime: "08-07", observedValue: 128, expectedLow: 78, expectedHigh: 101, anomalyState: "anomaly", cohortName: "七月", cohortPeriod: "第 1 周", retentionRate: 77, uptimeStatus: "failed", latencyP50: 96, latencyP95: 186, latencyP99: 318 }, createdAt: "2026-08-07T09:00:00.000Z" },
    { id: "window-4", values: { windowTime: "08-08", observedValue: null, expectedLow: 79, expectedHigh: 103, anomalyState: "normal", cohortName: "七月", cohortPeriod: "第 2 周", retentionRate: 61, uptimeStatus: "unknown", latencyP50: null, latencyP95: null, latencyP99: null }, createdAt: "2026-08-08T09:00:00.000Z" },
    { id: "window-5", values: { windowTime: "08-09", observedValue: 94, expectedLow: 80, expectedHigh: 104, anomalyState: "normal", cohortName: "八月", cohortPeriod: "第 1 周", retentionRate: 73, uptimeStatus: "running", latencyP50: 90, latencyP95: 162, latencyP99: 255 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  operationsTab: [
    { id: "ops-overview", values: { operationsTabTitle: "概览", operationsTabKey: "overview", operationsTabCount: 0, operationsTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "ops-streams", values: { operationsTabTitle: "数据流", operationsTabKey: "streams", operationsTabCount: 18, operationsTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "ops-jobs", values: { operationsTabTitle: "作业", operationsTabKey: "jobs", operationsTabCount: 4, operationsTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "ops-replay", values: { operationsTabTitle: "回放", operationsTabKey: "replay", operationsTabCount: 0, operationsTabEnabled: "disabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  connectionFleet: [
    ...["healthy", "healthy", "healthy", "running", "queued", "failed", "paused", "notSynced"].map((status, index) => ({ id: `fleet-${index}`, values: { fleetStatus: status }, createdAt: "2026-08-09T09:00:00.000Z" })),
  ],
  issueImpact: [
    { id: "impact-1", values: { impactEvents: 1284, impactUsers: 326, impactFirstSeen: "08-01 09:42", impactLastSeen: "刚刚" }, createdAt: "2026-08-09T11:56:00.000Z" },
  ],
  serviceContext: [
    { id: "service-order", values: { serviceTitle: "订单服务", serviceOwner: "交易平台组", serviceSystem: "零售中台", serviceLifecycle: "production", querySource: "经营数据仓", queryFilters: "华东 · 近 30 天", queryCache: "实时" }, createdAt: "2026-08-09T11:45:00.000Z" },
  ],
  releaseHealth: [
    { id: "release-20260810", values: { releaseVersion: "2026.08.10", releaseCrashFree: 99.72, releaseEnvironment: "production", releaseAdoption: 64 }, createdAt: "2026-08-10T00:20:00.000Z" },
  ],
  dashboardContext: [
    { id: "dashboard-sales", values: { dashboardTitle: "经营数据总览", dashboardStarred: "starred", dashboardSubscribed: "subscribed", dashboardEditable: "editable" }, createdAt: "2026-08-10T00:20:00.000Z" },
  ],
  deploymentSeries: [
    { id: "deploy-run-1", values: { deployTime: "08-06", queueSeconds: 8, pullSeconds: 22, startSeconds: 15, readySeconds: 46 }, createdAt: "2026-08-06T10:00:00.000Z" },
    { id: "deploy-run-2", values: { deployTime: "08-07", queueSeconds: 11, pullSeconds: 28, startSeconds: 17, readySeconds: 52 }, createdAt: "2026-08-07T10:00:00.000Z" },
    { id: "deploy-run-3", values: { deployTime: "08-08", queueSeconds: 6, pullSeconds: null, startSeconds: null, readySeconds: null }, createdAt: "2026-08-08T10:00:00.000Z" },
    { id: "deploy-run-4", values: { deployTime: "08-09", queueSeconds: 9, pullSeconds: 19, startSeconds: 13, readySeconds: 41 }, createdAt: "2026-08-09T10:00:00.000Z" },
  ],
  releaseSeries: [
    { id: "release-point-1", values: { releaseTime: "08-06", releaseAdoptionTrend: 18, releaseHealthTrend: 99.8 }, createdAt: "2026-08-06T10:00:00.000Z" },
    { id: "release-point-2", values: { releaseTime: "08-07", releaseAdoptionTrend: 37, releaseHealthTrend: 99.6 }, createdAt: "2026-08-07T10:00:00.000Z" },
    { id: "release-point-3", values: { releaseTime: "08-08", releaseAdoptionTrend: 64, releaseHealthTrend: 99.3 }, createdAt: "2026-08-08T10:00:00.000Z" },
    { id: "release-point-4", values: { releaseTime: "08-09", releaseAdoptionTrend: 86, releaseHealthTrend: 99.5 }, createdAt: "2026-08-09T10:00:00.000Z" },
  ],
  deploymentTab: [
    { id: "deployment-summary", values: { deploymentTabTitle: "摘要", deploymentTabKey: "summary", deploymentTabCount: 0, deploymentTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "deployment-pods", values: { deploymentTabTitle: "Pod", deploymentTabKey: "pods", deploymentTabCount: 6, deploymentTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "deployment-events", values: { deploymentTabTitle: "事件", deploymentTabKey: "events", deploymentTabCount: 3, deploymentTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "deployment-logs", values: { deploymentTabTitle: "日志", deploymentTabKey: "logs", deploymentTabCount: 0, deploymentTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  releaseTab: [
    { id: "release-overview", values: { releaseTabTitle: "概览", releaseTabKey: "overview", releaseTabCount: 0, releaseTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "release-errors", values: { releaseTabTitle: "错误", releaseTabKey: "errors", releaseTabCount: 14, releaseTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "release-users", values: { releaseTabTitle: "用户", releaseTabKey: "users", releaseTabCount: 326, releaseTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  deploymentWorkload: [
    { id: "deployment-order-api", values: { workloadTitle: "order-api", workloadStatus: "healthy", workloadEditable: "editable", desiredReplicas: 6, readyReplicas: 5, availableReplicas: 5, unavailableReplicas: 1, workloadNamespace: "commerce", workloadCluster: "prod-cn", workloadImage: "order-api:2026.08.10", workloadStrategy: "RollingUpdate", workloadUpdated: "2 分钟前" }, createdAt: "2026-08-10T00:22:00.000Z" },
  ],
  clusterHealth: [
    { id: "cluster-prod", values: { clusterName: "prod-cn", clusterStatus: "healthy", clusterNodes: 12, clusterVersion: "v1.31" }, createdAt: "2026-08-10T00:22:00.000Z" },
    { id: "cluster-staging", values: { clusterName: "staging", clusterStatus: "warning", clusterNodes: 4, clusterVersion: "v1.30" }, createdAt: "2026-08-10T00:22:00.000Z" },
  ],
  releaseState: [
    { id: "release-main", values: { releaseTitle: "2026.08.10", releaseProject: "whybuddy-web", releaseEnvironment: "production", releaseCommit: "77f469a", releaseAuthor: "发布机器人", releaseStatus: "active", releaseAdoption: 86, releaseHealth: 99.5, releaseEvents: 1284, releaseUsers: 326 }, createdAt: "2026-08-10T00:22:00.000Z" },
    { id: "release-staging", values: { releaseTitle: "2026.08.10-rc.2", releaseProject: "whybuddy-web", releaseEnvironment: "staging", releaseCommit: "a42de19", releaseAuthor: "陈晓", releaseStatus: "healthy", releaseAdoption: 100, releaseHealth: 99.9, releaseEvents: 18, releaseUsers: 9 }, createdAt: "2026-08-09T20:22:00.000Z" },
  ],
  featureFlag: [
    { id: "flag-new-checkout", values: { flagTitle: "new-checkout-flow", flagEnabled: "enabled", flagRollout: 25, flagEditable: "editable" }, createdAt: "2026-08-10T00:22:00.000Z" },
  ],
  runtimeFilterOption: [
    { id: "runtime-cluster", values: { runtimeFacet: "集群", runtimeKey: "prod-cn", runtimeTitle: "prod-cn" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "runtime-namespace", values: { runtimeFacet: "命名空间", runtimeKey: "commerce", runtimeTitle: "commerce" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "runtime-kind", values: { runtimeFacet: "资源类型", runtimeKey: "deployment", runtimeTitle: "Deployment" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "release-env-prod", values: { runtimeFacet: "环境", runtimeKey: "production", runtimeTitle: "production" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "release-health-good", values: { runtimeFacet: "健康状态", runtimeKey: "healthy", runtimeTitle: "健康" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  flowSnapshot: [
    ...[["08-06", "待处理", 18], ["08-06", "进行中", 9], ["08-06", "已完成", 24], ["08-07", "待处理", 16], ["08-07", "进行中", 11], ["08-07", "已完成", 29], ["08-08", "待处理", 14], ["08-08", "进行中", 8], ["08-08", "已完成", 36], ["08-09", "待处理", 12], ["08-09", "进行中", 7], ["08-09", "已完成", 43]].map(([time, state, count], index) => ({ id: `flow-${index}`, values: { flowTime: time, flowState: state, flowCount: count }, createdAt: "2026-08-09T09:00:00.000Z" })),
  ],
  bookingDemand: [
    { id: "demand-1", values: { demandTime: "周一", availableSlots: 42, bookedSlots: 31, canceledSlots: 3 }, createdAt: "2026-08-04T09:00:00.000Z" },
    { id: "demand-2", values: { demandTime: "周二", availableSlots: 38, bookedSlots: 34, canceledSlots: 2 }, createdAt: "2026-08-05T09:00:00.000Z" },
    { id: "demand-3", values: { demandTime: "周三", availableSlots: 46, bookedSlots: 37, canceledSlots: 4 }, createdAt: "2026-08-06T09:00:00.000Z" },
    { id: "demand-4", values: { demandTime: "周四", availableSlots: 40, bookedSlots: 28, canceledSlots: 1 }, createdAt: "2026-08-07T09:00:00.000Z" },
  ],
  activityTab: [
    { id: "activity-detail", values: { activityTabTitle: "详情", activityTabKey: "detail", activityTabCount: 0, activityTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "activity-child", values: { activityTabTitle: "子项", activityTabKey: "children", activityTabCount: 4, activityTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "activity-log", values: { activityTabTitle: "活动", activityTabKey: "activity", activityTabCount: 12, activityTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  bookingAuditTab: [
    { id: "audit-detail", values: { auditTabTitle: "详情", auditTabKey: "detail", auditTabCount: 0, auditTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "audit-attendee", values: { auditTabTitle: "参与人", auditTabKey: "attendees", auditTabCount: 3, auditTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "audit-payment", values: { auditTabTitle: "付款", auditTabKey: "payment", auditTabCount: 1, auditTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  throughputMetric: [
    { id: "throughput-1", values: { throughputCompleted: 43, throughputEntered: 51, throughputWip: 7, throughputBlocked: 2 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  utilizationMetric: [
    { id: "utilization-1", values: { utilizationAvailable: 2400, utilizationBooked: 1870, utilizationCanceled: 14, utilizationNoShow: 6 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  cycleRisk: [
    { id: "cycle-risk-1", values: { riskTitle: "八月交付周期", riskRemaining: 6, riskBlocked: 2, riskOverdue: 1 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  calendarConnection: [
    { id: "calendar-google", values: { calendarAccount: "ops@example.com", calendarStatus: "synced", calendarProvider: "Google", calendarSyncedAt: "2 分钟前" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "calendar-outlook", values: { calendarAccount: "sales@example.com", calendarStatus: "failed", calendarProvider: "Outlook", calendarSyncedAt: "1 小时前" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  movableWorkItem: [
    { id: "move-item-1", values: { moveTitle: "完善结算错误提示", moveGroup: "当前周期" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "move-group-2", values: { moveTitle: "候选", moveGroup: "下个周期" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "move-group-3", values: { moveTitle: "候选", moveGroup: "需求池" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  bookingConflict: [
    { id: "conflict-1", values: { conflictTitle: "专家门诊", conflictStart: "08-12 10:00", conflictEnd: "08-12 10:30", conflictSeverity: "high" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "conflict-2", values: { conflictTitle: "内部周会", conflictStart: "08-12 10:15", conflictEnd: "08-12 11:00", conflictSeverity: "medium" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  workflowDuration: [
    { id: "wf-duration-1", values: { workflowTime: "08-06", workflowAverage: 820, workflowP95: 1460, workflowFailedDuration: 2180 }, createdAt: "2026-08-06T09:00:00.000Z" },
    { id: "wf-duration-2", values: { workflowTime: "08-07", workflowAverage: 760, workflowP95: 1320, workflowFailedDuration: null }, createdAt: "2026-08-07T09:00:00.000Z" },
    { id: "wf-duration-3", values: { workflowTime: "08-08", workflowAverage: 910, workflowP95: 1710, workflowFailedDuration: 2640 }, createdAt: "2026-08-08T09:00:00.000Z" },
    { id: "wf-duration-4", values: { workflowTime: "08-09", workflowAverage: 690, workflowP95: 1180, workflowFailedDuration: null }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  workflowTab: [
    { id: "workflow-summary", values: { workflowTabTitle: "概要", workflowTabKey: "summary", workflowTabCount: 0, workflowTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "workflow-nodes", values: { workflowTabTitle: "节点", workflowTabKey: "nodes", workflowTabCount: 8, workflowTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "workflow-logs", values: { workflowTabTitle: "日志", workflowTabKey: "logs", workflowTabCount: 26, workflowTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  workflowOutcome: [
    { id: "workflow-outcome-1", values: { outcomeSuccess: 184, outcomeFailed: 7, outcomeRunning: 3, outcomePending: 11 }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  workflowDefinition: [
    { id: "workflow-order", values: { workflowTitle: "订单异常处理", workflowName: "订单异常处理", workflowEnabled: "enabled", workflowVersion: "v12", workflowEditable: "editable", workflowUpdated: "8 分钟前", workflowTrigger: "订单创建", workflowOwner: "交易平台组", workflowMode: "并行", workflowTimeout: "15 分钟" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  workflowFailure: [
    { id: "execution-failed-1", values: { failureNode: "发送库存通知", failureMessage: "Webhook 返回 502", failureStatus: "failed", failureTime: "08-09 11:42" }, createdAt: "2026-08-09T11:42:00.000Z" },
    { id: "execution-success-1", values: { failureNode: "写入审计", failureMessage: "完成", failureStatus: "resolved", failureTime: "08-09 11:38" }, createdAt: "2026-08-09T11:38:00.000Z" },
  ],
  workflowFilterOption: [
    { id: "wf-filter-running", values: { workflowFacet: "状态", workflowFilterKey: "started", workflowFilterTitle: "运行中" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "wf-filter-failed", values: { workflowFacet: "状态", workflowFilterKey: "failed", workflowFilterTitle: "失败" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "wf-filter-manual", values: { workflowFacet: "触发器", workflowFilterKey: "manual", workflowFilterTitle: "手动" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  workflowExecution: [
    { id: "execution-running-1", values: { executionStatus: "started", executionProgress: 62 }, createdAt: "2026-08-09T11:42:00.000Z" },
  ],
  realmSecurity: [
    { id: "realm-security-1", values: { realmSecurityTitle: "whybuddy", realmSecurityName: "whybuddy", realmSecurityEnabled: "enabled", realmManageable: "allowed", realmSsl: "external", realmBruteForce: "enabled", realmSessionTimeout: "30 分钟", realmTokenLifespan: "5 分钟" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  userEventOption: [
    { id: "event-login", values: { userEventFacet: "事件类型", userEventKey: "LOGIN", userEventTitle: "登录" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "event-client", values: { userEventFacet: "客户端", userEventKey: "whybuddy-web", userEventTitle: "whybuddy-web" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "event-ip", values: { userEventFacet: "IP", userEventKey: "192.168.0.10", userEventTitle: "192.168.0.10" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  credentialState: [
    { id: "credential-user-1", values: { credentialUsername: "wang.xiao", credentialResettable: "allowed", credentialTemporary: "temporary", credentialUpdated: "2026-08-01" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  observabilityTrend: [
    { id: "obs-1", values: { obsTime: "08-06", queryAverage: 180, queryP95: 420, queryTimeout: 2, syncRecords: 12400, syncBytes: 840, syncFailed: 18 }, createdAt: "2026-08-06T09:00:00.000Z" },
    { id: "obs-2", values: { obsTime: "08-07", queryAverage: 165, queryP95: 380, queryTimeout: 1, syncRecords: 14200, syncBytes: 920, syncFailed: 9 }, createdAt: "2026-08-07T09:00:00.000Z" },
    { id: "obs-3", values: { obsTime: "08-08", queryAverage: 240, queryP95: 610, queryTimeout: 6, syncRecords: 11800, syncBytes: 790, syncFailed: 37 }, createdAt: "2026-08-08T09:00:00.000Z" },
  ],
  inspectorTab: [
    { id: "inspect-data", values: { inspectTitle: "数据", inspectKey: "data", inspectCount: 0, inspectEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "inspect-stats", values: { inspectTitle: "统计", inspectKey: "stats", inspectCount: 8, inspectEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "inspect-error", values: { inspectTitle: "错误", inspectKey: "error", inspectCount: 1, inspectEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  streamTab: [
    { id: "stream-overview", values: { streamTabTitle: "概览", streamTabKey: "overview", streamTabCount: 0, streamTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "stream-fields", values: { streamTabTitle: "字段", streamTabKey: "fields", streamTabCount: 24, streamTabEnabled: "enabled" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  queryMetric: [{ id: "query-metric-1", values: { queryRequests: 1280, queryErrors: 18, queryCacheHits: 842, queryDuration: 186 }, createdAt: "2026-08-09T09:00:00.000Z" }],
  streamMetric: [{ id: "stream-metric-1", values: { streamLag: 8, streamSyncedAt: "2 分钟前", streamRecords: 18420, streamFailed: 12 }, createdAt: "2026-08-09T09:00:00.000Z" }],
  datasourceState: [{ id: "datasource-prom", values: { datasourceName: "Prometheus", datasourceStatus: "healthy", datasourceType: "Prometheus", datasourceChecked: "刚刚" }, createdAt: "2026-08-09T09:00:00.000Z" }],
  connectorState: [{ id: "connector-postgres", values: { connectorName: "Postgres Source", connectorStatus: "upgrading", connectorVersion: "3.2.1", connectorAvailable: "3.3.0" }, createdAt: "2026-08-09T09:00:00.000Z" }],
  panelState: [{ id: "panel-latency", values: { panelTitle: "接口延迟", panelDatasource: "Mimir", panelEditable: "editable" }, createdAt: "2026-08-09T09:00:00.000Z" }],
  schemaState: [{ id: "schema-orders", values: { schemaTitle: "订单同步 Schema", schemaStatus: "breaking", schemaRefreshing: "idle", schemaDirty: "dirty", schemaConnection: "Postgres → BigQuery", schemaNamespace: "commerce", schemaSelected: 18, schemaFields: 126, schemaQuery: "select * from orders" }, createdAt: "2026-08-09T09:00:00.000Z" }],
  exploreState: [{ id: "explore-a", values: { exploreTitle: "订单延迟查询", exploreDatasource: "Mimir", exploreLanguage: "PromQL", exploreRange: "最近 6 小时", exploreStep: "30s", exploreStatus: "idle", exploreQuery: "histogram_quantile(0.95, rate(http_duration_bucket[5m]))" }, createdAt: "2026-08-09T09:00:00.000Z" }],
  observabilityFilter: [
    { id: "label-service", values: { obsFacet: "service", obsKey: "checkout", obsTitle: "checkout" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "label-env", values: { obsFacet: "environment", obsKey: "production", obsTitle: "production" }, createdAt: "2026-08-09T09:00:00.000Z" },
    { id: "stream-ns", values: { obsFacet: "命名空间", obsKey: "commerce", obsTitle: "commerce" }, createdAt: "2026-08-09T09:00:00.000Z" },
  ],
  queryError: [{ id: "query-A", values: { queryRef: "A", queryMessage: "context deadline exceeded", queryStatus: "timeout", queryRequest: "POST /api/ds/query" }, createdAt: "2026-08-09T09:00:00.000Z" }],
  schemaConflict: [{ id: "schema-conflict-1", values: { conflictStream: "orders", conflictField: "customer_id", conflictChange: "breaking", conflictBreaking: "breaking" }, createdAt: "2026-08-09T09:00:00.000Z" }],
  order: [
    { name: "人民路店", amount: 428, status: "done", channel: "线上", at: "2026-08-06",
      contact: "renmin@example.com", detailUrl: "https://example.com/store/1",
      cover: "/brand/miantuan-mark.png", weekDelta: 12.4, urgent: true, owner_id: "u-1",
      fulfillRate: 92, healthScore: 88, starLevel: 5,
      remark: "客户要求当日达，已与配送确认时间窗；如遇雨天顺延至次日上午，需提前电话告知。" },
    { name: "高新店", amount: 366, status: "doing", channel: "门店", at: "2026-08-05",
      contact: "gaoxin@example.com", detailUrl: "https://example.com/store/2",
      cover: "/assets/sliderule-mark.svg", weekDelta: -3.1, urgent: false, owner_id: "u-2",
      fulfillRate: 74, healthScore: 63, starLevel: 4, remark: "常规" },
    { name: "南湖店", amount: 291, status: "done", channel: "线上", at: "2026-08-05",
      contact: "nanhu@example.com", detailUrl: "https://example.com/store/3",
      cover: "/brand/logo.png", weekDelta: 8.7, urgent: false, owner_id: "u-1",
      fulfillRate: 88, healthScore: 81, starLevel: 4, remark: "常规" },
    { name: "城东店", amount: 244, status: "todo", channel: "电话", at: "2026-08-04",
      contact: "chengdong@example.com", detailUrl: "https://example.com/store/4",
      cover: "/assets/sliderule_icon_flat_transparent.png", weekDelta: 0, urgent: true, owner_id: "u-3",
      fulfillRate: 31, healthScore: 42, starLevel: 2, remark: "待确认收货地址" },
    { name: "西溪店", amount: 187, status: "doing", channel: "门店", at: "2026-08-03",
      contact: "xixi@example.com", detailUrl: "https://example.com/store/5",
      cover: "/brand/transLogo.png", weekDelta: -15.2, urgent: false, owner_id: "u-2",
      fulfillRate: 56, healthScore: 55, starLevel: 3, remark: "常规" },
    { name: "湖畔店", amount: 132, status: "done", channel: "线上", at: "2026-08-02",
      contact: "hupan@example.com", detailUrl: "https://example.com/store/6",
      cover: "/assets/sliderule_icon_card_transparent.png", weekDelta: 5.5, urgent: false, owner_id: "u-3",
      fulfillRate: 100, healthScore: 95, starLevel: 5, remark: "常规" },
  ].map((values, i) => ({
    id: `order-${i + 1}`,
    values,
    createdAt: `2026-08-0${(i % 7) + 1}T09:00:00.000Z`,
  })),
  signingRecipient: [
    { id: "recipient-1", values: { signerName: "林雪", signerRole: "甲方", signerStatus: "待放置" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "recipient-2", values: { signerName: "周宁", signerRole: "乙方", signerStatus: "待确认" }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "recipient-3", values: { signerName: "王晨", signerRole: "见证人", signerStatus: "已配置" }, createdAt: "2026-08-11T09:02:00.000Z" },
  ],
  alertGroupDemo: [
    { id: "group-alert-1", values: { alertName: "支付接口错误率升高", alertGroup: "支付服务", alertStatus: "firing", alertSeverity: "critical" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "group-alert-2", values: { alertName: "支付回调积压", alertGroup: "支付服务", alertStatus: "pending", alertSeverity: "warning" }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "group-alert-3", values: { alertName: "库存同步延迟", alertGroup: "库存任务", alertStatus: "firing", alertSeverity: "warning" }, createdAt: "2026-08-11T09:02:00.000Z" },
  ],
  evidenceRequirement: [
    { id: "evidence-req-1", values: { evidenceName: "现场全景照片", evidenceRequired: "true", evidenceStatus: "accepted" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "evidence-req-2", values: { evidenceName: "整改前后对比", evidenceRequired: "true", evidenceStatus: "missing" }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "evidence-req-3", values: { evidenceName: "负责人签字", evidenceRequired: "false", evidenceStatus: "uploaded" }, createdAt: "2026-08-11T09:02:00.000Z" },
  ],
  mediaAssetDemo: [
    { id: "asset-demo-1", values: { assetName: "门店正面", assetUrl: "/brand/logo.png", assetType: "照片", assetCreated: "2026-08-10" }, createdAt: "2026-08-10T09:00:00.000Z" },
    { id: "asset-demo-2", values: { assetName: "消防通道", assetUrl: "/brand/miantuan-mark.png", assetType: "照片", assetCreated: "2026-08-10" }, createdAt: "2026-08-10T09:01:00.000Z" },
    { id: "asset-demo-3", values: { assetName: "巡检标记", assetUrl: "/assets/sliderule-mark.svg", assetType: "图形", assetCreated: "2026-08-11" }, createdAt: "2026-08-11T09:02:00.000Z" },
  ],
  unpaidInvoiceDemo: [
    { id: "invoice-demo-1", values: { invoiceTitle: "INV-2026-0811", invoiceDue: 3200 }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "invoice-demo-2", values: { invoiceTitle: "INV-2026-0812", invoiceDue: 4800 }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "invoice-demo-3", values: { invoiceTitle: "INV-2026-0813", invoiceDue: 2100 }, createdAt: "2026-08-11T09:02:00.000Z" },
  ],
  rolloutStageDemo: [
    { id: "rollout-demo-1", values: { stageName: "开发环境", stageStatus: "complete", stageHealth: "healthy" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "rollout-demo-2", values: { stageName: "预发布环境", stageStatus: "failed", stageHealth: "degraded" }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "rollout-demo-3", values: { stageName: "生产环境", stageStatus: "waiting", stageHealth: "unknown" }, createdAt: "2026-08-11T09:02:00.000Z" },
  ],
  workflowNodeDebugDemo: [
    { id: "workflow-node-1", values: { nodeTitle: "接收订单", nodeStatus: "complete", nodeParent: "", nodeMessage: "已接收 86 条订单" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "workflow-node-2", values: { nodeTitle: "库存校验", nodeStatus: "failed", nodeParent: "workflow-node-1", nodeMessage: "华东仓库存快照超时" }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "workflow-node-3", values: { nodeTitle: "创建履约单", nodeStatus: "waiting", nodeParent: "workflow-node-2", nodeMessage: "等待上游节点" }, createdAt: "2026-08-11T09:02:00.000Z" },
  ],
  queryNotebookDemo: [
    { id: "query-cell-1", values: { queryTitle: "近七日订单", queryText: "SELECT day, COUNT(*) AS orders\nFROM orders\nWHERE created_at >= CURRENT_DATE - INTERVAL '7 day'\nGROUP BY day;", queryStatus: "success", resultCount: 7 }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "query-cell-2", values: { queryTitle: "异常支付", queryText: "SELECT channel, COUNT(*) AS failures\nFROM payments\nWHERE status = 'failed'\nGROUP BY channel;", queryStatus: "draft", resultCount: 0 }, createdAt: "2026-08-11T09:01:00.000Z" },
  ],
  warehouseBinDemo: [
    { id: "bin-a-01", values: { binName: "A-01", aisleName: "A 巷道", binUsed: 92, binCapacity: 100 }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "bin-a-02", values: { binName: "A-02", aisleName: "A 巷道", binUsed: 48, binCapacity: 100 }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "bin-b-01", values: { binName: "B-01", aisleName: "B 巷道", binUsed: 76, binCapacity: 120 }, createdAt: "2026-08-11T09:02:00.000Z" },
    { id: "bin-b-02", values: { binName: "B-02", aisleName: "B 巷道", binUsed: 0, binCapacity: 0 }, createdAt: "2026-08-11T09:03:00.000Z" },
  ],
  experimentVariantDemo: [
    { id: "variant-control", values: { variantName: "基准版本", trafficWeight: 45 }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "variant-search", values: { variantName: "搜索优先", trafficWeight: 35 }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "variant-recommend", values: { variantName: "推荐优先", trafficWeight: 10 }, createdAt: "2026-08-11T09:02:00.000Z" },
  ],
  slaTicketDemo: [
    { id: "ticket-sla-1", values: { ticketTitle: "VIP 退款失败", slaDeadline: "2026-08-11T12:00:00+08:00", ticketStatus: "等待响应", slaOwner: "许宁" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "ticket-sla-2", values: { ticketTitle: "批量导入异常", slaDeadline: "2026-08-12T15:30:00+08:00", ticketStatus: "处理中", slaOwner: "宋佳" }, createdAt: "2026-08-11T09:01:00.000Z" },
  ],
  warehousePickDemo: [
    { id: "pick-line-1", values: { pickTitle: "无线扫码枪 × 2", pickBin: "A-01", expectedScanCode: "SKU-SCAN-001", pickedQuantity: 0 }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "pick-line-2", values: { pickTitle: "热敏标签纸 × 4", pickBin: "B-03", expectedScanCode: "SKU-LABEL-004", pickedQuantity: 1 }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "pick-line-3", values: { pickTitle: "包装箱 × 1", pickBin: "C-02", expectedScanCode: "SKU-BOX-001", pickedQuantity: 0 }, createdAt: "2026-08-11T09:02:00.000Z" },
  ],
  uploadQueueDemo: [
    { id: "upload-1", values: { transferFileName: "门店巡检视频.mp4", transferFileSize: 84.6, transferStatus: "uploading", transferProgress: 68 }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "upload-2", values: { transferFileName: "销售明细-8月.xlsx", transferFileSize: 12.3, transferStatus: "paused", transferProgress: 42 }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "upload-3", values: { transferFileName: "商品主图.zip", transferFileSize: 36.8, transferStatus: "failed", transferProgress: 23 }, createdAt: "2026-08-11T09:02:00.000Z" },
    { id: "upload-4", values: { transferFileName: "交付清单.pdf", transferFileSize: 2.1, transferStatus: "complete", transferProgress: 100 }, createdAt: "2026-08-11T09:03:00.000Z" },
  ],
  traceSpanDemo: [
    { id: "span-root", values: { spanName: "POST /checkout", spanParent: "", spanStart: 0, spanDuration: 920, spanStatus: "ok" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "span-auth", values: { spanName: "auth.verify", spanParent: "span-root", spanStart: 28, spanDuration: 116, spanStatus: "ok" }, createdAt: "2026-08-11T09:00:00.100Z" },
    { id: "span-stock", values: { spanName: "inventory.reserve", spanParent: "span-root", spanStart: 168, spanDuration: 486, spanStatus: "error" }, createdAt: "2026-08-11T09:00:00.200Z" },
    { id: "span-db", values: { spanName: "postgres.query", spanParent: "span-stock", spanStart: 214, spanDuration: 392, spanStatus: "error" }, createdAt: "2026-08-11T09:00:00.300Z" },
    { id: "span-payment", values: { spanName: "payment.authorize", spanParent: "span-root", spanStart: 670, spanDuration: 204, spanStatus: "ok" }, createdAt: "2026-08-11T09:00:00.400Z" },
  ],
  expressionInputDemo: [
    { id: "input-customer", values: { dataPath: "customer.name", sampleValue: "林雪", dataType: "string" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "input-total", values: { dataPath: "order.total", sampleValue: "428.00", dataType: "number" }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "input-channel", values: { dataPath: "order.channel", sampleValue: "小程序", dataType: "string" }, createdAt: "2026-08-11T09:02:00.000Z" },
    { id: "input-paid", values: { dataPath: "payment.paid", sampleValue: "true", dataType: "boolean" }, createdAt: "2026-08-11T09:03:00.000Z" },
  ],
  replayEventDemo: [
    { id: "replay-1", values: { replayOffset: 0, replayType: "navigation", replaySummary: "进入结算页", replaySeverity: "info" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "replay-2", values: { replayOffset: 1800, replayType: "click", replaySummary: "点击提交订单", replaySeverity: "info" }, createdAt: "2026-08-11T09:00:01.800Z" },
    { id: "replay-3", values: { replayOffset: 3200, replayType: "request", replaySummary: "库存预占请求超时", replaySeverity: "error" }, createdAt: "2026-08-11T09:00:03.200Z" },
    { id: "replay-4", values: { replayOffset: 5100, replayType: "click", replaySummary: "用户点击重试", replaySeverity: "warning" }, createdAt: "2026-08-11T09:00:05.100Z" },
    { id: "replay-5", values: { replayOffset: 7600, replayType: "navigation", replaySummary: "进入订单详情", replaySeverity: "info" }, createdAt: "2026-08-11T09:00:07.600Z" },
  ],
  dashboardPanelDemo: [
    { id: "panel-sales", values: { panelTitle: "销售趋势", gridX: 0, gridY: 0, gridWidth: 6, gridHeight: 2 }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "panel-orders", values: { panelTitle: "订单状态", gridX: 6, gridY: 0, gridWidth: 6, gridHeight: 2 }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "panel-alert", values: { panelTitle: "异常告警", gridX: 0, gridY: 2, gridWidth: 4, gridHeight: 1 }, createdAt: "2026-08-11T09:02:00.000Z" },
    { id: "panel-rank", values: { panelTitle: "门店排行", gridX: 4, gridY: 2, gridWidth: 8, gridHeight: 1 }, createdAt: "2026-08-11T09:03:00.000Z" },
  ],
  liveLogDemo: [
    { id: "log-1", values: { logTime: "10:24:01", logLevel: "info", logMessage: "checkout request accepted order=WB-2048", logStream: "checkout-api" }, createdAt: "2026-08-11T10:24:01.000Z" },
    { id: "log-2", values: { logTime: "10:24:02", logLevel: "info", logMessage: "inventory reservation started warehouse=HZ-01", logStream: "inventory-worker" }, createdAt: "2026-08-11T10:24:02.000Z" },
    { id: "log-3", values: { logTime: "10:24:04", logLevel: "warn", logMessage: "reservation latency exceeded 1500ms", logStream: "inventory-worker" }, createdAt: "2026-08-11T10:24:04.000Z" },
    { id: "log-4", values: { logTime: "10:24:06", logLevel: "error", logMessage: "reservation failed: upstream timeout", logStream: "inventory-worker" }, createdAt: "2026-08-11T10:24:06.000Z" },
    { id: "log-5", values: { logTime: "10:24:07", logLevel: "info", logMessage: "retry scheduled attempt=2", logStream: "checkout-api" }, createdAt: "2026-08-11T10:24:07.000Z" },
  ],
  flameProfileDemo: [
    { id: "flame-root", values: { functionName: "checkout", profileParent: "", profileDepth: 0, totalSamples: 1000, selfSamples: 40 }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "flame-auth", values: { functionName: "authenticate", profileParent: "flame-root", profileDepth: 1, totalSamples: 240, selfSamples: 72 }, createdAt: "2026-08-11T09:00:01.000Z" },
    { id: "flame-order", values: { functionName: "createOrder", profileParent: "flame-root", profileDepth: 1, totalSamples: 760, selfSamples: 85 }, createdAt: "2026-08-11T09:00:02.000Z" },
    { id: "flame-stock", values: { functionName: "reserveStock", profileParent: "flame-order", profileDepth: 2, totalSamples: 470, selfSamples: 128 }, createdAt: "2026-08-11T09:00:03.000Z" },
    { id: "flame-payment", values: { functionName: "authorizePayment", profileParent: "flame-order", profileDepth: 2, totalSamples: 290, selfSamples: 96 }, createdAt: "2026-08-11T09:00:04.000Z" },
  ],
  mergeConflictDemo: [
    { id: "conflict-1", values: { conflictPath: "src/checkout.ts · 第 42 行", baseContent: "const timeout = 3000;", oursContent: "const timeout = 5000;", theirsContent: "const timeout = 8000;" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "conflict-2", values: { conflictPath: "src/inventory.ts · 第 18 行", baseContent: "retry: 1", oursContent: "retry: 2", theirsContent: "retry: 3" }, createdAt: "2026-08-11T09:01:00.000Z" },
  ],
  policyDecisionDemo: [
    { id: "policy-1", values: { policyName: "订单读取角色", policyEffect: "allow", policyReason: "用户拥有 order-reader" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "policy-2", values: { policyName: "门店数据范围", policyEffect: "allow", policyReason: "目标门店属于杭州区域" }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "policy-3", values: { policyName: "敏感订单限制", policyEffect: "deny", policyReason: "当前 Scope 缺少 pii-read" }, createdAt: "2026-08-11T09:02:00.000Z" },
  ],
  formFieldCatalogDemo: [
    { id: "form-field-name", values: { fieldLabel: "客户名称", fieldType: "input", fieldRequired: "required" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "form-field-phone", values: { fieldLabel: "联系电话", fieldType: "input", fieldRequired: "optional" }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "form-field-channel", values: { fieldLabel: "来源渠道", fieldType: "select", fieldRequired: "required" }, createdAt: "2026-08-11T09:02:00.000Z" },
    { id: "form-field-date", values: { fieldLabel: "预约日期", fieldType: "date", fieldRequired: "optional" }, createdAt: "2026-08-11T09:03:00.000Z" },
    { id: "form-field-note", values: { fieldLabel: "补充说明", fieldType: "textarea", fieldRequired: "optional" }, createdAt: "2026-08-11T09:04:00.000Z" },
  ],
  pdfPageDemo: [
    { id: "pdf-page-1", values: { pdfPageNumber: 1, pageThumbnail: "/brand/logo.png" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "pdf-page-2", values: { pdfPageNumber: 2, pageThumbnail: "/brand/miantuan-mark.png" }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "pdf-page-3", values: { pdfPageNumber: 3, pageThumbnail: "/assets/sliderule_icon_flat_transparent.png" }, createdAt: "2026-08-11T09:02:00.000Z" },
    { id: "pdf-page-4", values: { pdfPageNumber: 4, pageThumbnail: "/assets/sliderule_icon_card_transparent.png" }, createdAt: "2026-08-11T09:03:00.000Z" },
  ],
  replicationStreamDemo: [
    { id: "stream-orders", values: { streamNamespace: "sales", streamName: "orders", streamSyncMode: "incremental", streamCursor: "updated_at", streamPrimaryKey: "id" }, createdAt: "2026-08-11T09:00:00.000Z" },
    { id: "stream-customers", values: { streamNamespace: "sales", streamName: "customers", streamSyncMode: "incremental", streamCursor: "", streamPrimaryKey: "id" }, createdAt: "2026-08-11T09:01:00.000Z" },
    { id: "stream-products", values: { streamNamespace: "catalog", streamName: "products", streamSyncMode: "full_refresh", streamCursor: "", streamPrimaryKey: "sku" }, createdAt: "2026-08-11T09:02:00.000Z" },
    { id: "stream-inventory", values: { streamNamespace: "catalog", streamName: "inventory_levels", streamSyncMode: "incremental", streamCursor: "modified_at", streamPrimaryKey: "location_id,sku" }, createdAt: "2026-08-11T09:03:00.000Z" },
  ],
  geofenceVertexDemo: [
    { id: "vertex-1", values: { vertexName: "西北角", mapX: 18, mapY: 20 }, createdAt: "2026-08-11T10:00:00.000Z" },
    { id: "vertex-2", values: { vertexName: "东北角", mapX: 78, mapY: 16 }, createdAt: "2026-08-11T10:01:00.000Z" },
    { id: "vertex-3", values: { vertexName: "东南角", mapX: 86, mapY: 72 }, createdAt: "2026-08-11T10:02:00.000Z" },
    { id: "vertex-4", values: { vertexName: "西南角", mapX: 26, mapY: 84 }, createdAt: "2026-08-11T10:03:00.000Z" },
  ],
  routeStopDemo: [
    { id: "stop-1", values: { stopName: "滨江仓", mapX: 15, mapY: 72, stopStatus: "ready", stopEta: "09:00" }, createdAt: "2026-08-11T10:00:00.000Z" },
    { id: "stop-2", values: { stopName: "钱江门店", mapX: 42, mapY: 54, stopStatus: "ready", stopEta: "09:35" }, createdAt: "2026-08-11T10:01:00.000Z" },
    { id: "stop-3", values: { stopName: "西湖门店", mapX: 64, mapY: 25, stopStatus: "ready", stopEta: "10:10" }, createdAt: "2026-08-11T10:02:00.000Z" },
    { id: "stop-4", values: { stopName: "拱墅站点", mapX: 86, mapY: 40, stopStatus: "ready", stopEta: "10:45" }, createdAt: "2026-08-11T10:03:00.000Z" },
  ],
  pivotFieldDemo: [
    { id: "pivot-region", values: { pivotFieldName: "区域", pivotFieldType: "string", pivotShelf: "rows" }, createdAt: "2026-08-11T10:00:00.000Z" },
    { id: "pivot-month", values: { pivotFieldName: "月份", pivotFieldType: "date", pivotShelf: "columns" }, createdAt: "2026-08-11T10:01:00.000Z" },
    { id: "pivot-orders", values: { pivotFieldName: "订单数", pivotFieldType: "metric", pivotShelf: "values" }, createdAt: "2026-08-11T10:02:00.000Z" },
    { id: "pivot-sales", values: { pivotFieldName: "销售额", pivotFieldType: "metric", pivotShelf: "values" }, createdAt: "2026-08-11T10:03:00.000Z" },
  ],
  booleanRuleDemo: [
    { id: "rule-1", values: { ruleGroup: "客户价值", ruleLogic: "and", ruleField: "累计消费", ruleOperator: "greater_than", ruleCompare: "5000" }, createdAt: "2026-08-11T10:00:00.000Z" },
    { id: "rule-2", values: { ruleGroup: "客户价值", ruleLogic: "and", ruleField: "会员等级", ruleOperator: "equals", ruleCompare: "金卡" }, createdAt: "2026-08-11T10:01:00.000Z" },
    { id: "rule-3", values: { ruleGroup: "活跃状态", ruleLogic: "or", ruleField: "最近下单", ruleOperator: "contains", ruleCompare: "30天内" }, createdAt: "2026-08-11T10:02:00.000Z" },
    { id: "rule-4", values: { ruleGroup: "活跃状态", ruleLogic: "or", ruleField: "访问次数", ruleOperator: "greater_than", ruleCompare: "10" }, createdAt: "2026-08-11T10:03:00.000Z" },
  ],
  imageCropDemo: [
    { id: "crop-1", values: { cropAssetName: "首页主视觉", cropImageUrl: "/brand/logo.png" }, createdAt: "2026-08-11T10:00:00.000Z" },
  ],
  datasetJoinDemo: [
    { id: "join-order-id", values: { joinSide: "left", joinDataset: "orders", joinColumn: "customer_id", joinColumnType: "uuid" }, createdAt: "2026-08-11T10:00:00.000Z" },
    { id: "join-order-time", values: { joinSide: "left", joinDataset: "orders", joinColumn: "created_at", joinColumnType: "datetime" }, createdAt: "2026-08-11T10:01:00.000Z" },
    { id: "join-customer-id", values: { joinSide: "right", joinDataset: "customers", joinColumn: "id", joinColumnType: "uuid" }, createdAt: "2026-08-11T10:02:00.000Z" },
    { id: "join-customer-name", values: { joinSide: "right", joinDataset: "customers", joinColumn: "name", joinColumnType: "string" }, createdAt: "2026-08-11T10:03:00.000Z" },
  ],
  compositeRoleDemo: [
    { id: "role-orders", values: { roleName: "订单管理员", roleScope: "realm", roleAssigned: "true", roleInherited: "false" }, createdAt: "2026-08-11T11:00:00.000Z" },
    { id: "role-reports", values: { roleName: "报表查看者", roleScope: "client", roleAssigned: "true", roleInherited: "false" }, createdAt: "2026-08-11T11:01:00.000Z" },
    { id: "role-profile", values: { roleName: "账户资料", roleScope: "realm", roleAssigned: "false", roleInherited: "true" }, createdAt: "2026-08-11T11:02:00.000Z" },
    { id: "role-audit", values: { roleName: "审计查看者", roleScope: "client", roleAssigned: "false", roleInherited: "false" }, createdAt: "2026-08-11T11:03:00.000Z" },
  ],
  httpHeaderDemo: [
    { id: "header-auth", values: { headerName: "Authorization", headerValue: "Bearer demo-secret" }, createdAt: "2026-08-11T11:00:00.000Z" },
    { id: "header-type", values: { headerName: "Content-Type", headerValue: "application/json" }, createdAt: "2026-08-11T11:01:00.000Z" },
    { id: "header-trace", values: { headerName: "X-Trace-Id", headerValue: "trace-wb-2048" }, createdAt: "2026-08-11T11:02:00.000Z" },
  ],
  bomAssemblyDemo: [
    { id: "bom-bike", values: { partName: "城市单车", parentPart: "", partQuantity: 1, unitCost: 420 }, createdAt: "2026-08-11T11:00:00.000Z" },
    { id: "bom-frame", values: { partName: "车架总成", parentPart: "bom-bike", partQuantity: 1, unitCost: 180 }, createdAt: "2026-08-11T11:01:00.000Z" },
    { id: "bom-wheel", values: { partName: "轮组", parentPart: "bom-bike", partQuantity: 2, unitCost: 96 }, createdAt: "2026-08-11T11:02:00.000Z" },
    { id: "bom-brake", values: { partName: "刹车组件", parentPart: "bom-bike", partQuantity: 2, unitCost: 38 }, createdAt: "2026-08-11T11:03:00.000Z" },
  ],
  alertThresholdDemo: [
    { id: "threshold-api", values: { thresholdSeries: "API 延迟", thresholdCurrent: 48 }, createdAt: "2026-08-11T11:00:00.000Z" },
    { id: "threshold-worker", values: { thresholdSeries: "Worker 队列", thresholdCurrent: 72 }, createdAt: "2026-08-11T11:01:00.000Z" },
    { id: "threshold-db", values: { thresholdSeries: "数据库连接", thresholdCurrent: 91 }, createdAt: "2026-08-11T11:02:00.000Z" },
  ],
  mediaTrimDemo: [
    { id: "marker-intro", values: { mediaName: "产品介绍片.mp4", mediaDuration: 64, markerOffset: 12, markerLabel: "开场" }, createdAt: "2026-08-11T11:00:00.000Z" },
    { id: "marker-demo", values: { mediaName: "产品介绍片.mp4", mediaDuration: 64, markerOffset: 31, markerLabel: "演示" }, createdAt: "2026-08-11T11:01:00.000Z" },
    { id: "marker-end", values: { mediaName: "产品介绍片.mp4", mediaDuration: 64, markerOffset: 55, markerLabel: "结尾" }, createdAt: "2026-08-11T11:02:00.000Z" },
  ],
  cronScheduleDemo: [
    { id: "cron-daily", values: { scheduleLabel: "工作日同步", cronExpression: "0 9 * * 1-5", scheduleTimezone: "Asia/Shanghai" }, createdAt: "2026-08-11T11:00:00.000Z" },
  ],
  ocrRegionDemo: [
    { id: "ocr-supplier", values: { ocrText: "青云工业设备有限公司", ocrConfidence: 98, boxX: 18, boxY: 29, boxWidth: 48, boxHeight: 9 }, createdAt: "2026-08-11T12:00:00.000Z" },
    { id: "ocr-order", values: { ocrText: "WB-20260811", ocrConfidence: 94, boxX: 18, boxY: 48, boxWidth: 32, boxHeight: 8 }, createdAt: "2026-08-11T12:01:00.000Z" },
    { id: "ocr-address", values: { ocrText: "杭州市滨江区协同路 18 号", ocrConfidence: 76, boxX: 18, boxY: 68, boxWidth: 62, boxHeight: 9 }, createdAt: "2026-08-11T12:02:00.000Z" },
  ],
  queryPlanDemo: [
    { id: "plan-root", values: { operatorName: "Projection", operatorParent: "", estimatedCost: 128, actualRows: 18420, operatorDuration: 142 }, createdAt: "2026-08-11T12:00:00.000Z" },
    { id: "plan-aggregate", values: { operatorName: "Hash Aggregate", operatorParent: "plan-root", estimatedCost: 92, actualRows: 240, operatorDuration: 86 }, createdAt: "2026-08-11T12:01:00.000Z" },
    { id: "plan-join", values: { operatorName: "Hash Join", operatorParent: "plan-aggregate", estimatedCost: 71, actualRows: 18420, operatorDuration: 48 }, createdAt: "2026-08-11T12:02:00.000Z" },
    { id: "plan-scan", values: { operatorName: "Remote Scan orders", operatorParent: "plan-join", estimatedCost: 38, actualRows: 92841, operatorDuration: 21 }, createdAt: "2026-08-11T12:03:00.000Z" },
  ],
  columnProfileDemo: [
    { id: "column-amount", values: { columnName: "order_amount", columnType: "decimal", nullRatio: 0.2, uniqueRatio: 68, minValue: "0.00", maxValue: "9999.00" }, createdAt: "2026-08-11T12:00:00.000Z" },
    { id: "column-channel", values: { columnName: "sales_channel", columnType: "string", nullRatio: 2.4, uniqueRatio: 0.03, minValue: "app", maxValue: "store" }, createdAt: "2026-08-11T12:01:00.000Z" },
    { id: "column-customer", values: { columnName: "customer_id", columnType: "uuid", nullRatio: 18.6, uniqueRatio: 73, minValue: "001...", maxValue: "fff..." }, createdAt: "2026-08-11T12:02:00.000Z" },
    { id: "column-created", values: { columnName: "created_at", columnType: "timestamp", nullRatio: 0, uniqueRatio: 91, minValue: "2026-01-01", maxValue: "2026-08-11" }, createdAt: "2026-08-11T12:03:00.000Z" },
  ],
  certificateRotationDemo: [
    { id: "cert-current", values: { certificateName: "api.miantuan.ai 2025", certificateStatus: "active", validFrom: "2025-09-01", validUntil: "2026-09-10", certificateFingerprint: "SHA256:94:28:AE:17:82:BB:20:48" }, createdAt: "2026-08-11T12:00:00.000Z" },
    { id: "cert-pending", values: { certificateName: "api.miantuan.ai 2026", certificateStatus: "pending", validFrom: "2026-08-20", validUntil: "2027-08-20", certificateFingerprint: "SHA256:6C:10:88:EF:26:11:39:AC" }, createdAt: "2026-08-11T12:01:00.000Z" },
  ],
  webhookSchemaDemo: [
    { id: "webhook-order", values: { webhookPath: "order", webhookType: "object", webhookSample: "{...}", webhookRequired: "true" }, createdAt: "2026-08-11T12:00:00.000Z" },
    { id: "webhook-id", values: { webhookPath: "order.id", webhookType: "string", webhookSample: "WB-2048", webhookRequired: "true" }, createdAt: "2026-08-11T12:01:00.000Z" },
    { id: "webhook-amount", values: { webhookPath: "order.amount", webhookType: "number", webhookSample: "688", webhookRequired: "true" }, createdAt: "2026-08-11T12:02:00.000Z" },
    { id: "webhook-customer", values: { webhookPath: "order.customer.name", webhookType: "string", webhookSample: "林女士", webhookRequired: "false" }, createdAt: "2026-08-11T12:03:00.000Z" },
    { id: "webhook-created", values: { webhookPath: "created_at", webhookType: "datetime", webhookSample: "2026-08-11T12:00:00Z", webhookRequired: "true" }, createdAt: "2026-08-11T12:04:00.000Z" },
  ],
  artifactProvenanceDemo: [
    { id: "provenance-subject", values: { evidenceSubject: "whybuddy-web.tar.gz", evidenceKind: "制品摘要", verificationStatus: "verified", evidenceDigest: "sha256:84f8bdb6cda68a37454890ac58c38d54", evidenceIssuer: "GitLab Runner" }, createdAt: "2026-08-11T12:00:00.000Z" },
    { id: "provenance-source", values: { evidenceSubject: "2686521696/WhyBuddy@4f2c19a", evidenceKind: "源码身份", verificationStatus: "trusted", evidenceDigest: "git:4f2c19a67e8907c0", evidenceIssuer: "GitHub" }, createdAt: "2026-08-11T12:01:00.000Z" },
    { id: "provenance-builder", values: { evidenceSubject: "runner/whybuddy-release:2026.08", evidenceKind: "构建器", verificationStatus: "verified", evidenceDigest: "sha256:19ca9dd24098a302", evidenceIssuer: "GitLab CI" }, createdAt: "2026-08-11T12:02:00.000Z" },
    { id: "provenance-materials", values: { evidenceSubject: "pnpm-lock.yaml + requirements.lock", evidenceKind: "材料清单", verificationStatus: "passed", evidenceDigest: "sha256:8f553ca8d5a10381", evidenceIssuer: "Syft" }, createdAt: "2026-08-11T12:03:00.000Z" },
    { id: "provenance-signature", values: { evidenceSubject: "whybuddy-web.tar.gz.sig", evidenceKind: "签名", verificationStatus: "verified", evidenceDigest: "sha256:701ea8e09a25db44", evidenceIssuer: "Cosign" }, createdAt: "2026-08-11T12:04:00.000Z" },
  ],
  bankReconciliationDemo: [
    { id: "statement-1", values: { reconcileKind: "statement", reconcileTitle: "支付宝结算入账", reconcileAmount: 12880, reconcileDate: "2026-08-10", matchScore: 100 }, createdAt: "2026-08-11T13:00:00.000Z" },
    { id: "statement-2", values: { reconcileKind: "statement", reconcileTitle: "线下门店汇款", reconcileAmount: 7600, reconcileDate: "2026-08-09", matchScore: 100 }, createdAt: "2026-08-11T13:01:00.000Z" },
    { id: "voucher-1", values: { reconcileKind: "voucher", reconcileTitle: "销售发票 INV-0831", reconcileAmount: 8800, reconcileDate: "2026-08-10", matchScore: 96 }, createdAt: "2026-08-11T13:02:00.000Z" },
    { id: "voucher-2", values: { reconcileKind: "voucher", reconcileTitle: "销售发票 INV-0835", reconcileAmount: 4080, reconcileDate: "2026-08-10", matchScore: 92 }, createdAt: "2026-08-11T13:03:00.000Z" },
    { id: "voucher-3", values: { reconcileKind: "voucher", reconcileTitle: "预收款 RCPT-0198", reconcileAmount: 7600, reconcileDate: "2026-08-09", matchScore: 88 }, createdAt: "2026-08-11T13:04:00.000Z" },
  ],
  cvssMetricDemo: [
    { id: "cvss-av", values: { cvssCode: "AV", cvssLabel: "攻击向量", cvssGroup: "Base", cvssValue: "N" }, createdAt: "2026-08-11T13:00:00.000Z" },
    { id: "cvss-ac", values: { cvssCode: "AC", cvssLabel: "攻击复杂度", cvssGroup: "Base", cvssValue: "L" }, createdAt: "2026-08-11T13:01:00.000Z" },
    { id: "cvss-pr", values: { cvssCode: "PR", cvssLabel: "所需权限", cvssGroup: "Base", cvssValue: "N" }, createdAt: "2026-08-11T13:02:00.000Z" },
    { id: "cvss-ui", values: { cvssCode: "UI", cvssLabel: "用户交互", cvssGroup: "Base", cvssValue: "R" }, createdAt: "2026-08-11T13:03:00.000Z" },
    { id: "cvss-e", values: { cvssCode: "E", cvssLabel: "利用成熟度", cvssGroup: "Temporal", cvssValue: "H" }, createdAt: "2026-08-11T13:04:00.000Z" },
    { id: "cvss-cr", values: { cvssCode: "CR", cvssLabel: "机密性要求", cvssGroup: "Environmental", cvssValue: "H" }, createdAt: "2026-08-11T13:05:00.000Z" },
  ],
  logPatternDemo: [
    { id: "pattern-timeout", values: { logPattern: "request <*> timed out after <*>ms", patternCount: 1842, patternCoverage: 48, sampleLog: "request order-sync timed out after 30000ms" }, createdAt: "2026-08-11T13:00:00.000Z" },
    { id: "pattern-retry", values: { logPattern: "retrying job <*> attempt <*>", patternCount: 928, patternCoverage: 24, sampleLog: "retrying job invoice-export attempt 3" }, createdAt: "2026-08-11T13:01:00.000Z" },
    { id: "pattern-connect", values: { logPattern: "connection to <*> restored", patternCount: 654, patternCoverage: 17, sampleLog: "connection to redis-primary restored" }, createdAt: "2026-08-11T13:02:00.000Z" },
  ],
  productVariantDemo: [
    { id: "variant-red", values: { variantGroup: "颜色", variantValue: "赤霞红", variantSku: "TEE-RED-S", variantPrice: 199, variantEnabled: "true" }, createdAt: "2026-08-11T13:00:00.000Z" },
    { id: "variant-blue", values: { variantGroup: "颜色", variantValue: "深海蓝", variantSku: "TEE-BLU-M", variantPrice: 209, variantEnabled: "true" }, createdAt: "2026-08-11T13:01:00.000Z" },
    { id: "variant-s", values: { variantGroup: "尺码", variantValue: "S", variantSku: "TEE-S", variantPrice: 199, variantEnabled: "true" }, createdAt: "2026-08-11T13:02:00.000Z" },
    { id: "variant-m", values: { variantGroup: "尺码", variantValue: "M", variantSku: "TEE-M", variantPrice: 209, variantEnabled: "true" }, createdAt: "2026-08-11T13:03:00.000Z" },
    { id: "variant-l", values: { variantGroup: "尺码", variantValue: "L", variantSku: "TEE-L", variantPrice: 219, variantEnabled: "true" }, createdAt: "2026-08-11T13:04:00.000Z" },
  ],
  inventoryLocationDemo: [
    { id: "location-east", values: { locationName: "华东中心仓", stocked: 860, reserved: 142, incoming: 300, locationEnabled: "true" }, createdAt: "2026-08-11T13:00:00.000Z" },
    { id: "location-south", values: { locationName: "华南前置仓", stocked: 320, reserved: 0, incoming: 0, locationEnabled: "true" }, createdAt: "2026-08-11T13:01:00.000Z" },
    { id: "location-north", values: { locationName: "华北退货仓", stocked: 74, reserved: 12, incoming: 0, locationEnabled: "false" }, createdAt: "2026-08-11T13:02:00.000Z" },
  ],
  faceIdentityDemo: [
    { id: "person-lin", values: { personName: "林女士", faceImage: "/brand/logo.png", faceSimilarity: 97, currentPerson: "unassigned-face-2048", personHidden: "false" }, createdAt: "2026-08-11T13:00:00.000Z" },
    { id: "person-chen", values: { personName: "陈晓雨", faceImage: "/brand/logo.png", faceSimilarity: 91, currentPerson: "unassigned-face-2048", personHidden: "false" }, createdAt: "2026-08-11T13:01:00.000Z" },
    { id: "person-wang", values: { personName: "王若溪", faceImage: "/brand/logo.png", faceSimilarity: 84, currentPerson: "unassigned-face-2048", personHidden: "false" }, createdAt: "2026-08-11T13:02:00.000Z" },
    { id: "person-hidden", values: { personName: "已隐藏人员", faceImage: "/brand/logo.png", faceSimilarity: 88, currentPerson: "unassigned-face-2048", personHidden: "true" }, createdAt: "2026-08-11T13:03:00.000Z" },
  ],
};

/**
 * 角色 id → 显示名（2026-08-11）。
 *
 * 线上截图里流程步骤条底下直接写着 `music_member` 这类内部标识符。夹具里第一个
 * 节点故意用 snake_case id、其余保留中文，这样对照台上**两条路都看得见**：
 * `front_desk` 会显示成「前台」，查不到的（主管/仓管/配送）回落原值。
 * 只演示一条路的夹具审不出这个特性通没通。
 */
const ROLE_LABELS: Record<string, string> = { front_desk: "前台" };

const WORKFLOW = {
  nodes: [
    { id: "n1", name: "受理", assigneeRole: "front_desk" },
    { id: "n2", name: "审核", assigneeRole: "主管" },
    { id: "n3", name: "配货", assigneeRole: "仓管" },
    { id: "n4", name: "交付", assigneeRole: "配送" },
  ],
  transitions: [
    { from: "n1", to: "n2", condition: "资料齐全" },
    { from: "n2", to: "n3", condition: "审核通过" },
    { from: "n3", to: "n4", condition: "已备齐" },
  ],
  chains: [],
};

const FREEFORM_DEMO = {
  root: {
    tag: "div",
    style: { display: "flex", flexDirection: "column", gap: "12px" },
    children: [
      {
        tag: "div",
        style: { display: "flex", gap: "12px" },
        children: [
          {
            tag: "div",
            style: {
              flex: "1", padding: "12px", borderRadius: "6px",
              backgroundColor: "#f0f5ff", display: "flex", flexDirection: "column", gap: "4px",
            },
            children: [
              { tag: "span", style: { fontSize: "12px", color: "#8c8c8c" }, text: "订单总数" },
              {
                tag: "span",
                style: { fontSize: "22px", fontWeight: "700", color: PRIMARY },
                dataRef: { entityRef: "order", aggregate: "count" },
              },
            ],
          },
          {
            tag: "div",
            style: {
              flex: "1", padding: "12px", borderRadius: "6px",
              backgroundColor: "#f6ffed", display: "flex", flexDirection: "column", gap: "4px",
            },
            children: [
              { tag: "span", style: { fontSize: "12px", color: "#8c8c8c" }, text: "金额合计" },
              {
                tag: "span",
                style: { fontSize: "22px", fontWeight: "700", color: "#52c41a" },
                dataRef: { entityRef: "order", aggregate: "sum:amount" },
              },
            ],
          },
        ],
      },
      {
        // ⚠️ chart 的聚合键叫 metric，dataRef 的叫 aggregate——两个不一样，
        // 写混了图表会静默不渲染（不报错）。
        tag: "div",
        style: { height: "170px" },
        chart: {
          type: "donut",
          entityRef: "order",
          dimensionFieldId: "status",
          metric: "sum",
          metricFieldId: "amount",
          metricLabel: "金额",
        },
      },
    ],
  },
};

/** 每个区块要挂起来需要的 block 实例 + 额外 props。 */
/**
 * 组件库的示例数据 —— **一个类型一条记录**（2026-08-08 由 14 分支的 switch 改成）。
 *
 * 形状照 measuredco/puck 的 ComponentConfig.defaultProps：示例数据是组件的
 * 一项属性，跟渲染器住在一起，不是散落在调用方的一个 switch 里。
 *
 * 此前 switch 与 HAS_DEMO 那张手写名单是两处：名单里有、switch 里没有就渲染
 * 出一张空卡；反过来示例数据永远用不到。加组件要同时记得改两处，漏改不报错。
 * 现在 HAS_DEMO 直接由这张表的键派生，两处对不上这件事从结构上消失。
 *
 * 到三五百个组件时这张表会挪进目录记录本身（lowcode-engine 的 snippets：
 * 一个渲染器带多个带标题和截图的行业变体），形状不用变。
 */
const DEMOS: Record<string, { block: ExperienceBlockInstance; extra: Record<string, unknown> }> = {
  SignatureFieldCanvas: { block: { id: "demo-SignatureFieldCanvas", type: "SignatureFieldCanvas", binding: { entityRef: "signingRecipient", nameFieldRef: "signerName", roleFieldRef: "signerRole", statusFieldRef: "signerStatus", targets: ["document"] } }, extra: {} },
  AlertGroupAccordion: { block: { id: "demo-AlertGroupAccordion", type: "AlertGroupAccordion", binding: { entityRef: "alertGroupDemo", titleFieldRef: "alertName", groupFieldRef: "alertGroup", statusFieldRef: "alertStatus", severityFieldRef: "alertSeverity", targets: ["alerts"] } }, extra: {} },
  EvidenceCollectionWorkspace: { block: { id: "demo-EvidenceCollectionWorkspace", type: "EvidenceCollectionWorkspace", binding: { entityRef: "evidenceRequirement", titleFieldRef: "evidenceName", requiredFieldRef: "evidenceRequired", statusFieldRef: "evidenceStatus", targets: ["review"] } }, extra: {} },
  AssetReviewLightbox: { block: { id: "demo-AssetReviewLightbox", type: "AssetReviewLightbox", binding: { entityRef: "mediaAssetDemo", nameFieldRef: "assetName", urlFieldRef: "assetUrl", typeFieldRef: "assetType", createdFieldRef: "assetCreated" } }, extra: {} },
  PaymentAllocationWorkbench: { block: { id: "demo-PaymentAllocationWorkbench", type: "PaymentAllocationWorkbench", props: { paymentAmount: 7500 }, binding: { entityRef: "unpaidInvoiceDemo", titleFieldRef: "invoiceTitle", invoiceDueFieldRef: "invoiceDue", targets: ["payment"] } }, extra: {} },
  DeploymentRolloutTrack: { block: { id: "demo-DeploymentRolloutTrack", type: "DeploymentRolloutTrack", binding: { entityRef: "rolloutStageDemo", titleFieldRef: "stageName", statusFieldRef: "stageStatus", rolloutHealthFieldRef: "stageHealth", targets: ["deployment"] } }, extra: {} },
  WorkflowNodeDebugger: { block: { id: "demo-WorkflowNodeDebugger", type: "WorkflowNodeDebugger", binding: { entityRef: "workflowNodeDebugDemo", titleFieldRef: "nodeTitle", statusFieldRef: "nodeStatus", nodeParentFieldRef: "nodeParent", nodeMessageFieldRef: "nodeMessage", targets: ["workflow"] } }, extra: {} },
  QueryNotebookComposer: { block: { id: "demo-QueryNotebookComposer", type: "QueryNotebookComposer", binding: { entityRef: "queryNotebookDemo", titleFieldRef: "queryTitle", queryFieldRef: "queryText", statusFieldRef: "queryStatus", resultCountFieldRef: "resultCount", targets: ["query"] } }, extra: {} },
  WarehouseBinHeatmap: { block: { id: "demo-WarehouseBinHeatmap", type: "WarehouseBinHeatmap", binding: { entityRef: "warehouseBinDemo", nameFieldRef: "binName", aisleFieldRef: "aisleName", binUsedFieldRef: "binUsed", binCapacityFieldRef: "binCapacity" } }, extra: {} },
  ExperimentTrafficAllocator: { block: { id: "demo-ExperimentTrafficAllocator", type: "ExperimentTrafficAllocator", binding: { entityRef: "experimentVariantDemo", nameFieldRef: "variantName", variantWeightFieldRef: "trafficWeight", targets: ["experiment"] } }, extra: {} },
  SlaBreachClock: { block: { id: "demo-SlaBreachClock", type: "SlaBreachClock", binding: { entityRef: "slaTicketDemo", titleFieldRef: "ticketTitle", slaDeadlineFieldRef: "slaDeadline", statusFieldRef: "ticketStatus", slaOwnerFieldRef: "slaOwner", targets: ["ticket"] } }, extra: {} },
  WarehousePickRouteScanner: { block: { id: "demo-WarehousePickRouteScanner", type: "WarehousePickRouteScanner", binding: { entityRef: "warehousePickDemo", titleFieldRef: "pickTitle", pickBinFieldRef: "pickBin", scanCodeFieldRef: "expectedScanCode", pickedQuantityFieldRef: "pickedQuantity", targets: ["pick-list"] } }, extra: {} },
  ResumableUploadQueue: { block: { id: "demo-ResumableUploadQueue", type: "ResumableUploadQueue", binding: { entityRef: "uploadQueueDemo", fileNameFieldRef: "transferFileName", fileSizeFieldRef: "transferFileSize", transferStatusFieldRef: "transferStatus", transferProgressFieldRef: "transferProgress", targets: ["uploads"] } }, extra: {} },
  DistributedTraceWaterfall: { block: { id: "demo-DistributedTraceWaterfall", type: "DistributedTraceWaterfall", binding: { entityRef: "traceSpanDemo", spanNameFieldRef: "spanName", spanParentFieldRef: "spanParent", spanStartFieldRef: "spanStart", spanDurationFieldRef: "spanDuration", statusFieldRef: "spanStatus" } }, extra: {} },
  ExpressionDataMapper: { block: { id: "demo-ExpressionDataMapper", type: "ExpressionDataMapper", props: { expression: "{{$json.customer.name}}" }, binding: { entityRef: "expressionInputDemo", dataPathFieldRef: "dataPath", sampleValueFieldRef: "sampleValue", dataTypeFieldRef: "dataType", targets: ["mapping"] } }, extra: {} },
  SessionReplayScrubber: { block: { id: "demo-SessionReplayScrubber", type: "SessionReplayScrubber", binding: { entityRef: "replayEventDemo", eventOffsetFieldRef: "replayOffset", eventTypeFieldRef: "replayType", summaryFieldRef: "replaySummary", severityFieldRef: "replaySeverity" } }, extra: {} },
  DashboardGridComposer: { block: { id: "demo-DashboardGridComposer", type: "DashboardGridComposer", binding: { entityRef: "dashboardPanelDemo", panelTitleFieldRef: "panelTitle", gridXFieldRef: "gridX", gridYFieldRef: "gridY", gridWidthFieldRef: "gridWidth", gridHeightFieldRef: "gridHeight", targets: ["dashboard"] } }, extra: {} },
  LiveLogTailer: { block: { id: "demo-LiveLogTailer", type: "LiveLogTailer", binding: { entityRef: "liveLogDemo", logTimeFieldRef: "logTime", logLevelFieldRef: "logLevel", logMessageFieldRef: "logMessage", logStreamFieldRef: "logStream", targets: ["logs"] } }, extra: {} },
  FlameGraphProfiler: { block: { id: "demo-FlameGraphProfiler", type: "FlameGraphProfiler", binding: { entityRef: "flameProfileDemo", functionNameFieldRef: "functionName", profileParentFieldRef: "profileParent", profileDepthFieldRef: "profileDepth", totalSamplesFieldRef: "totalSamples", selfSamplesFieldRef: "selfSamples" } }, extra: {} },
  ThreeWayMergeResolver: { block: { id: "demo-ThreeWayMergeResolver", type: "ThreeWayMergeResolver", binding: { entityRef: "mergeConflictDemo", conflictPathFieldRef: "conflictPath", baseContentFieldRef: "baseContent", oursContentFieldRef: "oursContent", theirsContentFieldRef: "theirsContent", targets: ["merge-request"] } }, extra: {} },
  PolicyDecisionSimulator: { block: { id: "demo-PolicyDecisionSimulator", type: "PolicyDecisionSimulator", props: { subject: "user-1008", resource: "orders", scope: "read" }, binding: { entityRef: "policyDecisionDemo", policyNameFieldRef: "policyName", policyEffectFieldRef: "policyEffect", policyReasonFieldRef: "policyReason", targets: ["authorization"] } }, extra: {} },
  FormCanvasBuilder: { block: { id: "demo-FormCanvasBuilder", type: "FormCanvasBuilder", binding: { entityRef: "formFieldCatalogDemo", fieldLabelFieldRef: "fieldLabel", fieldTypeFieldRef: "fieldType", requiredFieldRef: "fieldRequired", targets: ["form-schema"] } }, extra: {} },
  PdfPageOrganizer: { block: { id: "demo-PdfPageOrganizer", type: "PdfPageOrganizer", binding: { entityRef: "pdfPageDemo", pageNumberFieldRef: "pdfPageNumber", thumbnailFieldRef: "pageThumbnail", targets: ["document"] } }, extra: {} },
  StreamReplicationConfigurator: { block: { id: "demo-StreamReplicationConfigurator", type: "StreamReplicationConfigurator", binding: { entityRef: "replicationStreamDemo", namespaceFieldRef: "streamNamespace", streamNameFieldRef: "streamName", syncModeFieldRef: "streamSyncMode", cursorFieldRef: "streamCursor", primaryKeyFieldRef: "streamPrimaryKey", targets: ["connection"] } }, extra: {} },
  GeofenceVertexEditor: { block: { id: "demo-GeofenceVertexEditor", type: "GeofenceVertexEditor", binding: { entityRef: "geofenceVertexDemo", vertexNameFieldRef: "vertexName", longitudeFieldRef: "mapX", latitudeFieldRef: "mapY", targets: ["geofence"] } }, extra: {} },
  RouteStopSequencer: { block: { id: "demo-RouteStopSequencer", type: "RouteStopSequencer", binding: { entityRef: "routeStopDemo", stopNameFieldRef: "stopName", longitudeFieldRef: "mapX", latitudeFieldRef: "mapY", stopStatusFieldRef: "stopStatus", etaFieldRef: "stopEta", targets: ["route"] } }, extra: {} },
  PivotShelfComposer: { block: { id: "demo-PivotShelfComposer", type: "PivotShelfComposer", binding: { entityRef: "pivotFieldDemo", fieldNameFieldRef: "pivotFieldName", fieldTypeFieldRef: "pivotFieldType", defaultShelfFieldRef: "pivotShelf", targets: ["dataset"] } }, extra: {} },
  BooleanRuleTreeBuilder: { block: { id: "demo-BooleanRuleTreeBuilder", type: "BooleanRuleTreeBuilder", binding: { entityRef: "booleanRuleDemo", conditionGroupFieldRef: "ruleGroup", groupLogicFieldRef: "ruleLogic", conditionFieldFieldRef: "ruleField", operatorFieldRef: "ruleOperator", compareValueFieldRef: "ruleCompare", targets: ["segment"] } }, extra: {} },
  ImageCropTransformStudio: { block: { id: "demo-ImageCropTransformStudio", type: "ImageCropTransformStudio", binding: { entityRef: "imageCropDemo", assetNameFieldRef: "cropAssetName", imageUrlFieldRef: "cropImageUrl", targets: ["asset"] } }, extra: {} },
  DatasetJoinBuilder: { block: { id: "demo-DatasetJoinBuilder", type: "DatasetJoinBuilder", binding: { entityRef: "datasetJoinDemo", datasetSideFieldRef: "joinSide", datasetNameFieldRef: "joinDataset", columnNameFieldRef: "joinColumn", columnTypeFieldRef: "joinColumnType", targets: ["query"] } }, extra: {} },
  CompositeRoleBuilder: { block: { id: "demo-CompositeRoleBuilder", type: "CompositeRoleBuilder", props: { roleId: "current-role" }, binding: { entityRef: "compositeRoleDemo", roleNameFieldRef: "roleName", roleScopeFieldRef: "roleScope", assignedFieldRef: "roleAssigned", inheritedFieldRef: "roleInherited", targets: ["role"] } }, extra: {} },
  HttpRequestWorkbench: { block: { id: "demo-HttpRequestWorkbench", type: "HttpRequestWorkbench", props: { method: "POST", url: "https://api.miantuan.ai/orders", body: "{\"limit\":20}" }, binding: { entityRef: "httpHeaderDemo", headerNameFieldRef: "headerName", headerValueFieldRef: "headerValue", targets: ["http"] } }, extra: {} },
  BomAssemblyTreeEditor: { block: { id: "demo-BomAssemblyTreeEditor", type: "BomAssemblyTreeEditor", binding: { entityRef: "bomAssemblyDemo", partNameFieldRef: "partName", parentPartFieldRef: "parentPart", quantityFieldRef: "partQuantity", unitCostFieldRef: "unitCost", targets: ["bom"] } }, extra: {} },
  AlertThresholdBandEditor: { block: { id: "demo-AlertThresholdBandEditor", type: "AlertThresholdBandEditor", props: { warning: 60, critical: 85 }, binding: { entityRef: "alertThresholdDemo", seriesLabelFieldRef: "thresholdSeries", currentValueFieldRef: "thresholdCurrent", targets: ["alert-rule"] } }, extra: {} },
  MediaTrimTimeline: { block: { id: "demo-MediaTrimTimeline", type: "MediaTrimTimeline", binding: { entityRef: "mediaTrimDemo", mediaNameFieldRef: "mediaName", durationFieldRef: "mediaDuration", markerOffsetFieldRef: "markerOffset", markerLabelFieldRef: "markerLabel", targets: ["media"] } }, extra: {} },
  CronOccurrenceBuilder: { block: { id: "demo-CronOccurrenceBuilder", type: "CronOccurrenceBuilder", binding: { entityRef: "cronScheduleDemo", scheduleLabelFieldRef: "scheduleLabel", cronExpressionFieldRef: "cronExpression", timezoneFieldRef: "scheduleTimezone", targets: ["schedule"] } }, extra: {} },
  OcrRegionCorrectionCanvas: { block: { id: "demo-OcrRegionCorrectionCanvas", type: "OcrRegionCorrectionCanvas", binding: { entityRef: "ocrRegionDemo", recognizedTextFieldRef: "ocrText", confidenceFieldRef: "ocrConfidence", boxXFieldRef: "boxX", boxYFieldRef: "boxY", boxWidthFieldRef: "boxWidth", boxHeightFieldRef: "boxHeight", targets: ["document"] } }, extra: {} },
  QueryExecutionPlanInspector: { block: { id: "demo-QueryExecutionPlanInspector", type: "QueryExecutionPlanInspector", binding: { entityRef: "queryPlanDemo", operatorNameFieldRef: "operatorName", operatorParentFieldRef: "operatorParent", estimatedCostFieldRef: "estimatedCost", actualRowsFieldRef: "actualRows", durationFieldRef: "operatorDuration", targets: ["query"] } }, extra: {} },
  ColumnProfileWorkbench: { block: { id: "demo-ColumnProfileWorkbench", type: "ColumnProfileWorkbench", binding: { entityRef: "columnProfileDemo", columnNameFieldRef: "columnName", columnTypeFieldRef: "columnType", nullRatioFieldRef: "nullRatio", uniqueRatioFieldRef: "uniqueRatio", minValueFieldRef: "minValue", maxValueFieldRef: "maxValue" } }, extra: {} },
  CertificateRotationPlanner: { block: { id: "demo-CertificateRotationPlanner", type: "CertificateRotationPlanner", binding: { entityRef: "certificateRotationDemo", certificateNameFieldRef: "certificateName", certificateStatusFieldRef: "certificateStatus", validFromFieldRef: "validFrom", validUntilFieldRef: "validUntil", fingerprintFieldRef: "certificateFingerprint", targets: ["certificate"] } }, extra: {} },
  WebhookPayloadSchemaExplorer: { block: { id: "demo-WebhookPayloadSchemaExplorer", type: "WebhookPayloadSchemaExplorer", props: { samplePayload: "{\"order\":{\"id\":\"WB-2048\",\"amount\":688,\"customer\":{\"name\":\"林女士\"}},\"created_at\":\"2026-08-11T12:00:00Z\"}" }, binding: { entityRef: "webhookSchemaDemo", fieldPathFieldRef: "webhookPath", fieldTypeFieldRef: "webhookType", sampleValueFieldRef: "webhookSample", requiredFieldRef: "webhookRequired", targets: ["workflow"] } }, extra: {} },
  ArtifactProvenanceVerifier: { block: { id: "demo-ArtifactProvenanceVerifier", type: "ArtifactProvenanceVerifier", binding: { entityRef: "artifactProvenanceDemo", subjectFieldRef: "evidenceSubject", evidenceKindFieldRef: "evidenceKind", verificationStatusFieldRef: "verificationStatus", digestFieldRef: "evidenceDigest", issuerFieldRef: "evidenceIssuer", targets: ["release"] } }, extra: {} },
  BankTransactionReconciliationMatcher: { block: { id: "demo-BankTransactionReconciliationMatcher", type: "BankTransactionReconciliationMatcher", binding: { entityRef: "bankReconciliationDemo", recordKindFieldRef: "reconcileKind", recordTitleFieldRef: "reconcileTitle", amountFieldRef: "reconcileAmount", dateFieldRef: "reconcileDate", matchScoreFieldRef: "matchScore", targets: ["bank-reconciliation"] } }, extra: {} },
  CvssVectorCalculator: { block: { id: "demo-CvssVectorCalculator", type: "CvssVectorCalculator", binding: { entityRef: "cvssMetricDemo", metricCodeFieldRef: "cvssCode", metricLabelFieldRef: "cvssLabel", metricGroupFieldRef: "cvssGroup", metricValueFieldRef: "cvssValue", targets: ["finding"] } }, extra: {} },
  LogPatternClusterExplorer: { block: { id: "demo-LogPatternClusterExplorer", type: "LogPatternClusterExplorer", binding: { entityRef: "logPatternDemo", patternFieldRef: "logPattern", patternCountFieldRef: "patternCount", coverageFieldRef: "patternCoverage", sampleLogFieldRef: "sampleLog" } }, extra: {} },
  ProductVariantMatrixBuilder: { block: { id: "demo-ProductVariantMatrixBuilder", type: "ProductVariantMatrixBuilder", binding: { entityRef: "productVariantDemo", attributeGroupFieldRef: "variantGroup", attributeValueFieldRef: "variantValue", skuFieldRef: "variantSku", priceFieldRef: "variantPrice", enabledFieldRef: "variantEnabled", targets: ["product"] } }, extra: {} },
  InventoryLocationLevelTuner: { block: { id: "demo-InventoryLocationLevelTuner", type: "InventoryLocationLevelTuner", binding: { entityRef: "inventoryLocationDemo", locationNameFieldRef: "locationName", stockedFieldRef: "stocked", reservedFieldRef: "reserved", incomingFieldRef: "incoming", enabledFieldRef: "locationEnabled", targets: ["inventory-item"] } }, extra: {} },
  FaceIdentityAssignmentPanel: { block: { id: "demo-FaceIdentityAssignmentPanel", type: "FaceIdentityAssignmentPanel", binding: { entityRef: "faceIdentityDemo", personNameFieldRef: "personName", faceImageFieldRef: "faceImage", similarityFieldRef: "faceSimilarity", currentPersonFieldRef: "currentPerson", hiddenFieldRef: "personHidden", targets: ["face"] } }, extra: {} },
  RecordForm: {
        block: {
          id: "demo-RecordForm", type: "RecordForm",
          props: { title: "新建订单", submitText: "创建", layout: "vertical" },
          // 这份字段表是**格式与类型的对照实验**（阶段④）：中间五个全是 number
          // 或 string，长相却各不相同，差别只来自 format；两头的 status/at 没有
          // format，走类型回落。一屏之内两条路都能看见，接没接上一眼就知道。
          //
          //   amount      number + money    → 金额框（¥ 千分位）
          //   weekDelta   number + percent  → 数字框带 % 后缀
          //   fulfillRate number + progress → 滑杆
          //   healthScore number + score    → 无上限数字框
          //   starLevel   number + rating   → 星星
          //   contact     string + masked   → 密码框（不摊在屏幕上）
          //   status/at   无 format          → 下拉 / 日期（按类型）
          binding: {
            entityRef: "order",
            fieldRefs: [
              "name", "amount", "weekDelta", "fulfillRate",
              "healthScore", "starLevel", "contact", "status", "at",
            ],
          },
        },
        extra: {},
      },
  RecordFormDialog: {
        block: {
          id: "demo-RecordFormDialog", type: "RecordFormDialog",
          props: { title: "新建订单", mode: "drawer", triggerText: "新建订单" },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status"] },
        },
        extra: {},
      },
  RecordDetail: {
        block: {
          id: "demo-RecordDetail", type: "RecordDetail",
          props: { title: "订单详情", columns: 2 },
          // 详情是宽字段的去处：长文本备注、缩略图、外链在两列描述里比在表格
          // 单元格里更接近真实用法。
          binding: {
            entityRef: "order",
            fieldRefs: ["name", "amount", "status", "at", "cover", "contact", "detailUrl", "remark"],
          },
        },
        extra: {},
      },
  SectionedForm: {
        block: {
          id: "demo-SectionedForm", type: "SectionedForm",
          props: { title: "新建订单（分段）", submitText: "提交" },
          // 分段是它的全部意义，所以夹具必须真的分段——一段的话画出来跟
          // RecordForm 一模一样，看不出这个区块存在的理由。
          binding: {
            entityRef: "order",
            sections: [
              { title: "基本信息", fieldRefs: ["name", "channel", "at"] },
              { title: "金额与考核", fieldRefs: ["amount", "healthScore", "starLevel"] },
              { title: "联系方式", fieldRefs: ["contact", "owner_id"] },
            ],
          },
        },
        extra: {},
      },
  CardGridList: {
        block: {
          id: "demo-CardGridList", type: "CardGridList",
          props: { title: "门店卡片" },
          binding: {
            entityRef: "order",
            titleFieldRef: "name",
            descFieldRef: "remark",
            imageFieldRef: "cover",
            metaFieldRefs: ["amount", "status"],
          },
        },
        extra: {},
      },
  StandardListRows: {
        block: {
          id: "demo-StandardListRows", type: "StandardListRows",
          props: { title: "门店列表", actions: ["编辑", "更多"] },
          binding: {
            entityRef: "order",
            titleFieldRef: "name",
            descFieldRef: "remark",
            avatarFieldRef: "cover",
            statFieldRefs: ["amount", "weekDelta"],
          },
        },
        extra: {},
      },
  StepsForm: {
        block: {
          id: "demo-StepsForm", type: "StepsForm",
          props: { title: "订单录入" },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status", "channel"] },
        },
        // 步骤名跟着工作流链路走（见 StepsFormRenderer 里的说明），
        // 这里给一条真链路，才看得出"五系统关联"不是一句口号。
        extra: {
          workflow: {
            chains: [
              {
                id: "order-main",
                nodes: [
                  { id: "n1", name: "填写订单" },
                  { id: "n2", name: "确认金额" },
                  { id: "n3", name: "提交审核" },
                ],
              },
            ],
          },
        },
      },
  ContentCard: {
        block: { id: "demo-ContentCard", type: "ContentCard", props: { title: "订单概览", subtitle: "容器 · 装什么由组装决定" } },
        extra: {
          children: (
            <div className="text-[12px] leading-relaxed text-slate-500">
              这是个容器，本身不展示数据。
              <br />
              组装时把几个积木的 id 写进它的 children，它们就被收进同一张卡里。
            </div>
          ),
        },
      },
  MetricGrid: {
        block: {
          id: "demo-MetricGrid", type: "MetricGrid",
          props: {
            title: "今日经营指标",
            hint: "统计口径：已完成与进行中的订单金额之和，不含已取消",
            footnote: "口径以财务月结为准",
          },
          // trendFieldRef 给了才有环比和迷你走势线——对照台上要看得见这两层，
          // 不然「五槽」只兑现了一槽
          binding: {
            entityRef: "order", aggregate: "sum:amount",
            trendFieldRef: "at", trendGrain: "day",
          },
        },
        extra: {},
      },
  ProportionPie: {
        block: {
          id: "demo-ProportionPie", type: "ProportionPie",
          props: { title: "渠道占比" },
          binding: { entityRef: "order", dimensionRef: "channel", aggregate: "sum:amount" },
        },
        extra: {},
      },
  TrendChart: {
        block: {
          id: "demo-TrendChart", type: "TrendChart", props: { title: "金额走势" },
          binding: { entityRef: "order", aggregate: "sum:amount", timeDimensionRef: "at", timeGrain: "day" },
        },
        extra: {},
      },
  RankedList: {
        block: {
          id: "demo-RankedList", type: "RankedList", props: { title: "门店销售 Top 5" },
          binding: {
            entityRef: "order", sortByRef: "amount", sortOrder: "desc", limit: 5,
            deltaFieldRef: "weekDelta",
          },
        },
        extra: {},
      },
  ActivityFeed: {
        block: {
          id: "demo-ActivityFeed", type: "ActivityFeed", props: { title: "最近动态", variant: "timeline" },
          binding: {
            entityRef: "order", timeFieldRef: "at",
            levelFieldRef: "status", detailFieldRefs: ["name", "amount"],
          },
        },
        extra: {},
      },
  DataTable: {
        // fieldRefs 是**显式写死**的，不能省。不写的话渲染器按行数据的键派生前
        // 八个，正好切在 cover 之后——布尔、关联、长文本三种语义在对照台上一个
        // 都看不见。看不见就等于没接上。
        block: {
          id: "demo-DataTable", type: "DataTable", props: { title: "订单明细" },
          binding: {
            entityRef: "order",
            fieldRefs: [
              "name", "cover", "amount", "status", "urgent",
              "owner_id", "contact", "detailUrl", "remark", "at",
            ],
          },
        },
        extra: {},
      },
  EditableSubTable: {
        block: {
          id: "demo-EditableSubTable", type: "EditableSubTable",
          props: { title: "订单明细", editMode: "row", maxRows: 8, addText: "新增一行" },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status", "at"] },
        },
        extra: {},
      },
  ColumnSettingPanel: {
        block: {
          id: "demo-ColumnSettingPanel", type: "ColumnSettingPanel",
          props: { title: "列设置" },
          // targets 指向墙上那张 DataTable 的 id。这一格是**单块预览**，那张表
          // 不在同一棵树上，所以看不到联动——但连线本身是真的：装进同一页时
          // （对照台下半截的装配预览）勾掉一列，表上那列就消失。
          binding: { entityRef: "order", targets: ["demo-DataTable"] },
        },
        // 面板自己不绑行数据，列清单由宿主给（见渲染器里 targetColumns 的说明）
        extra: { targetColumns: ["name", "cover", "amount", "status", "urgent", "owner_id", "at"] },
      },
  QuickActionPanel: {
        block: { id: "demo-QuickActionPanel", type: "QuickActionPanel", props: { title: "常用操作", columns: 3 } },
        extra: {
          pageActions: [
            { id: "a1", label: "新建订单", permitted: true },
            { id: "a2", label: "批量导入", permitted: true },
            { id: "a3", label: "导出报表", permitted: false },
          ],
        },
      },
  TagFilterRow: {
        block: {
          id: "demo-TagFilterRow", type: "TagFilterRow",
          props: { title: "按标签筛选" },
          binding: {
            entityRef: "order", fieldRefs: ["status", "channel"],
            targets: ["demo-DataTable"],
          },
        },
        // 标签行的取值从 filterFieldOptions 来（跟 FilterBar 同一条通道）。
        // 故意给 status 塞满 11 个取值：**展开按钮只在真的放不下时才该出现**，
        // 对照台上得能看见这条与源码的分歧（它那边永远显示）。
        extra: {
          filterFieldOptions: [
            {
              id: "status", label: "状态",
              options: [
                { label: "待办", value: "todo" },
                { label: "进行中", value: "doing" },
                { label: "已完成", value: "done" },
                { label: "待审核", value: "s4" },
                { label: "已驳回", value: "s5" },
                { label: "待发货", value: "s6" },
                { label: "已发货", value: "s7" },
                { label: "配送中", value: "s8" },
                { label: "已签收", value: "s9" },
                { label: "已退货", value: "s10" },
                { label: "已关闭", value: "s11" },
              ],
            },
            {
              id: "channel", label: "渠道",
              options: [
                { label: "线上", value: "线上" },
                { label: "门店", value: "门店" },
                { label: "电话", value: "电话" },
              ],
            },
          ],
        },
      },
  SearchBox: {
        block: {
          id: "demo-SearchBox", type: "SearchBox",
          props: { title: "搜索", placeholder: "搜门店名或备注" },
          binding: { entityRef: "order", targets: ["demo-DataTable"] },
        },
        extra: {},
      },
  FilterBar: {
        block: { id: "demo-FilterBar", type: "FilterBar", props: { title: "筛选条件", showDateRange: true } },
        extra: {
          filterFieldOptions: [
            {
              id: "status", label: "状态",
              options: [
                { label: "待办", value: "todo" },
                { label: "进行中", value: "doing" },
                { label: "已完成", value: "done" },
              ],
            },
            {
              id: "channel", label: "渠道",
              options: [
                { label: "线上", value: "线上" },
                { label: "门店", value: "门店" },
                { label: "电话", value: "电话" },
              ],
            },
          ],
          dateRangeField: { id: "at", label: "下单日期" },
          filterState: { enumFilters: {}, dateRange: null },
        },
      },
  WorkflowTimeline: {
        block: { id: "demo-WorkflowTimeline", type: "WorkflowTimeline", props: { title: "订单流转" } },
        extra: { workflow: WORKFLOW },
      },
  AttachmentPanel: {
        block: {
          id: "demo-AttachmentPanel", type: "AttachmentPanel",
          props: { title: "巡检附件", allowUpload: true, uploadText: "添加材料" },
          binding: {
            entityRef: "attachment",
            fileNameFieldRef: "fileName",
            fileSizeFieldRef: "fileSize",
            statusFieldRef: "fileStatus",
            uploadedAtFieldRef: "uploadedAt",
          },
        },
        extra: {},
      },
  CommentThread: {
        block: {
          id: "demo-CommentThread", type: "CommentThread",
          props: { title: "协作讨论", allowReply: true, pageSize: 3, submitText: "发布" },
          binding: {
            entityRef: "comment",
            authorFieldRef: "author",
            contentFieldRef: "content",
            timeFieldRef: "commentedAt",
            avatarFieldRef: "avatar",
            statusFieldRef: "commentStatus",
            parentFieldRef: "parentId",
          },
        },
        extra: {},
      },
  RecordPicker: {
        block: {
          id: "demo-RecordPicker", type: "RecordPicker",
          props: { title: "选择门店", selectionMode: "multiple", searchable: true, maxSelected: 3 },
          binding: {
            entityRef: "order",
            titleFieldRef: "name",
            descFieldRef: "remark",
            statusFieldRef: "status",
          },
        },
        extra: {},
      },
  KanbanBoard: {
        block: {
          id: "demo-KanbanBoard", type: "KanbanBoard",
          props: { title: "门店整改看板", movable: true },
          binding: { entityRef: "order", titleFieldRef: "name", statusFieldRef: "status", descFieldRef: "remark", assigneeFieldRef: "channel" },
        },
        extra: {},
      },
  ScheduleCalendar: {
        block: {
          id: "demo-ScheduleCalendar", type: "ScheduleCalendar",
          props: { title: "巡检日程", initialDate: "2026-08-09", allowCreate: true },
          binding: { entityRef: "schedule", titleFieldRef: "eventTitle", startFieldRef: "startAt", endFieldRef: "endAt", statusFieldRef: "eventStatus" },
        },
        extra: {},
      },
  NotificationInbox: {
        block: {
          id: "demo-NotificationInbox", type: "NotificationInbox",
          props: { title: "消息通知", pageSize: 3 },
          binding: { entityRef: "notification", titleFieldRef: "noticeTitle", contentFieldRef: "noticeContent", timeFieldRef: "notifiedAt", categoryFieldRef: "noticeCategory", readFieldRef: "noticeRead" },
        },
        extra: {},
      },
  TreeNavigator: {
        block: {
          id: "demo-TreeNavigator", type: "TreeNavigator",
          props: { title: "门店组织", searchable: true, showLine: true, defaultExpandAll: true },
          binding: { entityRef: "hierarchy", labelFieldRef: "nodeLabel", parentFieldRef: "nodeParent", descFieldRef: "nodeDesc" },
        },
        extra: {},
      },
  ApprovalQueue: {
        block: {
          id: "demo-ApprovalQueue", type: "ApprovalQueue",
          props: { title: "我的审批", pendingValue: "pending", approvedValue: "approved", rejectedValue: "rejected" },
          binding: { entityRef: "approval", titleFieldRef: "approvalTitle", statusFieldRef: "approvalStatus", applicantFieldRef: "applicant", timeFieldRef: "submittedAt", summaryFieldRef: "approvalSummary" },
        },
        extra: {},
      },
  AuditTrail: {
        block: {
          id: "demo-AuditTrail", type: "AuditTrail",
          props: { title: "操作审计", pageSize: 3 },
          binding: { entityRef: "audit", actorFieldRef: "auditActor", actionFieldRef: "auditAction", timeFieldRef: "auditTime", resultFieldRef: "auditResult", fieldNameFieldRef: "changedField", beforeFieldRef: "beforeValue", afterFieldRef: "afterValue" },
        },
        extra: {},
      },
  DataImportWizard: {
        block: {
          id: "demo-DataImportWizard", type: "DataImportWizard",
          props: { title: "导入巡检数据", initialPhase: "mapping", initialFileName: "门店巡检-8月.xlsx" },
          binding: { entityRef: "importMapping", sourceFieldRef: "sourceColumn", targetFieldRef: "targetField", statusFieldRef: "mappingStatus", sampleFieldRef: "sampleValue", issueFieldRef: "mappingIssue" },
        },
        extra: {},
      },
  AsyncTaskMonitor: {
        block: {
          id: "demo-AsyncTaskMonitor", type: "AsyncTaskMonitor",
          props: { title: "后台任务", cancelable: true },
          binding: { entityRef: "asyncTask", titleFieldRef: "taskTitle", statusFieldRef: "taskStatus", progressCurrentFieldRef: "progressCurrent", progressTotalFieldRef: "progressTotal", errorFieldRef: "taskError", resultFieldRef: "taskResult", timeFieldRef: "taskTime" },
        },
        extra: {},
      },
  PermissionMatrix: {
        block: {
          id: "demo-PermissionMatrix", type: "PermissionMatrix",
          props: { title: "角色权限" },
          binding: { entityRef: "permission", resourceFieldRef: "resourceName", viewFieldRef: "canView", createFieldRef: "canCreate", editFieldRef: "canEdit", deleteFieldRef: "canDelete" },
        },
        extra: {},
      },
  DataExportPanel: {
        block: {
          id: "demo-DataExportPanel", type: "DataExportPanel",
          props: { title: "导出门店数据", maxRows: 2000 },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status", "channel", "at"] },
        },
        extra: { selection: { rowIds: { order: ["order-1", "order-2"] } } },
      },
  BulkEditPanel: {
        block: {
          id: "demo-BulkEditPanel", type: "BulkEditPanel",
          props: { title: "批量更新门店" },
          binding: { entityRef: "order", fieldRefs: ["status", "channel", "at"] },
        },
        extra: { selection: { rowIds: { order: ["order-1", "order-2", "order-3"] } } },
      },
  MemberAssignment: {
        block: {
          id: "demo-MemberAssignment", type: "MemberAssignment",
          props: { title: "巡检组成员", memberValue: "member" },
          binding: { entityRef: "member", nameFieldRef: "memberName", accountFieldRef: "memberAccount", avatarFieldRef: "memberAvatar", statusFieldRef: "memberStatus", membershipFieldRef: "membership" },
        },
        extra: {},
      },
  ContextBreadcrumb: {
    block: { id: "demo-ContextBreadcrumb", type: "ContextBreadcrumb", props: { items: ["门店运营", "华东区域", "人民路店"] } }, extra: {},
  },
  LiveRefreshControl: {
    block: { id: "demo-LiveRefreshControl", type: "LiveRefreshControl", props: { title: "数据刷新", intervalMs: 30000 }, binding: { targets: ["orders"] } }, extra: {},
  },
  ActiveFilterSummary: {
    block: { id: "demo-ActiveFilterSummary", type: "ActiveFilterSummary", props: { title: "已应用条件" }, binding: { targets: ["orders"] } },
    extra: { filterState: { enumFilters: { status: "进行中", channel: "门店" }, enumMulti: {}, dateRange: ["2026-08-01", "2026-08-09"] } },
  },
  AnalyticsDateScope: {
    block: { id: "demo-AnalyticsDateScope", type: "AnalyticsDateScope", props: { title: "经营时间口径", defaultPreset: "month" }, binding: { targets: ["metrics", "trend"] } }, extra: {},
  },
  HeaderEntitySummary: {
    block: { id: "demo-HeaderEntitySummary", type: "HeaderEntitySummary", binding: { entityRef: "order", titleFieldRef: "name", fieldRefs: ["status", "channel", "amount"] } }, extra: { focus: { order: "order-1" } },
  },
  HeaderProgressSummary: {
    block: { id: "demo-HeaderProgressSummary", type: "HeaderProgressSummary", binding: { entityRef: "asyncTask", titleFieldRef: "taskTitle", currentFieldRef: "progressCurrent", totalFieldRef: "progressTotal", statusFieldRef: "taskStatus", nextFieldRef: "taskResult" } }, extra: { focus: { asyncTask: "task-1" } },
  },
  WorkspaceTabs: {
    block: { id: "demo-WorkspaceTabs", type: "WorkspaceTabs", binding: { entityRef: "order", titleFieldRef: "name", targets: ["work-content"] } }, extra: {},
  },
  SavedViewTabs: {
    block: { id: "demo-SavedViewTabs", type: "SavedViewTabs", binding: { entityRef: "order", titleFieldRef: "name", presetKeyFieldRef: "status", countFieldRef: "amount", targets: ["orders"] } }, extra: {},
  },
  AdvancedFilterBuilder: {
    block: { id: "demo-AdvancedFilterBuilder", type: "AdvancedFilterBuilder", props: { title: "高级筛选" }, binding: { entityRef: "order", fieldRefs: ["status", "channel", "amount"], targets: ["orders"] } }, extra: {},
  },
  FacetedFilterPanel: {
    block: { id: "demo-FacetedFilterPanel", type: "FacetedFilterPanel", props: { title: "分面筛选" }, binding: { entityRef: "order", fieldRefs: ["status", "channel"], targets: ["orders"] } }, extra: {},
  },
  WizardNavigationBar: {
    block: { id: "demo-WizardNavigationBar", type: "WizardNavigationBar", props: { steps: ["基本信息", "材料确认", "提交审核"], initialStep: 1 }, binding: { targets: ["wizard-form"] } }, extra: {},
  },
  ApprovalDecisionBar: {
    block: { id: "demo-ApprovalDecisionBar", type: "ApprovalDecisionBar", props: { pendingValue: "pending" }, binding: { entityRef: "approval", titleFieldRef: "approvalTitle", statusFieldRef: "approvalStatus", targets: ["approval-detail"] } }, extra: { focus: { approval: "approval-1" } },
  },
  CheckoutSummaryBar: {
    block: { id: "demo-CheckoutSummaryBar", type: "CheckoutSummaryBar", binding: { entityRef: "order", amountFieldRef: "amount", targets: ["order-list"] } }, extra: { selection: { rowIds: { order: ["order-1", "order-2"] } } },
  },
  RecordLifecycleBar: {
    block: { id: "demo-RecordLifecycleBar", type: "RecordLifecycleBar", binding: { entityRef: "order", statusFieldRef: "status", targets: ["record-form"] } }, extra: { focus: { order: "order-1" } },
  },
  WaterfallChart: {
    block: { id: "demo-WaterfallChart", type: "WaterfallChart", props: { title: "渠道周变化" }, binding: { entityRef: "order", categoryFieldRef: "channel", valueFieldRef: "weekDelta" } }, extra: {},
  },
  FunnelChart: {
    block: { id: "demo-FunnelChart", type: "FunnelChart", props: { title: "订单转化", stages: ["访问", "咨询", "下单", "支付"] }, binding: { entityRef: "funnelStage", stageFieldRef: "stageName", valueFieldRef: "stageValue" } }, extra: {},
  },
  DistributionHistogram: {
    block: { id: "demo-DistributionHistogram", type: "DistributionHistogram", props: { title: "订单金额分布", bins: 5 }, binding: { entityRef: "order", valueFieldRef: "amount" } }, extra: {},
  },
  HeatmapMatrix: {
    block: { id: "demo-HeatmapMatrix", type: "HeatmapMatrix", props: { title: "状态 × 渠道" }, binding: { entityRef: "order", xFieldRef: "status", yFieldRef: "channel", valueFieldRef: "amount" } }, extra: {},
  },
  TreemapBreakdown: {
    block: { id: "demo-TreemapBreakdown", type: "TreemapBreakdown", props: { title: "门店金额构成" }, binding: { entityRef: "order", labelFieldRef: "name", valueFieldRef: "amount" } }, extra: {},
  },
  GaugeProgress: {
    block: { id: "demo-GaugeProgress", type: "GaugeProgress", props: { title: "导入任务完成度" }, binding: { entityRef: "asyncTask", currentFieldRef: "progressCurrent", targetFieldRef: "progressTotal" } }, extra: {},
  },
  AlertTriagePanel: {
    block: { id: "demo-AlertTriagePanel", type: "AlertTriagePanel", props: { title: "告警分诊", firingValue: "firing", pendingValue: "pending" }, binding: { entityRef: "alert", titleFieldRef: "alertTitle", stateFieldRef: "alertState", severityFieldRef: "alertSeverity", timeFieldRef: "alertTime", targets: ["alert-silence"] } }, extra: {},
  },
  AlertSilenceForm: {
    block: { id: "demo-AlertSilenceForm", type: "AlertSilenceForm", props: { title: "创建告警静默" }, binding: { entityRef: "alert", titleFieldRef: "alertTitle", labelFieldRef: "alertLabels", targets: ["alert-triage"] } }, extra: { focus: { alert: "alert-1" } },
  },
  AlertRoutingPolicy: {
    block: { id: "demo-AlertRoutingPolicy", type: "AlertRoutingPolicy", props: { title: "告警路由策略" }, binding: { entityRef: "alertPolicy", nameFieldRef: "policyName", parentFieldRef: "policyParent", matcherFieldRef: "policyMatcher", receiverFieldRef: "policyReceiver" } }, extra: {},
  },
  DeletedRecordsRecovery: {
    block: { id: "demo-DeletedRecordsRecovery", type: "DeletedRecordsRecovery", props: { title: "已删除记录" }, binding: { entityRef: "deletedRecord", titleFieldRef: "deletedTitle", deletedAtFieldRef: "deletedAt", deletedByFieldRef: "deletedBy", targets: ["records"] } }, extra: {},
  },
  RevisionHistoryPanel: {
    block: { id: "demo-RevisionHistoryPanel", type: "RevisionHistoryPanel", props: { title: "修订历史" }, binding: { entityRef: "revision", versionFieldRef: "revisionVersion", authorFieldRef: "revisionAuthor", timeFieldRef: "revisionTime", summaryFieldRef: "revisionSummary", currentFieldRef: "revisionCurrent", targets: ["record-detail"] } }, extra: {},
  },
  RecordComparePanel: {
    block: { id: "demo-RecordComparePanel", type: "RecordComparePanel", props: { title: "门店记录对比" }, binding: { entityRef: "order", fieldRefs: ["name", "amount", "status", "channel"], targets: ["orders"] } }, extra: { selection: { rowIds: { order: ["order-1", "order-2"] } } },
  },
  GanttSchedule: {
    block: { id: "demo-GanttSchedule", type: "GanttSchedule", props: { title: "巡检计划排期" }, binding: { entityRef: "projectSchedule", labelFieldRef: "planTitle", startFieldRef: "planStart", endFieldRef: "planEnd", groupFieldRef: "planGroup" } }, extra: {},
  },
  SankeyFlow: {
    block: { id: "demo-SankeyFlow", type: "SankeyFlow", props: { title: "客户转化流向" }, binding: { entityRef: "businessFlow", sourceFieldRef: "flowSource", targetFieldRef: "flowTarget", valueFieldRef: "flowValue" } }, extra: {},
  },
  BoxPlotDistribution: {
    block: { id: "demo-BoxPlotDistribution", type: "BoxPlotDistribution", props: { title: "渠道金额离散度" }, binding: { entityRef: "order", categoryFieldRef: "channel", valueFieldRef: "amount" } }, extra: {},
  },
  RadarComparison: {
    block: { id: "demo-RadarComparison", type: "RadarComparison", props: { title: "门店能力对比" }, binding: { entityRef: "order", nameFieldRef: "name", metricFieldRefs: ["fulfillRate", "healthScore", "starLevel"] } }, extra: {},
  },
  AlertRuleEditor: {
    block: { id: "demo-AlertRuleEditor", type: "AlertRuleEditor", props: { title: "告警规则" }, binding: { entityRef: "alertRule", nameFieldRef: "ruleName", queryFieldRef: "ruleQuery", thresholdFieldRef: "ruleThreshold", severityFieldRef: "ruleSeverity", targets: ["alert-rules"] } }, extra: { focus: { alertRule: "rule-1" } },
  },
  MuteTimingSchedule: {
    block: { id: "demo-MuteTimingSchedule", type: "MuteTimingSchedule", props: { title: "静默时段" }, binding: { entityRef: "muteTiming", nameFieldRef: "muteName", weekdaysFieldRef: "muteWeekdays", startTimeFieldRef: "muteStart", endTimeFieldRef: "muteEnd", timezoneFieldRef: "muteTimezone", targets: ["alert-policies"] } }, extra: {},
  },
  ContactPointManager: {
    block: { id: "demo-ContactPointManager", type: "ContactPointManager", props: { title: "通知联络点" }, binding: { entityRef: "contactPoint", nameFieldRef: "contactName", typeFieldRef: "contactType", addressFieldRef: "contactAddress", statusFieldRef: "contactStatus", targets: ["alert-policies"] } }, extra: {},
  },
  ReferenceManyManager: {
    block: { id: "demo-ReferenceManyManager", type: "ReferenceManyManager", props: { title: "关联巡检成员", linkedValue: "member" }, binding: { entityRef: "member", titleFieldRef: "memberName", relationFieldRef: "membership", targets: ["inspection-detail"] } }, extra: {},
  },
  GlobalSearchPalette: {
    block: { id: "demo-GlobalSearchPalette", type: "GlobalSearchPalette", props: { title: "全局搜索" }, binding: { entityRef: "order", titleFieldRef: "name", categoryFieldRef: "channel", descFieldRef: "remark" } }, extra: {},
  },
  LiveChangeReview: {
    block: { id: "demo-LiveChangeReview", type: "LiveChangeReview", props: { title: "实时变更" }, binding: { entityRef: "liveChange", titleFieldRef: "changeTitle", actionFieldRef: "changeAction", actorFieldRef: "changeActor", timeFieldRef: "changeTime", targets: ["orders"] } }, extra: {},
  },
  AvailabilityPlanner: {
    block: { id: "demo-AvailabilityPlanner", type: "AvailabilityPlanner", props: { title: "接诊可用时间", timezone: "Asia/Shanghai" }, binding: { entityRef: "availability", dayFieldRef: "weekday", startTimeFieldRef: "startTime", endTimeFieldRef: "endTime", enabledFieldRef: "enabled" } }, extra: {},
  },
  BookingSlotPicker: {
    block: { id: "demo-BookingSlotPicker", type: "BookingSlotPicker", props: { title: "选择预约时段" }, binding: { entityRef: "bookingSlot", startFieldRef: "slotStart", endFieldRef: "slotEnd", availableFieldRef: "availability", capacityFieldRef: "capacity", targets: ["booking-form"] } }, extra: {},
  },
  ScheduleConflictResolver: {
    block: { id: "demo-ScheduleConflictResolver", type: "ScheduleConflictResolver", props: { title: "排期冲突" }, binding: { entityRef: "scheduleConflict", titleFieldRef: "scheduleTitle", startFieldRef: "scheduleStart", endFieldRef: "scheduleEnd", resourceFieldRef: "resource", targets: ["schedule-calendar"] } }, extra: {},
  },
  StackTracePanel: {
    block: { id: "demo-StackTracePanel", type: "StackTracePanel", props: { title: "异常堆栈" }, binding: { entityRef: "stackFrame", functionFieldRef: "functionName", fileFieldRef: "fileName", lineFieldRef: "lineNumber", codeFieldRef: "codeContext", inAppFieldRef: "inApp" } }, extra: {},
  },
  EventBreadcrumbTimeline: {
    block: { id: "demo-EventBreadcrumbTimeline", type: "EventBreadcrumbTimeline", props: { title: "错误前事件轨迹" }, binding: { entityRef: "eventBreadcrumb", messageFieldRef: "breadcrumbMessage", categoryFieldRef: "breadcrumbCategory", levelFieldRef: "breadcrumbLevel", timeFieldRef: "breadcrumbTime" } }, extra: {},
  },
  SuspectCommitPanel: {
    block: { id: "demo-SuspectCommitPanel", type: "SuspectCommitPanel", props: { title: "可疑提交" }, binding: { entityRef: "suspectCommit", hashFieldRef: "commitHash", authorFieldRef: "commitAuthor", messageFieldRef: "commitMessage", timeFieldRef: "commitTime", scoreFieldRef: "suspectScore", targets: ["issue-detail"] } }, extra: {},
  },
  ConnectionTimeline: {
    block: { id: "demo-ConnectionTimeline", type: "ConnectionTimeline", props: { title: "连接任务时间线" }, binding: { entityRef: "connectionEvent", typeFieldRef: "connectionType", statusFieldRef: "connectionStatus", timeFieldRef: "connectionTime", summaryFieldRef: "connectionSummary", recordsFieldRef: "connectionRecords", targets: ["connection-jobs"] } }, extra: {},
  },
  SchemaChangeReview: {
    block: { id: "demo-SchemaChangeReview", type: "SchemaChangeReview", props: { title: "Schema 变更审查" }, binding: { entityRef: "schemaChange", streamFieldRef: "streamName", fieldNameFieldRef: "fieldName", changeTypeFieldRef: "changeType", beforeFieldRef: "beforeType", afterFieldRef: "afterType", breakingFieldRef: "breaking", targets: ["connection-schema"] } }, extra: {},
  },
  StreamStatusMonitor: {
    block: { id: "demo-StreamStatusMonitor", type: "StreamStatusMonitor", props: { title: "数据流状态" }, binding: { entityRef: "streamStatus", nameFieldRef: "streamName", statusFieldRef: "streamStatus", lastSyncFieldRef: "lastSyncAt", freshnessFieldRef: "freshness", recordsFieldRef: "recordCount", errorFieldRef: "streamError", targets: ["connection-streams"] } }, extra: {},
  },
  ConnectionMappingPanel: {
    block: { id: "demo-ConnectionMappingPanel", type: "ConnectionMappingPanel", props: { title: "字段映射" }, binding: { entityRef: "connectionMapping", sourceFieldRef: "sourceField", targetFieldRef: "targetField", transformFieldRef: "transformType", statusFieldRef: "mappingStatus", targets: ["connection-mappings"] } }, extra: {},
  },
  IssueCommandHeader: {
    block: { id: "demo-IssueCommandHeader", type: "IssueCommandHeader", props: { surface: "plain" }, binding: { entityRef: "issueCommand", titleFieldRef: "issueTitle", statusFieldRef: "issueStatus", priorityFieldRef: "issuePriority", assigneeFieldRef: "issueAssignee", targets: ["issue-detail"] } }, extra: { focus: { issueCommand: "issue-1" } },
  },
  ConnectionControlHeader: {
    block: { id: "demo-ConnectionControlHeader", type: "ConnectionControlHeader", props: { surface: "plain" }, binding: { entityRef: "connectionControl", titleFieldRef: "connectionName", statusFieldRef: "connectionStatus", syncStatusFieldRef: "syncStatus", scheduleFieldRef: "scheduleLabel", breakingFieldRef: "hasBreakingChange", targets: ["connection-status"] } }, extra: { focus: { connectionControl: "control-1" } },
  },
  EventUserCountMetrics: {
    block: { id: "demo-EventUserCountMetrics", type: "EventUserCountMetrics", props: { title: "问题影响", periodLabel: "30 天" }, binding: { entityRef: "issueMetrics", eventCountFieldRef: "eventCount", userCountFieldRef: "userCount" } }, extra: {},
  },
  JobRunMetrics: {
    block: { id: "demo-JobRunMetrics", type: "JobRunMetrics", props: { title: "最近运行" }, binding: { entityRef: "jobMetrics", bytesFieldRef: "bytesLoaded", recordsFieldRef: "recordsLoaded", rejectedFieldRef: "recordsRejected", durationFieldRef: "runDuration", attemptsFieldRef: "attemptsCount" } }, extra: {},
  },
  OccurrenceEvidenceSummary: {
    block: { id: "demo-OccurrenceEvidenceSummary", type: "OccurrenceEvidenceSummary", props: { title: "发生摘要" }, binding: { entityRef: "occurrenceEvidence", environmentFieldRef: "environment", statusCodeFieldRef: "httpStatus", reasonFieldRef: "failureReason", lastSuccessFieldRef: "lastSuccessfulAt", downtimeFieldRef: "downtime" } }, extra: {},
  },
  ConnectionRouteSummary: {
    block: { id: "demo-ConnectionRouteSummary", type: "ConnectionRouteSummary", props: { title: "连接路径" }, binding: { entityRef: "connectionRoute", sourceFieldRef: "sourceConnector", targetFieldRef: "targetConnector", sourceVersionFieldRef: "sourceVersion", targetVersionFieldRef: "targetVersion", statusFieldRef: "routeStatus" } }, extra: {},
  },
  InspectorModeTabs: {
    block: { id: "demo-InspectorModeTabs", type: "InspectorModeTabs", props: { surface: "plain" }, binding: { entityRef: "inspectorMode", titleFieldRef: "modeTitle", keyFieldRef: "modeKey", enabledFieldRef: "modeEnabled", issueCountFieldRef: "issueCount", targets: ["inspector-content"] } }, extra: {},
  },
  IssueEventFilter: {
    block: { id: "demo-IssueEventFilter", type: "IssueEventFilter", props: { title: "问题事件筛选" }, binding: { entityRef: "issueEvent", environmentFieldRef: "eventEnvironment", targets: ["issue-events"] } }, extra: {},
  },
  TimelineFilterBar: {
    block: { id: "demo-TimelineFilterBar", type: "TimelineFilterBar", props: { title: "连接时间线筛选" }, binding: { entityRef: "connectionEvent", typeFieldRef: "connectionType", statusFieldRef: "connectionStatus", timeFieldRef: "connectionTime", targets: ["connection-timeline"] } }, extra: {},
  },
  UnsavedChangesBar: {
    block: { id: "demo-UnsavedChangesBar", type: "UnsavedChangesBar", props: { surface: "plain" }, binding: { entityRef: "dirtyField", fieldNameFieldRef: "changedField", validFieldRef: "changeValid", targets: ["connection-form"] } }, extra: {},
  },
  RunningJobControlBar: {
    block: { id: "demo-RunningJobControlBar", type: "RunningJobControlBar", props: { surface: "plain" }, binding: { entityRef: "runningJob", titleFieldRef: "jobTitle", statusFieldRef: "jobStatus", progressFieldRef: "jobProgress", typeFieldRef: "jobType", targets: ["connection-jobs"] } }, extra: { focus: { runningJob: "running-job-1" } },
  },
  BookingCommandHeader: {
    block: { id: "demo-BookingCommandHeader", type: "BookingCommandHeader", props: { surface: "plain" }, binding: { entityRef: "bookingCommand", titleFieldRef: "bookingTitle", statusFieldRef: "bookingStatus", startFieldRef: "bookingStart", endFieldRef: "bookingEnd", locationFieldRef: "bookingLocation", recurringFieldRef: "bookingRecurring", paidFieldRef: "bookingPaid", targets: ["booking-detail"] } }, extra: { focus: { bookingCommand: "booking-command-1" } },
  },
  AlertRuleCommandHeader: {
    block: { id: "demo-AlertRuleCommandHeader", type: "AlertRuleCommandHeader", props: { surface: "plain" }, binding: { entityRef: "alertRuleCommand", titleFieldRef: "alertRuleTitle", stateFieldRef: "alertRuleState", editableFieldRef: "alertRuleEditable", provisionedFieldRef: "alertRuleProvisioned", silenceableFieldRef: "alertRuleSilenceable", targets: ["alert-rules"] } }, extra: { focus: { alertRuleCommand: "alert-rule-command-1" } },
  },
  AlertStateMetrics: {
    block: { id: "demo-AlertStateMetrics", type: "AlertStateMetrics", props: { title: "告警状态" }, binding: { entityRef: "alertInstanceMetric", stateFieldRef: "alertState", ruleIdFieldRef: "ruleUid" } }, extra: {},
  },
  BookingCapacityMetrics: {
    block: { id: "demo-BookingCapacityMetrics", type: "BookingCapacityMetrics", props: { title: "义诊场次容量" }, binding: { entityRef: "bookingCapacity", capacityFieldRef: "totalCapacity", bookedFieldRef: "bookedSeats", noShowFieldRef: "noShowCount", waitlistFieldRef: "waitlistCount" } }, extra: {},
  },
  BookingContextSummary: {
    block: { id: "demo-BookingContextSummary", type: "BookingContextSummary", props: { title: "预约上下文" }, binding: { entityRef: "bookingCommand", titleFieldRef: "bookingTitle", startFieldRef: "bookingStart", endFieldRef: "bookingEnd", timezoneFieldRef: "bookingTimezone", locationFieldRef: "bookingLocation", attendeeFieldRef: "bookingAttendee", recurringFieldRef: "bookingRecurring" } }, extra: {},
  },
  AlertInstanceSummary: {
    block: { id: "demo-AlertInstanceSummary", type: "AlertInstanceSummary", props: { title: "告警实例" }, binding: { entityRef: "alertInstanceMetric", nameFieldRef: "instanceName", valueFieldRef: "instanceValue", labelsFieldRef: "instanceLabels", summaryFieldRef: "instanceSummary", startedFieldRef: "instanceStarted" } }, extra: { focus: { alertInstanceMetric: "instance-1" } },
  },
  BookingStatusTabs: {
    block: { id: "demo-BookingStatusTabs", type: "BookingStatusTabs", props: { surface: "plain", defaultKey: "upcoming" }, binding: { entityRef: "bookingStatus", titleFieldRef: "tabTitle", keyFieldRef: "tabKey", countFieldRef: "tabCount", enabledFieldRef: "tabEnabled", targets: ["booking-list"] } }, extra: {},
  },
  ValidatedFormTabs: {
    block: { id: "demo-ValidatedFormTabs", type: "ValidatedFormTabs", props: { surface: "plain" }, binding: { entityRef: "validatedFormTab", titleFieldRef: "formTabTitle", keyFieldRef: "formTabKey", errorCountFieldRef: "formTabErrors", dirtyCountFieldRef: "formTabDirty", targets: ["booking-form"] } }, extra: {},
  },
  AlertMatcherFilter: {
    block: { id: "demo-AlertMatcherFilter", type: "AlertMatcherFilter", props: { title: "告警标签匹配", defaultQuery: "severity=\"critical\",instance=~\"payment-.+\"" }, binding: { targets: ["alert-list"] } }, extra: {},
  },
  BookingDirectoryFilter: {
    block: { id: "demo-BookingDirectoryFilter", type: "BookingDirectoryFilter", props: { title: "预约目录筛选" }, binding: { entityRef: "bookingFilterOption", typeFieldRef: "optionType", keyFieldRef: "optionKey", titleFieldRef: "optionTitle", targets: ["booking-list"] } }, extra: {},
  },
  BookingDecisionBar: {
    block: { id: "demo-BookingDecisionBar", type: "BookingDecisionBar", props: { surface: "plain" }, binding: { entityRef: "bookingCommand", titleFieldRef: "bookingTitle", statusFieldRef: "bookingStatus", paidFieldRef: "bookingPaid", recurringFieldRef: "bookingRecurring", targets: ["booking-detail"] } }, extra: { focus: { bookingCommand: "booking-command-1" } },
  },
  DashboardSaveBar: {
    block: { id: "demo-DashboardSaveBar", type: "DashboardSaveBar", props: { surface: "plain" }, binding: { entityRef: "dashboardSave", titleFieldRef: "dashboardTitle", dirtyFieldRef: "dashboardDirty", canSaveFieldRef: "dashboardCanSave", managedFieldRef: "dashboardManaged", templateFieldRef: "dashboardTemplate", targets: ["dashboard"] } }, extra: { focus: { dashboardSave: "dashboard-save-1" } },
  },
  WorkItemCommandHeader: {
    block: { id: "demo-WorkItemCommandHeader", type: "WorkItemCommandHeader", props: { surface: "plain" }, binding: { entityRef: "workItem", titleFieldRef: "workTitle", statusFieldRef: "workStatus", priorityFieldRef: "workPriority", assigneeFieldRef: "workAssignee", targets: ["work-item-detail"] } }, extra: { focus: { workItem: "work-1" } },
  },
  DocumentCommandHeader: {
    block: { id: "demo-DocumentCommandHeader", type: "DocumentCommandHeader", props: { surface: "plain" }, binding: { entityRef: "document", titleFieldRef: "documentTitle", stateFieldRef: "documentState", permissionFieldRef: "documentPermission", revisionFieldRef: "documentRevision", targets: ["document-editor"] } }, extra: { focus: { document: "doc-1" } },
  },
  EnvironmentStatusStrip: {
    block: { id: "demo-EnvironmentStatusStrip", type: "EnvironmentStatusStrip", props: { title: "部署环境" }, binding: { entityRef: "environmentStatus", nameFieldRef: "environmentName", statusFieldRef: "environmentStatus" } }, extra: {},
  },
  DataFreshnessIndicator: {
    block: { id: "demo-DataFreshnessIndicator", type: "DataFreshnessIndicator", props: { surface: "plain" }, binding: { entityRef: "dataFreshness", sourceFieldRef: "dataSourceName", updatedAtFieldRef: "dataUpdatedAt", statusFieldRef: "freshnessStatus", targets: ["dashboard"] } }, extra: {},
  },
  WorkItemContextSummary: {
    block: { id: "demo-WorkItemContextSummary", type: "WorkItemContextSummary", props: { surface: "plain" }, binding: { entityRef: "workItem", titleFieldRef: "workTitle", fieldRefs: ["workProject", "workCycle", "workDue", "workLabels"] } }, extra: { focus: { workItem: "work-1" } },
  },
  DashboardParameterBar: {
    block: { id: "demo-DashboardParameterBar", type: "DashboardParameterBar", props: { title: "经营看板参数" }, binding: { entityRef: "dashboardParameter", titleFieldRef: "parameterTitle", keyFieldRef: "parameterKey", valueFieldRef: "parameterValue", requiredFieldRef: "parameterRequired", targets: ["dashboard"] } }, extra: {},
  },
  CycleHealthMetrics: {
    block: { id: "demo-CycleHealthMetrics", type: "CycleHealthMetrics", props: { title: "八月迭代健康度" }, binding: { entityRef: "cycleHealth", completedFieldRef: "cycleCompleted", totalFieldRef: "cycleTotal", overdueFieldRef: "cycleOverdue", unstartedFieldRef: "cycleUnstarted" } }, extra: {},
  },
  QueryExecutionMetrics: {
    block: { id: "demo-QueryExecutionMetrics", type: "QueryExecutionMetrics", props: { title: "查询执行" }, binding: { entityRef: "queryExecution", timeFieldRef: "queryTimeMs", rowsFieldRef: "queryRows", cachedFieldRef: "queryCached", bytesFieldRef: "queryBytes" } }, extra: {},
  },
  BulkSelectionBar: {
    block: { id: "demo-BulkSelectionBar", type: "BulkSelectionBar", props: { surface: "plain" }, binding: { entityRef: "workItem", targets: ["work-item-list"] } }, extra: { selection: { rowIds: { workItem: ["work-1"] } } },
  },
  DraftPublishBar: {
    block: { id: "demo-DraftPublishBar", type: "DraftPublishBar", props: { surface: "plain" }, binding: { entityRef: "document", titleFieldRef: "documentTitle", stateFieldRef: "documentState", dirtyFieldRef: "documentDirty", canPublishFieldRef: "documentPermission", locationFieldRef: "documentLocation", targets: ["document-editor"] } }, extra: { focus: { document: "doc-1" } },
  },
  QuestionCommandHeader: {
    block: { id: "demo-QuestionCommandHeader", type: "QuestionCommandHeader", props: { surface: "plain" }, binding: { entityRef: "questionState", titleFieldRef: "questionTitle", savedFieldRef: "questionSaved", dirtyFieldRef: "questionDirty", bookmarkFieldRef: "questionBookmarked", targets: ["query-content"] } }, extra: { focus: { questionState: "question-1" } },
  },
  CatalogEntityCommandHeader: {
    block: { id: "demo-CatalogEntityCommandHeader", type: "CatalogEntityCommandHeader", props: { surface: "plain" }, binding: { entityRef: "catalogEntity", titleFieldRef: "catalogTitle", kindFieldRef: "catalogKind", typeFieldRef: "catalogType", starredFieldRef: "catalogStarred", targets: ["catalog-detail"] } }, extra: { focus: { catalogEntity: "catalog-1" } },
  },
  CollaboratorPresenceStrip: {
    block: { id: "demo-CollaboratorPresenceStrip", type: "CollaboratorPresenceStrip", props: { surface: "plain" }, binding: { entityRef: "collaborator", nameFieldRef: "collaboratorName", presentFieldRef: "collaboratorPresent", editingFieldRef: "collaboratorEditing" } }, extra: {},
  },
  QueryRunStatusStrip: {
    block: { id: "demo-QueryRunStatusStrip", type: "QueryRunStatusStrip", props: { surface: "plain" }, binding: { entityRef: "questionState", statusFieldRef: "queryStatus", timeFieldRef: "queryTime", cachedFieldRef: "queryCached", targets: ["query-content"] } }, extra: {},
  },
  EntityOwnershipSummary: {
    block: { id: "demo-EntityOwnershipSummary", type: "EntityOwnershipSummary", props: { surface: "plain" }, binding: { entityRef: "catalogEntity", titleFieldRef: "catalogTitle", ownerFieldRef: "catalogOwner", lifecycleFieldRef: "catalogLifecycle", systemFieldRef: "catalogSystem", domainFieldRef: "catalogDomain" } }, extra: { focus: { catalogEntity: "catalog-1" } },
  },
  QueryDataSourceSummary: {
    block: { id: "demo-QueryDataSourceSummary", type: "QueryDataSourceSummary", props: { surface: "plain", title: "数据来源" }, binding: { entityRef: "querySource", databaseFieldRef: "sourceDatabase", schemaFieldRef: "sourceSchema", sourceFieldRef: "sourceName", typeFieldRef: "sourceType" } }, extra: {},
  },
  QueryClauseFilterBar: {
    block: { id: "demo-QueryClauseFilterBar", type: "QueryClauseFilterBar", props: { title: "查询条件" }, binding: { entityRef: "queryClause", fieldFieldRef: "queryField", operatorFieldRef: "queryOperator", valueFieldRef: "queryValue", enabledFieldRef: "queryClauseEnabled", targets: ["query-content"] } }, extra: {},
  },
  MetadataQualityMetrics: {
    block: { id: "demo-MetadataQualityMetrics", type: "MetadataQualityMetrics", props: { title: "元数据质量" }, binding: { entityRef: "metadataQuality", totalFieldRef: "metadataTotal", documentedFieldRef: "metadataDocumented", typedFieldRef: "metadataTyped" } }, extra: {},
  },
  QuestionExecutionBar: {
    block: { id: "demo-QuestionExecutionBar", type: "QuestionExecutionBar", props: { surface: "plain" }, binding: { entityRef: "questionState", statusFieldRef: "queryStatus", runnableFieldRef: "queryRunnable", dirtyFieldRef: "questionDirty", targets: ["query-content"] } }, extra: {},
  },
  CycleCommandHeader: {
    block: { id: "demo-CycleCommandHeader", type: "CycleCommandHeader", props: { surface: "plain" }, binding: { entityRef: "cycleManagement", titleFieldRef: "cycleTitle", statusFieldRef: "cycleStatus", editableFieldRef: "cycleEditable", targets: ["cycle-detail"] } }, extra: { focus: { cycleManagement: "cycle-manage-1" } },
  },
  AlertGroupCommandHeader: {
    block: { id: "demo-AlertGroupCommandHeader", type: "AlertGroupCommandHeader", props: { surface: "plain" }, binding: { entityRef: "alertGroup", titleFieldRef: "alertGroupTitle", statusFieldRef: "alertGroupStatus", editableFieldRef: "alertGroupEditable", intervalFieldRef: "alertGroupInterval", targets: ["alert-group"] } }, extra: { focus: { alertGroup: "alert-group-1" } },
  },
  IncidentOwnershipStrip: {
    block: { id: "demo-IncidentOwnershipStrip", type: "IncidentOwnershipStrip", props: { surface: "plain" }, binding: { entityRef: "incidentOwnership", assigneeFieldRef: "incidentAssignee", sourceFieldRef: "assignmentSource", suggestedFieldRef: "suggestedOwner", targets: ["issue-detail"] } }, extra: { focus: { incidentOwnership: "ownership-1" } },
  },
  SyncScheduleStrip: {
    block: { id: "demo-SyncScheduleStrip", type: "SyncScheduleStrip", props: { surface: "plain" }, binding: { entityRef: "syncSchedule", frequencyFieldRef: "syncFrequency", nextRunFieldRef: "syncNextRun", timezoneFieldRef: "syncTimezone", statusFieldRef: "syncScheduleStatus", targets: ["connection-settings"] } }, extra: {},
  },
  CycleFilterBar: {
    block: { id: "demo-CycleFilterBar", type: "CycleFilterBar", props: { title: "周期筛选" }, binding: { entityRef: "cycleFilterOption", typeFieldRef: "cycleFilterType", keyFieldRef: "cycleFilterKey", titleFieldRef: "cycleFilterTitle", targets: ["cycle-list"] } }, extra: {},
  },
  AlertRuleFilterBar: {
    block: { id: "demo-AlertRuleFilterBar", type: "AlertRuleFilterBar", props: { title: "规则筛选", defaultQuery: "state:firing label:team=payment", defaultView: "grouped" }, binding: { targets: ["alert-rule-list"] } }, extra: {},
  },
  SyncReliabilityMetrics: {
    block: { id: "demo-SyncReliabilityMetrics", type: "SyncReliabilityMetrics", props: { title: "同步可靠性" }, binding: { entityRef: "syncReliability", successFieldRef: "syncSuccessRuns", failedFieldRef: "syncFailedRuns", recordsFieldRef: "syncRecordCount", freshnessFieldRef: "syncFreshness" } }, extra: {},
  },
  RuleEvaluationMetrics: {
    block: { id: "demo-RuleEvaluationMetrics", type: "RuleEvaluationMetrics", props: { title: "规则评估" }, binding: { entityRef: "ruleEvaluation", activeFieldRef: "evaluationActive", pausedFieldRef: "evaluationPaused", errorFieldRef: "evaluationErrors", durationFieldRef: "evaluationDuration" } }, extra: {},
  },
  EventTypePublishBar: {
    block: { id: "demo-EventTypePublishBar", type: "EventTypePublishBar", props: { surface: "plain" }, binding: { entityRef: "eventTypeState", titleFieldRef: "eventTypeTitle", hiddenFieldRef: "eventTypeHidden", dirtyFieldRef: "eventTypeDirty", validFieldRef: "eventTypeValid", targets: ["event-type-editor"] } }, extra: { focus: { eventTypeState: "event-type-1" } },
  },
  ConversationCommandHeader: {
    block: { id: "demo-ConversationCommandHeader", type: "ConversationCommandHeader", props: { surface: "plain" }, binding: { entityRef: "supportConversation", titleFieldRef: "contactName", statusFieldRef: "conversationStatus", verifiedFieldRef: "sessionVerified", inboxFieldRef: "inboxName", targets: ["conversation"] } }, extra: { focus: { supportConversation: "conv-1842" } },
  },
  UserCommandHeader: {
    block: { id: "demo-UserCommandHeader", type: "UserCommandHeader", props: { surface: "plain" }, binding: { entityRef: "identityUser", usernameFieldRef: "identityUsername", enabledFieldRef: "identityEnabled", impersonateFieldRef: "impersonateAllowed", targets: ["user-detail"] } }, extra: { focus: { identityUser: "user-1" } },
  },
  ConversationAssignmentStrip: {
    block: { id: "demo-ConversationAssignmentStrip", type: "ConversationAssignmentStrip", props: { surface: "plain" }, binding: { entityRef: "supportConversation", assigneeFieldRef: "assignedAgent", teamFieldRef: "assignedTeam", priorityFieldRef: "conversationPriority", targets: ["conversation"] } }, extra: { focus: { supportConversation: "conv-1842" } },
  },
  RealmStatusStrip: {
    block: { id: "demo-RealmStatusStrip", type: "RealmStatusStrip", props: { surface: "plain" }, binding: { entityRef: "realmStatus", nameFieldRef: "realmName", enabledFieldRef: "realmEnabled", bruteForceFieldRef: "bruteForceProtection", sslFieldRef: "sslRequired", targets: ["realm-settings"] } }, extra: {},
  },
  UserDirectoryFilter: {
    block: { id: "demo-UserDirectoryFilter", type: "UserDirectoryFilter", props: { title: "用户目录筛选", defaultMode: "default" }, binding: { targets: ["user-list"] } }, extra: {},
  },
  ConversationSlaMetrics: {
    block: { id: "demo-ConversationSlaMetrics", type: "ConversationSlaMetrics", props: { title: "客服 SLA" }, binding: { entityRef: "conversationSla", firstResponseFieldRef: "slaFirstResponse", resolutionFieldRef: "slaResolution", breachFieldRef: "slaBreaches", countFieldRef: "slaConversationCount" } }, extra: {},
  },
  ConversationReplyBar: {
    block: { id: "demo-ConversationReplyBar", type: "ConversationReplyBar", props: { surface: "plain" }, binding: { entityRef: "supportConversation", statusFieldRef: "conversationStatus", channelFieldRef: "conversationChannel", targets: ["conversation-messages"] } }, extra: { focus: { supportConversation: "conv-1842" } },
  },
  UserAccessBar: {
    block: { id: "demo-UserAccessBar", type: "UserAccessBar", props: { surface: "plain" }, binding: { entityRef: "identityUser", usernameFieldRef: "identityUsername", enabledFieldRef: "identityEnabled", sessionsFieldRef: "activeSessions", manageableFieldRef: "manageableUser", targets: ["user-detail"] } }, extra: { focus: { identityUser: "user-1" } },
  },
  TimeSeriesAnomalyChart: {
    block: { id: "demo-TimeSeriesAnomalyChart", type: "TimeSeriesAnomalyChart", props: { title: "订单量异常" }, binding: { entityRef: "analysisWindow", timeFieldRef: "windowTime", valueFieldRef: "observedValue", lowerFieldRef: "expectedLow", upperFieldRef: "expectedHigh", anomalyFieldRef: "anomalyState" } }, extra: {},
  },
  CohortRetentionChart: {
    block: { id: "demo-CohortRetentionChart", type: "CohortRetentionChart", props: { title: "用户留存队列" }, binding: { entityRef: "analysisWindow", cohortFieldRef: "cohortName", periodFieldRef: "cohortPeriod", rateFieldRef: "retentionRate" } }, extra: {},
  },
  UptimeStatusTimeline: {
    block: { id: "demo-UptimeStatusTimeline", type: "UptimeStatusTimeline", props: { title: "连接可用性" }, binding: { entityRef: "analysisWindow", timeFieldRef: "windowTime", statusFieldRef: "uptimeStatus" } }, extra: {},
  },
  PercentileBandChart: {
    block: { id: "demo-PercentileBandChart", type: "PercentileBandChart", props: { title: "接口延迟分位" }, binding: { entityRef: "analysisWindow", timeFieldRef: "windowTime", p50FieldRef: "latencyP50", p95FieldRef: "latencyP95", p99FieldRef: "latencyP99" } }, extra: {},
  },
  ConnectionFleetMetrics: {
    block: { id: "demo-ConnectionFleetMetrics", type: "ConnectionFleetMetrics", props: { title: "连接状态" }, binding: { entityRef: "connectionFleet", statusFieldRef: "fleetStatus", targets: ["connection-list"] } }, extra: {},
  },
  IssueImpactMetrics: {
    block: { id: "demo-IssueImpactMetrics", type: "IssueImpactMetrics", props: { title: "问题影响" }, binding: { entityRef: "issueImpact", eventCountFieldRef: "impactEvents", userCountFieldRef: "impactUsers", firstSeenFieldRef: "impactFirstSeen", lastSeenFieldRef: "impactLastSeen" } }, extra: {},
  },
  ReleaseHealthStrip: {
    block: { id: "demo-ReleaseHealthStrip", type: "ReleaseHealthStrip", binding: { entityRef: "releaseHealth", versionFieldRef: "releaseVersion", healthFieldRef: "releaseCrashFree", environmentFieldRef: "releaseEnvironment", adoptionFieldRef: "releaseAdoption" } }, extra: {},
  },
  DashboardCommandHeader: {
    block: { id: "demo-DashboardCommandHeader", type: "DashboardCommandHeader", binding: { entityRef: "dashboardContext", titleFieldRef: "dashboardTitle", starredFieldRef: "dashboardStarred", subscribedFieldRef: "dashboardSubscribed", editableFieldRef: "dashboardEditable", targets: ["dashboard"] } }, extra: { focus: { dashboardContext: "dashboard-sales" } },
  },
  DeploymentLatencyChart: {
    block: { id: "demo-DeploymentLatencyChart", type: "DeploymentLatencyChart", props: { title: "部署阶段耗时" }, binding: { entityRef: "deploymentSeries", timeFieldRef: "deployTime", queueFieldRef: "queueSeconds", pullFieldRef: "pullSeconds", startFieldRef: "startSeconds", readyFieldRef: "readySeconds" } }, extra: {},
  },
  ReleaseAdoptionTrendChart: {
    block: { id: "demo-ReleaseAdoptionTrendChart", type: "ReleaseAdoptionTrendChart", props: { title: "发布采用趋势" }, binding: { entityRef: "releaseSeries", timeFieldRef: "releaseTime", adoptionFieldRef: "releaseAdoptionTrend", healthFieldRef: "releaseHealthTrend" } }, extra: {},
  },
  DeploymentRolloutMetrics: {
    block: { id: "demo-DeploymentRolloutMetrics", type: "DeploymentRolloutMetrics", props: { title: "部署滚动状态" }, binding: { entityRef: "deploymentWorkload", desiredFieldRef: "desiredReplicas", readyFieldRef: "readyReplicas", availableFieldRef: "availableReplicas", unavailableFieldRef: "unavailableReplicas" } }, extra: {},
  },
  ReleaseAdoptionMetrics: {
    block: { id: "demo-ReleaseAdoptionMetrics", type: "ReleaseAdoptionMetrics", props: { title: "发布采用" }, binding: { entityRef: "releaseState", adoptionFieldRef: "releaseAdoption", healthFieldRef: "releaseHealth", eventCountFieldRef: "releaseEvents", userCountFieldRef: "releaseUsers" } }, extra: {},
  },
  ClusterHealthStrip: {
    block: { id: "demo-ClusterHealthStrip", type: "ClusterHealthStrip", binding: { entityRef: "clusterHealth", nameFieldRef: "clusterName", statusFieldRef: "clusterStatus", nodeCountFieldRef: "clusterNodes", versionFieldRef: "clusterVersion" } }, extra: {},
  },
  ReleaseEnvironmentStrip: {
    block: { id: "demo-ReleaseEnvironmentStrip", type: "ReleaseEnvironmentStrip", binding: { entityRef: "releaseState", versionFieldRef: "releaseTitle", environmentFieldRef: "releaseEnvironment", statusFieldRef: "releaseStatus", targets: ["release-list"] } }, extra: {},
  },
  DeploymentCommandHeader: {
    block: { id: "demo-DeploymentCommandHeader", type: "DeploymentCommandHeader", binding: { entityRef: "deploymentWorkload", titleFieldRef: "workloadTitle", statusFieldRef: "workloadStatus", editableFieldRef: "workloadEditable", targets: ["deployment"] } }, extra: { focus: { deploymentWorkload: "deployment-order-api" } },
  },
  FeatureFlagCommandHeader: {
    block: { id: "demo-FeatureFlagCommandHeader", type: "FeatureFlagCommandHeader", binding: { entityRef: "featureFlag", titleFieldRef: "flagTitle", enabledFieldRef: "flagEnabled", rolloutFieldRef: "flagRollout", editableFieldRef: "flagEditable", targets: ["feature-flag"] } }, extra: { focus: { featureFlag: "flag-new-checkout" } },
  },
  DeploymentScaleBar: {
    block: { id: "demo-DeploymentScaleBar", type: "DeploymentScaleBar", binding: { entityRef: "deploymentWorkload", desiredFieldRef: "desiredReplicas", readyFieldRef: "readyReplicas", editableFieldRef: "workloadEditable", targets: ["deployment"] } }, extra: { focus: { deploymentWorkload: "deployment-order-api" } },
  },
  ReleaseRolloutBar: {
    block: { id: "demo-ReleaseRolloutBar", type: "ReleaseRolloutBar", binding: { entityRef: "releaseState", statusFieldRef: "releaseStatus", adoptionFieldRef: "releaseAdoption", healthFieldRef: "releaseHealth", targets: ["release"] } }, extra: { focus: { releaseState: "release-main" } },
  },
  CumulativeFlowChart: {
    block: { id: "demo-CumulativeFlowChart", type: "CumulativeFlowChart", props: { title: "周期累计流" }, binding: { entityRef: "flowSnapshot", timeFieldRef: "flowTime", stateFieldRef: "flowState", valueFieldRef: "flowCount" } }, extra: {},
  },
  BookingDemandChart: {
    block: { id: "demo-BookingDemandChart", type: "BookingDemandChart", props: { title: "本周预约需求" }, binding: { entityRef: "bookingDemand", timeFieldRef: "demandTime", availableFieldRef: "availableSlots", bookedFieldRef: "bookedSlots", canceledFieldRef: "canceledSlots" } }, extra: {},
  },
  CycleRiskStrip: {
    block: { id: "demo-CycleRiskStrip", type: "CycleRiskStrip", binding: { entityRef: "cycleRisk", titleFieldRef: "riskTitle", remainingFieldRef: "riskRemaining", blockedFieldRef: "riskBlocked", overdueFieldRef: "riskOverdue" } }, extra: {},
  },
  WorkItemMoveDrawer: {
    block: { id: "demo-WorkItemMoveDrawer", type: "WorkItemMoveDrawer", binding: { entityRef: "movableWorkItem", titleFieldRef: "moveTitle", groupFieldRef: "moveGroup", targets: ["work-item"] } }, extra: { focus: { movableWorkItem: "move-item-1" } },
  },
  BookingConflictDrawer: {
    block: { id: "demo-BookingConflictDrawer", type: "BookingConflictDrawer", binding: { entityRef: "bookingConflict", titleFieldRef: "conflictTitle", startFieldRef: "conflictStart", endFieldRef: "conflictEnd", severityFieldRef: "conflictSeverity", targets: ["booking"] } }, extra: {},
  },
  WorkflowDurationChart: {
    block: { id: "demo-WorkflowDurationChart", type: "WorkflowDurationChart", props: { title: "工作流执行耗时" }, binding: { entityRef: "workflowDuration", timeFieldRef: "workflowTime", averageFieldRef: "workflowAverage", p95FieldRef: "workflowP95", failedFieldRef: "workflowFailedDuration" } }, extra: {},
  },
  WorkflowOutcomeMetrics: {
    block: { id: "demo-WorkflowOutcomeMetrics", type: "WorkflowOutcomeMetrics", props: { title: "执行结果" }, binding: { entityRef: "workflowOutcome", successFieldRef: "outcomeSuccess", failedFieldRef: "outcomeFailed", runningFieldRef: "outcomeRunning", pendingFieldRef: "outcomePending" } }, extra: {},
  },
  WorkflowVersionStrip: {
    block: { id: "demo-WorkflowVersionStrip", type: "WorkflowVersionStrip", binding: { entityRef: "workflowDefinition", nameFieldRef: "workflowName", versionFieldRef: "workflowVersion", enabledFieldRef: "workflowEnabled", updatedAtFieldRef: "workflowUpdated" } }, extra: {},
  },
  WorkflowFailureDrawer: {
    block: { id: "demo-WorkflowFailureDrawer", type: "WorkflowFailureDrawer", binding: { entityRef: "workflowFailure", nodeFieldRef: "failureNode", messageFieldRef: "failureMessage", statusFieldRef: "failureStatus", timeFieldRef: "failureTime", targets: ["workflow-execution"] } }, extra: {},
  },
  WorkflowCommandHeader: {
    block: { id: "demo-WorkflowCommandHeader", type: "WorkflowCommandHeader", binding: { entityRef: "workflowDefinition", titleFieldRef: "workflowTitle", enabledFieldRef: "workflowEnabled", versionFieldRef: "workflowVersion", editableFieldRef: "workflowEditable", targets: ["workflow"] } }, extra: { focus: { workflowDefinition: "workflow-order" } },
  },
  WorkflowControlBar: {
    block: { id: "demo-WorkflowControlBar", type: "WorkflowControlBar", binding: { entityRef: "workflowExecution", statusFieldRef: "executionStatus", progressFieldRef: "executionProgress", targets: ["workflow-execution"] } }, extra: { focus: { workflowExecution: "execution-running-1" } },
  },
  RealmCommandHeader: {
    block: { id: "demo-RealmCommandHeader", type: "RealmCommandHeader", binding: { entityRef: "realmSecurity", nameFieldRef: "realmSecurityName", enabledFieldRef: "realmSecurityEnabled", manageableFieldRef: "realmManageable", targets: ["realm"] } }, extra: { focus: { realmSecurity: "realm-security-1" } },
  },
  CredentialLifecycleBar: {
    block: { id: "demo-CredentialLifecycleBar", type: "CredentialLifecycleBar", binding: { entityRef: "credentialState", usernameFieldRef: "credentialUsername", resettableFieldRef: "credentialResettable", temporaryFieldRef: "credentialTemporary", updatedAtFieldRef: "credentialUpdated", targets: ["user-credentials"] } }, extra: { focus: { credentialState: "credential-user-1" } },
  },
  PanelQueryLatencyChart: { block: { id: "demo-PanelQueryLatencyChart", type: "PanelQueryLatencyChart", props: { title: "面板查询延迟" }, binding: { entityRef: "observabilityTrend", timeFieldRef: "obsTime", averageFieldRef: "queryAverage", p95FieldRef: "queryP95", timeoutFieldRef: "queryTimeout" } }, extra: {} },
  SyncVolumeTrendChart: { block: { id: "demo-SyncVolumeTrendChart", type: "SyncVolumeTrendChart", props: { title: "同步数据量" }, binding: { entityRef: "observabilityTrend", timeFieldRef: "obsTime", recordsFieldRef: "syncRecords", bytesFieldRef: "syncBytes", failedFieldRef: "syncFailed" } }, extra: {} },
  DatasourceQueryMetrics: { block: { id: "demo-DatasourceQueryMetrics", type: "DatasourceQueryMetrics", props: { title: "数据源查询" }, binding: { entityRef: "queryMetric", requestFieldRef: "queryRequests", errorFieldRef: "queryErrors", cacheHitFieldRef: "queryCacheHits", durationFieldRef: "queryDuration" } }, extra: {} },
  StreamFreshnessMetrics: { block: { id: "demo-StreamFreshnessMetrics", type: "StreamFreshnessMetrics", props: { title: "数据流新鲜度" }, binding: { entityRef: "streamMetric", lagFieldRef: "streamLag", syncedAtFieldRef: "streamSyncedAt", recordsFieldRef: "streamRecords", failedFieldRef: "streamFailed" } }, extra: {} },
  PanelCommandHeader: { block: { id: "demo-PanelCommandHeader", type: "PanelCommandHeader", binding: { entityRef: "panelState", titleFieldRef: "panelTitle", datasourceFieldRef: "panelDatasource", editableFieldRef: "panelEditable", targets: ["panel"] } }, extra: {} },
  ExploreQueryControlBar: { block: { id: "demo-ExploreQueryControlBar", type: "ExploreQueryControlBar", binding: { entityRef: "exploreState", statusFieldRef: "exploreStatus", queryFieldRef: "exploreQuery", targets: ["query"] } }, extra: {} },
  QueryErrorDrawer: { block: { id: "demo-QueryErrorDrawer", type: "QueryErrorDrawer", binding: { entityRef: "queryError", refFieldRef: "queryRef", messageFieldRef: "queryMessage", statusFieldRef: "queryStatus", requestFieldRef: "queryRequest", targets: ["query"] } }, extra: {} },
  SchemaConflictDrawer: { block: { id: "demo-SchemaConflictDrawer", type: "SchemaConflictDrawer", binding: { entityRef: "schemaConflict", streamFieldRef: "conflictStream", fieldFieldRef: "conflictField", changeFieldRef: "conflictChange", breakingFieldRef: "conflictBreaking", targets: ["schema"] } }, extra: {} },
  FreeformInsight: {
        block: {
          id: "demo-FreeformInsight", type: "FreeformInsight", props: { title: "自由洞察" },
          freeformContent: FREEFORM_DEMO as unknown as { root: Record<string, unknown> },
        },
        extra: {},
      },
};

/**
 * 取示例数据。
 *
 * `surface` 一律置 plain（2026-08-08）：**陈列卡本身就是那张卡**，组件在它
 * 里面再画一层白底就是卡里套卡。实测这么套着的有 8 个（DataTable /
 * RecordForm / RecordDetail / TrendChart / RankedList / ActivityFeed /
 * RecordFormDialog / StepsForm），外面一圈阴影、里面又一圈圆角。
 *
 * 跟"装进 ContentCard 的积木自动 plain"是同一条规矩，只是这里的容器是陈列
 * 相框而不是 ContentCard：**谁提供表面，谁负责，一层就够**。
 */

/**
 * 没有手写夹具时，按区块自己的 `bindingSchema` **现合成**一份（2026-08-11）。
 *
 * ## 为什么加
 *
 * 用户看着「主体区」「补充说明」两个筛选说「怎么还全是表格」。去重砍掉 91 个
 * 之后再看那两屏，剩下的卡片仍然一片一样——但那**不是重复**，是每张卡都在说
 * 「这一页还没为它准备示例数据」。手写夹具只覆盖到 2/3，剩下的 100 来个区块
 * 在墙上就是一张空卡加一行灰色组件清单，**看上去当然全一样**。
 *
 * 手写 100 份夹具不划算，而且会一直欠着。目录里本来就有每个区块的
 * `bindingSchema`（required/optional + entityFieldRefs 的类型），照着它挑字段
 * 就能喂饱绝大多数区块——去重那道闸（no-duplicate-blocks.test.tsx）正是靠同一
 * 套合成逻辑把 273/350 渲染出了真内容，这条路是验证过的。
 *
 * ## 用真数据，不造假数据
 *
 * 合成的只是**绑定关系**，值仍然来自这一页原有的 ENTITY_ROWS（门店巡检那套
 * 中文示例）。按 FIELD_TYPE 给每个 `xxxFieldRef` 挑一个类型对得上的真实字段，
 * 挑不到才退到同实体的任意字段。所以卡上出现的是"高新店/整改说明.docx"这类
 * 看得懂的东西，不是 "示例文本 1 / 示例文本 2"。
 *
 * ⚠ 合成夹具**不等于手写夹具**：手写的那份能挑最贴题的实体和字段组合，
 * 合成的只保证"喂得饱、看得见形态"。所以优先级是手写 > 合成，
 * 且卡上照旧标出来（`data-demo-source`），别让人误以为这是精心配的例子。
 */
const SYNTH_ENTITY = "orderLog";

/** 按 type 建索引 —— HAS_SYNTH 要对整册各查一次，用 find 就是 316×316 次线性扫。 */
const CATALOG_BY_TYPE = new Map(CATALOG.blocks.map(b => [String(b.type), b]));

export function synthesizedDemo(type: string): { block: ExperienceBlockInstance; extra: Record<string, unknown> } | undefined {
  const entry = CATALOG_BY_TYPE.get(type) as
    | { bindingSchema?: { required?: string[]; optional?: string[]; entityFieldRefs?: Record<string, string> } }
    | undefined;
  const schema = entry?.bindingSchema;
  if (!schema) return undefined;
  const rows = ENTITY_ROWS[SYNTH_ENTITY];
  if (!rows?.length) return undefined;
  const fields = Object.keys(rows[0].values ?? {});
  if (!fields.length) return undefined;
  const pick = (want?: string) =>
    fields.find(f => FIELD_TYPE[f] === want) ?? fields.find(f => FIELD_TYPE[f] === "string") ?? fields[0];

  const binding: Record<string, unknown> = { entityRef: SYNTH_ENTITY, targets: [SYNTH_ENTITY] };
  for (const ref of [...(schema.required ?? []), ...(schema.optional ?? [])]) {
    if (ref === "entityRef" || ref === "targets") continue;
    if (ref.endsWith("FieldRefs")) { binding[ref] = fields.slice(0, 3); continue; }
    if (ref.endsWith("FieldRef")) { binding[ref] = pick(schema.entityFieldRefs?.[ref]); continue; }
    binding[ref] = ref === "limit" ? 5 : undefined;
    if (binding[ref] === undefined) delete binding[ref];
  }
  return { block: { id: `synth-${type}`, type, binding } as ExperienceBlockInstance, extra: {} };
}

export function demoFor(type: string): { block: ExperienceBlockInstance; extra: Record<string, unknown> } {
  const d = DEMOS[type] ?? synthesizedDemo(type) ?? { block: { id: `demo-${type}`, type }, extra: {} };
  return {
    ...d,
    block: { ...d.block, props: { ...(d.block.props ?? {}), surface: "plain" } },
  };
}
const HAS_DEMO = new Set(Object.keys(DEMOS));
/** 手写夹具没覆盖、但能按 bindingSchema 合成出来的。合成失败的仍然如实说没有示例。 */
const HAS_SYNTH = new Set(
  CATALOG.blocks
    .map(b => String(b.type))
    .filter(t => !HAS_DEMO.has(t) && synthesizedDemo(t) !== undefined)
);
export const HAS_ANY_DEMO = (type: string) => HAS_DEMO.has(type) || HAS_SYNTH.has(type);

/** 页面形态（pageKind）——与 Python 侧 schema_legal.PAGE_KINDS 同源，此处是说明文案。 */
const PAGE_KINDS = [
  { key: "workbench", label: "工作台", desc: "左列表 + 右详情，最通用的一档", need: "—" },
  { key: "kanban", label: "看板", desc: "按状态分列拖动", need: "必须有 enum 状态字段" },
  { key: "calendar", label: "日历", desc: "月历视图，按日期落点", need: "必须有 date 字段" },
  { key: "wizard", label: "向导", desc: "Steps 分步引导", need: "—" },
  { key: "dashboard", label: "仪表盘", desc: "指标密排；可拿 AI 自由版式", need: "—" },
  { key: "monitor", label: "总览", desc: "首页形态；可拿 AI 自由版式", need: "—" },
];


/** 列宽下限与间距——照应用中心那面墙的写法，但值不同。
 *
 * 与应用中心保持 260：它决定的是列数下限，真实列宽仍由 SpanMasonry 把剩余空间
 * 均分。PC 与手机预览必须分别作为独立 item，ResizeObserver 才能按各自真实高度
 * 排列；把两档包进同一个 item 会让整组高度参与定位，墙面无法填补空列。
 */
const WALL_COLUMN_WIDTH = 260;
const WALL_GUTTER = 16;

type DeviceTier = ComponentWallDevice;
type PreviewDevice = ComponentPreviewDevice;

interface BlockPreviewEntry {
  block: CatalogBlock;
  device: PreviewDevice;
}

/**
 * 手机档渲染器。**懒加载**：它拉的是整个 antd-mobile，桌面档一个字节都用不上，
 * 静态引会把 antd-mobile 压进这一页的首包。挂法与 AppRuntimeScreen 一致。
 */
const LazyPhoneExperienceBlock = React.lazy(
  () => import("./live-runtime/phone-mobile/PhoneExperienceBlock")
);


/**
 * 这个区块在手机档有没有**自己的**渲染器。
 *
 * 两个条件都要满足：手机渲染器认得它（PhoneExperienceBlock 的类型表），
 * 并且这一页给它备了示例数据（HAS_DEMO）。缺后者会画出一张空卡，
 * 那跟"降级"一样是没意义的中间态。
 *
 * 2026-08-07 用户裁决：手机端就是手机端，桌面端就是桌面端，不要"手机档但其实
 * 是桌面渲染器"这种东西。所以这个判据现在决定的是**这张卡出不出现在手机档**，
 * 而不再是"出现、但挂个降级角标"。
 *
 * ⚠️ 这只改了这一页的陈列方式。真实应用里的降级仍然存在
 * （AppRuntimeScreen.tsx:1538：手机档遇到没有手机实现的区块，照样拿桌面渲染器
 * 塞进窄壳）。要让线上也"手机端就是手机端"，得单独决定那种情况给用户看什么
 * ——直接不显示会让手机用户少掉整块内容，比挤一点更糟。
 */
function hasPhoneImplementation(block: CatalogBlock): boolean {
  return isPhoneExperienceBlock(block.type) && HAS_ANY_DEMO(block.type);
}

/** 真实渲染器预览；外壳使用 Ant Design Card，元信息不会覆盖可交互内容。 */
function BlockCard({
  block,
  device,
  marks,
}: {
  block: CatalogBlock;
  device: PreviewDevice;
  marks: MarkApi;
}) {
  const { block: instance, extra } = demoFor(block.type);
  const impl = IMPL_BY_TYPE[block.type];
  const demoable = HAS_ANY_DEMO(block.type);
  // 与应用中心 LiveAppThumb 共用同一个全局排队器。当前页虽然最多只有 12 张，
  // 但每张仍可能包含 ProTable / ECharts / Form；分成每批 3 张挂载，避免它们在
  // 同一个 React 提交阶段抢主线程。翻页或改筛选卸载时会自动取消尚未放行的任务。
  const [mountGranted, setMountGranted] = React.useState(false);
  React.useEffect(
    () => requestMountPermit(() => setMountGranted(true)),
    []
  );
  // 墙上的示例也得是**能动的**。ColumnSettingPanel 全靠改宿主态活着，宿主不
  // 给回调它就是一排点不动的复选框——这一页刚因为同一个原因让 QuickActionPanel
  // 渲染成空气过（见 previewActions 那段）。这份局部态只服务这张卡。
  const [demoColumnState, setDemoColumnState] = React.useState<PageColumnState>({});
  // 筛选态同理：TagFilterRow 勾了标签、SearchBox 敲了词，没有回调就一动不动。
  const [demoFilter, setDemoFilter] = React.useState<PageFilterState>({
    enumFilters: {},
    dateRange: null,
  });
  const demoStateProps = {
    columnState: demoColumnState,
    onColumnStateChange: (targetId: string, next: BlockColumnState) =>
      setDemoColumnState(prev => ({ ...prev, [targetId]: next })),
    filterState: demoFilter,
    onFilterChange: (patch: Partial<PageFilterState>) =>
      setDemoFilter(prev => ({ ...prev, ...patch })),
  };

  // 手机档只渲染**真有手机实现**的区块（见 hasPhoneImplementation 与那里的说明）。
  // 没有实现的不会走到这里——它们压根不进手机档的列表。
  const rendered = !mountGranted ? (
    <div data-testid="component-preview-pending" className="px-2 py-4">
      <Skeleton active title={{ width: "42%" }} paragraph={{ rows: 4 }} />
    </div>
  ) : demoable ? (
    device === "phone" ? (
      <React.Suspense fallback={<div style={{ height: 120 }} />}>
        <LazyPhoneExperienceBlock
          block={instance}
          entityRows={ENTITY_ROWS}
          chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
          fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
          fieldTypeOf={(_e: string, f: string) => FIELD_TYPE[f]}
          fieldSchemaOf={fieldSchemaOf}
          enumOptionsOf={(_e: string, f: string) => ENUM_OPTIONS[f] ?? []}
          {...extra}
        />
      </React.Suspense>
    ) : (
      <ExperienceBlockBoundary
        block={instance}
        entityRows={ENTITY_ROWS}
        chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
        fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
        fieldTypeOf={(_e: string, f: string) => FIELD_TYPE[f]}
        fieldSchemaOf={fieldSchemaOf}
        enumOptionsOf={(_e: string, f: string) => ENUM_OPTIONS[f] ?? []}
        {...demoStateProps}
        {...extra}
      />
    )
  ) : (
    // 目录里有、这一页还没配夹具：如实说"没有示例"，不画一个假的充数。
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="这一页还没为它准备示例数据"
      style={{ margin: "16px 0" }}
    />
  );

  // 卡片角标跟顶部档位 chip 用同一套 lucide 图标——原来这里是 antd 的
  // Mobile/DesktopOutlined，跟顶部两个图标线宽和字重都对不上。
  const DeviceIcon = device === "phone" ? Smartphone : Monitor;

  return (
    <Card
      data-testid={`component-card-${block.type}`}
      data-preview-key={`${device}-${block.type}`}
      size="small"
      variant="borderless"
      // 12px 内边距（2026-08-08 用户要的）。**这是把 08-07 那个决定翻过来。**
      //
      // 那次去掉留白的理由是"渐变遮罩没了，给遮罩让位的 paddingBottom: 64 也就
      // 没理由了"——去 64px 的底部留白是对的，但顺手把四边也清成 0，组件就直接
      // 贴着卡边，看着像被裁掉一截。12px 是让组件"在卡里"而不是"糊在卡上"。
      //
      // 底部那层元信息浮层不受影响：绝对定位相对的是 padding box，`inset-x-0
      // bottom-0` 仍然贴着卡的内边缘，不会跟着缩进去。
      styles={{ body: { padding: 12, overflow: "hidden", position: "relative" } }}
      className="group w-full"
      style={{ boxShadow: CARD_SHADOW }}
    >
      {/* 收藏星单独放右上角，不进底部那层浮层——浮层是 pointer-events-none 的
          纯展示层，星星要能点。

          2026-08-11 跟着上面那次一起收：**没收藏的星默认也不显示**，悬停才出来；
          **已收藏的一直显示**。

          这条不是照抄参照站（那面墙上收藏图标也只在悬停时出现），是因为两者
          性质不同：
            · 没收藏的星是**入口**——用不着的时候摆在那儿，就是每张卡右上角
              一个白色小方块，卡片一空下来它反而成了整面墙最显眼的东西。
            · 已收藏的星是**状态**——藏起来的话，「哪些是我收藏的」在墙上就
              看不出来了，而收藏本身是这一页的一个筛选维度（顶部有「收藏」档）。
          隐藏入口可以，隐藏状态不行。

          同样只在有指针的设备上藏（理由见下面那段浮层注释的 ②）。 */}
      <div
        className={
          "absolute right-1.5 top-1.5 z-20 rounded bg-white/70 backdrop-blur-sm transition-opacity duration-200" +
          (marks.isFav(`block:${block.type}`)
            ? ""
            : " opacity-100 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100")
        }
      >
        <FavStar
          on={marks.isFav(`block:${block.type}`)}
          onToggle={() => marks.onToggleFav(`block:${block.type}`)}
        />
      </div>
      {/* 渲染区四边不留白，组件铺满整张卡；元信息浮层直接压在画面底部。 */}
      {/*
        `contain: layout` —— 把 `position: fixed` 关回这张卡里（2026-08-09）。

        ## 症状

        SectionedForm 的提交区用的是 pro-layout 的 `FooterToolbar`（吸底工具条，
        原样搬自 pro-blocks 的 FormAdvancedForm）。在组件库这面墙上，那条工具条
        钉在**浏览器视口**底部，一条蓝色「提交」浮在整站之上，还盖住别的卡。

        ## 为什么 `portalDom={false}` 不够

        那边已经传了 `portalDom={false}`，注释写的是"让它停在这张卡里"。但看
        pro-layout 的实现，这个开关只决定**要不要 createPortal 到 document.body**：

            // FooterToolbar/index.js:91
            var ssrDom = !isBrowser() || !portalDom || !containerDom
              ? renderDom : createPortal(renderDom, containerDom, baseClassName);

        而它的样式是写死的：

            // FooterToolbar/style/index.js:6
            position: 'fixed', insetInlineEnd: 0, bottom: 0, zIndex: 99

        **管住了在哪儿渲染，没管住按什么定位。** 元素留在卡片的 DOM 里，但
        `position: fixed` 的包含块默认是视口，照样脱离出去。

        ## 这个坑本仓踩过，只是防护没铺到这面墙

        基础组件那一档早就治过同一件事：`base-catalog-pro.tsx` 给 ProLayout /
        FooterToolbar 两条加了 `transform: translateZ(0)`，测试也钉着
        （components-library-contract「必须留着 transform」那条），原话是
        「第一版 ProLayout 的侧边栏铺满了整个目录页，另外 216 条全被压在下面，
        而错误边界全绿——布局逃逸不是异常」。

        所以判据早就有了，**只是加在了基础组件那面墙的条目上，区块墙这边没有**。
        区块是另一条渲染路径（ExperienceBlockBoundary），谁用到 FooterToolbar
        就会漏出来。这里补的是同一道防护的另一半。

        ## 为什么这边用 contain 而不是照抄 translateZ(0)

        两者都能成为 fixed 后代的包含块，效果等价。那边是**逐条**加在两个已知
        会逃逸的条目上（217 条里的 2 条）；这边要加在**每张卡**上，而
        `translateZ(0)` 会把每张卡提升成合成层——26 张活区块各占一层不划算。
        `contain: layout` 拿到同样的包含块，不强制 GPU 提升。

        ## 为什么用 containment 而不是 iframe

        组件目录做预览隔离，业界的标准答案是 iframe——Storybook 每个 story 都跑在
        自己的 `iframe.html` 里，样式、脚本、定位全隔离。但这面墙的高度是靠
        ResizeObserver 量出来喂给瀑布流的（那套刚为"量高不稳"修过一轮），
        26 个 iframe 意味着 26 份高度要跨文档同步回来——把刚稳住的地方重新推倒。

        CSS 规范给了更轻的办法：`contain: layout` 的元素**成为其绝对/固定定位
        后代的包含块**。于是 fixed 相对这张卡定位，工具条回到卡片底边——正是
        那条注释本来想要的效果。用 layout 而不是 `contain: size`：size 会让元素
        不再按内容撑高，那正好会打断测量。
      */}
      <div
        data-testid={mountGranted ? "component-preview-runtime" : undefined}
        className="w-full"
        style={{ contain: "layout" }}
        onClick={() => marks.onUse(`block:${block.type}`)}
      >
        {rendered}
      </div>
      {/* 元信息作为底部浮层直接压在卡片画面上。

          2026-08-08：药丸本身的做法（每条自带底衬）是对的——压在任何底色上
          都读得清。问题在**视觉权重**：一眼扫过去，一片浅色组件里挂着十几个
          深色药丸，最抢眼的成了标签而不是组件本身，而这一页是用来看组件的。

          改成跟着鼠标走：默认 35% 不透明度（认得出有东西、不夺目），指针
          落到这张卡上才 100%。画廊类界面的通行做法——信息一个不少，只是
          不在你没问的时候喊。

          2026-08-11：**35% 再降到 0**。用户拿 isqqw.com（ECharts 示例集，
          24843 张图的墙）作参照，那面墙上不悬停就是干干净净的图，悬停才浮出
          标题/浏览量/日期/版本一整块。原话：「默认不显示，鼠标放到卡片上才显示」。

          08-08 那次留 35% 的理由是"认得出有东西"。但真按图墙的用法想一遍，
          这个理由站不住：**在扫的阶段，"有东西"这个信息本身没用**——每张卡都
          有，等于没有区分度，却给每张卡都加了一层灰噪点。要看的时候鼠标自然
          就过去了。

          ⚠ 两处不能跟着照抄 isqqw：

          ① **不加整片压暗的遮罩。** 那面墙的卡是静态缩略图，悬停时盖一层黑
             无所谓；这面墙的卡是**活组件**，悬停正是要看它的时候，盖上去等于
             把人要看的东西挡了。（这跟本文件历史上删掉 bg-gradient-to-t 是
             同一条理由，contract 测试还钉着。）
          ② **触屏上不能藏。** Tailwind v4 起 hover 变体自带 `@media (hover:hover)`，
             group-hover 也跟着走——手机上悬停永远不发生，写成 opacity-0 就是
             **永久隐身**。所以基线是 100%，只在真有指针的设备上才降到 0。
             键盘同理：group-focus-within 让 Tab 进这张卡也能浮出来。 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-2 pt-2 opacity-100 transition-opacity duration-200 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="flex items-center">
          <Tooltip title={block.description}>
            <span
              className="inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-sm bg-black/30 px-1 text-[13.5px] font-semibold leading-5 text-white"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.45), 0 0 1px rgba(0,0,0,0.25)" }}
            >
              <span className="min-w-0 truncate">{block.type}</span>
              <DeviceIcon size={12} className="shrink-0" />
            </span>
          </Tooltip>
        </div>
        <div
          className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-white/75"
          style={{ textShadow: "0 0.5px 1px rgba(0,0,0,0.28)" }}
        >
          <span className="rounded-sm bg-black/30 px-1">{impl ?? "实现未登记"}</span>
          {(block.allowedRegions ?? []).map(s => (
            <span className="rounded-sm bg-black/30 px-1" key={s}>{SLOT_LABEL[s] ?? s}</span>
          ))}
          {(block.dataKinds ?? []).map(k => (
            <span className="rounded-sm bg-black/30 px-1" key={k}>{DATAKIND_LABEL[k] ?? k}</span>
          ))}
          {block.freeformGenerated && <span className="rounded-sm bg-black/30 px-1">AI 现场设计</span>}
        </div>
      </div>
    </Card>
  );
}

/**
 * 一套存下来的模板 —— 用真渲染器 + 真实的槽位→网格管线摆出来。
 *
 * 与此前那个 PresetCard 的区别不在长相，在**来源**：那个读的是我手写在目录
 * JSON 里的十套（死的、每次一样，其中三套推荐的积木在真实应用里会被渲染层
 * 直接丢掉）；这个读的是 AI 组装攒进库里的。所以这里的积木已经带着 binding
 * ——绑到哪个实体、哪几个字段都是组装时定好的，不需要再 demoFor 一次。
 */
function SavedPresetCard({ preset }: { preset: SavedPreset }) {
  const topLevel = preset.blocks.filter(b => !b.nested);
  const regions = Object.fromEntries(
    REGION_LAYOUT.map(r => [r.key, topLevel.filter(b => b.slot === r.key).map(b => b.id)])
  ) as unknown as BusinessRegions;
  const items = resolveBusinessGrid(regionsToGrid(preset.pageKind, regions), "desktop");
  const byId = new Map(preset.blocks.map(b => [b.id, b]));

  const renderOne = (b: AssembledBlock): React.ReactNode => (
    <ExperienceBlockBoundary
      key={b.id}
      block={{ id: b.id, type: b.type, props: b.props, binding: b.binding } as ExperienceBlockInstance}
      entityRows={ENTITY_ROWS}
      chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
      fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
      fieldTypeOf={(_e: string, f: string) => FIELD_TYPE[f]}
      fieldSchemaOf={fieldSchemaOf}
      enumOptionsOf={(_e: string, f: string) => ENUM_OPTIONS[f] ?? []}
      workflow={WORKFLOW}
      roleLabelOf={(id: string) => ROLE_LABELS[id]}
    >
      {b.children && b.children.length > 0
        ? b.children.map(id => {
            const child = byId.get(id);
            return child ? renderOne(child) : null;
          })
        : undefined}
    </ExperienceBlockBoundary>
  );

  return (
    <Card
      data-testid={`saved-preset-${preset.id}`}
      size="small"
      variant="borderless"
      styles={{ body: { padding: 0, overflow: "hidden" } }}
      className="w-full"
      style={{ boxShadow: CARD_SHADOW }}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <span className="text-[13.5px] font-semibold text-slate-900">{preset.name}</span>
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
          {preset.industry}
        </span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
          {PAGE_KINDS.find(k => k.key === preset.pageKind)?.label ?? preset.pageKind}
        </span>
        <span className="ml-auto text-[11px] text-slate-400">{preset.blockCount} 个积木</span>
      </div>
      <div className="bg-[#f0f2f5] p-3">
        <BusinessPageGrid
          breakpoint="desktop"
          items={items}
          renderItem={ref => {
            const b = byId.get(ref);
            return b ? renderOne(b) : null;
          }}
        />
      </div>
    </Card>
  );
}

/** 组装结果里的一个积木——服务端已经逐个校验过槽位与绑定。 */
/**
 * 一个区块提案 —— 契约，不是代码。
 *
 * 这是链路第二层的入口：基础组件（纯 schema）+ 逻辑 + 关联 = 区块。提案把
 * 「加什么逻辑、关联到什么」说清楚（capability / binding / regions），渲染器
 * 仍然要人写。Ant Design 官方的 pro-blocks 也是这个分工——29 个区块全是手写
 * 源码，`umi block add` 拷源码而已。
 */
interface BlockProposal {
  type: string;
  label: string;
  capability: string;
  does: string;
  uses: string[];
  regions: string[];
  props?: string[];
  binding?: { required?: string[]; optional?: string[] };
  why: string;
}

interface BlockProposalResult {
  proposals: BlockProposal[];
  /** 这一批全建了能释放哪些"还没接进区块"的素材 —— 提案的价值得能量出来。 */
  releases: string[];
  unlinkedBefore: number;
  gatePassed?: boolean;
  attempts?: number;
}

/**
 * 提案面板。
 *
 * 刻意**不长得像一张组装好的页面**：它不是页面，是一份设计稿。所以摆的是
 * 契约本身——收哪些基础组件、声明什么能力、绑什么、落哪些区域、为什么值得建。
 * 做成"预览一张漂亮的页面"反而会让人以为点一下就有了。
 */
function BlockProposalModal({
  result,
  onClose,
}: {
  result: BlockProposalResult;
  onClose: () => void;
}) {
  const after = result.unlinkedBefore - result.releases.length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
      data-testid="block-proposal-modal"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-[1000px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-slate-900">AI 提议的区块</span>
            <span className="rounded bg-[#e8eeff] px-2 py-0.5 text-[11px] text-[#3b5bdb]">
              契约草案 · 渲染器仍需实现
            </span>
            {/* 提案的价值必须是可量的，否则只是一段好听的话。 */}
            <span
              data-testid="proposal-coverage"
              className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"
            >
              建完可释放 {result.releases.length} 个素材：还没接进区块的从{" "}
              {result.unlinkedBefore} 降到 {after}
            </span>
            <button
              className="ml-auto rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-500 transition hover:bg-slate-100"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#f0f2f5] p-4">
          <div className="flex flex-col gap-3">
            {result.proposals.map(p => (
              <Card
                key={p.type}
                size="small"
                variant="borderless"
                styles={{ body: { padding: 0, overflow: "hidden" } }}
                data-testid={`proposal-${p.type}`}
                style={{ boxShadow: CARD_SHADOW_SOFT }}
              >
                <div className="border-b border-slate-100 px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold text-slate-900">{p.type}</span>
                    <span className="text-[12px] text-slate-500">{p.label}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-500">
                      {p.capability}
                    </span>
                    <span className="ml-auto text-[11px] text-slate-400">
                      落在 {p.regions.join(" / ")}
                    </span>
                  </div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{p.does}</div>
                </div>
                <div className="space-y-2 p-3 text-[11.5px]">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-slate-400">用基础组件</span>
                    {p.uses.map(u => {
                      const fresh = result.releases.includes(u);
                      return (
                        <span
                          key={u}
                          title={fresh ? "此前没有任何区块用它" : "已经被别的区块用了"}
                          className={`rounded px-1.5 py-0.5 ${
                            fresh
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {u}
                        </span>
                      );
                    })}
                  </div>
                  {p.binding?.required && p.binding.required.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-slate-400">必绑</span>
                      {p.binding.required.map(b => (
                        <span key={b} className="rounded bg-[#e8eeff] px-1.5 py-0.5 text-[#3b5bdb]">
                          {b}
                        </span>
                      ))}
                      {(p.binding.optional ?? []).map(b => (
                        <span key={b} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                          {b}?
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="rounded bg-slate-50 px-2 py-1.5 leading-relaxed text-slate-600">
                    <span className="text-slate-400">为什么要建：</span>
                    {p.why}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 存进库里的一套模板 —— AI 组装的产物 + 它判的行业。 */
interface SavedPreset {
  id: string;
  name: string;
  industry: string;
  pageKind: string;
  blockCount: number;
  blocks: AssembledBlock[];
}

interface AssembledBlock {
  id: string;
  type: string;
  slot: string;
  props?: Record<string, unknown>;
  binding?: Record<string, unknown>;
  /** ContentCard 这类容器装的积木 id（服务端已校验都指向真实存在的积木）。 */
  children?: string[];
  /** 已经被某个容器装走 —— 不再单独占槽位，否则同一个积木会出现两次。 */
  nested?: boolean;
}



/** 五阶段装配的产物：范式 + 区域 + 每个区域里的区块实例。 */
interface AssembledPage {
  name: string;
  industry: string;
  archetype: string;
  tasks: string[];
  regions: Record<string, AssembledBlock[]>;
  gatePassed?: boolean;
  attempts?: number;
}

/**
 * 区域在页面上占多少空间 —— **权重决定的，不是区块决定的**。
 *
 * 这是"五个组件 = 五张等大卡片"的解药（2026-08-08 用户指出的第 5 条）。
 * 区域声明自己的权重，布局按它分空间：
 *
 *   primary     主角，占主区（2/3 宽）
 *   secondary   为主角服务的（筛选条），整行但矮
 *   supporting  辅助信息，右侧窄栏（1/3）
 *   overlay     **一点页面空间都不占** —— 渲染出来就是个按钮，点了才有东西
 *
 * 区域顺序也在这里定死。不定死的话，模型返回的对象键序会直接变成页面顺序，
 * 那是随机的——同一份装配换个键序就成了另一张页面。
 */
/**
 * 页面区域的排版表 —— **从共享目录派生，不再手抄**。
 *
 * 2026-08-08 第三轮改的就是这里。上一轮这张表是我照着 Python 的
 * page_archetypes.py 手打的第二份，然后加了条对账用例让"一边改了另一边没改"
 * 报错。那是创可贴：两份还是两份，只是漏抄时会被抓。
 *
 * 同一天真机爆的那个 bug（进「区块」档点「清空」，16 个区块一个都不剩）根子
 * 是同一类——范式那栏的选项由 PAGE_KINDS 直接铺出、没有「全部」，而「清空」
 * 把每维置成 "all"，两处对同一个概念的取值集合不一致。**同一个概念写两份，
 * 迟早对不上**，靠用例只能事后抓。
 *
 * 现在两边同读 experience_block_catalog.json：Python 走 schema_legal，这边走
 * vite 的 @experience-blocks 别名。
 *
 * key 的顺序就是区域在页面上从上到下的顺序，由目录里 pageRegions 的键序决定
 * ——不定死的话，模型返回的对象键序会直接变成页面顺序，那是随机的。
 */
type RegionBand = "top" | "main" | "aside" | "footer" | "overlay";
type RegionWeight = "primary" | "secondary" | "supporting" | "overlay";

const REGION_LAYOUT: { key: string; label: string; band: RegionBand }[] =
  Object.entries(
    (CATALOG as unknown as {
      pageRegions: Record<string, { label: string; band: RegionBand }>;
    }).pageRegions
  ).map(([key, meta]) => ({ key, label: meta.label, band: meta.band }));

/**
 * 区域在**某个范式下**的权重。
 *
 * 权重是按范式来的，不是全局的：`main` 在列表页是主角（primary），在结果页
 * 也是主角，但 `metrics` 只有仪表盘才是 primary，列表页压根没有这个区域。
 * 手抄那版把 weight 拍成了全局一份，是错的——只是它当时只用来显示一行灰字，
 * 错了看不出来。
 */
const REGION_WEIGHTS: Record<string, Record<string, RegionWeight>> =
  Object.fromEntries(
    Object.entries(
      (CATALOG as unknown as {
        pageArchetypes: Record<
          string,
          { regions: { key: string; weight: RegionWeight }[] }
        >;
      }).pageArchetypes
    ).map(([archetype, arch]) => [
      archetype,
      Object.fromEntries(arch.regions.map(r => [r.key, r.weight])),
    ])
  );

/**
 * 装配出来的那一页。
 *
 * 与上一版（从 137 个基础组件抽的那个）的区别不是长相，是**里面装的是什么**：
 * 那版装的是组件示例（Button 的「主按钮/次按钮/虚线」原样搬进来），这版装的
 * 是绑到真实实体和字段上的业务区块实例。所以这版能真录数据，那版只能看。
 *
 * 头部把 tasks 摆出来——那是"用户在这一页要干什么"的答案，也是整条链路的
 * 第一步。摆出来才看得出模型到底理解了没有；理解错了，下面排布再整齐也是错的。
 */
function AssembledPageModal({
  page,
  onClose,
  onSaved,
}: {
  page: AssembledPage;
  onClose: () => void;
  onSaved?: () => void;
}) {
  // 深拷贝一份属于这一页的行数据 —— 副本语义就落在这一行上：在这里录十条
  // 删五条，切回组件库那些卡片一行都不变。
  const [rows, setRows] = React.useState<Record<string, RuntimeRow[]>>(() =>
    JSON.parse(JSON.stringify(ENTITY_ROWS))
  );
  const [seq, setSeq] = React.useState(0);
  const [toast, setToast] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savedAs, setSavedAs] = React.useState<string | null>(null);
  // 筛选态**按筛选区块的 id 分片**，不再是页面级一坨（见 rowsForBlock 的注释）。
  const [filterState, setFilterState] = React.useState<Record<string, PageFilterState>>({});
  const EMPTY_FILTER: PageFilterState = React.useMemo(
    () => ({ enumFilters: {}, dateRange: null }),
    []
  );
  /** 这一页所有区块的扁平表 —— 查"谁筛我"要用。 */
  const allBlocks = React.useMemo(
    () =>
      Object.values(page.regions ?? {}).flatMap((items, ri) =>
        (items ?? []).map((b, i) => ({ ...b, id: b.id ?? `r${ri}-${i}` }))
      ),
    [page.regions]
  );
  // 行选择态 —— DataTable 勾选、BatchActionBar 读。
  //
  // 2026-08-08 的教训直接写在这里：QuickActionPanel 的渲染器第一行是"没有
  // pageActions 就返回 null"，而这个预览从来没传过，于是它一直渲染成空气。
  // BatchActionBar 依赖同一类宿主态，所以**先把通路接上再建区块**——不接的话
  // 它在预览里永远显示"勾选左侧的行"，看着像做完了，其实是死的。
  const [selection, setSelection] = React.useState<PageSelectionState>({ rowIds: {} });
  // 列视图态 —— ColumnSettingPanel 改、DataTable 读。跟 filterState 同一套路：
  // **按目标区块 id 存**，一页两张表各改各的。
  const [columnState, setColumnState] = React.useState<PageColumnState>({});

  const filterFieldOptions: FilterFieldOption[] = React.useMemo(
    () =>
      Object.entries(ENUM_OPTIONS).map(([id, opts]) => ({
        id,
        label: FIELD_LABEL[id] ?? id,
        options: opts.map(o => ({ value: o.id, label: o.label })),
      })),
    []
  );
  const dateRangeField = React.useMemo(() => {
    const id = Object.keys(FIELD_TYPE).find(f => FIELD_TYPE[f] === "date");
    return id ? { id, label: FIELD_LABEL[id] ?? id } : null;
  }, []);

  /**
   * 某个数据区块**自己**看到的行 —— 只被指向它的筛选收窄。
   *
   * 2026-08-08 修的真 bug：上一版是页面级一坨，
   *
   *     for (const [entityId, list] of Object.entries(rows))   // 所有实体
   *       ... filterState.enumFilters ...                      // 只按字段名匹配
   *
   * 一页放两张表（订单 + 客户），只要都有 status 字段，筛一个就把两个都筛了。
   * 而 StatusTabs 写 enumFilters[field] 时同样不知道自己该筛哪张表。
   *
   * 现在照 nocobase 的 x-filter-targets：筛选区块显式声明自己筛谁
   * （SchemaSettingsConnectDataBlocks.tsx），数据区块反过来问"谁在筛我"。
   * 位置（区域）和关系（targets）是两根独立的轴——筛选条在页头、表格在主区，
   * 但连线是明确的。
   */
  const rowsForBlock = React.useCallback(
    (blockId: string): Record<string, RuntimeRow[]> => {
      const applied = allBlocks
        .filter(b => (b.binding?.targets as string[] | undefined)?.includes(blockId))
        .map(b => filterState[b.id])
        .filter(Boolean) as PageFilterState[];
      if (applied.length === 0) return rows;
      const out: Record<string, RuntimeRow[]> = {};
      for (const [entityId, list] of Object.entries(rows)) {
        out[entityId] = list.filter(r =>
          applied.every(f => {
            // ① 单选下拉（FilterBar）
            const bySingle = Object.entries(f.enumFilters ?? {}).every(([field, want]) =>
              !want ? true : String(r.values?.[field] ?? "") === want
            );
            // ② 多选标签行（TagFilterRow）。**空数组 = 不筛这个维度**——
            // 「全部」取消勾选之后是空数组，那时候该看到全部，不是一条都
            // 看不到。这条不写清楚很容易写成 includes 直接返回 false。
            const byMulti = Object.entries(f.enumMulti ?? {}).every(([field, picked]) =>
              !picked || picked.length === 0
                ? true
                : picked.includes(String(r.values?.[field] ?? ""))
            );
            // ③ 关键词（SearchBox）。跨所有值做子串匹配——这一页是对照台，
            // 真实应用该按 fieldRefs 声明的字段搜。
            const kw = (f.keyword ?? "").trim().toLowerCase();
            const byKeyword =
              kw === "" ||
              Object.values(r.values ?? {}).some(v =>
                String(v ?? "").toLowerCase().includes(kw)
              );
            return bySingle && byMulti && byKeyword;
          })
        );
      }
      return out;
    },
    [rows, filterState, allBlocks]
  );

  /**
   * 列设置面板要列出的字段 —— 从它 targets 指向的那张表**当前的列**来。
   *
   * 面板自己不绑行数据（它的 dataKinds 是空的），所以这份清单必须由宿主给。
   * 顺序也从目标表格来：目标声明了 fieldRefs 就用它，没声明就是行数据的键。
   * 这跟 DataTable 自己那套派生规则得是同一份，否则面板上列出来的和表上画
   * 出来的对不上——用户勾掉一个，表上没反应。
   */
  const targetColumnsOf = React.useCallback(
    (b: AssembledBlock): string[] | undefined => {
      const targets = (b.binding?.targets as string[] | undefined) ?? [];
      if (targets.length === 0) return undefined;
      const target = allBlocks.find(x => x.id === targets[0]);
      if (!target) return undefined;
      const declared = target.binding?.fieldRefs as string[] | undefined;
      if (Array.isArray(declared) && declared.length > 0) return declared.map(String);
      const entityRef = String(target.binding?.entityRef ?? "");
      const list = rows[entityRef] ?? [];
      return [...new Set(list.flatMap(r => Object.keys(r.values ?? {})))].slice(0, 8);
    },
    [allBlocks, rows]
  );

  /**
   * 当前聚焦的记录（2026-08-08，②批次 4）。点表格一行就换一条。
   *
   * 关联单据表和详情区块都靠它知道"这是哪一条"。此前根本没有这个概念——
   * RecordDetail 的注释写着「运行时还没有选中态时用第一条」，一直用的就是
   * 第一条；关联单据表没有它就只能把整张表搬过来。
   */
  const [focus, setFocus] = React.useState<PageFocusState>({});

  const handleAction = (actionId: string, data?: Record<string, unknown>) => {
    // 点一行 = 聚焦这一条。rowSelect 本来就是"选中了某一行"的意思，
    // 只是此前没人接，点了什么都不发生。
    if (actionId === "rowSelect") {
      const rowId = String(data?.rowId ?? "");
      if (!rowId) return;
      const owner = Object.entries(rows).find(([, list]) =>
        list.some(r => r.id === rowId)
      );
      if (owner) setFocus(prev => ({ ...prev, [owner[0]]: rowId }));
      return;
    }
    if (actionId !== "submitRequest") return;
    const entityRef = String(data?.entityRef ?? "");
    const values = (data?.values ?? {}) as Record<string, unknown>;
    if (!entityRef || !rows[entityRef]) return;
    const next = seq + 1;
    setSeq(next);
    setRows(prev => ({
      ...prev,
      [entityRef]: [
        ...(prev[entityRef] ?? []),
        { id: `asm-row-${next}`, values, createdAt: new Date().toISOString() },
      ],
    }));
    setToast(`已写入 ${entityRef}，现在共 ${(rows[entityRef]?.length ?? 0) + 1} 条`);
    window.setTimeout(() => setToast(null), 2600);
  };

  /**
   * 预览用的页面操作 —— 拿这一页自己的 tasks 当按钮。
   *
   * 2026-08-08 实测抓到的坑：`QuickActionPanelRenderer` 第一行就是
   * `if ((pageActions ?? []).length === 0) return null`——按钮来源是宿主给的
   * pageActions，而这个预览**从来没传过**。于是任何被装进页面的
   * QuickActionPanel 都渲染成空气：不报错、不占位、什么都没有。
   *
   * 以前看不出来，是因为它总跟别的区块挤在同一个区里；这次 footerBar 把它
   * 单独放进底部那条带，一眼就露馅了（整条带是空的）。
   *
   * 预览里没有真实应用的操作清单，但这一页的 tasks 正是模型写下的"用户在这
   * 一页要干的事"（提交入库单 / 新增商品 / 补货），拿它当按钮既有内容又诚实
   * ——按钮文案和这一页的意图是同一份东西。
   */
  const previewActions = React.useMemo(
    () =>
      (page.tasks ?? []).slice(0, 6).map((t, i) => ({
        id: `preview-task-${i}`,
        label: t,
        permitted: true,
      })),
    [page.tasks]
  );

  const renderBlock = (b: AssembledBlock, i: number) => {
    // 区块 id 用装配结果里给的，没给才退回位置生成的 —— targets 连的是这个 id，
    // 每次渲染都换一个的话连线就断了。
    const blockId = b.id ?? `${b.type}-${i}`;
    return (
    <ExperienceBlockBoundary
      key={blockId}
      block={
        {
          id: blockId,
          type: b.type,
          // surface 一律 plain：区域面板已经提供了那张卡，区块再画一层白底
          // 就是卡里套卡（同"装进 ContentCard 的自动 plain"那条规矩）。
          props: { ...(b.props ?? {}), surface: "plain" },
          binding: b.binding,
        } as ExperienceBlockInstance
      }
      // 数据区块只看到"筛我的那些筛选"作用之后的行；筛选区块自己不展示数据，
      // 传原始行即可（它要靠全量算每个状态有几条）。
      entityRows={rowsForBlock(blockId)}
      chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
      // 筛选态是这个筛选区块自己的那一片
      filterState={filterState[blockId] ?? EMPTY_FILTER}
      filterFieldOptions={filterFieldOptions}
      dateRangeField={dateRangeField}
      onFilterChange={patch =>
        setFilterState(prev => ({
          ...prev,
          [blockId]: { ...(prev[blockId] ?? EMPTY_FILTER), ...patch },
        }))
      }
      selection={selection}
      onSelectionChange={(entityRef, rowIds) =>
        setSelection(prev => ({ rowIds: { ...prev.rowIds, [entityRef]: rowIds } }))
      }
      focus={focus}
      columnState={columnState}
      onColumnStateChange={(targetId, next) =>
        setColumnState(prev => ({ ...prev, [targetId]: next }))
      }
      // 列设置自己不绑行数据——它要列什么，得问它管的那张表当前有哪几列。
      targetColumns={targetColumnsOf(b)}
      fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
      fieldTypeOf={(_e: string, f: string) => FIELD_TYPE[f]}
      // 字段的**呈现格式**（money/percent/masked…）跟类型是两回事：类型决定
      // 用哪个控件族，格式决定这一族里的哪一个。五系统合法值那边早就声明了
      // numberFormats/stringFormats，运行时 schema 也一直带着 format，只是此前
      // 没有任何一处读它——表单里一律画成裸数字框。
      fieldSchemaOf={fieldSchemaOf}
      enumOptionsOf={(_e: string, f: string) => ENUM_OPTIONS[f] ?? []}
      pageActions={previewActions}
      onAction={handleAction}
      workflow={WORKFLOW}
      roleLabelOf={(id: string) => ROLE_LABELS[id]}
    />
    );
  };

  const region = (key: string) => page.regions?.[key] ?? [];
  // 按 band 分带 —— 不再靠 `key === "header"` 猜。原来那种写法每加一个区域
  // 都得回来补一条特判，而漏了特判的表现是"区域静静地跑到了错误的位置"，
  // 界面上看不出是 bug。
  const shown = REGION_LAYOUT.filter(r => region(r.key).length > 0);
  const topRegions = shown.filter(r => r.band === "top");
  const mainRegions = shown.filter(r => r.band === "main");
  const asideRegions = shown.filter(r => r.band === "aside");
  const footerRegions = shown.filter(r => r.band === "footer");
  const overlayRegions = shown.filter(r => r.band === "overlay");

  // 权重按**这一页的范式**查 —— 同一个区域在不同范式下轻重不同（metrics 只有
  // 仪表盘才是主角）。手抄那版把它拍成全局一份，是错的。
  const weightOf = (key: string) => REGION_WEIGHTS[page.archetype]?.[key] ?? "supporting";

  const Panel = ({ r }: { r: (typeof REGION_LAYOUT)[number] }) => (
    <Card
      size="small"
      variant="borderless"
      styles={{ body: { padding: 0, overflow: "hidden" } }}
      className="mb-3"
      style={{ boxShadow: CARD_SHADOW_SOFT }}
      data-testid={`region-${r.key}`}
    >
      <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
        {r.label} · {weightOf(r.key)}
      </div>
      <div className="p-3">{region(r.key).map(renderBlock)}</div>
    </Card>
  );

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const flat = Object.entries(page.regions ?? {}).flatMap(([rk, items]) =>
        (items ?? []).map((b, i) => ({ ...b, id: `${rk}-${i}`, slot: rk, children: [] }))
      );
      const res = await fetch("/api/sliderule/components/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: page.name,
          industry: page.industry,
          pageKind: page.archetype,
          blocks: flat,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; preset?: { industry: string } };
      if (res.ok && body.ok) {
        setSavedAs(body.preset?.industry ?? page.industry);
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
      data-testid="assembled-page-modal"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-[1400px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-slate-900">{page.name}</span>
            <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
              {page.industry}
            </span>
            <span className="rounded bg-[#e8eeff] px-2 py-0.5 text-[11px] text-[#3b5bdb]">
              {page.archetype}
            </span>
            {page.gatePassed && (
              <span
                data-testid="gate-passed"
                className="rounded bg-green-50 px-2 py-0.5 text-[11px] text-green-700"
              >
                过检查{page.attempts && page.attempts > 1 ? `（第 ${page.attempts} 版）` : ""}
              </span>
            )}
            {toast && (
              <span
                data-testid="assembled-toast"
                className="rounded bg-green-50 px-2 py-0.5 text-[11px] text-green-700"
              >
                {toast}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {savedAs ? (
                <span
                  data-testid="preset-saved"
                  className="rounded bg-green-50 px-2 py-1 text-[11.5px] text-green-700"
                >
                  已存入「{savedAs}」模板库
                </span>
              ) : (
                <button
                  data-testid="assembled-save"
                  disabled={saving}
                  onClick={() => void save()}
                  className="rounded-lg bg-[#5b6cff] px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-50"
                >
                  {saving ? "存入中…" : "存成模板"}
                </button>
              )}
              <button
                className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-500 transition hover:bg-slate-100"
                onClick={onClose}
              >
                关闭
              </button>
            </div>
          </div>
          {page.tasks?.length > 0 && (
            <div
              data-testid="page-tasks"
              className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500"
            >
              <span className="text-slate-400">用户在这一页要：</span>
              {page.tasks.map(t => (
                <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#f0f2f5] p-4">
          <div className="mx-auto max-w-[1200px]">
            {topRegions.map(r => (
              <Panel key={r.key} r={r} />
            ))}
            <div className="flex flex-wrap gap-3">
              <div className="min-w-[320px] flex-[2]">
                {mainRegions.map(r => (
                  <Panel key={r.key} r={r} />
                ))}
              </div>
              {asideRegions.length > 0 && (
                <div className="min-w-[240px] flex-1">
                  {asideRegions.map(r => (
                    <Panel key={r.key} r={r} />
                  ))}
                </div>
              )}
            </div>
            {/* 浮层区：渲染出来就是几个按钮，点了才有东西 —— 它一点页面空间
                都不占，这正是 overlay 这个权重的意思。 */}
            {overlayRegions.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {overlayRegions.flatMap(r => region(r.key).map(renderBlock))}
              </div>
            )}
          </div>
        </div>

        {/* 底部操作条 —— 照 pro-blocks 的 FooterToolbar：**贴在容器底部，
            不随内容滚**。这跟 overlay 不是一回事（overlay 点了才出来），
            也不能塞进正文流里：长表单把提交按钮放在表单末尾，用户得滚到底
            才看得见它，也看不见自己错在哪。所以它在滚动区外面。 */}
        {footerRegions.length > 0 && (
          <div
            data-testid="region-band-footer"
            className="shrink-0 border-t border-slate-200 bg-white px-4 py-2"
          >
            <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-2">
              {footerRegions.flatMap(r => region(r.key).map(renderBlock))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 收藏/最近的读写口。**一个类型，四处共用**（两面墙 + 两种卡片）。
 *
 * 收成一个对象而不是四个 prop 各传一遍：这一页已经在"加一样东西要改几处"
 * 上栽过两次（漏传 prop、漏 useMemo 依赖），两次的表现都是界面看着正常、
 * 点了没反应。
 */
export interface MarkApi {
  isFav: (id: string) => boolean;
  onToggleFav: (id: string) => void;
  onUse: (id: string) => void;
  pass: (id: string) => boolean;
}

/**
 * 收藏星。两面墙共用一个。
 *
 * `stopPropagation` 是必需的：卡片本身点一下算"用过一次"（记进最近使用），
 * 而点星星是收藏，不该同时把它记成用过——用户只是在整理，不是在挑。
 */
function FavStar({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="fav-star"
      data-on={on ? "1" : "0"}
      aria-label={on ? "取消收藏" : "收藏"}
      onClick={e => {
        e.stopPropagation();
        onToggle();
      }}
      // `self-center`：基础组件卡的标题行是 `items-baseline`（组件名和中文名
      // 按基线对齐，那是对的）。图标按钮没有文字基线，跟着基线走会**偏上
      // 3.3px**（实测）。这一个跟着行中线走，其余不动。
      className="shrink-0 self-center rounded p-0.5 text-slate-300 transition hover:text-amber-400"
    >
      <Star
        className="h-3.5 w-3.5"
        strokeWidth={2}
        // 收藏了就填实。只靠颜色区分的话，色觉障碍用户看不出收没收藏。
        fill={on ? "currentColor" : "none"}
        color={on ? "#f59e0b" : undefined}
      />
    </button>
  );
}

/**
 * 基础组件墙 —— 官方组件的通用示例。
 *
 * 与区块墙的区别在**这一层没有槽位、没有绑定、没有设备档**：一个 Input 就是
 * 一个 Input，不存在"它该放在主区还是副区"。所以这里的筛选只有一个维度：
 * 官方分组（通用/布局/导航/数据录入/数据展示/反馈）。
 *
 * 排布仍用 SpanMasonry（跟另外两面墙同一个组件），但一律单列宽：官方示例
 * 高度差得很多（一个 Divider 三十几像素，一个 Calendar 两百多），瀑布流正好
 * 吃这个，而跨列在这里没有意义——没有哪个基础组件"需要整行宽才说得清"。
 */
function BaseComponentWall({
  group,
  platform,
  linked,
  source,
  /** 有查询词时只画命中的这些名字，且按这个次序（null = 没在搜） */
  searchOrder,
  marks,
}: {
  group: string;
  platform: string;
  linked: string;
  source: string;
  searchOrder: Map<string, number> | null;
  marks: MarkApi;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { scrollTop, isScrolling, height } = useScrollerIn(containerRef);
  const { width } = useContainerPosition(containerRef, [height]);
  // 两个维度都从统一筛选条来（见 filterDims）——墙自己不再另摆一排 chip。
  const shown = React.useMemo(
    () =>
      BASE_COMPONENTS.filter(c => {
        // 搜索优先：在搜的时候，分类维度让位于相关度（跟区块墙同一条规矩）
        if (searchOrder && !searchOrder.has(c.name)) return false;
        if (!marks.pass(`base:${c.name}`)) return false;
        if (group !== "all" && c.group !== group) return false;
        if (platform !== "all" && c.platform !== platform) return false;
        if (source !== "all" && c.source !== source) return false;
        const usage = COMPONENT_USAGE.get(c.name);
        if (linked === "linked" && (usage?.allBlocks.length ?? 0) === 0) return false;
        if (linked === "desktop" && (usage?.desktopBlocks.length ?? 0) === 0) return false;
        if (linked === "phone" && (usage?.phoneBlocks.length ?? 0) === 0) return false;
        if (linked === "unlinked" && (usage?.allBlocks.length ?? 0) > 0) return false;
        return true;
      }).sort((a, b) =>
        searchOrder
          ? (searchOrder.get(a.name) ?? 0) - (searchOrder.get(b.name) ?? 0)
          : 0
      ),
    // **四个维度都得在这里**。2026-08-08 加「来源」时只加了上面那行 filter、
    // 忘了这个依赖数组，结果是：pill 显示「来源: Ant Design」，列表纹丝不动
    // ——memo 命中旧结果，筛选看着像没接上。
    //
    // 这个形状这个项目已经遇到第三次了（漏传 prop / 漏读通道 / 漏依赖），
    // 共同点都是"加一样东西要改两处，漏了不报错"。所以下面那条用例是从
    // filter 体里**把用到的变量抠出来**跟依赖数组对，而不是钉死这四个名字。
    [group, platform, linked, source, searchOrder, marks]
  );

  return (
    <>
      <div data-testid="base-wall" style={{ display: "contents" }}>
        <SpanMasonry
          containerRef={containerRef}
          items={shown}
          width={width}
          height={height}
          scrollTop={scrollTop}
          isScrolling={isScrolling}
          minColumnWidth={WALL_COLUMN_WIDTH}
          gutter={WALL_GUTTER}
          overscanBy={2}
          itemHeightEstimate={180}
          itemKey={c => c.name}
          getSpan={() => 1}
          className="mt-5"
          render={c => (
            <Card
              data-testid={`base-card-${c.name}`}
              size="small"
              variant="borderless"
              styles={{ body: { padding: 0, overflow: "hidden" } }}
              className="w-full"
              style={{ boxShadow: CARD_SHADOW }}
              // 点一下算"用过一次"。这是「最近使用」的唯一来源——组件库是拿来
              // 挑东西的，挑的动作就是看，没有别的更强的信号。
              onClick={() => marks.onUse(`base:${c.name}`)}
            >
              <div className="border-b border-slate-100 px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13.5px] font-semibold text-slate-900">{c.name}</span>
                  <span className="text-[12px] text-slate-500">{c.label}</span>
                  <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-500">
                    {c.group}
                  </span>
                  <FavStar
                    on={marks.isFav(`base:${c.name}`)}
                    onToggle={() => marks.onToggleFav(`base:${c.name}`)}
                  />
                </div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
                  {c.description}
                </div>
                {/* 这个素材被哪些区块用了 —— 三层链路（基础组件 → 区块 → 模板）
                    的第一环，正着反着都得看得见。
                    
                    一个区块都没用到的，如实标「还没接进区块」：那意味着它目前
                    **不可能出现在任何生成的应用里**。这是覆盖缺口，不是 bug，
                    但看不见它就没法有意识地补。 */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {(COMPONENT_USAGE.get(c.name)?.allBlocks.length ?? 0) > 0 ? (
                    <>
                      <span className="text-[10.5px] text-slate-400">真实渲染使用</span>
                      {([
                        ...(COMPONENT_USAGE.get(c.name)?.desktopBlocks ?? []).map(block => ({ block, device: "桌面" })),
                        ...(COMPONENT_USAGE.get(c.name)?.phoneBlocks ?? []).map(block => ({ block, device: "手机" })),
                      ] as Array<{ block: string; device: string }>).slice(0, 8).map(({ block, device }) => (
                        <span
                          key={`${device}-${block}`}
                          className="rounded bg-[#e8eeff] px-1.5 py-0.5 text-[10.5px] text-[#3b5bdb]"
                        >
                          {device} · {block}
                        </span>
                      ))}
                      {(COMPONENT_USAGE.get(c.name)?.desktopBlocks.length ?? 0) +
                        (COMPONENT_USAGE.get(c.name)?.phoneBlocks.length ?? 0) > 8 && (
                        <span className="text-[10.5px] text-slate-400">
                          +{(COMPONENT_USAGE.get(c.name)?.desktopBlocks.length ?? 0) +
                            (COMPONENT_USAGE.get(c.name)?.phoneBlocks.length ?? 0) - 8}
                        </span>
                      )}
                    </>
                  ) : (
                    <span
                      data-testid="base-unused"
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-400"
                    >
                      还没接进区块
                    </span>
                  )}
                </div>
              </div>
              {/* 示例本体。给一点内边距——这一层不像业务积木那样要铺满，
                  官方文档里每个 demo 也都是有留白的。 */}
              <div className="px-3 py-3">{c.render()}</div>
            </Card>
          )}
        />
      </div>
    </>
  );
}

/** 区块墙。抽成组件的理由同 AppsWorkbench 的 AppWall：里面全是 hook，
 * 而墙在「有结果 / 搜索无结果」两岔里只有一岔渲染，写在外层就成了条件调用。 */
function BlockWall({
  blocks,
  device,
  marks,
  page,
  onPageChange,
}: {
  blocks: CatalogBlock[];
  device: DeviceTier;
  marks: MarkApi;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { scrollTop, isScrolling, height } = useScrollerIn(containerRef);
  const { width } = useContainerPosition(containerRef, [height]);
  // 手机档只列**真有手机实现**的区块。
  //
  // 2026-08-07 用户裁决：「手机端就是手机端，桌面端就是桌面端。弄一个手机端
  // 桌面降级，这没意思的。」——此前没有手机实现的区块也会出现在手机档里，
  // 拿桌面渲染器塞进 380px 机身、挂一个橙色「桌面降级」角标。那个中间态被
  // 整个删掉：现在手机档列出来的每一张都是真手机渲染器。
  //
  // 「全部」档同理，一个区块出现一次还是两次，取决于它有没有手机实现。
  const entries = React.useMemo<BlockPreviewEntry[]>(
    () => buildComponentPreviewEntries(blocks, device, hasPhoneImplementation),
    [blocks, device]
  );
  const paged = React.useMemo(
    () => paginateComponentPreviews(entries, page),
    [entries, page]
  );

  return (
    <>
      <div data-testid="components-wall" style={{ display: "contents" }}>
        <SpanMasonry<BlockPreviewEntry>
        containerRef={containerRef}
        items={paged.items}
        width={width}
        height={height}
        scrollTop={scrollTop}
        isScrolling={isScrolling}
        minColumnWidth={WALL_COLUMN_WIDTH}
        gutter={WALL_GUTTER}
        // 当前页不做虚拟化（2026-08-09）。
        //
        // 50 屏的预渲染量 = 一次全画出来。不是调参，是一个决定：
        //
        // 虚拟化会把滚出视野的卡卸载、滚回来重挂。而这里每张卡都是一个**活的区块
        // 渲染**——QueryFilter、ProTable、ECharts。这类内容刚挂上来的那一两帧还没
        // 铺开，量到的高度偏小；量完再定位，整列跟着跳。浏览器插桩录到的原样：
        //     desktop-FilterBar  304->204  204->304  304->204 …
        // 每滚一个来回翻一次，它下面整列 ±100px。修前实测 1600 视口 17 帧里
        // 1 帧真重叠、33 次位移（最大 445px）；不卸载之后是 0 / 0。
        //
        // 换个角度这也是对的：卸载活组件会丢掉用户在演示里点出来的状态。
        //
        // 全目录不再交给这里：桌面/手机预览展开后先切成每页 20 张，当前页内部
        // 保持挂载，既不重现滚动卸载后的量高跳动，也不会一次启动整份目录。
        overscanBy={50}
        // 开沉降重排：这面墙 overscanBy=50 等于一次性全渲染、也不接 onReachEnd，
        // 不存在"随滚动逐批落位"，所以重选一次列不会在用户眼皮底下洗牌。
        // 不开的代价是列被冻在开场那批过期列宽下量的高度上——实测填充率
        // 75.0% vs 86.6%，见 SpanMasonry 的 settleLayout 文档。
        settleLayout
        // 实测各区块渲染高度 148~451px，取中位偏上；真实高度由 ResizeObserver 量，
        // 这个值只影响首屏还没量到时的总高估算。
        itemHeightEstimate={280}
        itemKey={entry => `${entry.device}-${entry.block.type}`}
        // 手机档不跨列：机身宽度是固定的 380px，跨两列只会让机身两侧多出空白，
        // 不会让内容变宽——跨列的前提是"内容能用上多出来的宽度"，这里用不上。
        getSpan={(entry, _i, columnCount) =>
          entry.device === "phone"
            ? 1
            : spanForColumnCount(isWideBlock(entry.block), columnCount)}
        className="mt-5"
        render={entry => (
          <BlockCard block={entry.block} device={entry.device} marks={marks} />
        )}
        />
      </div>
      {paged.total > COMPONENT_WALL_PAGE_SIZE && (
        <div className="mt-6 flex justify-center" data-testid="components-pagination">
          <Pagination
            current={paged.page}
            pageSize={COMPONENT_WALL_PAGE_SIZE}
            total={paged.total}
            onChange={onPageChange}
            showSizeChanger={false}
          />
        </div>
      )}
    </>
  );
}

export default function ComponentsLibraryPage() {
  // 区块 = 一个个积木；预设 = 已经排好的组合（2026-08-07）。
  // 预设是模型真正的起点，看不见它就没法判断生成质量的上限在哪，
  // 所以给它一个与"区块"并列的入口，而不是塞在某个角落。
  // 三档，对应三个层次（2026-08-08 用户澄清的分层）：
  //   base    基础组件 —— Ant Design 官方组件的通用示例，无业务数据
  //   blocks  体验区块 —— 绑数据模型的业务积木，有 binding/槽位/门禁
  //   presets 模板     —— AI 组装攒出来的，分行业
  //
  // **默认进「区块」**（2026-08-08 用户定的，原话）：「基础组件 /
  // ProComponents 更多作为底层能力」「用户首先看到：筛选栏、数据列表、编辑
  // 表单、统计概览、审批记录、附件区等真正能直接装进应用的东西」。
  //
  // 原来默认进基础组件那一档，是这一页刚建时只有那一档的历史遗留。目录长到
  // 217 条之后，一进来就是两百多个 Input/Button，反而把真正能用的东西埋了。
  const [mode, setMode] = React.useState<"base" | "blocks" | "presets">("blocks");
  const [baseGroup, setBaseGroup] = React.useState<string>("all");
  const [basePlatform, setBasePlatform] = React.useState<string>("all");
  const [baseLinked, setBaseLinked] = React.useState<string>("all");
  const [baseSource, setBaseSource] = React.useState<string>("all");
  // 收藏 / 最近使用（2026-08-08）。存 localStorage —— 这是个人的取用习惯，
  // 不是应用数据，见 component-marks.ts 的说明。
  const [favorites, setFavorites] = React.useState<string[]>(() => readFavorites());
  const [recent, setRecent] = React.useState<string[]>(() => readRecent());
  /** 全部 / 最近使用 / 收藏。三档共用，切档不重置——找东西时来回切很常见。 */
  const [marks, setMarks] = React.useState<"all" | "recent" | "fav">("all");
  const [assembled, setAssembled] = React.useState<AssembledPage | null>(null);

  /**
   * 收藏/最近的读写口。收成一个对象往下传，而不是四个 prop 各传一遍——
   * 这一页已经在"加一样东西要改几处"上栽过两次（漏传 prop、漏依赖）。
   */
  const markApi = React.useMemo(
    () => ({
      favorites,
      recent,
      isFav: (id: string) => favorites.includes(id),
      onToggleFav: (id: string) => setFavorites(toggleFavorite(id)),
      onUse: (id: string) => setRecent(markRecent(id)),
      /** 当前这一档要不要按标记筛，以及怎么筛。 */
      pass: (id: string) =>
        marks === "all" ||
        (marks === "fav" ? favorites.includes(id) : recent.includes(id)),
    }),
    [favorites, recent, marks]
  );
  // 意图 —— 五阶段的第一阶段。说不出"这一页是给谁用的、要干什么"，后面
  // 全是猜的，所以它是必填而不是可选的高级选项。
  const [intent, setIntent] = React.useState("");
  const [askIntent, setAskIntent] = React.useState(false);
  const [baseBusy, setBaseBusy] = React.useState(false);

  /**
   * 从基础组件抽一屏 —— 传的是**当前筛选之后还在墙上的那些**，跟业务积木
   * 那条传 allowedTypes 同一条规矩：从看得见的里面抽。切到「数据录入」再点，
   * 抽出来的就是一屏全是录入件的东西，这是有意义的行为而不是 bug。
   */
  /**
   * 五阶段装配：意图 → 范式 → 区块 → 实例 → Gate。
   *
   * 换掉了此前那条"给模型 137 个基础组件的清单让它选几个排出来"——那条
   * 抽出来的是组件示例合集（Menu/Input/Button/Table/Pagination 各一张等大
   * 的卡，内容还是「甲 乙 12 34」）。区别不在提示词，在装配目标。
   *
   * 这里**不传组件清单**：候选集是服务端的业务区块，基础组件由区块自己解析，
   * 模型从头到尾不会命名一个组件。
   */
  const runAssemble = async () => {
    if (assembling) return;
    const text = intent.trim();
    if (!text) {
      setAskIntent(true);
      return;
    }
    setAssembling(true);
    setAssembleError(null);
    try {
      const res = await fetch("/api/sliderule/components/assemble-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: text,
          datamodel: {
            entities: [
              {
                id: "order",
                name: "订单",
                fields: Object.keys(FIELD_TYPE).map(id => ({
                  id,
                  name: FIELD_LABEL[id] ?? id,
                  type: FIELD_TYPE[id],
                })),
              },
            ],
          },
        }),
      });
      const body = (await res.json()) as AssembledPage & {
        ok?: boolean;
        error?: string;
        findings?: { code: string; why: string }[];
      };
      if (!res.ok || !body.ok) {
        // Gate 没过就如实说哪条没过——不降级展示一个坏页面。
        const why = (body.findings ?? []).map(f => f.why).join("；");
        setAssembleError(why ? `${body.error}：${why}` : body.error || `装配失败（HTTP ${res.status}）`);
        return;
      }
      setAssembled(body);
      setAskIntent(false);
    } catch (e) {
      setAssembleError(String(e instanceof Error ? e.message : e));
    } finally {
      setAssembling(false);
    }
  };
  const [assembling, setAssembling] = React.useState(false);
  const [assembleError, setAssembleError] = React.useState<string | null>(null);

  /**
   * AI 组装区块 —— 链路上的**另一次**组装（2026-08-08 用户定的分层）。
   *
   *   看模板档 → 组装模板：从现有区块里挑，摆进页面区域 → 产物是数据，直接渲染
   *   看组件档 → 组装区块：从基础组件里挑，定义一个新区块 → 产物是契约，人来实现
   *
   * 后者不生成代码，这是查过 GitHub 之后的判断：Ant Design 官方那个仓库就叫
   * `pro-blocks`，29 个「区块」（分析页/工作台/查询表格/高级详情/分步表单…）
   * **全是手写 React 源码**，`umi block add` 是把源码拷进项目的脚手架，不是
   * 运行时拼装。区块 = schema + 逻辑 + 关联，逻辑就是代码。
   *
   * 所以这里让模型做的是设计：看着 118 个还没被任何区块用上的素材，说出还缺
   * 哪个区块、它收什么、绑什么、落哪些区域。基础组件清单从这一侧传过去——
   * 那份目录是 TSX（每条挂着真实 render），搬不到 Python 侧。
   */
  const [proposals, setProposals] = React.useState<BlockProposalResult | null>(null);
  const runProposeBlocks = async () => {
    if (assembling) return;
    setAssembling(true);
    setAssembleError(null);
    try {
      const res = await fetch("/api/sliderule/components/propose-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseComponents: BASE_COMPONENTS.map(c => ({
            name: c.name,
            label: c.label,
            group: c.group,
            platform: c.platform,
            description: c.description,
            usedBy: BLOCKS_USING[c.name] ?? [],
          })),
        }),
      });
      const body = (await res.json()) as BlockProposalResult & {
        ok?: boolean;
        error?: string;
        findings?: { code: string; why: string }[];
      };
      if (!res.ok || !body.ok) {
        const why = (body.findings ?? []).map(f => f.why).join("；");
        setAssembleError(
          why ? `${body.error}：${why}` : body.error || `提议失败（HTTP ${res.status}）`
        );
        return;
      }
      setProposals(body);
    } catch (e) {
      setAssembleError(String(e instanceof Error ? e.message : e));
    } finally {
      setAssembling(false);
    }
  };

  const [device, setDevice] = React.useState<DeviceTier>("all");
  const [blockPage, setBlockPage] = React.useState(1);
  const [query, setQuery] = React.useState("");
  const [slot, setSlot] = React.useState<string>("all");
  // 默认不筛：档位上标着几个区块，点进来就该看得见几个。device / slot 本来
  // 就都是 "all"，此前只有这一维写死了具体范式，是这一排里唯一的例外。
  const [pageKind, setPageKind] = React.useState("all");

  const blocks = CATALOG.blocks ?? [];
  /**
   * 模板库 —— **攒出来的，不是手写的**（2026-08-08 改）。
   *
   * 此前这里读的是目录 JSON 里我手写的十套 pageKindPresets。那批是死的、
   * 每次一样，而且其中三套推荐的 DataTable 在真实应用里会被渲染层直接丢掉
   * ——手写的东西没法验证，也不会自己变多。
   *
   * 现在读的是 AI 组装攒进库里的：点一次「AI 组装」抽一次盲盒，觉得好就
   * 「存成模板」，AI 判的行业跟着一起存。组件从十几个长到三五百个的过程中，
   * 抽出来的东西越来越丰富，这个库跟着长。
   *
   * 筛选维度也随之从"页面形态"换成**行业**——页面形态是我们内部的结构分类，
   * 行业才是用户找模板时真正会用的那个词。
   */
  const [presets, setPresets] = React.useState<SavedPreset[]>([]);
  const [industries, setIndustries] = React.useState<{ industry: string; count: number }[]>([]);
  const [industry, setIndustry] = React.useState<string>("all");
  const presetCount = industries.reduce((n, x) => n + x.count, 0);

  const loadPresets = React.useCallback(async () => {
    try {
      const res = await fetch("/api/sliderule/components/presets");
      if (!res.ok) return;
      const body = (await res.json()) as {
        presets?: SavedPreset[];
        industries?: { industry: string; count: number }[];
      };
      setPresets(body.presets ?? []);
      setIndustries(body.industries ?? []);
    } catch {
      // 模板库拉不到不该让整页挂掉——区块视图本来就不依赖它
    }
  }, []);
  React.useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const shownPresets =
    industry === "all" ? presets : presets.filter(p => p.industry === industry);

  /**
   * 当前范式下的区块。`"all"` 是**不筛**，不是"某个叫 all 的范式"。
   *
   * 2026-08-08 修：原来这里只有精确匹配，而范式那栏的选项里没有「全部」，
   * 于是「清空」（把每个维度都置成 `"all"`）之后去找 `pageKinds` 含 `"all"`
   * 的区块——目录里一个都没有（取值只有 workbench/dashboard/monitor/kanban/
   * calendar/wizard），页面直接变成「没有匹配的区块」。
   *
   * 同一个根还引出第二个症状：初值写死 `"workbench"` 且没有「全部」可选，
   * 所以这一档**永远在筛**，档位上标着 16 个区块，进去最多只看得见 13 个，
   * 没有任何一个状态能看到全部。
   */
  const pageKindBlocks = React.useMemo(
    () =>
      pageKind === "all"
        ? blocks
        : blocks.filter(block => (block.pageKinds ?? []).includes(pageKind)),
    [blocks, pageKind]
  );

  /**
   * 当前模式下**适用**的筛选维度。
   *
   * 这就是"级联关系"的正解：不适用的维度根本不构造出来，于是它在界面上
   * 不存在——而不是存在但点不动。此前三行 chip 常驻，在基础组件档下摆着
   * 区块的槽位筛选，点了什么也不会发生。
   */
  const filterDims = React.useMemo<FilterDim[]>(() => {
    /**
     * 「标记」维度三档共用（2026-08-08）。
     *
     * 用户原话：「全部 / 最近使用 / 收藏」「对几百个组件以后非常有必要」。
     * 放在最前面：目录 217 条的时候，"我上次用的那个叫啥来着"比任何一个
     * 分类维度都更常问。
     *
     * 计数是**当前档位下**的数，不是全局数——在区块档看到「收藏 3」，指的
     * 就是这一档里收藏了 3 个，点进去正好 3 个。全局数会对不上，那比没有
     * 计数更糟。
     */
    const idsHere =
      mode === "base"
        ? BASE_COMPONENTS.map(c => `base:${c.name}`)
        : mode === "blocks"
          ? blocks.map(b => `block:${b.type}`)
          : [];
    const markDim: FilterDim = {
      key: "marks",
      label: "标记",
      value: marks,
      onChange: v => setMarks(v as "all" | "recent" | "fav"),
      options: [
        { value: "all", label: "全部", count: idsHere.length },
        { value: "recent", label: "最近使用", count: idsHere.filter(id => recent.includes(id)).length },
        { value: "fav", label: "收藏", count: idsHere.filter(id => favorites.includes(id)).length },
      ],
    };

    if (mode === "base") {
      const byGroup: Record<string, number> = {};
      const byPlatform: Record<string, number> = {};
      const bySource: Record<string, number> = {};
      for (const c of BASE_COMPONENTS) {
        byGroup[c.group] = (byGroup[c.group] ?? 0) + 1;
        byPlatform[c.platform] = (byPlatform[c.platform] ?? 0) + 1;
        if (c.source) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
      }
      return [
        markDim,
        {
          key: "capability",
          label: "能力",
          value: baseGroup,
          onChange: setBaseGroup,
          options: [
            { value: "all", label: "全部", count: BASE_COMPONENTS.length },
            ...BASE_GROUPS.filter(g => byGroup[g]).map(g => ({
              value: g,
              label: g,
              count: byGroup[g],
            })),
          ],
        },
        {
          key: "linked",
          label: "接入",
          value: baseLinked,
          onChange: setBaseLinked,
          options: [
            { value: "all", label: "全部", count: BASE_COMPONENTS.length },
            {
              value: "linked",
              label: `已采用组件种类（${COMPONENT_USAGE_STATS.desktopRelations + COMPONENT_USAGE_STATS.phoneRelations} 条关联）`,
              count: COMPONENT_USAGE_STATS.any,
            },
            {
              value: "desktop",
              label: `桌面已采用（${COMPONENT_USAGE_STATS.desktopRelations} 条关联）`,
              count: COMPONENT_USAGE_STATS.desktop,
            },
            {
              value: "phone",
              label: `手机已采用（${COMPONENT_USAGE_STATS.phoneRelations} 条关联）`,
              count: COMPONENT_USAGE_STATS.phone,
            },
            {
              value: "unlinked",
              label: "两端都未接入",
              count: COMPONENT_USAGE_STATS.unlinked,
            },
          ],
        },
        {
          key: "platform",
          label: "端",
          value: basePlatform,
          onChange: setBasePlatform,
          options: [
            { value: "all", label: "全部", count: BASE_COMPONENTS.length },
            { value: "pc", label: "桌面端", count: byPlatform.pc ?? 0 },
            { value: "mobile", label: "手机端", count: byPlatform.mobile ?? 0 },
          ],
        },
        // 来源（2026-08-08）。这一栏不只是筛选，它把"下一个量级从哪来"直接
        // 摆在界面上：antd 两档基本到顶（78 收 67 / 83 收 78），能长的是
        // ProComponents 和自定义那两档。
        {
          key: "source",
          label: "来源",
          value: baseSource,
          onChange: setBaseSource,
          options: [
            { value: "all", label: "全部", count: BASE_COMPONENTS.length },
            ...BASE_SOURCES.filter(x => bySource[x.value]).map(x => ({
              value: x.value,
              label: x.label,
              count: bySource[x.value],
            })),
          ],
        },
      ];
    }
    if (mode === "presets") {
      return [
        {
          key: "industry",
          label: "行业",
          value: industry,
          onChange: setIndustry,
          options: [
            { value: "all", label: "全部", count: presetCount },
            ...industries.map(x => ({ value: x.industry, label: x.industry, count: x.count })),
          ],
        },
      ];
    }
    // 区块档：范式（页面形态）+ 区域（槽位）。计数跟着上一级走——
    // 槽位数说的是"在当前这类页面里这个槽位有几个区块可用"。
    return [
      markDim,
      {
        key: "pageKind",
        label: "范式",
        value: pageKind,
        onChange: setPageKind,
        options: [
          // 「全部」必须在场：下面的「清空」会把每个维度都置成 "all"，选项里
          // 没有它就等于把用户清进一个选不回来的空集（见 pageKindBlocks 注释）。
          { value: "all", label: "全部", count: blocks.length },
          ...PAGE_KINDS.map(k => ({
            value: k.key,
            label: k.label,
            count: blocks.filter(b => (b.pageKinds ?? []).includes(k.key)).length,
          })),
        ],
      },
      {
        key: "slot",
        label: "区域",
        value: slot,
        onChange: setSlot,
        options: [
          { value: "all", label: "全部", count: pageKindBlocks.length },
          ...Object.keys(CATALOG.pageRegions ?? {}).map(sl => ({
            value: sl,
            label: SLOT_LABEL[sl] ?? sl,
            count: pageKindBlocks.filter(b => (b.allowedRegions ?? []).includes(sl)).length,
          })),
        ],
      },
    ];
  }, [
    mode,
    baseGroup,
    basePlatform,
    baseLinked,
    baseSource,
    marks,
    favorites,
    recent,
    industry,
    industries,
    presetCount,
    pageKind,
    slot,
    blocks,
    pageKindBlocks,
  ]);

  /**
   * 搜索结果**跨档**（2026-08-08）。
   *
   * 用户原话：搜「我要选择客户」这种话，「最终匹配到区块 + 能力组件 +
   * 基础组件」。所以一旦有查询词，就不再按当前档位分开看——三层一起排。
   *
   * 顺带修掉一个既有的哑巴：原来这一行 `includes(kw)` 只作用于区块那一档，
   * **基础组件档下敲什么都没反应**（实测）。搜索框却一直挂在页面顶上。
   */
  /**
   * 换了搜索词/档位/标记就**滚回顶部**（2026-08-08）。
   *
   * 理由很朴素：结果按相关度排，第一名在最上面，而人可能停在第三屏。不回顶
   * 的话，搜完看到的是一段跟查询词无关的中部内容。
   *
   * **不是**为了绕开渲染问题。调这段时台子上出现过"搜完一张卡都不渲染"，
   * 一度以为是虚拟滚动窗口跑到内容之外——查下来是台子自己的错：外层写了
   * `overflow: hidden`，useScrollerIn 找不到可滚祖先退回 window，量出来的
   * scrollTop 跟真实应用（滚 .native-content）对不上。台子改成 auto 之后
   * 渲染一直是对的。记在这里免得以后有人照着那个错误结论去改渲染。
   */
  const scrollAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const backToTop = React.useCallback(() => {
    const el = scrollAnchorRef.current;
    if (!el) return;
    const scroller = findScrollParent(el);
    if (scroller) scroller.scrollTo({ top: 0 });
    else window.scrollTo({ top: 0 });
  }, []);

  React.useEffect(() => {
    setBlockPage(1);
  }, [query, mode, marks, device, pageKind, slot, favorites, recent]);

  const searchHits = React.useMemo(
    () => (query.trim() ? SEARCH.search(query) : null),
    [query]
  );

  React.useEffect(() => {
    backToTop();
    // 这四样一变，"当前看到的那一段"就跟新结果对不上了 —— 搜索词、档位、
    // 标记、来源。分类维度（能力/端/槽位）不列：那几个通常只是把长列表再收
    // 窄一点，人还在原来那一段附近，硬拽回顶反而烦。
  }, [query, mode, marks, baseSource, backToTop]);

  const filtered = React.useMemo(() => {
    // 有查询词时，区块墙只画搜索命中的那些，次序也按相关度来
    if (searchHits) {
      const rank = new Map(searchHits.filter(d => d.kind === "block").map((d, i) => [d.name, i]));
      return pageKindBlocks
        .filter(b => rank.has(b.type) && markApi.pass(`block:${b.type}`))
        .sort((a, b) => (rank.get(a.type) ?? 0) - (rank.get(b.type) ?? 0));
    }
    return pageKindBlocks.filter(
      b =>
        (slot === "all" || (b.allowedRegions ?? []).includes(slot)) &&
        markApi.pass(`block:${b.type}`)
    );
  }, [pageKindBlocks, searchHits, slot, markApi]);

  // 先筛后铺：铺开只影响展示次序，不影响筛出来的集合。
  // 手机档不跨列，也就没有"宽卡挤成一坨"的问题，保持目录原序更好读。
  const ordered = React.useMemo(
    () =>
      // 搜的时候**不铺**：interleaveWide 是为了让宽卡不挤在一起而重排次序，
      // 那在浏览时是好事，在搜索结果里是把相关度顺序打乱——用户按相关度
      // 从上往下看，第一名被挪到第五个就没意义了。
      searchHits || device === "phone" ? filtered : interleaveWide(filtered),
    [filtered, device, searchHits]
  );
  return (
    <LibraryPreviewScope>
    <div
      ref={scrollAnchorRef}
      data-testid="components-library"
      className="px-6 pb-10 pt-5 md:px-8 md:pt-6"
      style={{ overflowAnchor: "none" }}
    >
      {/* 吸顶头：与应用中心同一套（-mx/-mt 抵消外层内边距，保证背景铺满） */}
      <div className="sticky top-0 z-30 -mx-6 -mt-5 bg-[var(--sr-shell-bg,#f4f4f6)] px-6 pt-5 pb-3 md:-mx-8 md:-mt-6 md:px-8 md:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {/* 标题块：8×8 圆角底座 + lucide LayoutGrid + #5b6cff，与 AppsWorkbench
              一模一样。原来是裸的 AppstoreOutlined，既没有底座、色号也是 #1677ff。 */}
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5b6cff]">
              <LayoutGrid size={18} strokeWidth={2.2} />
            </span>
            <h1 className="text-[18px] font-bold tracking-tight text-slate-900 md:text-[20px]">
              体验区块库
            </h1>
          </div>

          {/* 搜索框：应用中心那个自绘的（无边框 + 半透明底 + ring），不是
              antd Input.Search——后者自带搜索按钮和另一套高度/边框，摆在一起
              一眼就看得出是两个东西。 */}
          <div className="relative w-full min-w-[200px] flex-1 sm:mx-4 sm:max-w-xl md:max-w-2xl">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              data-testid="components-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="说人话也行：我要选择客户 / 做一个订单筛选 / 显示销售趋势…"
              className="w-full rounded-lg border-0 bg-white/70 py-2.5 pl-10 pr-4 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200/60 placeholder:text-slate-400 transition focus:bg-white focus:ring-2 focus:ring-[#5b6cff]/25"
            />
          </div>
        </div>

        {/* 模式切换 = Polaris 的 tabs：**先选看哪一层**，再谈筛什么。
            三层的维度互不相干（基础组件看能力/端、区块看范式/区域、模板看行业），
            所以层必须在筛选之上——放在同一行会让人以为它们是并列的筛选项。 */}
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5"
          data-testid="components-mode-switch"
        >
          {/* 次序也跟着换：区块在最前。档位条从左到右读，第一个就是"默认
              该看哪个"的视觉声明——默认改了而次序没改，等于自己打自己。 */}
          <FilterChip
            testid="components-mode-blocks"
            label="区块"
            count={blocks.length}
            active={mode === "blocks"}
            onClick={() => setMode("blocks")}
          />
          <FilterChip
            testid="components-mode-base"
            label="基础组件"
            count={BASE_COMPONENTS.length}
            active={mode === "base"}
            onClick={() => setMode("base")}
          />
          <FilterChip
            testid="components-mode-presets"
            label="模板"
            count={presetCount}
            active={mode === "presets"}
            onClick={() => setMode("presets")}
          />
          {/* 按钮跟着档位走 —— 因为**这条链路上有两次组装，方向不同**
              （2026-08-08 用户定的分层）：

                看基础组件/区块 → 组装区块：从素材里挑，定义一个新区块
                看模板         → 组装模板：从现有区块里挑，摆进页面区域

              标签跟着档位变，动作也跟着变；只改标签不改动作就是骗人。 */}
          <button
            type="button"
            data-testid="components-assemble"
            disabled={assembling}
            onClick={() => void (mode === "presets" ? runAssemble() : runProposeBlocks())}
            className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-50"
          >
            <Sparkles size={13} />
            {assembling
              ? mode === "presets"
                ? "组装中…"
                : "提议中…"
              : mode === "presets"
                ? "AI 组装模板"
                : "AI 组装区块"}
          </button>
        </div>

        {/* 筛选维度**按模式给**——不适用的根本不出现，而不是出现了点不动。
            这是用户说的"级联关系承载不住"的正解：基础组件档只有能力和端，
            区块档才有范式和区域，模板档只有行业。 */}
        <FilterBarRow
          dims={filterDims}
          extra={
            mode === "blocks" ? (
              <span className="contents" data-testid="components-device-switch">
                <FilterChip label="全部" active={device === "all"} onClick={() => setDevice("all")} />
                <FilterChip
                  icon={<Monitor size={13} className="text-slate-400" />}
                  label="桌面档"
                  active={device === "desktop"}
                  onClick={() => setDevice("desktop")}
                />
                <FilterChip
                  icon={<Smartphone size={13} className="text-slate-400" />}
                  label="手机档"
                  active={device === "phone"}
                  onClick={() => setDevice("phone")}
                />
              </span>
            ) : undefined
          }
        />
      </div>

      {/* 意图输入 —— 五阶段的第一阶段，摆在明面上。
          
          此前那条链路根本没有这一步：模型直接从组件清单开始挑，所以它永远
          不知道"用户在这一页要干什么"，出来的当然是组件合集。说不出意图就
          装配不了，这不是苛刻，是那一步本来就绕不过去。 */}
      {/* 只在模板档问意图 —— 组装区块问的不是"这一页干什么"，是"还缺哪个
          区块"，它看的是覆盖缺口，不需要意图。留着会变成切档之后一个点了
          没反应的输入框。 */}
      {mode === "presets" && askIntent && (
        <div
          data-testid="intent-prompt"
          className="mt-4 rounded-lg bg-white p-3 shadow-[0_1px_6px_rgba(15,23,42,0.08)]"
        >
          <div className="text-[12.5px] font-medium text-slate-700">
            这一页是给谁用的、他要在这儿完成什么？
          </div>
          <div className="mt-1 text-[11.5px] text-slate-400">
            说清楚任务，装配才有依据。例如：仓管每天查看商品库存、筛出缺货的、新增商品、补货
          </div>
          <div className="mt-2 flex gap-2">
            <input
              data-testid="intent-input"
              autoFocus
              value={intent}
              onChange={e => setIntent(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") void runAssemble();
              }}
              placeholder="例如：门店店长每天查看订单、按状态筛选、新建订单"
              className="flex-1 rounded-lg border-0 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200 focus:bg-white focus:ring-2 focus:ring-[#5b6cff]/25"
            />
            <button
              data-testid="intent-go"
              disabled={assembling || !intent.trim()}
              onClick={() => void runAssemble()}
              className="rounded-lg bg-[#5b6cff] px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-50"
            >
              {assembling ? "装配中…" : "开始装配"}
            </button>
          </div>
        </div>
      )}

      {assembleError && (
        <div
          data-testid="assemble-error"
          className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-600"
        >
          {assembleError}
        </div>
      )}
      {assembled && (
        <AssembledPageModal
          page={assembled}
          onClose={() => setAssembled(null)}
          onSaved={() => void loadPresets()}
        />
      )}

      {proposals && (
        <BlockProposalModal result={proposals} onClose={() => setProposals(null)} />
      )}

      {mode === "base" ? (
        <BaseComponentWall
          group={baseGroup}
          platform={basePlatform}
          linked={baseLinked}
          source={baseSource}
          searchOrder={
            searchHits
              ? new Map(
                  searchHits.filter(d => d.kind === "base").map((d, i) => [d.name, i])
                )
              : null
          }
          marks={markApi}
        />
      ) : mode === "presets" ? (
        <>
          {/* 行业筛选：取值来自库里真实存在的行业，不是我们预先定死的一张表。
              AI 判出什么行业，这里就有什么——库长什么样，筛选就长什么样。 */}
          {industries.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <FilterChip
                label="全部行业"
                count={presetCount}
                active={industry === "all"}
                onClick={() => setIndustry("all")}
              />
              {industries.map(x => (
                <FilterChip
                  key={x.industry}
                  label={x.industry}
                  count={x.count}
                  active={industry === x.industry}
                  onClick={() => setIndustry(x.industry)}
                />
              ))}
            </div>
          )}
          {shownPresets.length === 0 ? (
            <Empty
              description="模板库还是空的 —— 点右上角「AI 组装」抽一套，觉得好就存下来"
              className="py-16"
            />
          ) : (
            // 单列：一套模板本身就是一整页的排布，塞进瀑布流的窄列会把
            // "2/3 主区 + 1/3 副区"压成两条竖条，那正好把要看的东西看没了。
            <div className="mt-5 flex flex-col gap-4">
              {shownPresets.map(ps => (
                <SavedPresetCard key={ps.id} preset={ps} />
              ))}
            </div>
          )}
        </>
      ) : filtered.length === 0 ? (
        <Empty description="没有匹配的区块" className="py-16" />
      ) : (
        <BlockWall
          blocks={ordered}
          device={device}
          marks={markApi}
          page={blockPage}
          onPageChange={nextPage => {
            setBlockPage(nextPage);
            backToTop();
          }}
        />
      )}
    </div>
    </LibraryPreviewScope>
  );
}
