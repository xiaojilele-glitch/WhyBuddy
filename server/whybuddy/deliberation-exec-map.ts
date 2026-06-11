/**
 * R2: Route V5 deliberation capabilities to brainstorm mini-sessions.
 */

import crypto from "node:crypto";

import type { V5CapabilityId } from "../../shared/blueprint/contracts.js";
import type {
  AdjudicationResult,
  BrainstormRoleId,
  BrainstormTopology,
  Critique,
  Rebuttal,
  SynthesisResult,
} from "../../shared/blueprint/brainstorm-contracts.js";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import {
  mapV5RoleToBrainstorm,
  resolveCritiqueTargetRole,
} from "../../shared/blueprint/whybuddy-role-map.js";
import { getAIConfig } from "../core/ai-config.js";
import { callLLM } from "../core/llm-client.js";
import { createAdjudicator } from "../routes/blueprint/brainstorm/adjudicator.js";
import {
  executeDeliberation,
  parseCritique,
  parseRebuttal,
  type StructuredCritiqueCaller,
  type StructuredRebuttalCaller,
} from "../routes/blueprint/brainstorm/deliberation-protocol.js";
import type { LLMCallerFn } from "../routes/blueprint/brainstorm/orchestrator.js";
import { createPoolBackedBrainstormCaller } from "../routes/blueprint/brainstorm/pool-llm-caller.js";
import { BrainstormSynthesizer } from "../routes/blueprint/brainstorm/synthesizer.js";
import { auditSynthesis } from "../routes/blueprint/brainstorm/synthesis-audit.js";
import {
  buildMiniSession,
  buildStageContext,
  extractUpstreamClaim,
  newCritiqueId,
  noopEmitEvent,
  seedTargetMemberOutput,
} from "./mini-session.js";

export type DeliberationExecutorResult = {
  title: string;
  summary: string;
  content: string;
  payload?: unknown;
  provenance?: "llm" | "ai_generated" | "llm_fallback";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
  };
  degraded?: boolean;
  degradedReason?: string;
};

export type DeliberationExecArgs = {
  capabilityId: V5CapabilityId;
  state: V5SessionState;
  inputArtifactIds?: string[];
  roleId?: string;
  turnId: string;
  deliberationMaxRounds?: number;
  targetRoleId?: string;
};

const DELIBERATION_CAPABILITIES = new Set<V5CapabilityId>([
  "counter.argue",
  "critique.generate",
  "rebuttal.resolve",
  "synthesis.merge",
]);

export function isDeliberationCapability(id: string): boolean {
  return DELIBERATION_CAPABILITIES.has(id as V5CapabilityId);
}

function clampRounds(raw: number | undefined): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 1;
  return Math.max(1, Math.min(3, n));
}

function buildCritiquePrompt(
  challengerRoleId: BrainstormRoleId,
  targetRoleId: BrainstormRoleId,
  targetClaim: string,
  stageContext: string
): string {
  return (
    `You are the "${challengerRoleId}" agent. Critically review this specific ` +
    `claim made by the "${targetRoleId}" agent:\n\n` +
    `Claim: "${targetClaim}"\n\n` +
    `Stage context:\n${stageContext}\n\n` +
    `Challenge the claim where it is weak, risky, or unsupported. Respond with ` +
    `a JSON object matching this exact schema:\n` +
    `{\n` +
    `  "critique": "your specific critique of the claim",\n` +
    `  "severity": "low" | "medium" | "high"\n` +
    `}\n` +
    `Please respond in Chinese.`
  );
}

function buildRebuttalPrompt(
  critique: { challengerRoleId: BrainstormRoleId; critique: string },
  responderClaim: string
): string {
  return (
    `The "${critique.challengerRoleId}" agent critiqued your claim:\n\n` +
    `Your claim: "${responderClaim}"\n` +
    `Their critique: "${critique.critique}"\n\n` +
    `Respond to the critique. Either concede the point or defend your claim. ` +
    `Respond with a JSON object matching this exact schema:\n` +
    `{\n` +
    `  "rebuttal": "your response to the critique",\n` +
    `  "stance": "concede" | "defend"\n` +
    `}\n` +
    `Please respond in Chinese.`
  );
}

function buildMemberPrompt(roleId: BrainstormRoleId, context: string): string {
  return (
    `You are the "${roleId}" agent in a WhyBuddy deliberation mini-session.\n\n` +
    `${context}\n\n` +
    `State your position in 2-4 concise sentences. Please respond in Chinese.`
  );
}

type UsageTracker = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

function createLlmCallers(): {
  auxCaller: LLMCallerFn;
  primaryCaller: LLMCallerFn;
  usage: UsageTracker;
} {
  const config = getAIConfig();
  const usage: UsageTracker = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    model: config.model,
  };

  const wrap = (caller: (prompt: string) => Promise<{ content: string; usage?: any }>): LLMCallerFn => {
    return async (prompt: string) => {
      const res = await caller(prompt);
      const inTok = res.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4);
      const outTok = res.usage?.completion_tokens ?? Math.ceil(res.content.length / 4);
      const total = res.usage?.total_tokens ?? inTok + outTok;
      usage.inputTokens += inTok;
      usage.outputTokens += outTok;
      usage.totalTokens += total;
      return res.content;
    };
  };

  const primaryRaw = async (prompt: string) =>
    callLLM([{ role: "user", content: prompt }], {
      model: config.model,
      temperature: 0.25,
      timeoutMs: Math.min(config.timeoutMs, 120_000),
    });

  const primaryCaller = wrap(primaryRaw);
  const poolCaller = createPoolBackedBrainstormCaller();
  const auxCaller = poolCaller ? wrap(async (prompt) => ({ content: await poolCaller(prompt, {}) })) : primaryCaller;

  return { auxCaller, primaryCaller, usage };
}

function toExecutorUsage(usage: UsageTracker): DeliberationExecutorResult["usage"] {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    model: usage.model,
  };
}

function buildCritiqueTopology(
  challenger: BrainstormRoleId,
  target: BrainstormRoleId,
  maxRounds: number
): BrainstormTopology {
  return {
    name: "whybuddy-mini",
    participants: [challenger, target].filter((r, i, a) => a.indexOf(r) === i),
    critiqueEdges: [{ challenger, target }],
    synthesizerRoleId: "decider",
    minRounds: 1,
    maxRounds,
  };
}

function renderCritiques(critiques: Critique[]): string {
  if (critiques.length === 0) {
    return "本轮未产生结构化质疑。";
  }
  return critiques
    .map(
      (c) =>
        `[${c.severity}] ${c.challengerRoleId}→${c.targetRoleId}: ${c.targetClaim}\n— ${c.critique}`
    )
    .join("\n\n");
}

function renderRebuttalBundle(
  rebuttals: Rebuttal[],
  adjudication: AdjudicationResult
): string {
  const rebText =
    rebuttals.length === 0
      ? "（无结构化反驳）"
      : rebuttals
          .map((r) => `[${r.stance}] ${r.responderRoleId}: ${r.rebuttal}`)
          .join("\n");
  return (
    `${rebText}\n\n` +
    `裁决：${adjudication.consensusReached ? "已收敛" : "未收敛"} ` +
    `(分数 ${adjudication.convergenceScore.toFixed(2)})\n` +
    `${adjudication.rationale}`
  );
}

function renderSynthesis(result: SynthesisResult, auditStatus: string): string {
  const points = result.reasoningPoints.map((p) => `· [${p.roleId}] ${p.point}`).join("\n");
  return `${result.decision}\n\n要点：\n${points}\n\n审计：${auditStatus}`;
}

function parseUpstreamCritiques(
  state: V5SessionState,
  inputArtifactIds: string[]
): Critique[] {
  const arts: any[] = (state as any)?.artifacts || [];
  const byId = new Map(arts.map((a) => [a.id, a]));
  const ids = inputArtifactIds.length > 0 ? inputArtifactIds : arts.map((a) => a.id).reverse();

  for (const id of ids) {
    const art = byId.get(id);
    if (!art?.payload) continue;
    const payload = art.payload;
    if (Array.isArray(payload)) {
      return payload.filter((c) => c && typeof c.critique === "string") as Critique[];
    }
    if (payload?.critiques && Array.isArray(payload.critiques)) {
      return payload.critiques.filter((c: any) => c && typeof c.critique === "string");
    }
  }
  return [];
}

function ruleRebuttalMissingUpstream(
  state: V5SessionState,
  inputArtifactIds: string[]
): DeliberationExecutorResult {
  return {
    title: "反驳消解（规则推演）",
    summary: "缺少上游结构化质疑，未启动审议协议。",
    content: `本轮未找到可消解的 Critique（inputArtifactIds=${inputArtifactIds.join(",") || "∅"}）。请先有 counter.argue / critique.generate 产物。`,
    provenance: "ai_generated",
    degraded: true,
    degradedReason: "missing_upstream_critique",
  };
}

async function runCritiqueSession(args: {
  state: V5SessionState;
  turnId: string;
  challengerBs: BrainstormRoleId;
  targetBs: BrainstormRoleId;
  claimText: string;
  maxRounds: number;
  titlePrefix: string;
}): Promise<DeliberationExecutorResult> {
  const goalText = String((args.state as any)?.goal?.text || "");
  const stageContext = buildStageContext(goalText, args.claimText);
  const session = buildMiniSession({
    turnId: args.turnId,
    challengerRole: args.challengerBs,
    targetRole: args.targetBs,
    stageContext,
  });

  const { auxCaller, primaryCaller, usage } = createLlmCallers();
  const collectedCritiques: Critique[] = [];

  const critiqueCaller: StructuredCritiqueCaller = async ({
    challengerRoleId,
    target,
    stageContext: ctx,
  }) => {
    const targetClaim = target.claims.find((c) => typeof c === "string" && c.trim().length > 0);
    if (!targetClaim) return null;
    const prompt = buildCritiquePrompt(challengerRoleId, target.roleId, targetClaim, ctx);
    const raw = await auxCaller(prompt, {});
    const parsed = parseCritique(raw, {
      id: newCritiqueId(),
      challengerRoleId,
      targetRoleId: target.roleId,
      targetClaim,
      roundNumber: 1,
    });
    if (parsed) collectedCritiques.push(parsed);
    return parsed;
  };

  const rebuttalCaller: StructuredRebuttalCaller = async ({ critique, responderClaim }) => {
    const prompt = buildRebuttalPrompt(critique, responderClaim);
    const raw = await auxCaller(prompt, {});
    return parseRebuttal(raw, {
      id: crypto.randomUUID(),
      responderRoleId: critique.targetRoleId,
      challengeId: critique.id,
      roundNumber: critique.roundNumber,
    });
  };

  const adjudicator = createAdjudicator(primaryCaller);
  const topology = buildCritiqueTopology(args.challengerBs, args.targetBs, args.maxRounds);

  seedTargetMemberOutput(session, args.targetBs, args.claimText);

  const result = await executeDeliberation({
    session,
    stageContext,
    emitEvent: noopEmitEvent(),
    config: { minRounds: 1, maxRounds: args.maxRounds },
    topology,
    critiqueCaller,
    rebuttalCaller,
    adjudicator,
    executeMember: async (member, context) => {
      if (member.roleId === args.targetBs && member.output?.content) {
        member.state = "completed";
        return;
      }
      try {
        const raw = await auxCaller(buildMemberPrompt(member.roleId, context), {});
        member.state = "completed";
        member.output = {
          content: raw,
          confidence: 0.75,
          toolInvocations: [],
          tokenUsage: Math.ceil(raw.length / 4),
        };
        session.tokenUsed += member.output.tokenUsage;
      } catch {
        member.state = "failed";
        member.failureReason = "member_execution_failed";
      }
    },
  });

  const degraded = collectedCritiques.length === 0 || result.rounds.length === 0;
  const provenance: DeliberationExecutorResult["provenance"] = degraded ? "llm_fallback" : "llm";

  return {
    title: `${args.titlePrefix}: ${args.challengerBs}→${args.targetBs}`,
    summary: degraded
      ? "审议降级或未产生有效质疑"
      : `${collectedCritiques.length} 条结构化质疑`,
    content: renderCritiques(collectedCritiques),
    payload: collectedCritiques,
    provenance,
    usage: toExecutorUsage(usage),
    degraded: degraded || undefined,
    degradedReason: degraded ? "no_structured_critiques" : undefined,
  };
}

async function runRebuttalResolve(args: {
  state: V5SessionState;
  turnId: string;
  inputArtifactIds: string[];
  maxRounds: number;
}): Promise<DeliberationExecutorResult> {
  const critiques = parseUpstreamCritiques(args.state, args.inputArtifactIds);
  if (critiques.length === 0) {
    return ruleRebuttalMissingUpstream(args.state, args.inputArtifactIds);
  }

  const goalText = String((args.state as any)?.goal?.text || "");
  const stageContext = buildStageContext(
    goalText,
    critiques.map((c) => c.targetClaim).join(" | ")
  );

  const roles = new Set<BrainstormRoleId>();
  for (const c of critiques) {
    roles.add(c.challengerRoleId);
    roles.add(c.targetRoleId);
  }
  const session = buildMiniSession({
    turnId: args.turnId,
    challengerRole: critiques[0].challengerRoleId,
    targetRole: critiques[0].targetRoleId,
    stageContext,
  });
  for (const roleId of roles) {
    if (!session.crewMembers.has(roleId)) {
      session.crewMembers.set(roleId, {
        roleId,
        state: "completed",
        iterationCount: 0,
        maxIterations: 3,
        tokenUsage: 0,
      });
    }
  }

  const { auxCaller, primaryCaller, usage } = createLlmCallers();
  const rebuttalCaller: StructuredRebuttalCaller = async ({ critique, responderClaim }) => {
    const prompt = buildRebuttalPrompt(critique, responderClaim);
    const raw = await auxCaller(prompt, {});
    return parseRebuttal(raw, {
      id: crypto.randomUUID(),
      responderRoleId: critique.targetRoleId,
      challengeId: critique.id,
      roundNumber: critique.roundNumber || 1,
    });
  };
  const adjudicator = createAdjudicator(primaryCaller);

  const rebuttals: Rebuttal[] = [];
  for (const critique of critiques) {
    const rebuttal = await rebuttalCaller({
      critique,
      responderClaim: critique.targetClaim,
    });
    if (rebuttal) {
      rebuttals.push({ ...rebuttal, challengeId: critique.id });
    }
  }

  const adjudication = await adjudicator({
    critiques,
    rebuttals,
    roundNumber: 1,
  });

  return {
    title: "反驳消解",
    summary: adjudication.consensusReached
      ? `已收敛（${adjudication.convergenceScore.toFixed(2)}）`
      : `未收敛（${adjudication.unresolvedCritiqueIds.length} 条未解）`,
    content: renderRebuttalBundle(rebuttals, adjudication),
    payload: { rebuttals, adjudication },
    provenance: "llm",
    usage: toExecutorUsage(usage),
  };
}

async function runSynthesisMerge(args: {
  state: V5SessionState;
  turnId: string;
  inputArtifactIds: string[];
  roleId?: string;
}): Promise<DeliberationExecutorResult> {
  const goalText = String((args.state as any)?.goal?.text || "");
  const claim = extractUpstreamClaim(args.state, args.inputArtifactIds) || goalText;
  const stageContext = buildStageContext(goalText, claim);

  const synthesizerRole = mapV5RoleToBrainstorm(args.roleId || "综合");
  const session = buildMiniSession({
    turnId: args.turnId,
    challengerRole: "architect",
    targetRole: synthesizerRole,
    stageContext,
  });

  const arts: any[] = (args.state as any)?.artifacts || [];
  const crewOutputs = (args.inputArtifactIds.length > 0
    ? args.inputArtifactIds.map((id) => arts.find((a) => a.id === id)).filter(Boolean)
    : arts.slice(-6)
  ).map((art: any, idx: number) => ({
    roleId: (["architect", "auditor", "decider"] as BrainstormRoleId[])[idx % 3],
    content: artifactClaimText(art),
    confidence: 0.8,
  }));

  if (crewOutputs.length === 0) {
    crewOutputs.push({
      roleId: synthesizerRole,
      content: claim,
      confidence: 0.8,
    });
  }

  const { primaryCaller, usage } = createLlmCallers();
  const synthesizer = new BrainstormSynthesizer(primaryCaller, noopEmitEvent());

  const synthesis = await synthesizer.synthesize({
    sessionId: session.id,
    mode: "discussion",
    crewOutputs,
    stageContext,
  });

  session.synthesisResult = synthesis;
  const audit = await auditSynthesis({
    synthesis,
    session,
    primaryCaller,
  });

  return {
    title: "综合结论",
    summary: synthesis.decision.slice(0, 120),
    content: renderSynthesis(synthesis, audit.status),
    payload: { synthesis, audit },
    provenance: "llm",
    usage: toExecutorUsage(usage),
  };
}

function artifactClaimText(art: { content?: string; summary?: string; title?: string }): string {
  return String(art.content || art.summary || art.title || "").trim();
}

export async function executeDeliberationCapabilityMapped(
  args: DeliberationExecArgs
): Promise<DeliberationExecutorResult> {
  const maxRounds = clampRounds(args.deliberationMaxRounds);
  const goalText = String((args.state as any)?.goal?.text || "");
  const inputArtifactIds = args.inputArtifactIds || [];

  if (args.capabilityId === "counter.argue") {
    const challengerBs = mapV5RoleToBrainstorm(args.roleId || "挑刺");
    const targetBs = resolveCritiqueTargetRole(challengerBs, args.targetRoleId);
    const claim = extractUpstreamClaim(args.state, inputArtifactIds) || goalText;
    return runCritiqueSession({
      state: args.state,
      turnId: args.turnId,
      challengerBs,
      targetBs,
      claimText: claim,
      maxRounds,
      titlePrefix: "反驳论证",
    });
  }

  if (args.capabilityId === "critique.generate") {
    const challengerBs: BrainstormRoleId = "auditor";
    const targetBs = resolveCritiqueTargetRole(challengerBs, args.targetRoleId);
    const claim = extractUpstreamClaim(args.state, inputArtifactIds) || goalText;
    return runCritiqueSession({
      state: args.state,
      turnId: args.turnId,
      challengerBs,
      targetBs,
      claimText: claim,
      maxRounds,
      titlePrefix: "结构化质疑",
    });
  }

  if (args.capabilityId === "rebuttal.resolve") {
    return runRebuttalResolve({
      state: args.state,
      turnId: args.turnId,
      inputArtifactIds,
      maxRounds,
    });
  }

  if (args.capabilityId === "synthesis.merge") {
    return runSynthesisMerge({
      state: args.state,
      turnId: args.turnId,
      inputArtifactIds,
      roleId: args.roleId,
    });
  }

  throw new Error(`Unsupported deliberation capability: ${args.capabilityId}`);
}