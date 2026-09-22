/**
 * user-prefs — 「偏好」设置的单一来源（2026-07-10 用户裁决四件套）。
 *
 * 全部 localStorage 持久化、纯函数读写；生效路径各自注明：
 * - 减少动态效果：根元素 class `sr-reduce-motion`（CSS 覆盖）+
 *   RollingText 运行时判断；同时自动尊重系统 prefers-reduced-motion；
 * - 推演完成通知：浏览器 Notification（切走标签页才弹，盯着看不打扰）；
 * - Enter 键行为：ComposerDock keydown 每次按键实时读取（设置即改即生效）；
 * - 目标形态（默认 Web 的下拉）：作曲家开关，发送时随 drive-full-stream 带上。
 */
import {
  defaultDevice,
  parseComposerDevice,
  type ComposerDevice,
} from "./composer-device";
import { parseProductArchetype } from "./product-archetypes";

const REDUCE_MOTION_KEY = "sliderule:reduce-motion";
const NOTIFY_COMPLETE_KEY = "sliderule:notify-complete";
const ENTER_TO_SEND_KEY = "sliderule:enter-to-send";
const PREFERRED_DEVICE_KEY = "sliderule:preferred-device";
const PRODUCT_ARCHETYPE_KEY = "sliderule:product-archetype";

const REDUCE_MOTION_CLASS = "sr-reduce-motion";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* 存储不可用 → 本次会话内仍按调用方内存态生效 */
  }
}

// --- 减少动态效果 --------------------------------------------------------------

export function loadReduceMotionPref(): boolean {
  return readFlag(REDUCE_MOTION_KEY, false);
}

/** 用户显式偏好 或 系统 prefers-reduced-motion，任一命中即减少动效。 */
export function isMotionReduced(): boolean {
  if (loadReduceMotionPref()) return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** 把偏好落到根元素 class（CSS 覆盖 sr-caret 等动画）。思考球走 paused。 */
export function applyReduceMotionClass(): void {
  try {
    document.documentElement.classList.toggle(
      REDUCE_MOTION_CLASS,
      loadReduceMotionPref()
    );
  } catch {
    /* 非浏览器环境（测试静态渲染）忽略 */
  }
}

export function setReduceMotionPref(value: boolean): void {
  writeFlag(REDUCE_MOTION_KEY, value);
  applyReduceMotionClass();
}

// --- 推演完成通知 --------------------------------------------------------------

export function loadNotifyCompletePref(): boolean {
  return readFlag(NOTIFY_COMPLETE_KEY, false);
}

export function setNotifyCompletePref(value: boolean): void {
  writeFlag(NOTIFY_COMPLETE_KEY, value);
}

/**
 * 开启通知偏好：需要浏览器授权。返回最终是否可用——被拒绝时如实返回
 * false（调用方保持开关关闭并提示，不装作开了）。
 */
export async function enableCompletionNotify(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    const ok = permission === "granted";
    setNotifyCompletePref(ok);
    return ok;
  } catch {
    return false;
  }
}

/** 推演完成时机调用：偏好开 + 已授权 + 用户不在本标签页 才弹（盯着看不打扰）。 */
export function notifyDriveComplete(topic: string): void {
  try {
    if (!loadNotifyCompletePref()) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (!document.hidden) return;
    new Notification("面团 AI 推演完成", {
      body: topic
        ? `「${topic.slice(0, 40)}」已闭环，回来看看结果`
        : "本轮推演已完成",
    });
  } catch {
    /* 通知失败不影响主流程 */
  }
}

// --- Enter 键行为 --------------------------------------------------------------

export type EnterBehavior = "enter" | "ctrl-enter";

export function loadEnterBehavior(): EnterBehavior {
  return readFlag(ENTER_TO_SEND_KEY, true) ? "enter" : "ctrl-enter";
}

export function setEnterBehavior(behavior: EnterBehavior): void {
  writeFlag(ENTER_TO_SEND_KEY, behavior === "enter");
}

/** 设置页与空态共用：Shift+Enter 恒换行。 */
export const ENTER_SHIFT_NEWLINE_HINT = "Shift+Enter 始终换行";

/** 空态输入框下方：当前发送键 + 恒换行。跟设置页同一事实，不许另写一句。 */
export function composerEnterHintLabel(
  mode: EnterBehavior = loadEnterBehavior()
): string {
  const send = mode === "enter" ? "Enter 发送" : "Ctrl+Enter 发送";
  return `${send} · ${ENTER_SHIFT_NEWLINE_HINT}`;
}

/** keydown 判定：本次按键是否应触发发送（Shift+Enter 恒为换行）。 */
export function shouldSendOnKey(ev: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  if (ev.key !== "Enter" || ev.shiftKey) return false;
  return loadEnterBehavior() === "enter"
    ? !ev.ctrlKey && !ev.metaKey
    : ev.ctrlKey || ev.metaKey;
}

// --- 目标形态（默认 Web） ----------------------------------------------------

function readStoredRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 用户真的选过才有值。空存储必须是 null，不许冒充 desktop。 */
export function loadStoredPreferredDevice(): ComposerDevice | null {
  const raw = readStoredRaw(PREFERRED_DEVICE_KEY);
  if (raw == null || raw === "") return null;
  const parsed = parseComposerDevice(raw);
  return parsed || null;
}

export function loadPreferredDevice(): ComposerDevice {
  return loadStoredPreferredDevice() || defaultDevice();
}

export function setPreferredDevice(value: ComposerDevice): void {
  try {
    localStorage.setItem(PREFERRED_DEVICE_KEY, parseComposerDevice(value));
  } catch {
    /* 存储不可用 → 本次会话内仍按调用方内存态生效 */
  }
}

export function loadStoredProductArchetype(): string | null {
  const raw = readStoredRaw(PRODUCT_ARCHETYPE_KEY);
  if (raw == null || raw === "") return null;
  return parseProductArchetype(raw);
}

export function loadProductArchetype(): string {
  return loadStoredProductArchetype() || parseProductArchetype("");
}

export function setProductArchetype(value: string): void {
  try {
    localStorage.setItem(PRODUCT_ARCHETYPE_KEY, parseProductArchetype(value));
  } catch {
    /* 存储不可用 → 本次会话内仍按调用方内存态生效 */
  }
}

// --- Work 巡演 LLM 台词（五期入魂档，默认关）-----------------------------------

/** 应用启动时调用一次：把持久化偏好落到 DOM。 */
export function initUserPrefs(): void {
  applyReduceMotionClass();
}
