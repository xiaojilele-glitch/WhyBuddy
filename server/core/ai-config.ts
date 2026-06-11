import dotenv from 'dotenv';

dotenv.config();

export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /**
   * Net-new additive field (whybuddy-llm-autonomous-reasoning, 需求 3.1).
   *
   * Optional low-cost / faster model used by the LLM_Router for scheduling
   * decisions. OPTIONAL so durable old configs (which never carried it) stay
   * compatible; the router resolves the routing model as
   * `config.routerModel ?? config.model`.
   */
  routerModel?: string;
  modelReasoningEffort: string;
  maxContext: number;
  providerName: string;
  wireApi: 'responses' | 'chat_completions';
  timeoutMs: number;
  stream: boolean;
  chatThinkingType?: string;
}

function normalizeWireApi(value?: string): 'responses' | 'chat_completions' {
  return value?.toLowerCase() === 'responses' ? 'responses' : 'chat_completions';
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() !== 'false';
  return fallback;
}

function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  return values.find(value => typeof value === 'string' && value.length > 0);
}

function deriveProviderName(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

export function getAIConfig(): AIConfig {
  const preferProjectLlmConfig = Boolean(
    firstConfigured(process.env.LLM_API_KEY, process.env.LLM_BASE_URL, process.env.LLM_MODEL)
  );
  const pickProviderValue = (llmValue?: string, openAIValue?: string) =>
    preferProjectLlmConfig
      ? firstConfigured(llmValue, openAIValue)
      : firstConfigured(openAIValue, llmValue);

  const apiKey = pickProviderValue(process.env.LLM_API_KEY, process.env.OPENAI_API_KEY) || '';
  const baseUrl =
    pickProviderValue(process.env.LLM_BASE_URL, process.env.OPENAI_BASE_URL) ||
    'https://api.openai.com/v1';
  const model =
    pickProviderValue(process.env.LLM_MODEL, process.env.OPENAI_MODEL) ||
    (preferProjectLlmConfig || !firstConfigured(process.env.OPENAI_API_KEY)
      ? 'gpt-4o-mini'
      : 'gpt-4.1-mini');

  const routerModel = pickProviderValue(
    process.env.LLM_ROUTER_MODEL,
    process.env.OPENAI_ROUTER_MODEL
  );

  return {
    apiKey,
    baseUrl,
    model,
    ...(routerModel ? { routerModel } : {}),
    modelReasoningEffort:
      pickProviderValue(process.env.LLM_REASONING_EFFORT, process.env.OPENAI_REASONING_EFFORT) ||
      'medium',
    maxContext: normalizeNumber(process.env.LLM_MAX_CONTEXT, 1_000_000),
    providerName: deriveProviderName(baseUrl),
    wireApi: normalizeWireApi(pickProviderValue(process.env.LLM_WIRE_API, process.env.OPENAI_WIRE_API)),
    timeoutMs: normalizeNumber(
      pickProviderValue(process.env.LLM_TIMEOUT_MS, process.env.OPENAI_TIMEOUT_MS),
      600000
    ),
    stream: normalizeBoolean(
      pickProviderValue(process.env.LLM_STREAM, process.env.OPENAI_STREAM),
      false
    ),
    chatThinkingType: pickProviderValue(
      process.env.LLM_CHAT_THINKING_TYPE,
      process.env.OPENAI_CHAT_THINKING_TYPE
    ),
  };
}
