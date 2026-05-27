/**
 * autopilot-image-rendering-and-visual-system · Phase 3 · Task 22.2
 * autopilot-image-rendering-and-visual-system · Phase 4 · Task 36.1
 *
 * `ProjectCockpitHome` 是项目驾驶舱首页 (`/projects`) 的挂载入口，
 * 在保持原有 `Home.tsx` 全部体验不变的前提下，于页面顶部加入一条
 * `ProjectMainChainTimeline`：把当前项目的 6 步主链
 * (`Project → Clarification → Spec → Route → Execution → Evidence`)
 * 状态投影到 cockpit 顶栏，让用户一眼判断项目卡在哪一步。
 *
 * 设计要点：
 * - 本文件是一层薄壳：所有原有交互、布局、3D 场景、统一发起器与 Hub Dashboard
 *   都仍由 `<Home />` 承担；本文件只额外渲染顶部的 timeline 槽位。
 * - **Task 36.1 修复（避免遮挡）**：早期实现把 timeline 用 `position: fixed`
 *   钉在视口顶部，会遮挡 `<Home />` 的导航 / 头部 / 主操作区。
 *   现在改为 **wrapper band 方案**：
 *     - 用一个 `data-region="project-cockpit-layout-band"` 外层容器作为
 *       页面的主布局带；timeline 槽位 (`data-region="project-cockpit-timeline-band"`)
 *       作为 **正常流（normal flow）兄弟节点** 出现在 `<Home />` 之上。
 *     - timeline band 不使用 `position: fixed`，也不使用 `100vw / 100vh`，
 *       宽度 `100%`、高度 `auto`，不会霸占整个视口、不会遮挡 Home 的顶部交互区。
 *     - Home 仍由其自身的 `h-[100svh] w-screen` 根容器负责全屏布局，
 *       wrapper band 只在视觉上把 timeline 收口为页面顶部的一条窄带。
 *   选择 wrapper band 而非给 `<Home />` 增加 `topbarSlot` 之类 prop 的原因：
 *   `Home.tsx` 是一个超过 2900 行、承担首页全部交互的核心组件，
 *   现在引入一个新的 layout slot prop 会扩散到大量返回路径与测试，风险大；
 *   而 wrapper band 完全在 cockpit 这一薄壳内闭环，不修改 `Home.tsx`。
 * - 6 步状态来自 `useProjectStore`，按保守级联派生（详见 `derive...` 函数）：
 *   - 没项目或项目无 clarification → `Project: running`
 *   - 有 clarification 但无 spec → `Clarification: running`
 *   - 有 spec 但无 route → `Spec: running`
 *   - 有 route 但无 mission → `Route: running`
 *   - 有 mission 但未全部结束 → `Execution: running`
 *   - 执行结束但无 evidence → `Evidence: running`
 *   - 全链路完结 → 6 步均 `completed`，无 running
 * - 颜色统一从 `visual-tokens-placeholder` 单一替换点取色，
 *   禁止在本文件中出现任何 `#` / `rgb()` / `hsl()` / `oklch()` 颜色字面量。
 * - `theme` 暂硬编码 `"light"`：与项目当前默认主题一致。
 *   后续若接入 `ThemeContext.useTheme()`，仅需替换此处即可，无需改动 timeline 组件。
 *
 * @see Requirements 14.1, 14.2, 14.3, 14.4
 */

import { useMemo } from "react";

import {
  MAIN_CHAIN_STEP_ORDER,
  ProjectMainChainTimeline,
  type MainChainStep,
  type MainChainStepKey,
  type MainChainStepStatus,
} from "@/components/autopilot/ProjectMainChainTimeline";
import { visualTokens } from "@/lib/autopilot/visual-tokens-placeholder";
import {
  useProjectStore,
  type Project,
  type ProjectClarificationQuestion,
  type ProjectEvidence,
  type ProjectMission,
} from "@/lib/project-store";

import Home, { type HomeProps } from "./Home";

/**
 * 输入：当前项目与项目侧的几张表，输出：当前 running 步骤的 key（或 null 表示全部完成）。
 *
 * 派生规则严格按保守级联（与 task 22.2 prompt 中的 6 步状态映射一致）：
 *
 * 1. 没项目 / 项目仍在 draft 且无 clarification → `Project`
 * 2. 有 clarification 信号但无 currentSpecId → `Clarification`
 * 3. 有 currentSpecId 但无 currentRouteId → `Spec`
 * 4. 有 currentRouteId 但无 mission → `Route`
 * 5. 有 mission 但仍有未完结 mission → `Execution`
 * 6. mission 全部完结但无 evidence → `Evidence`
 * 7. 否则全部 `completed`，返回 `null`。
 *
 * 函数纯，便于在测试中直接断言。
 */
export function deriveMainChainRunningKey(input: {
  readonly project: Project | null;
  readonly clarificationQuestions: ReadonlyArray<ProjectClarificationQuestion>;
  readonly missions: ReadonlyArray<ProjectMission>;
  readonly evidence: ReadonlyArray<ProjectEvidence>;
}): MainChainStepKey | null {
  const { project, clarificationQuestions, missions, evidence } = input;

  // 没有当前项目时，整条链路停在 `Project` 阶段。
  if (!project) {
    return "Project";
  }

  // 是否进入到 clarification 阶段：项目状态超出 draft，或已有任意 clarification 问题。
  const hasClarificationSignal =
    project.status !== "draft" ||
    clarificationQuestions.some(item => item.projectId === project.id);
  if (!hasClarificationSignal) {
    return "Project";
  }

  // 是否已锁定 currentSpecId（任意状态的 spec 均算签到 spec 阶段）。
  const hasSpec = Boolean(project.currentSpecId);
  if (!hasSpec) {
    return "Clarification";
  }

  // 是否已锁定 currentRouteId。
  const hasRoute = Boolean(project.currentRouteId);
  if (!hasRoute) {
    return "Spec";
  }

  // 是否已经创建任何 mission。
  const projectMissions = missions.filter(m => m.projectId === project.id);
  if (projectMissions.length === 0) {
    return "Route";
  }

  // mission 全部完结：所有 mission 都不在 queued/running/waiting 状态。
  const allMissionsResolved = projectMissions.every(
    m =>
      m.status === "completed" ||
      m.status === "failed" ||
      m.status === "cancelled",
  );
  if (!allMissionsResolved) {
    return "Execution";
  }

  // mission 完结但 evidence 仍空。
  const hasEvidence = evidence.some(e => e.projectId === project.id);
  if (!hasEvidence) {
    return "Evidence";
  }

  // 全链路完成。
  return null;
}

/**
 * 把 running key 投影成完整 6 步数组：running 之前为 `completed`，之后为 `pending`。
 *
 * `runningKey === null` 时，6 步全部 `completed`。
 */
export function buildMainChainSteps(
  runningKey: MainChainStepKey | null,
): MainChainStep[] {
  if (runningKey === null) {
    return MAIN_CHAIN_STEP_ORDER.map(key => ({
      key,
      status: "completed" as MainChainStepStatus,
    }));
  }

  const runningIndex = MAIN_CHAIN_STEP_ORDER.indexOf(runningKey);
  return MAIN_CHAIN_STEP_ORDER.map((key, index) => {
    let status: MainChainStepStatus;
    if (index < runningIndex) status = "completed";
    else if (index === runningIndex) status = "running";
    else status = "pending";
    return { key, status };
  });
}

/**
 * `ProjectCockpitHome` — 项目驾驶舱首页挂载点。
 *
 * 行为：
 * - 顶部叠加 `ProjectMainChainTimeline`（fixed 定位，不影响 Home 的全屏布局）。
 * - 主体仍交由 `<Home />` 渲染，避免重复 home 视图实现，也保证现有
 *   3D 场景、HoloDock、统一发起器与 Hub Dashboard 行为完全不变。
 */
export default function ProjectCockpitHome(props: HomeProps = {}) {
  // 从 project-first store 派生 6 步主链状态。
  const currentProjectId = useProjectStore(state => state.currentProjectId);
  const projects = useProjectStore(state => state.projects);
  const clarificationQuestions = useProjectStore(
    state => state.clarificationQuestions,
  );
  const missions = useProjectStore(state => state.missions);
  const evidence = useProjectStore(state => state.evidence);

  const currentProject = useMemo(
    () =>
      currentProjectId
        ? (projects.find(p => p.id === currentProjectId) ?? null)
        : null,
    [currentProjectId, projects],
  );

  const runningKey = useMemo(
    () =>
      deriveMainChainRunningKey({
        project: currentProject,
        clarificationQuestions,
        missions,
        evidence,
      }),
    [clarificationQuestions, currentProject, evidence, missions],
  );

  const steps = useMemo(() => buildMainChainSteps(runningKey), [runningKey]);
  const activeKey = runningKey ?? undefined;

  // theme 暂硬编码 light（项目当前默认主题）；后续接入 useTheme() 只需替换此变量。
  const theme = "light" as const;

  return (
    <div data-region="project-cockpit-layout-band">
      {/*
        顶部主链时间线槽位（Task 36.1 wrapper band 方案）：
        - 作为 layout band 的第一个 **正常流** 子节点出现在 `<Home />` 之上，
          不再使用 `position: fixed`，因此不会遮挡 Home 的导航 / 头部 / 主操作区；
        - 容器宽度 `100%`、高度 `auto`，**不使用** `100vw / 100vh`，
          确保只占据顶部一条窄带，不霸占整个视口；
        - `data-region="project-cockpit-timeline-band"` 是稳定的布局锚点，
          供 `ProjectCockpitHome.layout.test.tsx` 校验“timeline 在 layout band 内部”。
      */}
      <div
        data-region="project-cockpit-timeline-band"
        data-testid="project-cockpit-home-main-chain-timeline-slot"
        style={{
          width: "100%",
          height: "auto",
          display: "flex",
          justifyContent: "center",
          padding: "0.5rem 0.5rem 0",
          boxSizing: "border-box",
        }}
      >
        <ProjectMainChainTimeline
          steps={steps}
          activeKey={activeKey}
          visualTokens={visualTokens}
          theme={theme}
        />
      </div>
      <Home {...props} />
    </div>
  );
}
