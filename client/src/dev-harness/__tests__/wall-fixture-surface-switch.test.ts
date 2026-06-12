/**
 * Lightweight source-level guard for the dev harness surface switch.
 *
 * Ensures that ?surface=2d path in the wall fixture entry actually renders
 * the 2D ReasoningFlowSurface harness (and not only the 3D wall).
 * This protects the visual QA entry point introduced for the 2D reasoning map work.
 *
 * This is a fast source canary only (string + targeted regex for known footguns).
 * It will NOT catch TSX syntax errors, missing CSS, or render failures by itself.
 *
 * Recommended real smoke for this entry:
 *   1. pnpm exec tsc --noEmit
 *   2. (optional) start vite dev, then Playwright:
 *      open http://localhost:3000/wall-fixture.html?surface=2d
 *      assert: no Vite error overlay (.vite-error-overlay), and styled cards/minimap exist
 *
 * The dedicated "no TSX syntax errors in attributes..." test below specifically guards
 * against the previous JSX-comment-in-prop and missing F-key-editable-guard regressions.
 *
 * Pattern follows other source-assertion tests in the repo (e.g. blueprint-wall-*.test.ts).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const mainSource = () =>
  readFileSync(resolve(here, "../wall-fixture-main.tsx"), "utf8");

const surfaceSource = () =>
  readFileSync(resolve(here, "../ReasoningFlow2DHarness.tsx"), "utf8"); // indirect, but we also read the surface directly for key fixes
const surfaceFile = () =>
  readFileSync(resolve(here, "../../components/autopilot/ReasoningFlowSurface.tsx"), "utf8");

describe("wall-fixture surface switch (?surface=2d)", () => {
  it("conditionally renders ReasoningFlow2DHarness when surface=2d", () => {
    const source = mainSource();

    expect(source).toContain("ReasoningFlow2DHarness");
    expect(source).toContain("const use2D = url.searchParams.get(\"surface\") === \"2d\"");
    expect(source).toContain("use2D ? <ReasoningFlow2DHarness /> : <WallFixtureHarness />");
  });

  it("surface module has no TSX syntax errors in attributes and uses safe color for marker", () => {
    const surf = surfaceFile();
    // No JSX comments inside attribute expressions (the previous blocker)
    expect(surf).not.toMatch(/color=\{[^}]*\}\s*\{\/\*/);
    // Uses per-color markers (computed at render from EDGE_COLORS) with direct fill for reliable edge arrow colors
    // (no fragile currentColor / style=color inheritance from <defs>)
    expect(surf).toMatch(/Per-color markers for reliable arrowhead colors/);
    expect(surf).toMatch(/`arrow-\$\{col\.replace\('#', ''\)\}`|arrowId = `arrow-/);
    expect(surf).toMatch(/markerEnd=\{`url\(\#\$/);
    // F shortcut has editable target guard (to prevent polluting inputs when embedded)
    expect(surf).toMatch(/isEditable|tagName === "INPUT"|isContentEditable/);
    // Mobile pan: ref-based drag + touch-action to avoid stale isDragging and page scroll
    expect(surf).toContain("isDraggingRef");
    expect(surf).toContain('touchAction: "none"');
    expect(surf).toContain("passive: false");
  });

  it("surface module uses product推演 semantics (no legal-domain fallback words)", () => {
    const surf = surfaceFile();
    // 防止法律/养犬场景的 fallback 词回流到产品推演平台
    expect(surf).not.toContain("法律依据");
    expect(surf).not.toContain("处罚阶梯");
    expect(surf).not.toContain("地方差异");
    expect(surf).not.toContain("累计认定");
    expect(surf).not.toContain("法律条款");
    expect(surf).not.toContain("法律条文");
  });

  it("still renders the original 3D WallFixtureHarness by default", () => {
    const source = mainSource();

    expect(source).toContain("WallFixtureHarness");
    // The ternary ensures both paths exist in the module
    expect(source).toMatch(/use2D \? <ReasoningFlow2DHarness[\s\S]*? : <WallFixtureHarness/);
  });
});