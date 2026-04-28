import { cn } from "@/lib/utils";

import type { HUDElement, OverlayContainerProps, VideoFrameRect } from "./types";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Video layer (z-10).
 *
 * Wraps the `<video>` ref inside a container that maintains a 16:9 aspect
 * ratio via CSS `aspect-ratio` and uses `object-fit: contain` so the stream
 * scales without cropping.
 */
function VideoLayer({
  videoRef,
  mediaLayer,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  mediaLayer?: React.ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
      data-testid="ue-overlay-video-layer"
    >
      {mediaLayer ? (
        <div className="h-full w-full" data-testid="ue-overlay-media-layer">
          {mediaLayer}
        </div>
      ) : (
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          style={{ aspectRatio: "16 / 9" }}
          autoPlay
          muted
          playsInline
        />
      )}
    </div>
  );
}

/**
 * UI overlay layer (z-20).
 *
 * Renders children on top of the video with a semi-transparent backdrop.
 * `pointer-events` is controlled by the `pointerPassthrough` prop — when
 * enabled the container itself is transparent to clicks while interactive
 * children can opt-in via `pointer-events: auto`.
 */
function UIOverlayLayer({
  children,
  pointerPassthrough,
}: {
  children: React.ReactNode;
  pointerPassthrough: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-20",
        pointerPassthrough && "pointer-events-none",
      )}
      style={{
        background: "rgba(0, 0, 0, 0.15)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      data-testid="ue-overlay-ui-layer"
    >
      {children}
    </div>
  );
}

/**
 * HUD tracking layer (z-30).
 *
 * Each HUD element is absolutely positioned using normalised screen
 * coordinates (0-1).  Hidden elements are not rendered.
 */
function resolveHUDStyle(element: HUDElement, videoFrame?: VideoFrameRect) {
  const scale = element.scale ?? 1;

  if (videoFrame) {
    return {
      left: videoFrame.left + videoFrame.width * element.screenPosition.x,
      top: videoFrame.top + videoFrame.height * element.screenPosition.y,
      transform: `translate(-50%, -50%) scale(${scale})`,
      transformOrigin: "center",
    };
  }

  return {
    left: `${element.screenPosition.x * 100}%`,
    top: `${element.screenPosition.y * 100}%`,
    transform: `translate(-50%, -50%) scale(${scale})`,
    transformOrigin: "center",
  };
}

function HUDLayer({
  elements,
  videoFrame,
}: {
  elements: HUDElement[];
  videoFrame?: VideoFrameRect;
}) {
  const visibleElements = elements.filter(
    (el) => el.visible && !el.occluded && !el.offscreen,
  );

  if (visibleElements.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
      data-testid="ue-overlay-hud-layer"
    >
      {visibleElements.map((el) => (
        <div
          key={el.id}
          className="absolute"
          style={resolveHUDStyle(el, videoFrame)}
          data-hud-id={el.id}
          data-hud-type={el.type}
          data-hud-scale={el.scale ?? 1}
        >
          {el.type === "nameTag" && <HUDNameTag data={el.data} />}
          {el.type === "statusIcon" && <HUDStatusIcon data={el.data} />}
          {el.type === "progressBar" && <HUDProgressBar data={el.data} />}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal HUD renderers
// ---------------------------------------------------------------------------

function HUDNameTag({ data }: { data: Record<string, unknown> }) {
  return (
    <span className="rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
      {String(data.name ?? "")}
    </span>
  );
}

function HUDStatusIcon({ data }: { data: Record<string, unknown> }) {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white">
      {String(data.icon ?? "●")}
    </span>
  );
}

function HUDProgressBar({ data }: { data: Record<string, unknown> }) {
  const progress = Number(data.progress ?? 0);
  return (
    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/30">
      <div
        className="h-full rounded-full bg-green-400"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * OverlayContainer — manages the 3-layer rendering stack for UE video
 * stream overlays.
 *
 * Layer stack (bottom → top):
 *   z-10  Video stream
 *   z-20  UI overlay (semi-transparent, backdrop-blur)
 *   z-30  HUD tracking (character labels, status icons, progress bars)
 */
export function OverlayContainer({
  videoElement,
  mediaLayer,
  children,
  hudElements = [],
  videoFrame,
  pointerPassthrough = true,
}: OverlayContainerProps) {
  return (
    <div
      className="relative h-full w-full overflow-hidden bg-black"
      data-testid="ue-overlay-container"
    >
      {/* z-10 — Video stream */}
      <VideoLayer videoRef={videoElement} mediaLayer={mediaLayer} />

      {/* z-20 — UI overlay */}
      <UIOverlayLayer pointerPassthrough={pointerPassthrough}>
        {children}
      </UIOverlayLayer>

      {/* z-30 — HUD tracking */}
      <HUDLayer elements={hudElements} videoFrame={videoFrame} />
    </div>
  );
}
