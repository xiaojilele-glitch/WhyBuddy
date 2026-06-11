import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import {
  buildFallbackNarration,
  type SkippedCapabilitySummary,
} from "@shared/blueprint/whybuddy-deliverable-sanitize";

export type NarrationFallbackReason =
  | "no_api_key"
  | "llm_error"
  | "empty_response"
  | "hijacked"
  | "http_error"
  | "network_error"
  | "invalid_response";

export type NarrationRequest = {
  state: V5SessionState;
  turnId: string;
  userText: string;
  intervention?: { intent?: string } | null;
  selected?: Array<{ capabilityId?: string; roleId?: string }>;
  artifacts?: Array<{ kind?: string; title?: string; summary?: string; realLlm?: boolean }>;
  mainArtifact?: { kind?: string; title?: string; content?: string } | null;
  goalStatusBefore?: string;
  planReason?: string | null;
  skipped?: SkippedCapabilitySummary[];
};

export type NarrationResponse = {
  text: string;
  source: "llm" | "fallback";
  reason?: NarrationFallbackReason;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
  };
};

const FALLBACK_REASON_LABELS: Record<NarrationFallbackReason, string> = {
  no_api_key: "未配置 LLM_API_KEY / OPENAI_API_KEY，叙述服务未调用模型",
  llm_error: "叙述模型调用失败，已降级为模板回复",
  empty_response: "叙述模型返回空内容，已降级为模板回复",
  hijacked: "叙述检测到模型身份劫持，已降级为模板回复",
  http_error: "叙述服务 HTTP 错误，已使用本地模板",
  network_error: "无法连接叙述服务，已使用本地模板",
  invalid_response: "叙述服务响应无效，已使用本地模板",
};

export function narrationFallbackHint(reason?: NarrationFallbackReason): string | undefined {
  if (!reason) return undefined;
  return FALLBACK_REASON_LABELS[reason];
}

function localNarrationFallback(
  req: NarrationRequest,
  reason: NarrationFallbackReason
): NarrationResponse {
  const text = buildFallbackNarration({
    userText: req.userText,
    goalStatus: req.state.goal?.status as any,
    goalStatusBefore: req.goalStatusBefore as any,
    selectedCount: req.selected?.length ?? 0,
    interventionIntent: req.intervention?.intent,
    mainArtifactContent: req.mainArtifact?.content || null,
    planReason: req.planReason,
    skipped: req.skipped,
    sanitizeMainArtifact: false,
    mainArtifactMaxLen: 400,
  });

  return { text, source: "fallback", reason };
}

/** Fetch user-facing narration from server; local template if unreachable (no client-side sanitizer). */
export async function fetchNarration(req: NarrationRequest): Promise<NarrationResponse> {
  try {
    const res = await fetch("/api/whybuddy/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) return localNarrationFallback(req, "http_error");
    const body = (await res.json()) as NarrationResponse;
    if (!body?.text) return localNarrationFallback(req, "invalid_response");
    return {
      text: body.text,
      source: body.source === "llm" ? "llm" : "fallback",
      reason: body.source === "fallback" ? body.reason : undefined,
      usage: body.usage,
    };
  } catch {
    return localNarrationFallback(req, "network_error");
  }
}