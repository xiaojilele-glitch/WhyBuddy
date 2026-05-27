/**
 * 成本可观测性 — 共享类型定义与定价表
 *
 * 前后端共享的成本数据结构、模型定价表和费用预估纯函数。
 * 所有接口均支持 JSON 序列化/反序列化，可直接用于 REST API 和 Socket.IO 传输。
 *
 * @see Requirements 2.1, 2.2, 2.3, 2.4, 13.1
 */

// ---------------------------------------------------------------------------
// 模型定价
// ---------------------------------------------------------------------------

/** 模型单价（每千 Token 美元） */
export interface ModelPricing {
  /** 每千 input token 美元 */
  input: number;
  /** 每千 output token 美元 */
  output: number;
}

/** 定价表：各模型的 input/output 单价 */
export const PRICING_TABLE: Record<string, ModelPricing> = {
  'glm-5-turbo': { input: 0.001, output: 0.002 },
  'glm-4.6':     { input: 0.002, output: 0.004 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o':      { input: 0.005, output: 0.015 },
};

/** 未知模型的兜底定价 */
export const DEFAULT_PRICING: ModelPricing = { input: 0.001, output: 0.002 };

// ---------------------------------------------------------------------------
// 图像模型定价（per-call）
// ---------------------------------------------------------------------------

/**
 * 单次图像生成的预估单价（USD per call）。**注意这是静态估算值，不是
 * 真实账单数据**；当 OpenAI / Google 的权威 per-call billing 数据下来
 * 时应当刷新。
 *
 * Sources（last refreshed 2026-05-24）:
 * - `gpt-image-2` —— 参考 OpenAI 公开页面对 `gpt-image-1` 标准 1024×1024
 *   档位的 ≈ $0.04/image 报价（2025-11 公开口径），作为 `gpt-image-2`
 *   未公布 list price 之前的保守基线。
 * - `gemini-2.5-flash-image` —— 参考 Google AI Studio "Image output"
 *   ≈ $0.039/image 报价（2025 公开口径），保守取整为同档位。
 * - `gemini-3.1-flash-image-preview` / `gemini-3-pro-image-preview` ——
 *   preview 阶段未公开 list price，沿用同档位 $0.04/image 作为
 *   defense-in-depth 估值，避免成功 call 的 `actualCost` 仍为 0。
 *
 * 设计目的（autopilot-image-rendering-and-visual-system spec, Phase 5
 * Task 43.1）是让 successful billable 的 image generation 在 cost
 * dashboard 上以 **non-zero** actualCost 出现，而**不**追求精度。真实
 * per-call 成本受输出尺寸 / 重试次数 / 服务商 surcharge 影响；residual
 * risk 在 spec `tasks.md` Task 45.2 第 4 条单独列出。
 */
export const IMAGE_PRICING_TABLE: Readonly<
  Record<string, { readonly perCall: number }>
> = Object.freeze({
  'gpt-image-2': { perCall: 0.04 },
  'gemini-2.5-flash-image': { perCall: 0.039 },
  'gemini-3.1-flash-image-preview': { perCall: 0.04 },
  'gemini-3-pro-image-preview': { perCall: 0.04 },
});

/**
 * 查询某个图像模型的静态 per-call 估算成本（USD）。未知模型返回 `0` ——
 * 调用侧应在 success path 把 `0` 视作「定价缺失」信号，**不要**当成
 * 「该次调用真的免费」。
 *
 * 与 {@link estimateCost} 不同，本函数不接受 token 数量参数：图像生成
 * 是 per-call 计费，token 概念在该域不适用。
 */
export function lookupImagePricing(model: string): number {
  return IMAGE_PRICING_TABLE[model]?.perCall ?? 0;
}

/**
 * 费用预估纯函数
 *
 * 根据模型定价表计算预估费用。未知模型使用 DEFAULT_PRICING 兜底。
 *
 * @param model    - 模型名称
 * @param tokensIn - input token 数量
 * @param tokensOut - output token 数量
 * @returns 预估费用（美元）
 */
export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = PRICING_TABLE[model] ?? DEFAULT_PRICING;
  return (tokensIn / 1000) * pricing.input + (tokensOut / 1000) * pricing.output;
}

// ---------------------------------------------------------------------------
// 成本记录
// ---------------------------------------------------------------------------

/** 单次 LLM 调用成本记录 */
export interface CostRecord {
  id: string;
  timestamp: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** input 单价（每千 Token 美元） */
  unitPriceIn: number;
  /** output 单价（每千 Token 美元） */
  unitPriceOut: number;
  /** 实际费用（美元） */
  actualCost: number;
  /** 调用耗时（毫秒） */
  durationMs: number;
  agentId?: string;
  missionId?: string;
  sessionId?: string;
  /** 调用失败时的错误信息 */
  error?: string;
}

// ---------------------------------------------------------------------------
// 预算与降级
// ---------------------------------------------------------------------------

/** 预算配置 */
export interface Budget {
  /** 最大费用（美元） */
  maxCost: number;
  /** 最大 Token 数 */
  maxTokens: number;
  /** 预警阈值百分比（0-1），默认 0.8 */
  warningThreshold: number;
}

/** 降级策略 */
export interface DowngradePolicy {
  enabled: boolean;
  /** 低成本替代模型 */
  lowCostModel: string;
  /** 关键 Agent 白名单（不会被暂停） */
  criticalAgentIds: string[];
}

/** 降级状态 */
export type DowngradeLevel = 'none' | 'soft' | 'hard';

// ---------------------------------------------------------------------------
// 预警
// ---------------------------------------------------------------------------

/** 成本预警 */
export interface CostAlert {
  id: string;
  type: 'cost_warning' | 'cost_exceeded' | 'token_warning' | 'token_exceeded';
  message: string;
  timestamp: number;
  resolved: boolean;
}

// ---------------------------------------------------------------------------
// 聚合摘要
// ---------------------------------------------------------------------------

/** Agent 成本摘要 */
export interface AgentCostSummary {
  agentId: string;
  agentName: string;
  tokensIn: number;
  tokensOut: number;
  totalCost: number;
  callCount: number;
}

/** 实时成本快照 */
export interface CostSnapshot {
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  totalCalls: number;
  /** 费用维度已用百分比 */
  budgetUsedPercent: number;
  /** Token 维度已用百分比 */
  tokenUsedPercent: number;
  /** 按费用降序排列的 Agent 成本摘要 */
  agentCosts: AgentCostSummary[];
  alerts: CostAlert[];
  downgradeLevel: DowngradeLevel;
  budget: Budget;
  updatedAt: number;
}

/** 历史 Mission 成本摘要 */
export interface MissionCostSummary {
  missionId: string;
  title: string;
  completedAt: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  totalCalls: number;
  topAgents: AgentCostSummary[];
}

// ---------------------------------------------------------------------------
// 默认值
// ---------------------------------------------------------------------------

export const DEFAULT_BUDGET: Budget = {
  maxCost: 1.0,
  maxTokens: 100000,
  warningThreshold: 0.8,
};

export const DEFAULT_DOWNGRADE_POLICY: DowngradePolicy = {
  enabled: true,
  lowCostModel: 'glm-4.6',
  criticalAgentIds: [],
};
