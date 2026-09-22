/**
 * SystemLinkageGraph — C4 L2 默认沙盘（ArchitectureStage 主舞台）。
 *
 * 2026-08-18：默认五个中性容器 + 组间捆扎边（一色、带语义×条数）。
 * 点组展开该层成员；点成员才画它的线并打开抽屉。成员边默认不画——
 * 上一版把全网铺开再靠点选压暗，看起来就是毛线团。
 *
 * 对话流过的系统（focusSkill）只加一圈描边，不伪造一条「走过的路径」：
 * 没有成员级 flow 证据就不编。
 *
 * 断线体检改成 Cursor Problems 那种一行一项，不再占第二条彩带。
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
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import {
  LINKAGE_EDGE_LABEL,
  type FiveSystemModel,
  type LinkageGroup,
  type LinkageSystem,
} from "./five-system-model";
import { deriveSandboxGraph, type SandboxProblem } from "./sandbox-graph";
import { buildSandboxView } from "./sandbox-view";
import { useContainerSized } from "./use-sized";

export const LINKAGE_TO_SKILL: Record<LinkageSystem, SkillId> = {
  datamodel: "dataModel",
  page: "page",
  workflow: "workflow",
  rbac: "rbac",
  aigc: "aigc",
};

export const SKILL_TO_LINKAGE: Partial<Record<SkillId, LinkageSystem>> = {
  dataModel: "datamodel",
  page: "page",
  workflow: "workflow",
  rbac: "rbac",
  aigc: "aigc",
};

const INK = "#737373";
const L2_W = 196;
const L2_H = 52;
const ITEM_W = 176;
const ITEM_H = 34;
const ITEM_GAP = 8;
const GROUP_PAD = 14;
const GROUP_TITLE_H = 36;
const ITEMS_PER_INNER_COL = 12;
const COL_GAP = 88;
const ROW_GAP = 72;

const SYSTEM_DOT: Record<LinkageSystem, string> = {
  datamodel: "#1677ff",
  page: "#0d9488",
  workflow: "#722ed1",
  rbac: "#d97706",
  aigc: "#c41d7f",
};

function innerCols(g: LinkageGroup): number {
  return Math.max(1, Math.ceil(g.items.length / ITEMS_PER_INNER_COL));
}

function expandedWidth(g: LinkageGroup): number {
  const cols = innerCols(g);
  return GROUP_PAD * 2 + cols * ITEM_W + (cols - 1) * ITEM_GAP;
}

function expandedHeight(g: LinkageGroup): number {
  const rows = Math.min(g.items.length, ITEMS_PER_INNER_COL);
  return GROUP_TITLE_H + rows * (ITEM_H + ITEM_GAP) + GROUP_PAD;
}

type GroupNode = Node<
  {
    group: LinkageGroup;
    expanded: boolean;
    focused: boolean;
    problemCount: number;
  },
  "sysGroup"
>;
type ItemNode = Node<
  {
    name: string;
    system: LinkageSystem;
    selected?: boolean;
    dimmed?: boolean;
    problem?: string;
  },
  "sysItem"
>;

function SysGroupCard({ data }: NodeProps<GroupNode>) {
  const { group, expanded, focused, problemCount } = data;
  const w = expanded ? expandedWidth(group) : L2_W;
  const h = expanded ? expandedHeight(group) : L2_H;
  return (
    <div
      data-testid={`sandbox-group-${group.system}`}
      data-expanded={expanded ? "true" : "false"}
      data-focused={focused ? "true" : "false"}
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        background: "#fff",
        border: focused ? "1.5px solid #171717" : "1px solid #e5e7eb",
        borderRadius: 8,
        fontFamily: "inherit",
        cursor: "pointer",
        boxShadow: focused ? "0 0 0 1px #171717" : undefined,
      }}
    >
      <Handle id="t-left" type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id="t-right" type="target" position={Position.Right} style={{ opacity: 0 }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: expanded ? GROUP_TITLE_H : L2_H,
          padding: "0 12px",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: SYSTEM_DOT[group.system],
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#171717",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {group.label}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: problemCount ? "#dc2626" : "#a1a1aa" }}>
          {group.items.length}
        </span>
      </div>
      <Handle id="s-left" type="source" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id="s-right" type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

function SysItemCard({ data }: NodeProps<ItemNode>) {
  return (
    <div
      data-testid={`sandbox-item-${data.system}`}
      style={{
        width: ITEM_W,
        height: ITEM_H,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 5,
        background: "#fff",
        border: data.selected ? "1.5px solid #171717" : "1px solid #e5e7eb",
        borderRadius: 6,
        padding: "0 9px",
        fontSize: 11,
        color: "#3f3f46",
        fontFamily: "inherit",
        opacity: data.dimmed ? 0.28 : 1,
        cursor: "pointer",
      }}
      title={data.problem ? `${data.name} ⚠ ${data.problem}` : data.name}
    >
      <Handle id="t-left" type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id="t-right" type="target" position={Position.Right} style={{ opacity: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.name}</span>
      {data.problem && (
        <span
          aria-label="断线"
          style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: 3, background: "#dc2626", flexShrink: 0 }}
        />
      )}
      <Handle id="s-left" type="source" position={Position.Left} style={{ opacity: 0 }} />
      <Handle id="s-right" type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const NODE_TYPES = { sysGroup: SysGroupCard, sysItem: SysItemCard };

const GROUP_COLUMN: Record<LinkageSystem, { col: number; row: number }> = {
  datamodel: { col: 0, row: 0 },
  page: { col: 1, row: 0 },
  workflow: { col: 2, row: 0 },
  rbac: { col: 3, row: 0 },
  aigc: { col: 1.5, row: 1 },
};

export function SystemLinkageGraph({
  model,
  onInspect,
  focusSkill,
  className = "",
}: {
  model: FiveSystemModel | null | undefined;
  onInspect?: (skill: SkillId) => void;
  /** 最近一次 SSE 落到的系统：只描边，不编造成员路径 */
  focusSkill?: SkillId | null;
  className?: string;
}) {
  const data = React.useMemo(() => deriveSandboxGraph(model), [model]);
  const { ref: containerRef, sized } = useContainerSized();
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<LinkageSystem | null>(null);
  const focusSystem = focusSkill ? SKILL_TO_LINKAGE[focusSkill] ?? null : null;

  const neighborKeys = React.useMemo(() => {
    if (!data || !selectedKey) return null;
    const set = new Set<string>([selectedKey]);
    for (const e of data.edges) {
      if (e.from === selectedKey) set.add(e.to);
      if (e.to === selectedKey) set.add(e.from);
    }
    return set;
  }, [data, selectedKey]);

  const problemByKey = React.useMemo(() => {
    const map = new Map<string, SandboxProblem>();
    for (const p of data?.problems ?? []) map.set(p.key, p);
    return map;
  }, [data]);

  const view = React.useMemo(
    () => (data ? buildSandboxView(data, { selectedKey }) : null),
    [data, selectedKey]
  );

  const { flowNodes, flowEdges } = React.useMemo(() => {
    if (!data || !view) return { flowNodes: [] as Node[], flowEdges: [] as Edge[] };
    const isOpen = (system: LinkageSystem) => {
      if (selectedKey && neighborKeys) {
        return [...neighborKeys].some(k => k.startsWith(`${system}:`));
      }
      return expanded === system;
    };
    const widthOf = (g: LinkageGroup) => (isOpen(g.system) ? expandedWidth(g) : L2_W);
    const heightOf = (g: LinkageGroup) => (isOpen(g.system) ? expandedHeight(g) : L2_H);
    const row0 = data.groups.filter(g => GROUP_COLUMN[g.system].row === 0);
    const row0Height = Math.max(L2_H, ...row0.map(heightOf));
    const widthOfCol = (c: number) =>
      Math.max(
        L2_W,
        ...data.groups.filter(g => GROUP_COLUMN[g.system].col === c).map(widthOf)
      );
    const slotX: number[] = [];
    for (let c = 0; c <= 3; c++) slotX[c] = c === 0 ? 0 : slotX[c - 1] + widthOfCol(c - 1) + COL_GAP;
    const xOfCol = (col: number) => {
      if (Number.isInteger(col)) return slotX[col] ?? 0;
      const lo = Math.floor(col);
      const hi = Math.ceil(col);
      return ((slotX[lo] ?? 0) + (slotX[hi] ?? 0)) / 2;
    };
    const nodes: Node[] = [];
    const problemsBySystem = new Map<LinkageSystem, number>();
    for (const p of data.problems) {
      problemsBySystem.set(p.system, (problemsBySystem.get(p.system) ?? 0) + 1);
    }
    for (const g of data.groups) {
      const { col, row } = GROUP_COLUMN[g.system];
      const isExpanded = isOpen(g.system);
      nodes.push({
        id: `g-${g.system}`,
        type: "sysGroup",
        position: { x: xOfCol(col), y: row === 0 ? 0 : row0Height + ROW_GAP },
        data: {
          group: g,
          expanded: isExpanded,
          focused: focusSystem === g.system,
          problemCount: problemsBySystem.get(g.system) ?? 0,
        },
        draggable: true,
        style: { width: widthOf(g), height: heightOf(g) },
      });
      if (!isExpanded) continue;
      g.items.forEach((item, i) => {
        const innerCol = Math.floor(i / ITEMS_PER_INNER_COL);
        const innerRow = i % ITEMS_PER_INNER_COL;
        nodes.push({
          id: item.key,
          type: "sysItem",
          parentId: `g-${g.system}`,
          extent: "parent",
          draggable: false,
          position: {
            x: GROUP_PAD + innerCol * (ITEM_W + ITEM_GAP),
            y: GROUP_TITLE_H + innerRow * (ITEM_H + ITEM_GAP),
          },
          data: {
            name: item.name,
            system: item.system,
            selected: item.key === selectedKey,
            dimmed: neighborKeys ? !neighborKeys.has(item.key) : false,
            problem: problemByKey.get(item.key)?.reason,
          },
        });
      });
    }
    const colOfSys = (s: LinkageSystem) => GROUP_COLUMN[s]?.col ?? 0;
    const colOfKey = (key: string) => colOfSys(key.split(":")[0] as LinkageSystem);
    const edges: Edge[] = [];
    if (!selectedKey) {
      view.l2Edges.forEach((b, i) => {
        const rightward = colOfSys(b.toSystem) >= colOfSys(b.fromSystem);
        edges.push({
          id: `l2-${i}`,
          source: `g-${b.fromSystem}`,
          target: `g-${b.toSystem}`,
          sourceHandle: rightward ? "s-right" : "s-left",
          targetHandle: rightward ? "t-left" : "t-right",
          type: "smoothstep",
          label: `${b.label} ×${b.count}`,
          labelStyle: { fill: INK, fontSize: 10 },
          labelBgStyle: { fill: "#fff" },
          style: { stroke: INK, strokeWidth: 1.25 },
          markerEnd: { type: "arrowclosed" as const, color: INK, width: 14, height: 14 },
        });
      });
    } else {
      view.memberEdges.forEach((e, i) => {
        const rightward = colOfKey(e.to) >= colOfKey(e.from);
        edges.push({
          id: `m-${i}`,
          source: e.from,
          target: e.to,
          sourceHandle: rightward ? "s-right" : "s-left",
          targetHandle: rightward ? "t-left" : "t-right",
          type: "smoothstep",
          style: { stroke: INK, strokeWidth: 1.5 },
          markerEnd: { type: "arrowclosed" as const, color: INK, width: 14, height: 14 },
        });
      });
    }
    return { flowNodes: nodes, flowEdges: edges };
  }, [data, view, expanded, selectedKey, neighborKeys, problemByKey, focusSystem]);

  const selectedDetail = React.useMemo(() => {
    if (!data || !selectedKey || !view) return null;
    const name =
      data.groups.flatMap(g => g.items).find(i => i.key === selectedKey)?.name ?? selectedKey;
    const counts = new Map<string, number>();
    for (const e of view.memberEdges) {
      counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    }
    return {
      name,
      counts: [...counts.entries()],
      problem: problemByKey.get(selectedKey)?.reason ?? null,
    };
  }, [data, selectedKey, view, problemByKey]);

  const openProblem = (p: SandboxProblem) => {
    setExpanded(p.system);
    setSelectedKey(cur => (cur === p.key ? null : p.key));
  };

  if (!data) return null;

  return (
    <div className={`flex h-full w-full flex-col ${className}`} data-testid="system-linkage-graph">
      <div ref={containerRef} className="relative min-h-0 flex-1">
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
            onNodeClick={(_, node) => {
              if (node.type === "sysGroup") {
                const system = (node.data as GroupNode["data"]).group.system;
                setSelectedKey(null);
                if (expanded === system) {
                  onInspect?.(LINKAGE_TO_SKILL[system]);
                } else {
                  setExpanded(system);
                }
                return;
              }
              if (node.type !== "sysItem") return;
              const system = (node.data as ItemNode["data"]).system;
              setSelectedKey(cur => (cur === node.id ? null : node.id));
              onInspect?.(LINKAGE_TO_SKILL[system]);
            }}
            onPaneClick={() => {
              setSelectedKey(null);
              setExpanded(null);
            }}
          >
            <Background gap={18} size={1} color="#e5e7eb" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        )}
        {selectedDetail && (
          <div
            className="absolute bottom-2 left-3 max-w-[320px] rounded-md border border-[#e5e7eb] bg-white/95 px-3 py-2"
            data-testid="sandbox-selected-card"
          >
            <div className="text-[12px] font-semibold text-stone-800">{selectedDetail.name}</div>
            {selectedDetail.counts.length === 0 ? (
              <div className="mt-0.5 text-[11px] text-stone-400">没有任何连线</div>
            ) : (
              <div className="mt-0.5 space-y-0.5">
                {selectedDetail.counts.map(([kind, n]) => (
                  <div key={kind} className="text-[11px] text-stone-500">
                    {(LINKAGE_EDGE_LABEL as Record<string, string>)[kind] ?? kind} × {n}
                  </div>
                ))}
              </div>
            )}
            {selectedDetail.problem && (
              <div className="mt-1 text-[11px] text-red-600">⚠ {selectedDetail.problem}</div>
            )}
          </div>
        )}
        {!selectedDetail && (
          <span className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-stone-400">
            点组展开 · 再点打开该层 · 点成员看连线
          </span>
        )}
      </div>
      <div
        className="max-h-[28%] shrink-0 overflow-auto border-t border-[#e5e7eb]"
        data-testid="sandbox-problems"
        data-clear={data.problems.length === 0 ? "true" : "false"}
      >
        {data.problems.length === 0 ? (
          <div className="px-3 py-1.5 text-[11px] text-stone-400">没有孤岛成员</div>
        ) : (
          <ul className="py-1">
            <li className="px-3 py-1 text-[11px] font-medium text-red-600">
              ✗ 断线 {data.problems.length}
            </li>
            {data.problems.map(p => (
              <li key={p.key}>
                <button
                  type="button"
                  data-testid="sandbox-problem-row"
                  title={p.reason}
                  onClick={() => openProblem(p)}
                  className={`flex w-full items-baseline gap-2 px-3 py-1 text-left text-[12px] hover:bg-[#fafafa] ${
                    selectedKey === p.key ? "bg-[#fafafa]" : ""
                  }`}
                >
                  <span className="w-[72px] shrink-0 truncate text-red-600">{p.name}</span>
                  <span className="min-w-0 truncate text-stone-500">{p.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
