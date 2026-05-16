/**
 * `autopilot-role-autonomous-agent` spec Task 1.1：统一工具接口定义。
 *
 * 将 MCP / Skill / AIGC 节点统一为 Agent 可调用的 Tool 接口，
 * 由 Agent Loop 的 thinking 阶段通过 function-calling schema 暴露给 LLM。
 */

export interface AgentToolDefinition {
  id: string;
  name: string;
  description: string;
  category: "mcp" | "skill" | "aigc_node" | "builtin";
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  requiresProxy: boolean;
  timeoutMs: number;
}

export interface AgentToolInvocation {
  toolId: string;
  params: Record<string, unknown>;
  requestId: string;
}

export interface AgentToolResult {
  requestId: string;
  toolId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}
