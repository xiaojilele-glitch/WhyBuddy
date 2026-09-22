import { describe, expect, it } from "vitest";

import {
  normalizeScreenshotDevice,
  resolveScreenshotResponseDevice,
  screenshotCacheSlug,
} from "../routes/sliderule-screenshot-device.js";

describe("SlideRule screenshot device contract", () => {
  it("keeps wired tablet, does not fold it to desktop", () => {
    expect(normalizeScreenshotDevice("phone")).toBe("phone");
    expect(normalizeScreenshotDevice("desktop")).toBe("desktop");
    expect(normalizeScreenshotDevice("tablet")).toBe("tablet");
    expect(normalizeScreenshotDevice("TABLET")).toBe("tablet");
    expect(normalizeScreenshotDevice(undefined)).toBe("desktop");
    expect(normalizeScreenshotDevice("watch")).toBe("desktop");
  });

  it("keeps desktop / phone / tablet screenshots in separate cache entries", () => {
    const desktop = screenshotCacheSlug("session-1", "model-1", "desktop");
    const phone = screenshotCacheSlug("session-1", "model-1", "phone");
    const tablet = screenshotCacheSlug("session-1", "model-1", "tablet");

    expect(desktop).not.toBe(phone);
    expect(desktop).not.toBe(tablet);
    expect(phone).not.toBe(tablet);
    expect(desktop).toContain("-desktop-");
    expect(phone).toContain("-phone-");
    expect(tablet).toContain("-tablet-");
  });

  it("uses the authoritative response device over a conflicting request", () => {
    expect(resolveScreenshotResponseDevice("desktop", "phone")).toBe("phone");
    expect(resolveScreenshotResponseDevice("phone", "desktop")).toBe("desktop");
    expect(resolveScreenshotResponseDevice("phone", null)).toBe("phone");
    expect(resolveScreenshotResponseDevice("desktop", "tablet")).toBe("tablet");
    expect(resolveScreenshotResponseDevice("tablet", "tablet")).toBe("tablet");
  });
});
