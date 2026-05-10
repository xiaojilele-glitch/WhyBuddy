/**
 * Autopilot 驾驶舱右栏收敛 — `<AutopilotRightRail>` 最小 scaffolding
 *
 * 对应 spec：`.kiro/specs/autopilot-cockpit-right-rail-convergence/`
 * - 需求 3（组件仅通过 props 接收数据）
 * - 需求 6.2 / 6.5（不在组件内再发起 fetch，不 `useAppStore` 或调用 `@/lib/blueprint-api`）
 * - 需求 7.1 / 7.2（`<aside role="complementary">` + `aria-label` + 激活 sub-stage 的 `aria-current`）
 *
 * 本文件是 Spec 1 的最小 scaffolding：仅渲染 5 个 timeline stage 与（fabric 分支下）8 个 sub-stage
 * 的占位区块，不搬运任何真实工作台内容。Spec 2 / 3 / 4 / 5 后续会逐步接管真实内容。
 *
 * 硬性约束（任务 3 明示）：
 * - 不得 `useAppStore`；
 * - 不得 import `@/lib/blueprint-api` 的运行时成员；
 * - 不得在组件内发起 fetch；
 * - 当 props 传入 `currentSubStage` 时优先使用 props 值，否则回落到本地 `resolveRailSubStage` 的结果
 *   （这样 Spec 4 / 5 的 URL / pin-state 覆盖链路可以无缝接管）；
 * - 仅在 `currentStage === "fabric"` 时渲染 8 个 sub-stage placeholder；当前激活的 sub-stage 带
 *   `aria-current="step"`；每个 sub-stage 区块带 `data-sub-stage-placeholder="${subStage}"` 属性
 *   以便未来测试锚定。
 */

import type { FC } from "react";

import { resolveRailSubStage } from "./resolve-rail-sub-stage";
import {
  RAIL_SUB_STAGE_ORDER,
  type AutopilotRailSubStage,
  type AutopilotRightRailProps,
  type AutopilotTimelineStage,
} from "./types";

/**
 * 5 个顶层 timeline stage 的渲染顺序（只读）。
 *
 * 与 `AutopilotWorkflowRail` 当前使用的 5 阶段保持一致；本文件不重复建立枚举源，只在内部固定
 * 渲染顺序，供 placeholder 区块迭代使用。
 */
const TIMELINE_STAGE_ORDER: readonly AutopilotTimelineStage[] = [
  "input",
  "clarification",
  "routeset",
  "selection",
  "fabric",
] as const;

/**
 * 5 个 timeline stage placeholder 的中英双语占位文案。
 *
 * 本表文案是 Spec 1 的占位字符串，后续 Spec 2 会将真实面板内容搬入右栏；这里只保留最短的一句中/英
 * 描述，不做 glossary 化处理。
 */
const TIMELINE_STAGE_LABELS: Record<
  AutopilotTimelineStage,
  { "zh-CN": string; "en-US": string }
> = {
  input: { "zh-CN": "输入阶段", "en-US": "Input stage" },
  clarification: { "zh-CN": "澄清问答", "en-US": "Clarification" },
  routeset: { "zh-CN": "路线候选", "en-US": "Route set" },
  selection: { "zh-CN": "路线选择", "en-US": "Route selection" },
  fabric: {
    "zh-CN": "AgentCrewFabric 推演工作台",
    "en-US": "AgentCrewFabric workbench",
  },
};

/**
 * `<aside>` 根节点的 aria-label 值。
 *
 * 中文 locale 返回「Autopilot 右栏工作台」，其它 locale（目前只有 `en-US`）返回英文变体。
 */
function resolveAriaLabel(locale: AutopilotRightRailProps["locale"]): string {
  return locale === "zh-CN"
    ? "Autopilot 右栏工作台"
    : "Autopilot right rail workbench";
}

/**
 * Spec 1 最小 scaffolding。后续 Spec 2 / 3 / 4 / 5 会在本组件内逐步接管真实内容。
 */
export const AutopilotRightRail: FC<AutopilotRightRailProps> = (props) => {
  const {
    currentStage,
    currentSubStage: currentSubStageFromProps,
    job,
    selection,
    specTree,
    agentCrew,
    locale,
  } = props;

  // 本地 resolver 的结果；props 值优先，保证后续 Spec 4 / 5 的 URL / pin-state 覆盖链路可以无缝接管。
  const computedSubStage = resolveRailSubStage({
    currentStage,
    job,
    selection,
    specTree,
    agentCrew,
  });
  const activeSubStage: AutopilotRailSubStage | undefined =
    currentSubStageFromProps ?? computedSubStage;

  return (
    <aside
      role="complementary"
      aria-label={resolveAriaLabel(locale)}
      data-testid="autopilot-right-rail"
      data-autopilot-stage={currentStage}
      data-autopilot-sub-stage={activeSubStage ?? ""}
    >
      {TIMELINE_STAGE_ORDER.map((stage) => {
        const labels = TIMELINE_STAGE_LABELS[stage];
        const label = labels[locale] ?? labels["en-US"];
        const isFabric = stage === "fabric";
        const isActive = stage === currentStage;

        return (
          <div
            key={stage}
            data-stage-placeholder={stage}
            data-active={isActive ? "true" : "false"}
          >
            <div>{label}</div>

            {isFabric && currentStage === "fabric"
              ? RAIL_SUB_STAGE_ORDER.map((subStage) => {
                  const isCurrent = subStage === activeSubStage;
                  return (
                    <div
                      key={subStage}
                      data-sub-stage-placeholder={subStage}
                      aria-current={isCurrent ? "step" : undefined}
                    >
                      {subStage}
                    </div>
                  );
                })
              : null}
          </div>
        );
      })}
    </aside>
  );
};

export default AutopilotRightRail;
