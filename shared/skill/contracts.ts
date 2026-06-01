/**
 * Skill 注册制契约
 *
 * 从 rbac-system-pc/backend/src/ai/orchestration/ 的节点注册制迁移并改造。
 * 原版是 AIGC 编排节点的 NodeTypeRegistry + FlowExecutor，
 * 此版改造为 whybuddy 的 Skill 热插拔体系。
 *
 * 核心思路：每个 Skill 只声明独有配置（prompt/tools/适用角色），
 * 执行框架由 WorkflowEngine 统一提供，避免每个 Skill 重复实现执行逻辑。
 *
 * 使用场景：
 * - plugin-skill-system: Skill 注册、版本管理、动态启用/禁用
 * - dynamic-organization: 组织生成时按角色匹配 Skill
 * - agent-autonomy-upgrade: Agent 自主选择 Skill
 */

import type { AgentRole } from "../workflow-runtime.js";

// ---------------------------------------------------------------------------
// Skill 定义
// ---------------------------------------------------------------------------

export interface SkillDefinition {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 版本号（语义化版本） */
  version: string;
  /** 分类标签 */
  category: SkillCategory;
  /** 简要描述 */
  summary: string;
  /** 详细描述 */
  description?: string;
  /** 系统提示词（注入到 Agent 的 LLM 调用中） */
  systemPrompt: string;
  /** 可用工具列表 */
  tools: SkillToolBinding[];
  /** 适用角色 */
  applicableRoles: AgentRole[];
  /** 适用任务类型（与动态组织的 taskProfile 匹配） */
  applicableTaskProfiles?: string[];
  /** 是否默认启用 */
  enabledByDefault: boolean;
  /** 依赖的其他 Skill ID */
  dependencies?: string[];
  /** 作者 */
  author?: string;
}

export const SKILL_CATEGORIES = [
  "analysis",     // 分析类（数据分析、竞品分析）
  "coding",       // 编程类（代码生成、代码审查）
  "writing",      // 写作类（报告撰写、文案生成）
  "research",     // 研究类（信息检索、趋势分析）
  "planning",     // 规划类（项目规划、任务分解）
  "review",       // 评审类（质量检查、合规审计）
  "communication",// 沟通类（消息格式化、多语言翻译）
  "tool",         // 工具类（API 调用、文件处理）
  "custom",       // 自定义
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Skill 工具绑定
// ---------------------------------------------------------------------------

export interface SkillToolBinding {
  /** 工具标识 */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具描述（用于 LLM function calling） */
  description: string;
  /** 参数 JSON Schema */
  parameters?: Record<string, unknown>;
  /** MCP 服务器标识（如果是 MCP 工具） */
  mcpServer?: string;
}

// ---------------------------------------------------------------------------
// Skill 执行上下文
// ---------------------------------------------------------------------------

export interface SkillExecutionContext {
  /** 当前智能体 ID */
  agentId: string;
  /** 当前工作流 ID */
  workflowId?: string;
  /** 当前 Mission ID */
  missionId?: string;
  /** 当前阶段 */
  stage?: string;
  /** 用户指令 */
  directive?: string;
  /** 任务描述 */
  taskDescription?: string;
  /** 已有上下文（记忆、历史消息等） */
  contextMessages?: Array<{ role: string; content: string }>;
}

export interface SkillExecutionResult {
  /** Skill 输出内容 */
  content: string;
  /** 工具调用记录 */
  toolCalls?: Array<{
    toolId: string;
    input: Record<string, unknown>;
    output: string;
    durationMs: number;
  }>;
  /** Token 消耗 */
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Skill 注册表（从 rbac-system-pc NodeTypeRegistry 模式迁移）
// ---------------------------------------------------------------------------

export interface ISkillRegistry {
  /** 注册 Skill 定义 */
  register(skill: SkillDefinition): void;
  /** 按 ID 获取 */
  get(id: string): SkillDefinition | undefined;
  /** 按角色筛选可用 Skill */
  getByRole(role: AgentRole): SkillDefinition[];
  /** 按任务类型筛选可用 Skill */
  getByTaskProfile(taskProfile: string): SkillDefinition[];
  /** 按分类筛选 */
  getByCategory(category: SkillCategory): SkillDefinition[];
  /** 列出所有已注册 Skill */
  list(): SkillDefinition[];
  /** 启用/禁用 Skill */
  setEnabled(id: string, enabled: boolean): void;
  /** 检查 Skill 依赖是否满足 */
  checkDependencies(id: string): { satisfied: boolean; missing: string[] };
  /** 注销 Skill */
  unregister(id: string): void;
}

// ---------------------------------------------------------------------------
// Skill 生命周期事件
// ---------------------------------------------------------------------------

export type SkillLifecycleEvent =
  | { type: "skill:registered"; skillId: string; version: string }
  | { type: "skill:enabled"; skillId: string }
  | { type: "skill:disabled"; skillId: string }
  | { type: "skill:unregistered"; skillId: string }
  | { type: "skill:executed"; skillId: string; agentId: string; durationMs: number; success: boolean };

// ---------------------------------------------------------------------------
// 现有实现的适配说明
// ---------------------------------------------------------------------------

/**
 * 当前 whybuddy 的映射关系：
 *
 * SkillDefinition → WorkflowSkillBinding (现有，在 organization-schema.ts 中)
 *   现有的 WorkflowSkillBinding 是精简版（id/name/summary/prompt），
 *   SkillDefinition 是完整版（增加 version/category/tools/dependencies/enabledByDefault）
 *
 * ISkillRegistry → resolveSkills() (现有，在 dynamic-organization.ts 中)
 *   现有的 resolveSkills() 是硬编码的 ID 查找，
 *   ISkillRegistry 是完整的注册制（支持动态注册/注销/启用/禁用）
 *
 * 迁移路径：
 * 1. plugin-skill-system spec 实现 ISkillRegistry
 * 2. dynamic-organization.ts 的 resolveSkills() 改为调用 ISkillRegistry.get()
 * 3. 现有的 WorkflowSkillBinding 保留为 SkillDefinition 的精简投影
 */
