/**
 * autopilot-image-rendering-and-visual-system · Phase 4 · Task 37.2 (downgrade)
 *
 * Production-snapshot closure proof for the `/projects` cockpit
 * surface — DOWNGRADED variant per Task 37.3.
 *
 * ## Why an SSR snapshot instead of Playwright
 *
 * Phase 4 Task 37.2 originally specified a Playwright e2e test
 * navigating to `/projects`, asserting `<ProjectMainChainTimeline>`
 * is visible AND that the page's primary navigation / header / main
 * action region is also visible and not occluded by the timeline (via
 * bounding-box overlap checks: `timelineBox.bottom <= navBox.top`).
 *
 * Task 37.3 explicitly authorizes a downgrade when Playwright is not
 * present in the repository. Repo verification on 2026-05-24:
 * - workspace-wide grep for `playwright` across all package.json files
 *   returned 0 matches;
 * - no `playwright.config.ts` and no root-level `e2e/` directory exist;
 * - the `services/lobster-executor` references to `"browser.playwright"`
 *   are skill-capability metadata strings, not actual installed
 *   packages.
 *
 * This test substitutes the Playwright route + bounding-box
 * assertion with two SSR-level invariants:
 *
 * 1. Both the timeline anchor AND the `<Home />` content anchor are
 *    present in the same rendered markup.
 * 2. The timeline anchor appears BEFORE the `<Home />` content anchor
 *    in document order.
 *
 * Document-order is the SSR-equivalent guarantee: in normal block
 * flow, an earlier sibling cannot occlude a later one because the
 * later one is laid out below it. This is the strongest layout
 * invariant we can prove without a real layout engine. The companion
 * `ProjectCockpitHome.layout.test.tsx` (Task 36.2) covers the
 * complementary «no `position: fixed` overlay» invariant.
 *
 * ## What this test PROVES
 *
 * - `<ProjectMainChainTimeline>` is mounted on the production
 *   `<ProjectCockpitHome>` surface (the page actually rendered at
 *   `/projects`).
 * - The `<Home />` body is also mounted on the same page.
 * - The timeline appears in document order BEFORE `<Home />`.
 * - Combined with Task 36.2's «no `position: fixed`» invariant, this
 *   closure proof matches the original Task 37.2 «timeline does not
 *   occlude Home / nav» intent.
 *
 * ## What this test does NOT prove
 *
 * - It does NOT load the React frontend in a real browser.
 * - It does NOT measure actual bounding boxes, computed CSS, or
 *   stacking contexts. A future regression that uses CSS transforms,
 *   negative margins, or absolute positioning to overlap them would
 *   require a real browser to detect. Task 36.2's structural
 *   `position: fixed` check + this document-order check are the
 *   strongest substitutes available without a layout engine.
 * - It does NOT take a screenshot artifact. The original Task 37.2
 *   listed a `e2e/__screenshots__/projects-cockpit-home.png` artifact;
 *   the downgrade produces no image artifact. Visual diffing would
 *   require Playwright or an equivalent screenshotter.
 *
 * ## Closure mapping back to Task 37
 *
 *   Task 37.1 (Playwright effect_preview route)
 *     → SSR-snapshot:    EffectPreviewPanel.production-snapshot.test.tsx
 *     → API-reachability:  server/tests/blueprint-image-settings.smoke.test.ts
 *   Task 37.2 (Playwright /projects route + bounding-box overlap)
 *     → SSR-snapshot:    this file
 *     → Layout regression: ProjectCockpitHome.layout.test.tsx (Task 36.2)
 *   Task 37.3 (downgrade decision)
 *     → Documented in all three test preambles + tasks.md final report.
 *
 * @see Requirements 14.4, 17.1
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock setup — mirror the pattern from ProjectCockpitHome.layout.test.tsx so
// the production component renders without pulling in Home's full dependency
// graph (3D scene, hooks, IndexedDB, etc.).
// ---------------------------------------------------------------------------

vi.mock("../Home", () => ({
  __esModule: true,
  default: () => (
    <div
      data-testid="home-mock"
      data-region="home-mock-primary-content"
    />
  ),
}));

const projectState = {
  currentProjectId: null as string | null,
  projects: [] as Array<Record<string, unknown>>,
  clarificationQuestions: [] as Array<Record<string, unknown>>,
  missions: [] as Array<Record<string, unknown>>,
  evidence: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/project-store", () => ({
  useProjectStore: (selector: (state: typeof projectState) => unknown) =>
    selector(projectState),
}));

// Defer the import so the mocks above register before the component
// resolves its dependencies.
async function renderCockpitMarkup(): Promise<string> {
  const { default: ProjectCockpitHome } = await import("../ProjectCockpitHome");
  return renderToStaticMarkup(<ProjectCockpitHome />);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("ProjectCockpitHome · Phase 4 Task 37.2 (downgraded) production snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectState.currentProjectId = null;
    projectState.projects = [];
    projectState.clarificationQuestions = [];
    projectState.missions = [];
    projectState.evidence = [];
  });

  it("renders the timeline AND the Home body, with the timeline preceding Home in document order", async () => {
    const markup = await renderCockpitMarkup();

    // Both anchors must be present.
    const timelineMatch = markup.match(
      /<[^>]+data-component=["']project-main-chain-timeline["'][^>]*>/i,
    );
    expect(timelineMatch).not.toBeNull();

    const homeMatch = markup.match(
      /<[^>]+data-testid=["']home-mock["'][^>]*>/i,
    );
    expect(homeMatch).not.toBeNull();

    // Document-order invariant: timeline anchor index < Home anchor index.
    // This is the SSR-level proof that, in normal block flow, the
    // timeline cannot occlude the Home content — it is laid out above
    // (before) Home, not on top of it.
    const timelineIdx = markup.indexOf(timelineMatch![0]);
    const homeIdx = markup.indexOf(homeMatch![0]);
    expect(timelineIdx).toBeGreaterThanOrEqual(0);
    expect(homeIdx).toBeGreaterThan(timelineIdx);

    // Defense in depth: same invariant must already be enforced by
    // Task 36.2's `ProjectCockpitHome.layout.test.tsx`, but we duplicate
    // here so the closure proof for Task 37.2 is self-contained — a
    // future refactor that flips Home above the timeline would fail
    // both tests independently.
  });

  it("does NOT render the timeline as a position:fixed overlay over Home", async () => {
    const markup = await renderCockpitMarkup();

    // `position: fixed` would let the timeline visually occlude Home
    // even if it precedes Home in document order. The companion
    // `ProjectCockpitHome.layout.test.tsx` covers this in detail; we
    // re-check the most direct invariant here so the closure proof
    // for 37.2 doesn't depend on a sibling test still being present
    // in a future refactor.
    expect(markup).not.toMatch(
      /data-component=["']project-main-chain-timeline["'][^>]*position:\s*fixed/i,
    );
    expect(markup).not.toMatch(
      /position:\s*fixed[^>]*data-component=["']project-main-chain-timeline["']/i,
    );
  });
});
