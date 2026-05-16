/**
 * `autopilot-role-autonomous-agent` spec Task 1.3：Agent Loop 状态机类型。
 */

export type AgentLoopPhase =
  | "idle"
  | "thinking"
  | "acting"
  | "observing"
  | "completed"
  | "failed";

export interface AgentLoopState {
  phase: AgentLoopPhase;
  iteration: number;
  tokensUsed: number;
  startedAt: string;
  lastTransitionAt: string;
  currentAction?: import("./agent-tool.js").AgentToolInvocation;
  history: AgentTraceEntry[];
  error?: string;
}

export interface AgentTraceEntry {
  iteration: number;
  phase: AgentLoopPhase;
  timestamp: string;
  thought?: string;
  action?: { toolId: string; params: Record<string, unknown> };
  observation?: { toolId: string; result: unknown; durationMs: number };
  tokensUsed: number;
  error?: string;
}
