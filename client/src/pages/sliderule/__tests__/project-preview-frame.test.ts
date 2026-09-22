/**
 * 票到了还要盖着，load 才揭。
 *
 * ⚠ 2026-09-19 真机地址栏是 `/_whybuddy/authorize?ticket=…`，
 *   框是白的。判据盯活路径：面上用 previewFrameCovered；
 *   授权入口在行里必须是 `/`，票不许出现。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  previewAddressPath,
  previewAddressTitle,
  previewFrameAfterLoad,
  previewFrameCovered,
  previewIsAuthorizeEntry,
  previewOpenUrl,
} from "../project-runtime/project-preview-frame";

const SURFACE = path.resolve(
  __dirname,
  "../project-runtime/SandboxPreviewSurface.tsx"
);

describe("预览框盖层", () => {
  const ticket =
    "https://rt-one.preview.test/_whybuddy/authorize?ticket=secret-ticket";

  it("正向：有票、框还没 load，要盖", () => {
    expect(
      previewFrameCovered({ entryUrl: ticket, frameReady: false })
    ).toBe(true);
  });

  it("反向：没票、或框已经 load，都不盖", () => {
    expect(
      previewFrameCovered({ entryUrl: null, frameReady: false })
    ).toBe(false);
    expect(
      previewFrameCovered({ entryUrl: ticket, frameReady: true })
    ).toBe(false);
  });

  it("授权入口在行里是 /，title 也不许摊票", () => {
    expect(previewAddressPath(ticket)).toBe("/");
    expect(previewAddressTitle(ticket)).toBe("https://rt-one.preview.test/");
    expect(previewAddressTitle(ticket)).not.toContain("ticket=");
    expect(
      previewAddressPath("http://runtime-one.localhost:3100/tasks?view=all")
    ).toBe("/tasks?view=all");
  });

  it("title 剥票；授权入口必须另开一张，不许拿 / 当 href", () => {
    expect(previewIsAuthorizeEntry(ticket)).toBe(true);
    expect(
      previewIsAuthorizeEntry("http://runtime-one.localhost:3100/tasks?view=all")
    ).toBe(false);
    expect(previewOpenUrl(ticket)).toBe("https://rt-one.preview.test/");
    expect(previewOpenUrl(ticket)).not.toContain("ticket=");
    expect(
      previewOpenUrl("http://runtime-one.localhost:3100/tasks?view=all")
    ).toBe("http://runtime-one.localhost:3100/tasks?view=all");
  });

  it("授权兑票那一载不许揭盖，要再进 origin/", () => {
    const afterTicket = previewFrameAfterLoad({
      entryUrl: ticket,
      loadedSrc: ticket,
    });
    expect(afterTicket.ready).toBe(false);
    expect(afterTicket.nextSrc).toBe("https://rt-one.preview.test/");
    expect(afterTicket.nextSrc).not.toContain("ticket=");
    const afterApp = previewFrameAfterLoad({
      entryUrl: ticket,
      loadedSrc: "https://rt-one.preview.test/",
    });
    expect(afterApp.ready).toBe(true);
    expect(afterApp.nextSrc).toBe("https://rt-one.preview.test/");
  });

  it("反向：已经是应用地址，不许把 src 改回票", () => {
    const again = previewFrameAfterLoad({
      entryUrl: ticket,
      loadedSrc: "https://rt-one.preview.test/",
    });
    expect(again.nextSrc).not.toContain("ticket=");
    expect(
      previewFrameAfterLoad({
        entryUrl: "http://runtime-one.localhost:3100/tasks",
        loadedSrc: "http://runtime-one.localhost:3100/tasks",
      }).ready
    ).toBe(true);
  });

  it("接在预览面上——只写纯函数、面不盖，真机还是白屏", () => {
    const src = fs
      .readFileSync(SURFACE, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(src).toContain("previewFrameCovered(");
    expect(src).toContain("previewFrameAfterLoad(");
    expect(src).toContain("project-preview-frame-loading");
    expect(src).toContain("onLoad");
    expect(src).toContain("previewAddressPath(");
    expect(src).toContain("previewIsAuthorizeEntry(");
    expect(src).toContain("openExternal");
    expect(src).toContain("previewOpenUrl(");
    expect(src).toMatch(/src=\{frameSrc/);
    expect(src).not.toMatch(/href=\{entryUrl\}/);
    expect(src).not.toMatch(
      /getAttribute\("src"\) === preview\.entryUrl/
    );
    const loadingAt = src.indexOf("project-preview-frame-loading");
    expect(loadingAt).toBeGreaterThan(-1);
    const cover = src.slice(Math.max(0, loadingAt - 500), loadingAt + 80);
    expect(cover).toMatch(/absolute inset-0 z-\[1\] flex min-h-0 flex-col/);
    // 反向：只铺 inset-0、父级不是 flex，脸 flex-1 没用，窗骨架贴顶。
    expect(cover).not.toMatch(/<div className="absolute inset-0 z-\[1\]">/);
    expect(src).toMatch(
      /flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center/
    );
  });
});
