/**
 * whybuddy-spec-tree-progress-merge-2026-05-29 §8 — SPEC 树节点行进度状态 SSR 契约。
 *
 * 验证把原 SpecDocsProgressPanel 浮层合并进 WorkbenchSpecTree 节点行后的渲染：
 * - 5 态状态图标（pending / processing / completed / failed / retried-completed）
 * - retried-completed 的 data-retried="true" + ⚠ 角标 + tooltip
 * - 双 background：processing cream / selected cool-gray / 同时 cool-gray 覆盖
 * - 副标题 `n/n 修订` 仅在 generated>0 时出现
 * - `节点 · N` header == nodes.length
 * - nodeStatusById 缺某节点时该行回退 pending（容错）
 * - PBT：随机混合状态，渲染的 status testid 数 == 节点数
 *
 * 沿用本仓 `renderToStaticMarkup` + `vi.mock` 模式，不引入 jsdom / testing-library。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((selector?: (state: unknown) => unknown) => {
    const snapshot = {
      agentReasoning: { entries: [] as unknown[] },
      rolePhases: {} as Record<string, unknown>,
      agentProgress: {} as Record<string, unknown>,
      capabilityStatuses: [] as unknown[],
    };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;
  return { useBlueprintRealtimeStore, __setSocket: () => {} };
});

import type {
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";

import {
  WorkbenchSpecTree,
  type WorkbenchSpecTreeNodeStatusMap,
  type WorkbenchSpecTreeProps,
} from "../WorkbenchSpecTree";

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  title: string,
  parentId?: string,
  childIds: string[] = []
): BlueprintSpecTreeNode {
  return {
    id,
    parentId,
    title,
    summary: `${title} summary`,
    type: "route_step",
    status: "draft",
    priority: 1,
    dependencies: [],
    outputs: [],
    children: childIds,
  } as BlueprintSpecTreeNode;
}

function makeDoc(
  nodeId: string,
  type: BlueprintSpecDocumentType
): BlueprintSpecDocument {
  return {
    id: `doc-${nodeId}-${type}`,
    jobId: "job-1",
    treeId: "tree-1",
    nodeId,
    type,
    status: "accepted",
    title: `${type} for ${nodeId}`,
    summary: `${type} summary`,
    content: "",
    format: "markdown",
    createdAt: "2026-05-29T07:00:00.000Z",
    provenance: {
      jobId: "job-1",
      githubUrls: [],
      treeVersion: 1,
      nodeType: "route_step",
      nodeTitle: nodeId,
      nodeSummary: "summary",
      dependencies: [],
      outputs: [],
      generationSource: "llm",
    },
  } as unknown as BlueprintSpecDocument;
}

function makeTree(nodes: BlueprintSpecTreeNode[]): BlueprintSpecTree {
  return {
    id: "tree-1",
    routeSetId: "rs-1",
    selectionId: "sel-1",
    selectedRouteId: "route-1",
    rootNodeId: nodes[0]?.id ?? "n-0",
    version: 1,
    status: "reviewing",
    createdAt: "2026-05-29T07:00:00.000Z",
    updatedAt: "2026-05-29T07:00:00.000Z",
    alternativeRouteIds: [],
    nodes,
    provenance: { jobId: "job-1", githubUrls: [] },
  } as unknown as BlueprintSpecTree;
}

// 5 个根节点对应 5 种状态，便于一次性断言。
const NODES = [
  makeNode("n-pending", "待生成节点"),
  makeNode("n-processing", "进行中节点"),
  makeNode("n-completed", "已完成节点"),
  makeNode("n-failed", "失败节点"),
  makeNode("n-retried", "重试成功节点"),
];

function makeProps(
  overrides: Partial<WorkbenchSpecTreeProps> = {}
): WorkbenchSpecTreeProps {
  const nodeStatusById: WorkbenchSpecTreeNodeStatusMap = {
    "n-pending": { status: "pending" },
    "n-processing": { status: "processing" },
    "n-completed": { status: "completed" },
    "n-failed": { status: "failed", errorSummary: "agent timeout" },
    "n-retried": {
      status: "completed",
      wasRetried: true,
      errorSummary: "agent timeout",
    },
  };
  return {
    specTree: makeTree(NODES),
    specDocuments: [],
    reasoningEntries: [],
    activeDocId: null,
    activeNodeId: null,
    onSelectDocument: () => {},
    generating: null,
    nodeStatusById,
    locale: "zh-CN",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("WorkbenchSpecTree · node status merge", () => {
  it("renders a status icon with correct data-status for all 5 states", () => {
    const markup = renderToStaticMarkup(<WorkbenchSpecTree {...makeProps()} />);

    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree-status-n-pending"');
    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree-status-n-processing"');
    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree-status-n-completed"');
    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree-status-n-failed"');

    expect(markup).toContain('data-status="pending"');
    expect(markup).toContain('data-status="processing"');
    expect(markup).toContain('data-status="completed"');
    expect(markup).toContain('data-status="failed"');
  });

  it("retried-completed node shows data-retried + warn badge + tooltip", () => {
    const markup = renderToStaticMarkup(<WorkbenchSpecTree {...makeProps()} />);

    // The retried node carries data-retried + a retry badge + the original
    // failure reason as the title tooltip (A2 white-box trail).
    expect(markup).toContain('data-retried="true"');
    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree-retry-badge-n-retried"');
    expect(markup).toContain("agent timeout");
  });

  it("a plain completed node does NOT carry data-retried", () => {
    const markup = renderToStaticMarkup(<WorkbenchSpecTree {...makeProps()} />);
    // n-completed is completed but not retried → no badge for that node.
    expect(markup).not.toContain(
      'data-testid="autopilot-workbench-spec-tree-retry-badge-n-completed"'
    );
  });

  it("processing row uses cream background; selected row uses cool-gray", () => {
    const selectedMarkup = renderToStaticMarkup(
      <WorkbenchSpecTree {...makeProps({ activeNodeId: "n-pending" })} />
    );
    // processing node always cream
    expect(selectedMarkup).toContain("bg-[#FAF7F2]");
    // selected node cool-gray
    expect(selectedMarkup).toContain("bg-[#F0F4F8]");
  });

  it("cool-gray selection overrides cream when the processing node is also selected", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchSpecTree {...makeProps({ activeNodeId: "n-processing" })} />
    );
    // The processing+selected node must render cool-gray. Since no other node
    // is processing in this fixture, cream must be absent entirely.
    expect(markup).toContain("bg-[#F0F4F8]");
    expect(markup).not.toContain("bg-[#FAF7F2]");
  });

  it("doc-count subtitle appears only when the node has generated documents", () => {
    const withDocs = renderToStaticMarkup(
      <WorkbenchSpecTree
        {...makeProps({
          specDocuments: [
            makeDoc("n-completed", "requirements"),
            makeDoc("n-completed", "design"),
          ],
        })}
      />
    );
    expect(withDocs).toContain(
      'data-testid="autopilot-workbench-spec-tree-doc-count-n-completed"'
    );
    expect(withDocs).toContain("修订");
    // pending node has no docs → no subtitle for it
    expect(withDocs).not.toContain(
      'data-testid="autopilot-workbench-spec-tree-doc-count-n-pending"'
    );
  });

  it("node-count header equals specTree.nodes.length", () => {
    const markup = renderToStaticMarkup(<WorkbenchSpecTree {...makeProps()} />);
    expect(markup).toContain('data-testid="autopilot-workbench-spec-tree-node-count"');
    expect(markup).toContain("节点 · 5");
  });

  it("falls back to pending when nodeStatusById omits a node", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchSpecTree {...makeProps({ nodeStatusById: {} })} />
    );
    // Every row still renders a status icon, all pending.
    for (const node of NODES) {
      expect(markup).toContain(
        `data-testid="autopilot-workbench-spec-tree-status-${node.id}"`
      );
    }
    // No completed/processing/failed when map is empty.
    expect(markup).not.toContain('data-status="processing"');
    expect(markup).not.toContain('data-status="completed"');
    expect(markup).not.toContain('data-status="failed"');
  });

  it("PBT: status icon count always equals node count regardless of status mix", () => {
    const arbStatus = fc.constantFrom(
      "pending",
      "processing",
      "completed",
      "failed"
    );
    fc.assert(
      fc.property(
        fc.array(arbStatus, { minLength: 5, maxLength: 5 }),
        fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        (statuses, retriedFlags) => {
          const map: Record<
            string,
            { status: "pending" | "processing" | "completed" | "failed"; wasRetried?: boolean }
          > = {};
          NODES.forEach((node, i) => {
            map[node.id] = {
              status: statuses[i] as
                | "pending"
                | "processing"
                | "completed"
                | "failed",
              ...(retriedFlags[i] ? { wasRetried: true } : {}),
            };
          });
          const markup = renderToStaticMarkup(
            <WorkbenchSpecTree {...makeProps({ nodeStatusById: map })} />
          );
          const statusIconCount = (
            markup.match(/autopilot-workbench-spec-tree-status-/g) ?? []
          ).length;
          expect(statusIconCount).toBe(NODES.length);
        }
      ),
      { numRuns: 50 }
    );
  });
});
