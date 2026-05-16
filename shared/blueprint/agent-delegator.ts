/**
 * `autopilot-role-autonomous-agent` spec Task 1.7：委派器接口。
 */

import type { AgentBudget } from "./agent-budget.js";
import type { AgentTraceEntry } from "./agent-state.js";

export interface DelegateInput {
  roleId: string;
  stageId: string;
  jobId: string;
  goal: string;
  systemPrompt: string;
  context: Record<string, unknown>;
  budget: AgentBudget;
  outputSchema?: Record<string, unknown>;
}

export interface DelegateOutput {
  jobId: string;
  status: "completed" | "failed" | "aborted";
  output: unknown;
  executionMode: "real" | "lite";
  iterations: number;
  totalTokens: number;
  durationMs: number;
  trace: AgentTraceEntry[];
  error?: string;
}

export type DelegateStatus =
  | { phase: "pending" }
  | { phase: "running"; iteration: number; tokensUsed: number }
  | { phase: "completed"; output: unknown }
  | { phase: "failed"; error: string }
  | { phase: "aborted"; reason: string };
