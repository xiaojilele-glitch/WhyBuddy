# Sliderule Single Device Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly generated Sliderule application choose and consume exactly one authoritative `desktop` or `phone` device while keeping historic dual-layout sessions readable.

**Architecture:** Add a deterministic Python device-policy boundary immediately after five-system generation and repair. The boundary applies explicit goal wording, otherwise preserves a valid model choice, otherwise falls back to desktop, then writes both `preferredDevice` and a `single-v1` compatibility marker before strict validation and all visual enrichments. Rendering and screenshot paths consume that stored decision; only legacy models without the marker may expose existing dual layouts.

**Tech Stack:** Python 3 / pytest, FastAPI, TypeScript / React / Vitest, Ant Design 5, Ant Design Mobile 5, Ant Design Pro Components 2.

---

### Task 1: Deterministic Device Policy

**Files:**
- Create: `slide-rule-python/services/device_policy.py`
- Create: `slide-rule-python/tests/test_device_policy.py`

- [ ] **Step 1: Write the failing resolver tests**

Cover explicit desktop wording overriding `phone`, explicit phone wording overriding `desktop`, conflicting wording preserving a valid model choice, neutral wording preserving either valid choice, and missing/invalid/`tablet` falling back to `desktop`. Assert the normalized model contains `appbundle.preferredDevice` and `appbundle.deviceAuthority == "single-v1"`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `slide-rule-python\.venv\Scripts\python.exe -m pytest slide-rule-python/tests/test_device_policy.py -q`

Expected: collection fails because `services.device_policy` does not exist.

- [ ] **Step 3: Implement the minimal policy**

Create a focused module with `Device = Literal["desktop", "phone"]`, `DEVICE_AUTHORITY = "single-v1"`, `resolve_preferred_device(goal, model_choice)`, and `normalize_model_preferred_device(goal, model)`. Use deterministic regular expressions for explicit terms, treat both classes as a conflict, preserve only `desktop|phone`, and fallback to `desktop`.

- [ ] **Step 4: Run the tests and verify GREEN**

Run the Task 1 pytest command and expect all cases to pass.

### Task 2: Generated-Model Prompt And Strict Gate

**Files:**
- Modify: `slide-rule-python/services/v5_model_gate.py`
- Modify: `slide-rule-python/services/schema_legal.py`
- Modify: `slide-rule-python/services/v5_llm_generate.py`
- Modify: `slide-rule-python/tests/test_v5_llm_generate_gate.py`
- Modify: `slide-rule-python/tests/test_monitor_overview.py`

- [ ] **Step 1: Write failing strict-gate and prompt tests**

Add tests proving `require_preferred_device=True` rejects missing, `tablet`, and invalid values while accepting `desktop|phone`. Assert generation instructions require exactly one `preferredDevice`, forbid omission/dual output, and no longer advertise `tablet` as a generated value.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `slide-rule-python\.venv\Scripts\python.exe -m pytest slide-rule-python/tests/test_v5_llm_generate_gate.py slide-rule-python/tests/test_monitor_overview.py -k "preferred_device or generation_contract" -q`

Expected: strict-gate keyword is unsupported and old prompt wording violates the new assertions.

- [ ] **Step 3: Implement strict mode and prompt contract**

Add `require_preferred_device: bool = False` to `validate_five_system_model`; in strict mode require exactly `desktop|phone`, while tolerant reads continue accepting missing and historic `tablet`. Update the schema example and legal appendix so new models must emit one `desktop|phone` decision from explicit wording or whole-product operating posture and must never omit it to request two layouts.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 2 pytest command and expect all selected tests to pass.

### Task 3: Normalize Before Every Generated-Model Gate

**Files:**
- Modify: `slide-rule-python/services/v5_capability_executor.py`
- Modify: `slide-rule-python/tests/test_v5_llm_generate_gate.py`

- [ ] **Step 1: Write failing executor tests**

Drive `_try_llm_generate_evidence` with fake generation/enrichment functions and assert the initial model and gate-feedback retry are normalized before strict validation. Prove explicit goal wording wins and visual enrichment sees the same marked device.

- [ ] **Step 2: Run focused tests and verify RED**

Run the new test node(s) with pytest and confirm the generated model reaches enrichment without the required marker/device before implementation.

- [ ] **Step 3: Wire normalization and strict gate**

After deterministic repair, call `normalize_model_preferred_device(goal, model)`, then call `validate_five_system_model(..., require_preferred_device=True)`. Apply the same ordering to the one gate-feedback retry. Keep historic callers on the tolerant default.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 3 tests and the complete `test_v5_llm_generate_gate.py` file.

### Task 4: Remove Dual Homepage Generation

**Files:**
- Modify: `slide-rule-python/services/freeform_block.py`
- Modify: `slide-rule-python/tests/test_monitor_overview.py`

- [ ] **Step 1: Replace dual-generation expectations with failing single-device tests**

Change the unspecified-device regression to expect deterministic desktop-only generation and add event capture proving `monitor.sheet`, `monitor.palette`, and `monitor.design` report the same device with `current=1,total=1`. Retain explicit desktop and phone cases and assert no generated `mobile` subtree.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `slide-rule-python\.venv\Scripts\python.exe -m pytest slide-rule-python/tests/test_monitor_overview.py -k "device or declared or generation_contract" -q`

Expected: the old unspecified branch still calls phone and attaches `mobile`.

- [ ] **Step 3: Implement one visual path**

Normalize the local device defensively to `desktop|phone`, set `design_total = 1`, remove the second phone-generation branch, and keep all reference-image, palette, design, screenshot verification, preview, and progress arguments on that one value.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 4 command and then the full `test_monitor_overview.py` file.

### Task 5: Authoritative Screenshot Tier

**Files:**
- Modify: `slide-rule-python/routes/sliderule_full.py`
- Modify: `slide-rule-python/tests/test_local_screenshot.py`
- Modify: `server/routes/sliderule-screenshot-device.ts`
- Modify: `server/routes/sliderule.ts`
- Modify: `server/tests/sliderule-screenshot-device.test.ts`

- [ ] **Step 1: Write failing screenshot policy tests**

At the Python route, build a persisted session fixture whose current model version declares `phone`; request `desktop` and assert capture uses `phone` and reports the actual tier in `X-Sliderule-Device`. Add pure TypeScript tests for choosing a model-authoritative device over a conflicting request and using deterministic desktop when no model decision exists.

- [ ] **Step 2: Run focused tests and verify RED**

Run the focused Python screenshot test and `pnpm exec vitest run --config vitest.config.server.ts server/tests/sliderule-screenshot-device.test.ts`.

- [ ] **Step 3: Implement authoritative screenshot resolution**

Resolve the current persisted model from `currentModelVersionId` (falling back to the newest model version), normalize its `preferredDevice`, and ignore a conflicting request. Forward the model device from Node when available, key the cache by the actual tier, and return the actual tier diagnostic header. Never probe a second tier.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run both Task 5 commands and the complete Python screenshot test file.

### Task 6: Runtime Tier Compatibility

**Files:**
- Modify: `client/src/pages/sliderule/live-runtime/app-runtime-schema.ts`
- Modify: `client/src/pages/sliderule/live-runtime/AppRuntimeScreen.tsx`
- Modify: `client/src/pages/sliderule/live-runtime/__tests__/device-tiers.test.ts`

- [ ] **Step 1: Write failing new-versus-historic tier tests**

Assert `deviceAuthority: single-v1` desktop models expose only desktop even if stale `mobile.root` or `layout.grid.phone` residue exists; marked phone models expose only phone. Keep tests proving unmarked historic dual payloads remain switchable.

- [ ] **Step 2: Run the tier test and verify RED**

Run: `pnpm exec vitest run client/src/pages/sliderule/live-runtime/__tests__/device-tiers.test.ts`

Expected: the marked authority is not projected or honored.

- [ ] **Step 3: Project and consume the compatibility marker**

Add optional `deviceAuthority?: "single-v1"` to runtime identity, project it from `appbundle`, and make `availableDeviceTiers` return exactly the marked preferred tier. Only unmarked historic payloads use existing-design discovery.

- [ ] **Step 4: Run frontend contracts and verify GREEN**

Run the tier test plus `ant-design-block-contract.test.tsx`, `phone-official-components.test.ts`, and `phone-blocks-and-residue.test.ts`.

### Task 7: Integrated Verification And Real Runs

**Files:**
- Modify only production/test files above if verification exposes a regression; every fix starts with a reproducing test.

- [ ] **Step 1: Run focused backend suites**

Run the device policy, model gate, monitor overview, local screenshot, app store, and model version pytest files.

- [ ] **Step 2: Run focused frontend/server suites**

Run device-tier, official component boundary, and screenshot-device Vitest suites.

- [ ] **Step 3: Run static and production checks**

Run `pnpm exec tsc --noEmit --pretty false` and `pnpm run build`.

- [ ] **Step 4: Run two real Chinese topics**

With the existing local services and configured LLM/image channels, run one explicit-device topic and one neutral topic. Inspect SSE logs for exactly one `monitor.design` event at `current=1,total=1`, confirm all visual stages use the same device, and capture one authentic screenshot for each result. Do not start a second device after any failure.

- [ ] **Step 5: Review the final diff and commit**

Confirm the deferred complete-homepage-visual architecture is absent from the diff, remove only test artifacts created by this run, then commit the implementation on `main` without pulling or rebasing the diverged remote branch.
