/**
 * 预览机型清单：数字来自 Playwright，切换只动画布、不动产物。
 *
 * 这份判据要挡住的三件事，都不会报错：
 *   一、有人手改 generated/device-presets.json 里的数字（或重新生成时取错字段），
 *       机型尺寸静静地不对；
 *   二、预览机型漏进缩略图采集，应用市场的卡片跟着观看者的选择变形；
 *   三、预览机型接到后端那个 device 上，换个机型预览就触发重新生成。
 */
import { readFileSync } from "node:fs";
import { devices as PLAYWRIGHT_DEVICES } from "@playwright/test";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVICE_PRESET_ID,
  DEVICE_PRESETS,
  findDevicePreset,
} from "../device-presets";
import { SPEC_PAGE_VIEWPORT_PHONE } from "../canvas-scale";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("预览机型清单", () => {
  it("每一台的尺寸都跟 Playwright 设备表逐位相同", () => {
    expect(DEVICE_PRESETS.length).toBeGreaterThanOrEqual(8);
    for (const preset of DEVICE_PRESETS) {
      const d = (PLAYWRIGHT_DEVICES as Record<string, any>)[preset.source];
      expect(d, `Playwright 表里没有 ${preset.source}`).toBeTruthy();
      const box = d.screen ?? d.viewport;
      expect({ w: preset.width, h: preset.height }).toEqual({
        w: box.width,
        h: box.height,
      });
      expect(preset.deviceScaleFactor).toBe(d.deviceScaleFactor);
    }
  });

  it("取的是 screen 不是 viewport（取错所有 iPhone 会矮一截，且看着很合理）", () => {
    /**
     * ⚠ Playwright 的 viewport 是**扣掉浏览器地址栏后**的可视高度。
     * iPhone 15 Pro：screen 393×852，viewport 393×659 —— 差 193px。
     * 生成脚本改成取 viewport 的话，机框会矮一大截，但 393×659 这个数看上去
     * 完全合理，没人会怀疑。所以专挑一台两者不同的机器钉死。
     */
    const proMax = DEVICE_PRESETS.find(p => p.source === "iPhone 15 Pro Max")!;
    const d = (PLAYWRIGHT_DEVICES as Record<string, any>)["iPhone 15 Pro Max"];
    expect(d.screen.height).not.toBe(d.viewport.height);
    expect(proMax.height).toBe(d.screen.height);
    expect(proMax.height).not.toBe(d.viewport.height);
  });

  it("默认档仍是改动前那台 390×844，升级不换机器", () => {
    const def = findDevicePreset(DEFAULT_DEVICE_PRESET_ID);
    expect(def.width).toBe(SPEC_PAGE_VIEWPORT_PHONE.w);
    expect(def.height).toBe(SPEC_PAGE_VIEWPORT_PHONE.h);
  });

  it("比例要有区分度：同尺寸不留两台，且窄屏/方屏/平板都在", () => {
    const sizes = DEVICE_PRESETS.map(p => `${p.width}x${p.height}`);
    expect(new Set(sizes).size).toBe(sizes.length);
    const ratios = DEVICE_PRESETS.map(p => p.height / p.width);
    expect(Math.min(...ratios)).toBeLessThan(1.3); // 接近方屏（折叠展开）
    expect(Math.max(...ratios)).toBeGreaterThan(2.1); // 现代直板长条
    expect(Math.min(...DEVICE_PRESETS.map(p => p.width))).toBeLessThanOrEqual(
      320
    );
  });

  it("平板不套手机机身：边框更薄、圆角更小", () => {
    const phone = DEVICE_PRESETS.find(p => p.deviceClass === "phone")!;
    const tablet = DEVICE_PRESETS.find(p => p.deviceClass === "tablet")!;
    expect(tablet.frame.radius).toBeLessThan(phone.frame.radius);
    expect(tablet.frame.innerRadius).toBeLessThan(phone.frame.innerRadius);
  });

  it("认不出的 id 静默回落默认档，不炸舞台", () => {
    expect(findDevicePreset("不存在的机型").id).toBe(DEFAULT_DEVICE_PRESET_ID);
    expect(findDevicePreset(null).id).toBe(DEFAULT_DEVICE_PRESET_ID);
    expect(findDevicePreset(undefined).id).toBe(DEFAULT_DEVICE_PRESET_ID);
  });
});

describe("机型切换的边界：只动画布，不动产物", () => {
  const read = (rel: string) =>
    stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));

  it("预览舞台与点选编辑读同一份机型（两边尺寸不一致=所见非所改）", () => {
    const stage = read("../SpecPageLiveStage.tsx");
    const edit = read("../../../agent-loop/dashboard/ClickEditStage.tsx");
    for (const src of [stage, edit]) {
      expect(src).toContain("findDevicePreset");
      expect(src).toContain("device-presets");
    }
    // 切换入口只有舞台一个：编辑态只读不写，不该也挂一个下拉
    expect(stage).toContain("saveDevicePresetId");
    expect(edit).not.toContain("saveDevicePresetId");
  });

  it("⚠ 缩略图采集**不许**跟着预览机型走", () => {
    /**
     * 采集出来的图进应用市场卡片。跟着观看者的机型选择走的话，同一个应用在
     * 不同人机器上会存出不同尺寸的封面——而且完全不会报错，只是卡片忽大忽小。
     * 采集必须锁死在 specPageViewport 这个标准尺寸上。
     */
    for (const rel of [
      "../../studio-landing-shot.tsx",
      "../../../../dev-harness/backfill-shot.tsx",
    ]) {
      const src = read(rel);
      expect(src).toContain("specPageViewport");
      expect(src).not.toContain("findDevicePreset");
      expect(src).not.toContain("loadDevicePresetId");
      expect(src).not.toContain("device-presets");
    }
  });

  it("⚠ 预览机型不许写回后端那个 device（否则换机型=重新生成）", () => {
    const stage = read("../SpecPageLiveStage.tsx");
    // device 仍然只从 pages 里读，preset 只喂 viewport / 机身
    expect(stage).toContain("const device = pages.find(p => p.device)?.device");
    expect(stage).not.toMatch(/setDevice\s*\(/);
    expect(stage).not.toMatch(/device\s*=\s*preset/);
  });
});
