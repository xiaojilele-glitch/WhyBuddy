import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { V5CapabilityId } from "@shared/blueprint/contracts";

export type OrchestratePlanFallbackReason =
  | "no_api_key"
  | "llm_error"
  | "empty_response"
  | "invalid_proposal";

export type OrchestratePlanRequest = {
  state: V5SessionState;
  turnId: string;
  userText: string;
  intervention?: { intent?: string; targetArtifactId?: string; targetDecisionId?: string } | null;
};

export type OrchestratePlanResponse = {
  selected: Array<{ capabilityId: V5CapabilityId; roleId: string; why?: string }>;
  rationale: string;
  source: "llm" | "heuristic_fallback";
  /** Mechanical convergence (empty selected + converged true) — still a valid llm response. */
  converged?: boolean;
  dropped?: Array<{ capabilityId: string; reason: string }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
  };
  reason?: OrchestratePlanFallbackReason;
};

/** Server orchestrate LLM cap is 30s — client must wait longer than that + network. */
const DEFAULT_TIMEOUT_MS = 40_000;

export async function fetchOrchestratePlan(
  req: OrchestratePlanRequest,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<OrchestratePlanResponse | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options?.signal;
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch("/api/whybuddy/orchestrate-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as OrchestratePlanResponse;
    if (!body || !Array.isArray(body.selected)) return null;
    // F0.1 / task 2.3: preserve LLM convergence signals (source=llm, empty selected).
    if (body.source === "llm" && body.converged === true && body.selected.length === 0) {
      return body;
    }
    if (body.selected.length === 0) return null;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}