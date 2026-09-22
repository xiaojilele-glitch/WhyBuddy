# Ant Design Pro Workbench Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give generated business pages distinct Ant Design Pro work surfaces instead of repeating one table-card template.

**Architecture:** Extend the five-system page schema with a small validated surface contract, derive a deterministic fallback for old models, and route the desktop primary entity area through focused Pro Components renderers. Keep kanban, calendar, freeform overview, and the mobile shell on their existing ownership paths.

**Tech Stack:** React 19, TypeScript, Ant Design 5.29.3, Ant Design Pro Components 2.8.10, Vitest, pytest.

---

### Task 1: Add The Surface Contract

**Files:**
- Modify: `client/src/pages/sliderule/system-screens/five-system-model.ts`
- Modify: `client/src/pages/sliderule/live-runtime/app-runtime-schema.ts`
- Test: `client/src/pages/sliderule/__tests__/app-runtime-schema.test.ts`

- [ ] Write failing tests for preserving valid surfaces and deterministic legacy fallback.
- [ ] Run the focused schema tests and confirm the missing contract fails.
- [ ] Add the controlled type/density contract and normalizer.
- [ ] Re-run the focused tests.

### Task 2: Validate Generation Output

**Files:**
- Modify: `slide-rule-python/services/schema_legal.py`
- Modify: `slide-rule-python/services/v5_model_gate.py`
- Test: `slide-rule-python/tests/test_v5_llm_generate_gate.py`
- Test: `slide-rule-python/tests/test_schema_legal_source.py`

- [ ] Write failing tests for legal and illegal surface declarations.
- [ ] Run the focused Python tests and confirm failure.
- [ ] Add prompt guidance and Gate validation.
- [ ] Re-run the focused tests.

### Task 3: Add Pro Components

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] Install `@ant-design/pro-components@2.8.10` with pnpm.
- [ ] Verify the resolved peer dependencies use the repository's Ant Design 5.

### Task 4: Render Typed Work Surfaces

**Files:**
- Create: `client/src/pages/sliderule/live-runtime/ProWorkbenchSurface.tsx`
- Modify: `client/src/pages/sliderule/live-runtime/AppRuntimeScreen.tsx`
- Test: `client/src/pages/sliderule/live-runtime/__tests__/pro-workbench-surface.test.tsx`

- [ ] Write failing renderer tests for table, editable-table, split-list, and queue markers.
- [ ] Run the focused tests and confirm the renderer is missing.
- [ ] Implement ProTable, EditableProTable, ProList, ProDescriptions, and queue segmentation using existing runtime rows and field metadata.
- [ ] Route only desktop workbench primary content through the new renderer.
- [ ] Re-run all live-runtime tests.

### Task 5: Verify Real Output

**Files:**
- No production file changes expected.

- [ ] Run TypeScript and focused Python tests.
- [ ] Start all services.
- [ ] Run the persisted real gym topic through desktop and phone page traversal.
- [ ] Review screenshots for hierarchy, overflow, repetition, and mobile regressions.
