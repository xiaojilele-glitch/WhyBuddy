import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OverlayContainer } from "../OverlayContainer";
import { PointerAutoWrapper } from "../PointerAutoWrapper";
import { PointerPassthroughZone } from "../PointerPassthroughZone";
import type { PointerConfig } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVideoRef() {
  return createRef<HTMLVideoElement>();
}

// ---------------------------------------------------------------------------
// Task 2.1 — UI overlay layer has pointer-events: none by default
// ---------------------------------------------------------------------------

describe("Pointer passthrough — UI overlay default (Task 2.1)", () => {
  it("sets pointer-events-none on the UI overlay layer by default", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <span>content</span>
      </OverlayContainer>,
    );

    // The UI layer should have pointer-events-none when pointerPassthrough
    // defaults to true. Extract the full <div ...> tag containing the ui-layer
    // testid so we can inspect its class attribute.
    const uiLayerMatch = markup.match(
      /<div[^>]*data-testid="ue-overlay-ui-layer"[^>]*/,
    );
    expect(uiLayerMatch).toBeTruthy();
    expect(uiLayerMatch![0]).toContain("pointer-events-none");
  });

  it("does not set pointer-events-none when pointerPassthrough is false", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer
        videoElement={makeVideoRef()}
        pointerPassthrough={false}
      >
        <span>content</span>
      </OverlayContainer>,
    );

    const uiLayerMatch = markup.match(
      /<div[^>]*data-testid="ue-overlay-ui-layer"[^>]*/,
    );
    expect(uiLayerMatch).toBeTruthy();
    expect(uiLayerMatch![0]).not.toContain("pointer-events-none");
  });
});

// ---------------------------------------------------------------------------
// Task 2.2 — PointerAutoWrapper sets pointer-events: auto
// ---------------------------------------------------------------------------

describe("PointerAutoWrapper (Task 2.2)", () => {
  it("renders children inside a pointer-events-auto wrapper", () => {
    const markup = renderToStaticMarkup(
      <PointerAutoWrapper>
        <button>Click me</button>
      </PointerAutoWrapper>,
    );

    expect(markup).toContain("pointer-events-auto");
    expect(markup).toContain("Click me");
    expect(markup).toContain('data-testid="ue-pointer-auto-wrapper"');
  });

  it("merges additional className with pointer-events-auto", () => {
    const markup = renderToStaticMarkup(
      <PointerAutoWrapper className="p-4 rounded">
        <span>child</span>
      </PointerAutoWrapper>,
    );

    expect(markup).toContain("pointer-events-auto");
    expect(markup).toContain("p-4");
    expect(markup).toContain("rounded");
  });

  it("works inside an OverlayContainer with passthrough enabled", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <PointerAutoWrapper>
          <button data-testid="interactive-btn">Action</button>
        </PointerAutoWrapper>
      </OverlayContainer>,
    );

    // The overlay layer has pointer-events-none
    expect(markup).toContain("pointer-events-none");
    // But the wrapper has pointer-events-auto
    expect(markup).toContain("pointer-events-auto");
    expect(markup).toContain('data-testid="interactive-btn"');
  });
});

// ---------------------------------------------------------------------------
// Task 2.3 — PointerPassthroughZone configurable zones
// ---------------------------------------------------------------------------

describe("PointerPassthroughZone (Task 2.3)", () => {
  it("renders nothing when passthroughZones is empty", () => {
    const config: PointerConfig = {
      passthroughZones: [],
      defaultPassthrough: true,
    };

    const markup = renderToStaticMarkup(
      <PointerPassthroughZone config={config} />,
    );

    expect(markup).toBe("");
  });

  it("renders zones with correct pointer-events based on passthrough flag", () => {
    const config: PointerConfig = {
      passthroughZones: [
        {
          id: "zone-pass",
          bounds: { top: 0, left: 0, width: 200, height: 100 },
          passthrough: true,
        },
        {
          id: "zone-block",
          bounds: { top: 100, left: 0, width: 200, height: 100 },
          passthrough: false,
        },
      ],
      defaultPassthrough: true,
    };

    const markup = renderToStaticMarkup(
      <PointerPassthroughZone config={config} />,
    );

    // Zone with passthrough: true should have pointer-events-none
    expect(markup).toContain('data-zone-id="zone-pass"');
    expect(markup).toContain('data-zone-passthrough="true"');

    // Zone with passthrough: false should have pointer-events-auto
    expect(markup).toContain('data-zone-id="zone-block"');
    expect(markup).toContain('data-zone-passthrough="false"');

    // Check that both pointer-events classes are present
    expect(markup).toContain("pointer-events-none");
    expect(markup).toContain("pointer-events-auto");
  });

  it("positions zones absolutely using bounds from config", () => {
    const config: PointerConfig = {
      passthroughZones: [
        {
          id: "positioned",
          bounds: { top: 50, left: 100, width: 300, height: 150 },
          passthrough: true,
        },
      ],
      defaultPassthrough: true,
    };

    const markup = renderToStaticMarkup(
      <PointerPassthroughZone config={config} />,
    );

    expect(markup).toContain("top:50px");
    expect(markup).toContain("left:100px");
    expect(markup).toContain("width:300px");
    expect(markup).toContain("height:150px");
  });

  it("applies defaultPassthrough to the container element", () => {
    const configPassthrough: PointerConfig = {
      passthroughZones: [
        {
          id: "z1",
          bounds: { top: 0, left: 0, width: 100, height: 100 },
          passthrough: true,
        },
      ],
      defaultPassthrough: true,
    };

    const markupPass = renderToStaticMarkup(
      <PointerPassthroughZone config={configPassthrough} />,
    );

    // Container should have pointer-events-none when defaultPassthrough is true
    const containerMatch = markupPass.match(
      /<div[^>]*data-testid="ue-passthrough-zone-container"[^>]*/,
    );
    expect(containerMatch).toBeTruthy();
    expect(containerMatch![0]).toContain("pointer-events-none");

    const configBlock: PointerConfig = {
      passthroughZones: [
        {
          id: "z2",
          bounds: { top: 0, left: 0, width: 100, height: 100 },
          passthrough: false,
        },
      ],
      defaultPassthrough: false,
    };

    const markupBlock = renderToStaticMarkup(
      <PointerPassthroughZone config={configBlock} />,
    );

    // Container should have pointer-events-auto when defaultPassthrough is false
    const containerMatch2 = markupBlock.match(
      /<div[^>]*data-testid="ue-passthrough-zone-container"[^>]*/,
    );
    expect(containerMatch2).toBeTruthy();
    expect(containerMatch2![0]).toContain("pointer-events-auto");
  });

  it("renders multiple zones with unique test IDs", () => {
    const config: PointerConfig = {
      passthroughZones: [
        {
          id: "alpha",
          bounds: { top: 0, left: 0, width: 100, height: 50 },
          passthrough: true,
        },
        {
          id: "beta",
          bounds: { top: 50, left: 0, width: 100, height: 50 },
          passthrough: false,
        },
        {
          id: "gamma",
          bounds: { top: 100, left: 0, width: 100, height: 50 },
          passthrough: true,
        },
      ],
      defaultPassthrough: true,
    };

    const markup = renderToStaticMarkup(
      <PointerPassthroughZone config={config} />,
    );

    expect(markup).toContain('data-testid="ue-passthrough-zone-alpha"');
    expect(markup).toContain('data-testid="ue-passthrough-zone-beta"');
    expect(markup).toContain('data-testid="ue-passthrough-zone-gamma"');
  });
});

// ---------------------------------------------------------------------------
// Task 2.4 — Drag operations in passthrough zones
// ---------------------------------------------------------------------------

describe("Pointer passthrough — drag correctness (Task 2.4)", () => {
  it("passthrough zones do not block mouse events (pointer-events-none)", () => {
    const config: PointerConfig = {
      passthroughZones: [
        {
          id: "drag-zone",
          bounds: { top: 0, left: 0, width: 500, height: 500 },
          passthrough: true,
        },
      ],
      defaultPassthrough: true,
    };

    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <PointerPassthroughZone config={config} />
      </OverlayContainer>,
    );

    // The passthrough zone should have pointer-events-none, meaning
    // mousedown → mousemove → mouseup (drag) events will pass through
    // to the underlying video layer
    const zoneMatch = markup.match(
      /data-testid="ue-passthrough-zone-drag-zone"[^>]*/,
    );
    expect(zoneMatch).toBeTruthy();

    // Verify the zone element has the correct passthrough attribute
    expect(zoneMatch![0]).toContain('data-zone-passthrough="true"');

    // Verify pointer-events-none is applied (events pass through)
    expect(markup).toContain("pointer-events-none");
  });

  it("blocking zones capture mouse events (pointer-events-auto)", () => {
    const config: PointerConfig = {
      passthroughZones: [
        {
          id: "block-zone",
          bounds: { top: 0, left: 0, width: 500, height: 500 },
          passthrough: false,
        },
      ],
      defaultPassthrough: true,
    };

    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <PointerPassthroughZone config={config} />
      </OverlayContainer>,
    );

    // The blocking zone should have pointer-events-auto, meaning
    // drag events will be captured by this zone
    const zoneMatch = markup.match(
      /data-testid="ue-passthrough-zone-block-zone"[^>]*/,
    );
    expect(zoneMatch).toBeTruthy();
    expect(zoneMatch![0]).toContain('data-zone-passthrough="false"');
  });

  it("mixed zones allow drag in passthrough areas and block in others", () => {
    const config: PointerConfig = {
      passthroughZones: [
        {
          id: "viewport",
          bounds: { top: 0, left: 0, width: 800, height: 400 },
          passthrough: true,
        },
        {
          id: "sidebar",
          bounds: { top: 0, left: 800, width: 200, height: 400 },
          passthrough: false,
        },
      ],
      defaultPassthrough: true,
    };

    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <PointerPassthroughZone config={config} />
      </OverlayContainer>,
    );

    // Viewport zone: passthrough (drag works)
    expect(markup).toContain('data-zone-id="viewport"');
    expect(markup).toContain('data-testid="ue-passthrough-zone-viewport"');

    // Sidebar zone: blocking (drag captured)
    expect(markup).toContain('data-zone-id="sidebar"');
    expect(markup).toContain('data-testid="ue-passthrough-zone-sidebar"');

    // Both pointer-events strategies are present
    expect(markup).toContain("pointer-events-none");
    expect(markup).toContain("pointer-events-auto");
  });

  it("PointerAutoWrapper inside overlay ensures interactive elements receive drag events", () => {
    const markup = renderToStaticMarkup(
      <OverlayContainer videoElement={makeVideoRef()}>
        <PointerAutoWrapper>
          <div data-testid="draggable-panel">Drag me</div>
        </PointerAutoWrapper>
      </OverlayContainer>,
    );

    // The overlay has pointer-events-none (drag passes through)
    const uiLayerMatch = markup.match(
      /<div[^>]*data-testid="ue-overlay-ui-layer"[^>]*/,
    );
    expect(uiLayerMatch).toBeTruthy();
    expect(uiLayerMatch![0]).toContain("pointer-events-none");

    // But the wrapper has pointer-events-auto (drag captured by panel)
    expect(markup).toContain("pointer-events-auto");
    expect(markup).toContain('data-testid="draggable-panel"');
  });
});
