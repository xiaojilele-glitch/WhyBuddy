/**
 * WorkflowGraph — React Flow 渲染的业务流程活图（Workflow 屏主路径）。
 *
 * 节点是真 React 组件（角色色条 + @role chip + 始/终徽标），边为 smoothstep
 * 平滑折线带条件标签，@dagrejs/dagre 计算自上而下布局，自带缩放控制器与
 * 网格底纹。订阅运行时状态：「试运行」推进的实例实时高亮当前停留节点
 * （珊瑚描边 + 实例计数徽标，出边流动动画）——流程图 = 运行监视器。
 *
 * 色板经 dataviz 校验（CVD ΔE 22.8 PASS），角色名文字始终在场，
 * 不靠颜色单独传达。屏常挂载（hidden）时容器零尺寸：门控到实际
 * 有尺寸再挂 ReactFlow，避免空画布。
 */

import React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
  derivePhaseLanes,
  deriveWorkflowGraphData,
  type FiveSystemModel,
  type WfGraphNode,
  normalizeRoles,
} from "./five-system-model";
import { loadRuntimeState, subscribeRuntimeChanged } from "../live-runtime/runtime-persistence";
import { useContainerSized } from "./use-sized";

// 经 dataviz 校验的分类色板（低对比两色由角色名文字补偿）
const ROLE_PALETTE = ["#1677ff", "#fa8c16", "#722ed1", "#13c2c2", "#c41d7f", "#5b8c00"];
const ROLE_FALLBACK = "#8c8c8c";
const HIGHLIGHT = "#1677ff";

const CARD_W = 208;
const CARD_H = 66;

/** 角色 → 色板颜色（图例条与节点卡共用，保证一致）。 */
export function roleColor(role: string | null, roles: string[]): string {
  if (!role) return ROLE_FALLBACK;
  const idx = roles.indexOf(role);
  return idx >= 0 ? ROLE_PALETTE[idx % ROLE_PALETTE.length] : ROLE_FALLBACK;
}

type WfFlowNode = Node<{ wf: WfGraphNode; color: string; running: number }, "wfNode">;

function WfNodeCard({ data }: NodeProps<WfFlowNode>) {
  const { wf, color, running } = data;
  const barColor = wf.roleResolved ? color : "#ff4d4f";
  return (
    <div
      style={{
        width: CARD_W,
        boxSizing: "border-box",
        background: "#fff",
        border: running > 0 ? `2px solid ${HIGHLIGHT}` : "1px solid #E3DED2",
        borderLeft: `4px solid ${barColor}`,
        borderRadius: 10,
        padding: "8px 10px",
        boxShadow:
          running > 0
            ? "0 0 0 4px rgba(217,119,87,0.15), 0 2px 8px rgba(90,80,60,0.10)"
            : "0 2px 8px rgba(90,80,60,0.10)",
        fontFamily: "inherit",
      }}
    >
      <Handle id="t-top" type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle id="t-right" type="target" position={Position.Right} style={{ opacity: 0 }} />
      <Handle id="t-left" type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#33302a",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {wf.name}
        </span>
        {wf.isStart && (
          <span style={{ background: "#e6f4ff", color: "#1677ff", borderRadius: 8, padding: "0 6px", fontSize: 9 }}>始</span>
        )}
        {wf.isTerminal && (
          <span style={{ background: "#f6ffed", color: "#5b8c00", borderRadius: 8, padding: "0 6px", fontSize: 9 }}>终</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, minHeight: 14 }}>
        {wf.role ? (
          <>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: barColor, flexShrink: 0 }} />
            <span
              style={{
                fontSize: 10,
                color: wf.roleResolved ? "#667085" : "#ff4d4f",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {wf.roleResolved ? "" : "✗ "}@{wf.role}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 10, color: "#c9c2b2" }}>无审批人</span>
        )}
        {running > 0 && (
          <span
            style={{
              marginLeft: "auto",
              background: HIGHLIGHT,
              color: "#fff",
              borderRadius: 8,
              padding: "0 7px",
              fontSize: 9,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            ● {running} 实例在此
          </span>
        )}
      </div>
      <Handle id="s-bottom" type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle id="s-right" type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle id="s-left" type="source" position={Position.Left} style={{ opacity: 0 }} />
    </div>
  );
}

type WfLaneNode = Node<{ label: string; index: number; w: number; h: number }, "wfLane">;

/** 阶段泳道背景卡（zIndex 置底、不可交互，节点浮于其上）。 */
function WfLaneCard({ data }: NodeProps<WfLaneNode>) {
  return (
    <div
      style={{
        width: data.w,
        height: data.h,
        boxSizing: "border-box",
        background: data.index % 2 ? "rgba(240,237,229,0.5)" : "rgba(250,248,243,0.65)",
        border: "1px dashed #E3DED2",
        borderRadius: 14,
        position: "relative",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 8,
          left: 10,
          fontSize: 10,
          fontWeight: 600,
          color: "#8c8577",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: "1px 8px",
          whiteSpace: "nowrap",
        }}
      >
        {data.label}
      </span>
    </div>
  );
}

const NODE_TYPES = { wfNode: WfNodeCard, wfLane: WfLaneCard };

/** dagre TB 布局：返回 nodeId → 左上角坐标（React Flow 用左上角定位）。 */
function layoutPositions(
  nodes: WfGraphNode[],
  edges: Array<{ from: string; to: string; condition?: string | null }>
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "TB", nodesep: 56, ranksep: 48, edgesep: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: CARD_W, height: CARD_H });
  // 条件标签尺寸喂给 dagre（中文≈10px/字）——层间距按标签自动撑开，不压卡
  for (const [i, e] of edges.entries()) {
    const cond = (e as { condition?: string | null }).condition ?? "";
    g.setEdge(
      e.from,
      e.to,
      cond
        ? { width: cond.length * 10.5 + 16, height: 20, labelpos: "c" }
        : { width: 8, height: 4 },
      `t-${i}`
    );
  }
  dagre.layout(g);
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = g.node(n.id);
    pos[n.id] = { x: p.x - CARD_W / 2, y: p.y - CARD_H / 2 };
  }
  return pos;
}

export interface LaneRect {
  phase: string;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const LANE_PAD_X = 28;
const LANE_PAD_TOP = 36;
const LANE_PAD_BOTTOM = 20;
const LANE_GAP = 46;

/**
 * 泳道布局：每个阶段的子图各自 dagre TB 排版（只含阶段内边），
 * 泳道按阶段首现序垂直堆叠、内容水平居中；跨阶段边照常在泳道间隙路由。
 */
function layoutWithLanes(
  nodes: WfGraphNode[],
  edges: Array<{ from: string; to: string; condition?: string | null }>,
  lanes: Array<{ phase: string; nodeIds: string[] }>
): { positions: Record<string, { x: number; y: number }>; laneRects: LaneRect[] } {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const locals: Array<{
    phase: string;
    pos: Record<string, { x: number; y: number }>;
    w: number;
    h: number;
  }> = [];
  for (const lane of lanes) {
    const inLane = new Set(lane.nodeIds);
    const laneNodes = lane.nodeIds.map((id) => nodeById.get(id)!).filter(Boolean);
    const laneEdges = edges.filter((e) => inLane.has(e.from) && inLane.has(e.to));
    const pos = layoutPositions(laneNodes, laneEdges);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of lane.nodeIds) {
      const p = pos[id];
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + CARD_W);
      maxY = Math.max(maxY, p.y + CARD_H);
    }
    if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = CARD_W; maxY = CARD_H; }
    // 归零到 (0,0)
    const norm: Record<string, { x: number; y: number }> = {};
    for (const id of lane.nodeIds) {
      const p = pos[id];
      if (p) norm[id] = { x: p.x - minX, y: p.y - minY };
    }
    locals.push({ phase: lane.phase, pos: norm, w: maxX - minX, h: maxY - minY });
  }

  const laneW = Math.max(...locals.map((l) => l.w)) + LANE_PAD_X * 2;
  const positions: Record<string, { x: number; y: number }> = {};
  const laneRects: LaneRect[] = [];
  let y = 0;
  for (const [i, l] of locals.entries()) {
    const laneH = l.h + LANE_PAD_TOP + LANE_PAD_BOTTOM;
    laneRects.push({ phase: l.phase, index: i, x: 0, y, w: laneW, h: laneH });
    const xShift = (laneW - l.w) / 2;
    for (const [id, p] of Object.entries(l.pos)) {
      positions[id] = { x: p.x + xShift, y: y + LANE_PAD_TOP + p.y };
    }
    y += laneH + LANE_GAP;
  }
  return { positions, laneRects };
}

export function WorkflowGraph({
  model,
  sessionId,
  className = "",
}: {
  model: FiveSystemModel;
  sessionId?: string;
  className?: string;
}) {
  const data = React.useMemo(() => deriveWorkflowGraphData(model), [model]);
  // roleColor 按**引用键**在列表里的下标取色，必须传 id，不能传显示名——
  // 传混了同一个角色在不同屏会拿到不同颜色。
  const roles = React.useMemo(
    () => normalizeRoles(model).map(r => r.id),
    [model]
  );

  // 「试运行」推进实例 → runtime-changed 事件 → 重算各节点停留实例数
  const [runtimeVersion, setRuntimeVersion] = React.useState(0);
  React.useEffect(() => {
    if (!sessionId) return;
    return subscribeRuntimeChanged(sessionId, () => setRuntimeVersion((v) => v + 1));
  }, [sessionId]);
  const runningByNode = React.useMemo(() => {
    const counts: Record<string, number> = {};
    if (!sessionId) return counts;
    const state = loadRuntimeState(sessionId);
    for (const inst of state?.instances ?? []) {
      if (inst.status === "running") counts[inst.currentNodeId] = (counts[inst.currentNodeId] ?? 0) + 1;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, runtimeVersion]);

  // 布局只依赖结构；高亮变化不重排。全节点带 phase 且 ≥2 阶段 → 泳道布局
  const layout = React.useMemo(() => {
    if (!data) return { positions: {} as Record<string, { x: number; y: number }>, laneRects: [] as LaneRect[] };
    const lanes = derivePhaseLanes(data.nodes);
    if (lanes) return layoutWithLanes(data.nodes, data.edges, lanes);
    return { positions: layoutPositions(data.nodes, data.edges), laneRects: [] };
  }, [data]);
  const positions = layout.positions;

  const flowNodes: Array<WfFlowNode | WfLaneNode> = React.useMemo(() => {
    const laneNodes: WfLaneNode[] = layout.laneRects.map((r) => ({
      id: `lane-${r.index}`,
      type: "wfLane" as const,
      position: { x: r.x, y: r.y },
      data: { label: r.phase, index: r.index, w: r.w, h: r.h },
      selectable: false,
      draggable: false,
      focusable: false,
      zIndex: -1,
    }));
    const wfNodes: WfFlowNode[] = (data?.nodes ?? []).map((n) => ({
      id: n.id,
      type: "wfNode" as const,
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: { wf: n, color: roleColor(n.role, roles), running: runningByNode[n.id] ?? 0 },
    }));
    return [...laneNodes, ...wfNodes];
  }, [data, layout.laneRects, positions, roles, runningByNode]);

  const flowEdges: Edge[] = React.useMemo(
    () =>
      (data?.edges ?? []).map((e, i) => {
        // 回边/同层边不穿过节点区：从源节点侧面出、靶节点侧面进，
        // 左右交替分道，避免多条回边叠在同一侧搅成一团
        const src = positions[e.from];
        const tgt = positions[e.to];
        const isBack = !!src && !!tgt && tgt.y <= src.y;
        const sideRight = i % 2 === 0;
        return {
          id: `t-${i}`,
          source: e.from,
          target: e.to,
          sourceHandle: isBack ? (sideRight ? "s-right" : "s-left") : "s-bottom",
          targetHandle: isBack ? (sideRight ? "t-right" : "t-left") : "t-top",
          type: "smoothstep",
          pathOptions: { borderRadius: 12 },
          label: e.condition ?? undefined,
          // 实例正停留的节点，出边流动动画——下一步会走向哪里一眼可见
          animated: (runningByNode[e.from] ?? 0) > 0,
          style: { stroke: isBack ? "#D9CDB8" : "#C9C2B2", strokeWidth: 1.5, strokeDasharray: isBack ? "6 4" : undefined },
          labelStyle: { fontSize: 10, fill: "#8c8577" },
          labelBgStyle: { fill: "#FCFBF8", fillOpacity: 0.95 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd: { type: "arrowclosed" as const, color: "#C9C2B2", width: 18, height: 18 },
        };
      }),
    [data, positions, runningByNode]
  );

  // 屏常挂载（hidden）：容器有实际尺寸才挂 ReactFlow（否则空画布警告）
  const { ref: containerRef, sized } = useContainerSized();

  if (!data) return null;

  return (
    <div ref={containerRef} className={`relative h-full w-full ${className}`} data-testid="workflow-graph">
      {sized && (
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          deleteKeyCode={null}
        >
          <Background gap={18} size={1} color="#e5e7eb" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      )}
      <span className="pointer-events-none absolute bottom-2 left-3 rounded-full bg-black/20 px-2 py-0.5 text-[9px] text-white/90">
        拖拽移动 · 滚轮缩放 · 试运行实例实时高亮
      </span>
    </div>
  );
}
