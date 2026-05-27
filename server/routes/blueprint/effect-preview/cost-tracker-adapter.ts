/**
 * cost-tracker-adapter — Phase 4 Task 33.x.
 *
 * STATUS: 33.1 (DISCOVERY) complete; 33.2 (implementation) — this file.
 * 33.3 wires the adapter into the default `BlueprintServiceContext`;
 * 33.4 proves that wiring really records cost from the production
 * assembly path.
 *
 * ============================================================================
 * 33.1 DISCOVERY REPORT — `server/core/cost-tracker.ts`
 * ============================================================================
 *
 * 1. EXPORTED API SURFACE
 * -----------------------
 * From `server/core/cost-tracker.ts`:
 *
 *   export class CostTracker {
 *     constructor(historyFilePath?: string);
 *     recordCall(record: CostRecord): void;          // <-- THE record method
 *     getSnapshot(): CostSnapshot;
 *     getHistory(): MissionCostSummary[];
 *     finalizeMission(missionId, title): void;
 *     resetCurrentMission(missionId?): void;
 *     getAgentCosts(): AgentCostSummary[];
 *     getSessionCosts(): Map<...>;
 *     getBudget() / setBudget(...) ;
 *     getAlerts() ;
 *     getDowngradeLevel() / getDowngradePolicy() / setDowngradePolicy() ;
 *     getEffectiveModel(originalModel) ;
 *     isAgentPaused(agentId) ;
 *     manualReleaseDegradation() ;
 *     loadHistory() ;
 *     getRecords() ;
 *     getCurrentMissionId() ;
 *   }
 *   export const costTracker = new CostTracker();   // module-level SINGLETON
 *
 * Default history file: `data/cost-history.json` (resolved relative to the
 * compiled module via `fileURLToPath`). Constructor accepts an override
 * path — used by tests with `os.tmpdir()` paths.
 *
 * NO `createCostTracker(...)` factory function exists. Production code in
 * `server/core/llm-client.ts` (3 sites: lines ~859, ~907, ~943) imports the
 * `costTracker` singleton directly:
 *
 *     import { costTracker } from './cost-tracker.js';
 *     costTracker.recordCall({ id, timestamp, model, tokensIn, tokensOut,
 *                              unitPriceIn, unitPriceOut, actualCost,
 *                              durationMs, agentId?, missionId?, sessionId?,
 *                              error? });
 *
 * 2. METHOD SIGNATURE: `recordCall(record: CostRecord): void`
 * -----------------------------------------------------------
 * `CostRecord` (from `shared/cost.ts`) required fields:
 *   - id: string                  // randomUUID() at call site
 *   - timestamp: number           // Date.now() — typically `startTime`
 *   - model: string               // pricing-table key OR arbitrary id
 *   - tokensIn: number            // 0 is valid (e.g., failed call, image gen)
 *   - tokensOut: number           // 0 is valid
 *   - unitPriceIn: number         // PRICING_TABLE[model]?.input ?? DEFAULT_PRICING.input
 *   - unitPriceOut: number        // PRICING_TABLE[model]?.output ?? DEFAULT_PRICING.output
 *   - actualCost: number          // estimateCost(model, in, out) OR caller-computed
 *   - durationMs: number          // Date.now() - startTime
 *
 * Optional: agentId, missionId, sessionId, error.
 *
 * The method is SYNCHRONOUS and PUSH-INTO-MEMORY. Side effects after the push:
 *   a. tracks `currentMissionId` from first record carrying `missionId`
 *   b. `checkAlerts()` (in-memory, may emit Socket.IO alerts via dynamic
 *      `import('./socket.js')` — fire-and-forget, swallowed on import error)
 *   c. dynamic `import('./socket.js').then(emitCostUpdate)` —
 *      fire-and-forget Socket.IO snapshot broadcast (throttled on socket side)
 *
 * `recordCall` does NOT write to disk. Disk persistence (`writeFileSync`)
 * only happens inside `finalizeMission()`, `setBudget()`, and
 * `setDowngradePolicy()` via the private `persistHistory()`.
 *
 * 3. SINGLETON vs PER-INSTANCE
 * ----------------------------
 * Production wires the singleton. Tests build per-instance via
 * `new CostTracker(tmpHistoryPath)` (see `server/tests/cost-tracker.test.ts`
 * line 38, `cost-observability.test.ts` `freshTracker()` line 158).
 *
 * 4. IN-MEMORY / DRY-RUN MODE
 * ---------------------------
 * No explicit dry-run flag, but in practice `recordCall` is in-memory only.
 * For tests, two viable patterns:
 *   (A) Per-instance: `new CostTracker(path.join(os.tmpdir(), 'x.json'))` —
 *       no disk write happens unless test calls `finalizeMission` / `setBudget`.
 *       Recommended for 33.4 because the new context test should not pollute
 *       the production singleton's in-memory state between tests.
 *   (B) Singleton: rely on `costTracker.resetCurrentMission()` in
 *       beforeEach/afterEach (existing pattern in `cost-api.test.ts` and
 *       `llm-client.provider-fallback.test.ts`). Less hermetic; 33.4 should
 *       prefer pattern (A).
 *
 * 5. EXISTING `costTracker` ON BLUEPRINT CTX?
 * -------------------------------------------
 * `server/routes/blueprint/context.ts` does NOT carry a `costTracker` field
 * today. The current ctx assembly comment (~L1469) explicitly states
 * "`costTracker` 暂未注入". 33.3 will replace that comment with an
 * `createCostTrackerAdapter(...)` invocation that wraps the existing
 * `server/core/cost-tracker.ts` singleton (or accepts a per-instance handle
 * for test isolation).
 *
 * Decision for 33.2/33.3: the adapter accepts EITHER the singleton OR a
 * caller-supplied `CostTracker` instance, so the default production wiring
 * uses the singleton, and 33.4's integration test can inject a fresh
 * `new CostTracker(tmpPath)`.
 *
 * 6. EXISTING TEST ISOLATION PATTERNS FOUND
 * -----------------------------------------
 * - `server/tests/cost-tracker.test.ts` — `tracker = new CostTracker(historyPath)`
 *   with `os.tmpdir()` mkdtemp; reusable `makeRecord()` helper (lines 12-29).
 * - `server/tests/cost-api.test.ts` — singleton + `resetCurrentMission()`.
 * - `server/tests/cost-observability.test.ts` — `freshTracker()` helper
 *   (line 158) builds `new CostTracker('/tmp/cost-test-' + random + '.json')`.
 * - `server/tests/llm-client.provider-fallback.test.ts` — singleton +
 *   `resetCurrentMission()` in beforeEach/afterEach.
 * - `server/routes/blueprint/effect-preview/__tests__/image-service.test.ts`
 *   — uses an inline `BlueprintCostTrackerLike` shim with
 *   `recordSpy = vi.fn()`. 33.4 must NOT reuse this shim — per task brief,
 *   the integration test must prove the default production assembly really
 *   records cost, so build the real adapter wrapping a real `CostTracker`
 *   instance and `vi.spyOn(tracker, 'recordCall')`.
 *
 * 7. FIELD TRANSLATION STRATEGY (Stage C → CostRecord)
 * ----------------------------------------------------
 * `BlueprintCostTrackerLike.record(input)` carries 4 fields:
 *
 *   { tier?: FallbackTier; durationMs: number; model: ImageGenModel; estimatedCost?: number }
 *
 * Mapping into `CostRecord`:
 *   - durationMs           → CostRecord.durationMs                (direct)
 *   - model                → CostRecord.model                     (direct)
 *   - estimatedCost ?? 0   → CostRecord.actualCost                (Phase 5
 *                            task 43: caller `runRasterPipeline` now passes
 *                            `lookupImagePricing(model)` from
 *                            `shared/cost.ts` IMAGE_PRICING_TABLE on success
 *                            path, explicit `0` on failure. Adapter remains
 *                            pass-through; warn when success-path arrives
 *                            with $0 — see record() body below.)
 *   - tier (when present)  → CostRecord.error = `fallback-tier:${tier}`
 *                            (CostRecord has no `tier` field; use `error`
 *                            so degraded calls remain auditable)
 *   - tokensIn / tokensOut → 0 / 0                                (image gen
 *                            has no token concept; cost-tracker accepts 0)
 *   - unitPriceIn / Out    → PRICING_TABLE[model]?.input/output
 *                            ?? DEFAULT_PRICING.input/output      (image
 *                            models like `gpt-image-2` are NOT in the
 *                            token-priced PRICING_TABLE — image pricing
 *                            lives in the separate IMAGE_PRICING_TABLE
 *                            consumed upstream. The DEFAULT_PRICING token
 *                            fallback mirrors `llm-client.ts` lines ~858
 *                            and only fills `CostRecord` token columns —
 *                            it does NOT contribute to image actualCost.)
 *   - id                   → randomUUID()                          (per call)
 *   - timestamp            → Date.now()                            (call site)
 *   - agentId / missionId / sessionId — adapter accepts an optional
 *     `context: { agentId?; missionId?; sessionId? }` factory parameter so
 *     the ctx wiring (33.3) can pass mission/session ids harvested from the
 *     blueprint job. Stage C does not currently surface these to the
 *     adapter, so 33.2's default is to omit them (the cost-tracker accepts
 *     undefined and groups under "unknown").
 *
 * IMPORTANT: `estimatedCost` is ADAPTER-CONSUMING, NOT ADAPTER-COMPUTING.
 * The real cost-tracker has no knowledge of image-model pricing. Stage C's
 * `runRasterPipeline` already accepts `estimatedCost?: number` in its
 * record payload and now (Phase 5 task 43) computes it via
 * `lookupImagePricing(model)` from `shared/cost.ts` IMAGE_PRICING_TABLE on
 * the success path. The adapter remains a pure pass-through:
 * `actualCost = estimatedCost ?? 0`. The split between IMAGE_PRICING_TABLE
 * (per-call image rates) and PRICING_TABLE (per-token LLM rates) is
 * deliberate — image generation has no token concept, so mixing the two
 * domains would conflate billable units. Future per-call billable surfaces
 * should be added to IMAGE_PRICING_TABLE, not to PRICING_TABLE, and the
 * adapter must remain pricing-agnostic.
 *
 * 8. CONTRACT SUMMARY FOR 33.2 IMPLEMENTER
 * ----------------------------------------
 *   createCostTrackerAdapter({ tracker?: CostTracker; context?: {...} })
 *     -> BlueprintCostTrackerLike
 *
 *   - tracker: defaults to the exported singleton from
 *     `server/core/cost-tracker.ts`. 33.4's integration test passes a fresh
 *     `new CostTracker(tmpPath)`.
 *   - context: optional static metadata (agentId / missionId / sessionId)
 *     captured at adapter creation time. Stage C raster doesn't currently
 *     surface these; safe to default to `{}`.
 *
 *   Returned `BlueprintCostTrackerLike.record(...)` MUST be synchronous and
 *   side-effect-only (mirrors the existing interface contract in
 *   `image-service.ts` lines 202-209).
 *
 * ============================================================================
 * END OF DISCOVERY REPORT
 * ============================================================================
 */

import { randomUUID } from "node:crypto";

import {
  DEFAULT_PRICING,
  PRICING_TABLE,
  type CostRecord,
} from "../../../../shared/cost.js";
import {
  costTracker as defaultSingleton,
  CostTracker,
} from "../../../core/cost-tracker.js";

import type { BlueprintCostTrackerLike } from "./image-service.js";

/**
 * Re-export of the production cost-tracker class identity. The adapter
 * factory uses {@link CostTracker} for its `tracker` dependency type so
 * test fixtures can inject a fresh `new CostTracker(tmpHistoryPath)`
 * without depending on the singleton's in-memory state.
 */
export type CostTrackerHandle = CostTracker;

/**
 * Optional static context the adapter binds at creation time. The
 * cost-tracker's `CostRecord` type accepts these as optional fields; 33.3's
 * ctx wiring will populate them from the blueprint job metadata where
 * available, otherwise leave them undefined (cost-tracker groups undefined
 * agentId under "unknown").
 */
export interface CostTrackerAdapterContext {
  readonly agentId?: string;
  readonly missionId?: string;
  readonly sessionId?: string;
}

/**
 * Dependency bag for the adapter factory. Both fields optional so 33.3 can
 * call `createCostTrackerAdapter()` with zero args (defaults to the
 * production singleton + empty context), and 33.4's integration test can
 * pass `{ tracker: new CostTracker(tmpPath) }` for hermetic isolation.
 */
export interface CostTrackerAdapterDeps {
  readonly tracker?: CostTrackerHandle;
  readonly context?: CostTrackerAdapterContext;
}

/**
 * Build a {@link BlueprintCostTrackerLike} that wraps the production
 * `CostTracker` and translates Stage C raster call metadata into the full
 * `CostRecord` schema expected by `tracker.recordCall(...)`.
 *
 * Translation rules (see DISCOVERY REPORT §7):
 *
 * - `id`           → fresh `randomUUID()` per call.
 * - `timestamp`    → `Date.now()` at the moment `record(...)` is invoked.
 * - `model`        → passed through; lookup unit prices via
 *                    `PRICING_TABLE[model] ?? DEFAULT_PRICING`.
 * - `tokensIn` / `tokensOut` → `0` (image generation has no token concept).
 * - `actualCost`   → `estimatedCost ?? 0` (adapter does NOT compute prices;
 *                    Phase 5 task 43 wired image per-call pricing in
 *                    `IMAGE_PRICING_TABLE` (`shared/cost.ts`), consumed
 *                    upstream by `runRasterPipeline` before this adapter
 *                    sees the value. Future image surfaces should extend
 *                    `IMAGE_PRICING_TABLE`, not `PRICING_TABLE`, and the
 *                    adapter must stay pricing-agnostic.).
 * - `durationMs`   → passed through.
 * - `agentId` / `missionId` / `sessionId` → from `deps.context` if set,
 *                    otherwise undefined (cost-tracker groups under
 *                    `"unknown"`).
 * - `error`        → on degraded calls (`tier` set) becomes
 *                    `\`fallback-tier:${tier}\`` so the audit trail keeps
 *                    the fallback reason; on success path stays undefined.
 *
 * Defensive guard: if the imported singleton is somehow unavailable at
 * adapter-creation time AND no explicit `tracker` was passed, the returned
 * `record()` throws on first call. In practice this should never trigger —
 * the cost-tracker module-level singleton is always exported — but the
 * safety net catches malformed test fixtures that bypass module loading.
 */
export function createCostTrackerAdapter(
  deps: CostTrackerAdapterDeps = {},
): BlueprintCostTrackerLike {
  const tracker = deps.tracker ?? defaultSingleton;
  const context = deps.context;

  return {
    record(input): void {
      if (!tracker || typeof tracker.recordCall !== "function") {
        // Defensive: only fires if the singleton import resolved to a
        // malformed value (e.g., test mock replaced the module export
        // with a non-CostTracker object). Production code never reaches
        // this branch.
        throw new Error(
          "cost-tracker-adapter: no usable CostTracker instance available",
        );
      }

      // ---------------------------------------------------------------
      // task 43.3 — Defensive warn for silent under-reporting.
      //
      // Success-path ($0 actualCost) means the upstream pricing source
      // is missing for `input.model` — NOT that the call was free.
      // Surface it through `console.warn` so audit trails / log scrapers
      // can spot the under-reporting without changing the recorded
      // value (which would shift the contract surface).
      //
      // The warn fires only on success path (`tier === undefined`) AND
      // when `estimatedCost` is missing or explicitly 0. Failure paths
      // already pass tier !== undefined and 0 cost is the honest answer
      // (no charge for failed calls); see task 43.2.
      // ---------------------------------------------------------------
      if (
        input.tier === undefined &&
        (input.estimatedCost === undefined || input.estimatedCost === 0)
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          `image-cost-adapter: success-path call recorded $0 — pricing source likely missing for model "${input.model}"`,
        );
      }

      const pricing = PRICING_TABLE[input.model] ?? DEFAULT_PRICING;
      const record: CostRecord = {
        id: randomUUID(),
        timestamp: Date.now(),
        model: input.model,
        tokensIn: 0,
        tokensOut: 0,
        unitPriceIn: pricing.input,
        unitPriceOut: pricing.output,
        actualCost: input.estimatedCost ?? 0,
        durationMs: input.durationMs,
        ...(context?.agentId !== undefined ? { agentId: context.agentId } : {}),
        ...(context?.missionId !== undefined
          ? { missionId: context.missionId }
          : {}),
        ...(context?.sessionId !== undefined
          ? { sessionId: context.sessionId }
          : {}),
        ...(input.tier !== undefined
          ? { error: `fallback-tier:${input.tier}` }
          : {}),
      };

      tracker.recordCall(record);
    },
  };
}
