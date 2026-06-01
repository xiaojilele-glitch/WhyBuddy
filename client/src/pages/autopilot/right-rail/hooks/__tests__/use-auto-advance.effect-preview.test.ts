import { describe, expect, it } from "vitest";

async function loadHookSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.resolve(__dirname, "../use-auto-advance.ts"), "utf8");
}

function extractAutoAdvanceEffectBody(source: string): string {
  const match = source.match(
    /\/\/ 监听 job\.stage 变化,自动触发下一阶段[\s\S]*?useEffect\s*\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[jobId,\s*job,\s*specTree,\s*advancing,\s*advance,\s*actions\]\s*\);/
  );
  expect(match, "auto-advance useEffect body should be extractable").not.toBeNull();
  return match![1];
}

function extractForceAdvanceBody(source: string): string {
  const match = source.match(
    /const\s+forceAdvance\s*=\s*useCallback\s*\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[/
  );
  expect(match, "forceAdvance body should be extractable").not.toBeNull();
  return match![1];
}

describe("useAutoAdvance effect_preview manual advance contract", () => {
  it("does not auto-advance effect_preview or preview to prompt_packaging from the useEffect path", async () => {
    const source = await loadHookSource();
    const autoEffectBody = extractAutoAdvanceEffectBody(source);

    expect(autoEffectBody).not.toMatch(
      /\(stage\s*===\s*"effect_preview"\s*\|\|\s*stage\s*===\s*"preview"\)[\s\S]*?advance\(\s*"prompt_packaging"/
    );
    expect(autoEffectBody).toMatch(
      /stage\s*===\s*"spec_docs"[\s\S]*?advance\(\s*"effect_preview"/
    );
    expect(autoEffectBody).toMatch(
      /stage\s*===\s*"prompt_packaging"[\s\S]*?advance\(\s*"engineering_landing"/
    );
  });

  it("keeps effect_preview and preview manual forceAdvance wired to prompt_packaging with draft inputs", async () => {
    const source = await loadHookSource();
    const forceAdvanceBody = extractForceAdvanceBody(source);

    expect(forceAdvanceBody).toMatch(
      /stage\s*===\s*"effect_preview"\s*\|\|\s*stage\s*===\s*"preview"[\s\S]*?advance\(\s*"prompt_packaging"/
    );
    expect(forceAdvanceBody).toMatch(/includeDrafts:\s*true/);
    expect(forceAdvanceBody).toMatch(/includePreviewDrafts:\s*true/);
  });
});
