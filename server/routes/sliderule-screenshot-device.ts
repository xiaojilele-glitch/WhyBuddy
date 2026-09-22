export type SlideruleScreenshotDevice = "desktop" | "phone" | "tablet";

/**
 * 截图问的设备。跟 Python `layout_device` / 前端 `layoutDevice` 同一句话：
 * 接通的档原样走，其余兜底 desktop。
 *
 * ⚠ 2026-08-30 夜：这里曾写成 `phone ? phone : desktop`。Python 已经按
 * tablet 1112×834 截，Node 代理先把 query 折成 desktop，缓存键和
 * `X-Sliderule-Device` 都变成桌面——缩略图跟舞台对不上，没有报错。
 */
export function normalizeScreenshotDevice(value: unknown): SlideruleScreenshotDevice {
  const token = String(value ?? "").trim().toLowerCase();
  if (token === "phone" || token === "tablet" || token === "desktop") return token;
  return "desktop";
}

export function resolveScreenshotResponseDevice(
  requested: unknown,
  actual: unknown,
): SlideruleScreenshotDevice {
  if (actual === "desktop" || actual === "phone" || actual === "tablet") return actual;
  return normalizeScreenshotDevice(requested);
}

export function screenshotAuthoritySlug(
  sessionId: string,
  modelHash: string | undefined,
): string {
  return `${sessionId.slice(0, 32)}-${(modelHash ?? "nohash").slice(0, 16)}-device`;
}

export function screenshotCacheSlug(
  sessionId: string,
  modelHash: string | undefined,
  device: SlideruleScreenshotDevice,
): string {
  return `${sessionId.slice(0, 32)}-${device}-${(modelHash ?? "nohash").slice(0, 16)}`;
}
