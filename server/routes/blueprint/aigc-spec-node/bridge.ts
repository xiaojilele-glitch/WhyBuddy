/**
 * AIGC Spec Node capability bridge — upgrades the `aigc-spec-node` capability
 * in the sandbox derivation pipeline from templated output to a real LLM
 * domain-reasoning call, with zero-surprise fallback when the LLM is
 * unavailable / misconfigured / returning invalid data.
 *
 * Factory: `createAigcSpecNodeCapabilityBridge(ctx)` returns an async function
 * that accepts an invocation input and returns an invocation + executionMode.
 *
 * Design references:
 *   - Requirements 2.1–2.7 / 3.1–3.5 / 4.1–4.7 / 5.1–5.6 / 6.1–6.7 / 7.1–7.5
 *   - Design §4.2 / §4.6 / §4.7 / §4.8 / §5.1 / §D1 / §D10
 *
 * Hard constraints (code-review wall, per requirements 7.2 / D1):
 *   - No `import { callLLMJson } from "../../../core/llm-client.js"`
 *   - No `import { getAIConfig } from "../../../core/ai-config.js"`
 *   - No module-level `fetch()` / any HTTP client
 *   - No hard-coded model / provider / temperature defaults
 *   - All LLM capability via `ctx.llm.callJson` + `ctx.llm.getConfig`
 */

import {
  buildCapabilityInvocationLogs,
  buildCapabilityOutputSummary,
  deterministicCapabilityDuration,
} from "../../blueprint.js";
import type { BlueprintServiceContext } from "../context.js";
import {
  applyAigcNodeCapabilityRedaction,
  createDefaultAigcSpecNodeCapabilityPolicy,
  type AigcSpecNodeCapabilityPolicy,
} from "./policy.js";
import {
  buildAigcSpecNodePrompt,
  type AigcSpecNodePromptPayload,
} from "./prompt.js";
import {
  AigcSpecNodeResponseSchema,
  type AigcSpecNodeResponse,
} from "./schema.js";
import {
  buildStructuredPayloadSummary,
  deriveAigcOutputSummary,
  sha256Hex,
} from "./summary-derivation.js";
import type {
  BlueprintCapabilityInvocation,
  BlueprintClarificationSession,
  BlueprintGenerationEvent,
  BlueprintGenerationRequest,
  BlueprintRouteCandidate,
  BlueprintRouteSet,
  BlueprintRuntimeCapability,
} from "../../../../shared/blueprint/index.js";

// =============================================================================
// Public types (Task 12.1)
// =============================================================================

export interface AigcSpecNodeCapabilityBridgeInput {
  capability: BlueprintRuntimeCapability;
  route: BlueprintRouteCandidate;
  jobId: string;
  request: BlueprintGenerationRequest;
  routeSet: BlueprintRouteSet;
  clarificationSession?: BlueprintClarificationSession;
  createdAt: string;
  invocationId: string;
  roleId: string;
}

export interface AigcSpecNodeCapabilityBridgeOutput {
  invocation: BlueprintCapabilityInvocation;
  executionMode: "real" | "simulated_fallback";
  additionalEvents: BlueprintGenerationEvent[];
}

export type AigcSpecNodeCapabilityBridge = (
  input: AigcSpecNodeCapabilityBridgeInput,
) => Promise<AigcSpecNodeCapabilityBridgeOutput>;

// =============================================================================
// Factory (Task 12.2 — design §4.6 main algorithm, 7 steps)
// =============================================================================

const ENV_ENABLED = "BLUEPRINT_AIGC_NODE_CAPABILITY_BRIDGE_ENABLED";

export function createAigcSpecNodeCapabilityBridge(
  ctx: BlueprintServiceContext,
): AigcSpecNodeCapabilityBridge {
  // Tier-agnostic resolution: policy is cached once per factory invocation.
  // `ctx.aigcSpecNodeCapabilityPolicy` is typed as `unknown` at the context
  // layer (Task 2 placeholder); we narrow via defensive `as` because the
  // contract owner is *this* module. If absent, fall back to the default
  // policy so buildBlueprintServiceContext callers without Task 15 default
  // wiring still get a working bridge.
  const policy =
    (ctx.aigcSpecNodeCapabilityPolicy as
      | AigcSpecNodeCapabilityPolicy
      | undefined) ?? createDefaultAigcSpecNodeCapabilityPolicy();

  return async function bridge(
    input: AigcSpecNodeCapabilityBridgeInput,
  ): Promise<AigcSpecNodeCapabilityBridgeOutput> {
    // ---- Tier 1: bridge not enabled (design §5.1 tier 1, debug) --------------
    if (process.env[ENV_ENABLED] !== "true") {
      ctx.logger.debug(
        "aigc-spec-node bridge: not enabled, using fallback",
        { capabilityId: input.capability.id },
      );
      return buildFallbackOutput(input, { reason: "bridge not enabled" });
    }

    // ---- Tier 2: apiKey missing (design §5.1 tier 2, debug) ------------------
    // NEVER call ctx.llm.callJson when apiKey is absent — tier 2 requirement.
    const aiConfig = safeGetConfig(ctx);
    const apiKey = typeof aiConfig?.apiKey === "string" ? aiConfig.apiKey : "";
    if (apiKey.length === 0) {
      ctx.logger.debug(
        "aigc-spec-node bridge: apiKey missing, using fallback",
        { capabilityId: input.capability.id },
      );
      return buildFallbackOutput(input, { reason: "llm apiKey missing" });
    }

    // ---- Build prompt (deterministic, locale-aware) --------------------------
    // BlueprintClarificationSession does not carry a `locale` field in the
    // current contract. We default to en-US to keep behavior predictable and
    // let future locale extensions be additive. The narrow cast below is the
    // guardrail: if a future session shape grows `locale`, we pick it up
    // without changing the bridge interface.
    const sessionLocale = (
      input.clarificationSession as unknown as { locale?: string } | undefined
    )?.locale;
    const locale: "zh-CN" | "en-US" =
      sessionLocale === "zh-CN" ? "zh-CN" : "en-US";

    const prompt = buildAigcSpecNodePrompt({
      request: input.request,
      clarificationSession: input.clarificationSession,
      route: input.route,
      locale,
    });

    const model =
      typeof aiConfig?.model === "string" ? aiConfig.model : "";

    // ---- Call LLM (design §5.1 tier 3 / tier 5) ------------------------------
    const startedAt = ctx.now();
    let rawPayload: unknown;
    try {
      rawPayload = await ctx.llm.callJson(
        [
          { role: "system", content: prompt.systemMessage },
          { role: "user", content: prompt.userMessage },
        ],
        {
          model,
          temperature: policy.temperature,
          timeoutMs: policy.maxInvocationTimeoutMs,
          retryAttempts: policy.callJsonRetryAttempts,
          sessionId:
            input.clarificationSession?.id ??
            input.request.clarificationSessionId,
        },
      );
    } catch (error) {
      const errMsg = errorMessage(error);
      const isTimeout = /abort|timeout/i.test(errMsg);
      ctx.logger.warn(
        "aigc-spec-node bridge: llm callJson threw, using fallback",
        { promptId: prompt.promptId, error: errMsg },
      );
      return buildFallbackOutput(input, {
        reason: isTimeout
          ? "llm timeout"
          : `llm callJson threw: ${truncate(errMsg, 300)}`,
        promptId: prompt.promptId,
        model,
      });
    }

    // ---- Tier 3: non-JSON / undefined / null / non-object --------------------
    if (
      rawPayload === undefined ||
      rawPayload === null ||
      typeof rawPayload !== "object"
    ) {
      ctx.logger.warn(
        "aigc-spec-node bridge: non-json response, using fallback",
        { promptId: prompt.promptId },
      );
      return buildFallbackOutput(input, {
        reason: "non-json response",
        promptId: prompt.promptId,
        model,
      });
    }

    // ---- Tier 4: schema validation fails (design §5.1 tier 4) ----------------
    const parsed = AigcSpecNodeResponseSchema.safeParse(rawPayload);
    if (!parsed.success) {
      ctx.logger.warn(
        "aigc-spec-node bridge: schema validation failed, using fallback",
        { promptId: prompt.promptId, errorMsg: parsed.error.message },
      );
      return buildFallbackOutput(input, {
        reason: `schema validation failed: ${truncate(parsed.error.message, 300)}`,
        promptId: prompt.promptId,
        model,
      });
    }

    // ---- Happy path: build real invocation (design §4.7) ---------------------
    const completedAt = ctx.now();
    const durationMs = Math.max(
      0,
      completedAt.getTime() - startedAt.getTime(),
    );
    return buildRealOutput({
      input,
      policy,
      prompt,
      model,
      validated: parsed.data,
      rawPayload,
      durationMs,
      locale,
    });
  };
}

// =============================================================================
// Real-path output construction (Task 12.3 — design §4.7)
// =============================================================================

function buildRealOutput(args: {
  input: AigcSpecNodeCapabilityBridgeInput;
  policy: AigcSpecNodeCapabilityPolicy;
  prompt: AigcSpecNodePromptPayload;
  model: string;
  validated: AigcSpecNodeResponse;
  rawPayload: unknown;
  durationMs: number;
  locale: "zh-CN" | "en-US";
}): AigcSpecNodeCapabilityBridgeOutput {
  const {
    input,
    policy,
    prompt,
    model,
    validated,
    rawPayload,
    durationMs,
    locale,
  } = args;

  // ---- Digests (Task 12.6) --------------------------------------------------
  // canonicalPayloadJson serialises only schema-declared fields (zod already
  // stripped unknown top-level keys), giving a stable digest that survives
  // forward-compatible prompt version bumps.
  const canonicalPayloadJson = JSON.stringify(validated);
  const structuredPayloadDigest = `sha256:${sha256Hex(canonicalPayloadJson)}`;
  const structuredPayloadByteSize = Buffer.byteLength(
    canonicalPayloadJson,
    "utf8",
  );
  // responseDigest covers the *raw* LLM response (including fields zod will
  // later discard) so auditors can distinguish "LLM returned extras" vs
  // "payload was exactly minimal" without persisting originals.
  const responseDigest = `sha256:${sha256Hex(JSON.stringify(rawPayload))}`;

  // ---- Derived summary (defensively redacted) ------------------------------
  const rawSummary = deriveAigcOutputSummary(validated, { locale });
  const outputSummary = applyAigcNodeCapabilityRedaction(rawSummary, policy);
  const structuredPayloadSummary = applyAigcNodeCapabilityRedaction(
    buildStructuredPayloadSummary(validated, policy),
    policy,
  );

  // ---- Logs — metadata only, never raw prompt / response (Task 12.7) --------
  const logLines = [
    `promptId=${prompt.promptId}`,
    `promptFingerprint=${prompt.promptFingerprint}`,
    `model=${model}`,
    `responseDigest=${responseDigest}`,
    `structuredPayloadDigest=${structuredPayloadDigest}`,
    `subsystems=${validated.subsystems.length}`,
    `riskNotes=${validated.riskNotes.length}`,
    ...(typeof validated.confidence === "number"
      ? [`confidence=${validated.confidence.toFixed(2)}`]
      : []),
  ].map((line) => applyAigcNodeCapabilityRedaction(line, policy));
  const logs = truncateLogs(logLines, policy.maxLogLines, policy.maxLogBytes);

  const invocationInput = `Derive route candidate ${input.route.title} with ${input.capability.label}.`;

  const invocation: BlueprintCapabilityInvocation = {
    id: input.invocationId,
    jobId: input.jobId,
    capabilityId: input.capability.id,
    roleId: input.roleId,
    capabilityLabel: input.capability.label,
    kind: input.capability.kind,
    status: "completed",
    securityLevel: input.capability.securityLevel,
    safetyGate: {
      status: "allowed",
      reason: `${input.capability.label} approved for real LLM execution via ctx.llm.callJson.`,
      requiresApproval: input.capability.requiresApproval,
      approved: input.capability.requiresApproval,
      securityLevel: input.capability.securityLevel,
    },
    requestedAt: input.createdAt,
    completedAt: new Date().toISOString(),
    requestedBy: "aigc-spec-node-capability-bridge",
    routeId: input.route.id,
    input: invocationInput,
    outputSummary,
    logs,
    evidenceIds: [],
    durationMs,
    provenance: {
      jobId: input.jobId,
      projectId: input.request.projectId,
      sourceId: input.request.sourceId,
      routeSetId: input.routeSet.id,
      routeId: input.route.id,
      roleId: input.roleId,
      targetText: input.request.targetText,
      githubUrls: input.request.githubUrls ?? [],
      executionMode: "real",
      promptId: prompt.promptId,
      model,
      responseDigest,
      structuredPayloadDigest,
      promptFingerprint: prompt.promptFingerprint,
      // `error` is intentionally absent on the real path per requirement 5.2.
      // `tokenCount` stays undefined — the current callLLMJson wrapper does
      // not expose usage. Task 18 may surface this via a callJson option bump
      // but is out of scope here.
    },
  };

  // Task 18 will read `__aigcStructuredPayloadRef` from the outer
  // buildCapabilityEvidence to materialise `evidence.provenance.structuredPayload`
  // without recomputing the payload JSON. Stashing it as a non-declared side
  // field keeps the public BlueprintCapabilityInvocation type untouched and
  // avoids leaking the summary/byteSize into downstream normalizers that
  // don't know to expect it.
  Object.assign(
    invocation as unknown as {
      __aigcStructuredPayloadRef?: {
        digest: string;
        byteSize: number;
        summary: string;
      };
    },
    {
      __aigcStructuredPayloadRef: {
        digest: structuredPayloadDigest,
        byteSize: structuredPayloadByteSize,
        summary: structuredPayloadSummary,
      },
    },
  );

  return { executionMode: "real", additionalEvents: [], invocation };
}

// =============================================================================
// Fallback-path output construction (Task 12.4 — design §4.8)
// =============================================================================

function buildFallbackOutput(
  input: AigcSpecNodeCapabilityBridgeInput,
  options: { reason: string; promptId?: string; model?: string },
): AigcSpecNodeCapabilityBridgeOutput {
  const invocationInput = `Derive route candidate ${input.route.title} with ${input.capability.label}.`;
  // Reuse the existing templated helpers so the byte-level shape matches
  // today's simulated invocation exactly — protecting the 47 E2E + 48
  // subdomain assertions that don't expect the bridge to change anything
  // when the LLM path is unavailable.
  const outputSummary = buildCapabilityOutputSummary({
    capability: input.capability,
    routeTitle: input.route.title,
    input: invocationInput,
  });
  const logs = buildCapabilityInvocationLogs(input.capability, outputSummary);
  const durationMs = deterministicCapabilityDuration(input.capability, {
    capabilityId: input.capability.id,
    roleId: input.roleId,
    routeId: input.route.id,
    input: invocationInput,
  });

  const invocation: BlueprintCapabilityInvocation = {
    id: input.invocationId,
    jobId: input.jobId,
    capabilityId: input.capability.id,
    roleId: input.roleId,
    capabilityLabel: input.capability.label,
    kind: input.capability.kind,
    status: "completed",
    securityLevel: input.capability.securityLevel,
    safetyGate: {
      status: "allowed",
      reason: input.capability.requiresApproval
        ? `${input.capability.label} approved for deterministic route generation sandbox derivation.`
        : `${input.capability.label} allowed for deterministic route generation sandbox derivation.`,
      requiresApproval: input.capability.requiresApproval,
      approved: input.capability.requiresApproval,
      securityLevel: input.capability.securityLevel,
    },
    requestedAt: input.createdAt,
    completedAt: input.createdAt,
    requestedBy: "route-generation-sandbox-derivation",
    routeId: input.route.id,
    input: invocationInput,
    outputSummary,
    logs,
    evidenceIds: [],
    durationMs,
    provenance: {
      jobId: input.jobId,
      projectId: input.request.projectId,
      sourceId: input.request.sourceId,
      routeSetId: input.routeSet.id,
      routeId: input.route.id,
      roleId: input.roleId,
      targetText: input.request.targetText,
      githubUrls: input.request.githubUrls ?? [],
      executionMode: "simulated_fallback",
      error: truncate(options.reason, 400),
      // promptId / model are only populated when the prompt was actually
      // constructed (tiers 3/4/5). Tiers 1/2 short-circuit before that.
      promptId: options.promptId,
      model: options.model,
    },
  };

  return {
    executionMode: "simulated_fallback",
    additionalEvents: [],
    invocation,
  };
}

// =============================================================================
// Helpers (local, pure)
// =============================================================================

function safeGetConfig(
  ctx: BlueprintServiceContext,
): { apiKey?: string; model?: string } | undefined {
  try {
    const cfg = ctx.llm.getConfig();
    return cfg as { apiKey?: string; model?: string };
  } catch {
    // Defensive: if getConfig throws (e.g. mis-configured test harness),
    // surface as "apiKey missing" → tier 2 fallback path.
    return undefined;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function truncate(text: string, max: number): string {
  if (typeof text !== "string") {
    return "";
  }
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function truncateLogs(
  lines: string[],
  maxLines: number,
  maxBytes: number,
): string[] {
  const limited = lines.slice(0, maxLines);
  let totalBytes = 0;
  const out: string[] = [];
  for (const line of limited) {
    const lineBytes = Buffer.byteLength(line, "utf8") + 1; // +1 for virtual newline
    if (totalBytes + lineBytes > maxBytes) {
      break;
    }
    out.push(line);
    totalBytes += lineBytes;
  }
  return out;
}
