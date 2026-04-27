import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { MissionTaskDetail } from "@/lib/tasks-store";
import { useAppStore } from "@/lib/store";

import { TaskAutopilotPanel } from "../TaskAutopilotPanel";
import { TaskDetailView } from "../TaskDetailView";

vi.mock("@/components/rag/RAGInfoPanel", () => ({
  RAGInfoPanel: () => null,
}));

vi.mock("@/components/rag/RAGDebugPanel", () => ({
  RAGDebugPanel: () => null,
}));

type DetailWithAutopilot = MissionTaskDetail & {
  autopilotSummary?: (
    MissionTaskDetail & { autopilotSummary?: unknown }
  )["autopilotSummary"];
};

function makeDetail(
  overrides?: Partial<MissionTaskDetail>,
  autopilotSummary?: unknown
): DetailWithAutopilot {
  return {
    id: "mission-1",
    title: "Autopilot alignment",
    kind: "analysis",
    sourceText:
      "Align the autopilot projection panel with the latest task detail view.",
    status: "running",
    operatorState: "active",
    workflowStatus: "running",
    progress: 48,
    currentStageKey: "execute",
    currentStageLabel: "Execute",
    summary: "Keep the task detail view aligned with the autopilot summary.",
    waitingFor: null,
    blocker: null,
    attempt: 1,
    latestOperatorAction: null,
    createdAt: Date.now() - 300_000,
    updatedAt: Date.now() - 30_000,
    startedAt: Date.now() - 240_000,
    completedAt: null,
    departmentLabels: ["Platform"],
    taskCount: 0,
    completedTaskCount: 0,
    messageCount: 0,
    activeAgentCount: 0,
    attachmentCount: 0,
    issueCount: 0,
    hasWarnings: false,
    lastSignal: "Projection refresh succeeded.",
    workflow: {
      id: "workflow-1",
      directive:
        "Align the autopilot projection panel with the latest task detail view.",
      status: "running",
      current_stage: "execute",
      departments_involved: ["Platform"],
      started_at: new Date(Date.now() - 240_000).toISOString(),
      completed_at: null,
      results: null,
      created_at: new Date(Date.now() - 300_000).toISOString(),
    },
    tasks: [],
    messages: [],
    report: null,
    organization: null,
    stages: [],
    agents: [],
    timeline: [],
    artifacts: [],
    failureReasons: [],
    decisionPresets: [],
    decisionPrompt: null,
    decisionPlaceholder: null,
    decisionAllowsFreeText: false,
    decision: null,
    instanceInfo: [],
    logSummary: [],
    runtimeChannels: {
      socket: {
        status: "connected",
        label: "Socket connected",
        detail:
          "Mission socket is connected and can receive live runtime updates.",
      },
      callback: {
        status: "idle",
        label: "Callback idle",
        detail:
          "No executor callback has been recorded for this mission yet.",
      },
    },
    decisionHistory: [],
    operatorActions: [],
    missionArtifacts: [],
    ...overrides,
    autopilotSummary:
      autopilotSummary as DetailWithAutopilot["autopilotSummary"],
  };
}

beforeEach(() => {
  useAppStore.getState().setLocale("en-US");
});

describe("TaskAutopilotPanel", () => {
  it("renders a readable panel from the current autopilotSummary alias fields", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Ship the weekly operations report",
          },
          route: {
            label: "Stable review lane",
            summary: "Collect evidence, draft the report, then verify.",
            mode: "standard",
          },
          driveState: "takeover-required",
          fleetRole: "Planner + Reviewer",
          takeover: {
            reason: "Need human approval before the final release handoff.",
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-panel"');
    expect(markup).toContain('data-testid="autopilot-cockpit-layout"');
    expect(markup).toContain(
      'data-testid="task-autopilot-cockpit-destination-route"'
    );
    expect(markup).toContain(
      'data-testid="task-autopilot-cockpit-drive-fleet-outputs"'
    );
    expect(markup).toContain(
      'data-testid="task-autopilot-cockpit-decision-takeover"'
    );
    expect(markup).toContain(
      'data-testid="task-autopilot-cockpit-evidence-cost-risk"'
    );
    expect(markup).toContain("Ship the weekly operations report");
    expect(markup).toContain("Stable review lane");
    expect(markup).toMatch(/Standard|\u6807\u51c6/);
    expect(markup).toMatch(/Takeover Required|\u9700\u8981\u63a5\u7ba1/);
    expect(markup).toContain("Planner + Reviewer");
    expect(markup).toContain(
      "Need human approval before the final release handoff."
    );
  });

  it("supports nested shared-style autopilotSummary fields without falling back to generic copy", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Close the audit loop",
          },
          route: {
            selected: {
              title: "Deep compliance route",
              summary: "Trace evidence before publish.",
              mode: "deep",
            },
          },
          driveState: {
            key: "reviewing",
            summary: "Quality gates are running.",
          },
          fleet: {
            roles: [
              { title: "Planner" },
              { roleType: "auditor" },
              { name: "Reviewer" },
            ],
          },
          takeover: {
            status: "pending",
            reason: "Budget exception needs sign-off.",
          },
        })}
      />
    );

    expect(markup).toContain("Close the audit loop");
    expect(markup).toContain("Deep compliance route");
    expect(markup).toContain("Trace evidence before publish.");
    expect(markup).toMatch(/Deep|\u6df1\u5ea6/);
    expect(markup).toMatch(/Reviewing|\u590d\u6838\u4e2d/);
    expect(markup).toContain("Quality gates are running.");
    expect(markup).toMatch(
      /Planner \/ Auditor \/ Reviewer|Planner \/ \u5ba1\u8ba1\u8005 \/ Reviewer/
    );
    expect(markup).toMatch(/Pending|\u5f85\u5904\u7406/);
    expect(markup).toContain("Budget exception needs sign-off.");
  });

  it("renders the shared/client autopilot summary shape with stable section details", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Close the audit loop",
            request: "Prepare the approval packet for release.",
            constraints: ["Do not change the rollout window."],
            successCriteria: ["Human approval is recorded."],
            deliverables: ["approval-packet.md"],
            missingInfo: ["Confirm the release owner."],
          },
          route: {
            label: "Server selected route",
            status: "running",
            progress: 77,
            currentStageLabel: "Run execution",
            takeoverPointIds: ["takeover-1", "takeover-2"],
            selectedRouteId: "route-release:standard",
            recommendedRouteId: "route-release:deep",
            candidateRoutes: [
              {
                id: "route-release:standard",
                label: "Standard release route",
                summary: "Keep the current release lane moving.",
                mode: "standard",
                status: "running",
                selected: true,
                recommended: false,
                locked: false,
                estimatedDuration: "20m",
                estimatedCost: "$4",
                riskLevel: "medium",
                takeoverLoad: "medium",
              },
              {
                id: "route-release:deep",
                label: "Deep verification route",
                summary: "Trace evidence before publish.",
                mode: "deep",
                status: "pending",
                selected: false,
                recommended: true,
                locked: false,
                estimatedDuration: "45m",
                estimatedCost: "$9",
                riskLevel: "low",
                takeoverLoad: "low",
              },
              {
                id: "route-release:fast",
                label: "Fast unblock route",
                summary: "Trade depth for a quick unblock.",
                mode: "fast",
                status: "pending",
                selected: false,
                recommended: false,
                locked: false,
                estimatedDuration: "10m",
                estimatedCost: "$2",
                riskLevel: "high",
                takeoverLoad: "high",
              },
            ],
            riskPoints: ["Release approval is still pending."],
            stages: [
              {
                key: "execute",
                label: "Run execution",
                status: "running",
                detail: "Executor is collecting release evidence.",
                isCurrent: true,
              },
            ],
          },
          driveState: {
            state: "reviewing",
            label: "Server reviewing",
            detail: "Server projection is reviewing artifacts.",
            currentStageLabel: "Run execution",
            waitingForUser: true,
            riskLevel: "medium",
            confidence: "high",
          },
          recovery: {
            state: "recovering",
            deviationCategory: "quality-deviation",
            reason: "Approval evidence is incomplete.",
            attemptedActions: ["retry"],
            suggestedActions: ["replan", "escalate"],
            needsHuman: true,
            canAutoRecover: false,
          },
          fleet: {
            roles: [
              {
                id: "planner",
                roleType: "planner",
                title: "Planner",
                status: "running",
              },
              {
                id: "operator",
                roleType: "operator",
                title: "Operator",
                status: "waiting",
              },
              {
                id: "executor",
                roleType: "executor",
                title: "Executor",
                status: "blocked",
              },
            ],
            activeRoleCount: 2,
            blockedRoleCount: 1,
          },
          outputs: {
            items: [
              {
                title: "approval-packet.md",
                description: "Draft approval packet for release review.",
              },
              {
                label: "risk-register.json",
                detail: "Structured risk register draft.",
              },
            ],
          },
          blockers: {
            items: [
              {
                title: "Approval gate",
                reason: "Release approval is still pending.",
                recovery: "Collect human sign-off.",
              },
            ],
          },
          evidence: {
            eventCount: 14,
            artifactCount: 3,
            lastSignal: "Executor uploaded a refreshed approval packet.",
            latestEventType: "progress",
            updatedAt: "2026-04-24T08:30:00.000Z",
            trustLevel: "partial",
            gaps: ["No signed approval attachment yet."],
            sources: ["mission logs", "executor callback"],
            timeline: [
              {
                id: "evt-1",
                type: "route_change",
                label: "Route recommendation updated",
                detail: "Deep verification route is now preferred.",
                status: "info",
                source: "planner",
                time: "2026-04-24T08:20:00.000Z",
              },
              {
                id: "evt-2",
                type: "operator_action",
                label: "Operator requested approval",
                detail: "Waiting for release owner confirmation.",
                status: "waiting",
                source: "operator",
                time: "2026-04-24T08:25:00.000Z",
              },
            ],
          },
          explanation: {
            current: "Autopilot is holding the release until evidence is complete.",
            nextSteps: ["Collect signed approval", "Re-run the release check"],
            recommendationReasons: [
              "Deep verification route reduces release risk.",
            ],
            remainingSteps: {
              currentStepKey: "execute",
              currentStepLabel: "Run execution",
              pendingSteps: [
                {
                  key: "review",
                  label: "Review approval packet",
                  status: "pending",
                  isCurrent: false,
                },
                {
                  key: "deliver",
                  label: "Deliver release summary",
                  status: "pending",
                  isCurrent: false,
                },
              ],
              parallelBranchCount: 2,
              replanChangeSummary:
                "Verification branch stays active until approval arrives.",
            },
            riskSummary: ["External write is still human-gated."],
            evidenceHints: ["Open the approval packet and audit trail."],
            telemetrySignals: ["drive.state:reviewing", "recovery.state:recovering"],
          },
          takeover: {
            status: "required",
            required: true,
            blocking: true,
            type: "approval",
            reason: "Choose whether to continue with the external write.",
            prompt: "Approve external write?",
            options: [
              {
                id: "approve",
                label: "Approve",
                description: "Continue the route.",
              },
              {
                id: "reject",
                label: "Reject",
                description: "Stop the route.",
              },
            ],
            urgency: "medium",
          },
        })}
      />
    );

    expect(markup).toContain("Close the audit loop");
    expect(markup).toMatch(
      /Constraints: Do not change the rollout window\.|\u7ea6\u675f: Do not change the rollout window\./
    );
    expect(markup).toContain("Server selected route");
    expect(markup).toContain("Standard release route");
    expect(markup).toContain("Deep verification route");
    expect(markup).toContain("Fast unblock route");
    expect(markup).toContain("20m");
    expect(markup).toContain("ETA Summary");
    expect(markup).toContain("$4");
    expect(markup).toContain("risk");
    expect(markup).toContain("takeover");
    expect(markup).toContain("2 steps left");
    expect(markup).toContain("Review approval packet; Deliver release summary");
    expect(markup).toMatch(/parallel|并行/);
    expect(markup).toContain("Verification branch stays active until approval arrives.");
    expect(markup).toMatch(/77% complete|\u8fdb\u5ea6 77%/);
    expect(markup).toMatch(/Status: Running|\u72b6\u6001: \u8fdb\u884c\u4e2d/);
    expect(markup).toContain("Executor is collecting release evidence.");
    expect(markup).toMatch(/Live execution|\u5f53\u524d\u6267\u884c/i);
    expect(markup).toMatch(/Live: Planner; Operator|Live: Planner:| \u5728\u7ebf:/);
    expect(markup).toContain("Server reviewing");
    expect(markup).toMatch(/Waiting for user|\u7b49\u5f85\u7528\u6237/);
    expect(markup).toMatch(/Risk|风险/);
    expect(markup).toContain("Server projection is reviewing artifacts.");
    expect(markup).toContain("Planner / Operator / Executor");
    expect(markup).toMatch(/2 active|2 \u4e2a\u6d3b\u8dc3\u89d2\u8272/);
    expect(markup).toMatch(/1 blocked|1 \u4e2a\u963b\u585e\u89d2\u8272/);
    expect(markup).toContain("Approval gate");
    expect(markup).toMatch(/Choose whether to continue with the external write\./);
    expect(markup).toContain('data-testid="task-autopilot-recovery"');
    expect(markup).toMatch(/Recovering/);
    expect(markup).toContain("Approval evidence is incomplete.");
    expect(markup).toContain("Approval evidence is incomplete.");
    expect(markup).toContain("Retry");
    expect(markup).toMatch(/Suggested: Replan; Escalate/);
    expect(markup).toContain("approval-packet.md");
    expect(markup).toContain("risk-register.json");
    expect(markup).toMatch(/14 events|14 \u6761\u4e8b\u4ef6/);
    expect(markup).toMatch(/3 artifacts|3 \u4e2a\u4ea7\u7269/);
    expect(markup).toContain("Executor uploaded a refreshed approval packet.");
    expect(markup).toMatch(/Trust: Partial|Trust: 部分验证/);
    expect(markup).toMatch(/Gaps: No signed approval attachment yet\.|缺口: No signed approval attachment yet\./);
    expect(markup).toMatch(/Timeline: Route recommendation updated/);
    expect(markup).toContain('data-testid="task-autopilot-explanation"');
    expect(markup).toContain(
      "Autopilot is holding the release until evidence is complete."
    );
    expect(markup).toMatch(/Next: Collect signed approval; Re-run the release check/);
    expect(markup).toMatch(
      /Why: Deep verification route reduces release risk\.|原因: Deep verification route reduces release risk\./
    );
    expect(markup).toMatch(/Approval required|\u5ba1\u6279\u63a5\u7ba1/);
    expect(markup).toContain("Approve external write?");
    expect(markup).toMatch(
      /Options: Approve: Continue the route\.; Reject: Stop the route\.|\u9009\u9879: Approve: Continue the route\.; Reject: Stop the route\./
    );
    expect(markup).toMatch(/Required|\u5fc5\u9700/);
    expect(markup).toMatch(/Action required/);
    expect(markup).toMatch(/Blocking route progression|阻塞当前路线/);
  });

  it("surfaces live execution, blockers, outputs, and evidence from alias-style fields without changing panel layout", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Prepare the launch update",
          },
          route: {
            label: "Launch review lane",
            currentStage: {
              label: "Review external copy",
              status: "running",
              detail: "Reviewer is checking the launch summary.",
            },
            progress: 62,
          },
          driveState: {
            state: "blocked",
            detail: "Waiting for compliance approval.",
            blocked: true,
          },
          fleet: {
            roles: [
              {
                title: "Reviewer",
                status: "running",
                currentFocus: "Check launch summary",
                boundAgents: ["agent-reviewer"],
              },
              {
                roleType: "executor",
                status: "waiting",
                boundExecutors: ["job-7788"],
              },
            ],
          },
          blockingSummary: "Compliance gate is holding the release.",
          blockers: {
            items: [
              {
                label: "Compliance gate",
                recovery: "Attach the final approval email.",
              },
            ],
          },
          outputsOverview: "launch-update.md; qa-checklist.json",
          evidenceOverview: "6 events | 2 artifacts",
          evidence: {
            latest: {
              type: "waiting",
              updatedAt: "2026-04-24T09:00:00.000Z",
            },
            sources: ["callback", "artifacts"],
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-panel"');
    expect(markup).toContain('data-testid="task-autopilot-execution"');
    expect(markup).toContain('data-testid="task-autopilot-blockers"');
    expect(markup).toContain('data-testid="task-autopilot-outputs"');
    expect(markup).toContain('data-testid="task-autopilot-evidence"');
    expect(markup).toContain("Review external copy");
    expect(markup).toContain("Reviewer is checking the launch summary.");
    expect(markup).toContain("Compliance gate is holding the release.");
    expect(markup).toContain("Attach the final approval email.");
    expect(markup).toContain("launch-update.md");
    expect(markup).toContain("qa-checklist.json");
    expect(markup).toMatch(/Waiting|Blocked|\u7b49\u5f85|\u963b\u585e/);
    expect(markup).toMatch(/callback|artifacts/i);
  });

  it("reads normalized fleet and live execution fields from the client store projection", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Ship the governed rollout",
          },
          execution: {
            currentStepLabel: "Run rollout checks",
            currentStepStatus: "blocked",
            parallelBranchCount: 3,
            blockedReasons: [
              "Awaiting approval from the release owner.",
              "Executor callback is delayed.",
            ],
            intermediateDeliverables: [
              "rollout-checklist.md",
              "approval-packet.md",
            ],
            availableActions: [
              {
                id: "mission-1:resume",
                type: "resume",
                label: "resume",
                scope: "stage",
                enabled: true,
              },
              {
                id: "mission-1:replan",
                type: "replan",
                label: "replan",
                scope: "route",
                enabled: true,
              },
            ],
          },
          fleet: {
            roles: [
              {
                id: "planner",
                roleType: "planner",
                title: "Planner",
                status: "running",
                currentFocus: "Verify rollout guardrails",
                boundAgents: ["agent-planner"],
              },
              {
                id: "executor",
                roleType: "executor",
                title: "Executor",
                status: "waiting",
                boundExecutors: ["job-42"],
              },
              {
                id: "operator",
                roleType: "operator",
                title: "Operator",
                status: "blocked",
              },
            ],
            activeRoleCount: 2,
            blockedRoleCount: 1,
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-execution"');
    expect(markup).toContain('data-testid="task-autopilot-fleet"');
    expect(markup).toContain('data-fleet-source="AutopilotFleetLiveView"');
    expect(markup).toContain('data-testid="autopilot-fleet-live-view"');
    expect(markup).toContain('data-testid="fleet-lane-planning"');
    expect(markup).toContain('data-testid="fleet-lane-governance"');
    expect(markup).toContain("Run rollout checks");
    expect(markup).toMatch(/Blocked|\u963b\u585e/);
    expect(markup).toMatch(/3 parallel branches|3 \u4e2a\u5e76\u884c\u5206\u652f/);
    expect(markup).toContain("Awaiting approval from the release owner.");
    expect(markup).toContain("Executor callback is delayed.");
    expect(markup).toContain("rollout-checklist.md");
    expect(markup).toContain("approval-packet.md");
    expect(markup).toMatch(/Resume|Replan/);
    expect(markup).toContain("Planner / Executor / Operator");
    expect(markup).toMatch(/2 active|2 \u4e2a\u6d3b\u8dc3\u89d2\u8272/);
    expect(markup).toMatch(/1 blocked|1 \u4e2a\u963b\u585e\u89d2\u8272/);
    expect(markup).toContain("1 Planner binding");
    expect(markup).toContain("1 Operator binding");
    expect(markup).not.toContain("agent-planner");
    expect(markup).not.toContain("job-42");
  });

  it("renders route selection, recovery, evidence, and explanation blocks from normalized autopilot summary fields", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Recover the release lane",
          },
          route: {
            label: "Recovery lane",
            status: "running",
            takeoverPointIds: ["takeover-1"],
            selectedRouteId: "route-recovery:standard",
            recommendedRouteId: "route-recovery:deep",
            selection: {
              status: "replanned",
              mode: "runtime_replanned",
              changedBy: "runtime",
              changedAt: "2026-04-24T09:28:00.000Z",
              switchRequiresConfirmation: true,
            },
            candidateRoutes: [
              {
                id: "route-recovery:standard",
                label: "Standard recovery route",
                summary: "Keep current route while waiting on evidence.",
                mode: "standard",
                status: "running",
                selected: true,
                recommended: false,
                locked: true,
                estimatedDuration: "15m",
                estimatedCost: "$3",
                riskLevel: "medium",
                takeoverLoad: "medium",
              },
              {
                id: "route-recovery:deep",
                label: "Deep recovery route",
                summary: "Pause and verify every external side effect.",
                mode: "deep",
                status: "pending",
                selected: false,
                recommended: true,
                locked: false,
                estimatedDuration: "35m",
                estimatedCost: "$7",
                riskLevel: "low",
                takeoverLoad: "low",
              },
            ],
            changeReason: "Runtime switched to a safer route after repeated failure.",
            evidence: {
              lastEventType: "route.replanned",
              lastEventAt: "2026-04-24T09:29:00.000Z",
              events: [
                {
                  eventType: "route.replanned",
                  actor: "runtime",
                  reason: "Retry budget is exhausted.",
                  fromRouteId: "route-recovery:deep",
                  toRouteId: "route-recovery:standard",
                  at: "2026-04-24T09:29:00.000Z",
                },
              ],
            },
            replan: {
              active: true,
              reason: "Retry budget is exhausted.",
              fromRouteId: "route-recovery:deep",
              toRouteId: "route-recovery:standard",
              triggeredBy: "runtime",
            },
          },
          recovery: {
            state: "takeover-required",
            deviationCategory: "state-block",
            reason: "Automatic retry budget is exhausted.",
            attemptedActions: ["retry", "escalate"],
            suggestedActions: ["resume"],
            needsHuman: true,
            canAutoRecover: false,
          },
          evidence: {
            eventCount: 4,
            artifactCount: 1,
            trustLevel: "verified",
            latestEventType: "operator_action",
            gaps: ["Missing final owner acknowledgement."],
            timeline: [
              {
                id: "timeline-1",
                type: "operator_action",
                label: "Operator escalated the retry failure",
                detail: "Mission is waiting on a human decision.",
                status: "blocked",
                source: "runtime",
                time: "2026-04-24T09:30:00.000Z",
              },
            ],
          },
          explanation: {
            current: "The panel is surfacing the smallest safe next move.",
            nextSteps: ["Resume after owner approval"],
            recommendationReasons: ["The deep route keeps the audit trail intact."],
            remainingSteps: {
              currentStepKey: "execute",
              currentStepLabel: "Run execution",
              pendingSteps: [
                {
                  key: "approve",
                  label: "Approve the safer route",
                  status: "pending",
                  isCurrent: false,
                },
              ],
              parallelBranchCount: 1,
            },
            telemetrySignals: ["recovery.state:takeover-required"],
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-route"');
    expect(markup).toContain('data-testid="task-autopilot-recovery"');
    expect(markup).toContain('data-testid="task-autopilot-evidence"');
    expect(markup).toContain('data-testid="task-autopilot-explanation"');
    expect(markup).toContain("Runtime switched to a safer route after repeated failure.");
    expect(markup).toMatch(/Replanned|重规划/);
    expect(markup).toContain("Switch requires confirmation");
    expect(markup).toMatch(/Route locked|路线已锁定/);
    expect(markup).toMatch(/Replan active|重规划/);
    expect(markup).toContain("Route Evidence:");
    expect(markup).toContain("$3");
    expect(markup).toContain("takeover point");
    expect(markup).toContain("1");
    expect(markup).toContain("Approve the safer route");
    expect(markup).toMatch(/parallel|并行/);
    expect(markup).toMatch(/State Block|状态阻塞/);
    expect(markup).toMatch(/Human handoff|required|人工/);
    expect(markup).toMatch(/Auto recovery|自动恢复/);
    expect(markup).toContain("Operator escalated the retry failure");
    expect(markup).toContain("Operator escalated the retry failure");
    expect(markup).toContain("The deep route keeps the audit trail intact.");
  });

  it("shows switchable route-selection guidance without collapsing it into a generic lock message", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Pick the safest release route",
          },
          route: {
            label: "Route choice pending",
            selectionLocked: true,
            selection: {
              status: "alternatives-available",
              mode: "planner_default",
              locked: true,
              canSwitch: true,
              switchRequiresConfirmation: true,
              changedBy: "user",
              changedReason: "Choose the route before continuing.",
            },
            candidateRoutes: [
              {
                id: "route-choice:deep",
                label: "Deep route",
                summary: "Favor verification and auditability.",
                mode: "deep",
                status: "running",
                selected: true,
                recommended: true,
                locked: true,
                estimatedDuration: "35m",
                estimatedCost: "$7",
                riskLevel: "low",
                takeoverLoad: "low",
              },
            ],
          },
        })}
      />
    );

    expect(markup).toContain("Choose the route before continuing.");
    expect(markup).toContain("Switch requires confirmation");
    expect(markup).toContain("Alternatives Available");
  });

  it.skip("renders user-driven route replan semantics without relabeling them as runtime recovery", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Switch to the safer route before external publish",
          },
          route: {
            label: "User replan lane",
            selectedRouteId: "route-user:safe",
            recommendedRouteId: "route-user:fast",
            selection: {
              status: "replanned",
              mode: "user_selected",
              changedBy: "user",
              changedReason: "Choose the safer route before external publish.",
            },
            candidateRoutes: [
              {
                id: "route-user:safe",
                label: "Safe route",
                summary: "Verify the publish path before dispatch.",
                mode: "standard",
                status: "running",
                selected: true,
                recommended: false,
                locked: false,
                estimatedDuration: "22m",
                estimatedCost: "$6",
                riskLevel: "low",
                takeoverLoad: "high",
              },
            ],
            evidence: {
              lastEventType: "route.replanned",
              events: [
                {
                  eventType: "route.replanned",
                  actor: "user",
                  fromRouteId: "route-user:fast",
                  toRouteId: "route-user:safe",
                  reason: "Choose the safer route before external publish.",
                  at: "2026-04-26T12:00:00.000Z",
                },
              ],
            },
            replan: {
              active: true,
              reason: "Choose the safer route before external publish.",
              fromRouteId: "route-user:fast",
              toRouteId: "route-user:safe",
              triggeredBy: "user",
            },
          },
        })}
      />
    );

    expect(markup).toMatch(/Replanned|已重规划/);
    expect(markup).toMatch(/Selection Mode: User Selected|选择模式: 人工指定/);
    expect(markup).toMatch(/Changed By: User/);
    expect(markup).toMatch(/Triggered By: User|触发方: 用户/);
    expect(markup).toContain("Choose the safer route before external publish.");
  });

  it("renders user-driven route replan semantics with the current localized labels", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Switch to the safer route before external publish",
          },
          route: {
            label: "User replan lane",
            selectedRouteId: "route-user:safe",
            recommendedRouteId: "route-user:fast",
            selection: {
              status: "replanned",
              mode: "user_selected",
              changedBy: "user",
              changedReason: "Choose the safer route before external publish.",
            },
            candidateRoutes: [
              {
                id: "route-user:safe",
                label: "Safe route",
                summary: "Verify the publish path before dispatch.",
                mode: "standard",
                status: "running",
                selected: true,
                recommended: false,
                locked: false,
                estimatedDuration: "22m",
                estimatedCost: "$6",
                riskLevel: "low",
                takeoverLoad: "high",
              },
            ],
            evidence: {
              lastEventType: "route.replanned",
              events: [
                {
                  eventType: "route.replanned",
                  actor: "user",
                  fromRouteId: "route-user:fast",
                  toRouteId: "route-user:safe",
                  reason: "Choose the safer route before external publish.",
                  at: "2026-04-26T12:00:00.000Z",
                },
              ],
            },
            replan: {
              active: true,
              reason: "Choose the safer route before external publish.",
              fromRouteId: "route-user:fast",
              toRouteId: "route-user:safe",
              triggeredBy: "user",
            },
          },
        })}
      />
    );

    expect(markup).toContain("Choose the safer route before external publish.");
    expect(markup).toContain("User");
    expect(markup).toMatch(/User|人工/);
    expect(markup).toContain("Changed By: User");
    expect(markup).toMatch(/Triggered By|触发/);
    expect(markup).toMatch(/Replan|重规划/);
  });

  it("adds risk counts, takeover counts, remaining steps, and eta cost summaries to the route block", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Coordinate a safer route summary",
          },
          route: {
            label: "Planner summary lane",
            status: "running",
            progress: 58,
            currentStageLabel: "Compare route candidates",
            selectedRouteId: "route-summary:standard",
            recommendedRouteId: "route-summary:deep",
            takeoverPointIds: ["takeover-a", "takeover-b", "takeover-c"],
            riskPoints: [
              "External publish still needs owner approval.",
              "Audit packet is incomplete.",
            ],
            candidateRoutes: [
              {
                id: "route-summary:standard",
                label: "Standard route",
                summary: "Keep the route moving with one approval gate.",
                mode: "standard",
                status: "running",
                selected: true,
                recommended: false,
                estimatedDuration: "18m",
                estimatedCost: "$5",
                riskLevel: "medium",
                takeoverLoad: "medium",
              },
              {
                id: "route-summary:deep",
                label: "Deep route",
                summary: "Slow down and verify each external effect.",
                mode: "deep",
                status: "pending",
                selected: false,
                recommended: true,
                estimatedDuration: "42m",
                estimatedCost: "$11",
                riskLevel: "low",
                takeoverLoad: "low",
              },
            ],
          },
          explanation: {
            current: "Planner is comparing the safest publish path.",
            remainingSteps: {
              currentStepKey: "compare",
              currentStepLabel: "Compare route candidates",
              pendingSteps: [
                {
                  key: "choose",
                  label: "Choose the publish route",
                  status: "pending",
                  isCurrent: false,
                },
                {
                  key: "approve",
                  label: "Collect approval",
                  status: "pending",
                  isCurrent: false,
                },
              ],
              parallelBranchCount: 2,
            },
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-route"');
    expect(markup).toContain("Planner summary lane");
    expect(markup).toContain("18m");
    expect(markup).toContain("$5");
    expect(markup).toContain("External publish still needs owner approval.");
    expect(markup).toContain("takeover");
    expect(markup).toContain("2 steps left");
    expect(markup).toContain("Choose the publish route; Collect approval");
    expect(markup).toMatch(/parallel|并行/);
  });

  it("shows evidence trust when the latest event type is unavailable", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Check evidence trust visibility",
          },
          evidence: {
            eventCount: 0,
            artifactCount: 0,
            trustLevel: "unverified",
            gaps: ["No runtime events captured yet."],
            timeline: [],
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-evidence"');
    expect(markup).toContain("No runtime events captured yet.");
  });

  it("renders destination confidence and missing-info impact without changing the destination layout", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Ship the governed release brief",
            request: "Prepare the release brief and handoff notes.",
            taskType: "analysis",
            auxiliaryTaskTypes: ["generation"],
            confidence: {
              level: "medium",
              reason:
                "Waiting for the release owner confirmation before the route can unlock.",
              signals: [
                "owner-confirmation:pending",
                "external-write:human-gated",
              ],
            },
            constraints: ["Do not move the publish window."],
            deliverables: ["release-brief.md"],
            missingInfo: [
              "Confirm the release owner.",
              "Clarify whether external write is allowed.",
            ],
            impact:
              "Route selection will stay blocked until the release owner confirms the handoff.",
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-destination"');
    expect(markup).toContain("Ship the governed release brief");
    expect(markup).toContain("Analysis");
    expect(markup).toContain("Generation");
    expect(markup).toMatch(/Task Type|任务类型/);
    expect(markup).toContain("Waiting for the release owner confirmation before the route can unlock.");
    expect(markup).toContain("owner-confirmation:pending; external-write:human-gated");
    expect(markup).toContain("Confirm the release owner.");
    expect(markup).toContain("Route selection will stay blocked until the release owner confirms the handoff.");
    expect(markup).toMatch(/Needs Info|Info/);
  });

  it("renders structured destination missing-info details when flat impact fields are absent", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Lock the governed destination",
            request: "Confirm the final workspace before continuing.",
            confidence: {
              level: "medium",
            },
            missingInfo: [],
            suggestedClarifications: [
              "Which workspace should the route continue in?",
            ],
            missingInfoDetails: [
              {
                item: "Confirm the target workspace.",
                impact:
                  "Execution remains blocked until the workspace is confirmed.",
                blocking: true,
                clarification: "Which workspace should the route continue in?",
              },
            ],
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-destination"');
    expect(markup).toContain("Lock the governed destination");
    expect(markup).toContain("Confirm the target workspace.");
    expect(markup).toContain(
      "Execution remains blocked until the workspace is confirmed."
    );
    expect(markup).toMatch(/Blocking|blocked/i);
    expect(markup).toMatch(/Needs Info|Info/);
  });

  it("renders remaining parser destination fields as a readable cockpit loop", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Close parser coverage for the cockpit destination",
            subGoals: [
              "Map parser aliases into the destination card.",
              "Keep clarifications visible for human follow-up.",
            ],
            limitations: ["Do not name a model."],
            acceptanceCriteria: [
              "Sub-goals are visible.",
              "Constraints and success criteria share the destination detail.",
            ],
            missingInfoDetails: [
              {
                item: "Confirm the owner for parser sign-off.",
                impact: "The lane cannot be checked off until ownership is clear.",
                blocking: true,
                question: "Who owns the parser sign-off?",
              },
            ],
            missingInfoClarifications: [
              "Should acceptance criteria be shown before deliverables?",
            ],
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-destination"');
    expect(markup).toContain("Close parser coverage for the cockpit destination");
    expect(markup).toContain("Map parser aliases into the destination card.");
    expect(markup).toContain("Keep clarifications visible for human follow-up.");
    expect(markup).toContain("Do not name a model.");
    expect(markup).toContain("Sub-goals are visible.");
    expect(markup).toContain("Constraints and success criteria share the destination detail.");
    expect(markup).toContain("Should acceptance criteria be shown before deliverables?");
    expect(markup).toContain("Who owns the parser sign-off?");
    expect(markup).toContain("Confirm the owner for parser sign-off.");
    expect(markup).toContain(
      "The lane cannot be checked off until ownership is clear."
    );
    expect(markup).toMatch(/Needs Info|Info/);
  });

  it("keeps launch preview and task detail destination fallback fields aligned", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Finalize partner launch readiness",
            parser: {
              constraints: [
                { value: "Keep launch reversible", dimension: "governance" },
              ],
              successCriteria: [
                {
                  description: "Partner owner can approve without follow-up",
                },
              ],
              deliverables: [{ title: "partner-readiness-report.md" }],
            },
          },
          normalizedGoal: {
            expectedDeliverables: ["launch-risk-register.json"],
          },
          mappedMissionContext: {
            reviewInput: {
              constraints: ["Use approved evidence only"],
              successCriteria: ["Launch risks have named owners"],
            },
          },
          mappedWorkflowInput: {
            plannerInput: {
              constraints: ["No production changes"],
              successCriteria: ["Route can continue after approval"],
            },
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-destination"');
    expect(markup).toContain("Finalize partner launch readiness");
    expect(markup).toContain("Keep launch reversible");
    expect(markup).toContain("Use approved evidence only");
    expect(markup).toContain("No production changes");
    expect(markup).toContain("Partner owner can approve without follow-up");
    expect(markup).toContain("Launch risks have named owners");
    expect(markup).toContain("Route can continue after approval");
    expect(markup).toContain("partner-readiness-report.md");
    expect(markup).toContain("launch-risk-register.json");
  });

  it("renders projected destination lock state in the cockpit destination detail", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Keep locked destination visible",
            lock_state: "confirmed",
            locked_at: "2026-04-27T09:00:00.000Z",
            modified_at: "2026-04-27T10:00:00.000Z",
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-destination"');
    expect(markup).toContain("Keep locked destination visible");
    expect(markup).toContain("Lock State: Goal Locked");
    expect(markup).toContain("Confirmed:");
    expect(markup).toContain("Modified:");
    expect(markup).toContain("2026");
  });

  it("renders structured explanation details from currentState and recommendationDetails", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Explain the governed next step",
          },
          explanation: {
            currentState: {
              summary: "Runtime is holding on the approval gate.",
              driveState: "takeover-required",
              missionStatus: "waiting",
              workflowStatus: "running",
              workflowStage: "approval_gate",
              currentStageLabel: "Approve external write",
              routeSelectionStatus: "locked",
              selectedRouteId: "route-safe:standard",
              correlationTimelineId: "mission-1:current-state-timeline",
              sources: ["mission-runtime", "route-planner"],
              updatedAt: "2026-04-24T09:35:00.000Z",
            },
            recommendationDetails: [
              {
                kind: "route",
                summary: "Prefer the safer route until approval arrives.",
                source: "route-planner",
                routeId: "route-safe:deep",
                actionType: "replan",
                takeoverType: "approval",
                decisionId: "decision-approve-write",
                routeSelectionStatus: "alternatives-available",
                correlationTimelineId: "mission-1:timeline",
              },
            ],
            remainingSteps: {
              currentStepLabel: "Approve external write",
              pendingSteps: [
                {
                  key: "approve",
                  label: "Approve external write",
                  status: "pending",
                  isCurrent: false,
                },
                {
                  key: "resume",
                  label: "Resume the governed route",
                  status: "pending",
                  isCurrent: false,
                },
              ],
              parallelBranchCount: 2,
              replanChangeSummary: "Keep the verification branch open until sign-off lands.",
            },
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-explanation"');
    expect(markup).toContain("Runtime is holding on the approval gate.");
    expect(markup).toMatch(/Takeover|接管/);
    expect(markup).toContain("Waiting");
    expect(markup).toContain("Running");
    expect(markup).toContain("Approval Gate");
    expect(markup).toContain("Approve external write");
    expect(markup).toContain("route-safe:standard");
    expect(markup).toContain("mission-1:current-state-timeline");
    expect(markup).toContain("Mission Runtime; Route Planner");
    expect(markup).toContain("Prefer the safer route until approval arrives.");
    expect(markup).toContain("route-safe:deep");
    expect(markup).toContain("decision-approve-write");
    expect(markup).toContain("Alternatives");
    expect(markup).toContain("mission-1:timeline");
    expect(markup).toContain("Approve external write; Resume the governed route");
    expect(markup).toContain("2");
    expect(markup).toContain(
      "Keep the verification branch open until sign-off lands."
    );
  });

  it("renders evidence correlation identifiers and indexed counts when present", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Show evidence correlation coverage",
          },
          evidence: {
            eventCount: 5,
            artifactCount: 2,
            trustLevel: "verified",
            correlation: {
              workflowId: "workflow-1",
              replayId: "replay-42",
              sessionId: "session-7",
              timelineId: "timeline-55",
              selectedRouteId: "route-b",
              recommendedRouteId: "route-a",
              currentStepKey: "execute",
              routeIds: ["route-a", "route-b"],
              routeStageKeys: ["plan", "execute", "review"],
              runtimeEventIds: ["event-1", "event-2"],
              decisionIds: ["decision-1"],
              operatorActionIds: ["operator-1"],
              auditEventIds: ["audit-1", "audit-2"],
              lineageIds: ["lineage-1"],
            },
          },
        })}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-evidence"');
    expect(markup).toContain("Workflow: workflow-1");
    expect(markup).toContain("Replay: replay-42");
    expect(markup).toContain("Session: session-7");
    expect(markup).toContain("Timeline: timeline-55");
    expect(markup).toContain("Selected Route: route-b");
    expect(markup).toContain("Recommended Route: route-a");
    expect(markup).toContain("Current Step: Execute");
    expect(markup).toContain("Decision IDs: decision-1");
    expect(markup).toContain("Operator IDs: operator-1");
    expect(markup).toContain("Audit IDs: audit-1; audit-2");
    expect(markup).toContain("Lineage IDs: lineage-1");
    expect(markup).toContain("Routes: 2");
    expect(markup).toContain("Stages: 3");
    expect(markup).toContain("Runtime Events: 2");
    expect(markup).toContain("Decisions: 1");
    expect(markup).toContain("Operator Actions: 1");
    expect(markup).toContain("Audit Events: 2");
    expect(markup).toContain("Lineage: 1");
  });

  it("surfaces waiting DecisionPanel ownership in the right rail without adding a second submission surface", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(
          {
            status: "waiting",
            decisionPrompt: "Approve the guarded external publish?",
            decisionPresets: [
              {
                id: "approve",
                label: "Approve guarded publish",
                description: "Continue after human approval.",
                prompt: "Approve the guarded external publish?",
                tone: "primary",
                action: "mission",
                optionId: "approve",
              },
            ],
            decision: {
              decisionId: "decision-publish-gate",
              prompt: "Approve the guarded external publish?",
              type: "approve",
              options: [
                {
                  id: "approve",
                  label: "Approve guarded publish",
                },
              ],
            },
          },
          {
            destination: {
              goal: "Finish the guarded publish after approval",
            },
            takeover: {
              decisionId: "decision-publish-gate",
              type: "approval",
              urgency: "high",
              reason: "External publish needs a human checkpoint.",
            },
          }
        )}
      />
    );

    expect(markup).toContain(
      'data-testid="task-autopilot-cockpit-decision-takeover"'
    );
    expect(markup).toContain('data-testid="task-autopilot-decision-handoff"');
    expect(markup).toContain(
      'data-testid="autopilot-takeover-control-panel"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-takeover-item-decision-publish-gate"'
    );
    expect(markup).toContain("DecisionPanel owns waiting task");
    expect(markup).toContain("Approve the guarded external publish?");
    expect(markup).toContain("Decision: decision-publish-gate");
    expect(markup).toContain("Type: Approval");
    expect(markup).toContain("Options: Approve guarded publish");
    expect(markup).toContain("single submission surface");
    expect(markup).toContain("Submit the decision in DecisionPanel");
    expect(markup).not.toContain('data-testid="task-autopilot-takeover"');
    expect(markup).not.toContain("External publish needs a human checkpoint.");
  });

  it("renders minimal post-takeover projection markers across route, drive state, and evidence", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(
          {
            status: "waiting",
            decisionPrompt: "Approve the guarded route update?",
            decisionPresets: [
              {
                id: "approve",
                label: "Approve guarded route update",
                description: "Resume on the approved route.",
                prompt: "Approve the guarded route update?",
                tone: "primary",
                action: "mission",
                optionId: "approve",
              },
            ],
            decision: {
              decisionId: "decision-route-update",
              prompt: "Approve the guarded route update?",
              type: "approve",
              options: [
                {
                  id: "approve",
                  label: "Approve guarded route update",
                },
              ],
            },
          },
          {
            destination: {
              goal: "Resume the governed route after takeover",
            },
            route: {
              label: "Guarded review route",
              status: "running",
            },
            driveState: {
              state: "takeover-required",
              detail: "Waiting for the route owner.",
              waitingForUser: true,
            },
            evidence: {
              eventCount: 3,
              artifactCount: 1,
            },
            takeover: {
              decisionId: "decision-route-update",
              type: "route-selection",
              prompt: "Approve the guarded route update?",
              projection: {
                marker: "submitted",
                evidenceEventId: "evt-takeover-submit-9",
                route: {
                  selectedRouteId: "route-approved:standard",
                  status: "running",
                },
                driveState: {
                  state: "executing",
                  reason: "Decision submitted; route can resume.",
                },
              },
            },
          }
        )}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-route"');
    expect(markup).toContain('data-testid="task-autopilot-drive-state"');
    expect(markup).toContain('data-testid="task-autopilot-evidence"');
    expect(markup).toContain("Takeover projection");
    expect(markup).toContain("route-approved:standard");
    expect(markup).toContain("Executing");
    expect(markup).toContain("Decision submitted; route can resume.");
    expect(markup).toContain("evt-takeover-submit-9");
    expect(markup).toContain("Route: route-approved:standard");
    expect(markup).toContain("Drive: Executing");
    expect(markup).not.toContain('data-testid="task-autopilot-takeover"');
  });

  it("renders a Cost / Risk summary slot in the right rail from route and evidence signals", () => {
    const markup = renderToStaticMarkup(
      <TaskAutopilotPanel
        detail={makeDetail(undefined, {
          destination: {
            goal: "Compare cost and risk before route confirmation",
          },
          route: {
            selectedRoute: {
              label: "Stable route",
              estimatedCost: "$6",
              estimatedDuration: "30m",
              riskLevel: "medium",
              takeoverLoad: "low",
            },
            candidateRoutes: [
              {
                id: "route-fast",
                label: "Fast route",
                estimatedCost: "$3",
                estimatedDuration: "12m",
              },
              {
                id: "route-deep",
                label: "Deep route",
                estimatedCost: "$9",
                estimatedDuration: "45m",
              },
            ],
            riskPoints: ["External dependency may drift."],
          },
          evidence: {
            gaps: ["Missing final owner acknowledgement."],
          },
          explanation: {
            riskSummary: ["Audit coverage is still partial."],
          },
        })}
      />
    );

    expect(markup).toContain(
      'data-testid="task-autopilot-cockpit-evidence-cost-risk"'
    );
    expect(markup).toContain('data-testid="task-autopilot-cost-risk"');
    expect(markup).toContain("Risk:");
    expect(markup).toContain("Takeover Load:");
    expect(markup).not.toContain("data-testid=\"task-autopilot-cost-risk-missing\"");
    expect(markup).toContain("Selected Cost: $6");
    expect(markup).toContain("Selected ETA: 30m");
    expect(markup).toContain("Cost Range: $3; $9");
    expect(markup).toContain("ETA Range: 12m; 45m");
    expect(markup).toContain(
      "Risk Signals: External dependency may drift.; Audit coverage is still partial.; Missing final owner acknowledgement."
    );
  });

  it("is wired into TaskDetailView without changing the surrounding layout", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        detail={makeDetail(undefined, {
          destination: {
            goal: "Publish the aligned task cockpit",
          },
          route: {
            label: "Minimal UI route",
            summary:
              "Add one readable panel and keep the page structure intact.",
          },
          driveState: {
            key: "executing",
          },
        })}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-panel"');
    expect(markup).toContain("Publish the aligned task cockpit");
    expect(markup).toContain("Minimal UI route");
    expect(markup).toMatch(/Executing|\u6267\u884c\u4e2d/);
    expect(markup).toMatch(/RAG Context|RAG \u4e0a\u4e0b\u6587/);
  });

  it("renders the autopilot cockpit panel inside TaskDetailView cockpit mode", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        detail={makeDetail(undefined, {
          destination: {
            goal: "Keep cockpit mode aligned with the governed route",
          },
          route: {
            label: "Cockpit review route",
            summary: "Surface the active route context in the cockpit layout.",
          },
          driveState: {
            key: "reviewing",
          },
        })}
        variant="cockpit"
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
      />
    );

    expect(markup).toContain('data-testid="task-autopilot-panel"');
    expect(markup).toContain(
      'data-testid="task-detail-cockpit-autopilot-three-column"'
    );
    expect(markup).toContain('data-testid="autopilot-cockpit-layout"');
    expect(markup).toContain("Keep cockpit mode aligned with the governed route");
    expect(markup).toContain("Cockpit review route");
    expect(markup).toMatch(/Reviewing|\u590d\u6838\u4e2d/);
  });

  it("keeps narrow task detail status chips wrapped inside the cockpit cards", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        detail={makeDetail({
          tasks: [
            {
              id: 9842,
              description:
                "Verify long department and review status chips wrap instead of overflowing on narrow cockpit screens.",
              department:
                "Mobile Responsive Cockpit Operations With Extra Long Label",
              status: "submitted",
              version: 12,
              assigned_to: null,
              total_score: 97,
              deliverable: "Responsive polish notes",
              deliverable_v2: null,
              deliverable_v3: null,
              manager_feedback: "Manager review completed.",
              meta_audit_feedback: null,
            },
          ],
        })}
        variant="cockpit"
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
      />
    );

    expect(markup).toContain(
      'data-testid="task-detail-work-package-status-chips"'
    );
    expect(markup).toContain(
      'data-overflow-guard="work-package-status-chip-wrap"'
    );
    expect(markup).toContain(
      'data-overflow-guard="work-package-metric-chip-wrap"'
    );
    expect(markup).toContain("Mobile Responsive Cockpit Operations");
    expect(markup).toContain("max-w-full");
    expect(markup).toContain("whitespace-normal");
    expect(markup).toContain("break-words");
  });

  it("stays hidden when detail.autopilotSummary is missing", () => {
    const markup = renderToStaticMarkup(
      <TaskDetailView
        detail={makeDetail()}
        decisionNote=""
        onDecisionNoteChange={() => {}}
        onLaunchDecision={() => {}}
      />
    );

    expect(markup).not.toContain("Autopilot Summary");
  });
});
