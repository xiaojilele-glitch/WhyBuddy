/**
 * BrainstormWallGraph — dagre 布局 + Canvas2D 绘制多智能体协作思维导图纹理。
 *
 * 与 BlueprintWallTexture 遵循同一模式：
 * 1. dagre 纯 JS 计算节点坐标（LR 方向）
 * 2. Canvas2D 绘制节点卡片（type→color）和贝塞尔虚线连线
 * 3. Three.js CanvasTexture 贴到墙面 mesh 上
 * 4. 新节点 fade-in 动画（300ms opacity 0→1）
 *
 * @see .kiro/specs/autopilot-multi-agent-brainstorm/design.md §8
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import { useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import type { BranchNode, BranchEdge } from "@/lib/brainstorm-graph-store";
import type { BrainstormSessionStatus } from "@/lib/brainstorm-graph-store";
import { useBrainstormGraphStore } from "@/lib/brainstorm-graph-store";

import {
  BLUEPRINT_WALL_GRAPH_POSITION,
  BLUEPRINT_WALL_GRAPH_BACKING_WIDTH,
  BLUEPRINT_WALL_GRAPH_BACKING_HEIGHT,
} from "./blueprint-wall-placement";

import {
  CANVAS_W,
  CANVAS_H,
  BRAINSTORM_NODE_W,
  BRAINSTORM_NODE_H,
  BRAINSTORM_PADDING,
  computeAdaptiveScale,
  drawBrainstormGraph,
} from "./brainstorm-wall-graph-logic";
import type {
  BrainstormDeliberationOverlay,
  LayoutNode,
  LayoutEdge,
  LayoutResult,
} from "./brainstorm-wall-graph-logic";

const BRAINSTORM_WALL_GRAPH_POSITION: [number, number, number] = [
  BLUEPRINT_WALL_GRAPH_POSITION[0],
  BLUEPRINT_WALL_GRAPH_POSITION[1],
  BLUEPRINT_WALL_GRAPH_POSITION[2] + 0.018,
];

// Re-export from logic module for backward compatibility
export {
  truncateTitle,
  computeAdaptiveScale,
  BRAINSTORM_NODE_COLORS,
  BRAINSTORM_NODE_W,
  BRAINSTORM_NODE_H,
  BRAINSTORM_PADDING,
  MAX_TITLE_LENGTH,
  CANVAS_W,
  CANVAS_H,
  drawBrainstormGraph,
} from "./brainstorm-wall-graph-logic";
export type { LayoutNode, LayoutEdge, LayoutResult } from "./brainstorm-wall-graph-logic";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BrainstormWallGraphProps {
  nodes: BranchNode[];
  edges: BranchEdge[];
  sessionStatus: BrainstormSessionStatus;
  deliberation?: BrainstormDeliberationOverlay;
}

// ---------------------------------------------------------------------------
// dagre Layout Computation
// ---------------------------------------------------------------------------

export function computeBrainstormLayout(
  nodes: BranchNode[],
  edges: BranchEdge[],
  canvasWidth: number = CANVAS_W,
  canvasHeight: number = CANVAS_H
): LayoutResult | null {
  if (nodes.length === 0) return null;

  const roleOrder: Array<BranchNode["roleId"]> = [
    "decider",
    "planner",
    "architect",
    "executor",
    "auditor",
    "ui_previewer",
  ];
  const roleIndex = (roleId: BranchNode["roleId"]): number => {
    const idx = roleOrder.indexOf(roleId);
    return idx >= 0 ? idx : roleOrder.length;
  };

  // A `role:<id>` anchor node (from runtime-graph decision/edge events) is
  // redundant once that role has a real content claim. Drop the bare anchor so
  // we never render a duplicate card; keep it only for roles with no claim yet.
  const rolesWithClaims = new Set<BranchNode["roleId"]>(
    nodes
      .filter(
        (node) =>
          node.id !== `role:${node.roleId}` &&
          typeof node.content === "string" &&
          node.content.trim().length > 0,
      )
      .map((node) => node.roleId),
  );
  const visibleNodes = nodes.filter(
    (node) => !(node.id === `role:${node.roleId}` && rolesWithClaims.has(node.roleId)),
  );
  if (visibleNodes.length === 0) return null;

  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));

  // First parent per node (parent-child sequence edges), restricted to the
  // visible set so dropped anchors don't anchor a layer.
  const parentOf = new Map<string, string>();
  for (const edge of edges) {
    if (
      nodeById.has(edge.sourceNodeId) &&
      nodeById.has(edge.targetNodeId) &&
      !parentOf.has(edge.targetNodeId)
    ) {
      parentOf.set(edge.targetNodeId, edge.sourceNodeId);
    }
  }
  // Fall back to the persisted parentNodeId when no explicit edge exists.
  for (const node of visibleNodes) {
    if (!parentOf.has(node.id) && node.parentNodeId && nodeById.has(node.parentNodeId)) {
      parentOf.set(node.id, node.parentNodeId);
    }
  }

  // Longest-path layer assignment from roots (中心议题 → 主张 → 质疑 → 收敛).
  // Cycle-guarded so malformed graphs never recurse forever (never-throw).
  const layerCache = new Map<string, number>();
  const visiting = new Set<string>();
  const layerOf = (id: string): number => {
    const cached = layerCache.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parent = parentOf.get(id);
    const layer = parent && nodeById.has(parent) ? layerOf(parent) + 1 : 0;
    visiting.delete(id);
    layerCache.set(id, layer);
    return layer;
  };

  let maxBaseLayer = 0;
  for (const node of visibleNodes) {
    maxBaseLayer = Math.max(maxBaseLayer, layerOf(node.id));
  }
  const hasSynthesis = visibleNodes.some((node) => node.type === "synthesis");
  const finalLayer = hasSynthesis ? maxBaseLayer + 1 : maxBaseLayer;
  const layerByNode = new Map<string, number>();
  for (const node of visibleNodes) {
    layerByNode.set(
      node.id,
      node.type === "synthesis" ? finalLayer : layerOf(node.id),
    );
  }

  // Group nodes per layer (column) and order within a column by role then seq.
  const byLayer = new Map<number, BranchNode[]>();
  for (const node of visibleNodes) {
    const layer = layerByNode.get(node.id)!;
    const bucket = byLayer.get(layer);
    if (bucket) bucket.push(node);
    else byLayer.set(layer, [node]);
  }

  const columnCount = finalLayer + 1;
  const left = BRAINSTORM_PADDING + BRAINSTORM_NODE_W / 2;
  const top = BRAINSTORM_PADDING + BRAINSTORM_NODE_H / 2;
  const bottom = canvasHeight - BRAINSTORM_PADDING - BRAINSTORM_NODE_H / 2;
  const colStep = Math.max(
    BRAINSTORM_NODE_W + 240,
    (canvasWidth - BRAINSTORM_PADDING * 2 - BRAINSTORM_NODE_W) /
      Math.max(1, columnCount - 1),
  );

  const renderedNodes: LayoutNode[] = [];
  for (const [layer, group] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    group.sort(
      (a, b) =>
        roleIndex(a.roleId) - roleIndex(b.roleId) ||
        (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
    );
    const x = left + layer * colStep;
    const count = group.length;
    group.forEach((node, index) => {
      const y =
        count === 1
          ? canvasHeight / 2
          : top + (bottom - top) * (index / (count - 1));
      renderedNodes.push({
        id: node.id,
        x,
        y,
        title: node.title,
        type: node.type,
        status: node.status,
        roleId: node.roleId,
        confidence: node.confidence,
        content: node.content,
        opacity: 1,
      });
    });
  }

  const posById = new Map(renderedNodes.map((n) => [n.id, n]));
  const edgeLabelFor = (child: BranchNode, layer: number): string => {
    if (child.type === "synthesis") return "收敛";
    if (child.type === "decision") return "决策";
    if (layer <= 1) return "主张";
    return "迭代";
  };
  const layoutEdges: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const [childId, parentId] of parentOf.entries()) {
    const from = posById.get(parentId);
    const to = posById.get(childId);
    const child = nodeById.get(childId);
    if (!from || !to || !child) continue;
    const key = `${parentId}->${childId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    layoutEdges.push({
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      label: edgeLabelFor(child, layerByNode.get(childId)!),
      relation: child.type === "synthesis" ? "synthesis" : "sequence",
    });
  }

  const graphWidth =
    BRAINSTORM_NODE_W + Math.max(0, columnCount - 1) * colStep + BRAINSTORM_PADDING * 2;
  const graphHeight = canvasHeight;
  const scale = computeAdaptiveScale(
    graphWidth,
    graphHeight,
    canvasWidth,
    canvasHeight,
    BRAINSTORM_PADDING,
  );

  return { nodes: renderedNodes, edges: layoutEdges, scale };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * BrainstormWallGraph renders the multi-agent brainstorm session as a
 * dagre-laid-out mind map on a Three.js wall surface.
 */
export function BrainstormWallGraph({
  nodes,
  edges,
  sessionStatus,
  deliberation,
}: BrainstormWallGraphProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const needsRedrawRef = useRef(true);
  const lastRenderTimeRef = useRef<number>(Date.now());
  const fadeNodesRef = useRef<Map<string, { startTime: number }>>(new Map());

  // Compute layout
  const layout = useMemo<LayoutResult | null>(() => {
    if (nodes.length === 0) return null;
    try {
      return computeBrainstormLayout(nodes, edges);
    } catch {
      return null;
    }
  }, [nodes, edges]);

  // Create canvas + texture (once)
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    canvasRef.current = canvas;

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    textureRef.current = texture;

    // Initial empty draw
    const ctx = canvas.getContext("2d");
    if (ctx) drawBrainstormGraph(ctx, null);
    texture.needsUpdate = true;

    return () => {
      texture.dispose();
      textureRef.current = null;
      canvasRef.current = null;
    };
  }, []);

  // Mark redraw on layout change
  useEffect(() => {
    needsRedrawRef.current = true;

    // Track new nodes for fade-in
    const now = Date.now();
    for (const node of nodes) {
      const createdAt = new Date(node.createdAt).getTime();
      // Nodes created within the last 500ms are "new"
      if (now - createdAt < 500 && !fadeNodesRef.current.has(node.id)) {
        fadeNodesRef.current.set(node.id, { startTime: now });
      }
    }
    lastRenderTimeRef.current = now;
  }, [layout, nodes]);

  // Per-frame render
  useFrame(() => {
    const canvas = canvasRef.current;
    const texture = textureRef.current;
    if (!canvas || !texture) return;

    // Check if any fade animations are active
    const now = Date.now();
    let hasFading = false;
    for (const [nodeId, fade] of fadeNodesRef.current.entries()) {
      const elapsed = now - fade.startTime;
      if (elapsed < 300) {
        hasFading = true;
      } else {
        fadeNodesRef.current.delete(nodeId);
      }
    }

    if (!needsRedrawRef.current && !hasFading) return;
    needsRedrawRef.current = false;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Apply fade-in opacity to layout nodes
    let drawLayout = layout;
    if (drawLayout && fadeNodesRef.current.size > 0) {
      const fadedNodes = drawLayout.nodes.map((n) => {
        const fade = fadeNodesRef.current.get(n.id);
        if (fade) {
          const elapsed = now - fade.startTime;
          const opacity = Math.min(elapsed / 300, 1);
          return { ...n, opacity };
        }
        return n;
      });
      drawLayout = { ...drawLayout, nodes: fadedNodes };
    }

    drawBrainstormGraph(ctx, drawLayout, CANVAS_W, CANVAS_H, deliberation);
    texture.needsUpdate = true;

    // Ensure mesh material has the texture bound
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      if (!mat.map) {
        mat.map = texture;
        mat.needsUpdate = true;
      }
    }
  });

  // Keep the completed brainstorm visible on the wall until the next reset.
  // The session often completes before the user visually inspects the 3D HUD;
  // hiding on "completed" made the real /autopilot wall fall back to the older
  // empty/route texture immediately.
  if (sessionStatus === "idle" || sessionStatus === "failed") {
    return null;
  }

  return (
    <mesh
      ref={meshRef}
      position={BRAINSTORM_WALL_GRAPH_POSITION}
      renderOrder={20}
      receiveShadow
    >
      <planeGeometry
        args={[BLUEPRINT_WALL_GRAPH_BACKING_WIDTH, BLUEPRINT_WALL_GRAPH_BACKING_HEIGHT]}
      />
      <meshBasicMaterial depthWrite={false} />
    </mesh>
  );
}

/**
 * Connected version that reads from the brainstormGraph store.
 */
export function BrainstormWallGraphConnected() {
  const {
    nodes,
    edges,
    sessionStatus,
    currentRound,
    convergenceScore,
    challengeEdges,
    voteOutcome,
  } = useBrainstormGraphStore();
  return (
    <BrainstormWallGraph
      nodes={nodes}
      edges={edges}
      sessionStatus={sessionStatus}
      deliberation={{
        currentRound,
        convergenceScore,
        challengeEdges,
        voteOutcome,
      }}
    />
  );
}

export default BrainstormWallGraph;
