import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { nanoid } from "nanoid";

import { estimateCost, PRICING_TABLE, DEFAULT_PRICING } from "../../shared/cost.js";
import { getAIConfig } from "./ai-config.js";
import { telemetryStore } from "./telemetry-store.js";
import { estimateCost as estimateTelemetryCost } from "../../shared/telemetry.js";
import type { LLMCallRecord } from "../../shared/telemetry.js";
import type { LLMMessageContentPart } from "../../shared/workflow-runtime.js";
import { costTracker } from "./cost-tracker.js";

dotenv.config();

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
  const fallbackModels =
    configured === undefined
      ? ["gpt-5.3-codex", "gpt-5.4-mini", "gpt-5.2"]
      : parseModelList(configured);
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

function getProviderCooldownMs(provider: ProviderConfig): number {
  const raw =
    provider.name === "fallback"
      ? process.env.FALLBACK_LLM_COOLDOWN_MS || "30000"
      : process.env.LLM_PROVIDER_COOLDOWN_MS || "120000";
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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
    (status === 403 && /billing_error|quota|rate limit|rate_limit|insufficient_quota|out of quota/i.test(lower))
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
  return /no available clients|temporarily unavailable|LLM service error|HTTP 5\d\d|timed out|Cannot reach LLM service|rate limited|out of quota/i.test(
    error.message
  );
}

export function isLLMTemporarilyUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /provider cooling down|timed out|Cannot reach LLM service|temporarily unavailable|LLM service error|HTTP 5\d\d|rate limited|out of quota|All LLM providers are temporarily unavailable/i.test(
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
    return JSON.parse(raw);
  } catch {
    throw malformedResponseError(raw.substring(0, 200));
  }
}

function looksLikeSSE(raw: string, contentType: string): boolean {
  return (
    contentType.includes("text/event-stream") ||
    /^\s*(event|data):/m.test(raw)
  );
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

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw normalizeLLMError(provider, response.status, errText);
    }

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

    const response = await fetch(`${provider.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw normalizeLLMError(provider, response.status, errText);
    }

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

    if (isGlobalProviderCoolingDown()) {
      throw unavailableProvidersError(getGlobalProviderCooldownMs());
    }

    if (providers.every(provider => isProviderCoolingDown(provider))) {
      const remainingMs = Math.min(
        ...providers.map(provider => getRemainingCooldownMs(provider))
      );
      openGlobalProviderCooldown(remainingMs);
      throw unavailableProvidersError(remainingMs);
    }

    let lastError: Error | null = null;

    for (const provider of providers) {
      const providerForCall: ProviderConfig = {
        ...provider,
        timeoutMs:
          normalizePositiveInteger(effectiveOptions.timeoutMs) ??
          provider.timeoutMs,
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
            openProviderCooldown(providerForCall);
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
