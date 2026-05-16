/**
 * `autopilot-role-autonomous-agent` spec Task 1.4：Agent 作业输入输出。
 */

import type { AgentBudget } from "./agent-budget.js";
import type { AgentToolDefinition } from "./agent-tool.js";
import type { AgentTraceEntry } from "./agent-state.js";

export interface AgentJobInput {
  jobId: string;
  roleId: string;
  stageId: string;
  goal: string;
  systemPrompt: string;
  tools: AgentToolDefinition[];
  budget: AgentBudget;
  context: Record<string, unknown>;
  callbackUrl: string;
  callbackSecret: string;
}

export interface AgentJobOutput {
  jobId: string;
  roleId: string;
  status: "completed" | "failed" | "aborted";
  output: unknown;
  iterations: number;
  totalTokens: number;
  durationMs: number;
  trace: AgentTraceEntry[];
  error?: string;
}
