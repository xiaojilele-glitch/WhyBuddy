/**
 * Agent Crew Stage Activation — Policy & Redaction
 *
 * 纯数据 + 纯函数 only。本文件禁止 import 任何运行时依赖（design §2.D1 硬约束）。
 */

/**
 * Stage Activation Driver 的策略配置。
 * 控制事件抑制、幂等性、脱敏规则与 schema 版本白名单。
 */
export interface AgentCrewStageActivationPolicy {
  /** 连续 stage 保持同状态时是否抑制重复事件（默认 true） */
  suppressRepeatedStates: boolean;
  /** 同一 (roleId, stageId, stageAttempt) 幂等性开关（默认 true，禁止关闭） */
  enforceTripletIdempotence: true;
  /** locale-aware message 派生语言（默认 "en-US"） */
  defaultLocale: "zh-CN" | "en-US";
  /** 支持的 role evidence schema 版本（白名单） */
  supportedPromptIds: readonly string[];
  /** 脱敏：email 正则 */
  redactedEmailPattern: RegExp;
  /** 脱敏：API key 正则 */
  redactedApiKeyPattern: RegExp;
  /** 脱敏：GitHub PAT 正则 */
  redactedGithubPatPattern: RegExp;
  /** 脱敏关键词 */
  redactionKeywords: readonly string[];
  /** error 字符串最大字节数 */
  maxErrorBytes: number;
}

/**
 * 创建默认 policy 实例。
 */
export function createDefaultAgentCrewStageActivationPolicy(): AgentCrewStageActivationPolicy {
  return {
    suppressRepeatedStates: true,
    enforceTripletIdempotence: true,
    defaultLocale: "en-US",
    supportedPromptIds: ["blueprint.role-architecture.v1"] as const,
    // 前置负向后顾 + RFC 5321 长度上界：无界的 /[\w.+-]+@[\w.-]+/g 在「一长串合法
    // 本地部字符却等不到 @」的输入上是二次复杂度（每个起点吞到底再逐字符回退），
    // 5MB 折算约 4 小时。本文件没有 ReDoS 哨兵用例，所以这条一直是潜伏的。
    // 详见 spec-tree/policy.ts 同名字段的注释。
    redactedEmailPattern: /(?<![\w.+-])[\w.+-]{1,64}@[\w.-]{1,255}/g,
    redactedApiKeyPattern: /\b(sk-[A-Za-z0-9]{20,}|clp_[A-Za-z0-9]{20,})\b/g,
    redactedGithubPatPattern:
      /\b(gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g,
    redactionKeywords: [
      "authorization",
      "token",
      "api_key",
      "apikey",
      "secret",
      "password",
      "bearer",
      "access_token",
    ],
    maxErrorBytes: 400,
  };
}

/**
 * 转义正则特殊字符，防止 keyword 注入。
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 对字符串依次应用脱敏规则：
 *   1. API key → [redacted-api-key]
 *   2. GitHub PAT → [redacted-github-token]
 *   3. Email → [redacted-email]
 *   4. Keyword-based key:value 对 → key: [redacted]
 *
 * 纯函数，无副作用。
 */
export function applyAgentCrewRedaction(
  value: string,
  policy: AgentCrewStageActivationPolicy
): string {
  // Step 1: Redact API keys
  let result = value.replace(
    policy.redactedApiKeyPattern,
    "[redacted-api-key]"
  );

  // Step 2: Redact GitHub PATs
  result = result.replace(
    policy.redactedGithubPatPattern,
    "[redacted-github-token]"
  );

  // Step 3: Redact emails
  result = result.replace(policy.redactedEmailPattern, "[redacted-email]");

  // Step 4: Redact keyword-based key:value pairs (case-insensitive)
  for (const keyword of policy.redactionKeywords) {
    const escaped = escapeRegex(keyword);
    // Match patterns: keyword: value, keyword:value, keyword=value
    // 值部取到换行/逗号/分号为止，而不是到下一个空白为止：带 scheme 前缀的凭据
    // （`Authorization: Bearer <jwt>`）只脱到空白就只盖掉 "Bearer"，JWT 本体原样
    // 漏出去。对齐 spec-tree / aigc-spec-node 的写法。
    const pattern = new RegExp(
      `(${escaped})\\s*[:=]\\s*([^\\r\\n,;]+)`,
      "gi"
    );
    result = result.replace(pattern, "$1: [redacted]");
  }

  return result;
}
