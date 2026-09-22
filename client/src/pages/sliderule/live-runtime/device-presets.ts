/**
 * 预览设备清单 —— 舞台上「换一台机器看」的单一来源。
 *
 * 数字**不在这个文件里手写**：`generated/device-presets.json` 由
 * `scripts/generate-device-presets.mjs` 从 Playwright 的 devices 表生成
 * （Playwright 那张表跟着 Chrome DevTools 的 emulated devices 走）。
 * 想加/删机型去改那个脚本的 CURATED，然后 `pnpm devices:generate`。
 * `pnpm devices:check` 在 CI 上卡过期。
 *
 * ⚠ 这是**预览侧的设备模拟**，跟后端那个 device 是两回事，别混：
 *   · 后端 device（desktop / phone）决定这一轮**生成什么样的页面**，写死在
 *     产物里，换预览机型不会、也不该把它改掉；
 *   · 这里的 preset 只决定**用多大的画布去看那份产物**，纯观看态。
 *   把两者接到一起会得到"换个机型预览 → 触发重新生成"，那是灾难。
 *
 * 选择持久化在 localStorage（与 user-prefs.ts 同一套 `sliderule:` 前缀）。
 * Chrome DevTools / 微信开发者工具都是全局记住上次选的机型，不是每次回到默认。
 */
import raw from "../generated/device-presets.json";

export type DevicePresetClass = "phone" | "tablet";

export type DevicePresetFrame = {
  /** 机身边框宽度（左右上）。边框即机身，算进 layout，不用 box-shadow 描边。 */
  bezel: number;
  /** 下巴。真机下边框比上边宽。 */
  bezelBottom: number;
  /** 机身外圆角。 */
  radius: number;
  /** 内屏圆角。 */
  innerRadius: number;
};

export type DevicePreset = {
  id: string;
  label: string;
  deviceClass: DevicePresetClass;
  /** CSS 像素整屏宽（不是物理像素，也不是扣掉地址栏的可视高）。 */
  width: number;
  height: number;
  deviceScaleFactor: number;
  /** 来源机型名，便于回查 Playwright 表。 */
  source: string;
  frame: DevicePresetFrame;
};

const TABLE = raw as {
  defaultPresetId: string;
  presets: DevicePreset[];
};

export const DEVICE_PRESETS: readonly DevicePreset[] = TABLE.presets;
export const DEFAULT_DEVICE_PRESET_ID = TABLE.defaultPresetId;

const DEVICE_PRESET_KEY = "sliderule:preview-device-preset";

export function findDevicePreset(id: string | null | undefined): DevicePreset {
  const hit = DEVICE_PRESETS.find(p => p.id === id);
  // 回落到默认档而不是抛错：清单收窄过（机型被删/改名）之后，老 localStorage
  // 里存着的 id 会读不到。观看态的偏好读不到就该静默回落，不该把舞台炸掉。
  return hit ?? DEVICE_PRESETS.find(p => p.id === DEFAULT_DEVICE_PRESET_ID)!;
}

export function loadDevicePresetId(): string {
  try {
    return findDevicePreset(localStorage.getItem(DEVICE_PRESET_KEY)).id;
  } catch {
    return DEFAULT_DEVICE_PRESET_ID;
  }
}

export function saveDevicePresetId(id: string): void {
  try {
    localStorage.setItem(DEVICE_PRESET_KEY, findDevicePreset(id).id);
  } catch {
    /* 存储不可用 → 本次会话内仍按内存态生效 */
  }
}
