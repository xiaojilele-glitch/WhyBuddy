# SlideRule Runtime Performance Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a real SlideRule run terminate consistently after one trusted runtime closure, evaluate relevance from the complete final model, keep synchronous delivery under ten minutes, and expose long-stage progress over SSE.

**Architecture:** Add a deterministic post-closure decision boundary to the existing driver, keyed by the current turn and goal digest. Treat the final six-system model as the sole relevance source. Keep only the landing-page visual design in the synchronous closure path; non-landing dashboards retain the standard renderer. Propagate structured stage metadata and heartbeat/progress events through the existing SSE stream.

**Tech Stack:** Python 3, FastAPI/Starlette SSE, Pydantic session state, pytest, existing SlideRule app store and model-version ledger.

---

### Task 1: Trusted closure terminal decision

**Files:**
- Modify: `slide-rule-python/services/v5_full_driver.py`
- Modify: `slide-rule-python/services/v5_agentic_pick.py`
- Test: `slide-rule-python/tests/test_model_reuse_within_turn.py`
- Test: `slide-rule-python/tests/test_trusted_closure_termination.py`

- [ ] Add a failing test proving a non-blocked closure with a reusable current-turn model prevents `appbundle.runtimeclosure` from being selected again.
- [ ] Add a failing stream-driver test proving no later `planning` event occurs after the trusted closure completes.
- [ ] Implement a pure `trusted_closure_decision(state, instruction, repair)` helper returning `continue`, `repair`, or `end`.
- [ ] Apply the decision before each planning pass and immediately after a closure capability commits.
- [ ] Preserve regeneration when the goal digest changes or `repair=True`.
- [ ] Run the focused termination and model-reuse tests.

### Task 2: Final-model relevance and state consistency

**Files:**
- Modify: `slide-rule-python/services/closure_relevance.py`
- Modify: `slide-rule-python/services/v5_capability_executor.py`
- Modify: `slide-rule-python/services/v5_full_driver.py`
- Test: `slide-rule-python/tests/test_closure_relevance_and_degradation.py`
- Test: `slide-rule-python/tests/test_runtime_phase_closure_consistency.py`

- [ ] Add a failing regression using the real restaurant-inspection goal and model sections from session `codex-perf-1785942782897`.
- [ ] Expand deterministic model terms to RBAC roles/permissions, workflow nodes/transitions, page kinds/stats/charts/actions, AIGC capabilities, and AppBundle identity/navigation.
- [ ] Keep the evaluator non-LLM and preserve existing negative-domain calibration tests.
- [ ] Add a failing test proving `runtimePhase=done` is impossible when final `publishClosure.blocked=True`.
- [ ] Implement one bounded targeted repair attempt for relevance failure without rerunning enrichment; otherwise finish as `awaiting` with an explicit relevance reason.
- [ ] Run relevance, closure response, and phase consistency tests.

### Task 3: Landing-page-only synchronous enrichment and hard budget

**Files:**
- Modify: `slide-rule-python/services/freeform_block.py`
- Modify: `slide-rule-python/services/enrich_timing.py`
- Modify: `slide-rule-python/services/v5_full_driver.py`
- Test: `slide-rule-python/tests/test_freeform_monitor_overview.py`
- Test: `slide-rule-python/tests/test_enrich_budget.py`

- [ ] Add a failing test with one landing monitor and one non-landing dashboard; assert only the landing page invokes `generate_freeform_block`.
- [ ] Mark non-landing dashboards with a deterministic deferred-visual status while leaving their standard blocks/layout intact.
- [ ] Add a monotonic run deadline, defaulting to nine minutes, before the ten-minute external SLA.
- [ ] Add failing tests proving visual stages skip/fail open after the deadline while structural closure remains fail closed.
- [ ] Run the focused freeform and budget tests.

### Task 4: Structured SSE progress and connection liveness

**Files:**
- Modify: `slide-rule-python/services/enrich_timing.py`
- Modify: `slide-rule-python/services/v5_full_driver.py`
- Modify: `slide-rule-python/routes/sliderule_full.py`
- Test: `slide-rule-python/tests/test_enrich_stage_visibility.py`
- Test: `slide-rule-python/tests/test_run_registry.py`

- [ ] Add failing tests requiring `pageId`, `device`, `current`, `total`, and `elapsedMs` on visible stage events.
- [ ] Preserve arbitrary stage metadata from `enrich_timing.stage()` instead of dropping it in `_enrich_stage_event`.
- [ ] Emit periodic progress/heartbeat events while a long thread-backed task is running, independent of LLM deltas.
- [ ] Add no-buffer/cache-control headers and disconnect-safe termination consistent with `sse-starlette` behavior without changing the public event envelope.
- [ ] Run SSE visibility and registry tests.

### Task 5: Verification and architecture documentation

**Files:**
- Modify: `docs/SlideRule V5.8 架构图.md`
- Use: `.dev-logs/perf-run.jsonl`

- [ ] Run all focused Python tests for closure, relevance, enrichment, streaming, and model reuse.
- [ ] Run the full Python test suite.
- [ ] Run a deterministic timing harness proving no planning occurs after the first trusted closure and only one synchronous page design is attempted.
- [ ] If credentials and remaining time permit, run one real topic through `/api/sliderule/drive-full-stream` and compare the waterfall to the 1,094.5-second baseline.
- [ ] Update the V5.8 diagram so CORE has an explicit deterministic terminal edge, ENRICH contains only landing-page synchronous visual work, and deferred dashboard visuals are outside the delivery-critical path.
