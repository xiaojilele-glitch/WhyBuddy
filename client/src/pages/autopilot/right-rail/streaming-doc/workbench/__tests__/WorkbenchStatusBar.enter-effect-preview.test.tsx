/**
 * whybuddy-stage3-unblock-2026-05-29 — regression contract for the new
 * "进入效果预演" CTA on the SPEC documents workbench status bar.
 *
 * Background: the user reported that when the autopilot pipeline parks at
 * stage 6 (spec_documents) there is no visible entry point to advance into
 * stage 7 (effect_preview). Server inspection (.tmp/stage3-probe.mjs)
 * confirmed that POST /api/blueprint/jobs/:id/effect-previews succeeds the
 * moment a SPEC tree exists, but `useAutoAdvance` only fires on
 * `stage === "spec_docs" && status === "completed"` while the server leaves
 * spec_docs at `status: "reviewing"` until docs are accepted. We add a
 * manual CTA to bridge the gap.
 *
 * This test is an SSR-only contract over WorkbenchStatusBar:
 *   - When `onEnterEffectPreview` is omitted, the button must NOT render.
 *   - When provided, the button renders with the canonical testid and the
 *     visible label adapts to `effectPreviewState`.
 *   - When `effectPreviewDisabled === true`, the button is disabled.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkbenchStatusBar } from "../WorkbenchStatusBar";

const BASE = {
  generating: null as "all" | "single" | null,
  onExport: () => {},
  onReview: () => {},
  onRefresh: () => {},
  locale: "zh-CN" as const,
};

describe("WorkbenchStatusBar · 进入效果预演 CTA", () => {
  it("does not render the button when onEnterEffectPreview is omitted", () => {
    const markup = renderToStaticMarkup(<WorkbenchStatusBar {...BASE} />);
    expect(markup).not.toContain(
      'data-testid="autopilot-workbench-action-enter-effect-preview"'
    );
  });

  it("renders the button with default zh label when onEnterEffectPreview is provided and state is idle", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar {...BASE} onEnterEffectPreview={() => {}} />
    );
    expect(markup).toContain(
      'data-testid="autopilot-workbench-action-enter-effect-preview"'
    );
    expect(markup).toContain("进入效果预演");
    expect(markup).toContain("#FF4500");
  });

  it("flips label to 生成中... when state is loading", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar
        {...BASE}
        onEnterEffectPreview={() => {}}
        effectPreviewState="loading"
      />
    );
    expect(markup).toContain("生成中...");
    expect(markup).toContain("animate-spin");
  });

  it("flips label to 已进入预演 when state is success", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar
        {...BASE}
        onEnterEffectPreview={() => {}}
        effectPreviewState="success"
      />
    );
    expect(markup).toContain("已进入预演");
    // Disabled in success state
    expect(markup).toContain('aria-disabled="true"');
  });

  it("flips label to 重试预演 when state is error", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar
        {...BASE}
        onEnterEffectPreview={() => {}}
        effectPreviewState="error"
      />
    );
    expect(markup).toContain("重试预演");
  });

  it("disables the button when effectPreviewDisabled is true", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar
        {...BASE}
        onEnterEffectPreview={() => {}}
        effectPreviewDisabled
      />
    );
    expect(markup).toContain('aria-disabled="true"');
  });

  it("renders English label when locale is en-US", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStatusBar
        {...BASE}
        locale="en-US"
        onEnterEffectPreview={() => {}}
      />
    );
    expect(markup).toContain("Enter Preview");
  });
});
