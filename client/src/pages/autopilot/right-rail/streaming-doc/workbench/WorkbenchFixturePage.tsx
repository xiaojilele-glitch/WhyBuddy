import type { FC } from "react";
import { useMemo } from "react";

import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type {
  BlueprintGenerationArtifact,
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";

import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import { AutopilotSpecDocumentsWorkbench } from "./AutopilotSpecDocumentsWorkbench";
import { deriveNodeStatusById } from "../../spec-docs-progress/derive-node-status-by-id";

const JOB_ID = "debug-spec-docs-workbench";
const TREE_ID = "debug-spec-docs-tree";
const CREATED_AT = "2026-05-20T07:00:00.000Z";

const FIXTURE_NODES: BlueprintSpecTreeNode[] = [
  {
    id: "node-route-authoring",
    title: "Workbench Route Authoring",
    summary: "The main review surface for SPEC document generation.",
    type: "route_step",
    status: "ready",
    priority: 1,
    dependencies: [],
    outputs: ["requirements", "design", "tasks"],
    children: ["node-canvas-state", "node-execution-rail"],
  },
  {
    id: "node-canvas-state",
    parentId: "node-route-authoring",
    title: "Canvas State Sync",
    summary: "Keep selected nodes, active documents, and review status aligned.",
    type: "route_step",
    status: "ready",
    priority: 2,
    dependencies: ["node-route-authoring"],
    outputs: ["active-doc", "scroll-cache"],
    children: [],
  },
  {
    id: "node-execution-rail",
    parentId: "node-route-authoring",
    title: "Execution Rail Feedback",
    summary: "Show artifacts and reasoning beside the working document.",
    type: "route_step",
    status: "draft",
    priority: 3,
    dependencies: ["node-route-authoring"],
    outputs: ["artifact-cards", "reasoning-cards"],
    children: [],
  },
];

const FIXTURE_SPEC_TREE: BlueprintSpecTree = {
  id: TREE_ID,
  routeSetId: "debug-route-set",
  selectionId: "debug-selection",
  selectedRouteId: "debug-route",
  rootNodeId: "node-route-authoring",
  version: 3,
  status: "reviewing",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  alternativeRouteIds: [],
  nodes: FIXTURE_NODES,
  provenance: {
    jobId: JOB_ID,
    routeSetId: "debug-route-set",
    routeId: "debug-route",
    selectionId: "debug-selection",
    specTreeId: TREE_ID,
    targetText: "Workbench Route Authoring",
    githubUrls: [],
    generationSource: "template",
    promptId: "debug.autopilot-spec-documents-workbench.fixture",
  },
};

function makeDoc(
  node: BlueprintSpecTreeNode,
  type: BlueprintSpecDocumentType,
  status: BlueprintSpecDocument["status"],
  title: string,
  summary: string,
  content: string
): BlueprintSpecDocument {
  return {
    id: `${node.id}-${type}`,
    jobId: JOB_ID,
    treeId: TREE_ID,
    nodeId: node.id,
    type,
    status,
    version: 1,
    title,
    summary,
    content,
    format: "markdown",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    provenance: {
      jobId: JOB_ID,
      targetText: "Workbench Route Authoring",
      githubUrls: [],
      treeVersion: FIXTURE_SPEC_TREE.version,
      nodeType: node.type,
      nodeTitle: node.title,
      nodeSummary: node.summary,
      dependencies: node.dependencies,
      outputs: node.outputs,
      generationSource: "template",
      promptId: "debug.autopilot-spec-documents-workbench.fixture",
    },
  };
}

const FIXTURE_SPEC_DOCUMENTS: BlueprintSpecDocument[] = [
  makeDoc(
    FIXTURE_NODES[0],
    "requirements",
    "accepted",
    "Route Authoring Requirements",
    "Acceptance criteria for the direct workbench route and review loop.",
    [
      "# Route Authoring Requirements",
      "",
      "## Direct Access",
      "The workbench can be opened without replaying the full autopilot flow.",
      "",
      "## Review Loop",
      "Generated documents keep a stable active selection, visible status metrics, and a clear refresh action.",
      "",
      "## Validation",
      "The page carries artifact and reasoning samples so layout regressions show up in the local fixture.",
    ].join("\n")
  ),
  makeDoc(
    FIXTURE_NODES[0],
    "design",
    "accepted",
    "Route Authoring Design",
    "Layout and interaction notes for the review workbench.",
    "# Route Authoring Design\n\n## Regions\nStatus, tree, document, and execution feedback stay visible together.\n\n## Density\nControls use compact slate styling and one-pixel borders."
  ),
  makeDoc(
    FIXTURE_NODES[0],
    "tasks",
    "accepted",
    "Route Authoring Tasks",
    "Task breakdown for the workbench review surface.",
    "# Route Authoring Tasks\n\n- [x] Add direct fixture route\n- [x] Show generated target metrics\n- [ ] Verify visual density against the reference rail"
  ),
  makeDoc(
    FIXTURE_NODES[1],
    "requirements",
    "accepted",
    "Canvas State Sync Requirements",
    "State synchronization requirements for selected nodes and documents.",
    "# Canvas State Sync Requirements\n\n## Selection\nDocument and node selection must remain stable as data streams in."
  ),
  makeDoc(
    FIXTURE_NODES[1],
    "design",
    "reviewing",
    "Canvas State Sync Design",
    "Design notes for scroll cache and active document transitions.",
    "# Canvas State Sync Design\n\n## Scroll Memory\nEach document keeps its last known scroll position while the user compares related documents."
  ),
  makeDoc(
    FIXTURE_NODES[1],
    "tasks",
    "draft",
    "Canvas State Sync Tasks",
    "Implementation tasks for state synchronization.",
    "# Canvas State Sync Tasks\n\n- [x] Keep active document deterministic\n- [ ] Add selection transition tests"
  ),
  makeDoc(
    FIXTURE_NODES[2],
    "requirements",
    "reviewing",
    "Execution Rail Feedback Requirements",
    "Requirements for artifact and reasoning card feedback.",
    "# Execution Rail Feedback Requirements\n\n## Artifact Feedback\nSpec document artifacts should sit beside the latest reasoning entries."
  ),
];

const FIXTURE_ARTIFACTS: BlueprintGenerationArtifact[] = [
  {
    id: "artifact-route-requirements",
    type: "requirements",
    title: "Route requirements generated",
    summary: "Requirements document created for the root route node.",
    createdAt: CREATED_AT,
  },
  {
    id: "artifact-canvas-design",
    type: "design",
    title: "Canvas design generated",
    summary: "Design document created for the canvas sync node.",
    createdAt: CREATED_AT,
  },
  {
    id: "artifact-canvas-tasks",
    type: "tasks",
    title: "Canvas tasks drafted",
    summary: "Tasks document generated and waiting for review.",
    createdAt: CREATED_AT,
  },
];

const FIXTURE_REASONING_ENTRIES: AgentReasoningEntry[] = [
  {
    id: "debug-reasoning-1",
    jobId: JOB_ID,
    iteration: 1,
    iterationLabel: "#1",
    phase: "thinking",
    stageId: "spec_docs",
    timestamp: "2026-05-20T07:01:00.000Z",
    thought:
      "Inspect the SPEC tree and choose the root route node as the first active document group.",
  },
  {
    id: "debug-reasoning-2",
    jobId: JOB_ID,
    iteration: 1,
    iterationLabel: "#1",
    phase: "observing",
    stageId: "spec_docs",
    timestamp: "2026-05-20T07:02:00.000Z",
    observationSuccess: true,
    observationSummary:
      "Generated requirements, design, and tasks for Workbench Route Authoring.",
  },
  {
    id: "debug-reasoning-3",
    jobId: JOB_ID,
    iteration: 1,
    iterationLabel: "#1",
    phase: "completed",
    stageId: "spec_docs",
    timestamp: "2026-05-20T07:03:00.000Z",
    reason: "Fixture ready for direct workbench inspection.",
  },
];

const FIXTURE_JOB = {
  id: JOB_ID,
  title: "Workbench Route Authoring",
  summary: "SPEC documents direct inspection fixture",
  request: {
    targetText: "Workbench Route Authoring",
    mode: "spec-documents-workbench",
    domainContext: {
      projectName: "WhyBuddy",
    },
  },
  status: "reviewing",
  stage: "spec_docs",
  version: "debug",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  artifacts: FIXTURE_ARTIFACTS,
  events: [],
} as unknown as BlueprintGenerationJob;

export const AutopilotSpecDocumentsWorkbenchFixturePage: FC = () => {
  // whybuddy-spec-tree-progress-merge-2026-05-29 §6 (dev-only fixture)：
  // 把 store 的 specDocsProgress.nodes 派生成 nodeStatusById 透传给 workbench，
  // 让 e2e 通过 window.__blueprintRealtimeStore.dispatchEvent 驱动节点行状态变化。
  // 与 AutopilotRightRail 的双源合并一致：persisted specDocuments → baseline
  // completed；live progress overlays（assembled→completed 收敛）。
  const specDocsNodes = useBlueprintRealtimeStore(
    (state) => state.specDocsProgress.nodes
  );
  const specDocsBatchStatus = useBlueprintRealtimeStore(
    (state) => state.specDocsProgress.batchStatus
  );
  const nodeStatusById = useMemo(
    () =>
      deriveNodeStatusById({
        persistedSpecDocuments: FIXTURE_SPEC_DOCUMENTS,
        liveProgressNodes: specDocsNodes,
        liveBatchStatus: specDocsBatchStatus,
      }),
    [specDocsNodes, specDocsBatchStatus]
  );

  return (
    <main
      data-testid="autopilot-spec-documents-workbench-fixture"
      className="min-h-screen bg-slate-100 p-4 text-slate-950"
    >
      <div className="mx-auto h-[calc(100vh-32px)] min-h-[720px] max-w-[1120px]">
        <AutopilotSpecDocumentsWorkbench
          entries={FIXTURE_REASONING_ENTRIES}
          specDocuments={FIXTURE_SPEC_DOCUMENTS}
          specTree={FIXTURE_SPEC_TREE}
          locale="zh-CN"
          onGenerateAll={() => {}}
          onGenerateNode={() => {}}
          generating={null}
          jobId={JOB_ID}
          job={FIXTURE_JOB}
          nodeStatusById={nodeStatusById}
        />
      </div>
    </main>
  );
};

export default AutopilotSpecDocumentsWorkbenchFixturePage;
