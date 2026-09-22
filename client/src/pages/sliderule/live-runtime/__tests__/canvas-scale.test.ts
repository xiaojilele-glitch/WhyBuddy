/**
 * 缩放系数必须能被变异咬住：拖分栏卡顿修的就是「每帧都 setScale」。
 * 公式写错、epsilon 放太大、paused 时仍提交，都会让修法失效。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PHONE_STAGE_MAX_SCALE,
  SCALE_EPSILON,
  clampCanvasScale,
  computeScaleToFit,
  scaleNeedsCommit,
  specPageViewport,
} from "../canvas-scale";

describe("computeScaleToFit", () => {
  it("contain 取宽高比里更小的那一档", () => {
    expect(computeScaleToFit(960, 540, 1920, 1080)).toBe(0.5);
    expect(computeScaleToFit(1920, 200, 1920, 1080)).toBeCloseTo(200 / 1080);
  });

  it("width 只跟容器宽走", () => {
    expect(computeScaleToFit(960, 10, 1920, 1080, "width")).toBe(0.5);
  });

  it("cover 取更能铺满的那一档——宽画布进竖卡不能只按宽度缩", () => {
    // 300×533 的 9:16 卡 × 1920×1080：width = 300/1920 ≈ 0.156，
    // 缩放后高 169，卡还剩一大截白。cover 按高度 = 533/1080。
    const cover = computeScaleToFit(300, 533, 1920, 1080, "cover");
    const widthOnly = computeScaleToFit(300, 533, 1920, 1080, "width");
    expect(cover).toBeCloseTo(533 / 1080);
    expect(cover!).toBeGreaterThan(widthOnly!);
    expect(1920 * cover!).toBeGreaterThanOrEqual(300);
    expect(1080 * cover!).toBeGreaterThanOrEqual(533);
  });

  it("量不到容器就不要瞎给 1——1 会把 1920 画布撑出容器", () => {
    expect(computeScaleToFit(0, 540, 1920, 1080)).toBeNull();
    expect(computeScaleToFit(960, 0, 1920, 1080)).toBeNull();
    expect(computeScaleToFit(960, 0, 1920, 1080, "width")).toBe(0.5);
    expect(computeScaleToFit(960, 0, 1920, 1080, "cover")).toBeNull();
  });
});

describe("scaleNeedsCommit", () => {
  it("亚像素抖动不提交", () => {
    expect(scaleNeedsCommit(0.5, 0.5 + SCALE_EPSILON / 2)).toBe(false);
    expect(scaleNeedsCommit(0.5, 0.52)).toBe(true);
  });
});

describe("手机舞台缩放封顶", () => {
  it("手机舞台缩放封顶 80%，容器更小时仍按 contain 再缩", () => {
    /**
     * ⚠ 2026-08-20：用户指着 110% 说默认 80%。改回 1 或拿掉封顶必须红。
     */
    expect(PHONE_STAGE_MAX_SCALE).toBe(0.8);
    expect(clampCanvasScale(1.1, PHONE_STAGE_MAX_SCALE)).toBe(0.8);
    expect(clampCanvasScale(0.5, PHONE_STAGE_MAX_SCALE)).toBe(0.5);
    expect(clampCanvasScale(0.9)).toBe(0.9);
  });
});

describe("useScaleToFit 订阅顺序", () => {
  it("先订 ResizeObserver 再量，否则分栏 autoSave 那一缩会漏掉", () => {
    const src = readFileSync(new URL("../canvas-scale.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const branch = src.indexOf("typeof ResizeObserver");
    const observeAt = src.indexOf("ro.observe", branch);
    const measureAt = src.indexOf("measure()", observeAt);
    expect(observeAt).toBeGreaterThan(branch);
    expect(measureAt).toBeGreaterThan(observeAt);
  });
});

describe("specPageViewport", () => {
  it("手机画布是 CSS 像素机身，不是 1080 物理像素", () => {
    /**
     * ⚠ 1080 下 Tailwind `lg:`（1024）着火，模型再套 max-w-md 机模，
     * 内容缩在框中间。钉「宽 < sm(640)」：改回 1080 这条必红。
     */
    expect(specPageViewport("phone")).toEqual({ w: 390, h: 844 });
    expect(specPageViewport("phone").w).toBeLessThan(640);
  });

  it("桌面画布钉 1920×1080 —— 试过正方形又改回 16:9", () => {
    /**
     * 2026-08-20 晚试过 1920×1920，用户看完改回 16:9。
     * 高改成 1920 这条必须红。宽改离 1920，`2xl:` 会塌。
     */
    expect(specPageViewport("desktop")).toEqual({ w: 1920, h: 1080 });
    expect(specPageViewport("desktop").h).not.toBe(1920);
  });

  it("平板画布钉 1112×834，不许折成 1920", () => {
    /**
     * 2026-08-30 夜：`phone ? 390 : 1920` 让 dropdown 选了平板，
     * 舞台徽标仍是 1920×1080。把 tablet 枝删掉本条必须红。
     */
    expect(specPageViewport("tablet")).toEqual({ w: 1112, h: 834 });
    expect(specPageViewport("tablet")).not.toEqual(specPageViewport("desktop"));
    expect(specPageViewport("tablet")).not.toEqual(specPageViewport("phone"));
  });
});
