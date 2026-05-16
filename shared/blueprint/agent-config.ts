/**
 * `autopilot-role-autonomous-agent` spec Task 1.6：角色 Agent 配置。
 */

import type { AgentBudget } from "./agent-budget.js";

export interface RoleAgentConfig {
  systemPromptId: string;
  defaultBudget: Partial<AgentBudget>;
  allowedToolCategories: Array<"mcp" | "skill" | "aigc_node" | "builtin">;
  outputSchemaId: string;
  reactEnabled: boolean;
  temperature?: number;
  maxParallelTools?: number;
}
