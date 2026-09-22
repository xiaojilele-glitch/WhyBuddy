import { describe, expect, it } from "vitest";
import { autopilotTheme } from "../autopilot-theme";

describe("SlideRule immersion layout theme", () => {
  it("keeps the top HUD and composer visually contained on an empty canvas", () => {
    expect(autopilotTheme.immersionOverlayTop).toContain("px-2");
    expect(autopilotTheme.immersionOverlayTop).toContain("pt-2");
    expect(autopilotTheme.immersionOverlayTop).toContain("sm:px-3");
    expect(autopilotTheme.immersionOverlayHeader).toBe("pointer-events-auto w-full");
    expect(autopilotTheme.overlayBar).toContain("px-0");
    expect(autopilotTheme.overlayBar).not.toContain("bg-white");
    expect(autopilotTheme.overlayBar).not.toContain("shadow");
    expect(autopilotTheme.immersionOverlayBottom).toContain("pb-[max(16px,env(safe-area-inset-bottom))]");
    expect(autopilotTheme.composerDockWidth).toContain("max-w-[min(100%,760px)]");
    expect(autopilotTheme.grokInputBar).toContain("min-h-[64px]");
    expect(autopilotTheme.grokInputBar).toContain("px-4");
    expect(autopilotTheme.grokInput).toContain("px-4");
    expect(autopilotTheme.grokInput).toContain("w-full");
    expect(autopilotTheme.grokInput).toContain("h-11");
    expect(autopilotTheme.grokInput).toContain("py-[9px]");
    expect(autopilotTheme.grokSendBtn).toContain("h-11");
    expect(autopilotTheme.grokInput).toContain("leading-[22px]");
  });
});
