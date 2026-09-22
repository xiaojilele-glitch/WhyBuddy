import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ExperienceBlockBoundary,
  type ExperienceBlockInstance,
  type FreeformNode,
} from "../block-registry";

function render(root: FreeformNode, previewId?: string): string {
  const block: ExperienceBlockInstance = {
    id: "hero",
    type: "FreeformInsight",
    freeformContent: { root: root as unknown as Record<string, unknown> },
  };
  return renderToStaticMarkup(
    <ExperienceBlockBoundary
      block={block}
      sessionId="session with spaces"
      previewId={previewId}
    />
  );
}

describe("FreeformInsight imageRef", () => {
  it("renders the trusted current-session landing asset", () => {
    const html = render({
      tag: "div",
      imageRef: "landing-hero",
      imageAlt: "沙漠星空营地",
      style: { height: "480px" },
    });

    expect(html).toContain('<img src="/api/sliderule/sessions/session%20with%20spaces/preview?source=sheet"');
    expect(html).toContain('alt="沙漠星空营地"');
  });

  it("does not interpret arbitrary image references as URLs", () => {
    const html = render({
      tag: "div",
      imageRef: "javascript:alert(1)",
      imageAlt: "bad",
    } as unknown as FreeformNode);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });

  it("resolves the trusted hero through the temporary preview token", () => {
    const html = render(
      { tag: "div", imageRef: "landing-hero", imageAlt: "preview" },
      "preview with spaces"
    );

    expect(html).toContain(
      'src="/api/sliderule/freeform-preview/preview%20with%20spaces/media/landing-hero"'
    );
    expect(html).not.toContain("/sessions/");
  });
});
