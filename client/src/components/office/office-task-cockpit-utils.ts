import type { MissionTaskDetail } from "@/lib/tasks-store";
import type { AgentInfo, WorkflowInfo } from "@/lib/workflow-store";

import type { OfficeCockpitTab } from "./office-task-cockpit-types";

export interface OfficeCockpitAvailability {
  launch: boolean;
  task: boolean;
  flow: boolean;
  agent: boolean;
  memory: boolean;
  history: boolean;
}

export function buildOfficeCockpitAvailability(input: {
  detail: MissionTaskDetail | null;
  workflow: WorkflowInfo | null;
  agents: AgentInfo[];
  workflows: WorkflowInfo[];
}): OfficeCockpitAvailability {
  const { detail, workflow, agents, workflows } = input;

  return {
    launch: true,
    task: true,
    flow: workflow !== null,
    agent: agents.length > 0,
    memory: agents.length > 0,
    history: workflows.length > 0,
  };
}

export function resolveOfficeCockpitTab(
  currentTab: OfficeCockpitTab,
  availability: OfficeCockpitAvailability
): OfficeCockpitTab {
  if (availability[currentTab]) {
    return currentTab;
  }

  if (availability.task) {
    return "task";
  }

  if (availability.launch) {
    return "launch";
  }

  if (availability.flow) {
    return "flow";
  }

  if (availability.agent) {
    return "agent";
  }

  if (availability.memory) {
    return "memory";
  }

  if (availability.history) {
    return "history";
  }

  return "task";
}

export function resolveWorkflowForSelectedTask(input: {
  taskId: string | null;
  workflows: WorkflowInfo[];
  currentWorkflow: WorkflowInfo | null;
}): WorkflowInfo | null {
  const { taskId, workflows, currentWorkflow } = input;

  if (!taskId) {
    return currentWorkflow;
  }

  if (currentWorkflow?.missionId === taskId) {
    return currentWorkflow;
  }

  return workflows.find(workflow => workflow.missionId === taskId) ?? null;
}
