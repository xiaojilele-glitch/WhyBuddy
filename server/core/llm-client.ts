import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { nanoid } from "nanoid";

// Proxy handling: rely ENTIRELY on Node's built-in env-proxy support. Set NODE_USE_ENV_PROXY=1
// together with HTTP_PROXY/HTTPS_PROXY (and NO_PROXY for exemptions); dev:all and .env do this
// when a local proxy (Clash) is active. Node's built-in fetch then routes correctly per the env.
//
// We must NOT pass a dispatcher built from the standalone `undici` npm package to the global
// `fetch`: the installed undici (8.x) and Node's built-in undici differ, so such a dispatcher
// throws "invalid onRequestStart method" → "fetch failed" (surfaced as "Cannot reach LLM
// service"). That version skew is exactly what broke the high / orchestrate-plan calls while the
// lighter caps (which didn't go through a custom dispatcher) still worked. So setupProxyIfNeeded
// just returns the global fetch and logs the routing decision once per host.
const loggedProxyHosts = new Set<string>();

function setupProxyIfNeeded(targetHost: string): typeof fetch {
  const proxyUrl =
    process.env.HTTP_PROXY || process.env.http_proxy || process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxyUrl && !loggedProxyHosts.has(targetHost)) {
    loggedProxyHosts.add(targetHost);
    const noProxy = (process.env.NO_PROXY || process.env.no_proxy || "").toLowerCase();
    const exempt = noProxy
      .split(",")
      .map((s) => s.trim())
      .some((p) => p && (p === "*" || targetHost.toLowerCase() === p || targetHost.toLowerCase().endsWith(p)));
    const envProxyOn =
      process.env.NODE_USE_ENV_PROXY === "1" || process.env.NODE_USE_ENV_PROXY === "true";
    const how = exempt
      ? "NO_PROXY exempt → direct"
      : envProxyOn
        ? `proxied via NODE_USE_ENV_PROXY (${proxyUrl})`
        : `proxy set but NODE_USE_ENV_PROXY off → DIRECT (set NODE_USE_ENV_PROXY=1 to route via proxy)`;
    console.log(`[llm-client] ${targetHost}: ${how}`);
  }
  return fetch;
}

/**
 * Node.js 版 “httpx” 风格的稳定 LLM HTTP 调用。
 * 
 * 和 tws-ai-ask-python 里的 httpx.AsyncClient 用法对齐：
 *   - 每次调用用原生 fetch（相当于新鲜 client）
 *   - 显式 timeout (AbortSignal)
 *   - 统一做 raise_for_status 风格的错误处理
 *   - 代理完全靠 env (HTTP_PROXY + NODE_USE_ENV_PROXY=1) 驱动，不在调用层做 global dispatcher 魔法
 * 
 * 这样最稳，和 Python 版 benchmark 风格一致。
 */
export async function llmHttpPost(
  baseUrl: string,
  path: string,
  apiKey: string,
  body: any,
  timeoutMs: number,
  extraSignal?: AbortSignal
): Promise<Response> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const signal = extraSignal 
    ? AbortSignal.any?.([extraSignal, controller.signal]) ?? controller.signal   // Node 20+ 支持 any
    : controller.signal;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
      (err as any).status = res.status;
      throw err;
    }

    return res;
  } finally {
    clearTimeout(timeout);
  }
}

import { estimateCost, PRICING_TABLE, DEFAULT_PRICING } from "../../shared/cost.js";
import { getAIConfig } from "./ai-config.js";
import { telemetryStore } from "./telemetry-store.js";
import { estimateCost as estimateTelemetryCost } from "../../shared/telemetry.js";
import type { LLMCallRecord } from "../../shared/telemetry.js";
import type { LLMMessageContentPart } from "../../shared/workflow-runtime.js";
import { costTracker } from "./cost-tracker.js";

dotenv.config();

// Trigger ai-config early so the NO_PROXY augmentation for the LLM host runs
// (belt-and-suspenders for custom hosts like blackaicoding.com behind dev proxy).
import("./ai-config.js").catch(() => {}); // fire and forget, side-effect only

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string | LLMMessageContentPart[];
}

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  retryAttempts?: number;
  timeoutMs?: number;
  /** 调用关联的 Agent ID（用于成本追踪和暂停检查） */
  agentId?: string;
  /** 调用关联的 Mission ID（用于成本追踪） */
  missionId?: string;
  /** 调用关联的 Session ID（用于成本追踪） */
  sessionId?: string;
  /** Per-call override for reasoning effort (used to lighten heavy planning calls and avoid gateway 524s on long reasoning). */
  reasoningEffort?: string;
}

interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finishReason?: string;
}

interface SSEEvent {
  event?: string;
  data: string;
}

interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  wireApi: "responses" | "chat_completions";
  defaultModel: string;
  timeoutMs: number;
  reasoningEffort?: string;
  forceModel: boolean;
  stream: boolean;
  chatThinkingType?: string;
  omitTemperature?: boolean;
}

const MAX_CONCURRENT = Math.max(1, Number(process.env.LLM_MAX_CONCURRENT || 9999));
let activeRequests = 0;
const requestQueue: Array<() => void> = [];
const providerCooldownUntil = new Map<string, number>();
let globalProviderCooldownUntil = 0;

function normalizeModelName(model: string | undefined): string {
  return (model || "").trim().toLowerCase();
}

function getUnlimitedModelSet(): Set<string> {
  const raw = process.env.LLM_UNLIMITED_MODELS || "gpt-5.5";
  return new Set(
    raw
      .split(",")
      .map(model => normalizeModelName(model))
      .filter(Boolean)
  );
}

function isUnlimitedModel(model: string | undefined): boolean {
  const normalized = normalizeModelName(model);
  if (!normalized) return false;
  const unlimitedModels = getUnlimitedModelSet();
  return unlimitedModels.has("*") || unlimitedModels.has(normalized);
}

function parseModelList(raw: string | undefined): string[] {
  if (raw === "") return [];
  return (raw || "")
    .split(",")
    .map(model => model.trim())
    .filter(Boolean);
}

function getPrimaryModelFallbacks(defaultModel: string): string[] {
  const configured = process.env.LLM_MODEL_FALLBACKS;

  // For custom LLM endpoints (e.g. blackaicoding.com with gpt-5.5), do not auto-inject
  // openai-style fallback models like gpt-5.3-codex. Only use fallbacks if the user
  // explicitly sets LLM_MODEL_FALLBACKS (can be empty string to disable).
  // This prevents unwanted "downgrade" when user configures a specific slow/custom model.
  let fallbackModels: string[];
  if (configured === undefined) {
    fallbackModels = [];
  } else {
    fallbackModels = parseModelList(configured);
  }

  const seen = new Set([normalizeModelName(defaultModel)]);
  return fallbackModels.filter(model => {
    const normalized = normalizeModelName(model);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildProviders(): ProviderConfig[] {
  const aiConfig = getAIConfig();
  const primary: ProviderConfig = {
    name: "primary",
    apiKey: aiConfig.apiKey,
    baseUrl: aiConfig.baseUrl,
    wireApi: aiConfig.wireApi,
    defaultModel: aiConfig.model,
    timeoutMs: aiConfig.timeoutMs,
    reasoningEffort: aiConfig.modelReasoningEffort || undefined,
    forceModel: false,
    stream: aiConfig.stream,
    chatThinkingType: aiConfig.chatThinkingType || undefined,
  };

  const fallbackApiKey = process.env.FALLBACK_LLM_API_KEY || "";
  const fallbackBaseUrl = process.env.FALLBACK_LLM_BASE_URL || "";

  const providers = [primary];
  for (const model of getPrimaryModelFallbacks(primary.defaultModel)) {
    providers.push({
      ...primary,
      name: `primary:${model}`,
      defaultModel: model,
      forceModel: true,
      reasoningEffort: undefined,
      omitTemperature: true,
    });
  }

  if (fallbackApiKey && fallbackBaseUrl) {
    providers.push({
      name: "fallback",
      apiKey: fallbackApiKey,
      baseUrl: fallbackBaseUrl,
      wireApi:
        (
          process.env.FALLBACK_LLM_WIRE_API || "chat_completions"
        ).toLowerCase() === "responses"
          ? "responses"
          : "chat_completions",
      defaultModel: process.env.FALLBACK_LLM_MODEL || "glm-4.6",
      timeoutMs: Number(process.env.FALLBACK_LLM_TIMEOUT_MS || 600000),
      reasoningEffort: process.env.FALLBACK_LLM_REASONING_EFFORT || undefined,
      forceModel:
        (process.env.FALLBACK_LLM_FORCE_MODEL || "true").toLowerCase() !==
        "false",
      stream:
        (process.env.FALLBACK_LLM_STREAM || "false").toLowerCase() !== "false",
      chatThinkingType:
        process.env.FALLBACK_LLM_CHAT_THINKING_TYPE || "disabled",
    });
  }

  return providers.filter(provider => provider.apiKey && provider.baseUrl);
}

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return Promise.resolve();
  }

  return new Promise(resolve => {
    requestQueue.push(() => {
      activeRequests++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRequests--;
  if (requestQueue.length > 0) {
    requestQueue.shift()?.();
  }
}

function getProviderName(provider: ProviderConfig): string {
  try {
    return new URL(provider.baseUrl).host || provider.baseUrl;
  } catch {
    return provider.baseUrl;
  }
}

function getProviderKey(provider: ProviderConfig): string {
  return `${provider.name}:${provider.baseUrl}:${provider.defaultModel}`;
}

function isSu8Provider(provider: ProviderConfig): boolean {
  return /su8\.codes/i.test(provider.baseUrl || "");
}

function getProviderCooldownMs(provider: ProviderConfig): number {
  if (provider.name === "fallback") {
    const raw = process.env.FALLBACK_LLM_COOLDOWN_MS || "30000";
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  if (isSu8Provider(provider) && process.env.SU8_COOLDOWN_MS) {
    const su8Parsed = Number(process.env.SU8_COOLDOWN_MS);
    if (Number.isFinite(su8Parsed) && su8Parsed >= 0) return su8Parsed;
  }
  const raw = process.env.LLM_PROVIDER_COOLDOWN_MS || "15000"; // transient 网关错误（su8 504 等）默认短锁
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isTransientProviderError(error: Error): boolean {
  const m = error.message || "";
  // Covers both gateway timeouts (524) and full connectivity failures ("Cannot reach LLM service", fetch failures, etc.)
  // These are typically transient (proxy flap, temporary provider blip, Cloudflare edge, DNS hiccup) and should not
  // lock the system out for the full 2min default cooldown.
  return /cannot reach llm service|fetch failed|network|timeout|econnrefused|enotfound|524|gateway timeout|origin.*(timeout|slow)/i.test(m);
}

function isProviderCoolingDown(provider: ProviderConfig): boolean {
  const until = providerCooldownUntil.get(getProviderKey(provider));
  return typeof until === "number" && until > Date.now();
}

function getRemainingCooldownMs(provider: ProviderConfig): number {
  const until = providerCooldownUntil.get(getProviderKey(provider)) || 0;
  return Math.max(0, until - Date.now());
}

function openProviderCooldown(provider: ProviderConfig): void {
  const cooldownMs = getProviderCooldownMs(provider);
  if (cooldownMs <= 0) return;
  providerCooldownUntil.set(getProviderKey(provider), Date.now() + cooldownMs);
}

function clearProviderCooldown(provider: ProviderConfig): void {
  providerCooldownUntil.delete(getProviderKey(provider));
}

function isGlobalProviderCoolingDown(): boolean {
  return globalProviderCooldownUntil > Date.now();
}

function getGlobalProviderCooldownMs(): number {
  return Math.max(0, globalProviderCooldownUntil - Date.now());
}

function openGlobalProviderCooldown(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  globalProviderCooldownUntil = Math.max(
    globalProviderCooldownUntil,
    Date.now() + durationMs
  );
}

export function resetLLMProviderCooldownsForTest(): void {
  providerCooldownUntil.clear();
  globalProviderCooldownUntil = 0;
}

/**
 * Clear cooldown for the main primary LLM provider (used by planning high model).
 * Call this after a transient connectivity blip + successful pool fallback for planning,
 * so the next high-model attempt can retry the primary quickly instead of waiting the short cooldown.
 */
export function clearPrimaryLLMCooldown(): void {
  // The primary provider key is based on the main LLM config (name "primary" or the base host).
  // We clear all to be safe for the main path (planning is high priority).
  // In practice this affects the LLM_* configured primary.
  providerCooldownUntil.clear();
  globalProviderCooldownUntil = 0;
}

function clearGlobalProviderCooldown(): void {
  globalProviderCooldownUntil = 0;
}

function unavailableProvidersError(remainingMs: number): Error {
  return new Error(
    `All LLM providers are temporarily unavailable. Retry in about ${Math.max(1, Math.ceil(remainingMs / 1000))}s.`
  );
}

function resolveModel(
  provider: ProviderConfig,
  requestedModel?: string
): string {
  if (provider.forceModel) {
    return provider.defaultModel;
  }
  return requestedModel || provider.defaultModel;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.max(1, Math.floor(parsed));
}

function missingKeyError(): Error {
  return new Error("No LLM provider is configured. Check .env provider keys.");
}

function malformedResponseError(bodyPreview: string): Error {
  const preview = bodyPreview ? ` Preview: ${bodyPreview}` : "";
  return new Error(`LLM service returned a malformed response.${preview}`);
}

function isModelEndpointMismatchMessage(message: string): boolean {
  return /model\/endpoint mismatch|model not enabled|not enabled for \/codex|unsupported model|model .* not supported|does not support .*model|not available for (?:this )?endpoint|unknown model/i.test(
    message
  );
}

// 网关用鉴权码表达"容量满了"：状态码撒谎时以响应体为准。
//
// ⚠ 2026-08-25：Python 侧 `_normalize_error` 因为同一件事连挂四轮真机——
//   `{"error":{"message":"All available accounts exhausted","type":"server_error"}}`
//   带着 401 回来，被判成鉴权失败 → 不可重试 → 整条推演断在中途。
//   这两处是**一对**实现（Python 那份的 docstring 直接写着 "Port of
//   normalizeLLMError"），只改一边不会报错，只会有一半不生效：Python 修好了
//   而这边照样把容量错误喊成"Check the API key"，把下一个排查的人送去查 key。
//   改这里或那里，先 grep 另一处。
//
// 原先只有 403 认 quota/billing；401 同样会被网关拿来表达容量问题，一并纳入。
// 真鉴权失败（响应体没有容量语义）仍然落到下面的 401/403 分支。
function isCapacityBehindAuthStatus(lower: string): boolean {
  return /billing_error|quota|rate limit|rate_limit|insufficient_quota|out of quota|accounts? exhausted|no available accounts?|capacity|"?type"?\s*[:=]\s*"?server_error/i.test(
    lower
  );
}

function normalizeLLMError(
  provider: ProviderConfig,
  status: number,
  errText: string
): Error {
  const trimmed = errText.trim();
  const lower = trimmed.toLowerCase();
  const providerName = getProviderName(provider);

  if (!provider.apiKey) {
    return missingKeyError();
  }
  if (
    status === 429 ||
    ((status === 401 || status === 403) && isCapacityBehindAuthStatus(lower))
  ) {
    return new Error(
      `LLM rate limited or out of quota on ${providerName}.${trimmed ? ` Details: ${trimmed.substring(0, 160)}` : ""}`
    );
  }
  if (status === 401 || status === 403) {
    return new Error(
      `LLM authentication failed for ${providerName}. Check the API key.${trimmed ? ` Details: ${trimmed.substring(0, 160)}` : ""}`
    );
  }
  if (status >= 500 && lower.includes("no clients available")) {
    return new Error(
      `The LLM service is temporarily unavailable: ${providerName} has no available clients.`
    );
  }
  if (status >= 500) {
    if (status === 524) {
      return new Error(
        `LLM gateway/Cloudflare timeout (HTTP 524) from ${providerName} — the origin took too long (typical with gpt-5.x + high reasoning + large planning prompts). ${trimmed ? `Details: ${trimmed.substring(0, 200)}` : ""}`
      );
    }
    return new Error(
      `LLM service error from ${providerName}: HTTP ${status}.${trimmed ? ` Details: ${trimmed.substring(0, 160)}` : ""}`
    );
  }
  if (status === 400 && isModelEndpointMismatchMessage(lower)) {
    return new Error(
      `LLM model/endpoint mismatch on ${providerName}.${trimmed ? ` Details: ${trimmed.substring(0, 200)}` : ""}`
    );
  }

  return new Error(
    `LLM API ${status} from ${providerName}: ${trimmed.substring(0, 200)}`
  );
}

function normalizeNetworkError(
  provider: ProviderConfig,
  error: unknown
): Error {
  const message = error instanceof Error ? error.message : String(error);
  const providerName = getProviderName(provider);

  if (!provider.apiKey) {
    return missingKeyError();
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new Error(
      `LLM request to ${providerName} timed out after ${provider.timeoutMs}ms.`
    );
  }
  if (/fetch failed|network|timeout|econnrefused|enotfound/i.test(message)) {
    return new Error(
      `Cannot reach LLM service ${providerName}. Check network access or base URL.`
    );
  }

  // llmHttpPost 的裸 HTTP 错误（带 .status）统一走 normalizeLLMError 分类：
  // 403 配额类必须归一成 "rate limited or out of quota"，否则
  // shouldTryNextProvider 认不出、跨 provider 回退整条链路失效
  //（曾因此 billing_error/daily quota 403 直接抛出而不试 fallback provider）。
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") {
    const bodyMatch = message.match(/^LLM HTTP \d+:\s*([\s\S]*)$/);
    return normalizeLLMError(provider, status, bodyMatch?.[1] ?? message);
  }

  return error instanceof Error ? error : new Error(message);
}

function shouldTryNextProvider(error: Error): boolean {
  return isModelEndpointMismatchMessage(error.message) || /no available clients|temporarily unavailable|LLM service error|HTTP 5\d\d|timed out|Cannot reach LLM service|rate limited|out of quota|malformed response|empty response/i.test(
    error.message
  );
}

function shouldStopRetryingProvider(error: Error): boolean {
  return isModelEndpointMismatchMessage(error.message) || /no available clients|authentication failed|invalid_request_error|timed out|daily quota exceeded|out of quota|insufficient_quota/i.test(
    error.message
  );
}

function shouldOpenCircuit(error: Error): boolean {
  return /no available clients|temporarily unavailable|LLM service error|HTTP 5\d\d|timed out|Cannot reach LLM service|rate limited|out of quota|empty response body/i.test(
    error.message
  );
}

export function isLLMTemporarilyUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /provider cooling down|timed out|Cannot reach LLM service|temporarily unavailable|LLM service error|HTTP 5\d\d|rate limited|out of quota|empty response body|All LLM providers are temporarily unavailable/i.test(
    message
  );
}

function buildResponsesInput(messages: LLMMessage[]) {
  const instructions = messages
    .filter(message => message.role === "system")
    .map(message => {
      if (typeof message.content === "string") {
        return message.content;
      }
      // For array content in system messages, extract only text parts
      return message.content
        .filter(part => part.type === "text")
        .map(part => (part as { type: "text"; text: string }).text)
        .join("\n");
    })
    .join("\n\n");

  const input = messages
    .filter(message => message.role !== "system")
    .map(message => {
      if (typeof message.content === "string") {
        return {
          role: message.role,
          content: [{ type: "input_text", text: message.content }],
        };
      }
      // Map LLMMessageContentPart[] to responses API format
      const content = message.content.map(part => {
        if (part.type === "image_url") {
          return { type: "input_image", image_url: part.image_url.url };
        }
        // text → input_text
        return { type: "input_text", text: part.text };
      });
      return { role: message.role, content };
    });

  return { instructions: instructions || undefined, input };
}

function extractResponsesText(data: any): string {
  if (typeof data.output_text === "string" && data.output_text.length > 0) {
    return data.output_text;
  }

  const texts: string[] = [];
  for (const item of data.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }

  return texts.join("\n").trim();
}

function parseSSE(raw: string): SSEEvent[] {
  const normalized = raw.replace(/\r\n/g, "\n");
  const chunks = normalized.split("\n\n");
  const events: SSEEvent[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n").filter(Boolean);
    if (lines.length === 0) continue;

    let eventName: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length > 0) {
      events.push({ event: eventName, data: dataLines.join("\n") });
    }
  }

  return events;
}

function parseJsonSafely(raw: string): any {
  try {
    // Some endpoints send "data: [DONE]" even on non-stream requests or as trailing garbage.
    // Strip it before json parse to avoid malformed errors.
    const cleaned = raw.replace(/data:\s*\[DONE\]\s*$/i, "").trim();
    return JSON.parse(cleaned || "{}");
  } catch {
    throw malformedResponseError(raw.substring(0, 200));
  }
}

function looksLikeSSE(raw: string, contentType: string): boolean {
  const c = (contentType || "").toLowerCase();
  const t = (raw || "").trim();
  if (c.includes("text/event-stream")) return true;
  if (/^\s*(event|data):/m.test(t)) return true;
  // Explicitly catch bare "data: [DONE]" terminator that sometimes leaks when stream was requested
  // but client expected json (common on slow/custom endpoints that ignore stream=false).
  if (/data:\s*\[DONE\]/i.test(t)) return true;
  return false;
}

function parseResponsesStream(raw: string): LLMResponse {
  const events = parseSSE(raw);
  let content = "";
  let usage: LLMResponse["usage"];
  let completedPayload: any = null;

  for (const event of events) {
    if (event.data === "[DONE]") continue;
    const payload = parseJsonSafely(event.data);

    if (
      payload.type === "response.output_text.delta" &&
      typeof payload.delta === "string"
    ) {
      content += payload.delta;
    }

    if (
      payload.type === "response.output_text.done" &&
      typeof payload.text === "string" &&
      !content
    ) {
      content = payload.text;
    }

    if (payload.type === "response.completed") {
      completedPayload = payload.response;
      if (!content) {
        content = extractResponsesText(payload.response || {});
      }
      if (payload.response?.usage) {
        usage = {
          prompt_tokens: payload.response.usage.input_tokens ?? 0,
          completion_tokens: payload.response.usage.output_tokens ?? 0,
          total_tokens: payload.response.usage.total_tokens ?? 0,
        };
      }
    }
  }

  if (completedPayload?.error) {
    throw new Error(
      `LLM response failed: ${JSON.stringify(completedPayload.error)}`
    );
  }
  if (!content.trim()) {
    throw malformedResponseError(raw.substring(0, 200));
  }

  return { content: content.trim(), usage };
}

function parseChatCompletionsStream(raw: string): LLMResponse {
  const events = parseSSE(raw);
  let content = "";
  let usage: LLMResponse["usage"];
  let finishReason: string | undefined;

  for (const event of events) {
    if (event.data === "[DONE]") continue;
    const payload = parseJsonSafely(event.data);
    const choice = payload.choices?.[0];
    const deltaText = choice?.delta?.content;

    if (typeof deltaText === "string") {
      content += deltaText;
    }
    if (typeof choice?.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }

    if (payload.usage) {
      usage = {
        prompt_tokens: payload.usage.prompt_tokens ?? 0,
        completion_tokens: payload.usage.completion_tokens ?? 0,
        total_tokens: payload.usage.total_tokens ?? 0,
      };
    }
  }

  if (!content.trim()) {
    throw malformedResponseError(raw.substring(0, 200));
  }

  return { content: content.trim(), usage, finishReason };
}

async function withTimeout<T>(
  provider: ProviderConfig,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), provider.timeoutMs);

  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(
  response: Response
): Promise<{ raw: string; contentType: string }> {
  const raw = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (!raw.trim()) {
    throw new Error("LLM service returned an empty response body.");
  }

  return { raw, contentType };
}

async function createChatCompletion(
  provider: ProviderConfig,
  messages: LLMMessage[],
  options: {
    model: string;
    temperature: number;
    maxTokens: number;
    jsonMode: boolean;
  }
): Promise<LLMResponse> {
  return withTimeout(provider, async signal => {
    const body: any = {
      model: options.model,
      messages: messages.map(msg => ({
        role: msg.role,
        // When content is an array (multimodal: text + image_url parts),
        // pass it directly — the chat_completions API supports both formats.
        content: msg.content,
      })),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: provider.stream,
    };

    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }
    if (provider.chatThinkingType) {
      body.thinking = { type: provider.chatThinkingType };
    }
    // Some providers (and VSCode custom OpenAI setups) accept reasoning on the chat/completions wire
    // using the top-level field (matching OpenAI o-series convention). Add it for broader compat.
    // (For gpt-5.x on blackaicoding etc. the responses wire is still required and is selected via ai-config.)
    if (provider.reasoningEffort) {
      body.reasoning_effort = provider.reasoningEffort;
      // Also include the nested form some gateways expect
      body.reasoning = { effort: provider.reasoningEffort };
    }

    const response = await llmHttpPost(
      provider.baseUrl,
      "/chat/completions",
      provider.apiKey,
      body,
      provider.timeoutMs,
      signal
    );

    const { raw, contentType } = await readBody(response);
    if (looksLikeSSE(raw, contentType)) {
      return parseChatCompletionsStream(raw);
    }

    const data = parseJsonSafely(raw);
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || "",
      usage: data.usage,
      finishReason: choice?.finish_reason,
    };
  });
}

async function createResponse(
  provider: ProviderConfig,
  messages: LLMMessage[],
  options: {
    model: string;
    temperature: number;
    maxTokens: number;
    jsonMode: boolean;
  }
): Promise<LLMResponse> {
  return withTimeout(provider, async signal => {
    const { instructions, input } = buildResponsesInput(messages);
    const body: any = {
      model: options.model,
      input,
      instructions,
      max_output_tokens: options.maxTokens,
      stream: provider.stream,
      store: false,
    };
    if (!provider.omitTemperature) {
      body.temperature = options.temperature;
    }

    if (provider.reasoningEffort) {
      body.reasoning = { effort: provider.reasoningEffort };
    }

    if (options.jsonMode) {
      body.text = { format: { type: "json_object" } };
    }

    const response = await llmHttpPost(
      provider.baseUrl,
      "/responses",
      provider.apiKey,
      body,
      provider.timeoutMs,
      signal
    );

    const { raw, contentType } = await readBody(response);
    if (looksLikeSSE(raw, contentType)) {
      return parseResponsesStream(raw);
    }

    const data = parseJsonSafely(raw);
    return {
      content: extractResponsesText(data),
      usage: data.usage
        ? {
            prompt_tokens: data.usage.input_tokens ?? 0,
            completion_tokens: data.usage.output_tokens ?? 0,
            total_tokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  });
}

async function callProvider(
  provider: ProviderConfig,
  messages: LLMMessage[],
  options: LLMOptions
): Promise<LLMResponse> {
  const model = resolveModel(provider, options.model);
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 2000;
  const jsonMode = options.jsonMode ?? false;

  const startTime = Date.now();
  try {
    let response: LLMResponse;
    if (provider.wireApi === "responses") {
      response = await createResponse(provider, messages, {
        model,
        temperature,
        maxTokens,
        jsonMode,
      });
    } else {
      response = await createChatCompletion(provider, messages, {
        model,
        temperature,
        maxTokens,
        jsonMode,
      });
    }

    const tokensIn = response.usage?.prompt_tokens ?? 0;
    const tokensOut = response.usage?.completion_tokens ?? 0;
    telemetryStore.recordLLMCall({
      id: nanoid(),
      timestamp: startTime,
      model,
      tokensIn,
      tokensOut,
      cost: estimateCost(model, tokensIn, tokensOut),
      durationMs: Date.now() - startTime,
    });

    return response;
  } catch (error: any) {
    telemetryStore.recordLLMCall({
      id: nanoid(),
      timestamp: startTime,
      model,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      durationMs: Date.now() - startTime,
      error: error?.message ?? String(error),
    });
    throw error;
  }
}

export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const configuredModel = options.model || getAIConfig().model;
  const unlimitedModel = isUnlimitedModel(configuredModel);

  // 1. 检查 Agent 是否被暂停（Req 5.3）
  if (!unlimitedModel && options.agentId && costTracker.isAgentPaused(options.agentId)) {
    throw new Error(`Agent ${options.agentId} is paused due to budget exceeded.`);
  }

  // 2. 应用降级模型（Req 5.2）
  const effectiveModel = unlimitedModel
    ? configuredModel
    : costTracker.getEffectiveModel(configuredModel);
  const effectiveOptions: LLMOptions = { ...options, model: effectiveModel };

  const startTime = Date.now();

  await acquireSlot();

  try {
    const providers = buildProviders();
    if (providers.length === 0) {
      throw missingKeyError();
    }

    // Hoisted above the global-cooldown early-exit so that branch can rethrow the most
    // recent provider error if one was recorded (was declared below → TS2448/2454).
    let lastError: Error | null = null;

    if (isGlobalProviderCoolingDown()) {
      throw unavailableProvidersError(getGlobalProviderCooldownMs());
    }

    if (providers.every(provider => isProviderCoolingDown(provider))) {
      const remainingMs = Math.min(
        ...providers.map(provider => getRemainingCooldownMs(provider))
      );
      openGlobalProviderCooldown(remainingMs);
      if (lastError) {
        throw lastError;
      }
      throw unavailableProvidersError(remainingMs);
    }

    for (const provider of providers) {
      const providerForCall: ProviderConfig = {
        ...provider,
        timeoutMs:
          normalizePositiveInteger(effectiveOptions.timeoutMs) ??
          provider.timeoutMs,
        reasoningEffort:
          effectiveOptions.reasoningEffort ?? provider.reasoningEffort,
      };

      if (isProviderCoolingDown(providerForCall)) {
        const remainingMs = getRemainingCooldownMs(providerForCall);
        lastError = new Error(
          `Skip ${providerForCall.name}: provider cooling down for ${Math.ceil(remainingMs / 1000)}s after recent failures.`
        );
        console.warn(`[LLM:${providerForCall.name}] ${lastError.message}`);
        continue;
      }

      const attempts = Math.max(
        1,
        normalizePositiveInteger(effectiveOptions.retryAttempts) ??
          normalizePositiveInteger(
            providerForCall.name === "fallback"
              ? process.env.FALLBACK_LLM_RETRIES || 3
              : process.env.LLM_RETRIES || 3
          ) ??
          3
      );

      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const response = await callProvider(providerForCall, messages, effectiveOptions);
          clearProviderCooldown(providerForCall);
          clearGlobalProviderCooldown();

          // 3. 记录成功调用的成本（Req 1.1, 1.3, 1.4）
          const actualModel = effectiveOptions.model || providerForCall.defaultModel;
          const tokensIn = response.usage?.prompt_tokens ?? 0;
          const tokensOut = response.usage?.completion_tokens ?? 0;
          const pricing = PRICING_TABLE[actualModel] ?? DEFAULT_PRICING;

          if (!unlimitedModel) {
            costTracker.recordCall({
              id: randomUUID(),
              timestamp: startTime,
              model: actualModel,
              tokensIn,
              tokensOut,
              unitPriceIn: pricing.input,
              unitPriceOut: pricing.output,
              actualCost: estimateCost(actualModel, tokensIn, tokensOut),
              durationMs: Date.now() - startTime,
              agentId: options.agentId,
              missionId: options.missionId,
              sessionId: options.sessionId,
            });
          }

          return response;
        } catch (error) {
          lastError = normalizeNetworkError(providerForCall, error);
          console.error(
            `[LLM:${providerForCall.name}] Attempt ${attempt + 1} failed:`,
            lastError.message
          );

          if (shouldOpenCircuit(lastError)) {
            if (isTransientProviderError(lastError)) {
              // Transient errors (connectivity "Cannot reach", network failures, 524 gateway timeouts)
              // are common with custom providers like blackaicoding behind proxies or during heavy calls.
              // Short cooldown (SU8_COOLDOWN_MS / LLM_PROVIDER_COOLDOWN_MS) so planning + pool recover quickly.
              const shortMs = getProviderCooldownMs(providerForCall);
              if (shortMs > 0) {
                providerCooldownUntil.set(getProviderKey(providerForCall), Date.now() + shortMs);
                console.warn(
                  `[LLM:${providerForCall.name}] short ${Math.ceil(shortMs / 1000)}s cooldown for transient provider error: ${lastError.message.slice(0, 120)}`
                );
              }
            } else {
              openProviderCooldown(providerForCall);
            }
          }

          if (shouldStopRetryingProvider(lastError)) {
            break;
          }
          if (attempt < attempts - 1) {
            const backoffMs = /rate limited|out of quota/i.test(
              lastError.message
            )
              ? 5000 * (attempt + 1)
              : 1000 * (attempt + 1);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
        }
      }

      if (lastError && !shouldTryNextProvider(lastError)) {
        // 4. 记录失败调用的成本（Req 1.2, 1.3）
        const failModel = effectiveOptions.model || providerForCall.defaultModel;
        const failPricing = PRICING_TABLE[failModel] ?? DEFAULT_PRICING;

        if (!unlimitedModel) {
          costTracker.recordCall({
            id: randomUUID(),
            timestamp: startTime,
            model: failModel,
            tokensIn: 0,
            tokensOut: 0,
            unitPriceIn: failPricing.input,
            unitPriceOut: failPricing.output,
            actualCost: 0,
            durationMs: Date.now() - startTime,
            agentId: options.agentId,
            missionId: options.missionId,
            sessionId: options.sessionId,
            error: lastError.message,
          });
        }

        throw lastError;
      }
    }

    if (providers.every(provider => isProviderCoolingDown(provider))) {
      const remainingMs = Math.min(
        ...providers.map(provider => getRemainingCooldownMs(provider))
      );
      openGlobalProviderCooldown(remainingMs);
      if (lastError) {
        throw lastError;
      }
      throw unavailableProvidersError(remainingMs);
    }

    const finalError = lastError || new Error("LLM call failed");

    // 5. 记录最终失败的成本（Req 1.2, 1.3）
    const fallbackModel = effectiveOptions.model || "";
    const fallbackPricing = PRICING_TABLE[fallbackModel] ?? DEFAULT_PRICING;

    if (!unlimitedModel) {
      costTracker.recordCall({
        id: randomUUID(),
        timestamp: startTime,
        model: fallbackModel,
        tokensIn: 0,
        tokensOut: 0,
        unitPriceIn: fallbackPricing.input,
        unitPriceOut: fallbackPricing.output,
        actualCost: 0,
        durationMs: Date.now() - startTime,
        agentId: options.agentId,
        missionId: options.missionId,
        sessionId: options.sessionId,
        error: finalError.message,
      });
    }

    throw finalError;
  } finally {
    releaseSlot();
  }
}


export async function callLLMJson<T = any>(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<T> {
  const response = await callLLM(messages, { ...options, jsonMode: true });

  try {
    let content = response.content.trim();
    const jsonBlock = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlock) {
      content = jsonBlock[1].trim();
    }
    return JSON.parse(content);
  } catch {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    if (response.finishReason === "length") {
      throw new Error(
        `LLM JSON response was truncated by the max token limit (${options.maxTokens ?? "default"}). Increase maxTokens or reduce the requested JSON size.`
      );
    }
    console.error(
      "[LLM] Failed to parse JSON response:",
      response.content.substring(0, 200)
    );
    throw new Error("Failed to parse LLM JSON response");
  }
}

/**
 * Knife 11.1: same as callLLMJson but also returns the raw usage from the provider
 * (so that /execute-capability can surface real token counts to the V5 cost ledger).
 * Does not change the shape or behavior of the original callLLMJson.
 */
export async function callLLMJsonWithUsage<T = any>(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<{ json: T; usage?: LLMResponse["usage"]; finishReason?: string }> {
  const response = await callLLM(messages, { ...options, jsonMode: true });

  try {
    let content = response.content.trim();
    const jsonBlock = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlock) {
      content = jsonBlock[1].trim();
    }
    let parsed: T;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse LLM JSON response");
      }
    }
    return {
      json: parsed,
      usage: response.usage,
      finishReason: response.finishReason,
    };
  } catch (e: any) {
    if (response.finishReason === "length") {
      throw new Error(
        `LLM JSON response was truncated by the max token limit (${options.maxTokens ?? "default"}). Increase maxTokens or reduce the requested JSON size.`
      );
    }
    console.error(
      "[LLM] Failed to parse JSON response:",
      response.content.substring(0, 200)
    );
    throw new Error("Failed to parse LLM JSON response");
  }
}
