/**
 * WhyBuddy V5.1 — runtime session → mature 2D reasoning map projection.
 * Pure read-side transform (DERIVE projection); does not write back to STATE.
 */

import type {
  BrainstormReasoningEdge,
  BrainstormReasoningNode,
  BrainstormReasoningNodeStatus,
} from "./brainstorm-reasoning-graph.js";
import type { V5CapabilityId } from "./contracts.js";
import type { Artifact, V5SessionState } from "./v5-reasoning-state.js";

const ROLE_DISPLAY: Record<string, string> = {
  产品: "澄清者",
  架构: "架构师",
  安全: "安全官",
  工程: "工程师",
  挑刺: "挑刺者",
  综合: "综合器",
  接地: "接地者",
  规划: "规划师",
  agent: "推演者",
};

const CAP_TO_NODE_TYPE: Partial<Record<V5CapabilityId, BrainstormReasoningNode["type"]>> = {
  "intent.parse": "clarification",
  "intent.clarify": "clarification",
  "context.collect": "clarification",
  "gap.ask": "gap",
  "question.expand": "hypothesis",
  "assumption.validate": "hypothesis",
  "route.generate": "hypothesis",
  "route.compare": "hypothesis",
  "tradeoff.evaluate": "hypothesis",
  "evidence.search": "evidence",
  "repo.inspect": "evidence",
  "mcp.call": "evidence",
  "skill.invoke": "evidence",
  "risk.analyze": "risk",
  "counter.argue": "risk",
  "critique.generate": "risk",
  "synthesis.merge": "synthesis",
  "report.write": "decision",
  "structure.decompose": "clarification",
  "scenario.simulate": "evidence",
  "document.draft": "decision",
};

export function roleIdToDisplayLabel(roleId?: string): string {
  if (!roleId) return "推演者";
  return ROLE_DISPLAY[roleId] ?? roleId;
}

export function capabilityIdToReasoningNodeType(
  capabilityId?: string
): BrainstormReasoningNode["type"] {
  if (!capabilityId) return "hypothesis";
  return (CAP_TO_NODE_TYPE as Record<string, BrainstormReasoningNode["type"]>)[capabilityId] ?? "hypothesis";
}

export function extractNodeTitleFromArtifact(art: Artifact, capabilityId?: string): string {
  const fromTitle = art.title?.trim();
  if (fromTitle && !fromTitle.includes(" · ")) return fromTitle;
  const firstLine = (art.content || "")
    .split("\n")
    .map((l) => l.replace(/^【[^】]+】\s*/, "").trim())
    .find((l) => l.length > 8);
  if (firstLine) return firstLine.slice(0, 96);
  if (capabilityId) {
    const short = capabilityId.split(".").pop() || capabilityId;
    return `${short} 推演结论`;
  }
  return art.id;
}

export function extractNodeBodyFromArtifact(art: Artifact): string {
  const summary = art.summary?.trim();
  if (summary && summary.length > 12) return summary.slice(0, 180);
  const content = (art.content || "").replace(/\s+/g, " ").trim();
  if (content.length > 20) return content.slice(0, 180);
  return "";
}

function splitPropositionClauses(text: string): string[] {
  const trimmed = text.trim();
  const parts = trimmed
    .split(/[，,；;？?。]|(?:\s+and\s+)|(?:\s+or\s+)|(?:并|以及|同时|还要|并且|而且|另外)/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
  if (parts.length >= 2) return parts.slice(0, 3);
  if (trimmed.length > 28) {
    const mid = Math.floor(trimmed.length / 2);
    const breakAt = trimmed.indexOf(" ", mid);
    if (breakAt > 10) {
      return [trimmed.slice(0, breakAt).trim(), trimmed.slice(breakAt).trim()];
    }
  }
  return [trimmed];
}

/** Map capability → scaffold slot suffix for branch attachment. */
export const SCAFFOLD_SLOT_BY_CAPABILITY: Partial<Record<V5CapabilityId, string>> = {
  "intent.parse": "clarify",
  "intent.clarify": "clarify",
  "context.collect": "clarify",
  "structure.decompose": "clarify",
  "gap.ask": "gap",
  "question.expand": "hypo",
  "assumption.validate": "hypo",
  "route.generate": "hypo",
  "route.compare": "hypo",
  "tradeoff.evaluate": "hypo",
  "evidence.search": "evidence",
  "repo.inspect": "evidence",
  "mcp.call": "evidence",
  "skill.invoke": "evidence",
  "scenario.simulate": "evidence",
  "risk.analyze": "risk",
  "counter.argue": "risk",
  "critique.generate": "risk",
  "synthesis.merge": "synthesis",
  "report.write": "synthesis",
  "document.draft": "synthesis",
};

export function scaffoldSlotForCapability(capabilityId?: string): string | undefined {
  if (!capabilityId) return undefined;
  return SCAFFOLD_SLOT_BY_CAPABILITY[capabilityId as V5CapabilityId];
}

/** Latest open scaffold placeholder (no committed artifact yet) for a slot suffix. */
const SCAFFOLD_SLOT_ID =
  /-scaffold-(clarify|hypo-alt|hypo|evidence|risk|gap|synthesis|scope)$/;

export function isScaffoldPlaceholderNodeId(nodeId: string): boolean {
  return SCAFFOLD_SLOT_ID.test(nodeId);
}

export function findOpenScaffoldSlotId(
  state: V5SessionState,
  slotSuffix: string
): string | undefined {
  const open = (state.graph.nodes || []).filter(
    (n) =>
      String(n.id).endsWith(`-scaffold-${slotSuffix}`) &&
      !(n as { producedArtifactId?: string }).producedArtifactId
  );
  return open[open.length - 1]?.id;
}

/**
 * ORCH 选定 route.generate / route.compare 时按需创建路线分叉位（非 INTAKE 预置）。
 */
export function ensureRouteBranchScaffold(
  state: V5SessionState,
  turnId: string,
  rootId: string,
  capabilityId: string
): V5SessionState {
  if (capabilityId !== "route.generate" && capabilityId !== "route.compare") {
    return state;
  }
  const suffix = capabilityId === "route.compare" ? "hypo-alt" : "hypo";
  const slotId = `${turnId}-scaffold-${suffix}`;
  if ((state.graph.nodes || []).some((n) => n.id === slotId)) {
    return state;
  }
  const branchLabel =
    capabilityId === "route.generate" ? "路线 A" : "路线 B · 备选";
  const node = {
    id: slotId,
    type: "hypothesis" as const,
    title: `${branchLabel} · 待推演挂接`,
    body: `DLEDGER 选定 ${capabilityId} 后创建的分支位。`,
    status: "open" as const,
    roleId: capabilityId === "route.compare" ? "挑刺" : "产品",
    roleLabel: capabilityId === "route.compare" ? "挑刺者" : "规划师",
    order: 1,
    round: 1,
    turnId,
  } as BrainstormReasoningNode;
  const edge: BrainstormReasoningEdge = {
    id: `${turnId}-scaffold-e-${suffix}`,
    source: rootId,
    target: slotId,
    type: "depends_on",
    label: capabilityId === "route.compare" ? "备选" : "拆解",
  };
  return {
    ...state,
    graph: {
      ...state.graph,
      nodes: [...(state.graph.nodes || []), node],
      edges: [...(state.graph.edges || []), edge],
    },
  };
}

/** @deprecated INTAKE 不再预置管道占位；仅测试/迁移保留。 */
export function scaffoldPropositionBranches(
  state: V5SessionState,
  userText: string,
  turnId: string,
  rootId: string
): { nodes: BrainstormReasoningNode[]; edges: BrainstormReasoningEdge[] } {
  const clauses = splitPropositionClauses(userText.trim());
  const nodes: BrainstormReasoningNode[] = [];
  const edges: BrainstormReasoningEdge[] = [];

  const clarifyId = `${turnId}-scaffold-clarify`;
  nodes.push({
    id: clarifyId,
    type: "clarification",
    title: clauses.length > 1 ? `需先澄清：${clauses[0].slice(0, 72)}` : "需先澄清目标边界与成功标准",
    body: "从用户命题拆出的首个澄清子问题，驱动后续证据与风险推演。",
    status: "open",
    roleId: "产品",
    roleLabel: "澄清者",
    order: 1,
    round: 1,
    turnId,
  } as BrainstormReasoningNode);
  edges.push({
    id: `${turnId}-scaffold-e1`,
    source: rootId,
    target: clarifyId,
    type: "depends_on",
    label: "提出",
  });

  const hypoId = `${turnId}-scaffold-hypo`;
  const hypoText =
    clauses.length > 1
      ? `可沿「${clauses[1].slice(0, 56)}」路径展开推演`
      : "可按标准路径：澄清 → 证据 → 风险 → 收敛";
  nodes.push({
    id: hypoId,
    type: "hypothesis",
    title: `路线 A · ${hypoText}`,
    body: "待验证的主推演假设，route.generate 产出后在此挂接具体路线。",
    status: "active",
    roleId: "产品",
    roleLabel: "规划师",
    order: 2,
    round: 1,
    turnId,
  } as BrainstormReasoningNode);
  edges.push({
    id: `${turnId}-scaffold-e2`,
    source: rootId,
    target: hypoId,
    type: "depends_on",
    label: "拆解",
  });

  // V5.1 RouteSet: 主路径 (hypo) + 备选路径 (hypo-alt) 始终并行分叉，供 C_RTGEN / C_RTCMP 挂接。
  const altHypoId = `${turnId}-scaffold-hypo-alt`;
  nodes.push({
    id: altHypoId,
    type: "hypothesis",
    title:
      clauses.length > 1
        ? `路线 B · 备选：${clauses[Math.min(1, clauses.length - 1)].slice(0, 56)}`
        : "路线 B · 并行假设：从反面验证命题是否成立",
    body: "与主假设并行的反证/对照路径，route.compare 产出后在此收敛对比。",
    status: "active",
    roleId: "挑刺",
    roleLabel: "挑刺者",
    order: clauses.length > 2 ? 4 : 3,
    round: 1,
    turnId,
  } as BrainstormReasoningNode);
  edges.push({
    id: `${turnId}-scaffold-e-alt-hypo`,
    source: rootId,
    target: altHypoId,
    type: "depends_on",
    label: "备选",
  });

  if (clauses.length > 2) {
    const scopeId = `${turnId}-scaffold-scope`;
    nodes.push({
      id: scopeId,
      type: "hypothesis",
      title: `并行关注：${clauses[2].slice(0, 72)}`,
      body: "用户命题的第三语义切片，可作为路线对比或结构拆解入口。",
      status: "active",
      roleId: "架构",
      roleLabel: "架构师",
      order: 3,
      round: 1,
      turnId,
    } as BrainstormReasoningNode);
    edges.push({
      id: `${turnId}-scaffold-e3`,
      source: rootId,
      target: scopeId,
      type: "depends_on",
      label: "来源",
    });
  }

  // V5.1 推演管道占位：首条消息后画布即呈现「澄清→证据→风险→收敛」骨架，而非仅 3 个意图节点。
  const pipeline: Array<{
    suffix: string;
    type: BrainstormReasoningNode["type"];
    title: string;
    body: string;
    roleId: string;
    roleLabel: string;
    from: string;
    label: string;
    order: number;
  }> = [
    {
      suffix: "evidence",
      type: "evidence",
      title: "待检索：外部证据与约束来源",
      body: "evidence.search / repo.inspect 成功后将在此挂接可引用的洞察节点。",
      roleId: "接地",
      roleLabel: "接地者",
      from: rootId,
      label: "来源",
      order: 10,
    },
    {
      suffix: "risk",
      type: "risk",
      title: "待扫描：风险与反证",
      body: "risk.analyze / counter.argue 产出后将替换本占位为可质疑的风险结论。",
      roleId: "安全",
      roleLabel: "安全官",
      from: rootId,
      label: "验证",
      order: 11,
    },
    {
      suffix: "gap",
      type: "gap",
      title: "待识别：阻塞性信息缺口",
      body: "gap.ask / intent.clarify 若发现阻塞，将在此标出需你回答的问题。",
      roleId: "产品",
      roleLabel: "澄清者",
      from: rootId,
      label: "提出",
      order: 12,
    },
    {
      suffix: "synthesis",
      type: "synthesis",
      title: "待收敛：综合结论与可行性判断",
      body: "synthesis.merge / report.write 通过覆盖率闸后，本节点升级为可信任的收敛结论。",
      roleId: "综合",
      roleLabel: "综合器",
      from: rootId,
      label: "收敛",
      order: 13,
    },
  ];

  for (const slot of pipeline) {
    const slotId = `${turnId}-scaffold-${slot.suffix}`;
    nodes.push({
      id: slotId,
      type: slot.type,
      title: slot.title,
      body: slot.body,
      status: "open",
      roleId: slot.roleId,
      roleLabel: slot.roleLabel,
      order: slot.order,
      round: 1,
      turnId,
    } as BrainstormReasoningNode);
    edges.push({
      id: `${turnId}-scaffold-e-${slot.suffix}`,
      source: slot.from,
      target: slotId,
      type: "depends_on",
      label: slot.label,
    });
  }

  return { nodes, edges };
}

function semanticEdgeLabel(
  source: BrainstormReasoningNode,
  target: BrainstormReasoningNode
): string {
  if (source.type === "question") {
    if (target.type === "clarification" || target.type === "gap") return "提出";
    if (target.type === "evidence") return "来源";
    if (target.type === "hypothesis") return "拆解";
    return "推演";
  }
  if (target.type === "evidence") return "支撑";
  if (target.type === "risk") return "验证";
  if (target.type === "synthesis") return "收敛";
  if (target.type === "decision") {
    if (source.type === "synthesis") return "收敛";
    if (source.type === "hypothesis") return "影响";
    if (source.type === "evidence") return "支撑";
    return "收敛";
  }
  if (target.type === "hypothesis") return "拆解";
  if (target.type === "gap") return "权衡";
  if (target.capabilityId === "counter.argue") return "反证";
  return "推演";
}

function semanticEdgeType(label: string): BrainstormReasoningEdge["type"] {
  if (label === "提出") return "questions";
  if (label === "拆解") return "refines";
  if (label === "来源") return "cites";
  if (label === "支撑" || label === "验证") return "supports";
  if (label === "收敛") return "synthesizes";
  if (label === "反证" || label === "权衡") return "conflicts";
  if (label === "影响") return "supports";
  return "depends_on";
}

function enrichNodeFromArtifact(
  node: BrainstormReasoningNode & {
    capabilityId?: string;
    producedArtifactId?: string;
    capabilityRunId?: string;
  },
  artifacts: Artifact[],
  stale: Set<string>
): BrainstormReasoningNode {
  const isRoot =
    node.type === "question" && String(node.id).endsWith("-proposition");
  if (isRoot) {
    return { ...node, roleLabel: "用户命题" };
  }

  const art =
    (node.producedArtifactId
      ? artifacts.find((a) => a.id === node.producedArtifactId)
      : undefined) ||
    artifacts.find((a) => a.producedBy?.capabilityRunId === node.capabilityRunId);

  const capId = node.capabilityId || art?.producedBy?.capabilityId;
  const nodeType = isScaffoldPlaceholderNodeId(String(node.id))
    ? node.type
    : capabilityIdToReasoningNodeType(capId);

  let status: BrainstormReasoningNodeStatus = node.status ?? "active";
  if (art) {
    if (stale.has(art.id) || art.trustLevel === "untrusted") status = "challenged";
    else if (art.trustLevel === "gated_pass" || art.trustLevel === "audited")
      status = "resolved";
    else status = "active";
  }

  const title = art
    ? extractNodeTitleFromArtifact(art, capId)
    : node.title?.includes(" · ")
    ? node.title.split(" · ").slice(1).join(" · ")
    : node.title;
  const body = art ? extractNodeBodyFromArtifact(art) : node.body;

  return {
    ...node,
    type: nodeType,
    title: title || node.title,
    body: body || node.body,
    roleLabel: roleIdToDisplayLabel(node.roleId || art?.producedBy?.roleId),
    status,
    capabilityId: capId,
  };
}

/** Project persisted graph + artifacts into a dense reasoning map for 2D surface. */
export function projectSessionGraphForDisplay(
  state: V5SessionState,
  rootId?: string
): { nodes: BrainstormReasoningNode[]; edges: BrainstormReasoningEdge[] } {
  const stale = new Set(state.staleArtifactIds || []);
  const artifacts = state.artifacts || [];
  const rawNodes = state.graph?.nodes || [];
  const rawEdges = state.graph?.edges || [];

  const nodes = rawNodes.map((n) =>
    enrichNodeFromArtifact(n as any, artifacts, stale)
  );

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: BrainstormReasoningEdge[] = rawEdges.map((e) => {
    const src = nodeById.get(e.source);
    const tgt = nodeById.get(e.target);
    const label =
      e.label && e.label !== "推演" && e.label !== "命题支撑"
        ? e.label
        : src && tgt
        ? semanticEdgeLabel(src, tgt)
        : e.label || "推演";
    return {
      ...e,
      label,
      type: semanticEdgeType(label),
    };
  });

  // Bridge edges from artifact upstream refs (evidence → risk → synthesis chain).
  for (const art of artifacts) {
    const targetNode = nodes.find((n) => (n as any).producedArtifactId === art.id);
    if (!targetNode) continue;
    for (const refId of art.evidenceRefs || []) {
      const sourceNode = nodes.find((n) => (n as any).producedArtifactId === refId);
      if (!sourceNode || sourceNode.id === targetNode.id) continue;
      const edgeId = `proj-${sourceNode.id}-${targetNode.id}`;
      if (edges.some((e) => e.id === edgeId)) continue;
      const label = semanticEdgeLabel(sourceNode, targetNode);
      edges.push({
        id: edgeId,
        source: sourceNode.id,
        target: targetNode.id,
        type: semanticEdgeType(label),
        label,
      });
    }
  }

  // Fan evidence nodes from root when they only have structural parent edges.
  if (rootId) {
    const root = nodeById.get(rootId);
    if (root) {
      for (const n of nodes) {
        if (n.id === rootId) continue;
        if (n.type !== "evidence") continue;
        const hasIncoming = edges.some((e) => e.target === n.id);
        if (!hasIncoming) {
          edges.push({
            id: `proj-root-${n.id}`,
            source: rootId,
            target: n.id,
            type: "cites",
            label: "来源",
          });
        }
      }
    }
  }

  return { nodes, edges };
}

export function enrichGraphNodeFromArtifact(
  node: BrainstormReasoningNode & {
    capabilityId?: string;
    producedArtifactId?: string;
    capabilityRunId?: string;
  },
  artifact: Artifact
): BrainstormReasoningNode {
  const capId = node.capabilityId || artifact.producedBy?.capabilityId;
  return {
    ...node,
    type: capabilityIdToReasoningNodeType(capId),
    title: extractNodeTitleFromArtifact(artifact, capId),
    body: extractNodeBodyFromArtifact(artifact) || node.body,
    roleLabel: roleIdToDisplayLabel(node.roleId || artifact.producedBy?.roleId),
    producedArtifactId: artifact.id,
    producedRunId: node.capabilityRunId,
  };
}