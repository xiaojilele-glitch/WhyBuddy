/**
 * Autopilot 驾驶舱右栏收敛 — `<AutopilotRightRail>`
 *
 * 对应 spec：
 * - Spec 1 `autopilot-cockpit-right-rail-convergence/`：scaffolding 与 props 契约
 * - Spec 2 `autopilot-right-rail-stage-panels/`：fabric 8 个 canonical 面板挂载
 * - Spec 3 `autopilot-advanced-workbench-inline/`：fabric 右栏接管
 * - Spec 4 `autopilot-right-rail-data-hook/`：`currentSubStage` 作为数据懒加载 gate
 * - Spec 5 `autopilot-step-driven-rail-navigation/`：Task 3 新增 scroll container + anchor +
 *   派生 scroll effect（尊重 `prefers-reduced-motion`）
 *
 * Spec 5 Task 3 的硬性约束：
 * - 不修改 `AutopilotRightRailProps` 契约（Spec 1 冻结）。
 * - 不修改 Spec 2 canonical 面板的 DOM 结构；`data-sub-stage-anchor` 加在 scaffolding 层
 *   `<section>` 外壳而非面板内部。
 * - 保留 `data-sub-stage-placeholder="${subStage}"` 与 `aria-current="step"` 现有断言
 *   （Spec 3 `fabric-dispatch.property.test.tsx` 依赖）。
 * - scroll 只作用于右栏内容 `scrollRef.current`，不触碰 `document.scrollingElement`。
 * - 首次挂载用 `behavior: "auto"`，之后尊重 `prefers-reduced-motion`。
 * - anchor 未找到时静默 no-op。
 *
 * Spec 5 后续任务（Task 4/5/6/9）会在本组件继续扩展：
 * - 键盘快捷键注册（`document.addEventListener("keydown", ...)`）
 * - Sticky toggle + sr-announcer + tab aria-current
 * - Viewport_Tier 三档渲染分支（drawer trigger / collapse toggle）
 */

import { useEffect, useRef, useState, type FC } from "react";

import { Pin, PinOff } from "lucide-react";

import {
  readPrefersReducedMotion,
  resolveKeyboardIntent,
  resolveScrollBehavior,
  scrollAnchorIntoView,
  stepSubStage,
  useRightRailSubStageContext,
} from "./hooks/use-right-rail-sub-stage-state";
import {
  AgentCrewFabricPanel,
  ArtifactMemoryPanel,
  EffectPreviewPanel,
  EngineeringHandoffPanel,
  PromptPackagePanel,
  RuntimeCapabilityPanel,
  SpecDocumentsPanel,
  SpecTreePanel,
} from "./panels";
import { resolveRailSubStage } from "./resolve-rail-sub-stage";
import {
  RAIL_SUB_STAGE_ORDER,
  type AutopilotRailSubStage,
  type AutopilotRightRailProps,
  type AutopilotTimelineStage,
} from "./types";

/**
 * 5 个顶层 timeline stage 的渲染顺序（只读）。
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
 * Anchor 属性名（Task 3 新增）。
 * 测试、组件、hook 共用同一常量，避免字符串漂移。
 */
export const RAIL_SUB_STAGE_ANCHOR_ATTR = "data-sub-stage-anchor" as const;

/**
 * 键盘提示文案（Task 4）。
 *
 * 仅在 fabric 阶段显示；用户可通过提示内的 dismiss 按钮临时隐藏（session scope，不持久化）。
 * 文案与 Requirement 4.1-4.4 的快捷键语义对齐。
 */
const KEYBOARD_HINT_COPY: Record<
  AutopilotRightRailProps["locale"],
  { hint: string; dismiss: string; dismissLabel: string }
> = {
  "zh-CN": {
    hint: "快捷键：[ / ] 切换子阶段，Shift + P 暂停跟随，Esc 关闭抽屉",
    dismiss: "收起",
    dismissLabel: "收起键盘快捷键提示",
  },
  "en-US": {
    hint: "Shortcuts: [ / ] switch sub-stage, Shift + P toggle pin, Esc close drawer",
    dismiss: "Hide",
    dismissLabel: "Hide keyboard shortcut hint",
  },
};

/**
 * Sticky toggle 文案（Task 6）。
 *
 * pinned 状态：文案「已暂停跟随 / Pinned」；非 pinned：「跟随进度 / Following」。
 * `aria-label` 取 `labelLong`，提供人类可读描述。
 */
const STICKY_TOGGLE_COPY: Record<
  AutopilotRightRailProps["locale"],
  { pinnedShort: string; pinnedLong: string; followingShort: string; followingLong: string }
> = {
  "zh-CN": {
    pinnedShort: "已暂停跟随",
    pinnedLong: "当前已暂停跟随进度，点击以恢复跟随",
    followingShort: "跟随进度",
    followingLong: "当前跟随进度推进，点击以暂停跟随",
  },
  "en-US": {
    pinnedShort: "Pinned",
    pinnedLong: "Currently pinned; click to resume following progress",
    followingShort: "Following",
    followingLong: "Following progress; click to pin current sub-stage",
  },
};

/**
 * 8 个 sub-stage 的 tab 标签文案（Task 6）。
 *
 * sub-stage 的内部 key 与 `RAIL_SUB_STAGE_ORDER` 对齐；此表同时提供 sr-announcer 使用的
 * 完整句式（`announce`）。
 */
const SUB_STAGE_LABELS: Record<
  AutopilotRailSubStage,
  Record<AutopilotRightRailProps["locale"], { short: string; announce: string }>
> = {
  agent_crew_fabric: {
    "zh-CN": { short: "智能体矩阵", announce: "已切换到智能体矩阵" },
    "en-US": { short: "Agent crew", announce: "Switched to agent crew fabric" },
  },
  spec_tree: {
    "zh-CN": { short: "Spec 树", announce: "已切换到 Spec 树" },
    "en-US": { short: "Spec tree", announce: "Switched to spec tree" },
  },
  spec_documents: {
    "zh-CN": { short: "Spec 文档", announce: "已切换到 Spec 文档" },
    "en-US": { short: "Spec docs", announce: "Switched to spec documents" },
  },
  effect_preview: {
    "zh-CN": { short: "效果预演", announce: "已切换到效果预演" },
    "en-US": { short: "Effect preview", announce: "Switched to effect preview" },
  },
  prompt_package: {
    "zh-CN": { short: "Prompt 包", announce: "已切换到 Prompt 包" },
    "en-US": { short: "Prompt package", announce: "Switched to prompt package" },
  },
  runtime_capability: {
    "zh-CN": { short: "运行时能力", announce: "已切换到运行时能力" },
    "en-US": { short: "Runtime capability", announce: "Switched to runtime capability" },
  },
  engineering_handoff: {
    "zh-CN": { short: "工程交付", announce: "已切换到工程交付" },
    "en-US": { short: "Engineering handoff", announce: "Switched to engineering handoff" },
  },
  artifact_memory: {
    "zh-CN": { short: "证据记忆", announce: "已切换到证据记忆" },
    "en-US": { short: "Artifact memory", announce: "Switched to artifact memory" },
  },
};

/**
 * `<aside>` 根节点的 aria-label 值。
 */
function resolveAriaLabel(locale: AutopilotRightRailProps["locale"]): string {
  return locale === "zh-CN"
    ? "Autopilot 右栏工作台"
    : "Autopilot right rail workbench";
}

/**
 * 渲染指定 sub-stage 对应的 canonical 面板。
 *
 * 抽离为独立函数以便主 JSX 保持扁平；面板的 props subset 仍由 Spec 2 的 `Pick` 契约决定。
 * 本函数不修改任何面板内部 DOM。
 */
function renderSubStagePanel(params: {
  subStage: AutopilotRailSubStage;
  jobId: string;
  job: AutopilotRightRailProps["job"];
  agentCrew: AutopilotRightRailProps["agentCrew"];
  capabilities: AutopilotRightRailProps["capabilities"];
  capabilityInvocations: AutopilotRightRailProps["capabilityInvocations"];
  capabilityEvidence: AutopilotRightRailProps["capabilityEvidence"];
  specTree: AutopilotRightRailProps["specTree"];
  selection: AutopilotRightRailProps["selection"];
  effectPreviews: AutopilotRightRailProps["effectPreviews"];
  locale: AutopilotRightRailProps["locale"];
}) {
  const { subStage, jobId, job, agentCrew, capabilities, capabilityInvocations, capabilityEvidence, specTree, selection, effectPreviews, locale } = params;

  if (subStage === "agent_crew_fabric") {
    return (
      <AgentCrewFabricPanel
        jobId={jobId}
        job={job}
        agentCrew={agentCrew}
        capabilities={capabilities}
        capabilityInvocations={capabilityInvocations}
        capabilityEvidence={capabilityEvidence}
        locale={locale}
      />
    );
  }
  if (subStage === "spec_tree") {
    return (
      <SpecTreePanel
        jobId={jobId}
        specTree={specTree}
        selection={selection}
        locale={locale}
      />
    );
  }
  if (subStage === "spec_documents") {
    return <SpecDocumentsPanel jobId={jobId} specTree={specTree} locale={locale} />;
  }
  if (subStage === "effect_preview") {
    return (
      <EffectPreviewPanel
        jobId={jobId}
        job={job}
        specTree={specTree}
        effectPreviews={effectPreviews}
        agentCrew={agentCrew}
        capabilityEvidence={capabilityEvidence}
        locale={locale}
      />
    );
  }
  if (subStage === "prompt_package") {
    return (
      <PromptPackagePanel
        jobId={jobId}
        specTree={specTree}
        effectPreviews={effectPreviews}
        locale={locale}
      />
    );
  }
  if (subStage === "runtime_capability") {
    return (
      <RuntimeCapabilityPanel
        jobId={jobId}
        specTree={specTree}
        capabilities={capabilities}
        capabilityInvocations={capabilityInvocations}
        capabilityEvidence={capabilityEvidence}
        agentCrew={agentCrew}
        locale={locale}
      />
    );
  }
  if (subStage === "engineering_handoff") {
    return <EngineeringHandoffPanel jobId={jobId} locale={locale} />;
  }
  if (subStage === "artifact_memory") {
    return <ArtifactMemoryPanel jobId={jobId} locale={locale} />;
  }
  // Exhaustive safety net for `AutopilotRailSubStage`. Reaching here implies a new
  // sub-stage was added without updating this switch.
  return subStage satisfies never;
}

export const AutopilotRightRail: FC<AutopilotRightRailProps> = (props) => {
  const {
    jobId,
    currentStage,
    currentSubStage: currentSubStageFromProps,
    job,
    selection,
    specTree,
    agentCrew,
    capabilities,
    capabilityInvocations,
    capabilityEvidence,
    effectPreviews,
    locale,
    onSubStageChange,
  } = props;

  // 本地 resolver 的结果；props 值优先，保证 Spec 4 / 5 的 URL / pin-state 覆盖链路无缝接管。
  const computedSubStage = resolveRailSubStage({
    currentStage,
    job,
    selection,
    specTree,
    agentCrew,
  });
  const activeSubStage: AutopilotRailSubStage | undefined =
    currentSubStageFromProps ?? computedSubStage;

  // -------------------------------------------------------------------------
  // Spec 5 Task 3 — 步骤驱动自动滚动
  // -------------------------------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstMountRef = useRef<boolean>(true);

  useEffect(() => {
    // 非 fabric 阶段 / activeSubStage 缺失 → 不触发任何滚动。
    if (currentStage !== "fabric" || !activeSubStage) {
      return;
    }
    const behavior = resolveScrollBehavior({
      isFirstMount: firstMountRef.current,
      prefersReducedMotion: readPrefersReducedMotion(),
    });
    scrollAnchorIntoView({
      container: scrollRef.current,
      anchorAttr: RAIL_SUB_STAGE_ANCHOR_ATTR,
      anchorValue: activeSubStage,
      behavior,
      block: "start",
    });
    // 首次执行后清除 first-mount flag，使后续切换可以走 smooth（除非用户偏好 reduce）。
    if (firstMountRef.current) {
      firstMountRef.current = false;
    }
  }, [currentStage, activeSubStage]);

  // -------------------------------------------------------------------------
  // Spec 5 Task 4 — 键盘快捷键（`[` / `]` / `Shift + P` / `Esc`）
  // -------------------------------------------------------------------------
  // Esc 关闭 drawer 依赖 Task 5 引入的 drawer state；在本 spec 的 Task 4 阶段只提供
  // `close-drawer` intent 决策，由 Task 5 / Task 8 在 `AutopilotRoutePage` 层真正承接。
  // Context 缺失（例如 `/specs` 页面无 Provider）时，`togglePin / setPinnedSubStage` 已由
  // `NULL_CONTEXT_FALLBACK` 提供 no-op 实现；因此本 effect 仍可挂载而不会抛错。
  const subStageContext = useRightRailSubStageContext();
  const subStageContextRef = useRef(subStageContext);
  useEffect(() => {
    subStageContextRef.current = subStageContext;
  }, [subStageContext]);

  const activeSubStageRef = useRef<AutopilotRailSubStage | undefined>(activeSubStage);
  useEffect(() => {
    activeSubStageRef.current = activeSubStage;
  }, [activeSubStage]);

  const currentStageRef = useRef<AutopilotTimelineStage>(currentStage);
  useEffect(() => {
    currentStageRef.current = currentStage;
  }, [currentStage]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      const intent = resolveKeyboardIntent({
        key: event.key,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        target: event.target,
        currentStage: currentStageRef.current,
        // Task 4 阶段本组件暂不拥有 drawer state；Task 5 会通过 Context / prop 把真实
        // `drawerOpen` 值注入。当前传 `false`，避免 `Esc` 误触发父层关闭逻辑。
        drawerOpen: false,
      });
      if (intent === "ignore") {
        return;
      }
      if (intent === "step-prev" || intent === "step-next") {
        const direction = intent === "step-prev" ? "prev" : "next";
        const next = stepSubStage(activeSubStageRef.current, direction);
        if (next === undefined) {
          // 边界（首位 `[` / 末位 `]`）或 activeSubStage 异常，no-op。
          return;
        }
        subStageContextRef.current.setPinnedSubStage(next);
        return;
      }
      if (intent === "toggle-pin") {
        subStageContextRef.current.togglePin();
        return;
      }
      // "close-drawer" 在 Task 4 阶段由父层 Task 5 / Task 8 承接，这里 no-op。
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, []);

  // 键盘提示 session-scope dismiss state（Requirement 8.5）。
  const [keyboardHintDismissed, setKeyboardHintDismissed] = useState<boolean>(false);

  // -------------------------------------------------------------------------
  // Spec 5 Task 6 — sr-announcer：activeSubStage 变化时写入 i18n 文案
  // -------------------------------------------------------------------------
  const srAnnouncerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!srAnnouncerRef.current) {
      return;
    }
    if (currentStage !== "fabric" || !activeSubStage) {
      srAnnouncerRef.current.textContent = "";
      return;
    }
    const copy = SUB_STAGE_LABELS[activeSubStage]?.[locale] ?? SUB_STAGE_LABELS[activeSubStage]?.["en-US"];
    srAnnouncerRef.current.textContent = copy?.announce ?? "";
  }, [currentStage, activeSubStage, locale]);

  return (
    <aside
      role="complementary"
      aria-label={resolveAriaLabel(locale)}
      data-testid="autopilot-right-rail"
      data-autopilot-stage={currentStage}
      data-autopilot-sub-stage={activeSubStage ?? ""}
    >
      {/* Task 6 — sr-announcer: 由 effect 写入 i18n 文案；fabric 阶段外为空 */}
      <div
        ref={srAnnouncerRef}
        data-testid="autopilot-right-rail-sr-announcer"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      {TIMELINE_STAGE_ORDER.map((stage) => {
        const labels = TIMELINE_STAGE_LABELS[stage];
        const label = labels[locale] ?? labels["en-US"];
        const isFabric = stage === "fabric";
        const isActive = stage === currentStage;

        if (!isFabric || currentStage !== "fabric") {
          return (
            <div
              key={stage}
              data-stage-placeholder={stage}
              data-active={isActive ? "true" : "false"}
            >
              <div>{label}</div>
            </div>
          );
        }

        // fabric 分支：包裹 scroll container + 8 个 anchor <section>。
        const hintCopy = KEYBOARD_HINT_COPY[locale] ?? KEYBOARD_HINT_COPY["en-US"];
        const stickyCopy = STICKY_TOGGLE_COPY[locale] ?? STICKY_TOGGLE_COPY["en-US"];
        const isPinned = subStageContext.isPinned;
        return (
          <div
            key={stage}
            data-stage-placeholder={stage}
            data-active={isActive ? "true" : "false"}
          >
            <div>{label}</div>
            {/* Task 6 — 8 个子阶段 tab + Sticky_Toggle */}
            <div
              role="tablist"
              aria-label={
                locale === "zh-CN" ? "子阶段导航" : "Sub-stage navigation"
              }
              className="flex items-center justify-between gap-2"
            >
              <div className="flex flex-wrap gap-1">
                {RAIL_SUB_STAGE_ORDER.map((subStage) => {
                  const isTabActive = subStage === activeSubStage;
                  const tabCopy =
                    SUB_STAGE_LABELS[subStage][locale] ??
                    SUB_STAGE_LABELS[subStage]["en-US"];
                  return (
                    <button
                      key={subStage}
                      type="button"
                      role="tab"
                      data-testid={`autopilot-right-rail-sub-stage-tab-${subStage}`}
                      aria-current={isTabActive ? "location" : undefined}
                      aria-selected={isTabActive}
                      onClick={() => {
                        // Spec 1 冻结：onSubStageChange 由 parent 解读。Task 7 会把它
                        // 接到 Sub_Stage_State_Hook 的 setPinnedSubStage。
                        onSubStageChange(subStage);
                      }}
                      className={
                        isTabActive
                          ? "rounded border border-primary px-2 py-0.5 text-xs font-medium"
                          : "rounded border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-border"
                      }
                    >
                      {tabCopy.short}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                data-testid="autopilot-right-rail-sticky-toggle"
                aria-pressed={isPinned}
                aria-label={
                  isPinned ? stickyCopy.pinnedLong : stickyCopy.followingLong
                }
                onClick={() => subStageContext.togglePin()}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs"
              >
                {isPinned ? (
                  <Pin aria-hidden="true" className="h-3 w-3" />
                ) : (
                  <PinOff aria-hidden="true" className="h-3 w-3" />
                )}
                <span>
                  {isPinned ? stickyCopy.pinnedShort : stickyCopy.followingShort}
                </span>
              </button>
            </div>
            {keyboardHintDismissed ? null : (
              <div
                data-testid="autopilot-right-rail-keyboard-hint"
                className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
              >
                <span>{hintCopy.hint}</span>
                <button
                  type="button"
                  onClick={() => setKeyboardHintDismissed(true)}
                  aria-label={hintCopy.dismissLabel}
                  className="underline"
                >
                  {hintCopy.dismiss}
                </button>
              </div>
            )}
            <div
              ref={scrollRef}
              data-testid="autopilot-right-rail-scroll-container"
              className="relative h-full overflow-y-auto"
            >
              {RAIL_SUB_STAGE_ORDER.map((subStage) => {
                const isCurrent = subStage === activeSubStage;
                return (
                  <section
                    key={subStage}
                    {...{ [RAIL_SUB_STAGE_ANCHOR_ATTR]: subStage }}
                    data-sub-stage-placeholder={subStage}
                    aria-current={isCurrent ? "step" : undefined}
                    aria-hidden={isCurrent ? undefined : true}
                    className="scroll-mt-4"
                  >
                    {isCurrent
                      ? renderSubStagePanel({
                          subStage,
                          jobId,
                          job,
                          agentCrew,
                          capabilities,
                          capabilityInvocations,
                          capabilityEvidence,
                          specTree,
                          selection,
                          effectPreviews,
                          locale,
                        })
                      : null}
                  </section>
                );
              })}
            </div>
          </div>
        );
      })}
    </aside>
  );
};

export default AutopilotRightRail;
