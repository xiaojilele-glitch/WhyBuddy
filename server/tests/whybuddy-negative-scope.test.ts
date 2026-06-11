/**
 * Task 9.1 — Negative scope regression smoke (revision G).
 * Scans client/src, server, shared source only (excludes docs/spec).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeliberationCapability } from "../whybuddy/deliberation-exec-map.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const SCAN_ROOTS = ["client/src", "server", "shared"];
const THIS_TEST = relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, "/");

const BANNED_IDENTIFIERS = ["decideBrainstormPath", "BRAINSTORM_WHITELIST"] as const;

function walkSourceFiles(dir: string, bucket: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walkSourceFiles(full, bucket);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
    const rel = relative(ROOT, full).replace(/\\/g, "/");
    if (rel.includes("/docs/") || rel.includes(".kiro/specs/")) continue;
    if (rel === THIS_TEST) continue;
    bucket.push(full);
  }
}

function collectScannedFiles(): string[] {
  const files: string[] = [];
  for (const relRoot of SCAN_ROOTS) {
    const abs = join(ROOT, relRoot);
    if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
      walkSourceFiles(abs, files);
    }
  }
  return files;
}

describe("Task 9.1: negative scope regression smoke", () => {
  const files = collectScannedFiles();

  it("scans client/src, server, shared source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const banned of BANNED_IDENTIFIERS) {
    it(`source tree does not contain deleted identifier: ${banned}`, () => {
      const hits: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        if (text.includes(banned)) {
          hits.push(relative(ROOT, file).replace(/\\/g, "/"));
        }
      }
      expect(hits).toEqual([]);
    });
  }

  it("does not introduce D_GATE capability whitelist in whybuddy source", () => {
    const whybuddyHits: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (!rel.includes("whybuddy") && !rel.includes("WhyBuddy")) continue;
      const text = readFileSync(file, "utf8");
      if (/\bD_GATE\b/.test(text) && /WHITELIST|whitelist|capability.*gate/i.test(text)) {
        whybuddyHits.push(rel);
      }
    }
    expect(whybuddyHits).toEqual([]);
  });

  it("whybuddy execute-capability does not route deliberation caps through wrapStageWithBrainstorm", () => {
    const routePath = join(ROOT, "server/routes/whybuddy.ts");
    const text = readFileSync(routePath, "utf8");
    expect(text).not.toContain("wrapStageWithBrainstorm");
    expect(text).toContain("executeDeliberationCapabilityMapped");
    expect(text).toContain("isDeliberationCapability");
  });

  it("four Deliberation_Capabilities are R2-only; risk.analyze is not deliberation", () => {
    const deliberation = [
      "counter.argue",
      "critique.generate",
      "rebuttal.resolve",
      "synthesis.merge",
    ] as const;
    for (const cap of deliberation) {
      expect(isDeliberationCapability(cap)).toBe(true);
    }
    expect(isDeliberationCapability("risk.analyze")).toBe(false);
    expect(isDeliberationCapability("report.write")).toBe(false);
  });
});