# Mobile Ant Design Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct desktop filter sizing and ensure every phone experience block uses Ant Design Mobile.

**Architecture:** Keep the existing experience-block schema and state callbacks. Route the four interactive phone block types through one lazily loaded mobile renderer, while retaining the existing Ant Design Pro renderer map for desktop.

**Tech Stack:** React 19, TypeScript, Ant Design 5, Ant Design Pro Components 2, Ant Design Mobile 5, Vitest.

---

### Task 1: Lock the device component contract

**Files:**
- Modify: `client/src/pages/sliderule/live-runtime/__tests__/ant-design-block-contract.test.tsx`

- [x] Add a desktop contract assertion for responsive QueryFilter spans.
- [x] Add source assertions for a lazy phone renderer and mobile-only imports.
- [x] Run the focused test and confirm the new assertions fail for the missing behavior.

### Task 2: Add mobile experience-block rendering

**Files:**
- Create: `client/src/pages/sliderule/live-runtime/phone-mobile/PhoneExperienceBlock.tsx`
- Modify: `client/src/pages/sliderule/live-runtime/AppRuntimeScreen.tsx`

- [x] Implement `FilterBar` with mobile `Form`, `Selector`, `DatePicker`, and `Button` controls.
- [x] Implement `MetricGrid`, `WorkflowTimeline`, and `QuickActionPanel` with mobile `Card`, `Grid`, `Steps`, and `Button` controls.
- [x] Lazy-load the renderer and select it only when `renderExperienceBlockScaffold(true)` renders one of the supported phone block types.

### Task 3: Correct desktop filter width

**Files:**
- Modify: `client/src/pages/sliderule/live-runtime/block-registry.tsx`

- [x] Give desktop Pro Form fields responsive `xs/sm/md/lg/xl` column spans.
- [x] Keep controls at full width within each grid cell.
- [x] Run the focused contract test and confirm all assertions pass.

### Task 4: Verify the full result

**Files:**
- Test: `client/src/pages/sliderule/live-runtime/__tests__/ant-design-block-contract.test.tsx`
- Test: `client/src/pages/sliderule/live-runtime/__tests__/phone-blocks-and-residue.test.ts`

- [x] Run focused Vitest tests.
- [x] Run TypeScript typecheck.
- [x] Run the production build.
- [x] Start the app and inspect desktop and phone layouts in the browser at the generated Sliderule session.
