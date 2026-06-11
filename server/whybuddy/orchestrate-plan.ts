import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import type { V5CapabilityId } from "../../shared/blueprint/contracts.js";
import { ALL_V5_CAPABILITIES } from "../../shared/blueprint/contracts.js";
import { CAPABILITY_DESCRIPTIONS } from "../../shared/blueprint/whybuddy-capability-catalog.js";
import { pickNextCapabilities } from "../../shared/blueprint/whybuddy-pick-heuristic.js";
import {
  validateProposedPlan,
  type DropReason,
} from "../../shared/blueprint/whybuddy-plan-validation.js";
import { getAIConfig } from "../core/ai-config.js";
import { callLLMJsonWithUsage } from "../core/llm-client.js";

export type OrchestratePlanFallbackReason =
  | "no_api_key"
  | "llm_error"
  | "empty_response"
  | "invalid_proposal";

export type OrchestratePlanRequest = {
  state: V5SessionState;
  turnId: string;
  userText: string;
  intervention?: {
    intent?: string;
    targetArtifactId?: string;
    targetDecisionId?: string;
  } | null;
};

export type OrchestratePlanResponse = {
  selected: Array<{ capabilityId: V5CapabilityId; roleId: string; why?: string }>;
  rationale: string;
  source: "llm" | "heuristic_fallback";
  dropped?: Array<{ capabilityId: string; reason: DropReason }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
  };
  reason?: OrchestratePlanFallbackReason;
};

function healthyArtifactKinds(state: V5SessionState): string[] {
  const stales = new Set(state.staleArtifactIds || []);
  const kinds = new Set<string>();
  for (const a of state.artifacts || []) {
    if (
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") &&
      !stales.has(a.id)
    ) {
      kinds.add(a.kind);
    }
  }
  return Array.from(kinds);
}

function recentChoseCaps(state: V5SessionState): string[] {
  const ledger = state.decisionLedger || [];
  return ledger
    .slice(-4)
    .flatMap((d) => d.chose || []);
}

function budgetSummary(state: V5SessionState): {
  turns: number;
  runs: number;
  remainingTurns: number;
  remainingRuns: number;
  estimatedTokens: number;
} {
  const runs = state.capabilityRuns || [];
  const turnIds = new Set(runs.map((r) => r.turnId).filter(Boolean));
  const maxTurns = 30;
  const maxRuns = 120;
  const costs = state.costLedger || [];
  const estimatedTokens = costs.reduce((s, c) => s + (c.estimatedTokens || 0), 0);
  return {
    turns: turnIds.size,
    runs: runs.length,
    remainingTurns: Math.max(0, maxTurns - turnIds.size),
    remainingRuns: Math.max(0, maxRuns - runs.length),
    estimatedTokens,
  };
}

function buildCapabilityCatalogBlock(): string {
  return ALL_V5_CAPABILITIES.map(
    (id) => `- ${id}: ${CAPABILITY_DESCRIPTIONS[id]}`
  ).join("\n");
}

function buildOrchestrateSystemPrompt(): string {
  return (
    "You are WhyBuddy V5's orchestration planner (ORCH). " +
    "Given session state and user input, propose 1-4 capability actions for this turn. " +
    "Return ONLY a JSON object (no markdown fences) with exactly:\n" +
    '{"selected":[{"capabilityId":"...","roleId":"...","why":"..."}],"rationale":"..."}\n' +
    "Rules: use only capability ids from the provided catalog; 1-4 items; roleId must be a V5 role; " +
    "why is optional but encouraged when repeating or prioritizing a capability."
  );
}

function buildOrchestrateUserPrompt(req: OrchestratePlanRequest): string {
  const { state, userText, intervention } = req;
  const goal = state.goal?.text || "";
  const goalStatus = state.goal?.status || "unknown";
  const staleIds = state.staleArtifactIds || [];
  const healthyKinds = healthyArtifactKinds(state);
  const recentChose = recentChoseCaps(state);
  const budget = budgetSummary(state);
  const openQ = (state.openQuestions || []).length;

  const interventionNote =
    intervention?.intent === "challenge"
      ? "INTERVENTION: user challenged prior conclusions — stale artifacts withdrawn; prefer re-convergence (e.g. risk/report) where gaps exist.\n"
      : intervention?.intent
        ? `INTERVENTION: ${intervention.intent}\n`
        : "";

  return (
    `${interventionNote}` +
    `GOAL: ${goal}\nGOAL_STATUS (mechanical): ${goalStatus}\n` +
    `USER_TEXT: ${userText}\n` +
    `HEALTHY_ARTIFACT_KINDS: ${healthyKinds.join(", ") || "(none)"}\n` +
    `STALE_COUNT: ${staleIds.length}\n` +
    `OPEN_QUESTIONS: ${openQ}\n` +
    `RECENT_DLEDGER_CHOSE (soft avoid): ${recentChose.join(", ") || "(none)"}\n` +
    `BUDGET: turns_used=${budget.turns} runs=${budget.runs} est_tokens=${budget.estimatedTokens} ` +
    `remaining_turns≈${budget.remainingTurns} remaining_runs≈${budget.remainingRuns}\n\n` +
    `CAPABILITY_CATALOG:\n${buildCapabilityCatalogBlock()}`
  );
}

function heuristicFallback(
  req: OrchestratePlanRequest,
  reason: OrchestratePlanFallbackReason
): OrchestratePlanResponse {
  const userText = req.userText || req.state.goal?.text || "";
  const selected = pickNextCapabilities(req.state, userText);
  return {
    selected,
    rationale: `heuristic_fallback (${reason}) for: ${userText.slice(0, 80)}`,
    source: "heuristic_fallback",
    reason,
  };
}

export async function executeOrchestratePlan(
  req: OrchestratePlanRequest
): Promise<OrchestratePlanResponse> {
  const config = getAIConfig();
  if (!config.apiKey) {
    console.warn("[whybuddy] /orchestrate-plan fallback: no_api_key");
    return heuristicFallback(req, "no_api_key");
  }

  try {
    const { json, usage } = await callLLMJsonWithUsage<{
      selected?: Array<{ capabilityId?: string; roleId?: string; why?: string }>;
      rationale?: string;
    }>(
      [
        { role: "system", content: buildOrchestrateSystemPrompt() },
        { role: "user", content: buildOrchestrateUserPrompt(req) },
      ],
      {
        model: config.model,
        temperature: 0.2,
        timeoutMs: Math.min(config.timeoutMs, 12_000),
        retryAttempts: 1,
      } as any
    );

    const rationale = String(json?.rationale || "").trim();
    const validated = validateProposedPlan(
      { selected: json?.selected, rationale },
      req.state
    );

    if (!validated.valid || validated.selected.length === 0) {
      console.warn("[whybuddy] /orchestrate-plan fallback: invalid_proposal");
      const fb = heuristicFallback(req, "invalid_proposal");
      return { ...fb, dropped: validated.dropped };
    }

    if (!rationale) {
      console.warn("[whybuddy] /orchestrate-plan fallback: empty_response");
      const fb = heuristicFallback(req, "empty_response");
      return { ...fb, dropped: validated.dropped };
    }

    return {
      selected: validated.selected,
      rationale,
      source: "llm",
      ...(validated.dropped.length ? { dropped: validated.dropped } : {}),
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            model: config.model,
          }
        : undefined,
    };
  } catch (e: any) {
    console.warn(
      "[whybuddy] /orchestrate-plan fallback: llm_error —",
      String(e?.message || e).slice(0, 200)
    );
    return heuristicFallback(req, "llm_error");
  }
}