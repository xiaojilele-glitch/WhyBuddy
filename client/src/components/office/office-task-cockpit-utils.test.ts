import { describe, expect, it } from "vitest";

import type { MissionTaskDetail } from "@/lib/tasks-store";
import type { AgentInfo, WorkflowInfo } from "@/lib/workflow-store";

import {
  buildOfficeCockpitAvailability,
  resolveOfficeCockpitTab,
  resolveWorkflowForSelectedTask,
} from "./office-task-cockpit-utils";

const DETAIL = {
  id: "mission-1",
  title: "Ship office cockpit",
} as MissionTaskDetail;

const AGENTS: AgentInfo[] = [
  {
    id: "agent-1",
    name: "Pixel",
    department: "Execution",
    role: "manager",
    managerId: null,
    model: "gpt-5.4",
    isActive: true,
    status: "planning",
  },
];

const WORKFLOW: WorkflowInfo = {
  id: "wf-1",
  missionId: "mission-1",
  directive: "Ship office cockpit",
  status: "running",
  current_stage: "execution",
  departments_involved: ["execution"],
  started_at: "2026-04-13T08:00:00.000Z",
  completed_at: null,
  results: {},
  created_at: "2026-04-13T08:00:00.000Z",
};

describe("office-task-cockpit-utils", () => {
  it("builds availability from current task, workflow, and agent data", () => {
    expect(
      buildOfficeCockpitAvailability({
        detail: DETAIL,
        workflow: WORKFLOW,
        agents: AGENTS,
        workflows: [WORKFLOW],
      })
    ).toEqual({
      launch: true,
      task: true,
      flow: true,
      agent: true,
      memory: true,
      history: true,
    });
  });

  it("falls back to task tab when the current tab has no usable context", () => {
    expect(
      resolveOfficeCockpitTab("flow", {
        launch: true,
        task: true,
        flow: false,
        agent: true,
        memory: true,
        history: true,
      })
    ).toBe("task");
  });

  it("keeps the launch tab available as a stable entry even without workflow or agent context", () => {
    expect(
      resolveOfficeCockpitTab("launch", {
        launch: true,
        task: true,
        flow: false,
        agent: false,
        memory: false,
        history: false,
      })
    ).toBe("launch");
  });

  it("keeps the current workflow when it already matches the selected mission", () => {
    expect(
      resolveWorkflowForSelectedTask({
        taskId: "mission-1",
        workflows: [WORKFLOW],
        currentWorkflow: WORKFLOW,
      })
    ).toBe(WORKFLOW);
  });

  it("finds a matching workflow summary for the selected mission", () => {
    expect(
      resolveWorkflowForSelectedTask({
        taskId: "mission-1",
        workflows: [WORKFLOW],
        currentWorkflow: null,
      })
    ).toBe(WORKFLOW);
  });
});
