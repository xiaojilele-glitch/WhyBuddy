import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UEOverlayChrome } from "../UEOverlayChrome";
import type { HUDDefinition, HUDElement } from "../types";

function makeVideoRef() {
  return createRef<HTMLVideoElement>();
}

const hudDefinition: HUDDefinition = {
  id: "definition-name",
  type: "nameTag",
  characterId: "agent-1",
  data: { name: "Hidden until UE update" },
};

const explicitHUDElement: HUDElement = {
  id: "explicit-name",
  type: "nameTag",
  characterId: "agent-1",
  screenPosition: { x: 0.5, y: 0.4 },
  visible: true,
  data: { name: "Explicit HUD" },
};

describe("UEOverlayChrome", () => {
  it("renders sidebar and work panels inside the OverlayContainer UI layer", () => {
    const markup = renderToStaticMarkup(
      <UEOverlayChrome
        videoElement={makeVideoRef()}
        mediaLayer={<div data-testid="scene-media">scene</div>}
        sidebar={<aside data-testid="app-sidebar">sidebar</aside>}
        viewportWidth={1440}
      >
        <section data-testid="task-panel">task panel</section>
        <section data-testid="launch-panel">launch panel</section>
      </UEOverlayChrome>,
    );

    expect(markup).toContain('data-testid="ue-overlay-container"');
    expect(markup).toContain('data-testid="ue-overlay-chrome"');
    expect(markup).toContain('data-testid="ue-overlay-sidebar-slot"');
    expect(markup).toContain('data-testid="app-sidebar"');
    expect(markup).toContain('data-testid="task-panel"');
    expect(markup).toContain('data-testid="launch-panel"');
    expect(markup).toContain("pointer-events-auto");
  });

  it("marks desktop layout at 1280px and above", () => {
    const markup = renderToStaticMarkup(
      <UEOverlayChrome videoElement={makeVideoRef()} viewportWidth={1280}>
        <div />
      </UEOverlayChrome>,
    );

    expect(markup).toContain('data-overlay-layout="desktop"');
  });

  it("marks narrow layout below 1280px", () => {
    const markup = renderToStaticMarkup(
      <UEOverlayChrome videoElement={makeVideoRef()} viewportWidth={1024}>
        <div />
      </UEOverlayChrome>,
    );

    expect(markup).toContain('data-overlay-layout="narrow"');
  });

  it("uses synced HUD definitions when explicit HUD elements are not supplied", () => {
    const markup = renderToStaticMarkup(
      <UEOverlayChrome
        videoElement={makeVideoRef()}
        hudDefinitions={[hudDefinition]}
      >
        <div />
      </UEOverlayChrome>,
    );

    expect(markup).not.toContain('data-testid="ue-overlay-hud-layer"');
    expect(markup).not.toContain("Hidden until UE update");
  });

  it("keeps explicit HUD elements as the caller override", () => {
    const markup = renderToStaticMarkup(
      <UEOverlayChrome
        videoElement={makeVideoRef()}
        hudDefinitions={[hudDefinition]}
        hudElements={[explicitHUDElement]}
      >
        <div />
      </UEOverlayChrome>,
    );

    expect(markup).toContain('data-testid="ue-overlay-hud-layer"');
    expect(markup).toContain("Explicit HUD");
    expect(markup).not.toContain("Hidden until UE update");
  });
});
