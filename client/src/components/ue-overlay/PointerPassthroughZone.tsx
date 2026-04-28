import { cn } from "@/lib/utils";

import type { PointerPassthroughZoneProps } from "./types";

/**
 * PointerPassthroughZone — renders invisible overlay divs that either
 * block or pass through pointer events based on a `PointerConfig`.
 *
 * Each zone is positioned absolutely using the `bounds` from the config.
 * - Zones with `passthrough: true` get `pointer-events: none` (clicks fall
 *   through to the video layer).
 * - Zones with `passthrough: false` get `pointer-events: auto` (clicks are
 *   captured by the zone).
 *
 * The component itself is a transparent container that does not interfere
 * with the parent overlay's pointer-events strategy.
 */
export function PointerPassthroughZone({
  config,
}: PointerPassthroughZoneProps) {
  const { passthroughZones, defaultPassthrough } = config;

  if (passthroughZones.length === 0) return null;

  return (
    <div
      className={cn(
        "absolute inset-0",
        defaultPassthrough ? "pointer-events-none" : "pointer-events-auto",
      )}
      data-testid="ue-passthrough-zone-container"
    >
      {passthroughZones.map((zone) => (
        <div
          key={zone.id}
          className={cn(
            "absolute",
            zone.passthrough ? "pointer-events-none" : "pointer-events-auto",
          )}
          style={{
            top: zone.bounds.top,
            left: zone.bounds.left,
            width: zone.bounds.width,
            height: zone.bounds.height,
          }}
          data-testid={`ue-passthrough-zone-${zone.id}`}
          data-zone-id={zone.id}
          data-zone-passthrough={zone.passthrough}
        />
      ))}
    </div>
  );
}
