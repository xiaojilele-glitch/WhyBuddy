# Sliderule Page Reconstruction Spec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inspectable image-to-page reconstruction stage and make marketing reference images represent complete homepages.

**Architecture:** A focused Python module analyzes a generated image into a validated, versioned `PageReconstructionSpec` and deterministically compiles it into the prompt consumed by the existing Freeform generator. The monitor enrichment orchestrator persists the analysis and preserves the existing fail-open, single-device behavior.

**Tech Stack:** Python 3, Pydantic, existing `sliderule_llm` multimodal client, pytest, React/TypeScript runtime schema.

---

### Task 1: Lock The Reconstruction Contract

**Files:**
- Create: `slide-rule-python/tests/test_page_reconstruction.py`
- Create: `slide-rule-python/services/page_reconstruction.py`

- [ ] **Step 1: Write failing tests** for strict JSON parsing, device consistency, deterministic prompt compilation, and malformed-response diagnostics.
- [ ] **Step 2: Run tests to verify RED** with `slide-rule-python/.venv/Scripts/python.exe -m pytest slide-rule-python/tests/test_page_reconstruction.py -q`; expect import failure because the module does not exist.
- [ ] **Step 3: Implement the minimal module** with `analyze_page_reference()` and `compile_reconstruction_prompt()`. Use Pydantic validation and an injected/default LLM callable so tests exercise real parsing without network calls.
- [ ] **Step 4: Run tests to verify GREEN** using the same pytest command; expect all contract tests to pass.

### Task 2: Integrate And Persist The Analysis

**Files:**
- Modify: `slide-rule-python/tests/test_monitor_overview.py`
- Modify: `slide-rule-python/services/freeform_block.py`

- [ ] **Step 1: Write failing orchestration tests** asserting that a generated reference image is analyzed once, the compiled prompt reaches `generate_freeform_block`, and `pageReconstruction` persists ready/skipped/failed state.
- [ ] **Step 2: Run the focused tests to verify RED** with `slide-rule-python/.venv/Scripts/python.exe -m pytest slide-rule-python/tests/test_monitor_overview.py -q -k reconstruction`; expect missing analysis calls and persisted fields.
- [ ] **Step 3: Add minimal orchestration** after image generation and before palette/design generation. Add an optional `reconstruction_prompt` argument to `generate_freeform_block` and append it to the existing business/component prompt.
- [ ] **Step 4: Run focused tests to verify GREEN** with the same command.

### Task 3: Generate Complete Marketing Homepage Visuals

**Files:**
- Modify: `slide-rule-python/tests/test_monitor_overview.py`
- Modify: `slide-rule-python/services/freeform_block.py`

- [ ] **Step 1: Replace the existing Hero-only test** with a failing contract that requires a complete homepage composition, readable interface copy, primary action, content sections, and the authoritative device, while still forbidding watermarks and device mockups.
- [ ] **Step 2: Run that single test to verify RED** with `slide-rule-python/.venv/Scripts/python.exe -m pytest slide-rule-python/tests/test_monitor_overview.py::test_marketing_page_prompt_requests_a_complete_homepage_visual -q`.
- [ ] **Step 3: Add a complete marketing-page visual builder** and generate it concurrently with the independent text-free Hero media asset. Route only the complete visual through reconstruction analysis and screenshot comparison.
- [ ] **Step 4: Run the test to verify GREEN**.

### Task 4: Expose Runtime Schema And Verify Regression Safety

**Files:**
- Modify: `client/src/pages/sliderule/live-runtime/app-runtime-schema.ts`

- [ ] **Step 1: Add an optional TypeScript interface** for persisted reconstruction status/spec/prompt; runtime rendering remains unchanged.
- [ ] **Step 2: Run Python focused suites**: `test_page_reconstruction.py`, `test_monitor_overview.py`, `test_enrich_budget.py`, `test_app_preview.py`, and `test_freeform_self_verify.py`.
- [ ] **Step 3: Run static verification** with `pnpm exec tsc --noEmit --pretty false`.
- [ ] **Step 4: Inspect `git diff --check` and the final diff** for accidental generated artifacts, secrets, or unrelated changes.
