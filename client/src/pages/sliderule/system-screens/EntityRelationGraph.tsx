/**
 * EntityRelationGraph — DataModel 屏主路径（xyflow Database Schema 表节点）。
 *
 * 2026-08-18：按 GitHub 上能抄的那套改——表是白底细边，字段名在左、类型在右，
 * PK/FK 标在行上，线从 FK 行接到被引用表的 PK（没有 id 就接到表头）。
 * 推断仍走 deriveErGraphData，不许在这里另猜一层关联。
 *
 * 上一版卡腰上进出线、类型在左、浅蓝表头：看起来不像表，像便签。
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
  deriveErGraphData,
  type ErGraphField,
  type ErGraphNode,
  type FiveSystemModel,
} from "./five-system-model";
import { useContainerSized } from "./use-sized";

const CARD_W = 240;
const ROW_H = 24;
const TITLE_H = 32;
const MAX_ROWS = 9;
const INK = "#737373";

export function isPkField(field: ErGraphField): boolean {
  return field.id === "id";
}

export function pkHandleId(node: ErGraphNode): string {
  return node.fields.some(isPkField) ? "id" : "table";
}

function cardHeight(node: ErGraphNode): number {
  return (
    TITLE_H +
    Math.min(node.fields.length, MAX_ROWS) * ROW_H +
    (node.fields.length > MAX_ROWS ? ROW_H : 0)
  );
}

type ErFlowNode = Node<
  { er: ErGraphNode; selectedKey: string | null; onSelect: (key: string) => void },
  "erNode"
>;

export function ErTableCard({
  er,
  selectedKey = null,
  onSelect,
}: {
  er: ErGraphNode;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
}) {
  const rows = er.fields.slice(0, MAX_ROWS);
  const hasPk = er.fields.some(isPkField);
  return (
    <div
      data-testid={`er-table-${er.id}`}
      style={{
        width: CARD_W,
        boxSizing: "border-box",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        overflow: "visible",
        fontFamily: "inherit",
      }}
    >
      <div
        data-testid="er-table-header"
        style={{
          position: "relative",
          height: TITLE_H,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        {!hasPk && (
          <Handle
            type="target"
            position={Position.Right}
            id="table"
            isConnectable={false}
            style={{ width: 7, height: 7, background: INK, border: "none", right: -4 }}
          />
        )}
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#171717",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {er.name}
        </span>
        <span
          style={{
            marginLeft: "auto",
            color: "#a1a1aa",
            fontSize: 10,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {er.id}
        </span>
      </div>
      {rows.map(f => {
        const pk = isPkField(f);
        const fk = Boolean(f.refTarget);
        const key = `${er.id}:${f.id}`;
        const selected = selectedKey === key;
        return (
          <button
            key={f.id}
            type="button"
            data-testid={`er-field-${er.id}-${f.id}`}
            data-pk={pk ? "true" : "false"}
            data-fk={fk ? "true" : "false"}
            onClick={() => onSelect?.(key)}
            onPointerDown={event => event.stopPropagation()}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: "100%",
              height: ROW_H,
              padding: "0 10px",
              borderTop: "1px solid #f4f4f5",
              background: selected ? "#f4f4f5" : "#fff",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {fk && (
              <Handle
                type="source"
                position={Position.Left}
                id={f.id}
                isConnectable={false}
                style={{ width: 7, height: 7, background: "#2563eb", border: "none", left: -4 }}
              />
            )}
            {pk && (
              <Handle
                type="target"
                position={Position.Right}
                id={f.id}
                isConnectable={false}
                style={{ width: 7, height: 7, background: "#d97706", border: "none", right: -4 }}
              />
            )}
            <span
              aria-hidden
              title={pk ? "主键" : fk ? "外键" : undefined}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                flexShrink: 0,
                background: pk ? "#d97706" : fk ? "#2563eb" : "transparent",
              }}
            />
            <span
              style={{
                color: "#171717",
                fontSize: 11,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {f.name}
            </span>
            <span
              style={{
                marginLeft: "auto",
                color: "#a1a1aa",
                fontSize: 10,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                flexShrink: 0,
              }}
            >
              {f.type}
            </span>
          </button>
        );
      })}
      {er.fields.length > MAX_ROWS && (
        <div
          style={{
            height: ROW_H,
            lineHeight: `${ROW_H}px`,
            padding: "0 10px",
            borderTop: "1px solid #f4f4f5",
            color: "#a1a1aa",
            fontSize: 10,
          }}
        >
          … 共 {er.fields.length} 个字段
        </div>
      )}
    </div>
  );
}

function ErNodeCard({ data }: NodeProps<ErFlowNode>) {
  return <ErTableCard er={data.er} selectedKey={data.selectedKey} onSelect={data.onSelect} />;
}

const NODE_TYPES = { erNode: ErNodeCard };

function layoutPositions(data: {
  nodes: ErGraphNode[];
  edges: Array<{ source: string; target: string; label: string }>;
}) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 72 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of data.nodes) g.setNode(n.id, { width: CARD_W, height: cardHeight(n) });
  // dagre 的 LR 秩沿边方向增长；ER 边是"多→一"，反着喂让被引用实体排左边。
  for (const [i, e] of data.edges.entries()) {
    g.setEdge(
      e.target,
      e.source,
      { width: 24, height: 12 },
      `e-${i}`
    );
  }
  dagre.layout(g);
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of data.nodes) {
    const p = g.node(n.id);
    pos[n.id] = { x: p.x - CARD_W / 2, y: p.y - cardHeight(n) / 2 };
  }
  return pos;
}

export function EntityRelationGraph({
  datamodel,
  className = "",
}: {
  datamodel: FiveSystemModel["datamodel"] | null | undefined;
  className?: string;
}) {
  const data = React.useMemo(() => deriveErGraphData(datamodel), [datamodel]);
  const { ref: containerRef, sized } = useContainerSized();
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const onSelect = React.useCallback((key: string) => {
    setSelectedKey(cur => (cur === key ? null : key));
  }, []);

  const flowNodes: ErFlowNode[] = React.useMemo(() => {
    if (!data) return [];
    const positions = layoutPositions(data);
    return data.nodes.map(n => ({
      id: n.id,
      type: "erNode" as const,
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: { er: n, selectedKey, onSelect },
    }));
  }, [data, selectedKey, onSelect]);

  const byId = React.useMemo(() => {
    const map = new Map<string, ErGraphNode>();
    for (const n of data?.nodes ?? []) map.set(n.id, n);
    return map;
  }, [data]);

  const flowEdges: Edge[] = React.useMemo(
    () =>
      (data?.edges ?? []).map((e, i) => {
        const targetNode = byId.get(e.target);
        return {
          id: `r-${i}`,
          source: e.source,
          sourceHandle: e.label,
          target: e.target,
          targetHandle: targetNode ? pkHandleId(targetNode) : "table",
          type: "smoothstep",
          pathOptions: { borderRadius: 10 },
          style: { stroke: INK, strokeWidth: 1.25 },
          markerEnd: { type: "arrowclosed" as const, color: INK, width: 14, height: 14 },
        };
      }),
    [data, byId]
  );

  if (!data) return null;

  return (
    <div ref={containerRef} className={`relative h-full w-full ${className}`} data-testid="er-graph">
      {sized && (
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          deleteKeyCode={null}
          onPaneClick={() => setSelectedKey(null)}
        >
          <Background gap={18} size={1} color="#e5e7eb" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      )}
      <span className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-stone-400">
        点字段看主键/外键 · 拖拽移动 · 滚轮缩放
      </span>
    </div>
  );
}
