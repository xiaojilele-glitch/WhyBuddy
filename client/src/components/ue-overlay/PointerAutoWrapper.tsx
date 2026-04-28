import { cn } from "@/lib/utils";

import type { PointerAutoWrapperProps } from "./types";

/**
 * PointerAutoWrapper — wraps interactive UI elements and sets
 * `pointer-events: auto` so they remain clickable even when the parent
 * overlay layer has `pointer-events: none`.
 *
 * Usage:
 * ```tsx
 * <OverlayContainer videoElement={videoRef}>
 *   <PointerAutoWrapper>
 *     <button>Click me</button>
 *   </PointerAutoWrapper>
 * </OverlayContainer>
 * ```
 *
 * Alternatively, you can use the Tailwind utility class `pointer-events-auto`
 * directly on any child element inside the overlay.
 */
export function PointerAutoWrapper({
  children,
  className,
}: PointerAutoWrapperProps) {
  return (
    <div
      className={cn("pointer-events-auto", className)}
      data-testid="ue-pointer-auto-wrapper"
    >
      {children}
    </div>
  );
}
