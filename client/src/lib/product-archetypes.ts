/**
 * 产品原型账本的前端投影。合法域只从同一份 JSON 派生，
 * 不许再手抄 desktop|phone 或业务原型名。
 *
 * 加设备 / 接通原型 = 只改 slide-rule-python/services/data/product_archetypes.json。
 */
import archetypes from "@archetypes";

type Ledger = {
  defaultArchetype?: string;
  archetypes?: Record<
    string,
    { label?: string; wired?: boolean }
  >;
  deviceForms?: {
    defaultDevice?: string;
    judgeSentinel?: string;
    forms?: Record<
      string,
      {
        label?: string;
        wired?: boolean;
        viewportCss?: { w?: number; h?: number };
      }
    >;
  };
};

const LEDGER = archetypes as Ledger;

export function defaultArchetype(): string {
  return String(LEDGER.defaultArchetype || "business_app");
}

export function defaultDevice(): string {
  return String(LEDGER.deviceForms?.defaultDevice || "desktop");
}

export function judgeSentinel(): string {
  return String(LEDGER.deviceForms?.judgeSentinel || "unspecified");
}

export function wiredArchetypes(): Array<{ id: string; label: string }> {
  const rows = LEDGER.archetypes || {};
  return Object.entries(rows)
    .filter(([, spec]) => spec?.wired === true)
    .map(([id, spec]) => ({ id, label: String(spec.label || id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function allDeviceForms(): Array<{
  id: string;
  label: string;
  wired: boolean;
}> {
  const forms = LEDGER.deviceForms?.forms || {};
  return Object.entries(forms).map(([id, spec]) => ({
    id,
    label: String(spec.label || id),
    wired: spec?.wired === true,
  }));
}

export function wiredDevices(): Array<{ id: string; label: string }> {
  return allDeviceForms()
    .filter(row => row.wired)
    .map(({ id, label }) => ({ id, label }));
}

export function wiredDeviceIds(): string[] {
  return wiredDevices().map(row => row.id);
}

export function isWiredDevice(name: string | null | undefined): boolean {
  return Boolean(name) && wiredDeviceIds().includes(String(name));
}

export function isWiredArchetype(name: string | null | undefined): boolean {
  return wiredArchetypes().some(row => row.id === name);
}

export function parseJudgeDevice(raw: unknown): string {
  const value = String(raw || "").trim();
  if (isWiredDevice(value) || value === judgeSentinel()) return value;
  return judgeSentinel();
}

export function parsePreferredDevice(raw: unknown): string {
  const value = String(raw || "").trim();
  return isWiredDevice(value) ? value : defaultDevice();
}

export function parseProductArchetype(raw: unknown): string {
  const value = String(raw || "").trim();
  return isWiredArchetype(value) ? value : defaultArchetype();
}

/** 舞台 / SSE / 截图共用的接通档。不许再写 `phone | desktop`。 */
export type LayoutDevice = "desktop" | "phone" | "tablet";

/**
 * 版式用档：接通的就用，否则兜底。跟 Python `layout_device` 同一句话。
 *
 * ⚠ 2026-08-30 夜：`phone ? phone : desktop` 把 SSE / 画布上的 tablet
 * 折成 1920。前端只问这一处，不许再手写二分。
 */
export function layoutDevice(preferred: unknown): string {
  return parsePreferredDevice(preferred);
}

/**
 * 生成 / 画布共用的 CSS 像素视口。只从账本 `viewportCss` 读。
 * 缺字段才回落到历史三档——跟 Python `device_viewport_css` 对齐。
 */
export function deviceViewportCss(device?: string | null): { w: number; h: number } {
  const name = layoutDevice(device);
  const raw = LEDGER.deviceForms?.forms?.[name]?.viewportCss;
  const width = Number(raw?.w);
  const height = Number(raw?.h);
  if (width > 0 && height > 0) return { w: width, h: height };
  if (name === "phone") return { w: 390, h: 844 };
  if (name === "tablet") return { w: 1112, h: 834 };
  return { w: 1920, h: 1080 };
}

export function deviceDisplayLabel(device: string): string {
  if (device === "phone") return "手机应用";
  if (device === "desktop") return "Web / PC";
  if (device === "tablet") return "平板";
  if (device === judgeSentinel()) return "未指定（两档都生成）";
  const row = wiredDevices().find(item => item.id === device);
  return row?.label || device;
}
