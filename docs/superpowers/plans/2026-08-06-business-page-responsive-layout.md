# Business Page Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Give generated business pages a validated responsive grid layout while preserving existing five-slot models.

**Architecture:** Normalize declarations into breakpoint grid items, render through CSS Grid, and keep block rendering behind the registry. Old slots are upgraded by page kind using React Grid Layout fallback and compaction semantics without adding its editor runtime.

**Tech Stack:** React 19, TypeScript, Vitest, CSS Grid, Python, pytest

---

### Task 1: Responsive layout normalization

**Files:**
- Create: client/src/pages/sliderule/live-runtime/business-page-layout.ts
- Create: client/src/pages/sliderule/live-runtime/__tests__/business-page-layout.test.ts
- Modify: client/src/pages/sliderule/live-runtime/app-runtime-schema.ts

- [ ] Write failing tests for grid validation, fallback, bounds, duplicates, and slot upgrade.
- [ ] Run focused Vitest and confirm the normalizer is missing.
- [ ] Implement pure normalization and preset functions.
- [ ] Run focused Vitest and existing layout schema tests.

### Task 2: Business page grid renderer

**Files:**
- Create: client/src/pages/sliderule/live-runtime/BusinessPageGrid.tsx
- Create: client/src/pages/sliderule/live-runtime/__tests__/business-page-grid.test.tsx
- Modify: client/src/pages/sliderule/live-runtime/AppRuntimeScreen.tsx

- [ ] Write failing tests for grid placement, phone ordering, orphan fallback, and one page-content surface.
- [ ] Run focused tests and confirm the legacy scaffold fails.
- [ ] Add the renderer and route business blocks plus primary view through it.
- [ ] Run focused runtime and phone tests.

### Task 3: Generation and Gate contract

**Files:**
- Modify: client/src/pages/sliderule/system-screens/five-system-model.ts
- Modify: slide-rule-python/services/schema_legal.py
- Modify: slide-rule-python/services/v5_model_gate.py
- Modify: slide-rule-python/tests/test_v5_llm_generate_gate.py
- Modify: slide-rule-python/tests/test_schema_legal_source.py

- [ ] Write failing Gate tests for breakpoints, coordinates, bounds, duplicates, and dangling refs.
- [ ] Run focused pytest and confirm failures.
- [ ] Extend prompt and Gate while retaining old slot validation.
- [ ] Run focused Gate and source-of-truth tests.

### Task 4: Theme-safe fixed components

**Files:**
- Modify: client/src/pages/sliderule/live-runtime/block-registry.tsx
- Modify: client/src/pages/sliderule/live-runtime/PageViews.tsx
- Modify: client/src/pages/sliderule/live-runtime/__tests__/block-renderers.test.tsx

- [ ] Write failing theme assertions.
- [ ] Replace hard-coded white/stone surfaces in touched components.
- [ ] Run renderer, kanban, calendar, and dark-recipe tests.

### Task 5: Verification

- [ ] Run all focused frontend tests.
- [ ] Run focused Python tests.
- [ ] Run pnpm exec tsc --noEmit --pretty false.
- [ ] Start the app and capture desktop plus phone screenshots.
- [ ] Compare hierarchy, theme continuity, overflow, and repetition against the previous screenshot.
