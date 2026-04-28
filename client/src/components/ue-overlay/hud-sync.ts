import { useEffect, useMemo, useRef, useState } from "react";

import type {
  HUDDefinition,
  HUDElement,
  HUDPositionUpdate,
  ResolveVideoFrameInput,
  VideoFrameRect,
} from "./types";

export const HUD_POSITION_EVENT = "hud.positionUpdate";

const MIN_HUD_SCALE = 0.72;
const MAX_HUD_SCALE = 1.18;
const NEAR_DISTANCE = 2;
const FAR_DISTANCE = 24;

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function resolveHUDScale(distance: number | undefined): number {
  if (typeof distance !== "number" || Number.isNaN(distance)) {
    return 1;
  }

  const ratio =
    (clamp(distance, NEAR_DISTANCE, FAR_DISTANCE) - NEAR_DISTANCE) /
    (FAR_DISTANCE - NEAR_DISTANCE);
  return roundToTwo(MAX_HUD_SCALE - ratio * (MAX_HUD_SCALE - MIN_HUD_SCALE));
}

export function resolveVideoFrame({
  containerWidth,
  containerHeight,
  aspectRatio,
}: ResolveVideoFrameInput): VideoFrameRect {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    aspectRatio <= 0 ||
    !Number.isFinite(aspectRatio)
  ) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const containerAspect = containerWidth / containerHeight;

  if (containerAspect > aspectRatio) {
    const width = containerHeight * aspectRatio;
    return {
      left: (containerWidth - width) / 2,
      top: 0,
      width,
      height: containerHeight,
    };
  }

  const height = containerWidth / aspectRatio;
  return {
    left: 0,
    top: (containerHeight - height) / 2,
    width: containerWidth,
    height,
  };
}

export function buildHUDElementsFromDefinitions(
  definitions: HUDDefinition[],
): HUDElement[] {
  return definitions.map(definition => ({
    id: definition.id,
    type: definition.type,
    characterId: definition.characterId,
    screenPosition: { x: 0, y: 0 },
    visible: false,
    scale: 1,
    data: definition.data,
  }));
}

function isNormalisedCoordinate(value: number) {
  return value >= 0 && value <= 1;
}

export function applyHUDPositionUpdate(
  elements: HUDElement[],
  update: HUDPositionUpdate,
): HUDElement[] {
  const positions = new Map(
    update.characters.map(character => [character.characterId, character]),
  );

  return elements.map(element => {
    const position = positions.get(element.characterId);
    if (!position) return element;

    const offscreen =
      !isNormalisedCoordinate(position.screenX) ||
      !isNormalisedCoordinate(position.screenY);
    const occluded = Boolean(position.occluded);
    const visible = Boolean(position.visible) && !offscreen && !occluded;

    return {
      ...element,
      screenPosition: {
        x: position.screenX,
        y: position.screenY,
      },
      visible,
      distance: position.distance,
      scale: resolveHUDScale(position.distance),
      occluded,
      offscreen,
    };
  });
}

function parseHUDPositionPayload(value: unknown): HUDPositionUpdate | null {
  const candidate =
    typeof value === "string" ? JSON.parse(value) : value;

  if (!candidate || typeof candidate !== "object") return null;
  const update = candidate as Partial<HUDPositionUpdate>;
  if (update.type !== HUD_POSITION_EVENT || !Array.isArray(update.characters)) {
    return null;
  }

  return {
    type: HUD_POSITION_EVENT,
    characters: update.characters
      .filter(character => character && typeof character === "object")
      .map(character => {
        const row = character as HUDPositionUpdate["characters"][number];
        return {
          characterId: String(row.characterId),
          screenX: Number(row.screenX),
          screenY: Number(row.screenY),
          visible: Boolean(row.visible),
          distance:
            typeof row.distance === "number" ? row.distance : undefined,
          occluded: Boolean(row.occluded),
        };
      })
      .filter(
        character =>
          character.characterId &&
          Number.isFinite(character.screenX) &&
          Number.isFinite(character.screenY),
      ),
  };
}

function extractHUDPositionEvent(event: Event): HUDPositionUpdate | null {
  try {
    if ("detail" in event) {
      return parseHUDPositionPayload((event as CustomEvent).detail);
    }

    if ("data" in event) {
      return parseHUDPositionPayload((event as MessageEvent).data);
    }
  } catch {
    return null;
  }

  return null;
}

export function useHUDPositionSync(
  definitions: HUDDefinition[],
  eventTarget: EventTarget | null =
    typeof window === "undefined" ? null : window,
) {
  const initialElements = useMemo(
    () => buildHUDElementsFromDefinitions(definitions),
    [definitions],
  );
  const [elements, setElements] = useState(initialElements);
  const latestElementsRef = useRef(initialElements);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    latestElementsRef.current = initialElements;
    setElements(initialElements);
  }, [initialElements]);

  useEffect(() => {
    if (!eventTarget) return;

    const handleUpdate = (event: Event) => {
      const update = extractHUDPositionEvent(event);
      if (!update) return;

      const applyUpdate = () => {
        frameRef.current = null;
        setElements(current => {
          const next = applyHUDPositionUpdate(current, update);
          latestElementsRef.current = next;
          return next;
        });
      };

      if (typeof window !== "undefined") {
        if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current);
        }
        frameRef.current = window.requestAnimationFrame(applyUpdate);
      } else {
        applyUpdate();
      }
    };

    eventTarget.addEventListener(HUD_POSITION_EVENT, handleUpdate);
    return () => {
      eventTarget.removeEventListener(HUD_POSITION_EVENT, handleUpdate);
      if (frameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [eventTarget]);

  return elements;
}
