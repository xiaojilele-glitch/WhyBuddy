/**
 * Policy + redaction helpers for the Role System Architecture capability bridge.
 *
 * Owns:
 * - `RoleSystemArchitectureCapabilityPolicy` interface (resource / redaction limits).
 * - `createDefaultRoleSystemArchitectureCapabilityPolicy()` factory honoring
 *   `BLUEPRINT_ROLE_CAPABILITY_BRIDGE_TIMEOUT_MS` env override
 *   (clamped to `(0, 30_000]`; illegal / non-finite / non-positive / empty
 *   values fall back to the 30s default).
 * - `applyRoleCapabilityRedaction(value, policy)` pure redaction helper.
 *
 * No runtime / business imports — this file is intentionally a pure data
 * module + pure functions so it can be imported from bridge.ts, tests, and
 * future shared-redaction abstractions without introducing cycles. Only
 * `process.env` is consulted, and only at factory invocation time.
 *
 * See design §4.3 / §D10, requirements 2.4 / 4.7 / 7.4.
 */

export interface RoleSystemArchitectureCapabilityPolicy {
  /** Single LLM-call + validation wall-clock upper bound (ms). */
  maxInvocationTimeoutMs: number;
  /** Temperature forwarded to ctx.llm.callJson. */
  temperature: number;
  /** Max log lines surfaced on `invocation.logs`. */
  maxLogLines: number;
  /** Cumulative byte budget for `invocation.logs`. */
  maxLogBytes: number;
  /** Byte budget for `evidence.provenance.structuredRoles.summary`. */
  maxStructuredPayloadSummaryBytes: number;
  /** Case-insensitive keyword list for key:value redaction. */
  redactionKeywords: readonly string[];
  /** Email regex (global) for defensive redaction. */
  redactedEmailPattern: RegExp;
  /** OpenAI / Anthropic API key regex. */
  redactedApiKeyPattern: RegExp;
  /** GitHub PAT / fine-grained token regex. */
  redactedGithubPatPattern: RegExp;
  /**
   * Forwarded to ctx.llm.callJson retryAttempts (must be small to keep
   * latency bounded under the 30s wall-clock cap).
   */
  callJsonRetryAttempts: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 180_000;
const TIMEOUT_ENV_VAR = "BLUEPRINT_ROLE_CAPABILITY_BRIDGE_TIMEOUT_MS";

function resolveTimeoutOverride(): number {
  const raw = process.env[TIMEOUT_ENV_VAR];
  if (typeof raw !== "string" || raw.length === 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  // `Number.isFinite` already excludes `NaN` / `Infinity` / `-Infinity`, and
  // the `<= 0` branch covers zero / negative values (both treated as illegal
  // per design §4.3: "非法或 > 30000 时 clamp 回 30000").
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  // Clamp to upper bound; never exceed the design-mandated 30s ceiling.
  return Math.min(parsed, MAX_TIMEOUT_MS);
}

export function createDefaultRoleSystemArchitectureCapabilityPolicy(): RoleSystemArchitectureCapabilityPolicy {
  return {
    maxInvocationTimeoutMs: resolveTimeoutOverride(),
    temperature: 0.2,
    maxLogLines: 20,
    maxLogBytes: 4_096,
    maxStructuredPayloadSummaryBytes: 300,
    redactionKeywords: [
      "authorization",
      "token",
      "api_key",
      "apikey",
      "secret",
      "password",
      "bearer",
      "access_token",
      "x-github-token",
      "openai-api-key",
    ],
    // 前置负向后顾 + RFC 5321 长度上界，见 spec-tree/policy.ts 同名字段注释：
    // 无界写法在「长串合法本地部字符但没有 @」的输入上是二次复杂度（5MB 约 4 小时）。
    redactedEmailPattern: /(?<![\w.+-])[\w.+-]{1,64}@[\w.-]{1,255}/g,
    redactedApiKeyPattern: /\b(sk-[A-Za-z0-9]{20,}|clp_[A-Za-z0-9]{20,})\b/g,
    redactedGithubPatPattern:
      /\b(gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g,
    callJsonRetryAttempts: 1,
  };
}

/**
 * Escape regex metacharacters so user-supplied keywords can be safely embedded
 * inside a `new RegExp(...)` without regex-injection surprises.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (match) => "\\" + match);
}

/**
 * Defensive redaction for strings that will be persisted to `invocation.logs`,
 * `evidence.summary`, `outputSummary`, `structuredRoles.summary`, or logger
 * meta.
 *
 * Applied in order:
 *   1. API keys (OpenAI / Anthropic-style)
 *   2. GitHub PATs (classic + fine-grained)
 *   3. Emails
 *   4. key:value pairs for each `redactionKeywords` entry (case-insensitive)
 *
 * The key:value pattern consumes the entire remainder of the line (up to a
 * newline, comma, or semicolon) to ensure scheme-prefixed secrets such as
 * `Authorization: Bearer <jwt>` are redacted as a whole rather than leaving
 * the payload after the scheme token exposed. Whitespace inside the value is
 * intentionally consumed so `Bearer <token>` collapses to `[redacted]`.
 *
 * Pure, side-effect free, no dependency on ctx. Returns a new string; never
 * mutates input. Non-string / empty inputs are returned as-is for defensive
 * ergonomics at bridge call sites that occasionally receive undefined-typed
 * upstream values.
 */
export function applyRoleCapabilityRedaction(
  value: string,
  policy: RoleSystemArchitectureCapabilityPolicy,
): string {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  let result = value;
  result = result.replace(policy.redactedApiKeyPattern, "[redacted-api-key]");
  result = result.replace(
    policy.redactedGithubPatPattern,
    "[redacted-github-token]",
  );
  result = result.replace(policy.redactedEmailPattern, "[redacted-email]");
  for (const keyword of policy.redactionKeywords) {
    // Match "keyword" (case-insensitive), optional surrounding whitespace,
    // followed by ':' or '=', then a quoted-or-bare value that extends up to
    // the next newline / comma / semicolon boundary. This is deliberately
    // looser than a single non-whitespace token so scheme-prefixed secrets
    // (e.g. `Authorization: Bearer <jwt>`) are redacted as a whole.
    const pattern = new RegExp(
      `(${escapeRegex(keyword)})\\s*[:=]\\s*"?[^"\\r\\n,;]+"?`,
      "gi",
    );
    result = result.replace(pattern, "$1: [redacted]");
  }
  return result;
}
