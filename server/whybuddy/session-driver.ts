/**
 * Session_Driver — server-side equivalent driver
 * (whybuddy-llm-autonomous-reasoning, 需求 1 / 2; task 4.1).
 *
 * The multi-step re-entry loop CORE lives once in the runtime
 * (`client/src/lib/whybuddy-runtime.ts` → `driveReasoningSession`). This module
 * exposes an *equivalent* entry point on the server so server-side tests can
 * exercise the same loop against the server Deterministic_Provider seams
 * (`server/whybuddy/deterministic-provider.ts`).
 *
 * It is a thin adapter: it wires the server-shaped ReasoningRouter /
 * CapabilityExecutor seams onto the runtime driver's client-shaped seams. The loop
 * algorithm, the `${turnSeedId}-loop-${n}` / `${loopTurnId}-run-${i}` id derivation,
 * the convergence_signal stop, and the ReentryAccumulator are all owned by the
 * single runtime implementation — there is NO second copy of the loop here.
 *
 * Compatibility-first / additive only: this module changes nothing in BudgetPolicy,
 * orchestrate-plan, or the capability execution maps; it only re-routes injected
 * providers into the runtime driver.
 */

import type { Artifact, UserIntervention } from "../../shared/blueprint/v5-reasoning-state.js";
import {
  driveReasoningSession as runtimeDriveReasoningSession,
  type DriveReasoningResult,
  type ReasoningRouter as RuntimeReasoningRouter,
  type CapabilityExecutor as RuntimeCapabilityExecutor,
} from "../../client/src/lib/whybuddy-runtime";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import {
  assembleProvidersForBuildTarget,
  type ReasoningRouter as ServerReasoningRouter,
  type CapabilityExecutor as ServerCapabilityExecutor,
} from "./deterministic-provider.js";

/** Options for the server-side equivalent driver (mirrors DriveReasoningOptions). */
export interface ServerDriveReasoningOptions {
  /** Base turn id; each loop derives `${turnSeedId}-loop-${n}`. */
  turnSeedId: string;
  userText: string;
  intervention?: UserIntervention;
  /** Injected server router (Deterministic_Provider replaceable). */
  router?: ServerReasoningRouter;
  /** Injected server capability executor (Deterministic_Provider replaceable). */
  executor?: ServerCapabilityExecutor;
  /** Per-message loop cap (Driver-level guard, default DEFAULT_MAX_LOOPS_PER_MESSAGE = 3). */
  maxLoopsPerMessage?: number;
}

/**
 * Adapt a server ReasoningRouter (OrchestratePlanRequest in) onto the runtime's
 * client-shaped ReasoningRouter (ReasoningRouterRequest in). The two request/response
 * shapes are structurally aligned; only the intervention shape is narrowed here.
 */
function adaptServerRouter(server: ServerReasoningRouter): RuntimeReasoningRouter {
  return {
    async proposePlan(req) {
      const res = await server.proposePlan({
        state: req.state,
        turnId: req.turnId,
        userText: req.userText,
        intervention: req.intervention
          ? {
              intent: req.intervention.intent,
              targetArtifactId: req.intervention.targetArtifactId,
              targetDecisionId: req.intervention.targetDecisionId,
            }
          : null,
      });
      return {
        selected: res.selected,
        rationale: res.rationale,
        source: res.source,
        converged: res.converged,
        usage: res.usage,
      };
    },
  };
}

/**
 * Adapt a server CapabilityExecutor (RawExecutorResult out) onto the runtime's
 * client-shaped CapabilityExecutor. RawExecutorResult.provenance is a plain string
 * (wider than Artifact["provenance"]); it is narrowed via cast at the seam.
 */
function adaptServerExecutor(server: ServerCapabilityExecutor): RuntimeCapabilityExecutor {
  return {
    async executeCapability(args) {
      const raw = await server.executeCapability({
        capabilityId: args.capabilityId,
        state: args.state,
        inputArtifactIds: args.inputArtifactIds,
        roleId: args.roleId,
        turnId: args.turnId,
      });
      return {
        title: raw.title,
        summary: raw.summary,
        content: raw.content,
        provenance: raw.provenance as Artifact["provenance"] | undefined,
      };
    },
  };
}

/**
 * driveReasoningSession — server-side equivalent entry point (需求 1 / 2).
 *
 * Resolves the server Deterministic_Provider seams (explicit injection wins;
 * BUILD_TARGET=test → deterministic stand-ins by default), adapts them onto the
 * runtime driver's seams, and delegates to the single runtime loop implementation.
 */
export async function driveReasoningSession(
  state: V5SessionState,
  options: ServerDriveReasoningOptions
): Promise<DriveReasoningResult> {
  const assembled = assembleProvidersForBuildTarget({
    router: options.router,
    executor: options.executor,
  });

  return runtimeDriveReasoningSession(state, {
    turnSeedId: options.turnSeedId,
    userText: options.userText,
    intervention: options.intervention,
    router: adaptServerRouter(assembled.router),
    executor: adaptServerExecutor(assembled.executor),
    ...(options.maxLoopsPerMessage !== undefined
      ? { maxLoopsPerMessage: options.maxLoopsPerMessage }
      : {}),
  });
}
