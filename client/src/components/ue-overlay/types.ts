/**
 * Shared types for the UE overlay rendering system.
 *
 * The overlay uses a 3-layer z-index stack:
 *   z-10  Video stream layer
 *   z-20  UI overlay layer (sidebar, task panel)
 *   z-30  HUD tracking layer (character labels, status icons)
 */

/** A single HUD element rendered on the tracking layer. */
export interface HUDElement {
  id: string;
  type: 'nameTag' | 'statusIcon' | 'progressBar';
  characterId: string;
  /** Normalised screen position (0-1 range). */
  screenPosition: { x: number; y: number };
  visible: boolean;
  /** Distance from camera, forwarded by UE for distance-based scaling. */
  distance?: number;
  /** Render scale resolved from distance and video-frame size. */
  scale?: number;
  /** True when UE reports that another scene object blocks this character. */
  occluded?: boolean;
  /** True when the projected screen coordinate is outside the visible frame. */
  offscreen?: boolean;
  data: Record<string, unknown>;
}

/** Static HUD metadata owned by React before UE sends live coordinates. */
export interface HUDDefinition {
  id: string;
  type: HUDElement['type'];
  characterId: string;
  data: Record<string, unknown>;
}

/** UE -> frontend HUD coordinate payload. */
export interface HUDPositionUpdate {
  type: 'hud.positionUpdate';
  characters: Array<{
    characterId: string;
    screenX: number;
    screenY: number;
    visible: boolean;
    distance?: number;
    occluded?: boolean;
  }>;
}

/** Pixel rectangle occupied by the object-contain video frame. */
export interface VideoFrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ResolveVideoFrameInput {
  containerWidth: number;
  containerHeight: number;
  aspectRatio: number;
}

/** Configuration for pointer-event passthrough zones. */
export interface PointerPassthroughZoneBounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PointerPassthroughZoneEntry {
  id: string;
  bounds: PointerPassthroughZoneBounds;
  passthrough: boolean;
}

export interface PointerConfig {
  passthroughZones: PointerPassthroughZoneEntry[];
  defaultPassthrough: boolean;
}

/** Props for the PointerAutoWrapper component. */
export interface PointerAutoWrapperProps {
  children: React.ReactNode;
  className?: string;
}

/** Props for the PointerPassthroughZone component. */
export interface PointerPassthroughZoneProps {
  config: PointerConfig;
}

/** Props accepted by the OverlayContainer component. */
export interface OverlayContainerProps {
  /** Ref to the underlying `<video>` element rendered in the video layer. */
  videoElement: React.RefObject<HTMLVideoElement | null>;
  /** Optional custom media layer, used by Three.js fallback or a future stream player. */
  mediaLayer?: React.ReactNode;
  /** React children rendered inside the UI overlay layer. */
  children: React.ReactNode;
  /** Optional HUD elements positioned on the tracking layer. */
  hudElements?: HUDElement[];
  /** Measured frame occupied by the object-contain video/scene inside the container. */
  videoFrame?: VideoFrameRect;
  /**
   * When `true` the UI overlay container sets `pointer-events: none` so
   * clicks fall through to the video layer.  Interactive children should
   * set `pointer-events: auto` on themselves.
   *
   * @default true
   */
  pointerPassthrough?: boolean;
}
