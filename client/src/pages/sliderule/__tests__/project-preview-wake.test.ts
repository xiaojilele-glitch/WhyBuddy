/**
 * 点了唤醒就不能再点。
 *
 * ⚠ 2026-09-19 真机：provisioning 时按钮又变回「唤醒」。
 *   判据盯活路径：面上用 previewWakeLocked；路上的态锁、能再点的态放。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_COMING_UP,
  previewStillStarting,
  previewWakeLocked,
} from "../project-runtime/project-preview-wake";

const SURFACE = path.resolve(
  __dirname,
  "../project-runtime/SandboxPreviewSurface.tsx"
);
const HOOK = path.resolve(
  __dirname,
  "../project-runtime/useProjectPreview.ts"
);
const CSS = path.resolve(__dirname, "../../../index.css");

describe("该不该锁唤醒", () => {
  it("正向：请求在飞、点过还没起来、沙箱在路上，都锁", () => {
    expect(
      previewWakeLocked({ opening: true, starting: false })
    ).toBe(true);
    expect(
      previewWakeLocked({ opening: false, starting: true })
    ).toBe(true);
    expect(
      previewWakeLocked({
        opening: false,
        starting: false,
        status: "provisioning",
      })
    ).toBe(true);
    expect(
      previewWakeLocked({
        opening: false,
        starting: false,
        status: "starting",
      })
    ).toBe(true);
    expect(PREVIEW_COMING_UP.has("installing")).toBe(true);
  });

  it("反向：停着、过期、失败、就绪，都不锁——那是还能点的脸", () => {
    expect(
      previewWakeLocked({ opening: false, starting: false, status: "expired" })
    ).toBe(false);
    expect(
      previewWakeLocked({ opening: false, starting: false, status: "stopped" })
    ).toBe(false);
    expect(
      previewWakeLocked({ opening: false, starting: false, status: "failed" })
    ).toBe(false);
    expect(
      previewWakeLocked({ opening: false, starting: false, status: "ready" })
    ).toBe(false);
    expect(
      previewWakeLocked({ opening: false, starting: false, status: "executing" })
    ).toBe(false);
    expect(
      previewWakeLocked({ opening: false, starting: false, status: null })
    ).toBe(false);
  });

  it("点过之后：没 descriptor 或还在路上继续锁，回到能再点的态才放", () => {
    expect(previewStillStarting(true, null)).toBe(true);
    expect(previewStillStarting(true, "provisioning")).toBe(true);
    expect(previewStillStarting(true, "starting")).toBe(true);
    expect(previewStillStarting(true, "ready")).toBe(false);
    expect(previewStillStarting(true, "expired")).toBe(false);
    expect(previewStillStarting(true, "failed")).toBe(false);
    expect(previewStillStarting(false, "provisioning")).toBe(false);
  });

  it("接在预览面和 hook 上——只写纯函数、面不调，真机按钮还会回来", () => {
    const surface = fs
      .readFileSync(SURFACE, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const hook = fs
      .readFileSync(HOOK, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(surface).toContain("previewWakeLocked(");
    expect(surface).toContain("data-preview-waking");
    expect(surface).toContain("sr-preview-wake-window");
    expect(surface).toContain("sr-preview-page");
    expect(hook).toContain("previewStillStarting(");
    expect(hook).toContain("previewWakeLocked(");
    const css = fs.readFileSync(CSS, "utf8");
    expect(css).toContain("@keyframes sr-preview-page-shimmer");
    expect(css).toContain("@keyframes sr-preview-wake-sweep");
    expect(css).toContain(".sr-preview-wake-spin");
    expect(css).toContain(".sr-reduce-motion .sr-preview-page");
    expect(css).toContain(".sr-reduce-motion .sr-preview-wake-window");
  });
});
