/**
 * AigcScreen — AIGC 能力卡片（输入/输出字段绑定 + 角色引用）
 *
 * 数据优先级（诚实降级链）：
 *   1. 五系统模型 aigc 段：capabilities 渲染成卡片，inputFields/outputField
 *      与 datamodel 实体字段交叉解析（"entity.field" → 实体名.字段名），
 *      roleRefs 与 rbac.roles 交叉校验；未解析引用如实标红。
 *   2. rawContent 存在但无结构化能力清单：渲染跨系统联动图（真实但降级），
 *      并明确标注结构化清单缺失。
 *   3. 占位骨架（降透明度 + 提示），不冒充真实产物。
 */

import React, { useMemo, useState } from "react";
import { Segmented } from "antd";
import { MermaidDiagram } from "../MermaidDiagram";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { EvidenceBadges } from "./EvidenceBadges";
import { AigcTryRunPanel } from "../live-runtime/AigcTryRunPanel";
import { AigcPipelinePanel } from "../live-runtime/AigcPipelinePanel";
import { EmptyScreenHint } from "./EmptyScreenHint";
import {
  type FiveSystemModel,
  type RefResolution,
  resolveFieldRef,
  resolveRoleRef,
} from "./five-system-model";

interface AigcScreenProps {
  publishClosure?: PublishClosureSummary | null;
  rawContent?: string | null;
  /** 解析出的五系统模型（含 datamodel/rbac 段用于字段与角色交叉引用）。 */
  model?: FiveSystemModel | null;
  /** 能力试跑时随 prompt 带上的产品意图（话题名） */
  appTitle?: string;
  isActive?: boolean;
  className?: string;
}

function RefChip({ res, tone }: { res: RefResolution; tone: "field" | "output" | "role" }) {
  if (!res.resolved) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 ring-1 ring-red-200">
        ✗ {res.label}
      </span>
    );
  }
  const cls =
    tone === "output"
      ? "bg-pink-50 text-pink-700 ring-1 ring-pink-200"
      : tone === "role"
      ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200"
      : "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${cls}`}>
      {res.label}
    </span>
  );
}

function extractMermaid(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```mermaid\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const bare = text.match(/(flowchart|graph)([\s\S]*?)(?=\n\n|\n[A-Z#]|$)/i);
  if (bare) return bare[0].trim();
  return null;
}

export function AigcScreen({
  publishClosure,
  rawContent,
  model,
  appTitle,
  isActive = false,
  className = "",
}: AigcScreenProps) {
  const capabilities = model?.aigc?.capabilities ?? [];
  const pipelines = model?.aigc?.pipelines ?? [];
  const hasModel = capabilities.length > 0;
  const [screenMode, setScreenMode] = useState<"list" | "tryrun" | "pipeline">("list");

  const resolved = useMemo(
    () =>
      capabilities.map((cap) => ({
        cap,
        inputs: (cap.inputFields ?? []).map((f) => resolveFieldRef(f, model)),
        output: resolveFieldRef(cap.outputField, model),
        roles: (cap.roleRefs ?? []).map((r) => resolveRoleRef(r, model)),
      })),
    [capabilities, model]
  );

  const degradedMermaid = useMemo(
    () => (!hasModel && rawContent ? extractMermaid(rawContent) : null),
    [hasModel, rawContent]
  );

  const evidence = publishClosure?.perSkillEvidence?.["aigc"];

  return (
    <div
      className={`flex h-full w-full flex-col bg-white ${className}`}
      data-skill="aigc"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-[#e8eaee] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-pink-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">AIGC</span>
        <span className="text-xs text-stone-400">
          {hasModel ? `${capabilities.length} 项 AI 能力 · 字段绑定` : "Prompt 模板 · 触发条件"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {hasModel && (
            <Segmented
              size="small"
              data-testid="aigc-mode-toggle"
              value={screenMode}
              onChange={value => setScreenMode(value as "list" | "tryrun" | "pipeline")}
              options={[
                { id: "list" as const, label: "能力清单" },
                { id: "tryrun" as const, label: "能力试跑" },
                // 编排档只在模型产出了管线时出现（不造空壳入口）；
                // 只读 Flow 展示 + 链路试跑——编排由推演产出，不开放画布编辑
                ...(pipelines.length > 0
                  ? [{ id: "pipeline" as const, label: "能力编排" }]
                  : []),
              ].map(({ id, label }) => ({
                value: id,
                label: <span data-testid={`aigc-mode-${id}`}>{label}</span>,
              }))}
            />
          )}
          <EvidenceBadges evidence={evidence} />
        </div>
      </div>

      {screenMode === "pipeline" && hasModel && model ? (
        <div className="min-h-0 flex-1">
          <AigcPipelinePanel model={model} goal={appTitle} />
        </div>
      ) : screenMode === "tryrun" && hasModel && model ? (
        <div className="min-h-0 flex-1">
          <AigcTryRunPanel model={model} goal={appTitle} />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {hasModel ? (
          <div className="space-y-4" data-testid="aigc-capabilities">
            {resolved.map(({ cap, inputs, output, roles }) => (
              <div
                key={cap.id || cap.name}
                className="rounded-md border border-[#e5e7eb] bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-pink-50 px-2 py-0.5 text-[11px] font-semibold text-pink-700 ring-1 ring-pink-200">
                    AI
                  </span>
                  <span className="text-sm font-semibold text-stone-800">
                    {cap.name || cap.id}
                  </span>
                  {roles.length > 0 && (
                    <span className="ml-auto flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-stone-400">可用角色</span>
                      {roles.map((r) => (
                        <RefChip key={r.ref} res={r} tone="role" />
                      ))}
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="mb-1 font-medium text-stone-500">输入字段（DataModel）</div>
                    <div className="flex flex-wrap gap-1">
                      {inputs.length > 0 ? (
                        inputs.map((res) => <RefChip key={res.ref} res={res} tone="field" />)
                      ) : (
                        <span className="text-[10px] text-stone-300">无输入字段</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-stone-500">输出字段（DataModel）</div>
                    <div className="flex flex-wrap gap-1">
                      {output.ref ? (
                        <RefChip res={output} tone="output" />
                      ) : (
                        <span className="text-[10px] text-stone-300">未声明输出</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : degradedMermaid ? (
          <div data-testid="aigc-degraded">
            <div className="mb-2 rounded bg-amber-50 px-3 py-2 text-[11px] text-amber-700 ring-1 ring-amber-200">
              本轮产物未携带结构化 AIGC 能力清单，以下为该系统的跨系统联动证据。
            </div>
            <MermaidDiagram chart={degradedMermaid} className="w-full" />
          </div>
        ) : (
          <EmptyScreenHint title="AIGC 能力清单" desc="AI 能力、输入/输出字段绑定与可用角色，来自五系统模型 aigc 段" />
        )}
      </div>
      )}
    </div>
  );
}
