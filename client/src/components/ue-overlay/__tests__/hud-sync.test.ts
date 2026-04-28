import { describe, expect, it } from "vitest";

import {
  applyHUDPositionUpdate,
  buildHUDElementsFromDefinitions,
  resolveHUDScale,
  resolveVideoFrame,
} from "../hud-sync";
import type { HUDDefinition, HUDElement, HUDPositionUpdate } from "../types";

function makeDefinition(overrides: Partial<HUDDefinition> = {}): HUDDefinition {
  return {
    id: "hud-agent-1",
    type: "nameTag",
    characterId: "agent-1",
    data: { name: "Planner" },
    ...overrides,
  };
}

function makeElement(overrides: Partial<HUDElement> = {}): HUDElement {
  return {
    id: "hud-agent-1",
    type: "nameTag",
    characterId: "agent-1",
    screenPosition: { x: 0.1, y: 0.2 },
    visible: true,
    distance: 8,
    scale: 1,
    data: { name: "Planner" },
    ...overrides,
  };
}

function makeUpdate(
  overrides: Partial<HUDPositionUpdate["characters"][number]> = {},
): HUDPositionUpdate {
  return {
    type: "hud.positionUpdate",
    characters: [
      {
        characterId: "agent-1",
        screenX: 0.65,
        screenY: 0.35,
        visible: true,
        distance: 6,
        ...overrides,
      },
    ],
  };
}

describe("HUD coordinate sync", () => {
  it("builds HUD elements from static definitions before UE positions arrive", () => {
    const elements = buildHUDElementsFromDefinitions([
      makeDefinition({ id: "name", type: "nameTag" }),
      makeDefinition({ id: "status", type: "statusIcon" }),
    ]);

    expect(elements).toMatchObject([
      {
        id: "name",
        type: "nameTag",
        characterId: "agent-1",
        visible: false,
        screenPosition: { x: 0, y: 0 },
      },
      {
        id: "status",
        type: "statusIcon",
        characterId: "agent-1",
        visible: false,
        screenPosition: { x: 0, y: 0 },
      },
    ]);
  });

  it("applies UE screen coordinates to all HUD elements for the matching character", () => {
    const next = applyHUDPositionUpdate(
      [
        makeElement({ id: "name", type: "nameTag" }),
        makeElement({ id: "status", type: "statusIcon" }),
      ],
      makeUpdate(),
    );

    expect(next).toMatchObject([
      {
        id: "name",
        visible: true,
        screenPosition: { x: 0.65, y: 0.35 },
        distance: 6,
      },
      {
        id: "status",
        visible: true,
        screenPosition: { x: 0.65, y: 0.35 },
        distance: 6,
      },
    ]);
  });

  it("hides HUD elements when the UE update marks the character occluded", () => {
    const [next] = applyHUDPositionUpdate(
      [makeElement()],
      makeUpdate({ occluded: true }),
    );

    expect(next.visible).toBe(false);
    expect(next.occluded).toBe(true);
  });

  it("hides HUD elements when the projected screen coordinate is offscreen", () => {
    const [next] = applyHUDPositionUpdate(
      [makeElement()],
      makeUpdate({ screenX: 1.12, screenY: 0.5 }),
    );

    expect(next.visible).toBe(false);
    expect(next.offscreen).toBe(true);
  });

  it("scales HUD elements by camera distance within stable bounds", () => {
    expect(resolveHUDScale(2)).toBe(1.18);
    expect(resolveHUDScale(13)).toBe(0.95);
    expect(resolveHUDScale(24)).toBe(0.72);
    expect(resolveHUDScale(200)).toBe(0.72);
  });

  it("resolves the object-contain video frame inside a non-16:9 container", () => {
    expect(
      resolveVideoFrame({
        containerWidth: 1280,
        containerHeight: 720,
        aspectRatio: 16 / 9,
      }),
    ).toEqual({ left: 0, top: 0, width: 1280, height: 720 });

    expect(
      resolveVideoFrame({
        containerWidth: 1280,
        containerHeight: 900,
        aspectRatio: 16 / 9,
      }),
    ).toEqual({ left: 0, top: 90, width: 1280, height: 720 });

    expect(
      resolveVideoFrame({
        containerWidth: 900,
        containerHeight: 720,
        aspectRatio: 16 / 9,
      }),
    ).toEqual({ left: 0, top: 106.875, width: 900, height: 506.25 });
  });
});
