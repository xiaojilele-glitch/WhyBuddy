/**
 * Engineering Handoff LLM — policy types, defaults and redaction helpers.
 *
 * This module is the **single source of truth** for the Engineering Handoff
 * LLM generator's safety policy:
 * - Schema field length upper bounds (design §4.3 / §D8)
 * - LLM invocation timeout with env-var override (design §4.3 / §2.D4)
 * - Credential redaction covering API keys, GitHub PATs, emails and
 *   key-value secret pairs (design §4.3 / requirement 2.8, 4.5, 5.1)
 *
 * Hard constraints: pure module — NO runtime / business module imports,
 * NO HTTP client imports, NO module-level `fetch()` calls.
 * Only TypeScript built-in types are imported.
 */

/**
 * Runtime policy governing schema validation bounds, LLM invocation parameters,
 * and credential redaction for the Engineering Handoff LLM generator.
 */
export interface EngineeringHandoffLlmPolicy {
  /** Total wall-clock budget for a single LLM callJson invocation (ms). */
  readonly maxInvocationTimeoutMs: number;
  /** LLM temperature parameter. */
  readonly temperature: number;
  /** Number of retry attempts for callJson. */
  readonly callJsonRetryAttempts: number;

  // --- Schema field length bounds ---
  readonly maxTitleLength: number;
  readonly maxSummaryLength: number;
  readonly maxMissionSummaryLength: number;
  readonly minSteps: number;
  readonly maxSteps: number;
  readonly maxStepIdLength: number;
  readonly maxStepTitleLength: number;
  readonly maxStepSummaryLength: number;
  readonly maxFileScopesPerStep: number;
  readonly maxFileScopeLength: number;
  readonly maxVerificationCommandsPerStep: number;
  readonly maxVerificationCommandLength: number;
  readonly maxSourceNodeIdsPerStep: number;
  readonly maxSourceDocumentIdsPerStep: number;
  readonly maxSourcePreviewIdsPerStep: number;
  readonly maxPromptPackageIdsPerStep: number;
  readonly minHandoffs: number;
  readonly maxHandoffs: number;
  readonly maxHandoffSummaryLength: number;
  readonly minAcceptanceCriteria: number;
  readonly maxAcceptanceCriteria: number;
  readonly maxAcceptanceCriterionLength: number;
  readonly maxRiskNotes: number;
  readonly maxRiskNoteMessageLength: number;

  // --- Redaction ---
  /** Case-insensitive keywords that trigger key-level redaction. */
  readonly redactionKeywords: readonly string[];
  /** Email matcher used by {@link applyEngineeringHandoffRedaction}. */
  readonly redactedEmailPattern: RegExp;
  /** API key matcher (sk-... / clp_...) used by {@link applyEngineeringHandoffRedaction}. */
  readonly redactedApiKeyPattern: RegExp;
  /** GitHub PAT matcher used by {@link applyEngineeringHandoffRedaction}. */
  readonly redactedGithubPatPattern: RegExp;

  /** Maximum length for error messages stored in provenance. */
  readonly maxErrorLength: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_INVOCATION_TIMEOUT_MS = 30_000;
const MAX_OVERRIDE_INVOCATION_TIMEOUT_MS = 180_000;

const DEFAULT_REDACTION_KEYWORDS: readonly string[] = [
  "authorization",
  "bearer",
  "token",
  "api_key",
  "apikey",
  "secret",
  "password",
  "access_token",
  "x-github-token",
  "openai-api-key",
];

/**
 * Matches emails. Covers the vast majority of real-world addresses.
 *
 * 「没有嵌套量词」并不等于线性：原式 /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g 在一长串
 * 合法本地部字符、却始终等不到 `@` 的输入上是**二次**复杂度（每个起始位置都吞到
 * 结尾再逐字符回退），5MB 折算约 4 小时——正是 policy.test.ts 那条 ReDoS 哨兵一直
 * 卡住的原因。这里两处收口：① 前置负向后顾，匹配只能从本地部真实起点开始，其余
 * 位置 O(1) 否掉；② 按 RFC 5321 给本地部/域名上界（64 / 255），回退量变成常数。
 * 实测 5MB ~17ms，且对合法邮箱的脱敏结果与原式逐例一致。
 */
const DEFAULT_EMAIL_PATTERN =
  /(?<![\w.+-])[\w.+-]{1,64}@[\w.-]{1,255}\.[A-Za-z]{2,}/g;

/**
 * Matches OpenAI-style API keys (`sk-` prefix, 20+ alphanumeric/dash chars)
 * and Anthropic-style keys (`clp_` prefix, 20+ alphanumeric chars).
 * Designed to be ReDoS-safe (no nested quantifiers or backtracking traps).
 */
const DEFAULT_API_KEY_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{20,200}|clp_[A-Za-z0-9]{20,200})\b/g;

/**
 * Covers GitHub classic PATs (`gh[pousr]_` + 36+ base62 chars) and
 * fine-grained PATs (`github_pat_` + 22+ base62 chars).
 * ReDoS-safe: single character class repetition with bounded length.
 */
const DEFAULT_GITHUB_PAT_PATTERN =
  /\b(gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g;

// ---------------------------------------------------------------------------
// Env-var resolution
// ---------------------------------------------------------------------------

function resolveEnvMaxInvocationTimeoutMs(): number {
  const raw = process.env.BLUEPRINT_ENGINEERING_HANDOFF_LLM_TIMEOUT_MS;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_MAX_INVOCATION_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  // Must be a positive integer AND <= MAX_OVERRIDE_INVOCATION_TIMEOUT_MS (3 min ceiling)
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed !== Math.floor(parsed) ||
    parsed > MAX_OVERRIDE_INVOCATION_TIMEOUT_MS
  ) {
    return DEFAULT_MAX_INVOCATION_TIMEOUT_MS;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the default Engineering Handoff LLM policy.
 *
 * Supports environment-variable override for `maxInvocationTimeoutMs` via
 * `BLUEPRINT_ENGINEERING_HANDOFF_LLM_TIMEOUT_MS`. The override is only
 * adopted when it parses as a positive integer AND is <= 30000; otherwise
 * the default 30000 is used (design §4.3 + §2.D4).
 */
export function createDefaultEngineeringHandoffLlmPolicy(): EngineeringHandoffLlmPolicy {
  return {
    maxInvocationTimeoutMs: resolveEnvMaxInvocationTimeoutMs(),
    temperature: 0.2,
    callJsonRetryAttempts: 1,

    maxTitleLength: 200,
    maxSummaryLength: 500,
    maxMissionSummaryLength: 1000,
    minSteps: 1,
    maxSteps: 30,
    maxStepIdLength: 128,
    maxStepTitleLength: 200,
    maxStepSummaryLength: 500,
    maxFileScopesPerStep: 50,
    maxFileScopeLength: 200,
    maxVerificationCommandsPerStep: 20,
    maxVerificationCommandLength: 500,
    maxSourceNodeIdsPerStep: 50,
    maxSourceDocumentIdsPerStep: 50,
    maxSourcePreviewIdsPerStep: 20,
    maxPromptPackageIdsPerStep: 10,
    minHandoffs: 1,
    maxHandoffs: 10,
    maxHandoffSummaryLength: 500,
    minAcceptanceCriteria: 1,
    maxAcceptanceCriteria: 20,
    maxAcceptanceCriterionLength: 500,
    maxRiskNotes: 20,
    maxRiskNoteMessageLength: 500,

    redactionKeywords: DEFAULT_REDACTION_KEYWORDS,
    redactedEmailPattern: new RegExp(
      DEFAULT_EMAIL_PATTERN.source,
      DEFAULT_EMAIL_PATTERN.flags,
    ),
    redactedApiKeyPattern: new RegExp(
      DEFAULT_API_KEY_PATTERN.source,
      DEFAULT_API_KEY_PATTERN.flags,
    ),
    redactedGithubPatPattern: new RegExp(
      DEFAULT_GITHUB_PAT_PATTERN.source,
      DEFAULT_GITHUB_PAT_PATTERN.flags,
    ),

    maxErrorLength: 500,
  };
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scrub sensitive credentials from a string value.
 *
 * Redaction order (most specific first):
 * 1. API keys (`sk-...` / `clp_...`) → `[redacted-api-key]`
 * 2. GitHub PATs (`gh[pousr]_...` / `github_pat_...`) → `[redacted-github-token]`
 * 3. Emails → `[redacted-email]`
 * 4. Key-value pairs matching redaction keywords
 *    (`Authorization: Bearer xxx`, `token=xxx`, `api_key=xxx`,
 *     `x-github-token: xxx`, `openai-api-key: xxx`) → `keyword: [redacted]`
 *
 * All patterns are designed to be ReDoS-safe (no catastrophic backtracking).
 *
 * @param value - The string to redact.
 * @param policy - The policy providing patterns and keywords.
 * @returns The redacted string.
 */
export function applyEngineeringHandoffRedaction(
  value: string,
  policy: EngineeringHandoffLlmPolicy,
): string {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  let result = value;

  // 1. API keys (sk-... / clp_...)
  result = result.replace(
    new RegExp(
      policy.redactedApiKeyPattern.source,
      policy.redactedApiKeyPattern.flags,
    ),
    "[redacted-api-key]",
  );

  // 2. GitHub PATs
  result = result.replace(
    new RegExp(
      policy.redactedGithubPatPattern.source,
      policy.redactedGithubPatPattern.flags,
    ),
    "[redacted-github-token]",
  );

  // 3. Emails
  result = result.replace(
    new RegExp(
      policy.redactedEmailPattern.source,
      policy.redactedEmailPattern.flags,
    ),
    "[redacted-email]",
  );

  // 4. Key-value pairs: keyword: "value" / keyword=value / keyword: value
  for (const keyword of policy.redactionKeywords) {
    // 值部取到下一个换行/逗号/分号为止，而不是到下一个空白为止：带 scheme 前缀的
    // 凭据（`Authorization: Bearer <jwt>`）只脱到空白就只盖掉 "Bearer"，JWT 本体
    // 原样漏出去。同目录的 spec-tree/policy.ts 一直是 `[^"\r\n,;]+`，这里对齐。
    // （本文件的 ReDoS 哨兵此前一直跑不完，把这条断言一并挡在了后面。）
    const pattern = new RegExp(
      `(${escapeRegex(keyword)})\\s*[:=]\\s*"?[^"\\r\\n,;]+"?`,
      "gi",
    );
    const lowerKeyword = keyword.toLowerCase();
    result = result.replace(pattern, `${lowerKeyword}: [redacted]`);
  }

  return result;
}
