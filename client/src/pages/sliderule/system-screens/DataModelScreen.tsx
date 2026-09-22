/**
 * DataModelScreen — 16:9 实体关系图渲染器
 *
 * 从 publishClosure 或 artifact 内容中提取 Mermaid ER/classDiagram DSL，
 * 渲染成可视化实体关系图。无数据时展示骨架占位。
 */

import React, { useMemo, useState } from "react";
import { Segmented } from "antd";
import { MermaidDiagram } from "../MermaidDiagram";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { EvidenceBadges } from "./EvidenceBadges";
import { datamodelToMermaid, type FiveSystemModel } from "./five-system-model";
import { EntityDataPanel } from "../live-runtime/EntityDataPanel";
import { EmptyScreenHint } from "./EmptyScreenHint";
import { EntityRelationGraph } from "./EntityRelationGraph";
import { DEFAULT_SESSION_ID } from "@/lib/sliderule-session-id";

interface DataModelScreenProps {
  publishClosure?: PublishClosureSummary | null;
  /** Raw artifact content containing mermaid ER/class diagram */
  mermaidSource?: string | null;
  /** 解析出的五系统模型（刷新路径：modelSection 重建真实实体关系）。 */
  model?: FiveSystemModel | null;
  /** 数据表（浏览器运行时）状态的持久化命名空间 */
  sessionId?: string;
  isActive?: boolean;
  className?: string;
}

function extractMermaid(text: string): string | null {
  if (!text) return null;
  // ```mermaid ... ``` block
  const fenced = text.match(/```mermaid\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  // bare erDiagram / classDiagram / graph block
  const bare = text.match(/(erDiagram|classDiagram)([\s\S]*?)(?=\n\n|\n[A-Z#]|$)/i);
  if (bare) return bare[0].trim();
  return null;
}

export function DataModelScreen({
  publishClosure,
  mermaidSource,
  model,
  sessionId = DEFAULT_SESSION_ID,
  isActive = false,
  className = "",
}: DataModelScreenProps) {
  // 诚实降级链：SSE mermaid（实时）→ 五系统模型实体（刷新重建）→ 占位骨架。
  const sseDiagram = useMemo(() => {
    if (!mermaidSource) return null;
    return extractMermaid(mermaidSource);
  }, [mermaidSource]);
  const modelDiagram = useMemo(
    () => datamodelToMermaid(model?.datamodel),
    [model?.datamodel]
  );
  const diagram = sseDiagram ?? modelDiagram;
  const isPlaceholder = !diagram;

  const evidence = publishClosure?.perSkillEvidence?.["datamodel"];
  // 数据表需要模型里有实体（编辑才有对象）
  const canEditData = (model?.datamodel?.entities?.length ?? 0) > 0;
  const [screenMode, setScreenMode] = useState<"diagram" | "table">("diagram");

  return (
    <div
      className={`relative flex h-full w-full flex-col bg-white ${className}`}
      data-skill="dataModel"
      data-active={isActive}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[#e5e7eb] px-4 py-2">
        <span className="text-[12px] font-medium text-stone-700">数据模型</span>
        <div className="ml-auto flex items-center gap-1.5">
          {canEditData && (
            <Segmented
              size="small"
              data-testid="datamodel-mode-toggle"
              value={screenMode}
              onChange={value => setScreenMode(value as "diagram" | "table")}
              options={[
                { id: "diagram" as const, label: "模型图" },
                { id: "table" as const, label: "数据表" },
              ].map(({ id, label }) => ({
                value: id,
                label: <span data-testid={`datamodel-mode-${id}`}>{label}</span>,
              }))}
            />
          )}
          <EvidenceBadges evidence={evidence} />
        </div>
      </div>

      {screenMode === "table" && canEditData && model ? (
        <div className="min-h-0 flex-1">
          <EntityDataPanel model={model} sessionId={sessionId} />
        </div>
      ) : canEditData ? (
        // 结构化模型在手 → 表节点 ER 图（字段行上接线）
        <div className="min-h-0 flex-1">
          <EntityRelationGraph datamodel={model!.datamodel} />
        </div>
      ) : isPlaceholder ? (
        // 空状态不渲染任何假域示例（曾被误读成真实数据），只说清将来出现什么
        <EmptyScreenHint title="实体关系图（ER）" desc="实体、字段与关联，来自五系统模型 datamodel 段" />
      ) : (
        // 仅有 SSE 文本 mermaid（无结构化模型）时的降级渲染
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <MermaidDiagram chart={diagram!} className="h-full w-full" />
        </div>
      )}
    </div>
  );
}
