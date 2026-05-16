/**
 * `autopilot-role-autonomous-agent` spec Task 1.2：Agent 预算控制。
 */

export interface AgentBudget {
  maxIterations: number;
  maxTokens: number;
  timeoutMs: number;
  toolTimeoutMs: number;
  allowParallelTools: boolean;
}
