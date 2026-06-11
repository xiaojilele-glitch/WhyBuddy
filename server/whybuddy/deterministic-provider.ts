/**
 * Deterministic_Provider assembly seam — server side
 * (whybuddy-llm-autonomous-reasoning, 需求 13.1 / 13.3 / 13.5).
 *
 * Mirrors the client runtime seam in `client/src/lib/whybuddy-runtime.ts`:
 *   - createDeterministicRouter / createDeterministicCapabilityExecutor are pure
 *     stand-ins (zero network, zero real-LLM) for server-side tests.
 *   - assembleProvidersForBuildTarget defaults to the deterministic stand-ins when
 *     BUILD_TARGET=test (需求 13.3); real providers are reached ONLY via explicit
 *     injection or an explicit switch (需求 13.5).
 *
 * Compatibility-first / additive only: this module introduces NO changes to
 * BudgetPolicy, the orchestrate-plan path, or the capability execution maps. It
 * only exposes injectable seams so the runtime-owned Session_Driver (task 4.1)
 * can be exercised deterministically on the server.
 */

import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import type { V5CapabilityId } from "../../shared/blueprint/contracts.js";
import { pickNextCapabilities } from "../../shared/blueprint/whybuddy-pick-heuristic.js";
import {
  executeOrchestratePlan,
  type OrchestratePlanRequest,
  type OrchestratePlanResponse,
} from "./orchestrate-plan.js";
import type { RawExecutorResult } from "./capability-exec-map.js";

/**
 * Server-side router response. Mirrors OrchestratePlanResponse and adds the
 * net-new optional `converged` boolean (需求 3.3). `converged` is optional to
 * preserve compatibility with the orchestrate-plan path before task 2.3 lands it.
 */
export type ReasoningRouterResponse = OrchestratePlanResponse & {
  converged?: boolean;
};

/**
 * Injectable router seam (需求 13.1). A Deterministic_Provider replacement can be
 * injected for tests; the real implementation routes through executeOrchestratePlan.
 */
export interface ReasoningRouter {
  proposePlan(req: OrchestratePlanRequest): Promise<ReasoningRouterResponse>;
}

/** Arguments handed to a server CapabilityExecutor (mirrors the /execute-capability inputs). */
export interface CapabilityExecutorArgs {
  capabilityId: V5CapabilityId;
  state: V5SessionState;
  inputArtifactIds: string[];
  roleId?: string;
  turnId: string;
}

/**
 * Injectable capability executor seam (需求 13.1). Returns the raw executor contract
 * ({ title, summary, content, provenance? }); the runtime still owns Trust Gate /
 * producedBy / capabilityRunId binding at commit time.
 */
export interface CapabilityExecutor {
  executeCapability(args: CapabilityExecutorArgs): Promise<RawExecutorResult>;
}

/** A single scripted router step: a fixed response, or a function deriving one from the request. */
export type DeterministicRouterStep =
  | ReasoningRouterResponse
  | ((req: OrchestratePlanRequest) => ReasoningRouterResponse);

/**
 * Optional script for createDeterministicRouter:
 *   - an array consumed one entry per loop (exhaustion falls back to heuristic pick), or
 *   - a function `(req, loopIndex) => response` for full control.
 */
export type DeterministicRouterScript =
  | DeterministicRouterStep[]
  | ((req: OrchestratePlanRequest, loopIndex: number) => ReasoningRouterResponse);

/**
 * createDeterministicRouter — Deterministic_Provider stand-in for the LLM_Router (需求 13.1).
 *
 * Performs zero network / zero real-LLM calls. With no script it derives a fully
 * deterministic plan from the shared heuristic picker (`source: "heuristic_fallback"`).
 * A script (array or function) lets tests drive exact per-loop proposals, including
 * convergence signals via `{ selected: [], converged: true }`.
 */
export function createDeterministicRouter(
  script?: DeterministicRouterScript
): ReasoningRouter {
  let loopIndex = 0;

  const heuristicResponse = (req: OrchestratePlanRequest): ReasoningRouterResponse => {
    const userText = req.userText || req.state.goal?.text || "";
    const selected = pickNextCapabilities(req.state, userText).map((p) => ({
      capabilityId: p.capabilityId,
      roleId: p.roleId,
    }));
    return {
      selected,
      rationale: `deterministic_router heuristic pick for: ${userText.slice(0, 80)}`,
      source: "heuristic_fallback",
    };
  };

  return {
    async proposePlan(req: OrchestratePlanRequest): Promise<ReasoningRouterResponse> {
      const i = loopIndex++;

      if (typeof script === "function") {
        return script(req, i);
      }

      if (Array.isArray(script) && i < script.length) {
        const step = script[i];
        return typeof step === "function" ? step(req) : step;
      }

      return heuristicResponse(req);
    },
  };
}

/**
 * createDeterministicCapabilityExecutor — Deterministic_Provider stand-in for the
 * server CapabilityExecutor (需求 13.1).
 *
 * Produces a fully deterministic raw result derived from the capability id + goal
 * text, with zero network / zero real-LLM. `provenance` is "ai_generated" so the
 * runtime trust layer treats it like any locally produced artifact content.
 */
export function createDeterministicCapabilityExecutor(): CapabilityExecutor {
  return {
    async executeCapability(args: CapabilityExecutorArgs): Promise<RawExecutorResult> {
      const goalText = String(args.state?.goal?.text || "").slice(0, 160);
      const inputs = args.inputArtifactIds || [];
      return {
        title: `${args.capabilityId}（确定性替身）`,
        summary: `Deterministic stand-in output for ${args.capabilityId}.`,
        content:
          `[deterministic ${args.capabilityId}] goal=「${goalText}」 ` +
          `role=${args.roleId ?? "(unspecified)"} turn=${args.turnId} ` +
          `inputs=${inputs.length ? inputs.join(",") : "(none)"}`,
        provenance: "ai_generated",
      };
    },
  };
}

/**
 * createServerReasoningRouter — the "real" server-side router seam.
 *
 * Routes through executeOrchestratePlan (R1: validation / clamp / graceful
 * degradation + DLEDGER source). This is the non-deterministic default returned by
 * assembleProvidersForBuildTarget outside BUILD_TARGET=test.
 */
export function createServerReasoningRouter(): ReasoningRouter {
  return {
    async proposePlan(req: OrchestratePlanRequest): Promise<ReasoningRouterResponse> {
      return executeOrchestratePlan(req);
    },
  };
}

/** Resolved providers returned by assembleProvidersForBuildTarget. */
export interface AssembledProviders {
  router: ReasoningRouter;
  executor: CapabilityExecutor;
  /** True when deterministic stand-ins were assembled by default (BUILD_TARGET=test). */
  deterministic: boolean;
  /** The build target that drove the decision (for diagnostics / tests). */
  buildTarget?: string;
}

/** Options for assembleProvidersForBuildTarget (all optional, additive). */
export interface AssembleProvidersOptions {
  /** Override build-target detection (defaults to process.env.BUILD_TARGET). */
  buildTarget?: string;
  /** Explicit switch to assemble real providers even under BUILD_TARGET=test (需求 13.5). */
  useReal?: boolean;
  /** Explicit router injection — overrides default assembly for the router slot (需求 13.5). */
  router?: ReasoningRouter;
  /** Explicit executor injection — overrides default assembly for the executor slot (需求 13.5). */
  executor?: CapabilityExecutor;
  /** Real router used on the non-deterministic path (defaults to the server-routed router). */
  realRouter?: ReasoningRouter;
  /** Real executor used on the non-deterministic path (must be supplied for the real path). */
  realExecutor?: CapabilityExecutor;
}

/** Whether the current (or supplied) build target is the deterministic test target (需求 13.3). */
export function isTestBuildTarget(buildTarget?: string): boolean {
  const target = buildTarget ?? process.env.BUILD_TARGET;
  return target === "test";
}

/**
 * assembleProvidersForBuildTarget — central Deterministic_Provider assembly seam (需求 13.3 / 13.5).
 *
 * Decision order, per slot (router / executor):
 *   1. Explicit injection (`options.router` / `options.executor`) always wins (需求 13.5).
 *   2. Otherwise, under BUILD_TARGET=test (and without `useReal`), assemble the
 *      deterministic stand-in by default (需求 13.3).
 *   3. Otherwise assemble the real provider (server-routed router / supplied real
 *      executor) — reached only via explicit switch or a non-test target (需求 13.5).
 *
 * The server has no single module-default capability executor (execution is spread
 * across the capability-exec-map + LLM stack), so the real executor must be supplied
 * via `options.executor` / `options.realExecutor` on the real path; when neither is
 * present the deterministic stand-in is used as a safe, never-throw default.
 */
export function assembleProvidersForBuildTarget(
  options: AssembleProvidersOptions = {}
): AssembledProviders {
  const testTarget = isTestBuildTarget(options.buildTarget);
  const deterministic = testTarget && options.useReal !== true;

  const router =
    options.router ??
    (deterministic
      ? createDeterministicRouter()
      : options.realRouter ?? createServerReasoningRouter());

  const executor =
    options.executor ??
    (deterministic
      ? createDeterministicCapabilityExecutor()
      : options.realExecutor ?? createDeterministicCapabilityExecutor());

  return {
    router,
    executor,
    deterministic,
    buildTarget: options.buildTarget ?? process.env.BUILD_TARGET,
  };
}
