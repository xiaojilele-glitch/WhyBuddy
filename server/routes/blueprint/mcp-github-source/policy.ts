/**
 * MCP GitHub capability bridge — policy types, defaults and scrubber helpers.
 *
 * This module is the **single source of truth** for the bridge's safety policy:
 * - URL allow-list + https requirement (design §4.3)
 * - Response body ceiling and total invocation timeout (design §2.D5, §4.3)
 * - MCP tool + server identifiers (design §2.D9)
 * - Credential redaction covering GitHub PATs, emails and `key=value` secrets (design §2.D8)
 *
 * Hard constraints: pure module — no HTTP client imports, no `undici`, no
 * module-level `fetch()` calls. All exports are pure functions.
 */

/**
 * Runtime policy that gates every real MCP / HTTP path the bridge may take.
 *
 * Defaults (design §2.D8): https-only allow-list with api.github.com, 30s total
 * timeout, 1 MiB response body ceiling, conservative 50 log lines / 10 KiB
 * log byte ceiling, and a baseline redaction set covering GitHub PATs, emails
 * and common secret keywords.
 */
export interface McpGithubCapabilityPolicy {
  /** Allowed HTTP origins (exact origin match; rejects substring prefix attacks). */
  readonly allowedHttpOrigins: readonly string[];
  /** When true, the bridge refuses non-https URLs before dispatching. */
  readonly requireHttps: boolean;
  /** Maximum response body bytes the bridge will accept (HTTP path). */
  readonly maxResponseBodyBytes: number;
  /** Total wall-clock invocation budget shared by MCP + HTTP paths. */
  readonly maxInvocationTimeoutMs: number;
  /** Registered MCP tool name (design §2.D9 default: `"github.get_repository"`). */
  readonly mcpToolName: string;
  /** Registered MCP server identifier (design §2.D9 default: `"github"`). */
  readonly mcpServerId: string;
  /** Invocation logs ceiling (line count). */
  readonly maxLogLines: number;
  /** Invocation logs ceiling (byte count). */
  readonly maxLogBytes: number;
  /** Case-insensitive keywords that trigger key-level redaction in args / value scrubbing. */
  readonly redactionKeywords: readonly string[];
  /** Email matcher used by {@link applyMcpGithubCapabilityRedaction}. */
  readonly redactedEmailPattern: RegExp;
  /** GitHub PAT matcher used by {@link applyMcpGithubCapabilityRedaction}. */
  readonly redactedGithubPatPattern: RegExp;
}

/** Result of {@link checkMcpGithubHttpPolicy}: discriminated allow / reason reject. */
export interface McpGithubCapabilityPolicyCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

/** Default invocation timeout in ms (30s, per design §2.D5). */
const DEFAULT_MAX_INVOCATION_TIMEOUT_MS = 30_000;
/** Hard lower/upper bounds on the env-override invocation timeout. */
const MIN_INVOCATION_TIMEOUT_MS = 1_000;
const MAX_INVOCATION_TIMEOUT_MS = 180_000;
/** Default response body ceiling: 1 MiB. */
const DEFAULT_MAX_RESPONSE_BODY_BYTES = 1_048_576;

const DEFAULT_ALLOWED_HTTP_ORIGINS: readonly string[] = [
  "https://api.github.com",
];
const DEFAULT_REDACTION_KEYWORDS: readonly string[] = [
  "authorization",
  "x-github-token",
  "token",
  "api_key",
  "apikey",
  "secret",
  "password",
  "bearer",
  "access_token",
];
// 前置负向后顾 + RFC 5321 长度上界，见 spec-tree/policy.ts 同名字段注释：
// 无界写法在「长串合法本地部字符但没有 @」的输入上是二次复杂度（5MB 约 4 小时）。
const DEFAULT_EMAIL_PATTERN =
  /(?<![\w.+-])[\w.+-]{1,64}@[\w.-]{1,255}\.[A-Za-z]{2,}/g;
/**
 * Covers GitHub classic PATs (`gh[pousr]_` + 36 base62 chars) and fine-grained
 * PATs (`github_pat_` + 22 base62 chars). Both are case-sensitive prefixes.
 */
const DEFAULT_GITHUB_PAT_PATTERN =
  /\b(gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g;

function resolveEnvMaxInvocationTimeoutMs(): number {
  const raw = process.env.BLUEPRINT_MCP_CAPABILITY_BRIDGE_TIMEOUT_MS;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_MAX_INVOCATION_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_INVOCATION_TIMEOUT_MS;
  }
  return Math.min(
    MAX_INVOCATION_TIMEOUT_MS,
    Math.max(MIN_INVOCATION_TIMEOUT_MS, parsed),
  );
}

/**
 * Build the default policy. Supports environment-variable override for
 * `maxInvocationTimeoutMs` via `BLUEPRINT_MCP_CAPABILITY_BRIDGE_TIMEOUT_MS`
 * (any non-numeric / non-positive value falls back to 30s).
 */
export function createDefaultMcpGithubCapabilityPolicy(): McpGithubCapabilityPolicy {
  return {
    allowedHttpOrigins: DEFAULT_ALLOWED_HTTP_ORIGINS,
    requireHttps: true,
    maxResponseBodyBytes: DEFAULT_MAX_RESPONSE_BODY_BYTES,
    maxInvocationTimeoutMs: resolveEnvMaxInvocationTimeoutMs(),
    mcpToolName: "github.get_repository",
    mcpServerId: "github",
    maxLogLines: 50,
    maxLogBytes: 10_240,
    redactionKeywords: DEFAULT_REDACTION_KEYWORDS,
    redactedEmailPattern: new RegExp(
      DEFAULT_EMAIL_PATTERN.source,
      DEFAULT_EMAIL_PATTERN.flags,
    ),
    redactedGithubPatPattern: new RegExp(
      DEFAULT_GITHUB_PAT_PATTERN.source,
      DEFAULT_GITHUB_PAT_PATTERN.flags,
    ),
  };
}

/**
 * Validate a URL against the policy's allow-list and scheme rules.
 *
 * Rule table (design §4.3):
 * - `new URL(url)` throws → `"invalid url"`
 * - `policy.requireHttps` and scheme !== `https:` → `"https required"`
 * - `url.origin` not in `policy.allowedHttpOrigins` → `"allow-list rejected"`
 * - otherwise allowed
 *
 * Origin comparison uses exact `url.origin === allowedOrigin` to defeat
 * substring-prefix attacks (e.g. `https://api.github.com.evil.example`).
 */
export function checkMcpGithubHttpPolicy(
  policy: McpGithubCapabilityPolicy,
  url: string,
): McpGithubCapabilityPolicyCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "invalid url" };
  }

  if (policy.requireHttps && parsed.protocol !== "https:") {
    return { allowed: false, reason: "https required" };
  }

  const allowed = policy.allowedHttpOrigins.some(
    (origin) => origin === parsed.origin,
  );
  if (!allowed) {
    return { allowed: false, reason: "allow-list rejected" };
  }

  return { allowed: true };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scrub GitHub tokens, emails and key:value secrets from a string.
 *
 * Order matters:
 * 1. GitHub PATs (most specific) → `[redacted-github-token]`
 * 2. Emails → `[redacted-email]`
 * 3. `keyword: "value"` / `keyword=value` pairs (case-insensitive) → `keyword: [redacted]`
 */
export function applyMcpGithubCapabilityRedaction(
  value: string,
  policy: McpGithubCapabilityPolicy,
): string {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  let result = value;

  // 1. GitHub PATs
  result = result.replace(
    new RegExp(
      policy.redactedGithubPatPattern.source,
      policy.redactedGithubPatPattern.flags,
    ),
    "[redacted-github-token]",
  );

  // 2. emails
  result = result.replace(
    new RegExp(
      policy.redactedEmailPattern.source,
      policy.redactedEmailPattern.flags,
    ),
    "[redacted-email]",
  );

  // 3. keyword: value / keyword = value pairs
  for (const keyword of policy.redactionKeywords) {
    const pattern = new RegExp(
      // 值部取到换行/逗号/分号，而不是取到空白：带 scheme 前缀的凭据
      // （`Authorization: Bearer <token>`）只脱到空白就只盖掉 "Bearer"，
      // token 本体原样漏出。对齐 spec-tree / aigc-spec-node 的写法。
      `(${escapeRegex(keyword)})\\s*[:=]\\s*"?[^"\\r\\n,;]+"?`,
      "gi",
    );
    result = result.replace(pattern, "$1: [redacted]");
  }

  return result;
}

/**
 * Shallow key-level redaction for MCP tool arguments.
 *
 * - Keys matching a `redactionKeywords` entry (case-insensitive) → value
 *   replaced with the literal string `"[redacted]"`.
 * - Non-sensitive string values → scrubbed via
 *   {@link applyMcpGithubCapabilityRedaction}.
 * - Non-string, non-sensitive values → preserved as-is.
 *
 * The function is intentionally shallow (no deep traversal); V1 only needs to
 * protect flat `{owner, repo}`-style payloads and explicit token fields.
 */
export function redactMcpArguments(
  args: Record<string, unknown>,
  policy: McpGithubCapabilityPolicy,
): Record<string, unknown> {
  const sensitiveKeys = new Set(
    policy.redactionKeywords.map((keyword) => keyword.toLowerCase()),
  );
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      result[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string") {
      result[key] = applyMcpGithubCapabilityRedaction(value, policy);
      continue;
    }
    result[key] = value;
  }
  return result;
}
