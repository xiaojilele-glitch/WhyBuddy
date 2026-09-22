/**
 * WorkflowScreen — 16:9 流程图渲染器
 *
 * 数据优先级（诚实降级链）：
 *   1. 五系统模型 workflow 段：nodes/transitions 渲染成 Mermaid flowchart，
 *      节点审批人角色（assigneeRole）与 rbac.roles 交叉校验，未解析引用如实标红。
 *   2. SSE skill_result 携带的 mermaid（跨系统联动图，实时推演中）。
 *   3. 持久化 skillRuntimeGraph 的 workflow 跨系统边（刷新后重建）。
 *   4. 占位骨架（降透明度 + 提示），不冒充真实产物。
 */

import React, { useMemo, useState } from "react";
import { DEFAULT_SESSION_ID } from "@/lib/sliderule-session-id";
import { Segmented, Tag } from "antd";
import { MermaidDiagram } from "../MermaidDiagram";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { EvidenceBadges } from "./EvidenceBadges";
import { EmptyScreenHint } from "./EmptyScreenHint";
import { WorkflowRuntimePanel } from "../live-runtime/WorkflowRuntimePanel";
import { WorkflowGraph, roleColor } from "./WorkflowGraph";
import {
  type FiveSystemModel,
  type SkillRuntimeGraphLike,
  workflowModelToMermaid,
  resolveRoleRef,
  edgesForSkill,
  crossSkillEdgesToMermaid,
  normalizeRoles,
} from "./five-system-model";

interface WorkflowScreenProps {
  publishClosure?: PublishClosureSummary | null;
  mermaidSource?: string | null;
  /** 解析出的五系统模型（含 rbac 段用于 assigneeRole 交叉引用）。 */
  model?: FiveSystemModel | null;
  /** 持久化的跨系统运行时图（刷新后无 SSE mermaid 时的真实数据源）。 */
  skillRuntimeGraph?: SkillRuntimeGraphLike | null;
  /** 试运行状态的持久化命名空间（浏览器运行时，零后端）。 */
  sessionId?: string;
  isActive?: boolean;
  className?: string;
}

function extractFlow(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```mermaid\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const bare = text.match(/(flowchart|graph|sequenceDiagram)([\s\S]*?)(?=\n\n|\n[A-Z#]|$)/i);
  if (bare) return bare[0].trim();
  return null;
}

/** 链路 kind → 中文标签（未知 kind 原样透出，不猜） */
const CHAIN_KIND_LABEL: Record<string, string> = {
  money: "资金",
  lifecycle: "生命周期",
  governance: "治理",
  recovery: "补偿",
};

export function WorkflowScreen({
  publishClosure,
  mermaidSource,
  model,
  skillRuntimeGraph,
  sessionId = DEFAULT_SESSION_ID,
  isActive = false,
  className = "",
}: WorkflowScreenProps) {
  const workflow = model?.workflow;
  const chains = workflow?.chains ?? [];
  // 多链路（改进②评测暴露的缺口）：顶层 nodes/transitions 是主链路，
  // chains 携带资金/治理/补偿等附加链路；此处选中的链路驱动图面与图例。
  const [chainId, setChainId] = useState<string>("primary");
  const activeChain = useMemo(
    () => (chainId === "primary" ? null : chains.find((c) => (c.id || c.name) === chainId) ?? null),
    [chainId, chains]
  );
  const activeWorkflow = activeChain
    ? { id: activeChain.id, nodes: activeChain.nodes, transitions: activeChain.transitions }
    : workflow;
  const nodes = activeWorkflow?.nodes ?? [];
  const transitions = activeWorkflow?.transitions ?? [];
  // 链路切换时给 WorkflowGraph 一个替身模型（rbac 等段保留做角色解析）；
  // 试运行实例只挂主链路节点，附加链路上自然无高亮——不伪造。
  const graphModel = useMemo(
    () => (activeChain && model ? { ...model, workflow: activeWorkflow } : model),
    [activeChain, model, activeWorkflow]
  );
  // 试运行（浏览器运行时）：模型在场才可用——像 ECharts 一样把 workflow 段
  // 渲染成可操作的审批状态机（发起/通过/驳回/分支/日志，零后端）。
  // 试运行内核只跑主链路（live-runtime 以 model.workflow 为准）。
  const [screenMode, setScreenMode] = useState<"diagram" | "runtime">("diagram");

  const modelDiagram = useMemo(() => workflowModelToMermaid(activeWorkflow), [activeWorkflow]);

  const sseDiagram = useMemo(() => {
    if (!mermaidSource) return null;
    return extractFlow(mermaidSource);
  }, [mermaidSource]);

  const graphEdges = useMemo(
    () => edgesForSkill(skillRuntimeGraph, "workflow"),
    [skillRuntimeGraph]
  );
  const graphDiagram = useMemo(
    () => (graphEdges.length > 0 ? crossSkillEdgesToMermaid("workflow", graphEdges) : null),
    [graphEdges]
  );

  // 降级链：模型 → SSE mermaid → 持久化跨系统边 → 占位
  const diagram = modelDiagram ?? sseDiagram ?? graphDiagram;
  const sourceKind: "model" | "sse" | "graph" | "placeholder" = modelDiagram
    ? "model"
    : sseDiagram
    ? "sse"
    : graphDiagram
    ? "graph"
    : "placeholder";

  const roleResolutions = useMemo(
    () => nodes.map((node) => ({ node, role: resolveRoleRef(node.assigneeRole, model) })),
    [nodes, model]
  );
  const unresolvedRoleCount = roleResolutions.filter(
    (r) => r.role.ref && !r.role.resolved
  ).length;

  // 图例条数据：按角色聚合（color 与图上节点色条一致）
  const roleLegend = useMemo(() => {
    const declaredRoles = normalizeRoles(model).map(r => r.id);
    const byRole = new Map<string, { role: string; resolved: boolean; count: number; color: string }>();
    for (const { role } of roleResolutions) {
      if (!role.ref) continue;
      const entry = byRole.get(role.ref) ?? {
        role: role.ref,
        resolved: role.resolved,
        count: 0,
        color: roleColor(role.ref, declaredRoles),
      };
      entry.count += 1;
      byRole.set(role.ref, entry);
    }
    return [...byRole.values()];
  }, [roleResolutions, model?.rbac?.roles]);

  const evidence = publishClosure?.perSkillEvidence?.["workflow"];

  return (
    <div
      className={`relative flex h-full w-full flex-col bg-white ${className}`}
      data-skill="workflow"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-[#e8eaee] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-violet-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Workflow
        </span>
        {sourceKind === "model" && (
          <span className="text-xs text-stone-400">
            {nodes.length} 节点 · {transitions.length} 转移
          </span>
        )}
        {sourceKind === "sse" && (
          <span className="text-xs text-stone-400">跨系统联动 · 实时</span>
        )}
        {sourceKind === "graph" && (
          <span className="text-xs text-stone-400">跨系统联动 · 已持久化</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {unresolvedRoleCount > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 ring-1 ring-red-200">
              {unresolvedRoleCount} 个角色未在 RBAC 定义
            </span>
          )}
          {sourceKind === "model" && nodes.length > 0 && (
            <Segmented
              size="small"
              data-testid="workflow-mode-toggle"
              value={screenMode}
              onChange={value => setScreenMode(value as "diagram" | "runtime")}
              options={[
                { id: "diagram" as const, label: "流程图" },
                { id: "runtime" as const, label: "试运行" },
              ].map(({ id, label }) => ({
                value: id,
                label: <span data-testid={`workflow-mode-${id}`}>{label}</span>,
              }))}
            />
          )}
          <EvidenceBadges evidence={evidence} />
        </div>
      </div>

      {screenMode === "runtime" && sourceKind === "model" && model ? (
        <WorkflowRuntimePanel model={model} sessionId={sessionId} />
      ) : (
      <>
        {/* 链路切换条：主链路（核心对象生命周期）+ 附加业务链路（资金/治理/补偿） */}
        {sourceKind === "model" && chains.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-1.5 border-b border-[#e8eaee] bg-white px-4 py-1.5"
            data-testid="workflow-chain-tabs"
          >
            <span className="text-[10px] text-stone-400">业务链路</span>
            <Segmented
              size="small"
              value={chainId}
              onChange={value => setChainId(String(value))}
              options={[
                { key: "primary", label: workflow?.name || "主链路", kind: "" },
                ...chains.map((c) => ({
                  key: c.id || c.name || "",
                  label: c.name || c.id || "未命名链路",
                  kind: c.kind ? CHAIN_KIND_LABEL[c.kind] ?? c.kind : "",
                })),
              ].map(tab => ({
                value: tab.key,
                label: <span data-testid={`workflow-chain-${tab.key}`}>{tab.label}{tab.kind && <Tag bordered={false}>{tab.kind}</Tag>}</span>,
              }))}
            />
          </div>
        )}

        {/* 角色图例条 — 取代早期的节点角色侧表（与节点卡信息重复且占 1/4 画布）。
            色点与图上节点色条一致；未在 RBAC 声明的角色照旧 ✗ 标红（fail-closed）。 */}
        {sourceKind === "model" && roleLegend.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-1.5 border-b border-[#e8eaee] bg-[#FBF9F4] px-4 py-1.5"
            data-testid="workflow-node-roles"
          >
            <span className="text-[10px] text-stone-400">审批人角色</span>
            {roleLegend.map((entry) => (
              <span
                key={entry.role}
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] ring-1 ${
                  entry.resolved
                    ? "bg-white text-stone-600 ring-[#e5e7eb]"
                    : "bg-red-50 text-red-600 ring-red-200"
                }`}
                title={
                  entry.resolved
                    ? `${entry.count} 个节点由 ${entry.role} 审批`
                    : `角色未在 RBAC 定义：${entry.role}`
                }
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: entry.resolved ? entry.color : "#ff4d4f" }}
                />
                {`${entry.resolved ? "✓" : "✗"} ${entry.role}`}
                <span className={entry.resolved ? "text-stone-400" : "text-red-400"}>×{entry.count}</span>
              </span>
            ))}
            <span className="ml-auto hidden text-[10px] text-stone-300 sm:inline">
              虚线 = 回退/驳回 · 珊瑚高亮 = 实例当前位置
            </span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {sourceKind === "placeholder" ? (
            <EmptyScreenHint title="业务流程图" desc="节点、转移与审批人角色，来自五系统模型 workflow 段" />
          ) : sourceKind === "model" && graphModel ? (
            // 结构化模型在手 → 活图（角色着色 + 试运行实例实时高亮）
            <div className="min-h-0 min-w-0 flex-1">
              {/* key=chainId：切链路时整图重挂，dagre 重排干净不残留 */}
              <WorkflowGraph key={chainId} model={graphModel} sessionId={sessionId} />
            </div>
          ) : (
            <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3">
              <MermaidDiagram chart={diagram ?? ""} className="h-full w-full" />
            </div>
          )}
        </div>
      </>
      )}

    </div>
  );
}
