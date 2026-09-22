/**
 * P3-2：dev 下 Node 不许为缺失的 dist/public/index.html 刷 ENOENT。
 *
 * 变异：catch-all 再无脑 sendFile，本文件必须红。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function src(): string {
  const p = resolve(__dirname, "../index.ts");
  return readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("dev SPA fallback 静音", () => {
  it("catch-all 在非 production 且文件不存在时 404，不 sendFile", () => {
    const body = src();
    expect(body).toContain("existsSync(indexFile)");
    expect(body).toContain('NODE_ENV !== "production"');
    expect(body).toContain("res.status(404)");
    const at = body.indexOf("existsSync(indexFile)");
    const slice = body.slice(Math.max(0, at - 200), at + 250);
    expect(slice).toContain("index.html");
    expect(slice).toContain("res.status(404)");
  });

  it("production 仍 sendFile", () => {
    const body = src();
    expect(body).toContain("res.sendFile(indexFile)");
  });
});
