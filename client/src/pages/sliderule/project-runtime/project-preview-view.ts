/**
 * 工程预览的观看视口。数字不在这里手写。
 *
 *   · 桌面走账本 `specPageViewport("desktop")`（1920×1080，16:9）
 *   · 手机/平板走 Playwright 那份 `DEVICE_PRESETS`
 *
 * 只改画布，不改产物，也不触发重新生成。持久化跟 HTML 舞台的机型偏好
 * 分开——那边默认 iPhone，这边默认桌面。
 */
import { specPageViewport, PHONE_STAGE_MAX_SCALE } from "../live-runtime/canvas-scale";
import {
  DEVICE_PRESETS,
  type DevicePresetFrame,
} from "../live-runtime/device-presets";

export const PROJECT_PREVIEW_DESKTOP_ID = "desktop";
const VIEW_KEY = "sliderule:project-preview-view";

export type ProjectPreviewView = {
  id: string;
  label: string;
  viewport: { w: number; h: number };
  framed: boolean;
  frame: DevicePresetFrame | null;
  maxScale?: number;
};

export function projectPreviewDesktopView(): ProjectPreviewView {
  const viewport = specPageViewport("desktop");
  return {
    id: PROJECT_PREVIEW_DESKTOP_ID,
    label: `桌面 ${viewport.w}×${viewport.h}`,
    viewport,
    framed: false,
    frame: null,
  };
}

export function resolveProjectPreviewView(
  id: string | null | undefined
): ProjectPreviewView {
  if (!id || id === PROJECT_PREVIEW_DESKTOP_ID) {
    return projectPreviewDesktopView();
  }
  const preset = DEVICE_PRESETS.find(item => item.id === id);
  if (!preset) return projectPreviewDesktopView();
  return {
    id: preset.id,
    label: preset.label,
    viewport: { w: preset.width, h: preset.height },
    framed: true,
    frame: preset.frame,
    maxScale: preset.deviceClass === "phone" ? PHONE_STAGE_MAX_SCALE : undefined,
  };
}

export function projectPreviewViewOptions(): ProjectPreviewView[] {
  return [
    projectPreviewDesktopView(),
    ...DEVICE_PRESETS.map(preset => resolveProjectPreviewView(preset.id)),
  ];
}

export function loadProjectPreviewViewId(): string {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    return resolveProjectPreviewView(stored).id;
  } catch {
    return PROJECT_PREVIEW_DESKTOP_ID;
  }
}

export function saveProjectPreviewViewId(id: string): void {
  try {
    localStorage.setItem(VIEW_KEY, resolveProjectPreviewView(id).id);
  } catch {
    /* 存储不可用 → 本次会话内仍按内存态生效 */
  }
}
