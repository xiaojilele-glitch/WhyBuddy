/**
 * LLM 多提供商抽象层契约
 *
 * 从 rbac-system-pc/backend/src/ai/llm/ 迁移并改造。
 * 原版基于 class + Sequelize 配置，此版改为纯接口 + 函数式注册，
 * 适配 whybuddy 的 .env 配置和浏览器/服务端双运行时。
 *
 * 使用场景：
 * - plugin-skill-system: Skill 可声明需要特定提供商
 * - multi-modal-agent: Vision/Voice 需要不同提供商
 * - cost-observability: 按提供商统计 Token 消耗
 */

// ---------------------------------------------------------------------------
// 基础消息类型（复用现有 LLMMessage，此处扩展多模态）
// ---------------------------------------------------------------------------

export interface LLMTextContent {
  type: "text";
  text: string;
}

export interface LLMImageContent {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export type LLMContentPart = LLMTextContent | LLMImageContent;

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string | LLMContentPart[];
}

// ---------------------------------------------------------------------------
// 生成选项与结果
// ---------------------------------------------------------------------------

export interface LLMGenerateOptions {
  temperature?: number;
  maxTokens?: number;
  /** 强制使用指定模型（覆盖提供商默认） */
  model?: string;
  /** 是否流式输出 */
  stream?: boolean;
  /** JSON 模式（要求输出合法 JSON） */
  jsonMode?: boolean;
  /** 推理强度（部分提供商支持） */
  reasoningEffort?: "low" | "medium" | "high";
}

export interface LLMTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMGenerateResult {
  content: string;
  usage: LLMTokenUsage;
  latencyMs: number;
  /** 实际使用的模型标识 */
  model: string;
  /** 实际使用的提供商标识 */
  provider: string;
}

export interface LLMEmbedResult {
  vectors: number[][];
  usage: { totalTokens: number };
  model: string;
  provider: string;
}

export interface LLMHealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  provider: string;
}

// ---------------------------------------------------------------------------
// 提供商接口（从 rbac-system-pc ILLMProvider 迁移）
// ---------------------------------------------------------------------------

export interface ILLMProvider {
  /** 提供商标识（如 "openai"、"zhipu"、"qwen"） */
  readonly name: string;

  /** 同步生成 */
  generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMGenerateResult>;

  /** 流式生成 */
  streamGenerate(messages: LLMMessage[], options?: LLMGenerateOptions): AsyncGenerator<string>;

  /** 文本向量化（可选，不是所有提供商都支持） */
  embed?(texts: string[]): Promise<LLMEmbedResult>;

  /** 健康检查 */
  healthCheck(): Promise<LLMHealthCheckResult>;

  /** 是否为临时性错误（rate limit / timeout），用于重试判断 */
  isTemporaryError?(error: unknown): boolean;
}

// ---------------------------------------------------------------------------
// 提供商注册表（从 rbac-system-pc ProviderRegistry 迁移）
// ---------------------------------------------------------------------------

export type LLMProviderFactory = (config: LLMProviderConfig) => ILLMProvider;

export interface LLMProviderConfig {
  /** 提供商类型（如 "openai"、"zhipu"、"qwen"、"browser-direct"） */
  type: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 额外配置（各提供商特有） */
  extra?: Record<string, unknown>;
}

export interface ILLMProviderRegistry {
  /** 注册提供商工厂 */
  register(type: string, factory: LLMProviderFactory): void;
  /** 创建提供商实例 */
  create(config: LLMProviderConfig): ILLMProvider;
  /** 检查是否已注册 */
  has(type: string): boolean;
  /** 列出所有已注册类型 */
  list(): string[];
}

// ---------------------------------------------------------------------------
// 预定义提供商类型
// ---------------------------------------------------------------------------

export const LLM_PROVIDER_TYPES = {
  /** OpenAI 兼容接口（包括 Azure OpenAI、各种代理） */
  openai: "openai",
  /** 智谱 GLM */
  zhipu: "zhipu",
  /** 通义千问 */
  qwen: "qwen",
  /** 浏览器直连（Frontend Mode 使用） */
  browserDirect: "browser-direct",
  /** 服务端代理（Frontend Mode 通过服务端转发） */
  serverProxy: "server-proxy",
} as const;

export type LLMProviderType = (typeof LLM_PROVIDER_TYPES)[keyof typeof LLM_PROVIDER_TYPES];
