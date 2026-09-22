/**
 * 工程预览观看视口：桌面走账本 1920×1080，机型走 Playwright 清单。
 *
 * 不许在这里手写宽高。换了就是换了个没被验收过的版式。
 */
import { describe, expect, it } from "vitest";
import { specPageViewport } from "../live-runtime/canvas-scale";
import { DEVICE_PRESETS } from "../live-runtime/device-presets";
import {
  PROJECT_PREVIEW_DESKTOP_ID,
  projectPreviewDesktopView,
  projectPreviewViewOptions,
  resolveProjectPreviewView,
} from "../project-runtime/project-preview-view";

describe("工程预览默认是桌面 16:9", () => {
  it("正向：桌面视口就是账本 desktop，不是手写 1920", () => {
    const view = projectPreviewDesktopView();
    expect(view.id).toBe(PROJECT_PREVIEW_DESKTOP_ID);
    expect(view.viewport).toEqual(specPageViewport("desktop"));
    expect(view.viewport).toEqual({ w: 1920, h: 1080 });
    expect(view.viewport.h).not.toBe(1920);
    expect(view.framed).toBe(false);
  });

  it("机型清单都能切到，数字跟 DEVICE_PRESETS 同一份", () => {
    const options = projectPreviewViewOptions();
    expect(options[0]?.id).toBe(PROJECT_PREVIEW_DESKTOP_ID);
    expect(options.length).toBe(1 + DEVICE_PRESETS.length);
    const phone = resolveProjectPreviewView("iphone-14");
    expect(phone.viewport).toEqual({ w: 390, h: 844 });
    expect(phone.framed).toBe(true);
  });

  it("反向：不认识的 id 回落桌面，不许悄悄变成 iPhone", () => {
    expect(resolveProjectPreviewView("not-a-device").id).toBe(
      PROJECT_PREVIEW_DESKTOP_ID
    );
    expect(resolveProjectPreviewView(null).id).toBe(PROJECT_PREVIEW_DESKTOP_ID);
  });
});
