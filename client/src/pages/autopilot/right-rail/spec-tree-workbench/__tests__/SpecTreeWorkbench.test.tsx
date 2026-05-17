/**
 * autopilot-spec-tree-workbench / Wave 0 Task 4
 *
 * SpecTreeWorkbench SSR 渲染契约测试。
 *
 * 实现口径（与本仓现有 React 组件测试保持一致）：
 *
 *   本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`,
 *   `useState` / `useEffect` / `useMemo` 在 `renderToStaticMarkup`
 *   下不会重新触发。因此本文件分两层：
 *
 *   1. 源代码层断言：直接读 `SpecTreeWorkbench.tsx` 文件,确认两个 CTA
 *      testid 与节点行 testid 都在同一文件里出现;
 *   2. SSR 渲染层：只断言「初始无节点选中」时的契约（双 CTA 渲染、节点行
 *      列出、行未展开、状态 chip 出现）。
 *
 * 行展开后的 SpecDocPreviewBlock 渲染、CTA 的 onClick 行为由父组件集成时
 * 通过 manual-verification 覆盖（与 AutopilotRightRail.subtimeline-mount
 * 的策略一致）。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecDocumentStatus,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";

// ─── store mock ───────────────────────────────────────────────────────────

let mockedReasoningEntries: unknown[] = [];

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: any) => unknown) => {
    const state = { agentReasoning: { entries: mockedReasoningEntries } };
    return selector ? selector(state) : state;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;
  return { useBlueprintRealtimeStore };
});

import { SpecTreeWorkbench } from "../SpecTreeWorkbench";

// ─── 工厂 ─────────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  title: string,
  type: BlueprintSpecTreeNode["type"] = "module"
): BlueprintSpecTreeNode {
  return {
    id,
    title,
    summary: `${title} summary`,
    type,
    status: "draft",
    priority: 1,
    dependencies: [],
    outputs: [],
    children: [],
  } as BlueprintSpecTreeNode;
}

function makeTree(
  nodes: BlueprintSpecTreeNode[]
): BlueprintSpecTree {
  return {
    id: "tree-1",
    routeSetId: "rs-1",
    selectionId: "sel-1",
    selectedRouteId: "route-1",
    rootNodeId: nodes[0]?.id ?? "n-0",
    version: 1,
    status: "reviewing",
    createdAt: "2026-05-16T07:00:00.000Z",
    updatedAt: "2026-05-16T07:00:00.000Z",
    alternativeRouteIds: [],
    nodes,
    provenance: {
      jobId: "job-1",
      githubUrls: [],
    },
  } as BlueprintSpecTree;
}

function makeDoc(
  nodeId: string,
  type: BlueprintSpecDocumentType,
  status: BlueprintSpecDocumentStatus = "reviewing"
): BlueprintSpecDocument {
  return {
    id: `doc-${nodeId}-${type}`,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId,
    type,
    status,
    title: `${type} title for ${nodeId}`,
    summary: `${type} summary`,
    content: "",
    format: "markdown",
    createdAt: "2026-05-16T07:00:00.000Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "module",
      nodeTitle: nodeId,
      nodeSummary: "summary",
      dependencies: [],
      outputs: [],
      generationSource: "llm",
    },
  } as BlueprintSpecDocument;
}

const fakeJob = {
  id: "job-1",
  events: [],
  artifacts: [],
} as unknown as BlueprintGenerationJob;

// ─── 用例 ─────────────────────────────────────────────────────────────────

describe("SpecTreeWorkbench (SSR contract)", () => {
  beforeEach(() => {
    mockedReasoningEntries = [];
  });
  afterEach(() => {
    mockedReasoningEntries = [];
  });

  it("specTree 为空 / null 时显示 empty state", () => {
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={null}
        specDocuments={[]}
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-testid="spec-tree-workbench"');
    expect(markup).toContain('data-state="empty"');
    expect(markup).toContain("SPEC 树尚未就绪");
  });

  it("nodes 数组为空时也显示 empty state", () => {
    const tree = makeTree([]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-state="empty"');
  });

  it("nodes 就绪时:渲染顶部双 CTA + 节点行列表(每行带 chip)", () => {
    const tree = makeTree([
      makeNode("n-1", "Auth Module"),
      makeNode("n-2", "Profile"),
    ]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );

    expect(markup).toContain('data-state="ready"');
    // 顶部双 CTA
    expect(markup).toContain('data-testid="spec-tree-workbench-cta-all"');
    expect(markup).toContain('data-testid="spec-tree-workbench-cta-single"');
    expect(markup).toContain("生成整棵树文档");
    expect(markup).toContain("生成当前节点文档");
    // 单节点 CTA 默认 disabled(无选中)
    // 注意:HTML 中 disabled 是布尔属性,可能渲染成 disabled="" 或 disabled
    expect(markup).toMatch(
      /<button[^>]*data-testid="spec-tree-workbench-cta-single"[^>]*disabled/
    );

    // 节点行
    expect(markup).toContain('data-node-id="n-1"');
    expect(markup).toContain('data-node-id="n-2"');
    expect(markup).toContain("Auth Module");
    expect(markup).toContain("Profile");
    // 初始所有行 expanded=false
    expect(markup).not.toContain('data-expanded="true"');

    // 每行 chip 出现(空 docs → 未生成)
    expect(markup).toContain("未生成");
  });

  it("整树 generating='all' 时:主 CTA 显示 generatingLabel 并 disabled", () => {
    const tree = makeTree([makeNode("n-1", "A")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating="all"
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain('data-generating="all"');
    expect(markup).toContain("生成中…");
    // 两个 CTA 都被 disabled
    expect(markup).toMatch(
      /<button[^>]*data-testid="spec-tree-workbench-cta-all"[^>]*disabled/
    );
  });

  it("docs 已存在的节点 chip 显示对应 label + sourceTag", () => {
    const tree = makeTree([makeNode("n-1", "A")]);
    const docs = [
      makeDoc("n-1", "requirements", "reviewing"),
      makeDoc("n-1", "design", "reviewing"),
    ];
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={docs}
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    expect(markup).toContain("2/3 reviewing");
    expect(markup).toContain("· llm");
  });

  it("ephemeral generating 信号通过 store 流入并体现在 chip 上", () => {
    mockedReasoningEntries = [
      {
        id: "evt-1",
        jobId: "job-1",
        iteration: 1,
        iterationLabel: "#1",
        phase: "observing",
        timestamp: "2026-05-16T07:00:00.000Z",
        observationSummary: "✓ A — 规格文档已生成",
        observationSuccess: true,
        stageId: "spec_docs",
      },
    ];
    const tree = makeTree([makeNode("n-1", "A")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={fakeJob}
        specTree={tree}
        specDocuments={[]}
        locale="zh-CN"
        generating="all"
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    // 节点行 chip 应该显示 "生成中"(ephemeral 优先,因为稳定 docs 为空)
    expect(markup).toContain("生成中");
  });

  it("不传 specDocuments 时回退到 deriveSpecDocumentTreeStats(job, specTree)", () => {
    // 这里造一个 job.artifacts 含 spec doc artifact 的场景：不显式传
    // specDocuments，让组件自己从 job.artifacts 抽 docs。
    const specDocPayload = {
      id: "doc-1",
      jobId: "job-1",
      treeId: "tree-1",
      nodeId: "n-1",
      type: "requirements",
      status: "reviewing",
      title: "Auth req",
      summary: "auth requirements summary",
      content: "",
      format: "markdown",
      createdAt: "2026-05-16T07:00:00.000Z",
      provenance: {
        jobId: "job-1",
        githubUrls: [],
        treeVersion: 1,
        nodeType: "module",
        nodeTitle: "A",
        nodeSummary: "A",
        dependencies: [],
        outputs: [],
        generationSource: "llm",
      },
    };
    const jobWithArtifact = {
      id: "job-1",
      events: [],
      artifacts: [
        {
          id: "artifact-1",
          type: "requirements",
          payload: specDocPayload,
        },
      ],
    } as unknown as BlueprintGenerationJob;

    const tree = makeTree([makeNode("n-1", "A")]);
    const markup = renderToStaticMarkup(
      <SpecTreeWorkbench
        jobId="job-1"
        job={jobWithArtifact}
        specTree={tree}
        // specDocuments 故意不传
        locale="zh-CN"
        generating={null}
        onGenerateAll={() => {}}
        onGenerateNode={() => {}}
      />
    );
    // chip 应该显示 "1/3 reviewing"（从 job.artifacts 提取出来）
    expect(markup).toContain("1/3 reviewing");
    expect(markup).toContain("· llm");
  });
});

// ─── Layer 1：源代码层契约 ────────────────────────────────────────────────

describe("SpecTreeWorkbench (source-level contract)", () => {
  it("源文件包含两个 CTA testid + 节点行 testid + 行展开 testid", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../SpecTreeWorkbench.tsx"),
      "utf8"
    );

    expect(source).toContain('data-testid="spec-tree-workbench-cta-all"');
    expect(source).toContain('data-testid="spec-tree-workbench-cta-single"');
    expect(source).toContain('data-testid="spec-tree-workbench-row"');
    expect(source).toContain(
      'data-testid="spec-tree-workbench-row-expanded"'
    );

    // CTA single 必须在 selectedNodeId === null 时 disabled
    expect(source).toMatch(/disabled=\{anyGenerating \|\| selectedNodeId === null\}/);
    // CTA all 调用 onGenerateAll
    expect(source).toMatch(/onClick=\{onGenerateAll\}/);
    // 行点击触发 onClick(node.id)
    expect(source).toMatch(/onClick=\{\(\) => onClick\(node\.id\)\}/);
  });
});
