import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { HUDElement } from "../types";
import { OverlayContainer } from "../OverlayContainer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVideoRef() {
  return createRef<HTMLVideoElement>();
}

function makeHUDElement(overrides: Partial<HUDElement> = {}): HUDElement {
  return {
    id: "hud-1",
    type: "nameTag",
    characterId: "char-1",
    screenPosition: { x: 0.5, y: 0.3 },
    visible: true,
    data: { name: "Alice" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Task 1.1 — OverlayContainer z-index layers
// ---------------------------------------------------------------------------

describe("OverlayContainer — layer structure (Task 1.1)", () => {
  it("renders a root container with all three layers", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span>UI content</span>
      </OverlayContainer>,
    );

    expect(markup).toContain('data-testid="ue-overlay-container"');
    expect(markup).toContain('data-testid="ue-overlay-video-layer"');
    expect(markup).toContain('data-testid="ue-overlay-ui-layer"');
    // HUD layer is only rendered when there are visible elements
  });

  it("renders the video layer at z-10", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("z-10");
  });

  it("renders the UI overlay layer at z-20", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("z-20");
  });

  it("renders the HUD layer at z-30 when HUD elements are provided", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer
        videoElement={makeVideoRef()}
        hudElements={[makeHUDElement()]}
      >
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("z-30");
    expect(markup).toContain('data-testid="ue-overlay-hud-layer"');
  });

  it("does not render the HUD layer when no HUD elements are provided", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span />
      </OverlayContainer>,
    );

    expect(markup).not.toContain('data-testid="ue-overlay-hud-layer"');
  });

  it("does not render the HUD layer when all elements are hidden", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer
        videoElement={makeVideoRef()}
        hudElements={[makeHUDElement({ visible: false })]}
      >
        <span />
      </OverlayContainer>,
    );

    expect(markup).not.toContain('data-testid="ue-overlay-hud-layer"');
  });

  it("renders children inside the UI overlay layer", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <div data-testid="child-content">Hello</div>
      </OverlayContainer>,
    );

    expect(markup).toContain('data-testid="child-content"');
    expect(markup).toContain("Hello");
  });
});

// ---------------------------------------------------------------------------
// Task 1.2 — Video stream aspect ratio
// ---------------------------------------------------------------------------

describe("OverlayContainer — video aspect ratio (Task 1.2)", () => {
  it("applies 16:9 aspect ratio to the video element", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("aspect-ratio:16 / 9");
  });

  it("uses object-contain on the video element", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("object-contain");
  });

  it("renders a <video> element with autoplay, muted, and playsInline", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("<video");
    expect(markup).toContain("autoPlay");
    expect(markup).toContain("muted");
  });
});

// ---------------------------------------------------------------------------
// Task 1.3 — UI overlay backdrop-filter and semi-transparent background
// ---------------------------------------------------------------------------

describe("OverlayContainer — UI overlay styling (Task 1.3)", () => {
  it("applies backdrop-filter blur to the UI overlay layer", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("backdrop-filter:blur(8px)");
  });

  it("applies semi-transparent background to the UI overlay layer", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("rgba(0, 0, 0, 0.15)");
  });

  it("sets pointer-events-none on the UI overlay by default", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("pointer-events-none");
  });

  it("does not set pointer-events-none when pointerPassthrough is false", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer
        videoElement={makeVideoRef()}
        pointerPassthrough={false}
      >
        <span />
      </OverlayContainer>,
    );

    // The UI layer should NOT have pointer-events-none
    // We check the UI layer specifically
    const uiLayerMatch = markup.match(
      /data-testid="ue-overlay-ui-layer"[^>]*/,
    );
    expect(uiLayerMatch).toBeTruthy();
    expect(uiLayerMatch![0]).not.toContain("pointer-events-none");
  });
});

// ---------------------------------------------------------------------------
// HUD element rendering
// ---------------------------------------------------------------------------

describe("OverlayContainer — HUD elements", () => {
  it("renders a nameTag HUD element with the character name", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer
        videoElement={makeVideoRef()}
        hudElements={[makeHUDElement({ data: { name: "Bob" } })]}
      >
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("Bob");
    expect(markup).toContain('data-hud-type="nameTag"');
  });

  it("renders a statusIcon HUD element", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer
        videoElement={makeVideoRef()}
        hudElements={[
          makeHUDElement({
            id: "hud-icon",
            type: "statusIcon",
            data: { icon: "★" },
          }),
        ]}
      >
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("★");
    expect(markup).toContain('data-hud-type="statusIcon"');
  });

  it("renders a progressBar HUD element", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer
        videoElement={makeVideoRef()}
        hudElements={[
          makeHUDElement({
            id: "hud-bar",
            type: "progressBar",
            data: { progress: 75 },
          }),
        ]}
      >
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain('data-hud-type="progressBar"');
    expect(markup).toContain("width:75%");
  });

  it("positions HUD elements using normalised screen coordinates", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer
        videoElement={makeVideoRef()}
        hudElements={[
          makeHUDElement({ screenPosition: { x: 0.25, y: 0.75 } }),
        ]}
      >
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("left:25%");
    expect(markup).toContain("top:75%");
  });

  it("positions HUD elements within the measured video frame when letterboxed", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer
        videoElement={makeVideoRef()}
        videoFrame={{ left: 160, top: 0, width: 960, height: 540 }}
        hudElements={[
          makeHUDElement({
            screenPosition: { x: 0.25, y: 0.5 },
            scale: 0.9,
          }),
        ]}
      >
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain("left:400px");
    expect(markup).toContain("top:270px");
    expect(markup).toContain("scale(0.9)");
    expect(markup).toContain('data-hud-scale="0.9"');
  });

  it("only renders visible HUD elements", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer
        videoElement={makeVideoRef()}
        hudElements={[
          makeHUDElement({ id: "visible", visible: true, data: { name: "V" } }),
          makeHUDElement({
            id: "hidden",
            visible: false,
            data: { name: "H" },
          }),
        ]}
      >
        <span />
      </OverlayContainer>,
    );

    expect(markup).toContain('data-hud-id="visible"');
    expect(markup).not.toContain('data-hud-id="hidden"');
  });
});
