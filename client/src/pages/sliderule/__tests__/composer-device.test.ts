/**
 * 作曲家目标形态下拉：默认 Web，选项从账本长出来。
 *
 * ⚠ 2026-08-30 用户圈了空态两颗 tab。判据必须咬住「不是两档并排」和
 * 「手表不许选」。把菜单改回 phone+desktop 两颗、或把 watch.wired 当可选，
 * 下面必红。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  COMPOSER_DEVICE_OPTIONS,
  composerDeviceMenu,
  composerDeviceTriggerLabel,
  defaultDevice,
} from "../composer-device";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("composerDeviceMenu", () => {
  it("默认 Web，接通档含平板，手表只展示不许选", () => {
    expect(defaultDevice()).toBe("desktop");
    expect(composerDeviceTriggerLabel("desktop")).toBe("Web");
    expect(composerDeviceTriggerLabel("phone")).toBe("应用");
    expect(composerDeviceTriggerLabel("tablet")).toBe("平板");

    const menu = composerDeviceMenu();
    expect(menu[0]).toMatchObject({ id: "desktop", label: "Web", wired: true });
    expect(menu.map(row => row.id)).toEqual(
      expect.arrayContaining(["desktop", "phone", "tablet", "watch"])
    );
    expect(menu.find(row => row.id === "tablet")?.wired).toBe(true);
    expect(menu.find(row => row.id === "watch")).toMatchObject({
      id: "watch",
      label: "手表",
      wired: false,
    });

    const wiredIds = COMPOSER_DEVICE_OPTIONS.map(row => row.id);
    expect(wiredIds).toEqual(expect.arrayContaining(["desktop", "phone", "tablet"]));
    expect(wiredIds).not.toContain("watch");
    expect(COMPOSER_DEVICE_OPTIONS.every(row => row.wired)).toBe(true);
  });


});
