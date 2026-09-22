/**
 * 预览「还在」：看得见才报 /touch。
 *
 * ⚠ 2026-09-19 坦克大战 lastAccessAt 全程空。判据盯活路径：
 *   预览面真的 POST /touch；轮询 GET、切走、藏起不许报。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldKeepPreviewAlive } from "../project-runtime/project-preview-presence";

const SURFACE = path.resolve(
  __dirname,
  "../project-runtime/SandboxPreviewSurface.tsx"
);

describe("该不该报还在", () => {
  const watching = {
    view: "preview",
    hasTicket: true,
    operationId: "operation-one",
    visible: true,
  };

  it("正向：预览页签开着、票还在、标签看得见", () => {
    expect(shouldKeepPreviewAlive(watching)).toBe(true);
  });

  it("反向：切到代码/终端、没票、没 operation、标签藏起，都不报", () => {
    expect(shouldKeepPreviewAlive({ ...watching, view: "source" })).toBe(false);
    expect(shouldKeepPreviewAlive({ ...watching, view: "computer" })).toBe(
      false
    );
    expect(shouldKeepPreviewAlive({ ...watching, hasTicket: false })).toBe(
      false
    );
    expect(shouldKeepPreviewAlive({ ...watching, operationId: "" })).toBe(
      false
    );
    expect(shouldKeepPreviewAlive({ ...watching, visible: false })).toBe(false);
  });

  it("接在预览面上——只写纯函数、面不调，真机还是空倒 5 分钟", () => {
    const src = fs.readFileSync(SURFACE, "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(code).toContain("usePreviewPresence(");
    expect(code).toContain("presence.nudge(");
  });
});
