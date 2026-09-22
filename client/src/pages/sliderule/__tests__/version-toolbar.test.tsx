/**
 * 版本条说「变体」，不把 v2/v3 当产品名词。
 *
 * 没有浏览器工具：用 DOM 静态渲染钉文案。data-testid 保持原名，
 * 免得现有测试去猎杀。
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SlideRuleStudio } from "../SlideRuleStudio";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const STUDIO = stripComments(
  readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
);

const PAGES = [
  {
    pageId: "p1",
    html: "<!doctype html><html><body>x</body></html>",
    current: 1,
    total: 1,
    bound: false as const,
  },
];

const VERSIONS = [
  { id: "mv-1", instruction: "初稿" },
  { id: "mv-2", instruction: "加一页投诉" },
  { id: "mv-3", instruction: "改角色名" },
];

describe("版本条变体语言", () => {
  it("DOM 主标签是变体 n/m，不是 v2/v3", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStudio
        chatSlot={<div />}
        activeSkillId={null}
        specPages={PAGES}
        modelVersions={VERSIONS}
        currentModelVersionId="mv-2"
        onRestoreVersion={() => {}}
        onForkVariant={() => {}}
      />
    );
    expect(html).toContain('data-testid="sliderule-version-toolbar"');
    expect(html).toContain('data-testid="sliderule-version-back"');
    expect(html).toContain('data-testid="sliderule-version-forward"');
    expect(html).toContain("变体 2/3");
    expect(html).toContain("回到上一变体");
    expect(html).toContain("前进到下一变体");
    expect(html).toContain("分一变体");
    expect(html).toContain('data-testid="sliderule-version-fork"');
    expect(html).not.toContain(">v2/3<");
    expect(html).not.toContain(">v2/");
    expect(html).not.toContain("已是最早版本");
    expect(html).not.toContain("已是最新版本");
    expect(html).not.toContain("Fork 应用");
    expect(html).not.toContain("回退到 v");
    expect(html).not.toContain("前进到 v");
  });

  it("没传 fork 处理器就不露出分一变体", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStudio
        chatSlot={<div />}
        activeSkillId={null}
        specPages={PAGES}
        modelVersions={VERSIONS}
        currentModelVersionId="mv-1"
        onRestoreVersion={() => {}}
      />
    );
    expect(html).toContain("变体 1/3");
    expect(html).toContain("已是最早变体");
    expect(html).not.toContain("分一变体");
    expect(html).not.toContain('data-testid="sliderule-version-fork"');
  });

  it("源码剥注释后不以 v{idx 当主标签，分变体走已有 fork_variant", () => {
    expect(STUDIO).toContain("变体 {idx + 1}/{modelVersions.length}");
    expect(STUDIO).not.toContain("v{idx + 1}/{modelVersions.length}");
    expect(STUDIO).toContain("回到上一变体");
    expect(STUDIO).toContain("前进到下一变体");
    expect(STUDIO).toContain("分一变体");
    expect(STUDIO).not.toContain("Fork 应用");
    const session = stripComments(
      readFileSync(
        new URL("../useSlideRuleSession.ts", import.meta.url),
        "utf8"
      )
    );
    const forkFn = session.slice(
      session.indexOf("const forkVariant = async"),
      session.indexOf("const notifyRestoreFailure")
    );
    expect(forkFn).toContain("postControlTurnStream");
    expect(forkFn).toContain('forcedTool: "fork_variant"');
    expect(forkFn).toContain("onControlToolResult");
    expect(forkFn).toContain("notifyRestoreFailure");
    expect(forkFn).toMatch(/versionId|finalState|modelVersions/);
    expect(forkFn).not.toContain("Fork 应用");
  });
});
