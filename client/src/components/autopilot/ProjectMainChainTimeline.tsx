/**
 * autopilot-image-rendering-and-visual-system · Phase 3 / Task 22.1
 *
 * `ProjectMainChainTimeline`：在 `ProjectCockpitHome` 顶部展示
 * `Project → Clarification → Spec → Route → Execution → Evidence` 6 步主链时间线。
 *
 * 设计要点（参见 spec design.md / requirements.md §14）：
 * - 严格按规范顺序渲染 6 步标签（与输入数组中的顺序无关，
 *   仅以 `step.key` 为索引去查值；缺失的步骤回退到 `pending`）。
 * - 每个步骤 status 映射到一个稳定的 `statusClass`：
 *     - `pending`    → `is-pending`   （灰）
 *     - `running`    → `is-running`   （蓝色脉冲）
 *     - `completed`  → `is-completed` （绿色对勾）
 *     - `blocked`    → `is-blocked`   （黄色 ⚠）
 *     - `failed`     → `is-failed`    （红色 ✗）
 *   class 之间互不重复（参见 Property 10：state-to-class 唯一映射）。
 * - 任意时刻最多一个步骤带 `is-active` class：仅当 `activeKey` 命中规范顺序中的某一步时
 *   该步骤额外带上 `is-active`，其它步骤永不附加该 class。
 * - 颜色取自 `visualTokens`，**禁止** 在本文件中出现任何
 *   `#` / `rgb()` / `hsl()` / `oklch()` 等颜色字面量。
 * - 颜色取色统一从 `visual-tokens-placeholder` 单一替换点导入，
 *   禁止直接 `import "./visual-tokens"` 或 `"@/lib/autopilot/visual-tokens"`。
 *
 * 挂载点：
 * - 必须挂在 `client/src/pages/ProjectCockpitHome.tsx`，**不挂** 在 `AutopilotRoutePage`。
 *   挂载工作由 task 22.2 完成；本组件只负责实现。
 *
 * @see Requirements 14.1, 14.2, 14.3, 14.4, 17.1, 18.3
 */

import { type ReactElement } from "react";

import {
  type VisualTokenKey,
  type VisualTokenSet,
  resolveToken,
} from "../../lib/autopilot/visual-tokens-placeholder";

/**
 * 6 步主链阶段的 key 联合类型。
 *
 * 命名采用 `Project`/`Clarification`/... PascalCase 字面量以保持与
 * 产品口径一致（参见 `.kiro/steering/project-overview.md` 2026-04-30 段落
 * 与 design.md 中的 `MainChainStepKey`）。
 */
export type MainChainStepKey =
  | "Project"
  | "Clarification"
  | "Spec"
  | "Route"
  | "Execution"
  | "Evidence";

/**
 * 主链步骤的 5 种状态。
 */
export type MainChainStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "failed";

/**
 * 单个主链步骤的运行时数据：仅包含 key 与当前 status。
 *
 * 不变量：
 * - `key` 必须是 6 个 `MainChainStepKey` 之一。
 * - `status` 必须是 5 个 `MainChainStepStatus` 之一。
 */
export interface MainChainStep {
  readonly key: MainChainStepKey;
  readonly status: MainChainStepStatus;
}

/**
 * `ProjectMainChainTimeline` props。
 *
 * 设计说明：
 * - `steps` 期望长度恒为 6（设计文档要求），但本组件不强制硬抛错；
 *   渲染时一律按规范顺序去查 `key`，未提供的步骤回退到 `pending`，
 *   以便上游 store 渐进装配 6 步状态时不会出现 React render 错误。
 * - `activeKey` 缺省时不附加任何 `is-active` class；
 *   提供时仅命中的那一步附加 `is-active`，其它步骤保持普通 status class。
 * - `theme` 显式由父容器传入，便于测试在不同主题间切换断言；
 *   不从全局 ThemeContext 直接 hook，以保持本组件无副作用、可在 SSR / 静态渲染下使用。
 */
export interface ProjectMainChainTimelineProps {
  readonly steps: ReadonlyArray<MainChainStep>;
  readonly activeKey?: MainChainStepKey;
  readonly visualTokens: VisualTokenSet;
  readonly theme: "light" | "dark";
}

/**
 * 6 步主链的规范渲染顺序。使用 `as const` tuple 锁定 length === 6。
 *
 * 暴露为模块常量便于属性测试断言完整性与顺序。
 */
export const MAIN_CHAIN_STEP_ORDER: readonly [
  "Project",
  "Clarification",
  "Spec",
  "Route",
  "Execution",
  "Evidence",
] = ["Project", "Clarification", "Spec", "Route", "Execution", "Evidence"] as const;

/**
 * status → CSS class 的稳定映射。任意两个 status 对应的 class 互不相同
 * （Property 10 的核心不变量）。
 *
 * 暴露为模块常量便于消费方与测试直接断言。
 */
export const MAIN_CHAIN_STATUS_CLASS: Record<MainChainStepStatus, string> = {
  pending: "is-pending",
  running: "is-running",
  completed: "is-completed",
  blocked: "is-blocked",
  failed: "is-failed",
};

/**
 * status → 视觉令牌 key 的语义映射。
 *
 * 8-key OKLCH 调色板不直接提供 gray / yellow / red 等色，
 * 因此选择最贴近原设计意图（gray / blue / green / yellow / red）的语义 key：
 * - `pending`    → `external-integration`：浅绿，作为静默 / 旁路的低饱和入口色。
 * - `running`    → `data-state`：浅蓝，对应「运行中」蓝色脉冲。
 * - `completed`  → `backend-core`：绿，对应「完成」绿色对勾。
 * - `blocked`    → `governance`：紫，作为告警 / 治理类提示色（黄色替代）。
 * - `failed`     → `business-loop`：粉，作为失败 / 醒目类提示色（红色替代）。
 *
 * 注：active 高亮独立使用 `entry` token，与 status 颜色解耦（见组件实现）。
 */
export const MAIN_CHAIN_STATUS_TOKEN: Record<MainChainStepStatus, VisualTokenKey> = {
  pending: "external-integration",
  running: "data-state",
  completed: "backend-core",
  blocked: "governance",
  failed: "business-loop",
};

/**
 * status → 状态字符（图形）。aria-hidden 渲染，给视觉 / 截图测试用。
 */
export const MAIN_CHAIN_STATUS_GLYPH: Record<MainChainStepStatus, string> = {
  pending: "•",
  running: "◐",
  completed: "✓",
  blocked: "⚠",
  failed: "✗",
};

/**
 * 主链时间线 — 6 步固定顺序、状态 class 唯一映射、最多一个 active。
 */
export function ProjectMainChainTimeline(
  props: ProjectMainChainTimelineProps,
): ReactElement {
  const { steps, activeKey, visualTokens, theme } = props;

  // 用 Map 把输入按 key 索引；输入顺序与渲染顺序无关，渲染严格按 MAIN_CHAIN_STEP_ORDER。
  const stepByKey = new Map<MainChainStepKey, MainChainStep>();
  for (const step of steps) {
    stepByKey.set(step.key, step);
  }

  // active 高亮取 `entry` token；与 status 颜色解耦，避免和具体状态色互相覆盖。
  const accentColor =
    visualTokens.entry[theme] ?? resolveToken("entry", theme);

  return (
    <ol
      data-component="project-main-chain-timeline"
      data-theme={theme}
      style={{
        display: "flex",
        flexWrap: "wrap",
        listStyle: "none",
        margin: 0,
        padding: 0,
        gap: "0.5rem",
        minWidth: 0,
      }}
    >
      {MAIN_CHAIN_STEP_ORDER.map((key) => {
        // 缺失步骤回退到 pending：渲染端强约束 6 步完整呈现。
        const status: MainChainStepStatus =
          stepByKey.get(key)?.status ?? "pending";
        const statusClass = MAIN_CHAIN_STATUS_CLASS[status];
        const tokenKey = MAIN_CHAIN_STATUS_TOKEN[status];
        // 经由 visualTokens / resolveToken 取色；本文件不出现任何颜色字面量。
        const color =
          visualTokens[tokenKey][theme] ?? resolveToken(tokenKey, theme);
        const isActive = activeKey != null && activeKey === key;
        // class 组合：始终带 statusClass；命中 activeKey 才追加 is-active。
        const className = isActive ? `${statusClass} is-active` : statusClass;

        return (
          <li
            key={key}
            data-step-key={key}
            data-status={status}
            data-active={isActive ? "true" : "false"}
            className={className}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              minWidth: 0,
              color,
              // active 时使用 `entry` 强调色描边；非 active 沿用 status 色。
              borderColor: isActive ? accentColor : color,
              borderWidth: 1,
              borderStyle: "solid",
              borderRadius: "9999px",
              padding: "0.25rem 0.625rem",
              fontWeight: isActive ? 700 : 500,
              // 主题切换时通过 React 重渲染同步刷新颜色（不依赖 CSS 变量）。
            }}
          >
            <span data-role="status-glyph" aria-hidden="true">
              {MAIN_CHAIN_STATUS_GLYPH[status]}
            </span>
            <span data-role="step-label">{key}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default ProjectMainChainTimeline;
