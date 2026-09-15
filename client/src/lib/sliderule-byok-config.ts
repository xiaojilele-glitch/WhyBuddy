/**
 * B2 · BYOK 配置层（key 的全生命周期）。
 *
 * key 只存用户本机 localStorage。
 * 唯一去向：用户选定的厂商端点。
 * 绝不进 V5SessionState / artifact / ledger / 导出 / 遥测。
 *
 * 支持多 key 池（同轮并行能力可分散到不同 key）。
 * 预设表驱动各家信封差异。
 */

export type ByokPresetId =
  | "anthropic"
  | "deepseek"
  | "openrouter"
  | "atlascloud"
  | "openai"
  | "gemini"
  | "zhipu"
  | "siliconflow"
  | "custom";

export interface ByokKeyEntry {
  id: string;                // 池内唯一
  label: string;             // 用户可读名
  presetId: ByokPresetId;
  endpoint: string;
  model: string;
  apiKey: string;            // 仅本模块 + provider 闭包持有
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  maxInFlight?: number;      // 单 key 并发上限，默认 2
}

export interface ByokPoolConfig {
  version: 1;                // localStorage "sliderule:llm-pool:v1"
  entries: ByokKeyEntry[];   // 1..8 条，可跨厂商混配
  dispatch: "least-busy" | "round-robin";  // 默认 least-busy
  raceMode: boolean;         // 默认 false！成本诚实（用户自己的钱）
}

const STORAGE_KEY = "sliderule:llm-pool:v1";

export function loadByokPool(): ByokPoolConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed as ByokPoolConfig;
    }
  } catch {}
  return null;
}

export function saveByokPool(c: ByokPoolConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {}
}

export function clearByokPool(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function maskKey(k: string): string {
  if (!k || k.length < 8) return "****";
  return k.slice(0, 4) + "…" + k.slice(-2);
}

export function validateByokPool(c: ByokPoolConfig): { ok: boolean; reason?: string } {
  if (!c || c.version !== 1) return { ok: false, reason: "invalid version" };
  if (!Array.isArray(c.entries) || c.entries.length === 0) return { ok: false, reason: "no entries" };
  if (c.entries.length > 8) return { ok: false, reason: "too many entries (max 8)" };
  for (const e of c.entries) {
    if (!e.id || !e.label || !e.presetId || !e.endpoint || !e.model || !e.apiKey) {
      return { ok: false, reason: "entry missing required fields" };
    }
    if (typeof e.enabled !== "boolean") return { ok: false, reason: "entry enabled must be boolean" };
  }
  if (c.dispatch !== "least-busy" && c.dispatch !== "round-robin") {
    return { ok: false, reason: "invalid dispatch" };
  }
  if (typeof c.raceMode !== "boolean") return { ok: false, reason: "raceMode must be boolean" };
  return { ok: true };
}

export const PRESET_ENDPOINTS: Record<ByokPresetId, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  deepseek: "https://api.deepseek.com/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  atlascloud: "https://api.atlascloud.ai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  zhipu: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  siliconflow: "https://api.siliconflow.cn/v1/chat/completions",
  custom: "",
};

export const PRESET_MODELS: Record<ByokPresetId, string> = {
  anthropic: "claude-3-5-sonnet-20241022",
  deepseek: "deepseek-chat",
  openrouter: "anthropic/claude-3.5-sonnet",
  atlascloud: "openai/gpt-5.6-luna",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  zhipu: "glm-4-flash",
  siliconflow: "Qwen/Qwen2.5-7B-Instruct",
  custom: "gpt-4o-mini",
};
