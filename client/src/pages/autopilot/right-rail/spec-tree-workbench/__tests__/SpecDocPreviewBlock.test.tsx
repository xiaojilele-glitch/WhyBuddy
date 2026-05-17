/**
 * autopilot-spec-tree-workbench / Wave 0 Task 3
 *
 * SpecDocPreviewBlock SSR 单测。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  BlueprintSpecDocument,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentType,
} from "@shared/blueprint/contracts";

import { SpecDocPreviewBlock } from "../SpecDocPreviewBlock";

function makeDoc(
  type: BlueprintSpecDocumentType,
  status: BlueprintSpecDocumentStatus = "reviewing",
  source:
    | BlueprintSpecDocument["provenance"]["generationSource"]
    | undefined = "llm",
  title = `${type} title`,
  summary = `${type} summary`
): BlueprintSpecDocument {
  return {
    id: `doc-${type}`,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId: "node-1",
    type,
    status,
    title,
    summary,
    content: "",
    format: "markdown",
    createdAt: "2026-05-16T07:00:00.000Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "module",
      nodeTitle: "node-1",
      nodeSummary: "summary",
      dependencies: [],
      outputs: [],
      generationSource: source,
    },
  } as BlueprintSpecDocument;
}

describe("SpecDocPreviewBlock", () => {
  it("文档存在: 渲染 type 徽章 / status / source / title / summary", () => {
    const markup = renderToStaticMarkup(
      <SpecDocPreviewBlock
        type="requirements"
        document={makeDoc(
          "requirements",
          "reviewing",
          "llm",
          "Auth Requirements",
          "Module-level authentication requirements"
        )}
      />
    );
    expect(markup).toContain('data-doc-type="requirements"');
    expect(markup).toContain('data-doc-state="present"');
    expect(markup).toContain('data-doc-status="reviewing"');
    expect(markup).toContain('data-doc-source="llm"');
    expect(markup).toContain("requirements");
    expect(markup).toContain("reviewing");
    expect(markup).toContain("Auth Requirements");
    expect(markup).toContain("Module-level authentication");
  });

  it("文档不存在: 显示 '尚未生成' 占位 + missing 状态", () => {
    const markup = renderToStaticMarkup(
      <SpecDocPreviewBlock type="design" document={undefined} />
    );
    expect(markup).toContain('data-doc-type="design"');
    expect(markup).toContain('data-doc-state="missing"');
    expect(markup).toContain("尚未生成");
    // 不应渲染 status / title / summary
    expect(markup).not.toContain('data-doc-status');
  });

  it("generationSource = 'llm_fallback' 显示为 'fallback'", () => {
    const markup = renderToStaticMarkup(
      <SpecDocPreviewBlock
        type="design"
        document={makeDoc("design", "draft", "llm_fallback")}
      />
    );
    expect(markup).toContain('data-doc-source="fallback"');
    expect(markup).toContain("· fallback");
  });

  it("generationSource = 'template' 显示为 'template'", () => {
    const markup = renderToStaticMarkup(
      <SpecDocPreviewBlock
        type="tasks"
        document={makeDoc("tasks", "accepted", "template")}
      />
    );
    expect(markup).toContain('data-doc-source="template"');
    expect(markup).toContain("· template");
  });

  it("generationSource = undefined 折算为 'llm'", () => {
    const markup = renderToStaticMarkup(
      <SpecDocPreviewBlock
        type="requirements"
        document={makeDoc("requirements", "reviewing", undefined)}
      />
    );
    expect(markup).toContain('data-doc-source="llm"');
  });

  it("status = 'rejected' 仍能正常渲染", () => {
    const markup = renderToStaticMarkup(
      <SpecDocPreviewBlock
        type="design"
        document={makeDoc("design", "rejected", "llm")}
      />
    );
    expect(markup).toContain('data-doc-status="rejected"');
    expect(markup).toContain("rejected");
  });
});
