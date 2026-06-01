/**
 * Autopilot 驾驶舱右栏 — 阶段独占视口布局单元测试
 *
 * 对应 spec：`.kiro/specs/autopilot-workbench-stage-rhythm/`
 *
 * 覆盖 4 个 case:
 * - case 1: activeSubStage="spec_tree" + 数据就绪,断言 StageViewport 渲染 spec_tree 阶段
 * - case 2: activeSubStage="spec_tree" + specTree=null,断言活跃阶段展示等待状态
 * - case 3: activeSubStage="agent_crew_fabric",断言仅渲染当前阶段 placeholder
 * - case 4: StageViewport 结构正确（header + content + cta）
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintSpecTree,
} from "@shared/blueprint/contracts";
import type { BlueprintAgentCrewSnapshot } from "@/lib/blueprint-api";

import {
  AutopilotRightRail,
  isManualWorkbenchStageOverrideValid,
  resolveHistoryEntryFamilyCount,
  resolveReplanCompletedViewFlag,
  resolveManualAdvanceAction,
  resolveManualPreviousAction,
} from "../AutopilotRightRail";
import {
  RAIL_SUB_STAGE_ORDER,
  type AutopilotRailSubStage,
  type AutopilotRightRailProps,
} from "../types";

function makeProps(
  overrides: Partial<AutopilotRightRailProps> = {},
): AutopilotRightRailProps {
  return {
    jobId: "job-test",
    currentStage: "fabric",
    job: { id: "job-test", stage: "spec_tree" } as unknown as BlueprintGenerationJob,
    routeSet: null,
    selection: null,
    specTree: null,
    agentCrew: null,
    capabilities: [],
    capabilityInvocations: [],
    capabilityEvidence: [],
    effectPreviews: [],
    locale: "zh-CN",
    onSubStageChange: () => {},
    ...overrides,
  };
}

const EMPTY_SPEC_TREE = {
  id: "spec-tree-test",
  nodes: [],
  documents: [],
} as unknown as BlueprintSpecTree;

const EMPTY_AGENT_CREW = {
  roleTimelines: [],
} as unknown as BlueprintAgentCrewSnapshot;

const FABRIC_SPEC_TREE = {
  id: "fabric-tree-test",
  rootNodeId: "node-preview",
  version: 1,
  nodes: [
    {
      id: "node-preview",
      title: "效果预演节点",
      type: "effect_preview",
      status: "ready",
    },
  ],
  documents: [
    {
      id: "doc-draft",
      nodeId: "node-preview",
      type: "requirements",
      status: "draft",
      title: "草稿需求",
      content: "draft content",
      format: "markdown",
      version: 1,
    },
  ],
} as unknown as BlueprintSpecTree;

describe("AutopilotRightRail streaming timeline", () => {
  it("renders the canonical EffectPreviewPanel for the effect_preview fabric sub-stage", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "effect_preview",
          job: {
            id: "job-test",
            stage: "effect_preview",
            status: "completed",
            artifacts: [],
          } as unknown as BlueprintGenerationJob,
          specTree: FABRIC_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain('data-stage-key="effect_preview"');
    expect(markup).toContain('data-sub-stage-placeholder="effect_preview"');
    expect(markup).toContain('data-testid="effect-preview-generate-button"');
    expect(markup).not.toContain('data-testid="timeline-confirm-advance"');
    expect(markup).not.toContain("POST /api/blueprint/prompt-packages");
  });

  it("renders the canonical PromptPackagePanel for the prompt_package fabric sub-stage", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "prompt_package",
          job: {
            id: "job-test",
            stage: "prompt_packaging",
            status: "running",
            artifacts: [],
          } as unknown as BlueprintGenerationJob,
          specTree: FABRIC_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain('data-stage-key="effect_preview"');
    expect(markup).toContain('data-sub-stage-placeholder="prompt_package"');
    expect(markup).toContain('data-testid="prompt-package-workbench"');
    expect(markup).not.toContain('data-testid="timeline-confirm-advance"');
    expect(markup).not.toContain("POST /api/blueprint/prompt-packages");
  });

  it("case 1: renders completed + active timeline nodes when activeSubStage=spec_tree and data is ready", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    // StageViewport 渲染 spec_tree 阶段
    expect(markup).toContain('data-stage-key="spec_tree"');
    // 活跃阶段有 data-timeline-status="active" 标记
    expect(markup).toContain('data-timeline-status="active"');
    // 活跃节点有 aria-current="step"
    expect(markup).toContain('aria-current="step"');
    // 活跃节点有 sub-stage placeholder
    expect(markup).toContain('data-sub-stage-placeholder="spec_tree"');
  });

  it("renders <StreamingDocRenderer /> in the spec_documents StageContent when job.stage === 'spec_docs' (autopilot-streaming-doc-renderer Task 6.1)", () => {
    // autopilot-streaming-doc-renderer 任务 6.1（2026-05-18）：
    // 当 `job.stage === "spec_docs"` 时，AutopilotRightRail 把 activeStageKey
    // 锁定到 `"spec_documents"`，StageContent 由 `<StreamingDocRenderer>` 接管，
    // 替代旧 autopilot-spec-tree-workbench (2026-05-17) 在该阶段渲染的
    // SpecTreeWorkbench accordion 折叠面板。
    const specTree = {
      id: "spec-tree-test",
      version: 1,
      nodes: [
        {
          id: "node-root",
          title: "Root SPEC",
          type: "root",
          children: ["node-docs"],
        },
        {
          id: "node-docs",
          parentId: "node-root",
          title: "Document node",
          type: "spec_document",
          children: [],
        },
      ],
    } as unknown as BlueprintSpecTree;
    const job = {
      id: "job-test",
      stage: "spec_docs",
      status: "reviewing",
      artifacts: [
        {
          type: "requirements",
          payload: {
            id: "doc-req",
            nodeId: "node-root",
            type: "requirements",
            title: "Requirements",
          },
        },
        {
          type: "design",
          payload: {
            id: "doc-design",
            nodeId: "node-root",
            type: "design",
            title: "Design",
          },
        },
      ],
    } as unknown as BlueprintGenerationJob;

    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          job,
          specTree,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    // 锁定 activeStageKey === "spec_documents" 分支
    expect(markup).toContain('data-stage-key="spec_documents"');
    // StreamingDocRenderer 占据 StageContent 主区域，并委托到四区工作台。
    expect(markup).toContain('data-testid="streaming-doc-renderer"');
    expect(markup).toContain('data-testid="autopilot-spec-documents-workbench"');
    // 重构后左侧 Spec 树按 nodeId 渲染，每份 SpecDocument 通过
    // autopilot-workbench-spec-tree-doc-* 暴露。
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-node-node-root"'
    );
    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree-doc-doc-req"');
    expect(markup).toContain(
      'data-testid="autopilot-workbench-spec-tree-doc-doc-design"'
    );
    // 不再走 SpecTreeWorkbench 分支
    expect(markup).not.toContain('data-testid="spec-tree-workbench"');
  });

  it("lets an explicit next sub-stage override stale spec_docs job state while the next step is being generated", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "effect_preview",
          job: {
            id: "job-test",
            stage: "spec_docs",
            status: "completed",
            artifacts: [],
          } as unknown as BlueprintGenerationJob,
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain('data-stage-key="effect_preview"');
    expect(markup).toContain('data-sub-stage-placeholder="effect_preview"');
    expect(markup).not.toContain('data-stage-key="spec_documents"');
  });

  it("case 2: renders awaiting state when specTree is null", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          specTree: null,
        })}
        locale="en-US"
      />,
    );

    // StageViewport 渲染 spec_tree 阶段
    expect(markup).toContain('data-stage-key="spec_tree"');
    // 活跃阶段有 data-timeline-status="active" 标记
    expect(markup).toContain('data-timeline-status="active"');
    // spec_tree 阶段同样挂载四区工作台；无树数据时由左侧 Spec 树空态承载。
    expect(markup).toContain('data-testid="autopilot-spec-documents-workbench"');
    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree-empty"');
    expect(markup).toContain("No SPEC nodes yet");
    // sub-stage placeholder 保留
    expect(markup).toContain('data-sub-stage-placeholder="spec_tree"');
  });

  it("case 3: future sub-stages do not get placeholder attributes when activeSubStage=agent_crew_fabric", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          job: { id: "job-test", stage: "agent_crew_fabric" } as unknown as BlueprintGenerationJob,
          currentSubStage: "agent_crew_fabric",
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    // 起点子阶段作为 active
    expect(markup).toContain('data-sub-stage-placeholder="agent_crew_fabric"');

    // 未来 7 个子阶段不应有 placeholder 属性(只有 active 才有)
    const futureSubStages = RAIL_SUB_STAGE_ORDER.slice(1) as readonly AutopilotRailSubStage[];
    for (const sub of futureSubStages) {
      expect(markup).not.toContain(`data-sub-stage-placeholder="${sub}"`);
    }
  });

  it("case 4: timeline nodes have correct structure with testid and index", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    // StageViewport 容器存在
    expect(markup).toContain('data-stage-key="spec_tree"');
    // 有 stage-index 属性
    expect(markup).toContain('data-stage-index="3"');
    // 中文模式下 StageHeader 不再混用英文 STEP / SPEC TREE。
    expect(markup).toContain("步骤 04");
    expect(markup).toContain("规格树");
    expect(markup).not.toContain("STEP 04");
    expect(markup).not.toContain("SPEC TREE");
    // 2026-05-19：StageCTA 已被移除（CTA 由 SpecTreeWorkbench 顶部双按钮承担）。
    // 改为断言 StageHeader 内的中文步骤编号 + 中文标题仍存在。
    expect(markup).toContain("步骤 04");
  });

  it("renders the replan entry point in the fabric action strip without duplicating header history", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "effect_preview",
          job: {
            id: "job-test",
            stage: "effect_preview",
            status: "completed",
            artifacts: [
              { id: "artifact-preview", type: "effect_preview" },
              { id: "artifact-prompt", type: "prompt_pack" },
            ],
          } as unknown as BlueprintGenerationJob,
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain('data-testid="autopilot-right-rail-action-strip"');
    expect(markup).not.toContain('data-testid="autopilot-history-entry"');
    expect(markup).not.toContain('data-version-history-entry-point="true"');
    expect(markup).not.toContain(">History<");
    expect(markup).toContain(
      'data-testid="autopilot-replan-from-stage-divider"'
    );
    expect(markup).toContain('data-stage="effect_preview"');
  });

  it("uses live family data for nested branch history counts when available", () => {
    expect(
      resolveHistoryEntryFamilyCount({
        familyJobCount: 3,
        hasParentJob: true,
      })
    ).toBe(3);

    expect(
      resolveHistoryEntryFamilyCount({
        familyJobCount: null,
        hasParentJob: true,
      })
    ).toBe(1);
    expect(
      resolveHistoryEntryFamilyCount({
        familyJobCount: null,
        hasParentJob: false,
      })
    ).toBe(1);
  });

  it("renders a stale indicator when the current stage artifact is stale", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          job: {
            id: "job-test",
            stage: "spec_docs",
            status: "completed",
            staleArtifactIds: ["artifact-requirements"],
            artifacts: [
              {
                id: "artifact-requirements",
                type: "requirements",
                staleSince: "2026-05-23T07:00:00.000Z",
                invalidatedBy: {
                  stage: "clarification",
                  artifactId: "artifact-clarification",
                  artifactType: "clarification_session",
                  reason: "upstream_clarification_changed",
                  triggeredAt: "2026-05-23T07:00:00.000Z",
                },
              },
            ],
          } as unknown as BlueprintGenerationJob,
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain(
      'data-testid="autopilot-right-rail-stale-indicator"',
    );
    expect(markup).toContain("当前阶段产物已过期");
    expect(markup).toContain("重新生成规格文档");
    expect(markup).not.toContain("Current stage artifact is stale");
    expect(markup).not.toContain("Regenerate documents");
  });

  it("renders a previous-step control for non-first fabric stages", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain('data-testid="autopilot-stage-back-button"');
    expect(markup).toContain('data-previous-target-kind="workflow-stage"');
    expect(markup).toContain('data-previous-workflow-stage="input"');
    expect(markup).toContain('aria-label="返回上一步"');
  });

  it("targets the outer route-generation workflow page when returning from SPEC documents", () => {
    const action = resolveManualPreviousAction({
      activeSubStage: "spec_tree",
      activeStageKey: "spec_documents",
      isViewingCompletedStage: false,
    });

    expect(action).toEqual({
      type: "workflow-stage",
      previousStage: "input",
    });
  });

  it("targets the outer route-generation workflow page from the merged SPEC tree view", () => {
    const action = resolveManualPreviousAction({
      activeSubStage: "spec_tree",
      activeStageKey: "spec_tree",
      isViewingCompletedStage: false,
    });

    expect(action).toEqual({
      type: "workflow-stage",
      previousStage: "input",
    });
  });

  it("keeps SPEC documents as the visual previous step from effect preview", () => {
    const action = resolveManualPreviousAction({
      activeSubStage: "effect_preview",
      activeStageKey: "effect_preview",
      isViewingCompletedStage: false,
    });

    expect(action).toEqual({
      type: "workbench-stage",
      previousStage: "spec_documents",
      previousSubStage: "spec_tree",
    });
  });

  it("treats manual previous-workbench navigation as a completed-view replan context", () => {
    expect(
      resolveReplanCompletedViewFlag({
        isViewingCompletedStage: false,
        manualStageOverride: "spec_documents",
        coercedStaleRoutePin: false,
      }),
    ).toBe(true);
    expect(
      resolveReplanCompletedViewFlag({
        isViewingCompletedStage: false,
        manualStageOverride: null,
        coercedStaleRoutePin: true,
      }),
    ).toBe(true);
    expect(
      resolveReplanCompletedViewFlag({
        isViewingCompletedStage: true,
        manualStageOverride: null,
        coercedStaleRoutePin: false,
      }),
    ).toBe(true);
    expect(
      resolveReplanCompletedViewFlag({
        isViewingCompletedStage: false,
        manualStageOverride: null,
        coercedStaleRoutePin: false,
      }),
    ).toBe(false);
  });

  it("keeps the SPEC documents override during the folded effect-preview handoff", () => {
    expect(
      isManualWorkbenchStageOverrideValid("spec_documents", {
        activeSubStage: "runtime_capability",
        jobStage: "runtime_capability",
      }),
    ).toBe(true);
    expect(
      isManualWorkbenchStageOverrideValid("spec_documents", {
        activeSubStage: "runtime_capability",
        jobStage: undefined,
      }),
    ).toBe(true);
  });

  it("keeps SPEC documents as the visual previous step from every STEP 06 folded sub-stage", () => {
    const foldedSubStages: AutopilotRailSubStage[] = [
      "prompt_package",
      "runtime_capability",
      "engineering_handoff",
      "artifact_memory",
    ];

    for (const activeSubStage of foldedSubStages) {
      const action = resolveManualPreviousAction({
        activeSubStage,
        activeStageKey: "effect_preview",
        isViewingCompletedStage: false,
      });

      expect(action).toEqual({
        type: "workbench-stage",
        previousStage: "spec_documents",
        previousSubStage: "spec_tree",
      });
    }
  });

  it("renders the SPEC documents back control with an outer workflow-page target, not the rail predecessor", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          job: {
            id: "job-test",
            stage: "spec_docs",
            status: "reviewing",
            artifacts: [],
          } as unknown as BlueprintGenerationJob,
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain('data-stage-key="spec_documents"');
    expect(markup).toContain('data-testid="autopilot-stage-back-button"');
    expect(markup).toContain('data-previous-target-kind="workflow-stage"');
    expect(markup).toContain('data-previous-workflow-stage="input"');
    expect(markup).not.toContain('data-previous-workbench-stage="route"');
    expect(markup).not.toContain('data-previous-sub-stage="agent_crew_fabric"');
  });

  it("treats a downstream job pinned back to spec_tree as the merged SPEC documents page", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          job: {
            id: "job-test",
            stage: "runtime_capability",
            status: "reviewing",
            artifacts: [
              { id: "artifact-preview", type: "effect_preview" },
              { id: "artifact-capability", type: "capability_registry" },
            ],
          } as unknown as BlueprintGenerationJob,
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain('data-autopilot-sub-stage="spec_tree"');
    expect(markup).toContain('data-stage-key="spec_documents"');
    expect(markup).toContain('data-testid="autopilot-replan-from-stage-divider"');
    expect(markup).toContain('data-stage="spec_docs"');
    expect(markup).toContain("2 downstream");
  });

  it("keeps the route page reachable even after downstream SPEC documents exist", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "agent_crew_fabric",
          job: {
            id: "job-test",
            stage: "runtime_capability",
            status: "reviewing",
            artifacts: [],
          } as unknown as BlueprintGenerationJob,
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain('data-autopilot-sub-stage="agent_crew_fabric"');
    expect(markup).toContain('data-stage-key="route"');
    expect(markup).toContain("步骤 03");
    expect(markup).not.toContain('data-testid="autopilot-workbench-action-refresh"');
    expect(markup).not.toContain('data-testid="autopilot-stage-back-button"');
  });

  it("does not render the previous-step control at the first fabric sub-stage", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "agent_crew_fabric",
          job: { id: "job-test", stage: "agent_crew_fabric" } as unknown as BlueprintGenerationJob,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).not.toContain('data-testid="autopilot-stage-back-button"');
  });

  it("manual continue advances within STEP 06 sub-stages instead of no-oping at the last workbench stage", () => {
    expect(
      resolveManualAdvanceAction({
        activeSubStage: "prompt_package",
        activeStageIndex: 5,
        isViewingCompletedStage: false,
      })
    ).toEqual({
      type: "sub-stage",
      nextSubStage: "runtime_capability",
    });
  });

  it("manual continue moves from the merged SPEC tree review back into SPEC documents", () => {
    expect(
      resolveManualAdvanceAction({
        activeSubStage: "spec_tree",
        activeStageIndex: 3,
        isViewingCompletedStage: false,
      })
    ).toEqual({
      type: "workbench-stage",
      nextStage: "spec_documents",
      nextSubStage: "spec_tree",
    });
  });

  it("renders a visible continue control on the SPEC tree review page", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          job: {
            id: "job-test",
            stage: "spec_tree",
            status: "reviewing",
            artifacts: [],
          } as unknown as BlueprintGenerationJob,
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain('data-stage-key="spec_tree"');
    expect(markup).toContain('data-testid="autopilot-stage-continue-button"');
    expect(markup).toContain("进入规格文档");
  });

  it("does not render a bottom continue button when the final fabric sub-stage has no next action", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "artifact_memory",
          job: {
            id: "job-test",
            stage: "engineering_landing",
          } as unknown as BlueprintGenerationJob,
          selection: {} as AutopilotRightRailProps["selection"],
        })}
      />,
    );

    expect(markup).toContain('data-sub-stage-placeholder="artifact_memory"');
    expect(markup).not.toContain('data-testid="timeline-confirm-advance"');
  });

  it("does not mount the bottom NarrativeSwiper in the fabric right rail", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../AutopilotRightRail.tsx"),
      "utf8"
    );

    expect(source).not.toMatch(/NarrativeSwiper/);
    expect(source).not.toMatch(/narrative-swiper/);
  });

  it("does not re-export the removed bottom NarrativeSwiper from the right-rail barrel", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../index.ts"),
      "utf8"
    );

    expect(source).not.toMatch(/NarrativeSwiper/);
    expect(source).not.toMatch(/narrative-swiper/);
  });

  it("exposes a forward chevron in the StageHeader so users can re-enter SPEC documents after backtracking", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          job: {
            id: "job-test",
            stage: "spec_tree",
            status: "reviewing",
            artifacts: [],
          } as unknown as BlueprintGenerationJob,
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    expect(markup).toContain('data-testid="autopilot-stage-forward-button"');
    expect(markup).toContain('data-next-target-kind="workbench-stage"');
    expect(markup).toContain('data-next-workbench-stage="spec_documents"');
  });

  it("exposes a forward chevron during fabric sub-stage navigation (continue within STEP 06)", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "prompt_package",
          job: {
            id: "job-test",
            stage: "prompt_packaging",
            status: "running",
            artifacts: [],
          } as unknown as BlueprintGenerationJob,
        })}
      />,
    );

    expect(markup).toContain('data-testid="autopilot-stage-forward-button"');
    expect(markup).toContain('data-next-target-kind="sub-stage"');
    expect(markup).toContain('data-next-sub-stage="runtime_capability"');
  });

  it("hides the StageHeader forward chevron when there is no next action (artifact_memory tail)", () => {
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "artifact_memory",
          job: {
            id: "job-test",
            stage: "engineering_landing",
          } as unknown as BlueprintGenerationJob,
        })}
      />,
    );

    expect(markup).not.toContain('data-testid="autopilot-stage-forward-button"');
  });

  it("after backtracking from spec_documents, the SPEC tree view exposes BOTH back AND forward navigation", () => {
    // 模拟用户在 spec_documents 阶段点了"返回上一步" → currentSubStage 变成
    // "spec_tree"，但 backend job.stage 仍然停在 "spec_docs"（因为后端 stage
    // 是"已经走到哪里"的真相源；spec 5 §10.9 明确只有 replan 才能回退 backend
    // job.stage）。这正是用户报告的"从规格文档回到上一级之后没有去下一级
    // 的操作办法"场景。
    const markup = renderToStaticMarkup(
      <AutopilotRightRail
        {...makeProps({
          currentSubStage: "spec_tree",
          job: {
            id: "job-test",
            stage: "spec_docs",
            status: "reviewing",
            artifacts: [],
          } as unknown as BlueprintGenerationJob,
          specTree: EMPTY_SPEC_TREE,
          agentCrew: EMPTY_AGENT_CREW,
        })}
      />,
    );

    // 头部的"返回上一步"按钮仍然在
    expect(markup).toContain('data-testid="autopilot-stage-back-button"');
    // 头部新增的"继续下一步"前进箭头出现
    expect(markup).toContain('data-testid="autopilot-stage-forward-button"');
    expect(markup).toContain('data-next-target-kind="workbench-stage"');
    expect(markup).toContain('data-next-workbench-stage="spec_documents"');
    // 底部 CTA 按钮也存在（双重保险）
    expect(markup).toContain('data-testid="autopilot-stage-continue-button"');
    expect(markup).toContain("进入规格文档");
  });
});

describe("AutopilotRightRail replan integration contract", () => {
  it("routes modal confirmation through useReplanFlow instead of bypassing the branch-aware flow", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../AutopilotRightRail.tsx"),
      "utf8",
    );
    const handlerStart = source.indexOf("const handleConfirmReplan");
    const handlerEnd = source.indexOf("const handleRegenerateStaleStage");
    const handlerSource = source.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(source).toContain("useReplanFlow");
    expect(handlerSource).toContain("replanFlow.confirmReplan");
    expect(source).toContain("toastQueue");
    expect(handlerSource).not.toContain("postBlueprintReplan(props.jobId");
    expect(handlerSource).not.toContain("props.onJobUpdated?.(result.data.job)");
  });
});
