/**
 * 「偏好」四件套单测。
 * 锁：Enter 键行为两模式判定、减少动效偏好 round-trip、
 * 完成通知在偏好关/未授权环境下静默不抛。
 */
import { describe, it, expect, beforeEach } from "vitest";

const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage ??= {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() {
    return memStore.size;
  },
} as Storage;

import {
  loadEnterBehavior,
  loadNotifyCompletePref,
  loadPreferredDevice,
  loadProductArchetype,
  loadReduceMotionPref,
  notifyDriveComplete,
  setEnterBehavior,
  setNotifyCompletePref,
  setPreferredDevice,
  setProductArchetype,
  setReduceMotionPref,
  shouldSendOnKey,
  composerEnterHintLabel,
  ENTER_SHIFT_NEWLINE_HINT,
} from "../user-prefs";

const key = (
  k: string,
  mods: Partial<Record<"shift" | "ctrl" | "meta", boolean>> = {}
) => ({
  key: k,
  shiftKey: !!mods.shift,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
});

describe("Enter 键行为", () => {
  beforeEach(() => memStore.clear());

  it("默认 enter 模式：Enter 发送、Shift+Enter 换行、Ctrl+Enter 不发送", () => {
    expect(loadEnterBehavior()).toBe("enter");
    expect(shouldSendOnKey(key("Enter"))).toBe(true);
    expect(shouldSendOnKey(key("Enter", { shift: true }))).toBe(false);
    expect(shouldSendOnKey(key("Enter", { ctrl: true }))).toBe(false);
    expect(shouldSendOnKey(key("a"))).toBe(false);
  });

  it("ctrl-enter 模式：Enter 换行、Ctrl/Cmd+Enter 发送、Shift+Enter 恒换行", () => {
    setEnterBehavior("ctrl-enter");
    expect(loadEnterBehavior()).toBe("ctrl-enter");
    expect(shouldSendOnKey(key("Enter"))).toBe(false);
    expect(shouldSendOnKey(key("Enter", { ctrl: true }))).toBe(true);
    expect(shouldSendOnKey(key("Enter", { meta: true }))).toBe(true);
    expect(shouldSendOnKey(key("Enter", { shift: true, ctrl: true }))).toBe(
      false
    );
  });

  it("round-trip：切回 enter 模式持久化", () => {
    setEnterBehavior("ctrl-enter");
    setEnterBehavior("enter");
    expect(loadEnterBehavior()).toBe("enter");
    expect(shouldSendOnKey(key("Enter"))).toBe(true);
  });

  it("空态/设置页共用恒换行提示，发送键跟当前模式走", () => {
    expect(ENTER_SHIFT_NEWLINE_HINT).toBe("Shift+Enter 始终换行");
    expect(composerEnterHintLabel("enter")).toBe(
      "Enter 发送 · Shift+Enter 始终换行"
    );
    expect(composerEnterHintLabel("ctrl-enter")).toBe(
      "Ctrl+Enter 发送 · Shift+Enter 始终换行"
    );
  });
});

describe("减少动态效果偏好", () => {
  beforeEach(() => memStore.clear());

  it("默认关；set→load round-trip", () => {
    expect(loadReduceMotionPref()).toBe(false);
    setReduceMotionPref(true);
    expect(loadReduceMotionPref()).toBe(true);
    setReduceMotionPref(false);
    expect(loadReduceMotionPref()).toBe(false);
  });
});

describe("推演完成通知", () => {
  beforeEach(() => memStore.clear());

  it("偏好 round-trip；偏好关或 Notification 不存在时 notifyDriveComplete 静默不抛", () => {
    expect(loadNotifyCompletePref()).toBe(false);
    // 偏好关：直接短路
    expect(() => notifyDriveComplete("测试话题")).not.toThrow();
    // 偏好开但 node 环境无 Notification：内部守卫短路
    setNotifyCompletePref(true);
    expect(loadNotifyCompletePref()).toBe(true);
    expect(() => notifyDriveComplete("测试话题")).not.toThrow();
    expect(() => notifyDriveComplete("")).not.toThrow();
  });
});

describe("目标形态（默认 Web）", () => {
  beforeEach(() => memStore.clear());

  it("默认 desktop；非法值回落；round-trip 认 phone", () => {
    expect(loadPreferredDevice()).toBe("desktop");
    setPreferredDevice("phone");
    expect(loadPreferredDevice()).toBe("phone");
    setPreferredDevice("tablet");
    expect(loadPreferredDevice()).toBe("tablet");
    setPreferredDevice("desktop");
    expect(loadPreferredDevice()).toBe("desktop");
  });
});

describe("产品原型（默认业务）", () => {
  beforeEach(() => memStore.clear());

  it("默认 business_app；非法值回落；round-trip 认 free_app", () => {
    expect(loadProductArchetype()).toBe("business_app");
    setProductArchetype("content_app");
    expect(loadProductArchetype()).toBe("content_app");
    setProductArchetype("free_app");
    expect(loadProductArchetype()).toBe("free_app");
    setProductArchetype("casual_game");
    expect(loadProductArchetype()).toBe("business_app");
    setProductArchetype("business_app");
    expect(loadProductArchetype()).toBe("business_app");
  });
});
