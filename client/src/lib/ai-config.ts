export type AIConfigMode = "server_proxy" | "browser_direct";
export type AIWireApi = "responses" | "chat_completions";

/**
 * Net-new additive config extension (whybuddy-llm-autonomous-reasoning, 需求 3.1).
 *
 * `routerModel` lets the LLM_Router use a low-cost / faster model for scheduling
 * decisions. It is OPTIONAL so durable old configs (which never carried it) stay
 * compatible; the router resolves the model as `config.routerModel ?? config.model`.
 */
export interface AIConfigExtension {
  routerModel?: string;
}

export interface AIConfig extends AIConfigExtension {
  mode: AIConfigMode;
  source: "server_env" | "browser_local";
  apiKey: string;
  baseUrl: string;
  model: string;
  modelReasoningEffort: string;
  maxContext: number;
  providerName: string;
  wireApi: AIWireApi;
  timeoutMs: number;
  stream: boolean;
  chatThinkingType?: string;
  proxyUrl: string;
}

interface PersistedAISettings {
  mode?: AIConfigMode;
  browserConfig?: Partial<AIConfig>;
}

const STORAGE_KEY = "whybuddy.ai-settings.v1";

function getSafeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function deriveProviderName(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

function normalizeWireApi(value?: string): AIWireApi {
  return value === "responses" ? "responses" : "chat_completions";
}

function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() !== "false";
  return fallback;
}

function sanitizeUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

export function createDefaultAIConfig(): AIConfig {
  return {
    mode: "server_proxy",
    source: "server_env",
    apiKey: "",
    baseUrl: "",
    model: "",
    modelReasoningEffort: "high",
    maxContext: 1_000_000,
    providerName: "",
    wireApi: "chat_completions",
    timeoutMs: 600_000,
    stream: true,
    chatThinkingType: undefined,
    proxyUrl: "",
  };
}

export function createServerAIConfig(raw: Partial<AIConfig> = {}): AIConfig {
  const baseUrl = sanitizeUrl(raw.baseUrl);
  return {
    ...createDefaultAIConfig(),
    ...raw,
    mode: "server_proxy",
    source: "server_env",
    baseUrl,
    proxyUrl: "",
    wireApi: normalizeWireApi(raw.wireApi),
    timeoutMs: normalizeNumber(raw.timeoutMs, 600_000),
    maxContext: normalizeNumber(raw.maxContext, 1_000_000),
    stream: normalizeBoolean(raw.stream, true),
    providerName: deriveProviderName(baseUrl),
  };
}

export function createBrowserAIConfig(
  raw: Partial<AIConfig> = {},
  fallback?: AIConfig
): AIConfig {
  const seed = fallback ? createServerAIConfig(fallback) : createDefaultAIConfig();
  const baseUrl = sanitizeUrl(raw.baseUrl ?? seed.baseUrl);
  const proxyUrl = sanitizeUrl(raw.proxyUrl);

  return {
    ...seed,
    ...raw,
    mode: "browser_direct",
    source: "browser_local",
    baseUrl,
    proxyUrl,
    wireApi: normalizeWireApi(raw.wireApi ?? seed.wireApi),
    timeoutMs: normalizeNumber(raw.timeoutMs ?? seed.timeoutMs, 600_000),
    maxContext: normalizeNumber(raw.maxContext ?? seed.maxContext, 1_000_000),
    stream: normalizeBoolean(raw.stream ?? seed.stream, false),
    providerName: deriveProviderName(baseUrl),
  };
}

function readPersistedAISettings(): PersistedAISettings | null {
  const storage = getSafeLocalStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function loadPersistedAISettings(serverConfig: AIConfig): {
  mode: AIConfigMode;
  browserConfig: AIConfig;
} {
  const persisted = readPersistedAISettings();
  const mode = persisted?.mode === "browser_direct" ? "browser_direct" : "server_proxy";
  const browserConfig = createBrowserAIConfig(persisted?.browserConfig || {}, serverConfig);

  return { mode, browserConfig };
}

export function savePersistedAISettings(
  mode: AIConfigMode,
  browserConfig: AIConfig
): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;

  const payload: PersistedAISettings = {
    mode,
    browserConfig: {
      apiKey: browserConfig.apiKey,
      baseUrl: browserConfig.baseUrl,
      model: browserConfig.model,
      routerModel: browserConfig.routerModel,
      modelReasoningEffort: browserConfig.modelReasoningEffort,
      maxContext: browserConfig.maxContext,
      providerName: browserConfig.providerName,
      wireApi: browserConfig.wireApi,
      timeoutMs: browserConfig.timeoutMs,
      stream: browserConfig.stream,
      chatThinkingType: browserConfig.chatThinkingType,
      proxyUrl: browserConfig.proxyUrl,
    },
  };

  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
