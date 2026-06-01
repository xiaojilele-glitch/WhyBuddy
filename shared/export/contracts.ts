/**
 * 跨框架导出格式契约
 *
 * cross-framework-export 模块将 WhyBuddy 的动态组织结构和
 * 十阶段工作流配置导出为 CrewAI、LangGraph、AutoGen 兼容格式。
 * 导出产物为 ZIP 包（Python 代码 + YAML/JSON 配置），用户解压后可直接运行。
 */

// ---------------------------------------------------------------------------
// 导出目标框架
// ---------------------------------------------------------------------------

export const EXPORT_FRAMEWORKS = ["crewai", "langgraph", "autogen"] as const;
export type ExportFramework = (typeof EXPORT_FRAMEWORKS)[number];

// ---------------------------------------------------------------------------
// 导出请求
// ---------------------------------------------------------------------------

export interface ExportRequest {
  /** 目标框架 */
  framework: ExportFramework;
  /** 工作流 ID（从中提取组织和配置） */
  workflowId?: string;
  /** 或直接传入组织快照 */
  organizationSnapshot?: import("../organization-schema.js").WorkflowOrganizationSnapshot;
  /** 导出选项 */
  options?: ExportOptions;
}

export interface ExportOptions {
  /** 是否包含 SOUL.md 人设内容 */
  includeSoulPrompts?: boolean;
  /** 是否包含 skills prompt */
  includeSkillPrompts?: boolean;
  /** 是否包含示例任务 */
  includeExampleTasks?: boolean;
  /** 目标 Python 版本 */
  pythonVersion?: "3.10" | "3.11" | "3.12";
  /** 目标模型（导出代码中的默认模型） */
  defaultModel?: string;
}

// ---------------------------------------------------------------------------
// 导出结果
// ---------------------------------------------------------------------------

export interface ExportResult {
  framework: ExportFramework;
  /** 文件列表（路径 → 内容） */
  files: ExportFile[];
  /** 入口文件路径 */
  entryPoint: string;
  /** 安装命令 */
  installCommand: string;
  /** 运行命令 */
  runCommand: string;
  /** README 内容 */
  readme: string;
}

export interface ExportFile {
  path: string;
  content: string;
  language: "python" | "yaml" | "json" | "markdown" | "toml";
}

// ---------------------------------------------------------------------------
// CrewAI 导出格式
// ---------------------------------------------------------------------------

export interface CrewAIAgentConfig {
  role: string;
  goal: string;
  backstory: string;
  verbose?: boolean;
  allow_delegation?: boolean;
  tools?: string[];
}

export interface CrewAITaskConfig {
  description: string;
  expected_output: string;
  agent: string;
}

export interface CrewAICrewConfig {
  agents: Record<string, CrewAIAgentConfig>;
  tasks: Record<string, CrewAITaskConfig>;
  process: "sequential" | "hierarchical";
  manager_llm?: string;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// LangGraph 导出格式
// ---------------------------------------------------------------------------

export interface LangGraphNodeConfig {
  name: string;
  type: "agent" | "tool" | "router";
  system_prompt?: string;
  tools?: string[];
}

export interface LangGraphEdgeConfig {
  from: string;
  to: string;
  condition?: string;
}

export interface LangGraphConfig {
  nodes: Record<string, LangGraphNodeConfig>;
  edges: LangGraphEdgeConfig[];
  entry_point: string;
  finish_point: string;
}

// ---------------------------------------------------------------------------
// AutoGen 导出格式
// ---------------------------------------------------------------------------

export interface AutoGenAgentConfig {
  name: string;
  system_message: string;
  llm_config: {
    model: string;
    temperature?: number;
  };
  human_input_mode?: "NEVER" | "ALWAYS" | "TERMINATE";
}

export interface AutoGenGroupChatConfig {
  agents: string[];
  max_round: number;
  speaker_selection_method?: "auto" | "round_robin" | "random";
  admin_name?: string;
}

export interface AutoGenConfig {
  agents: Record<string, AutoGenAgentConfig>;
  group_chat: AutoGenGroupChatConfig;
}
