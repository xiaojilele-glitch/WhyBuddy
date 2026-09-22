/**
 * P2-3：图判降级 / 孤岛 / 对比必须上到 SSE 和交付面。
 *
 * 反向：
 *   · 驱动器丢掉 case "quality_notice" → 本文件红
 *   · useSlideRuleSession 不接 onQualityNotice → 本文件红
 *   · ArchitectureStage / AppBundle 不渲染 notices → 本文件红
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArchitectureStage } from "../ArchitectureStage";
import { AppBundleScreen } from "../system-screens/AppBundleScreen";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const DRIVER = stripComments(
  readFileSync(
    new URL("../../../lib/sliderule-marathon-driver.ts", import.meta.url),
    "utf8"
  )
);
const SESSION = stripComments(
  readFileSync(new URL("../useSlideRuleSession.ts", import.meta.url), "utf8")
);
const STUDIO = stripComments(
  readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
);
const ACTIVE = stripComments(
  readFileSync(
    new URL("../system-screens/ActiveSystemScreen.tsx", import.meta.url),
    "utf8"
  )
);

describe("质量提示接到活路径", () => {
  it("驱动器认 quality_notice，并回调 onQualityNotice", () => {
    const block = DRIVER.slice(
      DRIVER.indexOf('case "quality_notice"'),
      DRIVER.indexOf('case "run_pause_started"')
    );
    expect(block.length).toBeGreaterThan(40);
    expect(block).toContain("onQualityNotice");
    expect(block).toContain("kind");
    expect(block).toContain("text");
  });

  it("会话把 notice 写进 specFirstPages.qualityNotices", () => {
    const fn = SESSION.slice(
      SESSION.indexOf("onQualityNotice:"),
      SESSION.indexOf("onSpecAssumptions:")
    );
    expect(fn).toContain("qualityNotices");
    expect(fn).toContain("note.text");
    expect(fn).toContain("specFirstPages");
  });

  it("架构图和交付页都吃 specFirstPages.qualityNotices", () => {
    expect(STUDIO).toContain("qualityNotices={");
    expect(STUDIO).toContain("specFirstPages?.qualityNotices");
    expect(ACTIVE).toContain("qualityNotices={qualityNotices}");
  });

  it("本跳 tools 传到 Checks，spec 单跳不许沿用 6/6", () => {
    expect(STUDIO).toContain("roundTools={specFirstPages?.capabilityPlan?.tools}");
  });
});

describe("交付面真的画出降级标记", () => {
  const notices = [
    { kind: "graph_scope_fallback", text: "图判作用域缺席，重画范围回落文本判" },
    { kind: "orphan", text: "交付的应用带着 1 个孤岛：entity:lonely" },
  ];

  it("架构图列出每条 notice", () => {
    const html = renderToStaticMarkup(
      <ArchitectureStage
        onInspect={() => {}}
        publishClosure={null}
        qualityNotices={notices}
      />
    );
    expect(html).toContain('data-testid="sliderule-quality-notices"');
    expect(html).toContain("图判作用域缺席");
    expect(html).toContain("1 个孤岛");
    expect(html).toContain('data-kind="graph_scope_fallback"');
    expect(html).toContain('data-kind="orphan"');
  });

  it("反向：没有 notice 时交付面不许冒出空列表", () => {
    const html = renderToStaticMarkup(
      <ArchitectureStage onInspect={() => {}} publishClosure={null} />
    );
    expect(html).not.toContain('data-testid="sliderule-quality-notices"');
    const bundle = renderToStaticMarkup(<AppBundleScreen />);
    expect(bundle).not.toContain('data-testid="sliderule-quality-notices"');
  });

  it("Checks 页同样画出 notice", () => {
    const html = renderToStaticMarkup(
      <AppBundleScreen qualityNotices={notices} />
    );
    expect(html).toContain('data-testid="sliderule-quality-notices"');
    expect(html).toContain("图判作用域缺席");
  });
});
