/**
 * autopilot-image-rendering-and-visual-system · Phase 3 / Task 23.1
 *
 * `EffectPreviewScheduleTimeline` — effect_preview 阶段的节点出图调度时间线。
 *
 * 在 Phase 1 右侧 rail 槽位渲染：当 `activeStageKey === "effect_preview"` 时挂载，
 * 其它阶段返回 `null`。组件同时消费 `progressPlan[]`（每个节点的状态、降级层级）
 * 与 `dependencyOrder[]`（拓扑顺序）；当 `dependencyOrder` 发生变化导致节点重新排序时，
 * 通过 Framer Motion 的 `AnimatePresence` + `layoutId={nodeId}` 完成 FLIP
 * 位移过渡，节点在新旧位置之间平滑滑动而不是跳变。
 *
 * 取色契约（Phase 2 视觉令牌单一替换点）：
 * - 颜色统一从 `@/lib/autopilot/visual-tokens-placeholder` 通过 `resolveToken(key, theme)`
 *   或注入的 `visualTokens` 取得；组件内部 **禁止** 出现 `#`、`rgb(`、`hsl(`、`oklch(` 字面量。
 * - 状态色映射（`ProgressPlanState` → `VisualTokenKey`）：
 *     - `pending`   → `data-state`     （灰蓝中性，节点尚未开始）
 *     - `running`   → `entry`          （活跃入口色，强调当前节点正在出图）
 *     - `completed` → `backend-core`   （成功完成）
 *     - `failed`    → `business-loop`  （失败 / 降级触发的警示色）
 *     - `text-only` → `governance`     （治理 / 兜底，纯文本预览）
 *
 * 文件路径：`client/src/components/autopilot/EffectPreviewScheduleTimeline.tsx`
 *
 * @see Requirements 15.1, 15.2, 15.3, 15.4, 17.1, 18.3
 */

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "framer-motion";
import { type ReactElement } from "react";

import {
  resolveToken,
  type VisualTokenKey,
  type VisualTokenSet,
} from "@/lib/autopilot/visual-tokens-placeholder";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * `progressPlan` 单条条目可达状态。
 *
 * 与 `server/routes/blueprint/effect-preview/scheduler.ts` 中的
 * `ProgressPlanState` 联合保持字面量一致；本文件在客户端侧本地重声明
 * 等价类型，以避免直接 import server 路径（client/server 不交叉依赖）。
 */
export type ProgressPlanState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "text-only";

/**
 * 6 级降级层级。与 `shared/blueprint/contracts.ts` 中的 `FallbackTier`
 * 保持一致；本文件本地声明等价别名以维持 props 形状自描述。
 */
export type FallbackTier =
  | "env-disabled"
  | "key-missing"
  | "timeout"
  | "quota"
  | "moderation"
  | "upstream-failure";

/**
 * `EffectPreviewScheduleTimeline` 消费的 `progressPlan` 元素。
 *
 * 字段语义与服务端 `EffectPreviewScheduler` 输出的 `ProgressPlanEntry`
 * 保持一致；客户端这里只读这些字段，永不写回。
 */
export interface ProgressPlanEntry {
  /** SPEC tree node id；与 `dependencyOrder[i]` 严格一致。 */
  readonly nodeId: string;
  /** 当前节点处理状态。 */
  readonly state: ProgressPlanState;
  /** 可选 — 节点显示标题；缺失时回退展示 `nodeId`。 */
  readonly title?: string;
  /** 可选 — 节点摘要。 */
  readonly summary?: string;
  /** 进入 raster 调用的起始时间（ISO8601）。 */
  readonly startedAt?: string;
  /** 处理完成 / 失败时间（ISO8601）。 */
  readonly endedAt?: string;
  /** 6 级降级层级；仅 `failed` / `text-only` 终态写入。 */
  readonly fallbackTier?: FallbackTier;
  /** 失败摘要；不含密钥或原始 prompt。 */
  readonly errorSummary?: string;
}

/**
 * 组件 props。
 *
 * - `activeStageKey`：当前 autopilot 右侧 rail 活跃阶段 key；只有等于
 *   `"effect_preview"` 时才真正渲染时间线，其它阶段返回 `null`，
 *   保证组件挂在 rail 槽位时不会污染其它阶段的视觉。
 * - `progressPlan`：节点 → 状态映射的有序数组。组件以 `progressPlan` 顺序
 *   决定 DOM 渲染顺序；状态色亦取自每条 entry。
 * - `dependencyOrder`：拓扑顺序数组。当其变化导致 `progressPlan` 顺序
 *   重新排列时，`layoutId={nodeId}` 会让 Framer Motion 自动完成 FLIP
 *   位移过渡（旧位置 → 新位置）。
 * - `visualTokens` / `theme`：取色契约；与 Phase 2 占位单一替换点对接。
 */
export interface EffectPreviewScheduleTimelineProps {
  /** 当前 autopilot 阶段 key；非 `"effect_preview"` 时组件返回 `null`。 */
  readonly activeStageKey: string;
  /** 节点处理状态的有序数组（DOM 渲染顺序来源）。 */
  readonly progressPlan: ReadonlyArray<ProgressPlanEntry>;
  /** 拓扑顺序数组；变化触发 FLIP 位移过渡。 */
  readonly dependencyOrder: ReadonlyArray<string>;
  /** 8-key OKLCH 调色板（由消费方从 `visual-tokens-placeholder` 注入）。 */
  readonly visualTokens: VisualTokenSet;
  /** 当前主题，决定从 `OklchPair` 中取 `light` 还是 `dark` 分支。 */
  readonly theme: "light" | "dark";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 状态 → 视觉令牌 key 的稳定映射。
 *
 * 抽出为模块常量以便测试断言：
 * - 五种状态映射到五个不同的 `VisualTokenKey`，互不重复，避免视觉混淆；
 * - 同一映射可在 `light` / `dark` 两套主题下复用。
 */
export const PROGRESS_STATE_TOKEN_KEY: {
  readonly [S in ProgressPlanState]: VisualTokenKey;
} = {
  pending: "data-state",
  running: "entry",
  completed: "backend-core",
  failed: "business-loop",
  "text-only": "governance",
};

/**
 * 在 prop 注入的 `visualTokens` 中查取颜色，缺失时回落到模块级
 * `resolveToken` 调色板。两侧最终都来自 `visual-tokens-placeholder`
 * 这个单一替换点，保持「取色单一来源」的语义不变。
 */
function colorForState(
  state: ProgressPlanState,
  visualTokens: VisualTokenSet,
  theme: "light" | "dark",
): string {
  const key = PROGRESS_STATE_TOKEN_KEY[state];
  const pair = visualTokens[key];
  if (pair !== undefined && pair[theme] !== undefined) {
    return pair[theme];
  }
  return resolveToken(key, theme);
}

/**
 * 状态 → 可访问性文本的稳定映射。供 `aria-label` 与状态徽章默认显示文本。
 */
const STATE_LABEL: { readonly [S in ProgressPlanState]: string } = {
  pending: "待出图",
  running: "出图中",
  completed: "已完成",
  failed: "已失败",
  "text-only": "纯文本兜底",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `EffectPreviewScheduleTimeline` — 调度时间线。
 *
 * 实现要点：
 * - `activeStageKey !== "effect_preview"` 时直接返回 `null`，避免在其它阶段
 *   污染右侧 rail 槽位（Req 15.1）。
 * - 渲染顺序以 `progressPlan` 为准；同时把 `dependencyOrder` 引用进 DOM
 *   `data-dependency-order` 属性，便于测试与诊断（Req 15.2）。
 * - 每个节点用 `<motion.li layoutId={nodeId}>` 渲染，外层
 *   `<AnimatePresence initial={false}>` 配合 `layout` prop，让 FLIP
 *   过渡在 `dependencyOrder` 重排后自然发生（Req 15.3）。
 * - 状态色 / 文本色 / 描边色全部来自 `visualTokens` + `resolveToken`，
 *   组件内部 **不出现** 任何颜色字面量（Req 15.4 / 17.1）。
 * - `prefers-reduced-motion` 命中时通过 `useReducedMotion()` 把过渡时长
 *   归零，FLIP 行为退化为即时位移，仍保留 `layoutId` 一致性。
 */
export function EffectPreviewScheduleTimeline(
  props: EffectPreviewScheduleTimelineProps,
): ReactElement | null {
  const {
    activeStageKey,
    progressPlan,
    dependencyOrder,
    visualTokens,
    theme,
  } = props;

  // hooks 必须在所有 early return 之前调用，遵循 React Rules of Hooks。
  const shouldReduceMotion = useReducedMotion();

  // FLIP 过渡参数：spring 风格匹配 RoleCrewDots / capability 既有动效；
  // prefers-reduced-motion 命中时 duration 归零（即时位移），仍保留
  // layoutId 一致性（Req 15.3）。
  const layoutTransition: Transition = shouldReduceMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 300, damping: 30 };

  // 仅在 effect_preview 阶段渲染（Req 15.1）。
  if (activeStageKey !== "effect_preview") {
    return null;
  }

  return (
    <section
      data-component="effect-preview-schedule-timeline"
      data-active-stage-key={activeStageKey}
      data-dependency-order={dependencyOrder.join(",")}
      data-theme={theme}
      aria-label="effect preview schedule timeline"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        minWidth: 0,
      }}
    >
      <ol
        data-testid="effect-preview-schedule-list"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        <AnimatePresence initial={false}>
          {progressPlan.map((entry, index) => {
            const stateColor = colorForState(entry.state, visualTokens, theme);
            const label = entry.title ?? entry.nodeId;
            const stateLabel = STATE_LABEL[entry.state];
            return (
              <motion.li
                key={entry.nodeId}
                layoutId={entry.nodeId}
                layout
                data-testid="effect-preview-schedule-item"
                data-node-id={entry.nodeId}
                data-state={entry.state}
                data-index={index}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 4 }}
                transition={layoutTransition}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.5rem",
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor: stateColor,
                  color: stateColor,
                }}
              >
                <span
                  data-testid="effect-preview-schedule-status-pill"
                  data-state={entry.state}
                  aria-label={stateLabel}
                  style={{
                    display: "inline-flex",
                    minWidth: "0.6rem",
                    width: "0.6rem",
                    height: "0.6rem",
                    borderRadius: "9999px",
                    backgroundColor: stateColor,
                  }}
                />
                <span
                  data-testid="effect-preview-schedule-label"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={entry.summary}
                >
                  {label}
                </span>
                <span
                  data-testid="effect-preview-schedule-state-text"
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 400,
                    opacity: 0.85,
                    whiteSpace: "nowrap",
                  }}
                >
                  {stateLabel}
                </span>
                {entry.fallbackTier !== undefined && (
                  <span
                    data-testid="effect-preview-schedule-fallback-tier"
                    data-fallback-tier={entry.fallbackTier}
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 400,
                      opacity: 0.75,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.fallbackTier}
                  </span>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </section>
  );
}
