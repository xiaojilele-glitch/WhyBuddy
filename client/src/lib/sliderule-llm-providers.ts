/**
 * Provider-centric LLM config (Cherry Studio 风格设置中心的数据层)。
 *
 * 这是高层、面向用户的「厂商 → key/baseUrl/模型[]」配置；它**编译**成执行器实际消费的
 * 扁平 `ByokPoolConfig`（sliderule:llm-pool:v1）。执行链（dispatcher / browser-llm /
 * useSlideRuleSession 的 browser-llm 切换）完全不变 —— 本模块保存时写回旧池 key 并派发
 * `byok-config-changed` 事件。
 *
 * key 只写用户本机 localStorage，绝不进会话 / 导出 / 遥测。
 */

import {
  saveByokPool,
  clearByokPool,
  loadByokPool,
  type ByokPoolConfig,
  type ByokKeyEntry,
  type ByokPresetId,
} from "./sliderule-byok-config";

export type LlmProtocol = "openai" | "anthropic";
export type ModelCapability = "vision" | "tools" | "stream";

export interface LlmModelDef {
  id: string; // 调用时用的 model id，例如 "gpt-4o"
  name?: string; // 显示名（可选）
  capabilities: ModelCapability[];
  contextWindow?: number;
  maxOutputTokens?: number;
  enabled: boolean;
}

export interface LlmProviderConfig {
  id: string; // 稳定 id：预设用 presetId，自定义用 custom-xxx
  presetId: string; // 信封 / 图标识别（"anthropic" → Anthropic 信封）
  name: string; // 显示名
  protocol: LlmProtocol;
  apiKey: string;
  /** 本地厂商（Ollama/Lemonade）可不需要 key；false 时即使无 key 也可编译入池。 */
  requiresApiKey: boolean;
  baseUrl: string; // 例如 https://api.openai.com/v1
  enabled: boolean;
  models: LlmModelDef[];
  /**
   * 用户标记的默认模型 id（纯偏好/展示，向后兼容可选字段）。
   * 不改变编译结果集与 executor 注入——只是 UI 上的「默认」徽章/单选。
   */
  defaultModelId?: string;
  /** 服务端托管的预设（只读展示，不参与编译；预留位）。 */
  serverManaged?: boolean;
}

export interface LlmProvidersConfig {
  version: 1;
  providers: LlmProviderConfig[];
  dispatch: ByokPoolConfig["dispatch"];
  raceMode: boolean;
}

export const PROVIDERS_STORAGE_KEY = "sliderule:llm-providers:v1";

/** 可浏览器直连的主流集（用户确认范围）。baseUrl 用「基址」风格，编译时补 path。 */
export interface ProviderPreset {
  presetId: string;
  name: string;
  protocol: LlmProtocol;
  baseUrl: string;
  defaultModel: string;
  /** 单字母徽标（暂代 logo；后续可换 <img>）。 */
  glyph: string;
}

export const SEED_PRESETS: ProviderPreset[] = [
  { presetId: "openai", name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", glyph: "O" },
  { presetId: "anthropic", name: "Claude", protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-sonnet-20241022", glyph: "C" },
  { presetId: "gemini", name: "Gemini", protocol: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.0-flash", glyph: "G" },
  { presetId: "deepseek", name: "DeepSeek", protocol: "openai", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", glyph: "D" },
  { presetId: "openrouter", name: "OpenRouter", protocol: "openai", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini", glyph: "R" },
  { presetId: "atlascloud", name: "Atlas Cloud", protocol: "openai", baseUrl: "https://api.atlascloud.ai/v1", defaultModel: "openai/gpt-5.6-luna", glyph: "A" },
  { presetId: "zhipu", name: "智谱 GLM", protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash", glyph: "智" },
  { presetId: "siliconflow", name: "硅基流动", protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1", defaultModel: "Qwen/Qwen2.5-7B-Instruct", glyph: "硅" },
];

export function presetGlyph(presetId: string): string {
  return SEED_PRESETS.find((p) => p.presetId === presetId)?.glyph ?? "·";
}

/**
 * 厂商配置状态（仅用于列表状态点的纯展示派生，不参与编译/存取）。
 * - `ready`     已启用且密钥就绪（或本地服务无需密钥）→ 下一轮会进池
 * - `needs-key` 勾了「需要密钥」却没填 → 启用也进不了池
 * - `configured` 密钥就绪但未启用
 * - `idle`      未配置且未启用
 */
export type ProviderStatus = "ready" | "needs-key" | "configured" | "idle";

/** 上移/下移厂商（纯数组重排，越界则原样返回）。仅影响列表展示顺序。 */
export function moveProvider(
  providers: LlmProviderConfig[],
  id: string,
  dir: "up" | "down"
): LlmProviderConfig[] {
  const idx = providers.findIndex((p) => p.id === id);
  if (idx < 0) return providers;
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= providers.length) return providers;
  const next = [...providers];
  [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
  return next;
}

export function providerStatus(p: LlmProviderConfig): ProviderStatus {
  const keyReady = !p.requiresApiKey || !!p.apiKey.trim();
  if (p.enabled && keyReady) return "ready";
  if (p.requiresApiKey && !p.apiKey.trim()) return "needs-key";
  if (keyReady) return "configured";
  return "idle";
}

/**
 * 各预设常见模型名（「新建模型」下拉建议，可自由输入覆盖）。
 * 仅作输入辅助，不是白名单——用户填任何 id 都允许。
 */
export const PROVIDER_MODEL_SUGGESTIONS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
  anthropic: [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
  ],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-exp"],
  atlascloud: ["openai/gpt-5.6-luna", "google/gemini-3.1-flash-lite", "anthropic/claude-sonnet-4.6"],
  zhipu: ["glm-4-flash", "glm-4-plus", "glm-4-air"],
  siliconflow: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3"],
};

export function modelSuggestionsFor(presetId: string): string[] {
  return PROVIDER_MODEL_SUGGESTIONS[presetId] ?? [];
}

function seedProvider(p: ProviderPreset): LlmProviderConfig {
  return {
    id: p.presetId,
    presetId: p.presetId,
    name: p.name,
    protocol: p.protocol,
    apiKey: "",
    requiresApiKey: true,
    baseUrl: p.baseUrl,
    enabled: false,
    models: [{ id: p.defaultModel, capabilities: ["tools", "stream"], enabled: true }],
  };
}

/** 全新（或缺失）时的默认配置：seed 主流集 + 一个空自定义位由用户「添加」生成。 */
export function defaultProvidersConfig(): LlmProvidersConfig {
  return {
    version: 1,
    providers: SEED_PRESETS.map(seedProvider),
    dispatch: "least-busy",
    raceMode: false,
  };
}

/** 旧扁平池（用户之前用方形 tile 配的）→ 按 presetId 归并为 provider，做一次性导入。 */
function importFromLegacyPool(seed: LlmProvidersConfig, pool: ByokPoolConfig): LlmProvidersConfig {
  // Work on copies so we never mutate the seed/default config objects (prevents surprising side-effects).
  const providers = seed.providers.map((p) => ({
    ...p,
    models: p.models.map((m) => ({ ...m })),
  }));
  const byPreset = new Map(providers.map((p) => [p.presetId, p]));
  for (const e of pool.entries) {
    const preset = byPreset.get(e.presetId) ?? byPreset.get("openai");
    if (!preset) continue;
    if (!preset.apiKey) preset.apiKey = e.apiKey;
    if (!preset.enabled) preset.enabled = e.enabled;
    if (!preset.models.some((m) => m.id === e.model)) {
      preset.models.push({ id: e.model, capabilities: ["tools", "stream"], enabled: e.enabled });
    }
  }
  return { ...seed, providers, dispatch: pool.dispatch, raceMode: pool.raceMode };
}

export function loadProvidersConfig(): LlmProvidersConfig {
  try {
    const raw = localStorage.getItem(PROVIDERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && Array.isArray(parsed.providers)) {
        return parsed as LlmProvidersConfig;
      }
    }
  } catch {
    /* fall through to seed */
  }
  // 首次：seed + 旧池一次性导入
  const seed = defaultProvidersConfig();
  const legacy = loadByokPool();
  return legacy ? importFromLegacyPool(seed, legacy) : seed;
}

/** 去尾斜杠；若 baseUrl 已含完整 path 原样用，否则按协议补。 */
export function deriveEndpoint(baseUrl: string, protocol: LlmProtocol): string {
  const base = (baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (/\/(chat\/completions|messages)$/.test(base)) return base;
  return protocol === "anthropic" ? `${base}/messages` : `${base}/chat/completions`;
}

/** provider 配置 → 执行器消费的扁平池。enabled 且（不需 key 或已填 key）的 provider × enabled model。 */
export function compileToByokPool(cfg: LlmProvidersConfig): ByokPoolConfig {
  const entries: ByokKeyEntry[] = [];
  for (const p of cfg.providers) {
    if (!p.enabled) continue;
    if (p.requiresApiKey && !p.apiKey.trim()) continue;
    const endpoint = deriveEndpoint(p.baseUrl, p.protocol);
    if (!endpoint) continue;
    for (const m of p.models) {
      if (!m.enabled || !m.id.trim()) continue;
      entries.push({
        id: `${p.id}:${m.id}`,
        label: m.name?.trim() || `${p.name} · ${m.id}`,
        presetId: p.presetId as ByokPresetId,
        endpoint,
        model: m.id,
        apiKey: p.apiKey,
        enabled: true,
      });
    }
  }
  return { version: 1, entries, dispatch: cfg.dispatch, raceMode: cfg.raceMode };
}

/** 落盘：写 provider 配置 + 编译扁平池写回旧 key + 派发事件让会话热切换 executor。 */
export function saveProvidersConfig(cfg: LlmProvidersConfig): void {
  try {
    localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore quota / privacy-mode */
  }
  const pool = compileToByokPool(cfg);
  if (pool.entries.length === 0) {
    clearByokPool();
  } else {
    saveByokPool(pool);
  }
  try {
    window.dispatchEvent(new CustomEvent("byok-config-changed"));
  } catch {
    /* SSR / no window */
  }
}

export function clearProvidersConfig(): void {
  try {
    localStorage.removeItem(PROVIDERS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  clearByokPool();
  try {
    window.dispatchEvent(new CustomEvent("byok-config-changed"));
  } catch {
    /* ignore */
  }
}

/** 把 baseUrl 归约成 `${base}/models` 列表端点（去掉已有的 chat/messages 尾巴）。 */
export function deriveModelsEndpoint(baseUrl: string): string {
  const base = (baseUrl || "").trim().replace(/\/+$/, "").replace(/\/(chat\/completions|messages)$/, "");
  if (!base) return "";
  return `${base}/models`;
}

export interface FetchModelsResult {
  ok: boolean;
  status?: number;
  models?: string[];
  message: string;
}

/**
 * 真实拉取厂商 `/models` 列表（GET，OpenAI 兼容 `{ data: [{ id }] }`）。
 * 不 mock：失败统一返回脱敏 message，UI 据此提示。
 */
export async function fetchProviderModels(input: {
  protocol: LlmProtocol;
  baseUrl: string;
  apiKey: string;
}): Promise<FetchModelsResult> {
  const endpoint = deriveModelsEndpoint(input.baseUrl);
  if (!endpoint) return { ok: false, message: "Base URL 为空或无效" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const headers: Record<string, string> =
    input.protocol === "anthropic"
      ? {
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        }
      : { authorization: `Bearer ${input.apiKey}` };
  try {
    const res = await fetch(endpoint, { method: "GET", headers, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: res.status, message: `鉴权失败（${res.status}）：检查 API Key` };
      }
      if (res.status === 404) return { ok: false, status: 404, message: "该厂商不支持 /models 列表（404）" };
      return { ok: false, status: res.status, message: `HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => null);
    const data = json && Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
    const models = data
      .map((m: any) => (typeof m === "string" ? m : m?.id))
      .filter((id: any): id is string => typeof id === "string" && id.trim().length > 0);
    if (models.length === 0) return { ok: false, message: "返回为空或格式不识别" };
    return { ok: true, models, message: `拉取到 ${models.length} 个模型` };
  } catch (e: any) {
    clearTimeout(timer);
    const msg = String(e?.message || e);
    if (msg.includes("abort")) return { ok: false, message: "请求超时" };
    return { ok: false, message: `网络或 CORS 失败（该厂商可能不支持浏览器直连）` };
  }
}

export interface PingResult {
  ok: boolean;
  status?: number;
  message: string;
  /** 往返延迟（ms），成功时填充，供 UI 显示。 */
  latencyMs?: number;
}

/** 连接 / Base URL 的即时校验（纯派生，供 UI 标红 + 保存阻塞复用）。 */
export interface ProviderValidation {
  keyError: string | null;
  baseUrlError: string | null;
}

export function validateProviderConfig(p: LlmProviderConfig): ProviderValidation {
  const keyError =
    p.requiresApiKey && !p.apiKey.trim() ? "已勾选「需要 API 密钥」，请填写密钥" : null;
  const base = (p.baseUrl || "").trim();
  // 空 Base URL 不在此标红（仅保存启用厂商时阻塞）；非空但 scheme 不对则立即提示。
  const baseUrlError =
    base && !/^https?:\/\//i.test(base) ? "Base URL 需以 http(s):// 开头" : null;
  return { keyError, baseUrlError };
}

/** 启用的厂商是否可保存：字段校验通过且 Base URL 非空（能编译出端点）。 */
export function isEnabledProviderReady(p: LlmProviderConfig): boolean {
  const v = validateProviderConfig(p);
  return !v.keyError && !v.baseUrlError && !!p.baseUrl.trim();
}

/**
 * 真实最小请求验证厂商可达 + key/CORS。复刻 sliderule-browser-llm.ts 的信封形态。
 * 不抛错：统一返回 PingResult，UI 直接据此提示。
 */
export async function pingLlmEndpoint(input: {
  protocol: LlmProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<PingResult> {
  const endpoint = deriveEndpoint(input.baseUrl, input.protocol);
  if (!endpoint) return { ok: false, message: "Base URL 为空或无效" };
  if (!input.model.trim()) return { ok: false, message: "请先填写模型 ID" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const startedAt = Date.now();
  try {
    let res: Response;
    if (input.protocol === "anthropic") {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        signal: controller.signal,
      });
    } else {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        signal: controller.signal,
      });
    }
    clearTimeout(timer);
    if (res.ok)
      return { ok: true, status: res.status, message: "连接成功", latencyMs: Date.now() - startedAt };
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: `鉴权失败（${res.status}）：检查 API Key` };
    }
    if (res.status === 404) {
      return { ok: false, status: res.status, message: `404：检查 Base URL / 模型 ID` };
    }
    if (res.status === 429) {
      return { ok: false, status: res.status, message: `429：限流，稍后重试` };
    }
    return { ok: false, status: res.status, message: `HTTP ${res.status}：${text.slice(0, 80)}` };
  } catch (e: any) {
    clearTimeout(timer);
    const msg = String(e?.message || e);
    if (msg.includes("abort")) return { ok: false, message: "请求超时" };
    // 浏览器直连最常见的失败：CORS / 网络
    return { ok: false, message: `网络或 CORS 失败：${msg.slice(0, 80)}（该厂商可能不支持浏览器直连）` };
  }
}
