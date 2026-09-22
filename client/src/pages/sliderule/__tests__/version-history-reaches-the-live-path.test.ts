/**
 * 版本史里的模型真的接到舞台填数那条路上了吗。
 *
 * 2026-09-07 烘焙坊 sr-20260907143221：bind 5/5、mv-1 有模型、
 * publishClosure 空，徽章「打过孔但没填上数据」。函数写了对不算——
 * Studio / 入站 hasApp 两处各调一次 deriveSettledFiveSystemModel，
 * 改一处不改另一处不会报错，只有一半不生效（纪律四）。
 *
 * 剥注释再查：本文件与被查文件的事故记录都写着这些词，不剥的话
 * 把调用删了判据照样绿。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const STUDIO = stripComments(
  readFileSync(resolve(__dirname, "../SlideRuleStudio.tsx"), "utf8")
);
const PAGE = stripComments(
  readFileSync(resolve(__dirname, "../../SlideRule.tsx"), "utf8")
);

function callSite(src: string): string {
  const start = src.indexOf("deriveSettledFiveSystemModel(");
  expect(start, "调用点必须在").toBeGreaterThanOrEqual(0);
  return src.slice(start, start + 500);
}

describe("版本史接到 deriveSettledFiveSystemModel 的两个调用点", () => {
  it("SlideRuleStudio 把 modelVersions 交给第三源", () => {
    const call = callSite(STUDIO);
    expect(call).toContain("versions: modelVersions");
    expect(call).toContain("currentId: currentModelVersionId");
    // 反向：只读前两源 = 烘焙坊那场徽章
    expect(call).not.toMatch(
      /deriveSettledFiveSystemModel\(\s*skillContents \?\? \{\},\s*publishClosure\?\.perSkillEvidence\s*\)/
    );
  });

  it("SlideRule 入站 hasApp 也读版本史，不许只改舞台", () => {
    const call = callSite(PAGE);
    expect(call).toContain("versions:");
    expect(call).toContain("modelVersions");
    expect(call).toContain("currentId:");
    expect(call).toContain("currentModelVersionId");
  });
});

describe("HTML 页从孔里收数，不铺高原成品", () => {
  it("Studio 真的调了 harvest / adopt / lock，不是只 import", () => {
    expect(STUDIO).toContain("harvestBoundHtml(");
    expect(STUDIO).toContain("adoptHarvestedRows(");
    expect(STUDIO).toContain("lockSeedDecisions(");
    expect(STUDIO).toContain("htmls.length > 0");
    // 反向：有页面还走无脑 seed = 又是两套世界
    const hydrate = STUDIO.slice(
      STUDIO.indexOf("const htmls = displayPages"),
      STUDIO.indexOf("saveRuntimeState(runtimeSessionId, ready)")
    );
    expect(hydrate.length).toBeGreaterThan(80);
    expect(hydrate).not.toMatch(/seedRuntimeState\(next, fiveSystemModel\)\s*;\s*if \(!alive\)/);
  });
});
