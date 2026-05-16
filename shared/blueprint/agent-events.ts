/**
 * `autopilot-role-autonomous-agent` spec Task 1.5：Agent 进度回调事件。
 */

import type { AgentLoopPhase } from "./agent-state.js";

export type AgentProgressEventType =
  | "agent.started"
  | "agent.thinking"
  | "agent.acting"
  | "agent.observing"
  | "agent.iteration_completed"
  | "agent.completed"
  | "agent.failed"
  | "agent.aborted";

export interface AgentProgressEvent {
  type: AgentProgressEventType;
  jobId: string;
  roleId: string;
  stageId: string;
  iteration: number;
  timestamp: string;
  phase: AgentLoopPhase;
  thought?: string;
  action?: { toolId: string };
  observation?: { toolId: string; success: boolean };
  output?: unknown;
  error?: string;
  tokensUsed: number;
  budgetRemaining: {
    iterations: number;
    tokens: number;
    timeMs: number;
  };
}
