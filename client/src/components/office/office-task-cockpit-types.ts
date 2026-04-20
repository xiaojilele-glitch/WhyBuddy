export type OfficeCockpitTab =
  | "launch"
  | "task"
  | "flow"
  | "agent"
  | "memory"
  | "history";

export type OfficeLaunchMode = "mission" | "workflow";

export interface OfficeLaunchResolution {
  workflowId: string;
  directive: string;
  attachmentCount: number;
  requestedAt: number;
  missionId?: string | null;
}
